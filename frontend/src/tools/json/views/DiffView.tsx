/**
 * 并排 Diff 视图：结构化差异（按 key 对齐）+ 文本行差异（同步滚动）。
 *
 * 对齐 JsonStudio：绿=新增 / 红=删除 / 黄=修改、状态栏统计、两侧可编辑。
 * 结构化 diff 是默认视图（避免仅格式化不同就满屏飘红），文本 diff 可切换。
 */
import { useMemo, useState } from "react";
import { GitCompare, ArrowLeftRight } from "lucide-react";
import { diffValues, summarize, diffText } from "../diff.ts";
import { parseLossless } from "../lossless.ts";
import JsonEditor from "./JsonEditor.tsx";

const COLOR: Record<string, string> = {
  added: "bg-emerald-50 text-emerald-800 border-l-2 border-emerald-500",
  removed: "bg-rose-50 text-rose-800 border-l-2 border-rose-500",
  changed: "bg-amber-50 text-amber-900 border-l-2 border-amber-500",
  same: "text-paper-700",
};

export interface DiffViewProps {
  left: string;
  right: string;
  onLeft?: (s: string) => void;
  onRight?: (s: string) => void;
}

export default function DiffView({ left, right, onLeft, onRight }: DiffViewProps) {
  const [mode, setMode] = useState<"struct" | "text">("struct");

  const struct = useMemo(() => {
    let l: unknown; let r: unknown;
    try { l = parseLossless(left || "null"); } catch { return { ok: false as const, side: "左" as const }; }
    // 右侧为空 = 尚未粘贴对比内容，按 null 处理而不是报解析失败
    try { r = parseLossless(right.trim() ? right : "null"); } catch { return { ok: false as const, side: "右" as const }; }
    const nodes = diffValues(l, r);
    return { ok: true as const, nodes, summary: summarize(nodes), rightEmpty: !right.trim() };
  }, [left, right]);

  const text = useMemo(() => diffText(left, right), [left, right]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare size={14} className="text-[#0d9488]" />
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-xs font-medium">
          <button onClick={() => setMode("struct")} className={`rounded-lg px-2.5 py-1 ${mode === "struct" ? "bg-white text-paper-900 shadow-sm" : "text-paper-600"}`}>结构化</button>
          <button onClick={() => setMode("text")} className={`rounded-lg px-2.5 py-1 ${mode === "text" ? "bg-white text-paper-900 shadow-sm" : "text-paper-600"}`}>文本行</button>
        </div>
        {struct.ok && (
          <div className="flex items-center gap-2 text-[11px] tabular-nums">
            <span className="rounded-full bg-emerald-600/15 px-1.5 py-px font-semibold text-emerald-700">+{struct.summary.added}</span>
            <span className="rounded-full bg-rose-600/15 px-1.5 py-px font-semibold text-rose-700">−{struct.summary.removed}</span>
            <span className="rounded-full bg-amber-500/15 px-1.5 py-px font-semibold text-amber-700">~{struct.summary.changed}</span>
            <span className="text-paper-500">相同 {struct.summary.same}</span>
          </div>
        )}
        <ArrowLeftRight size={12} className="ml-auto text-paper-400" />
        <span className="text-[11px] text-paper-500">{struct.ok && struct.rightEmpty ? "右侧粘贴要对比的 JSON" : "两侧可直接编辑，实时刷新"}</span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <div className="min-h-0">
          <div className="mb-1 text-[11px] text-paper-500">左侧（原始）</div>
          <JsonEditor value={left} onChange={onLeft} height="100%" />
        </div>
        <div className="min-h-0">
          <div className="mb-1 text-[11px] text-paper-500">右侧（对比）</div>
          <JsonEditor value={right} onChange={onRight} height="100%" />
        </div>
      </div>

      <div className="glass max-h-56 overflow-auto rounded-2xl p-2 shadow-card">
        {!struct.ok && mode === "struct" ? (
          <p className="p-2 text-xs text-rose-700">{struct.side}侧 JSON 解析失败，修正后显示差异。</p>
        ) : mode === "struct" && struct.ok ? (
          <div className="space-y-0.5">
            {flattenNodes(struct.nodes).map((n, i) => (
              <div key={i} className={`flex items-center gap-2 rounded px-2 py-0.5 font-mono text-[12px] ${COLOR[n.kind]}`}>
                <span className="w-[42%] shrink-0 truncate text-paper-500" style={{ paddingLeft: n.depth * 12 }}>{n.path}</span>
                <span className="w-[26%] shrink-0 truncate">{n.leftText ?? "—"}</span>
                <span className="w-[26%] shrink-0 truncate">{n.rightText ?? "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 font-mono text-[12px]">
            <div>{text.left.map((l, i) => <div key={i} className={`truncate px-1 ${COLOR[l.kind]}`}>{l.leftNo ?? " "} {l.text}</div>)}</div>
            <div>{text.right.map((l, i) => <div key={i} className={`truncate px-1 ${COLOR[l.kind]}`}>{l.rightNo ?? " "} {l.text}</div>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 拍平 DiffNode（容器行也展示，带缩进） */
function flattenNodes(nodes: import("../diff.ts").DiffNode[], depth = 0): (import("../diff.ts").DiffNode & { depth: number })[] {
  const out: (import("../diff.ts").DiffNode & { depth: number })[] = [];
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children) out.push(...flattenNodes(n.children, depth + 1));
  }
  return out;
}
