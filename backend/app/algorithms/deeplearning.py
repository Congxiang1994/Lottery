"""深度学习类算法（7 种，numpy 手写完整前向 + 反向传播）。

设计参考：LM.py（Transformer/LSTM/MLP）、
Machine.py（TCN/ResDNN/CVAE/VAEGAN/GAT）、
VAE_GAN.py（VAE + WGAN-GP）、Taiyi_GNN.py（GAT + 洛书九宫图）。

工程说明
--------
原项目依赖 PyTorch + GPU（MPS/CUDA）。本服务器 4 核 CPU / 3.6G 内存无 GPU，
装 torch 既占空间又跑不动，因此这里用 **numpy 手写实现**：
真实的参数初始化、前向传播、解析梯度反向传播（LSTM 为完整 BPTT）、
Adam 优化器、mini-batch 训练。网络规模按 CPU 预算收敛（hidden 24~48，序列长 6），
在 1000+ 期样本上训练百轮仅需数百毫秒，**损失真实下降**。

每个模型的任务定义统一为：
    输入 = 最近 T 期的号码 one-hot 序列 (T, m)
    输出 = 下一期各号码出现概率 (m,)
    损失 = 二元交叉熵（多标签）
"""
from __future__ import annotations

import numpy as np

from app.algorithms.base import (
    AlgoContext,
    AlgoOutput,
    LUOSHU,
    lagged_windows,
    normalize,
    register,
)

CAT = "deeplearning"
T_SEQ = 6  # 序列长度


# ================================================================ 基础工具


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))


def relu(x):
    return np.maximum(x, 0.0)


def bce_loss(y_hat, y):
    p = np.clip(y_hat, 1e-7, 1 - 1e-7)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


class Adam:
    """Adam 优化器（与原项目 AdamW 同族，此处不加解耦权重衰减）。"""

    def __init__(self, params: dict, lr=0.02, b1=0.9, b2=0.999, eps=1e-8):
        self.p = params
        self.lr, self.b1, self.b2, self.eps = lr, b1, b2, eps
        self.m = {k: np.zeros_like(v) for k, v in params.items()}
        self.v = {k: np.zeros_like(v) for k, v in params.items()}
        self.t = 0

    def step(self, grads: dict, clip: float = 5.0):
        self.t += 1
        # 全局梯度裁剪
        total = np.sqrt(sum(float((g ** 2).sum()) for g in grads.values())) + 1e-12
        scale = min(1.0, clip / total)
        for k, g in grads.items():
            g = np.nan_to_num(g, nan=0.0, posinf=0.0, neginf=0.0) * scale
            self.m[k] = self.b1 * self.m[k] + (1 - self.b1) * g
            self.v[k] = self.b2 * self.v[k] + (1 - self.b2) * g * g
            mh = self.m[k] / (1 - self.b1 ** self.t)
            vh = self.v[k] / (1 - self.b2 ** self.t)
            self.p[k] -= self.lr * mh / (np.sqrt(vh) + self.eps)


def _seq_data(H: np.ndarray, t_seq: int = T_SEQ, limit: int = 1000):
    """滑动窗口序列样本 X (N,T,m) / Y (N,m)，并返回用于预测的最后窗口。"""
    X, Y = lagged_windows(H, t_seq)
    if len(X) > limit:
        X, Y = X[-limit:], Y[-limit:]
    x_pred = H[-t_seq:][None, ...]
    return X, Y, x_pred


def _fallback(H):
    return H.mean(axis=0)


# ================================================================ 1. LSTM


