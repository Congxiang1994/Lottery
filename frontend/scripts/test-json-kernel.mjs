#!/usr/bin/env node
/**
 * JSON 工具内核纯函数自测。
 *
 * 用法：`cd frontend && node scripts/test-json-kernel.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败（逐条打印 名称 / 实际 / 期望）。
 *
 * 覆盖：解析管线、大整数无损、统计、格式化/键名、节点树扁平化。
 * Node ≥ 22.6 直接 import .ts（类型剥离），无需构建。
 *
 * ⚠️ 注入式验证：文件末尾故意注入「必失败」断言，证明 eq() 真能抓到失败，
 *    不是「全绿但断言其实是空跑」。由 INJECT_FAIL 环境变量触发，正常跑不启用。
 */
import { parseInput, translateError, parseJsonl, resultToText } from "../src/tools/json/parse.ts";
import { parseLossless, stringifyLossless, toDisplayString, toSafeNumber, isUnsafeIntegerLiteral, collectUnsafeIntegers, hasLossless } from "../src/tools/json/lossless.ts";
import { computeStats } from "../src/tools/json/stats.ts";
import { formatJson, minifyJson, sortDeep, toCamel, toSnake, convertKeys, detectKeyCase, styleToInline } from "../src/tools/json/format.ts";
import { flatten, defaultExpanded, allExpandablePaths, kindOf, isContainer, pointerOf } from "../src/tools/json/views/treeModel.ts";

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
  console.error(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ========================= 1. 解析管线 ========================= */
const P = (t, o) => parseInput(t, o);

eq("parse·空输入", P("").kind, "empty");
eq("parse·纯空白", P("   \n ").kind, "empty");
eq("parse·严格 JSON", P('{"a":1}').kind, "json");
eq("parse·严格数组", P("[1,2,3]").kind, "json");
eq("parse·转义文档", P('"{\\"a\\":1}"').kind, "escaped");
eq("parse·转义文档值", stringifyLossless(parseInput('"{\\"a\\":1}"').value), '{"a":1}');
eq("parse·JSON5 无引号键", P("{a:1,}").kind, "json5");
eq("parse·JSON5 单引号", P("{'a':1}").kind, "json5");
eq("parse·JSONC 行注释", P('//c\n{"a":1}').kind, "json5"); // JSON5 同样支持注释，命中更早
eq("parse·尾逗号", ["json5", "repaired"].includes(P('{"a":1,}').kind), true);
eq("parse·JSONL 两行", P('{"a":1}\n{"a":2}').kind, "jsonl");
eq("parse·JSONL 行数", P('{"a":1}\n{"a":2}').lines.length, 2);
eq("parse·残缺必须失败", P('{"a":').ok, false);
eq("parse·残缺 kind", P('{"a":').kind, "invalid");
eq("parse·前后杂字不假装成功", P('{"a":1} trailing').ok, false);
eq("parse·日志混合文本不提取（已移除该分支）", P('INFO {"a":1} WARN').ok, false);
eq("parse·重复 key 严格保留", typeof P('{"a":1,"a":2}').value, "object");
eq("parse·BOM 行尾不偏移", P('\uFEFF{"a":1}').ok, true);
eq("parse·禁用宽松", P("{a:1}", { allowLoose: false, allowRepair: false }).ok, false);
eq("parse·禁用 JSONL", P('{"a":1}\n{"a":2}', { allowJsonl: false }).kind !== "jsonl", true);

const err = translateError("Unexpected token o in JSON at position 5", '{"a":1} oops');
ok("parse·错误中文化", err.message.includes("关键词") || err.message.includes("意外符号"), err.message);
ok("parse·错误带行列", err.line > 0 && err.col > 0, JSON.stringify(err));
eq("parse·未结束提示", translateError("Unexpected end of JSON input", "{").message.includes("未完整结束"), true);

// 错误必须能定位到具体行列 —— 这是左框底部那行字的核心价值。
// JSON5 / jsonrepair 的报错本身不带位置，靠 jsonc-parser 的 offset 兜底换算。
const multiErr = P('{\n  "a":\n  "b": oops\n}');
eq("parse·错误带行号（多行输入）", multiErr.errors[0].line, 3);
ok("parse·错误带列号", multiErr.errors[0].col > 0, JSON.stringify(multiErr.errors[0]));
eq("parse·单行错误行号为 1", P('{"a":1,,}').errors[0].line, 1);
ok("parse·残缺也有位置", P('{"a":').errors[0].line >= 1, JSON.stringify(P('{"a":').errors[0]));
// 可修复的输入不该报错（repair 兜住了单引号/缺引号这类），此处固化该行为
eq("parse·可修复输入不报错", P('{"a": oops}').ok, true);
eq("parse·JSONL 空行标记", parseJsonl('{"a":1}\n\n{"a":2}')[1].ok, false);
eq("parse·JSONL 错误行中文", parseJsonl('{"a":1}\nbad')[1].error.length > 0, true);
ok("parse·resultToText JSONL 每行一条", resultToText(P('{"a":1}\n{"a":2}')).split("\n").length === 2);

/* ========================= 2. 大整数无损 ========================= */
const BIG = '{"id":12345678901234567890,"name":"x"}';
const bigVal = parseLossless(BIG);
eq("lossless·大整数不降级", stringifyLossless(bigVal), BIG);
eq("lossless·往返字面量", stringifyLossless(parseLossless(BIG)).includes("12345678901234567890"), true);
eq("lossless·hasLossless 超界", hasLossless(bigVal), true);
eq("lossless·普通数无标记", hasLossless(parseLossless('{"a":1}')), false);
eq("lossless·展示串", toDisplayString(bigVal.id), "12345678901234567890");
eq("lossless·安全数", toSafeNumber(42), 42);
eq("lossless·不安全数返回 null", toSafeNumber(bigVal.id), null);
eq("lossless·isUnsafe 超界", isUnsafeIntegerLiteral("9007199254740992"), true);
eq("lossless·isUnsafe 边界内", isUnsafeIntegerLiteral("9007199254740991"), false);
eq("lossless·isUnsafe 负数", isUnsafeIntegerLiteral("-12345678901234567890"), true);
eq("lossless·isUnsafe 非整数", isUnsafeIntegerLiteral("1.5"), false);
eq("lossless·collect 路径", collectUnsafeIntegers(bigVal)[0], "$.id");
eq("lossless·collect 嵌套", collectUnsafeIntegers(parseLossless('{"a":[{"id":12345678901234567890}]}'))[0], "$.a[0].id");
eq("lossless·parse 全链路到 format", formatJson(BIG).includes("12345678901234567890"), true);
eq("lossless·minify 保精度", minifyJson(BIG), BIG);
eq("lossless·parseInput 标 lossless", P(BIG).lossless, true);

/* ========================= 3. 统计 ========================= */
const st = computeStats(parseLossless('{"a":1,"b":{"c":[1,2]}}'), '{"a":1,"b":{"c":[1,2]}}');
eq("stats·键数", st.keys, 3);
eq("stats·深度", st.depth, 3);
eq("stats·行数", st.lines, 1);
eq("stats·字节", st.bytes, 23);
eq("stats·节点数", st.nodes, 6);
eq("stats·LosslessNumber 不算对象", computeStats(parseLossless('{"a":1}'), '{"a":1}').keys, 1);
eq("stats·CRLF 行数", computeStats(undefined, "a\r\nb\r\nc").lines, 3);
eq("stats·UTF8 字节", computeStats(undefined, "中文").bytes, 6);
eq("stats·空文本行数", computeStats(undefined, "").lines, 0);

/* ========================= 4. 格式化 / 键名 ========================= */

// ★ 两种风格必须都能跑通：
//   标准 = 传统全展开（与 JSON.stringify 一致）；高效 = 纯标量数组内联。
const SAMPLE_LINE = `{"name":"lottery","version":2,"tools":["timestamp","json","markdown"],"enabled":true,"config":{"theme":"auto","nested":{"a":1,"b":[1,2,3]}}}`;
const fmtStd = formatJson(SAMPLE_LINE, 2, false, "standard");
const fmtCompact = formatJson(SAMPLE_LINE, 2, false, "compact");

// 标准风格：数组必须逐元素换行（这是「传统展开」的定义）
eq("format·标准风格不内联", fmtStd.includes('"tools": [\n'), true);
eq("format·标准风格行数", fmtStd.split("\n").length, 21);
// 高效风格：纯标量数组压一行
eq("format·高效风格内联字符串数组", fmtCompact.includes('"tools": ["timestamp", "json", "markdown"]'), true);
eq("format·高效风格内联数字数组", fmtCompact.includes('"b": [1, 2, 3]'), true);
eq("format·高效风格行数", fmtCompact.split("\n").length, 13);
// 两种风格对「对象数组」都必须展开
ok("format·标准风格对象数组展开", formatJson('[{"a":1},{"b":2}]', 2, false, "standard").split("\n").length > 3);
ok("format·高效风格对象数组仍展开", formatJson('[{"a":1},{"b":2}]', 2, false, "compact").split("\n").length > 3);

eq("format·默认风格为标准", formatJson(SAMPLE_LINE).includes('"tools": [\n'), true);
eq("format·空容器单行", formatJson('{"a":[],"b":{}}'), '{\n  "a": [],\n  "b": {}\n}');
eq("format·高效内联混合标量", formatJson('{"a":[1,"x",true,null]}', 2, false, "compact").includes('[1, "x", true, null]'), true);
ok("format·高效超长数组退回多行", formatJson('{"t":[' + Array.from({ length: 30 }, (_, i) => `"x${i}"`).join(",") + ']}', 2, false, "compact").split("\n").length > 3);
eq("format·高效内联保大整数", formatJson('{"id":[1,12345678901234567890,3]}', 2, false, "compact").includes("[1, 12345678901234567890, 3]"), true);
eq("format·高效嵌套数组元素各自内联", formatJson('{"a":[[1,2],[3,4]]}', 2, false, "compact"), '{\n  "a": [\n    [1, 2],\n    [3, 4]\n  ]\n}');
eq("format·高效字符串含逗号不被拆", formatJson('{"a":["x, y","z"]}', 2, false, "compact").includes('["x, y", "z"]'), true);
eq("format·高效 Tab 缩进", formatJson('{"a":[1,2]}', "tab", false, "compact").includes('"a": [1, 2]'), true);
eq("format·高效 + 键名排序", formatJson('{"z":[2,1],"a":1}', 2, true, "compact"), '{\n  "a": 1,\n  "z": [2, 1]\n}');

eq("format·默认保留 key 顺序", formatJson('{"z":1,"a":2}'), '{\n  "z": 1,\n  "a": 2\n}');
eq("format·4 空格", formatJson('{"a":1}', 4).includes('    "a"'), true);
eq("format·Tab", formatJson('{"a":1}', "tab").includes('\t"a"'), true);
eq("format·压缩", minifyJson('{ "a" : 1 }'), '{"a":1}');
eq("format·压缩标量数组无空格", minifyJson('{"a":[1,2,3]}'), '{"a":[1,2,3]}');
eq("format·排序", stringifyLossless(sortDeep(parseLossless('{"z":1,"a":2}'))), '{"a":2,"z":1}');
eq("format·排序不破坏数组", stringifyLossless(sortDeep(parseLossless('{"z":[3,1,2]}'))), '{"z":[3,1,2]}');
eq("format·styleToInline", styleToInline("compact"), true);
eq("format·styleToInline 标准", styleToInline("standard"), false);
eq("format·toCamel", toCamel("user_name"), "userName");
eq("format·toCamel 连字符", toCamel("user-name"), "userName");
eq("format·toCamel 已有驼峰", toCamel("userName"), "userName");
eq("format·toSnake", toSnake("userName"), "user_name");
eq("format·toSnake 缩写", toSnake("HTTPServer"), "http_server");
eq("format·保留下划线", toCamel("_private_key"), "_privateKey");
eq("format·键名转换递归", stringifyLossless(convertKeys(parseLossless('{"user_name":{"first_name":"a"}}'), "camel")), '{"userName":{"firstName":"a"}}');
eq("format·检测风格", detectKeyCase('{"user_name":1,"first_name":2}'), "snake");
eq("format·检测驼峰", detectKeyCase('{"userName":1,"firstName":2}'), "camel");

/* ========================= 5. 节点树扁平化 ========================= */
const tv = parseLossless('{"a":1,"b":{"c":2,"d":[3,4]},"e":true}');
eq("tree·根 kind", kindOf(tv), "object");
eq("tree·根是容器", isContainer(tv), true);
eq("tree·标量非容器", isContainer(1), false);
eq("tree·pointerOf 特殊字符", pointerOf(["a/b", 0, "x~y"]), "/a~1b/0/x~0y");
const collapsed = flatten(tv, new Set());
eq("tree·全折叠只显示根", collapsed.length, 1);
eq("tree·根路径", collapsed[0].path, "/");
const expandedRoot = flatten(tv, new Set(["/"]));
eq("tree·展开根显示直接子节点", expandedRoot.length, 4);
eq("tree·子节点缩进", expandedRoot[1].depth, 1);
const all = allExpandablePaths(tv);
eq("tree·可展开节点数", all.size, 3); // 根、b、b.d
const full = flatten(tv, all);
eq("tree·全展开行数", full.length, 8);
ok("tree·默认展开前两层", defaultExpanded(tv).has("/") && defaultExpanded(tv).has("/b"));
ok("tree·默认不展开第三层", !defaultExpanded(tv).has("/b/d"));
eq("tree·容器文本", collapsed[0].text, "Object(3)");
eq("tree·数组文本", flatten(parseLossless("[1,2]"), new Set())[0].text, "Array(2)");
eq("tree·大整数叶子展示", flatten(parseLossless(BIG), new Set(["/"]))[1].text, "12345678901234567890");
eq("tree·null 叶子", kindOf(null), "null");

/* ========================= 6. 全链路大整数 ========================= */
eq("chain·parse→format→tree", (() => {
  const p = P(BIG);
  const f = formatJson(BIG);
  const leaf = flatten(p.value, new Set(["/"]))[1];
  return f.includes("12345678901234567890") && leaf.text === "12345678901234567890";
})(), true);
eq("chain·JSONL 内大整数", P('{"id":12345678901234567890}\n{"id":1}').lines[0].ok, true);

/* ========================= 注入式验证 ========================= */
if (process.env.INJECT_FAIL === "1") {
  eq("INJECT·eq 必失败", "故意错", "正确值");
  ok("INJECT·ok 必失败", false, "故意 false");
}

if (failed > 0) {
  console.error(`\n❌ JSON 内核自测失败：${failed} 项（通过 ${passed} 项）`);
  process.exit(1);
}
console.log(`✅ JSON 内核自测通过（${passed} 条用例，0 失败）`);
