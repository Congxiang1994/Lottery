"""SMZDM 捡漏域的定时抓取循环。

多 worker 防重复
----------------
生产 gunicorn 起多个 worker，每个都会跑 lifespan → ``scheduler.start()``。
用**文件 flock（非阻塞）**抢本轮执行权：抢到的抓，没抢到的直接跳过这一轮。
比建租约表简单，且天然自愈 —— 持有者进程挂了，内核自动释放锁。

节奏
----
每 ``FETCH_INTERVAL_SECONDS``（20 分钟）抓一轮，每轮 ``pages_per_round`` 页（默认 5）。
日请求量 ≈ 5 页 × 3 轮/小时 × 24 = 360 次，仍远低于实测风控线
（30~40 次/3~4 分钟即触发验证码）。
"""
from __future__ import annotations

import asyncio
import fcntl
import logging
import os
import time
from datetime import datetime
from typing import Any

from app.smzdm import crawler, store
from app.smzdm.config import DB_PATH, FETCH_INTERVAL_SECONDS

_loop_task: asyncio.Task | None = None
_watchdog_task: asyncio.Task | None = None
_stopping = False
_logger = logging.getLogger("uvicorn.error")

# 可观测性（/api/deals/admin/status 暴露）
_last_round_wall: str = ""
_last_round_mono: float = 0.0
_last_result: dict[str, Any] = {}
_round_restarts: int = 0
_started_wall: str = ""

_LOCK_PATH = DB_PATH.parent / "smzdm_fetch.lock"


def _pick_cate(deals: list[crawler.Deal], cate_filter: str) -> list[crawler.Deal]:
    """按「关注分类」过滤。配置为空 = 全部品类。"""
    wanted = [x.strip() for x in cate_filter.split(",") if x.strip()]
    if not wanted:
        return deals
    return [
        d for d in deals if d.cate1 in wanted or d.cate2 in wanted
    ]


