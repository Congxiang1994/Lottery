"""触发器 API 路由（/api/trigger）。

认证模型：POST /auth 校验密码（含流控）→ 签发 httpOnly cookie（12h）；
除 /auth 与 /session 外，全部接口校验 cookie，无效 → 401。
api_key 永不出现在任何响应里（只回脱敏尾 4 位）。
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, HTTPException, Response

from app.trigger import scheduler, store
from app.trigger.config import (
    COOKIE_NAME,
    SESSION_TTL_SECONDS,
    VERIFY_PASSWORD,
    sign_session,
    verify_session,
)
from app.trigger.store import has_record_today

router = APIRouter(prefix="/api/trigger", tags=["trigger"])


# ------------------------------------------------------------ 认证


def _require_session(trigger_session: str | None) -> None:
    if not verify_session(trigger_session):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


def _issue_cookie(response: Response) -> None:
    expires_at = datetime.now().timestamp() + SESSION_TTL_SECONDS
    response.set_cookie(
        key=COOKIE_NAME,
        value=sign_session(expires_at),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )


@router.post("/auth")
def auth(payload: dict, response: Response):
    """密码校验 + 流控（复用彩票 verify-password 的 1 次/秒全局流控）。"""
    from app.lottery.services import results_store

    password = str(payload.get("password", ""))
    ok, msg, status = results_store.verify_password(password, VERIFY_PASSWORD)
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    _issue_cookie(response)
    return {"ok": True, "message": "验证通过", "ttl_hours": SESSION_TTL_SECONDS // 3600}


@router.get("/session")
def session_status(trigger_session: str | None = Cookie(default=None)):
    """前端判断会话是否有效（有效 → 直接进功能页，免重复输密码）。"""
    return {"valid": verify_session(trigger_session)}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


# ------------------------------------------------------------ 任务 CRUD


def _validate(data: dict) -> None:
    name = str(data.get("name", "")).strip()
    hhmm = str(data.get("time", "")).strip()
    base_url = str(data.get("base_url", "")).strip()
    api_key = str(data.get("api_key", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="任务名称不能为空")
    try:
        hh, mm = hhmm.split(":")
        if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="触发时刻格式应为 HH:MM")
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Base URL 必须以 http(s):// 开头")
    if not api_key:
        raise HTTPException(status_code=422, detail="api-key 不能为空")


@router.get("/tasks")
def list_tasks(trigger_session: str | None = Cookie(default=None)):
    _require_session(trigger_session)
    tasks = store.list_tasks()
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    for t in tasks:
        t["fired_today"] = has_record_today(t["id"], today, statuses=("success", "failing"))
        # 下次触发：今天还没到点 → 今天该时刻；已过 → 明天
        if t["time"] > now_hhmm:
            t["next_fire"] = f"{today} {t['time']}"
        else:
            nxt = datetime.strptime(f"{today} {t['time']}", "%Y-%m-%d %H:%M") + timedelta(days=1)
            t["next_fire"] = nxt.strftime("%Y-%m-%d %H:%M")
    return tasks


@router.post("/tasks")
def create_task(payload: dict, trigger_session: str | None = Cookie(default=None)):
    _require_session(trigger_session)
    _validate(payload)
    return store.create_task(payload)


@router.put("/tasks/{task_id}")
def update_task(task_id: int, payload: dict, trigger_session: str | None = Cookie(default=None)):
    _require_session(trigger_session)
    if store.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    # api_key 为空表示保留原值，验证时用占位符绕过非空检查
    check = dict(payload)
    if not str(check.get("api_key", "")).strip():
        check["api_key"] = "keep-placeholder"
    _validate(check)
    return store.update_task(task_id, payload)


@router.put("/tasks/{task_id}/enabled")
def toggle_task(task_id: int, payload: dict, trigger_session: str | None = Cookie(default=None)):
    _require_session(trigger_session)
    if store.get_task(task_id) is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return store.set_enabled(task_id, bool(payload.get("enabled", True)))


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, trigger_session: str | None = Cookie(default=None)):
    _require_session(trigger_session)
    if not store.delete_task(task_id):
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"ok": True}


# ------------------------------------------------------------ 触发与历史


@router.post("/tasks/{task_id}/fire")
async def fire_now(task_id: int, trigger_session: str | None = Cookie(default=None)):
    """手动立即触发（单次尝试、无重试，页面即时反馈）。"""
    _require_session(trigger_session)
    task = store.get_task(task_id, with_key=True)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    ok = await scheduler.fire_task(task, manual=True)
    if not ok:
        raise HTTPException(status_code=502, detail="触发失败，详情见执行历史")
    return {"ok": True}


@router.get("/history")
def history(limit: int = 100, trigger_session: str | None = Cookie(default=None)):
    _require_session(trigger_session)
    return store.list_history(limit)


@router.get("/status")
def status(trigger_session: str | None = Cookie(default=None)):
    """今日统计 + 下次触发时刻。"""
    _require_session(trigger_session)
    tasks = store.list_tasks()
    enabled = [t for t in tasks if t["enabled"]]
    today = datetime.now().strftime("%Y-%m-%d")
    fired = [t for t in enabled if has_record_today(t["id"], today, statuses=("success", "failing"))]
    next_fire = None
    now_hhmm = datetime.now().strftime("%H:%M")
    candidates = sorted(t["time"] for t in enabled if t["time"] > now_hhmm)
    if candidates:
        next_fire = f"{today} {candidates[0]}"
    elif enabled:
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        next_fire = f"{tomorrow} {min(t['time'] for t in enabled)}"
    return {
        "tasks_total": len(tasks),
        "tasks_enabled": len(enabled),
        "fired_today": len(fired),
        "next_fire": next_fire,
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
