#!/usr/bin/env python3
"""彩票命中率修复的验收脚本（每一条都能失败，失败即非 0 退出）。

覆盖 ``docs/lottery-hit-rate-analysis.md`` §5 的 A–F 六条断言，并额外验证
共识口径一致性与期号校验。**故意做成可失败的**：任何一条不成立都必须
非 0 退出，禁止「只打印」「测不到就跳过」。

用法::

    LOTTERY_DB_DIR=/tmp/lottery_db backend/.venv/bin/python scripts/verify_lottery_metrics.py
    ... --inject-pick-top       # 注入式验证：确认 B 真的会失败（应当非 0 退出）
    ... --inject-no-scores      # 注入式验证：scores_to_picks 不产 scores → D 必须失败

依赖：开奖数据（``app/lottery/data/{ssq,dlt}.json``）与 systemd unit 文件。
脚本用**临时库**做 D 段真实写入与 E 段缓存字段断言，既不污染生产库，也不把
「库里没数据」当成跳过理由 —— 缓存缺失会使断言失败（见 E 段注释）。
"""
from __future__ import annotations

import argparse
import math
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from app.lottery.algorithms.base import (  # noqa: E402
    REGISTRY,
    AlgoContext,
    ScoreShapeError,
    normalize,
    pick_top,
    scores_to_picks,
)
from app.lottery.config import LOTTERIES  # noqa: E402
from app.lottery.services import history_matrix, results_store, scraper  # noqa: E402

FAILS: list[str] = []
CHECKS = 0

#: 断言条数基线（M16）：条数不得随库状态漂移。任何一段的断言增删都必须同步更新
#: 本常量；实际条数不足或超出都直接失败，杜绝「空库少跑几条还算全绿」。
EXPECTED_CHECKS = 56

# 是否处于隔离库：D 段会往 results_store.DB_PATH 写真实跑批结果（供 B/C 段消费）。
# 若指向生产库（/data/lottery）必须拒绝运行，防止验收脚本改生产口令/数据。
_db_root = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery")).resolve()
if str(_db_root) == "/data/lottery":
    print("✗ 拒绝在默认生产库目录 /data/lottery 上运行本脚本："
          "请设置 LOTTERY_DB_DIR=<临时目录>")
    sys.exit(1)


def check(name: str, ok: bool, detail: str = "") -> None:
    """记录一条断言。失败会累计并在最后统一非 0 退出。"""
    global CHECKS
    CHECKS += 1
    if ok:
        print(f"  ✓ {name}{(' — ' + detail) if detail else ''}")
    else:
        print(f"  ✗ {name}{(' — ' + detail) if detail else ''}")
        FAILS.append(name)


def _entropy(counts: list[int]) -> float:
    """整数计票分布的香农熵（bits）。全 0 票 → 0。"""
    total = sum(counts)
    if total <= 0:
        return 0.0
    h = 0.0
    for c in counts:
        if c > 0:
            p = c / total
            h -= p * math.log2(p)
    return h


# ---------------------------------------------------------------- A

def check_A_pick_top_guard() -> None:
    """A：pick_top 形状不符必须抛异常，绝不能静默平铺成等间距号码。"""
    print("[A] pick_top 形状守卫")
    try:
        got = pick_top(np.zeros(6), 6, 33, tiebreak=7)
        check("长度 6 → 池 33 抛异常", False, f"却返回了 {got}")
    except ScoreShapeError:
        check("长度 6 → 池 33 抛异常", True)

    # 反例：正确的长度必须正常工作
    picks = pick_top(np.arange(33, dtype=float), 6, 33)
    check("长度 33 正常工作", len(picks) == 6 and len(set(picks)) == 6, f"{picks}")

    # 关键回归防护：即便用「全是相同值」的输入（旧实现下必然产出格点），
    # 正确长度也不该退化成等间距 —— 相同值时应靠 jitter 打散，取到任意 6 个号。
    uniform = pick_top(np.zeros(33), 6, 33, tiebreak=3)
    diffs = [uniform[i + 1] - uniform[i] for i in range(5)]
    check("同分输入不产出模 6 等间距格点",
          len(set(diffs)) > 1 or diffs != [6, 6, 6, 6, 6], f"差值 {diffs}")


# ---------------------------------------------------------------- B

def _lattice_ratio(picks: list[int], p: int) -> float:
    """落在同一个模 p 余数类的号码占比（1.0 = 完全等间距）。"""
    from collections import Counter
    c = Counter(n % p for n in picks)
    return max(c.values()) / len(picks)


