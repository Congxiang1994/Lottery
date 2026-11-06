/**
 * 全站 UI 类名 token（**新代码只准从这里取，不要再手写一串 Tailwind 类**）。
 *
 * 为什么需要它
 * ------------
 * 改造前同一件东西在多个文件里各写一遍，且已经漂移：
 *  - 输入框类名有 6 份定义（4 份的 `px/py` 还各不相同、有人漏 `transition`）
 *  - 主按钮有 2 套渐变色：`gold→red`（11 处）与 `red→red2`（7 处），
 *    同样是「提交/确认」的动作，在不同页面颜色不一样
 *  → 用户看到的是「同一个动作长得不一样」，而这不是产品设计，是复制粘贴的副产物。
 *
 * 分工（唯一的一套规则）
 * ---------------------
 * - **主按钮 = 品牌红渐变**（`BTN_PRIMARY`）：页面里最重要的那个动作
 *   （进入 / 开始播放 / 保存 / 确认）。全站只有这一种。
 * - **金色只作强调色**（图标、描边、徽章、进度条），不再用于按钮底色。
 *   各功能域的「色调差异」体现在这里（`PageHeader.iconClass` / `.tint-*`），
 *   不体现在按钮颜色上 —— 按钮是全站统一的**操作语义**。
 * - **次级按钮 = 描边**（`BTN_SECONDARY`）；**图标按钮**（`BTN_ICON`）。
 *
 * ⚠️ 尺寸（padding / 字号）不放进 token：同一按钮在工具栏和表单里需要不同高度，
 *    强行统一会让紧凑区域溢出。这里只统一「颜色 + 圆角 + 交互反馈 + 禁用态」。
 */

/* ------------------------------ 按钮 ------------------------------ */

const BTN_BASE =
  "press inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold " +
  "transition disabled:pointer-events-none disabled:opacity-40";

/** 主按钮：全站唯一的「主要动作」样式。尺寸自己叠（如 `px-4 py-2 text-sm`）。 */
export const BTN_PRIMARY = `${BTN_BASE} bg-gradient-to-br from-brand-red to-brand-red2 text-white shadow-glow hover:opacity-90`;

/** 次级按钮：描边 + 白底，用于「取消 / 刷新 / 次要入口」。 */
export const BTN_SECONDARY =
  "press inline-flex items-center justify-center gap-1.5 rounded-xl border border-paper-200 " +
  "font-medium text-paper-800 transition hover:border-brand-gold/50 hover:bg-paper-100 " +
  "disabled:pointer-events-none disabled:opacity-40";

/** 图标按钮（工具栏里的小方块，36×36）。 */
export const BTN_ICON =
  "press grid h-9 w-9 place-items-center rounded-xl border border-paper-200 " +
  "text-paper-700 transition hover:border-brand-gold/50 hover:bg-brand-gold/10 " +
  "disabled:pointer-events-none disabled:opacity-40";

/** 危险动作（删除 / 清空）：确认框里的红色按钮。 */
export const BTN_DANGER = `${BTN_BASE} bg-gradient-to-br from-rose-600 to-rose-500 text-white shadow-glow hover:opacity-90`;

/* ------------------------------ 表单 ------------------------------ */

/** 标准输入框 / 下拉 / 文本域。 */
export const INPUT =
  "w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2 text-sm " +
  "text-paper-900 outline-none transition placeholder:text-paper-500 focus:border-brand-gold/50";

/** 紧凑输入框（筛选条 / 工具栏）：比 INPUT 矮一档、字号更小。 */
export const INPUT_SM =
  "rounded-lg border border-paper-200 bg-white/60 px-2.5 py-1.5 text-xs " +
  "text-paper-900 outline-none transition placeholder:text-paper-500 focus:border-brand-gold/50";

/** 表单字段标签 + 错误提示的统一排版。 */
export const LABEL = "text-xs font-medium text-paper-700";

/* ------------------------------ 容器 ------------------------------ */

/** 玻璃卡片（页面主体区块）。 */
export const CARD = "glass rounded-3xl shadow-card";

/** 紧凑卡片（列表项 / 统计块）。 */
export const CARD_COMPACT = "rounded-2xl border border-paper-100 bg-paper-50";

/** 分段控件外壳（Tab 切换 / 时间窗切换）。 */
export const SEGMENTED = "flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1";
