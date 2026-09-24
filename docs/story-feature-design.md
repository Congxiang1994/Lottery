# 每日儿童睡前故事 · 需求分析与技术设计

> 状态：**已确认并上线（2026-09-24）**。本文是最初的需求分析底稿；
> 落地后的实现文档、API 全表、验收清单见 **[README_story.md](../README_story.md)**。
> 日期：2026-09-24　｜　目标版本：与现有 5 个功能域同一套架构，零新增基础设施

---

## 1. 需求拆解

| # | 需求 | 落点 | 备注 |
|---|---|---|---|
| R1 | 新增公开入口：每日儿童睡前故事，按时间倒序展示 | 前端 `/story` | 展示「已发布」故事 |
| R2 | 新增私有管理入口（密码同其他私有功能） | 前端 `/story-admin` | 复用 `results_store.verify_password` |
| R3 | 管理页 Tab1：故事增删改查 | 表格 + 弹窗表单 | 与 `/trigger` 的任务表一致交互 |
| R4 | 管理页 Tab2：API 管理 | 接口定义 / curl 样例 / 调用次数 / api-key 管理 | 见 §5 |
| R5 | 外部程序可通过 API 增删改查故事 | `/api/story/v1/*` | `X-API-Key` 鉴权 |

**两个入口 + 一个对外 API**，共三条访问通道，鉴权彼此独立（见 §3）。

---

## 2. 复用既有模式（不发明新东西）

| 能力 | 直接复用 | 出处 |
|---|---|---|
| SQLite 连接（WAL / 自动 commit / 0600 硬化） | `app.common.db.get_conn` | `backend/app/common/db.py` |
| 密码校验 + 防爆破（失败递增锁定 30→900s） | `results_store.verify_password` | `backend/app/lottery/services/results_store.py` |
| 会话签名（HMAC，持久化密钥，多 worker 共享） | `trigger.config.sign_session / verify_session` | `backend/app/trigger/config.py` |
| 密码门 UI / Tab / 表格 / 弹窗 / 确认删除 | `Trigger.tsx` 的 `PasswordGate`、`IconBtn`、`ConfirmModal` | `frontend/src/trigger/Trigger.tsx` |
| 私有入口卡片（🔒 私有） | `Portal.tsx` 的 `APPS` 数组 | `frontend/src/portal/Portal.tsx` |
| 独立 cookie 名（同一把密码） | `babysong_session` 的做法 → 新增 `story_session` | `backend/app/babysong/router.py` |
| 累计计数器（一条 UPDATE 自增） | `stats/router.py` 的写法 | `backend/app/stats/router.py` |

**新增文件**：`backend/app/story/{__init__.py, config.py, store.py, router.py, apidoc.py}`、`frontend/src/story/{Story.tsx, StoryAdmin.tsx, api.ts}`、`README_story.md`。
**修改文件**：`backend/app/main.py`（挂 router）、`frontend/src/App.tsx`（2 条路由）、`Portal.tsx`（2 张卡片）、`Nav.tsx`（`startsWith("/story")` 分支）。

---

## 3. 三条鉴权通道

| 通道 | 入口 | 凭据 | 签发/校验 | 权限 |
|---|---|---|---|---|
| A 公开只读 | `/story` | 无 | — | **仅** `published=1` 的故事，只读 |
| B 管理会话 | `/story-admin` | 密码 → cookie | `verify_password` + `sign_session(story_session, 12h, httpOnly, SameSite=Lax, Secure)` | 全量读写 + key 管理 |
| C 外部 API | `/api/story/v1/*` | `X-API-Key` header | sha256 比对（`hmac.compare_digest`） | 故事的增删改查 |

要点：
- 通道 B 的 cookie 名独立（`story_session`），签名密钥与 trigger/babysong 共用同一份 `/data/lottery/trigger_session_secret`，**同一把密码，登录互不影响**。
- 通道 C 与通道 B **完全解耦**：API key 泄露不影响页面密码，页面密码泄露不影响已签发 key（可单独撤销）。
- 不新增 CORS 中间件（外部程序是服务端 curl/脚本调用，不走浏览器同源策略）。若将来要从第三方网页 JS 直调，再单独加白名单。
- 失败响应码约定：`401` 缺 key / key 无效，`403` key 已停用，`429` 超配额或密码被锁。

---

## 4. 数据模型（新建库 `/data/lottery/story.db`）

