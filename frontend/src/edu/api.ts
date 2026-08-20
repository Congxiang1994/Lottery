// 智慧教育平台资源下载助手 —— 后端 API 封装（挂载在 /api/edu 下）与类型定义

export interface BookItem {
  Level: number;
  Name: string;
  TagID: string;
  TagName: string;
  BookID: string;
  BookName: string;
  IsBook: boolean;
  Children: BookItem[];
}

export interface CourseItem {
  Title: string;
  CourseID: string;
  ResourceType: string;
  NodePath?: string;
  NodeTitle?: string;
}

export interface CourseToc {
  Index: number;
  Title: string;
  Children: CourseItem[];
}

export interface LinkData {
  Format: string;
  Title: string;
  Folder: string;
  ID: string;
  RawURL: string;
  BackupURL: string;
  Size: number;
}

export interface Task {
  index: number;
  title: string;
  folder: string;
  format: string;
  size: number;
  status: string;
  progress: number;
  downloaded: number;
  output_path: string;
  error: string;
}

export interface TaskGroup {
  id: string;
  name: string;
  created_at: string;
  status: string;
  total: number;
  done: number;
  tasks: Task[];
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  mod: number;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface DirectItem {
  index: number;
  title: string;
  format: string;
  url: string;
}

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 45000): Promise<T> {
  const opts: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await Promise.race([
    fetch(path, opts),
    new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("请求超时或无响应")), timeoutMs)),
  ]);
  const text = await resp.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!resp.ok) {
    const msg = (data as { error?: string })?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const Api = {
  authStatus: () => request<{ has_auth: boolean }>("GET", "/api/edu/auth"),
  setAuth: (token: string) => request<{ has_auth: boolean }>("POST", "/api/edu/auth", { token }),
  authCode: () => request<{ code: string }>("GET", "/api/edu/auth/code"),
  bindByCode: (code: string, token: string) =>
    request<{ ok: boolean }>("POST", "/api/edu/auth/code", { code, token }),

  catalog: (type: string) =>
    request<BookItem>("GET", `/api/edu/catalog?type=${encodeURIComponent(type)}`, undefined, 90000),
  course: (bookID: string) =>
    request<CourseToc[]>("GET", `/api/edu/course/${encodeURIComponent(bookID)}`, undefined, 60000),

  parse: (payload: object) => request<LinkData[]>("POST", "/api/edu/parse", payload),
  direct: (payload: { links: LinkData[] }) => request<DirectItem[]>("POST", "/api/edu/direct", payload),

  tasks: () => request<TaskGroup[]>("GET", "/api/edu/tasks"),
  createTask: (payload: { links: LinkData[]; name: string }) =>
    request<TaskGroup>("POST", "/api/edu/tasks", payload),
  cancelTask: (id: string) =>
    request<{ cancelled: boolean }>("POST", `/api/edu/tasks/${encodeURIComponent(id)}/cancel`),

  files: (path = "") =>
    request<FileEntry[]>("GET", `/api/edu/files${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  deleteFile: (path: string) =>
    request<{ deleted: boolean }>("DELETE", `/api/edu/files?path=${encodeURIComponent(path)}`),
  fileDownloadUrl: (path: string) => `/api/edu/files/download?path=${encodeURIComponent(path)}`,
  zipUrl: () => "/api/edu/files/zip",
};

export function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export const statusLabel = (s: string): string =>
  ({
    running: "进行中",
    done: "已完成",
    cancelled: "已取消",
    error: "失败",
    downloading: "下载中",
    pending: "等待中",
  })[s] || s;
