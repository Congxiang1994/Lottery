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
 *   1. 入选阈值 —— 保存即重算全库，公开页马上变
 *   2. 关注品类 —— 只影响排序加权（命中的往前排），不影响能否入选
 *   3. 品类黑名单 —— 直接否决，用来挡「不是商品」的羊毛帖
 *
 * 为什么没有登录 Cookie：好价列表页匿名可读，线上匿名跑了数小时零风控，
 * 配了反而把家宽登录态搬到机房 IP（站方可能提示异地登录）。UI 去掉，
 * 后端保留字段，真被风控掐死时用本地脚本 --push 注入即可。
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
          调整入选阈值、关注品类与黑名单，查看抓取健康度。
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
  step,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className={`block ${disabled ? "opacity-50" : ""}`}>
      <span className="text-[11px] font-medium text-paper-800">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
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
  const [cateDraft, setCateDraft] = useState("");
  const [blockDraft, setBlockDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
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
      setBlockDraft(cfg.settings.cate_blacklist ?? "");
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

  // 两个清单的当前值 —— 放在这里而不是渲染前，是为了让下方 toggleBlock
  // 等回调能直接闭包引用，不必把定义顺序倒过来。
  const blockNow = blockDraft.split(",").map((x) => x.trim()).filter(Boolean);
  const watchNow = cateDraft.split(",").map((x) => x.trim()).filter(Boolean);

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
        discount_mode: form.discount_mode,
        discount_direct: form.discount_direct,
        discount_assist: form.discount_assist,
        newbie_discount: form.newbie_discount,
        newbie_price: form.newbie_price,
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

  const saveCate = async (value: string) => {
    setBusy(true);
    try {
      const res = await dealsApi.saveConfig({ cate_filter: value });
      setForm((f) => (f ? { ...f, cate_filter: value } : f));
      setCateDraft(value);
      flash(
        value
          ? `已保存，当前共 ${res.picked ?? 0} 条入选（命中关注品类的排前面）`
          : "已清空关注品类，榜单不再加权",
      );
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBlacklist = async (value: string) => {
    setBusy(true);
    try {
      const res = await dealsApi.saveConfig({ cate_blacklist: value });
      setForm((f) => (f ? { ...f, cate_blacklist: value } : f));
      setBlockDraft(value);
      flash(`黑名单已更新，全库重算后共 ${res.picked ?? 0} 条入选`);
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 点 chip 切换黑名单（与关注品类同一套交互）。
   *
   * 加入黑名单时会把它同时从关注品类里摘掉：两个清单同时命中时黑名单优先，
   * 留着只会让页面出现「既关注又否决」的自相矛盾状态，用户还得自己猜哪个生效。
   * 反向不动 —— 移出黑名单不代表想加权，那得由用户自己决定。
   */
  const toggleBlock = async (name: string) => {
    const isOn = blockNow.includes(name);
    const nextBlock = isOn ? blockNow.filter((x) => x !== name) : [...blockNow, name];
    const hadWatch = !isOn && watchNow.includes(name);
    const nextWatch = hadWatch ? watchNow.filter((x) => x !== name) : watchNow;
    const blockVal = nextBlock.join(",");
    const cateVal = nextWatch.join(",");

    setBusy(true);
    try {
      const res = await dealsApi.saveConfig(
        hadWatch
          ? { cate_blacklist: blockVal, cate_filter: cateVal }
          : { cate_blacklist: blockVal },
      );
      setForm((f) =>
        f ? { ...f, cate_blacklist: blockVal, cate_filter: cateVal } : f,
      );
      setBlockDraft(blockVal);
      if (hadWatch) setCateDraft(cateVal);
      flash(
        isOn
          ? `「${name}」已移出黑名单`
          : hadWatch
            ? `「${name}」已加入黑名单，并同时移出关注品类（全库重算后 ${res.picked ?? 0} 条入选）`
            : `「${name}」已加入黑名单，全库重算后 ${res.picked ?? 0} 条入选`,
      );
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBoost = async (value: string) => {
    setBusy(true);
    try {
      await dealsApi.saveConfig({ cate_boost: value });
      // 用后端规范化后的值回填（"1.60" → "1.6"）。不回填的话输入框和实际生效值
      // 不一致，下次失焦又会被判成「改过了」再存一遍。
      const cfg = await dealsApi.config();
      setForm((f) => (f ? { ...f, cate_boost: cfg.settings.cate_boost } : cfg.settings));
      flash(`加权系数已设为 ${cfg.settings.cate_boost}`);
      await refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  /** 标签流开关：点 chip 加入/移出。存的是 slug（中文名会 301，后端也会挡）。 */
  const toggleTag = async (slug: string) => {
    if (!form) return;
    const cur = form.tag_feeds.split(",").map((x) => x.trim()).filter(Boolean);
    const next = cur.includes(slug) ? cur.filter((x) => x !== slug) : [...cur, slug];
    const val = next.join(",");
    setBusy(true);
    try {
      await dealsApi.saveConfig({ tag_feeds: val });
      setForm((f) => (f ? { ...f, tag_feeds: val } : f));
      flash(next.length ? `已启用 ${next.length} 个标签流` : "已关闭标签流，只保留首页推荐流");
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

  // 黑名单的 chip 来源有两个：近 72 小时实际抓到的品类 + 已配置但窗口内没供给的。
  // 后者不能省 —— 三天没出现过某品类时它不在 cates 里，只读输入框根本看不出
  // 「我到底还拦着什么」，而黑名单是否决语义，漏看代价比关注品类大。
  const blockChips: { cate: string; count: number | null }[] = [
    ...cates.map((c) => ({ cate: c.cate, count: c.count as number | null })),
    ...blockNow
      .filter((n) => !cates.some((c) => c.cate === n))
      .map((n) => ({ cate: n, count: null })),
  ];

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-paper-900">捡漏设置</h1>
          <p className="mt-1 text-xs text-paper-600">
            每 {config.constants.interval_minutes} 分钟一轮：标签流{" "}
            {form.tag_feeds.split(",").filter(Boolean).length} 个 ×{" "}
            {form.tag_pages || 0} 页 + 推荐流 {config.constants.home_pages_per_round} 页
            {Number(form.pages_per_round) > 0
              ? ` + 精选流 ${form.pages_per_round} 页`
              : ""}
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

      {/* 折扣判定（主力判据） */}
      <Section
        title="折扣判定"
        desc="从正文里的「原价 → 到手价」算出折数。折扣够深就直接入选，不看投票 —— 刚发布的好价没人投过票，但折扣是客观的。这是唯一与曝光无关的判据。"
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
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-paper-800">
          <input
            type="checkbox"
            checked={form.discount_mode === "1"}
            onChange={(e) => set({ discount_mode: e.target.checked ? "1" : "0" })}
            className="h-3.5 w-3.5 accent-[#c0453e]"
          />
          启用折扣优先
          <span className="font-normal text-paper-500">
            （关掉则退回纯热度判据，应急回滚用）
          </span>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField
            label="直接入选：折扣 ≤（%）"
            hint="50 = 5 折及以内，不看投票直接入选"
            value={form.discount_direct}
            onChange={(v) => set({ discount_direct: v })}
            min={1}
            max={100}
            disabled={form.discount_mode !== "1"}
          />
          <NumField
            label="需热度：折扣 ≤（%）"
            hint="70 = 5~7 折之间，需至少一项热度达标"
            value={form.discount_assist}
            onChange={(v) => set({ discount_assist: v })}
            min={1}
            max={100}
            disabled={form.discount_mode !== "1"}
          />
          <NumField
            label="新人价：折扣 <（%）"
            hint="低于此折扣且金额很小 → 判为首购礼金"
            value={form.newbie_discount}
            onChange={(v) => set({ newbie_discount: v })}
            min={0}
            max={100}
            disabled={form.discount_mode !== "1"}
          />
          <NumField
            label="新人价：到手价 <（元）"
            hint="0.4 折 0.59 元这种是新人补贴，限购 1 件"
            value={form.newbie_price}
            onChange={(v) => set({ newbie_price: v })}
            min={0}
            max={1000}
            step={0.01}
            disabled={form.discount_mode !== "1"}
          />
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-paper-500">
          折扣来自列表正文里的原价声明（「活动售价 505 元…到手 254 元」）。
          约一半条目正文没写原价，那些自动走下面的热度判据 —— 所以两套都要维护。
        </p>
      </Section>

      {/* 抓取来源 */}
      <Section
        title="抓取来源"
        desc="标签流是主力入口：时间序、带正文与爆料人，实测入选率约为首页推荐流的 5~20 倍。首页推荐流作为兜底保留，排行榜每 3 轮补充一次数码品类。"
      >
        <div className="flex flex-wrap gap-1.5">
          {config.constants.tag_feeds.map((t) => {
            const on = form.tag_feeds
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
              .includes(t.slug);
            return (
              <button
                key={t.slug}
                onClick={() => void toggleTag(t.slug)}
                disabled={busy}
                className={`press rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                  on
                    ? "border-brand-red/40 bg-brand-red/10 font-medium text-brand-red2"
                    : "border-paper-200 text-paper-700 hover:bg-paper-100"
                }`}
                title={on ? "点击关闭该标签流" : "点击启用该标签流"}
              >
                {t.name}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumField
            label="每个标签抓几页"
            hint="默认 2。0 = 完全关闭标签流"
            value={form.tag_pages}
            onChange={(v) => set({ tag_pages: v })}
            min={0}
            max={3}
          />
          <div className="col-span-2 self-center text-[10px] leading-relaxed text-paper-500">
            每轮约请求{" "}
            <b className="tabular-nums text-paper-800">
              {form.tag_feeds.split(",").filter(Boolean).length *
                Number(form.tag_pages || 0) +
                config.constants.home_pages_per_round +
                1}
            </b>{" "}
            次（含排行榜，每 {config.constants.top_every_n_rounds} 轮一次），
            间隔 {config.constants.min_request_interval_seconds} 秒。
          </div>
        </div>
      </Section>

      {/* 阈值 */}
      <Section
        title="热度阈值（算不出折数时使用）"
        desc="正文没写原价的条目（约一半），按值率 + 值/收藏/评论三项判定。保存后立即重算全库。"
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
            label="每轮额外抓几页精选流"
            hint="默认 0 = 不抓。精选流是时间序的全量爆料流水，值/收藏中位数接近 0，实测 100 条里 0 条能过阈值 —— 它不是「精挑好价」，调大只会多抓请求、多灌库"
            value={form.pages_per_round}
            onChange={(v) => set({ pages_per_round: v })}
            min={0}
            max={8}
          />
        </div>
      </Section>

      {/* 关注品类：只影响排序 */}
      <Section
        title="关注品类"
        desc={`只影响排序，不影响入选 —— 命中这些品类的综合热度 ×${form.cate_boost} 往前排，其它品类照样入选。留空 = 不加权。下方数字是近 72 小时实际抓到的条数（红色为达标数）。`}
        right={
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-paper-600">权重</span>
            <input
              type="number"
              step="0.1"
              min={1}
              max={5}
              value={form.cate_boost}
              onChange={(e) => set({ cate_boost: e.target.value })}
              onBlur={(e) => {
                const v = e.target.value;
                if (v && v !== config.settings.cate_boost) void saveBoost(v);
              }}
              className="w-16 rounded-lg border border-paper-200 bg-white/60 px-2 py-1 text-[11px] tabular-nums text-paper-900 outline-none focus:border-brand-gold/50"
              title="1.0 = 不加权，越大越靠前"
            />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={cateDraft}
            onChange={(e) => setCateDraft(e.target.value)}
            placeholder="如：电脑数码,家用电器（逗号分隔，留空为不加权）"
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
            {cates.map((c) => {
              const isBlocked = blockNow.includes(c.cate);
              return (
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
                    isBlocked
                      ? "border-paper-200 text-paper-400 line-through"
                      : watchNow.includes(c.cate)
                        ? "border-brand-red/40 bg-brand-red/10 text-brand-red2"
                        : "border-paper-200 text-paper-700 hover:bg-paper-100"
                  }`}
                  title={
                    isBlocked
                      ? `近 72 小时 ${c.count} 条 —— 该品类在黑名单里，即使加入关注也会被否决`
                      : `近 72 小时抓到 ${c.count} 条，其中 ${c.picked} 条达标 —— 点击加入/移出关注品类`
                  }
                >
                  {c.cate} <span className="tabular-nums opacity-60">{c.count}</span>
                  {c.picked > 0 && (
                    <span className="ml-1 tabular-nums text-brand-red2">·{c.picked}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* 品类黑名单：直接否决 */}
      <Section
        title="品类黑名单"
        desc="命中即直接否决，连阈值都不看。专挡「不是商品」的帖子 —— 好价流里混着「每日领京豆」「签到领红包」这类羊毛帖，热度很高但不属于捡漏。点下方品类即可加入/移出。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={blockDraft}
            onChange={(e) => setBlockDraft(e.target.value)}
            placeholder="如：金融服务（逗号分隔，留空为不拦截）"
            className={`min-w-0 flex-1 ${inputCls}`}
          />
          <button
            onClick={() => void saveBlacklist(blockDraft.trim())}
            disabled={busy}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-red px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <Save size={12} /> 保存
          </button>
        </div>

        {blockChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {blockChips.map((c) => {
              const on = blockNow.includes(c.cate);
              const inWatch = watchNow.includes(c.cate);
              return (
                <button
                  key={c.cate}
                  onClick={() => void toggleBlock(c.cate)}
                  disabled={busy}
                  className={`press rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                    on
                      ? "border-paper-300 bg-paper-200 text-paper-500 line-through"
                      : "border-paper-200 text-paper-700 hover:border-paper-300 hover:bg-paper-100"
                  }`}
                  title={
                    on
                      ? `近 72 小时 ${c.count ?? "未出现"} 条 —— 已拦截，点击移出黑名单`
                      : inWatch
                        ? `近 72 小时 ${c.count ?? "未出现"} 条 —— 当前在关注品类里，加入黑名单会同时移出关注`
                        : `近 72 小时 ${c.count ?? "未出现"} 条 —— 点击加入黑名单`
                  }
                >
                  {c.cate}
                  <span className="ml-1 tabular-nums opacity-60">{c.count ?? "—"}</span>
                  {inWatch && !on && (
                    <span className="ml-1 text-[10px] text-brand-red2">关注中</span>
                  )}
                </button>
              );
            })}
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
