"""CT 报告分享域配置常量。

⚠️ 分享口令**不在这份文件里，也不进源码**：哈希后存 ``/data/lottery/ctshare.db``
（写入用 ``scripts/ct_setup.py``），校验走 ``app.common.password`` 的 scrypt 校验。
"""
from __future__ import annotations

from app.common.paths import db_path

#: 本域独立库（报告原文 + 分享口令 + 防爆破计数都在这里）
DB_PATH = db_path("ctshare")

#: 会话 cookie：httpOnly，密码通过后签发，12 小时有效
COOKIE_NAME = "ct_session"
SESSION_TTL_SECONDS = 12 * 3600

#: 报告 HTML 体积上限（导入时校验，防止误传超大文件把库撑爆）
MAX_REPORT_BYTES = 8 * 1024 * 1024

#: 防爆破：连续失败到阈值后按阶梯锁定（与全站同一策略，口径见 app.common.security）
FAIL_THRESHOLD = 5
LOCK_STEPS = (30.0, 60.0, 120.0, 300.0, 900.0)

#: 报告固定单条（id=1）：分享页只有一份报告，替换即更新
REPORT_ID = 1
