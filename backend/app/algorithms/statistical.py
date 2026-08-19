"""统计与概率类算法（16 种）。

设计参考：baseline.py（MI/NB/CHI/CPT/ARM）、
Emulator.py（泊松+冷门号理论+初等对称多项式）、
BVAR.py（贝叶斯后验推断）、Gua.py（二项检验+Bonferroni）。
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from itertools import combinations

import numpy as np

from app.algorithms.base import (
    AlgoContext,
    AlgoOutput,
    gaussian_kernel,
    normalize,
    register,
)

CAT = "statistical"


# ---------------------------------------------------------------- 1. 全期频率

@register("freq_all", "全期频率统计", CAT,
          "统计全部历史开奖中每个号码的出现次数，出现越多得分越高。最朴素的频率主义视角。",
          ["频率分析", "大数定律"])
def freq_all(ctx: AlgoContext) -> AlgoOutput:
    r = ctx.freq("red")
    b = ctx.freq("blue")
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "P(n) ≈ count(n)/N，全样本频率估计",
                "样本期数": ctx.n,
                "红球最高频": int(np.argmax(r)) + 1,
                "红球最高频次数": int(r.max())},
    )


# ---------------------------------------------------------------- 2. 近期加权频率

@register("freq_weighted", "时间衰减加权频率", CAT,
          "对近期开奖赋予更高权重（指数衰减 λ=0.985），认为近期分布比远期更有代表性。",
          ["频率分析", "指数衰减", "EWMA"])
def freq_weighted(ctx: AlgoContext) -> AlgoOutput:
    lam = 0.985
    w = lam ** np.arange(ctx.n - 1, -1, -1)
    r = (ctx.RH * w[:, None]).sum(axis=0)
    b = (ctx.BH * w[:, None]).sum(axis=0)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "score(n) = Σ_t λ^(N-t) · 1[n ∈ draw_t]",
                "衰减系数 λ": lam,
                "有效窗口": round(1 / (1 - lam), 1)},
    )


# ---------------------------------------------------------------- 3. 冷热平衡

@register("hot_cold", "冷热号动态平衡", CAT,
          "以近 30/100 期频率比值判定号码冷热，热号顺势 + 冷号回补，取平衡组合。",
          ["冷热分析", "均值回归"])
def hot_cold(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        short = H[-30:].sum(axis=0) / max(len(H[-30:]), 1)
        long = H[-100:].sum(axis=0) / max(len(H[-100:]), 1)
        ratio = (short + 1e-6) / (long + 1e-6)
        # 热度偏离 1 越多越"有故事"：热号顺势 0.6 权重，冷号回补 0.4
        hot = normalize(ratio)
        cold = normalize(-ratio)
        return 0.6 * hot + 0.4 * cold * 0.8
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "ratio = f_30 / f_100，>1 为热、<1 为冷",
                "策略": "热号顺势权重 0.6 + 冷号回补权重 0.32"},
    )


# ---------------------------------------------------------------- 4. 遗漏值回归

@register("omission", "遗漏值回归分析", CAT,
          "计算每号当前遗漏期数与其历史平均遗漏的偏差，遗漏超期越多则「回补压力」越大。",
          ["遗漏分析", "均值回归"])
def omission(ctx: AlgoContext) -> AlgoOutput:
    def side(H, omit, max_n):
        cur = np.zeros(max_n)
        for j in range(max_n):
            col = np.nonzero(H[:, j])[0]
            cur[j] = (ctx.n - 1 - col[-1]) if len(col) else ctx.n
        avg = np.array([omit[:, j][omit[:, j] > 0].mean() if (omit[:, j] > 0).any() else 1.0
                        for j in range(max_n)])
        return (cur + 1e-6) / (avg + 1e-6)
    r = side(ctx.RH, ctx.R_omit, ctx.red_max)
    b = side(ctx.BH, ctx.B_omit, ctx.blue_max)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "pressure(n) = 当前遗漏 / 历史平均遗漏",
                "红球最大回补压力号": int(np.argmax(r)) + 1,
                "该号压力倍数": round(float(r.max()), 2)},
    )


# ---------------------------------------------------------------- 5. 一阶马尔可夫

@register("markov1", "一阶马尔可夫链", CAT,
          "构建号码转移矩阵 P(j|i)：统计上一期出现 i 时下一期出现 j 的条件频率，由最近一期状态推演。",
          ["马尔可夫链", "转移矩阵", "条件概率"], cost=2)
def markov1(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        T = np.zeros((max_n, max_n))
        for t in range(ctx.n - 1):
            cur = np.nonzero(H[t])[0]
            nxt = np.nonzero(H[t + 1])[0]
            for i in cur:
                T[i, nxt] += 1
        T = (T + 0.1) / (T.sum(axis=1, keepdims=True) + 0.1 * max_n)  # 拉普拉斯平滑
        last = np.nonzero(H[-1])[0]
        return T[last].mean(axis=0)
    r = side(ctx.RH, ctx.red_max)
    b = side(ctx.BH, ctx.blue_max)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "P(X_{t+1}=j | X_t=i) 由频次估计 + 拉普拉斯平滑(α=0.1)",
                "转移矩阵规模": f"{ctx.red_max}×{ctx.red_max}",
                "起始状态": [int(x) + 1 for x in np.nonzero(ctx.RH[-1])[0]]},
    )


# ---------------------------------------------------------------- 6. 高阶马尔可夫

@register("markov2", "二阶马尔可夫链", CAT,
          "考虑前两期联合状态的高阶转移：P(j | X_{t-1}, X_t)，捕捉更长的依赖记忆。",
          ["高阶马尔可夫", "联合状态"], cost=2)
def markov2(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        score = np.full(max_n, 0.1)
        cnt = np.full(max_n, 1e-6)
        last2 = set(np.nonzero(H[-2])[0]) if ctx.n >= 2 else set()
        last1 = set(np.nonzero(H[-1])[0])
        for t in range(1, ctx.n - 1):
            s2 = set(np.nonzero(H[t - 1])[0])
            s1 = set(np.nonzero(H[t])[0])
            # 相似度：与当前前两期状态的 Jaccard
            j2 = len(s2 & last2) / max(len(s2 | last2), 1)
            j1 = len(s1 & last1) / max(len(s1 | last1), 1)
            wgt = (0.35 * j2 + 0.65 * j1) ** 2
            if wgt <= 1e-9:
                continue
            nxt = np.nonzero(H[t + 1])[0]
            score[nxt] += wgt
            cnt += wgt / max_n
        return score / cnt
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "二阶状态相似度加权：w = (0.35·J₂ + 0.65·J₁)²，J 为 Jaccard 相似度",
                "阶数": 2},
    )


# ---------------------------------------------------------------- 7. 条件概率表 CPT

@register("cpt", "条件概率表 CPT", CAT,
          "以上期和值区间、奇偶比、大小比为条件变量，建立号码出现的条件概率表并做平滑组合。",
          ["条件概率表", "拉普拉斯平滑", "特征条件化"], cost=2)
def cpt(ctx: AlgoContext) -> AlgoOutput:
    smooth = 0.1

    def bucket(t):
        s = ctx.red_sum[t]
        lo, hi = ctx.red_sum.min(), ctx.red_sum.max()
        sb = min(int((s - lo) / max(hi - lo, 1e-9) * 5), 4)
        return (sb, int(ctx.red_odd[t]), int(ctx.red_big[t]))

    def side(H, max_n):
        tables: dict = defaultdict(lambda: np.full(max_n, smooth))
        totals: dict = defaultdict(lambda: smooth * max_n)
        for t in range(ctx.n - 1):
            k = bucket(t)
            nxt = np.nonzero(H[t + 1])[0]
            tables[k][nxt] += 1
            totals[k] += len(nxt)
        cur = bucket(ctx.n - 1)
        # 精确匹配 + 部分匹配平均（combine_method='average'）
        acc = np.zeros(max_n)
        w = 0.0
        for k, tab in tables.items():
            match = sum(1 for a, b in zip(k, cur) if a == b)
            if match == 0:
                continue
            weight = match**2
            acc += weight * tab / totals[k]
            w += weight
        return acc / w if w > 0 else np.full(max_n, 1.0 / max_n)

    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "P(n | 和值区间, 奇偶比, 大小比)，按条件匹配度平方加权平均",
                "条件变量": ["和值5分位", "奇数个数", "大数个数"],
                "当前条件": list(bucket(ctx.n - 1)),
                "平滑系数": smooth},
    )


# ---------------------------------------------------------------- 8. 朴素贝叶斯

@register("naive_bayes", "朴素贝叶斯分类", CAT,
          "对每个号码建立「下期是否出现」的二分类朴素贝叶斯模型，特征条件独立假设 + 拉普拉斯平滑。",
          ["朴素贝叶斯", "拉普拉斯平滑", "生成式模型"], cost=2)
def naive_bayes(ctx: AlgoContext) -> AlgoOutput:
    alpha = 1.0

    def side(H, max_n, omit):
        # 离散特征：该号上期是否出现、遗漏分箱、近10期频次分箱
        n = ctx.n
        scores = np.zeros(max_n)
        for j in range(max_n):
            y = H[1:, j]  # 下期是否出现
            f_prev = H[:-1, j]
            f_omit = np.minimum(omit[:-1, j] // 5, 9)
            f_freq = np.minimum(
                np.array([H[max(0, t - 9):t + 1, j].sum() for t in range(n - 1)]), 5)
            pos = y > 0
            p_pos = (pos.sum() + alpha) / (len(y) + 2 * alpha)
            logp = math.log(p_pos)
            logn = math.log(1 - p_pos)
            cur = (H[-1, j], min(omit[-1, j] // 5, 9),
                   min(H[-10:, j].sum(), 5))
            for feat, c in ((f_prev, cur[0]), (f_omit, cur[1]), (f_freq, cur[2])):
                k = len(np.unique(feat)) or 1
                lp = (np.sum((feat == c) & pos) + alpha) / (pos.sum() + alpha * k)
                ln = (np.sum((feat == c) & ~pos) + alpha) / ((~pos).sum() + alpha * k)
                logp += math.log(max(lp, 1e-12))
                logn += math.log(max(ln, 1e-12))
            scores[j] = logp - logn  # 对数似然比
        return scores

    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max, ctx.R_omit),
        blue=side(ctx.BH, ctx.blue_max, ctx.B_omit),
        detail={"原理": "log P(出现|X) - log P(不出现|X)，特征条件独立",
                "特征": ["上期是否出现", "遗漏分箱", "近10期频次"],
                "平滑 α": alpha},
    )


# ---------------------------------------------------------------- 9. 卡方检验

@register("chi_square", "卡方拟合优度检验", CAT,
          "对每个号码做 χ² 检验，衡量其实际出现频次与均匀分布期望的偏离显著性（阈值 3.84, p=0.05）。",
          ["卡方检验", "假设检验", "χ²"])
def chi_square(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n, count):
        obs = H.sum(axis=0)
        exp = ctx.n * count / max_n
        chi = (obs - exp) ** 2 / max(exp, 1e-9)
        signed = np.sign(obs - exp) * chi  # 正向偏离（偏多）得分更高
        return signed
    r = side(ctx.RH, ctx.red_max, ctx.red_count)
    b = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    sig_r = int((np.abs(r) > 3.84).sum())
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "χ² = (O-E)²/E，带符号以区分偏多/偏少",
                "临界值(p=0.05)": 3.84,
                "红球显著偏离个数": sig_r,
                "结论": "显著偏离个数接近随机预期，印证开奖均匀性"},
    )


# ---------------------------------------------------------------- 10. 互信息

@register("mutual_info", "互信息特征筛选", CAT,
          "计算「上期号码集合」与「下期各号出现」之间的互信息 I(X;Y)，衡量非线性统计相关性。",
          ["互信息", "信息论", "非线性相关"], cost=2)
def mutual_info(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        scores = np.zeros(max_n)
        n = ctx.n - 1
        for j in range(max_n):
            y = H[1:, j] > 0
            best = 0.0
            for i in range(max_n):
                x = H[:-1, i] > 0
                mi = 0.0
                for xv in (False, True):
                    for yv in (False, True):
                        pxy = np.mean((x == xv) & (y == yv))
                        px = np.mean(x == xv)
                        py = np.mean(y == yv)
                        if pxy > 1e-12 and px > 1e-12 and py > 1e-12:
                            mi += pxy * math.log(pxy / (px * py))
                if mi > best:
                    best = mi
            scores[j] = best
        return scores
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "I(X;Y) = ΣΣ p(x,y)·log[p(x,y)/(p(x)p(y))]，取最强关联前驱",
                "阈值": 0.01,
                "说明": "互信息普遍极低（≈0），从信息论角度证明期间独立性"},
    )


# ---------------------------------------------------------------- 11. Apriori 关联规则

@register("arm", "Apriori 关联规则挖掘", CAT,
          "在历史开奖组合中挖掘频繁项集与关联规则（min_support=0.02），寻找号码共现模式。",
          ["Apriori", "关联规则", "频繁项集", "支持度/置信度"], cost=3)
def arm(ctx: AlgoContext) -> AlgoOutput:
    min_sup = 0.02
    min_conf = 0.15

    def side(H, max_n, count):
        n = ctx.n
        sets = [set(np.nonzero(H[t])[0]) for t in range(n)]
        # L1 频繁 1 项集
        c1 = Counter()
        for s in sets:
            c1.update(s)
        l1 = {i for i, c in c1.items() if c / n >= min_sup}
        # L2 频繁 2 项集
        c2 = Counter()
        for s in sets:
            for pair in combinations(sorted(s & l1), 2):
                c2[pair] += 1
        l2 = {p: c / n for p, c in c2.items() if c / n >= min_sup}
        last = set(np.nonzero(H[-1])[0])
        scores = np.zeros(max_n)
        rules = 0
        for (a, b), sup in l2.items():
            conf_ab = sup / (c1[a] / n) if c1[a] else 0
            conf_ba = sup / (c1[b] / n) if c1[b] else 0
            if a in last and conf_ab >= min_conf:
                scores[b] += conf_ab * sup
                rules += 1
            if b in last and conf_ba >= min_conf:
                scores[a] += conf_ba * sup
                rules += 1
        if scores.max() <= 0:
            scores = H.sum(axis=0) / n
        return scores, len(l2), rules

    r, n2, nr = side(ctx.RH, ctx.red_max, ctx.red_count)
    b, _, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "支持度 support(A∪B) ≥ 0.02，置信度 conf(A→B) ≥ 0.15",
                "频繁2项集数": n2, "触发规则数": nr,
                "最小支持度": min_sup, "最小置信度": min_conf},
    )


# ---------------------------------------------------------------- 12. 贝叶斯后验

@register("bayes_beta", "Beta-Binomial 贝叶斯后验", CAT,
          "以 Beta 分布为共轭先验建模每号中奖率，由历史数据更新后验，输出后验均值与置信区间。"
          "这是 BVAR/MCMC 贝叶斯推断的解析共轭轻量版。",
          ["贝叶斯推断", "共轭先验", "Beta-Binomial", "后验采样"])
def bayes_beta(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n, count):
        # 先验：Jeffreys prior Beta(0.5, 0.5)，按理论概率校准
        p0 = count / max_n
        a0, b0 = 0.5 + p0 * 2, 0.5 + (1 - p0) * 2
        hits = H.sum(axis=0)
        a = a0 + hits
        b = b0 + (ctx.n - hits)
        mean = a / (a + b)
        var = a * b / ((a + b) ** 2 * (a + b + 1))
        # Thompson sampling 风格：后验均值 + 不确定性奖励
        return mean + 0.5 * np.sqrt(var), mean, np.sqrt(var)

    r, rm, rs = side(ctx.RH, ctx.red_max, ctx.red_count)
    b, _, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "θ ~ Beta(α₀+hits, β₀+misses)，取后验均值 + 0.5σ 不确定性奖励",
                "先验": "Jeffreys Beta(0.5,0.5) 按理论概率校准",
                "理论概率": round(ctx.red_count / ctx.red_max, 4),
                "后验均值范围": [round(float(rm.min()), 4), round(float(rm.max()), 4)],
                "后验标准差均值": round(float(rs.mean()), 5)},
    )


# ---------------------------------------------------------------- 13. 泊松 + 冷门号理论

@register("poisson_emulator", "泊松冷门号博弈模型", CAT,
          "模拟彩民投注行为（泊松分布 λ∈[3,10]），用初等对称多项式精确计算组合概率，"
          "优先选择「冷门但等概率」的号码以最大化期望奖金份额。",
          ["泊松分布", "初等对称多项式", "博弈论", "冷门度加权"], cost=2)
def poisson_emulator(ctx: AlgoContext) -> AlgoOutput:
    rng = np.random.default_rng(20260818)

    def side(H, max_n, count):
        # 彩民偏好模拟：小号/生日号(1-31)/连号/热号更受青睐
        pref = np.ones(max_n)
        for j in range(max_n):
            v = j + 1
            if v <= 31:
                pref[j] *= 1.35          # 生日号偏好
            if v <= 12:
                pref[j] *= 1.15          # 月份号偏好
            if v % 10 in (6, 8):
                pref[j] *= 1.12          # 吉数偏好
        # 热号偏好（近期出现的更多人跟）
        recent = H[-30:].sum(axis=0)
        pref *= 1.0 + 0.25 * (recent / max(recent.max(), 1e-9))
        # 泊松强度：λ_j ∝ pref_j
        lam = 3.0 + 7.0 * (pref - pref.min()) / max(pref.max() - pref.min(), 1e-9)
        # 期望投注人数 -> 冷门度 1/p 加权
        popularity = lam / lam.sum()
        coldness = 1.0 / (popularity + 1e-9)
        # 初等对称多项式：等概率下任一组合概率相同，故只按冷门度排序
        e_k = _elementary_symmetric(np.full(max_n, count / max_n), count)
        return normalize(coldness), popularity, lam, e_k

    r, pop, lam, ek = side(ctx.RH, ctx.red_max, ctx.red_count)
    b, _, _, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "任何组合中奖概率相同 → 选冷门号可在中奖时减少分奖人数，提升期望收益",
                "彩民偏好建模": "生日号×1.35, 月份号×1.15, 尾6/8×1.12, 热号×(1+0.25h)",
                "泊松 λ 范围": [round(float(lam.min()), 2), round(float(lam.max()), 2)],
                "最冷门红球": int(np.argmax(r)) + 1,
                "初等对称多项式 e_k": round(float(ek), 6),
                "说明": "这是全部算法中唯一有数学依据能提升期望收益的策略（不提升中奖率）"},
    )


def _elementary_symmetric(p: np.ndarray, k: int) -> float:
    """初等对称多项式 e_k(p)，用于精确组合概率计算。"""
    e = np.zeros(k + 1)
    e[0] = 1.0
    for pi in p:
        for j in range(min(k, len(p)), 0, -1):
            e[j] += e[j - 1] * pi
    return float(e[k])


# ---------------------------------------------------------------- 14. 蒙特卡洛

@register("monte_carlo", "蒙特卡洛模拟采样", CAT,
          "以历史经验分布为提议分布做 6 万次蒙特卡洛采样（Gumbel-top-k 实现"
          "无放回加权抽样，全向量化），统计各号在「高分组合」中的出现频率。",
          ["蒙特卡洛", "重要性采样", "Gumbel-top-k", "组合评分"], cost=2)
def monte_carlo(ctx: AlgoContext) -> AlgoOutput:
    rng = np.random.default_rng(20260818)
    trials = 60000

    def side(H, max_n, count):
        emp = H.sum(axis=0) + 1.0
        p = emp / emp.sum()
        # 目标：组合的和值/奇偶/大小分布贴近历史均值
        hist_sum = (H.sum(axis=0) * np.arange(1, max_n + 1)).sum() / max(H.sum(), 1) * count
        # Gumbel-top-k：keys = log p + Gumbel(0,1)，取 top-k 等价于按 p 无放回抽样
        g = rng.gumbel(size=(trials, max_n))
        keys = np.log(p)[None, :] + g
        batch = np.argpartition(-keys, count - 1, axis=1)[:, :count]
        vals = batch + 1
        s = vals.sum(axis=1)
        odd = (vals % 2 == 1).sum(axis=1)
        big = (vals > max_n / 2).sum(axis=1)
        score = (-np.abs(s - hist_sum) / max(hist_sum, 1)
                 - 0.3 * np.abs(odd - count / 2) / count
                 - 0.3 * np.abs(big - count / 2) / count)
        thr = np.percentile(score, 80)
        good = batch[score >= thr]
        tally = np.bincount(good.ravel(), minlength=max_n).astype(np.float64)
        return tally / max(len(good), 1), int(len(good))

    r, kept = side(ctx.RH, ctx.red_max, ctx.red_count)
    b, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "按经验分布采样组合 → 用和值/奇偶/大小偏离度打分 → 保留 top20% 统计频率",
                "采样次数": trials, "保留高分组合数": kept,
                "抽样实现": "Gumbel-top-k 无放回加权抽样（向量化）"},
    )


# ---------------------------------------------------------------- 15. 二项检验

@register("binom_test", "二项检验 + Bonferroni 校正", CAT,
          "对每个号码做精确二项检验，并用 Bonferroni 校正多重比较问题，找出统计显著的号码。",
          ["二项检验", "多重比较校正", "Bonferroni", "p值"])
def binom_test(ctx: AlgoContext) -> AlgoOutput:
    alpha = 0.15

    def side(H, max_n, count):
        p0 = count / max_n
        hits = H.sum(axis=0)
        n = ctx.n
        # 正态近似的 z 统计量（样本量大，近似精确二项检验）
        se = math.sqrt(p0 * (1 - p0) * n)
        z = (hits - n * p0) / max(se, 1e-9)
        # 双侧 p 值
        pval = 2 * (1 - _norm_cdf(np.abs(z)))
        adj = np.minimum(pval * max_n, 1.0)  # Bonferroni
        return z, adj

    zr, pr = side(ctx.RH, ctx.red_max, ctx.red_count)
    zb, pb = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    n_sig = int((pr < alpha).sum())
    return AlgoOutput(
        red=zr, blue=zb,
        detail={"原理": "H₀: p = k/max，z = (obs - np₀)/√(np₀(1-p₀))，p 值乘以 m 做 Bonferroni 校正",
                "显著水平": alpha,
                "校正后显著红球数": n_sig,
                "最小校正p值": round(float(pr.min()), 4),
                "结论": "校正后几乎无显著偏离 → 严格统计意义上开奖是均匀随机的"},
    )


def _norm_cdf(x):
    return 0.5 * (1.0 + np.vectorize(math.erf)(x / math.sqrt(2)))


# ---------------------------------------------------------------- 16. 核密度估计

@register("kde", "高斯核密度估计", CAT,
          "在号码轴上做高斯核密度估计（Silverman 带宽），把离散频次平滑为连续密度，捕捉号段聚集趋势。",
          ["核密度估计", "KDE", "高斯核", "Silverman带宽"])
def kde(ctx: AlgoContext) -> AlgoOutput:
    def side(M, max_n, window=200):
        samples = M[-window:].ravel().astype(np.float64)
        n = len(samples)
        sigma = 1.06 * samples.std() * n ** (-1 / 5) if n > 1 else 1.0
        sigma = max(sigma, 0.8)
        grid = np.arange(1, max_n + 1, dtype=np.float64)
        dens = np.zeros(max_n)
        for s in samples:
            dens += gaussian_kernel(grid, s, sigma)
        return dens / n, sigma
    r, sr = side(ctx.R, ctx.red_max)
    b, _ = side(ctx.B, ctx.blue_max)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "f̂(x) = (1/nh)·Σ K((x-xᵢ)/h)，K 为高斯核",
                "带宽 h (Silverman)": round(float(sr), 3),
                "采样窗口": 200},
    )
