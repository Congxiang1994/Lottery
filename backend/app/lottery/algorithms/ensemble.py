"""集成融合类算法（4 种）。

设计参考：AdvancedVotingStrategy / 多系统投票汇总。

* vote_all        —— 全量算法等权投票
* category_fusion —— 先类内融合再跨类等权（层次融合，避免某类算法数量霸榜）
* borda_rank      —— Borda 计数排序融合（只用序，不受分数尺度影响）
* meta_stack      —— 以滚动回测 lift 做 softmax 加权的元学习堆叠
"""
from __future__ import annotations

import numpy as np

from app.lottery.algorithms.backtest import meta_weights
from app.lottery.algorithms.base import (
    CATEGORIES,
    REGISTRY,
    AlgoContext,
    AlgoOutput,
    normalize,
    register,
    safe_run,
)

CAT = "ensemble"
BASE_COST = 2  # 参与融合的基学习器成本上限


def _run_pool(ctx: AlgoContext, max_cost: int = BASE_COST):
    """运行全部非集成类算法并缓存（同一请求内多个集成算法共享结果）。"""
    key = f"pool_{max_cost}"

    def build():
        res = {}
        for m in REGISTRY.values():
            if m.category == CAT or m.cost > max_cost:
                continue
            out = safe_run(m, ctx)
            res[m.id] = (m, normalize(out.red), normalize(out.blue),
                         "error" not in (out.detail or {}))
        return res

    return ctx.cache(key, build)


# ---------------------------------------------------------------- 1. 全量投票

@register("vote_all", "全量算法等权投票", CAT,
          "运行全部快速算法（成本 ≤2），各自打分归一化到 [0,1] 后等权平均，"
          "得到跨范式的共识打分；共识越高说明多种独立方法同时看好该号。",
          ["集成学习", "等权投票", "共识打分", "跨范式融合"], cost=4)
def vote_all(ctx: AlgoContext) -> AlgoOutput:
    pool = _run_pool(ctx)
    if not pool:
        return AlgoOutput(red=np.full(ctx.red_max, 0.5),
                          blue=np.full(ctx.blue_max, 0.5), detail={})
    R = np.mean([v[1] for v in pool.values()], axis=0)
    B = np.mean([v[2] for v in pool.values()], axis=0)
    ok = sum(1 for v in pool.values() if v[3])
    # 共识强度：各算法对 top-k 号码的一致率
    top = np.argsort(-R)[: ctx.red_count]
    agree = float(np.mean([np.mean(np.isin(np.argsort(-v[1])[: ctx.red_count], top))
                           for v in pool.values()]))
    return AlgoOutput(red=R, blue=B, detail={
        "参与算法数": len(pool),
        "成功执行": ok,
        "参与分类": sorted({v[0].category for v in pool.values()}),
        "共识一致率": f"{agree:.1%}",
        "原理": "score = (1/N)·Σ normalize(scoreᵢ)",
        "成本上限": BASE_COST,
    })


# ---------------------------------------------------------------- 2. 层次融合

@register("category_fusion", "分类层次融合", CAT,
          "先在每个算法分类内部做等权平均，再对 10+ 个分类做等权平均。"
          "避免统计类算法数量多而主导结果，让玄学/量子/物理等小类拥有同等话语权。",
          ["层次融合", "类内平均", "跨类等权", "去数量偏置"], cost=4)
