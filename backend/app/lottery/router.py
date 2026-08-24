"""彩票 API 路由。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.lottery.algorithms import (
    REGISTRY,
    algo_ids,
    backtest_evaluate,
    catalog,
    combine,
    engine_context,
    run_batch,
    run_one,
)
from app.lottery.config import LOTTERIES, VERIFY_PASSWORD
from app.lottery.services import scraper, stats as stats_svc, predictor
from app.lottery.services import results_store

router = APIRouter(prefix="/api/v1", tags=["lottery"])


def _get(lottery: str) -> dict:
    if lottery not in LOTTERIES:
        raise HTTPException(status_code=404, detail=f"未知彩种: {lottery}")
    data = scraper.load_lottery(lottery)
    if not data or not data.get("draws"):
        raise HTTPException(status_code=503, detail=f"{lottery} 数据未就绪，请先刷新")
    return data


@router.get("/lotteries")
def list_lotteries():
    return [
        {
            "key": k,
            "name": m["name"],
            "org": m["org"],
            "red_label": m["red_label"],
            "blue_label": m["blue_label"],
        }
        for k, m in LOTTERIES.items()
    ]


@router.get("/{lottery}/summary")
def summary(lottery: str):
    data = _get(lottery)
    return stats_svc.summarize(data["draws"], LOTTERIES[lottery])


@router.get("/{lottery}/latest")
def latest(lottery: str):
    data = _get(lottery)
    return data["draws"][-1]


@router.get("/{lottery}/history")
def history(
    lottery: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    data = _get(lottery)
    draws = data["draws"]
    total = len(draws)
    start = max(0, total - page * page_size)
    end = total - (page - 1) * page_size
    return {
        "lottery": lottery,
        "page": page,
        "page_size": page_size,
        "total": total,
        "draws": draws[start:end][::-1],  # 最新在前
    }


@router.get("/{lottery}/stats")
def stats(lottery: str):
    data = _get(lottery)
    return stats_svc.compute_all(data["draws"], LOTTERIES[lottery])


@router.get("/{lottery}/predict")
def predict(lottery: str):
    data = _get(lottery)
    return predictor.predict(lottery, data["draws"], LOTTERIES[lottery])


# ------------------------------------------------------------ 算法引擎


@router.get("/algorithms")
def algorithms_catalog():
    """算法目录：89 个算法 + 12 个分类的元信息，驱动前端「算法广场」。"""
    return catalog()


def _ctx(lottery: str):
    data = _get(lottery)
    return engine_context(lottery, data["draws"], LOTTERIES[lottery])


@router.get("/{lottery}/algorithms")
def algorithms_run(
    lottery: str,
    ids: str | None = Query(None, description="逗号分隔的算法 id，优先级最高"),
    category: str | None = Query(None, description="按分类批量执行"),
    max_cost: int = Query(2, ge=1, le=4, description="成本上限：1极快 2快 3中 4慢"),
):
    """批量执行算法。默认只跑成本 ≤2 的快算法，重算法请显式指定 ids 或 max_cost。"""
    ctx = _ctx(lottery)
    id_list = [s.strip() for s in ids.split(",") if s.strip()] if ids else None
    if id_list:
        unknown = [i for i in id_list if i not in REGISTRY]
        if unknown:
            raise HTTPException(status_code=404, detail=f"未知算法: {unknown}")
    if category and category not in {m.category for m in REGISTRY.values()}:
        raise HTTPException(status_code=404, detail=f"未知分类: {category}")
    results = run_batch(ctx, ids=id_list, category=category, max_cost=max_cost)
    return {
        "lottery": lottery,
        "issue_base": ctx.draws[-1]["issue"],
        "count": len(results),
        "results": results,
    }


@router.get("/{lottery}/algorithms/{algo_id}")
def algorithm_run_one(lottery: str, algo_id: str):
    """执行单个算法，返回推荐号码 + 每号打分 + 算法内部推演细节。"""
    if algo_id not in REGISTRY:
        raise HTTPException(status_code=404, detail=f"未知算法: {algo_id}")
    ctx = _ctx(lottery)
    return {"lottery": lottery, "issue_base": ctx.draws[-1]["issue"],
            **run_one(ctx, algo_id)}


@router.get("/{lottery}/combined")
def algorithms_combined(
    lottery: str,
    max_cost: int = Query(2, ge=1, le=4),
    ids: str | None = Query(None),
):
    """多算法等权融合的共识号码。"""
    ctx = _ctx(lottery)
    id_list = [s.strip() for s in ids.split(",") if s.strip()] if ids else None
    return {"lottery": lottery, "issue_base": ctx.draws[-1]["issue"],
            **combine(ctx, ids=id_list, max_cost=max_cost)}


@router.get("/{lottery}/backtest")
def algorithms_backtest(
    lottery: str,
    folds: int = Query(5, ge=1, le=30, description="回测期数（滚动留一预测）"),
    max_cost: int = Query(1, ge=1, le=4),
):
    """滚动回测排行榜（只读缓存）：lift = 实际命中 / 随机期望，长期应回归 1.0。

    缓存未命中直接 503，绝不触发计算——所有计算必须走「运行全部」入口。
    """
    ctx = _ctx(lottery)
    res = backtest_evaluate(ctx, folds=folds, max_cost=max_cost)
    if res is None:
        raise HTTPException(
            status_code=503,
            detail=f"{LOTTERIES[lottery]['name']} 回测数据未生成：请到「算法广场」"
                   "点击「运行全部」生成（含预测+回测，约 15 分钟），"
                   "或等待每日 0:00 定时任务完成后再刷新")
    return res


@router.get("/{lottery}/algo-ids")
def algorithms_ids(lottery: str, category: str | None = None, max_cost: int | None = None):
    _get(lottery)
    return {"ids": algo_ids(category, max_cost)}


# ------------------------------------------------------------ 定时入库结果


@router.get("/algo-summary")
def algo_summary():
    """每个彩种最近一次定时入库的摘要（run_date、期号、算法数）。"""
    return results_store.summary()


@router.get("/{lottery}/saved-algorithms/latest")
def saved_algorithms_latest(lottery: str):
    """读取 sqlite 中该彩种最新一批的全部算法结果，用于智能推荐页展示。"""
    _get(lottery)
    res = results_store.latest(lottery)
    if not res:
        raise HTTPException(status_code=404,
                            detail=f"{lottery} 暂无入库结果，请等待定时任务完成首次跑批")
    return res


@router.get("/{lottery}/saved-combined")
def saved_combined(lottery: str):
    """对 sqlite 中最新一批的全部算法打分做等权融合（纯缓存，不实时计算）。

    融合方式：red_conf / blue_conf 按算法等权平均 → 取 top-k。
    与算法广场的「批量运行快算法」独立：这里永远消费每日跑批缓存。
    """
    _get(lottery)
    res = results_store.latest(lottery)
    if not res:
        raise HTTPException(status_code=404,
                            detail=f"{lottery} 暂无入库结果，请等待定时任务完成首次跑批")
    import numpy as np
    from app.lottery.algorithms.base import normalize, pick_top
    meta = LOTTERIES[lottery]
    R = np.mean([r["red_conf"] for r in res["results"]], axis=0)
    B = np.mean([r["blue_conf"] for r in res["results"]], axis=0)
    seed = int(res["issue_base"] or 0)
    red = pick_top(R, meta["red_count"], meta["red_max"], tiebreak=seed)
    blue = pick_top(B, meta["blue_count"], meta["blue_max"], tiebreak=seed + 999)
    return {
        "lottery": lottery,
        "run_date": res["run_date"],
        "issue_base": res["issue_base"],
        "count": res["count"],
        "red": red,
        "blue": blue,
        "red_conf": [round(float(v), 4) for v in normalize(R)],
        "blue_conf": [round(float(v), 4) for v in normalize(B)],
        "detail": {
            "原理": "对每日跑批缓存的全部算法打分等权平均（非实时计算）",
            "参与算法数": res["count"],
            "run_date": res["run_date"],
            "issue_base": res["issue_base"],
        },
    }


@router.get("/{lottery}/saved-algorithms/runs")
def saved_algorithms_runs(lottery: str, limit: int = Query(14, ge=1, le=90)):
    """列出该彩种最近 N 天的 run_date。"""
    _get(lottery)
    return {"lottery": lottery, "dates": results_store.runs(lottery, limit)}


@router.get("/{lottery}/saved-algorithms/{run_date}")
def saved_algorithms_by_date(lottery: str, run_date: str):
    """按 run_date 取整批。"""
    _get(lottery)
    res = results_store.by_date(lottery, run_date)
    if not res:
        raise HTTPException(status_code=404, detail=f"无 {run_date} 的入库结果")
    return res


# ------------------------------------------------------------ 全量运行（算法广场 → sqlite 一致性）


@router.post("/verify-password")
def verify_password(payload: dict):
    """校验「运行全部算法」操作密码（后端校验 + 每秒 1 次全局流控）。"""
    password = str(payload.get("password", ""))
    ok, msg, status = results_store.verify_password(password, VERIFY_PASSWORD)
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    return {"ok": True, "message": msg}


@router.post("/run-all")
def run_all_algorithms_all(payload: dict):
    """启动全量运行：顺序跑双色球 + 大乐透（各含预测 + 回测）并写入 sqlite。

    后端强制校验操作密码（与 /verify-password 同一密码，无流控），
    校验通过后由数据库互斥锁防并发。
    """
    from app.lottery.services import runner
    from app.lottery.services.results_store import check_password
    if not check_password(str(payload.get("password", "")), VERIFY_PASSWORD):
        raise HTTPException(status_code=401, detail="密码错误，无法触发运行")
    ok, msg = runner.start_all()
    if not ok:
        raise HTTPException(status_code=409, detail=msg)
    return {"started": True, "message": msg}


@router.get("/run-status")
def run_status_all():
    """查询全量运行进度（两个彩种合并，跨 worker 轮询）。"""
    from app.lottery.services import runner
    return runner.status_all()


@router.post("/{lottery}/run-all")
def run_all_algorithms(lottery: str, payload: dict):
    """启动单彩种全量运行：跑全部 85 个非集成算法并写入 sqlite。

    与每日定时任务同一逻辑；完成后 saved-combined / saved-algorithms/latest
    自动更新。同样需要操作密码。
    """
    _get(lottery)
    from app.lottery.services import runner
    from app.lottery.services.results_store import check_password
    if not check_password(str(payload.get("password", "")), VERIFY_PASSWORD):
        raise HTTPException(status_code=401, detail="密码错误，无法触发运行")
    ok, msg = runner.start(lottery)
    if not ok:
        raise HTTPException(status_code=409, detail=msg)
    return {"lottery": lottery, "started": True, "message": msg}


@router.get("/{lottery}/run-status")
def run_all_status(lottery: str):
    """查询全量运行进度（跨 worker 轮询）。"""
    _get(lottery)
    from app.lottery.services import runner
    return runner.status(lottery)


@router.post("/{lottery}/refresh")
def refresh(lottery: str):
    if lottery not in LOTTERIES:
        raise HTTPException(status_code=404, detail=f"未知彩种: {lottery}")
    data = scraper.fetch_lottery(lottery)
    scraper.save_lottery(data)
    return {"lottery": lottery, "count": data["count"], "updated_at": data["updated_at"]}
