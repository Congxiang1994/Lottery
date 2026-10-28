import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  Save,
  ShieldOff,
  Trash2,
} from "lucide-react";
import {
  DealConfig,
  DealSettings,
  DealStatus,
  dealsApi,
} from "./api";
import { ErrorBlock, errText } from "../common/State";

/**
 * 什么值得买 · 捡漏管理 /deals-admin（私有）
 *
 * 三块配置，按「改完立刻能看到效果」排序：
 *   1. 阈值 —— 保存即重算全库，公开页马上变
 *   2. 登录 Cookie —— 决定会不会被风控掐死
 *   3. 关注分类 —— 决定抓取量（也是唯一能显著降请求的旋钮）
 *
 * 不填账号密码：SMZDM 登录有滑块，脚本密码登录走不通；
 * 让用户粘 `Copy as cURL`，是唯一能拿到 httpOnly `sess` 的省事办法。
 */

const inputCls =
  "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";

/* ---------------- 密码门 ---------------- */

function PasswordGate({ onPass }: { onPass: () => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = () => {
    if (!pwd || loading) return;
    setLoading(true);
    setErr(null);
    dealsApi
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
            <h1 className="text-lg font-bold text-paper-900">捡漏设置</h1>
            <p className="text-xs text-paper-700">私有功能 · 验证后可改阈值</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-paper-700">
          调整入选阈值、配置登录 Cookie、查看抓取健康度。
        </p>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="请输入操作密码"
          autoFocus
          className={`mt-4 ${inputCls}`}
        />
        {err && (
          <div className="mt-2 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {err}
          </div>
        )}
        <button
          onClick={submit}
          disabled={loading || !pwd}
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2.5 text-sm font-semibold text-white shadow-glow press transition hover:opacity-90 disabled:opacity-40"
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

/* ---------------- 小组件 ---------------- */

function Section({
  title,
  desc,
  right,
  children,
}: {
  title: string;
  desc?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-paper-100 glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-paper-900">{title}</h2>
          {desc && <p className="mt-1 text-[11px] leading-relaxed text-paper-600">{desc}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function NumField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-paper-800">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${inputCls} tabular-nums`}
      />
      <span className="mt-1 block text-[10px] leading-snug text-paper-500">{hint}</span>
    </label>
  );
}

/* ---------------- 主面板 ---------------- */

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  const [status, setStatus] = useState<DealStatus | null>(null);
  const [config, setConfig] = useState<DealConfig | null>(null);
  const [form, setForm] = useState<DealSettings | null>(null);
  const [cookieDraft, setCookieDraft] = useState("");
  const [cateDraft, setCateDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const timers = useRef<number[]>([]);

  const flash = (text: string) => {
    setMsg(text);
    const t = window.setTimeout(() => setMsg(null), 4000);
    timers.current.push(t);
  };

  const refresh = useCallback(async () => {
    try {
      const [st, cfg] = await Promise.all([dealsApi.status(), dealsApi.config()]);
      setStatus(st);
      setConfig(cfg);
      setForm((prev) => prev ?? cfg.settings);
      // 分类输入框必须以库里为准回填。之前这里是读 form.cate_filter，
      // 但 form 在本次 render 里还是 null（setForm 是异步的），
      // 结果输入框恒为空 → 分类 chips 永远不高亮，用户以为没保存上。
      setCateDraft(cfg.settings.cate_filter ?? "");
      setErr(null);
      return st;
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) onLogout();
      else setErr(errText(e));
      return null;
    }
  }, [onLogout]);

  useEffect(() => {
    void refresh();
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, [refresh]);

  const set = (patch: Partial<DealSettings>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const saveThresholds = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const res = await dealsApi.saveConfig({
        worth_pct_min: form.worth_pct_min,
        worth_min: form.worth_min,
        fav_min: form.fav_min,
        cmt_min: form.cmt_min,
        need_hits: form.need_hits,
        pages_per_round: form.pages_per_round,
        enabled: form.enabled,
      });
      flash(`已保存，全库重算后共 ${res.picked ?? 0} 条入选`);
      const st = await refresh();
      if (st) {
        // 用后端规范化后的值回填（如 "85.0" → "85"），避免输入框和实际生效值不一致
        const cfg = await dealsApi.config();
        setForm((f) => (f ? { ...f, ...cfg.settings } : cfg.settings));
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCookie = async () => {
    if (!cookieDraft.trim()) return;
    setBusy(true);
    try {
      await dealsApi.saveConfig({ cookie: cookieDraft.trim() });
      setCookieDraft("");
      flash("Cookie 已保存");
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCate = async (value: string) => {
    setBusy(true);
    try {
      await dealsApi.saveConfig({ cate_filter: value });
      setForm((f) => (f ? { ...f, cate_filter: value } : f));
      setCateDraft(value);
      flash(value ? `已限定分类：${value}` : "已改为抓取全部品类");
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const fetchNow = async () => {
    setBusy(true);
    try {
      const r = await dealsApi.fetchNow();
      flash(r.message || "已开始抓取");
      // 抓取是异步的：分几次回查，让用户当场看到结果而不是自己刷
      [4000, 9000, 16000].forEach((ms) => {
        timers.current.push(window.setTimeout(() => void refresh(), ms));
      });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const unban = async () => {
    setBusy(true);
    try {
      await dealsApi.unban();
      flash("已解除退避，下一轮会正常抓取");
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!config || !form || !status) {
    return (
      <div className="pt-8">
        {err ? (
          <ErrorBlock message={err} onRetry={() => void refresh()} />
        ) : (
          <div className="h-40 animate-pulse rounded-2xl border border-paper-100 bg-paper-100/50" />
        )}
      </div>
    );
  }

  const s = status.scheduler;
  const cates = status.cates;

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-paper-900">捡漏设置</h1>
          <p className="mt-1 text-xs text-paper-600">
            每 {config.constants.interval_minutes} 分钟抓一轮，每轮 {form.pages_per_round} 页
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchNow()}
            disabled={busy}
            className="press inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-3.5 py-2 text-xs font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
          >
            <Play size={13} /> 立即抓取
          </button>
          <button
            onClick={() => void refresh()}
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 text-paper-700 transition hover:bg-paper-100"
            title="刷新状态"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={onLogout}
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 text-paper-700 transition hover:border-rose-300 hover:text-rose-600"
            title="退出"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {msg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <Check size={13} /> {msg}
        </div>
      )}
      {err && <ErrorBlock message={err} onRetry={() => void refresh()} />}
      {s.banned && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">
            被反爬退避中，剩余 {Math.ceil(s.ban_remaining_seconds / 60)} 分钟。
            {s.last_error || "可在换 IP / 过完验证码后手动解除。"}
          </span>
          <button
            onClick={() => void unban()}
            className="press inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-600/30 px-2 py-1 text-[11px] font-medium hover:bg-amber-600/10"
          >
            <ShieldOff size={11} /> 解除
          </button>
        </div>
      )}

      {/* 运行状态 */}
      <Section
        title="运行状态"
        desc={`调度循环 ${s.alive ? "存活" : "已停止"}${
          s.last_round ? ` · 最近一轮 ${s.last_round}` : " · 尚未抓过"
        }`}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: "今日抓取", v: status.stats.today_added },
            { k: "今日入选", v: status.stats.today_picked },
            { k: "累计抓取", v: status.stats.total },
            { k: "累计入选", v: status.stats.picked_total },
          ].map((x) => (
            <div key={x.k} className="rounded-xl bg-paper-100/70 px-3 py-2">
              <div className="text-[10px] text-paper-600">{x.k}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-paper-900">{x.v}</div>
            </div>
          ))}
        </div>

        {status.rounds.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-paper-100">
            <table className="w-full text-[11px]">
              <thead className="bg-paper-100/70 text-paper-600">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium">时间</th>
                  <th className="px-2 py-1.5 text-right font-medium">解析</th>
                  <th className="px-2 py-1.5 text-right font-medium">新增</th>
                  <th className="px-2 py-1.5 text-right font-medium">入选</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {status.rounds.slice(0, 6).map((r) => (
                  <tr key={r.ts + r.parsed} className="border-t border-paper-100">
                    <td className="px-2.5 py-1.5 tabular-nums text-paper-700">{r.ts.slice(5)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.parsed}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.added}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-brand-red2">
                      {r.picked}
                    </td>
                    <td className="max-w-[220px] truncate px-2.5 py-1.5 text-paper-500" title={r.errors}>
                      {r.banned ? "被风控" : r.errors || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 阈值 */}
      <Section
        title="入选阈值"
        desc="判定式：值率达标，且 值 / 收藏 / 评论 三项中满足指定项数。保存后立即重算全库。"
        right={
          <button
            onClick={() => void saveThresholds()}
            disabled={busy}
            className="press inline-flex items-center gap-1.5 rounded-xl bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <Save size={12} /> 保存
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumField
            label="值率下限（%）"
            hint="真人投票结果，最硬的信号"
            value={form.worth_pct_min}
            onChange={(v) => set({ worth_pct_min: v })}
            min={0}
            max={100}
          />
          <NumField
            label="值数下限"
            hint="认为「值」的人次"
            value={form.worth_min}
            onChange={(v) => set({ worth_min: v })}
            min={0}
            max={100000}
          />
          <NumField
            label="收藏数下限"
            hint="收藏比点赞更接近「要买」"
            value={form.fav_min}
            onChange={(v) => set({ fav_min: v })}
            min={0}
            max={100000}
          />
          <NumField
            label="评论数下限"
            hint="讨论热度（注意争议品也高）"
            value={form.cmt_min}
            onChange={(v) => set({ cmt_min: v })}
            min={0}
            max={100000}
          />
          <NumField
            label="需命中项数"
            hint="三项里至少满足几项（1~3）"
            value={form.need_hits}
            onChange={(v) => set({ need_hits: v })}
            min={1}
            max={3}
          />
          <NumField
            label="每轮抓几页"
            hint="页数越多覆盖越全，请求也越多"
            value={form.pages_per_round}
            onChange={(v) => set({ pages_per_round: v })}
            min={1}
            max={5}
          />
        </div>
      </Section>

      {/* Cookie */}
      <Section
        title="登录 Cookie"
        desc={
          config.cookie_set
            ? `已配置：${config.cookie_masked}`
            : "未配置 —— 裸爬会被风控拦下，配一个能显著降低被拦概率"
        }
        right={
          <button
            onClick={() => setShowGuide((v) => !v)}
            className="rounded-lg border border-paper-200 px-2.5 py-1 text-[11px] text-paper-700 transition hover:bg-paper-100"
          >
            {showGuide ? "收起步骤" : "怎么获取？"}
          </button>
        }
      >
        {showGuide && (
          <ol className="mb-3 space-y-1.5 rounded-xl bg-paper-100/70 px-3 py-2.5 text-[11px] leading-relaxed text-paper-700">
            <li>
              <b>1.</b> 浏览器打开 <span className="font-mono">smzdm.com</span>，确认已登录
            </li>
            <li>
              <b>2.</b> 按 <span className="font-mono">F12</span> → Network 标签 → 刷新页面 →
              右键任意一条 <span className="font-mono">smzdm.com</span> 请求 →
              Copy → <b>Copy as cURL</b>
            </li>
            <li>
              <b>3.</b> 粘贴到下面输入框，点保存。整条命令直接粘，不用自己挑 Cookie
            </li>
            <li className="text-paper-500">
              说明：Cookie 只存在你自己的服务器上，不回显、不写日志；失效时在这里重新粘一次即可。
            </li>
          </ol>
        )}
        <textarea
          value={cookieDraft}
          onChange={(e) => setCookieDraft(e.target.value)}
          rows={4}
          placeholder="粘贴 Copy as cURL 的内容，或者直接粘 Cookie 字符串（形如 a=1; b=2）"
          className="w-full resize-y rounded-xl border border-paper-200 bg-white/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-paper-900 outline-none focus:border-brand-gold/50"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void saveCookie()}
            disabled={busy || !cookieDraft.trim()}
            className="press inline-flex items-center gap-1.5 rounded-xl bg-brand-red px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <Save size={12} /> 保存 Cookie
          </button>
          {config.cookie_set && (
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  await dealsApi.clearCookie();
                  flash("已清除 Cookie");
                  await refresh();
                } catch (e) {
                  setErr(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="press inline-flex items-center gap-1.5 rounded-xl border border-paper-200 px-3 py-1.5 text-xs text-paper-700 transition hover:border-rose-300 hover:text-rose-600 disabled:opacity-40"
            >
              <Trash2 size={12} /> 清除
            </button>
          )}
        </div>
      </Section>

      {/* 关注分类 */}
      <Section
        title="关注分类"
        desc="公开页只展示这些一级分类。其它品类照样抓取入库（改配置后立刻可用历史），只是不展示。留空 = 全部展示。下方数字是近 72 小时实际抓到的条数。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={cateDraft}
            onChange={(e) => setCateDraft(e.target.value)}
            placeholder="如：电脑数码,家用电器（逗号分隔，留空为全部）"
            className={`min-w-0 flex-1 ${inputCls}`}
          />
          <button
            onClick={() => void saveCate(cateDraft.trim())}
            disabled={busy}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-red px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <Save size={12} /> 保存
          </button>
        </div>

        {cates.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {cates.map((c) => (
              <button
                key={c.cate}
                onClick={() => {
                  const cur = cateDraft.split(",").map((x) => x.trim()).filter(Boolean);
                  const next = cur.includes(c.cate)
                    ? cur.filter((x) => x !== c.cate)
                    : [...cur, c.cate];
                  const joined = next.join(",");
                  setCateDraft(joined);
                  void saveCate(joined);
                }}
                className={`press rounded-full border px-2.5 py-1 text-[11px] transition ${
                  cateDraft.split(",").map((x) => x.trim()).includes(c.cate)
                    ? "border-brand-red/40 bg-brand-red/10 text-brand-red2"
                    : "border-paper-200 text-paper-700 hover:bg-paper-100"
                }`}
                title={`近 72 小时抓到 ${c.count} 条，其中 ${c.picked} 条达标 —— 点击加入/移出关注分类`}
              >
                {c.cate} <span className="tabular-nums opacity-60">{c.count}</span>
                {c.picked > 0 && (
                  <span className="ml-1 tabular-nums text-brand-red2">·{c.picked}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </Section>

      <p className="pb-4 text-center text-[10px] text-paper-500">
        个人自用 · 低频抓取公开页面，不转载正文，仅保留标题摘要与跳转链接
      </p>
    </div>
  );
}

/* ---------------- 入口 ---------------- */

export default function DealsAdmin() {
  const [session, setSession] = useState<boolean | null>(null);

  useEffect(() => {
    dealsApi
      .session()
      .then(setSession)
      .catch(() => setSession(false));
  }, []);

  if (session === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-paper-400" />
      </div>
    );
  }

  if (!session) return <PasswordGate onPass={() => setSession(true)} />;

  return (
    <AdminPanel
      onLogout={() => {
        void dealsApi.logout();
        setSession(false);
      }}
    />
  );
}
