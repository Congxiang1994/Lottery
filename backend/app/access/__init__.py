"""访问管理（私有功能 ``/access``）：访客 / 接口 / 地区访问记录与多维聚合。

子模块
------
- ``config``      配置常量（路径 / 保留期 / 忽略名单 / 功能域映射 / 护栏阈值）
- ``geo``         离线 IP → 地区（ip2region xdb，vendored 官方 binding）
- ``store``       建表（flock）/ 队列批量写入 / 聚合查询 / 标注 / 清理 / 回填
- ``middleware``  ``access_logger`` 采集中间件（极薄，只做字符串处理）
- ``router``      ``/api/access/*`` 全套接口

设计文档：``docs/access-management-design.md``
"""
