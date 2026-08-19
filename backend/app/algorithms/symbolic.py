"""符号回归类算法（3 种）。

设计参考：PySR.py（PySR 符号回归）、
Formula.py（显式公式搜索）。

工程说明
--------
原项目调用 PySR（依赖 Julia 运行时 + 多进程）。本服务器不装 Julia，
故用纯 numpy 手写**遗传编程（GP）符号回归**：在 {+,-,×,÷,sin,cos,log,√,x²}
算子空间上演化表达式树，适应度 = 表达式输出与「下期是否开出」的相关系数，
并带简约惩罚（parsimony）。这是真正的符号回归搜索，只是搜索预算更小。

另含两个可解释派生实现：
* formula_grid —— 参数化公式的网格穷举 + 历史命中率择优
* sisso —— 非线性特征字典 + 正交匹配追踪稀疏筛选（SISSO 思路）
"""
from __future__ import annotations

import math

import numpy as np

from app.algorithms.base import (
    AlgoContext,
    AlgoOutput,
    normalize,
    register,
)

CAT = "symbolic"


# ---------------------------------------------------------------- 号码级特征

FEAT_NAMES = ["f10", "f30", "f100", "omit", "gap", "pos", "par", "m3", "last", "nb"]


def _num_features(ctx: AlgoContext, side: str):
    """构造「号码级」特征张量。

    返回 (Fh, Y, Fnow)
        Fh   (T, m, K) 时刻 t 的每号特征
        Y    (T, m)    时刻 t+1 该号是否开出
        Fnow (m, K)    当前最新一期的每号特征（用于预测下一期）
    """
    key = f"symfeat_{side}"

    def build():
        H = ctx.RH if side == "red" else ctx.BH
        omit = ctx.R_omit if side == "red" else ctx.B_omit
        n, m = H.shape
        cum = np.vstack([np.zeros((1, m)), np.cumsum(H, axis=0)])  # (n+1, m)
        hi = np.arange(n) + 1

        def win_freq(w: int) -> np.ndarray:
            lo = np.maximum(0, hi - w)
            return (cum[hi] - cum[lo]) / float(w)

        f10, f30, f100 = win_freq(10), win_freq(30), win_freq(100)
        om = np.minimum(omit, 60.0) / 60.0
        cnt = cum[hi]
        gap = np.minimum((hi[:, None]) / (cnt + 1.0), 60.0) / 60.0
        pos = np.tile((np.arange(m) + 1) / m, (n, 1))
        par = np.tile(((np.arange(m) + 1) % 2).astype(float), (n, 1))
        m3 = np.tile((((np.arange(m) + 1) % 3) / 2.0), (n, 1))
        last = H.copy()
        nb = np.zeros_like(H)
        nb[:, 1:] += H[:, :-1]
        nb[:, :-1] += H[:, 1:]
        nb = np.clip(nb, 0, 1)

        F = np.stack([f10, f30, f100, om, gap, pos, par, m3, last, nb], axis=2)
        F = np.nan_to_num(F, nan=0.0, posinf=0.0, neginf=0.0)
        Fh, Y, Fnow = F[:-1], H[1:], F[-1]
        T = min(len(Fh), 500)
        return Fh[-T:], Y[-T:], Fnow

    return ctx.cache(key, build)


def _standardize(Fh: np.ndarray, Fnow: np.ndarray):
    K = Fh.shape[2]
    flat = Fh.reshape(-1, K)
    mu, sd = flat.mean(axis=0), flat.std(axis=0) + 1e-9
    return (flat - mu) / sd, (Fnow - mu) / sd


# ---------------------------------------------------------------- GP 表达式

UNARY = ("sin", "cos", "log", "sqrt", "sq", "neg")
BINARY = ("add", "sub", "mul", "div")


def _rand_tree(rng: np.random.Generator, K: int, depth: int):
    if depth <= 0 or rng.random() < 0.28:
        if rng.random() < 0.78:
            return ("x", int(rng.integers(K)))
        return ("c", round(float(rng.uniform(-2.0, 2.0)), 2))
    if rng.random() < 0.62:
        op = BINARY[int(rng.integers(len(BINARY)))]
        return (op, _rand_tree(rng, K, depth - 1), _rand_tree(rng, K, depth - 1))
    op = UNARY[int(rng.integers(len(UNARY)))]
    return (op, _rand_tree(rng, K, depth - 1))


