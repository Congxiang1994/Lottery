/**
 * 节点树数据模型：把嵌套 JSON 拍成一维「可见行」，并支持**同级重排**。
 *
 * 产品定位：右侧是一棵可折叠、可拖拽调序的节点树。
 *  - 只读值，不做值编辑（值请改左边源码）；
 *  - **拖拽仅限同一层**：换的是对象 key 的顺序 / 数组元素的顺序，
 *    不改变任何嵌套关系，因此 JSON 的语义完全不变，只是字段顺序变了。
 *
 * 展开状态由视图层维护，模型只回答「给定展开集合该显示哪些行」。
 */
import { isLN, toDisplayString } from "../lossless.ts";

export type ValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface FlatNode {
  path: string;
  depth: number;
  key: string | number | null;
  kind: ValueKind;
  value: unknown;
  text: string;
  expandable: boolean;
  expanded: boolean;
  childCount: number;
  /** 父容器路径；根节点为 null */
  parentPath: string | null;
  /** 在父容器里的序号（对象 key 按插入序、数组按下标）—— 拖拽用 */
  index_in_parent: number;
  /** 旧名，保留兼容；恒等于 index_in_parent */
  index: number;
  /** 父容器是数组时为 true —— 决定拖拽语义是「换元素顺序」 */
  parentIsArray: boolean;
}

export function kindOf(v: unknown): ValueKind {
  if (v === null) return "null";
  if (isLN(v)) return "number";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number" || typeof v === "bigint") return "number";
  return "string";
}

export function isContainer(v: unknown): boolean {
  return Array.isArray(v) || (v !== null && typeof v === "object" && !isLN(v));
}

export function childEntries(v: unknown): [string | number, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [i, x] as [number, unknown]);
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>) as [string, unknown][];
  return [];
}

