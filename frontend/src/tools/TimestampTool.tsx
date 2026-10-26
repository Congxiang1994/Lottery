import { useMemo, useState } from "react";
import { Clock, Zap } from "lucide-react";
import CopyBtn from "./CopyBtn";

type Unit = "auto" | "s" | "ms";

const field =
  "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";

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

export default function TimestampTool() {
  const [unit, setUnit] = useState<Unit>("auto");
  const [ts, setTs] = useState("");
  const [dt, setDt] = useState("");

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
    const detected: Unit = raw.length >= 16 ? "ms" : raw.length === 10 ? "s" : raw.length === 13 ? "ms" : unit === "auto" ? (ms >= 1e12 ? "ms" : "s") : unit;
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

  const dtResult = useMemo(() => {
    if (!dt) return null;
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return { error: "日期时间格式无效" } as const;
    return { error: null as null, ms: String(d.getTime()), sec: String(Math.floor(d.getTime() / 1000)) } as const;
  }, [dt]);

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
        <h3 className="flex items-center gap-2 text-base font-bold text-paper-900">
          <Clock size={16} className="text-[#0d9488]" /> 时间 → 时间戳
        </h3>
        <div className="mt-4 flex items-center gap-2">
          <input
            type="datetime-local"
            step="1"
            className={`${field} font-mono`}
            value={dt}
            onChange={(e) => setDt(e.target.value)}
          />
          <button
            onClick={() => setDt(nowLocalString())}
            title="填入当前时间"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-paper-200 bg-paper-100 text-paper-800 transition hover:bg-paper-200"
          >
            <Zap size={15} />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-paper-500">
          按浏览器本地时区（{tzName}）解析；输入即换算，无需额外操作。
        </p>

        <div className="mt-4 space-y-2">
          {dtResult === null && <p className="text-xs text-paper-500">选择或填写时间后自动换算为秒/毫秒时间戳。</p>}
          {"error" in (dtResult ?? {}) && dtResult?.error && (
            <div className="rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {dtResult.error}
            </div>
          )}
          {dtResult && !dtResult.error && (
            <>
              <OutputRow label="毫秒戳" value={dtResult.ms} />
              <OutputRow label="秒级戳" value={dtResult.sec} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
