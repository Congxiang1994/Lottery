"""信号与图像类算法（3 种）。

设计参考：Radar.py（雷达图编码 + Lucas-Kanade 光流）
以及信号处理系列。

* radar_flow    —— 号码热力图视频化 + Lucas-Kanade 光流前向推流
* haar_wavelet  —— Haar 小波多分辨率分解 + 软阈值去噪 + 趋势外推
* hilbert_phase —— FFT 解析信号（Hilbert 变换）取瞬时幅值与相位外推
"""
from __future__ import annotations

import math

import numpy as np

from app.lottery.algorithms.base import AlgoContext, AlgoOutput, normalize, register

CAT = "signal"


# ---------------------------------------------------------------- 工具


def _box(a: np.ndarray, k: int) -> np.ndarray:
    """二维盒式滤波（积分图实现，等价于均值卷积）。"""
    pad = k // 2
    p = np.pad(a, pad, mode="edge")
    c = p.cumsum(axis=0).cumsum(axis=1)
    c = np.pad(c, ((1, 0), (1, 0)), mode="constant")
    h, w = a.shape
    out = (c[k:k + h, k:k + w] - c[0:h, k:k + w]
           - c[k:k + h, 0:w] + c[0:h, 0:w])
    return out / (k * k)


def _grid_shape(m: int) -> tuple[int, int]:
    cols = int(math.ceil(math.sqrt(m)))
    rows = int(math.ceil(m / cols))
    return rows, cols


def _to_grid(vec: np.ndarray, rows: int, cols: int) -> np.ndarray:
    g = np.zeros(rows * cols)
    g[: len(vec)] = vec
    return g.reshape(rows, cols)


def _from_grid(g: np.ndarray, m: int) -> np.ndarray:
    return g.ravel()[:m]


def _heat_frames(H: np.ndarray, m: int, win: int, step: int, count: int):
    """把号码出现记录做成「热力图视频」帧序列。"""
    rows, cols = _grid_shape(m)
    n = H.shape[0]
    frames = []
    for k in range(count):
        end = n - step * (count - 1 - k)
        seg = H[max(0, end - win):end]
        if seg.shape[0] == 0:
            seg = H[:1]
        frames.append(_to_grid(normalize(seg.sum(axis=0)), rows, cols))
    return frames, rows, cols


# ---------------------------------------------------------------- 1. 雷达光流

@register("radar_flow", "雷达热力图 Lucas-Kanade 光流", CAT,
          "把号码按方阵排成雷达热力图，滑窗频率生成时间帧序列；"
          "用 Lucas-Kanade 最小二乘（Ix²,IxIy,Iy² 结构张量 + 盒式加权）估计像素级光流，"
          "再按光流做前向散射推流（advection）得到下一帧热力图作为打分。",
          ["Lucas-Kanade", "光流估计", "结构张量", "图像推流", "雷达图"], cost=3)
def radar_flow(ctx: AlgoContext) -> AlgoOutput:
    win, step, count, kbox = 24, 4, 6, 3

    def side(H, m):
        if H.shape[0] < win + step * count:
            return normalize(H.sum(axis=0)), {}
        frames, rows, cols = _heat_frames(H, m, win, step, count)
        # 多帧平均光流，抑制单帧噪声
        acc_u = np.zeros((rows, cols))
        acc_v = np.zeros((rows, cols))
        for a, b in zip(frames[:-1], frames[1:]):
            Iy, Ix = np.gradient(0.5 * (a + b))
            It = b - a
            Ixx, Iyy, Ixy = _box(Ix * Ix, kbox), _box(Iy * Iy, kbox), _box(Ix * Iy, kbox)
            Ixt, Iyt = _box(Ix * It, kbox), _box(Iy * It, kbox)
            det = Ixx * Iyy - Ixy ** 2 + 1e-3
            u = (-Iyy * Ixt + Ixy * Iyt) / det       # 解 2×2 正规方程
            v = (Ixy * Ixt - Ixx * Iyt) / det
            acc_u += np.clip(u, -2, 2)
            acc_v += np.clip(v, -2, 2)
        u = acc_u / (len(frames) - 1)
        v = acc_v / (len(frames) - 1)
        last = frames[-1]
        # 前向散射推流：像素值按 (u,v) 位移双线性分配到新位置
        pred = np.zeros_like(last)
        for i in range(rows):
            for j in range(cols):
                ti, tj = i + v[i, j], j + u[i, j]
                i0, j0 = int(np.floor(ti)), int(np.floor(tj))
                fi, fj = ti - i0, tj - j0
                for di, wi in ((0, 1 - fi), (1, fi)):
                    for dj, wj in ((0, 1 - fj), (1, fj)):
                        ii, jj = np.clip(i0 + di, 0, rows - 1), np.clip(j0 + dj, 0, cols - 1)
                        pred[ii, jj] += last[i, j] * wi * wj
        info = {"平均角向光流 u": round(float(u.mean()), 4),
                "平均径向光流 v": round(float(v.mean()), 4),
                "光流幅值": round(float(np.hypot(u, v).mean()), 4)}
        return _from_grid(pred, m), info

    r, ir = side(ctx.RH, ctx.red_max)
    b, _ = side(ctx.BH, ctx.blue_max)
    rows, cols = _grid_shape(ctx.red_max)
    ir.update({"原理": "LK 亮度恒定假设 Ix·u + Iy·v + It = 0，窗口最小二乘求解",
               "图像尺寸": f"{rows}×{cols}", "帧数": count,
               "帧间隔": f"{step} 期", "热力窗口": f"{win} 期",
               "盒式窗口": kbox})
    return AlgoOutput(red=normalize(r), blue=normalize(b), detail=ir)


