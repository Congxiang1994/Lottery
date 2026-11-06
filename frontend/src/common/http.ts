/**
 * 全站统一 HTTP 客户端。
 *
 * 背景（为什么要有它）
 * --------------------
 * 5 个域各自抄了一遍「fetch → 判 401 → 解析 detail → 抛 Error」，且细节已经漂移：
 *  - 401 只有 4 个域单独抛 ``error.status = 401``，babysong 靠字符串判断
 *  - 后端 ``{"detail": "..."}`` 的解析有的取 ``d.detail``，有的取 ``d?.detail``
 *  - ``lottery/api.ts`` 还在用 ``请求失败 500: {json 原文}`` 这种把 JSON 塞进
 *    message 的写法，逼得 ``errText()`` 去正则里捞中文
 *  → 结果是「同一个后端错误，在不同页面显示成三种样子」。
 *
 * 现在的契约（所有前端请求必须走这里）
 * ------------------------------------
 * 1. 失败一律抛 :class:`ApiError`，``message`` 优先取后端 ``detail``（本来就是给人看的
 *    中文），取不到才退化成 ``请求失败 <status>``
 * 2. ``status`` 挂在异常上 —— 页面据此区分「会话过期回密码门（401）」与「真故障（5xx）」
 * 3. 网络层失败（断网 / 跨域 / 超时）统一成 ``网络连接失败，请检查网络``
 * 4. 自动带 ``credentials: "same-origin"``（管理会话是 httpOnly cookie）
 * 5. ``query()` 统一拼 query（跳过空值），不再各页面手写模板串
 */

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(message: string, status: number, detail = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail || message;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

/** 拼 query string（跳过 ``""`` / ``null`` / ``undefined`` / ``false``）。 */
export function query(params: Query): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === "" || v === null || v === undefined || v === false) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/** 从后端响应体里取 ``detail``（FastAPI 统一错误体）。 */
function pickDetail(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  // 422 校验错误：detail 是 [{loc, msg, ...}]
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: unknown };
    if (typeof first?.msg === "string") return first.msg;
  }
  return "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** 请求体，自动 JSON.stringify + 设 Content-Type。 */
  json?: unknown;
  signal?: AbortSignal;
}

/**
 * 发一次请求并返回解析后的 JSON。
 *
 * @param url   完整路径（含 base，如 ``/api/story/list``）
 * @param opts  见 :interface:`RequestOptions`
 */
export async function request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", json, signal } = opts;
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    signal,
  };
  if (json !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // AbortError 要原样抛，调用方靠它区分「主动取消」与「真失败」
    if ((e as Error)?.name === "AbortError") throw e;
    throw new ApiError("网络连接失败，请检查网络", 0);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = pickDetail(await res.json());
    } catch {
      /* 非 JSON 错误体（nginx 502 HTML 等）：只用状态码 */
    }
    throw new ApiError(detail || `请求失败 ${res.status}`, res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("服务端返回了非 JSON 响应", res.status);
  }
}

/**
 * 按 base 前缀生成一套便捷方法。
 *
 * ```ts
 * const api = createApi("/api/story");
 * api.get<StoryList>("/list", { limit: 20 });
 * api.post<Story>("/admin/stories", data);
 * ```
 */
export function createApi(base: string) {
  const get = <T>(path: string, params?: Query, opts?: RequestOptions) =>
    request<T>(base + path + (params ? query(params) : ""), opts);
  const post = <T>(path: string, json?: unknown, opts?: RequestOptions) =>
    request<T>(base + path, { ...opts, method: "POST", json });
  const put = <T>(path: string, json?: unknown, opts?: RequestOptions) =>
    request<T>(base + path, { ...opts, method: "PUT", json });
  const del = <T>(path: string, json?: unknown, opts?: RequestOptions) =>
    request<T>(base + path, { ...opts, method: "DELETE", json });
  return { base, request: <T>(path: string, opts?: RequestOptions) => request<T>(base + path, opts), get, post, put, del };
}

/** 判断异常是否「会话失效」（页面据此回密码门）。 */
export function isUnauthorized(e: unknown): boolean {
  return (e as ApiError)?.status === 401;
}

/**
 * 复制到剪贴板（非 https / 老浏览器降级到 textarea）。
 * 原先只存在于 ``story/api.ts``，工具页各写一份 —— 统一到这里。
 */
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
