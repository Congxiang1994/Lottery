import { Link } from "react-router-dom";
import {
  Dices,
  ArrowRight,
  Github,
  Clapperboard,
  Zap,
  Music,
  DownloadCloud,
  Lock,
  BookOpen,
  BookMarked,
  type LucideIcon,
} from "lucide-react";

/**
 * 产品矩阵 —— 新增产品只需在此数组追加一项即可。
 * status: "live" 可点击进入；"soon" 为占位（灰度、不可点，用于展示平台扩展性）。
 * private: true 时归入「私有产品」区块（密码保护功能）。
 * tint: 卡片图标配色（index.css 中的 .tint-* 类，含夜间模式适配）。
 */
const APPS: {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  tags: string[];
  href: string;
  status: "live" | "soon";
  isPrivate?: boolean;
  tint: "red" | "sky" | "gold" | "violet" | "amber";
}[] = [
  {
    id: "hanzi",
    title: "汉字是画出来的",
    desc: "108 节汉字动画课视频点播：按名称模糊检索，点击即全屏播放，支持快进/后退 5 秒与上/下一集切换。",
    icon: Clapperboard,
    tags: ["视频点播", "儿童教育"],
    href: "/hanzi",
    status: "live",
    tint: "red",
  },
  {
    id: "babysong",
    title: "Super Simple Songs 儿歌",
    desc: "518 首经典英文儿歌：官方封面 + YouTube 直链，点击即跳转播放，让孩子轻松磨耳朵。",
    icon: Music,
    tags: ["儿歌", "YouTube"],
    href: "/babysong",
    status: "live",
    tint: "sky",
  },
  {
    id: "story",
    title: "每日儿童睡前故事",
    desc: "每晚一篇睡前故事，按日期倒序铺开，点开即可全文阅读，支持夜间模式。",
    icon: BookOpen,
    tags: ["睡前故事", "儿童阅读"],
    href: "/story",
    status: "live",
    tint: "gold",
  },
  {
    id: "lottery",
    title: "彩票数据站",
    desc: "双色球 / 大乐透历史开奖全量统计、走势追踪与多策略智能推荐，一站看透号码规律。",
    icon: Dices,
    tags: ["数据可视化", "AI 推荐"],
    href: "/lottery",
    status: "live",
    tint: "violet",
  },
  {
    id: "babysong-admin",
    title: "儿歌下载管理",
    desc: "私有工具：用 yt-dlp 把儿歌爬取到服务器本地，下载完成后站内秒开播放，密码保护。",
    icon: DownloadCloud,
    tags: ["下载管理", "私有"],
    href: "/babysong-admin",
    status: "live",
    isPrivate: true,
    tint: "amber",
  },
  {
    id: "trigger",
    title: "API 用量触发器",
    desc: "私有定时任务：到点自动向大模型 API 发送最小请求，按作息点亮 5 小时用量窗口，密码保护。",
    icon: Zap,
    tags: ["定时任务", "私有"],
    href: "/trigger",
    status: "live",
    isPrivate: true,
    tint: "amber",
  },
  {
    id: "story-admin",
    title: "睡前故事管理",
    desc: "私有工具：故事的增删改查与发布管理，并可签发 API 密钥，供外部程序直接写入故事。",
    icon: BookMarked,
    tags: ["内容管理", "私有"],
    href: "/story-admin",
    status: "live",
    isPrivate: true,
    tint: "amber",
  },
];

/* 首页数据亮点：只在有确定数据时追加，避免虚标 */
const STATS: { value: string; label: string }[] = [
  { value: "108", label: "节汉字动画课" },
  { value: "518", label: "首经典英文儿歌" },
  { value: "每日", label: "更新一篇睡前故事" },
  { value: "全量", label: "双色球 / 大乐透数据" },
];

