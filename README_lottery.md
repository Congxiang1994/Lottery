# Lottery 彩票数据站 · 模块实现文档

> 本页为 `backend/app/lottery/` + `frontend/src/lottery/` 功能域的**实现逻辑与技术结构**说明。
> 全站总览见 [README.md](./README.md)。

支持彩种：**双色球 (SSQ)** / **大乐透 (DLT)**。前端 4 个页面：首页（`/lottery`）、历史开奖（`/history`）、
智能推荐（`/predict`）、算法广场（`/algorithms`）。

---

## 1. 数据层：爬取与存储

```
500彩票网 (fetch_data.py / scraper.py, 带 UA+Referer 绕过反爬)
      │ 全量历史开奖
      ▼
JSON 缓存: backend/app/lottery/data/ssq.json, dlt.json   ← 运行时读内存, 不入 git
      │ 算法跑批结果（每日 0:00 定时 + 手动「运行全部」）
      ▼
SQLite: /data/lottery/algo_results.db  ← WAL 模式, 独立于部署目录, 重部署不丢
```

- **开奖数据**：`services/scraper.py` 负责拉取并落盘 JSON；`scripts/fetch_data.py` 可手动刷新，
  每日 0:00 定时任务也会自动更新期号。接口层每次请求从 JSON 读入内存。
- **算法结果**：`services/results_store.py` 写 SQLite，持久化路径可用环境变量
  `LOTTERY_DB_DIR` 覆盖（默认 `/data/lottery`，本地测试注入 `/tmp/...`）。
- **连接抽象**：SQLite WAL 连接统一走 `app/common/db.py` 的 `get_conn()`（上下文管理器，
  正常退出自动 commit），`results_store._conn()` 委托给它，避免各服务重复写连接代码。

## 2. 算法引擎（核心设计）

代码：`backend/app/lottery/algorithms/`（`base.py` + 12 个分类模块 + `backtest.py` + `__init__.py`）

### 统一接口

每个算法都是**纯函数** `fn(ctx) -> AlgoOutput`，输出「每个号码的打分向量」而非直接给号码：

```python
@dataclass
class AlgoOutput:
    red: np.ndarray   # shape (red_max,)  每个红球候选号得分（越高越推荐）
    blue: np.ndarray  # shape (blue_max,)
    detail: dict      # 算法内部推演过程（前端展示用）
```

好处：所有算法**可比较、可归一化、可加权投票集成**，彼此独立、互不影响。

### 共享特征上下文（AlgoContext）

`AlgoContext` 一次性预计算公用特征（one-hot 出现矩阵、遗漏矩阵、和值序列等），
80+ 算法共享同一份，避免各自重复计算。带 **TTL 缓存**（`_CTX_CACHE`，1800s，只保留最新一份），
同一份开奖数据只做一次特征工程。

### 注册表驱动（REGISTRY）

