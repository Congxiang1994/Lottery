"""预测服务：统计推荐 + 梅花易数推荐 + 综合推荐。

重要：彩票随机、不可预测。以下均为「娱乐参考」，严格遵循免责声明。
"""
from __future__ import annotations

from collections import Counter

from datetime import datetime

from app.lottery.services.gua import gua_predict


def _recent_red_freq(draws: list[dict], window: int = 50) -> Counter:
    recent = draws[-window:]
    c = Counter()
    for d in recent:
        c.update(d["red"])
    return c


def statistical_predict(draws: list[dict], meta: dict) -> dict:
    red_c = _recent_red_freq(draws, 50)
    blue_c = Counter()
    for d in draws[-50:]:
        blue_c.update(d["blue"])

    # 红球：热号优先，搭配少量冷号回补
    red_rank = sorted(range(1, meta["red_max"] + 1), key=lambda n: red_c.get(n, 0), reverse=True)
    hot_n = meta["red_count"] - 2
    pick = red_rank[:hot_n]
    cold = sorted(range(1, meta["red_max"] + 1), key=lambda n: red_c.get(n, 0))[:2]
    for n in cold:
        if n not in pick:
            pick.append(n)
    # 补足到 red_count
    for n in red_rank:
        if len(pick) >= meta["red_count"]:
            break
        if n not in pick:
            pick.append(n)
    pick = sorted(pick[: meta["red_count"]])

    blue_rank = sorted(range(1, meta["blue_max"] + 1), key=lambda n: blue_c.get(n, 0), reverse=True)
    blue = sorted(blue_rank[: meta["blue_count"]])

    return {
        "red": pick,
        "blue": blue,
        "desc": f"近50期频率加权，热号优先并搭配冷号回补（取红球前{hot_n}热 + 2冷）",
    }


def _fuse(stat_red, stat_blue, gua, meta) -> dict:
    if not gua:
        return {"red": stat_red, "blue": stat_blue,
                "desc": "仅统计推荐（玄学服务不可用）"}
    # 红球融合：以统计为基础，用玄学号替换最末位（低优先）统计号，最多替换 2 个
    red = list(stat_red)
    repl = 0
    for n in gua["red"]:
        if n not in red and repl < 2:
            red.pop()
            red.append(n)
            repl += 1
    red = sorted(red[: meta["red_count"]])

    blue = list(stat_blue)
    repl = 0
    for n in gua["blue"]:
        if n not in blue and repl < 1:
            blue.pop()
            blue.append(n)
            repl += 1
    blue = sorted(blue[: meta["blue_count"]])

    return {
        "red": red,
        "blue": blue,
        "desc": f"统计推荐与{gua['method']}融合（{gua['ben_gua']}本卦，动爻{gua['dong_yao']}）",
    }


def predict(lottery: str, draws: list[dict], meta: dict) -> dict:
    stat = statistical_predict(draws, meta)
    gua = gua_predict(lottery, meta)
    combined = _fuse(stat["red"], stat["blue"], gua, meta)
    return {
        "lottery": lottery,
        "name": meta["name"],
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "statistical": stat,
        "gua": gua,
        "combined": combined,
        "disclaimer": "彩票开奖完全随机，任何预测均不具备科学依据，仅供娱乐参考。请理性购彩。",
    }
