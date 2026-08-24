import { useEffect, useMemo, useState } from "react";
import { useLottery } from "../context";
import { api } from "../api";
import { BacktestResult, SavedAlgorithmsLatest, SavedCombined } from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import Reveal from "../components/Reveal";
import { Sparkles, ShieldAlert, Calendar, ChevronDown, ChevronUp, Trophy } from "lucide-react";

const CAT_NAMES: Record<string, string> = {
  statistical: "统计与概率", timeseries: "时间序列", similarity: "距离与相似性",
  ml: "机器学习", deeplearning: "深度学习", quantum: "量子计算",
  symbolic: "符号回归", physics: "物理启发", seeds: "种子寻优",
  metaphysics: "玄学术数", signal: "信号与图像", ensemble: "集成融合",
};

const DISCLAIMER = "彩票开奖为独立随机事件，本页所有内容来自每日 0:00 定时跑批缓存。";

export default function Predict() {
  const { lotteries, key, setKey } = useLottery();
  const [saved, setSaved] = useState<SavedAlgorithmsLatest | null>(null);
  const [combined, setCombined] = useState<SavedCombined | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setSaved(null); setCombined(null); setBacktest(null); setOpenId(null);
    api.savedLatest(key).catch(() => null).then(setSaved);
    api.savedCombined(key).catch(() => null).then(setCombined);
    // 回测榜（全量，sqlite 缓存秒开）
    api.backtest(key, 5, 4).catch(() => null).then(setBacktest);
  }, [key]);

  // 回测 Top10：榜上前 10 的算法 → 从跑批缓存取推荐号码
  const top10 = useMemo(() => {
    if (!backtest || !saved) return [];
    const byId = new Map(saved.results.map((r) => [r.id, r]));
    return backtest.algos.slice(0, 10)
      .map((a) => ({ ...a, ...(byId.get(a.id) ?? { red: [], blue: [] }) }))
      .filter((t) => t.red.length > 0);
  }, [backtest, saved]);

  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">智能推荐</h1>
          <p className="mt-1 text-sm text-white/50">
            {combined ? `每日 ${combined.run_date} 跑批 · 第 ${combined.issue_base} 期` : "加载中"}
          </p>
        </div>
        <LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />
      </div>

      <Reveal className="mt-6">
        <div className="glass relative overflow-hidden rounded-3xl p-6 shadow-card">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-gold/15 to-transparent" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-base font-bold text-brand-gold">
                <Sparkles size={16} /> 全算法共识推荐
              </span>
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/45">
                {combined ? `融合 ${combined.count} 个算法 · 等权平均（${combined.run_date}）` : "暂无跑批数据 · 请到算法广场运行全部算法"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center">
              {combined ? (
                <>
                  {combined.red.map((n, i) => (<Ball key={i} n={n} kind="red" size={42} delay={i * 50} />))}
                  <span className="mx-1.5 text-xl text-white/20">+</span>
                  {combined.blue.map((n, i) => (<Ball key={i} n={n} kind="blue" size={42} delay={250 + i * 50} />))}
                </>
              ) : (<span className="text-xs text-white/35">暂无数据</span>)}
            </div>
          </div>
        </div>
      </Reveal>

      {/* 回测 Top10 推荐（取最新跑批回测榜前 10 的算法推荐号码） */}
      <Reveal className="mt-5">
        <div className="glass rounded-3xl p-6 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-white/90">
              <Trophy size={16} className="text-brand-gold" /> 回测 Top10 推荐
            </h2>
            {top10.length > 0 ? (
              <span className="text-[11px] text-white/45">
                基于最近 5 期留一预测回测排行榜（lift = 实际命中 / 随机期望）
              </span>
            ) : (
              <span className="text-[11px] text-white/35">回测数据未生成 · 请到算法广场运行全部算法（含回测）</span>
            )}
          </div>

          {top10.length > 0 ? (
            <div className="mt-4 space-y-2">
              {top10.map((t, i) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-3 py-2 transition hover:border-white/15">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-bold ${
                    i === 0 ? "bg-brand-gold/20 text-brand-gold" : i < 3 ? "bg-white/10 text-white/80" : "bg-white/5 text-white/50"
                  }`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white/85">{t.name}</div>
                    <div className="text-[10px] text-white/40">
                      综合分 {t.score.toFixed(3)} · 红球 lift {t.red_lift.toFixed(2)} · 蓝球 lift {t.blue_lift.toFixed(2)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center">
                    {(t.red ?? []).map((n, j) => (
                      <Ball key={`r${j}`} n={n} kind="red" size={26} delay={j * 20} />
                    ))}
                    <span className="mx-0.5 text-xs text-white/20">+</span>
                    {(t.blue ?? []).map((n, j) => (
                      <Ball key={`b${j}`} n={n} kind="blue" size={26} delay={80 + j * 20} />
                    ))}
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[10px] text-white/30">
                注：回测 lift 在小样本上噪声较大，长期回归 1.0；本榜单仅作历史表现参考，不构成预测依据
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/40">
              回测数据未生成。到「算法广场」点击「运行全部」即可生成（含预测 + 回测，
              双色球约 4 分钟，大乐透约 12 分钟），完成后刷新本页自动展示 Top10。
            </div>
          )}
        </div>
      </Reveal>

      <Reveal className="mt-6">
        <div className="glass rounded-3xl p-6 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-white/90">
              <Calendar size={16} className="text-brand-blue2" /> 每日定时跑批结果
            </h2>
            {saved && (
              <span className="text-[11px] text-white/45">
                {saved.run_date} · 第 <b>{saved.issue_base}</b> 期 · {saved.count} 个算法
              </span>
            )}
          </div>
          {saved ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {saved.results.map((a) => {
                const open = openId === a.id;
                return (
                  <div key={a.id} className="rounded-xl border border-white/8 bg-white/3 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-white/85">{a.name}</div>
                          <span className="shrink-0 text-[10px] text-white/35">{a.elapsed_ms}ms</span>
                        </div>
                        <div className="text-[10px] text-white/40">{CAT_NAMES[a.category] ?? a.category}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {a.red.map((n, i) => (<Ball key={i} n={n} kind="red" size={22} delay={i * 20} />))}
                          <span className="mx-0.5 text-xs text-white/20">+</span>
                          {a.blue.map((n, i) => (<Ball key={i} n={n} kind="blue" size={22} delay={80 + i * 20} />))}
                        </div>
                      </div>
                      <button onClick={() => setOpenId(open ? null : a.id)}
                        className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/55 hover:bg-white/10 hover:text-white">
                        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                    {open && (
                      <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-white/8 bg-black/20 p-2 text-[10px]">
                        {Object.entries(a.detail ?? {}).filter(([k]) => k !== "error").map(([dk, v]) => (
                          <div key={dk} className="flex gap-2">
                            <span className="w-28 shrink-0 truncate text-white/40">{dk}</span>
                            <span className="break-all text-white/75">
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="shimmer h-14 animate-shimmer rounded-xl" />
              ))}
            </div>
          )}
        </div>
      </Reveal>

      {saved && (
        <Reveal className="mt-5">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100/90">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
            <p className="leading-relaxed">{DISCLAIMER}</p>
          </div>
        </Reveal>
      )}
    </div>
  );
}
