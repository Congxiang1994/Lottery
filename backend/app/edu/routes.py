"""FastAPI 路由：鉴权、目录、解析、下载任务、文件管理。"""
from __future__ import annotations

import io
import json
import os
import time
import zipfile
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import downloader, platform
from .config import AUTH_HEADER, RESOURCE_URLS
from .sessions import store, fulfill_token

router = APIRouter(prefix="/api/edu")

# 目录缓存：type -> (expire_at, data)
_catalog_cache: dict[str, tuple[float, dict]] = {}


def _get_session(request: Request, response: Response) -> dict:
    return store.get_or_create(request, response)


def _cached_catalog(catalog_type: str, force: bool = False) -> dict:
    now = time.time()
    if not force:
        if catalog_type in _catalog_cache and _catalog_cache[catalog_type][0] > now:
            return _catalog_cache[catalog_type][1]
    data = platform.fetch_catalog(catalog_type)
    _catalog_cache[catalog_type] = (now + 600, data)
    return data


# ---------------------------------------------------------------------------
# 鉴权（会话隔离）
# ---------------------------------------------------------------------------

@router.get("/auth")
def auth_status(sess: dict = Depends(_get_session)):
    return {"has_auth": bool(sess.get("auth"))}


class AuthSet(BaseModel):
    token: str = ""


@router.post("/auth")
def auth_set(body: AuthSet, sess: dict = Depends(_get_session)):
    token = fulfill_token(body.token)
    store.set_auth(sess, token)
    return {"has_auth": bool(token)}


@router.get("/auth/code")
def auth_code_get(sess: dict = Depends(_get_session)):
    if not sess.get("auth_code"):
        store.gen_code(sess)
    return {"code": sess["auth_code"]}


class AuthCodeBind(BaseModel):
    code: str = ""
    token: str = ""


@router.post("/auth/code")
def auth_code_bind(body: AuthCodeBind):
    token = fulfill_token(body.token)
    if not token:
        return Response(json.dumps({"error": "empty token"}), status_code=400,
                        media_type="application/json")
    if not store.bind_by_code(body.code, token):
        return Response(json.dumps({"error": "授权码无效，请在设置页重新生成"}),
                        status_code=401, media_type="application/json")
    return {"ok": True}


# ---------------------------------------------------------------------------
# 目录与解析
# ---------------------------------------------------------------------------

@router.get("/catalog")
def catalog(type: str = "course", refresh: int = 0, sess: dict = Depends(_get_session)):
    if type not in ("textbook", "course"):
        return Response(json.dumps({"error": "unknown catalog type"}),
                        status_code=400, media_type="application/json")
    data = _cached_catalog(type, force=bool(refresh))
    return data


@router.get("/course/{book_id}")
def course(book_id: str, sess: dict = Depends(_get_session)):
    toc = platform.parse_course_id(book_id)
    return toc


class ParseItem(BaseModel):
    kind: str = ""
    id: str = ""
    resourceType: str = ""


class ParseReq(BaseModel):
    items: list[ParseItem] = []
    urls: list[str] = []
    video: bool = False
    formats: list[str] = []
    useBackup: bool = True


@router.post("/parse")
def parse(body: ParseReq, sess: dict = Depends(_get_session)):
    headers = {AUTH_HEADER: sess.get("auth", "")} if sess.get("auth") else {}
    normal_items = []
    course_books: list[str] = []  # 需展开课时的课程教材
    urls = list(body.urls)
    for it in body.items:
        if it.kind == "course":
            if it.resourceType == "elite_lesson":
                normal_items.append({"kind": "elite_course", "id": it.id})
            else:
                course_books.append(it.id)
        elif it.kind in ("textbook",):
            normal_items.append({"kind": "textbook", "id": it.id})
    fmt = ["m3u8"] if body.video else (body.formats or ["pdf", "mp3", "jpg"])

    detail_urls = platform.generate_url_from_id(normal_items)
    detail_urls.extend(urls)
    links = platform.extract_resources(detail_urls, fmt, use_backup=body.useBackup, headers=headers)

    # 展开课程教材：自动拉取其所有课时并逐一解析，合并资源
    for cid in course_books:
        toc = platform.parse_course_id(cid)
        lesson_items = []
        for u in toc:
            for c in (u.get("Children") or []):
                kind = "course" if c.get("ResourceType") == "national_lesson" else "elite_course"
                lesson_items.append({"kind": kind, "id": c.get("CourseID")})
        if lesson_items:
            lesson_urls = platform.generate_url_from_id(lesson_items)
            more = platform.extract_resources(lesson_urls, fmt, use_backup=body.useBackup, headers=headers)
            links.extend(more)

    return platform.dedup(links)


