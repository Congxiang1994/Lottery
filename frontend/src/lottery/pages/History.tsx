import { useEffect, useRef, useState } from "react";
import { useLottery } from "../context";
import { api } from "../api";
import { Draw, HistoryPredictions } from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import PredictionMatrix from "../components/PredictionMatrix";
import { Reveal } from "../../common/Reveal";
import { ErrorBlock, errText } from "../../common/State";
import { PageHeader } from "../../common/PageHeader";
import { History as HistoryIcon, Table2, TrendingUp } from "lucide-react";

const PAGE_SIZE = 15;

type ViewTab = "matrix" | "draws";

export default function History() {
  const { lotteries, key, setKey } = useLottery();
  const [tab, setTab] = useState<ViewTab>("matrix");
  const [draws, setDraws] = useState<Draw[]>([]);
  const [total, setTotal] = useState(0);
  /**
   * M7：把「彩种 + 页码」合并成一个状态，并在渲染阶段按 key 重置页码
   * （React 官方的「根据 props 调整 state」派生模式）。这样切彩种时
   * page 与 key 在同一次提交里一起变成 (新彩种, 1)，effect 只跑一次、只发
   * 一次 page=1 请求 —— 不会再有「setPage(1) 与旧页码请求同批次」的多发。
   */
  const [pageState, setPageState] = useState({ key, page: 1 });
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setPageState({ key, page: 1 });
  }
  const page = pageState.page;
  /** 请求序号：只有最新一次请求的结果允许写 state，旧请求返回直接丢弃 */
  const seqRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [pred, setPred] = useState<HistoryPredictions | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  /* 失败态：与 /story 页一致，失败必须给出口 —— 之前这里失败只是静默留白 */
  const [drawsErr, setDrawsErr] = useState<string | null>(null);
  const [predErr, setPredErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  /**
   * M7：两个请求合并进同一个 effect，共用 seq 守卫 + AbortController。
   * - `seq` 递增：任何一次新请求（翻页/切彩种/重试）都会让旧请求的回调失效；
   * - `AbortController`：effect cleanup 时中断在途请求，省流量也避免旧响应回来；
   * - `.finally` 同样校验 seq，避免旧请求把新请求的 loading 标志改错。
   */
  useEffect(() => {
    const seq = ++seqRef.current;
    const ac = new AbortController();
    setLoading(true);
    setDrawsErr(null);
    setPredLoading(true);
    setPredErr(null);

    api.history(key, page, PAGE_SIZE, ac.signal)
      .then((r) => {
        if (seq !== seqRef.current) return;
        setDraws(r.draws);
        setTotal(r.total);
      })
      .catch((e) => {
        if (seq !== seqRef.current || (e as Error)?.name === "AbortError") return;
        setDrawsErr(errText(e));
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });

    api.historyPredictions(key, page, PAGE_SIZE, ac.signal)
      .then((r) => {
        if (seq !== seqRef.current) return;
        setPred(r);
      })
      .catch((e) => {
        if (seq !== seqRef.current || (e as Error)?.name === "AbortError") return;
        setPredErr(errText(e));
      })
      .finally(() => {
        if (seq === seqRef.current) setPredLoading(false);
      });

    return () => ac.abort();
  }, [key, page, tick]);

  const setPage = (p: number | ((cur: number) => number)) =>
    setPageState((s) => ({ ...s, page: typeof p === "function" ? p(s.page) : p }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const meta = lotteries.find((l) => l.key === key);

  return (
    <div className="pt-8">
      <PageHeader
        title="历史开奖"
        subtitle={`共 ${total.toLocaleString()} 期 · 算法对照 + 明细`}
        icon={HistoryIcon}
        iconClass="text-brand-red"
        actions={<LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />}
      />

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
                              {d.red.map((n) => (
                                <Ball key={`${d.issue}-r${n}`} n={n} kind="red" size={30} />
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap">
                              {d.blue.map((n) => (
                                <Ball key={`${d.issue}-b${n}`} n={n} kind="blue" size={30} />
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
