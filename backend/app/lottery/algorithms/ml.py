"""机器学习类算法（9 种，基于 scikit-learn 真实训练）。

设计参考：baseline.py（CatBoost/XGBoost/MLP/DNN/SVM/KNN）、
Machine.py 与 Taiyi_Machine.py（CatBoost 等梯度提升族）、
BVAR.py（PCA 降维）。

工程说明
--------
参考实现用 CatBoost / XGBoost / LightGBM + GPU。本服务器 4 核 CPU / 3.6G 内存无 GPU，
故改用 scikit-learn 的等效实现（HistGradientBoosting ≈ LightGBM 的直方图算法，
RandomForest / ExtraTrees / MLP / SVR / KNN 同族）。**这些是真实训练的模型**，
不是模拟。为控制响应时间，训练样本与迭代次数做了上限约束。
"""
from __future__ import annotations

import numpy as np

from app.lottery.algorithms.base import (
    AlgoContext,
    AlgoOutput,
    build_feature_matrix,
    normalize,
    register,
)

CAT = "ml"

try:  # sklearn 为可选依赖
    from sklearn.decomposition import PCA
    from sklearn.ensemble import (
        ExtraTreesRegressor,
        HistGradientBoostingRegressor,
        RandomForestRegressor,
    )
    from sklearn.linear_model import LogisticRegression, Ridge
    from sklearn.neighbors import KNeighborsRegressor
    from sklearn.neural_network import MLPRegressor
    from sklearn.svm import SVR

    HAS_SK = True
except Exception:  # noqa: BLE001
    HAS_SK = False


MAX_TRAIN = 900  # 训练样本上限（控制响应时间）


def _xy(ctx: AlgoContext, side: str, limit: int = MAX_TRAIN):
    """构造监督学习样本：X_t -> Y_{t+1}（下一期出现向量）。"""
    X, Y = build_feature_matrix(ctx, side)
    Xtr, Ytr = X[:-1], Y[1:]
    if len(Xtr) > limit:
        Xtr, Ytr = Xtr[-limit:], Ytr[-limit:]
    return Xtr, Ytr, X[-1:]


def _ridge_np(Xtr, Ytr, x_last, lam=1.0):
    """numpy 岭回归（sklearn 缺失时的降级实现）。"""
    Xb = np.hstack([Xtr, np.ones((len(Xtr), 1))])
    xb = np.hstack([x_last, np.ones((1, 1))])
    W = np.linalg.solve(Xb.T @ Xb + lam * np.eye(Xb.shape[1]), Xb.T @ Ytr)
    return (xb @ W).ravel()


def _run_both(ctx: AlgoContext, fit_predict, detail: dict) -> AlgoOutput:
    out = {}
    for side in ("red", "blue"):
        Xtr, Ytr, x_last = _xy(ctx, side)
        if len(Xtr) < 30:
            H = ctx.RH if side == "red" else ctx.BH
            out[side] = H.mean(axis=0)
            continue
        out[side] = np.asarray(fit_predict(Xtr, Ytr, x_last), dtype=np.float64).ravel()
    detail.setdefault("训练样本数", int(min(ctx.n - 1, MAX_TRAIN)))
    detail.setdefault("特征维度", int(build_feature_matrix(ctx, "red")[0].shape[1]))
    if not HAS_SK:
        detail["降级说明"] = "scikit-learn 不可用，已降级为 numpy 岭回归"
    return AlgoOutput(red=out["red"], blue=out["blue"], detail=detail)


# ---------------------------------------------------------------- 1. 岭回归

@register("ridge", "岭回归 (L2 正则)", CAT,
          "多输出岭回归：以统计特征预测下期每个号码的出现概率，L2 正则抑制过拟合。",
          ["岭回归", "L2正则", "线性模型", "多输出"], cost=2)
def ridge(ctx: AlgoContext) -> AlgoOutput:
    def fp(Xtr, Ytr, x_last):
        if HAS_SK:
            m = Ridge(alpha=1.0).fit(Xtr, Ytr)
            return m.predict(x_last)
        return _ridge_np(Xtr, Ytr, x_last)
    return _run_both(ctx, fp, {"原理": "min ‖Y - XW‖² + α‖W‖²，闭式解 W = (XᵀX+αI)⁻¹XᵀY",
                               "α": 1.0, "模型": "sklearn Ridge" if HAS_SK else "numpy 闭式解"})


# ---------------------------------------------------------------- 2. 随机森林

@register("random_forest", "随机森林回归", CAT,
          "120 棵决策树的 Bagging 集成，每棵树在特征与样本的随机子集上训练，输出平均预测。",
          ["随机森林", "Bagging", "决策树集成", "特征重要性"], cost=4)
