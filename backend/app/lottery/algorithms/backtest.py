"""滚动回测框架：用历史真实开奖评估每个算法的命中表现。

方法
----
对第 c 期做「留一预测」：只把 draws[:c] 喂给算法（严格避免未来信息泄漏），
取算法打分的 top-k 作为投注号码，与 draws[c] 的真实开奖对比数命中。
在最近 folds 期上滚动重复，汇总命中数并与随机期望 k²/m 比较，
得到 lift = 实际命中 / 随机期望。

统计口径（2026-11 重构）
-----------------------
旧的 ``folds=5`` 只用最近 5 期评估 85 个算法，榜首 lift 在纯噪声下中位数就有
1.83（双色球）/ 2.24（大乐透），排行榜等于抽样噪声的排序。现在：

- 默认 **folds=200**（服务端约 3s/折，单彩种约 10 分钟）；
- 每个算法额外输出 ``red_ci`` / ``blue_ci``（lift 的 95% 置信区间）、
  ``red_p`` / ``blue_p``（单侧 p 值：真实无预测力时观察到该 lift 及以上的概率）、
  ``passes_fdr``（Benjamini-Hochberg 多重比较校正后是否仍显著）；
- 同一批折里并行跑 ``NULL_TICKETS`` 组**真随机**号码作为零假设基线，
  输出 ``null_red_lift`` / ``null_blue_lift`` 分布，供前端画箱线图对照。

⚠️ 结论提前说：在足够长的回测上，所有算法的 lift 都会回归到 1.0 附近。
彩票是独立同分布随机过程，这个框架的价值在于**证伪**，而不是选出「神算法」。
"""
from __future__ import annotations

import math
import time

import numpy as np

from app.lottery.algorithms.base import (
    CATEGORIES,
    REGISTRY,
    AlgoContext,
    pick_top,
    safe_run,
)
from app.lottery.services import results_store

# 进程级缓存（内存 TTL 短，主要靠 sqlite 持久缓存）
_CACHE: dict[tuple, tuple[float, dict]] = {}
_TTL = 300.0

#: 零假设基线：每折额外抽这么多组真随机号码，组成「无预测力时的 lift 分布」
NULL_TICKETS = 200


def sub_context(ctx: AlgoContext, cut: int) -> AlgoContext:
    """构造只包含前 cut 期数据的子上下文（用于无泄漏回测）。"""
    return AlgoContext(ctx.lottery, ctx.all_draws[:cut], ctx.meta)


def _hyper_var(pool: int, winners: int, picks: int) -> float:
    """超几何分布方差：单张票「命中个数」的方差。

    命中数 ~ Hypergeom(总体=pool, 成功=winners, 抽取=picks)，
    均值 = picks*winners/pool（正是 lift 的分母）。
    """
    p = winners / pool
    if pool <= 1:
        return 0.0
    return picks * p * (1.0 - p) * (pool - picks) / (pool - 1)


def _normal_sf(z: float) -> float:
    """标准正态上尾概率 P(Z >= z)，用 erfc 避免依赖 scipy。"""
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def _bh_reject(pvals: list[float], alpha: float = 0.05) -> list[bool]:
    """Benjamini-Hochberg 多重比较校正，返回每个假设是否可拒绝。

    85 个算法同时检验同一批数据，不做校正时纯随机也会有 ~4 个「显著」。
    """
    n = len(pvals)
    if n == 0:
        return []
    order = sorted(range(n), key=lambda i: pvals[i])
    passed = [False] * n
    k_max = -1
    for rank, idx in enumerate(order, start=1):
        if pvals[idx] <= alpha * rank / n:
            k_max = rank
    for rank, idx in enumerate(order, start=1):
        if rank <= k_max:
            passed[idx] = True
    return passed


