/**
 * 行模型：把 JSON 渲染成「每行一个节点」的源码行，供**左右两栏共用**。
 *
 * 为什么要有这一层（2026-11-12 用户需求）：
 *  ① 「源码和节点树行行对齐」——两边必须基于同一份行序列，各自独立渲染文本
 *     必然错位（一个是自由文本、一个是树节点）；
 *  ② 「节点树折叠时源码对应行合并成 ...」——折叠状态必须驱动源码行；
 *  ③ 「悬停节点时左边整块黄底」——需要每个节点在源码里的行区间。
 *
 * 设计要点：
 *  - 一行 = 「一个节点的开头」+（可选）「它的收尾括号」。容器节点的起止行如下：
 *      line 0: `"a": {`
 *      line 1: `  "b": 1,`
 *      line 2: `}`            ← 收尾行（若兄弟后还有项则 `},`）
 *    根容器没有 key，第 0 行就是 `{`。
 *  - **折叠的容器**仍占 1 行，内容显示为 `...`（用户要求「用 ... 代替」），
 *    且该行通过 foldPath 关联到被折叠的节点，方便左栏点击展开。
 *  - 纯标量数组在「高效」风格下整行内联，此时它只占 1 行、不可折叠。
 */
import { isLN, toDisplayString } from "../lossless.ts";
import { scalarText, isScalarArray, type Indent } from "../format.ts";
import { isContainer, childEntries, pointerOf, kindOf, type ValueKind } from "./treeModel.ts";

export interface SourceLine {
  /** 该行属于哪个节点（JSON Pointer）。收尾行也归其容器节点。 */
  path: string;
  /** 行在源码里的序号（0-based） */
  index: number;
  /** 缩进层级（用于缩进指示线等） */
  depth: number;
  /** 该行的完整展示文本（含缩进） */
  text: string;
  /** 该行类型 */
  kind: "open" | "close" | "scalar" | "inline";
  /** 若该行是折叠容器的省略行，这里是那个容器的 path */
  foldPath?: string;
  /** 该节点**自身**占据的行区间（闭合区间）：标量为单行，容器为开括号→闭括号 */
  spanStart: number;
  spanEnd: number;
  /** 该节点**连同全部子孙**占据的整块区间 —— 悬停时高亮的就是这一整块 */
  blockStart: number;
  blockEnd: number;
  /** 该节点的 kind，供语法着色 */
  valueKind: ValueKind;
  /** 该节点的 key 展示文本（根为 null） */
  keyText: string | null;
  /** 父容器路径（根为 null）—— 拖拽同级判定用 */
  parentPath: string | null;
  /** 在父容器里的序号 —— 拖拽调序用 */
  index_in_parent: number;
  /** 父容器是否为数组 */
  parentIsArray: boolean;
  /** 该节点是否可折叠（容器且非内联） */
  foldable: boolean;
  /** 标量值 / 容器的摘要文本，供右侧树显示 */
  valueText: string;
}

export interface BuildOptions {
  indent: Indent;
  expanded: Set<string>;
  /** 折叠时省略号里是否显示条目数，如 {…} 3 项 */
  inlineScalarArrays?: boolean;
}

function indentStr(unit: string, depth: number): string {
  return unit.repeat(depth);
}

/**
 * 生成源码行。
 *
 * 返回的数组就是左栏要渲染的全部行，右栏树也按同一个数组（按 path 分组）渲染，
 * 从而保证「行行对齐」。
 */
