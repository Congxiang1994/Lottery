# 🛠 小鹅通视频课程下载器 · 批量下载 xet 店铺课程

> 批量下载小鹅通店铺视频课程，保存为按序号命名的 mp4。《汉字是画出来的》108 节实测 108/108 成功。
> 全站总览见 [README.md](../../README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | 命令行工具（`tools/xiaoe-downloader/`），无前端页面 |
| 脚本 | `download.py`（下载）/ `enumerate_courses.py`（枚举目录） |
| 数据 | `courses.py`（课程映射，由枚举工具生成）+ `config.json`（登录态，不进仓库） |
| 鉴权 | 小鹅通店铺 Cookie（自己账号，本地填 `config.json`） |
| 外部依赖 | ffmpeg（HLS 下载与解密合并）、Python 3.8+（仅标准库） |
| 产物 | `001-日.mp4` ~ `108-立.mp4`，约 195 MB |

## 要点

- **链路**：`detail_info` → `play_sign` → `getPlayUrl` → m3u8 → ffmpeg，全量下载支持断点续传与失败自动重试。
- **课程映射**由 `enumerate_courses.py` 分页拉取目录后重新生成 `courses.py`，课程变动时重跑即可。
- **Cookie 获取是关键**：config.json 需填登录态（从浏览器开发者工具复制），失效会导致签名接口返回空。
- ⚠️ `config.json` 与下载产物都在 `.gitignore` 里，**不要提交登录态**。

## 命令速查

| 命令 | 说明 |
|---|---|
| `cp config.example.json config.json` | 生成配置（填入 Cookie） |
| `python3 download.py` | 全量下载（断点续传 / 自动重试） |
| `python3 enumerate_courses.py` | 重新枚举目录并生成 `courses.py` |

## 深入阅读

- [工作原理与踩坑记录（完整版）](../../docs/modules/xiaoe-downloader.md) —— 目录结构、Cookie 获取、链路细节、实测参数
- [视频点播模块](../../README_hanzi.md)（下载产物服务于该功能）· [全站文档导航](../../README.md)