def check_B_consensus_not_lattice() -> None:
    """B：线上共识必须走计票，不能有任何平铺格点。"""
    print("[B] 共识号码无格点伪影")
    for lot in ("ssq", "dlt"):
        meta = LOTTERIES[lot]
        try:
            res = history_matrix.combine_latest_batch(lot, meta)
        except Exception as exc:  # noqa: BLE001
            check(f"{lot} 共识可取", False, f"{type(exc).__name__}: {exc}")
            continue
        if res is None:
            check(f"{lot} 共识可取", False, "临时库无跑批数据（D 段未成功写入）")
            continue
        ratio = _lattice_ratio(res["red"], meta["red_count"])
        # 若真投票，最热门余数类占比应接近 p/m（ssq≈18%、dlt≈14%），远低于 80%
        check(f"{lot} 共识同余占比 < 60%", ratio < 0.60,
              f"{ratio * 100:.0f}%（旧实现为 88%/100%）")
        # 全池投票分布必须存在且长度正确
        check(f"{lot} red_votes 长度 = {meta['red_max']}",
              len(res.get("red_votes", [])) == meta["red_max"])
        check(f"{lot} red_conf 是全池长度（不是选号个数）",
              len(res.get("red_conf", [])) == meta["red_max"],
              f"{len(res.get('red_conf', []))}")


# ---------------------------------------------------------------- C

def check_C_blue_not_issue_hash() -> None:
    """C：蓝球不能只由 tiebreak（期号）决定。

    旧实现里 blue_conf 长度 = blue_count，normalize 后全 0.5，pick_top 面对
    全等分数时唯一决定因素就是 tiebreak —— 换掉 tiebreak 结果必变。
    现在走计票，蓝球投票分布应当**因批次而异**。
    """
    print("[C] 蓝球不是期号的哈希值")
    for lot in ("ssq", "dlt"):
        meta = LOTTERIES[lot]
        try:
            latest = results_store.latest(lot)
        except Exception as exc:  # noqa: BLE001
            check(f"{lot} 蓝球取值", False, f"{type(exc).__name__}: {exc}")
            continue
        if not latest:
            check(f"{lot} 蓝球取值", False, "临时库无跑批数据（D 段未成功写入）")
            continue
        agg = history_matrix.aggregate_consensus(latest["results"], meta,
                                                 int(latest["issue_base"] or 0))
        votes = [int(v) for v in agg["blue_votes"]]
        # 关键：蓝球投票不能是常数（旧实现恒为 0，等价于「全 0.5」）
        check(f"{lot} 蓝球投票非常数", len(set(votes)) > 1,
              f"取值数 {len(set(votes))}")
        # M13：旧断言 `a = pick_top(...); b = pick_top(...); votes.max() > 0`
        # 中 a/b 算完不用（死代码），且 max(votes)>0 在旧实现恒真（全 0.5 也 >0）。
        # 改成有效断言：蓝球票必须有真实分布（至少 2 个号码得票），
        # 且投票分布的信息熵 > 0（全 0 票或「一票独大且无分布」都抓得到）。
        distinct_voted = sum(1 for v in votes if v > 0)
        ent = _entropy(votes)
        check(f"{lot} 蓝球票数有真实分布（≥2 个号得票）", distinct_voted >= 2,
              f"得票号码数 {distinct_voted}/{len(votes)}")
        check(f"{lot} 蓝球投票信息熵 > 0.5 bit", ent > 0.5,
              f"H={ent:.3f} bit")


# ---------------------------------------------------------------- D

