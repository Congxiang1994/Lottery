"""操作密码的数据库存储（只存哈希，不存明文）。

设计
----
- 源码中不再硬编码任何密码；密码哈希持久化在 /data/lottery/auth.db。
- 首次部署通过环境变量 LOTTERY_RUN_PASSWORD 或一次性管理命令写入数据库，
  之后所有校验（彩票「运行全部」、触发器）都从库里读取哈希比对。
- 哈希用随机 salt + SHA-256，避免明文落库，也避免 rainbow 表直接还原。
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path

from app.common.db import get_conn

DB_PATH = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery")) / "auth.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS password_store (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pwd_hash   TEXT NOT NULL,
    salt       TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _conn():
    return get_conn(DB_PATH)


def _hash(plain: str, salt: str) -> str:
    return hashlib.sha256((salt + plain).encode("utf-8")).hexdigest()


def init() -> None:
    """确保表存在（幂等）。"""
    with _conn() as con:
        con.execute(_SCHEMA)


def is_configured() -> bool:
    with _conn() as con:
        con.execute(_SCHEMA)
        row = con.execute("SELECT 1 FROM password_store WHERE id=1").fetchone()
    return row is not None


def set_password(plain: str) -> None:
    """写入密码哈希（覆盖式）。plain 为明文，仅调用方临时持有，不落库。"""
    salt = secrets.token_hex(16)
    pwd_hash = _hash(plain, salt)
    with _conn() as con:
        con.execute(_SCHEMA)
        con.execute(
            "INSERT OR REPLACE INTO password_store (id, pwd_hash, salt, updated_at) "
            "VALUES (1,?,?,?)",
            (pwd_hash, salt, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )


def verify(plain: str) -> bool:
    """比对明文与库中哈希（常量时间比较）。库未配置 → 直接 False。"""
    with _conn() as con:
        con.execute(_SCHEMA)
        row = con.execute("SELECT pwd_hash, salt FROM password_store WHERE id=1").fetchone()
    if not row:
        return False
    pwd_hash, salt = row
    return hmac.compare_digest(pwd_hash, _hash(plain, salt))


def ensure_configured() -> None:
    """启动兜底：库未配置且环境变量已设置时，自动用环境变量初始化一次。

    环境变量不在源码里，仅用于首次部署引导；之后以库为准。
    """
    if is_configured():
        return
    env_pwd = os.environ.get("LOTTERY_RUN_PASSWORD")
    if env_pwd:
        set_password(env_pwd)
