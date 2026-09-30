# 架构设计 · 整体技术框架

> 本文讲**全站架构**：请求链路、技术栈、目录结构、扩展规范。
> 产品功能见 [README.md](../README.md) 与各模块分册；部署上线见 [deployment.md](./deployment.md)。

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
                                                       │  │    └─ 视频列表（扫描目录）   │
                                                       │  ├─ babysong 域 (/api/babysong)│
                                                       │  │    ├─ 儿歌列表 + B 站链接    │
                                                       │  │    └─ 本地下载管理(yt-dlp)   │
                                                       │  ├─ story 域  (/api/story)   │
                                                       │  │    ├─ 公开阅读 + 管理会话    │
                                                       │  │    └─ 对外 API（X-API-Key）  │
                                                       │  ├─ trigger 域 (/api/trigger)│
                                                       │  │    └─ API 用量触发器       │
                                                       │  ├─ access 中间件+域 (/api/access)│
                                                       │  │    └─ 访问审计（中间件采集） │
                                                       │  └─ SQLite: /data/lottery/   │
                                                       └──────────────────────────────┘
                                                       /hanzi/*.mp4   →  Nginx alias /data/hanzi/
                                                       /song/*.mp4    →  Nginx alias /data/song/
                                                       /song-covers/* →  Nginx 静态（儿歌封面，随 dist 同源）
```

- **前端**：React 18 + Vite + TailwindCSS + Recharts，暗色高端风、响应式、入场动效。单 SPA，首屏聚合门户，各功能一个路由模块（`src/<domain>/`）。
- **后端**：FastAPI（纯 CPU 推理，numpy + scikit-learn，不依赖 torch/GPU）。按功能域拆包：`app/common/`（跨域共享）+ `app/<domain>/`（自包含）。
- **数据**：开奖数据由爬虫落盘 JSON 缓存；各域持久化在 `/data/lottery/*.db`（独立于部署目录，重部署不丢）。
- **大文件静态服务**：视频（`/data/hanzi/`、`/data/song/`）、封面一律交给 Nginx `alias` + Range，FastAPI 不经手字节流。
- **域名访问**：国内云未备案域名 80/443 被拦截，用 **Cloudflare Tunnel** 穿透（服务器主动出站 QUIC，边缘按隧道路由回源），对外即 `https://doudoutech.cloud`，自带免费 HTTPS 证书。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18.3.1 + React Router 6.26 + TypeScript 5.5 |
| 前端构建 | Vite 5.4 + TailwindCSS 3.4 + Recharts 2.12（本地 Node 22 构建，服务器不装 Node） |
| 后端 | Python 3.14.5 + FastAPI 0.141 + gunicorn 26（2 worker）+ uvicorn |
| 算法/数据 | numpy 2.5 / scikit-learn 1.9 / scipy 1.18；SQLite（标准库 sqlite3，WAL） |
| 网关 | Nginx 1.24（:8081）+ cloudflared Tunnel |
| 进程管理 | systemd（`lottery.service` + `lottery-algos.timer` 每日 0:00 跑批 + `babysong-bili.timer` 每日刷新 B 站链接） |

## 仓库目录结构

```
.
├── backend/                 # FastAPI 后端（按功能域拆分模块）
│   ├── app/
│   │   ├── main.py          # 入口：include_router 注册各域 + 访问审计中间件 + SPA 回退
│   │   ├── common/          # 公共基础设施（db.get_conn / 密码 / 会话签名等跨域复用）
│   │   ├── lottery/         # 彩票数据服务（/api/v1，自包含功能域）
│   │   ├── hanzi/           # 汉字课视频列表（/api/hanzi，自包含功能域）
│   │   ├── babysong/        # 儿歌列表 + 本地下载管理（/api/babysong）
│   │   ├── story/           # 睡前故事（/api/story，故事库 + API 密钥 + 调用日志）
│   │   ├── trigger/         # API 用量触发器（/api/trigger，密码保护定时任务）
│   │   └── access/          # 访问审计（中间件采集 + /api/access 查询）
│   ├── scripts/             # 爬取 / 定时跑批脚本
│   └── requirements.txt
├── frontend/                # React 前端（单 SPA，与后端功能域一一对应）
│   ├── src/common/          # 公共 UI 与 hooks（Nav / Modal / useTheme 等）
│   ├── src/portal/          # 聚合门户（产品矩阵首页）
│   ├── src/lottery/         # 彩票站（api/types/context/components/pages）
│   ├── src/hanzi/           # 汉字课点播页（HanziPlayer.tsx）
│   ├── src/babysong/        # 儿歌页（BabySong.tsx，含本地下载管理）
│   ├── src/story/           # 睡前故事（Story.tsx / StoryAdmin.tsx / ApiPanel.tsx）
│   ├── src/trigger/         # API 用量触发器（api.ts + Trigger.tsx）
│   ├── src/access/          # 访问管理（Access.tsx + parts.tsx）
│   └── public/song-covers/  # 儿歌封面（518 张 jpg，随 dist 由 Nginx 静态服务）
├── tools/                   # 工具类脚本（无前端页面）
│   ├── xiaoe-downloader/    # 小鹅通视频课程下载器
│   ├── babysong-bili-sync/  # 每日刷新儿歌 B 站 BV 号（gather.py + .timer/.service）
│   └── geo_update.py        # ip2region 离线库下载更新（访问管理用）
├── deploy/                  # 部署相关（install.sh / nginx.conf / *.service / *.timer）
└── docs/                    # 设计文档（本文 + deployment.md + 各功能设计稿）
```

> 视频文件不在仓库内：`/data/hanzi/`、`/data/song/` 独立于部署目录，rsync 重部署不会触碰。
> Nginx 通过 `location /hanzi/ { alias /data/hanzi/; }`、`location /song/ { alias /data/song/; }` 对外提供静态服务（见 `deploy/nginx.conf`）。

## 扩展新功能（开发规范）

新功能**直接放进本仓库**，遵循「前端页面 + 后端 router + 部署服务」三步：

### 1) 新增前端模块

- 按功能域建目录：`frontend/src/<feature>/`（页面 + 组件 + api 内聚，与后端功能域一一对应）
- 纯 UI 基础设施放 `frontend/src/common/`；新增产品页在聚合门户注册
- 注册路由：`frontend/src/App.tsx` 增加 `<Route path="/<feature>" element={<Feature/>} />`
- 上架到聚合门户：`frontend/src/portal/Portal.tsx` 的 `APPS` 数组追加一项
  （`status: "live"` 可点击进入；`"soon"` 为灰度占位卡，用于展示平台扩展性）

### 2) 新增后端模块（可选，纯前端功能可跳过）

- 按功能域建目录：`backend/app/<feature>/`（router/config/services 内聚；跨域共享代码进 `app/common/`）
- 注册：`backend/app/main.py` 里 `app.include_router(<feature>_router, prefix="/api/<feature>")`
- 若需要独立后台任务 / 定时跑批：在 `deploy/` 放 `<feature>.service`（+ 可选 `<feature>.timer`），
  **重跑 `install.sh` 会自动发现并注册**，无需改脚本。
  ⚠️ 例外：`tools/babysong-bili-sync/*.timer` 不在 `deploy/` 下，重装机器需手动
  `systemctl enable --now`（或把它挪进 `deploy/` 交给 install.sh 发现）。
- ⚠️ 新增域的 `init()` 建表**必须加 `flock`**，否则 gunicorn `-w 2` 首启会 `database is locked`
  拖垮整个 master（多个域已踩过，见 `README_story.md` §4.4）

### 3) 部署

本地 `cd frontend && npm run build` → 同步 → `sudo systemctl restart lottery`（后端改动时）。
详见 [deployment.md](./deployment.md)。

> 设计约定：**单 SPA + 单 FastAPI 应用**即可承载多数模块；只有当某模块需要独立进程/端口时，
> 才为其单独起服务并在 `deploy/` 放 unit 文件、在 `nginx.conf` 增加对应 `location /api/<feature>/` 反代。
> 大文件静态资源一律交给 Nginx（`alias` + Range），不要让 FastAPI 经手。