export default function Portal() {
  const liveApps = APPS.filter((a) => a.status === "live" && !a.isPrivate);
  const privateApps = APPS.filter((a) => a.status === "live" && a.isPrivate);

  return (
    <div className="pt-12 sm:pt-16">
      {/* Hero */}
      <section className="relative text-center">
        {/* 极淡网格纹理，向下渐隐 */}
        <div
          aria-hidden
          className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        />
        <div className="relative">
          <div className="mx-auto mb-6 inline-flex animate-rise items-center gap-2 rounded-full border border-paper-200 bg-paper-100/80 px-4 py-1.5 text-xs font-medium text-paper-700 backdrop-blur">
            <span className="text-brand-gold">✦</span>
            一站式产品矩阵
          </div>
          <h1
            className="animate-rise text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl"
            style={{ animationDelay: "70ms" }}
          >
            欢迎来到 <span className="gradient-text">Lottery</span>
          </h1>
          <p
            className="animate-rise mx-auto mt-4 max-w-xl text-sm text-paper-700 sm:text-base"
            style={{ animationDelay: "140ms" }}
          >
            一站式数据工具与智能应用集合。我们持续打磨每一款产品，把复杂留给我们，把简单交给你。
          </p>
          <div
            className="animate-rise mt-8 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "210ms" }}
          >
            <Link
              to="/hanzi"
              className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
            >
              <Clapperboard size={16} /> 欢迎进入《汉字是画出来的》{" "}
              <ArrowRight size={15} />
            </Link>
            <a
              href="https://github.com/Congxiang1994/Lottery"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-paper-200 px-5 py-3 text-sm font-medium text-paper-800 transition hover:border-paper-300 hover:text-paper-900"
            >
              <Github size={16} /> GitHub
            </a>
          </div>

          {/* 数据亮点条 */}
          <div
            className="animate-rise glass mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-y-6 rounded-3xl px-6 py-6 sm:grid-cols-4 sm:py-7"
            style={{ animationDelay: "280ms" }}
          >
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="gradient-text text-2xl font-extrabold tracking-tight sm:text-[28px]">
                  {s.value}
                </div>
                <div className="mt-1 text-[11px] leading-snug text-paper-600 sm:text-xs">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 全部产品（公开在线） */}
      <section className="mt-16 sm:mt-20">
        <SectionHeader
          eyebrow="Products"
          title="全部产品"
          badge={`${liveApps.length} 款在线`}
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {liveApps.map((app, i) => (
            <div
              key={app.id}
              className="animate-rise"
              style={{ animationDelay: `${340 + i * 70}ms` }}
            >
              <AppCard app={app} />
            </div>
          ))}
        </div>
      </section>

      {/* 私有产品 */}
      <section className="mt-14 sm:mt-16">
        <SectionHeader
          eyebrow="Private"
          title="私有产品"
          badge="密码保护 · 仅限本人"
          badgeIcon={<Lock size={11} strokeWidth={2.5} />}
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {privateApps.map((app, i) => (
            <div
              key={app.id}
              className="animate-rise"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <AppCard app={app} />
            </div>
          ))}
        </div>
      </section>

      <p className="animate-rise mt-14 text-center text-[11px] tracking-[0.08em] text-paper-500">
        更多产品正在路上 · 关注 GitHub 获取最新动态
      </p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  badge,
  badgeIcon,
}: {
  eyebrow: string;
  title: string;
  badge: string;
  badgeIcon?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex items-center gap-4">
      <div className="shrink-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-gold">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-xl font-bold tracking-tight">{title}</h2>
      </div>
      <span className="h-px flex-1 bg-gradient-to-r from-paper-200 to-transparent" />
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-paper-200 bg-paper-100/80 px-3 py-1 text-[11px] font-medium text-paper-700">
        {badgeIcon}
        {badge}
      </span>
    </div>
  );
}

function AppCard({
  app,
}: {
  app: (typeof APPS)[number];
}) {
  const live = app.status === "live";

  const inner = (
    <div
      className={`group relative h-full overflow-hidden rounded-3xl border p-6 transition ${
        live
          ? "glass card-hover border-paper-100"
          : "border-paper-100 bg-paper-50"
      }`}
    >
      {/* hover 时亮起的顶部渐变高光线 */}
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-gold/70 to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-red/15 blur-3xl opacity-0 transition group-hover:opacity-100" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <span
            className={`grid h-12 w-12 place-items-center rounded-2xl tint-${app.tint} transition duration-300 group-hover:scale-110`}
          >
            <app.icon size={22} />
          </span>
          <span className="flex items-center gap-1.5">
            {/* 私有功能标识：锁 + 私有 */}
            {app.isPrivate && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700"
                title="密码保护，仅限本人使用"
              >
                <Lock size={10} strokeWidth={2.5} /> 私有
              </span>
            )}
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                live ? "bg-emerald-50 text-emerald-700" : "bg-paper-100 text-paper-600"
              }`}
            >
              {live ? "在线" : "即将推出"}
            </span>
          </span>
        </div>

        <h3 className="mt-5 text-lg font-bold">{app.title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-paper-700">{app.desc}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {app.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-paper-200 bg-paper-100 px-2.5 py-0.5 text-[10px] text-paper-700"
            >
              {t}
            </span>
          ))}
        </div>

        {live && (
          <div className="mt-5 flex items-center gap-1 text-sm font-medium text-brand-red2">
            立即体验
            <ArrowRight size={14} className="transition group-hover:translate-x-1" />
          </div>
        )}
      </div>
    </div>
  );

  if (!live) return <div className="opacity-70">{inner}</div>;
  return (
    <Link to={app.href} className="block">
      {inner}
    </Link>
  );
}
