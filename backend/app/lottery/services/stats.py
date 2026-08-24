"""统计服务：频率、冷热号、遗漏值、近期走势。纯 CPU，无重型依赖。"""
from __future__ import annotations

from collections import Counter


def _range(max_n: int) -> list[int]:
    return list(range(1, max_n + 1))


def frequency(draws: list[dict], meta: dict) -> dict:
    red_counter = Counter()
    blue_counter = Counter()
    for d in draws:
        red_counter.update(d["red"])
        blue_counter.update(d["blue"])
    total = len(draws)

    def to_list(counter: Counter, max_n: int) -> list[dict]:
        return [
            {
                "number": n,
                "count": counter.get(n, 0),
                "pct": round(counter.get(n, 0) / total * 100, 2) if total else 0,
            }
            for n in _range(max_n)
        ]

    return {
        "red": to_list(red_counter, meta["red_max"]),
        "blue": to_list(blue_counter, meta["blue_max"]),
    }


def omission(draws: list[dict], meta: dict) -> dict:
    """每个号码距离当前已遗漏的期数（越大越冷）。"""
    last_idx: dict[int, int] = {}
    for i, d in enumerate(draws):
        for n in d["red"]:
            last_idx[n] = i
        for n in d["blue"]:
            last_idx[1000 + n] = i  # 蓝球用偏移避免冲突

    cur = len(draws) - 1

    def build(max_n: int, offset: int) -> list[dict]:
        out = []
        for n in _range(max_n):
            idx = last_idx.get(n + offset)
            gap = (cur - idx) if idx is not None else len(draws)
            out.append({"number": n, "omission": gap})
        return out

    return {
        "red": build(meta["red_max"], 0),
        "blue": build(meta["blue_max"], 1000),
    }


def hot_cold(draws: list[dict], meta: dict, window: int = 50, top: int = 10) -> dict:
    recent = draws[-window:] if len(draws) >= window else draws
    red_counter = Counter()
    blue_counter = Counter()
    for d in recent:
        red_counter.update(d["red"])
        blue_counter.update(d["blue"])

    def rank(counter: Counter, max_n: int) -> dict:
        counts = [(n, counter.get(n, 0)) for n in _range(max_n)]
        counts.sort(key=lambda x: x[1], reverse=True)
        hot = [{"number": n, "count": c} for n, c in counts[:top]]
        cold = [{"number": n, "count": c} for n, c in counts[-top:][::-1]]
        return {"hot": hot, "cold": cold}

    return {
        "window": len(recent),
        "red": rank(red_counter, meta["red_max"]),
        "blue": rank(blue_counter, meta["blue_max"]),
    }


def trend(draws: list[dict], meta: dict, window: int = 30) -> list[dict]:
    recent = draws[-window:]
    return [
        {
            "issue": d["issue"],
            "date": d["date"],
            "red": d["red"],
            "blue": d["blue"],
        }
        for d in recent
    ]


def summarize(draws: list[dict], meta: dict) -> dict:
    latest = draws[-1] if draws else None
    return {
        "lottery": meta["key"],
        "name": meta["name"],
        "org": meta["org"],
        "total": len(draws),
        "latest": latest,
        "red_max": meta["red_max"],
        "blue_max": meta["blue_max"],
        "red_count": meta["red_count"],
        "blue_count": meta["blue_count"],
        "red_label": meta["red_label"],
        "blue_label": meta["blue_label"],
    }


def compute_all(draws: list[dict], meta: dict) -> dict:
    return {
        "summary": summarize(draws, meta),
        "frequency": frequency(draws, meta),
        "omission": omission(draws, meta),
        "hot_cold": hot_cold(draws, meta),
        "trend": trend(draws, meta),
    }
