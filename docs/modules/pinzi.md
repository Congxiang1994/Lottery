> 本文是 [README_pinzi.md](../../README_pinzi.md) 的完整实现细节，由 README 拆分而来（保留历史全文）。
> 日常使用请先看门牌：README_pinzi.md；全站总览见 [README.md](../../README.md)。

# README_pinzi.md — 「汉字是拼出来的」视频点播模块

> 本分册讲**实现逻辑与技术结构**。部署与扩展规范见 [README.md](../../README.md)。

## 模块定位

将服务器上的 **18 节《汉字是拼出来的》汉字故事课**（`001-先导篇.mp4` ~ `018-总结篇.mp4`）
做成纯点播网页：支持标题检索、进度记忆、倍速与选集，手机竖屏友好。

- 页面入口：`/pinzi`（聚合门户 Portal 有入口卡片）
- 视频数据：`/data/pinzi/`（18 个 mp4 + `covers/` 封面 + `meta.json`）
- 类型：**纯静态点播**，视频与封面不经后端，由 Nginx 直接文件服务

## 整体链路

```
┌─────────────┐  GET /api/pinzi/list（列表 JSON：标题/封面/时长）  ┌───────────────────────────┐
│ PinziPlayer │ ────────────────────────────────────────────────▶ │ FastAPI app/pinzi/router   │
│  (React)    │                                                   └───────────────────────────┘
│             │  GET /pinzi/001-先导篇.mp4（视频字节流，Range）      ┌───────────────────────────┐
│             │ ────────────────────────────────────────────────▶ │ Nginx alias /data/pinzi/   │
│             │  GET /pinzi/covers/001.jpg（封面）                 │  （文件服务，不经后端）      │
└─────────────┘                                                   └───────────────────────────┘
```

## 数据结构

### `/data/pinzi/meta.json`（下载器生成）

```json
[
 { "seq": 1, "title": "先导篇", "filename": "001-先导篇.mp4",
   "cover": "covers/001.jpg", "duration": 1505.3, "rid": "v_6883033ce4b0694c5b09f84b" }
]
```

**为什么需要它**：课程标题含全角标点、长句（「第7讲 漂亮的姜姓女子就要出嫁了」），
直接当文件名会碰到长度/字符限制，且改标题要重命名文件。把**完整标题、封面、时长**
放 JSON，视频文件名只用 `序号-截断标题`，改文案不动字节流。

### `GET /api/pinzi/list` 返回

```json
{ "total": 18, "videos": [
  { "seq": 1, "title": "先导篇", "filename": "001-先导篇.mp4",
    "duration": 1505.3, "cover": "/pinzi/covers/001.jpg",
    "url": "/pinzi/001-%E5%85%88%E5%AF%BC%E7%AF%87.mp4" } ] }
```

- `seq` 来自文件名前缀（`001-` → 1），非数字排最后
- `title` 优先取 `meta.json`，缺失时退化为文件名 `-` 之后的部分
- `cover` 会重写为 `/pinzi/covers/xxx.jpg`（原始 JSON 里是相对路径）
- `url` 已 `quote`，中文文件名安全

### 降级链（关键设计）

| 情况 | 行为 |
|---|---|
| `meta.json` 正常 | 完整标题 + 封面 + 时长 |
| `meta.json` 缺失 | 扫目录，标题取文件名，`cover=""`、`duration=0` |
| `meta.json` JSON 坏了 | 同「缺失」，`_load_meta()` 吞掉异常返回 `{}`，**绝不 500** |
| 目录不存在 | `{"total": 0, "videos": []}` |

## 后端：`backend/app/pinzi/`

| 文件 | 职责 |
|---|---|
| `config.py` | `PINZI_DIR`（默认 `/data/pinzi`，可用环境变量覆盖）、`VIDEO_EXTS`、`META_NAME` |
| `router.py` | `GET /api/pinzi/list` —— 读 meta 为主、扫目录兜底 |
| `__init__.py` | 模块说明 |

挂载于 `main.py` 的 `app.include_router(pinzi_router.router)`，与 `/api/hanzi` 互不冲突。

## 前端：`frontend/src/pinzi/`

| 文件 | 职责 |
|---|---|
| `PinziPlayer.tsx` | 列表页 + 弹窗播放器（自包含） |
| `api.ts` | `pinziApi.list()` + 类型定义 |
| `progress.ts` | 观看进度 / 倍速无关的播放位置记忆（localStorage） |

