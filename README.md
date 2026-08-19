# Lottery Easy · 彩票数据可视化与智能推荐

**前后端分离**的彩票数据站。
支持 **双色球 (SSQ)** 与 **大乐透 (DLT)**，提供历史开奖可视化、号码频率/冷热/遗漏分析、走势图，以及 **89 个推荐算法**（12 大分类）驱动的算法广场、智能推荐与滚动回测。

> ⚠️ **理性购彩声明**：彩票开奖完全随机，任何历史统计与「预测」均不具备科学依据，本平台所有推荐仅供娱乐参考。请量力而行、理性投注，切勿沉迷。未满 18 周岁禁止购彩。

---

## 架构

```
┌─────────────┐      HTTP /api     ┌──────────────────────────┐
│  前端 React  │ ─────────────────▶ │  后端 FastAPI             │
│ Vite+Tailwind│ ◀──── JSON ─────── │  gunicorn :8000           │
│ (Nginx 静态) │                    │  ├─ 算法引擎（89 个算法）   │
└─────────────┘                    │  ├─ 统计 / 玄学 / 数据服务  │
        │ 80 端口 (Nginx)           └──────────┬───────────────┘
        └──────────────────────────────────────┘ app/data/{ssq,dlt}.json
                                              （由 500彩票网 爬取生成）
```

- **前端**：React 18 + Vite + TailwindCSS + Recharts，暗色高端风、响应式、入场动效。
- **后端**：FastAPI（纯 CPU 推理，numpy + scikit-learn，不依赖 torch/GPU）。
- **数据**：部署时从 **500彩票网** 爬取双色球/大乐透全量历史（带 UA+Referer 绕过反爬），落盘为 JSON 缓存。
- **部署**：Nginx 反向代理 + gunicorn + systemd，**无 Docker**。

---

## 算法引擎（89 个算法 · 12 大分类）

统一接口 `fn(ctx) -> AlgoOutput`：每个算法输出「号码打分向量」而非直接号码，可比较、可归一化、可加权投票集成；`AlgoContext` 预计算 one-hot / 遗漏矩阵 / 和值序列等共享特征。注册表驱动前端「算法广场」。

| 分类 | 数量 | 代表性算法 |
|---|---|---|
| 统计与概率 | 16 | 频率(全期/加权)、冷热、遗漏、一/二阶马尔可夫、条件概率表、朴素贝叶斯、卡方、互信息、Apriori、Beta-Binomial、泊松、蒙特卡洛、二项检验、KDE |
| 时间序列 | 9 | EWMA、多尺度均线、Holt-Winters、AR(8)、PCA+VAR、FFT 周期、季节性分解、差分趋势、布林带 |
| 距离与相似性 | 9 | 欧氏/曼哈顿/切比雪夫/余弦/汉明/杰卡德/马氏 7 距离 KNN、DTW(Sakoe-Chiba)、多距离融合 |
| 机器学习 | 9 | 岭回归、随机森林、HistGradientBoosting≈LightGBM、ExtraTrees、MLP、SVR、KNN、PCA 重构、逻辑回归（**真实训练**） |
| 深度学习 | 7 | LSTM / Transformer / TCN / ResDNN / VAE / GAN / GAT（numpy 手写前向+反向传播） |
| 量子计算 | 5 | QCBM(参数移位梯度)、QRNN、Qopula、Szegedy 量子行走、Grover（态矢量模拟真实量子门） |
| 符号回归 | 3 | 遗传编程表达式演化、参数化公式网格寻优、SISSO 稀疏字典 |
| 物理启发 | 6 | OU 布朗运动、Logistic 混沌(Lyapunov)、热传导方程、阻尼振子、薛定谔基态、伊辛退火 |
| 种子寻优 | 6 | ADD/MULT/COS/LDEV/POS 五种种子模式 + 全局网格穷举（滚动回测择优） |
| 玄学术数 | 12 | 梅花易数、八字喜用神、大六壬四课三传、奇门九宫、紫微斗数、七政四余、太乙神数、铁板神数、九天玄数、六十四卦、河图洛书、二十四节气纳音 |
| 信号与图像 | 3 | 雷达热力图 + Lucas-Kanade 光流推流、Haar 小波去噪外推、Hilbert 解析信号相位外推 |
| 集成融合 | 4 | 全量等权投票、分类层次融合、Borda 计数、回测 lift 元学习堆叠 |

