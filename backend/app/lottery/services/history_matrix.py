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

import numpy as np

from app.lottery.algorithms.base import CATEGORIES, normalize, pick_top
from app.lottery.prizes import prize_level
from app.lottery.services import results_store

CONSENSUS_NAME = "全算法共识"


def page_slice(draws: list[dict], page: int, page_size: int) -> tuple[list[dict], int]:
    """取某一页开奖（最新在前）。返回 ``(page_draws, total)``。

    分页方向与 ``/history`` 完全一致：第 1 页是最新的一批。
    """
    total = len(draws)
    start = max(0, total - page * page_size)
    end = total - (page - 1) * page_size
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
    items: list[dict] = []
    wanted_dates: set[str] = set()
    for d in page_draws:
        d = dict(d)
        run = results_store.runs_before(lottery, d["date"], limit=1)
        d["_run_date"] = run[0] if run else None
        if d["_run_date"]:
            wanted_dates.add(d["_run_date"])
        items.append(d)

    if not wanted_dates:
        return {"lottery": lottery, "page": page, "page_size": page_size,
                "total": total, "items": []}

    # 2) 批量取整批算法结果（一次 SQL，避免逐期查询）
    batches = results_store.batch_by_dates(lottery, sorted(wanted_dates))

    # 3) 组装：共识列 + 算法列 + 命中/奖级
    seed_base = 0
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
        seed_base += 1
        seed = int(str(base["issue"])[-6:] or seed_base)

        red_votes = np.zeros(meta["red_max"])
        blue_votes = np.zeros(meta["blue_max"])
        for r in batch:
            for n in r["red"]:
                red_votes[int(n) - 1] += 1.0
            for n in r["blue"]:
                blue_votes[int(n) - 1] += 1.0

        cons_red = pick_top(red_votes, meta["red_count"], meta["red_max"], tiebreak=seed)
        cons_blue = pick_top(blue_votes, meta["blue_count"], meta["blue_max"],
                             tiebreak=seed + 999)
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


def combine_latest_batch(lottery: str, meta: dict) -> dict:
    """对最新一批跑批缓存的全部算法打分做等权平均（纯缓存，不实时计算）。

    与「算法广场批量跑快算法」独立：这里永远消费每日跑批结果。
    找不到批次时返回 ``None``（路由层翻译成 404）。口径与前端展示的
    「融合 N 个算法 · 等权平均」一致：confidence 先按算法等权平均，再取 top-k。
    """
    res = results_store.latest(lottery)
    if not res:
        return None

    red_mean = np.mean([r["red_conf"] for r in res["results"]], axis=0)
    blue_mean = np.mean([r["blue_conf"] for r in res["results"]], axis=0)
    seed = int(res["issue_base"] or 0)
    red = pick_top(red_mean, meta["red_count"], meta["red_max"], tiebreak=seed)
    blue = pick_top(blue_mean, meta["blue_count"], meta["blue_max"], tiebreak=seed + 999)

    return {
        "lottery": lottery,
        "run_date": res["run_date"],
        "issue_base": res["issue_base"],
        "count": res["count"],
        "red": red,
        "blue": blue,
        # ⚠️ 与改造前逐位一致：原来用 base.normalize（min-max 到 [0,1]），
        # 不是「除以最大值」。换归一化方式会改变前端热力图的相对亮度。
        "red_conf": [round(float(v), 4) for v in normalize(red_mean)],
        "blue_conf": [round(float(v), 4) for v in normalize(blue_mean)],
        "detail": {
            "原理": "对每日跑批缓存的全部算法打分等权平均（非实时计算）",
            "参与算法数": res["count"],
            "run_date": res["run_date"],
            "issue_base": res["issue_base"],
        },
    }
