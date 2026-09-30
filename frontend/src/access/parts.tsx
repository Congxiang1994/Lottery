/**
 * 访问管理 · 共享原子（纯展示 / 纯函数）
 *
 * 图表用 recharts（已在依赖里），配色随日/夜切换；
 * 排行 / 分布 / 状态码用自绘 div 横条 —— 比再塞三个图表库更紧凑、更好读。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";

import { Modal } from "../common/Modal";
import { ErrorBlock, errText } from "../common/State";
import { useEscapeClose } from "../common/useEscapeClose";
import { accessApi, IpDetail, IpRow, LogRow, SeriesItem, VisitorDetail, VisitorRow } from "./api";

/* ------------------------------ 格式化 ------------------------------ */

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM:SS' */
export function fmtTime(ts: string): string {
  if (!ts || ts.length < 19) return ts || "—";
  return ts.slice(5);
}

const _p = (n: number) => String(n).padStart(2, "0");

/** 今天 / 昨天 / MM-DD（带时分） */
export function relTime(ts: string): string {
  if (!ts || ts.length < 16) return ts || "—";
  const d = ts.slice(0, 10);
  const hm = ts.slice(11, 16);
  const now = new Date();
  const today = `${now.getFullYear()}-${_p(now.getMonth() + 1)}-${_p(now.getDate())}`;
  const y = new Date(now.getTime() - 86400000);
  const yest = `${y.getFullYear()}-${_p(y.getMonth() + 1)}-${_p(y.getDate())}`;
  if (d === today) return `今天 ${hm}`;
  if (d === yest) return `昨天 ${hm}`;
  return ts.slice(5, 16);
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("zh-CN");
}

/* ------------------------------ 语义映射 ------------------------------ */

export const KIND_LABEL: Record<string, string> = { api: "接口", page: "页面", probe: "探测" };

export const UA_LABEL: Record<string, string> = {
  browser: "浏览器",
  mobile: "手机",
  bot: "爬虫",
  script: "脚本",
  probe: "探测",
  unknown: "未知",
};

export const TAG_LABEL: Record<string, string> = {
  me: "我自己",
  family: "家人",
  friend: "朋友",
  bot: "爬虫",
  scan: "扫描器",
  unknown: "未知",
};

/** 状态码徽章配色（2xx 绿 / 3xx 灰 / 4xx 琥珀 / 5xx 红） */
export function statusTone(s: number): string {
  if (s >= 500) return "border-rose-600/25 bg-rose-50 text-rose-700";
  if (s >= 400) return "border-amber-600/25 bg-amber-50 text-amber-700";
  if (s >= 300) return "border-paper-200 bg-paper-100 text-paper-700";
  if (s >= 200) return "border-emerald-600/25 bg-emerald-50 text-emerald-700";
  return "border-paper-200 bg-paper-100 text-paper-600";
}

/** 图表配色（随日/夜切换；夜间用提亮一档的暖色，避免在暖黑底上浑浊） */
export function chartTheme(night: boolean) {
  return {
    grid: night ? "#332a24" : "#efe6d7",
    /* ⚠️ 轴标签色本来日夜写的是**同一个值**（一眼就是复制粘贴漏改）。
       日间的 #8a7866 压暖黑只有 ~3.8:1，偏暗；夜间提亮一档。 */
    axis: night ? "#a6907c" : "#8a7866",
    line: night ? "#e8c37a" : "#c98600",
    fill: night ? "rgba(232,195,122,0.16)" : "rgba(201,134,0,0.14)",
    pie: night
      ? ["#e8c37a", "#7fb5f0", "#6fd0a8", "#eeb1c6", "#c3a2ea", "#e8a680", "#9c8a77"]
      : ["#c98600", "#3b82f6", "#10b981", "#d4537e", "#8b5cf6", "#f59e0b", "#a8a29e"],
    tip: {
      background: night ? "#221b17" : "#fffdf9",
      border: `1px solid ${night ? "#3a2f28" : "#e6dac6"}`,
      borderRadius: 12,
      fontSize: 12,
      color: night ? "#f2e9dc" : "#3d2b1f",
      padding: "6px 10px",
    },
  };
}

/* ------------------------------ 基础块 ------------------------------ */

