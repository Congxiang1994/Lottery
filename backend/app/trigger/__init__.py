"""API 用量触发器功能域。

自包含模块: config（常量与会话令牌） / store（sqlite 存储） /
scheduler（进程内调度循环） / router（API 路由）。

挂载于 /api/trigger。密码与彩票「运行全部」同一把，统一由数据库（/data/lottery/auth.db）
哈希存储（见 app.common.password）；校验通过签发 httpOnly cookie 会话（12h），
保护任务配置与执行历史。源码不含明文密码。
"""
