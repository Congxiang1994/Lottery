/**
 * 报告图片的纯逻辑（无 React 依赖，可在 Node 里直接跑测试）。
 *
 * 报告里的 4 张报告照是 **base64 内嵌的 `<img>`**（报告 HTML 自带），
 * 没有稳定 id 可供「点谁开谁」——所以做法是渲染后扫描容器，按文档顺序
 * 取出所有图片的 src，再由事件委托把点击映射回下标。
 */

/** 从报告容器里取出所有图片的 src（保持文档顺序，跳过空 src）。 */
export function collectImages(container: HTMLElement | null): string[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll("img"))
    .map((img) => img.getAttribute("src") || "")
    .filter((src) => src.length > 0);
}

/**
 * 命中判定：点击事件是否落在容器内的某张图片上；是则返回其下标，否则 -1。
 *
 * 用 `closest("img")` —— 点图片本身才算打开，点图片周围的空白不算。
 *
 * ⚠️ 判定用 **鸭子类型**（`typeof el.closest === "function"`）而非
 * `instanceof Element`：跨 realm（iframe 里的元素、Node 测试环境）时
 * `instanceof` 会失效 —— 那种情况下最典型症状是「点图没反应但不报错」。
 */
export function imageIndexAt(container: HTMLElement | null, target: EventTarget | null): number {
  if (!container || !target) return -1;
  const el = target as Element & { closest?: (s: string) => Element | null };
  if (typeof el.closest !== "function") return -1;
  const img = el.closest("img");
  if (!img || !container.contains(img)) return -1;
  const imgs = Array.from(container.querySelectorAll("img"));
  const idx = imgs.indexOf(img as HTMLImageElement);
  return idx >= 0 ? idx : -1;
}
