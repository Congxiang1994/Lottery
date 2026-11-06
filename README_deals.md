# 💰 捡漏（Deals）· 自动盯「什么值得买」的真漏信号

> 只抓列表页、按**折扣深度 + 信号标签**筛出数码垂类的真漏，点卡片直达原站下单页。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/deals`（列表）· `/deals-admin` 🔒（设置）· [在线访问](https://doudoutech.cloud/deals) |
| 前端 | `frontend/src/deals/` |
| 后端 | `backend/app/smzdm/`（`config` / `crawler` / `store` / `credentials` / `scheduler` / `router`） |
| 数据 | `/data/lottery/smzdm.db`（好价 / 配置 / 抓取日志） |
| 鉴权 | 列表公开；设置为全站操作密码（cookie `deals_session`） |
| 外部依赖 | 什么值得买（smzdm.com，标签流 / 首页 / 排行榜） |

## 要点

- **数据源**：4 个标签流（手慢无 / 绝对值 / 历史低价 / 多重优惠叠加）× 2 页为主力，首页推荐流 1 页兜底，排行榜每 3 轮一次；精选流默认关闭（实测是全量爆料流水，0 条能过）。**不抓详情页**。
- **判据**：折扣率是唯一与曝光无关的客观信号 —— 刚发布 10 分钟的真漏没有投票，但有折扣。第一轮用「值友认可度」上线后只捞到常规促销，第二轮改为折扣优先 + 信号标签（T1 真漏 / T2 补贴）。
- **反爬守卫**：进程内令牌桶（请求间 ≥3 秒），命中验证码退避 30 分钟；`robots.txt` 禁止带 `?` 的 URL，全部用纯路径；UA 用真实浏览器。
- **多 worker**：文件 flock（非阻塞）抢本轮执行权，抢不到就跳过；每 10 分钟一轮，日请求约 1440 次。
- **列表页硬过滤**：SQL 只返回 `picked=1`，未入选的永不出现在公开页；抓取健康度在 `/deals-admin` 可见。
- ⚠️ 站点分类名会变：白名单里的分类若近 7 天（≥400 条样本）从未出现，会在状态里告警提示「分类名可能已改」。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/deals/list?hours=&cate=&q=` | 入选好价列表（按价值分降序） |
| GET | `/api/deals/stats` | 今日新增 / 命中 / 累计 / 最近一轮 |
| GET | `/api/deals/admin/status` | 调度健康 + 统计 + 最近轮次（需密码） |
| PUT | `/api/deals/admin/config` | 改品类白名单 / 抓取开关（需密码） |
| POST | `/api/deals/admin/fetch` | 手动触发一轮抓取（需密码） |

## 深入阅读

- [实现细节（完整版）](./docs/modules/deals.md) —— 七入口实测、判定链、解析坑、API 全表、运维、已知限制
- [数码垂类判据规格](./docs/deals-digital-spec.md) · [选品调研实测](./docs/deals-sourcing-research.md) · [架构规范](./docs/architecture.md)
