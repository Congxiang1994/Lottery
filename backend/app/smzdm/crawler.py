"""SMZDM 好价抓取与解析（三种入口）。

三个入口，各管一件事（2026-10-29 第二轮实测后确定，改前先复读）
------------------------------------------------------------
- ``/tag/{slug}/``（标签流，**时间序**）= 主力入口，管「劲爆」。
  手慢无 / 绝对值 / 历史低价 / 多重优惠叠加。每页 20 条、翻页有效、
  最新一条可在 1 分钟内出现。卡片**带正文**（优惠券构成）、**爆料人**、
  **站点标签**，因此能算出真实折扣 —— 这是唯一不依赖投票数的入口。
  实测入选率 20%（4/20），是首页推荐流的量级差。
- ``/``（首页推荐流，**算法序**）= 兜底入口，只抓 1 页。
  2026-10-29 实测它已明显劣化：18 条值中位数只有 2、按线上门槛 0 条能过。
  但成本极低（1 请求），留着不亏。
- ``/top/``（排行榜，**商品维度**）= 数码补充入口。
  一页只渲染当前 tab（默认「电脑数码 × 12 小时热门」24 条），无投票数据，
  只作为「数码正在热」的候选池，每 3 轮抓一次。

``/jingxuan/``（精选流）默认不抓：实测是全量爆料流水，100 条里 0 条过阈值。

为什么都不抓详情页
------------------
列表卡片的 HTML 里已经带齐全部判据：值、不值、收藏数、评论数、价格、
一级分类、卡片标签、上架时分；标签流还额外带正文（含原价）与爆料人。
详情页（单条 300KB~1MB）只有完整正文，没有额外的「历史低价」结构化字段。

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
from dataclasses import dataclass
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
    TAG_FEEDS,
    TAG_PAGES_PER_ROUND,
    TOP_PATH,
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
    # 折扣（整数百分比：44 = 4.4 折，100 = 原价，0 = 正文没写原价、未知）。
    # 唯一与「曝光」无关的信号 —— 刚发布 10 分钟的真漏也有折扣，但没有投票。
    discount: int = 0
    # 爆料人昵称（标签流专有）。用来把「谁挖的」变成可见信息。
    reporter: str = ""
    # 站点打的标签（手慢无 / 绝对值 / 历史低价 …），`|` 分隔。
    # ⚠️ 它与 `tags` 不是一回事：`tags` 是卡片上的营销标签（「价格低于618」），
    # 这个是**分类标签页的归属**，可信度高得多。
    feed_tags: str = ""
    # 来源：tag / home / jingxuan / top（排查「这条从哪来的」用）
    source: str = ""

    @property
    def worth_pct(self) -> float:
        """值率（%）。无人打分时返回 0 —— 0 分样本不该被当成「100% 值」。"""
        total = self.worth + self.unworth
        if total <= 0:
            return 0.0
        return round(self.worth * 100.0 / total, 1)

    @property
    def cur_price(self) -> float:
        """从价格串里抠出到手价数字（「69.55元（59.77元淘金币到手）」→ 69.55）。

        失败返回 0 —— 调用方必须把 0 当「不知道」，不能当「免费」。
        """
        m = _RE_NUM.match((self.price or "").strip())
        if not m:
            return 0.0
        try:
            return float(m.group(1))
        except ValueError:
            return 0.0

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
            "discount": self.discount,
            "reporter": self.reporter,
            "feed_tags": self.feed_tags,
            "source": self.source,
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


def _page_url(kind: str, page: int, slug: str = "") -> str:
    """拼目标页 URL。

    kind="tag"     ：``/tag/{slug}/``、``/tag/{slug}/p2/`` ……（时间序，翻页有效）
    kind="home"    ：只支持第 1 页。``/p2/`` 起的首页分页返回的是同一屏内容，
                     抓了也不多一条，还会白占风控额度（2026-10-29 实测）。
    kind="jingxuan"：``/jingxuan/``、``/jingxuan/p2/`` ……
    kind="top"     ：``/top/``，无分页（一页渲染全部启用的榜单元）
    """
    if kind == "home":
        return f"{BASE_URL}{HOME_PATH}"
    if kind == "top":
        return f"{BASE_URL}{TOP_PATH}/"
    if kind == "tag":
        if not slug:
            raise ValueError("tag 入口必须给 slug")
        base = f"{BASE_URL}/tag/{slug}/"
        return base if page <= 1 else f"{base}p{page}/"
    if page <= 1:
        return f"{BASE_URL}{JINGXUAN_PATH}/"
    return f"{BASE_URL}{JINGXUAN_PATH}/p{page}/"


async def fetch_page(
    page: int, cookie: str = "", ua: str = "", kind: str = "jingxuan", slug: str = ""
) -> str:
    """抓一页列表，返回 HTML。

    Args:
        kind: "tag"（标签流）/ "home"（首页推荐，仅第 1 页）/ "jingxuan" / "top"
        slug: kind="tag" 时的标签短 slug（如 ``tz273gm`` = 手慢无）
              ⚠️ 必须是 slug，不能传中文名 —— 中文名会 301，白多一轮往返。

    Raises:
        Banned: 命中验证码或 202 挑战
        httpx.HTTPError: 网络层错误
    """
    if ban_remaining_seconds() > 0:
        raise Banned(f"仍处于退避期，剩余 {ban_remaining_seconds()} 秒")

    url = _page_url(kind, page, slug)
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
            f"{kind}{('/' + slug) if slug else ''} 第 {page} 页返回反爬页"
            f"（HTTP {resp.status_code}，{len(body)} 字节）"
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


# ---------------------------------------------------------------- 标签流解析
#
# 卡片结构（实测 2026-10-29）：
#   <div data-article-id="184980398" class="list list_preferential " articleid="3_184980398">
#     <div class="listTitle"><h3 class="itemName">
#       <a href="/p/…/">标题<span class="red">69.55元（59.77元淘金币到手）</span></a></h3></div>
#     <a class="picLeft" …><img src="//qny.smzdm.com/….jpg_d200.jpg"></a>
#     <div class="listRight">
#       <div class="lrTop"><span class="lrTime">13:08</span><span>爆料人：梨白白o</span>
#           <!-- 标签：<a href="/fenlei/白酒/youhui/">白酒</a>
#                      <a href="/tag/手慢无/youhui/">手慢无</a> -->   ← ⚠️ 被注释掉但内容在
#       </div>
#       <div class="lrInfo">正文（含「活动售价135元…到手59.77元」）<a>阅读全文</a></div>
#       <div class="lrBot">
#         <a onclick="rating(184980398,1,3)"><b>值</b> <em>118</em></a>
#         <a onclick="rating(184980398,2,3)"><b>不值</b> <em>2</em></a>
#         <a class="fav" …><em>54</em></a>
#         <a class="comment" …>151</a>
#
# 🔴 切分必须按 `data-article-id="`，**不能按 class** —— data-article-id 写在
#    class 属性之前，按 class 切会让每张卡丢掉自己的 id、捡到下一张的 id，
#    表现是所有投票数都匹配到邻居身上（全 0），且不报错。调研时踩过。
_TAG_LABELS: dict[str, str] = {s: n for s, n in TAG_FEEDS}

_RE_TAG_TITLE = re.compile(r'<h3 class="itemName">\s*<a[^>]*>\s*(.*?)<span class="red">', re.S)
_RE_TAG_PRICE = re.compile(r'<span class="red">\s*([^<]{1,60})</span>')
_RE_TAG_TIME = re.compile(r'class="lrTime">\s*(\d{2}:\d{2})')
_RE_TAG_USER = re.compile(r"爆料人：\s*([^<\s]{1,24})")
_RE_TAG_C1 = re.compile(r"'cate_level1':'([^']*)'")
_RE_TAG_C2 = re.compile(r"'cate_level2':'([^']*)'")
_RE_TAG_MALL = re.compile(r"'mall_name':'([^']*)'")
# 标签与品类都在被注释掉的那段 HTML 里，href 分别是 /tag/… 与 /fenlei/…
_RE_TAG_TAGS = re.compile(r'href="[^"]*/tag/[^"]*"[^>]*>([^<]{1,16})</a>')
# ⚠️ 上面这条正则会连**分页导航**一起抓进来：标签页底部的
# `<a href="/tag/tz273gm/p2/">2</a> … <a>下一页</a>` 也匹配 /tag/。
# 实测不清理的话标签会变成「手慢无|拼单|上一页|1|2|3|4|5|6|下一页」，
# 直接显示在卡片上。这里只保留「含中文」或明确有意义的英文标签 ——
# 站点还大量使用 hjxy / yszb3 / raw_struct / AIcheck_union 这类内部代号，
# 对用户毫无意义且会挤掉真正有用的标签。
_CJK = re.compile(r"[\u4e00-\u9fa5]")
_TAG_KEEP_EN = {"88VIP", "PLUS", "BlackFriday"}
_TAG_NOISE = {"上一页", "下一页", "首页", "末页"}


def clean_tags(items: list[str]) -> list[str]:
    """过滤标签噪音：分页数字、上下页、站点内部英文代号。"""
    out: list[str] = []
    for raw in items:
        t = (raw or "").strip()
        if not t or t in _TAG_NOISE or t.isdigit():
            continue
        if not _CJK.search(t) and t not in _TAG_KEEP_EN:
            continue
        if t not in out:
            out.append(t)
    return out


_RE_TAG_CATES = re.compile(r'href="[^"]*/fenlei/[^"]*"[^>]*>([^<]{1,16})</a>')
_RE_TAG_INFO = re.compile(r'<div class="lrInfo">\s*(.*?)<a ', re.S)
_RE_TAG_WORTH = re.compile(r"<b>值</b>\s*<em>(\d+)</em>")
_RE_TAG_UNWORTH = re.compile(r"<b>不值</b>\s*<em>(\d+)</em>")
_RE_TAG_FAV = re.compile(r'class="fav"[\s\S]{0,600}?<em>(\d+)</em>')
_RE_TAG_CMT = re.compile(r'class="comment"[^>]*>\s*<i[^>]*>[\s\S]{0,300}?</i>\s*(\d+)')
_RE_TAG_IMG = re.compile(r'class="picLeft"[\s\S]{0,400}?<img[^>]+src="([^"]+)"')

# 价格串开头的数字（到手价）。"69.55元（59.77元淘金币到手）" → 69.55
_RE_NUM = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)")

# 正文里的「原价」声明。只收**原价语义**的词：「券后价」「到手价」是折后价，
# 拿它当原价会算出 10 折，等于白算。
_RE_ORIG_PRICE = re.compile(
    r"(?:活动售价|日常售价|售价|原价|专柜价|日常价|京东价|参考价|吊牌价)"
    r"\s*(?:为|是|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*元"
)


def discount_of(info: str, price: str) -> int:
    """从「正文 + 价格串」推算折扣，返回整数百分比（44 = 4.4 折，0 = 未知）。

    为什么这是核心信号：折扣是**客观的**，与有没有被曝光、有没有人投票无关。
    刚到 10 分钟的好价没人投过票，但「原价 505 → 到手 254」就是 5 折。
    旧判据（值/收藏/评论绝对数）本质在测「曝光量」，系统性漏掉刚发布的真漏。

    只在 1%~100% 区间内接受结果：低于 1% 或高于 100% 说明正文里的「售价」
    指的很可能不是这个商品（套装价、单位价、配件价），宁可不给折扣也别给错。
    """
    m_o = _RE_ORIG_PRICE.search(info or "")
    m_c = _RE_NUM.match((price or "").strip())
    if not (m_o and m_c):
        return 0
    try:
        orig = float(m_o.group(1))
        cur = float(m_c.group(1))
    except ValueError:
        return 0
    if orig <= 0 or cur <= 0 or cur >= orig:
        return 0
    d = round(cur * 100 / orig)
    return d if 1 <= d <= 100 else 0


def parse_tag_page(html: str, feed_label: str = "") -> list[Deal]:
    """解析一页标签流。解析失败的卡片跳过（不猜、不补）。

    Args:
        feed_label: 抓取时用的标签名（如「手慢无」）。卡片自带的标签里不一定
            有它（有的条目只挂了其它标签），所以要作为来源标记补进来。
    """
    deals: list[Deal] = []
    seen: set[int] = set()
    for raw in html.split('data-article-id="')[1:]:
        if "listTitle" not in raw:
            continue
        try:
            aid = int(raw.split('"', 1)[0])
        except ValueError:
            continue
        if aid in seen:
            continue

        m_title = _RE_TAG_TITLE.search(raw)
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

        price = _strip_tags(_RE_TAG_PRICE.search(raw).group(1)) if _RE_TAG_PRICE.search(raw) else ""
        info = _strip_tags(_RE_TAG_INFO.search(raw).group(1)) if _RE_TAG_INFO.search(raw) else ""
        cates = [t.strip() for t in _RE_TAG_CATES.findall(raw)]
        tags = clean_tags(_RE_TAG_TAGS.findall(raw))
        m_c1 = _RE_TAG_C1.search(raw)
        m_c2 = _RE_TAG_C2.search(raw)
        m_mall = _RE_TAG_MALL.search(raw)
        m_hh = _RE_TAG_TIME.search(raw)
        m_user = _RE_TAG_USER.search(raw)
        m_img = _RE_TAG_IMG.search(raw)

        # 品类优先取 data 里的 cate_level1，其次取 /fenlei/ 链接的文字
        cate1 = m_c1.group(1).strip() if m_c1 else (cates[0] if cates else "")
        cate2 = m_c2.group(1).strip() if m_c2 else (cates[1] if len(cates) > 1 else "")

        # 卡片标签可能不含来源标签（例如「绝对值」页里的条目只挂「值友专享」），
        # 补上它，前端才能显示「它是从哪个榜收来的」
        if feed_label and feed_label not in tags:
            tags.append(feed_label)

        deals.append(
            Deal(
                id=aid,
                title=title,
                url=f"{BASE_URL}/p/{aid}/",
                price=price,
                mall=m_mall.group(1).strip() if m_mall else "",
                cate1=cate1,
                cate2=cate2,
                # ✋ 标签页没有「营销标签块」（标签页结构里不存在 feed-block-tags），
                # 它自带的 /tag/ 链接就是最有信息量的那层，统一放进 feed_tags。
                # tags 留空，前端用 feed_tags 兜底 —— 两个字段塞同一份数据只会
                # 在两处显示同一批标签，或者让维护者猜「该读哪个」。
                tags="",
                img=("https:" + m_img.group(1)) if m_img and m_img.group(1).startswith("//") else (m_img.group(1) if m_img else ""),
                worth=num(_RE_TAG_WORTH),
                unworth=num(_RE_TAG_UNWORTH),
                fav=num(_RE_TAG_FAV),
                cmt=num(_RE_TAG_CMT),
                hhmm=m_hh.group(1) if m_hh else "",
                discount=discount_of(info, price),
                reporter=m_user.group(1).strip() if m_user else "",
                feed_tags="|".join(tags),
                source="tag",
            )
        )
    return deals


# ---------------------------------------------------------------- 排行榜解析
#
# <div class="feed-hot-card" articleid="184953930" data-cid="1" data-position="1"
#      data-type="普通" data-tab="电脑数码">
#   <span class="hot-order">1</span>
#   <a href="/p/184953930/">
#     <div class="feed-hot-pic"><img …></div>
#     <div class="feed-hot-title">苹果 iPhone 17 Pro 5G手机 256GB</div>
#     <span class="z-highlight">6999元</span>
#
# 这里按 class 切是**对的**（articleid 紧随 class 之后，在本卡片属性内）。
# 一页同时渲染「电脑数码 / 京东 / 全部 / 新晋榜」四个 tab 的当前时间窗；
# 只有「电脑数码」是商品榜，其余是 App Store 限免流水与众测广告，一律丢弃。
_TOP_KEEP_TAB = "电脑数码"
_RE_HOT_ID = re.compile(r'articleid="(\d+)"')
_RE_HOT_TAB = re.compile(r'data-tab="([^"]+)"')
_RE_HOT_TITLE = re.compile(r'<div class="feed-hot-title">([^<]+)</div>')
_RE_HOT_PRICE = re.compile(r'<span class="z-highlight">([^<]*)</span>')
_RE_HOT_IMG = re.compile(r'<img[^>]+src="([^"]+)"')


def parse_top_page(html: str) -> list[Deal]:
    """解析排行榜页，只保留「电脑数码」tab 的商品。

    这些卡片**没有投票数据**（榜单本身就是热度投票的结果浓缩），所以
    worth/fav/cmt 全为 0、discount 也为 0（没有正文）。它们只作为
    「数码正在热」的候选池 —— 判定时会被旧判据筛掉，但能进库供排序参考。
    """
    out: list[Deal] = []
    seen: set[int] = set()
    for raw in html.split('class="feed-hot-card"')[1:]:
        m_id = _RE_HOT_ID.search(raw)
        m_tab = _RE_HOT_TAB.search(raw)
        m_title = _RE_HOT_TITLE.search(raw)
        if not (m_id and m_tab and m_title):
            continue
        if m_tab.group(1) != _TOP_KEEP_TAB:
            continue
        try:
            aid = int(m_id.group(1))
        except ValueError:
            continue
        if aid in seen:
            continue
        title = _strip_tags(m_title.group(1)).strip()
        if not title:
            continue
        seen.add(aid)
        m_price = _RE_HOT_PRICE.search(raw)
        m_img = _RE_HOT_IMG.search(raw)
        out.append(
            Deal(
                id=aid,
                title=title,
                url=f"{BASE_URL}/p/{aid}/",
                price=_strip_tags(m_price.group(1)) if m_price else "",
                cate1=_TOP_KEEP_TAB,
                img=m_img.group(1) if m_img else "",
                source="top",
            )
        )
    return out


async def fetch_round(
    *,
    cookie: str = "",
    ua: str = "",
    jx_pages: int = PAGES_PER_ROUND,
    home_pages: int = HOME_PAGES_PER_ROUND,
    tag_slugs: list[str] | None = None,
    tag_pages: int = 0,
    include_top: bool = False,
) -> tuple[list[Deal], list[str]]:
    """抓一轮（标签流 + 首页 + 精选流 + 排行榜），返回 (全部好价, 错误列表)。

    顺序很重要：**标签流最先**。它是最有信息的入口（带正文与爆料人），
    而且是时间序、越靠前越新。万一中途被风控（Banned 直接 break），
    至少已经把最值钱的那批拿到手了。排行榜放最后 —— 它变化慢、无投票数据。

    首页只取第 1 页：它的 ``/pN/`` 分页返回同一屏内容，翻页没有意义。

    单页失败不阻断整轮：已拿到的页面照常入库，错误汇总返回给调用方记日志。
    """
    out: list[Deal] = []
    errors: list[str] = []
    seen: set[int] = set()

    jobs: list[tuple[str, str, int, str]] = []
    for slug in tag_slugs or []:
        for p in range(1, max(0, tag_pages) + 1):
            jobs.append(("tag", slug, p, f"tag/{slug}"))
    jobs += [("jingxuan", "", p, "jingxuan") for p in range(1, max(0, jx_pages) + 1)]
    if home_pages > 0:
        jobs.append(("home", "", 1, "home"))
    if include_top:
        jobs.append(("top", "", 1, "top"))

    for kind, slug, page, label in jobs:
        try:
            html = await fetch_page(page, cookie=cookie, ua=ua, kind=kind, slug=slug)
        except Banned as exc:
            errors.append(f"{label} p{page}: {exc}")
            break  # 已被风控，本轮立即停手
        except Exception as exc:  # 网络/超时/HTTP 错误
            errors.append(f"{label} p{page}: {type(exc).__name__}: {exc}")
            continue

        if kind == "tag":
            label_name = _TAG_LABELS.get(slug, "")
            parsed = parse_tag_page(html, feed_label=label_name)
        elif kind == "top":
            parsed = parse_top_page(html)
        else:
            parsed = parse_list_page(html)
            for d in parsed:
                d.source = kind

        for d in parsed:
            if d.id in seen:
                continue
            seen.add(d.id)
            out.append(d)
    return out, errors


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
