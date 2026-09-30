"""访问管理 API 路由（``/api/access``）。

认证模型（与 trigger / story / babysong 完全一致）：
``POST /auth`` 校验密码（复用彩票那把操作密码 + 防爆破递增锁定）→ 签发 12h httpOnly
cookie（名 ``access_session``，与其余模块**同一签名密钥**）。
除 ``/auth`` ``/session`` ``/page`` 外全部接口校验 cookie，无效 → 401。

``/page`` 是公开埋点端点（前端 SPA 靠它上报「用户在看哪个功能页」）——
这是必须的：SPA 所有路由都回退 index.html，nginx 与中间件都分不清功能页。
"""
from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Cookie, HTTPException, Request, Response

from app.access import config, geo, middleware, store
from app.trigger.config import sign_session, verify_session

router = APIRouter(prefix="/api/access", tags=["access"])

# ------------------------------------------------------------ 认证


def _require_session(token: str | None) -> None:
    if not verify_session(token):
        raise HTTPException(status_code=401, detail="会话无效或已过期，请重新输入密码")


def _issue_cookie(response: Response) -> None:
    expires_at = datetime.now().timestamp() + config.SESSION_TTL_SECONDS
    response.set_cookie(
        key=config.COOKIE_NAME,
        value=sign_session(expires_at),
        max_age=config.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )


