"""时间序列类算法（9 种）。

设计参考：seed3.py 的时序方法族（ARIMA/季节性分解/VAR/Holt-Winters）、
BVAR.py 的趋势/季节性分解与傅里叶特征、Gua.py 的 FFT 周期分析。
"""
from __future__ import annotations

import numpy as np

from app.lottery.algorithms.base import AlgoContext, AlgoOutput, normalize, register

CAT = "timeseries"


# ---------------------------------------------------------------- 1. EWMA

@register("ewma", "EWMA 指数加权移动平均", CAT,
          "对每个号码的 0/1 出现序列做指数加权移动平均（α=0.08），得到平滑后的即时出现率。",
          ["EWMA", "指数平滑", "在线估计"])
def ewma(ctx: AlgoContext) -> AlgoOutput:
    alpha = 0.08

    def side(H, max_n):
        s = np.asarray(H[:20].mean(axis=0) if ctx.n >= 20 else np.zeros(max_n), dtype=float)
        for t in range(ctx.n):
            s = alpha * H[t] + (1 - alpha) * s
        return s
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "S_t = α·x_t + (1-α)·S_{t-1}",
                "α": alpha, "等效窗口": round(2 / alpha - 1, 1)},
    )


# ---------------------------------------------------------------- 2. 移动平均趋势

@register("ma_trend", "多尺度移动平均趋势", CAT,
          "同时计算 5/10/20/50 期移动平均出现率，用短期均线相对长期均线的斜向偏离度判定上升趋势。",
          ["移动平均", "多尺度", "金叉死叉"])
def ma_trend(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        ma5 = H[-5:].mean(axis=0)
        ma10 = H[-10:].mean(axis=0)
        ma20 = H[-20:].mean(axis=0)
        ma50 = H[-50:].mean(axis=0)
        # 类似均线多头排列打分
        return (0.4 * (ma5 - ma10) + 0.35 * (ma10 - ma20)
                + 0.25 * (ma20 - ma50) + 0.1 * ma5)
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "0.4(MA5-MA10) + 0.35(MA10-MA20) + 0.25(MA20-MA50) + 0.1·MA5",
                "均线周期": [5, 10, 20, 50]},
    )


# ---------------------------------------------------------------- 3. Holt-Winters

@register("holt_winters", "Holt-Winters 三次指数平滑", CAT,
          "对出现率序列做水平 + 趋势 + 季节性三重指数平滑（周期 =7 期），外推下一期水平。",
          ["Holt-Winters", "三次指数平滑", "趋势", "季节性"], cost=2)
def holt_winters(ctx: AlgoContext) -> AlgoOutput:
    a, b_, g = 0.12, 0.04, 0.06
    period = 7

    def side(H, max_n):
        out = np.zeros(max_n)
        for j in range(max_n):
            y = H[:, j]
            if len(y) < 3 * period:
                out[j] = y.mean()
                continue
            level = y[:period].mean()
            trend = (y[period:2 * period].mean() - level) / period
            season = y[:period] - level
            for t in range(len(y)):
                s_idx = t % period
                prev_level = level
                val = y[t]
                level = a * (val - season[s_idx]) + (1 - a) * (level + trend)
                trend = b_ * (level - prev_level) + (1 - b_) * trend
                season[s_idx] = g * (val - level) + (1 - g) * season[s_idx]
            out[j] = level + trend + season[len(y) % period]
        return out
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "L_t/T_t/S_t 三重更新，预测 ŷ = L + T + S",
                "α(水平)": a, "β(趋势)": b_, "γ(季节)": g, "季节周期": period},
    )


# ---------------------------------------------------------------- 4. AR 自回归

@register("ar_model", "AR(p) 自回归模型", CAT,
          "对每个号码的出现序列拟合 AR(8) 自回归模型（最小二乘求解 Yule-Walker 方程），外推下期值。",
          ["自回归", "AR模型", "最小二乘", "ARIMA族"], cost=2)
