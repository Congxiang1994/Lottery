import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * 全站统一的页面头部（标题 + 副标题 + 右侧操作区）。
 *
 * 为什么要有它
 * ------------
 * 14 个页面此前各写各的 `<h1>`：字号有 `text-2xl` / `text-3xl` / `text-4xl sm:text-5xl`
 * 三档随手混用，副标题有的 `text-sm text-paper-700`、有的 `text-xs text-paper-600`，
 * 图标有的带 `size={26}` 有的没有，右侧操作区有的 `items-center` 有的 `items-end`。
 * 结果是从「历史开奖」切到「捡漏」再切到「访问管理」，标题会肉眼可见地跳字号。
 *
 * 三档尺寸（**只准用这三档，不要再调 className 改字号**）
 * -----------------------------------------------------
 * - ``hero``   首屏落地页（彩票首页 / 儿歌 / 汉字课）：`text-4xl sm:text-5xl`，
 *              居中排版由调用方包一层 `text-center`。
 * - ``page``   默认。功能主页（历史开奖 / 算法广场 / 睡前故事 / 触发器 / 工具）。
 * - ``compact`` 管理台与高密度数据页（捡漏 / 捡漏设置 / 访问管理）：
 *              标题略小、副标题更细，给表格让出纵向空间。
 */
export type PageHeaderSize = "hero" | "page" | "compact";

const TITLE: Record<PageHeaderSize, string> = {
  hero: "text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl",
  page: "text-3xl font-extrabold tracking-tight",
  compact: "text-2xl font-extrabold tracking-tight",
};

const SUBTITLE: Record<PageHeaderSize, string> = {
  hero: "text-sm text-paper-700",
  page: "text-sm text-paper-700",
  compact: "text-xs text-paper-600",
};

const ICON_SIZE: Record<PageHeaderSize, number> = { hero: 30, page: 26, compact: 22 };

export interface PageHeaderProps {
  title: ReactNode;
  /** 副标题：一句话说清「这页有什么 / 数据口径」 */
  subtitle?: ReactNode;
  /** 标题前的图标 */
  icon?: LucideIcon;
  /** 图标配色类（按功能域区分色调，如 `text-brand-red`） */
  iconClass?: string;
  /** 标题上方的小字眉标（如 `Private Console`） */
  eyebrow?: ReactNode;
  /** 标题右侧的徽章（如「私有」「演示」） */
  badge?: ReactNode;
  /** 右侧操作区（按钮组） */
  actions?: ReactNode;
  size?: PageHeaderSize;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconClass = "text-brand-red",
  eyebrow,
  badge,
  actions,
  size = "page",
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={`flex flex-wrap ${
        size === "hero" ? "flex-col items-center" : "items-end justify-between"
      } gap-4 ${className}`}
    >
      <div className={size === "hero" ? "text-center" : ""}>
        {eyebrow && (
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-gold">
            {eyebrow}
          </div>
        )}
        <h1 className={`flex items-center gap-2 ${TITLE[size]}`}>
          {Icon && <Icon size={ICON_SIZE[size]} className={iconClass} />}
          {title}
          {badge}
        </h1>
        {subtitle && <p className={`mt-1 ${SUBTITLE[size]}`}>{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * 「私有」徽章：所有密码保护功能页标题旁统一挂它。
 * 原先只有 /access 有，/trigger、/story-admin、/deals-admin 都没有 ——
 * 同样是私有功能，用户得靠「有没有密码门」自己推断。
 */
export function PrivateBadge() {
  return (
    <span className="rounded-full border border-amber-600/25 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
      私有
    </span>
  );
}
