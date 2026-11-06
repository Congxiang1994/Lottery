"""站点访问统计：累计人次 + 去重访客数（无需登录）。

口径：
- 人次（total）：打开网站的次数，同一浏览器会话（sessionStorage）只计一次。
  即旧版单计数器口径，历史数据原样延续。
- 人数（visitors）：不同浏览器/设备的数量。前端首次访问生成持久 UUID
  （localStorage）上报，服务端加盐 sha256 后存表去重（不存原始 ID、不碰 IP）。
  人数从功能上线之日起累计，历史访客无法回溯。

分层：路由只做参数透传，SQL 与建表在 ``app.stats.store``，
库路径与表结构在 ``app.stats.config``。
"""
from __future__ import annotations

from fastapi import APIRouter

from app.stats import store

router = APIRouter(prefix="/api/stats", tags=["stats"])


#: 供访问管理 summary 复用：与左上角 Nav 同库同源的全站累计快照。
#: 保留这个名字（而不是让 access 域直接 import store）是为了让跨域调用点
#: 在 grep 里一眼可见 —— 这是本域唯一被别的域使用的入口。
snapshot_totals = store.totals


@router.get("/visit")
def get_visits():
    """读取当前累计（不计数）。返回 total=人次，visitors=去重人数。"""
    store.init()
    return store.snapshot()


@router.post("/visit")
def count_visit(visitor_id: str | None = None):
    """一次访问 +1（前端每个浏览器会话只上报一次，防刷新刷量）。"""
    return store.record_visit(visitor_id)
