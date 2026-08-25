import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Loader2,
  X,
} from "lucide-react";
import {
  loadProgress,
  loadAutoplay,
  saveAutoplay,
  saveProgress,
  HanziProgressMap,
} from "./progress";

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

/**
 * 独立播放页 /hanzi/:num
 * 点击列表卡片跳转到此页，全页展示播放器（水墨风）。
 */
export default function HanziPlayPage() {
  const { num } = useParams();
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [autoplay, setAutoplay] = useState<boolean>(() => loadAutoplay());
  const [pickerProgress, setPickerProgress] = useState<HanziProgressMap>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaveRef = useRef(0);
  const resumedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/hanzi/list")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setVideos(Array.isArray(d.videos) ? d.videos : []))
      .catch((e) => setError(e?.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const idx = useMemo(
    () => videos.findIndex((v) => v.num === Number(num)),
    [videos, num]
  );
  const current = idx >= 0 ? videos[idx] : null;
  const prevVideo = idx > 0 ? videos[idx - 1] : null;
  const nextVideo = idx >= 0 && idx < videos.length - 1 ? videos[idx + 1] : null;

  /* 切集时自动加载播放 + 回顶部 + 刷新选集面板进度 */
  useEffect(() => {
    if (!current) return;
    const v = videoRef.current;
    if (v) {
      v.load();
      v.play().catch(() => {});
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    setPickerProgress(loadProgress());
  }, [current]);

  /* 续播：回到上次观看位置（跳过接近片尾的位置） */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !current) return;
    const key = String(current.num);
    if (resumedRef.current.has(key)) return;
    resumedRef.current.add(key);
    const p = loadProgress()[key];
    if (p && p.dur > 0 && p.pos > 5 && p.pos < p.dur * 0.97) {
      const seek = () => {
        if (v.duration > 0) v.currentTime = p.pos;
      };
      if (v.readyState >= 1) seek();
      else v.addEventListener("loadedmetadata", seek, { once: true });
    }
  }, [current]);

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
      navigate(`/hanzi/${nextVideo.num}`);
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
    return () => {
      document.head.removeChild(link);
    };
  }, [nextVideo]);

  /* 键盘快捷键：↑↓ 切集、Esc 关面板/返回列表 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showPicker) setShowPicker(false);
        else navigate("/hanzi");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (prevVideo) navigate(`/hanzi/${prevVideo.num}`);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (nextVideo) navigate(`/hanzi/${nextVideo.num}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevVideo, nextVideo, navigate, showPicker]);

  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    saveAutoplay(next);
  };

  const pad = (n: number | null) => String(n ?? "").padStart(3, "0");

  return (
    <div className="min-h-screen" style={{ background: "#faf6f1" }}>
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
        {/* ====== 返回栏 ====== */}
        <div className="mb-6">
          <Link
            to="/hanzi"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#c4a882]/40 bg-paper-50 px-3 py-1.5 text-sm text-[#8b7355] transition hover:border-[#a67c52] hover:text-[#5c4033]"
          >
            <ArrowLeft size={15} />
            返回列表
          </Link>
        </div>

        {loading ? (
          <div className="grid place-items-center py-24 text-[#a89078]">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center text-sm text-[#8b7355]">
            视频列表加载失败：{error}
          </div>
        ) : !current ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center text-sm text-[#8b7355]">
            未找到编号「{num}」的汉字，可能已被移除
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#d4c4a8] bg-white shadow-md">
            {/* ====== 顶部信息栏 ====== */}
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
                  {/* 点击打开选集面板 */}
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
                  onClick={() => navigate("/hanzi")}
                  title="返回列表"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d4c4a8] text-[#8b7355] transition hover:border-[#b93a3a] hover:text-[#b93a3a] active:scale-95"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* ====== 视频（原生 controls） ====== */}
            <div className="relative bg-black">
              <video
                ref={videoRef}
                src={current.url}
                className="w-full"
                controls
                playsInline
                webkit-playsinline="true"
                preload="auto"
                onTimeUpdate={onTime}
                onEnded={onEnded}
              />
            </div>

            {/* ====== 底部导航：上一个 / 下一个 ====== */}
            <div className="flex items-stretch border-t border-[#d4c4a8]/40">
              {prevVideo ? (
                <Link
                  to={`/hanzi/${prevVideo.num}`}
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
                </Link>
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
                <Link
                  to={`/hanzi/${nextVideo.num}`}
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
                </Link>
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
          </div>
        )}

        {/* ====== 底部印章 ====== */}
        <div className="pb-4 pt-10 text-center">
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
      </div>

      {/* ====== 选集面板（快速跳转任意一集） ====== */}
      {showPicker && (
        <div
          className="animate-hanzi-fade-in fixed inset-0 z-50 flex items-center justify-center bg-[#3d2b1f]/40 p-4 backdrop-blur-sm"
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
                    onClick={() => {
                      setShowPicker(false);
                      navigate(`/hanzi/${v.num}`);
                    }}
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
