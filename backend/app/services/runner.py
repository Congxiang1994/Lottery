"""全量算法运行器：后台线程逐算法运行 + sqlite 进度上报 + 结果落库。

与定时任务（scripts/run_all_algorithms.py）共用同一逻辑，只是把进度
写进 sqlite（run_progress 表）以便 gunicorn 多 worker 之间轮询一致。

算法广场「运行全部算法」按钮 → POST /run-all → 后台线程**顺序跑两个彩种**
（双色球 + 大乐透，各含预测阶段 + 回测阶段）→ 逐算法更新进度 → 完成后
save_batch 落库。落库后首页 / 智能推荐页的 saved-combined / saved-latest
自动读到新结果，从而与算法广场保持一致。
"""
from __future__ import annotations

import threading
import time

from app.algorithms import REGISTRY, engine_context, safe_run
from app.algorithms.base import CATEGORIES, scores_to_picks
from app.config import LOTTERIES
from app.services import results_store, scraper

# cost -> 预估耗时（秒），用于进度条 ETA 的加权估算
COST_SECONDS = {1: 0.15, 2: 0.6, 3: 2.0, 4: 4.5}
ALL_LOTTERIES = ["ssq", "dlt"]
_RUNNING: dict[str, threading.Thread] = {}
_LOCK = threading.Lock()


def _packet(m, ctx, out, ms: float) -> dict:
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


def _pool(lottery: str) -> list:
    return [m for m in REGISTRY.values() if m.category != "ensemble"]


def start(lottery: str) -> tuple[bool, str]:
    """启动单彩种全量运行（仅当未在运行）。"""
    pool = _pool(lottery)
    total_weight = float(sum(COST_SECONDS.get(m.cost, 1.0) for m in pool))
    if not results_store.progress_start(lottery, len(pool), total_weight):
        return False, "该彩种已有运行任务进行中，请等待完成"
    th = threading.Thread(target=_work, args=(lottery,), daemon=True)
    with _LOCK:
        _RUNNING[lottery] = th
    th.start()
    return True, "已启动全部算法运行"


def start_all() -> tuple[bool, str]:
    """启动全量运行：顺序跑双色球 + 大乐透（各含预测 + 回测）。

    数据库互斥锁防并发：任何时刻全局仅允许一个「运行全部」任务。
    """
    if not results_store.global_lock_start():
        return False, "已有全量运行任务进行中（数据库锁），请等待完成"
    for k in ALL_LOTTERIES:
        pool = _pool(k)
        total_weight = float(sum(COST_SECONDS.get(m.cost, 1.0) for m in pool))
        if not results_store.progress_start(k, len(pool), total_weight):
            results_store.global_lock_end()
            return False, f"{LOTTERIES[k]['name']} 已有任务进行中，请等待完成"
    th = threading.Thread(target=_work_all, daemon=True)
    with _LOCK:
        _RUNNING["all"] = th
    th.start()
    return True, "已启动全部算法运行（双色球 + 大乐透）"


def _work_all() -> None:
    try:
        for k in ALL_LOTTERIES:
            try:
                _work(k)
            except Exception:  # noqa: BLE001
                pass  # _work 内部已捕获并写入进度 error
    finally:
        results_store.global_lock_end()
        with _LOCK:
            _RUNNING.pop("all", None)


