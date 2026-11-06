"""算法结果 SQLite 存储。

设计
----
每天跑一次全量 89 个算法 × 2 彩种 = 178 行，每行包含一次完整预测。
表结构保证 (lottery, algo_id, run_date) 唯一，重跑当天数据会 UPSERT。
查询「最新一批」就是 ORDER BY run_date DESC LIMIT 89*2 后筛 lottery。

路径：/data/lottery/algo_results.db（独立于部署目录，重部署不丢数据）
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Iterable

from app.common.db import get_conn, init_schema
from app.common.paths import db_path
from app.common.security import (  # noqa: F401  (verify_password 对外兼容，见模块尾部)
    verify_password,
)
from app.lottery.algorithms.base import CATEGORIES

# 固定持久化路径：放在项目目录之外，部署（rsync / git pull）不会覆盖或清空。
# 除非表结构变更，否则不要删除此目录下的数据。
# 本地开发可用环境变量 LOTTERY_DB_DIR 覆盖（如 /tmp/lottery_db）。
DB_PATH = db_path("algo_results")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS algo_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lottery     TEXT    NOT NULL,
    algo_id     TEXT    NOT NULL,
    algo_name   TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    run_date    TEXT    NOT NULL,    -- YYYY-MM-DD
    issue_base  TEXT    NOT NULL,
    red         TEXT    NOT NULL,    -- JSON
    blue        TEXT    NOT NULL,    -- JSON
    red_conf    TEXT    NOT NULL,    -- JSON
    blue_conf   TEXT    NOT NULL,    -- JSON
    detail      TEXT    NOT NULL,    -- JSON
    elapsed_ms  REAL    NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (lottery, algo_id, run_date)
);
CREATE INDEX IF NOT EXISTS idx_lottery_date ON algo_results (lottery, run_date DESC);

-- 全量运行进度（跨 gunicorn worker 共享，算法广场「运行全部」轮询用）
CREATE TABLE IF NOT EXISTS run_progress (
    lottery     TEXT PRIMARY KEY,
    running     INTEGER NOT NULL DEFAULT 0,
    done        INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    done_weight REAL    NOT NULL DEFAULT 0,
    total_weight REAL   NOT NULL DEFAULT 0,
    current     TEXT    NOT NULL DEFAULT '',
    elapsed     REAL    NOT NULL DEFAULT 0,
    eta         REAL    NOT NULL DEFAULT 0,
    phase       TEXT    NOT NULL DEFAULT 'predict',
    error       TEXT,
    started_at  TEXT,
    finished_at TEXT,
    updated_at  TEXT
);

-- 回测结果缓存（跨 worker 共享，按数据期号失效）
CREATE TABLE IF NOT EXISTS backtest_cache (
    lottery     TEXT NOT NULL,
    folds       INTEGER NOT NULL,
    max_cost    INTEGER NOT NULL,
    issue_base  TEXT NOT NULL,
    payload     TEXT NOT NULL,
    run_date    TEXT NOT NULL,
    PRIMARY KEY (lottery, folds, max_cost)
);

-- 回测计算互斥锁（防止多 gunicorn worker 并发算同一份回测）
CREATE TABLE IF NOT EXISTS backtest_lock (
    lottery     TEXT NOT NULL,
    folds       INTEGER NOT NULL,
    max_cost    INTEGER NOT NULL,
    ts          REAL NOT NULL,
    PRIMARY KEY (lottery, folds, max_cost)
);

-- 密码校验流控（单行，跨 worker 限频：同一秒仅允许 1 次）
-- fail_count / locked_until：连续失败计数与锁定截止时刻（防在线爆破）
CREATE TABLE IF NOT EXISTS security_lock (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_verify_ts  REAL,
    last_verify_ok  INTEGER,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    locked_until    REAL NOT NULL DEFAULT 0
);

-- 全局运行互斥锁（单行，串行化「运行全部算法」防并发）
CREATE TABLE IF NOT EXISTS global_run_lock (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    running     INTEGER NOT NULL DEFAULT 0,
    started_at  TEXT,
    updated_at  TEXT
);
"""


def _conn():
    """SQLite 连接上下文（WAL）。实现抽到 common/db.get_conn，此处兼容历史调用。"""
    return get_conn(DB_PATH)


#: 兼容旧库的补列 DDL（单条失败 = 列已存在，自动跳过）。
#: 🔴 依赖新列的 ``CREATE INDEX`` 一律放这里，别写进 ``_SCHEMA``。
_MIGRATIONS = (
    "ALTER TABLE run_progress ADD COLUMN phase TEXT NOT NULL DEFAULT 'predict'",
    "ALTER TABLE security_lock ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE security_lock ADD COLUMN locked_until REAL NOT NULL DEFAULT 0",
)


