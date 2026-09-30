# Super Simple Songs 儿歌 · 模块实现文档

> 本分册讲**实现逻辑与技术结构**。全站定位见 [README.md](./README.md)。

## 模块定位

将 **518 首经典英文儿歌（Super Simple Songs）** 做成一个列表站，**三条播放通道**：

1. **哔哩哔哩**（国内直连）：卡片悬停浮现 B 站按钮，移动端优先拉起 B 站 App 深链
   （`bilibili://video/<BV>`），失败回退网页版
2. **YouTube**（直链跳转）：卡片整卡点击即 `window.open(youtube_url)`
3. **本地视频**（站内播放）：服务器用 yt-dlp 经代理下载到 `/data/song/{id}.mp4`，
   已下载的歌卡片出现「本地」标识，点击在**站内弹窗播放器**里播（参考汉字课播放器），
   支持连播（播完自动下一首、末尾循环）与下一首预取

- 页面入口：`/babysong`（聚合门户 Portal 入口卡片）
- 元数据：`backend/app/babysong/data/catalog.json`（518 条，字段见下）
- 封面：`frontend/public/song-covers/*.jpg`（518 张本地托管，国内不被墙，随 dist 由 Nginx 静态服务）
- 本地视频：`/data/song/{id}.mp4`（Nginx `alias` 静态服务，独立于部署目录）
- 类型：**纯前端列表 + 轻量接口**，播放进度等状态全部存浏览器 localStorage（无登录、单机可用）

## 整体链路

```
┌──────────────┐  GET /api/babysong/list（元数据 + local 标记）  ┌─────────────────────────────┐
│ BabySong.tsx │ ──────────────────────────────────────────────▶ │ FastAPI  app/babysong/router │
│   (React)    │                                                └─────────────────────────────┘
│              │  GET /song-covers/EN001.jpg（封面）             ┌─────────────────────────────┐
│              │ ──────────────────────────────────────────────▶ │ Nginx 静态（同 dist 同源）   │
│              │  GET /song/EN001.mp4（本地视频，Range）         ┌─────────────────────────────┐
│              │ ──────────────────────────────────────────────▶ │ Nginx alias /data/song/     │
│              │  click → window.open(bilibili / youtube)        │  （本地视频；双平台纯前端跳转）│
└──────────────┘                                                └─────────────────────────────┘
```

- **列表接口**走 FastAPI：读 catalog.json，扫描 `/data/song/` 给已下载的歌附加
  `local: true` + `local_url: /song/<id>.mp4`
- **封面 / 本地视频**走 Nginx 静态服务；**B 站 / YouTube 跳转**纯前端，后端不参与播放
- **下载管理**（密码保护）：管理会话走 cookie（与 trigger 同一签名密钥、同一把操作密码）

## 后端：`backend/app/babysong/`

`router.py`（列表 + 管理端）+ `downloads.py`（下载队列），挂载于 `main.py`，统一 `/api/babysong` 前缀。

### `GET /api/babysong/list` — 儿歌列表

- 读取 `data/catalog.json`（文件不存在/解析失败 → 返回空列表，不报错）
- 返回 `{ "total": 518, "local_total": N, "songs": [...] }`；前端在运行时为每条追加 `seq`（按目录顺序 1..518）
- 单条结构：

```json
{
  "id": "EN001",
  "title": "The Family Tree",
  "channel": "Super Simple Songs - Kids Songs",
  "youtube_url": "https://www.youtube.com/watch?v=...",
  "bilibili_bvid": "BV1yCuZ6hELK",
  "cover": "/song-covers/EN001.jpg",
  "local": true,
  "local_url": "/song/EN001.mp4"
}
```

| 字段 | 含义 |
|---|---|
| `id` | 节目编号（`EN001` / `CN012`…），搜索框支持按编号检索 |
| `title` / `channel` | 歌名（英文）/ 来源频道名 |
| `youtube_url` | YouTube 直链（整卡点击打开） |
| `bilibili_bvid` | B 站 BV 号（可为空：找不到严格匹配时仅保留 YouTube 入口） |
| `cover` | 本地封面路径（`dist/song-covers/`） |
| `local` / `local_url` | 服务器已有本地视频时为 `true` + `/song/<id>.mp4` |

### `downloads.py` — 本地下载管理（yt-dlp）

- 任务状态持久化在 sqlite（`/data/lottery/babysong_dl.db`），与代码目录独立；**done 状态以
  `/data/song/{id}.mp4` 文件存在为准**，库只记元信息
- gunicorn 多 worker 通过**原子 UPDATE 抢占任务**，全局同一时刻最多 1 个下载
- 下载走 mihomo 代理（`SONG_PROXY` 可覆盖）；yt-dlp 独立二进制 + ffprobe 探测时长
- 崩溃恢复的 `downloading` 行：按 pid 探活，进程不在则标记 failed 可重试；启动时 `resume_pending()`
- B 站链接每日刷新见 `tools/babysong-bili-sync/`（见下文）

## 前端：`frontend/src/babysong/BabySong.tsx`

