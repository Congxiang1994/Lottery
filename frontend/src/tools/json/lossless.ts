/**
 * 大整数无损：解析 / 序列化 / 类型判断 / 安全转换。
 *
 * JS 的 number 只有 2^53-1 安全整数，接口返回的 64 位 ID（雪花算法 / 订单号）
 * 过一遍 JSON.parse 就会静默变值 —— 这是 JsonStudio 在 v1.5.0 花整版修的问题。
 * 全链路统一用 lossless-json 的 LosslessNumber，取值时统一走这里，避免某处
 * 直接 `.toJSON()` / `Number()` 提前降级。
 *
 * 统一策略：**显示串 / 编辑串**。视图展示用 toDisplayString；回写文本用
 * stringifyLossless，保证「解析 → 编辑 → 再解析」不丢精度。
 */
import { isLosslessNumber, parse, stringify } from "lossless-json";
import type { LosslessNumber } from "lossless-json";

/** 是否无损数字对象（类型守卫，供视图层 narrow） */
export function isLN(v: unknown): v is LosslessNumber {
  return isLosslessNumber(v);
}

/** 无损解析：整数超出安全范围时保留原始字面量 */
export function parseLossless(text: string): unknown {
  return parse(text);
}

/** 无损序列化：LosslessNumber 原样写回，不转 number */
export function stringifyLossless(value: unknown, indent?: number | string): string {
  return stringify(value, undefined, indent) ?? "";
}

/**
 * 把「可能是 LosslessNumber」的值转成展示字符串。
 * 普通 number 走 String()，无损数走 .value（原始字面量）。
 */
export function toDisplayString(v: unknown): string {
  if (isLN(v)) return v.value;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "bigint") return String(v);
  return JSON.stringify(v) ?? String(v);
}

/**
 * 安全取数值：仅当值在 JS 安全整数范围内返回 number，否则返回 null。
 * 用于需要真实数值的场合（统计、比较），调用方必须处理 null，不允许静默降级。
 */
export function toSafeNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) || !Number.isInteger(v) ? v : null;
  if (isLN(v)) {
    const s = v.value;
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  return typeof v === "bigint" && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : null;
}

/**
 * 判断一个字符串字面量是否「不安全整数」（用于转换 / 代码生成前的报错）。
 * 对齐 JsonStudio v1.5.0：目标格式无法安全表示时明确报错，不静默丢精度。
 */
export function isUnsafeIntegerLiteral(s: string): boolean {
  if (!/^-?\d+$/.test(s)) return false;
  // 去掉前导零后比较长度，避免对超长串直接 Number 造成 Infinity 判断失真
  const body = s.startsWith("-") ? s.slice(1) : s;
  const digits = body.replace(/^0+(?=\d)/, "");
  const max = String(Number.MAX_SAFE_INTEGER); // 9007199254740991
  if (digits.length > max.length) return true;
  if (digits.length < max.length) return false;
  return digits > max;
}

/** 递归收集值树里所有 unsafe 整数（供转换/代码生成前统一拦截） */
export function collectUnsafeIntegers(v: unknown, path = "$", out: string[] = []): string[] {
  if (isLN(v) && isUnsafeIntegerLiteral(v.value)) out.push(path);
  else if (typeof v === "bigint" && isUnsafeIntegerLiteral(String(v))) out.push(path);
  else if (Array.isArray(v)) v.forEach((x, i) => collectUnsafeIntegers(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      collectUnsafeIntegers(x, `${path}.${k}`, out);
    }
  }
  return out;
}

/**
 * 是否含「超出 JS 安全范围的整数」（用于 ParseResult.lossless 标记）。
 * ⚠️ lossless-json 把**所有**数字都表示成 LosslessNumber 对象，若按「含任意
 * LosslessNumber」判定，连 {"a":1} 都会被标成无损，语义就废了。
 * 真正需要提示用户的是「精度可能丢失」的那种值。
 */
export function hasLossless(v: unknown): boolean {
  return collectUnsafeIntegers(v).length > 0;
}
