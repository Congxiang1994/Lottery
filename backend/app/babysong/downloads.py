"""儿歌视频本地下载管理（yt-dlp → /data/song/{id}.mp4）。

设计
----
- 任务状态持久化在 sqlite（/data/lottery/babysong_dl.db，LOTTERY_DB_DIR 可覆盖），
  与代码目录独立，重部署不丢；gunicorn 多 worker 通过原子 UPDATE 抢占任务，全局同一时刻最多 1 个下载。
- 下载走 mihomo 代理（127.0.0.1:7890，SONG_PROXY 可覆盖）；服务器 2026-09-03 起交互/子进程均直连代理可用。
- yt-dlp 独立二进制 /usr/local/bin/yt-dlp（PATH 查找兜底）；deno 已装，供 JS runtime 解析。
- 文件名固定 {id}.mp4（如 EN001.mp4），存在即视为已下载（done 状态以文件为准，库只记录元信息）。
- 崩溃残留的 downloading 行：按 pid 探活，进程不在则标记 failed，可重试。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from app.common.db import get_conn

# 儿歌视频目录（独立部署目录，重部署不丢）
SONG_DIR = Path(os.environ.get("SONG_DIR", "/data/song"))
DB_PATH = Path(os.environ.get("LOTTERY_DB_DIR", "/data/lottery")) / "babysong_dl.db"

# 下载代理（mihomo mixed-port）；置空字符串则不走代理
PROXY = os.environ.get("SONG_PROXY", "http://127.0.0.1:7890")

# yt-dlp 可执行文件
YTDLP_BIN = shutil.which("yt-dlp") or "/usr/local/bin/yt-dlp"
FFPROBE_BIN = shutil.which("ffprobe") or "/usr/bin/ffprobe"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS song_downloads (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending/downloading/done/failed
    error       TEXT NOT NULL DEFAULT '',
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    duration_s  REAL NOT NULL DEFAULT 0,
    pid         INTEGER NOT NULL DEFAULT 0,
    url         TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT ''
);
"""

_worker_lock = threading.Lock()


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@contextmanager
def _conn():
    """打开任务库连接（WAL），确保表存在；退出自动 commit。"""
    with get_conn(DB_PATH) as con:
        con.execute(_SCHEMA)
        yield con


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def recover_stale() -> None:
    """把 pid 已死的 downloading 行标记为 failed（崩溃/重启残留），可再次触发下载。"""
    with _conn() as con:
        rows = con.execute(
            "SELECT id, pid FROM song_downloads WHERE status='downloading'"
        ).fetchall()
    for rid, pid in rows:
        if not _pid_alive(int(pid)):
            with _conn() as con:
                con.execute(
                    "UPDATE song_downloads SET status='failed', error='下载进程中断', "
                    "updated_at=? WHERE id=? AND status='downloading'",
                    (_now(), rid),
                )


def file_status(song_id: str) -> str:
    """以本地文件为准：存在 mp4 即 done。"""
    return "done" if (SONG_DIR / f"{song_id}.mp4").is_file() else ""


def local_song_ids() -> set[str]:
    if not SONG_DIR.is_dir():
        return set()
    return {p.stem for p in SONG_DIR.glob("*.mp4")}


def enqueue(song_ids: list[str], url_of) -> int:
    """把歌曲加入待下载队列（跳过已存在文件与正在下载的），返回实际入队数量。"""
    recover_stale()
    n = 0
    with _conn() as con:
        for sid in song_ids:
            if (SONG_DIR / f"{sid}.mp4").is_file():
                continue
            row = con.execute(
                "SELECT status FROM song_downloads WHERE id=?", (sid,)
            ).fetchone()
            if row and row[0] == "downloading":
                continue
            con.execute(
                "INSERT OR REPLACE INTO song_downloads "
                "(id, status, error, size_bytes, duration_s, pid, url, updated_at) "
                "VALUES (?, 'pending', '', 0, 0, 0, ?, ?)",
                (sid, url_of(sid), _now()),
            )
            n += 1
    if n:
        _ensure_worker()
    return n


