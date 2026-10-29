import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Clock,
  Flame,
  MessageSquare,
  RefreshCw,
  Settings2,
  Star,
  ThumbsUp,
  TrendingDown,
} from "lucide-react";
import { Deal, DealList, DealStats } from "./api";
import { DEFAULT_HOURS, fetchDeals, readPrefetched } from "./prefetch";
import { ErrorBlock, errText } from "../common/State";

/**
 * 什么值得买 · 捡漏 /deals（公开页）
 *
 * 只展示「值友认可度高」的好价（后端 SQL 层硬过滤 picked=1），点卡片直接跳原站下单页。
 * 版式：信息流双列。捡漏是「扫一眼有没有漏」的场景，密度比美观重要，
 *   所以每张卡压到三行：标题 / 价格+指标 / 标签。
 *
 * 「关注品类」只影响排序（heat × 权重），不限制入选 —— 所以列表里有非数码商品是
 * 刻意的：宁可多给几条，也不因为品类太窄而整天空着。命中的会带「关注」标记。
 *
 * 为什么列表可能很空：判定式是「值率达标 且 值/收藏/评论 三项满足 N 项」，
 * 门槛由管理页配置。空列表是**正常的**，不是坏了 —— 所以空态必须给出
 * 「最近一轮抓了多少条」与「当前门槛具体是多少」的证据，
 * 否则用户没法区分「没抓到」和「抓到了但都不够格」。
 */

/* ------------------------------ 工具 ------------------------------ */

