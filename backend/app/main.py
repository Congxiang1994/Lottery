"""FastAPI 应用入口。"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.lottery import router as lottery_router
from app.hanzi import router as hanzi_router
from app.stats import router as stats_router
from app.trigger import router as trigger_router
from app.babysong import router as babysong_router
from app.trigger import scheduler
from app.common import password as password_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 操作密码库兜底初始化（库未配置且环境变量已设时自动引导写入；以库为准）
    password_store.ensure_configured()
    # 触发器调度循环（flock 选 leader，多 worker 仅一个运行；gunicorn 优雅重启安全）
    scheduler.start()
    yield
    await scheduler.stop()


app = FastAPI(title="Lottery · 彩票数据服务", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lottery_router.router)
app.include_router(hanzi_router.router)
app.include_router(stats_router.router)
app.include_router(trigger_router.router)
app.include_router(babysong_router.router)

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

    uvicorn.run(app, host="0.0.0.0", port=8000)
