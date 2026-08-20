"""平台解析逻辑（移植自 hantang/smartedu-dl-go 的 internal/dl，MIT）。

实现目录树拉取、课时解析、资源解析（URL -> 可下载文件列表）。
"""
from __future__ import annotations

import json
import re
import random
from typing import Any

import requests

from .config import (
    CATALOG, RESOURCE_URLS, SERVER_LIST, COURSE_PARTS_URL, COURSE_TREE_URL,
    RESOURCES_PATH,
)

# 全局 HTTP 会话（连接复用）
_http = requests.Session()
_http.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})

DIM_ID_ORDERS = ["zxxxd", "zxxnj", "zxxxk", "zxxbb", "zxxcc", "zxxxjjc"]


def fetch_json(url: str, headers: dict | None = None) -> Any | None:
    """请求并解析 JSON；失败返回 None。"""
    try:
        r = _http.get(url, headers=headers, timeout=60)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None


def _pick_server() -> str:
    return random.choice(SERVER_LIST)


# ---------------------------------------------------------------------------
# 目录树（教材 / 课程教学）
# ---------------------------------------------------------------------------

def _filter_tags(tags: list) -> list:
    has_high = any(t.get("tag_dimension_id") == "zxxxd" and t.get("tag_name") == "高中" for t in tags)
    pattern = re.compile(r"[一二三四五六七八九至]+年级")
    out = [t for t in tags if t.get("tag_dimension_id") != "zxxnj"]
    if not has_high:
        for t in tags:
            if t.get("tag_dimension_id") == "zxxnj" and not pattern.match(t.get("tag_name", "")):
                return []
            out.append(t)
    return out


def _concat_tag_path(tags: list, dim_orders: list) -> str:
    tags = _filter_tags(tags)
    if not tags:
        return ""
    dim_to_tag = {t.get("tag_dimension_id"): t.get("tag_id") for t in tags}
    parts = [dim_to_tag[d] for d in dim_orders if d in dim_to_tag]
    return "/".join(parts)


def parse_data(data: Any) -> tuple[dict, list]:
    """解析 part json -> (tagMap, docPDFList)。"""
    tag_map: dict = {}
    doc_list: list = []
    if not isinstance(data, list):
        return tag_map, doc_list
    for item in data:
        for tag in item.get("tag_list", []) or []:
            tag_map[tag.get("tag_id")] = tag.get("tag_name")
        tag_paths = item.get("tag_paths")
        if not tag_paths:
            new_path = _concat_tag_path(item.get("tag_list", []) or [], DIM_ID_ORDERS)
            if not new_path:
                continue
            tag_paths = [new_path]
        for tag_path in tag_paths:
            parts = str(tag_path).split("/")
            doc_list.append({
                "ID": item.get("id"),
                "Title": item.get("title"),
                "TagPath": tag_path,
                "TagID": parts[-1],
            })
    return tag_map, doc_list


def parse_urls_from_json(data: Any) -> list:
    urls = data.get("urls") if isinstance(data, dict) else None
    if isinstance(urls, str):
        return urls.split(",")
    if isinstance(urls, list):
        return [u for u in urls if isinstance(u, str)]
    return []


def _parse_hierarchies2(level: int, tag_item: dict, tag_map: dict) -> dict:
    hierarchies = tag_item.get("hierarchies")
    if not hierarchies:
        return {
            "Level": level, "Name": "-", "TagID": tag_item.get("tag_id"),
            "TagName": tag_map.get(tag_item.get("tag_id", ""), ""),
            "BookID": "", "BookName": "", "IsBook": False, "Children": [],
        }
    h = hierarchies[0]
    node = {
        "Level": level, "Name": h.get("hierarchy_name", ""),
        "TagName": tag_item.get("tag_name", ""), "TagID": tag_item.get("tag_id", ""),
        "BookID": "", "BookName": "", "IsBook": False, "Children": [],
    }
    for child in h.get("children", []) or []:
        node["Children"].append(_parse_hierarchies2(level + 1, child, tag_map))
    return node


def _update_hierarchies(base: dict, tag_map: dict, doc_list: list) -> None:
    for doc in doc_list:
        tag_path = doc["TagPath"].split("/")
        prev = base
        cur = base
        start = 1 if tag_path and tag_path[0] == base.get("TagID") else 0
        for i in range(start, len(tag_path)):
            cid = tag_path[i]
            prev = cur
            cur = None
            flag = False
            if prev and prev.get("Children"):
                for j, ch in enumerate(prev["Children"]):
                    if ch.get("TagID") == cid:
                        cur = ch
                        flag = True
                        break
            if flag and i + 1 < len(tag_path):
                continue
            new_node = {
                "Level": prev.get("Level", 0) + 1,
                "Name": tag_map.get(cid, cid), "TagName": tag_map.get(cid, cid),
                "TagID": cid, "BookID": "", "BookName": "",
                "IsBook": i == len(tag_path) - 1, "Children": [],
            }
            if i == len(tag_path) - 1:
                new_node["BookName"] = doc["Title"]
                new_node["BookID"] = doc["ID"]
            if flag:
                cur["Children"].append(new_node)
                break
            prev["Children"].append(new_node)
            for ch in prev["Children"]:
                if ch.get("TagID") == cid:
                    cur = ch
                    flag = True
                    break


