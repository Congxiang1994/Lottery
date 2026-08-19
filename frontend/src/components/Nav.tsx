import { NavLink, Link } from "react-router-dom";
import { Dices, LayoutDashboard, History, Sparkles, Layers, Github } from "lucide-react";

const GITHUB_URL = "https://github.com/Congxiang1994/Lottery";

const links = [
  { to: "/", label: "首页", icon: LayoutDashboard },
  { to: "/history", label: "历史开奖", icon: History },
  { to: "/predict", label: "智能推荐", icon: Sparkles },
  { to: "/algorithms", label: "算法广场", icon: Layers },
];

export default function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-900/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 text-lg shadow-glow">
            <Dices size={18} />
          </span>
          <span className="text-lg font-extrabold tracking-tight">
            Lottery
          </span>
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
                    ? "bg-white/10 text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white"
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
            className="group ml-1 flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-white/75 transition hover:border-brand-red/50 hover:bg-brand-red/10 hover:text-white"
          >
            <Github size={15} className="transition group-hover:scale-110" />
            <span className="hidden sm:inline">Star</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
