"""量子计算类算法（5 种，numpy 态矢量模拟）。

设计参考：Quantum.py（QCBM/QRNN/Qopula/Szegedy量子行走/Grover扩散）、
quantum_lottery_predictor.py（PennyLane 参数化量子电路）。

工程说明
--------
参考实现用 PennyLane（含 Julia/C++ 后端）。这里用 **numpy 完整态矢量模拟**：
显式构造 2^k 维复振幅态矢量，逐门作用真实的酉矩阵（Ry/Rz/Hadamard/CNOT/受控相位），
最后按 Born 规则 |⟨x|Ψ⟩|² 读出概率分布。这是**真实的量子线路模拟**（非近似、非伪造），
k ≤ 6 时态空间仅 64 维，CPU 上瞬时完成。参数通过参数移位/有限差分梯度或
MMD 损失的解析梯度优化。
"""
from __future__ import annotations

import numpy as np

from app.lottery.algorithms.base import AlgoContext, AlgoOutput, normalize, register

CAT = "quantum"


# ================================================================ 量子模拟核心


def n_qubits_for(max_n: int) -> int:
    k = 1
    while 2 ** k < max_n:
        k += 1
    return k


def apply_1q(state: np.ndarray, U: np.ndarray, q: int, k: int) -> np.ndarray:
    """对第 q 个量子比特作用单比特门 U（2×2 酉矩阵）。"""
    st = state.reshape([2] * k)
    st = np.moveaxis(st, q, 0)
    shape = st.shape
    st = st.reshape(2, -1)
    st = U @ st
    st = st.reshape(shape)
    st = np.moveaxis(st, 0, q)
    return st.reshape(-1)


def apply_cnot(state: np.ndarray, ctrl: int, targ: int, k: int) -> np.ndarray:
    """CNOT 门：control=1 时翻转 target。"""
    st = state.reshape([2] * k).copy()
    idx_c1 = [slice(None)] * k
    idx_c1[ctrl] = 1
    sub = st[tuple(idx_c1)]                    # control=1 的子空间
    sub_moved = np.moveaxis(sub, targ if targ < ctrl else targ - 1, 0)
    sub_moved = sub_moved[::-1]                # 翻转 target
    sub = np.moveaxis(sub_moved, 0, targ if targ < ctrl else targ - 1)
    st[tuple(idx_c1)] = sub
    return st.reshape(-1)


def apply_cphase(state: np.ndarray, ctrl: int, targ: int, phi: float, k: int) -> np.ndarray:
    """受控相位门（Copula 相位调制用）。"""
    st = state.reshape([2] * k).copy()
    idx = [slice(None)] * k
    idx[ctrl] = 1
    idx[targ] = 1
    st[tuple(idx)] *= np.exp(1j * phi)
    return st.reshape(-1)


def RY(theta):
    c, s = np.cos(theta / 2), np.sin(theta / 2)
    return np.array([[c, -s], [s, c]], dtype=np.complex128)


def RZ(theta):
    return np.array([[np.exp(-1j * theta / 2), 0], [0, np.exp(1j * theta / 2)]],
                    dtype=np.complex128)


def RX(theta):
    c, s = np.cos(theta / 2), np.sin(theta / 2)
    return np.array([[c, -1j * s], [-1j * s, c]], dtype=np.complex128)


H_GATE = np.array([[1, 1], [1, -1]], dtype=np.complex128) / np.sqrt(2)


def circuit_probs(params: np.ndarray, k: int, layers: int, ansatz: str = "hea") -> np.ndarray:
    """参数化量子电路（硬件高效型 Ansatz）→ Born 规则概率分布。"""
    state = np.zeros(2 ** k, dtype=np.complex128)
    state[0] = 1.0
    p = params.reshape(layers, k, 2)
    for L in range(layers):
        for q in range(k):
            state = apply_1q(state, RY(p[L, q, 0]), q, k)
            state = apply_1q(state, RZ(p[L, q, 1]), q, k)
        # 纠缠层：环形 CNOT
        for q in range(k):
            state = apply_cnot(state, q, (q + 1) % k, k)
    return np.abs(state) ** 2


def target_dist(H: np.ndarray, max_n: int, k: int, window: int = 300) -> np.ndarray:
    """历史经验分布 → 2^k 维目标分布（多余态置极小值）。"""
    cnt = H[-window:].sum(axis=0) + 0.5
    tgt = np.zeros(2 ** k)
    tgt[:max_n] = cnt
    tgt[max_n:] = cnt.mean() * 0.05
    return tgt / tgt.sum()