def ar_model(ctx: AlgoContext) -> AlgoOutput:
    p = 8

    def side(H, max_n):
        out = np.zeros(max_n)
        n = ctx.n
        if n <= p + 5:
            return H.mean(axis=0)
        for j in range(max_n):
            y = H[:, j]
            # 构造设计矩阵
            X = np.stack([y[i:n - p + i] for i in range(p)], axis=1)
            target = y[p:]
            X = np.hstack([X, np.ones((len(X), 1))])
            # 岭正则最小二乘（数值稳定）
            lam = 1e-3
            coef = np.linalg.solve(X.T @ X + lam * np.eye(X.shape[1]), X.T @ target)
            last = np.append(y[-p:], 1.0)
            out[j] = float(last @ coef)
        return out
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "y_t = Σ φᵢ·y_{t-i} + c + ε，岭正则最小二乘估计 φ",
                "阶数 p": p, "正则化 λ": 1e-3},
    )


# ---------------------------------------------------------------- 5. VAR 向量自回归

@register("var_model", "VAR 向量自回归", CAT,
          "把整个号码出现向量作为多维状态，用降维后的向量自回归建模号码间的联动关系（BVAR 的频率派版本）。",
          ["VAR", "向量自回归", "PCA降维", "多元时序"], cost=3)
def var_model(ctx: AlgoContext) -> AlgoOutput:
    k = 12  # 主成分数

    def side(H, max_n) -> tuple[np.ndarray, int, float]:
        n = ctx.n
        if n < 60 or max_n < 3:
            return H.mean(axis=0), 0, 0.0
        Xc = H - H.mean(axis=0)
        # PCA（SVD）
        U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
        kk = int(min(k, len(S), max_n))
        Z = U[:, :kk] * S[:kk]              # 主成分得分 (n, kk)
        # VAR(1) on Z
        A_in, A_out = Z[:-1], Z[1:]
        lam = 1e-2
        W = np.linalg.solve(A_in.T @ A_in + lam * np.eye(kk), A_in.T @ A_out)
        z_next = Z[-1] @ W
        recon = z_next @ Vt[:kk] + H.mean(axis=0)
        return recon, kk, float(S[:kk].sum() / max(S.sum(), 1e-12))

    r, kk, ev = side(ctx.RH, ctx.red_max)
    b, _, _ = side(ctx.BH, ctx.blue_max)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "PCA 降维 → Z_{t+1} = Z_t·W（岭回归）→ 逆变换回号码空间",
                "主成分数": kk, "累计解释方差": round(ev, 4), "滞后阶": 1},
    )


# ---------------------------------------------------------------- 6. FFT 周期分析

@register("fft_cycle", "FFT 傅里叶周期分析", CAT,
          "对每个号码的出现序列做快速傅里叶变换，提取主频周期并按当前相位推算下期出现概率。",
          ["FFT", "傅里叶变换", "频谱分析", "相位外推"], cost=2)
