"""历史开奖 × 算法推荐对照矩阵（业务层，路由层只做参数校验与分页切片）。

为什么单独成模块
----------------
这段逻辑原先内联在 ``router.history_predictions`` 里，约 110 行 numpy 计算 +
SQL 调用 + 奖级换算。它违反 ``router 只做 HTTP 边界`` 的分层约定：
路由函数里既做分页切片、又做向量计票、又拼响应体，改一个口径要在两百行里找。

口径（改之前先读）
------------------
- **定位批次**：取 ``run_date <= 开奖日期`` 的最近一次每日跑批 —— 严格无未来泄漏。
  跑批数据没覆盖的历史期，``predictions = None``（前端显示「无预测数据」）。
- **共识列**：对这一批全部算法的**推荐号码**做出现次数计票，取 top-k。
  注意与 ``saved_combined`` 的「打分等权平均」不是同一口径 —— 这里只用裁剪过的
  号码字段（``batch_by_dates`` 不返回 confidence），语义直观、开销小。
- **算法列**：每个算法一行，红/蓝命中数与奖级由 ``prizes.prize_level`` 换算。
- **分类显示名**由后端给（``CATEGORIES`` 是唯一真源）。前端曾自己维护一张表，
  结果 key 对不上（signal_img / signal）导致界面直接显示英文 key，别再走回头路。
"""
from __future__ import annotations

import bisect

import numpy as np

from app.lottery.algorithms.base import CATEGORIES, normalize, pick_top
from app.lottery.prizes import prize_level
from app.lottery.services import results_store

CONSENSUS_NAME = "全算法共识"


def consensus_seed(issue: str | int) -> int:
    """tiebreak 种子唯一真源：完整期号（5/7 位均可），非数字退化为 0。"""
    text = str(issue or "")
    return int(text) if text.isdigit() else 0


def page_slice(draws: list[dict], page: int, page_size: int) -> tuple[list[dict], int]:
    """取某一页开奖（最新在前）。返回 ``(page_draws, total)``。

    分页方向与 ``/history`` 完全一致：第 1 页是最新的一批。

    ⚠️ 页码超出末页时必须返回空列表，不能靠 Python 的负索引「绕回来」：
    旧实现 ``end = total - (page-1)*page_size`` 在页码过大时会变负数，
    ``draws[start:end]`` 于是返回**几乎全部**数据（大乐透第 200 页曾返回 2903 条）。
    """
    total = len(draws)
    start = total - page * page_size
    end = total - (page - 1) * page_size
    if end <= 0:            # 页码超出末页
        return [], total
    start = max(0, start)
    end = min(end, total)
    if start >= end:
        return [], total
    return draws[start:end][::-1], total


def build_history_matrix(
    lottery: str,
    draws: list[dict],
    meta: dict,
    page: int,
    page_size: int,
) -> dict:
    """组装一页「历史开奖 × 算法推荐」对照数据。

    ``draws`` 按时间升序（与 scraper 落盘一致），返回体里的 ``items`` 最新在前。
    """
    page_draws, total = page_slice(draws, page, page_size)

    # 1) 逐期定位预测批次（run_date <= 开奖日期 的最近一次）
    # M21：一次查出全部 run_date 后在内存 bisect，避免逐期 SQL 的 N+1。
    all_dates = results_store.all_run_dates(lottery)  # 升序
    items: list[dict] = []
    wanted_dates: set[str] = set()
    for d in page_draws:
        d = dict(d)
        idx = bisect.bisect_right(all_dates, d["date"]) - 1
        d["_run_date"] = all_dates[idx] if idx >= 0 else None
        if d["_run_date"]:
            wanted_dates.add(d["_run_date"])
        items.append(d)

    # 🔴 不要在这里提前 return：跑批只覆盖最近的日期，历史期匹配不到批次时
    # ``wanted_dates`` 为空，早退会让整页返回 ``items: []``（线上第 4 页起全空白，
    # total 仍是 3529）。正确行为是照常返回开奖明细，逐期置 ``predictions: None``。
    batches = results_store.batch_by_dates(lottery, sorted(wanted_dates))

    # 3) 组装：共识列 + 算法列 + 命中/奖级
    for d in items:
        run_date = d.pop("_run_date", None)
        base = {"issue": d["issue"], "date": d["date"],
                "red": d["red"], "blue": d["blue"], "run_date": run_date}
        batch = batches.get(run_date) if run_date else None
        d.clear()
        if not batch:
            d.update({**base, "predictions": None})
            continue

        # ⚠️ 取值必须在 d.clear() 之后用 base，不能再用 d —— 上面已经清空过。
        actual_red = {int(v) for v in base["red"]}
        actual_blue = {int(v) for v in base["blue"]}

        # M31：seed 口径与 combine_latest_batch 统一为「完整期号」（一个函数真源），
        # 旧实现这里用后 6 位、首页用完整期号，同一批号在两页 tiebreak 分叉。
        seed = consensus_seed(base["issue"])

        # 共识列：走全站唯一口径 aggregate_consensus（号码计票）
        agg = aggregate_consensus(batch, meta, seed)
        cons_red = agg["red"]
        cons_blue = agg["blue"]
        hit_red = len(actual_red & set(cons_red))
        hit_blue = len(actual_blue & set(cons_blue))
        consensus = {
            "name": CONSENSUS_NAME,
            "red": cons_red, "blue": cons_blue,
            "red_hit": hit_red, "blue_hit": hit_blue,
            "prize": prize_level(lottery, hit_red, hit_blue),
        }

        algos = []
        for r in batch:
            hr = len(actual_red & {int(x) for x in r["red"]})
            hb = len(actual_blue & {int(x) for x in r["blue"]})
            algos.append({
                "id": r["id"], "name": r["name"], "category": r["category"],
                "category_name": CATEGORIES.get(r["category"], {}).get("name", r["category"]),
                "red": r["red"], "blue": r["blue"],
                "red_hit": hr, "blue_hit": hb,
                "prize": prize_level(lottery, hr, hb),
            })

        d.update({**base, "predictions": {
            "count": len(batch), "consensus": consensus, "algos": algos,
        }})

    return {"lottery": lottery, "page": page, "page_size": page_size,
            "total": total, "items": items}


