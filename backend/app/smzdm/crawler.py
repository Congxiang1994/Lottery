"""SMZDM 好价抓取与解析（双入口）。

两个入口，各管一件事（2026-10-29 实测后确定，改前先复读）
--------------------------------------------------------
- ``/jingxuan/pN/``（精选流，**时间序**）= 主入口，管「快」。
  每页 20 条、翻页有效、上架时分严格倒序、判据 20/20 齐全。
  新好价发布后几分钟内就出现在这里 → 决定「进库延迟」。
- ``/``（首页推荐流，**算法序**）= 兜底入口，只抓 1 页，管「全」。
  能上首页的都是热度攒够的（实测发现延迟中位 181 分钟），
  正好回收「在精选流窗口里滑掉、但后来被值友顶起来」的那批。
  ⚠️ 它的 `/pN/` 分页已失效 —— p2~p7 每页都返回同一屏（相邻页重叠 13~17 条），
  所以**只抓第 1 页**，多抓纯粹浪费风控额度。

为什么都不抓详情页
------------------
列表卡片的 HTML 里已经带齐全部判据：值、不值、收藏数、评论数、价格、
一级分类、卡片标签、上架时分。详情页（单条 300KB~1MB）只有正文，
没有额外的「历史低价 / 绝对值」标记 —— 抓详情是 20 倍的流量换零信息。

风控
----
- 令牌桶：任意两次请求至少间隔 MIN_REQUEST_INTERVAL_SECONDS
- 命中验证码（响应体是 1.6KB 的 TCaptcha 壳页）→ 抛 `Banned`，调用方退避
- 验证码判定用「体积 + 特征串」双条件，因为该壳页 HTTP 状态码仍是 200
"""
from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

from app.smzdm.config import (
    BASE_URL,
    BAN_BACKOFF_SECONDS,
    HOME_PAGES_PER_ROUND,
    HOME_PATH,
    HTTP_TIMEOUT_SECONDS,
    JINGXUAN_PATH,
    MIN_REQUEST_INTERVAL_SECONDS,
    PAGES_PER_ROUND,
    USER_AGENT,
)


class Banned(Exception):
    """命中反爬验证码。调用方应退避 BAN_BACKOFF_SECONDS 后再试。"""


@dataclass
class Deal:
    """列表卡片解析后的一条好价。"""

    id: int
    title: str
    url: str
    price: str = ""
    mall: str = ""
    cate1: str = ""
    cate2: str = ""
    tags: str = ""
    img: str = ""
    worth: int = 0
    unworth: int = 0
    fav: int = 0
    cmt: int = 0
    hhmm: str = ""

    @property
    def worth_pct(self) -> float:
        """值率（%）。无人打分时返回 0 —— 0 分样本不该被当成「100% 值」。"""
        total = self.worth + self.unworth
        if total <= 0:
            return 0.0
        return round(self.worth * 100.0 / total, 1)

    def to_row(self, now: str) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "price": self.price,
            "mall": self.mall,
            "cate1": self.cate1,
            "cate2": self.cate2,
            "tags": self.tags,
            "img": self.img,
            "worth": self.worth,
            "unworth": self.unworth,
            "fav": self.fav,
            "cmt": self.cmt,
            "worth_pct": self.worth_pct,
            "hhmm": self.hhmm,
            "last_seen": now,
        }


# ---------------------------------------------------------------- 限速与封禁状态

_last_request_mono: float = 0.0
_banned_until_mono: float = 0.0
_last_error: str = ""
_lock = asyncio.Lock()


def ban_remaining_seconds() -> int:
    """剩余退避秒数（0 表示未处于封禁期）。"""
    left = _banned_until_mono - time.monotonic()
    return max(0, int(left))


def mark_banned(reason: str = "") -> None:
    global _banned_until_mono, _last_error
    _banned_until_mono = time.monotonic() + BAN_BACKOFF_SECONDS
    _last_error = reason or "命中反爬验证码"


def clear_ban() -> None:
    """手动解除退避（管理页「我已处理好，继续抓」）。"""
    global _banned_until_mono
    _banned_until_mono = 0.0


def health() -> dict[str, Any]:
    return {
        "banned": ban_remaining_seconds() > 0,
        "ban_remaining_seconds": ban_remaining_seconds(),
        "last_error": _last_error,
    }


async def _throttle() -> None:
    """全局最小间隔：距离上次请求不足间隔就补 sleep。"""
    global _last_request_mono
    gap = time.monotonic() - _last_request_mono
    wait = MIN_REQUEST_INTERVAL_SECONDS - gap
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request_mono = time.monotonic()


def looks_blocked(body: str, status: int) -> bool:
    """判定响应是否为反爬壳页。

    实测特征：HTTP 200 + 约 1.6KB + 内含 `TCaptcha.js` 与 `__captcha` 的 seqid。
    正常列表页 1.2MB、详情页 300KB+，体积差三个数量级，不会误判。
    """
    if status == 202:
        return True
    if len(body) > 60_000:
        return False
    return ("TCaptcha" in body) or ("WafCaptcha" in body) or ("__captcha" in body)


