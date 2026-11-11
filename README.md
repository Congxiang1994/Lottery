# Lottery · 产品矩阵

[![Website](https://img.shields.io/badge/Website-doudoutech.cloud-blue)](https://doudoutech.cloud/) [![GitHub](https://img.shields.io/badge/GitHub-Lottery-black)](https://github.com/Congxiang1994/Lottery)

🌐 **在线访问**：<https://doudoutech.cloud/> · ⭐ [GitHub](https://github.com/Congxiang1994/Lottery)

> **一个聚合型家庭站点**：单仓库托管多个独立产品 —— React SPA 聚合门户 + FastAPI 后端按功能域拆分，
> Cloudflare Tunnel 免备案上线，systemd 管进程、无 Docker。新功能直接在本仓库新增模块。

**技术栈**：React 18 · TypeScript · Vite · TailwindCSS · FastAPI · Python 3.14 · SQLite(WAL) · Nginx · Cloudflare Tunnel · systemd

---

## 产品矩阵

| 产品 | 一句话 | 门牌文档 |
|---|---|---|
| 🎲 **Lottery 彩票数据站** `/lottery` | 双色球 / 大乐透全量统计、**89 算法 / 12 分类**驱动的算法广场与智能推荐 | [README_lottery.md](./README_lottery.md) |
| 🖍 **汉字是画出来的** `/hanzi` | 108 节动画课点播：检索、竖屏友好、全屏播放器（±5s / 上下集） | [README_hanzi.md](./README_hanzi.md) |
| 🎵 **Super Simple Songs 儿歌** `/babysong` | 518 首英文儿歌，B 站 / YouTube / 本地视频三通道播放 | [README_babysong.md](./README_babysong.md) |
| 📖 **每日儿童睡前故事** `/story` | 按日期倒序阅读 + 密码管理页 + `X-API-Key` 对外写入接口 | [README_story.md](./README_story.md) |
| 💰 **捡漏** `/deals` | 自动盯「什么值得买」标签流，按折扣深度筛数码垂类真漏 | [README_deals.md](./README_deals.md) |
| 🛠 **实用小工具** `/tools` | 时间戳转换、JSON 格式化、Markdown 预览（含 \n 转义还原）、随手画板 | 门户内直达 |
| ⚡ **API 用量触发器** `/trigger` 🔒 | 到点自动点亮大模型 **5 小时用量窗口** | [README_trigger.md](./README_trigger.md) |
| 🔍 **访问管理** `/access` 🔒 | 全站访问审计：明细、IP / 访客聚合、地区解析、图表与 CSV 导出 | [README_access.md](./README_access.md) |
| 📥 **小鹅通下载器** | 视频课程批量下载（108 节动画课实测 108/108 成功，命令行工具） | [tools/xiaoe-downloader/README.md](./tools/xiaoe-downloader/README.md) |

> 🔒 = 密码保护的私有功能（全站同一把操作密码）。管理入口：`/story-admin`、`/babysong-admin`、`/deals-admin`。

**数字一览**：11 个入口（6 公开 + 5 私有）· 89 算法 / 12 分类 · 518 首儿歌 · 108 节汉字课 · 2 彩种

---

## 快速开始

### 本地开发

```bash
# 后端（Python 3.14.5，与服务器严格一致）
cd backend && python3.14 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端（Node 22+，另开终端）
cd frontend && npm ci && npm run dev
```

常用自检（**改完代码必跑**）：

```bash
cd backend && .venv/bin/python scripts/audit_style.py && .venv/bin/python scripts/selftest.py
cd frontend && node scripts/audit-ui.mjs && npx tsc --noEmit && npm run build
```

### 部署上线

```bash
cd frontend && npm run build && cd ..     # 生成 dist/
rsync -az --exclude node_modules --exclude .venv --exclude 'app/lottery/data' \
  --exclude '.git' --exclude '.geo' ./ ubuntu@<IP>:/opt/lottery/
sudo systemctl restart lottery            # 后端改动时
```

> ⚠️ 落位后先 `chmod 644` 新增 `.py`（tar 会保留本地 0600，导致 worker 起不来），
> 完整流程与运维命令见 **[docs/deployment.md](./docs/deployment.md)**。

---

## 文档导航

三层嵌套：**本页（总览）→ 各模块 README（门牌）→ docs/（完整细节）**。
风格标准见 [docs/README-standard.md](./docs/README-standard.md)。

### 架构与规范

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | **架构设计**：请求链路、后端分层（common + 功能域）、建表迁移、鉴权三件套、新增功能三步 + 自检清单 |
| [docs/frontend-standards.md](./docs/frontend-standards.md) | **前端规范**：页面骨架、三态、请求、密码门、弹窗、交互基线、色板与暗色映射 |
| [docs/deployment.md](./docs/deployment.md) | **部署运维**：四目录落位、数据目录约定、服务与定时任务、常见坑 |
| [docs/README-standard.md](./docs/README-standard.md) | README 编写规范与分层模板 |

### 模块完整实现细节

| 模块 | 深入阅读 | 设计稿 / 实测报告 |
|---|---|---|
| 彩票 | [docs/modules/lottery.md](./docs/modules/lottery.md) | — |
| 汉字课 | [docs/modules/hanzi.md](./docs/modules/hanzi.md) | — |
| 儿歌 | [docs/modules/babysong.md](./docs/modules/babysong.md) | — |
| 睡前故事 | [docs/modules/story.md](./docs/modules/story.md) | [功能设计](./docs/story-feature-design.md) · [UI 评审](./docs/story-ui-review.md) |
| 捡漏 | [docs/modules/deals.md](./docs/modules/deals.md) | [数码判据规格](./docs/deals-digital-spec.md) · [选品调研](./docs/deals-sourcing-research.md) |
| 触发器 | [docs/modules/trigger.md](./docs/modules/trigger.md) | [主题时段](./docs/theme-schedule.md) |
| 访问管理 | [docs/modules/access.md](./docs/modules/access.md) | [设计文档](./docs/access-management-design.md) |
| 小鹅通下载器 | [docs/modules/xiaoe-downloader.md](./docs/modules/xiaoe-downloader.md) | — |
| 全站主题 | [主题过渡](./docs/theme-transition.md) | — |
