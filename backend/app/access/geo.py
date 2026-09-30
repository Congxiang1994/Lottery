"""离线 IP → 地区解析（ip2region xdb，vendored 官方 Python binding）。

设计约束（每条都来自 2026-09-30 的实测，见 docs/access-management-design.md §4.3）：

1. **绝不让服务起不来**：库缺失 / 损坏 / 加载异常 → 只记一条 WARN，地区字段留空，
   其余功能全不受影响。
2. **回环与私网不进库**：库对 `127.0.0.1` / `192.168.1.1` 返回
   `Reserved|Reserved|Reserved|0|0` —— 实测确认的脏值，必须预判短路。
3. **归一化是硬要求**（不做就会被 GROUP BY 拆成多组）：
   `0` / `Reserved` → 空串；`江苏省` → `江苏`；直辖市省=市 → 城市置空；
   超长 ISP 截断；境内 ISP `0` → 空。
4. **白捡的云厂商识别**：ISP 段出现 Tencent / Alibaba / Amazon / 云 等关键词
   → 该 IP 大概率是爬虫 / 扫描器 / 代理。
5. **查询发生在后台写入线程**（请求路径上零 IO），但仍加一把锁 ——
   维护接口的回填 / 冒烟脚本也会调它。
"""
from __future__ import annotations

import ipaddress
import logging
import threading
import time
from datetime import datetime
from typing import Any

from app.access import config

log = logging.getLogger("access.geo")

# vendored 官方 binding（Apache-2.0，纯标准库）。见 app/access/ip2region/__init__.py
try:
    from app.access.ip2region import searcher as _searcher
    from app.access.ip2region import util as _util

    _IMPORT_OK = True
except ImportError as e:  # pragma: no cover - 正常情况下不会发生
    _util = None
    _searcher = None
    _IMPORT_OK = False
    log.warning("ip2region binding 导入失败，地区解析降级为空：%s", e)

# ------------------------------------------------------------ 常量

# 省份后缀（**长的在前**，否则 `内蒙古自治区` 会被 `自治区` 剥成 `内蒙古`…其实也对，
# 但 `广西壮族自治区` 会被剥成 `广西壮族` —— 必须先匹配长后缀）
_PROV_SUFFIXES = (
    "维吾尔自治区",
    "壮族自治区",
    "回族自治区",
    "特别行政区",
    "自治区",
    "省",
    "市",
)

# 城市后缀：国内数据统一带「市」，剥掉才能与已归一化的省份同风格；
# 剥完与省份相同 → 视为直辖市，城市置空（`上海|上海市` 不该占两行）。
_CITY_SUFFIXES = ("自治州", "地区", "盟", "市")

# 国家码 → 中文名（未命中则保留 ip2region 的原文，如 `United States`）
# ⚠️ HK / MO / TW 一律按中国区域表述（内容规范）。
_COUNTRY_CN = {
    "CN": "中国", "US": "美国", "JP": "日本", "KR": "韩国", "SG": "新加坡",
    "GB": "英国", "DE": "德国", "FR": "法国", "CA": "加拿大", "AU": "澳大利亚",
    "RU": "俄罗斯", "IN": "印度", "BR": "巴西", "NL": "荷兰", "IT": "意大利",
    "ES": "西班牙", "SE": "瑞典", "CH": "瑞士", "FI": "芬兰", "NO": "挪威",
    "DK": "丹麦", "PL": "波兰", "TR": "土耳其", "TH": "泰国", "VN": "越南",
    "MY": "马来西亚", "ID": "印度尼西亚", "PH": "菲律宾", "AE": "阿联酋",
    "SA": "沙特阿拉伯", "IL": "以色列", "EG": "埃及", "ZA": "南非",
    "MX": "墨西哥", "AR": "阿根廷", "CL": "智利", "NZ": "新西兰",
    "IE": "爱尔兰", "BE": "比利时", "AT": "奥地利", "PT": "葡萄牙",
    "CZ": "捷克", "GR": "希腊", "UA": "乌克兰", "RO": "罗马尼亚",
    "HK": "中国香港", "MO": "中国澳门", "TW": "中国台湾",
}