def check_D_scores_persisted(inject_no_scores: bool = False) -> None:
    """D：write 路径必须把全量打分 red_scores/blue_scores 落库（长度 = 号码池）。

    历史行没有这两列的值（旧库列为 NULL），所以这里验证的是**写入路径**：
    调用真实 ``run_batch``（内部走 ``scores_to_picks``）生成结果，再
    ``save_batch`` 写临时库，读回断言长度 —— 不再自己硬编码 scores 后喂库。
    注入验证（``--inject-no-scores``）：把 scores_to_picks 改成不产出 scores，
    D 必须失败（否则说明断言还是假的）。
    """
    print("[D] 全量打分入库（真实写入路径 + 临时库验证）")
    # 用**当前活动的临时库**（LOTTERY_DB_DIR 指定）做真实写入：B/C/E 段
    # 需要读到这批结果。脚本开头已强制 DB 目录不是 /data/lottery。
    from app.lottery.algorithms import engine_context, run_batch
    from app.lottery.algorithms import base as algo_base

    orig_picks = algo_base.scores_to_picks
    try:
        if inject_no_scores:
            def no_scores(out, ctx, tiebreak=0):
                d = orig_picks(out, ctx, tiebreak=tiebreak)
                d.pop("red_scores", None)
                d.pop("blue_scores", None)
                return d
            algo_base.scores_to_picks = no_scores
            # 注意：algorithms/__init__.py 里 `_packet` 在 import 时已绑定
            # scores_to_picks 的引用，monkeypatch base 模块未必影响它 —— 为确保
            # 注入生效，同时 patch __init__ 的引用（真实写入路径用的那个）。
            import app.lottery.algorithms as algos_pkg
            algos_pkg.scores_to_picks = no_scores

        for lot in ("ssq", "dlt"):
            meta = LOTTERIES[lot]
            try:
                data = scraper.load_lottery(lot)
                draws = (data or {}).get("draws") or []
            except Exception:  # noqa: BLE001
                draws = []
            if not draws:
                check(f"{lot} red_scores 真实写入路径", False, "无开奖数据")
                continue

            ctx = engine_context(lot, draws, meta)
            # 真实写入路径：run_batch → _packet → scores_to_picks → save_batch
            ids = [m.id for m in REGISTRY.values()
                   if m.category != "ensemble" and m.cost <= 2]
            res = run_batch(ctx, ids=ids)
            try:
                n = results_store.save_batch(res, lot)
            except Exception as exc:  # noqa: BLE001
                check(f"{lot} red_scores 真实写入路径", False,
                      f"save_batch 抛错: {type(exc).__name__}: {exc}")
                continue
            check(f"{lot} run_batch 产生结果行", n == len(res) and n > 0,
                  f"写入 {n} 行 / 生成 {len(res)} 行")

            got = results_store.latest(lot)
            if not got or not got.get("results"):
                check(f"{lot} 写入后读回", False, "读不到任何结果")
                continue
            first = got["results"][0]
            check(f"{lot} red_scores 长度 = {meta['red_max']}",
                  len(first.get("red_scores") or []) == meta["red_max"],
                  f"读到 {len(first.get('red_scores') or [])}")
            check(f"{lot} blue_scores 长度 = {meta['blue_max']}",
                  len(first.get("blue_scores") or []) == meta["blue_max"],
                  f"读到 {len(first.get('blue_scores') or [])}")
            # 全量打分必须能被后续共识复用（不再是「选中号的置信度」）
            check(f"{lot} red_scores 覆盖全部号码位",
                  len(set(first.get("red_scores") or [])) > 1)
    finally:
        algo_base.scores_to_picks = orig_picks
        import app.lottery.algorithms as algos_pkg
        algos_pkg.scores_to_picks = orig_picks


# ---------------------------------------------------------------- E

#: 线上服务器实测（4 核 AMD EPYC，单核跑满）每折耗时，秒。
#: 数据取自 2026-11-19 在 124.222.39.15 上对 68 个 cost<=3 算法的实测。
_SERVER_SEC_PER_FOLD = {1: 0.05, 2: 2.98, 3: 8.76}
#: 回测之外的固定开销（秒）：爬取 2×60s + 预测 ~18s + 等互斥锁最坏 900s。
#: 来自 run_all_algorithms.py 与 runner.py 的实际代码路径。
_FIXED_OVERHEAD_SEC = 2 * 60 + 18 + 900


def _systemd_timeout() -> int | None:
    """从 deploy/lottery-algos.service 文件里正则解析 TimeoutStartSec 实际值。"""
    unit = Path(__file__).resolve().parent.parent.parent / "deploy" / "lottery-algos.service"
    if not unit.exists():
        return None
    m = re.search(r"^\s*TimeoutStartSec\s*=\s*(\d+)\s*$", unit.read_text(), re.M)
    return int(m.group(1)) if m else None


