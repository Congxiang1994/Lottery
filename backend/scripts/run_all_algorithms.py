"""全量定时任务：爬取最新数据 → 全量算法预测 → 全量回测，结果写入 SQLite。

由 systemd timer 每日 00:00 触发（或手动 `python scripts/run_all_algorithms.py`）。

执行顺序（与「全局定时任务」语义一致）：
1. **爬取**：从 500彩票网 抓取 ssq/dlt 最新历史数据并落盘（失败沿用本地）
2. **预测**：跑完一个彩种的所有非集成类算法（含 cost=3,4 慢算法），结果整批入库
3. **回测**：全量算法 × 200 期留一预测（folds 见 runner.FOLDS），lift 排行榜写入 backtest_cache 表，
   算法广场「回测 → 全部」首次打开即可秒读缓存

集成类（cost=4 的 vote/cat_fusion/borda/meta_stack）跳过：它们的输出是
对其它算法结果的二次融合，单独意义不大。

退出码：0 = 所有关键阶段成功；1 = 任一彩种/阶段失败（供 systemd Restart=on-failure
识别并重试，不再把失败静默当成功）。
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lottery.algorithms import REGISTRY, engine_context, run_batch  # noqa: E402
from app.lottery.algorithms.backtest import evaluate as backtest_evaluate  # noqa: E402
from app.lottery.config import ALGORITHM_COST_SECONDS, LOTTERIES  # noqa: E402
from app.lottery.services import results_store, scraper  # noqa: E402
from app.lottery.services.runner import (  # noqa: E402
    BACKTEST_MAX_COST,
    FOLDS,
)

#: run_date 列的格式（YYYY-MM-DD）。--date 校验必须发生在任何 DELETE 之前（A17）。
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _valid_run_date(value: str) -> bool:
    """严格校验 --date：既要形状正确，也要是真实存在的日期。"""
    if not _DATE_RE.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def _algo_pool() -> list:
    """非集成类算法列表（与 runner.py 保持一致）。"""
    return [m for m in REGISTRY.values() if m.category != "ensemble"]


def _progress_start(lottery: str) -> bool:
    pool = _algo_pool()
    total_weight = float(sum(ALGORITHM_COST_SECONDS.get(m.cost, 1.0) for m in pool))
    return results_store.progress_start(lottery, len(pool), total_weight)


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
    """第一步：爬取最新历史数据；仅当来源是 live 才覆盖本地文件。

    服务层代理会给 fetch_lottery 返回值加 ``source: "live" | "seed"`` 字段。
    这里用 ``data.get("source", "live")`` 判断 —— 服务层尚未加字段时保持旧行为，
    一旦明确是 seed 兜底就绝不覆盖真实历史数据（A11 数据损坏链的脚本侧守卫）。
    """
    print(f"  · {lottery}: 爬取最新历史数据（500彩票网）…")
    data = scraper.fetch_lottery(lottery)
    if not data or not data.get("draws"):
        print(f"  ⚠ {lottery}: 爬取失败，沿用本地已有数据（不覆盖文件）")
        return scraper.load_lottery(lottery) or data or {}

    source = data.get("source", "live")
    if source != "live":
        print(f"  ⚠ {lottery}: 服务层返回 source={source!r}（种子/兜底数据），"
              "保留已有数据文件，不覆盖")
        return data

    scraper.save_lottery(data)
    latest = data["draws"][-1]
    print(f"  ✓ {lottery}: 爬取 {data['count']} 期，最新第 {latest['issue']} 期（{latest['date']}）")
    return data


def _run_one(lottery: str, data: dict, run_date: str | None = None) -> int:
    meta = LOTTERIES[lottery]
    if not data or not data.get("draws"):
        print(f"  ✗ {lottery}: 数据未就绪，跳过预测")
        return 0
    ctx = engine_context(lottery, data["draws"], meta)
    pool = _algo_pool()
    print(f"  · {lottery}: 预测 {len(pool)} 个算法，期数 {len(data['draws'])}")
    t0 = time.perf_counter()
    results = run_batch(ctx, ids=[m.id for m in pool])
    elapsed = time.perf_counter() - t0
    # --date 覆盖时写回同一 run_date：先删后写才不会「删了旧数据、写到今天」。
    n = results_store.save_batch(results, lottery, run_date=run_date)
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
    _progress_update(lottery, len(pool), f"回测阶段（{len(pool)} 算法 × {folds} 期留一预测）…",
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
    ap.add_argument("--date", default=None, help="run_date 覆盖（默认今天，格式 YYYY-MM-DD）")
    ap.add_argument("--no-backtest", action="store_true",
                    help="只跑预测，跳过全量回测（调试用）")
    ap.add_argument("--reset-stale", action="store_true",
                    help="启动前强制清理残留的 running 标志（上次跑批被 kill 后运维用）")
    args = ap.parse_args()

    # 🔴 A17/S17：参数校验必须在任何写操作（DELETE）之前完成。
    # 旧实现先 DELETE、再对 str 套 %Y 格式符崩溃 —— 数据删了、进程退了、无法回滚。
    if args.date and not _valid_run_date(args.date):
        print(f"✗ --date 格式非法: {args.date!r}（应为 YYYY-MM-DD 且为真实日期），"
              "未删除任何数据")
        return 2

    results_store.init()
    if args.reset_stale:
        # 上次跑批被 kill（systemd 超时 / 手工 kill）时 daemon 线程的 finally
        # 来不及跑，running=1 会残留；S3 的 10 分钟心跳抢占要等很久。
        # 运维确认无其它跑批进程后可用本参数立即清理。
        with results_store._conn() as con:
            con.execute("UPDATE run_progress SET running=0 WHERE running=1")
            con.execute("UPDATE global_run_lock SET running=0 WHERE id=1")
            con.execute("DELETE FROM backtest_lock")
        print("已清理残留 running / backtest 锁（--reset-stale）")
    if args.date:
        # 按日期删是设计意图（重跑某天）：只删本次要跑的彩种，避免误删其它彩种；
        # 而且下面 _run_one 会把结果写回同一 run_date，做到「删了再补回」。
        from app.lottery.services.results_store import _conn
        marks = ",".join("?" for _ in args.lottery)
        with _conn() as con:
            con.execute(
                f"DELETE FROM algo_results WHERE run_date = ? AND lottery IN ({marks})",
                (args.date, *args.lottery))

    # 有 --date 时直接用字符串；否则才格式化当前时间（A17：str 不能套 %Y）。
    run_label = args.date if args.date else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"==> 全量算法任务 @ {run_label}")

    # 开始前初始化进度：让算法广场页能显示本次定时跑批的 finished_at。
    # M36：progress_start 是抢占式的，返回 False 表示别人正在跑 —— 必须跳过该彩种，
    # 否则两套入口互相踩进度，且 finally 会误清掉对方的 running 标记。
    started: dict[str, bool] = {}
    errors: dict[str, str] = {}
    for k in args.lottery:
        if not _progress_start(k):
            msg = f"{k}: 进度抢占失败（该彩种已有任务在运行），跳过"
            errors[k] = msg
            print(f"  ✗ {msg}")
        else:
            started[k] = True

    ok = not errors
    try:
        # 第一步：先爬取最新历史数据（全部彩种）
        print("==> [1/3] 爬取最新历史数据")
        datasets: dict[str, dict] = {}
        for k in args.lottery:
            if k not in started:
                continue
            datasets[k] = _fetch(k)
            if not datasets[k].get("draws"):
                msg = f"{k}: 爬取与本地均无有效开奖数据"
                errors[k] = msg
                ok = False
                print(f"  ✗ {msg}")

        # 第二步：全量算法预测
        print("==> [2/3] 全量算法预测")
        total = 0
        for k in args.lottery:
            if k not in started:
                continue
            n = _run_one(k, datasets.get(k, {}), run_date=args.date)
            total += n
            if n <= 0:
                errors.setdefault(k, f"{k}: 预测阶段无结果（数据未就绪或落库失败）")
                ok = False
        print(f"==> 预测完成：共 {total} 行")

        # 第三步：全量回测
        if not args.no_backtest:
            print("==> [3/3] 全量回测")
            for k in args.lottery:
                if k not in started:
                    continue
                n = _backtest_one(k, datasets.get(k, {}))
                if n <= 0:
                    errors.setdefault(k, f"{k}: 回测无结果（锁超时或数据未就绪）")
                    ok = False
            print("==> 回测完成")
    except Exception as exc:  # noqa: BLE001 —— 顶层必须捕获，保证 error 传到进度表
        msg = f"{type(exc).__name__}: {exc}"
        for k in started:
            errors.setdefault(k, msg)
        ok = False
        print(f"✗ 任务异常终止：{msg}")
    finally:
        # 无论成功/失败都标记完成时间；M34：把实际错误传入，前端不再看到
        # 「崩溃后一切正常」。只对成功抢占的彩种收尾，避免踩掉他人进度。
        for k in started:
            _progress_finish(k, errors.get(k))

    if ok:
        print("==> 全部任务完成")
        return 0
    print("==> 任务结束（存在失败项）：" + "; ".join(f"{k}: {v}" for k, v in errors.items()))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
