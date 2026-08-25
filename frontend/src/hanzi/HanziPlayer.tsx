import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Loader2,
  Play,
  Search,
  Shuffle,
  X,
} from "lucide-react";
import {
  loadProgress,
  loadAutoplay,
  saveAutoplay,
  saveProgress,
  HanziProgressMap,
} from "./progress";
import { loadCachedList, saveCachedList } from "./listCache";

interface VideoItem {
  id: number | null;
  num: number | null;
  title: string;
  pinyin: string;
  pinyin_first: string;
  filename: string;
  url: string;
}

/* 楷体字体栈 */
const KAI: React.CSSProperties = {
  fontFamily: "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', 'Noto Serif SC', serif",
};

/* 拼音首字母表（按实际出现的字母） */
const ALPHA = [
  "全部", "a", "b", "c", "d", "e", "f", "g", "h", "j", "k", "l", "m",
  "n", "q", "r", "s", "t", "w", "x", "y", "z",
];

/**
 * 汉字列表页 /hanzi（水墨中国风）
 * 点击卡片弹出悬浮播放器，四周高斯模糊背景。
 */
export default function HanziPlayer() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [alpha, setAlpha] = useState("全部");
  const [progress, setProgress] = useState<HanziProgressMap>(() => loadProgress());

  /* 播放器 modal 状态 */
  const [activeNum, setActiveNum] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [autoplay, setAutoplay] = useState<boolean>(() => loadAutoplay());
  const [pickerProgress, setPickerProgress] = useState<HanziProgressMap>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaveRef = useRef(0);
  const resumedNumRef = useRef<number | null>(null);

  /* 加载视频列表：当天缓存优先，跨天刷新，每天最多请求一次后端 */
  useEffect(() => {
    const cached = loadCachedList<VideoItem>();
    if (cached) {
      setVideos(cached);
      setLoading(false);
      return;
    }
    fetch("/api/hanzi/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const list = Array.isArray(d.videos) ? d.videos : [];
        setVideos(list);
        saveCachedList(list);
      })
      .catch((e) => {
        /* 请求失败：降级用任意旧缓存，避免页面空白 */
        const stale = loadCachedList<VideoItem>({ allowStale: true });
        if (stale) setVideos(stale);
        else setError(e?.message || "加载失败");
      })
      .finally(() => setLoading(false));
  }, []);

  /* 窗口重新聚焦 / 页面可见时刷新观看进度 */
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

  const current = useMemo(
    () => videos.find((v) => v.num === activeNum) || null,
    [videos, activeNum]
  );
  const idx = useMemo(
    () => videos.findIndex((v) => v.num === activeNum),
    [videos, activeNum]
  );
  const prevVideo = idx > 0 ? videos[idx - 1] : null;
  const nextVideo = idx >= 0 && idx < videos.length - 1 ? videos[idx + 1] : null;

  /* 打开播放器时禁止背景滚动 */
  useEffect(() => {
    if (activeNum != null) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [activeNum]);

  /* 切集时自动加载播放 + 刷新选集面板进度 */
  useEffect(() => {
    if (!current) return;
    const v = videoRef.current;
    if (v) {
      v.load();
      v.play().catch(() => {});
    }
    setPickerProgress(loadProgress());
  }, [current]);

  /* 续播：回到上次观看位置 */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || activeNum == null) return;
    if (resumedNumRef.current === activeNum) return;
    resumedNumRef.current = activeNum;
    const p = loadProgress()[String(activeNum)];
    if (p && p.dur > 0 && p.pos > 5 && p.pos < p.dur * 0.97) {
      const seek = () => { if (v.duration > 0) v.currentTime = p.pos; };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    }
  }, [activeNum]);

  /* 节流记录观看进度（3s 一次） */
  const onTime = () => {
    const v = videoRef.current;
    if (!v || !current) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 3000) return;
    lastSaveRef.current = now;
    saveProgress(current.num, v.currentTime, v.duration || 0);
  };

  /* 播完：标记已学 + 连播下一集 */
  const onEnded = () => {
    if (!current) return;
    saveProgress(current.num, 0, 0, true);
    if (autoplay && nextVideo?.num != null) {
      setActiveNum(nextVideo.num);
    }
  };

  /* 预取下一集 */
  useEffect(() => {
    if (!nextVideo) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = nextVideo.url;
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, [nextVideo]);

  /* 键盘快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeNum == null) return;
      if (e.key === "Escape") {
        if (showPicker) setShowPicker(false);
        else closeModal();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (prevVideo) setActiveNum(prevVideo.num);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (nextVideo) setActiveNum(nextVideo.num);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevVideo, nextVideo, showPicker, activeNum]);

  const closeModal = () => {
    const v = videoRef.current;
    if (v && current) saveProgress(current.num, v.currentTime, v.duration || 0);
    setActiveNum(null);
    setShowPicker(false);
    resumedNumRef.current = null;
  };

  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    saveAutoplay(next);
  };

  const pickVideo = (num: number | null) => {
    setShowPicker(false);
    if (num != null && num !== activeNum) {
      setActiveNum(num);
    }
  };

  /* 搜索框回车 / 随机 */
  const goFirst = () => {
    if (filtered.length && filtered[0].num != null) {
      setActiveNum(filtered[0].num);
    }
  };
  const goRandom = () => {
    if (!filtered.length) return;
    const v = filtered[Math.floor(Math.random() * filtered.length)];
    setActiveNum(v.num);
  };

  const clearFilters = () => {
    setQuery("");
    setAlpha("全部");
  };

  const pad = (n: number | null) => String(n ?? "").padStart(3, "0");

  return (
    <div className="min-h-screen" style={{ background: "#faf6f1" }}>
      {/* ====== 顶部 Hero 区 ====== */}
      <div className="relative overflow-hidden px-4 pb-10 pt-12 sm:pt-16">
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
          <h1
            className="mb-3 text-4xl font-bold tracking-widest text-[#3d2b1f] sm:text-5xl"
            style={KAI}
          >
            汉字是画出来的
          </h1>
          <p className="mb-2 text-sm tracking-[0.3em] text-[#8b7355] sm:text-base">
            观其形 · 知其义 · 字中有画 · 画中有字
          </p>
          <p className="text-xs text-[#a89078] sm:text-sm">
            共收录 <span className="font-bold text-[#b93a3a]">{videos.length}</span> 个象形汉字 · 点击卡片即可观看
          </p>

          <button
            onClick={goRandom}
            disabled={!filtered.length}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#b93a3a]/50 bg-white/80 px-5 py-2 text-sm font-medium text-[#b93a3a] shadow-sm transition hover:bg-[#b93a3a] hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            <Shuffle size={15} />
            随机学一个
          </button>
        </div>
      </div>

      {/* ====== 搜索 + 筛选 ====== */}
      <div className="mx-auto max-w-5xl px-4 pb-6">
        <div className="relative mx-auto mb-4 max-w-lg">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a89078]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goFirst()}
            placeholder="输入汉字 / 拼音 / 编号，回车直达"
            className="w-full rounded-xl border border-[#d4c4a8] bg-paper-50 py-2.5 pl-10 pr-10 text-sm text-[#3d2b1f] outline-none transition placeholder:text-[#b8a890] focus:border-[#b93a3a]/60 focus:bg-white"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              title="清空搜索"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a89078] transition hover:bg-[#f5efe6] hover:text-[#3d2b1f]"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 字母筛选：单行横向滑动 */}
        <div className="no-scrollbar -mx-4 mb-3 flex items-center gap-1.5 overflow-x-auto px-4 pb-1">
          {ALPHA.map((a) => (
            <button
              key={a}
              onClick={() => setAlpha(a)}
              className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                alpha === a
                  ? "bg-[#b93a3a] text-white shadow-sm"
                  : "bg-paper-50 text-[#8b7355] hover:bg-white hover:text-[#3d2b1f]"
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="mb-1 flex items-center justify-center gap-2 text-xs text-[#a89078]">
          <span>
            显示 <span className="font-bold text-[#3d2b1f]">{filtered.length}</span> / {videos.length}
          </span>
          {alpha !== "全部" && (
            <button
              onClick={() => setAlpha("全部")}
              className="inline-flex items-center gap-0.5 rounded-full border border-[#b93a3a]/40 px-2 py-0.5 text-[10px] text-[#b93a3a] transition hover:bg-[#b93a3a]/10"
            >
              拼音 {alpha} <X size={10} />
            </button>
          )}
          {(query || alpha !== "全部") && (
            <button
              onClick={clearFilters}
              className="text-[#a89078] underline-offset-2 transition hover:text-[#b93a3a] hover:underline"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* ====== 卡片列表 ====== */}
      <div className="mx-auto max-w-5xl px-4 pb-20">
        {loading ? (
          <div className="grid place-items-center py-24 text-[#a89078]">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center text-sm text-[#8b7355]">
            视频列表加载失败：{error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center">
            <p className="text-sm text-[#8b7355]">
              未找到「{query || (alpha !== "全部" ? `拼音 ${alpha}` : "")}」相关的汉字，换个关键词试试
            </p>
            <button
              onClick={clearFilters}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#b93a3a]/50 px-4 py-1.5 text-xs font-medium text-[#b93a3a] transition hover:bg-[#b93a3a] hover:text-white"
            >
              <X size={12} />
              清除筛选
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {filtered.map((v) => {
              const p = v.num != null ? progress[String(v.num)] : undefined;
              const watchedPct =
                p && p.dur > 0 && !p.done
                  ? Math.max(0, Math.min(100, (p.pos / p.dur) * 100))
                  : p?.done
                    ? 100
                    : 0;
              const isActive = v.num === activeNum;
              return (
                <button
                  key={v.url}
                  onClick={() => v.num != null && setActiveNum(v.num)}
                  className={`group relative flex flex-col items-center overflow-hidden rounded-xl border bg-paper-50 py-4 text-center transition hover:-translate-y-0.5 hover:border-[#b93a3a]/40 hover:bg-white hover:shadow-lg active:scale-[0.97] ${
                    isActive
                      ? "border-[#b93a3a] ring-2 ring-[#b93a3a]/50"
                      : "border-[#d4c4a8]/60"
                  }`}
                >
                  {/* 序号 + 已学徽章 */}
                  <span className="absolute right-2 top-2 flex items-center gap-1">
                    {p?.done && (
                      <span className="rounded bg-[#b93a3a] px-1 py-px text-[9px] font-bold text-white">
                        已学
                      </span>
                    )}
                    <span className="text-[10px] font-bold tabular-nums text-[#c4a882]">
                      {v.num ?? ""}
                    </span>
                  </span>

                  <span
                    className="mb-1 text-4xl font-bold text-[#3d2b1f] transition-transform duration-300 group-hover:scale-110 sm:text-5xl"
                    style={KAI}
                  >
                    {v.title}
                  </span>
                  <span className="text-[11px] tracking-wider text-[#a89078]">
                    {v.pinyin}
                  </span>

                  {/* 观看进度条 */}
                  {watchedPct > 0 && watchedPct < 100 && (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#d4c4a8]/40">
                      <span
                        className="block h-full bg-[#c98600] transition-[width] duration-300"
                        style={{ width: `${watchedPct}%` }}
                      />
                    </span>
                  )}
                  {watchedPct === 100 && (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#b93a3a]/70" />
                  )}

                  <span className="absolute inset-0 grid place-items-center bg-[#3d2b1f]/0 opacity-0 transition group-hover:bg-[#3d2b1f]/5 group-hover:opacity-100">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#b93a3a] text-white shadow-md">
                      <Play size={14} className="ml-0.5" />
                    </span>
                  </span>
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
          汉字是画出来的
        </div>
        <p className="text-xs tracking-widest text-[#a89078]">
          — 象形汉字启蒙视频库 —
        </p>
      </div>

      {/* ================================================================
          弹出式播放器 Modal
      ================================================================ */}
      {activeNum != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#3d2b1f]/50 p-4 backdrop-blur-md"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl border border-[#d4c4a8] bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {!current ? (
              <div className="px-5 py-16 text-center text-sm text-[#8b7355]">
                未找到编号「{activeNum}」的汉字
              </div>
            ) : (
              <>
                {/* 顶部信息栏 */}
                <div className="flex items-center justify-between px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span
                      className="text-3xl font-bold text-[#3d2b1f] sm:text-4xl"
                      style={KAI}
                    >
                      {current.title}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-[#8b7355]">
                        {current.pinyin}
                      </span>
                      <button
                        onClick={() => setShowPicker(true)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#a89078] transition hover:text-[#b93a3a]"
                      >
                        <Grid3X3 size={11} />
                        第 {pad(current.num)} 个 · 共 {videos.length} 个
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* 连播开关 */}
                    <button
                      onClick={toggleAutoplay}
                      title={autoplay ? "关闭自动连播" : "开启自动连播"}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition active:scale-95 ${
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
                    <button
                      onClick={closeModal}
                      title="关闭"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d4c4a8] text-[#8b7355] transition hover:border-[#b93a3a] hover:text-[#b93a3a] active:scale-95"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* 视频 */}
                <div className="relative bg-black">
                  <video
                    ref={videoRef}
                    src={current.url}
                    className="w-full"
                    controls
                    playsInline
                    preload="auto"
                    onTimeUpdate={onTime}
                    onEnded={onEnded}
                  />
                </div>

                {/* 底部导航 */}
                <div className="flex items-stretch border-t border-[#d4c4a8]/40">
                  {prevVideo ? (
                    <button
                      onClick={() => setActiveNum(prevVideo.num)}
                      className="flex flex-1 items-center gap-2 px-4 py-3 text-left transition hover:bg-[#faf6f1] active:bg-[#f5efe6] sm:px-5"
                    >
                      <ChevronLeft size={18} className="shrink-0 text-[#a89078]" />
                      <div className="min-w-0">
                        <span className="block text-[10px] text-[#a89078]">上一个</span>
                        <span
                          className="block truncate text-base font-bold text-[#3d2b1f] sm:text-lg"
                          style={KAI}
                        >
                          {prevVideo.title}
                        </span>
                      </div>
                    </button>
                  ) : (
                    <div className="flex flex-1 cursor-not-allowed items-center gap-2 px-4 py-3 text-left opacity-40 sm:px-5">
                      <ChevronLeft size={18} className="shrink-0 text-[#a89078]" />
                      <div className="min-w-0">
                        <span className="block text-[10px] text-[#a89078]">上一个</span>
                        <span
                          className="block truncate text-base font-bold text-[#3d2b1f] sm:text-lg"
                          style={KAI}
                        >
                          已是第一集
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="w-px bg-[#d4c4a8]/40" />

                  {nextVideo ? (
                    <button
                      onClick={() => setActiveNum(nextVideo.num)}
                      className="flex flex-1 items-center justify-end gap-2 px-4 py-3 text-right transition hover:bg-[#faf6f1] active:bg-[#f5efe6] sm:px-5"
                    >
                      <div className="min-w-0">
                        <span className="block text-[10px] text-[#a89078]">下一个</span>
                        <span
                          className="block truncate text-base font-bold text-[#3d2b1f] sm:text-lg"
                          style={KAI}
                        >
                          {nextVideo.title}
                        </span>
                      </div>
                      <ChevronRight size={18} className="shrink-0 text-[#a89078]" />
                    </button>
                  ) : (
                    <div className="flex flex-1 cursor-not-allowed items-center justify-end gap-2 px-4 py-3 text-right opacity-40 sm:px-5">
                      <div className="min-w-0">
                        <span className="block text-[10px] text-[#a89078]">下一个</span>
                        <span
                          className="block truncate text-base font-bold text-[#3d2b1f] sm:text-lg"
                          style={KAI}
                        >
                          已是最后一集
                        </span>
                      </div>
                      <ChevronRight size={18} className="shrink-0 text-[#a89078]" />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ====== 选集面板（嵌套在播放器 z-index 之上） ====== */}
      {showPicker && (
        <div
          className="animate-hanzi-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-[#3d2b1f]/40 p-4 backdrop-blur-sm"
          onClick={() => setShowPicker(false)}
        >
          <div
            className="animate-hanzi-scale-in w-full max-w-2xl rounded-2xl border border-[#d4c4a8] bg-[#faf6f1] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[#3d2b1f]" style={KAI}>
                选集 · 共 {videos.length} 个
              </h3>
              <button
                onClick={() => setShowPicker(false)}
                title="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d4c4a8] text-[#8b7355] transition hover:border-[#b93a3a] hover:text-[#b93a3a] active:scale-95"
              >
                <X size={15} />
              </button>
            </div>
            <div className="grid max-h-[60vh] grid-cols-6 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-9">
              {videos.map((v) => {
                const p = pickerProgress[String(v.num)];
                const active = v.num === current?.num;
                return (
                  <button
                    key={v.num}
                    onClick={() => pickVideo(v.num)}
                    className={`relative rounded-lg py-2 text-sm font-medium tabular-nums transition active:scale-95 ${
                      active
                        ? "bg-[#b93a3a] text-white shadow-md"
                        : p?.done
                          ? "bg-[#b93a3a]/10 text-[#b93a3a] hover:bg-[#b93a3a]/20"
                          : "bg-white text-[#3d2b1f] hover:bg-[#f5efe6]"
                    }`}
                  >
                    {v.num}
                    {p?.done && !active && (
                      <span className="absolute right-1 top-0.5 text-[9px] leading-none">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
