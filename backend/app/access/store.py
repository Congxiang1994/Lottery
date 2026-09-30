"""访问日志存储：明细表 + IP/访客档案；内存队列 + 单后台线程批量写入。

为什么不在请求路径上直接写库
----------------------------
同步 SQLite 写在 async 路径上会阻塞事件循环。中间件只把**纯字符串处理过**的行投进
内存队列后立即返回；真正的 INSERT 由单个后台线程攒批执行（200 条或 1 秒，先到者触发）。

为什么统计一律实时 GROUP BY、不做预聚合表
-----------------------------------------
20 万行量级 SQLite 毫无压力，而预聚合表必然引入「双写不一致」——这是这类功能最常见的
bug 来源。`ip_profile` / `visitor_profile` 只存两张明细表算不出来的东西：
**首次出现时间**（明细被清理后会丢）与**人工标注**。

计数一律用 ``SUM(hits)`` 而非 ``COUNT(*)``：探测行与高频轮询行是**按分钟聚合**的，
一条行代表多次访问（见 §6.3 护栏）。
"""
from __future__ import annotations

import fcntl
import hashlib
import logging
import os
import sqlite3
import threading
from collections import deque
from datetime import date, datetime, timedelta
from typing import Any

from app.access import config, geo
from app.common.db import get_conn

log = logging.getLogger("access.store")

# 与 visit_stats.db 同一把盐 → visitor 哈希可跨库关联
# （Nav 上「N 人来访」的那个人，在访问管理里能逐个点开看）
_SALT = os.environ.get("LOTTERY_VISIT_SALT", "lottery-visit-salt")


def visitor_hash(visitor_id: str) -> str:
    return hashlib.sha256((_SALT + (visitor_id or "")).encode("utf-8")).hexdigest()


# ------------------------------------------------------------ 表结构

_SCHEMA = """
CREATE TABLE IF NOT EXISTS access_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT    NOT NULL,               -- 'YYYY-MM-DD HH:MM:SS' 服务器本地时间(+08)
    day        TEXT    NOT NULL,               -- 'YYYY-MM-DD'，按天聚合 / 按天清理
    kind       TEXT    NOT NULL DEFAULT 'api', -- api | page | probe
    feature    TEXT    NOT NULL DEFAULT '',    -- 功能域
    method     TEXT    NOT NULL DEFAULT '',
    path       TEXT    NOT NULL DEFAULT '',    -- 归一化路径（数字段 → {id}），聚合用
    raw_path   TEXT    NOT NULL DEFAULT '',    -- 原始路径
    query      TEXT    NOT NULL DEFAULT '',    -- 脱敏后的 query
    status     INTEGER NOT NULL DEFAULT 0,
    latency_ms REAL,
    resp_bytes INTEGER NOT NULL DEFAULT 0,
    ip         TEXT    NOT NULL DEFAULT '',
    country    TEXT    NOT NULL DEFAULT '',
    region     TEXT    NOT NULL DEFAULT '',    -- 省（已归一化，无「省」后缀）
    city       TEXT    NOT NULL DEFAULT '',
    isp        TEXT    NOT NULL DEFAULT '',
    cloud      INTEGER NOT NULL DEFAULT 0,     -- 云厂商 / 机房 IP → 疑似爬虫
    geo_src    TEXT    NOT NULL DEFAULT '',    -- offline | private | none
    ua_class   TEXT    NOT NULL DEFAULT '',    -- browser|mobile|bot|script|probe|unknown
    ua         TEXT    NOT NULL DEFAULT '',
    referer    TEXT    NOT NULL DEFAULT '',
    visitor    TEXT    NOT NULL DEFAULT '',    -- visitor_id 的加盐哈希（跨 IP 归并）
    hits       INTEGER NOT NULL DEFAULT 1,     -- 普通行恒 1；聚合行 = 合并条数
    is_private INTEGER NOT NULL DEFAULT 0,     -- 命中私有功能
    auth       TEXT    NOT NULL DEFAULT ''     -- 带了哪个会话 cookie（只存名，不存值）
);
CREATE INDEX IF NOT EXISTS idx_al_ts       ON access_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_day      ON access_logs (day);
CREATE INDEX IF NOT EXISTS idx_al_ip_ts    ON access_logs (ip, ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_visitor  ON access_logs (visitor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_path_day ON access_logs (path, day);
CREATE INDEX IF NOT EXISTS idx_al_feat_day ON access_logs (feature, day);
CREATE INDEX IF NOT EXISTS idx_al_kind_day ON access_logs (kind, day);

CREATE TABLE IF NOT EXISTS ip_profile (
    ip         TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    tag        TEXT NOT NULL DEFAULT '',       -- me | family | friend | bot | scan | unknown
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS visitor_profile (
    visitor    TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL DEFAULT '',
    name       TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
"""

_INSERT_SQL = """
INSERT INTO access_logs
(ts, day, kind, feature, method, path, raw_path, query, status, latency_ms, resp_bytes,
 ip, country, region, city, isp, cloud, geo_src, ua_class, ua, referer, visitor, hits,
 is_private, auth)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
"""

_ROW_KEYS = (
    "ts", "day", "kind", "feature", "method", "path", "raw_path", "query", "status",
    "latency_ms", "resp_bytes", "ip", "country", "region", "city", "isp", "cloud",
    "geo_src", "ua_class", "ua", "referer", "visitor", "hits", "is_private", "auth",
)

_EMPTY_GEO = {
    "country": "", "region": "", "city": "", "isp": "",
    "country_code": "", "cloud": 0, "geo_src": "none",
}


