"""进程内调度循环：每分钟对表，到点向 OpenAI 兼容 API 发最小请求。

多 worker 防双发：用 SQLite 原子租约（带过期）选「本分钟派发者」，
而非进程级 flock leader —— 旧方案只有抢到 flock 的单个 worker 跑调度，
若该 worker 的循环任务静默死亡（进程仍存活、锁不释放），其余 worker 永远抢不到锁，
调度永久停摆且无任何 missed 记录。新方案下两个 worker 都跑扫描，抢到租约的才派发，
持有者进程崩溃后租约自动过期，另一个存活 worker 下轮自动接管，天然自愈。

错过不补发：重启跨过触发点只记 missed（按日幂等，不刷屏）；
当日已 success 的任务不再触发（重启/换 worker 均安全）。
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.trigger import store
from app.trigger.config import (
    EXTRA_HEADERS,
    HTTP_TIMEOUT_SECONDS,
    PROBE_MAX_TOKENS,
    PROBE_MESSAGE,
    RETRY_INTERVAL_SECONDS,
    RETRY_TIMES,
)

_loop_task: asyncio.Task | None = None
_inflight: set[tuple[int, str]] = set()   # (task_id, date) 防同一分钟重复派发
_OWNER_ID = uuid.uuid4().hex             # 本进程标识（仅用于租约可视化，不影响正确性）
_logger = logging.getLogger("uvicorn.error")


def _try_claim_and_dispatch() -> None:
    """对表：到点且当日未触发的任务，原子抢租约后派发 fire_task（不等待完成）。"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    for task in store.enabled_tasks_with_key():
        if task["time"] != now_hhmm:
            continue
        if store.has_record_today(task["id"], date_str, statuses=("success",)):
            continue
        key = (task["id"], date_str)
        if key in _inflight:
            continue
        # 全局原子抢占本分钟派发权：仅一个 worker 抢到（rowcount==1）才真正派发
        if not store.try_claim(task["id"], date_str, _OWNER_ID):
            continue
        _inflight.add(key)
        asyncio.get_running_loop().create_task(_fire_and_release(task, date_str))


async def _fire_and_release(task: dict[str, Any], date_str: str) -> None:
    try:
        ok = await fire_task(task)
        if not ok:
            # 派发失败：释放租约，允许下一分钟其他 worker 重试（而非卡死当日）
            store.release_claim(task["id"], date_str)
    finally:
        _inflight.discard((task["id"], date_str))


def _mark_missed_once() -> None:
    """首轮扫描：启用任务今天已过触发点且无任何记录 → 记 missed（按日幂等）。"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    for task in store.list_tasks():
        if not task["enabled"] or task["time"] >= now_hhmm:
            continue
        if store.has_record_today(task["id"], date_str, statuses=("success", "failed", "missed")):
            continue
        store.record_history(
            task["id"], task["name"], "missed",
            fired_at=now.strftime("%Y-%m-%d %H:%M:%S"),
            error="进程重启/停机错过当日触发点，可在页面手动补触发",
        )


def _seconds_to_next_minute() -> float:
    now = datetime.now()
    nxt = (now + timedelta(minutes=1)).replace(second=0, microsecond=0)
    return max(0.5, (nxt - now).total_seconds())


async def _loop() -> None:
    last_cleanup_date = ""
    aligned = False
    while True:
        try:
            if not aligned:
                # 启动后先对齐到整分再首轮扫描，避免启动瞬间半分钟内的奇怪状态
                aligned = True
                _mark_missed_once()
            _try_claim_and_dispatch()
            today = datetime.now().strftime("%Y-%m-%d")
            if today != last_cleanup_date:
                store.cleanup_history()
                last_cleanup_date = today
        except Exception:
            # 单轮异常不终止循环；打出日志便于 journalctl 排查（不含敏感数据）
            _logger.exception("trigger 调度单轮异常")
        # sleep 异常（非取消类）不终止循环；取消信号（stop）正常上抛以干净退出
        try:
            await asyncio.sleep(_seconds_to_next_minute())
        except asyncio.CancelledError:
            raise
        except Exception:
            _logger.exception("trigger 调度 sleep 异常")


def start() -> None:
    """lifespan 启动时调用：拉起调度循环（幂等）。

    每个 worker 进程都会跑自己的循环；派发权由 SQLite 租约保证全局唯一，
    故任意存活 worker 都能完成派发，单 worker 循环异常不影响整体可用性。
    """
    global _loop_task
    if _loop_task is None or _loop_task.done():
        store.init()
        _loop_task = asyncio.get_running_loop().create_task(_loop())


async def stop() -> None:
    global _loop_task
    if _loop_task is not None:
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
    _loop_task = None


async def _do_request(task: dict[str, Any]) -> tuple[bool, int | None, str]:
    """发一次最小请求（OpenAI 兼容）。

    请求体用自然短句 + 正常 token 数（PROBE_MESSAGE / PROBE_MAX_TOKENS），
    配合真实浏览器 UA，让调用看起来像真实 Agent 对话而非机械探测/心跳，
    降低被 API 方风控误判或封号的概率。返回 (ok, http_code, error)，不写历史。
    """
    last_code: int | None = None
    last_error = ""
    ok = False
    headers = {"Authorization": f"Bearer {task['api_key']}"}
    headers.update(EXTRA_HEADERS)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{task['base_url']}/chat/completions",
                headers=headers,
                json={
                    "model": task["model"],
                    "messages": [{"role": "user", "content": PROBE_MESSAGE}],
                    "max_tokens": PROBE_MAX_TOKENS,
                },
            )
        last_code = resp.status_code
        if 200 <= resp.status_code < 300:
            ok = True
        else:
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as exc:  # 网络/超时/DNS 等
        last_error = f"{type(exc).__name__}: {exc}"
    return ok, last_code, last_error


async def probe_connection(task: dict[str, Any]) -> tuple[bool, str]:
    """测试连接专用：发一次请求，返回 (ok, error)。不写执行历史。"""
    ok, _code, err = await _do_request(task)
    return ok, err


async def fire_task(task: dict[str, Any], *, manual: bool = False) -> bool:
    """触发一次任务：POST {base_url}/chat/completions。

    自动触发失败按 RETRY_TIMES 重试（间隔 RETRY_INTERVAL_SECONDS）；
    手动触发只试 1 次（页面即时反馈）。2xx 即算成功（窗口点亮）。
    无论成败都写入执行历史。
    """
    start = time.monotonic()
    total_tries = 1 if manual else (RETRY_TIMES + 1)
    ok = False
    last_code: int | None = None
    last_error = ""
    attempts = 0
    for attempt in range(total_tries):
        attempts = attempt + 1
        ok, last_code, last_error = await _do_request(task)
        if ok:
            break
        if attempt < total_tries - 1:
            await asyncio.sleep(RETRY_INTERVAL_SECONDS)

    latency_ms = round((time.monotonic() - start) * 1000, 1)
    store.record_history(
        task["id"],
        task["name"],
        "success" if ok else "failed",
        http_code=last_code,
        latency_ms=latency_ms,
        retries=attempts - 1,
        manual=manual,
        error=last_error,
    )
    return ok
