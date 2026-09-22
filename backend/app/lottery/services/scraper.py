"""从 500彩票网 爬取双色球/大乐透历史开奖数据。

数据源：https://datachart.500.com/{ssq,dlt}/history/newinc/history.php
需带 UA + Referer 绕过反爬。解析 HTML 表格行得到结构化数据。

兜底：抓取失败时回退到仓库自带的种子数据（backend/app/lottery/seed/seed_*.txt，
随代码一起发布，所以全新机器在抓取失败时也有可用数据，不会跑不出结果）。
"""
from __future__ import annotations

import os
import re
import json
from datetime import datetime
from pathlib import Path

import requests

from app.lottery.config import BASE_DIR, DATA_DIR, SCRAPE_HEADERS, LOTTERIES

# 种子数据目录：**随仓库发布**（不在 .gitignore / 部署排除清单里），
# 用于「抓取失败时的兜底」与「全新机器首次部署」。格式：日期,红1..红N,蓝1..蓝M
SEED_DIR = BASE_DIR / "seed"

# 各彩种起始期号（YYNNN 格式）
START_ISSUE = {"ssq": "03001", "dlt": "07001"}


def _end_issue() -> str:
    """抓取终点期号（YYNNN）。

    原先硬编码 "27999"（= 2027 年），2028 年起新数据会静默抓不到——
    每日跑批仍"成功"但数据冻结。改为按当前年份动态计算（当年 + 1 年），
    永远不需要再维护。
    """
    return f"{(datetime.now().year + 1) % 100:02d}999"


_END_ISSUE = _end_issue()

_RED_BLUE_CLASS = {
    "ssq": ("t_cfont2", "t_cfont4"),  # 红6 蓝1
    "dlt": ("cfont2", "cfont4"),       # 前区5 后区2
}


def _parse_rows(html: str, lottery: str) -> list[dict]:
    red_cls, blue_cls = _RED_BLUE_CLASS[lottery]
    rows = re.findall(r'<tr class="t_tr1">(.*?)</tr>', html, re.S)
    draws: list[dict] = []
    for row in rows:
        issue_m = re.search(r"<td[^>]*>(\d{5})</td>", row)
        date_m = re.search(r"(\d{4}-\d{2}-\d{2})", row)
        if not issue_m or not date_m:
            continue
        red = [int(x) for x in re.findall(rf'class="{red_cls}">(\d{{1,2}})</td>', row)]
        blue = [int(x) for x in re.findall(rf'class="{blue_cls}">(\d{{1,2}})</td>', row)]
        meta = LOTTERIES[lottery]
        if len(red) != meta["red_count"] or len(blue) != meta["blue_count"]:
            continue
        draws.append(
            {
                "issue": issue_m.group(1),
                "date": date_m.group(1),
                "red": red,
                "blue": blue,
            }
        )
    return draws


def _parse_seed(lottery: str) -> list[dict]:
    """仓库自带种子数据（seed/seed_{lottery}.txt: 日期,红1..红N,蓝1..蓝M）。"""
    seed_file = SEED_DIR / f"seed_{lottery}.txt"
    if not seed_file.exists():
        return []
    meta = LOTTERIES[lottery]
    n_red, n_blue = meta["red_count"], meta["blue_count"]
    draws: list[dict] = []
    year_seq: dict[str, int] = {}   # 每年的占位序号（期号仅用于展示/排序兜底）
    for line in seed_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(",")
        if len(parts) != 1 + n_red + n_blue:
            continue
        try:
            date = parts[0].strip()
            red = [int(x) for x in parts[1:1 + n_red]]
            blue = [int(x) for x in parts[1 + n_red:]]
        except ValueError:
            continue
        year = date[:4]
        year_seq[year] = year_seq.get(year, 0) + 1
        draws.append({
            "issue": f"{year}{year_seq[year]:03d}",   # 占位期号（按年内序号，跨年重置）
            "date": date,
            "red": red,
            "blue": blue,
        })
    return draws


def fetch_lottery(lottery: str, use_seed_fallback: bool = True) -> dict:
    """抓取指定彩种全量历史，返回标准数据结构。失败时回退到仓库种子数据。"""
    meta = LOTTERIES[lottery]
    url = (
        f"https://datachart.500.com/{lottery}/history/newinc/history.php"
        f"?start={START_ISSUE[lottery]}&end={_END_ISSUE}"
    )
    draws: list[dict] = []
    try:
        resp = requests.get(url, headers=SCRAPE_HEADERS, timeout=60)
        resp.encoding = "utf-8"
        draws = _parse_rows(resp.text, lottery)
    except Exception as exc:  # noqa: BLE001
        print(f"[scraper] {lottery} 抓取失败: {exc}")

    if not draws and use_seed_fallback:
        draws = _parse_seed(lottery)
        if draws:
            print(f"[scraper] {lottery} 使用仓库种子数据 ({len(draws)} 期)")

    # 去重（按期号）+ 按日期升序
    uniq: dict[str, dict] = {}
    for d in draws:
        uniq[d["issue"]] = d
    draws = sorted(uniq.values(), key=lambda x: x["date"])

    return {
        "lottery": lottery,
        "name": meta["name"],
        "org": meta["org"],
        "red_count": meta["red_count"],
        "red_max": meta["red_max"],
        "blue_count": meta["blue_count"],
        "blue_max": meta["blue_max"],
        "red_label": meta["red_label"],
        "blue_label": meta["blue_label"],
        "updated_at": _now(),
        "count": len(draws),
        "draws": draws,
    }


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def save_lottery(data: dict, path: Path | None = None) -> Path:
    """原子写入 JSON（临时文件 + os.replace）。

    历史实现直接 write_text 覆盖：写入过程中进程被 kill / 磁盘写满时，
    会留下半截 JSON，导致 load_lottery 抛异常、全站接口 503，直到下次抓取成功。
    临时文件与目标同目录，os.replace 在同一文件系统内是原子操作。
    """
    path = path or (DATA_DIR / f"{data['lottery']}.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return path


def load_lottery(lottery: str) -> dict | None:
    """读取数据文件；文件缺失或内容损坏（半截 JSON）都返回 None，不抛异常。"""
    path = DATA_DIR / f"{lottery}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        print(f"[scraper] {lottery} 数据文件损坏，已忽略（可重新抓取）: {path}")
        return None


if __name__ == "__main__":
    for key in ("ssq", "dlt"):
        d = fetch_lottery(key)
        save_lottery(d)
        print(f"{key}: {d['count']} 期, 最新 {d['draws'][-1]['date']}")
