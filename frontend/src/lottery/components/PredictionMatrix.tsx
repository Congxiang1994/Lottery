import { useMemo, useState } from "react";
import type { PredictionColumn, PredictionItem } from "../types";
import { CheckCircle2, Filter, XCircle } from "lucide-react";

/**
 * 历史开奖 × 算法推荐对照矩阵。
 *
 * 左侧 sticky 列 = 期号 + 开奖号码；右侧 1 列共识 + 85 列算法，横向滚动。
 * 每列：算法名（hover 全名）→ 红球 → 蓝球 → 命中号高亮描边 → 底部奖级标识。
 * 工具条：只看中奖列 / 分类过滤 / 共识列常显。
 */

const PRIZE_ORDER = ["一等奖", "二等奖", "三等奖", "四等奖", "五等奖", "六等奖",
  "七等奖", "八等奖", "九等奖"];

const CAT_NAMES: Record<string, string> = {
  statistical: "统计", ml: "机器学习", deeplearning: "深度学习",
  timeseries: "时序", similarity: "相似", quantum: "量子",
  physics: "物理", symbolic: "符号", metaphysics: "玄学",
  signal_img: "信号", seeds: "种子", ensemble: "集成",
};

function MiniBall({
  n, kind, hit,
}: { n: number; kind: "red" | "blue"; hit: boolean }) {
  const isRed = kind === "red";
  const base = isRed
    ? "bg-brand-red/10 text-brand-red"
    : "bg-brand-blue/10 text-brand-blue";
  const hitStyle = isRed
    ? "bg-brand-red text-white ring-2 ring-brand-red/40 ring-offset-1"
    : "bg-brand-blue text-white ring-2 ring-brand-blue/40 ring-offset-1";
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold leading-none ${
        hit ? hitStyle : base
      }`}
    >
      {n}
    </span>
  );
}

function PrizeTag({ prize }: { prize: string | null }) {
  if (prize) {
    const level = PRIZE_ORDER.indexOf(prize);
    const high = level >= 0 && level <= 2;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          high
            ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700"
        }`}
      >
        <CheckCircle2 size={10} />
        {prize}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 text-[10px] text-paper-500">
      <XCircle size={10} />
      未中奖
    </span>
  );
}

function Column({
  col, draw,
}: {
  col: PredictionColumn;
  draw: PredictionItem;
}) {
  const redSet = new Set(draw.red);
  const blueSet = new Set(draw.blue);
  const won = col.prize !== null;
  return (
    <div
      className={`flex w-[86px] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2 transition ${
        won
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-paper-100 bg-paper-50/50"
      }`}
    >
      <div
        className="max-w-full truncate text-center text-[11px] font-semibold text-paper-800"
        title={col.name}
      >
        {col.name}
      </div>
      <div className="flex flex-wrap justify-center gap-0.5">
        {col.red.map((n) => (
          <MiniBall key={`r${n}`} n={n} kind="red" hit={redSet.has(n)} />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-0.5">
        {col.blue.map((n) => (
          <MiniBall key={`b${n}`} n={n} kind="blue" hit={blueSet.has(n)} />
        ))}
      </div>
      <PrizeTag prize={col.prize} />
    </div>
  );
}

export default function PredictionMatrix({
  items, redLabel, blueLabel,
}: {
  items: PredictionItem[];
  redLabel: string;
  blueLabel: string;
}) {
  const [onlyWin, setOnlyWin] = useState(true);
  const [cat, setCat] = useState<string>("all");

  // 分类选项：仅从数据中出现过的分类取，保证切换有意义
  const cats = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      for (const a of it.predictions?.algos ?? []) s.add(a.category ?? "");
    }
    return [...s].filter(Boolean).sort();
  }, [items]);

  const rows = useMemo(
    () =>
      items.map((it) => {
        let algos = it.predictions?.algos ?? [];
        if (cat !== "all") algos = algos.filter((a) => a.category === cat);
        if (onlyWin) algos = algos.filter((a) => a.prize !== null);
        return { draw: it, consensus: it.predictions?.consensus ?? null, algos };
      }),
    [items, onlyWin, cat]
  );

  const noData = items.every((it) => !it.predictions);

  return (
    <div>
      {/* 工具条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-paper-500" />
        <button
          onClick={() => setOnlyWin((v) => !v)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            onlyWin
              ? "border-emerald-300 bg-emerald-100 text-emerald-700"
              : "border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
          }`}
        >
          只看中奖
        </button>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setCat("all")}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              cat === "all"
                ? "border-brand-red/50 bg-brand-red/15 text-brand-red"
                : "border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
            }`}
          >
            全部分类
          </button>
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                cat === c
                  ? "border-brand-red/50 bg-brand-red/15 text-brand-red"
                  : "border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
              }`}
            >
              {CAT_NAMES[c] ?? c}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-paper-500">
          命中号码高亮描边 · 横向滚动查看全部算法
        </span>
      </div>

      {noData ? (
        <div className="rounded-2xl border border-dashed border-paper-200 py-12 text-center text-sm text-paper-500">
          当前页各期早于算法跑批上线时间，暂无预测数据可对照
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map(({ draw, consensus, algos }) => (
            <div
              key={draw.issue}
              className="overflow-hidden rounded-2xl border border-paper-100 bg-white/70"
            >
              {/* 期次头 */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-paper-100 bg-paper-50/70 px-4 py-2">
                <span className="text-sm font-bold text-paper-900">
                  第 {draw.issue} 期
                </span>
                <span className="text-xs text-paper-600">{draw.date}</span>
                <span className="flex items-center gap-1 text-xs text-paper-600">
                  开奖 {redLabel}：
                  {draw.red.map((n) => (
                    <MiniBall key={`dr${n}`} n={n} kind="red" hit={false} />
                  ))}
                  {blueLabel}：
                  {draw.blue.map((n) => (
                    <MiniBall key={`db${n}`} n={n} kind="blue" hit={false} />
                  ))}
                </span>
                {draw.predictions ? (
                  <span className="ml-auto text-[11px] text-paper-500">
                    对照预测批次 {draw.run_date} · {algos.length}/{draw.predictions.count} 算法
                    {consensus && ` · 共识命中 ${consensus.red_hit}+${consensus.blue_hit}`}
                  </span>
                ) : (
                  <span className="ml-auto text-[11px] text-paper-400">
                    无预测数据（早于跑批上线）
                  </span>
                )}
              </div>
              {/* 矩阵 */}
              {draw.predictions && (
                <div className="overflow-x-auto p-3">
                  <div className="flex gap-2">
                    {consensus && (
                      <div className="sticky left-0 z-10 shrink-0 rounded-xl ring-1 ring-brand-red/30">
                        <Column col={consensus} draw={draw} />
                      </div>
                    )}
                    {algos.map((a) => (
                      <Column key={a.id ?? a.name} col={a} draw={draw} />
                    ))}
                    {algos.length === 0 && (
                      <div className="py-6 text-xs text-paper-400">
                        当前过滤条件下无算法列
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
