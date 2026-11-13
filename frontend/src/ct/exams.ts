/**
 * CT 报告的「检查次数」结构解析（纯函数，无 React 依赖，可在 Node 里直接跑测试）。
 *
 * 背景
 * ----
 * 报告 HTML 把**每一次检查**装进一个 `<section>`，中间用 `.sep` 分隔。
 * 用户会不断追加新的检查，页面必须能：
 *   - 从正文里解析出「一共几次、每次的日期/项目」；
 *   - 感知「当前正滚到第几次」；
 *   - 把「第几张图片」映射回「第几次检查」（灯箱标题用）。
 *
 * ⚠️ 全部是**只读解析**：不改报告 HTML 一个字节，报告正文仍原样注入。
 * 解析失败时一律降级为空数组 / 默认值，页面照常显示报告，绝不让解析问题
 * 把整页弄崩 —— 追加报告时格式可能和现在略有出入。
 */

export interface ExamInfo {
  /** 0-based 序号 */
  index: number;
  /** 完整时间，如 `2023-05-27 10:15:26` */
  datetime: string;
  /** 日期部分，如 `2023-05-27`；解析不到时用完整时间或空串 */
  date: string;
  /** 检查项目，如 `CT胸部(内科平扫)组套` */
  project: string;
}

/** 常见 HTML 实体还原（报告正文里可能出现 &amp; 等）。 */
function decodeEntities(s: string): string {
  const map: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ",
  };
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (whole, key: string) => map[key] ?? whole);
}

/**
 * 从报告正文 HTML 里解析出检查列表。
 *
 * 每个 `<section>` = 一次检查；取其中「检查时间：」「检查项目：」两行。
 * 找不到 `<section>` 时返回 `[]`（页面会隐藏导航条，只显示报告正文）。
 */
export function parseExams(bodyHtml: string): ExamInfo[] {
  // ⚠️ 正则在函数内新建：全局正则的 lastIndex 会跨调用残留，复用会漏匹配
  const sectionRe = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
  const timeRe = /检查时间\s*[：:]\s*([^<\n]+)/;
  const projectRe = /检查项目\s*[：:]\s*([^<\n]+)/;
  const out: ExamInfo[] = [];
  let m: RegExpExecArray | null;

  while ((m = sectionRe.exec(bodyHtml)) !== null) {
    const inner = m[1];
    const tm = inner.match(timeRe);
    const pm = inner.match(projectRe);
    const datetime = tm ? decodeEntities(tm[1]).trim() : "";
    const date = /^\d{4}-\d{2}-\d{2}/.test(datetime) ? datetime.slice(0, 10) : datetime;
    out.push({
      index: out.length,
      datetime,
      date,
      project: pm ? decodeEntities(pm[1]).trim() : "",
    });
  }
  return out;
}

/** 时间跨度文案：首末日期相同则只显示一个。 */
export function examSpan(exams: ExamInfo[]): string {
  if (!exams.length) return "";
  const first = exams[0].date || "第 1 次";
  const last = exams[exams.length - 1].date || `第 ${exams.length} 次`;
  return first === last ? first : `${first} → ${last}`;
}

/**
 * 当前正在看第几次：给定每个 section 距视口顶部的 top，返回最后一个已滚过
 * 阈值线的 section 下标。
 *
 * - `tops` 按文档顺序排列（单调递增）
 * - `threshold` 是「判定线」距视口顶部的像素数（要盖住 sticky 导航条的高度）
 * - 全都在判定线之下 → 0（页面顶部，正在看第 1 次）
 * - `atBottom` 为 true 时强制返回最后一次：最后一个 section 若很短，
 *   永远滚不到判定线以上，不兜底会一直停在倒数第二次
 */
export function activeSectionIndex(
  tops: number[],
  threshold = 160,
  atBottom = false,
): number {
  if (!tops.length) return 0;
  if (atBottom) return tops.length - 1;
  let active = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] <= threshold) active = i;
  }
  return active;
}

/**
 * 图片 → 检查的映射：返回长度 = 图片总数，每项是该图片所属 section 的下标
 * （不在任何 section 里的图片为 -1）。
 *
 * 纯逻辑版（按「每次检查含几张图」展开）；页面里用 `collectImageExamMap`
 * 从真实 DOM 直接算，两者口径一致。
 */
export function imageExamMap(imagesPerExam: number[]): number[] {
  const map: number[] = [];
  imagesPerExam.forEach((n, examIdx) => {
    for (let i = 0; i < n; i += 1) map.push(examIdx);
  });
  return map;
}

/** 从报告容器直接算「每张图片属于第几次检查」（DOM 版，顺序与 collectImages 一致）。 */
export function collectImageExamMap(container: HTMLElement | null): number[] {
  if (!container) return [];
  const sections = Array.from(container.querySelectorAll("section"));
  return Array.from(container.querySelectorAll("img")).map((img) => {
    const sec = (img as Element & { closest?: (s: string) => Element | null }).closest?.("section");
    return sec ? sections.indexOf(sec as HTMLElement) : -1;
  });
}

/** 取报告容器里的 section 节点（供滚动定位 / 高度测量）。 */
export function collectSections(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll("section")) as HTMLElement[];
}

/** 每张图片在灯箱里显示的小标题，如「第 2 次检查 · 2026-01-21」。 */
export function imageExamLabels(exams: ExamInfo[], imageExam: number[]): string[] {
  return imageExam.map((examIdx) => {
    if (examIdx < 0 || examIdx >= exams.length) return "";
    const e = exams[examIdx];
    return `第 ${e.index + 1} 次检查 · ${e.date || "日期未知"}`;
  });
}

/**
 * 「分页模式」的 CSS：**只给报告容器加一条动态样式，不改报告 DOM**。
 *
 * 为什么用 `section:nth-of-type(N)`：报告把每次检查装进一个 `<section>`，
 * 中间用 `<div class="sep">` 分隔。`nth-of-type` 只数同类型的兄弟元素，
 * 所以 sep 不占序号 —— N 正好等于「第 N 次检查」。
 *
 * - 分页时隐藏报告自带的标题 / 摘要 / 分隔符（导航条已把这些信息说清了，留着是冗余）
 * - 打印时**强制全展开**：`@media print` 覆盖分页隐藏，医生打印拿到完整报告，而不是只剩当前这一次
 *
 * ⚠️ 这段样式注入顺序在 `embedded.css`（报告自带样式）**之后**，同名属性才能盖住它。
 */
export function pagedCss(activeIndex: number): string {
  const n = Math.max(1, activeIndex + 1); // nth-of-type 是 1-based
  return `
.ct-report[data-paged="1"] > main > h1,
.ct-report[data-paged="1"] > main > .summary,
.ct-report[data-paged="1"] .sep { display: none; }
.ct-report[data-paged="1"] section { display: none; }
.ct-report[data-paged="1"] section:nth-of-type(${n}) { display: block; }
@media print {
  .ct-report section { display: block !important; }
  .ct-report .sep { display: flex !important; }
  .ct-report > main > h1,
  .ct-report > main > .summary { display: block !important; }
}`;
}
