import { createApi, query, request } from "../common/http";

/** CT 检查记录接口封装（`/api/ct/*`）。 */
const BASE = "/api/ct";

const api = createApi(BASE);

/** 一张报告照片 */
export interface CtPhoto {
  id: number;
  /** 所属检查记录 id（管理页/运维核对归属用，别删） */
  exam_id: number;
  caption: string;
  sort_order: number;
  url: string;
}

/** 一次检查（分享页 / 管理页共用） */
export interface CtExam {
  id: number;
  exam_time: string;
  project: string;
  link_label: string;
  link_url: string;
  link_text: string;
  note: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  photos: CtPhoto[];
  /** 管理页列表用（分享页接口不带这个字段） */
  photo_count?: number;
}

export const ctApi = {
  // ---------- 分享口令（只读会话） ----------
  session: () => api.get<{ valid: boolean }>("/session").then((d) => !!d?.valid),
  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/auth", { password }),
  logout: () => api.post<{ ok: boolean }>("/logout"),

  // ---------- 读取（分享页） ----------
  exams: () => api.get<{ items: CtExam[]; total: number }>("/exams").then((d) => d.items),
};

/* ------------------------------------------------------------------ *
 * 管理端（独立 cookie，全站操作密码）
 * ------------------------------------------------------------------ */

export const ctAdminApi = {
  session: () => api.get<{ valid: boolean }>("/admin/session").then((d) => !!d?.valid),
  auth: (password: string) =>
    api.post<{ ok: boolean; message: string; ttl_hours: number }>("/admin/auth", { password }),
  logout: () => api.post<{ ok: boolean }>("/admin/logout"),

  stats: () => api.get<{ exams: number; photos: number }>("/admin/stats"),

  exams: () => api.get<{ items: CtExam[]; total: number }>("/admin/exams").then((d) => d.items),

  createExam: (data: Partial<CtExam>) => api.post<CtExam>("/admin/exams", data),

  updateExam: (id: number, data: Partial<CtExam>) =>
    api.put<CtExam>(`/admin/exams/${id}`, data),

  deleteExam: (id: number) => api.del<{ ok: boolean; removed: boolean }>(`/admin/exams/${id}`),

  reorder: (ids: number[]) => api.post<{ items: CtExam[] }>("/admin/exams/reorder", { ids }),

  photos: () => api.get<{ items: CtPhoto[] }>("/admin/photos").then((d) => d.items),

  /** 上传照片：直接发二进制（不用 multipart，服务器没装 python-multipart） */
  uploadPhoto: (examId: number, file: File, caption = "") =>
    request<CtPhoto>(`${BASE}/admin/photo${query({ exam_id: examId, caption })}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type || "image/jpeg" },
    }),

  updatePhoto: (id: number, data: Partial<CtPhoto>) =>
    api.put<CtPhoto>(`/admin/photo/${id}`, data),

  deletePhoto: (id: number) =>
    api.del<{ ok: boolean; removed: boolean }>(`/admin/photo/${id}`),
};
