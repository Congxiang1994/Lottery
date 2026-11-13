#!/usr/bin/env node
/**
 * CT 结构化数据前端逻辑自测。
 *
 * 用法：`cd frontend && node scripts/test-ct.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败。
 *
 * ⚠️ 注入式验证：INJECT_FAIL=1 时故意注入必失败断言，证明断言有效。
 */
import { shortDate } from "../src/ct/logic.ts";
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

/* ========================= 1. shortDate ========================= */
eq("shortDate·完整时间", shortDate("2023-05-27 10:15:26"), "2023-05-27");
eq("shortDate·只有日期", shortDate("2026-11-10"), "2026-11-10");
eq("shortDate·空串", shortDate(""), "—");
eq("shortDate·非标准格式原样", shortDate("去年体检"), "去年体检");

/* ========================= 2. 缩放逻辑 ========================= */
eq("distance·勾股", distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
eq("midpoint", JSON.stringify(midpoint({ x: 0, y: 10 }, { x: 10, y: 20 })),
   JSON.stringify({ x: 5, y: 15 }));
eq("clampScale·正常", clampScale(2.5), 2.5);
eq("clampScale·低于下限", clampScale(0.2), MIN_SCALE);
eq("clampScale·高于上限", clampScale(99), MAX_SCALE);
eq("clampScale·NaN 回落", clampScale(NaN), MIN_SCALE);
eq("pinch·距离翻倍", pinchScale(1, 100, 200), 2);
eq("pinch·起始距离 0 不炸", pinchScale(1, 0, 100), MIN_SCALE);

// pan 钳制：容器 400x300、内容 200x150
const c1 = clampPan(500, -500, 3, 400, 300, 200, 150);
eq("clampPan·右边界", c1.panX, 100);
eq("clampPan·左边界", c1.panY, -75);
const c3 = clampPan(99, 99, 1, 400, 300, 200, 150);
eq("clampPan·未放大归零 X", c3.panX, 0);
eq("clampPan·未放大归零 Y", c3.panY, 0);

// 锚点缩放：回到 1x 必须完全归零
const back = zoomAtPoint({ scale: 2, panX: 40, panY: -30 }, 1, 0, 0, 400, 300, 200, 150);
eq("zoomAt·回到 1x 归零", `${back.scale}/${back.panX}/${back.panY}`, "1/0/0");
// 来回缩放归零
let z = IDENTITY;
z = zoomAtPoint(z, 3, 60, 40, 400, 300, 400, 300);
z = zoomAtPoint(z, 1, 60, 40, 400, 300, 400, 300);
eq("zoomAt·来回缩放 panX 归零", z.panX, 0);

// 双击切换
const d1 = toggleZoom(IDENTITY, 0, 0, 400, 300, 200, 150);
eq("toggleZoom·1x → 2.5x", d1.scale, DOUBLE_TAP_SCALE);
const d2 = toggleZoom({ scale: 3, panX: 20, panY: 10 }, 0, 0, 400, 300, 200, 150);
eq("toggleZoom·已放大 → 1x", d2.scale, 1);
eq("toggleZoom·pan 归零", d2.panX, 0);

eq("transform·identity", transformOf(IDENTITY), "translate3d(0px, 0px, 0) scale(1)");
eq("transform·放大", transformOf({ scale: 2, panX: 10, panY: -5 }),
   "translate3d(10px, -5px, 0) scale(2)");

/* ========================= 3. 注入式验证 ========================= */
if (process.env.INJECT_FAIL === "1") {
  eq("【注入】故意失败", clampScale(2.5), 99);
}

console.log(
  failed === 0
    ? `✅ CT 逻辑自测通过（${passed} 条用例，0 失败）`
    : `❌ CT 逻辑自测失败：${failed} 条失败（共 ${passed + failed} 条）`,
);
process.exit(failed === 0 ? 0 : 1);
