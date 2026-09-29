import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { BookOpen, Check, Copy, Pause, Volume2 } from "lucide-react";

/* ==========================================================================
 * 睡前故事 · 共享原子（纯展示 / 纯函数）
 * 工具函数、配色 token、Tag / CopyBtn / AudioBtn / StoryBody / MoonDecor、昼夜 hook
 * ========================================================================== */

const WEEK = "日一二三四五六";

export const FONT_KEY = "story_font";
export const READ_KEY = "story_read";
export const FONTS = { s: 15.5, m: 17, l: 19 } as const;
export type FontKey = keyof typeof FONTS;

/* ------------------------------ 日期 ------------------------------ */

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 完整日期：9月28日 · 周一 */
export function formatDate(s: string): string {
  const d = parseDate(s);
  if (!d) return s;
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEK[d.getDay()]}`;
}

/** 只到日：9月28日 */
export function shortDate(s: string): string {
  const d = parseDate(s);
  if (!d) return s;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 相对日期：今天 / 昨天 / 前天 / N 天前，超过一周回落绝对日期 */
export function relDate(s: string): string {
  const d = parseDate(s);
  if (!d) return s;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff === 2) return "前天";
  if (diff > 2 && diff <= 7) return `${diff} 天前`;
  return shortDate(s);
}

/** 星期：周二 */
export function weekdayOf(s: string): string {
  const d = parseDate(s);
  return d ? `周${WEEK[d.getDay()]}` : "";
}

/** 两个日期相差几天（今天为正） */
export function daysAgo(s: string): number {
  const d = parseDate(s);
  if (!d) return Number.POSITIVE_INFINITY;
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - d.getTime()) / 86400000);
}

/* ------------------------------ 文本 ------------------------------ */

export function tagsOf(tags: string): string[] {
  return (tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 正文按空行切块（连续换行压平），块内保留单换行为 <br/>（诗行感） */
export function paragraphsOf(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

const EMOJI = "[\\p{Extended_Pictographic}\\uFE0F\\u200D]";
/** 表情符号前的空白 */
const RE_SPACE_BEFORE_EMOJI = new RegExp(`[ \\t\\u3000]+(?=${EMOJI}+)`, "gu");
/** 表情符号前的任意一个字符 */
const RE_ANY_BEFORE_EMOJI = new RegExp(`([\\s\\S])(?=${EMOJI})`, "gu");
/** 表情符号后的中文标点 */
const RE_EMOJI_BEFORE_PUNCT = new RegExp(`(${EMOJI}+)(?=[。．，、！？；：…])`, "gu");
const RE_EMOJI_RUN = new RegExp(`${EMOJI}+`, "u");

/**
 * 中文排版修正：数据里正文普遍以「 🌱。」收尾，那个半角空格是合法断行点，
 * 会把 emoji 和句号挤成单独一行（实测 🌱。/ ✨。/ 🌙。 都出现过）。
 * 两步把断行点焊死：空格→不换行空格（NBSP），表情符号两侧再插词连接符（U+2060，零宽且不可断）。
 * 只产出纯文本，不引入 HTML。
 */
export function tidy(s: string): string {
  if (!s) return s;
  return s
    .replace(RE_SPACE_BEFORE_EMOJI, "\u00A0")
    .replace(RE_ANY_BEFORE_EMOJI, "$1\u2060")
    .replace(RE_EMOJI_BEFORE_PUNCT, "$1\u2060");
}

/** 从标题里摘出表情符号，用作卡片封面图形位；正文部分去掉它避免重复 */
export function splitEmoji(title: string): { emoji: string; text: string } {
  const m = title.match(RE_EMOJI_RUN);
  if (!m || m.index == null) return { emoji: "", text: title.trim() };
  const raw =
    title.slice(0, m.index) + " " + title.slice(m.index + m[0].length);
  return { emoji: m[0], text: raw.replace(/\s+/g, " ").trim() };
}

/* ------------------------------ 配色 token ------------------------------ */

/** 统一色板。日间刻意压低彩度、拉够对比度：
 *  金色文字 #8a5a10 —— 即使压在 bg-brand-gold/15 的淡金底上也有 4.76:1（WCAG AA）；
 *  次级文字 #6b573f 6.38:1、三级 #7a6349 5.26:1，均达标。
 *  #c98600 只用于边框 / 分隔线 / 进度条这类**非文字**装饰，不承担可读性。 */
export function storyTheme(night: boolean) {
  return {
    strong: night ? "#f2e9dc" : "#3d2b1f",
    dim: night ? "#b5a18c" : "#6b573f",
    faint: night ? "#9c8a77" : "#7a6349",
    gold: night ? "#e8c37a" : "#8a5a10",
    goldDeco: night ? "#e8c37a" : "#c98600",
    card: night
      ? "border-[#3a2f28] bg-[#221b17] hover:border-[#5a4636]"
      : "glass border-paper-100 card-hover",
    hairline: night ? "bg-[#3a2f28]" : "bg-paper-200",
    softBorder: night ? "border-[#3a2f28]" : "border-paper-200",
    /** 次级控件（底栏按钮 / 弹窗图标按钮） */
    btn: night
      ? "border-[#3a2f28] text-[#b5a18c] hover:bg-[#2a221d] hover:text-[#e8ddd0]"
      : "border-paper-200 bg-paper-100 text-paper-800 hover:bg-paper-200",
  };
}

export type StoryTheme = ReturnType<typeof storyTheme>;

/* ------------------------------ 标签 ------------------------------ */

type Pair = [string, string];
const TAG_PALETTES: { d: Pair; n: Pair }[] = [
  { d: ["#faeeda", "#8a5a10"], n: ["rgba(201,134,0,0.18)", "#e8c37a"] }, // 琥珀
  { d: ["#e1f5ee", "#0f6e56"], n: ["rgba(45,166,130,0.18)", "#8fd8bd"] }, // 青绿
  { d: ["#e6f1fb", "#1a5fa5"], n: ["rgba(59,130,246,0.18)", "#a5c3f2"] }, // 蓝
  { d: ["#fbeaf0", "#993556"], n: ["rgba(212,83,126,0.18)", "#eeb1c6"] }, // 粉
  { d: ["#eaf3de", "#3f6d12"], n: ["rgba(99,153,34,0.18)", "#b9d690"] }, // 草绿
];

export function tagPalette(tag: string): { d: Pair; n: Pair } {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_PALETTES[h % TAG_PALETTES.length];
}

export function paletteOf(tag: string, night: boolean): Pair {
  const p = tagPalette(tag);
  return night ? p.n : p.d;
}

export function Tag({ t, night }: { t: string; night: boolean }) {
  const [bg, color] = paletteOf(t, night);
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-[1.5]"
      style={{ background: bg, color }}
    >
      {t}
    </span>
  );
}

/** 卡片封面图形位：有标题表情符号就展示它，否则退回书本图标；底色由标签决定 */
export function Cover({
  emoji, tag, night, className = "",
}: { emoji: string; tag: string; night: boolean; className?: string }) {
  const [bg, color] = paletteOf(tag || "x", night);
  return (
    <span
      aria-hidden
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[19px] leading-none ${className}`}
      style={{ background: bg, color }}
    >
      {emoji || <BookOpen size={17} />}
    </span>
  );
}

