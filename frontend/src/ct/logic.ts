/**
 * CT 分享页的纯逻辑（无 React 依赖，可在 Node 里直接跑测试）。
 */

/** 从时间串里截取日期（导航条用）。 */
export function shortDate(s: string): string {
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s || "—";
}
