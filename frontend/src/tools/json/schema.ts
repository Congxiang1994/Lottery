/**
 * JSON Schema 生成 + 校验（纯函数）。
 *
 * 生成：**自研推断**（不用 genson-js）。两个实测原因：
 *  ① genson-js 把 lossless-json 的 LosslessNumber 当普通对象，会生成
 *     `{value:{type:"string"},isLosslessNumber:{type:"boolean"}}` 这种错误 schema；
 *  ② genson-js 用普通对象收集 properties，`__proto__` 这类特殊键名会静默丢失。
 * 自研版本统一走「值类型判定 + Object.defineProperty 收集」，既认大整数，
 * 又保特殊键名，还省掉一个依赖。
 *
 * 校验：@cfworker/json-schema（纯 ESM、无 eval、无 Node 内置、多 draft）。
 *  不用 ajv 的理由见方案：默认 new Function 编译在严格 CSP 下会挂，且体积 5 倍。
 *
 * ⚠️ 远程 $schema（HTTPS）默认**不加载**：浏览器 CORS 拿不到，属于桌面能力，
 *   需要的话走后端代理端点，不在纯函数层做网络请求。
 */
import { Validator } from "@cfworker/json-schema";
import { isLN, collectUnsafeIntegers } from "./lossless.ts";
import type { ParseError } from "./types.ts";

export interface SchemaIssue {
  /** JSON Pointer 风格位置，如 /users/0/age */
  instanceLocation: string;
  keywordLocation: string;
  keyword: string;
  message: string;
  /** 尽量解析出的行列（从 instanceLocation 反推失败时为 0） */
  line: number;
  col: number;
}

export interface SchemaValidateResult {
  ok: boolean;
  issues: SchemaIssue[];
  error?: string;
}

/* ------------------------- 生成 ------------------------- */

/** 判定值的 schema 类型（LosslessNumber 按字面量区分 integer / number） */
function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (isLN(v)) return /^-?\d+$/.test(v.value) ? "integer" : "number";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "bigint") return "integer";
  return "string";
}

/** 单个值 → schema 片段；用 defineProperty 接住 __proto__ 等特殊键 */
function schemaOf(v: unknown): Record<string, unknown> {
  const t = typeOf(v);
  if (t === "object") {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      Object.defineProperty(props, k, {
        value: schemaOf(x), enumerable: true, writable: true, configurable: true,
      });
      required.push(k);
    }
    const out: Record<string, unknown> = { type: "object", properties: props };
    if (required.length) out.required = required;
    return out;
  }
  if (t === "array") {
    const arr = v as unknown[];
    if (!arr.length) return { type: "array", items: {} };
    // 合并所有元素类型：同类合并，缺字段标非 required
    const merged = mergeArrayItems(arr);
    return { type: "array", items: merged };
  }
  return { type: t };
}

/** 数组元素 schema 合并：取类型并集、属性并集、required 交集 */
function mergeArrayItems(arr: unknown[]): Record<string, unknown> {
  const parts = arr.map(schemaOf);
  const types = Array.from(new Set(parts.map((p) => String(p.type))));
  const type = types.length === 1 ? types[0] : types;
  if (types.every((x) => x === "object")) {
    const props: Record<string, unknown> = {};
    const counts = new Map<string, number>();
    for (const p of parts) {
      for (const [k, v] of Object.entries(p.properties as Record<string, unknown>)) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) props[k] = v;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const required = [...counts.entries()].filter(([, c]) => c === arr.length).map(([k]) => k);
    const out: Record<string, unknown> = { type: "object", properties: props };
    if (required.length) out.required = required;
    return out;
  }
  const out: Record<string, unknown> = { type };
  if (types.every((x) => x === "array")) out.items = { type: parts[0].items };
  return out;
}

/** 合并多份 schema（多样本生成用：属性取并集、required 取交集） */
function mergeSchemas(schemas: Record<string, unknown>[]): Record<string, unknown> {
  if (schemas.length === 1) return schemas[0];
  const types = Array.from(new Set(schemas.map((s) => String(s.type))));
  const type = types.length === 1 ? types[0] : types;
  if (types.every((x) => x === "object")) {
    const props: Record<string, unknown> = {};
    const counts = new Map<string, number>();
    for (const s of schemas) {
      for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, unknown>)) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) props[k] = v;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const required = [...counts.entries()].filter(([, c]) => c === schemas.length).map(([k]) => k);
    const out: Record<string, unknown> = { type: "object", properties: props };
    if (required.length) out.required = required;
    return out;
  }
  return { type };
}

/** 从值生成 Draft 7 Schema；samples 为额外样本（字段取并集） */
export function generateSchema(value: unknown, samples: unknown[] = []): Record<string, unknown> {
  const all = [value, ...samples].map(schemaOf);
  const merged = mergeSchemas(all);
  merged.$schema = "http://json-schema.org/draft-07/schema#";
  return merged;
}

/** 把 unsafe 整数路径转成校验前的明确报错（对齐 JsonStudio v1.5.0） */
export function checkSchemaSafety(value: unknown, _schema: Record<string, unknown>): string[] {
  return collectUnsafeIntegers(value);
}

/* ------------------------- 校验 ------------------------- */

function toIssues(raw: unknown): SchemaIssue[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((e) => {
    const err = e as Record<string, unknown>;
    return {
      instanceLocation: String(err.instanceLocation ?? ""),
      keywordLocation: String(err.keywordLocation ?? ""),
      keyword: String(err.keyword ?? ""),
      message: String(err.error ?? err.message ?? "校验失败"),
      line: 0,
      col: 0,
    };
  });
}

/** 校验：schema 文本 + 数据值 */
export function validateSchema(value: unknown, schemaText: string): SchemaValidateResult {
  let schema: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch (e) {
    return { ok: false, issues: [], error: `Schema 不是合法 JSON：${(e as Error).message}` };
  }
  try {
    const v = new Validator(schema as never);
    const r = v.validate(prepareForValidation(value));
    return { ok: r.valid === true, issues: r.valid ? [] : toIssues(r.errors) };
  } catch (e) {
    return { ok: false, issues: [], error: `Schema 校验器初始化失败：${(e as Error).message}` };
  }
}

/**
 * 把校验错误映射到文本的行列（尽力而为）：
 * 用 instanceLocation 的最后一个 token 在源文本里找 key，定位到首次出现处。
 */
export function locateIssues(issues: SchemaIssue[], text: string): SchemaIssue[] {
  return issues.map((it) => {
    const tokens = it.instanceLocation.split("/").filter(Boolean);
    const last = tokens[tokens.length - 1];
    if (!last) return it;
    const needle = /^\d+$/.test(last) ? null : `"${last.replace(/~1/g, "/").replace(/~0/g, "~")}"`;
    const idx = needle ? text.indexOf(needle) : -1;
    if (idx < 0) return it;
    const before = text.slice(0, idx);
    return { ...it, line: before.split("\n").length, col: idx - before.lastIndexOf("\n") };
  });
}

/** 供 UI 把校验错误转成 ParseError 风格的中文提示 */
export function issueToParseError(issue: SchemaIssue): ParseError {
  return {
    message: `${issue.message}（${issue.instanceLocation || "/"}）`,
    line: issue.line,
    col: issue.col,
    pos: -1,
  };
}

/** LosslessNumber 在校验前转为字符串字面量（不降级精度） */
export function prepareForValidation(v: unknown): unknown {
  if (isLN(v)) return v.value;
  if (Array.isArray(v)) return v.map(prepareForValidation);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = prepareForValidation(x);
    return out;
  }
  return v;
}
