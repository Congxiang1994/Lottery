/**
 * 访问管理 /access —— 私有功能（密码保护）
 *
 * 记录「谁在什么时候、从哪个 IP / 地区、访问了哪些接口与功能」，四层视角：
 *   概览（趋势 / 分布 / 排行）· 明细（一行一请求）· IP 聚合 · 访客聚合 · 地区
 *
 * 数据来源是两个互补的采集点（见 docs/access-management-design.md §3 §6）：
 *   · 后端中间件 → 接口维度（含状态码 / 耗时 / 真实 IP / 地区）
 *   · 前端埋点   → 页面维度（SPA 路由，中间件分不清）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Download,
  Globe2,
  Inbox,
  KeyRound,
  LayoutDashboard,
  List,
  Loader2,
  LogOut,
  Network,
  RefreshCw,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { ExitPresence } from "../common/Modal";
import { ErrorBlock, errText } from "../common/State";
import { useModalHistory } from "../common/useModalHistory";
import { useTheme } from "../common/useTheme";
import {
  accessApi,
  IpRow,
  LogRow,
  Maintenance,
  Summary,
  VisitorRow,
} from "./api";
import {
  BarList,
  Card,
  Chip,
  FeatureDonut,
  fmtBytes,
  fmtNum,
  fmtTime,
  IpModal,
  KIND_LABEL,
  Kpi,
  MixBar,
  Pager,
  relTime,
  SearchInput,
  StatusBar,
  statusTone,
  TagBadge,
  TrendArea,
  UA_LABEL,
  VisitorModal,
} from "./parts";

type TabKey = "overview" | "logs" | "ips" | "visitors" | "geo" | "ops";

const TABS: { k: TabKey; label: string; icon: typeof List }[] = [
  { k: "overview", label: "概览", icon: LayoutDashboard },
  { k: "logs", label: "明细", icon: List },
  { k: "ips", label: "IP 聚合", icon: Network },
  { k: "visitors", label: "访客", icon: Users },
  { k: "geo", label: "地区", icon: Globe2 },
  { k: "ops", label: "维护", icon: Wrench },
];

const DAY_OPTIONS = [1, 7, 30, 90];

const FEATURE_OPTIONS: [string, string][] = [
  ["", "全部功能"],
  ["portal", "门户首页"],
  ["lottery", "彩票数据"],
  ["hanzi", "汉字课程"],
  ["babysong", "儿歌"],
  ["story", "睡前故事"],
  ["story-api", "故事开放 API"],
  ["trigger", "API 触发器"],
  ["stats", "访问统计"],
  ["probe", "探测 / 扫描"],
  ["other", "其他"],
];

const SELECT_CLS =
  "rounded-lg border border-paper-200 bg-white/60 px-2 py-1.5 text-xs text-paper-900 outline-none transition focus:border-brand-gold/50";

/* ============================== 页面 ============================== */

