"""WorkBuddy 账号管理域配置常量。

参考实现：dingminhua/dsh-connect-workbuddy（MIT）—— 扫码登录三段式
（state → token → account）、积分/签到只读接口、双区域（cn/global）划分。
本域把它落成 lottery_web 的私有 Web 功能：凭据落服务器独立库，接口只回脱敏信息。

安全约定
--------
- token 以「HMAC-SHA256 密钥流 XOR + HMAC 摘要」加密后落 SQLite（密钥文件 0600，
  独立于签名密钥）；源码、仓库、日志中永不出现明文 token。
- 库文件在 /data/lottery，目录 0700 / 文件 0600（由 common.db 统一加固）。
"""
from __future__ import annotations

from app.common.paths import DB_DIR, db_path

DB_PATH = db_path("workbuddy")

#: 会话 cookie（与全站操作密码共用一套签发/校验，见 app.common.admin）
COOKIE_NAME = "workbuddy_session"
SESSION_TTL_SECONDS = 12 * 3600

#: 凭据加密密钥文件（与 admin 的 trigger_session_secret 分开，职责隔离）
SECRET_FILE = DB_DIR / "workbuddy_vault_secret"

#: 区域 → OAuth 基址（与参考项目 oauth.ts / upstream.ts 一致）
OAUTH_BASES = {
    "cn": "https://www.codebuddy.cn",
    "global": "https://www.workbuddy.ai",
}
API_PREFIX = "/v2/plugin"
BILLING_PREFIX = "/v2/billing/meter"
CATALOG_PATH = "/v3/config"
OAUTH_TIMEOUT_SECONDS = 30
LOGIN_TTL_SECONDS = 600       # 一次扫码会话 10 分钟
OAUTH_POLL_INTERVAL_MS = 2000  # 前端轮询间隔（参考项目同值）
HTTP_TIMEOUT_SECONDS = 20

REGIONS = ("cn", "global")