/* ------------------------------ 按钮 ------------------------------ */

/** 复制按钮：点击复制文本到剪贴板，成功后短暂变为对勾 */
export function CopyBtn({
  text, night, size = 13,
}: { text: string; night: boolean; size?: number }) {
  const [ok, setOk] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // 不触发外层卡片的点击行为
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
  const t = storyTheme(night);
  return (
    <button
      type="button"
      onClick={copy}
      title={ok ? "已复制" : "复制全文"}
      aria-label="复制全文"
      className={`press grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition ${
        ok
          ? "border-emerald-300 bg-emerald-50 text-emerald-600"
          : t.btn
      }`}
    >
      {ok ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

/** 朗读按钮：audio_url 有值时才渲染，播放中变暂停图标 */
export function AudioBtn({ src, night }: { src: string; night: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const t = storyTheme(night);
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
  useEffectOnce(() => () => ref.current?.pause());
  return (
    <button
      type="button"
      onClick={toggle}
      title={playing ? "暂停朗读" : "播放朗读"}
      aria-label={playing ? "暂停朗读" : "播放朗读"}
      className={`press grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition ${t.btn}`}
    >
      {playing ? <Pause size={13} /> : <Volume2 size={13} />}
    </button>
  );
}

/** 极简 useEffect（挂载/卸载一次），避免为一个清理函数引入依赖数组噪音 */
function useEffectOnce(fn: () => (() => void) | void) {
  const ref = useRef<(() => void) | void>(undefined);
  useLayoutEffect(() => {
    ref.current = fn();
    return () => ref.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ------------------------------ 书页正文 ------------------------------ */

/** 书页化正文：段落首行缩进、行高 2.0；末段以「睡吧」开头时作为落点句居中收尾 */
export function StoryBody({
  content, night, font,
}: { content: string; night: boolean; font: FontKey }) {
  const blocks = paragraphsOf(content);
  const last = blocks[blocks.length - 1] ?? "";
  const hasEnding = blocks.length > 1 && last.startsWith("睡吧");
  const body = hasEnding ? blocks.slice(0, -1) : blocks;
  const px = FONTS[font];
  return (
    <div>
      <div style={{ fontSize: px, lineHeight: 2, color: night ? "#e8ddd0" : "#4a3826" }}>
        {body.map((b, i) => (
          <p key={i} style={{ textIndent: "2em", margin: i === 0 ? 0 : "0 0 0.8em" }}>
            {b.split("\n").map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {tidy(line)}
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
              fontSize: px,
              lineHeight: 1.9,
              letterSpacing: "0.06em",
              color: night ? "#d9b36a" : "#8a5a10",
            }}
          >
            {tidy(last)}
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ 装饰 ------------------------------ */

/** hero 卡右上角的月亮与星星（低透明度，日夜两套色） */
export function MoonDecor({ night, size = 72 }: { night: boolean; size?: number }) {
  const moon = night ? "rgba(232,195,122,0.22)" : "rgba(201,134,0,0.18)";
  const star = night ? "rgba(232,195,122,0.35)" : "rgba(201,134,0,0.3)";
  return (
    <svg
      className="pointer-events-none absolute right-5 top-5 sm:right-8 sm:top-8"
      width={size}
      height={size}
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

/* ------------------------------ 状态 ------------------------------ */

/** 全站日/夜状态：<html> 有 .site-night 即夜间（由 Nav 右上角全局开关控制）。
 *  useLayoutEffect 在首帧渲染前读取，避免夜色下刷新时正文先闪一帧日间配色。 */
export function useNightMode(): boolean {
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

/* ------------------------------ 已读记录 ------------------------------ */

export function loadReadIds(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(READ_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export function saveReadIds(ids: number[]) {
  try {
    // 只留最近 300 条，避免 localStorage 无限增长
    localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-300)));
  } catch {
    /* 隐私模式等场景下静默失败 */
  }
}
