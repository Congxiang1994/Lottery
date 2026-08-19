# 彩票预测系统集合 - README

### 本系统开源仓库：https://github.com/carpenterma7/lottery_easy

## 免责声明

**重要提示：** 彩票本质上是一种随机事件，中奖号码没有任何可预测的规律。本项目中的所有代码和内容仅用于个人技术探讨与交流，不构成任何形式的彩票购买建议。请务必相信科学，理性对待彩票，谨慎投资。本项目严禁用于任何商业用途，开发者不对因使用本项目内容而产生的任何损失或风险承担责任。

## 系统功能概览

本项目集合了 20 余种彩票预测系统的实现，涵盖深度学习、量子计算、符号回归、贝叶斯推断、传统术数等多种技术路线，从概率统计、机器学习到模式识别等多个角度对彩票数据进行分析和探索。以下两表详细列出每个系统所使用的核心算法与模型、玄学术数体系、数学方法。

**表一：核心算法与模型**

| 预测系统 | 支持彩种 | 核心算法与模型 |
|---------|---------|--------------|
| lottery_easy_BVAR.py | SSQ / DLT / DF61 | 贝叶斯向量自回归（BVAR）、Pyro 概率编程、MCMC/NUTS 采样、PCA/t-SNE 降维、RFE/树模型/Lasso 特征选择、Optuna 超参优化、时间序列交叉验证 |
| lottery_easy_Bazi.py | SSQ / DLT | 八字命理推断、误差驱动学习（LEARNING_RATE=0.05）、三级权重系统（40%/30%/30%） |
| lottery_easy_Gua.py | SSQ / DLT | 梅花易数起卦、组合公式搜索、多策略投票（AdvancedVotingStrategy）、统计显著性检验（二项检验+Bonferroni校正）、FFT周期分析 |
| lottery_easy_LM.py | SSQ / DLT | Transformer（d_model=128,nhead=4,3层）、LSTM（hidden=128,2层）、MLP（[256,128]）、球级Tokenization、CLS token、FocalLoss/标签平滑 |
| lottery_easy_Machine.py | SSQ / DLT | 11种模型：CatBoost、TCN（时间卷积）、ResDNN（残差网络）、WideDeep、DeepAR、CVAE、TFT（时序融合Transformer）、NBEATS、NHiTS、GAT（图注意力）、VAEGAN |
| lottery_easy_QiZheng.py | SSQ / DLT | Transformer（d_model=128,8头,3层）、GAN（生成器4层+判别器4层）、交叉注意力、知识蒸馏、谱归一化、条件批归一化、自注意力 |
| lottery_easy_Quantum.py | SSQ / DLT | QCBM（量子电路玻恩机）、QRNN（量子GRU）、Qopula（量子Copula）、转移矩阵预测器、参数化量子电路（Ry/Rz/CNOT门） |
| lottery_easy_SR.py | SSQ / DLT / DF61 | PySR符号回归（Julia后端）、进化搜索、多轮训练（最多1000轮）、统一球位模式、组合ID模式 |
| lottery_easy_SR_2.py | SSQ / DLT | PySR符号回归、7种X数据构造方法、多轮训练/预测、跨彩种映射 |
| lottery_easy_Taiyi_GNN.py | SSQ / DLT | GAT图注意力网络（torch_geometric,2层,128维,4头）、ConditionalGNN、SemanticMLP、SemanticTransformer |
| lottery_easy_Taiyi_Machine.py | SSQ / DLT / 7XC / 3D | 20+种模型：CatBoost、ARM关联规则、MLP、DNN（残差）、Transformer（特征分组）、6种距离相似性、PySR符号回归、注意力MLP、差值预测、K近邻加权、自回归生成、条件VAE |
| lottery_easy_VAE_GAN.py | SSQ / DLT | VAE（潜在空间32维）、WGAN-GP（梯度惩罚λ=10）、Transformer（256维,8头,6层）、元学习器融合 |
| lottery_easy_baseline.py | SSQ / DLT / DF61 | 5种统计模型（MI/NB/CHI/CPT/ARM）+ 4种ML模型（CatBoost/XGBoost/MLP/DNN）+ 5种相似性模型 |
| lottery_easy_Emulator.py | SSQ / DLT | 冷门号码理论、彩民投注行为模拟、解析概率评估 |
| lottery_easy_seed.py | SSQ / DLT | 种子穷举寻优、GPU批量加速（LotteryGenerator+DataLoader）、多进程并行 |
| lottery_easy_seed2.py | SSQ / DLT | 7种玄学算法穷举、参数网格搜索、多进程并行评估 |
| lottery_easy_seed3.py | SSQ / DLT | 1000+种数学方法穷举、FuncWrapper可序列化包装、多进程穷举评估 |
| lottery_easy_steps.py | SSQ / DLT | 雷达图编码、PyTorch预报器、号码↔雷达图双向转换 |
| lottery_easy_football.py | 足球 | ARM关联规则、Poisson/Dixon-Coles模型、CatBoost、TabNet、XGBoost、LightGBM、相似性模型、二次训练系统 |
| ziwei-wuxing-main.py | SSQ / DLT | 紫微斗数宫位→五行向量→余弦相似度匹配、Tkinter GUI |
| quantum_lottery_predictor.py | SSQ | PennyLane参数化量子电路、Adam优化器、红/蓝球独立量子模型（7个模型） |
| Lottery_easy_Gua_Rust/ | SSQ / DLT | 梅花易数起卦+公式搜索（Rust实现）、模块化设计 |

**表二：玄学术数与数学方法**

| 预测系统 | 玄学术数 | 数学方法 |
|---------|---------|---------|
| lottery_easy_BVAR.py | 梅花易数（36维）、奇门遁甲（29维）、九宫六壬（21维）、紫微斗数、铁板神数、九天玄数、太乙神数、周易八卦、五行、八字、天文特征（skyfield） | 马氏距离、概率密度估计、傅里叶变换（季节性）、趋势/季节性分解、后验分布采样、Bootstrap 不确定性量化 |
| lottery_easy_Bazi.py | 八字四柱、纳音五行、天干合化、地支六合/三合/相冲/相害/相刑、十二长生旺衰、命宫命卦、河洛数理、喜用神推断 | 加权随机采样、命中率统计、权重动态调整、命宫数综合权重（三才法×0.4+日主法×0.35+纳音法×0.25） |
| lottery_easy_Gua.py | 梅花易数、周易64卦、太乙神数、奇门遁甲、六壬、纳甲法、六神、体用生克、卦象旺衰 | 加减乘/移位/取模组合搜索、欧氏/曼哈顿/切比雪夫/余弦距离、FFT傅里叶变换、条件概率、高阶马尔可夫、频率分析 |
| lottery_easy_LM.py | 无 | softmax概率分布、正弦/可学习位置编码、AdamW优化器、CosineAnnealingWarmRestarts学习率调度、梯度裁剪、N/V/T数据集划分 |
| lottery_easy_Machine.py | 无 | 属性预测（奇偶比/大小比/012路/区间分布/和值/AC值）、不确定性估计（正态分布）、四大类统计特征（基础/频次遗漏/走势关联/空间位置） |
| lottery_easy_QiZheng.py | 七政四余（日月金木水火土七政+罗睺计都紫气月孛四余）、月相、行星逆行、二十八宿、星座特征 | 周期编码（sin/cos避免角度断裂）、260维天文特征向量、L-BFGS优化、联合训练（蒸馏温度2.0,教师权重0.7） |
| lottery_easy_Quantum.py | 无 | Born规则概率诠释（\|⟨x\|Ψ⟩\|²）、Szegedy量子行走（5步+Hadamard相位干涉）、Grover扩散反射算子、MMD/Sinkhorn/KL损失、马尔可夫链 |
| lottery_easy_SR.py | 农历天干地支、天文特征、九宫六壬、梅花易数、农历梅花易数、64卦、玄学特征、时间卦 | 加减乘/mod/幂运算、sin/cos/tan/tanh/abs、自定义损失函数（unified_ball_hit/distance_weighted_hit/probability_hit/huber）、NelderMead优化 |
| lottery_easy_SR_2.py | 八字四柱、北斗七星映射（贪狼/巨门/禄存/文曲/廉贞/武曲/破军）、七曜映射（日月+金木水火土） | 加减乘/mod/自定义分段函数（myifgt/myiflt）、sin/cos/abs、L1DistLoss、加权/等权投票、移动平均、差分趋势 |
| lottery_easy_Taiyi_GNN.py | 太乙神数（89维特征：局式/位置/算数/神煞/八门/八宫旺衰/推断法）、洛书九宫图结构 | 洛书九宫格图建模（9节点,相邻+对宫连边）、one-hot/二值编码、全局池化、余弦相似度 |
| lottery_easy_Taiyi_Machine.py | 太乙神数（87维特征）、积年取模搜索（太乙大年周期25920/十年大运43200） | 积年取模值搜索、循环距离（环形取模空间）、语义感知归一化、特征分组Transformer（18组token）、多取模值加权投票 |
| lottery_easy_VAE_GAN.py | 梅花易数、九宫六壬、八字 | KL散度、Wasserstein距离、梯度惩罚、concat/attention/weighted/meta_learner四种融合策略、滑动窗口序列构建 |
| lottery_easy_baseline.py | 大六壬（LiurenFeatureExtractor/KinLiuren）、紫微斗数、紫微五行（10维）、奇门遁甲、天气特征 | 互信息、卡方检验（χ²）、条件概率表、Apriori关联规则、拉普拉斯平滑、DTW动态时间规整、7种距离、4种权重 |
| lottery_easy_Emulator.py | 无 | 泊松分布（λ∈[3,10]）、初等对称多项式（精确组合概率）、冷门度加权采样（1/p）、组合模式评分、解析加速300万倍 |
| lottery_easy_seed.py | 无 | 5种种子生成模式：ADD（加法）、MULT（乘法）、COS（余弦）、LDEV（序号偏离）、POS（位置加权）；每球位独立寻优 |
| lottery_easy_seed2.py | 周易64卦、太乙神数、铁板神数、九天玄数、梅花易数、移动平均、随机 | 参数网格搜索（seed 1-100 × window 3/5/7/10）、命中率评估、配置持久化 |
| lottery_easy_seed3.py | 无 | 基础算术（13种）、加减乘除组合（80种）、三角函数（66种）、统计方法（20种）、时序方法（50种：ARIMA/季节性分解/VAR/LSTM/Prophet）、ML方法（50种）、物理方法（50种：布朗运动/热传导/混沌理论）、自定义组合（300种）、随机变换（150种） |
| lottery_easy_steps.py | 无 | Lucas-Kanade光流法、VET变分回波跟踪（λ=100,α=0.5,γ=0.1）、外推法（双三次/双线性/Lanczos）、5种映射方案 |
| lottery_easy_football.py | 太乙神数、大六壬、奇门遁甲、七政四余、统计特征 | Poisson分布（xi=0.0018时间衰减）、Dixon-Coles修正（rho=-0.1）、Apriori关联规则、L-BFGS-B优化、TimeSeriesSplit交叉验证 |
| ziwei-wuxing-main.py | 紫微斗数十二宫星曜、阴阳五行属性、五行生克关系 | 余弦相似度、五行生克加权（相生/相克/相同/被生/被克权重）、趋势分析可视化 |
| quantum_lottery_predictor.py | 无 | 角度编码（RX门,0-2π归一化）、离散编码（BasisEmbedding）、Rot+CNOT量子门纠缠、交叉熵损失、学习率衰减、滑动窗口特征、高斯噪声数据增强 |
| Lottery_easy_Gua_Rust/ | 梅花易数、周易64卦 | 加减乘/移位/取模组合搜索、多参数组合联合搜索、投票策略（多距离度量） |

> **彩种说明：** SSQ = 双色球（6 红 1-33 + 1 蓝 1-16）；DLT = 大乐透（5 红 1-35 + 2 蓝 1-12）；DF61 = 东方 6+1；7XC = 七乐彩；3D = 福彩 3D。


**致谢：** 本项目中几个算法使用了 ken 兄开源的玄学库（kinliuren、kinqimen、kintaiyi），在此致谢。

### 技术路线详细总结

本项目集合了 20 余种彩票预测系统，涵盖了从现代人工智能到传统玄学术数的广泛技术路线。以下按类别详细说明所使用的全部算法、术数体系与数学方法。

#### 一、深度学习与机器学习算法

**1. Transformer 架构族**
- **标准 Transformer**：用于 lottery_easy_LM.py（d_model=128, nhead=4, 3层编码器）、lottery_easy_QiZheng.py（d_model=128, nhead=8, 3层编码器+3层解码器）、lottery_easy_Taiyi_Machine.py（d_model=64, nhead=4, 4层，特征分组18组token）
- **时序融合 Transformer（TFT）**：用于 lottery_easy_Machine.py，专为多尺度时序数据设计
- **Temporal Fusion Transformer**：融合长短期时序依赖与协变量

**2. 循环神经网络族**
- **LSTM**：用于 lottery_easy_LM.py（hidden_size=128, 2层）
- **QRNN（量子增强 GRU）**：用于 lottery_easy_Quantum.py（hidden_dim=128, 2层），将经典 GRU 的门控机制替换为量子增强版本
- **DeepAR（深度自回归网络）**：用于 lottery_easy_Machine.py，自回归地生成概率分布

**3. 卷积网络族**
- **TCN（时间卷积网络）**：用于 lottery_easy_Machine.py（kernel_size=3, dilation_base=2），通过膨胀卷积捕捉长程依赖
- **ResDNN（残差深度神经网络）**：用于 lottery_easy_Machine.py，通过残差连接解决深层网络梯度消失

**4. 生成模型族**
- **VAE（变分自编码器）**：用于 lottery_easy_VAE_GAN.py（潜在空间32维）、lottery_easy_Machine.py 的 CVAE（条件变分自编码器）、lottery_easy_Taiyi_Machine.py 的条件 VAE（潜在空间16维）
- **GAN（生成对抗网络）**：用于 lottery_easy_VAE_GAN.py 的 WGAN-GP（梯度惩罚λ=10）、lottery_easy_QiZheng.py 的改进 GAN（谱归一化+条件批归一化+自注意力）、lottery_easy_Machine.py 的 VAEGAN
- **自回归生成器**：用于 lottery_easy_Taiyi_Machine.py（条件编码器2层,采样21次）

**5. 图神经网络族**
- **GAT（图注意力网络）**：用于 lottery_easy_Taiyi_GNN.py（2层, 128维, 4头, torch_geometric）、lottery_easy_Machine.py
- **ConditionalGNN（条件图网络）**：用于 lottery_easy_Taiyi_GNN.py