def fetch_catalog(catalog_type: str) -> dict:
    """返回目录树（BookItem 结构）。catalog_type: textbook / course。"""
    cfg = CATALOG[catalog_type]
    tag_data = fetch_json(cfg["tag"]) or {}
    version_data = fetch_json(cfg["version"]) or {}
    urls = parse_urls_from_json(version_data)
    data_list = [fetch_json(u) for u in urls]
    data_list = [d for d in data_list if d is not None]

    tag_map: dict = {}
    doc_list: list = []
    for d in data_list:
        tm, dl = parse_data(d)
        tag_map.update(tm)
        doc_list.extend(dl)

    hiers = tag_data.get("hierarchies", [])
    if not hiers:
        return {"Level": 0, "Name": "", "TagID": "", "TagName": "",
                "BookID": "", "BookName": "", "IsBook": False, "Children": []}
    h0 = hiers[0]
    children = [_parse_hierarchies2(1, c, tag_map) for c in (h0.get("children", []) or [])]
    base = {
        "Level": 0, "Name": h0.get("hierarchy_name", ""), "TagName": "",
        "TagID": tag_data.get("tag_id", ""), "BookID": "", "BookName": "",
        "IsBook": False, "Children": children,
    }
    _update_hierarchies(base, tag_map, doc_list)
    return base


# ---------------------------------------------------------------------------
# 课程课时
# ---------------------------------------------------------------------------

def parse_course_id(course_id: str) -> list:
    """返回课时目录（CourseToc 列表）。"""
    server = _pick_server()
    parts_data = fetch_json(COURSE_PARTS_URL % (server, course_id))
    if parts_data is None:
        return []
    urls = parts_data if isinstance(parts_data, list) else []
    course_info: list = []
    for u in urls:
        d = fetch_json(u)
        if isinstance(d, list):
            course_info.extend(d)
    if not course_info:
        return []
    teach_id = (course_info[0].get("teachmeterial_ids") or [None])[0]
    if not teach_id:
        return []
    tree_data = fetch_json(COURSE_TREE_URL % (server, teach_id))
    if not isinstance(tree_data, list):
        return []
    course_dict = {}
    for c in course_info:
        rt = c.get("resource_type_code")
        if rt in ("national_lesson", "elite_lesson"):
            for ch in (c.get("chapter_paths") or []):
                course_dict[ch] = c

    toc: list = []
    for idx, chapter in enumerate(tree_data):
        items = _collect_course_items(chapter, course_dict, [])
        if items:
            toc.append({"Index": idx, "Title": chapter.get("title", ""), "Children": items})
    return toc


def _collect_course_items(chapter: dict, course_dict: dict, parents: list) -> list:
    items = []
    title = chapter.get("title", "")
    children = chapter.get("child_nodes") or []
    if not children:
        node_path = chapter.get("node_path")
        if node_path in course_dict:
            info = course_dict[node_path]
            items.append({
                "Title": " / ".join(filter(None, (parents[-1:] + [title]))) if parents else title,
                "NodeTitle": title, "NodeParents": list(parents),
                "NodeID": chapter.get("id"), "NodePath": node_path,
                "CourseID": info.get("id"), "ResourceType": info.get("resource_type_code"),
                "CourseTitle": info.get("title"),
            })
    else:
        for ch in children:
            items.extend(_collect_course_items(ch, course_dict, parents + [title]))
    return items


# ---------------------------------------------------------------------------
# 资源解析（URL -> LinkData 列表）
# ---------------------------------------------------------------------------

def generate_url_from_id(items: list) -> list:
    """把选中的教材/课时项转成详情 URL 列表。
    items: [{kind: textbook|course|elite_course, id}]
    """
    urls = []
    for it in items:
        kind = it.get("kind")
        rid = it.get("id")
        if not rid:
            continue
        if kind == "textbook":
            urls.append(RESOURCE_URLS["textbook"]["detail"] % rid)
        elif kind == "elite_course":
            urls.append(RESOURCE_URLS["elite_course"]["detail"] % rid)
        else:  # course
            urls.append(RESOURCE_URLS["course"]["detail"] % rid)
    return urls


def extract_resources(urls: list, format_list: list, use_backup: bool = True,
                      headers: dict | None = None) -> list:
    """解析详情 URL，返回 LinkData 列表（含直链）。"""
    result: list = []
    headers = headers or {}
    for url in urls:
        if RESOURCES_PATH in url:
            # 直接资源链接
            item = _link_from_resource_url(url)
            if item and item["Format"] in format_list:
                result.append(item)
            continue
        # 解析详情 URL -> json
        data_url = _url_to_json(url, use_backup)
        if not data_url:
            continue
        data = fetch_json(data_url, headers=headers)
        if data is None:
            continue
        links = _parse_links(data, format_list)
        result.extend(links)
    # 去重（按 backup url path）+ 重名处理
    result = _dedup(result)
    return result