def _work(lottery: str) -> None:
    try:
        data = scraper.load_lottery(lottery)
        if not data or not data.get("draws"):
            raise RuntimeError(f"{lottery} 数据未就绪")
        meta = LOTTERIES[lottery]
        ctx = engine_context(lottery, data["draws"], meta)
        pool = [m for m in REGISTRY.values() if m.category != "ensemble"]
        total_w = float(sum(COST_SECONDS.get(m.cost, 1.0) for m in pool))
        t0 = time.time()

        # ---------- 阶段 1：全量预测 ----------
        results = []
        done_w = 0.0
        for i, m in enumerate(pool):
            t1 = time.perf_counter()
            out = safe_run(m, ctx)
            ms = (time.perf_counter() - t1) * 1000
            results.append(_packet(m, ctx, out, ms))
            done_w += COST_SECONDS.get(m.cost, 1.0)
            elapsed = time.time() - t0
            remain = total_w - done_w
            eta = elapsed / max(done_w, 1e-6) * remain if remain > 0 else 0.0
            results_store.progress_update(
                lottery, i + 1, done_w, m.name, elapsed, eta, phase="predict")
        results_store.save_batch(results, lottery)

        # ---------- 阶段 2：全量回测 ----------
        results_store.progress_update(
            lottery, len(pool), total_w, "回测阶段（85 算法 × 5 期留一预测）…",
            time.time() - t0, 0.0, phase="backtest")
        from app.algorithms.backtest import evaluate as bt_evaluate
        stop = threading.Event()
        hb = threading.Thread(
            target=_heartbeat,
            args=(lottery, t0, stop, len(pool), total_w), daemon=True)
        hb.start()
        try:
            res = bt_evaluate(ctx, folds=FOLDS, max_cost=BACKTEST_MAX_COST,
                              allow_compute=True)
            # 锁被 API 请求占用时等待其完成（最多 15 分钟），期间心跳继续
            if res is None:
                results_store.progress_update(
                    lottery, len(pool), total_w,
                    "等待他人回测完成（互斥锁被占用）…",
                    time.time() - t0, 0.0, phase="backtest")
                deadline = time.time() + 900
                while time.time() < deadline:
                    time.sleep(10)
                    res = bt_evaluate(ctx, folds=FOLDS, max_cost=BACKTEST_MAX_COST,
                                      allow_compute=True)
                    if res is not None:
                        break
                if res is None:
                    raise RuntimeError("等待回测互斥锁超时（900s）")
        finally:
            stop.set()
            hb.join(timeout=3)

        elapsed = time.time() - t0
        results_store.progress_update(
            lottery, len(pool), total_w, "全部完成", elapsed, 0.0, phase="done")
        results_store.progress_finish(lottery)
    except Exception as exc:  # noqa: BLE001
        results_store.progress_finish(lottery, f"{type(exc).__name__}: {exc}")
    finally:
        with _LOCK:
            _RUNNING.pop(lottery, None)


def _heartbeat(lottery: str, t0: float, stop: threading.Event,
               total: int, total_w: float) -> None:
    """回测阶段心跳：每 2s 刷新 elapsed，让进度条持续走动。"""
    while not stop.wait(2.0):
        results_store.progress_update(
            lottery, total, total_w, "回测阶段（85 算法 × 5 期留一预测）…",
            time.time() - t0, 0.0, phase="backtest")


FOLDS = 5
BACKTEST_MAX_COST = 4  # 全部算法（不区分快慢）


def status(lottery: str) -> dict:
    return results_store.progress_status(lottery)


def status_all() -> dict:
    """全局状态：两个彩种合并（用于「运行全部算法」进度轮询）。"""
    lot = {k: results_store.progress_status(k) for k in ALL_LOTTERIES}
    running = any(s["running"] for s in lot.values())
    done = sum(s["done"] for s in lot.values())
    total = sum(s["total"] for s in lot.values())
    active = next((k for k, s in lot.items() if s["running"]), None)
    elapsed = sum(s["elapsed"] for s in lot.values())
    eta = lot[active]["eta"] if active else 0.0
    error = next((s["error"] for s in lot.values() if s["error"]), None)
    return {
        "lotteries": lot,
        "running": running,
        "done": done,
        "total": total,
        "percent": round(done / total * 100, 1) if total else 0,
        "phase": lot[active]["phase"] if active else "done",
        "current": lot[active]["current"] if active else "",
        "current_lottery": LOTTERIES[active]["name"] if active else None,
        "elapsed": round(elapsed, 1),
        "eta": round(eta, 1),
        "finished": all(not s["running"] and s["finished_at"]
                        for s in lot.values()),
        "error": error,
    }