# 云厂商 / 机房关键词（命中 → cloud=True，前端自动标「爬虫·代理」）
_CLOUD_HINTS = (
    "tencent", "alibaba", "aliyun", "alicloud", "amazon", "aws", "google",
    "microsoft", "azure", "huawei", "cloud", "ovh", "digitalocean", "linode",
    "vultr", "hosting", "server", "data center", "datacenter", "idc", "cdn",
    "腾讯", "阿里", "华为", "百度", "云",
)

# 结果缓存：同一访客反复出现，避免每条日志都走一次索引查询
_CACHE_MAX = 5000
_cache: dict[str, dict[str, Any]] = {}

# 加载状态（供 /maintenance 展示；任何失败都不抛）
_state: dict[str, Any] = {
    "v4_loaded": False,
    "v6_loaded": False,
    "v4_created_at": "",
    "v6_created_at": "",
    "v4_bytes": 0,
    "v6_bytes": 0,
    "error": "",
    "loaded_at": "",
}

_searcher_v4 = None
_searcher_v6 = None
_load_lock = threading.Lock()
_cache_lock = threading.Lock()
_loaded = False

# 空结果（未解析）
_EMPTY = {
    "country": "", "region": "", "city": "", "isp": "",
    "country_code": "", "cloud": 0, "geo_src": "none",
}


# ------------------------------------------------------------ 加载


def _header_created_at(path) -> str:
    """读 xdb header 的 createdAt（uint32 unix ts）→ 'YYYY-MM-DD'。失败返回空串。"""
    try:
        h = _util.load_header_from_file(str(path))
        ts = int(h.createdAt)
        if 0 < ts < 4102444800:  # 2100-01-01 之前才认为是有效时间戳
            return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001 - 读不出来不影响主流程
        pass
    return ""


def load() -> None:
    """加载离线库（幂等）。**任何异常只记日志，绝不冒泡** —— 服务必须能起来。"""
    global _searcher_v4, _searcher_v6, _loaded
    with _load_lock:
        if _loaded:
            return
        _loaded = True
        _state["loaded_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if not _IMPORT_OK:
            _state["error"] = "ip2region binding 不可用"
            return

        for ver, path, key in ((_util.IPv4, config.GEO_V4, "v4"), (_util.IPv6, config.GEO_V6, "v6")):
            try:
                if not path.exists():
                    log.warning("离线 IP 库缺失：%s（地区字段将留空，可用 tools/geo_update.py 下载）", path)
                    continue
                _util.verify_from_file(str(path))          # 校验 xdb 与 binding 版本匹配
                v_idx = _util.load_vector_index_from_file(str(path))
                s = _searcher.new_with_vector_index(ver, str(path), v_idx)
                if key == "v4":
                    _searcher_v4 = s
                else:
                    _searcher_v6 = s
                _state[f"{key}_loaded"] = True
                _state[f"{key}_created_at"] = _header_created_at(path)
                _state[f"{key}_bytes"] = path.stat().st_size
                log.info("离线 IP 库已加载：%s（%d 字节，数据版本 %s）",
                         path.name, _state[f"{key}_bytes"], _state[f"{key}_created_at"] or "未知")
            except Exception as e:  # noqa: BLE001 - 单个库坏了不影响另一个
                log.warning("离线 IP 库加载失败 %s：%s", path, e)
                _state["error"] = f"{path.name}: {e}"

        if not (_state["v4_loaded"] or _state["v6_loaded"]):
            log.warning("未加载任何离线 IP 库 —— 地区解析降级（不影响其他功能）")


def status() -> dict[str, Any]:
    """库状态快照（给 /maintenance 用）。"""
    return dict(_state)


def available() -> bool:
    return bool(_state["v4_loaded"] or _state["v6_loaded"])


# ------------------------------------------------------------ 归一化


def _clean(seg: str) -> str:
    """`0` / `Reserved` / 空白 → 空串（实测脏值，直接进 UI 会很难看）。"""
    s = (seg or "").strip()
    if not s or s == "0" or s.lower() == "reserved" or s.lower() == "unknown":
        return ""
    return s


def _strip_prov(s: str) -> str:
    """剥省份后缀：`江苏省`→`江苏`，`内蒙古自治区`→`内蒙古`，`重庆市`→`重庆`。"""
    for suf in _PROV_SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf):
            return s[: -len(suf)]
    return s


