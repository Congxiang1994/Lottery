"""通用 SQLite 工具：统一的 WAL 连接上下文。

用法::

    from app.common.db import get_conn

    with get_conn("/data/xxx/app.db") as con:
        con.execute("SELECT 1")
        # 正常退出自动 commit
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

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
