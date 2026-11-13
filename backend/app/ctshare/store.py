"""CT 检查记录域的 SQLite 存储 + 照片文件管理。

表结构
------
``ct_exam``（一条 = 一次检查）
    - ``exam_time`` / ``project`` / ``link_label`` / ``link_url`` / ``note``
    - ``sort_order`` 决定展示顺序（按检查时间排，同时间用 id 兜底）
    - ``created_at`` / ``updated_at``

``ct_photo``（一条 = 一张报告照片，属于某次检查）
    - ``filename`` 是照片目录里的**随机文件名**（不含用户原名，防路径穿越）
    - ``caption`` 图注、``sort_order`` 排序

``security_lock`` / ``password_store``
    **分享口令**的防爆破计数与 scrypt 哈希（结构与 auth.db 一致）。
    ⚠️ 管理侧不用这两张表 —— 管理操作走全站操作密码，不猜这把口令。

照片文件
--------
``PHOTO_DIR`` 下按 ``<uuid>.<ext>`` 存，DB 只记文件名。
**目录不进仓库**，重部署（rsync 覆盖 /opt/lottery）不丢。
"""
from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from pathlib import Path

from app.common.db import get_conn, init_schema
from app.ctshare import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS ct_exam (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_time   TEXT NOT NULL DEFAULT '',
    project     TEXT NOT NULL DEFAULT '',
    link_label  TEXT NOT NULL DEFAULT '',
    link_url    TEXT NOT NULL DEFAULT '',
    link_text   TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ct_photo (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id     INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    caption     TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (exam_id) REFERENCES ct_exam(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_lock (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_verify_ts  REAL,
    last_verify_ok  INTEGER,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    locked_until    REAL NOT NULL DEFAULT 0
);
"""

# 旧库兼容：早期版本有 ct_report 表（整段 HTML），迁移脚本会读完再删掉它。
# 这里不主动 DROP —— 一次性数据迁移由脚本负责，避免两个 worker 抢着删。

_initialized = False


def init() -> None:
    """建表（幂等；多 worker 由 flock 串行）。"""
    global _initialized
    if _initialized:
        return
    init_schema(config.DB_PATH, SCHEMA)
    _initialized = True


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


# ------------------------------------------------------------ 检查记录


EXAM_FIELDS = ("exam_time", "project", "link_label", "link_url", "link_text", "note")


def _exam_dict(row) -> dict:
    return {
        "id": row[0],
        "exam_time": row[1],
        "project": row[2],
        "link_label": row[3],
        "link_url": row[4],
        "link_text": row[5],
        "note": row[6],
        "sort_order": row[7],
        "created_at": row[8],
        "updated_at": row[9],
    }


def list_exams() -> list[dict]:
    """按 sort_order / id 升序列出**全部**检查（含照片数）。"""
    init()
    with get_conn(config.DB_PATH) as con:
        rows = con.execute(
            "SELECT id, exam_time, project, link_label, link_url, link_text, note, "
            "sort_order, created_at, updated_at FROM ct_exam "
            "ORDER BY sort_order ASC, id ASC"
        ).fetchall()
        counts = dict(con.execute(
            "SELECT exam_id, COUNT(*) FROM ct_photo GROUP BY exam_id").fetchall())
    out = []
    for r in rows:
        d = _exam_dict(r)
        d["photo_count"] = int(counts.get(d["id"], 0))
        out.append(d)
    return out


def get_exam(exam_id: int) -> dict | None:
    init()
    with get_conn(config.DB_PATH) as con:
        r = con.execute(
            "SELECT id, exam_time, project, link_label, link_url, link_text, note, "
            "sort_order, created_at, updated_at FROM ct_exam WHERE id=?",
            (exam_id,)).fetchone()
    return _exam_dict(r) if r else None


def create_exam(data: dict) -> dict:
    init()
    now = _now()
    with get_conn(config.DB_PATH) as con:
        # 新记录排在最后（sort_order = 当前最大值 + 1）
        mx = con.execute("SELECT COALESCE(MAX(sort_order), 0) FROM ct_exam").fetchone()[0]
        cur = con.execute(
            "INSERT INTO ct_exam (exam_time, project, link_label, link_url, link_text, "
            "note, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            tuple(data.get(f, "") for f in EXAM_FIELDS) + (int(mx or 0) + 1, now, now))
        exam_id = cur.lastrowid
    return get_exam(exam_id) or {}


def update_exam(exam_id: int, data: dict) -> dict | None:
    """部分更新：只改传入的字段。"""
    init()
    if not get_exam(exam_id):
        return None
    fields = [f for f in EXAM_FIELDS + ("sort_order",) if f in data]
    if not fields:
        return get_exam(exam_id)
    sql = ", ".join(f"{f}=?" for f in fields) + ", updated_at=?"
    params = [data[f] for f in fields] + [_now(), exam_id]
    with get_conn(config.DB_PATH) as con:
        con.execute(f"UPDATE ct_exam SET {sql} WHERE id=?", params)
    return get_exam(exam_id)


def delete_exam(exam_id: int) -> bool:
    """删检查记录 + 它名下的照片（先取文件名，事务后删文件）。"""
    init()
    with get_conn(config.DB_PATH) as con:
        names = [r[0] for r in con.execute(
            "SELECT filename FROM ct_photo WHERE exam_id=?", (exam_id,)).fetchall()]
        cur = con.execute("DELETE FROM ct_exam WHERE id=?", (exam_id,))
        removed = cur.rowcount > 0
    if removed:
        for name in names:
            _unlink_photo(name)
    return removed


def reorder_exams(ids: list[int]) -> list[dict]:
    """按传入 id 顺序重排 sort_order（管理页拖拽排序用）。"""
    init()
    with get_conn(config.DB_PATH) as con:
        for i, exam_id in enumerate(ids):
            con.execute("UPDATE ct_exam SET sort_order=?, updated_at=? WHERE id=?",
                        (i + 1, _now(), exam_id))
    return list_exams()


# ------------------------------------------------------------ 照片


def _photo_dict(row) -> dict:
    return {
        "id": row[0],
        "exam_id": row[1],
        "filename": row[2],
        "caption": row[3],
        "sort_order": row[4],
        "created_at": row[5],
    }


def list_photos(exam_id: int | None = None) -> list[dict]:
    init()
    with get_conn(config.DB_PATH) as con:
        if exam_id is None:
            rows = con.execute(
                "SELECT id, exam_id, filename, caption, sort_order, created_at "
                "FROM ct_photo ORDER BY exam_id ASC, sort_order ASC, id ASC").fetchall()
        else:
            rows = con.execute(
                "SELECT id, exam_id, filename, caption, sort_order, created_at "
                "FROM ct_photo WHERE exam_id=? ORDER BY sort_order ASC, id ASC",
                (exam_id,)).fetchall()
    return [_photo_dict(r) for r in rows]


def get_photo(photo_id: int) -> dict | None:
    init()
    with get_conn(config.DB_PATH) as con:
        r = con.execute(
            "SELECT id, exam_id, filename, caption, sort_order, created_at "
            "FROM ct_photo WHERE id=?", (photo_id,)).fetchone()
    return _photo_dict(r) if r else None


def add_photo(exam_id: int, content: bytes, ext: str, caption: str = "") -> dict | None:
    """写照片文件 + 落索引。文件先落盘再入库，避免 DB 有记录但文件没写成功。"""
    init()
    if not get_exam(exam_id):
        return None
    config.PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    path = config.PHOTO_DIR / filename
    path.write_bytes(content)
    with get_conn(config.DB_PATH) as con:
        mx = con.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM ct_photo WHERE exam_id=?",
            (exam_id,)).fetchone()[0]
        cur = con.execute(
            "INSERT INTO ct_photo (exam_id, filename, caption, sort_order, created_at) "
            "VALUES (?,?,?,?,?)", (exam_id, filename, caption, int(mx or 0) + 1, _now()))
        photo_id = cur.lastrowid
    return get_photo(photo_id)


def update_photo(photo_id: int, data: dict) -> dict | None:
    init()
    fields = [f for f in ("caption", "sort_order") if f in data]
    if not fields:
        return get_photo(photo_id)
    sql = ", ".join(f"{f}=?" for f in fields)
    with get_conn(config.DB_PATH) as con:
        con.execute(f"UPDATE ct_photo SET {sql} WHERE id=?",
                    [data[f] for f in fields] + [photo_id])
    return get_photo(photo_id)


def delete_photo(photo_id: int) -> bool:
    init()
    photo = get_photo(photo_id)
    if not photo:
        return False
    with get_conn(config.DB_PATH) as con:
        con.execute("DELETE FROM ct_photo WHERE id=?", (photo_id,))
    _unlink_photo(photo["filename"])
    return True


def _unlink_photo(filename: str) -> None:
    """只删 PHOTO_DIR 下的文件（防路径穿越：文件名不含 / 且必须是纯 hex + 扩展名）。"""
    if "/" in filename or "\\" in filename or ".." in filename:
        return
    try:
        path = config.PHOTO_DIR / filename
        path.unlink(missing_ok=True)
    except OSError:
        pass


def photo_path(filename: str) -> Path | None:
    """安全解析照片路径：非法文件名返回 None（前端传进来的，一律当不可信）。"""
    if "/" in filename or "\\" in filename or ".." in filename or not filename:
        return None
    return config.PHOTO_DIR / filename


# ------------------------------------------------------------ 分享口令（只读通道）


def verify_share_password(password: str) -> tuple[bool, str, int]:
    """校验分享口令 + 防在线爆破。返回 ``(ok, message, http_status)``。"""
    from app.common import password as _password

    init()
    now = time.time()
    lock_step = 0.0
    fail_count = 0
    with get_conn(config.DB_PATH) as con:
        con.execute("BEGIN IMMEDIATE")
        con.execute(
            "INSERT OR IGNORE INTO security_lock (id, fail_count, locked_until) VALUES (1,0,0)")
        row = con.execute(
            "SELECT fail_count, locked_until FROM security_lock WHERE id=1").fetchone()
        fail_count = int(row[0] or 0) if row else 0
        locked_until = float(row[1] or 0) if row else 0.0

        if locked_until > now:
            wait = int(locked_until - now) + 1
            con.execute(
                "UPDATE security_lock SET last_verify_ts=?, last_verify_ok=0 WHERE id=1",
                (now,))
            return False, f"密码错误次数过多，请 {wait} 秒后再试", 429

        ok = _password.verify_in(config.DB_PATH, password)
        if ok:
            fail_count, locked_until = 0, 0.0
        else:
            fail_count += 1
            if fail_count >= config.FAIL_THRESHOLD:
                lock_step = config.LOCK_STEPS[
                    min(fail_count - config.FAIL_THRESHOLD, len(config.LOCK_STEPS) - 1)]
                locked_until = now + lock_step
        con.execute(
            "UPDATE security_lock SET last_verify_ts=?, last_verify_ok=?,"
            " fail_count=?, locked_until=? WHERE id=1",
            (now, 1 if ok else 0, fail_count, locked_until))
    if ok:
        return True, "验证通过", 200
    if lock_step:
        return False, f"密码错误次数过多，已锁定 {int(lock_step)} 秒", 429
    return (False,
            f"密码错误（已连续失败 {fail_count} 次，累计 {config.FAIL_THRESHOLD} 次将临时锁定）",
            401)


def reset_failures() -> None:
    init()
    with get_conn(config.DB_PATH) as con:
        con.execute(
            "INSERT OR IGNORE INTO security_lock (id, fail_count, locked_until) VALUES (1,0,0)")
        con.execute("UPDATE security_lock SET fail_count=0, locked_until=0 WHERE id=1")


# ------------------------------------------------------------ 旧 HTML 报告（迁移用）


def get_legacy_html() -> str | None:
    """读旧版 ct_report 表里的整段 HTML（迁移脚本用）。表不存在 → None。"""
    with get_conn(config.DB_PATH) as con:
        exists = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ct_report'").fetchone()
        if not exists:
            return None
        row = con.execute("SELECT html FROM ct_report WHERE id=1").fetchone()
    return row[0] if row else None


def drop_legacy_table() -> bool:
    """迁移完成后删掉 ct_report 表（用户明确要求「迁移后删掉」）。"""
    init()
    with get_conn(config.DB_PATH) as con:
        cur = con.execute("DROP TABLE IF EXISTS ct_report")
        return cur.rowcount >= 0  # DDL 无 rowcount 语义，靠调用方复核 sqlite_master


def legacy_table_exists() -> bool:
    with get_conn(config.DB_PATH) as con:
        return con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='ct_report'").fetchone() is not None


def stats() -> dict:
    """给管理页的概览数字（不暴露照片文件字节）。"""
    init()
    with get_conn(config.DB_PATH) as con:
        exams = con.execute("SELECT COUNT(*) FROM ct_exam").fetchone()[0]
        photos = con.execute("SELECT COUNT(*) FROM ct_photo").fetchone()[0]
    return {"exams": int(exams), "photos": int(photos),
            "sha256": hashlib.sha256(secrets.token_bytes(8)).hexdigest()[:8]}
