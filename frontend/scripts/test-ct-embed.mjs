#!/usr/bin/env node
/**
 * CT 报告内联（embed）纯函数自测。
 *
 * 用法：`cd frontend && node scripts/test-ct-embed.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败（逐条打印 名称 / 实际 / 期望）。
 *
 * 覆盖：HTML 拆分（CSS / 正文 / 标题）、CSS 作用域化（元素规则 / body / 逗号多选 /
 * @media 递归 / @font-face 原样 / 注释保留）。
 *
 * ⚠️ 注入式验证：文件末尾故意注入「必失败」断言，证明 eq()/ok() 真能抓到失败，
 *    不是「全绿但断言其实是空跑」。由 INJECT_FAIL 环境变量触发，正常跑不启用。
 */
import { extractReport, extractTitle, scopeCss, scopeSelector } from "../src/ct/embed.ts";

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

/* ========================= 1. HTML 拆分 ========================= */
const SAMPLE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>CT检查结果</title>
<style>
body { margin: 0; background: #fff; }
h1 { font-size: 22px; }
.summary { color: #4b5563; }
@media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>CT检查结果</h1>
<p class="summary">共 4 次检查</p>
<img src="data:image/jpeg;base64,AA==" alt="报告照片">
</body>
</html>`;

const parsed = extractReport(SAMPLE);
eq("extract·标题", parsed.title, "CT检查结果");
ok("extract·CSS 含 body 规则", parsed.css.includes("body {"));
ok("extract·CSS 含 @media", parsed.css.includes("@media print"));
ok("extract·正文含 h1", parsed.body.includes("<h1>CT检查结果</h1>"));
ok("extract·正文不含 <style>", !parsed.body.includes("<style>"));
ok("extract·正文不含 <html>", !parsed.body.includes("<html"));
ok("extract·正文不含 <body>", !parsed.body.toLowerCase().includes("<body"));

eq("extractTitle·无 title", extractTitle("<p>x</p>"), "");

/* ========================= 2. CSS 作用域化 ========================= */
eq("scope·单元素", scopeSelector("h1"), ".ct-report h1");
eq("scope·class", scopeSelector(".summary"), ".ct-report .summary");
eq("scope·body", scopeSelector("body"), ".ct-report");
eq("scope·html", scopeSelector("html"), ".ct-report");
eq("scope·:root", scopeSelector(":root"), ".ct-report");
eq("scope·多选", scopeSelector("h1, .summary"), ".ct-report h1, .ct-report .summary");
eq("scope·后代", scopeSelector("main > p"), ".ct-report main > p");
eq("scope·伪类", scopeSelector("a:hover"), ".ct-report a:hover");

const scoped = scopeCss(parsed.css);
ok("scope·h1 加了前缀", scoped.includes(".ct-report h1"));
ok("scope·body 变成容器", scoped.includes(".ct-report {"));
ok("scope·不再有裸 body 规则", !/>\s*body\s*\{/.test(scoped) && !/\nbody\s*\{/.test(scoped));
ok("scope·@media 内也加了前缀", scoped.includes("@media print") && scoped.includes(".ct-report {"));
ok("scope·@media 内 body 变容器", /@media print\s*\{\s*\.ct-report\s*\{/.test(scoped));
ok("scope·无未加前缀的 h1", !/\n\s*h1\s*\{/.test(scoped));

/* ========================= 3. 边界情况 ========================= */
ok("scope·空 CSS", scopeCss("").trim() === "");
ok("scope·@font-face 原样", scopeCss("@font-face { font-family: X; src: url(a.woff2); }")
  .includes("@font-face"));
ok("scope·@font-face 内部不加前缀", scopeCss("@font-face { font-family: X; src: url(a.woff2); }")
  .includes("font-family: X"));
ok("scope·@keyframes 原样", scopeCss("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }")
  .includes("@keyframes"));
ok("scope·@import 保留", scopeCss('@import url("a.css");').includes("@import url(\"a.css\");"));
ok("scope·注释保留", scopeCss("/* 备注 */ h1 { color: red }").includes("/* 备注 */"));

// 无 <body> 的退化路径
const noBody = extractReport("<html><head><style>p{color:red}</style></head><p>内容</p></html>");
ok("extract·无 body 时正文仍取到", noBody.body.includes("<p>内容</p>"));
ok("extract·无 body 时 CSS 仍取到", noBody.css.includes("p{color:red}"));

// 多个 <style> 块
const multi = extractReport("<style>a{color:red}</style><style>b{color:blue}</style><body>x</body>");
ok("extract·多个 style 合并", multi.css.includes("a{color:red}") && multi.css.includes("b{color:blue}"));

// 嵌套花括号（@media 内再嵌套）
const nested = scopeCss("@media screen { .a { color: red } .b { color: blue } }");
ok("scope·@media 多规则", nested.includes(".ct-report .a") && nested.includes(".ct-report .b"));

/* ========================= 4. 注入式验证 ========================= */
if (process.env.INJECT_FAIL === "1") {
  eq("【注入】故意失败", scopeSelector("h1"), ".WRONG h1");
}

console.log(
  failed === 0
    ? `✅ CT 报告内联自测通过（${passed} 条用例，0 失败）`
    : `❌ CT 报告内联自测失败：${failed} 条失败（共 ${passed + failed} 条）`,
);
process.exit(failed === 0 ? 0 : 1);
