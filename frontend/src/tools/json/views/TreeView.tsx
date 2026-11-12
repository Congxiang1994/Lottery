/**
 * 节点树：可折叠结构视图，支持**同级方块拖拽排序**。
 *
 * 与左栏的关系：两栏共用同一份行模型（sourceLines），行行对齐；
 * 折叠 / 展开、拖动重排都会同时反映到左栏源码。
 *
 * 拖拽交互（2026-11-12 用户要求重做）：
 *  - 按下手柄后进入「方块排序模式」：**只显示同级节点**，每个节点渲染成一个方块；
 *  - 方块按顺序纵向排列，鼠标上下移动时，方块之间用 `translateY` 平滑让位
 *    （160ms cubic-bezier 缓动），像"挪动积木"；
 *  - **不可能拖到子节点上** —— 因为子节点在这个模式下根本不渲染，
 *    所以不需要红框/错误提示，拖到哪里都是合法的同级位置。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Minimize2, Maximize2, Network, GripVertical, ClipboardCopy, X } from "lucide-react";
import type { SourceLine } from "./sourceLines.ts";
import { canMoveSibling, moveSibling } from "./treeModel.ts";
import Tip from "../../Tip";

const KIND_COLOR: Record<string, string> = {
  object: "text-paper-500", array: "text-paper-500",
  string: "text-amber-700", number: "text-violet-700",
  boolean: "text-violet-700", null: "text-paper-400",
};

/** 与左栏 SourceView 的行高严格一致（22px + py-1 容器内边距） */
const ROW_H = 22;
/** 方块模式下的方块高度（更高更好拖，也更有"积木"手感） */
const BLOCK_H = 34;
/** 方块重排动画时长 —— 要能看出"滑动让位"，又不能拖沓 */
const ANIM_MS = 160;

export interface TreeViewProps {
  lines: SourceLine[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onHoverBlock: (block: [number, number] | null) => void;
  onMove?: (parentPath: string, fromIndex: number, toIndex: number, finalValue?: unknown) => void;
  onPreview?: (value: unknown | null, draggingPath: string | null) => void;
  rootValue?: unknown;
}

function toTreeRows(lines: SourceLine[]): SourceLine[] {
  return lines;
}

export default function TreeView({
  lines, expanded, onToggle, onExpandAll, onCollapseAll, onHoverBlock, onMove, onPreview, rootValue,
}: TreeViewProps) {
  /** 正在拖动的节点路径；非 null 即「方块模式」 */
  const [dragging, setDragging] = useState<string | null>(null);
  /** 鼠标当前处于第几个方块的位置（0..n，n 表示末尾） */
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  /**
   * 拖动期间**冻结**的同级列表。
   *
   * ⚠️ 这是修掉"顺序乱掉"的关键：拖动时父级会不断按预演值重算行模型，
   * rows / siblings / fromSlot 都会随之变化 —— 方块模式若继续读实时数据，
   * 起始位与方块顺序就会跟着漂移，表现为左右不一致、方块位置乱跳。
   * 所以在按下的瞬间把兄弟列表连同起始下标一起冻结，拖动全程只认这一份。
   */
  const [frozen, setFrozen] = useState<{ list: SourceLine[]; from: number; parentPath: string } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);

  const onMoveCb = useRef(onMove); onMoveCb.current = onMove;
  const onPreviewRef = useRef(onPreview); onPreviewRef.current = onPreview;
  const rootRef = useRef(rootValue); rootRef.current = rootValue;
  /** 上一次已上抛的目标槽位，避免同一位置反复重渲染 */
  const lastEmit = useRef<number | null>(null);

  const rows = useMemo(() => toTreeRows(lines), [lines]);

  /* ------------------------------------------------------------------ *
   * 方块模式的数据准备
   * ------------------------------------------------------------------ */

  /** 被拖的节点：优先从冻结列表里取（实时 rows 会随预演变化，不能依赖） */
  const draggingRow = useMemo(() => {
    if (!dragging) return null;
    if (frozen) return frozen.list.find((r) => r.path === dragging) ?? null;
    return rows.find((r) => r.path === dragging) ?? null;
  }, [dragging, frozen, rows]);

  /**
   * 同级节点（方块模式下显示的内容）——使用**冻结**的那一份，不读实时 rows。
   *
   * 说明：容器节点在行模型里是「open 行 + … + close 行」，两行 path / parentPath
   * 相同，所以构建冻结列表时已排除 close 行，避免同一节点重复出现。
   */
  const siblings = frozen?.list ?? [];

  /** 被拖的是同级里的第几个（也来自冻结数据） */
  const fromSlot = frozen?.from ?? -1;

  /** 目标位置（松手后会落在第几位） */
  const [targetSlot, setTargetSlot] = useState<number | null>(null);

