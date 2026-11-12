/**
 * 节点树：右侧常驻的可折叠结构视图，支持**同级拖拽调序**。
 *
 * 交互：
 *  - 点箭头折叠/展开、展开全部/折叠全部、复制路径或值；
 *  - **拖动行上下移动**：只允许同一层级内换位（改的是对象 key 顺序 / 数组元素顺序，
 *    JSON 的嵌套关系与语义完全不变）。跨层级拖动会被拒绝并给出提示。
 *  - 拖动时显示**插入位指示线** + 其余行平滑让位动画，落点一目了然。
 *
 * 用虚拟滚动，几十 MB 的 JSON 也不会卡（视图只渲染可见行）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Minimize2, Maximize2, Network, GripVertical, ClipboardCopy } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { flatten, defaultExpanded, allExpandablePaths, canDropOn, canMoveSibling, type FlatNode } from "./treeModel.ts";
import { toDisplayString } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";
import Tip from "../../Tip";

const KIND_COLOR: Record<string, string> = {
  object: "text-paper-500", array: "text-paper-500",
  string: "text-amber-700", number: "text-violet-700",
  boolean: "text-violet-700", null: "text-paper-400",
};

const ROW_H = 28;

export interface TreeViewProps {
  value: unknown;
  /** 同级调序回调：父容器路径 + 原下标 + 目标下标 */
  onMove?: (parentPath: string, fromIndex: number, toIndex: number) => void;
}

