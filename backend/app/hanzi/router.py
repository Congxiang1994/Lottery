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

# 108 个汉字的拼音映射（按课程顺序）
PINYIN_MAP = {
    "日": "ri", "月": "yue", "山": "shan", "水": "shui", "云": "yun",
    "雨": "yu", "木": "mu", "林": "lin", "森": "sen", "果": "guo",
    "鸟": "niao", "乌": "wu", "龟": "gui", "兔": "tu", "鹿": "lu",
    "象": "xiang", "狐": "hu", "虎": "hu", "毛": "mao", "爪": "zhao",
    "牛": "niu", "羊": "yang", "马": "ma", "鱼": "yu", "贝": "bei",
    "虫": "chong", "角": "jiao", "羽": "yu", "火": "huo", "石": "shi",
    "土": "tu", "田": "tian", "苗": "miao", "禾": "he", "瓜": "gua",
    "栗": "li", "家": "jia", "井": "jing", "门": "men", "户": "hu",
    "竹": "zhu", "鸡": "ji", "犬": "quan", "燕": "yan", "鼠": "shu",
    "人": "ren", "从": "cong", "众": "zhong", "子": "zi", "儿": "er",
    "女": "nv", "好": "hao", "保": "bao", "手": "shou", "耳": "er",
    "口": "kou", "齿": "chi", "目": "mu", "眉": "mei", "心": "xin",
    "夫": "fu", "夹": "jia", "老": "lao", "黑": "hei", "美": "mei",
    "尾": "wei", "尿": "niao", "屎": "shi", "刀": "dao", "弓": "gong",
    "车": "che", "舟": "zhou", "伞": "san", "网": "wang", "衣": "yi",
    "巾": "jin", "勺": "shao", "肉": "rou", "酒": "jiu", "壶": "hu",
    "米": "mi", "仓": "cang", "舍": "she", "高": "gao", "力": "li",
    "男": "nan", "看": "kan", "见": "jian", "采": "cai", "休": "xiu",
    "安": "an", "闯": "chuang", "天": "tian", "气": "qi", "晶": "jing",
    "明": "ming", "光": "guang", "电": "dian", "雷": "lei", "雪": "xue",
    "虹": "hong", "上": "shang", "下": "xia", "中": "zhong", "大": "da",
    "小": "xiao", "坐": "zuo", "立": "li",
}


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
        py = PINYIN_MAP.get(title.strip(), "")
        items.append(
            {
                "id": num,
                "num": num,
                "title": title.strip(),
                "pinyin": py,
                "pinyin_first": py[0] if py else "",
                "filename": p.name,
                "url": "/hanzi/" + quote(p.name),
            }
        )
    return {"total": len(items), "videos": items}
