"""汉字拼读课域配置：视频目录、可播扩展名。"""
from __future__ import annotations

import os
from pathlib import Path

# 视频目录（默认 /data/pinzi，可用环境变量覆盖，便于本地测试）
PINZI_DIR = Path(os.environ.get("PINZI_DIR", "/data/pinzi"))

# 允许播放的容器（Nginx 直接服务，支持 Range）
VIDEO_EXTS = frozenset({".mp4", ".m4v", ".webm", ".mov"})

# 元数据文件名（下载器生成，含完整标题/封面/时长）
META_NAME = "meta.json"
