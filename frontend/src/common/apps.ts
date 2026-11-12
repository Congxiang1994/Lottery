import {
  BadgePercent,
  BookMarked,
  BookOpen,
  Clapperboard,
  Dices,
  DownloadCloud,
  Music,
  Radar,
  SlidersHorizontal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * 产品矩阵 —— **全站唯一的产品清单**。
 *
 * 加一个产品时只需要改两处：本文件追加一项 + `App.tsx` 加一条 `<Route>`。
 * 导航（`Nav.tsx`）不再维护 `pathname.startsWith(...)` 的白名单，
 * 而是直接问这里「这个路径属于哪个产品、要不要显示内部导航」。
 *
 * 为什么值得抽出来：改造前同一份「有哪些产品」的知识散在三处
 * （`Portal.APPS` / `App.tsx` 路由 / `Nav.useNavLinks` 的 8 个 startsWith），
 * 加一个入口要同步改三处，漏了 `Nav` 就会出现「进了新产品却还显示彩票的四个 tab」。
 *
 * 字段
 * ----
 * - ``status``    ``live`` 可点击进入；``soon`` 为灰度占位卡
 * - ``isPrivate`` 密码保护，门户归入「私有产品」区块
 * - ``tint``      卡片图标配色（index.css 的 ``.tint-*``，含夜间映射）
 * - ``nav``       进入该产品后顶部导航显示哪一组（默认只显示「首页」）
 */
export type AppTint = "red" | "sky" | "gold" | "violet" | "amber" | "teal";

export interface AppEntry {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  tags: string[];
  href: string;
  status: "live" | "soon";
  isPrivate?: boolean;
  tint: AppTint;
}

export const APPS: AppEntry[] = [
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
    desc: "518 首经典英文儿歌：官方封面 + YouTube 直链，已下载的可站内秒开，让孩子轻松磨耳朵。",
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
    id: "deals",
    title: "捡漏",
    desc: "自动盯「什么值得买」的手慢无、绝对值、历史低价、多重优惠叠加四个标签流，按折扣深度排序 —— 折得越狠越靠前，榜单里带爆料人与原价折数。",
    icon: BadgePercent,
    tags: ["好价聚合", "自动筛选"],
    href: "/deals",
    status: "live",
    tint: "gold",
  },
  {
    id: "tools",
    title: "实用小工具",
    desc: "开发者随身工具箱：时间戳转换、JSON 源码与可折叠节点树、Markdown 预览、随手画板。",
    icon: Wrench,
    tags: ["小工具", "效率"],
    href: "/tools",
    status: "live",
    tint: "teal",
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
    id: "access",
    title: "访问管理",
    desc: "私有工具：记录访客、接口与地区访问明细，支持按 IP / 访客聚合、图表分析与 CSV 导出。",
    icon: Radar,
    tags: ["访问审计", "私有"],
    href: "/access",
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
  {
    id: "deals-admin",
    title: "捡漏设置",
    desc: "私有工具：折扣判定档位、抓取来源（标签流）与页数、热度阈值兜底、关注品类权重与品类黑名单。",
    icon: SlidersHorizontal,
    tags: ["折扣 · 来源", "私有"],
    href: "/deals-admin",
    status: "live",
    isPrivate: true,
    tint: "amber",
  },
];
