import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Shuffle,
  X,
} from "lucide-react";
import { Story, storyApi } from "./api";
import { useModalHistory } from "../common/useModalHistory";
import { useEscapeClose } from "../common/useEscapeClose";
import {
  Cover,
  FONT_KEY,
  FontKey,
  MoonDecor,
  Tag,
  formatDate,
  loadReadIds,
  relDate,
  saveReadIds,
  shortDate,
  splitEmoji,
  storyTheme,
  tagsOf,
  tidy,
  useNightMode,
  weekdayOf,
} from "./parts";
import { ExitPresence } from "../common/Modal";
import StoryModal from "./StoryModal";

/**
 * 每日儿童睡前故事 /story
 *
 * 公开页：按故事日期倒序展示（只展示已发布），点击卡片打开全文弹窗。
 * 版式：内容宽度与顶部导航同宽（max-w-6xl），左右边界对齐；
 *   首屏一张「最近一篇」重点卡，其余按日期分组、桌面双列排布。
 * 交互：关键词搜索 + 主题标签筛选 + 随机一篇（优先未读）+ 已读标记 + 本地分页
 *   （每页 10 篇，页码/上一页/下一页在列表底部，筛选变化自动回第 1 页）。
 * 弹窗：书页化排版（见 StoryModal）。
 * 夜间模式跟随全站全局开关（Nav 右上角，useTheme），页内不再单独切换。
 */

/* ------------------------------ 卡片 ------------------------------ */

