"""会话管理：每个浏览器会话独立的登录信息 + 书签授权码。"""
from __future__ import annotations

import secrets
import time
from typing import Optional

from fastapi import Request, Response

SESSION_COOKIE = "sd_sid"


def _extract_access_token(auth: str) -> str:
    """从 x-nd-auth 头值提取 access token。"""
    import re
    m = re.search(r'MAC\s+id="([^"]+)"', auth)
    return m.group(1) if m else auth


def fulfill_token(token: str) -> str:
    """把 access token 拼成完整 x-nd-auth 头值。"""
    token = token.strip()
    if not token:
        return ""
    if not token.startswith("MAC id"):
        token = f'MAC id="{token}",nonce="0",mac="0"'
    return token


class SessionStore:
    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.by_code: dict[str, str] = {}

    def get_or_create(self, request: Request, response: Response) -> dict:
        sid = request.cookies.get(SESSION_COOKIE)
        if sid and sid in self.sessions:
            self.sessions[sid]["last_seen"] = time.time()
            return self.sessions[sid]
        sid = secrets.token_hex(16)
        sess = {"id": sid, "auth": "", "auth_code": "", "created": time.time(),
                "last_seen": time.time()}
        self.sessions[sid] = sess
        response.set_cookie(SESSION_COOKIE, sid, max_age=30 * 24 * 3600,
                            httponly=True, samesite="lax")
        return sess

    def gen_code(self, sess: dict) -> str:
        code = secrets.token_hex(6)
        self.by_code.pop(sess.get("auth_code", ""), None)
        sess["auth_code"] = code
        self.by_code[code] = sess["id"]
        return code

    def bind_by_code(self, code: str, auth: str) -> bool:
        sid = self.by_code.get(code)
        if not sid or sid not in self.sessions:
            return False
        self.sessions[sid]["auth"] = auth
        return True

    def set_auth(self, sess: dict, auth: str) -> None:
        sess["auth"] = auth

    def get_auth(self, sess: dict) -> str:
        return sess.get("auth", "")

    def access_token(self, sess: dict) -> str:
        return _extract_access_token(self.get_auth(sess))


store = SessionStore()
