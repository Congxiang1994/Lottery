"""触发器配置常量与密码/会话管理。"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from pathlib import Path

# 持久化目录：独立于部署目录，重部署不丢数据；本地开发可用 LOTTERY_DB_DIR 覆盖
DB_DIR = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery"))
DB_PATH = DB_DIR / "trigger.db"

# 操作密码：与彩票「运行全部」同一把，统一由数据库（/data/lottery/auth.db）哈希存储。
# 校验走 results_store.verify_password → app.common.password。源码不再含明文密码。

# 会话 cookie：httpOnly，密码校验通过后签发，12 小时有效
COOKIE_NAME = "trigger_session"
SESSION_TTL_SECONDS = 12 * 3600

# 签名密钥：进程首次生成并持久化到 DB 目录，重启不失效（多 worker 共享同一文件）
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

# 请求参数
HTTP_TIMEOUT_SECONDS = 30.0
RETRY_TIMES = 2          # 失败自动重试次数（不含首次）
RETRY_INTERVAL_SECONDS = 60
HISTORY_KEEP_DAYS = 90

# 探测/触发请求：模拟真实 Agent 客户端调用，降低被风控误判/封号概率
# - UA 用真实浏览器，而非 python-httpx 默认 UA
# - 请求体是自然短句 + 正常 token 数，避免「ping + max_tokens=1」这种明显探测特征
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
EXTRA_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
}
# 自然短句，让每次调用都像真实 Agent 对话而非机械心跳
PROBE_MESSAGE = "请回复 ok 确认连接正常"
PROBE_MAX_TOKENS = 16

# leader 选举锁文件（防 gunicorn 多 worker 双发）
LEADER_LOCK_PATH = DB_DIR / "trigger_scheduler.lock"


def sign_session(expires_at: float) -> str:
    """生成 会话载荷.签名 令牌（载荷仅含过期时间，无用户体系）。"""
    payload = str(int(expires_at))
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_session(token: str | None) -> bool:
    """校验会话令牌：签名匹配且未过期。"""
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
