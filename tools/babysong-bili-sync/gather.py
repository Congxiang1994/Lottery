#!/usr/bin/env python3
"""每日刷新 Super Simple Songs 儿歌的哔哩哔哩 BV 号。

- 默认（无参数）：增量模式。已有 BV 号的先校验是否仍在线（被下架则重新搜索），
  没有 BV 号的（含被下架后清空）重新搜索。这样搬运视频被删后能自动找回最新可用链接。
- --no-verify：跳过「已有 BV 号是否在线」校验（仅用于本地快速补齐，速度更快）。
- --seed-map PATH：从 {id: bvid|"NONE"} 的 JSON 预填 BV 号（仅填补空缺，不覆盖已有）。

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


STOP = {
    "the", "a", "an", "song", "songs", "super", "simple", "and", "of", "to",
    "is", "in", "on", "my", "me", "you", "your", "we", "i", "it", "this",
    "that", "for", "with",
}


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


def norm_words(title: str):
    """按非字母数字切词并去停用词，得到规范化词表（用于整词匹配）。"""
    return [w for w in re.split(r"[^a-z0-9]+", (title or "").lower()) if w and w not in STOP]


def pick_best(title: str, results) -> str | None:
    """在搜索结果里挑最匹配的一首。

    匹配策略（严格，避免「名字都对不上」的误匹配）：
    - 仅做**整词**重叠（用集合交集，杜绝 substring 误命中，如 apple ⊂ pineapple）；
    - 标题里实词至少命中 `need` 个才接受，need = min(实词数, max(2, 实词数/2 向上取整))；
      即至少 2 个实词、或覆盖过半实词，二者取小；
    - 标题词不够时（如单字歌名）退化为命中 1 个即可；
    - 「Super Simple / SSS」字样只作极小加权（0.1），绝不单独救回一个名字不沾边的视频。
    """
    base = norm_words(title)
    if not base:
        return None
    base_set = set(base)
    best = None
    best_score = -1.0
    best_matched = 0
    for it in results:
        if it.get("type") != "video":
            continue
        bvid = it.get("bvid")
        if not bvid or it.get("live_status"):
            continue
        t = strip_tags(it.get("title", ""))
        tw = set(norm_words(t))
        aw = set(norm_words(it.get("author") or ""))
        # 整词重叠：优先看标题，标题词不够再看作者名
        matched = base_set & tw or base_set & aw
        ov = len(matched)
        if ov == 0:
            continue
        score = float(ov)
        if "super" in tw and "simple" in tw:
            score += 0.1
        if score > best_score:
            best_score = score
            best = bvid
            best_matched = ov
    need = min(len(base), max(2, (len(base) + 1) // 2))
    return best if best_matched >= need else None


def search_best(bili: Bili, title: str) -> str | None:
    queries = [f"{title} Super Simple Songs", title, f"英文儿歌 {title}", f"SSS {title}"]
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
    kept = refilled = dead = still_missing = 0
    changed = False

    try:
        for s in catalog:
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
        f"dead_recovered={dead} still_missing={still_missing} changed={changed}"
    )


if __name__ == "__main__":
    main()
