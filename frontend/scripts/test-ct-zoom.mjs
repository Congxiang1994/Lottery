#!/usr/bin/env node
/**
 * 灯箱照片缩放逻辑自测。
 *
 * 用法：`cd frontend && node scripts/test-ct-zoom.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败。
 *
 * 覆盖：距离/中点、scale 钳制、pan 钳制、捏合缩放、锚点缩放、双击切换、transform。
 *
 * ⚠️ 注入式验证：INJECT_FAIL=1 时故意注入必失败断言，证明断言有效。
 */
import {
  DOUBLE_TAP_SCALE,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  clampPan,
  clampScale,
  distance,
  midpoint,
  pinchScale,
  toggleZoom,
  transformOf,
  zoomAtPoint,
} from "../src/ct/zoom.ts";

let failed = 0;
let passed = 0;
function eq(name, actual, expected) {
  if (Object.is(actual, expected)) { passed += 1; return; }
  failed += 1;
  console.error(`❌ ${name}`);
  console.error(`   实际: ${JSON.stringify(actual)}`);
  console.error(`   期望: ${JSON.stringify(expected)}`);
}
function ok(name, cond, detail = "") {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error(`❌ ${name}${detail ? " — " + detail : ""}`);
}

/* ---------- 1. 基础几何 ---------- */
eq("distance·水平", distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
eq("distance·重合", distance({ x: 2, y: 2 }, { x: 2, y: 2 }), 0);
eq("midpoint", JSON.stringify(midpoint({ x: 0, y: 10 }, { x: 10, y: 20 })),
   JSON.stringify({ x: 5, y: 15 }));

/* ---------- 2. scale 钳制 ---------- */
eq("clampScale·正常", clampScale(2.5), 2.5);
eq("clampScale·低于下限", clampScale(0.2), MIN_SCALE);
eq("clampScale·高于上限", clampScale(99), MAX_SCALE);
eq("clampScale·NaN 回落到 1", clampScale(NaN), MIN_SCALE);
eq("clampScale·Infinity 回落到 1（非有限值统一回落）", clampScale(Infinity), MIN_SCALE);
eq("pinch·距离翻倍 → scale 翻倍", pinchScale(1, 100, 200), 2);
eq("pinch·距离减半 → scale 减半", pinchScale(2, 100, 50), 1);
eq("pinch·起始距离 0 不炸", pinchScale(1, 0, 100), MIN_SCALE);
eq("pinch·超出上限被钳", pinchScale(3, 10, 1000), MAX_SCALE);

/* ---------- 3. pan 钳制 ---------- */
// 容器 400x300，内容 200x150，scale=2 → 内容 400x300 恰好铺满，pan 必须为 0
const c0 = clampPan(50, -80, 2, 400, 300, 200, 150);
eq("clampPan·恰好铺满不允许平移 X", c0.panX, 0);
eq("clampPan·恰好铺满不允许平移 Y", c0.panY, 0);
// scale=3 → 内容 600x450，可溢出 (600-400)/2=100, (450-300)/2=75
const c1 = clampPan(500, -500, 3, 400, 300, 200, 150);
eq("clampPan·右边界", c1.panX, 100);
eq("clampPan·左边界", c1.panY, -75);
const c2 = clampPan(30, 20, 3, 400, 300, 200, 150);
eq("clampPan·范围内保持 X", c2.panX, 30);
eq("clampPan·范围内保持 Y", c2.panY, 20);
// 未放大 scale=1 → 内容 200x150 小于容器，pan 只能 0
const c3 = clampPan(99, 99, 1, 400, 300, 200, 150);
eq("clampPan·未放大归零 X", c3.panX, 0);
eq("clampPan·未放大归零 Y", c3.panY, 0);

/* ---------- 4. 锚点缩放 ---------- */
// 在中心(0,0)从 1 缩到 2：pan 保持 0（内容放大后被钳到 0）
const z1 = zoomAtPoint(IDENTITY, 2, 0, 0, 400, 300, 200, 150);
eq("zoomAt·中心锚 scale", z1.scale, 2);
eq("zoomAt·中心锚 panX", z1.panX, 0);
// 缩小回 1x 必须完全归零（避免残留微小偏移）
const back = zoomAtPoint({ scale: 2, panX: 40, panY: -30 }, 1, 0, 0, 400, 300, 200, 150);
eq("zoomAt·回到 1x 归零 scale", back.scale, 1);
eq("zoomAt·回到 1x 归零 panX", back.panX, 0);
eq("zoomAt·回到 1x 归零 panY", back.panY, 0);
// 非中心锚：容器 1000x800、内容 500x400，scale 1→2 时可溢出 (1000-1000)/2=0 → pan 0
// 用更大的场景验证锚点确实影响 pan
const z2 = zoomAtPoint(IDENTITY, 3, 100, 50, 400, 300, 400, 300);
ok("zoomAt·非中心锚产生平移", z2.panX !== 0 || z2.panY !== 0,
   JSON.stringify(z2));
// 同一锚点连续放大再缩小，pan 应回到 0（1x）
let z = IDENTITY;
z = zoomAtPoint(z, 3, 60, 40, 400, 300, 400, 300);
z = zoomAtPoint(z, 1, 60, 40, 400, 300, 400, 300);
eq("zoomAt·来回缩放回到 1x", z.scale, 1);
eq("zoomAt·来回缩放 panX 归零", z.panX, 0);

/* ---------- 5. 双击 ---------- */
const d1 = toggleZoom(IDENTITY, 0, 0, 400, 300, 200, 150);
eq("toggleZoom·1x → 2.5x", d1.scale, DOUBLE_TAP_SCALE);
const d2 = toggleZoom({ scale: 3, panX: 20, panY: 10 }, 0, 0, 400, 300, 200, 150);
eq("toggleZoom·已放大 → 1x", d2.scale, 1);
eq("toggleZoom·已放大 → pan 归零", d2.panX, 0);

/* ---------- 6. transform ---------- */
eq("transform·identity", transformOf(IDENTITY), "translate3d(0px, 0px, 0) scale(1)");
eq("transform·放大", transformOf({ scale: 2, panX: 10, panY: -5 }),
   "translate3d(10px, -5px, 0) scale(2)");

/* ---------- 7. 注入式验证 ---------- */
if (process.env.INJECT_FAIL === "1") {
  eq("【注入】故意失败", pinchScale(1, 100, 200), 99);
}

console.log(
  failed === 0
    ? `✅ CT 照片缩放自测通过（${passed} 条用例，0 失败）`
    : `❌ CT 照片缩放自测失败：${failed} 条失败（共 ${passed + failed} 条）`,
);
process.exit(failed === 0 ? 0 : 1);
