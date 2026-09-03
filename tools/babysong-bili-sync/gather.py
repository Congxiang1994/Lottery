#!/usr/bin/env python3
"""每日刷新 Super Simple Songs 儿歌的哔哩哔哩 BV 号。

- 默认（无参数）：增量模式。已有 BV 号的先校验是否仍在线（被下架则重新搜索），
  没有 BV 号的（含被下架后清空）重新搜索。这样搬运视频被删后能自动找回最新可用链接。
- --no-verify：跳过「已有 BV 号是否在线」校验（仅用于本地快速补齐，速度更快）。
- --recheck：对所有未下载本地的歌用严格包含匹配重新检索并覆盖，清理误匹配。
- --seed-map PATH：从 {id: bvid|"NONE"} 的 JSON 预填 BV 号（仅填补空缺，不覆盖已有）。

跳过规则：/data/song/{id}.mp4 已存在的歌不再检索/校验 B 站链接
（有本地视频时 B 站按钮不展示，链接失效也无所谓，省时间防风控）。

匹配策略（2026-09-03 收紧）：歌名规范化（小写、去所有非字母数字字符）后必须**完整
包含**在 B 站视频标题的规范化结果里，大小写不敏感、忽略标点/空格差异；
找不到完全包含的就置空（该歌仅保留 YouTube 入口），绝不宽松匹配。

设计为可在无第三方依赖的环境下运行（仅用标准库），便于部署到服务器用定时任务驱动。
B 站搜索接口强制 WBI 签名，本脚本自带签名实现。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from functools import reduce
from http.cookiejar import CookieJar

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CATALOG = os.path.normpath(
    os.path.join(HERE, "..", "..", "backend", "app", "babysong", "data", "catalog.json")
)
# 本地视频目录：已有 {id}.mp4 的歌跳过 B 站检索/校验
SONG_DIR = os.environ.get("SONG_DIR", "/data/song")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
REFERER = "https://search.bilibili.com/"

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
    20, 34, 44, 52,
]


def get_mixin_key(s: str) -> str:
    return reduce(lambda x, i: x + s[i], MIXIN_KEY_ENC_TAB, "")[:32]


STOP = set()  # 已改用「完整包含」匹配，停用词表不再需要（保留空集合兼容旧引用）


class Bili:
    def __init__(self):
        self.cj = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cj)
        )
        self.opener.addheaders = [("User-Agent", UA), ("Referer", REFERER)]
        try:
            self.opener.open("https://www.bilibili.com/", timeout=15).read()
        except Exception:
            pass
        self._keys = None

    def keys(self):
        if self._keys:
            return self._keys
        req = self.opener.open(
            "https://api.bilibili.com/x/web-interface/nav", timeout=15
        )
        d = json.loads(req.read())
        img = d["data"]["wbi_img"]["img_url"].rsplit("/", 1)[1].split(".")[0]
        sub = d["data"]["wbi_img"]["sub_url"].rsplit("/", 1)[1].split(".")[0]
        self._keys = (img, sub)
        return self._keys

    def sign(self, params: dict) -> str:
        img, sub = self.keys()
        mk = get_mixin_key(img + sub)
        params = dict(sorted(params.items()))
        params["wts"] = round(time.time())
        q = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
        q = "".join(c for c in q if c not in "!'()*")
        w_rid = hashlib.md5((q + mk).encode()).hexdigest()
        return q + "&w_rid=" + w_rid

    def search(self, kw: str):
        for _ in range(3):
            try:
                q = self.sign({"search_type": "video", "keyword": kw})
                req = self.opener.open(
                    "https://api.bilibili.com/x/web-interface/search/type?" + q,
                    timeout=15,
                )
                if req.status != 200:
                    time.sleep(2)
                    self._keys = None
                    continue
                d = json.loads(req.read())
                if d.get("code") != 0:
                    time.sleep(2)
                    self._keys = None
                    continue
                return d.get("data", {}).get("result", [])
            except Exception:
                time.sleep(2)
                self._keys = None
        return []

    def view_alive(self, bvid: str) -> bool:
        try:
            req = self.opener.open(
                f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}",
                timeout=15,
            )
            d = json.loads(req.read())
            return d.get("code") == 0
        except Exception:
            return False


def strip_tags(s: str) -> str:
    return re.sub("<[^>]+>", "", s or "")


def norm_text(s: str) -> str:
    """规范化：小写 + 去掉所有非字母数字字符（空格/标点/符号全忽略）。

    例："One Little Finger (Part 2)" -> "onelittlefingerpart2"
    用于「歌名必须完整包含在视频标题里」的严格包含匹配，大小写不敏感。
    """
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def has_local_video(song_id: str) -> bool:
    return os.path.isfile(os.path.join(SONG_DIR, f"{song_id}.mp4"))


def pick_best(title: str, results) -> str | None:
    """在搜索结果里挑最匹配的一首。

    匹配策略（2026-09-03 收紧为**完全包含 + 词边界**）：
    - 歌名规范化（小写、去标点/空格）后必须完整出现在视频标题规范化结果里；
      大小写无所谓，空格/标点差异忽略（标题常带 "【SSS】" "儿歌" 等前后缀，允许）。
    - 词边界保护：歌名必须对齐原标题「字母数字块」的边界——即歌名由标题里的
      一个或多个**完整块**组成，杜绝 "apple" 命中 "pineapple"、"finger" 黏住
      "fingerling" 这类黏连误匹配。
    - 多个满足时取「标题最短」的（前后缀噪音最少，最可能是搬运原视频）；
      再平手取搜索顺序靠前的。
    - 找不到满足条件的返回 None（宁缺毋滥，该歌仅保留 YouTube 入口）。
    """
    needle = norm_text(title)
    if not needle:
        return None
    best = None
    best_len = None
    for it in results:
        if it.get("type") != "video":
            continue
        bvid = it.get("bvid")
        if not bvid or it.get("live_status"):
            continue
        raw = strip_tags(it.get("title", ""))
        if not boundary_match(raw, needle):
            continue
        t = norm_text(raw)
        # 标题越短噪音越少；等长取先出现的（搜索相关性排序靠前）
        if best_len is None or len(t) < best_len:
            best = bvid
            best_len = len(t)
    return best


def boundary_match(raw_title: str, needle: str) -> bool:
    """needle（规范化歌名，无分隔符）是否由 raw_title 的一个或多个完整字母数字块拼接而成。

    做法：把标题切成块后，用「块连接序列」的可选拼接位置做 DP/集合匹配——
    维护「已匹配到 needle 第 i 位时的块边界集合」，逐块消费：
    - 从某边界开始把当前块接到已匹配串后面（跨块拼接）；
    - 或当前块正好等于剩余串，匹配完成。
    简化实现：枚举所有「连续块组合」的拼接串，看是否等于 needle。
    标题块数通常 <15，连续组合数 O(n²)，完全可接受。
    """
    blocks = [norm_text(b) for b in re.split(r"[^A-Za-z0-9]+", raw_title or "") if b]
    n = len(blocks)
    for i in range(n):
        acc = ""
        for j in range(i, n):
            acc += blocks[j]
            if acc == needle:
                return True
            if len(acc) >= len(needle):
                break
    return False


def search_best(bili: Bili, title: str) -> str | None:
    # 首选「xxx Super Simple Songs」精准短语（B 站搜索支持引号强匹配），
    # 命中即返回；否则逐个降级宽松关键词，由 pick_best 的完全包含匹配兜底筛选。
    queries = [
        f'"{title}" Super Simple Songs',
        f'"{title}"',
        f"{title} Super Simple Songs",
        title,
        f"英文儿歌 {title}",
    ]
    for kw in queries:
        bvid = pick_best(title, bili.search(kw))
        if bvid:
            return bvid
        time.sleep(0.25)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default=DEFAULT_CATALOG)
    ap.add_argument("--seed-map", default=None, help="预填 BV 号的 JSON 映射")
    ap.add_argument("--no-verify", action="store_true", help="跳过已有 BV 号在线校验")
    ap.add_argument(
        "--recheck",
        action="store_true",
        help="对所有歌曲（无论是否已有 BV 号）用严格匹配重新检索并覆盖，用于清理误匹配",
    )
    args = ap.parse_args()

    with open(args.catalog, encoding="utf-8") as f:
        catalog = json.load(f)

    if args.seed_map:
        m = json.load(open(args.seed_map, encoding="utf-8"))
        for s in catalog:
            if not s.get("bilibili_bvid") and m.get(s.get("id")) not in (None, "NONE"):
                s["bilibili_bvid"] = m[s["id"]]

    bili = Bili()
    total = len(catalog)
    kept = refilled = dead = still_missing = skipped_local = 0
    changed = False

    try:
        for s in catalog:
            # 已有本地视频：前端不再展示 B 站按钮，链接是否失效无所谓 → 直接跳过
            if has_local_video(s.get("id", "")):
                skipped_local += 1
                continue
            bvid = s.get("bilibili_bvid")
            if args.recheck:
                # 严格重算：忽略已有 BV，全部重新检索覆盖（清理误匹配）
                nb = search_best(bili, s["title"])
                if nb != bvid:
                    changed = True
                s["bilibili_bvid"] = nb
                if nb:
                    refilled += 1
                else:
                    still_missing += 1
            elif bvid:
                if args.no_verify or bili.view_alive(bvid):
                    kept += 1
                else:
                    dead += 1
                    s["bilibili_bvid"] = None
                    changed = True
                    nb = search_best(bili, s["title"])
                    if nb:
                        s["bilibili_bvid"] = nb
                        refilled += 1
                    else:
                        still_missing += 1
            else:
                nb = search_best(bili, s["title"])
                if nb:
                    s["bilibili_bvid"] = nb
                    refilled += 1
                    changed = True
                else:
                    still_missing += 1
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("interrupted; writing partial results", file=sys.stderr)
    except Exception as e:
        print(f"FATAL: {e}; 不写盘以免损坏 catalog", file=sys.stderr)
        sys.exit(1)

    found = sum(1 for s in catalog if s.get("bilibili_bvid"))
    bak = args.catalog + ".bak"
    try:
        with open(bak, "w", encoding="utf-8") as f:
            json.dump(catalog, f, ensure_ascii=False, indent=2)
        os.replace(bak, args.catalog)
    except Exception as e:
        print(f"write failed: {e}", file=sys.stderr)
        sys.exit(1)

    print(
        f"DONE total={total} found={found} kept={kept} refilled={refilled} "
        f"dead_recovered={dead} still_missing={still_missing} "
        f"skipped_local={skipped_local} changed={changed}"
    )


if __name__ == "__main__":
    main()
