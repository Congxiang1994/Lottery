# 🔍 访问管理 🔒 · 全站访问审计与多维聚合

> 记录「谁、什么时候、从哪个 IP / 地区、访问了哪些接口与功能」，支持明细、聚合、图表与 CSV 导出。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/access` 🔒 · [在线访问](https://doudoutech.cloud/access) |
| 前端 | `frontend/src/access/` |
| 后端 | `backend/app/access/`（`config` / `geo` / `ip2region` / `middleware` / `store` / `router`） |
| 数据 | `/data/lottery/access.db`（明细 / IP 档案 / 访客档案）+ `/data/lottery/geo/`（ip2region 离线库） |
| 鉴权 | 全站操作密码（cookie `access_session`）；页面埋点 `/api/access/page` 公开 |
| 外部依赖 | ip2region 离线库（由 `tools/geo_update.py` 下载，不进仓库） |

## 要点

- **采集在应用层**：FastAPI 中间件记接口维度 + 前端埋点记页面维度 —— Cloudflare Tunnel 下 nginx 只看到 `127.0.0.1`，且 SPA 路由无法区分功能页，所以不能用 nginx 日志。
- **双维度聚合**：单看 IP 会把移动网络出口漂移的一个人算成十几个人；前端持久 UUID 同步进 cookie（`lottery_vid`），服务端加盐哈希后可按访客归并。
- **中间件极薄 + 队列批量写入**：采集只做字符串处理，落库由后台线程攒批（200 条 / 1 秒），队列超限丢弃最旧并计数 —— 中间件永不成为业务瓶颈。
- **隐私护栏**：cookie 只记录「带了哪个名字」不记值；query 里的 `key/token/password` 等值一律脱敏；api-key 不进日志。
- **SPA 回退防探测**：nginx `@spa` 与 `main.py` 的 `spa_fallback` 是同一规则两份实现，「像文件」的路径（带扩展名 / 含点段）不做回退直接 404，避免扫描被记成 200 命中。
- ⚠️ 非公网 IP 判定用显式网段表，**不要用 `ipaddress.is_private`**（含保留段语义差异）。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/access/auth` | 密码校验 → 签发 cookie |
| POST | `/api/access/page` | 前端页面埋点（公开） |
| GET | `/api/access/summary?days=` | KPI + P50/P95 + 离线库状态 |
| GET | `/api/access/timeseries?metric=` | 折线数据（自动补零） |
| GET | `/api/access/ips` / `/api/access/visitors` | IP / 访客双维度聚合 |
| GET | `/api/access/export.csv` | 明细 CSV 导出 |

> 全部 20+ 条查询与维护接口见深入阅读。

## 深入阅读

- [实现细节（完整版）](./docs/modules/access.md) —— 数据流、地区解析、nginx 配置、接口文档、数据模型、运维命令
- [设计文档](./docs/access-management-design.md) · [架构规范](./docs/architecture.md) · [部署运维](./docs/deployment.md)
