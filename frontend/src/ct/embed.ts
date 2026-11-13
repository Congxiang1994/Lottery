/**
 * CT 报告 HTML → 页面内联片段（纯函数，零副作用）。
 *
 * 背景
 * ----
 * 报告是一份自带的完整 HTML（含 `<style>` 与内嵌 base64 图片）。需求是
 * **整个代码融进站点页面**，而不是 iframe 嵌一个独立文档 ——
 * iframe 会让浏览器显示「正在渲染网页」，而且它是另一份文档：
 * 打印、选中、返回键、站点暗色模式全都对不上。
 *
 * 做法
 * ----
 * 1. `extractReport` 把 HTML 拆成 **CSS** 与 **正文** 两块（`<style>` / `<body>`）。
 * 2. `scopeCss` 把 CSS 的每条选择器**加前缀**到报告容器上
 *    （`h1` → `.ct-report h1`），原样式规则一字不改，只是限定作用范围。
 * 3. 正文用 `dangerouslySetInnerHTML` 直接铺进容器。
 *
 * ⚠️ 为什么要加作用域：报告自带 `body { background:#fff; font:… }` 这类
 * **元素级**规则，若原样注入全局样式，会把整个站点的 body 背景/字体改掉。
 * 加前缀后，报告规则只在自己的容器内生效 —— 站内其它页面毫发无损，
 * 而报告内部的观感与原文件一致（`body` → `.ct-report`，
 * `main`/`.summary`/`section` 等 → `.ct-report main` 等）。
 *
 * 作用域化是**字符串级**的前缀改写（不重写规则内容），
 * 因此 `@media print` 里的规则同样会被限定，打印时报告排版正确。
 */

/** 报告容器的类名（前端与本模块共用，改一处即可）。 */
export const CT_REPORT_SCOPE = "ct-report";

/** 作用域**类选择器**（`.ct-report`）—— 注入 CSS 时用的就是它。 */
const SCOPE_SEL = `.${CT_REPORT_SCOPE}`;

export interface ParsedReport {
  /** 报告自带的 CSS（未加作用域，需过 `scopeCss`） */
  css: string;
  /** 报告正文 HTML */
  body: string;
  /** `<title>`（仅展示用） */
  title: string;
}

/** 去掉 `<style>` / `<body>` 的注释与多余空白（不改正文内容）。 */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/** 取第一个 `<title>` 的内容（找不到返回空串）。 */
export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : "";
}

/**
 * 拆分报告 HTML：取出全部 `<style>` 内容与 `<body>` 正文。
 *
 * 容错：找不到 `<body>` 时退回「去掉 head 之后」的剩余部分；
 * 找不到 `<style>` 时返回空 CSS（页面照常显示正文，只是没有原样式）。
 */
export function extractReport(html: string): ParsedReport {
  const src = stripComments(html);

  // 全部 <style> 块（可能有多个）
  const css: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(src)) !== null) {
    css.push(m[1]);
  }

  // <body> 正文
  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body: string;
  if (bodyMatch) {
    body = bodyMatch[1];
  } else {
    const headMatch = src.match(/<head[^>]*>[\s\S]*?<\/head>/i);
    body = headMatch ? src.slice((headMatch.index ?? 0) + headMatch[0].length) : src;
    body = body.replace(/<\/?html[^>]*>/gi, "");
  }

  return { css: css.join("\n"), body: body.trim(), title: extractTitle(src) };
}

/**
 * 把一段 CSS 的选择器加前缀到作用域容器上。
 *
 * 规则
 * ----
 * - 普通规则：`h1` → `作用域 h1`；`a, b` → `作用域 a, 作用域 b`（逐个加）
 * - `body` / `html` / `:root` → 直接换成作用域容器本身
 *   （报告的 body 背景/字体应当落在**报告容器**上，而不是站点 body）
 * - `@media` / `@supports` 等块状 at-rule → **递归**处理其内部规则
 * - `@font-face` / `@keyframes` / `@page` → 原样保留（内部选择器不是元素选择器）
 * - 注释原样保留（便于读懂注入的样式）
 */
export function scopeCss(css: string, scope: string = SCOPE_SEL): string {
  return scopeBlock(css, scope);
}

/** 递归处理一段 CSS 文本。 */
function scopeBlock(css: string, scope: string): string {
  const n = css.length;
  let out = "";
  let i = 0;

  while (i < n) {
    // 跳过空白与注释
    while (i < n) {
      const ch = css[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") {
        i += 1;
        continue;
      }
      if (css.startsWith("/*", i)) {
        const end = css.indexOf("*/", i + 2);
        if (end === -1) {
          out += css.slice(i);
          return out;
        }
        out += css.slice(i, end + 2) + "\n";
        i = end + 2;
        continue;
      }
      break;
    }
    if (i >= n) break;

    // 找到本条规则的 prelude（'{' 或 ';' 之前）
    let j = i;
    let depth = 0;
    while (j < n) {
      const ch = css[j];
      if (ch === "{") {
        if (depth === 0) break;
        depth += 1;
      } else if (ch === "}") {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === ";" && depth === 0) {
        break;
      }
      j += 1;
    }
    if (j >= n) break;

    const prelude = css.slice(i, j).trim();
    if (!prelude) {
      i = j + 1;
      continue;
    }

    // 语句型 at-rule（@import / @charset …）→ 原样保留
    if (css[j] === ";") {
      out += `${prelude};\n`;
      i = j + 1;
      continue;
    }

    // 取出配对的块内容
    let blockDepth = 1;
    let k = j + 1;
    while (k < n && blockDepth > 0) {
      if (css[k] === "{") blockDepth += 1;
      else if (css[k] === "}") blockDepth -= 1;
      k += 1;
    }
    const body = css.slice(j + 1, k - 1);

    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).split(/[\s({]/)[0].toLowerCase();
      if (name === "media" || name === "supports" || name === "layer" || name === "container") {
        out += `${prelude} {\n${scopeBlock(body, scope)}}\n`;
      } else {
        // @font-face / @keyframes / @page → 原样（内部不是元素选择器）
        out += `${prelude} { ${body} }\n`;
      }
    } else {
      out += `${scopeSelector(prelude, scope)} { ${body} }\n`;
    }
    i = k;
  }

  return out;
}

/** 给一条（可能多选择器）规则加作用域前缀。 */
export function scopeSelector(selector: string, scope: string = SCOPE_SEL): string {
  const parts = selector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sel) => scopeOne(sel, scope));
  return parts.join(", ");
}

/** 单个选择器加前缀。 */
function scopeOne(sel: string, scope: string): string {
  // html / body / :root → 容器本身
  if (/^(html|body|:root)$/i.test(sel)) return scope;
  // "html body" / "body.main" 这类带元素的复合选择器 → 替换首个元素名
  const replaced = sel.replace(/^(?:html\s+)?body\b/i, scope).replace(/^:root\b/i, scope);
  if (replaced !== sel) {
    // 后续还有后代选择器时，容器已在前缀位置，直接返回
    return replaced;
  }
  return `${scope} ${sel}`;
}
