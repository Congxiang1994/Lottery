"""睡前故事域（/api/story）：公开阅读 + 私有管理 + 对外增删改查 API。

三条通道（互不干扰）：
- A 公开只读 ``/list`` ``/item/{id}`` —— SQL 层硬过滤 ``published=1``
- B 管理会话 ``/admin/*`` —— 密码换 cookie（``app.common.admin``）
- C 对外 API ``/v1/*`` —— ``X-API-Key`` 鉴权，配额在一条 SQL 里原子增减

子模块
------
- ``config``  库路径 / cookie 名 / 字段上限 / 密钥前缀与配额默认值
- ``store``   建表 + 故事 CRUD + 密钥 CRUD + 原子配额计数 + 调用日志
- ``apidoc``  对外 API 的自描述文档（``/admin/api-doc`` 直接序列化）
- ``router``  ``/api/story/*`` 全套接口 + 调用日志中间件
"""
from app.story import router  # noqa: F401
