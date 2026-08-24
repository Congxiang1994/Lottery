"""物理启发类算法（6 种）。

设计参考：Physics.py（布朗运动 / 热传导 / 弹簧振动 /
量子波动 / 混沌映射）以及 Chaos.py。

全部为**真实数值求解**，不是随机数包装：
* 布朗运动 → Ornstein-Uhlenbeck 均值回复过程参数估计 + 蒙特卡洛
* 混沌映射 → Logistic 映射轨道 + Lyapunov 指数
* 热传导   → 一维热方程显式有限差分（Neumann 边界）
* 弹簧振动 → 阻尼受迫振子半隐式欧拉积分，固有频率取号码平均间隔
* 量子波动 → 薛定谔方程哈密顿量对角化，取基态概率密度 |ψ₀|²
* 伊辛模型 → Metropolis 模拟退火求低能自旋构型
"""
from __future__ import annotations

import math

import numpy as np

from app.lottery.algorithms.base import AlgoContext, AlgoOutput, normalize, register

CAT = "physics"


def _norm_cdf_vec(z: np.ndarray) -> np.ndarray:
    return np.array([0.5 * (1.0 + math.erf(float(v) / math.sqrt(2.0))) for v in z])


def _moving_avg(H: np.ndarray, w: int) -> np.ndarray:
    n, m = H.shape
    cum = np.vstack([np.zeros((1, m)), np.cumsum(H, axis=0)])
    hi = np.arange(n) + 1
    lo = np.maximum(0, hi - w)
    return (cum[hi] - cum[lo]) / np.maximum(1, hi - lo)[:, None]


# ---------------------------------------------------------------- 1. 布朗运动

@register("brownian", "布朗运动/OU 均值回复", CAT,
          "把每个号码的出现率视作随机过程，用回归估计 Ornstein-Uhlenbeck "
          "参数 dp = θ(μ-p)dt + σdW，再做 4000 条路径蒙特卡洛，"
          "打分 = 下期出现率超过基准线的概率。",
          ["布朗运动", "OU过程", "均值回复", "蒙特卡洛", "随机微分方程"], cost=2)
def brownian(ctx: AlgoContext) -> AlgoOutput:
    win, paths = 20, 4000

    def side(H, max_n, k):
        n = H.shape[0]
        if n < win + 20:
            return np.full(max_n, 0.5), {}
        P = _moving_avg(H, win)
        x, y = P[:-1], P[1:]
        # 每号独立最小二乘：y = a·x + b  →  θ = 1-a, μ = b/(1-a)
        xm, ym = x.mean(axis=0), y.mean(axis=0)
        cov = ((x - xm) * (y - ym)).mean(axis=0)
        var = ((x - xm) ** 2).mean(axis=0) + 1e-12
        a = cov / var
        b = ym - a * xm
        resid = y - (a * x + b)
        sigma = resid.std(axis=0) + 1e-9
        theta = np.clip(1.0 - a, 0.0, 2.0)
        mu = np.where(np.abs(1.0 - a) > 1e-6, b / (1.0 - a + 1e-12), ym)
        p_now = P[-1]
        pred = p_now + theta * (mu - p_now)
        base = float(k) / max_n
        rng = np.random.default_rng(97)
        sims = pred[None, :] + sigma[None, :] * rng.standard_normal((paths, max_n))
        prob = (sims > base).mean(axis=0)
        return prob, {
            "θ均值(回复速度)": round(float(theta.mean()), 4),
            "σ均值(波动率)": round(float(sigma.mean()), 5),
            "基准出现率": round(base, 4),
        }

    r, dr = side(ctx.RH, ctx.red_max, ctx.red_count)
    b, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    dr.update({"原理": "dp = θ(μ-p)dt + σdW，AR(1) 回归估参 + 蒙特卡洛路径积分",
               "平滑窗口": win, "蒙特卡洛路径数": paths})
    return AlgoOutput(red=r, blue=b, detail=dr)


# ---------------------------------------------------------------- 2. 混沌映射

