import { query, request, type Query, type RequestOptions } from "../common/http";
import type {
  AlgoCatalog,
  AlgoResult,
  AllRunStatus,
  BacktestResult,
  Draw,
  HistoryPredictions,
  LotteryInfo,
  SavedAlgorithmsLatest,
  SavedCombined,
  Stats,
  Summary,
} from "./types";

const BASE = "/api/v1";

/** 彩票站请求统一走全站 http 客户端（错误体/401/网络失败的处理见 common/http.ts）。 */
const get = <T>(path: string, params?: Query, opts?: RequestOptions): Promise<T> =>
  request<T>(BASE + path + (params ? query(params) : ""), opts);

export const api = {
  lotteries: () => get<LotteryInfo[]>("/lotteries"),
  summary: (k: string) => get<Summary>(`/${k}/summary`),
  stats: (k: string) => get<Stats>(`/${k}/stats`),
  history: (k: string, page: number, pageSize: number, signal?: AbortSignal) =>
    get<{ lottery: string; page: number; page_size: number; total: number; draws: Draw[] }>(
      `/${k}/history`,
      { page, page_size: pageSize },
      { signal },
    ),
  historyPredictions: (k: string, page: number, pageSize: number, signal?: AbortSignal) =>
    get<HistoryPredictions>(`/${k}/history-predictions`, { page, page_size: pageSize }, { signal }),
  // ---- 算法引擎
  algorithms: () => get<AlgoCatalog>("/algorithms"),
  runAlgo: (k: string, id: string) =>
    get<AlgoResult & { lottery: string; issue_base: string }>(`/${k}/algorithms/${id}`),
  backtest: (k: string, folds?: number, maxCost?: number) =>
    get<BacktestResult>(`/${k}/backtest`, {
      ...(folds !== undefined ? { folds } : {}),
      ...(maxCost !== undefined ? { max_cost: maxCost } : {}),
    }),
  // ---- 定时入库结果（纯缓存展示，不触发实时计算）
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
