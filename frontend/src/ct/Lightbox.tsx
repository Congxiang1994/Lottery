import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X, ZoomIn } from "lucide-react";

import { AppModal } from "../common/AppModal";
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  clampPan,
  distance,
  midpoint,
  pinchScale,
  toggleZoom,
  transformOf,
  zoomAtPoint,
  type ZoomState,
} from "./zoom";

/**
 * 报告图片灯箱：点图放大 + 左右切换 + 键盘导航 + **照片自身的双指缩放**。
 *
 * 移动端问题（2026-11-13 修）
 * --------------------------
 * 双指捏合原本被浏览器当成「缩放整个网页」—— 医生想放大看报告细节，
 * 结果整页跟着变大、照片没变大。修法：
 *   1. 图片容器 ``touch-action: none``（CSS，见 index.css 的 .ct-zoom-stage），
 *      并在 touchmove 里 ``preventDefault()`` —— 双管齐下掐掉浏览器默认手势；
 *   2. 自己算 scale / pan（``zoom.ts`` 的纯函数），
 *      ``transform: translate3d(...) scale(...)`` 只作用在图片上；
 *   3. 双击 / 双击按钮 / +- 按钮 / 滚轮 也能缩放，桌面端同样可用。
 *
 * ⚠️ 不能只靠 meta viewport 的 ``user-scalable=no``：
 *   - iOS Safari 10+ 直接忽略它；
 *   - 而且会**全局**禁用整站缩放（无障碍倒退），其它页面不该受牵连。
 *   所以只在灯箱这一层用 touch-action + preventDefault 局部接管。
 */

/** 灯箱里的一张图 */
export interface LightboxImage {
  url: string;
  /** 顶部副标题（如「第 2 次检查 · 2023-12-22」） */
  caption?: string;
}

export interface LightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 兼容旧调用：额外的副标题数组（优先级低于 images[].caption） */
  labels?: string[];
}

interface Gesture {
  mode: "none" | "pan" | "pinch";
  startDist: number;
  startScale: number;
  startPanX: number;
  startPanY: number;
  lastX: number;
  lastY: number;
  lastTapAt: number;
  /** 本次触摸是否已经产生动作（拖拽/捏合/双击），用于区分「轻点关闭」 */
  moved: boolean;
}

