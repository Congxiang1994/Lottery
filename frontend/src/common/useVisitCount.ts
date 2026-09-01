/**
 * 站点访问计数上报（全站共享，仅上报一次/浏览器会话）。
 *
 * - sessionStorage 去重：同一会话内刷新/切页不重复计数
 * - 上报失败静默降级：读取任意已有计数展示，不影响页面
 */
import { useEffect, useState } from "react";

const KEY = "hanzi_visit_reported"; // 通用会话标记（历史命名保留）

export function useVisitCount(): number | null {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const alreadyReported = sessionStorage.getItem(KEY) === "1";
    const endpoint = alreadyReported
      ? ["GET", "/api/stats/visit"]
      : ["POST", "/api/stats/visit"];

    const [, url] = endpoint;
    fetch(url, { method: endpoint[0] })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled || typeof d.total !== "number") return;
        sessionStorage.setItem(KEY, "1");
        setTotal(d.total);
      })
      .catch(() => {
        /* 静默失败：不展示计数即可 */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return total;
}
