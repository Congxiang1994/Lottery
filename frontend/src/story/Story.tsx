import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Loader2,
  Pause,
  Volume2,
  X,
} from "lucide-react";
import { Story, storyApi } from "./api";

/**
 * 每日儿童睡前故事 /story
 * 公开页：按故事日期倒序展示（只展示已发布），点击卡片打开全文。
 * 列表卡：左侧金色日期竖块做版式锚点，标签按内容上淡色。
 * 详情弹窗：书页化排版 —— 居中刊头 + 段落首行缩进 + 「睡吧」结尾落点句，
 *   底栏支持 上一篇/下一篇、阅读字号（localStorage 记忆）。
 * 睡前阅读优先：正文 15.5/17/19px 三档，行高 2.05，暖米底。
 * 夜间模式跟随全站全局开关（Nav 右上角，useTheme），页内不再单独切换。
 */

const WEEK = "日一二三四五六";
const FONT_KEY = "story_font";
const FONTS = { s: 15.5, m: 17, l: 19 } as const;
type FontKey = keyof typeof FONTS;

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

/** 拆出 月 / 日 / 星期，用于列表卡的日期竖块 */
function dateParts(s: string): { m: string; d: string; w: string } {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { m: "", d: "", w: "" };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { m: String(d.getMonth() + 1), d: String(d.getDate()), w: WEEK[d.getDay()] };
}

function tagsOf(tags: string): string[] {
  return (tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 正文按空行切块（连续换行压平），块内保留单换行为 <br/>（诗行感） */
function paragraphsOf(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** 标签淡色盘：日/夜各一套，按 tag 内容哈希固定取色 */
const TAG_PALETTES: { d: [string, string]; n: [string, string] }[] = [
  { d: ["#faeeda", "#8a5a10"], n: ["rgba(201,134,0,0.18)", "#e8c37a"] }, // 琥珀
  { d: ["#e1f5ee", "#0f6e56"], n: ["rgba(45,166,130,0.18)", "#8fd8bd"] }, // 青绿
  { d: ["#e6f1fb", "#1a5fa5"], n: ["rgba(59,130,246,0.18)", "#a5c3f2"] }, // 蓝
  { d: ["#fbeaf0", "#993556"], n: ["rgba(212,83,126,0.18)", "#eeb1c6"] }, // 粉
  { d: ["#eaf3de", "#3f6d12"], n: ["rgba(99,153,34,0.18)", "#b9d690"] }, // 草绿
];

function tagPalette(tag: string) {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_PALETTES[h % TAG_PALETTES.length];
}

function Tag({ t, night }: { t: string; night: boolean }) {
  const p = tagPalette(t);
  const [bg, color] = night ? p.n : p.d;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[10px] font-medium"
      style={{ background: bg, color }}
    >
      {t}
    </span>
  );
}

/** 复制按钮：点击复制文本到剪贴板，成功后短暂变为对勾 */
function CopyBtn({
  text, night, size = 13,
}: { text: string; night: boolean; size?: number }) {
  const [ok, setOk] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 不触发卡片/弹窗的点击行为
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板 API 不可用（如非安全上下文）时退回 execCommand
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  };
  return (
    <button
      onClick={copy}
      title={ok ? "已复制" : "复制全文"}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition ${
        ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-600"
          : night
            ? "border-[#3a2f28] text-[#a99683] hover:bg-[#2a221d]"
            : "border-paper-200 bg-paper-100/80 text-paper-700 hover:bg-paper-200"
      }`}
    >
      {ok ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

/** 朗读按钮：audio_url 有值时才渲染，播放中变暂停图标 */
function AudioBtn({ src, night }: { src: string; night: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    if (!ref.current) {
      ref.current = new Audio(src);
      ref.current.onended = () => setPlaying(false);
    }
    if (playing) {
      ref.current.pause();
      setPlaying(false);
    } else {
      ref.current.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };
  useEffect(() => () => ref.current?.pause(), []);
  return (
    <button
      onClick={toggle}
      title={playing ? "暂停朗读" : "播放朗读"}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition ${
        night
          ? "border-[#3a2f28] text-[#a99683] hover:bg-[#2a221d]"
          : "border-paper-200 bg-paper-100/80 text-paper-700 hover:bg-paper-200"
      }`}
    >
      {playing ? <Pause size={13} /> : <Volume2 size={13} />}
    </button>
  );
}

