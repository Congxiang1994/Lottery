import { createContext, useContext, useEffect, useRef, useState } from "react";
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
 *
 * ────────────────────────────────────────────────────────────────────
 * 出场动画（2026-09-29 补）：为什么需要两层组件
 *
 * React 卸载是同步的：`{show && <Modal>…}` 里 `show` 一翻 false，弹窗这一帧
 * 就没了，CSS 根本没有时间播放任何退出动画。要做出场，必须**让弹窗多活
 * 一会儿**（等动画放完再卸），而「多活一会儿」必须发生在**条件渲染之外**
 * —— 也就是包住整个 `{cond && <X/>}` 表达式，而不是包在 `X` 内部。
 *
 * 于是分成两个组件，各管一件事：
 * · `ExitPresence` —— 放在条件渲染的**外面**，负责「挂载生命周期」：
 *   记住 children 快照、决定何时真正卸载、把 closing 态广播出去。
 * · `Modal` —— 仍在各弹窗组件内部，负责 Portal + 给内容套 `.modal-host`。
 *
 * 两者靠 Context 通信，因为 Portal 会打断 React 的 DOM 树，但**不会打断
 * Context**（Context 走组件树）。这样 `.modal-host` 落在 body 下，而控制它
 * 的 `data-closing` 来自页面流里的 ExitPresence —— 子孙选择器够不到，
 * Context 够得到。
 *
 * 用法（把原来的 `{cond && <X/>}` 整体包一层，`X` 内部不用动）：
 * ```tsx
 * <ExitPresence open={cond}>
 *   {cond && <StoryModal story={active} onClose={…} />}
 * </ExitPresence>
 * ```
 * `X` 自己一行都不用改 —— 这正是选择 Context 而非 prop 透传的原因：
 * 那 6 个弹窗组件（StoryModal / TaskModal / KeyModal / ConfirmModal…）
 * 全是纯 props 驱动的展示组件，加不透传 prop 会把调用点全弄脏。
 */

/**
 * 出场动画时长（ms）。**必须与 index.css 里 `.modal-host[data-closing]`
 * 下 `.anim-panel` 的动画时长保持一致**，否则要么动画没放完就被卸载，
 * 要么放完了还挂着挡操作。
 */
export const MODAL_EXIT_MS = 200;

/** closing = true 表示「正在播出场动画，马上就卸」。默认 false，
 *  所以没包 ExitPresence 的裸 Modal 行为与从前完全一致（无出场动画）。 */
const ExitCtx = createContext(false);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ExitPresence({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  /**
   * children 快照 —— 没有它会在关闭瞬间崩。
   *
   * 关闭弹窗的代码几乎都是「清 state」：`setActive(null)`、`setConfirmDel(null)`、
   * `setModal({ open: false, editing: null })`。这些 state 一旦变空，条件表达式
   * `{cond && <X story={active} />}` 会求值成 `false` ——
   * 而 `false` 渲染不出任何东西，遮罩当场消失，动画等于没做。
   *
   * 所以这里缓存「最后一次 open 状态下的 children」，closing 期间渲染它。
   * 存的是**已求值的 React 元素对象**，它内部的 props 是关闭前的有效数据，
   * 所以弹窗内容在淡出的 200ms 里保持完整，不会白屏、不会 `undefined.title`。
   *
   * ⚠️ 这是在 render 期间写 ref（React 说 render 应当纯净）。这里可以接受，
   * 因为读写都发生在同一次 render 内、写入的值就是本次的 props，不跨组件、
   * 不引发 UI 不一致；而且快照只有一个消费者（`open=false` 那一支），
   * 并发渲染下即便被中间态覆盖，值也仍是同一份 children。
   * 换 `useEffect` 同步反而不行：children 每次 render 都是新对象，
   * 会把 effect 拖进 setState 死循环。
   */
  const snap = useRef<React.ReactNode>(null);
  if (open) snap.current = children;

  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      // 连开连关：取消进行中的卸载，回到打开态（入场动画会自然重播）
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    // reduced-motion 下立即卸载：CSS 那边 animation 已被关掉，
    // 再等 200ms 只会让一个「已经不动」的弹窗白挂着
    const t = window.setTimeout(
      () => {
        setMounted(false);
        setClosing(false);
      },
      prefersReducedMotion() ? 0 : MODAL_EXIT_MS,
    );
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <ExitCtx.Provider value={closing}>
      {open ? children : snap.current}
    </ExitCtx.Provider>
  );
}

export function Modal({ children }: { children: React.ReactNode }) {
  const closing = useContext(ExitCtx);
  // Vite SPA 无 SSR，这里只是防御性判断
  if (typeof document === "undefined") return null;
  return createPortal(
    /* `.modal-host` 是 body 下的一个 0 高度空壳（内容全是 fixed，脱离文档流），
       存在的唯一目的是给 CSS 一个「这个弹窗正在退场」的挂点：
       `.modal-host[data-closing] .anim-overlay { animation: overlay-out … }`
       —— 用子孙选择器命中，就不必要求 11 个弹窗各自改类名。 */
    <div className="modal-host" data-closing={closing ? "" : undefined}>
      {children}
    </div>,
    document.body,
  );
}
