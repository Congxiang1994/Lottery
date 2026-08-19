import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Snowflake, TrendingUp, Database, Sparkles, ArrowRight, Layers } from "lucide-react";
import { useLottery } from "../App";
import { api } from "../api";
import { Summary, Stats, SavedCombined } from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import Heatmap from "../components/Heatmap";
import TrendChart from "../components/TrendChart";
import Reveal from "../components/Reveal";

export default function Home() {
  const { lotteries, key, setKey } = useLottery();
  const nav = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [combined, setCombined] = useState<SavedCombined | null>(null);

  useEffect(() => {
    setSummary(null);
    setStats(null);
    setCombined(null);
    api.summary(key).then(setSummary).catch(() => {});
    api.stats(key).then(setStats).catch(() => {});
    // 共识推荐来自每日跑批缓存，不触发实时计算
    api.savedCombined(key).then(setCombined).catch(() => {});
  }, [key]);

  const meta = lotteries.find((l) => l.key === key);
  const hot = stats?.hot_cold.red.hot[0];
  const hotBlue = stats?.hot_cold.blue.hot[0];
  const coldRed = stats?.hot_cold.red.cold[0];

  return (
    <div className="pt-8">
      {/* Hero */}
      <section className="text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white/60">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-red" />
          彩票数据可视化与智能推荐平台
        </div>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          彩票数据
          <span className={key === "ssq" ? "gradient-text" : "gradient-text-blue"}>可视化</span>
          与智能推荐
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/55">
          双色球 / 大乐透历史开奖全量统计、走势追踪与多策略推荐，一站看透号码规律。
        </p>
        <div className="mt-6 flex justify-center">
          <LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />
        </div>
      </section>

      {/* 最新开奖 */}
      <Reveal className="mt-10">
        <div className="glass relative overflow-hidden rounded-3xl p-7 shadow-card">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-red/20 blur-3xl" />
          {summary?.latest ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-widest text-white/40">最新开奖</div>
                  <div className="mt-1 text-2xl font-bold">
                    {meta?.name}
                    <span className="ml-2 text-base font-normal text-white/45">
                      第 {summary.latest.issue} 期 · {summary.latest.date}
                    </span>
                  </div>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">
                  {summary.org}
                </span>
              </div>
              <div className="flex flex-wrap items-center">
                {summary.latest.red.map((n, i) => (
                  <Ball key={i} n={n} kind="red" size={48} delay={i * 70} />
                ))}
                <span className="mx-2 text-2xl text-white/20">+</span>
                {summary.latest.blue.map((n, i) => (
                  <Ball key={i} n={n} kind="blue" size={48} delay={400 + i * 70} />
                ))}
              </div>
            </div>
          ) : (
            <div className="shimmer h-32 animate-shimmer rounded-2xl" />
          )}
        </div>
      </Reveal>

      {/* 统计卡片 */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Database size={16} />} label="历史总期数" value={summary ? summary.total.toLocaleString() : "—"} />
        <StatCard icon={<Flame size={16} />} label={`近期最热${meta?.red_label ?? "红"}`} value={hot ? `No.${hot.number}（${hot.count}）` : "—"} accent="red" />
        <StatCard icon={<Snowflake size={16} />} label={`最冷${meta?.red_label ?? "红"}`} value={coldRed ? `No.${coldRed.number}` : "—"} accent="blue" />
        <StatCard icon={<TrendingUp size={16} />} label={`最热${meta?.blue_label ?? "蓝"}`} value={hotBlue ? `No.${hotBlue.number}（${hotBlue.count}）` : "—"} accent="blue" />
      </div>

      {/* 全算法共识推荐（每日跑批缓存） */}
      <Reveal className="mt-5" delay={40}>
        <div className="glass relative overflow-hidden rounded-3xl p-5 shadow-card">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-gold/15 to-transparent" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-base font-bold text-brand-gold">
                <Sparkles size={16} /> 全算法共识推荐
              </span>
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/45">
                {combined
                  ? `融合 ${combined.count} 个算法 · ${combined.run_date} 跑批`
                  : "等待每日跑批数据…"}
              </span>
              <button
                onClick={() => nav("/algorithms")}
                className="ml-auto flex items-center gap-1 text-[11px] text-white/45 transition hover:text-white"
              >
                <Layers size={12} /> 查看算法广场 <ArrowRight size={12} />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center">
              {combined ? (
                <>
                  {combined.red.map((n, i) => (
                    <Ball key={`r${i}`} n={n} kind="red" size={40} delay={i * 40} />
                  ))}
                  <span className="mx-1.5 text-xl text-white/20">+</span>
                  {combined.blue.map((n, i) => (
                    <Ball key={`b${i}`} n={n} kind="blue" size={40} delay={200 + i * 40} />
                  ))}
                </>
              ) : (
                <span className="text-xs text-white/35">暂无数据 — 每日 0:00 定时跑批后自动出现</span>
              )}
            </div>
          </div>
        </div>
      </Reveal>

      {/* 走势 + 频率 */}
      <div className="mt-8 grid gap-5 lg:grid-cols-5">
        <Reveal className="glass rounded-3xl p-6 shadow-card lg:col-span-3">
          <h3 className="mb-4 text-base font-bold">
            {key === "ssq" ? "近期红蓝球走势" : "近期前后区走势"}
          </h3>
          {stats ? (
            <TrendChart
              draws={stats.trend}
              redMax={summary?.red_max ?? (key === "dlt" ? 35 : 33)}
              blueMax={summary?.blue_max ?? (key === "dlt" ? 12 : 16)}
            />
          ) : (
            <div className="shimmer h-[340px] animate-shimmer rounded-2xl" />
          )}
        </Reveal>

        <Reveal className="glass rounded-3xl p-6 shadow-card lg:col-span-2" delay={100}>
          <h3 className="mb-4 text-base font-bold">号码出现频率</h3>
          {stats ? (
            <div className="space-y-5">
              <Heatmap items={stats.frequency.red.map((f) => ({ number: f.number, count: f.count }))} kind="red" title={`${meta?.red_label}（1-${summary?.red_max}）`} />
              <Heatmap items={stats.frequency.blue.map((f) => ({ number: f.number, count: f.count }))} kind="blue" title={`${meta?.blue_label}（1-${summary?.blue_max}）`} />
            </div>
          ) : (
            <div className="shimmer h-48 animate-shimmer rounded-2xl" />
          )}
        </Reveal>
      </div>

      {/* 冷热榜 */}
      <Reveal className="mt-5">
        <div className="glass rounded-3xl p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2 text-base font-bold">
            <Flame size={18} className="text-brand-red" /> 冷热榜单
            <span className="text-xs font-normal text-white/40">· 近 {stats?.hot_cold.window ?? 50} 期</span>
          </div>
          {stats ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <ColdHotRow title="热号" items={stats.hot_cold.red.hot} kind="red" hot />
              <ColdHotRow title="冷号" items={stats.hot_cold.red.cold} kind="red" />
            </div>
          ) : (
            <div className="shimmer h-24 animate-shimmer rounded-2xl" />
          )}
          <button
            onClick={() => nav("/predict")}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
          >
            <Sparkles size={16} /> 获取智能推荐 <ArrowRight size={15} />
          </button>
        </div>
      </Reveal>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "red" | "blue";
}) {
  const c = accent === "blue" ? "text-brand-blue2" : accent === "red" ? "text-brand-red" : "text-white/70";
  return (
    <div className="glass card-hover rounded-2xl p-4">
      <div className={`mb-2 flex items-center gap-1.5 text-xs ${c}`}>{icon}{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function ColdHotRow({
  title,
  items,
  kind,
  hot,
}: {
  title: string;
  items: { number: number; count: number }[];
  kind: "red" | "blue";
  hot?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-white/60">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <div
            key={it.number}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${
              hot ? "border-brand-red/30 bg-brand-red/10" : "border-brand-blue/30 bg-brand-blue/10"
            }`}
          >
            <span className={hot ? "text-brand-red" : "text-brand-blue2"}>No.{it.number}</span>
            <span className="text-white/40">×{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