def _page_url(kind: str, page: int) -> str:
    """拼目标页 URL。

    kind="jingxuan"：``/jingxuan/``、``/jingxuan/p2/`` ……（翻页有效且时间序）
    kind="home"    ：只支持第 1 页。``/p2/`` 起的首页分页返回的是同一屏内容，
                     抓了也不多一条，还会白占风控额度（2026-10-29 实测）。
    """
    if kind == "home":
        return f"{BASE_URL}{HOME_PATH}"
    if page <= 1:
        return f"{BASE_URL}{JINGXUAN_PATH}/"
    return f"{BASE_URL}{JINGXUAN_PATH}/p{page}/"


async def fetch_page(
    page: int, cookie: str = "", ua: str = "", kind: str = "jingxuan"
) -> str:
    """抓一页列表，返回 HTML。

    Args:
        kind: "jingxuan"（精选流，时间序）或 "home"（首页推荐流，仅第 1 页）

    Raises:
        Banned: 命中验证码或 202 挑战
        httpx.HTTPError: 网络层错误
    """
    if ban_remaining_seconds() > 0:
        raise Banned(f"仍处于退避期，剩余 {ban_remaining_seconds()} 秒")

    url = _page_url(kind, page)
    headers = {
        "User-Agent": ua or USER_AGENT,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,*/*;q=0.8"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": f"{BASE_URL}/",
    }
    if cookie:
        headers["Cookie"] = cookie

    async with _lock:
        await _throttle()
        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            resp = await client.get(url, headers=headers)
    body = resp.text or ""
    if looks_blocked(body, resp.status_code):
        mark_banned(
            f"{kind} 第 {page} 页返回反爬页（HTTP {resp.status_code}，{len(body)} 字节）"
        )
        raise Banned(_last_error)
    if resp.status_code != 200:
        raise httpx.HTTPStatusError(
            f"HTTP {resp.status_code}", request=resp.request, response=resp
        )
    return body


# ---------------------------------------------------------------- 解析

# 卡片分隔符：每张卡以 class="feed-block z-hor-feed" 开头
_CARD_SPLIT = re.compile(r'class="feed-block z-hor-feed"')
# 「是不是好价」的判据。实测同一篇内容会渲染两张卡：一张文章卡（无 channel、
# 无值按钮）、一张好价卡（channel=youhui、有 price-btn-up），且**两者 id 相同**。
# 必须先按这个判据过滤再去重 —— 否则文章卡先入表，真好价会被 `id in seen` 挤掉。
# 症状很隐蔽：标题对、价格和商城却是空的。
_RE_YOULHUI = re.compile(r"'channel':'youhui'")
_RE_ID = re.compile(r'smzdm\.com/p/(\d+)/')
_RE_TITLE = re.compile(
    r'<h5 class="feed-block-title[^"]*">\s*<a[^>]*>\s*(.*?)\s*</a>', re.S
)
# 价格：⚠️ 两个入口的 DOM 结构不同 ——
#   首页    ：<div class="z-highlight"><a href>8.45元（需用券）</a></div>
#   精选流  ：<a class="z-highlight" href>99元</a>          ← 自己就是那个带 class 的元素
# 只认「div + 内部 a」的写法，精选流的价格全部解析为空（不报错，卡片上就是一片空白，
# 2026-10-29 实测 59/77 条空价格才发现）。所以这里把 class 与 `<a>` 都做成可选。
_RE_PRICE = re.compile(
    r'class="z-highlight[^"]*"[^>]*>\s*(?:<a[^>]*>\s*)?([^<]{1,60})\s*<', re.S
)
# 分类：⚠️ 两个入口的键名不同 —— 首页是中文键 `'1级分类'`，精选流是 `'cate_level1'`。
# 只认一套的话另一个入口的条目 cate1 会全空，品类加权（cate_hit）直接失效，
# 而且不报错、不告警 —— 页面上只是「关注」标记悄悄消失。两套都要认。
_RE_CATE1 = re.compile(r"'1级分类':'([^']*)'")
_RE_CATE1_ALT = re.compile(r"'cate_level1':'([^']*)'")
_RE_CATE2 = re.compile(r"'2级分类':'([^']*)'")
_RE_CATE2_ALT = re.compile(r"'cate_level2':'([^']*)'")
_RE_MALL = re.compile(r"'mall_name':'([^']*)'")
# 值 / 不值：图标后面紧跟数字，是最精确的锚点（同卡片内还有 voted-wrap「已打分」等干扰）
_RE_WORTH = re.compile(r'icon-zhi-o-thin"></i><span>(\d+)</span>')
_RE_UNWORTH = re.compile(r'icon-buzhi-o-thin"></i><span>(\d+)</span>')
# 收藏 / 评论：title 属性里直接写了数字，比数 DOM 稳
_RE_FAV = re.compile(r'title="收藏数\s*(\d+)"')
_RE_CMT = re.compile(r'title="评论数\s*(\d+)"')
# 上架时分，如「12:01」
_RE_HHMM = re.compile(r'class="feed-block-extras">\s*(\d{2}:\d{2})')
# 商品缩略图：卡片头部的 img（`_d200.jpg` 后缀本身就是 200px 版本，不用再改）
_RE_IMG = re.compile(r'class="z-feed-img">\s*<a[^>]*>\s*<img[^>]*?src="([^"]+)"', re.S)
# 老版卡片 img 在 a 外层，补一条宽松兜底
_RE_IMG_LOOSE = re.compile(r'<img[^>]*?src="(https?://[^"]*zdmimg\.com[^"]*)"')
# 卡片标签，如「价格低于618」「家居清洁热度Top8」
_RE_TAG_BLOCK = re.compile(r'<span class="feed-block-tags">(.*?)</span>', re.S)
_RE_TAG_ITEM = re.compile(r'<i[^>]*>([^<]{1,20})</i>')


def _strip_tags(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s).strip()


def parse_list_page(html: str) -> list[Deal]:
    """把一页列表 HTML 解析成 Deal 列表。解析失败的卡片跳过（不猜、不补）。"""
    deals: list[Deal] = []
    seen: set[int] = set()
    for raw in _CARD_SPLIT.split(html)[1:]:
        # 先剔非好价卡（文章/推荐位），再做 id 去重 —— 顺序不能反，理由见 _RE_YOULHUI
        if not _RE_YOULHUI.search(raw):
            continue
        m_id = _RE_ID.search(raw)
        if not m_id:
            continue
        aid = int(m_id.group(1))
        if aid in seen:
            continue
        m_title = _RE_TITLE.search(raw)
        if not m_title:
            continue
        title = _strip_tags(m_title.group(1))
        if not title:
            continue
        seen.add(aid)

        def num(rx: re.Pattern[str], default: int = 0) -> int:
            mm = rx.search(raw)
            if not mm:
                return default
            try:
                return int(mm.group(1))
            except ValueError:
                return default

        tag_block = _RE_TAG_BLOCK.search(raw)
        tags = (
            "|".join(_strip_tags(t) for t in _RE_TAG_ITEM.findall(tag_block.group(1)))
            if tag_block
            else ""
        )
        m_price = _RE_PRICE.search(raw)
        m_mall = _RE_MALL.search(raw)
        m_c1 = _RE_CATE1.search(raw) or _RE_CATE1_ALT.search(raw)
        m_c2 = _RE_CATE2.search(raw) or _RE_CATE2_ALT.search(raw)
        m_hh = _RE_HHMM.search(raw)
        m_img = _RE_IMG.search(raw) or _RE_IMG_LOOSE.search(raw)

        deals.append(
            Deal(
                id=aid,
                title=title,
                url=f"{BASE_URL}/p/{aid}/",
                price=_strip_tags(m_price.group(1)) if m_price else "",
                mall=m_mall.group(1).strip() if m_mall else "",
                cate1=m_c1.group(1).strip() if m_c1 else "",
                cate2=m_c2.group(1).strip() if m_c2 else "",
                tags=tags,
                img=m_img.group(1).strip() if m_img else "",
                worth=num(_RE_WORTH),
                unworth=num(_RE_UNWORTH),
                fav=num(_RE_FAV),
                cmt=num(_RE_CMT),
                hhmm=m_hh.group(1) if m_hh else "",
            )
        )
    return deals


async def fetch_round(
    *,
    cookie: str = "",
    ua: str = "",
    jx_pages: int = PAGES_PER_ROUND,
    home_pages: int = HOME_PAGES_PER_ROUND,
) -> tuple[list[Deal], list[str]]:
    """抓一轮（精选流 N 页 + 首页推荐流 M 页，M 最多 1），返回 (全部好价, 错误列表)。

    顺序很重要：**先精选流、后首页**。精选流是时间序，越靠前越新；万一中途被
    风控（Banned 直接 break），至少已经把最新那批拿到手了。反过来先抓首页的话，
    被封时手里只有一批三小时前的旧货。

    首页只取第 1 页：它的 ``/pN/`` 分页返回同一屏内容，翻页没有意义。

    单页失败不阻断整轮：已拿到的页面照常入库，错误汇总返回给调用方记日志。
    """
    out: list[Deal] = []
    errors: list[str] = []
    seen: set[int] = set()
    jobs: list[tuple[str, int]] = [
        ("jingxuan", p) for p in range(1, max(0, jx_pages) + 1)
    ]
    if home_pages > 0:
        jobs.append(("home", 1))
    for kind, page in jobs:
        try:
            html = await fetch_page(page, cookie=cookie, ua=ua, kind=kind)
        except Banned as exc:
            errors.append(f"{kind} p{page}: {exc}")
            break  # 已被风控，本轮立即停手
        except Exception as exc:  # 网络/超时/HTTP 错误
            errors.append(f"{kind} p{page}: {type(exc).__name__}: {exc}")
            continue
        for d in parse_list_page(html):
            if d.id in seen:
                continue
            seen.add(d.id)
            out.append(d)
    return out, errors


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
