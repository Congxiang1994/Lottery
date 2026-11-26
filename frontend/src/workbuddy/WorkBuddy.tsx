import { useCallback, useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import {
  Activity,
  BadgeCheck,
  CheckCircle2,
  Coins,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";

import { AdminGate } from "../common/AdminGate";
import { AppModal, ConfirmDialog } from "../common/AppModal";
import { PageHeader, PrivateBadge } from "../common/PageHeader";
import { Empty, ErrorBlock, Loading, errText } from "../common/State";
import { isUnauthorized } from "../common/http";
import { copyText } from "../common/http";
import { INPUT } from "../common/ui";
import { workbuddyApi, type WBAccount, type WBModel, type WBSettings, type WBOverview, type WBDiagnostics } from "./api";

/** WorkBuddy 账号管理 /workbuddy —— 私有入口；参考 dsh-connect-workbuddy 的账号池与模型管理能力。 */
export default function WorkBuddy() {
  return (
    <AdminGate
      title="WorkBuddy 账号管理"
      subtitle="私有功能 · 验证后可管理账号池"
      desc="扫码添加 WorkBuddy 账号，集中管理账号池、积分、签到与模型目录。凭据加密存储在服务器，页面只显示脱敏信息。"
      probe={() => workbuddyApi.session()}
      login={(pwd) => workbuddyApi.auth(pwd)}
      logout={() => workbuddyApi.logout()}
      accent="violet"
    >
      {({ onUnauthorized, logout }) => <WorkBuddyPanel onUnauthorized={onUnauthorized} logout={logout} />}
    </AdminGate>
  );
}

type Region = "cn" | "global";
type Section = "accounts" | "models" | "capabilities" | "diagnostics";

const REGION_LABEL: Record<Region, string> = { cn: "国内版", global: "国际版" };

function fmtTime(ms?: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statCards(o: WBOverview | null) {
  if (!o) return [];
  return [
    { label: "账号总数", value: String(o.total), sub: `${o.region === "cn" ? "国内版" : "国际版"}区域` },
    { label: "入池账号", value: String(o.members), sub: "显式勾选才参与批量操作" },
    { label: "积分合计", value: o.creditsTotal.toLocaleString(), sub: "最近一次查询快照" },
  ];
}

/* ---------------------------------------------------------------- 扫码弹框 */

function OAuthModal({
  region,
  onClose,
  onDone,
}: {
  region: Region;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"starting" | "waiting" | "done" | "error">("starting");
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [err, setErr] = useState("");
  const [nickname, setNickname] = useState("");
  const [copied, setCopied] = useState(false);

  const start = useCallback(async () => {
    setPhase("starting");
    setErr("");
    try {
      const r = await workbuddyApi.oauthStart(region);
      loginIdRef.current = r.loginId;
      setUrl(r.verificationUri);
      setQr(await QRCode.toDataURL(r.verificationUri, { width: 240, margin: 1, color: { dark: "#3d2b1f", light: "#ffffff" } }));
      setPhase("waiting");
      window.open(r.verificationUri, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(errText(e));
      setPhase("error");
    }
  }, [region]);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (phase !== "waiting" || !url) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const sessionUrl = url;
    const poll = async () => {
      // 用最近一次 start 的 loginId：存在模块级 ref 中，避免闭包漂移
      const id = loginIdRef.current;
      if (!id || stopped) return;
      try {
        const r = await workbuddyApi.oauthPoll(id);
        if (stopped) return;
        if (r.done) {
          setNickname(r.nickname || "账号");
          setPhase("done");
          onDone();
          return;
        }
        if (sessionUrl) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (stopped) return;
        setErr(errText(e));
        setPhase("error");
      }
    };
    timer = setTimeout(poll, 1800);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, url, onDone]);

  return (
    <AppModal
      onClose={onClose}
      size="sm"
      title={<><QrCode size={16} className="text-brand-red" /> 扫码添加账号</>}
      description={REGION_LABEL[region] + (region === "global" ? " · 在打开的网页中登录" : " · 用 WorkBuddy App 扫描授权页二维码")}
    >
      <div className="px-5 py-4 text-center">
        {phase === "starting" && <Loading label="正在申请登录会话…" className="py-10" />}
        {phase === "error" && (
          <>
            <XCircle size={28} className="mx-auto text-rose-500" />
            <p className="mt-3 text-sm text-rose-700">{err || "登录失败"}</p>
            <button onClick={start} className="press mt-4 rounded-xl border border-paper-200 px-4 py-2 text-xs">重试</button>
          </>
        )}
        {phase === "waiting" && (
          <>
            {qr ? <img src={qr} alt="扫码登录二维码" className="mx-auto rounded-xl border border-paper-200 bg-white p-2" /> : <Loading className="py-10" />}
            <p className="mt-3 text-xs text-paper-700">扫码或在网页完成登录后，页面会自动跳转</p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-paper-200 px-3 py-1.5 text-xs text-paper-700 hover:bg-paper-100">
                <ExternalLink size={12} /> 打开授权页
              </a>
              <button
                onClick={async () => { setCopied(await copyText(url)); setTimeout(() => setCopied(false), 1500); }}
                className="inline-flex items-center gap-1 rounded-lg border border-paper-200 px-3 py-1.5 text-xs text-paper-700 hover:bg-paper-100"
              >
                <Copy size={12} /> {copied ? "已复制" : "复制链接"}
              </button>
            </div>
            <div className="mt-2 break-all rounded-lg bg-paper-100 px-2 py-1.5 text-[10px] text-paper-500">{url}</div>
            <Loading label="等待扫码确认…" className="mt-3" />
          </>
        )}
        {phase === "done" && (
          <>
            <CheckCircle2 size={30} className="mx-auto text-emerald-500" />
            <p className="mt-3 text-sm font-semibold">已添加 {nickname}</p>
            <button onClick={onClose} className="press mt-4 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-5 py-2 text-sm font-semibold text-white">完成</button>
          </>
        )}
      </div>
    </AppModal>
  );
}

// 扫码会话 id 的轻量模块级引用（只在弹框生命周期内有意义）
const loginIdRef = { current: "" };

/* ---------------------------------------------------------------- 主面板 */

function WorkBuddyPanel({ onUnauthorized, logout }: { onUnauthorized: () => void; logout: () => void }) {
  const [region, setRegion] = useState<Region>("cn");
  const [section, setSection] = useState<Section>("accounts");
  const [overview, setOverview] = useState<WBOverview | null>(null);
  const [diagnostics, setDiagnostics] = useState<WBDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [oauthOpen, setOauthOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<WBAccount | null>(null);
  const [models, setModels] = useState<WBModel[]>([]);
  const [enabledModels, setEnabledModels] = useState<Set<string>>(new Set());
  const [modelFetchedAt, setModelFetchedAt] = useState("");
  const [settings, setSettings] = useState<WBSettings | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [o, d, s] = await Promise.all([
        workbuddyApi.overview(region),
        workbuddyApi.diagnostics(region),
        workbuddyApi.settings(region),
      ]);
      setOverview(o);
      setDiagnostics(d);
      setSettings(s);
      setError("");
      setSelected(new Set());
    } catch (e) {
      if (isUnauthorized(e)) onUnauthorized();
      else setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [region, onUnauthorized]);

  useEffect(() => { reload(); }, [reload]);

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label);
    setError("");
    try {
      await fn();
      after?.();
    } catch (e) {
      if (isUnauthorized(e)) onUnauthorized();
      else setError(errText(e));
    } finally {
      setBusy("");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const accounts = overview?.accounts || [];
  const allSelected = accounts.length > 0 && accounts.every((a) => selected.has(a.id));

  return (
    <div className="pt-8">
      <PageHeader
        title="WorkBuddy 账号管理"
        subtitle="扫码添加账号 · 账号池 · 积分与签到 · 模型目录 · 诊断"
        icon={Users}
        iconClass="text-violet-500"
        badge={<PrivateBadge />}
        size="compact"
        actions={
          <>
            <button onClick={logout} title="退出登录" className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 text-paper-700 hover:bg-paper-100"><LogOut size={15} /></button>
            <button onClick={reload} title="刷新" className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 text-paper-700 hover:bg-paper-100"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
          </>
        }
      />

      {error && <ErrorBlock message={error} onRetry={reload} className="mt-4" />}

      {/* 区域 tab */}
      <div className="mt-5 flex items-center gap-2">
        {(["cn", "global"] as Region[]).map((r) => (
          <button
            key={r}
            onClick={() => { setRegion(r); setSection("accounts"); }}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              region === r ? "bg-gradient-to-br from-brand-red to-brand-red2 text-white shadow-glow" : "border border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
            }`}
          >
            {REGION_LABEL[r]}
          </button>
        ))}
        <span className="text-[11px] text-paper-500">两区域账号池与配置完全独立</span>
      </div>

      {/* 状态卡 */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {statCards(overview).map((c) => (
          <div key={c.label} className="glass rounded-2xl p-4 shadow-card">
            <div className="text-[11px] font-medium text-paper-700">{c.label}</div>
            <div className="mt-1 text-xl font-extrabold tabular-nums">{c.value}</div>
            <div className="mt-0.5 text-[10px] text-paper-500">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 功能分栏 */}
      <div className="mt-5 flex flex-wrap items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm w-fit">
        {([
          ["accounts", "账号池", Users],
          ["models", "模型", BadgeCheck],
          ["capabilities", "能力", ShieldCheck],
          ["diagnostics", "诊断", Activity],
        ] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setSection(k)} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition ${section === k ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {section === "accounts" && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setOauthOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-violet-600 to-brand-red px-4 py-2 text-sm font-semibold text-white shadow-glow press transition hover:opacity-90"
              >
                <Plus size={15} /> 扫码添加账号
              </button>
              <button
                disabled={!selected.size || !!busy}
                onClick={() => run("签到", () => workbuddyApi.poolCheckin([...selected]), reload)}
                className="flex items-center gap-1.5 rounded-xl border border-paper-200 px-3 py-2 text-xs text-paper-700 hover:bg-paper-100 disabled:opacity-40"
              >
                {busy === "签到" ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />} 批量签到
              </button>
              <button
                disabled={!selected.size || !!busy}
                onClick={() => run("刷新积分", () => workbuddyApi.poolCredits([...selected]), reload)}
                className="flex items-center gap-1.5 rounded-xl border border-paper-200 px-3 py-2 text-xs text-paper-700 hover:bg-paper-100 disabled:opacity-40"
              >
                {busy === "刷新积分" ? <Loader2 size={13} className="animate-spin" /> : <Coins size={13} />} 刷新积分
              </button>
            </div>
            <span className="text-[11px] text-paper-500">已选 {selected.size} / {accounts.length}</span>
          </div>

          {loading && !overview ? <Loading className="mt-6" /> : accounts.length === 0 ? (
            <div className="glass mt-4 rounded-2xl shadow-card">
              <Empty icon={Users} text="还没有账号" hint="点「扫码添加账号」，国内版用 App 扫码，国际版在网页登录即可。" className="py-12" />
            </div>
          ) : (
            <div className="glass mt-4 overflow-hidden rounded-2xl shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-paper-200 text-[11px] text-paper-600">
                      <th className="px-3 py-3">
                        <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(accounts.map((a) => a.id)))} />
                      </th>
                      <th className="px-3 py-3">账号</th>
                      <th className="px-3 py-3">积分 / 到期</th>
                      <th className="px-3 py-3">签到 / 状态</th>
                      <th className="px-3 py-3">入池</th>
                      <th className="px-3 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} className="border-b border-paper-100 last:border-0 hover:bg-paper-50/60">
                        <td className="px-3 py-3"><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} /></td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 font-semibold">
                            {a.nickname}
                            {a.current && <span title="当前账号" className="text-amber-500"><Star size={12} fill="currentColor" /></span>}
                            {a.enterprise && <span className="rounded bg-amber-50 px-1 text-[9px] text-amber-700">企业</span>}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-paper-500">{a.uid_masked} · {a.domain || "—"}</div>
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          <div className="font-semibold">{a.credits != null ? a.credits.toLocaleString() : "—"}</div>
                          <div className="text-[10px] text-paper-500">{a.nearestExpiryMs ? fmtTime(a.nearestExpiryMs) : "—"}</div>
                        </td>
                        <td className="px-3 py-3">
                          {a.checkin ? (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${a.checkin.status === "already" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                              {a.checkin.status === "already" ? "今日已签" : "已签到"}
                            </span>
                          ) : <span className="text-[10px] text-paper-500">未查询</span>}
                          {a.last_error && <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-rose-600" title={a.last_error}>{a.last_error}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => run("入池", () => workbuddyApi.setMember(a.id, !a.member), reload)}
                            className={`relative h-5 w-9 rounded-full transition ${a.member ? "bg-emerald-500" : "bg-paper-300"}`}
                            title={a.member ? "点此移出账号池" : "点此加入账号池"}
                          >
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${a.member ? "left-[18px]" : "left-0.5"}`} />
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn title="查积分" disabled={!!busy} onClick={() => run("查积分", () => workbuddyApi.accountCredits(a.id), reload)}><Coins size={13} /></IconBtn>
                            <IconBtn title="签到" disabled={!!busy || a.enterprise} onClick={() => run("签到", () => workbuddyApi.accountCheckin(a.id), reload)}><BadgeCheck size={13} /></IconBtn>
                            <IconBtn title="设为当前" disabled={!!busy || a.current} onClick={() => run("设为当前", () => workbuddyApi.setCurrent(a.id), reload)}><Star size={13} /></IconBtn>
                            <IconBtn title="刷新凭据" disabled={!!busy} onClick={() => run("刷新凭据", () => workbuddyApi.refreshCred(a.id))}><KeyRound size={13} /></IconBtn>
                            <IconBtn title="删除" danger disabled={!!busy} onClick={() => setConfirmDel(a)}><Trash2 size={13} /></IconBtn>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] text-paper-500">删除只移除本站保存的凭据并隐藏账号，不影响 WorkBuddy App 本身的登录。积分与签到均由服务器代理请求，页面不接触 token。</p>
        </div>
      )}

      {section === "models" && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-paper-700">从上游目录读取模型名册与积分倍率；勾选是草稿，点保存才生效。</p>
            <button
              disabled={!!busy}
              onClick={() => run("刷新目录", async () => {
                const r = await workbuddyApi.catalogRefresh(region);
                setModels(r.models);
                setEnabledModels(new Set(r.models.filter((m) => m.creditMultiplier !== null).map((m) => m.id)));
                setModelFetchedAt(r.fetchedAt);
              })}
              className="flex items-center gap-1.5 rounded-xl border border-paper-200 px-3 py-2 text-xs hover:bg-paper-100 disabled:opacity-40"
            >
              {busy === "刷新目录" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 从上游刷新
            </button>
          </div>
          {models.length === 0 ? (
            <div className="glass mt-4 rounded-2xl shadow-card">
              <Empty icon={BadgeCheck} text="还没有模型目录" hint="先在「账号池」添加一个账号并设为当前，再点「从上游刷新」。" className="py-12" />
            </div>
          ) : (
            <div className="glass mt-4 overflow-hidden rounded-2xl shadow-card">
              <div className="flex items-center justify-between border-b border-paper-200 px-4 py-2 text-[11px] text-paper-600">
                <span>共 {models.length} 个模型 · 抓取于 {modelFetchedAt}</span>
                <span>已勾选 {enabledModels.size}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-paper-100 text-[11px] text-paper-600">
                    <th className="px-4 py-2">启用</th><th className="px-4 py-2">模型</th><th className="px-4 py-2">倍率</th><th className="px-4 py-2">上下文</th><th className="px-4 py-2">能力</th>
                  </tr></thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.id} className="border-b border-paper-100 last:border-0">
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={enabledModels.has(m.id)} onChange={() => setEnabledModels((prev) => {
                            const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n;
                          })} />
                        </td>
                        <td className="px-4 py-2"><div className="font-semibold">{m.name || m.id}</div><div className="font-mono text-[10px] text-paper-500">{m.id}</div></td>
                        <td className="px-4 py-2 tabular-nums">{m.creditMultiplier === null ? <span className="text-paper-500">未给出</span> : <span className={m.creditMultiplier === 0 ? "font-semibold text-emerald-600" : ""}>x{m.creditMultiplier}</span>}</td>
                        <td className="px-4 py-2 tabular-nums text-xs text-paper-700">{m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : "—"}</td>
                        <td className="px-4 py-2 text-[10px] text-paper-600">{m.supportsImages ? "图片" : "文本"}{m.efforts.length ? ` · ${m.efforts.join("/")}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {section === "capabilities" && settings && (
        <div className="mt-4 glass max-w-2xl rounded-2xl p-5 shadow-card">
          <div className="space-y-4">
            <SettingRow label="启用该区域供应商" desc="关闭后该区域模型不参与任何调用（本页仅管理，实际连接由 DSH 插件侧控制）">
              <input type="checkbox" checked={settings.enabled} onChange={(e) => { setSettings({ ...settings, enabled: e.target.checked }); setSettingsDirty(true); }} />
            </SettingRow>
            <SettingRow label="每日自动签到" desc="默认关闭；打开后由插件侧定时替你领取，本站仅保存偏好">
              <input type="checkbox" checked={settings.autoCheckin} onChange={(e) => { setSettings({ ...settings, autoCheckin: e.target.checked }); setSettingsDirty(true); }} />
            </SettingRow>
            <div>
              <label className="text-xs font-medium">刷新间隔</label>
              <select
                className={`mt-1 ${INPUT}`}
                value={settings.pollIntervalMs}
                onChange={(e) => { setSettings({ ...settings, pollIntervalMs: Number(e.target.value) }); setSettingsDirty(true); }}
              >
                {[60000, 300000, 600000, 1800000, 3600000].map((v) => <option key={v} value={v}>{v / 60000} 分钟</option>)}
              </select>
              <p className="mt-1 text-[11px] text-paper-500">默认 5 分钟；每次刷新会为每个账号各读一次积分。</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              disabled={!settingsDirty || !!busy}
              onClick={() => run("保存设置", () => workbuddyApi.saveSettings(region, settings), () => { setSettingsDirty(false); reload(); })}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              <Save size={14} /> 保存
            </button>
            {settingsDirty && <button onClick={reload} className="text-xs text-paper-600 underline">放弃修改</button>}
            {!settingsDirty && <span className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 size={13} /> 已保存</span>}
          </div>
        </div>
      )}

      {section === "diagnostics" && diagnostics && (
        <div className="mt-4 glass max-w-3xl rounded-2xl p-5 shadow-card">
          <h3 className="text-sm font-bold">只读事实 · 可整段复制反馈</h3>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {[
              ["区域", REGION_LABEL[diagnostics.region as Region]],
              ["上游基址", diagnostics.upstreamBase],
              ["当前账号", diagnostics.currentAccount],
              ["登录有效期", fmtTime(diagnostics.currentExpiry)],
              ["账号数", String(diagnostics.accountCount)],
              ["入池数", String(diagnostics.memberCount)],
              ["刷新间隔", `${diagnostics.settings.pollIntervalMs / 60000} 分钟`],
              ["服务器时间", diagnostics.serverTime],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-paper-100 py-1.5">
                <dt className="text-paper-600">{k}</dt><dd className="max-w-[60%] break-all text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5">
            <h4 className="text-xs font-semibold">最近错误原文</h4>
            {diagnostics.recentErrors.length === 0 ? <p className="mt-2 text-xs text-paper-500">暂无</p> : (
              <ul className="mt-2 space-y-1">{diagnostics.recentErrors.map((e, i) => <li key={i} className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">{e}</li>)}</ul>
            )}
          </div>
        </div>
      )}

      {oauthOpen && (
        <OAuthModal
          region={region}
          onClose={() => { setOauthOpen(false); reload(); }}
          onDone={() => reload()}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="删除账号"
          message={`确定移除「${confirmDel.nickname}」吗？只删除本站保存的凭据，不影响 WorkBuddy App 登录。`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { const a = confirmDel; setConfirmDel(null); run("删除", () => workbuddyApi.deleteAccount(a.id), reload); }}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger }: {
  children: ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`grid h-7 w-7 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100 disabled:opacity-30 ${danger ? "hover:border-rose-300 hover:text-rose-600" : ""}`}>
      {children}
    </button>
  );
}

function SettingRow({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div><div className="text-xs font-medium">{label}</div><p className="mt-0.5 text-[11px] text-paper-500">{desc}</p></div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
