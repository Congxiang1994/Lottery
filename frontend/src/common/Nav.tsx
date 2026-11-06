import { NavLink, Link, useLocation } from "react-router-dom";
import { Dices, LayoutDashboard, History, Sparkles, Layers, Github, Eye, Moon, Sun } from "lucide-react";
import { APPS } from "./apps";
import { useVisitCount } from "./useVisitCount";
import { useTheme } from "./useTheme";

const GITHUB_URL = "https://github.com/Congxiang1994/Lottery";

/** 只显示「首页」的产品的导航组（绝大多数独立产品都属于这一类）。 */
const portalLinks = [{ to: "/", label: "首页", icon: LayoutDashboard }];

/** 彩票数据站有内部二级导航（唯一一个多 tab 的产品）。 */
const lotteryLinks = [
  { to: "/", label: "首页", icon: LayoutDashboard },
  { to: "/history", label: "历史开奖", icon: History },
  { to: "/predict", label: "智能推荐", icon: Sparkles },
  { to: "/algorithms", label: "算法广场", icon: Layers },
];

/**
 * 当前路径属于哪个产品 → 显示哪一组导航。
 *
 * 改造前是一串 8 个 `pathname.startsWith(...)` 的白名单，而「有哪些产品」这份知识
 * 同时存在于 `Portal.APPS` 与 `App.tsx` 的路由表里 —— 加一个入口要改三处，
 * 漏改 `Nav` 就会出现「进了新产品，顶部却还显示彩票的四个 tab」。
 *
 * 现在只问注册表：**匹配到非彩票产品就只留首页**，其余（含彩票站自身）走彩票组。
 */
const MULTI_TAB_APP_IDS = new Set(["lottery"]);

function useNavLinks() {
  const { pathname } = useLocation();
  if (pathname === "/") return portalLinks;
  // 最长前缀匹配：/story-admin 必须命中 story-admin，而不是 story
  const hit = APPS
    .filter((a) => a.status === "live" && pathname.startsWith(a.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!hit) return lotteryLinks;
  return MULTI_TAB_APP_IDS.has(hit.id) ? lotteryLinks : portalLinks;
}

export default function Nav() {
  const links = useNavLinks();
  const { total: visits, visitors } = useVisitCount();
  const { night, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 border-b border-paper-100 bg-paper-100/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 text-lg shadow-glow">
            <Dices size={18} />
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            Lottery
          </span>
          {visits != null && (
            <span
              title={
                visitors != null
                  ? `本站共 ${visitors.toLocaleString()} 人来访，累计 ${visits.toLocaleString()} 次`
                  : `本站累计被访问 ${visits.toLocaleString()} 次`
              }
              className="ml-1 hidden items-center gap-1 rounded-full border border-paper-200 bg-white/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-paper-700 sm:inline-flex"
            >
              <Eye size={11} className="text-brand-red" />
              {visitors != null
                ? `${visitors.toLocaleString()} 人来访 · 共 ${visits.toLocaleString()} 次`
                : visits.toLocaleString()}
            </span>
          )}
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-paper-200 text-paper-900"
                    : "text-paper-700 hover:bg-paper-100 hover:text-paper-900"
                }`
              }
            >
              <l.icon size={15} />
              <span className="hidden sm:inline">{l.label}</span>
            </NavLink>
          ))}

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="⭐ 给项目点个 Star，支持开源！"
            className="group ml-1 flex items-center gap-1.5 rounded-lg border border-paper-200 px-3 py-2 text-sm font-semibold text-paper-800 transition hover:border-brand-red/50 hover:bg-brand-red/10 hover:text-paper-900"
          >
            <Github size={15} className="transition group-hover:scale-110" />
            <span className="hidden sm:inline">Star</span>
          </a>

          <button
            onClick={toggle}
            title={night ? "切换到亮色" : "切换到暗色"}
            className="ml-1 grid h-9 w-9 place-items-center rounded-lg border border-paper-200 text-paper-700 transition hover:border-brand-gold/50 hover:bg-brand-gold/10 hover:text-paper-900"
          >
            {night ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </nav>
      </div>
    </header>
  );
}
