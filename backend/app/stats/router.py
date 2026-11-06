"""站点访问统计：累计人次 + 去重访客数（无需登录）。

口径：
- 人次（total）：打开网站的次数，同一浏览器会话（sessionStorage）只计一次。
  即旧版单计数器口径，历史数据原样延续。
- 人数（visitors）：不同浏览器/设备的数量。前端首次访问生成持久 UUID
  （localStorage）上报，服务端加盐 sha256 后存表去重（不存原始 ID、不碰 IP）。
  人数从功能上线之日起累计，历史访客无法回溯。

存储：/data/lottery/visit_stats.db（与 lottery 数据同目录，重部署不丢）。
本地测试可用环境变量 LOTTERY_DB_DIR 覆盖（如 /tmp/lottery_db）。
"""
from __future__ import annotations

import hashlib
import os

from fastapi import APIRouter

from app.common.db import get_conn, init_schema
from app.common.paths import db_path

router = APIRouter(prefix="/api/stats", tags=["stats"])

DB_PATH = db_path("visit_stats")

# 访客 ID 加盐哈希：即使 db 泄露也无法反推原始 UUID。
# 盐来自环境变量（部署时注入），缺失时退化为固定串（仍强于明文存 ID）。
_SALT = os.environ.get("LOTTERY_VISIT_SALT", "lottery-visit-salt")


def _visitor_hash(visitor_id: str) -> str:
    return hashlib.sha256((_SALT + visitor_id).encode("utf-8")).hexdigest()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS visit_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO visit_stats (id, total) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS visit_visitors (
    visitor_hash TEXT PRIMARY KEY,
    first_seen   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

_ready = False


def _init_table_locked(con=None) -> None:
    """建表（幂等 + flock 串行化，多 worker 首启不撞 database is locked）。

    统一走 ``app.common.db.init_schema`` —— 这里保留函数名以兼容既有调用点，
    实际实现已上移（其它域也是同一套，见 common/db.py 的说明）。
    进程内 ``_ready`` 让稳态下不再反复抢锁。
    """
    global _ready
    if _ready:
        return
    init_schema(DB_PATH, _SCHEMA)
    _ready = True


def _snapshot(con) -> dict:
    total = con.execute("SELECT total FROM visit_stats WHERE id = 1").fetchone()
    visitors = con.execute("SELECT COUNT(*) FROM visit_visitors").fetchone()
    return {
        "total": int(total[0]) if total else 0,
        "visitors": int(visitors[0]) if visitors else 0,
    }


def snapshot_totals() -> dict:
    """供访问管理 summary 复用：与左上角 Nav 同库同源的全站累计快照。

    库文件还没建（从未有人访问）时直接给 0；任何异常都降级为 0，
    不允许这里拖垮访问管理的概览接口。
    """
    try:
        if not DB_PATH.exists():
            return {"total": 0, "visitors": 0}
        with get_conn(DB_PATH) as con:
            _init_table_locked(con)
            return _snapshot(con)
    except Exception:
        return {"total": 0, "visitors": 0}


@router.get("/visit")
def get_visits():
    """读取当前累计（不计数）。返回 total=人次，visitors=去重人数。"""
    with get_conn(DB_PATH) as con:
        _init_table_locked(con)
        return _snapshot(con)


@router.post("/visit")
def count_visit(visitor_id: str | None = None):
    """一次访问 +1（前端每个浏览器会话只上报一次，防刷新刷量）。

    visitor_id 为前端 localStorage 里的持久 UUID：首次见到则记入访客表
    （INSERT OR IGNORE 幂等去重），缺省（旧前端缓存）时只计人次。
    """
    with get_conn(DB_PATH) as con:
        _init_table_locked(con)
        con.execute("UPDATE visit_stats SET total = total + 1 WHERE id = 1")
        if visitor_id:
            con.execute(
                "INSERT OR IGNORE INTO visit_visitors (visitor_hash) VALUES (?)",
                (_visitor_hash(visitor_id),),
            )
        return _snapshot(con)