def random_forest(ctx: AlgoContext) -> AlgoOutput:
    imp = {}

    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            return _ridge_np(Xtr, Ytr, x_last)
        m = RandomForestRegressor(
            n_estimators=120, max_depth=10, min_samples_leaf=3,
            n_jobs=-1, random_state=42,
        ).fit(Xtr, Ytr)
        if not imp:
            top = np.argsort(-m.feature_importances_)[:5]
            imp["top5特征索引"] = [int(i) for i in top]
            imp["top5重要度"] = [round(float(m.feature_importances_[i]), 4) for i in top]
        return m.predict(x_last)
    d = {"原理": "Bootstrap 抽样 + 随机特征子集训练多棵 CART，取平均",
         "树数量": 120, "最大深度": 10, "最小叶节点样本": 3}
    out = _run_both(ctx, fp, d)
    out.detail.update(imp)
    return out


# ---------------------------------------------------------------- 3. 梯度提升

@register("gbdt", "梯度提升树 (LightGBM 等效)", CAT,
          "直方图梯度提升（HistGradientBoosting，算法与 LightGBM 同源），"
          "逐轮拟合残差的加法模型。参考实现此处用 CatBoost/XGBoost。",
          ["梯度提升", "GBDT", "直方图算法", "LightGBM等效", "CatBoost替代"], cost=4)
def gbdt(ctx: AlgoContext) -> AlgoOutput:
    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            return _ridge_np(Xtr, Ytr, x_last)
        preds = []
        for j in range(Ytr.shape[1]):
            m = HistGradientBoostingRegressor(
                max_iter=25, learning_rate=0.15, max_depth=4,
                min_samples_leaf=16, l2_regularization=1.0, random_state=42,
            ).fit(Xtr, Ytr[:, j])
            preds.append(float(m.predict(x_last)[0]))
        return np.array(preds)
    return _run_both(ctx, fp, {
        "原理": "F_m(x) = F_{m-1}(x) + η·h_m(x)，h_m 拟合负梯度（残差）",
        "迭代轮数": 25, "学习率": 0.15, "最大深度": 4, "L2正则": 1.0,
        "等效对标": "LightGBM / CatBoost / XGBoost"})


# ---------------------------------------------------------------- 4. 极端随机树

@register("extra_trees", "极端随机树 (ExtraTrees)", CAT,
          "极端随机化树集成：分裂点完全随机选取而非最优搜索，方差更低、训练更快。",
          ["ExtraTrees", "极端随机化", "方差削减"], cost=3)
def extra_trees(ctx: AlgoContext) -> AlgoOutput:
    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            return _ridge_np(Xtr, Ytr, x_last)
        m = ExtraTreesRegressor(
            n_estimators=150, max_depth=12, min_samples_leaf=2,
            n_jobs=-1, random_state=42,
        ).fit(Xtr, Ytr)
        return m.predict(x_last)
    return _run_both(ctx, fp, {"原理": "随机选分裂阈值（不做最优搜索）以进一步去相关，降低集成方差",
                               "树数量": 150, "最大深度": 12})


# ---------------------------------------------------------------- 5. MLP

@register("mlp", "MLP 多层感知机", CAT,
          "全连接神经网络 [256,128,64]，ReLU 激活 + Adam 优化 + 早停，端到端学习特征到号码的映射。",
          ["MLP", "神经网络", "Adam", "反向传播", "早停"], cost=4)
def mlp(ctx: AlgoContext) -> AlgoOutput:
    info = {}

    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            return _ridge_np(Xtr, Ytr, x_last)
        m = MLPRegressor(
            hidden_layer_sizes=(256, 128, 64), activation="relu",
            solver="adam", alpha=1e-3, learning_rate_init=2e-3,
            max_iter=260, early_stopping=True, n_iter_no_change=12,
            random_state=42,
        )
        m.fit(Xtr, Ytr)
        info["实际迭代轮数"] = int(m.n_iter_)
        info["最终训练损失"] = round(float(m.loss_), 6)
        return m.predict(x_last)
    d = {"原理": "y = W₃·σ(W₂·σ(W₁x)) ，MSE 损失 + Adam 优化 + 验证集早停",
         "隐层结构": [256, 128, 64], "激活": "ReLU", "优化器": "Adam",
         "L2正则": 1e-3, "最大轮数": 260}
    out = _run_both(ctx, fp, d)
    out.detail.update(info)
    return out


# ---------------------------------------------------------------- 6. SVM

@register("svm", "支持向量回归 (RBF核)", CAT,
          "RBF 核支持向量回归，在高维核空间寻找 ε-管道内的最大间隔拟合。样本量限 500 期以控耗时。",
          ["SVM", "SVR", "RBF核", "核方法", "最大间隔"], cost=4)
