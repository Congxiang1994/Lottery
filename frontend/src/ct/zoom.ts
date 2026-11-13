/**
 * 灯箱照片缩放的纯逻辑（无 React / DOM 依赖，可在 Node 里直接跑测试）。
 *
 * 背景
 * ----
 * 移动端双指捏合默认触发**整页缩放**（浏览器行为），医生想放大看报告细节时
 * 放大的是整个网页而不是照片。所以灯箱要自己接管触摸手势：
 *   - 容器 ``touch-action: none`` + ``preventDefault`` 掐掉浏览器默认缩放
 *   - 双指距离 → scale，双指中心 → 平移锚点
 *   - 单指拖拽 → 平移（放大后）
 *   - 双击 → 1x / 2.5x 切换
 *
 * 变换模型：``transform: translate(panX, panY) scale(scale)``，
 * 以**容器中心**为变换原点。pan 需要钳制，避免把图片拖出视口留一大片空白。
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const DOUBLE_TAP_SCALE = 2.5;

export interface ZoomState {
  scale: number;
  panX: number;
  panY: number;
}

export const IDENTITY: ZoomState = { scale: 1, panX: 0, panY: 0 };

/** 两点距离（像素）。 */
export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 两点中点。 */
export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 把 scale 钳在 [MIN_SCALE, MAX_SCALE]。 */
export function clampScale(s: number): number {
  if (!Number.isFinite(s)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * 钳制平移：图片放大后可拖动的边界。
 *
 * ``containerW/H`` 是容器尺寸，``contentW/H`` 是图片在 scale=1 时显示的尺寸。
 * 放大后的可溢出量 = (contentW * scale - containerW) / 2；
 * 若内容比容器小（没溢出），pan 只能是 0 —— 否则图片会被拖偏。
 */
export function clampPan(
  panX: number,
  panY: number,
  scale: number,
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
): { panX: number; panY: number } {
  const maxX = Math.max(0, (contentW * scale - containerW) / 2);
  const maxY = Math.max(0, (contentH * scale - containerH) / 2);
  // ``+ 0`` 把 -0 规范成 0：否则 transform 里会出现 ``translate3d(-0px, …)``，
  // 测试里 Object.is(-0, 0) 也会假失败。
  const cx = Math.min(maxX, Math.max(-maxX, panX)) + 0;
  const cy = Math.min(maxY, Math.max(-maxY, panY)) + 0;
  return { panX: cx, panY: cy };
}

/** 从「起始双指距离」算新 scale（相对起始 scale 按比例缩放）。 */
export function pinchScale(startScale: number, startDist: number, currentDist: number): number {
  if (startDist <= 0) return clampScale(startScale);
  return clampScale(startScale * (currentDist / startDist));
}

/**
 * 以**容器内某点**为锚缩放：保持该点在图片上的位置不动。
 *
 * ``anchorX/Y`` 是相对容器中心的坐标（不是页面坐标）。
 * 推导：设缩放前图片上一点 p，屏幕位置 = center + pan + p * scale。
 * 保持锚点 a 对应的图片坐标不变：
 *   a = pan + p * s  →  p = (a - pan) / s
 *   a = pan' + p * s'  →  pan' = a - (a - pan) * s' / s
 */
export function zoomAtPoint(
  state: ZoomState,
  nextScale: number,
  anchorX: number,
  anchorY: number,
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
): ZoomState {
  const s = state.scale;
  const s2 = clampScale(nextScale);
  if (s <= 0) return IDENTITY;
  const ratio = s2 / s;
  let panX = anchorX - (anchorX - state.panX) * ratio;
  let panY = anchorY - (anchorY - state.panY) * ratio;
  const clamped = clampPan(panX, panY, s2, containerW, containerH, contentW, contentH);
  panX = clamped.panX;
  panY = clamped.panY;
  // 回到 1x 时归零，避免残留微小偏移
  if (s2 === MIN_SCALE) return IDENTITY;
  return { scale: s2, panX, panY };
}

/** 双击：在 1x 与 DOUBLE_TAP_SCALE 之间切换（已放大则复位）。 */
export function toggleZoom(
  state: ZoomState,
  anchorX: number,
  anchorY: number,
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
): ZoomState {
  const next = state.scale > MIN_SCALE + 0.01 ? MIN_SCALE : DOUBLE_TAP_SCALE;
  return zoomAtPoint(state, next, anchorX, anchorY, containerW, containerH, contentW, contentH);
}

/** 生成 CSS transform 字符串。 */
export function transformOf(state: ZoomState): string {
  return `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.scale})`;
}
