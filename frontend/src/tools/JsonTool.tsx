/**
 * JSON 工作台主壳（对标 JsonStudio 重构，见 docs/json-studio-refactor-plan.md）。
 *
 * 架构：**文本是唯一真源** —— 编辑器 text → parseInput → ParsedDoc → 各视图派生；
 * 视图编辑回写 text，重算一次。不做「多份状态各自维护」那套。
 *
 * 保留原有能力（已验证、用户已习惯）：转义/反转义成对往返、示例、清空、撤销条、
 * 中文错误定位、localStorage 持久化。
 * 新增：多标签、CodeMirror 编辑器、Tree/Grid/查询联动、Diff、转换、Schema、
 * 代码生成、JSONL、日志提取、统计条、文件拖放、图片导出、应用内快捷键。
 *
 * ⚠️ 异步竞态（JsonStudio v1.2.0 教训）：所有异步动作（粘贴自动格式化、图片导出）
 * 带 version 校验，旧结果不得覆盖新输入。
 * ⚠️ localStorage 单文档 > 1 MB 降级不持久化（JsonStudio v1.0.0 上限）。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Braces, FileJson, Quote, Trash2, Undo2, UnfoldVertical, CopyCheck,
  FilePlus, X, Download, Upload, Image as ImageIcon, Keyboard,
  Code2, GitCompare, ShieldCheck, Table2, Network, ListTree, FileSearch, RefreshCw,
} from "lucide-react";
import CopyBtn from "./CopyBtn";
import { escapeJsonString, unescapeJsonString } from "./jsonEscape";
import { INPUT, BTN_SECONDARY } from "../common/ui";
import { parseInput, resultToText } from "./json/parse.ts";
import { formatJson, minifyJson, convertKeys, detectKeyCase, type Indent } from "./json/format.ts";
import { stringifyLossless, isUnsafeIntegerLiteral } from "./json/lossless.ts";
import type { InputKind, ParseResult } from "./json/types.ts";
// html-to-image 只在用户点「导出图片」时才加载，不进 /tools 主 chunk

/* 重视图按需加载：进入 JSON tab 只下内核 + 编辑器，切到对应模式才拉 chunk */
const JsonEditor = lazy(() => import("./json/views/JsonEditor.tsx"));
const TreeView = lazy(() => import("./json/views/TreeView.tsx"));
const GridView = lazy(() => import("./json/views/GridView.tsx"));
const QueryBar = lazy(() => import("./json/views/QueryBar.tsx"));
const DiffView = lazy(() => import("./json/views/DiffView.tsx"));
const ConvertView = lazy(() => import("./json/views/ConvertView.tsx"));
const SchemaView = lazy(() => import("./json/views/SchemaView.tsx"));
const CodegenView = lazy(() => import("./json/views/CodegenView.tsx"));
const JsonlView = lazy(() => import("./json/views/JsonlView.tsx"));
const ExtractPanel = lazy(() => import("./json/views/ExtractPanel.tsx"));

const field = INPUT;
const STORAGE_KEY = "tools_json_v2";
const MAX_PERSIST = 1024 * 1024;

const SAMPLE = `{
  "name": "lottery",
  "version": 2,
  "tools": ["timestamp", "json", "markdown"],
  "enabled": true,
  "config": { "theme": "auto", "nested": { "a": 1, "b": [1, 2, 3] } }
}`;

type Mode = "source" | "tree" | "grid" | "diff" | "convert" | "schema" | "codegen" | "jsonl";

const MODES: { key: Mode; label: string; icon: typeof Braces }[] = [
  { key: "source", label: "源码", icon: Braces },
  { key: "tree", label: "树视图", icon: Network },
  { key: "grid", label: "Grid", icon: Table2 },
  { key: "diff", label: "Diff", icon: GitCompare },
  { key: "convert", label: "转换", icon: RefreshCw },
  { key: "schema", label: "Schema", icon: ShieldCheck },
  { key: "codegen", label: "代码生成", icon: Code2 },
  { key: "jsonl", label: "JSONL", icon: ListTree },
];

interface Doc {
  id: string;
  title: string;
  text: string;
  dirty: boolean;
}

const KIND_LABEL: Record<InputKind, string> = {
  empty: "空", json: "标准 JSON", escaped: "转义 JSON", json5: "JSON5",
  jsonc: "JSONC", repaired: "已修复", jsonl: "JSONL", log: "日志混合文本", invalid: "无效",
};

