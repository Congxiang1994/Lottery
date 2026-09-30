/**
 * 自动化环境判定（全站共享）。
 *
 * ⚠️ 只用 `=== true` 而非 truthy 判断：**误判真人远比漏判自动化更糟** ——
 * 漏判只是数字偏大，误判会让真实用户永远不被计数。
 * 实测 puppeteer 下 `navigator.webdriver === true` 且 UA 含 `HeadlessChrome`。
 *
 * 使用方：
 * - `useVisitCount`（站点访问统计，Nav 上的「N 人来访」）
 * - `usePageTrack`（访问管理的页面埋点）
 *
 * ⚠️ 两处**必须**共用这一份实现。2026-09-30 清洗访问统计时，52 行「访客」里
 * 有 48 行是自己跑 puppeteer 验证脚本刷出来的 —— 同一个坑不能再踩第二次。
 */
export function isAutomated(): boolean {
  try {
    if (navigator.webdriver === true) return true;
    if (/HeadlessChrome/i.test(navigator.userAgent)) return true;
    return false;
  } catch {
    return false;
  }
}
