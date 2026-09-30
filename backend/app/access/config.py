"""访问管理配置：库路径 / geo 目录 / 保留期 / cookie / 忽略名单 / 功能域映射 / 护栏阈值。

设计原则：所有可调项集中在此，store / geo / middleware / router 只读不写常量。
"""
from __future__ import annotations

import os
from pathlib import Path

# ------------------------------------------------------------ 路径

# 持久化目录：与其余 6 个库同目录（重部署不丢）；本地开发用 LOTTERY_DB_DIR 覆盖
DB_DIR = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery"))
DB_PATH = DB_DIR / "access.db"

# 离线 IP 库目录。⚠️ 大文件（v4 10.6 MB / v6 35.5 MB）**不进仓库**，
# 由 tools/geo_update.py 下载；本地开发可指到 backend/.geo/（已进 .gitignore）
GEO_DIR = Path(os.environ.get("LOTTERY_GEO_DIR", str(DB_DIR / "geo")))
GEO_V4 = GEO_DIR / "ip2region_v4.xdb"
GEO_V6 = GEO_DIR / "ip2region_v6.xdb"

# ------------------------------------------------------------ 会话

# httpOnly cookie：与 trigger / story / babysong **同一签名密钥**、独立 cookie 名
COOKIE_NAME = "access_session"
SESSION_TTL_SECONDS = 12 * 3600

# ------------------------------------------------------------ 保留与写入

# 明细保留天数（ip_profile 永久保留，见 §5.2）
KEEP_DAYS = int(os.environ.get("LOTTERY_ACCESS_KEEP_DAYS", "90"))

# 写入批次：攒够 BATCH_SIZE 条、或等 FLUSH_INTERVAL_SECONDS 秒（先到者触发）
BATCH_SIZE = 200
FLUSH_INTERVAL_SECONDS = 1.0
# 队列上限：超过则丢弃最旧并计数（中间件**永不**成为业务瓶颈）
QUEUE_MAX = 5000

# 同一 (ip, path) 在**同一分钟**内超过该条数 → 降级为聚合行（儿歌下载 3s 轮询这类）
SAME_PATH_PER_MINUTE = 60

# 分钟聚合状态的保留窗口：按「本批最早行的分钟 − N 分钟」清理（见 store._agg_cutoff）。
# ⚠️ 绝对不能改用墙上时钟做水位 —— 队列积压 / 分钟边界会让行的 ts 早于 now，
#    按写入时刻清理会误删仍在写入的分钟 → 同一分钟被拆成多条聚合行。
AGG_GRACE_MINUTES = 3

# ------------------------------------------------------------ 忽略名单

# 前缀匹配。⚠️ `/api/access` 必须在内 —— 否则「每开一次页面就新增几十行」自噬。
IGNORE_PREFIXES = (
    "/api/access",    # 自身接口（含前端埋点 /page，由 router 自己写入）
    "/api/health",
    "/assets/",
    "/favicon",
)

# 前端把访客 UUID 同步到这个 cookie（值不落库，中间件即时加盐哈希）。
# 为什么要 cookie 而不是自定义请求头：SPA 里几十处 fetch 都得改，而 cookie 同域自动携带。
VISITOR_COOKIE = "lottery_vid"

# 静态资源扩展名（命中即忽略 —— 量级大且走 nginx）
STATIC_EXT = (
    ".js", ".mjs", ".css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".ico", ".webp", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp4", ".webm", ".mp3", ".txt", ".xml", ".json", ".wasm",
)

# ------------------------------------------------------------ 功能域映射

# 前端页面路由 → 功能域（用于把「页面请求」归类；埋点侧也会传 path）
PAGE_FEATURES = (
    ("/babysong-admin", "babysong"),
    ("/story-admin", "story"),
    ("/babysong", "babysong"),
    ("/hanzi", "hanzi"),
    ("/story", "story"),
    ("/lottery", "lottery"),
    ("/history", "lottery"),
    ("/predict", "lottery"),
    ("/algorithms", "lottery"),
    ("/trigger", "trigger"),
    ("/access", "access"),
)

# API 前缀 → 功能域（顺序敏感：/api/story/v1 必须在 /api/story 之前）
API_FEATURES = (
    ("/api/lottery", "lottery"),
    ("/api/hanzi", "hanzi"),
    ("/api/babysong", "babysong"),
    ("/api/story/v1", "story-api"),
    ("/api/story", "story"),
    ("/api/trigger", "trigger"),
    ("/api/stats", "stats"),
    ("/api/access", "access"),
    ("/api", "other"),
)

FEATURE_LABELS = {
    "portal": "门户首页",
    "lottery": "彩票数据",
    "hanzi": "汉字课程",
    "babysong": "儿歌",
    "story": "睡前故事",
    "story-api": "故事开放 API",
    "trigger": "API 触发器",
    "stats": "访问统计",
    "access": "访问管理",
    "other": "其他",
    "probe": "探测/扫描",
}

# 命中私有功能（记录 is_private=1）——「谁在敲我的私有功能」正是最该看到的
PRIVATE_PREFIXES = (
    "/api/trigger",
    "/api/story/admin",
    "/api/babysong/admin",
    "/api/access",
    "/trigger",
    "/story-admin",
    "/babysong-admin",
    "/access",
)

# 已知会话 cookie 名。**只记录「带了哪个 cookie 名」，绝不记值**（见 §5.1 隐私约定）
SESSION_COOKIES = ("trigger_session", "story_session", "babysong_session", "access_session")

# query 脱敏：这些参数名的值一律替换为 ***
SECRET_QUERY_KEYS = (
    "key", "api_key", "apikey", "token", "access_token", "password", "pwd", "secret",
)

# ------------------------------------------------------------ 展示

# 明细/聚合的默认时间窗（天）
DEFAULT_DAYS = 7
MAX_DAYS = 365

# 单次查询最大返回行数（防止一次性拉爆前端）
MAX_LIMIT = 500