function newDoc(text = "", n = 1): Doc {
  return { id: `d${Date.now()}${Math.random().toString(36).slice(2, 5)}`, title: `Untitled-${n}`, text, dirty: false };
}

function loadDocs(): Doc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [newDoc("", 1)];
    const parsed = JSON.parse(raw) as Doc[];
    if (Array.isArray(parsed) && parsed.length && parsed.every((d) => typeof d.text === "string")) return parsed;
  } catch { /* 损坏则用默认 */ }
  return [newDoc("", 1)];
}

export default function JsonTool() {
  // ⚠️ loadDocs() 只能调一次：它会给空文档生成随机 id。
  //    调两次会让 activeId 指向一个并不存在的 id，编辑器回写更新到「幽灵文档」，
  //    页面表现就是「输入了但状态栏/结果永不更新」。
  const [docs, setDocs] = useState<Doc[]>(loadDocs);
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Doc[]) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed[0].id;
    } catch { /* 落到下面 */ }
    return ""; // 由下面的兜底 effect 对齐到真实的第一份文档
  });
  const [mode, setMode] = useState<Mode>("source");
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [view, setView] = useState<"pretty" | "min">("pretty");
  const [undo, setUndo] = useState<{ text: string; label: string } | null>(null);
  const [hits, setHits] = useState<Set<string>>(new Set());
  const [diffRight, setDiffRight] = useState("");
  const [toast, setToast] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [persistSkipped, setPersistSkipped] = useState(false);
  const [locatePath, setLocatePath] = useState("");
  const versionRef = useRef(0);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doc = docs.find((d) => d.id === activeId) ?? docs[0];
  const text = doc.text;
  const seq = docs.length + 1;

  // 兜底：activeId 与 docs 不一致（存储损坏 / 初始化竞态）时对齐回真实文档
  useEffect(() => {
    if (!docs.some((d) => d.id === activeId) && docs.length) setActiveId(docs[0].id);
  }, [docs, activeId]);

  /* ------------------------- 持久化（1 MB 上限） ------------------------- */
  useEffect(() => {
    try {
      const raw = JSON.stringify(docs);
      if (raw.length > MAX_PERSIST) {
        setPersistSkipped(true);
        return;
      }
      setPersistSkipped(false);
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      setPersistSkipped(true);
    }
  }, [docs]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const result: ParseResult = useMemo(() => parseInput(text), [text]);

  const setText = useCallback((next: string, label?: string) => {
    versionRef.current += 1;
    setDocs((prev) => prev.map((d) => (d.id === activeId ? { ...d, text: next, dirty: true } : d)));
    if (label) setUndo({ text, label });
  }, [activeId, text]);

  const patchDoc = useCallback((id: string, next: string) => {
    versionRef.current += 1;
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, text: next, dirty: true } : d)));
  }, []);

  /* ------------------------- 输出文本 ------------------------- */
  const output = useMemo(() => {
    if (!result.ok || result.value === undefined) return "";
    if (result.kind === "log") return "";
    if (result.kind === "jsonl") return resultToText(result, indent === "tab" ? "\t" : indent);
    try {
      if (view === "min") return minifyJson(text);
      return formatJson(text, indent, sortKeys);
    } catch {
      return "";
    }
  }, [result, text, view, indent, sortKeys]);

  const displayText = useMemo(() => {
    if (mode !== "source" || !result.ok || result.kind === "log") return text;
    return output || text;
  }, [mode, result, text, output]);

  /* ------------------------- 转义 / 反转义 ------------------------- */
  const unescapeInfo = useMemo(() => unescapeJsonString(text), [text]);
  const restorable = unescapeInfo.changes + (unescapeInfo.strippedQuotes ? 1 : 0);

  const doEscape = () => {
    if (!text) return;
    setUndo({ text, label: "已转义为 JSON 字符串字面量" });
    setText(escapeJsonString(text));
  };
  const doUnescape = () => {
    if (restorable === 0) return;
    const label = unescapeInfo.changes > 0
      ? `已还原 ${unescapeInfo.changes} 处转义${unescapeInfo.strippedQuotes ? "，并去掉外层引号" : ""}`
      : "已去掉外层引号";
    setUndo({ text, label });
    setText(unescapeInfo.text);
  };

  /* ------------------------- 多标签 ------------------------- */
  const addDoc = () => {
    // JsonStudio：复用空的 Untitled tab，避免堆一堆空窗口
    const emptyDoc = docs.find((d) => !d.text.trim());
    if (emptyDoc) { setActiveId(emptyDoc.id); return; }
    const d = newDoc("", seq);
    setDocs((prev) => [...prev, d]);
    setActiveId(d.id);
  };
  const closeDoc = (id: string) => {
    if (docs.length === 1) {
      setDocs([newDoc("", 1)]);
      setActiveId(docs[0].id);
      return;
    }
    const idx = docs.findIndex((d) => d.id === id);
    const next = docs.filter((d) => d.id !== id);
    setDocs(next);
    if (id === activeId) setActiveId(next[Math.max(0, idx - 1)].id);
  };

  /* ------------------------- 文件工作流 ------------------------- */
  const readFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      const d: Doc = { id: `f${Date.now()}`, title: file.name, text: content, dirty: false };
      setDocs((prev) => {
        const emptyIdx = prev.findIndex((x) => !x.text.trim());
        if (emptyIdx >= 0) {
          const next = prev.slice();
          next[emptyIdx] = d;
          return next;
        }
        return [...prev, d];
      });
      setActiveId(d.id);
      setToast(`已打开 ${file.name}`);
    };
    reader.readAsText(file);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  };

  const download = (content: string, name: string) => {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${name}`);
  };

  /* ------------------------- 图片导出（html-to-image） ------------------------- */
  const exportImage = async () => {
    if (!exportRef.current) return;
    const v = versionRef.current;
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(exportRef.current, { backgroundColor: "#faf6f1", pixelRatio: 2 });
      if (v !== versionRef.current) return; // 竞态：导出期间内容已变，丢弃旧结果
      const a = document.createElement("a");
      a.href = dataUrl; a.download = `${doc.title}.png`; a.click();
      setToast("已导出图片");
    } catch {
      setToast("图片导出失败（跨域字体/资源限制）");
    }
  };

  /* ------------------------- 快捷键 ------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setText(formatJson(text, indent, sortKeys), "已格式化"); }
      else if (e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); setText(minifyJson(text), "已压缩"); }
      else if (e.key.toLowerCase() === "s") { e.preventDefault(); download(output || text, `${doc.title}.json`); }
      else if (e.key.toLowerCase() === "k") { e.preventDefault(); setShowKeys((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, indent, sortKeys, output, doc.title]);

  /* ------------------------- 粘贴自动格式化（竞态保护） ------------------------- */
  const onPaste = (e: React.ClipboardEvent) => {
    // 只用「自动识别并标记 kind」，不擅自改写用户粘贴的原文
    // （JsonStudio 会异步格式化，但那条路径容易和编辑竞态；这里选更保守的行为）
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (pasted.length > 2 && /^[{[]/.test(pasted.trim())) {
      const v = versionRef.current;
      queueMicrotask(() => {
        if (v === versionRef.current && parseInput(pasted).kind !== "json") {
          setToast(`已识别为 ${KIND_LABEL[parseInput(pasted).kind]}，可用工具栏格式化`);
        }
      });
    }
  };

  /* ------------------------- 视图回写 ------------------------- */
  const applyValue = useCallback((v: unknown) => {
    setText(stringifyLossless(v, indent === "tab" ? "\t" : indent), "已从视图编辑");
  }, [setText, indent]);

  const applyText = useCallback((t: string) => setText(t, "已替换编辑器内容"), [setText]);

  /* ------------------------- 渲染 ------------------------- */
  const err = result.errors[0];
  const errLines = text.split(/\r?\n/);
  const errLineText = err && err.line > 0 ? errLines[err.line - 1] ?? "" : "";

  return (
    <div className="space-y-3" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-brand-gold/10 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brand-gold bg-white/90 px-8 py-6 text-sm font-medium text-brand-gold">松开以打开 JSON 文件</div>
        </div>
      )}

      {/* 多标签栏 */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-paper-200 pb-1">
        {docs.map((d) => (
          <div key={d.id} className={`group flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-xs transition ${
            d.id === activeId ? "border border-b-0 border-paper-200 bg-white/70 font-medium text-paper-900" : "text-paper-600 hover:bg-paper-100"
          }`}>
            <button onClick={() => setActiveId(d.id)} className="max-w-[130px] truncate">
              {d.title}{d.dirty && <span className="ml-1 text-brand-gold">•</span>}
            </button>
            <button onClick={() => closeDoc(d.id)} className="opacity-40 transition hover:opacity-100" title="关闭标签"><X size={11} /></button>
          </div>
        ))}
        <button onClick={addDoc} title="新建标签" className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-paper-500 transition hover:bg-paper-100 hover:text-paper-900"><FilePlus size={13} /></button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button onClick={() => fileRef.current?.click()} title="打开文件（也可直接拖入）" className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100"><Upload size={13} /></button>
          <button onClick={() => download(output || text, `${doc.title}.json`)} title="导出 JSON 文件" className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100"><Download size={13} /></button>
          <button onClick={exportImage} title="导出为图片" className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100"><ImageIcon size={13} /></button>
          <button onClick={() => setShowKeys((v) => !v)} title="快捷键" className="grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100"><Keyboard size={13} /></button>
          <input ref={fileRef} type="file" accept=".json,.json5,.jsonc,.jsonl,.ndjson,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
        </div>
      </div>

      {showKeys && (
        <div className="rounded-xl border border-paper-200 bg-paper-50 p-3 text-xs text-paper-700">
          <div className="mb-1.5 font-medium">应用内快捷键</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <span><kbd className="rounded border border-paper-300 bg-white px-1">⌘⇧F</kbd> 格式化</span>
            <span><kbd className="rounded border border-paper-300 bg-white px-1">⌘⇧M</kbd> 压缩</span>
            <span><kbd className="rounded border border-paper-300 bg-white px-1">⌘S</kbd> 导出文件</span>
            <span><kbd className="rounded border border-paper-300 bg-white px-1">⌘K</kbd> 显隐本面板</span>
          </div>
          <p className="mt-1.5 text-[11px] text-paper-500">编辑器内另支持 CodeMirror 原生折叠 / 查找替换 / 多光标。</p>
        </div>
      )}

      {/* 选项栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          {(["pretty", "min"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1.5 transition ${view === v ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"}`}>
              {v === "pretty" ? "格式化" : "压缩"}
            </button>
          ))}
        </div>
        {view === "pretty" && (
          <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
            {([2, 4, "tab"] as const).map((n) => (
              <button key={n} onClick={() => setIndent(n)} className={`rounded-lg px-2.5 py-1.5 transition ${indent === n ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"}`}>
                {n === "tab" ? "Tab" : `${n} 空格`}
              </button>
            ))}
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-paper-700">
          <input type="checkbox" checked={sortKeys} onChange={(e) => setSortKeys(e.target.checked)} className="h-4 w-4 accent-[#0d9488]" />
          键名排序
        </label>
        <button
          onClick={() => {
            const target = detectKeyCase(text) === "snake" ? "camel" : "snake";
            try { setText(stringifyLossless(convertKeys(parseInput(text).value, target), indent === "tab" ? "\t" : indent), `已转为 ${target === "camel" ? "驼峰" : "下划线"}命名`); }
            catch { setToast("键名转换失败：请先修正 JSON"); }
          }}
          title="递归切换 snake_case ↔ camelCase"
          className="rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
        >
          键名风格
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={doEscape} disabled={!text} title="整段转义成带引号的 JSON 字符串字面量" className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40">
            <Quote size={13} /> 转义
          </button>
          <button onClick={doUnescape} disabled={restorable === 0} title="把 \n \t \uXXXX 等字面量还原成真实字符" className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40">
            <UnfoldVertical size={13} /> 反转义
            {restorable > 0 && <span className="rounded-full bg-brand-gold/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-brand-gold">{restorable}</span>}
          </button>
          <button onClick={() => setText(SAMPLE, "已载入示例")} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"><FileJson size={13} /> 示例</button>
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

      {/* 模式切换 */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium w-fit">
        {MODES.map((m) => (
          <button key={m.key} onClick={() => setMode(m.key)} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition ${
            mode === m.key ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
          }`}>
            <m.icon size={13} /> {m.label}
          </button>
        ))}
      </div>

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
        {persistSkipped && <span className="rounded-full bg-amber-500/15 px-1.5 py-px font-semibold text-amber-700">超过 1 MB · 本次不持久化</span>}
        {locatePath && <span className="ml-auto font-mono text-[10px] text-paper-500">定位 {locatePath}</span>}
      </div>

      {/* 错误卡 */}
      {!result.ok && err && (
        <div className="rounded-2xl border border-rose-600/25 bg-rose-50 p-3">
          <div className="text-sm text-rose-700">{err.message}</div>
          {errLineText && (
            <pre className="mt-2 overflow-x-auto rounded-xl border border-rose-600/20 bg-white/70 p-2 font-mono text-[12px] text-paper-900">
              <div className="text-paper-400">{String(err.line).padStart(3, " ")} │ </div>
              <div>{errLineText}</div>
              <div className="text-rose-600">{" ".repeat(Math.max(0, err.col - 1) + String(err.line).length + 3)}↑ 这里</div>
            </pre>
          )}
        </div>
      )}

      {/* 查询栏（源码 / 树 / Grid 三个模式共用） */}
      {(mode === "source" || mode === "tree" || mode === "grid") && result.ok && (
        <Suspense fallback={<div className="text-xs text-paper-500">加载查询组件…</div>}>
          <QueryBar value={result.value} onHits={setHits} />
        </Suspense>
      )}

      {/* 日志提取面板（原文不变） */}
      {result.kind === "log" && result.fragments && result.fragments.length > 0 && (
        <Suspense fallback={null}>
          <ExtractPanel fragments={result.fragments} onApply={applyText} />
        </Suspense>
      )}

      {/* 主工作区 */}
      <div ref={exportRef} className="min-h-[440px]">
        <Suspense fallback={<div className="glass grid h-[440px] place-items-center rounded-2xl text-xs text-paper-500">加载视图…</div>}>
          {mode === "source" && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="flex flex-col">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-paper-600">
                  <Braces size={12} className="text-[#0d9488]" /> 输入 JSON
                  <span className="ml-auto tabular-nums">{text.length} 字符</span>
                </div>
                <div onPaste={onPaste}>
                  <JsonEditor value={text} onChange={(v) => patchDoc(activeId, v)} height={440} status={result.ok ? undefined : "有语法错误，右侧为只读输出；修正后恢复"} />
                </div>
              </div>
              <div className="flex flex-col">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-paper-600">
                  <span className={result.ok ? "text-emerald-700" : "text-rose-700"}>{result.ok ? "格式化结果" : "解析结果"}</span>
                  <span className="ml-auto">结果</span>
                </div>
                {result.ok ? (
                  <div className="relative">
                    <JsonEditor value={displayText} readOnly height={440} />
                    <div className="absolute right-2 top-2"><CopyBtn text={displayText} title="复制结果" /></div>
                  </div>
                ) : (
                  <div className="glass grid h-[440px] place-items-center rounded-2xl text-xs text-paper-500 shadow-card">修正左侧语法后显示格式化结果</div>
                )}
              </div>
            </div>
          )}

          {mode === "tree" && (
            <div className="h-[440px]">
              {result.ok && result.value !== undefined
                ? <TreeView value={result.value} onChange={applyValue} hits={hits} onLocate={setLocatePath} />
                : <EmptyView text="暂无可显示的 JSON 结构" />}
            </div>
          )}
          {mode === "grid" && (
            <div className="h-[440px]">
              {result.ok && result.value !== undefined
                ? <GridView value={result.value} onChange={applyValue} />
                : <EmptyView text="暂无可显示的 JSON 结构" />}
            </div>
          )}
          {mode === "diff" && (
            <div className="h-[520px]">
              <DiffView
                left={output || text}
                right={diffRight}
                onLeft={applyText}
                onRight={setDiffRight}
              />
            </div>
          )}
          {mode === "convert" && (
            <div className="h-[480px]">
              {result.ok && result.value !== undefined
                ? <ConvertView value={result.value} onChangeJson={applyText} />
                : <EmptyView text="修正 JSON 后使用格式转换" />}
            </div>
          )}
          {mode === "schema" && (
            <div className="h-[480px]">
              {result.ok && result.value !== undefined
                ? <SchemaView value={result.value} sourceText={output || text} />
                : <EmptyView text="修正 JSON 后使用 Schema 工具" />}
            </div>
          )}
          {mode === "codegen" && (
            <div className="h-[480px]">
              {result.ok && result.value !== undefined
                ? <CodegenView value={result.value} onApplyJson={applyText} />
                : <EmptyView text="修正 JSON 后生成类型代码" />}
            </div>
          )}
          {mode === "jsonl" && (
            <div className="h-[480px]">
              {result.lines
                ? <JsonlView lines={result.lines} sourceText={text} />
                : <EmptyView text="当前不是 JSONL / NDJSON（需每行一条独立 JSON 记录）" hint="可直接粘贴多行 JSON，解析器会自动识别" />}
            </div>
          )}
        </Suspense>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-paper-900 px-4 py-2 text-xs text-white shadow-lg">
          <CopyCheck size={13} /> {toast}
        </div>
      )}
    </div>
  );
}

function EmptyView({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="glass grid h-full place-items-center rounded-2xl text-center shadow-card">
      <div>
        <p className="text-sm text-paper-700">{text}</p>
        {hint && <p className="mt-1 text-[11px] text-paper-500">{hint}</p>}
      </div>
    </div>
  );
}
