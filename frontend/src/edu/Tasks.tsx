import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { XCircle, Loader2, PlayCircle } from "lucide-react";
import { Api, type TaskGroup, statusLabel, fmtSize } from "./api";

const STATUS_COLOR: Record<string, string> = {
  done: "#16a34a",
  error: "#dc2626",
  running: "#2563eb",
  cancelled: "#6b7280",
  downloading: "#2563eb",
  pending: "#9ca3af",
};

export default function Tasks() {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const g = await Api.tasks();
        if (alive) {
          setGroups(g || []);
          setLoaded(true);
        }
      } catch {
        /* ignore */
      }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const stats = (() => {
    const m: Record<string, number> = {};
    groups.forEach((g) => {
      m[g.status] = (m[g.status] || 0) + g.total;
    });
    return Object.entries(m).map(([name, value]) => ({
      name: statusLabel(name),
      value,
      color: STATUS_COLOR[name] || "#9ca3af",
    }));
  })();

  const cancel = async (id: string) => {
    await Api.cancelTask(id);
  };

  return (
    <div className="animate-rise space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">下载任务</h2>
          <p className="mt-0.5 text-sm text-white/45">实时进度自动刷新</p>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="glass grid grid-cols-1 items-center gap-4 rounded-2xl p-4 md:grid-cols-[260px_1fr]">
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3}>
                  {stats.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3">
            {stats.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                <span className="text-white/60">{s.name}</span>
                <span className="font-semibold text-white">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center justify-center py-14 text-white/40">
          <Loader2 size={20} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : groups.length === 0 ? (
        <div className="py-12 text-center text-sm text-white/40">暂无下载任务</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const done = g.tasks.filter((t) => t.status === "done").length;
            const err = g.tasks.filter((t) => t.status === "error").length;
            const pct = g.total ? Math.round((done / g.total) * 100) : 0;
            return (
              <div key={g.id} className="glass rounded-2xl p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{g.name}</span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                        g.status === "done"
                          ? "bg-emerald-400/10 text-emerald-300"
                          : g.status === "running"
                            ? "bg-blue-400/10 text-blue-300"
                            : "bg-white/10 text-white/60"
                      }`}
                    >
                      {statusLabel(g.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/40">
                    <span>
                      {done} 成功 / {err} 失败 / {g.total} 总
                    </span>
                    {g.status === "running" && (
                      <button
                        onClick={() => cancel(g.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:border-red-400/60 hover:text-red-300"
                      >
                        <XCircle size={13} /> 取消
                      </button>
                    )}
                  </div>
                </div>
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full transition-all ${err ? "bg-red-500" : "bg-gradient-to-r from-brand-red to-brand-gold"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="space-y-1">
                  {g.tasks.map((t) => (
                    <div key={t.index} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                      <span className="text-sm">{t.format === "m3u8" ? "🎬" : "📄"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white/80" title={t.title}>
                          {t.title}
                        </div>
                        <div className="mt-1 h-1 max-w-xs overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full ${t.status === "error" ? "bg-red-500" : "bg-brand-red"}`}
                            style={{
                              width: `${
                                t.status === "done" ? 100 : t.status === "downloading" ? Math.round(t.progress * 100) : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-xs text-white/40">
                        {t.status === "downloading" ? (
                          <>
                            <PlayCircle size={12} className="animate-pulse text-blue-400" />{" "}
                            {t.downloaded > 0 ? fmtSize(t.downloaded) : "…"}
                          </>
                        ) : (
                          <span
                            className={`font-medium ${
                              t.status === "error"
                                ? "text-red-400"
                                : t.status === "done"
                                  ? "text-emerald-300"
                                  : "text-white/40"
                            }`}
                          >
                            {statusLabel(t.status)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {g.tasks.some((t) => t.error) && (
                    <div className="mt-1 space-y-1">
                      {g.tasks
                        .filter((t) => t.error)
                        .map((t) => (
                          <div
                            key={t.index}
                            className="ml-8 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300"
                          >
                            {t.title}: {t.error}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
