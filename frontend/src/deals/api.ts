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
  enabled: string;
  pages_per_round: string;
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
    ban_backoff_minutes: number;
    cate_suggestions: string[];
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

  clearCookie: () =>
    request<{ ok: boolean; cookie_set: boolean }>("/admin/cookie", {
      method: "DELETE",
    }),

  status: () => request<DealStatus>("/admin/status"),

  fetchNow: () => request<{ ok: boolean; message: string }>("/admin/fetch", json({})),

  unban: () => request<{ ok: boolean }>("/admin/unban", json({})),
};