def _claim_next() -> tuple[str, str] | None:
    """原子抢占一条 pending 任务（多 worker 全局同时最多 1 个下载）。"""
    with _conn() as con:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT id, url FROM song_downloads WHERE status='pending' "
            "ORDER BY id LIMIT 1"
        ).fetchone()
        if not row:
            con.execute("COMMIT")
            return None
        sid, url = row[0], row[1]
        con.execute(
            "UPDATE song_downloads SET status='downloading', pid=?, updated_at=? "
            "WHERE id=? AND status='pending'",
            (os.getpid(), _now(), sid),
        )
        con.execute("COMMIT")
    return sid, url


def _finish(sid: str, status: str, error: str = "") -> None:
    size = 0
    dur = 0.0
    fp = SONG_DIR / f"{sid}.mp4"
    if status == "done" and fp.is_file():
        size = fp.stat().st_size
        try:
            out = subprocess.run(
                [FFPROBE_BIN, "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(fp)],
                capture_output=True, text=True, timeout=30,
            ).stdout.strip()
            dur = float(out)
        except Exception:
            dur = 0.0
    with _conn() as con:
        con.execute(
            "UPDATE song_downloads SET status=?, error=?, size_bytes=?, duration_s=?, "
            "pid=0, updated_at=? WHERE id=?",
            (status, error, size, dur, _now(), sid),
        )


def _download_one(sid: str, url: str) -> None:
    cmd = [
        YTDLP_BIN,
        "--no-playlist",
        "-f", "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "-S", "res:720",
        "-o", str(SONG_DIR / f"{sid}.%(ext)s"),
        "--no-progress",
        "--socket-timeout", "30",
        "--retries", "3",
        url,
    ]
    env = dict(os.environ)
    # deno（yt-dlp 的 JS runtime）等安装在 /usr/local/bin，gunicorn 环境可能没有
    env["PATH"] = "/usr/local/bin:" + env.get("PATH", "")
    if PROXY:
        env["HTTP_PROXY"] = env["HTTPS_PROXY"] = env["http_proxy"] = env["https_proxy"] = PROXY
    env.pop("ALL_PROXY", None)
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=1800, env=env,
        )
        if (SONG_DIR / f"{sid}.mp4").is_file():
            _finish(sid, "done")
        elif proc.returncode == 0:
            _finish(sid, "failed", "下载结束但未生成 mp4 文件")
        else:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()
            msg = tail[-1][:300] if tail else f"yt-dlp 退出码 {proc.returncode}"
            _finish(sid, "failed", msg)
    except subprocess.TimeoutExpired:
        _finish(sid, "failed", "下载超时（30 分钟）")
    except Exception as e:  # 兜底：不让线程静默死亡
        _finish(sid, "failed", f"内部错误: {e}")


def _worker_loop() -> None:
    while True:
        claimed = _claim_next()
        if not claimed:
            return
        sid, url = claimed
        if (SONG_DIR / f"{sid}.mp4").is_file():  # 已有文件（可能手动放过），直接完成
            _finish(sid, "done")
            continue
        _download_one(sid, url)


def _ensure_worker() -> None:
    """每进程一个工作线程；拿不到锁说明本进程已有线程在跑。"""
    if _worker_lock.acquire(blocking=False):
        t = threading.Thread(target=_worker_loop, daemon=True, name="babysong-dl")
        t.start()


def snapshot() -> list[dict]:
    """返回全部任务行（含 pid 探活修正后的状态）。"""
    recover_stale()
    with _conn() as con:
        con.execute(_SCHEMA)
        rows = con.execute(
            "SELECT id, status, error, size_bytes, duration_s, updated_at "
            "FROM song_downloads ORDER BY id"
        ).fetchall()
    return [
        {
            "id": r[0],
            "status": r[1],
            "error": r[2],
            "size_bytes": r[3],
            "duration_s": round(r[4], 1),
            "updated_at": r[5],
        }
        for r in rows
    ]


def is_busy() -> bool:
    with _conn() as con:
        con.execute(_SCHEMA)
        row = con.execute(
            "SELECT pid FROM song_downloads WHERE status='downloading' LIMIT 1"
        ).fetchone()
    return bool(row) and _pid_alive(int(row[0]))


def wait_until_idle(timeout: float = 60.0) -> None:  # pragma: no cover - 测试辅助
    t0 = time.time()
    while is_busy() and time.time() - t0 < timeout:
        time.sleep(0.5)
