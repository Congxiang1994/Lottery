import { useEffect, useState } from "react";
import { useLottery } from "../context";
import { api } from "../api";
import { Draw, Summary, Stats } from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import Reveal from "../components/Reveal";
import TrendMatrix from "../components/TrendMatrix";
import { TrendingUp } from "lucide-react";

const PAGE_SIZE = 15;
const TREND_OPTIONS = [15, 30, 50];

export default function History() {
  const { lotteries, key, setKey } = useLottery();
  const [draws, setDraws] = useState<Draw[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [trendLen, setTrendLen] = useState(30);

  useEffect(() => {
    setPage(1);
  }, [key]);

  useEffect(() => {
    setLoading(true);
    api
      .history(key, page, PAGE_SIZE)
      .then((r) => {
        setDraws(r.draws);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [key, page]);

  useEffect(() => {
    api.summary(key).then(setSummary).catch(() => {});
    api.stats(key).then(setStats).catch(() => {});
  }, [key]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 走势图数据：最近 N 期，旧 → 新（上 → 下）
  const trendDraws = (stats?.trend ?? []).slice(-trendLen);
  const meta = lotteries.find((l) => l.key === key);
  const redOmit = (stats?.omission.red ?? []).map((o) => o.omission);
  const blueOmit = (stats?.omission.blue ?? []).map((o) => o.omission);

  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">历史开奖</h1>
          <p className="mt-1 text-sm text-white/50">共 {total.toLocaleString()} 期 · 走势图 + 明细</p>
        </div>
        <LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />
      </div>

      {/* 走势图 */}
      <Reveal className="mt-6">
        <div className="glass rounded-3xl p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-white/90">
              <TrendingUp size={16} className="text-brand-red" />
              {key === "ssq" ? "红蓝球" : "前后区"}走势图
            </h2>
            <div className="flex items-center gap-2">
              {TREND_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setTrendLen(n)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    trendLen === n
                      ? "border-brand-red/50 bg-brand-red/15 text-brand-red"
                      : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"
                  }`}
                >
                  近 {n} 期
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3">
            {stats ? (
              <TrendMatrix
                draws={trendDraws}
                redMax={summary?.red_max ?? 33}
                blueMax={summary?.blue_max ?? 16}
                redOmit={redOmit}
                blueOmit={blueOmit}
                title={`${meta?.name ?? ""} · ${trendDraws.length} 期走势`}
              />
            ) : (
              <div className="shimmer h-[520px] animate-shimmer rounded-xl" />
            )}
          </div>
        </div>
      </Reveal>

      {/* 分页明细表 */}
      <Reveal className="mt-6">
        <div className="glass overflow-hidden rounded-3xl shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/8 text-left text-xs uppercase tracking-wider text-white/40">
                  <th className="px-5 py-3">期号</th>
                  <th className="px-5 py-3">开奖日期</th>
                  <th className="px-5 py-3">红球 / 前区</th>
                  <th className="px-5 py-3">蓝球 / 后区</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={4} className="px-5 py-4">
                          <div className="shimmer h-6 w-full animate-shimmer rounded" />
                        </td>
                      </tr>
                    ))
                  : draws.map((d) => (
                      <tr key={d.issue} className="border-b border-white/5 transition hover:bg-white/5">
                        <td className="px-5 py-3 font-semibold text-white/80">{d.issue}</td>
                        <td className="px-5 py-3 text-white/55">{d.date}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap">
                            {d.red.map((n, i) => (
                              <Ball key={i} n={n} kind="red" size={30} />
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap">
                            {d.blue.map((n, i) => (
                              <Ball key={i} n={n} kind="blue" size={30} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      <div className="mt-5 flex items-center justify-center gap-3">
        <PageBtn disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</PageBtn>
        <span className="text-sm text-white/55">
          第 <b className="text-white">{page}</b> / {totalPages} 页
        </span>
        <PageBtn disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/80 transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
