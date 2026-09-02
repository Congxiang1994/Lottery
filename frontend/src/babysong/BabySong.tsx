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
  Heart,
} from "lucide-react";

interface Song {
  id: string;
  title: string;
  channel: string;
  youtube_url: string;
  cover: string;
  bilibili_bvid?: string; // 哔哩哔哩视频 BV 号（抓取所得，可能为空）
  seq: number; // 全局序号（1..N），按目录顺序，搜索/分页不改变
}

const PAGE_SIZE = 48;
const PLAYED_KEY = "babysong_played_v1";
const FAV_KEY = "babysong_fav_v1";
const LAST_KEY = "babysong_last_v1";
const HISTORY_KEY = "babysong_history_v1";
const HISTORY_MAX = 30;

type FilterMode = "all" | "played" | "unplayed" | "fav" | "recent";
type PlatformMode = "all" | "bili" | "yt";

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

function loadFav(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveFav(set: Set<string>) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
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
 * 卡片网格：序号 + 封面 + 歌名；鼠标悬停卡片显示「B站 / YouTube」双按钮，用户自选平台播放。
 * 播放状态存 localStorage（单机可用，无登录），已播放卡片打钩角标 + 进度统计。
 * 收藏(♥)与播放状态独立，可单独筛选；支持状态筛选 + 平台筛选（B站可看 / 仅YouTube）+ 分页 + 跳页 + 继续上次位置。
 * 哔哩哔哩链接由后台定时任务每日刷新（搬运视频可能被下架，刷新以找回最新可用链接）。
 */
export default function BabySong() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [platform, setPlatform] = useState<PlatformMode>("all");
  const [played, setPlayed] = useState<Set<string>>(loadPlayed);
  const [fav, setFav] = useState<Set<string>>(loadFav);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [lastSeq, setLastSeq] = useState<number | null>(loadLast);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const [jumpVal, setJumpVal] = useState("");
  const [toast, setToast] = useState("");

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
    else if (filter === "fav") list = list.filter((s) => fav.has(s.id));
    else if (filter === "recent") {
      const order = new Map(history.map((id, i) => [id, i]));
      list = list.filter((s) => order.has(s.id));
      list = [...list].sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
    }
    // 平台筛选：bili=有 B 站链接可看；yt=有 YouTube 链接可看（每首都有，故等价于全部）
    if (platform === "bili") list = list.filter((s) => !!s.bilibili_bvid);
    else if (platform === "yt") list = list.filter((s) => !!s.youtube_url);
    return list;
  }, [matched, filter, played, fav, history, platform]);

  const playedCount = played.size;
  const favCount = fav.size;

  const playedPct = songs.length ? Math.round((playedCount / songs.length) * 100) : 0;

  // 搜索词 / 状态筛选 / 平台筛选变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [query, filter, platform]);

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
    setHistory((prev) => {
      const next = [s.id, ...prev.filter((x) => x !== s.id)].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  };

  const toggleFav = (s: Song, e: React.MouseEvent) => {
    // 阻止冒泡，避免触发整卡跳转 YouTube
    e.preventDefault();
    e.stopPropagation();
    setFav((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id);
      else next.add(s.id);
      saveFav(next);
      return next;
    });
  };

  // 打开 YouTube（标记已播放）
  const openYoutube = (s: Song) => {
    markPlayed(s);
    window.open(s.youtube_url, "_blank", "noopener,noreferrer");
  };

  // 打开哔哩哔哩：移动端优先尝试拉起 B 站 App（bilibili:// 深链），失败/超时回退网页版
  const openBilibili = (s: Song) => {
    const bvid = s.bilibili_bvid;
    if (!bvid) return;
    markPlayed(s);
    const web = `https://www.bilibili.com/video/${bvid}`;
    const app = `bilibili://video/${bvid}`;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(
      navigator.userAgent
    );
    if (!isMobile) {
      window.open(web, "_blank", "noopener,noreferrer");
      return;
    }
    // 移动端：先尝试拉起 App，1.2s 内未离开页面（即未拉起 App）则回退网页版
    const t0 = Date.now();
    const fallback = setTimeout(() => {
      if (Date.now() - t0 < 1500) window.open(web, "_blank", "noopener,noreferrer");
    }, 1200);
    const onHide = () => {
      if (document.hidden) clearTimeout(fallback);
    };
    document.addEventListener("visibilitychange", onHide, { once: true });
    window.location.href = app;
  };

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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

        <p className="mt-2 text-[11px] text-paper-500">
          不能翻墙？把鼠标移到卡片上，选 <span className="font-semibold text-[#FB7299]">B站</span> 即可在哔哩哔哩播放
        </p>
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

        {/* 状态筛选 */}
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
          <FilterTab active={filter === "fav"} onClick={() => setFilter("fav")}>
            收藏 {favCount}
          </FilterTab>
          <FilterTab active={filter === "recent"} onClick={() => setFilter("recent")}>
            最近 {history.length}
          </FilterTab>
        </div>

        {/* 平台筛选（独立一行） */}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="text-paper-400">平台</span>
          <FilterTab active={platform === "all"} onClick={() => setPlatform("all")}>
            全部
          </FilterTab>
          <FilterTab active={platform === "bili"} onClick={() => setPlatform("bili")}>
            B站可看
          </FilterTab>
          <FilterTab active={platform === "yt"} onClick={() => setPlatform("yt")}>
            Youtube可看
          </FilterTab>
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
                : filter === "fav"
                ? "还没有收藏的儿歌，点卡片右下角的 ♥ 即可收藏～"
                : filter === "recent"
                ? "还没有播放记录，点开任意一首即可记录～"
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
              const isFav = fav.has(s.id);
              const isLast = highlightSeq === s.seq;
              return (
                <div
                  key={s.id}
                  data-seq={s.seq}
                  role="link"
                  tabIndex={0}
                  title={`#${s.seq} ${s.title} · 点击在 YouTube 播放，悬停可选 B 站`}
                  onClick={() => openYoutube(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openYoutube(s);
                  }}
                  className={`group block cursor-pointer ${isPlayed ? "opacity-90" : ""}`}
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
                      {/* 收藏按钮（右下，点♥切换，不触发跳转） */}
                      <button
                        type="button"
                        onClick={(e) => toggleFav(s, e)}
                        title={isFav ? "取消收藏" : "收藏"}
                        aria-label={isFav ? "取消收藏" : "收藏"}
                        className={`absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full shadow transition ${
                          isFav
                            ? "bg-brand-red text-white"
                            : "bg-paper-900/55 text-white hover:bg-paper-900/75"
                        }`}
                      >
                        <Heart
                          size={15}
                          strokeWidth={2.2}
                          className={isFav ? "fill-current" : ""}
                        />
                      </button>
                      {/* hover 双平台播放按钮：B 站 / YouTube（移动端常驻显示） */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-paper-900/0 opacity-100 transition group-hover:bg-paper-900/40 md:bg-paper-900/0 md:opacity-0 md:group-hover:opacity-100">
                        {s.bilibili_bvid && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openBilibili(s);
                            }}
                            title="在哔哩哔哩播放"
                            aria-label="在哔哩哔哩播放"
                            className="pointer-events-auto flex items-center gap-1 rounded-full bg-[#FB7299] px-3 py-2 text-xs font-semibold text-white shadow-lg transition hover:scale-105"
                          >
                            <BiliIcon size={15} /> B站
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openYoutube(s);
                          }}
                          title="在 YouTube 播放"
                          aria-label="在 YouTube 播放"
                          className="pointer-events-auto flex items-center gap-1 rounded-full bg-brand-red px-3 py-2 text-xs font-semibold text-white shadow-lg transition hover:scale-105"
                        >
                          <Youtube size={15} /> YouTube
                        </button>
                      </div>
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
                </div>
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

      {/* 操作提示 toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-paper-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
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

/** 哔哩哔哩品牌图标（simple-icons 路径），用于卡片悬停的「B站」按钮 */
function BiliIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.223 3.086a1.25 1.25 0 0 1 0 1.768L17.08 5.996h1.17A3.75 3.75 0 0 1 22 9.747v7.5a3.75 3.75 0 0 1-3.75 3.75H5.75A3.75 3.75 0 0 1 2 17.247v-7.5a3.75 3.75 0 0 1 3.751-3.751h1.166L5.775 4.854a1.25 1.25 0 1 1 1.767-1.768l2.652 2.652c.079.079.145.165.198.257h3.213c.053-.092.12-.18.199-.258l2.651-2.651a1.25 1.25 0 0 1 1.768 0zM18.25 8.497H5.75a1.25 1.25 0 0 0-1.247 1.157l-.003.094v7.5c0 .659.51 1.199 1.157 1.246l.093.004h12.5a1.25 1.25 0 0 0 1.247-1.157l.003-.093v-7.5c0-.69-.56-1.25-1.25-1.25zm-9.5 3.948a1 1 0 0 1 1 1v1.498a1 1 0 1 1-2 0v-1.498a1 1 0 0 1 1-1zm5.5 0a1 1 0 0 1 1 1v1.498a1 1 0 1 1-2 0v-1.498a1 1 0 0 1 1-1z" />
    </svg>
  );
}