@register("chaos_logistic", "Logistic 混沌映射", CAT,
          "以号码的近期频率与遗漏构造初值 x₀，用 Logistic 映射 "
          "x' = r·x(1-x) 在 r∈[3.7,3.99] 的混沌区迭代 40 步，"
          "多参数集合平均得到打分，并给出 Lyapunov 指数验证混沌性。",
          ["混沌理论", "Logistic映射", "Lyapunov指数", "非线性动力学"], cost=1)
def chaos_logistic(ctx: AlgoContext) -> AlgoOutput:
    rs = np.array([3.70, 3.80, 3.90, 3.95, 3.99])
    steps = 40

    def side(H, max_n, omit_now):
        f = H[-60:].sum(axis=0) if H.shape[0] >= 60 else H.sum(axis=0)
        f = normalize(f)
        o = normalize(np.minimum(omit_now, 60))
        x0 = np.clip(0.5 * f + 0.5 * o, 0.02, 0.98)
        acc = np.zeros(max_n)
        lyap = []
        for r in rs:
            x = x0.copy()
            tail = []
            lsum = np.zeros(max_n)
            for s in range(steps):
                lsum += np.log(np.abs(r * (1.0 - 2.0 * x)) + 1e-12)
                x = r * x * (1.0 - x)
                if s >= steps - 10:
                    tail.append(x.copy())
            acc += np.mean(tail, axis=0)
            lyap.append(float((lsum / steps).mean()))
        return acc / len(rs), float(np.mean(lyap))

    r, l1 = side(ctx.RH, ctx.red_max, ctx.current_omission("red"))
    b, l2 = side(ctx.BH, ctx.blue_max, ctx.current_omission("blue"))
    return AlgoOutput(red=r, blue=b, detail={
        "原理": "x_{n+1} = r·x_n(1-x_n)，混沌区多 r 值轨道集合平均",
        "控制参数 r": [float(v) for v in rs],
        "迭代步数": steps,
        "红球Lyapunov指数": round(l1, 4),
        "蓝球Lyapunov指数": round(l2, 4),
        "混沌判定": "λ > 0 → 轨道对初值敏感（确定性混沌）",
        "初值构造": "x₀ = 0.5·归一化频率 + 0.5·归一化遗漏",
    })


# ---------------------------------------------------------------- 3. 热传导

@register("heat_diffusion", "热传导方程扩散", CAT,
          "把号码排成一维导热棒，最近若干期的开出记录作为指数衰减热源，"
          "用显式有限差分求解 ∂u/∂t = α∂²u/∂x²（Neumann 绝热边界）60 步，"
          "稳定后的温度场即为打分。",
          ["偏微分方程", "热传导方程", "有限差分", "Neumann边界", "扩散"], cost=2)
def heat_diffusion(ctx: AlgoContext) -> AlgoOutput:
    steps, cfl, decay, src_len = 60, 0.2, 0.85, 30

    def side(H, max_n):
        n = H.shape[0]
        L = min(src_len, n)
        w = decay ** np.arange(L)[::-1]
        u = (H[-L:] * w[:, None]).sum(axis=0)
        u = normalize(u).astype(np.float64)
        for _ in range(steps):
            lap = np.empty_like(u)
            lap[1:-1] = u[2:] - 2 * u[1:-1] + u[:-2]
            lap[0] = u[1] - u[0]          # 绝热边界 ∂u/∂x = 0
            lap[-1] = u[-2] - u[-1]
            u = u + cfl * lap
        return u

    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={
            "原理": "∂u/∂t = α∂²u/∂x²，显式差分 u⁺ = u + λ(u₊-2u+u₋)",
            "CFL 数 λ": cfl, "时间步数": steps,
            "热源": f"最近 {src_len} 期，指数衰减 γ={decay}",
            "边界条件": "Neumann（绝热）",
            "物理含义": "高频号码是热源，热量向邻号扩散 → 邻号温度升高",
        },
    )


# ---------------------------------------------------------------- 4. 弹簧振动

