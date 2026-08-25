import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
} from "lucide-react";

interface VideoItem {
  id: number | null;
  num: number | null;
  title: string;
  pinyin: string;
  pinyin_first: string;
  filename: string;
  url: string;
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return "00:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/* 楷体字体栈（macOS / Windows / Android 各自回退） */
const KAI: React.CSSProperties = {
  fontFamily: "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'Noto Serif SC', serif",
};

/* 拼音首字母表（按汉语拼音首字母排序，不含 i/u/v） */
const ALPHA = [
  "全部", "a", "b", "c", "d", "e", "f", "g", "h", "j", "k", "l", "m",
  "n", "q", "r", "s", "t", "w", "x", "y", "z",
];

function CtrlBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-12 w-12 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 active:scale-95 sm:h-11 sm:w-11"
    >
      {children}
    </button>
  );
}

export default function HanziPlayer() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [alpha, setAlpha] = useState("全部");
  const [current, setCurrent] = useState<VideoItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const pushedRef = useRef(false);

  useEffect(() => {
    fetch("/api/hanzi/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos : []))
      .catch((e) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = videos;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((v) =>
        `${v.num ?? ""} ${v.title} ${v.pinyin} ${v.filename}`.toLowerCase().includes(q)
      );
    }
    if (alpha !== "全部") {
      list = list.filter((v) => v.pinyin_first === alpha);
    }
    return list;
  }, [videos, query, alpha]);

  /* ---------- 播放控制 ---------- */

  const poke = () => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) setControlsVisible(false);
    }, 3000);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seek = (delta: number) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(v.currentTime + delta, 0), v.duration);
    setTime(v.currentTime);
  };

  const openVideo = (v: VideoItem) => {
    if (current && current.url === v.url) {
      const vd = videoRef.current;
      if (vd) {
        vd.currentTime = 0;
        vd.play().catch(() => {});
      }
      setControlsVisible(true);
      return;
    }
    setCurrent(v);
    setControlsVisible(true);
  };

  const goPrev = () => {
    if (!current || videos.length === 0) return;
    const i = videos.findIndex((x) => x.url === current.url);
    openVideo(i > 0 ? videos[i - 1] : videos[videos.length - 1]);
  };

  const goNext = () => {
    if (!current || videos.length === 0) return;
    const i = videos.findIndex((x) => x.url === current.url);
    openVideo(i >= 0 && i < videos.length - 1 ? videos[i + 1] : videos[0]);
  };

  const closePlayer = () => {
    const v = videoRef.current;
    if (v) v.pause();
    setCurrent(null);
    setPlaying(false);
    setEnded(false);
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  };

  const exit = () => {
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    } else {
      closePlayer();
    }
  };

  useEffect(() => {
    if (current && !pushedRef.current) {
      pushedRef.current = true;
      window.history.pushState({ hanziPlayer: true }, "");
    }
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onPop = () => {
      pushedRef.current = false;
      closePlayer();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const v = videoRef.current;
    if (!v) return;
    setTime(0);
    setDuration(0);
    setEnded(false);
    setPlaying(false);
    v.load();
    const p = v.play();
    if (p) p.then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [current]);

  useEffect(() => {
    if (!current || videos.length === 0) return;
    const i = videos.findIndex((x) => x.url === current.url);
    const next = i >= 0 && i < videos.length - 1 ? videos[i + 1] : videos[0];
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = next.url;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [current, videos]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") seek(-5);
      else if (e.key === "ArrowRight") seek(5);
      else if (e.key === "ArrowUp") goPrev();
      else if (e.key === "ArrowDown") goNext();
      else if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, videos]);

  return (
    <div className="min-h-screen" style={{ background: "#faf6f1" }}>
      {/* ====== 顶部 Hero 区 ====== */}
      <div className="relative overflow-hidden px-4 pb-10 pt-12 sm:pt-16">
        {/* 远山装饰背景 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 opacity-30">
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

        <div className="relative mx-auto max-w-5xl text-center">
          {/* 返回 + 印章 */}
          <div className="mb-6 flex items-center justify-center gap-4">
            <Link
              to="/"
              title="返回首页"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#c4a882]/40 text-[#8b7355] transition hover:border-[#a67c52] hover:text-[#5c4033]"
            >
              <ArrowLeft size={16} />
            </Link>
            <span
              className="grid h-12 w-12 place-items-center rounded-lg bg-[#b93a3a] text-xl font-bold text-white shadow-md"
              style={KAI}
            >
              字
            </span>
          </div>

          {/* 主标题 */}
          <h1
            className="mb-3 text-4xl font-bold tracking-widest text-[#3d2b1f] sm:text-5xl"
            style={KAI}
          >
            汉字是画出来的
          </h1>

          {/* 副标题 */}
          <p className="mb-2 text-sm tracking-[0.3em] text-[#8b7355] sm:text-base">
            观其形 · 知其义 · 字中有画 · 画中有字
          </p>
          <p className="text-xs text-[#a89078] sm:text-sm">
            共收录 <span className="font-bold text-[#b93a3a]">{videos.length}</span> 个象形汉字 · 点击卡片即可观看
          </p>
        </div>
      </div>

      {/* ====== 搜索 + 筛选 ====== */}
      <div className="mx-auto max-w-5xl px-4 pb-6">
        {/* 搜索框 */}
        <div className="relative mx-auto mb-5 max-w-lg">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a89078]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入汉字 / 拼音 / 编号，如「月」「yue」「002」…"
            className="w-full rounded-xl border border-[#d4c4a8] bg-white/70 py-2.5 pl-10 pr-4 text-sm text-[#3d2b1f] outline-none transition placeholder:text-[#b8a890] focus:border-[#b93a3a]/60 focus:bg-white"
          />
        </div>

        {/* 统计 */}
        <div className="mb-3 text-center text-xs text-[#a89078]">
          显示 <span className="font-bold text-[#3d2b1f]">{filtered.length}</span> / {videos.length}
        </div>

        {/* 拼音首字母筛选 */}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {ALPHA.map((a) => (
            <button
              key={a}
              onClick={() => setAlpha(a)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                alpha === a
                  ? "bg-[#b93a3a] text-white shadow-sm"
                  : "bg-white/60 text-[#8b7355] hover:bg-white hover:text-[#3d2b1f]"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* ====== 卡片列表 ====== */}
      <div className="mx-auto max-w-5xl px-4 pb-20">
        {loading ? (
          <div className="grid place-items-center py-24 text-[#a89078]">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-white/50 px-5 py-16 text-center text-sm text-[#8b7355]">
            视频列表加载失败：{error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-white/50 px-5 py-16 text-center text-sm text-[#8b7355]">
            未找到「{query || alpha}」相关的汉字，换个关键词试试
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {filtered.map((v) => (
              <button
                key={v.url}
                onClick={() => openVideo(v)}
                className="group relative flex flex-col items-center overflow-hidden rounded-xl border border-[#d4c4a8]/60 bg-white/80 py-4 text-center transition hover:-translate-y-0.5 hover:border-[#b93a3a]/40 hover:bg-white hover:shadow-lg active:scale-[0.97]"
              >
                {/* 序号 */}
                <span className="absolute right-2 top-2 text-[10px] font-bold tabular-nums text-[#c4a882]">
                  {v.num ?? ""}
                </span>
                {/* 汉字 */}
                <span
                  className="mb-1 text-4xl font-bold text-[#3d2b1f] transition-transform duration-300 group-hover:scale-110 sm:text-5xl"
                  style={KAI}
                >
                  {v.title}
                </span>
                {/* 拼音 */}
                <span className="text-[11px] tracking-wider text-[#a89078]">
                  {v.pinyin}
                </span>
                {/* hover 播放图标 */}
                <span className="absolute inset-0 grid place-items-center bg-[#3d2b1f]/0 opacity-0 transition group-hover:bg-[#3d2b1f]/5 group-hover:opacity-100">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#b93a3a] text-white shadow-md">
                    <Play size={14} className="ml-0.5" />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ====== 底部印章 ====== */}
      <div className="pb-10 pt-4 text-center">
        <div
          className="mx-auto mb-2 inline-block rounded-lg border-2 border-[#b93a3a] px-4 py-1.5 text-lg font-bold tracking-widest text-[#b93a3a]"
          style={KAI}
        >
          汉字是画出来的
        </div>
        <p className="text-xs tracking-widest text-[#a89078]">
          — 象形汉字启蒙视频库 —
        </p>
      </div>

      {/* ====== 全屏播放器（伪全屏，移动端竖屏友好） ====== */}
      {current && (
        <div
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black"
          onPointerMove={poke}
          onTouchStart={poke}
        >
          {/* 顶部：序号 + 标题 + 退出 */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-12 pt-3 transition-opacity duration-300 ${
              controlsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2 text-white/90">
              <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-xs font-bold tabular-nums">
                {current.num ?? ""}
              </span>
              <span className="truncate text-base font-bold text-white" style={KAI}>
                {current.title}
              </span>
            </div>
            <button
              onClick={exit}
              title="退出全屏"
              className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/85 transition hover:bg-white/20 active:scale-95"
            >
              <Minimize size={18} />
            </button>
          </div>

          {/* 视频 */}
          <div
            className="relative flex-1 cursor-pointer"
            onClick={togglePlay}
            onDoubleClick={() => seek(5)}
          >
            <video
              ref={videoRef}
              src={current.url}
              className="h-full w-full object-contain"
              playsInline
              webkit-playsinline="true"
              preload="auto"
              onPlay={() => {
                setPlaying(true);
                setEnded(false);
                setBuffering(false);
                poke();
              }}
              onPause={() => {
                setPlaying(false);
                poke();
              }}
              onWaiting={() => setBuffering(true)}
              onCanPlay={() => setBuffering(false)}
              onPlaying={() => setBuffering(false)}
              onEnded={() => {
                setEnded(true);
                setPlaying(false);
                setBuffering(false);
                setControlsVisible(true);
              }}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            />
            {buffering && !ended && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={36} className="animate-spin text-white/80" />
                  <span className="text-xs text-white/60">加载中…</span>
                </div>
              </div>
            )}
            {(!playing || ended) && (
              <div className="absolute inset-0 grid place-items-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (ended) {
                      const v = videoRef.current;
                      if (v) {
                        v.currentTime = 0;
                        v.play().catch(() => {});
                      }
                    } else {
                      togglePlay();
                    }
                  }}
                  className="grid h-20 w-20 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-95"
                >
                  {ended ? <RefreshCw size={32} /> : <Play size={32} className="ml-1" />}
                </button>
              </div>
            )}
          </div>

          {/* 底部控制条 */}
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-14 transition-opacity duration-300 ${
              controlsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {/* 进度条 */}
            <div className="pointer-events-auto mb-3 flex items-center gap-3">
              <span className="w-11 text-right text-xs tabular-nums text-white/70">
                {fmt(time)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={time}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  const v = videoRef.current;
                  if (v) v.currentTime = t;
                  setTime(t);
                }}
                className="h-1.5 min-w-0 flex-1 cursor-pointer"
                style={{ accentColor: "#b93a3a" }}
              />
              <span className="w-11 text-xs tabular-nums text-white/70">{fmt(duration)}</span>
            </div>

            {/* 按钮组 */}
            <div className="pointer-events-auto flex items-center justify-center gap-1 sm:gap-2">
              <CtrlBtn onClick={goPrev} label="上一集">
                <ChevronLeft size={22} />
              </CtrlBtn>
              <CtrlBtn onClick={() => seek(-5)} label="后退 5 秒">
                <RotateCcw size={20} />
              </CtrlBtn>
              <button
                onClick={togglePlay}
                aria-label={playing ? "暂停" : "播放"}
                className="mx-2 grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white text-black shadow-lg transition active:scale-95"
              >
                {playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
              </button>
              <CtrlBtn onClick={() => seek(5)} label="快进 5 秒">
                <RotateCw size={20} />
              </CtrlBtn>
              <CtrlBtn onClick={goNext} label="下一集">
                <ChevronRight size={22} />
              </CtrlBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