**6. 经典机器学习模型**
- **CatBoost**：用于 lottery_easy_Machine.py、lottery_easy_Taiyi_Machine.py（iterations=1000, depth=6）、lottery_easy_baseline.py、lottery_easy_football.py
- **XGBoost**：用于 lottery_easy_baseline.py（max_depth=6, n_estimators=200）
- **LightGBM**：用于 lottery_easy_football.py 二次训练
- **MLP（多层感知机）**：用于 lottery_easy_LM.py（[256,128]）、lottery_easy_Taiyi_Machine.py（[256,128,64]）
- **DNN（深度神经网络）**：用于 lottery_easy_baseline.py（[512,256,128,64,32], 残差连接）
- **TabNet**：用于 lottery_easy_football.py
- **SVM/KNN**：用于 lottery_easy_baseline.py

**7. 时序预测专用模型**
- **NBEATS（神经基展开分析）**：用于 lottery_easy_Machine.py
- **NHiTS（神经层次插值）**：用于 lottery_easy_Machine.py
- **WideDeep（宽深学习）**：用于 lottery_easy_Machine.py

**8. 注意力与融合策略**
- **交叉注意力**：用于 lottery_easy_QiZheng.py（号码特征查询天文特征）
- **自注意力**：用于 lottery_easy_QiZheng.py GAN 判别器
- **元学习器融合**：用于 lottery_easy_VAE_GAN.py（concat/attention/weighted/meta_learner 四种策略）
- **知识蒸馏**：用于 lottery_easy_QiZheng.py（Transformer 教师蒸馏指导 GAN 学生, 蒸馏温度2.0）

**9. 损失函数**
- **FocalLoss**：用于 lottery_easy_LM.py（gamma=2.0）、lottery_easy_QiZheng.py
- **标签平滑交叉熵**：用于 lottery_easy_LM.py（smoothing=0.1）
- **MMD（最大均值差异）**：用于 lottery_easy_Quantum.py（RBF核, σ=[1,2,5,10]）
- **Sinkhorn 散度**：用于 lottery_easy_Quantum.py
- **KL 散度**：用于 lottery_easy_Quantum.py、lottery_easy_VAE_GAN.py
- **Wasserstein 距离**：用于 lottery_easy_VAE_GAN.py WGAN-GP
- **L1DistLoss**：用于 lottery_easy_SR_2.py

#### 二、量子计算算法

**1. QCBM（量子电路玻恩机）**：用于 lottery_easy_Quantum.py，通过参数化量子电路（Ry旋转层+纠缠层）演化初始量子态，由 Born 规则 |⟨x|Ψ⟩|² 得到数字概率分布。支持三种 Ansatz：硬件高效型(hea)/问题启发型/自适应。

**2. QRNN（量子循环神经网络）**：将经典 GRU 的门控机制替换为量子增强版本，建模序列时序依赖。

**3. Qopula（量子 Copula 模型）**：用量子电路实现 Copula 函数，捕捉变量间的依赖结构，含相位调制。

**4. Szegedy 量子行走**：5 步量子行走 + Hadamard-like 相位干涉增强，捕捉高阶关联；近期加权（decay=0.85）+ 反重复衰减。

**5. Grover 扩散反射算子**：用于量子搜索放大目标态概率幅。

**6. PennyLane 量子机器学习**：用于 quantum_lottery_predictor.py，红/蓝球独立训练7个量子模型，支持角度编码（RX门）和离散编码（BasisEmbedding）。

**7. 量子态编码方案**：direct（直接one-hot）/ combinatorial（组合压缩编码）/ hybrid（混合分区编码）。

#### 三、符号回归算法

**1. PySR（Python Symbolic Regression）**：基于 Julia 后端的符号回归引擎，通过进化搜索在数学算子空间中自动发现 X→Y 的显式数学公式。
- 用于 lottery_easy_SR.py（niterations=99999, maxsize=128, populations=49, 7种损失函数）
- 用于 lottery_easy_SR_2.py（niterations=2401, maxsize=77, populations=14, L1DistLoss）
- 用于 lottery_easy_Taiyi_Machine.py（niterations=3600, maxsize=36, populations=12）

**2. 自定义算子**：myifgt/myiflt 分段函数（SR_2）、mod 取模运算、幂运算（constraints: "^": (0,3)）

**3. 进化搜索参数**：种群大小、种群数量、每次迭代周期数、自适应简约缩放、NelderMead/BFGS 优化器

#### 四、贝叶斯与概率统计算法

**1. BVAR（贝叶斯向量自回归）**：用于 lottery_easy_BVAR.py，模型 `y_t = intercept + coef · X_{t-lag} + ε`，通过 Pyro 的 NUTS/MCMC 采样获得参数后验分布（mcmc_samples=5760, warmup=1680, target_accept=0.85）。

**2. 互信息（MI）**：用于 lottery_easy_baseline.py，衡量特征与号码的非线性相关性（mi_threshold=0.01）。

**3. 朴素贝叶斯（NB）**：用于 lottery_easy_baseline.py，拉普拉斯平滑（smoothing_alpha=1.0）。

**4. 卡方检验（CHI）**：用于 lottery_easy_baseline.py（chi_threshold=3.84, p=0.05）。

**5. 条件概率表（CPT）**：用于 lottery_easy_baseline.py（smoothing=0.1, combine_method='average'）。

**6. Apriori 关联规则挖掘（ARM）**：用于 lottery_easy_baseline.py（min_support=0.02）、lottery_easy_Taiyi_Machine.py（min_support=0.005, min_confidence=0.15）、lottery_easy_football.py（min_support=0.001, min_confidence=0.35）。

**7. 泊松分布**：用于 lottery_easy_Emulator.py（λ∈[3,10], 彩民投注模拟）、lottery_easy_football.py（Poisson/Dixon-Coles 模型, xi=0.0018 时间衰减）。

**8. 统计显著性检验**：用于 lottery_easy_Gua.py（二项检验+Bonferroni校正, significance_level=0.15）。

#### 五、传统玄学术数体系

**1. 八字命理**：用于 lottery_easy_Bazi.py、lottery_easy_SR_2.py、lottery_easy_BVAR.py。包含四柱（年/月/日/时）推排、纳音五行、日主旺衰分析、喜用神推断、天干合化、地支六合/三合/相冲/相害/相刑、十二长生旺衰、命宫命卦、河洛数理。

**2. 梅花易数**：用于 lottery_easy_Gua.py、lottery_easy_BVAR.py（36维）、lottery_easy_seed2.py、lottery_easy_VAE_GAN.py。通过农历年月日时起卦，衍生本卦、变卦、互卦及其先天数、后天数、五行、能量值、河图数等特征。

**3. 周易八卦/64卦**：用于 lottery_easy_Gua.py、lottery_easy_seed2.py、lottery_easy_BVAR.py（91维64卦特征）。包含纳甲法、六神、体用生克、卦象旺衰。

**4. 太乙神数**：用于 lottery_easy_Taiyi_GNN.py（89维）、lottery_easy_Taiyi_Machine.py（87维）、lottery_easy_seed2.py、lottery_easy_BVAR.py。包含局式、位置、算数、神煞、八门、八宫旺衰、推断法，支持4种计法（年/月/日/时/分计）和4种公式（统宗/金镜/淘金歌/太乙局）。独创积年取模搜索（太乙大年周期25920, 十年大运43200）。

**5. 大六壬/九宫六壬**：用于 lottery_easy_baseline.py（LiurenFeatureExtractor/KinLiuren）、lottery_easy_BVAR.py（21维九宫六壬）、lottery_easy_football.py。包含天将、贵人、刑冲合害破等传统六壬神盘要素。

**6. 奇门遁甲**：用于 lottery_easy_BVAR.py（29维）、lottery_easy_baseline.py、lottery_easy_football.py。

**7. 紫微斗数**：用于 ziwei-wuxing-main.py（十二宫星曜→五行向量）、lottery_easy_baseline.py（紫微斗数+紫微五行10维）、lottery_easy_BVAR.py。包含主辅杂曜五行属性、宫位天干地支耦合、五行生克加权。

**8. 七政四余**：用于 lottery_easy_QiZheng.py（260维天文特征）、lottery_easy_BVAR.py（skyfield天文特征）、lottery_easy_football.py。七政（日月金木水火土7颗实星）+ 四余（罗睺/计都/紫气/月孛虚星）+ 月相 + 行星逆行 + 星座特征 + 二十八宿特征。

**9. 铁板神数**：用于 lottery_easy_seed2.py、lottery_easy_BVAR.py。

**10. 九天玄数**：用于 lottery_easy_seed2.py、lottery_easy_BVAR.py。

**11. 北斗七星/七曜映射**：用于 lottery_easy_SR_2.py 跨彩种映射。方案A：北斗七星（贪狼/巨门/禄存/文曲/廉贞/武曲/破军）；方案B：七曜（日月+金木水火土）。

#### 六、数学方法

**1. 线性代数**：PCA 降维（explained_variance_ratio=0.95）、t-SNE 降维可视化、矩阵运算、特征值分解。

**2. 概率论**：泊松分布、条件概率、贝叶斯推断、后验分布采样、Bootstrap 不确定性量化、拉普拉斯平滑、Jeffreys 平滑。

**3. 统计学**：互信息、卡方检验、二项检验、Bonferroni 校正、FDR 检验、相关系数、标准差/方差/偏度/峰度、EWMA 指数加权移动平均、核密度估计、Holt-Winters 三次指数平滑、布林带。

**4. 时间序列分析**：ARIMA、季节性分解、向量自回归（VAR）、Prophet、傅里叶变换（FFT）、趋势/季节性分解、高阶马尔可夫链。

**5. 信息论**：互信息、KL 散度、交叉熵、MMD（最大均值差异, RBF核）、Sinkhorn 散度。

**6. 最优化**：NelderMead、BFGS、Adam/AdamW、L-BFGS-B、CosineAnnealingWarmRestarts、梯度裁剪、早停、学习率调度。

**7. 距离度量**：欧氏距离、曼哈顿距离、切比雪夫距离、余弦距离、马氏距离、Gower 距离、杰卡德距离、汉明距离、DTW 动态时间规整。

**8. 图像处理**：Lucas-Kanade 光流法（图像金字塔+迭代优化）、VET 变分回波跟踪（λ=100, α=0.5, γ=0.1）、双三次/双线性/Lanczos 插值。

**9. 组合数学**：初等对称多项式（精确组合概率计算）、组合 ID 映射（千万级连续 ID 空间）。

**10. 物理启发方法**（seed3 中 50 种）：布朗运动、热传导方程、弹簧振动方程、混沌理论（Logistic 映射）、量子波动模拟。

**11. 数论**：积年取模搜索、循环距离（环形取模空间）、模运算。

**12. 三角函数应用**（seed3 中 66 种）：sin/cos/tan × 各种乘数组合。

**13. 信号处理**：FFT 快速傅里叶变换（周期分析）、雷达图编码（号码↔图像双向转换）、极坐标映射。

## 彩票预测系统详细说明

### 1. lottery_easy_BVAR.py

#### 1.1 功能概述
基于贝叶斯向量自回归（BVAR）模型的彩票预测系统。融合大量玄学特征工程与机器学习方法，通过 MCMC 采样训练贝叶斯时序模型，遍历所有可能组合进行概率预测与不确定性量化。

#### 1.2 系统架构
- `LotteryConfig`：全局配置类（模型超参、特征开关、球号范围、生肖映射等）
- `DimensionalityReducer`：降维功能类（PCA/t-SNE，含模型保存/加载/可视化）
- 特征计算模块：梅花易数、大六壬/八字、奇门遁甲、紫微斗数、铁板神数、九天玄数、太乙神数、九宫六壬、周易八卦、五行、天文特征等
- `bvar_model`：Pyro 贝叶斯 VAR 模型定义
- `train_model` / `evaluate_model`：模型训练与评估
- `predict_next`：预测下一期（遍历组合 + 概率预测）
- `long_term_backtest`：长期回测分析
- `main_menu`：交互式命令行菜单

#### 1.3 预测原理
将每期开奖号码及其对应的农历日期转化为高维特征向量（含玄学特征 + 基础特征），构建贝叶斯向量自回归模型 `y_t = intercept + coef · X_{t-lag} + ε`。通过 NUTS/MCMC 采样获得参数后验分布。预测时遍历所有可能号码组合，计算每个组合的特征向量与预测特征的距离（马氏距离/概率密度），筛选特征最接近的组合，按概率排序输出 Top-K 候选。

#### 1.4 核心特性
- **海量玄学特征工程**：梅花易数（36 维）、奇门遁甲（29 维）、九宫六壬（21 维）、紫微斗数、铁板神数、太乙神数、天文特征等，可通过开关灵活组合
- **完整机器学习流水线**：特征有效性验证、特征选择（RFE/树模型/Lasso）、降维（PCA/t-SNE）、时间序列特征（趋势/季节性/傅里叶）
- **概率预测与不确定性量化**：基于后验分布输出置信区间和多候选组合
- **MPS 加速 + 长期回测**：支持 Apple MPS GPU 加速，含时间序列交叉验证与 Optuna 超参数优化

#### 1.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| mcmc_samples | 5760 (720×4×2) | MCMC 采样数 |
| warmup_steps | 1680 (210×4×2) | MCMC 预热步数 |
| target_accept | 0.85 | NUTS 目标接受率 |
| mps_max_tree_depth | 5 | MPS 设备下最大树深度 |
| cpu_max_tree_depth | 10 | CPU 设备下最大树深度 |
| lag_order | 1 | VAR 滞后阶数 |
| train_periods | 96 (12×4×2) | 训练集期数 |
| coef_prior_scale | 2.0 | 系数先验尺度 |
| intercept_prior_scale | 1.5 | 截距先验尺度 |
| sigma_prior_scale | 1.2 | 误差先验尺度 |
| num_generate_combos | 10000 | 生成组合数量 |
| top_k_combinations | 100 | 输出概率最高的前 K 组组合 |
| distance_method | 'mahalanobis' | 距离计算方法（euclidean/mahalanobis/probability_density） |
| explained_variance_ratio | 0.95 | PCA 保留方差比例 |
| n_components | 20 | 降维后特征数量 |
| max_features_to_select | 50 | 最多选择特征数量 |
| feature_selection_method | 'rfe' | 特征选择方法（rfe/tree/lasso） |
| cv_folds | 5 | 交叉验证折数 |
| backtest_periods | 50 | 回测期数 |
| enable_metaphysics | True | 玄学特征总开关 |

#### 1.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换模式 (SSQ/DLT/DF61) |
| 2 | 配置模型参数（滞后阶数、MCMC 样本数、预热步数、树深度、数据使用百分比、玄学特征开关等） |
| 3 | 加载数据并训练模型 |
| 5 | 长期回测分析 |
| 6 | 清除特征缓存 |
| 7 | 预测下一期 |
| 8 | 显示当前配置 |
| 0 | 退出 |

#### 1.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，Pyro（概率编程），lunar_python，skyfield，pandas，numpy
2. **安装步骤**：安装依赖库后直接运行 `python lottery_easy_BVAR.py`
3. **配置说明**：通过 `LotteryConfig` 类配置彩种、特征开关、模型超参等
4. **运行流程**：启动后进入交互式菜单，依次执行数据加载 → 特征计算 → 模型训练 → 预测/回测
5. **结果解读**：输出 Top-K 候选组合及其概率、置信度，含回测命中率统计