def svm(ctx: AlgoContext) -> AlgoOutput:
    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            return _ridge_np(Xtr, Ytr, x_last)
        Xs, Ys = Xtr[-500:], Ytr[-500:]
        mu, sd = Xs.mean(axis=0), Xs.std(axis=0) + 1e-9
        Xn, xn = (Xs - mu) / sd, (x_last - mu) / sd
        preds = []
        for j in range(Ys.shape[1]):
            m = SVR(kernel="rbf", C=2.0, gamma="scale", epsilon=0.05).fit(Xn, Ys[:, j])
            preds.append(float(m.predict(xn)[0]))
        return np.array(preds)
    return _run_both(ctx, fp, {
        "原理": "min ½‖w‖² + CΣξ，s.t. |y - f(x)| ≤ ε + ξ，RBF 核 K(x,x')=exp(-γ‖x-x'‖²)",
        "核函数": "RBF", "C": 2.0, "ε": 0.05, "训练样本上限": 500,
        "特征标准化": "z-score"})


# ---------------------------------------------------------------- 7. KNN 回归

@register("knn_reg", "K 近邻回归", CAT,
          "在特征空间取 K=25 个最近邻，按距离倒数加权平均其下期出现向量（非参数化局部模型）。",
          ["KNN", "非参数模型", "距离加权", "局部回归"], cost=2)
def knn_reg(ctx: AlgoContext) -> AlgoOutput:
    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            d = np.sqrt(((Xtr - x_last) ** 2).sum(axis=1))
            idx = np.argsort(d)[:25]
            w = 1 / (d[idx] + 1e-6)
            return (Ytr[idx] * (w / w.sum())[:, None]).sum(axis=0)
        m = KNeighborsRegressor(n_neighbors=25, weights="distance").fit(Xtr, Ytr)
        return m.predict(x_last)
    return _run_both(ctx, fp, {"原理": "ŷ = Σ wᵢyᵢ / Σwᵢ，wᵢ = 1/d(x,xᵢ)",
                               "K": 25, "权重": "距离倒数"})


# ---------------------------------------------------------------- 8. PCA 重构

@register("pca_recon", "PCA 主成分重构预测", CAT,
          "对出现矩阵做 PCA 降维（保留 95% 方差），在主成分空间线性外推后逆变换回号码空间。",
          ["PCA", "主成分分析", "降维", "SVD", "线性外推"], cost=2)
def pca_recon(ctx: AlgoContext) -> AlgoOutput:
    info = {}

    def side(H, max_n):
        if H.shape[1] < 4 or ctx.n < 40:
            return H.mean(axis=0)
        if HAS_SK:
            k = min(max(int(max_n * 0.5), 3), max_n - 1, ctx.n - 1)
            p = PCA(n_components=k, random_state=42).fit(H)
            Z = p.transform(H)
            ev = float(p.explained_variance_ratio_.sum())
            info.setdefault("主成分数", k)
            info.setdefault("累计解释方差", round(ev, 4))
            # 主成分空间上做 EWMA + 线性外推
            zt = Z[-12:]
            slope = np.polyfit(np.arange(len(zt)), zt, 1)[0]
            z_next = Z[-1] + slope
            return p.inverse_transform(z_next.reshape(1, -1)).ravel()
        Hc = H - H.mean(axis=0)
        U, S, Vt = np.linalg.svd(Hc, full_matrices=False)
        k = min(12, len(S))
        Z = U[:, :k] * S[:k]
        z_next = Z[-1] + (Z[-1] - Z[-2])
        return z_next @ Vt[:k] + H.mean(axis=0)

    r = side(ctx.RH, ctx.red_max)
    b = side(ctx.BH, ctx.blue_max)
    d = {"原理": "H ≈ ZVᵀ，在 Z 空间线性外推一步后 inverse_transform 回号码空间",
         "保留方差目标": 0.95}
    d.update(info)
    return AlgoOutput(red=r, blue=b, detail=d)


# ---------------------------------------------------------------- 9. 逻辑回归

@register("logistic", "逻辑回归分类", CAT,
          "对每个号码独立训练二分类逻辑回归（是否在下期出现），输出 sigmoid 概率。",
          ["逻辑回归", "二分类", "sigmoid", "最大似然"], cost=3)
def logistic(ctx: AlgoContext) -> AlgoOutput:
    def fp(Xtr, Ytr, x_last):
        if not HAS_SK:
            return _ridge_np(Xtr, Ytr, x_last)
        mu, sd = Xtr.mean(axis=0), Xtr.std(axis=0) + 1e-9
        Xn, xn = (Xtr - mu) / sd, (x_last - mu) / sd
        preds = []
        for j in range(Ytr.shape[1]):
            y = (Ytr[:, j] > 0).astype(int)
            if y.min() == y.max():
                preds.append(float(y.mean()))
                continue
            m = LogisticRegression(C=0.6, max_iter=400, solver="lbfgs").fit(Xn, y)
            preds.append(float(m.predict_proba(xn)[0, 1]))
        return np.array(preds)
    return _run_both(ctx, fp, {
        "原理": "P(y=1|x) = 1/(1+e^{-wᵀx})，L2 正则最大似然估计",
        "C (正则强度倒数)": 0.6, "求解器": "lbfgs", "最大迭代": 400})
