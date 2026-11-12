/**
 * JSON 工具：**两个对齐的框** —— 左 JSON 源码，右可折叠节点树。
 *
 * 产品定位（用户 2026-11-12 明确两轮反馈）：
 *  - 一般就一个 JSON：不要多标签、不要模式切换、不要上传下载/图片导出/快捷键；
 *  - 「格式化」**直接改源码本身**，不再单开结果框；
 *  - 左框底部一行字说明「格式是否有效 / 无效错在第几行」；
 *  - 布局只有两个框，左右高度严格对齐（头部 h-7 + 主体自适应 + 底部 h-6）。
 *
 * 保留：格式化/压缩（就地生效）、2/4/Tab 缩进、格式风格（标准/高效）、
 * 转义/反转义成对往返、示例、清空、撤销条、中文错误定位、大整数无损、
 * localStorage 持久化、统计条。
 *
 * 字段顺序改为**右侧节点树里拖拽调序**（仅同级），不再提供按字母的「键名排序」——
 * 字符序对业务字段没有意义，人工拖出自己想要的顺序更直观。
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { FileJson, Quote, Trash2, Undo2, UnfoldVertical } from "lucide-react";
import { escapeJsonString, unescapeJsonString } from "./jsonEscape";
import { parseInput } from "./json/parse.ts";
import { formatJson, minifyJson, prettyJson, styleToInline, type Indent, type FmtStyle } from "./json/format.ts";
import type { InputKind, ParseResult } from "./json/types.ts";
import type { EditorStatus } from "./json/views/JsonEditor.tsx";
import { moveSibling } from "./json/views/treeModel.ts";
import Tip from "./Tip";

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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && !raw.trimStart().startsWith("[") && !raw.trimStart().startsWith("{")) return raw;
    } catch { /* 忽略 */ }
  }
  return "";
}

/** 格式化风格的展示文案与说明（类型 FmtStyle 定义在 json/format.ts，此处只做 UI 映射） */
const FMT_STYLE_LABEL: Record<FmtStyle, string> = { standard: "标准", compact: "高效" };

const FMT_STYLES: { key: FmtStyle; label: string; hint: string }[] = [
  { key: "standard", label: "标准", hint: "传统展开：每个元素一行，与 JSON.stringify 一致" },
  { key: "compact", label: "高效", hint: "纯字符串/数字数组压成一行（如 [\"a\",\"b\"]、[1,2,3]），更好读" },
];

const STYLE_KEY = "tools_json_fmt_style";

function loadStyle(): FmtStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === "compact" ? "compact" : "standard";
  } catch {
    return "standard";
  }
}

