import { memo, useMemo, useState } from "react";
import type { PredictionColumn, PredictionItem } from "../types";
import { CheckCircle2, Filter, XCircle } from "lucide-react";

/**
 * 历史开奖 × 算法推荐对照矩阵。
 *
 * 左侧 sticky 列 = 期号 + 开奖号码；右侧 1 列共识 + N 列算法，
 * **全部 15 行共享同一个横向滚动容器**（M14）——之前每行各有一个
 * overflow-x-auto，滚一行其他行不动，对照起来极其难受，且 15×86 个 Column
 * 无 memo、每次 setState 全量重渲染。现在：单一滚动容器 + Column memo +
 * redSet/blueSet useMemo，滚动同步、重渲染收敛到变化的行。
 *
 * 每列：算法名（hover 全名）→ 红球 → 蓝球 → 命中号高亮描边 → 底部奖级标识。
 * 工具条：只看中奖列 / 分类过滤 / 共识列常显。
 */

const PRIZE_ORDER = ["一等奖", "二等奖", "三等奖", "四等奖", "五等奖", "六等奖",
  "七等奖", "八等奖", "九等奖"];

/* 分类显示名一律取后端下发的 category_name（CATEGORIES 是唯一真源）。
   这里**不再**维护手抄的 key→中文名映射表：曾经存在的那张表两边已经漂移过 ——
   key 写成 signal_img 而后端是 signal，界面直接把英文 key 显示出来；
   名字也有两套（后端「统计与概率」/ 前端「统计」），同一分类在算法广场
   & 历史对照页长得不一样。 */

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

/** 算法列表头（算法名）。memo：列集合稳定时表头不随滚动/筛选重渲染。 */
const ColumnHeader = memo(function ColumnHeader({ name, sticky }: { name: string; sticky?: boolean }) {
  return (
    <div
      className={`flex h-full w-[86px] shrink-0 items-center justify-center px-1 text-center ${
        sticky ? "sticky left-[160px] z-20 ring-1 ring-brand-red/30" : ""
      }`}
      title={name}
    >
      <span className="block max-w-full truncate text-[11px] font-semibold text-paper-800">
        {name}
      </span>
    </div>
  );
});

/**
 * 单个单元格：某算法在某期的预测号码 + 命中高亮 + 奖级。
 *
 * ⚠️ M13：`won` 必须是 `!!col.prize`，不能是 `col.prize !== null` ——
 * 后端可能下发空字符串表示未中奖，`!== null` 会把空串误判成中奖。
 */
