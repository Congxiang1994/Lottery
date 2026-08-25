/**
 * 汉字课观看进度记忆（localStorage 持久化）
 * - 记录每集看过的位置（续播用）与是否看完（列表角标用）
 * - 连播开关持久化
 */

export interface HanziProgress {
  pos: number; // 上次播放位置（秒）
  dur: number; // 视频总时长（秒）
  done: boolean; // 是否看完
}

export type HanziProgressMap = Record<string, HanziProgress>;

const KEY = "hanzi_progress";
export const AUTOPLAY_KEY = "hanzi_autoplay";

export function loadProgress(): HanziProgressMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveProgress(num: number | null, pos: number, dur: number, done = false) {
  if (num == null || !Number.isFinite(pos)) return;
  try {
    const map = loadProgress();
    const prev = map[String(num)];
    map[String(num)] = {
      pos,
      dur,
      done: done || prev?.done || false, // 一旦看完永远标记已学
    };
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等场景静默失败 */
  }
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