def init() -> None:
    """建表（幂等，多 worker 并发安全）。

    ⚠️ flock 不是可选项：gunicorn ``-w 2`` 下两个 worker 同时执行
    ``PRAGMA journal_mode=WAL`` + ``CREATE TABLE``，首次建库时必有一个抛
    ``database is locked``，启动钩子异常 → gunicorn 判定 "Worker failed to boot"
    → 整个 master 退出（2026-09-24 在 story.db 上实测踩到过）。
    """
    lock_file = None
    try:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        lock_file = open(config.DB_PATH.parent / f"{config.DB_PATH.name}.init.lock", "w")
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
    except OSError:
        lock_file = None  # 锁不可用（非常规文件系统）时退化为无锁，建表本身仍幂等
    try:
        with get_conn(config.DB_PATH) as con:
            con.executescript(_SCHEMA)
    finally:
        if lock_file is not None:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            finally:
                lock_file.close()
    # 顺手加载离线 IP 库（失败只 WARN，绝不影响启动）
    geo.load()
    _ensure_worker()


# ------------------------------------------------------------ 队列与后台写入

_queue: deque[dict[str, Any]] = deque()
_queue_lock = threading.Lock()
_worker: threading.Thread | None = None
_worker_lock = threading.Lock()
_stop = threading.Event()
_dropped = 0

# (ip, path, 分钟) → {"count": n, "row_id": id|None, "agg": bool}
# 仅后台写入线程访问，无需加锁
_agg: dict[tuple[str, str, str], dict[str, Any]] = {}


def enqueue(row: dict[str, Any]) -> None:
    """把一行投进队列并立即返回（**永不阻塞、永不抛异常**）。"""
    global _dropped
    try:
        with _queue_lock:
            if len(_queue) >= config.QUEUE_MAX:
                _queue.popleft()
                _dropped += 1
                if _dropped % 1000 == 1:
                    log.warning("access 写入队列已满，累计丢弃 %d 行", _dropped)
            _queue.append(row)
        _ensure_worker()
    except Exception as e:  # noqa: BLE001 - 日志子系统绝不拖垮业务
        log.debug("access enqueue 失败：%s", e)


def _ensure_worker() -> None:
    global _worker
    if _worker is not None and _worker.is_alive():
        return
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return
        _stop.clear()
        _worker = threading.Thread(target=_run_worker, name="access-writer", daemon=True)
        _worker.start()


def _drain(n: int) -> list[dict[str, Any]]:
    with _queue_lock:
        out: list[dict[str, Any]] = []
        while _queue and len(out) < n:
            out.append(_queue.popleft())
        return out


def _run_worker() -> None:
    """后台写入循环：攒够 BATCH_SIZE 或等 FLUSH_INTERVAL 秒（先到者触发）。"""
    while not _stop.is_set():
        batch = _drain(config.BATCH_SIZE)
        if not batch:
            _stop.wait(config.FLUSH_INTERVAL_SECONDS)
            continue
        _write_batch(batch)
    # 退出前把剩余队列冲干净
    _write_batch(_drain(1_000_000))


def shutdown() -> None:
    """进程退出时 flush 剩余队列（lifespan 的 yield 之后调用）。"""
    _stop.set()
    w = _worker
    if w is not None and w.is_alive():
        w.join(timeout=3.0)


def pending() -> int:
    with _queue_lock:
        return len(_queue)


