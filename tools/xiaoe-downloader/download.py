#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小鹅通视频课程批量下载器

链路: detail_info.get -> play_sign -> getPlayUrl -> m3u8 -> ffmpeg 合并
产物: {outdir}/{seq:03d}-{name}.mp4

使用:
  1. cp config.example.json config.json, 填入带登录态的 Cookie (见 README)
  2. python3 download.py

特性:
  - play_sign 一次性/短时效: detail_info 与 getPlayUrl 必须连续调用; m3u8 拿后立即 ffmpeg
  - 断点续传: 目标 mp4 已存在且 >100KB 则跳过
  - 4 并发 + 单视频失败重试 3 次
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from courses import VIDEOS

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_config():
    if not os.path.exists(CONFIG_PATH):
        print("缺少 config.json: 请先 cp config.example.json config.json 并填写 Cookie")
        sys.exit(2)
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    for key in ("base", "cookie", "product_id", "org_app_id", "outdir"):
        if not cfg.get(key):
            print(f"config.json 缺少必填项: {key}")
            sys.exit(2)
    return cfg


CFG = load_config()
BASE = CFG["base"].rstrip("/")
UA = CFG["ua"]
COOKIE = CFG["cookie"]
PRODUCT_ID = CFG["product_id"]
ORG_APP_ID = CFG["org_app_id"]
OUTDIR = CFG["outdir"]
MAX_WORKERS = int(CFG.get("max_workers", 4))
TIMEOUT = int(CFG.get("ffmpeg_timeout", 90))  # ffmpeg 单视频超时(秒)


def http_post(path, data, content_type="application/x-www-form-urlencoded"):
    req = urllib.request.Request(BASE + path, data=data.encode(), method="POST")
    req.add_header("Content-Type", content_type)
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", COOKIE)
    req.add_header("Origin", BASE)
    req.add_header("Referer", BASE + "/p/course/column/" + PRODUCT_ID)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def get_play_sign(resource_id):
    body = urllib.parse.urlencode({
        "bizData[resource_id]": resource_id,
        "bizData[product_id]": PRODUCT_ID,
        "bizData[opr_sys]": "MacIntel",
    })
    d = http_post("/xe.course.business_go.video.detail_info.get/2.0.0", body)
    if d.get("code") != 0:
        return None, d.get("msg")
    vi = d["data"]["video_info"]
    return vi["play_sign"], vi.get("title", "")


def get_m3u8(play_sign):
    body = json.dumps({
        "org_app_id": ORG_APP_ID, "app_id": ORG_APP_ID,
        "play_sign": [play_sign], "play_line": "A", "opr_sys": "MacIntel",
    })
    d = http_post("/xe.material-center.play/getPlayUrl", body, "application/json")
    if d.get("code") != 0:
        return None, d.get("msg")
    for k, v in d["data"].items():
        pl = v.get("play_list", {}).get("720p_hls") or {}
        if pl.get("play_url"):
            return pl["play_url"], None
    return None, "no 720p_hls url"


def download_one(seq, name, rid):
    fname = f"{seq:03d}-{name}.mp4"
    out = os.path.join(OUTDIR, fname)
    if os.path.exists(out) and os.path.getsize(out) > 100000:
        return fname, "SKIP(exists)"
    for attempt in range(3):
        try:
            sign, t = get_play_sign(rid)
            if not sign:
                return fname, f"FAIL detail_info: {t}"
            m3u8, e = get_m3u8(sign)
            if not m3u8:
                return fname, f"FAIL getPlayUrl: {e}"
            r = subprocess.run(
                ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", m3u8, "-c", "copy", "-bsf:a", "aac_adtstoasc", out],
                capture_output=True, text=True, timeout=TIMEOUT)
            if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 100000:
                sz = os.path.getsize(out)
                return fname, f"OK {sz/1024/1024:.1f}MB"
            return fname, f"FAIL ffmpeg: {r.stderr[-150:]}"
        except Exception as ex:
            if attempt == 2:
                return fname, f"FAIL exception: {ex}"
            time.sleep(3)
    return fname, "FAIL"


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    start = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(download_one, *v): v for v in VIDEOS}
        done = 0
        for fut in as_completed(futs):
            fname, msg = fut.result()
            done += 1
            results.append((fname, msg))
            print(f"[{done}/{len(VIDEOS)}] {fname}: {msg}", flush=True)
    ok = [r for r in results if r[1].startswith("OK")]
    skip = [r for r in results if r[1].startswith("SKIP")]
    fail = [r for r in results if not r[1].startswith(("OK", "SKIP"))]
    print(f"\n完成: 共{len(VIDEOS)} 成功{len(ok)} 跳过{len(skip)} 失败{len(fail)} 用时{time.time()-start:.0f}s")
    if fail:
        print("失败列表:")
        for f, m in fail:
            print(f"  {f}: {m}")
        with open(os.path.join(OUTDIR, "failed.txt"), "w") as f:
            for fn, m in fail:
                f.write(f"{fn}\t{m}\n")
    mp4s = [f for f in os.listdir(OUTDIR) if f.endswith(".mp4")]
    print(f"目录 {OUTDIR} 现有 mp4: {len(mp4s)}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
