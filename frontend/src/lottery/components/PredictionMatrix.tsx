import { memo, useMemo, useState } from "react";
import type { PredictionColumn, PredictionItem } from "../types";
import { CheckCircle2, Filter, XCircle } from "lucide-react";

/**
 * 历史开奖 × 算法推荐对照矩阵。
 *
 * 布局要点（2026-11-20 重做）
 * --------------------------
 * 单一横向滚动容器（15 行 + 表头一起滚，算法列全程对齐），但**视觉上保持
 * 「每期一张卡片」**：表头是均匀网格，数据行是有分隔的卡片带，不再出现
 * 「表头高低不齐 / 共识列贯穿红框」这类破坏观感的问题。
 *
 * 期号列已移除（2026-11-20）：开奖号码不再单独列一遍 —— 命中号码在格子里
 * 本来就是实心高亮，靠底色已能看出「这期开了哪几个」，左列纯属冗余。
 * 期号只在每行最左侧的窄条里显示，随横向滚动吸住。
 *
 * 「只看中奖」是**行级**过滤：只保留「当前页至少有一个中奖格子」的期，该期
 * 内部的列仍完整显示（方便看该期各算法推荐了什么）。不做格子级隐藏 ——
 * 那样会把行内留出大量空洞，行高参差，反而更难读。
 *
 * 踩过的坑（改之前先读）：
 * - 表头各单元格必须**同一套盒模型**（同高、同 padding、同外包装）。之前
 *   算法列外面套了一层 `<div className="p-1">` 而共识列没有 → 表头高低不齐。
 * - 共识列**不要用 `ring-*`**：在单一滚动容器里它会被拉成贯穿整列的红色竖线，
 *   非常刺眼。改用极淡底色 + 右侧 1px 分隔线表达「这一列特殊」。
 * - 算法名固定 `w-[108px] + line-clamp-3`：太窄会截成「VAE 变自分…」，
 *   太高会让表头随名字长短跳动。三行 + 固定行高两头都占住。
 */

const PRIZE_ORDER = ["一等奖", "二等奖", "三等奖", "四等奖", "五等奖", "六等奖",
  "七等奖", "八等奖", "九等奖"];

/** 列宽常量：表头与数据行必须引用同一份，否则一定错位。 */
const COL_W = "w-[108px]";
/** 共识列 sticky 吸在最左（左列移除后 left 偏移为 0）。 */
const CONSENSUS_LEFT = "left-0";

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
      className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-bold leading-none ${
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
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[9px] font-semibold ${
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
    <span className="inline-flex items-center gap-0.5 rounded-full bg-paper-100 px-1.5 py-0 text-[9px] text-paper-500">
      <XCircle size={10} />
      未中奖
    </span>
  );
}

