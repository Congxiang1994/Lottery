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

/**
 * 信号 chip：数码垂类的主判据（2026-11-06 起）。
 *
 * 为什么不再显示折扣：数码两品类实测 94% 没有折扣数据，discount 恒为 0 时
 * 「几折」这个 chip 根本不出现，卡片上最重要的一格就是空的。
 * 换成信号档后每条都有东西可看：
 *   T1 = 站点把它归到「绝对值/历史低价/手慢无」→ 红底，最劲爆
 *   T2 = 只是「百亿补贴/国补」这类渠道补贴 → 金边，次一档
 */
function SignalChip({ tier, label }: { tier: number; label: string }) {
  if (tier === 1) {
    return (
      <span
        className="shrink-0 rounded-md bg-brand-red px-1.5 py-0.5 text-[11px] font-extrabold text-white"
        title="站点把它归入「绝对值 / 历史低价 / 手慢无」——真漏信号"
      >
        {label}
      </span>
    );
  }
  if (tier === 2) {
    return (
      <span
        className="shrink-0 rounded-md border border-brand-gold/45 bg-brand-gold/12 px-1.5 py-0.5 text-[11px] font-bold text-brand-gold"
        title="渠道补贴（百亿补贴 / 国补）—— 只说明有补贴，不代表史低"
      >
        {label}
      </span>
    );
  }
  return null;
}

/**
 * 卡片上那枚 chip 显示哪个词。
 *
 * 优先用后端 `pick_reason`（它就是**实际**命中的那个词，如「历史低价」「百亿补贴」）——
 * 这样 chip 和「为什么入选」永远一致。取不到才按档位给个通用词。
 * ⚠️ 别在这里自己重新匹配词表：前端词表与后端配置不同步时，
 *    会出现「chip 写历史低价、但后端其实是因为百亿补贴才放进来的」。
 */
function pickSignalLabel(d: Deal): string {
  const r = (d.pick_reason || "").trim();
  if (r) {
    // pick_reason 形如「历史低价」「百亿补贴 · 关注品类」，取第一段
    const first = r.split(/[·|]/)[0].trim();
    if (first) return first;
  }
  return d.signal_tier === 1 ? "真漏" : "补贴";
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
  const { title, cond } = useMemo(() => splitTitle(d.title), [d.title]);
  const price = splitPrice(d.price);

  // 元信息只留「在哪买 / 什么时候 / 值不值」三类。上一版一排 5 个图标 + 3 个
  // 彩色 pill 是最大噪音源；值为 0 时也不再显示「0% 值」（新爆料还没人投票，
  // 显示 0% 会被误读成「大家都觉得不值」）。收藏/评论/值数收进卡片 title 提示。
  //
  // ⚠️ 信号词（绝对值/历史低价/百亿补贴）**只出现在 chip 上**，不再重复进元信息行：
  // 2026-11-06 实测同一张卡上「绝对值」出现两次，而窄屏下第二行还会被折行，
  // 看起来像两条不同的信息。
  const meta: { text: string; cls?: string }[] = [];
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
          {/* 主 chip：数码垂类下用「信号档」（历史低价/绝对值/百亿补贴/国补）。
              legacy 模式仍显示折扣 —— 两种模式的 chip 语义不同，不能混用。 */}
          {d.signal_tier > 0 ? (
            <SignalChip tier={d.signal_tier} label={pickSignalLabel(d)} />
          ) : (
            d.discount > 0 && (
              <span
                className="shrink-0 rounded-md bg-paper-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-paper-700"
                title="按正文里的原价与到手价计算"
              >
                {(d.discount / 10).toFixed(1)}折
              </span>
            )
          )}
          {price ? (
            <span className="shrink-0 font-extrabold tracking-tight text-paper-900">
              <span className="mr-px text-[11px] font-bold">¥</span>
              <span className="text-[19px] tabular-nums">{price.num}</span>
            </span>
          ) : (
            <span className="shrink-0 text-[15px] font-extrabold text-paper-900">见原帖</span>
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

/** 词表缩短显示：后端下发的是「绝对值|历史低价|手慢无|…」这种长串，
 *  空态里全列出来会撑成三行。只取前 3 个 + 「等」。 */
function shortWords(raw?: string): string {
  const parts = String(raw || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return "—";
  return parts.slice(0, 3).join(" / ") + (parts.length > 3 ? " 等" : "");
}

function EmptyState({ stats }: { stats: DealStats | null }) {
  const last = stats?.last_round;
  return (
    <div className="rounded-2xl border border-paper-100 glass p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-red/10 text-brand-red2">
        <Flame size={22} />
      </div>
      <h3 className="mt-3 text-base font-semibold text-paper-900">
        这个时段没有带信号的数码好价
      </h3>
      {/* 品类与词表都从接口取，不写死 —— 改了品类后端会跟着变，
          写死的话空态会变成假话（说「在看电脑数码」但其实已经换了） */}
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-paper-700">
        现在只看「{stats?.cate_allow || "电脑数码,数码配件"}」，并且要求标题或标签里带
        <b className="mx-0.5 font-semibold text-paper-900">真漏信号</b>
        （{shortWords(stats?.signal_t1)}）或
        <b className="mx-0.5 font-semibold text-paper-900">补贴信号</b>
        （{shortWords(stats?.signal_t2)}）。
        没有这些词的一律不入选 —— 空着是真的没漏，不是抓取坏了。
      </p>

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
        去调整品类
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
            只盯{stats?.cate_allow || "电脑数码 / 数码配件"}里带
            <b className="mx-0.5 font-semibold text-paper-900">真漏信号</b>
            （绝对值 / 历史低价 / 手慢无）或
            <b className="mx-0.5 font-semibold text-paper-900">补贴信号</b>
            的条目，点卡片直达原站。
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
