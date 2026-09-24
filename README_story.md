# 每日儿童睡前故事（Story）· 需求与实现文档

> 2026-09-24 需求定稿并实现上线。一句话：门户里加一个**按日期倒序展示的睡前故事页**，
> 外加一个**密码保护的私有管理页**（故事增删改查 + API 密钥管理），
> 让外部脚本能通过 `X-API-Key` 调用接口写入故事。

- 公开页：<https://doudoutech.cloud/story>
- 管理页：<https://doudoutech.cloud/story-admin>（私有，密码同全站操作密码）

---

## 1. 背景与目标

每晚给孩子讲一个故事。故事的产出往往在别处（脚本 / 定时任务 / 手写），
所以除了页面，还需要一条**机器可写的通道**（对外 REST API），
并且这条通道要能限流、可审计、可随时吊销。

| 需求 | 落点 |
|---|---|
| 按时间倒序展示故事 | `/story`（公开只读，仅已发布） |
| 私有管理入口（密码同其他私有功能） | `/story-admin`（Tab1 故事管理 / Tab2 API 管理） |
| 外部程序增删改查 | `/api/story/v1/*`（`X-API-Key` 鉴权） |
| 调用次数管理 | 每条密钥的今日/累计配额 + 调用日志 |

## 2. 已确认的决策

| 项 | 决策 |
|---|---|
| 故事内容形态 | 纯文本正文（保留换行）+ 摘要 / 标签；`audio_url`、`cover_url` 作为**预留字段**（本期不做静态托管） |
| api-key 存储 | **明文**存 SQLite（`/data/lottery/story.db`，库 0600 + 目录 0700）。2026-09-24 用户明确选择：本功能只用于管理家里的故事，页面需可查看/复制方便 |
| 同一天多篇 | 允许。排序 `story_date DESC, id DESC`（同日期新写的在前） |
| 默认配额 | 日 1000 次、累计不限（`0` 表示不限）；调用日志保留 90 天 |
| 密码 / 会话 | 复用全站操作密码（`results_store.verify_password`，含失败递增锁定）；签发 httpOnly cookie `story_session`（12h，签名密钥与 trigger / babysong 共用） |
| 公开页可见范围 | 只有 `published=1`。草稿在 **SQL 层**被过滤，公开通道拿不到 |
| 外部写入默认值 | `POST` 默认 `published=true`（写即上线）；传 `false` 存草稿 |
| CORS | 不加。外部调用是服务端脚本（curl / requests），不走浏览器同源策略 |
| 部署改动面 | nginx / systemd **零改动**（`/api/` 已反代、SPA 路由已回退）；仅新增后端域 + 前端模块 |

## 3. 功能范围

### 3.1 `/story` 公开页
- 「今晚的故事」大卡（`story_date` = 今天时置顶高亮，暖金渐变），其下为按日期倒序的历史列表
- 点击卡片 → 全文弹窗（正文 17px / 行高 1.9 / 保留空行）
- **夜间模式**：整页沉浸（含导航与页脚），状态存 `localStorage`
- 空态：「还没有故事」

### 3.2 `/story-admin` 管理页（私有）
- 密码门 → 两个 Tab
- **Tab1 故事管理**：日期 / 标题 / 状态 / 来源列表；新建 · 编辑（标题、日期、摘要、标签、正文、预留字段、发布开关）；一键发布↔草稿；行内预览；删除确认
- **Tab2 API 管理**：
  1. 调用次数总览（启用密钥数 / 今日调用 / 近 7 日调用）
  2. **密钥管理**：默认打码，点眼睛显示明文，一键复制；启停 / 重置计数 / 编辑配额 / 删除
  3. **接口定义**：端点表 + 参数说明 + 请求体字段 + 状态码约定（数据来自后端 `/admin/api-doc`，避免文档漂移）
  4. **调用样例**：curl（6 个场景可切换）+ Python 示例，**自动带入当前站点域名与已显示的密钥**，一键复制
  5. **调用日志**：近 50 条，可按密钥过滤

## 4. 技术方案

### 4.1 三条鉴权通道（互不干扰）

| 通道 | 入口 | 凭据 | 权限 |
|---|---|---|---|
| A 公开只读 | `/api/story/list`、`/api/story/item/{id}` | 无 | 仅 `published=1` |
| B 管理会话 | `/api/story/admin/*` | 密码 → cookie `story_session` | 全量读写 + 密钥管理 |
| C 外部 API | `/api/story/v1/*` | `X-API-Key` header | 故事增删改查 + `/me` 用量自检 |

