"""通用 SQLite 工具：统一的 WAL 连接上下文。

用法::

    from app.common.db import get_conn

    with get_conn("/data/xxx/app.db") as con:
        con.execute("SELECT 1")
        # 正常退出自动 commit
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def get_conn(db_path: str | Path, timeout: float = 30.0):
    """打开 SQLite 连接（WAL 模式, 正常退出自动 commit）。

    - 自动创建父目录
    - WAL + synchronous=NORMAL: 并发读写下性能与安全平衡
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path), timeout=timeout)
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA synchronous=NORMAL;")
    try:
        yield con
        con.commit()
    finally:
        con.close()