def evaluate(
    ctx: AlgoContext,
    ids: list[str] | None = None,
    folds: int = 5,
    max_cost: int = 2,
    step: int = 1,
    allow_compute: bool = False,
) -> dict | None:
    """滚动回测。返回 {algo_id: {...统计...}} + 元信息。

    结果缓存在 sqlite（backtest_cache 表），按 (lottery, folds, max_cost)
    存储并以 issue_base 作失效依据——数据更新后自动重算。

    allow_compute=False（默认，只读）：缓存未命中直接返回 None，绝不触发计算。
    所有计算必须通过「运行全部」入口（runner / 每日定时脚本）显式触发，
    只读接口（GET /backtest 等）一律只消费缓存。
    """
    issue_base = ctx.all_draws[-1]["issue"] if ctx.all_draws else ""
    if ids is None:
        cached = results_store.backtest_get(ctx.lottery, folds, max_cost, issue_base)
        if cached is not None:
            return cached
    key = (ctx.lottery, len(ctx.all_draws), folds, max_cost, step, tuple(ids or []))
    now = time.time()
    if key in _CACHE and now - _CACHE[key][0] < _TTL:
        result = _CACHE[key][1]
        # 内存命中时也回写 sqlite，防止 sqlite 被删后不再持久化
        if ids is None:
            try:
                results_store.backtest_put(ctx.lottery, folds, max_cost, issue_base, result)
            except Exception:  # noqa: BLE001
                pass
        return result

    # 只读模式（默认）：缓存未命中不计算，直接返回 None（调用方 503/提示等待）
    if not allow_compute:
        return None

    # 计算前抢占互斥锁：别人正在算同一份回测则返回 None（由调用方决定等待/503）
    if ids is None:
        try:
            if not results_store.backtest_claim(ctx.lottery, folds, max_cost):
                return None
        except Exception:  # noqa: BLE001
            pass  # 锁不可用时退化为直接计算（不阻塞）

    try:
        return _compute(ctx, ids, folds, max_cost, step, key, now, issue_base)
    finally:
        # 释放锁（正常/异常路径都释放；锁未持有或已过期也无害）
        if ids is None:
            try:
                results_store.backtest_release(ctx.lottery, folds, max_cost)
            except Exception:  # noqa: BLE001
                pass


