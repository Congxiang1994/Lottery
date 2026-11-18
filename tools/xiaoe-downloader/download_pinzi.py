#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《汉字是拼出来的》小鹅通课程下载器

与 tools/xiaoe-downloader/download.py 同链路, 差异:
  - 本课程是**长视频** (单集 20~31 分钟, 约 40-60MB), 并发降到 2 避免网关滑块
  - 额外抓取封面图 + 生成 meta.json (保留完整标题, 便于前端展示与检索)
  - resource_type=3 (该店把长视频标为 3, 不是 2)

产物:
  {outdir}/001-先导篇.mp4 ... 018-总结篇.mp4
  {outdir}/covers/001.jpg ...
  {outdir}/meta.json

用法:
  python3 download_pinzi.py --cookie-file /tmp/xiaoe_cookies.txt --outdir /data/pinzi
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://appmi6tuexg1562.h5.xet.pomoho.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")
ORG = "appmi6TUexg1562"
PRODUCT_ID = "p_67ad7ff6e4b0694c5a90ba91"

# 非法文件名字符
_BAD = re.compile(r'[\\/:*?"<>|\r\n\t]')


def course_order(items: list[dict]) -> list[dict]:
    """按课程**逻辑顺序**重排目录。

    该接口虽传 ``sort=asc``，实际返回的是**倒序**（总结篇在最前，先导篇在最后）。
    直接按接口顺序编号会把「总结篇」编成 001，串讲顺序全错。

    排序规则适配本课程命名：
      先导篇 → 第1讲 → 第2讲 → … → 第16讲 → 总结篇
    （无「第N讲」编号的条目：先导篇排最前，总结篇排最后，其余按原标题）
    """
    lead, tail, talks = [], [], []
    for it in items:
        title = (it.get("resource_title") or "").strip()
        m = re.search(r"第\s*(\d+)\s*[讲节课]", title)
        if m:
            talks.append((int(m.group(1)), title, it))
        elif "先导" in title or "预告" in title:
            lead.append(it)
        elif "总结" in title or "结课" in title or "回顾" in title:
            tail.append(it)
        else:
            talks.append((10**6, title, it))
    talks.sort(key=lambda x: (x[0], x[1]))
    return lead + [t[2] for t in talks] + tail


def log(msg: str) -> None:
    print(msg, flush=True)


class Xiaoe:
    def __init__(self, cookie: str) -> None:
        self.cookie = cookie

    def post(self, path: str, data: str,
             ct: str = "application/x-www-form-urlencoded") -> dict:
        req = urllib.request.Request(BASE + path, data=data.encode(), method="POST")
        req.add_header("Content-Type", ct)
        req.add_header("User-Agent", UA)
        req.add_header("Cookie", self.cookie)
        req.add_header("Origin", BASE)
        req.add_header("Referer", BASE + "/p/course/column/" + PRODUCT_ID)
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode("utf-8", "replace")
        if not raw.strip():
            # 网关在 Cookie 失效/被限流时返回 200 + 空体
            raise RuntimeError("空响应 (Cookie 失效或触发网关限流)")
        return json.loads(raw)

    def items(self) -> list[dict]:
        body = urllib.parse.urlencode({
            "bizData[column_id]": PRODUCT_ID,
            "bizData[page_index]": 1,
            "bizData[page_size]": 100,
            "bizData[sort]": "asc",
        })
        d = self.post("/xe.course.business_go.column.items.get/2.0.0", body)
        if d.get("code") != 0:
            raise RuntimeError(f"column.items.get 失败: {d.get('msg')}")
        return d["data"]["list"]

    def m3u8(self, rid: str) -> str:
        body = urllib.parse.urlencode({
            "bizData[resource_id]": rid,
            "bizData[product_id]": PRODUCT_ID,
            "bizData[opr_sys]": "MacIntel",
        })
        d = self.post("/xe.course.business_go.video.detail_info.get/2.0.0", body)
        if d.get("code") != 0:
            raise RuntimeError(f"detail_info: {d.get('msg')}")
        sign = d["data"]["video_info"]["play_sign"]
        # play_sign 一次性, 拿到立即换播放地址
        body = json.dumps({"org_app_id": ORG, "app_id": ORG,
                           "play_sign": [sign], "play_line": "A",
                           "opr_sys": "MacIntel"})
        p = self.post("/xe.material-center.play/getPlayUrl", body, "application/json")
        if p.get("code") != 0:
            raise RuntimeError(f"getPlayUrl: {p.get('msg')}")
        for _k, v in (p.get("data") or {}).items():
            pl = (v.get("play_list") or {}).get("720p_hls") or {}
            if pl.get("play_url"):
                return pl["play_url"]
        raise RuntimeError("无 720p_hls 地址")


def safe_name(title: str) -> str:
    return _BAD.sub("_", title).strip() or "未命名"