def check_E_backtest_folds() -> None:
    """E：回测默认 folds 足够大，CI 半宽 < 0.15 —— 从**真实缓存**算，不比常量。"""
    print("[E] 回测统计效力（真实缓存优先）")
    from app.lottery.services.runner import BACKTEST_MAX_COST, FOLDS

    check("runner.FOLDS ≥ 200", FOLDS >= 200, f"{FOLDS}")

    # 理论 CI 半宽（无缓存时的兜底，明确标注「理论值」，不冒充实测）
    def theoretical_half(lot: str) -> float:
        pool = LOTTERIES[lot]["red_max"]
        winners = picks = LOTTERIES[lot]["red_count"]
        p = winners / pool
        var = picks * p * (1 - p) * (pool - picks) / (pool - 1)
        exp = picks * p
        return 1.96 * (var / FOLDS) ** 0.5 / exp

    # 用 runner 的默认值（部署后缓存是 folds=200/max_cost=2）查真实回测缓存。
    cached: dict | None = None
    for lot in ("ssq", "dlt"):
        try:
            latest = results_store.latest(lot)
            issue = latest["issue_base"] if latest else ""
            cached = results_store.backtest_get(lot, FOLDS, BACKTEST_MAX_COST, issue)
        except Exception:  # noqa: BLE001
            cached = None
        # M15：缓存缺失必须断言失败，不能再静默跳过；同时始终执行同样条数的
        # 断言（条数不随库状态漂移）。无缓存时 CI 半宽用理论值兜底并明确标注。
        a = cached["algos"][0] if cached and cached.get("algos") else {}
        ci = a.get("red_ci") or []
        if len(ci) == 2:
            half = (ci[1] - ci[0]) / 2
            detail = (f"±{half:.3f}（folds={cached.get('folds')}, "
                      f"max_cost={BACKTEST_MAX_COST}，来自 sqlite 真实缓存）")
        else:
            half = theoretical_half(lot)
            detail = f"±{half:.3f}（理论值兜底，缓存该档缺失，非实测）"
        check(f"{lot} 回测缓存该档已生成（folds={FOLDS}, max_cost={BACKTEST_MAX_COST}）",
              bool(cached and cached.get("algos")),
              "" if cached else "缓存缺失：请先跑 run_all_algorithms.py 生成回测缓存")
        check(f"{lot} 真实缓存 CI 半宽 < 0.15", half < 0.15, detail)
        for field in ("red_ci", "blue_ci", "red_p", "blue_p", "passes_fdr"):
            check(f"缓存算法带 {field}", field in a)
        check("缓存带零假设基线", bool(cached) and "null_red_lift" in cached)


# ---------------------------------------------------------------- E2

def check_E2_backtest_fits_timeout() -> None:
    """E2：回测总耗时 + 爬取/预测/等锁开销必须落在 systemd 超时之内。"""
    print("[E2] 全程耗时在 systemd 超时内")
    from app.lottery.services.runner import BACKTEST_MAX_COST, FOLDS

    timeout = _systemd_timeout()
    check("能从 deploy/lottery-algos.service 解析 TimeoutStartSec",
          timeout is not None, f"{timeout}s" if timeout else "解析失败")
    if timeout is None:
        return

    per_fold = _SERVER_SEC_PER_FOLD.get(BACKTEST_MAX_COST)
    if per_fold is None:
        check(f"max_cost={BACKTEST_MAX_COST} 有实测耗时基线", False,
              "新增成本档位请先实测再上线")
        return
    backtest = per_fold * FOLDS * 2  # 双彩种
    crawl_predict_sec = 2 * 60 + 18  # 爬取 + 预测（不含等锁）
    lock_wait_sec = 900              # 等回测互斥锁的最坏情况
    total_typical = backtest + crawl_predict_sec
    total_worst = total_typical + lock_wait_sec
    check(f"max_cost={BACKTEST_MAX_COST} × folds={FOLDS} × 2 彩种"
          f"回测≈{backtest / 60:.0f}min + 爬取/预测{crawl_predict_sec / 60:.0f}min "
          f"= {total_typical / 60:.0f}min < {timeout // 60}min",
          total_typical < timeout, f"典型路径 {total_typical:.0f}s / 超时 {timeout}s")
    check(f"最坏情况（含等锁{lock_wait_sec}s）总耗时 {total_worst / 60:.0f}min "
          f"< {timeout // 60}min",
          total_worst < timeout, f"最坏 {total_worst:.0f}s / 超时 {timeout}s")
    # 留 20% 余量：对典型路径要求（等锁是罕见异常，不应常态消耗全部余量）
    check("典型路径耗时有 ≥20% 超时余量",
          total_typical < timeout * 0.8,
          f"{total_typical / timeout * 100:.0f}%")


