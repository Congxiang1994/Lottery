"""汉字课视频列表接口。"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter

router = APIRouter(prefix="/api/hanzi", tags=["hanzi"])

# 视频目录（默认 /data/hanzi，可用环境变量覆盖，便于本地测试）
HANZI_DIR = Path(os.environ.get("HANZI_DIR", "/data/hanzi"))

VIDEO_EXTS = {".mp4", ".m4v", ".webm", ".mov"}


def _sort_key(p: Path) -> int:
    """按文件名前缀序号排序（001-日.mp4 → 1，108-立.mp4 → 108）。"""
    stem = p.stem
    num = stem.split("-", 1)[0].strip()
    try:
        return int(num)
    except ValueError:
        return 10**9


@router.get("/list")
def list_videos():
    """返回视频文件列表（按序号升序），供前端展示与检索。"""
    if not HANZI_DIR.is_dir():
        return {"total": 0, "videos": []}
    items = []
    for p in sorted(HANZI_DIR.iterdir(), key=_sort_key):
        if not p.is_file() or p.suffix.lower() not in VIDEO_EXTS:
            continue
        stem = p.stem
        num_part, _, title = stem.partition("-")
        try:
            num = int(num_part.strip())
        except ValueError:
            num = None
        items.append(
            {
                "id": num,
                "num": num,
                "title": title.strip(),
                "filename": p.name,
                "url": "/hanzi/" + quote(p.name),
            }
        )
    return {"total": len(items), "videos": items}
