/**
 * 汉字拼读课观看进度记忆（localStorage 持久化）
 *
 * 与 hanzi 的进度**分开存储**（key 不同），两门课互不干扰。
 * 本课程是长视频（单集 20~31 分钟），续播与「看完」语义比短课重要得多：
 * 退出时记得位置，下次点开直接接着看。
 */

export interface PinziProgress {
  pos: number; // 上次播放位置（秒）
  dur: number; // 视频总时长（秒）
  done: boolean; // 是否看完
}

export type PinziProgressMap = Record<string, PinziProgress>;

const KEY = "pinzi_progress";
export const AUTOPLAY_KEY = "pinzi_autoplay";

export function loadProgress(): PinziProgressMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function saveProgress(seq: number, pos: number, dur: number, done = false) {
  if (!Number.isFinite(pos)) return;
  try {
    const map = loadProgress();
    const prev = map[String(seq)];
    map[String(seq)] = {
      pos,
      dur,
      done: done || prev?.done || false, // 一旦看完永远标记已学
    };
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等场景静默失败 */
  }
}

/** 看完比例（0~1），用于卡片进度条；未知时长返回 0 */
export function watchedRatio(p?: PinziProgress): number {
  if (!p || !p.dur) return 0;
  if (p.done) return 1;
  return Math.max(0, Math.min(1, p.pos / p.dur));
}

export function loadAutoplay(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAutoplay(on: boolean) {
  try {
    localStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
