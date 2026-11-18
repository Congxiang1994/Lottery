"""汉字拼读课视频列表接口。

数据来源有两层，按优先级降级：

1. ``meta.json``（下载器生成）——**首选**：保留完整标题（如「第7讲 漂亮的姜姓女子就要出嫁了」），
   以及封面、真实时长。视频文件名受文件系统限制，长标题会被截断，不适合直接展示。
2. 扫描目录文件名 ——**兜底**：``meta.json`` 缺失或损坏时仍能列出视频
   （标题退化为文件名中 ``-`` 之后的部分，无封面、时长未知）。

为什么不让前端拼标题：文件系统对文件名长度/字符有限制，且改标题要重命名文件；
``meta.json`` 只改一行 JSON，不动字节流。
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter

from app.pinzi.config import META_NAME, PINZI_DIR, VIDEO_EXTS

router = APIRouter(prefix="/api/pinzi", tags=["pinzi"])

# 静态资源前缀（Nginx 直服，与前端约定一致）
VIDEO_PREFIX = "/pinzi/"
COVER_PREFIX = "/pinzi/covers/"


def _seq_of(p: Path) -> int:
    """文件名前缀序号（001-先导篇.mp4 → 1），非数字排最后。"""
    try:
        return int(p.stem.split("-", 1)[0].strip())
    except ValueError:
        return 10**9


def _load_meta() -> dict[int, dict]:
    """读 meta.json，失败一律返回空 dict（降级到扫目录，绝不让接口 500）。"""
    path = PINZI_DIR / META_NAME
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: dict[int, dict] = {}
    if isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            seq = row.get("seq")
            if isinstance(seq, int):
                out[seq] = row
    return out


@router.get("/list")
def list_videos():
    """返回视频列表（按序号升序），供前端展示与检索。"""
    if not PINZI_DIR.is_dir():
        return {"total": 0, "videos": []}

    meta = _load_meta()
    items = []
    for p in sorted(PINZI_DIR.iterdir(), key=_seq_of):
        if not p.is_file() or p.suffix.lower() not in VIDEO_EXTS:
            continue
        seq = _seq_of(p)
        fallback_title = p.stem.partition("-")[2].strip() or p.stem
        row = meta.get(seq) or {}
        title = (row.get("title") or "").strip() or fallback_title
        cover = (row.get("cover") or "").strip()
        dur = row.get("duration") or 0
        items.append(
            {
                "seq": seq,
                "title": title,
                "filename": p.name,
                "duration": dur,
                "cover": (COVER_PREFIX + cover.split("/", 1)[-1]) if cover else "",
                "url": VIDEO_PREFIX + quote(p.name),
            }
        )
    return {"total": len(items), "videos": items}