/** 书页化正文：段落首行缩进、行高 2.05；末段以「睡吧」开头时作为落点句居中收尾 */
function StoryBody({
  content, night, font,
}: { content: string; night: boolean; font: FontKey }) {
  const blocks = paragraphsOf(content);
  const last = blocks[blocks.length - 1] ?? "";
  const hasEnding = blocks.length > 1 && last.startsWith("睡吧");
  const body = hasEnding ? blocks.slice(0, -1) : blocks;
  const px = FONTS[font];
  return (
    <div>
      <div style={{ fontSize: px, lineHeight: 2.05, color: night ? "#e8ddd0" : "#4a3826" }}>
        {body.map((b, i) => (
          <p key={i} style={{ textIndent: "2em", margin: i === 0 ? 0 : "0 0 0.85em" }}>
            {b.split("\n").map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </p>
        ))}
      </div>
      {hasEnding && (
        <div className="mt-6 text-center">
          <div className={`mx-auto h-px w-24 ${night ? "bg-[#3a2f28]" : "bg-paper-200"}`} />
          <p
            className="mt-4"
            style={{
              fontSize: px - 1.5,
              lineHeight: 1.9,
              letterSpacing: "0.06em",
              color: night ? "#d9b36a" : "#a9762a",
            }}
          >
            {last}
          </p>
        </div>
      )}
    </div>
  );
}

/** hero 卡右上角的月亮与星星装饰（低透明度，日夜两套色） */
function MoonDecor({ night }: { night: boolean }) {
  const moon = night ? "rgba(232,195,122,0.22)" : "rgba(201,134,0,0.16)";
  const star = night ? "rgba(232,195,122,0.35)" : "rgba(201,134,0,0.28)";
  return (
    <svg
      className="pointer-events-none absolute right-6 top-6"
      width="60"
      height="60"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M32 12a20 20 0 1 0 0 40a20 20 0 1 0 0-40Z M37 19a13 13 0 1 0 0 26a13 13 0 1 0 0-26Z"
        fill={moon}
      />
      <circle cx="12" cy="16" r="1.6" fill={star} />
      <circle cx="20" cy="9" r="1.1" fill={star} />
      <circle cx="8" cy="28" r="1.1" fill={star} />
    </svg>
  );
}

/** 全站日/夜状态：<html> 有 .site-night 即夜间（由 Nav 右上角全局开关控制）。
 *  useLayoutEffect 在首帧渲染前读取，避免夜色下刷新时正文先闪一帧日间配色。 */
function useNightMode(): boolean {
  const read = () =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("site-night");
  const [night, setNight] = useState(read);
  useLayoutEffect(() => {
    setNight(read());
    // 全局开关在 Nav 里，切主题时 <html> class 变化但不会触发本组件重渲染；
    // 这里用轻量观察：离开页面无须清理（class 由全局管理）。
    const ob = new MutationObserver(() => setNight(read()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => ob.disconnect();
  }, []);
  return night;
}

export default function StoryPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Story | null>(null);
  const night = useNightMode();
  const [font, setFont] = useState<FontKey>(() => {
    const v = localStorage.getItem(FONT_KEY);
    return v === "s" || v === "l" ? v : "m";
  });

  useEffect(() => {
    storyApi
      .publicList()
      .then((d) => setStories(d.items ?? []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(FONT_KEY, font);
  }, [font]);

  // 弹窗内的键盘操作：Esc 关闭，← 翻更早，→ 翻更新
  useEffect(() => {
    const step = (cur: Story, delta: 1 | -1): Story | null => {
      const i = stories.findIndex((s) => s.id === cur.id);
      const j = i + delta;
      return j >= 0 && j < stories.length ? stories[j] : null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
      else if (e.key === "ArrowLeft") setActive((a) => (a ? step(a, 1) : a));
      else if (e.key === "ArrowRight") setActive((a) => (a ? step(a, -1) : a));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stories]);

  const today = todayStr();
  const hero = stories[0]?.story_date === today ? stories[0] : null;
  const rest = hero ? stories.slice(1) : stories;

  const dim = night ? "text-[#a99683]" : "text-paper-700";
  const faint = night ? "text-[#8a7866]" : "text-paper-500";
  const strong = night ? "text-[#f2e9dc]" : "text-paper-900";
  const card = night
    ? "border-[#3a2f28] bg-[#221b17] hover:border-[#5a4636]"
    : "glass border-paper-100 card-hover";
  const gold = night ? "#e8c37a" : "#c98600";

  const activeIdx = active ? stories.findIndex((s) => s.id === active.id) : -1;
  const older = activeIdx >= 0 && activeIdx < stories.length - 1 ? stories[activeIdx + 1] : null;
  const newer = activeIdx > 0 ? stories[activeIdx - 1] : null;

  return (
    <div
      className={`-mx-5 min-h-screen px-5 pt-10 pb-16 transition-colors ${
        night ? "bg-[#17120f]" : ""
      }`}
    >
      <div className="mx-auto max-w-3xl">
        {/* 页头 */}
        <div>
          <h1
            className={`flex items-center gap-2 text-3xl font-extrabold tracking-tight ${strong}`}
          >
            <BookOpen size={26} className="text-brand-gold" />
            睡前故事
          </h1>
          <p className={`mt-1.5 text-sm ${dim}`}>
            {stories.length > 0
              ? `共 ${stories.length} 篇 · 每晚一篇，读完就睡`
              : "每晚一篇，读完就睡"}
          </p>
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
              className={`relative overflow-hidden rounded-3xl border p-7 transition ${
                night
                  ? "border-[#3a2f28] bg-[#221b17] hover:border-[#5a4636]"
                  : "border-brand-gold/45 bg-gradient-to-br from-[#fffdf9] to-[#fbf0e0] hover:shadow-card"
              }`}
            >
              <MoonDecor night={night} />
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-gold/15 px-3 py-1 text-[11px] font-semibold"
                style={{ color: gold }}
              >
                今晚的故事 · {formatDate(hero.story_date)}
              </span>
              <h2 className={`mt-3 text-2xl font-bold leading-snug ${strong}`}>
                {hero.title}
              </h2>
              {hero.summary && (
                <p className={`mt-2 text-sm leading-relaxed ${dim}`}>
                  {hero.summary}
                </p>
              )}
              <div className={`mt-5 flex items-center gap-2 text-xs ${faint}`}>
                <CopyBtn text={hero.content} night={night} />
                <span className="ml-auto inline-flex items-center gap-1 font-medium" style={{ color: gold }}>
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
              {rest.map((s) => {
                const dp = dateParts(s.story_date);
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s)}
                    className="block w-full text-left"
                  >
                    <div className={`group relative flex gap-4 rounded-2xl border px-5 py-4 transition ${card}`}>
                      {/* 日期竖块 */}
                      <div
                        className={`flex w-[3.4rem] shrink-0 flex-col items-center justify-center border-r pr-3.5 ${
                          night ? "border-[#3a2f28]" : "border-paper-200"
                        }`}
                      >
                        <span
                          className="text-[22px] font-bold leading-none tabular-nums"
                          style={{ color: gold }}
                        >
                          {dp.d || "—"}
                        </span>
                        <span className={`mt-1.5 whitespace-nowrap text-[10.5px] ${faint}`}>
                          {dp.m ? `${dp.m}月 · 周${dp.w}` : formatDate(s.story_date)}
                        </span>
                      </div>
                      {/* 内容 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className={`text-[15.5px] font-semibold leading-snug ${strong}`}>
                            {s.title}
                          </h3>
                          <span className="shrink-0 opacity-50 transition group-hover:opacity-100">
                            <CopyBtn text={s.content} night={night} />
                          </span>
                        </div>
                        {s.summary && (
                          <p className={`mt-1 line-clamp-2 text-xs leading-relaxed ${dim}`}>
                            {s.summary}
                          </p>
                        )}
                        {tagsOf(s.tags).length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {tagsOf(s.tags).map((t) => (
                              <Tag key={t} t={t} night={night} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 全文弹窗：书页化排版 */}
      {active && (
        <div
          className="animate-hanzi-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#3d2b1f]/60 p-4 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div
            className={`animate-hanzi-scale-in my-8 w-full max-w-2xl rounded-3xl border p-7 shadow-card ${
              night
                ? "border-[#3a2f28] bg-[#1e1815]"
                : "glass"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 右上角操作：朗读（有音频时）/ 复制 / 关闭 */}
            <div className="flex justify-end gap-2">
              {active.audio_url && <AudioBtn src={active.audio_url} night={night} />}
              <CopyBtn text={active.content} night={night} size={14} />
              <button
                onClick={() => setActive(null)}
                title="关闭"
                className={`grid h-7 w-7 place-items-center rounded-lg border transition ${
                  night
                    ? "border-[#3a2f28] text-[#a99683] hover:bg-[#2a221d]"
                    : "border-paper-200 bg-paper-100 text-paper-800 hover:bg-paper-200"
                }`}
              >
                <X size={14} />
              </button>
            </div>

            {/* 刊头：日期小字 → 标题 → 金色短线 → 摘要 */}
            <div className="mx-auto mt-2 max-w-md text-center">
              <p
                className="text-xs font-medium tracking-[0.2em]"
                style={{ color: gold }}
              >
                {formatDate(active.story_date)}
              </p>
              <h2 className={`mt-2 text-[22px] font-bold leading-snug ${strong}`}>
                {active.title}
              </h2>
              <div className="mx-auto mt-3 h-0.5 w-9 rounded-full bg-brand-gold/70" />
              {active.summary && (
                <p className={`mt-3 text-[13px] leading-relaxed ${dim}`}>
                  {active.summary}
                </p>
              )}
            </div>

            {/* 正文 */}
            <div className="mt-6">
              <StoryBody content={active.content} night={night} font={font} />
            </div>

            {/* 标签 */}
            {tagsOf(active.tags).length > 0 && (
              <div className="mt-6 flex flex-wrap justify-center gap-1.5">
                {tagsOf(active.tags).map((t) => (
                  <Tag key={t} t={t} night={night} />
                ))}
              </div>
            )}

            {/* 底栏：上一篇 / 字号 / 下一篇 */}
            <div
              className={`mt-7 flex items-center justify-between gap-3 border-t pt-4 ${
                night ? "border-[#3a2f28]" : "border-paper-200/80"
              }`}
            >
              <button
                disabled={!older}
                onClick={() => older && setActive(older)}
                title={older ? older.title : "已经是更早的一篇了"}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-35 ${
                  night
                    ? "border-[#3a2f28] text-[#a99683] hover:bg-[#2a221d]"
                    : "border-paper-200 bg-paper-100 text-paper-800 hover:bg-paper-200"
                }`}
              >
                <ChevronLeft size={14} />
                更早
              </button>
              <div
                className={`flex items-center rounded-lg border ${
                  night ? "border-[#3a2f28]" : "border-paper-200"
                }`}
              >
                {(["s", "m", "l"] as FontKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFont(k)}
                    className={`px-2.5 py-1 text-[11px] transition ${
                      font === k
                        ? night
                          ? "bg-[#2a221d] font-semibold text-[#e8c37a]"
                          : "bg-paper-100 font-semibold text-paper-900"
                        : night
                          ? "text-[#8a7866]"
                          : "text-paper-500"
                    }`}
                  >
                    {k === "s" ? "小" : k === "m" ? "标准" : "大"}
                  </button>
                ))}
              </div>
              <button
                disabled={!newer}
                onClick={() => newer && setActive(newer)}
                title={newer ? newer.title : "已经是最新的一篇了"}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-35 ${
                  night
                    ? "border-[#3a2f28] text-[#a99683] hover:bg-[#2a221d]"
                    : "border-paper-200 bg-paper-100 text-paper-800 hover:bg-paper-200"
                }`}
              >
                更新
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
