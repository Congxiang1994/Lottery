#!/usr/bin/env python3
"""离线 IP 库（ip2region xdb）下载与更新。

用法
----
    # 服务器（推荐，走 mihomo 代理）
    /opt/lottery/backend/.venv/bin/python tools/geo_update.py
    /opt/lottery/backend/.venv/bin/python tools/geo_update.py --only v4
    /opt/lottery/backend/.venv/bin/python tools/geo_update.py --dir ./backend/.geo --no-proxy

    # 只看会下什么、不下
    /opt/lottery/backend/.venv/bin/python tools/geo_update.py --dry-run

多源降级（每个文件依次尝试，成功即停）
--------------------------------------
    1. jsDelivr CDN（**直连可用**，实测 200）
    2. GitHub raw（走代理，实测 200；非交互 shell 不读 .bashrc，故代理由本脚本自带）
    3. gitee 镜像（直连）

安全设计
--------
- 下载到 ``<目标>.tmp`` → 校验（大小 + ``verify_from_file`` + 抽样查询）→
  ``os.replace()`` **原子替换**。校验失败**绝不覆盖**现有文件 ——
  更新失败不影响正在跑的进程。
- 目标目录权限 0700、文件 0600（与其余 db 一致）。
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.access.ip2region import searcher as _searcher  # noqa: E402
from app.access.ip2region import util as _util  # noqa: E402

DEFAULT_PROXY = os.environ.get("LOTTERY_GEO_PROXY", "http://127.0.0.1:7890")

SOURCES: dict[str, list[tuple[str, bool]]] = {
    "v4": [
        ("https://cdn.jsdelivr.net/gh/lionsoul2014/ip2region@master/data/ip2region_v4.xdb", False),
        ("https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb", True),
        ("https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v4.xdb", False),
    ],
    "v6": [
        ("https://cdn.jsdelivr.net/gh/lionsoul2014/ip2region@master/data/ip2region_v6.xdb", False),
        ("https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v6.xdb", True),
        ("https://gitee.com/lionsoul/ip2region/raw/master/data/ip2region_v6.xdb", False),
    ],
}

MIN_BYTES = {"v4": 2 * 1024 * 1024, "v6": 5 * 1024 * 1024}

# 抽样对答案（实测已知值）
SAMPLES = {
    "v4": [("223.5.5.5", "浙江"), ("114.114.114.114", "江苏")],
    "v6": [],
}

UA = "Mozilla/5.0 (compatible; lottery-geo-update/1.0)"


def _opener(proxy: str | None):
    handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy} if proxy else {})
    return urllib.request.build_opener(handler)


def download(url: str, dst: Path, proxy: str | None, timeout: int = 300) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    total = 0
    with _opener(proxy).open(req, timeout=timeout) as r, open(dst, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
        total = f.tell()
    return total


def verify(path: Path, kind: str) -> tuple[bool, str]:
    """校验：大小 → xdb 结构与 binding 版本匹配 → 抽样查询对答案。"""
    size = path.stat().st_size
    if size < MIN_BYTES[kind]:
        return False, f"文件过小（{size} 字节，预期 ≥ {MIN_BYTES[kind]}）"
    try:
        _util.verify_from_file(str(path))
    except Exception as e:  # noqa: BLE001
        return False, f"xdb 校验失败：{e}"

    ver = _util.IPv4 if kind == "v4" else _util.IPv6
    try:
        idx = _util.load_vector_index_from_file(str(path))
        s = _searcher.new_with_vector_index(ver, str(path), idx)
    except Exception as e:  # noqa: BLE001
        return False, f"索引加载失败：{e}"
    try:
        header = _util.load_header_from_file(str(path))
        created = header.createdAt
    except Exception:  # noqa: BLE001
        created = 0

    notes = []
    for ip, expect in SAMPLES[kind]:
        try:
            got = s.search(ip) or ""
        except Exception as e:  # noqa: BLE001
            return False, f"抽样查询 {ip} 抛异常：{e}"
        if expect and expect not in got:
            return False, f"抽样查询 {ip} 返回 [{got}]，未含预期「{expect}」"
        notes.append(f"{ip} → {got}")
    s.close()
    msg = f"{size} 字节 · createdAt={created}" + (" · " + "; ".join(notes) if notes else "")
    return True, msg


def fetch_one(kind: str, out_dir: Path, proxy: str | None, dry_run: bool) -> bool:
    name = f"ip2region_{kind}.xdb"
    target = out_dir / name
    existing = target.stat().st_size if target.exists() else 0
    print(f"\n=== {name}（现有 {existing or '无'} 字节）===")
    if dry_run:
        for url, need_proxy in SOURCES[kind]:
            print(f"  [dry] {'代理' if need_proxy else '直连'} {url}")
        return True

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass

    tmp = target.with_suffix(target.suffix + ".tmp")
    for url, need_proxy in SOURCES[kind]:
        used_proxy = proxy if (need_proxy and proxy) else None
        label = f"代理 {used_proxy}" if used_proxy else "直连"
        print(f"  尝试（{label}）：{url}")
        try:
            size = download(url, tmp, used_proxy)
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            print(f"    ✗ 下载失败：{e}")
            continue
        ok, msg = verify(tmp, kind)
        if not ok:
            print(f"    ✗ 校验不通过：{msg}")
            continue
        os.replace(tmp, target)                 # 原子替换
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass
        print(f"    ✓ 已更新：{msg}")
        return True

    if tmp.exists():
        tmp.unlink(missing_ok=True)
    print(f"    ✗ 所有源均失败，**保留原有文件不动**（{name}）")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="下载/更新 ip2region 离线库")
    ap.add_argument("--dir", default=os.environ.get("LOTTERY_GEO_DIR", "/data/lottery/geo"),
                    help="目标目录（默认 $LOTTERY_GEO_DIR 或 /data/lottery/geo）")
    ap.add_argument("--only", choices=["v4", "v6"], help="只更新其中一个")
    ap.add_argument("--proxy", default=DEFAULT_PROXY, help=f"代理地址（默认 {DEFAULT_PROXY}）")
    ap.add_argument("--no-proxy", action="store_true", help="完全不用代理")
    ap.add_argument("--dry-run", action="store_true", help="只打印将要下载的源")
    args = ap.parse_args()

    out_dir = Path(args.dir).expanduser()
    proxy = None if args.no_proxy else args.proxy
    kinds = [args.only] if args.only else ["v4", "v6"]

    print(f"目标目录：{out_dir}")
    print(f"代理：{proxy or '（不使用）'}")
    ok_all = True
    for kind in kinds:
        ok_all = fetch_one(kind, out_dir, proxy, args.dry_run) and ok_all
    print("\n完成。" if ok_all else "\n有文件未更新（见上）。")
    return 0 if ok_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
