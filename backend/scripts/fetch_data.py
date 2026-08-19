"""抓取双色球/大乐透历史数据并落盘到 app/data/{lottery}.json。

用法：
    cd backend
    python scripts/fetch_data.py            # 抓取全部
    python scripts/fetch_data.py ssq        # 仅双色球
"""
from __future__ import annotations

import sys

from app.services import scraper


def main() -> None:
    keys = sys.argv[1:] or ["ssq", "dlt"]
    for key in keys:
        if key not in scraper.LOTTERIES:
            print(f"跳过未知彩种: {key}")
            continue
        print(f"==> 抓取 {key} ...")
        data = scraper.fetch_lottery(key)
        path = scraper.save_lottery(data)
        latest = data["draws"][-1] if data["draws"] else None
        print(f"    共 {data['count']} 期 -> {path}")
        if latest:
            print(f"    最新: {latest['issue']} {latest['date']} "
                  f"红{latest['red']} 蓝{latest['blue']}")


if __name__ == "__main__":
    main()