def _eval(tree, X: np.ndarray) -> np.ndarray:
    op = tree[0]
    if op == "x":
        return X[:, tree[1]]
    if op == "c":
        return np.full(X.shape[0], tree[1])
    if op in BINARY:
        a, b = _eval(tree[1], X), _eval(tree[2], X)
        if op == "add":
            r = a + b
        elif op == "sub":
            r = a - b
        elif op == "mul":
            r = a * b
        else:  # 保护除法
            r = a / np.where(np.abs(b) < 1e-6, 1.0, b)
    else:
        a = _eval(tree[1], X)
        if op == "sin":
            r = np.sin(a)
        elif op == "cos":
            r = np.cos(a)
        elif op == "log":
            r = np.log(np.abs(a) + 1e-6)
        elif op == "sqrt":
            r = np.sqrt(np.abs(a))
        elif op == "sq":
            r = a * a
        else:
            r = -a
    return np.nan_to_num(np.clip(r, -1e6, 1e6), nan=0.0, posinf=0.0, neginf=0.0)


def _size(tree) -> int:
    if tree[0] in ("x", "c"):
        return 1
    return 1 + sum(_size(t) for t in tree[1:])


def _to_str(tree) -> str:
    op = tree[0]
    if op == "x":
        return FEAT_NAMES[tree[1]] if tree[1] < len(FEAT_NAMES) else f"x{tree[1]}"
    if op == "c":
        return f"{tree[1]:g}"
    if op in BINARY:
        sym = {"add": "+", "sub": "-", "mul": "*", "div": "/"}[op]
        return f"({_to_str(tree[1])} {sym} {_to_str(tree[2])})"
    label = {"sq": "square", "neg": "-"}.get(op, op)
    return f"{label}({_to_str(tree[1])})"


def _nodes(tree, path=()):
    yield path, tree
    if tree[0] not in ("x", "c"):
        for i, sub in enumerate(tree[1:], start=1):
            yield from _nodes(sub, path + (i,))


def _replace(tree, path, new):
    if not path:
        return new
    i = path[0]
    parts = list(tree)
    parts[i] = _replace(tree[i], path[1:], new)
    return tuple(parts)


def _corr(pred: np.ndarray, y: np.ndarray) -> float:
    ps = pred.std()
    if ps < 1e-9:
        return 0.0
    p = (pred - pred.mean()) / ps
    return float(abs((p * y).mean()))


# ---------------------------------------------------------------- 1. GP 符号回归

@register("gp_symbolic", "遗传编程符号回归", CAT,
          "在 {+,-,×,÷,sin,cos,log,√,x²} 算子空间上用遗传编程演化表达式树，"
          "适应度 = 公式输出与「下期开出」的相关系数 - 简约惩罚，"
          "输出可读的显式数学公式（PySR 同类方法的轻量实现）。",
          ["遗传编程", "符号回归", "表达式树", "可解释公式", "PySR同类"], cost=4)