单文件自包含，路由 `/babysong` 在 `App.tsx` 注册，入口卡片在 `Portal.tsx` 的 `APPS` 数组。

### 卡片与交互

| 能力 | 实现 |
|---|---|
| 封面 + 歌名网格 | `grid-cols-2 → sm:3 / md:4 / lg:5 / xl:6` 响应式；左上角全局序号角标（`seq` 1..518，搜索/分页不变） |
| 整卡跳 YouTube | 整卡 `<a target="_blank" rel="noopener noreferrer">`，onClick 记「已播放」 |
| B 站按钮 | 悬停浮现；有 `bilibili_bvid` 才渲染；移动端 `bilibili://` 深链 + 1.5s 回退网页版 |
| 「本地」标识与站内播放 | 已下载歌曲卡片左下「本地」徽章，点击开**站内弹窗播放器**（audio/video 元素 + 参考汉字播放器的控制条），支持连播与预取 |
| 已播放打钩 / 收藏 ♥ | 右上角绿底打钩 / 右下角 ♥（`preventDefault + stopPropagation`） |
| 随机来一首 | 优先从**已下载本地**的歌里随机（站内弹窗秒开）；一首都没有时退回跳转 YouTube |

### 筛选 / 排序 / 分页

- **筛选 tabs**（带计数）：全部 / 已播放 / 未播放 / 收藏 / 最近 / **本地**（仅已下载）
- **排序**：序号 ↑（默认）/ 序号 ↓ / 未播放优先
- **分页**：`PAGE_SIZE = 48`，窗口化页码 + 跳页输入；搜索词 / 筛选 / 排序变化自动回第 1 页

### 进度与本地状态（localStorage，无登录）

| Key | 内容 | 说明 |
|---|---|---|
| `babysong_played_v1` | `string[]`（id 集合） | 已播放记录，驱动打钩 + 进度统计 |
| `babysong_fav_v1` | `string[]`（id 集合） | 收藏记录，独立于播放状态 |
| `babysong_last_v1` | `number`（seq） | 上次点击的序号，「回到上次 #N」用 |
| `babysong_history_v1` | `string[]`（上限 30） | 最近播放，去重 unshift；「最近」筛选用 |

顶部 Hero 区有整体**完成度进度条**（已播放 X / 518 + 百分比）。

## B 站链接每日刷新：`tools/babysong-bili-sync/`

`gather.py` + `.timer/.service`（每日定时）：校验已有 BV 号是否仍在线（搬运下架自动重新搜索找回），
没有 BV 号的补齐；**匹配策略已收紧** —— 歌名规范化后必须完整包含在 B 站视频标题的规范化
结果里（大小写不敏感、忽略标点），找不到就置空，绝不宽松匹配（避免误配）。
`/data/song/{id}.mp4` 已存在的歌直接跳过（有本地视频时 B 站按钮不展示）。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/babysong/list` | 儿歌列表（含 local 标记） |
| POST | `/api/babysong/admin/auth` | 密码校验 → 签发 12h httpOnly cookie |
| GET | `/api/babysong/admin/session` | 会话有效性 |
| POST | `/api/babysong/admin/logout` | 退出 |
| GET | `/api/babysong/admin/downloads` | 全部歌曲下载状态（done/downloading/pending/failed/none + 计数 + busy） |
| POST | `/api/babysong/admin/download` | 批量入队下载（密码保护） |
| GET | `/song-covers/<id>.jpg` | 封面图片（Nginx 静态，与前端同源） |
| GET | `/song/<id>.mp4` | 本地视频（Nginx alias `/data/song/`，支持 Range） |

## nginx 与封面目录避坑 ⚠️

```nginx
# 儿歌本地视频静态服务（/data/song，yt-dlp 下载产物，支持 Range 拖动进度）
location /song/ {
    alias /data/song/;
    ...
}
# 屏蔽 /song/ 下非视频文件（防敏感文件泄露），正则 location 优先于前缀 location
location ~ ^/song/.*\.(py|sh|txt|json|db|log|bak|jpg)$ { deny all; }
```

封面最初放在 `frontend/public/babysong/covers/`，构建产物 `dist/babysong/` 与 SPA 路由
`/babysong` **同名冲突** → Nginx 把路由当目录返回 403。已修正为 `song-covers/`。

> 经验：**静态资源目录名不可与任一前端路由同名**（`try_files ... /index.html` 回退只对
> 「文件不存在」生效，目录存在时优先返回目录/403）。

## 本地开发

```bash
# 后端（列表接口纯读 JSON，下载管理需服务器 yt-dlp + 代理环境）
cd backend && .venv/bin/uvicorn app.main:app --reload   # /api/babysong/list

# 前端
cd frontend && npm run dev   # /babysong 页面，vite 已代理 /api → 8000
```

> 封面在 `frontend/public/song-covers/`（随仓库 14MB），本地 `npm run dev` 直接可看；
> 本地视频与下载管理依赖服务器环境，本地缺省只影响「本地」通道调试。