  /** 拖动开始：记录起点，锁住滚动 */
  const beginDrag = (e: React.PointerEvent, row: SourceLine) => {
    if (!onMove) return;
    if (row.keyText === null) return; // 根节点没有同级
    e.preventDefault();
    e.stopPropagation();
    // 先冻结兄弟列表（此刻 rows 还是拖动前的真实数据）
    const sibs = rows.filter(
      (r) => r.parentPath === row.parentPath && r.keyText !== null && r.kind !== "close",
    );
    const from = sibs.findIndex((r) => r.path === row.path);
    if (from < 0 || row.parentPath === null) return;
    setFrozen({ list: sibs, from, parentPath: row.parentPath });
    setDragging(row.path);
    setHovered(null);
    onHoverBlock(null);
    setHoverSlot(null);
    setTargetSlot(null);
    lastEmit.current = null;
  };

  /** 拖动全程走 document 监听：指针移出容器也不丢事件 */
  useEffect(() => {
    if (!dragging || !draggingRow) return;

    const listTop = () => scroller.current?.getBoundingClientRect().top ?? 0;
    const count = siblings.length;

    /** 鼠标 Y → 目标槽位（0..count） */
    const slotFromY = (clientY: number): number => {
      const y = clientY - listTop() - 6; // 顶部内边距
      const raw = Math.round(y / BLOCK_H);
      return Math.max(0, Math.min(count, raw));
    };

    const onMoveEv = (e: PointerEvent) => {
      const slot = slotFromY(e.clientY);
      // ⚠️ 只在槽位真的变化时才 setState / 上抛预演：
      //    指针每秒触发几十上百次，无条件更新会疯狂重渲染（之前抖动的根因）。
      setHoverSlot((prev) => (prev === slot ? prev : slot));
      const at = slot > fromSlot ? slot - 1 : slot;
      setTargetSlot((prev) => (prev === at ? prev : at));
      if (at === lastEmit.current) return;
      lastEmit.current = at;
      if (at !== fromSlot && rootRef.current !== undefined && onPreviewRef.current && draggingRow.parentPath !== null) {
        onPreviewRef.current(moveSibling(rootRef.current, draggingRow.parentPath, fromSlot, at), dragging);
      } else {
        onPreviewRef.current?.(null, dragging);
      }
    };

    const onUp = () => {
      const at = targetSlot;
      if (at !== null && at !== fromSlot && draggingRow.parentPath !== null && rootRef.current !== undefined) {
        const nextVal = moveSibling(rootRef.current, draggingRow.parentPath, fromSlot, at);
        // 直接落盘预演值，父级不必再算（它手上还是拖动前的旧值）
        onMoveCb.current?.(draggingRow.parentPath, fromSlot, at, nextVal);
      }
      setDragging(null);
      setFrozen(null);
      setHoverSlot(null);
      setTargetSlot(null);
      lastEmit.current = null;
      onPreviewRef.current?.(null, null);
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
  }, [dragging, draggingRow, siblings.length, fromSlot, targetSlot]);

  /* ------------------------------------------------------------------ *
   * 方块模式的视觉排序
   * ------------------------------------------------------------------ */

  /**
   * 每个方块在拖动中的目标位置（用于 translateY 平滑让位）。
   * - 被拖方块：跟随目标槽位；
   * - 其它方块：目标槽在它之前 → 下移一格；之后 → 上移一格。
   */
  const blockOrder = useMemo(() => {
    const n = siblings.length;
    const map = new Map<string, number>();
    const target = targetSlot ?? fromSlot;
    let cursor = 0;
    for (let i = 0; i < n; i += 1) {
      if (i === fromSlot) continue;         // 被拖方块单独处理
      if (cursor === target) cursor += 1;    // 给被拖方块留位
      map.set(siblings[i].path, cursor);
      cursor += 1;
    }
    // 被拖方块本身固定在 target 位
    if (fromSlot >= 0) map.set(siblings[fromSlot].path, Math.max(0, Math.min(n - 1, target)));
    return map;
  }, [siblings, fromSlot, targetSlot]);

  const isDraggingMode = dragging !== null && siblings.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      {/* 头部 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
        <Network size={13} className="text-[#0d9488]" /> 节点树
        <span className="tabular-nums">
          {isDraggingMode ? `调整「${draggingRow?.keyText}」的兄弟顺序` : `${rows.length} 个节点`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isDraggingMode ? (
            <Tip text="取消拖动（Esc）" side="bottom">
              <button
                onClick={() => { setDragging(null); setFrozen(null); setTargetSlot(null); setHoverSlot(null); lastEmit.current = null; onPreviewRef.current?.(null, null); }}
                className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-rose-600"
              >
                <X size={12} strokeWidth={2.4} />
              </button>
            </Tip>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* 主体 */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto py-1">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-paper-500">粘贴或输入 JSON 后显示节点树。</p>
        ) : isDraggingMode ? (
          /* ============ 方块模式：只显示同级节点，像挪动积木 ============ */
          <div className="px-2" style={{ height: siblings.length * BLOCK_H + 8 }}>
            {siblings.map((s, i) => {
              const isSelf = s.path === dragging;
              const slot = blockOrder.get(s.path) ?? i;
              return (
                <div
                  key={s.path}
                  className={`absolute left-2 right-2 flex items-center gap-2 rounded-xl border px-2.5 text-[12.5px] ${
                    isSelf
                      ? "z-20 border-[#0d9488] bg-white shadow-lg"
                      : "z-10 border-paper-200 bg-white/95 shadow-sm"
                  }`}
                  style={{
                    height: BLOCK_H - 4,
                    top: 4,
                    transform: `translateY(${slot * BLOCK_H}px)`,
                    transition: `transform ${ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                    cursor: isSelf ? "grabbing" : "default",
                  }}
                >
                  <GripVertical size={12} className={isSelf ? "text-[#0d9488]" : "text-paper-300"} />
                  <span className="shrink-0 font-mono text-[#0d9488]">{s.keyText}</span>
                  <span className="shrink-0 text-paper-400">:</span>
                  <span className={`min-w-0 flex-1 truncate font-mono ${KIND_COLOR[s.valueKind] ?? ""}`}>
                    {s.valueText}
                  </span>
                  {isSelf && <span className="shrink-0 rounded-full bg-[#0d9488]/12 px-1.5 py-px text-[10px] text-[#0d9488]">拖动中</span>}
                </div>
              );
            })}
            {/* 落位提示：一条细的插入标记，不是红框 */}
            {hoverSlot !== null && (
              <div
                className="pointer-events-none absolute left-2 right-2 rounded-full bg-[#0d9488]/60"
                style={{
                  height: 2,
                  top: 4 + Math.max(0, Math.min(siblings.length, hoverSlot)) * BLOCK_H - 1,
                  transition: `top ${ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                }}
              />
            )}
          </div>
        ) : (
          /* ============ 普通模式：完整树，行行对齐左栏 ============ */
          <div className="relative" style={{ height: rows.length * ROW_H }}>
            {rows.map((row, i) => {
              // 收尾括号行：左栏有这一行，右栏也要占位，否则后面全部错位
              if (row.kind === "close") {
                return (
                  <div
                    key={`${row.index}-${row.path}-close`}
                    className="absolute left-0 flex w-full items-center text-[12.5px] text-paper-300"
                    style={{ height: ROW_H, transform: `translateY(${i * ROW_H}px)`, paddingLeft: 4 + row.depth * 16 }}
                    aria-hidden
                  >
                    <span className="w-3 shrink-0" />
                    <span className="w-4 shrink-0 border-l border-paper-300" style={{ height: ROW_H - 6 }} />
                  </div>
                );
              }

              const isFoldable = !row.foldPath ? row.kind === "open" : true;
              const isExpanded = row.kind === "open" && !row.foldPath;

              return (
                <div
                  key={`${row.index}-${row.path}-${row.kind}`}
                  onMouseEnter={() => {
                    if (dragging) return;
                    setHovered(row.path);
                    onHoverBlock([row.blockStart, row.blockEnd]);
                  }}
                  onMouseLeave={() => {
                    if (dragging) return;
                    setHovered((prev) => (prev === row.path ? null : prev));
                    onHoverBlock(null);
                  }}
                  className={`group absolute left-0 flex w-full items-center gap-1 rounded-lg px-1 text-[12.5px] ${
                    hovered === row.path ? "bg-amber-300/35" : "hover:bg-amber-200/25"
                  }`}
                  style={{ height: ROW_H, transform: `translateY(${i * ROW_H}px)`, paddingLeft: 4 + row.depth * 16 }}
                >
                  {row.keyText !== null && onMove ? (
                    <button
                      onPointerDown={(e) => beginDrag(e, row)}
                      title="拖动调整同级顺序"
                      className="grid h-4 w-3 shrink-0 cursor-grab place-items-center text-paper-300 opacity-0 transition hover:text-paper-600 group-hover:opacity-100 active:cursor-grabbing"
                      style={{ touchAction: "none" }}
                    >
                      <GripVertical size={10} />
                    </button>
                  ) : <span className="w-3 shrink-0" />}

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
                  <span
                    className={`min-w-0 flex-1 truncate font-mono ${row.kind === "open" || row.kind === "inline" ? "text-paper-500" : (KIND_COLOR[row.valueKind] ?? "")}`}
                    title={row.valueText}
                  >
                    {row.valueText}
                  </span>

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

      {/* 底部状态行 */}
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-paper-200/70 px-3 text-[11px] text-paper-500">
        {isDraggingMode ? (
          <span className="truncate text-[#0d9488]">上下移动选择位置 · 松手生效 · Esc 取消</span>
        ) : (
          <span className="truncate">悬停节点高亮源码 · 拖手柄调整同级顺序 · 箭头折叠/展开</span>
        )}
      </div>
    </div>
  );
}
