/**
 * JSON 统计（纯函数）：键数 / 嵌套深度 / 字节 / 行数 / 节点数。
 *
 * JsonStudio 状态栏常驻这四项。深度定义：**容器嵌套层数** —— 根标量 0，
 * 根容器 1，每嵌套一层容器 +1；容器里的标量不再额外 +1（标量不是容器）。
 */
import { isLN } from "./lossless.ts";
import type { JsonStats } from "./types.ts";

const encoder = new TextEncoder();

export function computeStats(value: unknown, source: string): JsonStats {
  const bytes = encoder.encode(source).length;
  const lines = source === "" ? 0 : source.split(/\r\n|\r|\n/).length;
  let keys = 0;
  let nodes = 0;

  /** 返回「从 v 往下能到达的最大容器深度」，d = v 自身所在的容器深度 */
  const walk = (v: unknown, d: number): number => {
    nodes += 1;
    // ⚠️ LosslessNumber 是带 value/isLosslessNumber 两个可枚举 key 的对象，
    //    必须最先判掉，否则会被当成普通对象递归 → keys/depth 虚高。
    if (isLN(v)) return d;
    if (Array.isArray(v)) {
      let max = d + 1;
      for (const item of v) max = Math.max(max, walk(item, d + 1));
      return max;
    }
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      keys += entries.length;
      let max = d + 1;
      for (const [, item] of entries) max = Math.max(max, walk(item, d + 1));
      return max;
    }
    return d;
  };

  const depth = value === undefined ? 0 : walk(value, 0);
  return { keys, depth, bytes, lines, nodes };
}
