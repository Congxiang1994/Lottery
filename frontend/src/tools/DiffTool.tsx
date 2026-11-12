/**
 * 文本对比主视图 —— 基于 `@codemirror/merge` 的 MergeView（方案见
 * `docs/diff-tool-plan.md`）。
 *
 * 三层职责，别混：
 *  - **内核**（`core.ts`）：纯函数算差异、算推送操作，可脱离浏览器自测；
 *  - **编辑器**（`editorTheme.ts`）：主题 + 行内差异装饰 + 点击拾取；
 *  - **本文件**：状态编排（选项、选中、推送、折叠）与 React/DOM 生命周期。
 *
 * 三个关键实现决定
 * ----------------
 * 1. **不用 MergeView 自带 revertControls**：它一次只能配一个方向
 *    （`"a-to-b" | "b-to-a"`），而需求是「左右互相推」。改为在中间栏按 chunk
 *    位置自绘按钮，点击时调 `buildPush` 算出操作后 dispatch 到目标编辑器。
 * 2. **行内细粒度选推**：先点「行内」开关展开字符级差异；点某个红/绿片段把它
 *    「选中」（描边），再点中间的方向箭头只推这一段。选中状态与 chunk 同行级推送互不干扰。
 * 3. **折叠靠 collapseUnchanged**：`margin=3` 保留变更周围 3 行，`minSize=4` 少于 4 行不折；
 *    点折叠条由 merge 自己处理展开（左右同步）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MergeView, Chunk } from "@codemirror/merge";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap, bracketMatching, indentOnInput } from "@codemirror/language";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { ArrowLeftToLine, ArrowRightToLine, ChevronsDownUp, GitCompare, Info, RefreshCw, Trash2, Undo2 } from "lucide-react";
import Tip from "./Tip.tsx";
import {
  buildPush,
  buildGroupPush,
  groupInline,
  inlineDiff,
  summarize,
  normalizeForCompare,
  type CompareOptions,
  type DiffChunk,
  type InlineGroup,
  type InlinePiece,
} from "./diff/core.ts";
import {
  CMP_THEME,
  inlineMarkExtension,
  attachInlineClickHandler,
  updateInlineMarks,
  piecesToMarks,
  exposeViewForTesting,
  type InlineMark,
} from "./diff/editorTheme.ts";

const STORAGE_KEY = "tools_diff";


type Side = "a" | "b";

interface Saved {
  a: string;
  b: string;
}

const SAMPLE_A = `function greet(name) {
  const prefix = "Hello";
  return prefix + " " + name;
}

// 旧的错误处理
try {
  run();
} catch (e) {
  console.log(e);
}

const config = {
  theme: "light",
  debug: false,
  retries: 3,
};`;

const SAMPLE_B = `function greet(name) {
  const prefix = "Hi";
  return \`\${prefix} \${name}\`;
}

// 新的错误处理：区分类型
try {
  run();
} catch (e) {
  if (e instanceof TypeError) {
    console.error("类型错误", e);
  } else {
    console.warn(e);
  }
}

const config = {
  theme: "auto",
  debug: true,
  retries: 5,
};`;

function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.a === "string" && typeof v?.b === "string") return v;
    }
  } catch {
    /* 存储损坏就当没存过 */
  }
  return { a: SAMPLE_A, b: SAMPLE_B };
}

/** 中间栏一个差异块的按钮定位信息 */
interface ChunkUi {
  /** chunk 在 MergeView.chunks 里的下标 */
  index: number;
  /** 顶部像素（相对 revert 栏） */
  top: number;
  /** 高度，用于让「行内」按钮落在块中间 */
  height: number;
}

