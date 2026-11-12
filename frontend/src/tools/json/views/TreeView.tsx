/**
 * Tree 视图：可编辑树 + 虚拟滚动 + 双击编辑 + 复制路径/值 + 查询高亮。
 *
 * 对齐 JsonStudio：双击 key/value 直接编辑、一键复制路径、点击节点可回调定位、
 * 展开/折叠全部、查询命中节点高亮（含祖先路径由父组件传 hits）。
 * 不做拖拽调整结构（Web 版 ROI 低，且会引入重复 key 歧义风险），保留只读 +
 * 值编辑 + 结构检查这三件最高频的事。
 */
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, FoldVertical, UnfoldVertical, Pencil } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { flatten, defaultExpanded, parseEdited, toEditableParts, setAtPath, type FlatNode } from "./treeModel.ts";
import { toDisplayString } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";

const KIND_COLOR: Record<string, string> = {
  object: "text-paper-600",
  array: "text-paper-600",
  string: "text-amber-700",
  number: "text-violet-700",
  boolean: "text-violet-700",
  null: "text-paper-500",
};

export interface TreeViewProps {
  value: unknown;
  onChange?: (value: unknown) => void;
  hits?: Set<string>;
  onLocate?: (path: string) => void;
}

export default function TreeView({ value, onChange, hits, onLocate }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(value));
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => flatten(value, expanded, hits), [value, expanded, hits]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allIds = useMemo(() => {
    const all = new Set<string>();
    const walk = (v: unknown, parts: (string | number)[]) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...parts, i]));
      else for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, [...parts, k]);
      // 容器节点本身可展开
      if ((Array.isArray(v) || typeof v === "object") && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
        all.add("/" + parts.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/"));
      }
    };
    walk(value, []);
    return all;
  }, [value]);

  const beginEdit = (node: FlatNode) => {
    if (node.expandable || !onChange) return;
    setEditing(node.path);
    setDraft(node.text);
    window.setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitEdit = (node: FlatNode) => {
    setEditing(null);
    if (!onChange) return;
    const parts = toEditableParts(node.path);
    const next = parseEdited(draft);
    onChange(setAtPath(value, parts, next));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
        <span className="inline-flex items-center gap-1 text-[#0d9488]"><Pencil size={12} /> 树视图</span>
        <span className="tabular-nums">{rows.length} 行可见</span>
        {hits && hits.size > 0 && (
          <span className="rounded-full bg-brand-gold/15 px-1.5 py-px text-[11px] font-semibold text-brand-gold">
            命中 {hits.size}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setExpanded(allIds)}
            title="展开全部"
            className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100"
          >
            <UnfoldVertical size={13} />
          </button>
          <button
            onClick={() => setExpanded(new Set())}
            title="折叠全部"
            className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100"
          >
            <FoldVertical size={13} />
          </button>
        </div>
      </div>

      <div ref={parentRef} className="glass min-h-0 flex-1 overflow-auto rounded-2xl p-2 shadow-card">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const node = rows[vi.index];
            const isEditing = editing === node.path;
            return (
              <div
                key={node.id}
                className={`absolute left-0 flex w-full items-center gap-1 rounded-lg px-1 text-[13px] ${
                  node.hit ? "bg-brand-gold/15" : "hover:bg-paper-100/70"
                }`}
                style={{ height: vi.size, transform: `translateY(${vi.start}px)`, paddingLeft: 4 + node.depth * 18 }}
              >
                {node.expandable ? (
                  <button
                    onClick={() => toggle(node.id)}
                    className="grid h-5 w-5 shrink-0 place-items-center text-paper-500 hover:text-paper-900"
                    title={node.expanded ? "折叠" : "展开"}
                  >
                    {node.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}

                {node.key !== null && (
                  <span className="shrink-0 font-mono text-[#0d9488]">{String(node.key)}</span>
                )}
                {node.key !== null && <span className="shrink-0 text-paper-400">:</span>}

                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(node)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(node);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-brand-gold/60 bg-white px-1 font-mono text-[13px] outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={() => beginEdit(node)}
                    onClick={() => onLocate?.(node.path)}
                    title={node.expandable ? "容器（不可直接编辑）" : "双击编辑值 · 单击定位"}
                    className={`min-w-0 flex-1 cursor-text truncate font-mono ${KIND_COLOR[node.kind] ?? ""}`}
                  >
                    {node.text}
                  </span>
                )}

                <span className="shrink-0 text-[10px] text-paper-400">
                  {node.expandable ? `${node.childCount}` : node.kind}
                </span>
                <CopyBtn text={node.path} title="复制 JSON Pointer 路径" />
                <button
                  onClick={() => navigator.clipboard?.writeText(toDisplayString(node.value))}
                  title="复制值"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-paper-500 transition hover:bg-paper-100 hover:text-paper-900"
                >
                  <Copy size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-paper-500">
        双击叶子节点编辑值 · 单击定位到源码 · 右侧按钮复制路径 / 值
      </p>
    </div>
  );
}
