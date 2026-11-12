/**
 * 节点树：按**行模型**渲染，与左栏源码行行对齐，支持折叠/展开与同级拖拽调序。
 *
 * 与左栏的关系（2026-11-12 用户需求）：
 *  - 两边共用 ``buildSourceLines`` 产出的行序列，**行数与行序天然一致**；
 *  - 折叠/展开改的是同一个 ``expanded`` 集合 → 左栏对应位置同步变成 `...`；
 *  - 悬停某个节点 → 通过 ``onHoverBlock`` 把「该节点含子孙的整块行区间」告诉父级，
 *    左栏据此铺黄色底色。
 *
 * 拖拽仍限同级，语义与之前一致（只换 key / 元素顺序，不改嵌套）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Minimize2, Maximize2, Network, GripVertical, ClipboardCopy } from "lucide-react";
import type { SourceLine } from "./sourceLines.ts";
import { canDropOn, canMoveSibling, moveSibling } from "./treeModel.ts";
import Tip from "../../Tip";

const KIND_COLOR: Record<string, string> = {
  object: "text-paper-500", array: "text-paper-500",
  string: "text-amber-700", number: "text-violet-700",
  boolean: "text-violet-700", null: "text-paper-400",
};

/** 与左栏 SourceView 的行高严格一致（22px + py-1 容器内边距） */
const ROW_H = 22;

export interface TreeViewProps {
  /** 行模型（与左栏同一份） */
  lines: SourceLine[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** 悬停节点 → 交出「含子孙的整块行区间」；移出为 null */
  onHoverBlock: (block: [number, number] | null) => void;
  /** 同级调序回调 */
  onMove?: (parentPath: string, fromIndex: number, toIndex: number, finalValue?: unknown) => void;
  /**
   * 拖动中的「预演值」上抛：父组件用它重算行模型，
   * 于是**左右两栏一起实时变化**（松手前就能看到最终效果）。
   * 传 null 表示拖动结束，恢复真实值。
   */
  onPreview?: (value: unknown | null, draggingPath: string | null) => void;
  /** 原始值（用来算预演结果） */
  rootValue?: unknown;
}

/**
 * 树与源码**行数必须完全一致**，否则两栏会错位。
 * 容器节点在源码里占「开括号行 + … + 收尾行」，树上：开括号行显示节点本身，
 * 收尾行渲染成一条很淡的连接线占位（不重复显示节点名）。
 */
function toTreeRows(lines: SourceLine[]): SourceLine[] {
  return lines;
}

export default function TreeView({ lines, expanded, onToggle, onExpandAll, onCollapseAll, onHoverBlock, onMove, onPreview, rootValue }: TreeViewProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; targetPath: string; valid: boolean } | null>(null);
  const [hint, setHint] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const onMoveCb = useRef(onMove);
  onMoveCb.current = onMove;
  /** 预演回调也走 ref：避免它进 effect 依赖导致反复解绑/重绑 */
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  /** rootValue 同理（拖动期间父级会更新它，但我们要的是最新一份） */
  const rootRef = useRef(rootValue);
  rootRef.current = rootValue;
  const draggingRef = useRef<string | null>(null);
  const lastDrop = useRef<{ insertIndex: number; fromIndex: number; parentPath: string; toIndex: number } | null>(null);
  /** 拖动中预算好的「松手后的值」——松手时直接交给父级落盘，避免它再算一遍拿到旧数据 */
  const previewValRef = useRef<unknown>(null);
  /** 拖动开始时的原始位置（rows 会随预演变化，必须提前记住） */
  const originIndexRef = useRef(new Map<string, number>());

  const rows = useMemo(() => toTreeRows(lines), [lines]);

  /** 行在树里的下标（拖拽落点按树行算） */
  const rowIndexOf = (path: string) => rows.findIndex((r) => r.path === path);

