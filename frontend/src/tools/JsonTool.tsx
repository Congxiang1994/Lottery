/**
 * JSON 工具：极简双栏 —— 左 JSON 源码，右常驻可折叠节点树。
 *
 * 产品定位（用户 2026-11-12 明确）：一般就一个 JSON，不要多标签、不要模式切换、
 * 不要查询栏、不要上传下载/图片导出/快捷键、不要「键名风格」这类含义不明的按钮。
 * 右侧树只做一件事：把结构铺开、能折叠、能复制路径/值；源码是唯一真源。
 *
 * 保留：格式化/压缩、2/4/Tab 缩进、键名排序、转义/反转义成对往返、示例、清空、
 * 撤销条、中文错误定位、大整数无损、localStorage 持久化、统计条。
 *
 * ⚠️ 编辑器输入用 selfEditRef 标记跳过外部回写，避免旧一代结果覆盖新输入
 *    （详见 json/views/JsonEditor.tsx）。
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Braces, FileJson, Quote, Trash2, Undo2, UnfoldVertical, Network } from "lucide-react";
import CopyBtn from "./CopyBtn";
import { escapeJsonString, unescapeJsonString } from "./jsonEscape";
import { parseInput } from "./json/parse.ts";
import { formatJson, minifyJson, type Indent } from "./json/format.ts";
import type { InputKind, ParseResult } from "./json/types.ts";

const JsonEditor = lazy(() => import("./json/views/JsonEditor.tsx"));
const TreeView = lazy(() => import("./json/views/TreeView.tsx"));

const STORAGE_KEY = "tools_json_v2";

const SAMPLE = `{
  "name": "lottery",
  "version": 2,
  "tools": ["timestamp", "json", "markdown"],
  "enabled": true,
  "config": { "theme": "auto", "nested": { "a": 1, "b": [1, 2, 3] } }
}`;

const KIND_LABEL: Record<InputKind, string> = {
  empty: "空", json: "标准 JSON", escaped: "转义 JSON", json5: "JSON5",
  jsonc: "JSONC", repaired: "已修复", jsonl: "JSONL", invalid: "无效",
};

/** 读取持久化文本（兼容上一版的多文档数组格式，取第一份） */
function loadText(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "";
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const first = parsed[0] as { text?: unknown } | undefined;
      return typeof first?.text === "string" ? first.text : "";
    }
    if (typeof parsed === "string") return parsed;
  } catch {
    // 兼容更早期「直接存纯文本」的格式
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !raw.trimStart().startsWith("[") && !raw.trimStart().startsWith("{")) return raw;
    } catch { /* 忽略 */ }
  }
  return "";
}

