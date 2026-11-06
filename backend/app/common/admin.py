"""私有功能的管理会话（签名 cookie）：全站唯一实现。

历史问题
--------
5 个私有域（trigger / story / babysong / access / deals）各写了一遍
「校验密码 → 签发 12h httpOnly cookie / 校验 cookie / 删 cookie」，
且全部 ``from app.trigger.config import sign_session, verify_session`` ——
即「通用鉴权住在 trigger 业务域里」的倒挂，另外 4 个域都被这个 import 绑住。

现在集中到这里，各域只声明自己的 cookie 名与 TTL：

.. code-block:: python

    from app.common import admin

    @router.post("/admin/auth")
    def admin_auth(payload: dict, response: Response):
        return admin.login(payload, response, config.COOKIE_NAME)

    @router.get("/admin/session")
    def admin_session(session: str | None = Cookie(default=None)):
        return admin.session_state(session)

    @router.get("/admin/xxx")
    def xxx(session: str | None = Cookie(default=None)):
        admin.require(session)
        ...

设计
----
- **签名密钥统一**：``<DB_DIR>/trigger_session_secret``（历史文件名，不改名是为了
  线上已有 cookie 与密钥文件继续有效）。一个密钥、多个 cookie 名，
  所以「验证一次密码，五个功能都能进」。
- **cookie 名各域独立**（``trigger_session`` / ``story_session`` / …）：
  单独退出某个功能不影响其它功能。
- 会话载荷只有过期时间，无用户体系；签名 HMAC-SHA256。
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from fastapi import HTTPException, Response

from app.common.paths import DB_DIR
from app.common.security import verify_password  # noqa: F401  (对外暴露 admin.verify_password)

#: 会话有效期（12 小时）。各域如需不同 TTL，传自己的值给 login/session 函数。
SESSION_TTL_SECONDS = 12 * 3600

#: 签名密钥文件。⚠️ 文件名沿用历史的 ``trigger_session_secret``：
#: 线上已有这个文件，改名会导致所有已登录会话失效 + 多一个孤儿文件。
_SECRET_FILE = DB_DIR / "trigger_session_secret"


def _load_secret() -> bytes:
    try:
        data = _SECRET_FILE.read_bytes().strip()
        if len(data) >= 32:
            return data
    except OSError:
        pass
    DB_DIR.mkdir(parents=True, exist_ok=True)
    data = secrets.token_hex(32).encode()
    # 竞争时 O_EXCL 保证只有一个 worker 写入，读到的都是同一份
    try:
        fd = os.open(str(_SECRET_FILE), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    except FileExistsError:
        data = _SECRET_FILE.read_bytes().strip()
    return data


SECRET = _load_secret()


# ---------------------------------------------------------------- 令牌


def sign_session(expires_at: float) -> str:
    """生成 ``过期时间戳.签名`` 令牌。"""
    payload = str(int(expires_at))
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_session(token: str | None) -> bool:
    """校验令牌：签名匹配且未过期。"""
    if not token or "." not in token:
        return False
    payload, sig = token.rsplit(".", 1)
    expect = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return False
    try:
        return int(payload) > time.time()
    except ValueError:
        return False


# ---------------------------------------------------------------- cookie


def set_session_cookie(
    response: Response,
    cookie_name: str,
    ttl_seconds: int = SESSION_TTL_SECONDS,
) -> None:
    """写入 httpOnly 会话 cookie（SameSite=Lax + Secure + 全站 path）。"""
    response.set_cookie(
        key=cookie_name,
        value=sign_session(time.time() + ttl_seconds),
        max_age=ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )


def clear_session_cookie(response: Response, cookie_name: str) -> None:
    response.delete_cookie(cookie_name, path="/")


# ---------------------------------------------------------------- 路由级三件套


def require(token: str | None) -> None:
    """校验会话，无效直接 401（各域 ``_require_session`` 的统一实现）。"""
    if not verify_session(token):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


def session_state(token: str | None) -> dict:
    """``GET .../session`` 的响应体。"""
    return {"valid": verify_session(token)}


def login(payload: dict, response: Response, cookie_name: str,
          ttl_seconds: int = SESSION_TTL_SECONDS) -> dict:
    """``POST .../auth`` 的完整实现：流控校验 → 签发 cookie → 统一响应体。

    ⚠️ 密码错误/锁定一律抛 HTTPException（401 / 429），与历史行为逐字节一致 ——
    前端 ``PasswordGate`` 依赖 401 判「密码错」、429 判「锁定中」。
    """
    ok, msg, status = verify_password(str(payload.get("password", "")))
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    set_session_cookie(response, cookie_name, ttl_seconds)
    return {"ok": True, "message": "验证通过", "ttl_hours": ttl_seconds // 3600}


def logout(response: Response, cookie_name: str) -> dict:
    """``POST .../logout`` 的完整实现。"""
    clear_session_cookie(response, cookie_name)
    return {"ok": True}


__all__ = [
    "SESSION_TTL_SECONDS",
    "SECRET",
    "sign_session",
    "verify_session",
    "set_session_cookie",
    "clear_session_cookie",
    "require",
    "session_state",
    "login",
    "logout",
]
