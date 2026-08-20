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

export interface LotteryInfo extends LotteryMeta {}

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
  folds: number;
  red_avg: number;
  blue_avg: number;
  red_expected: number;
  blue_expected: number;
  red_lift: number;
  blue_lift: number;
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
  phase: "predict" | "backtest" | "done" | string;
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