### 4.1 `stories`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| title | TEXT | NOT NULL | 标题，≤100 字 |
| story_date | TEXT | NOT NULL | `YYYY-MM-DD`，**排序主键**，默认今天 |
| content | TEXT | NOT NULL | 正文，≤8000 字 |
| summary | TEXT | DEFAULT '' | 导语/摘要，列表展示用 |
| tags | TEXT | DEFAULT '' | 逗号分隔标签 |
| audio_url | TEXT | DEFAULT '' | 音频/视频链接（**预留**，本期不做静态托管） |
| cover_url | TEXT | DEFAULT '' | 封面图（预留） |
| published | INTEGER | NOT NULL DEFAULT 0 | 1 已发布 / 0 草稿 |
| source | TEXT | DEFAULT 'manual' | 来源：`manual` 或 `api:<key名>`，便于溯源 |
| created_at / updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | |

索引：`idx_story_date (story_date DESC, id DESC)`、`idx_story_published (published, story_date DESC)`。
排序规则：`ORDER BY story_date DESC, id DESC`（同一天多篇时新写的在前）。

### 4.2 `api_keys`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | 用途备注（如「每日生成脚本」） |
| key_hash | TEXT UNIQUE | **sha256(明文 key)**，不存明文 |
| key_prefix | TEXT | 明文前 8 位，仅用于页面识别（`sk_story_3f9a…`） |
| enabled | INTEGER | 1/0，停用后立即失效 |
| daily_quota | INTEGER | 每日上限，**0 = 不限** |
| total_quota | INTEGER | 累计上限，0 = 不限 |
| calls_total | INTEGER | 累计成功计数 |
| calls_today | INTEGER | 今日计数 |
| today_date | TEXT | `calls_today` 对应的日期（跨日原子重置用） |
| last_used_at | TIMESTAMP | 最后调用时间 |
| last_used_ip | TEXT | 最后调用来源 IP（审计） |
| note | TEXT | 备注 |
| created_at | TIMESTAMP | |

明文 key 格式：`sk_story_` + `secrets.token_hex(32)`（128 bit 熵，41 字符）。
**明文只在创建时的响应里返回一次**，之后页面只显示 `key_prefix + ••••`。

### 4.3 `api_calls`（调用日志，支撑「调用次数管理」）

| 字段 | 说明 |
|---|---|
| id / key_id / key_name | 冗余 key 名，key 删除后日志仍可读 |
| ts | `YYYY-MM-DD HH:MM:SS`，索引 DESC |
| method / path | 如 `POST /api/story/v1/stories` |
| status_code | 200 / 401 / 403 / 429 / 422 / 500 |
| latency_ms | 耗时 |
| ip | 来源 IP |

保留 90 天（与 `HISTORY_KEEP_DAYS` 同口径），在每日清理时顺手删。

---

## 5. API 契约

### 5.1 通道 A · 公开读（前端故事页用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/story/list?limit=20&offset=0&q=&date_from=&date_to=` | 仅 `published=1`，按日期倒序，返回含 `id/title/story_date/summary/tags/audio_url/has_content` |
| GET | `/api/story/{id}` | 单篇全文（仅 `published=1`） |

### 5.2 通道 B · 管理页（cookie）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/story/admin/auth` | 密码 → 签发 cookie |
| GET | `/api/story/admin/session` | 会话是否有效（免重复输密码） |
| POST | `/api/story/admin/logout` | 退出 |
| GET | `/api/story/admin/stories?limit=&offset=&status=` | 全量（含草稿），带全文 |
| POST | `/api/story/admin/stories` | 新建 |
| PUT | `/api/story/admin/stories/{id}` | 编辑 |
| PUT | `/api/story/admin/stories/{id}/published` | 发布/下架 |
| DELETE | `/api/story/admin/stories/{id}` | 删除 |
| GET | `/api/story/admin/keys` | key 列表（含今日/累计调用、配额、最后调用） |
| POST | `/api/story/admin/keys` | 新建 → **仅此响应返回明文 key** |
| PUT | `/api/story/admin/keys/{id}` | 改名/改配额/改备注 |
| PUT | `/api/story/admin/keys/{id}/enabled` | 启停 |
| POST | `/api/story/admin/keys/{id}/reset-calls` | 重置计数（今日清零 / 累计清零） |
| DELETE | `/api/story/admin/keys/{id}` | 删除 key（日志保留） |
| GET | `/api/story/admin/calls?key_id=&limit=50` | 调用日志 |
| GET | `/api/story/admin/api-doc` | **返回接口定义 + curl 样例**（页面直接渲染，杜绝文档漂移） |

