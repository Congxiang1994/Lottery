/**
 * 格式化 / 压缩 / 键名排序 / 键名风格转换。
 *
 * 关键约定：
 *  - **默认保留对象 key 原始顺序**（对齐 JsonStudio v1.2.0），排序是显式选项；
 *  - **纯标量数组内联**：`["a","b","c"]` / `[1,2,3]` 这类「无嵌套」数组不拆成
 *    多行，压在一行里更好读（这是本工具相对 JSON.stringify 的主要差异点）；
 *  - 格式化走**自己的序列化器**而非 JSON.stringify：要保住 LosslessNumber 的
 *    大整数字面量，JSON.stringify 会把它降级甚至输出 `{"value":"..."}`。
 */
import { parseLossless, stringifyLossless, isLN, toDisplayString } from "./lossless.ts";

export type Indent = 2 | 4 | "tab";

/** 递归按 key 排序（仅对象，数组顺序保持；键名用 localeCompare 的稳定序） */
export function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    // ⚠️ LosslessNumber 是带 value/isLosslessNumber 两个可枚举 key 的对象，
    //    必须原样返回，否则会被拆成 {"isLosslessNumber":true,"value":"2"}
    if (isLN(v)) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort((a, b) => a.localeCompare(b))) {
      out[k] = sortDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/* ------------------------- 美化序列化器 ------------------------- */

/** 标量（含 LosslessNumber）→ JSON 字面量文本 */
function scalarText(v: unknown): string {
  if (v === null) return "null";
  if (isLN(v)) return v.value; // 大整数原样写回，绝不 Number()
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "bigint") return String(v);
  return JSON.stringify(toDisplayString(v));
}

/** 数组里全是标量（无对象/数组/LosslessNumber 之外的东西） */
function isScalarArray(v: unknown[]): boolean {
  return v.every((x) => x === null || isLN(x) || typeof x !== "object");
}

export interface PrettyOptions {
  indent?: Indent;
  /** 纯标量数组是否内联成一行（默认 true） */
  inlineScalarArrays?: boolean;
  /** 内联后单行超过这个宽度就退回多行展开（默认 76，接近主流格式化器） */
  maxInlineWidth?: number;
}

/**
 * 格式化风格：
 *  - ``standard`` 传统展开：每个元素一行，与 JSON.stringify(v, null, n) 一致；
 *  - ``compact``  高效展开：纯标量数组内联成一行（`["a","b"]`、`[1,2,3]`），
 *    对象数组仍然展开 —— 这才是日常查阅最舒服的形态。
 */
export type FmtStyle = "standard" | "compact";

export function styleToInline(style: FmtStyle): boolean {
  return style === "compact";
}

/**
 * 把值美化成文本。
 *
 * 规则（自顶向下递归）：
 *  - 对象 / 数组：`{` `[` 换行 + 缩进 + 子项 + 收尾括号；
 *  - **纯标量数组内联**（仅 compact 风格）：`["a","b"]`、`[1,2,3]` 一行输出；
 *  - 空容器输出 `{}` / `[]`，不展开成三行；
 *  - 标量走 scalarText，LosslessNumber 保原字面量。
 */
export function prettyJson(value: unknown, opts: PrettyOptions = {}): string {
  // 默认「不内联」：直接调 prettyJson 时不带风格参数，行为应与 JSON.stringify 一致，
  // 要内联必须显式 inlineScalarArrays: true（formatJson 会按 style 传进来）。
  const { indent = 2, inlineScalarArrays = false, maxInlineWidth = 76 } = opts;
  const unit = indent === "tab" ? "\t" : " ".repeat(indent);

  const isEmptyObj = (v: Record<string, unknown>) => Object.keys(v).length === 0;

  const render = (v: unknown, depth: number): string => {
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      if (inlineScalarArrays && isScalarArray(v)) {
        const oneLine = `[${v.map(scalarText).join(", ")}]`;
        // 单行过长（或含换行的长字符串）就退回多行，避免撑破版面
        if (!oneLine.includes("\n") && depth * unit.length + oneLine.length <= maxInlineWidth) {
          return oneLine;
        }
      }
      const pad = unit.repeat(depth + 1);
      const body = v.map((x) => pad + render(x, depth + 1)).join(",\n");
      return `[\n${body}\n${unit.repeat(depth)}]`;
    }

    if (v && typeof v === "object" && !isLN(v)) {
      const obj = v as Record<string, unknown>;
      if (isEmptyObj(obj)) return "{}";
      const pad = unit.repeat(depth + 1);
      const entries = Object.entries(obj).map(
        ([k, x]) => `${pad}${JSON.stringify(k)}: ${render(x, depth + 1)}`,
      );
      return `{\n${entries.join(",\n")}\n${unit.repeat(depth)}}`;
    }

    return scalarText(v);
  };

  return render(value, 0);
}

/** 把任意文本格式化（解析失败抛错，由调用方走错误展示） */
export function formatJson(
  text: string,
  indent: Indent = 2,
  sortKeys = false,
  style: FmtStyle = "standard",
): string {
  const value = parseLossless(text);
  const v = sortKeys ? sortDeep(value) : value;
  return prettyJson(v, { indent, inlineScalarArrays: styleToInline(style) });
}

export function minifyJson(text: string): string {
  return stringifyLossless(parseLossless(text));
}

/* ------------------------- 键名风格：snake ↔ camel ------------------------- */

/** 拆成词：先按非字母数字切开，再把 camelCase 的驼峰边界切开 */
function words(key: string): string[] {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return parts.length ? parts : [key];
}

export function toCamel(key: string): string {
  const lead = key.match(/^_+/)?.[0] ?? "";
  const trail = key.match(/_+$/)?.[0] ?? "";
  const ws = words(key);
  return (
    lead +
    ws
      .map((w, i) =>
        i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join("") +
    trail
  );
}

export function toSnake(key: string): string {
  const lead = key.match(/^_+/)?.[0] ?? "";
  const trail = key.match(/_+$/)?.[0] ?? "";
  return lead + words(key).map((w) => w.toLowerCase()).join("_") + trail;
}

export type KeyCase = "snake" | "camel";

/** 递归转换所有对象 key（数组元素递归，标量不动） */
export function convertKeys(v: unknown, target: KeyCase): unknown {
  if (Array.isArray(v)) return v.map((x) => convertKeys(x, target));
  if (v && typeof v === "object") {
    if (isLN(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[target === "camel" ? toCamel(k) : toSnake(k)] = convertKeys(x, target);
    }
    return out;
  }
  return v;
}

/**
 * 检测当前文本更接近哪种风格，用于 UI 决定按钮文案（「转驼峰」还是「转下划线」）。
 * 只看第一层对象 key，够用且便宜。
 */
export function detectKeyCase(text: string): KeyCase {
  try {
    const v = parseLossless(text);
    const keys = v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [];
    let snake = 0;
    let camel = 0;
    for (const k of keys) {
      if (/_[a-z]/.test(k)) snake += 1;
      if (/[a-z][A-Z]/.test(k)) camel += 1;
    }
    return camel > snake ? "camel" : "snake";
  } catch {
    return "snake";
  }
}
