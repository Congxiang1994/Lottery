"""API 用量触发器功能域。

自包含模块: config（常量与会话令牌） / store（sqlite 存储） /
scheduler（进程内调度循环） / router（API 路由）。

挂载于 /api/trigger。密码与彩票「运行全部」同一把（LOTTERY_RUN_PASSWORD），
校验通过签发 httpOnly cookie 会话（12h），保护任务配置与执行历史。
"""
