"""捡漏域的入参解析与校验（纯函数，不碰 HTTP 路由）。

为什么单独成模块：``router.py`` 里原先混着 138 行的 cURL 解析 / 掩码 /
配置校验 —— 它们是可独立测试的纯逻辑，却和 FastAPI 的路由装饰器搅在一起，
既不好测也不好复用。

⚠️ 这里仍会抛 ``HTTPException(422)``：本站的约定是「校验失败就是 422 +
中文 detail」，让调用方（路由层）一行转出去，比引入自定义异常再映射更短。
"""
from __future__ import annotations

import re
import shlex
from typing import Any

from fastapi import HTTPException

_HEADER_RE = re.compile(r"^\s*(cookie|user-agent)\s*:\s*(.+)$", re.I)


def parse_credential(raw: str) -> tuple[str, str, str]:
    """从「Copy as cURL」命令或裸 Cookie 串里提取 (cookie, ua, error)。

    支持三种粘贴形态（用户不需要理解区别，粘什么都尽量认）：
    1. 完整 cURL（bash / cmd 风格，大小写引号都兼容）
    2. 只有一行 `Cookie: xxx` 头
    3. 裸 cookie 串 `a=1; b=2`
    """
    text = (raw or "").strip()
    if not text:
        return "", "", "内容为空"

    # cURL 的续行反斜杠先合并，否则 shlex 会把 "\" 当成字符
    text = text.replace("\\\r\n", " ").replace("\\\n", " ")
    cookie = ""
    ua = ""

    if "curl" in text[:20].lower() or "-H" in text or "--header" in text:
        try:
            tokens = shlex.split(text)
        except ValueError:
            tokens = text.split()
        i = 0
        while i < len(tokens):
            tok = tokens[i]
            value = ""
            if tok in ("-H", "--header") and i + 1 < len(tokens):
                value = tokens[i + 1]
                i += 2
            elif tok.startswith("-H") and len(tok) > 2:
                value = tok[2:].strip()
                i += 1
            elif tok.startswith("--header="):
                value = tok.split("=", 1)[1]
                i += 1
            else:
                i += 1
                continue
            m = _HEADER_RE.match(value)
            if not m:
                continue
            if m.group(1).lower() == "cookie":
                cookie = m.group(2).strip()
            else:
                ua = m.group(2).strip()

    if not cookie:
        # 也可能用户直接粘了一整行 `Cookie: ...`
        line = text.splitlines()[0].strip() if text else ""
        m = _HEADER_RE.match(line)
        if m and m.group(1).lower() == "cookie":
            cookie = m.group(2).strip()
        elif "=" in text and ";" in text:
            cookie = text
        elif "=" in text:
            cookie = text  # 单个键值也接受，站方有时只认一个 sess

    if not cookie:
        return "", ua, "没有识别到 Cookie，请确认复制的是 smzdm.com 的请求"
    if len(cookie) > 8000:
        return "", ua, "Cookie 过长（超过 8000 字符），可能复制错了内容"
    return cookie, ua, ""


def mask_cookie(cookie: str) -> str:
    """脱敏展示：只露长度和首尾，足够用户确认「换没换成新的」。"""
    if not cookie:
        return ""
    if len(cookie) <= 16:
        return "*" * len(cookie)
    return f"{cookie[:8]}…{cookie[-6:]}（共 {len(cookie)} 字符）"


# ------------------------------------------------------------ 配置读写


def validate_config(patch: dict[str, Any]) -> dict[str, Any]:
    """校验可写配置，越界直接 422 —— 静默纠正会让用户以为改了没生效。

    ⚠️ 只接受 ``DEFAULT_SETTINGS`` 里真实存在的键。判定类参数
    （信号词 / 品牌 / 权重 / 折扣档 / 热度阈值）2026-11-06 起已硬编码进
    config.py 常量，不再走这条通道 —— 见 docs/deals-digital-spec.md §3.0。
    """
    out: dict[str, Any] = {}

    # ---------------- 抓取控制 ----------------
    ints = {
        # 精选流页数。0 = 不抓（默认）：实测是全量爆料流水，100 条里 0 条能过，
        # 拿它当入选来源只是灌库。上限 8 留给「刚上新」这类未来用途。
        "pages_per_round": (0, 8),
        # 标签流页数（主力入口）。0 = 关闭。上限 3：实测手慢无 3 页已覆盖
        # 1.5 小时，再多都是重复。
        "tag_pages": (0, 3),
    }
    for key, (lo, hi) in ints.items():
        if key in patch:
            try:
                v = int(patch[key])
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"{key} 必须是整数")
            if not (lo <= v <= hi):
                raise HTTPException(status_code=422, detail=f"{key} 应在 {lo}~{hi} 之间")
            out[key] = str(v)

    if "tag_feeds" in patch:
        raw = str(patch["tag_feeds"] or "")
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if len(parts) > 8:
            raise HTTPException(status_code=422, detail="标签流最多 8 个")
        # ⚠️ 必须是短 slug（如 tz273gm），不能是中文名 —— 中文名会 301，
        # 每轮都白多一次往返。这里直接挡掉。
        for p_ in parts:
            if not re.fullmatch(r"[a-z0-9]{4,16}", p_):
                raise HTTPException(
                    status_code=422,
                    detail=f"标签「{p_}」格式不对：应为站点短 slug（如 tz273gm），不是中文名",
                )
        out["tag_feeds"] = ",".join(parts)

    if "enabled" in patch:
        out["enabled"] = "1" if str(patch["enabled"]) in ("1", "true", "True") else "0"

    # ---------------- 唯一需要日常调整的：品类白名单 ----------------
    if "cate_allow" in patch:
        parts = [x.strip() for x in str(patch["cate_allow"] or "").split(",") if x.strip()]
        if len(parts) > 12:
            raise HTTPException(status_code=422, detail="品类白名单最多 12 项")
        out["cate_allow"] = ",".join(parts)

    return out