# ---------------------------------------------------------------- F

def check_F_history_paging() -> None:
    """F：历史对照页分页必须正确。

    两个方向都要测：
    1) 跑批未覆盖、但**仍在有效页范围内**的期 → 必须返回开奖明细 + predictions=None
       （旧实现在「一个批次都没匹配到」时整页返回空数组）；
    2) 页码**超出末页** → 必须返回空列表（旧实现会因负索引返回大段数据）。
    """
    print("[F] 历史对照分页")
    for lot in ("ssq", "dlt"):
        meta = LOTTERIES[lot]
        try:
            data = scraper.load_lottery(lot)
        except Exception as exc:  # noqa: BLE001
            check(f"{lot} 分页", False, f"{type(exc).__name__}: {exc}")
            continue
        draws = (data or {}).get("draws") or []
        if not draws:
            check(f"{lot} 分页", False, "无开奖数据")
            continue

        page_size = 15
        last_page = max(1, -(-len(draws) // page_size))

        # (1) 跑批只覆盖最近 ~94 天；最后一页几乎肯定不在覆盖范围内
        res = history_matrix.build_history_matrix(lot, draws, meta, last_page, page_size)
        check(f"{lot} 末页({last_page})非空", len(res["items"]) > 0,
              f"items={len(res['items'])}（修复前可能为 0）")
        if res["items"]:
            it = res["items"][0]
            check(f"{lot} 旧期仍返回开奖号码",
                  bool(it.get("issue")) and bool(it.get("red")))
            check(f"{lot} 旧期 predictions 为 None",
                  it.get("predictions") is None,
                  "跑批未覆盖的期不应伪造预测")

        # (2) 超出末页 → 必须空
        res2 = history_matrix.build_history_matrix(lot, draws, meta, last_page + 50, page_size)
        check(f"{lot} 超界页({last_page + 50})返回空", len(res2["items"]) == 0,
              f"items={len(res2['items'])}（修复前会返回大段数据）")
        check(f"{lot} 超界页 total 仍正确", res2["total"] == len(draws))


# ---------------------------------------------------------------- G

def check_G_issue_validation() -> None:
    """G：脏期号必须被 save_batch 拒绝。"""
    print("[G] 期号校验")
    base = {"id": "x", "name": "x", "category": "statistical",
            "red": [1], "blue": [1], "red_conf": [1.0], "blue_conf": [1.0],
            "red_scores": [0.5], "blue_scores": [0.5],
            "detail": {}, "elapsed_ms": 1.0}
    try:
        results_store._validate_issue_bases([dict(base, issue_base="20263435")], "ssq")
        check("脏期号 20263435 被拒", False, "却被放行")
    except ValueError:
        check("脏期号 20263435 被拒", True)

    try:
        results_store._validate_issue_bases([dict(base, issue_base="261")], "ssq")
        check("短期号被拒", False)
    except ValueError:
        check("短期号被拒", True)


# ---------------------------------------------------------------- 注入辅助

def _tiled_pick_top(scores, count: int, max_n: int, tiebreak: int = 0) -> list[int]:
    """2026-11 之前的实现：长度不符时 ``np.resize`` 循环平铺。

    仅用于 ``--inject-pick-top`` 注入式验证 —— 证明断言 B 真的能抓到回归。
    """
    s = np.resize(np.asarray(scores, dtype=np.float64).ravel(), max_n)
    s = np.nan_to_num(s, nan=0.0, posinf=0.0, neginf=0.0)
    rng = np.random.default_rng(abs(int(tiebreak)) % (2**31) + 7)
    jitter = rng.random(max_n) * 1e-9
    order = np.argsort(-(s + jitter), kind="stable")
    return sorted(int(i) + 1 for i in order[:count])


def _old_conf_mean_consensus(results: list[dict], meta: dict,
                              seed: int) -> dict:
    """2026-11 之前的线上实现：对 ``red_conf``（长度 = 选号个数）取均值后 pick_top。

    它和现在的 ``aggregate_consensus`` 真正的差别不是 pick_top 的实现，
    而是**喂进去的向量长度**：``red_conf`` 只有 6/5 个元素，被平铺到 33/35
    后必然产出等间距格点。注入这条才能证明断言 B 抓得到那类回归。
    """
    rc = np.mean([np.asarray(r["red_conf"], dtype=float) for r in results], axis=0)
    bc = np.mean([np.asarray(r["blue_conf"], dtype=float) for r in results], axis=0)
    red = _tiled_pick_top(rc, meta["red_count"], meta["red_max"], seed)
    blue = _tiled_pick_top(bc, meta["blue_count"], meta["blue_max"], seed + 999)
    return {"red": red, "blue": blue,
            "red_votes": list(np.resize(rc, meta["red_max"])),
            "blue_votes": list(np.resize(bc, meta["blue_max"])),
            "red_conf": [float(v) for v in np.resize(rc, meta["red_max"])],
            "blue_conf": [float(v) for v in np.resize(bc, meta["blue_max"])]}


def _seed_batch_quiet() -> None:
    """向活动临时库静默写一批真实跑批结果（供注入式验证单独跑某段用）。"""
    from app.lottery.algorithms import engine_context, run_batch
    for lot in ("ssq", "dlt"):
        data = scraper.load_lottery(lot) or {}
        if not data.get("draws"):
            continue
        ctx = engine_context(lot, data["draws"], LOTTERIES[lot])
        ids = [m.id for m in REGISTRY.values()
               if m.category != "ensemble" and m.cost <= 2]
        res = run_batch(ctx, ids=ids)
        results_store.save_batch(res, lot)


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inject-pick-top", action="store_true",
                    help="注入式验证：把 pick_top 换回旧的平铺实现，确认 B 会失败并整体非 0 退出")
    ap.add_argument("--inject-no-scores", action="store_true",
                    help="注入式验证：scores_to_picks 不产 scores，确认 D 必须失败")
    args = ap.parse_args()

    # 库迁移（幂等）：ACEG 需要表结构就位
    try:
        results_store.init()
    except Exception as exc:  # noqa: BLE001
        print(f"⚠ 数据库初始化失败（跳过依赖数据的断言）：{type(exc).__name__}: {exc}")

    _real_aggregate = history_matrix.aggregate_consensus

    print(f"库路径: {results_store.DB_PATH}")
    print(f"彩种: {sorted(LOTTERIES)}\n")

    if args.inject_pick_top:
        # 注入式验证：把共识聚合换回 2026-11 之前的实现（red_conf 均值 + 平铺）。
        # 期望结果：B（共识无格点）必须失败 → 脚本非 0 退出。
        print("[注入] 换回旧的「red_conf 均值 + np.resize 平铺」，期望 B 失败\n")
        # B 依赖最新跑批结果：先静默写一批真实数据，避免空库导致的
        # 「共识可取」失败掩盖了真正要验证的格点检测（注入验证要精确）。
        _seed_batch_quiet()
        history_matrix.aggregate_consensus = _old_conf_mean_consensus
        try:
            check_B_consensus_not_lattice()
        finally:
            history_matrix.aggregate_consensus = _real_aggregate
    elif args.inject_no_scores:
        # 注入式验证：D 段走真实 run_batch，monkeypatch 掉 scores 产出后
        # 读回长度必然为 0 → D 失败 → 非 0 退出。这证明 D 不再是硬编码假绿。
        print("[注入] scores_to_picks 不产出 scores，期望 D 失败\n")
        check_D_scores_persisted(inject_no_scores=True)
    else:
        # D 必须先跑：它向临时库写入真实跑批结果，B/C/E 依赖这批数据。
        # 这样依赖数据的段永远有数据，条数不随「库里原先有没有数据」漂移。
        check_D_scores_persisted()
        check_A_pick_top_guard()
        check_B_consensus_not_lattice()
        check_C_blue_not_issue_hash()
        check_E_backtest_folds()
        check_E2_backtest_fits_timeout()
        check_F_history_paging()
        check_G_issue_validation()

    print(f"\n{'=' * 60}")
    # 条数基线只对完整运行生效；注入模式只跑单段，不适用基线。
    # 注入验证看的是 FAILS 里的具体断言，不是「条数不够」这种混淆信号。
    if not args.inject_pick_top and not args.inject_no_scores and CHECKS != EXPECTED_CHECKS:
        print(f"✗ 断言条数 {CHECKS} ≠ 基线 {EXPECTED_CHECKS}（条数漂移，拒绝判绿）")
        return 1
    if FAILS:
        print(f"✗ {len(FAILS)}/{CHECKS} 条断言失败：")
        for f in FAILS:
            print(f"    - {f}")
        return 1
    print(f"✓ 全部 {CHECKS} 条断言通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
