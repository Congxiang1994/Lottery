# 架构设计 · 整体技术框架

> 本文讲**全站架构**：请求链路、技术栈、目录结构、**新增功能的标准做法**。
> 产品功能见 [README.md](../README.md) 与各模块分册；部署上线见 [deployment.md](./deployment.md)；
> 前端样式/交互规范见 [frontend-standards.md](./frontend-standards.md)。

## 请求链路

```
┌──────────────┐   HTTPS (Cloudflare Tunnel, 免备案)   ┌──────────────────────────────┐
│  浏览器 / 用户 │ ───────────────────────────────────▶ │  Nginx :8081 (静态 SPA + 反代) │
└──────────────┘                                       └──────────────┬───────────────┘
                                                                     │ /api  →  127.0.0.1:8000
                                                       ┌─────────────┴──────────────┐
                                                       │  FastAPI (gunicorn 2 worker) │
                                                       │  ├─ lottery 域  (/api/v1)    │
                                                       │  │    ├─ 算法引擎（89 算法）   │
                                                       │  │    └─ 统计/玄学/数据服务    │
                                                       │  ├─ hanzi 域   (/api/hanzi)  │
                                                       │  ├─ babysong 域 (/api/babysong)│
                                                       │  ├─ story 域  (/api/story)   │
                                                       │  ├─ trigger 域 (/api/trigger)│
                                                       │  ├─ deals 域  (/api/deals)   │
                                                       │  ├─ stats 域  (/api/stats)   │
                                                       │  ├─ access 中间件+域 (/api/access)│
                                                       │  └─ SQLite: /data/lottery/   │
                                                       └──────────────────────────────┘
                                                       /hanzi/*.mp4   →  Nginx alias /data/hanzi/
                                                       /song/*.mp4    →  Nginx alias /data/song/
                                                       /song-covers/* →  Nginx 静态（儿歌封面）
```

- **前端**：React 18 + Vite + TailwindCSS + Recharts。单 SPA，首屏是聚合门户，各功能一个路由模块（`src/<domain>/`）。
- **后端**：FastAPI（纯 CPU 推理，numpy + scikit-learn，不依赖 torch/GPU）。按功能域拆包：
  `app/common/`（跨域共享）+ `app/<domain>/`（自包含）。
- **数据**：开奖数据由爬虫落盘 JSON 缓存；各域持久化在 `/data/lottery/*.db`（独立于部署目录，重部署不丢）。
- **大文件静态服务**：视频、封面一律交给 Nginx `alias` + Range，FastAPI 不经手字节流。
- **域名访问**：国内云未备案域名 80/443 被拦截，用 **Cloudflare Tunnel** 穿透。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18.3.1 + React Router 6.26 + TypeScript 5.5 |
| 前端构建 | Vite 5.4 + TailwindCSS 3.4 + Recharts 2.12（本地 Node 构建，服务器不装 Node） |
| 后端 | Python 3.14.5 + FastAPI 0.141 + gunicorn 26（2 worker）+ uvicorn |
| 算法/数据 | numpy 2.5 / scikit-learn 1.9 / scipy；SQLite（标准库 sqlite3，WAL） |
| 网关 | Nginx 1.24（:8081）+ cloudflared Tunnel |
| 进程管理 | systemd（`lottery.service` + `lottery-algos.timer` + `babysong-bili.timer`） |

---

## 后端分层（标准架构）

