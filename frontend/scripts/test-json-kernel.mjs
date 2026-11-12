#!/usr/bin/env node
/**
 * JSON 工作台内核纯函数自测。
 *
 * 用法：`cd frontend && node scripts/test-json-kernel.mjs`
 * 退出码：0 = 全通过；1 = 有用例失败（逐条打印 名称 / 实际 / 期望）。
 *
 * 为什么单独一份：内核有 11 个纯函数模块、边界极多（大整数、JSONC 容错
 * 假成功、日志片段、Schema 校验、代码生成大整数报错、XML/CSV 有损边界），
 * 靠手点测不完。Node ≥ 22.6 直接 import .ts（类型剥离），无需构建。
 *
 * ⚠️ 注入式验证：文件末尾故意注入「必失败」断言，证明 eq() 真能抓到失败，
 *    不是「全绿但断言其实是空跑」。由 INJECT_FAIL 环境变量触发，正常跑不启用。
 */
import { parseInput, translateError, parseJsonl, resultToText } from "../src/tools/json/parse.ts";
import { parseLossless, stringifyLossless, toDisplayString, toSafeNumber, isUnsafeIntegerLiteral, collectUnsafeIntegers, hasLossless } from "../src/tools/json/lossless.ts";
import { computeStats } from "../src/tools/json/stats.ts";
import { formatJson, minifyJson, sortDeep, toCamel, toSnake, convertKeys, detectKeyCase } from "../src/tools/json/format.ts";
import { extractFragments, dedupeFragments } from "../src/tools/json/extract.ts";
import { runQuery, pointerGet, pathToPointer, QUERY_HINTS } from "../src/tools/json/query.ts";
import { diffValues, summarize, diffText, diffJsonTexts } from "../src/tools/json/diff.ts";
import { generateSchema, validateSchema, locateIssues, prepareForValidation } from "../src/tools/json/schema.ts";
import { generateCode, extractFromCode, CODE_LANGS } from "../src/tools/json/codegen.ts";
import { fromJson, toJson, CONVERT_FORMATS } from "../src/tools/json/convert.ts";

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

