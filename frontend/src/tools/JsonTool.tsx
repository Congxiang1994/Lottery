import { useEffect, useMemo, useState } from "react";
import { Braces, FileJson, Trash2 } from "lucide-react";
import CopyBtn from "./CopyBtn";

const field =
  "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";
const STORAGE_KEY = "tools_json";

const SAMPLE = `{
  "name": "lottery",
  "version": 2,
  "tools": ["timestamp", "json", "markdown"],
  "enabled": true,
  "config": { "theme": "auto", "nested": { "a": 1, "b": [1, 2, 3] } }
}`;

type AnalyzeResult =
  | { ok: true; value: unknown }
  | { ok: false; line: number; col: number; message: string };

/** 递归按 key 排序（仅对象，数组顺序保持） */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** 把 JSON.parse 的原生报错翻译成中文，并定位行列 */
function analyze(text: string): AnalyzeResult {
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    const value = JSON.parse(text);
    return { ok: true, value };
  } catch (e) {
    const raw = (e as Error).message || "JSON 解析失败";
    let pos = -1;
    const pm = raw.match(/position (\d+)/i);
    if (pm) pos = parseInt(pm[1], 10);

    let line = 0;
    let col = 0;
    const lm = raw.match(/line (\d+)[ ,]+column (\d+)/i);
    if (lm) {
      line = parseInt(lm[1], 10);
      col = parseInt(lm[2], 10);
    } else if (pos >= 0) {
      const safePos = pos > text.length ? text.length : pos;
      const before = text.slice(0, safePos);
      line = before.split("\n").length;
      col = safePos - before.lastIndexOf("\n");
    }

    const lc = line > 0 ? `（第 ${line} 行第 ${col} 列附近）` : "";
    let message: string;
    if (/end of (JSON )?input|end of data/i.test(raw)) {
      message = `JSON 未完整结束${lc}：可能缺少收尾的 }、]，或字符串 / 数字没写完。`;
    } else if (/Unexpected token (\S+)/i.test(raw)) {
      const t = (raw.match(/Unexpected token (\S+)/i) as RegExpMatchArray)[1];
      const show = t === "o" || t === "u" || t === "e" || t === "n" ? "关键词" : t;
      message = `遇到意外符号 ${show} ${lc}：检查是否用了单引号、写了注释，或多/少了逗号、括号不匹配。`;
    } else if (/Expected property name|Expecting '.*'|expected/i.test(raw)) {
      message = `此处语法不正确${lc}：通常是键名漏了双引号，或对象里多了逗号、少了冒号。`;
    } else if (/Unexpected (non-whitespace )?character/i.test(raw)) {
      message = `出现非法字符${lc}：确认没有注释、单引号或尾随逗号（标准 JSON 不支持这些）。`;
    } else {
      message = `JSON 语法错误${lc}：${raw}`;
    }
    return { ok: false, line, col, message };
  }
}

export default function JsonTool() {
  const [text, setText] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [indent, setIndent] = useState<2 | 4>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [view, setView] = useState<"pretty" | "min">("pretty");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text);
  }, [text]);

  const result = useMemo(() => analyze(text), [text]);

  const output = useMemo(() => {
    if (!result.ok || result.value === undefined) return "";
    const v = sortKeys ? sortDeep(result.value) : result.value;
    return view === "pretty" ? JSON.stringify(v, null, indent) : JSON.stringify(v);
  }, [result, sortKeys, indent, view]);

  const lines = text.split("\n");
  const errLine = result.ok ? -1 : result.line;
  const errLineText = errLine > 0 ? lines[errLine - 1] ?? "" : "";
  const errCol = result.ok ? 0 : result.col;

  return (
    <div className="space-y-4">
      {/* 选项栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          {(["pretty", "min"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 transition ${
                view === v ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
              }`}
            >
              {v === "pretty" ? "格式化" : "压缩"}
            </button>
          ))}
        </div>

        {view === "pretty" && (
          <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
            {([2, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => setIndent(n)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  indent === n ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
                }`}
              >
                {n} 空格
              </button>
            ))}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-paper-700">
          <input
            type="checkbox"
            checked={sortKeys}
            onChange={(e) => setSortKeys(e.target.checked)}
            className="h-4 w-4 accent-[#0d9488]"
          />
          键名排序
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setText(SAMPLE)}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <FileJson size={13} /> 示例
          </button>
          <button
            onClick={() => setText("")}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <Trash2 size={13} /> 清空
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 输入 */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
            <Braces size={13} className="text-[#0d9488]" /> 输入 JSON
            <span className="ml-auto tabular-nums">{text.length} 字符</span>
          </div>
          <textarea
            className={`${field} h-[420px] resize-y font-mono leading-relaxed`}
            value={text}
            spellCheck={false}
            placeholder='{"hello": "world"}'
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {/* 输出 / 报错 */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
            {result.ok ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 格式有效
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-700">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> 解析失败
              </span>
            )}
            <span className="ml-auto">结果</span>
          </div>

          {result.ok ? (
            <div className="relative">
              <textarea
                readOnly
                value={output}
                className={`${field} h-[420px] resize-y bg-paper-50/60 font-mono leading-relaxed`}
              />
              <div className="absolute right-2 top-2">
                <CopyBtn text={output} />
              </div>
            </div>
          ) : (
            <div className="glass h-[420px] overflow-auto rounded-2xl p-4 shadow-card">
              <div className="rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {result.message}
              </div>

              {errLine > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] text-paper-500">出错位置（第 {errLine} 行）：</div>
                  <pre className="overflow-x-auto rounded-xl border border-paper-200 bg-white/60 p-3 font-mono text-[13px] leading-relaxed text-paper-900">
                    <div className="text-paper-400 select-none">{String(errLine).padStart(3, " ")} │ </div>
                    <div className="text-paper-900">{errLineText || "（空行 / 文件结尾）"}</div>
                    {errLineText && (
                      <div className="text-rose-600 select-none">
                        {" ".repeat(Math.max(0, errCol - 1) + String(errLine).length + 3)}↑ 这里
                      </div>
                    )}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