export default function TreeView({ value, onMove }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(value));
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; targetPath: string; valid: boolean } | null>(null);
  const [hint, setHint] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  /** 回调放 ref：文档级监听里要用最新值，又不希望它进依赖数组反复重绑 */
  const onMoveCb = useRef(onMove);
  onMoveCb.current = onMove;
  /** 拖动行路径也放 ref，避免 computeDrop 闭包读到旧的 dragging */
  const draggingRef = useRef<string | null>(null);
  /** 最近一次有效落点（pointermove 写入，pointerup 直接采用） */
  const lastDrop = useRef<{ insertIndex: number; fromIndex: number } | null>(null);

  // 数据换了就重置展开状态，否则旧路径集合会挂在新树上。
  const firstValue = useRef(value);
  useEffect(() => {
    if (firstValue.current === value) return;
    firstValue.current = value;
    setExpanded(defaultExpanded(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const rows = useMemo(() => flatten(value, expanded), [value, expanded]);
  const allPaths = useMemo(() => allExpandablePaths(value), [value]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /* ------------------------- 拖拽 ------------------------- */

  /** 根据鼠标 Y 算出落在第几行、以及是「插到该行之前还是之后」 */
  const computeDrop = (clientY: number) => {
    const el = parentRef.current;
    const cur = draggingRef.current;
    if (!el || !cur) return null;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top + el.scrollTop;
    const hoverIdx = Math.max(0, Math.min(rows.length - 1, Math.floor(y / ROW_H)));
    const before = y - hoverIdx * ROW_H < ROW_H / 2;
    const hovered = rows[hoverIdx];
    if (!hovered) return null;

    const from = rows.find((r) => r.path === cur);
    if (!from || from.parentPath === null) return null;

    // 落点语义：与「被悬停行」同级，插到它的前 / 后
    const target = hovered;
    const check = canDropOn(rows, cur, target.path);
    const valid = check.ok;

    // 目标插入位 = 目标行的 index (+1 若插在其后)
    const insertIndex = target.index + (before ? 0 : 1);
    // 视觉指示线：插到 hovered 之前 → 画在 hovered 顶部；之后 → 画在 hovered 底部
    const lineIndex = before ? hoverIdx : hoverIdx + 1;
    return { valid, reason: check.reason, lineIndex, target, insertIndex };
  };


  /**
   * 拖拽全程用**文档级监听**，而不是容器上的 React 合成事件。
   *
   * 为什么：手柄按钮 pointerdown 后指针会移出容器范围（尤其拖到列表上下边界），
   * 挂在容器上的 pointermove/up 会漏事件，拖拽就"卡住"或落点失效。
   * 文档级监听不受容器裁切影响。
   */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const cur = draggingRef.current;
      const d = computeDrop(e.clientY);
      if (!d) return;
      setDropAt({ index: d.lineIndex, targetPath: d.target.path, valid: d.valid });
      setHint(d.valid ? "" : (d.reason ?? ""));
      if (d.valid && cur) {
        const from = rows.find((r) => r.path === cur);
        if (from) lastDrop.current = { insertIndex: d.insertIndex, fromIndex: from.index };
      } else {
        lastDrop.current = null;
      }
    };
    // pointerup 不重新算坐标，直接用 pointermove 记录的最后落点：
    // 用户看到的指示线在哪就落在哪，避免两次取整差异造成「看着能放、松手没动」。
    const onUp = () => {
      const cur = draggingRef.current;
      const pending = lastDrop.current;
      const from = cur ? rows.find((r) => r.path === cur) : null;
      if (pending && from && cur && onMoveCb.current && from.parentPath !== null) {
        const chk = canMoveSibling(rows, cur, pending.insertIndex);
        if (chk.ok && chk.toIndex !== undefined) {
          onMoveCb.current(from.parentPath, from.index, chk.toIndex);
        } else if (chk.reason) {
          setHint(chk.reason);
        }
      } else if (cur && !pending) {
        setHint("只能在同一层级内调序");
      }
      draggingRef.current = null;
      lastDrop.current = null;
      setDragging(null);
      setDropAt(null);
      window.setTimeout(() => setHint(""), 1800);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, rows]);

  const onPointerDown = (e: React.PointerEvent, node: FlatNode) => {
    if (!onMove) return;
    // 用 grip 手柄触发拖拽，避免和「点击行选中/折叠」冲突
    if (node.parentPath === null) { setHint("根节点没有同级，无法排序"); return; }
    draggingRef.current = node.path;
    setDragging(node.path);
    setHint("");
    e.preventDefault();
    e.stopPropagation();
  };

  const draggingRow = dragging ? rows.find((r) => r.path === dragging) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      {/* 头部：与左栏编辑器头部同高同版式 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
        <Network size={13} className="text-[#0d9488]" /> 节点树
        <span className="tabular-nums">{rows.length} 行</span>
        <div className="ml-auto flex items-center gap-1">
          {/* 展开 = 向外箭头（Maximize2）；折叠 = 向内箭头（Minimize2）。
              原来用 UnfoldVertical / FoldVertical，两个图标几乎一样、分不清。 */}
          <Tip text="展开全部节点" side="bottom">
            <button onClick={() => setExpanded(allPaths)} className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-[#0d9488]">
              <Maximize2 size={11} strokeWidth={2.4} />
            </button>
          </Tip>
          <Tip text="折叠全部节点" side="bottom">
            <button onClick={() => setExpanded(new Set())} className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-paper-900">
              <Minimize2 size={11} strokeWidth={2.4} />
            </button>
          </Tip>
        </div>
      </div>

      {/* 拖拽提示条（仅拖动中显示，不占常态空间） */}
      <div className={`shrink-0 overflow-hidden px-3 text-[11px] transition-all duration-150 ${dragging ? "h-5 py-0.5" : "h-0 py-0"} ${hint ? "bg-rose-50 text-rose-700" : "text-paper-500"}`}>
        {dragging ? (hint || "拖动中：只可在同一层级内上下调序") : ""}
      </div>

      {/* 主体（拖拽事件走 document 级监听，见上方 useEffect） */}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto p-2"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {/* 插入位指示线：拖动时出现，带渐入动画 */}
          {dropAt && (
            <div
              className={`pointer-events-none absolute left-1 right-1 z-20 rounded-full transition-all duration-150 ${
                dropAt.valid ? "bg-[#0d9488]" : "bg-rose-500"
              }`}
              style={{ top: dropAt.index * ROW_H - 1, height: 2, boxShadow: dropAt.valid ? "0 0 8px rgba(13,148,136,.6)" : "0 0 8px rgba(244,63,94,.6)" }}
            >
              <span className={`absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${dropAt.valid ? "bg-[#0d9488]" : "bg-rose-500"}`} />
            </div>
          )}

          {virtualizer.getVirtualItems().map((vi) => {
            const node: FlatNode = rows[vi.index];
            const isDragging = dragging === node.path;
            const isTarget = dropAt?.targetPath === node.path && dragging !== node.path;
            // 其余行在拖动时轻微让位，给「插到这里」腾出视觉空间
            const shift = isTarget && dropAt
              ? (dropAt.index > vi.index ? 6 : -6)
              : 0;
            return (
              <div
                key={node.path}
                className={`group absolute left-0 flex w-full items-center gap-1 rounded-lg px-1 text-[13px] transition-all duration-150 ${
                  isDragging ? "z-10 scale-[1.01] bg-[#0d9488]/10 opacity-60 shadow-sm" : "hover:bg-paper-100/70"
                }`}
                style={{
                  height: vi.size,
                  transform: `translateY(${vi.start + shift}px)`,
                  paddingLeft: 4 + node.depth * 18,
                }}
              >
                {/* 拖拽手柄：仅当可排序（非根）时出现 */}
                {node.parentPath !== null && onMove ? (
                  <button
                    onPointerDown={(e) => onPointerDown(e, node)}
                    title="拖动调整同级顺序"
                    className="grid h-5 w-3.5 shrink-0 cursor-grab place-items-center text-paper-300 opacity-0 transition hover:text-paper-600 group-hover:opacity-100 active:cursor-grabbing"
                    style={{ touchAction: "none" }}
                  >
                    <GripVertical size={11} />
                  </button>
                ) : <span className="w-3.5 shrink-0" />}

                {node.expandable ? (
                  <button onClick={() => toggle(node.path)} title={node.expanded ? "折叠" : "展开"} className="grid h-5 w-5 shrink-0 place-items-center text-paper-500 transition hover:text-paper-900">
                    {node.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                ) : <span className="w-5 shrink-0" />}

                {node.key !== null && <span className="shrink-0 font-mono text-[#0d9488]">{String(node.key)}</span>}
                {node.key !== null && <span className="shrink-0 text-paper-400">:</span>}
                <span className={`min-w-0 flex-1 truncate font-mono ${KIND_COLOR[node.kind] ?? ""}`} title={node.text}>
                  {node.text}
                </span>
                <span className="shrink-0 text-[10px] text-paper-400 opacity-100 group-hover:opacity-0">{node.expandable ? node.childCount : node.kind}</span>
                {/* 两个复制按钮原本长得一模一样，只靠悬停提示才分得清。
                    ⚠️ 这里不用 Tip 气泡：行在虚拟滚动容器里，absolute 气泡会被
                    overflow 裁掉（实测宽度算成 0）。改为「图标+颜色+常驻小字」三重区分：
                      · 复制路径 → ClipboardCopy + 青色（呼应左栏 key 的配色）
                      · 复制值   → Copy + 琥珀色（呼应值的配色） */}
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={() => navigator.clipboard?.writeText(node.path)}
                    title="JSON Pointer 路径"
                    className="flex h-7 items-center gap-0.5 rounded-lg px-1 text-[10px] text-[#0d9488]/80 transition hover:bg-[#0d9488]/10 hover:text-[#0d9488]"
                  >
                    <ClipboardCopy size={11} /> 路径
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(toDisplayString(node.value))}
                    title="这个节点的值"
                    className="flex h-7 items-center gap-0.5 rounded-lg px-1 text-[10px] text-amber-600/80 transition hover:bg-amber-500/10 hover:text-amber-700"
                  >
                    <Copy size={11} /> 值
                  </button>
                </div>
              </div>
            );
          })}

          {/* 拖到末尾的落点线 */}
          {dropAt && dropAt.index >= rows.length && (
            <div className="pointer-events-none absolute left-1 right-1 z-20 h-0.5 rounded-full bg-[#0d9488]"
              style={{ top: rows.length * ROW_H - 1, boxShadow: "0 0 8px rgba(13,148,136,.6)" }} />
          )}
        </div>
        {rows.length <= 1 && !rows[0]?.expandable && (
          <p className="p-3 text-xs text-paper-500">输入 JSON 后这里显示可折叠的节点树。</p>
        )}
      </div>

      {/* 底部状态行 */}
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-paper-200/70 px-3 text-[11px] text-paper-500">
        {draggingRow ? (
          <span className="truncate">正在拖动「{String(draggingRow.key ?? draggingRow.path)}」· 只可同级调序</span>
        ) : (
          <span className="truncate">拖动行首手柄可调整同级顺序 · 箭头折叠 / 展开</span>
        )}
      </div>
    </div>
  );
}
