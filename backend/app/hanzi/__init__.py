"""汉字课视频点播功能域（/api/hanzi）。

- router: GET /api/hanzi/list —— 扫描视频目录，返回按序号排序的文件列表。
- 视频文件本身由 Nginx 静态服务（/hanzi/ → /data/hanzi/，支持 Range），不走后端。
- 目录可用环境变量 HANZI_DIR 覆盖（本地测试/只读环境注入 /tmp 路径）。
"""
