/**
 * CT 分享页的纯逻辑（无 React 依赖，可在 Node 里直接跑测试）。
 *
 * 旧版靠扫描注入的 HTML DOM 找图片；改成结构化数据后，
 * 图片下标换算变成纯数组运算 —— 抽出来便于测试，不再依赖 DOM。
 */
/** 测试/纯逻辑用的最小结构（与 api.ts 的 CtPhoto 字段一致，不 import 避免 Node 加载 React 链）。 */
export interface LogicPhoto {
  id: number;
  caption: string;
  url: string;
}
export interface LogicExam {
  exam_time: string;
  photos: LogicPhoto[];
}

/** 从时间串里截取日期（导航条用）。 */
export function shortDate(s: string): string {
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s || "—";
}

/**
 * 把「第 examIndex 次检查里的第 photoIndex 张照片」换算成灯箱的全局下标。
 * 返回 -1 表示参数越界（页面据此不开灯箱）。
 */
export function globalPhotoIndex(
  exams: LogicExam[],
  examIndex: number,
  photoIndex: number,
): number {
  if (examIndex < 0 || examIndex >= exams.length) return -1;
  const photos = exams[examIndex].photos;
  if (photoIndex < 0 || photoIndex >= photos.length) return -1;
  let base = 0;
  for (let i = 0; i < examIndex; i += 1) base += exams[i].photos.length;
  return base + photoIndex;
}

/** 摊平全部照片（灯箱数据源），保持检查顺序。 */
export function flattenPhotos(
  exams: LogicExam[],
): { url: string; caption: string; examIndex: number; photo: LogicPhoto }[] {
  const out: { url: string; caption: string; examIndex: number; photo: LogicPhoto }[] = [];
  exams.forEach((e, i) => {
    e.photos.forEach((p) => {
      out.push({
        url: p.url,
        caption: p.caption || `第 ${i + 1} 次检查 · ${shortDate(e.exam_time)}`,
        examIndex: i,
        photo: p,
      });
    });
  });
  return out;
}