  const computeDrop = (clientY: number) => {
    const el = scroller.current;
    const cur = draggingRef.current;
    if (!el || !cur) return null;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top - 4 + el.scrollTop; // py-1 = 4px
    const hoverIdx = Math.max(0, Math.min(rows.length - 1, Math.floor(y / ROW_H)));
    const before = y - hoverIdx * ROW_H < ROW_H / 2;
    const hovered = rows[hoverIdx];
    // 收尾占位行不是节点，不能当落点
    if (!hovered || hovered.kind === "close") return null;
    const from = rows.find((r) => r.path === cur);
    if (!from) return null;
    const check = canDropOn(rows, cur, hovered.path);
    return {
      valid: check.ok,
      reason: check.reason,
      lineIndex: before ? hoverIdx : hoverIdx + 1,
      target: hovered,
      insertIndex: hovered.index_in_parent + (before ? 0 : 1),
    };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMoveEv = (e: PointerEvent) => {
      const cur = draggingRef.current;
      const d = computeDrop(e.clientY);
      if (!d) return;
      setDropAt({ index: d.lineIndex, targetPath: d.target.path, valid: d.valid });
      setHint(d.valid ? "" : (d.reason ?? ""));
      if (d.valid && cur) {
        const from = rows.find((r) => r.path === cur);
        if (from && from.parentPath !== null) {
          const chk0 = canMoveSibling(rows, cur, d.insertIndex);
          if (chk0.ok && chk0.toIndex !== undefined) {
            // 原始下标也在拖动开始时记一次（rows 之后会变），存进 ref
            const orig = originIndexRef.current.get(cur) ?? from.index_in_parent;
            lastDrop.current = { insertIndex: d.insertIndex, fromIndex: orig, parentPath: from.parentPath, toIndex: chk0.toIndex };
          }
        }
        // 预算「松手后的值」并上抛 → 父级据此重算行模型，
        // 左右两栏因此同步实时预览，而不是只有树在动。
        if (from && from.parentPath !== null && onPreviewRef.current && rootRef.current !== undefined) {
          const chk = canMoveSibling(rows, cur, d.insertIndex);
          if (chk.ok && chk.toIndex !== undefined) {
            const orig = originIndexRef.current.get(cur) ?? from.index_in_parent;
            const nextVal = moveSibling(rootRef.current, from.parentPath, orig, chk.toIndex);
            previewValRef.current = nextVal;
            onPreviewRef.current(nextVal, cur);
          } else {
            previewValRef.current = null;
            onPreviewRef.current(null, cur);
          }
        }
      } else {
        lastDrop.current = null;
        onPreviewRef.current?.(null, cur);
      }
    };
    const onUp = () => {
      const cur = draggingRef.current;
      const pending = lastDrop.current;
      /**
       * ⚠️ 这里**不能**再从 rows 里取 from.index_in_parent：
       * 拖动过程中 rows 已是「预演后」的数据，被拖节点在列表里的序号已经变了，
       * 拿它再校验会判成「位置没有变化」而拒绝落盘（踩过）。
       * 于是：parentPath 从 pending 里带，fromIndex 用拖动开始时记下的原始值。
       */
      if (pending && cur && onMoveCb.current) {
        if (previewValRef.current !== null) {
          // 预演值已算好 —— 直接落盘，父级不必再算（它手上的还是拖动前的旧值）
          onMoveCb.current(pending.parentPath, pending.fromIndex, pending.toIndex, previewValRef.current);
        }
      } else if (cur && !pending) {
        setHint("只能在同一层级内调序");
      }
      draggingRef.current = null;
      lastDrop.current = null;
      previewValRef.current = null;
      onPreviewRef.current?.(null, null);
      setDragging(null);
      setDropAt(null);
      window.setTimeout(() => setHint(""), 1800);
    };
    document.addEventListener("pointermove", onMoveEv);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMoveEv);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, rows]);

  const onPointerDown = (e: React.PointerEvent, row: SourceLine) => {
    if (!onMove) return;
    if (row.keyText === null) { setHint("根节点没有同级，无法排序"); return; }
    draggingRef.current = row.path;
    originIndexRef.current.set(row.path, row.index_in_parent);
    setDragging(row.path);
    setHint("");
    e.preventDefault();
    e.stopPropagation();
  };

  const draggingRow = dragging ? rows.find((r) => r.path === dragging) : null;

  /**
   * 拖动时的「落点槽位」——只用来画占位方条与高亮，
   * **不再做视觉位移**：行数据本身已由父级按预演值重算，
   * 两侧都在真实重排（这才是「实时预览」）。
   */
  const dropSlot = useMemo(() => {
    if (!dragging || !dropAt) return null;
    return { at: Math.max(0, Math.min(rows.length, dropAt.index)), valid: dropAt.valid };
  }, [dragging, dropAt, rows.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      {/* 头部：与左栏同高 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
        <Network size={13} className="text-[#0d9488]" /> 节点树
        <span className="tabular-nums">{rows.length} 个节点</span>
        <div className="ml-auto flex items-center gap-1">
          <Tip text="展开全部节点" side="bottom">
            <button onClick={onExpandAll} className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-[#0d9488]">
              <Maximize2 size={11} strokeWidth={2.4} />
            </button>
          </Tip>
          <Tip text="折叠全部节点" side="bottom">
            <button onClick={onCollapseAll} className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-paper-900">
              <Minimize2 size={11} strokeWidth={2.4} />
            </button>
          </Tip>
        </div>
      </div>


      {/* 行列表：行高 22px，与左栏一致。
          ⚠️ 拖拽提示做成**绝对定位浮层**，绝不能占布局高度 ——
          之前用 h-5 撑开会在按下手柄的瞬间把整棵树往下推 20px，
          既破坏与左栏的逐行对齐，观感也像"整块跳了一下"。 */}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full min-h-0 overflow-auto py-1">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-paper-500">粘贴或输入 JSON 后显示节点树。</p>
        ) : (
          <div className="relative" style={{ height: rows.length * ROW_H }}>
            {/* 占位方条：占据「松手后这一行会出现的位置」，行高与真实行一致。
                比一根细线直观得多 —— 一眼看到它最终落在哪一行、什么缩进。 */}
            {dropSlot && !dropSlot.valid && (
              <div
                className="pointer-events-none absolute left-1 right-1 z-20 rounded-lg border-2 border-dashed border-rose-400 bg-rose-500/10"
                style={{ top: dropSlot.at * ROW_H + 1, height: ROW_H - 2 }}
              />
            )}

            {rows.map((row, i) => {
              // 收尾括号行：左栏有这一行，右栏也要占位，否则后面全部错位。
              // 视觉上做得极淡，避免看起来像「重复的节点」。
              if (row.kind === "close") {
                const vClose = i;
                return (
                  <div
                    key={`${row.index}-${row.path}-close`}
                    className="absolute left-0 flex w-full items-center text-[12.5px] text-paper-300 transition-transform duration-100"
                    style={{ height: ROW_H, transform: `translateY(${vClose * ROW_H}px)`, paddingLeft: 4 + row.depth * 16 }}
                    aria-hidden
                  >
                    <span className="w-3 shrink-0" />
                    <span className="w-4 shrink-0 border-l border-paper-300" style={{ height: ROW_H - 6 }} />
                  </div>
                );
              }

              const isFoldable = !row.foldPath ? row.kind === "open" : true;
              const isExpanded = row.kind === "open" && !row.foldPath;
              const vIndex = i;
              const isBeingDragged = dragging === row.path;

              return (
                <div
                  key={`${row.index}-${row.path}-${row.kind}`}
                  onMouseEnter={() => {
                    setHovered(row.path);
                    onHoverBlock([row.blockStart, row.blockEnd]);
                  }}
                  onMouseLeave={() => {
                    setHovered((prev) => (prev === row.path ? null : prev));
                    onHoverBlock(null);
                  }}
                  className={`group absolute left-0 flex w-full items-center gap-1 rounded-lg px-1 text-[12.5px] transition-all duration-100 ${
                    isBeingDragged ? "z-10 scale-[1.01] bg-[#0d9488]/10 opacity-50 shadow-sm"
                      : hovered === row.path ? "bg-amber-300/35" : "hover:bg-amber-200/25"
                  }`}
                  style={{
                    height: ROW_H,
                    transform: `translateY(${vIndex * ROW_H}px)`,
                    paddingLeft: 4 + row.depth * 16,
                  }}
                >
                  {/* 拖拽手柄 */}
                  {row.keyText !== null && onMove ? (
                    <button
                      onPointerDown={(e) => onPointerDown(e, row)}
                      title="拖动调整同级顺序"
                      className="grid h-4 w-3 shrink-0 cursor-grab place-items-center text-paper-300 opacity-0 transition hover:text-paper-600 group-hover:opacity-100 active:cursor-grabbing"
                      style={{ touchAction: "none" }}
                    >
                      <GripVertical size={10} />
                    </button>
                  ) : <span className="w-3 shrink-0" />}

                  {/* 折叠箭头：容器才显示 */}
                  {isFoldable ? (
                    <button
                      onClick={() => onToggle(row.path)}
                      className="grid h-4 w-4 shrink-0 place-items-center text-paper-500 transition hover:text-paper-900"
                      title={isExpanded ? "折叠" : "展开"}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : <span className="w-4 shrink-0" />}

                  {row.keyText !== null && (
                    <>
                      <span className="shrink-0 font-mono text-[#0d9488]">{row.keyText}</span>
                      <span className="shrink-0 text-paper-400">:</span>
                    </>
                  )}
                  <span className={`min-w-0 flex-1 truncate font-mono ${row.kind === "open" || row.kind === "inline" ? "text-paper-500" : (KIND_COLOR[row.valueKind] ?? "")}`} title={row.valueText}>
                    {row.foldPath ? `${row.text.trim().replace(/^"?(?:[^"\\]|\\.)*"?:\s*/, "")}` : row.kind === "open" ? row.valueText : row.valueText}
                  </span>

                  {/* 复制：路径 / 值，用图标+颜色+小字区分 */}
                  <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={() => navigator.clipboard?.writeText(row.path)}
                      title="JSON Pointer 路径"
                      className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] text-[#0d9488]/80 transition hover:bg-[#0d9488]/10 hover:text-[#0d9488]"
                    >
                      <ClipboardCopy size={10} /> 路径
                    </button>
                    <button
                      onClick={() => navigator.clipboard?.writeText(row.valueText)}
                      title="这个节点的值"
                      className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] text-amber-600/80 transition hover:bg-amber-500/10 hover:text-amber-700"
                    >
                      <Copy size={10} /> 值
                    </button>
                  </div>
                </div>
              );
            })}

          </div>
        )}
      </div>

      </div>

      {/* 底部状态行 */}
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-paper-200/70 px-3 text-[11px] text-paper-500">
        {/* 拖拽提示统一走这行，不再用顶部浮层 —— 浮层会盖住第一个节点。
            有错误原因时优先显示原因（红色），否则显示正在拖动谁。 */}
        {dragging && hint ? (
          <span className="truncate font-medium text-rose-600">{hint}</span>
        ) : draggingRow ? (
          <span className="truncate">正在拖动「{draggingRow.keyText ?? draggingRow.path}」· 只可同级调序</span>
        ) : hint ? (
          <span className="truncate font-medium text-rose-600">{hint}</span>
        ) : (
          <span className="truncate">悬停节点高亮源码 · 拖动行首手柄调序 · 箭头折叠/展开</span>
        )}
      </div>
    </div>
  );
}