#### 1.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1，每周二/四/六开奖
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2，每周一/三/五开奖
- **东方 6+1（DF61）**：前 6 位数字 0-9 + 生肖转 1-12

#### 1.9 运行截图

![BVAR运行截图1](pic/lottery_easy_BVAR-1.png)
*图1：lottery_easy_BVAR 运行界面展示*

![BVAR运行截图2](pic/lottery_easy_BVAR-2.png)
*图2：lottery_easy_BVAR 预测结果展示*

![BVAR运行截图3](pic/lottery_easy_BVAR-3.png)
*图3：lottery_easy_BVAR 回测分析展示*

---

### 2. lottery_easy_Bazi.py

#### 2.1 功能概述
基于中国传统八字命理学的彩票号码推断程序。通过开奖时间的四柱八字分析五行喜忌，结合河洛数理将五行转换为数字，采用三级权重系统生成号码，并通过误差驱动学习机制持续优化模型。

#### 2.2 系统架构
- `Colors` 及打印工具：终端彩色输出
- `ModeConfig` / `SSQConfig` / `DLTConfig`：彩票模式配置类
- `BaZiNumberInferencer`：八字推断核心类（八字计算、五行分析、命宫命卦、号码生成、误差学习）
- `Application`：交互式命令行应用主类

#### 2.3 预测原理
推断流程为：开奖日期时间 → 八字四柱（年月日时） → 纳音五行 → 日主旺衰分析确定喜用神 → 河洛数理转换为数字 → 三级权重加权随机采样 → 最终号码。常规号码以喜用神河洛数字为核心权重，辅以天干地支数字、纳音数字、合化数字等；特殊号码以命宫命卦数字为核心权重。模型通过历史命中率误差驱动调整权重。

#### 2.4 核心特性
- **双模式支持**：SSQ/DLT 双配置，动态根据历史规则确定开奖时辰（SSQ 2010 年前 20:45/后 21:30；DLT 2023 年前 20:25/后 21:25）
- **三级权重系统**：喜用神数字(40%) + 历史高频(30%) + 冷门数字(30%)
- **丰富玄学元素**：纳音五行、天干合化、地支六合/三合/相冲/相害/相刑、十二长生旺衰、命宫命卦
- **误差驱动学习闭环**：加载历史数据 → 统计分析 → 命中率计算 → 模型参数调整 → 保存 JSON 模型

#### 2.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| LEARNING_RATE | 0.05 | 误差驱动学习率（建议范围 0.01~0.1，值越大调整越激进） |
| DEFAULT_RESULT_COUNT | 5 | 每次推断默认生成的号码组数 |
| max_history_records | 100 | 默认加载最近 100 期（0 表示全部加载） |
| 喜用神河洛数字权重 | 20.0 | 常规号码核心权重 |
| 河洛数理扩展权重 | 12.0 | 常规号码辅助权重（个位相同十位变化） |
| 河洛数理互补权重 | 10.0 | 常规号码辅助权重（1-6,2-7,3-8,4-9,5-10） |
| 四柱天干/地支数字权重 | 6.0 | 常规号码辅助权重 |
| 天干合化数字权重 | 5.0 | 常规号码辅助权重 |
| 地支六合数字权重 | 4.0 | 常规号码辅助权重 |
| 地支三合数字权重 | 3.5 | 常规号码辅助权重 |
| 纳音五行数字权重 | 3.0 | 常规号码辅助权重 |
| 地支相冲数字权重 | 2.0 | 冲克关系，权重较低 |
| 地支相害数字权重 | 1.5 | 害克关系，权重最低 |
| 常规号码候选池大小 | 12 | 只取权重最高的前 12 个数字作为候选池 |
| 命宫数字权重 | 12.0 | 特殊号码核心权重 |
| 命卦数字权重 | 12.0 | 特殊号码核心权重 |
| 命宫命卦融合数字权重 | 10.0 | 特殊号码核心权重（平均值） |
| 喜用神河洛数字权重（特殊） | 10.0 | 特殊号码核心权重 |
| 特殊号码候选池大小 | 10 | 只取权重最高的前 10 个数字作为候选池 |
| 命宫数三才法权重 | 0.4 | 天地人三才法（四柱天干地支之和取模） |
| 命宫数日主法权重 | 0.35 | 日主天干数 + 月令地支数 |
| 命宫数纳音法权重 | 0.25 | 四柱纳音五行河洛数之和 |
| 命卦数日时卦法权重 | 0.4 | 日柱地支+时柱地支对应八卦 |
| 命卦数年月卦法权重 | 0.3 | 年柱地支+月柱地支对应八卦 |
| 命卦数四柱综合法权重 | 0.3 | 四柱地支全部参与计算 |
| 日主旺衰比例阈值 | 0.3 | 日主力量占总力量 30% 以上即视为旺 |
| 命中率调整阈值 | 0.3 | 命中率低于 30% 才调整该八字组合权重 |
| 权重最小值 | 0.1 | 权重下限，避免归零 |
| 天干五行加成 | 1.0 | 每柱天干加 1.0 |
| 地支五行加成 | 1.5 | 地支力量更强，加 1.5 |
| 月令加成 | 0.5 | 地支为月令时额外加 0.5 |
| 纳音五行加成 | 0.5 | 每柱纳音加 0.5 |

#### 2.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换模式（SSQ/DLT） |
| 2 | 学习修正（读取历史数据，优化模型） |
| 3 | 输入时间推断（推断指定日期的数字） |
| 4 | 查看模型信息 |
| 0 | 退出 |

**子菜单 - 切换模式：**

| 选项号 | 描述 |
|--------|------|
| 1 | 双色球（SSQ）- 6 个常规数字(1-33) + 1 个特殊数字(1-16) |
| 2 | 大乐透（DLT）- 5 个常规数字(1-35) + 2 个特殊数字(1-12) |

**推断号码时的输入：**
- 公历日期（格式 YYYY-MM-DD，默认为今天）
- 推断结果组数（默认 5 组）

#### 2.7 使用方法
1. **环境要求**：Python 3.8+，lunar_python（农历计算），pandas
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Bazi.py`
3. **配置说明**：通过 `SSQConfig`/`DLTConfig` 配置号码范围与数据文件路径
4. **运行流程**：选择彩种 → 模型学习修正 → 号码推断 → 查看模型信息
5. **结果解读**：输出基于八字喜用神的推荐号码及权重分布

#### 2.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 2.9 运行截图

![Bazi运行截图1](pic/lottery_easy_Bazi-1.png)
*图1：lottery_easy_Bazi 运行界面展示*

---

### 3. lottery_easy_Gua.py

#### 3.1 功能概述
基于周易卦象的彩票预测系统。使用农历时间起卦法（梅花易数）生成卦象特征，通过组合式数学操作搜索算法，找出能够命中开奖数字的卦象数字变换公式，保存高命中率公式用于预测。

#### 3.2 系统架构
- `ColorPrinter`：彩色输出工具类
- `GuaConfig`：全局配置类（球位配置、搜索配置、公式生成器配置、统计检验配置）
- 卦象特征计算：`calculate_time_gua`（梅花易数起卦核心）、太乙神数、奇门遁甲、六壬等
- 公式系统：`FormulaSpec`（公式规范）、`compute_formula_raw/mapped`、`generate_formula_candidates`
- 公式评估与搜索：多种优化策略（基础/激进/模式/频率/条件概率/高阶马尔可夫/周期分析）
- `AdvancedVotingStrategy`：高级投票策略类（多样性选择、动态权重、多策略融合）
- `run_interactive_menu` / `main`：交互式菜单与程序入口

#### 3.3 预测原理
起卦阶段用农历年月日时按梅花易数法起卦，衍生出本卦、变卦、互卦及其先天数、后天数、五行、能量值、河图数等数十维特征。公式搜索阶段对卦象特征进行数学操作（加减乘、移位、取模等），遍历所有组合生成候选公式，在训练集上评估命中率，用二项检验 + Bonferroni 校正筛选统计显著公式。预测阶段通过高级投票策略融合多公式预测结果，结合周期分析（FFT）按球位独立输出预测号码。

#### 3.4 核心特性
- **球位独立预测**：按球位（如 ssq_red_1~6, ssq_blue_1）独立搜索公式和预测，每个球位有独立配置
- **海量公式搜索策略**：基础公式搜索、激进公式生成器、模式优化、频率优化、条件概率、高阶马尔可夫、周期分析（FFT 傅里叶变换）等
- **丰富卦象特征**：本卦/变卦/互卦的先天数、后天数、五行、能量值、河图数、纳甲法、六神、体用生克、卦象旺衰等
- **严格统计验证**：训练集/验证集分离、显著性水平 0.15、Bonferroni 校正、验证集命中率需达随机 N 倍

#### 3.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| significance_level | 0.15 | 显著性水平（p-value 阈值） |
| bonferroni_correction | True | 是否启用 Bonferroni 校正 |
| max_operations | 3 | 最大操作数量（公式组合复杂度） |
| train_periods | 153 | 训练集期数 |
| val_periods | 12 | 验证集期数 |
| top_n_results | 200 | 保存前 N 个最佳结果 |
| min_train_hit_rate | 0.03 | 训练集最低命中率门槛 |
| min_val_improvement | 1.0 | 验证集命中率至少是随机的 N 倍 |
| max_significant_formulas | 1000 | 训练集筛选后保留的最大显著公式数 |
| max_high_rate_formulas | 300 | 验证集筛选后保留的最大高命中率公式数 |
| similarity_top_n | 2 | 相似性预测查找距离最近的 N 期 |
| use_aggressive_formula_generator | False | 是否使用激进公式生成器 |
| use_range_size_only_mod | True | 只使用 range_size 作为模值 |

#### 3.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换彩种 (SSQ/DLT) |
| 2 | 搜索公式并预测下一期号码 |
| 6 | 测试单期卦象计算 |
| 7 | 寻找最优训练集/验证集配置 |
| 8 | 多参数组合联合搜索预测 |
| 9 | 相似性预测 |
| 10 | 特征组合回测 |
| 11 | 提取最近开奖数据八字 |
| 0 | 退出系统 |

#### 3.7 使用方法
1. **环境要求**：Python 3.8+，lunar_python，numpy，scipy（统计检验）
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Gua.py`
3. **配置说明**：通过 `GuaConfig` 配置球位范围、搜索策略、统计检验参数等
4. **运行流程**：选择彩种 → 公式搜索训练 → 验证集筛选 → 投票预测 → 回测
5. **结果解读**：输出各球位预测号码、公式命中率统计、投票得分

#### 3.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 3.9 运行截图

![Gua运行截图1](pic/lottery_easy_Gua-1.png)
*图1：lottery_easy_Gua 运行界面展示*

![Gua运行截图2](pic/lottery_easy_Gua-2.png)
*图2：lottery_easy_Gua 公式搜索展示*

![Gua运行截图3](pic/lottery_easy_Gua-3.png)
*图3：lottery_easy_Gua 预测结果展示*

---

### 4. lottery_easy_LM.py

#### 4.1 功能概述
模仿大语言模型（LLM）的核心思想，将彩票历史开奖数据视为一种"数字语言"进行建模与预测。把一期开奖号码类比为"句子"，最近 N 期历史作为"上下文 prompt"，预测下一期的号码概率分布。

#### 4.2 系统架构
- ColorPrint 彩色终端输出工具
- `Config` 全局超参数管理（彩种、数据模式、模型架构、训练、N/V/T 划分等）
- 数据加载与预处理（`load_lottery_data`、`build_dataset_self_history`、`build_dataset_cross_lottery`）
- 模型架构（`PositionalEncoding`、`LotteryTransformer`、`LotteryLSTM`、`LotteryMLP`、`create_model` 工厂）
- 损失函数（`FocalLoss`、标签平滑交叉熵）
- 训练引擎（`train_model`、`save_model`、`load_model`）
- 预测引擎（`predict`、`predict_next_period`、`display_prediction`）
- 回测评估引擎（`backtest`）

#### 4.3 预测原理
将连续 N 期开奖号码展平为"上下文序列"输入模型，模型输出各球位在数字范围内的概率分布（softmax），取 Top-1 作为推荐并辅以 Top-3 备选组合。训练时对每个球位独立计算分类损失并求平均，通过梯度下降拟合"上下文→下一期"的映射关系。

#### 4.4 核心特性
- **两种数据模式**：模式 1（同彩种最近 N 期历史预测下一期）、模式 2（跨彩种——用另一彩种前一期数据预测当期，二分查找日期对齐）
- **球级 Tokenization**：每个球号视为一个 token，配合球位类型嵌入，引入 BERT 风格 CLS token 汇聚全局信息
- **多种嵌入方式**：支持 Embedding 查表与 Linear 线性映射，支持正弦/可学习位置编码
- **N/V/T 数据集划分**：以验证集命中率为最佳模型选择标准，支持早停；自动检测 MPS/CUDA/CPU 加速

#### 4.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| d_model | 128 | Transformer 模型维度 |
| nhead | 4 | 多头注意力头数 |
| num_encoder_layers | 3 | Transformer 编码器层数 |
| dim_feedforward | 256 | 前馈网络维度 |
| dropout | 0.1 | Dropout 比例 |
| lstm_hidden_size | 128 | LSTM 隐藏层维度 |
| lstm_num_layers | 2 | LSTM 层数 |
| learning_rate | 0.001 | 学习率 |
| batch_size | 32 | 批大小 |
| epochs | 200 | 训练轮数 |
| history_periods | 3 | 历史期数 N（上下文长度） |
| total_data_periods | 1000 | 总数据量（训练+验证） |
| val_periods | 12 | 验证集期数 |
| early_stop_patience | 30 | 早停耐心值 |
| weight_decay | 1e-5 | 权重衰减 |
| label_smoothing | 0.1 | 标签平滑系数 |
| focal_gamma | 2.0 | Focal Loss 的 gamma 参数 |

#### 4.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 设置彩种模式 (SSQ/DLT) |
| 2 | 设置数据模式 |
| 3 | 设置模型架构 |
| 4 | 设置超参数 |
| 5 | 查看当前配置 |
| 6 | 回测评估 |
| 7 | 开始训练 |
| 8 | 预测下一期 |
| 0 | 退出系统 |

#### 4.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，pandas，numpy
2. **安装步骤**：安装依赖后运行 `python lottery_easy_LM.py`
3. **配置说明**：通过 `Config` 配置模型类型、数据模式、序列长度、N/V/T 划分等
4. **运行流程**：选择彩种与模型 → 构建数据集 → 训练 → 预测/回测
5. **结果解读**：输出各球位 Top-1 推荐及 Top-3 备选，含验证集命中率

#### 4.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 4.9 运行截图

