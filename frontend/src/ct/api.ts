import { createApi } from "../common/http";

/** CT 报告分享接口封装（`/api/ct/*`）。 */
const BASE = "/api/ct";

/** ct 域请求统一走全站 http 客户端（401/错误体处理见 common/http.ts）。 */
const api = createApi(BASE);

export interface CtReportMeta {
  id: number;
  title: string;
  bytes: number;
  sha256: string;
  updated_at: string;
}

export interface CtReport {
  title: string;
  html: string;
  bytes: number;
  sha256: string;
  updated_at: string;
}

export const ctApi = {
  session: () => api.get<{ valid: boolean }>("/session").then((d) => !!d?.valid),

  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/auth", { password }),

  logout: () => api.post<{ ok: boolean }>("/logout"),

  meta: () => api.get<{ exists: boolean; report: CtReportMeta | null }>("/meta"),

  report: () => api.get<CtReport>("/report"),

  /** 原版 HTML 的直链（同源、带会话 cookie）—— 新窗口打开 / 打印用。 */
  rawUrl: () => `${BASE}/report/raw`,
};
