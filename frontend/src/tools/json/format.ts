/**
 * 格式化 / 压缩 / 键名排序 / 键名风格转换。
 *
 * 关键约定（对齐 JsonStudio v1.2.0 修复）：**默认保留对象 key 原始顺序**，
 * 排序是显式选项；格式化走无损序列化，绝不把 LosslessNumber 降级成 number。
 */
import { parseLossless, stringifyLossless, isLN } from "./lossless.ts";

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

/** 把任意文本格式化（解析失败抛错，由调用方走错误展示） */
export function formatJson(text: string, indent: Indent = 2, sortKeys = false): string {
  const value = parseLossless(text);
  const v = sortKeys ? sortDeep(value) : value;
  const space = indent === "tab" ? "\t" : indent;
  return stringifyLossless(v, space);
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
