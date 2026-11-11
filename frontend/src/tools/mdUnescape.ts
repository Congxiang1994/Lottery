/**
 * Markdown 转义还原：把「字面量转义」变成真实字符。
 *
 * 场景：从接口返回、日志、聊天窗口复制出来的 Markdown 常常是**一行**，
 * 换行被写成两个字符 `\` + `n`，粘进编辑器里就是一大坨，表格也渲染不出来。
 *
 * 规则（只认标准转义，**不碰 Markdown 自己的转义**）：
 *   \n → 换行   \r → 回车   \t → 制表符
 *   \\ → 反斜杠   \" → "   \' → '   \` → `   \/ → /
 *   \uXXXX（恰好 4 位十六进制）→ 对应字符
 *
 * 刻意**不处理** `\|`、`\*`、`\_`、`\[` 等：它们在 GFM 表格里是合法的
 * 转义（单元格内的竖线、星号），还原掉反而会破坏结构。
 *
 * 另外顺手剥掉整体包裹的成对引号（`"…"` / `'…'` / 反引号）——
 * 那是 JSON 字符串复制出来的常见形态，不是正文内容。
 */

const SIMPLE: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "`": "`",
  "/": "/",
};

export type UnescapeResult = {
  /** 还原后的文本 */
  text: string;
  /** 实际替换掉的转义序列个数（用于界面反馈） */
  changes: number;
  /** 是否剥掉了外层包裹引号 */
  strippedQuotes: boolean;
};

/** 整体被成对引号包裹时剥掉（内部不得再出现同种引号，避免误伤正文）。 */
function stripWrapperQuotes(input: string): { text: string; stripped: boolean } {
  if (input.length < 2) return { text: input, stripped: false };
  const head = input[0];
  if (head !== '"' && head !== "'" && head !== "`") return { text: input, stripped: false };
  if (input[input.length - 1] !== head) return { text: input, stripped: false };
  const inner = input.slice(1, -1);
  if (inner.includes(head)) return { text: input, stripped: false };
  return { text: inner, stripped: true };
}

/**
 * 把转义序列还原为真实字符。**不做 trim**（首尾空白由调用方决定），
 * 也**不识别 Markdown 语法**——纯字符串层面的变换。
 */
export function unescapeMarkdown(input: string): UnescapeResult {
  let out = "";
  let changes = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "\\" || i === input.length - 1) {
      out += ch;
      continue;
    }
    const next = input[i + 1];

    // \uXXXX —— 恰好 4 位十六进制才换，否则原样保留
    // （`C:\users` 这种路径里的 \u 后面不是十六进制，不能被吃掉）
    if (next === "u") {
      const hex = input.slice(i + 2, i + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        changes += 1;
        i += 5;
        continue;
      }
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

    // 其余（\| \* \_ \[ …）原样保留：它们是 Markdown 自己的转义
    out += ch;
  }

  const { text: unwrapped, stripped } = stripWrapperQuotes(out.trim());
  return { text: stripped ? unwrapped : out, changes, strippedQuotes: stripped };
}
