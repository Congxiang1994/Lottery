import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Story, storyApi } from "./api";
import ApiPanel from "./ApiPanel";

/**
 * 每日儿童睡前故事 · 管理页 /story-admin（私有）
 * 密码门（复用全站操作密码）→ Tab1 故事增删改查 / Tab2 API 管理。
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
    storyApi
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
            <h1 className="text-lg font-bold text-paper-900">睡前故事管理</h1>
            <p className="text-xs text-paper-700">私有功能 · 验证后可增删改查</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-paper-700">
          维护每日睡前故事，并签发 API 密钥，供外部程序（脚本 / 定时任务）通过接口写入。
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

/* ---------------- 通用 ---------------- */

const inputCls =
  "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm text-paper-900 outline-none focus:border-brand-gold/50";

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

function ConfirmModal({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#3d2b1f]/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass w-full max-w-xs rounded-3xl p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-paper-900">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-paper-700">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 故事表单 ---------------- */

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function StoryModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Story | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    story_date: todayStr(),
    content: "",
    summary: "",
    tags: "",
    audio_url: "",
    cover_url: "",
    published: true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setErr(null);
    setForm(
      editing
        ? {
            title: editing.title,
            story_date: editing.story_date,
            content: editing.content,
            summary: editing.summary,
            tags: editing.tags,
            audio_url: editing.audio_url,
            cover_url: editing.cover_url,
            published: editing.published,
          }
        : {
            title: "",
            story_date: todayStr(),
            content: "",
            summary: "",
            tags: "",
            audio_url: "",
            cover_url: "",
            published: true,
          },
    );
  }, [editing]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.title.trim()) return setErr("请填写标题");
    if (!form.content.trim()) return setErr("请填写正文");
    setSaving(true);
    setErr(null);
    const p = editing
      ? storyApi.updateStory(editing.id, form)
      : storyApi.createStory(form);
    p.then(() => {
      onSaved();
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
        className="glass max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="flex items-center gap-2 text-base font-bold text-paper-900">
          <BookOpen size={16} className="text-brand-gold" />
          {editing ? "编辑故事" : "新建故事"}
        </h3>
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div>
              <label className="text-xs font-medium text-paper-700">标题 *</label>
              <input
                className={`mt-1 ${inputCls}`}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="小熊和月亮"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-paper-700">故事日期</label>
              <input
                className={`mt-1 ${inputCls}`}
                type="date"
                value={form.story_date}
                onChange={(e) => set("story_date", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-paper-700">摘要</label>
              <input
                className={`mt-1 ${inputCls}`}
                value={form.summary}
                onChange={(e) => set("summary", e.target.value)}
                placeholder="一句话概括，列表里显示"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-paper-700">标签</label>
              <input
                className={`mt-1 ${inputCls}`}
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="动物,勇气"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-paper-700">
              正文 * <span className="text-paper-500">（保留换行）</span>
            </label>
            <textarea
              className={`mt-1 min-h-[260px] ${inputCls} leading-relaxed`}
              value={form.content}
              onChange={(e) => set("content", e.target.value)}
              placeholder="从前有一只小熊……"
            />
            <p className="mt-1 text-[11px] text-paper-500">
              {form.content.length} 字
            </p>
          </div>

          <details className="rounded-xl border border-paper-200 px-3 py-2">
            <summary className="cursor-pointer text-xs text-paper-700">
              预留字段（音频 / 封面链接）
            </summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-paper-700">音频链接</label>
                <input
                  className={`mt-1 ${inputCls}`}
                  value={form.audio_url}
                  onChange={(e) => set("audio_url", e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-paper-700">封面链接</label>
                <input
                  className={`mt-1 ${inputCls}`}
                  value={form.cover_url}
                  onChange={(e) => set("cover_url", e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
          </details>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-paper-800">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => set("published", e.target.checked)}
              className="h-4 w-4 accent-brand-gold"
            />
            立即发布（取消则保存为草稿，公开页看不到）
          </label>
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

/* ---------------- 主页面 ---------------- */

export default function StoryAdmin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"stories" | "api">("stories");
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [modal, setModal] = useState<{ open: boolean; editing: Story | null }>({
    open: false,
    editing: null,
  });
  const [confirmDel, setConfirmDel] = useState<Story | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    storyApi
      .adminStories()
      .then((d) => setStories(d.items ?? []))
      .catch((e) => {
        if (e.status === 401) setAuthed(false);
        else setErr(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    storyApi
      .session()
      .then((valid) => {
        setAuthed(valid);
        if (valid) reload();
      })
      .catch(() => setAuthed(false));
  }, [reload]);

  const withBusy = (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    setErr(null);
    fn()
      .then(reload)
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(null));
  };

  if (authed === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={22} className="animate-spin text-paper-500" />
      </div>
    );
  }

  if (!authed)
    return (
      <PasswordGate
        onPass={() => {
          setAuthed(true);
          reload();
        }}
      />
    );

  const publishedCount = stories.filter((s) => s.published).length;

  return (
    <div className="pt-8">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <BookOpen size={26} className="text-brand-gold" /> 睡前故事管理
          </h1>
          <p className="mt-1 text-sm text-paper-700">
            共 {stories.length} 篇 · 已发布 {publishedCount} · 草稿{" "}
            {stories.length - publishedCount}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "stories" && (
            <button
              onClick={() => setModal({ open: true, editing: null })}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
            >
              <Plus size={15} /> 新建故事
            </button>
          )}
          <button
            onClick={tab === "stories" ? reload : () => window.location.reload()}
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 bg-paper-100 text-paper-800 transition hover:bg-paper-200"
            title="刷新"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() =>
              storyApi
                .logout()
                .then(() => setAuthed(false))
                .catch(() => setAuthed(false))
            }
            className="grid h-9 w-9 place-items-center rounded-xl border border-paper-200 bg-paper-100 text-paper-800 transition hover:bg-paper-200"
            title="退出登录"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* Tab */}
      <div className="mt-5 flex w-fit items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium">
        {(
          [
            ["stories", "故事管理", stories.length],
            ["api", "API 管理", 0],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition ${
              tab === k ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}
          >
            {k === "stories" ? <BookOpen size={14} /> : <KeyRound size={14} />}
            {label}
            {k === "stories" && (
              <span className="rounded-full bg-paper-200 px-1.5 text-[10px] tabular-nums">
                {n}
              </span>
            )}
          </button>
        ))}
      </div>

      {err && (
        <div className="mt-4 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {err}
        </div>
      )}

      {tab === "api" ? (
        <ApiPanel />
      ) : stories.length === 0 ? (
        <div className="glass mt-4 rounded-2xl p-10 text-center shadow-card">
          <BookOpen size={28} className="mx-auto text-paper-300" />
          <p className="mt-3 text-sm text-paper-700">
            还没有故事，点击右上角「新建故事」开始
          </p>
        </div>
      ) : (
        <div className="glass mt-4 overflow-hidden rounded-2xl shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-paper-200 text-[11px] uppercase tracking-wide text-paper-600">
                  <th className="px-4 py-3 font-medium">日期</th>
                  <th className="px-4 py-3 font-medium">故事</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">
                    来源
                  </th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {stories.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-paper-100 align-top last:border-0 hover:bg-paper-50/60"
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-paper-800">
                      {s.story_date}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-paper-900">{s.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-paper-500">
                        <span>{s.content.length} 字</span>
                        {s.tags && <span className="truncate">{s.tags}</span>}
                        <button
                          onClick={() =>
                            setExpanded((v) => (v === s.id ? null : s.id))
                          }
                          className="inline-flex items-center gap-0.5 text-paper-600 hover:text-paper-900"
                        >
                          {expanded === s.id ? (
                            <>
                              <EyeOff size={11} /> 收起
                            </>
                          ) : (
                            <>
                              <Eye size={11} /> 预览
                            </>
                          )}
                        </button>
                      </div>
                      {expanded === s.id && (
                        <div className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border border-paper-200 bg-paper-50 p-3 text-xs leading-relaxed text-paper-800">
                          {s.content}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => withBusy(s.id, () => storyApi.setPublished(s.id, !s.published))}
                        disabled={busy === s.id}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition disabled:opacity-40 ${
                          s.published
                            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                        }`}
                        title={s.published ? "点击转为草稿" : "点击发布"}
                      >
                        {busy === s.id && <Loader2 size={10} className="animate-spin" />}
                        {s.published ? "已发布" : "草稿"}
                      </button>
                    </td>
                    <td className="hidden px-4 py-3 text-[11px] text-paper-600 sm:table-cell">
                      {s.source || "manual"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn
                          title="编辑"
                          onClick={() => setModal({ open: true, editing: s })}
                        >
                          <Pencil size={14} />
                        </IconBtn>
                        <IconBtn
                          title="删除"
                          onClick={() => setConfirmDel(s)}
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

      {modal.open && (
        <StoryModal
          editing={modal.editing}
          onClose={() => setModal({ open: false, editing: null })}
          onSaved={reload}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          title="删除故事"
          message={`确定删除「${confirmDel.title}」吗？删除后不可恢复。`}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            const id = confirmDel.id;
            setConfirmDel(null);
            withBusy(id, () => storyApi.deleteStory(id));
          }}
        />
      )}
    </div>
  );
}
