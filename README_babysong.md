# README_babysong.md — 「Super Simple Songs 儿歌」列表模块

> 本分册讲**实现逻辑与技术结构**。全站定位、部署与扩展规范见 [README.md](./README.md)。

## 模块定位

将 **518 首经典英文儿歌（Super Simple Songs）** 做成一个**纯列表展示网页**：带官方封面与
YouTube 直链，点击卡片即跳转到 YouTube 播放。**不下载视频、不内嵌播放器、不接点读**
——视频托管在 YouTube（国内需科学上网才能观看，但封面与列表本身在国内可正常加载）。

- 页面入口：`/babysong`（聚合门户 Portal 有入口卡片，当前排序第 2 位）
- 视频数据：`backend/app/babysong/data/catalog.json`（518 条元数据，入库前已裁剪字段）
- 封面数据：`frontend/public/song-covers/*.jpg`（518 张本地托管，国内不被墙）
- 类型：**纯前端列表 + 轻量列表接口**，播放进度等状态全部存在浏览器 localStorage（无登录、单机可用）

## 整体链路

```
┌──────────────┐  GET /api/babysong/list（518 条元数据）  ┌─────────────────────────────┐
│ BabySong.tsx │ ───────────────────────────────────────▶ │ FastAPI  app/babysong/router │
│   (React)    │                                          └─────────────────────────────┘
│              │  GET /song-covers/EN001.jpg（封面图片）    ┌─────────────────────────────┐
│              │ ───────────────────────────────────────▶ │ Nginx 静态（同 dist 同源）   │
│              │  click card → window.open(youtube_url)    │  （不经后端，直接跳 YouTube） │
└──────────────┘                                          └─────────────────────────────┘
```

- **列表接口**走 FastAPI（读 JSON 裁剪字段，528 条原子返回，前端做搜索/筛选/分页）
- **封面图片**随前端构建产物 `dist/song-covers/` 由 Nginx 静态服务（与 `index.html` 同源，无跨域）
- **YouTube 跳转**由前端 `window.open` 完成，后端完全不参与播放

## 后端：`backend/app/babysong/`

`router.py` 单文件，挂载于 `main.py`（`app.include_router(babysong_router.router)`，无独立前缀
冲突，所有路由统一以 `/api/babysong` 开头）。

### `GET /api/babysong/list` — 儿歌列表

- 读取 `CATALOG = .../babysong/data/catalog.json`（文件不存在/解析失败 → 返回空列表，不报错）
- 返回结构：`{ "total": 518, "songs": [...] }`
- 前端在运行时为每条追加 `seq`（按目录顺序 1..518），搜索/分页不改变此序号

```json
{
  "id": "EN001",
  "title": "The Family Tree",
  "channel": "Super Simple Songs - Kids Songs",
  "youtube_url": "https://www.youtube.com/watch?v=ecm9HEFcfdQ",
  "cover": "/song-covers/EN001.jpg"
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `id` | 节目编号（如 `EN001` / `CN012`），搜索框支持按编号检索 |
| `title` | 儿歌名称（英文） |
| `channel` | 来源频道名（默认 `Super Simple Songs - Kids Songs`） |
| `youtube_url` | YouTube 播放直链，点击卡片即打开 |
| `cover` | 本地封面路径（构建后落在 `dist/song-covers/`，由 Nginx 静态服务） |

## 前端：`frontend/src/babysong/BabySong.tsx`

单文件自包含（无额外组件依赖），路由 `/babysong` 在 `App.tsx` 注册，入口卡片在
`Portal.tsx` 的 `APPS` 数组（`status: "live"`）。

### 卡片与交互

| 能力 | 实现 |
|---|---|
| 封面 + 歌名网格 | `grid-cols-2 → sm:3 / md:4 / lg:5 / xl:6`，响应式；左上角全局序号角标（`seq` 1..518，按目录顺序，搜索/分页不变） |
| 点击跳转 YouTube | 整卡 `<a target="_blank" rel="noopener noreferrer" href={youtube_url}>`，onClick 同时记「已播放」 |
| 已播放打钩 | 已播放卡片右上角绿底打钩 + 绿色描边；状态存 localStorage |
| 收藏 ♥ | 卡片右下角 ♥ 按钮切换收藏（`preventDefault + stopPropagation`，不触发整卡跳转） |
| 悬停播放遮罩 | hover 时覆盖 YouTube 图标遮罩，提示可点击 |
| 随机来一首 | Hero 区「随机来一首」按钮，从当前筛选结果随机取一首并标记已播放后打开 |

### 筛选 / 排序 / 分页

- **筛选 tabs**（带计数）：全部 / 已播放 / 未播放 / 收藏 / 最近
- **排序下拉**：序号 ↑（默认）/ 序号 ↓ / 未播放优先（未播置顶，便于接着看）
- **分页**：`PAGE_SIZE = 48`，底部分页导航为窗口化页码（当前页前后各 3 页）+ 跳页输入框（回车或「跳转」）
- 搜索词 / 筛选 / 排序变化均自动回到第 1 页

### 进度与本地状态（localStorage，无登录）

| Key | 内容 | 说明 |
|---|---|---|
| `babysong_played_v1` | `string[]`（id 集合） | 已播放记录，驱动打钩 + 进度统计 |
| `babysong_fav_v1` | `string[]`（id 集合） | 收藏记录，独立于播放状态 |
| `babysong_last_v1` | `number`（seq） | 上次点击的序号，「回到上次 #N」用 |
| `babysong_history_v1` | `string[]`（上限 30，时间倒序） | 最近播放记录，去重 unshift；「最近」筛选与重置使用 |

顶部 Hero 区有整体**完成度进度条**（已播放 X / 518 + 百分比）。

### 导入 / 导出 / 重置

- **导出**：将 `{ version, exportedAt, played, fav, history, last }` 序列化为 JSON 由浏览器下载，
  便于换设备/清缓存后恢复
- **导入**：`FileReader` 读取 JSON，按 `∪` 合并（不丢本地已有记录），`last` 取较大值
- **重置**：二次 `window.confirm` 后清空 `played / fav / history / last` 全部本地进度

## 封面目录注意事项 ⚠️（真实踩坑）

封面最初放在 `frontend/public/babysong/covers/`，Vite 构建后产物为 `dist/babysong/`，
与 SPA 路由 `/babysong` **同名冲突** → Nginx 把路由当目录返回 403。

**已修正**：封面目录改名 `frontend/public/song-covers/`，构建产物 `dist/song-covers/` 与路由
`/babysong` 不再冲突。

> 经验：**静态资源目录名不可与任一前端路由同名**（Nginx 的 `try_files ... /index.html` 回退
> 只对「文件不存在」生效，目录存在时会优先返回目录/403）。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/babysong/list` | 儿歌列表（518 条，按目录顺序，字段已裁剪） |
| GET | `/song-covers/<id>.jpg` | 封面图片（Nginx 静态服务，与前端同源） |

## 本地开发

```bash
# 后端（列表接口，纯读 JSON，无需数据库）
cd backend && .venv/bin/uvicorn app.main:app --reload   # /api/babysong/list

# 前端
cd frontend && npm run dev   # /babysong 页面，vite 已代理 /api → 8000
```

> 封面在 `frontend/public/song-covers/`（随仓库 14MB），本地 `npm run dev` 直接可看；
> 若缺封面仅影响图片，不影响列表与交互调试。
