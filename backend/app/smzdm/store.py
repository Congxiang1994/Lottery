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
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Iterable

from app.common.db import get_conn
from app.smzdm.config import (
    ACTIVITY_WORDS,
    BRAND_ALLOW,
    BRAND_WEIGHT,
    CATE_ALLOW_DEFAULT,
    DEALS_KEEP_DAYS,
    DEFAULT_SETTINGS,
    HEAT_WEIGHTS,
    JUNK_WORDS,
    LOG_KEEP_DAYS,
    PRICE_TIER_TOP,
    PRICE_TIERS,
    SIGNAL_T1,
    SIGNAL_T1_WEIGHT,
    SIGNAL_T2,
    SIGNAL_T2_WEIGHT,
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
    discount    INTEGER NOT NULL DEFAULT 0,
    reporter    TEXT NOT NULL DEFAULT '',
    feed_tags   TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT '',
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    picked      INTEGER NOT NULL DEFAULT 0,
    pick_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_deals_picked ON deals(picked, heat DESC);
CREATE INDEX IF NOT EXISTS idx_deals_first ON deals(first_seen DESC);
-- ⚠️ 折扣索引不能写在这里：见 _ensure_columns 里的说明（旧库没有 discount 列，
-- 建索引会先于补列执行 → no such column）。它在 init() 里补列之后单独创建。

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
            # 🔴 依赖新列的索引必须在补列**之后**建。
            # 踩过的坑：把 `CREATE INDEX … ON deals(discount)` 写进 _SCHEMA，
            # 旧库上 `CREATE TABLE IF NOT EXISTS` 不会加列，紧接着建索引就抛
            # `sqlite3.OperationalError: no such column: discount`，
            # 结果 lifespan 里 init() 把整个应用启动打挂（线上全站 502）。
            # 本地用新建的库测不出来 —— 新库建表时就带上了 discount 列。
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_deals_discount "
                "ON deals(picked, discount)"
            )
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

            # 二次迁移（2026-10-29 当天）：精选流实测是「全量爆料流水」——
            # p1~p40 共 100 条里 0 条能过阈值（值中位数 0~1），拿它当入选来源
            # 只是每天灌几千条 picked=0 的数据。收紧为「不抓精选流」。
            # v2 曾经把这里写成 3，所以必须再迁一次，不能只靠默认值兜底。
            if "feed_v3" not in existing:
                con.execute(
                    "UPDATE settings SET value=? WHERE key='pages_per_round'",
                    (DEFAULT_SETTINGS["pages_per_round"],),
                )
                con.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES ('feed_v3','1')"
                )

            # 数码垂类迁移（2026-11-06）：库里 5953 条旧记录的 value_score /
            # signal_tier 全是 0，必须重算一次才有排序与 chip。
            # 🔴 用 INSERT OR IGNORE 抢标记：多 worker 同时 init 时只有一个能
            # 拿到 rowcount=1，避免 2 个 worker 各扫一遍全表。
            # 重算放在 flock 之外（下面）—— 它自己开连接写库，套在锁里会自锁。
            cur = con.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES ('digital_v1','1')"
            )
            need_rejudge = cur.rowcount == 1

    if need_rejudge:
        # 失败不能让启动挂掉：算不出排序只是「新列全 0、排序退化成时间序」，
        # 页面仍可用；而抛出去会让 gunicorn worker 起不来 → 全站 502。
        try:
            with _init_lock():
                rejudge(get_settings())
        except sqlite3.Error as e:  # noqa: BLE001
            print(f"[smzdm] 数码垂类初始化重算失败（不影响启动）：{e}", flush=True)


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
        # discount：整数百分比（44 = 4.4 折，0 = 未知）。唯一与「曝光」无关的
        # 判据 —— 刚发布的好价没有投票，但折扣是客观的。
        ("discount", "INTEGER NOT NULL DEFAULT 0"),
        # reporter：爆料人昵称（标签流专有）。把「个人爆料」变成可见信息，
        # 比按黑名单过滤运营号更透明。
        ("reporter", "TEXT NOT NULL DEFAULT ''"),
        # feed_tags：站点分类标签页的归属（手慢无/绝对值/历史低价…）+
        # 卡片自带的 /fenlei/ 品类标签。与营销标签 tags 不是一回事。
        ("feed_tags", "TEXT NOT NULL DEFAULT ''"),
        # source：tag / home / jingxuan / top，排查「这条从哪来」用
        ("source", "TEXT NOT NULL DEFAULT ''"),
        # ---------------- 2026-11-06 数码垂类 ----------------
        # value_score：价值分（价格档 × 信号权重 × 品牌系数），**落库而不是每次查表**。
        # 理由同 cate_hit：列表查询不该重新解析配置与跑正则。
        # 代价是改配置必须走 rejudge() 重算，这与现有 update_settings→rejudge 链路一致。
        ("value_score", "REAL NOT NULL DEFAULT 0"),
        # signal_tier：1 = T1 真漏（绝对值/历史低价），2 = T2 补贴，0 = 无信号（不入选）。
        # 前端用它决定 chip 颜色与文案；也用于「T1 必须排在 T2 之前」的自证。
        ("signal_tier", "INTEGER NOT NULL DEFAULT 0"),
        # price_num：到手价数值，仅供排序的次级键。
        # 为什么单存一列：SQLite 的 CAST(price AS REAL) 虽然能解析前导数字，
        # 但每行都要现算；且「见原帖」这类会得 0，排序语义得单独处理。
        ("price_num", "REAL NOT NULL DEFAULT 0"),
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


