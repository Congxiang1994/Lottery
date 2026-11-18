"""汉字拼读课视频点播域（/api/pinzi）。

- ``config``  视频目录、可播扩展名、元数据文件名
- ``router``  ``GET /api/pinzi/list`` —— 读 meta.json 为主、扫目录兜底

视频与封面由 Nginx 静态服务（``/pinzi/`` → ``/data/pinzi/``，支持 Range），
FastAPI 不经手字节流。目录可用 ``PINZI_DIR`` 覆盖（本地测试/只读环境）。
"""
