import { createApi, query } from "../common/http";

/** 访问管理接口封装（`/api/access/*`）。 */
const BASE = "/api/access";

/** access 域请求统一走全站 http 客户端（401/错误体处理见 common/http.ts）。 */
const api = createApi(BASE);

/** 兼容历史导出：`qs()` 原来在本文件里自实现，现已统一到 common/http。 */
export { query as qs };

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

/** 全站累计口径（与左上角 Nav 同库 visit_stats.db，数字保证一致） */
export interface SiteTotals {
  total: number; // 累计人次（每会话 +1）
  visitors: number; // 累计人数（localStorage UUID 去重）
}

export interface Summary {
  days: number;
  today: string;
  window: Kpi;
  today_stats: Kpi;
  site_totals: SiteTotals;
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
  session: () => api.get<{ valid: boolean }>("/session").then((d) => !!d?.valid),

  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/auth", { password }),

  logout: () => api.post<{ ok: boolean }>("/logout"),

  // ---------- 概览 ----------
  summary: (days: number, includeAuto = false) =>
    api.get<Summary>("/summary", { days, include_auto: includeAuto ? 1 : 0 }),

  timeseries: (days: number, bucket: "day" | "hour", metric: string, includeAuto = false) =>
    api.get<{ bucket: string; metric: string; items: SeriesItem[] }>("/timeseries", {
      days,
      bucket,
      metric,
      include_auto: includeAuto ? 1 : 0,
    }),

  topPaths: (days: number, limit = 20, includeAuto = false) =>
    api.get<{ items: TopPath[] }>("/top-paths", {
      days,
      limit,
      include_auto: includeAuto ? 1 : 0,
    }),

  features: (days: number, includeAuto = false) =>
    api.get<{ items: FeatureRow[] }>("/features", {
      days,
      include_auto: includeAuto ? 1 : 0,
    }),

  geo: (days: number, level: "country" | "region" | "city", includeAuto = false) =>
    api.get<{ level: string; items: GeoRow[] }>("/geo", {
      days,
      level,
      include_auto: includeAuto ? 1 : 0,
    }),

  isp: (days: number, includeAuto = false) =>
    api.get<{ items: { name: string; requests: number; ips: number }[] }>("/isp", {
      days,
      include_auto: includeAuto ? 1 : 0,
    }),

  statusCodes: (days: number, includeAuto = false) =>
    api.get<{
      groups: { name: string; v: number }[];
      items: { status: number; count: number }[];
    }>("/status-codes", { days, include_auto: includeAuto ? 1 : 0 }),

  uaClasses: (days: number, includeAuto = true) =>
    api.get<{ items: { name: string; requests: number; ips: number }[] }>("/ua-classes", {
      days,
      include_auto: includeAuto ? 1 : 0,
    }),

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
    api.get<{ total: number; items: IpRow[] }>("/ips", {
      days: p.days,
      limit: p.limit ?? 30,
      offset: p.offset ?? 0,
      sort: p.sort ?? "requests",
      q: p.q ?? "",
      tag: p.tag ?? "",
      include_auto: p.includeAuto ? 1 : 0,
    }),

  ipDetail: (ip: string, days: number, includeAuto = false, limit = 100, offset = 0) =>
    api.get<IpDetail>(`/ips/${encodeURIComponent(ip)}`, {
      days,
      include_auto: includeAuto ? 1 : 0,
      limit,
      offset,
    }),

  updateIp: (ip: string, data: { note?: string; tag?: string }) =>
    api.put<{ ip: string; note: string; tag: string }>(
      `/ips/${encodeURIComponent(ip)}`,
      data,
    ),

  visitors: (p: {
    days: number;
    limit?: number;
    offset?: number;
    sort?: string;
    includeAuto?: boolean;
  }) =>
    api.get<{ total: number; items: VisitorRow[] }>("/visitors", {
      days: p.days,
      limit: p.limit ?? 30,
      offset: p.offset ?? 0,
      sort: p.sort ?? "requests",
      include_auto: p.includeAuto ? 1 : 0,
    }),

  visitorDetail: (visitor: string, days: number, includeAuto = false, limit = 100, offset = 0) =>
    api.get<VisitorDetail>(`/visitors/${visitor}`, {
      days,
      include_auto: includeAuto ? 1 : 0,
      limit,
      offset,
    }),

  updateVisitor: (visitor: string, data: { name?: string; note?: string }) =>
    api.put<{ visitor: string; name: string; note: string }>(
      `/visitors/${visitor}`,
      data,
    ),

  // ---------- 明细 ----------
  logs: (p: Record<string, string | number | boolean | undefined>) =>
    api.get<{ total: number; items: LogRow[] }>("/logs", p),

  exportUrl: (p: Record<string, string | number | boolean | undefined>) =>
    `${BASE}/export.csv${query(p)}`,

  // ---------- 维护 ----------
  maintenance: () => api.get<Maintenance>("/maintenance"),
  purge: (before: string) => api.post<{ removed: number }>("/maintenance/purge", { before }),
  backfill: () => api.post<{ updated: number; ips?: number }>("/maintenance/backfill", {}),
  purgeAll: () => api.post<{ removed: number }>("/maintenance/purge-all"),
};
