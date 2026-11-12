#!/usr/bin/env node
/**
 * 小工具纯函数自测（Markdown 转义还原 + JSON 转义/反转义）。
 *
 * 用法：`cd frontend && node scripts/test-tools.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败（逐条打印 名称 / 实际 / 期望）。
 *
 * 为什么要有它：这两个函数是「用户粘进来的文本」的唯一处理入口，边界很多
 * （`\usb` 路径、表内 `\|`、结尾单反斜杠、成对引号、往返一致性），
 * 靠手点是测不完的。Node ≥ 22.6 可直接 import .ts（类型剥离），故无需构建。
 */
import { unescapeMarkdown } from "../src/tools/mdUnescape.ts";
import { escapeJsonString, unescapeJsonString } from "../src/tools/jsonEscape.ts";
import {
  inlineDiff,
  buildPush,
  groupInline,
  buildGroupPush,
  commonAffixes,
  splitKeepEol,
  summarize,
  countLines,
  normalizeForCompare,
} from "../src/tools/diff/core.ts";

let failed = 0;
let passed = 0;

function eq(name, actual, expected) {
  if (Object.is(actual, expected)) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`❌ ${name}`);
  console.error(`   实际: ${JSON.stringify(actual)}`);
  console.error(`   期望: ${JSON.stringify(expected)}`);
}

/* ------------------------- Markdown：字面量 → 真实字符 ------------------------- */

const mdSample =
  "**口径**\\n\\n| 项目 | 内容 |\\n|---|---|\\n| 数据集 ID | DS20261110004 |\\n| 对照组 | 未指定 |\\n";
const mdOut = unescapeMarkdown(mdSample);

eq("md·换行还原", mdOut.text.includes("\n\n| 项目 | 内容 |"), true);
eq("md·计数", mdOut.changes, 6);
eq("md·行数", mdOut.text.split("\n").length, 7);
eq("md·制表/反斜杠/引号", unescapeMarkdown('a\\tb\\\\c\\"d').text, 'a\tb\\c"d');
eq("md·unicode", unescapeMarkdown("\\u4e2d\\u6587").text, "中文");
eq("md·表内竖线保留", unescapeMarkdown("| a\\|b | c |").text, "| a\\|b | c |");
eq("md·\\usb 路径不被吃", unescapeMarkdown("C:\\usb").text, "C:\\usb");
eq("md·结尾反斜杠保留", unescapeMarkdown("abc\\").text, "abc\\");
eq("md·剥外层引号", unescapeMarkdown('"**a**\\n\\n表"').text, "**a**\n\n表");
eq("md·正文含引号不剥", unescapeMarkdown('"a" 和 "b"').text, '"a" 和 "b"');
eq("md·无转义计数为 0", unescapeMarkdown("普通文本").changes, 0);
eq("md·空输入", unescapeMarkdown("").text, "");
eq("md·二次还原无副作用", unescapeMarkdown(mdOut.text).text, mdOut.text);

/* --------------------------- JSON：转义 ↔ 反转义 --------------------------- */

eq("json·转义换行", escapeJsonString("a\nb"), '"a\\nb"');
eq("json·转义引号", escapeJsonString('say "hi"'), '"say \\"hi\\""');
eq("json·转义反斜杠", escapeJsonString("a\\b"), '"a\\\\b"');
eq("json·转义控制字符", escapeJsonString("\u0001"), '"\\u0001"');
eq("json·转义中文不转", escapeJsonString("中文"), '"中文"');
eq("json·转义空串", escapeJsonString(""), '""');

eq("json·反转义换行", unescapeJsonString("a\\nb").text, "a\nb");
eq("json·反转义 b/f/r/t", unescapeJsonString("\\b\\f\\r\\t").text, "\b\f\r\t");
eq("json·反转义斜杠", unescapeJsonString("a\\/b").text, "a/b");
eq("json·反转义 unicode", unescapeJsonString("\\u4e2d\\u6587").text, "中文");
eq("json·反转义计数", unescapeJsonString("\\n\\t\\u4e2d").changes, 3);
eq("json·剥外层引号", unescapeJsonString('"a\\nb"').text, "a\nb");
eq("json·剥引号标记", unescapeJsonString('"a\\nb"').strippedQuotes, true);
eq("json·正文含引号不剥", unescapeJsonString('"a" "b"').text, '"a" "b"');
eq("json·未知转义保留", unescapeJsonString("\\|\\*").text, "\\|\\*");
eq("json·\\usb 保留", unescapeJsonString("C:\\usb").text, "C:\\usb");
eq("json·空串", unescapeJsonString("").text, "");

