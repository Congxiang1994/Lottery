"""滚动回测框架：用历史真实开奖评估每个算法的命中表现。

方法
----
对第 c 期做「留一预测」：只把 draws[:c] 喂给算法（严格避免未来信息泄漏），
取算法打分的 top-k 作为投注号码，与 draws[c] 的真实开奖对比数命中。
在最近 folds 期上滚动重复，汇总命中数并与随机期望 k²/m 比较，
得到 lift = 实际命中 / 随机期望。

⚠️ 结论提前说：在足够长的回测上，所有算法的 lift 都会回归到 1.0 附近。
彩票是独立同分布随机过程，这个框架的价值在于**证伪**，而不是选出「神算法」。
"""
from __future__ import annotations

import time

import numpy as np

from app.lottery.algorithms.base import (
    REGISTRY,
    AlgoContext,
    pick_top,
    safe_run,
)
from app.lottery.services import results_store

# 进程级缓存（内存 TTL 短，主要靠 sqlite 持久缓存）
_CACHE: dict[tuple, tuple[float, dict]] = {}
_TTL = 300.0


def sub_context(ctx: AlgoContext, cut: int) -> AlgoContext:
    """构造只包含前 cut 期数据的子上下文（用于无泄漏回测）。"""
    return AlgoContext(ctx.lottery, ctx.all_draws[:cut], ctx.meta)


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
               "red_hits": 0, "blue_hits": 0, "both": 0, "folds": 0,
               "elapsed_ms": 0.0}
        for m in pool
    }

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

    exp_r = rk * rk / rm
    exp_b = bk * bk / bm
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

    result = {
        "lottery": ctx.lottery,
        "folds": len(cuts),
        "issues": [str(ctx.all_draws[c].get("issue", c)) for c in cuts],
        "red_expected_per_draw": round(exp_r, 3),
        "blue_expected_per_draw": round(exp_b, 3),
        "algos": sorted(stats.values(), key=lambda s: -s["score"]),
        "note": "lift = 实际命中 / 随机期望；长期回归 1.0 才是正常现象",
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
