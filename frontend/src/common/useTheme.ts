import { createContext, useContext, useEffect, useMemo, useState } from "react";

/**
 * 全局日/夜模式（整站统一，此前仅睡前故事页私有）。
 * - 持久化：localStorage "site_theme"（"night" = 夜间，其他 = 日间）
 * - 实现：<html> 挂/摘 ".site-night" class，样式见 index.css 的 .site-night 段
 * （CSS 覆盖映射方案，paper-* 高频类在暗色下重定义，组件无需逐个加 dark: 变体）
 * - index.html 头部内联脚本在渲染前同步挂 class，防刷新白屏闪烁
 */

type Theme = "day" | "night";
const KEY = "site_theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "day";
  return document.documentElement.classList.contains("site-night") ||
    localStorage.getItem(KEY) === "night"
    ? "night"
    : "day";
}

export function useThemeState() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    localStorage.setItem(KEY, theme);
    document.documentElement.classList.toggle("site-night", theme === "night");
  }, [theme]);

  return useMemo(
    () => ({ theme, night: theme === "night", toggle: () => setTheme((t) => (t === "night" ? "day" : "night")) }),
    [theme],
  );
}

export type ThemeCtxValue = ReturnType<typeof useThemeState>;

export const ThemeCtx = createContext<ThemeCtxValue>({
  theme: "day",
  night: false,
  toggle: () => {},
});

/** 组件内读取当前主题（是否夜间 + 切换函数） */
export function useTheme() {
  return useContext(ThemeCtx);
}
