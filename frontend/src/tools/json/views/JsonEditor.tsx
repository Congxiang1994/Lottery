/**
 * CodeMirror 6 React 封装（替代 Monaco，见方案 §2.1）。
 *
 * 设计约束：
 *  - **受控**：value 变化时只在内容真的不同才 dispatch，避免每次渲染重设光标；
 *  - **两次编辑不互相踩**：本组件自己产生的编辑用 selfEditRef 标记，
 *    外部回写时跳过，既保住光标/折叠，又不会让旧结果覆盖新输入；
 *  - **主题跟随全站**：用 EditorView.theme 读 CSS 变量，不使用自带暗色主题；
 *  - **minimal 档**：只装「高亮 + 折叠 + 查找替换 + 历史 + 括号匹配 + 行号」，
 *    约 118 KB gzip（去掉了 autocomplete / closeBrackets 这两个大头）。
 *
 * 布局：头部（标题 + 字符数）· 编辑器主体（自适应剩余高度）· 底部状态行。
 * 头部与底部都是固定行高，配合右栏节点树保证两个框严格对齐。
 */
import { useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap, bracketMatching, syntaxHighlighting, HighlightStyle, indentOnInput } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { Braces } from "lucide-react";
import { useTheme } from "../../../common/useTheme.ts";

/** 底部状态行：有效（绿）/ 出错（红）/ 空闲（灰） */
export type EditorStatus = { tone: "ok" | "error" | "idle"; text: string } | null;

/** 用 CSS 变量取色，全站亮/暗两档自动生效 */
const CM_THEME = EditorView.theme({
  "&": { fontSize: "13px", height: "100%", backgroundColor: "transparent", color: "var(--cm-fg, #3d2b1f)" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", padding: "12px 0", caretColor: "var(--cm-caret, #0d9488)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--cm-gutter, #b8a890)" },
  ".cm-activeLine": { backgroundColor: "var(--cm-active, rgba(13,148,136,0.06))" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--cm-fg, #3d2b1f)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--cm-sel, rgba(13,148,136,0.20)) !important" },
  ".cm-cursor": { borderLeftColor: "var(--cm-caret, #0d9488)" },
  ".cm-foldGutter": { color: "var(--cm-gutter, #b8a890)" },
  ".cm-matchingBracket": { backgroundColor: "var(--cm-match, rgba(201,134,0,0.22))", outline: "1px solid rgba(201,134,0,0.5)" },
  ".cm-searchMatch": { backgroundColor: "var(--cm-search, rgba(201,134,0,0.35))" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-editor": { height: "100%" },
  ".cm-editor.cm-focused": { outline: "none" },
}, { dark: false });

/** 语法高亮走 CSS 变量，避免自带配色与 paper 色板打架 */
const CM_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--cm-key, #0d9488)" },
  { tag: tags.string, color: "var(--cm-str, #b45309)" },
  { tag: tags.number, color: "var(--cm-num, #7c3aed)" },
  { tag: tags.bool, color: "var(--cm-bool, #7c3aed)" },
  { tag: tags.null, color: "var(--cm-null, #9c8769)" },
  { tag: tags.punctuation, color: "var(--cm-punc, #8b7355)" },
  { tag: tags.brace, color: "var(--cm-punc, #8b7355)" },
  { tag: tags.squareBracket, color: "var(--cm-punc, #8b7355)" },
]);

export interface JsonEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** 底部状态行；null 表示不显示 */
  status?: EditorStatus;
}

/** 头部行高与底部行高：两侧共用，保证左右两个框严格对齐 */
const HEAD_H = "h-7";
const FOOT_H = "h-6";

export default function JsonEditor({ value, onChange, readOnly = false, status }: JsonEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const readOnlyComp = useRef(new Compartment());
  /** 由本编辑器自身编辑产生的文本：外部 value 同步时应跳过，避免回写打断输入 */
  const selfEditRef = useRef<string | null>(null);
  const { night } = useTheme();

  onChangeRef.current = onChange;

  const extensions = useMemo(() => [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(CM_HIGHLIGHT),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    json(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    readOnlyComp.current.of([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]),
    EditorView.lineWrapping,
    CM_THEME,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && onChangeRef.current) {
        const next = u.state.doc.toString();
        selfEditRef.current = next;
        onChangeRef.current(next);
      }
    }),
  ], []); // 只读 / value 变化走 compartment + dispatch，不重建 editor

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时建一次；value 初始值与 extensions 闭包稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions]);

  // 外部 value 同步：内容不同才 dispatch，避免打断用户输入与折叠状态。
  // 若这次 value 变化正是本编辑器自己编辑产生的，直接消费标记并跳过。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (selfEditRef.current !== null && selfEditRef.current === value) {
      selfEditRef.current = null;
      return;
    }
    if (view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // 只读开关走 Compartment，不重建 editor（保住折叠状态）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyComp.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // 亮/暗切换：主题用 CSS 变量，这里只需强制一次重绘
  useEffect(() => {
    viewRef.current?.requestMeasure();
  }, [night]);

  const toneCls =
    status?.tone === "error" ? "text-rose-700"
      : status?.tone === "ok" ? "text-emerald-700"
        : "text-paper-500";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      {/* 头部：与右栏节点树头部同高同版式 */}
      <div className={`flex ${HEAD_H} shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600`}>
        <Braces size={13} className="text-[#0d9488]" /> JSON 源码
        <span className="ml-auto tabular-nums">{value.length} 字符</span>
      </div>

      {/* 编辑器主体：占满剩余高度 */}
      <div ref={host} className="json-editor min-h-0 flex-1" />

      {/* 底部状态行：格式是否有效 / 无效在哪一行 */}
      <div className={`flex ${FOOT_H} shrink-0 items-center gap-1.5 border-t border-paper-200/70 px-3 text-[11px] ${toneCls}`}>
        {status ? (
          <>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.tone === "error" ? "bg-rose-500" : status.tone === "ok" ? "bg-emerald-500" : "bg-paper-400"}`} />
            <span className="truncate" title={status.text}>{status.text}</span>
          </>
        ) : (
          <span className="text-paper-400">输入 JSON 后自动校验</span>
        )}
      </div>
    </div>
  );
}