API key 泄露不影响页面密码；页面密码泄露也能单独吊销某个 key。

### 4.2 后端 `backend/app/story/`

```
app/story/
  __init__.py
  config.py     # DB 路径、cookie 名/TTL、字段长度上限、密钥前缀、默认配额
  store.py      # 建表 + 故事 CRUD + 密钥 CRUD + 原子配额计数 + 调用日志
  router.py     # APIRouter（/api/story），三条通道 + v1 调用日志中间件
  apidoc.py     # 对外 API 的接口定义与 curl / Python 样例（单一事实来源）
```

数据表（`/data/lottery/story.db`，独立库，重部署不丢）：

```sql
stories   (id, title, story_date, content, summary, tags, audio_url, cover_url,
           published, source, created_at, updated_at)
api_keys  (id, name, api_key, key_prefix, enabled, daily_quota, total_quota,
           calls_total, calls_today, today_date, last_used_at, last_used_ip, note, created_at)
api_calls (id, key_id, key_name, ts, method, path, status_code, latency_ms, ip)
```

- `source`：`manual` 或 `api:<key名>`，便于溯源"这篇是谁写的"
- `key_prefix`：明文前 12 位，用于页面短标识
- `today_date`：`calls_today` 对应的日期，跨日重置用

### 4.3 配额计数：一条 SQL 原子完成

```sql
UPDATE api_keys
   SET calls_today = CASE WHEN today_date = :today THEN calls_today + 1 ELSE 1 END,
       today_date = :today, calls_total = calls_total + 1,
       last_used_at = :now, last_used_ip = :ip
 WHERE id = :id AND enabled = 1
   AND (daily_quota = 0 OR today_date <> :today OR calls_today < daily_quota)
   AND (total_quota = 0 OR calls_total < total_quota)
```

- `rowcount == 1` → 放行；`0` → `429`
- **为什么**：gunicorn 跑 2 个 worker，「先查余额再自增」是 check-then-act，并发必然超发；
  SQLite 写锁把这条 UPDATE 串行化，判断与自增在同一语句内即原子
  （与 `trigger_leases` 原子租约、`record_missed_once` 单条 INSERT…SELECT 同一套思路）
- 口径：**只有通过鉴权的调用才计数**。无效密钥的 401 不计数、也不写日志（防被扫描刷爆日志表）
- 调用明细由 `v1_call_logger` 中间件统一落库，**只匹配 `/api/story/v1/` 前缀**，其他路由零影响

### 4.4 启动建表要加文件锁（踩坑）

gunicorn `-w 2` 时两个 worker 会同时执行 `PRAGMA journal_mode=WAL` + `CREATE TABLE`。
**首次建库**时二者都要独占锁，其中一个必抛 `sqlite3.OperationalError: database is locked`；
启动钩子抛异常 → gunicorn 判定 `Worker failed to boot` → 整个 master 退出。
（2026-09-24 首次上线实测踩到，systemd 靠 restart 才拉起来。）

SQLite 的 `busy_timeout` 对 `PRAGMA journal_mode` **不生效**，因此 `store.init()` 在库文件旁加了一把
`flock` 排他锁，把建表阶段串行化。已在本地用 `-w 2` + 删库的方式复现验证修复有效。

### 4.5 API 全表

公开（无鉴权）：

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/story/list` | 列表，支持 `limit/offset/q/date_from/date_to`，仅已发布 |
| GET | `/api/story/item/{id}` | 单篇全文，仅已发布 |

管理（cookie）：

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/story/admin/auth` | 密码校验 → 签发 cookie |
| GET | `/api/story/admin/session` | 会话有效性（免重复输密码） |
| POST | `/api/story/admin/logout` | 退出 |
| GET/POST | `/api/story/admin/stories` | 列表（含草稿）/ 新建 |
| PUT | `/api/story/admin/stories/{id}` | 部分更新 |
| PUT | `/api/story/admin/stories/{id}/published` | 发布 / 转草稿 |
| DELETE | `/api/story/admin/stories/{id}` | 删除 |
| GET/POST | `/api/story/admin/keys` | 密钥列表（含明文与用量）/ 新建 |
| PUT | `/api/story/admin/keys/{id}` | 改名 / 改配额 / 改备注 |
| PUT | `/api/story/admin/keys/{id}/enabled` | 启停 |
| POST | `/api/story/admin/keys/{id}/reset-calls` | 重置计数（`scope=today｜all`） |
| DELETE | `/api/story/admin/keys/{id}` | 删除密钥（日志保留） |
| GET | `/api/story/admin/calls` | 调用日志（可按 `key_id` 过滤） |
| GET | `/api/story/admin/api-doc` | 接口定义 + 样例 |

