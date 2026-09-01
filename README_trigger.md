# API 用量触发器（Trigger）· 需求文档

> 2026-09-01 需求分析定稿。状态：待开发。
> 一句话：在 Lottery 门户加一个密码保护的私有功能，配置每日定时任务，到点由服务器向大模型 API 发一次最小请求，点亮 5 小时用量窗口。

## 1. 背景与目标

大模型 API 按 5 小时滚动窗口计量用量。触发时刻 = 期望重置时刻 − 5h：

- 06:30 触发 → 窗口占用 6:30–11:30 → 11:30 休息结束后开始的是**全新窗口**，下午+晚上满量。
- 工具不理解"窗口"语义，只负责到点发请求；时间随时可改。
- 请求本身近乎零消耗（`max_tokens=1`、一句话 prompt）。

## 2. 已确认的决策

| 项 | 决策 |
|---|---|
| API 协议 | OpenAI 兼容（`POST {base_url}/chat/completions`，`Authorization: Bearer <key>`） |
| api-key 存储 | 服务器 sqlite 明文（文件权限保护）；界面只显示 `sk-****` + 尾 4 位；永不回传全文；更新即整体覆盖 |
| 会话 | 密码校验通过后签发 httpOnly cookie，TTL 12h，期内免重复输密码 |
| 密码 | 与彩票「运行全部」相同：`1qaz!QAZ1`（后端 `VERIFY_PASSWORD` 同源） |
| 任务数量 | 不限，用户自行配置（UI 预填建议 06:30 / 13:30 两条） |
| 调度方式 | FastAPI 进程内 asyncio 循环，每分钟对表；**不用 systemd timer**（任务需随时增删改） |
| 防双发 | gunicorn 2 workers → `flock` 非阻塞文件锁选 leader，仅持锁 worker 跑调度；leader 挂锁自动释放 |
| 错过处理 | 重启/宕机跨过触发点 → 记 `missed`，**不自动补发**；页面提供「立即触发」手动补窗口 |
| 失败重试 | 自动重试 2 次、间隔 1 分钟（2xx 即算成功点亮） |
| 历史保留 | 90 天，过期清理（调度循环内顺手删） |

## 3. 功能范围

### 3.1 入口与密码门
- Portal `APPS` 数组新增入口（status live），路由 `/trigger`。
- 未认证访问 `/trigger` → 前端展示密码门（同算法广场样式）；POST 校验通过 → 种 cookie → 进入功能页。
- 流控：复用 `results_store.verify_password` 的每秒 1 次全局流控。

### 3.2 任务配置页
- 列表展示：名称、触发时刻、base_url（域名脱敏可选）、key 尾 4 位、启用状态、下次触发时间。
- 操作：新建 / 编辑 / 启停 / 删除 / 立即触发。
- 字段：`name`、`time`（HH:MM，CST）、`base_url`、`model`、`api_key`、`enabled`、`note`。
- 周期固定每日（服务器 CST 无夏令时，不做时区选择）。

### 3.3 执行历史页
- 每次触发一行：触发时间、任务名、状态（`success` / `failed` / `missed`）、HTTP 状态码、耗时 ms、重试次数、错误摘要。
- 最近优先，分页或限最近 200 条。
- 顶部状态卡：今日已触发 X/Y、下次触发倒计时。

## 4. 技术方案

### 4.1 后端 `backend/app/trigger/`
```
app/trigger/
  __init__.py
  config.py      # 常量：cookie 名/TTL、DB 路径、重试参数
  store.py       # sqlite 建表 + CRUD（复用 app/common/db.py 连接抽象）
  scheduler.py   # asyncio 循环 + flock leader 选举 + httpx 请求 + 重试 + 历史写入
  router.py      # APIRouter（挂 /api/trigger 前缀）
```

数据表（落 `/data/lottery/` 独立 db 或同库新表，开发时定）：

```sql
trigger_tasks(id, name, time_hhmm, base_url, model, api_key, enabled, note, created_at, updated_at)
trigger_history(id, task_id, fired_at, status, http_code, latency_ms, retries, error, created_at)
```

API（除 auth 外全部校验 cookie 会话，无效 → 401）：

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/trigger/auth` | 密码校验（含流控）→ 种 httpOnly cookie（12h） |
| GET | `/api/trigger/tasks` | 任务列表（key 脱敏） |
| POST | `/api/trigger/tasks` | 新建 |
| PUT | `/api/trigger/tasks/{id}` | 编辑（传 key 则覆盖，不传保留） |
| DELETE | `/api/trigger/tasks/{id}` | 删除 |
| POST | `/api/trigger/tasks/{id}/fire` | 手动立即触发（写历史，标记 manual） |
| GET | `/api/trigger/history` | 执行历史 |
| GET | `/api/trigger/status` | 今日触发统计 + 下次触发时间 |

调度要点：
- `main.py` lifespan 启动 asyncio 任务；每分钟扫描 `enabled` 且 `time_hhmm == 当前 HH:MM` 且今天未触发的任务。
- 幂等：以 `(task_id, date)` 查历史防重复；快速重启场景下若已触发过则跳过。
- 双发兜底：即使 leader 判定异常导致双发，结果只是窗口重新对表，无实际损害。
- 请求模板：`POST {base_url}/chat/completions`，body `{"model": ..., "messages": [{"role":"user","content":"ping"}], "max_tokens": 1}`，超时 30s。
- 日志永不打印 api_key。

### 4.2 前端 `frontend/src/trigger/`
```
frontend/src/trigger/
  api.ts          # fetch 封装（401 → 回密码门）
  Trigger.tsx     # 页面骨架：密码门 / Tab（任务配置 · 执行历史）
  components/     # 任务表单、历史表格、状态卡
```
- 路由 `/trigger` 挂顶级路径（App.tsx）；Portal 入口。
- UI 风格与现有 lottery 页面一致（紧凑、扁平、表格化）。

### 4.3 部署
- nginx / systemd / Cloudflare Tunnel **零改动**。
- 依赖：后端确认 `httpx`（requirements.txt 补充，服务器 `.venv/bin/pip install -r`）。
- 常规 rsync 部署（照 Runbook，排除 data/）+ `systemctl restart lottery`。
- vite `base` 保持绝对路径 `/`（二级路由坑已知）。

## 5. 安全要点
- 所有 trigger 管理接口后端强制会话校验，前端藏页面只是体验不是防线。
- cookie：httpOnly + SameSite=Lax（经 Cloudflare 代理 HTTPS，无需 Secure 以外特殊处理，仍设 Secure）。
- api-key 明文仅存服务器 sqlite（`/data/lottery/` root 权限目录，文件权限保护）；接口/日志/错误信息三处均不回显。
- 密码错误流控 1 次/秒，防爆破。
- 单用户设计，无多租户；不做用户体系。

## 6. 验收清单
- [ ] 输错密码 3 次/秒 → 429；正确密码 → 种 cookie 进入功能页
- [ ] 12h 后访问自动回到密码门
- [ ] 新建 06:30 任务 → 到点服务器发出请求，历史出现 success 行
- [ ] 手动「立即触发」→ 历史立即出现记录
- [ ] 停用任务 → 不再触发；删除任务 → 历史保留
- [ ] key 在列表/详情/接口响应中均为脱敏
- [ ] restart lottery → 调度循环自动恢复，无重复触发
- [ ] 断网模拟失败 → 重试 2 次后记 failed，错误信息可见