async def run_round(manual: bool = False) -> dict[str, Any]:
    """执行一轮抓取。返回本轮摘要（同时写 fetch_log）。

    manual=True 时跳过 flock（人在管理页点的，必须执行），并由调用方保证不并发。
    """
    st = store.get_settings()
    if st.get("enabled", "1") != "1":
        return {"skipped": True, "reason": "抓取已关闭"}

    lock_fd = -1
    if not manual:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        lock_fd = os.open(str(_LOCK_PATH), os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(lock_fd)
            return {"skipped": True, "reason": "其它 worker 正在抓取"}

    started = time.monotonic()
    try:
        try:
            pages = max(1, min(int(st.get("pages_per_round") or 2), 5))
        except ValueError:
            pages = 2

        deals, errors = await crawler.fetch_round(
            cookie=st.get("cookie", ""),
            ua=st.get("cookie_ua", ""),
            pages=pages,
        )
        parsed = len(deals)
        kept = _pick_cate(deals, st.get("cate_filter", ""))

        # 配了分类却一条都没命中，几乎一定是分类名变了 —— 必须显式提示，
        # 否则页面会「一直没数据」而无人知道原因。
        if not kept and parsed and st.get("cate_filter", "").strip():
            errors.append(
                f"本轮 {parsed} 条好价没有一条命中关注分类「{st['cate_filter']}」，"
                f"请到管理页核对分类名（实际出现："
                f"{'、'.join(sorted({d.cate1 for d in deals if d.cate1})[:8])}）"
            )
            _logger.warning("smzdm 分类过滤未命中：%s", st["cate_filter"])

        # 🔴 全量入库，不按分类预过滤。
        #   分类过滤只作用于「入选」（在 store.judge 里），不作用于落库：
        #   ① 预过滤会让非关注品类一条都不进库 → cate_stats() 永远只能看到
        #      关注品类，而它的职责恰恰是「告诉你实际分布在哪些品类」；
        #   ② 用户改关注分类后历史数据为 0，得重新攒满保留期才发现漏；
        #   ③ 请求量由 pages 决定，分类过滤本来就不能省请求，节流是伪收益。
        rows = [d.to_row(crawler.now_str()) for d in deals]
        added, picked = store.upsert_deals(rows, st)
        banned = crawler.ban_remaining_seconds() > 0
        store.log_round(
            pages=pages,
            parsed=parsed,
            added=added,
            picked=picked,
            banned=banned,
            errors=errors,
        )
        store.cleanup()

        result = {
            "ok": not errors,
            "pages": pages,
            "parsed": parsed,
            "kept": len(kept),
            "added": added,
            "picked": picked,
            "banned": banned,
            "errors": errors,
            "elapsed_ms": round((time.monotonic() - started) * 1000),
            "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        if errors:
            _logger.warning("smzdm 抓取有错误：%s", " / ".join(errors))
        return result
    finally:
        if lock_fd >= 0:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)


async def _loop() -> None:
    global _last_round_wall, _last_round_mono, _last_result
    _logger.info("smzdm 抓取循环启动（间隔 %d 秒）", FETCH_INTERVAL_SECONDS)
    while True:
        try:
            _last_result = await run_round()
            if not _last_result.get("skipped"):
                _last_round_wall = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                _last_round_mono = time.monotonic()
        except asyncio.CancelledError:
            raise
        except Exception:
            # 单轮异常绝不终止循环 —— 站点改版、网络抖动都不该让功能停摆
            _logger.exception("smzdm 抓取单轮异常")
        try:
            await asyncio.sleep(FETCH_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception:
            _logger.exception("smzdm 抓取 sleep 异常")


def _on_loop_done(task: asyncio.Task) -> None:
    if _stopping:
        return
    if task.cancelled():
        _logger.error("smzdm 抓取循环被取消（看门狗将重启）")
        return
    exc = task.exception()
    if exc is not None:
        _logger.error("smzdm 抓取循环异常终止：%r", exc, exc_info=exc)
    else:
        _logger.error("smzdm 抓取循环提前退出（看门狗将重启）")


async def _watchdog() -> None:
    """循环任务结束就重启。不做心跳停滞判定 —— 单轮可能耗时数分钟，误杀代价更大。"""
    global _loop_task, _round_restarts
    while True:
        try:
            await asyncio.sleep(60)
            if _loop_task is not None and not _loop_task.done():
                continue
            _round_restarts += 1
            _logger.error("smzdm 抓取循环失活，看门狗第 %d 次重启", _round_restarts)
            _loop_task = asyncio.get_running_loop().create_task(_loop())
            _loop_task.add_done_callback(_on_loop_done)
        except asyncio.CancelledError:
            raise
        except Exception:
            _logger.exception("smzdm 看门狗巡检异常")


def start() -> None:
    global _loop_task, _watchdog_task, _stopping, _started_wall
    store.init()
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.get_running_loop().create_task(_loop())
        _loop_task.add_done_callback(_on_loop_done)
    if _watchdog_task is None or _watchdog_task.done():
        _watchdog_task = asyncio.get_running_loop().create_task(_watchdog())
    _stopping = False
    _started_wall = datetime.now().strftime("%Y-%m-%d %H:%M:%S")


async def stop() -> None:
    global _loop_task, _watchdog_task, _stopping
    _stopping = True
    for t in (_watchdog_task, _loop_task):
        if t is not None:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
    _watchdog_task = None
    _loop_task = None


def status() -> dict[str, Any]:
    alive = _loop_task is not None and not _loop_task.done()
    age = (
        round(time.monotonic() - _last_round_mono, 1) if _last_round_mono else None
    )
    return {
        "alive": alive,
        "watchdog_alive": _watchdog_task is not None and not _watchdog_task.done(),
        "last_round": _last_round_wall or None,
        "round_age_seconds": age,
        "restarts": _round_restarts,
        "interval_seconds": FETCH_INTERVAL_SECONDS,
        "started_at": _started_wall or None,
        "last_result": _last_result,
        **crawler.health(),
    }