![LM运行截图1](pic/lottery_easy_LM-1.png)
*图1：lottery_easy_LM 运行界面展示*

---

### 5. lottery_easy_Machine.py

#### 5.1 功能概述
基于历史统计特征的机器学习预测框架。采用"属性预测"模式——不直接预测号码，而是预测下一期号码的统计属性组合（奇偶比、大小比、012 路、区间分布、和值、AC 值等），再通过属性约束反推推荐号码。

#### 5.2 系统架构
- `ColorPrinter` 彩色输出工具
- `UncertaintyEstimator` / `PredictionWithUncertainty` 不确定性估计
- `LotteryConfig` 超参数管理
- `DataLoader` 数据加载与预处理
- `FeatureGenerator` 统计特征生成器（四大类特征）
- `LotteryDataset`（PyTorch Dataset）
- `BaseModel` 抽象基类 + 11 个具体模型类
- `NumberProbabilityCalculator` 号码概率计算
- `NumberInference` 属性反推号码
- `create_model` 模型工厂 + `main_menu` 交互式主菜单

#### 5.3 预测原理
模型输入为从历史数据计算出的统计特征向量，输出为下一期号码的多维属性值（回归任务，每个属性一个输出头）。预测时先用模型得到属性点估计与方差，经不确定性估计器转为属性概率分布，再由 `NumberInference` 依据属性约束筛选候选号码组合，最后用 `NumberProbabilityCalculator` 对组合打分排序输出推荐。

#### 5.4 核心特性
- **四大类统计特征体系**：①单期基础数值特征 ②频次与遗漏特征 ③走势与关联特征 ④空间与位置特征，严格防止数据泄露
- **11 种模型集成**：CatBoost、TCN、ResDNN、WideDeep、DeepAR、CVAE、TFT、NBEATS、NHiTS、GAT、VAEGAN
- **不确定性估计器**：基于正态分布将模型点估计转为概率分布，用误差函数计算离散属性取各值的概率
- **号码反推模块**：根据属性约束筛选候选并随机采样，生成单式、复式推荐及"最不推荐"低概率组合

#### 5.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| input_dim | 128 | 输入层维度 |
| hidden_dim | 256 | 隐藏层维度 |
| output_dim | 64 | 输出层维度 |
| num_layers | 4 | 网络层数 |
| dropout | 0.2 | Dropout 比例 |
| attention_heads | 4 | 注意力头数 |
| kernel_size | 3 | 卷积核大小（TCN） |
| dilation_base | 2 | 膨胀卷积基数（TCN） |
| history_window | 30 | 历史特征窗口大小 |
| batch_size | 32 | 批次大小 |
| epochs | 200 | 最大训练轮数 |
| learning_rate | 0.001 | 初始学习率 |
| early_stopping_patience | 20 | 早停耐心值 |
| gradient_clip | 1.0 | 梯度裁剪阈值 |
| ensemble_method | "voting" | 集成方法（voting/averaging） |
| num_predictions | 10 | 每次预测生成的号码组数 |

#### 5.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换模式（双色球/大乐透） |
| 2-4 | CatBoost 训练/预测/回测 |
| 5-7 | TCN 训练/预测/回测 |
| 8-10 | ResDNN 训练/预测/回测 |
| 11-13 | WideDeep 训练/预测/回测 |
| 14-16 | DeepAR 训练/预测/回测 |
| 17-19 | CVAE 训练/预测/回测 |
| 20-22 | TFT 训练/预测/回测 |
| 23-25 | NBEATS 训练/预测/回测 |
| 26-28 | NHiTS 训练/预测/回测 |
| 29-31 | GAT 训练/预测/回测 |
| 32-34 | VAEGAN 训练/预测/回测 |
| 35 | 训练所有模型 |
| 36 | 预测所有已训练模型 |
| 0 | 退出系统 |

#### 5.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，CatBoost，pandas，numpy
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Machine.py`
3. **配置说明**：通过 `LotteryConfig` 配置历史窗口、序列长度、模型类型、集成方法等
4. **运行流程**：选择彩种与模型 → 生成特征 → 训练 → 属性预测 → 号码反推
5. **结果解读**：输出单式/复式推荐号码、属性预测值、复式购买金额

#### 5.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 5.9 运行截图

![Machine运行截图1](pic/lottery_easy_Machine-1.png)
*图1：lottery_easy_Machine 运行界面展示*

![Machine运行截图2](pic/lottery_easy_Machine-2.png)
*图2：lottery_easy_Machine 预测结果展示*

---

### 6. lottery_easy_QiZheng.py

#### 6.1 功能概述
基于古代中国天文学"七政四余"（QiZheng SiYu）并结合现代深度学习（Transformer 与 GAN）的彩票预测系统。将开奖日期对应的天文星象特征作为输入，与号码序列特征深度融合进行预测。

#### 6.2 系统架构
- `ColorPrinter` 彩色输出
- `LotteryConfig` 超参数管理（天文特征开关、Transformer/GAN 配置、联合训练权重）
- `LotteryDataLoader` 数据加载与划分
- `QiZhengAstronomy` 七政四余天文特征计算模块
- Transformer 模型组件：`PositionalEncoding`、`CrossAttention`、`TransformerPredictor`
- GAN 模型组件：`SpectralNorm`、`ConditionalBatchNorm`、`SelfAttention`、`ImprovedGenerator`、`ImprovedDiscriminator`
- `LotteryLoss` / `FocalLoss` 损失函数
- `Trainer` 训练器 / `Predictor` 预测器（独立/联合）
- `QiZhengSystem` 系统管理类

#### 6.3 预测原理
核心假设是开奖号码与开奖时刻的天文星象存在关联。系统先根据每期开奖日期计算七政四余等天文特征向量，再与历史号码序列共同输入模型。Transformer 通过交叉注意力让号码特征查询天文特征学习关联；GAN 以天文特征为条件生成号码分布。联合训练时 Transformer 作教师蒸馏指导 GAN 学生，最终预测通过加权融合两模型输出得到推荐号码。

#### 6.4 核心特性
- **七政四余天文特征工程**：七政（日月金木水火土 7 颗实星）位置特征 + 四余（罗睺/计都/紫气/月孛虚星）+ 月相 + 行星逆行 + 星座特征 + 二十八宿特征，使用周期编码避免角度断裂
- **交叉注意力机制**：让号码序列特征主动"查询"天文特征，学习两者关联
- **GAN 改进**：条件批归一化让天文特征控制生成、谱归一化稳定训练、自注意力捕捉依赖、判别器多任务辅助
- **联合训练**：支持知识蒸馏、一致性约束、集成融合

#### 6.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| sequence_length | 16 | 输入序列长度 |
| transformer_d_model | 128 | Transformer 模型维度 |
| transformer_nhead | 8 | 注意力头数 |
| transformer_num_encoder_layers | 3 | 编码器层数 |
| transformer_dim_feedforward | 512 | 前馈网络维度 |
| gan_latent_dim | 100 | GAN 潜在空间维度 |
| gan_hidden_dim | 256 | GAN 隐藏层维度 |
| batch_size | 32 | 批次大小 |
| num_epochs | 100 | 训练轮数 |
| learning_rate | 3e-4 | 学习率 |
| joint_training_strategy | 'knowledge_distillation' | 联合训练策略 |
| distillation_temperature | 2.0 | 蒸馏温度 |
| teacher_weight | 0.7 | 教师模型权重 |
| student_weight | 0.3 | 学生模型权重 |
| fusion_alpha | 0.6 | Transformer 预测权重 |
| fusion_beta | 0.4 | GAN 预测权重 |
| astronomy_feature_dim | ~260 | 天文特征总维度（自动计算） |

#### 6.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择模式 (SSQ/DLT) |
| 2 | 加载数据 |
| 3 | 训练 Transformer 模型 |
| 4 | 训练 GAN 模型 |
| 5 | 独立训练全部模型 |
| 6 | 联合训练（知识蒸馏/一致性/集成） |
| 7 | Transformer 预测 |
| 8 | GAN 预测 |
| 9 | 独立模型预测（全部） |
| 10 | 联合模型预测 |
| 11 | 评估 Transformer |
| 12 | 评估 GAN |
| 13 | 评估独立模型（全部） |
| 14 | 评估联合模型 |
| 0 | 退出 |

#### 6.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，swisseph（天文计算），pandas，numpy
2. **安装步骤**：安装依赖后运行 `python lottery_easy_QiZheng.py`
3. **配置说明**：通过 `LotteryConfig` 配置天文特征开关、模型参数、联合训练权重等
4. **运行流程**：选择彩种 → 天文特征计算 → Transformer/GAN 训练 → 联合预测
5. **结果解读**：输出融合预测号码及各模型独立预测对比

#### 6.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 6.9 运行截图

![QiZheng运行截图1](pic/lottery_easy_QiZheng-1.png)
*图1：lottery_easy_QiZheng 运行界面展示*

---

### 7. lottery_easy_Quantum.py

#### 7.1 功能概述
基于技术报告《量子力学框架下的双色球预测系统设计》完整实现的量子力学框架彩票预测系统。用量子态编码、波函数概率诠释、量子纠缠、量子行走等量子力学概念建模彩票开奖分布。

#### 7.2 系统架构
- `Color` 彩色输出工具
- `get_default_config` 超参数配置系统（QCBM/QRNN/Qopula/transition 等分模块配置）
- 设备管理与数据加载
- `StatisticalAnalyzer` 统计分析器
- `QuantumEncoder` 量子态编码模块
- QCBM 核心模块（`QuantumRotationLayer`、`QuantumEntanglementLayer`、`QCBM`）
- `QuantumLossFunctions` 损失函数集合（MMD/Sinkhorn/KL）
- QRNN（`QuantumGRUCell`、`QRNNModel`）
- `QopulaModel` 量子 Copula 模型
- `TransitionPredictor` 转移概率矩阵预测器
- `QuantumLotterySystem` 主系统类

#### 7.3 预测原理
系统将历史开奖频率分布作为 QCBM 的训练目标，通过参数化量子电路（旋转层 + 纠缠层）演化初始量子态，由 Born 规则 |⟨x|Ψ⟩|² 得到数字概率分布；QRNN 用量子增强 GRU 建模序列时序依赖；转移矩阵预测器融合经典马尔可夫、二阶马尔可夫与 Szegedy 量子行走三种信号。预测时各模型分别生成大量候选组合，用对数概率查表评分，去重排序输出 Top-N 推荐。

#### 7.4 核心特性
- **三种量子态编码方案**：direct（直接 one-hot）/ combinatorial（组合压缩编码）/ hybrid（混合分区编码）
- **量子门正确实现**：Ry 旋转门、Rz 相位旋转、参数化 CNOT 门（strength 控制纠缠强度）、Grover 扩散反射算子
- **5 步 Szegedy 量子行走**：+ Hadamard-like 相位干涉增强，捕捉高阶关联；近期加权（decay=0.85）+ 反重复衰减
- **多模型集成预测**：QCBM + QRNN + Transition + Qopula 生成候选，对数概率评分去重，输出 Top-50 推荐

#### 7.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| encoding_method | 'direct' | 量子态编码方案（direct/combinatorial/hybrid） |
| qcbm.n_layers | 4 | 量子电路层数 |
| qcbm.entanglement_mode | 'circular' | 纠缠模式（linear/circular/full/block） |
| qcbm.rotation_type | 'xyz' | 旋转门分解（Z-Y-Z/X-Y/仅Z） |
| qrnn.hidden_dim | 128 | GRU 隐藏层维度 |
| qrnn.n_rnn_layers | 2 | GRU 堆叠层数 |
| qrnn.history_window | 5 | 历史窗口大小 |
| training.epochs | 200 | 最大训练轮数 |
| training.learning_rate | 0.005 | 初始学习率 |
| training.early_stop_patience | 20 | 早停耐心值 |
| mmd.sigma | [1.0, 2.0, 5.0, 10.0] | RBF 核多尺度带宽 |
| prediction.n_recommendations | 50 | 最终推荐注数 |
| prediction.weights | qcbm=0.3, qrnn=0.3, transition=0.2, qopula=0.2 | 各模型评分权重 |
| backtest.n_periods | 100 | 回测期数 |

#### 7.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换模式 (SSQ/DLT) |
| 2 | 加载数据 & 统计分析 |
| 3 | 训练量子模型 |
| 4 | 预测下一期 |
| 5 | 回测评估 |
| 6 | 查看当前配置 |
| 0 | 退出 |

#### 7.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，numpy
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Quantum.py`
3. **配置说明**：通过 `get_default_config` 配置各量子模型参数、编码方案、训练轮次等
4. **运行流程**：选择彩种 → 统计分析 → 量子模型训练 → 集成预测 → 回测
5. **结果解读**：输出 Top-50 推荐组合及多区间数字频次统计表

#### 7.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 7.9 运行截图

![Quantum运行截图1](pic/lottery_easy_Quantum-1.png)
*图1：lottery_easy_Quantum 运行界面展示*

---

### 8. lottery_easy_SR.py

#### 8.1 功能概述
基于 PySR（Python Symbolic Regression）符号回归引擎，从农历天干地支、天文、六壬、梅花易数、64 卦等多种玄学特征中，自动搜索出映射到彩票开奖号码的数学表达式公式，并支持多轮训练与预测。

#### 8.2 系统架构
- `LotteryConfig`：统一超参数管理（损失函数、运算符、种群、训练轮次等）
- 数据加载模块（`load_lottery_data`）
- 特征工程模块（10 类特征提取，可组合）
- 训练数据准备（`prepare_training_data`）
- PySR 训练/预测模块
- `main_menu`：交互式命令行菜单

#### 8.3 预测原理
将开奖时间的农历八字、天文位置、六壬/梅花易数等玄学特征作为输入 X，开奖号码作为输出 Y，利用 PySR 符号回归在数学算子空间中进化搜索，自动发现 X→Y 的显式数学公式。通过命中率过滤保留高准确率方程式，多轮训练累积公式库，预测时代入下一期特征得到号码。

#### 8.4 核心特性
- **多源特征融合**：支持 10 类可开关特征（历史数据、农历天干地支、天文、九宫六壬、梅花易数、农历梅花易数、64 卦、玄学、另一彩种、时间卦）
- **统一球位模式**：将所有球位组合为 14 位整数/小数，单方程预测全部号码
- **组合 ID 模式**：将号码组合映射到连续 ID 空间（千万级），便于符号回归发现规律
- **多轮训练机制**：支持最多 1000 轮迭代训练，含命中率过滤、多种自定义损失函数（unified_ball_hit、distance_weighted_hit、probability_hit、huber 等）