def cate_allow_list(st: dict[str, str]) -> list[str]:
    """品类白名单（逗号分隔，去空）。空列表 = 什么都不收。"""
    return _csv(st.get("cate_allow", CATE_ALLOW_DEFAULT))


# ---------------------------------------------------------------- 数码垂类判定
# 完整规格见 docs/deals-digital-spec.md。要点：数码两品类实测 94% 没有折扣数据、
# 92% 没有投票，所以不能用「折扣率 / 值率」判，改用**站点自己打的信号标签**
# （feed_tags 里的绝对值/历史低价/手慢无 + 标题里的百亿补贴/国补）。

_WS = re.compile(r"\s+")


def _csv(raw: str) -> list[str]:
    return [x.strip() for x in str(raw or "").split(",") if x.strip()]


def _alt_pattern(words: str) -> re.Pattern[str] | None:
    """把「a|b|c」词表编译成正则。

    容错到「配置被写坏也不崩」：用户可能在管理页把 piped 词表改成逗号分隔，
    或者留下空项 `a||b` —— 直接 join 成 `a||b` 会匹配空串，导致**所有条目都命中**，
    等于筛选完全失效且不报错。这里统一两种分隔符并丢掉空项。
    """
    items = [w for w in re.split(r"[|,]", str(words or "")) if w.strip()]
    if not items:
        return None
    return re.compile("|".join(re.escape(w.strip()) for w in items), re.I)


def signal_of(title: str, feed_tags: str, st: dict[str, str]) -> tuple[int, str]:
    """返回 (tier, 命中的词)。tier: 1=T1 真漏，2=T2 补贴，0=无信号。

    T1 先判：同时命中时按 T1 计（信号更强）。
    T1 允许来自 feed_tags —— 那是站点标签页的归属，比标题里的营销词可信。
    T2 只看标题：它本质是渠道活动词，出现在正文/标签里意义不同。
    """
    t1 = _alt_pattern(SIGNAL_T1)
    t2 = _alt_pattern(SIGNAL_T2)
    for src in (feed_tags or "", title or ""):
        if t1 and src:
            m = t1.search(src)
            if m:
                return 1, m.group(0)
    if t2 and title:
        m = t2.search(title)
        if m:
            return 2, m.group(0)
    return 0, ""


