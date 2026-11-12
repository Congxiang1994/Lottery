/**
 * JSON 查询：JMESPath / JSONPath / JSON Pointer 三种模式。
 *
 * 安全硬约束：jsonpath-plus 锁 10.3.0（<10.3.0 有 CVE-2025-1302 RCE），
 * 且**永远禁用 eval:'native'**；JMESPath 用官方 0.16.0 的 search。
 * JSON Pointer 自研（RFC 6901，含 ~0 / ~1 反转义），零依赖。
 *
 * ⚠️ 查询输入是用户可控文本，三种模式都必须 try/catch 成 QueryResult，
 * 绝不让异常穿透到视图层。
 */
import { JSONPath } from "jsonpath-plus";
import JMESPath from "jmespath";

export type QueryMode = "jsonpath" | "jmespath" | "pointer";

export interface QueryResult {
  ok: boolean;
  /** 匹配到的值列表 */
  values: unknown[];
  /** JSONPath 模式下的路径列表（与 values 对齐） */
  paths: string[];
  error?: string;
  mode: QueryMode;
  /** 耗时（ms），用于状态栏 */
  ms: number;
}

const empty = (mode: QueryMode, error?: string): QueryResult => ({
  ok: false, values: [], paths: [], error, mode, ms: 0,
});

/** RFC 6901："/a/0/b" → 值；~1 → /，~0 → ~ */
export function pointerGet(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) throw new Error("JSON Pointer 必须以 / 开头");
  let cur = value;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      if (token === "-") throw new Error("数组不支持 - 引用");
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (cur && typeof cur === "object") {
      if (!(token in (cur as Record<string, unknown>))) return undefined;
      cur = (cur as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** 从值树反查某节点路径（供 Tree 视图「复制路径」用） */
export function pathToPointer(segments: (string | number)[]): string {
  return segments
    .map((s) => "/" + String(s).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("");
}

/** 表达式完整性预检：jsonpath-plus 对残缺表达式会返回根节点而非报错 */
function incompleteJsonPath(p: string): boolean {
  const s = p.trim();
  if (!s.startsWith("$")) return true;
  // 括号配对 + 不允许以残缺符号结尾
  let depth = 0;
  let inStr = false;
  let quote = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i += 1;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === "[" || c === "(") depth += 1;
    else if (c === "]" || c === ")") depth -= 1;
    if (depth < 0) return true;
  }
  if (depth !== 0 || inStr) return true;
  return /[\[.(,?]$/.test(s);
}

export function runQuery(value: unknown, expression: string, mode: QueryMode): QueryResult {
  const t0 = Date.now();
  if (!expression.trim()) return empty(mode);
  if (mode === "jsonpath" && incompleteJsonPath(expression)) {
    return { ...empty(mode, "表达式不完整（括号/引号未闭合或以残缺符号结尾）"), ms: Date.now() - t0 };
  }
  try {
    if (mode === "pointer") {
      const v = pointerGet(value, expression.trim());
      return {
        ok: v !== undefined,
        values: v === undefined ? [] : [v],
        paths: [expression.trim()],
        error: v === undefined ? "路径不存在" : undefined,
        mode,
        ms: Date.now() - t0,
      };
    }
    if (mode === "jmespath") {
      const v = JMESPath.search(value, expression);
      return {
        ok: v !== null && v !== undefined,
        values: v === null || v === undefined ? [] : [v],
        paths: [expression],
        error: v === null || v === undefined ? "无匹配结果" : undefined,
        mode,
        ms: Date.now() - t0,
      };
    }
    // JSONPath：显式安全参数，禁止原生 eval
    const hits = JSONPath({
      path: expression,
      json: value as object,
      resultType: "all",
      eval: "safe",
      wrap: true,
    }) as { path: string; value: unknown; pointer: string }[];
    return {
      ok: hits.length > 0,
      values: hits.map((h) => h.value),
      paths: hits.map((h) => h.pointer || h.path),
      error: hits.length ? undefined : "无匹配结果",
      mode,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ...empty(mode, (e as Error).message), ms: Date.now() - t0 };
  }
}

/** 查询帮助文案（内置，避免用户去查文档） */
export const QUERY_HINTS: Record<QueryMode, { label: string; placeholder: string; examples: string[] }> = {
  jsonpath: {
    label: "JSONPath",
    placeholder: "$.users[?(@.age>18)].name",
    examples: ["$.store.book[*].author", "$..price", "$.users[0].name", "$.*[?(@.active)]"],
  },
  jmespath: {
    label: "JMESPath",
    placeholder: "users[?age > `18`].name",
    examples: ["users[].name", "length(users)", "sort_by(users, &age)[-1].name", "reservations[].instances[].state"],
  },
  pointer: {
    label: "JSON Pointer",
    placeholder: "/users/0/name",
    examples: ["/store/book/0/title", "/a~1b", "/users/-"],
  },
};
