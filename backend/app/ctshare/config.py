"""CT 检查记录域配置常量。

⚠️ 两把口令都不在这份文件里，也不进源码：
- **分享口令**（只读）：哈希存 ``/data/lottery/ctshare.db``，用 ``scripts/ct_setup.py`` 写入
- **管理口令**（可增删改查）：复用全站操作密码（``app.common.password``），不另存
"""
from __future__ import annotations

import os
from pathlib import Path

from app.common.paths import DB_DIR, db_path

#: 本域独立库（检查记录 / 照片索引 / 分享口令 / 防爆破计数）
DB_PATH = db_path("ctshare")

#: 照片文件目录（**不进仓库**，独立于部署目录，重部署不丢）
#: 环境变量 ``LOTTERY_CT_PHOTO_DIR`` 可覆盖，便于本地测试隔离
PHOTO_DIR = Path(os.environ.get("LOTTERY_CT_PHOTO_DIR", str(DB_DIR / "ct_photos")))

#: 分享会话 cookie：httpOnly，分享口令通过后签发，12 小时有效
COOKIE_NAME = "ct_session"
SESSION_TTL_SECONDS = 12 * 3600

#: 管理会话 cookie：全站操作密码通过后签发（与分享会话**不同名**）——
#: 医生拿到分享口令只能看，改不了记录；管理页必须另输全站操作密码
ADMIN_COOKIE_NAME = "ct_admin_session"

#: 防爆破：连续失败到阈值后按阶梯锁定（与全站同一策略）
FAIL_THRESHOLD = 5
LOCK_STEPS = (30.0, 60.0, 120.0, 300.0, 900.0)

# ------------------------------------------------------------ 照片上传护栏

#: 单张照片上限（10 MB）
MAX_PHOTO_BYTES = 10 * 1024 * 1024

#: 允许的 MIME → 扩展名（白名单，避免写入可执行/脚本文件）
PHOTO_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

#: 字段名长度上限（防止把库撑爆 / 超长输入打崩 UI）
MAX_TIME_LEN = 64
MAX_PROJECT_LEN = 200
MAX_LINK_LABEL_LEN = 500
MAX_LINK_URL_LEN = 2000
MAX_LINK_TEXT_LEN = 300
MAX_NOTE_LEN = 1000
MAX_CAPTION_LEN = 200
