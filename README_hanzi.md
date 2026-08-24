# README_hanzi.md — 「汉字是画出来的」视频点播模块

> 本分册讲**实现逻辑与技术结构**。全站定位、部署与扩展规范见 [README.md](./README.md)。

## 模块定位

将服务器上已下载的 **108 节《汉字是画出来的》动画课视频**（`001-日.mp4` ~ `108-立.mp4`）
做成一个**纯点播网页**：支持按文件名模糊检索、手机竖屏友好、点击卡片即全屏播放、
播放器提供 播放/暂停、快进/后退 5s、上一集/下一集、进度条拖动 等基础功能。

- 页面入口：`/hanzi`（聚合门户 Portal 有入口卡片）
- 视频数据：`/data/hanzi/`（108 个 mp4，H.264+AAC，共约 195M，h264 编码保证移动端浏览器直接播放）
- 类型：**纯静态点播**，视频文件不经后端，由 Nginx 直接文件服务

## 整体链路

```
┌────────────┐   GET /api/hanzi/list（列表 JSON）   ┌──────────────────────────┐
│ HanziPlayer │ ───────────────────────────────────▶ │ FastAPI  app/hanzi/router │
│  (React)   │                                      └──────────────────────────┘
│            │   GET /hanzi/001-日.mp4（视频字节流）  ┌──────────────────────────┐
│            │ ───────────────────────────────────▶ │ Nginx alias /data/hanzi/ │
└────────────┘      支持 Range，进度条可拖动          │  （文件服务，不经后端）    │
                                                    └──────────────────────────┘
```

- **列表接口**走 FastAPI（需要扫描目录、排序、过滤、URL 编码，动态生成）
- **视频字节流**走 Nginx（静态文件服务天然支持 `Range` 断点/拖动，性能最好，后端零负担）

## 后端：`backend/app/hanzi/`

`router.py` 单文件，挂载于 `main.py`，与彩票域（`/api/v1`）互不冲突。

### `GET /api/hanzi/list` — 视频列表

- 扫描 `HANZI_DIR`（默认 `/data/hanzi`，可用环境变量 `HANZI_DIR` 覆盖，便于本地测试）
- **按文件名前缀序号排序**：`001-日.mp4` → 1，`108-立.mp4` → 108（`_sort_key` 取 `stem.split("-")[0]` 转 int，非数字兜底排最后）
- **扩展名白名单过滤**：仅 `mp4 / m4v / webm / mov`，目录里的脚本/杂物不会混入
- 每条返回 `{ id, num, title, filename, url }`，其中：
  - `title`：从 `001-日` 拆出 `日`（`stem.partition("-")`）
  - `url`：`/hanzi/` + `quote(filename)`（URL 编码，中文文件名安全）

```json
{ "total": 108, "videos": [ { "id": 1, "num": 1, "title": "日", "filename": "001-日.mp4", "url": "/hanzi/001-%E6%97%A5.mp4" }, ... ] }
```

## 前端：`frontend/src/hanzi/HanziPlayer.tsx`

单文件自包含（无额外组件依赖），路由 `/hanzi` 在 `App.tsx` 注册，入口卡片在
`Portal.tsx` 的 `APPS` 数组（status: `"live"`）。

### 交互设计（对照需求逐条）

| 需求 | 实现 |
|---|---|
| 按文件名模糊检索 | 顶部搜索框，前端过滤：`${num} ${title} ${filename}` 小写后 `includes(query)`，108 条秒级响应，无需后端搜索 |
| 手机竖屏友好 | 卡片网格响应式：`grid-cols-3`（手机）→ `sm:4 / md:6 / lg:8`（桌面）；触控目标 ≥44px；控制条 `pb-[max(1rem,env(safe-area-inset-bottom))]` 避让刘海 |
| 简洁播放器 | 底部一条控制条：**上一集 · 后退5s · 播放/暂停 · 快进5s · 下一集** + 可拖进度条（`<input type=range>`）；播放中 3s 无操作控制条自动隐藏（`poke()` 重置计时器），点击/触摸任意处唤出 |
| 点击卡片即全屏播放 | 点卡片 → `fixed inset-0 z-50` **伪全屏**黑底层（不依赖 `requestFullscreen`，iOS Safari 行为统一）+ `v.play()` 自动播放；`playsInline` + `webkit-playsinline` 防系统播放器接管 |
| 简洁明了 | 卡片用**汉字大字当封面**（零加载成本），左上角序号徽章，底部文件名；顶部返回按钮回聚合门户 |

### 播放器细节

- **上一集/下一集**：按当前视频在完整列表（非过滤后）中的索引定位，边界回绕（首→尾、尾→首）
- **±5s**：`v.currentTime = clamp(currentTime + delta, 0, duration)`
- **进度条**：`onTimeUpdate` 驱动，`onLoadedMetadata`/`onDurationChange` 取时长；拖动即 `currentTime = t`
- **键盘快捷键**（桌面）：空格 播放/暂停、←/→ 后退/快进 5s、↑/↓ 上/下一集、Esc 退出（输入框聚焦时不拦截）
- **播放结束**：显示居中重播按钮（`RefreshCw`），点击从头播放
- **重复点击同一卡片**：重置到 0 秒重新播放
- 视频区单击切换播放/暂停、双击快进 5s

## Nginx 配置（视频静态服务）

`deploy/nginx.conf`（生产 `/etc/nginx/sites-enabled/lottery.conf` 同步）：

```nginx
# 汉字课视频静态服务（Nginx 直接文件服务，支持 Range 拖动进度）
location /hanzi/ {
    alias /data/hanzi/;
    add_header Accept-Ranges bytes;
    autoindex off;
}

# 屏蔽 /hanzi/ 下非视频文件（防下载脚本等敏感文件泄露）
location ~ ^/hanzi/.*\.(py|sh|txt|json|db|log|bak)$ {
    deny all;
}
```

- `alias /data/hanzi/`：视频目录独立于 `/opt/lottery` 部署目录，**rsync 重部署不会触碰**
- Nginx 静态文件服务原生支持 `Range`，浏览器拖动进度条即发 `Range: bytes=...`，返回 `206`
- 正则 `location` 优先级高于前缀 `location`，`download_hanzi.py` 等一律 403

## 安全要点 ⚠️

下载脚本 `download_hanzi.py` 曾含硬编码的小鹅通 Cookie，且放在 `/data/hanzi/` 内。
已做**双保险**：

1. 脚本移出视频目录 → `/home/ubuntu/download_hanzi.py.bak`
2. nginx 正则屏蔽 `/hanzi/` 下所有非视频扩展名（`py/sh/txt/json/db/log/bak` → 403）

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/hanzi/list` | 视频列表（序号升序，仅视频扩展名，url 已编码） |
| GET | `/hanzi/<filename>` | 视频文件（Nginx 静态服务，支持 Range → 206） |

## 本地开发

```bash
# 后端（列表接口，视频目录用 env 指向本地测试目录）
cd backend
HANZI_DIR=/tmp/hanzi_test .venv/bin/uvicorn app.main:app --reload

# 前端
cd frontend && npm run dev   # /hanzi 页面，vite 已代理 /api → 8000
```

> 视频文件本身在服务器 `/data/hanzi/`，本地开发时列表可为空，不影响页面调试。
