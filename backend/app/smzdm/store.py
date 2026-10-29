"""SMZDM 捡漏域存储层（smzdm.db）。

三张表
------
- ``deals``      抓到的每条好价 + 判定结果（``picked`` / ``pick_reason``）
- ``settings``   key-value 配置（阈值、Cookie、分类过滤、开关）
- ``fetch_log``  每轮抓取的健康记录（请求数 / 新增 / 命中 / 是否被风控）

建表为什么要 flock
------------------
生产是 gunicorn 多 worker，每个 worker 启动都会跑 lifespan → init()。
并发 ``CREATE TABLE`` 在多 worker 下会撞 ``database is locked``。
flock 让建表串行化，后到者等前者做完再执行（幂等，重复执行无副作用）。
"""
from __future__ import annotations

import fcntl
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Iterable

from app.common.db import get_conn
from app.smzdm.config import (
    CATE_BOOST_DEFAULT,
    DEALS_KEEP_DAYS,
    DEFAULT_SETTINGS,
    HEAT_WEIGHTS,
    LOG_KEEP_DAYS,
    DB_PATH,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS deals (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    url         TEXT NOT NULL,
    price       TEXT NOT NULL DEFAULT '',
    mall        TEXT NOT NULL DEFAULT '',
    cate1       TEXT NOT NULL DEFAULT '',
    cate2       TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '',
    img         TEXT NOT NULL DEFAULT '',
    worth       INTEGER NOT NULL DEFAULT 0,
    unworth     INTEGER NOT NULL DEFAULT 0,
    fav         INTEGER NOT NULL DEFAULT 0,
    cmt         INTEGER NOT NULL DEFAULT 0,
    worth_pct   REAL NOT NULL DEFAULT 0,
    heat        REAL NOT NULL DEFAULT 0,
    cate_hit    INTEGER NOT NULL DEFAULT 0,
    hhmm        TEXT NOT NULL DEFAULT '',
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    picked      INTEGER NOT NULL DEFAULT 0,
    pick_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_deals_picked ON deals(picked, heat DESC);
CREATE INDEX IF NOT EXISTS idx_deals_first ON deals(first_seen DESC);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fetch_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    pages    INTEGER NOT NULL DEFAULT 0,
    parsed   INTEGER NOT NULL DEFAULT 0,
    added    INTEGER NOT NULL DEFAULT 0,
    picked   INTEGER NOT NULL DEFAULT 0,
    banned   INTEGER NOT NULL DEFAULT 0,
    errors   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_log_ts ON fetch_log(ts DESC);
"""

# 值率判定前的最小打分样本量。低于此值不参与判定 ——
# 「1 个值 0 个不值」= 100% 值率，但样本量毫无意义，必须挡掉。
MIN_RATED = 5


@contextmanager
def _init_lock():
    """建表用的进程间互斥（锁文件与库同目录）。"""
    lock_path = DB_PATH.parent / "smzdm_init.lock"
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_WRONLY | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def init() -> None:
    """建表 + 补列 + 补齐缺省配置 + 一次性迁移（幂等）。"""
    with _init_lock():
        with get_conn(DB_PATH) as con:
            con.executescript(_SCHEMA)
            _ensure_columns(con)
            existing = {r[0] for r in con.execute("SELECT key FROM settings")}
            missing = [
                (k, v) for k, v in DEFAULT_SETTINGS.items() if k not in existing
            ]
            if missing:
                con.executemany(
                    "INSERT INTO settings (key, value) VALUES (?,?)", missing
                )

            # 一次性迁移（2026-10-29）：抓取入口从「首页推荐流」换成
            # 「精选流 N 页 + 首页 1 页」。
            # `pages_per_round` 的旧值 5 是按首页算的，而首页分页已失效 ——
            # 换到精选流后每页 20 条且真能翻页，沿用 5 会白抓 100 条冗余、
            # 请求量从 576/天涨到 864/天。这里重置为新默认值，之后用户
            # 自己改的值照常保留（迁移只做一次，靠 feed_v2 标记）。
            if "feed_v2" not in existing:
                con.execute(
                    "UPDATE settings SET value=? WHERE key='pages_per_round'",
                    (DEFAULT_SETTINGS["pages_per_round"],),
                )
                con.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('feed_v2','1')"
                )


def _ensure_columns(con: sqlite3.Connection) -> None:
    """给已存在的表补新列。

    ``CREATE TABLE IF NOT EXISTS`` 对已建好的表什么都不做 —— 后续版本加字段时，
    老库不会自动长出这一列，写 INSERT 会直接报 no such column。
    这里按 PRAGMA 结果逐个补，语句本身幂等，多 worker 并发也只是重复执行一次 ALTER。
    """
    cols = {row[1] for row in con.execute("PRAGMA table_info(deals)")}
    for name, ddl in (
        ("img", "TEXT NOT NULL DEFAULT ''"),
        # cate_hit：这条好价是否命中「关注品类」。2026-10-29 之前分类是硬过滤
        # （不命中直接不入库），改成加权排序后需要把这枚标记持久化，
        # 否则每次列表查询都要重新解析配置 + 逐行比对。
        ("cate_hit", "INTEGER NOT NULL DEFAULT 0"),
    ):
        if name not in cols:
            con.execute(f"ALTER TABLE deals ADD COLUMN {name} {ddl}")


# ---------------------------------------------------------------- 配置


def get_settings() -> dict[str, str]:
    """取全部配置（缺项回落默认值，保证调用方永远拿得到完整字典）。"""
    out = dict(DEFAULT_SETTINGS)
    try:
        with get_conn(DB_PATH) as con:
            for k, v in con.execute("SELECT key, value FROM settings"):
                out[str(k)] = str(v)
    except sqlite3.Error:
        pass
    return out


def update_settings(patch: dict[str, Any]) -> dict[str, str]:
    """批量写配置（只接受已知 key，值统一转字符串）。"""
    known = set(DEFAULT_SETTINGS)
    rows = [(k, str(v)) for k, v in patch.items() if k in known]
    if rows:
        with get_conn(DB_PATH) as con:
            con.executemany(
                "INSERT INTO settings (key, value) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                rows,
            )
    return get_settings()


def _as_int(st: dict[str, str], key: str, default: int) -> int:
    try:
        return int(float(st.get(key, default)))
    except (TypeError, ValueError):
        return default


def _as_float(st: dict[str, str], key: str, default: float) -> float:
    try:
        return float(st.get(key, default))
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- 判定


def heat_of(worth: int, fav: int, cmt: int) -> float:
    """综合热度，仅用于列表排序（不参与入选判定）。"""
    return round(
        worth * HEAT_WEIGHTS["worth"]
        + fav * HEAT_WEIGHTS["fav"]
        + cmt * HEAT_WEIGHTS["cmt"],
        1,
    )


def cate_wanted(st: dict[str, str]) -> list[str]:
    """关注品类清单（逗号分隔，去空）。空列表 = 不设偏好。"""
    return [x.strip() for x in str(st.get("cate_filter", "") or "").split(",") if x.strip()]


def cate_blocked(st: dict[str, str]) -> list[str]:
    """品类黑名单（逗号分隔，去空）。命中即直接否决。"""
    return [
        x.strip() for x in str(st.get("cate_blacklist", "") or "").split(",") if x.strip()
    ]


def cate_hit(cate1: str, cate2: str, st: dict[str, str]) -> bool:
    """这条好价是否属于关注品类 —— **只用于排序加权，不参与入选判定**。

    为什么改成加权而不是过滤（2026-10-29 实测驱动的改动）：
    好价流里「电脑数码」只占 0.6%（517 条样本里 3 条），硬过滤下一天最多 1 条；
    而且门槛降到零也只有 1~1.4 条/天 —— 这不是调阈值能解决的问题。
    加权后全品类都参与判定（量给足了），关注品类乘 CATE_BOOST 排前面（不漏数码）。

    未配置关注品类时返回 False（谁都不加权），而不是 True：
    True 会让「没设偏好」变成「所有条目同等加权」，语义混乱且白算一遍。
    """
    wanted = cate_wanted(st)
    if not wanted:
        return False
    return cate1 in wanted or cate2 in wanted


def in_blacklist(cate1: str, cate2: str, st: dict[str, str]) -> bool:
    """是否命中品类黑名单。命中即否决，连阈值都不看。"""
    blocked = cate_blocked(st)
    if not blocked:
        return False
    return cate1 in blocked or cate2 in blocked


def judge(deal: Any, st: dict[str, str]) -> tuple[bool, str]:
    """按当前阈值判定一条好价是否「超值」。

    判定式：**不属于黑名单品类** 且 值率达标 且 (值 / 收藏 / 评论) 三项中满足 need_hits 项。
    关注品类只影响排序（在 list_deals 里乘权重），**不再影响能否入选**。

    为什么值率是硬门槛而不是"三选一"之一：
    SMZDM 上评论数高经常是因为大家在吵（价格争议、发货翻车），
    「被喷」也会推高评论数。值率是真人投票的直接结果，先过关才谈热度。

    为什么黑名单放在最前面：它挡的是「根本不是商品」的帖子
    （如「每日领京豆」这类 cate1=金融服务 的羊毛帖），这类条目热度可以很高，
    但不属于捡漏 —— 在阈值环节之后否决等于让它们先把榜单占满再删。

    为什么分类判定（旧的硬过滤）从判定里移除：
    全量参与判定才能拿到足够的量；而「我是来看数码的」这个诉求
    用排序加权满足更合理 —— 想看的在最上面，但别把其它漏掉。
    """
    cate1 = getattr(deal, "cate1", "") or ""
    cate2 = getattr(deal, "cate2", "") or ""

    if in_blacklist(cate1, cate2, st):
        return False, ""

    rated = deal.worth + deal.unworth
    if rated < MIN_RATED:
        return False, ""

    pct_min = _as_float(st, "worth_pct_min", 85.0)
    if deal.worth_pct < pct_min:
        return False, ""

    hits: list[str] = []
    if deal.worth >= _as_int(st, "worth_min", 50):
        hits.append(f"值{deal.worth}")
    if deal.fav >= _as_int(st, "fav_min", 50):
        hits.append(f"收藏{deal.fav}")
    if deal.cmt >= _as_int(st, "cmt_min", 20):
        hits.append(f"评论{deal.cmt}")

    if len(hits) >= _as_int(st, "need_hits", 2):
        # 用 .1f 而不是 :g —— 值率是 round 到 1 位的浮点，:g 在脏数据（未取整）
        # 下会原样吐出 92.3077%，看起来像精度丢了没处理。
        reason = f"值率{deal.worth_pct:.1f}% · " + " · ".join(hits)
        # 打上标记，用户才发现「置顶」不是随机 —— 也方便判断加权有没有生效
        if cate_hit(cate1, cate2, st):
            reason += " · 关注品类"
        return True, reason
    return False, ""


# ---------------------------------------------------------------- 写入


def upsert_deals(rows: Iterable[dict[str, Any]], st: dict[str, str]) -> tuple[int, int]:
    """写入本轮抓到的好价，返回 (新增条数, 命中条数)。

    - 已有记录只更新互动数与 last_seen（first_seen 保留首次发现时间）
    - 每条都重新判定，阈值改过之后下一轮自动生效，不需要回补脚本
    """
    added = 0
    picked = 0
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(DB_PATH) as con:
        for r in rows:
            heat = heat_of(r["worth"], r["fav"], r["cmt"])
            # 判定需要 worth_pct，Deal.to_row 已算好，这里构造轻量对象喂给 judge
            obj = type(
                "_D",
                (),
                {
                    "worth": r["worth"],
                    "unworth": r["unworth"],
                    "fav": r["fav"],
                    "cmt": r["cmt"],
                    "worth_pct": r["worth_pct"],
                    "cate1": r.get("cate1", ""),
                    "cate2": r.get("cate2", ""),
                },
            )()
            ok, reason = judge(obj, st)
            if ok:
                picked += 1
            hit = int(cate_hit(r.get("cate1", ""), r.get("cate2", ""), st))
            # 先查存在性再写：ON CONFLICT 的 rowcount 无论插入还是更新都是 1，
            # 用它判「新增」会永远等于总条数。先查一次最直观也最准确。
            exists = con.execute(
                "SELECT 1 FROM deals WHERE id=?", (r["id"],)
            ).fetchone()
            con.execute(
                """
                INSERT INTO deals (id,title,url,price,mall,cate1,cate2,tags,img,
                    worth,unworth,fav,cmt,worth_pct,heat,cate_hit,hhmm,
                    first_seen,last_seen,picked,pick_reason)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title, price=excluded.price, mall=excluded.mall,
                    cate1=excluded.cate1, cate2=excluded.cate2, tags=excluded.tags,
                    img=excluded.img,
                    worth=excluded.worth, unworth=excluded.unworth,
                    fav=excluded.fav, cmt=excluded.cmt,
                    worth_pct=excluded.worth_pct, heat=excluded.heat,
                    cate_hit=excluded.cate_hit,
                    hhmm=excluded.hhmm, last_seen=excluded.last_seen,
                    picked=excluded.picked, pick_reason=excluded.pick_reason
                """,
                (
                    r["id"], r["title"], r["url"], r.get("price", ""),
                    r.get("mall", ""), r.get("cate1", ""), r.get("cate2", ""),
                    r.get("tags", ""), r.get("img", ""),
                    r["worth"], r["unworth"], r["fav"], r["cmt"],
                    r["worth_pct"], heat, hit, r.get("hhmm", ""), now, now,
                    int(ok), reason,
                ),
            )
            if not exists:
                added += 1
    return added, picked


def rejudge(st: dict[str, str]) -> tuple[int, int]:
    """按当前阈值重算全部已有记录的入选状态，返回 (入选总数, 状态发生变化的条数)。

    为什么需要：阈值改了之后，库里已有记录不会自己变 —— 若只等下一轮抓取，
    用户要盯着「改完没反应」撑 20 分钟才知道调对了没有。这里让它立刻生效。
    关注品类 / 加权系数改动后也要走这里，否则 ``cate_hit`` 与排序还停在旧配置上。
    """
    picked = 0
    changed = 0
    with get_conn(DB_PATH) as con:
        rows = con.execute(
            "SELECT id,worth,unworth,fav,cmt,worth_pct,picked,cate1,cate2,cate_hit "
            "FROM deals"
        ).fetchall()
        for r in rows:
            c1 = r[7] or ""
            c2 = r[8] or ""
            obj = type(
                "_D",
                (),
                {
                    "worth": r[1], "unworth": r[2], "fav": r[3],
                    "cmt": r[4], "worth_pct": r[5],
                    "cate1": c1, "cate2": c2,
                },
            )()
            ok, reason = judge(obj, st)
            if ok:
                picked += 1
            hit = int(cate_hit(c1, c2, st))
            if bool(r[6]) != ok or int(r[9] or 0) != hit:
                changed += 1
            con.execute(
                "UPDATE deals SET picked=?, pick_reason=?, cate_hit=? WHERE id=?",
                (int(ok), reason, hit, r[0]),
            )
    return picked, changed


def log_round(
    *, pages: int, parsed: int, added: int, picked: int, banned: bool, errors: list[str]
) -> None:
    with get_conn(DB_PATH) as con:
        con.execute(
            "INSERT INTO fetch_log (ts,pages,parsed,added,picked,banned,errors) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                pages, parsed, added, picked, int(banned),
                " / ".join(errors)[:500],
            ),
        )


# ---------------------------------------------------------------- 读取


def list_deals(
    *,
    only_picked: bool = True,
    limit: int = 60,
    offset: int = 0,
    cate: str = "",
    q: str = "",
    hours: int = 0,
) -> dict[str, Any]:
    """好价列表。公开页与分享页都走这里。"""
    where: list[str] = []
    args: list[Any] = []
    if only_picked:
        where.append("picked=1")
    if cate:
        where.append("(cate1=? OR cate2=?)")
        args += [cate, cate]
    if q:
        where.append("title LIKE ?")
        args.append(f"%{q}%")
    if hours > 0:
        since = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
        where.append("first_seen >= ?")
        args.append(since)

    clause = ("WHERE " + " AND ".join(where)) if where else ""
    # 排序 = 综合热度 × 关注品类加权。boost 拼成数字字面量而不是绑定参数：
    # WHERE 的 args 已按顺序排好，插一个占位符就得重排索引，容易错位；
    # 而 boost 是自己解析出来的 float，round 之后不可能是注入载体。
    st = get_settings()
    boost = min(max(_as_float(st, "cate_boost", CATE_BOOST_DEFAULT), 1.0), 5.0)
    order = (
        f"heat * (CASE WHEN cate_hit=1 THEN {round(boost, 2)} ELSE 1.0 END) DESC, "
        f"first_seen DESC"
    )
    with get_conn(DB_PATH) as con:
        total = con.execute(f"SELECT COUNT(*) FROM deals {clause}", args).fetchone()[0]
        rows = con.execute(
            f"SELECT id,title,url,price,mall,cate1,cate2,tags,img,"
            f"worth,unworth,fav,cmt,"
            f"worth_pct,heat,hhmm,first_seen,picked,pick_reason,cate_hit "
            f"FROM deals {clause} ORDER BY {order} LIMIT ? OFFSET ?",
            [*args, max(1, min(limit, 200)), max(0, offset)],
        ).fetchall()
    items = [
        {
            "id": r[0], "title": r[1], "url": r[2], "price": r[3], "mall": r[4],
            "cate1": r[5], "cate2": r[6], "tags": r[7], "img": r[8],
            "worth": r[9], "unworth": r[10], "fav": r[11], "cmt": r[12],
            "worth_pct": r[13], "heat": r[14], "hhmm": r[15], "first_seen": r[16],
            "picked": bool(r[17]), "pick_reason": r[18],
            "cate_hit": bool(r[19]),
        }
        for r in rows
    ]
    return {"total": total, "items": items}


def seen_cate_names(days: int = 7) -> tuple[set[str], int]:
    """近 N 天在好价流里实际出现过的一级/二级分类名，以及同窗口的样本条数。

    用途是给「关注分类名是否还有效」做判定 —— 站点会改分类层级，
    配错/改名会让功能静默停摆。返回值带样本条数，是为了让调用方
    能在样本太少时**不要**急着报「分类名失效」（新库头几小时必然一条都没有）。
    """
    since = (datetime.now() - timedelta(days=max(1, days))).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(DB_PATH) as con:
        rows = con.execute(
            "SELECT cate1, cate2 FROM deals WHERE first_seen >= ?", (since,)
        ).fetchall()
    names: set[str] = set()
    for c1, c2 in rows:
        for v in (c1, c2):
            if v:
                names.add(str(v))
    return names, len(rows)


def stats() -> dict[str, Any]:
    """公开页顶部的健康摘要。

    带 ``cate_filter`` / ``cate_boost`` / ``thresholds`` 是刻意的：空列表时
    用户最需要知道的是「在盯什么、门槛多高」，否则「为什么一直没东西」说不清。
    这些都是非敏感的配置面；Cookie 绝不会出现在这里。
    """
    today = datetime.now().strftime("%Y-%m-%d")
    st = get_settings()
    with get_conn(DB_PATH) as con:
        total = con.execute("SELECT COUNT(*) FROM deals").fetchone()[0]
        picked_total = con.execute(
            "SELECT COUNT(*) FROM deals WHERE picked=1"
        ).fetchone()[0]
        today_added = con.execute(
            "SELECT COUNT(*) FROM deals WHERE first_seen LIKE ?", (f"{today}%",)
        ).fetchone()[0]
        today_picked = con.execute(
            "SELECT COUNT(*) FROM deals WHERE picked=1 AND first_seen LIKE ?",
            (f"{today}%",),
        ).fetchone()[0]
        last = con.execute(
            "SELECT ts,pages,parsed,added,picked,banned,errors FROM fetch_log "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return {
        "total": total,
        "picked_total": picked_total,
        "today_added": today_added,
        "today_picked": today_picked,
        "cate_filter": st.get("cate_filter", ""),
        "cate_boost": min(max(_as_float(st, "cate_boost", CATE_BOOST_DEFAULT), 1.0), 5.0),
        # 阈值一并下发：公开页的空态要说明「为什么空」，
        # 硬编码「值率 ≥85% 且三项取二」会在用户改完阈值后变成假话。
        "thresholds": {
            "worth_pct_min": _as_float(st, "worth_pct_min", 85.0),
            "worth_min": _as_int(st, "worth_min", 50),
            "fav_min": _as_int(st, "fav_min", 50),
            "cmt_min": _as_int(st, "cmt_min", 20),
            "need_hits": _as_int(st, "need_hits", 2),
        },
        "last_round": (
            {
                "ts": last[0], "pages": last[1], "parsed": last[2],
                "added": last[3], "picked": last[4],
                "banned": bool(last[5]), "errors": last[6],
            }
            if last
            else None
        ),
    }


def cate_stats(hours: int = 72) -> list[dict[str, Any]]:
    """近 N 小时各一级分类的抓到的条数 —— 供管理页调整「关注分类」用。

    为什么要有：分类名是站点侧定义的，会变，而且各品类在好价流里的占比
    差异极大（实测某时段食品生鲜 ~46%、电脑数码 ~2%）。把全量入库后的
    真实分布摆出来，用户才能判断自己关注的那几类到底有多少供给 ——
    否则只会看到「页面一直没东西」而不知道该调阈值还是该换品类。
    """
    since = (datetime.now() - timedelta(hours=max(1, hours))).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(DB_PATH) as con:
        rows = con.execute(
            "SELECT cate1, COUNT(*), SUM(picked) FROM deals WHERE first_seen >= ? "
            "GROUP BY cate1 ORDER BY COUNT(*) DESC",
            (since,),
        ).fetchall()
    return [
        {"cate": r[0] or "(未识别)", "count": r[1], "picked": r[2] or 0} for r in rows
    ]


def recent_rounds(limit: int = 20) -> list[dict[str, Any]]:
    with get_conn(DB_PATH) as con:
        rows = con.execute(
            "SELECT ts,pages,parsed,added,picked,banned,errors FROM fetch_log "
            "ORDER BY id DESC LIMIT ?",
            (max(1, min(limit, 100)),),
        ).fetchall()
    return [
        {
            "ts": r[0], "pages": r[1], "parsed": r[2], "added": r[3],
            "picked": r[4], "banned": bool(r[5]), "errors": r[6],
        }
        for r in rows
    ]


# ---------------------------------------------------------------- 清理


def cleanup() -> None:
    """按保留期清理历史（每轮抓取后调用一次，幂等）。"""
    now = datetime.now()
    deal_before = (now - timedelta(days=DEALS_KEEP_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    log_before = (now - timedelta(days=LOG_KEEP_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn(DB_PATH) as con:
        con.execute("DELETE FROM deals WHERE first_seen < ?", (deal_before,))
        con.execute("DELETE FROM fetch_log WHERE ts < ?", (log_before,))
