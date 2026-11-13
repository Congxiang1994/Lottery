"""后端自检：不依赖网络、不依赖 pytest，直接跑关键回归，失败非 0 退出。

为什么要有它
------------
历史上出过两类「跑得起来但结果是错的」故障，都靠人工发现：

1. **重构漏删变量** → 线上每轮抓取抛 NameError（`"notes": notes`，2026-11-06）。
   pyflakes 查不出来（它不跟踪局部作用域的运行时可达性），只有真跑一轮才炸。
2. **鉴权改造后行为漂移** → 5 个域的 cookie 名/状态码各不相同。

用法::

    cd backend
    LOTTERY_DB_DIR=/tmp/lottery_selftest .venv/bin/python scripts/selftest.py

退出码：0 全过；1 有失败（**每项失败都会打印原因**，不做"测不到就跳过"）。
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

# 允许 `python scripts/selftest.py` 直接跑（把 backend/ 放进 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 强制隔离到临时库目录：绝不碰 /data/lottery
os.environ.setdefault("LOTTERY_DB_DIR", tempfile.mkdtemp(prefix="lottery-selftest-"))

FAILED: list[str] = []
PASSED: list[str] = []


def check(name: str, fn) -> None:
    try:
        fn()
    except Exception as e:  # noqa: BLE001 —— 自检就该把所有异常都当成失败
        FAILED.append(f"{name}: {type(e).__name__}: {e}")
        print(f"  ✗ {name} —— {type(e).__name__}: {e}")
    else:
        PASSED.append(name)
        print(f"  ✓ {name}")


# ---------------------------------------------------------------- 用例


def case_imports() -> None:
    """所有域都能 import（语法/循环依赖/模块级 NameError 一次暴露）。"""
    import importlib

    for name in ("lottery", "hanzi", "babysong", "story", "trigger", "smzdm",
                 "stats", "access", "ctshare"):
        importlib.import_module(f"app.{name}.router")
    importlib.import_module("app.main")


def case_routes_registered() -> None:
    from app.main import app

    paths = set(app.openapi()["paths"])
    required = {
        "/api/health", "/api/v1/lotteries", "/api/hanzi/list", "/api/babysong/list",
        "/api/story/list", "/api/trigger/tasks", "/api/deals/list", "/api/stats/visit",
        "/api/access/summary", "/api/ct/report",
    }
    missing = required - paths
    assert not missing, f"路由丢失: {sorted(missing)}"


def case_guard_401() -> None:
    """私有接口在无 cookie 时必须 401（不是 200/500）。"""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        for path in ("/api/trigger/tasks", "/api/story/admin/stories",
                     "/api/babysong/admin/downloads", "/api/access/summary",
                     "/api/deals/admin/config", "/api/ct/report"):
            r = c.get(path)
            assert r.status_code == 401, f"{path} 应 401，实际 {r.status_code}"


def case_auth_roundtrip() -> None:
    """密码门：错密码 401 / 对密码 200 + cookie / session 有效 / logout 失效。"""
    from fastapi.testclient import TestClient

    from app.common import password, security
    from app.main import app

    pw = "selftest-pass"
    password.set_password(pw)
    security.reset_failures()

    with TestClient(app, base_url="https://selftest") as c:
        assert c.post("/api/trigger/auth", json={"password": "wrong"}).status_code == 401
        security.reset_failures()
        r = c.post("/api/trigger/auth", json={"password": pw})
        assert r.status_code == 200, r.text
        assert c.get("/api/trigger/session").json()["valid"] is True
        assert c.post("/api/trigger/logout").status_code == 200
        assert c.get("/api/trigger/session").json()["valid"] is False


def case_smzdm_round() -> None:
    """smzdm 单轮抓取跑得通（2026-11-06 `"notes": notes` 事故的回归守卫）。"""
    from app.smzdm import scheduler, store
    from app.smzdm.crawler import Deal

    async def fake_fetch_round(**kwargs):
        return [
            Deal(
                id=990001, title="[自检] 罗技 MX Master 3S 鼠标 历史低价",
                url="https://www.smzdm.com/p/990001/", price="399", mall="京东",
                cate1="电脑数码", cate2="鼠标", tags="34天新低",
                worth=120, unworth=3, fav=88, cmt=12, hhmm="10:05",
                discount=43, reporter="selftest", feed_tags="历史低价", source="tag",
            )
        ], []

    store.init()
    scheduler.crawler.fetch_round = fake_fetch_round
    res = asyncio.run(scheduler.run_round(manual=True))
    assert isinstance(res, dict), res
    assert res.get("parsed") == 1, f"parsed 应为 1，实际 {res.get('parsed')}"
    for k in ("pages", "added", "picked", "banned", "errors", "elapsed_ms", "at"):
        assert k in res, f"返回体缺字段 {k}"
    assert "notes" not in res, "notes 字段已废弃，不该再出现"


def case_stats_visit() -> None:
    """访问统计：同一访客重复上报只加人次，不重复加人数。"""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        a = c.post("/api/stats/visit", params={"visitor_id": "selftest-a"}).json()
        b = c.post("/api/stats/visit", params={"visitor_id": "selftest-a"}).json()
        d = c.post("/api/stats/visit", params={"visitor_id": "selftest-b"}).json()
    assert b["total"] == a["total"] + 1, f"人次未递增: {a} -> {b}"
    assert b["visitors"] == a["visitors"], f"同一访客被计了两次人数: {a} -> {b}"
    assert d["visitors"] == a["visitors"] + 1, f"新访客未计人数: {a} -> {d}"


def case_password_lockout() -> None:
    """连续失败到阈值后必须进入 429 锁定，成功后解锁。"""
    from app.common import password, security

    password.set_password("selftest-lock")
    security.reset_failures()
    for _ in range(security.FAIL_THRESHOLD + 1):
        ok, _msg, status = security.verify_password("bad")
        assert not ok
    assert status == 429, f"连续失败后应 429，实际 {status}"
    security.reset_failures()
    ok, _msg, status = security.verify_password("selftest-lock")
    assert ok and status == 200, f"解锁后正确密码应通过，实际 {status}"


def case_ct_share_roundtrip() -> None:
    """CT 分享：独立口令 + 报告原样入库 + 未登录 401 + 登录后可取原文。"""
    from fastapi.testclient import TestClient

    from app.common import password as password_store
    from app.ctshare import config as ct_config
    from app.ctshare import store as ct_store
    from app.main import app

    pw = "ct-selftest-pass"
    ct_store.init()
    password_store.set_password_in(ct_config.DB_PATH, pw)
    ct_store.reset_failures()

    html = "<!doctype html><html><body><h1>自检报告</h1><img src=\"data:image/jpeg;base64,AA==\"></body></html>"
    ct_store.save_report(html, "自检报告")

    with TestClient(app, base_url="https://selftest") as c:
        # 未登录：报告接口必须 401
        for path in ("/api/ct/report", "/api/ct/report/raw", "/api/ct/meta"):
            r = c.get(path)
            assert r.status_code == 401, f"{path} 应 401，实际 {r.status_code}"
        # 错口令 401
        r = c.post("/api/ct/auth", json={"password": "wrong"})
        assert r.status_code == 401, f"错口令应 401，实际 {r.status_code}"
        ct_store.reset_failures()
        # 对口令 200 + 会话有效
        r = c.post("/api/ct/auth", json={"password": pw})
        assert r.status_code == 200, r.text
        assert c.get("/api/ct/session").json()["valid"] is True
        # 报告原样返回（逐字节相等）
        raw = c.get("/api/ct/report/raw")
        assert raw.status_code == 200
        assert raw.headers["content-type"].startswith("text/html")
        assert raw.content.decode("utf-8") == html, "报告原文被改写"
        j = c.get("/api/ct/report").json()
        assert j["html"] == html, "JSON 通道的报告原文被改写"
        # 退出后会话失效
        assert c.post("/api/ct/logout").status_code == 200
        assert c.get("/api/ct/session").json()["valid"] is False


def case_ct_password_isolated() -> None:
    """CT 分享口令必须与全站操作密码**互相独立**（改一个不影响另一个）。"""
    from app.common import password as password_store
    from app.ctshare import config as ct_config
    from app.ctshare import store as ct_store

    site_pw = "selftest-site-pw"
    ct_pw = "selftest-ct-pw"
    password_store.set_password(site_pw)
    password_store.set_password_in(ct_config.DB_PATH, ct_pw)

    assert password_store.verify(site_pw), "全站口令应校验通过"
    assert password_store.verify_in(ct_config.DB_PATH, ct_pw), "分享口令应校验通过"
    assert not password_store.verify_in(ct_config.DB_PATH, site_pw), \
        "分享口令库不应接受全站操作密码"
    assert not password_store.verify(ct_pw), "全站口令库不应接受分享口令"


def case_paths_single_source() -> None:
    """所有域库路径必须同源于 app.common.paths（LOTTERY_DB_DIR 覆盖生效）。"""
    from app.access import config as access_cfg
    from app.common.paths import DB_DIR
    from app.ctshare import config as ct_cfg
    from app.lottery.services import results_store
    from app.smzdm import config as smzdm_cfg
    from app.story import config as story_cfg
    from app.trigger import config as trigger_cfg

    for mod, name in ((access_cfg, "access"), (story_cfg, "story"),
                      (smzdm_cfg, "smzdm"), (trigger_cfg, "trigger"),
                      (ct_cfg, "ctshare")):
        p = mod.DB_PATH
        assert p.parent == DB_DIR, f"{name}.DB_PATH 不在 DB_DIR 下: {p}"
        assert p.name == f"{name}.db", f"{name}.DB_PATH 文件名不对: {p.name}"
    assert results_store.DB_PATH.parent == DB_DIR


CASES = [
    ("模块可导入", case_imports),
    ("路由已注册", case_routes_registered),
    ("私有接口未登录 401", case_guard_401),
    ("密码门往返", case_auth_roundtrip),
    ("smzdm 单轮抓取", case_smzdm_round),
    ("访问统计口径", case_stats_visit),
    ("密码失败锁定", case_password_lockout),
    ("CT 分享口令与报告往返", case_ct_share_roundtrip),
    ("CT 分享口令与全站口令隔离", case_ct_password_isolated),
    ("库路径单一真源", case_paths_single_source),
]


def main() -> int:
    print(f"库目录: {os.environ['LOTTERY_DB_DIR']}")
    for name, fn in CASES:
        check(name, fn)
    total = len(CASES)
    print(f"\n{len(PASSED)}/{total} 通过")
    if FAILED:
        print("\n失败明细：")
        for f in FAILED:
            print(" -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