// 往返：转义再反转义必须逐字符还原（含引号、换行、控制字符、中英混排）
for (const raw of [
  "plain",
  "a\nb",
  'quote "x"',
  "tab\tend",
  "中文 \\ mix",
  "\u0001\u001f",
  "line1\r\nline2",
  "",
]) {
  eq(`json·往返 ${JSON.stringify(raw)}`, unescapeJsonString(escapeJsonString(raw)).text, raw);
}

/* -------------------------- 文本对比：行内片段与推送 -------------------------- */

/** 把 inlineDiff 的片段按侧拼回原文 —— 这是「偏移全对」的最强断言 */
function rebuild(pieces, side) {
  return pieces.filter((p) => p.side === side).map((p) => p.text).join("");
}

const cases = [
  ["中文词替换", "这是一段中文原文，没有空格分隔", "这是一段中文修改后的文本，没有空格分隔"],
  ["英文词替换", "one two three", "one 2 three"],
  ["单侧为空(右)", "", "abc"],
  ["单侧为空(左)", "abc", ""],
  ["完全相同", "same text", "same text"],
  ["双侧空", "", ""],
  ["同行两处", "aa bb cc", "AA bb CC"],
  ["无空格中文逐字", "甲乙丙丁", "甲X丙丁"],
  ["多行混排", "line1\nline2\nline3", "line1\nCHANGED\nline3"],
];

for (const [name, a, b] of cases) {
  const pieces = inlineDiff(a, b);
  // 1) 每侧拼回去必须逐字符等于原文（偏移 + 文本双重正确）
  eq(`diff·往返左侧 ${name}`, rebuild(pieces, "a"), a);
  eq(`diff·往返右侧 ${name}`, rebuild(pieces, "b"), b);
  // 2) 片段偏移必须自洽：同侧片段连续且不重叠
  let cursorA = 0;
  let cursorB = 0;
  let offsetsOk = true;
  for (const p of pieces) {
    if (p.side === "a") {
      if (p.from !== cursorA) offsetsOk = false;
      cursorA = p.to;
    } else {
      if (p.from !== cursorB) offsetsOk = false;
      cursorB = p.to;
    }
  }
  eq(`diff·偏移连续 ${name}`, offsetsOk, true);
  eq(`diff·偏移收尾左 ${name}`, cursorA, a.length);
  eq(`diff·偏移收尾右 ${name}`, cursorB, b.length);
}

// 完全相同的文本不应产生任何 del/ins 片段
eq(
  "diff·相同文本无差异片段",
  inlineDiff("no change here", "no change here").filter((p) => p.kind !== "common").length,
  0,
);

// 中文必须能切到单字级（不是整段替换）—— 这是「行内细粒度」的核心能力。
// ⚠️ 不写死「删除的正好是原文」：LCS 会对齐末尾的「文」字，
//    实际只删「原」才是最优解，写死具体字串会把正确的实现判错。
{
  const A = "这是一段中文原文";
  const B = "这是一段中文修改后的文本";
  const p = inlineDiff(A, B);
  const dels = p.filter((x) => x.kind === "del").map((x) => x.text).join("");
  const ins = p.filter((x) => x.kind === "ins").map((x) => x.text).join("");
  // 粒度断言：删除段必须比整行短（证明没有退化成整段替换）
  eq("diff·中文未退化成整段删除", dels.length < A.length, true);
  eq("diff·中文删除段是原文子串", A.includes(dels), true);
  // ⚠️ 插入段可能被公共字符隔开成多段（如「修改后的」+「本」），
  //    拼起来是 B 的**子序列**而非连续子串，故只断言每段都在 B 里出现过。
  const insParts = p.filter((x) => x.kind === "ins").map((x) => x.text);
  eq("diff·每段插入都在新文中", insParts.every((t) => B.includes(t)), true);
  // 公共部分必须真的被识别出来（不是全删全插）
  const commons = p.filter((x) => x.side === "a" && x.kind === "common").map((x) => x.text).join("");
  eq("diff·识别出公共前缀", commons.startsWith("这是一段中文"), true);
}

// 超长退化成整段替换（性能护栏），但往返仍必须正确
{
  const bigA = "a".repeat(3000);
  const bigB = "b".repeat(3000);
  const p = inlineDiff(bigA, bigB);
  eq("diff·超长退化片段数", p.length, 2);
  eq("diff·超长退化往返左", rebuild(p, "a"), bigA);
  eq("diff·超长退化往返右", rebuild(p, "b"), bigB);
}

