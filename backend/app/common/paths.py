"""持久化路径的**唯一真源**。

背景：每个功能域各自写过一遍

    DB_DIR = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery"))
    DB_PATH = DB_DIR / "xxx.db"

8 个域 = 8 份复制，改一次目录要改 8 处，且极易漏（漏掉的那个域在
``LOTTERY_DB_DIR`` 覆盖时会把库写到 /data/lottery，本地测试污染生产路径）。

约定
----
- 所有 SQLite 库文件都放在 :data:`DB_DIR` 下，名字用 ``<domain>.db``
- 大文件（离线 IP 库）放 ``DB_DIR/geo``
- 环境变量 ``LOTTERY_DB_DIR`` 覆盖整棵树（本地测试 / 隔离环境用）
- **不要在域内再写 ``os.environ.get("LOTTERY_DB_DIR", ...)``**，一律从这里 import
"""
from __future__ import annotations

import os
from pathlib import Path

#: 持久化根目录。独立于部署目录，重部署不丢数据。
DB_DIR = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery"))


def db_path(name: str) -> Path:
    """返回 ``DB_DIR/<name>.db``（``name`` 不带扩展名）。"""
    return DB_DIR / f"{name}.db"


def geo_dir() -> Path:
    """离线 IP 库目录（``LOTTERY_GEO_DIR`` 可单独覆盖）。"""
    return Path(os.environ.get("LOTTERY_GEO_DIR", str(DB_DIR / "geo")))


__all__ = ["DB_DIR", "db_path", "geo_dir"]
