"""CT 报告分享功能域。

自包含模块: config（常量） / store（SQLite 存储：报告原文 + 分享口令 + 防爆破计数） /
router（API 路由）。

挂载于 ``/api/ct``，前端私有页 ``/ct``。

与全站私有功能的差别（**刻意为之**）
----------------------------------
- 全站私有页（trigger / story-admin / babysong-admin / access / deals-admin）共用
  **同一把操作密码**（``app.common.password`` 存的 auth.db），适合「只有本人用」。
- 本域要的是**「把链接发给医生看」**：口令要简单好记（1234）、口令要能单独改，
  改了也不影响本人其它私有页 —— 所以口令存自己的库（``/data/lottery/ctshare.db``），
  哈希方式与全站一致（scrypt，见 ``app.common.password``）。
- 会话仍复用 ``app.common.admin`` 的签名 cookie 机制（同一把签名密钥、独立 cookie
  名 ``ct_session``），12 小时有效。

报告原文（HTML，含内嵌报告照片的 base64）**逐字节入库、原样渲染**，
不做任何内容解析或改写 —— 页面长什么样，分享出去就是什么样。
"""
