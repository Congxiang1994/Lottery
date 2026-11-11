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

if (failed > 0) {
  console.error(`\n❌ 小工具自测失败：${failed} 项（通过 ${passed} 项）`);
  process.exit(1);
}
console.log(`✅ 小工具自测通过（${passed} 条用例，0 失败）`);
