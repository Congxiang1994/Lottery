# 🖍 汉字是画出来的 · 108 节动画课视频点播

> 《汉字是画出来的》108 节动画课在线点播：检索、竖屏友好、全屏播放器（±5s / 上下集 / 进度拖动）。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/hanzi` · [在线访问](https://doudoutech.cloud/hanzi) |
| 前端 | `frontend/src/hanzi/HanziPlayer.tsx` |
| 后端 | `backend/app/hanzi/`（`config.py` 目录/拼音表 + `router.py` 列表接口） |
| 数据 | `/data/hanzi/001-日.mp4` ~ `108-立.mp4`（108 个 mp4，约 195 MB） |
| 鉴权 | 公开 |
| 外部依赖 | 无（视频文件由本机 Nginx 静态服务） |

## 要点

- **两条链路分离**：列表 JSON 走 FastAPI（扫目录 / 排序 / URL 编码），视频字节流走 **Nginx `alias`**（支持 `Range`，进度条可拖动，后端零负担）。
- **列表排序**按文件名前缀序号（`001-日.mp4` → 1），非数字前缀排最后；扩展名白名单 `mp4 / m4v / webm / mov`。
- **拼音检索**：`config.py` 内置 108 个汉字的拼音表，支持按汉字/拼音/首字母筛选。
- **播放状态**（已学标记、进度）存在浏览器 `localStorage`，无登录、不写服务端。
- ⚠️ Nginx 需屏蔽 `/hanzi/` 下非视频文件，避免脚本等敏感文件被直接下载；目录可用 `HANZI_DIR` 覆盖。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/hanzi/list` | 视频列表（序号升序，仅白名单扩展名，url 已编码） |
| GET | `/hanzi/<filename>` | 视频文件（Nginx 静态，支持 Range → 206） |

## 深入阅读

- [实现细节（完整版）](./docs/modules/hanzi.md) —— 模块定位、播放器交互、Nginx 配置、安全要点、本地开发
- [视频来源：小鹅通下载器](./tools/xiaoe-downloader/README.md) · [架构规范](./docs/architecture.md) · [前端规范](./docs/frontend-standards.md)
