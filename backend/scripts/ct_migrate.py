#!/usr/bin/env python3
"""把旧版「整段 HTML 报告」迁移成结构化检查记录 + 照片文件。

用法::

    cd backend && .venv/bin/python scripts/ct_migrate.py --status
    cd backend && .venv/bin/python scripts/ct_migrate.py            # 执行迁移
    cd backend && .venv/bin/python scripts/ct_migrate.py --dry-run  # 只看会迁成什么

流程
----
1. 从 ``ct_report`` 表读出旧 HTML（若表已不存在 → 已迁移过，直接退出 0）
2. 用标准库 ``html.parser`` 解析出每个 ``<section>`` 的：
   检查时间 / 检查项目 / 影像链接（文字 + URL）/ base64 照片
3. 每条写成 ``ct_exam``，照片解码落 ``PHOTO_DIR`` 并写 ``ct_photo``
4. **全部校验通过后再 DROP TABLE ct_report**（用户明确要求迁移后删掉）

⚠️ 幂等：迁移前若 ``ct_exam`` 已有数据则**拒绝执行**（避免重复插入），
   需要重迁请先手动清空。失败一律非 0 退出，且 DROP 前校验：
   条数一致 / 照片数与解析数一致 / 每个照片文件都能读回。
"""
from __future__ import annotations

import base64
import html as html_module
import os
import re
import sys
import uuid
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("LOTTERY_DB_DIR", "/data/lottery")

from app.ctshare import config, store  # noqa: E402


