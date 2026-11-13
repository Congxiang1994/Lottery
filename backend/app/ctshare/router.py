"""CT 检查记录 API 路由（``/api/ct``）。

两条通道
--------
A. **只读 / 分享**（cookie ``ct_session``）
   医生输「分享口令」→ 看检查记录与照片。只能读。

B. **管理 / 增删改查**（cookie ``ct_admin_session``）
   本人输「全站操作密码」→ 增删改检查记录、上传/删除照片、排序。
   ⚠️ 管理口令与分享口令**完全分开**：医生拿到分享口令也改不了内容。

照片走 ``/api/ct/photo/{filename}``，**两种会话都能取**（管理页也要预览）。
文件名是随机 uuid，DB 只记文件名；路径解析前做白名单校验，防目录穿越。

照片上传用 **raw body + Content-Type**（不用 multipart）：
服务器没装 ``python-multipart``，引依赖要给线上 venv 装包、多一处发版风险；
前端 ``fetch(url, {method:'POST', body: file})`` 直接发二进制，等价且更稳。
"""
from __future__ import annotations

from fastapi import APIRouter, Cookie, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse

from app.common import admin, security
from app.ctshare import config, store

router = APIRouter(prefix="/api/ct", tags=["ct"])

_require = admin.require  # 401 文案全站一致

#: 扩展名 → 响应 media_type（文件落盘时按白名单生成，这里只做映射）
_MEDIA_BY_EXT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".gif": "image/gif",
}


def _require_view(ct_session: str | None, ct_admin_session: str | None) -> None:
    """查看权限：分享会话或管理会话，任一有效即可。"""
    if admin.verify_session(ct_session) or admin.verify_session(ct_admin_session):
        return
    raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


# ------------------------------------------------------------ A. 分享口令


@router.post("/auth")
def auth(payload: dict, response: Response):
    """校验分享口令 → 签发只读会话 cookie。"""
    ok, msg, status = store.verify_share_password(str(payload.get("password", "")))
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    admin.set_session_cookie(response, config.COOKIE_NAME, config.SESSION_TTL_SECONDS)
    return {"ok": True, "message": "验证通过", "ttl_hours": config.SESSION_TTL_SECONDS // 3600}


@router.get("/session")
def session_status(ct_session: str | None = Cookie(default=None)):
    return admin.session_state(ct_session)


@router.post("/logout")
def logout(response: Response):
    return admin.logout(response, config.COOKIE_NAME)


# ------------------------------------------------------------ B. 管理口令


@router.post("/admin/auth")
def admin_auth(payload: dict, response: Response):
    """校验**全站操作密码** → 签发管理会话 cookie。"""
    return admin.login(payload, response, config.ADMIN_COOKIE_NAME)


@router.get("/admin/session")
def admin_session(ct_admin_session: str | None = Cookie(default=None)):
    return admin.session_state(ct_admin_session)


@router.post("/admin/logout")
def admin_logout(response: Response):
    return admin.logout(response, config.ADMIN_COOKIE_NAME)


# ------------------------------------------------------------ C. 读取（共享）


def _photo_public(p: dict) -> dict:
    return {
        "id": p["id"],
        "caption": p["caption"],
        "sort_order": p["sort_order"],
        "url": f"/api/ct/photo/{p['filename']}",
    }


@router.get("/exams")
def list_exams(ct_session: str | None = Cookie(default=None),
               ct_admin_session: str | None = Cookie(default=None)):
    """全部检查记录（含照片），按 sort_order 升序。"""
    _require_view(ct_session, ct_admin_session)
    exams = store.list_exams()
    photos = store.list_photos()
    by_exam: dict[int, list] = {}
    for p in photos:
        by_exam.setdefault(p["exam_id"], []).append(_photo_public(p))
    for e in exams:
        e["photos"] = by_exam.get(e["id"], [])
        e.pop("photo_count", None)
    return {"items": exams, "total": len(exams)}


@router.get("/photo/{filename}")
def serve_photo(filename: str, ct_session: str | None = Cookie(default=None),
                ct_admin_session: str | None = Cookie(default=None)):
    """照片文件（两种会话都可取）。"""
    _require_view(ct_session, ct_admin_session)
    path = store.photo_path(filename)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="照片不存在")
    ext = path.suffix.lower()
    media = _MEDIA_BY_EXT.get(ext)
    if media is None:
        raise HTTPException(status_code=404, detail="照片格式不支持")
    return FileResponse(path, media_type=media,
                        headers={"Cache-Control": "private, max-age=3600"})


# ------------------------------------------------------------ D. 管理：检查记录