#### 8.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| pysr_niterations | 99999 | PySR 迭代次数 |
| pysr_maxsize | 128 | 最大表达式大小 |
| pysr_population_size | 49 | 种群大小 |
| pysr_populations | 49 | 种群数量 |
| pysr_ncycles_per_iteration | 300 | 每次迭代周期数 |
| pysr_binary_operators | ["+","-","*","^","mod"] | 二元运算符 |
| pysr_unary_operators | ["sin","cos","tan","tanh","abs"] | 一元运算符 |
| pysr_maxdepth | 15 | 最大表达式深度 |
| pysr_loss_type | 'unified_ball_hit' | 损失函数类型 |
| pysr_optimizer | 'NelderMead' | PySR 优化器 |
| multiple_training_rounds | 1000 | 多次训练轮次 |
| train_data_size | 96 | 训练数据量 |
| combination_id_mode | True | 是否启用组合 ID 模式 |
| enable_unified_ball_mode | False | 是否启用统一球位模式 |
| save_high_hit_rate_threshold | 0.5 | 高命中率方程式保存阈值 |

#### 8.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换模式 (SSQ/DLT/DF61) |
| 2 | 显示当前配置 |
| 3 | 加载数据并训练模型 |
| 6 | 特征配置（10类特征开关） |
| 7 | 预测下一期 |
| 8 | 加载数据并训练模型（统一球位模式） |
| 9 | 预测下一期（统一球位模式） |
| 0 | 退出 |

#### 8.7 使用方法
1. **环境要求**：Python 3.8+，PySR（需 Julia 后端），PyTorch，lunar_python，pandas
2. **安装步骤**：先安装 Julia，再安装 PySR，运行 `python lottery_easy_SR.py`
3. **配置说明**：通过 `LotteryConfig` 配置特征开关、运算符、损失函数、训练轮次等
4. **运行流程**：选择彩种 → 配置特征 → 多轮训练 → 公式筛选 → 预测
5. **结果解读**：输出符号回归公式、命中率统计、预测号码

#### 8.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2
- **东方 6+1（DF61）**

#### 8.9 运行截图

![SR运行截图1](pic/lottery_easy_SR-1.png)
*图1：lottery_easy_SR 运行界面展示*

![SR运行截图2](pic/lottery_easy_SR-2.png)
*图2：lottery_easy_SR 公式训练展示*

---

### 9. lottery_easy_SR_2.py

#### 9.1 功能概述
SR.py 的重构精简版本，采用模块化设计，以八字（四柱）特征和历史号码为核心，结合跨彩种玄学映射（北斗七星/七曜），用 PySR 搜索预测公式。

#### 9.2 系统架构
1. 系统配置模块（`lottery_config` 字典 + 跨彩种映射表）
2. 历史数据处理模块（`load_lottery_data`、`get_bazi_codes`、`get_full_bazi_codes`）
3. 特征工程模块（7 种 x_method 构造方法）
4. 模型训练模块（`train_all_balls`、`multi_round_train`）
5. 预测模块（`predict_next_period`、`multi_round_predict`）
6. 交互菜单模块（`main`）

#### 9.3 预测原理
根据开奖日期和彩种还原精确开奖时辰，计算八字四柱（年/月/日/时柱天干地支编码），结合历史 N 期号码作为输入特征。跨彩种映射方案基于北斗七星/七曜的对称关系，将当前彩种球位映射到另一彩种球位获取辅助特征。PySR 在加减乘、mod、sin/cos、分段函数等算子空间搜索 X→Y 公式，按验证集命中率筛选保存最佳公式，预测时多公式投票得出号码。

#### 9.4 核心特性
- **7 种 X 数据构造方法**（x_method 1-7）：八字日时柱、八字四柱合值、历史 N 期号码+差分趋势、八字完整四柱、历史 N 期+移动平均、跨彩种 1 期映射、跨彩种 1 期映射+差分
- **跨彩种玄学映射**：方案 A 北斗七星映射（贪狼/巨门/禄存/文曲/廉贞/武曲/破军）、方案 B 七曜映射（日月+金木水火土）
- **精确开奖时辰还原**：根据 SSQ/DLT 历史开奖时间变迁（2003-2023）自动确定八字时柱
- **公式保存双模式**：正向选择（保存高命中率公式）与反向排除（保存命中率为 0 的公式做反向指标）

#### 9.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| x_method | 7 | x 数据构造方法编号（1-7） |
| history_n | 7 | 历史 N 期数据 |
| cross_mapping_scheme | "A" | 跨彩种映射方案（A=北斗七星/B=七曜） |
| maxsize | 77 | 公式最大复杂度 |
| niterations | 2401 | PySR 迭代次数 |
| populations | 14 | 种群数量 |
| population_size | 49 | 每个种群的大小 |
| ncyclesperiteration | 343 | 每轮内部变异轮次 |
| train_periods | 49 | 训练集期数 |
| recent_periods | 7 | 验证集期数 |
| save_top_n | 7 | 保存前 N 个最佳公式 |
| min_save_hit_rate | 0.4 | 最小验证集命中率阈值 |
| binary_operators | ["+","-","*","myifgt","myiflt","mod"] | 二元运算符 |
| unary_operators | ["sin","cos","abs"] | 一元运算符 |
| elementwise_loss | "L1DistLoss()" | L1 损失 |

#### 9.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 修改彩票模式 (ssq/dlt) |
| 2 | 修改特征方法 |
| 3 | 修改训练参数 |
| 4 | 搜寻最佳 x 数据构造器 |
| 5 | 搜寻报告（仅报告，不训练） |
| 6 | 多轮训练 |
| 7 | 多轮预测下一期号码 |
| 8 | 单轮训练（所有球位） |
| 9 | 单轮预测下一期号码 |
| 10 | 加载并查看数据 |
| 11 | 查看已保存的模型 |
| 48 | 搜寻最佳模型组合 |
| 49 | 使用最佳组合预测下一期 |
| 0 | 退出 |

#### 9.7 使用方法
1. **环境要求**：Python 3.8+，PySR（需 Julia 后端），lunar_python，pandas
2. **安装步骤**：先安装 Julia 与 PySR，运行 `python lottery_easy_SR_2.py`
3. **配置说明**：通过 `lottery_config` 配置 x_method、跨彩种映射方案、训练轮次等
4. **运行流程**：选择彩种与 x_method → 多轮训练 → 公式筛选 → 预测
5. **结果解读**：输出预测号码、公式命中率、验证集表现

#### 9.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 9.9 运行截图

![SR_2运行截图1](pic/lottery_easy_SR_2-1.png)
*图1：lottery_easy_SR_2 运行界面展示*

![SR_2运行截图2](pic/lottery_easy_SR_2-2.png)
*图2：lottery_easy_SR_2 预测结果展示*

---

### 10. lottery_easy_Taiyi_GNN.py

#### 10.1 功能概述
将太乙神数盘面建模为"图"结构，用图注意力网络（GAT）学习九宫格宫位之间的空间关系，预测彩票红蓝球号码。

#### 10.2 系统架构
- `LotteryConfig`：超参数管理（GNN 层数、隐藏维度、注意力头数、图结构类型）
- `TaiyiFeatureExtractor`：89 维太乙神数特征提取
- `TaiyiGraph`：图数据结构构建（9 节点图）
- `TaiyiGNN`：图神经网络模型（节点编码器 → GAT 层 × N → 全局池化 → FC → 红蓝球输出头）
- `TaiyiSemanticEncoder`：语义编码器
- 辅助模型：`ConditionalGNN`、`SemanticMLP`、`SemanticTransformer`
- `main_menu`：4 模型训练/预测/回测菜单

#### 10.3 预测原理
从开奖时间排太乙神数盘，提取 89 维特征。将盘面按洛书九宫构建为 9 节点图：每个宫位节点包含该宫的旺衰/八门/神煞等特征，宫位间按空间关系（相邻 + 对宫）连边。GAT 层让信息在相邻宫之间传播并学习宫位间地理关系，全局池化聚合所有宫信息，结合全局特征通过 FC 层预测红蓝球出现概率。

#### 10.4 核心特性
- **图结构建模创新**：将太乙盘面建模为洛书九宫格图（巽四/离九/坤二/震三/中五/兑七/艮八/坎一/乾六），相邻宫与对宫连边
- **分类特征正确处理**：55 个分类特征通过 one-hot/二值编码，避免连续数值的误导
- **4 种模型对比**：TaiyiGNN（图网络）、ConditionalGNN（条件图网络）、SemanticMLP（语义 MLP）、SemanticTransformer（语义 Transformer）
- **GAT 注意力机制**：自动学习宫位间重要程度，信息在相邻宫间传播

#### 10.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| gnn_num_layers | 2 | GNN 层数 |
| gnn_hidden_dim | 128 | GNN 隐藏维度 |
| gnn_num_heads | 4 | GNN 注意力头数 |
| gnn_dropout | 0.3 | GNN dropout 率 |
| gnn_graph_type | 'luoshu_opposite' | 图结构类型（full/luoshu/luoshu_opposite） |
| gnn_global_dim | 128 | 全局特征编码维度 |
| taiyi_ji_style | 4 | 太乙计法（0年/1月/2日/3时/4分计） |
| taiyi_method | 1 | 太乙公式（0统宗/1金镜/2淘金歌/3太乙局） |
| taiyi_simple_mode | False | False=完整89维/True=简化15维 |
| batch_size | 64 | 批次大小 |
| num_epochs | 150 | 训练轮数 |
| learning_rate | 0.001 | 学习率 |
| early_stopping_patience | 30 | 早停耐心值 |
| train_ratio | 0.95 | 训练集比例 |
| backtest_periods | 100 | 回测期数 |

#### 10.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择彩种模式 |
| 2 | GNN 训练 |
| 3 | GNN 预测 |
| 4 | GNN 回测 |
| 5 | 条件 GNN 训练 |
| 6 | 条件 GNN 预测 |
| 7 | 条件 GNN 回测 |
| 8 | 语义 MLP 训练 |
| 9 | 语义 MLP 预测 |
| 10 | 语义 MLP 回测 |
| 11 | 语义 Transformer 训练 |
| 12 | 语义 Transformer 预测 |
| 13 | 语义 Transformer 回测 |
| 14 | 全部训练并回测对比 |
| 0 | 退出 |

#### 10.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，torch_geometric，kintaiyi 模块
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Taiyi_GNN.py`
3. **配置说明**：通过 `LotteryConfig` 配置 GNN 层数、隐藏维度、注意力头数等
4. **运行流程**：选择彩种与模型 → 太乙特征提取 → 图构建 → 训练 → 预测/回测
5. **结果解读**：输出各模型预测号码及命中率对比

#### 10.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 10.9 运行截图

![Taiyi_GNN运行截图1](pic/lottery_easy_Taiyi_GNN-1.png)
*图1：lottery_easy_Taiyi_GNN 运行界面展示*

---

### 11. lottery_easy_Taiyi_Machine.py

#### 11.1 功能概述
基于太乙神数 87 维特征值的综合机器学习/深度学习彩票预测系统，集成 20+ 种预测模型，是本集合中模型最丰富、功能最全面的系统。

#### 11.2 系统架构
- `LotteryConfig`：统一超参数管理（各模型参数、太乙配置、取模值、特征归一化）
- 积年取模搜索模块（`_search_optimal_modulus`、`menu_search_modulus`）
- `TaiyiFeatureExtractor`：87 维太乙特征提取
- `LotteryDataset`：数据集封装
- 模型类：`AttentionBallModel`、`ConditionalVAE`、`AutoregressiveGenerator`、`MLPNet`、`DNNNet`（含 `ResidualBlock`）、`LotteryTransformer`
- 相似性/距离验证模块
- `main_menu`：54+ 选项的交互式菜单

#### 11.3 预测原理
从开奖时间排太乙神数盘提取 87 维特征。监督模型（CatBoost/MLP/DNN/Transformer）直接学习特征→号码的映射；相似性模型在历史期中寻找太乙特征最接近的 N 期，用其开奖号码投票预测；符号回归用相似期号码+距离作为输入搜索数学变换公式；生成模型（VAE/自回归）学习号码分布生成新组合；积年取模搜索通过周期性取模找到历史相似期。各模型可独立训练/预测/回测对比。

#### 11.4 核心特性
- **模型种类最全**：涵盖监督学习、关联规则、相似性检索、生成模型、符号回归 5 大类共 20+ 种模型，菜单含 54+ 选项
- **87 维太乙特征**：完整太乙神数特征体系（局式、位置、算数、神煞、八门、八宫旺衰、推断法等），支持语义感知归一化
- **积年取模搜索**：独创的积年取模值搜索功能，遍历取模数寻找最优周期（太乙大年周期 25920/十年大运 43200），支持多取模值加权投票
- **特征分组 Transformer**：将 87 维特征按语义分为 18 组，每组作为 token 送入 Transformer 学习组间关系

#### 11.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| taiyi_ji_style | 3 | 太乙计法（0年/1月/2日/3时/4分计） |
| taiyi_method | 1 | 太乙公式（0统宗/1金镜/2淘金歌/3太乙局） |
| taiyi_simple_mode | False | False=完整87维/True=简化15维 |
| taiyi_cyclic_distance | True | 是否使用循环距离 |
| feature_normalization | 'semantic' | 特征归一化方法 |
| catboost_iterations | 1000 | CatBoost 迭代次数 |
| catboost_learning_rate | 0.05 | CatBoost 学习率 |
| catboost_depth | 6 | CatBoost 树深度 |
| transformer_d_model | 64 | Transformer 模型维度 |
| transformer_nhead | 4 | Transformer 注意力头数 |
| transformer_num_layers | 4 | Transformer 层数 |
| arm_min_support | 0.005 | ARM 最小支持度 |
| arm_min_confidence | 0.15 | ARM 最小置信度 |
| pysr_niterations | 3600 | PySR 迭代次数 |
| pysr_maxsize | 36 | PySR 公式最大复杂度 |
| similarity_top_n | 5 | 预测时查找最近邻期数 |
| batch_size | 64 | 批次大小 |
| num_epochs | 200 | 训练轮数 |
| learning_rate | 0.001 | 学习率 |

#### 11.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择彩种模式（SSQ/DLT/7XC/3D） |
| 2-4 | CatBoost 训练/预测/回测 |
| 5-7 | ARM 关联规则 训练/预测/回测 |
| 8-10 | MLP 训练/预测/回测 |
| 11-13 | DNN 训练/预测/回测 |
| 14-16 | Transformer 训练/预测/回测 |
| 17-18 | 欧氏距离 预测/回测 |
| 19-20 | 余弦距离 预测/回测 |
| 21-22 | Gower 距离 预测/回测 |
| 23-24 | 特征分组距离 预测/回测 |
| 25-26 | 模式匹配 预测/回测 |
| 27-28 | 太乙特征距离 预测/回测 |
| 29-31 | 符号回归 训练/预测/回测 |
| 32-33 | 批量符号回归 联合训练/预测 |
| 34-35 | 注意力相似性 预测/回测 |
| 36-38 | 注意力 MLP 训练/预测/回测 |
| 39-41 | 差值预测 训练/预测/回测 |
| 42-43 | K 近邻智能加权 预测/回测 |
| 44-46 | 自回归生成 训练/预测/回测 |
| 47-48 | 批量自回归 联合训练/预测 |
| 49-51 | 条件 VAE 训练/预测/回测 |
| 52 | 积年取模值搜索 |
| 53-54 | 积年符号回归 训练/预测 |
| 55-56 | 距离-号码相似性 手动/自动分析 |
| 0 | 退出 |

#### 11.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，CatBoost，PySR，kintaiyi 模块，pandas
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Taiyi_Machine.py`
3. **配置说明**：通过 `LotteryConfig` 配置各模型参数、太乙特征、取模值等
4. **运行流程**：选择彩种 → 太乙特征提取 → 选择模型训练 → 预测/回测/对比
5. **结果解读**：输出各模型预测号码、命中率对比、积年取模分析