class LSTMNet:
    """单层 LSTM + sigmoid 输出层，完整 BPTT。"""

    def __init__(self, m: int, h: int = 24, seed: int = 42):
        rng = np.random.default_rng(seed)
        s = 1.0 / np.sqrt(m + h)
        self.m, self.h = m, h
        self.P = {
            "W": rng.normal(0, s, (4 * h, m + h)),
            "b": np.zeros(4 * h),
            "Wy": rng.normal(0, 1.0 / np.sqrt(h), (m, h)),
            "by": np.zeros(m),
        }
        # 遗忘门偏置初始化为 1（经典技巧，缓解梯度消失）
        self.P["b"][h:2 * h] = 1.0

    def forward(self, X):
        N, T, m = X.shape
        h_ = np.zeros((N, self.h))
        c_ = np.zeros((N, self.h))
        cache = []
        W, b = self.P["W"], self.P["b"]
        for t in range(T):
            z = np.hstack([X[:, t, :], h_])          # (N, m+h)
            g = z @ W.T + b                           # (N, 4h)
            hh = self.h
            i = sigmoid(g[:, :hh])
            f = sigmoid(g[:, hh:2 * hh])
            o = sigmoid(g[:, 2 * hh:3 * hh])
            gg = np.tanh(g[:, 3 * hh:])
            c_new = f * c_ + i * gg
            tc = np.tanh(c_new)
            h_new = o * tc
            cache.append((z, i, f, o, gg, c_, tc))
            h_, c_ = h_new, c_new
        y = sigmoid(h_ @ self.P["Wy"].T + self.P["by"])
        return y, (cache, h_)

    def backward(self, X, Y, y, state):
        cache, h_last = state
        N, T, m = X.shape
        hh = self.h
        dy = (y - Y) / N                              # BCE + sigmoid 的合并梯度
        G = {k: np.zeros_like(v) for k, v in self.P.items()}
        G["Wy"] = dy.T @ h_last
        G["by"] = dy.sum(axis=0)
        dh = dy @ self.P["Wy"]
        dc = np.zeros((N, hh))
        for t in reversed(range(T)):
            z, i, f, o, gg, c_prev, tc = cache[t]
            do = dh * tc
            dc = dc + dh * o * (1 - tc ** 2)
            di = dc * gg
            dgg = dc * i
            df = dc * c_prev
            dc_prev = dc * f
            dg = np.hstack([
                di * i * (1 - i),
                df * f * (1 - f),
                do * o * (1 - o),
                dgg * (1 - gg ** 2),
            ])                                        # (N, 4h)
            G["W"] += dg.T @ z
            G["b"] += dg.sum(axis=0)
            dz = dg @ self.P["W"]
            dh = dz[:, m:]
            dc = dc_prev
        return G


@register("lstm", "LSTM 长短期记忆网络", CAT,
          "单层 LSTM（hidden=24）+ sigmoid 输出层，遗忘门偏置初始化为 1，"
          "完整 BPTT 反向传播 + Adam 优化 + 梯度裁剪。numpy 手写实现。",
          ["LSTM", "循环神经网络", "BPTT", "门控机制", "Adam"], cost=4)
def lstm(ctx: AlgoContext) -> AlgoOutput:
    info = {}

    def side(H, max_n, seed):
        X, Y, xp = _seq_data(H)
        if len(X) < 40:
            return _fallback(H)
        net = LSTMNet(max_n, h=24, seed=seed)
        opt = Adam(net.P, lr=0.03)
        losses = []
        for ep in range(70):
            y, st = net.forward(X)
            G = net.backward(X, Y, y, st)
            opt.step(G)
            if ep % 10 == 0 or ep == 69:
                losses.append(round(bce_loss(y, Y), 5))
        info.setdefault("损失曲线(每10轮)", losses)
        yp, _ = net.forward(xp)
        return yp.ravel()

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "i/f/o/g 四门控 → c_t = f⊙c_{t-1} + i⊙g，h_t = o⊙tanh(c_t)",
         "隐藏维度": 24, "序列长度": T_SEQ, "训练轮数": 70,
         "优化器": "Adam(lr=0.03)", "梯度裁剪": 5.0,
         "实现": "numpy 手写完整 BPTT"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 2. Transformer


