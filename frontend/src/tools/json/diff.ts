/**
 * JSON Diff：结构化差异 + 文本行差异，双形态。
 *
 * 结构化 diff 按「对象 key 对齐」而不是按行，避免仅仅格式化不同就满屏飘红
 * （这是 JsonStudio 并排 Diff 的产品价值）；文本 diff 用 diff@9 作兜底展示。
 * 颜色语义对齐官网：绿=新增 / 红=删除 / 黄=修改。
 */
import { diffLines } from "diff";
import { toDisplayString } from "./lossless.ts";

export type DiffKind = "same" | "added" | "removed" | "changed";

export interface DiffNode {
  kind: DiffKind;
  /** 路径，如 $.users[0].name */
  path: string;
  /** 左侧值（removed / changed 有） */
  left?: unknown;
  /** 右侧值（added / changed 有） */
  right?: unknown;
  /** 展示用文本 */
  leftText?: string;
  rightText?: string;
  /** 子节点（容器类型） */
  children?: DiffNode[];
  /** 容器是否已折叠（视图层用） */
  key?: string;
}

export interface TextDiffLine {
  kind: DiffKind;
  leftNo: number | null;
  rightNo: number | null;
  text: string;
}

/** 判断是不是「可展开的容器」 */
function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  if (Array.isArray(v)) return true;
  if (!v || typeof v !== "object") return false;
  // LosslessNumber 是对象但按标量处理
  return !(Object.keys(v).length === 1 && typeof (v as { value?: unknown }).value === "string");
}

/** 取对象的 key（数组转下标字符串） */
function keysOf(v: Record<string, unknown> | unknown[]): string[] {
  return Array.isArray(v) ? v.map((_, i) => String(i)) : Object.keys(v);
}

function at(v: Record<string, unknown> | unknown[], k: string): unknown {
  return Array.isArray(v) ? v[Number(k)] : v[k];
}

function childPath(path: string, k: string, isArr: boolean): string {
  return isArr ? `${path}[${k}]` : `${path}.${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}`;
}

/** 结构化递归 diff */
export function diffValues(left: unknown, right: unknown, path = "$"): DiffNode[] {
  if (Object.is(left, right) || toDisplayString(left) === toDisplayString(right) && !isContainer(left)) {
    return [{ kind: "same", path, left, right, leftText: toDisplayString(left), rightText: toDisplayString(right) }];
  }

  if (isContainer(left) && isContainer(right)) {
    const lKeys = keysOf(left);
    const rKeys = keysOf(right);
    const all = Array.from(new Set([...lKeys, ...rKeys]));
    const isArr = Array.isArray(left) && Array.isArray(right);
    const children: DiffNode[] = [];
    for (const k of all) {
      const inL = lKeys.includes(k);
      const inR = rKeys.includes(k);
      const cp = childPath(path, k, isArr);
      if (inL && inR) {
        children.push(...diffValues(at(left, k), at(right, k), cp));
      } else if (inL) {
        const lv = at(left, k);
        children.push({ kind: "removed", path: cp, left: lv, leftText: toDisplayString(lv), key: k });
      } else {
        const rv = at(right, k);
        children.push({ kind: "added", path: cp, right: rv, rightText: toDisplayString(rv), key: k });
      }
    }
    return [{ kind: "same", path, left, right, children, key: path }];
  }

  return [
    {
      kind: "changed",
      path,
      left,
      right,
      leftText: toDisplayString(left),
      rightText: toDisplayString(right),
    },
  ];
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  same: number;
}

/** 拍平统计（容器节点不计入，只数叶子） */
export function summarize(nodes: DiffNode[]): DiffSummary {
  const s: DiffSummary = { added: 0, removed: 0, changed: 0, same: 0 };
  const walk = (list: DiffNode[]) => {
    for (const n of list) {
      if (n.children) walk(n.children);
      else s[n.kind] += 1;
    }
  };
  walk(nodes);
  return s;
}

/** 文本行 diff（并排展示用，left/right 各自带行号） */
export function diffText(left: string, right: string): { left: TextDiffLine[]; right: TextDiffLine[] } {
  const parts = diffLines(left, right);
  const leftLines: TextDiffLine[] = [];
  const rightLines: TextDiffLine[] = [];
  let ln = 1;
  let rn = 1;
  for (const p of parts) {
    const rows = p.value.replace(/\n$/, "").split("\n");
    for (const row of rows) {
      if (p.added) {
        rightLines.push({ kind: "added", leftNo: null, rightNo: rn++, text: row });
      } else if (p.removed) {
        leftLines.push({ kind: "removed", leftNo: ln++, rightNo: null, text: row });
      } else {
        leftLines.push({ kind: "same", leftNo: ln, rightNo: rn, text: row });
        rightLines.push({ kind: "same", leftNo: ln++, rightNo: rn++, text: row });
      }
    }
  }
  return { left: leftLines, right: rightLines };
}

/** 从两段文本解析 + diff，任一侧解析失败返回错误（视图层展示中文提示） */
export function diffJsonTexts(leftText: string, rightText: string, parse: (s: string) => unknown):
  | { ok: true; nodes: DiffNode[]; summary: DiffSummary }
  | { ok: false; side: "left" | "right"; error: string } {
  let l: unknown;
  let r: unknown;
  try {
    l = parse(leftText);
  } catch (e) {
    return { ok: false, side: "left", error: (e as Error).message };
  }
  try {
    r = parse(rightText);
  } catch (e) {
    return { ok: false, side: "right", error: (e as Error).message };
  }
  const nodes = diffValues(l, r);
  return { ok: true, nodes, summary: summarize(nodes) };
}