# ---------------------------------------------------------------- 2. Haar 小波

@register("haar_wavelet", "Haar 小波去噪外推", CAT,
          "对每个号码的出现序列做 4 级 Haar 小波分解，对细节系数施加"
          "通用阈值软收缩（σ√(2ln N)）去噪，重构后用低频趋势线性外推下一期。",
          ["小波变换", "多分辨率分析", "软阈值去噪", "通用阈值", "趋势外推"], cost=2)
def haar_wavelet(ctx: AlgoContext) -> AlgoOutput:
    levels = 4

    def dwt1(x: np.ndarray):
        if len(x) % 2:
            x = np.concatenate([x, x[-1:]])
        a = (x[0::2] + x[1::2]) / math.sqrt(2)
        d = (x[0::2] - x[1::2]) / math.sqrt(2)
        return a, d

    def idwt1(a: np.ndarray, d: np.ndarray) -> np.ndarray:
        n = min(len(a), len(d))
        a, d = a[:n], d[:n]
        x = np.empty(2 * n)
        x[0::2] = (a + d) / math.sqrt(2)
        x[1::2] = (a - d) / math.sqrt(2)
        return x

    def side(H, m):
        L = 256 if H.shape[0] >= 256 else 2 ** int(math.log2(max(H.shape[0], 2)))
        seg = H[-L:]
        out = np.zeros(m)
        trend = np.zeros(m)
        for j in range(m):
            x = seg[:, j].astype(np.float64)
            coeffs = []
            a = x
            for _ in range(levels):
                a, d = dwt1(a)
                coeffs.append(d)
            # 通用阈值软收缩（噪声 σ 由最细层 MAD 稳健估计）
            sigma = np.median(np.abs(coeffs[0])) / 0.6745 + 1e-9
            thr = sigma * math.sqrt(2.0 * math.log(max(len(x), 2)))
            coeffs = [np.sign(c) * np.maximum(np.abs(c) - thr, 0.0) for c in coeffs]
            rec = a
            for d in reversed(coeffs):
                rec = idwt1(rec, d)
            out[j] = rec[-1]
            # 低频趋势外推：对最粗层近似系数做一次线性回归
            if len(a) >= 3:
                t = np.arange(len(a))
                k, b0 = np.polyfit(t, a, 1)
                trend[j] = k * len(a) + b0
            else:
                trend[j] = a[-1]
        return normalize(out) * 0.45 + normalize(trend) * 0.55

    return AlgoOutput(
        red=side(ctx.RH, ctx.red_max), blue=side(ctx.BH, ctx.blue_max),
        detail={
            "原理": "Haar 正交小波 4 级分解 → 细节系数软阈值 → 重构 + 低频外推",
            "分解级数": levels,
            "阈值": "通用阈值 σ√(2 ln N)，σ 由最细层 MAD/0.6745 估计",
            "序列长度": "最近 256 期（2 的幂对齐）",
            "打分": "0.45·去噪重构末值 + 0.55·粗尺度趋势外推",
        },
    )


# ---------------------------------------------------------------- 3. Hilbert 相位

@register("hilbert_phase", "Hilbert 解析信号相位外推", CAT,
          "对每个号码的平滑出现率序列用 FFT 构造解析信号（Hilbert 变换），"
          "取瞬时幅值 A(t) 与瞬时相位 φ(t)，用相位差估角频率 ω，"
          "外推 A·cos(φ+ω) 作为下一期强度。",
          ["Hilbert变换", "解析信号", "瞬时相位", "瞬时频率", "FFT"], cost=2)
def hilbert_phase(ctx: AlgoContext) -> AlgoOutput:
    smooth, L = 9, 256

    def analytic(x: np.ndarray) -> np.ndarray:
        n = len(x)
        X = np.fft.fft(x)
        h = np.zeros(n)
        h[0] = 1.0
        if n % 2 == 0:
            h[1:n // 2] = 2.0
            h[n // 2] = 1.0
        else:
            h[1:(n + 1) // 2] = 2.0
        return np.fft.ifft(X * h)

    def side(H, m):
        seg = H[-L:] if H.shape[0] >= L else H
        k = np.ones(smooth) / smooth
        out = np.zeros(m)
        freqs = []
        for j in range(m):
            x = np.convolve(seg[:, j].astype(np.float64), k, mode="same")
            x = x - x.mean()
            z = analytic(x)
            amp = np.abs(z)
            ph = np.unwrap(np.angle(z))
            if len(ph) >= 12:
                omega = float(np.mean(np.diff(ph[-12:])))
            else:
                omega = 0.0
            freqs.append(omega)
            out[j] = amp[-1] * math.cos(ph[-1] + omega)
        return normalize(out), float(np.mean(freqs))

    r, wr = side(ctx.RH, ctx.red_max)
    b, wb = side(ctx.BH, ctx.blue_max)
    return AlgoOutput(red=r, blue=b, detail={
        "原理": "z(t) = x(t) + i·H[x](t)，FFT 单边谱构造解析信号",
        "平滑核": f"{smooth} 期移动平均",
        "序列长度": f"最近 {L} 期",
        "红球平均角频率 ω": round(wr, 4),
        "蓝球平均角频率 ω": round(wb, 4),
        "对应周期": f"{abs(2 * math.pi / wr):.1f} 期" if abs(wr) > 1e-6 else "非周期",
        "外推": "A(t)·cos(φ(t)+ω)",
    })
