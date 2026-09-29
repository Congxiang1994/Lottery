import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Story } from "./api";
import {
  AudioBtn,
  CopyBtn,
  FONTS,
  FontKey,
  StoryBody,
  Tag,
  formatDate,
  storyTheme,
  tagsOf,
  tidy,
} from "./parts";

/**
 * 睡前故事 · 全文弹窗
 *
 * 分层：遮罩（定位 + 溢出兜底）→ 面板（限高纵向 flex）→ 进度条 / 操作栏 / 正文区 / 底栏。
 * 正文区是面板内唯一的滚动容器，操作栏与底栏在 flex 里天然不动 —— 所以它们
 * **不需要背景色、边框和 sticky**（加了反而把书页切成三段）。
 *
 * ⚠️ 限高必须用 max-h-[calc(100dvh-5rem)]，算式对齐：
 *      100dvh − 遮罩 p-4(2rem) − 面板 my-6(3rem) = 100dvh − 5rem
 *    写成 max-h-full 无效（flex item 的百分比高度解析不到定高父级）；
 *    算式比实际可用高度小会溢出、把遮罩层撑成滚动容器（滚轮一滚整块面板连关闭按钮一起上移）；
 *    比实际大则面板下半截被裁。改内边距时**必须同步改这个算式**。
 *
 * ⚠️ 遮罩保持 items-start：items-center 配 overflow-y-auto 是经典 bug，
 *    内容超长时顶部被裁且滚不回去。垂直留白由面板 my-auto 承担。
 */
export default function StoryModal({
  story, night, font, setFont, older, newer, onGo, onClose,
}: {
  story: Story;
  night: boolean;
  font: FontKey;
  setFont: (k: FontKey) => void;
  older: Story | null;
  newer: Story | null;
  onGo: (s: Story) => void;
  onClose: () => void;
}) {
  const t = storyTheme(night);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const can = max > 2;
    setScrollable(can);
    const p = can ? Math.min(1, Math.max(0, el.scrollTop / max)) : 1;
    setPct(p * 100);
    setAtBottom(!can || el.scrollTop >= max - 4);
  }, []);

  useLayoutEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    measure();
  }, [story.id, font, measure]);

  // 容器尺寸变化（旋转屏幕、字体加载完成）后重新量一次
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const tags = tagsOf(story.tags);

  const navBtn = (dir: "older" | "newer") => {
    const target = dir === "older" ? older : newer;
    const label = dir === "older" ? "更早" : "更新";
    return (
      <button
        type="button"
        disabled={!target}
        onClick={() => target && onGo(target)}
        title={target ? target.title : dir === "older" ? "已经是更早的一篇了" : "已经是最新的一篇了"}
        aria-label={label}
        className={`press inline-flex shrink-0 items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-30 sm:gap-1 sm:px-3 ${t.btn}`}
      >
        {dir === "older" && <ChevronLeft size={14} />}
        {label}
        {dir === "newer" && <ChevronRight size={14} />}
      </button>
    );
  };

  return (
    <div
      className="anim-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-[#3d2b1f]/65 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={story.title}
    >
      <div
        className="anim-panel paper-sheet my-6 flex max-h-[calc(100dvh-5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 阅读进度：只在正文可滚时出现，随滚动增长 */}
        {scrollable && (
          <div
            className="h-[3px] w-full shrink-0"
            style={{ background: night ? "rgba(232,195,122,0.12)" : "rgba(201,134,0,0.1)" }}
            aria-hidden
          >
            <div
              className="h-full rounded-r-full transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%`, background: t.goldDeco }}
            />
          </div>
        )}

        {/* 操作栏：朗读（有音频时）/ 复制 / 关闭。不随正文滚动，故无需背板 */}
        <div className="flex shrink-0 items-center justify-end gap-2 px-4 pt-4 sm:px-6 sm:pt-5">
          {story.audio_url && <AudioBtn src={story.audio_url} night={night} />}
          <CopyBtn text={story.content} night={night} size={14} />
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className={`press grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition ${t.btn}`}
          >
            <X size={14} />
          </button>
        </div>

        {/* 正文滚动区：面板内唯一的滚动容器。
            ⚠️ 滚动层必须用 min-h-0 flex-auto，**不能用 flex-1**：
            flex-1 = flex:1 1 0%，基准尺寸为 0；而面板高度是内容驱动的（只有 max-h 上限），
            不存在「正向剩余空间」可分配 → 该项恒为 0 高，正文整块消失。
            也不能在中间套一层 relative 容器 + h-full：flex item 的 height 属性仍是 auto，
            height:100% 解析不到定高 → 回落成内容高度，正文底部被静默裁掉且滚不动。
            flex-auto = flex:1 1 auto：基准取内容高，超出时靠 min-h-0 收缩。
            底部渐隐改用内容层的 mask-image，避免再引入定位元素。 */}
        <div
          ref={bodyRef}
          onScroll={measure}
          className="min-h-0 flex-auto overflow-y-auto overscroll-contain"
        >
          <div
            className="px-5 pb-8 pt-6 sm:px-7"
            style={
              atBottom
                ? undefined
                : {
                    maskImage: `linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent)`,
                    WebkitMaskImage: `linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent)`,
                  }
            }
          >
            {/* 刊头：日期小字 → 标题 → 金色短线 → 摘要 */}
            <div className="mx-auto max-w-md text-center">
              <p
                className="text-[11px] font-semibold tracking-[0.22em]"
                style={{ color: t.gold }}
              >
                {formatDate(story.story_date)}
              </p>
              <h2
                className="mt-2 text-[21px] font-bold leading-snug sm:text-[23px]"
                style={{ color: t.strong }}
              >
                {tidy(story.title)}
              </h2>
              <div
                className="mx-auto mt-3 h-0.5 w-9 rounded-full opacity-70"
                style={{ background: t.goldDeco }}
              />
              {story.summary && (
                <p className="mt-3 text-[13px] leading-relaxed" style={{ color: t.dim }}>
                  {tidy(story.summary)}
                </p>
              )}
            </div>

            {/* 正文 */}
            <div className="mt-5">
              <StoryBody content={story.content} night={night} font={font} />
            </div>

            {/* 标签 */}
            {tags.length > 0 && (
              <div className="mt-6 flex flex-wrap justify-center gap-1.5">
                {tags.map((x) => (
                  <Tag key={x} t={x} night={night} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底栏：上一篇 / 字号 / 下一篇。同样不随正文滚动 */}
        <div
          className={`flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3 sm:px-6 sm:py-3.5 ${
            night ? "border-[#3a2f28]" : "border-paper-200/80"
          }`}
        >
          {navBtn("older")}
          <div className={`flex shrink-0 items-center overflow-hidden rounded-lg border ${t.softBorder}`}>
            {(["s", "m", "l"] as FontKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFont(k)}
                aria-pressed={font === k}
                title={`正文字号：${k === "s" ? "小" : k === "m" ? "标准" : "大"}（${FONTS[k]}px）`}
                className={`px-2 py-1.5 text-[11px] leading-none transition sm:px-2.5 ${
                  font === k
                    ? night
                      ? "bg-[#2a221d] font-semibold text-[#e8c37a]"
                      : "bg-paper-100 font-semibold text-paper-900"
                    : night
                      ? "text-[#9c8a77] hover:text-[#d9c6ae]"
                      : "text-[#7a6349] hover:text-[#3d2b1f]"
                }`}
              >
                {k === "s" ? "小" : k === "m" ? "标准" : "大"}
              </button>
            ))}
          </div>
          {navBtn("newer")}
        </div>
      </div>
    </div>
  );
}
