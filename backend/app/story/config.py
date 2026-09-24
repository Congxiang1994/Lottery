"""睡前故事域配置：数据库路径、会话 cookie、字段长度与配额默认值。"""
from __future__ import annotations

import os
from pathlib import Path

# 持久化目录：独立于部署目录，重部署不丢数据；本地开发可用 LOTTERY_DB_DIR 覆盖
DB_DIR = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery"))
DB_PATH = DB_DIR / "story.db"

# 管理会话 cookie：与触发器/儿歌同一签名密钥（同一把操作密码），cookie 名独立
COOKIE_NAME = "story_session"
SESSION_TTL_SECONDS = 12 * 3600

# 字段长度上限（防超大 payload）
MAX_TITLE_LEN = 100
MAX_CONTENT_LEN = 8000
MAX_SUMMARY_LEN = 200
MAX_TAGS_LEN = 120
MAX_URL_LEN = 500

# API 密钥
KEY_PREFIX = "sk_story_"          # 明文密钥前缀，便于人眼识别
KEY_BYTES = 24                    # token_hex(24) → 48 字符 → 192 bit 熵
DEFAULT_DAILY_QUOTA = 1000        # 新密钥默认每日上限，0 = 不限
DEFAULT_TOTAL_QUOTA = 0           # 新密钥默认累计上限，0 = 不限

# 调用日志保留天数
CALLS_KEEP_DAYS = 90