**滚动回测**：对最近 N 期做「留一预测」（只用当期之前的数据），统计各算法实际命中 vs 随机期望，得到 lift 排行榜。长期回测中所有算法 lift 应回归 1.0——这正是彩票随机性的客观证据。

---

## 目录结构

```
lottery_web/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py           # 入口
│   │   ├── config.py         # 彩种元数据
│   │   ├── algorithms/       # 算法引擎（base + 12 个分类模块 + backtest）
│   │   ├── routers/lottery.py# API（含算法目录/运行/批量/回测）
│   │   ├── services/         # scraper / stats / gua / predictor
│   │   └── data/             # ssq.json / dlt.json（爬取生成）
│   ├── scripts/check_algos.py# 算法自检脚本
│   └── requirements.txt
├── frontend/                # React 前端
│   ├── src/pages/  (Home / History / Predict / Algorithms)
│   └── dist/                # 生产构建产物
└── deploy/                  # install.sh / nginx.conf / lottery-easy.service
```

---

## 本地开发

### 后端（Python + Poetry / venv）
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python scripts/fetch_data.py     # 抓取数据
PYTHONPATH=. python scripts/check_algos.py    # 算法自检（可选）
PYTHONPATH=. uvicorn app.main:app --reload     # http://127.0.0.1:8000
```

### 前端（Node）
```bash
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173 （已代理 /api → 8000）
npm run build        # 产物到 frontend/dist
```

---

## 服务器部署（无 Docker）

1. 把整个 `lottery_web/` 上传到服务器 `/opt/lottery_easy`：
   ```bash
   rsync -avz --exclude 'node_modules' --exclude '.venv' lottery_web/ user@<IP>:/opt/lottery_easy/
   ```
2. 在服务器以 root 执行一键部署：
   ```bash
   sudo bash /opt/lottery_easy/deploy/install.sh
   ```
3. 浏览器访问 `http://<服务器公网IP>/`。

部署脚本会自动：安装 nginx/python 依赖 → 建虚拟环境装包（含 numpy/scikit-learn）→ 爬取数据 → 配置 Nginx(80) → 配置 systemd 自启 → 开放防火墙。

常用运维：
```bash
journalctl -u lottery-easy -f        # 后端日志
systemctl restart lottery-easy      # 重启后端
cd /opt/lottery_easy/backend && .venv/bin/python scripts/fetch_data.py   # 更新数据
```

---

## API 速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/lotteries` | 彩种列表 |
| GET | `/api/v1/{ssq\|dlt}/latest` | 最新一期 |
| GET | `/api/v1/{ssq\|dlt}/history?page=&page_size=` | 历史（分页，最新在前） |
| GET | `/api/v1/{ssq\|dlt}/stats` | 频率/冷热/遗漏/走势 |
| GET | `/api/v1/{ssq\|dlt}/predict` | 智能推荐（统计+梅花易数+综合） |
| GET | `/api/v1/algorithms` | 算法目录（89 个算法元信息） |
| GET | `/api/v1/{ssq\|dlt}/algorithms?max_cost=&ids=&category=` | 批量执行算法 |
| GET | `/api/v1/{ssq\|dlt}/algorithms/{id}` | 执行单个算法（号码+打分+推演细节） |
| GET | `/api/v1/{ssq\|dlt}/combined?max_cost=` | 多算法加权融合共识号码 |
| GET | `/api/v1/{ssq\|dlt}/backtest?folds=&max_cost=` | 滚动回测 lift 排行榜 |
| POST | `/api/v1/{ssq\|dlt}/refresh` | 重新爬取数据 |
