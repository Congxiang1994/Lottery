const BASE = "/api/deals";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { credentials: "same-origin", ...init });
  if (res.status === 401) {
    const err = new Error("401") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail ?? "")
      .catch(() => "");
    throw new Error(detail || `请求失败 ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const put = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface Deal {
  id: number;
  title: string;
  url: string;
  price: string;
  mall: string;
  cate1: string;
  cate2: string;
  /** 卡片标签，`|` 分隔，如「34天新低|美淘节」 */
  tags: string;
  /** 商品缩略图（站点 CDN，带 referrerPolicy=no-referrer 直连即可） */
  img: string;
  worth: number;
  unworth: number;
  fav: number;
  cmt: number;
  worth_pct: number;
  heat: number;
  hhmm: string;
  first_seen: string;
  picked: boolean;
  pick_reason: string;
  /** 是否命中「关注品类」—— 只影响排序加权，不影响能否入选 */
  cate_hit: boolean;
  /** 折扣百分比（43 = 4.3 折，0 = 正文没写原价、未知）。
   *  唯一与「曝光」无关的判据：刚发布的好价没有投票，但折扣是客观的。 */
  discount: number;
  /** 爆料人昵称（标签流专有）。空串表示该来源不提供。 */
  reporter: string;
  /** 站点分类标签页的归属（手慢无 / 绝对值 / 历史低价…），`|` 分隔。
   *  ⚠️ 与 `tags`（卡片营销标签）不是一回事，展示时优先用它。 */
  feed_tags: string;
  /** tag / home / jingxuan / top */
  source: string;
}

export interface DealList {
  total: number;
  items: Deal[];
}

export interface DealStats {
  total: number;
  picked_total: number;
  today_added: number;
  today_picked: number;
  cate_filter: string;
  cate_boost: number;
  thresholds: {
    worth_pct_min: number;
    worth_min: number;
    fav_min: number;
    cmt_min: number;
    need_hits: number;
    /** 折扣优先判定是否开启 */
    discount_mode: boolean;
    /** 折扣 ≤ 此值（%）直接入选，不看投票 */
    discount_direct: number;
    /** 折扣在 (direct, assist] 需要热度命中 1 项 */
    discount_assist: number;
  };
  last_round: {
    ts: string;
    pages: number;
    parsed: number;
    added: number;
    picked: number;
    banned: boolean;
    errors: string;
  } | null;
}

export interface DealSettings {
  worth_pct_min: string;
  worth_min: string;
  fav_min: string;
  cmt_min: string;
  need_hits: string;
  cate_filter: string;
  cate_boost: string;
  cate_blacklist: string;
  enabled: string;
  pages_per_round: string;
  /** 启用的标签流 slug，逗号分隔（手慢无 tz273gm 等） */
  tag_feeds: string;
  /** 每个标签每轮抓几页，0 = 关闭标签流 */
  tag_pages: string;
  /** 折扣优先判定总开关（1/0） */
  discount_mode: string;
  /** 折扣 ≤ 此值（%）直接入选 */
  discount_direct: string;
  /** 折扣在此值以内需要热度命中 1 项 */
  discount_assist: string;
  /** 新人价护栏：折扣低于此值（%）且到手价低于 newbie_price 时否决 */
  newbie_discount: string;
  newbie_price: string;
  cookie: string;
  cookie_ua: string;
}

export interface DealConfig {
  settings: DealSettings;
  cookie_set: boolean;
  cookie_masked: string;
  constants: {
    interval_seconds: number;
    interval_minutes: number;
    min_request_interval_seconds: number;
    pages_per_round_default: number;
    /** 每轮固定抓几页首页推荐流（分页失效，恒为 1） */
    home_pages_per_round: number;
    ban_backoff_minutes: number;
    cate_suggestions: string[];
    cate_boost_default: number;
    /** 可选的标签流（slug 是存进配置的值，name 是中文名） */
    tag_feeds: { slug: string; name: string }[];
    tag_pages_default: number;
    top_every_n_rounds: number;
  };
}

export interface RoundRow {
  ts: string;
  pages: number;
  parsed: number;
  added: number;
  picked: number;
  banned: boolean;
  errors: string;
}

export interface DealStatus {
  scheduler: {
    alive: boolean;
    watchdog_alive: boolean;
    last_round: string | null;
    round_age_seconds: number | null;
    restarts: number;
    interval_seconds: number;
    started_at: string | null;
    banned: boolean;
    ban_remaining_seconds: number;
    last_error: string;
    last_result: Record<string, unknown>;
  };
  stats: DealStats;
  rounds: RoundRow[];
  cates: { cate: string; count: number; picked: number }[];
}

export const dealsApi = {
  // ---------- 公开 ----------
  list: (params: { limit?: number; hours?: number; q?: string; cate?: string } = {}) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(params.limit ?? 60));
    if (params.hours) qs.set("hours", String(params.hours));
    if (params.q) qs.set("q", params.q);
    if (params.cate) qs.set("cate", params.cate);
    return fetch(`${BASE}/list?${qs}`, { credentials: "same-origin" }).then(
      (r) => r.json() as Promise<DealList>,
    );
  },

  stats: () =>
    fetch(`${BASE}/stats`, { credentials: "same-origin" }).then(
      (r) => r.json() as Promise<DealStats>,
    ),

  // ---------- 管理 ----------
  session: () =>
    fetch(`${BASE}/admin/session`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => d.valid as boolean),

  auth: (password: string) =>
    request<{ ok: boolean; message: string; ttl_hours: number }>(
      "/admin/auth",
      json({ password }),
    ),

  logout: () => request<{ ok: boolean }>("/admin/logout", { method: "POST" }),

  config: () => request<DealConfig>("/admin/config"),

  saveConfig: (patch: Record<string, string | number>) =>
    request<{
      ok: boolean;
      cookie_set: boolean;
      cookie_masked: string;
      /** 改了阈值时后端会顺手重算全库，这里回传重算结果 */
      picked?: number;
      changed?: number;
    }>("/admin/config", put(patch)),

  status: () => request<DealStatus>("/admin/status"),

  fetchNow: () => request<{ ok: boolean; message: string }>("/admin/fetch", json({})),

  unban: () => request<{ ok: boolean }>("/admin/unban", json({})),
};