function relTime(s: string): string {
  if (!s) return "";
  const t = new Date(s.replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return s;
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 活动类标签是噪音（每个商品都挂一个），只留有信息量的降价/新低信号 */
const NOISE_TAGS = /美淘节|双11|双十一|618|818|年货节|开学季|值得买|会员日/i;

/**
 * 挑要展示的标签。
 *
 * 优先 `feed_tags`（站点分类标签页的归属：手慢无 / 绝对值 / 历史低价 / 值友专享），
 * 它比卡片上的营销标签（`tags`）可信得多 —— 营销标签每个商品都挂一个，
 * 而「手慢无」是站点真的把它归到这个榜里了。
 * 只有标签流没有营销标签块，所以标签页条目的 `tags` 本来就是空的。
 */
function pickTags(d: Deal): string[] {
  const src = (d.feed_tags || d.tags || "").trim();
  if (!src) return [];
  return src
    .split("|")
    .map((t) => t.trim())
    .filter((t) => t && !NOISE_TAGS.test(t))
    .slice(0, 3);
}

function isDropTag(t: string): boolean {
  return /新低|低价|历史|降价|直降|补贴|绝对值|手慢无|清仓/.test(t);
}

/**
 * 折扣档位样式。三档而不是连续渐变 ——
 * 用户扫列表时只关心「这是不是狠漏」，不需要精确到小数点。
 */
function discountClass(d: number): string {
  if (d <= 30) return "bg-brand-red text-white";
  if (d <= 50) return "bg-brand-red/12 text-brand-red2 border border-brand-red/30";
  return "bg-paper-100 text-paper-700";
}

/** 值率显示。后端已 round 到 1 位，这里再兜一道 ——
 *  一旦有脏数据（老库/手工写入）没取整，页面上会出现 `92.3076923076923%`。 */
function fmtPct(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/* ------------------------------ 卡片 ------------------------------ */

function DealCard({ d }: { d: Deal }) {
  const tags = useMemo(() => pickTags(d), [d.feed_tags, d.tags]);
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3.5 rounded-2xl border border-paper-100 glass card-hover p-3.5 transition press"
      title={d.title}
    >
      {d.img ? (
        <img
          src={d.img}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[86px] w-[86px] shrink-0 rounded-xl border border-paper-100 object-cover"
        />
      ) : (
        <div className="grid h-[86px] w-[86px] shrink-0 place-items-center rounded-xl border border-paper-100 bg-paper-100/60 text-paper-400">
          <Flame size={20} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-[14px] font-semibold leading-snug text-paper-900">
            {d.title}
          </h3>
          <ArrowUpRight
            size={14}
            className="mt-0.5 shrink-0 text-paper-400 transition group-hover:text-brand-red2"
          />
        </div>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* 折扣徽标放价格前：它是「这条劲不劲爆」的第一眼答案，
              比价格数字本身更有信息量（6999 元不一定是漏，3 折才是） */}
          {d.discount > 0 && (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${discountClass(d.discount)}`}
              title="按正文里的原价与到手价计算"
            >
              {(d.discount / 10).toFixed(1)}折
            </span>
          )}
          <span className="text-[15px] font-bold tabular-nums text-brand-red2">
            {d.price || "见原帖"}
          </span>
          {d.mall && (
            <span className="rounded-md bg-paper-100 px-1.5 py-0.5 text-[10px] font-medium text-paper-700">
              {d.mall}
            </span>
          )}
          {d.cate_hit && (
            <span
              className="rounded-md bg-brand-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-paper-800"
              title="命中关注品类，排序已加权"
            >
              关注
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-paper-600">
          {/* 值率用红不用绿：本站语境是 A 股习惯（涨=红、跌=绿），
              值率越高越好 → 红；配朝上的箭头，读起来就是「涨」。
              与左侧价格同色系，一眼能连成「便宜 + 值」一组。 */}
          <span
            className="inline-flex items-center gap-1 font-semibold text-brand-red2"
            title={`${d.worth} 人认为值 / ${d.unworth} 人认为不值`}
          >
            <TrendingDown size={11} className="rotate-180" />
            {fmtPct(d.worth_pct)}% 值
          </span>
          <span className="inline-flex items-center gap-1" title="认为值的次数">
            <ThumbsUp size={11} />
            {d.worth}
          </span>
          <span className="inline-flex items-center gap-1" title="收藏数">
            <Star size={11} />
            {d.fav}
          </span>
          <span className="inline-flex items-center gap-1" title="评论数">
            <MessageSquare size={11} />
            {d.cmt}
          </span>
          <span className="inline-flex items-center gap-1 text-paper-500" title="首次发现时间">
            <Clock size={11} />
            {relTime(d.first_seen)}
          </span>
        </div>

        {(tags.length > 0 || d.reporter) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isDropTag(t)
                    ? "bg-brand-red/10 text-brand-red2"
                    : "bg-paper-100 text-paper-700"
                }`}
              >
                {t}
              </span>
            ))}
            {/* 爆料人：用户要的是「个人爆料的真漏」，把谁挖的摆出来，
                比用黑名单悄悄过滤运营号更透明 —— 他能自己判断可信度 */}
            {d.reporter && (
              <span className="ml-auto truncate text-[10px] text-paper-500" title={`爆料人：${d.reporter}`}>
                {d.reporter}
              </span>
            )}
          </div>
        )}
      </div>
    </a>
  );
}

/* ------------------------------ 空态 ------------------------------ */

function EmptyState({ stats }: { stats: DealStats | null }) {
  const last = stats?.last_round;
  const t = stats?.thresholds;
  return (
    <div className="rounded-2xl border border-paper-100 glass p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-red/10 text-brand-red2">
        <Flame size={22} />
      </div>
      <h3 className="mt-3 text-base font-semibold text-paper-900">这个时段还没有达到门槛的好价</h3>
      {/* 阈值从接口取而不是写死：用户改完阈值后，写死的文案会变成假话 */}
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-paper-600">
        {t ? (
          t.discount_mode ? (
            <>
              当前门槛：正文里能算出折数的，{(t.discount_direct / 10).toFixed(1)} 折以内直接入选、
              {(t.discount_assist / 10).toFixed(1)} 折以内需值友热度；算不出折数的才看
              值率 ≥{t.worth_pct_min}% 且 值 ≥{t.worth_min} / 收藏 ≥{t.fav_min} /
              评论 ≥{t.cmt_min} 三项中满足 {t.need_hits} 项。换个时间范围或到管理页放宽。
            </>
          ) : (
            <>
              当前门槛：值率 ≥{t.worth_pct_min}%，且 值 ≥{t.worth_min} / 收藏 ≥{t.fav_min} /
              评论 ≥{t.cmt_min} 三项中满足 {t.need_hits} 项。换个时间范围，或到管理页放宽。
            </>
          )
        ) : (
          "判定门槛较高，放宽条件或换个时间范围再看看。"
        )}
      </p>
      {stats?.cate_filter ? (
        <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-paper-500">
          关注品类「{stats.cate_filter}」只影响排序（命中会往前排 ×{stats.cate_boost}），
          不再限制入选 —— 所以列表空着是真的没有够格的好价，不是品类太窄。
        </p>
      ) : null}

      {last && (
        <div className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl bg-paper-100/70 px-3 py-2 text-[11px] text-paper-700">
          <span>最近一轮 {last.ts}</span>
          <span>抓取 {last.parsed} 条</span>
          <span>命中 {last.picked} 条</span>
          {last.banned && <span className="font-semibold text-brand-red2">被风控，已自动退避</span>}
        </div>
      )}

      <Link
        to="/deals-admin"
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-paper-200 px-4 py-2 text-xs font-medium text-paper-800 transition hover:border-brand-gold/50 hover:bg-brand-gold/10"
      >
        <Settings2 size={13} />
        去调整阈值
      </Link>
    </div>
  );
}

