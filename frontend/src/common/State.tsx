import { AlertTriangle, RefreshCw } from "lucide-react";

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

/** 把任意异常转成一句能给人看的话。
 *  fetch 抛出来的原文是 `TypeError: Failed to fetch`、`请求失败 500: {"detail":"..."}`
 *  这类，直接甩到界面上既不友好也读不懂 —— 这里统一收敛一遍。 */
export function errText(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).trim();
  if (!raw) return "未知错误";
  // 后端统一错误体 `{"detail":"..."}`：里面的中文通常是给人看的，优先取它
  const detail = raw.match(/\{"detail"\s*:\s*"([^"]{1,80})"\}/);
  if (detail) return detail[1];
  const code = raw.match(/请求失败\s+(\d{3})/);
  if (code) {
    return Number(code[1]) >= 500 ? "服务端异常，请稍后重试" : `请求失败（${code[1]}）`;
  }
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(raw)) {
    return "网络连接失败，请检查网络";
  }
  return raw.slice(0, 60);
}
