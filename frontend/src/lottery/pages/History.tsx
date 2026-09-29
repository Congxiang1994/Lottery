import { useEffect, useState } from "react";
import { useLottery } from "../context";
import { api } from "../api";
import { Draw, HistoryPredictions } from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import PredictionMatrix from "../components/PredictionMatrix";
import Reveal from "../components/Reveal";
import { ErrorBlock, errText } from "../../common/State";
import { Table2, TrendingUp } from "lucide-react";

const PAGE_SIZE = 15;

type ViewTab = "matrix" | "draws";

export default function History() {
  const { lotteries, key, setKey } = useLottery();
  const [tab, setTab] = useState<ViewTab>("matrix");
  const [draws, setDraws] = useState<Draw[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pred, setPred] = useState<HistoryPredictions | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  /* 失败态：与 /story 页一致，失败必须给出口 —— 之前这里失败只是静默留白 */
  const [drawsErr, setDrawsErr] = useState<string | null>(null);
  const [predErr, setPredErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    setPage(1);
  }, [key]);

  useEffect(() => {
    setLoading(true);
    setDrawsErr(null);
    api
      .history(key, page, PAGE_SIZE)
      .then((r) => {
        setDraws(r.draws);
        setTotal(r.total);
      })
      .catch((e) => setDrawsErr(errText(e)))
      .finally(() => setLoading(false));
  }, [key, page, tick]);

  // 算法对照数据：翻页/换彩种时拉取（默认 tab 即 matrix）
  useEffect(() => {
    setPredLoading(true);
    setPredErr(null);
    api
      .historyPredictions(key, page, PAGE_SIZE)
      .then(setPred)
      .catch((e) => setPredErr(errText(e)))
      .finally(() => setPredLoading(false));
  }, [key, page, tick]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const meta = lotteries.find((l) => l.key === key);

  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">历史开奖</h1>
          <p className="mt-1 text-sm text-paper-700">共 {total.toLocaleString()} 期 · 算法对照 + 明细</p>
        </div>
        <LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />
      </div>

      {/* 视图切换：算法对照（默认）/ 开奖明细 */}
      <Reveal className="mt-6">
        <div className="glass overflow-hidden rounded-3xl shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-100 px-5 py-3">
            <div className="flex gap-1 rounded-xl bg-paper-100 p-1" role="tablist" aria-label="历史开奖视图">
              <button
                role="tab"
                aria-selected={tab === "matrix"}
                onClick={() => setTab("matrix")}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  tab === "matrix"
                    ? "bg-white text-paper-900 shadow-sm"
                    : "text-paper-600 hover:text-paper-900"
                }`}
              >
                <TrendingUp size={14} />
                算法对照
              </button>
              <button
                role="tab"
                aria-selected={tab === "draws"}
                onClick={() => setTab("draws")}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  tab === "draws"
                    ? "bg-white text-paper-900 shadow-sm"
                    : "text-paper-600 hover:text-paper-900"
                }`}
              >
                <Table2 size={14} />
                开奖明细
              </button>
            </div>
            {tab === "matrix" && (
              <span className="text-xs text-paper-500">
                1 列全算法共识 + 85 列算法 · 每列对照该期开奖判定奖级
              </span>
            )}
          </div>

          {tab === "draws" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-paper-100 text-left text-xs uppercase tracking-wider text-paper-600">
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
                    : drawsErr ? (
                        <tr>
                          <td colSpan={4} className="px-5 py-4">
                            <ErrorBlock message={drawsErr} onRetry={retry} />
                          </td>
                        </tr>
                      ) : draws.map((d) => (
                        <tr key={d.issue} className="border-b border-paper-100 transition hover:bg-paper-100">
                          <td className="px-5 py-3 font-semibold text-paper-900">{d.issue}</td>
                          <td className="px-5 py-3 text-paper-700">{d.date}</td>
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
          ) : (
            <div className="p-5">
              {predLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="shimmer h-40 w-full animate-shimmer rounded-2xl" />
                  ))}
                </div>
              ) : predErr ? (
                <ErrorBlock message={`算法对照数据加载失败：${predErr}`} onRetry={retry} />
              ) : pred && meta ? (
                <PredictionMatrix
                  items={pred.items}
                  redLabel={meta.red_label ?? "红球"}
                  blueLabel={meta.blue_label ?? "蓝球"}
                />
              ) : (
                <div className="py-12 text-center text-sm text-paper-500">
                  本期暂无算法对照数据
                </div>
              )}
            </div>
          )}
        </div>
      </Reveal>

      <div className="mt-5 flex items-center justify-center gap-3">
        <PageBtn disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</PageBtn>
        <span className="text-sm text-paper-700">
          第 <b className="text-paper-900">{page}</b> / {totalPages} 页
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
      className="rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-900 transition enabled:hover:bg-paper-200 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}