/* ------------------------------ 页面 ------------------------------ */

const RANGES = [
  { label: "24 小时", hours: 24 },
  { label: "3 天", hours: 72 },
  { label: "7 天", hours: 168 },
  { label: "全部", hours: 0 },
];

// 默认最近 24 小时：捡漏拼的是「刚漏」，三天前的价大概率已经涨价或售罄，
// 混在里面只会稀释实时感。更早的仍在库里，切「3 天 / 7 天」随时能看。
// 不做 localStorage 记忆 —— 「默认」就该是每次打开看到的那个值。
// ⚠️ 常量在 ./prefetch 里（App 预取时要用同一个值），这里只做转出。

/* ------------------------------ 本地缓存 ------------------------------ */

/**
 * 列表缓存（stale-while-revalidate）。
 *
 * 为什么值得做：这个页面的瓶颈根本不在服务端（list_deals 实测 0.83 ms），
 * 而在「HTML/JS 下完才开始发请求」—— 两个数据接口被压在关键路径最末端，
 * 用户盯着空白等一整轮网络往返。把上次结果存进 localStorage，打开就能
 * 立刻铺满列表，真数据在后台覆盖进来。体感是「秒开」，代价只有可能是
 * 几十秒前的数据（右上角刷新按钮一直在转，随时可手动拉最新）。
 *
 * 只存最近一次、按 hours 分键：切档位时键对不上就不用 —— 宁可显示骨架，
 * 也不能拿 24 小时的列表冒充 7 天的。
 */
const CACHE_KEY = "deals_cache_v1";
/** 超过 6 小时不再当首屏数据用：那已经不是「稍旧」，而是另一个时段的行情了 */
const CACHE_MAX_AGE_MS = 6 * 3600_000;

interface Cached {
  hours: number;
  ts: number;
  list: DealList;
  stats: DealStats;
}

function readCache(hours: number): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (c?.hours !== hours || !Array.isArray(c.list?.items) || !c.stats) return null;
    if (!(Date.now() - c.ts < CACHE_MAX_AGE_MS)) return null;
    return c;
  } catch {
    // 缓存内容坏了（旧版本结构、手工改过）→ 当作没有，不要因它把整页搞崩
    return null;
  }
}

function writeCache(hours: number, list: DealList, stats: DealStats) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ hours, ts: Date.now(), list, stats }));
  } catch {
    // 隐私模式 / 配额满：缓存是纯优化，写不进去也只是回到「每次都等网络」
    /* ignore */
  }
}

