const BASE = "/api/v1";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`请求失败 ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  lotteries: () => get<LotteryInfo[]>("/lotteries"),
  summary: (k: string) => get<Summary>(`/${k}/summary`),
  latest: (k: string) => get<Draw>(`/${k}/latest`),
  stats: (k: string) => get<Stats>(`/${k}/stats`),
  history: (k: string, page: number, pageSize: number) =>
    get<{ lottery: string; page: number; page_size: number; total: number; draws: Draw[] }>(
      `/${k}/history?page=${page}&page_size=${pageSize}`
    ),
  predict: (k: string) => get<Predict>(`/${k}/predict`),
  // ---- 算法引擎
  algorithms: () => get<AlgoCatalog>("/algorithms"),
  runAlgo: (k: string, id: string) =>
    get<AlgoResult & { lottery: string; issue_base: string }>(`/${k}/algorithms/${id}`),
  runBatch: (k: string, maxCost: number, ids?: string) =>
    get<BatchAlgoResponse>(
      `/${k}/algorithms?max_cost=${maxCost}${ids ? `&ids=${ids}` : ""}`
    ),
  combined: (k: string, maxCost = 2) =>
    get<CombinedResult>(`/${k}/combined?max_cost=${maxCost}`),
  backtest: (k: string, folds = 5, maxCost = 1) =>
    get<BacktestResult>(`/${k}/backtest?folds=${folds}&max_cost=${maxCost}`),
  // ---- 定时入库结果（纯缓存展示，不触发实时计算）
  algoSummary: () => get<AlgoSummary[]>("/algo-summary"),
  savedLatest: (k: string) =>
    get<SavedAlgorithmsLatest>(`/${k}/saved-algorithms/latest`),
  savedCombined: (k: string) =>
    get<SavedCombined>(`/${k}/saved-combined`),
  // ---- 全量运行（与定时任务同一逻辑，结果落 sqlite；双色球+大乐透一起跑）
  verifyPassword: (password: string) =>
    fetch(`${BASE}/verify-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      if (!r.ok) {
        const detail = await r.json().then((d) => d.detail ?? "").catch(() => "");
        throw new Error(detail || `校验失败 ${r.status}`);
      }
      return r.json();
    }),
  runAll: (password: string) =>
    fetch(`${BASE}/run-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    }),
  runStatus: () => get<AllRunStatus>(`/run-status`),
};