```
backend/app/
├── main.py                  # 唯一入口：lifespan（建表/起后台任务）+ include_router + SPA 回退
├── common/                  # ★ 跨域基础设施，任何新功能都从这里取能力
│   ├── paths.py             #   持久化路径唯一真源：DB_DIR / db_path("xxx") / geo_dir()
│   ├── db.py                #   get_conn（WAL 连接）+ init_lock / init_schema（flock 建表）
│   ├── admin.py             #   管理会话：login / require / session_state / logout（签名 cookie）
│   ├── security.py          #   操作密码校验 + 防爆破递增锁定（全站唯一实现）
│   └── password.py          #   密码哈希存储（scrypt，兼容历史 SHA-256）
├── <domain>/                # 功能域（自包含，域间不互相 import 业务代码）
│   ├── __init__.py          #   域说明（边界、挂载点）
│   ├── config.py            #   域内常量：库路径、TTL、字段上限、阈值、词表
│   ├── router.py            #   只有 HTTP 边界：参数校验 + 调 service + 返回
│   ├── store.py             #   SQLite 读写（可选；无持久化的域不要建文件）
│   ├── scheduler.py         #   后台循环（可选；必须多 worker 安全）
│   └── services/            #   纯业务逻辑（可选；lottery 用）
├── lottery/  hanzi/  babysong/  story/  trigger/  smzdm/  stats/  access/
└── scripts/                 # 爬取 / 定时跑批脚本（不进 FastAPI 进程）
```

### 三条硬性分层规则

1. **`app.common` 不许 import 任何 `app.<domain>`。**
   历史反转案例：会话签名曾住在 `trigger.config`、密码流控曾住在 `lottery.services.results_store`，
   导致另外 5 个域反向依赖这两个业务域。现在两者都在 `common/`。
2. **功能域之间不互相 import 业务代码。** 需要共享的，上移到 `common/`。
   （唯一的例外是 `access` 的中间件 —— 它本来就是横切关注点，注册在 `main.py` 最外层。）
3. **`router.py` 只做 HTTP 边界。** 参数校验、状态码、异常翻译在这一层；SQL 在 `store.py`；
   纯计算在 `services/`。不要出现「路由函数里写 20 行 SQL」。

### 建表与迁移（统一入口，别自己撸 flock）

```python
from app.common.db import init_schema
from app.common.paths import db_path

DB_PATH = db_path("mydomain")          # → /data/lottery/mydomain.db（LOTTERY_DB_DIR 可覆盖）

SCHEMA = """
CREATE TABLE IF NOT EXISTS my_items (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    title   TEXT NOT NULL,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

#: 兼容旧库的补列 DDL。单条失败 = 列已存在，自动跳过。
#: 🔴 依赖新列的 CREATE INDEX 一律放这里，**不能**写进 SCHEMA。
MIGRATIONS = (
    "ALTER TABLE my_items ADD COLUMN note TEXT NOT NULL DEFAULT ''",
)

def init() -> None:
    init_schema(DB_PATH, SCHEMA, migrations=MIGRATIONS)
```

三条被线上事故验证过的规则：

- **必须在 `lifespan` 里调用 `init()`。** gunicorn `-w 2` 下两个 worker 同时建库，
  没有 flock 时其中一个必抛 `database is locked`，启动钩子异常 → 整个 master 退出。
  `init_schema` 已内置锁，前提是**用它**而不是自己 `executescript`。
- **依赖新列的索引不能写进 `SCHEMA`。** 旧库上 `CREATE TABLE IF NOT EXISTS` 不会补列，
  紧接着建索引就抛 `no such column` → 启动失败（线上全站 502，2026-11-06 踩过）。
- **一次性数据迁移要抢标记行**（`INSERT OR IGNORE ... rowcount == 1`），否则两个 worker 各扫一遍全表。

### 私有功能的鉴权（统一三件套）

```python
# app/<domain>/config.py
COOKIE_NAME = "mydomain_session"
SESSION_TTL_SECONDS = 12 * 3600

# app/<domain>/router.py
from app.common import admin

_require_session = admin.require          # 401 文案全站一致

@router.post("/admin/auth")
def admin_auth(payload: dict, response: Response):
    return admin.login(payload, response, COOKIE_NAME, SESSION_TTL_SECONDS)

@router.get("/admin/session")
def admin_session(mydomain_session: str | None = Cookie(default=None)):
    return admin.session_state(mydomain_session)

@router.post("/admin/logout")
def admin_logout(response: Response):
    return admin.logout(response, COOKIE_NAME)
```

