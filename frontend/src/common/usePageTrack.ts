/**
 * 页面级访问埋点（访问管理专用）。
 *
 * 为什么必须由前端上报：SPA 所有路由都回退 `index.html`，
 * nginx 与后端中间件都**分不清「用户在哪个功能页」** —— 只有前端知道。
 * 所以访问管理的页面维度完全靠这里，中间件只负责接口维度（两者拼接成完整视图）。
 *
 * 挂在 `App` 组件里：路由一变就上报一次（keepalive 保证「点完立刻关页」也不丢）。
 * 自动化环境直接跳过 —— 否则每次验证脚本跑一遍，页面上就多出几十条假浏览记录。
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { isAutomated } from "./automation";
import { getVisitorId, syncVisitorCookie } from "./visitor";

/** 后端 `config.PAGE_FEATURES` 里登记的前端路由（非法路径后端会丢弃，这里提前省一次请求） */
const TRACKED_PREFIXES = [
  "/",
  "/lottery",
  "/history",
  "/predict",
  "/algorithms",
  "/hanzi",
  "/babysong",
  "/babysong-admin",
  "/story",
  "/story-admin",
  "/trigger",
  "/access",
];

function shouldTrack(pathname: string): boolean {
  if (pathname === "/") return true;
  return TRACKED_PREFIXES.some((p) => p !== "/" && pathname.startsWith(p));
}

export function usePageTrack(): void {
  const { pathname } = useLocation();

  // cookie 同步与路由无关，整站只需做一次
  useEffect(() => {
    syncVisitorCookie();
  }, []);

  useEffect(() => {
    if (isAutomated()) return;
    if (!shouldTrack(pathname)) return;
    const body = JSON.stringify({
      path: pathname,
      title: typeof document !== "undefined" ? document.title : "",
      referer: typeof document !== "undefined" ? document.referrer : "",
      visitor_id: getVisitorId(),
    });
    // keepalive：用户点开链接立刻关页时，请求仍会发出
    fetch("/api/access/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* 埋点失败静默：绝不能影响页面本身 */
    });
  }, [pathname]);
}