#### 11.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2
- **七乐彩（7XC）**
- **福彩 3D**

#### 11.9 运行截图

![Taiyi_Machine运行截图1](pic/lottery_easy_Taiyi_Machine-1.png)
*图1：lottery_easy_Taiyi_Machine 运行界面展示*

![Taiyi_Machine运行截图2](pic/lottery_easy_Taiyi_Machine-2.png)
*图2：lottery_easy_Taiyi_Machine 模型训练展示*

![Taiyi_Machine运行截图3](pic/lottery_easy_Taiyi_Machine-3.png)
*图3：lottery_easy_Taiyi_Machine 预测结果展示*

![Taiyi_Machine运行截图4](pic/lottery_easy_Taiyi_Machine-4.png)
*图4：lottery_easy_Taiyi_Machine 积年取模搜索展示*

---

### 12. lottery_easy_VAE_GAN.py

#### 12.1 功能概述
基于 VAE-GAN-Transformer 三模型融合架构的彩票预测系统。VAE 学习号码分布的潜在表示，GAN 生成符合真实分布的新样本，Transformer 捕捉期号间的长短期时序依赖，最终通过融合网络整合输出。

#### 12.2 系统架构
- `LotteryConfig`：全局配置（VAE/GAN/Transformer/融合/训练/评估参数）
- `VAE`、`Generator`、`Discriminator`、`GAN`：生成模型模块
- `PositionalEncoding`、`TransformerModel`、`LotteryTransformer`：时序模型模块
- `ModelFusion`：融合策略模块（concat / attention / weighted / meta_learner）
- `LotteryPredictionSystem`：主系统类
- `ModelEvaluator`：评估模块

#### 12.3 预测原理
通过滑动窗口构建历史序列特征（含归一化号码与玄学特征），分别训练 VAE（学习号码分布的潜在表示）、GAN（生成符合真实分布的新样本）、Transformer（捕捉期号间的长短期时序依赖），再由 `ModelFusion` 按注意力或元学习器策略整合三模型输出，输出下一期号码预测。

#### 12.4 核心特性
- **三模型融合架构**：VAE 学习分布 + GAN 生成样本 + Transformer 捕捉时序，最终通过融合网络整合
- **四种融合策略**：concat（拼接）、attention（注意力）、weighted（加权）、meta_learner（元学习器）
- **玄学特征开关**：支持梅花易数、九宫六壬、八字等特征开关
- **MPS 加速**：支持 Apple Silicon MPS / CUDA GPU 加速，含早停、梯度裁剪、特征缓存

#### 12.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| vae_hidden_dims | [256, 128, 64] | VAE 隐藏层维度 |
| vae_latent_dim | 32 | VAE 潜在空间维度 |
| vae_learning_rate | 0.001 | VAE 学习率 |
| vae_epochs | 100 | VAE 训练轮数 |
| gan_latent_dim | 64 | GAN 潜在空间维度 |
| gan_learning_rate | 0.0002 | GAN 学习率 |
| gan_epochs | 200 | GAN 训练轮数 |
| gan_lambda_gp | 10 | WGAN-GP 梯度惩罚系数 |
| transformer_model_dim | 256 | Transformer 模型维度 |
| transformer_num_heads | 8 | Transformer 注意力头数 |
| transformer_num_layers | 6 | Transformer 层数 |
| transformer_epochs | 150 | Transformer 训练轮数 |
| fusion_method | 'attention' | 融合方法（concat/attention/weighted/meta_learner） |
| batch_size | 32 | 批次大小 |
| history_length | 10 | 历史数据长度 |
| sequence_length | 20 | 序列长度 |
| early_stopping_patience | 20 | 早停耐心值 |

#### 12.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换模式（SSQ/DLT/DF61） |
| 2 | 训练模型（自动加载历史数据） |
| 3 | 预测下一期（自动加载模型和数据） |
| 4 | 模型评估 |
| 5 | 查看训练历史 |
| 6 | 生成评估报告 |
| 0 | 退出 |

#### 12.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，pandas，numpy
2. **安装步骤**：安装依赖后运行 `python lottery_easy_VAE_GAN.py`
3. **配置说明**：通过 `LotteryConfig` 配置 VAE/GAN/Transformer 参数、融合策略、玄学特征开关
4. **运行流程**：选择彩种 → 特征提取 → 三模型训练 → 融合预测
5. **结果解读**：输出融合预测号码及各子模型独立预测

#### 12.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 12.9 运行截图

![VAE_GAN运行截图1](pic/lottery_easy_VAE_GAN-1.png)
*图1：lottery_easy_VAE_GAN 运行界面展示*

---

### 13. lottery_easy_baseline.py

#### 13.1 功能概述
大六壬-号码统计映射系统，包含两套预测方法：基于统计学习的 Baseline 模型（互信息/朴素贝叶斯/卡方/条件概率表）+ 基于机器学习的 ML 模型（CatBoost/XGBoost/DNN）。

#### 13.2 系统架构
- `LotteryConfig` 配置
- 特征提取：大六壬/紫微/奇门/天气/历史号码等多组提取器
- `DataLoader`（Baseline）/ `MLDataLoader`（ML）
- Baseline 模型：`MIModel`/`NBModel`/`CHIModel`/`CPTModel`/`ARMRuleModel`
- ML 模型：`BaseMLModel` 及 CatBoost/XGBoost/MLP/DNN 子类
- `MLPredictionEngine`、`MLEvaluator`
- `SimpleSimilarityModel` 相似性模型
- `main_menu` 主菜单

#### 13.3 预测原理
核心假设：某一天的大六壬（及紫微、奇门等）数值与当天开奖号码存在隐藏映射关系。Baseline 通过统计历史数据中"特征→号码"的出现频率构建条件概率表直接预测；ML 模型复用相同特征，为每个球位独立训练 CatBoost/XGBoost/DNN 等模型进行预测。

#### 13.4 核心特性
- **双预测体系**：统计映射 Baseline（条件概率表）+ ML 机器学习（每球位独立训练分类/回归模型）
- **丰富玄学特征提取器**：大六壬（`LiurenFeatureExtractor`/`KinLiurenFeatureExtractor`）、紫微斗数、奇门遁甲、天气、历史号码等
- **ML 模型复用 Baseline 特征**：保证特征一致性
- **特征重要性分析**：`FeatureImportanceAnalyzer` 分析各特征对预测的贡献

#### 13.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| data_usage_count | 3500 | 使用最新 N 条数据 |
| backtest_periods | 100 | 回测期数 |
| catboost_iterations | 1000 | CatBoost 迭代次数 |
| catboost_learning_rate | 0.1 | CatBoost 学习率 |
| catboost_depth | 6 | CatBoost 树深度 |
| xgboost_max_depth | 6 | XGBoost 树最大深度 |
| xgboost_n_estimators | 200 | XGBoost 树数量 |
| mi_threshold | 0.01 | 互信息阈值 |
| chi_threshold | 3.84 | 卡方值阈值（p=0.05） |
| arm_min_support | 0.02 | ARM 最小支持度 |
| simple_similarity_top_n | 100 | 取最相似的 Top N 期 |
| ml_test_size | 0.05 | 测试集比例 |
| ml_window_sizes | [5, 10, 20, 50] | 滑动窗口大小列表 |

#### 13.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择 Lottery 模式（SSQ/DLT/DF61） |
| 2 | 设置参数 |
| 7-9 | CatBoost 训练/预测/回测 |
| 10-12 | XGBoost 训练/预测/回测 |
| 13-15 | MLP 训练/预测/回测 |
| 16-18 | DNN 训练/预测/回测 |
| 19-21 | 互信息(MI) 训练/预测/回测 |
| 22-24 | 朴素贝叶斯(NB) 训练/预测/回测 |
| 25-27 | 卡方检验(CHI) 训练/预测/回测 |
| 28-30 | 条件概率表(CPT) 训练/预测/回测 |
| 31-33 | 关联规则(ARM) 训练/预测/回测 |
| 34-35 | Kin 六壬 预测/回测 |
| 36-37 | 紫微五行 预测/回测 |
| 38-39 | 紫微斗数 预测/回测 |
| 40-41 | 奇门遁甲 预测/回测 |
| 42-43 | 历史统计 预测/回测 |
| 0 | 退出 |

#### 13.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，CatBoost，XGBoost，lunar_python，pandas
2. **安装步骤**：安装依赖后运行 `python lottery_easy_baseline.py`
3. **配置说明**：通过 `LotteryConfig` 配置彩种、特征提取器、模型类型等
4. **运行流程**：选择彩种 → 特征提取 → Baseline/ML 训练 → 预测/回测
5. **结果解读**：输出各球位预测号码、特征重要性、命中率统计

#### 13.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2
- **东方 6+1（DF61）**

#### 13.9 运行截图

![baseline运行截图1](pic/lottery_easy_baseline-1.png)
*图1：lottery_easy_baseline 运行界面展示*

![baseline运行截图2](pic/lottery_easy_baseline-2.png)
*图2：lottery_easy_baseline 预测结果展示*

![baseline运行截图3](pic/lottery_easy_baseline-3.png)
*图3：lottery_easy_baseline 特征分析展示*

---

### 14. lottery_easy_Emulator.py

#### 14.1 功能概述
基于"冷门号码理论"的彩民投注模拟器。核心假设是：开奖号码是彩民投注最少的号码（被 3-10 人购买）。通过模拟彩民投注行为训练模型，找到"冷门号码"来预测开奖结果。

#### 14.2 系统架构
- `Color` 及输出工具：终端彩色输出、进度条
- `LotteryConfig`：统一超参数管理（彩种参数、训练参数、彩民行为参数、模型保存/加载）
- `LotteryDraw`：单期开奖记录数据结构
- 数据加载与趋势分析：`load_history_data`、`compute_frequency_stats`、`compute_trend_weights`
- 彩民投注模拟：`simulate_one_period`（numpy 向量化批量生成）
- 解析评估：`_build_number_probability_table`、`_elementary_symmetric_polynomial`、`analytical_evaluate`
- `train_model` / `predict_next_period` / `backtest`：训练、预测、回测
- `main_menu`：交互式菜单

#### 14.3 预测原理
训练阶段：基于当前参数构建号码概率表（机选均匀 + 趋势选号指数放大 + 自选偏好 + 守号群体效应），用初等对称多项式精确计算组合概率，用泊松分布计算开奖号码被 3-10 人购买的概率，调整参数使该概率最大化。预测阶段：用训练好的参数构建最新一期号码概率表，计算每个号码的"冷门度"（1/p），用冷门度作为权重进行加权随机采样生成多组候选，结合组合模式评分筛选最优方案。

#### 14.4 核心特性
- **解析加速**：用精确概率公式替代暴力模拟（1 亿彩民），速度提升约 300 万倍，单轮 100 期仅需约 0.03 秒
- **真实彩民行为建模**：金额分布（小 70%/中 20%/大 10%）、选号方式占比、单式/复式投注、守号群体效应（15% 守号族）、热门号码池聚集效应
- **组合模式评分**：分析历史连号对数、奇偶比、大小比、三区比、和值分布，对候选组合打分
- **完整训练-预测-回测闭环**：训练调整参数使 λ 落入 [3,10] 区间，预测用冷门度加权采样

#### 14.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| train_rounds | 1000 | 训练期数 |
| max_iterations | 50 | 每期最大迭代调整次数 |
| convergence_threshold | 0.9 | 收敛阈值 |
| base_num_players | 100000000 | 基础模拟彩民人数（1亿） |
| small_bet_ratio | 0.70 | 小额购彩占比 |
| medium_bet_ratio | 0.20 | 中等金额占比 |
| large_bet_ratio | 0.10 | 大额购彩占比 |
| random_pick_ratio | 0.40 | 机选占比 |
| trend_pick_ratio | 0.30 | 趋势分析选号占比 |
| self_pick_ratio | 0.30 | 自选占比 |
| target_min_matches | 3 | 目标最小匹配彩民数 |
| target_max_matches | 10 | 目标最大匹配彩民数 |
| target_ideal_matches | 6 | 理想匹配彩民数 |
| learning_rate | 0.05 | 参数调整学习率 |
| birthday_bias | 0.35 | 生日偏好系数 |
| trend_window | 10 | 趋势分析回看窗口 |

#### 14.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换彩种（SSQ/DLT） |
| 2 | 加载数据并训练模型 |
| 3 | 预测下一期号码 |
| 4 | 评估回测 |
| 5 | 查看完整配置 |
| 0 | 退出 |

#### 14.7 使用方法
1. **环境要求**：Python 3.8+，numpy，pandas，scipy
2. **安装步骤**：安装依赖后运行 `python lottery_easy_Emulator.py`
3. **配置说明**：通过 `LotteryConfig` 配置彩民数量、选号比例、偏好系数等
4. **运行流程**：选择彩种 → 训练（调整参数） → 预测 → 回测
5. **结果解读**：输出冷门度加权候选组合、组合模式评分、λ 值统计

#### 14.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 14.9 运行截图

![Emulator运行截图1](pic/lottery_easy_Emulator-1.png)
*图1：lottery_easy_Emulator 运行界面展示*

![Emulator运行截图2](pic/lottery_easy_Emulator-2.png)
*图2：lottery_easy_Emulator 预测结果展示*

---

### 15. lottery_easy_seed.py

#### 15.1 功能概述
种子穷举分析系统，通过穷举大量种子值，为每个球位寻找历史命中率最高的预测种子（支持 GPU 批量加速）。

#### 15.2 系统架构
- `LotteryConfig`：配置（模式、种子范围、top_n、gen_mode、GPU/批次、seed_interval）
- `LotteryGenerator(nn.Module)`：GPU 生成器，含 5 种种子函数
- `LotteryDataset`：批量数据集
- `analyze_seeds_gpu` / `analyze_seeds_cpu`：双路径评估引擎
- `get_gen_function`：种子函数调度
- `generate_predicted_numbers`：预测生成
- `main_menu`：交互菜单

#### 15.3 预测原理
假设彩票号码可由"期号 + 种子"经某种数学变换（加法/乘法/余弦/偏离/位置加权）生成。系统在 [seed_min, seed_max] 范围内穷举种子，对每个球位统计历史命中率，找出命中率最高的种子集合，再用该种子预测下一期号码。

