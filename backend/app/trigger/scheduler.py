"""进程内调度循环：每分钟对表，到点向 OpenAI 兼容 API 发最小请求。

多 worker 防双发：用 SQLite 原子租约（带过期）选「本分钟派发者」，
而非进程级 flock leader —— 旧方案只有抢到 flock 的单个 worker 跑调度，
若该 worker 的循环任务静默死亡（进程仍存活、锁不释放），其余 worker 永远抢不到锁，
调度永久停摆且无任何 missed 记录。新方案下两个 worker 都跑扫描，抢到租约的才派发，
持有者进程崩溃后租约自动过期，另一个存活 worker 下轮自动接管，天然自愈。

补发窗口（2026-09-22 加）：触发点过后 GRACE_MINUTES 分钟内仍然补发，超出窗口才记 missed。
原因：调度只按 HH:MM 精确比对一次，任何一次漏跳（事件循环抖动、循环任务终止、进程重启）
都会让当日窗口**永久丢失且不留痕**（missed 原先只在启动首扫时写，页面看着还是「等待触发」）。

心跳自愈（2026-09-22 加）：`_supervisor` 每 20s 巡检循环任务的存活与心跳时间戳，
任务已结束或心跳停滞超过 STALL_SECONDS 就强制重启，并累计 restarts 计数。

死因可见（2026-09-22 加）：循环任务结束必定留日志（done-callback 打印取消/异常/提前退出），
`/api/trigger/status` 暴露 alive / last_tick / restarts，journalctl 每 10 分钟一条心跳。

> 2026-09-22 事故复盘：9/21 21:45:01 之后调度循环停止心跳，9/22 06:30 未触发，
> 且进程存活、时钟正确、机器空闲、无重启、无任何日志。根因是**循环任务终止后无人观察其结局**：
> 没有 done-callback、没有 await、模块全局强引用让它永不进入 GC，
> 于是连 asyncio 标准的 "Task exception was never retrieved" 都不会打印 —— 静默停摆。
> 本版本用「补发窗口 + 看门狗 + done-callback」三重兜底，使这一失效模式不再造成漏触发。
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
    GRACE_MINUTES,
    HEARTBEAT_LOG_EVERY_TICKS,
    HTTP_TIMEOUT_SECONDS,
    PROBE_MAX_TOKENS,
    PROBE_MESSAGE,
    RETRY_INTERVAL_SECONDS,
    RETRY_TIMES,
    STALL_SECONDS,
    SUPERVISOR_INTERVAL_SECONDS,
)

_loop_task: asyncio.Task | None = None
_supervisor_task: asyncio.Task | None = None
_fire_tasks: set[asyncio.Task] = set()   # 强引用 fire 任务，避免 fire-and-forget 被 GC 回收
_inflight: set[tuple[int, str]] = set()  # (task_id, date) 防同一分钟/同窗口重复派发
_OWNER_ID = uuid.uuid4().hex             # 本进程标识（仅用于租约可视化，不影响正确性）
_logger = logging.getLogger("uvicorn.error")

# —— 可观测性：心跳与自愈计数（/api/trigger/status 暴露 + journalctl 打点）
_last_tick_mono: float = 0.0
_last_tick_wall: str = ""
_tick_count: int = 0
_loop_restarts: int = 0
_started_wall: str = ""
_stopping: bool = False


def _hhmm_minutes(hhmm: str) -> int:
    """HH:MM → 当日分钟数（用于算迟到多少分钟）。"""
    hh, mm = hhmm.split(":")
    return int(hh) * 60 + int(mm)


def _tick() -> None:
    """对表：窗口内补发；超出补发窗口记 missed（幂等）。每分钟调用一次。

    判定顺序（每个启用的任务）：
      1. 时刻还没到 → 跳过
      2. 今日已有 success / failed 记录 → 跳过（已成功，或已尝试过失败，不自动反复打）
      3. 迟到 ≤ GRACE_MINUTES → 抢租约后派发（正常触发 / 补发都走这条路）
      4. 超出窗口且今日无任何记录 → 记一条 missed（同任务同日最多一条，原子写入）
    """
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    now_min = _hhmm_minutes(now_hhmm)
    fired_at = now.strftime("%Y-%m-%d %H:%M:%S")

    for task in store.enabled_tasks_with_key():
        if task["time"] > now_hhmm:
            continue
        if store.has_record_today(task["id"], date_str, statuses=("success", "failed")):
            continue
        late = now_min - _hhmm_minutes(task["time"])
        if late > GRACE_MINUTES:
            # 超出补发窗口：记 missed，让页面明示「错过」而不是继续显示「等待触发」。
            # 先读一次避免每分钟都开写事务；写入本身仍是原子幂等（防两 worker 竞态）。
            if not store.has_record_today(task["id"], date_str, statuses=("missed",)):
                if store.record_missed_once(
                    task["id"],
                    task["name"],
                    date_str=date_str,
                    fired_at=fired_at,
                    error=f"超出补发窗口（迟到 {late} 分钟，窗口 {GRACE_MINUTES} 分钟）未触发，可在页面手动补触发",
                ):
                    _logger.warning(
                        "trigger 错过：%s 计划 %s，迟到 %d 分钟超出补发窗口，已记 missed",
                        task["name"], task["time"], late,
                    )
            continue

        key = (task["id"], date_str)
        if key in _inflight:
            continue
        # 全局原子抢占本窗口派发权：仅一个 worker 抢到（rowcount==1）才真正派发
        if not store.try_claim(task["id"], date_str, _OWNER_ID):
            continue
        _inflight.add(key)
        loop = asyncio.get_running_loop()
        fire = loop.create_task(_fire_and_release(task, date_str))
        _fire_tasks.add(fire)
        fire.add_done_callback(_fire_tasks.discard)
        if late:
            _logger.info(
                "trigger 补发：%s 计划 %s，迟到 %d 分钟（窗口 %d 分钟）",
                task["name"], task["time"], late, GRACE_MINUTES,
            )


async def _fire_and_release(task: dict[str, Any], date_str: str) -> None:
    try:
        ok = await fire_task(task)
        if not ok:
            # 派发失败：释放租约，允许后续 tick 其他 worker 重试
            # （失败会写 failed 历史，后续 tick 的 has_record_today 会挡住重复派发）
            store.release_claim(task["id"], date_str)
    finally:
        _inflight.discard((task["id"], date_str))


def _seconds_to_next_minute() -> float:
    now = datetime.now()
    nxt = (now + timedelta(minutes=1)).replace(second=0, microsecond=0)
    return max(0.5, (nxt - now).total_seconds())


async def _loop() -> None:
    """调度主循环：每分钟 tick 一次。任何单轮异常都不终止循环。"""
    global _last_tick_mono, _last_tick_wall, _tick_count
    last_cleanup_date = ""
    _logger.info("trigger 调度循环启动（补发窗口 %d 分钟，worker %s）", GRACE_MINUTES, _OWNER_ID[:8])
    while True:
        try:
            _tick()
            _tick_count += 1
            _last_tick_mono = time.monotonic()
            _last_tick_wall = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            today = _last_tick_wall[:10]
            if today != last_cleanup_date:
                store.cleanup_history()
                last_cleanup_date = today
            if _tick_count % HEARTBEAT_LOG_EVERY_TICKS == 0:
                _logger.info(
                    "trigger 调度心跳：%s（第 %d 次 tick，循环重启 %d 次）",
                    _last_tick_wall, _tick_count, _loop_restarts,
                )
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


def _on_loop_done(task: asyncio.Task) -> None:
    """循环任务结束的如实留痕 —— 以前这里静默无声，是排查不到根因的关键。"""
    if _stopping:
        return
    if task.cancelled():
        _logger.error("trigger 调度循环被取消（预期外，看门狗将重启）")
        return
    exc = task.exception()
    if exc is not None:
        _logger.error("trigger 调度循环异常终止：%r（看门狗将重启）", exc, exc_info=exc)
    else:
        _logger.error("trigger 调度循环提前退出（无异常，看门狗将重启）")


async def _supervisor() -> None:
    """看门狗：循环任务结束或心跳停滞 → 强制重启（自愈）；顺手记录重启次数。"""
    global _loop_task, _loop_restarts, _last_tick_mono
    while True:
        try:
            await asyncio.sleep(SUPERVISOR_INTERVAL_SECONDS)
            dead = _loop_task is None or _loop_task.done()
            stalled = bool(_last_tick_mono) and (time.monotonic() - _last_tick_mono) > STALL_SECONDS
            if not (dead or stalled):
                continue
            reason = "任务已结束" if dead else f"心跳停滞 {round(time.monotonic() - _last_tick_mono)}s"
            _loop_restarts += 1
            _logger.error(
                "trigger 调度循环失活（%s），看门狗第 %d 次重启", reason, _loop_restarts
            )
            old = _loop_task
            if old is not None and not old.done():
                old.cancel()
                try:
                    await old
                except asyncio.CancelledError:
                    pass
                except Exception:
                    pass
            _last_tick_mono = 0.0  # 清零，避免重启瞬间又被判定停滞
            _loop_task = asyncio.get_running_loop().create_task(_loop())
            _loop_task.add_done_callback(_on_loop_done)
        except asyncio.CancelledError:
            raise
        except Exception:
            _logger.exception("trigger 看门狗巡检异常")


def start() -> None:
    """lifespan 启动时调用：拉起调度循环 + 看门狗（幂等）。

    每个 worker 进程都会跑自己的循环；派发权由 SQLite 租约保证全局唯一，
    故任意存活 worker 都能完成派发，单 worker 循环异常由看门狗自动拉起。
    """
    global _loop_task, _supervisor_task, _started_wall, _stopping
    store.init()
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.get_running_loop().create_task(_loop())
        _loop_task.add_done_callback(_on_loop_done)
    if _supervisor_task is None or _supervisor_task.done():
        _supervisor_task = asyncio.get_running_loop().create_task(_supervisor())
    _stopping = False
    _started_wall = datetime.now().strftime("%Y-%m-%d %H:%M:%S")


async def stop() -> None:
    global _loop_task, _supervisor_task, _stopping
    _stopping = True
    for t in (_supervisor_task, _loop_task):
        if t is not None:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
    _supervisor_task = None
    _loop_task = None


def status() -> dict[str, Any]:
    """调度器健康快照（/api/trigger/status 暴露，前端/排查都能看）。"""
    alive = _loop_task is not None and not _loop_task.done()
    age = round(time.monotonic() - _last_tick_mono, 1) if _last_tick_mono else None
    return {
        "alive": alive,
        "supervisor_alive": _supervisor_task is not None and not _supervisor_task.done(),
        "last_tick": _last_tick_wall or None,
        "tick_age_seconds": age,
        "ticks": _tick_count,
        "restarts": _loop_restarts,
        "grace_minutes": GRACE_MINUTES,
        "started_at": _started_wall or None,
        "owner": _OWNER_ID[:8],
    }


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
