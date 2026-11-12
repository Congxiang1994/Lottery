/**
 * Tree / Grid 视图共用的扁平节点模型。
 *
 * 把嵌套值拍成一维数组（虚拟滚动需要），每个节点带 path、depth、类型。
 * 展开状态由视图层维护（Set<string>），内核只负责「给定展开集合该显示哪些行」。
 * 复制路径、单元格回写都基于 path，保证三视图同源。
 */
import { isLN, toDisplayString, parseLossless } from "../lossless.ts";

export type ValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface FlatNode {
  path: string;
  /** 稳定的行 key */
  id: string;
  depth: number;
  key: string | number | null;
  kind: ValueKind;
  value: unknown;
  /** 展示文本 */
  text: string;
  /** 可展开（容器且非空） */
  expandable: boolean;
  expanded: boolean;
  /** 子节点数（容器） */
  childCount: number;
  /** 查询命中标记 */
  hit?: boolean;
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

/** 拼接路径片段成 JSON Pointer 风格（供复制） */
export function pointerOf(parts: (string | number)[]): string {
  return parts.map((p) => `/${String(p).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("") || "/";
}

/** 按 path 取值（回写时用） */
export function getAtPath(root: unknown, parts: (string | number)[]): unknown {
  let cur = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

/** 按 path 写值，返回新的根（不可变更新，保住 LosslessNumber） */
export function setAtPath(root: unknown, parts: (string | number)[], next: unknown): unknown {
  if (!parts.length) return next;
  const [head, ...rest] = parts;
  if (Array.isArray(root)) {
    const out = root.slice();
    out[Number(head)] = setAtPath(out[Number(head)], rest, next);
    return out;
  }
  if (root && typeof root === "object") {
    const out: Record<string, unknown> = { ...(root as Record<string, unknown>) };
    out[String(head)] = setAtPath(out[String(head)], rest, next);
    return out;
  }
  return root;
}

/** 拍平成可见行（只展开 expandable 且 id 在 expanded 集合里的节点） */
export function flatten(root: unknown, expanded: Set<string>, hits?: Set<string>): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (v: unknown, parts: (string | number)[], key: string | number | null, depth: number) => {
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
      path, id: path, depth, key, kind, value: v, text,
      expandable, expanded: isExp, childCount: entries.length,
      hit: hits?.has(path) ?? false,
    });
    if (isExp) {
      for (const [k, child] of entries) walk(child, [...parts, k], k, depth + 1);
    }
  };
  walk(root, [], null, 0);
  return out;
}

/** 首次展开：默认展开根 + 前两层容器 */
export function defaultExpanded(root: unknown, maxDepth = 2): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown, parts: (string | number)[], depth: number) => {
    if (!isContainer(v) || depth >= maxDepth) return;
    set.add(pointerOf(parts));
    for (const [k, child] of childEntries(v)) walk(child, [...parts, k], depth + 1);
  };
  walk(root, [], 0);
  return set;
}

/** 把 JSON Pointer 路径还原成可写的 key 片段数组 */
export function toEditableParts(pointer: string): (string | number)[] {
  return pointer
    .split("/")
    .filter((s) => s !== "")
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s.replace(/~1/g, "/").replace(/~0/g, "~")));
}

/** 解析用户编辑的字符串成值：数字/布尔/null 自动识别，其余为字符串 */
export function parseEdited(raw: string): unknown {
  const s = raw.trim();
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) {
    // 大整数用 LosslessNumber 保精度，不能直接 Number()
    if (/^-?\d{16,}$/.test(s)) return parseLossless(s);
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : parseLossless(s);
  }
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return raw;
}
