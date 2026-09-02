import { useEffect, useMemo, useState } from "react";
import {
  Music,
  Search,
  Youtube,
  Shuffle,
  X,
  ExternalLink,
  Check,
  RotateCcw,
} from "lucide-react";

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
const LAST_KEY = "babysong_last_v1";

type FilterMode = "all" | "played" | "unplayed";
type SortMode = "seq" | "seq_desc" | "unplayed";

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

function loadLast(): number | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveLast(seq: number) {
  try {
    localStorage.setItem(LAST_KEY, String(seq));
  } catch {
    /* ignore */
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
 * 列表分页 + 筛选 + 跳页 + 继续上次位置。
 */
export default function BabySong() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("seq");
  const [played, setPlayed] = useState<Set<string>>(loadPlayed);
  const [lastSeq, setLastSeq] = useState<number | null>(loadLast);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const [jumpVal, setJumpVal] = useState("");

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

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }, [songs, query]);

  const filtered = useMemo(() => {
    let list = matched;
    if (filter === "played") list = list.filter((s) => played.has(s.id));
    else if (filter === "unplayed") list = list.filter((s) => !played.has(s.id));
    if (sort === "seq_desc") list = [...list].reverse();
    else if (sort === "unplayed") {
      list = [...list].sort(
        (a, b) => (played.has(a.id) ? 1 : 0) - (played.has(b.id) ? 1 : 0)
      );
    }
    return list;
  }, [matched, filter, played, sort]);

  const playedPct = songs.length ? Math.round((playedCount / songs.length) * 100) : 0;

  const playedCount = played.size;

  // 搜索词 / 筛选 / 排序变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [query, filter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 高亮「上次位置」卡片：渲染后滚动到可视区
  useEffect(() => {
    if (!highlightSeq) return;
    const el = document.querySelector(`[data-seq="${highlightSeq}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightSeq, safePage]);

  const markPlayed = (s: Song) => {
    setPlayed((prev) => {
      if (prev.has(s.id)) return prev;
      const next = new Set(prev);
      next.add(s.id);
      savePlayed(next);
      return next;
    });
    setLastSeq(s.seq);
    saveLast(s.seq);
  };

  const openRandom = () => {
    if (!filtered.length) return;
    const s = filtered[Math.floor(Math.random() * filtered.length)];
    markPlayed(s);
    window.open(s.youtube_url, "_blank", "noopener,noreferrer");
  };

  const goPage = (p: number) => {
    const target = Math.max(1, Math.min(pageCount, p));
    setPage(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const doJump = () => {
    const n = parseInt(jumpVal, 10);
    if (Number.isFinite(n)) goPage(n);
    setJumpVal("");
  };

  const continueLast = () => {
    if (!lastSeq) return;
    const target = songs.find((s) => s.seq === lastSeq);
    if (!target) return;
    setQuery("");
    setFilter("all");
    setHighlightSeq(lastSeq);
    goPage(Math.floor((lastSeq - 1) / PAGE_SIZE) + 1);
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
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={openRandom}
            disabled={!filtered.length}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <Shuffle size={16} /> 随机来一首
          </button>
          {lastSeq && (
            <button
              onClick={continueLast}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100"
            >
              <RotateCcw size={15} /> 回到上次 # {lastSeq}
            </button>
          )}
        </div>

        {/* 整体完成度进度条 */}
        <div className="mx-auto mt-5 w-full max-w-md px-1">
          <div className="h-2 overflow-hidden rounded-full bg-paper-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-red to-brand-red2 transition-all duration-500"
              style={{ width: `${playedPct}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-paper-500">
            <span>
              已播放 <span className="font-bold text-emerald-600">{playedCount}</span> / {songs.length}
            </span>
            <span className="text-paper-300">·</span>
            <span className="font-bold text-paper-700">{playedPct}%</span>
          </div>
        </div>
      </section>

      {/* 搜索 + 筛选 */}
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

        {/* 筛选 tabs + 排序 */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
          <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
            全部 {songs.length}
          </FilterTab>
          <FilterTab active={filter === "played"} onClick={() => setFilter("played")}>
            已播放 {playedCount}
          </FilterTab>
          <FilterTab active={filter === "unplayed"} onClick={() => setFilter("unplayed")}>
            未播放 {songs.length - playedCount}
          </FilterTab>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            title="排序方式"
            className="ml-1 h-8 rounded-full border border-paper-200 bg-paper-50 px-3 text-paper-700 outline-none transition focus:border-brand-red/50"
          >
            <option value="seq">序号 ↑</option>
            <option value="seq_desc">序号 ↓</option>
            <option value="unplayed">未播放优先</option>
          </select>
        </div>

        {!loading && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-paper-600">
            <span>
              显示 <span className="font-bold text-paper-800">{filtered.length}</span> / {songs.length}
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
              {filter === "played"
                ? "还没有播放过的儿歌，点开任意一首即可记录～"
                : filter === "unplayed"
                ? "全部都播放过啦，真棒 🎉"
                : `未找到「${query}」相关的儿歌，换个关键词试试`}
            </p>
            <button
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-brand-red/50 px-4 py-1.5 text-xs font-medium text-brand-red transition hover:bg-brand-red/10"
            >
              <X size={12} /> 清除筛选
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {pageItems.map((s) => {
              const isPlayed = played.has(s.id);
              const isLast = highlightSeq === s.seq;
              return (
                <a
                  key={s.id}
                  data-seq={s.seq}
                  href={s.youtube_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`#${s.seq} ${s.title} · 在 YouTube 播放`}
                  onClick={() => markPlayed(s)}
                  className={`group block ${isPlayed ? "opacity-90" : ""}`}
                >
                  <div
                    className={`glass card-hover overflow-hidden rounded-2xl transition ${
                      isLast
                        ? "ring-2 ring-amber-400"
                        : isPlayed
                        ? "ring-2 ring-emerald-400/60"
                        : ""
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
                      {/* 上次位置标记（右上，未播放时） */}
                      {isLast && !isPlayed && (
                        <span className="absolute right-2 top-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 shadow">
                          上次
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

      {/* 分页 + 跳页 */}
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

          <span className="mx-1 h-5 w-px bg-paper-200" />
          <input
            value={jumpVal}
            onChange={(e) => setJumpVal(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && doJump()}
            placeholder="页"
            className="h-9 w-14 rounded-lg border border-paper-200 bg-paper-50 px-2 text-center text-sm text-paper-800 outline-none focus:border-brand-red/50"
          />
          <button
            onClick={doJump}
            className="h-9 rounded-lg border border-paper-200 bg-paper-50 px-3 text-sm font-semibold text-paper-700 transition hover:border-brand-red/50 hover:bg-white"
          >
            跳转
          </button>
        </nav>
      )}
    </div>
  );
}

function FilterTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 font-medium transition ${
        active
          ? "bg-brand-red text-white shadow-glow"
          : "border border-paper-200 bg-paper-50 text-paper-700 hover:bg-white"
      }`}
    >
      {children}
    </button>
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
      } ${className} ${disabled ? "pointer-events-none opacity-35" : ""}`}
    >
      {children}
    </button>
  );
}
