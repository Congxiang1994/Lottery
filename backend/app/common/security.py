"""密码校验流控 + 防在线爆破（全站唯一真源）。

历史：这套逻辑原本住在 ``app/lottery/services/results_store.py``，于是
trigger / story / babysong / access / smzdm 五个域都得反向 import 彩票域的实现，
形成「通用鉴权依赖业务域」的倒挂。现在独立到这里，彩票域只保留 ``verify_password``
的同名薄封装（保持既有调用点与脚本兼容）。

策略（2026-09-22 改造，替换原先「同一秒仅 1 次」的全局限频）
------------------------------------------------------------
- **成功不设限**：密码正确永远放行，「先校验再执行」这类连续两次校验不会被误伤。
- **失败计数**：连续失败 ≥ ``FAIL_THRESHOLD`` 次后进入锁定，时长按失败次数递增
  （30s → 60s → 120s → 300s → 900s 封顶），期间一律 429。
- 一旦成功，失败计数清零、锁定解除。

为什么换掉「同一秒 1 次」：那种限频对爆破的拦截力只有 86400 次/天，且会误伤正常流程；
失败递增锁定既更强也更好用。

密码本身由 ``app.common.password`` 以 scrypt 哈希存储（见该模块）。
"""
from __future__ import annotations

import time

from app.common import password as _password
from app.common.db import get_conn, init_schema
from app.common.paths import db_path

DB_PATH = db_path("algo_results")  # 与算法结果同库：单文件、少一次连接

SCHEMA = """
CREATE TABLE IF NOT EXISTS security_lock (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_verify_ts  REAL,
    last_verify_ok  INTEGER,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    locked_until    REAL NOT NULL DEFAULT 0
);
"""

_MIGRATIONS = (
    "ALTER TABLE security_lock ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE security_lock ADD COLUMN locked_until REAL NOT NULL DEFAULT 0",
)

# 防在线爆破：连续失败达到阈值后开始锁定，锁定时长按失败次数递增（封顶 900s）
FAIL_THRESHOLD = 5
LOCK_STEPS = (30.0, 60.0, 120.0, 300.0, 900.0)

_initialized = False


def init() -> None:
    """建表（幂等）。幂等标记放在进程内，避免每个请求都去抢锁。"""
    global _initialized
    if _initialized:
        return
    init_schema(DB_PATH, SCHEMA, migrations=_MIGRATIONS)
    _initialized = True


def verify_password(password: str) -> tuple[bool, str, int]:
    """校验密码 + 防在线爆破流控。返回 ``(ok, message, http_status)``。

    ``http_status`` 约定的取值：200 通过 / 401 密码错 / 429 锁定中。
    调用方直接照抄这三个状态码即可，不要再自己拼。
    """
    init()
    now = time.time()
    lock_step: float = 0.0
    fail_count = 0
    with get_conn(DB_PATH) as con:
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

        ok = _password.verify(password)
        if ok:
            fail_count, locked_until = 0, 0.0
        else:
            fail_count += 1
            if fail_count >= FAIL_THRESHOLD:
                lock_step = LOCK_STEPS[min(fail_count - FAIL_THRESHOLD, len(LOCK_STEPS) - 1)]
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
            f"密码错误（已连续失败 {fail_count} 次，累计 {FAIL_THRESHOLD} 次将临时锁定）",
            401)


def reset_failures() -> None:
    """清零失败计数与锁定（改密码后调用；目前仅测试/运维用）。"""
    init()
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT OR IGNORE INTO security_lock (id, fail_count, locked_until) VALUES (1,0,0)")
        con.execute(
            "UPDATE security_lock SET fail_count=0, locked_until=0 WHERE id=1")


__all__ = ["DB_PATH", "FAIL_THRESHOLD", "LOCK_STEPS", "init", "verify_password",
           "reset_failures"]
