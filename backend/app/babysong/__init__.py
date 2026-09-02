"""Super Simple Songs 儿歌功能域（/api/babysong）。

- router: GET /api/babysong/list —— 读取儿歌目录，返回带封面与 YouTube 链接的列表。
- 封面由前端构建产物静态托管（/babysong/covers/<id>.jpg），点击卡片直接跳转 YouTube 播放。
- 目录数据来自 data/catalog.json（由上游 518 首元数据裁剪生成），无需外部依赖。
"""
