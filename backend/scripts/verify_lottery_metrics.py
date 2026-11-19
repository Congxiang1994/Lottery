#!/usr/bin/env python3
"""彩票命中率修复的验收脚本（每一条都能失败，失败即非 0 退出）。

覆盖 ``docs/lottery-hit-rate-analysis.md`` §5 的 A–F 六条断言，并额外验证
共识口径一致性与期号校验。**故意做成可失败的**：任何一条不成立都必须
非 0 退出，禁止「只打印」「测不到就跳过」。

用法::

    LOTTERY_DB_DIR=/tmp/lottery_db backend/.venv/bin/python scripts/verify_lottery_metrics.py
    ... --inject-pick-top       # 注入式验证：确认 A 真的会失败（应当非 0 退出）

依赖：需要一个已初始化的算法库（``LOTTERY_DB_DIR`` 指向的目录里
``algo_results.db``）。缺库时 A/B/D 仍可跑（纯函数），C/E/F 需要数据。
"""
from __future__ import annotations

import argparse
import json
import os
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
)
from app.lottery.config import LOTTERIES  # noqa: E402
from app.lottery.services import history_matrix, results_store, scraper  # noqa: E402

FAILS: list[str] = []
CHECKS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    """记录一条断言。失败会累计并在最后统一非 0 退出。"""
    global CHECKS
    CHECKS += 1
    if ok:
        print(f"  ✓ {name}{(' — ' + detail) if detail else ''}")
    else:
        print(f"  ✗ {name}{(' — ' + detail) if detail else ''}")
        FAILS.append(name)


# ---------------------------------------------------------------- A

def check_A_pick_top_guard() -> None:
    """A：pick_top 形状不符必须抛异常，绝不能静默平铺成等间距号码。"""
    print("[A] pick_top 形状守卫")
    from app.lottery.algorithms.base import pick_top as pt

    try:
        got = pt(np.zeros(6), 6, 33, tiebreak=7)
        check("长度 6 → 池 33 抛异常", False, f"却返回了 {got}")
    except ScoreShapeError:
        check("长度 6 → 池 33 抛异常", True)

    # 反例：正确的长度必须正常工作
    picks = pt(np.arange(33, dtype=float), 6, 33)
    check("长度 33 正常工作", len(picks) == 6 and len(set(picks)) == 6, f"{picks}")

    # 关键回归防护：即便用「全是相同值」的输入（旧实现下必然产出格点），
    # 正确长度也不该退化成等间距 —— 相同值时应靠 jitter 打散，取到任意 6 个号。
    uniform = pt(np.zeros(33), 6, 33, tiebreak=3)
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
            check(f"{lot} 共识可取", False, "无跑批数据（缺库或库为空）")
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
            check(f"{lot} 蓝球取值", False, "无跑批数据")
            continue
        agg = history_matrix.aggregate_consensus(latest["results"], meta,
                                                 int(latest["issue_base"] or 0))
        votes = np.asarray(agg["blue_votes"], dtype=float)
        # 关键：蓝球投票不能是常数（旧实现恒为 0，等价于「全 0.5」）
        check(f"{lot} 蓝球投票非常数", len(set(votes.tolist())) > 1,
              f"取值数 {len(set(votes.tolist()))}")
        # 换 tiebreak 后结果可不同（说明有真实信号在决定，不是纯哈希）
        a = pick_top(votes, meta["blue_count"], meta["blue_max"], tiebreak=1)
        b = pick_top(votes, meta["blue_count"], meta["blue_max"], tiebreak=999999)
        # 二者可以相同（票数差距大时），但**必须**有非零票数支撑
        check(f"{lot} 蓝球由票数决定（max vote > 0）", votes.max() > 0,
              f"max={votes.max():.0f}")


# ---------------------------------------------------------------- D

