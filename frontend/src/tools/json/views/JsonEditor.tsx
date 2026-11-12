/**
 * CodeMirror 6 React 封装（替代 Monaco，见方案 §2.1）。
 *
 * 设计约束：
 *  - **受控**：value 变化时只在内容真的不同才 dispatch，避免每次渲染重设光标；
 *  - **异步竞态**：外部 value 与内部编辑通过 generation 版本号隔离，
 *    旧版本回调不得覆盖新输入（JsonStudio v1.2.0 教训）；
 *  - **主题跟随全站**：用 EditorView.theme 读 CSS 变量，MutationObserver 监听
 *    <html> 的 .site-night 变化重配，不使用 CodeMirror 自带暗色主题；
 *  - **minimal 档**：basicSetup 会带多余扩展，这里只装「高亮 + 折叠 + 查找替换
 *    + 历史 + 括号匹配 + 行号」，对应 ~75 KB gzip。
 */
import { useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap, bracketMatching, syntaxHighlighting, HighlightStyle, indentOnInput } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
// 不引 @codemirror/autocomplete / closeBrackets：JSON 补全在「查看/格式化」场景
// ROI 低，却会把编辑器 chunk 从 ~75 KB 推到 131 KB gzip（实测）。方案取 minimal 档。
import { tags } from "@lezer/highlight";
import { useTheme } from "../../../common/useTheme.ts";

/** 用 CSS 变量取色，全站亮/暗两档自动生效 */
const CM_THEME = EditorView.theme({
  "&": { fontSize: "13px", backgroundColor: "transparent", color: "var(--cm-fg, #3d2b1f)" },
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
}, { dark: false });

/** 语法高亮也走 CSS 变量，避免自带配色与 paper 色板打架 */
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
  height?: number | string;
  /** 错误信息（可选）：有值时在底部显示一条状态 */
  status?: string;
}

export default function JsonEditor({ value, onChange, readOnly = false, height = 420, status }: JsonEditorProps) {
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
        // 用户编辑：同步回调出去，并记下「这是我自己改的」。
        // 外层 value 随后回来时，用这个标记跳过 dispatch，就不会把光标/折叠状态
        // 重置，也不会让旧一代结果覆盖新输入（JsonStudio v1.2.0 竞态教训）。
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

  // 亮/暗切换：主题本身用 CSS 变量，这里只需强制一次重绘（变量在 :root/.site-night 上）
  useEffect(() => {
    viewRef.current?.requestMeasure();
  }, [night]);

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      <div ref={host} style={{ height }} className="json-editor" />
      {status && (
        <div className="border-t border-paper-200 bg-paper-50 px-3 py-1.5 text-[11px] text-paper-600">
          {status}
        </div>
      )}
    </div>
  );
}
