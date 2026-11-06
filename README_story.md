# 📖 每日儿童睡前故事 · 按日期倒序的阅读页 + 对外写入 API

> 每晚一篇睡前故事，公开页阅读、私有页管理，并提供 `X-API-Key` 鉴权的 REST 接口供脚本直写。
> 全站总览见 [README.md](./README.md)。

## 速览

| 项 | 值 |
|---|---|
| 入口 | `/story`（公开）· `/story-admin` 🔒（管理）· [在线访问](https://doudoutech.cloud/story) |
| 前端 | `frontend/src/story/` |
| 后端 | `backend/app/story/`（`config` / `store` / `apidoc` / `router`） |
| 数据 | `/data/lottery/story.db`（故事 / API 密钥 / 调用日志） |
| 鉴权 | 公开页无；管理页为全站操作密码（cookie `story_session`）；对外 API 为 `X-API-Key` |
| 外部依赖 | 无 |

## 要点

- **三条互不干扰的通道**：A 公开只读（SQL 硬过滤 `published=1`）、B 管理会话（密码 → 12h httpOnly cookie）、C 对外 API（`X-API-Key` + 配额）。
- **配额原子计数**：每条密钥的日/累计配额校验与自增在 `store.authenticate_key` 里**一条 SQL 完成**，避免并发超用；调用明细由中间件统一落日志。
- **API 自描述**：`GET /api/story/admin/api-doc` 返回参数、状态码、curl / Python 示例，管理页「API 管理」Tab 直接渲染。
- **字段**：纯文本正文（保留换行）+ 摘要 / 标签；`audio_url` / `cover_url` 为预留字段。同日多篇按 `story_date DESC, id DESC` 排序。
- ⚠️ api-key **明文存库**（`0600` 文件 + `0700` 目录保护），需求明确需要管理页可查看/复制；建表必须走 `app/common/db.init_schema`（flock）。

## 接口速查

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/story/list?limit=` | 已发布故事列表（`q` / `date_from` / `date_to` 可筛） |
| GET | `/api/story/item/{id}` | 单篇全文（仅已发布） |
| GET/POST | `/api/story/v1/stories` | 对外 API：列表 / 新建（`X-API-Key`） |
| GET | `/api/story/v1/me` | 当前密钥用量自检 |
| GET | `/api/story/admin/api-doc` | API 自描述文档（需管理会话） |

> 管理端故事 CRUD、密钥 CRUD、调用日志共 20+ 条接口，全表见深入阅读。

## 深入阅读

- [实现细节（完整版）](./docs/modules/story.md) —— 三条鉴权通道、原子配额、API 全表、安全要点、验收记录
- [功能设计稿](./docs/story-feature-design.md) · [UI 评审](./docs/story-ui-review.md) · [架构规范](./docs/architecture.md)