class ReportParser(HTMLParser):
    """把报告正文解析成 4 个 section 的字段（标准库，无第三方依赖）。

    ⚠️ 只读解析，不改原文。容错：缺字段就留空，不因格式差异中断迁移。
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.exams: list[dict] = []
        self._in_section = False
        self._cur: dict | None = None
        self._in_p = False
        self._p_text: list[str] = []
        self._in_a = False
        self._a_text: list[str] = []
        self._a_href = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section":
            self._in_section = True
            self._cur = {"exam_time": "", "project": "", "link_label": "",
                         "link_url": "", "link_text": "", "note": "", "photos": []}
        elif tag == "p" and self._in_section:
            self._in_p = True
            self._p_text = []
        elif tag == "a" and self._in_section:
            self._in_a = True
            self._a_text = []
            self._a_href = a.get("href", "")
        elif tag == "img" and self._in_section and self._cur is not None:
            src = a.get("src", "")
            if src.startswith("data:image/"):
                self._cur["photos"].append(src)

    def handle_data(self, data):
        if self._in_p:
            self._p_text.append(data)
        if self._in_a:
            self._a_text.append(data)

    def handle_endtag(self, tag):
        if tag == "p" and self._in_section:
            text = "".join(self._p_text).strip()
            self._classify(text)
            self._in_p = False
            self._p_text = []
        elif tag == "a" and self._in_section:
            label = "".join(self._a_text).strip()
            if self._a_href and self._cur is not None:
                self._cur["link_url"] = self._a_href[:config.MAX_LINK_URL_LEN]
                self._cur["link_label"] = label[:config.MAX_LINK_LABEL_LEN]
            self._in_a = False
            self._a_text = []
            self._a_href = ""
        elif tag == "section" and self._in_section:
            if self._cur is not None:
                self.exams.append(self._cur)
            self._in_section = False
            self._cur = None

    def _classify(self, text: str) -> None:
        if not text or self._cur is None:
            return
        m = re.match(r"^检查时间\s*[：:]\s*(.+)$", text)
        if m:
            self._cur["exam_time"] = m.group(1).strip()[:config.MAX_TIME_LEN]
            return
        m = re.match(r"^检查项目\s*[：:]\s*(.+)$", text)
        if m:
            self._cur["project"] = m.group(1).strip()[:config.MAX_PROJECT_LEN]
            return
        m = re.match(r"^影像链接\s*[：:]\s*(.*)$", text)
        if m:
            # 「影像链接：【身份证后6位：255617】」这类提示文字保留下来
            self._cur["link_text"] = m.group(1).strip()[:config.MAX_LINK_TEXT_LEN]
            return
        # 其余行（如「报告照片：」）不入库；「暂无…」这类说明并进备注
        if text.startswith("报告照片"):
            return
        if self._cur["note"]:
            self._cur["note"] += "\n" + text
        else:
            self._cur["note"] = text


def decode_photo(data_url: str) -> tuple[bytes, str] | None:
    """``data:image/jpeg;base64,xxx`` → (bytes, ext)。格式不对返回 None。"""
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$", data_url)
    if not m:
        return None
    mime, payload = m.group(1).lower(), re.sub(r"\s+", "", m.group(2))
    ext = config.PHOTO_MIME_EXT.get(mime)
    if not ext:
        return None
    try:
        return base64.b64decode(payload, validate=True), ext
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return None


def do_migrate(dry_run: bool) -> int:
    store.init()
    if not store.legacy_table_exists():
        print("✅ 旧 ct_report 表不存在 —— 已迁移过，无需操作")
        return 0

    existing = store.list_exams()
    if existing:
        print(f"❌ ct_exam 已有 {len(existing)} 条记录，拒绝重复迁移（如需重迁请先清空）",
              file=sys.stderr)
        return 1

    raw = store.get_legacy_html()
    if not raw:
        print("❌ 旧表存在但没有报告内容，无法迁移", file=sys.stderr)
        return 1

    parser = ReportParser()
    parser.feed(raw)
    exams = parser.exams
    if not exams:
        print("❌ 从旧 HTML 没解析出任何检查记录（section 结构可能变了）", file=sys.stderr)
        return 1

    photo_total = sum(len(e["photos"]) for e in exams)
    print(f"解析结果：{len(exams)} 次检查，{photo_total} 张照片")
    for i, e in enumerate(exams, 1):
        print(f"  第 {i} 次 | {e['exam_time']} | {e['project']} | "
              f"照片 {len(e['photos'])} 张 | 链接 {'有' if e['link_url'] else '无'}")

    # 先验证所有照片都能解码，避免迁了一半才发现坏数据
    decoded: list[list[tuple[bytes, str]]] = []
    for e in exams:
        row = []
        for src in e["photos"]:
            d = decode_photo(src)
            if d is None:
                print("❌ 有照片无法解码，迁移中止（未写入任何数据）", file=sys.stderr)
                return 1
            row.append(d)
        decoded.append(row)

    if dry_run:
        print("（--dry-run：未写入任何数据）")
        return 0

    config.PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    created_ids: list[int] = []
    created_files: list[Path] = []
    try:
        for e, photos in zip(exams, decoded):
            fields = {k: e[k] for k in
                      ("exam_time", "project", "link_label", "link_url", "link_text", "note")}
            exam = store.create_exam(fields)
            created_ids.append(exam["id"])
            for content, ext in photos:
                filename = f"{uuid.uuid4().hex}{ext}"
                path = config.PHOTO_DIR / filename
                path.write_bytes(content)
                created_files.append(path)
                with store.get_conn(config.DB_PATH) as con:
                    con.execute(
                        "INSERT INTO ct_photo (exam_id, filename, caption, sort_order, created_at) "
                        "VALUES (?,?,?,?,?)",
                        (exam["id"], filename, f"{e['exam_time']} 报告照片",
                         len(created_files), store._now()))
    except Exception as exc:  # noqa: BLE001
        print(f"❌ 迁移写入失败，回滚：{exc}", file=sys.stderr)
        _rollback(created_ids, created_files)
        return 1

    # ---- DROP 前的硬校验（不通过就不删旧表） ----
    final_exams = store.list_exams()
    final_photos = store.list_photos()
    if len(final_exams) != len(exams) or len(final_photos) != photo_total:
        print(f"❌ 落库复核失败：记录 {len(final_exams)}/{len(exams)}、"
              f"照片 {len(final_photos)}/{photo_total}，保留旧表以便排查", file=sys.stderr)
        return 1
    for p in final_photos:
        path = store.photo_path(p["filename"])
        if path is None or not path.is_file() or path.stat().st_size == 0:
            print(f"❌ 照片文件校验失败：{p['filename']}，保留旧表", file=sys.stderr)
            return 1

    store.drop_legacy_table()
    if store.legacy_table_exists():
        print("❌ DROP TABLE 未生效", file=sys.stderr)
        return 1
    print(f"✅ 迁移完成：{len(final_exams)} 次检查 + {len(final_photos)} 张照片，"
          f"旧 ct_report 表已删除")
    print(f"   照片目录：{config.PHOTO_DIR}")
    return 0


def _rollback(exam_ids: list[int], files: list[Path]) -> None:
    """迁移失败时清掉半成品（照片文件 + 记录）。"""
    for p in files:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass
    if not exam_ids:
        return
    with store.get_conn(config.DB_PATH) as con:
        con.executemany("DELETE FROM ct_photo WHERE exam_id=?", [(i,) for i in exam_ids])
        con.executemany("DELETE FROM ct_exam WHERE id=?", [(i,) for i in exam_ids])


def main() -> int:
    args = sys.argv[1:]
    dry = "--dry-run" in args
    if "--status" in args:
        store.init()
        print(f"旧表存在: {store.legacy_table_exists()}")
        print(f"现有检查记录: {len(store.list_exams())} 条")
        print(f"现有照片: {len(store.list_photos())} 张")
        print(f"照片目录: {config.PHOTO_DIR}（{'存在' if config.PHOTO_DIR.is_dir() else '不存在'}）")
        return 0
    return do_migrate(dry)


if __name__ == "__main__":
    sys.exit(main())