/* ---------------------------- 文本对比：双向推送 ---------------------------- */

{
  // 单行块：把整体内容从右推到左、再从左推到右
  const A = "hello world";
  const B = "hello there";
  const chunk = { a: { from: 0, to: A.length }, b: { from: 0, to: B.length }, precise: true };
  const toA = buildPush(A, B, chunk, "b");
  eq("push·右推左目标侧", toA.side, "a");
  eq("push·右推左插入", toA.insert, B);
  const toB = buildPush(A, B, chunk, "a");
  eq("push·左推右目标侧", toB.side, "b");
  eq("push·左推右插入", toB.insert, A);
}

{
  // 纯插入块（A 侧为空）：不能多带一个换行
  const A = "a\nc";
  const B = "a\nb\nc";
  const chunk = { a: { from: 2, to: 2 }, b: { from: 2, to: 4 }, precise: true };
  const op = buildPush(A, B, chunk, "b");
  eq("push·纯插入不带宽大范围", `${op.from},${op.to}`, "2,2");
  eq("push·纯插入内容", op.insert, "b\n");
}

// ---- 公共前后缀 ----
eq("affix·无公共", JSON.stringify(commonAffixes("abc", "xyz")), JSON.stringify({ prefix: 0, suffix: 0 }));
eq("affix·前缀", JSON.stringify(commonAffixes("abcdef", "abcxyz")), JSON.stringify({ prefix: 3, suffix: 0 }));
eq("affix·后缀", JSON.stringify(commonAffixes("xyzabc", "123abc")), JSON.stringify({ prefix: 0, suffix: 3 }));
eq("affix·前后都有", JSON.stringify(commonAffixes("abCd", "abXd")), JSON.stringify({ prefix: 2, suffix: 1 }));
eq("affix·完全相同", JSON.stringify(commonAffixes("same", "same")), JSON.stringify({ prefix: 4, suffix: 0 }));
// 前缀 + 后缀不得重叠（否则区间会算成负数）
{
  const { prefix, suffix } = commonAffixes("aaa", "aa");
  eq("affix·不重叠", prefix + suffix <= 2, true);
}

// ---- 按行切分保留换行 ----
eq("split·空串", splitKeepEol("").length, 0);
eq("split·单行无换行", JSON.stringify(splitKeepEol("abc")), JSON.stringify(["abc"]));
eq("split·两行", JSON.stringify(splitKeepEol("a\nb")), JSON.stringify(["a\n", "b"]));
eq("split·尾随换行", JSON.stringify(splitKeepEol("a\n")), JSON.stringify(["a\n"]));
eq("split·拼回原文", splitKeepEol("a\nb\n\nc").join(""), "a\nb\n\nc");

// ---- 替换组：核心用例 ----
{
  const A = 'const color = "red";\nconst size = 10;\nconst x = 1;';
  const B = 'const color = "blue";\nconst size = 10;\nconst x = 2;';
  const cA = { from: 0, to: A.length };
  const cB = { from: 0, to: B.length };
  const pieces = inlineDiff(A, B);
  const groups = groupInline(pieces, cA, cB, A, B);

  // 两行各有改动 → 两组（第 2 行未变不算）
  eq("group·按行切组数", groups.length, 2);
  eq("group·第一组A侧内容", A.slice(groups[0].a.from, groups[0].a.to), "red");
  eq("group·第一组B侧内容", B.slice(groups[0].b.from, groups[0].b.to), "blue");
  eq("group·第二组A侧内容", A.slice(groups[1].a.from, groups[1].a.to), "1");
  eq("group·第二组B侧内容", B.slice(groups[1].b.from, groups[1].b.to), "2");

  // 只推第一组：其余行必须原样保留（这是「细粒度」的意义）
  const op = buildGroupPush(A, B, groups[0], "b");
  eq("group·右推左只改第一处", A.slice(0, op.from) + op.insert + A.slice(op.to),
     'const color = "blue";\nconst size = 10;\nconst x = 1;');

  // 反向
  const op2 = buildGroupPush(A, B, groups[0], "a");
  eq("group·左推右只改第一处", B.slice(0, op2.from) + op2.insert + B.slice(op2.to),
     'const color = "red";\nconst size = 10;\nconst x = 2;');

  // 第二组独立
  const op3 = buildGroupPush(A, B, groups[1], "b");
  eq("group·右推左只改第二处", A.slice(0, op3.from) + op3.insert + A.slice(op3.to),
     'const color = "red";\nconst size = 10;\nconst x = 2;');
}

