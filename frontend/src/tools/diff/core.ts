/**
 * 文本对比内核 —— **纯函数层，无 React / 无 DOM / 无 localStorage**。
 *
 * 为什么单独一层（与 `tools/json/` 同一约定）：
 * 视图层（MergeView）与自测脚本（`scripts/test-tools.mjs`）依赖同一组结构；
 * 「把左侧某个改动推到右侧」这类操作最容易写错边界，必须能脱离浏览器逐条断言。
 *
 * ⚠️ 内部 import **必须带 `.ts` 扩展名**：Node 24 类型剥离直接跑自测时不做扩展名补全。
 */

/** 单侧的一段文本范围（字符偏移，左闭右开） */
export interface Span {
  from: number;
  to: number;
}

/**
 * 一个「差异块」（chunk）：左右两侧各自的一段范围。
 *
 * 与 `@codemirror/merge` 的 `Chunk` 对齐，但这里只保留纯数据，
 * 避免内核层依赖 CodeMirror 的 Text 类型（自测无需建编辑器）。
 */
export interface DiffChunk {
  /** 左侧（A）范围 */
  a: Span;
  /** 右侧（B）范围 */
  b: Span;
  /**
   * 精确度：false 表示 diff 触发 scanLimit/timeout 兜底，退化成粗粒度块。
   * UI 需要把这种情况明确标出来（否则用户会以为「整段都变了」是 bug）。
   */
  precise: boolean;
}

/** 行内（字符级）差异片段 */
export interface InlinePiece {
  /** 该片段属于哪一侧 */
  side: "a" | "b";
  /** 在**该侧文档内**的绝对字符偏移 */
  from: number;
  to: number;
  /** 片段文本（便于渲染与自测断言） */
  text: string;
  /** common = 两侧相同；del = 仅左侧有；ins = 仅右侧有 */
  kind: "common" | "del" | "ins";
}

/** 一次推送的结果：要替换的目标范围 + 插入文本 */
export interface PushOp {
  /** 目标侧 */
  side: "a" | "b";
  /** 目标侧被替换的范围 */
  from: number;
  to: number;
  /** 插入的文本 */
  insert: string;
}

/* ------------------------------------------------------------------ */
/* 行内差异                                                            */
/* ------------------------------------------------------------------ */

/**
 * 计算两个字符串的字符级差异（逐字，对中文天然有效 —— 实测「原文」→「修改后的」能切到单字）。
 *
 * 用经典 LCS 动态规划而不是引 diff 库：
 *  - 这里只在**单个 chunk 内部**比较，长度通常几十到几百字符，DP 足够；
 *  - 超过 `MAX_PIECES` 长度时**放弃精细比较**，整段当成一次替换 —— 
 *    宁可粗也不能让主线程卡住（对齐 merge 自己的 scanLimit 思路）。
 *
 * @returns 按顺序排列的片段列表；两侧拼起来分别等于 a 与 b
 */
