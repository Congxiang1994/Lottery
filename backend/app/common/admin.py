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
- 会话载荷为 ``<过期时间>.<scope>``，无用户体系；签名 HMAC-SHA256 覆盖整个载荷。
  scope 默认 ``admin``，保证 trigger/story/access 等既有调用点零改动继续工作；
  独立口令域（如 ctsahre 分享口令）用 ``scope="ct_share"`` 签发，两个域的 cookie
  不能互相顶替。
- 兼容历史 cookie：旧格式为两段 ``<过期时间>.<签名>``（等价于 scope="admin"），
  verify_session 在 ``scope="admin"`` 时仍接受，避免全站存量会话被强制登出。
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from fastapi import HTTPException, Response

from app.common.db import init_lock
from app.common.paths import DB_DIR
from app.common.security import verify_password  # noqa: F401  (对外暴露 admin.verify_password)

#: 会话有效期（12 小时）。各域如需不同 TTL，传自己的值给 login/session 函数。
SESSION_TTL_SECONDS = 12 * 3600

#: 签名密钥文件。⚠️ 文件名沿用历史的 ``trigger_session_secret``：
#: 线上已有这个文件，改名会导致所有已登录会话失效 + 多一个孤儿文件。
_SECRET_FILE = DB_DIR / "trigger_session_secret"


#: 签名密钥最小长度（字节）。短于此长度的密钥无法提供足够的 HMAC 强度。
_MIN_SECRET_BYTES = 32


def _load_secret() -> bytes:
    try:
        data = _SECRET_FILE.read_bytes().strip()
        if len(data) >= _MIN_SECRET_BYTES:
            return data
        # 文件存在但内容为空/过短：属于损坏或写入被中断，绝不能静默接受。
        raise ValueError(
            f"会话签名密钥文件 {_SECRET_FILE} 内容不足 {_MIN_SECRET_BYTES} 字节"
            f"（实际 {len(data)} 字节），拒绝以弱密钥启动")
    except FileNotFoundError:
        pass
    DB_DIR.mkdir(parents=True, exist_ok=True)
    # 用跨 worker 的 flock 串行化「检查-生成-写入」，保证并发 worker 看到的
    # 是同一个密钥（否则各签各的，用户在不同 worker 间跳时会反复掉登录）。
    with init_lock(_SECRET_FILE):
        try:
            data = _SECRET_FILE.read_bytes().strip()
        except FileNotFoundError:
            data = b""
        if len(data) >= _MIN_SECRET_BYTES:
            return data
        if data:
            # 锁内再次确认：确为损坏文件（而非竞态窗口里的空文件）。
            raise ValueError(
                f"会话签名密钥文件 {_SECRET_FILE} 内容不足 {_MIN_SECRET_BYTES} 字节"
                f"（实际 {len(data)} 字节），拒绝以弱密钥启动")
        data = secrets.token_hex(32).encode()
        # 原子落地：同目录临时文件（0600）+ fsync + os.replace。进程中途被 kill
        # 不会留下半截/空密钥文件；os.replace 在同 FS 内是原子操作。
        tmp = _SECRET_FILE.with_name(_SECRET_FILE.name + ".tmp")
        try:
            fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(str(tmp), str(_SECRET_FILE))
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
        return data


SECRET = _load_secret()


# ---------------------------------------------------------------- 令牌


def sign_session(expires_at: float, scope: str = "admin") -> str:
    """生成 ``过期时间戳.scope.签名`` 令牌（scope 被签名覆盖，不可跨域冒用）。"""
    payload = f"{int(expires_at)}.{scope}"
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_session(token: str | None, scope: str = "admin") -> bool:
    """校验令牌：签名匹配、scope 一致且未过期。

    兼容历史两段令牌 ``<expiry>.<sig>``：这类旧 cookie 等价于 scope="admin"，
    仅当请求 scope="admin" 时接受，避免线上存量会话被强制登出。
    """
    if not token or token.count(".") not in (1, 2):
        return False
    payload, sig = token.rsplit(".", 1)
    expect = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return False
    parts = payload.rsplit(".", 1)
    # 三段新格式必须显式带 match scope；两段旧格式只按 admin 接受。
    token_scope = parts[1] if len(parts) == 2 else "admin"
    if token_scope != scope:
        return False
    try:
        return int(parts[0]) > time.time()
    except ValueError:
        return False


# ---------------------------------------------------------------- cookie


def set_session_cookie(
    response: Response,
    cookie_name: str,
    ttl_seconds: int = SESSION_TTL_SECONDS,
    scope: str = "admin",
) -> None:
    """写入 httpOnly 会话 cookie（SameSite=Lax + Secure + 全站 path）。"""
    response.set_cookie(
        key=cookie_name,
        value=sign_session(time.time() + ttl_seconds, scope),
        max_age=ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )


def clear_session_cookie(response: Response, cookie_name: str) -> None:
    response.delete_cookie(cookie_name, path="/")


# ---------------------------------------------------------------- 路由级三件套


def require(token: str | None, scope: str = "admin") -> None:
    """校验会话，无效直接 401（各域 ``_require_session`` 的统一实现）。"""
    if not verify_session(token, scope):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


def session_state(token: str | None, scope: str = "admin") -> dict:
    """``GET .../session`` 的响应体。"""
    return {"valid": verify_session(token, scope)}


def login(payload: dict, response: Response, cookie_name: str,
          ttl_seconds: int = SESSION_TTL_SECONDS,
          scope: str = "admin") -> dict:
    """``POST .../auth`` 的完整实现：流控校验 → 签发 cookie → 统一响应体。

    ⚠️ 密码错误/锁定一律抛 HTTPException（401 / 429），与历史行为逐字节一致 ——
    前端 ``PasswordGate`` 依赖 401 判「密码错」、429 判「锁定中」。
    """
    ok, msg, status = verify_password(str(payload.get("password", "")))
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    set_session_cookie(response, cookie_name, ttl_seconds, scope)
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
