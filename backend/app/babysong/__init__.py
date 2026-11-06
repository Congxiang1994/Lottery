"""Super Simple Songs 儿歌域（/api/babysong）。

- ``downloads``  本地下载管理（yt-dlp → ``/data/song/{id}.mp4``，SQLite 任务表）
- ``router``     ``GET /list`` 公开列表；``/admin/*`` 密码保护（``app.common.admin``）

封面由前端构建产物静态托管（``/babysong/covers/<id>.jpg``），
目录数据来自 ``data/catalog.json``（上游 518 首元数据裁剪），无需外部依赖。
"""