const INITIAL_GESTURE: Gesture = {
  mode: "none", startDist: 0, startScale: 1,
  startPanX: 0, startPanY: 0, lastX: 0, lastY: 0, lastTapAt: 0, moved: false,
};

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

  // 缩放状态
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const gesture = useRef<Gesture>({ ...INITIAL_GESTURE });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** 切图时复位缩放（否则看下一张时还带着上一张的放大状态） */
  useEffect(() => {
    setZoom(IDENTITY);
    gesture.current = { ...INITIAL_GESTURE };
  }, [index]);

  /** 量容器与图片显示尺寸（供 pan 钳制） */
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { w: 0, h: 0, cw: 0, ch: 0 };
    const r = stage.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    // 图片已被 transform 缩放，先还原到 scale=1 的尺寸
    const s = zoomRef.current.scale || 1;
    return { w: r.width, h: r.height, cw: ir.width / s, ch: ir.height / s };
  }, []);

  const applyZoom = useCallback((fn: (z: ZoomState) => ZoomState) => {
    setZoom((z) => fn(z));
  }, []);

  /** 缩放按钮 / 滚轮：以容器中心为锚 */
  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h, cw, ch } = measure();
      setZoom((z) => zoomAtPoint(z, z.scale * factor, 0, 0, w, h, cw, ch));
    },
    [measure],
  );

  /** 双击复位/放大：以点击位置为锚（相对容器中心） */
  const doubleTapAt = useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const ax = clientX - r.left - r.width / 2;
      const ay = clientY - r.top - r.height / 2;
      const { w, h, cw, ch } = measure();
      setZoom((z) => toggleZoom(z, ax, ay, w, h, cw, ch));
    },
    [measure],
  );

  /* ---------------- 触摸手势 ---------------- */

  // 键盘 + 触摸共用：双击阈值 300ms / 20px
  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;

    const points = (t: TouchList) =>
      Array.from(t).map((p) => ({ x: p.clientX, y: p.clientY }));

    const onStart = (e: TouchEvent) => {
      const g = gesture.current;
      if (e.touches.length === 2) {
        const [a, b] = points(e.touches);
        g.mode = "pinch";
        g.startDist = distance(a, b);
        g.startScale = zoomRef.current.scale;
        g.lastTapAt = 0; // 捏合不是轻点，别让下一根手指误判成双击
        g.moved = true;
      } else if (e.touches.length === 1) {
        const p = points(e.touches)[0];
        const now = Date.now();
        // ⚠️ 双击必须自己检测：移动端 touch 序列**不一定**合成 dblclick
        // （iOS Safari / 部分安卓 WebView 上双击只放大网页，不给 dblclick）。
        const near = Math.hypot(p.x - g.lastX, p.y - g.lastY) < 20;
        if (now - g.lastTapAt < 300 && near) {
          doubleTapAt(p.x, p.y);
          g.lastTapAt = 0; // 消费掉，避免三连击被当成两次双击
          g.moved = true;
        } else {
          g.lastTapAt = now;
          g.moved = false;
        }
        g.mode = "pan";
        g.lastX = p.x;
        g.lastY = p.y;
        g.startPanX = zoomRef.current.panX;
        g.startPanY = zoomRef.current.panY;
      }
      // ⚠️ 必须 preventDefault：否则浏览器会同时执行整页缩放/滚动
      e.preventDefault();
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault(); // 掐掉浏览器默认 pinch-zoom / 页面滚动
      const g = gesture.current;
      if (e.touches.length === 2 && g.mode === "pinch") {
        const [a, b] = points(e.touches);
        const center = midpoint(a, b);
        const stageRect = stage.getBoundingClientRect();
        const ax = center.x - stageRect.left - stageRect.width / 2;
        const ay = center.y - stageRect.top - stageRect.height / 2;
        const { w, h, cw, ch } = measure();
        const s2 = pinchScale(g.startScale, g.startDist, distance(a, b));
        setZoom((z) => zoomAtPoint(z, s2, ax, ay, w, h, cw, ch));
      } else if (e.touches.length === 1 && g.mode === "pan") {
        const p = points(e.touches)[0];
        const { w, h, cw, ch } = measure();
        const z = zoomRef.current;
        const dx = p.x - g.lastX;
        const dy = p.y - g.lastY;
        g.lastX = p.x;
        g.lastY = p.y;
        if (Math.hypot(dx, dy) > 3) g.moved = true;
        if (z.scale <= MIN_SCALE + 0.01) return; // 未放大时不平移
        const c = clampPan(z.panX + dx, z.panY + dy, z.scale, w, h, cw, ch);
        setZoom({ ...z, ...c });
      }
    };

    const onEnd = (e: TouchEvent) => {
      const g = gesture.current;
      if (e.touches.length === 1) {
        // 双指结束若还剩一根手指，切换成 pan 模式，避免继续捏合
        const p = points(e.touches)[0];
        g.mode = "pan";
        g.lastX = p.x;
        g.lastY = p.y;
      } else if (e.touches.length === 0) {
        // ⚠️ touchstart 的 preventDefault 会抑制合成 click，
        // 所以「轻点关闭」要在这里自己处理（且仅在未放大、没拖动、非双击时）。
        if (g.mode === "pan" && !g.moved && zoomRef.current.scale <= MIN_SCALE + 0.01) {
          const now = Date.now();
          // 单击关闭延后 300ms：等一等，若紧跟着第二次轻点则是双击（不关）
          const firstTapAt = g.lastTapAt;
          window.setTimeout(() => {
            if (gesture.current.lastTapAt !== firstTapAt) return; // 已被双击消费
            onClose();
          }, 300);
        }
        g.mode = "none";
      }
      e.preventDefault();
    };

    // ⚠️ passive:false 才能 preventDefault
    stage.addEventListener("touchstart", onStart, { passive: false });
    stage.addEventListener("touchmove", onMove, { passive: false });
    stage.addEventListener("touchend", onEnd, { passive: false });
    stage.addEventListener("touchcancel", onEnd, { passive: false });

    // ⚠️ 遮罩层其余区域（顶部栏、底部缩略图、图片外的留白）也要掐掉浏览器默认
    //    pinch-zoom —— 否则手指没落在 stage 上时，双指还是会缩放整个网页。
    //    这里只做 preventDefault，不改缩放逻辑（逻辑仍由 stage 上的监听负责）。
    // 从 Portal 宿主节点（Modal.tsx 挂到 body 的那层）找到遮罩根，
    // 不写死遮罩类名，避免与全站弹窗实现耦合。
    const overlay = stage.closest(".modal-host")?.firstElementChild as HTMLElement | null;
    // ⚠️ 只拦「非交互元素」上的触摸：若对按钮也 preventDefault，
    //    iOS 上按钮的 click 不会合成 → 关闭/上一张/下一张/缩略图全点不动。
    const isControl = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest("button, a, input");
    const stopBrowserZoom = (e: TouchEvent) => {
      if (!isControl(e.target)) e.preventDefault();
    };
    if (overlay) {
      // touchstart 也要拦：iOS Safari 在 touchstart 阶段就可能开始整页缩放
      overlay.addEventListener("touchstart", stopBrowserZoom, { passive: false });
      overlay.addEventListener("touchmove", stopBrowserZoom, { passive: false });
    }
    return () => {
      stage.removeEventListener("touchstart", onStart);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("touchend", onEnd);
      stage.removeEventListener("touchcancel", onEnd);
      if (overlay) {
        overlay.removeEventListener("touchstart", stopBrowserZoom);
        overlay.removeEventListener("touchmove", stopBrowserZoom);
      }
    };
  }, [open, measure, doubleTapAt, onClose]);

  // 键盘：← → 切换，+ - 缩放，0 复位（Esc 由 AppModal 负责）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "+" || e.key === "=") zoomBy(1.4);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.4);
      else if (e.key === "0") setZoom(IDENTITY);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next, zoomBy]);

  if (!open) return null;
  const src = images[index].url;
  const caption = images[index].caption || labels[index] || "";
  const zoomPct = Math.round(zoom.scale * 100);

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
        {/* 顶部：序号 + 所属检查 + 缩放控件 + 关闭 */}
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
          <div className="flex items-center gap-1.5">
            {/* 桌面端也能用的缩放按钮；移动端主要靠双指 */}
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.4)}
              disabled={zoom.scale <= MIN_SCALE + 0.01}
              title="缩小"
              aria-label="缩小"
              className="press grid h-8 w-8 place-items-center rounded-full border border-white/25 text-white/85 transition hover:bg-white/15 disabled:opacity-30"
            >
              <Minus size={14} />
            </button>
            <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-white/70">
              {zoomPct}%
            </span>
            <button
              type="button"
              onClick={() => zoomBy(1.4)}
              disabled={zoom.scale >= MAX_SCALE - 0.01}
              title="放大"
              aria-label="放大"
              className="press grid h-8 w-8 place-items-center rounded-full border border-white/25 text-white/85 transition hover:bg-white/15 disabled:opacity-30"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              onClick={() => setZoom(IDENTITY)}
              disabled={zoom.scale === MIN_SCALE}
              title="复位"
              aria-label="复位缩放"
              className="press grid h-8 w-8 place-items-center rounded-full border border-white/25 text-white/85 transition hover:bg-white/15 disabled:opacity-30"
            >
              <RotateCcw size={13} />
            </button>
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
        </div>

        {/* 图片舞台：touch-action:none + preventDefault 接管手势，只缩放照片不缩放网页 */}
        <div
          ref={stageRef}
          className="ct-zoom-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          onClick={(e) => {
            // 单击（非拖拽）关闭；放大时不误关，交给双击复位
            if (zoomRef.current.scale > MIN_SCALE + 0.01) return;
            if (e.target === e.currentTarget) onClose();
          }}
          onDoubleClick={(e) => doubleTapAt(e.clientX, e.clientY)}
          onWheel={(e) => {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt={`报告照片 ${index + 1}`}
            draggable={false}
            className="ct-zoom-img block max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
            style={{ transform: transformOf(zoom) }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              doubleTapAt(e.clientX, e.clientY);
            }}
          />
          {zoom.scale > MIN_SCALE + 0.01 && (
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 text-[10px] text-white/80">
              单指拖动查看 · 双击复位
            </span>
          )}
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
              className="press absolute left-1 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/35 text-white/90 transition hover:bg-black/55"
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
              className="press absolute right-1 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/35 text-white/90 transition hover:bg-black/55"
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

        <p className="shrink-0 pt-2 text-center text-[10px] text-white/55">
          双指捏合放大照片 · 双击放大/复位 · 单指拖动
        </p>
      </div>
    </AppModal>
  );
}
