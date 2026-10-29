import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Deal, DealStats, dealsApi } from "./api";
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

function usefulTags(raw: string): string[] {
  return (raw || "")
    .split("|")
    .map((t) => t.trim())
    .filter((t) => t && !NOISE_TAGS.test(t))
    .slice(0, 2);
}

function isDropTag(t: string): boolean {
  return /新低|低价|历史|降价|直降|补贴|绝对值|手慢无|清仓/.test(t);
}

/** 值率显示。后端已 round 到 1 位，这里再兜一道 ——
 *  一旦有脏数据（老库/手工写入）没取整，页面上会出现 `92.3076923076923%`。 */
function fmtPct(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/* ------------------------------ 卡片 ------------------------------ */

function DealCard({ d }: { d: Deal }) {
  const tags = useMemo(() => usefulTags(d.tags), [d.tags]);
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
          <span
            className="inline-flex items-center gap-1 font-semibold text-emerald-700"
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

        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
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
          <>
            当前门槛：值率 ≥{t.worth_pct_min}%，且 值 ≥{t.worth_min} / 收藏 ≥{t.fav_min} /
            评论 ≥{t.cmt_min} 三项中满足 {t.need_hits} 项。换个时间范围，或到管理页放宽。
          </>
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

export default function Deals() {
  const [items, setItems] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<DealStats | null>(null);
  const [hours, setHours] = useState(72);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setErr(null);
    try {
      const [list, st] = await Promise.all([dealsApi.list({ hours: h, limit: 100 }), dealsApi.stats()]);
      setItems(list.items);
      setTotal(list.total);
      setStats(st);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(hours);
  }, [load, hours]);

  return (
    <div className="pt-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-paper-900">捡漏</h1>
          <p className="mt-1 text-xs text-paper-600">
            自动盯「什么值得买」好价流，只留值友认可度高的。点卡片直接去原站。
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
        {!loading && (
          <span className="ml-auto self-center text-[11px] text-paper-500">
            共 {total} 条
          </span>
        )}
      </div>

      {err && <ErrorBlock message={err} onRetry={() => void load(hours)} className="mt-5" />}

      <div className="mt-4">
        {loading ? (
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
