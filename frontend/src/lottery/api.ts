import { query, request, type Query } from "../common/http";
import type {
  AlgoCatalog,
  AlgoResult,
  AlgoSummary,
  AllRunStatus,
  BacktestResult,
  BatchAlgoResponse,
  CombinedResult,
  Draw,
  HistoryPredictions,
  LotteryInfo,
  Predict,
  SavedAlgorithmsLatest,
  SavedCombined,
  Stats,
  Summary,
} from "./types";

const BASE = "/api/v1";

/** 彩票站请求统一走全站 http 客户端（错误体/401/网络失败的处理见 common/http.ts）。 */
const get = <T>(path: string, params?: Query): Promise<T> =>
  request<T>(BASE + path + (params ? query(params) : ""));

export const api = {
  lotteries: () => get<LotteryInfo[]>("/lotteries"),
  summary: (k: string) => get<Summary>(`/${k}/summary`),
  latest: (k: string) => get<Draw>(`/${k}/latest`),
  stats: (k: string) => get<Stats>(`/${k}/stats`),
  history: (k: string, page: number, pageSize: number) =>
    get<{ lottery: string; page: number; page_size: number; total: number; draws: Draw[] }>(
      `/${k}/history`,
      { page, page_size: pageSize },
    ),
  historyPredictions: (k: string, page: number, pageSize: number) =>
    get<HistoryPredictions>(`/${k}/history-predictions`, { page, page_size: pageSize }),
  predict: (k: string) => get<Predict>(`/${k}/predict`),
  // ---- 算法引擎
  algorithms: () => get<AlgoCatalog>("/algorithms"),
  runAlgo: (k: string, id: string) =>
    get<AlgoResult & { lottery: string; issue_base: string }>(`/${k}/algorithms/${id}`),
  runBatch: (k: string, maxCost: number, ids?: string) =>
    get<BatchAlgoResponse>(`/${k}/algorithms`, { max_cost: maxCost, ids }),
  combined: (k: string, maxCost = 2) =>
    get<CombinedResult>(`/${k}/combined`, { max_cost: maxCost }),
  backtest: (k: string, folds = 5, maxCost = 1) =>
    get<BacktestResult>(`/${k}/backtest`, { folds, max_cost: maxCost }),
  // ---- 定时入库结果（纯缓存展示，不触发实时计算）
  algoSummary: () => get<AlgoSummary[]>("/algo-summary"),
  savedLatest: (k: string) =>
    get<SavedAlgorithmsLatest>(`/${k}/saved-algorithms/latest`),
  savedCombined: (k: string) =>
    get<SavedCombined>(`/${k}/saved-combined`),
  // ---- 全量运行（与定时任务同一逻辑，结果落 sqlite；双色球+大乐透一起跑）
  // 密码由 run-all 端到端校验（后端带失败计数锁定流控），无需先单独校验。
  runAll: (password: string) =>
    request<{ started: boolean; message: string }>(`${BASE}/run-all`, {
      method: "POST",
      json: { password },
    }),
  runStatus: () => get<AllRunStatus>(`/run-status`),
};