def value_score(price: float, tier: int, title: str, st: dict[str, str]) -> float:
    """价值分 = 价格档 × 信号权重 × 品牌系数。越大越靠前。

    价格档分段而不是连续：用户扫列表只需知道「是不是大件」。
    price <= 0（解析不出到手价）给最低档 0，避免脏数据被顶上来。
    """
    if price <= 0:
        pw = 0.0
    else:
        pw = PRICE_TIER_TOP
        for cap, coef in PRICE_TIERS:
            if price < cap:
                pw = coef
                break
    if tier == 1:
        sw = SIGNAL_T1_WEIGHT
    elif tier == 2:
        sw = SIGNAL_T2_WEIGHT
    else:
        sw = 0.0
    brand = _alt_pattern(BRAND_ALLOW)
    bw = BRAND_WEIGHT if brand and brand.search(title or "") else 1.0
    return round(pw * sw * bw, 3)


def judge_digital(deal: Any, st: dict[str, str]) -> tuple[bool, str, int]:
    """数码垂类判定，返回 (是否入选, 原因, tier)。

    顺序（每步都是硬否决，短路越早越省）：
      ① 品类白名单      不在 cate_allow 里 → 否决
      ③ 非商品 / 活动帖 会员、券、课程、清单、汇总…
      ④ 价格有效        解析不出到手价的 → 否决
      ⑤ 信号            无 T1/T2 → 否决
    """
    cate1 = getattr(deal, "cate1", "") or ""
    cate2 = getattr(deal, "cate2", "") or ""
    title = getattr(deal, "title", "") or ""
    feed_tags = getattr(deal, "feed_tags", "") or ""

    allow = cate_allow_list(st)
    if allow and not (cate1 in allow or cate2 in allow):
        return False, "", 0

    junk = _alt_pattern(JUNK_WORDS)
    if junk and junk.search(title):
        return False, "", 0
    activity = _alt_pattern(ACTIVITY_WORDS)
    if activity and activity.search(title):
        return False, "", 0

    price = float(getattr(deal, "cur_price", 0) or 0)
    if price <= 0:
        return False, "", 0

    tier, word = signal_of(title, feed_tags, st)
    if tier == 0:
        return False, "", 0

    label = ("历史低价" if tier == 1 else "补贴") if not word else word
    return True, label, tier


def evaluate(deal: Any, st: dict[str, str]) -> tuple[bool, str, int, float]:
    """统一判定入口：返回 (是否入选, 原因, tier, 价值分)。

    所有写入路径（抓取入库 / 全库重算）都走这里，保证三样派生值口径一致 ——
    分开算过一次，结果 upsert 里算出的 tier 与 rejudge 里的不一样，
    页面排序在「刚抓到」和「刚重算」之后会跳一下。

    只调一次 judge_digital：之前这里 judge() 与 judge_digital() 各跑一遍，
    等于每条好价多做一次正则匹配。judge() 现在只是它的双返回值包装（给外部
    调用方留的兼容接口），内部路径直接用这个函数即可。
    """
    ok, reason, tier = judge_digital(deal, st)
    if not ok:
        return False, reason, 0, 0.0
    price = float(getattr(deal, "cur_price", 0) or 0)
    title = getattr(deal, "title", "") or ""
    return ok, reason, tier, value_score(price, tier, title, st)


def judge(deal: Any, st: dict[str, str]) -> tuple[bool, str]:
    """判定一条好价是否入选。返回 (是否入选, 原因)。

    只是 :func:`judge_digital` 的「丢掉 tier」包装，给需要简单布尔结果的
    调用方用。2026-11-06 之前的「全品类 + 折扣优先」判定链已删除 ——
    它已不可达，留着只会让人误以为改 discount_direct 之类的配置能生效。
    """
    return judge_digital(deal, st)[:2]


# ---------------------------------------------------------------- 写入


_PRICE_NUM = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)")