export default function JsonTool() {
  const [text, setText] = useState<string>(loadText);
  const [indent, setIndent] = useState<Indent>(2);
  const [view, setView] = useState<"pretty" | "min">("pretty");
  const [fmtStyle, setFmtStyle] = useState<FmtStyle>(loadStyle);

  useEffect(() => {
    try { localStorage.setItem(STYLE_KEY, fmtStyle); } catch { /* 忽略 */ }
  }, [fmtStyle]);
  const [undo, setUndo] = useState<{ text: string; label: string } | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(text)); } catch { /* 超额忽略 */ }
  }, [text]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const result: ParseResult = useMemo(() => parseInput(text), [text]);

  const setWithUndo = (next: string, label: string) => {
    setUndo({ text, label });
    setText(next);
  };

  /**
   * 格式化 / 压缩：**直接改写源码本身**（用户要求）。
   * 解析失败时不动源码，只在状态行报错——避免把用户输入破坏成半成品。
   */
  const applyFormat = (mode: "pretty" | "min") => {
    setView(mode);
    if (!text.trim()) { setToast("输入为空，无需格式化"); return; }
    try {
      const next = mode === "min" ? minifyJson(text) : formatJson(text, indent, false, fmtStyle);
      if (next === text) { setToast(mode === "min" ? "已是压缩形态" : "已是格式化形态"); return; }
      setWithUndo(next, mode === "min" ? "已压缩源码" : `已${FMT_STYLE_LABEL[fmtStyle]}格式化`);
    } catch {
      setToast("格式有误，先修正错误再格式化");
    }
  };

  /** 切换缩进 / 风格时，若当前已是格式化形态则立即重排，让选项「看得见」 */
  const reapplyIfFormatted = (nextIndent: Indent, nextStyle: FmtStyle = fmtStyle) => {
    setIndent(nextIndent);
    setFmtStyle(nextStyle);
    if (view !== "pretty" || !text.trim()) return;
    try {
      const next = formatJson(text, nextIndent, false, nextStyle);
      if (next !== text) setText(next);
    } catch { /* 有错时静默，状态行已提示 */ }
  };

  /**
   * 节点树里同级拖拽调序 → 回写源码。
   *
   * 只换同级顺序（对象 key 序 / 数组元素序），不改变嵌套关系；
   * 回写时沿用当前缩进与格式风格，避免「拖一下就变回另一种样式」。
   */
  const handleMove = (parentPath: string, fromIndex: number, toIndex: number) => {
    if (!result.ok || result.value === undefined) return;
    const moved = moveSibling(result.value, parentPath, fromIndex, toIndex);
    // prettyJson 要的是 Indent（2 | 4 | "tab"），不是展开后的 "\t"
    const next = prettyJson(moved, { indent, inlineScalarArrays: styleToInline(fmtStyle) });
    if (next !== text) setWithUndo(next, "已调整同级的字段顺序");
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

  /* ------------------------- 左框底部状态行 ------------------------- */
  const editorStatus: EditorStatus = useMemo(() => {
    if (!text.trim()) return { tone: "idle", text: "等待输入 JSON" };
    if (result.ok) {
      return { tone: "ok", text: `格式有效 · ${KIND_LABEL[result.kind]} · ${result.stats.keys} 键 · 深度 ${result.stats.depth}` };
    }
    const err = result.errors[0];
    if (!err) return { tone: "error", text: "格式无效" };
    const where = err.line > 0 ? `第 ${err.line} 行第 ${err.col} 列：` : "";
    return { tone: "error", text: `${where}${err.message}` };
  }, [text, result]);

  /** 无效时把光标定位到出错位置，方便直接改 */
  const err = result.errors[0];

  return (
    <div className="space-y-3">
      {/* 选项栏
          分组逻辑（用户 2026-11-12 要求）：
            ① 「格式化」是主动作，缩进 / 风格都是它的参数 → 同组，紧跟其后；
            ② 「压缩」是另一种独立动作 → 单独一组，与格式化解耦；
            ③ 转义 / 示例 / 清空是工具动作 → 靠右。 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* ① 格式化 + 它的参数（缩进、风格） */}
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          <Tip text="按当前缩进与风格重排源码（就地改写）">
            <button onClick={() => applyFormat("pretty")} className={`rounded-lg px-3 py-1.5 transition ${
              view === "pretty" ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}>
              格式化
            </button>
          </Tip>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          <span className="pl-1.5 pr-0.5 text-[11px] text-paper-500">缩进</span>
          {([2, 4, "tab"] as const).map((n) => (
            <Tip key={n} text={n === "tab" ? "每层缩进一个制表符" : `每层缩进 ${n} 个空格`}>
              <button onClick={() => reapplyIfFormatted(n)} className={`rounded-lg px-2.5 py-1.5 transition ${
                indent === n ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
              }`}>
                {n === "tab" ? "Tab" : `${n} 空格`}
              </button>
            </Tip>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          <span className="pl-1.5 pr-0.5 text-[11px] text-paper-500">格式</span>
          {FMT_STYLES.map((s) => (
            <Tip key={s.key} text={s.hint}>
              <button
                onClick={() => reapplyIfFormatted(indent, s.key)}
                className={`rounded-lg px-2.5 py-1.5 transition ${
                  fmtStyle === s.key ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
                }`}
              >
                {s.label}
              </button>
            </Tip>
          ))}
        </div>

        {/* ② 压缩：独立动作，单独分组 */}
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          <Tip text="去掉所有空白，压成单行（就地改写）">
            <button onClick={() => applyFormat("min")} className={`rounded-lg px-3 py-1.5 transition ${
              view === "min" ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}>
              压缩
            </button>
          </Tip>
        </div>

        {/* ③ 工具动作 */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Tip text="整段转义成带引号的 JSON 字符串字面量">
            <button onClick={doEscape} disabled={!text} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40">
              <Quote size={13} /> 转义
            </button>
          </Tip>
          <Tip text='把 \n \t \uXXXX 等字面量还原成真实字符'>
            <button onClick={doUnescape} disabled={restorable === 0} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40">
              <UnfoldVertical size={13} /> 反转义
              {restorable > 0 && <span className="rounded-full bg-brand-gold/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-brand-gold">{restorable}</span>}
            </button>
          </Tip>
          <Tip text="载入一段示例 JSON">
            <button onClick={() => setWithUndo(SAMPLE, "已载入示例")} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"><FileJson size={13} /> 示例</button>
          </Tip>
          <Tip text="清空当前内容">
            <button onClick={() => { setUndo(null); setText(""); }} className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"><Trash2 size={13} /> 清空</button>
          </Tip>
        </div>
      </div>

      {(undo || toast) && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span className="truncate">{toast || undo?.label}</span>
          {undo && (
            <>
              <button onClick={() => { setText(undo.text); setUndo(null); }} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 font-medium transition hover:bg-emerald-100"><Undo2 size={12} /> 撤销</button>
              <button onClick={() => setUndo(null)} className="shrink-0 rounded-lg px-2 py-0.5 text-emerald-700/90 transition hover:bg-emerald-100">收起</button>
            </>
          )}
        </div>
      )}

      {/* ===== 两个对齐的框：左源码 / 右节点树 =====
          高度策略：不再用固定 vh 常量硬算（撤销条/提示条出现时会算少，把
          底部状态行挤出视口）。改为「两框等分父容器剩余高度」：
          - 父容器用 flex-1 + min-h-0 吃掉剩余空间；
          - 两框各自 h-full，网格 items-stretch 保证同高；
          - min-h 兜住矮视口，超出时整页滚动而不是把状态行裁掉。 */}
      <div className="grid min-h-[340px] flex-1 grid-cols-1 items-stretch gap-4 lg:grid-cols-2" style={{ minHeight: "max(340px, calc(100vh - 400px))" }}>
        <div className="h-full min-h-0">
          <Suspense fallback={<BoxSkeleton label="加载编辑器…" />}>
            <JsonEditor value={text} onChange={setText} status={editorStatus} />
          </Suspense>
        </div>

        <div className="h-full min-h-0">
          {result.ok && result.value !== undefined ? (
            <Suspense fallback={<BoxSkeleton label="加载节点树…" />}>
              <TreeView value={result.value} onMove={handleMove} />
            </Suspense>
          ) : (
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
                节点树
              </div>
              <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 p-4">
                {err ? (
                  <>
                    <p className="text-sm text-rose-700">{err.message}</p>
                    <p className="text-[11px] text-paper-500">
                      修正左侧 JSON 后，这里会自动显示可折叠的节点树。
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-paper-500">左侧输入 JSON 后，这里显示可折叠的节点树。</p>
                )}
              </div>
              <div className="h-6 shrink-0 border-t border-paper-200/70" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 加载态占位：保持和真实框一样的骨架，避免布局跳动 */
function BoxSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      <div className="h-7 shrink-0 border-b border-paper-200/70" />
      <div className="grid min-h-0 flex-1 place-items-center text-xs text-paper-500">{label}</div>
      <div className="h-6 shrink-0 border-t border-paper-200/70" />
    </div>
  );
}
