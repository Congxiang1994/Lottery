"""从 500彩票网 爬取双色球/大乐透历史开奖数据。

数据源：https://datachart.500.com/{ssq,dlt}/history/newinc/history.php
需带 UA + Referer 绕过反爬。解析 HTML 表格行得到结构化数据。
"""
from __future__ import annotations

import re
import json
from pathlib import Path

import requests

from app.lottery.config import DATA_DIR, SCRAPE_HEADERS, LOTTERIES

SEED_FILE = DATA_DIR / "seed_ssq.txt"

# 各彩种起始期号（YYNNN 格式）与抓取终点
START_ISSUE = {"ssq": "03001", "dlt": "07001"}
END_ISSUE = "27999"

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


def _parse_seed_ssq() -> list[dict]:
    """仓库自带的双色球历史数据作为兜底（ssq.txt: 日期,红1..红6,蓝）。"""
    if not SEED_FILE.exists():
        return []
    draws: list[dict] = []
    for line in SEED_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p for p in line.split(",")]
        if len(parts) != 8:
            continue
        try:
            date = parts[0]
            red = [int(x) for x in parts[1:7]]
            blue = [int(parts[7])]
        except ValueError:
            continue
        issue = date[:4] + f"{len(draws)+1:03d}"  # 占位期号
        draws.append({"issue": issue, "date": date, "red": red, "blue": blue})
    return draws


def fetch_lottery(lottery: str, use_seed_fallback: bool = True) -> dict:
    """抓取指定彩种全量历史，返回标准数据结构。失败时回退到种子数据。"""
    meta = LOTTERIES[lottery]
    url = (
        f"https://datachart.500.com/{lottery}/history/newinc/history.php"
        f"?start={START_ISSUE[lottery]}&end={END_ISSUE}"
    )
    draws: list[dict] = []
    try:
        resp = requests.get(url, headers=SCRAPE_HEADERS, timeout=60)
        resp.encoding = "utf-8"
        draws = _parse_rows(resp.text, lottery)
    except Exception as exc:  # noqa: BLE001
        print(f"[scraper] {lottery} 抓取失败: {exc}")

    if not draws and use_seed_fallback and lottery == "ssq":
        draws = _parse_seed_ssq()
        print(f"[scraper] {lottery} 使用本地种子数据 ({len(draws)} 期)")

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
    from datetime import datetime

    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def save_lottery(data: dict, path: Path | None = None) -> Path:
    path = path or (DATA_DIR / f"{data['lottery']}.json")
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def load_lottery(lottery: str) -> dict | None:
    path = DATA_DIR / f"{lottery}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    for key in ("ssq", "dlt"):
        d = fetch_lottery(key)
        save_lottery(d)
        print(f"{key}: {d['count']} 期, 最新 {d['draws'][-1]['date']}")
