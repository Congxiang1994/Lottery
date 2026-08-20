import { Link } from "react-router-dom";
import {
  BookOpenCheck,
  Download,
  FolderOpen,
  Settings as SettingsIcon,
  ArrowRight,
  ShieldCheck,
  Zap,
  Gauge,
} from "lucide-react";

const MODULES = [
  {
    to: "/edu/browse",
    icon: BookOpenCheck,
    title: "资源浏览",
    desc: "浏览课程教学与电子教材目录，逐级展开并勾选教材、课时，解析并下载视频与课件。",
    grad: "from-brand-red/20 to-brand-gold/10",
    stat: "目录 / 解析 / 下载",
  },
  {
    to: "/edu/tasks",
    icon: Download,
    title: "下载任务",
    desc: "实时查看服务器下载任务进度，支持并发、失败重试与任务取消。",
    grad: "from-brand-gold/15 to-brand-red2/10",
    stat: "进度 / 统计 / 取消",
  },
  {
    to: "/edu/files",
    icon: FolderOpen,
    title: "已下载文件",
    desc: "管理服务器上已下载的文件，单个下载、打包 ZIP 或删除。",
    grad: "from-emerald-400/15 to-teal-400/10",
    stat: "浏览 / 打包 / 删除",
  },
  {
    to: "/edu/settings",
    icon: SettingsIcon,
    title: "登录配置",
    desc: "书签一键授权或手动配置平台登录信息，每个浏览器独立生效。",
    grad: "from-white/10 to-white/5",
    stat: "书签 / Token / 会话",
  },
];

export default function EduPortal() {
  return (
    <div className="space-y-8 animate-rise">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl glass card-hover p-8 sm:p-12">
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand-red/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-brand-gold/10 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-red" />
            国家中小学智慧教育平台 · basic.smartedu.cn
          </span>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            智慧教育<span className="gradient-text">资源下载助手</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-white/55">
            一站式浏览、解析并下载平台课程教学与电子教材资源。普通文件可浏览器直连平台 CDN 不占服务器流量，
            视频由服务器合并下载；每个浏览器使用独立的平台登录信息。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/edu/browse"
              className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
            >
              <BookOpenCheck size={16} /> 开始浏览资源
            </Link>
            <Link
              to="/edu/settings"
              className="flex items-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-sm font-medium text-white/70 transition hover:border-white/25 hover:text-white"
            >
              配置登录 <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* 功能矩阵 */}
      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">产品矩阵</h2>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <Link key={m.to} to={m.to} className="group glass card-hover rounded-2xl p-6 flex flex-col">
              <div
                className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${m.grad} text-brand-red2 mb-4 transition group-hover:scale-110`}
              >
                <m.icon size={22} />
              </div>
              <div className="font-semibold text-white text-lg">{m.title}</div>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-white/55">{m.desc}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-white/40">{m.stat}</span>
                <ArrowRight
                  size={16}
                  className="text-brand-red2 transition group-hover:translate-x-0.5"
                />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 特性 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: Zap, title: "直连省流量", desc: "普通文件浏览器直连平台 CDN，零服务器流量" },
          { icon: ShieldCheck, title: "会话隔离", desc: "每个浏览器独立配置自己的登录信息，互不影响" },
          { icon: Gauge, title: "并发下载", desc: "视频走服务器 ffmpeg 合并，支持并发与失败重试" },
        ].map((f) => (
          <div key={f.title} className="glass rounded-2xl p-5 flex gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-brand-red2">
              <f.icon size={20} />
            </div>
            <div>
              <div className="font-semibold text-white">{f.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-white/55">{f.desc}</div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
