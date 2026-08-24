"""玄学术数类算法（12 种）。

设计参考：Meihua.py（梅花易数）、Bazi.py（八字）、
Liuren.py（大六壬）、Qimen.py（奇门遁甲）、
Ziwei.py（紫微斗数）、Qizheng.py（七政四余）、
Taiyi*.py（太乙神数）、Tieban.py（铁板神数）、
Jiutian.py（九天玄数）等。

实现原则
--------
1. 干支用**儒略日**精确推算：干支序 = (JDN + 49) mod 60（0 = 甲子），
   已用 2000-01-07 甲子日校验。
2. 术数排盘按传统口诀实现（起卦数、四课三传、九宫飞星、安星诀…），
   再按「五行 / 卦数 / 宫位 / 地支」四类映射把盘面折算成号码打分。
3. 号码五行取河图数理（1·6 水，2·7 火，3·8 木，4·9 金，5·0 土）。

⚠️ 免责声明：术数方法没有任何统计预测效力，此处是把传统排盘规则
工程化实现的技术演示，输出仅供娱乐。
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np

from app.lottery.algorithms.base import (
    BAGUA8,
    BAGUA_WUXING,
    DIZHI,
    LUOSHU,
    TIANGAN,
    AlgoContext,
    AlgoOutput,
    digit_seed,
    mod1,
    normalize,
    register,
    wuxing_of,
)

CAT = "metaphysics"

# ---------------------------------------------------------------- 术数常量

WUXING = ["木", "火", "土", "金", "水"]
SHENG = {"木": "火", "火": "土", "土": "金", "金": "水", "水": "木"}   # 生
KE = {"木": "土", "土": "水", "水": "火", "火": "金", "金": "木"}       # 克
GAN_WX = {"甲": "木", "乙": "木", "丙": "火", "丁": "火", "戊": "土",
          "己": "土", "庚": "金", "辛": "金", "壬": "水", "癸": "水"}
ZHI_WX = {"子": "水", "丑": "土", "寅": "木", "卯": "木", "辰": "土", "巳": "火",
          "午": "火", "未": "土", "申": "金", "酉": "金", "戌": "土", "亥": "水"}
# 六十甲子纳音五行（每两个干支共用一个纳音）
NAYIN = ["金", "火", "木", "土", "金", "火", "水", "土", "金", "木",
         "水", "土", "火", "木", "水", "金", "火", "木", "土", "金",
         "火", "水", "土", "金", "木", "水", "土", "火", "木", "水"]
# 二十八宿（角起）
XIU28 = ["角", "亢", "氐", "房", "心", "尾", "箕", "斗", "牛", "女", "虚", "危", "室", "壁",
         "奎", "婁", "胃", "昴", "畢", "觜", "參", "井", "鬼", "柳", "星", "張", "翼", "軫"]
XIU_JI = {"角", "房", "尾", "箕", "斗", "室", "壁", "奎", "胃", "畢", "參", "井", "張", "軫"}  # 吉宿
# 九星紫白（1白 2黑 3碧 4绿 5黄 6白 7赤 8白 9紫）
JIUXING = {1: ("一白貪狼", "吉"), 2: ("二黑巨門", "凶"), 3: ("三碧祿存", "凶"),
           4: ("四綠文曲", "吉"), 5: ("五黃廉貞", "大凶"), 6: ("六白武曲", "吉"),
           7: ("七赤破軍", "凶"), 8: ("八白左輔", "大吉"), 9: ("九紫右弼", "吉")}
# 八门（奇门遁甲）
BAMEN = ["休門", "死門", "傷門", "杜門", "中宮", "開門", "驚門", "生門", "景門"]
MEN_JI = {"休門": 1.0, "生門": 1.2, "開門": 1.0, "景門": 0.3,
          "杜門": -0.3, "傷門": -0.8, "驚門": -0.8, "死門": -1.2, "中宮": 0.0}
# 紫微十四主星吉凶权重
ZIWEI_STARS = {"紫微": 1.2, "天府": 1.0, "太陽": 0.9, "太陰": 0.8, "武曲": 0.7,
               "天同": 0.7, "天機": 0.6, "天梁": 0.6, "天相": 0.6, "廉貞": 0.2,
               "貪狼": 0.1, "巨門": -0.2, "七殺": -0.5, "破軍": -0.6}
GONG12 = ["命宮", "兄弟", "夫妻", "子女", "財帛", "疾厄",
          "遷移", "交友", "官祿", "田宅", "福德", "父母"]
# 七政（七曜）+ 四余
QIZHENG = ["日", "月", "水", "火", "木", "金", "土"]
SIYU = ["羅睺", "計都", "月氣", "紫炁"]


# ---------------------------------------------------------------- 历法工具


def _jdn(y: int, m: int, d: int) -> int:
    """公历 → 儒略日数（Fliegel-Van Flandern 公式）。"""
    a = (14 - m) // 12
    y2 = y + 4800 - a
    m2 = m + 12 * a - 3
    return d + (153 * m2 + 2) // 5 + 365 * y2 + y2 // 4 - y2 // 100 + y2 // 400 - 32045


class Pan:
    """排盘基础信息：四柱干支 + 儒略日 + 太阳黄经 + 节气。"""

    def __init__(self, d: date, hour: int = 21):
        self.date = d
        self.hour = hour
        self.jdn = _jdn(d.year, d.month, d.day)
        # 日干支：(JDN + 49) mod 60，0 = 甲子（以 2000-01-07 甲子日校验）
        self.day_gz = (self.jdn + 49) % 60
        self.year_gz = (d.year - 4) % 60
        self.month_zhi = d.month % 12            # 近似：正月建丑→寅（未做节气校正）
        self.month_gan = (d.year * 12 + d.month + 3) % 10
        self.hour_zhi = ((hour + 1) // 2) % 12
        # 时干 = 日干×2 + 时支（五鼠遁）
        self.hour_gan = (self.day_gz % 10 * 2 + self.hour_zhi) % 10
        # 太阳黄经近似（低精度天文公式，误差 < 0.5°）
        n = self.jdn - 2451545.0 + (hour - 12) / 24.0
        L = (280.460 + 0.9856474 * n) % 360.0
        g = math.radians((357.528 + 0.9856003 * n) % 360.0)
        self.sun_lon = (L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360.0
        # 节气索引：以春分 0° 为 0 号（清明 15°…），共 24 气
        self.jieqi_idx = int(self.sun_lon // 15) % 24
        self.xiu = self.jdn % 28                 # 二十八宿值日
        self.week = (self.jdn + 1) % 7           # 七曜值日

    # ---- 便捷属性
    @property
    def day_gan(self) -> str:
        return TIANGAN[self.day_gz % 10]

    @property
    def day_zhi(self) -> str:
        return DIZHI[self.day_gz % 12]

    @property
    def year_gan(self) -> str:
        return TIANGAN[self.year_gz % 10]

    @property
    def year_zhi(self) -> str:
        return DIZHI[self.year_gz % 12]

    def pillars(self) -> list[tuple[str, str]]:
        return [
            (TIANGAN[self.year_gz % 10], DIZHI[self.year_gz % 12]),
            (TIANGAN[self.month_gan], DIZHI[self.month_zhi]),
            (self.day_gan, self.day_zhi),
            (TIANGAN[self.hour_gan], DIZHI[self.hour_zhi]),
        ]

    def label(self) -> str:
        return " ".join(g + z for g, z in self.pillars())


def _pan(ctx: AlgoContext) -> Pan:
    """以「下一期开奖」的估计时刻排盘（末期日期 + 2 天，开奖 21:15 → 亥时）。"""
    def build():
        raw = str(ctx.draws[-1].get("date", ""))
        try:
            y, m, d = (int(v) for v in raw[:10].split("-"))
            base = date(y, m, d)
        except Exception:  # noqa: BLE001
            base = date.today()
        return Pan(base + timedelta(days=2), hour=21)

    return ctx.cache("pan", build)  # type: ignore[return-value]


# ---------------------------------------------------------------- 打分工具


def _wx_scores(max_n: int, weights: dict[str, float]) -> np.ndarray:
    return np.array([weights.get(wuxing_of(j), 0.0) for j in range(1, max_n + 1)])


def _mod_scores(max_n: int, mod: int, table: dict[int, float]) -> np.ndarray:
    return np.array([table.get(mod1(j, mod), 0.0) for j in range(1, max_n + 1)])


def _jitter(max_n: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(abs(seed) % (2 ** 31))
    return rng.random(max_n) * 1e-3


def _mix(max_n: int, parts: list[tuple[np.ndarray, float]], seed: int) -> np.ndarray:
    acc = np.zeros(max_n)
    for arr, w in parts:
        acc += w * normalize(arr)
    return normalize(acc + _jitter(max_n, seed))


# ---------------------------------------------------------------- 1. 梅花易数

@register("meihua", "梅花易数时间起卦", CAT,
          "按邵康节时间起卦法：上卦 =（年支+月+日）÷8 取余，下卦 = 再加时辰，"
          "动爻 = 总数 ÷6 取余；推出本卦→互卦→变卦，依体用生克定吉凶，"
          "再由卦数（先天八卦数）与卦气五行映射到号码。",
          ["梅花易数", "时间起卦", "体用生克", "互卦变卦", "先天八卦数"], cost=1)
def meihua(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    yz = p.year_gz % 12 + 1
    total_up = yz + p.date.month + p.date.day
    total_dn = total_up + p.hour_zhi + 1
    up = mod1(total_up, 8)
    dn = mod1(total_dn, 8)
    yao = mod1(total_dn, 6)
    g_up, g_dn = BAGUA8[up], BAGUA8[dn]
    # 体用：动爻在下卦(1-3)则下卦为用，否则上卦为用
    if yao <= 3:
        ti, yong = g_up, g_dn
    else:
        ti, yong = g_dn, g_up
    wx_ti, wx_yong = BAGUA_WUXING[ti], BAGUA_WUXING[yong]
    if SHENG[wx_yong] == wx_ti:
        verdict, gain = "用生体 · 大吉", 1.0
    elif wx_yong == wx_ti:
        verdict, gain = "体用同气 · 吉", 0.7
    elif KE[wx_ti] == wx_yong:
        verdict, gain = "体克用 · 小吉", 0.4
    elif SHENG[wx_ti] == wx_yong:
        verdict, gain = "体生用 · 耗", -0.2
    else:
        verdict, gain = "用克体 · 凶", -0.6
    # 变卦：动爻所在卦数 +1（阴阳变）
    bian_up = mod1(up + (1 if yao > 3 else 0), 8)
    bian_dn = mod1(dn + (1 if yao <= 3 else 0), 8)
    # 打分：卦数匹配 + 卦气五行 + 变卦补充
    gua_w = {up: 1.0, dn: 0.9, bian_up: 0.5, bian_dn: 0.45}
    wx_w = {wx_ti: 0.8 + 0.4 * gain, wx_yong: 0.6,
            SHENG[wx_ti]: 0.3, KE[wx_ti]: -0.2}
    seed = digit_seed(up, dn, yao, p.jdn)
    parts = [(_mod_scores(ctx.red_max, 8, gua_w), 1.0),
             (_wx_scores(ctx.red_max, wx_w), 0.9),
             (_mod_scores(ctx.red_max, 6, {yao: 0.8, mod1(yao + 3, 6): 0.3}), 0.5)]
    red = _mix(ctx.red_max, parts, seed)
    bparts = [(_mod_scores(ctx.blue_max, 8, gua_w), 1.0),
              (_wx_scores(ctx.blue_max, wx_w), 0.9)]
    blue = _mix(ctx.blue_max, bparts, seed + 7)
    return AlgoOutput(red=red, blue=blue, detail={
        "起卦时刻": f"{p.date} 亥时（{p.label()}）",
        "上卦": f"{g_up}（{up}）", "下卦": f"{g_dn}（{dn}）", "动爻": f"第 {yao} 爻",
        "体卦": f"{ti}·{wx_ti}", "用卦": f"{yong}·{wx_yong}",
        "变卦": f"{BAGUA8[bian_up]}上{BAGUA8[bian_dn]}下",
        "体用判定": verdict,
        "映射": "号码 mod 8 → 卦数；号码尾数 → 河图五行",
    })


# ---------------------------------------------------------------- 2. 八字

@register("bazi", "八字四柱喜用神", CAT,
          "排出年月日时四柱八字，统计天干地支五行分布，取最弱者为喜用神、"
          "最旺者为忌神；再按日干推禄神、天乙贵人地支，"
          "号码五行合喜用则加分、合忌神则减分。",
          ["八字", "四柱", "五行旺衰", "喜用神", "天乙贵人", "禄神"], cost=1)
def bazi(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    cnt = {w: 0.0 for w in WUXING}
    for g, z in p.pillars():
        cnt[GAN_WX[g]] += 1.0
        cnt[ZHI_WX[z]] += 1.0
    xiyong = min(cnt, key=lambda k: cnt[k])
    jishen = max(cnt, key=lambda k: cnt[k])
    dg = p.day_gan
    # 禄神（日干临官）
    lu = {"甲": "寅", "乙": "卯", "丙": "午", "丁": "巳", "戊": "午",
          "己": "巳", "庚": "申", "辛": "酉", "壬": "子", "癸": "亥"}[dg]
    # 天乙贵人（按日干查）
    guiren = {"甲": "丑未", "乙": "子申", "丙": "亥酉", "丁": "亥酉", "戊": "丑未",
              "己": "子申", "庚": "午寅", "辛": "午寅", "壬": "巳卯", "癸": "巳卯"}[dg]
    wx_w = {xiyong: 1.0, SHENG[xiyong]: 0.45, jishen: -0.5, GAN_WX[dg]: 0.35}
    zhi_w = {DIZHI.index(lu) + 1: 0.9}
    for ch in guiren:
        zhi_w[DIZHI.index(ch) + 1] = 0.75
    seed = digit_seed(p.day_gz, p.year_gz, p.hour_gan)
    red = _mix(ctx.red_max, [(_wx_scores(ctx.red_max, wx_w), 1.2),
                             (_mod_scores(ctx.red_max, 12, zhi_w), 0.8)], seed)
    blue = _mix(ctx.blue_max, [(_wx_scores(ctx.blue_max, wx_w), 1.2),
                               (_mod_scores(ctx.blue_max, 12, zhi_w), 0.8)], seed + 3)
    return AlgoOutput(red=red, blue=blue, detail={
        "四柱": p.label(),
        "五行分布": {k: int(v) for k, v in cnt.items()},
        "喜用神": xiyong, "忌神": jishen,
        "日干": dg, "禄神": lu, "天乙贵人": guiren,
        "映射": "尾数五行合喜用 +1.0，合忌神 -0.5；号码 mod 12 合禄神/贵人加分",
    })


# ---------------------------------------------------------------- 3. 大六壬

@register("liuren", "大六壬四课三传", CAT,
          "以月将加时起天盘、地盘十二宫错位，取日干支阴阳四课，"
          "按「贼克法」定初传，中传末传顺推，三传地支即为用神；"
          "号码 mod 12 落三传或三合局者加分。",
          ["大六壬", "四课三传", "月将加时", "贼克法", "三合局"], cost=1)
def liuren(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    # 月将（太阳所在宫，近似取节气对应将神）：亥将起于春分前
    yuejiang = (p.jieqi_idx // 2 + 11) % 12
    shift = (yuejiang - p.hour_zhi) % 12          # 月将加时 → 天盘位移
    dz = p.day_gz % 12
    dg = p.day_gz % 10
    # 四课：干阳课 / 干阴课 / 支阳课 / 支阴课
    gan_ji = {0: 2, 1: 3, 2: 5, 3: 6, 4: 5, 5: 6, 6: 8, 7: 9, 8: 11, 9: 0}[dg]  # 干寄宫
    k1 = (gan_ji + shift) % 12
    k2 = (k1 + shift) % 12
    k3 = (dz + shift) % 12
    k4 = (k3 + shift) % 12
    ke = [k1, k2, k3, k4]
    # 贼克法：上克下为「贼」，下克上为「克」，取先见者为初传
    chu = k1
    for a, b in ((k2, k1), (k4, k3)):
        if KE[ZHI_WX[DIZHI[a]]] == ZHI_WX[DIZHI[b]]:
            chu = a
            break
    zhong = (chu + shift) % 12
    mo = (zhong + shift) % 12
    san = [chu, zhong, mo]
    # 三合局（申子辰 / 亥卯未 / 寅午戌 / 巳酉丑）
    he = [(8, 0, 4), (11, 3, 7), (2, 6, 10), (5, 9, 1)]
    trio = next((t for t in he if chu in t), ())
    zhi_w = {chu + 1: 1.0, zhong + 1: 0.7, mo + 1: 0.5}
    for z in trio:
        zhi_w.setdefault(z + 1, 0.45)
    wx_w = {ZHI_WX[DIZHI[chu]]: 0.8, SHENG[ZHI_WX[DIZHI[chu]]]: 0.35}
    seed = digit_seed(chu, zhong, mo, p.jdn)
    red = _mix(ctx.red_max, [(_mod_scores(ctx.red_max, 12, zhi_w), 1.2),
                             (_wx_scores(ctx.red_max, wx_w), 0.7)], seed)
    blue = _mix(ctx.blue_max, [(_mod_scores(ctx.blue_max, 12, zhi_w), 1.2),
                               (_wx_scores(ctx.blue_max, wx_w), 0.7)], seed + 11)
    return AlgoOutput(red=red, blue=blue, detail={
        "日干支": f"{p.day_gan}{p.day_zhi}", "占时": DIZHI[p.hour_zhi] + "时",
        "月将": DIZHI[yuejiang], "天地盘位移": shift,
        "四课": "".join(DIZHI[k] for k in ke),
        "三传": f"初传{DIZHI[chu]} → 中传{DIZHI[zhong]} → 末传{DIZHI[mo]}",
        "三合局": "".join(DIZHI[z] for z in trio) if trio else "无",
        "映射": "号码 mod 12 → 十二地支宫；三传权重 1.0/0.7/0.5",
    })


# ---------------------------------------------------------------- 4. 奇门遁甲

@register("qimen", "奇门遁甲九宫排盘", CAT,
          "按节气定阴阳遁与局数，日干支定旬首三奇六仪，飞布八门九星于洛书九宫；"
          "生门/开门/休门与三奇（乙丙丁）所落之宫为吉，号码 mod 9 落吉宫加分。",
          ["奇门遁甲", "阴阳遁", "洛书九宫", "三奇六仪", "八门九星"], cost=1)
def qimen(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    yang = 0 <= p.jieqi_idx < 12          # 春分→秋分为阳遁（近似）
    ju = mod1(p.day_gz % 9 + 1, 9)        # 局数（简化：以日干支定局）
    xun = (p.day_gz // 10) % 6            # 旬首（甲子/甲戌/甲申/甲午/甲辰/甲寅）
    step = 1 if yang else -1
    # 八门飞宫：值使门自旬首宫顺（阳）/逆（阴）飞
    gong_men: dict[int, str] = {}
    start = mod1(ju + xun, 9)
    for i in range(9):
        g = mod1(start + step * i, 9)
        gong_men[g] = BAMEN[i]
    # 三奇（乙丙丁）落宫
    sanqi = [mod1(ju + step * k, 9) for k in (1, 2, 3)]
    # 九星紫白同盘
    gong_w: dict[int, float] = {}
    for g in range(1, 10):
        w = MEN_JI.get(gong_men.get(g, "中宮"), 0.0)
        star_name, ji = JIUXING[g]
        w += {"大吉": 0.8, "吉": 0.5, "凶": -0.4, "大凶": -0.8}[ji]
        if g in sanqi:
            w += 0.9
        gong_w[g] = w
    seed = digit_seed(ju, xun, p.jdn, int(yang))
    red = _mix(ctx.red_max, [(_mod_scores(ctx.red_max, 9, gong_w), 1.4)], seed)
    blue = _mix(ctx.blue_max, [(_mod_scores(ctx.blue_max, 9, gong_w), 1.4)], seed + 5)
    return AlgoOutput(red=red, blue=blue, detail={
        "遁法": "阳遁" if yang else "阴遁", "局数": f"{ju} 局",
        "旬首": f"甲{DIZHI[(p.day_gz // 10 * 10) % 12]}",
        "日干支": f"{p.day_gan}{p.day_zhi}",
        "八门落宫": {str(g): gong_men[g] for g in sorted(gong_men)},
        "三奇落宫": sanqi,
        "洛书九宫": LUOSHU.tolist(),
        "映射": "号码 mod 9 → 九宫；吉门+三奇+紫白吉星累加权重",
    })


# ---------------------------------------------------------------- 5. 紫微斗数

@register("ziwei", "紫微斗数十二宫安星", CAT,
          "以农历月与时辰定命宫（寅起顺数），由年干支纳音取五行局，"
          "按安星诀定紫微落宫并顺次安十四主星；"
          "号码 mod 12 落吉星宫位者按星曜吉凶权重加分。",
          ["紫微斗数", "十二宫", "五行局", "安星诀", "十四主星"], cost=1)
def ziwei(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    lunar_m = mod1(p.date.month, 12)
    ming = (2 + lunar_m - 1 - p.hour_zhi) % 12           # 寅宫起，顺月逆时
    shen = (2 + lunar_m - 1 + p.hour_zhi) % 12
    ju_wx = NAYIN[p.year_gz // 2]                        # 纳音五行局
    ju_num = {"水": 2, "木": 3, "金": 4, "土": 5, "火": 6}[ju_wx]
    day = p.date.day
    ziwei_gong = (ming + (day + ju_num - 1) // ju_num) % 12
    order = ["紫微", "天機", "太陽", "武曲", "天同", "廉貞", "天府",
             "太陰", "貪狼", "巨門", "天相", "天梁", "七殺", "破軍"]
    star_gong: dict[str, int] = {}
    for i, s in enumerate(order[:6]):                    # 紫微系逆行
        star_gong[s] = (ziwei_gong - i) % 12
    tianfu = (ziwei_gong + 4) % 12
    for i, s in enumerate(order[6:]):                    # 天府系顺行
        star_gong[s] = (tianfu + i) % 12
    gong_w: dict[int, float] = {}
    for s, g in star_gong.items():
        gong_w[g + 1] = gong_w.get(g + 1, 0.0) + ZIWEI_STARS[s]
    gong_w[ming + 1] = gong_w.get(ming + 1, 0.0) + 0.6   # 命宫加权
    gong_w[shen + 1] = gong_w.get(shen + 1, 0.0) + 0.3
    seed = digit_seed(ming, ziwei_gong, p.jdn)
    red = _mix(ctx.red_max, [(_mod_scores(ctx.red_max, 12, gong_w), 1.3),
                             (_wx_scores(ctx.red_max, {ju_wx: 0.6}), 0.5)], seed)
    blue = _mix(ctx.blue_max, [(_mod_scores(ctx.blue_max, 12, gong_w), 1.3),
                               (_wx_scores(ctx.blue_max, {ju_wx: 0.6}), 0.5)], seed + 8)
    return AlgoOutput(red=red, blue=blue, detail={
        "命宫": f"{DIZHI[ming]}宫", "身宫": f"{DIZHI[shen]}宫",
        "五行局": f"{ju_wx}{ju_num}局（年柱纳音）",
        "紫微落宫": f"{DIZHI[ziwei_gong]}宫", "天府落宫": f"{DIZHI[tianfu]}宫",
        "十四主星": {s: f"{DIZHI[g]}宫" for s, g in star_gong.items()},
        "十二宫名": GONG12,
        "映射": "号码 mod 12 → 地支宫；按十四主星吉凶权重累加",
    })


# ---------------------------------------------------------------- 6. 七政四余

@register("qizheng", "七政四余七曜宿度", CAT,
          "用低精度天文公式算太阳真黄经与七政（日月水火木金土）平黄经，"
          "结合二十八宿值日与七曜值日定吉凶；"
          "号码按黄道 360° 等分映射到度数扇区，靠近吉曜度数者加分。",
          ["七政四余", "黄经", "二十八宿", "七曜值日", "天文历算"], cost=2)
def qizheng(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    d = p.jdn - 2451545.0
    # 七政平黄经（简化平均运动，单位 °/日）
    speed = {"日": 0.9856474, "月": 13.176396, "水": 4.0923, "火": 0.5240,
             "木": 0.0831, "金": 1.6021, "土": 0.0334}
    epoch = {"日": 280.460, "月": 218.316, "水": 252.251, "火": 355.433,
             "木": 34.351, "金": 181.980, "土": 50.078}
    lon = {k: (epoch[k] + speed[k] * d) % 360.0 for k in QIZHENG}
    lon["日"] = p.sun_lon
    # 四余：罗睺=月北交点（逆行），计都=南交点
    node = (125.045 - 0.0529539 * d) % 360.0
    yu = {"羅睺": node, "計都": (node + 180) % 360.0,
          "月氣": (lon["月"] + 90) % 360.0, "紫炁": (lon["木"] + 120) % 360.0}
    ji_yao = {"木": 1.0, "金": 0.9, "日": 0.7, "月": 0.6, "水": 0.4,
              "火": -0.5, "土": -0.6}
    xiu_name = XIU28[p.xiu]
    xiu_bonus = 0.5 if xiu_name in XIU_JI else -0.3

    def side(max_n: int) -> np.ndarray:
        deg = (np.arange(1, max_n + 1) - 0.5) / max_n * 360.0
        s = np.zeros(max_n)
        for k, w in ji_yao.items():
            dd = np.abs(deg - lon[k])
            dd = np.minimum(dd, 360 - dd)
            s += w * np.exp(-0.5 * (dd / 18.0) ** 2)      # 18° 容许度
        for k, v in yu.items():
            dd = np.abs(deg - v)
            dd = np.minimum(dd, 360 - dd)
            s += (-0.6 if k in ("羅睺", "計都") else 0.4) * np.exp(-0.5 * (dd / 12.0) ** 2)
        # 二十八宿扇区
        xiu_deg = p.xiu / 28.0 * 360.0
        dd = np.abs(deg - xiu_deg)
        dd = np.minimum(dd, 360 - dd)
        s += xiu_bonus * np.exp(-0.5 * (dd / 10.0) ** 2)
        return s

    seed = digit_seed(p.jdn, p.xiu, int(p.sun_lon))
    return AlgoOutput(
        red=_mix(ctx.red_max, [(side(ctx.red_max), 1.0)], seed),
        blue=_mix(ctx.blue_max, [(side(ctx.blue_max), 1.0)], seed + 2),
        detail={
            "太阳真黄经": f"{p.sun_lon:.2f}°",
            "七政黄经": {k: f"{v:.1f}°" for k, v in lon.items()},
            "四余黄经": {k: f"{v:.1f}°" for k, v in yu.items()},
            "二十八宿值日": f"{xiu_name}宿（{'吉' if xiu_name in XIU_JI else '凶'}）",
            # 七曜值日：星期日→日曜，星期一→月曜，星期二→火曜…
            "七曜值日": QIZHENG[[0, 1, 3, 2, 4, 5, 6][p.week % 7]] + "曜日",
            "映射": "号码等分黄道 360°，与吉曜度数的角距按高斯核加权",
        })


# ---------------------------------------------------------------- 7. 太乙神数

@register("taiyi", "太乙神数积年推算", CAT,
          "以上元甲子为起点算太乙积年，积年 mod 72 定太乙所在宫（十六神游行），"
          "推文昌、始击、主客算与三基五福；号码按 mod 16 落宫与积年环距加权。",
          ["太乙神数", "太乙积年", "十六神", "文昌始击", "主客算"], cost=1)
def taiyi(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    # 太乙积年（自上元甲子，通用取 10153917 + 公元年）
    jinian = 10153917 + p.date.year
    taiyi_gong = mod1(jinian % 72 // 3 + 1, 16)       # 十六神游行宫
    wenchang = mod1(taiyi_gong + 3, 16)              # 文昌
    shiji = mod1(jinian % 16 + 1, 16)                # 始击
    zhu_suan = mod1((jinian + p.date.month) % 16 + 1, 16)   # 主算
    ke_suan = mod1((jinian + p.date.day) % 16 + 1, 16)      # 客算
    ji3 = [mod1(taiyi_gong + k, 16) for k in (1, 5, 9)]     # 三基
    wufu = [mod1(wenchang + k, 16) for k in (2, 4, 6, 8, 10)]  # 五福
    w = {taiyi_gong: 1.0, wenchang: 0.9, shiji: -0.5,
         zhu_suan: 0.7, ke_suan: 0.4}
    for g in ji3:
        w[g] = w.get(g, 0.0) + 0.3
    for g in wufu:
        w[g] = w.get(g, 0.0) + 0.25
    seed = digit_seed(jinian, taiyi_gong, p.jdn)
    red = _mix(ctx.red_max, [(_mod_scores(ctx.red_max, 16, w), 1.3)], seed)
    blue = _mix(ctx.blue_max, [(_mod_scores(ctx.blue_max, 16, w), 1.3)], seed + 6)
    return AlgoOutput(red=red, blue=blue, detail={
        "太乙积年": jinian,
        "太乙宫": taiyi_gong, "文昌": wenchang, "始击": shiji,
        "主算": zhu_suan, "客算": ke_suan,
        "三基": ji3, "五福": wufu,
        "映射": "号码 mod 16 → 十六神宫位；文昌/三基/五福为吉，始击为凶",
    })


# ---------------------------------------------------------------- 8. 铁板神数

@register("tieban", "铁板神数条文推数", CAT,
          "以先天卦数（父母数/本人数）配合期号与日干支合成「条文号」，"
          "条文号逐位拆解还原为号码，再以先天八卦数与太玄数交叉验证。",
          ["铁板神数", "先天卦数", "条文号", "太玄数", "数字拆解"], cost=1)
def tieban(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    issue = "".join(ch for ch in str(ctx.draws[-1].get("issue", "")) if ch.isdigit())
    iv = int(issue[-4:]) if issue else 0
    xian_tian = mod1(p.year_gz % 8 + 1, 8)          # 先天卦数
    ben_ren = mod1(p.day_gz % 8 + 1, 8)             # 本人数
    tiaowen = (xian_tian * 1500 + ben_ren * 137 + iv * 7 + p.jdn) % 12000
    digits = [int(c) for c in str(tiaowen).zfill(5)]
    # 条文号逐位 + 相邻两位组合 → 候选号码
    cand: dict[int, float] = {}
    for i, dv in enumerate(digits):
        v = mod1(dv if dv else 10, ctx.red_max)
        cand[v] = cand.get(v, 0.0) + 1.0 - i * 0.12
    for i in range(len(digits) - 1):
        v = mod1(digits[i] * 10 + digits[i + 1], ctx.red_max)
        cand[v] = cand.get(v, 0.0) + 0.8
    # 太玄数（干支纳甲：甲己子午9 乙庚丑未8 丙辛寅申7 丁壬卯酉6 戊癸辰戌5 巳亥4）
    taixuan = {0: 9, 5: 9, 1: 8, 6: 8, 2: 7, 7: 7, 3: 6, 8: 6, 4: 5, 9: 5}[p.day_gz % 10]
    gua_w = {xian_tian: 0.9, ben_ren: 0.8, mod1(xian_tian + ben_ren, 8): 0.5}
    seed = digit_seed(tiaowen, xian_tian, ben_ren)
    base = np.array([cand.get(j, 0.0) for j in range(1, ctx.red_max + 1)])
    red = _mix(ctx.red_max, [(base, 1.2),
                             (_mod_scores(ctx.red_max, 8, gua_w), 0.8),
                             (_mod_scores(ctx.red_max, 9, {taixuan: 0.6}), 0.4)], seed)
    bb = np.array([1.0 if mod1(d if d else 10, ctx.blue_max) == j else 0.0
                   for j in range(1, ctx.blue_max + 1) for d in [digits[0]]])
    blue = _mix(ctx.blue_max, [(bb, 0.8),
                               (_mod_scores(ctx.blue_max, 8, gua_w), 1.0)], seed + 4)
    return AlgoOutput(red=red, blue=blue, detail={
        "先天卦数": xian_tian, "本人数": ben_ren,
        "期号取数": iv, "日干支": f"{p.day_gan}{p.day_zhi}",
        "条文号": tiaowen, "条文拆解": digits,
        "太玄数": taixuan,
        "映射": "条文号逐位 + 相邻两位组合 → 号码；先天卦数与太玄数加权校验",
    })


# ---------------------------------------------------------------- 9. 九天玄数

@register("jiutian", "九天玄数九宫飞星", CAT,
          "按年紫白起星（(11-(年-1900) mod 9)），再以月、日飞星入洛书九宫，"
          "三盘叠加得每宫吉凶；号码 mod 9 落宫加权，八白左辅与九紫右弼最吉。",
          ["九天玄数", "九宫飞星", "紫白诀", "洛书", "年月日三盘"], cost=1)
def jiutian(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    y_star = mod1(11 - (p.date.year - 1900) % 9, 9)
    m_star = mod1(y_star + p.date.month, 9)
    d_star = mod1(p.jdn % 9 + 1, 9)
    weight = {"大吉": 1.0, "吉": 0.6, "凶": -0.5, "大凶": -1.0}
    gong_w: dict[int, float] = {}
    for g in range(1, 10):
        # 三盘飞星：宫位 g 上分别落入的星
        stars = [mod1(y_star + g - 1, 9), mod1(m_star + g - 1, 9), mod1(d_star + g - 1, 9)]
        w = sum(weight[JIUXING[s][1]] * k for s, k in zip(stars, (0.5, 0.3, 0.2)))
        gong_w[g] = w
    seed = digit_seed(y_star, m_star, d_star)
    red = _mix(ctx.red_max, [(_mod_scores(ctx.red_max, 9, gong_w), 1.4)], seed)
    blue = _mix(ctx.blue_max, [(_mod_scores(ctx.blue_max, 9, gong_w), 1.4)], seed + 9)
    return AlgoOutput(red=red, blue=blue, detail={
        "年紫白": f"{y_star} {JIUXING[y_star][0]}",
        "月飞星": f"{m_star} {JIUXING[m_star][0]}",
        "日飞星": f"{d_star} {JIUXING[d_star][0]}",
        "洛书九宫": LUOSHU.tolist(),
        "宫位权重": {str(k): round(v, 3) for k, v in gong_w.items()},
        "映射": "号码 mod 9 → 九宫；年/月/日三盘飞星按 0.5/0.3/0.2 加权",
    })


# ---------------------------------------------------------------- 10. 六十四卦

@register("liushisi_gua", "六十四卦爻变推演", CAT,
          "取最近 6 期号码和值的奇偶为六爻（初爻在下）得本卦，"
          "按先天六十四卦序推出之卦，取上下卦五行、卦序与爻位区间三重映射。",
          ["六十四卦", "爻变", "先天卦序", "上下卦五行", "爻位区间"], cost=1)
def liushisi_gua(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    sums = ctx.red_sum[-6:] if ctx.n >= 6 else np.resize(ctx.red_sum, 6)
    yao = [(1 if int(s) % 2 else 0) for s in sums]      # 初爻…上爻
    dn_idx = yao[0] * 4 + yao[1] * 2 + yao[2]
    up_idx = yao[3] * 4 + yao[4] * 2 + yao[5]
    # 三爻二进制 → 先天八卦数（乾1兑2离3震4巽5坎6艮7坤8，阳=1）
    tri2gua = {7: 1, 6: 2, 5: 3, 4: 4, 3: 5, 2: 6, 1: 7, 0: 8}
    up, dn = tri2gua[up_idx], tri2gua[dn_idx]
    order = (up - 1) * 8 + dn                          # 先天六十四卦序 1..64
    dong = mod1(int(abs(ctx.red_sum[-1])) + p.hour_zhi, 6)   # 动爻
    yao2 = yao.copy()
    yao2[dong - 1] ^= 1
    up2 = tri2gua[yao2[3] * 4 + yao2[4] * 2 + yao2[5]]
    dn2 = tri2gua[yao2[0] * 4 + yao2[1] * 2 + yao2[2]]
    order2 = (up2 - 1) * 8 + dn2
    wx_w = {BAGUA_WUXING[BAGUA8[up]]: 0.9, BAGUA_WUXING[BAGUA8[dn]]: 0.7,
            BAGUA_WUXING[BAGUA8[up2]]: 0.4}
    gua_w = {up: 0.8, dn: 0.9, up2: 0.4, dn2: 0.45}
    # 爻位区间：把号码分 6 段，动爻所在段加权
    seg = np.zeros(ctx.red_max)
    lo = int((dong - 1) / 6 * ctx.red_max)
    hi = int(dong / 6 * ctx.red_max)
    seg[lo:hi] = 1.0
    seed = digit_seed(order, order2, dong)
    red = _mix(ctx.red_max, [(_mod_scores(ctx.red_max, 8, gua_w), 1.0),
                             (_wx_scores(ctx.red_max, wx_w), 0.8),
                             (seg, 0.5),
                             (_mod_scores(ctx.red_max, 64, {order: 1.0, order2: 0.6}), 0.4)], seed)
    blue = _mix(ctx.blue_max, [(_mod_scores(ctx.blue_max, 8, gua_w), 1.0),
                               (_wx_scores(ctx.blue_max, wx_w), 0.8)], seed + 12)
    return AlgoOutput(red=red, blue=blue, detail={
        "六爻(初→上)": ["陽" if v else "陰" for v in yao],
        "本卦": f"上{BAGUA8[up]}下{BAGUA8[dn]}（先天序 {order}）",
        "动爻": f"第 {dong} 爻",
        "之卦": f"上{BAGUA8[up2]}下{BAGUA8[dn2]}（先天序 {order2}）",
        "取爻来源": "最近 6 期红球和值奇偶",
        "映射": "卦数 mod 8 + 上下卦五行 + 动爻区间 + 先天序 mod 64",
    })


# ---------------------------------------------------------------- 11. 河图洛书

@register("hetu_luoshu", "河图洛书五行生克", CAT,
          "按河图数理给每个号码定五行（1·6水 2·7火 3·8木 4·9金 5·0土），"
          "统计最近 30 期各五行的旺衰，取「生我」者为吉、「克我」者为凶，"
          "再叠加洛书九宫方位（八白九紫为吉方）。",
          ["河图", "洛书", "五行生克", "旺衰统计", "九宫方位"], cost=1)
def hetu_luoshu(ctx: AlgoContext) -> AlgoOutput:
    win = 30
    seg = ctx.R[-win:] if ctx.n >= win else ctx.R
    cnt = {w: 0.0 for w in WUXING}
    for row in seg:
        for v in row:
            cnt[wuxing_of(int(v))] += 1.0
    tot = sum(cnt.values()) or 1.0
    ratio = {k: v / tot for k, v in cnt.items()}
    wang = max(ratio, key=lambda k: ratio[k])      # 当令旺者
    shuai = min(ratio, key=lambda k: ratio[k])     # 衰者
    sheng_wo = next(k for k, v in SHENG.items() if v == wang)   # 生旺者
    ke_wo = next(k for k, v in KE.items() if v == wang)
    wx_w = {sheng_wo: 1.0, shuai: 0.8, wang: 0.3, ke_wo: -0.4}
    # 洛书九宫方位吉凶
    gong_w = {int(v): (0.8 if int(v) in (8, 9, 1, 6) else -0.3)
              for v in LUOSHU.ravel()}
    seed = digit_seed(int(tot), ctx.n)
    red = _mix(ctx.red_max, [(_wx_scores(ctx.red_max, wx_w), 1.3),
                             (_mod_scores(ctx.red_max, 9, gong_w), 0.6)], seed)
    blue = _mix(ctx.blue_max, [(_wx_scores(ctx.blue_max, wx_w), 1.3),
                               (_mod_scores(ctx.blue_max, 9, gong_w), 0.6)], seed + 1)
    return AlgoOutput(red=red, blue=blue, detail={
        "统计窗口": f"最近 {win} 期",
        "五行占比": {k: f"{v:.1%}" for k, v in ratio.items()},
        "当令旺者": wang, "最衰者": shuai,
        "生旺之五行": sheng_wo, "克旺之五行": ke_wo,
        "河图数理": "1·6→水，2·7→火，3·8→木，4·9→金，5·0→土（取号码尾数）",
        "洛书吉方": "8 白 / 9 紫 / 1 白 / 6 白",
    })


# ---------------------------------------------------------------- 12. 二十四节气

@register("jieqi_nayin", "二十四节气纳音旺衰", CAT,
          "用太阳真黄经定当前节气（每 15° 一气），按四时五行旺相休囚死给权重，"
          "再叠加日柱六十甲子纳音五行与当值地支三合局。",
          ["二十四节气", "太阳黄经", "旺相休囚死", "六十甲子纳音", "三合局"], cost=1)
def jieqi_nayin(ctx: AlgoContext) -> AlgoOutput:
    p = _pan(ctx)
    names = ["春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至", "小暑", "大暑",
             "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪",
             "冬至", "小寒", "大寒", "立春", "雨水", "惊蛰"]
    jq = names[p.jieqi_idx]
    season = ["春", "夏", "秋", "冬"][((p.jieqi_idx + 22) % 24) // 6]
    # 四时五行状态：旺/相/休/囚/死
    state = {
        "春": {"木": "旺", "火": "相", "水": "休", "金": "囚", "土": "死"},
        "夏": {"火": "旺", "土": "相", "木": "休", "水": "囚", "金": "死"},
        "秋": {"金": "旺", "水": "相", "土": "休", "火": "囚", "木": "死"},
        "冬": {"水": "旺", "木": "相", "金": "休", "土": "囚", "火": "死"},
    }[season]
    sw = {"旺": 1.0, "相": 0.6, "休": 0.1, "囚": -0.3, "死": -0.6}
    wx_w = {k: sw[v] for k, v in state.items()}
    nayin = NAYIN[p.day_gz // 2]
    wx_w[nayin] = wx_w.get(nayin, 0.0) + 0.5
    # 当值地支三合局
    dz = p.day_gz % 12
    he = [(8, 0, 4), (11, 3, 7), (2, 6, 10), (5, 9, 1)]
    trio = next((t for t in he if dz in t), ())
    zhi_w = {z + 1: 0.6 for z in trio}
    zhi_w[dz + 1] = 0.9
    seed = digit_seed(p.jieqi_idx, p.day_gz, p.jdn)
    red = _mix(ctx.red_max, [(_wx_scores(ctx.red_max, wx_w), 1.3),
                             (_mod_scores(ctx.red_max, 12, zhi_w), 0.7)], seed)
    blue = _mix(ctx.blue_max, [(_wx_scores(ctx.blue_max, wx_w), 1.3),
                               (_mod_scores(ctx.blue_max, 12, zhi_w), 0.7)], seed + 10)
    return AlgoOutput(red=red, blue=blue, detail={
        "太阳黄经": f"{p.sun_lon:.2f}°", "当前节气": jq, "时令": season,
        "五行旺衰": state,
        "日柱": f"{p.day_gan}{p.day_zhi}", "日柱纳音": nayin + "命",
        "三合局": "".join(DIZHI[z] for z in trio) if trio else "无",
        "映射": "尾数五行按旺相休囚死给权 + 纳音加成 + 号码 mod 12 合三合局",
    })
