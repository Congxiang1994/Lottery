"""FastAPI 应用入口。"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.lottery import router as lottery_router

app = FastAPI(title="Lottery · 彩票数据服务", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lottery_router.router)

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
