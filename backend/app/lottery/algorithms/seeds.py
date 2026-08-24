"""种子寻优类算法（6 种）。

设计参考：Seeds.py / Seed_*.py 的五种种子生成模式
ADD / MULT / COS / LDEV / POS，以及参数穷举寻优。

实现方式
--------
种子由「上期开奖号码 + 期号数字 + 日期数字」确定性混合得到，再由五种映射
把种子展开成号码打分。关键在于**寻优**：每种模式的参数都用最近 150 期做
滚动回测（用当期之前的信息生成打分 → 取 top-k → 数命中），选历史命中最高的
参数。因此结果可复现、可解释，且带有明确的回测指标。

⚠️ 说明：种子类方法本质是确定性数值构造，不具备统计预测能力，
命中率优势来自小样本回测的过拟合，仅作娱乐与工程演示。
"""
from __future__ import annotations

import math

import numpy as np

from app.lottery.algorithms.base import AlgoContext, AlgoOutput, normalize, register

CAT = "seeds"

PHI = (math.sqrt(5.0) - 1.0) / 2.0  # 黄金分割率，低差异序列常数


# ---------------------------------------------------------------- 种子构造


def _seed_at(ctx: AlgoContext, t: int) -> int:
    """由第 t 期（含）之前的公开信息构造种子。"""
    d = ctx.draws[t]
    issue = "".join(ch for ch in str(d.get("issue", "")) if ch.isdigit())
    date = "".join(ch for ch in str(d.get("date", "")) if ch.isdigit())
    s = 0
    s += sum(int(c) for c in issue) * 131
    s += sum(int(c) for c in date) * 17
    s += int(np.sum(ctx.R[t])) * 7919
    s += int(np.sum(ctx.B[t])) * 104729
    s += int(np.prod(ctx.R[t] % 7 + 1))
    return abs(s) % 999983


# ---------------------------------------------------------------- 五种模式


def _mode_add(seed: int, m: int, p: float, hist: np.ndarray) -> np.ndarray:
    x = (seed % 9973) / 9973.0
    j = np.arange(1, m + 1)
    return np.modf(x + p * j * PHI)[0]


def _mode_mult(seed: int, m: int, p: float, hist: np.ndarray) -> np.ndarray:
    x = (seed % 9973) / 9973.0 + 1e-3
    j = np.arange(1, m + 1)
    return np.modf(x * np.power(j, p) * 997.0)[0]


def _mode_cos(seed: int, m: int, p: float, hist: np.ndarray) -> np.ndarray:
    x = (seed % 9973) / 9973.0
    j = np.arange(1, m + 1)
    return 0.5 + 0.5 * np.cos(2.0 * math.pi * (x * p * j + x))


def _mode_ldev(seed: int, m: int, p: float, hist: np.ndarray) -> np.ndarray:
    """LDEV：局部偏差 —— 实际频率与理论期望的偏离，窗口由参数给定。"""
    w = max(6, int(p))
    seg = hist[-w:]
    if seg.shape[0] == 0:
        return np.full(m, 0.5)
    exp = seg.sum() / m
    dev = seg.sum(axis=0) - exp
    jitter = ((seed % 97) / 97.0 - 0.5) * 0.02
    return normalize(-dev) + jitter


def _mode_pos(seed: int, m: int, p: float, hist: np.ndarray) -> np.ndarray:
    """POS：位置分布 —— 每个开奖位次独立统计号码分布，按位次加权求和。"""
    w = max(20, int(p))
    seg = hist[-w:]
    if seg.shape[0] == 0:
        return np.full(m, 0.5)
    n = seg.shape[0]
    ramp = np.linspace(0.4, 1.0, n)  # 越近权重越大
    base = (seg * ramp[:, None]).sum(axis=0)
    shift = seed % m
    return normalize(np.roll(base, shift) * 0.35 + base * 0.65)


MODES = {
    "ADD": (_mode_add, np.linspace(0.05, 2.0, 40)),
    "MULT": (_mode_mult, np.linspace(0.3, 2.4, 36)),
    "COS": (_mode_cos, np.linspace(0.05, 1.5, 40)),
    "LDEV": (_mode_ldev, np.arange(6, 160, 6, dtype=float)),
    "POS": (_mode_pos, np.arange(20, 320, 12, dtype=float)),
}


# ---------------------------------------------------------------- 回测寻优


def _optimize(ctx: AlgoContext, mode: str, side: str, back: int = 150):
    """滚动回测寻找该模式下命中最高的参数。返回 (最优参数, 命中数, 期望命中)。"""
    fn, grid = MODES[mode]
    H = ctx.RH if side == "red" else ctx.BH
    m = ctx.red_max if side == "red" else ctx.blue_max
    k = ctx.red_count if side == "red" else ctx.blue_count
    n = ctx.n
    T = min(back, n - 2)
    if T <= 5:
        return float(grid[0]), 0, 0.0
    ts = range(n - 1 - T, n - 1)
    seeds = {t: _seed_at(ctx, t) for t in ts}
    hits = np.zeros(len(grid))
    for gi, p in enumerate(grid):
        h = 0
        for t in ts:
            sc = fn(seeds[t], m, float(p), H[: t + 1])
            top = np.argpartition(-sc, k - 1)[:k]
            h += int(H[t + 1][top].sum())
        hits[gi] = h
    gi = int(np.argmax(hits))
    return float(grid[gi]), int(hits[gi]), round(T * k * k / m, 1)


