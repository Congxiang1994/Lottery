import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * 全局日/夜模式（整站统一）。**只有亮 / 暗两档**，不引入第三种模式。
 *
 * - 默认按**本地时段**决定：07:00–17:59 亮色，其余时段暗色
 * - 右上角按钮就是普通的亮/暗开关：点一下切换到另一档
 * - 手动选择只对**当前时段**有效 —— 到下一个时段边界（7:00 / 18:00）
 *   自动回到「按时间」的结果，避免一次误点就永久关掉自动行为
 *
 * 实现：<html> 挂/摘 ".site-night" class，样式见 index.css 的 .site-night 段
 * - index.html 头部内联脚本在渲染前同步算一次，防刷新白屏闪烁
 *   ⚠️ 阈值与覆盖规则改动必须与 index.html 内联脚本同步
 *
 * 时段判断用 `new Date()` 的**本地时间**：天然就是用户所在时区的墙上时间，
 * 所以不需要经纬度 / 时区换算 / 联网。跨日与休眠漂移由 visibilitychange 兜底。
 */

/** 手动覆盖的存储键：{"v":"day"|"night","until":<到期时间戳>} */
const OVERRIDE_KEY = "site_theme_override";

/** 亮色时段 [DAY_START, DAY_END)，本地小时。改这里必须同步 index.html */
export const DAY_START = 7;
export const DAY_END = 18;

/** 当前本地时间是否应处于暗色（纯时段判断，不含手动覆盖） */
export function isNightByClock(d: Date = new Date()): boolean {
  const h = d.getHours();
  return h < DAY_START || h >= DAY_END;
}

/** 下一个时段边界：今天 7 点 / 今天 18 点 / 明天 7 点 */
export function nextBoundary(d: Date = new Date()): Date {
  const t = new Date(d);
  const h = d.getHours();
  if (h < DAY_START) t.setHours(DAY_START, 0, 0, 0);
  else if (h < DAY_END) t.setHours(DAY_END, 0, 0, 0);
  else {
    t.setDate(t.getDate() + 1);
    t.setHours(DAY_START, 0, 0, 0);
  }
  return t;
}

/** 读取仍然有效的手动覆盖；已过期或非法则返回 null */
function readOverride(): "day" | "night" | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || (o.v !== "day" && o.v !== "night") || typeof o.until !== "number") return null;
    return Date.now() < o.until ? o.v : null;
  } catch (e) {
    return null;
  }
}

/** 写入手动覆盖，有效期到下一个时段边界 */
function writeOverride(value: "day" | "night") {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ v: value, until: nextBoundary().getTime() }));
  } catch (e) {}
}

/** 当前应否暗色：有效的手动覆盖优先，否则按本地时段 */
function computeNight(): boolean {
  const ov = readOverride();
  return ov ? ov === "night" : isNightByClock();
}

export function useThemeState() {
  // 首屏实际生效值以 <html> 上的 class 为准（内联脚本已按同一规则算过）
  const [night, setNight] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("site-night")
      ? true
      : computeNight(),
  );
  const [manual, setManual] = useState(() => readOverride() !== null);

  // 应用 class
  useEffect(() => {
    document.documentElement.classList.toggle("site-night", night);
  }, [night]);

  // 定时到下一个时段边界：到点后覆盖自然过期、按时间重算；回到页面时纠正（覆盖休眠漂移）
  const timerRef = useRef(0);
  useEffect(() => {
    const sync = () => {
      setNight(computeNight());
      setManual(readOverride() !== null);
    };
    const arm = () => {
      const delay = Math.max(nextBoundary().getTime() - Date.now(), 0);
      timerRef.current = window.setTimeout(() => {
        sync();
        arm();
      }, delay);
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return useMemo(
    () => ({
      theme: night ? ("night" as const) : ("day" as const),
      night,
      /** 是否处于手动切换状态（到下一个时段边界自动恢复） */
      manual,
      /** 亮 / 暗两档切换 */
      toggle: () => {
        const next = !night;
        writeOverride(next ? "night" : "day");
        setManual(true);
        setNight(next);
      },
    }),
    [night, manual],
  );
}

export type ThemeCtxValue = ReturnType<typeof useThemeState>;

export const ThemeCtx = createContext<ThemeCtxValue>({
  theme: "day",
  night: false,
  manual: false,
  toggle: () => {},
});

/** 组件内读取当前主题（是否夜间 / 是否手动 / 切换函数） */
export function useTheme() {
  return useContext(ThemeCtx);
}
