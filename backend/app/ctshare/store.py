"""CT 报告分享域的 SQLite 存储。

表结构
------
``ct_report``
    报告原文（整段 HTML，含内嵌 base64 图片）。**固定单条**（id=1）：
    分享页只有一份报告，重新导入即覆盖更新。
    - ``html``    报告原文（TEXT，逐字节存，不做任何改写）
    - ``title``   报告标题（取自 HTML 的 <title>，仅用于列表/日志展示）
    - ``bytes``   原始字节数（导入时记录，用于体积核对）
    - ``sha256``  原文摘要（导入/导出核对用，证明「放上去的就是这份」）
    - ``updated_at``

``security_lock``
    与全站同名同结构：分享口令的防在线爆破（连续失败 → 递增锁定）。
    ⚠️ 与 ``app.common.security`` 的区别：那把锁在全站 auth.db 口径下共享，
    这里**独立计数**，避免「猜分享口令」把本人的操作密码也锁住。

``password_store``
    分享口令的 scrypt 哈希（结构与 auth.db 一致，口令**不落明文**）。
"""
from __future__ import annotations

import hashlib
import re
import time

from app.common.db import get_conn, init_schema
from app.ctshare import config

#: 取 HTML 的 <title>（仅用于列表/日志展示，**不改内容**）
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)

SCHEMA = """
CREATE TABLE IF NOT EXISTS ct_report (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    title       TEXT NOT NULL DEFAULT '',
    html        TEXT NOT NULL,
    bytes       INTEGER NOT NULL DEFAULT 0,
    sha256      TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_lock (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_verify_ts  REAL,
    last_verify_ok  INTEGER,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    locked_until    REAL NOT NULL DEFAULT 0
);
"""

_initialized = False


def init() -> None:
    """建表（幂等；多 worker 由 flock 串行）。"""
    global _initialized
    if _initialized:
        return
    init_schema(config.DB_PATH, SCHEMA)
    _initialized = True


# ------------------------------------------------------------ 报告


def extract_title(html: str) -> str:
    """取 HTML 的 <title>（仅用于展示，不改内容）。"""
    m = _TITLE_RE.search(html)
    if not m:
        return "CT 检查结果"
    return m.group(1).strip()[:120] or "CT 检查结果"


def save_report(html: str, title: str = "") -> dict:
    """写入/覆盖报告原文，返回摘要信息。"""
    init()
    raw = html.encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    title = (title or extract_title(html))[:120]
    with get_conn(config.DB_PATH) as con:
        con.execute(
            "INSERT OR REPLACE INTO ct_report (id, title, html, bytes, sha256, updated_at) "
            "VALUES (?,?,?,?,?,?)",
            (config.REPORT_ID, title, html, len(raw), digest,
             time.strftime("%Y-%m-%d %H:%M:%S")),
        )
    return {"bytes": len(raw), "sha256": digest, "title": title}


def get_report() -> dict | None:
    """取报告原文与元信息；未导入 → None。"""
    init()
    with get_conn(config.DB_PATH) as con:
        row = con.execute(
            "SELECT id, title, html, bytes, sha256, updated_at FROM ct_report WHERE id=?",
            (config.REPORT_ID,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "title": row[1],
        "html": row[2],
        "bytes": row[3],
        "sha256": row[4],
        "updated_at": row[5],
    }


def report_meta() -> dict | None:
    """只要元信息（不取正文）—— 列表/状态接口用，避免把 800 KB 原文拖进 JSON。"""
    report = get_report()
    if report is None:
        return None
    report.pop("html", None)
    return report


def delete_report() -> bool:
    """删除报告；返回是否真的删掉了。"""
    init()
    with get_conn(config.DB_PATH) as con:
        cur = con.execute("DELETE FROM ct_report WHERE id=?", (config.REPORT_ID,))
        return cur.rowcount > 0


# ------------------------------------------------------------ 口令校验（独立计数）


def verify_share_password(password: str) -> tuple[bool, str, int]:
    """校验分享口令 + 防在线爆破。返回 ``(ok, message, http_status)``。

    状态码口径与全站一致：200 通过 / 401 密码错 / 429 锁定中。
    """
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
    """清零失败计数与锁定（改口令后调用）。"""
    init()
    with get_conn(config.DB_PATH) as con:
        con.execute(
            "INSERT OR IGNORE INTO security_lock (id, fail_count, locked_until) VALUES (1,0,0)")
        con.execute("UPDATE security_lock SET fail_count=0, locked_until=0 WHERE id=1")
