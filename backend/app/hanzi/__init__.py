"""汉字课视频点播域（/api/hanzi）。

- ``config``  视频目录、可播扩展名、108 个汉字的拼音表
- ``router``  ``GET /api/hanzi/list`` —— 扫目录，按序号返回可播放列表

视频文件本身由 Nginx 静态服务（``/hanzi/`` → ``/data/hanzi/``，支持 Range），
FastAPI 不经手字节流。目录可用 ``HANZI_DIR`` 覆盖（本地测试/只读环境）。
"""
