/**
 * 站点访问统计上报（全站共享）。
 *
 * 口径：
 * - 人次（total）：每个浏览器会话（sessionStorage 去重）上报一次，
 *   刷新/切页不重复计数
 * - 人数（visitors）：首次访问生成持久 UUID 存 localStorage，此后
 *   每次上报都带上 —— 服务端按其哈希去重，同一设备只计一次
 *
 * ⚠️ 自动化环境（puppeteer / headless Chrome）只读不写，见 isAutomated()：
 *   这类浏览器每次启动都是全新 profile，localStorage 为空 → 每次都生成新访客
 *   UUID → 服务端一律判为新访客。一天几十次自动化验证足以把「来访人数」刷高几十。
 *
 * 上报失败静默降级：读取任意已有计数展示，不影响页面。
 */
import { useEffect, useState } from "react";

const SESSION_KEY = "hanzi_visit_reported"; // 会话标记（历史命名保留）
const VISITOR_KEY = "lottery_visitor_id";

/**
 * 是否自动化环境（puppeteer / headless Chrome 等）。
 *
 * ⚠️ 只用 `=== true` 而非 truthy 判断：**误判真人远比漏判自动化更糟** ——
 * 漏判只是数字偏大，误判会让真实用户永远不被计数。
 * 实测 puppeteer 下 `navigator.webdriver === true` 且 UA 含 `HeadlessChrome`。
 */
function isAutomated(): boolean {
  try {
    if (navigator.webdriver === true) return true;
    if (/HeadlessChrome/i.test(navigator.userAgent)) return true;
    return false;
  } catch {
    return false;
  }
}

function getVisitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

export interface VisitStats {
  total: number | null; // 人次
  visitors: number | null; // 人数
}

export function useVisitCount(): VisitStats {
  const [stats, setStats] = useState<VisitStats>({ total: null, visitors: null });

  useEffect(() => {
    let cancelled = false;

    const alreadyReported = sessionStorage.getItem(SESSION_KEY) === "1";
    // 只读不写的两种情况：本会话已上报过，或身处自动化环境。
    // 后者故意仍走 GET —— 误判时只是「不计数」，数字照常展示，不会白屏。
    const shouldReport = !alreadyReported && !isAutomated();
    const url = shouldReport
      ? `/api/stats/visit?visitor_id=${encodeURIComponent(getVisitorId())}`
      : "/api/stats/visit";

    fetch(url, { method: shouldReport ? "POST" : "GET" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled || typeof d.total !== "number") return;
        sessionStorage.setItem(SESSION_KEY, "1");
        setStats({ total: d.total, visitors: d.visitors ?? null });
      })
      .catch(() => {
        /* 静默失败：不展示计数即可 */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}
