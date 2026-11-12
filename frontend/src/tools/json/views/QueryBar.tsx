/**
 * 查询栏：JMESPath / JSONPath / JSON Pointer 三模式切换 + 实时结果。
 *
 * 对齐 JsonStudio：模式切换器、命中高亮（由父组件把 paths 转成 hits）、
 * 内置帮助示例。异步竞态由父组件的 doc.version 保证，这里只做同步查询。
 */
import { useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, HelpCircle } from "lucide-react";
import { runQuery, QUERY_HINTS, type QueryMode } from "../query.ts";
import { stringifyLossless } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";

export interface QueryBarProps {
  value: unknown;
  /** 命中路径集合（JSON Pointer 形态），供 TreeView 高亮 */
  onHits?: (hits: Set<string>) => void;
}

export default function QueryBar({ value, onHits }: QueryBarProps) {
  const [mode, setMode] = useState<QueryMode>("jsonpath");
  const [expr, setExpr] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const result = useMemo(() => runQuery(value, expr, mode), [value, expr, mode]);

  // 把命中路径回传给父组件（Tree 高亮）；用 path 转 pointer 近似。
  // ⚠️ 必须放 useEffect：渲染期直接调父组件 setState 会触发 React 警告，
  //    且 onHits 若是内联函数会导致无限重渲染。
  useEffect(() => {
    if (!onHits) return;
    const hits = new Set<string>();
    for (const p of result.paths) {
      if (p.startsWith("/")) hits.add(p);
      else {
        // JSONPath 形如 "$['users'][0]['name']" → /users/0/name
        const m = p.match(/\[(?:'|")?([^\]'"]+)(?:'|")?\]/g) ?? [];
        if (m.length) hits.add("/" + m.map((x) => x.replace(/^\['?|'?\]$/g, "").replace(/~/g, "~0").replace(/\//g, "~1")).join("/"));
      }
    }
    onHits(hits);
  }, [result, onHits]);

  const hint = QUERY_HINTS[mode];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-xs font-medium">
          {(["jsonpath", "jmespath", "pointer"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setExpr(""); }}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition ${
                mode === m ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
              }`}
            >
              {m === mode && <ChevronDown size={11} />}
              {QUERY_HINTS[m].label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px] flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-400" />
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder={hint.placeholder}
            spellCheck={false}
            className="w-full rounded-xl border border-paper-200 bg-white/60 py-1.5 pl-8 pr-3 font-mono text-xs text-paper-900 outline-none transition placeholder:text-paper-500 focus:border-brand-gold/50"
          />
        </div>

        <button
          onClick={() => setShowHelp((v) => !v)}
          title="查询语法示例"
          className="grid h-8 w-8 place-items-center rounded-xl border border-paper-200 bg-white/50 text-paper-600 transition hover:bg-paper-100"
        >
          <HelpCircle size={14} />
        </button>
        {result.values.length > 0 && <CopyBtn text={result.values.map((v) => stringifyLossless(v)).join("\n")} title="复制查询结果" />}
      </div>

      {showHelp && (
        <div className="rounded-xl border border-paper-200 bg-paper-50 p-3 text-xs">
          <div className="mb-1.5 font-medium text-paper-800">{hint.label} 示例（点击填入）</div>
          <div className="flex flex-wrap gap-1.5">
            {hint.examples.map((x) => (
              <button
                key={x}
                onClick={() => setExpr(x)}
                className="rounded-lg border border-paper-200 bg-white px-2 py-1 font-mono text-[11px] text-paper-700 transition hover:border-brand-gold/50"
              >
                {x}
              </button>
            ))}
          </div>
        </div>
      )}

      {expr.trim() && (
        <div className="rounded-xl border border-paper-200 bg-white/60 p-2">
          {!result.ok ? (
            <p className="text-xs text-rose-700">{result.error ?? "无匹配结果"}</p>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2 text-[11px] text-paper-500">
                <span className="rounded-full bg-emerald-600/15 px-1.5 py-px font-semibold text-emerald-700">{result.values.length} 项</span>
                <span>{result.ms} ms</span>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-paper-800">
                {result.values.map((v) => stringifyLossless(v, 2)).join("\n")}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