def mmd_loss(p: np.ndarray, q: np.ndarray, sigmas=(1.0, 2.0, 5.0, 10.0)) -> float:
    """最大均值差异（RBF 多核），原项目 QCBM 的训练损失。"""
    n = len(p)
    x = np.arange(n, dtype=np.float64)
    K = np.zeros((n, n))
    for s in sigmas:
        K += np.exp(-((x[:, None] - x[None, :]) ** 2) / (2 * s ** 2))
    d = p - q
    return float(d @ K @ d)


# ================================================================ 1. QCBM


@register("qcbm", "QCBM 量子电路玻恩机", CAT,
          "参数化量子电路（Ry+Rz 旋转层 + 环形 CNOT 纠缠层，硬件高效型 Ansatz）演化量子态，"
          "由 Born 规则 |⟨x|Ψ⟩|² 读出号码概率分布，用 MMD 多核损失 + 参数移位梯度训练。",
          ["QCBM", "Born规则", "参数化量子电路", "MMD损失", "参数移位规则"], cost=4)
def qcbm(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    layers = 3

    def side(H, max_n, seed):
        k = n_qubits_for(max_n)
        rng = np.random.default_rng(seed)
        params = rng.uniform(0, 2 * np.pi, layers * k * 2)
        tgt = target_dist(H, max_n, k)
        lr = 0.35
        hist = []
        for it in range(50):
            p = circuit_probs(params, k, layers)
            loss = mmd_loss(p, tgt)
            # 参数移位规则：∂⟨O⟩/∂θ = [f(θ+π/2) - f(θ-π/2)]/2
            grad = np.zeros_like(params)
            probe = rng.choice(len(params), size=min(8, len(params)), replace=False)
            for j in probe:
                for sign, coef in ((np.pi / 2, 0.5), (-np.pi / 2, -0.5)):
                    pp = params.copy()
                    pp[j] += sign
                    grad[j] += coef * mmd_loss(circuit_probs(pp, k, layers), tgt)
            params -= lr * grad
            if it % 12 == 0 or it == 49:
                hist.append({"迭代": it, "MMD损失": round(loss, 6)})
        p = circuit_probs(params, k, layers)
        info.setdefault("量子比特数", k)
        info.setdefault("态空间维度", 2 ** k)
        info.setdefault("训练轨迹", hist)
        info.setdefault("有效概率占比", round(float(p[:max_n].sum()), 4))
        return p[:max_n]

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "|Ψ(θ)⟩ = U_L(θ)···U_1(θ)|0⟩，P(x) = |⟨x|Ψ⟩|²（Born 规则）",
         "Ansatz": "硬件高效型 (Ry-Rz 旋转 + 环形 CNOT)",
         "电路层数": layers, "损失": "MMD 多核 RBF (σ=1,2,5,10)",
         "梯度": "参数移位规则 (parameter-shift rule)",
         "实现": "numpy 完整态矢量模拟（真实酉演化）"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 2. QRNN


@register("qrnn", "QRNN 量子循环神经网络", CAT,
          "把经典 GRU 的门控替换为量子线路：每个时间步将上一隐态与当期输入编码为旋转角，"
          "经酉演化后测量得到新隐态，序列末端读出概率分布。",
          ["QRNN", "量子GRU", "角度编码", "酉演化", "量子门控"], cost=4)
def qrnn(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    T = 6

    def side(H, max_n, seed):
        k = n_qubits_for(max_n)
        rng = np.random.default_rng(seed)
        Wg = rng.normal(0, 0.4, (k, 3))    # 输入/隐态/偏置 -> 旋转角
        hidden = np.zeros(k)
        seq = H[-T:]
        # 每期号码压缩为 k 维角度编码（比特位的加权出现率）
        for t in range(T):
            occ = seq[t]
            bits = np.zeros(k)
            for idx in np.nonzero(occ)[0]:
                for qb in range(k):
                    bits[qb] += (idx >> qb) & 1
            bits = bits / max(occ.sum(), 1)
            # 量子门控：角度 = tanh(W·[x, h, 1])
            theta = np.tanh(Wg[:, 0] * bits + Wg[:, 1] * hidden + Wg[:, 2]) * np.pi
            state = np.zeros(2 ** k, dtype=np.complex128)
            state[0] = 1.0
            for q in range(k):
                state = apply_1q(state, RY(theta[q]), q, k)
            for q in range(k):
                state = apply_cnot(state, q, (q + 1) % k, k)
            for q in range(k):
                state = apply_1q(state, RZ(theta[(q + 1) % k] * 0.5), q, k)
            probs = np.abs(state) ** 2
            # 测量每个比特为 1 的边缘概率 -> 新隐态
            new_h = np.zeros(k)
            idxs = np.arange(2 ** k)
            for q in range(k):
                new_h[q] = probs[(idxs >> q) & 1 == 1].sum()
            hidden = 0.7 * new_h + 0.3 * hidden   # GRU 式更新门
        info.setdefault("量子比特数", k)
        info.setdefault("末隐态(比特边缘概率)", [round(float(v), 3) for v in hidden])
        # 用最终隐态构造读出电路
        state = np.zeros(2 ** k, dtype=np.complex128)
        state[0] = 1.0
        for q in range(k):
            state = apply_1q(state, RY(hidden[q] * np.pi), q, k)
        for q in range(k):
            state = apply_cnot(state, q, (q + 1) % k, k)
        p = np.abs(state) ** 2
        emp = H[-200:].sum(axis=0) + 0.5
        return normalize(p[:max_n]) * 0.7 + normalize(emp) * 0.3

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "θ_t = tanh(W_x·x_t + W_h·h_{t-1} + b)·π → 酉演化 → 测量边缘概率得 h_t",
         "序列长度": T, "更新门系数": 0.7,
         "门序列": "Ry(θ) → 环形CNOT → Rz(0.5θ)",
         "读出": "Born 规则边缘概率 70% + 经验分布 30%"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 3. Qopula


@register("qopula", "Qopula 量子 Copula 模型", CAT,
          "用受控相位门构造量子 Copula，显式建模号码之间的依赖结构（而非独立边缘分布），"
          "相位调制强度由历史共现频次校准。",
          ["量子Copula", "受控相位门", "依赖结构", "相位调制", "边缘分布"], cost=4)
def qopula(ctx: AlgoContext) -> AlgoOutput:
    info = {}

    def side(H, max_n, seed):
        k = n_qubits_for(max_n)
        rng = np.random.default_rng(seed)
        # 边缘分布 -> Ry 角度（振幅编码近似）
        emp = H[-300:].sum(axis=0) + 0.5
        marg = np.zeros(2 ** k)
        marg[:max_n] = emp
        marg = marg / marg.sum()
        # 每比特边缘概率
        idxs = np.arange(2 ** k)
        bit_p = np.array([marg[(idxs >> q) & 1 == 1].sum() for q in range(k)])
        theta = 2 * np.arcsin(np.sqrt(np.clip(bit_p, 1e-6, 1 - 1e-6)))
        # 共现矩阵 -> 相位（Copula 依赖参数）
        C = H[-300:].T @ H[-300:]
        np.fill_diagonal(C, 0)
        bitc = np.zeros((k, k))
        for a in range(k):
            for b_ in range(k):
                if a == b_:
                    continue
                ma = np.array([(i >> a) & 1 for i in range(max_n)], dtype=bool)
                mb = np.array([(i >> b_) & 1 for i in range(max_n)], dtype=bool)
                bitc[a, b_] = C[np.ix_(ma, mb)].mean() if ma.any() and mb.any() else 0.0
        if bitc.max() > 0:
            phase = (bitc / bitc.max() - 0.5) * np.pi
        else:
            phase = np.zeros((k, k))

        state = np.zeros(2 ** k, dtype=np.complex128)
        state[0] = 1.0
        for q in range(k):
            state = apply_1q(state, RY(theta[q]), q, k)
        # Copula 层：受控相位耦合
        for a in range(k):
            for b_ in range(a + 1, k):
                state = apply_cphase(state, a, b_, float(phase[a, b_]), k)
        # 再做一层局部旋转让相位转化为可观测振幅差异
        for q in range(k):
            state = apply_1q(state, H_GATE, q, k)
            state = apply_1q(state, RY(theta[q] * 0.5), q, k)
        p = np.abs(state) ** 2
        info.setdefault("量子比特数", k)
        info.setdefault("比特边缘概率", [round(float(v), 3) for v in bit_p])
        info.setdefault("相位范围(rad)", [round(float(phase.min()), 3),
                                          round(float(phase.max()), 3)])
        return p[:max_n]

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "Copula: C(u₁..u_k) 分离边缘与依赖 —— Ry 编码边缘，受控相位 CP(φ) 编码依赖",
         "相位来源": "近 300 期号码共现矩阵校准",
         "门序列": "Ry(边缘) → CP(依赖相位) → H → Ry(0.5θ)"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 4. 量子行走


@register("qwalk", "Szegedy 量子随机行走", CAT,
          "在号码空间上做 Szegedy 量子行走：以 Hadamard 硬币算子 + 位移算子交替演化 8 步，"
          "利用量子相位干涉（而非经典扩散）产生非高斯的概率分布。",
          ["量子行走", "Szegedy", "Hadamard硬币", "相位干涉", "位移算子"], cost=3)
def qwalk(ctx: AlgoContext) -> AlgoOutput:
    info = {}
    steps = 8

    def side(H, max_n, seed):
        # 位置空间 max_n × 硬币空间 2
        psi = np.zeros((max_n, 2), dtype=np.complex128)
        # 初态：按最近一期开奖号码叠加（等权 + 相位随号码递增）
        last = np.nonzero(H[-1])[0]
        for i, pos in enumerate(last):
            psi[pos, 0] = np.exp(1j * 2 * np.pi * i / max(len(last), 1))
            psi[pos, 1] = 1j * np.exp(-1j * 2 * np.pi * i / max(len(last), 1))
        nrm = np.linalg.norm(psi)
        psi = psi / nrm if nrm > 1e-12 else psi
        Hc = H_GATE
        for _ in range(steps):
            # 硬币算子
            psi = psi @ Hc.T
            # 位移算子：|0⟩ 左移，|1⟩ 右移（周期边界）
            up = np.roll(psi[:, 0], -1)
            dn = np.roll(psi[:, 1], 1)
            psi = np.stack([up, dn], axis=1)
        p = (np.abs(psi) ** 2).sum(axis=1)
        info.setdefault("行走步数", steps)
        info.setdefault("位置空间维度", max_n)
        info.setdefault("初态支撑(上期号码)", [int(x) + 1 for x in last])
        info.setdefault("分布峰度",
                        round(float(((p - p.mean()) ** 4).mean() / (p.var() ** 2 + 1e-12)), 3))
        return p

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "|ψ_{t+1}⟩ = S·(I⊗H)|ψ_t⟩，S 为条件位移算子",
         "硬币算子": "Hadamard", "边界": "周期(环形)",
         "特点": "量子行走的方差 ∝ t²（经典随机行走为 ∝ t），呈双峰弹道式扩散"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ================================================================ 5. Grover


@register("grover", "Grover 扩散振幅放大", CAT,
          "以历史高频号码为 oracle 标记态，交替施加相位反转与 Grover 扩散算子，"
          "对被标记态做振幅放大（最优迭代次数 ≈ π/4·√(N/M)）。",
          ["Grover算法", "振幅放大", "扩散算子", "Oracle", "相位反转"], cost=3)
def grover(ctx: AlgoContext) -> AlgoOutput:
    info = {}

    def side(H, max_n, seed):
        k = n_qubits_for(max_n)
        N = 2 ** k
        # Oracle：标记近 100 期出现频次高于均值的号码
        cnt = H[-100:].sum(axis=0)
        thr = cnt.mean()
        marked = np.zeros(N, dtype=bool)
        marked[:max_n] = cnt > thr
        M = max(int(marked.sum()), 1)
        iters = max(int(np.floor(np.pi / 4 * np.sqrt(N / M))), 1)
        iters = min(iters, 12)
        # 均匀叠加态
        psi = np.ones(N, dtype=np.complex128) / np.sqrt(N)
        for _ in range(iters):
            psi[marked] *= -1                      # oracle 相位反转
            mean = psi.mean()
            psi = 2 * mean - psi                   # 扩散算子（关于均值反射）
        p = np.abs(psi) ** 2
        info.setdefault("量子比特数", k)
        info.setdefault("态空间维度", N)
        info.setdefault("标记态数 M", M)
        info.setdefault("Grover迭代次数", iters)
        info.setdefault("标记态总概率", round(float(p[marked].sum()), 4))
        return p[:max_n]

    r = side(ctx.RH, ctx.red_max, 42)
    b = side(ctx.BH, ctx.blue_max, 7)
    d = {"原理": "G = D·O，O 为 oracle 相位反转，D = 2|s⟩⟨s| - I 为扩散算子",
         "最优迭代": "⌊π/4·√(N/M)⌋",
         "Oracle定义": "近 100 期频次高于均值的号码",
         "说明": "Grover 提供 √N 加速搜索，但被标记的「高频号」并不代表真实中奖概率更高"}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)
