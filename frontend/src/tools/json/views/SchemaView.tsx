/**
 * JSON Schema 视图：分屏（左数据 / 右 Schema）+ 生成 + 校验 + 错误定位。
 *
 * 对齐 JsonStudio：一键从 JSON 生成、按 Schema 实时校验、详细错误报告（行号 +
 * 描述）、错误悬停。远程 $schema 不做（CORS，方案 §4 明确）。
 */
import { useMemo, useRef, useState } from "react";
import { ShieldCheck, Wand2 } from "lucide-react";
import { generateSchema, validateSchema, locateIssues } from "../schema.ts";
import { stringifyLossless } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";

const FALLBACK_SCHEMA = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["name"],
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "integer", "minimum": 0 }
  }
}`;

export interface SchemaViewProps {
  value: unknown;
  sourceText: string;
}

export default function SchemaView({ value, sourceText }: SchemaViewProps) {
  const [schemaText, setSchemaText] = useState(FALLBACK_SCHEMA);
  const schemaRef = useRef<HTMLTextAreaElement>(null);

  const validation = useMemo(() => {
    const r = validateSchema(value, schemaText);
    return { ...r, issues: locateIssues(r.issues, sourceText) };
  }, [value, schemaText, sourceText]);

  const doGenerate = () => {
    const s = generateSchema(value);
    setSchemaText(stringifyLossless(s, 2));
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={14} className="text-[#0d9488]" />
        <button
          onClick={doGenerate}
          className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-paper-700 transition hover:bg-paper-100"
        >
          <Wand2 size={13} /> 从 JSON 生成 Schema
        </button>
        <div className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          validation.error ? "bg-rose-600/15 text-rose-700"
            : validation.ok ? "bg-emerald-600/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"
        }`}>
          {validation.error ? "Schema 无效" : validation.ok ? "校验通过" : `${validation.issues.length} 处不符`}
        </div>
        <CopyBtn text={schemaText} title="复制 Schema" />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 text-[11px] text-paper-500">JSON 数据（只读）</div>
          <textarea
            readOnly
            value={sourceText}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-paper-50/60 p-3 font-mono text-[12px] leading-relaxed text-paper-900"
          />
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-1 text-[11px] text-paper-500">Schema（Draft 7，可编辑）</div>
          <textarea
            ref={schemaRef}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-white/60 p-3 font-mono text-[12px] leading-relaxed text-paper-900 outline-none focus:border-brand-gold/50"
          />
        </div>
      </div>

      <div className="glass max-h-44 overflow-auto rounded-2xl p-3 shadow-card">
        {validation.error ? (
          <p className="text-xs text-rose-700">{validation.error}</p>
        ) : validation.ok ? (
          <p className="text-xs text-emerald-700">数据符合当前 Schema。</p>
        ) : (
          <div className="space-y-1.5">
            {validation.issues.map((it, i) => (
              <button
                key={i}
                onClick={() => {
                  // 点击错误定位到数据里的 key（尽力而为）
                  if (it.line > 0 && schemaRef.current) schemaRef.current.focus();
                }}
                title={it.keywordLocation}
                className="block w-full rounded-lg border border-rose-600/20 bg-rose-50 px-2.5 py-1.5 text-left text-xs text-rose-800 transition hover:bg-rose-100"
              >
                <span className="font-mono text-[11px] text-rose-600">{it.instanceLocation || "/"}</span>
                {it.line > 0 && <span className="ml-2 text-[11px] text-rose-500">第 {it.line} 行第 {it.col} 列</span>}
                <span className="ml-2">{it.message}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