export function buildSourceLines(root: unknown, opts: BuildOptions): SourceLine[] {
  const unit = opts.indent === "tab" ? "\t" : " ".repeat(opts.indent);
  const lines: SourceLine[] = [];

  const walk = (
    v: unknown,
    parts: (string | number)[],
    key: string | number | null,
    depth: number,
    isLast: boolean,
    /** 该节点自身是否展开 */
    selfExpanded: boolean,
    parentParts: (string | number)[] | null,
    indexInParent: number,
    parentIsArray: boolean,
  ): void => {
    const parentPath = parentParts === null ? null : pointerOf(parentParts);
    const path = pointerOf(parts);
    const container = isContainer(v);
    const entries = container ? childEntries(v) : [];
    const keyText = key === null ? null : String(key);
    const comma = isLast ? "" : ",";
    const pad = indentStr(unit, depth);
    // ⚠️ 只有「对象成员」才在源码里写 "key": 前缀。
    //    数组元素在 JSON 里没有 key（就是 1、2、3 这种值），
    //    若把下标也写成 "0": xxx 会产出非法 JSON。
    const keyPrefix = parentIsArray || keyText === null ? "" : `${JSON.stringify(keyText)}: `;
    const valueKind = kindOf(v);

    // 空容器：单行 {} / []
    if (container && entries.length === 0) {
      const text = `${pad}${keyPrefix}${Array.isArray(v) ? "[]" : "{}"}${comma}`;
      const idx = lines.length;
      lines.push({
        path, index: idx, depth, text, kind: "scalar",
        spanStart: idx, spanEnd: idx, blockStart: idx, blockEnd: idx, valueKind, keyText,
        parentPath, index_in_parent: indexInParent, parentIsArray, foldable: false,
        valueText: Array.isArray(v) ? "[]" : "{}",
      });
      return;
    }

    // 标量：单行
    if (!container) {
      const text = `${pad}${keyPrefix}${scalarText(v)}${comma}`;
      const idx = lines.length;
      lines.push({
        path, index: idx, depth, text, kind: "scalar",
        spanStart: idx, spanEnd: idx, blockStart: idx, blockEnd: idx, valueKind, keyText,
        parentPath, index_in_parent: indexInParent, parentIsArray, foldable: false,
        valueText: toDisplayString(v),
      });
      return;
    }

    // 高效风格下的纯标量数组：整行内联
    const arr = Array.isArray(v);
    const compactInline = arr && opts.inlineScalarArrays !== false && isScalarArray(entries.map((e) => e[1]));
    if (compactInline) {
      const inner = entries.map(([, x]) => scalarText(x)).join(", ");
      const text = `${pad}${keyPrefix}[${inner}]${comma}`;
      const idx = lines.length;
      lines.push({
        path, index: idx, depth, text, kind: "inline",
        spanStart: idx, spanEnd: idx, blockStart: idx, blockEnd: idx, valueKind, keyText,
        parentPath, index_in_parent: indexInParent, parentIsArray, foldable: false,
        valueText: `Array(${entries.length})`,
      });
      return;
    }

    const open = arr ? "[" : "{";
    const close = arr ? "]" : "}";
    const summary = arr ? `Array(${entries.length})` : `Object(${entries.length})`;

    // 折叠：只占一行，内容用 ... 代替
    if (!selfExpanded) {
      const idx = lines.length;
      const text = `${pad}${keyPrefix}${open}...${close}${comma}`;
      lines.push({
        path, index: idx, depth, text, kind: "open", foldPath: path,
        spanStart: idx, spanEnd: idx, blockStart: idx, blockEnd: idx, valueKind, keyText,
        parentPath, index_in_parent: indexInParent, parentIsArray, foldable: true,
        valueText: summary,
      });
      return;
    }

    // 展开：开括号行 + 子行 + 收尾行
    const openIdx = lines.length;
    lines.push({
      path, index: openIdx, depth, text: `${pad}${keyPrefix}${open}`, kind: "open",
      spanStart: openIdx, spanEnd: openIdx, blockStart: openIdx, blockEnd: openIdx, valueKind, keyText,
      parentPath, index_in_parent: indexInParent, parentIsArray, foldable: true,
      valueText: summary,
    });

    entries.forEach(([k, child], i) => {
      const childPath = pointerOf([...parts, k]);
      // 子节点自身是否展开：自身在 expanded 集合里（且非纯标量数组内联）
      const childExpanded = opts.expanded.has(childPath);
      walk(child, [...parts, k], k, depth + 1, i === entries.length - 1, childExpanded, parts, i, arr);
    });

    const closeIdx = lines.length;
    lines.push({
      path, index: closeIdx, depth, text: `${pad}${close}${comma}`, kind: "close",
      spanStart: closeIdx, spanEnd: closeIdx, blockStart: closeIdx, blockEnd: closeIdx, valueKind, keyText,
      parentPath, index_in_parent: indexInParent, parentIsArray, foldable: true,
      valueText: summary,
    });

    // 回填本节点的区间：只有「属于本节点自己」的开/闭括号行才写本节点区间；
    // 子节点的行保留它自己的区间（悬停子节点时只高亮它那一块）。
    for (let i = openIdx; i <= closeIdx; i += 1) {
      if (lines[i].path === path) {
        lines[i].spanStart = openIdx;
        lines[i].spanEnd = closeIdx;
        lines[i].blockStart = openIdx;
        lines[i].blockEnd = closeIdx;
      }
    }
  };

  const rootExpanded = opts.expanded.has("/");
  walk(root, [], null, 0, true, rootExpanded, null, 0, false);
  return lines;
}

/**
 * 某节点**连同全部子孙**的整块行区间 —— 悬停节点树时左栏高亮的就是它。
 * 找不到（节点被折叠/内联）返回 null。
 */
export function blockOf(lines: SourceLine[], path: string): [number, number] | null {
  const hit = lines.find((l) => l.path === path);
  if (!hit) return null;
  return [hit.blockStart, hit.blockEnd];
}

/** 所有容器路径（供「展开/折叠全部」） */
export function containerPaths(root: unknown): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown, parts: (string | number)[]) => {
    if (!isContainer(v)) return;
    const entries = childEntries(v);
    if (!entries.length) return;
    set.add(pointerOf(parts));
    for (const [k, child] of entries) walk(child, [...parts, k]);
  };
  walk(root, []);
  return set;
}

/** 仅「可折叠且非内联」的容器（纯标量数组在高效风格下不可折叠） */
export function foldablePaths(root: unknown, inlineScalarArrays: boolean): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown, parts: (string | number)[]) => {
    if (!isContainer(v)) return;
    const entries = childEntries(v);
    if (!entries.length) return;
    const isArr = Array.isArray(v);
    const inlined = isArr && inlineScalarArrays && isScalarArray(entries.map((e) => e[1]));
    if (!inlined) set.add(pointerOf(parts));
    for (const [k, child] of entries) walk(child, [...parts, k]);
  };
  walk(root, []);
  return set;
}

export { isLN };