export default function JsonTool() {
  const [text, setText] = useState<string>(loadText);
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [view, setView] = useState<"pretty" | "min">("pretty");
  const [undo, setUndo] = useState<{ text: string; label: string } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(text)); } catch { /* 超额忽略 */ }
  }, [text]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const result: ParseResult = useMemo(() => parseInput(text), [text]);

  const output = useMemo(() => {
    if (!result.ok || result.value === undefined) return "";
    try {
      return view === "min" ? minifyJson(text) : formatJson(text, indent, sortKeys);
    } catch {
      return "";
    }
  }, [result, text, view, indent, sortKeys]);

  const setWithUndo = (next: string, label: string) => {
    setUndo({ text, label });
    setText(next);
  };

  /* ------------------------- 转义 / 反转义 ------------------------- */
  const unescapeInfo = useMemo(() => unescapeJsonString(text), [text]);
  const restorable = unescapeInfo.changes + (unescapeInfo.strippedQuotes ? 1 : 0);

  const doEscape = () => { if (text) setWithUndo(escapeJsonString(text), "已转义为 JSON 字符串字面量"); };
  const doUnescape = () => {
    if (restorable === 0) return;
    const label = unescapeInfo.changes > 0
      ? `已还原 ${unescapeInfo.changes} 处转义${unescapeInfo.strippedQuotes ? "，并去掉外层引号" : ""}`
      : "已去掉外层引号";
    setWithUndo(unescapeInfo.text, label);
  };

  const err = result.errors[0];
  const errLines = text.split(/\r?\n/);
  const errLineText = err && err.line > 0 ? errLines[err.line - 1] ?? "" : "";

  return (
    <div className="space-y-3">
      {/* 选项栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          {(["pretty", "min"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 transition ${
              view === v ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}>
              {v === "pretty" ? "格式化" : "压缩"}
            </button>
          ))}
        </div>
        {view === "pretty" && (
          <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
            {([2, 4, "tab"] as const).map((n) => (
              <button key={n} onClick={() => setIndent(n)} className={`rounded-lg px-2.5 py-1.5 transition ${
                indent === n ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
              }`}>
                {n === "tab" ? "Tab" : `${n} 空格`}
              </button>
            ))}
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-paper-700">
          <input type="checkbox" checked={sortKeys} onChange={(e) => setSortKeys(e.target.checked)} className="h-4 w-4 accent-[#0d9488]" />
          键名排序
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={doEscape} disabled={!text} title="整段转义成带引号的 JSON 字符串字面量" className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40">
            <Quote size={13} /> 转义
          </button>
          <button onClick={doUnescape} disabled={restorable === 0} title="把 \n \t \uXXXX 等字面量还原成真实字符" className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40">
            <UnfoldVertical size={13} /> 反转义
            {restorable > 0 && <span className="rounded-full bg-brand-gold/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-brand-gold">{restorable}</span>}
          </button>
          <button onClick={() => setWithUndo(SAMPLE, "已载入示例")} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"><FileJson size={13} /> 示例</button>
          <button onClick={() => { setUndo(null); setText(""); }} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"><Trash2 size={13} /> 清空</button>
        </div>
      </div>

      {undo && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {undo.label}
          <button onClick={() => { setText(undo.text); setUndo(null); }} className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-medium transition hover:bg-emerald-100"><Undo2 size={12} /> 撤销</button>
          <button onClick={() => setUndo(null)} className="rounded-lg px-2 py-0.5 text-emerald-700/90 transition hover:bg-emerald-100">收起</button>
        </div>
      )}

      {/* 状态栏 */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-paper-600">
        <span className={`inline-flex items-center gap-1 ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${result.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
          {result.ok ? `${KIND_LABEL[result.kind]} · 有效` : "解析失败"}
        </span>
        <span className="tabular-nums">{result.stats.keys} 键</span>
        <span className="tabular-nums">深度 {result.stats.depth}</span>
        <span className="tabular-nums">{result.stats.nodes} 节点</span>
        <span className="tabular-nums">{(result.stats.bytes / 1024).toFixed(2)} KB</span>
        <span className="tabular-nums">{result.stats.lines} 行</span>
        {result.lossless && <span className="rounded-full bg-violet-600/15 px-1.5 py-px font-semibold text-violet-700">含超大整数 · 已无损保留</span>}
      </div>

      {/* 双栏：左源码+格式化结果 / 右节点树 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
              <Braces size={13} className="text-[#0d9488]" /> JSON 源码
              <span className="ml-auto tabular-nums">{text.length} 字符</span>
            </div>
            <Suspense fallback={<div className="grid h-[300px] place-items-center rounded-2xl border border-paper-200 bg-white/60 text-xs text-paper-500">加载编辑器…</div>}>
              <JsonEditor value={text} onChange={setText} height={300} />
            </Suspense>
          </div>
          {result.ok && result.value !== undefined && (
            <div className="relative">
              <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
                <span className="inline-flex items-center gap-1 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 格式有效</span>
                <span className="ml-auto">格式化结果</span>
              </div>
              <textarea
                readOnly
                value={output}
                className="h-[160px] w-full resize-y rounded-2xl border border-paper-200 bg-paper-50/60 p-3 font-mono text-[13px] leading-relaxed text-paper-900 outline-none"
              />
              <div className="absolute right-2 top-8"><CopyBtn text={output} title="复制结果" /></div>
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="mb-2 flex items-center gap-2 text-xs text-paper-600">
            <Network size={13} className="text-[#0d9488]" /> 节点树
            <span className="ml-auto">结构</span>
          </div>
          <div className="h-[440px]">
            {result.ok && result.value !== undefined ? (
              <Suspense fallback={<div className="glass grid h-full place-items-center rounded-2xl text-xs text-paper-500 shadow-card">加载节点树…</div>}>
                <TreeView value={result.value} />
              </Suspense>
            ) : (
              <div className="glass h-full overflow-auto rounded-2xl p-4 shadow-card">
                {err && <div className="rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err.message}</div>}
                {errLineText && (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] text-paper-500">出错位置（第 {err.line} 行）：</div>
                    <pre className="overflow-x-auto rounded-xl border border-paper-200 bg-white/60 p-3 font-mono text-[13px] leading-relaxed text-paper-900">
                      <div className="text-paper-400 select-none">{String(err.line).padStart(3, " ")} │ </div>
                      <div>{errLineText}</div>
                      <div className="text-rose-600 select-none">{" ".repeat(Math.max(0, err.col - 1) + String(err.line).length + 3)}↑ 这里</div>
                    </pre>
                  </div>
                )}
                {!err && <p className="text-sm text-paper-500">左侧输入 JSON 后，这里显示可折叠的节点树。</p>}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
