import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
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

/* 封面配色轮换（低饱和度马卡龙渐变 + 同色系深色汉字，按序号循环） */
const PALETTES = [
  { bg: "from-rose-200 to-orange-100", text: "text-rose-800" },
  { bg: "from-amber-200 to-yellow-100", text: "text-amber-800" },
  { bg: "from-teal-200 to-cyan-100", text: "text-teal-800" },
  { bg: "from-sky-200 to-blue-100", text: "text-sky-800" },
  { bg: "from-violet-200 to-fuchsia-100", text: "text-violet-800" },
  { bg: "from-lime-200 to-green-100", text: "text-lime-900" },
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
  const [current, setCurrent] = useState<VideoItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  /* 是否已为播放器压入历史记录（保证整个全屏会话只 push 一次） */
  const pushedRef = useRef(false);

  useEffect(() => {
    fetch("/api/hanzi/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos : []))
      .catch((e) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter((v) =>
      `${v.num ?? ""} ${v.title} ${v.filename}`.toLowerCase().includes(q)
    );
  }, [videos, query]);

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
      /* 消费掉打开播放器时压入的历史条目，统一走 popstate → closePlayer 关闭 */
      pushedRef.current = false;
      window.history.back();
    } else {
      closePlayer();
    }
  };

  /* 打开全屏播放器时压入一条历史记录：
     手机返回手势 / 浏览器返回键 → 先关闭播放器（而非退出 /hanzi 页面） */
  useEffect(() => {
    if (current && !pushedRef.current) {
      pushedRef.current = true;
      window.history.pushState({ hanziPlayer: true }, "");
    }
  }, [current]);

  /* 返回手势触发 popstate：关闭播放器（历史条目已被消费，不发生路由回退） */
  useEffect(() => {
    if (!current) return;
    const onPop = () => {
      pushedRef.current = false;
      closePlayer();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [current]);

  /* 切换视频时自动加载播放 */
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

  /* 当前集播放时，预取下一集（上/下一集连续观看无缝衔接） */
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

  /* 键盘快捷键：空格播放/暂停，←/→ 后退/快进 5s，↑/↓ 上/下一集，Esc 退出 */
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
    <div className="pb-16 pt-8">
      {/* 头部 */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/"
          title="返回首页"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:border-white/25 hover:text-white"
        >
          <ArrowLeft size={16} />
        </Link>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 text-lg shadow-glow">
          <Clapperboard size={18} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl" style={KAI}>
            <span className="gradient-text">汉字是画出来的</span>
          </h1>
          <p className="text-xs text-white/45 sm:text-sm">
            {loading ? "加载中…" : `${videos.length} 节动画课`} · 点击卡片立即全屏播放
          </p>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative mb-6 max-w-md">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按汉字名检索，如：日 / 月 / 山…"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-brand-red/60 focus:bg-white/[0.07]"
        />
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="grid place-items-center py-24 text-white/40">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-16 text-center text-sm text-white/50">
          视频列表加载失败：{error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-16 text-center text-sm text-white/50">
          未找到「{query}」相关的汉字，换个关键词试试
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {filtered.map((v, i) => {
            /* 轻微随机旋转（-2°~2°，按序号稳定），让封面更像手写卡片 */
            const tilt = ((v.num ?? i) % 5) - 2;
            return (
              <button
                key={v.url}
                onClick={() => openVideo(v)}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04] text-left transition hover:border-brand-red/50 hover:bg-white/[0.07] active:scale-[0.97]"
              >
                <div
                  className={`relative grid aspect-[4/3] place-items-center bg-gradient-to-br ${
                    PALETTES[(v.num ?? i) % PALETTES.length].bg
                  }`}
                >
                  <span
                    className={`text-6xl font-black transition-transform duration-300 group-hover:scale-110 ${
                      PALETTES[(v.num ?? i) % PALETTES.length].text
                    }`}
                    style={{ ...KAI, transform: `rotate(${tilt}deg)` }}
                  >
                    {v.title}
                  </span>
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white/90">
                    {v.num ?? ""}
                  </span>
                  <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-black">
                      <Play size={15} className="ml-0.5" />
                    </span>
                  </span>
                </div>
                <div className="truncate px-2 py-1.5 text-[11px] text-white/55 group-hover:text-white/80">
                  {v.filename}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 全屏播放器（伪全屏，移动端竖屏友好） */}
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
                style={{ accentColor: "#f43f5e" }}
              />
              <span className="w-11 text-xs tabular-nums text-white/70">{fmt(duration)}</span>
            </div>

            {/* 按钮组：上一集 / 后退5s / 播放暂停 / 快进5s / 下一集 */}
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
