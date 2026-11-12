/**
 * 文本对比的编辑器主题与行内高亮扩展。
 *
 * 为什么单独一层：`MergeView` 只负责「整块差异的行级高亮」，
 * 行内（字符级）差异需要自己用 Decoration 标出来 —— 这正是「行内细粒度选推」的视觉基础：
 * 用户要能看见「哪几个字不同」，才谈得上单独推这几个字。
 *
 * 主题约定：**只读全站 CSS 变量**（`--cm-*`，见 index.css），
 * 不引入 CodeMirror 自带亮/暗主题，避免与 paper 色板打架。
 */
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import type { InlinePiece } from "./core";

/* ------------------------------ 主题 ------------------------------ */

/**
 * 两个编辑器共用的基础主题。
 *
 * ⚠️ `&.cm-merge-a` / `&.cm-merge-b` 是 MergeView 给各自编辑器加的类，
 *    这里借它区分左右两侧的差异底色（左=删/红系，右=增/绿系）。
 */
export const CMP_THEME: Extension = EditorView.theme({
  "&": {
    fontSize: "12.5px",
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--cm-fg, #3d2b1f)",
  },
  ".cm-content": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    padding: "10px 0",
    caretColor: "var(--cm-caret, #0d9488)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--cm-gutter, #b8a890)",
    fontSize: "11px",
  },
  ".cm-activeLine": { backgroundColor: "var(--cm-active, rgba(13,148,136,0.06))" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--cm-fg, #3d2b1f)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--cm-sel, rgba(13,148,136,0.20)) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--cm-caret, #0d9488)" },
  ".cm-editor": { height: "100%" },
  ".cm-editor.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto" },
  // 行内差异：左删红底、右增绿底；深浅两档由 CSS 变量给，避免硬编码颜色在夜间模式发亮
  ".cmp-inline-del": {
    backgroundColor: "var(--cmp-del, rgba(225,29,72,0.18))",
    textDecoration: "line-through",
    textDecorationColor: "var(--cmp-del-line, rgba(225,29,72,0.55))",
    borderRadius: "2px",
  },
  ".cmp-inline-ins": {
    backgroundColor: "var(--cmp-ins, rgba(5,150,105,0.18))",
    borderRadius: "2px",
  },
  // 被「选中待推」的那一段额外描边，告诉用户「推的就是这段」
  ".cmp-inline-picked": {
    outline: "1.5px solid var(--cmp-pick, rgba(201,134,0,0.9))",
    outlineOffset: "-1px",
    borderRadius: "2px",
  },
});

/* ------------------------ 行内差异装饰 ------------------------ */

/** 行内差异的装饰数据：绝对偏移 + 类型 + 是否被选中 */
export interface InlineMark {
  from: number;
  to: number;
  kind: "del" | "ins";
  /** 该片段在 pieces 数组中的下标，点击时回传 */
  index: number;
  /** 是否处于「已选中待推」状态 */
  picked?: boolean;
}

const setInlineMarks = StateEffect.define<{ side: "a" | "b"; marks: InlineMark[] }>();

const inlineField = StateField.define<{ side: "a" | "b"; marks: InlineMark[]; deco: DecorationSet }>({
  create: () => ({ side: "a", marks: [], deco: Decoration.none }),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setInlineMarks)) next = { side: e.value.side, marks: e.value.marks, deco: buildDeco(tr.state.doc.length, e.value.marks) };
    }
    // 文档变化后旧装饰可能越界 —— 直接按新长度重建（对比场景下文档变化本就是重算差异）
    if (tr.docChanged && next.marks.length) {
      next = { ...next, deco: buildDeco(tr.state.doc.length, next.marks) };
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function buildDeco(docLen: number, marks: InlineMark[]): DecorationSet {
  if (!marks.length) return Decoration.none;
  const ranges = marks
    // 夹到文档范围内，避免推送后文档变短导致 RangeError
    .map((m) => ({ ...m, from: Math.min(m.from, docLen), to: Math.min(m.to, docLen) }))
    .filter((m) => m.to > m.from)
    .sort((x, y) => x.from - y.from);
  const specs = [];
  for (const m of ranges) {
    const cls = `cmp-inline-${m.kind}${m.picked ? " cmp-inline-picked" : ""}`;
    specs.push(Decoration.mark({ class: cls, attributes: { "data-inline-index": String(m.index) } }).range(m.from, m.to));
  }
  return Decoration.set(specs, true);
}

/** 让编辑器把行内差异标出来（side 决定只渲染该侧片段） */
export function inlineMarkExtension(): Extension {
  return inlineField;
}

/** 更新某一侧的行内标记 */
export function updateInlineMarks(view: EditorView, side: "a" | "b", marks: InlineMark[]) {
  view.dispatch({ effects: setInlineMarks.of({ side, marks }) });
}

/**
 * 把 `inlineDiff` 的片段换算成某一侧的绝对偏移标记。
 *
 * @param base 该侧 chunk 起点（片段偏移是相对于 chunk 文本的）
 * @param isPicked 判断某片段是否属于「当前选中的替换组」；
 *        细粒度推送以组为单位，但高亮仍按片段画，选中时整组一起描边。
 */
export function piecesToMarks(
  pieces: InlinePiece[],
  side: "a" | "b",
  base: number,
  isPicked: (pieceIndex: number) => boolean = () => false,
): InlineMark[] {
  const out: InlineMark[] = [];
  pieces.forEach((p, index) => {
    if (p.side !== side || p.kind === "common") return;
    out.push({ from: base + p.from, to: base + p.to, kind: p.kind, index, picked: isPicked(index) });
  });
  return out;
}

/* ------------------------ 点击行内片段 ------------------------ */

/**
 * 点击行内差异片段的处理器工厂。
 *
 * ⚠️ 不能用 `EditorView.domEventHandlers({ mousedown })`：
 *    CodeMirror 自己的鼠标选择逻辑会先消费 mousedown，回调拿不到事件（实测点不动）。
 *    改为把监听挂在**编辑器外层容器**上，用捕获阶段（`capture: true`）抢在编辑器之前拿到。
 *    这样也不会打断正常的文本选择 —— 我们只读 `data-inline-index`，不 preventDefault。
 */
export function attachInlineClickHandler(
  container: HTMLElement,
  onPick: (pieceIndex: number) => void,
): () => void {
  const handler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest?.("[data-inline-index]") as HTMLElement | null;
    if (!el) return;
    const raw = el.getAttribute("data-inline-index");
    if (raw === null) return;
    const idx = Number(raw);
    if (!Number.isFinite(idx)) return;
    onPick(idx);
  };
  container.addEventListener("mousedown", handler, true);
  return () => container.removeEventListener("mousedown", handler, true);
}

/** 占位，避免 tree-shaking 把 WidgetType 摇掉（后续块级折叠提示会用到） */
export class _UnusedWidget extends WidgetType {
  toDOM() {
    return document.createElement("span");
  }
}

/**
 * 把 EditorView 实例挂到它自己的 DOM 上（`__cmView`），仅供自动化测试读取文档内容。
 *
 * 为什么需要：CodeMirror 不把 view 暴露在 DOM 上，无头浏览器里拿不到真实文本，
 * 端到端验证就只能靠读 innerText —— 而 innerText 不含换行细节，断言会失真。
 * 只在 `import.meta.env.DEV` 下调用，生产构建不会执行。
 */
export function exposeViewForTesting(view: EditorView): void {
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    (view.dom as unknown as { __cmView?: EditorView }).__cmView = view;
  }
}
