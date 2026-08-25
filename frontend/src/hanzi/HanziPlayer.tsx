import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Play, Search } from "lucide-react";

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

/* 拼音首字母表 */
const ALPHA = [
  "全部", "a", "b", "c", "d", "e", "f", "g", "h", "j", "k", "l", "m",
  "n", "q", "r", "s", "t", "w", "x", "y", "z",
];

/**
 * 汉字列表页 /hanzi（水墨中国风）
 * 点击卡片跳转到独立播放页 /hanzi/:num。
 */
export default function HanziPlayer() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [alpha, setAlpha] = useState("全部");

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
        </div>
      </div>

      {/* ====== 搜索 + 筛选 ====== */}
      <div className="mx-auto max-w-5xl px-4 pb-6">
        <div className="relative mx-auto mb-5 max-w-lg">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a89078]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入汉字 / 拼音 / 编号，如「月」「yue」「002」…"
            className="w-full rounded-xl border border-[#d4c4a8] bg-paper-50 py-2.5 pl-10 pr-4 text-sm text-[#3d2b1f] outline-none transition placeholder:text-[#b8a890] focus:border-[#b93a3a]/60 focus:bg-white"
          />
        </div>

        <div className="mb-3 text-center text-xs text-[#a89078]">
          显示 <span className="font-bold text-[#3d2b1f]">{filtered.length}</span> / {videos.length}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {ALPHA.map((a) => (
            <button
              key={a}
              onClick={() => setAlpha(a)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                alpha === a
                  ? "bg-[#b93a3a] text-white shadow-sm"
                  : "bg-paper-50 text-[#8b7355] hover:bg-white hover:text-[#3d2b1f]"
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
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center text-sm text-[#8b7355]">
            视频列表加载失败：{error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#d4c4a8] bg-paper-50 px-5 py-16 text-center text-sm text-[#8b7355]">
            未找到「{query || alpha}」相关的汉字，换个关键词试试
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {filtered.map((v) => (
              <Link
                key={v.url}
                to={`/hanzi/${v.num}`}
                className="group relative flex flex-col items-center overflow-hidden rounded-xl border border-[#d4c4a8]/60 bg-paper-50 py-4 text-center transition hover:-translate-y-0.5 hover:border-[#b93a3a]/40 hover:bg-white hover:shadow-lg active:scale-[0.97]"
              >
                <span className="absolute right-2 top-2 text-[10px] font-bold tabular-nums text-[#c4a882]">
                  {v.num ?? ""}
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
                <span className="absolute inset-0 grid place-items-center bg-[#3d2b1f]/0 opacity-0 transition group-hover:bg-[#3d2b1f]/5 group-hover:opacity-100">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#b93a3a] text-white shadow-md">
                    <Play size={14} className="ml-0.5" />
                  </span>
                </span>
              </Link>
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
    </div>
  );
}