- 所有私有域**共用同一把操作密码、同一把签名密钥**（`<DB_DIR>/trigger_session_secret`），
  但 **cookie 名各自独立** —— 单独退出某个功能不影响其它功能。
- 密码校验自带防爆破：连续失败 5 次后按 30s→60s→120s→300s→900s 递增锁定，期间返回 429。
- 密钥永不进源码：`app.common.password`（scrypt）存库，首次由 `LOTTERY_RUN_PASSWORD` 环境变量引导。

### 后台任务（进程内循环）规范

- 启动入口统一 `def start()`，由 `main.py` 的 `lifespan` 调用；`async def stop()` 负责优雅退出。
- **多 worker 必须互斥**：用 SQLite 租约（推荐，崩溃自愈）或文件 flock（非阻塞），
  绝不允许两个 worker 各跑一份导致重复执行。
- 必须有**看门狗**（巡检循环任务存活 + 心跳时间戳）和**补发窗口**（错过的时间点可补），
  并把 `alive / last_tick / restarts` 暴露到状态接口 —— 静默停摆是最难查的故障。

### API 约定

| 约定 | 说明 |
|---|---|
| 前缀 | `/api/<domain>`（lottery 历史原因是 `/api/v1`） |
| 错误体 | FastAPI 默认 `{"detail": "中文说明"}`，**前端直接展示 detail**，不要塞英文堆栈 |
| 状态码 | 400 参数错 / 401 未认证 / 404 不存在 / 409 冲突或已在运行 / 422 校验失败 / 429 锁定中 / 503 数据未就绪 |
| 密码保护 | 写操作走 `admin.login` 的会话 cookie；一次性运维接口可收 `{password}` 现验 |
| 公开/私有 | 公开读接口在 SQL 层硬过滤（如 `published=1`、`picked=1`），不靠前端藏 |

---

## 前端分层（标准架构）

```
frontend/src/
├── App.tsx                  # 路由表（lazy）+ 主题/彩票上下文 + 页面入场
├── index.css               # 设计 token、交互基线、夜间映射、动画
├── common/                 # ★ 全站基础设施，新页面一律复用
│   ├── http.ts             #   ApiError + request/createApi/query（唯一请求出口）
│   ├── State.tsx           #   Loading / Empty / ErrorBlock / RouteFallback / errText
│   ├── PageHeader.tsx      #   三档页面头部 + PrivateBadge
│   ├── AdminGate.tsx       #   密码门 + 会话探测 + 401 回门（所有私有页）
│   ├── AppModal.tsx        #   弹窗壳 + ConfirmDialog（遮罩/层级/滚动/Esc）
│   ├── Modal.tsx           #   Portal + ExitPresence（出场动画）
│   ├── useModalHistory.ts  #   浏览器返回键只关弹窗
│   ├── useTheme.ts         #   亮/暗两档
│   └── visitor.ts / usePageTrack.ts / useVisitCount.ts   # 访问统计
├── portal/                 # 聚合门户（APPS 数组即产品清单）
└── <domain>/               # 功能域：页面 + api.ts + 组件内聚
```

### 新增功能 URL 一致性（别自己发明写法）

| 用途 | 写法 |
|---|---|
| 请求 | `createApi("/api/<domain>")` → `.get(name, query)` / `.post` / `.put` / `.del` |
| 错误提示 | `errText(e)`，或直接 `<ErrorBlock message={...} onRetry={...} />` |
| 加载态 | `<Loading />`（不要手写 `Loader2 + 加载中…`） |
| 空态 | `<Empty text hint />`（必须能给就给出「为什么空」） |
| 私有页 | `<AdminGate title subtitle desc probe login logout accent>` |
| 页面标题 | `<PageHeader size="hero\|page\|compact" title icon actions>` |
| 弹窗 | `<AppModal>` / `<ConfirmDialog>`，不要手写 `anim-overlay` + `anim-panel` |
| 入场动画 | 路由容器已统一 `anim-page-in`，页面内不要自己再加整页 fade |

细节与反例见 [frontend-standards.md](./frontend-standards.md)。

