# 智慧教育下载模块 · 模块实现文档

> 本页为 `backend/app/edu/` + `frontend/src/edu/` 功能域的**实现逻辑与技术结构**说明。
> 全站总览见 [README.md](./README.md)。

国家中小学智慧教育平台（basic.smartedu.cn）资源下载助手。
**整体移植自开源项目 [`smart-edu-download`](https://github.com/Congxiang1994/smart-edu-download)**（MIT，其解析逻辑移植自 hantang/smartedu-dl-go 的 `internal/dl`），
重写为 Lottery 独立子模块：复用同一套 FastAPI 后端框架与暗色 aurora 前端，API 全部挂在 `/api/edu`（与彩票 `/api/v1` 隔离）。

> **定位**：资源解析与下载工具，仅供个人学习/备课等教育用途。资源均来自平台官方开放接口，本项目不存储、不上传任何平台资源。

---

## 1. 后端结构（`backend/app/edu/`）

```
app/edu/
├── __init__.py    # 模块说明（无初始化逻辑）
├── config.py      # 平台常量：CDN 地址、资源详情 URL 模板、目录元信息、x-nd-auth 头名
├── platform.py    # 平台解析逻辑：目录树、课时、资源解析（URL → 可下载文件列表）
├── sessions.py    # 会话管理：每浏览器会话独立登录信息 + 书签授权码
├── downloader.py  # 下载管理：并发下载普通文件 / m3u8 视频，进度上报 + 取消
└── routes.py      # FastAPI 路由（/api/edu，15 条）：鉴权、目录、解析、任务、文件
```

启动时由 `backend/app/main.py` 调用 `init_manager(EDU_DOWNLOAD_DIR, EDU_THREADS)` 注入下载管理器（下载目录默认 `/data/edu`）。

## 2. 关键实现逻辑

### 2.1 会话隔离（sessions.py）

每个浏览器会话**独立的登录信息**，互不干扰：

- 首次访问下发 `sd_sid` Cookie（`secrets.token_hex(16)`，httponly + samesite=lax，30 天）；
- 会话内保存 `auth`（平台 `x-nd-auth` 头的完整值）与 `auth_code`（书签授权码）；
- `fulfill_token()`：把用户粘贴的裸 access token 拼成 `MAC id="...",nonce="0",mac="0"`；
- ⚠️ 登录信息绑定在**服务器内存**，重启后需重新配置。

**书签一键授权**（免开控制台）：
```
设置页 GET /auth/code → 生成 6 字节 hex 授权码（by_code 表映射 code→会话）
平台登录态浏览器执行书签（携带该 code + 页面 token）
        → POST /auth/code 绑定 → 该会话 auth 生效
```

### 2.2 目录与缓存（routes.py + platform.py）

- `GET /catalog?type=course|textbook` 拉取目录树：先取 `version/data_version.json` + `tags/*_tag.json`
  组装多级目录（学段/年级/学科/版本/教材）；**进程内缓存 600s**，`?refresh=1` 强制刷新；
- 目录树对「学段-年级」标签做过滤归一（`_filter_tags` / `_concat_tag_path`），保证层级正确；
- `GET /course/{book_id}` 拉取课时目录（parts.json / trees.json）。

### 2.3 解析链路（POST /parse）

```
勾选教材/课时/粘贴链接
  → 区分两类：课程教材(需展开课时) vs 普通资源
  → generate_url_from_id() 按 config.RESOURCE_URLS 模板生成详情 URL
      （basic + backup 多源兜底，CDN 从 s-file-1/2/3 随机挑）
  → extract_resources() 从详情 JSON 提取可下载文件列表
      （格式过滤：默认 pdf/mp3/jpg；勾选视频则 m3u8；useBackup 可切备用源）
  → 课程教材自动展开：拉课时树 → 逐课时解析 → 合并结果
  → dedup() 去重 → 返回可下载清单（标题/类型/大小/多源 URL）
```

### 2.4 直连下载 vs 服务器下载（两条通道）

| 通道 | 适用 | 实现 | 带宽 |
|---|---|---|---|
| **直连** `POST /direct` | PDF/课件/音频/图片 等普通文件 | 生成带 `accessToken` 的 CDN 直链，浏览器直接下载 | **不占服务器带宽** |
| **服务器** `POST /tasks` | 视频（m3u8）及需要登录头下载的受限资源 | 服务器线程池下载后存 `/data/edu` | 走服务器 |

### 2.5 下载管理器（downloader.py）

- `DownloadManager`：**8 并发线程池**；任务以「组」组织（`gid = 时间戳-uuid4hex4`）；
- 普通文件：httpx 流式下载（64KB 分块），上报字节进度与百分比；
- m3u8 视频：`ffmpeg -y -i <url> -c copy <out>` 合并分片（需服务器安装 ffmpeg；`-headers` 注入登录头）；
- **取消**：`threading.Event` 置位 → 分块循环/ffmpeg 轮询主动退出；
- **文件名净化** `_sanitize`：去除非法字符、控制符、Windows 保留名、长度上限 120；
- **防重名** `_reserve_path`：存在则自动加 ` (1)`、` (2)` 后缀；按 `Folder` 建子目录；
- **错误友好化**：401/403/404 映射为中文提示（如「登录信息无效/资源已下架」）。

### 2.6 文件管理（routes.py）

- **路径安全** `_safe_join`：`abspath` 后校验 `startswith(base)`，**防目录穿越**；
- 文件树递归浏览 → 单文件下载（FileResponse）→ ZIP 流式打包（StreamingResponse + BytesIO）→ 删除。

## 3. API 全表（前缀 `/api/edu`，共 15 条路由）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/auth` | 当前会话平台登录状态 |
| POST | `/auth` | 手动配置平台 Token |
| GET | `/auth/code` | 获取书签一键授权码 |
| POST | `/auth/code` | 用授权码绑定 token 到会话 |
| GET | `/catalog?type=course\|textbook&refresh=` | 平台目录树（进程内缓存 600s） |
| GET | `/course/{book_id}` | 课程（教材）课时目录 |
| POST | `/parse` | 解析选中资源 → 可下载清单 |
| POST | `/direct` | 生成浏览器直连 CDN 链接（非视频） |
| GET | `/tasks` | 下载任务组列表 |
| POST | `/tasks` | 提交下载任务组 |
| POST | `/tasks/{gid}/cancel` | 取消任务组 |
| GET | `/files?path=` | 已下载文件树 |
| GET | `/files/download?path=` | 下载单个文件 |
| POST | `/files/zip` | 打包 ZIP（流式） |
| DELETE | `/files?path=` | 删除文件/目录 |

> 下载文件保存于服务器 `/data/edu`（env `EDU_DOWNLOAD_DIR` 可改，独立于部署目录，重部署不丢）；
> 视频 m3u8 合并依赖 **ffmpeg**。

## 4. 前端结构（`frontend/src/edu/`）

```
src/edu/
├── api.ts          # /api/edu 客户端封装
├── EduPortal.tsx   # 模块入口（功能导航）
├── Browse.tsx      # 资源浏览（目录树 + 课时展开 + 解析清单）
├── Tasks.tsx       # 下载任务（进度 / 取消）
├── Files.tsx       # 文件管理（树 + 下载 + 打包 + 删除）
├── Settings.tsx    # 登录信息配置（书签授权 / 手动 Token）
└── components/     # CatalogTree（目录树）/ LessonModal（课时选择弹窗）
```

- 暗色 **aurora 风格**重写（原仓库为亮色 ink 主题），与彩票站视觉语言统一；
- 路由 `/edu/*` 注册于 `frontend/src/App.tsx`，聚合门户 `src/portal/Portal.tsx` 的 `APPS` 数组有入口；
- 书签授权从 basic.smartedu.cn 跨域 POST `/api/edu/auth/code`，靠后端全局 `CORSMiddleware(allow_origins=["*"])` 放行。
