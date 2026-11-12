/**
 * JSON 工作台的公共类型。
 *
 * 为什么单独一层：内核（json/*.ts）是无 React / 无 DOM 的纯函数层，
 * 视图层与自测脚本都依赖同一组结构；集中定义避免各模块各写一份「解析结果」
 * 导致字段漂移（这正是 common/ui.ts 要解决的那种复制粘贴病）。
 *
 * ⚠️ 内核内部 import 一律带 .ts 扩展名：Node 24 类型剥离直接跑自测时
 * **不做扩展名补全**，而 Vite 5 同时支持带 / 不带，取交集只能带。
 */

/** 命中的输入形态，按探测优先级从严格到宽松 */
export type InputKind =
  | "empty"
  | "json"
  | "escaped"
  | "json5"
  | "jsonc"
  | "repaired"
  | "jsonl"
  | "log"
  | "invalid";

export interface ParseError {
  /** 中文可读描述 */
  message: string;
  /** 1-based 行号，0 = 无法确定 */
  line: number;
  /** 1-based 列号，0 = 无法确定 */
  col: number;
  /** 0-based 绝对字符位置，-1 = 无法确定 */
  pos: number;
}

export interface JsonStats {
  /** 对象 key 总数（递归计入） */
  keys: number;
  /** 容器嵌套层数：根标量 0，根对象 1，每嵌套一层 +1 */
  depth: number;
  /** UTF-8 字节数 */
  bytes: number;
  /** 行数 */
  lines: number;
  /** 节点总数（含标量） */
  nodes: number;
}

/** 单个 JSONL 记录 */
export interface JsonlLine {
  /** 1-based 行号 */
  line: number;
  /** 原始文本（已去掉行尾换行） */
  raw: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** 日志文本里提取出的一个片段 */
export interface ExtractFragment {
  /** 片段在原文中的起始字符（0-based） */
  start: number;
  /** 结束字符（不含） */
  end: number;
  /** 原始文本 */
  raw: string;
  /** 探测到的形态 */
  kind: InputKind;
  /** 格式化后的 JSON 文本 */
  pretty: string;
  ok: boolean;
  error?: string;
}

export interface ParseOptions {
  /** 允许 JSON5 / JSONC（默认 true） */
  allowLoose?: boolean;
  /** 允许自动修复（默认 true） */
  allowRepair?: boolean;
  /** 允许 JSONL 逐行解析（默认 true） */
  allowJsonl?: boolean;
  /** 允许日志片段提取（默认 true） */
  allowLogExtract?: boolean;
  /** 允许转义 JSON 字符串（默认 true） */
  allowEscaped?: boolean;
}

export interface ParseResult {
  ok: boolean;
  kind: InputKind;
  /** 解析后的值；失败为 undefined */
  value: unknown;
  errors: ParseError[];
  source: string;
  /** 是否经过无损解析（可能含 LosslessNumber） */
  lossless: boolean;
  stats: JsonStats;
  /** JSONL 逐行结果 */
  lines?: JsonlLine[];
  /** 日志提取片段 */
  fragments?: ExtractFragment[];
}

export const EMPTY_STATS: JsonStats = { keys: 0, depth: 0, bytes: 0, lines: 0, nodes: 0 };
