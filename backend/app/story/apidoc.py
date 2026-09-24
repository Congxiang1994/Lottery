"""对外 API 的接口定义与调用样例。

**单一事实来源**：管理页「API 管理」Tab 直接渲染这里的数据，接口改了这里必须同步改，
避免页面上挂着一份会漂移的手写文档。

占位符（前端渲染时替换）：
- ``{BASE_URL}`` → 当前站点 origin，如 https://doudoutech.cloud
- ``{API_KEY}``  → 密钥，默认渲染成 shell 变量 ``$STORY_KEY``
"""
from __future__ import annotations

from typing import Any

# 请求体字段说明（POST / PUT 共用）
STORY_FIELDS: list[dict[str, str]] = [
    {"name": "title", "type": "string", "required": "是", "desc": "标题，≤100 字"},
    {"name": "content", "type": "string", "required": "是", "desc": "正文，≤8000 字，保留换行"},
    {"name": "story_date", "type": "string", "required": "否", "desc": "YYYY-MM-DD，默认今天；排序以此为准"},
    {"name": "summary", "type": "string", "required": "否", "desc": "导语/摘要，≤200 字"},
    {"name": "tags", "type": "string", "required": "否", "desc": "逗号分隔标签，如 动物,勇气"},
    {"name": "audio_url", "type": "string", "required": "否", "desc": "音频/视频链接（预留字段）"},
    {"name": "cover_url", "type": "string", "required": "否", "desc": "封面图链接（预留字段）"},
    {"name": "published", "type": "boolean", "required": "否", "desc": "true 立即上线 / false 存草稿；新建默认 true"},
]

# 响应码约定
STATUS_CODES: list[dict[str, str]] = [
    {"code": "200", "desc": "成功"},
    {"code": "401", "desc": "缺少或无效的 X-API-Key"},
    {"code": "403", "desc": "密钥已停用"},
    {"code": "404", "desc": "故事不存在"},
    {"code": "422", "desc": "参数校验失败（如日期格式、超长）"},
    {"code": "429", "desc": "超出每日或累计调用配额"},
]

ENDPOINTS: list[dict[str, Any]] = [
    {
        "method": "GET",
        "path": "/api/story/v1/stories",
        "summary": "分页列出故事（按日期倒序）",
        "params": [
            {"name": "limit", "in": "query", "required": "否", "desc": "每页条数，默认 20，上限 200"},
            {"name": "offset", "in": "query", "required": "否", "desc": "偏移量，默认 0"},
            {"name": "date", "in": "query", "required": "否", "desc": "精确日期 YYYY-MM-DD"},
            {"name": "date_from", "in": "query", "required": "否", "desc": "起始日期（含）"},
            {"name": "date_to", "in": "query", "required": "否", "desc": "结束日期（含）"},
            {"name": "q", "in": "query", "required": "否", "desc": "关键词，匹配标题/正文/标签"},
            {"name": "published", "in": "query", "required": "否", "desc": "true 已发布（默认）/ false 仅草稿 / all 全部"},
        ],
        "body": None,
    },
    {
        "method": "GET",
        "path": "/api/story/v1/stories/{id}",
        "summary": "读取单篇故事",
        "params": [
            {"name": "id", "in": "path", "required": "是", "desc": "故事 ID"},
        ],
        "body": None,
    },
    {
        "method": "POST",
        "path": "/api/story/v1/stories",
        "summary": "新建故事",
        "params": [],
        "body": STORY_FIELDS,
    },
    {
        "method": "PUT",
        "path": "/api/story/v1/stories/{id}",
        "summary": "更新故事（部分更新：只覆盖传入的字段）",
        "params": [
            {"name": "id", "in": "path", "required": "是", "desc": "故事 ID"},
        ],
        "body": STORY_FIELDS,
    },
    {
        "method": "DELETE",
        "path": "/api/story/v1/stories/{id}",
        "summary": "删除故事",
        "params": [
            {"name": "id", "in": "path", "required": "是", "desc": "故事 ID"},
        ],
        "body": None,
    },
    {
        "method": "GET",
        "path": "/api/story/v1/me",
        "summary": "查询本密钥的启用状态与用量",
        "params": [],
        "body": None,
    },
]

CURL_SAMPLES: list[dict[str, str]] = [
    {
        "title": "新建故事",
        "desc": "content 支持多行；story_date 省略则记为今天，published 省略默认上线。",
        "curl": """curl -X POST {BASE_URL}/api/story/v1/stories \\
  -H "X-API-Key: {API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "小熊和月亮",
    "story_date": "2026-09-24",
    "summary": "关于勇气和告别",
    "tags": "动物,勇气",
    "content": "从前有一只小熊，住在山脚下的树洞里。\\n每天夜里，他都会抬头看月亮……"
  }'""",
    },
    {
        "title": "列出最近的故事",
        "desc": "默认只返回已发布的故事，按 story_date 倒序。",
        "curl": """curl "{BASE_URL}/api/story/v1/stories?limit=10" \\
  -H "X-API-Key: {API_KEY}\"""",
    },
    {
        "title": "读取单篇",
        "desc": "把 {id} 换成列表里返回的 id。",
        "curl": """curl "{BASE_URL}/api/story/v1/stories/1" \\
  -H "X-API-Key: {API_KEY}\"""",
    },
    {
        "title": "更新故事",
        "desc": "部分更新：只写要改的字段即可，未传的字段保持原值。",
        "curl": """curl -X PUT "{BASE_URL}/api/story/v1/stories/1" \\
  -H "X-API-Key: {API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "小熊和月亮（修订版）", "published": false}'""",
    },
    {
        "title": "删除故事",
        "desc": "不可恢复，删除前建议先 GET 确认。",
        "curl": """curl -X DELETE "{BASE_URL}/api/story/v1/stories/1" \\
  -H "X-API-Key: {API_KEY}\"""",
    },
    {
        "title": "查询本密钥用量",
        "desc": "用于外部脚本自检剩余配额，避免撞 429。",
        "curl": """curl "{BASE_URL}/api/story/v1/me" \\
  -H "X-API-Key: {API_KEY}\"""",
    },
]

PY_SAMPLE = """import requests

BASE = "{BASE_URL}"
KEY = "{API_KEY}"
HEADERS = {{"X-API-Key": KEY}}

# 新建
r = requests.post(
    f"{{BASE}}/api/story/v1/stories",
    headers=HEADERS,
    json={{
        "title": "小熊和月亮",
        "story_date": "2026-09-24",
        "content": "从前有一只小熊……",
    }},
    timeout=10,
)
print(r.status_code, r.json())

# 列表
r = requests.get(f"{{BASE}}/api/story/v1/stories", headers=HEADERS, params={{"limit": 5}}, timeout=10)
print(r.status_code, r.json())
"""
