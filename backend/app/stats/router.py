"""站点访问统计：极简累计计数器（无需登录，一次访问 +1）。

存储：/data/lottery/visit_stats.db（与 lottery 数据同目录，重部署不丢）。
本地测试可用环境变量 LOTTERY_DB_DIR 覆盖（如 /tmp/lottery_db）。
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter

from app.common.db import get_conn

router = APIRouter(prefix="/api/stats", tags=["stats"])

DB_PATH = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery")) / "visit_stats.db"


def _init_table(con) -> None:
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS visit_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    con.execute("INSERT OR IGNORE INTO visit_stats (id, total) VALUES (1, 0)")


def _get_total(con) -> int:
    row = con.execute("SELECT total FROM visit_stats WHERE id = 1").fetchone()
    return int(row[0]) if row else 0


@router.get("/visit")
def get_visits():
    """读取当前累计访问次数（不计数）。"""
    with get_conn(DB_PATH) as con:
        _init_table(con)
        return {"total": _get_total(con)}


@router.post("/visit")
def count_visit():
    """一次访问 +1（前端每个浏览器会话只上报一次，防刷新刷量）。"""
    with get_conn(DB_PATH) as con:
        _init_table(con)
        con.execute("UPDATE visit_stats SET total = total + 1 WHERE id = 1")
        return {"total": _get_total(con)}
