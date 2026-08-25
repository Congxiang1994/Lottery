import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
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
  const videoRef = useRef<HTMLVideoElement>(null);

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

  /* 切集时自动加载播放 + 回到顶部 */
  useEffect(() => {
    if (!current) return;
    const v = videoRef.current;
    if (v) {
      v.load();
      v.play().catch(() => {});
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [current]);

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

  /* 键盘快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (prevVideo) navigate(`/hanzi/${prevVideo.num}`);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (nextVideo) navigate(`/hanzi/${nextVideo.num}`);
      } else if (e.key === "Escape") {
        navigate("/hanzi");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevVideo, nextVideo, navigate]);

  return (
    <div className="min-h-screen" style={{ background: "#faf6f1" }}>
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:pt-10">
        {/* ====== 返回栏 ====== */}
        <div className="mb-6">
          <Link
            to="/hanzi"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#c4a882]/40 bg-white/50 px-3 py-1.5 text-sm text-[#8b7355] transition hover:border-[#a67c52] hover:text-[#5c4033]"
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
          <div className="rounded-2xl border border-[#d4c4a8] bg-white/50 px-5 py-16 text-center text-sm text-[#8b7355]">
            视频列表加载失败：{error}
          </div>
        ) : !current ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-white/50 px-5 py-16 text-center text-sm text-[#8b7355]">
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
                  <span className="text-[11px] text-[#a89078]">
                    第 {String(current.num).padStart(3, "0")} 个 · 共 {videos.length} 个
                  </span>
                </div>
              </div>
              <button
                onClick={() => navigate("/hanzi")}
                title="返回列表"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d4c4a8] text-[#8b7355] transition hover:border-[#b93a3a] hover:text-[#b93a3a] active:scale-95"
              >
                <X size={16} />
              </button>
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
                      —
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
                      —
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
    </div>
  );
}
