import { useCallback, useEffect, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Play,
  Plus,
  PlugZap,
  Power,
  RefreshCw,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  HistoryRow,
  TriggerStatus,
  TriggerTask,
  triggerApi,
} from "./api";

/**
 * API 用量触发器 /trigger
 * 每日定时向大模型 API 发最小请求，点亮 5 小时用量窗口。
 * 密码门（与彩票运行全部同密码）→ 任务配置 + 执行历史。
 */

/* ---------------- 密码门 ---------------- */

function PasswordGate({ onPass }: { onPass: () => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = () => {
    if (!pwd || loading) return;
    setLoading(true);
    setErr(null);
    triggerApi
      .auth(pwd)
      .then(() => {
        setPwd("");
        onPass();
      })
      .catch((e) => setErr(e.message))
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
            <h1 className="text-lg font-bold text-paper-900">API 用量触发器</h1>
            <p className="text-xs text-paper-700">私有功能 · 验证后可管理定时任务</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-paper-700">
          到点由服务器向大模型 API 发送一次最小请求（自然短句 + 正常 token 数，模拟真实 Agent 调用），
          按「触发时刻 = 窗口重置时刻 − 5 小时」对表，如 06:30 触发 → 11:30 重置。
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
          onClick={submit}
          disabled={loading || !pwd}
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
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

/* ---------------- 状态卡 ---------------- */

function StatusCards({ status }: { status: TriggerStatus | null }) {
  if (!status) return null;
  const cards = [
    { label: "任务总数", value: `${status.tasks_enabled}/${status.tasks_total}`, sub: "启用/全部" },
    { label: "今日已触发", value: `${status.fired_today}/${status.tasks_enabled}`, sub: "成功点亮窗口" },
    { label: "下次触发", value: status.next_fire ? formatDateTime(status.next_fire) : "—", sub: "服务器时间对表" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="glass rounded-2xl p-4 shadow-card">
          <div className="text-[11px] font-medium text-paper-700">{c.label}</div>
          <div className="mt-1 text-xl font-extrabold tabular-nums text-paper-900">{c.value}</div>
          <div className="mt-0.5 text-[10px] text-paper-500">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 任务表单弹框 ---------------- */

const emptyForm = { name: "", time: "06:30", base_url: "", model: "", api_key: "", note: "" };

function TaskModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: TriggerTask | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        time: editing.time,
        base_url: editing.base_url,
        model: editing.model,
        api_key: "",
        note: editing.note,
      });
    } else {
      setForm(emptyForm);
    }
    setErr(null);
    setTestResult(null);
  }, [editing]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const testConnection = () => {
    if (!form.base_url.trim()) {
      setTestResult({ ok: false, msg: "请先填写 API Base URL" });
      return;
    }
    if (!form.api_key.trim()) {
      setTestResult({ ok: false, msg: "请先填写 api-key" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    triggerApi
      .testConnection(form.base_url, form.api_key, form.model)
      .then((r) => setTestResult({ ok: true, msg: r.message }))
      .catch((e) => setTestResult({ ok: false, msg: e.message }))
      .finally(() => setTesting(false));
  };

  const save = () => {
    setSaving(true);
    setErr(null);
    const p = editing
      ? triggerApi.updateTask(editing.id, form)
      : triggerApi.createTask(form);
    p.then(() => {
      onSaved();
      onClose();
    })
      .catch((e) => setErr(e.message))
      .finally(() => setSaving(false));
  };

  const field =
    "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#3d2b1f]/60 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <div
        className="glass max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="flex items-center gap-2 text-base font-bold text-paper-900">
          <AlarmClock size={16} className="text-brand-gold" />
          {editing ? "编辑任务" : "新建任务"}
        </h3>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-paper-700">任务名称 *</label>
            <input className={`mt-1 ${field}`} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="如：早窗口（11:30 重置）" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-paper-700">触发时刻 (HH:MM) *</label>
              <input className={`mt-1 ${field}`} type="time" value={form.time} onChange={(e) => set("time", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-paper-700">模型名</label>
              <input className={`mt-1 ${field}`} value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="如 gpt-4o" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-paper-700">API Base URL *</label>
            <input className={`mt-1 ${field}`} value={form.base_url} onChange={(e) => set("base_url", e.target.value)} placeholder="https://ark.cn-beijing.volces.com/api/coding/v3" />
            <p className="mt-1 text-[11px] leading-relaxed text-paper-700">
              样例：https://ark.cn-beijing.volces.com/api/coding/v3（须以 https:// 开头，勿带末尾斜杠）· 实际请求 {form.base_url || "{base_url}"}/chat/completions
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-paper-700">
              api-key {editing && <span className="text-paper-600">（留空保留原值）</span>}
            </label>
            <input className={`mt-1 ${field}`} type="password" value={form.api_key} onChange={(e) => set("api_key", e.target.value)} placeholder={editing ? editing.api_key_masked : "ark-…"} />
          </div>
          <div>
            <label className="text-xs font-medium text-paper-700">备注</label>
            <input className={`mt-1 ${field}`} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="可选" />
          </div>
        </div>
        {err && (
          <div className="mt-3 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>
        )}
        {testResult && (
          <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${testResult.ok ? "border-emerald-600/25 bg-emerald-50 text-emerald-700" : "border-rose-600/25 bg-rose-50 text-rose-700"}`}>
            {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
            <span className="break-all leading-relaxed">{testResult.msg}</span>
          </div>
        )}
        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={testConnection}
            disabled={testing || saving}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100 disabled:opacity-40"
            title="用当前 Base URL 与 api-key 发一次最小请求验证连通"
          >
            {testing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> 测试中…
              </>
            ) : (
              <>
                <PlugZap size={14} /> 测试连接
              </>
            )}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving || testing} className="rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100 disabled:opacity-40">
              取消
            </button>
            <button onClick={save} disabled={saving || testing} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40">
              {saving ? <><Loader2 size={14} className="animate-spin" /> 保存中…</> : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 确认删除 ---------------- */

function ConfirmModal({ title, message, onCancel, onConfirm }: {
  title: string; message: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3d2b1f]/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="glass w-full max-w-xs rounded-3xl p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-paper-900">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-paper-700">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100">取消</button>
          <button onClick={onConfirm} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700">删除</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 任务表格 ---------------- */

function TaskTable({ tasks, reload, onEdit }: {
  tasks: TriggerTask[];
  reload: () => void;
  onEdit: (t: TriggerTask) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<TriggerTask | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const withBusy = (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    setActionErr(null);
    fn().then(reload).catch((e) => setActionErr(e.message)).finally(() => setBusy(null));
  };

  if (tasks.length === 0) {
    return (
      <div className="glass mt-4 rounded-2xl p-10 text-center shadow-card">
        <AlarmClock size={28} className="mx-auto text-paper-300" />
        <p className="mt-3 text-sm text-paper-700">还没有定时任务，点击右上角「新建任务」开始配置</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {actionErr && (
        <div className="mb-3 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">{actionErr}</div>
      )}
      <div className="glass overflow-hidden rounded-2xl shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-paper-200 text-[11px] uppercase tracking-wide text-paper-600">
                <th className="px-4 py-3 font-medium">任务</th>
                <th className="px-4 py-3 font-medium">触发时刻</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">API</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-paper-100 last:border-0 hover:bg-paper-50/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-paper-900">{t.name}</div>
                    {t.note && <div className="mt-0.5 text-[11px] text-paper-500">{t.note}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 tabular-nums text-paper-900">
                      <Clock size={13} className="text-brand-gold" /> {t.time}
                    </div>
                    <div className="mt-0.5 text-[10px] text-paper-500">下次 {formatDateTime(t.next_fire)}</div>
                  </td>
                  <td className="hidden max-w-[180px] px-4 py-3 sm:table-cell">
                    <div className="truncate text-xs text-paper-700" title={t.base_url}>{t.base_url}</div>
                    {t.model && <div className="text-[10px] text-paper-500">{t.model}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-paper-700">{t.api_key_masked}</td>
                  <td className="px-4 py-3">
                    {t.enabled ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${t.fired_today ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${t.fired_today ? "bg-emerald-500" : "animate-pulse bg-blue-500"}`} />
                        {t.fired_today ? "今日已触发" : "等待触发"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 text-[10px] text-paper-600">
                        已停用
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="立即触发" onClick={() => withBusy(t.id, () => triggerApi.fireNow(t.id))} disabled={busy === t.id || !t.enabled}>
                        {busy === t.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      </IconBtn>
                      <IconBtn title={t.enabled ? "停用" : "启用"} onClick={() => withBusy(t.id, () => triggerApi.toggleTask(t.id, !t.enabled))} disabled={busy === t.id}>
                        <Power size={14} className={t.enabled ? "text-emerald-600" : ""} />
                      </IconBtn>
                      <IconBtn title="编辑" onClick={() => onEdit(t)}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn title="删除" onClick={() => setConfirmDel(t)} danger>
                        <Trash2 size={14} />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {confirmDel && (
        <ConfirmModal
          title="删除任务"
          message={`确定删除「${confirmDel.name}」吗？执行历史会保留。`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => { const id = confirmDel.id; setConfirmDel(null); withBusy(id, () => triggerApi.deleteTask(id)); }}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-8 w-8 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100 hover:text-paper-900 disabled:opacity-30 ${danger ? "hover:border-rose-300 hover:text-rose-600" : ""}`}
    >
      {children}
    </button>
  );
}

/* ---------------- 历史表格 ---------------- */

const STATUS_BADGE: Record<HistoryRow["status"], { label: string; cls: string; icon: React.ReactNode }> = {
  success: { label: "成功", cls: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 size={12} /> },
  failed: { label: "失败", cls: "bg-rose-50 text-rose-700", icon: <XCircle size={12} /> },
  missed: { label: "错过", cls: "bg-amber-50 text-amber-700", icon: <Clock size={12} /> },
};

function formatDateTime(s: string | null | undefined): string {
  // 后端可能返回带毫秒/时区的 ISO 串；统一显示为 YYYY-MM-DD HH:MM:SS（秒固定两位）
  if (!s) return "—";
  // 后端可能返回带毫秒/时区的 ISO 串；统一显示为 YYYY-MM-DD HH:MM:SS
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return s;
}

function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="glass mt-4 rounded-2xl p-10 text-center shadow-card">
        <History size={28} className="mx-auto text-paper-300" />
        <p className="mt-3 text-sm text-paper-700">暂无执行记录</p>
      </div>
    );
  }
  return (
    <div className="glass mt-4 overflow-hidden rounded-2xl shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-paper-200 text-[11px] uppercase tracking-wide text-paper-600">
              <th className="px-4 py-3 font-medium">触发时间</th>
              <th className="px-4 py-3 font-medium">任务</th>
              <th className="px-4 py-3 font-medium">结果</th>
              <th className="hidden px-4 py-3 font-medium sm:table-cell">HTTP / 耗时 / 重试</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">错误详情</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const badge = STATUS_BADGE[r.status];
              return (
                <tr key={r.id} className="border-b border-paper-100 last:border-0 align-top hover:bg-paper-50/60">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-paper-900">
                    {formatDateTime(r.fired_at)}
                    {/* 注意：manual 是 0/1 数字，`0 && <jsx/>` 会把 0 渲染到页面上（表现为秒变三位） */}
                    {!!r.manual && <span className="ml-1.5 rounded bg-brand-red/10 px-1.5 py-0.5 text-[10px] text-brand-red2">手动</span>}
                  </td>
                  <td className="px-4 py-3 font-medium text-paper-900">{r.task_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                      {badge.icon} {badge.label}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 tabular-nums text-xs text-paper-700 sm:table-cell">
                    {r.http_code ?? "—"} · {r.latency_ms != null ? `${Math.round(r.latency_ms)}ms` : "—"} · 重试{r.retries}
                  </td>
                  <td className="hidden max-w-[280px] px-4 py-3 md:table-cell">
                    <div className="truncate text-xs text-paper-600" title={r.error}>{r.error || "—"}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- 主页面 ---------------- */

export default function Trigger() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"tasks" | "history">("tasks");
  const [tasks, setTasks] = useState<TriggerTask[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState<TriggerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; editing: TriggerTask | null }>({ open: false, editing: null });
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([triggerApi.tasks(), triggerApi.status(), triggerApi.history(100)])
      .then(([t, s, h]) => {
        setTasks(t);
        setStatus(s);
        setHistory(h);
      })
      .catch(() => setAuthed(false))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    triggerApi.session().then((valid) => {
      setAuthed(valid);
      if (valid) reload();
    }).catch(() => setAuthed(false));
  }, [reload]);

  if (authed === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-paper-500" />
      </div>
    );
  }

  if (!authed) return <PasswordGate onPass={() => { setAuthed(true); reload(); }} />;

  return (
    <div className="pt-8">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <Zap size={26} className="text-brand-red" /> API 用量触发器
          </h1>
          <p className="mt-1 text-sm text-paper-700">
            每日定时点亮大模型 5 小时用量窗口 · 触发时刻 = 重置时刻 − 5h
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "tasks" && (
            <button
              onClick={() => setModal({ open: true, editing: null })}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
            >
              <Plus size={15} /> 新建任务
            </button>
          )}
          <button
            onClick={reload}
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 bg-paper-100 text-paper-800 transition hover:bg-paper-200"
            title="刷新"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => triggerApi.logout().then(() => setAuthed(false)).catch(() => setAuthed(false))}
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 bg-paper-100 text-paper-800 transition hover:bg-paper-200"
            title="退出登录"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* 状态卡 */}
      <div className="mt-5">
        <StatusCards status={status} />
      </div>

      {/* Tab */}
      <div className="mt-5 flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium w-fit">
        {([["tasks", "任务配置", tasks.length], ["history", "执行历史", history.length]] as const).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition ${
              tab === k ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}
          >
            {k === "tasks" ? <AlarmClock size={14} /> : <History size={14} />}
            {label}
            <span className="rounded-full bg-paper-200 px-1.5 text-[10px] tabular-nums">{n}</span>
          </button>
        ))}
      </div>

      {tab === "tasks" ? (
        <TaskTable
          tasks={tasks}
          reload={reload}
          onEdit={(t) => setModal({ open: true, editing: t })}
        />
      ) : (
        <>
          <HistoryTable rows={historyExpanded ? history : history.slice(0, 20)} />
          {history.length > 20 && (
            <div className="mt-3 text-center">
              <button
                onClick={() => setHistoryExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 px-4 py-2 text-xs text-paper-700 transition hover:bg-paper-200"
              >
                {historyExpanded ? <>收起 <ChevronDown size={13} className="rotate-180" /></> : <>展开全部 {history.length} 条 <ChevronDown size={13} /></>}
              </button>
            </div>
          )}
        </>
      )}

      {modal.open && (
        <TaskModal
          editing={modal.editing}
          onClose={() => setModal({ open: false, editing: null })}
          onSaved={reload}
        />
      )}
    </div>
  );
}
