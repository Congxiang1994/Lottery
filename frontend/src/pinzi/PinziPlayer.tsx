import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  Grid3X3,
  Loader2,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { AppModal } from "../common/AppModal";
import { ExitPresence } from "../common/Modal";
import { useModalHistory } from "../common/useModalHistory";
import { useEscapeClose } from "../common/useEscapeClose";
import { errText } from "../common/State";
import { pinziApi, type PinziVideo } from "./api";
import {
  AUTOPLAY_KEY,
  loadAutoplay,
  loadProgress,
  saveAutoplay,
  saveProgress,
  watchedRatio,
  type PinziProgressMap,
} from "./progress";

/* 楷体字体栈（与 hanzi 页一致的水墨气质） */
const KAI: React.CSSProperties = {
  fontFamily: "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'Noto Serif SC', serif",
};

/* 倍速档位：长视频必备，20 分钟以上的课 1.25~1.5 倍最常用 */
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

/** 列表当天缓存 key（两门课分开，避免互相覆盖） */
const LIST_KEY = "pinzi_list_cache";
const LIST_DATE_KEY = "pinzi_list_date";

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function loadCachedList(): PinziVideo[] | null {
  try {
    if (localStorage.getItem(LIST_DATE_KEY) !== today()) return null;
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as PinziVideo[]) : null;
  } catch {
    return null;
  }
}

function saveCachedList(list: PinziVideo[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    localStorage.setItem(LIST_DATE_KEY, today());
  } catch {
    /* ignore */
  }
}

/** 秒 → mm:ss / h:mm:ss */
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * 汉字拼读课列表页 /pinzi（水墨中国风，与 /hanzi 同源视觉）
 *
 * 与 /hanzi 的关键差异：本课程是**长视频**（单集 20~31 分钟）。
 * 因此播放器针对长视频做了三件事：
 *   1. **断点续播** —— 退出记位置，下次点开直接接着看（列表卡片带进度条）
 *   2. **倍速播放** —— 1 / 1.25 / 1.5 / 1.75 / 2 档
 *   3. **大跨度步进** —— 前进/后退 10 秒（短课用 5 秒，长课 10 秒更好用）
 * 卡片用**真实封面图**（下载器抓的课程封面），不再用汉字大字当封面。
 */
