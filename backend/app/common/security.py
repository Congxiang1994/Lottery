"""密码校验流控 + 防在线爆破（全站唯一真源）。

历史：这套逻辑原本住在 ``app/lottery/services/results_store.py``，于是
trigger / story / babysong / access / smzdm 五个域都得反向 import 彩票域的实现，
形成「通用鉴权依赖业务域」的倒挂。现在独立到这里，彩票域只保留 ``verify_password``
的同名薄封装（保持既有调用点与脚本兼容）。

策略（2026-09-22 改造，替换原先「同一秒仅 1 次」的全局限频）
------------------------------------------------------------
- **成功不设限**：密码正确永远放行，「先校验再执行」这类连续两次校验不会被误伤。
- **失败计数**：连续失败 ≥ ``FAIL_THRESHOLD`` 次后进入锁定，时长按失败次数递增
  （30s → 60s → 120s → 300s → 900s 封顶）。
- 一旦成功，失败计数清零、锁定解除。
- **锁定期内仍验证密码**（S10）：正确密码直接放行并清零，防止锁定期的 DoS；
  锁定到期时若 fail_count 已达阈值，衰减到 ``FAIL_THRESHOLD-1``（保留一次余量）。
- **scrypt 在锁外执行**（S6）：耗时 ~45ms 的口令哈希绝不占用 SQLite 写事务，
  只把「读状态 / 写计数」两个短事务放进临界区，用条件 UPDATE 保证并发正确。

为什么换掉「同一秒 1 次」：那种限频对爆破的拦截力只有 86400 次/天，且会误伤正常流程；
失败递增锁定既更强也更好用。

密码本身由 ``app.common.password`` 以 scrypt 哈希存储（见该模块）。
"""
from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

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


def verify_with_lock(
    verify_fn: Callable[[], bool],
    db_path: str | Path,
    *,
    fail_threshold: int = FAIL_THRESHOLD,
    lock_steps: tuple[float, ...] = LOCK_STEPS,
    init_fn: Callable[[], None] | None = None,
) -> tuple[bool, str, int]:
    """通用「校验口令 + 失败递增锁定」流程（全站唯一实现，S10/S6/M29）。

    参数
    ----
    verify_fn
        无参 callable，做实际口令比对、返回 bool。**在事务外调用**，因此
        scrypt（~45ms）不占 SQLite 写锁；ctshare 等域可传
        ``lambda: password.verify_in(config.DB_PATH, plain)``。
    db_path
        security_lock 表所在的 SQLite 库路径。
    fail_threshold / lock_steps
        失败阈值与锁定阶梯。ctshare 的常量与本模块一致，直接用默认值即可。
    init_fn
        可选的建表回调（如 ctsahre.store.init），在读状态前调用一次。

    返回 ``(ok, message, http_status)``，``http_status`` 取值：200 / 401 / 429。

    并发正确性
    ----------
    - 每次「读状态」用 ``BEGIN IMMEDIATE`` 短事务，拿到写锁后读到的 fail_count
      是串行化的，不会丢更新。
    - 写完状态**再次进短事务**，用条件 UPDATE
      ``WHERE fail_count=? AND locked_until=?`` 保证只有「状态未被其他人改过」
      的那一方能写入本次结果（CAS）；并发失败下后者重读最新计数再累加。
    - 锁定期内仍执行 verify_fn：正确口令直接放行清零；错误才返回 429。
      这样既堵住锁定 DoS，又不削弱爆破防护（错口令依旧 429）。
    """
    db_path = Path(db_path)
    if init_fn is not None:
        init_fn()
    now = time.time()

    # ---- 1) 短事务：读当前状态（写入锁串行化，避免读到并发中间态） ----
    with get_conn(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        con.execute(
            "INSERT OR IGNORE INTO security_lock (id, fail_count, locked_until) VALUES (1,0,0)")
        row = con.execute(
            "SELECT fail_count, locked_until FROM security_lock WHERE id=1").fetchone()
        fail_count = int(row[0] or 0) if row else 0
        locked_until = float(row[1] or 0) if row else 0.0
        expired_lock = locked_until > 0 and locked_until <= now
        if expired_lock and fail_count >= fail_threshold:
            # 锁定到期：保留一次余量，避免刚过期就因一次手误再次锁死（S10）。
            fail_count = fail_threshold - 1
            locked_until = 0.0
    was_locked = locked_until > now      # 仅用于「期内正确口令放行」的信息提示

    # ---- 2) 无锁做真正的口令校验（scrypt ~45ms 不占 SQLite 写锁，S6） ----
    ok = bool(verify_fn())

    # ---- 3) 短事务：CAS 写回新状态 ----
    new_fail, new_locked_until, lock_step = fail_count, locked_until, 0.0
    if ok:
        new_fail, new_locked_until = 0, 0.0
    else:
        new_fail += 1
        if new_fail >= fail_threshold:
            lock_step = lock_steps[min(new_fail - fail_threshold, len(lock_steps) - 1)]
            new_locked_until = now + lock_step

    with get_conn(db_path) as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT fail_count, locked_until FROM security_lock WHERE id=1").fetchone()
        cur_fail = int(row[0] or 0) if row else 0
        cur_locked = float(row[1] or 0) if row else 0.0
        if (cur_fail, cur_locked) != (fail_count, locked_until):
            # 状态被并发请求改过：以最新状态为准重算本次结果（保留 S10 衰减口径）。
            if cur_locked > 0 and cur_locked <= now and cur_fail >= fail_threshold:
                cur_fail, cur_locked = fail_threshold - 1, 0.0
            new_fail, new_locked_until, lock_step = cur_fail, cur_locked, 0.0
            if not ok:
                new_fail += 1
                if new_fail >= fail_threshold:
                    lock_step = lock_steps[min(new_fail - fail_threshold,
                                               len(lock_steps) - 1)]
                    new_locked_until = now + lock_step
        con.execute(
            "UPDATE security_lock SET last_verify_ts=?, last_verify_ok=?,"
            " fail_count=?, locked_until=? WHERE id=1",
            (now, 1 if ok else 0, new_fail, new_locked_until))

    if ok:
        return True, "验证通过", 200
    if lock_step or was_locked:
        wait = int((new_locked_until or locked_until) - now) + 1
        msg = (f"密码错误次数过多，已锁定 {int(lock_step)} 秒" if lock_step
               else f"密码错误次数过多，请 {wait} 秒后再试")
        return False, msg, 429
    return (False,
            f"密码错误（已连续失败 {new_fail} 次，累计 {fail_threshold} 次将临时锁定）",
            401)


def verify_password(password: str) -> tuple[bool, str, int]:
    """校验操作密码 + 防在线爆破流控。返回 ``(ok, message, http_status)``。

    ``http_status`` 约定的取值：200 通过 / 401 密码错 / 429 锁定中。
    调用方直接照抄这三个状态码即可，不要再自己拼。
    """
    init()
    return verify_with_lock(lambda: _password.verify(password), DB_PATH)


def reset_failures() -> None:
    """清零失败计数与锁定（改密码后调用；目前仅测试/运维用）。"""
    init()
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT OR IGNORE INTO security_lock (id, fail_count, locked_until) VALUES (1,0,0)")
        con.execute(
            "UPDATE security_lock SET fail_count=0, locked_until=0 WHERE id=1")


__all__ = ["DB_PATH", "FAIL_THRESHOLD", "LOCK_STEPS", "init", "verify_with_lock",
           "verify_password", "reset_failures"]
