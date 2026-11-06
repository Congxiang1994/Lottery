"""触发器配置常量。

⚠️ 会话 / 密码相关能力已上移到 ``app.common.admin`` 与 ``app.common.security``
（全站唯一实现）。本文件只放触发器域自己的常量与请求参数。
"""
from __future__ import annotations

import os

from app.common.paths import db_path

DB_PATH = db_path("trigger")

# 操作密码：与彩票「运行全部」同一把，统一由数据库哈希存储。
# 校验走 app.common.security.verify_password。源码不再含明文密码。

# 会话 cookie：httpOnly，密码校验通过后签发，12 小时有效
COOKIE_NAME = "trigger_session"
SESSION_TTL_SECONDS = 12 * 3600

# 请求参数
HTTP_TIMEOUT_SECONDS = 30.0
RETRY_TIMES = 2          # 失败自动重试次数（不含首次）
RETRY_INTERVAL_SECONDS = 60
HISTORY_KEEP_DAYS = 90

# ------------------------------------------------------------ 调度循环
# 补发窗口：触发点过后这么多分钟内仍允许补发；超出则记 missed（等页面手动补触发）。
# 为什么需要：调度按 HH:MM 精确比对，任何一次漏跳（事件循环抖动 / 循环任务终止 / 进程重启）
# 都会让当日窗口**永久丢失且不留痕**（missed 只在启动首扫时写）。2026-09-22 06:30 事故即此。
GRACE_MINUTES = int(os.environ.get("LOTTERY_TRIGGER_GRACE_MINUTES", "30"))

# 看门狗（自愈）：每 SUPERVISOR_INTERVAL_SECONDS 巡检一次循环任务；
# 任务已结束、或最后一次 tick 距今超过 STALL_SECONDS，就强制重启循环。
SUPERVISOR_INTERVAL_SECONDS = 20
STALL_SECONDS = 180

# 心跳日志：每 N 次 tick 打一条 INFO（journalctl 可见，10 → 每 10 分钟一条）
HEARTBEAT_LOG_EVERY_TICKS = 10

# 探测/触发请求：模拟真实 Agent 客户端调用，降低被风控误判/封号概率
# - UA 用真实浏览器，而非 python-httpx 默认 UA
# - 请求体是自然短句 + 正常 token 数，避免「ping + max_tokens=1」这种明显探测特征
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
EXTRA_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
}
# 自然短句，让每次调用都像真实 Agent 对话而非机械心跳
PROBE_MESSAGE = "请回复 ok 确认连接正常"
PROBE_MAX_TOKENS = 16
