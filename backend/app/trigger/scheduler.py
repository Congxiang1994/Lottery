"""进程内调度循环：每分钟对表，到点向 OpenAI 兼容 API 发最小请求。

多 worker 防双发：flock 非阻塞文件锁选 leader，仅持锁 worker 运行调度；
leader 所在进程退出后锁自动释放，其余 worker 下轮自动接管。

错过不补发：重启跨过触发点只记 missed（按日幂等，不刷屏）；
当日已 success 的任务不再触发（重启/换 leader 均安全）。
"""
from __future__ import annotations

import asyncio
import fcntl
import time
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.trigger import store
from app.trigger.config import (
    HTTP_TIMEOUT_SECONDS,
    LEADER_LOCK_PATH,
    RETRY_INTERVAL_SECONDS,
    RETRY_TIMES,
)

_loop_task: asyncio.Task | None = None
_lock_file = None            # flock 持有的文件对象（进程生命周期内不关闭）
_is_leader = False
_inflight: set[tuple[int, str]] = set()   # (task_id, date) 防同一分钟重复派发


def _try_acquire_leader() -> bool:
    """非阻塞 flock 抢 leader；已持锁直接返回 True。"""
    global _lock_file, _is_leader
    if _is_leader and _lock_file is not None:
        return True
    try:
        LEADER_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
        f = open(str(LEADER_LOCK_PATH), "w")  # noqa: SIM115 - 生命周期=进程
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_file = f
        _is_leader = True
        return True
    except OSError:
        _is_leader = False
        return False


def _release_leader() -> None:
    global _lock_file, _is_leader
    if _lock_file is not None:
        try:
            fcntl.flock(_lock_file, fcntl.LOCK_UN)
            _lock_file.close()
        except OSError:
            pass
    _lock_file = None
    _is_leader = False


async def fire_task(task: dict[str, Any], *, manual: bool = False) -> bool:
    """触发一次任务：POST {base_url}/chat/completions，max_tokens=1。

    自动触发失败按 RETRY_TIMES 重试（间隔 RETRY_INTERVAL_SECONDS）；
    手动触发只试 1 次（页面即时反馈）。2xx 即算成功（窗口点亮）。
    """
    start = time.monotonic()
    attempts = 0
    last_code: int | None = None
    last_error = ""
    ok = False

    # 手动触发只试 1 次（页面即时反馈）；自动触发失败按 RETRY_TIMES 重试
    total_tries = 1 if manual else (RETRY_TIMES + 1)
    for attempt in range(total_tries):
        attempts = attempt + 1
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                resp = await client.post(
                    f"{task['base_url']}/chat/completions",
                    headers={"Authorization": f"Bearer {task['api_key']}"},
                    json={
                        "model": task["model"],
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 1,
                    },
                )
            last_code = resp.status_code
            if 200 <= resp.status_code < 300:
                ok = True
                last_error = ""
                break
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except Exception as exc:  # 网络/超时/DNS 等
            last_error = f"{type(exc).__name__}: {exc}"
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


def _mark_missed_once() -> None:
    """首轮扫描：启用任务今天已过触发点且无任何记录 → 记 missed（按日幂等）。"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    for task in store.list_tasks():
        if not task["enabled"] or task["time"] >= now_hhmm:
            continue
        if store.has_record_today(task["id"], date_str):
            continue
        store.record_history(
            task["id"], task["name"], "missed",
            fired_at=now.strftime("%Y-%m-%d %H:%M:%S"),
            error="进程重启/停机错过当日触发点，可在页面手动补触发",
        )


def _scan_and_dispatch() -> None:
    """对表：到点且当日未触发的任务派发 fire_task（不等待完成）。"""
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    for task in store.enabled_tasks_with_key():
        if task["time"] != now_hhmm:
            continue
        key = (task["id"], date_str)
        if key in _inflight or store.has_record_today(task["id"], date_str, statuses=("success",)):
            continue
        _inflight.add(key)
        asyncio.get_running_loop().create_task(_fire_and_release(task, date_str))


async def _fire_and_release(task: dict[str, Any], date_str: str) -> None:
    try:
        await fire_task(task)
    finally:
        _inflight.discard((task["id"], date_str))


def _seconds_to_next_minute() -> float:
    now = datetime.now()
    nxt = (now + timedelta(minutes=1)).replace(second=0, microsecond=0)
    return max(0.5, (nxt - now).total_seconds())


async def _loop() -> None:
    last_cleanup_date = ""
    aligned = False
    while True:
        try:
            if _try_acquire_leader():
                if not aligned:
                    # 启动后先对齐到整分再首轮扫描，避免启动瞬间半分钟内的奇怪状态
                    aligned = True
                    _mark_missed_once()
                _scan_and_dispatch()
                today = datetime.now().strftime("%Y-%m-%d")
                if today != last_cleanup_date:
                    store.cleanup_history()
                    last_cleanup_date = today
            else:
                aligned = False   # leader 掉线后重新接管时要重跑 missed 检查
        except Exception:
            # 单轮异常不终止循环；打出日志便于 journalctl 排查（不含敏感数据）
            import logging

            logging.getLogger("uvicorn.error").exception("trigger 调度单轮异常")
        await asyncio.sleep(_seconds_to_next_minute())


def start() -> None:
    """lifespan 启动时调用：拉起调度循环（幂等）。"""
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
    _release_leader()