def category_fusion(ctx: AlgoContext) -> AlgoOutput:
    pool = _run_pool(ctx)
    if not pool:
        return AlgoOutput(red=np.full(ctx.red_max, 0.5),
                          blue=np.full(ctx.blue_max, 0.5), detail={})
    groups: dict[str, list] = {}
    for m, r, b, _ok in pool.values():
        groups.setdefault(m.category, []).append((r, b))
    cat_r = {c: np.mean([x[0] for x in v], axis=0) for c, v in groups.items()}
    cat_b = {c: np.mean([x[1] for x in v], axis=0) for c, v in groups.items()}
    R = np.mean(list(cat_r.values()), axis=0)
    B = np.mean(list(cat_b.values()), axis=0)
    # 各分类首选号码，便于前端展示分歧
    picks = {CATEGORIES.get(c, {}).get("name", c):
             sorted(int(i) + 1 for i in np.argsort(-v)[: ctx.red_count])
             for c, v in cat_r.items()}
    return AlgoOutput(red=R, blue=B, detail={
        "参与分类数": len(groups),
        "各类算法数": {CATEGORIES.get(c, {}).get("name", c): len(v)
                       for c, v in groups.items()},
        "各类红球首选": picks,
        "原理": "两级平均：先类内等权，再跨类等权",
    })


# ---------------------------------------------------------------- 3. Borda 计数

@register("borda_rank", "Borda 计数排序融合", CAT,
          "把每个算法的打分转成名次（第 1 名得 m-1 分，末名 0 分）后累加，"
          "只使用序信息、完全不受各算法分数尺度与分布形状影响，"
          "是社会选择理论中满足单调性的经典排序聚合规则。",
          ["Borda计数", "排序聚合", "社会选择理论", "尺度无关"], cost=4)
def borda_rank(ctx: AlgoContext) -> AlgoOutput:
    pool = _run_pool(ctx)
    if not pool:
        return AlgoOutput(red=np.full(ctx.red_max, 0.5),
                          blue=np.full(ctx.blue_max, 0.5), detail={})

    def borda(vecs: list[np.ndarray], m: int) -> np.ndarray:
        acc = np.zeros(m)
        for v in vecs:
            order = np.argsort(-v, kind="stable")
            pts = np.empty(m)
            pts[order] = np.arange(m - 1, -1, -1)
            acc += pts
        return acc

    R = borda([v[1] for v in pool.values()], ctx.red_max)
    B = borda([v[2] for v in pool.values()], ctx.blue_max)
    n = len(pool)
    top = np.argsort(-R)[: ctx.red_count]
    return AlgoOutput(red=R, blue=B, detail={
        "参与算法数": n,
        "满分基准": (ctx.red_max - 1) * n,
        "红球得分": {str(int(i) + 1): int(R[i]) for i in top},
        "原理": "Borda(x) = Σᵢ (m - rankᵢ(x))，仅用序，不用分值",
    })


# ---------------------------------------------------------------- 4. 元学习堆叠

@register("meta_stack", "回测 lift 元学习堆叠", CAT,
          "先用滚动回测算出每个快速算法的 lift（实际命中/随机期望），"
          "再以 softmax(标准化 lift / 0.25) 作为权重做加权融合。"
          "属于 stacking 思路：用历史表现学习基学习器的可信度。",
          ["Stacking", "元学习", "滚动回测", "lift加权", "softmax"], cost=4)
def meta_stack(ctx: AlgoContext) -> AlgoOutput:
    w = meta_weights(ctx, folds=4, max_cost=1)
    pool = _run_pool(ctx, max_cost=1)
    if not pool or not w:
        return AlgoOutput(red=np.full(ctx.red_max, 0.5),
                          blue=np.full(ctx.blue_max, 0.5), detail={})
    R = np.zeros(ctx.red_max)
    B = np.zeros(ctx.blue_max)
    tot = 0.0
    for aid, (m, r, b, _ok) in pool.items():
        wi = w.get(aid, 0.0)
        R += wi * r
        B += wi * b
        tot += wi
    if tot > 1e-9:
        R /= tot
        B /= tot
    ranked = sorted(w.items(), key=lambda kv: -kv[1])[:8]
    return AlgoOutput(red=R, blue=B, detail={
        "基学习器数": len(pool),
        "回测折数": 4,
        "权重 Top8": {REGISTRY[i].name if i in REGISTRY else i: round(v, 4)
                      for i, v in ranked},
        "原理": "w = softmax(z(lift)/0.25)，score = Σ wᵢ·normalize(scoreᵢ)",
        "警告": "回测 lift 在小样本上噪声极大，权重不代表真实预测力",
    })
