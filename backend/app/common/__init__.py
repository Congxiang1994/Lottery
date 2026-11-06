"""公共基础设施（跨功能域复用）—— **新功能只准从这里取通用能力**。

| 模块 | 职责 |
|---|---|
| ``db``       | SQLite WAL 连接 ``get_conn`` + 建表 ``init_schema``（flock 多 worker 安全） |
| ``paths``    | 持久化路径唯一真源（``DB_DIR`` / ``db_path()`` / ``geo_dir()``） |
| ``admin``    | 私有功能的管理会话：签名 cookie + ``login/session_state/require/logout`` |
| ``security`` | 操作密码校验 + 防爆破失败递增锁定（全站唯一实现） |
| ``password`` | 密码哈希存储（scrypt，兼容历史 SHA-256） |

**边界**：功能域专属逻辑不进 common；common 也**不许** import 任何 ``app.<domain>``
（历史上 ``trigger.config`` 持有会话签名、``lottery.results_store`` 持有密码流控，
导致 5 个域反向依赖业务域，已全部上移）。
"""