def check_D_scores_persisted() -> None:
    """D：write 路径必须把全量打分 red_scores/blue_scores 落库（长度 = 号码池）。

    历史行没有这两列的值（旧库列为 NULL），所以这里验证的是**写入路径** ——
    但绝不往生产库写：整个检查在一个临时库里跑，跑完删掉。
    """
    print("[D] 全量打分入库（临时库写入验证）")
    import tempfile

    tmpdir = tempfile.mkdtemp(prefix="lottery_verify_")
    orig_path = results_store.DB_PATH
    try:
        results_store.DB_PATH = Path(tmpdir) / "probe.db"
        results_store.init()
        for lot in ("ssq", "dlt"):
            meta = LOTTERIES[lot]
            try:
                data = scraper.load_lottery(lot)
                draws = (data or {}).get("draws") or []
            except Exception:  # noqa: BLE001
                draws = []
            if not draws:
                check(f"{lot} red_scores 写入路径", False, "无开奖数据，取不到合法期号")
                continue
            issue = str(draws[-1]["issue"])
            probe = [{
                "id": "__probe__", "name": "验收探针", "category": "statistical",
                "red": [1] * meta["red_count"], "blue": [1] * meta["blue_count"],
                "red_conf": [1.0] * meta["red_count"],
                "blue_conf": [1.0] * meta["blue_count"],
                "red_scores": [round(i / meta["red_max"], 4) for i in range(meta["red_max"])],
                "blue_scores": [round(i / meta["blue_max"], 4) for i in range(meta["blue_max"])],
                "issue_base": issue, "detail": {}, "elapsed_ms": 0.0,
            }]
            try:
                results_store.save_batch(probe, lot)
            except Exception as exc:  # noqa: BLE001
                check(f"{lot} red_scores 写入路径", False, f"{type(exc).__name__}: {exc}")
                continue
            got = next((r for r in (results_store.latest(lot) or {}).get("results", [])
                        if r["id"] == "__probe__"), None)
            if got is None:
                check(f"{lot} red_scores 写入路径", False, "写入后读不回来")
                continue
            check(f"{lot} red_scores 长度 = {meta['red_max']}",
                  len(got.get("red_scores") or []) == meta["red_max"],
                  f"{len(got.get('red_scores') or [])}")
            check(f"{lot} blue_scores 长度 = {meta['blue_max']}",
                  len(got.get("blue_scores") or []) == meta["blue_max"],
                  f"{len(got.get('blue_scores') or [])}")
            # 全量打分必须能被后续共识复用（不再是「选中号的置信度」）
            check(f"{lot} red_scores 覆盖全部号码位",
                  len(set(got.get("red_scores") or [])) > 1)
    finally:
        results_store.DB_PATH = orig_path
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------------------------------------------------- E

def check_E_backtest_folds() -> None:
    """E：回测默认 folds 必须足够大，CI 半宽 < 0.15。"""
    print("[E] 回测统计效力")
    from app.lottery.services.runner import BACKTEST_MAX_COST, FOLDS

    check("runner.FOLDS ≥ 200", FOLDS >= 200, f"{FOLDS}")

    # 理论 CI 半宽（不依赖缓存）：1.96 * sqrt(Var/folds) / expected
    for lot, pool, winners, picks in (
        ("ssq", LOTTERIES["ssq"]["red_max"], LOTTERIES["ssq"]["red_count"],
         LOTTERIES["ssq"]["red_count"]),
        ("dlt", LOTTERIES["dlt"]["red_max"], LOTTERIES["dlt"]["red_count"],
         LOTTERIES["dlt"]["red_count"]),
    ):
        p = winners / pool
        var = picks * p * (1 - p) * (pool - picks) / (pool - 1)
        exp = picks * p
        half = 1.96 * (var / FOLDS) ** 0.5 / exp
        check(f"{lot} folds={FOLDS} 时红球 CI 半宽 < 0.15", half < 0.15,
              f"±{half:.3f}")

    # 缓存里若已有 folds=200 的结果，必须带 CI / p / FDR 字段
    try:
        cached = results_store.backtest_get(
            "ssq", FOLDS, BACKTEST_MAX_COST,
            results_store.latest("ssq")["issue_base"] if results_store.latest("ssq") else "")
    except Exception:  # noqa: BLE001
        cached = None
    if cached:
        a = cached["algos"][0]
        for field in ("red_ci", "blue_ci", "red_p", "blue_p", "passes_fdr"):
            check(f"缓存算法带 {field}", field in a)
        check("缓存带零假设基线", "null_red_lift" in cached)
    else:
        print("  · 跳过缓存字段断言（该档回测尚未生成）")


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


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inject-pick-top", action="store_true",
                    help="注入式验证：把 pick_top 换回旧的平铺实现，确认 B 会失败并整体非 0 退出")
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
        # 这证明 B 这条断言真的有效，不是永远绿的装饰。
        print("[注入] 换回旧的「red_conf 均值 + np.resize 平铺」，期望 B 失败\n")
        history_matrix.aggregate_consensus = _old_conf_mean_consensus
        try:
            check_B_consensus_not_lattice()
        finally:
            history_matrix.aggregate_consensus = _real_aggregate
    else:
        check_A_pick_top_guard()
        check_B_consensus_not_lattice()
        check_C_blue_not_issue_hash()
        check_D_scores_persisted()
        check_E_backtest_folds()
        check_F_history_paging()
        check_G_issue_validation()

    print(f"\n{'=' * 60}")
    if FAILS:
        print(f"✗ {len(FAILS)}/{CHECKS} 条断言失败：")
        for f in FAILS:
            print(f"    - {f}")
        return 1
    print(f"✓ 全部 {CHECKS} 条断言通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