export function inlineDiff(a: string, b: string): InlinePiece[] {
  // 完全相同时直接返回左右各一段 common（两侧都要有，否则「按侧拼回原文」的断言会失败）
  if (a === b) {
    return a.length === 0
      ? []
      : [
          { side: "a", from: 0, to: a.length, text: a, kind: "common" },
          { side: "b", from: 0, to: b.length, text: b, kind: "common" },
        ];
  }
  // 空串边界：一侧为空 = 纯插入 / 纯删除
  if (a.length === 0) {
    return [{ side: "b", from: 0, to: b.length, text: b, kind: "ins" }];
  }
  if (b.length === 0) {
    return [{ side: "a", from: 0, to: a.length, text: a, kind: "del" }];
  }
  // 超长直接退化成整段替换，避免 DP 的 O(n*m) 把主线程拖死
  if (a.length + b.length > MAX_INLINE_LEN) {
    return [
      { side: "a", from: 0, to: a.length, text: a, kind: "del" },
      { side: "b", from: 0, to: b.length, text: b, kind: "ins" },
    ];
  }

  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  // 用一维滚动数组只能求长度，求不了路径；这里要还原片段，故用完整表。
  // (n+1)*(m+1) 个 int，在 MAX_INLINE_LEN 限制下最大约 4 * 2001 * 2001 ≈ 16 MB —— 可接受；
  // 实际单个 chunk 很少超过 200 字符。
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * w;
    const nextRow = (i + 1) * w;
    const ca = a.charCodeAt(i);
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] =
        ca === b.charCodeAt(j)
          ? dp[nextRow + j + 1] + 1
          : Math.max(dp[nextRow + j], dp[row + j + 1]);
    }
  }

  const pieces: InlinePiece[] = [];
  /**
   * 每侧「最后一段可续接片段」的下标。
   *
   * ⚠️ 不能只跟 `pieces[pieces.length - 1]` 比：两侧片段是交替push的
   * （common 会先推 a 再推 b），只用栈顶比较会导致同一侧的连续公共字符
   * 永远合不上，产出逐字碎片。故按侧各记一个游标。
   */
  const tail: Record<"a" | "b", number> = { a: -1, b: -1 };
  const push = (side: "a" | "b", from: number, to: number, text: string, kind: InlinePiece["kind"]) => {
    if (from === to) return;
    const at = tail[side];
    const last = at >= 0 ? pieces[at] : undefined;
    // 只有「同侧 + 同类型 + 偏移连续」才续接
    if (last && last.kind === kind && last.to === from) {
      last.to = to;
      last.text += text;
      return;
    }
    pieces.push({ side, from, to, text, kind });
    tail[side] = pieces.length - 1;
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a.charCodeAt(i) === b.charCodeAt(j)) {
      // 公共字符：左右各推进一格，两侧都记一段 common
      push("a", i, i + 1, a[i], "common");
      push("b", j, j + 1, b[j], "common");
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      push("a", i, i + 1, a[i], "del");
      i++;
    } else {
      push("b", j, j + 1, b[j], "ins");
      j++;
    }
  }
  while (i < n) {
    push("a", i, i + 1, a[i], "del");
    i++;
  }
  while (j < m) {
    push("b", j, j + 1, b[j], "ins");
    j++;
  }
  return pieces;
}

/** 行内比较的长度上限（两侧字符数之和）。超过则退化成整段替换。 */
export const MAX_INLINE_LEN = 4000;

/* ------------------------------------------------------------------ */
/* 双向推送                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成「把 chunk 的某一侧推到另一侧」的操作。
 *
 * @param textA 左侧当前全文
 * @param textB 右侧当前全文
 * @param chunk 目标差异块
 * @param from  从哪一侧取材（推到对面）
 * @returns 要应用到**对面**的替换操作
 *
 * ⚠️ 边界：A 侧是空块（纯插入）时 fromA == toA，替换范围退化为插入点，
 *    此时不能把 A 侧的换行符带过去（否则每次推送都会多一行空行）。
 */
export function buildPush(
  textA: string,
  textB: string,
  chunk: DiffChunk,
  from: "a" | "b",
): PushOp {
  if (from === "a") {
    // A → B：把左侧这段文本写进右侧
    return {
      side: "b",
      from: chunk.b.from,
      to: chunk.b.to,
      insert: textA.slice(chunk.a.from, chunk.a.to),
    };
  }
  // B → A
  return {
    side: "a",
    from: chunk.a.from,
    to: chunk.a.to,
    insert: textB.slice(chunk.b.from, chunk.b.to),
  };
}

/**
 * 一个「行内替换组」：chunk 内部一处独立的改动。
 *
 * 为什么不能按单个片段推（**这一版第一稿就是错的，已修正**）：
 * `"red"` → `"blue"` 会被逐字切成 `del "r"` + `ins "blu"` + `common "e"`。
 * 单独把 `del "r"` 推到对面，结果变成 `"rblu"` 或 `"blur"` —— 没有任何语义。
 * 用户眼里的「一处改动」是**相邻的 del/ins 合起来**，所以细粒度的单位是替换组。
 *
 * 细粒度真正解决的问题：一个 chunk 里可能有多处互不相干的改动
 * （比如同一段里第 1 行改了、第 5 行也改了），只推其中一处。
 */
export interface InlineGroup {
  /** 组在 A 侧的范围；纯插入组时 from == to */
  a: Span;
  /** 组在 B 侧的范围；纯删除组时 from == to */
  b: Span;
  /** 组内涉及的行内片段下标（含 del 与 ins），供 UI 高亮 */
  pieceIndexes: number[];
}

