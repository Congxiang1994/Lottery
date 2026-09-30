/**
 * 访客标识（全站共享）。
 *
 * · localStorage 里的持久 UUID 是**唯一真源** —— 与 visit_stats.db 的去重口径完全一致，
 *   所以 Nav 上「4 人来访」的那个数字，在访问管理里能逐个点开看。
 * · 同一份值同步进 cookie（`lottery_vid`），让后端中间件也能拿到它。
 *   为什么必须同步：中间件只看得见请求头 / cookie，看不见 localStorage；
 *   拿不到 visitor 就只能按 IP 聚合 —— 而**移动网络出口 IP 会频繁漂移**，
 *   一个人一天可能换十几个 IP，按 IP 看会把一个人算成十几个人。
 *
 * cookie 里存的是**原始 UUID**：服务端入库前加盐哈希。
 * 这里不做任何混淆 —— localStorage 里本来就是明文，此处加密不增加任何安全性，
 * 只会让「两处对不上」这种问题更难查。
 */
const VISITOR_KEY = "lottery_visitor_id";

/** 与后端 `config.VISITOR_COOKIE` 必须一致 */
const VISITOR_COOKIE = "lottery_vid";

const COOKIE_MAX_AGE = 365 * 24 * 3600;

/** 读取（必要时生成）持久访客 UUID。 */
export function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    // 隐私模式 / 存储被禁：退化为会话内随机值（不持久，但不会崩）
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** 把访客 UUID 写进 cookie，供后端中间件读取（幂等，开销可忽略）。 */
export function syncVisitorCookie(): void {
  try {
    const id = getVisitorId();
    if (!id) return;
    if (document.cookie.includes(`${VISITOR_COOKIE}=${id}`)) return;
    document.cookie =
      `${VISITOR_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    /* cookie 不可用时静默降级：中间件拿不到 visitor，但页面一切正常 */
  }
}
