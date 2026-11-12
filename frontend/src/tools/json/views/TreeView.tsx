/**
 * 节点树：右侧常驻的只读可折叠结构视图。
 *
 * 交互只有三件：点箭头折叠/展开、展开全部/折叠全部、复制路径或值。
 * 不做编辑、不做查询高亮、不做拖拽 —— 左栏源码是唯一真源。
 * 用虚拟滚动，几十 MB 的 JSON 也不会卡（视图只渲染可见行）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, FoldVertical, UnfoldVertical, Network } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { flatten, defaultExpanded, allExpandablePaths, type FlatNode } from "./treeModel.ts";
import { toDisplayString } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";

const KIND_COLOR: Record<string, string> = {
  object: "text-paper-500", array: "text-paper-500",
  string: "text-amber-700", number: "text-violet-700",
  boolean: "text-violet-700", null: "text-paper-400",
};

export interface TreeViewProps { value: unknown }

export default function TreeView({ value }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(value));
  const parentRef = useRef<HTMLDivElement>(null);

  // 数据换了就重置展开状态，否则旧路径集合会挂在新树上。
  // 父组件每次 parse 都会产生新对象引用，正好可当「换了」的信号。
  // 用 ref 跳过首次（初始 state 已经是 defaultExpanded），避免多一次无谓渲染。
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
    estimateSize: () => 28,
    overscan: 12,
  });

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      {/* 头部：与左栏编辑器头部同高同版式（h-7 + px-3 + text-xs） */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
        <Network size={13} className="text-[#0d9488]" /> 节点树
        <span className="tabular-nums">{rows.length} 行</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={() => setExpanded(allPaths)} title="展开全部" className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-paper-900">
            <UnfoldVertical size={12} />
          </button>
          <button onClick={() => setExpanded(new Set())} title="折叠全部" className="grid h-5 w-5 place-items-center rounded text-paper-500 transition hover:bg-paper-100 hover:text-paper-900">
            <FoldVertical size={12} />
          </button>
        </div>
      </div>

      {/* 主体：占满剩余高度 */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto p-2">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const node: FlatNode = rows[vi.index];
            return (
              <div
                key={node.path}
                className="group absolute left-0 flex w-full items-center gap-1 rounded-lg px-1 text-[13px] hover:bg-paper-100/70"
                style={{ height: vi.size, transform: `translateY(${vi.start}px)`, paddingLeft: 4 + node.depth * 18 }}
              >
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
                {/* 复制按钮平时隐藏，悬停该行才出现 —— 避免整屏小图标噪声 */}
                <span className="shrink-0 text-[10px] text-paper-400 opacity-100 group-hover:opacity-0">{node.expandable ? node.childCount : node.kind}</span>
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <CopyBtn text={node.path} title="复制 JSON Pointer 路径" />
                  <button
                    onClick={() => navigator.clipboard?.writeText(toDisplayString(node.value))}
                    title="复制值"
                    className="grid h-7 w-7 place-items-center rounded-lg text-paper-500 transition hover:bg-paper-200 hover:text-paper-900"
                  >
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {rows.length <= 1 && !rows[0]?.expandable && (
          <p className="p-3 text-xs text-paper-500">输入 JSON 后这里显示可折叠的节点树。</p>
        )}
      </div>

      {/* 底部：与左栏状态行同高同版式（h-6 + px-3 + text-[11px]） */}
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-paper-200/70 px-3 text-[11px] text-paper-500">
        点箭头折叠 / 展开，右侧按钮复制路径或值
      </div>
    </div>
  );
}
