import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";

/**
 * 全站统一的「加载失败 + 重试」提示条。
 *
 * 视觉与 /story 页一致（rose 语义色 + 右侧重试），夜间配色由 index.css 的
 * `.site-night` 映射接管（bg-rose-50 / text-rose-700 / border-rose-600-25 均已映射）。
 *
 * 约定：任何页面只要请求失败，就渲染它，别再造各自风格的错误块 ——
 * 这样「失败态出现在哪、长什么样、怎么重试」在全站是同一个东西。
 * ⚠️ 一定要传 onRetry：只有文案没有出口的错误提示，用户唯一的动作就是刷新整页。
 */
export function ErrorBlock({
  message,
  onRetry,
  className = "",
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-rose-600/25 bg-rose-50 px-4 py-3 text-sm text-rose-700 ${className}`}
    >
      <AlertTriangle size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">{message || "加载失败，请稍后重试"}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="press inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-600/30 px-2.5 py-1 text-xs font-medium transition hover:bg-rose-600/10"
        >
          <RefreshCw size={12} />
          重试
        </button>
      )}
    </div>
  );
}

/**
 * 路由懒加载占位。
 *
 * 为什么是「一条扫光进度条」而不是卡片骨架：这个 fallback 被 15 个路由共用，
 * 画成卡片网格会让 /hanzi 播放页、/story 阅读页在加载瞬间闪现一屏「购物卡片」，
 * 比留白更像故障。进度条只表达「正在来」，不预设内容形状。
 *
 * 进度条用 Tailwind 的 animate-indeterminate（定义在 tailwind.config.cjs），
 * 不额外写 CSS —— 与全站动画共用一套缓动。
 */
export function RouteFallback() {
  return (
    <div className="pt-8" aria-busy="true">
      <span className="sr-only" role="status">
        加载中
      </span>
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-paper-100">
        <div className="h-full w-1/3 animate-indeterminate rounded-full bg-gradient-to-r from-brand-red to-brand-red2" />
      </div>
    </div>
  );
}

/**
 * 全站统一的「加载中」行内提示。
 *
 * 约定：**任何页面/面板的加载态都用它**，别再手写
 * ``<Loader2 className="animate-spin" /> 加载中…`` —— 全仓曾有 8 处手写，
 * 字体色、加载点大小、省略号（…/...）三处不一致。
 *
 * @param label 文案，默认「加载中…」
 * @param className 追加的外层类（多数场景用于居中/间距）
 */
export function Loading({
  label = "加载中…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={`flex items-center justify-center gap-2 text-xs text-paper-600 ${className}`}
    >
      <Loader2 size={14} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}

/**
 * 全站统一的「空数据」提示。
 *
 * 约定：空态必须说清「为什么空」或「空之后会有什么」，能传 hint 就传 ——
 * 只有「暂无数据」的空态，用户没法判断是自己筛太窄还是功能没数据。
 */
export function Empty({
  text = "暂无数据",
  hint,
  icon: Icon = Inbox,
  className = "",
}: {
  text?: string;
  hint?: string;
  icon?: typeof Inbox;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 py-10 text-center ${className}`}>
      <Icon size={26} className="text-paper-300" />
      <p className="text-xs font-medium text-paper-600">{text}</p>
      {hint && <p className="max-w-xs text-[11px] leading-relaxed text-paper-500">{hint}</p>}
    </div>
  );
}

/**
 * 把任意异常转成一句能给人看的话。
 *
 * ⚠️ 现在所有请求都走 ``common/http.ts``，它抛的是 :class:`ApiError`：
 * ``message`` 已经是「后端 detail 中文 / 网络失败提示 / 请求失败 N」三者之一，
 * 所以这里**优先直接用它**，不再去 message 里正则捞 JSON ——
 * 那段正则只对改造前「把整个响应体拼进 message」的旧客户端有意义。
 *
 * 保留下来的兜底：非 ApiError 的未知异常（渲染错误、第三方库）走原文截断。
 */
export function errText(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();
  if (!raw) return "未知错误";
  // 服务端 5xx：不把内部细节甩给用户（detail 里可能是堆栈/英文异常）
  const status = (e as { status?: number })?.status;
  if (typeof status === "number" && status >= 500) return `服务端异常，请稍后重试`;
  if (e instanceof Error && e.name === "ApiError") return raw.slice(0, 80);
  // 兜底：旧格式 `请求失败 500: {...}`
  const detail = raw.match(/\{"detail"\s*:\s*"([^"]{1,80})"\}/);
  if (detail) return detail[1];
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(raw)) {
    return "网络连接失败，请检查网络";
  }
  const code = raw.match(/请求失败\s+(\d{3})/);
  if (code) {
    return Number(code[1]) >= 500 ? "服务端异常，请稍后重试" : `请求失败（${code[1]}）`;
  }
  return raw.slice(0, 60);
}