export default function PinziPlayer() {
  const [videos, setVideos] = useState<PinziVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<PinziProgressMap>(() => loadProgress());

  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [autoplay, setAutoplay] = useState<boolean>(() => loadAutoplay());
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [ended, setEnded] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaveRef = useRef(0);
  const resumedRef = useRef<number | null>(null);

  /* 加载列表：当天缓存优先，跨天刷新；失败降级旧缓存 */
  const loadList = useCallback((force = false) => {
    const cached = force ? null : loadCachedList();
    if (cached) {
      setVideos(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    pinziApi
      .list()
      .then((d) => {
        const list = Array.isArray(d.videos) ? d.videos : [];
        setVideos(list);
        saveCachedList(list);
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  /* 回到页面时刷新进度（比如从别的 tab 切回来） */
  useEffect(() => {
    const refresh = () => setProgress(loadProgress());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter((v) =>
      `${v.seq} ${v.title} ${v.filename}`.toLowerCase().includes(q)
    );
  }, [videos, query]);

  const current = useMemo(
    () => videos.find((v) => v.seq === activeSeq) || null,
    [videos, activeSeq]
  );
  const idx = useMemo(
    () => videos.findIndex((v) => v.seq === activeSeq),
    [videos, activeSeq]
  );
  const prevVideo = idx > 0 ? videos[idx - 1] : null;
  const nextVideo = idx >= 0 && idx < videos.length - 1 ? videos[idx + 1] : null;

  /* 打开播放器时锁背景滚动 */
  useEffect(() => {
    document.body.style.overflow = activeSeq != null ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeSeq]);

  /* 切集：重置状态并自动播放 */
  useEffect(() => {
    if (!current) return;
    const v = videoRef.current;
    if (v) {
      setEnded(false);
      setCur(0);
      setDur(0);
      v.load();
      v.playbackRate = speed;
      v.play().catch(() => {});
    }
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 断点续播：同一集只恢复一次 */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || activeSeq == null) return;
    if (resumedRef.current === activeSeq) return;
    resumedRef.current = activeSeq;
    const p = loadProgress()[String(activeSeq)];
    if (p && p.dur > 0 && p.pos > 10 && p.pos < p.dur * 0.97) {
      const seek = () => {
        if (v.duration > 0) v.currentTime = p.pos;
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    }
  }, [activeSeq]);

  /* 长视频进度频繁变化，节流 5 秒落盘一次 */
  const onTime = () => {
    const v = videoRef.current;
    if (!v || !current) return;
    setCur(v.currentTime);
    const now = Date.now();
    if (now - lastSaveRef.current < 5000) return;
    lastSaveRef.current = now;
    saveProgress(current.seq, v.currentTime, v.duration || 0);
  };

  const onEnded = () => {
    if (!current) return;
    saveProgress(current.seq, 0, 0, true);
    setEnded(true);
    if (autoplay && nextVideo) setActiveSeq(nextVideo.seq);
  };

  /* 预取下一集：长视频缓冲慢，提前预热首屏体验明显更好 */
  useEffect(() => {
    if (!nextVideo) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = nextVideo.url;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [nextVideo]);

  /* 键盘：← → 步进 10s，↑ ↓ 切集，空格播放/暂停 */
  useEffect(() => {
    if (activeSeq == null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      const v = videoRef.current;
      if (!v) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (prevVideo) setActiveSeq(prevVideo.seq);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (nextVideo) setActiveSeq(nextVideo.seq);
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekBy(10);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekBy(-10);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 每次 render 重绑，拿最新的 prev/next

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  };

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  /* 关闭：先落盘进度再清状态 */
  const teardown = () => {
    const v = videoRef.current;
    if (v && current) saveProgress(current.seq, v.currentTime, v.duration || 0);
    setActiveSeq(null);
    setShowPicker(false);
    setPlaying(false);
    resumedRef.current = null;
  };

  const modalHistory = useModalHistory("pinziModal", teardown);

  const openModal = (seq: number) => {
    setActiveSeq(seq);
    modalHistory.push();
  };

  const closeModal = () => {
    teardown();
    modalHistory.pop();
  };

  useEscapeClose(activeSeq != null, () => {
    if (showPicker) setShowPicker(false);
    else closeModal();
  });

  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    saveAutoplay(next);
  };

  const pad = (n: number) => String(n).padStart(3, "0");

  /* 总时长/总进度统计（帮助家长看整体进度） */
  const stats = useMemo(() => {
    const doneN = videos.filter((v) => progress[String(v.seq)]?.done).length;
    const totalMin = Math.round(
      videos.reduce((s, v) => s + (v.duration || 0), 0) / 60
    );
    return { doneN, total: videos.length, totalMin };
  }, [videos, progress]);

  return (
    <div className="pinzi-page min-h-screen" style={{ background: "#faf6f1" }}>
      {/* ====== 顶部 Hero ====== */}
      <div className="relative overflow-hidden px-4 pb-8 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 opacity-30">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="h-full w-full">
            <path
              d="M0,120 L0,60 Q150,20 300,50 T600,40 T900,55 T1200,30 L1200,120 Z"
              fill="#d4c4a8"
            />
            <path
              d="M0,120 L0,80 Q200,50 400,70 T800,60 T1200,75 L1200,120 Z"
              fill="#c9b896"
              opacity="0.6"
            />
          </svg>
        </div>

        <div className="relative mx-auto max-w-2xl text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <span className="h-px w-8 bg-[#b93a3a]/40" />
            <span className="text-[10px] tracking-[0.3em] text-[#a89078]">象形汉字 · 进阶</span>
            <span className="h-px w-8 bg-[#b93a3a]/40" />
          </div>
          <h1
            className="text-4xl font-bold tracking-wide text-[#3d2b1f] sm:text-5xl"
            style={KAI}
          >
            汉字是拼出来的
          </h1>
          <p className="mt-3 text-sm text-[#8b7355]">
            {stats.total > 0
              ? `${stats.total} 节故事课 · 共 ${Math.floor(stats.totalMin / 60)} 小时 ${stats.totalMin % 60} 分钟 · 已看 ${stats.doneN} 节`
              : "正在读取课程目录…"}
          </p>
        </div>

        {/* 搜索 */}
        <div className="relative mx-auto mt-6 max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a89078]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索课程标题，如「森林」「收割」"
            className="w-full rounded-full border border-[#d4c4a8] bg-white/80 py-2.5 pl-10 pr-10 text-sm text-[#3d2b1f] outline-none transition placeholder:text-[#bda88f] focus:border-[#b93a3a]/50 focus:bg-white"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[#a89078] transition hover:bg-[#d4c4a8]/40 hover:text-[#b93a3a]"
              title="清空搜索"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ====== 课程列表 ====== */}
      <div className="mx-auto max-w-5xl px-4 pb-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-[#8b7355]">
            <Loader2 size={16} className="animate-spin" />
            加载课程列表…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center">
            <p className="text-sm text-[#8b7355]">{error}</p>
            <button
              onClick={() => loadList(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#b93a3a]/50 px-4 py-1.5 text-xs font-medium text-[#b93a3a] transition hover:bg-[#b93a3a] hover:text-white"
            >
              重试
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center">
            <p className="text-sm text-[#8b7355]">未找到「{query}」相关课程</p>
            <button
              onClick={() => setQuery("")}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#b93a3a]/50 px-4 py-1.5 text-xs font-medium text-[#b93a3a] transition hover:bg-[#b93a3a] hover:text-white"
            >
              <X size={12} />
              清除搜索
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((v) => {
              const p = progress[String(v.seq)];
              const pct = Math.round(watchedRatio(p) * 100);
              return (
                <button
                  key={v.url}
                  onClick={() => openModal(v.seq)}
                  className="group relative flex items-stretch gap-3 overflow-hidden rounded-xl border border-[#d4c4a8]/60 bg-paper-50 p-2.5 text-left transition hover:-translate-y-0.5 hover:border-[#b93a3a]/40 hover:bg-white hover:shadow-lg"
                >
                  {/* 封面 */}
                  <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-[#e8dfd0] sm:w-32">
                    {v.cover ? (
                      <img
                        src={v.cover}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div
                        className="grid h-full w-full place-items-center text-2xl font-bold text-[#b93a3a]/40"
                        style={KAI}
                      >
                        {v.seq}
                      </div>
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-[#b93a3a] text-white shadow-md">
                        <Play size={15} className="ml-0.5" />
                      </span>
                    </span>
                    {v.duration > 0 && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                        {fmt(v.duration)}
                      </span>
                    )}
                    {pct > 0 && (
                      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/30">
                        <span
                          className={`block h-full ${
                            pct >= 100 ? "bg-[#b93a3a]" : "bg-[#c98600]"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    )}
                  </div>

                  {/* 文案 */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center py-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold tabular-nums text-[#c4a882]">
                        {pad(v.seq)}
                      </span>
                      {p?.done && (
                        <span className="rounded bg-[#b93a3a] px-1 py-px text-[9px] font-bold text-white">
                          已看完
                        </span>
                      )}
                      {!p?.done && pct > 0 && (
                        <span className="text-[9px] font-medium text-[#c98600]">
                          已看 {pct}%
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-[#3d2b1f]">
                      {v.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ====== 底部印章 ====== */}
      <div className="pb-10 pt-4 text-center">
        <div
          className="mx-auto mb-2 inline-block rounded-lg border-2 border-[#b93a3a] px-4 py-1.5 text-lg font-bold tracking-widest text-[#b93a3a]"
          style={KAI}
        >
          汉字是拼出来的
        </div>
        <p className="text-xs tracking-widest text-[#a89078]">— 故事里的汉字启蒙 —</p>
      </div>

      {/* ================================================================
          播放器 Modal
      ================================================================ */}
      <ExitPresence open={activeSeq != null}>
        {activeSeq != null && (
          <AppModal
            onClose={closeModal}
            size="lg"
            bare
            escapeClose={false}
            className="rounded-2xl border-[#d4c4a8] bg-white"
          >
            <>
              {!current ? (
                <div className="px-5 py-16 text-center text-sm text-[#8b7355]">
                  未找到第 {activeSeq} 节课程
                </div>
              ) : (
                <>
                  {/* 标题栏 */}
                  <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3.5 sm:px-5">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[10px] font-bold tabular-nums text-[#c4a882]">
                          {pad(current.seq)} / {pad(videos.length)}
                        </span>
                        <button
                          onClick={() => setShowPicker(true)}
                          className="inline-flex items-center gap-1 text-[11px] text-[#a89078] transition hover:text-[#b93a3a]"
                        >
                          <Grid3X3 size={11} />
                          选集
                        </button>
                      </div>
                      <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-[#3d2b1f]">
                        {current.title}
                      </p>
                    </div>
                    <button
                      onClick={closeModal}
                      title="关闭"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#8b7355] transition hover:bg-[#d4c4a8]/40 hover:text-[#3d2b1f]"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* 视频区 */}
                  <div className="relative bg-black">
                    <video
                      ref={videoRef}
                      src={current.url}
                      poster={current.cover || undefined}
                      playsInline
                      className="aspect-video w-full bg-black"
                      onClick={togglePlay}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onTimeUpdate={onTime}
                      onLoadedMetadata={(e) => {
                        setDur(e.currentTarget.duration || 0);
                        e.currentTarget.playbackRate = speed;
                      }}
                      onEnded={onEnded}
                    />

                    {/* 播完重播 */}
                    {ended && (
                      <button
                        onClick={() => {
                          const v = videoRef.current;
                          if (v) {
                            v.currentTime = 0;
                            setEnded(false);
                            v.play().catch(() => {});
                          }
                        }}
                        className="absolute inset-0 grid place-items-center bg-black/50"
                        title="重新播放"
                      >
                        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/95 text-[#3d2b1f] shadow-lg">
                          <RotateCcw size={22} />
                        </span>
                      </button>
                    )}
                  </div>

                  {/* 进度条 */}
                  <div className="px-4 pt-2.5 sm:px-5">
                    <input
                      type="range"
                      min={0}
                      max={dur || 0}
                      step={0.1}
                      value={Math.min(cur, dur || 0)}
                      onChange={(e) => {
                        const t = Number(e.target.value);
                        if (videoRef.current) videoRef.current.currentTime = t;
                        setCur(t);
                      }}
                      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[#d4c4a8] accent-[#b93a3a]"
                      style={{
                        background: `linear-gradient(to right, #b93a3a ${
                          dur > 0 ? (cur / dur) * 100 : 0
                        }%, #d4c4a8 ${dur > 0 ? (cur / dur) * 100 : 0}%)`,
                      }}
                    />
                    <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-[#a89078]">
                      <span>{fmt(cur)}</span>
                      <span>{fmt(dur)}</span>
                    </div>
                  </div>

                  {/* 控制条：上一集 · -10s · 播放 · +10s · 下一集 | 倍速 · 连播 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-1 sm:px-5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => prevVideo && setActiveSeq(prevVideo.seq)}
                        disabled={!prevVideo}
                        title={prevVideo ? `上一集：${prevVideo.title}` : "已是第一集"}
                        className="grid h-9 w-9 place-items-center rounded-full text-[#8b7355] transition hover:bg-[#d4c4a8]/40 hover:text-[#3d2b1f] disabled:opacity-30"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => seekBy(-10)}
                        title="后退 10 秒"
                        className="grid h-9 w-9 place-items-center rounded-full text-[#8b7355] transition hover:bg-[#d4c4a8]/40 hover:text-[#3d2b1f]"
                      >
                        <RotateCcw size={17} />
                      </button>
                      <button
                        onClick={togglePlay}
                        title={playing ? "暂停" : "播放"}
                        className="grid h-11 w-11 place-items-center rounded-full bg-[#b93a3a] text-white shadow-md transition hover:bg-[#a33030]"
                      >
                        {playing ? (
                          <Pause size={18} />
                        ) : (
                          <Play size={18} className="ml-0.5" />
                        )}
                      </button>
                      <button
                        onClick={() => seekBy(10)}
                        title="前进 10 秒"
                        className="grid h-9 w-9 place-items-center rounded-full text-[#8b7355] transition hover:bg-[#d4c4a8]/40 hover:text-[#3d2b1f]"
                      >
                        <RotateCw size={17} />
                      </button>
                      <button
                        onClick={() => nextVideo && setActiveSeq(nextVideo.seq)}
                        disabled={!nextVideo}
                        title={nextVideo ? `下一集：${nextVideo.title}` : "已是最后一集"}
                        className="grid h-9 w-9 place-items-center rounded-full text-[#8b7355] transition hover:bg-[#d4c4a8]/40 hover:text-[#3d2b1f] disabled:opacity-30"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* 倍速 */}
                      <button
                        onClick={cycleSpeed}
                        title="切换播放速度"
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums transition ${
                          speed !== 1
                            ? "border-[#b93a3a]/50 bg-[#b93a3a]/10 text-[#b93a3a]"
                            : "border-[#d4c4a8] text-[#8b7355]"
                        }`}
                      >
                        <Gauge size={11} />
                        {speed}×
                      </button>
                      {/* 连播 */}
                      <button
                        onClick={toggleAutoplay}
                        title={autoplay ? "关闭自动连播" : "开启自动连播"}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          autoplay
                            ? "border-[#b93a3a]/50 bg-[#b93a3a]/10 text-[#b93a3a]"
                            : "border-[#d4c4a8] text-[#a89078]"
                        }`}
                      >
                        <span
                          className={`relative h-3.5 w-6 rounded-full transition ${
                            autoplay ? "bg-[#b93a3a]" : "bg-[#d4c4a8]"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-all ${
                              autoplay ? "left-3" : "left-0.5"
                            }`}
                          />
                        </span>
                        连播
                      </button>
                    </div>
                  </div>

                  {/* 选集面板 */}
                  {showPicker && (
                    <div className="border-t border-[#d4c4a8]/60 bg-[#faf6f1] px-3 py-3">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="text-[11px] font-medium text-[#8b7355]">
                          全部 {videos.length} 节
                        </span>
                        <button
                          onClick={() => setShowPicker(false)}
                          className="text-[11px] text-[#a89078] transition hover:text-[#b93a3a]"
                        >
                          收起
                        </button>
                      </div>
                      <div className="max-h-52 overflow-y-auto pr-1">
                        <div className="grid gap-1">
                          {videos.map((v) => {
                            const p = progress[String(v.seq)];
                            const pct = Math.round(watchedRatio(p) * 100);
                            const on = v.seq === activeSeq;
                            return (
                              <button
                                key={v.url}
                                onClick={() => {
                                  setShowPicker(false);
                                  if (v.seq !== activeSeq) setActiveSeq(v.seq);
                                }}
                                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                                  on
                                    ? "bg-[#b93a3a]/10 text-[#b93a3a]"
                                    : "hover:bg-[#d4c4a8]/30"
                                }`}
                              >
                                <span className="w-7 shrink-0 text-[10px] font-bold tabular-nums text-[#c4a882]">
                                  {pad(v.seq)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-[#3d2b1f]">
                                  {v.title}
                                </span>
                                {p?.done && (
                                  <span className="shrink-0 text-[9px] font-bold text-[#b93a3a]">
                                    已看完
                                  </span>
                                )}
                                {!p?.done && pct > 0 && (
                                  <span className="shrink-0 text-[9px] tabular-nums text-[#c98600]">
                                    {pct}%
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          </AppModal>
        )}
      </ExitPresence>
    </div>
  );
}
