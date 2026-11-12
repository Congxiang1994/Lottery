/**
 * Grid 网格视图：对象数组 → 表格，单元格可直接编辑，回写保持类型。
 *
 * 对齐 JsonStudio：像操作表格一样查看/编辑数组数据、与源码同步、横向比较多条
 * 记录以发现缺失字段。嵌套值只读展示（JSON 串），避免二维表表达不了嵌套。
 * 根不是「对象数组」时给出明确提示（JsonStudio v1.4.0：CSV 混入非对象直接报错，
 * 这里同样不假装能显示）。
 */
import { useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { isContainer, parseEdited, kindOf } from "./treeModel.ts";
import { toDisplayString } from "../lossless.ts";

export interface GridViewProps {
  value: unknown;
  onChange?: (value: unknown) => void;
}

interface Cell { text: string; editable: boolean; raw: unknown }

export default function GridView({ value, onChange }: GridViewProps) {
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [draft, setDraft] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const model = useMemo(() => {
    if (!Array.isArray(value)) return { ok: false as const, reason: "根不是数组", cols: [] as string[], rows: [] as Cell[][] };
    const objects = value.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    if (objects.length !== value.length) return { ok: false as const, reason: `数组含 ${value.length - objects.length} 个非对象元素，Grid 只支持对象数组`, cols: [] as string[], rows: [] as Cell[][] };
    const cols = Array.from(new Set(objects.flatMap((o) => Object.keys(o))));
    const rows = objects.map((o) =>
      cols.map((c) => {
        const raw = o[c];
        return { text: isContainer(raw) ? JSON.stringify(raw) : toDisplayString(raw), editable: !isContainer(raw), raw };
      }),
    );
    return { ok: true as const, cols, rows, objects };
  }, [value]);

  const virtualizer = useVirtualizer({
    count: model.ok ? model.rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const beginEdit = (row: number, col: string, cell: Cell) => {
    if (!cell.editable || !onChange) return;
    setEditing({ row, col });
    setDraft(cell.text);
    window.setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = (row: number, col: string) => {
    setEditing(null);
    if (!onChange || !model.ok) return;
    const next = (value as Record<string, unknown>[]).slice();
    next[row] = { ...next[row], [col]: parseEdited(draft) };
    onChange(next);
  };

  if (!model.ok) {
    return (
      <div className="glass flex h-full flex-col items-center justify-center rounded-2xl p-6 text-center shadow-card">
        <Table2 size={22} className="mb-2 text-paper-400" />
        <p className="text-sm font-medium text-paper-800">Grid 视图不可用</p>
        <p className="mt-1 text-xs text-paper-600">{model.reason}</p>
        <p className="mt-3 text-[11px] text-paper-500">切到「树视图」可查看任意嵌套结构。</p>
      </div>
    );
  }

  const { cols, rows } = model;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
        <Table2 size={13} className="text-[#0d9488]" /> Grid 视图
        <span className="tabular-nums">{rows.length} 行 × {cols.length} 列</span>
        <span className="ml-auto text-paper-500">双击单元格编辑 · 嵌套值只读</span>
      </div>
      <div ref={parentRef} className="glass min-h-0 flex-1 overflow-auto rounded-2xl shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-paper-100/95 backdrop-blur">
            <tr>
              <th className="w-12 border-b border-r border-paper-200 px-2 py-2 text-right font-medium text-paper-500">#</th>
              {cols.map((c) => (
                <th key={c} className="min-w-[120px] border-b border-r border-paper-200 px-2 py-2 text-left font-mono font-medium text-[#0d9488]">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <tr
                key={vi.index}
                className="absolute left-0 flex w-full"
                style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                <td className="flex w-12 shrink-0 items-center justify-center border-b border-r border-paper-200 text-right text-[11px] tabular-nums text-paper-400">
                  {vi.index + 1}
                </td>
                {cols.map((c) => {
                  const cell = rows[vi.index][cols.indexOf(c)];
                  const isEditing = editing?.row === vi.index && editing.col === c;
                  return (
                    <td
                      key={c}
                      onDoubleClick={() => beginEdit(vi.index, c, cell)}
                      className={`min-w-[120px] flex-1 truncate border-b border-r border-paper-200 px-2 font-mono ${
                        cell.editable ? "cursor-text hover:bg-paper-100/70" : "text-paper-500"
                      } ${kindOf(cell.raw) === "number" ? "text-violet-700" : ""}`}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commit(vi.index, c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(vi.index, c);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-full rounded border border-brand-gold/60 bg-white px-1 font-mono outline-none"
                        />
                      ) : cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-center text-xs text-paper-500">空数组，没有可显示的行。</p>}
      </div>
    </div>
  );
}
