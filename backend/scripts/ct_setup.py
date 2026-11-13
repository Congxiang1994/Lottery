#!/usr/bin/env python3
"""CT 检查记录：设置分享口令 / 查看状态。

用法::

    # 设置 / 改分享口令（明文只在命令行出现，不进仓库、不进日志）
    cd backend && .venv/bin/python scripts/ct_setup.py --password '120120'

    # 查看当前状态（不打印口令、不打印照片内容）
    cd backend && .venv/bin/python scripts/ct_setup.py --status

    # 两件事一起做
    cd backend && .venv/bin/python scripts/ct_setup.py --password '120120' --status

⚠️ 结构化数据（检查记录 / 照片）不再由脚本导入，改在 /ct-admin 管理页维护；
   老 HTML 报告由 ``scripts/ct_migrate.py`` 一次性迁移。

退出码：0 成功；1 失败（校验类脚本失败一律非 0，不做「测不到就跳过」）。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# 允许 `python scripts/ct_setup.py` 直接跑（把 backend/ 放进 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
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
    store.reset_failures()
    # 注入式验证：写完立刻回验一次（能过才算真的写进去了）
    if not password_store.verify_in(config.DB_PATH, plain):
        return fail("口令写入后回验失败 —— 库未生效")
    print(f"✅ 分享口令已写入 {config.DB_PATH}（scrypt 哈希，明文不落库），回验通过")
    return 0


def cmd_status() -> int:
    store.init()
    s = store.stats()
    configured = password_store.is_configured_in(config.DB_PATH)
    print(f"库路径: {config.DB_PATH}")
    print(f"分享口令: {'已配置' if configured else '未配置'}")
    print(f"检查记录: {s['exams']} 次 · 照片: {s['photos']} 张")
    print(f"照片目录: {config.PHOTO_DIR}（{'存在' if config.PHOTO_DIR.is_dir() else '不存在'}）")
    return 0 if configured else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="CT 检查记录：设分享口令 / 看状态")
    parser.add_argument("--password", help="设置分享口令（覆盖式）")
    parser.add_argument("--status", action="store_true", help="显示当前状态")
    args = parser.parse_args()

    if not (args.password or args.status):
        parser.print_help()
        return 1

    rc = 0
    if args.password:
        rc |= cmd_password(args.password)
    if args.status:
        rc |= cmd_status()
    return rc


if __name__ == "__main__":
    sys.exit(main())
