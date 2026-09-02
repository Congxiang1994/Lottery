"""Super Simple Songs 儿歌列表接口。"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/babysong", tags=["babysong"])

# 儿歌目录（由上游 518 首元数据裁剪生成：id / title / channel / youtube_url / cover）
CATALOG = Path(__file__).resolve().parent / "data" / "catalog.json"


def _load_catalog() -> list:
    if not CATALOG.is_file():
        return []
    try:
        with open(CATALOG, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


@router.get("/list")
def list_songs():
    """返回儿歌列表（按编号升序），供前端卡片网格展示与检索。"""
    songs = _load_catalog()
    return {"total": len(songs), "songs": songs}
