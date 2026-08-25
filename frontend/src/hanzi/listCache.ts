/**
 * 汉字列表前端缓存
 * 列表几乎不变，没必要每次进入都请求后端：
 * - 每次进入先读 localStorage，若缓存日期 == 今天，直接使用，零请求
 * - 跨天后首次进入，请求一次后端并刷新缓存（每天最多一次）
 * - 请求失败时允许降级使用任意旧缓存（allowStale）
 */

const LIST_KEY = "hanzi_list_cache";
const DATE_KEY = "hanzi_list_date";

/** 本地日期 YYYY-MM-DD（不能用 toISOString，那是 UTC 会跨天偏移） */
const today = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

/**
 * 读取缓存列表。
 * @param allowStale 为 true 时忽略日期（用于请求失败时降级），默认仅当天有效
 * @returns 缓存数组；无有效缓存返回 null
 */
export function loadCachedList<T>({ allowStale = false } = {}): T[] | null {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return null;
    if (!allowStale && localStorage.getItem(DATE_KEY) !== today()) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as T[]) : null;
  } catch {
    return null;
  }
}

/** 写入缓存并记录当天日期 */
export function saveCachedList<T>(list: T[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    localStorage.setItem(DATE_KEY, today());
  } catch {
    /* localStorage 不可用时静默降级为不缓存 */
  }
}
