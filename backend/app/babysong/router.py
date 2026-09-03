"""Super Simple Songs 儿歌列表 + 本地下载管理接口。"""
from __future__ import annotations

import json
import time as _time
from pathlib import Path

from fastapi import APIRouter, Cookie, HTTPException, Response

from app.babysong import downloads
from app.trigger.config import sign_session, verify_session

router = APIRouter(prefix="/api/babysong", tags=["babysong"])

# 儿歌目录（由上游 518 首元数据裁剪生成：id / title / channel / youtube_url / cover）
CATALOG = Path(__file__).resolve().parent / "data" / "catalog.json"

# 管理会话 cookie：与触发器同一签名密钥（同一把操作密码），cookie 名独立
ADMIN_COOKIE = "babysong_session"
SESSION_TTL_SECONDS = 12 * 3600


def _load_catalog() -> list:
    if not CATALOG.is_file():
        return []
    try:
        with open(CATALOG, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


@router.get("/list")
def list_songs():
    """返回儿歌列表（按编号升序），附带本地文件标记，供前端卡片网格展示与检索。"""
    songs = _load_catalog()
    local_ids = downloads.local_song_ids()
    for s in songs:
        if s.get("id") in local_ids:
            s["local"] = True
            s["local_url"] = f"/song/{s['id']}.mp4"
    return {"total": len(songs), "local_total": len(local_ids), "songs": songs}


# ------------------------------------------------------------ 管理端（密码保护）


def _require_session(admin_session: str | None) -> None:
    if not verify_session(admin_session):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


@router.post("/admin/auth")
def admin_auth(payload: dict, response: Response):
    """密码校验（复用操作密码 + 1 次/秒全局流控）→ 签发 12h httpOnly cookie。"""
    from app.lottery.services import results_store

    password = str(payload.get("password", ""))
    ok, msg, status = results_store.verify_password(password)
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    expires_at = _time.time() + SESSION_TTL_SECONDS
    response.set_cookie(
        key=ADMIN_COOKIE,
        value=sign_session(expires_at),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )
    return {"ok": True, "message": "验证通过", "ttl_hours": SESSION_TTL_SECONDS // 3600}


@router.get("/admin/session")
def admin_session_status(babysong_session: str | None = Cookie(default=None)):
    return {"valid": verify_session(babysong_session)}


@router.post("/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE, path="/")
    return {"ok": True}


@router.get("/admin/downloads")
def admin_downloads(babysong_session: str | None = Cookie(default=None)):
    """全部歌曲的下载状态：本地文件为准（done），其余取任务库（downloading/pending/failed/none）。"""
    _require_session(babysong_session)
    catalog = {s["id"]: s for s in _load_catalog() if s.get("id")}
    local_ids = downloads.local_song_ids()
    tasks = {t["id"]: t for t in downloads.snapshot()}

    items = []
    for sid, song in catalog.items():
        has_file = sid in local_ids
        t = tasks.get(sid)
        if has_file:
            status = "done"
        elif t and t["status"] in ("downloading", "pending", "failed"):
            status = t["status"]
        else:
            status = "none"
        items.append(
            {
                "id": sid,
                "title": song.get("title", ""),
                "youtube_url": song.get("youtube_url", ""),
                "status": status,
                "has_file": has_file,
                "size_bytes": t.get("size_bytes", 0) if t else 0,
                "duration_s": t.get("duration_s", 0) if t else 0,
                "error": t.get("error", "") if t else "",
                "updated_at": t.get("updated_at", "") if t else "",
            }
        )
    counts = {
        "total": len(items),
        "done": sum(1 for x in items if x["status"] == "done"),
        "downloading": sum(1 for x in items if x["status"] == "downloading"),
        "pending": sum(1 for x in items if x["status"] == "pending"),
        "failed": sum(1 for x in items if x["status"] == "failed"),
        "none": sum(1 for x in items if x["status"] == "none"),
    }
    return {"counts": counts, "busy": downloads.is_busy(), "items": items}


@router.post("/admin/download")
def admin_download(payload: dict, babysong_session: str | None = Cookie(default=None)):
    """把指定歌曲加入下载队列（后台串行下载，轮询 /admin/downloads 看进度）。"""
    _require_session(babysong_session)
    ids = payload.get("ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="缺少 ids")
    catalog = {s.get("id"): s.get("youtube_url", "") for s in _load_catalog()}
    valid = [str(i) for i in ids if i in catalog]
    if not valid:
        raise HTTPException(status_code=400, detail="未找到有效的歌曲编号")
    n = downloads.enqueue(valid, lambda sid: catalog[sid])
    return {"ok": True, "queued": n}