def _write_batch(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    try:
        with get_conn(config.DB_PATH) as con:
            _write_rows(con, rows)
    except Exception as e:  # noqa: BLE001 - 写日志失败绝不能冒泡到业务
        log.warning("access 批量写入失败（%d 行已丢弃）：%s", len(rows), e)


def _agg_cutoff(minutes: list[str], fallback: str) -> str:
    """聚合状态的清理水位 = 本批**最早**行的分钟 − ``AGG_GRACE_MINUTES`` 分钟。

    🔴 绝不能改用「墙上时钟」。`_agg` 的 key 里存的是**行自身**的分钟，而
    ``now[:16]`` 是**写入时刻**的分钟。队列积压或分钟边界那一秒，行的 ts 会早于
    now，按写入时刻清理就会把仍在写入的那一分钟的状态清掉 ——
    后果是同一分钟被拆成多条聚合行，而且普通行因为计数从头开始、
    再也够不到 ``SAME_PATH_PER_MINUTE``，本该公司聚的 60 行会变成 60 条普通行。
    （2026-09-30 实测：同分钟两批 ts 落后 1 分钟 → 聚合行变 2 条 + 多出 60 条普通行。）

    取**本批最早**而不是本批最大：批次内部跨分钟时，若用最大分钟做水位，
    本批里较早的分钟会在处理前就被清掉，自己就把自己拆开了。
    """
    try:
        oldest = min(minutes)
        dt = datetime.strptime(oldest, "%Y-%m-%d %H:%M") - timedelta(
            minutes=config.AGG_GRACE_MINUTES)
        return dt.strftime("%Y-%m-%d %H:%M")
    except ValueError:  # ts 格式异常时退化为「不清理」，宁可多占内存也不拆行
        return fallback


def _write_rows(con: sqlite3.Connection, rows: list[dict[str, Any]]) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # 清理过期的聚合状态（水位见 _agg_cutoff 的 🔴 说明）
    cutoff = _agg_cutoff([(r.get("ts") or now)[:16] for r in rows], now[:16])
    for k in [k for k in _agg if k[2] < cutoff]:
        _agg.pop(k, None)

    plain: list[tuple] = []
    profiles: dict[str, str] = {}   # ip -> ts（首次出现取最早）
    vprofiles: dict[str, str] = {}

    for row in rows:
        ip = row.get("ip") or ""
        g = geo.lookup(ip) if ip else dict(_EMPTY_GEO)
        row["country"] = g["country"]
        row["region"] = g["region"]
        row["city"] = g["city"]
        row["isp"] = g["isp"]
        row["cloud"] = g["cloud"]
        row["geo_src"] = g["geo_src"]

        if ip:
            ts = row.get("ts") or now
            if ip not in profiles or ts < profiles[ip]:
                profiles[ip] = ts
        vid = row.get("visitor") or ""
        if vid:
            ts = row.get("ts") or now
            if vid not in vprofiles or ts < vprofiles[vid]:
                vprofiles[vid] = ts

        params = tuple(row.get(k) for k in _ROW_KEYS)

        # 护栏：探测行一律按 (ip, path, 分钟) 聚合；普通行超阈值也降级为聚合行
        key = (ip, row.get("path") or "", (row.get("ts") or now)[:16])
        st = _agg.get(key)
        if st is None:
            st = _agg[key] = {"count": 0, "row_id": None, "agg": row.get("kind") == "probe"}
        st["count"] += 1
        if not st["agg"] and st["count"] > config.SAME_PATH_PER_MINUTE:
            st["agg"] = True

        if st["agg"]:
            if st["row_id"] is None:
                cur = con.execute(_INSERT_SQL, params)
                st["row_id"] = cur.lastrowid
            else:
                # 聚合行：只累加 hits 并把 ts/status 更新为最近一次
                con.execute(
                    "UPDATE access_logs SET hits = hits + 1, ts = ?, day = ?, status = ? "
                    "WHERE id = ?",
                    (row.get("ts"), row.get("day"), row.get("status"), st["row_id"]),
                )
        else:
            plain.append(params)

    if plain:
        con.executemany(_INSERT_SQL, plain)

    for ip, ts in profiles.items():
        con.execute(
            "INSERT INTO ip_profile (ip, first_seen, last_seen, created_at, updated_at) "
            "VALUES (?,?,?,'','') "
            "ON CONFLICT(ip) DO UPDATE SET last_seen = excluded.last_seen",
            (ip, ts, now),
        )
    for vid, ts in vprofiles.items():
        con.execute(
            "INSERT INTO visitor_profile (visitor, first_seen, last_seen) VALUES (?,?,?) "
            "ON CONFLICT(visitor) DO UPDATE SET last_seen = excluded.last_seen",
            (vid, ts, now),
        )


# ------------------------------------------------------------ 查询工具


def _since(days: int) -> str:
    days = max(1, min(int(days or config.DEFAULT_DAYS), config.MAX_DAYS))
    return (date.today() - timedelta(days=days - 1)).isoformat()


def _limit(v: int | None, default: int = 50) -> int:
    try:
        n = int(v) if v is not None else default
    except (TypeError, ValueError):
        n = default
    return max(1, min(n, config.MAX_LIMIT))


def _auto_filter(include_auto: Any) -> tuple[str, list]:
    """默认隐藏自动化流量（script/bot），但**记录**它们 —— 见 §6.3。

    ⚠️ 不能丢弃：探测与自动化流量本身是「谁在敲我」的重要信号，
    只是不该混进主视图；前端给一个开关即可随时看全。
    """
    if str(include_auto).lower() in ("1", "true", "yes"):
        return "", []
    return " AND ua_class NOT IN ('script','bot')", []


def _rows(cur) -> list[dict[str, Any]]:
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# ------------------------------------------------------------ KPI 与趋势


def summary(days: int = 7, include_auto: Any = 0) -> dict[str, Any]:
    since = _since(days)
    today = date.today().isoformat()
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        base = f"FROM access_logs WHERE day >= ?{auto_clause}"

        def agg(where: str, params: list) -> dict[str, Any]:
            row = con.execute(
                f"SELECT COALESCE(SUM(hits),0) req, COUNT(DISTINCT ip) ips, "
                f"COUNT(DISTINCT NULLIF(visitor,'')) vis, "
                f"COALESCE(SUM(CASE WHEN kind='page' THEN hits ELSE 0 END),0) pages, "
                f"COALESCE(SUM(CASE WHEN status>=400 THEN hits ELSE 0 END),0) errs "
                f"{base} AND {where}",
                [since] + auto_params + params,
            ).fetchone()
            return {
                "requests": int(row[0]), "ips": int(row[1]), "visitors": int(row[2]),
                "pages": int(row[3]), "errors": int(row[4]),
                "error_rate": round(row[4] / row[0] * 100, 2) if row[0] else 0.0,
            }

        window = agg("1=1", [])
        today_s = agg("day = ?", [today])

        # P50 / P95 耗时（只算 api 行）
        lat = [
            r[0] for r in con.execute(
                f"SELECT latency_ms FROM access_logs WHERE day >= ?{auto_clause} "
                f"AND kind='api' AND latency_ms IS NOT NULL ORDER BY latency_ms",
                [since] + auto_params,
            ).fetchall()
        ]
        p50 = p95 = None
        if lat:
            p50 = round(lat[len(lat) // 2], 1)
            p95 = round(lat[min(len(lat) - 1, int(len(lat) * 0.95))], 1)

        row = con.execute(
            f"SELECT COALESCE(SUM(CASE WHEN kind='probe' THEN hits ELSE 0 END),0), "
            f"COALESCE(SUM(CASE WHEN cloud=1 THEN hits ELSE 0 END),0) "
            f"{base}",
            [since] + auto_params,
        ).fetchone()

        total_ips = con.execute("SELECT COUNT(*) FROM ip_profile").fetchone()[0]
        auto_hidden = 0
        if auto_clause:
            auto_hidden = int(con.execute(
                f"SELECT COALESCE(SUM(hits),0) FROM access_logs WHERE day >= ? "
                f"AND ua_class IN ('script','bot')", [since]
            ).fetchone()[0])

    return {
        "days": days,
        "today": today,
        "window": window,
        "today_stats": today_s,
        "p50_ms": p50,
        "p95_ms": p95,
        "probe_hits": int(row[0]),
        "cloud_hits": int(row[1]),
        "ips_known": int(total_ips),
        "auto_hidden": auto_hidden,
        "pending": pending(),
        "geo": geo.status(),
    }


def timeseries(days: int = 7, bucket: str = "day", metric: str = "requests",
               include_auto: Any = 0) -> dict[str, Any]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    col = {
        "requests": "COALESCE(SUM(hits),0)",
        "ips": "COUNT(DISTINCT ip)",
        "visitors": "COUNT(DISTINCT NULLIF(visitor,''))",
        "pages": "COALESCE(SUM(CASE WHEN kind='page' THEN hits ELSE 0 END),0)",
    }.get(metric, "COALESCE(SUM(hits),0)")
    key = "day" if bucket == "day" else "substr(ts,1,13)"

    with get_conn(config.DB_PATH) as con:
        rows = con.execute(
            f"SELECT {key} AS k, {col} AS v FROM access_logs "
            f"WHERE day >= ?{auto_clause} GROUP BY k ORDER BY k",
            [since] + auto_params,
        ).fetchall()

    got = {str(r[0]): int(r[1]) for r in rows}
    keys: list[str] = []
    if bucket == "day":
        d0 = date.today() - timedelta(days=max(1, int(days)) - 1)
        keys = [(d0 + timedelta(days=i)).isoformat() for i in range(int(days))]
    else:
        # 按小时：只补 24 个整点（今天），避免 N 天 × 24 个空桶
        base = date.today().isoformat()
        keys = [f"{base} {h:02d}" for h in range(24)]
        got = {k: v for k, v in got.items() if k.startswith(base)}
    return {"bucket": bucket, "metric": metric, "items": [{"k": k, "v": got.get(k, 0)} for k in keys]}


def top_paths(days: int = 7, limit: int = 20, include_auto: Any = 0) -> list[dict[str, Any]]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        return _rows(con.execute(
            f"SELECT path, MIN(method) method, COALESCE(SUM(hits),0) requests, "
            f"ROUND(AVG(latency_ms),1) avg_ms, MAX(status) max_status, "
            f"COALESCE(SUM(CASE WHEN status>=400 THEN hits ELSE 0 END),0) errors, "
            f"COUNT(DISTINCT ip) ips "
            f"FROM access_logs WHERE day >= ?{auto_clause} AND path != '' "
            f"GROUP BY path ORDER BY requests DESC LIMIT ?",
            [since] + auto_params + [_limit(limit, 20)],
        ))


def features(days: int = 7, include_auto: Any = 0) -> list[dict[str, Any]]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        rows = _rows(con.execute(
            f"SELECT feature, COALESCE(SUM(hits),0) requests, COUNT(DISTINCT ip) ips, "
            f"COUNT(DISTINCT NULLIF(visitor,'')) visitors "
            f"FROM access_logs WHERE day >= ?{auto_clause} "
            f"GROUP BY feature ORDER BY requests DESC",
            [since] + auto_params,
        ))
    for r in rows:
        r["label"] = config.FEATURE_LABELS.get(r["feature"] or "", r["feature"] or "未知")
    return rows


def geo_breakdown(days: int = 7, level: str = "region", include_auto: Any = 0) -> list[dict[str, Any]]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    col = {"country": "country", "region": "region", "city": "city"}.get(level, "region")
    # 名称回退：省市为空时退到上一级，**别一律塞进「未解析」**。
    # 典型场景：非公网 IP（保留地址）只有 country 无 region —— 按省分组时
    # 它会被算成「未解析」，看着像离线库漏了，其实是这行 IP 本身就没有省份。
    name_expr = {
        "city": "COALESCE(NULLIF(city,''), NULLIF(region,''), NULLIF(country,''))",
        "region": "COALESCE(NULLIF(region,''), NULLIF(country,''))",
    }.get(level, f"NULLIF({col},'')")
    with get_conn(config.DB_PATH) as con:
        rows = _rows(con.execute(
            f"SELECT {name_expr} AS name, COALESCE(SUM(hits),0) requests, "
            f"COUNT(DISTINCT ip) ips, COUNT(DISTINCT NULLIF(visitor,'')) visitors "
            f"FROM access_logs WHERE day >= ?{auto_clause} "
            f"GROUP BY name ORDER BY requests DESC",
            [since] + auto_params,
        ))
    for r in rows:
        r["name"] = r["name"] or "未解析"
        r["unknown"] = not bool(r["name"] and r["name"] != "未解析")
    return rows


def isp_breakdown(days: int = 7, include_auto: Any = 0) -> list[dict[str, Any]]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        rows = _rows(con.execute(
            f"SELECT CASE WHEN cloud=1 THEN '云厂商/机房' WHEN isp='' THEN '未知' ELSE isp END name, "
            f"COALESCE(SUM(hits),0) requests, COUNT(DISTINCT ip) ips "
            f"FROM access_logs WHERE day >= ?{auto_clause} GROUP BY name ORDER BY requests DESC",
            [since] + auto_params,
        ))
    return rows


def status_breakdown(days: int = 7, include_auto: Any = 0) -> dict[str, Any]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        rows = con.execute(
            f"SELECT status, COALESCE(SUM(hits),0) FROM access_logs "
            f"WHERE day >= ?{auto_clause} GROUP BY status ORDER BY status",
            [since] + auto_params,
        ).fetchall()
    groups = {"2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, "其他": 0}
    items = []
    for st, n in rows:
        st = int(st or 0)
        g = f"{st // 100}xx" if 200 <= st < 600 else "其他"
        groups[g] += int(n)
        items.append({"status": st, "count": int(n)})
    return {"groups": [{"name": k, "v": v} for k, v in groups.items() if v],
            "items": items}


def ua_breakdown(days: int = 7, include_auto: Any = 1) -> list[dict[str, Any]]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        return _rows(con.execute(
            f"SELECT COALESCE(NULLIF(ua_class,''),'unknown') name, COALESCE(SUM(hits),0) requests, "
            f"COUNT(DISTINCT ip) ips FROM access_logs WHERE day >= ?{auto_clause} "
            f"GROUP BY name ORDER BY requests DESC",
            [since] + auto_params,
        ))


# ------------------------------------------------------------ IP / 访客聚合


def list_ips(days: int = 7, limit: int = 50, offset: int = 0, sort: str = "requests",
             q: str = "", tag: str = "", include_auto: Any = 0) -> dict[str, Any]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    order = "last_seen DESC" if sort == "last_seen" else "requests DESC"
    where = f"day >= ?{auto_clause}"
    params: list[Any] = [since] + auto_params
    if q:
        where += " AND (ip LIKE ? OR region LIKE ? OR city LIKE ? OR isp LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like, like]
    # ⚠️ tag 必须进 SQL，且 total 与 items 共用同一个 where。
    # 旧实现在 rows 取完（LIMIT / OFFSET 已生效）之后才用 Python 过一遍 tag，
    # 而 total 又不带 tag 条件 —— 结果是「共 N 个 IP」但列表少几个；
    # 该页恰好不含命中行时更糟：total=2 / items=0（界面说有两个、列表全空），
    # 翻页也一并失真。（2026-09-30 实测 total=2 / items=1。）
    if tag:
        where += " AND ip IN (SELECT ip FROM ip_profile WHERE tag = ?)"
        params += [tag]

    with get_conn(config.DB_PATH) as con:
        total = int(con.execute(f"SELECT COUNT(DISTINCT ip) FROM access_logs WHERE {where}",
                                params).fetchone()[0])
        rows = _rows(con.execute(
            f"SELECT ip, MIN(ts) first_seen, MAX(ts) last_seen, "
            f"COALESCE(SUM(hits),0) requests, "
            f"COALESCE(SUM(CASE WHEN kind='page' THEN hits ELSE 0 END),0) pages, "
            f"COALESCE(SUM(CASE WHEN ua_class IN ('script','bot') THEN hits ELSE 0 END),0) auto_hits, "
            f"COUNT(DISTINCT NULLIF(visitor,'')) visitors, MAX(cloud) cloud, "
            f"MIN(NULLIF(country,'')) country, MIN(NULLIF(region,'')) region, "
            f"MIN(NULLIF(city,'')) city, MIN(NULLIF(isp,'')) isp, "
            f"MIN(NULLIF(ua_class,'')) ua_class, MIN(NULLIF(geo_src,'')) geo_src "
            f"FROM access_logs WHERE {where} GROUP BY ip "
            f"ORDER BY {order} LIMIT ? OFFSET ?",
            params + [_limit(limit, 50), max(0, int(offset or 0))],
        ))
        _attach_profiles(con, rows)
        _attach_feature_mix(con, rows, days, include_auto)
    return {"total": total, "items": rows}


def _attach_profiles(con, rows: list[dict[str, Any]]) -> None:
    ips = [r["ip"] for r in rows if r.get("ip")]
    if not ips:
        return
    ph = ",".join("?" * len(ips))
    prof = {r[0]: (r[1] or "", r[2] or "") for r in con.execute(
        f"SELECT ip, note, tag FROM ip_profile WHERE ip IN ({ph})", ips)}
    for r in rows:
        note, tag = prof.get(r["ip"], ("", ""))
        r["note"] = note
        r["tag"] = tag
        r["region_label"] = " · ".join(
            [x for x in (r.get("country"), r.get("region"), r.get("city")) if x]
        ) or ("本机/内网" if r.get("geo_src") == "private" else "")


def _attach_feature_mix(con, rows: list[dict[str, Any]], days: int, include_auto: Any) -> None:
    ips = [r["ip"] for r in rows if r.get("ip")]
    if not ips:
        return
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    ph = ",".join("?" * len(ips))
    mix: dict[str, list[dict[str, Any]]] = {}
    for ip, feat, n in con.execute(
        f"SELECT ip, feature, COALESCE(SUM(hits),0) n FROM access_logs "
        f"WHERE day >= ?{auto_clause} AND ip IN ({ph}) GROUP BY ip, feature ORDER BY n DESC",
        [since] + auto_params + ips,
    ):
        mix.setdefault(ip, []).append({"feature": feat or "other",
                                       "label": config.FEATURE_LABELS.get(feat or "", feat or "其他"),
                                       "n": int(n)})
    for r in rows:
        r["mix"] = mix.get(r["ip"], [])[:5]


def ip_detail(ip: str, days: int = 90, include_auto: Any = 0, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        head = con.execute(
            f"SELECT COALESCE(SUM(hits),0) requests, "
            f"COALESCE(SUM(CASE WHEN kind='page' THEN hits ELSE 0 END),0) pages, "
            f"MIN(ts) first_seen, MAX(ts) last_seen, "
            f"COUNT(DISTINCT NULLIF(visitor,'')) visitors, "
            f"COUNT(DISTINCT path) paths, "
            f"COALESCE(SUM(CASE WHEN ua_class IN ('script','bot') THEN hits ELSE 0 END),0) auto_hits, "
            f"MAX(cloud) cloud "
            f"FROM access_logs WHERE day >= ? AND ip = ?{auto_clause}",
            [since, ip] + auto_params,
        ).fetchone()
        if not head or not head[0]:
            return {"ip": ip, "found": False}

        loc = con.execute(
            "SELECT country, region, city, isp, geo_src FROM access_logs "
            "WHERE ip = ? AND region != '' ORDER BY ts DESC LIMIT 1", (ip,)
        ).fetchone()
        prof = con.execute("SELECT note, tag, first_seen FROM ip_profile WHERE ip = ?", (ip,)).fetchone()
        feats = _rows(con.execute(
            f"SELECT feature, COALESCE(SUM(hits),0) requests, COUNT(DISTINCT path) paths "
            f"FROM access_logs WHERE day >= ? AND ip = ?{auto_clause} "
            f"GROUP BY feature ORDER BY requests DESC", [since, ip] + auto_params))
        for f in feats:
            f["label"] = config.FEATURE_LABELS.get(f["feature"] or "", f["feature"] or "未知")
        paths = _rows(con.execute(
            f"SELECT path, MIN(method) method, COALESCE(SUM(hits),0) requests, "
            f"ROUND(AVG(latency_ms),1) avg_ms, MAX(status) max_status "
            f"FROM access_logs WHERE day >= ? AND ip = ?{auto_clause} AND path != '' "
            f"GROUP BY path ORDER BY requests DESC LIMIT 20", [since, ip] + auto_params))
        total = int(con.execute(
            f"SELECT COUNT(*) FROM access_logs WHERE day >= ? AND ip = ?{auto_clause}",
            [since, ip] + auto_params).fetchone()[0])
        timeline = _rows(con.execute(
            f"SELECT id, ts, kind, feature, method, path, status, latency_ms, ua_class, visitor, hits "
            f"FROM access_logs WHERE day >= ? AND ip = ?{auto_clause} "
            f"ORDER BY ts DESC LIMIT ? OFFSET ?",
            [since, ip] + auto_params + [_limit(limit, 100), max(0, int(offset or 0))]))

    return {
        "ip": ip, "found": True,
        "requests": int(head[0]), "pages": int(head[1]),
        "first_seen": head[2], "last_seen": head[3],
        "visitors": int(head[4]), "path_count": int(head[5]),
        "auto_hits": int(head[6]), "cloud": int(head[7] or 0),
        "country": loc[0] if loc else "", "region": loc[1] if loc else "",
        "city": loc[2] if loc else "", "isp": loc[3] if loc else "",
        "geo_src": loc[4] if loc else "", "cloud_flag": 0,
        "note": prof[0] if prof else "", "tag": prof[1] if prof else "",
        "profile_first_seen": (prof[2] if prof else "") or (head[2] or ""),
        "features": feats, "paths": paths,
        "timeline": timeline, "timeline_total": total,
    }


def list_visitors(days: int = 7, limit: int = 50, offset: int = 0, sort: str = "requests",
                  include_auto: Any = 0) -> dict[str, Any]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    order = "last_seen DESC" if sort == "last_seen" else "requests DESC"
    with get_conn(config.DB_PATH) as con:
        total = int(con.execute(
            f"SELECT COUNT(DISTINCT visitor) FROM access_logs "
            f"WHERE day >= ? AND visitor != ''{auto_clause}",
            [since] + auto_params).fetchone()[0])
        rows = _rows(con.execute(
            f"SELECT visitor, MIN(ts) first_seen, MAX(ts) last_seen, "
            f"COUNT(DISTINCT day) active_days, COALESCE(SUM(hits),0) requests, "
            f"COUNT(DISTINCT ip) ip_count, "
            f"COALESCE(SUM(CASE WHEN kind='page' THEN hits ELSE 0 END),0) pages, "
            f"COALESCE(SUM(CASE WHEN is_private=1 THEN hits ELSE 0 END),0) private_hits, "
            f"MIN(NULLIF(ua_class,'')) ua_class "
            f"FROM access_logs WHERE day >= ? AND visitor != ''{auto_clause} "
            f"GROUP BY visitor ORDER BY {order} LIMIT ? OFFSET ?",
            [since] + auto_params + [_limit(limit, 50), max(0, int(offset or 0))]))
        vids = [r["visitor"] for r in rows]
        if vids:
            ph = ",".join("?" * len(vids))
            locs = {r[0]: (r[1], r[2], r[3], r[4]) for r in con.execute(
                f"SELECT visitor, region, city, country, isp FROM ("
                f"  SELECT visitor, region, city, country, isp, "
                f"  ROW_NUMBER() OVER (PARTITION BY visitor ORDER BY ts DESC) rn "
                f"  FROM access_logs WHERE visitor IN ({ph}) AND region != ''"
                f") WHERE rn = 1", vids)}
            names = {r[0]: (r[1], r[2]) for r in con.execute(
                f"SELECT visitor, name, note FROM visitor_profile WHERE visitor IN ({ph})", vids)}
            mixes: dict[str, list[dict[str, Any]]] = {}
            for vid, feat, n in con.execute(
                f"SELECT visitor, feature, COALESCE(SUM(hits),0) n FROM access_logs "
                f"WHERE day >= ?{auto_clause} AND visitor IN ({ph}) "
                f"GROUP BY visitor, feature ORDER BY n DESC",
                [since] + auto_params + vids,
            ):
                mixes.setdefault(vid, []).append({
                    "label": config.FEATURE_LABELS.get(feat or "", feat or "其他"), "n": int(n)})
            for r in rows:
                loc = locs.get(r["visitor"])
                r["region_label"] = " · ".join([x for x in (loc[3], loc[0], loc[1]) if x]) if loc else ""
                r["name"], r["note"] = names.get(r["visitor"], ("", ""))
                r["short"] = r["visitor"][:8]
                r["mix"] = mixes.get(r["visitor"], [])[:5]
    return {"total": total, "items": rows}


def visitor_detail(visitor: str, days: int = 90, include_auto: Any = 0,
                   limit: int = 100, offset: int = 0) -> dict[str, Any]:
    since = _since(days)
    auto_clause, auto_params = _auto_filter(include_auto)
    with get_conn(config.DB_PATH) as con:
        head = con.execute(
            f"SELECT COALESCE(SUM(hits),0) requests, MIN(ts) first_seen, MAX(ts) last_seen, "
            f"COUNT(DISTINCT day) active_days, COUNT(DISTINCT ip) ip_count, "
            f"COALESCE(SUM(CASE WHEN kind='page' THEN hits ELSE 0 END),0) pages "
            f"FROM access_logs WHERE day >= ? AND visitor = ?{auto_clause}",
            [since, visitor] + auto_params).fetchone()
        if not head or not head[0]:
            return {"visitor": visitor, "found": False}
        ips = _rows(con.execute(
            f"SELECT ip, MIN(NULLIF(region,'')) region, MIN(NULLIF(city,'')) city, "
            f"MIN(NULLIF(country,'')) country, COALESCE(SUM(hits),0) requests, "
            f"MIN(ts) first_seen, MAX(ts) last_seen "
            f"FROM access_logs WHERE day >= ? AND visitor = ?{auto_clause} AND ip != '' "
            f"GROUP BY ip ORDER BY requests DESC", [since, visitor] + auto_params))
        feats = _rows(con.execute(
            f"SELECT feature, COALESCE(SUM(hits),0) requests FROM access_logs "
            f"WHERE day >= ? AND visitor = ?{auto_clause} GROUP BY feature ORDER BY requests DESC",
            [since, visitor] + auto_params))
        for f in feats:
            f["label"] = config.FEATURE_LABELS.get(f["feature"] or "", f["feature"] or "未知")
        total = int(con.execute(
            f"SELECT COUNT(*) FROM access_logs WHERE day >= ? AND visitor = ?{auto_clause}",
            [since, visitor] + auto_params).fetchone()[0])
        timeline = _rows(con.execute(
            f"SELECT id, ts, kind, feature, ip, method, path, status, hits "
            f"FROM access_logs WHERE day >= ? AND visitor = ?{auto_clause} "
            f"ORDER BY ts DESC LIMIT ? OFFSET ?",
            [since, visitor] + auto_params + [_limit(limit, 100), max(0, int(offset or 0))]))
        prof = con.execute("SELECT name, note, first_seen FROM visitor_profile WHERE visitor = ?",
                           (visitor,)).fetchone()
        for r in ips:
            r["region_label"] = " · ".join([x for x in (r["country"], r["region"], r["city"]) if x])
    return {
        "visitor": visitor, "found": True, "short": visitor[:8],
        "requests": int(head[0]), "first_seen": head[1], "last_seen": head[2],
        "active_days": int(head[3]), "ip_count": int(head[4]), "pages": int(head[5]),
        "name": prof[0] if prof else "", "note": prof[1] if prof else "",
        "ips": ips, "features": feats, "timeline": timeline, "timeline_total": total,
    }


# ------------------------------------------------------------ 明细


def _log_where(args: dict[str, Any]) -> tuple[str, list[Any]]:
    since = _since(args.get("days") or config.DEFAULT_DAYS)
    where = "day >= ?"
    params: list[Any] = [since]
    for key, col in (("kind", "kind"), ("feature", "feature"), ("ip", "ip"),
                     ("visitor", "visitor"), ("method", "method")):
        v = (args.get(key) or "").strip()
        if v:
            where += f" AND {col} = ?"
            params.append(v)
    p = (args.get("path") or "").strip()
    if p:
        where += " AND path LIKE ?"
        params.append(f"%{p}%")
    st = (args.get("status") or "").strip()
    if st:
        if st.endswith("xx"):
            where += " AND status >= ? AND status < ?"
            base = int(st[0]) * 100
            params += [base, base + 100]
        else:
            where += " AND status = ?"
            params.append(int(st))
    if str(args.get("private")).lower() in ("1", "true"):
        where += " AND is_private = 1"
    auto_clause, auto_params = _auto_filter(args.get("include_auto"))
    return where + auto_clause, params + auto_params


def list_logs(**args: Any) -> dict[str, Any]:
    where, params = _log_where(args)
    limit = _limit(args.get("limit"), 100)
    offset = max(0, int(args.get("offset") or 0))
    with get_conn(config.DB_PATH) as con:
        total = int(con.execute(
            f"SELECT COUNT(*) FROM access_logs WHERE {where}", params).fetchone()[0])
        rows = _rows(con.execute(
            f"SELECT id, ts, kind, feature, method, path, raw_path, query, status, latency_ms, "
            f"resp_bytes, ip, country, region, city, isp, cloud, geo_src, ua_class, ua, "
            f"referer, visitor, hits, is_private, auth "
            f"FROM access_logs WHERE {where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?",
            params + [limit, offset]))
    for r in rows:
        r["region_label"] = " · ".join(
            [x for x in (r.get("country"), r.get("region"), r.get("city")) if x]
        ) or ("本机/内网" if r.get("geo_src") == "private" else "")
        r["visitor_short"] = (r.get("visitor") or "")[:8]
        r["feature_label"] = config.FEATURE_LABELS.get(r.get("feature") or "", r.get("feature") or "")
    return {"total": total, "items": rows}


def export_rows(**args: Any) -> list[dict[str, Any]]:
    where, params = _log_where(args)
    with get_conn(config.DB_PATH) as con:
        rows = _rows(con.execute(
            f"SELECT ts, kind, feature, method, path, query, status, latency_ms, resp_bytes, "
            f"ip, country, region, city, isp, cloud, ua_class, ua, referer, visitor, hits, is_private "
            f"FROM access_logs WHERE {where} ORDER BY ts DESC, id DESC LIMIT ?",
            params + [config.MAX_LIMIT * 20]))
    return rows


def live(since_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
    with get_conn(config.DB_PATH) as con:
        return _rows(con.execute(
            "SELECT id, ts, kind, feature, method, path, status, latency_ms, ip, region, "
            "city, ua_class, hits, is_private FROM access_logs WHERE id > ? "
            "ORDER BY id DESC LIMIT ?", (max(0, int(since_id or 0)), _limit(limit, 200))))


# ------------------------------------------------------------ 标注


def set_ip_profile(ip: str, note: str | None = None, tag: str | None = None) -> dict[str, Any]:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(config.DB_PATH) as con:
        con.execute(
            "INSERT OR IGNORE INTO ip_profile (ip, first_seen, last_seen, created_at, updated_at) "
            "VALUES (?,?,'',?,'')", (ip, now, now))
        if note is not None:
            con.execute("UPDATE ip_profile SET note=?, updated_at=? WHERE ip=?", (note, now, ip))
        if tag is not None:
            con.execute("UPDATE ip_profile SET tag=?, updated_at=? WHERE ip=?", (tag, now, ip))
        row = con.execute("SELECT ip, first_seen, last_seen, note, tag FROM ip_profile WHERE ip=?",
                          (ip,)).fetchone()
    return {"ip": row[0], "first_seen": row[1], "last_seen": row[2], "note": row[3], "tag": row[4]}


def set_visitor_profile(visitor: str, name: str | None = None, note: str | None = None) -> dict[str, Any]:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(config.DB_PATH) as con:
        con.execute(
            "INSERT OR IGNORE INTO visitor_profile (visitor, first_seen, last_seen) VALUES (?,?,?)",
            (visitor, now, now))
        if name is not None:
            con.execute("UPDATE visitor_profile SET name=? WHERE visitor=?", (name, visitor))
        if note is not None:
            con.execute("UPDATE visitor_profile SET note=? WHERE visitor=?", (note, visitor))
        row = con.execute("SELECT visitor, first_seen, last_seen, name, note FROM visitor_profile "
                          "WHERE visitor=?", (visitor,)).fetchone()
    return {"visitor": row[0], "first_seen": row[1], "last_seen": row[2], "name": row[3], "note": row[4]}


# ------------------------------------------------------------ 维护


def maintenance() -> dict[str, Any]:
    with get_conn(config.DB_PATH) as con:
        size = config.DB_PATH.stat().st_size if config.DB_PATH.exists() else 0
        total = int(con.execute("SELECT COUNT(*) FROM access_logs").fetchone()[0])
        hits = int(con.execute("SELECT COALESCE(SUM(hits),0) FROM access_logs").fetchone()[0])
        rng = con.execute("SELECT MIN(ts), MAX(ts) FROM access_logs").fetchone()
        kinds = _rows(con.execute(
            "SELECT kind, COUNT(*) rows, COALESCE(SUM(hits),0) hits FROM access_logs GROUP BY kind"))
        days = _rows(con.execute(
            "SELECT day, COUNT(*) rows FROM access_logs GROUP BY day ORDER BY day DESC LIMIT 14"))
        ips = int(con.execute("SELECT COUNT(*) FROM ip_profile").fetchone()[0])
        visitors = int(con.execute("SELECT COUNT(*) FROM visitor_profile").fetchone()[0])
        # 覆盖率**只统计本该由离线库解析的公网 IP**。
        # ⚠️ 分母必须排掉 geo_src='private'（回环 / 私网 / 保留段）——
        # 这些是**故意跳过**查询的，算进分母等于拿「设计如此」当「解析失败」，
        # 只要有一条本机流量覆盖率就永远上不了 100%，这个指标就废了。
        geo_total = int(con.execute(
            "SELECT COUNT(DISTINCT ip) FROM access_logs "
            "WHERE ip != '' AND geo_src != 'private'").fetchone()[0])
        geo_ok = int(con.execute(
            "SELECT COUNT(DISTINCT ip) FROM access_logs "
            "WHERE ip != '' AND geo_src = 'offline'").fetchone()[0])
        geo_skipped = int(con.execute(
            "SELECT COUNT(DISTINCT ip) FROM access_logs "
            "WHERE ip != '' AND geo_src = 'private'").fetchone()[0])
    return {
        "db_path": str(config.DB_PATH),
        "db_bytes": size,
        "rows": total,
        "hits": hits,
        "first_ts": rng[0] or "",
        "last_ts": rng[1] or "",
        "kinds": kinds,
        "recent_days": days,
        "ip_profiles": ips,
        "visitor_profiles": visitors,
        "geo": geo.status(),
        "geo_ips_total": geo_total,
        "geo_ips_resolved": geo_ok,
        "geo_ips_skipped": geo_skipped,
        "geo_coverage": round(geo_ok / geo_total * 100, 1) if geo_total else 100.0,
        "keep_days": config.KEEP_DAYS,
        "pending": pending(),
        "queue_dropped": _dropped,
    }


def purge(before: str) -> dict[str, Any]:
    """按天删除**明细**（分批 1000 行/次，避免长事务锁库）。**不自动 VACUUM**。

    ⚠️ 只动 access_logs，**不动** ip_profile / visitor_profile。
    两张档案表存的正是明细算不出来的东西：**首次出现时间**（明细清掉就永远丢了）
    与**人工标注**（访客名字 / 备注）。界面对用户的承诺写在 Access.tsx 的
    「数据分布」卡片上 ——「明细保留 N 天，IP / 访客档案永久保留」，
    档案表又比明细表小几个数量级，留着的成本可以忽略。
    真正的隐私出口是 `purge_all()`（明细 + 两张档案一起清）。

    旧实现在这里跟了一条 DELETE visitor_profile（按「明细里已不存在」清孤儿），
    会把用户手写的访客名字一并抹掉，与界面文案直接矛盾
    （2026-09-30 实测：purge 前 visitor_profile=1 → purge 后 =0，而 ip_profile 保持 1）。
    """
    if not before or len(before) != 10:
        raise ValueError("before 必须是 YYYY-MM-DD")
    removed = 0
    with get_conn(config.DB_PATH) as con:
        while True:
            cur = con.execute(
                "DELETE FROM access_logs WHERE id IN "
                "(SELECT id FROM access_logs WHERE day < ? LIMIT 1000)", (before,))
            n = cur.rowcount or 0
            removed += n
            if n < 1000:
                break
    return {"removed": removed, "before": before}


def backfill(batch: int = 2000) -> dict[str, Any]:
    """geo 库更新后，回填历史行里地区为空的记录（只改内存里的样本，分批提交）。"""
    geo.load()
    if not geo.available():
        return {"updated": 0, "message": "离线库不可用，未回填"}
    updated = 0
    with get_conn(config.DB_PATH) as con:
        rows = con.execute(
            "SELECT DISTINCT ip FROM access_logs WHERE geo_src = 'none' AND ip != '' LIMIT ?",
            (int(batch),)).fetchall()
        for (ip,) in rows:
            g = geo.lookup(ip)
            if g["geo_src"] == "none":
                continue
            cur = con.execute(
                "UPDATE access_logs SET country=?, region=?, city=?, isp=?, cloud=?, geo_src=? "
                "WHERE ip=? AND geo_src='none'",
                (g["country"], g["region"], g["city"], g["isp"], g["cloud"], g["geo_src"], ip))
            updated += cur.rowcount or 0
    return {"updated": updated, "ips": len(rows)}


def purge_all() -> dict[str, Any]:
    """一键清空（隐私出口：公开站点上的 IP 属个人信息）。"""
    with get_conn(config.DB_PATH) as con:
        n = int(con.execute("SELECT COUNT(*) FROM access_logs").fetchone()[0])
        con.execute("DELETE FROM access_logs")
        con.execute("DELETE FROM ip_profile")
        con.execute("DELETE FROM visitor_profile")
    return {"removed": n}
