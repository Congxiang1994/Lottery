"""触发器 sqlite 存储：任务表 + 执行历史表。

路径 /data/lottery/trigger.db（独立文件，不与算法结果库耦合），
复用 app/common/db.py 的 WAL 连接抽象。
api_key 明文存储（目录文件权限保护），对外接口一律脱敏。
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from app.common.db import get_conn

from app.trigger.config import DB_PATH, HISTORY_KEEP_DAYS

_SCHEMA = """
CREATE TABLE IF NOT EXISTS trigger_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    time_hhmm   TEXT    NOT NULL,              -- HH:MM（服务器 CST）
    base_url    TEXT    NOT NULL,
    model       TEXT    NOT NULL DEFAULT '',
    api_key     TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    note        TEXT    NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS trigger_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER,
    task_name   TEXT    NOT NULL DEFAULT '',   -- 冗余：任务删除后历史仍可读
    fired_at    TEXT    NOT NULL,              -- 触发时刻 YYYY-MM-DD HH:MM:SS
    status      TEXT    NOT NULL,              -- success / failed / missed / firing
    http_code   INTEGER,
    latency_ms  REAL,
    retries     INTEGER NOT NULL DEFAULT 0,
    manual      INTEGER NOT NULL DEFAULT 0,
    error       TEXT    NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_history_fired ON trigger_history (fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_task_date ON trigger_history (task_id, fired_at);
"""


def init() -> None:
    with get_conn(DB_PATH) as con:
        con.executescript(_SCHEMA)


def mask_key(key: str) -> str:
    """api_key 脱敏：保留尾 4 位。"""
    if not key:
        return ""
    return "****" + key[-4:] if len(key) > 4 else "****"


def _row_to_task(row: sqlite3.Row, *, unmask: bool = False) -> dict[str, Any]:
    d = {
        "id": row["id"],
        "name": row["name"],
        "time": row["time_hhmm"],
        "base_url": row["base_url"],
        "model": row["model"],
        "enabled": bool(row["enabled"]),
        "note": row["note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "api_key_masked": mask_key(row["api_key"]),
    }
    if unmask:
        d["api_key"] = row["api_key"]
    return d


# ------------------------------------------------------------ 任务 CRUD


def list_tasks(*, with_key: bool = False) -> list[dict[str, Any]]:
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT * FROM trigger_tasks ORDER BY time_hhmm, id").fetchall()
    return [_row_to_task(r, unmask=with_key) for r in rows]


def get_task(task_id: int, *, with_key: bool = False) -> dict[str, Any] | None:
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM trigger_tasks WHERE id=?", (task_id,)).fetchone()
    return _row_to_task(row, unmask=with_key) if row else None


def create_task(data: dict[str, Any]) -> dict[str, Any]:
    with get_conn(DB_PATH) as con:
        cur = con.execute(
            "INSERT INTO trigger_tasks (name, time_hhmm, base_url, model, api_key, enabled, note)"
            " VALUES (?,?,?,?,?,?,?)",
            (
                str(data["name"]).strip(),
                str(data["time"]).strip(),
                str(data["base_url"]).strip().rstrip("/"),
                str(data.get("model", "")).strip(),
                str(data["api_key"]).strip(),
                1 if data.get("enabled", True) else 0,
                str(data.get("note", "")).strip(),
            ),
        )
        task_id = cur.lastrowid
    return get_task(task_id)  # type: ignore[return-value]


def update_task(task_id: int, data: dict[str, Any]) -> dict[str, Any] | None:
    """编辑任务。api_key 缺省/为空表示保留原值（更新即整体覆盖）。"""
    with get_conn(DB_PATH) as con:
        con.execute(
            "UPDATE trigger_tasks SET name=?, time_hhmm=?, base_url=?, model=?,"
            " api_key=CASE WHEN ?<>'' THEN ? ELSE api_key END,"
            " enabled=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (
                str(data["name"]).strip(),
                str(data["time"]).strip(),
                str(data["base_url"]).strip().rstrip("/"),
                str(data.get("model", "")).strip(),
                str(data.get("api_key", "")).strip(),
                str(data.get("api_key", "")).strip(),
                1 if data.get("enabled", True) else 0,
                str(data.get("note", "")).strip(),
                task_id,
            ),
        )
    return get_task(task_id)


def set_enabled(task_id: int, enabled: bool) -> dict[str, Any] | None:
    with get_conn(DB_PATH) as con:
        con.execute(
            "UPDATE trigger_tasks SET enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (1 if enabled else 0, task_id),
        )
    return get_task(task_id)


def delete_task(task_id: int) -> bool:
    with get_conn(DB_PATH) as con:
        cur = con.execute("DELETE FROM trigger_tasks WHERE id=?", (task_id,))
        return cur.rowcount > 0


def enabled_tasks_with_key() -> list[dict[str, Any]]:
    """调度器专用：启用的任务（含明文 key）。"""
    return list_tasks(with_key=True)


# ------------------------------------------------------------ 执行历史


def record_history(
    task_id: int | None,
    task_name: str,
    status: str,
    *,
    fired_at: str | None = None,
    http_code: int | None = None,
    latency_ms: float | None = None,
    retries: int = 0,
    manual: bool = False,
    error: str = "",
) -> None:
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT INTO trigger_history"
            " (task_id, task_name, fired_at, status, http_code, latency_ms, retries, manual, error)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                task_id,
                task_name,
                fired_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                status,
                http_code,
                latency_ms,
                retries,
                1 if manual else 0,
                error[:500],
            ),
        )


def has_record_today(
    task_id: int, date_str: str, statuses: tuple[str, ...] = ("success",)
) -> bool:
    """当日判重：该任务今天是否已存在指定状态的记录。

    - statuses=("success",)：触发幂等（调度器/重启防重复派发、页面「今日已触发」）
    - statuses=("success", "missed")：missed 判重（避免反复刷屏）
    """
    placeholders = ",".join("?" for _ in statuses)
    with get_conn(DB_PATH) as con:
        row = con.execute(
            f"SELECT 1 FROM trigger_history"
            f" WHERE task_id=? AND status IN ({placeholders}) AND fired_at LIKE ?"
            f" ORDER BY id DESC LIMIT 1",
            (task_id, *statuses, f"{date_str}%"),
        ).fetchone()
    return row is not None


def list_history(limit: int = 200) -> list[dict[str, Any]]:
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT * FROM trigger_history ORDER BY fired_at DESC, id DESC LIMIT ?",
            (max(1, min(limit, 500)),),
        ).fetchall()
    return [dict(r) for r in rows]


def cleanup_history() -> None:
    """删除超过保留期的历史（调度循环每日顺手清一次）。"""
    with get_conn(DB_PATH) as con:
        con.execute(
            "DELETE FROM trigger_history WHERE created_at < datetime('now', ?)",
            (f"-{HISTORY_KEEP_DAYS} days",),
        )