def init() -> None:
    """建表 + 补列（flock 串行化，多 worker 首启安全）。"""
    init_schema(DB_PATH, _SCHEMA, migrations=_MIGRATIONS)


def save_batch(results: Iterable[dict], lottery: str, run_date: str | None = None) -> int:
    """一次性写一批算法结果；upsert 行为：同日重跑会覆盖。

    每条 dict 需包含: id, name, category, red, blue, red_conf, blue_conf, detail, elapsed_ms
    """
    if run_date is None:
        run_date = datetime.now().strftime("%Y-%m-%d")
    rows = []
    for r in results:
        rows.append((
            lottery, r["id"], r["name"], r["category"],
            run_date, r.get("issue_base", ""),
            json.dumps(r["red"], ensure_ascii=False),
            json.dumps(r["blue"], ensure_ascii=False),
            json.dumps(r.get("red_conf", []), ensure_ascii=False),
            json.dumps(r.get("blue_conf", []), ensure_ascii=False),
            json.dumps(r.get("detail", {}), ensure_ascii=False, default=str),
            float(r.get("elapsed_ms", 0.0)),
        ))
    if not rows:
        return 0
    with _conn() as con:
        con.executemany(
            """INSERT OR REPLACE INTO algo_results
               (lottery, algo_id, algo_name, category, run_date, issue_base,
                red, blue, red_conf, blue_conf, detail, elapsed_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
    return len(rows)


def latest(lottery: str) -> dict | None:
    """取该彩种最新一批的全部算法结果。

    返回 {"run_date": "2026-08-18", "issue_base": "...", "results": [...]}
    若库为空返回 None。
    """
    with _conn() as con:
        cur = con.execute(
            """SELECT run_date, issue_base FROM algo_results
               WHERE lottery = ?
               ORDER BY run_date DESC, id ASC LIMIT 1""",
            (lottery,),
        )
        head = cur.fetchone()
        if not head:
            return None
        run_date, issue_base = head
        cur = con.execute(
            """SELECT algo_id, algo_name, category, red, blue,
                      red_conf, blue_conf, detail, elapsed_ms
               FROM algo_results
               WHERE lottery = ? AND run_date = ?
               ORDER BY category, algo_id""",
            (lottery, run_date),
        )
        results = []
        for (aid, name, cat, red, blue, rc, bc, det, ms) in cur.fetchall():
            results.append({
                "id": aid, "name": name, "category": cat,
                "category_name": CATEGORIES.get(cat, {}).get("name", cat),
                "red": json.loads(red), "blue": json.loads(blue),
                "red_conf": json.loads(rc), "blue_conf": json.loads(bc),
                "detail": json.loads(det), "elapsed_ms": ms,
            })
    return {"run_date": run_date, "issue_base": issue_base,
            "lottery": lottery, "count": len(results), "results": results}


def summary() -> list[dict]:
    """全局最近一批：每个彩种一行摘要。"""
    with _conn() as con:
        cur = con.execute(
            """SELECT lottery, run_date, issue_base, COUNT(*) AS n
               FROM algo_results
               WHERE run_date = (SELECT MAX(run_date) FROM algo_results)
               GROUP BY lottery, run_date"""
        )
        return [
            {"lottery": r[0], "run_date": r[1], "issue_base": r[2], "count": r[3]}
            for r in cur.fetchall()
        ]


def runs(lottery: str, limit: int = 14) -> list[str]:
    """列出该彩种最近 N 天的 run_date。"""
    with _conn() as con:
        cur = con.execute(
            """SELECT DISTINCT run_date FROM algo_results
               WHERE lottery = ?
               ORDER BY run_date DESC LIMIT ?""",
            (lottery, limit),
        )
        return [r[0] for r in cur.fetchall()]


def runs_before(lottery: str, date: str, limit: int = 1) -> list[str]:
    """该彩种在 date（含）之前最近 limit 次 run_date（降序）。"""
    with _conn() as con:
        cur = con.execute(
            """SELECT DISTINCT run_date FROM algo_results
               WHERE lottery = ? AND run_date <= ?
               ORDER BY run_date DESC LIMIT ?""",
            (lottery, date, limit),
        )
        return [r[0] for r in cur.fetchall()]


def batch_by_dates(lottery: str, run_dates: list[str]) -> dict[str, list[dict]]:
    """按多个 run_date 一次性取整批结果（轻量版：裁掉 detail/conf/scores）。

    返回 {run_date: [{id, name, category, red, blue}, ...]}，
    未出现在返回中的 run_date 表示该日无跑批数据。
    """
    if not run_dates:
        return {}
    marks = ",".join("?" for _ in run_dates)
    with _conn() as con:
        cur = con.execute(
            f"""SELECT run_date, algo_id, algo_name, category, red, blue
                FROM algo_results
                WHERE lottery = ? AND run_date IN ({marks})
                ORDER BY run_date DESC, category, algo_id""",
            (lottery, *run_dates),
        )
        out: dict[str, list[dict]] = {d: [] for d in run_dates}
        for (rd, aid, name, cat, red, blue) in cur.fetchall():
            if rd in out:
                out[rd].append({
                    "id": aid, "name": name, "category": cat,
                    "red": json.loads(red), "blue": json.loads(blue),
                })
        return {d: v for d, v in out.items() if v}


def by_date(lottery: str, run_date: str) -> dict | None:
    """按 run_date 取整批。"""
    with _conn() as con:
        cur = con.execute(
            """SELECT issue_base FROM algo_results
               WHERE lottery = ? AND run_date = ?
               ORDER BY id LIMIT 1""",
            (lottery, run_date),
        )
        head = cur.fetchone()
        if not head:
            return None
        issue_base = head[0]
        cur = con.execute(
            """SELECT algo_id, algo_name, category, red, blue,
                      red_conf, blue_conf, detail, elapsed_ms
               FROM algo_results
               WHERE lottery = ? AND run_date = ?
               ORDER BY category, algo_id""",
            (lottery, run_date),
        )
        results = [
            {"id": aid, "name": name, "category": cat,
             "category_name": CATEGORIES.get(cat, {}).get("name", cat),
             "red": json.loads(red), "blue": json.loads(blue),
             "red_conf": json.loads(rc), "blue_conf": json.loads(bc),
             "detail": json.loads(det), "elapsed_ms": ms}
            for (aid, name, cat, red, blue, rc, bc, det, ms) in cur.fetchall()
        ]
    return {"run_date": run_date, "issue_base": issue_base,
            "lottery": lottery, "count": len(results), "results": results}


# ------------------------------------------------------------ 全量运行进度


def progress_start(lottery: str, total: int, total_weight: float,
                   phase: str = "predict") -> bool:
    """抢占式启动：仅当该彩种无任务在跑时成功（跨 worker 原子）。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as con:
        cur = con.execute(
            """UPDATE run_progress SET running=1, done=0, total=?, done_weight=0,
               total_weight=?, current='', elapsed=0, eta=0, phase=?, error=NULL,
               started_at=?, finished_at=NULL, updated_at=?
               WHERE lottery=? AND running=0""",
            (total, total_weight, phase, now, now, lottery),
        )
        if cur.rowcount == 0:
            # 首次启动（无行）或已在运行
            cur = con.execute(
                "SELECT running FROM run_progress WHERE lottery=?", (lottery,))
            row = cur.fetchone()
            if row and row[0]:
                return False
            con.execute(
                """INSERT OR REPLACE INTO run_progress
                   (lottery, running, done, total, done_weight, total_weight,
                    current, elapsed, eta, phase, error, started_at, finished_at, updated_at)
                   VALUES (?,1,0,?,0,?,'',0,0,?,NULL,?,NULL,?)""",
                (lottery, total, total_weight, phase, now, now),
            )
    return True


def progress_update(lottery: str, done: int, done_weight: float,
                    current: str, elapsed: float, eta: float,
                    phase: str | None = None) -> None:
    if phase is None:
        with _conn() as con:
            con.execute(
                """UPDATE run_progress SET done=?, done_weight=?, current=?,
                   elapsed=?, eta=?, updated_at=?
                   WHERE lottery=?""",
                (done, done_weight, current, elapsed, eta,
                 datetime.now().strftime("%Y-%m-%d %H:%M:%S"), lottery),
            )
    else:
        with _conn() as con:
            con.execute(
                """UPDATE run_progress SET done=?, done_weight=?, current=?,
                   elapsed=?, eta=?, phase=?, updated_at=?
                   WHERE lottery=?""",
                (done, done_weight, current, elapsed, eta, phase,
                 datetime.now().strftime("%Y-%m-%d %H:%M:%S"), lottery),
            )


def progress_finish(lottery: str, error: str | None = None) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as con:
        con.execute(
            """UPDATE run_progress SET running=0, error=?, finished_at=?,
               updated_at=? WHERE lottery=?""",
            (error, now, now, lottery),
        )


def progress_status(lottery: str) -> dict:
    with _conn() as con:
        cur = con.execute(
            """SELECT running, done, total, done_weight, total_weight, current,
                      elapsed, eta, phase, error, started_at, finished_at
               FROM run_progress WHERE lottery=?""",
            (lottery,),
        )
        row = cur.fetchone()
    if not row:
        return {"lottery": lottery, "running": False, "done": 0, "total": 0,
                "current": "", "elapsed": 0.0, "eta": 0.0, "phase": "predict",
                "error": None, "started_at": None, "finished_at": None,
                "percent": 0}
    (running, done, total, dw, tw, current, elapsed, eta, phase,
     error, started, finished) = row
    percent = round(done / total * 100, 1) if total else 0
    return {"lottery": lottery, "running": bool(running), "done": done,
            "total": total, "done_weight": dw, "total_weight": tw,
            "current": current, "elapsed": round(elapsed, 1),
            "eta": round(eta, 1), "phase": phase, "error": error,
            "started_at": started, "finished_at": finished, "percent": percent}


# ------------------------------------------------------------ 回测缓存


def backtest_get(lottery: str, folds: int, max_cost: int, issue_base: str) -> dict | None:
    with _conn() as con:
        cur = con.execute(
            """SELECT payload FROM backtest_cache
               WHERE lottery=? AND folds=? AND max_cost=? AND issue_base=?""",
            (lottery, folds, max_cost, issue_base),
        )
        row = cur.fetchone()
    if not row:
        return None
    return json.loads(row[0])


def backtest_put(lottery: str, folds: int, max_cost: int, issue_base: str,
                 payload: dict) -> None:
    with _conn() as con:
        con.execute(
            """INSERT OR REPLACE INTO backtest_cache
               (lottery, folds, max_cost, issue_base, payload, run_date)
               VALUES (?,?,?,?,?,?)""",
            (lottery, folds, max_cost, issue_base,
             json.dumps(payload, ensure_ascii=False, default=str),
             datetime.now().strftime("%Y-%m-%d")),
        )


def backtest_claim(lottery: str, folds: int, max_cost: int,
                   ttl: float = 1800.0) -> bool:
    """尝试抢占回测计算锁（跨 worker 原子）。

    已有未过期的锁 → False（别人在算，别重复算）；
    无锁或锁已过期（视为死锁，可抢占）→ True。
    """
    import time as _time
    now = _time.time()
    with _conn() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT ts FROM backtest_lock WHERE lottery=? AND folds=? AND max_cost=?",
            (lottery, folds, max_cost)).fetchone()
        if row is not None and now - row[0] < ttl:
            return False
        con.execute(
            "INSERT OR REPLACE INTO backtest_lock (lottery, folds, max_cost, ts) VALUES (?,?,?,?)",
            (lottery, folds, max_cost, now))
    return True


