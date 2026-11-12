/**
 * 即时 tooltip（无动画、瞬间弹出）。
 *
 * 为什么不用原生 ``title``：
 *  - 浏览器原生提示要悬停约 1 秒才出现，还不受控制；
 *  - 样式跟随系统，跟本站 paper 色板 / 暗色模式不统一。
 *
 * 为什么不引第三方库：这里只需要「hover 立刻显示一行说明」，
 * 用 CSS group-hover 纯声明式实现即可，零运行时、零依赖、不增加 chunk。
 *
 * 实现：外层 span 是 relative 容器，tooltip 用 absolute 定位 + ``group-hover:opacity-100``。
 * **不加 transition**（用户明确要求「不要动画，要快速弹出来」）。
 *
 * 注意：触发元素外面必须有一层 ``group``，或者直接使用本组件包住触发元素。
 */
import type { ReactNode } from "react";

export interface TipProps {
  /** 提示文案（一句话说清这个按钮干什么） */
  text: string;
  children: ReactNode;
  /** 提示出现方向，默认下方居中 */
  side?: "top" | "bottom";
  /** 外层是否包成 inline-flex（默认 true） */
  inline?: boolean;
  className?: string;
}

export default function Tip({ text, children, side = "bottom", inline = true, className = "" }: TipProps) {
  return (
    <span className={`group relative ${inline ? "inline-flex" : ""} ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-paper-900 px-2 py-1 text-[11px] font-medium leading-tight text-white opacity-0 shadow-lg group-hover:opacity-100 ${
          side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
