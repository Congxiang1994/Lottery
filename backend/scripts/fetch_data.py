"""抓取双色球/大乐透历史数据并落盘到 app/data/{lottery}.json。

用法：
    cd backend
    python scripts/fetch_data.py            # 抓取全部
    python scripts/fetch_data.py ssq        # 仅双色球
    python scripts/fetch_data.py --help     # 查看帮助

退出码：0 全部成功；1 有彩种抓取失败（空数据绝不落盘，防止覆盖已有真实数据）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 允许 `python scripts/fetch_data.py` 直接跑（把 backend/ 放进 sys.path）。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lottery.services import scraper  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取双色球/大乐透历史开奖数据并落盘")
    ap.add_argument("lotteries", nargs="*", default=["ssq", "dlt"],
                    help="彩种 key（ssq/dlt），默认全部")
    args = ap.parse_args()

    failed = 0
    for key in args.lotteries:
        if key not in scraper.LOTTERIES:
            print(f"✗ 跳过未知彩种: {key}")
            failed += 1
            continue
        print(f"==> 抓取 {key} ...")
        data = scraper.fetch_lottery(key)
        # 空 draws 绝不落盘：一次网络故障 + 种子缺失会写出空 json，
        # 覆盖掉真实历史数据，全站接口随之崩。宁可保留旧文件并非 0 退出。
        if not data or not data.get("draws"):
            print(f"  ✗ {key}: 抓取/兜底均无有效开奖数据，拒绝保存（保留已有文件）")
            failed += 1
            continue
        path = scraper.save_lottery(data)
        latest = data["draws"][-1]
        print(f"    共 {data['count']} 期 -> {path}")
        print(f"    最新: {latest['issue']} {latest['date']} "
              f"红{latest['red']} 蓝{latest['blue']}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