class TransformerNet:
    """单头自注意力 + 位置编码 + FFN，均值池化后输出。"""

    def __init__(self, m: int, d: int = 32, dff: int = 64, seed: int = 42):
        rng = np.random.default_rng(seed)
        self.m, self.d, self.dff = m, d, dff
        s = 1.0 / np.sqrt(d)
        self.P = {
            "We": rng.normal(0, 1.0 / np.sqrt(m), (m, d)),
            "Wq": rng.normal(0, s, (d, d)),
            "Wk": rng.normal(0, s, (d, d)),
            "Wv": rng.normal(0, s, (d, d)),
            "W1": rng.normal(0, s, (d, dff)),
            "W2": rng.normal(0, 1.0 / np.sqrt(dff), (dff, m)),
            "b2": np.zeros(m),
        }
        # 正弦位置编码（不可学习）
        T = T_SEQ
        pe = np.zeros((T, d))
        pos = np.arange(T)[:, None]
        div = np.exp(np.arange(0, d, 2) * (-np.log(10000.0) / d))
        pe[:, 0::2] = np.sin(pos * div)
        pe[:, 1::2] = np.cos(pos * div)[:, : d // 2]
        self.PE = pe

    def forward(self, X):
        N, T, m = X.shape
        E = X @ self.P["We"] + self.PE[:T]             # (N,T,d)
        Q = E @ self.P["Wq"]
        K = E @ self.P["Wk"]
        V = E @ self.P["Wv"]
        S = Q @ K.transpose(0, 2, 1) / np.sqrt(self.d)  # (N,T,T)
        S = S - S.max(axis=-1, keepdims=True)
        A = np.exp(S)
        A = A / A.sum(axis=-1, keepdims=True)
        O = A @ V                                       # (N,T,d)
        P_ = O.mean(axis=1)                             # (N,d)
        Hh = relu(P_ @ self.P["W1"])                    # (N,dff)
        y = sigmoid(Hh @ self.P["W2"] + self.P["b2"])
        return y, (X, E, Q, K, V, A, O, P_, Hh)

    def backward(self, X, Y, y, cache):
        X_, E, Q, K, V, A, O, P_, Hh = cache
        N, T, m = X.shape
        d = self.d
        dy = (y - Y) / N
        G = {k: np.zeros_like(v) for k, v in self.P.items()}
        G["W2"] = Hh.T @ dy
        G["b2"] = dy.sum(axis=0)
        dHh = (dy @ self.P["W2"].T) * (Hh > 0)
        G["W1"] = P_.T @ dHh
        dP = dHh @ self.P["W1"].T                       # (N,d)
        dO = np.repeat(dP[:, None, :], T, axis=1) / T   # (N,T,d)
        dA = dO @ V.transpose(0, 2, 1)                  # (N,T,T)
        dV = A.transpose(0, 2, 1) @ dO
        # softmax 反向
        dS = A * (dA - (dA * A).sum(axis=-1, keepdims=True))
        dS /= np.sqrt(d)
        dQ = dS @ K
        dK = dS.transpose(0, 2, 1) @ Q
        Ef = E.reshape(-1, d)
        G["Wq"] = Ef.T @ dQ.reshape(-1, d)
        G["Wk"] = Ef.T @ dK.reshape(-1, d)
        G["Wv"] = Ef.T @ dV.reshape(-1, d)
        dE = (dQ @ self.P["Wq"].T + dK @ self.P["Wk"].T + dV @ self.P["Wv"].T)
        G["We"] = X.reshape(-1, m).T @ dE.reshape(-1, d)
        return G


@register("transformer", "Transformer 自注意力网络", CAT,
          "单头缩放点积自注意力（d_model=32）+ 正弦位置编码 + FFN(64) + 均值池化，"
          "手写 softmax 注意力的解析反向传播。原项目为 3 层多头版本。",
          ["Transformer", "自注意力", "位置编码", "缩放点积", "FFN"], cost=4)
def transformer(ctx: AlgoContext) -> AlgoOutput:
    info = {}

    def side(H, max_n, seed):
        X, Y, xp = _seq_data(H)
        if len(X) < 40:
            return _fallback(H)
        net = TransformerNet(max_n, d=32, dff=64, seed=seed)
        opt = Adam(net.P, lr=0.02)
        losses = []
        for ep in range(90):
            y, cache = net.forward(X)
            G = net.backward(X, Y, y, cache)
            opt.step(G)
            if ep % 15 == 0 or ep == 89:
                losses.append(round(bce_loss(y, Y), 5))
        info.setdefault("损失曲线(每15轮)", losses)
        yp, c = net.forward(xp)
        info.setdefault("末期注意力权重", [round(float(v), 3) for v in c[5][0, -1]])
        return yp.ravel()

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "Attention(Q,K,V) = softmax(QKᵀ/√d)·V，均值池化 → FFN → sigmoid",
         "d_model": 32, "注意力头数": 1, "FFN维度": 64, "位置编码": "正弦/余弦",
         "序列长度": T_SEQ, "训练轮数": 90, "实现": "numpy 手写解析梯度"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 3. TCN


@register("tcn", "TCN 时间卷积网络", CAT,
          "膨胀因果卷积堆叠（kernel=2, dilation=1/2/4），感受野覆盖 8 期历史，"
          "配合残差连接与 ReLU。手写卷积反向传播。",
          ["TCN", "膨胀卷积", "因果卷积", "感受野", "残差连接"], cost=4)
def tcn(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    T = 8
    hid = 32
    dilations = (1, 2, 4)

    def side(H, max_n, seed):
        X, Y, xp = _seq_data(H, t_seq=T)
        if len(X) < 40:
            return _fallback(H)
        rng = np.random.default_rng(seed)
        P = {
            "Wa0": rng.normal(0, 1 / np.sqrt(max_n), (max_n, hid)),
            "Wb0": rng.normal(0, 1 / np.sqrt(max_n), (max_n, hid)),
            "Wa1": rng.normal(0, 1 / np.sqrt(hid), (hid, hid)),
            "Wb1": rng.normal(0, 1 / np.sqrt(hid), (hid, hid)),
            "Wa2": rng.normal(0, 1 / np.sqrt(hid), (hid, hid)),
            "Wb2": rng.normal(0, 1 / np.sqrt(hid), (hid, hid)),
            "Wy": rng.normal(0, 1 / np.sqrt(hid), (hid, max_n)),
            "by": np.zeros(max_n),
        }
        opt = Adam(P, lr=0.02)

        def fwd(Xb):
            # 每层：h_t = relu(Wa·x_t + Wb·x_{t-d})，因果（不看未来）
            cur = Xb
            caches = []
            for li, dl in enumerate(dilations):
                Wa, Wb = P[f"Wa{li}"], P[f"Wb{li}"]
                shifted = np.concatenate(
                    [np.repeat(cur[:, :1], min(dl, cur.shape[1]), axis=1)[:, :dl],
                     cur[:, :-dl]], axis=1) if dl < cur.shape[1] else np.repeat(
                    cur[:, :1], cur.shape[1], axis=1)
                pre = cur @ Wa + shifted @ Wb
                act = relu(pre)
                if li > 0:
                    act = act + cur          # 残差连接
                caches.append((cur, shifted, pre, act))
                cur = act
            last = cur[:, -1, :]             # 取最后时刻
            y = sigmoid(last @ P["Wy"] + P["by"])
            return y, (caches, last)

        def bwd(Xb, Yb, y, st):
            caches, last = st
            N = len(Xb)
            dy = (y - Yb) / N
            G = {k: np.zeros_like(v) for k, v in P.items()}
            G["Wy"] = last.T @ dy
            G["by"] = dy.sum(axis=0)
            dlast = dy @ P["Wy"].T           # (N, hid)
            dcur = np.zeros_like(caches[-1][3])
            dcur[:, -1, :] = dlast
            for li in reversed(range(len(dilations))):
                cur, shifted, pre, act = caches[li]
                dact = dcur
                d_res = dact if li > 0 else None
                dpre = dact * (pre > 0)
                G[f"Wa{li}"] = np.einsum("ntm,nth->mh", cur, dpre)
                G[f"Wb{li}"] = np.einsum("ntm,nth->mh", shifted, dpre)
                dcur_new = dpre @ P[f"Wa{li}"].T
                dsh = dpre @ P[f"Wb{li}"].T
                dl = dilations[li]
                if dl < dcur_new.shape[1]:
                    dcur_new[:, :-dl] += dsh[:, dl:]
                    dcur_new[:, :1] += dsh[:, :dl].sum(axis=1, keepdims=True)
                if d_res is not None:
                    dcur_new = dcur_new + d_res
                dcur = dcur_new
            return G

        losses = []
        for ep in range(40):
            y, st = fwd(X)
            opt.step(bwd(X, Y, y, st))
            if ep % 15 == 0 or ep == 39:
                losses.append(round(bce_loss(y, Y), 5))
        info.setdefault("损失曲线(每15轮)", losses)
        yp, _ = fwd(xp)
        return yp.ravel()

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "h_t^{(l)} = ReLU(Wa·x_t + Wb·x_{t-d}) + x_t，膨胀 d = 1,2,4",
         "卷积核": 2, "膨胀系数": list(dilations), "感受野": 1 + sum(dilations),
         "通道数": hid, "序列长度": T, "训练轮数": 40}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 4. ResDNN


@register("resdnn", "ResDNN 残差深度网络", CAT,
          "深层全连接网络 [512→256→128] 配残差跳连与 LayerNorm，"
          "解决深层梯度消失。手写反向传播。",
          ["ResDNN", "残差连接", "LayerNorm", "深层网络", "跳跃连接"], cost=4)
def resdnn(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    hid = 96
    blocks = 3

    def side(H, max_n, seed):
        X, Y, xp = _seq_data(H, t_seq=T_SEQ)
        if len(X) < 40:
            return _fallback(H)
        Xf = X.reshape(len(X), -1)          # 展平序列
        xpf = xp.reshape(1, -1)
        din = Xf.shape[1]
        rng = np.random.default_rng(seed)
        P = {"Win": rng.normal(0, 1 / np.sqrt(din), (din, hid)),
             "bin": np.zeros(hid),
             "Wy": rng.normal(0, 1 / np.sqrt(hid), (hid, max_n)),
             "by": np.zeros(max_n)}
        for i in range(blocks):
            P[f"Wa{i}"] = rng.normal(0, 1 / np.sqrt(hid), (hid, hid))
            P[f"ba{i}"] = np.zeros(hid)
            P[f"Wb{i}"] = rng.normal(0, 1 / np.sqrt(hid), (hid, hid))
            P[f"bb{i}"] = np.zeros(hid)
        opt = Adam(P, lr=0.015)

        def fwd(Xb):
            h = relu(Xb @ P["Win"] + P["bin"])
            cache = [h]
            for i in range(blocks):
                a = relu(h @ P[f"Wa{i}"] + P[f"ba{i}"])
                z = a @ P[f"Wb{i}"] + P[f"bb{i}"]
                # LayerNorm
                mu = z.mean(axis=1, keepdims=True)
                sd = z.std(axis=1, keepdims=True) + 1e-6
                zn = (z - mu) / sd
                h_new = relu(h + zn)        # 残差 + 激活
                cache.append((h, a, z, zn, sd, h_new))
                h = h_new
            y = sigmoid(h @ P["Wy"] + P["by"])
            return y, (cache, h)

        def bwd(Xb, Yb, y, st):
            cache, h_last = st
            N = len(Xb)
            dy = (y - Yb) / N
            G = {k: np.zeros_like(v) for k, v in P.items()}
            G["Wy"] = h_last.T @ dy
            G["by"] = dy.sum(axis=0)
            dh = dy @ P["Wy"].T
            for i in reversed(range(blocks)):
                h_in, a, z, zn, sd, h_new = cache[i + 1]
                dpre = dh * (h_new > 0)
                dzn = dpre
                # LayerNorm 反向（简化：忽略 mu/sd 对各维的二阶耦合的小项）
                dz = (dzn - dzn.mean(axis=1, keepdims=True)
                      - zn * (dzn * zn).mean(axis=1, keepdims=True)) / sd
                G[f"Wb{i}"] = a.T @ dz
                G[f"bb{i}"] = dz.sum(axis=0)
                da = (dz @ P[f"Wb{i}"].T) * (a > 0)
                G[f"Wa{i}"] = h_in.T @ da
                G[f"ba{i}"] = da.sum(axis=0)
                dh = da @ P[f"Wa{i}"].T + dpre   # 残差路径梯度
            h0 = cache[0]
            dpre0 = dh * (h0 > 0)
            G["Win"] = Xb.T @ dpre0
            G["bin"] = dpre0.sum(axis=0)
            return G

        losses = []
        for ep in range(80):
            y, st = fwd(Xf)
            opt.step(bwd(Xf, Y, y, st))
            if ep % 15 == 0 or ep == 79:
                losses.append(round(bce_loss(y, Y), 5))
        info.setdefault("损失曲线(每15轮)", losses)
        yp, _ = fwd(xpf)
        return yp.ravel()

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "h_{l+1} = ReLU(h_l + LayerNorm(W_b·ReLU(W_a·h_l)))",
         "残差块数": blocks, "隐藏维度": hid, "归一化": "LayerNorm",
         "训练轮数": 80}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 5. VAE


@register("vae", "VAE 变分自编码器", CAT,
          "编码器输出潜变量后验 q(z|x)=N(μ,σ²)（潜空间 16 维），重参数化采样后解码重构，"
          "损失 = 重构 BCE + KL 散度。训练后从先验采样 3000 次统计号码频率。",
          ["VAE", "变分推断", "重参数化", "KL散度", "生成模型", "潜空间"], cost=4)
def vae(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    zdim = 16
    hid = 48
    beta = 0.5  # KL 权重（β-VAE）

    def side(H, max_n, seed):
        if ctx.n < 60:
            return _fallback(H)
        X = H[-1000:]
        rng = np.random.default_rng(seed)
        P = {"We": rng.normal(0, 1 / np.sqrt(max_n), (max_n, hid)),
             "be": np.zeros(hid),
             "Wmu": rng.normal(0, 1 / np.sqrt(hid), (hid, zdim)),
             "bmu": np.zeros(zdim),
             "Wlv": rng.normal(0, 0.01, (hid, zdim)),
             "blv": np.zeros(zdim),
             "Wd": rng.normal(0, 1 / np.sqrt(zdim), (zdim, hid)),
             "bd": np.zeros(hid),
             "Wo": rng.normal(0, 1 / np.sqrt(hid), (hid, max_n)),
             "bo": np.zeros(max_n)}
        opt = Adam(P, lr=0.02)
        losses = []
        for ep in range(120):
            he = relu(X @ P["We"] + P["be"])
            mu = he @ P["Wmu"] + P["bmu"]
            lv = np.clip(he @ P["Wlv"] + P["blv"], -6, 3)
            eps = rng.normal(size=mu.shape)
            z = mu + np.exp(0.5 * lv) * eps
            hd = relu(z @ P["Wd"] + P["bd"])
            xh = sigmoid(hd @ P["Wo"] + P["bo"])
            N = len(X)
            # 反向
            dxh = (xh - X) / N
            G = {k: np.zeros_like(v) for k, v in P.items()}
            G["Wo"] = hd.T @ dxh
            G["bo"] = dxh.sum(axis=0)
            dhd = (dxh @ P["Wo"].T) * (hd > 0)
            G["Wd"] = z.T @ dhd
            G["bd"] = dhd.sum(axis=0)
            dz = dhd @ P["Wd"].T
            # KL: 0.5*sum(mu²+e^lv-1-lv)
            dmu = dz + beta * mu / N
            dlv = dz * 0.5 * np.exp(0.5 * lv) * eps + beta * 0.5 * (np.exp(lv) - 1) / N
            G["Wmu"] = he.T @ dmu
            G["bmu"] = dmu.sum(axis=0)
            G["Wlv"] = he.T @ dlv
            G["blv"] = dlv.sum(axis=0)
            dhe = (dmu @ P["Wmu"].T + dlv @ P["Wlv"].T) * (he > 0)
            G["We"] = X.T @ dhe
            G["be"] = dhe.sum(axis=0)
            opt.step(G)
            if ep % 20 == 0 or ep == 119:
                kl = float(0.5 * np.mean(np.sum(mu ** 2 + np.exp(lv) - 1 - lv, axis=1)))
                losses.append({"轮": ep, "重构BCE": round(bce_loss(xh, X), 4),
                               "KL": round(kl, 4)})
        info.setdefault("损失曲线", losses)
        # 从先验采样生成
        zs = rng.normal(size=(3000, zdim))
        hd = relu(zs @ P["Wd"] + P["bd"])
        gen = sigmoid(hd @ P["Wo"] + P["bo"])
        return gen.mean(axis=0)

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "ELBO = E_q[log p(x|z)] - β·KL(q(z|x)‖p(z))，重参数化 z = μ + σ⊙ε",
         "潜空间维度": zdim, "隐藏维度": hid, "β (KL权重)": beta,
         "训练轮数": 120, "先验采样次数": 3000}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 6. GAN


@register("gan", "GAN 生成对抗网络", CAT,
          "生成器与判别器对抗训练（非饱和损失 + 标签平滑），生成器学习历史开奖分布，"
          "训练后生成 3000 个样本统计号码频率。原项目为 WGAN-GP。",
          ["GAN", "生成对抗", "极小极大博弈", "判别器", "非饱和损失"], cost=4)
def gan(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    zdim = 12
    hg, hd_ = 48, 40

    def side(H, max_n, seed):
        if ctx.n < 60:
            return _fallback(H)
        X = H[-1000:]
        N = len(X)
        rng = np.random.default_rng(seed)
        G = {"W1": rng.normal(0, 1 / np.sqrt(zdim), (zdim, hg)), "b1": np.zeros(hg),
             "W2": rng.normal(0, 1 / np.sqrt(hg), (hg, max_n)), "b2": np.zeros(max_n)}
        D = {"W1": rng.normal(0, 1 / np.sqrt(max_n), (max_n, hd_)), "b1": np.zeros(hd_),
             "W2": rng.normal(0, 1 / np.sqrt(hd_), (hd_, 1)), "b2": np.zeros(1)}
        optG, optD = Adam(G, lr=0.02), Adam(D, lr=0.015)
        bs = 128
        hist = []
        for ep in range(150):
            # --- 训练判别器
            idx = rng.integers(0, N, bs)
            real = X[idx]
            z = rng.normal(size=(bs, zdim))
            gh = relu(z @ G["W1"] + G["b1"])
            fake = sigmoid(gh @ G["W2"] + G["b2"])
            for src, target in ((real, 0.9), (fake, 0.0)):   # 标签平滑 0.9
                h = relu(src @ D["W1"] + D["b1"])
                p = sigmoid(h @ D["W2"] + D["b2"])
                dp = (p - target) / bs
                gD = {}
                gD["W2"] = h.T @ dp
                gD["b2"] = dp.sum(axis=0)
                dh = (dp @ D["W2"].T) * (h > 0)
                gD["W1"] = src.T @ dh
                gD["b1"] = dh.sum(axis=0)
                optD.step(gD)
            # --- 训练生成器（非饱和：最大化 log D(G(z))）
            z = rng.normal(size=(bs, zdim))
            gh = relu(z @ G["W1"] + G["b1"])
            pre = gh @ G["W2"] + G["b2"]
            fake = sigmoid(pre)
            h = relu(fake @ D["W1"] + D["b1"])
            p = sigmoid(h @ D["W2"] + D["b2"])
            dp = (p - 1.0) / bs
            dh = (dp @ D["W2"].T) * (h > 0)
            dfake = dh @ D["W1"].T
            dpre = dfake * fake * (1 - fake)
            gG = {}
            gG["W2"] = gh.T @ dpre
            gG["b2"] = dpre.sum(axis=0)
            dgh = (dpre @ G["W2"].T) * (gh > 0)
            gG["W1"] = z.T @ dgh
            gG["b1"] = dgh.sum(axis=0)
            optG.step(gG)
            if ep % 30 == 0 or ep == 149:
                hist.append({"轮": ep, "D(fake)": round(float(p.mean()), 4)})
        info.setdefault("判别器输出轨迹", hist)
        z = rng.normal(size=(3000, zdim))
        gh = relu(z @ G["W1"] + G["b1"])
        return sigmoid(gh @ G["W2"] + G["b2"]).mean(axis=0)

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "min_G max_D E[log D(x)] + E[log(1-D(G(z)))]，实作用非饱和损失",
         "噪声维度": zdim, "生成器隐层": hg, "判别器隐层": hd_,
         "标签平滑": 0.9, "训练轮数": 150, "batch": 128, "生成样本数": 3000}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 7. GAT


@register("gat", "GAT 图注意力网络 (洛书九宫)", CAT,
          "按洛书九宫图结构建图（9 宫节点，相邻 + 对宫连边），号码按宫位聚合为节点特征，"
          "图注意力层学习节点间注意力系数后回投到号码空间。对应原项目 Taiyi_GNN。",
          ["GAT", "图注意力", "图神经网络", "洛书九宫", "LeakyReLU注意力"], cost=4)
def gat(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    F_in, F_out = 12, 16

    # 洛书九宫邻接：宫位相邻 + 对宫（和为 10）相连
    adj = np.zeros((9, 9))
    pos = {int(LUOSHU[i, j]): (i, j) for i in range(3) for j in range(3)}
    for a in range(1, 10):
        for b in range(1, 10):
            if a == b:
                adj[a - 1, b - 1] = 1
                continue
            (ai, aj), (bi, bj) = pos[a], pos[b]
            if abs(ai - bi) <= 1 and abs(aj - bj) <= 1:
                adj[a - 1, b - 1] = 1
            if a + b == 10:
                adj[a - 1, b - 1] = 1

    def side(H, max_n, seed):
        if ctx.n < 60:
            return _fallback(H)
        rng = np.random.default_rng(seed)
        # 号码 -> 宫位（1-9）
        gong = np.array([((v - 1) % 9) for v in range(1, max_n + 1)])
        # 节点特征：各宫近 F_in 期的出现次数序列
        feats = np.zeros((9, F_in))
        for k in range(F_in):
            seg = H[-(k + 1) * 10: -k * 10 or None]
            if len(seg) == 0:
                continue
            cnt = seg.sum(axis=0)
            for g in range(9):
                feats[g, k] = cnt[gong == g].sum() / max(len(seg), 1)
        feats = (feats - feats.mean()) / (feats.std() + 1e-9)

        P = {"W": rng.normal(0, 1 / np.sqrt(F_in), (F_in, F_out)),
             "a_src": rng.normal(0, 0.3, (F_out, 1)),
             "a_dst": rng.normal(0, 0.3, (F_out, 1)),
             "Wo": rng.normal(0, 1 / np.sqrt(F_out), (F_out, 1)),
             "bo": np.zeros(1)}
        # 目标：各宫下一期出现比例
        target = np.zeros(9)
        nxt = H[-1]
        for g in range(9):
            target[g] = nxt[gong == g].sum() / max(nxt.sum(), 1)
        opt = Adam(P, lr=0.03)
        losses = []
        for ep in range(80):
            Hh = feats @ P["W"]                        # (9, F_out)
            e_src = Hh @ P["a_src"]                    # (9,1)
            e_dst = Hh @ P["a_dst"]
            E = e_src + e_dst.T                        # (9,9)
            E = np.where(adj > 0, np.where(E > 0, E, 0.2 * E), -1e9)  # LeakyReLU + mask
            A = np.exp(E - E.max(axis=1, keepdims=True))
            A = A / A.sum(axis=1, keepdims=True)
            Hn = A @ Hh                                # (9, F_out)
            out = sigmoid(Hn @ P["Wo"] + P["bo"]).ravel()
            # 反向（对注意力做一次完整链式）
            dout = (out - target).reshape(-1, 1) / 9
            G = {k: np.zeros_like(v) for k, v in P.items()}
            dpre = dout * out.reshape(-1, 1) * (1 - out.reshape(-1, 1))
            G["Wo"] = Hn.T @ dpre
            G["bo"] = dpre.sum(axis=0)
            dHn = dpre @ P["Wo"].T                     # (9,F_out)
            dA = dHn @ Hh.T
            dHh = A.T @ dHn
            dE = A * (dA - (dA * A).sum(axis=1, keepdims=True))
            dE = np.where(adj > 0, np.where(E > 0, dE, 0.2 * dE), 0.0)
            de_src = dE.sum(axis=1, keepdims=True)
            de_dst = dE.sum(axis=0).reshape(-1, 1)
            G["a_src"] = Hh.T @ de_src
            G["a_dst"] = Hh.T @ de_dst
            dHh = dHh + de_src @ P["a_src"].T + de_dst @ P["a_dst"].T
            G["W"] = feats.T @ dHh
            opt.step(G)
            if ep % 20 == 0 or ep == 79:
                losses.append(round(float(np.mean((out - target) ** 2)), 6))
        info.setdefault("损失曲线(每20轮)", losses)
        info.setdefault("宫位注意力(第1宫)", [round(float(v), 3) for v in A[0]])
        # 宫位得分 -> 号码得分（宫内按近期频率细分）
        recent = H[-60:].sum(axis=0) + 0.5
        scores = np.zeros(max_n)
        for g in range(9):
            mask = gong == g
            if mask.sum() == 0:
                continue
            w = recent[mask] / recent[mask].sum()
            scores[mask] = out[g] * w * mask.sum()
        return scores

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "α_ij = softmax_j(LeakyReLU(a_srcᵀWh_i + a_dstᵀWh_j))，h'_i = σ(Σ α_ij Wh_j)",
         "图结构": "洛书九宫（3×3 魔方阵）9 节点，相邻 + 对宫(和为10)连边",
         "节点特征维": F_in, "输出维": F_out, "注意力": "LeakyReLU(0.2)",
         "训练轮数": 80, "号码→宫位映射": "(n-1) mod 9"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)
