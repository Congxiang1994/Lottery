/**
 * 从日志 / 混合文本中提取 JSON 片段。
 *
 * JsonStudio 的两条硬约束（v1.2.0 / v1.3.0）：
 *  ① **原文保持不变** —— 提取结果进独立面板，绝不替换编辑器内容；
 *  ② 不要把「独立的转义 JSON 文档」误判为日志混合内容。
 *
 * 做法：扫描 `{` / `[` 起点，用带字符串/转义感知的括号配对找终点，
 * 再对候选片段按 严格→JSON5→修复 三档试解析，成功即收。
 * 纯函数，无 DOM 依赖。
 */
import JSON5 from "json5";
import { jsonrepair } from "jsonrepair";
import { parseLossless, stringifyLossless } from "./lossless.ts";
import type { ExtractFragment, InputKind } from "./types.ts";

/** 括号配对找终点，返回结束下标（不含）；失败返回 -1 */
function findClose(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      // JSON5/JSONC 行注释：跳到行尾
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** 试解析一个候选片段，返回 { ok, kind, value } */
function tryCandidate(raw: string): { ok: boolean; kind: InputKind; value?: unknown; error?: string } {
  let err = "无法解析";
  try {
    return { ok: true, kind: "json", value: parseLossless(raw) };
  } catch (e) {
    err = (e as Error).message;
  }
  try {
    return { ok: true, kind: "json5", value: JSON5.parse(raw) };
  } catch {
    /* 下一档 */
  }
  try {
    return { ok: true, kind: "repaired", value: parseLossless(jsonrepair(raw)) };
  } catch {
    /* 失败 */
  }
  return { ok: false, kind: "invalid", error: err };
}

/**
 * 提取片段。只认「以 { 或 [ 开头」的候选，避免把普通文本里的括号误收。
 * 命中后从终点继续扫，支持一行日志里多个片段。
 */
export function extractFragments(text: string): ExtractFragment[] {
  const out: ExtractFragment[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") {
      i += 1;
      continue;
    }
    // 片段至少要有内容；单字符 "{" 直接跳过
    const end = findClose(text, i);
    if (end <= i + 1) {
      i += 1;
      continue;
    }
    const raw = text.slice(i, end);
    const r = tryCandidate(raw);
    if (r.ok) {
      out.push({
        start: i,
        end,
        raw,
        kind: r.kind,
        pretty: stringifyLossless(r.value, 2),
        ok: true,
      });
      i = end;
    } else {
      // 解析失败的片段不收，但从下一个字符继续（嵌套括号里可能还有有效片段）
      i += 1;
    }
  }
  return out;
}

/** 合并重叠片段（大括号嵌套时可能同时命中内外两层，只保留最外层） */
export function dedupeFragments(frags: ExtractFragment[]): ExtractFragment[] {
  const sorted = [...frags].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ExtractFragment[] = [];
  let lastEnd = -1;
  for (const f of sorted) {
    if (f.start >= lastEnd) {
      out.push(f);
      lastEnd = f.end;
    }
  }
  return out;
}