export default function Deals() {
  // 首帧数据来源优先级：localStorage 缓存 → App 已预取的结果 → 空（走骨架）
  // useMemo 保证只在首次渲染算一次，后面的渲染（含每次 load 的 setState）不再碰。
  const boot = useMemo<{ list: DealList; stats: DealStats } | null>(() => {
    const c = readCache(DEFAULT_HOURS);
    if (c) return { list: c.list, stats: c.stats };
    const p = readPrefetched(DEFAULT_HOURS);
    return p ? { list: p[0], stats: p[1] } : null;
  }, []);
  const [items, setItems] = useState<Deal[]>(boot?.list.items ?? []);
  const [total, setTotal] = useState(boot?.list.total ?? 0);
  const [stats, setStats] = useState<DealStats | null>(boot?.stats ?? null);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  // 有初始数据就不进骨架：内容已经在屏幕上，这次请求只是刷新
  const [loading, setLoading] = useState(!boot);
  const [err, setErr] = useState<string | null>(null);
  const prevHours = useRef(DEFAULT_HOURS);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setErr(null);
    try {
      // 走 fetchDeals（不是直接调 api）：App 在 /deals 路由上一挂载就预取了，
      // 这里要么命中同一个 inflight Promise，要么命中 5 秒内的结果 —— 不会发第二次。
      const [list, st] = await fetchDeals(h);
      setItems(list.items);
      setTotal(list.total);
      setStats(st);
      writeCache(h, list, st);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (prevHours.current !== hours) {
      prevHours.current = hours;
      // 切档位：先把旧档列表清掉（命中新档缓存则直接铺上），避免两个时段的数据混显
      const c = readCache(hours);
      setItems(c?.list.items ?? []);
      setTotal(c?.list.total ?? 0);
      setErr(null);
    }
    void load(hours);
  }, [hours, load]);

  return (
    <div className="pt-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-paper-900">捡漏</h1>
          <p className="mt-1 text-xs text-paper-600">
            盯「什么值得买」的手慢无 / 绝对值 / 历史低价榜，按折扣深度排序 ——
            折得越狠越靠前。点卡片直接去原站。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/deals-admin"
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 text-paper-700 transition hover:border-brand-gold/50 hover:bg-brand-gold/10"
            title="阈值与抓取设置"
          >
            <Settings2 size={15} />
          </Link>
          <button
            onClick={() => void load(hours)}
            disabled={loading}
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 text-paper-700 transition hover:border-brand-gold/50 hover:bg-brand-gold/10 disabled:opacity-40"
            title="刷新"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      {/* 统计条 */}
      {stats && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-paper-100 bg-paper-100/50 px-3.5 py-2 text-[11px] text-paper-700">
          <span>
            今日新增 <b className="tabular-nums text-paper-900">{stats.today_added}</b> 条
          </span>
          <span>
            今日命中 <b className="tabular-nums text-brand-red2">{stats.today_picked}</b> 条
          </span>
          <span className="text-paper-500">
            累计 {stats.total} 条 / 入选 {stats.picked_total} 条
          </span>
          {stats.last_round && (
            <span className="text-paper-500">最近抓取 {relTime(stats.last_round.ts)}</span>
          )}
        </div>
      )}

      {/* 时间范围 */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r.hours}
            onClick={() => setHours(r.hours)}
            aria-pressed={hours === r.hours}
            className={`press rounded-full border px-3 py-1 text-xs font-medium transition ${
              hours === r.hours
                ? "border-brand-red/40 bg-brand-red/10 text-brand-red2"
                : "border-paper-200 text-paper-700 hover:bg-paper-100"
            }`}
          >
            {r.label}
          </button>
        ))}
        {items.length > 0 && (
          <span className="ml-auto self-center text-[11px] text-paper-500">
            共 {total} 条
          </span>
        )}
      </div>

      {err && <ErrorBlock message={err} onRetry={() => void load(hours)} className="mt-5" />}

      <div className="mt-4">
        {/* 骨架只在「真的没东西可看」时出现：命中本地缓存时列表已经渲染在屏幕上，
            loading 期间继续显示它（后台刷新，不闪） */}
        {loading && items.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[124px] animate-pulse rounded-2xl border border-paper-100 bg-paper-100/50"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState stats={stats} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((d) => (
              <DealCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-8 text-center text-[10px] leading-relaxed text-paper-500">
        数据来自什么值得买公开好价页，仅作个人选品参考 · 价格与库存以原站为准
      </p>
    </div>
  );
}
