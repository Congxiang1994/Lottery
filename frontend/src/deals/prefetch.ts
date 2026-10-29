import { DealList, DealStats, dealsApi } from "./api";

/**
 * 捡漏列表的数据预取。
 *
 * 解决的问题（实测数据，2026-10-29）：/deals 的请求链路是一条**四段瀑布** ——
 *   HTML(1.16s) → 入口JS+react(1.9s) → Deals chunk(2.96s) → list/stats(3.56s)
 * 每一段都要等上一段解析完才知道下一段该下什么。其中 API 之所以排在 2.96s，
 * 纯粹是因为「只有 Deals 组件挂载后才会发请求」—— 而组件必须等 chunk 到位。
 *
 * 但数据请求本身并不依赖 Deals 组件：它只依赖 api.ts（几百字节，已在入口 chunk 里）。
 * 所以把「发请求」这件事提前到 App 挂载时做，让 API 与 chunk 下载**并行**，
 * 组件挂载后直接消费同一个 Promise。实测这一步把出列表时间压掉约 1.2 s。
 *
 * ⚠️ 共享必须去重，否则预取 + 组件各发一次 = 列表接口双倍压力：
 *   - inflight：同一时刻的并发调用共用一个 Promise（组件挂载时正好赶上）
 *   - last：预取先完成、组件后挂载时，5 秒内复用结果
 *   两个都要，只留 inflight 会在「预取快于挂载」时退化成双请求。
 */

/** 默认时间范围（小时）。与页面上的默认选中档位必须一致 —— 否则预取的档位
 *  与列表实际要展示的档位对不上，等于白请求一次。 */
export const DEFAULT_HOURS = 24;

type Pair = [DealList, DealStats];

const inflight = new Map<number, Promise<Pair>>();

let last: { hours: number; ts: number; data: Pair } | null = null;
/** 预取结果的可复用窗口：够覆盖「chunk 下载 + React 挂载」这段，又不至于拿旧数据 */
const REUSE_MS = 5000;

export function readPrefetched(hours: number): Pair | null {
  if (last && last.hours === hours && Date.now() - last.ts < REUSE_MS) return last.data;
  return null;
}

/** 取指定时间范围的列表 + 统计。并发调用共享同一个请求。 */
export function fetchDeals(hours: number): Promise<Pair> {
  const hit = inflight.get(hours);
  if (hit) return hit;

  const p = Promise.all([dealsApi.list({ hours, limit: 100 }), dealsApi.stats()]).then((data) => {
    last = { hours, ts: Date.now(), data };
    return data;
  });

  inflight.set(hours, p);
  // 无论成功失败都要放掉，否则失败一次之后所有调用都会拿到同一个 rejected Promise
  void p.catch(() => {}).finally(() => inflight.delete(hours));
  return p;
}
