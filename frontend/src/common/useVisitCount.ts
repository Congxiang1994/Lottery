/**
 * 站点访问统计上报（全站共享）。
 *
 * 口径：
 * - 人次（total）：每个浏览器会话（sessionStorage 去重）上报一次，
 *   刷新/切页不重复计数
 * - 人数（visitors）：首次访问生成持久 UUID 存 localStorage，此后
 *   每次上报都带上 —— 服务端按其哈希去重，同一设备只计一次
 *
 * 上报失败静默降级：读取任意已有计数展示，不影响页面。
 */
import { useEffect, useState } from "react";

const SESSION_KEY = "hanzi_visit_reported"; // 会话标记（历史命名保留）
const VISITOR_KEY = "lottery_visitor_id";

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
    const method = alreadyReported ? "GET" : "POST";
    const url = alreadyReported
      ? "/api/stats/visit"
      : `/api/stats/visit?visitor_id=${encodeURIComponent(getVisitorId())}`;

    fetch(url, { method })
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
