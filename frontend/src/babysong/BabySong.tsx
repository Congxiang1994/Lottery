import { useEffect, useMemo, useState } from "react";
import { Music, Search, Youtube, Shuffle, X, ExternalLink } from "lucide-react";

interface Song {
  id: string;
  title: string;
  channel: string;
  youtube_url: string;
  cover: string;
}

/**
 * Super Simple Songs 儿歌列表页 /babysong
 * 卡片网格：封面 + 歌名，点击整卡跳转 YouTube 播放（不下载、不点读、不内嵌播放器）。
 */
export default function BabySong() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/babysong/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setSongs(Array.isArray(d.songs) ? d.songs : []))
      .catch((e) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }, [songs, query]);

  const openRandom = () => {
    if (!filtered.length) return;
    const s = filtered[Math.floor(Math.random() * filtered.length)];
    window.open(s.youtube_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="pt-10">
      {/* Hero */}
      <section className="text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-paper-200 bg-paper-100 px-4 py-1.5 text-xs text-paper-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-red" />
          英文儿歌 · 点击跳转 YouTube 播放
        </div>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          <span className="gradient-text">Super Simple Songs</span> 儿歌
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-paper-700">
          共收录 <span className="font-bold text-brand-red2">{songs.length}</span> 首经典英文儿歌，
          带官方封面与 YouTube 直链，点开即看。
        </p>
        <div className="mt-6 flex justify-center">
          <button
            onClick={openRandom}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <Shuffle size={16} /> 随机来一首
          </button>
        </div>
      </section>

      {/* 搜索 */}
      <div className="mx-auto mt-8 max-w-lg px-1">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-paper-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索歌名或编号（如 Twinkle、EN001）"
            className="w-full rounded-xl border border-paper-200 bg-paper-50 py-2.5 pl-10 pr-10 text-sm text-paper-800 outline-none transition placeholder:text-paper-500 focus:border-brand-red/50 focus:bg-white"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              title="清空"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-paper-500 transition hover:bg-paper-100 hover:text-paper-800"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {!loading && (
          <div className="mt-2 text-center text-xs text-paper-600">
            显示 <span className="font-bold text-paper-800">{filtered.length}</span> / {songs.length}
          </div>
        )}
      </div>

      {/* 卡片网格 */}
      <div className="mt-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-paper-100 bg-paper-50">
                <div className="shimmer aspect-square animate-shimmer" />
                <div className="space-y-2 p-3">
                  <div className="shimmer h-3.5 w-3/4 animate-shimmer rounded" />
                  <div className="shimmer h-2.5 w-1/2 animate-shimmer rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-paper-200 bg-paper-50 px-5 py-16 text-center text-sm text-paper-700">
            儿歌列表加载失败：{error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-paper-200 bg-paper-50 px-5 py-16 text-center">
            <p className="text-sm text-paper-700">
              未找到「{query}」相关的儿歌，换个关键词试试
            </p>
            <button
              onClick={() => setQuery("")}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-brand-red/50 px-4 py-1.5 text-xs font-medium text-brand-red transition hover:bg-brand-red/10"
            >
              <X size={12} /> 清除搜索
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((s) => (
              <a
                key={s.id}
                href={s.youtube_url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${s.title} · 在 YouTube 播放`}
                className="group block"
              >
                <div className="glass card-hover overflow-hidden rounded-2xl">
                  <div className="relative aspect-square overflow-hidden bg-paper-100">
                    <img
                      src={s.cover}
                      alt={s.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    {/* hover 播放遮罩 */}
                    <span className="absolute inset-0 grid place-items-center bg-paper-900/0 opacity-0 transition group-hover:bg-paper-900/30 group-hover:opacity-100">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-red text-white shadow-glow">
                        <Youtube size={20} />
                      </span>
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="flex items-start gap-1.5">
                      <Music size={14} className="mt-0.5 shrink-0 text-brand-red2" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-paper-900" title={s.title}>
                          {s.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-paper-500">
                          <ExternalLink size={10} className="shrink-0" />
                          <span className="truncate">{s.channel || "YouTube"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
