export interface LotteryMeta {
  key: string;
  name: string;
  org: string;
  red_label: string;
  blue_label: string;
}

export interface Draw {
  issue: string;
  date: string;
  red: number[];
  blue: number[];
}

export interface Summary {
  lottery: string;
  name: string;
  org: string;
  total: number;
  latest: Draw;
  red_max: number;
  blue_max: number;
  red_count: number;
  blue_count: number;
  red_label: string;
  blue_label: string;
}

export interface FreqItem {
  number: number;
  count: number;
  pct: number;
}

export interface OmissionItem {
  number: number;
  omission: number;
}

export interface HotColdItem {
  number: number;
  count: number;
}

export interface HotCold {
  window: number;
  red: { hot: HotColdItem[]; cold: HotColdItem[] };
  blue: { hot: HotColdItem[]; cold: HotColdItem[] };
}

export interface Stats {
  summary: Summary;
  frequency: { red: FreqItem[]; blue: FreqItem[] };
  omission: { red: OmissionItem[]; blue: OmissionItem[] };
  hot_cold: HotCold;
  trend: Draw[];
}

export interface GuaResult {
  method: string;
  solar_date: string;
  lunar: string;
  time_zhi: number;
  ben_gua: string;
  bian_gua: string;
  dong_yao: number;
  red: number[];
  blue: number[];
}

export interface RecommendSet {
  red: number[];
  blue: number[];
  desc: string;
}

export interface Predict {
  lottery: string;
  name: string;
  generated_at: string;
  statistical: RecommendSet;
  gua: GuaResult | null;
  combined: RecommendSet;
  disclaimer: string;
}

/**
 * 彩种展示信息。
 *
 * 原先这里是 `interface LotteryInfo extends LotteryMeta {}` 空接口 —— 无新增字段，
 * 没有存在价值。但 `App.tsx`（他人所有权）仍 import 该名字，直接删除会破坏编译，
 * 故改为等价的类型别名：消除空接口的同时保持现有引用可用。
 */
export type LotteryInfo = LotteryMeta;

// ------------------------------------------------------------ 算法广场

export interface AlgoMeta {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  cost: number;
  speed: string;
}

export interface AlgoCategory {
  key: string;
  name: string;
  icon: string;
  desc: string;
  count: number;
  algorithms: AlgoMeta[];
}

export interface AlgoCatalog {
  total: number;
  categories: AlgoCategory[];
  disclaimer: string;
}

export interface AlgoResult {
  id: string;
  name: string;
  category: string;
  category_name: string;
  desc: string;
  tags: string[];
  cost: number;
  elapsed_ms: number;
  red: number[];
  blue: number[];
  red_scores: number[];
  blue_scores: number[];
  red_conf: number[];
  blue_conf: number[];
  detail: Record<string, unknown>;
}

export interface BatchAlgoResponse {
  lottery: string;
  issue_base: string;
  count: number;
  results: AlgoResult[];
}

export interface CombinedResult {
  lottery: string;
  issue_base: string;
  algorithms: string[];
  count: number;
  weighted: boolean;
  red: number[];
  blue: number[];
  red_conf: number[];
  blue_conf: number[];
  detail: Record<string, unknown>;
}

/** /saved-combined：基于每日跑批缓存的融合（非实时） */
export interface SavedCombined {
  lottery: string;
  run_date: string;
  issue_base: string;
  count: number;
  red: number[];
  blue: number[];
  red_conf: number[];
  blue_conf: number[];
  detail: Record<string, unknown>;
}

export interface BacktestAlgo {
  id: string;
  name: string;
  category: string;
  /** 分类显示名（后端 CATEGORIES 唯一真源，前端不要自己维护映射表） */
  category_name: string;
  folds: number;
  red_avg: number;
  blue_avg: number;
  red_expected: number;
  blue_expected: number;
  red_lift: number;
  blue_lift: number;
  /** lift 的 95% 置信区间；跨过 1.00 即与随机无差别 */
  red_ci: [number, number];
  blue_ci: [number, number];
  /** 单侧 p 值（H0：该算法无预测力） */
  red_p: number;
  blue_p: number;
  /** 经 Benjamini-Hochberg 多重比较校正后是否仍显著 */
  passes_fdr: boolean;
  score: number;
  elapsed_ms: number;
}

export interface BacktestResult {
  lottery: string;
  folds: number;
  issues: string[];
  red_expected_per_draw: number;
  blue_expected_per_draw: number;
  algos: BacktestAlgo[];
  /** 零假设基线：每折抽 null_tickets_per_fold 组真随机号码的 lift */
  null_red_lift: number;
  null_blue_lift: number;
  null_tickets_per_fold: number;
  /** 通过 FDR 校正的算法数；0 表示没有任何算法能与随机区分 */
  passes_fdr_count: number;
  note: string;
}

// ------------------------------------------------------------ 定时入库结果

export interface SavedAlgorithmsLatest {
  lottery: string;
  run_date: string;
  issue_base: string;
  count: number;
  results: AlgoResult[];
}

export interface AlgoSummary {
  lottery: string;
  run_date: string;
  issue_base: string;
  count: number;
}

export interface RunStatus {
  lottery: string;
  running: boolean;
  done: number;
  total: number;
  current: string;
  elapsed: number;
  eta: number;
  percent: number;
  /** 后端 runner 只产出 predict / backtest / done 三值（见 runner.py）。 */
  phase: "predict" | "backtest" | "done";
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** /run-status 全局合并状态（双色球 + 大乐透） */
export interface AllRunStatus {
  lotteries: Record<string, RunStatus>;
  running: boolean;
  done: number;
  total: number;
  percent: number;
  phase: string;
  current: string;
  current_lottery: string | null;
  elapsed: number;
  eta: number;
  finished: boolean;
  finished_at: string | null;
  error: string | null;
}

// ------------------------------------------------------------ 历史开奖 × 算法对照

/** 单列预测（共识列或单个算法列）：号码 + 命中数 + 奖级 */
export interface PredictionColumn {
  id?: string;
  name: string;
  category?: string;
  /** 分类显示名，由后端 CATEGORIES 下发（唯一真源）。共识列没有 category，故为可选。 */
  category_name?: string;
  red: number[];
  blue: number[];
  red_hit: number;
  blue_hit: number;
  prize: string | null;
}

/** 单期开奖的算法对照矩阵 */
export interface PredictionItem {
  issue: string;
  date: string;
  red: number[];
  blue: number[];
  run_date: string | null;
  predictions: {
    count: number;
    consensus: PredictionColumn;
    algos: PredictionColumn[];
  } | null;
}

/** /history-predictions 响应 */
export interface HistoryPredictions {
  lottery: string;
  page: number;
  page_size: number;
  total: number;
  items: PredictionItem[];
}
