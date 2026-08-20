"""下载管理：并发下载普通文件与 m3u8 视频，支持进度与取消。

普通文件用 httpx 流式下载并上报字节进度；
m3u8 视频用 ffmpeg 合并（需系统安装 ffmpeg）。
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx

from .config import AUTH_HEADER

_ILLEGAL = re.compile(r'[<>:"/\\|?*]')
_CONTROL = re.compile(r"[\x00-\x1f]")
_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}


def _sanitize(name: str) -> str:
    name = name.strip().replace("..", "").replace("~", "")
    name = _ILLEGAL.sub("_", name)
    name = _CONTROL.sub(" ", name)
    name = name.rstrip(" .")
    name = re.sub(r"\s+", " ", name)
    if not name:
        name = "Untitled"
    if name.split(".")[0].upper() in _WIN_RESERVED:
        name = "_" + name
    return name[:120]


def _fmt_size(n):
    n = n or 0
    if n <= 0:
        return 0
    return int(n)


class DownloadManager:
    def __init__(self, download_dir: str, max_workers: int = 8) -> None:
        self.download_dir = os.path.abspath(download_dir)
        os.makedirs(self.download_dir, exist_ok=True)
        self.max_workers = max(max_workers, 1)
        self.groups: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=self.max_workers)

    # ---- 提交 ----
    def submit(self, links: list, name: str, auth: str) -> dict:
        gid = time.strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:4]
        group = {
            "id": gid, "name": name or "下载任务",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "status": "running", "total": len(links), "done": 0,
            "cancel": threading.Event(), "auth": auth, "tasks": [],
        }
        for i, l in enumerate(links):
            group["tasks"].append({
                "index": i, "title": l.get("Title", ""), "folder": l.get("Folder", ""),
                "format": l.get("Format", ""), "size": _fmt_size(l.get("Size")),
                "raw_url": l.get("RawURL", ""), "backup_url": l.get("BackupURL", ""),
                "status": "pending", "progress": 0.0, "downloaded": 0,
                "output_path": "", "error": "",
            })
        with self._lock:
            self.groups[gid] = group
        for task in group["tasks"]:
            self._pool.submit(self._run, group, task)
        return self._public(group)

    def cancel(self, gid: str) -> bool:
        with self._lock:
            g = self.groups.get(gid)
        if not g:
            return False
        g["cancel"].set()
        return True

    def list_groups(self) -> list:
        with self._lock:
            return [self._public(g) for g in self.groups.values()]

    def _public(self, g: dict) -> dict:
        return {
            "id": g["id"], "name": g["name"], "created_at": g["created_at"],
            "status": g["status"], "total": g["total"], "done": g["done"],
            "tasks": [{k: v for k, v in t.items()} for t in g["tasks"]],
        }

    # ---- 单任务执行 ----
    def _run(self, g: dict, t: dict) -> None:
        if g["cancel"].is_set():
            self._finish(g, t, "cancelled")
            return
        t["status"] = "downloading"
        t["started_at"] = time.strftime("%H:%M:%S")
        try:
            out_path = self._reserve_path(t["folder"], t["title"], t["format"])
            t["output_path"] = out_path
            url = t["backup_url"]
            headers = {}
            if g["auth"]:
                url = t["raw_url"]
                headers[AUTH_HEADER] = g["auth"]
            if t["format"] == "m3u8":
                ok, err = self._download_video(url, out_path, headers, g)
            else:
                ok, err = self._download_file(url, out_path, headers, t, g)
            if not ok:
                t["error"] = self._friendly(err)
                self._finish(g, t, "error")
            else:
                self._finish(g, t, "done")
        except Exception as e:  # noqa: BLE001
            t["error"] = self._friendly(str(e))
            self._finish(g, t, "error")

    def _finish(self, g: dict, t: dict, status: str) -> None:
        t["status"] = status
        t["finished_at"] = time.strftime("%H:%M:%S")
        if status == "done":
            t["progress"] = 1.0
            g["done"] = g["done"] + 1
        # 更新组状态
        if g["status"] == "running":
            for tt in g["tasks"]:
                if tt["status"] in ("pending", "downloading"):
                    break
            else:
                g["status"] = "done" if g["cancel"].is_set() else "done"

    def _friendly(self, err: str) -> str:
        err = str(err)
        if "401" in err:
            return "登录信息无效或已过期，请重新配置登录信息"
        if "403" in err:
            return "访问被拒绝(403)，可能未配置登录信息，或该资源需登录/已下架"
        if "404" in err:
            return "资源不存在(404)"
        return err[:200]

    # ---- 普通文件 ----
    def _download_file(self, url: str, out_path: str, headers: dict,
                       t: dict, g: dict) -> tuple[bool, str]:
        if g["cancel"].is_set():
            return False, "cancelled"
        try:
            with httpx.stream("GET", url, headers=headers, timeout=120,
                              follow_redirects=True) as resp:
                if resp.status_code != 200:
                    return False, f"status code {resp.status_code}"
                total = t["size"]
                downloaded = 0
                with open(out_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=64 * 1024):
                        if g["cancel"].is_set():
                            return False, "cancelled"
                        f.write(chunk)
                        downloaded += len(chunk)
                        t["downloaded"] = downloaded
                        if total and total > 0:
                            t["progress"] = min(downloaded / total, 1.0)
            return True, ""
        except Exception as e:  # noqa: BLE001
            return False, str(e)

    # ---- m3u8 视频（ffmpeg）----
    def _download_video(self, url: str, out_path: str, headers: dict,
                        g: dict) -> tuple[bool, str]:
        if not shutil.which("ffmpeg"):
            return False, "服务器未安装 ffmpeg，无法合并视频"
        header_arg = ""
        if headers:
            h = "".join(f"{k}: {v}\r\n" for k, v in headers.items())
            header_arg = f" -headers \"{h}\" "
        cmd = f"ffmpeg -y {header_arg} -i \"{url}\" -c copy \"{out_path}\""
        proc = subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL)
        try:
            while proc.poll() is None:
                if g["cancel"].is_set():
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except Exception:
                        proc.kill()
                    return False, "cancelled"
                time.sleep(0.2)
            return proc.returncode == 0, f"ffmpeg exit {proc.returncode}"
        except Exception as e:  # noqa: BLE001
            proc.kill()
            return False, str(e)

    # ---- 路径分配 ----
    def _reserve_path(self, folder: str, stem: str, suffix: str) -> str:
        folder = _sanitize(folder)
        stem = _sanitize(stem)
        if suffix == "m3u8":
            suffix = "ts"
        index = 0
        while True:
            if index > 0:
                name = f"{stem} ({index}).{suffix}" if suffix else f"{stem} ({index})"
            else:
                name = f"{stem}.{suffix}" if suffix else stem
            parts = [self.download_dir]
            if folder:
                parts.append(folder)
            parts.append(name)
            path = os.path.join(*parts)
            if not os.path.exists(path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                return path
            index += 1


manager: DownloadManager | None = None


def init_manager(download_dir: str, max_workers: int = 8) -> DownloadManager:
    global manager
    manager = DownloadManager(download_dir, max_workers)
    return manager