def price_number(price: str) -> float:
    """从价格串里抠出到手价数字。失败返回 0（调用方必须把 0 当「不知道」）。"""
    m = _PRICE_NUM.match((price or "").strip())
    if not m:
        return 0.0
    try:
        return float(m.group(1))
    except ValueError:
        return 0.0


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
            # 判定需要 title / feed_tags / cur_price —— digital 模式的信号词就打在
            # 标题与 feed_tags 上，三个字段缺一个都会让判定恒为「无信号」。
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
                    "discount": r.get("discount", 0),
                    "cur_price": price_number(r.get("price", "")),
                    "title": r.get("title", ""),
                    "feed_tags": r.get("feed_tags", ""),
                },
            )()
            ok, reason, tier, score = evaluate(obj, st)
            if ok:
                picked += 1
            # cate_hit：2026-11-06 起品类是硬过滤，命中即必然入选 → 这枚标记
            # 已无意义。列保留只为旧库兼容，恒写 0。
            hit = 0
            # 先查存在性再写：ON CONFLICT 的 rowcount 无论插入还是更新都是 1，
            # 用它判「新增」会永远等于总条数。先查一次最直观也最准确。
            exists = con.execute(
                "SELECT 1 FROM deals WHERE id=?", (r["id"],)
            ).fetchone()
            con.execute(
                """
                INSERT INTO deals (id,title,url,price,mall,cate1,cate2,tags,img,
                    worth,unworth,fav,cmt,worth_pct,heat,cate_hit,hhmm,
                    discount,reporter,feed_tags,source,
                    value_score,signal_tier,price_num,
                    first_seen,last_seen,picked,pick_reason)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title, price=excluded.price, mall=excluded.mall,
                    cate1=excluded.cate1, cate2=excluded.cate2, tags=excluded.tags,
                    img=excluded.img,
                    worth=excluded.worth, unworth=excluded.unworth,
                    fav=excluded.fav, cmt=excluded.cmt,
                    worth_pct=excluded.worth_pct, heat=excluded.heat,
                    cate_hit=excluded.cate_hit,
                    hhmm=excluded.hhmm, last_seen=excluded.last_seen,
                    discount=excluded.discount,
                    reporter=excluded.reporter,
                    feed_tags=excluded.feed_tags,
                    source=excluded.source,
                    value_score=excluded.value_score,
                    signal_tier=excluded.signal_tier,
                    price_num=excluded.price_num,
                    picked=excluded.picked, pick_reason=excluded.pick_reason
                """,
                (
                    r["id"], r["title"], r["url"], r.get("price", ""),
                    r.get("mall", ""), r.get("cate1", ""), r.get("cate2", ""),
                    r.get("tags", ""), r.get("img", ""),
                    r["worth"], r["unworth"], r["fav"], r["cmt"],
                    r["worth_pct"], heat, hit, r.get("hhmm", ""),
                    r.get("discount", 0), r.get("reporter", ""),
                    r.get("feed_tags", ""), r.get("source", ""),
                    score, tier, r.get("cur_price", 0.0) or price_number(r.get("price", "")),
                    now, now, int(ok), reason,
                ),
            )
            if not exists:
                added += 1
    return added, picked