def _url_to_json(page_url: str, use_backup: bool) -> str | None:
    """把平台页面 URL 转成 json 数据地址。"""
    from urllib.parse import urlparse, parse_qs
    p = urlparse(page_url)
    path = p.path
    q = parse_qs(p.query)
    server = _pick_server()

    def get(k):
        v = q.get(k)
        return v[0] if v else ""

    if path == "/tchMaterial/detail":
        cid = get("contentId")
        return RESOURCE_URLS["textbook"]["basic"] % (server, cid)
    if path == "/syncClassroom/classActivity":
        aid = get("activityId")
        return RESOURCE_URLS["course"]["basic"] % (server, aid)
    if path == "/qualityCourse":
        cid = get("courseId")
        return RESOURCE_URLS["elite_course"]["basic"] % (server, cid)
    return None


def _parse_links(data: Any, format_list: list) -> list:
    links: list = []
    items = _extract_resource_items(data)
    for it in items:
        title = it.get("custom_properties", {}).get("original_title") or it.get("title") or ""
        alias = it.get("custom_properties", {}).get("alias_name") or ""
        if alias:
            title = f"{title}-{alias}" if title else alias
        raw_link = ""
        fmt = ""
        size = 0
        for ti in it.get("ti_items", []) or []:
            fmt = ti.get("ti_format", "")
            if fmt == "folder":
                fmt = _mime_to_fmt(ti.get("lc_ti_format", ""))
            storages = ti.get("ti_storages", []) or []
            if fmt not in format_list or not storages:
                continue
            raw_link = storages[0]
            size = ti.get("ti_size") or 0
            for req in ti.get("custom_properties", {}).get("requirements", []) or []:
                if req.get("name") == "total_size" and req.get("value"):
                    try:
                        size = int(req["value"][0])
                    except (ValueError, TypeError):
                        pass
                if fmt == "folder" and req.get("name") == "fileRange" and req.get("value"):
                    raw_link = raw_link.rstrip("/") + "/" + req["value"][0].lstrip("/")
            if raw_link:
                break
        if not raw_link or not title:
            continue
        links.append({
            "Format": fmt, "Title": title,
            "Folder": it.get("custom_properties", {}).get("teachingmaterial_info", {}).get("title", ""),
            "ID": it.get("id"), "RawURL": raw_link, "BackupURL": _convert_url(raw_link),
            "Size": size,
        })
    return links


def _extract_resource_items(data: Any) -> list:
    # 课程包/课时 结构：relations 里的某个列表
    if isinstance(data, dict):
        rel = data.get("relations") or {}
        for key, val in rel.items():
            if isinstance(val, list) and val:
                return val
        # 单个 resource item
        if data.get("ti_items"):
            return [data]
    if isinstance(data, list):
        return data
    return []


def _mime_to_fmt(mime: str) -> str:
    m = {
        "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/ogg": "ogg",
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
        "video/m3u8": "m3u8", "application/zip": "zip", "text/plain": "txt",
        "application/json": "json",
    }
    return m.get(mime, mime.split("/")[-1] if "/" in mime else mime)


def _convert_url(raw: str) -> str:
    # 去掉 ndr-private，尝试把 pkg/<name>.pdf 转为 pdf.pdf（备用地址）
    link = raw.replace("ndr-private.", "ndr.")
    link = re.sub(r"(/[\w-]+)\.pkg/[\w-]+\.pdf$", r"\1.pkg/pdf.pdf", link)
    return link


def _link_from_resource_url(url: str) -> dict | None:
    from urllib.parse import urlparse
    import os
    ext = os.path.splitext(urlparse(url).path)[1].lstrip(".")
    if not ext:
        return None
    m = re.search(r"/assets/([\w-]+)", url)
    rid = m.group(1) if m else ""
    return {
        "Format": ext, "Title": ext.upper(), "Folder": "", "ID": rid,
        "RawURL": url, "BackupURL": _convert_url(url), "Size": -1,
    }


def _dedup(links: list) -> list:
    seen = set()
    out = []
    for l in links:
        from urllib.parse import urlparse
        key = urlparse(l["BackupURL"]).path
        if key in seen:
            continue
        seen.add(key)
        out.append(l)
    # 重名处理
    counts: dict = {}
    for l in out:
        counts[l["Title"]] = counts.get(l["Title"], 0) + 1
    seen2: dict = {}
    for l in out:
        t = l["Title"]
        if seen2.get(t):
            l["Title"] = f"{t}_{l['ID']}" if l.get("ID") else f"{t} ({seen2[t]})"
        seen2[t] = seen2.get(t, 0) + 1
    return out


# 公开去重接口
dedup = _dedup
