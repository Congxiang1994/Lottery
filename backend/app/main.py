"""FastAPI 应用入口。"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
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
    # 触发器调度循环（SQLite 租约选派发者，多 worker 自愈；gunicorn 优雅重启安全）
    scheduler.start()
    # 儿歌下载队列恢复：清理崩溃残留 + 队列有 pending 则继续下载（重启不丢任务）
    from app.babysong import downloads

    downloads.resume_pending()
    yield
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

# 对外 API 调用明细日志：只处理 /api/story/v1/ 前缀，其他路由原样放行
app.middleware("http")(v1_call_logger)

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


if __name__ == "__main__":
    import uvicorn

    # 仅监听回环：本地调试入口，生产由 gunicorn(127.0.0.1:8000) + nginx 承担
    uvicorn.run(app, host="127.0.0.1", port=8000)
