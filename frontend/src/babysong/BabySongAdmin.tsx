import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
  Download,
  DownloadCloud,
  Loader2,
  LogOut,
  Music,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * 儿歌下载管理页 /babysong-admin（私有，密码保护，同触发器会话模式）
 * 展示 518 首歌的本地下载状态：已下载 / 下载中 / 队列 / 失败 / 未下载；
 * 可单曲或批量触发下载（后台 yt-dlp 走代理串行下载），轮询进度，
 * 爬取完成后播放列表页（/babysong）窗口聚焦时自动刷新出现「本地」按钮。
 */

type Status = "done" | "downloading" | "pending" | "failed" | "none";

interface DlItem {
  id: string;
  title: string;
  youtube_url: string;
  status: Status;
  has_file: boolean;
  size_bytes: number;
  duration_s: number;
  error: string;
  updated_at: string;
}

interface DlResp {
  counts: Record<string, number>;
  busy: boolean;
  items: DlItem[];
}

const BASE = "/api/babysong/admin";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: "same-origin",
    ...init,
  });
  if (res.status === 401) {
    const err = new Error("401") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d.detail ?? "")
      .catch(() => "");
    throw new Error(detail || `请求失败 ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function fmtSize(bytes: number) {
  if (!bytes) return "—";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDur(sec: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  done: { label: "已下载", cls: "bg-emerald-50 text-emerald-700" },
  downloading: { label: "下载中", cls: "bg-blue-50 text-blue-700" },
  pending: { label: "队列中", cls: "bg-amber-50 text-amber-700" },
  failed: { label: "失败", cls: "bg-red-50 text-red-700" },
  none: { label: "未下载", cls: "bg-paper-100 text-paper-600" },
};

export default function BabySongAdmin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [data, setData] = useState<DlResp | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"all" | Status>("all");
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* 会话探测 */
  useEffect(() => {
    fetch(`${BASE}/session`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setAuthed(!!d.valid))
      .catch(() => setAuthed(false));
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await request<DlResp>("/downloads");
      setData(d);
      setError("");
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.status === 401) {
        setAuthed(false);
      } else {
        setError(err.message || "加载失败");
      }
    }
  }, []);

  /* 首次加载 + 有任务时轮询（3s），空闲时停轮询 */
  useEffect(() => {
    if (!authed) return;
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [authed, load]);

  useEffect(() => {
    const active =
      !!data && (data.busy || data.counts.downloading > 0 || data.counts.pending > 0);
    if (active && !pollRef.current) {
      pollRef.current = setInterval(load, 3000);
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current && !active) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [data, load]);

  /* 播放列表页联动提示：下载全部完成时提醒回列表页 */
  const justFinished = useRef(false);
  useEffect(() => {
    if (data && justFinished.current && data.counts.downloading === 0 && data.counts.pending === 0) {
      justFinished.current = false;
      setToast("全部下载完成，打开 /babysong 即可看到新的「本地」按钮");
    }
  }, [data]);

  const doAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      await request("/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setAuthed(true);
      setPassword("");
    } catch (err) {
      setAuthError((err as Error).message || "验证失败");
    } finally {
      setAuthBusy(false);
    }
  };

  const doLogout = async () => {
    await request("/logout", { method: "POST" }).catch(() => {});
    setAuthed(false);
    setData(null);
  };

  const download = async (ids: string[]) => {
    if (!ids.length) return;
    setActionBusy(true);
    try {
      await request("/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      justFinished.current = true;
      await load();
      setToast(ids.length === 1 ? "已加入下载队列" : `已加入 ${ids.length} 首到下载队列`);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) setAuthed(false);
      else setToast(err.message || "触发下载失败");
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return tab === "all" ? data.items : data.items.filter((x) => x.status === tab);
  }, [data, tab]);

  if (authed === null) {
    return (
      <div className="grid place-items-center py-32 text-paper-500">
        <Loader2 size={26} className="animate-spin" />
      </div>
    );
  }

  /* ===== 密码门 ===== */
  if (!authed) {
    return (
      <div className="grid place-items-center py-24">
        <form
          onSubmit={doAuth}
          className="w-full max-w-sm rounded-2xl border border-paper-200 bg-paper-50 p-7 shadow-sm"
        >
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand-red/10 text-brand-red2">
              <DownloadCloud size={22} />
            </div>
            <h1 className="text-lg font-bold">儿歌下载管理</h1>
            <p className="mt-1 text-xs text-paper-600">私有功能，请输入操作密码（同触发器）</p>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="操作密码"
            autoFocus
            className="w-full rounded-xl border border-paper-200 bg-paper-50 px-4 py-2.5 text-sm outline-none transition focus:border-brand-red/50 focus:bg-white"
          />
          {authError && <p className="mt-2 text-xs text-red-600">{authError}</p>}
          <button
            type="submit"
            disabled={authBusy || !password}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
          >
            {authBusy ? <Loader2 size={15} className="animate-spin" /> : null} 解锁
          </button>
          <Link
            to="/babysong"
            className="mt-4 block text-center text-xs text-paper-500 transition hover:text-brand-red"
          >
            ← 返回儿歌列表
          </Link>
        </form>
      </div>
    );
  }

  /* ===== 管理主界面 ===== */
  const counts = data?.counts ?? {};
  const pendingIds = (data?.items ?? [])
    .filter((x) => x.status === "none" || x.status === "failed")
    .map((x) => x.id);
  const hasActive = (counts.downloading ?? 0) + (counts.pending ?? 0) > 0 || !!data?.busy;

  return (
    <div className="pt-10">
      {/* Hero */}
      <section className="text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-paper-200 bg-paper-100 px-4 py-1.5 text-xs text-paper-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          私有 · 密码保护
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          <span className="gradient-text">儿歌下载</span> 管理
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-paper-700">
          用 yt-dlp 把 YouTube 儿歌爬取到服务器本地（/data/song），
          下载完成的歌会自动在播放列表页出现「本地」按钮，站内秒开不跳转。
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            onClick={() => download(pendingIds)}
            disabled={actionBusy || !pendingIds.length}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <DownloadCloud size={16} />
            下载全部待下载（{pendingIds.length}）
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-paper-200 px-4 py-2.5 text-sm font-medium text-paper-700 transition hover:border-brand-red/50 hover:bg-white"
          >
            <RefreshCw size={15} /> 刷新
          </button>
          <Link
            to="/babysong"
            className="inline-flex items-center gap-2 rounded-xl border border-paper-200 px-4 py-2.5 text-sm font-medium text-paper-700 transition hover:border-brand-red/50 hover:bg-white"
          >
            <Music size={15} /> 播放列表
          </Link>
          <button
            onClick={doLogout}
            title="退出登录"
            className="inline-flex items-center gap-1.5 rounded-xl border border-paper-200 px-3.5 py-2.5 text-sm text-paper-600 transition hover:border-red-300 hover:text-red-600"
          >
            <LogOut size={15} />
          </button>
        </div>
        {hasActive && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-xs font-medium text-blue-700">
            <Loader2 size={13} className="animate-spin" />
            下载进行中：{counts.downloading ?? 0} 个任务，队列 {counts.pending ?? 0} 个（每 3 秒自动刷新）
          </div>
        )}
      </section>

      {/* 统计卡片 */}
      <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="总数" value={counts.total ?? 0} icon={<Music size={15} />} tone="text-paper-700" />
        <StatCard label="已下载" value={counts.done ?? 0} icon={<CheckCircle2 size={15} />} tone="text-emerald-600" />
        <StatCard label="下载中" value={counts.downloading ?? 0} icon={<Loader2 size={15} />} tone="text-blue-600" spin={(counts.downloading ?? 0) > 0} />
        <StatCard label="队列中" value={counts.pending ?? 0} icon={<Clock size={15} />} tone="text-amber-600" />
        <StatCard label="失败" value={counts.failed ?? 0} icon={<TriangleAlert size={15} />} tone="text-red-600" />
      </div>

      {/* 状态筛选 */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
        {(["all", "done", "downloading", "pending", "failed", "none"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 font-medium transition ${
              tab === t
                ? "bg-brand-red text-white shadow-glow"
                : "border border-paper-200 bg-paper-50 text-paper-700 hover:bg-white"
            }`}
          >
            {t === "all"
              ? `全部 ${counts.total ?? 0}`
              : `${STATUS_META[t].label} ${counts[t] ?? 0}`}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="mx-auto mt-5 max-w-4xl">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-10 text-center text-sm text-red-700">
            {error}
          </div>
        )}
        {!error && !data && (
          <div className="grid place-items-center py-20 text-paper-500">
            <Loader2 size={24} className="animate-spin" />
          </div>
        )}
        {!error && data && filtered.length === 0 && (
          <div className="rounded-2xl border border-paper-200 bg-paper-50 px-5 py-12 text-center text-sm text-paper-700">
            这个状态下暂无歌曲
          </div>
        )}
        {!error && filtered.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-paper-200 bg-paper-50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-paper-200 bg-paper-100/60 text-left text-xs text-paper-600">
                  <th className="px-4 py-2.5 font-medium">编号</th>
                  <th className="px-4 py-2.5 font-medium">歌名</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">大小</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">时长</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((x) => (
                  <tr key={x.id} className="border-b border-paper-100 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs text-paper-500">{x.id}</td>
                    <td className="max-w-[16rem] px-4 py-2.5">
                      <span className="block truncate font-medium text-paper-900" title={x.title}>
                        {x.title}
                      </span>
                      {x.error && (
                        <span className="block truncate text-[11px] text-red-600" title={x.error}>
                          {x.error}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_META[x.status].cls}`}
                      >
                        {x.status === "downloading" && (
                          <Loader2 size={10} className="animate-spin" />
                        )}
                        {STATUS_META[x.status].label}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2.5 tabular-nums text-paper-600 sm:table-cell">
                      {fmtSize(x.size_bytes)}
                    </td>
                    <td className="hidden px-4 py-2.5 tabular-nums text-paper-600 sm:table-cell">
                      {fmtDur(x.duration_s)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {x.status === "done" ? (
                        <a
                          href={`/song/${x.id}.mp4`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-emerald-600 hover:underline"
                        >
                          查看视频
                        </a>
                      ) : x.status === "downloading" || x.status === "pending" ? (
                        <span className="text-xs text-paper-400">等待完成…</span>
                      ) : (
                        <button
                          onClick={() => download([x.id])}
                          disabled={actionBusy}
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-red/40 px-2.5 py-1 text-xs font-semibold text-brand-red transition hover:bg-brand-red/10 disabled:opacity-40"
                        >
                          {x.status === "failed" ? (
                            <>
                              <RotateCcw size={11} /> 重试
                            </>
                          ) : (
                            <>
                              <Download size={11} /> 下载
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-paper-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg">
          <button onClick={() => setToast("")} className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
  spin,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  spin?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-paper-200 bg-paper-50 px-4 py-3">
      <div className={`flex items-center gap-1.5 text-xs ${tone}`}>
        <span className={spin ? "animate-spin" : ""}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-paper-900">{value}</div>
    </div>
  );
}