### 为什么进度要单独存

key 用 `pinzi_progress`（不是 hanzi 的 `hanzi_progress`）—— 两门课是不同的内容体系，
共用一份进度会互相覆盖。列表缓存同理（`pinzi_list_cache` / `pinzi_list_date`）。

### 长视频针对性设计

| 设计 | 原因 |
|---|---|
| **±10 秒步进** | 20 分钟以上的课，±5 秒效率太低 |
| **倍速 1/1.25/1.5/1.75/2** | 故事课信息密度低，1.25~1.5 倍是刚需 |
| **断点续播**（`pos > 10` 才恢复） | 长课中断概率高，从头看代价太大；>10s 避免「点开就暂停」误存的位置 |
| **进度节流 5 秒落盘** | 长视频 `timeupdate` 事件密集，每次写 localStorage 会卡 UI |
| **卡片显示百分比 + 已看完徽章** | 18 集跨度 6.5 小时，需要知道看到哪了 |
| **预取下一集** | 长视频首帧慢，预热 `link rel=preload` 明显改善连播体验 |
| **播完才标 `done`** | `onEnded` 置 `done=true`，且一旦 true 永不回落（防误点） |

### 交互

- 点卡片 → `fixed` 伪全屏弹窗（不依赖 `requestFullscreen`，iOS Safari 行为统一）
- `playsInline` + `webkit-playsinline` 防系统播放器接管
- 键盘：`空格` 播放/暂停、`←/→` ±10s、`↑/↓` 上/下一集、`Esc` 关闭
- 返回键 / 手机侧滑 → 只关弹窗不离开页面（`useModalHistory`）
- 选集面板在播放器内展开，标出每集的完成度

## Nginx 配置

```nginx
# 视频 + 封面静态服务
location /pinzi/ {
    alias /data/pinzi/;
    try_files $uri @pinzi_spa;      # 文件不存在 → 前端 SPA（/pinzi 路由）
    add_header Accept-Ranges bytes;
    expires 30d;                    # 浏览器 + Cloudflare 边缘缓存
    autoindex off;
}

location @pinzi_spa {
    root /opt/lottery/frontend/dist;
    try_files /index.html =404;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}

# meta.json 含 resource_id，脚本一律不对外
location ~ ^/pinzi/.*\.(py|sh|txt|json|db|log|bak)$ { deny all; }
# 封面只放行 covers/ 子目录
location ~ ^/pinzi/(?!covers/).*\.(jpg|jpeg|png|webp)$ { deny all; }
```

- `alias /data/pinzi/`：数据独立于 `/opt/lottery`，**rsync 重部署不会触碰**
- Nginx 原生支持 `Range`，拖进度条发 `Range: bytes=...` 返回 `206`
- 正则 `location` 优先级高于前缀 `location`，因此 `meta.json` 稳定 403

## 安全要点 ⚠️

- `meta.json` 含 `resource_id`，**必须**走 `deny all`（不能只靠 `autoindex off`）
- 下载脚本 `download_pinzi.py` 含 Cookie 读取逻辑，**不要放进 `/data/pinzi/`**
  （放 `/home/ubuntu/` 或 `tools/`，Cookie 单独存 600 权限文件）
- Cookie 有效期短（实测约 24 小时），失效时接口返回 **HTTP 200 + 空 body**，
  脚本按「空响应」报错而不是当成空目录

## 本地开发

```bash
# 后端（列表接口，视频目录指向本地测试目录）
cd backend
PINZI_DIR=/tmp/pinzi_test .venv/bin/uvicorn app.main:app --reload

# 前端
cd frontend && npm run dev   # /pinzi 页面，vite 已代理 /api
```

> 本地无视频文件时列表为空，不影响页面结构与交互调试。

## 验证记录（2026-11-18）

| 项 | 结果 |
|---|---|
| 课程目录可访问 | ✅ 18 节，全部 `resource_type=3` |
| `can_view=0` 是否阻断 | ✅ 不阻断，4/4 抽样取到播放地址 |
| 单集端到端下载 | ✅ 先导篇 48.1 MB / 720p h264+aac / 25.1 分钟 |
| 时长探测（18 节） | 合计 391 分钟（6.5 小时） |
| Nginx Range | ✅ `HTTP 206`，`video/mp4` |
| 敏感文件屏蔽 | ✅ `meta.json` / `*.py` 均 403 |
