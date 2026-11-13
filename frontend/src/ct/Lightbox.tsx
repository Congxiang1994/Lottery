import { useCallback, useEffect } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

import { AppModal } from "../common/AppModal";

/**
 * 报告图片灯箱：点图放大 + 左右切换 + 键盘导航。
 *
 * 图片由页面按检查记录传入（``LightboxImage[]``，含 url 与副标题），
 * 点第 n 张 → 从第 n 张开始，支持左右箭头 / 方向键 / 底部缩略图切换。
 */

/** 灯箱里的一张图 */
export interface LightboxImage {
  url: string;
  /** 顶部副标题（如「第 2 次检查 · 2023-12-22」） */
  caption?: string;
}

export interface LightboxProps {
  /** 全部图片 */
  images: LightboxImage[];
  /** 当前查看的下标；-1 表示未打开 */
  index: number;
  /** 切换到某一张 */
  onIndexChange: (index: number) => void;
  /** 关闭 */
  onClose: () => void;
  /** 兼容旧调用：额外的副标题数组（优先级低于 images[].caption） */
  labels?: string[];
}

export function Lightbox({ images, index, onIndexChange, onClose, labels = [] }: LightboxProps) {
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
  const src = images[index].url;
  const caption = images[index].caption || labels[index] || "";

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
        {/* 顶部：序号 + 所属检查 + 关闭 */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-1 pb-2 text-white/80">
          <div className="flex items-baseline gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs">
              <ZoomIn size={13} />
              {index + 1} / {images.length}
            </span>
            {caption && (
              <span className="text-xs font-medium text-white/70">{caption}</span>
            )}
          </div>
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
              {images.map((img, i) => (
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
                  <img src={img.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </AppModal>
  );
}
