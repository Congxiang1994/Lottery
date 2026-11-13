import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { AppModal } from "../common/AppModal";
import {
  IDENTITY,
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
 * 报告照片预览 —— **全屏一张图**，没有任何文字/标题/按钮，跟相册一样。
 *
 * 交互（全部围绕这一张图）：
 * - 双指捏合放大照片本身（浏览器默认会缩放整个网页，这里接管）；
 * - 双击 1x / 2.5x 切换；放大后单指拖动；轻点任意处或右上角 × 关闭；
 * - 返回键 / 侧滑只关预览不离开页面（CT.tsx 的 useModalHistory）。
 *
 * ⚠️ 不能只靠 meta viewport 的 ``user-scalable=no``：iOS Safari 10+ 直接忽略它，
 * 而且会全局禁用整站缩放（无障碍倒退）。所以只在灯箱这一层用
 * ``touch-action: none`` + ``preventDefault`` 局部接管。
 */

export interface LightboxImage {
  url: string;
}

export interface LightboxProps {
  /** 要预览的那一张照片；null = 关闭 */
  image: LightboxImage | null;
  onClose: () => void;
}

interface Gesture {
  mode: "none" | "pan" | "pinch";
  startDist: number;
  startScale: number;
  lastX: number;
  lastY: number;
  lastTapAt: number;
  /** 本次触摸是否已经产生动作（拖拽/捏合/双击），用于区分「轻点关闭」 */
  moved: boolean;
}

const INITIAL_GESTURE: Gesture = {
  mode: "none", startDist: 0, startScale: 1,
  lastX: 0, lastY: 0, lastTapAt: 0, moved: false,
};

export function Lightbox({ image, onClose }: LightboxProps) {
  const open = !!image;

  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const gesture = useRef<Gesture>({ ...INITIAL_GESTURE });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /** 关闭时复位缩放 */
  useEffect(() => {
    setZoom(IDENTITY);
    gesture.current = { ...INITIAL_GESTURE };
  }, [image]);

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

  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;

    const points = (t: TouchList) =>
      Array.from(t).map((p) => ({ x: p.clientX, y: p.clientY }));

    // ⚠️ 按钮/链接上的触摸必须放行：preventDefault 会抑制合成 click，
    //    右上角 × 就会「点了没反应」。交给浏览器走原生 click → onClose。
    const isControl = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest("button, a, input");

    const onStart = (e: TouchEvent) => {
      if (isControl(e.target)) return; // 交互元素：不做手势，让 click 正常合成
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
      }
      // ⚠️ 必须 preventDefault：否则浏览器会同时执行整页缩放/滚动
      e.preventDefault();
    };

    const onMove = (e: TouchEvent) => {
      if (isControl(e.target)) return; // 交互元素：不参与手势
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
      if (isControl(e.target)) return; // 交互元素：交给原生 click 处理
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

    // 遮罩层其余区域也要掐掉浏览器默认 pinch-zoom。从 Portal 宿主
    // （Modal.tsx 挂到 body 的那层）找遮罩根，不写死遮罩类名。
    // 交互元素的判断复用上面的 isControl。
    const overlay = stage.closest(".modal-host")?.firstElementChild as HTMLElement | null;
    const stopBrowserZoom = (e: TouchEvent) => {
      if (!isControl(e.target)) e.preventDefault();
    };
    if (overlay) {
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

  // 键盘：+ - 缩放，0 复位（Esc 关闭由 AppModal 负责）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const factor = e.key === "+" || e.key === "=" ? 1.4 : e.key === "-" || e.key === "_" ? 1 / 1.4 : 0;
      if (!factor) {
        if (e.key === "0") setZoom(IDENTITY);
        return;
      }
      const { w, h, cw, ch } = measure();
      setZoom((z) => zoomAtPoint(z, z.scale * factor, 0, 0, w, h, cw, ch));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, measure]);

  if (!open || !image) return null;

  return (
    <AppModal
      onClose={onClose}
      bare
      size="lg"
      dismissable
      overlayClassName="ct-lightbox-overlay"
      ariaLabel="报告照片查看"
      className="ct-lightbox-panel"
    >
      {/* 全屏舞台：只有照片和右上角 ×，没有任何文字 */}
      <div ref={stageRef} className="ct-zoom-stage relative h-full w-full overflow-hidden">
        <div
          className="flex h-full w-full items-center justify-center"
          onDoubleClick={(e) => doubleTapAt(e.clientX, e.clientY)}
          onWheel={(e) => {
            e.preventDefault();
            const { w, h, cw, ch } = measure();
            const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            setZoom((z) => zoomAtPoint(z, z.scale * f, 0, 0, w, h, cw, ch));
          }}
        >
          <img
            ref={imgRef}
            src={image.url}
            alt="报告照片"
            draggable={false}
            className="ct-zoom-img block max-h-full max-w-full select-none object-contain"
            style={{ transform: transformOf(zoom) }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              doubleTapAt(e.clientX, e.clientY);
            }}
          />
        </div>

        {/* 右上角关闭：全屏模式下唯一常驻元素 */}
        <button
          type="button"
          onClick={onClose}
          title="关闭"
          aria-label="关闭"
          className="press absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-full border border-white/30 bg-black/45 text-white/90 transition hover:bg-black/65"
        >
          <X size={18} />
        </button>
      </div>
    </AppModal>
  );
}
