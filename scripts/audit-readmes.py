#!/usr/bin/env python3
"""README 文档一致性审计（对应 docs/README-standard.md）。

用法::

    cd <仓库根> && python3 scripts/audit-readmes.py

退出码：0 = 全部合规；1 = 有问题（逐条打印 文件 + 原因）。
纯标准库，无依赖。检查项：

1. 每个第 2 层 README 的一级标题不含文件名 / 不使用数字编号章节
2. 章节顺序固定：速览 → 要点 → 接口/配置/命令速查 → 深入阅读
3. 速览表必需行齐全（入口 / 前端 / 后端 / 数据 / 鉴权 / 外部依赖）
4. 行数上限（门牌 README ≤ 80 行，工具 README ≤ 60 行）
5. 所有相对 Markdown 链接有效（含锚点前的路径部分）
6. 深入阅读必须链接到 docs/modules/<同名>.md，且该文件存在
7. 根 README 必须含四块：产品矩阵 / 快速开始 / 文档导航 / README-standard 链接
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
issues: list[str] = []

# 原版 README 的内容 md5（拆分前，2026-11-06）。归档无损校验不依赖 git，
# 服务器副本也能跑 —— 只比「归档正文还原链接后」是否等于这份基线。
# 若将来**有意**修订归档内容，更新这里对应的 md5 并在 commit 里说明。
BASELINE_MD5 = {
    "README_lottery.md": "2e4ef8413b388f05986aefe8c8e0118c",
    "README_hanzi.md": "43dc90019db946c8fb4b993fadbd4570",
    "README_babysong.md": "f860e5f89c52676dd9bc9ad388693f8b",
    "README_story.md": "1d86097eb9fa8955618802df92f3fc3b",
    "README_deals.md": "b9cfd7c59322155d845026ae8cfe1fef",
    "README_trigger.md": "a5483ef8b74fc4ea4f3aecec11a766a5",
    "README_access.md": "9476bd5e791bb3a80366269697c3905a",
    "tools/xiaoe-downloader/README.md": "340eb39db6b4d96d8e7d28cde9fefd4d",
}

MODULE_FILES = [
    "README_lottery.md", "README_hanzi.md", "README_babysong.md",
    "README_story.md", "README_deals.md", "README_trigger.md", "README_access.md",
]
TOOLS_FILE = "tools/xiaoe-downloader/README.md"

REQUIRED_ROWS = ["入口", "前端", "后端", "数据", "鉴权", "外部依赖"]
TOOL_ROWS = ["入口", "脚本", "数据", "鉴权", "外部依赖"]
SECTIONS = ["速览", "要点", "深入阅读"]
QUICK_SECTION = re.compile(r"^## (接口|配置|命令)速查$")


def fail(f: str, msg: str) -> None:
    issues.append(f"{f}: {msg}")


def check_links(src: Path) -> None:
    """校验文件里的相对 Markdown 链接能否打开。"""
    text = src.read_text(encoding="utf-8")
    for m in re.finditer(r"\[[^\]]*\]\(([^)]+)\)", text):
        target = m.group(1).split("#", 1)[0].strip()
        if not target or target.startswith(("http://", "https://", "mailto:")):
            continue
        resolved = (src.parent / target).resolve()
        if not resolved.exists():
            fail(str(src.relative_to(ROOT)), f"断链 → {target}")


def check_module(path: Path, *, tool: bool = False) -> None:
    rel = str(path.relative_to(ROOT))
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    # 1) 标题
    h1 = next((l for l in lines if l.startswith("# ")), "")
    if not h1 or h1.startswith("# README"):
        fail(rel, f"一级标题不规范（应为产品名，不含文件名）：{h1!r}")
    if tool and "🔒" in h1:
        fail(rel, "工具 README 不应有私有标记")

    # 2) 数字编号章节
    numbered = [l for l in lines if re.match(r"^## \d+\.", l)]
    if numbered:
        fail(rel, f"存在数字编号章节：{numbered[:2]}")

    # 3) 章节顺序
    h2 = [l[3:].strip() for l in lines if l.startswith("## ")]
    if "速览" not in h2 or "要点" not in h2 or "深入阅读" not in h2:
        fail(rel, f"缺必需章节（实际：{h2}）")
    has_quick = any(QUICK_SECTION.match("## " + s) for s in h2)
    if not has_quick:
        fail(rel, "缺「接口/配置/命令速查」章节")
    order = [s for s in h2 if s in ("速览", "要点", "深入阅读",
                                     "接口速查", "配置速查", "命令速查")]
    expect_order = ["速览", "要点", "接口速查", "深入阅读"]
    if tool:
        expect_order[2] = "命令速查"
    if order != expect_order:
        fail(rel, f"章节顺序应为 {expect_order}，实际 {order}")

    # 4) 速览表必需行
    table = text.split("## 速览", 1)[-1].split("## ", 1)[0]
    rows = [l.split("|")[1].strip() for l in table.splitlines()
            if l.startswith("|") and "---" not in l]
    rows = [r for r in rows if r and r != "项"]
    need = TOOL_ROWS if tool else REQUIRED_ROWS
    missing = [r for r in need if r not in rows]
    if missing:
        fail(rel, f"速览表缺行：{missing}")

    # 5) 行数
    limit = 60 if tool else 80
    if len(lines) > limit:
        fail(rel, f"{len(lines)} 行，超过门牌上限 {limit} 行（细节应放 docs/modules/）")

    # 6) 深入阅读链接到 docs/modules
    if "docs/modules/" not in text:
        fail(rel, "「深入阅读」未链接到 docs/modules/ 完整细节")

    check_links(path)


def main() -> int:
    # 模块 README
    for name in MODULE_FILES:
        p = ROOT / name
        if not p.exists():
            fail(name, "文件不存在")
            continue
        check_module(p)
        # 7) 归档文件存在且首行有标记
        stem = name.removeprefix("README_").removesuffix(".md")
        archived = ROOT / "docs" / "modules" / f"{stem}.md"
        if not archived.exists():
            fail(name, f"缺归档文件 docs/modules/{stem}.md")
        elif "保留历史全文" not in archived.read_text(encoding="utf-8")[:300]:
            fail(name, f"docs/modules/{stem}.md 首部缺归档说明")
        else:
            # 归档无损：正文（去掉 3 行归档头）还原回指链接后，与原版 md5 比对
            body = "\n".join(archived.read_text(encoding="utf-8").splitlines()[3:]) + "\n"
            norm = body.replace("](../../README.md)", "](./README.md)").replace(
                "](../", "](./docs/")
            digest = hashlib.md5(norm.encode("utf-8")).hexdigest()
            if digest != BASELINE_MD5[name]:
                fail(name, f"docs/modules/{stem}.md 正文与旧 README 不一致（细节可能被删改）")

    # 工具 README
    tool = ROOT / TOOLS_FILE
    check_module(tool, tool=True)
    arch_tool = ROOT / "docs/modules/xiaoe-downloader.md"
    if not arch_tool.exists():
        fail(TOOLS_FILE, "缺 docs/modules/xiaoe-downloader.md")
    else:
        body = "\n".join(arch_tool.read_text(encoding="utf-8").splitlines()[3:]) + "\n"
        if hashlib.md5(body.encode("utf-8")).hexdigest() != BASELINE_MD5[TOOLS_FILE]:
            fail(TOOLS_FILE, "docs/modules/xiaoe-downloader.md 正文与旧版不一致")

    # 根 README
    root = ROOT / "README.md"
    text = root.read_text(encoding="utf-8")
    for sec in ("产品矩阵", "快速开始", "文档导航"):
        if f"## {sec}" not in text:
            fail("README.md", f"缺章节「{sec}」")
    if "docs/README-standard.md" not in text:
        fail("README.md", "未链接 docs/README-standard.md")
    if len(text.splitlines()) > 130:
        fail("README.md", "根 README 超过 130 行，细节应下沉")
    check_links(root)

    # 归档文档自身的链接（它们的相对基准是 docs/modules/）
    for f in sorted((ROOT / "docs/modules").glob("*.md")):
        check_links(f)

    if issues:
        print(f"❌ README 一致性审计失败：{len(issues)} 项\n")
        for i in issues:
            print(" -", i)
        return 1
    n_arch = len(list((ROOT / "docs/modules").glob("*.md")))
    print(f"✅ README 一致性审计通过（{len(MODULE_FILES) + 1} 个 README + "
          f"{n_arch} 个归档文档 + 归档无损校验，0 问题）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
