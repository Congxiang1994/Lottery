"""算法引擎核心：统一接口、注册表、特征工程工具。

设计要点
--------
1. 每个算法都是一个纯函数：``fn(ctx) -> AlgoOutput``
   返回「每个号码的打分向量」而不是直接返回号码，这样所有算法
   可比较、可归一化、可加权投票集成。
2. ``AlgoContext`` 预先算好公用特征（one-hot 矩阵、遗漏矩阵、和值序列…），
   所有算法共享，避免 80+ 个算法各自重复计算。
3. 注册表 ``REGISTRY`` 记录算法元信息（分类/名称/原理/技术标签），
   直接驱动前端「算法广场」。

免责声明：彩票开奖为独立随机事件，任何算法都不具备预测能力。
本模块是算法工程实现的技术演示，输出仅供娱乐参考。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

# ---------------------------------------------------------------- 分类定义

CATEGORIES: dict[str, dict] = {
    "statistical": {
        "key": "statistical",
        "name": "统计与概率",
        "icon": "sigma",
        "desc": "频率分析、马尔可夫链、贝叶斯推断、假设检验、关联规则",
    },
    "timeseries": {
        "key": "timeseries",
        "name": "时间序列",
        "icon": "trending-up",
        "desc": "指数平滑、自回归、傅里叶周期分析、趋势与季节性分解",
    },
    "similarity": {
        "key": "similarity",
        "name": "距离与相似性",
        "icon": "git-compare",
        "desc": "七种距离度量、DTW 动态时间规整、K 近邻加权",
    },
    "ml": {
        "key": "ml",
        "name": "机器学习",
        "icon": "cpu",
        "desc": "梯度提升、随机森林、MLP、SVM、PCA —— 真实训练",
    },
    "deeplearning": {
        "key": "deeplearning",
        "name": "深度学习",
        "icon": "brain",
        "desc": "LSTM / Transformer / TCN / VAE / GAN / GAT，numpy 手写轻量实现",
    },
    "quantum": {
        "key": "quantum",
        "name": "量子计算",
        "icon": "atom",
        "desc": "态矢量模拟真实量子门，Born 规则采样、量子行走、Grover 算子",
    },
    "symbolic": {
        "key": "symbolic",
        "name": "符号回归",
        "icon": "function-square",
        "desc": "遗传编程在算子空间搜索显式数学公式",
    },
    "physics": {
        "key": "physics",
        "name": "物理启发",
        "icon": "waves",
        "desc": "布朗运动、混沌映射、热传导、弹簧振动、波函数演化",
    },
    "seeds": {
        "key": "seeds",
        "name": "种子寻优",
        "icon": "dices",
        "desc": "五种种子生成模式 + 参数网格穷举寻优",
    },
    "metaphysics": {
        "key": "metaphysics",
        "name": "玄学术数",
        "icon": "orbit",
        "desc": "梅花易数、八字、六十四卦、太乙神数、六壬、奇门、紫微、七政四余",
    },
    "signal": {
        "key": "signal",
        "name": "信号与图像",
        "icon": "radar",
        "desc": "雷达图编码 + Lucas-Kanade 光流外推、极坐标映射",
    },
    "ensemble": {
        "key": "ensemble",
        "name": "集成融合",
        "icon": "layers",
        "desc": "多算法投票、元学习器加权、分类内融合",
    },
}


# ---------------------------------------------------------------- 数据结构


@dataclass
class AlgoOutput:
    """算法输出：号码打分向量（越高越推荐）+ 可选细节。"""

    red: np.ndarray  # shape (red_max,)
    blue: np.ndarray  # shape (blue_max,)
    detail: dict = field(default_factory=dict)


@dataclass
class AlgoMeta:
    id: str
    name: str
    category: str
    desc: str
    tags: list[str]
    fn: Callable[["AlgoContext"], AlgoOutput]
    cost: int = 1  # 1=极快 2=快 3=中 4=慢（用于批量接口分级）


REGISTRY: dict[str, AlgoMeta] = {}


def register(
    algo_id: str,
    name: str,
    category: str,
    desc: str,
    tags: list[str],
    cost: int = 1,
):
    """算法注册装饰器。"""

    def deco(fn):
        if algo_id in REGISTRY:
            raise ValueError(f"重复的算法 id: {algo_id}")
        REGISTRY[algo_id] = AlgoMeta(
            id=algo_id,
            name=name,
            category=category,
            desc=desc,
            tags=tags,
            fn=fn,
            cost=cost,
        )
        return fn

    return deco


# ---------------------------------------------------------------- 上下文


class AlgoContext:
    """所有算法共享的预计算特征。

    ``draws`` 为按日期升序的开奖列表，每项形如
    ``{"issue": "25001", "date": "2025-01-02", "red": [...], "blue": [...]}``。
    """

    def __init__(self, lottery: str, draws: list[dict], meta: dict, limit: int = 1500):
        self.lottery = lottery
        self.meta = meta
        # 只取最近 limit 期，兼顾算法效果与响应速度
        self.draws = draws[-limit:] if limit and len(draws) > limit else draws
        self.all_draws = draws

        self.red_max: int = meta["red_max"]
        self.blue_max: int = meta["blue_max"]
        self.red_count: int = meta["red_count"]
        self.blue_count: int = meta["blue_count"]

        n = len(self.draws)
        self.n = n

        # 号码矩阵：R (n, red_count) / B (n, blue_count)
        self.R = np.array([d["red"] for d in self.draws], dtype=np.int32)
        self.B = np.array([d["blue"] for d in self.draws], dtype=np.int32)

        # one-hot 出现矩阵：(n, red_max) / (n, blue_max)，1 表示该期出现
        self.RH = np.zeros((n, self.red_max), dtype=np.float64)
        for i, row in enumerate(self.R):
            self.RH[i, row - 1] = 1.0
        self.BH = np.zeros((n, self.blue_max), dtype=np.float64)
        for i, row in enumerate(self.B):
            self.BH[i, row - 1] = 1.0

        # 遗漏矩阵：(n, max) 每期每号「距上次出现的期数」
        self.R_omit = self._omission(self.RH)
        self.B_omit = self._omission(self.BH)

        # 和值 / 跨度 / 奇偶数 / 大小数 序列
        self.red_sum = self.R.sum(axis=1).astype(np.float64)
        self.red_span = (self.R.max(axis=1) - self.R.min(axis=1)).astype(np.float64)
        self.red_odd = (self.R % 2 == 1).sum(axis=1).astype(np.float64)
        self.red_big = (self.R > self.red_max / 2).sum(axis=1).astype(np.float64)

        self._cache: dict[str, object] = {}

    # ---------------------------------------------------------- 工具

    @staticmethod
    def _omission(H: np.ndarray) -> np.ndarray:
        n, m = H.shape
        out = np.zeros((n, m), dtype=np.float64)
        last = np.full(m, -1, dtype=np.int64)
        for i in range(n):
            out[i] = i - last
            hit = np.nonzero(H[i])[0]
            last[hit] = i
        return out

    def current_omission(self, side: str = "red") -> np.ndarray:
        """当前每个号码的遗漏期数（距最近一次出现）。"""
        H = self.RH if side == "red" else self.BH
        m = H.shape[1]
        out = np.zeros(m)
        for j in range(m):
            col = np.nonzero(H[:, j])[0]
            out[j] = (self.n - 1 - col[-1]) if len(col) else self.n
        return out

    def freq(self, side: str = "red", window: int | None = None) -> np.ndarray:
        H = self.RH if side == "red" else self.BH
        if window:
            H = H[-window:]
        return H.sum(axis=0)

    def cache(self, key: str, builder):
        if key not in self._cache:
            self._cache[key] = builder()
        return self._cache[key]

    @property
    def max_of(self):
        return {"red": self.red_max, "blue": self.blue_max}

    @property
    def count_of(self):
        return {"red": self.red_count, "blue": self.blue_count}


# ---------------------------------------------------------------- 打分工具


def normalize(scores: np.ndarray) -> np.ndarray:
    """归一化到 [0,1]，并清洗 NaN/Inf。"""
    s = np.asarray(scores, dtype=np.float64).ravel()
    s = np.nan_to_num(s, nan=0.0, posinf=0.0, neginf=0.0)
    lo, hi = s.min(), s.max()
    if hi - lo < 1e-12:
        return np.full_like(s, 0.5)
    return (s - lo) / (hi - lo)


def softmax(x: np.ndarray, temp: float = 1.0) -> np.ndarray:
    z = np.asarray(x, dtype=np.float64).ravel() / max(temp, 1e-6)
    z = np.nan_to_num(z, nan=0.0, posinf=0.0, neginf=0.0)
    z = z - z.max()
    e = np.exp(z)
    tot = e.sum()
    return e / tot if tot > 1e-12 else np.full_like(e, 1.0 / len(e))


def pick_top(scores: np.ndarray, count: int, max_n: int, tiebreak: int = 0) -> list[int]:
    """按分数取 top-N 号码（1-based）。并列时用确定性 tiebreak 打散。"""
    s = np.asarray(scores, dtype=np.float64).ravel()
    if s.shape[0] != max_n:
        s = np.resize(s, max_n)
    s = np.nan_to_num(s, nan=0.0, posinf=0.0, neginf=0.0)
    # 确定性微扰：避免全等时总是取 1,2,3...
    rng = np.random.default_rng(abs(int(tiebreak)) % (2**31) + 7)
    jitter = rng.random(max_n) * 1e-9
    order = np.argsort(-(s + jitter), kind="stable")
    return sorted(int(i) + 1 for i in order[:count])


def scores_to_picks(out: AlgoOutput, ctx: AlgoContext, tiebreak: int = 0) -> dict:
    """AlgoOutput -> 推荐号码 + 每号置信度（用于前端热度条）。"""
    red = pick_top(out.red, ctx.red_count, ctx.red_max, tiebreak)
    blue = pick_top(out.blue, ctx.blue_count, ctx.blue_max, tiebreak + 999)
    rn = normalize(out.red)
    bn = normalize(out.blue)
    return {
        "red": red,
        "blue": blue,
        "red_scores": [round(float(v), 4) for v in rn],
        "blue_scores": [round(float(v), 4) for v in bn],
        "red_conf": [round(float(rn[i - 1]), 4) for i in red],
        "blue_conf": [round(float(bn[i - 1]), 4) for i in blue],
        "detail": out.detail,
    }


# ---------------------------------------------------------------- 特征工程


def build_feature_matrix(ctx: AlgoContext, side: str = "red") -> tuple[np.ndarray, np.ndarray]:
    """构造 (X, Y) 监督学习样本。

    X_t = 第 t 期的统计特征（和值/奇偶/大小/012路/区间分布/遗漏/近窗频率）
    Y_t = 第 t+1 期的 one-hot 出现向量
    """
    key = f"featmat_{side}"

    def build():
        H = ctx.RH if side == "red" else ctx.BH
        M = ctx.R if side == "red" else ctx.B
        max_n = ctx.red_max if side == "red" else ctx.blue_max
        n = ctx.n
        feats = []
        for t in range(n):
            row = M[t]
            f = [
                row.sum() / (max_n * len(row)),
                (row.max() - row.min()) / max_n if len(row) > 1 else 0.0,
                (row % 2 == 1).sum() / len(row),
                (row > max_n / 2).sum() / len(row),
                (row % 3 == 0).sum() / len(row),
                (row % 3 == 1).sum() / len(row),
                (row % 3 == 2).sum() / len(row),
                float(np.std(row)) / max_n,
            ]
            # 区间分布（5 段）
            seg = np.zeros(5)
            for v in row:
                seg[min(int((v - 1) / max_n * 5), 4)] += 1
            f.extend((seg / len(row)).tolist())
            # 近 10 期频率（压缩为 max_n 维）
            w = H[max(0, t - 9) : t + 1].sum(axis=0) / 10.0
            f.extend(w.tolist())
            # 当期遗漏（归一）
            f.extend((np.minimum(ctx.R_omit[t] if side == "red" else ctx.B_omit[t], 60) / 60.0).tolist())
            feats.append(f)
        X = np.asarray(feats, dtype=np.float64)
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        Y = H
        return X, Y

    return ctx.cache(key, build)  # type: ignore[return-value]


def lagged_windows(H: np.ndarray, win: int) -> tuple[np.ndarray, np.ndarray]:
    """滑动窗口序列样本：X (N, win, m) -> Y (N, m)。"""
    n, m = H.shape
    if n <= win:
        return np.zeros((0, win, m)), np.zeros((0, m))
    X = np.stack([H[i : i + win] for i in range(n - win)])
    Y = H[win:]
    return X, Y


def safe_run(meta: AlgoMeta, ctx: AlgoContext) -> AlgoOutput:
    """执行算法，异常时降级为均匀分布并记录错误。"""
    try:
        out = meta.fn(ctx)
        red = np.nan_to_num(np.asarray(out.red, dtype=np.float64).ravel(), nan=0.0,
                            posinf=0.0, neginf=0.0)
        blue = np.nan_to_num(np.asarray(out.blue, dtype=np.float64).ravel(), nan=0.0,
                             posinf=0.0, neginf=0.0)
        if red.shape[0] != ctx.red_max:
            red = np.resize(red, ctx.red_max)
        if blue.shape[0] != ctx.blue_max:
            blue = np.resize(blue, ctx.blue_max)
        return AlgoOutput(red=red, blue=blue, detail=out.detail or {})
    except Exception as exc:  # noqa: BLE001
        return AlgoOutput(
            red=np.full(ctx.red_max, 0.5),
            blue=np.full(ctx.blue_max, 0.5),
            detail={"error": f"{type(exc).__name__}: {exc}"},
        )


# ---------------------------------------------------------------- 数论小工具


def digit_seed(*parts: int) -> int:
    """把若干整数混合成一个稳定的整数种子。"""
    h = 1469598103934665603
    for p in parts:
        h ^= int(p) & 0xFFFFFFFF
        h = (h * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return h & 0x7FFFFFFF


def seed_scores(seed: int, max_n: int, sharpness: float = 1.0) -> np.ndarray:
    """由整数种子确定性地生成号码打分（供玄学/种子类算法使用）。"""
    rng = np.random.default_rng(abs(int(seed)) % (2**31))
    base = rng.random(max_n)
    return base**sharpness


def cyclic_distance(a: np.ndarray, b: np.ndarray, mod: int) -> np.ndarray:
    """环形取模空间距离（太乙神数积年取模用）。"""
    d = np.abs(a - b) % mod
    return np.minimum(d, mod - d)


def wuxing_of(n: int) -> str:
    """号码 -> 五行（河图数理：1/6水 2/7火 3/8木 4/9金 5/0土）。"""
    table = {1: "水", 6: "水", 2: "火", 7: "火", 3: "木", 8: "木",
             4: "金", 9: "金", 5: "土", 0: "土"}
    return table[n % 10]


TIANGAN = "甲乙丙丁戊己庚辛壬癸"
DIZHI = "子丑寅卯辰巳午未申酉戌亥"
BAGUA8 = {1: "乾", 2: "兑", 3: "离", 4: "震", 5: "巽", 6: "坎", 7: "艮", 8: "坤"}
BAGUA_WUXING = {"乾": "金", "兑": "金", "离": "火", "震": "木",
                "巽": "木", "坎": "水", "艮": "土", "坤": "土"}
# 洛书九宫（1-9 宫位数字盘）
LUOSHU = np.array([[4, 9, 2], [3, 5, 7], [8, 1, 6]], dtype=np.int32)


def mod1(n: int, m: int) -> int:
    """取模并把 0 映射为 m（术数常用 1-based 取模）。"""
    r = n % m
    return r if r else m


def gaussian_kernel(x: np.ndarray, mu: float, sigma: float) -> np.ndarray:
    sigma = max(sigma, 1e-6)
    return np.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * math.sqrt(2 * math.pi))
