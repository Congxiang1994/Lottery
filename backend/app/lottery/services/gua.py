"""梅花易数 时间起卦 预测。

说明：彩票本质随机、不可预测。此处仅为「易理娱乐参考」，
严格遵循项目 README 的免责声明。起卦方法采用经典
「按年月日时起卦」：上卦=(年+月+日)%8，下卦=(年+月+日+时)%8，
动爻=(年+月+日+时)%6，再据此确定性地映射出候选号码。
"""
from __future__ import annotations

import random

from datetime import datetime, date as date_cls

# 地支 -> 数 (子1 ... 亥12)
ZHI_NUM = {
    "子": 1, "丑": 2, "寅": 3, "卯": 4, "辰": 5, "巳": 6,
    "午": 7, "未": 8, "申": 9, "酉": 10, "戌": 11, "亥": 12,
}
BAGUA = {1: "乾", 2: "兑", 3: "离", 4: "震", 5: "巽", 6: "坎", 7: "艮", 8: "坤"}


def _hour_to_zhi(hour: int) -> int:
    """公历小时 -> 时辰地支数(1-12)。子时 23:00-00:59。

    M27：旧表整体错位（23→11、0→12，实际应为子=1）。改用地支序号公式：
    每个时辰跨 2 小时，子时跨 23/0，故 ``(hour+1)//2 % 12 + 1``：
      23→1(子) 0→1(子) 1→2(丑) 2→2(丑) … 21→12(亥) 22→12(亥)。
    """
    return ((hour % 24 + 1) // 2) % 12 + 1


def _lunar_components(d: date_cls):
    try:
        from lunar_python import Solar, Lunar
    except Exception:  # noqa: BLE001
        return None
    solar = Solar.fromYmd(d.year, d.month, d.day)
    lunar = solar.getLunar()
    zhi = lunar.getYearZhi()
    y_zhi = ZHI_NUM.get(zhi, 1)
    return {
        "y_zhi": y_zhi,
        "y_zhi_name": zhi,
        "month": abs(lunar.getMonth()),
        "day": lunar.getDay(),
    }


def _gua_number(n: int) -> int:
    r = n % 8
    return r if r != 0 else 8


def _yao_number(n: int) -> int:
    r = n % 6
    return r if r != 0 else 6


def _pick(seed: int, count: int, max_n: int) -> list[int]:
    """确定性均匀抽样：用 ``random.Random(seed).sample()`` 取代低位周期有偏的 LCG。

    M28：旧 LCG 的 ``v % max_n`` 低位周期短，某些种子下几乎取不到特定号码；
    ``sample`` 直接在不重复的全集中均匀抽取，且 __random__ 实现稳定可复现。
    """
    count = max(0, min(count, max_n))
    return sorted(random.Random(seed).sample(range(1, max_n + 1), count))


def gua_predict(lottery: str, meta: dict, target_date: date_cls | None = None) -> dict | None:
    target_date = target_date or date_cls.today()
    comp = _lunar_components(target_date)
    if comp is None:
        return None
    hour = datetime.now().hour
    t_zhi = _hour_to_zhi(hour)

    g1 = _gua_number(comp["y_zhi"] + comp["month"] + comp["day"])
    g2 = _gua_number(comp["y_zhi"] + comp["month"] + comp["day"] + t_zhi)
    yao = _yao_number(comp["y_zhi"] + comp["month"] + comp["day"] + t_zhi)

    ben_gua = BAGUA[g1] + BAGUA[g2]
    # 变卦：动爻自初爻(下)起，动爻落在下卦则变下卦
    if yao <= 3:  # 变下卦
        new_g2 = _gua_number(g2 + 1) if g2 != 8 else 1
        bian_gua = BAGUA[g1] + BAGUA[new_g2]
    else:
        new_g1 = _gua_number(g1 + 1) if g1 != 8 else 1
        bian_gua = BAGUA[new_g1] + BAGUA[g2]

    seed = (g1 * 1000 + g2 * 100 + yao * 10 + comp["y_zhi"]) ^ (
        comp["month"] * 31 + comp["day"]
    )
    red = _pick(seed, meta["red_count"], meta["red_max"])
    blue = _pick(seed ^ 0x5A5A, meta["blue_count"], meta["blue_max"])

    return {
        "method": "梅花易数·时间起卦",
        "solar_date": target_date.strftime("%Y-%m-%d"),
        "lunar": f"{comp['y_zhi_name']}年{comp['month']}月{comp['day']}日",
        "time_zhi": t_zhi,
        "ben_gua": ben_gua,
        "bian_gua": bian_gua,
        "dong_yao": yao,
        "red": red,
        "blue": blue,
    }


if __name__ == "__main__":
    from app.lottery.config import LOTTERIES

    for k in ("ssq", "dlt"):
        print(k, gua_predict(k, LOTTERIES[k]))
