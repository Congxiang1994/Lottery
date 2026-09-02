# Lottery · 产品矩阵（Product Matrix）

[![Website](https://img.shields.io/badge/Website-doudoutech.cloud-blue)](https://doudoutech.cloud/) [![GitHub](https://img.shields.io/badge/GitHub-Lottery-black)](https://github.com/Congxiang1994/Lottery)

🌐 **在线访问**：[https://doudoutech.cloud/](https://doudoutech.cloud/) · ⭐ [GitHub](https://github.com/Congxiang1994/Lottery)

> **这是一个聚合型项目（umbrella repo）。** 用同一套前端聚合门户 + 同一套后端框架，承载多个**独立产品模块**。
> 后续任何新功能都**直接在本仓库内新增模块**即可，无需另开仓库。

---

## 项目定位

| 维度 | 说明 |
|---|---|
| 形态 | 单仓库（monorepo）托管多个产品模块 |
| 前端 | 一个 React SPA。首屏是「产品矩阵」聚合门户（Portal），每个功能是一个路由模块 |
| 后端 | 一个 FastAPI 应用，按**功能域**拆模块（`backend/app/<domain>/`），各域 API 前缀互不冲突 |
| 部署 | Nginx 静态托管 SPA + 反代 API；通过 **Cloudflare Tunnel** 实现 HTTPS 域名访问（**免 ICP 备案**） |
| 容器 | **无 Docker**，纯 systemd 管理 |

---

## 功能与工具列表

### 🖍 汉字是画出来的（`/hanzi`）· 在线产品

《汉字是画出来的》**108 节动画课点播页**：按汉字名模糊检索、手机竖屏友好的卡片列表，
点击卡片即全屏播放，播放器支持 播放/暂停、快进/后退 5s、上一集/下一集、进度条拖动，
控制条自动隐藏。视频由 Nginx 直接文件服务（支持 Range 拖动）。

📖 实现逻辑与技术结构见 **[README_hanzi.md](./README_hanzi.md)**

### 🎵 Super Simple Songs 儿歌（`/babysong`）· 在线产品

**518 首经典英文儿歌列表**：带官方封面与 YouTube 直链，卡片网格展示（序号 + 封面 + 歌名），
点击即跳转到 YouTube 播放。**不下载视频、不内嵌播放器、不接点读**，封面本地托管（国内不被墙）。
前端内置播放进度管理（localStorage，无登录）：已播放打钩 + 完成度进度条、收藏♥、筛选/排序/分页、
「回到上次」、最近播放、进度导出/导入与一键重置。

📖 实现逻辑与技术结构见 **[README_babysong.md](./README_babysong.md)**

### ⚡ API 用量触发器（`/trigger`）· 在线产品（私有）

**密码保护的私有定时任务**：到点由服务器向大模型 API（OpenAI 兼容格式）发送一次最小请求
（`max_tokens=1`，近乎零消耗），按「**触发时刻 = 窗口重置时刻 − 5 小时**」对表，
点亮 5 小时用量窗口——如 06:30 触发 → 11:30 重置，午休后即享全新满额窗口。

- **密码门**：与彩票「运行全部」同一操作密码，校验通过签发 httpOnly cookie（12h 免重输）
- **任务配置**：多个任务增删改/启停/手动立即触发；错过不补发（页面可手动补窗口），失败自动重试 2 次
- **执行历史**：每次触发记录状态 / HTTP 码 / 耗时 / 重试 / 错误详情，保留 90 天
- **api-key 安全**：仅存服务器 SQLite，界面只显示尾 4 位，任何接口/日志不回显
- **调度**：FastAPI 进程内 asyncio 每分钟对表，flock 文件锁防多 worker 双发，重启自动恢复

📖 实现逻辑与技术结构见 **[README_trigger.md](./README_trigger.md)**

### 🎲 Lottery 彩票数据站（`/lottery`）· 在线产品

支持 **双色球 (SSQ)** 与 **大乐透 (DLT)**，提供历史开奖可视化、号码频率 / 冷热 / 遗漏分析、走势图，
以及由 **89 个推荐算法（12 大分类）**驱动的算法广场、智能推荐与滚动回测。

> ⚠️ **理性购彩声明**：彩票开奖完全随机，任何历史统计与「预测」均不具备科学依据，本平台所有推荐仅供娱乐参考。请量力而行、理性投注，切勿沉迷。未满 18 周岁禁止购彩。

📖 实现逻辑与技术结构见 **[README_lottery.md](./README_lottery.md)**

### 🛠 工具（`tools/`）· 无前端页面

| 工具 | 说明 | 文档 |
|---|---|---|
| `xiaoe-downloader/` | 小鹅通视频课程批量下载器（108 节动画课实测 108/108 成功） | [tools/xiaoe-downloader/README.md](./tools/xiaoe-downloader/README.md) |

---

## 整体技术框架

```
┌──────────────┐   HTTPS (Cloudflare Tunnel, 免备案)   ┌──────────────────────────────┐
│  浏览器 / 用户 │ ───────────────────────────────────▶ │  Nginx :8081 (静态 SPA + 反代) │
└──────────────┘                                       └──────────────┬───────────────┘
                                                                     │ /api  →  127.0.0.1:8000
                                                       ┌─────────────┴──────────────┐
                                                       │  FastAPI (gunicorn 2 worker) │
│  ├─ lottery 域  (/api/v1)     │
│  │    ├─ 算法引擎（89 算法）   │
│  │    └─ 统计/玄学/数据服务    │
│  ├─ hanzi 域   (/api/hanzi)   │
│  │    └─ 视频列表（扫描目录）  │
│  ├─ babysong 域 (/api/babysong)│
│  │    └─ 儿歌列表（读 catalog）│
│  ├─ trigger 域 (/api/trigger) │
│  │    └─ API 用量触发器      │
│  └─ SQLite: /data/lottery/    │
└─────────────────────────────┘
                                                       /hanzi/*.mp4  →  Nginx alias
                                                       /data/hanzi/（视频静态服务，Range）
                                                       /song-covers/* → Nginx 静态（儿歌封面，随 dist 同源）
```

- **前端**：React 18 + Vite + TailwindCSS + Recharts，暗色高端风、响应式、入场动效。单 SPA，首屏聚合门户，各功能一个路由模块（`src/<domain>/`）。
- **后端**：FastAPI（纯 CPU 推理，numpy + scikit-learn，不依赖 torch/GPU）。按功能域拆包：`app/common/`（跨域共享）+ `app/<domain>/`（自包含）。
- **数据**：开奖数据由爬虫落盘 JSON 缓存；算法结果持久化在 `/data/lottery/algo_results.db`（独立于部署目录，重部署不丢）。
- **视频点播**：`/hanzi/` 视频（`/data/hanzi/`，108 个 mp4）由 Nginx `alias` 直接文件服务，天然支持 Range 拖动；列表接口走 FastAPI 扫描目录动态生成。视频目录同样独立于部署目录。
- **域名访问**：国内云未备案域名 80/443 被拦截，用 **Cloudflare Tunnel** 穿透（服务器主动出站 QUIC，边缘按隧道路由回源），对外即 `https://doudoutech.cloud`，自带免费 HTTPS 证书。

### 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18.3.1 + React Router 6.26 + TypeScript 5.5 |
| 前端构建 | Vite 5.4 + TailwindCSS 3.4 + Recharts 2.12（本地 Node 22 构建，服务器不装 Node） |
| 后端 | Python 3.12 + FastAPI 0.141 + gunicorn 26（2 worker）+ uvicorn |
| 算法/数据 | numpy 2.5 / scikit-learn 1.9 / scipy 1.18；SQLite（标准库 sqlite3，WAL） |
| 网关 | Nginx 1.24（:8081）+ cloudflared Tunnel |
| 进程管理 | systemd（`lottery.service` + `lottery-algos.timer` 每日 0:00 跑批） |

### 仓库目录结构

```
.
├── backend/                 # FastAPI 后端（按功能域拆分模块）
│   ├── app/
│   │   ├── main.py          # 入口，include_router 注册各功能域路由
│   │   ├── common/          # 公共基础设施（db.get_conn 等跨域复用工具）
│   │   ├── lottery/         # 彩票数据服务（/api/v1，自包含功能域）
│   │   ├── hanzi/           # 汉字课视频列表（/api/hanzi，自包含功能域）
│   │   ├── babysong/        # 儿歌列表（/api/babysong，自包含功能域，读 catalog.json）
│   │   └── trigger/         # API 用量触发器（/api/trigger，密码保护定时任务）
│   ├── scripts/             # 爬取 / 定时跑批脚本
│   └── requirements.txt
├── frontend/                # React 前端（单 SPA，与后端功能域一一对应）
│   ├── src/common/          # 公共 UI（Nav / Footer）
│   ├── src/portal/          # 聚合门户（产品矩阵首页）
│   ├── src/lottery/         # 彩票站（api/types/context/components/pages）
│   ├── src/hanzi/           # 汉字课点播页（HanziPlayer.tsx）
│   ├── src/babysong/        # 儿歌列表页（BabySong.tsx）
│   ├── src/trigger/         # API 用量触发器（api.ts + Trigger.tsx）
│   └── public/song-covers/  # 儿歌封面（518 张 jpg，随构建产物 dist/song-covers/ 由 Nginx 静态服务）
│   └── dist/                # 生产构建产物（Nginx 托管）
├── tools/                   # 工具类脚本（无前端页面）
│   └── xiaoe-downloader/    # 小鹅通视频课程下载器
└── deploy/                  # 部署相关（install.sh / nginx.conf / *.service / *.timer）
```

> 视频文件不在仓库内：`/data/hanzi/` 独立于部署目录，rsync 重部署不会触碰。
> Nginx 通过 `location /hanzi/ { alias /data/hanzi/; }` 对外提供视频静态服务（见 `deploy/nginx.conf`）。

---

## 文档导航

README 分两层：**根 README 讲「全站」**，**分册讲「各模块实现」**。

| 文档 | 内容 |
|---|---|
| [README.md](./README.md) | 全站定位、功能与工具列表、整体技术框架、部署与扩展规范（本页） |
| [README_lottery.md](./README_lottery.md) | 彩票模块：算法引擎设计、数据流、定时跑批、防并发设计、API 全表 |
| [README_hanzi.md](./README_hanzi.md) | 汉字课点播模块：列表接口、Nginx 视频静态服务、伪全屏播放器设计、安全要点 |
| [README_babysong.md](./README_babysong.md) | 儿歌列表模块：518 首元数据、封面本地托管、前端进度管理（localStorage）、静态资源避坑 |
| [README_trigger.md](./README_trigger.md) | API 用量触发器：需求定稿、密码会话、调度与防双发设计、API 全表、验收清单 |
| [tools/xiaoe-downloader/README.md](./tools/xiaoe-downloader/README.md) | 小鹅通下载器：接口链路、踩坑记录、使用步骤 |

---

## 本地开发

### 后端（Python 3.12+）
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python scripts/fetch_data.py     # 抓取数据
PYTHONPATH=. uvicorn app.main:app --reload     # http://127.0.0.1:8000
```

### 前端（Node 22+）
```bash
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173 （已代理 /api → 8000）
npm run build        # 产物到 frontend/dist
```

---

## 服务器部署（无 Docker）

1. 把**仓库根目录**整体同步到服务器 `/opt/lottery`（前端需先在本地 `npm run build` 生成 `dist/`）：
   ```bash
   # 在本地仓库根执行
   cd frontend && npm run build && cd ..
   rsync -az --exclude node_modules --exclude .venv --exclude 'app/lottery/data' --exclude '.git' \
     ./ user@<IP>:/opt/lottery/
   ```
   > ⚠️ 必须排除 `app/lottery/data`：本地测试会生成历史数据缓存，若同步覆盖会冲掉服务器数据。
   > 生产库已固定在 `/data/lottery/`，与部署目录分离，正常重部署不会清空。

2. 在服务器以 root 执行一键部署：
   ```bash
   sudo bash /opt/lottery/deploy/install.sh
   ```
   脚本会自动：装系统依赖（nginx / python3-venv / ffmpeg 等）→ 建 venv 装包 → 爬取数据 →
   建 `/data/lottery` 持久化目录（首次迁移旧库）→ 配置 Nginx(:8081) →
   注册并启动所有 `deploy/*.service/*.timer`（含未来的新模块服务）→ 开放防火墙。

3. 浏览器访问 [https://doudoutech.cloud/](https://doudoutech.cloud/)。
   （公网经 Cloudflare Tunnel 穿透；服务器本机可直连 `http://<IP>:8081` 调试。）

---

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

### 3) 部署
本地 `cd frontend && npm run build` → `rsync` 同步 → `sudo systemctl restart lottery`（后端改动时）。
新增的后端服务：`sudo systemctl daemon-reload && sudo systemctl enable --now <feature>`。
若新模块涉及**静态文件服务**（如视频/大文件）：在 `deploy/nginx.conf` 加
`location /<prefix>/ { alias /data/<dir>/; }` 并同步生产配置，记得用正则 `location` 屏蔽非目标扩展名。

> 设计约定：**单 SPA + 单 FastAPI 应用**即可承载多数模块；只有当某模块需要独立进程/端口时，
> 才为其单独起服务并在 `deploy/` 放 unit 文件、在 `nginx.conf` 增加对应 `location /api/<feature>/` 反代。
> 大文件静态资源一律交给 Nginx（`alias` + Range），不要让 FastAPI 经手。

---

## 常用运维

```bash
journalctl -u lottery -f              # 后端日志
systemctl restart lottery            # 重启后端
journalctl -u lottery-algos -f       # 每日跑批日志
systemctl start lottery-algos.service  # 手动立即跑批
cd /opt/lottery/backend && .venv/bin/python scripts/fetch_data.py   # 更新开奖数据
curl -s http://127.0.0.1:8000/api/health   # 健康检查
sudo systemctl restart cloudflared    # 重启隧道（改 /etc/cloudflared/config.yml 后）
sudo nginx -t && sudo systemctl reload nginx   # 改 nginx 配置后
```
