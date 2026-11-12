/**
 * 统一解析管线（JsonStudio 最值钱的部分）。
 *
 * 探测优先级（从严格到宽松，命中即停）：
 *   empty → strict JSON → escaped → JSONL → JSON5 → JSONC → repair → log
 *
 * 每条分支都返回同一种 ParseResult，视图层无需关心输入到底是哪来的。
 * 全链路用 lossless-json 解析，大整数不降级。
 *
 * ⚠️ 三条实测得出的顺序约束（改之前先读）：
 *  ① **转义 JSON 必须先于严格 JSON 判定**：整段 `"{"a":1}"` 本身是合法 JSON
 *     字符串，会被第一档吞掉，用户就看不到「已解转义」的语义。
 *  ② **JSONL 必须先于 repair**：jsonrepair 会把两行 JSON 包成数组
 *     （`[{"a":1},{"a":2}]`），把「逐行记录」误变成单个数组。
 *  ③ **残缺 / 前后带杂字的文本不得交给 repair 或 JSONC 容错**：
 *     jsonrepair('{"a":') 会补成 `{"a":null}` 假装成功；jsonc-parser 对
 *     'xxx {"b":2} yyy' 会返回 {"b":2} 并只报 InvalidSymbol。这类必须走
 *     「日志片段提取」或明确失败，不能假装有校。
 *
 * ⚠️ 竞态：本函数纯同步；调用方做「粘贴自动格式化」时必须自己带
 * version / AbortController 校验，旧结果不得覆盖新输入（JsonStudio v1.2.0 教训）。
 */
import JSON5 from "json5";
import { jsonrepair } from "jsonrepair";
import { parse as parseJsonc, printParseErrorCode, type ParseError as JsoncErr } from "jsonc-parser";
import { parseLossless, stringifyLossless, hasLossless } from "./lossless.ts";
import { computeStats } from "./stats.ts";
import { extractFragments } from "./extract.ts";
import { EMPTY_STATS, type InputKind, type ParseError, type ParseOptions, type ParseResult, type JsonlLine } from "./types.ts";

/* ------------------------- 错误翻译（中文 + 行列定位） ------------------------- */

/** 把任意解析异常翻译成中文并尽量定位行列 */
export function translateError(raw: string, text: string): ParseError {
  let pos = -1;
  const pm = raw.match(/position (\d+)/i);
  if (pm) pos = parseInt(pm[1], 10);
  const lm = raw.match(/line (\d+)[ ,]+column (\d+)/i);
  let line = 0;
  let col = 0;
  if (lm) {
    line = parseInt(lm[1], 10);
    col = parseInt(lm[2], 10);
  } else if (pos >= 0) {
    const safe = Math.min(pos, text.length);
    const before = text.slice(0, safe);
    line = before.split("\n").length;
    col = safe - before.lastIndexOf("\n");
  }

  const lc = line > 0 ? `（第 ${line} 行第 ${col} 列附近）` : "";
  let message: string;
  if (/end of (JSON )?input|end of data|Unexpected end/i.test(raw)) {
    message = `JSON 未完整结束${lc}：可能缺少收尾的 }、]，或字符串 / 数字没写完。`;
  } else if (/Unexpected token (\S+)/i.test(raw)) {
    const t = (raw.match(/Unexpected token (\S+)/i) as RegExpMatchArray)[1];
    const show = /^[ouen]$/.test(t) ? "关键词" : t;
    message = `遇到意外符号 ${show} ${lc}：检查是否用了单引号、写了注释，或多/少了逗号、括号不匹配。`;
  } else if (/Expected property name|Expecting|expected/i.test(raw)) {
    message = `此处语法不正确${lc}：通常是键名漏了双引号，或对象里多了逗号、少了冒号。`;
  } else if (/Unexpected (non-whitespace )?character|Invalid/i.test(raw)) {
    message = `出现非法字符${lc}：确认没有注释、单引号或尾随逗号（标准 JSON 不支持这些）。`;
  } else {
    message = `JSON 语法错误${lc}：${raw}`;
  }
  return { message, line, col, pos };
}

function fail(kind: InputKind, raw: string, text: string): ParseResult {
  return {
    ok: false,
    kind,
    value: undefined,
    errors: [translateError(raw, text)],
    source: text,
    lossless: false,
    stats: computeStats(undefined, text),
  };
}

function okResult(kind: InputKind, value: unknown, text: string, extra: Partial<ParseResult> = {}): ParseResult {
  return {
    ok: true,
    kind,
    value,
    errors: [],
    source: text,
    lossless: hasLossless(value),
    stats: computeStats(value, text),
    ...extra,
  };
}

/* ------------------------- 输入形态预判定 ------------------------- */

