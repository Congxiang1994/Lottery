"""什么值得买捡漏 API（/api/deals）。

两条通道：

A. **公开只读** ``GET /list`` ``GET /stats``
   无鉴权，SQL 层硬过滤 ``picked=1`` —— 未达阈值的好价永远不出现在公开页。

B. **管理会话** ``/admin/*``
   复用全站操作密码（与彩票/触发器/故事同一把），密码校验通过后签发 12h
   httpOnly cookie（名 ``deals_session``）。阈值、关注品类、加权系数都在这条通道里改。

关于登录 Cookie（2026-10-29 起管理页不再暴露）
---------------------------------------------
结论先行：**好价列表页匿名可读，Cookie 目前不是必需品**。线上匿名跑过数小时、
每轮 5 页、零风控，所以管理页放一个「怎么拿 Cookie」的区块纯属误导 ——
用户会以为不配就不能用，而真实代价是把家宽登录态搬到机房 IP（站方可能
提示异地登录，极端情况会挤掉本机会话）。

因此 UI 入口已删除，但后端三条能力保留，作为被风控掐死时的逃生通道：
``cookie`` / ``cookie_ua`` 配置项、``DELETE /admin/cookie``、以及
``GET /admin/config`` 回读 ``cookie_masked`` 做长度校验（脚本 ``--push`` 用）。
配合本地脚本 ``get_smzdm_cookie.py --push`` 一键注入，不需要改代码。
"""
from __future__ import annotations

import asyncio
import re
import shlex
import time
from typing import Any

from fastapi import APIRouter, Cookie, HTTPException, Request, Response

from app.smzdm import crawler, scheduler, store
from app.smzdm.config import (
    BAN_BACKOFF_SECONDS,
    CATE_BOOST_DEFAULT,
    CATE_SUGGESTIONS,
    COOKIE_NAME,
    FETCH_INTERVAL_SECONDS,
    HOME_PAGES_PER_ROUND,
    MIN_REQUEST_INTERVAL_SECONDS,
    PAGES_PER_ROUND,
    SESSION_TTL_SECONDS,
)
from app.trigger.config import sign_session, verify_session

router = APIRouter(prefix="/api/deals", tags=["deals"])

# 手动抓取任务的强引用（不交给 GC；同时用于「连点只跑一轮」的判定）
_manual_task: asyncio.Task | None = None


# ------------------------------------------------------------ 通道 A：公开


@router.get("/list")
def public_list(
    limit: int = 60,
    offset: int = 0,
    cate: str = "",
    q: str = "",
    hours: int = 0,
):
    """超值好价列表。只返回 ``picked=1``，按综合热度倒序。"""
    return store.list_deals(
        only_picked=True,
        limit=limit,
        offset=offset,
        cate=cate.strip(),
        q=q.strip()[:60],
        hours=max(0, min(hours, 24 * 30)),
    )


@router.get("/stats")
def public_stats():
    return store.stats()


# ------------------------------------------------------------ 通道 B：管理


def _require_session(deals_session: str | None) -> None:
    if not verify_session(deals_session):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


@router.post("/admin/auth")
def admin_auth(payload: dict, response: Response):
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
def admin_session(deals_session: str | None = Cookie(default=None)):
    return {"valid": verify_session(deals_session)}


