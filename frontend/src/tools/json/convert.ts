/**
 * 格式转换：JSON ↔ YAML / XML / TOML / CSV / Properties / INI / Markdown Table。
 *
 * 产品约定（方案 §2.5，对齐 JsonStudio v1.4.0/v1.5.0）：
 *  - **XML / CSV 是「有损」转换**，UI 必须明示；
 *  - 目标格式无法安全表示大整数 / 类型时**明确报错**，不静默降级；
 *  - CSV 限定「对象数组 ↔ 平铺表」，混入非对象直接报错；
 *  - XML 限定规范化子集：`@` 属性前缀 / `#text` 文本 / 同名元素统一为数组。
 *
 * 纯函数：所有分支返回 ConvertResult，异常不穿透。
 */
import YAML from "yaml";
import * as TOML from "smol-toml";
import Papa from "papaparse";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { isLN, toDisplayString, collectUnsafeIntegers, isUnsafeIntegerLiteral } from "./lossless.ts";

export type ConvertFormat = "yaml" | "xml" | "toml" | "csv" | "properties" | "ini" | "mdtable";

export const CONVERT_FORMATS: { key: ConvertFormat; label: string; lossy: boolean; ext: string }[] = [
  { key: "yaml", label: "YAML", lossy: false, ext: "yaml" },
  { key: "xml", label: "XML", lossy: true, ext: "xml" },
  { key: "toml", label: "TOML", lossy: false, ext: "toml" },
  { key: "csv", label: "CSV", lossy: true, ext: "csv" },
  { key: "properties", label: "Properties", lossy: true, ext: "properties" },
  { key: "ini", label: "INI", lossy: true, ext: "ini" },
  { key: "mdtable", label: "Markdown 表", lossy: true, ext: "md" },
];

export interface ConvertResult {
  ok: boolean;
  text: string;
  /** 给 UI 的警告（有损 / 类型降级） */
  warnings: string[];
  error?: string;
  format: ConvertFormat;
}

const fail = (format: ConvertFormat, error: string): ConvertResult => ({ ok: false, text: "", warnings: [], error, format });

/** 把 LosslessNumber 转成「目标格式能安全表示」的值；不安全则抛错 */
function plain(v: unknown, format: ConvertFormat, unsafePaths?: string[]): unknown {
  if (isLN(v)) {
    const s = v.value;
    if (/^-?\d+$/.test(s)) {
      if (isUnsafeIntegerLiteral(s)) {
        // 只有真正超出 2^53 的整数才报错；安全的 20 应正常转 number，
        // 否则连最简单的 {"age":20} 都没法转 YAML/XML/CSV。
        if (["yaml", "toml", "properties", "ini", "mdtable"].includes(format)) return s;
        throw new Error(`目标格式 ${format.toUpperCase()} 无法安全表示整数 ${s}，请改用字符串或先转为普通数值`);
      }
      return Number(s);
    }
    return Number(s);
  }
  if (Array.isArray(v)) return v.map((x) => plain(x, format));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = plain(x, format);
    return out;
  }
  return v;
}

/** JSON → 目标格式 */
export function fromJson(value: unknown, format: ConvertFormat): ConvertResult {
  const warnings: string[] = [];
  const meta = CONVERT_FORMATS.find((f) => f.key === format)!;
  if (meta.lossy) warnings.push(`${meta.label} 转换有损：${lossyReason(format)}`);
  const unsafe = collectUnsafeIntegers(value);
  if (unsafe.length) warnings.push(`检测到 ${unsafe.length} 处超大整数（如 ${unsafe[0]}），已按字符串保留，注意目标格式的类型解释`);

  let v: unknown;
  try {
    v = plain(value, format);
  } catch (e) {
    return fail(format, (e as Error).message);
  }

  try {
    switch (format) {
      case "yaml":
        return { ok: true, text: YAML.stringify(v), warnings, format };
      case "toml": {
        if (Array.isArray(v) || (v && typeof v === "object" && !Array.isArray(v))) {
          return { ok: true, text: TOML.stringify(v as never), warnings, format };
        }
        return { ok: true, text: TOML.stringify({ value: v } as never), warnings, format };
      }
      case "csv": return csvFrom(v, warnings);
      case "xml": return xmlFrom(v, warnings);
      case "properties": return { ok: true, text: propsFrom(v), warnings, format };
      case "ini": return { ok: true, text: iniFrom(v), warnings, format };
      case "mdtable": return mdFrom(v, warnings);
    }
  } catch (e) {
    return fail(format, `转换失败：${(e as Error).message}`);
  }
}

/** 目标格式 → JSON 文本 */
export function toJson(text: string, format: ConvertFormat): ConvertResult {
  if (!text.trim()) return { ok: true, text: "", warnings: [], format };
  try {
    let v: unknown;
    switch (format) {
      case "yaml": v = YAML.parse(text); break;
      case "toml": v = TOML.parse(text); break;
      case "csv": v = csvTo(text); break;
      case "xml": v = xmlTo(text); break;
      case "properties": v = propsTo(text); break;
      case "ini": v = iniTo(text); break;
      case "mdtable": v = mdTo(text); break;
    }
    return { ok: true, text: JSON.stringify(v, null, 2), warnings: [], format };
  } catch (e) {
    return fail(format, `解析失败：${(e as Error).message}`);
  }
}