export default function Access() {
  const { night } = useTheme();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [days, setDays] = useState(7);
  const [includeAuto, setIncludeAuto] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [reloadKey, setReloadKey] = useState(0);
  const [ipOpen, setIpOpen] = useState<string | null>(null);
  const [visitorOpen, setVisitorOpen] = useState<string | null>(null);

  useEffect(() => {
    accessApi
      .session()
      .then(setAuthed)
      .catch(() => setAuthed(false));
  }, []);

  const ipModal = useModalHistory("accessIp", useCallback(() => setIpOpen(null), []));
  const visitorModal = useModalHistory("accessVisitor", useCallback(() => setVisitorOpen(null), []));

  const openIp = (ip: string) => {
    setIpOpen(ip);
    ipModal.push();
  };
  const closeIp = () => {
    setIpOpen(null);
    ipModal.pop();
  };
  const openVisitor = (v: string) => {
    setVisitorOpen(v);
    visitorModal.push();
  };
  const closeVisitor = () => {
    setVisitorOpen(null);
    visitorModal.pop();
  };

  const refresh = () => setReloadKey((k) => k + 1);
  const onUnauth = useCallback(() => setAuthed(false), []);

  if (authed === null) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <span className="flex items-center gap-2 text-sm text-paper-600">
          <Loader2 size={16} className="animate-spin" /> 正在确认会话…
        </span>
      </div>
    );
  }

  if (!authed) {
    return (
      <PasswordGate
        onPass={() => {
          setAuthed(true);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="pt-8 sm:pt-10">
      {/* 页头 */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-gold">
            Private Console
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            访问管理
            <span className="rounded-full border border-amber-600/25 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              私有
            </span>
          </h1>
          <p className="mt-1 text-xs text-paper-600">
            记录访客、接口与地区访问明细，支持按 IP / 访客聚合与图表分析。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100/70 p-1">
            {DAY_OPTIONS.map((d) => (
              <Chip key={d} active={days === d} onClick={() => setDays(d)}>
                {d === 1 ? "今天" : `${d} 天`}
              </Chip>
            ))}
          </div>
          <button
            type="button"
            onClick={refresh}
            title="刷新"
            className="press grid h-8 w-8 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:bg-paper-100"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={() =>
              accessApi.logout().finally(() => setAuthed(false))
            }
            title="退出"
            className="press grid h-8 w-8 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:bg-paper-100"
          >
            <LogOut size={14} />
          </button>
        </div>
      </header>

      {/* 自动化流量开关（默认隐藏，但明确告知隐藏了多少 —— 否则页面看着像坏了） */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-paper-600">
        <Chip
          active={includeAuto}
          onClick={() => setIncludeAuto((v) => !v)}
          title="curl / puppeteer / 爬虫等自动化流量默认隐藏，但始终记录"
        >
          {includeAuto ? "含自动化流量" : "仅真人流量"}
        </Chip>
        <span>自动化流量默认隐藏（脚本 / 爬虫 / 探测），始终记录、可一键显示。</span>
      </div>

      {/* Tab */}
      <nav className="mt-5 flex flex-wrap gap-1 border-b border-paper-200 pb-px">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            aria-current={tab === t.k}
            className={`press -mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-medium transition ${
              tab === t.k
                ? "border-brand-gold text-paper-900"
                : "border-transparent text-paper-600 hover:text-paper-900"
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </nav>

      <div key={`${tab}-${reloadKey}`} className="mt-5">
        {tab === "overview" && (
          <OverviewTab days={days} includeAuto={includeAuto} night={night} onUnauth={onUnauth} />
        )}
        {tab === "logs" && <LogsTab days={days} includeAuto={includeAuto} onOpenIp={openIp} onUnauth={onUnauth} />}
        {tab === "ips" && (
          <IpsTab days={days} includeAuto={includeAuto} onOpen={openIp} onUnauth={onUnauth} />
        )}
        {tab === "visitors" && (
          <VisitorsTab days={days} includeAuto={includeAuto} onOpen={openVisitor} onUnauth={onUnauth} />
        )}
        {tab === "geo" && <GeoTab days={days} includeAuto={includeAuto} onUnauth={onUnauth} />}
        {tab === "ops" && <OpsTab onUnauth={onUnauth} />}
      </div>

      <ExitPresence open={!!ipOpen}>
        {!!ipOpen && (
          <IpModal
            ip={ipOpen}
            days={Math.max(days, 30)}
            includeAuto={includeAuto}
            onClose={closeIp}
            onSaved={refresh}
          />
        )}
      </ExitPresence>
      <ExitPresence open={!!visitorOpen}>
        {!!visitorOpen && (
          <VisitorModal
            visitor={visitorOpen}
            days={Math.max(days, 30)}
            includeAuto={includeAuto}
            onClose={closeVisitor}
            onSaved={refresh}
          />
        )}
      </ExitPresence>
    </div>
  );
}

/* ============================== 密码门 ============================== */

function PasswordGate({ onPass }: { onPass: () => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = () => {
    if (!pwd || loading) return;
    setLoading(true);
    setErr(null);
    accessApi
      .auth(pwd)
      .then(() => {
        setPwd("");
        onPass();
      })
      .catch((e) => setErr(errText(e)))
      .finally(() => setLoading(false));
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center pt-10">
      <div className="glass w-full max-w-sm rounded-3xl p-7 shadow-card">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-brand-red/20 to-brand-gold/10 text-brand-red2">
            <KeyRound size={18} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-paper-900">访问管理</h1>
            <p className="text-xs text-paper-700">私有功能 · 验证后可查看全部访问记录</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-paper-700">
          记录每位访客的时间、IP、地区、客户端与访问过的接口 / 功能页，
          支持按 IP 与访客聚合、图表分析与 CSV 导出。
        </p>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="请输入操作密码"
          autoFocus
          className="mt-4 w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2.5 text-sm text-paper-900 outline-none focus:border-brand-gold/50"
        />
        {err && (
          <div className="mt-2 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {err}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={loading || !pwd}
          className="press mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" /> 校验中…
            </>
          ) : (
            "进入"
          )}
        </button>
      </div>
    </div>
  );
}

/* ============================== 概览 ============================== */

/**
 * 筛选条件变化 → 回到第 1 页，**在 render 阶段同步重置**。
 *
 * ⚠️ 不能写成 `useEffect(() => setPage(1), [filters])`。effect 要等本次渲染**提交
 * 之后**才跑，而 useLoad 也是个 effect，两者按声明顺序执行 ——
 * 于是先用「新筛选 + 旧页码」发一次请求，白跑一趟（翻到第 5 页再改筛选时尤其明显），
 * 列表还会先闪一帧第 5 页的结果。
 *
 * render 阶段同步改 state 是 React 官方支持的「随 props 调整 state」模式：
 * React 会立刻用新页码重渲染本次组件，那个中间态根本不会被提交，effect 也就
 * 只按第 1 页跑一次。
 *
 * @param key  把「会影响结果集的筛选条件」拼成一个字符串
 * @returns    可直接用于 offset 的页码（改动的这一帧就已经是 1）
 */
function useResetPageOn(key: string, page: number, setPage: (n: number) => void): number {
  const prev = useRef(key);
  if (prev.current !== key) {
    prev.current = key;
    setPage(1);
    return 1;
  }
  return page;
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[], onUnauth: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, [...deps, nonce]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    load()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        if ((e as { status?: number })?.status === 401) onUnauth();
        else setErr(errText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, onUnauth]);

  return { data, err, loading, retry: () => setNonce((n) => n + 1) };
}

function Initial({ loading, err, retry }: { loading: boolean; err: string; retry: () => void }) {
  if (err) return <ErrorBlock message={err} onRetry={retry} />;
  if (loading)
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-xs text-paper-600">
        <Loader2 size={14} className="animate-spin" /> 加载中…
      </p>
    );
  return null;
}

function Empty({ text = "这个时间窗内还没有记录" }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-paper-500">
      <Inbox size={22} />
      <p className="text-xs">{text}</p>
    </div>
  );
}

function OverviewTab({
  days,
  includeAuto,
  night,
  onUnauth,
}: {
  days: number;
  includeAuto: boolean;
  night: boolean;
  onUnauth: () => void;
}) {
  const [metric, setMetric] = useState<"requests" | "visitors" | "pages" | "ips">("requests");
  const [bucket, setBucket] = useState<"day" | "hour">("day");
  const [level, setLevel] = useState<"region" | "country">("region");

  const sum = useLoad(() => accessApi.summary(days, includeAuto), [days, includeAuto], onUnauth);
  const series = useLoad(
    () => accessApi.timeseries(days, bucket, metric, includeAuto),
    [days, bucket, metric, includeAuto],
    onUnauth,
  );
  const feats = useLoad(() => accessApi.features(days, includeAuto), [days, includeAuto], onUnauth);
  const tops = useLoad(() => accessApi.topPaths(days, 8, includeAuto), [days, includeAuto], onUnauth);
  const codes = useLoad(() => accessApi.statusCodes(days, includeAuto), [days, includeAuto], onUnauth);
  const geoRows = useLoad(() => accessApi.geo(days, level, includeAuto), [days, level, includeAuto], onUnauth);
  const ispRows = useLoad(() => accessApi.isp(days, includeAuto), [days, includeAuto], onUnauth);

  const s: Summary | null = sum.data;
  const w = s?.window;

  return (
    <div className="space-y-5">
      <Initial loading={sum.loading} err={sum.err} retry={sum.retry} />

      {/* 离线库没装时明确提示，别让人以为是「真没人来」 */}
      {s && !s.geo.v4_loaded && !s.geo.v6_loaded && (
        <div className="rounded-2xl border border-amber-600/25 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          离线 IP 库未加载 —— 地区字段会留空。在服务器执行
          <code className="mx-1 rounded bg-black/5 px-1 font-mono">
            cd /opt/lottery &amp;&amp; ./backend/.venv/bin/python tools/geo_update.py
          </code>
          下载后即恢复（不影响其他统计）。
        </div>
      )}

      {/* KPI（前 6 张是「近 N 天」窗口口径；第 7 张全站累计与左上角同源同数） */}
      {w && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <Kpi label={`近 ${days} 天请求`} value={fmtNum(w.requests)} sub={`今日 ${fmtNum(s?.today_stats.requests ?? 0)}`} />
          <Kpi label="独立 IP" value={fmtNum(w.ips)} sub={`今日 ${fmtNum(s?.today_stats.ips ?? 0)}`} />
          <Kpi
            label="独立访客"
            value={fmtNum(w.visitors)}
            sub={`近 ${days} 天去重 · 今日 ${fmtNum(s?.today_stats.visitors ?? 0)}`}
          />
          <Kpi label="页面浏览" value={fmtNum(w.pages)} sub={`今日 ${fmtNum(s?.today_stats.pages ?? 0)}`} />
          <Kpi
            label="错误率"
            value={`${w.error_rate}%`}
            tone={w.error_rate > 5 ? "danger" : w.error_rate > 1 ? "warn" : "normal"}
            sub={`${fmtNum(w.errors)} 次 4xx/5xx`}
          />
          <Kpi
            label="P95 耗时"
            value={s?.p95_ms != null ? `${s.p95_ms}ms` : "—"}
            sub={s?.p50_ms != null ? `P50 ${s.p50_ms}ms` : "无接口样本"}
          />
          <Kpi
            label="全站累计 · 同左上角"
            value={`${fmtNum(s?.site_totals?.visitors ?? 0)} 人`}
            sub={`累计 ${fmtNum(s?.site_totals?.total ?? 0)} 次访问`}
          />
        </div>
      )}

      {s && s.auto_hidden > 0 && !includeAuto && (
        <p className="text-[11px] text-paper-500">
          已隐藏 {fmtNum(s.auto_hidden)} 次自动化 / 脚本流量（含本机 curl、验证脚本与扫描器）。
        </p>
      )}

      {s && w && w.requests === 0 && <Empty />}

      {/* 趋势 */}
      <Card
        title="访问趋势"
        sub={bucket === "day" ? "按天" : "按小时（仅今日）"}
        action={
          <div className="flex items-center gap-1.5">
            <select value={bucket} onChange={(e) => setBucket(e.target.value as "day" | "hour")} className={SELECT_CLS}>
              <option value="day">按天</option>
              <option value="hour">按小时</option>
            </select>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as "requests" | "visitors" | "pages" | "ips")}
              className={SELECT_CLS}
            >
              <option value="requests">请求数</option>
              <option value="visitors">访客数</option>
              <option value="ips">IP 数</option>
              <option value="pages">页面浏览</option>
            </select>
          </div>
        }
      >
        {series.err ? (
          <ErrorBlock message={series.err} onRetry={series.retry} />
        ) : series.loading && !series.data ? (
          <div className="h-56" />
        ) : (
          <TrendArea
            items={series.data?.items ?? []}
            night={night}
            label={{ requests: "请求", visitors: "访客", ips: "IP", pages: "页面" }[metric]}
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="功能域分布" sub="按接口 / 页面归属统计">
          {feats.err ? (
            <ErrorBlock message={feats.err} onRetry={feats.retry} />
          ) : (
            <FeatureDonut
              items={(feats.data?.items ?? []).map((f) => ({ label: f.label, requests: f.requests }))}
              night={night}
            />
          )}
        </Card>

        <Card title="Top 接口" sub="按请求数排序">
          {tops.err ? (
            <ErrorBlock message={tops.err} onRetry={tops.retry} />
          ) : (
            <BarList
              items={(tops.data?.items ?? []).map((p) => ({
                name: p.path,
                value: p.requests,
                sub: p.avg_ms != null ? `${p.avg_ms}ms` : undefined,
                title: `${p.requests} 次 · 平均 ${p.avg_ms ?? "—"}ms · ${p.ips} 个 IP`,
              }))}
            />
          )}
        </Card>

        <Card title="响应状态" sub="2xx / 3xx / 4xx / 5xx 分布">
          {codes.err ? (
            <ErrorBlock message={codes.err} onRetry={codes.retry} />
          ) : (
            <StatusBar groups={codes.data?.groups ?? []} />
          )}
        </Card>

        <Card
          title="地区排行"
          sub="离线库解析（省 / 市 / 运营商）"
          action={
            <select value={level} onChange={(e) => setLevel(e.target.value as "region" | "country")} className={SELECT_CLS}>
              <option value="region">按省</option>
              <option value="country">按国家</option>
            </select>
          }
        >
          {geoRows.err ? (
            <ErrorBlock message={geoRows.err} onRetry={geoRows.retry} />
          ) : (
            <BarList
              items={(geoRows.data?.items ?? []).slice(0, 8).map((g) => ({
                name: g.name,
                value: g.requests,
                sub: `${g.ips} IP`,
              }))}
            />
          )}
        </Card>
      </div>

      <Card title="运营商 / 网络归属" sub="云厂商 IP 通常意味着爬虫或代理">
        {ispRows.err ? (
          <ErrorBlock message={ispRows.err} onRetry={ispRows.retry} />
        ) : (
          <BarList
            items={(ispRows.data?.items ?? []).slice(0, 8).map((x) => ({
              name: x.name,
              value: x.requests,
              sub: `${x.ips} IP`,
            }))}
          />
        )}
      </Card>
    </div>
  );
}

/* ============================== 明细 ============================== */

function LogsTab({
  days,
  includeAuto,
  onOpenIp,
  onUnauth,
}: {
  days: number;
  includeAuto: boolean;
  onOpenIp: (ip: string) => void;
  onUnauth: () => void;
}) {
  const [kind, setKind] = useState("");
  const [feature, setFeature] = useState("");
  const [status, setStatus] = useState("");
  const [path, setPath] = useState("");
  const [page, setPage] = useState(1);
  const size = 50;

  // 筛选 / 时间窗一变就回到第 1 页（同步重置，见 useResetPageOn 的 ⚠️）
  const curPage = useResetPageOn(
    `${days}|${includeAuto}|${kind}|${feature}|${status}|${path}`, page, setPage);

  const params = useMemo(
    () => ({
      days,
      kind,
      feature,
      status,
      path,
      include_auto: includeAuto ? 1 : 0,
      limit: size,
      offset: (curPage - 1) * size,
    }),
    [days, kind, feature, status, path, includeAuto, curPage],
  );

  const q = useLoad(() => accessApi.logs(params), [params], onUnauth);

  const th = "px-2.5 py-2 text-left text-[11px] font-semibold text-paper-600 whitespace-nowrap";
  const td = "px-2.5 py-1.5 text-[12px] whitespace-nowrap";

  return (
    <div className="space-y-4">
      {/* 筛选条 */}
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={SELECT_CLS}>
          <option value="">全部类型</option>
          <option value="api">接口</option>
          <option value="page">页面</option>
          <option value="probe">探测</option>
        </select>
        <select value={feature} onChange={(e) => setFeature(e.target.value)} className={SELECT_CLS}>
          {FEATURE_OPTIONS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT_CLS}>
          <option value="">全部状态</option>
          <option value="2xx">2xx 成功</option>
          <option value="3xx">3xx 跳转</option>
          <option value="4xx">4xx 客户端错误</option>
          <option value="5xx">5xx 服务端错误</option>
        </select>
        <div className="w-44">
          <SearchInput value={path} onChange={setPath} placeholder="按路径关键词筛选" />
        </div>
        <a
          href={accessApi.exportUrl(params)}
          className="press ml-auto inline-flex items-center gap-1.5 rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
        >
          <Download size={13} /> 导出 CSV
        </a>
      </div>

      {q.err ? (
        <ErrorBlock message={q.err} onRetry={q.retry} />
      ) : (
        <Card>
          {q.loading && !q.data ? (
            <Initial loading err="" retry={q.retry} />
          ) : !q.data?.items.length ? (
            <Empty />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-paper-200">
                    <th className={th}>时间</th>
                    <th className={th}>类型</th>
                    <th className={th}>功能</th>
                    <th className={th}>请求</th>
                    <th className={th}>状态</th>
                    <th className={th}>耗时</th>
                    <th className={th}>IP</th>
                    <th className={th}>地区</th>
                    <th className={th}>客户端</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((r) => (
                    <LogTr key={r.id} r={r} td={td} onOpenIp={onOpenIp} />
                  ))}
                </tbody>
              </table>
              <Pager page={page} pageSize={size} total={q.data.total} onChange={setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function LogTr({ r, td, onOpenIp }: { r: LogRow; td: string; onOpenIp: (ip: string) => void }) {
  const [open, setOpen] = useState(false);
  const long = (r.raw_path?.length ?? 0) > 34 || !!r.query;
  return (
    <>
      <tr className="border-b border-paper-100 align-top hover:bg-paper-100/60">
        <td className={`${td} tabular-nums text-paper-700`}>{relTime(r.ts)}</td>
        <td className={td}>
          <span className="rounded border border-paper-200 bg-paper-100 px-1.5 text-[10px] text-paper-700">
            {KIND_LABEL[r.kind] ?? r.kind}
          </span>
          {r.is_private ? (
            <span className="ml-1 rounded border border-amber-600/25 bg-amber-50 px-1.5 text-[10px] text-amber-700">
              私有
            </span>
          ) : null}
        </td>
        <td className={`${td} text-paper-800`}>{r.feature_label || "—"}</td>
        <td className={`${td} max-w-[280px]`}>
          <span className="font-mono text-[11px] text-paper-700">{r.method}</span>{" "}
          <span className="font-mono text-paper-900" title={`${r.raw_path}${r.query ? `?${r.query}` : ""}`}>
            {r.raw_path}
          </span>
          {long && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="ml-1.5 align-middle text-[10px] text-brand-gold underline decoration-dotted"
            >
              {open ? "收起" : "详情"}
            </button>
          )}
          {open && (
            <div className="mt-1 max-w-[360px] whitespace-pre-wrap rounded-lg border border-paper-200 bg-paper-100 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-paper-700">
              {r.query ? `?${r.query}\n` : ""}
              UA: {r.ua || "—"}
              {r.referer ? `\nReferer: ${r.referer}` : ""}
              {r.auth ? `\nCookie: ${r.auth}` : ""}
              {r.visitor_short ? `\n访客: ${r.visitor_short}…` : ""}
              {`\n字节: ${fmtBytes(r.resp_bytes)}`}
            </div>
          )}
        </td>
        <td className={td}>
          <span className={`rounded border px-1.5 text-[11px] tabular-nums ${statusTone(r.status)}`}>
            {r.status || "—"}
          </span>
        </td>
        <td className={`${td} tabular-nums text-paper-700`}>
          {r.latency_ms != null ? `${r.latency_ms}ms` : "—"}
        </td>
        <td className={td}>
          <button
            type="button"
            onClick={() => onOpenIp(r.ip)}
            className="press font-mono text-[11px] text-brand-red2 underline decoration-dotted"
            title="查看该 IP 的全部记录"
          >
            {r.ip || "—"}
          </button>
          {r.cloud ? (
            <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700" title="云厂商 / 机房 IP">
              云
            </span>
          ) : null}
          {r.hits > 1 ? (
            <span className="ml-1 rounded-full bg-paper-200 px-1.5 text-[10px] tabular-nums text-paper-700" title="同分钟聚合行">
              ×{r.hits}
            </span>
          ) : null}
        </td>
        <td className={`${td} text-paper-700`}>{r.region_label || "未解析"}</td>
        <td className={`${td} text-paper-600`}>{UA_LABEL[r.ua_class] ?? r.ua_class ?? "—"}</td>
        <td className={td} />
      </tr>
    </>
  );
}

/* ============================== IP 聚合 ============================== */

function IpsTab({
  days,
  includeAuto,
  onOpen,
  onUnauth,
}: {
  days: number;
  includeAuto: boolean;
  onOpen: (ip: string) => void;
  onUnauth: () => void;
}) {
  const [sort, setSort] = useState<"requests" | "last_seen">("requests");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const size = 30;

  const curPage = useResetPageOn(`${days}|${includeAuto}|${sort}|${q}`, page, setPage);

  const params = useMemo(
    () => ({ days, sort, q, limit: size, offset: (curPage - 1) * size, includeAuto }),
    [days, sort, q, curPage, includeAuto],
  );
  const data = useLoad(() => accessApi.ips(params), [params], onUnauth);

  const th = "px-2.5 py-2 text-left text-[11px] font-semibold text-paper-600 whitespace-nowrap";
  const td = "px-2.5 py-1.5 text-[12px] whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="w-56">
          <SearchInput value={q} onChange={setQ} placeholder="搜 IP / 地区 / 运营商" />
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === "requests" ? "last_seen" : "requests"))}
          className="press inline-flex items-center gap-1.5 rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
        >
          <ArrowUpDown size={13} /> {sort === "requests" ? "按请求数" : "按最近访问"}
        </button>
        <span className="text-[11px] text-paper-600">共 {fmtNum(data.data?.total ?? 0)} 个 IP</span>
      </div>

      {data.err ? (
        <ErrorBlock message={data.err} onRetry={data.retry} />
      ) : (
        <Card>
          {!data.data?.items.length ? (
            <Empty />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[880px] border-collapse">
                <thead>
                  <tr className="border-b border-paper-200">
                    <th className={th}>IP</th>
                    <th className={th}>地区</th>
                    <th className={th}>运营商</th>
                    <th className={th}>请求</th>
                    <th className={th}>页面</th>
                    <th className={th}>功能分布</th>
                    <th className={th}>首次</th>
                    <th className={th}>最近</th>
                    <th className={th}>客户端</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((r) => (
                    <IpTr key={r.ip} r={r} td={td} onOpen={onOpen} />
                  ))}
                </tbody>
              </table>
              <Pager page={page} pageSize={size} total={data.data.total} onChange={setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function IpTr({ r, td, onOpen }: { r: IpRow; td: string; onOpen: (ip: string) => void }) {
  return (
    <tr className="border-b border-paper-100 hover:bg-paper-100/60">
      <td className={td}>
        <button
          type="button"
          onClick={() => onOpen(r.ip)}
          className="press font-mono text-[11px] font-medium text-brand-red2 underline decoration-dotted"
          title="查看该 IP 的完整档案"
        >
          {r.ip}
        </button>
        <TagBadge tag={r.tag} />
        {r.cloud ? (
          <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700" title="云厂商 / 机房 IP">
            云
          </span>
        ) : null}
      </td>
      <td className={`${td} text-paper-800`}>{r.region_label || "未解析"}</td>
      <td className={`${td} text-paper-700`}>{r.isp || "—"}</td>
      <td className={`${td} tabular-nums font-semibold text-paper-900`}>{fmtNum(r.requests)}</td>
      <td className={`${td} tabular-nums text-paper-700`}>{fmtNum(r.pages)}</td>
      <td className={`${td} w-40`}>
        <MixBar mix={r.mix} />
        <div className="mt-1 truncate text-[10px] text-paper-500" title={r.mix.map((m) => `${m.label} ${m.n}`).join(" · ")}>
          {r.mix.length ? r.mix.map((m) => m.label).join(" · ") : "—"}
        </div>
      </td>
      <td className={`${td} tabular-nums text-paper-700`}>{relTime(r.first_seen)}</td>
      <td className={`${td} tabular-nums text-paper-700`}>{relTime(r.last_seen)}</td>
      <td className={`${td} text-paper-600`}>
        {UA_LABEL[r.ua_class ?? ""] ?? r.ua_class ?? "—"}
        {r.auto_hits ? (
          <span className="ml-1 rounded bg-paper-200 px-1 text-[10px] text-paper-600" title="自动化流量占比高">
            自动
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/* ============================== 访客 ============================== */

function VisitorsTab({
  days,
  includeAuto,
  onOpen,
  onUnauth,
}: {
  days: number;
  includeAuto: boolean;
  onOpen: (v: string) => void;
  onUnauth: () => void;
}) {
  const [sort, setSort] = useState<"requests" | "last_seen">("requests");
  const [page, setPage] = useState(1);
  const size = 30;
  const curPage = useResetPageOn(`${days}|${includeAuto}|${sort}`, page, setPage);
  const params = useMemo(
    () => ({ days, sort, limit: size, offset: (curPage - 1) * size, includeAuto }),
    [days, sort, curPage, includeAuto],
  );
  const data = useLoad(() => accessApi.visitors(params), [params], onUnauth);

  const th = "px-2.5 py-2 text-left text-[11px] font-semibold text-paper-600 whitespace-nowrap";
  const td = "px-2.5 py-1.5 text-[12px] whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <button
          type="button"
          onClick={() => setSort((s) => (s === "requests" ? "last_seen" : "requests"))}
          className="press inline-flex items-center gap-1.5 rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
        >
          <ArrowUpDown size={13} /> {sort === "requests" ? "按请求数" : "按最近访问"}
        </button>
        <p className="text-[11px] text-paper-600">
          一个人 = 一个浏览器（持久 UUID 加盐哈希）。移动网络出口 IP 会频繁漂移，所以这里按人归并，
          共 <span className="font-semibold text-paper-800">{fmtNum(data.data?.total ?? 0)}</span> 位访客。
        </p>
      </div>

      {data.err ? (
        <ErrorBlock message={data.err} onRetry={data.retry} />
      ) : (
        <Card>
          {!data.data?.items.length ? (
            <Empty text="还没有识别到访客（页面埋点需真人浏览器访问）" />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-b border-paper-200">
                    <th className={th}>访客</th>
                    <th className={th}>首次</th>
                    <th className={th}>最近</th>
                    <th className={th}>活跃天数</th>
                    <th className={th}>请求</th>
                    <th className={th}>IP 数</th>
                    <th className={th}>地区</th>
                    <th className={th}>功能分布</th>
                    <th className={th}>客户端</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((r) => (
                    <VisitorTr key={r.visitor} r={r} td={td} onOpen={onOpen} />
                  ))}
                </tbody>
              </table>
              <Pager page={page} pageSize={size} total={data.data.total} onChange={setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function VisitorTr({ r, td, onOpen }: { r: VisitorRow; td: string; onOpen: (v: string) => void }) {
  return (
    <tr className="border-b border-paper-100 hover:bg-paper-100/60">
      <td className={td}>
        <button
          type="button"
          onClick={() => onOpen(r.visitor)}
          className="press font-mono text-[11px] font-medium text-brand-red2 underline decoration-dotted"
          title={r.visitor}
        >
          {r.name || `#${r.short}`}
        </button>
      </td>
      <td className={`${td} tabular-nums text-paper-700`}>{relTime(r.first_seen)}</td>
      <td className={`${td} tabular-nums text-paper-700`}>{relTime(r.last_seen)}</td>
      <td className={`${td} tabular-nums text-paper-700`}>{r.active_days}</td>
      <td className={`${td} tabular-nums font-semibold text-paper-900`}>{fmtNum(r.requests)}</td>
      <td className={`${td} tabular-nums text-paper-700`}>{r.ip_count}</td>
      <td className={`${td} text-paper-800`}>{r.region_label || "未解析"}</td>
      <td className={`${td} w-40`}>
        <MixBar mix={r.mix} />
        <div className="mt-1 truncate text-[10px] text-paper-500">
          {r.mix.length ? r.mix.map((m) => m.label).join(" · ") : "—"}
        </div>
      </td>
      <td className={`${td} text-paper-600`}>{UA_LABEL[r.ua_class ?? ""] ?? r.ua_class ?? "—"}</td>
    </tr>
  );
}

/* ============================== 地区 ============================== */

function GeoTab({
  days,
  includeAuto,
  onUnauth,
}: {
  days: number;
  includeAuto: boolean;
  onUnauth: () => void;
}) {
  const [level, setLevel] = useState<"country" | "region" | "city">("region");
  const geoRows = useLoad(() => accessApi.geo(days, level, includeAuto), [days, level, includeAuto], onUnauth);
  const ispRows = useLoad(() => accessApi.isp(days, includeAuto), [days, includeAuto], onUnauth);

  const items = (geoRows.data?.items ?? []).filter((g) => !g.unknown);
  const unknown = (geoRows.data?.items ?? []).find((g) => g.unknown);

  return (
    <div className="space-y-5">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="flex items-center gap-1">
          {(["country", "region", "city"] as const).map((l) => (
            <Chip key={l} active={level === l} onClick={() => setLevel(l)}>
              {{ country: "国家", region: "省 / 直辖市", city: "城市" }[l]}
            </Chip>
          ))}
        </div>
        {unknown && (
          <span className="text-[11px] text-paper-600">
            另有 {fmtNum(unknown.requests)} 次请求未解析出地区
          </span>
        )}
      </div>

      {geoRows.err ? (
        <ErrorBlock message={geoRows.err} onRetry={geoRows.retry} />
      ) : !items.length ? (
        <Empty text="所选时间窗内没有可用的地区数据" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title={level === "country" ? "按国家 / 地区" : level === "region" ? "按省份" : "按城市"}
            sub="离线 IP 库解析，不联网、不外发访客 IP"
          >
            <BarList
              items={items.map((g) => ({
                name: g.name,
                value: g.requests,
                sub: `${g.ips} IP · ${g.visitors} 访客`,
              }))}
            />
          </Card>
          <Card title="运营商 / 网络归属">
            {ispRows.err ? (
              <ErrorBlock message={ispRows.err} onRetry={ispRows.retry} />
            ) : (
              <BarList
                items={(ispRows.data?.items ?? []).map((x) => ({
                  name: x.name,
                  value: x.requests,
                  sub: `${x.ips} IP`,
                }))}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================== 维护 ============================== */

function OpsTab({ onUnauth }: { onUnauth: () => void }) {
  const m = useLoad(() => accessApi.maintenance(), [], onUnauth);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const run = (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setMsg("");
    fn()
      .then(() => {
        setMsg(`${name} 完成`);
        m.retry();
      })
      .catch((e) => setMsg(errText(e)))
      .finally(() => setBusy(""));
  };

  const d: Maintenance | null = m.data;

  if (m.err) return <ErrorBlock message={m.err} onRetry={m.retry} />;
  if (!d) return <Initial loading err="" retry={m.retry} />;

  const keepBefore = (() => {
    const t = new Date(Date.now() - (d.keep_days - 1) * 86400000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  })();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="明细行数" value={fmtNum(d.rows)} sub={`累计 ${fmtNum(d.hits)} 次访问`} />
        <Kpi label="库大小" value={fmtBytes(d.db_bytes)} sub={d.db_path} />
        <Kpi
          label="地区解析覆盖率"
          value={`${d.geo_coverage}%`}
          tone={d.geo_coverage < 90 && d.geo_ips_total > 0 ? "warn" : "normal"}
          sub={
            d.geo_ips_total
              ? `${fmtNum(d.geo_ips_resolved)} / ${fmtNum(d.geo_ips_total)} 个公网 IP`
              : "暂无可解析的公网 IP"
          }
        />
        <Kpi
          label="写入队列"
          value={fmtNum(d.pending)}
          tone={d.queue_dropped > 0 ? "warn" : "normal"}
          sub={d.queue_dropped > 0 ? `已丢弃 ${d.queue_dropped} 行` : "无积压"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="离线 IP 库状态" sub="地区解析的唯一来源（ip2region xdb）">
          <ul className="space-y-2 text-[12px]">
            {(
              [
                ["IPv4 库", d.geo.v4_loaded, d.geo.v4_created_at, d.geo.v4_bytes],
                ["IPv6 库", d.geo.v6_loaded, d.geo.v6_created_at, d.geo.v6_bytes],
              ] as [string, boolean, string, number][]
            ).map(([name, ok, ver, bytes]) => (
              <li key={name} className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                <span className="text-paper-800">{name}</span>
                <span className="ml-auto tabular-nums text-paper-600">
                  {ok ? `${ver || "版本未知"} · ${fmtBytes(bytes)}` : "未加载"}
                </span>
              </li>
            ))}
          </ul>
          {d.geo.error && <p className="mt-2 text-[11px] text-rose-600">加载错误：{d.geo.error}</p>}
          {d.geo_ips_skipped > 0 && (
            <p className="mt-2 text-[11px] text-paper-600">
              另有 {fmtNum(d.geo_ips_skipped)} 个 IP 属内网 / 保留段 —— 按设计不查库，不计入覆盖率分母。
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-paper-600">
            更新：在服务器执行
            <code className="mx-1 rounded bg-black/5 px-1 font-mono">
              cd /opt/lottery &amp;&amp; ./backend/.venv/bin/python tools/geo_update.py
            </code>
            下载新库（原子替换，失败不影响在跑的进程），然后点右侧「回填历史记录」。
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run("回填", () => accessApi.backfill())}
            className="press mt-3 inline-flex items-center gap-1.5 rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100 disabled:opacity-40"
          >
            <RefreshCw size={13} /> {busy === "回填" ? "回填中…" : "回填历史记录"}
          </button>
        </Card>

        <Card title="数据分布" sub={`明细保留 ${d.keep_days} 天，IP / 访客档案永久保留`}>
          <div className="space-y-3">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-paper-700">按类型</div>
              <BarList
                items={d.kinds.map((k) => ({
                  name: KIND_LABEL[k.kind] ?? k.kind,
                  value: k.hits,
                  sub: `${k.rows} 行`,
                }))}
              />
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-paper-700">最近 14 天</div>
              <BarList
                items={d.recent_days
                  .slice()
                  .reverse()
                  .map((x) => ({ name: x.day.slice(5), value: x.rows }))}
              />
            </div>
            <p className="text-[11px] text-paper-600">
              已记录 {fmtNum(d.ip_profiles)} 个 IP 档案 · {fmtNum(d.visitor_profiles)} 个访客档案
            </p>
          </div>
        </Card>
      </div>

      <Card title="清理" sub="明细按天批量删除（不自动 VACUUM —— 会整库加锁）">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              if (confirm(`将删除 ${keepBefore} 之前的全部明细记录，确定继续？`)) {
                run("清理过期明细", () => accessApi.purge(keepBefore));
              }
            }}
            className="press inline-flex items-center gap-1.5 rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100 disabled:opacity-40"
          >
            {busy === "清理过期明细" ? "清理中…" : `清理 ${d.keep_days} 天前的明细`}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              if (confirm("将清空全部访问记录与档案（IP 属个人信息，用于彻底删除）。确定继续？")) {
                run("清空全部", () => accessApi.purgeAll());
              }
            }}
            className="press inline-flex items-center gap-1.5 rounded-lg border border-rose-600/25 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-600/10 disabled:opacity-40"
          >
            {busy === "清空全部" ? "清空中…" : "清空全部记录"}
          </button>
          {msg && <span className="text-[11px] text-paper-700">{msg}</span>}
        </div>
        <p className="mt-2 text-[11px] text-paper-600">
          时间范围：{fmtTime(d.first_ts)} — {fmtTime(d.last_ts) || "—"}
        </p>
      </Card>
    </div>
  );
}
