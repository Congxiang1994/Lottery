/**
 * 节点树数据模型：把嵌套 JSON 拍成一维「可见行」。
 *
 * 产品定位：右侧是一棵**只读、可折叠**的节点树，用来快速看结构；
 * 不做编辑、不回写源码（源码是唯一真源，改值请直接在左边改）。
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
    out.push({ path, depth, key, kind, value: v, text, expandable, expanded: isExp, childCount: entries.length });
    if (isExp) for (const [k, child] of entries) walk(child, [...parts, k], k, depth + 1);
  };
  walk(root, [], null, 0);
  return out;
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
