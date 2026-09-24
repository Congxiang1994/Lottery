"""睡前故事 API 路由（/api/story）。

三条互不干扰的通道：

A. **公开只读** ``GET /list`` ``GET /item/{id}``
   无鉴权，SQL 层硬过滤 ``published=1``（草稿永不出现在公开通道）。

B. **管理会话** ``/admin/*``
   POST /admin/auth 校验密码（复用彩票那把操作密码 + 防爆破锁定）→ 签发 12h httpOnly
   cookie（名 ``story_session``，与触发器/儿歌同签名密钥、独立 cookie）。其余接口校验该 cookie。

C. **外部 API** ``/v1/*``
   ``X-API-Key`` 鉴权；配额校验与计数自增在 store.authenticate_key 内**一条 SQL 原子完成**。
   调用明细由 v1_call_logger 中间件统一落日志（只对本前缀生效，不碰其他路由）。
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response

from app.story import apidoc, store
from app.story.config import (
    COOKIE_NAME,
    MAX_CONTENT_LEN,
    MAX_SUMMARY_LEN,
    MAX_TAGS_LEN,
    MAX_TITLE_LEN,
    MAX_URL_LEN,
    SESSION_TTL_SECONDS,
)
from app.trigger.config import sign_session, verify_session

router = APIRouter(prefix="/api/story", tags=["story"])

KEY_HEADER = "X-API-Key"


def _client_ip(request: Request) -> str:
    """真实来源 IP：nginx 已设 X-Forwarded-For，直连时回退到 socket 对端。"""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


# ------------------------------------------------------------ 工具：校验


def _validate_date(raw: str) -> str:
    try:
        return datetime.strptime(raw, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="story_date 格式应为 YYYY-MM-DD")


def _validate_story(payload: dict[str, Any], *, partial: bool) -> dict[str, Any]:
    """校验并归一化故事入参。partial=True 时只处理传入的字段（PUT 部分更新）。"""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="请求体必须是 JSON 对象")
    if isinstance(payload.get("tags"), (list, tuple)):
        payload = {**payload, "tags": ",".join(str(x) for x in payload["tags"])}

    out: dict[str, Any] = {}

    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="title 不能为空")
        if len(title) > MAX_TITLE_LEN:
            raise HTTPException(status_code=422, detail=f"title 超过 {MAX_TITLE_LEN} 字")
        out["title"] = title

    if not partial or "content" in payload:
        content = str(payload.get("content") or "").strip()
        if not content:
            raise HTTPException(status_code=422, detail="content 不能为空")
        if len(content) > MAX_CONTENT_LEN:
            raise HTTPException(status_code=422, detail=f"content 超过 {MAX_CONTENT_LEN} 字")
        out["content"] = content

    if not partial or "story_date" in payload:
        raw_date = str(payload.get("story_date") or "").strip() or datetime.now().strftime(
            "%Y-%m-%d"
        )
        out["story_date"] = _validate_date(raw_date)

    for field, limit in (
        ("summary", MAX_SUMMARY_LEN),
        ("tags", MAX_TAGS_LEN),
        ("audio_url", MAX_URL_LEN),
        ("cover_url", MAX_URL_LEN),
    ):
        if field in payload:
            value = str(payload.get(field) or "").strip()
            if len(value) > limit:
                raise HTTPException(status_code=422, detail=f"{field} 超过 {limit} 字")
            out[field] = value

    if "published" in payload:
        out["published"] = bool(payload["published"])
    elif not partial:
        out["published"] = True

    return out


def _parse_published(raw: str | None) -> str:
    """把 query 里的 published 归一化成 store 的过滤值："" 不限 / "1" 已发布 / "0" 草稿。"""
    if raw is None or raw == "" or raw.lower() == "true":
        return "1"
    if raw.lower() == "false":
        return "0"
    if raw.lower() == "all":
        return ""
    raise HTTPException(status_code=422, detail="published 只能是 true / false / all")


# ------------------------------------------------------------ 通道 A：公开只读


@router.get("/list")
def public_list(
    limit: int = 20,
    offset: int = 0,
    q: str = "",
    date_from: str = "",
    date_to: str = "",
):
    """故事列表（按日期倒序）。**只返回已发布**，草稿在 SQL 层就被过滤掉。"""
    return store.list_stories(
        published="1",
        limit=limit,
        offset=offset,
        q=q.strip(),
        date_from=date_from.strip(),
        date_to=date_to.strip(),
    )


@router.get("/item/{story_id}")
def public_item(story_id: int):
    """单篇全文（仅已发布）。"""
    story = store.get_story(story_id, published="1")
    if story is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    return story


# ------------------------------------------------------------ 通道 B：管理会话


def _require_session(story_session: str | None) -> None:
    if not verify_session(story_session):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


@router.post("/admin/auth")
def admin_auth(payload: dict, response: Response):
    """密码校验（复用操作密码 + 失败递增锁定）→ 签发 12h httpOnly cookie。"""
    from app.lottery.services import results_store

    password = str(payload.get("password", ""))
    ok, msg, status = results_store.verify_password(password)
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    response.set_cookie(
        key=COOKIE_NAME,
        value=sign_session(time.time() + SESSION_TTL_SECONDS),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )
    return {"ok": True, "message": "验证通过", "ttl_hours": SESSION_TTL_SECONDS // 3600}


@router.get("/admin/session")
def admin_session(story_session: str | None = Cookie(default=None)):
    return {"valid": verify_session(story_session)}


@router.post("/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/admin/stories")
def admin_list_stories(
    limit: int = 50,
    offset: int = 0,
    q: str = "",
    published: str = "",
    story_session: str | None = Cookie(default=None),
):
    """管理页列表：含草稿、含全文。published 可传 0/1 过滤。"""
    _require_session(story_session)
    state = "" if published in ("", "all") else _parse_published(published)
    return store.list_stories(
        published=state, limit=limit, offset=offset, q=q.strip()
    )


@router.post("/admin/stories")
def admin_create_story(payload: dict, story_session: str | None = Cookie(default=None)):
    _require_session(story_session)
    return store.create_story(_validate_story(payload, partial=False), source="manual")


@router.put("/admin/stories/{story_id}")
def admin_update_story(
    story_id: int, payload: dict, story_session: str | None = Cookie(default=None)
):
    _require_session(story_session)
    if store.get_story(story_id) is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    updated = store.update_story(story_id, _validate_story(payload, partial=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    return updated


@router.put("/admin/stories/{story_id}/published")
def admin_set_published(
    story_id: int, payload: dict, story_session: str | None = Cookie(default=None)
):
    _require_session(story_session)
    updated = store.set_published(story_id, bool(payload.get("published", True)))
    if updated is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    return updated


@router.delete("/admin/stories/{story_id}")
def admin_delete_story(story_id: int, story_session: str | None = Cookie(default=None)):
    _require_session(story_session)
    if not store.delete_story(story_id):
        raise HTTPException(status_code=404, detail="故事不存在")
    return {"ok": True}


@router.get("/admin/keys")
def admin_list_keys(story_session: str | None = Cookie(default=None)):
    """密钥列表。**含明文密钥**（用户选定策略：本功能只用于管理家里的故事）。"""
    _require_session(story_session)
    return {"keys": store.list_keys(), "summary": store.calls_summary()}


@router.post("/admin/keys")
def admin_create_key(payload: dict, story_session: str | None = Cookie(default=None)):
    _require_session(story_session)
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="密钥名称不能为空")
    if len(name) > 60:
        raise HTTPException(status_code=422, detail="密钥名称过长")
    return store.create_key({**payload, "name": name})


@router.put("/admin/keys/{key_id}")
def admin_update_key(
    key_id: int, payload: dict, story_session: str | None = Cookie(default=None)
):
    _require_session(story_session)
    if store.get_key(key_id) is None:
        raise HTTPException(status_code=404, detail="密钥不存在")
    updated = store.update_key(key_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="密钥不存在")
    return updated


@router.put("/admin/keys/{key_id}/enabled")
def admin_toggle_key(
    key_id: int, payload: dict, story_session: str | None = Cookie(default=None)
):
    _require_session(story_session)
    updated = store.set_key_enabled(key_id, bool(payload.get("enabled", True)))
    if updated is None:
        raise HTTPException(status_code=404, detail="密钥不存在")
    return updated


@router.post("/admin/keys/{key_id}/reset-calls")
def admin_reset_key_calls(
    key_id: int, payload: dict, story_session: str | None = Cookie(default=None)
):
    """重置调用计数：scope=today（默认）只清今日；scope=all 清今日与累计。"""
    _require_session(story_session)
    scope = str(payload.get("scope") or "today")
    if scope not in ("today", "all"):
        raise HTTPException(status_code=422, detail="scope 只能是 today / all")
    updated = store.reset_key_calls(key_id, scope)
    if updated is None:
        raise HTTPException(status_code=404, detail="密钥不存在")
    return updated


@router.delete("/admin/keys/{key_id}")
def admin_delete_key(key_id: int, story_session: str | None = Cookie(default=None)):
    _require_session(story_session)
    if not store.delete_key(key_id):
        raise HTTPException(status_code=404, detail="密钥不存在")
    return {"ok": True}


@router.get("/admin/calls")
def admin_calls(
    limit: int = 50,
    key_id: int | None = None,
    story_session: str | None = Cookie(default=None),
):
    _require_session(story_session)
    store.cleanup_calls()
    return {"calls": store.list_calls(limit, key_id), "summary": store.calls_summary()}


@router.get("/admin/api-doc")
def admin_api_doc(story_session: str | None = Cookie(default=None)):
    """对外 API 的接口定义与调用样例（页面直接渲染，避免文档漂移）。"""
    _require_session(story_session)
    return {
        "auth_header": KEY_HEADER,
        "base_path": "/api/story/v1",
        "endpoints": apidoc.ENDPOINTS,
        "story_fields": apidoc.STORY_FIELDS,
        "status_codes": apidoc.STATUS_CODES,
        "curl_samples": apidoc.CURL_SAMPLES,
        "python_sample": apidoc.PY_SAMPLE,
        "limits": {
            "title": MAX_TITLE_LEN,
            "content": MAX_CONTENT_LEN,
            "summary": MAX_SUMMARY_LEN,
            "tags": MAX_TAGS_LEN,
            "url": MAX_URL_LEN,
        },
    }


# ------------------------------------------------------------ 通道 C：外部 API


def require_key(
    request: Request,
    x_api_key: Annotated[str | None, Header(alias=KEY_HEADER)] = None,
) -> dict[str, Any]:
    """校验 X-API-Key + 扣配额。失败分支不写调用日志（防被扫描刷爆日志表）。"""
    result, key = store.authenticate_key(x_api_key or "", ip=_client_ip(request))
    if result == "invalid":
        raise HTTPException(status_code=401, detail=f"缺少或无效的 {KEY_HEADER}")
    if result == "disabled":
        request.state.story_key = key
        raise HTTPException(status_code=403, detail="该 API 密钥已停用")
    if result == "quota":
        request.state.story_key = key
        raise HTTPException(
            status_code=429,
            detail=f"调用次数已达上限（今日 {key['calls_today']}/{key['daily_quota'] or '不限'}，"
            f"累计 {key['calls_total']}/{key['total_quota'] or '不限'}）",
        )
    request.state.story_key = key
    return key  # type: ignore[return-value]


KeyDep = Annotated[dict[str, Any], Depends(require_key)]


async def v1_call_logger(request: Request, call_next):
    """只对 /api/story/v1/ 前缀记录调用明细，其他路由零影响。"""
    if not request.url.path.startswith("/api/story/v1/"):
        return await call_next(request)
    start = time.perf_counter()
    response = await call_next(request)
    try:
        key = getattr(request.state, "story_key", None)
        store.record_call(
            key_id=key["id"] if key else None,
            key_name=key["name"] if key else "",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            latency_ms=round((time.perf_counter() - start) * 1000, 1),
            ip=_client_ip(request),
        )
    except Exception:
        pass  # 日志失败绝不影响业务响应
    return response


@router.get("/v1/stories")
def v1_list_stories(
    key: KeyDep,
    limit: int = 20,
    offset: int = 0,
    q: str = "",
    date: str = "",
    date_from: str = "",
    date_to: str = "",
    published: str | None = None,
):
    return store.list_stories(
        published=_parse_published(published),
        limit=limit,
        offset=offset,
        q=q.strip(),
        date_from=date_from.strip(),
        date_to=date_to.strip(),
        exact_date=_validate_date(date) if date.strip() else "",
    )


@router.get("/v1/stories/{story_id}")
def v1_get_story(story_id: int, key: KeyDep):
    story = store.get_story(story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    return story


@router.post("/v1/stories")
def v1_create_story(payload: dict, key: KeyDep):
    return store.create_story(
        _validate_story(payload, partial=False), source=f"api:{key['name']}"
    )


@router.put("/v1/stories/{story_id}")
def v1_update_story(story_id: int, payload: dict, key: KeyDep):
    if store.get_story(story_id) is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    updated = store.update_story(story_id, _validate_story(payload, partial=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="故事不存在")
    return updated


@router.delete("/v1/stories/{story_id}")
def v1_delete_story(story_id: int, key: KeyDep):
    if not store.delete_story(story_id):
        raise HTTPException(status_code=404, detail="故事不存在")
    return {"ok": True}


@router.get("/v1/me")
def v1_me(key: KeyDep):
    """本密钥的启用状态与用量自检，供外部脚本避免撞 429。"""
    return {
        "name": key["name"],
        "enabled": key["enabled"],
        "daily_quota": key["daily_quota"],
        "total_quota": key["total_quota"],
        "calls_today": key["calls_today"],
        "calls_total": key["calls_total"],
        "last_used_at": key["last_used_at"],
    }