def _compute(
    ctx: AlgoContext,
    ids: list[str] | None,
    folds: int,
    max_cost: int,
    step: int,
    key: tuple,
    now: float,
    issue_base: str,
) -> dict:
    """实际滚动回测计算（evaluate 已抢锁，此处不再查缓存）。"""
    pool = [m for m in REGISTRY.values()
            if (ids is None or m.id in ids)
            and m.category != "ensemble"
            and m.cost <= max_cost]
    n_all = len(ctx.all_draws)
    cuts = [n_all - 1 - i * step for i in range(folds)]
    cuts = [c for c in cuts if c >= 200]

    rk, bk = ctx.red_count, ctx.blue_count
    rm, bm = ctx.red_max, ctx.blue_max
    stats: dict[str, dict] = {
        m.id: {"id": m.id, "name": m.name, "category": m.category,
               "category_name": CATEGORIES.get(m.category, {}).get("name", m.category),
               "red_hits": 0, "blue_hits": 0, "both": 0, "folds": 0,
               "elapsed_ms": 0.0}
        for m in pool
    }

    # 零假设基线累计（每折 × NULL_TICKETS 组真随机号码）
    null_red_hits = 0
    null_blue_hits = 0

    for c in cuts:
        sub = sub_context(ctx, c)
        actual = ctx.all_draws[c]
        ar = set(int(v) for v in actual["red"])
        ab = set(int(v) for v in actual["blue"])
        for m in pool:
            t0 = time.perf_counter()
            out = safe_run(m, sub)
            red = pick_top(out.red, rk, rm, tiebreak=c)
            blue = pick_top(out.blue, bk, bm, tiebreak=c + 999)
            hr = len(ar & set(red))
            hb = len(ab & set(blue))
            s = stats[m.id]
            s["red_hits"] += hr
            s["blue_hits"] += hb
            s["both"] += 1 if (hr and hb) else 0
            s["folds"] += 1
            s["elapsed_ms"] += (time.perf_counter() - t0) * 1000

        # ---------- 零假设基线：同一折里抽 NULL_TICKETS 组真随机号码 ----------
        rng = np.random.default_rng(abs(c) + 20260101)
        nh_r = nh_b = 0
        for _ in range(NULL_TICKETS):
            rr = rng.choice(rm, rk, replace=False) + 1
            bb = rng.choice(bm, bk, replace=False) + 1
            nh_r += len(ar & set(int(x) for x in rr))
            nh_b += len(ab & set(int(x) for x in bb))
        null_red_hits += nh_r
        null_blue_hits += nh_b

    exp_r = rk * rk / rm
    exp_b = bk * bk / bm
    var_r = _hyper_var(rm, rk, rk)
    var_b = _hyper_var(bm, bk, bk)

    for s in stats.values():
        f = max(s["folds"], 1)
        s["red_avg"] = round(s["red_hits"] / f, 3)
        s["blue_avg"] = round(s["blue_hits"] / f, 3)
        s["red_expected"] = round(exp_r, 3)
        s["blue_expected"] = round(exp_b, 3)
        s["red_lift"] = round(s["red_hits"] / (f * exp_r), 3) if exp_r else 0.0
        s["blue_lift"] = round(s["blue_hits"] / (f * exp_b), 3) if exp_b else 0.0
        s["score"] = round(0.75 * s["red_lift"] + 0.25 * s["blue_lift"], 4)
        s["elapsed_ms"] = round(s["elapsed_ms"] / f, 1)

        # ---- 95% 置信区间 + 单侧 p 值（H0: 真实 lift = 1，即算法无预测力）----
        sd_r = math.sqrt(var_r / f) if var_r > 0 else 0.0
        sd_b = math.sqrt(var_b / f) if var_b > 0 else 0.0
        if sd_r > 1e-12:
            lo, hi = s["red_avg"] - 1.96 * sd_r, s["red_avg"] + 1.96 * sd_r
            s["red_ci"] = [round(lo / exp_r, 3), round(hi / exp_r, 3)]
            z = (s["red_avg"] - exp_r) / sd_r
            s["red_p"] = round(_normal_sf(z), 4)
        else:
            s["red_ci"] = [1.0, 1.0]
            s["red_p"] = 1.0
        if sd_b > 1e-12:
            lo, hi = s["blue_avg"] - 1.96 * sd_b, s["blue_avg"] + 1.96 * sd_b
            s["blue_ci"] = [round(lo / exp_b, 3), round(hi / exp_b, 3)]
            z = (s["blue_avg"] - exp_b) / sd_b
            s["blue_p"] = round(_normal_sf(z), 4)
        else:
            s["blue_ci"] = [1.0, 1.0]
            s["blue_p"] = 1.0

    # ---- 多重比较校正：85 个算法同时检验，不校正必然出假阳性 ----
    ordered = list(stats.values())
    for s, ok in zip(ordered, _bh_reject([s["red_p"] for s in ordered])):
        s["passes_fdr"] = bool(ok)

    result = {
        "lottery": ctx.lottery,
        "folds": len(cuts),
        "issues": [str(ctx.all_draws[c].get("issue", c)) for c in cuts],
        "red_expected_per_draw": round(exp_r, 3),
        "blue_expected_per_draw": round(exp_b, 3),
        "algos": sorted(stats.values(), key=lambda s: -s["score"]),
        # 零假设基线：如果算法没有任何预测力，随机号码会打出的 lift 中位数
        "null_red_lift": round(null_red_hits / max(len(cuts) * NULL_TICKETS, 1) / exp_r, 3),
        "null_blue_lift": round(null_blue_hits / max(len(cuts) * NULL_TICKETS, 1) / exp_b, 3),
        "null_tickets_per_fold": NULL_TICKETS,
        "passes_fdr_count": sum(1 for s in stats.values() if s["passes_fdr"]),
        "note": "lift = 实际命中 / 随机期望；95%CI 跨 1.0 即与随机无差别；"
                "passes_fdr=False 表示经多重比较校正后仍无法排除「纯噪声」",
    }
    _CACHE[key] = (now, result)
    if ids is None:
        try:
            results_store.backtest_put(ctx.lottery, folds, max_cost, issue_base, result)
        except Exception:  # noqa: BLE001
            pass  # 缓存写失败不影响主流程
    return result


def meta_weights(ctx: AlgoContext, folds: int = 4, max_cost: int = 1) -> dict[str, float]:
    """由回测 lift 生成元学习权重（softmax，温度 0.25，仅取 lift>0 者）。"""
    res = evaluate(ctx, folds=folds, max_cost=max_cost)
    if res is None:
        return {}
    ids = [a["id"] for a in res["algos"]]
    lifts = np.array([a["score"] for a in res["algos"]], dtype=np.float64)
    if len(ids) == 0:
        return {}
    z = (lifts - lifts.mean()) / (lifts.std() + 1e-9)
    w = np.exp(z / 0.25)
    w = w / w.sum()
    return {i: float(v) for i, v in zip(ids, w)}
