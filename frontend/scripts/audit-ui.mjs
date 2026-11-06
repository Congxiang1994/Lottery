#!/usr/bin/env node
/**
 * 前端 UI 一致性审计（全站规范的可执行版本）。
 *
 * 用法：`cd frontend && node scripts/audit-ui.mjs`（纯 Node 标准库，无依赖）
 * 退出码：0 = 通过；1 = 有违规（逐条打印 文件:行号 + 改法）。
 *
 * 查的是「同一件事又被写了一遍」这类回归 —— 它们不会让构建失败，
 * 只会让页面之间慢慢长得不一样：
 *   1. 页面里裸 fetch（必须走 common/http.ts 的 createApi）
 *   2. 手写密码门（必须用 common/AdminGate）
 *   3. 手写弹窗遮罩（必须用 common/AppModal）
 *   4. 手写 <h1>（必须用 common/PageHeader）
 *   5. 手写加载态（必须用 common/State 的 Loading）
 *   6. 主按钮用金色渐变（金色是强调色，不作按钮底色）
 *   7. 输入框类名手写（必须用 common/ui.ts 的 INPUT / INPUT_SM）
 *
 * 白名单按「该文件是这个规范的实现方」逐个列，不做通配 ——
 * 通配会把将来新加的页面一起放过。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const violations = [];

const RULES = [
  {
    id: "raw-fetch",
    test: (line) => /\bfetch\s*\(/.test(line),
    hint: "请求必须走 common/http.ts 的 createApi / request",
    // 访问统计与埋点是「裸 fetch 更合适」的两处（要发 keepalive / 不计入统一错误提示）
    allow: ["common/http.ts", "common/useVisitCount.ts", "common/usePageTrack.ts"],
  },
  {
    id: "handwritten-gate",
    test: (line) => /function PasswordGate\b/.test(line),
    hint: "密码门必须用 common/AdminGate",
    allow: [],
  },
  {
    id: "handwritten-modal",
    test: (line) => /\banim-overlay\b/.test(line) || /\banim-panel\b/.test(line),
    hint: "弹窗必须用 common/AppModal（遮罩/层级/滚动/Esc 都在里面）",
    allow: ["common/AppModal.tsx", "common/Modal.tsx"],
  },
  {
    id: "handwritten-h1",
    test: (line) => /<h1[\s>]/.test(line),
    hint: "页面标题必须用 common/PageHeader",
    allow: [
      "portal/Portal.tsx", // 门户有自己的 hero 版式
      "common/PageHeader.tsx",
      "common/AdminGate.tsx", // 密码门的标题是表单的一部分
      "hanzi/HanziPlayer.tsx", // 水墨皮肤，版式独立
    ],
  },
  {
    id: "handwritten-loading",
    test: (line) => /animate-spin/.test(line) && /加载中|正在确认/.test(line),
    hint: "加载态必须用 common/State 的 Loading",
    allow: ["common/State.tsx", "common/AdminGate.tsx"],
  },
  {
    id: "gold-primary-button",
    test: (line) => /from-brand-gold to-brand-red\b/.test(line) && /<button/.test(line),
    hint: "金色是强调色，按钮底色统一用品牌红（BTN_PRIMARY）",
    allow: [],
  },
  {
    id: "handwritten-input",
    test: (line) => /border border-paper-200 bg-white\/60 px-3 py-2/.test(line),
    hint: "输入框类名必须用 common/ui.ts 的 INPUT / INPUT_SM",
    allow: ["common/ui.ts"],
  },
];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) check(p);
  }
}

function check(path) {
  const rel = relative(ROOT, path).replaceAll("\\", "/");
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.allow.includes(rel)) continue;
      if (rule.test(line)) {
        violations.push({
          rel, line: i + 1, rule: rule.id, hint: rule.hint,
          text: line.trim().slice(0, 96),
        });
      }
    }
  });
}

walk(ROOT);

if (violations.length === 0) {
  console.log("✅ 前端 UI 一致性审计通过（7 条规则，0 违规）");
  process.exit(0);
}

console.error(`❌ 前端 UI 一致性审计失败：${violations.length} 处违规\n`);
for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  [${v.rule}]`);
  console.error(`     ${v.text}`);
  console.error(`     → ${v.hint}`);
}
process.exit(1);
