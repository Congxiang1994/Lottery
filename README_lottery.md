# 🎲 Lottery 彩票数据站 · 双色球 / 大乐透数据可视化与算法广场

> 全量历史开奖统计、走势追踪，以及 **89 个算法 / 12 大分类**驱动的智能推荐与滚动回测。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/lottery` · `/history` · `/predict` · `/algorithms` · [在线访问](https://doudoutech.cloud/lottery) |
| 前端 | `frontend/src/lottery/` |
| 后端 | `backend/app/lottery/`（含 `algorithms/` 引擎、`services/` 业务层） |
| 数据 | `backend/app/lottery/data/{ssq,dlt}.json`（开奖）+ `/data/lottery/algo_results.db`（跑批结果） |
| 鉴权 | 公开；「运行全部算法 / 刷新数据」需全站操作密码 |
| 外部依赖 | 500 彩票网（历史数据源）；抓取失败回退仓库自带种子数据 |

## 要点

- **彩种**：双色球（6+1，红 1–33 / 蓝 1–16）、大乐透（5+2，前区 1–35 / 后区 1–12）。
- **算法引擎**：每个算法是纯函数 `fn(ctx) -> AlgoOutput`，输出号码打分向量；`AlgoContext` 预计算共享特征，89 个算法按 `REGISTRY` 注册并驱动前端「算法广场」。
- **两条结果通道**：实时执行（算法广场，默认只跑 cost ≤ 2 的快算法）与**每日 0:00 定时跑批缓存**（首页 / 智能推荐 / 历史对照消费，不触发实时计算）。
- **回测只读缓存**：`/backtest` 命中缓存才返回，未生成则 503 并提示去算法广场运行全部 —— 绝不在请求里触发 15 分钟计算。
- **操作密码 + 失败递增锁定**由 `app/common/security.py` 统一提供；全量运行用数据库互斥锁防并发，进度跨 worker 轮询。
- ⚠️ 彩票开奖为独立随机事件，所有算法**仅供娱乐与技术演示**，页面底部有理性购彩声明。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/lotteries` | 彩种列表 |
| GET | `/api/v1/{ssq\|dlt}/summary` | 概览统计（最新开奖 / 冷热 / 和值） |
| GET | `/api/v1/{ssq\|dlt}/history?page=&page_size=` | 历史开奖分页，最新在前 |
| GET | `/api/v1/algorithms` | 算法目录（89 算法 + 12 分类） |
| GET | `/api/v1/{ssq\|dlt}/saved-combined` | 每日跑批缓存的等权融合共识号码 |
| POST | `/api/v1/run-all` | 启动双彩种全量运行（需密码，约 5 分钟） |

> 完整 23 条路由见深入阅读。

## 深入阅读

- [实现细节（完整版）](./docs/modules/lottery.md) —— 数据层、算法引擎、防并发设计、API 全表、前端结构
- [架构规范](./docs/architecture.md) · [前端规范](./docs/frontend-standards.md) · [部署运维](./docs/deployment.md)
