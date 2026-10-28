import { useEffect, useMemo, useState } from "react";
import { Clock, Zap } from "lucide-react";
import CopyBtn from "./CopyBtn";

type Unit = "auto" | "s" | "ms";

const field =
  "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";
const numField =
  "w-full rounded-lg border border-paper-200 bg-white/60 px-1 py-2 text-center text-sm text-paper-900 outline-none focus:border-brand-gold/50";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** 当前本地时间，格式化为 datetime-local 需要的 YYYY-MM-DDTHH:mm:ss */
function nowLocalString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

/** 当前时间戳（毫秒）字符串 */
function nowMsString(): string {
  return String(Date.now());
}

/** 把已校验的数字时间戳换算成「毫秒」时间戳；自动识别秒(10位)/毫秒(13位)/微秒(16位) */
function toMs(n: number, chosen: Unit, len: number): number {
  if (len >= 16) return n / 1000; // 微秒 → 毫秒
  if (chosen !== "auto") return chosen === "s" ? n * 1000 : n;
  if (len === 10) return n * 1000;
  if (len === 13) return n;
  return n >= 1e12 ? n : n * 1000; // 兜底：13 位以上当毫秒
}

/** 时区偏移，例如 UTC+08:00 */
function tzOffset(d: Date): string {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? "+" : "-";
  return `UTC${sign}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}

/** 相对当前的时间差（中文） */
function relTime(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  const abs = Math.abs(diff);
  const parts: string[] = [];
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (mins) parts.push(`${mins} 分`);
  if (!parts.length || secs) parts.push(`${secs} 秒`);
  const txt = parts.slice(0, 2).join("");
  if (diff === 0) return "刚刚";
  return diff > 0 ? `${txt}前` : `${txt}后`;
}

/** 校验年/月/日/时/分/秒各分量是否合法且为该日期真实存在 */
function validDate(y: number, m: number, d: number, h: number, min: number, s: number): boolean {
  if (![y, m, d, h, min, s].every((v) => Number.isInteger(v))) return false;
  if (y < 0 || y > 9999) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31 || h < 0 || h > 23 || min < 0 || min > 59 || s < 0 || s > 59)
    return false;
  const t = new Date(y, m - 1, d, h, min, s);
  return (
    t.getFullYear() === y &&
    t.getMonth() === m - 1 &&
    t.getDate() === d &&
    t.getHours() === h &&
    t.getMinutes() === min &&
    t.getSeconds() === s
  );
}

/**
 * 灵活时间字符串解析，支持多种格式：
 * - ISO 8601：2026-10-28T13:18:09、2026-10-28T13:18:09+08:00、末尾 Z
 * - 常见分隔：2026-10-28 13:18:09、2026/10/28 13:18:09
 * - 纯日期：2026-10-28 / 2026/10/28（按 00:00:00）
 * - 纯时间：13:18:09 / 13:18（按今天日期）
 * - 中文：2026年10月28日 13时18分09秒、2026年10月28日
 * - 英文/其他：Oct 28, 2026 13:18:09（兜底走 JS 解析）
 * 带显式时区偏移按偏移解析；无偏移按本地时区解释。
 */
function parseFlexibleDate(input: string): { ms: number } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "" };

  // 提取显式时区偏移（Z 或 ±HH:MM / ±HHMM）
  let tz: number | null = null;
  let s = raw;
  const tzM = s.match(/([zZ])\s*$|\s*([+-])(\d{1,2}):?(\d{2})\s*$/);
  if (tzM) {
    if (tzM[1]) tz = 0;
    else tz = (tzM[2] === "-" ? -1 : 1) * (Number(tzM[3]) * 60 + Number(tzM[4]));
    s = s.slice(0, tzM.index).trim();
  }

  // 中文与分隔符归一化
  let n = s
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, " ")
    .replace(/[tT]/g, " ")
    .replace(/时/g, ":")
    .replace(/分/g, ":")
    .replace(/秒/g, "")
    .replace(/\./g, "-")
    .replace(/\s+/g, " ")
    .trim();

  let y = 0;
  let m = 0;
  let d = 0;
  let h = 0;
  let min = 0;
  let sec = 0;
  let matched = false;

  // YYYY-MM-DD [HH:MM[:SS]]
  let r = n.match(/^(\d{4})[-/ ](\d{1,2})[-/ ](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (r) {
    y = +r[1];
    m = +r[2];
    d = +r[3];
    h = +(r[4] || 0);
    min = +(r[5] || 0);
    sec = +(r[6] || 0);
    matched = true;
  } else {
    // MM/DD/YYYY [HH:MM[:SS]]
    r = n.match(/^(\d{1,2})[-/ ](\d{1,2})[-/ ](\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (r) {
      m = +r[1];
      d = +r[2];
      y = +r[3];
      h = +(r[4] || 0);
      min = +(r[5] || 0);
      sec = +(r[6] || 0);
      matched = true;
    }
  }
  if (!matched) {
    // 纯时间 HH:MM[:SS]（按今天日期）
    r = n.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (r) {
      const now = new Date();
      y = now.getFullYear();
      m = now.getMonth() + 1;
      d = now.getDate();
      h = +r[1];
      min = +r[2];
      sec = +(r[3] || 0);
      matched = true;
    }
  }

  if (matched) {
    if (!validDate(y, m, d, h, min, sec))
      return { error: "日期或时间分量超出合理范围（月份 1-12、小时 0-23、分钟/秒 0-59）" };
    const ms =
      tz !== null ? Date.UTC(y, m - 1, d, h, min, sec) - tz * 60000 : new Date(y, m - 1, d, h, min, sec).getTime();
    return { ms };
  }

  // 兜底：JS 原生解析（英文、标准 ISO 等）
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return { ms: parsed.getTime() };
  return {
    error:
      "无法识别该时间格式。示例：2026-10-28 13:18:09 / 2026/10/28 13:18 / 2026年10月28日 13时18分09秒 / 13:18:09",
  };
}

function OutputRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-paper-200 bg-white/50 px-3 py-2">
      <span className="w-20 shrink-0 text-[11px] font-medium text-paper-600">{label}</span>
      <span className="flex-1 break-all font-mono text-sm text-paper-900">{value}</span>
      <CopyBtn text={value} />
    </div>
  );
}

type Parts = { y: string; m: string; d: string; h: string; min: string; s: string };
const PART_FIELDS: { key: keyof Parts; label: string; max: number; ph: string }[] = [
  { key: "y", label: "年", max: 4, ph: "2026" },
  { key: "m", label: "月", max: 2, ph: "月" },
  { key: "d", label: "日", max: 2, ph: "日" },
  { key: "h", label: "时", max: 2, ph: "时" },
  { key: "min", label: "分", max: 2, ph: "分" },
  { key: "s", label: "秒", max: 2, ph: "秒" },
];

export default function TimestampTool() {
  const [unit, setUnit] = useState<Unit>("auto");
  const [ts, setTs] = useState("");
  const [text, setText] = useState("");
  const [parts, setParts] = useState<Parts>({ y: "", m: "", d: "", h: "", min: "", s: "" });

  const tzName = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区",
    [],
  );

  const tsResult = useMemo(() => {
    const raw = ts.trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) {
      return { error: "请输入纯数字时间戳（秒或毫秒，不支持负数/小数）" } as const;
    }
    const ms = toMs(Number(raw), unit, raw.length);
    if (!Number.isFinite(ms) || ms < 0 || ms > 8e15) {
      return { error: "时间戳数值超出合理范围" } as const;
    }
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return { error: "时间戳无法解析为有效日期" } as const;
    const detected: Unit =
      raw.length >= 16
        ? "ms"
        : raw.length === 10
          ? "s"
          : raw.length === 13
            ? "ms"
            : unit === "auto"
              ? ms >= 1e12
                ? "ms"
                : "s"
              : unit;
    return {
      error: null as null,
      detected,
      local: d.toLocaleString("zh-CN", {
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      utc: `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`,
      iso: d.toISOString(),
      rel: relTime(d),
      ms: String(ms),
      sec: String(Math.floor(ms / 1000)),
    } as const;
  }, [ts, unit]);

  const textResult = useMemo<{ ms: number } | { error: string } | null>(() => {
    if (!text.trim()) return null;
    return parseFlexibleDate(text);
  }, [text]);

  const partsResult = useMemo<{ ms: number } | { error: string } | null>(() => {
    const { y, m, d, h, min, s } = parts;
    if (!y && !m && !d && !h && !min && !s) return null;
    if (!y || !m || !d) return { error: "请至少填写年、月、日" };
    const yy = +y;
    const mm = +m;
    const dd = +d;
    const hh = +(h || 0);
    const mn = +(min || 0);
    const ss = +(s || 0);
    if (!validDate(yy, mm, dd, hh, mn, ss))
      return { error: "日期或时间分量超出合理范围（月份 1-12、小时 0-23、分钟/秒 0-59）" };
    return { ms: new Date(yy, mm - 1, dd, hh, mn, ss).getTime() };
  }, [parts]);

  // 文本框解析成功 → 同步进六格（六格成为可编辑的真值来源；文本框保留原始串）
  useEffect(() => {
    if (text.trim() && textResult && !("error" in textResult)) {
      const d = new Date(textResult.ms);
      setParts({
        y: String(d.getFullYear()),
        m: pad(d.getMonth() + 1),
        d: pad(d.getDate()),
        h: pad(d.getHours()),
        min: pad(d.getMinutes()),
        s: pad(d.getSeconds()),
      });
    }
  }, [text, textResult]);

  // 优先级：六格（年/月/日齐全）> 文本串 > 六格（未填全）
  const partsFilled = !!(parts.y && parts.m && parts.d);
  const dtActive: { ms: number } | { error: string } | null = partsFilled
    ? partsResult
    : text.trim()
      ? textResult
      : partsResult;
  const dtError = dtActive && "error" in dtActive ? dtActive.error : null;
  const dtOk =
    dtActive && !("error" in dtActive)
      ? { ms: String(dtActive.ms), sec: String(Math.floor(dtActive.ms / 1000)) }
      : null;

  const fillNow = () => {
    const d = new Date();
    setParts({
      y: String(d.getFullYear()),
      m: pad(d.getMonth() + 1),
      d: pad(d.getDate()),
      h: pad(d.getHours()),
      min: pad(d.getMinutes()),
      s: pad(d.getSeconds()),
    });
    setText("");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* 时间戳 → 时间 */}
      <section className="glass rounded-2xl p-5 shadow-card">
        <h3 className="flex items-center gap-2 text-base font-bold text-paper-900">
          <Clock size={16} className="text-[#0d9488]" /> 时间戳 → 时间
        </h3>
        <div className="mt-4 flex items-center gap-2">
          <input
            className={`${field} font-mono`}
            value={ts}
            inputMode="numeric"
            placeholder="输入数字时间戳，如 1761445800"
            onChange={(e) => setTs(e.target.value.replace(/[^\d]/g, ""))}
          />
          <button
            onClick={() => setTs(nowMsString())}
            title="填入当前时间戳"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-paper-200 bg-paper-100 text-paper-800 transition hover:bg-paper-200"
          >
            <Zap size={15} />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-paper-600">
          <span>单位：</span>
          {(["auto", "s", "ms"] as Unit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`rounded-lg px-2.5 py-1 transition ${
                unit === u ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
              }`}
            >
              {u === "auto" ? "自动" : u === "s" ? "秒" : "毫秒"}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {tsResult === null && (
            <p className="text-xs text-paper-500">输入时间戳后自动换算为本地、UTC 与 ISO 时间。</p>
          )}
          {"error" in (tsResult ?? {}) && tsResult?.error && (
            <div className="rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {tsResult.error}
            </div>
          )}
          {tsResult && !tsResult.error && (
            <>
              <OutputRow label="本地时间" value={tsResult.local} />
              <OutputRow label="UTC" value={tsResult.utc} />
              <OutputRow label="ISO 8601" value={tsResult.iso} />
              <OutputRow label="相对现在" value={tsResult.rel} />
              <OutputRow label="毫秒戳" value={tsResult.ms} />
              <OutputRow label="秒级戳" value={tsResult.sec} />
              <p className="text-[11px] text-paper-500">
                当前时区：{tzName}（{tzOffset(new Date())}） · 识别为{" "}
                {tsResult.detected === "s" ? "秒级" : "毫秒级"}
              </p>
            </>
          )}
        </div>
      </section>

      {/* 时间 → 时间戳 */}
      <section className="glass rounded-2xl p-5 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-paper-900">
            <Clock size={16} className="text-[#0d9488]" /> 时间 → 时间戳
          </h3>
          <button
            onClick={fillNow}
            title="填入当前时间"
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-800 transition hover:bg-paper-200"
          >
            <Zap size={14} /> 现在
          </button>
        </div>

        {/* 文本：粘贴 / 输入任意格式 */}
        <label className="mt-4 block text-xs text-paper-600">粘贴 / 输入时间字符串（自动识别格式）</label>
        <input
          className={`${field} mt-1 font-mono`}
          value={text}
          placeholder="如 2026-10-28 13:18:09 / 2026年10月28日 13时18分09秒"
          onChange={(e) => setText(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-paper-500">
          支持 ISO 8601、<span className="font-mono">/</span> 与 <span className="font-mono">-</span> 分隔、纯日期、纯时间、中文年月日时分秒、带时区偏移；无偏移按本地时区解析。
        </p>

        {/* 六格：逐项手动输入 */}
        <div className="mt-4">
          <div className="text-xs text-paper-600">或逐项填写（可直接键入数字）</div>
          <div className="mt-1 grid grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-6">
            {PART_FIELDS.map((f) => (
              <div key={f.key}>
                <div className="mb-1 text-center text-[11px] text-paper-500">{f.label}</div>
                <input
                  className={numField}
                  value={parts[f.key]}
                  inputMode="numeric"
                  maxLength={f.max}
                  placeholder={f.ph}
                  onChange={(e) =>
                    setParts((p) => ({ ...p, [f.key]: e.target.value.replace(/[^\d]/g, "") }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {!dtActive && (
            <p className="text-xs text-paper-500">粘贴字符串或填写年月日时分秒后，自动换算为秒/毫秒时间戳。</p>
          )}
          {dtError && (
            <div className="rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {dtError}
            </div>
          )}
          {dtOk && (
            <>
              <OutputRow label="毫秒戳" value={dtOk.ms} />
              <OutputRow label="秒级戳" value={dtOk.sec} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