def _strip_city(s: str) -> str:
    """剥城市后缀：`南京市`→`南京`，`大兴安岭地区`→`大兴安岭`。"""
    for suf in _CITY_SUFFIXES:
        if s.endswith(suf) and len(s) > len(suf):
            return s[: -len(suf)]
    return s


def _clean_isp(s: str) -> str:
    """ISP：逗号前取主名 + 截断 16 字符（实测有 `Tencent Building, Kejizhongyi Avenue` 这种）。"""
    s = _clean(s)
    if not s:
        return ""
    s = s.split(",")[0].strip()
    return s[:16]


def is_non_public(ip: str) -> bool:
    """回环 / 私网 / 保留 / 链路本地 / 未指定 → True（这些查库也查不到，直接短路）。"""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    try:
        return not a.is_global
    except Exception:  # noqa: BLE001
        return a.is_private or a.is_loopback or a.is_reserved or a.is_link_local


# 「真的来自本机 / 内网」的网段。⚠️ 不能用 ``is_private`` ——
# CPython 的 ``_private_networks`` 把 RFC 5737 文档段（192.0.2/24、198.51.100/24、
# 203.0.113/24）、198.18/15、240/4 一并算作 private，而这些段**几乎只出现在
# 扫描器和伪造头里**，混进「本机」会让审计失真。
_INTERNAL_V4 = tuple(ipaddress.ip_network(n) for n in (
    "127.0.0.0/8",       # 回环
    "10.0.0.0/8",        # RFC1918
    "172.16.0.0/12",     # RFC1918
    "192.168.0.0/16",    # RFC1918
    "169.254.0.0/16",    # 链路本地
    "100.64.0.0/10",     # CGNAT（运营商内网）
))
_INTERNAL_V6 = tuple(ipaddress.ip_network(n) for n in (
    "::1/128",           # 回环
    "fc00::/7",          # ULA 私网
    "fe80::/10",         # 链路本地
))


def _non_public_label(ip: str) -> tuple[str, str]:
    """把非公网地址分成两类。**别一律叫「内网」** —— 会把扫描器伪装成本机流量。

    - 回环 / 私网 / 链路本地 / CGNAT / 未指定 → ``内网/本机``：**真来自本机或内网**
    - 其余非全局（RFC 5737 文档段、198.18/15 基准测试段、240/4 保留段）
      → ``保留地址``：**几乎只有扫描器与伪造头会发**
      （``cf-connecting-ip`` 是客户端可伪造的，这类值必须能一眼看出来）
    """
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return "", ""
    nets = _INTERNAL_V4 if a.version == 4 else _INTERNAL_V6
    if a.is_unspecified or any(a in n for n in nets):
        return "内网", "本机"
    return "保留地址", ""


def _is_cloud(isp: str) -> bool:
    low = isp.lower()
    return any(h in low for h in _CLOUD_HINTS)


# ------------------------------------------------------------ 查询