### 5.3 通道 C · 外部程序（`X-API-Key`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/story/v1/stories?limit=&offset=&date=&date_from=&date_to=&q=&published=` | 列表（默认只返回已发布；`published=all` 需 key 具备 `read_draft` 权限位，默认无） |
| GET | `/api/story/v1/stories/{id}` | 单篇 |
| POST | `/api/story/v1/stories` | 新建（`published` 默认 `true`，外部写入即上线；可传 `published:false` 存草稿） |
| PUT | `/api/story/v1/stories/{id}` | 全量更新 |
| DELETE | `/api/story/v1/stories/{id}` | 删除 |
| GET | `/api/story/v1/me` | 该 key 的配额与用量自检（`daily_quota / calls_today / calls_total / enabled`） |

请求体（POST/PUT）：

```json
{
  "title": "小熊和月亮",
  "story_date": "2026-09-24",
  "content": "从前有一只小熊……",
  "summary": "关于勇气与告别",
  "tags": "动物,勇气",
  "published": true
}
```

响应：成功 `{"ok": true, "id": 12, ...}`；失败 `{"detail": "..."}` + 对应状态码。

### 5.4 curl 样例（页面展示的原文，host 自动取当前站点）

```bash
# 1) 新建
curl -X POST https://doudoutech.cloud/api/story/v1/stories \
  -H "X-API-Key: $STORY_KEY" -H "Content-Type: application/json" \
  -d '{"title":"小熊和月亮","content":"从前有一只小熊……","story_date":"2026-09-24"}'

# 2) 列表
curl "https://doudoutech.cloud/api/story/v1/stories?limit=10" -H "X-API-Key: $STORY_KEY"

# 3) 单篇
curl https://doudoutech.cloud/api/story/v1/stories/12 -H "X-API-Key: $STORY_KEY"

# 4) 更新
curl -X PUT https://doudoutech.cloud/api/story/v1/stories/12 \
  -H "X-API-Key: $STORY_KEY" -H "Content-Type: application/json" \
  -d '{"title":"小熊和月亮（修订）","content":"……","story_date":"2026-09-24"}'

# 5) 删除
curl -X DELETE https://doudoutech.cloud/api/story/v1/stories/12 -H "X-API-Key: $STORY_KEY"

# 6) 自检用量
curl https://doudoutech.cloud/api/story/v1/me -H "X-API-Key: $STORY_KEY"
```

---

## 6. 调用次数管理（关键实现细节）

**一条 SQL 同时完成「跨日重置 + 配额校验 + 计数自增」**，靠 `rowcount` 判定是否放行：

```sql
UPDATE api_keys
   SET calls_today = CASE WHEN today_date = :today THEN calls_today + 1 ELSE 1 END,
       today_date  = :today,
       calls_total = calls_total + 1,
       last_used_at = :now,
       last_used_ip = :ip
 WHERE id = :id
   AND enabled = 1
   AND (daily_quota = 0 OR today_date <> :today OR calls_today < daily_quota)
   AND (total_quota = 0 OR calls_total < total_quota)
```

- `rowcount == 1` → 放行；`0` → `429 今日调用配额已用尽`。
- 为什么这样写：gunicorn 起 2 个 worker，check-then-act（先查余额再自增）必然超发；SQLite 写锁把 UPDATE 串行化，**单条语句内的判断+自增是原子的**。这与 `trigger_leases` 的原子租约、`record_missed_once` 的单条 INSERT…SELECT 是同一套思路。
- 计数口径：**只统计通过鉴权的调用**（401 无效 key 不计数、不建日志，避免被扫描刷爆日志表）。

页面呈现（Tab2「调用次数管理」区）：
- 汇总卡：Key 总数 / 今日调用合计 / 近 7 日调用
- key 表格列：名称、前缀、今日/累计、配额、最后调用、状态、操作
- 调用日志表（近 50 条，可按 key 过滤）

---

## 7. 前端结构

### 7.1 `/story`（公开页）
- 顶部：标题 + 今日故事（当天 `story_date`，卡片高亮）
- 下方：按日期倒序的卡片流（日期 + 标题 + 摘要 + 标签），点击打开全文弹窗（复用 hanzi 弹窗的遮罩/圆角风格）
- 睡前阅读体验：正文 17–18px、行高 1.9、暖米色底、可选「夜间模式」开关（存 `localStorage`）
- 空态：`还没有故事，去管理页添加第一篇`

