"""距离与相似性类算法（9 种）。

设计参考：baseline.py 的 5 种相似性模型与 7 种距离、
Taiyi_Machine.py 的 6 种距离相似性 + K 近邻加权、
Gua.py 的欧氏/曼哈顿/切比雪夫/余弦距离投票策略。

核心思想（类比检索 / case-based reasoning）：
在历史中找到与「当前近期形态」最相似的若干期，看它们的下一期开了什么。
"""
from __future__ import annotations

import numpy as np

from app.algorithms.base import AlgoContext, AlgoOutput, normalize, register

CAT = "similarity"
WIN = 5  # 形态窗口长度
TOPK = 30  # 取最相似的 K 个历史片段


def _windows(H: np.ndarray, win: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """返回 (片段矩阵, 各片段的下一期 one-hot, 当前片段)。"""
    n = H.shape[0]
    if n <= win + 1:
        return np.zeros((0, win * H.shape[1])), np.zeros((0, H.shape[1])), H[-1:].ravel()
    segs = np.stack([H[i:i + win].ravel() for i in range(n - win - 1)])
    nxt = H[win + 1: n]
    cur = H[n - win:].ravel()
    m = min(len(segs), len(nxt))
    return segs[:m], nxt[:m], cur


def _knn_vote(H: np.ndarray, max_n: int, dist_fn, topk: int = TOPK) -> tuple[np.ndarray, dict]:
    segs, nxt, cur = _windows(H, WIN)
    if len(segs) == 0:
        return H.mean(axis=0), {"样本不足": True}
    d = dist_fn(segs, cur)
    d = np.nan_to_num(d, nan=1e9, posinf=1e9)
    idx = np.argsort(d)[:topk]
    w = 1.0 / (d[idx] + 1e-6)
    w = w / w.sum()
    scores = (nxt[idx] * w[:, None]).sum(axis=0)
    return scores, {
        "最近邻数 K": int(topk),
        "最小距离": round(float(d[idx[0]]), 4),
        "最大权重": round(float(w.max()), 4),
    }


def _make(algo_id, name, desc, tags, dist_fn, cost=2):
    @register(algo_id, name, CAT, desc, tags, cost=cost)
    def _fn(ctx: AlgoContext, _d=dist_fn) -> AlgoOutput:
        r, dr = _knn_vote(ctx.RH, ctx.red_max, _d)
        b, _ = _knn_vote(ctx.BH, ctx.blue_max, _d)
        dr["形态窗口"] = WIN
        dr["原理"] = "在历史中检索与当前近 5 期形态最相似的片段，按距离倒数加权投票其下一期号码"
        return AlgoOutput(red=r, blue=b, detail=dr)
    return _fn


# ---------------------------------------------------------------- 1-7. 七种距离

_make("dist_euclidean", "欧氏距离相似检索",
      "以 L2 欧氏距离度量形态相似度：d = √Σ(xᵢ-yᵢ)²，最经典的几何距离。",
      ["欧氏距离", "L2范数", "KNN检索"],
      lambda S, c: np.sqrt(((S - c) ** 2).sum(axis=1)))

_make("dist_manhattan", "曼哈顿距离相似检索",
      "以 L1 曼哈顿距离度量：d = Σ|xᵢ-yᵢ|，对离群维度更鲁棒。",
      ["曼哈顿距离", "L1范数", "鲁棒性"],
      lambda S, c: np.abs(S - c).sum(axis=1))

_make("dist_chebyshev", "切比雪夫距离相似检索",
      "以 L∞ 切比雪夫距离度量：d = max|xᵢ-yᵢ|，只看最大单维偏差。",
      ["切比雪夫距离", "L∞范数", "最大偏差"],
      lambda S, c: np.abs(S - c).max(axis=1))

_make("dist_cosine", "余弦距离相似检索",
      "以余弦距离度量方向相似性：d = 1 - (x·y)/(‖x‖‖y‖)，忽略幅度只看形态方向。",
      ["余弦相似度", "方向相似", "归一化"],
      lambda S, c: 1.0 - (S @ c) / (np.linalg.norm(S, axis=1) * np.linalg.norm(c) + 1e-9))

_make("dist_hamming", "汉明距离相似检索",
      "以汉明距离度量二值序列差异：不同位置的个数，适合 0/1 出现矩阵。",
      ["汉明距离", "二值序列", "位差异"],
      lambda S, c: (S != c).sum(axis=1).astype(float))


def _jaccard(S, c):
    inter = np.minimum(S, c).sum(axis=1)
    union = np.maximum(S, c).sum(axis=1)
    return 1.0 - inter / (union + 1e-9)


_make("dist_jaccard", "杰卡德距离相似检索",
      "以杰卡德距离度量集合重叠度：d = 1 - |A∩B|/|A∪B|，衡量号码集合交叠。",
      ["杰卡德距离", "集合相似度", "IoU"],
      _jaccard)


def _mahalanobis(S, c):
    """马氏距离：考虑各维协方差的尺度不变距离（BVAR 默认距离）。"""
    X = S - S.mean(axis=0)
    # 对角近似 + 收缩正则，避免高维协方差奇异
    var = X.var(axis=0) + 1e-3
    diff = S - c
    return np.sqrt((diff ** 2 / var).sum(axis=1))


_make("dist_mahalanobis", "马氏距离相似检索",
      "以马氏距离度量：d = √((x-y)ᵀΣ⁻¹(x-y))，用协方差归一化各维尺度（收缩对角近似）。",
      ["马氏距离", "协方差归一", "尺度不变"],
      _mahalanobis, cost=3)


# ---------------------------------------------------------------- 8. DTW

@register("dtw", "DTW 动态时间规整", CAT,
          "用动态时间规整对齐长度/相位不同的序列（Sakoe-Chiba 带宽约束），"
          "在时间轴弹性伸缩下寻找最相似的历史形态。",
          ["DTW", "动态规划", "弹性对齐", "Sakoe-Chiba带"], cost=4)
def dtw(ctx: AlgoContext) -> AlgoOutput:
    win = 8
    band = 3
    topk = 20

    def side(H, max_n):
        n = ctx.n
        if n <= win + 2:
            return H.mean(axis=0), {}
        # 用「每期号码和值」的一维序列做 DTW（计算量可控）
        sig = (H * np.arange(1, max_n + 1)).sum(axis=1)
        sig = (sig - sig.mean()) / (sig.std() + 1e-9)
        cur = sig[-win:]
        cands = []
        step = max(1, (n - win - 1) // 400)  # 采样以控制耗时
        for i in range(0, n - win - 1, step):
            seg = sig[i:i + win]
            cands.append((_dtw_dist(seg, cur, band), i))
        cands.sort()
        sel = cands[:topk]
        w = np.array([1.0 / (d + 1e-6) for d, _ in sel])
        w /= w.sum()
        scores = np.zeros(max_n)
        for (d, i), wi in zip(sel, w):
            scores += wi * H[i + win]
        return scores, {"最小DTW距离": round(float(sel[0][0]), 4),
                        "候选片段数": len(cands)}

    r, dr = side(ctx.RH, ctx.red_max)
    b, _ = side(ctx.BH, ctx.blue_max)
    dr.update({"原理": "DTW(A,B) 动态规划最小累积距离，带宽约束 |i-j| ≤ 3",
               "序列窗口": win, "Sakoe-Chiba带宽": band, "K": topk})
    return AlgoOutput(red=r, blue=b, detail=dr)


def _dtw_dist(a: np.ndarray, b: np.ndarray, band: int) -> float:
    n, m = len(a), len(b)
    INF = 1e18
    D = np.full((n + 1, m + 1), INF)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        lo = max(1, i - band)
        hi = min(m, i + band)
        for j in range(lo, hi + 1):
            cost = (a[i - 1] - b[j - 1]) ** 2
            D[i, j] = cost + min(D[i - 1, j], D[i, j - 1], D[i - 1, j - 1])
    return float(np.sqrt(D[n, m])) if D[n, m] < INF else 1e9


# ---------------------------------------------------------------- 9. KNN 多距离融合

@register("knn_multi", "多距离 KNN 集成投票", CAT,
          "同时用欧氏/曼哈顿/切比雪夫/余弦/杰卡德五种距离各自检索最近邻，"
          "再对五套投票结果做等权融合（原项目 AdvancedVotingStrategy 思路）。",
          ["KNN", "多距离融合", "集成投票", "AdvancedVoting"], cost=3)
def knn_multi(ctx: AlgoContext) -> AlgoOutput:
    fns = {
        "欧氏": lambda S, c: np.sqrt(((S - c) ** 2).sum(axis=1)),
        "曼哈顿": lambda S, c: np.abs(S - c).sum(axis=1),
        "切比雪夫": lambda S, c: np.abs(S - c).max(axis=1),
        "余弦": lambda S, c: 1.0 - (S @ c) / (np.linalg.norm(S, axis=1) * np.linalg.norm(c) + 1e-9),
        "杰卡德": _jaccard,
    }

    def side(H, max_n):
        acc = np.zeros(max_n)
        for f in fns.values():
            s, _ = _knn_vote(H, max_n, f)
            acc += normalize(s)
        return acc / len(fns)

    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "5 种距离分别 KNN 投票 → 归一化后等权平均",
                "参与距离": list(fns.keys()),
                "每套 K": TOPK, "形态窗口": WIN},
    )
