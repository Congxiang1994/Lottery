/**
 * JSON 字符串的转义 / 反转义（成对，可往返）。
 *
 * 为什么要单独一套（不复用 tools/mdUnescape.ts）
 * ------------------------------------------------
 * 同样是「字面量 → 真实字符」，但两边的转义集合按各自标准取：
 *   JSON    只认 \" \\ \/ \b \f \n \r \t \uXXXX —— 这是 JSON 规范里**全部**的转义；
 *   Markdown 不认 \b \f —— 文本里出现 `C:\bin` 这类路径时，按 JSON 规则
 *            还原会变成退格符，直接吃掉正文。
 * 规则真的不同，就不是重复代码，而是两份规格。改其中一份时别顺手「对齐」。
 */

const SIMPLE: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export type JsonUnescapeResult = {
  /** 还原后的文本 */
  text: string;
  /** 实际替换掉的转义序列个数 */
  changes: number;
  /** 是否剥掉了外层成对引号（JSON 字符串字面量形态） */
  strippedQuotes: boolean;
};

/**
 * 转义：把任意文本变成**带引号**的 JSON 字符串字面量。
 *
 * 交给 `JSON.stringify` 做，不手写：控制字符、代理对、U+2028 之类
 * 都由它按规范处理，手写一定会漏。返回形如 `"a\nb"` 的完整字面量。
 */
export function escapeJsonString(input: string): string {
  return JSON.stringify(input);
}

/**
 * 剥掉外层成对双引号 —— **必须在反转义之前做**。
 *
 * 反转义之后 `\"` 已经变成真正的 `"`，就和原文里的引号混在一起、
 * 再也分不清哪个是包裹符了（`"quote \"x\""` 往返会失败）。
 * 所以这里看的是原始字面量：内部只要还有**未转义的** `"`，就不剥。
 */
function stripOuterQuotes(input: string): { text: string; stripped: boolean } {
  if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
    return { text: input, stripped: false };
  }
  let escaped = false;
  for (let i = 1; i < input.length - 1; i += 1) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return { text: input, stripped: false };
  }
  return { text: input.slice(1, -1), stripped: true };
}

/**
 * 反转义：把字面量转义还原成真实字符。
 *
 * - 支持 JSON 规范里的全部转义：`\" \\ \/ \b \f \n \r \t \uXXXX`
 * - 不认识的转义（`\|`、`\*` 等）**原样保留**，避免误伤非 JSON 文本
 * - 整段被一对双引号包住时顺手剥掉（从 JSON 文档里复制出来的常见形态）
 * - 不 trim、不改动其它字符；与 `escapeJsonString` 严格互逆
 */
export function unescapeJsonString(input: string): JsonUnescapeResult {
  const { text: body, stripped } = stripOuterQuotes(input);
  let out = "";
  let changes = 0;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\" || i === body.length - 1) {
      out += ch;
      continue;
    }
    const next = body[i + 1];

    if (next === "u") {
      const hex = body.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        changes += 1;
        i += 5;
        continue;
      }
      // \u 后面不是 4 位十六进制：保留原样（如 `\usb` 这类路径）
      out += ch;
      continue;
    }

    const mapped = SIMPLE[next];
    if (mapped !== undefined) {
      out += mapped;
      changes += 1;
      i += 1;
      continue;
    }

    out += ch;
  }

  return { text: out, changes, strippedQuotes: stripped };
}