def aggregate_consensus(
    results: list[dict],
    meta: dict,
    seed: int,
) -> dict:
    """把一批算法结果聚合成「全算法共识」号码。

    🔴 口径真源。``build_history_matrix``（历史对照页）与
    ``combine_latest_batch``（首页/智能推荐页）必须都走这里，否则同一个站的
    两个页面会给出两组不同的号码 —— 这正是 2026-11 之前的线上状态：

    - 历史对照页用**号码计票**（正确）；
    - 智能推荐页把 ``red_conf``（长度 = red_count，只有被选中的号）直接喂给
      ``pick_top``，触发 ``np.resize`` 循环平铺，产出等间距格点号码。

    两种口径在 38 期 OOS 上号码重合率只有 11.8%，命中率 1.211 vs 1.053。

    聚合方式：**号码出现次数计票**（每票权重 1）。不用 ``red_conf`` —— 它只覆盖
    被选中的号码，天然缺号，平铺后必然退化成格点；也不用 ``red_scores`` 平均
    （虽然新库已有该列），因为实测其 OOS 表现与计票无显著差异（见
    ``docs/lottery-hit-rate-analysis.md``），而计票口径更直观、且不依赖回填。
    """
    red_votes = np.zeros(meta["red_max"])
    blue_votes = np.zeros(meta["blue_max"])
    for r in results:
        for n in r["red"]:
            red_votes[int(n) - 1] += 1.0
        for n in r["blue"]:
            blue_votes[int(n) - 1] += 1.0

    red = pick_top(red_votes, meta["red_count"], meta["red_max"], tiebreak=seed)
    blue = pick_top(blue_votes, meta["blue_count"], meta["blue_max"],
                    tiebreak=seed + 999)
    return {
        "red": red,
        "blue": blue,
        "red_votes": [int(v) for v in red_votes],
        "blue_votes": [int(v) for v in blue_votes],
        "red_conf": [round(float(v), 4) for v in normalize(red_votes)],
        "blue_conf": [round(float(v), 4) for v in normalize(blue_votes)],
    }


def combine_latest_batch(lottery: str, meta: dict) -> dict:
    """对最新一批跑批缓存做全算法共识融合（纯缓存，不实时计算）。

    与「算法广场批量跑快算法」独立：这里永远消费每日跑批结果。
    找不到批次时返回 ``None``（路由层翻译成 404）。

    聚合口径统一走 ``aggregate_consensus``（号码计票），与历史对照页同源。
    """
    res = results_store.latest(lottery)
    if not res:
        return None

    seed = consensus_seed(res["issue_base"])
    agg = aggregate_consensus(res["results"], meta, seed)

    return {
        "lottery": lottery,
        "run_date": res["run_date"],
        "issue_base": res["issue_base"],
        "count": res["count"],
        "red": agg["red"],
        "blue": agg["blue"],
        # ⚠️ 这里给的是**全号码池**长度的计票归一化值（min-max），
        # 不是「选中号码的置信度」。前端目前没有消费这两个字段，
        # 但语义必须是全池，否则又会被误当成 top-k 的依据。
        "red_conf": agg["red_conf"],
        "blue_conf": agg["blue_conf"],
        "red_votes": agg["red_votes"],
        "blue_votes": agg["blue_votes"],
        "detail": {
            "原理": "对每日跑批缓存的全部算法推荐号码做出现次数计票，取 top-k",
            "参与算法数": res["count"],
            "run_date": res["run_date"],
            "issue_base": res["issue_base"],
        },
    }