def _build(mode: str, name: str, desc: str, tags: list[str], cost: int = 2):
    def fn(ctx: AlgoContext) -> AlgoOutput:
        f, _ = MODES[mode]
        seed = _seed_at(ctx, ctx.n - 1)
        pr, hr, er = _optimize(ctx, mode, "red")
        pb, hb, eb = _optimize(ctx, mode, "blue")
        red = f(seed, ctx.red_max, pr, ctx.RH)
        blue = f(seed + 977, ctx.blue_max, pb, ctx.BH)
        return AlgoOutput(red=normalize(red), blue=normalize(blue), detail={
            "模式": mode,
            "种子": seed,
            "种子构成": "期号数字×131 + 日期数字×17 + 红球和×7919 + 蓝球和×104729 + Π(红球%7+1)",
            "红球最优参数": round(pr, 4),
            "蓝球最优参数": round(pb, 4),
            "红球回测命中/期望": f"{hr} / {er}",
            "蓝球回测命中/期望": f"{hb} / {eb}",
            "回测期数": 150,
            "候选参数数": len(MODES[mode][1]),
        })

    register(f"seed_{mode.lower()}", name, CAT, desc, tags, cost)(fn)
    return fn


_build("ADD", "ADD 加法种子寻优",
       "种子加法展开：sⱼ = frac(seed₀ + p·j·φ)（φ 为黄金分割率，构成低差异序列），"
       "参数 p 在 40 个候选上用 150 期滚动回测择优。",
       ["种子生成", "加法模式", "黄金分割", "低差异序列", "网格寻优"])

_build("MULT", "MULT 乘法种子寻优",
       "种子乘法展开：sⱼ = frac(seed₀·j^p·997)，属乘同余生成器族，"
       "指数 p 在 36 个候选上滚动回测择优。",
       ["种子生成", "乘法模式", "乘同余", "网格寻优"])

_build("COS", "COS 余弦相位种子寻优",
       "余弦相位调制：sⱼ = 0.5 + 0.5·cos(2π(seed₀·p·j + seed₀))，"
       "通过相位参数 p 控制号码空间的驻波节点位置。",
       ["种子生成", "余弦调制", "相位驻波", "网格寻优"])

_build("LDEV", "LDEV 局部偏差种子寻优",
       "统计窗口内实际频次与理论期望 E=N/m 的偏差，取偏差为负（欠开）者优先，"
       "窗口长度 6~160 期穷举寻优，叠加种子微扰打散并列。",
       ["种子生成", "局部偏差", "欠开补偿", "窗口寻优"])

_build("POS", "POS 位置分布种子寻优",
       "对开奖位次分布做距离衰减加权统计（近期权重 1.0，远期 0.4），"
       "再按种子做环形位移混合，窗口 20~320 期穷举寻优。",
       ["种子生成", "位置分布", "距离衰减", "环形位移", "窗口寻优"])


# ---------------------------------------------------------------- 全模式穷举

@register("seed_grid", "五模式全局穷举寻优", CAT,
          "把 ADD/MULT/COS/LDEV/POS 五种模式的全部参数候选（共 190+ 组）"
          "放在一起做 150 期滚动回测，全局挑出命中最高的「模式+参数」组合，"
          "并给出各模式命中排行。",
          ["全局穷举", "模式选择", "滚动回测", "命中排行"], cost=4)
def seed_grid(ctx: AlgoContext) -> AlgoOutput:
    board = {}
    best = (None, 0.0, -1)
    for mode in MODES:
        p, h, e = _optimize(ctx, mode, "red")
        board[mode] = {"最优参数": round(p, 4), "命中": h, "期望": e}
        if h > best[2]:
            best = (mode, p, h)
    mode, pr, hr = best
    pb, hb, eb = _optimize(ctx, mode, "blue")
    f, _ = MODES[mode]
    seed = _seed_at(ctx, ctx.n - 1)
    red = f(seed, ctx.red_max, pr, ctx.RH)
    blue = f(seed + 977, ctx.blue_max, pb, ctx.BH)
    return AlgoOutput(red=normalize(red), blue=normalize(blue), detail={
        "全局最优模式": mode,
        "红球最优参数": round(pr, 4),
        "蓝球最优参数": round(pb, 4),
        "红球回测命中": hr,
        "蓝球回测命中/期望": f"{hb} / {eb}",
        "各模式排行": board,
        "候选总数": sum(len(g) for _, g in MODES.values()),
        "说明": "命中优势主要来自小样本过拟合，仅供娱乐",
    })
