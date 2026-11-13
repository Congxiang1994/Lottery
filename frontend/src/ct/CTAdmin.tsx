import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  FileText,
  ImagePlus,
  Link2,
  Pencil,
  Plus,
  ScanLine,
  Trash2,
  Upload,
} from "lucide-react";

import { AdminGate } from "../common/AdminGate";
import { AppModal, ConfirmDialog } from "../common/AppModal";
import { ExitPresence } from "../common/Modal";
import { PageHeader, PrivateBadge } from "../common/PageHeader";
import { Empty, ErrorBlock, errText, Loading } from "../common/State";
import { INPUT, BTN_PRIMARY, BTN_SECONDARY } from "../common/ui";
import { ctAdminApi, type CtExam } from "./api";

/**
 * CT 检查记录管理页 /ct-admin（私有）
 *
 * 密码门用**全站操作密码**（与 /ct 的分享口令分开）——医生拿到分享口令
 * 只能看，改不了记录。管理页负责：
 * - 检查记录增删改查、上移/下移排序
 * - 每次检查的照片上传（二进制直传）/ 删除
 *
 * 数据落 ``ct_exam`` / ``ct_photo`` 表，照片文件在服务器
 * ``/data/lottery/ct_photos/``，重部署不丢。
 */

type FormState = {
  exam_time: string;
  project: string;
  link_label: string;
  link_url: string;
  link_text: string;
  note: string;
};

const EMPTY_FORM: FormState = {
  exam_time: "", project: "", link_label: "", link_url: "", link_text: "", note: "",
};

export default function CTAdmin() {
  return (
    <AdminGate
      title="健康管理"
      subtitle="私有功能 · 全站操作密码"
      desc="维护检查记录与报告照片；分享页 /ct 的分享口令与此独立。"
      probe={() => ctAdminApi.session()}
      login={(pwd) => ctAdminApi.auth(pwd)}
      logout={() => ctAdminApi.logout()}
      accent="sky"
    >
      {({ onUnauthorized }) => <AdminPanel onUnauthorized={onUnauthorized} />}
    </AdminGate>
  );
}

function AdminPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [exams, setExams] = useState<CtExam[]>([]);
  const [stats, setStats] = useState<{ exams: number; photos: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CtExam | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<CtExam | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([ctAdminApi.exams(), ctAdminApi.stats()])
      .then(([items, s]) => {
        setExams(items);
        setStats(s);
      })
      .catch((e) => {
        if ((e as { status?: number })?.status === 401) {
          onUnauthorized();
          return;
        }
        setErr(errText(e));
      })
      .finally(() => setLoading(false));
  }, [onUnauthorized]);

  useEffect(load, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  };

  const withBusy = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (okMsg) flash(okMsg);
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: CtExam) => {
    setEditing(e);
    setFormOpen(true);
  };

  const doDelete = () => {
    if (!confirmDel) return;
    const id = confirmDel.id;
    setConfirmDel(null);
    void withBusy(() => ctAdminApi.deleteExam(id), "已删除检查记录");
  };

  const move = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= exams.length) return;
    const ids = exams.map((e) => e.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void withBusy(() => ctAdminApi.reorder(ids));
  };

  const doUpload = async (examId: number, file: File) => {
    setUploadingFor(examId);
    setErr(null);
    try {
      await ctAdminApi.uploadPhoto(examId, file, "");
      flash("照片已上传");
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setUploadingFor(null);
    }
  };

  const doDeletePhoto = async (examId: number, photoId: number) => {
    void examId;
    await withBusy(() => ctAdminApi.deletePhoto(photoId), "照片已删除");
  };

  return (
    <div className="pt-8">
      <PageHeader
        title="健康管理"
        subtitle="维护检查信息与报告照片 · 分享页 /ct 实时读取"
        icon={ScanLine}
        iconClass="text-brand-blue"
        badge={<PrivateBadge />}
        size="compact"
        actions={
          <button type="button" onClick={openCreate} className={`${BTN_PRIMARY} px-3 py-2 text-xs`}>
            <Plus size={14} /> 新增检查
          </button>
        }
      />

      <div className="mt-6 space-y-4">
        {stats && (
          <div className="glass flex flex-wrap items-center gap-4 rounded-2xl p-4 text-xs text-paper-700 shadow-card">
            <span className="font-semibold text-paper-900">共 {stats.exams} 次检查</span>
            <span>{stats.photos} 张照片</span>
            <span className="text-paper-500">照片存于服务器目录，重部署不丢</span>
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {notice}
          </div>
        )}
        {err && <ErrorBlock message={err} onRetry={load} />}
        {loading && <Loading label="正在加载检查记录…" className="py-16" />}

        {!loading && !err && !exams.length && (
          <div className="glass rounded-3xl shadow-card">
            <Empty text="还没有检查记录" hint="点右上角「新增检查」添加第一次。" />
          </div>
        )}

        {!loading && !err && exams.map((e, i) => (
          <div key={e.id} className="glass rounded-3xl p-5 shadow-card">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-blue/12 px-2.5 py-1 text-[11px] font-bold text-brand-blue">
                    第 {i + 1} 次
                  </span>
                  {e.exam_time && (
                    <span className="flex items-center gap-1 text-xs tabular-nums text-paper-700">
                      <CalendarDays size={13} /> {e.exam_time}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-sm font-semibold text-paper-900">{e.project || "（未填项目）"}</div>
                {e.link_label && (
                  <div className="mt-1 flex items-center gap-1 truncate text-xs text-paper-600">
                    <Link2 size={12} /> {e.link_label}
                  </div>
                )}
                {e.link_text && <div className="mt-1 text-xs text-paper-600">{e.link_text}</div>}
                {e.note && <div className="mt-1 whitespace-pre-wrap text-xs text-paper-600">{e.note}</div>}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title="上移"
                  aria-label="上移"
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                  className="press grid h-8 w-8 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:bg-paper-100 disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  title="下移"
                  aria-label="下移"
                  disabled={busy || i === exams.length - 1}
                  onClick={() => move(i, 1)}
                  className="press grid h-8 w-8 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:bg-paper-100 disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  title="编辑"
                  aria-label="编辑"
                  disabled={busy}
                  onClick={() => openEdit(e)}
                  className="press grid h-8 w-8 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:bg-paper-100 disabled:opacity-30"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  title="删除"
                  aria-label="删除"
                  disabled={busy}
                  onClick={() => setConfirmDel(e)}
                  className="press grid h-8 w-8 place-items-center rounded-lg border border-paper-200 text-rose-600 transition hover:bg-rose-50 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* 照片区 */}
            <div className="mt-4 border-t border-paper-100 pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-paper-600">
                <ImagePlus size={13} />
                报告照片
                <span className="text-paper-500">· {e.photos.length} 张</span>
              </div>
              {e.photos.length > 0 && (
                <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {e.photos.map((p) => (
                    <div key={p.id} className="group relative overflow-hidden rounded-xl border border-paper-200 bg-white">
                      <img src={p.url} alt={p.caption || "报告照片"} className="h-28 w-full object-cover" />
                      <button
                        type="button"
                        title="删除照片"
                        aria-label="删除照片"
                        disabled={busy}
                        onClick={() => void doDeletePhoto(e.id, p.id)}
                        className="press absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-30"
                      >
                        <Trash2 size={12} />
                      </button>
                      {p.caption && (
                        <div className="truncate px-2 py-1 text-[10px] text-paper-600">{p.caption}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <label className={`${BTN_SECONDARY} inline-flex cursor-pointer px-3 py-2 text-xs`}>
                {uploadingFor === e.id ? <Upload size={14} className="animate-spin" /> : <Plus size={14} />}
                {uploadingFor === e.id ? "上传中…" : "添加照片"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={busy || uploadingFor !== null}
                  onChange={(ev) => {
                    const f = ev.target.files?.[0];
                    if (f) void doUpload(e.id, f);
                    ev.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* 新增 / 编辑表单 */}
      <ExitPresence open={formOpen}>
        {formOpen && (
          <ExamForm
            editing={editing}
            busy={busy}
            onClose={() => setFormOpen(false)}
            onSave={async (data) => {
              setBusy(true);
              setErr(null);
              try {
                if (editing) await ctAdminApi.updateExam(editing.id, data);
                else await ctAdminApi.createExam(data);
                setFormOpen(false);
                flash(editing ? "已保存修改" : "已新增检查");
                await load();
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </ExitPresence>

      <ExitPresence open={confirmDel !== null}>
        {confirmDel !== null && (
          <ConfirmDialog
            title="删除检查记录"
            message={`确定删除「${confirmDel.project || confirmDel.exam_time || "这次检查"}」吗？该次检查下的照片会一并删除，不可恢复。`}
            onCancel={() => setConfirmDel(null)}
            onConfirm={doDelete}
            busy={busy}
          />
        )}
      </ExitPresence>
    </div>
  );
}

/** 新增/编辑表单（字段与后端 ct_exam 一一对应） */
function ExamForm({
  editing,
  busy,
  onClose,
  onSave,
}: {
  editing: CtExam | null;
  busy: boolean;
  onClose: () => void;
  onSave: (data: FormState) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    exam_time: editing?.exam_time || "",
    project: editing?.project || "",
    link_label: editing?.link_label || "",
    link_url: editing?.link_url || "",
    link_text: editing?.link_text || "",
    note: editing?.note || "",
  }));

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AppModal
      onClose={onClose}
      title={<><FileText size={16} className="text-brand-blue" /> {editing ? "编辑检查记录" : "新增检查记录"}</>}
      description="填写检查信息；照片保存后在本页单独上传。"
      size="md"
      dismissable={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`${BTN_SECONDARY} px-4 py-2 text-sm`}>
            取消
          </button>
          <button
            type="button"
            disabled={busy || (!form.exam_time.trim() && !form.project.trim())}
            onClick={() => void onSave(form)}
            className={`${BTN_PRIMARY} px-4 py-2 text-sm`}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <Field label="检查时间" hint="如 2026-11-10 18:56:38">
          <input className={INPUT} value={form.exam_time} onChange={set("exam_time")} placeholder="2026-11-10 18:56:38" />
        </Field>
        <Field label="检查项目">
          <input className={INPUT} value={form.project} onChange={set("project")} placeholder="CT胸部（内科）" />
        </Field>
        <Field label="影像链接显示文字">
          <input className={INPUT} value={form.link_label} onChange={set("link_label")} placeholder="2026-11-10 影像报告" />
        </Field>
        <Field label="影像链接 URL" hint="https://… 打开报告/影像的链接">
          <input className={INPUT} value={form.link_url} onChange={set("link_url")} placeholder="https://…" />
        </Field>
        <Field label="影像链接备注" hint="如「身份证后6位：255617」，没有链接时也可单独填">
          <input className={INPUT} value={form.link_text} onChange={set("link_text")} placeholder="选填" />
        </Field>
        <Field label="备注">
          <textarea className={`${INPUT} min-h-[72px] resize-y`} value={form.note} onChange={set("note")} placeholder="选填" />
        </Field>
      </div>
    </AppModal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-paper-700">
        {label}
        {hint && <span className="ml-1.5 font-normal text-paper-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