function StoryCard({
  s, night, read, onOpen,
}: { s: Story; night: boolean; read: boolean; onOpen: (s: Story) => void }) {
  const t = storyTheme(night);
  const tags = tagsOf(s.tags);
  const { emoji, text } = splitEmoji(s.title);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${text}，${relDate(s.story_date)}${read ? "，已读过" : ""}`}
      onClick={() => onOpen(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(s);
        }
      }}
      className={`press group flex cursor-pointer gap-3.5 rounded-2xl border px-4 py-3.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-brand-gold/60 sm:px-5 sm:py-4 ${t.card}`}
    >
      <Cover emoji={emoji} tag={tags[0] || ""} night={night} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3
            className="min-w-0 flex-1 text-[15px] font-semibold leading-snug sm:text-[15.5px]"
            style={{ color: t.strong }}
          >
            {text}
          </h3>
          {read && (
            <span
              title="已读过"
              aria-hidden
              className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                night ? "bg-[#5a4d41]" : "bg-paper-300"
              }`}
            />
          )}
        </div>
        {s.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: t.dim }}>
            {tidy(s.summary)}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((x) => (
              <Tag key={x} t={x} night={night} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  active, night, onClick, children,
}: {
  active: boolean;
  night: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? night
            ? "border-[#5a4636] bg-[#2a221d] text-[#e8c37a]"
            : "border-brand-gold/50 bg-brand-gold/15 text-[#8a5a10]"
          : night
            ? "border-[#3a2f28] text-[#8a7866] hover:text-[#b5a18c]"
            : "border-paper-200 text-paper-700 hover:bg-paper-100"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------ 骨架屏 ------------------------------ */

function SkeletonCards({ night }: { night: boolean }) {
  const box = `rounded-xl ${night ? "bg-[#2c2320]" : "bg-paper-200"}`;
  return (
    <div className="mt-7 space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`flex gap-3.5 rounded-2xl border px-4 py-3.5 sm:px-5 sm:py-4 ${
            night ? "border-[#3a2f28] bg-[#221b17]" : "glass border-paper-100"
          }`}
        >
          <div className={`h-11 w-11 shrink-0 rounded-xl shimmer animate-shimmer ${box}`} />
          <div className="flex-1 space-y-2.5 pt-0.5">
            <div className={`h-4 w-2/3 shimmer animate-shimmer ${box}`} />
            <div className={`h-3 w-full shimmer animate-shimmer ${box}`} />
            <div className={`h-3 w-4/5 shimmer animate-shimmer ${box}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ 分页 ------------------------------ */

/** 每页卡片数（前端本地分页，后端仍一次性拉全量） */
const PAGE_SIZE = 10;

/** 生成页码序列：总页数少时全列出，多时用 … 截断（首尾 + 当前页前后各 1 页） */
function pageWindow(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const mid = [page - 1, page, page + 1].filter((n) => n >= 2 && n <= total - 1);
  const nums = [...new Set([1, total, ...mid])].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("…");
    out.push(nums[i]);
  }
  return out;
}

function Pagination({
  page, total, night, onGo,
}: { page: number; total: number; night: boolean; onGo: (p: number) => void }) {
  if (total <= 1) return null;
  const arrow =
    "press inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm font-medium transition disabled:cursor-default disabled:opacity-40";
  const num = (active: boolean) =>
    `press grid h-9 min-w-9 place-items-center rounded-lg border px-2 text-sm font-medium tabular-nums transition ${
      active
        ? night
          ? "border-[#5a4636] bg-[#2a221d] text-[#e8c37a]"
          : "border-brand-gold/50 bg-brand-gold/15 text-[#8a5a10]"
        : night
          ? "border-[#3a2f28] text-[#8a7866] hover:text-[#b5a18c]"
          : "border-paper-200 text-paper-700 hover:bg-paper-100"
    }`;
  return (
    <nav className="mt-9 flex flex-wrap items-center justify-center gap-1.5" aria-label="分页">
      <button
        type="button"
        onClick={() => onGo(page - 1)}
        disabled={page <= 1}
        aria-label="上一页"
        className={`${arrow} ${night ? "border-[#3a2f28] text-[#b5a18c]" : "border-paper-200 text-paper-800"}`}
      >
        <ChevronLeft size={15} />
        上一页
      </button>
      {pageWindow(page, total).map((n, i) =>
        n === "…" ? (
          <span key={`e${i}`} className="px-1 text-sm" style={{ color: night ? "#6e5f51" : "#a89a86" }}>
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onGo(n)}
            aria-current={n === page ? "page" : undefined}
            aria-label={`第 ${n} 页`}
            className={num(n === page)}
          >
            {n}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onGo(page + 1)}
        disabled={page >= total}
        aria-label="下一页"
        className={`${arrow} ${night ? "border-[#3a2f28] text-[#b5a18c]" : "border-paper-200 text-paper-800"}`}
      >
        下一页
        <ChevronRight size={15} />
      </button>
    </nav>
  );
}

/* ------------------------------ 页面 ------------------------------ */

export default function StoryPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Story | null>(null);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [readIds, setReadIds] = useState<number[]>(loadReadIds);
  const night = useNightMode();
  const listTopRef = useRef<HTMLDivElement>(null);

  /* 弹框历史栈：打开时压一条历史记录，浏览器返回（含手机侧滑）只关弹框、不离开页面。
     push / pop 与 selfPop 竞态防护都收在 common/useModalHistory.ts，/hanzi、/babysong 共用。 */
  const modalHistory = useModalHistory("storyModal", () => setActive(null));

  const [font, setFont] = useState<FontKey>(() => {
    const v = localStorage.getItem(FONT_KEY);
    return v === "s" || v === "l" ? v : "m";
  });

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    storyApi
      .publicList()
      .then((d) => setStories(d.items ?? []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    localStorage.setItem(FONT_KEY, font);
  }, [font]);

  /* 搜索 / 标签变化时回到第 1 页，避免停留在超出结果范围的页码上 */
  useEffect(() => {
    setPage(1);
  }, [q, tag]);

  const markRead = useCallback((id: number) => {
    setReadIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveReadIds(next);
      return next;
    });
  }, []);

  /* 打开弹框：压一条历史记录，让「返回」优先命中弹框而不是离开页面 */
  const openModal = useCallback(
    (s: Story) => {
      setActive(s);
      markRead(s.id);
      modalHistory.push();
    },
    [markRead, modalHistory],
  );

  /* 关闭弹框：先置空状态，再弹掉自己压入的那条历史记录（保持历史干净） */
  const closeModal = useCallback(() => {
    setActive(null);
    modalHistory.pop();
  }, [modalHistory]);

  // 弹窗内的键盘操作：← 翻更早，→ 翻更新。Esc 交给全站统一的 useEscapeClose。
  useEffect(() => {
    const step = (cur: Story, delta: 1 | -1): Story | null => {
      const i = stories.findIndex((s) => s.id === cur.id);
      const j = i + delta;
      return j >= 0 && j < stories.length ? stories[j] : null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setActive((a) => (a ? step(a, 1) : a));
      else if (e.key === "ArrowRight") setActive((a) => (a ? step(a, -1) : a));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stories]);

  /* Esc 关闭弹窗。⚠️ 必须只在弹窗打开时注册 —— 旧写法是无条件挂 keydown，
     列表页（没有弹窗）按 Esc 也会去调一次 closeModal()，语义是错的。 */
  useEscapeClose(active !== null, closeModal);

  /* 弹框打开时锁住背景滚动（否则手机上会「穿透」到背后的列表一起滚），
     并补偿滚动条消失带来的宽度 —— 不补的话桌面居中容器会整体横移 5px。 */
  useEffect(() => {
    if (!active) return;
    const sw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (sw > 0) document.body.style.paddingRight = `${sw}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [active]);

  /* ---------------------------- 筛选 ---------------------------- */

  const tagStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stories)
      for (const x of tagsOf(s.tags)) m.set(x, (m.get(x) || 0) + 1);
    return [...m.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .slice(0, 9);
  }, [stories]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return stories.filter((s) => {
      if (tag && !tagsOf(s.tags).includes(tag)) return false;
      if (!kw) return true;
      return `${s.title} ${s.summary} ${s.tags}`.toLowerCase().includes(kw);
    });
  }, [stories, q, tag]);

  const filtering = q.trim().length > 0 || tag !== null;
  /* 重点卡只在「未筛选」时出现；筛选后平铺展示全部命中项，避免歧义 */
  const hero = filtering ? null : filtered[0] ?? null;

  /* ---------------------------- 分页 ---------------------------- */

  /* 分页对象 = 重点卡之外的列表（hero 不占名额，仅在筛选关闭时附加在第 1 页顶部） */
  const list = useMemo(() => (hero ? filtered.slice(1) : filtered), [filtered, hero]);
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => list.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE),
    [list, cur],
  );

  const groups = useMemo(() => {
    const out: { date: string; items: Story[] }[] = [];
    for (const s of pageItems) {
      const last = out[out.length - 1];
      if (last && last.date === s.story_date) last.items.push(s);
      else out.push({ date: s.story_date, items: [s] });
    }
    return out;
  }, [pageItems]);

  const gotoPage = useCallback(
    (p: number) => {
      if (p < 1 || p > totalPages || p === cur) return;
      setPage(p);
      // 翻页后回到列表顶部，避免停在底部看「下一页」的半截
      listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [cur, totalPages],
  );

  const t = storyTheme(night);
  const readSet = useMemo(() => new Set(readIds), [readIds]);

  const openRandom = () => {
    if (stories.length === 0) return;
    const unread = stories.filter((s) => !readSet.has(s.id));
    const pool = unread.length > 0 ? unread : stories;
    openModal(pool[Math.floor(Math.random() * pool.length)]);
  };

  const activeIdx = active ? stories.findIndex((s) => s.id === active.id) : -1;
  const older = activeIdx >= 0 && activeIdx < stories.length - 1 ? stories[activeIdx + 1] : null;
  const newer = activeIdx > 0 ? stories[activeIdx - 1] : null;

  const heroRel = hero ? relDate(hero.story_date) : "";
  const heroParts = hero ? splitEmoji(hero.title) : null;

  return (
    <div className="pt-8 pb-16">
      {/* 页头 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="flex items-center gap-2 text-[26px] font-extrabold tracking-tight sm:text-3xl"
            style={{ color: t.strong }}
          >
            <BookOpen size={24} className="text-brand-gold" />
            睡前故事
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: t.dim }}>
            {stories.length > 0
              ? `共 ${stories.length} 篇 · 每晚一篇，读完就睡`
              : "每晚一篇，读完就睡"}
          </p>
        </div>
        {stories.length > 0 && (
          <button
            type="button"
            onClick={openRandom}
            title="随机挑一篇（优先没读过的）"
            className={`press inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${t.btn}`}
          >
            <Shuffle size={15} />
            随机一篇
          </button>
        )}
      </div>

      {/* 搜索 + 主题筛选 */}
      {stories.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="relative">
            <Search
              size={15}
              className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${
                night ? "text-[#6e5f51]" : "text-paper-500"
              }`}
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
              placeholder="搜索故事标题或摘要…"
              aria-label="搜索故事"
              className={`w-full rounded-xl border py-2.5 pl-9 pr-9 text-sm outline-none transition focus:border-brand-gold/60 ${
                night
                  ? "border-[#3a2f28] bg-[#221b17] text-[#e8ddd0] placeholder:text-[#6e5f51]"
                  : "border-paper-200 bg-white/70 text-paper-900 placeholder:text-[#8b7355]"
              }`}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                title="清除"
                aria-label="清除搜索"
                className={`press absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md transition ${
                  night ? "text-[#8a7866] hover:bg-[#2a221d]" : "text-paper-500 hover:bg-paper-200"
                }`}
              >
                <X size={13} />
              </button>
            )}
          </div>
          {tagStats.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={!tag} night={night} onClick={() => setTag(null)}>
                全部
              </Chip>
              {tagStats.map(([name, n]) => (
                <Chip
                  key={name}
                  active={tag === name}
                  night={night}
                  onClick={() => setTag(tag === name ? null : name)}
                >
                  {name}
                  <span className="text-[10px] opacity-60">{n}</span>
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 状态 */}
      {loading && <SkeletonCards night={night} />}

      {err && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-600/25 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="min-w-0 flex-1">加载失败：{err}</span>
          <button
            type="button"
            onClick={load}
            className="press inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-600/30 px-2.5 py-1 text-xs font-medium transition hover:bg-rose-600/10"
          >
            <RefreshCw size={12} />
            重试
          </button>
        </div>
      )}

      {!loading && !err && stories.length === 0 && (
        <div className={`mt-10 rounded-3xl border p-12 text-center ${t.card}`}>
          <BookOpen size={30} className="mx-auto text-paper-300" />
          <p className="mt-3 text-sm" style={{ color: t.dim }}>
            还没有故事
          </p>
        </div>
      )}

      {!loading && !err && stories.length > 0 && filtered.length === 0 && (
        <div className={`mt-10 rounded-3xl border p-10 text-center ${t.card}`}>
          <Search size={26} className="mx-auto text-paper-300" />
          <p className="mt-3 text-sm" style={{ color: t.dim }}>
            没有匹配的故事
          </p>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setTag(null);
            }}
            className="press mt-4 rounded-lg border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs font-medium text-paper-800 transition hover:bg-paper-200"
          >
            清除筛选
          </button>
        </div>
      )}

      {filtering && filtered.length > 0 && (
        <p className="mt-5 text-xs" style={{ color: t.faint }}>
          找到 {filtered.length} 篇
        </p>
      )}

      {/* 列表锚点：翻页后滚回这里 */}
      <div ref={listTopRef} style={{ scrollMarginTop: 88 }} />

      {/* 最近一篇（只在第 1 页、未筛选时显示） */}
      {cur === 1 && hero && heroParts && (
        <button
          type="button"
          onClick={() => openModal(hero)}
          className="press group mt-6 block w-full text-left"
        >
          <div
            className={`relative overflow-hidden rounded-3xl border p-6 transition sm:p-8 ${
              night
                ? "border-[#3a2f28] bg-[#221b17] hover:border-[#5a4636]"
                : "border-brand-gold/45 bg-gradient-to-br from-[#fffdf9] to-[#fbf0e0] hover:shadow-card"
            }`}
          >
            <MoonDecor night={night} size={84} />
            <div className="relative max-w-2xl">
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-gold/15 px-3 py-1 text-[11px] font-semibold"
                style={{ color: t.gold }}
              >
                {heroRel === "今天"
                  ? `今晚的故事 · ${formatDate(hero.story_date)}`
                  : `最近更新 · ${heroRel} · ${shortDate(hero.story_date)}`}
              </span>
              <h2
                className="mt-3 text-[21px] font-bold leading-snug sm:text-[25px]"
                style={{ color: t.strong }}
              >
                {heroParts.text}
              </h2>
              {hero.summary && (
                <p className="mt-2.5 text-sm leading-relaxed" style={{ color: t.dim }}>
                  {tidy(hero.summary)}
                </p>
              )}
              <span
                className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold"
                style={{ color: t.gold }}
              >
                点击阅读
                <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>
        </button>
      )}

      {/* 历史列表：按日期分组，桌面双列（分页切片后） */}
      {groups.map((g) => (
        <section key={g.date} className="mt-7">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-semibold" style={{ color: t.faint }}>
              {relDate(g.date)} · {weekdayOf(g.date)}
            </span>
            {g.items.length > 1 && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  night ? "bg-[#2a221d] text-[#8a7866]" : "bg-paper-200 text-paper-700"
                }`}
              >
                {g.items.length} 篇
              </span>
            )}
            <span className={`h-px flex-1 ${t.hairline}`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {g.items.map((s) => (
              <StoryCard
                key={s.id}
                s={s}
                night={night}
                read={readSet.has(s.id)}
                onOpen={openModal}
              />
            ))}
          </div>
        </section>
      ))}

      {/* 分页 */}
      {!loading && !err && list.length > 0 && (
        <Pagination page={cur} total={totalPages} night={night} onGo={gotoPage} />
      )}

      <ExitPresence open={!!active}>
        {active && (
          <StoryModal
            story={active}
            night={night}
            font={font}
            setFont={setFont}
            older={older}
            newer={newer}
            onGo={openModal}
            onClose={closeModal}
          />
        )}
      </ExitPresence>
    </div>
  );
}
