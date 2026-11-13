import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

import { AppModal } from "../common/AppModal";
import { collectImages, imageIndexAt } from "./images";

/**
 * 报告图片灯箱：点图放大 + 左右切换 + 键盘导航。
 *
 * 为什么单独做
 * ------------
 * 报告里的 4 张报告照是 **base64 内嵌的 `<img>`**（报告 HTML 自带），
 * 没有稳定的 id / src 可供「点谁开谁」——所以做法是：
 * 1. 渲染完报告后扫描容器，取出所有 `<img>` 的 src（顺序 = 报告里的顺序）；
 * 2. 给每张图挂一个点击手势（事件委托，**不改报告 HTML**）；
 * 3. 点第 n 张 → 打开灯箱，从第 n 张开始，支持左右切换。
 *
 * ⚠️ **不改报告 HTML** 是硬约束：报告要「原样呈现」，注入属性/包裹元素都会
 * 改变它的 DOM 结构。事件委托 + 外部状态是唯一不碰原文的做法。
 *
 * 纯逻辑（collectImages / imageIndexAt）在 `images.ts` —— 不依赖 React，
 * 可在 Node 里直接跑测试（见 `scripts/test-ct-lightbox.mjs`）。
 */

export interface LightboxProps {
  /** 全部图片（base64 data URL） */
  images: string[];
  /** 当前查看的下标；-1 表示未打开 */
  index: number;
  /** 切换到某一张（传 -1 关闭） */
  onIndexChange: (index: number) => void;
  /** 关闭 */
  onClose: () => void;
}

export function Lightbox({ images, index, onIndexChange, onClose }: LightboxProps) {
  const open = index >= 0 && index < images.length;
  const prev = useCallback(() => {
    if (images.length < 2) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }, [index, images.length, onIndexChange]);
  const next = useCallback(() => {
    if (images.length < 2) return;
    onIndexChange((index + 1) % images.length);
  }, [index, images.length, onIndexChange]);

  // 键盘：← → 切换，Esc 关闭（AppModal 负责 Esc，这里只管方向键）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  if (!open) return null;
  const src = images[index];

  return (
    <AppModal
      onClose={onClose}
      bare
      size="lg"
      dismissable
      overlayClassName="ct-lightbox-overlay"
      ariaLabel="报告图片查看"
      className="ct-lightbox-panel"
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* 顶部：序号 + 关闭 */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-2 text-white/80">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <ZoomIn size={13} />
            {index + 1} / {images.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="press grid h-8 w-8 place-items-center rounded-full border border-white/25 text-white/85 transition hover:bg-white/15 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* 图片本体：点图也关闭（与常见看图一致），但左右按钮要拦住冒泡 */}
        <div
          className="flex min-h-0 flex-1 items-center justify-center overflow-auto"
          onClick={onClose}
        >
          <img
            src={src}
            alt={`报告照片 ${index + 1}`}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        {/* 底部：左右切换 + 缩略图 */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
              title="上一张"
              aria-label="上一张"
              className="press absolute left-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/35 text-white/90 transition hover:bg-black/55"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
              title="下一张"
              aria-label="下一张"
              className="press absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/35 text-white/90 transition hover:bg-black/55"
            >
              <ChevronRight size={20} />
            </button>

            <div
              className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-1 pt-3"
              onClick={(e) => e.stopPropagation()}
            >
              {images.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onIndexChange(i)}
                  title={`第 ${i + 1} 张`}
                  aria-label={`查看第 ${i + 1} 张`}
                  className={`press h-12 w-12 overflow-hidden rounded-md border-2 transition ${
                    i === index
                      ? "border-brand-gold opacity-100"
                      : "border-white/25 opacity-55 hover:opacity-90"
                  }`}
                >
                  <img src={s} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </AppModal>
  );
}

/**
 * 给报告容器挂「点图放大」手势（事件委托）。
 *
 * 用 `useEffect` 在容器上监听 click：命中 `<img>` 时算出它的序号并回调。
 * 判定「点在图上」用 `event.target` 的最近 `<img>` 祖先 —— 点图片本身
 * （而非图片周围的空白）才算打开。
 */
/**
 * 给报告容器挂「点图放大」手势（事件委托）。
 *
 * ⚠️ 必须用 **callback ref** 而不是 `useRef` + `useEffect`：
 * 报告正文是异步取回后才渲染的（`dangerouslySetInnerHTML`），
 * 若在 mount 时挂监听，那时 `containerRef.current` 还是 `null` → 监听器
 * **永远不会挂上**，症状是「点图完全没反应，页面也不报错」。
 *
 * 返回 `attach(node)`：调用方把它包进自己的 ref 回调里 —
 * **必须同时把 node 存进 state**（图片列表要靠它收集），
 * 只挂监听不存节点 → `images` 永远是空数组 → 灯箱打不开。
 */
export function useImageClick(
  onImageClick: (index: number) => void,
): (node: HTMLElement | null) => void {
  const handlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  return useCallback(
    (node: HTMLElement | null) => {
      // 卸载旧节点：先摘监听再换引用（避免重复挂载导致一次点击开两个灯箱）
      const old = nodeRef.current;
      if (old && handlerRef.current) {
        old.removeEventListener("click", handlerRef.current);
      }
      nodeRef.current = node;
      handlerRef.current = null;
      if (!node) return;

      const handler = (e: MouseEvent) => {
        const idx = imageIndexAt(node, e.target);
        if (idx >= 0) onImageClick(idx);
      };
      handlerRef.current = handler;
      node.addEventListener("click", handler);
    },
    [onImageClick],
  );
}

/** 报告图片的可读描述（给无障碍用）。 */
export function useImageCount(containerRef: React.RefObject<HTMLElement | null>): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setCount(collectImages(el).length);
  }, [containerRef]);
  return count;
}
