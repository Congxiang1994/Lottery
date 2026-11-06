import { createApi } from "../common/http";

const BASE = "/api/deals";

/** deals 域请求统一走全站 http 客户端（401/错误体处理见 common/http.ts）。 */
const api = createApi(BASE);

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
  /** 价值分 = 价格档 × 信号权重 × 品牌系数（后端算好落库）。列表就是按它降序。 */
  value_score: number;
  /** 信号档：1 = T1 真漏（绝对值/历史低价/手慢无），2 = T2 补贴（百亿补贴/国补），
   *  0 = 无信号（仅 legacy 模式会出现）。前端据此决定 chip 文案与配色。 */
  signal_tier: number;
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
  /** 品类白名单（逗号分隔），只有这些品类能入选 */
  cate_allow: string;
  /** T1 真漏词表（`|` 分隔）。只读，用于空态说明「在等什么信号」 */
  signal_t1: string;
  signal_t2: string;
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
  /** 唯一需要日常调整的配置：品类白名单，逗号分隔 */
  cate_allow: string;
  // ---------------- 抓取控制 ----------------
  enabled: string;
  /** 每轮抓几页精选流（0 = 不抓） */
  pages_per_round: string;
  /** 启用的标签流 slug，逗号分隔（手慢无 tz273gm 等） */
  tag_feeds: string;
  /** 每个标签每轮抓几页，0 = 关闭标签流 */
  tag_pages: string;
  // ---------------- 登录凭据（逃生通道，页面不暴露入口）----------------
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
  list: (params: { limit?: number; hours?: number; q?: string; cate?: string } = {}) =>
    api.get<DealList>("/list", {
      limit: params.limit ?? 60,
      hours: params.hours,
      q: params.q,
      cate: params.cate,
    }),

  stats: () => api.get<DealStats>("/stats"),

  // ---------- 管理 ----------
  session: () =>
    api.get<{ valid: boolean }>("/admin/session").then((d) => d.valid),

  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/admin/auth", {
      password,
    }),

  logout: () => api.post<{ ok: boolean }>("/admin/logout"),

  config: () => api.get<DealConfig>("/admin/config"),

  saveConfig: (patch: Record<string, string | number>) =>
    api.put<{
      ok: boolean;
      cookie_set: boolean;
      cookie_masked: string;
      /** 改了阈值时后端会顺手重算全库，这里回传重算结果 */
      picked?: number;
      changed?: number;
    }>("/admin/config", patch),

  status: () => api.get<DealStatus>("/admin/status"),

  fetchNow: () => api.post<{ ok: boolean; message: string }>("/admin/fetch", {}),

  unban: () => api.post<{ ok: boolean }>("/admin/unban", {}),
};
