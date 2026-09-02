import { useEffect, useMemo, useState } from "react";
import { Music, Search, Youtube, Shuffle, X, ExternalLink, Check } from "lucide-react";

interface Song {
  id: string;
  title: string;
  channel: string;
  youtube_url: string;
  cover: string;
  seq: number; // 全局序号（1..N），按目录顺序，搜索/分页不改变
}

const PAGE_SIZE = 48;
const PLAYED_KEY = "babysong_played_v1";

function loadPlayed(): Set<string> {
  try {
    const raw = localStorage.getItem(PLAYED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function savePlayed(set: Set<string>) {
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* 隐私模式等场景下静默忽略 */
  }
}

/** 计算窗口化页码（当前页前后各 spread 页，封顶/封底） */
function pageWindow(page: number, pageCount: number, spread = 3): number[] {
  const start = Math.max(1, page - spread);
  const end = Math.min(pageCount, page + spread);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/**
 * Super Simple Songs 儿歌列表页 /babysong
 * 卡片网格：序号 + 封面 + 歌名，点击整卡跳转 YouTube 播放（不下载、不点读、不内嵌播放器）。
 * 播放状态存 localStorage（单机可用，无登录），已播放卡片打钩角标 + 进度统计。
 * 列表分页，避免一页滚到底。
 */
export default function BabySong() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [played, setPlayed] = useState<Set<string>>(loadPlayed);

  useEffect(() => {
    fetch("/api/babysong/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const list: Song[] = (Array.isArray(d.songs) ? d.songs : []).map(
          (s: Omit<Song, "seq">, i: number) => ({ ...s, seq: i + 1 })
        );
        setSongs(list);
      })
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

  // 搜索词变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const markPlayed = (id: string) => {
    setPlayed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      savePlayed(next);
      return next;
    });
  };

  const openRandom = () => {
    if (!filtered.length) return;
    const s = filtered[Math.floor(Math.random() * filtered.length)];
    markPlayed(s.id);
    window.open(s.youtube_url, "_blank", "noopener,noreferrer");
  };

  const goPage = (p: number) => {
    const target = Math.max(1, Math.min(pageCount, p));
    setPage(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-paper-600">
            <span>
              显示 <span className="font-bold text-paper-800">{filtered.length}</span> / {songs.length}
            </span>
            <span className="text-paper-300">·</span>
            <span>
              已播放 <span className="font-bold text-emerald-600">{played.size}</span> 首
            </span>
            {pageCount > 1 && (
              <>
                <span className="text-paper-300">·</span>
                <span>
                  第 <span className="font-bold text-paper-800">{safePage}</span> / {pageCount} 页
                </span>
              </>
            )}
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
            {pageItems.map((s) => {
              const isPlayed = played.has(s.id);
              return (
                <a
                  key={s.id}
                  href={s.youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`#${s.seq} ${s.title} · 在 YouTube 播放`}
                  onClick={() => markPlayed(s.id)}
                  className={`group block ${
                    isPlayed ? "opacity-90" : ""
                  }`}
                >
                  <div
                    className={`glass card-hover overflow-hidden rounded-2xl transition ${
                      isPlayed ? "ring-2 ring-emerald-400/60" : ""
                    }`}
                  >
                    <div className="relative aspect-square overflow-hidden bg-paper-100">
                      <img
                        src={s.cover}
                        alt={s.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                      {/* 序号角标（左上） */}
                      <span className="absolute left-2 top-2 grid h-6 min-w-6 place-items-center rounded-md bg-paper-900/65 px-1.5 text-[11px] font-bold text-white backdrop-blur-sm">
                        {s.seq}
                      </span>
                      {/* 已播放打钩角标（右上） */}
                      {isPlayed && (
                        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white shadow">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
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
                          <div
                            className="truncate text-sm font-semibold text-paper-900"
                            title={s.title}
                          >
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
              );
            })}
          </div>
        )}
      </div>

      {/* 分页 */}
      {!loading && !error && pageCount > 1 && (
        <nav className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
          <PagerBtn
            label="上一页"
            disabled={safePage <= 1}
            onClick={() => goPage(safePage - 1)}
            className="px-3"
          >
            ‹
          </PagerBtn>
          {pageWindow(safePage, pageCount).map((p) => (
            <PagerBtn
              key={p}
              label={`第 ${p} 页`}
              active={p === safePage}
              onClick={() => goPage(p)}
              className="min-w-[2.25rem]"
            >
              {p}
            </PagerBtn>
          ))}
          <PagerBtn
            label="下一页"
            disabled={safePage >= pageCount}
            onClick={() => goPage(safePage + 1)}
            className="px-3"
          >
            ›
          </PagerBtn>
        </nav>
      )}
    </div>
  );
}

function PagerBtn({
  children,
  label,
  onClick,
  active,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-9 rounded-lg border text-sm font-semibold transition ${
        active
          ? "border-brand-red bg-brand-red text-white shadow-glow"
          : "border-paper-200 bg-paper-50 text-paper-700 hover:border-brand-red/50 hover:bg-white"
      } ${className} ${
        disabled ? "pointer-events-none opacity-35" : ""
      }`}
    >
      {children}
    </button>
  );
}
