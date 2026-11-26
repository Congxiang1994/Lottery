"""WorkBuddy 账号管理 API（/api/workbuddy）。

认证：与全站私有功能同密码的 httpOnly 会话（app.common.admin）。
浏览器永远拿不到 token：所有上游请求在服务端发起，账号列表只含脱敏字段。
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Any

from fastapi import APIRouter, Cookie, HTTPException, Response

from app.common import admin
from app.workbuddy import store, upstream
from app.workbuddy.config import COOKIE_NAME, LOGIN_TTL_SECONDS, REGIONS, SESSION_TTL_SECONDS

log = logging.getLogger("app.workbuddy.router")

router = APIRouter(prefix="/api/workbuddy", tags=["workbuddy"])

_require = admin.require

#: 扫码会话（进程内，不落盘；重启即失效，与参考项目一致）
_sessions: dict[str, dict[str, Any]] = {}
_sessions_lock = threading.Lock()


def _check_region(region: str) -> str:
    if region not in REGIONS:
        raise HTTPException(422, detail="区域只能是 cn 或 global")
    return region


def _clean_sessions() -> None:
    now = time.time()
    for k in [k for k, v in _sessions.items() if v["expiresAt"] < now or v.get("done")]:
        _sessions.pop(k, None)


# ---------------------------------------------------------------- 认证三件套


@router.post("/auth")
def auth(payload: dict, response: Response):
    return admin.login(payload, response, COOKIE_NAME, SESSION_TTL_SECONDS)


@router.get("/session")
def session_status(workbuddy_session: str | None = Cookie(default=None)):
    return admin.session_state(workbuddy_session)


@router.post("/logout")
def logout(response: Response):
    return admin.logout(response, COOKIE_NAME)


# ---------------------------------------------------------------- 概览 / 账号


@router.get("/overview")
def overview(region: str = "cn", workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    _check_region(region)
    accounts = store.list_accounts(region)
    return {
        "region": region,
        "settings": store.get_settings(region),
        "accounts": accounts,
        "total": len(accounts),
        "members": sum(1 for a in accounts if a["member"]),
        "creditsTotal": round(sum(float(a.get("credits") or 0) for a in accounts), 2),
        "serverTime": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


@router.get("/accounts")
def accounts(region: str = "cn", workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    return store.list_accounts(_check_region(region))


@router.post("/accounts/{account_id}/member")
def set_member(account_id: str, payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    if not store.set_member(account_id, bool(payload.get("member", True))):
        raise HTTPException(404, detail="账号不存在")
    return {"ok": True}


@router.post("/accounts/{account_id}/current")
def set_current(account_id: str, workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    if not store.set_current(account_id):
        raise HTTPException(404, detail="账号不存在")
    return {"ok": True}


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str, workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    if not store.delete_account(account_id):
        raise HTTPException(404, detail="账号不存在")
    return {"ok": True}


@router.get("/settings")
def get_settings(region: str = "cn", workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    return store.get_settings(_check_region(region))


@router.post("/settings")
def save_settings(region: str, payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    return store.save_settings(_check_region(region), payload)


# ---------------------------------------------------------------- 扫码登录（核心）


@router.post("/oauth/start")
def oauth_start(payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    region = _check_region(str(payload.get("region") or "cn"))
    explicit = str(payload.get("base") or "")
    info = upstream.oauth_start(region, explicit)
    login_id = "wbo_" + uuid.uuid4().hex
    with _sessions_lock:
        _clean_sessions()
        _sessions[login_id] = {
            **info,
            "region": region,
            "expiresAt": time.time() + LOGIN_TTL_SECONDS,
            "done": False,
        }
    return {
        "loginId": login_id,
        "verificationUri": info["verificationUri"],
        "expiresIn": LOGIN_TTL_SECONDS,
        "region": region,
        "hint": "国内版请用 WorkBuddy App 扫描授权页二维码；国际版在打开的网页中登录即可",
    }


@router.post("/oauth/poll")
def oauth_poll(payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    _require(workbuddy_session)
    login_id = str(payload.get("loginId") or "")
    with _sessions_lock:
        session = _sessions.get(login_id)
        if not session:
            raise HTTPException(410, detail="登录会话不存在或已过期，请重新开始")
        if session["expiresAt"] < time.time():
            _sessions.pop(login_id, None)
            raise HTTPException(410, detail="登录已超时，请重新开始")
        if session.get("done"):
            return {"done": True, "accountId": session.get("accountId", ""), "nickname": session.get("nickname", "")}
    try:
        account = upstream.oauth_poll(session)
    except UpstreamError as e:
        with _sessions_lock:
            _sessions.pop(login_id, None)
        raise HTTPException(502, detail=str(e))
    if account is None:
        return {"done": False}
    # 凭据域决定最终分区（与参考项目一致：codebuddy.ai/workbuddy.ai → global）
    domain = account.get("domain") or ""
    final_region = "global" if ("workbuddy.ai" in domain or "codebuddy.ai" in domain) else "cn"
    aid = store.upsert_account(final_region, account)
    with _sessions_lock:
        session["done"] = True
        session["accountId"] = aid
        session["nickname"] = account.get("nickname") or account.get("uid", "")
    return {"done": True, "accountId": aid, "nickname": session["nickname"], "region": final_region}


# ---------------------------------------------------------------- 账号操作（只读/真实动作）


def _cred_or_404(account_id: str) -> dict[str, Any]:
    cred = store.get_credential(account_id)
    if not cred:
        raise HTTPException(404, detail="账号不存在或凭据已失效")
    return cred


@router.post("/accounts/{account_id}/refresh-cred")
def refresh_cred(account_id: str, workbuddy_session: str | None = Cookie(default=None)):
    """凭据失效时手动刷新（refresh token 不暴露给浏览器）。"""
    _require(workbuddy_session)
    cred = _cred_or_404(account_id)
    try:
        fresh = upstream.refresh_token(cred)
    except upstream.UpstreamError as e:
        raise HTTPException(502, detail=str(e))
    with __import__("app.common.db", fromlist=["get_conn"]).get_conn(store.DB_PATH) as con:
        blob = store.encrypt(json.dumps({
            "access_token": fresh["access_token"],
            "refresh_token": fresh["refresh_token"],
            "domain": fresh["domain"],
        }, ensure_ascii=False))
        con.execute("UPDATE workbuddy_accounts SET cred=?, token_expiry=?, domain=?, updated_at=CURRENT_TIMESTAMP WHERE account_id=?",
                    (blob, fresh["expiresAtMs"], fresh["domain"], account_id))
    return {"ok": True, "expiresAtMs": fresh["expiresAtMs"]}


@router.post("/accounts/{account_id}/credits")
def account_credits(account_id: str, workbuddy_session: str | None = Cookie(default=None)):
    """按账号查积分（只读，不消耗）。"""
    _require(workbuddy_session)
    cred = _cred_or_404(account_id)
    try:
        result = upstream.fetch_credits(cred)
    except upstream.UpstreamError as e:
        raise HTTPException(502, detail=str(e))
    store.save_runtime(account_id, {"credits": result["total"], "last_error": ""})
    return result


@router.post("/accounts/{account_id}/checkin")
def account_checkin(account_id: str, workbuddy_session: str | None = Cookie(default=None)):
    """单账号签到：先读状态，已签则跳过（幂等）；企业席位上游不支持。"""
    _require(workbuddy_session)
    row = store.list_accounts(include_hidden=True)
    target = next((a for a in row if a["id"] == account_id), None)
    if not target:
        raise HTTPException(404, detail="账号不存在")
    if target["enterprise"]:
        return {"status": "skipped", "message": "企业/教育版席位不支持个人签到"}
    cred = _cred_or_404(account_id)
    try:
        state = upstream.checkin_status(cred)
        if state["todayCheckedIn"]:
            store.save_runtime(account_id, {"checkin": {"status": "already", **state}})
            return {"status": "already", **state}
        result = upstream.do_checkin(cred)
        store.save_runtime(account_id, {"checkin": {"status": "claimed", **result}, "last_error": ""})
        return {"status": "claimed", **result}
    except upstream.UpstreamError as e:
        store.save_runtime(account_id, {"last_error": str(e)[:300]})
        raise HTTPException(502, detail=str(e))


@router.post("/pool/checkin")
def pool_checkin(payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    """批量签到：只处理显式勾选的账号，串行执行，单账号失败不影响其余。"""
    _require(workbuddy_session)
    ids = payload.get("accountIds") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(422, detail="请先勾选要签到的账号")
    rows = []
    for aid in ids:
        try:
            r = account_checkin(aid, workbuddy_session)
            rows.append({"accountId": aid, "status": r.get("status", "ok"), "message": str(r)})
        except HTTPException as e:
            rows.append({"accountId": aid, "status": "failed", "message": str(e.detail)})
    return {"action": "checkin", "rows": rows}


@router.post("/pool/credits")
def pool_credits(payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    """批量刷新勾选账号的积分。"""
    _require(workbuddy_session)
    ids = payload.get("accountIds") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(422, detail="请先勾选账号")
    rows = []
    for aid in ids:
        try:
            r = account_credits(aid, workbuddy_session)
            rows.append({"accountId": aid, "ok": True, "credits": r["total"]})
        except HTTPException as e:
            rows.append({"accountId": aid, "ok": False, "message": str(e.detail)})
    return {"action": "credits", "rows": rows}


# ---------------------------------------------------------------- 模型目录 / 诊断


@router.post("/catalog/refresh")
def catalog_refresh(payload: dict, workbuddy_session: str | None = Cookie(default=None)):
    """用「当前账号」拉目录；模型名册与倍率即时生效。"""
    _require(workbuddy_session)
    region = _check_region(str(payload.get("region") or "cn"))
    accs = [a for a in store.list_accounts(region) if a["current"]]
    if not accs:
        raise HTTPException(422, detail="该区域还没有当前账号，请先扫码添加或设置当前账号")
    cred = _cred_or_404(accs[0]["id"])
    try:
        models = upstream.fetch_catalog(cred)
    except upstream.UpstreamError as e:
        raise HTTPException(502, detail=str(e))
    return {"region": region, "models": models, "count": len(models), "fetchedAt": time.strftime("%Y-%m-%d %H:%M:%S")}


@router.get("/diagnostics")
def diagnostics(region: str = "cn", workbuddy_session: str | None = Cookie(default=None)):
    """只读事实表；错误原文照抄，便于整段贴进反馈。"""
    _require(workbuddy_session)
    _check_region(region)
    accs = store.list_accounts(region)
    current = next((a for a in accs if a["current"]), None)
    return {
        "region": region,
        "upstreamBase": upstream._billing_base(region),
        "accountCount": len(accs),
        "memberCount": sum(1 for a in accs if a["member"]),
        "currentAccount": current["nickname"] if current else "（未设置）",
        "currentExpiry": current.get("token_expiry") if current else 0,
        "settings": store.get_settings(region),
        "serverTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "recentErrors": [a["last_error"] for a in accs if a.get("last_error")][:5],
    }


# 让 HTTPException 在批量循环外也保持统一（UpstreamError 别名，便于上层 except）
UpstreamError = upstream.UpstreamError
