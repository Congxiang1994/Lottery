"""操作密码的数据库存储（只存哈希，不存明文）。

设计
----
- 源码中不再硬编码任何密码；密码哈希持久化在 /data/lottery/auth.db。
- 首次部署通过环境变量 LOTTERY_RUN_PASSWORD 或一次性管理命令写入数据库，
  之后所有校验（彩票「运行全部」、触发器、儿歌管理）都从库里读取哈希比对。
- 哈希用 **scrypt**（随机 16 字节 salt，N=2^15 / r=8 / p=1），抗 GPU 爆破。
- 兼容历史记录：老库里的单轮 SHA-256(salt+plain) 仍可校验通过，
  校验成功后**自动升级**为 scrypt（用户无感，无需重新设置密码）。

存储格式
--------
- 新： ``scrypt$<n>$<r>$<p>$<salt_hex>$<hash_hex>``（salt 内嵌，salt 列留空）
- 旧： ``<sha256_hex>`` + 独立的 salt 列
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

# scrypt 参数：N=2^15 约 32MB 内存 / 次，单次校验 ~100ms（对本人无感，对爆破很贵）
_SCRYPT_N = 2 ** 15
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32
_MAXMEM = 128 * 1024 * 1024

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


# ------------------------------------------------------------ 哈希实现


def _hash_scrypt(plain: str, salt: bytes) -> str:
    dk = hashlib.scrypt(
        plain.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
        maxmem=_MAXMEM,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${dk.hex()}"


def _hash_legacy_sha256(plain: str, salt: str) -> str:
    """历史格式：单轮 SHA-256(salt + plain)。仅用于兼容校验，不再用于新写入。"""
    return hashlib.sha256((salt + plain).encode("utf-8")).hexdigest()


def _verify_hash(plain: str, pwd_hash: str, salt: str) -> bool:
    """按存储格式分派校验，常量时间比较。"""
    if pwd_hash.startswith("scrypt$"):
        try:
            _, n, r, p, salt_hex, hash_hex = pwd_hash.split("$")
            dk = hashlib.scrypt(
                plain.encode("utf-8"),
                salt=bytes.fromhex(salt_hex),
                n=int(n),
                r=int(r),
                p=int(p),
                dklen=len(hash_hex) // 2,
                maxmem=_MAXMEM,
            )
        except (ValueError, TypeError, MemoryError):
            return False
        return hmac.compare_digest(dk.hex(), hash_hex)
    # 兼容老格式
    return hmac.compare_digest(pwd_hash, _hash_legacy_sha256(plain, salt))


def _is_legacy(pwd_hash: str) -> bool:
    return not pwd_hash.startswith("scrypt$")


# ------------------------------------------------------------ 对外接口


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
    pwd_hash = _hash_scrypt(plain, secrets.token_bytes(16))
    with _conn() as con:
        con.execute(_SCHEMA)
        con.execute(
            "INSERT OR REPLACE INTO password_store (id, pwd_hash, salt, updated_at) "
            "VALUES (1,?,?,?)",
            (pwd_hash, "", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )


def verify(plain: str) -> bool:
    """比对明文与库中哈希（常量时间比较）。库未配置 → 直接 False。

    若库中是历史 SHA-256 格式且校验通过，顺手升级为 scrypt（失败静默忽略）。
    """
    with _conn() as con:
        con.execute(_SCHEMA)
        row = con.execute("SELECT pwd_hash, salt FROM password_store WHERE id=1").fetchone()
    if not row:
        return False
    pwd_hash, salt = row
    ok = _verify_hash(plain, pwd_hash, salt or "")
    if ok and _is_legacy(pwd_hash):
        try:
            set_password(plain)
        except (sqlite3.Error, OSError):
            pass  # 升级失败不影响本次校验结果
    return ok


def ensure_configured() -> None:
    """启动兜底：库未配置且环境变量已设置时，自动用环境变量初始化一次。

    环境变量不在源码里，仅用于首次部署引导；之后以库为准。
    """
    if is_configured():
        return
    env_pwd = os.environ.get("LOTTERY_RUN_PASSWORD")
    if env_pwd:
        set_password(env_pwd)
