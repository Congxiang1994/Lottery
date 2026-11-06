"""站点访问统计域配置：库路径、访客 ID 加盐、表结构。

口径见 ``app/stats/router.py`` 模块 docstring。
"""
from __future__ import annotations

import os

from app.common.paths import db_path

DB_PATH = db_path("visit_stats")

# 访客 ID 加盐哈希：即使 db 泄露也无法反推原始 UUID。
# 盐来自环境变量（部署时注入），缺失时退化为固定串（仍强于明文存 ID）。
SALT = os.environ.get("LOTTERY_VISIT_SALT", "lottery-visit-salt")

#: 建表脚本（`INSERT OR IGNORE` 保证首次建库就有 id=1 的计数行）
SCHEMA = """
CREATE TABLE IF NOT EXISTS visit_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO visit_stats (id, total) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS visit_visitors (
    visitor_hash TEXT PRIMARY KEY,
    first_seen   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""


def get_schema() -> str:
    """返回建表脚本（函数形式便于调用方显式表达「请求时才建表」）。"""
    return SCHEMA