def gp_symbolic(ctx: AlgoContext) -> AlgoOutput:
    pop_size, gens, depth = 60, 18, 3
    parsimony = 0.0015

    def side(name: str, max_n: int, seed: int):
        Fh, Y, Fnow = _num_features(ctx, name)
        if Fh.shape[0] < 30:
            return np.full(max_n, 0.5), {}
        X, Xnow = _standardize(Fh, Fnow)
        K = X.shape[1]
        y = Y.reshape(-1)
        ys = y.std()
        if ys < 1e-9:
            return np.full(max_n, 0.5), {}
        yz = (y - y.mean()) / ys

        rng = np.random.default_rng(seed)
        pop = [_rand_tree(rng, K, depth) for _ in range(pop_size)]

        def fit(tree):
            return _corr(_eval(tree, X), yz) - parsimony * _size(tree)

        scored = sorted(((fit(t), t) for t in pop), key=lambda kv: -kv[0])
        for _ in range(gens):
            elite = [t for _, t in scored[:6]]
            children: list = list(elite)
            while len(children) < pop_size:
                # 锦标赛选择
                cand = [scored[int(rng.integers(len(scored)))] for _ in range(3)]
                pa = max(cand, key=lambda kv: kv[0])[1]
                cand = [scored[int(rng.integers(len(scored)))] for _ in range(3)]
                pb = max(cand, key=lambda kv: kv[0])[1]
                r = rng.random()
                if r < 0.55:  # 子树交叉
                    pas = [p for p, _ in _nodes(pa)]
                    pbs = [(p, t) for p, t in _nodes(pb)]
                    cut = pas[int(rng.integers(len(pas)))]
                    graft = pbs[int(rng.integers(len(pbs)))][1]
                    child = _replace(pa, cut, graft)
                elif r < 0.85:  # 子树变异
                    pas = [p for p, _ in _nodes(pa)]
                    cut = pas[int(rng.integers(len(pas)))]
                    child = _replace(pa, cut, _rand_tree(rng, K, 2))
                else:  # 新血
                    child = _rand_tree(rng, K, depth)
                if _size(child) <= 24:
                    children.append(child)
            scored = sorted(((fit(t), t) for t in children), key=lambda kv: -kv[0])

        best_fit, best = scored[0]
        pred_hist = _eval(best, X)
        sign = 1.0
        ph = (pred_hist - pred_hist.mean()) / (pred_hist.std() + 1e-9)
        if float((ph * yz).mean()) < 0:
            sign = -1.0
        raw = sign * _eval(best, Xnow.reshape(max_n, -1))
        return normalize(raw), {
            "公式": _to_str(best),
            "表达式节点数": _size(best),
            "适应度(相关系数-简约罚)": round(float(best_fit), 4),
            "符号方向": "正相关" if sign > 0 else "负相关（取反）",
        }

    r, dr = side("red", ctx.red_max, 20240817)
    b, db = side("blue", ctx.blue_max, 771)
    detail = {
        "原理": "GP 演化表达式树 f(f10,f30,f100,omit,gap,pos,par,m3,last,nb)",
        "种群/代数": f"{pop_size} / {gens}",
        "算子集": "+ - × ÷ sin cos log √ x² neg",
        "简约惩罚系数": parsimony,
        "红球公式": dr.get("公式", "-"),
        "蓝球公式": db.get("公式", "-"),
        "红球适应度": dr.get("适应度(相关系数-简约罚)"),
    }
    return AlgoOutput(red=r, blue=b, detail=detail)


# ---------------------------------------------------------------- 2. 公式网格穷举

@register("formula_grid", "参数化公式网格寻优", CAT,
          "把打分写成 score = w₁·z(近频) + w₂·z(中频) + w₃·z(遗漏) + w₄·z(邻号) + w₅·z(位置)，"
          "在 3⁵ 权重网格上穷举，用最近 150 期滚动回测的命中数择优。",
          ["网格穷举", "滚动回测", "权重寻优", "可解释"], cost=3)
def formula_grid(ctx: AlgoContext) -> AlgoOutput:
    use = [0, 1, 3, 9, 5]  # f10, f30, omit, nb, pos
    levels = np.array([-1.0, 0.0, 1.0])
    grid = np.array(np.meshgrid(*([levels] * len(use)), indexing="ij")).reshape(len(use), -1)

    def side(name: str, max_n: int, k: int):
        Fh, Y, Fnow = _num_features(ctx, name)
        if Fh.shape[0] < 40:
            return np.full(max_n, 0.5), {}
        T = min(Fh.shape[0], 150)
        Fh, Y = Fh[-T:], Y[-T:]
        Z = Fh[:, :, use].reshape(-1, len(use))
        mu, sd = Z.mean(axis=0), Z.std(axis=0) + 1e-9
        Z = ((Z - mu) / sd).reshape(T, max_n, len(use))
        S = np.tensordot(Z, grid, axes=([2], [0]))  # (T, m, G)
        G = S.shape[2]
        S = np.transpose(S, (2, 0, 1))  # (G, T, m)
        idx = np.argpartition(-S, k - 1, axis=2)[:, :, :k]
        hits = np.take_along_axis(np.broadcast_to(Y, (G, T, max_n)), idx, axis=2).sum(axis=(1, 2))
        g = int(np.argmax(hits))
        w = grid[:, g]
        znow = (Fnow[:, use] - mu) / sd
        return normalize(znow @ w), {
            "最优权重": {FEAT_NAMES[u]: float(wi) for u, wi in zip(use, w)},
            "回测命中数": int(hits[g]),
            "理论期望命中": round(float(T * k * k / max_n), 1),
            "候选公式数": int(G),
        }

    r, dr = side("red", ctx.red_max, ctx.red_count)
    b, db = side("blue", ctx.blue_max, ctx.blue_count)
    detail = {
        "原理": "线性可解释打分函数 + 网格穷举 + 滚动回测择优",
        "参与特征": [FEAT_NAMES[u] for u in use],
        "回测期数": 150,
        "红球最优权重": dr.get("最优权重"),
        "红球回测命中/期望": f"{dr.get('回测命中数')} / {dr.get('理论期望命中')}",
        "蓝球回测命中": db.get("回测命中数"),
    }
    return AlgoOutput(red=r, blue=b, detail=detail)