def _clean(data: dict) -> dict:
    """字段裁剪 + 长度上限（超长直接截断，不抛错打断表单）。"""
    limits = {
        "exam_time": config.MAX_TIME_LEN, "project": config.MAX_PROJECT_LEN,
        "link_label": config.MAX_LINK_LABEL_LEN, "link_url": config.MAX_LINK_URL_LEN,
        "link_text": config.MAX_LINK_TEXT_LEN, "note": config.MAX_NOTE_LEN,
    }
    out = {}
    for k, lim in limits.items():
        if k in data:
            out[k] = str(data.get(k) or "").strip()[:lim]
    return out


@router.get("/admin/stats")
def admin_stats(ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    return store.stats()


@router.get("/admin/exams")
def admin_list_exams(ct_admin_session: str | None = Cookie(default=None)):
    """管理页列表：与只读 /exams 同结构（含 photos），避免前端分两套渲染。"""
    _require(ct_admin_session)
    exams = store.list_exams()
    photos = store.list_photos()
    by_exam: dict[int, list] = {}
    for p in photos:
        by_exam.setdefault(p["exam_id"], []).append(_photo_public(p))
    for e in exams:
        e["photos"] = by_exam.get(e["id"], [])
        e.pop("photo_count", None)
    return {"items": exams, "total": len(exams)}


@router.post("/admin/exams")
def admin_create_exam(payload: dict, ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    data = _clean(payload)
    if not data.get("exam_time") and not data.get("project"):
        raise HTTPException(status_code=422, detail="检查时间与检查项目至少填一项")
    return store.create_exam(data)


@router.put("/admin/exams/{exam_id}")
def admin_update_exam(exam_id: int, payload: dict,
                      ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    data = _clean(payload)
    if "sort_order" in payload:
        try:
            data["sort_order"] = int(payload["sort_order"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="sort_order 必须是整数")
    row = store.update_exam(exam_id, data)
    if row is None:
        raise HTTPException(status_code=404, detail="检查记录不存在")
    return row


@router.delete("/admin/exams/{exam_id}")
def admin_delete_exam(exam_id: int, ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    removed = store.delete_exam(exam_id)
    return {"ok": True, "removed": removed}


@router.post("/admin/exams/reorder")
def admin_reorder(payload: dict, ct_admin_session: str | None = Cookie(default=None)):
    """按传入 id 列表重排（拖拽排序用）。"""
    _require(ct_admin_session)
    ids = payload.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        raise HTTPException(status_code=422, detail="ids 必须是整数数组")
    return {"items": store.reorder_exams(ids)}


# ------------------------------------------------------------ E. 管理：照片


@router.get("/admin/photos")
def admin_list_photos(ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    return {"items": [_photo_public(p) for p in store.list_photos()]}


@router.post("/admin/photo")
async def admin_upload_photo(
    request: Request,
    exam_id: int = Query(...),
    caption: str = Query(""),
    ct_admin_session: str | None = Cookie(default=None),
):
    """上传照片：请求体就是图片二进制，Content-Type 为图片 MIME。"""
    _require(ct_admin_session)
    if store.get_exam(exam_id) is None:
        raise HTTPException(status_code=404, detail="检查记录不存在")
    mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
    ext = config.PHOTO_MIME_EXT.get(mime)
    if ext is None:
        raise HTTPException(status_code=415, detail=f"不支持的图片格式：{mime or '(空)'}")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="照片内容为空")
    if len(body) > config.MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413,
                            detail=f"照片过大（{len(body)} 字节），上限 {config.MAX_PHOTO_BYTES} 字节")
    cap = str(caption or "")[:config.MAX_CAPTION_LEN]
    photo = store.add_photo(exam_id, body, ext, cap)
    if photo is None:
        raise HTTPException(status_code=404, detail="检查记录不存在")
    return _photo_public(photo)


@router.put("/admin/photo/{photo_id}")
def admin_update_photo(photo_id: int, payload: dict,
                       ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    data: dict = {}
    if "caption" in payload:
        data["caption"] = str(payload.get("caption") or "")[:config.MAX_CAPTION_LEN]
    if "sort_order" in payload:
        try:
            data["sort_order"] = int(payload["sort_order"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="sort_order 必须是整数")
    row = store.update_photo(photo_id, data)
    if row is None:
        raise HTTPException(status_code=404, detail="照片不存在")
    return _photo_public(row)


@router.delete("/admin/photo/{photo_id}")
def admin_delete_photo(photo_id: int, ct_admin_session: str | None = Cookie(default=None)):
    _require(ct_admin_session)
    return {"ok": True, "removed": store.delete_photo(photo_id)}


# ------------------------------------------------------------ F. 备用：校验全站口令（脚本/运维）

@router.post("/admin/verify-password")
def admin_verify_password(payload: dict,
                          ct_admin_session: str | None = Cookie(default=None)):
    """一次性校验全站操作密码（不签发 cookie）—— 运维脚本用，前端不用。"""
    ok, msg, status = security.verify_password(str(payload.get("password", "")))
    if not ok:
        raise HTTPException(status_code=status, detail=msg)
    return {"ok": True}