@router.post("/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


# ------------------------------------------------------------ 凭据解析


_HEADER_RE = re.compile(r"^\s*(cookie|user-agent)\s*:\s*(.+)$", re.I)


def parse_credential(raw: str) -> tuple[str, str, str]:
    """从「Copy as cURL」命令或裸 Cookie 串里提取 (cookie, ua, error)。

    支持三种粘贴形态（用户不需要理解区别，粘什么都尽量认）：
    1. 完整 cURL（bash / cmd 风格，大小写引号都兼容）
    2. 只有一行 `Cookie: xxx` 头
    3. 裸 cookie 串 `a=1; b=2`
    """
    text = (raw or "").strip()
    if not text:
        return "", "", "内容为空"

    # cURL 的续行反斜杠先合并，否则 shlex 会把 "\" 当成字符
    text = text.replace("\\\r\n", " ").replace("\\\n", " ")
    cookie = ""
    ua = ""

    if "curl" in text[:20].lower() or "-H" in text or "--header" in text:
        try:
            tokens = shlex.split(text)
        except ValueError:
            tokens = text.split()
        i = 0
        while i < len(tokens):
            tok = tokens[i]
            value = ""
            if tok in ("-H", "--header") and i + 1 < len(tokens):
                value = tokens[i + 1]
                i += 2
            elif tok.startswith("-H") and len(tok) > 2:
                value = tok[2:].strip()
                i += 1
            elif tok.startswith("--header="):
                value = tok.split("=", 1)[1]
                i += 1
            else:
                i += 1
                continue
            m = _HEADER_RE.match(value)
            if not m:
                continue
            if m.group(1).lower() == "cookie":
                cookie = m.group(2).strip()
            else:
                ua = m.group(2).strip()

    if not cookie:
        # 也可能用户直接粘了一整行 `Cookie: ...`
        line = text.splitlines()[0].strip() if text else ""
        m = _HEADER_RE.match(line)
        if m and m.group(1).lower() == "cookie":
            cookie = m.group(2).strip()
        elif "=" in text and ";" in text:
            cookie = text
        elif "=" in text:
            cookie = text  # 单个键值也接受，站方有时只认一个 sess

    if not cookie:
        return "", ua, "没有识别到 Cookie，请确认复制的是 smzdm.com 的请求"
    if len(cookie) > 8000:
        return "", ua, "Cookie 过长（超过 8000 字符），可能复制错了内容"
    return cookie, ua, ""


def _mask(cookie: str) -> str:
    """脱敏展示：只露长度和首尾，足够用户确认「换没换成新的」。"""
    if not cookie:
        return ""
    if len(cookie) <= 16:
        return "*" * len(cookie)
    return f"{cookie[:8]}…{cookie[-6:]}（共 {len(cookie)} 字符）"


# ------------------------------------------------------------ 配置读写


def _validate_config(patch: dict[str, Any]) -> dict[str, Any]:
    """校验阈值类配置，越界直接 422 —— 静默纠正会让用户以为改了没生效。"""
    out: dict[str, Any] = {}
    ints = {
        "worth_min": (0, 100_000),
        "fav_min": (0, 100_000),
        "cmt_min": (0, 100_000),
        "need_hits": (1, 3),
        # 精选流页数。**0 = 不抓**（默认）：实测精选流是全量爆料流水，
        # 100 条里 0 条能过阈值，拿它当入选来源只是灌库。上限 8 留给
        # 「刚上新」这类未来用途。
        "pages_per_round": (0, 8),
    }
    for key, (lo, hi) in ints.items():
        if key in patch:
            try:
                v = int(patch[key])
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"{key} 必须是整数")
            if not (lo <= v <= hi):
                raise HTTPException(status_code=422, detail=f"{key} 应在 {lo}~{hi} 之间")
            out[key] = str(v)

    if "worth_pct_min" in patch:
        try:
            v = float(patch["worth_pct_min"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="worth_pct_min 必须是数字")
        if not (0 <= v <= 100):
            raise HTTPException(status_code=422, detail="值率下限应在 0~100 之间")
        out["worth_pct_min"] = str(round(v, 1))

    if "cate_filter" in patch:
        raw = str(patch["cate_filter"] or "")
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) > 12:
            raise HTTPException(status_code=422, detail="关注品类最多 12 个")
        if any(len(p) > 20 for p in parts):
            raise HTTPException(status_code=422, detail="品类名过长")
        out["cate_filter"] = ",".join(parts)

    if "cate_blacklist" in patch:
        raw = str(patch["cate_blacklist"] or "")
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) > 12:
            raise HTTPException(status_code=422, detail="黑名单品类最多 12 个")
        if any(len(p) > 20 for p in parts):
            raise HTTPException(status_code=422, detail="品类名过长")
        out["cate_blacklist"] = ",".join(parts)

    if "cate_boost" in patch:
        try:
            v = float(patch["cate_boost"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="cate_boost 必须是数字")
        if not (1.0 <= v <= 5.0):
            raise HTTPException(
                status_code=422, detail="关注品类加权系数应在 1.0~5.0 之间"
            )
        out["cate_boost"] = str(round(v, 2))

    if "enabled" in patch:
        out["enabled"] = "1" if str(patch["enabled"]) in ("1", "true", "True") else "0"

    return out


@router.get("/admin/config")
def admin_config(deals_session: str | None = Cookie(default=None)):
    _require_session(deals_session)
    st = store.get_settings()
    return {
        "settings": {**st, "cookie": ""},           # cookie 原文绝不下发
        "cookie_set": bool(st.get("cookie")),
        "cookie_masked": _mask(st.get("cookie", "")),
        "constants": {
            "interval_seconds": FETCH_INTERVAL_SECONDS,
            "interval_minutes": FETCH_INTERVAL_SECONDS // 60,
            "min_request_interval_seconds": MIN_REQUEST_INTERVAL_SECONDS,
            "pages_per_round_default": PAGES_PER_ROUND,
            # 每轮固定抓几页首页推荐流（分页失效，恒为 1）。前端文案要能说清
            # 「N 页精选 + 1 页推荐」，否则用户只看到「每轮 3 页」会以为少抓了。
            "home_pages_per_round": HOME_PAGES_PER_ROUND,
            "ban_backoff_minutes": BAN_BACKOFF_SECONDS // 60,
            "cate_suggestions": CATE_SUGGESTIONS,
            "cate_boost_default": CATE_BOOST_DEFAULT,
        },
    }


@router.put("/admin/config")
def admin_update_config(payload: dict, deals_session: str | None = Cookie(default=None)):
    _require_session(deals_session)
    patch = _validate_config(payload if isinstance(payload, dict) else {})
    if "cookie" in payload or "cookie_ua" in payload:
        raw = str(payload.get("cookie") or "")
        cookie, ua, err = parse_credential(raw)
        if err:
            raise HTTPException(status_code=422, detail=err)
        patch["cookie"] = cookie
        patch["cookie_ua"] = ua or ""
    st = store.update_settings(patch)
    # 阈值类改动立即重算已有记录，否则用户要等下一轮抓取（20 分钟）才知道调对没有。
    # 关注品类 / 黑名单 / 加权系数也要重算 —— 它们决定 cate_hit 与 picked，
    # 漏了就会出现「改完页面没反应，但下一轮抓取后又变了」的灵异现象。
    # 只改 Cookie / 开关时不重算 —— 那不影响判定，白扫一遍全表没意义。
    if any(
        k in patch
        for k in (
            "worth_pct_min",
            "worth_min",
            "fav_min",
            "cmt_min",
            "need_hits",
            "cate_filter",
            "cate_blacklist",
        )
    ):
        picked, changed = store.rejudge(st)
    else:
        picked, changed = 0, 0
    return {
        "ok": True,
        "settings": {**st, "cookie": ""},
        "cookie_set": bool(st.get("cookie")),
        "cookie_masked": _mask(st.get("cookie", "")),
        "picked": picked,
        "changed": changed,
    }


@router.delete("/admin/cookie")
def admin_clear_cookie(deals_session: str | None = Cookie(default=None)):
    _require_session(deals_session)
    st = store.update_settings({"cookie": "", "cookie_ua": ""})
    return {"ok": True, "cookie_set": bool(st.get("cookie"))}


# ------------------------------------------------------------ 运行状态与操作


@router.get("/admin/status")
def admin_status(
    limit: int = 20,
    deals_session: str | None = Cookie(default=None),
):
    _require_session(deals_session)
    return {
        "scheduler": scheduler.status(),
        "stats": store.stats(),
        "rounds": store.recent_rounds(limit),
        "cates": store.cate_stats(72),
    }


@router.post("/admin/fetch")
async def admin_fetch_now(deals_session: str | None = Cookie(default=None)):
    """手动触发一轮（异步执行，立即返回，结果到 /admin/status 看）。

    🔴 必须是 ``async def``：写成同步 ``def`` 时 FastAPI 会把它丢进线程池执行，
    线程池里**没有运行中的事件循环**，``asyncio.get_running_loop()`` 会直接抛
    ``RuntimeError: no running event loop`` → 接口 500（2026-10-28 实测踩到）。

    任务引用存在模块变量里，不交给 GC 收 —— 否则「已开始抓取」返回后任务可能
    还没跑完就被回收。同一时刻只允许一个手动轮次，避免连点叠加请求。
    """
    _require_session(deals_session)
    if crawler.ban_remaining_seconds() > 0:
        raise HTTPException(
            status_code=429,
            detail=f"仍在退避期（剩余 {crawler.ban_remaining_seconds()} 秒），请稍后再试",
        )
    global _manual_task
    if _manual_task is not None and not _manual_task.done():
        return {
            "ok": True,
            "running": True,
            "message": "上一轮手动抓取还在进行中，稍后到「抓取状态」看结果",
        }
    _manual_task = asyncio.create_task(scheduler.run_round(manual=True))
    return {"ok": True, "running": True, "message": "已开始抓取，约 15 秒后到「抓取状态」查看结果"}


@router.post("/admin/unban")
def admin_unban(deals_session: str | None = Cookie(default=None)):
    """手动解除风控退避（换过 IP / 过完验证码后用）。"""
    _require_session(deals_session)
    crawler.clear_ban()
    return {"ok": True, "banned": False}


@router.get("/admin/preview")
def admin_preview(
    limit: int = 40,
    deals_session: str | None = Cookie(default=None),
):
    """管理页预览：含**未达阈值**的全部抓取结果，方便调阈值时看效果。"""
    _require_session(deals_session)
    return store.list_deals(only_picked=False, limit=limit)