{
  // 行数不一致（纯增删行）：退化成整块一组，不得抛错，且推送结果正确
  const A = "a\nc";
  const B = "a\nb\nc";
  const pieces = inlineDiff(A, B);
  const groups = groupInline(pieces, { from: 0, to: A.length }, { from: 0, to: B.length }, A, B);
  eq("group·行数不一致退化为整块", groups.length, 1);
  const op = buildGroupPush(A, B, groups[0], "a");
  eq("group·整块左推右", B.slice(0, op.from) + op.insert + B.slice(op.to), A);
}

{
  // 完全相同的行不产生组
  const A = "same\nsame2";
  const B = "same\nsame2";
  const groups = groupInline([], { from: 0, to: A.length }, { from: 0, to: B.length }, A, B);
  eq("group·无差异无组", groups.length, 0);
}

/* ---------------------------- 文本对比：统计与归一化 ---------------------------- */

{
  const A = "a\nb\nc";
  const B = "a\nc";
  const chunks = [{ a: { from: 2, to: 4 }, b: { from: 2, to: 2 }, precise: true }];
  const s = summarize(A, B, chunks);
  eq("sum·块数", s.chunks, 1);
  eq("sum·删除字符", s.minusChars, 2);
  eq("sum·新增字符", s.plusChars, 0);
  eq("sum·不精确标记", s.precise, true);
  eq("sum·行数A", s.linesA, 3);
  eq("sum·行数B", s.linesB, 2);
  eq("sum·空差异判定", summarize(A, A, []).same, true);
  // 任一块不精确 → 整体不精确
  eq(
    "sum·任一块不精确则整体不精确",
    summarize(A, B, [{ ...chunks[0], precise: false }]).precise,
    false,
  );
}

eq("count·空文本 0 行", countLines(""), 0);
eq("count·单行", countLines("x"), 1);
eq("count·三行", countLines("a\nb\nc"), 3);

// 归一化必须**不改变长度**：diff 偏移依赖这一性质
{
  const src = "  Foo\tBar  \r\nBaz ";
  const n = normalizeForCompare(src, { ignoreWhitespace: true, ignoreCase: true });
  eq("norm·长度不变", n.length, src.length);
  eq("norm·换行保留", n.includes("\n"), true);
  eq("norm·大小写归一", n.includes("foo bar"), true);
  eq("norm·关闭时原样返回", normalizeForCompare(src, { ignoreWhitespace: false, ignoreCase: false }), src);
  // 只开忽略大小写时，空白必须原样保留
  const ci = normalizeForCompare("  Foo  ", { ignoreWhitespace: false, ignoreCase: true });
  eq("norm·仅忽略大小写保留空白", ci, "  foo  ");
}

/* --------------------- 注入式验证：证明上面的断言真的有效 --------------------- */
// 故意构造错误实现，断言它们必须被检测出来 —— 否则「全绿」可能只是断言写空了。
{
  const badRebuild = (pieces, side) =>
    pieces.filter((p) => p.side === side).map((p) => p.text).join("");
  const pieces = inlineDiff("abc", "aXc");
  // 注入：故意把 del 片段文本改掉，rebuild 必须对不上
  const tampered = pieces.map((p) => (p.kind === "del" ? { ...p, text: "ZZ" } : p));
  eq("注入·篡改后往返应当失败", badRebuild(tampered, "a") === "abc", false);

  // 注入：把偏移整体 +1，连续性检查必须报错
  const shifted = pieces.map((p) => ({ ...p, from: p.from + 1 }));
  let ok = true;
  let cur = 0;
  for (const p of shifted.filter((x) => x.side === "a")) {
    if (p.from !== cur) ok = false;
    cur = p.to;
  }
  eq("注入·偏移错位应被检出", ok, false);

  // 注入：normalize 改变长度必须被检出
  eq(
    "注入·归一化长度变化应被检出",
    normalizeForCompare("a  b", { ignoreWhitespace: true, ignoreCase: false }).length === "a  b".length,
    true,
  );
}

if (failed > 0) {
  console.error(`\n❌ 小工具自测失败：${failed} 项（通过 ${passed} 项）`);
  process.exit(1);
}
console.log(`✅ 小工具自测通过（${passed} 条用例，0 失败）`);