def fft_cycle(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        out = np.zeros(max_n)
        periods = []
        n = ctx.n
        for j in range(max_n):
            y = H[:, j] - H[:, j].mean()
            spec = np.fft.rfft(y)
            power = np.abs(spec) ** 2
            if len(power) > 3:
                power[0] = 0
                idx = int(np.argmax(power[1:]) + 1)
                period = n / idx if idx else n
                periods.append(period)
                # 用主频重构信号并外推一步
                filt = np.zeros_like(spec)
                top = np.argsort(-power)[:3]
                filt[top] = spec[top]
                rec = np.fft.irfft(filt, n=n)
                slope = rec[-1] - rec[-2] if n >= 2 else 0.0
                out[j] = rec[-1] + slope
            else:
                out[j] = 0.0
        return out, float(np.median(periods)) if periods else 0.0
    r, pr = side(ctx.RH, ctx.red_max)
    b, _ = side(ctx.BH, ctx.blue_max)
    return AlgoOutput(
        red=r, blue=b,
        detail={"原理": "取功率谱 top-3 频率重构信号并线性外推一步",
                "红球主周期中位数": round(pr, 1),
                "说明": "白噪声的频谱平坦，主频不稳定 —— 从频域侧证随机性"},
    )


# ---------------------------------------------------------------- 7. 季节性分解

@register("seasonal_decomp", "趋势-季节性-残差分解", CAT,
          "把出现率序列加性分解为趋势项（移动平均）+ 季节项（周期均值）+ 残差，用趋势与季节外推。",
          ["STL分解", "加性模型", "趋势项", "季节项"], cost=2)
def seasonal_decomp(ctx: AlgoContext) -> AlgoOutput:
    period = 7

    def side(H, max_n):
        out = np.zeros(max_n)
        n = ctx.n
        for j in range(max_n):
            y = H[:, j].astype(float)
            if n < 3 * period:
                out[j] = y.mean()
                continue
            # 趋势：居中移动平均
            w = period if period % 2 else period + 1
            kern = np.ones(w) / w
            trend = np.convolve(y, kern, mode="same")
            detr = y - trend
            # 季节：按相位取均值
            seas = np.zeros(period)
            for ph in range(period):
                vals = detr[ph::period]
                seas[ph] = vals.mean() if len(vals) else 0.0
            seas -= seas.mean()
            # 趋势线性外推
            tail = trend[-min(20, n):]
            slope = np.polyfit(np.arange(len(tail)), tail, 1)[0] if len(tail) > 2 else 0.0
            out[j] = trend[-1] + slope + seas[n % period]
        return out
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "y = T + S + R，趋势用居中 MA、季节按相位均值、趋势线性外推",
                "季节周期": period},
    )


# ---------------------------------------------------------------- 8. 差分趋势

@register("diff_trend", "一阶/二阶差分趋势", CAT,
          "对累计出现次数序列取一阶与二阶差分，用「速度 + 加速度」判定号码活跃度的变化方向。",
          ["差分", "速度", "加速度", "动量"])
def diff_trend(ctx: AlgoContext) -> AlgoOutput:
    def side(H, max_n):
        cum = np.cumsum(H, axis=0)
        # 分段速度
        seg = max(ctx.n // 10, 5)
        v_recent = (cum[-1] - cum[-seg]) / seg
        v_prev = (cum[-seg] - cum[-2 * seg]) / seg if ctx.n >= 2 * seg else v_recent
        accel = v_recent - v_prev
        return 0.6 * v_recent + 0.4 * accel
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "v = Δcum/Δt（速度），a = Δv（加速度），score = 0.6v + 0.4a",
                "分段长度": max(ctx.n // 10, 5)},
    )


# ---------------------------------------------------------------- 9. 布林带

@register("bollinger", "布林带偏离度", CAT,
          "对滚动出现率构造布林带（MA ± 2σ），处于下轨的号码视为超卖待反弹，上轨为超买。",
          ["布林带", "标准差通道", "均值回归", "超买超卖"])
def bollinger(ctx: AlgoContext) -> AlgoOutput:
    win = 30

    def side(H, max_n):
        roll = np.array([H[max(0, t - win + 1):t + 1].mean(axis=0) for t in range(ctx.n)])
        ma = roll[-1]
        sd = roll[-min(60, ctx.n):].std(axis=0) + 1e-9
        cur = H[-win:].mean(axis=0)
        # %B 指标：(price - lower) / (upper - lower)
        upper, lower = ma + 2 * sd, ma - 2 * sd
        pctb = (cur - lower) / (upper - lower + 1e-9)
        return 1.0 - pctb  # 越靠下轨越"超卖"，得分越高
    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={"原理": "%B = (x - 下轨)/(上轨 - 下轨)，取 1-%B（超卖优先）",
                "窗口": win, "带宽": "±2σ"},
    )
