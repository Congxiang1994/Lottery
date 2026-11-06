"""站点访问统计域（/api/stats）：累计人次 + 去重访客数，无需登录。

- ``config``  库路径、访客 ID 加盐、表结构
- ``store``   建表 / 人次自增 / 访客去重 / 快照（被 access 域的概览复用）
- ``router``  ``GET|POST /api/stats/visit``
"""
from app.stats import router  # noqa: F401
