"""全量定时任务：爬取最新数据 → 全量算法预测 → 全量回测，结果写入 SQLite。

由 systemd timer 每日 00:00 触发（或手动 `python scripts/run_all_algorithms.py`）。

执行顺序（与「全局定时任务」语义一致）：
1. **爬取**：从 500彩票网 抓取 ssq/dlt 最新历史数据并落盘（失败沿用本地）
2. **预测**：跑完一个彩种的所有非集成类算法（含 cost=3,4 慢算法），结果整批入库
3. **回测**：全量 85 算法 × 5 期留一预测，lift 排行榜写入 backtest_cache 表，
   算法广场「回测 → 全部」首次打开即可秒读缓存

集成类（cost=4 的 vote/cat_fusion/borda/meta_stack）跳过：它们的输出是
对其它算法结果的二次融合，单独意义不大。
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lottery.algorithms import REGISTRY, engine_context, run_batch  # noqa: E402
from app.lottery.algorithms.backtest import evaluate as backtest_evaluate  # noqa: E402
from app.lottery.config import ALGORITHM_COST_SECONDS, LOTTERIES  # noqa: E402
from app.lottery.services import results_store, scraper  # noqa: E402

FOLDS = 5
BACKTEST_MAX_COST = 4  # 全部算法（不区分快慢）


def _algo_pool() -> list:
    """非集成类算法列表（与 runner.py 保持一致）。"""
    return [m for m in REGISTRY.values() if m.category != "ensemble"]


def _progress_start(lottery: str) -> None:
    pool = _algo_pool()
    total_weight = float(sum(ALGORITHM_COST_SECONDS.get(m.cost, 1.0) for m in pool))
    results_store.progress_start(lottery, len(pool), total_weight)


def _progress_update(lottery: str, done: int, current: str,
                     elapsed: float, eta: float = 0.0,
                     phase: str = "predict") -> None:
    pool = _algo_pool()
    total_weight = float(sum(ALGORITHM_COST_SECONDS.get(m.cost, 1.0) for m in pool))
    results_store.progress_update(
        lottery, done, total_weight, current, elapsed, eta, phase=phase)


def _progress_finish(lottery: str, error: str | None = None) -> None:
    results_store.progress_finish(lottery, error)


def _fetch(lottery: str) -> dict:
    """第一步：爬取最新历史数据并落盘；失败则沿用本地数据。"""
    print(f"  · {lottery}: 爬取最新历史数据（500彩票网）…")
    data = scraper.fetch_lottery(lottery)
    if not data or not data.get("draws"):
        print(f"  ⚠ {lottery}: 爬取失败，改用本地已有数据")
        data = scraper.load_lottery(lottery) or data
        return data
    scraper.save_lottery(data)
    latest = data["draws"][-1]
    print(f"  ✓ {lottery}: 爬取 {data['count']} 期，最新第 {latest['issue']} 期（{latest['date']}）")
    return data


def _run_one(lottery: str, data: dict) -> int:
    meta = LOTTERIES[lottery]
    if not data or not data.get("draws"):
        print(f"  ✗ {lottery}: 数据未就绪，跳过")
        return 0
    ctx = engine_context(lottery, data["draws"], meta)
    pool = _algo_pool()
    print(f"  · {lottery}: 预测 {len(pool)} 个算法，期数 {len(data['draws'])}")
    t0 = time.perf_counter()
    results = run_batch(ctx, ids=[m.id for m in pool])
    elapsed = time.perf_counter() - t0
    n = results_store.save_batch(results, lottery)
    _progress_update(lottery, len(pool), "预测完成，准备回测…",
                     elapsed, 0.0, phase="predict")
    print(f"  ✓ {lottery}: 预测写入 {n} 行，耗时 {elapsed:.1f}s")
    return n


def _backtest_one(lottery: str, data: dict, folds: int = FOLDS) -> int:
    meta = LOTTERIES[lottery]
    if not data or not data.get("draws"):
        print(f"  ✗ {lottery}: 数据未就绪，跳过回测")
        return 0
    ctx = engine_context(lottery, data["draws"], meta)
    print(f"  · {lottery}: 全量回测（全部算法 × {folds} 期留一预测）…")
    pool = _algo_pool()
    _progress_update(lottery, len(pool), "回测阶段（85 算法 × 5 期留一预测）…",
                     0.0, 0.0, phase="backtest")
    t0 = time.perf_counter()
    res = backtest_evaluate(ctx, folds=folds, max_cost=BACKTEST_MAX_COST,
                            allow_compute=True)
    # 互斥锁被 API 请求占用时等待其完成（最多 15 分钟）
    if res is None:
        print(f"  · {lottery}: 回测锁被占用，等待他人完成后复用缓存…")
        deadline = time.perf_counter() + 900
        while time.perf_counter() < deadline:
            time.sleep(10)
            res = backtest_evaluate(ctx, folds=folds, max_cost=BACKTEST_MAX_COST,
                                    allow_compute=True)
            if res is not None:
                break
        if res is None:
            print(f"  ✗ {lottery}: 等待回测互斥锁超时（900s），跳过")
            return 0
    elapsed = time.perf_counter() - t0
    print(f"  ✓ {lottery}: 回测 {len(res['algos'])} 个算法落库，耗时 {elapsed:.1f}s"
          f"（榜首「{res['algos'][0]['name']}」lift={res['algos'][0]['score']}）")
    return len(res["algos"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("lottery", nargs="*", default=["ssq", "dlt"],
                    help="彩种 ssq/dlt（可多选），默认两者")
    ap.add_argument("--date", default=None, help="run_date 覆盖（默认今天）")
    ap.add_argument("--no-backtest", action="store_true",
                    help="只跑预测，跳过全量回测（调试用）")
    args = ap.parse_args()

    results_store.init()
    if args.date:
        # 自定义日期时全局替换；调用方保证一次只跑一批
        from app.lottery.services.results_store import _conn
        with _conn() as con:
            con.execute("DELETE FROM algo_results WHERE run_date = ?", (args.date,))

    print(f"==> 全量算法任务 @ {args.date or datetime.now():%Y-%m-%d %H:%M:%S}")

    # 开始前初始化进度：让算法广场页能显示本次定时跑批的 finished_at
    for k in args.lottery:
        _progress_start(k)

    try:
        # 第一步：先爬取最新历史数据（全部彩种）
        print("==> [1/3] 爬取最新历史数据")
        datasets: dict[str, dict] = {}
        for k in args.lottery:
            datasets[k] = _fetch(k)

        # 第二步：全量算法预测
        print("==> [2/3] 全量算法预测")
        total = 0
        for k in args.lottery:
            total += _run_one(k, datasets[k])
        print(f"==> 预测完成：共 {total} 行")

        # 第三步：全量回测
        if not args.no_backtest:
            print("==> [3/3] 全量回测")
            for k in args.lottery:
                _backtest_one(k, datasets[k])
            print("==> 回测完成")
    finally:
        # 无论成功/失败都标记完成时间，保证页面显示的是最近一次跑批时间
        for k in args.lottery:
            _progress_finish(k)

    print("==> 全部任务完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
