const BASE = "/api/trigger";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "same-origin",
    ...init,
  });
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

export interface TriggerTask {
  id: number;
  name: string;
  time: string;
  base_url: string;
  model: string;
  enabled: boolean;
  note: string;
  api_key_masked: string;
  fired_today: boolean;
  next_fire: string;
  created_at: string;
  updated_at: string;
}

export interface HistoryRow {
  id: number;
  task_id: number | null;
  task_name: string;
  fired_at: string;
  status: "success" | "failed" | "missed";
  http_code: number | null;
  latency_ms: number | null;
  retries: number;
  manual: boolean;
  error: string;
}

export interface TriggerStatus {
  tasks_total: number;
  tasks_enabled: number;
  fired_today: number;
  next_fire: string | null;
  server_time: string;
}

export const triggerApi = {
  session: () =>
    fetch(`${BASE}/session`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => d.valid as boolean),

  auth: (password: string) =>
    request<{ ok: boolean; message: string; ttl_hours: number }>("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  tasks: () => request<TriggerTask[]>("/tasks"),

  createTask: (data: Partial<TriggerTask> & { api_key: string }) =>
    request<TriggerTask>("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  updateTask: (id: number, data: Partial<TriggerTask> & { api_key?: string }) =>
    request<TriggerTask>(`/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  toggleTask: (id: number, enabled: boolean) =>
    request<TriggerTask>(`/tasks/${id}/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),

  deleteTask: (id: number) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),

  fireNow: (id: number) =>
    request<{ ok: boolean }>(`/tasks/${id}/fire`, { method: "POST" }),

  history: (limit = 100) => request<HistoryRow[]>(`/history?limit=${limit}`),

  status: () => request<TriggerStatus>("/status"),
};
