"""通用 SQLite 工具：统一的 WAL 连接上下文 + 建表（多 worker 安全）。

用法::

    from app.common.db import get_conn

    with get_conn("/data/xxx/app.db") as con:
        con.execute("SELECT 1")
        # 正常退出自动 commit

建表请用 :func:`init_schema`（不要自己撸 flock，历史上 5 个域各写了一遍）。
"""
from __future__ import annotations

import fcntl
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable

# 数据库文件权限：仅属主可读写。
# 原因：trigger.db 里存有明文 Ark API key，SQLite 默认按 umask（通常 022）建文件
# → 同机其他用户可读。收紧到 0600（目录侧另有 0700 加固，见 harden_dir）。
_DB_MODE = 0o600
_DIR_MODE = 0o700


def _harden(path: Path, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except OSError:
        pass  # 权限不足（如容器/只读挂载）时不影响功能


@contextmanager
def get_conn(db_path: str | Path, timeout: float = 30.0):
    """打开 SQLite 连接（WAL 模式, 正常退出自动 commit）。

    - 自动创建父目录
    - WAL + synchronous=NORMAL: 并发读写下性能与安全平衡
    - 自动把库文件（含 -wal / -shm）权限收紧为 0600
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path), timeout=timeout)
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA synchronous=NORMAL;")
    # PRAGMA 执行后 -wal 已建立，此刻收紧三个文件权限（幂等，开销可忽略）
    _harden(db_path, _DB_MODE)
    _harden(Path(str(db_path) + "-wal"), _DB_MODE)
    _harden(Path(str(db_path) + "-shm"), _DB_MODE)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def harden_dir(path: str | Path) -> None:
    """把持久化目录收紧为 0700（目录不可被其他用户进入，兜住新生成的临时文件）。"""
    _harden(Path(path), _DIR_MODE)


# ---------------------------------------------------------------- 建表（多 worker 安全）


@contextmanager
def init_lock(db_path: str | Path):
    """建表用的进程间互斥锁（锁文件 ``<db>.init.lock``，与库同目录）。

    ⚠️ 为什么必须有：gunicorn 以 ``-w 2`` 启动，两个 worker 会同时执行
    ``PRAGMA journal_mode=WAL`` + ``CREATE TABLE``。**首次建库**时二者都要拿
    独占锁，其中一个必抛 ``sqlite3.OperationalError: database is locked``；
    启动钩子抛异常 → gunicorn 判定 "Worker failed to boot" → 整个 master 退出。
    2026-09-24 在 story.db 上实测踩到（systemd 靠 restart 才拉起来，属侥幸）。
    SQLite 的 ``busy_timeout`` 对 ``PRAGMA journal_mode`` 不生效，只能靠外部锁。

    锁不可用（非常规文件系统 / 只读挂载）时退化为无锁 —— 建表本身幂等，
    退化只会在极少数环境下退回旧行为，不影响正确性。
    """
    db_path = Path(db_path)
    lock_file = None
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        lock_file = open(db_path.parent / f"{db_path.name}.init.lock", "w")
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
    except OSError:
        lock_file = None
    try:
        yield
    finally:
        if lock_file is not None:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            finally:
                lock_file.close()


def init_schema(
    db_path: str | Path,
    schema: str,
    *,
    migrations: Iterable[str] = (),
    after: "callable | None" = None,
) -> None:
    """幂等建表 + 兼容旧库的补列/补索引。**所有域统一走这里，不要再各写一遍 flock。**

    参数
    ----
    db_path
        SQLite 库文件路径。
    schema
        ``CREATE TABLE IF NOT EXISTS ...`` 脚本（``executescript`` 执行）。
        ⚠️ 只放「建表 + 建在旧库上也合法的索引」。
    migrations
        逐条尝试执行的 DDL（``ALTER TABLE ... ADD COLUMN`` 等）。
        单条失败（列已存在）静默跳过 —— 这就是「兼容旧库」的全部机制。
        🔴 **依赖新列的 ``CREATE INDEX`` 必须放这里，不能写进 schema**：
        旧库上 ``CREATE TABLE IF NOT EXISTS`` 不会补列，紧接着建索引就抛
        ``no such column``，而它在 lifespan 里 → 整个应用启动失败（线上 502）。
    after
        建表之后的回调（同一把锁内执行），签名 ``after(con)``。
        用于「依赖新表/新列的索引或一次性数据迁移」。
    """
    with init_lock(db_path):
        with get_conn(db_path) as con:
            con.executescript(schema)
            for ddl in migrations:
                try:
                    con.execute(ddl)
                except sqlite3.OperationalError:
                    pass  # 列/索引已存在
            if after is not None:
                after(con)
