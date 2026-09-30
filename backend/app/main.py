"""FastAPI 应用入口。"""
from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.lottery import router as lottery_router
from app.hanzi import router as hanzi_router
from app.stats import router as stats_router
from app.trigger import router as trigger_router
from app.babysong import router as babysong_router
from app.story import router as story_router
from app.story import store as story_store
from app.story.router import v1_call_logger
from app.access import router as access_router
from app.access import store as access_store
from app.access.middleware import access_logger
from app.trigger import scheduler
from app.common import password as password_store
from app.common.db import harden_dir


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 持久化目录权限收紧（含明文 API key 的 trigger.db 所在目录）
    harden_dir(os.environ.get("LOTTERY_DB_DIR", "/data/lottery"))
    # 操作密码库兜底初始化（库未配置且环境变量已设时自动引导写入；以库为准）
    password_store.ensure_configured()
    # 睡前故事库建表（幂等）
    story_store.init()
    # 访问管理：建表（flock 串行化）+ 加载离线 IP 库 + 启动批量写入线程
    # ⚠️ 离线库缺失/损坏只 WARN，绝不让服务起不来（见 geo.load 的三层降级）
    access_store.init()
    # 触发器调度循环（SQLite 租约选派发者，多 worker 自愈；gunicorn 优雅重启安全）
    scheduler.start()
    # 儿歌下载队列恢复：清理崩溃残留 + 队列有 pending 则继续下载（重启不丢任务）
    from app.babysong import downloads

    downloads.resume_pending()
    yield
    # 退出前把访问日志队列 flush 干净（否则最后 1 秒的记录会丢）
    access_store.shutdown()
    await scheduler.stop()


app = FastAPI(title="Lottery · 彩票数据服务", version="1.0.0", lifespan=lifespan)

# 说明：本站前端与 API 同源（nginx 反代 /api），因此不需要 CORS。
# 此前 allow_origins=["*"] 会让任意站点可发起跨域请求，已移除。

app.include_router(lottery_router.router)
app.include_router(hanzi_router.router)
app.include_router(stats_router.router)
app.include_router(trigger_router.router)
app.include_router(babysong_router.router)
app.include_router(story_router.router)
app.include_router(access_router.router)

# 对外 API 调用明细日志：只处理 /api/story/v1/ 前缀，其他路由原样放行
app.middleware("http")(v1_call_logger)

# 访问管理采集：全量记录（自身 /api/access/* 与静态资源已在中间件内排除）。
# ⚠️ 放在最后注册 → Starlette 的 insert(0) 语义使它成为最外层中间件，
# 能覆盖包括 /api/story/v1 在内的全部请求，且耗时更贴近客户端视角。
app.middleware("http")(access_logger)

# 前端构建产物（若存在则托管，便于 Nginx 之前本地直跑）
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "lottery-easy-api"}


@app.get("/")
def root():
    if (DIST / "index.html").exists():
        return FileResponse(DIST / "index.html")
    return {"service": "lottery-easy-api", "docs": "/docs"}


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


# SPA 深链回退：/access、/story/xxx 这类前端路由直连时返回 index.html。
# 生产由 nginx `try_files $uri $uri/ @spa` 承担；这里是为了「后端单独直跑」
# （本地验证 / 排障）深链也能打开，行为与生产保持一致。
#
# 三条硬规则（生产 nginx 侧同款，改一处必须同步另一处）：
#   1. /api/* 保持 404 JSON —— 否则接口路径写错会返回 HTML，
#      前端把 HTML 当 JSON 解析，报错信息完全失真
#   2. dist 里真实存在的文件直接给（favicon / robots.txt / song-covers/…）
#   3. **「像文件」的路径不做回退**（/.env、/wp-login.php、/backup.zip…）→ 404
#      否则扫描器拿到的 200 + index.html 会被访问管理记成「命中 200」，
#      「有没有人翻我的敏感文件」这个最该看清的信号直接失真
_FILEISH = re.compile(r"\.[A-Za-z0-9]{1,8}$")


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")

    dist_root = DIST.resolve()
    target = (DIST / full_path).resolve()
    if target.is_file() and target.is_relative_to(dist_root):
        return FileResponse(target)

    if _FILEISH.search(full_path.rsplit("/", 1)[-1]):
        raise HTTPException(status_code=404, detail="Not Found")

    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Not Found")


if __name__ == "__main__":
    import uvicorn

    # 仅监听回环：本地调试入口，生产由 gunicorn(127.0.0.1:8000) + nginx 承担
    uvicorn.run(app, host="127.0.0.1", port=8000)