- 每个算法用 `register(id, name, category, desc, tags, cost)` 注册进全局 `REGISTRY`；
- 元信息（分类/名称/原理/技术标签/**成本分级** `cost`：1极快 2快 3中 4慢）直接驱动前端「算法广场」；
- `catalog()` 汇总成 12 分类 89 算法的目录接口。

### 12 大分类 89 算法

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

### 融合与回测

- **`combine()`**：多算法等权/加权融合——各算法打分向量 `normalize` 后加权平均 → 取 top-k。
  默认排除集成类（ensemble）算法，避免重复计票。
- **滚动回测 `backtest.py`**：对最近 N 期做「留一预测」（只用当期之前的数据），
  统计各算法实际命中 vs 随机期望，得到 **lift 排行榜**。
  > 长期回测中所有算法 lift 应回归 1.0——这正是彩票随机性的客观证据。

## 3. 全量运行链路（算法广场 → SQLite 一致性）

```
「算法广场 · 运行全部」 → POST /api/v1/run-all
      │ 密码校验（后端强制 check_password, 错/缺 → 401）
      ▼
runner.start_all() → SQLite 全局互斥锁（防并发, 已运行 → 409）
      ▼
后台线程（daemon）顺序跑 双色球 → 大乐透
      │ 每个彩种: 预测阶段(85 个非集成算法) + 回测阶段
      │ 逐算法更新进度: run_progress 表（gunicorn 多 worker 跨进程轮询一致）
      ▼
save_batch 落库 → 首页 saved-combined / saved-algorithms/latest 自动读到新结果
```

- **触发方式**：手动（算法广场按钮，需操作密码）/ 定时（`lottery-algos.timer` 每日 0:00 →
  `scripts/run_all_algorithms.py`，与 runner 共用同一逻辑）。
- **进度 ETA**：按 `cost` 加权估算（`COST_SECONDS = {1:0.15s, 2:0.6s, 3:2.0s, 4:4.5s}`）。
- **单彩种**：`POST /api/v1/{lottery}/run-all` 只跑一个彩种，同一套逻辑。

## 4. 防并发 / 安全设计

| 机制 | 说明 |
|---|---|
| 只读接口不计算 | `GET /backtest` 等只读接口缓存 miss → **503**，绝不触发计算；计算只走「运行全部」入口 |
| 操作密码 | `run-all` 后端强制校验密码（无密码/错密码 → 401）；`verify-password` 带每秒 1 次流控 |
| 互斥锁 | SQLite 全局锁防「运行全部」并发；`backtest_lock` TTL=1800s（防 SIGTERM 残留锁、防长回测抢占） |
| 回测缓存 | `backtest_cache` 表按 `(lottery, folds, max_cost, issue_base)` 失效 |

## 5. API 全表（前缀 `/api/v1`，共 23 条路由，见 `router.py`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/lotteries` | 彩种列表 |
| GET | `/{ssq\|dlt}/summary` | 概览统计 |
| GET | `/{ssq\|dlt}/latest` | 最新一期 |
| GET | `/{ssq\|dlt}/history?page=&page_size=` | 历史（分页，最新在前） |
| GET | `/{ssq\|dlt}/stats` | 频率/冷热/遗漏/走势 |
| GET | `/{ssq\|dlt}/predict` | 智能推荐（统计+梅花易数+综合） |
| GET | `/algorithms` | 算法目录（89 算法 + 12 分类元信息） |
| GET | `/{ssq\|dlt}/algorithms?ids=&category=&max_cost=` | 批量执行算法（默认 cost≤2 快算法） |
| GET | `/{ssq\|dlt}/algorithms/{id}` | 执行单个算法（号码+打分+推演细节） |
| GET | `/{ssq\|dlt}/combined?max_cost=&ids=` | 多算法加权融合共识号码 |
| GET | `/{ssq\|dlt}/backtest?folds=&max_cost=` | 滚动回测 lift 排行榜（只读缓存） |
| GET | `/{ssq\|dlt}/algo-ids?category=&max_cost=` | 算法 id 列表 |
| GET | `/algo-summary` | 各彩种最近一次定时入库摘要 |
| GET | `/{ssq\|dlt}/saved-algorithms/latest` | 最新一批入库的全部算法结果 |
| GET | `/{ssq\|dlt}/saved-combined` | 对每日跑批缓存做等权融合（纯缓存不实时计算） |
| GET | `/{ssq\|dlt}/saved-algorithms/runs?limit=` | 最近 N 天入库日期列表 |
| GET | `/{ssq\|dlt}/saved-algorithms/{run_date}` | 按日期取整批 |
| POST | `/verify-password` | 校验「运行全部」操作密码（1次/秒流控） |
| POST | `/run-all` | 启动全量运行（双色球+大乐透，密码校验+互斥锁） |
| GET | `/run-status` | 全量运行进度（跨 worker 轮询） |
| POST | `/{ssq\|dlt}/run-all` | 启动单彩种全量运行 |
| GET | `/{ssq\|dlt}/run-status` | 单彩种运行进度 |
| POST | `/{ssq\|dlt}/refresh` | 重新爬取数据 |

## 6. 前端结构（`frontend/src/lottery/`）

```
src/lottery/
├── api.ts        # API 客户端（fetch 封装，全站 /api/v1）
├── types.ts      # 彩种 / 开奖 / 算法结果类型定义
├── context.ts    # LotteryCtx + useLottery（当前彩种 key 状态，App 层 Provider）
├── components/   # Ball(号码球) / Heatmap / LotteryTabs / Reveal / TrendChart / TrendMatrix
└── pages/
    ├── Home.tsx        # /lottery  首页（最新开奖 + 快捷入口）
    ├── History.tsx     # /history  历史开奖 + 走势
    ├── Predict.tsx     # /predict  智能推荐（消费 saved-combined / saved-algorithms）
    └── Algorithms.tsx  # /algorithms 算法广场（目录 + 运行全部 + 回测排行榜）
```

- 页面数据全部来自 REST API（`/api/v1/...`），前端**不直连数据库**。
- `TrendMatrix.tsx` 用原生 Canvas + ResizeObserver 手写走势图，自适应容器宽度、整图一屏显示。
- 路由注册在 `frontend/src/App.tsx`（顶级路径 `/lottery` `/history` `/predict` `/algorithms`）。
