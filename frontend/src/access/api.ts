/** 访问管理接口封装（`/api/access/*`）。 */
const BASE = "/api/access";

/** 统一请求：401 单独抛出，页面据此回到密码门。 */
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
      .then((d) => d?.detail ?? "")
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

/** 拼 query（跳过空值与 undefined） */
export function qs(params: Record<string, unknown>): string {
  const s = Object.entries(params)
    .filter(([, v]) => v !== "" && v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
}

/* ------------------------------ 类型 ------------------------------ */

export interface Kpi {
  requests: number;
  ips: number;
  visitors: number;
  pages: number;
  errors: number;
  error_rate: number;
}

export interface GeoStatus {
  v4_loaded: boolean;
  v6_loaded: boolean;
  v4_created_at: string;
  v6_created_at: string;
  v4_bytes: number;
  v6_bytes: number;
  error: string;
  loaded_at: string;
}

export interface Summary {
  days: number;
  today: string;
  window: Kpi;
  today_stats: Kpi;
  p50_ms: number | null;
  p95_ms: number | null;
  probe_hits: number;
  cloud_hits: number;
  ips_known: number;
  auto_hidden: number;
  pending: number;
  geo: GeoStatus;
}

export interface SeriesItem {
  k: string;
  v: number;
}

export interface TopPath {
  path: string;
  method: string;
  requests: number;
  avg_ms: number | null;
  max_status: number;
  errors: number;
  ips: number;
}

export interface FeatureRow {
  feature: string;
  label: string;
  requests: number;
  ips: number;
  visitors: number;
}

export interface GeoRow {
  name: string;
  requests: number;
  ips: number;
  visitors: number;
  unknown: boolean;
}

export interface MixItem {
  label: string;
  n: number;
}

export interface IpRow {
  ip: string;
  first_seen: string;
  last_seen: string;
  requests: number;
  pages: number;
  auto_hits: number;
  visitors: number;
  cloud: number;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  ua_class: string | null;
  geo_src: string | null;
  region_label: string;
  note: string;
  tag: string;
  mix: MixItem[];
}

export interface LogRow {
  id: number;
  ts: string;
  kind: string;
  feature: string;
  feature_label: string;
  method: string;
  path: string;
  raw_path: string;
  query: string;
  status: number;
  latency_ms: number | null;
  resp_bytes: number;
  ip: string;
  country: string;
  region: string;
  city: string;
  isp: string;
  cloud: number;
  geo_src: string;
  ua_class: string;
  ua: string;
  referer: string;
  visitor: string;
  visitor_short: string;
  hits: number;
  is_private: number;
  auth: string;
  region_label: string;
}

export interface IpDetail {
  ip: string;
  found: boolean;
  requests?: number;
  pages?: number;
  first_seen?: string;
  last_seen?: string;
  visitors?: number;
  path_count?: number;
  auto_hits?: number;
  cloud?: number;
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  geo_src?: string;
  note?: string;
  tag?: string;
  profile_first_seen?: string;
  features?: { feature: string; label: string; requests: number; paths: number }[];
  paths?: TopPath[];
  timeline?: LogRow[];
  timeline_total?: number;
}

export interface VisitorRow {
  visitor: string;
  short: string;
  first_seen: string;
  last_seen: string;
  active_days: number;
  requests: number;
  ip_count: number;
  pages: number;
  private_hits: number;
  ua_class: string | null;
  region_label: string;
  name: string;
  note: string;
  mix: MixItem[];
}

export interface VisitorDetail {
  visitor: string;
  found: boolean;
  short?: string;
  requests?: number;
  first_seen?: string;
  last_seen?: string;
  active_days?: number;
  ip_count?: number;
  pages?: number;
  name?: string;
  note?: string;
  ips?: { ip: string; region_label: string; requests: number; first_seen: string; last_seen: string }[];
  features?: { feature: string; label: string; requests: number }[];
  timeline?: LogRow[];
  timeline_total?: number;
}

export interface Maintenance {
  db_path: string;
  db_bytes: number;
  rows: number;
  hits: number;
  first_ts: string;
  last_ts: string;
  kinds: { kind: string; rows: number; hits: number }[];
  recent_days: { day: string; rows: number }[];
  ip_profiles: number;
  visitor_profiles: number;
  geo: GeoStatus;
  geo_ips_total: number;
  geo_ips_resolved: number;
  /** 回环 / 私网 / 保留段 —— 故意不查库，已从覆盖率分母中排除 */
  geo_ips_skipped: number;
  geo_coverage: number;
  keep_days: number;
  pending: number;
  queue_dropped: number;
}

/* ------------------------------ 接口 ------------------------------ */

export const accessApi = {
  // ---------- 认证 ----------
  session: () =>
    fetch(`${BASE}/session`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => Boolean(d?.valid)),

  auth: (password: string) =>
    request<{ ok: boolean; message: string; ttl_hours: number }>("/auth", json({ password })),

  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  // ---------- 概览 ----------
  summary: (days: number, includeAuto = false) =>
    request<Summary>(`/summary${qs({ days, include_auto: includeAuto ? 1 : 0 })}`),

  timeseries: (days: number, bucket: "day" | "hour", metric: string, includeAuto = false) =>
    request<{ bucket: string; metric: string; items: SeriesItem[] }>(
      `/timeseries${qs({ days, bucket, metric, include_auto: includeAuto ? 1 : 0 })}`,
    ),

  topPaths: (days: number, limit = 20, includeAuto = false) =>
    request<{ items: TopPath[] }>(`/top-paths${qs({ days, limit, include_auto: includeAuto ? 1 : 0 })}`),

  features: (days: number, includeAuto = false) =>
    request<{ items: FeatureRow[] }>(`/features${qs({ days, include_auto: includeAuto ? 1 : 0 })}`),

  geo: (days: number, level: "country" | "region" | "city", includeAuto = false) =>
    request<{ level: string; items: GeoRow[] }>(
      `/geo${qs({ days, level, include_auto: includeAuto ? 1 : 0 })}`,
    ),

  isp: (days: number, includeAuto = false) =>
    request<{ items: { name: string; requests: number; ips: number }[] }>(
      `/isp${qs({ days, include_auto: includeAuto ? 1 : 0 })}`,
    ),

  statusCodes: (days: number, includeAuto = false) =>
    request<{ groups: { name: string; v: number }[]; items: { status: number; count: number }[] }>(
      `/status-codes${qs({ days, include_auto: includeAuto ? 1 : 0 })}`,
    ),

  uaClasses: (days: number, includeAuto = true) =>
    request<{ items: { name: string; requests: number; ips: number }[] }>(
      `/ua-classes${qs({ days, include_auto: includeAuto ? 1 : 0 })}`,
    ),

  // ---------- IP / 访客 ----------
  ips: (p: {
    days: number;
    limit?: number;
    offset?: number;
    sort?: string;
    q?: string;
    tag?: string;
    includeAuto?: boolean;
  }) =>
    request<{ total: number; items: IpRow[] }>(
      `/ips${qs({
        days: p.days,
        limit: p.limit ?? 30,
        offset: p.offset ?? 0,
        sort: p.sort ?? "requests",
        q: p.q ?? "",
        tag: p.tag ?? "",
        include_auto: p.includeAuto ? 1 : 0,
      })}`,
    ),

  ipDetail: (ip: string, days: number, includeAuto = false, limit = 100, offset = 0) =>
    request<IpDetail>(
      `/ips/${encodeURIComponent(ip)}${qs({ days, include_auto: includeAuto ? 1 : 0, limit, offset })}`,
    ),

  updateIp: (ip: string, data: { note?: string; tag?: string }) =>
    request<{ ip: string; note: string; tag: string }>(`/ips/${encodeURIComponent(ip)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  visitors: (p: { days: number; limit?: number; offset?: number; sort?: string; includeAuto?: boolean }) =>
    request<{ total: number; items: VisitorRow[] }>(
      `/visitors${qs({
        days: p.days,
        limit: p.limit ?? 30,
        offset: p.offset ?? 0,
        sort: p.sort ?? "requests",
        include_auto: p.includeAuto ? 1 : 0,
      })}`,
    ),

  visitorDetail: (visitor: string, days: number, includeAuto = false, limit = 100, offset = 0) =>
    request<VisitorDetail>(
      `/visitors/${visitor}${qs({ days, include_auto: includeAuto ? 1 : 0, limit, offset })}`,
    ),

  updateVisitor: (visitor: string, data: { name?: string; note?: string }) =>
    request<{ visitor: string; name: string; note: string }>(`/visitors/${visitor}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  // ---------- 明细 ----------
  logs: (p: Record<string, unknown>) =>
    request<{ total: number; items: LogRow[] }>(`/logs${qs(p)}`),

  exportUrl: (p: Record<string, unknown>) => `${BASE}/export.csv${qs(p)}`,

  // ---------- 维护 ----------
  maintenance: () => request<Maintenance>("/maintenance"),
  purge: (before: string) => request<{ removed: number }>("/maintenance/purge", json({ before })),
  backfill: () => request<{ updated: number; ips?: number }>("/maintenance/backfill", json({})),
  purgeAll: () => request<{ removed: number }>("/maintenance/purge-all", { method: "POST" }),
};