#### 15.4 核心特性
- **5 种种子生成模式**：ADD（加法）、MULT（乘法）、COS（余弦）、LDEV（序号偏离）、POS（位置加权）
- **GPU 批量加速**：`LotteryGenerator` + `LotteryDataset` + DataLoader，支持 MPS/CUDA
- **多进程并行**：CPU 模式默认半数核心并行评估
- **每球位独立寻优**：配置持久化到 `lottery_config_GPU.json`，含种子间隔参数

#### 15.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| seed_min | 5000 | 种子最小值 |
| seed_max | 20000 | 种子最大值 |
| top_n | 20 | 显示的顶级种子数量 |
| gen_mode | 'ADD' | 种子生成模式 |
| batch_size | 512 | GPU 批次大小 |
| seed_interval | 886 | 种子间隔 |
| num_workers | CPU核心数/2 | 工作进程数 |
| use_gpu | False | 是否使用 GPU 加速 |

#### 15.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 显示当前配置 |
| 2 | 设置彩票模式（SSQ/DLT） |
| 3 | 设置种子范围 |
| 4 | 设置顶级种子数量 |
| 5 | 设置工作进程数（CPU） |
| 6 | 设置数据文件 |
| 7 | 设置种子生成模式（ADD/MULT/COS/LDEV/POS） |
| 8 | GPU 加速设置（macOS MPS） |
| 9 | 设置详细输出 |
| 10 | 设置种子间隔 |
| 11 | 加载配置 |
| 12 | 保存配置 |
| 13 | 开始分析 |
| 14 | 使用上期号码预测 |
| 15 | 退出 |

#### 15.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，pandas
2. **安装步骤**：安装依赖后运行 `python lottery_easy_seed.py`
3. **配置说明**：通过 `LotteryConfig` 配置种子范围、gen_mode、GPU/批次大小等
4. **运行流程**：选择彩种与模式 → 穷举种子 → 保存最佳配置 → 预测
5. **结果解读**：输出各球位最佳种子、命中率、预测号码

#### 15.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 15.9 运行截图

![seed运行截图1](pic/lottery_easy_seed-1.png)
*图1：lottery_easy_seed 运行界面展示*

---

### 16. lottery_easy_seed2.py

#### 16.1 功能概述
玄学算法穷举系统，内置多种玄学预测算法，通过穷举算法+参数+种子为每个球位寻找最佳预测配置。

#### 16.2 系统架构
- `CONFIG`：全局配置（数据路径、max/min_history、max_seed、命中率阈值、结果目录）
- `LotterySystem`：单主类，整合数据加载、预测、评估、配置管理
- `next_predict`：算法调度器
- 7 个 `_xxx_predict` 算法实现
- `evaluate_algorithm`：命中率评估
- `find_best_algorithm`：最佳算法搜索
- `main_menu`：主菜单

#### 16.3 预测原理
将历史号码转换为卦象（阴阳爻）、神数等玄学符号，按各术数体系的演变规则（如周易老阳变阴、梅花易数体用生克）推算下一期号码。系统穷举 7 种算法 × 多种子 × 多窗口参数，对每个球位找出历史命中率最高的配置后用于预测。

#### 16.4 核心特性
- **7 种玄学预测算法**：random（随机）、average（移动平均）、zhouyi（周易 64 卦）、taiyi（太乙神数）、tieban（铁板神数）、jiutian（九天）、meihua（梅花易数）
- **多进程并行评估**：参数网格搜索 seed 1-100 + window 3/5/7/10
- **每球位独立寻找最佳**：算法+参数+种子组合
- **配置持久化**：`best_config.json`，支持加载已有最佳配置

#### 16.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| max_history | 10 | 用于预测的最大历史期数 |
| min_history | 3 | 预测所需的最小历史期数 |
| max_seed | 10000 | 最大种子值范围 |
| hit_rate_threshold | 0.30 | 命中率阈值 |
| num_workers | CPU核心数-4 | 多进程工作数 |

#### 16.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择模式（双色球/大乐透） |
| 2 | 优化算法配置 |
| 3 | 预测下一期号码 |
| 4 | 退出 |

#### 16.7 使用方法
1. **环境要求**：Python 3.8+，lunar_python，pandas
2. **安装步骤**：安装依赖后运行 `python lottery_easy_seed2.py`
3. **配置说明**：通过 `CONFIG` 配置历史窗口、种子范围、命中率阈值等
4. **运行流程**：选择彩种 → 穷举算法与参数 → 保存最佳配置 → 预测
5. **结果解读**：输出各球位最佳算法、参数、命中率、预测号码

#### 16.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

---

### 17. lottery_easy_seed3.py

#### 17.1 功能概述
数学方法穷举系统，内置 1000+ 种数学预测方法，通过穷举评估为每个球位寻找最佳预测方法。

#### 17.2 系统架构
- `Config`：模式配置（SSQ/DLT 模式参数、MAX_HISTORY、MAX_SEED、THREADS）
- `DataLoader`：数据加载（按红/蓝球位分离解析）
- `MathMethods`：1000+ 方法库（含 `FuncWrapper`、`_init_methods`、各类方法实现）
- `ExhaustiveEngine`：穷举评估引擎
- `ResultManager`：结果管理（`save_result`，文件命名 `{模式}_{球类型}{位置}.json`）
- `main_menu`：主控制循环

#### 17.3 预测原理
假设彩票号码可通过某种数学函数从历史数据推导。系统将 1000+ 种数学方法（从简单平均到 ARIMA、LSTM、随机森林、布朗运动等）作用于历史号码序列，对每个球位穷举所有方法 × 种子组合，统计历史命中率，选出最优方法保存为 JSON 配置，预测时加载最优配置生成下一期号码。

#### 17.4 核心特性
- **1000+ 种数学预测方法库**：覆盖算术、三角、统计、时序、ML、物理、组合等全谱系
  - 基础算术方法（简单平均、加权平均、中位数、移动平均等）
  - 三角函数应用（66 种，sin/cos/tan × 乘数）
  - 统计方法（标准差、方差、偏度、峰度、EWMA、核密度、Holt-Winters、布林带等）
  - 时间序列方法（ARIMA、季节性分解、向量自回归、LSTM、Prophet 等）
  - 机器学习方法（线性回归、随机森林、梯度提升、SVM、KNN 等）
  - 物理启发方法（布朗运动、热传导、弹簧振动、混沌理论、量子波动等）
  - 自定义组合方法（300 种）
- **`FuncWrapper` 可序列化包装类**：确保多进程 Pickle 序列化正常
- **多进程穷举评估**：`ProcessPoolExecutor`，默认半数 CPU 核心
- **每球位独立保存最佳配置**：保存到 `lottery_easy_seed3_result/` 目录

#### 17.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| MAX_HISTORY | 12 | 最大历史期数 |
| MIN_SEED | 1 | 最小种子值 |
| MAX_SEED | 1000 | 最大种子值 |
| THREADS | CPU核心数/2 | 使用一半 CPU 核心 |

#### 17.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择模式（双色球/大乐透） |
| 2 | 配置参数（历史期数/种子范围） |
| 3 | 分类穷举评估（9个数学方法分类） |
| 4 | 评估高级算法（自回归/马尔可夫链等） |
| 5 | 预测下一期 |
| 6 | 查看现有结果 |
| 0 | 退出系统 |

#### 17.7 使用方法
1. **环境要求**：Python 3.8+，numpy，pandas，scipy，statsmodels（部分时序方法）
2. **安装步骤**：安装依赖后运行 `python lottery_easy_seed3.py`
3. **配置说明**：通过 `Config` 配置 MAX_HISTORY、MAX_SEED、THREADS 等
4. **运行流程**：选择彩种 → 穷举方法与种子 → 保存最佳配置 → 预测
5. **结果解读**：输出各球位最佳方法、命中率、预测号码

#### 17.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

---

### 18. lottery_easy_steps.py

#### 18.1 功能概述
数据雷达图预测系统（PyTorch 版本）。将历史开奖号码序列转换为雷达图（二维图像矩阵），借鉴气象预报中的运动估计算法预测未来雷达图，再反向映射为号码序列。

#### 18.2 系统架构
- `LotteryConfig`：统一超参数配置管理
- `Color`：ANSI 彩色终端输出工具类
- `DataLoader`：SSQ/DLT 历史数据加载与解析
- `RadarConverter`：号码序列 → 雷达图转换器（5 种方案）
- `PyTorchForecaster`：PyTorch 高精度预报器（LK/VET/外推）
- `NumberMapper`：雷达图 → 号码序列反向映射器
- `LotteryPredictor`：端到端预测流程整合器
- `main_menu`：交互式命令行界面

#### 18.3 预测原理
借鉴气象雷达回波外推思想——将每期号码编码为一张雷达图（号码值映射为像素强度，中心区域突出开奖号码），形成时间序列；用光流法/VET 估计雷达图的"运动场"（号码分布的演化趋势），外推得到下一期雷达图；最后通过中心区域值提取和归一化映射将像素还原为号码。

#### 18.4 核心特性
- **号码↔雷达图双向转换**：5 种映射方案（九宫格 49×49 方块/21×21 中心、一对一映射、热力图映射、网格多通道映射、极坐标关系映射）
- **三种高精度预报算法**：Lucas-Kanade 光流法（图像金字塔 + 迭代优化）、VET（变分回波跟踪）、外推法（双三次/双线性/Lanczos 插值）
- **MPS/CPU 自动设备选择**：雷达图缓存、PNG 可视化输出
- **内置历史回测**：accuracy、hit_rate、MAE、RMSE 指标

#### 18.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| radar_method | 1 | 雷达图构造方法（1-5） |
| radar_resolution | 128 | 雷达图分辨率（像素） |
| radar_sequence_length | 6 | 用于预报的历史序列长度 |
| forecast_method | 'vet' | 运动估计方法（lucaskanade/vet） |
| nowcast_method | 'extrapolation' | 预报方法 |
| lk_window_size | 31 | Lucas-Kanade 窗口大小 |
| lk_max_level | 3 | 金字塔最大层数 |
| vet_lambda | 100.0 | VET 数据项权重 |
| vet_alpha | 0.5 | VET 平滑项权重 |
| vet_gamma | 0.1 | VET 时间平滑权重 |
| vet_iterations | 100 | VET 最大迭代次数 |
| extrap_interpolation | 'bicubic' | 外推法插值方法 |
| data_usage_count | 150 | 使用最新的 N 条数据 |
| backtest_periods | 50 | 回测期数 |

#### 18.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 选择数据模式（SSQ/DLT） |
| 2 | 设置参数 |
| 3 | 生成雷达数据（自动加载数据和转换） |
| 7 | 预测下一期 |
| 8 | 历史回测 |
| 0 | 退出系统 |

#### 18.7 使用方法
1. **环境要求**：Python 3.8+，PyTorch，numpy，pandas，cv2（OpenCV，光流计算）
2. **安装步骤**：安装依赖后运行 `python lottery_easy_steps.py`
3. **配置说明**：通过 `LotteryConfig` 配置雷达图方案、预报算法、窗口大小等
4. **运行流程**：选择彩种 → 雷达图转换 → 运动估计预报 → 号码映射 → 回测
5. **结果解读**：输出预测号码、雷达图可视化、回测指标

#### 18.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

#### 18.9 运行截图

![steps运行截图1](pic/lottery_easy_steps-1.png)
*图1：lottery_easy_steps 运行界面展示*

![steps运行截图2](pic/lottery_easy_steps-2.png)
*图2：lottery_easy_steps 雷达图预测展示*

---

### 19. lottery_easy_football.py

#### 19.1 功能概述
竞彩足球玄学预测系统，基于玄学数据作为特征值的足球比赛结果预测，支持猜胜负、猜半场胜负、猜让球胜负三种玩法。

#### 19.2 系统架构
- `FootballConfig`：配置（含 Poisson/ARM 配置）
- `FootballDataLoader`：解析比赛时间、主客队、半场/全场比分、结果、让球数、赔率
- 特征提取：`BaseFeatureExtractor` 基类 + 太乙/大六壬/奇门/统计/组合提取器
- 模型：`ARMRuleModel`、`SimpleSimilarityModel`、`PoissonDixonColesModel`、`CatBoostModel`、`TabNetModel`
- 二次训练：`SecondTrainFeatureGenerator`/`SecondTrainModel`/`SecondTrainBacktest`
- 验证：`TaiyiValidator`/`QizhengValidator`
- 主程序：`predict_match`、`backtest_model`、`main_menu`

#### 19.3 预测原理
从比赛时间提取太乙神数、大六壬、奇门遁甲等玄学特征，通过 ARM 关联规则挖掘"特征组合→比赛结果"的规则，并用相似性模型匹配历史相似比赛；同时用 Poisson/Dixon-Coles 模型基于球队攻防强度预测进球数分布，最终通过二次训练的 CatBoost/TabNet 等模型整合预测胜/平/负及让球结果。

#### 19.4 核心特性
- **三种玩法支持**：猜胜负（全场主队胜/平/负）、猜半场胜负、猜让球胜负
- **玄学特征生成器可扩展架构**：太乙神数、大六壬、奇门遁甲、统计、组合特征提取器
- **两阶段训练**：`SecondTrainFeatureGenerator` 生成二次特征 → `SecondTrainModel` 训练二级模型，含回测
- **特征缓存**：`TaiyiFeatureCache`、`StatisticsFeatureCache` 加速特征计算

#### 19.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| backtest_periods | 500 | 回测期数 |
| poisson_xi | 0.0018 | Poisson 时间衰减参数 |
| poisson_max_goals | 6 | Poisson 最大进球数 |
| arm_min_support | 0.001 | ARM 最小支持度 |
| arm_min_confidence | 0.35 | ARM 最小置信度 |
| arm_min_lift | 1.10 | ARM 最小提升度 |
| stats_history_matches | 10 | 统计历史比赛场次数 |
| similarity_top_n | 50 | 相似性模型取 Top N 场 |
| second_train_feature_count | 7000 | 二次训练特征数据量 |
| catboost_cv_splits | 5 | 交叉验证折数 |

#### 19.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 加载数据并查看统计 |
| 2 | 提取并查看特征 |
| 3-5 | ARM 规则挖掘 训练/回测/预测 |
| 6-7 | 简单相似性 回测/预测 |
| 8-10 | CatBoost 训练/回测/预测 |
| 11-13 | TabNet 训练/回测/预测 |
| 14-16 | 太乙推断法 回测/预测/寻优 |
| 17 | 联合模型分析-联合回测 |
| 18-20 | Poisson/Dixon-Coles 训练/回测/预测 |
| 21 | 赛程查询-爬取今日赛程 |
| 22 | 联合模型分析-联合预测 |
| 23 | 赛程查询-赛程联合预测 |
| 24-25 | 七政四余推断法 回测/预测 |
| 26 | 删除太乙特征值缓存 |
| 27-28 | 二次训练-生成特征/查看统计 |
| 29-31 | 二次训练-XGBoost/LightGBM/同时训练 |
| 32-34 | 二次训练-回测/对比 |
| 0 | 退出 |

