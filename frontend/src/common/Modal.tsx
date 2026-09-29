import { createPortal } from "react-dom";

/**
 * 弹窗 Portal 容器：把弹窗渲染到 `document.body` 下，脱离页面路由容器。
 *
 * 为什么必须这么做（2026-09-29 实测确认）：
 * `position: fixed` 的包含块不是视口，而是最近的「transform / filter /
 * will-change / contain / perspective 非默认值」的祖先（CSS Transforms L1 §3.1）。
 * 路由容器 `App.tsx > .anim-page-in` 带入场动画，只要动画结束后仍保留
 * `transform`（例如 `animation-fill-mode: both` 会永久保留 to 关键帧值），
 * 弹窗的 `inset-0` 就会相对那个容器而不是视口 —— 症状是遮罩盖不住导航栏、
 * 页面一滚弹窗整个掉出视口（实测桌面遮罩只剩 `left=84 right=1196`，
 * 滚过一屏后面板 `top=-1489`）。
 *
 * 挂到 `document.body` 后，弹窗的包含块恒为初始包含块（视口），从根上免疫
 * 上述问题，且不再依赖任何祖先的 `overflow` / `z-index` / `transform` 约定。
 * 这与 `animation-fill-mode: backwards` 的修法是互补的：那条修复「当前」，
 * Portal 保证「以后任何人在祖先上加 transform 都不会再犯」。
 *
 * ⚠️ 两个容易误解的点：
 * 1. Portal 只改 DOM 挂载位置，**不影响 React 事件冒泡** —— 事件仍按组件树
 *    冒泡，所以 `onClick={onClose}` + 面板 `stopPropagation()` 的写法照常有效。
 * 2. 样式继承按 **DOM 树** 走。主题是 `<html class="site-night">` 全局类，
 *    body 下同样命中；但如果将来有弹窗依赖某个父级容器上的 CSS 变量，
 *    Portal 后会拿不到 —— 新写弹窗时注意别把变量定义在页面容器上。
 */
export function Modal({ children }: { children: React.ReactNode }) {
  // Vite SPA 无 SSR，这里只是防御性判断
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
