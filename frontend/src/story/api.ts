const BASE = "/api/story";

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
  publicList: (limit = 200) =>
    fetch(`${BASE}/list?limit=${limit}`, { credentials: "same-origin" }).then(
      (r) => r.json() as Promise<StoryList>,
    ),
  publicItem: (id: number) =>
    fetch(`${BASE}/item/${id}`, { credentials: "same-origin" }).then(
      (r) => r.json() as Promise<Story>,
    ),

  // ---------- 管理通道 ----------
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

  adminStories: (limit = 200) =>
    request<StoryList>(`/admin/stories?limit=${limit}`),

  createStory: (data: Partial<Story>) =>
    request<Story>("/admin/stories", json(data)),

  updateStory: (id: number, data: Partial<Story>) =>
    request<Story>(`/admin/stories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  setPublished: (id: number, published: boolean) =>
    request<Story>(`/admin/stories/${id}/published`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published }),
    }),

  deleteStory: (id: number) =>
    request<{ ok: boolean }>(`/admin/stories/${id}`, { method: "DELETE" }),

  // ---------- API 密钥 ----------
  keys: () =>
    request<{ keys: StoryKey[]; summary: CallsSummary }>("/admin/keys"),

  createKey: (data: {
    name: string;
    daily_quota: number;
    total_quota: number;
    note: string;
  }) => request<StoryKey>("/admin/keys", json(data)),

  updateKey: (id: number, data: Partial<StoryKey>) =>
    request<StoryKey>(`/admin/keys/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  toggleKey: (id: number, enabled: boolean) =>
    request<StoryKey>(`/admin/keys/${id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),

  resetKeyCalls: (id: number, scope: "today" | "all" = "today") =>
    request<StoryKey>(`/admin/keys/${id}/reset-calls`, json({ scope })),

  deleteKey: (id: number) =>
    request<{ ok: boolean }>(`/admin/keys/${id}`, { method: "DELETE" }),

  // ---------- 调用日志与文档 ----------
  calls: (limit = 50, keyId?: number) =>
    request<{ calls: CallRow[]; summary: CallsSummary }>(
      `/admin/calls?limit=${limit}${keyId ? `&key_id=${keyId}` : ""}`,
    ),

  apiDoc: () => request<ApiDoc>("/admin/api-doc"),
};

/** 复制到剪贴板（非 https / 老浏览器降级到 textarea）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
