"""后端架构/风格一致性审计（AST 版）。**重构后再跑一遍，防止风格重新漂移。**

用法::

    cd backend && .venv/bin/python scripts/audit_style.py

退出码：0 = 无问题；1 = 有问题（逐条打印文件:行号 + 原因）。
已被注入式验证过：故意插一句 print / 去掉 status_code= 都会失败。

规则（每条都对应 docs/architecture.md 的硬性条款）：
1. 不在 import 时产生副作用（建目录 / 建表 / 连库）
2. 域之间不 import 对方的 router（只能依赖 store / service）
3. HTTPException 必须带 status_code=
4. 运行时路径不用裸 print（记录走 logging；__main__ / docstring 示例不算）
5. 每个域有 router.py
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "app"
issues: list[str] = []


def module_docstring_ids(tree: ast.Module) -> set[int]:
    """收集所有字符串常量节点的 id（docstring / 文档示例里的文字不算代码）。"""
    return {id(n) for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}


for f in sorted(ROOT.rglob("*.py")):
    if "__pycache__" in f.parts:
        continue
    src = f.read_text()
    tree = ast.parse(src)
    rel = f.relative_to(ROOT)
    strings = module_docstring_ids(tree)

    # ---- 1) import 副作用 ----
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            fn = node.value.func
            name = getattr(fn, "id", None) or getattr(fn, "attr", None)
            if name in {"mkdir", "makedirs", "executescript", "connect", "init"}:
                issues.append(f"{f}:{node.lineno} 模块级调用 {name}()（import 副作用）")

    # ---- 2) 跨域 router import ----
    # main.py 是**组合根**：它的职责就是 import 各域 router 并注册，属例外。
    if f.name == "main.py":
        own_pkg = None
    else:
        own_pkg = rel.parts[0]
    for node in (ast.walk(tree) if own_pkg else []):
        if isinstance(node, ast.ImportFrom) and node.module:
            parts = node.module.split(".")
            if len(parts) >= 2 and parts[0] == "app" and parts[1] != own_pkg and parts[1] != "common":
                if node.names and any(n.name == "router" for n in node.names):
                    issues.append(f"{f}: 跨域 import 了 {node.module}.router")

    # ---- 3) HTTPException 必须带 status_code= ----
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = getattr(fn, "id", None) or getattr(fn, "attr", None)
        if name != "HTTPException":
            continue
        if id(node) in strings:
            continue
        if not any(k.arg == "status_code" for k in node.keywords):
            issues.append(f"{f}:{node.lineno} HTTPException 缺 status_code=")

    # ---- 4) 运行时裸 print ----
    main_lines: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.If):
            t = node.test
            if (isinstance(t, ast.Compare) and isinstance(t.left, ast.Name)
                    and t.left.id == "__name__"):
                for sub in ast.walk(node):
                    if hasattr(sub, "lineno"):
                        main_lines.add(sub.lineno)
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "print" and node.lineno not in main_lines):
            issues.append(f"{f}:{node.lineno} 运行时裸 print（用 logging）")

# ---- 5) 域结构 ----
for d in sorted(p for p in ROOT.iterdir() if p.is_dir()):
    if d.name in ("common", "__pycache__") or not (d / "__init__.py").exists():
        continue
    if not (d / "router.py").exists():
        issues.append(f"{d}: 缺 router.py")

print(f"检查完成，问题 {len(issues)} 项")
for i in issues:
    print(" -", i)
sys.exit(1 if issues else 0)