def lookup(ip: str) -> dict[str, Any]:
    """查询 IP 地区。**任何异常都被吞掉并返回空结果** —— 不冒泡、不阻塞写入线程。

    返回：``{country, region, city, isp, country_code, cloud, geo_src}``
    ``geo_src`` ∈ offline | private | none
    """
    ip = (ip or "").strip()
    if not ip:
        return dict(_EMPTY)

    # 1) 回环 / 私网 / 保留段：预判短路，根本不进库
    if is_non_public(ip):
        country, region = _non_public_label(ip)
        return {
            "country": country, "region": region, "city": "", "isp": "",
            "country_code": "", "cloud": 0, "geo_src": "private",
        }

    # 2) 进程内缓存
    with _cache_lock:
        hit = _cache.get(ip)
    if hit is not None:
        return dict(hit)

    # 3) 查库（按 IP 版本路由）
    if not _IMPORT_OK:
        return dict(_EMPTY)
    s = _searcher_v6 if ":" in ip else _searcher_v4
    if s is None:
        return dict(_EMPTY)

    try:
        raw = s.search(ip) or ""
    except Exception:  # noqa: BLE001 - 把 IPv6 传给 v4 searcher 之类
        raw = ""

    res = _parse(raw, ip)

    # 4) 写缓存（超限清一半，FIFO 近似：dict 保序）
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            for k in list(_cache.keys())[: _CACHE_MAX // 2]:
                _cache.pop(k, None)
        _cache[ip] = dict(res)
    return res


def _parse(raw: str, ip: str) -> dict[str, Any]:
    """解析 ip2region 的 5 段返回：``国家|省|城市|ISP|国家码``。"""
    parts = (raw or "").split("|")
    while len(parts) < 5:
        parts.append("")

    country_raw = _clean(parts[0])
    region = _clean(parts[1])
    city = _clean(parts[2])
    isp = _clean_isp(parts[3])
    cc = _clean(parts[4]).upper()

    if not country_raw and not region:
        return dict(_EMPTY)

    # 国家：优先用国家码映射中文名；没有码就用原文
    country = _COUNTRY_CN.get(cc) or country_raw

    # 省 / 市：境内剥后缀（境外原样，如 `California`）
    if cc == "CN" or country_raw == "中国":
        region = _strip_prov(region)
        city = _strip_city(city)

    # 直辖市 / 省市同名 → 城市置空（`上海|上海市` 不该占两行）
    if city and city == region:
        city = ""

    return {
        "country": country,
        "region": region,
        "city": city,
        "isp": isp,
        "country_code": cc[:8],
        "cloud": 1 if _is_cloud(isp) or _is_cloud(raw) else 0,
        "geo_src": "offline",
    }


# ------------------------------------------------------------ 自检（tools / 冒烟）


def selftest(ips: list[str] | None = None) -> list[tuple[str, dict[str, Any], float]]:
    """对一批已知 IP 跑一遍查询，返回 (ip, 结果, 微秒)。用于部署冒烟。"""
    load()
    samples = ips or [
        "114.114.114.114", "223.5.5.5", "8.8.8.8",
        "127.0.0.1", "192.168.1.1", "10.0.0.5",
    ]
    out = []
    for ip in samples:
        t0 = time.perf_counter()
        r = lookup(ip)
        out.append((ip, r, (time.perf_counter() - t0) * 1e6))
    return out


# 已知答案（2026-09-30 实测）。离线库换版本后 `python -m app.access.geo --check`
# 可快速对答案 —— 归一化规则一旦被上游数据形态变化打破，这里会第一时间报出来。
#
# ⚠️ region 传 ``None`` = **只校验国家、不校验省/州名**：境外条目的行政区名由
#    上游数据决定（如 8.8.8.8 的 California 来自 Google 的 ISP 注册地），
#    换库版本就会变；把它写死只会制造「假的失败」。真正该锁死的是
#    **归一化规则**（省份去「省」、直辖市折叠、文档段归「保留地址」）。
_EXPECT: dict[str, tuple[str, str | None]] = {
    "114.114.114.114": ("中国", "江苏"),
    "223.5.5.5": ("中国", "浙江"),
    "101.226.4.6": ("中国", "上海"),
    "8.8.8.8": ("美国", None),
    "129.226.0.1": ("新加坡", None),
    "127.0.0.1": ("内网", "本机"),
    "192.168.1.1": ("内网", "本机"),
    "10.1.2.3": ("内网", "本机"),
    "100.64.0.1": ("内网", "本机"),
    "::1": ("内网", "本机"),
    "203.0.113.77": ("保留地址", ""),
    "192.0.2.5": ("保留地址", ""),
}


if __name__ == "__main__":  # python -m app.access.geo [--check]
    import sys

    load()
    print("库状态：", status())
    if not available():
        print("⚠️ 未加载任何离线库 —— 地区字段将留空。用 tools/geo_update.py 下载。")

    check = "--check" in sys.argv
    bad = 0
    for ip_, res, us in selftest(list(_EXPECT)):
        exp = _EXPECT[ip_]
        ok = res["country"] == exp[0] and (exp[1] is None or res["region"] == exp[1])
        bad += 0 if ok else 1
        print(f"{'✓' if ok else '✗'} {ip_:<17} {us:9.1f}µs  "
              f"{res['country']}|{res['region']}|{res['city']}|{res['isp']}|{res['country_code']}")
    if bad:
        msg = f"⚠️ {bad} 项与预期不符（离线库数据版本变化？）"
        print(msg)
        if check:
            raise SystemExit(1)
    else:
        print("对答案全部通过。")