---

## 仓库目录结构

```
.
├── backend/                 # FastAPI 后端（按功能域拆分模块）
│   ├── app/
│   │   ├── main.py
│   │   ├── common/          # 公共基础设施（见上）
│   │   ├── lottery/         # 彩票数据服务（/api/v1）
│   │   ├── hanzi/           # 汉字课视频列表（/api/hanzi）
│   │   ├── babysong/        # 儿歌列表 + 本地下载管理（/api/babysong）
│   │   ├── story/           # 睡前故事（/api/story，含对外 API）
│   │   ├── trigger/         # API 用量触发器（/api/trigger）
│   │   ├── smzdm/           # 捡漏（/api/deals）
│   │   ├── stats/           # 访问统计（/api/stats）
│   │   └── access/          # 访问审计（中间件 + /api/access）
│   ├── scripts/             # 爬取 / 定时跑批脚本
│   └── requirements.txt
├── frontend/                # React 前端（单 SPA，与后端功能域一一对应）
│   ├── src/common/          # 公共 UI 与 hooks
│   ├── src/portal/          # 聚合门户
│   └── src/<domain>/        # 各功能域页面 + api.ts
├── tools/                   # 无前端页面的工具脚本
├── deploy/                  # install.sh / nginx.conf / *.service / *.timer
└── docs/                    # 设计文档（本文 + 部署 + 前端规范 + 各功能设计稿）
```

> 视频文件不在仓库内：`/data/hanzi/`、`/data/song/` 独立于部署目录，rsync 重部署不会触碰。

---

## 扩展新功能：三步 + 自检清单

### 1) 后端（纯前端功能可跳过）

- [ ] `backend/app/<feature>/__init__.py` 写清**域边界**（读写哪些表、碰不碰外部站点）
- [ ] `config.py` 放常量；路径用 `app.common.paths.db_path("xxx")`，**不要**再读 `LOTTERY_DB_DIR`
- [ ] `store.py` 有库就建：`init_schema(DB_PATH, SCHEMA, migrations=...)`，在 `lifespan` 里 `init()`
- [ ] 私有功能用 `app.common.admin` 三件套（不需要自己签 cookie）
- [ ] `main.py` 里 `app.include_router(<feature>_router.router)`
- [ ] 后台任务放 `scheduler.py`，`start()` 在 lifespan 调用，多 worker 有互斥 + 看门狗
- [ ] 需要新固定服务/端口时才在 `deploy/` 加 unit（重跑 `install.sh` 会自动注册）

### 2) 前端

- [ ] `frontend/src/<feature>/` 建页面 + `api.ts`（`createApi("/api/<feature>")`）
- [ ] `App.tsx` 加 `<Route>`，**一律 `React.lazy`**（Portal 与 Deals 例外，见文件内注释）
- [ ] `Portal.tsx` 的 `APPS` 追加一项（`status: "live"`；`private: true` 归入私有区）
- [ ] `Nav.tsx` 的 `useNavLinks` 加 `startsWith("/<feature>")` → 独立产品只留「首页」入口
- [ ] 私有页用 `<AdminGate>`；标题用 `<PageHeader>` 并在 `access/config.py` 的
      `PAGE_FEATURES` / `API_FEATURES` / `FEATURE_LABELS` / `PRIVATE_PREFIXES` 补映射
- [ ] 新增语义色 / 半透明底色要回 `index.css` 的 `.site-night` 段补暗色映射（白名单式）

### 3) 部署

本地 `cd frontend && npm run build` → 同步 → `sudo systemctl restart lottery`。
详见 [deployment.md](./deployment.md)。

> 设计约定：**单 SPA + 单 FastAPI 应用**即可承载多数模块；只有某模块需要独立进程/端口时，
> 才单独起服务并在 `deploy/` 放 unit、在 `nginx.conf` 加 `location /api/<feature>/` 反代。
> 大文件静态资源一律交给 Nginx（`alias` + Range），不要让 FastAPI 经手。
