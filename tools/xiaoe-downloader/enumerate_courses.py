#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小鹅通课程目录枚举工具

用 xe.course.business_go.column.items.get/2.0.0 分页拉取目录,
过滤出视频条目 (type=2), 生成 courses.py 供 download.py 使用。

用法:
  1. cp config.example.json config.json 并填 Cookie (需有该课程访问权限)
  2. python3 enumerate_courses.py            # 打印目录 + 生成 courses.py
     python3 enumerate_courses.py --dry-run  # 只打印, 不写文件
"""
import json
import os
import sys
import urllib.parse
import urllib.request

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
PAGE_SIZE = 50


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def http_post(cfg, path, data):
    base = cfg["base"].rstrip("/")
    req = urllib.request.Request(base + path, data=data.encode(), method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("User-Agent", cfg["ua"])
    req.add_header("Cookie", cfg["cookie"])
    req.add_header("Origin", base)
    req.add_header("Referer", base + "/p/course/column/" + cfg["product_id"])
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_all(cfg):
    items = []
    page = 1
    while True:
        body = urllib.parse.urlencode({
            "bizData[column_id]": cfg["product_id"],
            "bizData[page_index]": page,
            "bizData[page_size]": PAGE_SIZE,
            "bizData[sort]": "asc",
        })
        d = http_post(cfg, "/xe.course.business_go.column.items.get/2.0.0", body)
        if d.get("code") != 0:
            raise RuntimeError(f"column.items.get 失败: {d.get('msg')}")
        data = d["data"]
        batch = data.get("list") or []
        items.extend(batch)
        total = data.get("total", len(batch))
        if page * PAGE_SIZE >= total or len(batch) < PAGE_SIZE:
            break
        page += 1
    return items


def is_video(item):
    # 小鹅通 resource_type/type: 1=图文 2=视频 3=音频 ...
    t = item.get("resource_type", item.get("type"))
    try:
        return int(t) == 2
    except (TypeError, ValueError):
        return False


def extract_name(title):
    """从标题提取文件名: 去掉序号前缀, 如 '001 日' -> '日', '第1课 日月' -> '日月'"""
    import re
    s = re.sub(r"^\s*(?:第?\s*\d+\s*[课节话集]?|[\d０-９]+)\s*[、.\-_:： ]*", "", str(title))
    return s.strip() or str(title).strip()


def main():
    if "--dry-run" in sys.argv:
        dry = True
    else:
        dry = False
    cfg = load_config()
    print("拉取目录...")
    items = fetch_all(cfg)
    print(f"共 {len(items)} 条目录\n")

    videos = []
    for i, it in enumerate(items, 1):
        title = it.get("title", "?")
        # 兼容字段: 实测本店 id 为资源 id (早期笔记误记为 resource_id)
        rid = it.get("id") or it.get("resource_id")
        t = it.get("resource_type", it.get("type"))
        flag = "视频" if is_video(it) else f"type={t}"
        print(f"{i:3d} [{flag:6s}] {title}  ({rid})")
        if is_video(it) and rid:
            videos.append((len(videos) + 1, extract_name(title), rid))

    print(f"\n识别到视频 {len(videos)} 个")
    if dry:
        return 0

    lines = ["# -*- coding: utf-8 -*-", '"""由 enumerate_courses.py 自动生成, 格式: (序号, 名称, resource_id)"""', "", "VIDEOS = ["]
    row = []
    for seq, name, rid in videos:
        row.append(f"({seq}, {json.dumps(name, ensure_ascii=False)}, {json.dumps(rid)})")
    # 每行 3 个元组
    for i in range(0, len(row), 3):
        lines.append("    " + ", ".join(row[i:i + 3]) + ",")
    lines.append("]")
    lines.append("")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "courses.py")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    print(f"已写入 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
