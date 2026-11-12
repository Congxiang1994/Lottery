/**
 * 格式转换视图：JSON ↔ YAML / XML / TOML / CSV / Properties / INI / Markdown 表。
 *
 * 对齐 JsonStudio：双向、格式选择清晰、转换期校验、有损明确标注、CSV 彩虹列。
 * 有损警告直接来自内核 ConvertResult.warnings，不在这里另写一套判断。
 */
import { useMemo, useState } from "react";
import { ArrowLeftRight, AlertTriangle } from "lucide-react";
import { fromJson, toJson, CONVERT_FORMATS, type ConvertFormat } from "../convert.ts";
import CopyBtn from "../../CopyBtn.tsx";

export interface ConvertViewProps {
  value: unknown;
  onChangeJson?: (text: string) => void;
}

export default function ConvertView({ value, onChangeJson }: ConvertViewProps) {
  const [format, setFormat] = useState<ConvertFormat>("yaml");
  const [dir, setDir] = useState<"from" | "to">("from");
  const [srcText, setSrcText] = useState("");

  const result = useMemo(() => {
    if (dir === "from") return fromJson(value, format);
    return toJson(srcText, format);
  }, [dir, value, format, srcText]);

  const warnings = result.warnings;
  const lossy = CONVERT_FORMATS.find((f) => f.key === format)?.lossy;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-xs font-medium">
          {CONVERT_FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFormat(f.key); setSrcText(""); }}
              className={`rounded-lg px-2.5 py-1 transition ${format === f.key ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setDir((d) => d === "from" ? "to" : "from"); setSrcText(""); }}
          className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-paper-700 transition hover:bg-paper-100"
          title="切换转换方向"
        >
          <ArrowLeftRight size={13} /> {dir === "from" ? "JSON → 目标" : "目标 → JSON"}
        </button>
        {lossy && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700">
            <AlertTriangle size={11} /> 有损格式
          </span>
        )}
      </div>

      {(warnings.length > 0 || result.error) && (
        <div className={`rounded-xl border px-3 py-2 text-xs ${result.error ? "border-rose-600/25 bg-rose-50 text-rose-700" : "border-amber-500/25 bg-amber-50 text-amber-800"}`}>
          {result.error ?? warnings.join(" · ")}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {dir === "to" && (
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 text-[11px] text-paper-500">{CONVERT_FORMATS.find((f) => f.key === format)?.label} 输入</div>
            <textarea
              value={srcText}
              onChange={(e) => setSrcText(e.target.value)}
              spellCheck={false}
              placeholder={`在此粘贴 ${format.toUpperCase()} 内容…`}
              className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-white/60 p-3 font-mono text-[13px] leading-relaxed text-paper-900 outline-none focus:border-brand-gold/50"
            />
          </div>
        )}
        <div className="relative flex min-h-0 flex-col">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-paper-500">
            <span>{dir === "from" ? `${format.toUpperCase()} 结果` : "JSON 结果"}</span>
            <span className="ml-auto">{result.text.length} 字符</span>
            {result.ok && <CopyBtn text={result.text} title="复制结果" />}
          </div>
          <textarea
            readOnly
            value={result.text}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-2xl border border-paper-200 bg-paper-50/60 p-3 font-mono text-[13px] leading-relaxed text-paper-900"
          />
          {dir === "to" && result.ok && result.text && onChangeJson && (
            <button
              onClick={() => onChangeJson(result.text)}
              className="absolute bottom-3 right-3 rounded-xl border border-paper-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-paper-800 shadow-sm transition hover:bg-paper-100"
            >
              用结果替换编辑器内容
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