### 7.2 `/story-admin`（私有）
- `PasswordGate`（抄 `Trigger.tsx`）→ 未过门只有一个密码输入框
- 顶部：标题 + 刷新 + 退出登录
- Tab1「故事管理」：表格（日期/标题/状态/来源/操作）+ 新建·编辑弹窗 + 删除确认
- Tab2「API 管理」，四块：
  1. **Key 管理**：表格 + 新建（弹窗内**一次性展示明文 key + 复制按钮**）+ 编辑配额 + 启停 + 重置计数 + 删除（确认弹窗）
  2. **接口定义**：表格（方法 / 路径 / 说明 / 参数），数据来自 `/admin/api-doc`
  3. **调用样例**：curl 代码块 + 一键复制（步骤切换）
  4. **调用日志**：近 50 条

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| key 明文落在库/日志/响应 | 只存 sha256；页面只见前 8 位；任何接口不回显明文；不打印 `X-API-Key` header |
| 并发超发（2 worker） | 配额判断与自增合并为单条 UPDATE（§6） |
| 爆破扫描 | key 128 bit 随机，理论不可枚举；401 不计配额不写日志；可选按 IP 失败计数（复用 `security_lock` 递增锁模式） |
| 草稿被公开页看到 | 通道 A / C 默认 SQL 层硬过滤 `published=1` |
| 正文含 HTML/脚本 | 前端纯文本渲染（**禁止 `dangerouslySetInnerHTML`**）；后端限长 8000 字 |
| db 文件权限 | 复用 `get_conn` 的 0600 硬化 + 目录 0700 |
| 计数跨日不准 | `today_date` 与计数同一条 SQL 更新 |
| 前端 `{0 && …}` 渲染出 "0" | 一律写 `{!!x && …}`（项目已踩坑） |
| 内容丢失 | 编辑走全量覆盖，弹窗保存前二次确认；删除仅删单篇、不做批量 |

---

## 9. 待确认项（4 个决策点）· 已定稿

| # | 问题 | 决策 | 落地结果 |
|---|---|---|---|
| D1 | 故事内容形态 | 纯文本正文 + 预留 `audio_url`/`cover_url`（留空） | 按决策实现，两列已入库，管理表单折叠可填 |
| D2 | api-key 存储 | **明文**（用户选择：本功能只用于管理家里的故事，页面需可查看复制） | `api_keys.api_key` 存明文，页面默认打码 + 点眼睛显示 + 一键复制；库 0600 / 目录 0700 |
| D3 | 同一天能否多篇 | 允许，排序 `story_date DESC, id DESC` | 按决策实现 |
| D4 | API 默认配额 | 日 1000、累计不限（0=不限），日志留 90 天 | 按决策实现 |

实现期的一处偏差：原设计写「`published=all` 需 key 具备 `read_draft` 权限位」，
落地时判断多余的复杂度不值得——管理密钥本就能增删改故事，限制它读草稿没有意义，
故 `GET /api/story/v1/stories` 直接支持 `published=true｜false｜all`。

其余按推荐默认值定型：公开页只展示已发布、外部 POST 默认即发布、cookie 12h、不引入 CORS、nginx 无需改动。

---

## 10. 实施记录（2026-09-24 已完成）

1. ✅ 后端：`app/story/{config,store,apidoc,router}.py` + `main.py` 挂载（含 `v1_call_logger` 中间件）
2. ✅ 前端：`story/api.ts` → `Story.tsx` → `ApiAdmin`（`StoryAdmin.tsx` + `ApiPanel.tsx`）→ 路由/门户卡/导航
3. ✅ 本地端到端验证：39 项断言全通过（含 401/403/429/422、草稿不泄露、部分更新、日志与文档端点）
4. ✅ 部署生产 + 线上冒烟：story 三通道 200/401/200；存量 11 个接口全 200；服务零重启
5. ✅ `README_story.md` + 根 README 索引 + 本文档，随代码提交

**部署期新踩的坑**（已修，详见 README_story.md §4.4）：gunicorn `-w 2` 首启时两 worker
同时建库抢 SQLite 独占锁 → `database is locked` → gunicorn 判定 `Worker failed to boot` 整体退出。
`busy_timeout` 对 `PRAGMA journal_mode` 无效，改用 `flock` 把 `init()` 串行化。