# ---------------------------------------------------------------- 3. SISSO 稀疏筛选

@register("sisso", "非线性字典稀疏筛选(SISSO)", CAT,
          "先由基础特征生成平方/乘积/比值/对数等非线性组合构成特征字典，"
          "再用正交匹配追踪（OMP）贪心挑出最多 5 项、最小二乘定系数，"
          "得到稀疏可解释的显式表达式（SISSO 思路）。",
          ["SISSO", "特征字典", "正交匹配追踪", "稀疏回归"], cost=3)
def sisso(ctx: AlgoContext) -> AlgoOutput:
    n_terms = 5

    def dictionary(X: np.ndarray):
        cols, names = [], []
        K = X.shape[1]
        for i in range(K):
            cols.append(X[:, i]); names.append(FEAT_NAMES[i])
        for i in range(K):
            cols.append(X[:, i] ** 2); names.append(f"{FEAT_NAMES[i]}²")
        for i in range(K):
            for j in range(i + 1, K):
                cols.append(X[:, i] * X[:, j])
                names.append(f"{FEAT_NAMES[i]}·{FEAT_NAMES[j]}")
        for i in range(4):
            for j in range(4):
                if i != j:
                    cols.append(X[:, i] / np.where(np.abs(X[:, j]) < 1e-3, 1.0, X[:, j]))
                    names.append(f"{FEAT_NAMES[i]}/{FEAT_NAMES[j]}")
        for i in range(4):
            cols.append(np.log(np.abs(X[:, i]) + 1e-3)); names.append(f"log|{FEAT_NAMES[i]}|")
        D = np.stack(cols, axis=1)
        return np.nan_to_num(np.clip(D, -1e6, 1e6), nan=0.0, posinf=0.0, neginf=0.0), names

    def side(name: str, max_n: int):
        Fh, Y, Fnow = _num_features(ctx, name)
        if Fh.shape[0] < 40:
            return np.full(max_n, 0.5), {}
        X, Xnow = _standardize(Fh, Fnow)
        D, names = dictionary(X)
        Dn, _ = dictionary(Xnow.reshape(max_n, -1))
        mu, sd = D.mean(axis=0), D.std(axis=0) + 1e-9
        D = (D - mu) / sd
        Dn = (Dn - mu) / sd
        y = Y.reshape(-1)
        yc = y - y.mean()
        resid = yc.copy()
        chosen: list[int] = []
        for _ in range(n_terms):
            corr = np.abs(D.T @ resid) / len(y)
            corr[chosen] = -1.0
            j = int(np.argmax(corr))
            chosen.append(j)
            A = D[:, chosen]
            coef, *_ = np.linalg.lstsq(A, yc, rcond=None)
            resid = yc - A @ coef
        A = D[:, chosen]
        coef, *_ = np.linalg.lstsq(A, yc, rcond=None)
        ss = float((yc ** 2).sum()) + 1e-12
        r2 = 1.0 - float((resid ** 2).sum()) / ss
        expr = " + ".join(f"{c:+.3f}·{names[j]}" for c, j in zip(coef, chosen))
        return normalize(Dn[:, chosen] @ coef), {
            "稀疏表达式": expr,
            "字典规模": int(D.shape[1]),
            "R²": round(r2, 5),
        }

    r, dr = side("red", ctx.red_max)
    b, db = side("blue", ctx.blue_max)
    detail = {
        "原理": "非线性特征字典 → OMP 贪心选 5 项 → 最小二乘定系数",
        "字典构造": "原特征 / 平方 / 两两乘积 / 比值 / log|·|",
        "红球表达式": dr.get("稀疏表达式", "-"),
        "红球 R²": dr.get("R²"),
        "蓝球表达式": db.get("稀疏表达式", "-"),
        "字典规模": dr.get("字典规模"),
    }
    return AlgoOutput(red=r, blue=b, detail=detail)
