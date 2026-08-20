# Lottery · 产品矩阵（Product Matrix）

🌐 **在线访问**：[https://doudoutech.cloud/](https://doudoutech.cloud/) · ⭐ [GitHub](https://github.com/Congxiang1994/Lottery)

> **这是一个聚合型项目（umbrella repo）。** 用同一套前端聚合门户 + 同一套后端框架，承载多个**独立产品模块**。
> 当前已上线的模块是 **Lottery 彩票数据站**；后续任何新功能都**直接在本仓库内新增模块**即可，无需另开仓库。

---

## 项目定位

| 维度 | 说明 |
|---|---|
| 形态 | 单仓库（monorepo）托管多个产品模块 |
| 前端 | 一个 React SPA。首屏是「产品矩阵」聚合门户（Portal），每个功能是一个路由模块 |
| 后端 | 一个 FastAPI 应用，按功能拆分 router（`/api/v1/<module>/...`） |
| 部署 | Nginx 静态托管 SPA + 反代 API；通过 **Cloudflare Tunnel** 实现 HTTPS 域名访问（**免 ICP 备案**） |
| 容器 | **无 Docker**，纯 systemd 管理 |

---

## 已上线模块

### 🎲 Lottery 彩票数据站（`/lottery`）

支持 **双色球 (SSQ)** 与 **大乐透 (DLT)**，提供历史开奖可视化、号码频率 / 冷热 / 遗漏分析、走势图，
以及由 **89 个推荐算法**（12 大分类）驱动的算法广场、智能推荐与滚动回测。

> ⚠️ **理性购彩声明**：彩票开奖完全随机，任何历史统计与「预测」均不具备科学依据，本平台所有推荐仅供娱乐参考。请量力而行、理性投注，切勿沉迷。未满 18 周岁禁止购彩。

**算法引擎（89 个算法 · 12 大分类）**

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

## 架构

```
┌──────────────┐   HTTPS (Cloudflare Tunnel, 免备案)   ┌──────────────────────────────┐
│  浏览器 / 用户 │ ───────────────────────────────────▶ │  Nginx :8081 (静态 SPA + 反代) │
└──────────────┘                                       └──────────────┬───────────────┘
                                                                     │ /api  →  127.0.0.1:8000
                                                       ┌─────────────┴──────────────┐
                                                       │  FastAPI (gunicorn 2 worker) │
                                                       │  ├─ 算法引擎（89 个算法）      │
                                                       │  ├─ 统计 / 玄学 / 数据服务     │
                                                       │  └─ SQLite: /data/lottery/    │
                                                       └─────────────────────────────┘
```

- **前端**：React 18 + Vite + TailwindCSS + Recharts，暗色高端风、响应式、入场动效。
- **后端**：FastAPI（纯 CPU 推理，numpy + scikit-learn，不依赖 torch/GPU）。
- **数据**：部署时从 **500彩票网** 爬取双色球/大乐透全量历史（带 UA+Referer 绕过反爬），落盘为 JSON 缓存；算法结果持久化在 `/data/lottery/algo_results.db`（独立于部署目录，重部署不丢）。
- **域名访问**：国内云未备案域名 80/443 被拦截，因此用 **Cloudflare Tunnel** 穿透（服务器主动出站 QUIC，边缘按隧道路由回源），对外即 `https://doudoutech.cloud`，自带免费 HTTPS 证书。

---

## 目录结构（仓库根）

```
.
├── backend/                 # FastAPI 后端（单应用，按模块拆分 router）
│   ├── app/
│   │   ├── main.py           # 入口，include_router 注册各模块路由
│   │   ├── config.py         # 彩种 / 模块元数据
│   │   ├── algorithms/       # 算法引擎（base + 12 个分类模块 + backtest）
│   │   ├── routers/          # API router（lottery.py 等，未来加 <module>.py）
│   │   ├── services/         # scraper / stats / predictor / 结果存储
│   │   └── data/             # ssq.json / dlt.json（爬取生成，不入库）
│   ├── scripts/fetch_data.py # 爬取历史开奖
│   └── requirements.txt
├── frontend/                # React 前端（单 SPA，含聚合门户 + 各模块页面）
│   ├── src/pages/           # Portal(聚合首页) / Home / History / Predict / Algorithms
│   ├── src/components/       # Nav / Footer / 图表组件
│   └── dist/                # 生产构建产物（部署时由 Nginx 托管）
└── deploy/                  # 部署相关
    ├── install.sh           # 一键部署（无 Docker）
    ├── nginx.conf           # Nginx 配置（listen 8081，反代 /api，SPA 回退）
    ├── lottery.service      # 后端 gunicorn 服务
    ├── lottery-algos.service / .timer  # 每日 0:00 全量算法入库
    └── (未来新模块的服务文件放在这里，install.sh 会自动注册)
```

---

## 本地开发

### 后端（Python 3.12+）
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python scripts/fetch_data.py     # 抓取数据
PYTHONPATH=. uvicorn app.main:app --reload     # http://127.0.0.1:8000
```

### 前端（Node 22+）
```bash
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173 （已代理 /api → 8000）
npm run build        # 产物到 frontend/dist
```

---

## 服务器部署（无 Docker）

1. 把**仓库根目录**整体同步到服务器 `/opt/lottery`（前端需先在本地 `npm run build` 生成 `dist/`）：
   ```bash
   # 在本地仓库根执行
   cd frontend && npm run build && cd ..
   rsync -az --exclude node_modules --exclude .venv --exclude 'app/data' --exclude '.git' \
     ./ user@<IP>:/opt/lottery/
   ```
   > ⚠️ 必须排除 `app/data`：本地测试会生成 `algo_results.db`，若同步覆盖会冲掉服务器生产库。
   > 生产库已固定在 `/data/lottery/`，与部署目录分离，正常重部署不会清空。

2. 在服务器以 root 执行一键部署：
   ```bash
   sudo bash /opt/lottery/deploy/install.sh
   ```
   脚本会自动：装系统依赖 → 建 venv 装包 → 爬取数据 → 建 `/data/lottery` 持久化目录（首次迁移旧库）→
   配置 Nginx(:8081) → 注册并启动所有 `deploy/*.service/*.timer`（含未来的新模块服务）→ 开放防火墙。

3. 浏览器访问 [https://doudoutech.cloud/](https://doudoutech.cloud/)。
   （公网经 Cloudflare Tunnel 穿透；服务器本机可直连 `http://<IP>:8081` 调试。）

---

## 扩展新功能（开发规范）

新功能**直接放进本仓库**，遵循「前端页面 + 后端 router + 部署服务」三步：

### 1) 新增前端模块
- 新建页面：`frontend/src/pages/<Feature>.tsx`
- 注册路由：`frontend/src/App.tsx` 增加 `<Route path="/<feature>" element={<Feature/>} />`
- 上架到聚合门户：`frontend/src/pages/Portal.tsx` 的 `APPS` 数组追加一项
  （`status: "live"` 可点击进入；`"soon"` 为灰度占位卡，用于展示平台扩展性）

### 2) 新增后端模块（可选，纯前端功能可跳过）
- 新建 router：`backend/app/routers/<feature>.py`，用 `APIRouter` 写接口
- 注册：`backend/app/main.py` 里 `app.include_router(<feature>_router, prefix="/api/v1/<feature>")`
- 若需要独立后台任务 / 定时跑批：在 `deploy/` 放 `<feature>.service`（+ 可选 `<feature>.timer`），
  **重跑 `install.sh` 会自动发现并注册**，无需改脚本。

### 3) 部署
本地 `cd frontend && npm run build` → `rsync` 同步 → `sudo systemctl restart lottery`（后端改动时）。
新增的后端服务：`sudo systemctl daemon-reload && sudo systemctl enable --now <feature>`。

> 设计约定：**单 SPA + 单 FastAPI 应用**即可承载多数模块；只有当某模块需要独立进程/端口时，
> 才为其单独起服务并在 `deploy/` 放 unit 文件、在 `nginx.conf` 增加对应 `location /api/<feature>/` 反代。

---

## API 速览（Lottery 模块）

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

---

## 常用运维

```bash
journalctl -u lottery -f              # 后端日志
systemctl restart lottery            # 重启后端
journalctl -u lottery-algos -f       # 每日跑批日志
systemctl start lottery-algos.service  # 手动立即跑批
cd /opt/lottery/backend && .venv/bin/python scripts/fetch_data.py   # 更新开奖数据
curl -s http://127.0.0.1:8000/api/health   # 健康检查
sudo systemctl restart cloudflared    # 重启隧道（改 /etc/cloudflared/config.yml 后）
sudo nginx -t && sudo systemctl reload nginx   # 改 nginx 配置后
```
