"""算法引擎包：统一注册、上下文缓存、批量执行与融合。

用法::

    from app.algorithms import engine_context, catalog, run_one, run_batch

    ctx = engine_context("ssq", draws, meta)
    print(catalog()["total"])
    print(run_one(ctx, "meihua"))
"""
from __future__ import annotations

import time

import numpy as np

from app.algorithms.base import (  # noqa: F401
    CATEGORIES,
    REGISTRY,
    AlgoContext,
    AlgoMeta,
    AlgoOutput,
    normalize,
    pick_top,
    safe_run,
    scores_to_picks,
)

# 导入各算法模块以触发注册（顺序即前端分类展示顺序）
from app.algorithms import statistical  # noqa: F401,E402
from app.algorithms import timeseries  # noqa: F401,E402
from app.algorithms import similarity  # noqa: F401,E402
from app.algorithms import ml  # noqa: F401,E402
from app.algorithms import deeplearning  # noqa: F401,E402
from app.algorithms import quantum  # noqa: F401,E402
from app.algorithms import symbolic  # noqa: F401,E402
from app.algorithms import physics  # noqa: F401,E402
from app.algorithms import seeds  # noqa: F401,E402
from app.algorithms import metaphysics  # noqa: F401,E402
from app.algorithms import signal_img  # noqa: F401,E402
from app.algorithms import ensemble  # noqa: F401,E402
from app.algorithms.backtest import evaluate as backtest_evaluate  # noqa: F401,E402

# ------------------------------------------------------------ 上下文缓存

_CTX_CACHE: dict[tuple, tuple[float, AlgoContext]] = {}
_CTX_TTL = 1800.0


def engine_context(lottery: str, draws: list[dict], meta: dict) -> AlgoContext:
    """获取（并缓存）算法上下文。同一份数据只做一次特征预计算。"""
    key = (lottery, len(draws), draws[-1]["issue"] if draws else "")
    now = time.time()
    hit = _CTX_CACHE.get(key)
    if hit and now - hit[0] < _CTX_TTL:
        return hit[1]
    ctx = AlgoContext(lottery, draws, meta)
    _CTX_CACHE.clear()          # 只保留最新一份，控制内存
    _CTX_CACHE[key] = (now, ctx)
    return ctx


# ------------------------------------------------------------ 目录


def catalog() -> dict:
    """算法目录：分类 + 每个算法的元信息（驱动前端「算法广场」）。"""
    groups: dict[str, list] = {}
    for m in REGISTRY.values():
        groups.setdefault(m.category, []).append({
            "id": m.id,
            "name": m.name,
            "desc": m.desc,
            "tags": m.tags,
            "cost": m.cost,
            "speed": {1: "极快", 2: "快", 3: "中", 4: "慢"}[m.cost],
        })
    cats = []
    for key, info in CATEGORIES.items():
        items = groups.get(key, [])
        if not items:
            continue
        cats.append({**info, "count": len(items), "algorithms": items})
    return {
        "total": len(REGISTRY),
        "categories": cats,
        "disclaimer": "彩票为独立随机事件，所有算法均无预测能力，输出仅供娱乐与技术演示。",
    }


def algo_ids(category: str | None = None, max_cost: int | None = None) -> list[str]:
    return [m.id for m in REGISTRY.values()
            if (category is None or m.category == category)
            and (max_cost is None or m.cost <= max_cost)]


# ------------------------------------------------------------ 执行


def _packet(m: AlgoMeta, ctx: AlgoContext, out: AlgoOutput, ms: float) -> dict:
    picks = scores_to_picks(out, ctx, tiebreak=ctx.n)
    return {
        "id": m.id,
        "name": m.name,
        "category": m.category,
        "category_name": CATEGORIES.get(m.category, {}).get("name", m.category),
        "desc": m.desc,
        "tags": m.tags,
        "cost": m.cost,
        "elapsed_ms": round(ms, 1),
        "issue_base": ctx.draws[-1]["issue"],
        **picks,
    }


def run_one(ctx: AlgoContext, algo_id: str) -> dict:
    if algo_id not in REGISTRY:
        raise KeyError(algo_id)
    m = REGISTRY[algo_id]
    t0 = time.perf_counter()
    out = safe_run(m, ctx)
    return _packet(m, ctx, out, (time.perf_counter() - t0) * 1000)


def run_batch(
    ctx: AlgoContext,
    ids: list[str] | None = None,
    category: str | None = None,
    max_cost: int | None = None,
) -> list[dict]:
    if ids:
        pool = [REGISTRY[i] for i in ids if i in REGISTRY]
    else:
        pool = [REGISTRY[i] for i in algo_ids(category, max_cost)]
    res = []
    for m in pool:
        t0 = time.perf_counter()
        out = safe_run(m, ctx)
        res.append(_packet(m, ctx, out, (time.perf_counter() - t0) * 1000))
    return res


def combine(
    ctx: AlgoContext,
    ids: list[str] | None = None,
    max_cost: int = 2,
    weights: dict[str, float] | None = None,
) -> dict:
    """多算法加权融合（默认等权，排除集成类算法避免重复计票）。"""
    pool = ([REGISTRY[i] for i in ids if i in REGISTRY] if ids
            else [m for m in REGISTRY.values()
                  if m.category != "ensemble" and m.cost <= max_cost])
    R = np.zeros(ctx.red_max)
    B = np.zeros(ctx.blue_max)
    used, tot = [], 0.0
    for m in pool:
        out = safe_run(m, ctx)
        w = float((weights or {}).get(m.id, 1.0))
        R += w * normalize(out.red)
        B += w * normalize(out.blue)
        tot += w
        used.append(m.id)
    if tot > 1e-9:
        R /= tot
        B /= tot
    picks = scores_to_picks(AlgoOutput(red=R, blue=B, detail={}), ctx, tiebreak=ctx.n)
    return {
        "algorithms": used,
        "count": len(used),
        "weighted": bool(weights),
        **picks,
    }


__all__ = [
    "CATEGORIES", "REGISTRY", "AlgoContext", "AlgoOutput",
    "engine_context", "catalog", "algo_ids", "run_one", "run_batch",
    "combine", "backtest_evaluate",
]
