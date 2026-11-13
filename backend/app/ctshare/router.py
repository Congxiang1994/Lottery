"""CT 报告分享 API 路由（``/api/ct``）。

通道
----
A. **分享口令**（``/auth`` / ``/session`` / ``/logout``）
   独立口令（存 ``/data/lottery/ctshare.db``），**不是**全站操作密码 ——
   把链接发给医生时只需要告诉他「1234」，不泄露本人其它私有页的口令。
   校验通过签发 12h httpOnly cookie（名 ``ct_session``，与全站同一签名密钥）。

B. **报告读取**（``/report`` / ``/report/raw`` / ``/meta``）
   全部要求会话 cookie。``/report/raw`` 直接返回原文（``text/html``）——
   浏览器原生渲染、可直接打印，**原样呈现，不做任何改写**。

C. **报告导入**（``POST /report``）
   要求会话 cookie。用于更新/替换报告（整段 HTML 原样入库）。

⚠️ 报告原文含内嵌 base64 图片，体积大（~800 KB）：列表类接口只回元信息，
   正文只在 ``/report`` 与 ``/report/raw`` 里给。
"""
from __future__ import annotations

from fastapi import APIRouter, Cookie, HTTPException, Response
from fastapi.responses import HTMLResponse

from app.common import admin
from app.ctshare import config, store

router = APIRouter(prefix="/api/ct", tags=["ct"])

_require_session = admin.require


# ------------------------------------------------------------ A. 口令通道


@router.post("/auth")
def auth(payload: dict, response: Response):
    """校验分享口令 → 签发会话 cookie。"""
    ok, msg, status = store.verify_share_password(str(payload.get("password", "")))
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    admin.set_session_cookie(response, config.COOKIE_NAME, config.SESSION_TTL_SECONDS)
    return {"ok": True, "message": "验证通过", "ttl_hours": config.SESSION_TTL_SECONDS // 3600}


@router.get("/session")
def session_status(ct_session: str | None = Cookie(default=None)):
    """会话是否有效（前端密码门的探测接口）。"""
    return admin.session_state(ct_session)


@router.post("/logout")
def logout(response: Response):
    """退出（清 cookie）。"""
    return admin.logout(response, config.COOKIE_NAME)


# ------------------------------------------------------------ B. 报告读取


@router.get("/meta")
def report_meta(ct_session: str | None = Cookie(default=None)):
    """报告元信息（标题 / 体积 / 摘要 / 更新时间）。未导入 → exists=false。"""
    _require_session(ct_session)
    meta = store.report_meta()
    return {"exists": meta is not None, "report": meta}


@router.get("/report")
def report(ct_session: str | None = Cookie(default=None)):
    """报告原文（JSON 包装，前端渲染进 iframe）。"""
    _require_session(ct_session)
    row = store.get_report()
    if row is None:
        raise HTTPException(status_code=404, detail="尚未导入报告")
    return {"title": row["title"], "html": row["html"], "bytes": row["bytes"],
            "sha256": row["sha256"], "updated_at": row["updated_at"]}


@router.get("/report/raw")
def report_raw(ct_session: str | None = Cookie(default=None)):
    """报告原文（``text/html``）：浏览器原生渲染，可直接打印 / 另存。"""
    _require_session(ct_session)
    row = store.get_report()
    if row is None:
        raise HTTPException(status_code=404, detail="尚未导入报告")
    return HTMLResponse(content=row["html"], status_code=200)


# ------------------------------------------------------------ C. 报告导入


@router.post("/report")
def save_report(payload: dict, response: Response, ct_session: str | None = Cookie(default=None)):
    """导入 / 替换报告（整段 HTML 原样入库）。"""
    _require_session(ct_session)
    html = payload.get("html")
    if not isinstance(html, str) or not html.strip():
        raise HTTPException(status_code=422, detail="html 不能为空")
    size = len(html.encode("utf-8"))
    if size > config.MAX_REPORT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"报告过大（{size} 字节），上限 {config.MAX_REPORT_BYTES} 字节")
    title = str(payload.get("title") or "").strip()[:120] or store.extract_title(html)
    info = store.save_report(html, title)
    return {"ok": True, "report": info}


@router.delete("/report")
def delete_report(ct_session: str | None = Cookie(default=None)):
    """删除报告。"""
    _require_session(ct_session)
    removed = store.delete_report()
    return {"ok": True, "removed": removed}
