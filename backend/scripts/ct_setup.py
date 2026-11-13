#!/usr/bin/env python3
"""CT 报告分享：设置分享口令 + 导入报告 HTML。

用法::

    # 设置 / 改口令（明文只在命令行出现，不进仓库、不进日志）
    cd backend && .venv/bin/python scripts/ct_setup.py --password '1234'

    # 导入报告（整段 HTML 原样入库）
    cd backend && .venv/bin/python scripts/ct_setup.py --report '/path/to/CT检查结果.html'

    # 两件事一起做
    cd backend && .venv/bin/python scripts/ct_setup.py --password '1234' --report report.html

    # 查看当前状态（不打印口令）
    cd backend && .venv/bin/python scripts/ct_setup.py --status

退出码：0 成功；1 失败（**不做「测不到就跳过」**——校验类脚本失败一律非 0）。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 允许 `python scripts/ct_setup.py` 直接跑（把 backend/ 放进 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ⚠️ 必须在 import app.* 之前设置：库路径在 import 期就被解析。
# 服务器上就是 /data/lottery（生产库）；本地测试用 LOTTERY_DB_DIR 覆盖到临时目录。
os.environ.setdefault("LOTTERY_DB_DIR", "/data/lottery")

from app.common import password as password_store  # noqa: E402
from app.ctshare import config, store  # noqa: E402


def fail(msg: str) -> int:
    print(f"❌ {msg}", file=sys.stderr)
    return 1


def cmd_password(plain: str) -> int:
    if not plain:
        return fail("口令不能为空")
    store.init()
    password_store.set_password_in(config.DB_PATH, plain)
    # 改口令后清零失败计数，避免改完还锁着
    store.reset_failures()
    # 注入式验证：写完立刻回验一次（能过才算真的写进去了）
    ok = password_store.verify_in(config.DB_PATH, plain)
    if not ok:
        return fail("口令写入后回验失败 —— 库未生效")
    print(f"✅ 分享口令已写入 {config.DB_PATH}（scrypt 哈希，明文不落库），回验通过")
    return 0


def cmd_report(path_str: str) -> int:
    path = Path(path_str).expanduser()
    if not path.is_file():
        return fail(f"报告文件不存在：{path}")
    raw = path.read_bytes()
    if len(raw) > config.MAX_REPORT_BYTES:
        return fail(f"报告过大（{len(raw)} 字节），上限 {config.MAX_REPORT_BYTES} 字节")
    html = raw.decode("utf-8")
    store.init()
    title = store.extract_title(html)
    info = store.save_report(html, title)
    # 注入式验证：回读并比对摘要，证明「存进去的就是这份文件」
    back = store.get_report()
    if back is None:
        return fail("写入后回读为空")
    if back["sha256"] != info["sha256"]:
        return fail(f"回读摘要不一致：{back['sha256']} != {info['sha256']}")
    if back["html"].encode("utf-8") != raw:
        return fail("回读内容与源文件不一致（原样入库被破坏）")
    print(f"✅ 报告已导入 {config.DB_PATH}")
    print(f"   标题 {title!r} · 体积 {info['bytes']} 字节 · sha256 {info['sha256'][:16]}…")
    return 0


def cmd_status() -> int:
    store.init()
    meta = store.report_meta()
    configured = password_store.is_configured_in(config.DB_PATH)
    print(f"库路径: {config.DB_PATH}")
    print(f"分享口令: {'已配置' if configured else '未配置'}")
    if meta:
        print(f"报告: {meta['title'] or '(无标题)'} · {meta['bytes']} 字节 · "
              f"更新于 {meta['updated_at']} · sha256 {meta['sha256'][:16]}…")
    else:
        print("报告: 未导入")
    return 0 if configured and meta else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="CT 报告分享：设口令 / 导报告 / 看状态")
    parser.add_argument("--password", help="设置分享口令（覆盖式）")
    parser.add_argument("--report", help="导入报告 HTML 文件路径")
    parser.add_argument("--status", action="store_true", help="显示当前状态")
    args = parser.parse_args()

    if not (args.password or args.report or args.status):
        parser.print_help()
        return 1

    rc = 0
    if args.password:
        rc |= cmd_password(args.password)
    if args.report:
        rc |= cmd_report(args.report)
    if args.status or not (args.password or args.report):
        rc |= cmd_status()
    return rc


if __name__ == "__main__":
    sys.exit(main())
