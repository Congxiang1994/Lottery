import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BookText,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  ApiDoc,
  CallRow,
  CallsSummary,
  StoryKey,
  copyText,
  storyApi,
} from "./api";

/**
 * 「API 管理」Tab：密钥管理 + 接口定义 + curl 样例 + 调用次数与日志。
 * 密钥为明文策略（本功能仅用于管理家里的故事），页面默认打码、点眼睛显示、可一键复制。
 */

const METHOD_CLS: Record<string, string> = {
  GET: "bg-blue-50 text-blue-700",
  POST: "bg-emerald-50 text-emerald-700",
  PUT: "bg-amber-50 text-amber-700",
  DELETE: "bg-rose-50 text-rose-700",
};

function statusCls(code: number | null): string {
  if (code == null) return "bg-paper-100 text-paper-700";
  if (code < 300) return "bg-emerald-50 text-emerald-700";
  if (code < 500) return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

function CopyBtn({ text, label = "" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() =>
        copyText(text).then((ok) => {
          if (ok) {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }
        })
      }
      title="复制"
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-paper-200 bg-white/50 px-2 text-xs text-paper-700 transition hover:bg-paper-100 hover:text-paper-900"
    >
      {done ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
      {label && <span>{done ? "已复制" : label}</span>}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-paper-700">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-paper-600">{hint}</p>}
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";

/* ---------------- 密钥新建 / 编辑 ---------------- */

function KeyModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: StoryKey | null;
  onClose: () => void;
  onSaved: (created?: StoryKey) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    daily_quota: "1000",
    total_quota: "0",
    note: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setErr(null);
    setForm(
      editing
        ? {
            name: editing.name,
            daily_quota: String(editing.daily_quota),
            total_quota: String(editing.total_quota),
            note: editing.note,
          }
        : { name: "", daily_quota: "1000", total_quota: "0", note: "" },
    );
  }, [editing]);

  const save = () => {
    if (!form.name.trim()) {
      setErr("请填写密钥名称");
      return;
    }
    setSaving(true);
    setErr(null);
    const payload = {
      name: form.name.trim(),
      daily_quota: Number(form.daily_quota) || 0,
      total_quota: Number(form.total_quota) || 0,
      note: form.note.trim(),
    };
    const p = editing
      ? storyApi.updateKey(editing.id, payload)
      : storyApi.createKey(payload);
    p.then((k) => {
      onSaved(editing ? undefined : k);
      onClose();
    })
      .catch((e) => setErr(e.message))
      .finally(() => setSaving(false));
  };

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
          <KeyRound size={16} className="text-brand-gold" />
          {editing ? "编辑密钥" : "新建密钥"}
        </h3>
        <div className="mt-4 space-y-3">
          <Field label="名称 *" hint="用于区分调用方，如「每日生成脚本」">
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="每日生成脚本"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="每日上限" hint="0 = 不限">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={form.daily_quota}
                onChange={(e) =>
                  setForm((f) => ({ ...f, daily_quota: e.target.value }))
                }
              />
            </Field>
            <Field label="累计上限" hint="0 = 不限">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={form.total_quota}
                onChange={(e) =>
                  setForm((f) => ({ ...f, total_quota: e.target.value }))
                }
              />
            </Field>
          </div>
          <Field label="备注">
            <input
              className={inputCls}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="可选"
            />
          </Field>
        </div>
        {err && (
          <div className="mt-3 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {err}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100 disabled:opacity-40"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" /> 保存中…
              </>
            ) : (
              "保存"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 汇总卡 ---------------- */

function SummaryCards({ s }: { s: CallsSummary | null }) {
  const cards = [
    { label: "启用密钥", value: s ? `${s.keys_enabled}/${s.keys_total}` : "—", sub: "启用/全部" },
    { label: "今日调用", value: s ? String(s.calls_today) : "—", sub: s?.today ?? "" },
    {
      label: `近 ${s?.window_days ?? 7} 日调用`,
      value: s ? String(s.calls_window) : "—",
      sub: "全密钥合计",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="glass rounded-2xl p-4 shadow-card">
          <div className="text-[11px] font-medium text-paper-700">{c.label}</div>
          <div className="mt-1 text-xl font-extrabold tabular-nums text-paper-900">
            {c.value}
          </div>
          <div className="mt-0.5 text-[10px] text-paper-500">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 主面板 ---------------- */

export default function ApiPanel() {
  const [keys, setKeys] = useState<StoryKey[]>([]);
  const [summary, setSummary] = useState<CallsSummary | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [doc, setDoc] = useState<ApiDoc | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [modal, setModal] = useState<{ open: boolean; editing: StoryKey | null }>({
    open: false,
    editing: null,
  });
  const [confirmDel, setConfirmDel] = useState<StoryKey | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [logKeyId, setLogKeyId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([storyApi.keys(), storyApi.calls(50), storyApi.apiDoc()])
      .then(([k, c, d]) => {
        setKeys(k.keys);
        setSummary(k.summary);
        setCalls(c.calls);
        setDoc(d);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const reloadLogs = useCallback(
    (keyId?: number) => {
      storyApi
        .calls(50, keyId)
        .then((c) => {
          setCalls(c.calls);
          setSummary(c.summary);
        })
        .catch((e) => setErr(e.message));
    },
    [],
  );

  useEffect(() => reload(), [reload]);

  const withBusy = (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    setErr(null);
    fn()
      .then(() => reload())
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(null));
  };

  const firstSecret = keys.find((k) => revealed[k.id])?.api_key;
  const sample = doc?.curl_samples[sampleIdx];
  const renderedSample = sample
    ? sample.curl
        .split("{BASE_URL}")
        .join(window.location.origin)
        .split("{API_KEY}")
        .join(firstSecret ?? "$STORY_KEY")
    : "";

  return (
    <div className="mt-4 space-y-8">
      {err && (
        <div className="rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {err}
        </div>
      )}

      {/* 调用次数总览 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Activity size={15} className="text-brand-gold" />
          <h3 className="text-sm font-bold text-paper-900">调用次数</h3>
        </div>
        <SummaryCards s={summary} />
      </section>

      {/* 密钥管理 */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-brand-gold" />
            <h3 className="text-sm font-bold text-paper-900">API 密钥</h3>
            <span className="rounded-full bg-paper-200 px-1.5 text-[10px] tabular-nums text-paper-700">
              {keys.length}
            </span>
          </div>
          <button
            onClick={() => setModal({ open: true, editing: null })}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-3.5 py-2 text-xs font-semibold text-white shadow-glow transition hover:opacity-90"
          >
            <Plus size={14} /> 新建密钥
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center shadow-card">
            <KeyRound size={26} className="mx-auto text-paper-300" />
            <p className="mt-3 text-sm text-paper-700">
              还没有密钥，新建一个就能用 API 增删改查故事
            </p>
          </div>
        ) : (
          <div className="glass overflow-hidden rounded-2xl shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-paper-200 text-[11px] uppercase tracking-wide text-paper-600">
                    <th className="px-4 py-3 font-medium">名称</th>
                    <th className="px-4 py-3 font-medium">密钥</th>
                    <th className="px-4 py-3 font-medium">调用</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">
                      配额
                    </th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">
                      最后调用
                    </th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr
                      key={k.id}
                      className="border-b border-paper-100 align-top last:border-0 hover:bg-paper-50/60"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-paper-900">{k.name}</div>
                        {k.note && (
                          <div className="mt-0.5 text-[11px] text-paper-500">
                            {k.note}
                          </div>
                        )}
                        {!k.enabled && (
                          <span className="mt-1 inline-block rounded-full bg-paper-100 px-2 py-0.5 text-[10px] text-paper-600">
                            已停用
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <code className="max-w-[190px] truncate font-mono text-[11px] text-paper-800">
                            {revealed[k.id]
                              ? k.api_key
                              : `${k.key_prefix}${"•".repeat(16)}`}
                          </code>
                          <button
                            onClick={() =>
                              setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))
                            }
                            title={revealed[k.id] ? "隐藏" : "显示明文"}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-paper-200 text-paper-600 transition hover:bg-paper-100 hover:text-paper-900"
                          >
                            {revealed[k.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                          <CopyBtn text={k.api_key} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-paper-900">
                        <div className="text-xs">
                          今日 <span className="font-semibold">{k.calls_today}</span>
                        </div>
                        <div className="text-[11px] text-paper-600">
                          累计 {k.calls_total}
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-paper-700 md:table-cell">
                        <div>日 {k.daily_quota || "不限"}</div>
                        <div className="text-[11px] text-paper-500">
                          共 {k.total_quota || "不限"}
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-[11px] text-paper-600 lg:table-cell">
                        {k.last_used_at || "—"}
                        {k.last_used_ip && (
                          <div className="text-paper-500">{k.last_used_ip}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <IconBtn
                            title={k.enabled ? "停用" : "启用"}
                            onClick={() =>
                              withBusy(k.id, () => storyApi.toggleKey(k.id, !k.enabled))
                            }
                            disabled={busy === k.id}
                          >
                            <Power
                              size={14}
                              className={k.enabled ? "text-emerald-600" : ""}
                            />
                          </IconBtn>
                          <IconBtn
                            title="重置调用计数"
                            onClick={() =>
                              withBusy(k.id, () =>
                                storyApi.resetKeyCalls(k.id, "today"),
                              )
                            }
                            disabled={busy === k.id}
                          >
                            {busy === k.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RotateCcw size={14} />
                            )}
                          </IconBtn>
                          <IconBtn
                            title="编辑"
                            onClick={() => setModal({ open: true, editing: k })}
                          >
                            <Pencil size={14} />
                          </IconBtn>
                          <IconBtn
                            title="删除"
                            onClick={() => setConfirmDel(k)}
                            danger
                          >
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
        )}
      </section>

      {/* 接口定义 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <BookText size={15} className="text-brand-gold" />
          <h3 className="text-sm font-bold text-paper-900">接口定义</h3>
          {doc && (
            <span className="text-[11px] text-paper-600">
              鉴权请求头{" "}
              <code className="font-mono text-paper-800">{doc.auth_header}</code>
            </span>
          )}
        </div>
        <div className="glass overflow-hidden rounded-2xl shadow-card">
          <div className="divide-y divide-paper-100">
            {(doc?.endpoints ?? []).map((e) => (
              <div key={`${e.method} ${e.path}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${METHOD_CLS[e.method] ?? "bg-paper-100 text-paper-700"}`}
                  >
                    {e.method}
                  </span>
                  <code className="font-mono text-xs text-paper-900">{e.path}</code>
                  <span className="text-xs text-paper-700">{e.summary}</span>
                </div>
                {e.params.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 pl-1">
                    {e.params.map((p) => (
                      <div key={p.name} className="text-[11px] text-paper-600">
                        <code className="font-mono text-paper-800">{p.name}</code>
                        <span className="text-paper-500"> ({p.in})</span>
                        {" · "}
                        {p.required === "是" ? (
                          <span className="text-rose-600">必填</span>
                        ) : (
                          "可选"
                        )}
                        {" · "}
                        {p.desc}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!doc && (
              <div className="px-4 py-6 text-center text-sm text-paper-600">
                加载中…
              </div>
            )}
          </div>
        </div>

        {doc && (
          <div className="mt-3 glass overflow-hidden rounded-2xl shadow-card">
            <div className="border-b border-paper-200 px-4 py-2.5 text-xs font-semibold text-paper-900">
              请求体字段（POST / PUT）
            </div>
            <div className="divide-y divide-paper-100">
              {doc.story_fields.map((f) => (
                <div key={f.name} className="flex flex-wrap gap-x-3 px-4 py-2">
                  <code className="min-w-[92px] font-mono text-xs text-paper-900">
                    {f.name}
                  </code>
                  <span className="text-[11px] text-paper-500">{f.type}</span>
                  <span
                    className={`text-[11px] ${f.required === "是" ? "text-rose-600" : "text-paper-500"}`}
                  >
                    {f.required === "是" ? "必填" : "可选"}
                  </span>
                  <span className="flex-1 text-[11px] text-paper-700">{f.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {doc && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1">
            {doc.status_codes.map((s) => (
              <span key={s.code} className="text-[11px] text-paper-600">
                <code className="font-mono text-paper-800">{s.code}</code> {s.desc}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 调用样例 */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Terminal size={15} className="text-brand-gold" />
            <h3 className="text-sm font-bold text-paper-900">调用样例</h3>
          </div>
          <CopyBtn text={renderedSample} label="复制" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(doc?.curl_samples ?? []).map((s, i) => (
            <button
              key={s.title}
              onClick={() => setSampleIdx(i)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                sampleIdx === i
                  ? "bg-paper-900 text-white"
                  : "border border-paper-200 bg-paper-100 text-paper-700 hover:bg-paper-200"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
        {sample && (
          <>
            <p className="mt-2.5 text-[11px] leading-relaxed text-paper-600">
              {sample.desc}
              {!firstSecret && (
                <span className="ml-1 text-amber-700">
                  （点上方密钥的眼睛图标，样例会自动带入真实密钥）
                </span>
              )}
            </p>
            <pre className="mt-2 overflow-x-auto rounded-2xl border border-paper-200 bg-[#fbf8f3] p-4 font-mono text-[11px] leading-relaxed text-paper-900">
              {renderedSample}
            </pre>
          </>
        )}
        {doc && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-paper-700 hover:text-paper-900">
              Python 调用示例
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-2xl border border-paper-200 bg-[#fbf8f3] p-4 font-mono text-[11px] leading-relaxed text-paper-900">
              {doc.python_sample
                .split("{BASE_URL}")
                .join(window.location.origin)
                .split("{API_KEY}")
                .join(firstSecret ?? "$STORY_KEY")}
            </pre>
          </details>
        )}
      </section>

      {/* 调用日志 */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-brand-gold" />
            <h3 className="text-sm font-bold text-paper-900">调用日志</h3>
            <span className="text-[11px] text-paper-600">近 50 条</span>
          </div>
          <select
            value={logKeyId}
            onChange={(e) => {
              const v = e.target.value === "" ? "" : Number(e.target.value);
              setLogKeyId(v);
              reloadLogs(v === "" ? undefined : v);
            }}
            className="rounded-xl border border-paper-200 bg-white/60 px-3 py-1.5 text-xs text-paper-800 outline-none focus:border-brand-gold/50"
          >
            <option value="">全部密钥</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>

        {calls.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center shadow-card">
            <Activity size={26} className="mx-auto text-paper-300" />
            <p className="mt-3 text-sm text-paper-700">
              还没有调用记录（无效密钥的探测不计数、也不记日志）
            </p>
          </div>
        ) : (
          <div className="glass overflow-hidden rounded-2xl shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-paper-200 text-[11px] uppercase tracking-wide text-paper-600">
                    <th className="px-4 py-2.5 font-medium">时间</th>
                    <th className="px-4 py-2.5 font-medium">密钥</th>
                    <th className="px-4 py-2.5 font-medium">请求</th>
                    <th className="px-4 py-2.5 font-medium">状态</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
                      耗时 / IP
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-paper-100 last:border-0 hover:bg-paper-50/60"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-paper-800">
                        {c.ts?.replace(/^\d{2}(\d{2})-/, "$1-")}
                      </td>
                      <td className="px-4 py-2.5 text-paper-800">{c.key_name || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[11px] text-paper-700">
                          {c.method} {c.path}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusCls(c.status_code)}`}
                        >
                          {c.status_code ?? "—"}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-2.5 tabular-nums text-paper-600 sm:table-cell">
                        {c.latency_ms != null ? `${Math.round(c.latency_ms)}ms` : "—"}
                        {c.ip && <span className="text-paper-500"> · {c.ip}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {loading && (
        <div className="flex justify-center">
          <Loader2 size={16} className="animate-spin text-paper-400" />
        </div>
      )}

      {modal.open && (
        <KeyModal
          editing={modal.editing}
          onClose={() => setModal({ open: false, editing: null })}
          onSaved={(created) => {
            if (created) setRevealed((r) => ({ ...r, [created.id]: true }));
            reload();
          }}
        />
      )}

      {confirmDel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3d2b1f]/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDel(null)}
        >
          <div
            className="glass w-full max-w-xs rounded-3xl p-6 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-paper-900">删除密钥</h3>
            <p className="mt-2 text-xs leading-relaxed text-paper-700">
              确定删除「{confirmDel.name}」吗？删除后该密钥立即失效，调用日志会保留。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDel(null)}
                className="rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const id = confirmDel.id;
                  setConfirmDel(null);
                  withBusy(id, () => storyApi.deleteKey(id));
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
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
