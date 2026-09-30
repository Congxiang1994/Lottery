"""访问日志采集中间件 —— 保持**极薄**。

请求路径上只做纯字符串处理（IP 提取 / UA 分类 / 功能域映射 / 路径归一化 / query 脱敏），
一行不写库、不做 IO、不查地理库：

  · 地区解析 → 交给后台写入线程（store._write_rows 里调 geo.lookup）
  · 落库     → 交给内存队列 + 批量 flush（store.enqueue）

这样即使日志子系统彻底挂掉，业务请求也只会「少记一条」，绝不因此变慢或报错。

采集点的选择见 docs/access-management-design.md §3：nginx 日志拿不到真实 IP
（CF Tunnel 下全是 127.0.0.1），且 SPA 路由无法区分功能页 —— 必须放应用层。
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, unquote, urlencode

from app.access import config, store

log = logging.getLogger("access.middleware")

# 路径归一化：数字段 / UUID 段 → {id}（聚合用；raw_path 保留原样）
_RE_NUM_SEG = re.compile(r"/\d+(?=/|$)")
_RE_UUID_SEG = re.compile(
    r"/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=/|$)")

# 自动化 / 命令行客户端
_RE_SCRIPT = re.compile(
    r"curl|wget|python-requests|python-urllib|httpx|aiohttp|go-http-client|okhttp|"
    r"java/|libwww|scrapy|headlesschrome|axios|node-fetch|undici",
    re.I,
)
_RE_BOT = re.compile(r"bot|crawler|spider|crawl|slurp|facebookexternalhit|preview", re.I)
_RE_MOBILE = re.compile(r"mobile|iphone|android|ipad|ipod|harmonyos", re.I)


# ------------------------------------------------------------ 提取


def client_ip(request) -> str:
    """真实访客 IP。优先级见 §3.3。

    ⚠️ 取 XFF 必须取**首段**：nginx 的 ``$proxy_add_x_forwarded_for``
    会把自己的 ``$remote_addr``（隧道下是 127.0.0.1）追加在后面。
    """
    ip = (request.headers.get("cf-connecting-ip") or "").strip()
    if not ip:
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            ip = xff.split(",")[0].strip()
    if not ip:
        ip = request.client.host if request.client else ""
    return ip[:45]


def normalize_path(path: str) -> str:
    p = _RE_UUID_SEG.sub("/{id}", path)
    return _RE_NUM_SEG.sub("/{id}", p)[:200]


def sanitize_query(qs: str) -> str:
    """query 脱敏：密钥类参数值一律 ***（见 §10 风险 13）。"""
    if not qs:
        return ""
    try:
        pairs = parse_qsl(qs, keep_blank_values=True)
    except Exception:  # noqa: BLE001 - 畸形 query 直接丢弃
        return ""
    out = []
    for k, v in pairs:
        if k.lower() in config.SECRET_QUERY_KEYS:
            out.append((k, "***"))
        else:
            out.append((k, v[:60]))
    try:
        return urlencode(out)[:200]
    except Exception:  # noqa: BLE001
        return ""


def classify_ua(ua: str, kind: str) -> str:
    if kind == "probe":
        return "probe"
    u = ua or ""
    if _RE_BOT.search(u):
        return "bot"
    if _RE_SCRIPT.search(u):
        return "script"
    if _RE_MOBILE.search(u):
        return "mobile"
    if "mozilla" in u.lower():
        return "browser"
    return "unknown"


def feature_of(path: str, kind: str) -> str:
    if kind == "probe":
        return "probe"
    if kind == "api":
        for prefix, feat in config.API_FEATURES:
            if path.startswith(prefix):
                return feat
        return "other"
    if path == "/":
        return "portal"
    for prefix, feat in config.PAGE_FEATURES:
        if path.startswith(prefix):
            return feat
    return "portal"


def _is_private(path: str) -> int:
    return 1 if any(path.startswith(p) for p in config.PRIVATE_PREFIXES) else 0


def _auth_names(request) -> str:
    """只记录「带了哪个会话 cookie 名」，**绝不记值**。"""
    try:
        ck = request.cookies
    except Exception:  # noqa: BLE001
        return ""
    return ",".join(n for n in config.SESSION_COOKIES if n in ck)[:64]


def _visitor(request) -> str:
    """访客标识：前端写进 cookie 的 UUID → 即时加盐哈希（原文不落库）。"""
    try:
        vid = request.cookies.get(config.VISITOR_COOKIE, "")
    except Exception:  # noqa: BLE001
        return ""
    return store.visitor_hash(vid) if vid else ""


# ------------------------------------------------------------ 判定


def _ignored(path: str) -> bool:
    if any(path.startswith(p) for p in config.IGNORE_PREFIXES):
        return True
    return path.lower().endswith(config.STATIC_EXT)


def _is_spa_navigation(path: str, request) -> bool:
    """浏览器在 SPA 路由上的文档请求 → **不记**（页面粒度由前端埋点负责，避免重复）。

    判据：GET + Accept 含 text/html + 路径是已知前端路由或根路径。
    这样 `/.env`、`/wp-login.php`（Accept 也常是 text/html）不会被误判成页面导航，
    而是落到 probe —— 正是我们想要的「有人在扫我」的信号。
    """
    if request.method != "GET":
        return False
    if not path or path == "/":
        return "text/html" in request.headers.get("accept", "")
    if "." in path.rsplit("/", 1)[-1]:
        return False
    if "text/html" not in request.headers.get("accept", ""):
        return False
    return any(path.startswith(p) for p, _ in config.PAGE_FEATURES)


def _kind(path: str, request) -> str | None:
    if path.startswith("/api/"):
        return "api"
    if _is_spa_navigation(path, request):
        return None
    return "probe"


def _resp_bytes(response) -> int:
    try:
        return int(response.headers.get("content-length") or 0)
    except (TypeError, ValueError):
        return 0


# ------------------------------------------------------------ 中间件


def _build_row(request, status: int, latency_ms: float, resp_bytes: int) -> dict[str, Any] | None:
    raw_path = unquote(request.url.path or "")[:200]
    kind = _kind(raw_path, request)
    if kind is None:
        return None
    now = datetime.now()
    ua = (request.headers.get("user-agent") or "")[:300]
    return {
        "ts": now.strftime("%Y-%m-%d %H:%M:%S"),
        "day": now.strftime("%Y-%m-%d"),
        "kind": kind,
        "feature": feature_of(raw_path, kind),
        "method": request.method[:10],
        "path": normalize_path(raw_path),
        "raw_path": raw_path,
        "query": sanitize_query(request.url.query or ""),
        "status": int(status or 0),
        "latency_ms": round(latency_ms, 2),
        "resp_bytes": resp_bytes,
        "ip": client_ip(request),
        # 地区字段由后台写入线程补全（此处留空）
        "country": "", "region": "", "city": "", "isp": "", "cloud": 0, "geo_src": "",
        "ua_class": classify_ua(ua, kind),
        "ua": ua,
        "referer": (request.headers.get("referer") or "")[:300],
        "visitor": _visitor(request),
        "hits": 1,
        "is_private": _is_private(raw_path),
        "auth": _auth_names(request),
    }


async def access_logger(request, call_next):
    """采集入口。**任何时候都不得影响业务响应**。"""
    try:
        path = unquote(request.url.path or "")
    except Exception:  # noqa: BLE001
        path = request.url.path or ""
    if _ignored(path):
        return await call_next(request)

    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        # 兜底：把「业务抛异常」也记一条 500（否则这类请求在明细里完全消失）
        try:
            store.enqueue(_build_row(request, 500, (time.perf_counter() - start) * 1000, 0))
        except Exception:  # noqa: BLE001
            pass
        raise

    try:
        row = _build_row(request, response.status_code, (time.perf_counter() - start) * 1000,
                         _resp_bytes(response))
        if row is not None:
            store.enqueue(row)
    except Exception as e:  # noqa: BLE001 - 记日志失败绝不影响响应
        log.debug("access 采集失败：%s", e)
    return response