class DirectReq(BaseModel):
    links: list[dict] = []


@router.post("/direct")
def direct(body: DirectReq, sess: dict = Depends(_get_session)):
    token = store.access_token(sess)
    out = []
    for l in body.links:
        if l.get("Format") == "m3u8":
            continue
        base = l.get("RawURL", "") or l.get("BackupURL", "")
        if token:
            sep = "&" if "?" in base else "?"
            base = f"{base}{sep}accessToken={token}"
        elif l.get("BackupURL"):
            base = l["BackupURL"]
        if not base:
            continue
        out.append({"index": len(out), "title": l.get("Title", ""),
                    "format": l.get("Format", ""), "url": base})
    return out


# ---------------------------------------------------------------------------
# 下载任务
# ---------------------------------------------------------------------------

class CreateTasks(BaseModel):
    links: list[dict] = []
    name: str = ""


@router.post("/tasks")
def create_tasks(body: CreateTasks, sess: dict = Depends(_get_session)):
    if not body.links:
        return Response(json.dumps({"error": "no links"}), status_code=400,
                        media_type="application/json")
    return downloader.manager.submit(body.links, body.name, sess.get("auth", ""))


@router.get("/tasks")
def list_tasks(sess: dict = Depends(_get_session)):
    return downloader.manager.list_groups()


@router.post("/tasks/{gid}/cancel")
def cancel_task(gid: str, sess: dict = Depends(_get_session)):
    if not downloader.manager.cancel(gid):
        return Response(json.dumps({"error": "group not found"}), status_code=404,
                        media_type="application/json")
    return {"cancelled": True}


# ---------------------------------------------------------------------------
# 文件管理
# ---------------------------------------------------------------------------

def _safe_join(rel: str) -> str:
    base = downloader.manager.download_dir
    rel = rel.lstrip("/")
    path = os.path.abspath(os.path.join(base, rel))
    if not path.startswith(base):
        return base
    return path


def _file_tree(abs_path: str, rel: str) -> list:
    out = []
    try:
        entries = sorted(os.scandir(abs_path), key=lambda e: (not e.is_dir(), e.name))
    except OSError:
        return out
    for e in entries:
        path_rel = f"{rel}/{e.name}" if rel else e.name
        try:
            st = e.stat()
        except OSError:
            continue
        if e.is_dir():
            out.append({"path": path_rel, "name": e.name, "size": 0, "mod": int(st.st_mtime),
                        "is_dir": True, "children": _file_tree(e.path, path_rel)})
        else:
            out.append({"path": path_rel, "name": e.name, "size": st.st_size,
                        "mod": int(st.st_mtime), "is_dir": False})
    return out


@router.get("/files")
def files_list(path: str = "", sess: dict = Depends(_get_session)):
    return _file_tree(_safe_join(path), path)


@router.get("/files/download")
def file_download(path: str = "", sess: dict = Depends(_get_session)):
    full = _safe_join(path)
    if not os.path.isfile(full):
        return Response(json.dumps({"error": "file not found"}), status_code=404,
                        media_type="application/json")
    return FileResponse(full, filename=os.path.basename(full))


class ZipReq(BaseModel):
    paths: list[str] = []


@router.post("/files/zip")
def files_zip(body: ZipReq, sess: dict = Depends(_get_session)):
    def add_to_zip(zf, abs_path, arc_name):
        if os.path.isdir(abs_path):
            for entry in os.scandir(abs_path):
                child_arc = f"{arc_name}/{entry.name}" if arc_name else entry.name
                add_to_zip(zf, entry.path, child_arc)
        else:
            zf.write(abs_path, arc_name)

    def gen():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in body.paths:
                full = _safe_join(p)
                if os.path.exists(full):
                    add_to_zip(zf, full, os.path.basename(full) if full != downloader.manager.download_dir else "")
        yield buf.getvalue()

    return StreamingResponse(
        gen(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="smartedu-download.zip"'},
    )


@router.delete("/files")
def file_delete(path: str = "", sess: dict = Depends(_get_session)):
    full = _safe_join(path)
    if os.path.exists(full):
        import shutil
        if os.path.isdir(full):
            shutil.rmtree(full)
        else:
            os.remove(full)
    return {"deleted": True}
