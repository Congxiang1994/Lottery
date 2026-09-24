"""睡前故事 sqlite 存储：故事表 + API 密钥表 + 调用日志表。

路径 /data/lottery/story.db（独立文件，与彩票/触发器库解耦），
复用 app/common/db.py 的 WAL 连接抽象（含 0600 权限硬化）。

关于明文密钥：本项目仅用于管理本人家里的睡前故事，由用户 2026-09-24 明确选择
**明文存储**（页面可直接查看/复制）。库文件权限 0600 + 目录 0700 由 common/db 保证，
接口层不外泄到日志。
"""
from __future__ import annotations

import fcntl
import secrets
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.common.db import get_conn
from app.story.config import (
    CALLS_KEEP_DAYS,
    DB_PATH,
    DEFAULT_DAILY_QUOTA,
    DEFAULT_TOTAL_QUOTA,
    KEY_BYTES,
    KEY_PREFIX,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS stories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    story_date  TEXT    NOT NULL,                 -- YYYY-MM-DD，排序主键
    content     TEXT    NOT NULL,
    summary     TEXT    NOT NULL DEFAULT '',
    tags        TEXT    NOT NULL DEFAULT '',
    audio_url   TEXT    NOT NULL DEFAULT '',
    cover_url   TEXT    NOT NULL DEFAULT '',
    published   INTEGER NOT NULL DEFAULT 0,       -- 1 已发布 / 0 草稿
    source      TEXT    NOT NULL DEFAULT 'manual',
    created_at  TEXT    NOT NULL DEFAULT '',
    updated_at  TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_story_date ON stories (story_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_story_published ON stories (published, story_date DESC);

CREATE TABLE IF NOT EXISTS api_keys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    api_key       TEXT    NOT NULL UNIQUE,        -- 明文（用户选定策略）
    key_prefix    TEXT    NOT NULL DEFAULT '',
    enabled       INTEGER NOT NULL DEFAULT 1,
    daily_quota   INTEGER NOT NULL DEFAULT 1000,  -- 0 = 不限
    total_quota   INTEGER NOT NULL DEFAULT 0,     -- 0 = 不限
    calls_total   INTEGER NOT NULL DEFAULT 0,
    calls_today   INTEGER NOT NULL DEFAULT 0,
    today_date    TEXT    NOT NULL DEFAULT '',    -- calls_today 对应的日期
    last_used_at  TEXT    NOT NULL DEFAULT '',
    last_used_ip  TEXT    NOT NULL DEFAULT '',
    note          TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS api_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id      INTEGER,
    key_name    TEXT    NOT NULL DEFAULT '',      -- 冗余：密钥删除后日志仍可读
    ts          TEXT    NOT NULL,
    method      TEXT    NOT NULL DEFAULT '',
    path        TEXT    NOT NULL DEFAULT '',
    status_code INTEGER,
    latency_ms  REAL,
    ip          TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_calls_ts ON api_calls (ts DESC);
CREATE INDEX IF NOT EXISTS idx_calls_key ON api_calls (key_id, ts DESC);
"""


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def init() -> None:
    """建表（幂等，且多 worker 并发安全）。

    ⚠️ 为什么需要文件锁：gunicorn 以 ``-w 2`` 启动，两个 worker 会同时执行
    ``PRAGMA journal_mode=WAL`` + ``CREATE TABLE``。**首次建库**时二者都要拿
    独占锁，其中一个必抛 ``sqlite3.OperationalError: database is locked``；
    启动钩子抛异常 → gunicorn 判定 "Worker failed to boot" → 整个 master 退出。
    2026-09-24 首次上线实测踩到（systemd 靠 restart 才拉起来，属侥幸）。
    SQLite 的 busy_timeout 对 ``PRAGMA journal_mode`` 不生效，所以在库文件旁
    放一把 flock 排他锁，把建表阶段串行化。
    """
    lock_file = None
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        lock_file = open(DB_PATH.parent / f"{DB_PATH.name}.init.lock", "w")
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
    except OSError:
        lock_file = None  # 锁不可用（非常规文件系统）时退化为无锁，建表本身仍幂等
    try:
        with get_conn(DB_PATH) as con:
            con.executescript(_SCHEMA)
    finally:
        if lock_file is not None:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            finally:
                lock_file.close()


# ------------------------------------------------------------ 故事 CRUD


def _row_to_story(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "story_date": row["story_date"],
        "content": row["content"],
        "summary": row["summary"],
        "tags": row["tags"],
        "audio_url": row["audio_url"],
        "cover_url": row["cover_url"],
        "published": bool(row["published"]),
        "source": row["source"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _story_where(
    *,
    published: str = "",
    q: str,
    date_from: str,
    date_to: str,
    exact_date: str,
) -> tuple[str, list[Any]]:
    """拼 WHERE 子句。published: "" 不限 / "1" 仅已发布 / "0" 仅草稿。"""
    where: list[str] = []
    args: list[Any] = []
    if published in ("0", "1"):
        where.append("published = ?")
        args.append(int(published))
    if exact_date:
        where.append("story_date = ?")
        args.append(exact_date)
    if date_from:
        where.append("story_date >= ?")
        args.append(date_from)
    if date_to:
        where.append("story_date <= ?")
        args.append(date_to)
    if q:
        like = f"%{q}%"
        where.append("(title LIKE ? OR content LIKE ? OR tags LIKE ?)")
        args.extend([like, like, like])
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return clause, args


def list_stories(
    *,
    published: str = "",
    limit: int = 20,
    offset: int = 0,
    q: str = "",
    date_from: str = "",
    date_to: str = "",
    exact_date: str = "",
) -> dict[str, Any]:
    """按 story_date 倒序分页返回（同日期新写的在前）。"""
    limit = max(1, min(int(limit or 20), 200))
    offset = max(0, int(offset or 0))
    clause, args = _story_where(
        published=published,
        q=q,
        date_from=date_from,
        date_to=date_to,
        exact_date=exact_date,
    )
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        total = con.execute(f"SELECT COUNT(*) FROM stories{clause}", args).fetchone()[0]
        rows = con.execute(
            f"SELECT * FROM stories{clause} ORDER BY story_date DESC, id DESC LIMIT ? OFFSET ?",
            [*args, limit, offset],
        ).fetchall()
    return {"total": int(total), "items": [_row_to_story(r) for r in rows]}


def get_story(story_id: int, *, published: str = "") -> dict[str, Any] | None:
    sql = "SELECT * FROM stories WHERE id=?"
    args: list[Any] = [story_id]
    if published in ("0", "1"):
        sql += " AND published=?"
        args.append(int(published))
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute(sql, args).fetchone()
    return _row_to_story(row) if row else None


def create_story(data: dict[str, Any], *, source: str = "manual") -> dict[str, Any]:
    now = _now()
    with get_conn(DB_PATH) as con:
        cur = con.execute(
            "INSERT INTO stories"
            " (title, story_date, content, summary, tags, audio_url, cover_url,"
            "  published, source, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                data["title"],
                data["story_date"],
                data["content"],
                data.get("summary", ""),
                data.get("tags", ""),
                data.get("audio_url", ""),
                data.get("cover_url", ""),
                1 if data.get("published", True) else 0,
                source,
                now,
                now,
            ),
        )
        story_id = cur.lastrowid
    return get_story(story_id)  # type: ignore[return-value]


def update_story(story_id: int, data: dict[str, Any]) -> dict[str, Any] | None:
    """部分更新：只覆盖传入的字段（未出现的键保持原值）。"""
    fields = (
        "title",
        "story_date",
        "content",
        "summary",
        "tags",
        "audio_url",
        "cover_url",
    )
    sets: list[str] = []
    args: list[Any] = []
    for f in fields:
        if f in data:
            sets.append(f"{f}=?")
            args.append(data[f])
    if "published" in data:
        sets.append("published=?")
        args.append(1 if data["published"] else 0)
    if not sets:
        return get_story(story_id)
    sets.append("updated_at=?")
    args.append(_now())
    args.append(story_id)
    with get_conn(DB_PATH) as con:
        cur = con.execute(f"UPDATE stories SET {', '.join(sets)} WHERE id=?", args)
        if cur.rowcount == 0:
            return None
    return get_story(story_id)


def set_published(story_id: int, published: bool) -> dict[str, Any] | None:
    with get_conn(DB_PATH) as con:
        cur = con.execute(
            "UPDATE stories SET published=?, updated_at=? WHERE id=?",
            (1 if published else 0, _now(), story_id),
        )
        if cur.rowcount == 0:
            return None
    return get_story(story_id)


def delete_story(story_id: int) -> bool:
    with get_conn(DB_PATH) as con:
        cur = con.execute("DELETE FROM stories WHERE id=?", (story_id,))
        return cur.rowcount > 0


# ------------------------------------------------------------ API 密钥


def generate_key() -> str:
    return KEY_PREFIX + secrets.token_hex(KEY_BYTES)


def _row_to_key(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "api_key": row["api_key"],          # 明文（页面可查看复制）
        "key_prefix": row["key_prefix"],
        "enabled": bool(row["enabled"]),
        "daily_quota": row["daily_quota"],
        "total_quota": row["total_quota"],
        "calls_total": row["calls_total"],
        "calls_today": row["calls_today"] if row["today_date"] == _today() else 0,
        "last_used_at": row["last_used_at"],
        "last_used_ip": row["last_used_ip"],
        "note": row["note"],
        "created_at": row["created_at"],
    }


def list_keys() -> list[dict[str, Any]]:
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT * FROM api_keys ORDER BY id DESC").fetchall()
    return [_row_to_key(r) for r in rows]


def get_key(key_id: int, *, with_secret: bool = True) -> dict[str, Any] | None:
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM api_keys WHERE id=?", (key_id,)).fetchone()
    if not row:
        return None
    d = _row_to_key(row)
    if not with_secret:
        d.pop("api_key", None)
    return d


def create_key(data: dict[str, Any]) -> dict[str, Any]:
    api_key = generate_key()
    with get_conn(DB_PATH) as con:
        cur = con.execute(
            "INSERT INTO api_keys"
            " (name, api_key, key_prefix, enabled, daily_quota, total_quota, note, created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (
                data["name"],
                api_key,
                api_key[:12],
                1 if data.get("enabled", True) else 0,
                int(data.get("daily_quota", DEFAULT_DAILY_QUOTA) or 0),
                int(data.get("total_quota", DEFAULT_TOTAL_QUOTA) or 0),
                data.get("note", ""),
                _now(),
            ),
        )
        key_id = cur.lastrowid
    return get_key(key_id)  # type: ignore[return-value]


def update_key(key_id: int, data: dict[str, Any]) -> dict[str, Any] | None:
    sets: list[str] = []
    args: list[Any] = []
    if "name" in data:
        sets.append("name=?")
        args.append(str(data["name"]).strip())
    if "note" in data:
        sets.append("note=?")
        args.append(str(data["note"]).strip())
    if "daily_quota" in data:
        sets.append("daily_quota=?")
        args.append(int(data["daily_quota"] or 0))
    if "total_quota" in data:
        sets.append("total_quota=?")
        args.append(int(data["total_quota"] or 0))
    if "enabled" in data:
        sets.append("enabled=?")
        args.append(1 if data["enabled"] else 0)
    if not sets:
        return get_key(key_id)
    args.append(key_id)
    with get_conn(DB_PATH) as con:
        cur = con.execute(f"UPDATE api_keys SET {', '.join(sets)} WHERE id=?", args)
        if cur.rowcount == 0:
            return None
    return get_key(key_id)


def set_key_enabled(key_id: int, enabled: bool) -> dict[str, Any] | None:
    return update_key(key_id, {"enabled": enabled})


def reset_key_calls(key_id: int, scope: str = "today") -> dict[str, Any] | None:
    """重置调用计数。scope=today 只清今日；scope=all 清今日+累计。"""
    if scope == "all":
        sql = "UPDATE api_keys SET calls_today=0, calls_total=0, today_date=? WHERE id=?"
    else:
        sql = "UPDATE api_keys SET calls_today=0, today_date=? WHERE id=?"
    with get_conn(DB_PATH) as con:
        cur = con.execute(sql, (_today(), key_id))
        if cur.rowcount == 0:
            return None
    return get_key(key_id)


def delete_key(key_id: int) -> bool:
    with get_conn(DB_PATH) as con:
        cur = con.execute("DELETE FROM api_keys WHERE id=?", (key_id,))
        return cur.rowcount > 0


def authenticate_key(api_key: str, *, ip: str) -> tuple[str, dict[str, Any] | None]:
    """校验密钥 + 跨日重置 + 配额校验 + 计数自增，**一条 SQL 原子完成**。

    返回 (结果, 密钥行)：
      "ok"       放行（计数已 +1）
      "invalid"  密钥不存在
      "disabled" 密钥已停用
      "quota"    超出每日/累计配额

    为什么把判断与自增写进同一条 UPDATE：gunicorn 起 2 个 worker，
    「先查余额再自增」是 check-then-act，并发下必然超发；SQLite 写锁把 UPDATE
    串行化，靠 rowcount==1 判定放行即可（同 trigger_leases 原子租约的思路）。
    """
    if not api_key:
        return "invalid", None
    today = _today()
    now = _now()
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM api_keys WHERE api_key=?", (api_key,)).fetchone()
        if row is None:
            return "invalid", None
        if not row["enabled"]:
            return "disabled", _row_to_key(row)
        cur = con.execute(
            "UPDATE api_keys"
            " SET calls_today = CASE WHEN today_date = ? THEN calls_today + 1 ELSE 1 END,"
            "     today_date = ?,"
            "     calls_total = calls_total + 1,"
            "     last_used_at = ?,"
            "     last_used_ip = ?"
            " WHERE id = ? AND enabled = 1"
            "   AND (daily_quota = 0 OR today_date <> ? OR calls_today < daily_quota)"
            "   AND (total_quota = 0 OR calls_total < total_quota)",
            (today, today, now, ip, row["id"], today),
        )
        if cur.rowcount != 1:
            return "quota", _row_to_key(row)
        fresh = con.execute("SELECT * FROM api_keys WHERE id=?", (row["id"],)).fetchone()
    return "ok", _row_to_key(fresh)


# ------------------------------------------------------------ 调用日志


def record_call(
    *,
    key_id: int | None,
    key_name: str,
    method: str,
    path: str,
    status_code: int,
    latency_ms: float | None = None,
    ip: str = "",
) -> None:
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT INTO api_calls (key_id, key_name, ts, method, path, status_code, latency_ms, ip)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (key_id, key_name, _now(), method, path, status_code, latency_ms, ip),
        )


def list_calls(limit: int = 50, key_id: int | None = None) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 50), 500))
    sql = "SELECT * FROM api_calls"
    args: list[Any] = []
    if key_id:
        sql += " WHERE key_id=?"
        args.append(key_id)
    sql += " ORDER BY ts DESC, id DESC LIMIT ?"
    args.append(limit)
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(sql, args).fetchall()
    return [dict(r) for r in rows]


def calls_summary(days: int = 7) -> dict[str, Any]:
    """今日/近 N 日调用统计（全部密钥合计）。"""
    today = _today()
    since = datetime.now().timestamp() - days * 86400
    since_str = datetime.fromtimestamp(since).strftime("%Y-%m-%d 00:00:00")
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        calls_today = con.execute(
            "SELECT COUNT(*) FROM api_calls WHERE substr(ts,1,10)=?", (today,)
        ).fetchone()[0]
        calls_window = con.execute(
            "SELECT COUNT(*) FROM api_calls WHERE ts >= ?", (since_str,)
        ).fetchone()[0]
        keys_total = con.execute("SELECT COUNT(*) FROM api_keys").fetchone()[0]
        keys_enabled = con.execute(
            "SELECT COUNT(*) FROM api_keys WHERE enabled=1"
        ).fetchone()[0]
        quota_sum = con.execute(
            "SELECT COALESCE(SUM(calls_today),0) FROM api_keys WHERE today_date=?",
            (today,),
        ).fetchone()[0]
    return {
        "calls_today": int(calls_today),
        "calls_window": int(calls_window),
        "window_days": days,
        "keys_total": int(keys_total),
        "keys_enabled": int(keys_enabled),
        "keys_calls_today": int(quota_sum),
        "today": today,
    }


def cleanup_calls() -> int:
    """删除超过保留期的调用日志（管理页每次拉取时顺手清一次）。

    截止时刻用**本地时间**计算：api_calls.ts 写的是本地时间，若用 SQLite 的
    datetime('now')（UTC）会平白少删 8 小时的数据。
    """
    cutoff = (datetime.now() - timedelta(days=CALLS_KEEP_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(DB_PATH) as con:
        cur = con.execute("DELETE FROM api_calls WHERE ts < ?", (cutoff,))
        return cur.rowcount