/**
 * 两处改动之间至少隔这么长的公共文本，才算「两处独立改动」。
 *
 * 为什么要阈值：逐字 diff 会把 `"red"` → `"blue"` 切成
 * `del "r"` + `ins "blu"` + `common "e"` + `del "d"`。
 * 那个 1 字符的 common `"e"` 只是 LCS 对齐的产物，
 * 用户眼里这就是**一处**改动。若见 common 就切组，会切出两个没意义的组，
 * 推送任何一组都得不到正确结果（这是实测踩过的坑）。
 */
export const MIN_GROUP_GAP = 12;

/**
 * 把行内片段聚合成「替换组」：一处改动 = 一组。
 *
 * 边界规则：两处非公共片段之间若夹着 `>= MIN_GROUP_GAP` 个公共字符，才算两处；
 * 否则视为同一处改动（LCS 对齐产生的短公共段不算分隔）。
 *
 * @param pieces `inlineDiff` 的结果
 * @param chunkA 该 chunk 在 A 文档中的绝对范围
 * @param chunkB 该 chunk 在 B 文档中的绝对范围
 */
/**
 * 求出两侧公共前缀长度与公共后缀长度（不重叠）。
 */
export function commonAffixes(a: string, b: string): { prefix: number; suffix: number } {
  const max = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return { prefix, suffix };
}

/**
 * 把 chunk 切成「行内替换组」：一处改动 = 一组。
 *
 * 算法：**按行配对，再做公共前后缀裁剪**。
 *
 * 为什么不用逐字 diff 的片段来切组（这一版前几稿都栽在这里）：
 * `"red"`→`"blue"` 的 LCS 对齐结果是
 *   `del "r"` / `ins "blu"` / `common "e"` / `del "d"`
 * 而那个 `common "e"` 在 B 侧其实被并进了后面一整段
 * `"e\";\nconst size = 10;"`（31 字符，横跨到下一行）。
 * 也就是说两侧的 common 片段长度完全不对称（1 vs 31），
 * 任何「按片段 / 按长度阈值」的切法都无法把组范围算对 —— 会把后续行吞进来。
 *
 * 按行 + 前后缀裁剪则天然正确：每行的改动就是「该行去掉公共前后缀后剩下的中间段」，
 * 两侧范围必然一一对应，推送结果也必然正确。
 *
 * 行数不一致时（纯增删行）退化为「整个 chunk 一组」，由 `buildPush` 处理，
 * 不做 1:1 猜测配对。
 */
export function groupInline(pieces: InlinePiece[], chunkA: Span, chunkB: Span, textA: string, textB: string): InlineGroup[] {
  const aText = textA.slice(chunkA.from, chunkA.to);
  const bText = textB.slice(chunkB.from, chunkB.to);
  const aLines = splitKeepEol(aText);
  const bLines = splitKeepEol(bText);

  // 行数不一致：整块一组，交给 buildPush（整块覆盖语义最稳）
  if (aLines.length !== bLines.length) {
    return [{
      a: { from: chunkA.from, to: chunkA.to },
      b: { from: chunkB.from, to: chunkB.to },
      pieceIndexes: pieces.map((_, i) => i),
    }];
  }

  const groups: InlineGroup[] = [];
  let aOff = 0;
  let bOff = 0;
  for (let i = 0; i < aLines.length; i++) {
    const la = aLines[i];
    const lb = bLines[i];
    const { prefix, suffix } = commonAffixes(la, lb);
    const innerA = la.length - prefix - suffix;
    const innerB = lb.length - prefix - suffix;
    // 两边都完全相同（整行未变）：跳过
    if (innerA > 0 || innerB > 0) {
      const ga = { from: chunkA.from + aOff + prefix, to: chunkA.from + aOff + prefix + innerA };
      const gb = { from: chunkB.from + bOff + prefix, to: chunkB.from + bOff + prefix + innerB };
      // 反查该范围覆盖到的片段（用于 UI 高亮与点击命中）
      const idxs: number[] = [];
      pieces.forEach((p, pi) => {
        if (p.kind === "common") return;
        const abs = p.side === "a" ? chunkA.from + p.from : chunkB.from + p.from;
        const absTo = p.side === "a" ? chunkA.from + p.to : chunkB.from + p.to;
        const range = p.side === "a" ? ga : gb;
        // 片段与组范围有交集即算覆盖
        if (absTo > range.from && abs < Math.max(range.to, range.from + 1)) idxs.push(pi);
        else if (range.from === range.to && abs >= range.from && absTo <= range.from) idxs.push(pi);
      });
      groups.push({ a: ga, b: gb, pieceIndexes: idxs });
    }
    aOff += la.length;
    bOff += lb.length;
  }
  return groups;
}

