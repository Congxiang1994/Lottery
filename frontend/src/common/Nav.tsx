import { NavLink, Link, useLocation } from "react-router-dom";
import { Dices, LayoutDashboard, History, Sparkles, Layers, Github, Eye } from "lucide-react";
import { useVisitCount } from "./useVisitCount";

const GITHUB_URL = "https://github.com/Congxiang1994/Lottery";

// 聚合门户首页只保留「首页」入口；进入具体产品（如彩票数据站）后再展示其内部导航。
const portalLinks = [{ to: "/", label: "首页", icon: LayoutDashboard }];

const lotteryLinks = [
  { to: "/", label: "首页", icon: LayoutDashboard },
  { to: "/history", label: "历史开奖", icon: History },
  { to: "/predict", label: "智能推荐", icon: Sparkles },
  { to: "/algorithms", label: "算法广场", icon: Layers },
];

function useNavLinks() {
  const { pathname } = useLocation();
  // 根路径是聚合门户；/hanzi、/trigger、/babysong 是独立产品 —— 均仅保留首页入口。
  if (pathname === "/") return portalLinks;
  if (pathname.startsWith("/hanzi")) return portalLinks;
  if (pathname.startsWith("/trigger")) return portalLinks;
  if (pathname.startsWith("/babysong")) return portalLinks;
  return lotteryLinks;
}

export default function Nav() {
  const links = useNavLinks();
  const visits = useVisitCount();
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
              title={`本站累计被访问 ${visits.toLocaleString()} 次`}
              className="ml-1 hidden items-center gap-1 rounded-full border border-paper-200 bg-white/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-paper-700 sm:inline-flex"
            >
              <Eye size={11} className="text-brand-red" />
              {visits.toLocaleString()}
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
        </nav>
      </div>
    </header>
  );
}
