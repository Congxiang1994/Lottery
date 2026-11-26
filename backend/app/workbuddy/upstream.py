"""WorkBuddy 上游客户端（只读为主，写操作仅签到）。

契约逐字对齐 dingminhua/dsh-connect-workbuddy v5.x（src/oauth.ts / upstream.ts）：
- OAuth：POST /v2/plugin/auth/state → GET /v2/plugin/auth/token → GET /v2/plugin/account
- 积分：POST /v2/billing/meter/get-user-resource
- 签到状态：POST /v2/billing/meter/checkin-activity-status
- 执行签到：POST /v2/billing/meter/daily-checkin
- 目录：GET /v3/config（App 身份 UA，CLI 通道是子集）
- 刷新：POST /v2/plugin/auth/token/refresh（X-Refresh-Token 头）

所有请求只发生在服务端；token 不进浏览器。
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

import requests

from app.workbuddy.config import (
    API_PREFIX,
    BILLING_PREFIX,
    CATALOG_PATH,
    HTTP_TIMEOUT_SECONDS,
    OAUTH_BASES,
    OAUTH_TIMEOUT_SECONDS,
)

log = logging.getLogger("app.workbuddy.upstream")

APP_UA = "WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0"


class UpstreamError(RuntimeError):
    pass


# ---------------------------------------------------------------- 通用 helper


def _billing_base(region: str, domain: str = "") -> str:
    if region == "cn":
        return OAUTH_BASES["cn"]
    d = (domain or "").lower()
    if "codebuddy.ai" in d:
        return "https://www.codebuddy.ai"
    return OAUTH_BASES["global"]


def _envelope(resp: requests.Response) -> dict[str, Any]:
    try:
        doc = resp.json()
    except ValueError:
        raise UpstreamError(f"上游返回非 JSON（HTTP {resp.status_code}）")
    if not isinstance(doc, dict):
        raise UpstreamError("上游响应格式异常")
    code = doc.get("code")
    if code not in (0, 200, None):
        msg = doc.get("msg") or doc.get("message") or f"上游业务错误 {code}"
        raise UpstreamError(str(msg)[:300])
    data = doc.get("data")
    return data if isinstance(data, dict) else {}


def _data_of(doc: dict) -> dict:
    data = doc.get("data")
    return data if isinstance(data, dict) else {}


def _first(source: dict, keys: list[str], default: str = "") -> str:
    for k in keys:
        v = source.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
    return default


def _expiry_ms(data: dict, abs_keys: list[str], ttl_keys: list[str]) -> int:
    for k in abs_keys:
        v = data.get(k)
        try:
            n = float(v)
            if n > 0:
                return int(n if n > 1e12 else n * 1000)
        except (TypeError, ValueError):
            pass
    for k in ttl_keys:
        v = data.get(k)
        try:
            n = float(v)
            if n > 0:
                return int(__import__("time").time() * 1000 + n * 1000)
        except (TypeError, ValueError):
            pass
    return 0


# ---------------------------------------------------------------- OAuth 扫码登录


def oauth_start(region: str, explicit_base: str = "") -> dict[str, Any]:
    base = _billing_base(region, explicit_base if region == "global" else "")
    try:
        resp = requests.post(
            f"{base}{API_PREFIX}/auth/state",
            params={"platform": "workbuddy"},
            json={},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=OAUTH_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        raise UpstreamError(f"无法连接登录服务 {base}：{e.__class__.__name__}")
    data = _data_of(_envelope(resp))
    state = _first(data, ["state", "State"])
    if not state:
        raise UpstreamError("登录服务未返回 state")
    url = _first(data, ["authUrl", "auth_url", "url", "Url"]) or f"{base}/login?state={state}"
    return {
        "state": state,
        "base": base,
        "verificationUri": url,
        "expiresIn": 600,
    }


def oauth_poll(session: dict[str, Any]) -> dict[str, Any] | None:
    """返回 None 表示尚未完成；完成返回可入库的账号字典。"""
    try:
        resp = requests.get(
            f"{session['base']}{API_PREFIX}/auth/token",
            params={"state": session["state"]},
            headers={"Accept": "application/json"},
            timeout=OAUTH_TIMEOUT_SECONDS,
        )
        doc = resp.json()
    except (requests.RequestException, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("code") not in (0, 200):
        return None
    data = _data_of(doc)
    access = _first(data, ["accessToken", "access_token", "AccessToken"])
    if not access:
        return None
    domain = _first(data, ["domain", "Domain"])
    headers = {"Authorization": f"Bearer {access}", "Accept": "application/json"}
    if domain:
        headers["X-Domain"] = domain
    profile: dict[str, Any] = {}
    for path in (f"{API_PREFIX}/account", f"{API_PREFIX}/login/account"):
        try:
            r = requests.get(session["base"] + path, headers=headers, timeout=HTTP_TIMEOUT_SECONDS)
            candidate = _data_of(_envelope(r))
            if _first(candidate, ["uid", "Uid", "userId", "UserID"]):
                profile = candidate
                break
        except (requests.RequestException, UpstreamError):
            continue
    jwt = _jwt_identity(access)
    uid = _first(profile, ["uid", "Uid", "userId", "UserID"]) or jwt.get("sub", "")
    if not uid:
        raise UpstreamError("无法识别这个账号：上游没有返回账号资料，登录令牌里也没有可用的身份信息")
    nickname = (
        _first(profile, ["nickname", "NickName", "ScreenName"])
        or jwt.get("nickname", "")
        or jwt.get("preferred_username", "")
    )
    return {
        "accessToken": access,
        "refreshToken": _first(data, ["refreshToken", "refresh_token", "RefreshToken"]),
        "expiresAtMs": _expiry_ms(data, ["expiresAt", "expires_at"], ["expiresIn", "expires_in"]),
        "refreshExpiresAtMs": _expiry_ms(
            data, ["refreshExpiresAt", "refresh_expires_at"], ["refreshExpiresIn", "refresh_expires_in"]
        ) or None,
        "domain": domain or _first(profile, ["domain", "Domain"]),
        "uid": uid,
        "nickname": nickname,
        "uin": _first(profile, ["uin", "Uin"]) or jwt.get("uin", ""),
        "enterpriseId": _first(profile, ["enterpriseId", "EnterpriseId"]),
    }


def _jwt_identity(token: str) -> dict[str, str]:
    try:
        parts = token.split(".")
        raw = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(raw))
        return {
            "sub": _first(payload, ["sub", "Sub"]),
            "nickname": _first(payload, ["nickname"]),
            "uin": _first(payload, ["uin"]),
            "preferred_username": _first(payload, ["preferred_username", "preferredUsername"]),
        }
    except Exception:
        return {}


# ---------------------------------------------------------------- 凭据刷新


def refresh_token(cred: dict[str, Any]) -> dict[str, Any]:
    domain = cred.get("domain", "")
    region = cred.get("region", "cn")
    base = _billing_base(region, domain)
    try:
        resp = requests.post(
            f"{base}{API_PREFIX}/auth/token/refresh",
            headers={
                "X-Refresh-Token": cred.get("refresh_token", ""),
                "X-Auth-Refresh-Source": "workbuddy",
                "Accept": "application/json",
            },
            json={},
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        data = _data_of(_envelope(resp))
    except requests.RequestException as e:
        raise UpstreamError(f"刷新凭据失败：{e.__class__.__name__}")
    access = _first(data, ["accessToken", "access_token"])
    if not access:
        raise UpstreamError("刷新凭据未返回 accessToken")
    return {
        "access_token": access,
        "refresh_token": _first(data, ["refreshToken", "refresh_token"]) or cred.get("refresh_token", ""),
        "expiresAtMs": _expiry_ms(data, ["expiresAt", "expires_at"], ["expiresIn", "expires_in"]),
        "domain": _first(data, ["domain"]) or domain,
    }


# ---------------------------------------------------------------- 积分 / 签到


def _billing_headers(cred: dict[str, Any]) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {cred['access_token']}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": APP_UA,
        "X-Requested-With": "XMLHttpRequest",
    }
    if cred.get("domain"):
        h["X-Domain"] = cred["domain"]
    return h


def fetch_credits(cred: dict[str, Any]) -> dict[str, Any]:
    """只读积分查询；返回 {total, expiringSoon, nearestExpiryMs}。"""
    base = _billing_base(cred.get("region", "cn"), cred.get("domain", ""))
    now = datetime.now()
    payload = {
        "PageNumber": 1,
        "PageSize": 100,
        "ProductCode": "p_tcaca",
        "Status": [0, 3],
        "PackageEndTimeRangeBegin": now.strftime("%Y-%m-%d %H:%M:%S"),
        "PackageEndTimeRangeEnd": (now + timedelta(days=365 * 101)).strftime("%Y-%m-%d %H:%M:%S"),
    }
    resp = requests.post(
        f"{base}{BILLING_PREFIX}/get-user-resource",
        json=payload,
        headers=_billing_headers(cred),
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    data = _envelope(resp)
    accounts = ((data.get("Response") or {}).get("Data") or {}).get("Accounts") or []
    total, expiring, nearest = 0.0, 0.0, 0
    for row in accounts:
        if not isinstance(row, dict):
            continue
        remain = row.get("CycleCapacityRemainPrecise") or row.get("CycleCapacityRemain") or 0
        cap = row.get("CapacityRemainPrecise") or row.get("CapacityRemain") or remain
        try:
            val = float(cap or 0)
        except (TypeError, ValueError):
            val = 0.0
        total += val
        end = str(row.get("ExpiredTime") or row.get("CycleEndTime") or "")
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", end)
        if m:
            try:
                ts = int(datetime.strptime(" ".join(m.groups()[:3]) + " " + ":".join(m.groups()[3:]), "%Y-%m-%d %H:%M:%S").timestamp() * 1000)
                if not nearest or ts < nearest:
                    nearest = ts
                if 0 < ts - int(now.timestamp() * 1000) < 3 * 86400 * 1000:
                    expiring += val
            except ValueError:
                pass
    return {"total": round(total, 2), "expiringSoon": round(expiring, 2), "nearestExpiryMs": nearest or None}


def checkin_status(cred: dict[str, Any]) -> dict[str, Any]:
    base = _billing_base(cred.get("region", "cn"), cred.get("domain", ""))
    resp = requests.post(
        f"{base}{BILLING_PREFIX}/checkin-activity-status",
        json={},
        headers=_billing_headers(cred),
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    data = _envelope(resp)
    return {
        "active": bool(data.get("active")),
        "todayCheckedIn": bool(data.get("today_checked_in")),
        "streakDays": data.get("streak_days") or 0,
        "todayCredit": data.get("today_credit") or 0,
    }


def do_checkin(cred: dict[str, Any]) -> dict[str, Any]:
    base = _billing_base(cred.get("region", "cn"), cred.get("domain", ""))
    resp = requests.post(
        f"{base}{BILLING_PREFIX}/daily-checkin",
        json={},
        headers=_billing_headers(cred),
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    data = _envelope(resp)
    return {"credit": data.get("credit") or 0, "streakDays": data.get("streak_days") or 0}


# ---------------------------------------------------------------- 模型目录


def fetch_catalog(cred: dict[str, Any]) -> list[dict[str, Any]]:
    base = _billing_base(cred.get("region", "cn"), cred.get("domain", ""))
    h = _billing_headers(cred)
    h["User-Agent"] = APP_UA
    h["Origin"] = base
    h["Referer"] = base + "/"
    h["X-Product"] = "SaaS"
    h["Connection"] = "close"
    resp = requests.get(base + CATALOG_PATH, headers=h, timeout=HTTP_TIMEOUT_SECONDS)
    data = _envelope(resp)
    rows = data.get("models") or []
    promos = data.get("modelPromotions") or []
    tiers = data.get("modelTiers") or []
    out = []
    for row in rows:
        if not isinstance(row, dict) or row.get("disabled"):
            continue
        name = _first(row, ["name", "Name"])
        credits = str(row.get("credits") or "")
        m = re.search(r"x\s*([0-9]*\.?[0-9]+)", credits)
        multiplier = float(m.group(1)) if m else None
        reasoning = row.get("reasoning") or {}
        efforts = reasoning.get("supportedEfforts") if isinstance(reasoning, dict) else None
        if not efforts and isinstance(reasoning, dict):
            e = reasoning.get("effort")
            efforts = [e] if e else []
        out.append({
            "id": _first(row, ["id", "modelId"]),
            "name": name,
            "description": _first(row, ["descriptionZh", "description", "descriptionEn"]),
            "contextWindow": row.get("maxInputTokens") or 0,
            "maxTokens": row.get("maxOutputTokens") or 0,
            "creditMultiplier": multiplier,
            "supportsImages": bool(row.get("supportsImages")) and not row.get("disabledMultimodal"),
            "efforts": efforts or [],
            "promo": next((p for p in promos if isinstance(p, dict) and name and name in str(p)), None),
        })
    return [m for m in out if m["id"]]