/**
 * 按行切分并**保留行尾换行符**，保证各段拼回去等于原文。
 * 这与 `String.split("\n")` 不同：后者会丢掉分隔符，导致偏移累加错位。
 */
export function splitKeepEol(text: string): string[] {
  if (text === "") return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * 推送一个「行内替换组」到对面。
 *
 * - A→B：用 A 侧这段文本**替换** B 侧这段范围（B 侧为空就是插入）
 * - B→A：反向
 *
 * ⚠️ 纯插入组（A 侧 from==to）推向 B 时，B 侧范围非空 → 是「用空替换有」= 删除。
 *    这是正确语义：把「右侧多出来的字」推回左侧，右侧就该没有它了。
 */
export function buildGroupPush(
  textA: string,
  textB: string,
  group: InlineGroup,
  from: "a" | "b",
): PushOp {
  if (from === "a") {
    return {
      side: "b",
      from: group.b.from,
      to: group.b.to,
      insert: textA.slice(group.a.from, group.a.to),
    };
  }
  return {
    side: "a",
    from: group.a.from,
    to: group.a.to,
    insert: textB.slice(group.b.from, group.b.to),
  };
}

/**
 * 把 chunk 内某侧的相对偏移映射到对面的绝对偏移。
 *
 * 仅用于「点空白处」这类不需要精确对齐的场景；精确推送请走 `buildGroupPush`。
 */
export function mapOffset(chunk: DiffChunk, side: "a" | "b", offset: number): number {
  const from = side === "a" ? chunk.a : chunk.b;
  const to = side === "a" ? chunk.b : chunk.a;
  const len = from.to - from.from;
  const clamped = Math.max(0, Math.min(offset, len));
  return Math.min(Math.max(to.from + clamped, to.from), to.to);
}

/**
 * 统计差异：多少块、各侧增删字符数。
 * 用于工具栏显示「N 处差异（+x / -y）」。
 */
export function summarize(textA: string, textB: string, chunks: DiffChunk[]): DiffSummary {
  let plus = 0;
  let minus = 0;
  for (const c of chunks) {
    minus += c.a.to - c.a.from;
    plus += c.b.to - c.b.from;
  }
  return {
    chunks: chunks.length,
    plusChars: plus,
    minusChars: minus,
    /** 任一块不精确 = 整体不精确，UI 要提示 */
    precise: chunks.every((c) => c.precise),
    same: chunks.length === 0,
    linesA: countLines(textA),
    linesB: countLines(textB),
  };
}

export interface DiffSummary {
  chunks: number;
  plusChars: number;
  minusChars: number;
  precise: boolean;
  same: boolean;
  linesA: number;
  linesB: number;
}

/** 行数（空文本算 0 行，避免空文档显示「1 行」） */
export function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

/* ------------------------------------------------------------------ */
/* 忽略空白 / 大小写                                                    */
/* ------------------------------------------------------------------ */

export interface CompareOptions {
  /** 忽略行尾空白与行首缩进差异 */
  ignoreWhitespace: boolean;
  /** 忽略英文大小写 */
  ignoreCase: boolean;
}

/**
 * 生成用于比较的归一化文本，同时保持**字符长度与原文本一致**。
 *
 * ⚠️ 这是关键约束：diff 结果要映射回原文做高亮与推送，
 *    长度一旦变化，所有偏移就全错了。所以只做「按位置替换成等价字符」，
 *    绝不做删除/压缩空白（那正是最容易埋雷的写法）。
 *
 * 做法：把空白字符统一成普通空格，把大小写统一成小写；长度不变。
 */
export function normalizeForCompare(text: string, opt: CompareOptions): string {
  if (!opt.ignoreWhitespace && !opt.ignoreCase) return text;
  if (!text) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let c = ch;
    if (opt.ignoreCase) c = c.toLowerCase();
    // 只把「非换行的空白」归一成空格；换行必须保留，否则行结构会被破坏
    if (opt.ignoreWhitespace && c !== "\n" && c !== "\r" && /\s/.test(c)) c = " ";
    out += c;
  }
  return out;
}

/**
 * 两侧行数相差过大时的性能护栏阈值（字符数）。
 * 超过后由视图层显示提示，避免用户误以为卡死。
 */
export const LARGE_DOC_CHARS = 300_000;