/** 整段是「一个带引号的 JSON 字符串字面量」，且内层能被解析成 JSON */
function tryEscaped(text: string): { value: unknown; inner: string } | null {
  const t = text.trim();
  if (t.length < 2 || t[0] !== '"' || t[t.length - 1] !== '"') return null;
  let inner: string;
  try {
    inner = JSON.parse(t) as string;
  } catch {
    return null;
  }
  if (typeof inner !== "string") return null;
  const s = inner.trim();
  if (!s || !/^[{[]/.test(s)) return null;
  try {
    return { value: parseLossless(s), inner: s };
  } catch {
    return null;
  }
}

/** 剥掉前置的行注释 / 块注释与空白（JSONC 允许文档以注释开头） */
function stripLeadingComments(text: string): string {
  let t = text.trimStart();
  for (;;) {
    if (t.startsWith("//")) {
      const nl = t.indexOf("\n");
      t = nl === -1 ? "" : t.slice(nl + 1).trimStart();
    } else if (t.startsWith("/*")) {
      const end = t.indexOf("*/", 2);
      t = end === -1 ? "" : t.slice(end + 2).trimStart();
    } else break;
  }
  return t;
}

/** 文本是否「以一个完整的 JSON 值开头/结尾」（不允许前后杂字） */
function isWholeJsonDocument(text: string): boolean {
  const t = stripLeadingComments(text.trim());
  if (!/^[{[]/.test(t)) return false;
  const last = t.trimEnd().slice(-1);
  return last === "}" || last === "]";
}

/** 文本是否含 JSON 之外的非空白杂字（日志混合文本特征） */
function hasForeignText(text: string): boolean {
  // 剥掉前置注释后，若首字符不是 { [ 就是杂字（如 'xxx {"a":1}'）
  return !/^[{[]/.test(stripLeadingComments(text.trim()));
}

/* ------------------------- JSONL ------------------------- */

export function parseJsonl(text: string): JsonlLine[] {
  return text.split(/\r?\n/).map((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return { line, raw, ok: false, error: "空行" };
    try {
      const value = parseLossless(raw);
      return { line, raw, ok: true, value };
    } catch (e) {
      return { line, raw, ok: false, error: translateError((e as Error).message, raw).message };
    }
  });
}

function looksLikeJsonl(text: string): boolean {
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  if (rows.length < 2) return false;
  let hits = 0;
  for (const r of rows) {
    if (!/^[{[]/.test(r.trim())) return false;
    try {
      parseLossless(r);
      hits += 1;
    } catch {
      return false;
    }
  }
  return hits >= 2;
}

/* ------------------------- 主入口 ------------------------- */

export function parseInput(text: string, opts: ParseOptions = {}): ParseResult {
  const {
    allowLoose = true,
    allowRepair = true,
    allowJsonl = true,
    allowLogExtract = true,
    allowEscaped = true,
  } = opts;

  if (!text.trim()) return { ...okResult("empty", undefined, text), stats: EMPTY_STATS };

  let strictErr = "无法解析";
  let jsoncErrText = "";
  const whole = isWholeJsonDocument(text);
  const foreign = hasForeignText(text);

  // 1) 转义 JSON 字符串（必须早于严格 JSON，见文件头 ①）
  if (allowEscaped) {
    const esc = tryEscaped(text);
    if (esc) return okResult("escaped", esc.value, text);
  }

  // 2) JSONL / NDJSON（必须早于 repair，见文件头 ②）
  if (allowJsonl && looksLikeJsonl(text)) {
    const lines = parseJsonl(text);
    return okResult("jsonl", lines.map((l) => l.value), text, { lines });
  }

  // 3) 严格 JSON（无损）
  try {
    return okResult("json", parseLossless(text), text);
  } catch (e) {
    strictErr = (e as Error).message;
  }

  // 4) JSON5（无引号键 / 单引号 / 尾逗号 / 十六进制 / 注释）
  if (allowLoose && whole && !foreign) {
    try {
      const v = JSON5.parse(text);
      return okResult("json5", tryParseLosslessFromLoose(v, text), text);
    } catch {
      /* 继续下一档 */
    }
  }

  // 5) JSONC（注释 + 尾逗号）：只在「完整文档」且错误非致命时接受
  if (allowLoose && whole && !foreign) {
    const errs: JsoncErr[] = [];
    const v = parseJsonc(text, errs, { allowTrailingComma: true, disallowComments: false });
    // 实测：'{"a":' 报 ValueExpected + CloseBraceExpected 却仍返回 {} → 必须全量拒绝
    const fatal = errs.filter((e) => e.error !== 3 && e.error !== 15); // 3=TrailingComma 15=Comment 可容忍
    if (v !== undefined && fatal.length === 0) {
      return okResult("jsonc", tryParseLosslessFromLoose(v, text), text);
    }
    if (errs.length) jsoncErrText = errs.map((e) => printParseErrorCode(e.error)).join("; ");
  }

  // 6) 自动修复：只对「完整文档」放行（见文件头 ③）
  if (allowRepair && whole && !foreign) {
    try {
      const repaired = jsonrepair(text);
      return okResult("repaired", parseLossless(repaired), text);
    } catch {
      /* 继续 */
    }
  }

  // 7) 日志混合文本：原文不变，片段进独立面板
  if (allowLogExtract) {
    const fragments = extractFragments(text);
    if (fragments.length) {
      return okResult("log", undefined, text, { fragments });
    }
  }

  return fail("invalid", (jsoncErrText || strictErr || "无法解析"), text);
}

/**
 * JSON5 / JSONC 解析出的普通 JS 对象可能已经丢了大整数。
 * 尝试把原文用 jsonrepair 补成合法 JSON 后无损解析；补不回来就保留原值
 * （视图会给「精度可能丢失」提示，绝不假装无损）。
 */
function tryParseLosslessFromLoose(v: unknown, text: string): unknown {
  try {
    return parseLossless(jsonrepair(text));
  } catch {
    return v;
  }
}

/** 把解析结果统一转成「可展示的 JSON 文本」（不同 kind 有不同形态） */
export function resultToText(result: ParseResult, indent: number | string = 2): string {
  if (!result.ok) return "";
  if (result.kind === "log") return result.source; // 日志提取不改原文
  if (result.kind === "jsonl") {
    return (result.lines ?? [])
      .filter((l) => l.ok)
      .map((l) => stringifyLossless(l.value))
      .join("\n");
  }
  return stringifyLossless(result.value, indent);
}