function ok(name, cond, detail = "") {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.error(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ========================= 1. 统一解析管线 ========================= */

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
eq("parse·尾逗号命中宽松解析", ["json5", "repaired"].includes(P('{"a":1,}').kind), true);
eq("parse·JSONL 两行", P('{"a":1}\n{"a":2}').kind, "jsonl");
eq("parse·JSONL 行数", P('{"a":1}\n{"a":2}').lines.length, 2);
eq("parse·日志混合", P("xxx {\"b\":2} yyy").kind, "log");
eq("parse·日志片段数", P('INFO {"a":1} WARN {"b":2}').fragments.length, 2);
eq("parse·残缺必须失败", P('{"a":').ok, false);
eq("parse·残缺 kind", P('{"a":').kind, "invalid");
eq("parse·前后杂字不假装成功", P('{"a":1} trailing').kind, "log");
eq("parse·重复 key 严格保留", typeof P('{"a":1,"a":2}').value, "object");
eq("parse·BOM 行尾不偏移", P('\uFEFF{"a":1}').ok, true);

eq("parse·禁用宽松", P("{a:1}", { allowLoose: false, allowRepair: false, allowLogExtract: false }).ok, false);
eq("parse·禁用日志提取", P("xxx {}", { allowLogExtract: false }).ok, false);
eq("parse·禁用 JSONL", P('{"a":1}\n{"a":2}', { allowJsonl: false }).kind !== "jsonl", true);

const err = translateError("Unexpected token o in JSON at position 5", '{"a":1} oops');
ok("parse·错误中文化", err.message.includes("关键词") || err.message.includes("意外符号"), err.message);
ok("parse·错误带行列", err.line > 0 && err.col > 0, JSON.stringify(err));
eq("parse·未结束提示", translateError("Unexpected end of JSON input", "{").message.includes("未完整结束"), true);

eq("parse·JSONL 空行标记", parseJsonl('{"a":1}\n\n{"a":2}')[1].ok, false);
eq("parse·JSONL 错误行中文", parseJsonl('{"a":1}\nbad')[1].error.length > 0, true);
eq("parse·resultToText 日志不改原文", resultToText(P('INFO {"a":1}')), 'INFO {"a":1}');
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

eq("format·默认保留 key 顺序", formatJson('{"z":1,"a":2}'), '{\n  "z": 1,\n  "a": 2\n}');
eq("format·4 空格", formatJson('{"a":1}', 4).includes('    "a"'), true);
eq("format·Tab", formatJson('{"a":1}', "tab").includes('\t"a"'), true);
eq("format·压缩", minifyJson('{ "a" : 1 }'), '{"a":1}');
eq("format·排序", stringifyLossless(sortDeep(parseLossless('{"z":1,"a":2}'))), '{"a":2,"z":1}');
eq("format·排序不破坏数组", stringifyLossless(sortDeep(parseLossless('{"z":[3,1,2]}'))), '{"z":[3,1,2]}');
eq("format·toCamel", toCamel("user_name"), "userName");
eq("format·toCamel 连字符", toCamel("user-name"), "userName");
eq("format·toCamel 已有驼峰", toCamel("userName"), "userName");
eq("format·toSnake", toSnake("userName"), "user_name");
eq("format·toSnake 缩写", toSnake("HTTPServer"), "http_server");
eq("format·保留下划线", toCamel("_private_key"), "_privateKey");
eq("format·键名转换递归", stringifyLossless(convertKeys(parseLossless('{"user_name":{"first_name":"a"}}'), "camel")), '{"userName":{"firstName":"a"}}');
eq("format·检测风格", detectKeyCase('{"user_name":1,"first_name":2}'), "snake");
eq("format·检测驼峰", detectKeyCase('{"userName":1,"firstName":2}'), "camel");

/* ========================= 5. 日志片段提取 ========================= */

const log = '2026-11-12 INFO req={"a":1,"b":{"c":2}} resp=[1,2] done';
const frags = extractFragments(log);
eq("extract·片段数", frags.length, 2);
eq("extract·片段一含 b", frags[0].pretty.includes('"b"'), true);
ok("extract·原文不变", log.includes('req={"a":1'));
eq("extract·多片段分组", dedupeFragments(frags).length, 2);
eq("extract·字符串内括号不误判", extractFragments('msg="a { b }" tail').length, 0);
eq("extract·无 JSON", extractFragments("plain text no json").length, 0);
ok("extract·嵌套片段去重", dedupeFragments([{start:0,end:10},{start:2,end:8},{start:12,end:20}]).length === 2);
eq("extract·JSON5 片段", extractFragments("log {a:1,}")[0].kind, "json5");
eq("extract·可修复片段", extractFragments("log {'a':1}")[0].ok, true);

/* ========================= 6. 查询 ========================= */

const qv = parseLossless('{"users":[{"name":"A","age":20},{"name":"B","age":30}],"ok":true}');
eq("query·JSONPath", runQuery(qv, "$.users[*].name", "jsonpath").values.length, 2);
eq("query·JSONPath 值", runQuery(qv, "$.users[0].name", "jsonpath").values[0], "A");
eq("query·JSONPath 过滤", runQuery(qv, "$.users[?(@.age>25)].name", "jsonpath").values[0], "B");
eq("query·JSONPath 无匹配", runQuery(qv, "$.nope", "jsonpath").ok, false);
eq("query·JSONPath 非法表达式", runQuery(qv, "$[", "jsonpath").ok, false);
eq("query·JMESPath", runQuery(qv, "users[].name", "jmespath").values.length, 1);
eq("query·JMESPath 结果", JSON.stringify(runQuery(qv, "users[].name", "jmespath").values[0]), '["A","B"]');
eq("query·JMESPath 过滤", JSON.stringify(runQuery(qv, "users[?age > `25`].name", "jmespath").values[0]), '["B"]');
eq("query·JMESPath 非法", runQuery(qv, "[[[", "jmespath").ok, false);
eq("query·Pointer", pointerGet(qv, "/users/0/name"), "A");
eq("query·Pointer 根", pointerGet(qv, ""), qv);
eq("query·Pointer 转义", pointerGet({"a/b":"x"}, "/a~1b"), "x");
eq("query·Pointer 波浪", pointerGet({"a~b":"y"}, "/a~0b"), "y");
eq("query·Pointer 越界", pointerGet(qv, "/users/9"), undefined);
eq("query·Pointer 模式", runQuery(qv, "/ok", "pointer").values[0], true);
eq("query·Pointer 不存在", runQuery(qv, "/nope", "pointer").ok, false);
eq("query·pathToPointer", pathToPointer(["users", 0, "a/b"]), "/users/0/a~1b");
eq("query·空表达式", runQuery(qv, "", "jsonpath").ok, false);
eq("query·三种模式都有帮助", Object.keys(QUERY_HINTS).length, 3);
ok("query·耗时有值", runQuery(qv, "$.ok", "jsonpath").ms >= 0);

/* ========================= 7. Diff ========================= */

const dl = parseLossless('{"a":1,"b":2,"c":{"x":1}}');
const dr = parseLossless('{"a":1,"b":9,"d":4,"c":{"x":1,"y":2}}');
const dn = diffValues(dl, dr);
const ds = summarize(dn);
eq("diff·修改计数", ds.changed, 1);
eq("diff·新增计数", ds.added, 2);
eq("diff·删除计数", 0, 0);
eq("diff·同值不计变更", summarize(diffValues(parseLossless('{"a":1}'), parseLossless('{"a":1}'))).changed, 0);
eq("diff·删除计数", summarize(diffValues(dl, parseLossless('{"a":1}'))).removed >= 1, true);
eq("diff·文本行差异", diffText("a\nb\n", "a\nc\n").right.filter((l) => l.kind === "added").length, 1);
eq("diff·文本行号", diffText("a\n", "a\nb\n").right[1].rightNo, 2);
const dj = diffJsonTexts('{"a":1}', '{"a":2}', parseLossless);
eq("diff·双文本成功", dj.ok, true);
eq("diff·左解析失败", diffJsonTexts("{bad", "{}", parseLossless).side, "left");
eq("diff·右解析失败", diffJsonTexts("{}", "{bad", parseLossless).side, "right");
eq("diff·路径含数组下标", diffValues(parseLossless("[1]"), parseLossless("[2]"))[0].children[0].path, "$[0]");

/* ========================= 8. Schema ========================= */

const sch = generateSchema(parseLossless('{"a":1,"b":"x","c":[1,2]}'));
eq("schema·Draft7 标记", sch.$schema, "http://json-schema.org/draft-07/schema#");
eq("schema·类型 object", sch.type, "object");
eq("schema·required 补齐", JSON.stringify(sch.required), '["a","b","c"]');
eq("schema·整数类型", sch.properties.a.type, "integer");
eq("schema·数组 items", sch.properties.c.items.type, "integer");
eq("schema·多样本属性取并集", Object.keys(generateSchema(parseLossless('{"a":1}'), [parseLossless('{"b":"x"}')]).properties).length, 2);
eq("schema·多样本 required 取交集", generateSchema(parseLossless('{"a":1}'), [parseLossless('{"a":2}')]).required.length, 1);
eq("schema·特殊键名不污染", Object.prototype.hasOwnProperty.call(generateSchema(parseLossless('{"__proto__":1}')).properties, "__proto__"), true);

const vr = validateSchema(parseLossless('{"a":1}'), JSON.stringify({ type: "object", required: ["a", "b"] }));
eq("schema·校验失败", vr.ok, false);
eq("schema·错误数", vr.issues.length, 1);
eq("schema·校验通过", validateSchema(parseLossless('{"a":1}'), JSON.stringify({ type: "object" })).ok, true);
eq("schema·Schema 非法 JSON", validateSchema({}, "{oops").ok, false);
eq("schema·错误可定位", locateIssues([{ instanceLocation: "/a", keywordLocation: "", keyword: "required", message: "x", line: 0, col: 0 }], '{\n  "a": 1\n}')[0].line, 2);
eq("schema·LosslessNumber 预处理", prepareForValidation(bigVal).id, "12345678901234567890");

/* ========================= 9. 代码生成 ========================= */

const cv = parseLossless('{"user_name":"A","age":20,"active":true,"tags":["x"]}');
for (const l of CODE_LANGS) {
  const r = generateCode(cv, l.key);
  ok(`codegen·${l.key} 生成成功`, r.ok && r.code.length > 20, r.error ?? "");
}
ok("codegen·TS 接口", generateCode(cv, "ts").code.includes("export interface Root"));
ok("codegen·TS 保留可选", generateCode(parseLossless('[{"a":1},{"b":2}]'), "ts").code.includes("?:"));
ok("codegen·Go json 标签", generateCode(cv, "go").code.includes('json:"user_name"'));
ok("codegen·Go int64", generateCode(cv, "go").code.includes("int64"));
ok("codegen·Python dataclass", generateCode(cv, "python").code.includes("@dataclass"));
ok("codegen·Java getter", generateCode(cv, "java").code.includes("getUserName()"));
ok("codegen·Rust serde", generateCode(cv, "rust").code.includes("Serialize"));
const bigCode = generateCode(bigVal, "ts");
eq("codegen·TS 大整数明确报错", bigCode.ok, false);
ok("codegen·报错含路径", bigCode.error.includes("$.id"), bigCode.error);
eq("codegen·Go 大整数允许", generateCode(bigVal, "go").ok, true);
const back = extractFromCode("interface X {\n  name: string;\n  age: number;\n}", "ts");
eq("codegen·反向提取成功", back.ok, true);
eq("codegen·反向提取字段", Object.keys(back.value).length, 2);
ok("codegen·反向提取有警告", back.warning.includes("尽力而为"));
eq("codegen·反向提取空代码", extractFromCode("nothing", "ts").ok, false);

/* ========================= 10. 转换 ========================= */

const tv = parseLossless('{"name":"A","age":20,"tags":["x","y"]}');
eq("convert·格式数", CONVERT_FORMATS.length, 7);
eq("convert·YAML", fromJson(tv, "yaml").text.includes("name: A"), true);
eq("convert·YAML 往返", toJson(fromJson(tv, "yaml").text, "yaml").text.includes('"age": 20'), true);
eq("convert·TOML", fromJson(tv, "toml").text.includes('name = "A"'), true);
eq("convert·TOML 往返", toJson(fromJson(tv, "toml").text, "toml").text.includes('"age": 20'), true);
eq("convert·XML 有根", fromJson(tv, "xml").text.includes("<?xml"), true);
ok("convert·XML 明示有损", fromJson(tv, "xml").warnings.some((w) => w.includes("有损")));
eq("convert·XML 往返", toJson(fromJson({ root: tv }, "xml").text, "xml").ok, true);
const csv = fromJson(parseLossless('[{"a":1,"b":2},{"a":3,"b":4}]'), "csv");
eq("convert·CSV 表头", csv.text.split("\n")[0].trimEnd(), "a,b");
eq("convert·CSV 行数", csv.text.trim().split("\n").length, 3);
ok("convert·CSV 明示有损", csv.warnings.some((w) => w.includes("有损")));
eq("convert·CSV 往返", toJson(csv.text, "csv").text.includes('"a"'), true);
eq("convert·CSV 非对象数组报错", fromJson(parseLossless("[1,2,3]"), "csv").ok, false);
eq("convert·CSV 根非数组报错", fromJson(tv, "csv").ok, false);
eq("convert·Properties", fromJson(tv, "properties").text.includes("name=A"), true);
eq("convert·Properties 往返", toJson(fromJson(tv, "properties").text, "properties").text.includes('"name"'), true);
eq("convert·INI", fromJson(parseLossless('{"db":{"host":"x"}}'), "ini").text.includes("[db]"), true);
eq("convert·INI 往返", toJson("[db]\nhost=x", "ini").text.includes('"host"'), true);
eq("convert·MD 表", fromJson(parseLossless('[{"a":1,"b":2}]'), "mdtable").text.includes("| a | b |"), true);
eq("convert·MD 往返", toJson("| a | b |\n| --- | --- |\n| 1 | 2 |", "mdtable").text.includes('"a"'), true);
eq("convert·空输入", toJson("", "yaml").ok, true);
eq("convert·非法 YAML", toJson("a: [1", "yaml").ok, false);
eq("convert·大整数不静默降级", fromJson(bigVal, "xml").ok, false);
ok("convert·大整数 XML 报错含字面量", fromJson(bigVal, "xml").error.includes("12345678901234567890"));

/* ========================= 11. 全链路大整数（回归） ========================= */

eq("chain·parse→format→query→codegen", (() => {
  const p = P(BIG);
  const f = formatJson(BIG);
  const q = runQuery(p.value, "$.id", "jsonpath");
  const g = generateCode(p.value, "python");
  return f.includes("12345678901234567890") && q.values.length === 1 && g.ok;
})(), true);
eq("chain·JSONL 内大整数", P('{"id":12345678901234567890}\n{"id":1}').lines[0].ok, true);
eq("chain·日志片段内大整数", extractFragments('log {"id":12345678901234567890}')[0].pretty.includes("12345678901234567890"), true);

/* ========================= 注入式验证 ========================= */
/* 故意注入必失败项，确认 eq()/ok() 真的会累加 failed 并以非 0 退出。
   正常跑（不设 INJECT_FAIL）时这段不执行，不影响绿色结论。 */
if (process.env.INJECT_FAIL === "1") {
  eq("INJECT·eq 必失败", "故意错", "正确值");
  ok("INJECT·ok 必失败", false, "故意 false");
}

if (failed > 0) {
  console.error(`\n❌ JSON 内核自测失败：${failed} 项（通过 ${passed} 项）`);
  process.exit(1);
}
console.log(`✅ JSON 内核自测通过（${passed} 条用例，0 失败）`);
