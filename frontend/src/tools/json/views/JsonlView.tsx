/**
 * JSONL / NDJSON 查看器：逐行独立记录、有效/错误统计、字段筛选、分页、展开预览。
 *
 * 对齐 JsonStudio v1.5.0：保持每行一条记录、不自动格式化整个文件、复制原始记录。
 */
import { useMemo, useState } from "react";
import { ListTree, ChevronLeft, ChevronRight } from "lucide-react";
import type { JsonlLine } from "../types.ts";
import { stringifyLossless } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";

const PAGE = 20;

export interface JsonlViewProps {
  lines: JsonlLine[];
  sourceText: string;
}

export default function JsonlView({ lines }: JsonlViewProps) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    if (!filter.trim()) return lines;
    const f = filter.toLowerCase();
    return lines.filter((l) => l.raw.toLowerCase().includes(f));
  }, [lines, filter]);

  const okCount = lines.filter((l) => l.ok).length;
  const errCount = lines.length - okCount;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const rows = filtered.slice(cur * PAGE, (cur + 1) * PAGE);

  const toggle = (n: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(n)) next.delete(n); else next.add(n);
    return next;
  });

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ListTree size={14} className="text-[#0d9488]" />
        <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
          <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 font-semibold text-emerald-700">{okCount} 有效</span>
          <span className="rounded-full bg-rose-600/15 px-2 py-0.5 font-semibold text-rose-700">{errCount} 错误</span>
          <span className="text-paper-500">共 {lines.length} 行</span>
        </div>
        <input
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          placeholder="全文 / 字段筛选…"
          className="ml-auto w-48 rounded-lg border border-paper-200 bg-white/60 px-2.5 py-1 text-xs outline-none focus:border-brand-gold/50"
        />
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={cur === 0} className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 disabled:opacity-40"><ChevronLeft size={13} /></button>
          <span className="text-[11px] tabular-nums text-paper-600">{cur + 1}/{pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={cur >= pages - 1} className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 disabled:opacity-40"><ChevronRight size={13} /></button>
        </div>
      </div>

      <div className="glass min-h-0 flex-1 overflow-auto rounded-2xl p-2 shadow-card">
        {rows.length === 0 && <p className="p-4 text-center text-xs text-paper-500">没有匹配的记录。</p>}
        {rows.map((l) => (
          <div key={l.line} className={`mb-1 rounded-xl border ${l.ok ? "border-paper-200 bg-white/50" : "border-rose-600/25 bg-rose-50"}`}>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-paper-400">{l.line}</span>
              <button
                onClick={() => l.ok && toggle(l.line)}
                className={`min-w-0 flex-1 truncate text-left font-mono text-[12px] ${l.ok ? "text-paper-800" : "text-rose-700"}`}
                title={l.ok ? "点击展开 JSON 预览" : l.error}
              >
                {l.ok ? l.raw : `✗ ${l.error}`}
              </button>
              {l.ok && <CopyBtn text={l.raw} title="复制原始记录" />}
            </div>
            {l.ok && open.has(l.line) && (
              <pre className="max-h-52 overflow-auto border-t border-paper-200 bg-paper-50/70 p-2 font-mono text-[11px] leading-relaxed text-paper-800">
                {stringifyLossless(l.value, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-paper-500">每行一条独立记录 · 点击行展开格式化预览 · 源码视图保持逐行不合并</p>
    </div>
  );
}