@register("spring_oscillator", "阻尼受迫振子共振", CAT,
          "每个号码建成一个阻尼受迫振子 ẍ + 2ζω·ẋ + ω²x = f(t)，"
          "固有频率 ω 取该号历史平均出现间隔的倒数，开出即施加冲量，"
          "半隐式欧拉积分到当前，打分 = 预测位移 + 系统能量。",
          ["振动力学", "阻尼振子", "共振", "数值积分", "半隐式欧拉"], cost=2)
def spring_oscillator(ctx: AlgoContext) -> AlgoOutput:
    zeta, dt = 0.08, 1.0

    def side(H, max_n, k):
        n = H.shape[0]
        L = min(n, 300)
        Hs = H[-L:]
        cnt = Hs.sum(axis=0)
        period = np.where(cnt > 0, L / np.maximum(cnt, 1), float(max_n) / max(k, 1) * 2)
        omega = 2.0 * math.pi / np.clip(period, 1.5, 200.0)
        x = np.zeros(max_n)
        v = np.zeros(max_n)
        for t in range(L):
            f = Hs[t]  # 开出 → 单位冲量
            acc = f - 2.0 * zeta * omega * v - (omega ** 2) * x
            v = v + acc * dt
            x = x + v * dt
        # 再自由演化一步，得到「下一期」的预测位移
        acc = -2.0 * zeta * omega * v - (omega ** 2) * x
        v_n = v + acc * dt
        x_n = x + v_n * dt
        energy = 0.5 * v_n ** 2 + 0.5 * (omega ** 2) * x_n ** 2
        return normalize(x_n) * 0.6 + normalize(energy) * 0.4, period

    r, pr = side(ctx.RH, ctx.red_max, ctx.red_count)
    b, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count)
    return AlgoOutput(red=r, blue=b, detail={
        "原理": "ẍ + 2ζωẋ + ω²x = f(t)，冲量响应 + 一步外推",
        "阻尼比 ζ": zeta, "积分步长 dt": dt, "回溯期数": 300,
        "固有周期范围": f"{pr.min():.1f} ~ {pr.max():.1f} 期",
        "打分": "0.6·归一化位移 + 0.4·归一化总能量",
        "物理含义": "出现节奏与固有频率共振的号码振幅最大",
    })


# ---------------------------------------------------------------- 5. 量子波动

@register("quantum_wave", "薛定谔方程波函数演化", CAT,
          "以遗漏与频率构造势场 V(x)，组装哈密顿量 H = -½∇² + V 并精确对角化，"
          "取基态概率密度 |ψ₀|² 与波包时间演化 |ψ(T)|² 的混合作为打分。",
          ["薛定谔方程", "哈密顿量", "本征分解", "波函数", "概率密度"], cost=2)
def quantum_wave(ctx: AlgoContext) -> AlgoOutput:
    T_evo = 6.0

    def side(H, max_n, omit_now):
        f = normalize(H[-60:].sum(axis=0) if H.shape[0] >= 60 else H.sum(axis=0))
        o = normalize(np.minimum(omit_now, 60))
        # 势阱：遗漏久 + 近期频率高 → 势能低 → 波函数聚集
        V = -(1.2 * o + 0.8 * f)
        # 动能项：-½∇²（三对角二阶差分）
        K = np.zeros((max_n, max_n))
        np.fill_diagonal(K, 1.0)
        idx = np.arange(max_n - 1)
        K[idx, idx + 1] = -0.5
        K[idx + 1, idx] = -0.5
        Ham = K + np.diag(V)
        vals, vecs = np.linalg.eigh(Ham)
        psi0 = vecs[:, 0]
        ground = psi0 ** 2
        # 波包演化：初态 = 上期开出号码的等权叠加
        init = H[-1].copy()
        if init.sum() < 1e-9:
            init = np.ones(max_n)
        init = init / np.linalg.norm(init)
        c = vecs.T @ init
        phase = np.exp(-1j * vals * T_evo)
        psi_t = vecs @ (c * phase)
        evolved = np.abs(psi_t) ** 2
        return normalize(ground) * 0.6 + normalize(evolved) * 0.4, vals[0]

    r, e0r = side(ctx.RH, ctx.red_max, ctx.current_omission("red"))
    b, _ = side(ctx.BH, ctx.blue_max, ctx.current_omission("blue"))
    return AlgoOutput(red=r, blue=b, detail={
        "原理": "H = -½∇² + V(x)，np.linalg.eigh 精确对角化",
        "势场构造": "V = -(1.2·归一化遗漏 + 0.8·归一化频率)",
        "基态能量 E₀": round(float(e0r), 4),
        "演化时间 T": T_evo,
        "打分": "0.6·|ψ₀|² + 0.4·|ψ(T)|²（Born 规则概率密度）",
        "初态": "上期开出号码的等权叠加态",
    })


