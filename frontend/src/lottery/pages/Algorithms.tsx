import { useEffect, useMemo, useRef, useState } from "react";
import { useLottery } from "../context";
import { api } from "../api";
import {
  AlgoCatalog, AlgoResult, BacktestResult, RunStatus, SavedCombined,
} from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import Reveal from "../components/Reveal";
import {
  Atom, Brain, Cpu, Dices, FunctionSquare, GitCompare, Layers, Orbit,
  Radar, RefreshCw, Search, Sigma, Sparkles, TrendingUp, Trophy, Waves,
  X, ChevronDown, ChevronUp, Zap, Gauge, Loader2, CheckCircle2, Lock,
} from "lucide-react";

const ICONS: Record<string, React.ReactNode> = {
  sigma: <Sigma size={15} />,
  "trending-up": <TrendingUp size={15} />,
  "git-compare": <GitCompare size={15} />,
  cpu: <Cpu size={15} />,
  brain: <Brain size={15} />,
  atom: <Atom size={15} />,
  "function-square": <FunctionSquare size={15} />,
  waves: <Waves size={15} />,
  dices: <Dices size={15} />,
  orbit: <Orbit size={15} />,
  radar: <Radar size={15} />,
  layers: <Layers size={15} />,
};

const SPEED_COLOR: Record<number, string> = {
  1: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  2: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  3: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  4: "text-rose-300 border-rose-400/30 bg-rose-400/10",
};