def rejudge(st: dict[str, str]) -> tuple[int, int]:
    """按当前阈值重算全部已有记录的入选状态，返回 (入选总数, 状态发生变化的条数)。

    为什么需要：阈值改了之后，库里已有记录不会自己变 —— 若只等下一轮抓取，
    用户要盯着「改完没反应」撑 20 分钟才知道调对了没有。这里让它立刻生效。
    品类白名单改动后要走这里，否则排序与信号档还停在旧配置上。
    2026-11-06 起还要重算 ``value_score`` / ``signal_tier`` / ``price_num`` ——
    排序与卡片 chip 都读这三列，漏了就会出现「改完判定变了、但顺序和标签没变」。
    """
    picked = 0
    changed = 0
    with get_conn(DB_PATH) as con:
        rows = con.execute(
            "SELECT id,worth,unworth,fav,cmt,worth_pct,picked,cate1,cate2,cate_hit,"
            "discount,price,title,feed_tags,value_score,signal_tier FROM deals"
        ).fetchall()
        for r in rows:
            c1 = r[7] or ""
            c2 = r[8] or ""
            price = price_number(r[11] or "")
            obj = type(
                "_D",
                (),
                {
                    "worth": r[1], "unworth": r[2], "fav": r[3],
                    "cmt": r[4], "worth_pct": r[5],
                    "cate1": c1, "cate2": c2,
                    "discount": r[10] or 0,
                    "cur_price": price,
                    "title": r[12] or "",
                    "feed_tags": r[13] or "",
                },
            )()
            ok, reason, tier, score = evaluate(obj, st)
            if ok:
                picked += 1
            hit = 0  # 见 upsert_deals 里的说明：品类硬过滤后此标记恒为 0
            if (
                bool(r[6]) != ok
                or int(r[9] or 0) != hit
                or int(r[15] or 0) != tier
                or abs(float(r[14] or 0) - score) > 1e-6
            ):
                changed += 1
            con.execute(
                "UPDATE deals SET picked=?, pick_reason=?, cate_hit=?, "
                "value_score=?, signal_tier=?, price_num=? WHERE id=?",
                (int(ok), reason, hit, score, tier, price, r[0]),
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
    # 排序：价值分降序 → 到手价降序 → 发现时间。
    # 为什么不再按折扣：数码两品类 94% 没有折扣数据，discount 恒为 0 时
    # 那一组排序键完全失效（所有行并列，等于没排序）。
    order = "value_score DESC, price_num DESC, first_seen DESC"
    with get_conn(DB_PATH) as con:
        total = con.execute(f"SELECT COUNT(*) FROM deals {clause}", args).fetchone()[0]
        rows = con.execute(
            f"SELECT id,title,url,price,mall,cate1,cate2,tags,img,"
            f"worth,unworth,fav,cmt,"
            # ⚠️ cate_hit 仍留在 SELECT 里占位（r[19]），只为保持下面下标不变。
            # 它 2026-11-06 起恒为 0、已不再返回给前端 —— 删列要连着改所有下标，
            # 风险大于收益；真要删，把 r[19] 之后的下标整体前移一位。
            f"worth_pct,heat,hhmm,first_seen,picked,pick_reason,cate_hit,"
            f"discount,reporter,feed_tags,source,value_score,signal_tier "
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
            "discount": r[20] or 0,
            "reporter": r[21] or "",
            "feed_tags": r[22] or "",
            "source": r[23] or "",
            "value_score": r[24] or 0,
            # 1 = T1 真漏，2 = T2 补贴。前端据此决定 chip 文案与配色。
            "signal_tier": int(r[25] or 0),
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
        # 空态文案的数据源：说清「只看这些品类 + 必须有这些信号」，
        # 否则用户看到空列表会以为抓取坏了。
        "cate_allow": st.get("cate_allow", CATE_ALLOW_DEFAULT),
        "signal_t1": SIGNAL_T1,
        "signal_t2": SIGNAL_T2,
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
    allow = set(_csv(get_settings().get("cate_allow", CATE_ALLOW_DEFAULT)))
    with get_conn(DB_PATH) as con:
        rows = con.execute(
            "SELECT cate1, COUNT(*), SUM(picked) FROM deals WHERE first_seen >= ? "
            "GROUP BY cate1 ORDER BY COUNT(*) DESC",
            (since,),
        ).fetchall()
    return [
        {
            "cate": r[0] or "(未识别)",
            "count": r[1],
            "picked": r[2] or 0,
            # 管理页的品类多选直接用这个标记，不必再拿 cate_allow 字符串去前端拆
            "allowed": (r[0] or "") in allow,
        }
        for r in rows
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
