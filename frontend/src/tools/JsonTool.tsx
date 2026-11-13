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
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileJson, Quote, Trash2, Undo2, UnfoldVertical } from "lucide-react";
import { escapeJsonString, unescapeJsonString } from "./jsonEscape";
import { parseInput } from "./json/parse.ts";
import { formatJson, minifyJson, prettyJson, styleToInline, type Indent, type FmtStyle } from "./json/format.ts";
import type { InputKind, ParseResult } from "./json/types.ts";
import { buildSourceLines, containerPaths, foldablePaths } from "./json/views/sourceLines.ts";
import { moveSibling } from "./json/views/treeModel.ts";
import Tip from "./Tip";

const SourceView = lazy(() => import("./json/views/SourceView.tsx"));
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
  /** 展开/折叠的节点路径集合 —— 左右两栏共用这一份，保证行行对齐 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  /** 左栏当前高亮的行区间（悬停节点树时由右栏回调写入） */
  const [highlight, setHighlight] = useState<[number, number] | null>(null);
  /** 拖拽中的「预演值」：非 null 时两栏都按它渲染，实现拖动即实时预览 */
  const [previewValue, setPreviewValue] = useState<{ value: unknown; path: string } | null>(null);
  /**
   * 左栏模式：edit = CodeMirror 自由编辑；view = 行模型只读（行行对齐右栏）。
   *
   * 为什么要有两档：行行对齐要求源码是可控行序列（只读渲染），
   * 但用户日常还需要直接改 JSON。默认「编辑」，切到「查看」才牺牲编辑换对齐。
   */
  const [editable, setEditable] = useState(true);
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

  /** 无效时把光标定位到出错位置，方便直接改 */
  const err = result.errors[0];

  /* ------------------------- 行模型（左右两栏共用） ------------------------- */
  /** 可折叠的路径集合（纯标量数组在高效风格下内联，不可折叠） */
  const foldable = useMemo(
    () => (result.ok && result.value !== undefined ? foldablePaths(result.value, styleToInline(fmtStyle)) : new Set<string>()),
    [result, fmtStyle],
  );

  /** 数据或风格变化时重置展开状态：默认展开根 + 第一层，其它折叠 */
  const firstDoc = useRef<unknown>(null);
  useEffect(() => {
    if (!result.ok || result.value === undefined) return;
    if (firstDoc.current === result.value) return;
    firstDoc.current = result.value;
    const init = new Set<string>();
    if (foldable.has("/")) init.add("/");
    for (const p of containerPaths(result.value)) {
      // 只自动展开到第二层，深层默认折叠，避免一进来就爆屏
      const depth = p.split("/").filter(Boolean).length;
      if (depth <= 1 && foldable.has(p)) init.add(p);
    }
    setExpanded(init);
    setHighlight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  /**
   * 「生效值」：拖动中被拖节点的预演值优先，其余情况是真实值。
   * 两栏都从它派生 → 拖动时左右同时变化，且行行对齐自动保持。
   */
  const effectiveValue = previewValue ? previewValue.value : result.value;

  /** 树行：始终按缩进展开的完整结构（右栏用，压缩时也不变） */
  const treeLines = useMemo(() => {
    if (!result.ok || effectiveValue === undefined) return [];
    return buildSourceLines(effectiveValue, {
      indent,
      expanded,
      inlineScalarArrays: styleToInline(fmtStyle),
    });
  }, [result.ok, effectiveValue, indent, expanded, fmtStyle]);

  /**
   * 源码行：左栏渲染它。
   *
   * - 格式化视图：与 treeLines 完全一致 → **行行对齐右栏**；
   * - 压缩视图：只给一行压缩文本。
   *   ⚠️ 早期这里忽略 view，导致「压缩」点了没反应（底部还提示"已是压缩形态"，
   *   看起来像按钮坏了）。压缩时两栏不再追求行行对齐，右栏仍显示完整树。
   */
  const lines = useMemo(() => {
    if (!result.ok || effectiveValue === undefined) return [];
    if (view !== "min") return treeLines;
    // applyFormat("min") 已把 text 压成单行，这里直接用它，不再二次 minify
    const compact = text.trim() || "{}";
    return [{
      path: "/", index: 0, depth: 0, text: compact, kind: "inline" as const,
      spanStart: 0, spanEnd: 0, blockStart: 0, blockEnd: 0,
      valueKind: "object" as const, keyText: null,
      parentPath: null, index_in_parent: 0, parentIsArray: false, foldable: false,
      valueText: `压缩为 ${compact.length} 字符`,
    }];
  }, [result.ok, effectiveValue, view, treeLines, text]);

  const toggleNode = (path: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const expandAll = () => setExpanded(new Set(foldable));
  const collapseAll = () => setExpanded(new Set());

  /** 拖拽预演：拖动中两栏都按预演值渲染 */
  const handlePreview = (value: unknown | null, path: string | null) => {
    if (value === null || path === null) setPreviewValue(null);
    else setPreviewValue({ value, path });
  };

  /**
   * 拖动时左栏高亮被拖节点所在的整块。
   *
   * ⚠️ 必须放 effect 里算：handlePreview 只是把预演值塞进 state，
   * 新的 lines 要到下一轮渲染才生成。若在 handlePreview 里同步算行号，
   * 拿到的是**拖动前**的行模型，高亮会标错位置。
   * 这里以 lines 为准：等它更新完，再按 previewValue.path 查整块区间。
   */
  useEffect(() => {
    if (!previewValue || !previewValue.path) { setHighlight(null); return; }
    const hit = lines.find((l) => l.path === previewValue.path);
    if (!hit) { setHighlight(null); return; }
    setHighlight([hit.blockStart, hit.blockEnd]);
  }, [previewValue, lines]);

  /**
   * 拖拽调序落盘。
   *
   * ⚠️ 必须用「预演值」而不是重新算：拖动过程中两栏已经在按预演值显示，
   * 松手时若从 result.value 再重算一遍，会拿到**拖动前**的旧顺序，
   * 表现为「松手后又跳回原位」（踩过这个坑）。
   * 有预演值就直接落盘它，没有才回退到重算。
   */
  const handleMove = (
    parentPath: string,
    fromIndex: number,
    toIndex: number,
    /** 拖动中已算好的最终值 —— 优先用它，父级自己再算会拿到拖动前的旧值 */
    finalValue?: unknown,
  ) => {
    if (!result.ok) return;
    const moved = finalValue !== undefined
      ? finalValue
      : moveSibling(result.value as unknown, parentPath, fromIndex, toIndex);
    const next = prettyJson(moved, { indent, inlineScalarArrays: styleToInline(fmtStyle) });
    setPreviewValue(null);
    if (next !== text) setWithUndo(next, "已调整同级的字段顺序");
  };

  /** 左栏底部状态行文案 */
  const statusText = useMemo(() => {
    if (!text.trim()) return { tone: "idle" as const, text: "等待输入 JSON" };
    if (result.ok) return { tone: "ok" as const, text: `格式有效 · ${KIND_LABEL[result.kind]} · ${result.stats.keys} 键 · 深度 ${result.stats.depth}` };
    const e0 = result.errors[0];
    if (!e0) return { tone: "error" as const, text: "格式无效" };
    const where = e0.line > 0 ? `第 ${e0.line} 行第 ${e0.col} 列：` : "";
    return { tone: "error" as const, text: `${where}${e0.message}` };
  }, [text, result]);

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

        {/* ③ 左栏模式：编辑 / 查看（查看时行行对齐右栏） */}
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          <span className="pl-1.5 pr-0.5 text-[11px] text-paper-500">源码</span>
          <Tip text="直接编辑 JSON（CodeMirror）">
            <button onClick={() => setEditable(true)} className={`rounded-lg px-2.5 py-1.5 transition ${
              editable ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}>
              编辑
            </button>
          </Tip>
          <Tip text="只读查看，与右侧节点树行行对齐">
            <button onClick={() => setEditable(false)} className={`rounded-lg px-2.5 py-1.5 transition ${
              !editable ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}>
              查看
            </button>
          </Tip>
        </div>

        {/* ④ 工具动作 */}
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

      {/* 撤销 / 操作提示：**固定在视口底部居中，不占任何布局高度**。
          ⚠️ 它绝不能出现在两框上方 —— 一旦插入文档流，两框就会被整体下推，
          页面「跳一下」，同时也破坏了两栏的行对齐。
          需要整行横幅又不想动布局时，浮层是唯一解。 */}
      {(undo || toast) && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-xl border border-paper-300 bg-white/95 px-3 py-2 text-xs text-paper-800 shadow-lg backdrop-blur">
          <span className="truncate">{toast || undo?.label}</span>
          {undo && (
            <>
              <button onClick={() => { setText(undo.text); setUndo(null); }} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 font-medium text-[#0d9488] transition hover:bg-[#0d9488]/10"><Undo2 size={12} /> 撤销</button>
              <button onClick={() => setUndo(null)} className="shrink-0 rounded-lg px-2 py-0.5 text-paper-600 transition hover:bg-paper-100">收起</button>
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
        {/* 左栏：编辑模式 = CodeMirror 自由编辑；查看模式 = 行模型只读（行行对齐） */}
        <div className="h-full min-h-0">
          <Suspense fallback={<BoxSkeleton label="加载源码…" />}>
            {editable ? (
              <JsonEditor
                value={text}
                onChange={(v) => setText(v)}
                status={{
                  tone: result.ok ? "ok" : "error",
                  text: result.ok
                    ? `${KIND_LABEL[result.kind]} · ${result.stats.keys} 键 · 深度 ${result.stats.depth}`
                    : (result.errors[0]
                        ? `${result.errors[0].line > 0 ? `第 ${result.errors[0].line} 行第 ${result.errors[0].col} 列：` : ""}${result.errors[0].message}`
                        : "格式无效"),
                }}
              />
            ) : (
              <SourceView
                lines={lines}
                highlight={highlight}
                onExpand={(p) => setExpanded((prev) => new Set(prev).add(p))}
                onReplace={(t) => setWithUndo(t, "已粘贴内容")}
              />
            )}
          </Suspense>
        </div>

        {/* 右栏：节点树（同一份行模型派生） */}
        <div className="h-full min-h-0">
          <Suspense fallback={<BoxSkeleton label="加载节点树…" />}>
            <TreeView
              lines={view === "min" ? treeLines : lines}
              expanded={expanded}
              onToggle={toggleNode}
              onExpandAll={expandAll}
              onCollapseAll={collapseAll}
              onHoverBlock={setHighlight}
              onMove={handleMove}
              onPreview={handlePreview}
              rootValue={result.value}
            />
          </Suspense>
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
