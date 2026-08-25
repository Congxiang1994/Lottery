import { Link } from "react-router-dom";
import { Dices, ArrowRight, Github, Sparkles, Clapperboard, type LucideIcon } from "lucide-react";

/**
 * 产品矩阵 —— 新增产品只需在此数组追加一项即可。
 * status: "live" 可点击进入；"soon" 为占位（灰度、不可点，用于展示平台扩展性）。
 */
const APPS: {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  tags: string[];
  href: string;
  status: "live" | "soon";
}[] = [
  {
    id: "lottery",
    title: "彩票数据站",
    desc: "双色球 / 大乐透历史开奖全量统计、走势追踪与多策略智能推荐，一站看透号码规律。",
    icon: Dices,
    tags: ["数据可视化", "AI 推荐"],
    href: "/lottery",
    status: "live",
  },
  {
    id: "hanzi",
    title: "汉字是画出来的",
    desc: "108 节汉字动画课视频点播：按名称模糊检索，点击即全屏播放，支持快进/后退 5 秒与上/下一集切换。",
    icon: Clapperboard,
    tags: ["视频点播", "儿童教育"],
    href: "/hanzi",
    status: "live",
  },
  {
    id: "soon",
    title: "更多产品筹备中",
    desc: "我们正在打磨下一款产品，敬请期待。如果你有想法，欢迎到 GitHub 一起共建。",
    icon: Sparkles,
    tags: ["Coming Soon"],
    href: "",
    status: "soon",
  },
];

export default function Portal() {
  const liveCount = APPS.filter((a) => a.status === "live").length;

  return (
    <div className="pt-12 sm:pt-16">
      {/* Hero */}
      <section className="relative text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white/60">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-red" />
          Product Matrix · 产品矩阵
        </div>
        <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
          欢迎来到 <span className="gradient-text">Lottery</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-white/55 sm:text-base">
          一站式数据工具与智能应用集合。我们持续打磨每一款产品，把复杂留给我们，把简单交给你。
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/hanzi"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
          >
            <Clapperboard size={16} /> 欢迎进入《汉字是画出来的》 <ArrowRight size={15} />
          </Link>
          <a
            href="https://github.com/Congxiang1994/Lottery"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-medium text-white/70 transition hover:border-white/25 hover:text-white"
          >
            <Github size={16} /> GitHub
          </a>
        </div>
      </section>

      {/* 产品网格 */}
      <section className="mt-16 sm:mt-20">
        <div className="mb-7 flex items-center gap-3">
          <h2 className="text-xl font-bold">全部产品</h2>
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-white/40">{liveCount} 款在线</span>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      </section>

      <p className="mt-14 text-center text-xs text-white/30">
        更多产品正在路上 · 关注 GitHub 获取最新动态
      </p>
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
          ? "glass card-hover border-white/8"
          : "border-white/6 bg-white/[0.02]"
      }`}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-red/15 blur-3xl opacity-0 transition group-hover:opacity-100" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-red/20 to-brand-gold/10 text-brand-red2 shadow-glow">
            <app.icon size={22} />
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
              live ? "bg-emerald-400/10 text-emerald-300" : "bg-white/8 text-white/40"
            }`}
          >
            {live ? "在线" : "即将推出"}
          </span>
        </div>

        <h3 className="mt-5 text-lg font-bold">{app.title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-white/50">{app.desc}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {app.tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] text-white/55"
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
