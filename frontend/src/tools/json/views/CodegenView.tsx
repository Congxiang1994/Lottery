/**
 * 代码生成视图：JSON → TS/Go/Python/Java/Rust，含反向提取（尽力而为）。
 *
 * 对齐 JsonStudio：语言选择、生成结果语法高亮区（这里用等宽只读区 +
 * 一键复制）、可在结果里直接编辑后再复制、反向转换明确标注限制。
 */
import { useMemo, useState } from "react";
import { Code2, ArrowLeftRight } from "lucide-react";
import { generateCode, extractFromCode, CODE_LANGS, type CodeLang } from "../codegen.ts";
import { stringifyLossless } from "../lossless.ts";
import CopyBtn from "../../CopyBtn.tsx";

export interface CodegenViewProps {
  value: unknown;
  onApplyJson?: (text: string) => void;
}

export default function CodegenView({ value, onApplyJson }: CodegenViewProps) {
  const [lang, setLang] = useState<CodeLang>("ts");
  const [edited, setEdited] = useState<string | null>(null);
  const [reverse, setReverse] = useState(false);
  const [reverseCode, setReverseCode] = useState("");
  const [reverseLang, setReverseLang] = useState<CodeLang>("ts");

  const result = useMemo(() => generateCode(value, lang), [value, lang]);
  const code = edited ?? result.code;

  const back = useMemo(
    () => reverse ? extractFromCode(reverseCode, reverseLang) : null,
    [reverse, reverseCode, reverseLang],
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Code2 size={14} className="text-[#0d9488]" />
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-xs font-medium">
          {CODE_LANGS.map((l) => (
            <button
              key={l.key}
              onClick={() => { setLang(l.key); setEdited(null); }}
              className={`rounded-lg px-2.5 py-1 transition ${lang === l.key ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setReverse((v) => !v)}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
            reverse ? "border-brand-gold/50 bg-brand-gold/10 text-brand-gold" : "border-paper-200 bg-white/60 text-paper-700 hover:bg-paper-100"
          }`}
        >
          <ArrowLeftRight size={13} /> 反向提取
        </button>
        {result.ok && <CopyBtn text={code} title="复制生成的代码" />}
      </div>

      {result.error && (
        <div className="rounded-xl border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {result.error}
        </div>
      )}

      {!reverse ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-paper-500">
            <span>生成结果（可直接编辑后复制）</span>
            {edited !== null && (
              <button onClick={() => setEdited(null)} className="text-brand-gold hover:underline">还原生成值</button>
            )}
            <span className="ml-auto tabular-nums">{code.length} 字符</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => setEdited(e.target.value)}
            spellCheck={false}
            readOnly={!result.ok}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-white/60 p-3 font-mono text-[12px] leading-relaxed text-paper-900 outline-none focus:border-brand-gold/50"
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-paper-500">
              <span>粘贴代码</span>
              <select
                value={reverseLang}
                onChange={(e) => setReverseLang(e.target.value as CodeLang)}
                className="rounded-lg border border-paper-200 bg-white/60 px-1.5 py-0.5 text-[11px] outline-none"
              >
                {CODE_LANGS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </div>
            <textarea
              value={reverseCode}
              onChange={(e) => setReverseCode(e.target.value)}
              spellCheck={false}
              placeholder="粘贴 interface / struct 定义…"
              className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-white/60 p-3 font-mono text-[12px] text-paper-900 outline-none focus:border-brand-gold/50"
            />
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 text-[11px] text-paper-500">提取的 JSON</div>
            <textarea
              readOnly
              value={back?.ok ? stringifyLossless(back.value, 2) : ""}
              className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-paper-50/60 p-3 font-mono text-[12px] text-paper-900"
            />
            {back && (
              <p className="mt-1 text-[11px] text-amber-700">{back.warning}</p>
            )}
            {back?.ok && onApplyJson && (
              <button
                onClick={() => onApplyJson(stringifyLossless(back.value, 2))}
                className="mt-2 self-start rounded-xl border border-paper-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-paper-700 transition hover:bg-paper-100"
              >
                用提取结果替换编辑器内容
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
