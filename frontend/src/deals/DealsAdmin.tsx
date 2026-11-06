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
import { AdminGate } from "../common/AdminGate";
import { PageHeader, PrivateBadge } from "../common/PageHeader";
import { ErrorBlock, errText } from "../common/State";
import { INPUT } from "../common/ui";

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

const inputCls = INPUT;

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
  /** 品类 chip 默认只露数码相关的几个，其余折叠 */
  const [showAllCate, setShowAllCate] = useState(false);
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

  /** 当前选中的品类（唯一必填项）。点 chip 即改即存。 */
  const allowNow = (form?.cate_allow || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  /**
   * 品类 chip 列表 = 近 72 小时抓到过的 + 已选中但窗口内没供给的。
   * 后者不能省：三天没出货时它不在 cateStats 里，只读配置根本看不出
   * 「我到底还开着哪些品类」，而这是唯一决定收不收东西的开关。
   */
  const cateOrdered: { cate: string; count: number | null; picked: number | null }[] = (() => {
    const seen = status?.cates ?? [];
    const list = seen.map((c) => ({
      cate: c.cate,
      count: c.count as number | null,
      picked: c.picked as number | null,
    }));
    // 选中的排前面，方便看
    list.sort((a, b) => {
      const aa = allowNow.includes(a.cate) ? 0 : 1;
      const bb = allowNow.includes(b.cate) ? 0 : 1;
      return aa - bb || (b.count ?? 0) - (a.count ?? 0);
    });
    for (const n of allowNow) {
      if (!list.some((c) => c.cate === n)) list.push({ cate: n, count: null, picked: null });
    }
    return list;
  })();

  // 哪些品类算「数码相关」——用于决定默认露出哪几个。
  // 这里刻意写成关键词匹配而不是写死名单：站点会调分类层级
  // （2026-10-28 实测「手机通讯」「数码配件」就是「电脑数码」下的二级），
  // 写死会在层级变动后静默漏掉新分类。
  const DIGITAL_CATE = /数码|电脑|手机|智能|家电|电器|影音|配件/;

  const cateShown = showAllCate
    ? cateOrdered
    : cateOrdered.filter((c) => allowNow.includes(c.cate) || DIGITAL_CATE.test(c.cate));
  const cateHidden = cateOrdered.filter((c) => !cateShown.includes(c));

  /** 点品类：加/减关注范围，立即保存并重算。 */
  const toggleCate = async (name: string) => {
    const next = allowNow.includes(name)
      ? allowNow.filter((x) => x !== name)
      : [...allowNow, name];
    setBusy(true);
    try {
      const res = await dealsApi.saveConfig({ cate_allow: next.join(",") });
      set({ cate_allow: next.join(",") });
      flash(
        next.length === 0
          ? "已清空关注品类 —— 现在不会有任何条目入选"
          : `已保存，全库重算后共 ${res.picked ?? 0} 条入选`,
      );
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


  /** 标签流开关：点 chip 加入/移出。存的是 slug（中文名会 301，后端也会挡）。 */

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
        <PageHeader
          size="compact"
          title="捡漏设置"
          badge={<PrivateBadge />}
          subtitle={
            <>
              每 {config.constants.interval_minutes} 分钟一轮：标签流{" "}
              {form.tag_feeds.split(",").filter(Boolean).length} 个 ×{" "}
              {form.tag_pages || 0} 页 + 推荐流 {config.constants.home_pages_per_round} 页
              {Number(form.pages_per_round) > 0
                ? ` + 精选流 ${form.pages_per_round} 页`
                : ""}
            </>
          }
        />
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

      {/* 关注范围：整个页面唯一的必填项 */}
      <Section
        title="关注品类"
        desc="只收这些品类的商品，其余一律不入选。点一下就能加/减。"
        right={
          <span className="text-[11px] text-paper-600">
            {allowNow.length > 0
              ? `${allowNow.length} 个品类`
              : "未选（会没有结果）"}
          </span>
        }
      >
        {/* 默认只露「数码类 + 已选中」的 chip。
            站点实际有近 20 个一级品类，全铺开一屏都是按钮，而其中 17 个
            在当前模式下永远选不上（选了也会被排除词/信号条件过滤）。
            真正可能扩展的只有数码相关的几个，其余收进「更多品类」。 */}
        <div className="flex flex-wrap gap-1.5">
          {cateShown.map((c) => {
            const on = allowNow.includes(c.cate);
            return (
              <button
                key={c.cate}
                onClick={() => void toggleCate(c.cate)}
                disabled={busy}
                className={`press rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                  on
                    ? "border-brand-red/45 bg-brand-red/10 font-semibold text-brand-red2"
                    : "border-paper-200 text-paper-700 hover:border-brand-gold/45 hover:bg-paper-100"
                }`}
                title={`近 72 小时抓到 ${c.count ?? 0} 条，其中 ${c.picked ?? 0} 条达标 —— 点击${on ? "取消" : "选中"}`}
              >
                {c.cate}
                <span className="ml-1 tabular-nums opacity-55">{c.count ?? 0}</span>
              </button>
            );
          })}
          {/* ⚠️ 条件是 `showAllCate || cateHidden.length > 0`，不能只判后者：
              展开后 cateHidden 变空，若按它渲染，按钮会消失 → 用户再也收不回去。
              （这一版第一稿就是这么错的，实测点开「更多品类 17」后无路可退。） */}
          {(showAllCate || cateHidden.length > 0) && (
            <button
              onClick={() => setShowAllCate((v) => !v)}
              className="press rounded-full border border-dashed border-paper-300 px-3 py-1.5 text-xs text-paper-600 transition hover:bg-paper-100"
            >
              {showAllCate ? "收起" : `更多品类 ${cateHidden.length}`}
            </button>
          )}
        </div>
        {cateOrdered.length === 0 && (
          <p className="text-xs text-paper-600">还没有抓到过数据，等一轮抓取后再来选。</p>
        )}
      </Section>

      {/* 规则说明：把判定逻辑用人话摊开，替代原来的「高级」配置区。
          用户 2026-11-06 明确：不会有人来这里改配置，真要调直接改代码。
          所以这里只解释「为什么这条能上、那条不能」，不给任何可编辑控件。 */}
      <Section title="怎么筛的" desc="规则固定在代码里，不需要你调。">
        <ol className="space-y-2.5 text-[11px] leading-relaxed text-paper-700">
          <li className="flex gap-2">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-paper-200 text-[9px] font-bold text-paper-800">1</span>
            <span>
              <b className="font-semibold text-paper-900">只看选中的品类。</b>
              不在「关注品类」里的东西直接丢掉，连下面几步都不进。
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-paper-200 text-[9px] font-bold text-paper-800">2</span>
            <span>
              <b className="font-semibold text-paper-900">不是实物的踢掉。</b>
              会员卡、年卡、优惠券、课程、网盘这类不算商品；「清单」「汇总」「预告」
              这种整场活动的入口也不算单个商品。
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-paper-200 text-[9px] font-bold text-paper-800">3</span>
            <span>
              <b className="font-semibold text-paper-900">必须带「便宜信号」。</b>
              站点自己打了标签的才算数，只有两种：
              <span className="mx-1 rounded bg-brand-red/10 px-1 py-px font-medium text-brand-red2">真漏</span>
              （绝对值 / 历史低价 / 手慢无 / 新低 / 直降 / 清仓）
              和
              <span className="mx-1 rounded border border-brand-gold/45 bg-brand-gold/10 px-1 py-px font-medium text-brand-gold">补贴</span>
              （百亿补贴 / 国家补贴 / 国补 / 一键补贴）。
              两个都没有的，哪怕价格再低也不收。
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-paper-200 text-[9px] font-bold text-paper-800">4</span>
            <span>
              <b className="font-semibold text-paper-900">按「值不值得买」排序。</b>
              先看价格档（越贵的大件分越高，500 元的充电器和 8000 元的笔记本不是一个量级），
              再乘信号强度（真漏 ×1.0 压过补贴 ×0.8）和品牌加成（小米 / 苹果 / 索尼这类 ×1.3）。
              <span className="mt-1 block text-paper-600">
                所以便宜的小配件也会收，只是排在后面 —— 榜单要的是「值得买的东西」，不是「折数最漂亮」。
              </span>
            </span>
          </li>
        </ol>
      </Section>

      <p className="pb-4 text-center text-[10px] text-paper-500">
        个人自用 · 低频抓取公开页面，不转载正文，仅保留标题摘要与跳转链接
      </p>
    </div>
  );
}

/* ---------------- 入口 ---------------- */

export default function DealsAdmin() {
  return (
    <AdminGate
      title="捡漏设置"
      subtitle="私有功能 · 验证后可改阈值"
      desc="调整入选阈值、关注品类与黑名单，查看抓取健康度。"
      probe={() => dealsApi.session()}
      login={(pwd) => dealsApi.auth(pwd)}
      logout={() => dealsApi.logout()}
      accent="gold"
    >
      {({ logout }) => <AdminPanel onLogout={logout} />}
    </AdminGate>
  );
}