@router.post("/auth")
def auth(payload: dict, response: Response):
    """密码校验 + 防爆破流控（复用「运行全部」那把密码与锁定策略）。"""
    from app.lottery.services import results_store

    ok, msg, status = results_store.verify_password(str(payload.get("password", "")))
    if status == 429:
        raise HTTPException(status_code=429, detail=msg)
    if not ok:
        raise HTTPException(status_code=401, detail=msg)
    _issue_cookie(response)
    return {"ok": True, "message": "验证通过", "ttl_hours": config.SESSION_TTL_SECONDS // 3600}


@router.get("/session")
def session_status(access_session: str | None = Cookie(default=None)):
    return {"valid": verify_session(access_session)}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(config.COOKIE_NAME, path="/")
    return {"ok": True}


# ------------------------------------------------------------ 采集（公开埋点）


@router.post("/page")
def track_page(payload: dict, request: Request):
    """前端页面埋点（**无需密码**，量由后端护栏兜住）。

    只接受已知前端路由或根路径，其余丢弃 —— 防止被当成任意写入口刷脏数据。
    """
    path = (str(payload.get("path") or "")).strip()[:200]
    if not path or not path.startswith("/") or "?" in path or "#" in path:
        return {"ok": False, "message": "path 非法"}
    if path != "/" and not any(path.startswith(p) for p, _ in config.PAGE_FEATURES):
        return {"ok": False, "message": "未知路由，已丢弃"}

    now = datetime.now()
    ua = (request.headers.get("user-agent") or "")[:300]
    # 埋点自带 visitor_id（与 cookie 同源）；两者都缺时留空
    vid = str(payload.get("visitor_id") or "")
    if not vid:
        vid = request.cookies.get(config.VISITOR_COOKIE, "")
    store.enqueue({
        "ts": now.strftime("%Y-%m-%d %H:%M:%S"),
        "day": now.strftime("%Y-%m-%d"),
        "kind": "page",
        "feature": middleware.feature_of(path, "page"),
        "method": "PAGE",
        "path": middleware.normalize_path(path),
        "raw_path": path,
        "query": "",
        "status": 200,
        "latency_ms": None,
        "resp_bytes": 0,
        "ip": middleware.client_ip(request),
        "country": "", "region": "", "city": "", "isp": "", "cloud": 0, "geo_src": "",
        "ua_class": middleware.classify_ua(ua, "page"),
        "ua": ua,
        "referer": str(payload.get("referer") or request.headers.get("referer") or "")[:300],
        "visitor": store.visitor_hash(vid) if vid else "",
        "hits": 1,
        "is_private": middleware._is_private(path),
        "auth": middleware._auth_names(request),
    })
    return {"ok": True}


# ------------------------------------------------------------ 概览


@router.get("/summary")
def summary(days: int = config.DEFAULT_DAYS, include_auto: str = "0",
            access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.summary(days=days, include_auto=include_auto)


@router.get("/timeseries")
def timeseries(days: int = config.DEFAULT_DAYS, bucket: str = "day", metric: str = "requests",
               include_auto: str = "0", access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    if bucket not in ("day", "hour"):
        raise HTTPException(status_code=422, detail="bucket 只能是 day / hour")
    if metric not in ("requests", "ips", "visitors", "pages"):
        raise HTTPException(status_code=422, detail="metric 不合法")
    return store.timeseries(days=days, bucket=bucket, metric=metric, include_auto=include_auto)


@router.get("/top-paths")
def top_paths(days: int = config.DEFAULT_DAYS, limit: int = 20, include_auto: str = "0",
              access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return {"items": store.top_paths(days=days, limit=limit, include_auto=include_auto)}


@router.get("/features")
def features(days: int = config.DEFAULT_DAYS, include_auto: str = "0",
             access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return {"items": store.features(days=days, include_auto=include_auto)}


@router.get("/geo")
def geo_stats(days: int = config.DEFAULT_DAYS, level: str = "region", include_auto: str = "0",
              access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    if level not in ("country", "region", "city"):
        raise HTTPException(status_code=422, detail="level 只能是 country / region / city")
    return {"level": level, "items": store.geo_breakdown(days=days, level=level,
                                                         include_auto=include_auto)}


@router.get("/isp")
def isp_stats(days: int = config.DEFAULT_DAYS, include_auto: str = "0",
              access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return {"items": store.isp_breakdown(days=days, include_auto=include_auto)}


@router.get("/status-codes")
def status_codes(days: int = config.DEFAULT_DAYS, include_auto: str = "0",
                 access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.status_breakdown(days=days, include_auto=include_auto)


@router.get("/ua-classes")
def ua_classes(days: int = config.DEFAULT_DAYS, include_auto: str = "1",
               access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return {"items": store.ua_breakdown(days=days, include_auto=include_auto)}


# ------------------------------------------------------------ IP 聚合


@router.get("/ips")
def list_ips(days: int = config.DEFAULT_DAYS, limit: int = 50, offset: int = 0,
             sort: str = "requests", q: str = "", tag: str = "", include_auto: str = "0",
             access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.list_ips(days=days, limit=limit, offset=offset, sort=sort, q=q, tag=tag,
                          include_auto=include_auto)


@router.get("/ips/{ip}")
def ip_detail(ip: str, days: int = 90, include_auto: str = "0", limit: int = 100, offset: int = 0,
              access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.ip_detail(ip, days=days, include_auto=include_auto, limit=limit, offset=offset)


@router.put("/ips/{ip}")
def update_ip(ip: str, payload: dict, access_session: str | None = Cookie(default=None)):
    """写备注 / 标签（me | family | friend | bot | scan | unknown）。"""
    _require_session(access_session)
    tag = payload.get("tag")
    if tag is not None and tag not in ("", "me", "family", "friend", "bot", "scan", "unknown"):
        raise HTTPException(status_code=422, detail="tag 不合法")
    return store.set_ip_profile(ip, payload.get("note"), tag)


# ------------------------------------------------------------ 访客聚合


@router.get("/visitors")
def list_visitors(days: int = config.DEFAULT_DAYS, limit: int = 50, offset: int = 0,
                  sort: str = "requests", include_auto: str = "0",
                  access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.list_visitors(days=days, limit=limit, offset=offset, sort=sort,
                               include_auto=include_auto)


@router.get("/visitors/{visitor}")
def visitor_detail(visitor: str, days: int = 90, include_auto: str = "0", limit: int = 100,
                   offset: int = 0, access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.visitor_detail(visitor, days=days, include_auto=include_auto,
                                limit=limit, offset=offset)


@router.put("/visitors/{visitor}")
def update_visitor(visitor: str, payload: dict, access_session: str | None = Cookie(default=None)):
    """给访客起名 / 加备注（便于把「4 人来访」里的数字对应到具体的人）。"""
    _require_session(access_session)
    return store.set_visitor_profile(visitor, payload.get("name"), payload.get("note"))


# ------------------------------------------------------------ 明细与导出


@router.get("/logs")
def logs(days: int = config.DEFAULT_DAYS, kind: str = "", feature: str = "", ip: str = "",
         visitor: str = "", path: str = "", status: str = "", private: str = "",
         include_auto: str = "0", limit: int = 100, offset: int = 0,
         access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.list_logs(days=days, kind=kind, feature=feature, ip=ip, visitor=visitor,
                           path=path, status=status, private=private,
                           include_auto=include_auto, limit=limit, offset=offset)


@router.get("/export.csv")
def export_csv(days: int = config.DEFAULT_DAYS, kind: str = "", feature: str = "", ip: str = "",
               visitor: str = "", path: str = "", status: str = "", private: str = "",
               include_auto: str = "0", access_session: str | None = Cookie(default=None)):
    """导出当前筛选结果（UTF-8 BOM，Excel 直接打开不乱码）。"""
    _require_session(access_session)
    rows = store.export_rows(days=days, kind=kind, feature=feature, ip=ip, visitor=visitor,
                             path=path, status=status, private=private, include_auto=include_auto)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["时间", "类型", "功能", "方法", "路径", "Query", "状态", "耗时ms", "字节",
                "IP", "国家", "省", "市", "运营商", "云厂商", "客户端", "UA", "来源",
                "访客(哈希前16)", "次数", "私有"])
    for r in rows:
        w.writerow([
            r.get("ts"), r.get("kind"),
            config.FEATURE_LABELS.get(r.get("feature") or "", r.get("feature") or ""),
            r.get("method"), r.get("path"), r.get("query"), r.get("status"),
            r.get("latency_ms"), r.get("resp_bytes"), r.get("ip"), r.get("country"),
            r.get("region"), r.get("city"), r.get("isp"), "是" if r.get("cloud") else "",
            r.get("ua_class"), r.get("ua"), r.get("referer"),
            (r.get("visitor") or "")[:16], r.get("hits"),
            "是" if r.get("is_private") else "",
        ])
    data = "\ufeff" + buf.getvalue()
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="access-{stamp}.csv"'},
    )


@router.get("/live")
def live(since_id: int = 0, limit: int = 200, access_session: str | None = Cookie(default=None)):
    """增量拉取（实时滚动用）：返回 id > since_id 的记录。"""
    _require_session(access_session)
    return {"items": store.live(since_id=since_id, limit=limit)}


# ------------------------------------------------------------ 维护


@router.get("/maintenance")
def maintenance(access_session: str | None = Cookie(default=None)):
    _require_session(access_session)
    return store.maintenance()


@router.post("/maintenance/purge")
def purge(payload: dict, access_session: str | None = Cookie(default=None)):
    """按天删除明细（分批 1000 行/次，避免长事务锁库）。"""
    _require_session(access_session)
    before = str(payload.get("before") or "").strip()
    try:
        return store.purge(before)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/maintenance/backfill")
def backfill(payload: dict | None = None,
             access_session: str | None = Cookie(default=None)):
    """离线库更新后回填历史行里地区为空的记录。"""
    _require_session(access_session)
    batch = int((payload or {}).get("batch") or 2000)
    return store.backfill(batch=batch)


@router.post("/maintenance/purge-all")
def purge_all(access_session: str | None = Cookie(default=None)):
    """一键清空（公开站点上的 IP 属个人信息 —— 给一个随时能执行的隐私出口）。"""
    _require_session(access_session)
    return store.purge_all()


@router.get("/geo-status")
def geo_status(access_session: str | None = Cookie(default=None)):
    """离线库状态（页面缺地区数据时用来判断「是库没装」还是「真没数据」）。"""
    _require_session(access_session)
    return geo.status()
