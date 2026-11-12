/**
 * 类型代码生成：JSON → TypeScript / Go / Python / Java / Rust。
 *
 * 方案里刻意**不引 quicktype-core**（312 KB gzip + Vite 下 node:fs 坑），
 * 改为「schema 推断 + 模板渲染」两层：先合成一张类型表，再按语言渲染。
 * 覆盖官网明确列出的产物形态：TS 接口+可选字段、Go 结构体+json 标签、
 * Rust 结构体+serde、Python 数据类+类型提示+默认值、Java 类+getter/setter+Jackson。
 *
 * 边界（对齐 JsonStudio v1.5.0）：目标语言无法安全表示大整数时**明确报错**，
 * 不静默降级。嵌套对象→嵌套类型；数组元素类型合并；同类多样本字段取并集并标可选。
 */
import { isLN, toDisplayString, collectUnsafeIntegers } from "./lossless.ts";

export type CodeLang = "ts" | "go" | "python" | "java" | "rust";

export const CODE_LANGS: { key: CodeLang; label: string; ext: string }[] = [
  { key: "ts", label: "TypeScript", ext: "ts" },
  { key: "go", label: "Go", ext: "go" },
  { key: "python", label: "Python", ext: "py" },
  { key: "java", label: "Java", ext: "java" },
  { key: "rust", label: "Rust", ext: "rs" },
];

/* ------------------------- 类型推断 ------------------------- */

type Prim = "string" | "number" | "integer" | "boolean" | "null" | "unknown";

interface Field {
  name: string;
  types: Set<Prim | string>; // string 值 = 引用类型名
  optional: boolean;
  unsafe?: boolean;
}

interface TypeDef {
  name: string;
  fields: Field[];
  isArrayRoot?: boolean;
}

const RESERVED: Record<CodeLang, Set<string>> = {
  ts: new Set(["class", "interface", "type", "enum", "function", "const", "let", "var", "default", "export", "import", "null", "true", "false"]),
  go: new Set(["type", "struct", "func", "var", "const", "package", "import", "map", "range", "interface", "chan", "go", "defer"]),
  python: new Set(["class", "def", "from", "import", "return", "if", "else", "for", "while", "None", "True", "False", "lambda", "pass", "global"]),
  java: new Set(["class", "interface", "enum", "public", "private", "static", "final", "void", "int", "long", "double", "boolean", "return", "new", "package", "import"]),
  rust: new Set(["struct", "enum", "impl", "fn", "let", "mut", "pub", "use", "mod", "match", "type", "trait", "self", "Self", "crate"]),
};

function isPrim(t: string): t is Prim {
  return ["string", "number", "integer", "boolean", "null", "unknown"].includes(t);
}

function primOf(v: unknown): Prim | "array" | "object" {
  if (v === null) return "null";
  if (isLN(v)) return /^-?\d+$/.test(v.value) ? "integer" : "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "bigint") return "integer";
  if (Array.isArray(v)) return "array";
  return "object";
}

/** 把任意 key 转成各语言合法标识符 */
function ident(name: string, lang: CodeLang): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_$]/g, "_")
    .replace(/^(\d)/, "_$1")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
  const reserved = RESERVED[lang];
  return reserved.has(cleaned) ? `${cleaned}_` : cleaned;
}

function pascal(s: string): string {
  const w = s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return (w.length ? w : ["Root"]).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join("");
}

function snake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "") || "field";
}

/** 合并多份样本，推断出类型表 */
function infer(value: unknown, rootName = "Root", table: Map<string, TypeDef> = new Map()): string {
  const kind = primOf(value);
  if (kind === "object") {
    const fields: Field[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const t = infer(v, pascal(k), table);
      fields.push({ name: k, types: new Set([t]), optional: false });
    }
    const name = uniqueName(rootName, table);
    table.set(name, { name, fields });
    return name;
  }
  if (kind === "array") {
    const arr = value as unknown[];
    if (!arr.length) return "unknown[]";
    // 合并所有元素：对象数组取字段并集，缺失字段标 optional
    const merged = arr.reduce<Record<string, { types: Set<string>; count: number }>>((acc, item) => {
      if (primOf(item) === "object") {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (!acc[k]) acc[k] = { types: new Set(), count: 0 };
          acc[k].types.add(infer(v, pascal(k), table));
          acc[k].count += 1;
        }
      }
      return acc;
    }, {});
    const keys = Object.keys(merged);
    if (!keys.length) {
      const types = new Set(arr.map((x) => inferScalar(x)));
      return `${[...types].join(" | ")}[]`;
    }
    const name = uniqueName(rootName + "Item", table);
    const fields: Field[] = keys.map((k) => ({
      name: k,
      types: merged[k].types,
      optional: merged[k].count < arr.length,
    }));
    table.set(name, { name, fields });
    return `${name}[]`;
  }
  return inferScalar(value);
}

function inferScalar(v: unknown): string {
  const k = primOf(v);
  if (k === "null") return "null";
  if (k === "array" || k === "object") return "unknown";
  return k;
}