def backtest_release(lottery: str, folds: int, max_cost: int) -> None:
    with _conn() as con:
        con.execute(
            "DELETE FROM backtest_lock WHERE lottery=? AND folds=? AND max_cost=?",
            (lottery, folds, max_cost))


# 模块加载即建表（幂等），确保 API 进程/定时脚本首次访问就有表
init()


# ------------------------------------------------------------ 安全锁 / 流控


# 密码校验流控已迁到 app.common.security（全站唯一实现）。
# 此处 re-export 是为了不弄脏既有调用点（lottery router / 各域 admin auth / 脚本）。
# 新代码请直接 ``from app.common.security import verify_password``。
verify_password = verify_password  # noqa: PLW0127  (显式声明对外契约，勿删)


def global_lock_start() -> bool:
    """获取全局运行互斥锁（跨 worker 原子）。已占用返回 False。"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as con:
        con.execute("BEGIN IMMEDIATE")
        con.execute("INSERT OR IGNORE INTO global_run_lock (id) VALUES (1)")
        row = con.execute(
            "SELECT running FROM global_run_lock WHERE id=1").fetchone()
        if row and row[0]:
            return False
        con.execute(
            "UPDATE global_run_lock SET running=1, started_at=?, updated_at=? WHERE id=1",
            (now, now))
    return True


def global_lock_end() -> None:
    with _conn() as con:
        con.execute(
            "UPDATE global_run_lock SET running=0, updated_at=? WHERE id=1",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),))


def global_lock_status() -> dict:
    with _conn() as con:
        cur = con.execute(
            "SELECT running, started_at, updated_at FROM global_run_lock WHERE id=1")
        row = cur.fetchone()
    if not row:
        return {"running": False, "started_at": None}
    return {"running": bool(row[0]), "started_at": row[1], "updated_at": row[2]}