export function Card({
  title,
  sub,
  action,
  children,
  className = "",
}: {
  title?: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-2xl p-4 shadow-card ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-bold text-paper-900">{title}</h3>}
            {sub && <p className="mt-0.5 text-[11px] leading-snug text-paper-600">{sub}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = "normal",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "normal" | "warn" | "danger";
}) {
  const vc =
    tone === "danger" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-paper-900";
  return (
    <div className="glass rounded-2xl p-3.5 shadow-card">
      <div className="text-[11px] font-medium text-paper-700">{label}</div>
      <div className={`mt-1 text-xl font-extrabold tabular-nums ${vc}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-paper-500">{sub}</div>}
    </div>
  );
}

/** 横向排行条（接口 / 地区 / 运营商通用） */
export function BarList({
  items,
  max: maxProp,
  empty = "暂无数据",
}: {
  items: { name: string; value: number; sub?: string; title?: string }[];
  max?: number;
  empty?: string;
}) {
  if (!items.length) return <p className="py-6 text-center text-xs text-paper-500">{empty}</p>;
  const max = Math.max(1, maxProp ?? Math.max(...items.map((i) => i.value)));
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={`${it.name}-${i}`} title={it.title}>
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="min-w-0 truncate text-paper-800">{it.name}</span>
            <span className="shrink-0 tabular-nums text-paper-700">
              {fmtNum(it.value)}
              {it.sub && <span className="ml-1.5 text-[10px] text-paper-500">{it.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-gold to-brand-red2"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 功能分布迷你条（IP / 访客列表里用） */
const MIX_TONES = [
  "bg-brand-red",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-brand-gold",
  "bg-violet-500",
  "bg-amber-500",
];

export function MixBar({ mix, className = "" }: { mix: { label: string; n: number }[]; className?: string }) {
  const total = mix.reduce((a, b) => a + b.n, 0) || 1;
  if (!mix.length) return <div className={`h-1.5 w-full rounded-full bg-paper-200 ${className}`} />;
  return (
    <div className={`flex h-1.5 w-full overflow-hidden rounded-full bg-paper-200 ${className}`}>
      {mix.map((m, i) => (
        <div
          key={`${m.label}-${i}`}
          className={MIX_TONES[i % MIX_TONES.length]}
          style={{ width: `${(m.n / total) * 100}%` }}
          title={`${m.label} ${m.n}`}
        />
      ))}
    </div>
  );
}

/** 状态码分组堆叠条 + 图例 */
const STATUS_TONES: Record<string, string> = {
  "2xx": "bg-emerald-500",
  "3xx": "bg-slate-400",
  "4xx": "bg-amber-500",
  "5xx": "bg-rose-500",
  其他: "bg-paper-400",
};

export function StatusBar({ groups }: { groups: { name: string; v: number }[] }) {
  const total = groups.reduce((a, b) => a + b.v, 0);
  if (!total) return <p className="py-6 text-center text-xs text-paper-500">暂无数据</p>;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper-200">
        {groups.map((g) => (
          <div
            key={g.name}
            className={STATUS_TONES[g.name] ?? "bg-paper-400"}
            style={{ width: `${(g.v / total) * 100}%` }}
            title={`${g.name} ${g.v}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {groups.map((g) => (
          <li key={g.name} className="flex items-center gap-2 text-[12px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_TONES[g.name] ?? "bg-paper-400"}`} />
            <span className="text-paper-800">{g.name}</span>
            <span className="ml-auto tabular-nums text-paper-700">{fmtNum(g.v)}</span>
            <span className="w-12 shrink-0 text-right text-[10px] text-paper-500">
              {((g.v / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ 图表 ------------------------------ */

export function TrendArea({
  items,
  night,
  color,
  label,
}: {
  items: SeriesItem[];
  night: boolean;
  color?: string;
  label: string;
}) {
  const t = chartTheme(night);
  const line = color ?? t.line;
  // X 轴标签：日桶 "2026-09-30" 与小时桶 "2026-09-30 10" **都是 slice(5)**
  // —— 去掉 "YYYY-" 前缀即得 "09-30" / "09-30 10"。
  // ⚠️ 别再按长度分派：日桶长度正好是 10，用 `length > 10 ? slice(5) : slice(11)`
  // 会让**每一个**日桶标签都切成空串，X 轴全空 → recharts 把 7 个点折叠成一个
  // 类目 → 曲线退化成一点（整张图只剩网格线，看着像坏了）。
  const data = items.map((x) => ({ ...x, short: x.k.slice(5) }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="accessTrend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line} stopOpacity={0.35} />
              <stop offset="100%" stopColor={line} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="short" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} width={46} allowDecimals={false} />
          <Tooltip
            contentStyle={t.tip}
            labelStyle={{ color: t.axis, fontSize: 11 }}
            formatter={(v: number) => [fmtNum(v), label]}
          />
          {/* 点少时补圆点：否则「只有一天有数据」这类稀疏序列只有孤零零一个拐点，看不出值 */}
          <Area
            type="monotone"
            dataKey="v"
            stroke={line}
            strokeWidth={2}
            fill="url(#accessTrend)"
            dot={data.length <= 14 ? { r: 2, fill: line, strokeWidth: 0 } : false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FeatureDonut({
  items,
  night,
}: {
  items: { label: string; requests: number }[];
  night: boolean;
}) {
  const t = chartTheme(night);
  const total = items.reduce((a, b) => a + b.requests, 0);
  if (!total) return <p className="py-10 text-center text-xs text-paper-500">暂无数据</p>;
  return (
    <div>
      <div className="relative h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="requests"
              nameKey="label"
              innerRadius={52}
              outerRadius={76}
              paddingAngle={2}
              stroke="none"
            >
              {items.map((_, i) => (
                <Cell key={i} fill={t.pie[i % t.pie.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={t.tip} formatter={(v: number) => [fmtNum(v), "请求"]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-lg font-extrabold tabular-nums text-paper-900">{fmtNum(total)}</div>
            <div className="text-[10px] text-paper-600">总请求</div>
          </div>
        </div>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: t.pie[i % t.pie.length] }}
            />
            <span className="min-w-0 truncate text-paper-800">{it.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-paper-600">{fmtNum(it.requests)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ 通用件 ------------------------------ */

export function Pager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const btn =
    "press inline-flex items-center gap-1 rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-100 disabled:opacity-30";
  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <span className="text-[11px] tabular-nums text-paper-600">
        共 {fmtNum(total)} 条 · 第 {page} / {pages} 页
      </span>
      <div className="flex items-center gap-1.5">
        <button className={btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={13} /> 上一页
        </button>
        <button className={btn} disabled={page >= pages} onClick={() => onChange(page + 1)}>
          下一页 <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  delay = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** 防抖时长（ms）。输入框每敲一个字都会触发筛选 → 请求，必须防抖。 */
  delay?: number;
}) {
  /* 本地镜像 + 防抖上抛。
     没有这层的话「搜 IP」每敲一个字符就发一次请求（后端还要全表 LIKE），
     并且每次都要回到第 1 页。 */
  const [text, setText] = useState(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // 外部改值（如重置筛选）时同步回输入框；自己触发的那次值相同，不会打断输入
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text === value) return; // 已同步，无需上抛
    const t = window.setTimeout(() => onChangeRef.current(text), delay);
    return () => window.clearTimeout(t);
  }, [text, value, delay]);

  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-500" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-paper-200 bg-white/60 py-1.5 pl-8 pr-2.5 text-xs text-paper-900 outline-none transition focus:border-brand-gold/50"
      />
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={`press shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? "border-brand-gold/60 bg-brand-gold/15 text-brand-gold"
          : "border-paper-200 bg-paper-100 text-paper-700 hover:border-paper-300"
      }`}
    >
      {children}
    </button>
  );
}

export function TagBadge({ tag }: { tag: string }) {
  if (!tag) return null;
  return (
    <span className="shrink-0 rounded-full border border-brand-gold/40 bg-brand-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-gold">
      {TAG_LABEL[tag] ?? tag}
    </span>
  );
}

/* ------------------------------ 详情弹窗 ------------------------------ */

/** 弹窗骨架：严格遵守站内「滚动分层」配方（见 index.css / refs §前端布局坑） */
function Panel({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEscapeClose(true, onClose);
  return (
    <Modal>
      <div
        className="anim-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-[#3d2b1f]/65 p-4 backdrop-blur-sm"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={`anim-panel glass my-6 flex max-h-[calc(100dvh-5rem)] w-full flex-col overflow-hidden rounded-3xl shadow-card ${
            wide ? "max-w-3xl" : "max-w-xl"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
            <div className="min-w-0">{title}</div>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              aria-label="关闭"
              className="press grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:bg-paper-100"
            >
              <X size={14} />
            </button>
          </div>
          {subtitle && <div className="shrink-0 px-5 pt-2">{subtitle}</div>}
          {/* 面板内唯一的滚动容器。⚠️ 必须 min-h-0 flex-auto，不能用 flex-1（会塌成 0 高） */}
          <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-paper-200 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

const PAGE_SIZE = 30;

/** 时间线（IP / 访客详情共用） */
function Timeline({ rows }: { rows: LogRow[] }) {
  if (!rows.length) return <p className="py-6 text-center text-xs text-paper-500">暂无记录</p>;
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] hover:bg-paper-100">
          <span className="w-24 shrink-0 tabular-nums text-paper-600">{relTime(r.ts)}</span>
          <span className="shrink-0 rounded border border-paper-200 bg-paper-100 px-1.5 text-[10px] text-paper-700">
            {KIND_LABEL[r.kind] ?? r.kind}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-paper-800" title={`${r.method} ${r.raw_path}${r.query ? `?${r.query}` : ""}`}>
            {r.raw_path}
          </span>
          <span className={`shrink-0 rounded border px-1.5 text-[10px] tabular-nums ${statusTone(r.status)}`}>
            {r.status || "—"}
          </span>
          {r.hits > 1 && (
            <span className="shrink-0 rounded-full bg-paper-200 px-1.5 text-[10px] tabular-nums text-paper-700">
              ×{r.hits}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-paper-200 bg-paper-100/60 px-3 py-2">
      <div className="text-[10px] text-paper-600">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-bold tabular-nums text-paper-900">{value}</div>
    </div>
  );
}

export function IpModal({
  ip,
  days,
  includeAuto,
  onClose,
  onSaved,
}: {
  ip: string;
  days: number;
  includeAuto: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<IpDetail | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    accessApi
      .ipDetail(ip, days, includeAuto, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .then((d) => {
        setData(d);
        setNote(d.note ?? "");
        setTag(d.tag ?? "");
      })
      .catch((e) => setErr(errText(e)))
      .finally(() => setLoading(false));
  }, [ip, days, includeAuto, page]);

  useEffect(load, [load]);

  const save = () => {
    setSaving(true);
    accessApi
      .updateIp(ip, { note, tag })
      .then(() => onSaved?.())
      .catch((e) => setErr(errText(e)))
      .finally(() => setSaving(false));
  };

  const field =
    "rounded-lg border border-paper-200 bg-white/60 px-2.5 py-1.5 text-xs text-paper-900 outline-none focus:border-brand-gold/50";

  return (
    <Panel
      wide
      title={
        <h3 className="truncate font-mono text-[15px] font-bold text-paper-900">{ip}</h3>
      }
      subtitle={
        data?.found ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-paper-700">
            <span>{data.region ?? ""}</span>
            {data.isp && <span className="text-paper-600">· {data.isp}</span>}
            {data.cloud ? (
              <span className="rounded-full border border-amber-600/25 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                云厂商 / 机房
              </span>
            ) : null}
            {data.auto_hits ? (
              <span className="rounded-full border border-paper-200 bg-paper-100 px-1.5 py-0.5 text-[10px] text-paper-600">
                自动化 {data.auto_hits} 次
              </span>
            ) : null}
          </div>
        ) : undefined
      }
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <select value={tag} onChange={(e) => setTag(e.target.value)} className={field}>
            <option value="">未标注</option>
            {Object.entries(TAG_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（如「我的 Mac」「公司」）"
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="press shrink-0 rounded-lg bg-gradient-to-br from-brand-gold to-brand-red px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存标注"}
          </button>
        </div>
      }
    >
      {loading && !data ? (
        <p className="flex items-center justify-center gap-2 py-12 text-xs text-paper-600">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </p>
      ) : err ? (
        <ErrorBlock message={err} onRetry={load} />
      ) : !data?.found ? (
        <p className="py-12 text-center text-xs text-paper-500">这个 IP 在所选时间窗内没有记录。</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="请求数" value={fmtNum(data.requests)} />
            <MiniStat label="页面浏览" value={fmtNum(data.pages)} />
            <MiniStat label="接口种类" value={fmtNum(data.path_count)} />
            <MiniStat label="关联访客" value={fmtNum(data.visitors)} />
            <MiniStat label="首次出现" value={relTime(data.profile_first_seen ?? "")} />
            <MiniStat label="最近活跃" value={relTime(data.last_seen ?? "")} />
            <MiniStat label="地区" value={data.region || "未解析"} />
            <MiniStat label="运营商" value={data.isp || "—"} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="功能分布">
              <BarList
                items={(data.features ?? []).map((f) => ({
                  name: f.label,
                  value: f.requests,
                  sub: `${f.paths} 个接口`,
                }))}
              />
            </Card>
            <Card title="接口 Top 10">
              <BarList
                items={(data.paths ?? []).slice(0, 10).map((p) => ({
                  name: p.path,
                  value: p.requests,
                  sub: p.avg_ms != null ? `${p.avg_ms}ms` : undefined,
                  title: `${p.requests} 次 · 平均 ${p.avg_ms ?? "—"}ms`,
                }))}
              />
            </Card>
          </div>

          <Card title="访问时间线" sub={`共 ${fmtNum(data.timeline_total)} 条`}>
            <Timeline rows={data.timeline ?? []} />
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              total={data.timeline_total ?? 0}
              onChange={setPage}
            />
          </Card>
        </div>
      )}
    </Panel>
  );
}

export function VisitorModal({
  visitor,
  days,
  includeAuto,
  onClose,
  onSaved,
}: {
  visitor: string;
  days: number;
  includeAuto: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<VisitorDetail | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    accessApi
      .visitorDetail(visitor, days, includeAuto, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .then((d) => {
        setData(d);
        setName(d.name ?? "");
      })
      .catch((e) => setErr(errText(e)))
      .finally(() => setLoading(false));
  }, [visitor, days, includeAuto, page]);

  useEffect(load, [load]);

  const save = () => {
    setSaving(true);
    accessApi
      .updateVisitor(visitor, { name })
      .then(() => onSaved?.())
      .catch((e) => setErr(errText(e)))
      .finally(() => setSaving(false));
  };

  const field =
    "rounded-lg border border-paper-200 bg-white/60 px-2.5 py-1.5 text-xs text-paper-900 outline-none focus:border-brand-gold/50";

  return (
    <Panel
      wide
      title={
        <h3 className="text-[15px] font-bold text-paper-900">
          {data?.name || `访客 ${visitor.slice(0, 8)}`}
        </h3>
      }
      subtitle={
        data?.found ? (
          <p className="font-mono text-[11px] text-paper-600">{visitor.slice(0, 16)}…（哈希，不可逆）</p>
        ) : undefined
      }
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="给这个访客起个名字（如「我」「家人A」）"
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="press shrink-0 rounded-lg bg-gradient-to-br from-brand-gold to-brand-red px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      }
    >
      {loading && !data ? (
        <p className="flex items-center justify-center gap-2 py-12 text-xs text-paper-600">
          <Loader2 size={14} className="animate-spin" /> 加载中…
        </p>
      ) : err ? (
        <ErrorBlock message={err} onRetry={load} />
      ) : !data?.found ? (
        <p className="py-12 text-center text-xs text-paper-500">该访客在所选时间窗内没有记录。</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="请求数" value={fmtNum(data.requests)} />
            <MiniStat label="页面浏览" value={fmtNum(data.pages)} />
            <MiniStat label="活跃天数" value={`${data.active_days} 天`} />
            <MiniStat label="使用 IP 数" value={fmtNum(data.ip_count)} />
            <MiniStat label="首次出现" value={relTime(data.first_seen ?? "")} />
            <MiniStat label="最近活跃" value={relTime(data.last_seen ?? "")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="用过的 IP" sub="移动网络会频繁换出口 IP —— 这正是需要按访客归并的原因">
              <ul className="space-y-2">
                {(data.ips ?? []).map((x) => (
                  <li key={x.ip} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-paper-800">{x.ip}</span>
                    <span className="min-w-0 max-w-[45%] truncate text-[11px] text-paper-600">
                      {x.region_label || "未解析"}
                    </span>
                    <span className="shrink-0 tabular-nums text-paper-700">{x.requests}</span>
                  </li>
                ))}
                {!(data.ips ?? []).length && (
                  <li className="py-4 text-center text-xs text-paper-500">无 IP 记录</li>
                )}
              </ul>
            </Card>
            <Card title="功能分布">
              <BarList items={(data.features ?? []).map((f) => ({ name: f.label, value: f.requests }))} />
            </Card>
          </div>

          <Card title="访问时间线" sub={`共 ${fmtNum(data.timeline_total)} 条`}>
            <Timeline rows={data.timeline ?? []} />
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              total={data.timeline_total ?? 0}
              onChange={setPage}
            />
          </Card>
        </div>
      )}
    </Panel>
  );
}

export type { IpRow, VisitorRow };