/** 算法列表头。固定两行高度，名字长短不影响表头行高。 */
const ColumnHeader = memo(function ColumnHeader({
  name, highlight,
}: { name: string; highlight?: boolean }) {
  return (
    <div className={`${COL_W} shrink-0 px-1.5`} title={name}>
      <span
        className={`line-clamp-3 block text-[9.5px] font-semibold leading-[1.25] ${
          highlight ? "text-brand-red" : "text-paper-700"
        }`}
      >
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
      className={`flex h-[74px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 py-1 transition ${
        won
          /* ⚠️ 必须**不透明**底色：共识列 sticky，半透明底色会让后面的算法列
             横向滚动时从它里面透上来。 */
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
  /**
   * 行集合。「只看中奖」时**整行都没有中奖格子**就跳过该期 —— 否则会留下
   * 一条只有期号、右边全是空白的行（既浪费空间又让人以为数据丢了）。
   * 判断口径与格子级渲染一致：在**当前可见列**里至少有一个带奖级的格子。
   */
  const rows = useMemo(() => {
    const visibleKeys = new Set(columns.map(([k]) => k));
    return items
      .map((it) => ({
        draw: it,
        consensus: it.predictions?.consensus ?? null,
        algoMap: new Map(
          (it.predictions?.algos ?? []).map((a) => [a.id ?? a.name, a] as const)
        ),
      }))
      .filter(({ draw, consensus, algoMap }) => {
        if (!onlyWin) return true;
        if (consensus && !!consensus.prize) return true;
        for (const [k, a] of algoMap) {
          if (visibleKeys.has(k) && !!a.prize) return true;
        }
        return false;
      });
  }, [items, columns, onlyWin]);

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
              {/* ---------- 表头：只在「全部显示」时出现 ----------
                  「只看中奖」下数据行只渲染中奖格子，行与行的列自然错开，
                  表头无法对齐任何一行，留着反而误导，故隐藏。 */}
              {!onlyWin && (
              <div className="flex h-[52px] items-center border-b border-paper-200 bg-paper-50">
                {/* 期号窄条（唯一保留的左列，只放期号，随滚动吸住） */}
                <div
                  className="sticky left-0 z-20 flex h-full w-[64px] shrink-0 items-center justify-center border-r border-paper-200 bg-paper-50 px-1 text-[10px] font-semibold text-paper-600"
                >
                  期号
                </div>
                {/* 共识列：极淡底色 + 右侧细线，不用 ring（会被拉成贯穿红线） */}
                <div
                  className={`sticky left-[64px] z-20 flex h-full ${COL_W} shrink-0 items-center justify-center border-r border-paper-200 bg-brand-red/[0.035] px-1.5`}
                >
                  <span className="text-[10px] font-semibold text-brand-red">共识</span>
                </div>
                {columns.map(([key, col]) => (
                  <ColumnHeader key={key} name={col.name} />
                ))}
                {columns.length === 0 && (
                  <div className="px-3 text-[10px] text-paper-400">无算法列</div>
                )}
              </div>
              )}

              {/* ---------- 数据行：每期一条 ---------- */}
              <div className="divide-y divide-paper-100">
                {rows.map(({ draw, consensus, algoMap }) => (
                  <div
                    key={draw.issue}
                    className="flex items-center transition hover:bg-paper-50/60"
                  >
                    {/* 期号窄条（sticky，只有期号 + 日期） */}
                    <div
                      className="sticky left-0 z-10 flex w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 self-stretch border-r border-paper-200 bg-white px-1 py-2"
                    >
                      <span className="whitespace-nowrap text-[11px] font-bold text-paper-900">
                        {draw.issue}
                      </span>
                      <span className="whitespace-nowrap text-[9px] text-paper-400">
                        {draw.date.slice(5)}
                      </span>
                    </div>

                    {/* 共识单元格（sticky）。只看中奖且共识未中奖时**整格不渲染**，
                        否则会留下一条空的粉色底纹（视觉噪点）。 */}
                    {consensus && (!onlyWin || consensus.prize) ? (
                      <div
                        className={`sticky left-[64px] z-10 ${COL_W} shrink-0 border-r border-paper-200 bg-brand-red/[0.035] px-1 py-1`}
                      >
                        <Column col={consensus} draw={draw} />
                      </div>
                    ) : null}

                    {/* 各算法单元格。「只看中奖」时该行未中奖的算法**整格不渲染** ——
                        只显示这一期真正中奖的算法，横向不会留下大片空白。
                        表头仍按 columns 全量渲染（列定义要稳定），行与行之间
                        因此不对齐，这正是「只看中奖」要的稀疏视图。 */}
                    {columns.map(([key]) => {
                      const a = algoMap.get(key);
                      if (!a) return null;
                      if (onlyWin && !a.prize) return null;
                      return (
                        <div key={key} className={`${COL_W} shrink-0 px-1 py-1`}>
                          <Column col={a} draw={draw} />
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* 过滤后一行不剩：给明确提示，别留一片空白 */}
                {rows.length === 0 && (
                  <div className="py-10 text-center text-xs text-paper-500">
                    {onlyWin
                      ? "当前页没有中奖的算法列，试试关掉「只看中奖」或换一页"
                      : "当前过滤条件下无可显示的数据"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
