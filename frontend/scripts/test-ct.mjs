#!/usr/bin/env node
/**
 * CT 结构化数据前端逻辑自测。
 *
 * 用法：`cd frontend && node scripts/test-ct.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败。
 *
 * 覆盖：日期截取、图片全局下标换算（不等长照片数）、照片摊平与默认标题。
 *
 * ⚠️ 注入式验证：INJECT_FAIL=1 时故意注入必失败断言，证明断言有效。
 */
import { flattenPhotos, globalPhotoIndex, shortDate } from "../src/ct/logic.ts";

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

/* ---------- 1. shortDate ---------- */
eq("shortDate·完整时间", shortDate("2023-05-27 10:15:26"), "2023-05-27");
eq("shortDate·只有日期", shortDate("2026-11-10"), "2026-11-10");
eq("shortDate·空串", shortDate(""), "—");
eq("shortDate·非标准格式原样", shortDate("去年体检"), "去年体检");
eq("shortDate·不误截时间戳", shortDate("2026-1-2 08:00"), "2026-1-2 08:00");

/* ---------- 2. 测试数据（4 次检查，照片数 1/2/0/1） ---------- */
const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({
  id: i, caption: "", url: `${prefix}-${i}.jpg`,
}));
const exams = [
  { exam_time: "2023-05-27 10:15:26", photos: mk(1, "a") },
  { exam_time: "2023-12-22 16:54:35", photos: mk(2, "b") },
  { exam_time: "2026-01-21 08:00:38", photos: mk(0, "c") },
  { exam_time: "2026-11-10 18:56:38", photos: mk(1, "d") },
];

/* ---------- 3. globalPhotoIndex ---------- */
eq("idx·第1次第1张", globalPhotoIndex(exams, 0, 0), 0);
eq("idx·第2次第1张（前面累计1张）", globalPhotoIndex(exams, 1, 0), 1);
eq("idx·第2次第2张", globalPhotoIndex(exams, 1, 1), 2);
eq("idx·第3次无照片 → -1", globalPhotoIndex(exams, 2, 0), -1);
eq("idx·第4次第1张（跳过空检查）", globalPhotoIndex(exams, 3, 0), 3);
eq("idx·examIndex 越界", globalPhotoIndex(exams, 9, 0), -1);
eq("idx·examIndex 负数", globalPhotoIndex(exams, -1, 0), -1);
eq("idx·photoIndex 越界", globalPhotoIndex(exams, 0, 5), -1);
eq("idx·空检查列表", globalPhotoIndex([], 0, 0), -1);

/* ---------- 4. flattenPhotos ---------- */
const flat = flattenPhotos(exams);
eq("flat·总数", flat.length, 4);
eq("flat·顺序", flat.map((p) => p.url).join(","), "a-0.jpg,b-0.jpg,b-1.jpg,d-0.jpg");
eq("flat·第1张所属检查", flat[0].examIndex, 0);
eq("flat·第3张所属检查", flat[2].examIndex, 1);
eq("flat·第4张所属检查", flat[3].examIndex, 3);
eq("flat·默认标题（第1次）", flat[0].caption, "第 1 次检查 · 2023-05-27");
eq("flat·默认标题（第4次）", flat[3].caption, "第 4 次检查 · 2026-11-10");

// 已有 caption 时保留
const withCap = flattenPhotos([{ exam_time: "2026-01-01", photos: [{ id: 1, caption: "医生备注", url: "x.jpg" }] }]);
eq("flat·已有 caption 优先", withCap[0].caption, "医生备注");
eq("flat·空照片列表", flattenPhotos([{ exam_time: "2026-01-01", photos: [] }]).length, 0);

/* ---------- 5. 关键性质：globalPhotoIndex 与 flattenPhotos 下标一致 ---------- */
let consistent = true;
exams.forEach((e, ei) => {
  e.photos.forEach((_, pi) => {
    const idx = globalPhotoIndex(exams, ei, pi);
    if (idx < 0 || flat[idx]?.examIndex !== ei) consistent = false;
  });
});
ok("性质·下标换算与摊平结果一致", consistent);

/* ---------- 6. 注入式验证 ---------- */
if (process.env.INJECT_FAIL === "1") {
  eq("【注入】故意失败", globalPhotoIndex(exams, 1, 0), 99);
}

console.log(
  failed === 0
    ? `✅ CT 结构化逻辑自测通过（${passed} 条用例，0 失败）`
    : `❌ CT 结构化逻辑自测失败：${failed} 条失败（共 ${passed + failed} 条）`,
);
process.exit(failed === 0 ? 0 : 1);
