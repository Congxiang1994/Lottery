"""应用配置与彩种元数据。"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# 「运行全部算法」操作密码（可通过环境变量覆盖）
VERIFY_PASSWORD = os.environ.get("LOTTERY_RUN_PASSWORD", "1qaz!QAZ1")
# 密码校验流控：同一秒内全局仅允许 1 次
VERIFY_RATE_LIMIT_PER_SECOND = 1

# 彩种元数据：红球(前区) / 蓝球(后区) 数量与范围
LOTTERIES: dict[str, dict] = {
    "ssq": {
        "key": "ssq",
        "name": "双色球",
        "org": "中国福利彩票",
        "red_count": 6,
        "red_max": 33,
        "blue_count": 1,
        "blue_max": 16,
        "red_label": "红球",
        "blue_label": "蓝球",
    },
    "dlt": {
        "key": "dlt",
        "name": "大乐透",
        "org": "中国体育彩票",
        "red_count": 5,
        "red_max": 35,
        "blue_count": 2,
        "blue_max": 12,
        "red_label": "前区",
        "blue_label": "后区",
    },
}

SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://datachart.500.com/",
}