def fetch_cover(url: str, dst: str) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=40) as r:
            data = r.read()
        if len(data) < 1024:
            return False
        with open(dst, "wb") as f:
            f.write(data)
        return True
    except Exception as ex:
        log(f"    封面失败: {type(ex).__name__}: {ex}")
        return False


def download_one(x: Xiaoe, seq: int, item: dict, outdir: str,
                 retries: int, timeout: int) -> tuple[str, str]:
    title = safe_name(item.get("resource_title") or "")
    rid = item.get("resource_id") or ""
    fname = f"{seq:03d}-{title}.mp4"
    out = os.path.join(outdir, fname)
    if os.path.exists(out) and os.path.getsize(out) > 500_000:
        return fname, f"SKIP(exists) {os.path.getsize(out)/1024/1024:.0f}MB"

    last = ""
    for attempt in range(1, retries + 1):
        try:
            url = x.m3u8(rid)
            # m3u8 有时效, 拿到立即交给 ffmpeg
            r = subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", url, "-c", "copy", "-bsf:a", "aac_adtstoasc",
                 "-movflags", "+faststart", out],
                capture_output=True, text=True, timeout=timeout)
            if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 500_000:
                return fname, f"OK {os.path.getsize(out)/1024/1024:.1f}MB"
            last = (r.stderr or "")[-200:]
        except subprocess.TimeoutExpired:
            last = "ffmpeg 超时"
        except Exception as ex:
            last = f"{type(ex).__name__}: {ex}"
        # 失败产物可能残留半截, 清掉避免下次被 SKIP 误判
        if os.path.exists(out) and os.path.getsize(out) <= 500_000:
            os.remove(out)
        if attempt < retries:
            time.sleep(3 * attempt)
    return fname, f"FAIL {last}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cookie-file", required=True)
    ap.add_argument("--outdir", default="/data/pinzi")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=600, help="单集 ffmpeg 超时(秒)")
    ap.add_argument("--skip-covers", action="store_true")
    args = ap.parse_args()

    with open(args.cookie_file) as f:
        cookie = f.read().strip()
    if "ko_token" not in cookie:
        log("Cookie 缺少 ko_token")
        return 2

    os.makedirs(args.outdir, exist_ok=True)
    cover_dir = os.path.join(args.outdir, "covers")
    os.makedirs(cover_dir, exist_ok=True)

    x = Xiaoe(cookie)
    log("拉取目录...")
    items = x.items()
    # 按目录顺序编号 —— 接口返回是倒序，必须重排成课程逻辑顺序
    vids = course_order([it for it in items if it.get("resource_id")])
    log(f"共 {len(vids)} 节\n")
    for i, it in enumerate(vids, 1):
        log(f"  {i:03d} {it.get('resource_title')}")

    started = time.time()
    results: list[tuple[int, str, str]] = []

    def job(seq: int, it: dict):
        fname, msg = download_one(x, seq, it, args.outdir, args.retries, args.timeout)
        if not args.skip_covers:
            cu = (it.get("img_url") or "").strip()
            if cu:
                fetch_cover(cu, os.path.join(cover_dir, f"{seq:03d}.jpg"))
        return seq, fname, msg

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(job, i, it) for i, it in enumerate(vids, 1)]
        done = 0
        for fut in as_completed(futs):
            seq, fname, msg = fut.result()
            done += 1
            log(f"[{done}/{len(vids)}] {fname}: {msg}")
            results.append((seq, fname, msg))

    ok = [r for r in results if r[2].startswith("OK")]
    skip = [r for r in results if r[2].startswith("SKIP")]
    fail = [r for r in results if not r[2].startswith(("OK", "SKIP"))]
    log(f"\n完成: 共{len(vids)} 成功{len(ok)} 跳过{len(skip)} 失败{len(fail)} "
        f"用时{time.time()-started:.0f}s")

    # meta.json: 保留完整标题 + 封面 + 时长, 供后端/前端使用
    meta = []
    for seq, it in enumerate(vids, 1):
        fname = f"{seq:03d}-{safe_name(it.get('resource_title') or '')}.mp4"
        path = os.path.join(args.outdir, fname)
        dur = 0.0
        if os.path.exists(path):
            try:
                pr = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", path],
                    capture_output=True, text=True, timeout=60)
                dur = round(float(pr.stdout.strip() or 0), 1)
            except Exception:
                dur = 0.0
        cover = f"covers/{seq:03d}.jpg"
        meta.append({
            "seq": seq,
            "title": it.get("resource_title") or "",
            "filename": fname,
            "cover": cover if os.path.exists(os.path.join(args.outdir, cover)) else "",
            "duration": dur,
            "rid": it.get("resource_id"),
        })
    with open(os.path.join(args.outdir, "meta.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    log(f"已写入 meta.json ({len(meta)} 条)")

    if fail:
        log("失败列表:")
        for seq, fname, msg in sorted(fail):
            log(f"  {fname}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
