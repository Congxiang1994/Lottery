import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Flame, RefreshCw, Settings2 } from "lucide-react";
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

/**
 * 标题拆分：标签流标题普遍带营销前缀（「20点开始、今日必买：」「88VIP、」
 * 「淘金币可用、限地区：」）。一屏 60 条时这些词每行开头都出现，真正要认的
 * 商品名被推到第二行甚至折叠 —— 这是上一版「标题很乱」的主因。
 * 只在前缀命中「购买条件」词时才拆，避免误伤「新品：xxx」这类本来就是商品名的标题。
 */
const TITLE_COND_HINT = /VIP|会员|淘金币|限地区|点开始|点开抢|今日必买|补贴|预售|券后|可用|开抢/;
/** 纯营销词直接丢掉，不占任何版面 */
const TITLE_PURE_MARKETING = /今日必买|今日爆款|绝对值|手慢无/;

function splitTitle(raw: string): { title: string; cond: string } {
  const i = raw.search(/[：:]/);
  if (i <= 0 || i > 28) return { title: raw, cond: "" };
  const head = raw.slice(0, i);
  if (!TITLE_COND_HINT.test(head)) return { title: raw, cond: "" };
  const cond = head
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter((s) => s && !TITLE_PURE_MARKETING.test(s))
    .map((s) => s.replace(/^(\d{1,2})点开始$/, "$1 点开抢"))
    .join(" · ");
  return { title: raw.slice(i + 1).trim(), cond };
}

/**
 * 价格拆分：把「多少钱」和「怎么算出来的」分开。
 * 数据里是 `19.2元返20积分后`、`2299.65元（晒单返 700 元、淘金币低至2257.15元）`
 * 这种整串 —— 同一字号排出来，主数字被后面的说明淹没，扫视时读到的是
 * 「元返20积分后」。拆成 num（大字）+ note（小字、单行截断）后，
 * 主数字才是卡片里最重的东西。
 */
function splitPrice(raw: string): { num: string; note: string } | null {
  if (!raw) return null;
  const m = /^\s*[¥￥]?\s*([\d,.]+)\s*(?:元)?\s*([\s\S]*)$/.exec(raw);
  if (!m) return null;
  return { num: m[1], note: (m[2] || "").trim() };
}

/* ------------------------------ 卡片 ------------------------------ */

function DealCard({ d }: { d: Deal }) {
  const tags = useMemo(() => pickTags(d), [d.feed_tags, d.tags]);
  const { title, cond } = useMemo(() => splitTitle(d.title), [d.title]);
  const price = splitPrice(d.price);
  const dropTag = tags.find(isDropTag);

  // 元信息只留「在哪买 / 什么时候 / 值不值」三类。上一版一排 5 个图标 + 3 个
  // 彩色 pill 是最大噪音源；值为 0 时也不再显示「0% 值」（新爆料还没人投票，
  // 显示 0% 会被误读成「大家都觉得不值」）。收藏/评论/值数收进卡片 title 提示。
  const meta: { text: string; cls?: string }[] = [];
  if (dropTag) meta.push({ text: dropTag, cls: "font-semibold text-brand-red2" });
  if (cond) meta.push({ text: cond });
  if (d.mall) meta.push({ text: d.mall });
  meta.push({ text: relTime(d.first_seen) });
  if (d.worth > 0) meta.push({ text: `${fmtPct(d.worth_pct)}% 值`, cls: "font-semibold text-brand-red2" });

  return (
    <a
      href={d.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 gap-3.5 rounded-2xl border border-paper-100 glass card-hover p-3.5 transition press sm:gap-4 sm:p-4"
      title={`${d.title}${d.reporter ? `\n爆料人：${d.reporter}` : ""}\n值 ${d.worth} / 不值 ${d.unworth} · 收藏 ${d.fav} · 评论 ${d.cmt}`}
    >
      <div className="h-[88px] w-[88px] shrink-0 self-center sm:h-24 sm:w-24">
        {d.img ? (
          <img
            src={d.img}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full rounded-xl border border-paper-100 object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center rounded-xl border border-paper-100 bg-paper-100/60 text-paper-400">
            <Flame size={20} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 break-words text-[14px] font-semibold leading-[1.45] text-paper-900 sm:text-[15px]">
            {title}
          </h3>
          <ArrowUpRight
            size={13}
            className="mt-1 shrink-0 text-paper-300 transition group-hover:text-brand-red2"
          />
        </div>

        {/* 价格行：折扣 → 金额。说明文字单独一行（见下），不跟金额抢同一行 ——
            手机上「1.1折 ¥2299.65（晒单返 700 元…」只剩 6 个字的位置，
            截断成「（晒单返 70…」比不显示还乱。红色只留给「几折」和「值率」，
            价格用墨色（压米白 12:1） */}
        <div className="mt-2 flex items-center gap-2">
          {d.discount > 0 && (
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums ${discountClass(d.discount)}`}
              title="按正文里的原价与到手价计算"
            >
              {(d.discount / 10).toFixed(1)}折
            </span>
          )}
          {price ? (
            <span className="shrink-0 font-extrabold tracking-tight text-paper-900">
              <span className="mr-px text-[11px] font-bold">¥</span>
              <span className="text-[19px] tabular-nums">{price.num}</span>
            </span>
          ) : (
            <span className="shrink-0 text-[15px] font-extrabold text-paper-900">见原帖</span>
          )}
          {/* 关注品类标记跟着价格走、靠右：放元信息行末尾时会在窄屏被挤到下一行，
              单独一个「关注」吊在左边，看着像另一条信息 */}
          {d.cate_hit && (
            <span className="shrink-0 rounded bg-brand-gold/15 px-1 py-px text-[10px] font-medium leading-3 text-paper-800">
              关注
            </span>
          )}
        </div>

        {price?.note && (
          <div
            className="mt-1 truncate text-[11px] leading-4 text-paper-700"
            title={price.note}
          >
            {price.note.replace(/^[（(]|[）)]$/g, "")}
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-y-1 text-[11px] leading-4 text-paper-700">
          {meta.map((m, i) => (
            <span key={`${m.text}-${i}`} className="whitespace-nowrap">
              <span className={m.cls}>{m.text}</span>
              {i < meta.length - 1 && <span className="px-1 text-paper-300">·</span>}
            </span>
          ))}
        </div>
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
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-paper-900">捡漏</h1>
          <p className="mt-1 text-xs text-paper-700">
            盯「什么值得买」手慢无 / 绝对值 / 历史低价榜，按折扣从深到浅排，点卡片直达原站。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
        <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-xl border border-paper-100 bg-paper-100/50 px-3.5 py-2 text-[11px] text-paper-700">
          <span>
            今日新增 <b className="font-semibold tabular-nums text-paper-900">{stats.today_added}</b>
          </span>
          <span>
            今日命中 <b className="font-semibold tabular-nums text-brand-red2">{stats.today_picked}</b>
          </span>
          {/* 累计口径只留给桌面：手机上它们会把「更新时间」挤到第二行，
              而扫列表时真正要看的是「今天有没有新货」 */}
          <span className="hidden sm:inline">
            入库 <b className="font-semibold tabular-nums text-paper-900">{stats.total}</b>
          </span>
          <span className="hidden sm:inline">
            入选 <b className="font-semibold tabular-nums text-paper-900">{stats.picked_total}</b>
          </span>
          {stats.last_round && <span>{relTime(stats.last_round.ts)}更新</span>}
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
          <span className="ml-auto self-center text-[11px] text-paper-700">
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
