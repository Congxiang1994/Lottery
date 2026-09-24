import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Loader2,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { Story, storyApi } from "./api";

/**
 * 每日儿童睡前故事 /story
 * 公开页：按故事日期倒序展示（只展示已发布），点击卡片打开全文。
 * 睡前阅读优先：正文 17px / 行高 1.9 / 暖米底，可选夜间模式（localStorage 记忆）。
 */

const WEEK = "日一二三四五六";

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEK[d.getDay()]}`;
}

function tagsOf(tags: string): string[] {
  return (tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function StoryPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Story | null>(null);
  const [night, setNight] = useState(
    () => localStorage.getItem("story_night") === "1",
  );

  useEffect(() => {
    storyApi
      .publicList()
      .then((d) => setStories(d.items ?? []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem("story_night", night ? "1" : "0");
    // 夜间模式整页沉浸：给 <html> 挂 class，样式见 index.css 的 .story-night 段。
    // 离开页面/关掉夜间即移除，不会影响其他页面。
    document.documentElement.classList.toggle("story-night", night);
    return () => document.documentElement.classList.remove("story-night");
  }, [night]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActive(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const today = todayStr();
  const hero = stories[0]?.story_date === today ? stories[0] : null;
  const rest = hero ? stories.slice(1) : stories;

  const dim = night ? "text-[#a99683]" : "text-paper-700";
  const faint = night ? "text-[#8a7866]" : "text-paper-500";
  const strong = night ? "text-[#f2e9dc]" : "text-paper-900";
  const card = night
    ? "border-[#3a2f28] bg-[#221b17] hover:border-[#5a4636]"
    : "glass border-paper-100 card-hover";

  return (
    <div
      className={`-mx-5 min-h-screen px-5 pt-10 pb-16 transition-colors ${
        night ? "bg-[#17120f]" : ""
      }`}
    >
      <div className="mx-auto max-w-3xl">
        {/* 页头 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1
              className={`flex items-center gap-2 text-3xl font-extrabold tracking-tight ${strong}`}
            >
              <BookOpen size={26} className="text-brand-gold" />
              睡前故事
            </h1>
            <p className={`mt-1.5 text-sm ${dim}`}>
              {stories.length > 0
                ? `共 ${stories.length} 篇 · 按日期倒序`
                : "每晚一篇，读完就睡"}
            </p>
          </div>
          <button
            onClick={() => setNight((v) => !v)}
            title={night ? "切换到日间模式" : "切换到夜间模式"}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition ${
              night
                ? "border-[#3a2f28] bg-[#221b17] text-[#e8c37a] hover:bg-[#2a221d]"
                : "border-paper-200 bg-paper-100 text-paper-800 hover:bg-paper-200"
            }`}
          >
            {night ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>

        {/* 状态 */}
        {loading && (
          <div className="mt-24 flex justify-center">
            <Loader2 size={22} className="animate-spin text-paper-500" />
          </div>
        )}
        {err && (
          <div className="mt-6 rounded-2xl border border-rose-600/25 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            加载失败：{err}
          </div>
        )}
        {!loading && !err && stories.length === 0 && (
          <div
            className={`mt-16 rounded-3xl border p-12 text-center ${card}`}
          >
            <BookOpen size={30} className="mx-auto text-paper-300" />
            <p className={`mt-3 text-sm ${dim}`}>还没有故事</p>
          </div>
        )}

        {/* 今晚的故事 */}
        {hero && (
          <button
            onClick={() => setActive(hero)}
            className="group mt-7 block w-full text-left"
          >
            <div
              className={`relative overflow-hidden rounded-3xl border p-6 transition ${
                night
                  ? "border-[#3a2f28] bg-[#221b17] hover:border-[#5a4636]"
                  : "border-brand-gold/45 bg-gradient-to-br from-[#fffdf9] to-[#fbf0e0] hover:shadow-card"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-gold/15 px-2.5 py-1 text-[10px] font-semibold text-brand-gold">
                今晚的故事
              </span>
              <h2 className={`mt-3 text-2xl font-bold leading-snug ${strong}`}>
                {hero.title}
              </h2>
              {hero.summary && (
                <p className={`mt-2 text-sm leading-relaxed ${dim}`}>
                  {hero.summary}
                </p>
              )}
              <div className={`mt-4 flex items-center gap-2 text-xs ${faint}`}>
                <CalendarDays size={13} />
                {formatDate(hero.story_date)}
                <span className="ml-auto inline-flex items-center gap-1 font-medium text-brand-gold">
                  点击阅读
                  <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          </button>
        )}

        {/* 历史列表 */}
        {rest.length > 0 && (
          <>
            {hero && (
              <div className={`mt-9 mb-3 flex items-center gap-3 text-xs font-medium ${faint}`}>
                <span>更早的故事</span>
                <span
                  className={`h-px flex-1 ${night ? "bg-[#3a2f28]" : "bg-paper-200"}`}
                />
              </div>
            )}
            <div className="mt-3 space-y-3">
              {rest.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActive(s)}
                  className="block w-full text-left"
                >
                  <div className={`rounded-2xl border px-5 py-4 transition ${card}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className={`text-base font-semibold ${strong}`}>
                        {s.title}
                      </h3>
                      <span className={`shrink-0 text-[11px] tabular-nums ${faint}`}>
                        {formatDate(s.story_date)}
                      </span>
                    </div>
                    {s.summary && (
                      <p className={`mt-1.5 line-clamp-2 text-xs leading-relaxed ${dim}`}>
                        {s.summary}
                      </p>
                    )}
                    {tagsOf(s.tags).length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {tagsOf(s.tags).map((t) => (
                          <span
                            key={t}
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              night
                                ? "border-[#3a2f28] text-[#a99683]"
                                : "border-paper-200 bg-paper-100 text-paper-700"
                            }`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 全文弹窗 */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#3d2b1f]/60 p-4 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div
            className={`my-8 w-full max-w-2xl rounded-3xl border p-7 shadow-card ${
              night
                ? "border-[#3a2f28] bg-[#1e1815]"
                : "glass"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={`flex items-center gap-1.5 text-xs ${faint}`}>
                  <CalendarDays size={13} />
                  {formatDate(active.story_date)}
                </div>
                <h2 className={`mt-2 text-2xl font-bold leading-snug ${strong}`}>
                  {active.title}
                </h2>
                {active.summary && (
                  <p className={`mt-2 text-sm ${dim}`}>{active.summary}</p>
                )}
              </div>
              <button
                onClick={() => setActive(null)}
                title="关闭"
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition ${
                  night
                    ? "border-[#3a2f28] text-[#a99683] hover:bg-[#2a221d]"
                    : "border-paper-200 bg-paper-100 text-paper-800 hover:bg-paper-200"
                }`}
              >
                <X size={15} />
              </button>
            </div>

            <div
              className={`mt-6 whitespace-pre-wrap text-[17px] leading-[1.9] ${
                night ? "text-[#e8ddd0]" : "text-paper-800"
              }`}
            >
              {active.content}
            </div>

            {tagsOf(active.tags).length > 0 && (
              <div className="mt-7 flex flex-wrap gap-1.5">
                {tagsOf(active.tags).map((t) => (
                  <span
                    key={t}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] ${
                      night
                        ? "border-[#3a2f28] text-[#a99683]"
                        : "border-paper-200 bg-paper-100 text-paper-700"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