export default function Algorithms() {
  const { lotteries, key, setKey } = useLottery();
  const [catalog, setCatalog] = useState<AlgoCatalog | null>(null);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Record<string, AlgoResult>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [combined, setCombined] = useState<SavedCombined | null>(null);
  const [runStatus, setRunStatus] = useState<AllRunStatus | null>(null);
  const [bt, setBt] = useState<BacktestResult | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [tab, setTab] = useState<"plaza" | "backtest">("plaza");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const loadCombined = () => {
    // 共识推荐永远读 sqlite 缓存（与首页/智能推荐页同一接口，保证一致）
    api.savedCombined(key).then(setCombined).catch(() => setCombined(null));
  };

  useEffect(() => {
    api.algorithms().then(setCatalog).catch((e) => setErr(String(e)));
  }, []);

  const loadBacktest = () => {
    setBtLoading(true);
    setBt(null);
    // 统一全量回测（85 个算法 × 5 期），结果走 sqlite 缓存秒开
    api.backtest(key, 5, 4).then(setBt).catch((e) => setErr(String(e)))
      .finally(() => setBtLoading(false));
  };

  useEffect(() => {
    setResults({});
    setErr(null);
    loadCombined();
    // 回测 tab：若全量运行（预测+回测）正在跑，等它完成再加载（避免重复计算）
    if (tab === "backtest") {
      api.runStatus().then((s) => {
        setRunStatus(s);
        if (s.running) {
          startPoll(); // 完成后自动 loadBacktest（见 startPoll 完成回调）
        } else {
          loadBacktest();
        }
      }).catch(() => loadBacktest());
    } else {
      api.runStatus().then((s) => {
        setRunStatus(s);
        if (s.running) startPoll();
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tab]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      api.runStatus().then((s) => {
        setRunStatus(s);
        if (!s.running) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadCombined(); // 完成后刷新共识推荐
          if (tabRef.current === "backtest") loadBacktest(); // 回测榜走新缓存
        }
      }).catch(() => {});
    }, 1500);
  };

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  const runAll = (pwd: string) => {
    api.runAll(pwd).then(() => {
      setRunStatus({
        lotteries: {}, running: true, done: 0, total: 0, percent: 0,
        phase: "predict", current: "准备中…", current_lottery: null,
        elapsed: 0, eta: 0, finished: false, error: null,
      });
      startPoll();
    }).catch((e) => setErr(String(e)));
  };

  // 密码弹框：后端校验通过后才触发 run-all（run-all 会再次携带密码做端到端校验）
  const submitPassword = () => {
    setPwdLoading(true);
    setPwdErr(null);
    api.verifyPassword(pwd)
      .then(() => {
        setPwdOpen(false);
        runAll(pwd);
        setPwd("");
      })
      .catch((e) => setPwdErr(String(e)))
      .finally(() => setPwdLoading(false));
  };

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const qq = q.trim().toLowerCase();
    return catalog.categories
      .filter((c) => cat === "all" || c.key === cat)
      .flatMap((c) =>
        c.algorithms
          .filter(
            (a) =>
              !qq ||
              a.name.toLowerCase().includes(qq) ||
              a.id.toLowerCase().includes(qq) ||
              a.tags.some((t) => t.toLowerCase().includes(qq))
          )
          .map((a) => ({ ...a, category_name: c.name, category_key: c.key }))
      );
  }, [catalog, cat, q]);

  const runOne = (id: string) => {
    setRunning((s) => new Set(s).add(id));
    api.runAlgo(key, id).then((r) => {
      setResults((m) => ({ ...m, [r.id]: r }));
    }).catch((e) => setErr(String(e))).finally(() => {
      setRunning((s) => { const n = new Set(s); n.delete(id); return n; });
    });
  };

  const toggle = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const meta = lotteries.find((l) => l.key === key);

  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">算法广场</h1>
          <p className="mt-1 text-sm text-white/50">
            {catalog ? `${catalog.total} 个算法 · ${catalog.categories.length} 大分类` : "加载中…"} · 点击卡片运行
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />
          <button
            onClick={() => { setPwdErr(null); setPwd(""); setPwdOpen(true); }}
            disabled={runStatus?.running}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-40"
          >
            {runStatus?.running
              ? <><Loader2 size={15} className="animate-spin" /> 运行中…</>
              : <><Zap size={15} /> 运行全部算法</>}
          </button>
        </div>
      </div>

      {/* 密码弹框 */}
      {pwdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => { if (!pwdLoading) setPwdOpen(false); }}>
          <div
            className="glass w-full max-w-sm rounded-3xl p-6 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-base font-bold text-white/90">
              <Lock size={16} className="text-brand-gold" /> 运行全部算法
            </h3>
            <p className="mt-1 text-xs text-white/50">
              需验证操作密码后执行（双色球 + 大乐透 · 预测 + 回测，约 5 分钟）
            </p>
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitPassword(); }}
              placeholder="请输入操作密码"
              autoFocus
              className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/85 placeholder-white/30 outline-none focus:border-brand-gold/50"
            />
            {pwdErr && (
              <div className="mt-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
                {pwdErr}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPwdOpen(false)}
                disabled={pwdLoading}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:bg-white/5 disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={submitPassword}
                disabled={pwdLoading || !pwd}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
              >
                {pwdLoading ? <><Loader2 size={14} className="animate-spin" /> 校验中…</> : "确认运行"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全量运行进度条（双色球+大乐透 × 预测+回测） */}
      {runStatus?.running && (
        <Reveal className="mt-5">
          <div className="glass rounded-2xl p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-white/75">
                <Loader2 size={14} className="animate-spin text-brand-gold" />
                {runStatus.phase === "backtest"
                  ? <>{runStatus.current_lottery ?? ""} · 回测阶段（85 算法 × 5 期留一预测）</>
                  : <>{runStatus.current_lottery ?? ""} · 预测阶段（{runStatus.total || "…"} 个算法）</>}
              </span>
              <span className="text-white/45">
                已用 {runStatus.elapsed.toFixed(0)}s
                {runStatus.phase === "predict" && runStatus.eta > 0 && (
                  <> · 预计剩余 <b className="text-brand-gold">{runStatus.eta.toFixed(0)}s</b></>
                )}
                {runStatus.phase === "backtest" && <> · 回测中…</>}
              </span>
            </div>

            {runStatus.phase === "backtest" ? (
              /* 回测阶段：不确定进度动画 */
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/8">
                <div className="h-full w-1/3 animate-indeterminate rounded-full bg-gradient-to-r from-brand-gold to-brand-red" />
              </div>
            ) : (
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-gold to-brand-red transition-all duration-700"
                  style={{ width: `${Math.max(runStatus.percent, 2)}%` }}
                />
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/45">
              {runStatus.phase === "backtest" ? (
                <span className="text-white/70">预测已写入缓存 · 正在回测全部算法…</span>
              ) : (
                <>
                  <span className="text-white/70">
                    {runStatus.done}/{runStatus.total || "…"}
                    {runStatus.current && <> · {runStatus.current}</>}
                  </span>
                  <span className="float-right text-brand-gold">{runStatus.percent}%</span>
                </>
              )}
              {/* 双彩种明细 */}
              {runStatus.lotteries && Object.entries(runStatus.lotteries).map(([lk, st]) => (
                <span key={lk} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                  {lk === "ssq" ? "双色球" : "大乐透"}
                  <span className={st.running ? "text-brand-gold" : "text-emerald-300"}>
                    {" "}{st.done}/{st.total}
                  </span>
                  {st.phase === "backtest" && <span className="text-white/40"> 回测中</span>}
                  {st.finished_at && !st.running && <span className="text-emerald-300"> ✓</span>}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-white/30">
              双色球 + 大乐透顺序跑批（预测 + 回测），完成后结果自动写入缓存，四张页面同步更新
            </p>
          </div>
        </Reveal>
      )}
      {!runStatus?.running && runStatus && runStatus.finished && (
        <Reveal className="mt-5">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-2.5 text-xs text-emerald-200">
            <CheckCircle2 size={14} /> 全量运行完成：双色球 + 大乐透 预测（{runStatus.done} 个算法）+ 回测已落库，共识推荐与回测榜已更新
            {runStatus.finished_at && (
              <span className="ml-1 font-mono text-emerald-300/90">
                · 完成于 {runStatus.finished_at}
              </span>
            )}
          </div>
        </Reveal>
      )}

      {/* 共识推荐（与首页/智能推荐页同源：sqlite 缓存） */}
      <Reveal className="mt-6">
        <div className="glass relative overflow-hidden rounded-3xl p-6 shadow-card">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-gold/15 to-transparent opacity-70" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-base font-bold text-brand-gold">
                <Sparkles size={16} /> 全算法共识推荐
              </span>
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/50">
                {combined
                  ? `融合 ${combined.count} 个算法 · ${combined.run_date} 跑批`
                  : runStatus?.running ? "运行完成后自动更新…" : "等待跑批数据…"}
              </span>
              <button
                onClick={loadCombined}
                className="ml-auto flex items-center gap-1 text-[11px] text-white/45 transition hover:text-white"
              >
                <RefreshCw size={12} /> 刷新
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center">
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
                <span className="text-xs text-white/35">暂无数据 — 点击右上角「运行全部算法」或等待每日 0:00 定时跑批</span>
              )}
            </div>
          </div>
        </div>
      </Reveal>

      {/* Tab 切换 */}
      <div className="mt-6 flex items-center gap-2">
        <TabBtn active={tab === "plaza"} onClick={() => setTab("plaza")} icon={<Dices size={14} />} label="算法目录" />
        <TabBtn active={tab === "backtest"} onClick={() => setTab("backtest")} icon={<Trophy size={14} />} label="滚动回测" />
      </div>

      {err && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
          <X size={15} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {tab === "plaza" ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip active={cat === "all"} onClick={() => setCat("all")}>全部 {catalog?.total ?? ""}</Chip>
            {catalog?.categories.map((c) => (
              <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
                {ICONS[c.icon]} {c.name} {c.count}
              </Chip>
            ))}
            <div className="ml-auto flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5">
              <Search size={14} className="text-white/40" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索算法…"
                className="w-36 bg-transparent text-sm text-white/80 placeholder-white/30 outline-none"
              />
            </div>
          </div>

          {/* 算法卡片 */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((a, i) => {
              const r = results[a.id];
              const run = running.has(a.id);
              const isExp = expanded.has(a.id);
              return (
                <Reveal key={a.id} delay={Math.min(i, 8) * 40}>
                  <div className={`glass flex h-full flex-col rounded-2xl p-4 shadow-card transition hover:border-white/15 ${r ? "border-white/10" : "border-white/5"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-white/90">{a.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/40">
                          <span>{a.category_name}</span>
                          <span className={`rounded-full border px-1.5 py-px ${SPEED_COLOR[a.cost]}`}>{a.speed}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => runOne(a.id)}
                        disabled={run}
                        className="shrink-0 rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                        title="运行此算法"
                      >
                        <RefreshCw size={13} className={run ? "animate-spin" : ""} />
                      </button>
                    </div>

                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/45">{a.desc}</p>

                    {r ? (
                      <div className="mt-3 border-t border-white/8 pt-3">
                        <div className="flex flex-wrap items-center">
                          {r.red.map((n, i) => (
                            <Ball key={`r${i}`} n={n} kind="red" size={26} delay={i * 30} />
                          ))}
                          <span className="mx-0.5 text-sm text-white/20">+</span>
                          {r.blue.map((n, i) => (
                            <Ball key={`b${i}`} n={n} kind="blue" size={26} delay={100 + i * 30} />
                          ))}
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-[10px] text-white/40">
                          <span className="flex items-center gap-1"><Gauge size={11} /> {r.elapsed_ms}ms</span>
                          <button onClick={() => toggle(a.id)} className="ml-auto flex items-center gap-1 text-white/50 hover:text-white">
                            {isExp ? <><ChevronUp size={12} /> 收起推演</> : <><ChevronDown size={12} /> 推演细节</>}
                          </button>
                        </div>
                        {isExp && <DetailView r={r} />}
                      </div>
                    ) : (
                      <div className="mt-3 flex-1 border-t border-white/8 pt-3 text-[10px] text-white/30">
                        {run ? "推演中…" : "点击右上角 ▶ 运行"}
                      </div>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="mt-10 text-center text-sm text-white/40">没有匹配的算法</div>
          )}
        </>
      ) : (
        <BacktestView
          key={key}
          bt={bt}
          meta={meta?.name}
          loading={btLoading}
          runAllRunning={runStatus?.running ?? false}
        />
      )}

      {catalog && (
        <p className="mt-8 text-center text-[11px] leading-relaxed text-white/30">{catalog.disclaimer}</p>
      )}
    </div>
  );
}

function DetailView({ r }: { r: AlgoResult }) {
  const entries = useMemo(
    () => Object.entries(r.detail ?? {}).filter(([k]) => k !== "error"),
    [r.detail]
  );
  const error = (r.detail as Record<string, unknown>).error;
  return (
    <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/8 bg-black/20 p-2.5">
      {error && (
        <div className="rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">⚠ {String(error)}</div>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[10px]">
          <span className="w-28 shrink-0 truncate text-white/40">{k}</span>
          <span className="break-all text-white/75">{fmt(v)}</span>
        </div>
      ))}
      {entries.length === 0 && !error && <div className="text-[10px] text-white/30">无额外信息</div>}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? "border-brand-gold/50 bg-brand-gold/15 text-brand-gold"
          : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
        active ? "bg-white/12 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function BacktestView({
  bt, meta, loading, runAllRunning,
}: {
  bt: BacktestResult | null;
  meta?: string;
  loading: boolean;
  runAllRunning: boolean;
}) {
  return (
    <div className="mt-4">
      <div className="glass rounded-2xl p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-white/90">
            <Trophy size={16} className="text-brand-gold" /> 滚动回测排行榜
          </h2>
          {bt && (
            <span className="text-[11px] text-white/40">
              {meta} · {bt.folds} 期留一预测 · {bt.algos.length} 个算法（全量）· 红球随机期望 {bt.red_expected_per_draw} 号
            </span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-white/35">
          全量回测：85 个非集成算法 × {bt?.folds ?? 5} 期留一预测；结果每日定时任务预计算并缓存，通常秒开
        </p>

        {loading ? (
          <div className="py-10 text-center text-sm text-white/35">
            {runAllRunning
              ? "全量运行进行中（预测 + 回测），回测结果将在完成后自动显示…"
              : "回测计算中（首次约 1~2 分钟，之后走缓存）…"}
          </div>
        ) : bt ? (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/35">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">算法</th>
                    <th className="py-2 pr-2">分类</th>
                    <th className="py-2 pr-2 text-right">红球均命中</th>
                    <th className="py-2 pr-2 text-right">蓝球均命中</th>
                    <th className="py-2 pr-2 text-right">红球 lift</th>
                    <th className="py-2 pr-2 text-right">蓝球 lift</th>
                    <th className="py-2 text-right">综合分</th>
                  </tr>
                </thead>
                <tbody>
                  {bt.algos.map((a, i) => (
                    <tr key={a.id} className={`border-b border-white/5 ${i === 0 ? "bg-brand-gold/5" : ""}`}>
                      <td className="py-2 pr-2 text-white/40">{i + 1}</td>
                      <td className="py-2 pr-2 font-medium text-white/85">{a.name}</td>
                      <td className="py-2 pr-2 text-white/45">{a.category}</td>
                      <td className="py-2 pr-2 text-right text-white/70">{a.red_avg}</td>
                      <td className="py-2 pr-2 text-right text-white/70">{a.blue_avg}</td>
                      <td className={`py-2 pr-2 text-right font-semibold ${a.red_lift >= 1 ? "text-emerald-300" : "text-white/60"}`}>
                        {a.red_lift.toFixed(2)}
                      </td>
                      <td className={`py-2 pr-2 text-right font-semibold ${a.blue_lift >= 1 ? "text-emerald-300" : "text-white/60"}`}>
                        {a.blue_lift.toFixed(2)}
                      </td>
                      <td className={`py-2 text-right font-bold ${i === 0 ? "text-brand-gold" : "text-white/80"}`}>
                        {a.score.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 rounded-lg bg-white/5 p-2.5 text-[11px] leading-relaxed text-white/40">{bt.note}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