# ---------------------------------------------------------------- 6. 伊辛模型退火

@register("ising_anneal", "伊辛模型模拟退火", CAT,
          "号码视作自旋 sᵢ∈{±1}，耦合 Jᵢⱼ 取历史共现相关系数，"
          "外场 hᵢ 取频率与遗漏，用 Metropolis 模拟退火（T: 2.0→0.05）"
          "求低能构型，打分 = 低温阶段自旋向上的时间占比。",
          ["伊辛模型", "模拟退火", "Metropolis", "统计力学", "自旋玻璃"], cost=3)
def ising_anneal(ctx: AlgoContext) -> AlgoOutput:
    sweeps, restarts = 120, 3
    T_hi, T_lo = 2.0, 0.05

    def side(H, max_n, k, seed):
        n = H.shape[0]
        Hs = H[-min(n, 400):]
        # 耦合：共现相关（去均值后的相关矩阵，抑制对角）
        Z = Hs - Hs.mean(axis=0)
        sd = Z.std(axis=0) + 1e-9
        C = (Z / sd).T @ (Z / sd) / Hs.shape[0]
        np.fill_diagonal(C, 0.0)
        J = C / (np.abs(C).max() + 1e-9) * 0.5
        f = normalize(Hs[-60:].sum(axis=0)) if Hs.shape[0] >= 60 else normalize(Hs.sum(axis=0))
        o = normalize(np.minimum(ctx.current_omission("red" if max_n == ctx.red_max else "blue"), 60))
        h = (f - 0.5) + 0.8 * (o - 0.5)
        # 化学势：约束向上自旋数 ≈ 开奖个数
        mu = -math.log(max(1.0, (max_n - k) / max(k, 1))) * 0.25

        rng = np.random.default_rng(seed)
        up = np.zeros(max_n)
        samples = 0
        temps = np.geomspace(T_hi, T_lo, sweeps)
        for _ in range(restarts):
            s = rng.choice([-1.0, 1.0], size=max_n)
            for si, Temp in enumerate(temps):
                order = rng.permutation(max_n)
                for i in order:
                    local = float(J[i] @ s) + h[i] + mu
                    dE = 2.0 * s[i] * local
                    if dE < 0 or rng.random() < math.exp(-dE / Temp):
                        s[i] = -s[i]
                if si >= sweeps - 20:  # 低温阶段采样
                    up += (s > 0)
                    samples += 1
        return up / max(samples, 1), float(-0.5 * (s @ (J @ s)) - h @ s)

    r, er = side(ctx.RH, ctx.red_max, ctx.red_count, 31337)
    b, _ = side(ctx.BH, ctx.blue_max, ctx.blue_count, 4242)
    return AlgoOutput(red=r, blue=b, detail={
        "原理": "E = -Σ Jᵢⱼsᵢsⱼ - Σ hᵢsᵢ，Metropolis 判据 exp(-ΔE/T)",
        "退火温度": f"{T_hi} → {T_lo}（几何降温 {sweeps} 步）",
        "重启次数": restarts,
        "耦合 J": "历史共现相关矩阵（归一到 ±0.5）",
        "外场 h": "归一化频率 + 0.8·归一化遗漏",
        "末态能量": round(er, 4),
        "打分": "低温 20 个 sweep 内自旋向上的时间占比",
    })