function lossyReason(f: ConvertFormat): string {
  switch (f) {
    case "xml": return "属性/文本/数组用 @、#text 约定表示，命名空间与 mixed content 不保留";
    case "csv": return "仅支持对象数组，嵌套值被压成字符串，类型可能丢失";
    case "properties": case "ini": return "只支持一层键值，嵌套结构被压平";
    case "mdtable": return "仅支持对象数组，嵌套值被压成字符串";
    default: return "";
  }
}

/* ------------------------- CSV ------------------------- */

function flatten(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("CSV 只支持「对象数组」，检测到非对象元素");
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x && typeof x === "object") out[k] = isLN(x) ? toDisplayString(x) : JSON.stringify(x);
    else out[k] = x;
  }
  return out;
}

function csvFrom(v: unknown, warnings: string[]): ConvertResult {
  if (!Array.isArray(v)) return fail("csv", "CSV 只支持根为「对象数组」的 JSON；当前根不是数组");
  const rows = v.map((x, i) => {
    try { return flatten(x); } catch (e) { throw new Error(`第 ${i + 1} 行：${(e as Error).message}`); }
  });
  if (!rows.length) return { ok: true, text: "", warnings: [...warnings, "空数组生成空 CSV"], format: "csv" };
  const text = Papa.unparse(rows, { escapeFormulae: true });
  return { ok: true, text, warnings, format: "csv" };
}

function csvTo(text: string): unknown {
  const r = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (r.errors.length && !r.data.length) throw new Error(r.errors[0].message);
  return r.data;
}

/* ------------------------- XML ------------------------- */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: false,
});
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  format: true,
  suppressEmptyNode: false,
});

function xmlFrom(v: unknown, warnings: string[]): ConvertResult {
  // 规范化：根对象必须是单键（XML 只能有一个根元素）
  let root: Record<string, unknown>;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v as Record<string, unknown>);
    root = keys.length === 1 ? (v as Record<string, unknown>) : { root: v };
  } else {
    root = { root: v };
  }
  const text = xmlBuilder.build(root) as string;
  return { ok: true, text: `<?xml version="1.0" encoding="UTF-8"?>\n${text}`, warnings, format: "xml" };
}

function xmlTo(text: string): unknown {
  const cleaned = text.replace(/<\?xml[^>]*\?>\s*/g, "");
  return xmlParser.parse(cleaned);
}

/* ------------------------- Properties / INI ------------------------- */

function propsFrom(v: unknown): string {
  const flat: [string, string][] = [];
  const walk = (x: unknown, prefix: string) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      for (const [k, y] of Object.entries(x as Record<string, unknown>)) walk(y, prefix ? `${prefix}.${k}` : k);
    } else {
      flat.push([prefix, String(x ?? "")]);
    }
  };
  walk(v, "");
  return flat.map(([k, val]) => `${k}=${val.replace(/([\\:=])/g, "\\$1").replace(/\n/g, "\\n")}`).join("\n");
}

function propsTo(text: string): unknown {
  const out: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith("!")) continue;
    const i = s.search(/(?<!\\)[=:]/);
    const k = (i < 0 ? s : s.slice(0, i)).trim().replace(/\\([=:])/g, "$1");
    const val = i < 0 ? "" : s.slice(i + 1).trim().replace(/\\n/g, "\n").replace(/\\([=:\\])/g, "$1");
    setDeep(out, k.split("."), val);
  }
  return out;
}

function iniFrom(v: unknown): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return `[value]\nvalue=${String(v ?? "")}`;
  const out: string[] = [];
  for (const [section, body] of Object.entries(v as Record<string, unknown>)) {
    out.push(`[${section}]`);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [k, val] of Object.entries(body as Record<string, unknown>)) out.push(`${k}=${String(val ?? "")}`);
    } else {
      out.push(`value=${String(body ?? "")}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function iniTo(text: string): unknown {
  const out: Record<string, Record<string, string>> = {};
  let cur = "default";
  out[cur] = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith(";") || s.startsWith("#")) continue;
    const sec = s.match(/^\[(.+)\]$/);
    if (sec) { cur = sec[1]; out[cur] = out[cur] ?? {}; continue; }
    const i = s.indexOf("=");
    if (i < 0) continue;
    out[cur][s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return out;
}

function setDeep(obj: Record<string, unknown>, parts: string[], val: unknown) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = val;
}

/* ------------------------- Markdown Table ------------------------- */

function mdFrom(v: unknown, warnings: string[]): ConvertResult {
  if (!Array.isArray(v)) return fail("mdtable", "Markdown 表只支持根为「对象数组」的 JSON");
  const rows = v.map((x, i) => {
    try { return flatten(x); } catch (e) { throw new Error(`第 ${i + 1} 行：${(e as Error).message}`); }
  });
  if (!rows.length) return { ok: true, text: "", warnings, format: "mdtable" };
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => esc(r[c])).join(" | ")} |`),
  ];
  return { ok: true, text: lines.join("\n"), warnings, format: "mdtable" };
}

function mdTo(text: string): unknown {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) throw new Error("不是合法的 Markdown 表格");
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const cols = cells(lines[0]);
  const rows = lines.slice(2).map((l) => {
    const vals = cells(l);
    const o: Record<string, string> = {};
    cols.forEach((c, i) => { o[c] = vals[i] ?? ""; });
    return o;
  });
  return rows;
}