const Column = memo(function Column({
  col, draw,
}: {
  col: PredictionColumn;
  draw: PredictionItem;
}) {
  const redSet = useMemo(() => new Set(draw.red), [draw.red]);
  const blueSet = useMemo(() => new Set(draw.blue), [draw.blue]);
  const won = !!col.prize;
  return (
    <div
      className={`flex h-full w-[86px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 transition ${
        won
          /* ⚠️ 必须**不透明**底色：共识列 sticky，半透明底色会让后面的算法列
             横向滚动时从它里面透上来（`/60`、`/50` 已实测透底）。 */
          ? "border-emerald-200 bg-emerald-50"
          : "border-paper-100 bg-paper-50"
      }`}
    >
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
});

export default function PredictionMatrix({
  items, redLabel, blueLabel,
}: {
  items: PredictionItem[];
  redLabel: string;
  blueLabel: string;
}) {
  const [onlyWin, setOnlyWin] = useState(true);
  const [cat, setCat] = useState<string>("all");

  // 分类选项：仅从数据中出现过的分类取，保证切换有意义。
  // 显示名用后端下发的 category_name（取不到才退回 key —— 至少不会显示错名字）
  const cats = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) {
      for (const a of it.predictions?.algos ?? []) {
        const k = a.category;
        if (k && !m.has(k)) m.set(k, a.category_name || k);
      }
    }
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [items]);

  /**
   * 统一列集合 —— 单一横向滚动的前提：所有行必须有**同一套列**，否则列错位。
   * 之前是每行独立过滤 onlyWin，导致每行列数不同；现在改为列级过滤：
   * 取所有期算法列的并集（按 id/name 去重），`onlyWin` 时只保留「当前页
   * 至少有一期中奖」的算法列。语义仍可理解为「只看中奖列」，且跨期对齐。
   */
  const allCols = useMemo(() => {
    const m = new Map<string, PredictionColumn>();
    for (const it of items) {
      for (const a of it.predictions?.algos ?? []) {
        const k = a.id ?? a.name;
        if (!m.has(k)) m.set(k, a);
      }
    }
    return [...m.entries()];
  }, [items]);

  const columns = useMemo(
    () =>
      allCols.filter(([key, col]) => {
        if (cat !== "all" && col.category !== cat) return false;
        if (onlyWin) {
          return items.some((it) =>
            (it.predictions?.algos ?? []).some(
              (a) => (a.id ?? a.name) === key && !!a.prize
            )
          );
        }
        return true;
      }),
    [allCols, cat, onlyWin, items]
  );

  /** 每期 → 算法 id → 列，供数据行按统一列集合取值。 */
  const rows = useMemo(
    () =>
      items.map((it) => ({
        draw: it,
        consensus: it.predictions?.consensus ?? null,
        algoMap: new Map(
          (it.predictions?.algos ?? []).map((a) => [a.id ?? a.name, a] as const)
        ),
      })),
    [items]
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
          {cats.map(([key, name]) => (
            <button
              key={key}
              onClick={() => setCat(key)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                cat === key
                  ? "border-brand-red/50 bg-brand-red/15 text-brand-red"
                  : "border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
              }`}
            >
              {name}
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
        <div className="overflow-hidden rounded-2xl border border-paper-100 bg-white/70">
          {/* 单一横向滚动容器：15 行 + 表头一起滚，算法列全程对齐 */}
          <div
            tabIndex={0}
            role="region"
            aria-label="算法对照矩阵，可横向滚动查看全部算法"
            className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold/40"
          >
            <div className="w-max min-w-full">
              {/* 表头 */}
              <div className="flex border-b border-paper-200 bg-paper-50">
                <div className="sticky left-0 z-20 flex w-[160px] shrink-0 items-center border-r border-paper-200 bg-paper-50 px-3 py-2 text-xs font-semibold text-paper-700">
                  期号 / 开奖号码
                </div>
                {/* 共识列常显（sticky），表头也占位对齐 */}
                <ColumnHeader name="共识" sticky />
                {columns.map(([key, col]) => (
                  <div key={key} className="p-1">
                    <ColumnHeader name={col.name} />
                  </div>
                ))}
              </div>

              {/* 数据行 */}
              {rows.map(({ draw, consensus, algoMap }) => (
                <div key={draw.issue} className="flex border-b border-paper-100">
                  {/* sticky 期号 + 开奖号码列 */}
                  <div className="sticky left-0 z-10 w-[160px] shrink-0 border-r border-paper-200 bg-white px-3 py-2">
                    <div className="text-sm font-bold text-paper-900">
                      第 {draw.issue} 期
                    </div>
                    <div className="text-xs text-paper-600">{draw.date}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-0.5 text-[10px] text-paper-600">
                      {redLabel}：
                      {draw.red.map((n) => (
                        <MiniBall key={`dr${n}`} n={n} kind="red" hit={false} />
                      ))}
                      {blueLabel}：
                      {draw.blue.map((n) => (
                        <MiniBall key={`db${n}`} n={n} kind="blue" hit={false} />
                      ))}
                    </div>
                    <div className="mt-1 text-[10px] text-paper-500">
                      {draw.predictions
                        ? `${draw.predictions.count} 算法 · ${draw.run_date ?? ""}`
                        : "无预测数据（早于跑批上线）"}
                    </div>
                  </div>

                  {/* 共识单元格（sticky） */}
                  <div className="sticky left-[160px] z-10 bg-white p-1 ring-1 ring-brand-red/30">
                    {consensus ? (
                      <Column col={consensus} draw={draw} />
                    ) : (
                      <div className="flex h-full w-[86px] items-center justify-center text-[10px] text-paper-400">
                        —
                      </div>
                    )}
                  </div>

                  {/* 各算法单元格：按统一列集合取值，缺失留空占位保持对齐 */}
                  {columns.map(([key]) => {
                    const a = algoMap.get(key);
                    return (
                      <div key={key} className="p-1">
                        {a ? (
                          <Column col={a} draw={draw} />
                        ) : (
                          <div className="flex h-full w-[86px] items-center justify-center text-[10px] text-paper-300">
                            —
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {columns.length === 0 && (
                <div className="p-6 text-center text-xs text-paper-400">
                  当前过滤条件下无算法列
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
