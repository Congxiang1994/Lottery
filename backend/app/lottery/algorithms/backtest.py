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
    digit_seed,
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


def _block_bootstrap_se(series: np.ndarray, block: int, n_boot: int = 400,
                        seed: int = 0) -> float:
    """移动块自助法估计"折叠均值"的标准误。

    相邻折用高度重叠的历史窗口预测，折间命中数强相关；直接用
    sqrt(var/f) 会把误差低估 sqrt(f) 倍，制造大量假显著。块自助法
    按连续 block 个折整块重采样，保留序列相关性，得到保守得多的 SE。
    """
    x = np.asarray(series, dtype=np.float64)
    n = len(x)
    if n < 2:
        return 0.0
    block = max(1, min(int(block), n))
    rng = np.random.default_rng(abs(int(seed)) % (2**31 - 1))
    n_blocks = math.ceil(n / block)
    offs = np.arange(block)[None, :]
    means = np.empty(n_boot, dtype=np.float64)
    for b in range(n_boot):
        starts = rng.integers(0, n - block + 1, size=n_blocks)
        idx = (starts[:, None] + offs).ravel()[:n]
        means[b] = x[idx].mean()
    return float(means.std(ddof=1))


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
    # step != 1 的结果（按间隔抽样折）与 step=1 不共用口径，绝不能读写 sqlite
    # 持久缓存，否则不同 step 会互相污染。内存键已含 step，保持原样。
    persist = (step == 1)
    if ids is None and persist:
        cached = results_store.backtest_get(ctx.lottery, folds, max_cost, issue_base)
        if cached is not None:
            return cached
    key = (ctx.lottery, len(ctx.all_draws), folds, max_cost, step, tuple(ids or []))
    now = time.time()
    if key in _CACHE and now - _CACHE[key][0] < _TTL:
        result = _CACHE[key][1]
        # 内存命中时也回写 sqlite，防止 sqlite 被删后不再持久化（step=1 才写）
        if ids is None and persist:
            try:
                results_store.backtest_put(ctx.lottery, folds, max_cost, issue_base, result)
            except Exception:  # noqa: BLE001
                pass
        return result

    # 只读模式（默认）：缓存未命中不计算，直接返回 None（调用方 503/提示等待）
    if not allow_compute:
        return None

    # 计算前抢占互斥锁：别人正在算同一份回测则返回 None（由调用方决定等待/503）
    if ids is None and persist:
        try:
            if not results_store.backtest_claim(ctx.lottery, folds, max_cost):
                return None
        except Exception:  # noqa: BLE001
            pass  # 锁不可用时退化为直接计算（不阻塞）

    try:
        return _compute(ctx, ids, folds, max_cost, step, key, now, issue_base, persist)
    finally:
        # 释放锁（正常/异常路径都释放；锁未持有或已过期也无害）
        if ids is None and persist:
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
    persist: bool,
) -> dict:
    """实际滚动回测计算（evaluate 已抢锁，此处不再查缓存）。"""
    pool = [m for m in REGISTRY.values()
            if (ids is None or m.id in ids)
            and m.category != "ensemble"
            and m.cost <= max_cost]
    n_all = len(ctx.all_draws)
    cuts = [n_all - 1 - i * step for i in range(folds)]
    cuts = [c for c in cuts if c >= 200]
    # S-3：不足 3 个有效切点时不产出/不落库。否则会生成 folds=0 但 algos 齐全的
    # 假结果，下游把"从未评估"误读成"评估通过"。
    if len(cuts) < 3:
        raise ValueError(
            f"有效回测折数不足：请求 folds={folds}, step={step}，"
            f"数据共 {n_all} 期，过滤 c>=200 后仅剩 {len(cuts)} 个切点（至少需 3 个）")

    rk, bk = ctx.red_count, ctx.blue_count
    rm, bm = ctx.red_max, ctx.blue_max
    stats: dict[str, dict] = {
        m.id: {"id": m.id, "name": m.name, "category": m.category,
               "category_name": CATEGORIES.get(m.category, {}).get("name", m.category),
               "red_hits": 0, "blue_hits": 0, "both": 0, "folds": 0,
               "elapsed_ms": 0.0}
        for m in pool
    }
    # 每算法逐折命中数（用于块自助法估计相关折下的标准误）
    hit_series: dict[str, dict[str, list[int]]] = {
        m.id: {"red": [], "blue": []} for m in pool
    }

    # 零假设基线累计（每折 × NULL_TICKETS 组真随机号码）
    null_red_hits = 0
    null_blue_hits = 0
    # 每折一份 lift 分布（块自助法的经验依据），供前端画箱线图/校验离散度
    null_red_lifts: list[float] = []
    null_blue_lifts: list[float] = []

    for fold_i, c in enumerate(cuts):
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
            hit_series[m.id]["red"].append(hr)
            hit_series[m.id]["blue"].append(hb)

        # ---------- 零假设基线：同一折里抽 NULL_TICKETS 组真随机号码 ----------
        # 种子用折索引 i（而非绝对 cut），避免不同数据集/不同 step 下种子随 cut 漂移
        rng = np.random.default_rng(fold_i + 20260101)
        nh_r = nh_b = 0
        fold_tickets = NULL_TICKETS
        fold_red_hits = np.zeros(fold_tickets, dtype=np.int32)
        fold_blue_hits = np.zeros(fold_tickets, dtype=np.int32)
        for t_i in range(fold_tickets):
            rr = rng.choice(rm, rk, replace=False) + 1
            bb = rng.choice(bm, bk, replace=False) + 1
            hr = len(ar & set(int(x) for x in rr))
            hb = len(ab & set(int(x) for x in bb))
            fold_red_hits[t_i] = hr
            fold_blue_hits[t_i] = hb
            nh_r += hr
            nh_b += hb
        null_red_hits += nh_r
        null_blue_hits += nh_b
        # 每折命中数的均值 -> 归一化成 lift 后入分布
        exp_r_fold = rk * rk / rm
        exp_b_fold = bk * bk / bm
        null_red_lifts.append(round(float(fold_red_hits.mean() / exp_r_fold), 4) if exp_r_fold else 0.0)
        null_blue_lifts.append(round(float(fold_blue_hits.mean() / exp_b_fold), 4) if exp_b_fold else 0.0)

    exp_r = rk * rk / rm
    exp_b = bk * bk / bm
    var_r = _hyper_var(rm, rk, rk)
    var_b = _hyper_var(bm, bk, bk)

    # 块大小：相邻折窗口重叠比例。step=1 时相邻折差 1 期、窗口 200 期 → 高度重叠，
    # 取 min(10, 折数) 作为块长，保留折间相关性；再用观测折内方差做下限守卫。
    block = max(2, min(10, len(cuts) // 2))
    for aid, s in stats.items():
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
        # M-5：不再用 sqrt(var/f)（折间高度相关时低估约 sqrt(f) 倍），
        # 改以移动块自助法估计均值的标准误，并取"解析下限"的较大者做保守守卫。
        seed = digit_seed(aid, "red")
        for side, exp, avg_key, ci_key, p_key in (
            ("red", exp_r, "red_avg", "red_ci", "red_p"),
            ("blue", exp_b, "blue_avg", "blue_ci", "blue_p"),
        ):
            series = np.asarray(hit_series[aid][side], dtype=np.float64)
            sd_boot = _block_bootstrap_se(series, block, seed=seed + (0 if side == "red" else 1))
            sd_floor = math.sqrt((var_r if side == "red" else var_b) / f)
            se = max(sd_boot, sd_floor)
            if se > 1e-12 and exp > 0:
                lo, hi = s[avg_key] - 1.96 * se, s[avg_key] + 1.96 * se
                s[ci_key] = [round(lo / exp, 3), round(hi / exp, 3)]
                z = (s[avg_key] - exp) / se
                s[p_key] = round(_normal_sf(z), 4)
            else:
                s[ci_key] = [1.0, 1.0]
                s[p_key] = 1.0

    # ---- 多重比较校正：红 + 蓝两侧一起做 BH（取每算法两侧 p 值的较小者）----
    ordered = list(stats.values())
    combined_p = [min(s["red_p"], s["blue_p"]) for s in ordered]
    for s, ok in zip(ordered, _bh_reject(combined_p)):
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
        # M-5：补充逐折 lift 分布（而非只有点估计），前端可选用 / 画箱线图
        "null_red_lifts": null_red_lifts,
        "null_blue_lifts": null_blue_lifts,
        "null_tickets_per_fold": NULL_TICKETS,
        "passes_fdr_count": sum(1 for s in stats.values() if s["passes_fdr"]),
        "note": "lift = 实际命中 / 随机期望；95%CI 用移动块自助法（折间相关）；"
                "passes_fdr 对红蓝两侧 p 取较小者统一做 BH 校正；"
                "False 表示经多重比较校正后仍无法排除「纯噪声」",
    }
    _CACHE[key] = (now, result)
    if ids is None and persist:
        try:
            results_store.backtest_put(ctx.lottery, folds, max_cost, issue_base, result)
        except Exception:  # noqa: BLE001
            pass  # 缓存写失败不影响主流程
    return result


def meta_weights(ctx: AlgoContext, folds: int = 4, max_cost: int = 1) -> dict[str, float]:
    """由回测 lift 生成元学习权重（softmax，温度 0.25）。

    S-2：这里必须显式 allow_compute=True —— 此前沿用 evaluate 的默认只读模式，
    缓存永远缺失 → 永远返回空权重 → meta_stack 静默退化成全 0.5 且 detail 为空。
    元学习堆叠是在线按需计算，属于「显式触发计算」的场景。
    """
    try:
        res = evaluate(ctx, folds=folds, max_cost=max_cost, allow_compute=True)
    except Exception:  # noqa: BLE001
        # 数据不足（例如 S-3 有效折数不够）时降级：返回空权重，由调用方给出明确 error
        return {}
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
