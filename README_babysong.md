# 🎵 Super Simple Songs 儿歌 · 518 首英文儿歌列表与本地播放

> B 站 / YouTube / 服务器本地视频**三条播放通道**，进度与收藏存浏览器本地。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/babysong`（列表）· `/babysong-admin` 🔒（下载管理）· [在线访问](https://doudoutech.cloud/babysong) |
| 前端 | `frontend/src/babysong/` |
| 后端 | `backend/app/babysong/`（`router.py` 列表 + `downloads.py` 下载队列） |
| 数据 | `backend/app/babysong/data/catalog.json`（518 条元数据）+ `frontend/public/song-covers/`（518 张封面）+ `/data/song/{id}.mp4` |
| 鉴权 | 列表公开；下载管理为全站操作密码（cookie `babysong_session`） |
| 外部依赖 | yt-dlp（本地下载）、mihomo 代理、B 站 / YouTube（跳转播放） |

## 要点

- **三条通道**：B 站（移动端优先 App 深链，失败回退网页）、YouTube（整卡点击跳转）、本地视频（站内弹窗播放器，支持连播与下一首预取）。
- **封面随 dist 同源**：`song-covers/*.jpg` 由 Nginx 静态服务，国内不被墙；本地视频走 `/song/` alias（支持 Range）。
- **下载管理**（私有）：yt-dlp 后台串行下载到 `/data/song/{id}.mp4`，任务状态存 `/data/lottery/babysong_dl.db`，崩溃残留启动时自动清理。
- **B 站 BV 号每日刷新**：`tools/babysong-bili-sync/` 定时校验/找回搬运下架的链接。
- 所有播放进度、收藏、已读状态存 **localStorage**，无登录、单机可用。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/babysong/list` | 儿歌列表（含 `local` 标记与本地总数） |
| GET | `/api/babysong/admin/downloads` | 全部歌曲下载状态（需密码） |
| POST | `/api/babysong/admin/download` | 批量入队下载（需密码） |
| GET | `/song-covers/<id>.jpg` / `/song/<id>.mp4` | 封面 / 本地视频（Nginx 静态） |

> 认证与会话接口（`admin/auth|session|logout`）同全站私有功能三件套，见 [架构规范](./docs/architecture.md)。

## 深入阅读

- [实现细节（完整版）](./docs/modules/babysong.md) —— 三通道链路、下载队列、进度管理、Nginx 避坑、API 全表
- [架构规范](./docs/architecture.md) · [前端规范](./docs/frontend-standards.md) · [部署运维](./docs/deployment.md)
