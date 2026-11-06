import { copyText, createApi } from "../common/http";

export { copyText };

const BASE = "/api/story";

/** story 域请求统一走全站 http 客户端（401/错误体处理见 common/http.ts）。 */
const api = createApi(BASE);

export interface Story {
  id: number;
  title: string;
  story_date: string;
  content: string;
  summary: string;
  tags: string;
  audio_url: string;
  cover_url: string;
  published: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface StoryList {
  total: number;
  items: Story[];
}

export interface StoryKey {
  id: number;
  name: string;
  api_key: string;
  key_prefix: string;
  enabled: boolean;
  daily_quota: number;
  total_quota: number;
  calls_total: number;
  calls_today: number;
  last_used_at: string;
  last_used_ip: string;
  note: string;
  created_at: string;
}

export interface CallRow {
  id: number;
  key_id: number | null;
  key_name: string;
  ts: string;
  method: string;
  path: string;
  status_code: number | null;
  latency_ms: number | null;
  ip: string;
}

export interface CallsSummary {
  calls_today: number;
  calls_window: number;
  window_days: number;
  keys_total: number;
  keys_enabled: number;
  keys_calls_today: number;
  today: string;
}

export interface DocParam {
  name: string;
  /** query / path / body 中的位置（请求体字段说明里没有这个字段） */
  in?: string;
  /** 请求体字段的类型，如 string / boolean */
  type?: string;
  required: string;
  desc: string;
}

export interface DocEndpoint {
  method: string;
  path: string;
  summary: string;
  params: DocParam[];
  body: DocParam[] | null;
}

export interface ApiDoc {
  auth_header: string;
  base_path: string;
  endpoints: DocEndpoint[];
  story_fields: DocParam[];
  status_codes: { code: string; desc: string }[];
  curl_samples: { title: string; desc: string; curl: string }[];
  python_sample: string;
  limits: Record<string, number>;
}

export const storyApi = {
  // ---------- 公开通道 ----------
  publicList: (limit = 200) => api.get<StoryList>("/list", { limit }),
  publicItem: (id: number) => api.get<Story>(`/item/${id}`),

  // ---------- 管理通道 ----------
  session: () =>
    api.get<{ valid: boolean }>("/admin/session").then((d) => d.valid),

  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/admin/auth", {
      password,
    }),

  logout: () => api.post<{ ok: boolean }>("/admin/logout"),

  adminStories: (limit = 200) => api.get<StoryList>("/admin/stories", { limit }),

  createStory: (data: Partial<Story>) => api.post<Story>("/admin/stories", data),

  updateStory: (id: number, data: Partial<Story>) =>
    api.put<Story>(`/admin/stories/${id}`, data),

  setPublished: (id: number, published: boolean) =>
    api.put<Story>(`/admin/stories/${id}/published`, { published }),

  deleteStory: (id: number) => api.del<{ ok: boolean }>(`/admin/stories/${id}`),

  // ---------- API 密钥 ----------
  keys: () => api.get<{ keys: StoryKey[]; summary: CallsSummary }>("/admin/keys"),

  createKey: (data: {
    name: string;
    daily_quota: number;
    total_quota: number;
    note: string;
  }) => api.post<StoryKey>("/admin/keys", data),

  updateKey: (id: number, data: Partial<StoryKey>) =>
    api.put<StoryKey>(`/admin/keys/${id}`, data),

  toggleKey: (id: number, enabled: boolean) =>
    api.put<StoryKey>(`/admin/keys/${id}/enabled`, { enabled }),

  resetKeyCalls: (id: number, scope: "today" | "all" = "today") =>
    api.post<StoryKey>(`/admin/keys/${id}/reset-calls`, { scope }),

  deleteKey: (id: number) => api.del<{ ok: boolean }>(`/admin/keys/${id}`),

  // ---------- 调用日志与文档 ----------
  calls: (limit = 50, keyId?: number) =>
    api.get<{ calls: CallRow[]; summary: CallsSummary }>("/admin/calls", {
      limit,
      key_id: keyId,
    }),

  apiDoc: () => api.get<ApiDoc>("/admin/api-doc"),
};