export default function DiffTool() {
  const saved = useRef(loadSaved());
  const [textA, setTextA] = useState(saved.current.a);
  const [textB, setTextB] = useState(saved.current.b);
  const [opt, setOpt] = useState<CompareOptions>({ ignoreWhitespace: false, ignoreCase: false });
  const [collapse, setCollapse] = useState(true);
  const [showInline, setShowInline] = useState(true);
  /** 当前选中的行内替换组：{ chunk, group } —— null 表示没有选中 */
  const [picked, setPicked] = useState<{ chunk: number; group: number } | null>(null);
  /** 中间栏按钮的渲染数据 */
  const [chunkUi, setChunkUi] = useState<ChunkUi[]>([]);
  /** 视图重建计数：每次 mount 自增，驱动按钮定位重算 */
  const [mountSeq, setMountSeq] = useState(0);
  /** 撤销栈（一次推送可能改两侧，整份快照最省心） */
  const [undo, setUndo] = useState<{ a: string; b: string; label: string } | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  /** 中间栏按钮重算入口，由下方 measure 段落赋值（mount 需要它，故用 ref 前向引用） */
  const scheduleMeasureRef = useRef<() => void>(() => {});
  /** 合帧用的 rAF 句柄 */
  const rafRef = useRef(0);
  const viewRef = useRef<MergeView | null>(null);
  const revertBarRef = useRef<HTMLDivElement>(null);
  /**
   * 编辑器自己产生的文本，回写 state 时跳过，避免打断输入。
   * 每侧独立记录、用完即置 null —— 只清一侧会让另一侧的旧值残留，
   * 后续比较误判为「外部写入」再覆盖一次（实测出现重复插入）。
   */
  const selfEdit = useRef<{ a: string | null; b: string | null } | null>(null);

  /* ---------------------------- 持久化 ---------------------------- */

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: textA, b: textB }));
    } catch {
      /* 超限或隐私模式，忽略 */
    }
  }, [textA, textB]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  /* ---------------------------- 差异计算 ---------------------------- */

  // 用归一化后的文本参与 diff，但偏移与原文一致（core.normalizeForCompare 保证长度不变）
  const normA = useMemo(() => normalizeForCompare(textA, opt), [textA, opt]);
  const normB = useMemo(() => normalizeForCompare(textB, opt), [textB, opt]);

  const summary = useMemo(() => {
    const chunks = Chunk.build(
      EditorState.create({ doc: normA }).doc,
      EditorState.create({ doc: normB }).doc,
      { scanLimit: 500, timeout: 400 },
    );
    const plain: DiffChunk[] = chunks.map((c) => ({
      a: { from: c.fromA, to: c.toA },
      b: { from: c.fromB, to: c.toB },
      precise: c.precise !== false,
    }));
    return { plain, stat: summarize(textA, textB, plain) };
  }, [normA, normB, textA, textB]);

  /** 每个 chunk 的行内片段（只在展开行内时算，避免大文档白算） */
  const inlinePieces = useMemo(() => {
    if (!showInline) return [] as InlinePiece[][];
    return summary.plain.map((c) =>
      inlineDiff(textA.slice(c.a.from, c.a.to), textB.slice(c.b.from, c.b.to)),
    );
  }, [summary.plain, showInline, textA, textB]);

  /** 每个 chunk 的替换组（细粒度推送的单位） */
  const inlineGroups = useMemo(() => {
    if (!showInline) return [] as InlineGroup[][];
    return summary.plain.map((c, i) =>
      groupInline(inlinePieces[i] ?? [], c.a, c.b, textA, textB),
    );
  }, [summary.plain, inlinePieces, showInline, textA, textB]);

  /* ---------------------------- 编辑器生命周期 ---------------------------- */

  /**
   * 建一个 MergeView 并挂到宿主节点上。
   *
   * 之所以抽成函数而不是「挂载一次 + 后续 dispatch」：
   * 折叠范围依赖 `StateField.init`（见下方折叠段落注释），内容一变就必须重建 State，
   * 而 merge 不支持只重建 State、必须重建整个 MergeView。
   */
  const mount = useCallback(
    (scrollTop = 0) => {
      const host = hostRef.current;
      if (!host) return;
      // ⚠️ 必须先销毁旧视图再清 DOM：
      //    StrictMode 下 effect 会执行两次，若只覆盖 DOM 不 destroy，
      //    旧 EditorView 仍持有事件监听与 updateListener，会和新的同时响应 ——
      //    实测表现为「打一个字被写入两三次」（XYZlXYZXYZine）。
      viewRef.current?.destroy();
      viewRef.current = null;
      host.innerHTML = "";

      const buildExtensions = (side: Side) => [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
        EditorView.lineWrapping,
        CMP_THEME,
        inlineMarkExtension(),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const next = u.state.doc.toString();
          if (side === "a") {
            selfEdit.current = { ...(selfEdit.current ?? { a: null, b: null }), a: next };
            setTextA(next);
          } else {
            selfEdit.current = { ...(selfEdit.current ?? { a: null, b: null }), b: next };
            setTextB(next);
          }
        }),
      ];

      const view = new MergeView({
        a: { doc: textA, extensions: buildExtensions("a") },
        b: { doc: textB, extensions: buildExtensions("b") },
        parent: host,
        // 自绘中间栏按钮（不用自带 revertControls —— 它只能单向）
        revertControls: undefined,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: collapse ? { margin: 3, minSize: 4 } : undefined,
        diffConfig: { scanLimit: 500, timeout: 400 },
      });
      viewRef.current = view;
      exposeViewForTesting(view.a);
      exposeViewForTesting(view.b);
      // 行内片段点击：挂在编辑器外层，捕获阶段先于 CodeMirror 的选择逻辑
      attachInlineClickHandler(view.a.dom, (i) => onPickInline("a", i));
      attachInlineClickHandler(view.b.dom, (i) => onPickInline("b", i));
      // 重建后恢复滚动位置，避免用户视线跳回顶部
      if (scrollTop > 0) {
        requestAnimationFrame(() => {
          view.a.scrollDOM.scrollTop = scrollTop;
          view.b.scrollDOM.scrollTop = scrollTop;
        });
      }
      // 按钮定位：等两帧再测（第一帧 DOM 布局未完成、量高度会得到 0）。
      // 用 rAF 而不是 setTimeout：与浏览器绘制同步，量到的 top 才是最终值。
      window.setTimeout(() => setMountSeq((n) => n + 1), 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [textA, textB, collapse],
  );

  /** 折叠 / 重建入口：保留滚动位置再重挂 */
  const rebuildRef = useRef(() => {});
  rebuildRef.current = () => {
    const top = viewRef.current?.a.scrollDOM.scrollTop ?? 0;
    mount(top);
  };

  // 首次挂载
  useEffect(() => {
    mount(0);
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 点击行内片段 → 选中它所属的「替换组」。
   *
   * 为什么要绕一层 ref：这两个编辑器只在挂载时建一次，
   * 事件处理器闭包里拿到的是首次渲染的 summary/picked，必然是旧值；
   * 通过 ref 每次渲染刷新，回调里读到的才是最新数据。
   */
  const pickRef = useRef<(side: Side, pieceIndex: number) => void>(() => {});
  pickRef.current = (_side: Side, pieceIndex: number) => {
    // 找到该片段属于哪个 chunk 的哪个组
    for (let ci = 0; ci < inlineGroups.length; ci++) {
      const gs = inlineGroups[ci];
      for (let gi = 0; gi < gs.length; gi++) {
        if (gs[gi].pieceIndexes.includes(pieceIndex)) {
          setPicked((prev) =>
            prev && prev.chunk === ci && prev.group === gi ? null : { chunk: ci, group: gi },
          );
          return;
        }
      }
    }
  };
  const onPickInline = useCallback((side: Side, pieceIndex: number) => {
    pickRef.current(side, pieceIndex);
  }, []);

  /** 光标所在/最近的 chunk 下标（保留给后续「跳到下一处」用） */
  const activeChunkRef = useRef(0);

  /* ---------------------------- 折叠开关 ---------------------------- */

  /* ---------------------------- 折叠 ---------------------------- */

  /**
   * 折叠为什么必须重建视图：
   *
   * `@codemirror/merge` 把折叠范围算在 `StateField.init`
   * （源码 `CollapsedRanges.create → Decoration.none`），**只在 State 创建时执行一次**；
   * `reconfigure` 只换扩展、不重跑 `init`，所以内容一变折叠范围就过期。
   * 且 `collapseUnchanged` 未导出，无法塞进 Compartment 手动重算。
   *
   * ⚠️ 重建的代价是**销毁 DOM = 丢焦点/丢光标**，所以绝不能「每次按键都重建」。
   *    策略：
   *     1. 用户自己打字（selfEdit 命中）→ 不重建，忍受该区域的折叠暂时不刷新；
   *     2. 折叠开关变化 → 立即重建（用户主动操作，丢焦点可接受）；
   *     3. 外部内容变化（推送/撤销/示例/清空）→ 防抖后重建，并用 isSyncing 抑制打字期间的抖动。
   *
   *  另外重建期间给编辑器加 `readOnly` 没有意义（DOM 已经换了），
   *  真正要保证的是「不再有按键落到旧 DOM 上」—— 防抖已经覆盖。
   */
  const collapseTimer = useRef(0);
  useEffect(() => {
    // 折叠开关切换：重建以让折叠配置生效
    window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => {
      const top = viewRef.current?.a.scrollDOM.scrollTop ?? 0;
      mount(top);
    }, 0);
    return () => window.clearTimeout(collapseTimer.current);
  }, [collapse]); // 只看折叠开关，不看内容

  /**
   * 内容变化**不**重建视图。
   *
   * 试过「内容一变就重建以重算折叠」，效果是：打字时 DOM 被换掉、焦点丢失，
   * 用户根本没法连续输入（实测输入 "XYZ" 后焦点落到 body）。这是不可接受的。
   *
   * 所以折叠只在两处重算：
   *  1. 折叠开关切换（用户主动操作，见上一个 effect）；
   *  2. 用户点工具栏的「重新折叠」按钮（见 `refold`）。推完/改完点一下即可。
   *
   * 内容变化后旧折叠条可能压在改动上 —— merge 自己在
   * `CollapsedRanges.update` 里会把「与变更块重叠的折叠」过滤掉，
   * 所以不会出现「改动被藏起来」的情况，最多是折叠位置暂时不理想。
   */

  /* ---------------------------- 外部文本回写 ---------------------------- */

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // 自家编辑产生的值：消费标记后直接返回，否则会把同一段文本再插一遍（实测会出现 "XYZlXYZine"）
    if (selfEdit.current?.a === textA) {
      selfEdit.current = selfEdit.current ? { ...selfEdit.current, a: null } : null;
      return;
    }
    if (view.a.state.doc.toString() !== textA) {
      view.a.dispatch({ changes: { from: 0, to: view.a.state.doc.length, insert: textA } });
    }
  }, [textA]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (selfEdit.current?.b === textB) {
      selfEdit.current = selfEdit.current ? { ...selfEdit.current, b: null } : null;
      return;
    }
    if (view.b.state.doc.toString() !== textB) {
      view.b.dispatch({ changes: { from: 0, to: view.b.state.doc.length, insert: textB } });
    }
  }, [textB]);

  /* ---------------------------- 行内标记刷新 ---------------------------- */

  // 用「组」为推送单位，但高亮仍按片段粒度画（视觉更细），
  // 选中时把该组覆盖到的所有片段标记为 picked，让用户看清「推的是这一整团」。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!showInline) {
      updateInlineMarks(view.a, "a", []);
      updateInlineMarks(view.b, "b", []);
      return;
    }
    summary.plain.forEach((c, i) => {
      const pieces = inlinePieces[i] ?? [];
      const groups = inlineGroups[i] ?? [];
      const pickedGroup = picked?.chunk === i ? groups[picked.group] : undefined;
      const inPicked = (pieceIdx: number) =>
        pickedGroup ? pickedGroup.pieceIndexes.includes(pieceIdx) : false;
      updateInlineMarks(view.a, "a", piecesToMarks(pieces, "a", c.a.from, inPicked));
      updateInlineMarks(view.b, "b", piecesToMarks(pieces, "b", c.b.from, inPicked));
    });
    // ⚠️ 必须依赖 mountSeq：重建后是新视图，旧视图上的装饰早已随 destroy 消失，
    //    不加这一项会表现为「开发环境偶发可用、生产构建永远没有行内标记」。
  }, [summary.plain, inlinePieces, inlineGroups, showInline, picked, mountSeq]);

  /* ---------------------------- 中间栏按钮定位 ---------------------------- */

  /**
   * 把每个 chunk 的屏幕位置算出来，供自绘按钮使用。
   * MergeView 内部已经在做同样的事（它要画自己的按钮），这里按需重算 ——
   * 用 requestAnimationFrame 合帧，滚动时不会每像素重排一次。
   */
  const measure = useCallback(() => {
    const view = viewRef.current;
    const bar = revertBarRef.current;
    if (!view || !bar) return;
    const next: ChunkUi[] = [];
    const chunks = view.chunks;
    const scroller = bar.parentElement;
    const scrollTop = view.a.scrollDOM.scrollTop;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      // 只渲染视口附近的块，避免几千个 chunk 时插几千个 DOM
      const block = view.a.lineBlockAt(Math.min(c.fromA, Math.max(0, view.a.state.doc.length)));
      const top = block.top - scrollTop;
      const height = Math.max(block.height, 22);
      if (top + height < -200) continue;
      if (top > (scroller?.clientHeight ?? 800) + 200) break;
      next.push({ index: i, top, height });
    }
    setChunkUi(next);
  }, []);

  const scheduleMeasure = useCallback(() => {
    // 合帧：滚动时每像素都排一次 DOM 定位会掉帧。
    // ⚠️ 守卫不能用 `if (rafRef.current) return`：cleanup 里 cancel 后句柄未清零，
    //    或 StrictMode 二次挂载残留旧句柄，都会让后续所有调用永久短路（实测按钮再也不出现）。
    //    改为「每次覆盖句柄 + 只保留最后一帧」，最多多排一次无关紧要。
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      measure();
    });
  }, [measure]);
  scheduleMeasureRef.current = scheduleMeasure;

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      // mount 尚未完成：下一帧再试（StrictMode 首次挂载会被 cleanup 清空 ref）
      const t = window.setTimeout(() => setMountSeq((n) => n + 1), 16);
      return () => window.clearTimeout(t);
    }
    const schedule = scheduleMeasure;
    // 初始 + 文档变化 + 滚动时重算
    schedule();
    const scrollA = view.a.scrollDOM;
    const scrollB = view.b.scrollDOM;
    scrollA.addEventListener("scroll", schedule, { passive: true });
    scrollB.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    if (hostRef.current) ro.observe(hostRef.current);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      scrollA.removeEventListener("scroll", schedule);
      scrollB.removeEventListener("scroll", schedule);
      ro.disconnect();
    };
  }, [measure, summary.plain, textA, textB, mountSeq]);

  /* ---------------------------- 推送 ---------------------------- */

  /** 应用一次推送（写进目标编辑器；state 由 updateListener 回写） */
  const applyPush = useCallback(
    (op: { side: Side; from: number; to: number; insert: string }, label: string) => {
      const view = viewRef.current;
      if (!view) return;
      const target = op.side === "a" ? view.a : view.b;
      const max = target.state.doc.length;
      const from = Math.min(op.from, max);
      const to = Math.min(op.to, max);
      setUndo({ a: textA, b: textB, label });
      setPicked(null);
      target.dispatch({
        changes: { from, to, insert: op.insert },
        userEvent: "revert",
        // 让 merge 知道这是「回退」而不是普通编辑，internal 差异表会即时更新
        scrollIntoView: true,
      });
    },
    [textA, textB],
  );

  /** 整块推送：左→右 或 右→左 */
  const pushChunk = useCallback(
    (index: number, from: Side) => {
      const chunk = summary.plain[index];
      if (!chunk) return;
      const op = buildPush(textA, textB, chunk, from);
      applyPush(op, from === "a" ? "已把这一块推到右侧" : "已把这一块推到左侧");
    },
    [summary.plain, textA, textB, applyPush],
  );

  /** 行内细粒度推送：只推选中的那个替换组 */
  const pushGroup = useCallback(
    (chunkIndex: number, groupIndex: number, from: Side) => {
      const g = inlineGroups[chunkIndex]?.[groupIndex];
      if (!g) return;
      const op = buildGroupPush(textA, textB, g, from);
      applyPush(op, from === "a" ? "已推入选中的行内改动（左→右）" : "已推入选中的行内改动（右→左）");
    },
    [inlineGroups, textA, textB, applyPush],
  );

  /** 全部推开：以左侧为基准，把右侧所有差异覆盖成左侧内容 */
  const pushAllTo = useCallback(
    (target: Side) => {
      const view = viewRef.current;
      if (!view || summary.plain.length === 0) return;
      const from: Side = target === "a" ? "b" : "a";
      const source = from === "a" ? textA : textB;
      setUndo({ a: textA, b: textB, label: target === "a" ? "已用右侧覆盖左侧" : "已用左侧覆盖右侧" });
      setPicked(null);
      // 整份覆盖比逐块推更稳（逐块推会因偏移变化互相踩）
      const targetView = target === "a" ? view.a : view.b;
      targetView.dispatch({
        changes: { from: 0, to: targetView.state.doc.length, insert: source },
        userEvent: "revert",
      });
    },
    [summary.plain, textA, textB],
  );

  const doUndo = () => {
    if (!undo) return;
    setTextA(undo.a);
    setTextB(undo.b);
    setUndo(null);
  };

  /* ---------------------------- 渲染 ---------------------------- */

  const { stat } = summary;
  const dirty = textA.length + textB.length;

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
          <button
            onClick={() => setCollapse((v) => !v)}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition ${
              collapse ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}
            title="折叠没有变化的行，点折叠条可展开"
          >
            <ChevronsDownUp size={13} /> 折叠
          </button>
          {collapse && (
            <button
              onClick={() => {
                // 内容变了折叠不会自动重算（见折叠段落注释），用户点这里手动刷新
                const top = viewRef.current?.a.scrollDOM.scrollTop ?? 0;
                mount(top);
              }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-paper-600 transition hover:text-paper-900"
              title="内容改动后折叠范围会停留在旧位置，点此按当前内容重新折叠"
            >
              <RefreshCw size={12} /> 重折叠
            </button>
          )}
          <button
            onClick={() => setShowInline((v) => !v)}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 transition ${
              showInline ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}
            title="标出每行内部具体哪几个字不同，可单独推送"
          >
            <GitCompare size={13} /> 行内
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-paper-700">
          <input
            type="checkbox"
            checked={opt.ignoreWhitespace}
            onChange={(e) => setOpt((o) => ({ ...o, ignoreWhitespace: e.target.checked }))}
            className="h-3.5 w-3.5 accent-[#0d9488]"
          />
          忽略空白
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-paper-700">
          <input
            type="checkbox"
            checked={opt.ignoreCase}
            onChange={(e) => setOpt((o) => ({ ...o, ignoreCase: e.target.checked }))}
            className="h-3.5 w-3.5 accent-[#0d9488]"
          />
          忽略大小写
        </label>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular-nums text-paper-600">
            {stat.same ? (
              <span className="text-emerald-700">两侧完全相同</span>
            ) : (
              <>
                <span className="font-semibold text-paper-900">{stat.chunks}</span> 处差异
                <span className="ml-1 text-emerald-700">+{stat.plusChars}</span>
                <span className="ml-0.5 text-rose-700">-{stat.minusChars}</span>
              </>
            )}
            {!stat.precise && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                <Info size={11} /> 差异过大，已降级为粗略
              </span>
            )}
          </span>
          <Tip text="把左侧全部内容覆盖到右侧">
            <button
              onClick={() => pushAllTo("b")}
              disabled={stat.same}
              className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:cursor-default disabled:opacity-40"
            >
              <ArrowRightToLine size={13} /> 全部推右
            </button>
          </Tip>
          <Tip text="把右侧全部内容覆盖到左侧">
            <button
              onClick={() => pushAllTo("a")}
              disabled={stat.same}
              className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:cursor-default disabled:opacity-40"
            >
              <ArrowLeftToLine size={13} /> 全部推左
            </button>
          </Tip>
          <button
            onClick={() => {
              setTextA(SAMPLE_A);
              setTextB(SAMPLE_B);
              setPicked(null);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <GitCompare size={13} /> 示例
          </button>
          <button
            onClick={() => {
              setTextA("");
              setTextB("");
              setPicked(null);
            }}
            disabled={dirty === 0}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-2.5 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:cursor-default disabled:opacity-40"
          >
            <Trash2 size={13} /> 清空
          </button>
        </div>
      </div>

      {/* 对比主体 */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
          <span className="w-[calc(50%-1.6em)]">左侧（原文）</span>
          <span className="w-[1.6em] shrink-0 text-center text-paper-400">⇄</span>
          <span>右侧（新文）</span>
          <span className="ml-auto tabular-nums">
            {stat.linesA} / {stat.linesB} 行
          </span>
        </div>

        <div className="diff-host relative" style={{ height: "min(62vh, 560px)" }}>
          {/* MergeView 自己会往这里插 DOM；中间栏按钮由下面绝对定位的层叠在上面 */}
          <div ref={hostRef} className="h-full [&_.cm-mergeView]:h-full" />

          {/* 中间栏：按 chunk 位置渲染方向按钮 */}
          <div ref={revertBarRef} className="pointer-events-none absolute inset-0">
            {chunkUi.map((c) => {
              const chunk = summary.plain[c.index];
              if (!chunk) return null;
              const emptyA = chunk.a.to === chunk.a.from;
              const emptyB = chunk.b.to === chunk.b.from;
              const pickedHere = picked && picked.chunk === c.index ? picked : null;
              return (
                <div
                  key={c.index}
                  className="pointer-events-auto absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5"
                  style={{ top: c.top + 2 }}
                >
                  {/* 整块推送 */}
                  <div className="flex items-center gap-0.5">
                    <Tip text={emptyB ? "右侧没有这段，点此把左侧这段插入过去" : "用左侧这段覆盖右侧"}>
                      <button
                        onClick={() => pushChunk(c.index, "a")}
                        className="grid h-5 w-5 place-items-center rounded-md border border-paper-300 bg-white/95 text-paper-700 shadow-sm transition hover:border-brand-gold hover:text-brand-gold"
                        aria-label="把整块推到右侧"
                      >
                        <ArrowRightToLine size={11} />
                      </button>
                    </Tip>
                    <Tip text={emptyA ? "左侧没有这段，点此把右侧这段插入过去" : "用右侧这段覆盖左侧"}>
                      <button
                        onClick={() => pushChunk(c.index, "b")}
                        className="grid h-5 w-5 place-items-center rounded-md border border-paper-300 bg-white/95 text-paper-700 shadow-sm transition hover:border-brand-gold hover:text-brand-gold"
                        aria-label="把整块推到左侧"
                      >
                        <ArrowLeftToLine size={11} />
                      </button>
                    </Tip>
                  </div>

                  {/* 行内片段推送：只在选中该块内的片段时高亮显示 */}
                  {pickedHere && (
                    <div className="flex items-center gap-0.5">
                      <Tip text="只把选中的那几个字推到右侧">
                        <button
                          onClick={() => pushGroup(c.index, pickedHere.group, "a")}
                          className="grid h-5 w-5 place-items-center rounded-md border border-brand-gold bg-brand-gold/20 text-brand-gold shadow-sm transition hover:bg-brand-gold/35"
                          aria-label="推送选中的行内片段到右侧"
                        >
                          <ArrowRightToLine size={11} />
                        </button>
                      </Tip>
                      <Tip text="只把选中的那几个字推到左侧">
                        <button
                          onClick={() => pushGroup(c.index, pickedHere.group, "b")}
                          className="grid h-5 w-5 place-items-center rounded-md border border-brand-gold bg-brand-gold/20 text-brand-gold shadow-sm transition hover:bg-brand-gold/35"
                          aria-label="推送选中的行内片段到左侧"
                        >
                          <ArrowLeftToLine size={11} />
                        </button>
                      </Tip>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/*
        提示条用 **fixed 悬浮在视口底部**，不放进文档流。

        为什么不是「放在框下方」：放下方虽然不推框，但页面本来就超过一屏时，
        提示条会落到视口外 —— 用户点了推送却看不到任何反馈（实测框底 804、
        条顶 817、视口 780）。而放上方会整体推开两个编辑器，正在看的位置会跳。

        fixed 同时解决两件事：不占文档流（框位置永远不动）+ 永远可见。
      */}
      {(undo || picked) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
          {undo && (
            <div className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 shadow-lg">
              {undo.label}
              <button
                onClick={doUndo}
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-medium transition hover:bg-emerald-100"
              >
                <Undo2 size={12} /> 撤销
              </button>
              <button onClick={() => setUndo(null)} className="rounded-lg px-2 py-0.5 text-emerald-700/90 transition hover:bg-emerald-100">
                收起
              </button>
            </div>
          )}
          {picked && (
            <div className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-xl border border-brand-gold/40 bg-[#fffaf0] px-3 py-2 text-xs text-paper-800 shadow-lg">
              已选中一个行内改动，点中间金色箭头只推这一组；再点该片段可取消。
              <button onClick={() => setPicked(null)} className="ml-auto rounded-lg px-2 py-0.5 font-medium transition hover:bg-brand-gold/20">
                取消选中
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
