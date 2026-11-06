# ⚡ API 用量触发器 🔒 · 到点点亮大模型 5 小时用量窗口

> 密码保护的私有定时任务：配置每日触发时刻，到点由服务器向 OpenAI 兼容 API 发一次最小请求。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/trigger` 🔒 · [在线访问](https://doudoutech.cloud/trigger) |
| 前端 | `frontend/src/trigger/` |
| 后端 | `backend/app/trigger/`（`config` / `store` / `scheduler` / `router`） |
| 数据 | `/data/lottery/trigger.db`（任务 / 执行历史 / 租约）+ `/data/lottery/auth.db`（操作密码哈希） |
| 鉴权 | 全站操作密码（cookie `trigger_session`，12h）；api-key 明文存库、界面只回脱敏尾 4 位 |
| 外部依赖 | OpenAI 兼容的大模型 API（`{base_url}/chat/completions`） |

## 要点

- **窗口对表**：触发时刻 = 期望重置时刻 − 5h（如 06:30 触发 → 11:30 重置），请求用自然短句 + 正常 token 数模拟真实 Agent，降低被风控误判概率。
- **防双发**：两个 gunicorn worker 都跑扫描，用 SQLite **原子租约**（带过期）选本分钟派发者；持有者崩溃后租约自动过期，另一 worker 接管。旧 flock 选主方案已废。
- **错过可补**：触发点过后 `GRACE_MINUTES`（默认 30，`LOTTERY_TRIGGER_GRACE_MINUTES` 可覆盖）分钟内自动补发，超出记 `missed`，页面显示「今日错过」并可手动补触发。
- **看门狗**：`_supervisor` 每 20s 巡检循环任务，任务结束或心跳停滞 >180s 自动重启并计数；`/api/trigger/status` 暴露 `alive / last_tick / restarts` —— 静默停摆不再无感。
- **SSRF 防护**：Base URL 必须 https 且为域名，拒绝纯 IP / 回环 / 私网 / 保留段；失败自动重试 2 次、间隔 1 分钟，历史保留 90 天。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/trigger/auth` | 密码校验 → 签发 12h cookie（失败递增锁定） |
| GET | `/api/trigger/tasks` | 任务列表（api-key 脱敏） |
| POST | `/api/trigger/tasks` | 新建任务 |
| POST | `/api/trigger/tasks/{id}/fire` | 手动立即触发（写历史，标记 manual） |
| GET | `/api/trigger/status` | 今日统计 + 下次触发 + 调度器健康 |

## 深入阅读

- [实现细节（完整版）](./docs/modules/trigger.md) —— 决策表、调度可靠性加固、事故复盘、API 全表、验收清单
- [主题时段设计](./docs/theme-schedule.md) · [架构规范](./docs/architecture.md) · [部署运维](./docs/deployment.md)
