/**
 * JSON 工具公共类型（纯函数层与视图层共用）。
 * ⚠️ 内核内部 import 一律带 .ts 扩展名：Node 24 类型剥离直接跑自测时不做扩展名补全。
 */

/** 命中的输入形态，按探测优先级从严格到宽松 */
export type InputKind = "empty" | "json" | "escaped" | "json5" | "jsonc" | "repaired" | "jsonl" | "invalid";

export interface ParseError {
  message: string;
  line: number;
  col: number;
  pos: number;
}

export interface JsonStats {
  keys: number;
  depth: number;
  bytes: number;
  lines: number;
  nodes: number;
}

export interface JsonlLine {
  line: number;
  raw: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface ParseOptions {
  allowLoose?: boolean;
  allowRepair?: boolean;
  allowJsonl?: boolean;
  allowEscaped?: boolean;
}

export interface ParseResult {
  ok: boolean;
  kind: InputKind;
  value: unknown;
  errors: ParseError[];
  source: string;
  /** 是否含超出 JS 安全范围的整数 */
  lossless: boolean;
  stats: JsonStats;
  lines?: JsonlLine[];
}

export const EMPTY_STATS: JsonStats = { keys: 0, depth: 0, bytes: 0, lines: 0, nodes: 0 };