/** JSON Pointer 风格路径，作为节点的稳定 id 与复制文本 */
export function pointerOf(parts: (string | number)[]): string {
  return parts.map((p) => `/${String(p).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("") || "/";
}

/** 拍平成可见行（只展开 expandable 且路径在 expanded 集合里的节点） */
export function flatten(root: unknown, expanded: Set<string>): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (
    v: unknown,
    parts: (string | number)[],
    key: string | number | null,
    depth: number,
    parentParts: (string | number)[] | null,
    index: number,
    parentIsArray: boolean,
  ) => {
    const path = pointerOf(parts);
    const kind = kindOf(v);
    const container = isContainer(v);
    const entries = container ? childEntries(v) : [];
    const expandable = container && entries.length > 0;
    const isExp = expandable && expanded.has(path);
    const text = container
      ? (Array.isArray(v) ? `Array(${entries.length})` : `Object(${entries.length})`)
      : toDisplayString(v);
    out.push({
      path, depth, key, kind, value: v, text, expandable, expanded: isExp, childCount: entries.length,
      parentPath: parentParts === null ? null : pointerOf(parentParts),
      index_in_parent: index,
      index,
      parentIsArray,
    });
    if (isExp) {
      const arr = Array.isArray(v);
      entries.forEach(([k, child], i) => walk(child, [...parts, k], k, depth + 1, parts, i, arr));
    }
  };
  walk(root, [], null, 0, null, 0, false);
  return out;
}

/* ------------------------- 同级重排（拖拽调序） ------------------------- */

/**
 * 拖拽判据只需要这几个字段 —— 定义为最小结构，
 * 让 FlatNode 与 SourceLine 都能直接传进来（两者字段命名保持一致）。
 */
export interface SiblingLike {
  path: string;
  parentPath: string | null;
  /** 在父容器里的序号（不是行号！） */
  index_in_parent: number;
  parentIsArray?: boolean;
}

/** 同级移动的合法性：必须同父、且不是根节点本身 */
export interface MoveCheck {
  ok: boolean;
  reason?: string;
  /** 目标位置（移动后该节点在父容器里的新下标） */
  toIndex?: number;
}

/**
 * 判断能否把 from 拖到目标位置。
 *
 * 约束（用户要求「只允许同一层」）：
 *  - 必须同父容器（parentPath 相同）；
 *  - 根节点不可拖（没有同级）；
 *  - toIndex 是**插入位**语义：把节点从原位置摘下后，插入到兄弟数组的第 toIndex 个位置。
 *
 * @param nodes    当前扁平行（含 parentPath / index）
 * @param fromPath 被拖节点路径
 * @param toIndex  目标插入位（0..兄弟数，含末尾）
 */
export function canMoveSibling(nodes: SiblingLike[], fromPath: string, toIndex: number): MoveCheck {
  const from = nodes.find((n) => n.path === fromPath);
  if (!from) return { ok: false, reason: "找不到被拖动的节点" };
  if (from.parentPath === null) return { ok: false, reason: "根节点没有同级，无法排序" };
  const siblings = nodes.filter((n) => n.parentPath === from.parentPath);
  if (toIndex < 0 || toIndex > siblings.length) return { ok: false, reason: "目标位置越界" };
  // 摘下后插入：原位置在插入位之前，实际下标会前移一位
  const cur = from.index_in_parent;
  const insertAt = toIndex > cur ? toIndex - 1 : toIndex;
  if (insertAt === cur) return { ok: false, reason: "位置没有变化" };
  return { ok: true, toIndex: insertAt };
}

/**
 * 判断「从 fromPath 拖到 targetPath 的位置」是否合法 —— 这是拖拽落点的真实判据。
 * 只有**同一父容器**的两个节点之间才允许换位（用户要求「只允许同一层」），
 * 跨层级一律拒绝，避免把字段拖进别的对象、改变 JSON 结构。
 */
export function canDropOn(nodes: SiblingLike[], fromPath: string, targetPath: string): MoveCheck {
  const from = nodes.find((n) => n.path === fromPath);
  const target = nodes.find((n) => n.path === targetPath);
  if (!from || !target) return { ok: false, reason: "节点不存在" };
  if (from.parentPath === null) return { ok: false, reason: "根节点没有同级，无法排序" };
  if (from.path === target.path) return { ok: false, reason: "不能拖到自己身上" };
  if (from.parentPath !== target.parentPath) {
    return { ok: false, reason: "只能在同一层级内调序" };
  }
  return { ok: true };
}

/**
 * 在值树里把某个子节点从 fromIndex 移到 toIndex（**同一父容器内**）。
 *
 * 返回新根（不可变更新）。对象走「键序重排」，数组走「元素重排」，
 * 二者都不改嵌套关系，因此 JSON 语义不变。
 */
export function moveSibling(
  root: unknown,
  parentPath: string,
  fromIndex: number,
  toIndex: number,
): unknown {
  const parentParts = parsePointer(parentPath);
  const parent = getByParts(root, parentParts);
  if (parent === undefined) return root;

  if (Array.isArray(parent)) {
    if (fromIndex < 0 || fromIndex >= parent.length) return root;
    if (toIndex < 0 || toIndex >= parent.length) return root;
    const next = parent.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return setByParts(root, parentParts, next);
  }

  if (parent && typeof parent === "object" && !isLN(parent)) {
    const entries = Object.entries(parent as Record<string, unknown>);
    if (fromIndex < 0 || fromIndex >= entries.length) return root;
    if (toIndex < 0 || toIndex >= entries.length) return root;
    const next = entries.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    // 用普通对象重建：键的插入顺序就是显示顺序
    const rebuilt: Record<string, unknown> = {};
    for (const [k, v] of next) rebuilt[k] = v;
    return setByParts(root, parentParts, rebuilt);
  }

  return root;
}

/** JSON Pointer → key 片段（注意 ~1 / ~0 反转义） */
export function parsePointer(pointer: string): (string | number)[] {
  if (!pointer || pointer === "/") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

function getByParts(root: unknown, parts: (string | number)[]): unknown {
  let cur = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

function setByParts(root: unknown, parts: (string | number)[], next: unknown): unknown {
  if (!parts.length) return next;
  const [head, ...rest] = parts;
  if (Array.isArray(root)) {
    const out = root.slice();
    out[Number(head)] = setByParts(out[Number(head)], rest, next);
    return out;
  }
  if (root && typeof root === "object") {
    const out: Record<string, unknown> = { ...(root as Record<string, unknown>) };
    out[String(head)] = setByParts(out[String(head)], rest, next);
    return out;
  }
  return root;
}

/** 默认展开根 + 前两层容器；返回所有可展开路径（供「展开全部」用） */
export function allExpandablePaths(root: unknown): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown, parts: (string | number)[]) => {
    if (!isContainer(v)) return;
    if (childEntries(v).length) set.add(pointerOf(parts));
    for (const [k, child] of childEntries(v)) walk(child, [...parts, k]);
  };
  walk(root, []);
  return set;
}

export function defaultExpanded(root: unknown, maxDepth = 2): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown, parts: (string | number)[], depth: number) => {
    if (!isContainer(v) || depth >= maxDepth) return;
    if (childEntries(v).length) set.add(pointerOf(parts));
    for (const [k, child] of childEntries(v)) walk(child, [...parts, k], depth + 1);
  };
  walk(root, [], 0);
  return set;
}
