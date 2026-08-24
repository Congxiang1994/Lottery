"""算法自检脚本：逐个执行全部算法，输出耗时、命中的号码与异常。

用法：
    python scripts/check_algos.py            # 双色球全量
    python scripts/check_algos.py dlt        # 大乐透
    python scripts/check_algos.py ssq quick  # 只跑 cost<=2 的快算法
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.lottery.algorithms import REGISTRY, catalog, engine_context, run_one  # noqa: E402
from app.lottery.config import LOTTERIES  # noqa: E402
from app.lottery.services import scraper  # noqa: E402


def main() -> int:
    lottery = sys.argv[1] if len(sys.argv) > 1 else "ssq"
    quick = len(sys.argv) > 2 and sys.argv[2] == "quick"

    data = scraper.load_lottery(lottery)
    if not data:
        print(f"缺少 {lottery} 数据，请先运行 python -m app.lottery.services.scraper")
        return 1
    draws = data["draws"]
    ctx = engine_context(lottery, draws, LOTTERIES[lottery])
    cat = catalog()
    print(f"彩种={lottery} 期数={len(draws)} 最新={draws[-1]['issue']}({draws[-1]['date']})")
    print(f"注册算法 {cat['total']} 个，分类 {len(cat['categories'])} 个\n")

    fails: list[tuple[str, str]] = []
    slow: list[tuple[str, float]] = []
    by_cat: dict[str, list] = {}
    for m in REGISTRY.values():
        if quick and m.cost > 2:
            continue
        by_cat.setdefault(m.category, []).append(m)

    total_t = time.perf_counter()
    for cat_key, metas in by_cat.items():
        print(f"── {cat_key} ({len(metas)}) " + "─" * 40)
        for m in metas:
            r = run_one(ctx, m.id)
            err = r["detail"].get("error") if isinstance(r["detail"], dict) else None
            flag = "✗" if err else "✓"
            print(f" {flag} {m.id:<18} {r['elapsed_ms']:>8.1f}ms  "
                  f"红 {r['red']}  蓝 {r['blue']}")
            if err:
                fails.append((m.id, err))
            if r["elapsed_ms"] > 1500:
                slow.append((m.id, r["elapsed_ms"]))
        print()

    print(f"总耗时 {time.perf_counter() - total_t:.1f}s")
    if slow:
        print("\n慢算法(>1.5s)：")
        for i, ms in sorted(slow, key=lambda kv: -kv[1]):
            print(f"  {i:<20} {ms:.0f}ms")
    if fails:
        print(f"\n失败 {len(fails)} 个：")
        for i, e in fails:
            print(f"  {i:<20} {e}")
        return 2
    print("\n全部算法执行成功 ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
