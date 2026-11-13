#!/usr/bin/env node
/**
 * CT 报告图片灯箱的纯逻辑自测。
 *
 * 用法：`cd frontend && node scripts/test-ct-lightbox.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败。
 *
 * 覆盖：图片收集（顺序 / 过滤空 src / 无容器 / 嵌套）。
 *
 * ⚠️ 注入式验证：INJECT_FAIL=1 时故意注入必失败断言，证明断言有效。
 */
import { collectImages, imageIndexAt } from "../src/ct/images.ts";

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

/* 最小 DOM 替身：只需 querySelectorAll("img") 与 getAttribute("src") */
function fakeContainer(imgs) {
  return {
    querySelectorAll(sel) {
      if (sel !== "img") return [];
      return imgs.map((src) => ({ getAttribute: (a) => (a === "src" ? src : null) }));
    },
  };
}

/** 带 closest/contains 的最小 Element 替身 */
function fakeElement(tag, imgList, index) {
  const self = {
    tagName: tag.toUpperCase(),
    closest(sel) {
      if (sel === "img" && tag === "img") return imgList[index];
      return null;
    },
  };
  return self;
}

function fakeContainerWithElements(imgList) {
  return {
    querySelectorAll(sel) {
      if (sel !== "img") return [];
      return imgList;
    },
    contains(el) {
      return imgList.includes(el);
    },
  };
}

eq("collect·无容器", collectImages(null).length, 0);
eq("collect·空容器", collectImages(fakeContainer([])).length, 0);
eq("collect·四张图", collectImages(fakeContainer(["a", "b", "c", "d"])).length, 4);
eq(
  "collect·保持文档顺序",
  JSON.stringify(collectImages(fakeContainer(["x1", "x2", "x3"]))),
  JSON.stringify(["x1", "x2", "x3"]),
);
eq(
  "collect·过滤空 src",
  JSON.stringify(collectImages(fakeContainer(["a", "", "c", null, "d"]))),
  JSON.stringify(["a", "c", "d"]),
);
eq(
  "collect·base64 data URL 保留原样",
  collectImages(fakeContainer(["data:image/jpeg;base64,AA=="]))[0],
  "data:image/jpeg;base64,AA==",
);

/* ---------- imageIndexAt：点击 → 下标映射 ---------- */
const imgObjs = [{ id: "i0" }, { id: "i1" }, { id: "i2" }];
const c2 = fakeContainerWithElements(imgObjs);
eq("imageIndexAt·点在第 1 张", imageIndexAt(c2, fakeElement("img", imgObjs, 0)), 0);
eq("imageIndexAt·点在第 3 张", imageIndexAt(c2, fakeElement("img", imgObjs, 2)), 2);
eq("imageIndexAt·点非图片", imageIndexAt(c2, fakeElement("p", imgObjs, 0)), -1);
eq("imageIndexAt·无容器", imageIndexAt(null, fakeElement("img", imgObjs, 0)), -1);
eq("imageIndexAt·无 target", imageIndexAt(c2, null), -1);
eq("imageIndexAt·target 无 closest", imageIndexAt(c2, { tagName: "IMG" }), -1);
eq("imageIndexAt·容器外图片", imageIndexAt(c2, { closest: () => ({ id: "outside" }) }), -1);

/* 注入式验证 */
if (process.env.INJECT_FAIL === "1") {
  eq("【注入】故意失败", collectImages(fakeContainer(["a"])).length, 99);
}

console.log(
  failed === 0
    ? `✅ CT 灯箱自测通过（${passed} 条用例，0 失败）`
    : `❌ CT 灯箱自测失败：${failed} 条失败（共 ${passed + failed} 条）`,
);
process.exit(failed === 0 ? 0 : 1);