#### 19.7 使用方法
1. **环境要求**：Python 3.8+，CatBoost，LightGBM，XGBoost，kintaiyi 模块，pandas
2. **安装步骤**：安装依赖后运行 `python lottery_easy_football.py`
3. **配置说明**：通过 `FootballConfig` 配置 Poisson 参数、ARM 规则、二次训练模型等
4. **运行流程**：加载比赛数据 → 特征提取 → 模型训练 → 预测/回测
5. **结果解读**：输出胜/平/负预测、让球结果、进球数分布、命中率统计

#### 19.8 支持彩种
- **竞彩足球**：猜胜负、猜半场胜负、猜让球胜负（数据源 `jing_football.csv`）

#### 19.9 运行截图

![football运行截图1](pic/lottery_easy_football-1.png)
*图1：lottery_easy_football 运行界面展示*

---

### 20. ziwei-wuxing-main.py

#### 20.1 功能概述
紫微五行相似度分析系统的 Tkinter 启动器（入口 GUI）。计算 SSQ/DLT 下一期开奖日期，复制对应原始数据为 `data.txt`，然后启动 `similarity_gui.py` 进行五行相似度搜索。

#### 20.2 系统架构
- `next_draw_date(weekdays)`：下一开奖日期计算函数
- `button1_click` / `button2_click`：SSQ/DLT 启动回调（复制数据 + subprocess 启动 similarity_gui.py）
- Tkinter 主窗口（标签、按钮、经文、版权）
- 底层依赖：`data_processor.py`（紫微斗数数据预处理）、`similarity_gui.py`（相似度搜索 GUI）、`trend_analysis.py`（趋势可视化）

#### 20.3 预测原理
将每期开奖日的紫微斗数命盘十二宫星曜转换为阴阳五行属性向量，按球位（红 1-6、蓝）聚合宫位五行；通过对比目标日期与历史日期的五行向量相似度（余弦相似度），找出最相似的历史开奖日，以其号码作为候选预测。支持带/不带五行生克及火土大运两种模式。

#### 20.4 核心特性
- **自动计算下一开奖日期**：基于当日 weekday 与开奖时间 20:00 判断
- **一键切换 SSQ/DLT**：数据源并启动对应分析 GUI
- **五行生克计算**：支持五行相生相克关系加权
- **趋势分析可视化**：`trend_analysis.py` 绘制阴阳五行属性随日期变化的趋势图

#### 20.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| GUI 框架 | Tkinter | 图形用户界面框架 |
| 数据文件 | data.txt | 运行时自动复制原始数据 |
| 启动方式 | subprocess | 调用 similarity_gui.py |
| 开奖时间判断 | 20:00 | 基于当日 weekday 与开奖时间判断 |

#### 20.6 交互菜单

| 按钮 | 描述 |
|--------|------|
| 双色球 | 计算 SSQ 下一开奖日期，复制数据，启动相似度搜索 GUI |
| 大乐透 | 计算 DLT 下一开奖日期，复制数据，启动相似度搜索 GUI |

#### 20.7 使用方法
1. **环境要求**：Python 3.8+，tkinter，matplotlib，pandas
2. **安装步骤**：安装依赖后运行 `python ziwei-wuxing-main.py`
3. **配置说明**：GUI 界面选择 SSQ 或 DLT
4. **运行流程**：点击 SSQ/DLT 按钮 → 自动计算开奖日期 → 启动相似度搜索 GUI
5. **结果解读**：输出相似历史开奖日及其号码、五行相似度得分

#### 20.8 支持彩种
- **双色球（SSQ）**：每周二/四/六开奖
- **大乐透（DLT）**：每周一/三/五开奖

#### 20.9 运行截图

![ziwei-wuxing运行截图1](pic/ziwei-wuxing-main-1.png)
*图1：ziwei-wuxing-main 启动界面展示*

![ziwei-wuxing运行截图2](pic/ziwei-wuxing-main-2.png)
*图2：ziwei-wuxing-main 相似度搜索展示*

---

### 21. quantum_lottery_predictor.py

#### 21.1 功能概述
量子双色球预测系统。基于 PennyLane 量子机器学习框架，将历史开奖号码编码为量子态，通过参数化量子电路学习号码分布特征，输出各数字概率分布。

#### 21.2 系统架构
- 超参数定义区（NUM_RED、NUM_QUBITS、LAYERS、EPOCHS、编码类型等）
- `parse_ssq_data`：数据解析与滑动窗口特征构造
- `quantum_circuit_red` / `quantum_circuit_blue`：红蓝球量子电路（@qml.qnode）
- `QuantumLotteryPredictor`：经典-量子混合模型类（train/predict_proba/save/load）
- `train_red_model` / `train_blue_model`：多进程训练包装函数
- `predict_next_lottery` / `evaluate_historical_predictions`：预测与评估流程
- `menu`：交互式菜单

#### 21.3 预测原理
将历史号码编码为量子态（角度编码用 RX 旋转门将归一化数值映射到量子比特相位；离散编码将号码二进制展开后用 BasisEmbedding 嵌入基态），经多层参数化量子门（Rot+CNOT）产生纠缠与叠加，测量得到各数字的量子概率分布；通过 Adam 优化器最小化交叉熵损失更新量子门参数，使量子电路输出逼近真实开奖号码分布；预测时输入最近一期号码的量子态，读取测量概率最高的数字作为推荐。

#### 21.4 核心特性
- **红/蓝球独立量子模型**：红球按 6 个位置独立训练 6 个量子模型，蓝球单独训练 1 个模型，共 7 个模型
- **两种数据编码方案**：角度编码（RX 门，0-2π 归一化）/ 离散编码（BasisEmbedding 二进制基态编码）
- **多进程并行训练**：multiprocessing.Pool + 日志监听线程
- **滑动窗口特征 + 数据增强**：WINDOW_SIZE 期历史数据，支持高斯噪声数据增强

#### 21.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| NUM_QUBITS_RED | 6 | 红球量子比特数（2^6=64≥33） |
| NUM_QUBITS_BLUE | 4 | 蓝球量子比特数（2^4=16） |
| LAYERS | 3 | 量子电路层数 |
| EPOCHS | 2 | 训练周期 |
| INIT_LR | 0.01 | 初始学习率 |
| BATCH_SIZE | 32 | 批次尺寸 |
| REGULARIZATION | 0.05 | 正则化系数 |
| LR_DECAY | 0.5 | 学习率衰减系数 |
| DECAY_STEPS | 5 | 衰减周期 |
| MOMENTUM_BETA | 0.95 | 动量项参数 |
| NOISE_SCALE | 0.1 | 噪声强度 |
| WINDOW_SIZE | 7 | 滑动窗口大小 |
| ENCODING_TYPE | "discrete" | 编码类型（angle/discrete） |

#### 21.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 训练模型 |
| 2 | 执行预测 |
| 3 | 历史评估 |
| 0 | 退出系统 |

#### 21.7 使用方法
1. **环境要求**：Python 3.8+，PennyLane，numpy，pandas
2. **安装步骤**：安装依赖后运行 `python quantum_lottery_predictor.py`
3. **配置说明**：通过超参数定义区配置 NUM_QUBITS、LAYERS、EPOCHS、编码类型等
4. **运行流程**：选择训练/预测/评估 → 多进程训练 7 个量子模型 → 预测下一期
5. **结果解读**：输出按概率降序排列的完整分布表 + TOP1 推荐号码，含历史回溯评估

#### 21.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1

---

### 22. Lottery_easy_Gua_Rust/（周易卦象 Rust 版）

#### 22.1 功能概述
`lottery_easy_Gua.py` 的 Rust 高性能重写版本。基于周易时间起卦法，通过农历时间生成卦象特征，使用组合式数学操作搜索算法，找出能够命中开奖数字的卦象数字变换方式。

#### 22.2 系统架构
- `config.rs`：全局配置（`GuaConfig`）
- `constants.rs`：卦象常量定义
- `gua_features.rs`：卦象特征计算（梅花易数起卦）
- `formula.rs` / `formula_generator.rs`：公式规范与候选生成
- `search.rs`：公式搜索与评估
- `voting.rs`：投票策略
- `optimization.rs`：优化策略
- `data_loader.rs`：数据加载
- `color_printer.rs`：彩色输出
- `menu.rs`：交互式菜单

#### 22.3 预测原理
与 Python 版（lottery_easy_Gua.py）原理一致：使用农历年月日时按梅花易数法起卦，衍生出本卦、变卦、互卦等特征，对卦象特征进行数学操作搜索命中开奖数字的公式，保存高命中率公式用于预测。Rust 版本提供更高的计算性能。

#### 22.4 核心特性
- **Python 版的 Rust 高性能重写**：利用 Rust 的零成本抽象和内存安全特性
- **模块化设计**：各功能模块独立分离，便于维护与扩展
- **与 Python 版功能对齐**：支持相同的起卦、公式搜索、投票策略
- **Cargo 项目管理**：标准 Rust 项目结构

#### 22.5 重要参数

| 参数名 | 默认值 | 说明 |
|--------|--------|------|
| max_operations | 3 | 最大操作数 |
| train_periods | 153 | 训练期数 |
| val_periods | 12 | 验证期数 |
| top_n_results | 200 | 保存前 N 个结果 |
| ssq_red_threshold | 0.22 | SSQ 红球阈值 |
| ssq_blue_threshold | 0.19 | SSQ 蓝球阈值 |
| dlt_red_threshold | 0.22 | DLT 红球阈值 |
| dlt_blue_threshold | 0.19 | DLT 蓝球阈值 |
| ssq_red_output | 8 | SSQ 红球输出数 |
| ssq_blue_output | 2 | SSQ 蓝球输出数 |
| dlt_red_output | 7 | DLT 红球输出数 |
| dlt_blue_output | 3 | DLT 蓝球输出数 |
| max_formulas_for_voting | 10 | 投票最大公式数量 |

#### 22.6 交互菜单

| 选项号 | 描述 |
|--------|------|
| 1 | 切换彩种 (SSQ/DLT) |
| 2 | 搜索公式并预测下一期号码 |
| 3 | 按球位预测下一期号码（使用已保存模型） |
| 4 | 配置投票策略参数 |
| 5 | 查看系统配置 |
| 6 | 测试单期卦象计算 |
| 7 | 寻找最优训练集/验证集配置 |
| 8 | 多参数组合联合搜索预测 |
| 0 | 退出系统 |

#### 22.7 使用方法
1. **环境要求**：Rust 工具链（rustc + cargo）
2. **安装步骤**：进入 `Lottery_easy_Gua_Rust/` 目录，运行 `cargo build --release`
3. **配置说明**：通过 `GuaConfig` 配置球位范围、搜索策略等
4. **运行流程**：`cargo run --release` 启动交互式菜单
5. **结果解读**：输出各球位预测号码、公式命中率统计

#### 22.8 支持彩种
- **双色球（SSQ）**：红球 1-33 选 6 + 蓝球 1-16 选 1
- **大乐透（DLT）**：红球 1-35 选 5 + 蓝球 1-12 选 2

---

## 辅助模块说明

除上述核心预测系统外，项目还包含以下辅助模块：

| 文件名 | 功能简述 |
|--------|---------|
| lottery_easy_weather.py | 天气数据获取与特征提取模块，从天气 API 拉取历史天气数据并编码为数值特征，为 ML 模型提供天气维度辅助特征 |
| data_processor.py | 紫微斗数数据预处理核心模块，定义十二宫对宫映射、主辅杂曜五行属性表，实现星曜→五行→号码取模映射 |
| similarity_gui.py | 紫微五行相似度搜索 Tkinter GUI（过程式实现），按整体日期五行向量对比找相似历史开奖日 |
| similarity_gui_unite.py | 紫微五行相似度搜索 Tkinter GUI（类封装版本），集成相似度搜索、五行生克计算与趋势分析 |
| trend_analysis.py | 五行趋势分析 Matplotlib 可视化脚本，绘制阴阳五行属性随日期变化的趋势图 |
| kinliuren.py | 六壬排盘模块（Liuren 类），计算天将、贵人、刑冲合害破等传统六壬神盘要素 |
| optimize_poisson.py | 足球 Poisson-Dixon-Coles 模型参数优化脚本，遍历 rho 值寻找最优参数 |
| run_all_backtests.py | 足球模型批量回测脚本，对 CatBoost、相似性、Poisson 三种模型运行回测 |
| sweep_modulus_count.py | 太乙特征距离回测的模值数量扫描脚本，寻找最优取模值数量 |

## 通用环境要求

- **Python 版本**：3.8+
- **核心依赖库**：torch（PyTorch）、numpy、pandas、scipy
- **玄学计算库**：lunar_python（农历/八字计算）
- **概率编程**：pyro（BVAR 模型）
- **符号回归**：PySR（需 Julia 后端）
- **图神经网络**：torch_geometric（Taiyi_GNN）
- **量子计算**：PennyLane（quantum_lottery_predictor）
- **天文计算**：swisseph / skyfield（QiZheng / BVAR 天文特征）
- **机器学习**：CatBoost、XGBoost、LightGBM
- **GPU 加速**：支持 Apple MPS / NVIDIA CUDA / CPU 自动选择
- **Rust 工具链**（仅 Gua_Rust）：rustc + cargo

## 注：本项目开发环境为mac os，部分算法加速使用mps加速，如使用N卡，请自行切换CUDA加速。

## 总结

本项目集合了多种彩票预测系统的实现，旨在通过技术手段探讨随机事件数据的分析方法和模式识别技术。这些系统采用了不同的算法和模型，从概率统计、机器学习到模式识别、量子计算、传统术数等多个角度对彩票数据进行分析和探索。

需要再次强调的是，**本项目仅作为个人技术学习和探讨交流使用，绝对不能作为购买彩票的依据或参考**。彩票本质是随机游戏，任何声称能够准确预测彩票号码的说法都是没有科学依据的。请大家务必保持理性和科学的态度，树立正确的投资观念。

**免责声明：** 本项目作者不对使用本项目代码所产生的任何直接或间接损失承担责任。彩票中奖号码本质上是随机事件，本项目中所有预测结果仅供技术探讨与学习交流，不构成任何投注建议。用户应理性对待彩票，切勿沉迷。因使用本项目内容而导致的任何损失或风险，由用户自行承担。


### 联系方式

如需技术交流，可发邮件：carpenterma7@163.com，也可通过以下方式联系：

![微信二维码](pic/wechat.png)

**声明：** 作者本人不接受任何与彩票购买相关的免费咨询，仅可接受某些层面上的项目技术交流。
#### 每个算法我都跑过若干次，有的算法几百上千次的改进，有成果，算是因，若您因为本项目的某些影响而中了大奖，心中难平，算是果，此因彼果，可赠与7%
