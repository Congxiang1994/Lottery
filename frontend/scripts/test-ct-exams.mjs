#!/usr/bin/env node
/**
 * CT 报告「检查次数」结构解析自测。
 *
 * 用法：`cd frontend && node scripts/test-ct-exams.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败。
 *
 * 覆盖：section 解析（次数 / 日期 / 项目 / 实体还原 / 格式容错）、
 * 滚动感知当前检查、图片→检查映射、灯箱标签、分页 CSS。
 *
 * ⚠️ 注入式验证：INJECT_FAIL=1 时故意注入必失败断言，证明断言有效。
 */
import {
  activeSectionIndex,
  collectImageExamMap,
  examSpan,
  imageExamLabels,
  imageExamMap,
  parseExams,
  pagedCss,
} from "../src/ct/exams.ts";

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

/* ========================= 1. 解析检查列表 ========================= */
const BODY = `<main>
<h1>CT检查结果</h1>
<p class="summary">共 4 次检查</p>
<section>
<p>检查时间：2023-05-27 10:15:26</p>
<p>检查项目：CT胸部(内科平扫)组套</p>
<img src="data:image/jpeg;base64,AA==" alt="报告照片">
</section>
<div class="sep"><span></span></div>
<section>
<p>检查时间：2023-12-22 16:54:35</p>
<p>检查项目：CT胸部（内科平扫）组套</p>
<img src="data:image/jpeg;base64,BB==" alt="报告照片">
</section>
<div class="sep"><span></span></div>
<section>
<p>检查时间：2026-01-21 08:00:38</p>
<p>检查项目：肺部CT &amp; 体检（瑞慈）</p>
<img src="data:image/jpeg;base64,CC==" alt="报告照片">
</section>
<div class="sep"><span></span></div>
<section>
<p>检查时间：2026-11-10 18:56:38</p>
<p>检查项目：CT胸部（内科）</p>
<img src="data:image/jpeg;base64,DD==" alt="报告照片">
</section>
</main>`;

const exams = parseExams(BODY);
eq("parse·共 4 次", exams.length, 4);
eq("parse·第 1 次日期", exams[0].date, "2023-05-27");
eq("parse·第 1 次完整时间", exams[0].datetime, "2023-05-27 10:15:26");
eq("parse·第 1 次项目", exams[0].project, "CT胸部(内科平扫)组套");
eq("parse·第 3 次项目（HTML 实体还原）", exams[2].project, "肺部CT & 体检（瑞慈）");
eq("parse·第 4 次日期", exams[3].date, "2026-11-10");
eq("parse·index 递增", exams.map((e) => e.index).join(","), "0,1,2,3");

// 容错：无 section
eq("parse·无 section 返回空", parseExams("<p>随便写点啥</p>").length, 0);
// 容错：缺字段
const partial = parseExams("<section><p>检查时间：2026-01-01</p></section>");
eq("parse·缺项目时为空串", partial[0].project, "");
eq("parse·缺项目时日期仍在", partial[0].date, "2026-01-01");
// 容错：冒号是半角
const halfColon = parseExams("<section><p>检查时间:2026-02-02 09:00</p><p>检查项目:X</p></section>");
eq("parse·半角冒号", halfColon[0].datetime, "2026-02-02 09:00");
eq("parse·半角冒号项目", halfColon[0].project, "X");
// 连续调用（正则 lastIndex 不得残留）
eq("parse·连续两次调用一致", parseExams(BODY).length, parseExams(BODY).length);

/* ========================= 2. 时间跨度 / 滚动感知 ========================= */
eq("span·首末不同", examSpan(exams), "2023-05-27 → 2026-11-10");
eq("span·单次", examSpan(parseExams("<section><p>检查时间：2026-01-01</p></section>")), "2026-01-01");
eq("span·空", examSpan([]), "");

eq("active·全在判定线之下 → 第 1 次", activeSectionIndex([400, 900, 1400, 1900], 160), 0);
eq("active·越过第 2 个", activeSectionIndex([-200, 100, 600, 1100], 160), 1);
eq("active·越过第 3 个", activeSectionIndex([-600, -100, 150, 700], 160), 2);
eq("active·底部兜底强制最后一次", activeSectionIndex([-600, -100, 150, 700], 160, true), 3);
eq("active·空", activeSectionIndex([], 160), 0);
eq("active·第一个刚好到判定线仍算第 1 次", activeSectionIndex([160, 500], 160), 0);
eq("active·第二个刚好到判定线算第 2 次", activeSectionIndex([-100, 160, 700], 160), 1);

/* ========================= 3. 图片 → 检查映射 ========================= */
eq("map·每次 1 张", imageExamMap([1, 1, 1, 1]).join(","), "0,1,2,3");
eq("map·某次 2 张", imageExamMap([1, 2, 1]).join(","), "0,1,1,2");
eq("map·空", imageExamMap([]).length, 0);

// DOM 版（最小替身：section 列表 + img.closest）
function fakeDom(imgToSection) {
  const sections = [{}, {}, {}, {}];
  const imgs = imgToSection.map((si) => ({
    closest: (sel) => (sel === "section" ? sections[si] : null),
  }));
  return {
    querySelectorAll(sel) {
      if (sel === "section") return sections;
      if (sel === "img") return imgs;
      return [];
    },
  };
}
eq("collectMap·四张各属一次", collectImageExamMap(fakeDom([0, 1, 2, 3])).join(","), "0,1,2,3");
eq("collectMap·第 2 次两张", collectImageExamMap(fakeDom([0, 1, 1, 2])).join(","), "0,1,1,2");
eq("collectMap·无容器", collectImageExamMap(null).length, 0);

/* ========================= 4. 灯箱标签 ========================= */
const labels = imageExamLabels(exams, [0, 1, 2, 3]);
eq("label·第 1 张", labels[0], "第 1 次检查 · 2023-05-27");
eq("label·第 3 张", labels[2], "第 3 次检查 · 2026-01-21");
eq("label·越界为空串", imageExamLabels(exams, [9])[0], "");
eq("label·-1 为空串", imageExamLabels(exams, [-1])[0], "");
eq("label·无检查列表", imageExamLabels([], [0])[0], "");

/* ========================= 5. 分页 CSS ========================= */
const css1 = pagedCss(0);
ok("paged·第 1 次只显示第 1 个 section", css1.includes("section:nth-of-type(1) { display: block; }"));
ok("paged·隐藏所有 section", css1.includes("section { display: none; }"));
ok("paged·隐藏分隔符", css1.includes(".sep { display: none; }"));
ok("paged·打印时全展开", css1.includes("@media print") && css1.includes("display: block !important"));
const css3 = pagedCss(2);
ok("paged·第 3 次选中第 3 个", css3.includes("nth-of-type(3)"));
ok("paged·负数下标钳到 1", pagedCss(-5).includes("nth-of-type(1)"));
ok("paged·data-paged 属性选择器", css1.includes('[data-paged="1"]'));

/* ========================= 6. 注入式验证 ========================= */
if (process.env.INJECT_FAIL === "1") {
  eq("【注入】故意失败", exams.length, 99);
}

console.log(
  failed === 0
    ? `✅ CT 检查次数结构自测通过（${passed} 条用例，0 失败）`
    : `❌ CT 检查次数结构自测失败：${failed} 条失败（共 ${passed + failed} 条）`,
);
process.exit(failed === 0 ? 0 : 1);
