/**
 * 日志 JSON 提取面板：原文保持不变，多片段分组展示、逐个查看/复制。
 *
 * 对齐 JsonStudio v1.2.0/v1.3.0：独立面板、默认折叠预览、片段高亮、
 * 不替换编辑器原文。
 */
import { useState } from "react";
import { FileSearch } from "lucide-react";
import type { ExtractFragment } from "../types.ts";
import CopyBtn from "../../CopyBtn.tsx";

export interface ExtractPanelProps {
  fragments: ExtractFragment[];
  onApply?: (text: string) => void;
}

export default function ExtractPanel({ fragments, onApply }: ExtractPanelProps) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (!fragments.length) return null;

  const toggle = (i: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <div className="glass rounded-2xl p-3 shadow-card">
      <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
        <FileSearch size={13} className="text-[#0d9488]" />
        日志提取
        <span className="rounded-full bg-brand-gold/15 px-1.5 py-px text-[11px] font-semibold text-brand-gold">{fragments.length} 个片段</span>
        <span className="ml-auto text-[11px] text-paper-500">原编辑器内容保持不变</span>
      </div>
      <div className="space-y-1.5">
        {fragments.map((f, i) => (
          <div key={i} className="rounded-xl border border-paper-200 bg-white/50">
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-paper-400">{i + 1}</span>
              <button
                onClick={() => toggle(i)}
                className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-paper-700"
                title="展开格式化结果"
              >
                {f.raw.slice(0, 100)}{f.raw.length > 100 ? "…" : ""}
              </button>
              <span className="shrink-0 rounded bg-paper-100 px-1.5 py-0.5 text-[10px] text-paper-600">{f.kind}</span>
              <CopyBtn text={f.pretty} title="复制格式化结果" />
            </div>
            {open.has(i) && (
              <div className="relative border-t border-paper-200">
                <pre className="max-h-56 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-paper-800">{f.pretty}</pre>
                {onApply && (
                  <button
                    onClick={() => onApply(f.pretty)}
                    className="absolute bottom-2 right-2 rounded-lg border border-paper-200 bg-white/90 px-2 py-1 text-[11px] font-medium text-paper-700 shadow-sm transition hover:bg-paper-100"
                  >
                    用此片段替换编辑器
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
