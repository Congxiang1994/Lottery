import { createApi } from "../common/http";

const BASE = "/api/trigger";

/** trigger 域请求统一走全站 http 客户端（401/错误体处理见 common/http.ts）。 */
const api = createApi(BASE);

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
  failed_today: boolean;
  missed_today: boolean;
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

export interface SchedulerStatus {
  alive: boolean;
  supervisor_alive: boolean;
  last_tick: string | null;
  tick_age_seconds: number | null;
  ticks: number;
  restarts: number;
  grace_minutes: number;
  started_at: string | null;
  owner: string;
}

export interface TriggerStatus {
  tasks_total: number;
  tasks_enabled: number;
  fired_today: number;
  next_fire: string | null;
  server_time: string;
  scheduler: SchedulerStatus;
}

export const triggerApi = {
  session: () => api.get<{ valid: boolean }>("/session").then((d) => d.valid),

  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/auth", { password }),

  logout: () => api.post<{ ok: boolean }>("/logout"),

  tasks: () => api.get<TriggerTask[]>("/tasks"),

  createTask: (data: Partial<TriggerTask> & { api_key: string }) =>
    api.post<TriggerTask>("/tasks", data),

  updateTask: (id: number, data: Partial<TriggerTask> & { api_key?: string }) =>
    api.put<TriggerTask>(`/tasks/${id}`, data),

  toggleTask: (id: number, enabled: boolean) =>
    api.put<TriggerTask>(`/tasks/${id}/enabled`, { enabled }),

  deleteTask: (id: number) => api.del<{ ok: boolean }>(`/tasks/${id}`),

  fireNow: (id: number) => api.post<{ ok: boolean }>(`/tasks/${id}/fire`),

  testConnection: (baseUrl: string, apiKey: string, model: string) =>
    api.post<{ ok: boolean; message: string }>("/test", {
      base_url: baseUrl,
      api_key: apiKey,
      model,
    }),

  history: (limit = 100) => api.get<HistoryRow[]>("/history", { limit }),

  status: () => api.get<TriggerStatus>("/status"),
};
