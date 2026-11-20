import { useEffect, useState } from "react";
import { useLottery } from "../context";
import { api } from "../api";
import { BacktestResult, SavedAlgorithmsLatest, SavedCombined } from "../types";
import Ball from "../components/Ball";
import LotteryTabs from "../components/LotteryTabs";
import { Reveal } from "../../common/Reveal";
import { ErrorBlock, errText, isNotFound } from "../../common/State";
import { PageHeader } from "../../common/PageHeader";
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
  /* 失败态：原先三个请求都 catch 成 null，于是「失败」与「暂无数据」不可区分 ——
     saved 为 null 时页面**永远停在骨架屏**上。现在单独记失败原因并给重试出口。 */
  const [err, setErr] = useState<string | null>(null);
  /** M12：404 = 还没跑批（空态），不是故障；只有 5xx/网络错误才进 err */
  const [savedNotFound, setSavedNotFound] = useState(false);
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    setSaved(null); setCombined(null); setBacktest(null); setOpenId(null);
    setErr(null); setSavedNotFound(false);
    api.savedLatest(key)
      .catch((e) => {
        if (isNotFound(e)) {
          setSavedNotFound(true); // 404 走空态，不报红块
          return null;
        }
        setErr(errText(e));
        return null;
      })
      .then(setSaved);
    api.savedCombined(key).catch(() => null).then(setCombined);
    // 回测榜（全量，sqlite 缓存秒开）：与 savedLatest 同样区分 404
    api.backtest(key)
      .catch((e) => {
        if (isNotFound(e)) return null;
        return null; // 回测榜未生成属正常（后端 503），静默走「未生成」空态
      })
      .then(setBacktest);
  }, [key, tick]);

  return (
    <div className="pt-8">
      <PageHeader
            title="智能推荐"
            subtitle={
              combined
                ? `每日 ${combined.run_date} 跑批 · 第 ${combined.issue_base} 期`
                : err
                  ? "加载失败"
                  : "加载中…"
            }
            icon={Sparkles}
            iconClass="text-brand-gold"
            actions={<LotteryTabs lotteries={lotteries} value={key} onChange={setKey} />}
            className="flex-1"
          />

      {/* 加载失败：一条提示 + 重试，取代「永远转的骨架屏」 */}
      {err && (
        <ErrorBlock
          message={`推荐数据加载失败：${err}`}
          onRetry={retry}
          className="mt-6"
        />
      )}

      <Reveal className="mt-6">
        <div className="glass relative overflow-hidden rounded-3xl p-6 shadow-card">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-gold/15 to-transparent" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-base font-bold text-brand-gold">
                <Sparkles size={16} /> 全算法共识推荐
              </span>
              <span className="rounded-full bg-paper-100 px-2 py-0.5 text-[10px] text-paper-700">
                {combined ? `红球：${combined.count} 个算法计票 top-${combined.red.length}（${combined.run_date}）` : "暂无跑批数据 · 请到算法广场运行全部算法"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center">
              {combined ? (
                <>
                  {combined.red.map((n, i) => (<Ball key={`cr${n}`} n={n} kind="red" size={42} delay={i * 50} />))}
                  <span className="mx-1.5 text-xl text-paper-400">+</span>
                  {combined.blue.map((n, i) => (<Ball key={`cb${n}`} n={n} kind="blue" size={42} delay={250 + i * 50} />))}
                </>
              ) : (<span className="text-xs text-paper-600">暂无数据</span>)}
            </div>
            {combined && (
              <p className="mt-3 text-[10px] leading-relaxed text-paper-600">
                红球按号码得票数排序。蓝球/后区<b>不参与算法计票</b> ——
                实测蓝球 lift 与随机无差别（0.99 / 0.96），此处展示的是
                各算法蓝球选择的计票结果，同样不具备预测力。所有号码仅供娱乐参考。
              </p>
            )}
          </div>
        </div>
      </Reveal>

      {/* 回测表现（纯统计，不再展示号码） */}
      <Reveal className="mt-5">
        <div className="glass rounded-3xl p-6 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-paper-900">
              <Trophy size={16} className="text-brand-gold" /> 回测表现
            </h2>
            {backtest ? (
              <span className="text-[11px] text-paper-700">
                最近 {backtest.folds} 期留一预测 · 红球随机期望 {backtest.red_expected_per_draw}
                {" · "}
                <b className={backtest.passes_fdr_count > 0 ? "text-emerald-700" : "text-brand-gold"}>
                  {backtest.passes_fdr_count === 0
                    ? "0 个算法通过显著性校正"
                    : `${backtest.passes_fdr_count} 个算法通过显著性校正`}
                </b>
              </span>
            ) : (
              <span className="text-[11px] text-paper-600">回测数据未生成</span>
            )}
          </div>

          {backtest && backtest.algos.length > 0 ? (
            <div className="mt-4 space-y-2">
              {/* 零假设基线：真随机号码打出来的 lift */}
              <div className="flex items-center gap-3 rounded-xl border border-paper-200 bg-paper-100 px-3 py-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-paper-200 text-[10px] font-bold text-paper-700">基</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-paper-900">真随机号码基线</div>
                  <div className="text-[10px] text-paper-600">
                    每折抽 {backtest.null_tickets_per_fold} 组随机号码 · 红球 lift {backtest.null_red_lift.toFixed(3)} · 蓝球 lift {backtest.null_blue_lift.toFixed(3)}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-paper-200 px-2 py-1 text-[10px] text-paper-700">
                  无预测力时应≈1.00
                </span>
              </div>

              {backtest.algos.slice(0, 10).map((t, i) => {
                const significant = t.passes_fdr;
                return (
                  <div
                    key={t.id}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 transition ${
                      significant
                        ? "border-emerald-600/30 bg-emerald-50"
                        : "border-paper-100 bg-paper-50 hover:border-paper-300"
                    }`}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm font-bold ${
                      i === 0 ? "bg-brand-gold/20 text-brand-gold" : i < 3 ? "bg-paper-200 text-paper-900" : "bg-paper-100 text-paper-700"
                    }`}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-paper-900">{t.name}</div>
                      <div className="text-[10px] text-paper-600">
                        红球 lift {t.red_lift.toFixed(2)}{" "}
                        <span className="text-paper-500">
                          [{t.red_ci[0].toFixed(2)}, {t.red_ci[1].toFixed(2)}]
                        </span>
                        {" · "}蓝球 lift {t.blue_lift.toFixed(2)}{" "}
                        <span className="text-paper-500">
                          [{t.blue_ci[0].toFixed(2)}, {t.blue_ci[1].toFixed(2)}]
                        </span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium ${
                      significant
                        ? "bg-emerald-600/15 text-emerald-700"
                        : "bg-paper-200 text-paper-600"
                    }`}>
                      {significant ? "显著" : `与随机无差别 p=${t.red_p.toFixed(3)}`}
                    </span>
                  </div>
                );
              })}
              <p className="pt-1 text-[10px] text-paper-500">
                约 95% 置信区间跨过 1.00，或未通过 Benjamini-Hochberg 多重比较校正（p 值已按 {backtest.algos.length} 个算法校正），
                即无法排除「纯噪声」。榜单只描述历史表现，<b>不构成任何选号依据</b>。
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-paper-200 p-4 text-center text-xs text-paper-600">
              回测数据未生成。到「算法广场」点击「运行全部」即可生成（folds=200，
              双色球 + 大乐透各约 10 分钟）。
            </div>
          )}
        </div>
      </Reveal>

      <Reveal className="mt-6">
        <div className="glass rounded-3xl p-6 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-paper-900">
              <Calendar size={16} className="text-brand-blue2" /> 每日定时跑批结果
            </h2>
            {saved && (
              <span className="text-[11px] text-paper-700">
                {saved.run_date} · 第 <b>{saved.issue_base}</b> 期 · {saved.count} 个算法
              </span>
            )}
          </div>
          {saved ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {saved.results.map((a) => {
                const open = openId === a.id;
                return (
                  <div key={a.id} className="rounded-xl border border-paper-100 bg-paper-50 p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-paper-900">{a.name}</div>
                          <span className="shrink-0 text-[10px] text-paper-600">{a.elapsed_ms}ms</span>
                        </div>
                        <div className="text-[10px] text-paper-600">{CAT_NAMES[a.category] ?? a.category}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {a.red.map((n, i) => (<Ball key={`${a.id}-r${n}`} n={n} kind="red" size={22} delay={i * 20} />))}
                          <span className="mx-0.5 text-xs text-paper-400">+</span>
                          {a.blue.map((n, i) => (<Ball key={`${a.id}-b${n}`} n={n} kind="blue" size={22} delay={80 + i * 20} />))}
                        </div>
                      </div>
                      <button
                        onClick={() => setOpenId(open ? null : a.id)}
                        aria-expanded={open}
                        aria-label={open ? `收起 ${a.name} 推演细节` : `展开 ${a.name} 推演细节`}
                        className="shrink-0 rounded-lg border border-paper-200 bg-paper-100 p-1.5 text-paper-700 hover:bg-paper-200 hover:text-paper-900">
                        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                    {open && (
                      <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-paper-100 bg-paper-100 p-2 text-[10px]">
                        {Object.entries(a.detail ?? {}).filter(([k]) => k !== "error").map(([dk, v]) => (
                          <div key={dk} className="flex gap-2">
                            <span className="w-28 shrink-0 truncate text-paper-600">{dk}</span>
                            <span className="break-all text-paper-800">
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
          ) : savedNotFound ? (
            <div className="mt-6 rounded-xl border border-dashed border-paper-200 py-10 text-center text-sm text-paper-500">
              暂无推荐数据，等待每日跑批
            </div>
          ) : err ? null : (
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
          <div className="flex items-start gap-3 rounded-2xl border border-amber-600/25 bg-amber-50 p-4 text-sm text-amber-800">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="leading-relaxed">{DISCLAIMER}</p>
          </div>
        </Reveal>
      )}
    </div>
  );
}