function uniqueName(base: string, table: Map<string, TypeDef>): string {
  let n = pascal(base);
  let i = 2;
  while (table.has(n)) n = `${pascal(base)}${i++}`;
  return n;
}

/* ------------------------- 各语言类型映射 ------------------------- */

function mapType(types: Set<string>, lang: CodeLang, optional: boolean): string {
  const parts = [...types].map((t) => mapOne(t, lang));
  let out: string;
  if (parts.length === 1) out = parts[0];
  else if (lang === "ts" || lang === "rust") out = parts.join(" | ");
  else if (lang === "python") out = parts.includes("None") ? `Optional[${parts.filter((p) => p !== "None").join(" | ") || "Any"}]` : `Union[${parts.join(", ")}]`;
  else out = parts[0]; // Go / Java 无联合类型，取第一个并注释
  if (optional && lang === "ts") return `${out} | undefined`;
  return out;
}

function mapOne(t: string, lang: CodeLang): string {
  if (t.endsWith("[]")) return mapArray(mapOne(t.slice(0, -2), lang), lang);
  if (isPrim(t)) return mapPrim(t, lang);
  return t; // 引用类型
}

function mapArray(inner: string, lang: CodeLang): string {
  switch (lang) {
    case "ts": return `${inner}[]`;
    case "go": return `[]${inner}`;
    case "python": return `list[${inner}]`;
    case "java": return `List<${inner === "int" ? "Integer" : inner === "double" ? "Double" : inner === "boolean" ? "Boolean" : inner}>`;
    case "rust": return `Vec<${inner}>`;
  }
}

function mapPrim(p: Prim, lang: CodeLang): string {
  switch (lang) {
    case "ts": return p === "integer" || p === "number" ? "number" : p === "null" ? "null" : p === "unknown" ? "unknown" : p;
    case "go": return p === "integer" ? "int64" : p === "number" ? "float64" : p === "boolean" ? "bool" : p === "null" || p === "unknown" ? "interface{}" : "string";
    case "python": return p === "integer" ? "int" : p === "number" ? "float" : p === "boolean" ? "bool" : p === "null" ? "None" : p === "unknown" ? "Any" : "str";
    case "java": return p === "integer" ? "Long" : p === "number" ? "Double" : p === "boolean" ? "Boolean" : p === "null" || p === "unknown" ? "Object" : "String";
    case "rust": return p === "integer" ? "i64" : p === "number" ? "f64" : p === "boolean" ? "bool" : p === "null" || p === "unknown" ? "serde_json::Value" : "String";
  }
}

/* ------------------------- 渲染 ------------------------- */

export interface CodegenResult {
  ok: boolean;
  code: string;
  lang: CodeLang;
  /** 大整数无法安全表示时的明确报错 */
  error?: string;
}

export function generateCode(value: unknown, lang: CodeLang, rootName = "Root"): CodegenResult {
  const unsafe = collectUnsafeIntegers(value);
  if (unsafe.length) {
    // Go int64 / Java Long / Rust i64 / Python int 能表示；TS number 不能
    if (lang === "ts") {
      return {
        ok: false, lang, code: "",
        error: `源数据含超出 JS 安全范围的整数（${unsafe.slice(0, 3).join("、")}${unsafe.length > 3 ? ` 等 ${unsafe.length} 处` : ""}）。TypeScript 的 number 无法安全表示，请改用 string 或 bigint，或切换到 Go/Java/Rust/Python。`,
      };
    }
  }
  const table = new Map<string, TypeDef>();
  const rootType = infer(value, rootName, table);
  const defs = [...table.values()];
  let code = "";
  switch (lang) {
    case "ts": code = renderTs(defs, rootType); break;
    case "go": code = renderGo(defs, rootType); break;
    case "python": code = renderPython(defs, rootType); break;
    case "java": code = renderJava(defs, rootType); break;
    case "rust": code = renderRust(defs, rootType); break;
  }
  return { ok: true, code, lang };
}

function renderTs(defs: TypeDef[], root: string): string {
  const out: string[] = ["// 由 JSON 自动生成 · 字段顺序与原始数据一致", ""];
  for (const d of defs) {
    out.push(`export interface ${d.name} {`);
    for (const f of d.fields) {
      const t = mapType(f.types, "ts", f.optional);
      out.push(`  ${ident(f.name, "ts")}${f.optional ? "?" : ""}: ${t};`);
    }
    out.push("}", "");
  }
  out.push(`// 根类型：${root}`);
  return out.join("\n");
}

function renderGo(defs: TypeDef[], root: string): string {
  const out: string[] = ["package main", "", 'import "encoding/json"', "", "// 由 JSON 自动生成", ""];
  for (const d of defs) {
    out.push(`type ${d.name} struct {`);
    for (const f of d.fields) {
      const t = mapType(f.types, "go", f.optional);
      out.push(`\t${pascal(ident(f.name, "go"))} ${t} \`json:"${f.name}${f.optional ? ",omitempty" : ""}"\``);
    }
    out.push("}", "");
  }
  out.push(`// 根类型：${root}`);
  return out.join("\n");
}