对外（`X-API-Key`）：

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/story/v1/stories` | 列表（`published=true｜false｜all`，默认 true） |
| GET | `/api/story/v1/stories/{id}` | 单篇 |
| POST | `/api/story/v1/stories` | 新建（`published` 默认 true） |
| PUT | `/api/story/v1/stories/{id}` | **部分更新**：只覆盖传入的字段 |
| DELETE | `/api/story/v1/stories/{id}` | 删除 |
| GET | `/api/story/v1/me` | 本密钥启用状态与用量自检 |

状态码：`401` 缺/错 key，`403` key 已停用，`404` 故事不存在，`422` 参数非法，`429` 超配额。

### 4.6 前端 `frontend/src/story/`

```
frontend/src/story/
  api.ts          # fetch 封装 + 类型 + 剪贴板降级
  Story.tsx       # 公开页（含夜间模式）
  StoryAdmin.tsx  # 管理页（密码门 + Tab1 故事管理）
  ApiPanel.tsx    # Tab2 API 管理
```

接入点（均为追加，不改既有逻辑）：

- `App.tsx`：`/story`、`/story-admin` 两条路由
- `portal/Portal.tsx`：`APPS` 追加两张卡（管理页 `isPrivate: true` → 🔒 私有）
- `common/Nav.tsx`：`useNavLinks` 增加 `/story` 分支（与 hanzi/trigger/babysong 同样只留首页入口）
- `index.css`：`.story-night` 段（仅夜间模式挂 `<html>` 时生效，不影响其他页面）

## 5. 安全要点

- 明文密钥只存服务器 `story.db`（文件 0600 / 目录 0700，复用 `common/db.py` 的权限硬化）
- 密钥 **不外泄到日志**：接口不回显、中间件不打印 header；页面默认打码，点眼睛才显示
- 密钥 192 bit 熵（`sk_story_` + `token_hex(24)`），不可枚举；无效 key 的尝试不计数不记日志
- 管理接口后端强制会话校验（前端藏页面只是体验，不是防线）
- 公开通道 SQL 层硬过滤 `published=1`，草稿不泄露（已纳入验收用例）
- 正文前端纯文本渲染（不使用 `dangerouslySetInnerHTML`），后端限长 8000 字
- 不引入 CORS 中间件（同源 + 服务端调用）

## 6. 验收清单（2026-09-24 本地实测 39/39 通过）

- [x] 密码错误 401；正确 → 签发 `story_session`；无 cookie 访问管理接口 401
- [x] 公开列表**只含已发布**，草稿不出现在列表、按 id 直取返回 404
- [x] 管理端发布草稿后公开列表数量 +1
- [x] 非法日期 / 空标题 → 422
- [x] 创建密钥返回明文与可识别前缀
- [x] 无 key / 错误 key → 401；正确 key → 200
- [x] `published=false` 过滤出草稿；`all` 返回全部
- [x] v1 新建 → `source=api:<key名>`、默认已发布
- [x] PUT 部分更新：只改传入字段，其余保持原值
- [x] v1 删除 200；重复删除 404
- [x] `/v1/me` 返回用量；日配额 2 的密钥：前两次 200、第三次 429
- [x] 另一密钥不受影响；停用密钥 → 403；重置计数后 `calls_total=0`
- [x] 调用日志含状态码与耗时；汇总统计正确
- [x] `/admin/api-doc` 端点与样例可读（6 个端点 / 6 个 curl 样例）
- [x] 退出登录 200
- [x] **生产**：双 worker 首启无 `database is locked`；story 三通道 200/401/200；存量 11 个接口全 200；`/story`、`/story-admin` SPA 回退 200

## 7. 变更日志

- **2026-09-24**：功能上线。新增 `app/story` 域（故事库 / 密钥库 / 调用日志）、前端 `/story` 与 `/story-admin`、
  门户两张卡片、接口文档页；修复 `-w 2` 首启建库锁冲突（`init()` 加 flock）。
