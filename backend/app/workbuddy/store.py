"""WorkBuddy 账号池持久化（SQLite）。

表结构
------
workbuddy_accounts  一账号一行：身份元数据（脱敏可直出）+ 加密凭据 blob
workbuddy_settings  每区域一份用户偏好（JSON 草稿/已存合一，简单可靠）
workbuddy_runtime   运行时事实（探测结果、签到状态等，按账号存 JSON）

凭据加密：encrypt-then-MAC。密钥来自 0600 文件，派生 enc/mac 两把子密钥。
仅 stdlib（服务器未装 cryptography），安全性足够：随机 16B nonce，
keystream = HMAC-SHA256(enc_key, nonce || counter) 分块拼接，
密文附 HMAC-SHA256(mac_key, nonce || ciphertext)，校验常量时间比较。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from app.common.db import get_conn, init_lock, init_schema
from app.workbuddy.config import DB_PATH, REGIONS, SECRET_FILE

SCHEMA = """
CREATE TABLE IF NOT EXISTS workbuddy_accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL,              -- 稳定 id：sha256(region:uid)
    region        TEXT NOT NULL,              -- cn / global
    uid           TEXT NOT NULL DEFAULT '',
    nickname      TEXT NOT NULL DEFAULT '',
    uin           TEXT NOT NULL DEFAULT '',
    domain        TEXT NOT NULL DEFAULT '',
    enterprise    INTEGER NOT NULL DEFAULT 0,
    cred          BLOB NOT NULL,              -- 加密后的 JSON（access/refresh token）
    token_expiry  INTEGER NOT NULL DEFAULT 0, -- epoch ms
    refresh_expiry INTEGER NOT NULL DEFAULT 0,
    member        INTEGER NOT NULL DEFAULT 0, -- 是否入池（显式 opt-in）
    is_current    INTEGER NOT NULL DEFAULT 0,
    hidden        INTEGER NOT NULL DEFAULT 0, -- 删除后暂时隐藏，重新检测可找回
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(region, account_id)
);
CREATE TABLE IF NOT EXISTS workbuddy_settings (
    region TEXT PRIMARY KEY,
    data   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workbuddy_runtime (
    account_id TEXT PRIMARY KEY,
    data       TEXT NOT NULL
);
"""


# ---------------------------------------------------------------- 密钥与加解密


def _load_secret() -> bytes:
    try:
        data = SECRET_FILE.read_bytes().strip()
        if len(data) >= 32:
            return data
        raise ValueError("workbuddy 凭据密钥文件内容不足 32 字节，拒绝以弱密钥启动")
    except FileNotFoundError:
        pass
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    with init_lock(SECRET_FILE):
        try:
            data = SECRET_FILE.read_bytes().strip()
        except FileNotFoundError:
            data = b""
        if len(data) >= 32:
            return data
        if data:
            raise ValueError("workbuddy 凭据密钥文件损坏，拒绝启动")
        data = secrets.token_hex(32).encode()
        tmp = SECRET_FILE.with_name(SECRET_FILE.name + ".tmp")
        try:
            fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(str(tmp), str(SECRET_FILE))
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
        return data


_SECRET = _load_secret()
_ENC_KEY = hmac.new(_SECRET, b"workbuddy-enc-v1", hashlib.sha256).digest()
_MAC_KEY = hmac.new(_SECRET, b"workbuddy-mac-v1", hashlib.sha256).digest()


def _keystream(nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hmac.new(_ENC_KEY, nonce + counter.to_bytes(4, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(out[:length])


def encrypt(plaintext: str) -> bytes:
    raw = plaintext.encode("utf-8")
    nonce = secrets.token_bytes(16)
    cipher = bytes(a ^ b for a, b in zip(raw, _keystream(nonce, len(raw))))
    tag = hmac.new(_MAC_KEY, nonce + cipher, hashlib.sha256).digest()
    return nonce + tag + cipher


def decrypt(blob: bytes) -> str:
    if len(blob) < 48:
        raise ValueError("凭据密文格式错误")
    nonce, tag, cipher = blob[:16], blob[16:48], blob[48:]
    expect = hmac.new(_MAC_KEY, nonce + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expect):
        raise ValueError("凭据密文校验失败（密钥不匹配或数据被篡改）")
    raw = bytes(a ^ b for a, b in zip(cipher, _keystream(nonce, len(cipher))))
    return raw.decode("utf-8")


# ---------------------------------------------------------------- 初始化 / 基础


def init() -> None:
    init_schema(DB_PATH, SCHEMA)


def account_id_of(region: str, uid: str) -> str:
    return hashlib.sha256(f"{region}:{uid}".encode()).hexdigest()[:24]


def _mask(v: str, keep: int = 4) -> str:
    if not v:
        return ""
    return v[:2] + "****" + v[-keep:] if len(v) > keep + 2 else "****"


def _row_public(row: sqlite3.Row, runtime: dict | None = None) -> dict[str, Any]:
    d = {
        "id": row["account_id"],
        "region": row["region"],
        "uid_masked": _mask(row["uid"], 4),
        "nickname": row["nickname"] or "未命名账号",
        "uin_masked": _mask(row["uin"], 4),
        "domain": row["domain"],
        "enterprise": bool(row["enterprise"]),
        "member": bool(row["member"]),
        "current": bool(row["is_current"]),
        "hidden": bool(row["hidden"]),
        "token_expiry": row["token_expiry"],
        "refresh_expiry": row["refresh_expiry"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    if runtime:
        d.update({k: runtime[k] for k in ("credits", "checkin", "probe", "last_error") if k in runtime})
    return d


def _runtime_map() -> dict[str, dict]:
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT account_id, data FROM workbuddy_runtime").fetchall()
    out = {}
    for r in rows:
        try:
            out[r["account_id"]] = json.loads(r["data"])
        except (ValueError, TypeError):
            continue
    return out


# ---------------------------------------------------------------- 账号 CRUD


def list_accounts(region: str | None = None, include_hidden: bool = False) -> list[dict[str, Any]]:
    sql = "SELECT * FROM workbuddy_accounts"
    cond, args = [], []
    if region:
        cond.append("region=?")
        args.append(region)
    if not include_hidden:
        cond.append("hidden=0")
    if cond:
        sql += " WHERE " + " AND ".join(cond)
    sql += " ORDER BY is_current DESC, member DESC, created_at DESC"
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(sql, args).fetchall()
    rt = _runtime_map()
    return [_row_public(r, rt.get(r["account_id"])) for r in rows]


def get_credential(account_id: str) -> dict[str, Any] | None:
    """取明文凭据（仅服务端内部调用，绝不进任何响应）。"""
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute(
            "SELECT cred, region, token_expiry, refresh_expiry FROM workbuddy_accounts WHERE account_id=?",
            (account_id,),
        ).fetchone()
    if not row:
        return None
    try:
        data = json.loads(decrypt(bytes(row["cred"])))
    except (ValueError, TypeError):
        return None
    data["region"] = row["region"]
    return data


def upsert_account(region: str, account: dict[str, Any]) -> str:
    """扫码成功后入库/覆盖；返回 account_id。重新登录会清除 hidden。"""
    uid = str(account.get("uid") or account.get("uin") or "")
    if not uid:
        raise ValueError("账号缺少 uid，拒绝入库")
    aid = account_id_of(region, uid)
    cred = {
        "access_token": account.get("accessToken", ""),
        "refresh_token": account.get("refreshToken", ""),
        "domain": account.get("domain", ""),
    }
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT INTO workbuddy_accounts"
            " (account_id, region, uid, nickname, uin, domain, enterprise, cred, token_expiry,"
            "  refresh_expiry, hidden, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP)"
            " ON CONFLICT(region, account_id) DO UPDATE SET"
            " uid=excluded.uid, nickname=excluded.nickname, uin=excluded.uin,"
            " domain=excluded.domain, enterprise=excluded.enterprise, cred=excluded.cred,"
            " token_expiry=excluded.token_expiry, refresh_expiry=excluded.refresh_expiry,"
            " hidden=0, updated_at=CURRENT_TIMESTAMP",
            (
                aid, region, uid,
                str(account.get("nickname") or ""),
                str(account.get("uin") or ""),
                str(account.get("domain") or ""),
                1 if account.get("enterpriseId") else 0,
                encrypt(json.dumps(cred, ensure_ascii=False)),
                int(account.get("expiresAtMs") or 0),
                int(account.get("refreshExpiresAtMs") or 0),
            ),
        )
    return aid


def set_member(account_id: str, member: bool) -> bool:
    with get_conn(DB_PATH) as con:
        cur = con.execute(
            "UPDATE workbuddy_accounts SET member=?, updated_at=CURRENT_TIMESTAMP WHERE account_id=?",
            (1 if member else 0, account_id),
        )
        return cur.rowcount > 0


def set_current(account_id: str) -> bool:
    """每区域唯一当前账号（把同区域其它账号 clear）。"""
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT region FROM workbuddy_accounts WHERE account_id=?", (account_id,)).fetchone()
        if not row:
            return False
        con.execute("UPDATE workbuddy_accounts SET is_current=0 WHERE region=?", (row["region"],))
        con.execute(
            "UPDATE workbuddy_accounts SET is_current=1, member=1, updated_at=CURRENT_TIMESTAMP WHERE account_id=?",
            (account_id,),
        )
        return True


def delete_account(account_id: str) -> bool:
    """删除凭据并隐藏（参考项目语义：不再列出，重新检测可找回）。"""
    with get_conn(DB_PATH) as con:
        cur = con.execute(
            "UPDATE workbuddy_accounts SET hidden=1, member=0, is_current=0, cred=?, updated_at=CURRENT_TIMESTAMP"
            " WHERE account_id=?",
            (encrypt("{}"), account_id),
        )
        return cur.rowcount > 0


def account_exists(account_id: str) -> bool:
    with get_conn(DB_PATH) as con:
        return con.execute("SELECT 1 FROM workbuddy_accounts WHERE account_id=?", (account_id,)).fetchone() is not None


# ---------------------------------------------------------------- 运行时事实 / 设置


def save_runtime(account_id: str, patch: dict[str, Any]) -> None:
    rt = _runtime_map().get(account_id, {})
    rt.update(patch)
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT INTO workbuddy_runtime(account_id, data) VALUES (?,?)"
            " ON CONFLICT(account_id) DO UPDATE SET data=excluded.data",
            (account_id, json.dumps(rt, ensure_ascii=False)),
        )


def default_settings() -> dict[str, Any]:
    return {"enabled": True, "checkinSupported": True, "autoCheckin": False, "pollIntervalMs": 300000}


def get_settings(region: str) -> dict[str, Any]:
    if region not in REGIONS:
        raise ValueError("未知区域")
    with get_conn(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT data FROM workbuddy_settings WHERE region=?", (region,)).fetchone()
    if not row:
        return default_settings()
    try:
        data = json.loads(row["data"])
        return {**default_settings(), **data}
    except (ValueError, TypeError):
        return default_settings()


def save_settings(region: str, data: dict[str, Any]) -> dict[str, Any]:
    cur = get_settings(region)
    allowed = {"enabled", "checkinSupported", "autoCheckin", "pollIntervalMs", "targetModelId"}
    for k, v in data.items():
        if k in allowed:
            cur[k] = v
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT INTO workbuddy_settings(region, data) VALUES (?,?)"
            " ON CONFLICT(region) DO UPDATE SET data=excluded.data",
            (region, json.dumps(cur, ensure_ascii=False)),
        )
    return cur
