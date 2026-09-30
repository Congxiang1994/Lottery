# Lottery · 产品矩阵

[![Website](https://img.shields.io/badge/Website-doudoutech.cloud-blue)](https://doudoutech.cloud/) [![GitHub](https://img.shields.io/badge/GitHub-Lottery-black)](https://github.com/Congxiang1994/Lottery)

🌐 **在线访问**：[https://doudoutech.cloud/](https://doudoutech.cloud/) · ⭐ [GitHub](https://github.com/Congxiang1994/Lottery)

> **一个聚合型家庭站点**：单仓库托管多个独立产品模块 —— 一个 React SPA 聚合门户 +
> 一个 FastAPI 后端按功能域拆分，Cloudflare Tunnel 免备案上线，systemd 管进程、无 Docker。
> 新功能直接在本仓库内新增模块，无需另开仓库。

**技术栈**：React 18 · TypeScript · Vite · TailwindCSS · FastAPI · Python 3.14 · SQLite(WAL) · Nginx · Cloudflare Tunnel · systemd

---

## 产品矩阵

| 产品 | 一句话 | 文档 |
|---|---|---|
| 🎲 **Lottery 彩票数据站** `/lottery` | 双色球 / 大乐透历史开奖可视化，**89 个推荐算法（12 大分类）**驱动的算法广场、智能推荐与滚动回测 | [README_lottery.md](./README_lottery.md) |
| 🖍 **汉字是画出来的** `/hanzi` | 《汉字是画出来的》**108 节动画课**在线点播：检索、竖屏友好、全屏播放器（±5s / 上下集 / 进度拖动） | [README_hanzi.md](./README_hanzi.md) |
| 🎵 **Super Simple Songs 儿歌** `/babysong` | **518 首经典英文儿歌**：B 站 / YouTube 双平台播放 + 服务器本地下载（yt-dlp）站内连播，进度/收藏全在浏览器本地 | [README_babysong.md](./README_babysong.md) |
| 📖 **每日儿童睡前故事** `/story` | 按日期倒序的睡前故事页 + 密码保护管理页，对外提供 `X-API-Key` 鉴权的 REST 接口，脚本可直写 | [README_story.md](./README_story.md) |
| ⚡ **API 用量触发器** `/trigger` 🔒 | 密码保护的私有定时任务：到点向大模型 API 发一次最小请求，点亮 **5 小时用量窗口** | [README_trigger.md](./README_trigger.md) |
| 🔍 **访问管理** `/access` 🔒 | 全站访问审计：一行一请求明细、按 IP / 访客双维度聚合、地区解析、图表分析与 CSV 导出 | [README_access.md](./README_access.md) |
| 🛠 **小鹅通下载器** | 视频课程批量下载器（108 节动画课实测 108/108 成功） | [tools/xiaoe-downloader/README.md](./tools/xiaoe-downloader/README.md) |

> 🔒 = 密码保护的私有功能（同一把全站操作密码）。

**数字一览**：6 大功能模块 · 89 算法 / 12 分类 · 518 首儿歌 · 108 节汉字课 · 2 彩种 · 免备案 HTTPS

---

## 快速开始

### 本地开发

```bash
# 后端（Python 3.14.5，与服务器版本严格一致）
cd backend && python3.14 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. uvicorn app.main:app --reload     # http://127.0.0.1:8000

# 前端（Node 22+）
cd frontend && npm install && npm run dev      # http://127.0.0.1:5173（已代理 /api → 8000）
```

### 部署上线

```bash
cd frontend && npm run build && cd ..          # 1) 本地构建前端
rsync -az --exclude node_modules --exclude .venv --exclude 'app/lottery/data' --exclude '.git' \
  ./ user@<IP>:/opt/lottery/                   # 2) 同步到服务器
ssh user@<IP> 'sudo bash /opt/lottery/deploy/install.sh'   # 3) 一键安装（首次）
```

完整流程与运维命令见 **[docs/deployment.md](./docs/deployment.md)**。

---

## 文档导航

README 分两层：**本页讲「全站」**，分册讲「各模块实现」，设计稿在 `docs/`。

| 文档 | 内容 |
|---|---|
| [README.md](./README.md) | 全站定位、产品矩阵、快速开始（本页） |
| [docs/architecture.md](./docs/architecture.md) | **架构设计**：请求链路、技术栈、目录结构、扩展新功能规范 |
| [docs/deployment.md](./docs/deployment.md) | **部署与运维**：上线流程、数据目录约定、常用命令 |
| [README_lottery.md](./README_lottery.md) | 彩票模块：算法引擎设计、数据流、定时跑批、防并发设计、API 全表 |
| [README_hanzi.md](./README_hanzi.md) | 汉字课点播模块：列表接口、Nginx 视频静态服务、伪全屏播放器设计 |
| [README_babysong.md](./README_babysong.md) | 儿歌模块：双平台播放、本地下载管理（yt-dlp）、B 站链接每日刷新、前端进度管理 |
| [README_story.md](./README_story.md) | 睡前故事模块：三条鉴权通道、原子配额计数、对外 API 全表 |
| [README_trigger.md](./README_trigger.md) | API 用量触发器：调度与防双发设计、补发窗口、看门狗自愈、API 全表 |
| [README_access.md](./README_access.md) | 访问管理：中间件采集、双维度聚合、离线地区库、nginx SPA 回退防探测 |
| [tools/xiaoe-downloader/README.md](./tools/xiaoe-downloader/README.md) | 小鹅通下载器：接口链路、踩坑记录、使用步骤 |
| `docs/*.md` | 各功能设计稿（story / access / 主题过渡等） |

---

> ⚠️ **理性购彩声明**：彩票开奖完全随机，任何历史统计与「预测」均不具备科学依据，
> 本平台所有推荐仅供娱乐参考。请量力而行、理性投注，切勿沉迷。未满 18 周岁禁止购彩。