function renderPython(defs: TypeDef[], root: string): string {
  const out: string[] = [
    "from __future__ import annotations", "",
    "from dataclasses import dataclass, field", "from typing import Any, Optional, Union, List", "",
    "# 由 JSON 自动生成", "",
  ];
  for (const d of defs) {
    out.push("@dataclass", `class ${d.name}:`);
    if (!d.fields.length) out.push("    pass");
    for (const f of d.fields) {
      const t = mapType(f.types, "python", f.optional);
      const defaultVal = f.optional ? " = None" : ` = field(default_factory=lambda: ${dflt(t)})`;
      out.push(`    ${snake(ident(f.name, "python"))}: ${t}${defaultVal}`);
    }
    out.push("");
  }
  out.push(`# 根类型：${root}`);
  return out.join("\n");
}

function dflt(t: string): string {
  if (t.startsWith("list[")) return "list";
  if (t === "str") return '""';
  if (t === "int") return "0";
  if (t === "float") return "0.0";
  if (t === "bool") return "False";
  return "None";
}

function renderJava(defs: TypeDef[], root: string): string {
  const out: string[] = [
    "import com.fasterxml.jackson.annotation.JsonProperty;", "import java.util.List;", "",
    "// 由 JSON 自动生成", "",
  ];
  for (const d of defs) {
    out.push(`public class ${d.name} {`);
    for (const f of d.fields) {
      const t = mapType(f.types, "java", f.optional);
      const name = ident(f.name, "java");
      out.push(`    @JsonProperty("${f.name}")`);
      out.push(`    private ${t} ${name};`);
      out.push("");
      out.push(`    public ${t} get${pascal(name)}() { return this.${name}; }`);
      out.push(`    public void set${pascal(name)}(${t} ${name}) { this.${name} = ${name}; }`);
      out.push("");
    }
    out.push("}", "");
  }
  out.push(`// 根类型：${root}`);
  return out.join("\n");
}

function renderRust(defs: TypeDef[], root: string): string {
  const out: string[] = [
    "use serde::{Deserialize, Serialize};", "use serde_json::Value;", "",
    "// 由 JSON 自动生成", "",
  ];
  for (const d of defs) {
    out.push("#[derive(Debug, Clone, Serialize, Deserialize)]", `pub struct ${d.name} {`);
    for (const f of d.fields) {
      const t = mapType(f.types, "rust", f.optional);
      const name = snake(ident(f.name, "rust"));
      const attr = name !== f.name ? `    #[serde(rename = "${f.name}")]\n` : "";
      out.push(`${attr}    pub ${name}: ${f.optional ? `Option<${t}>` : t},`);
    }
    out.push("}", "");
  }
  out.push(`// 根类型：${root}`);
  return out.join("\n");
}

/* ------------------------- 反向提取（尽力而为） ------------------------- */

/**
 * 从 TS interface / Go struct / Rust struct 代码片段提取 JSON 骨架。
 * JsonStudio 用 Tree-sitter AST 才做全，这里只做**有限子集**并明确标注：
 * 识别 `name: type` / `name type \`json:"..."\`` / `pub name: type` 行，
 * 类型映射回样例值。不承诺完整正确。
 */
export function extractFromCode(code: string, lang: CodeLang): { ok: boolean; value?: unknown; warning: string } {
  const warning = "反向提取为尽力而为（有限子集），不保证覆盖嵌套/泛型/注释，请人工核对。";
  try {
    const out: Record<string, unknown> = {};
    const lines = code.split("\n");
    for (const line of lines) {
      const s = line.trim().replace(/[,;]+$/, "");
      let m: RegExpMatchArray | null = null;
      if (lang === "ts") m = s.match(/^(\w+)\??:\s*([A-Za-z0-9_[\] |<>]+)/);
      else if (lang === "go") m = s.match(/^(\w+)\s+([^\s`]+)/);
      else if (lang === "rust") m = s.match(/^pub\s+(\w+):\s*([A-Za-z0-9_:<> ,]+)/);
      else if (lang === "java") m = s.match(/^private\s+\S+\s+(\w+)\s*;/);
      else if (lang === "python") m = s.match(/^(\w+):\s*([A-Za-z0-9_[\] ,]+)/);
      if (!m) continue;
      const key = m[1];
      const t = (m[2] || "").toLowerCase();
      out[key] = sampleForType(t);
    }
    return Object.keys(out).length ? { ok: true, value: out, warning } : { ok: false, warning: `${warning} 未识别到任何字段。` };
  } catch (e) {
    return { ok: false, warning: `${warning} 解析异常：${(e as Error).message}` };
  }
}

function sampleForType(t: string): unknown {
  if (/string|str/.test(t)) return "string";
  if (/bool/.test(t)) return true;
  if (/int|long|i64|float|double|f64|number/.test(t)) return 0;
  if (/\[\]|list|vec|array/.test(t)) return [];
  if (/any|unknown|object|value|interface|option/.test(t)) return null;
  return null;
}

/** 把字符串值安全转成展示串（复用内核统一策略） */
export function codeDisplay(v: unknown): string {
  return toDisplayString(v);
}
