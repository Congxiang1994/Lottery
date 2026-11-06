"""站点访问统计的存储层：建表 + 人次/人数快照。

口径说明见 ``app.stats.router`` 与 ``app.stats.config``。
这里只做 SQL，不关心 HTTP。
"""
from __future__ import annotations

import hashlib

from app.common.db import get_conn, init_schema
from app.stats.config import DB_PATH, SALT, SCHEMA

_ready = False


def init() -> None:
    """建表（幂等 + flock 串行化，多 worker 首启不撞 database is locked）。"""
    global _ready
    if _ready:
        return
    init_schema(DB_PATH, SCHEMA)
    _ready = True


def visitor_hash(visitor_id: str) -> str:
    """访客 ID 加盐哈希：即使库泄露也无法反推原始 UUID。"""
    return hashlib.sha256((SALT + visitor_id).encode("utf-8")).hexdigest()


def snapshot(con=None) -> dict:
    """返回 ``{"total": 人次, "visitors": 去重人数}``。"""
    if con is None:
        with get_conn(DB_PATH) as c:
            return snapshot(c)
    total = con.execute("SELECT total FROM visit_stats WHERE id = 1").fetchone()
    visitors = con.execute("SELECT COUNT(*) FROM visit_visitors").fetchone()
    return {
        "total": int(total[0]) if total else 0,
        "visitors": int(visitors[0]) if visitors else 0,
    }


def totals() -> dict:
    """供访问管理 summary 复用的全站累计快照。

    库文件还没建（从未有人访问）时直接给 0；任何异常都降级为 0，
    不允许这里拖垮访问管理的概览接口。
    """
    try:
        if not DB_PATH.exists():
            return {"total": 0, "visitors": 0}
        init()
        return snapshot()
    except Exception:
        return {"total": 0, "visitors": 0}


def record_visit(visitor_id: str | None = None) -> dict:
    """一次访问 +1（前端每个浏览器会话只上报一次，防刷新刷量）。

    ``visitor_id`` 首次见到则记入访客表（``INSERT OR IGNORE`` 幂等去重），
    缺省（旧前端缓存）时只计人次。返回最新快照。
    """
    init()
    with get_conn(DB_PATH) as con:
        con.execute("UPDATE visit_stats SET total = total + 1 WHERE id = 1")
        if visitor_id:
            con.execute(
                "INSERT OR IGNORE INTO visit_visitors (visitor_hash) VALUES (?)",
                (visitor_hash(visitor_id),),
            )
        return snapshot(con)
