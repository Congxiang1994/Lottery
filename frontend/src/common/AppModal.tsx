import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";

import { Modal } from "./Modal";

/**
 * 全站统一的弹窗壳（遮罩 + 面板 + 关闭按钮 + 出场动画）。
 *
 * 为什么要有它
 * ------------
 * 12 处弹窗此前各写一套 `anim-overlay` / `anim-panel` 组合，遮罩透明度已经分裂成
 * 5 个值（`/40` `/50` `/60` `/65` + `bg-paper-900/50`）、模糊有 `sm` / `md` 两档、
 * 面板圆角 `rounded-2xl` 与 `rounded-3xl` 混用、有的带关闭按钮有的只能点遮罩关。
 * **弹窗是全站最需要一致的一类 UI** —— 用户在不同功能里点开弹窗，手感必须一样。
 *
 * 三档宽度（只准用这三档）
 * -----------------------
 * - ``sm``  确认框 / 单项输入（如「运行全部算法」密码框）
 * - ``md``  表单弹窗（任务编辑 / 密钥 / 故事编辑），默认
 * - ``lg``  内容弹窗（视频播放 / 长文阅读 / 详情）
 *
 * 滚动策略（与 story 详情弹窗一致，不要各写各的）
 * ----------------------------------------------
 * 遮罩负责滚动（`overflow-y-auto` + `overscroll-contain`），面板限高
 * `100dvh - 2rem`，内容区自己 `overflow-y-auto`。这样在手机上：
 * 键盘弹起、内容超长、内容很短三种情况都不会把标题栏挤出屏幕。
 */

export type ModalSize = "sm" | "md" | "lg";

const MAX_W: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-3xl",
};

export interface AppModalProps {
  /** 关闭回调（点遮罩 / 点关闭按钮 / Esc 由调用方用 useEscapeClose 处理） */
  onClose: () => void;
  /** 标题栏（可省略：详情类弹窗自带标题栏） */
  title?: ReactNode;
  /** 标题下的说明 */
  description?: ReactNode;
  /** 标题右侧、关闭按钮左侧的操作区 */
  actions?: ReactNode;
  /** 面板外观：glass（默认，半透明毛玻璃）/ paper（长文阅读，书页纸面） */
  surface?: "glass" | "paper";
  /** 面板定制样式（如动画延迟） */
  style?: CSSProperties;
  /**
   * 遮罩层级。默认 50；**嵌套弹窗（在一个弹窗里再开一个）传 60**，
   * 否则后开的弹窗会被先开的压在下面（/hanzi 选集面板曾踩过）。
   */
  z?: 50 | 60;
  size?: ModalSize;
  /** 是否显示右上角关闭按钮，默认 true */
  closable?: boolean;
  /**
   * 裸壳模式：只渲染「遮罩 + 面板」，标题栏/底部栏由调用方自己画。
   * 用于详情类弹窗（阅读页有进度条、播放页有信息栏），它们的内容区
   * 与标准表单弹窗结构不同，但仍要共用遮罩色调 / 层级 / 出场动画。
   */
  bare?: boolean;
  /** 无障碍标签（详情类弹窗用标题当 label） */
  ariaLabel?: string;
  /** 遮罩不关闭（提交中禁止误触）；同时禁用 Esc */
  dismissable?: boolean;
  /**
   * 是否由 AppModal 注册 Esc 关闭，默认 true。
   * 传 false 的场景只有一个：页面自己要做**分级 Esc**（如 /hanzi 先关选集面板、
   * 再关播放器）。两边都注册会让一次 Esc 把两层一起关掉。
   */
  escapeClose?: boolean;
  children: ReactNode;
  /** 面板底部固定操作条 */
  footer?: ReactNode;
  className?: string;
}

export function AppModal({
  onClose,
  title,
  description,
  actions,
  surface = "glass",
  style,
  z = 50,
  size = "md",
  closable = true,
  bare = false,
  ariaLabel,
  dismissable = true,
  escapeClose = true,
  footer,
  className = "",
  children,
}: AppModalProps) {
  /* Esc 关闭：统一在这里注册，调用方不必再各自 useEscapeClose。
     ⚠️ 用冒泡阶段且不 preventDefault —— 弹窗里的输入框仍要能收到 Esc。 */
  useEffect(() => {
    if (!dismissable || !escapeClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissable, escapeClose, onClose]);

  const panelSkin =
    surface === "paper"
      ? "paper-sheet rounded-3xl shadow-card"
      : "glass rounded-3xl shadow-card";

  return (
    <Modal>
      <div
        className={`anim-overlay fixed inset-0 ${
          z === 60 ? "z-[60]" : "z-50"
        } flex items-center justify-center overflow-y-auto overscroll-contain bg-[#3d2b1f]/60 p-4 backdrop-blur-sm`}
        onClick={dismissable ? onClose : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div
          style={style}
          className={`anim-panel flex max-h-[calc(100dvh-2rem)] w-full ${MAX_W[size]} flex-col overflow-hidden ${panelSkin} ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {!bare && (title || actions || closable) && (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-paper-100 px-5 py-3.5">
              <div className="min-w-0">
                {title && (
                  <h3 className="flex items-center gap-2 text-base font-bold text-paper-900">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="mt-0.5 text-xs text-paper-600">{description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {actions}
                {closable && (
                  <button
                    type="button"
                    onClick={onClose}
                    title="关闭"
                    aria-label="关闭"
                    className="press grid h-8 w-8 place-items-center rounded-full border border-paper-200 text-paper-600 transition hover:border-brand-gold/50 hover:text-paper-900"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
          {bare ? children : <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>}
          {!bare && footer && (
            <div className="shrink-0 border-t border-paper-100 px-5 py-3">{footer}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * 确认框（删除 / 停用这类不可逆操作）。
 *
 * 全站 3 处手写确认框（Trigger / StoryAdmin / DealsAdmin）结构一致但按钮文案与
 * 危险色不一致 —— 统一到这里后，「红色按钮 = 破坏性操作」在全站成立。
 */
export function ConfirmDialog({
  title,
  message,
  confirmText = "确认删除",
  cancelText = "取消",
  danger = true,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AppModal onClose={onCancel} title={title} size="sm" dismissable={!busy}>
      <div className="px-5 py-4 text-sm leading-relaxed text-paper-700">{message}</div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="press rounded-xl border border-paper-200 px-4 py-2 text-sm text-paper-700 transition hover:bg-paper-100 disabled:opacity-40"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`press rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40 ${
            danger
              ? "bg-gradient-to-br from-rose-600 to-rose-500"
              : "bg-gradient-to-br from-brand-gold to-brand-red"
          }`}
        >
          {busy ? "处理中…" : confirmText}
        </button>
      </div>
    </AppModal>
  );
}

/** 受控开关：`const [open, setOpen] = useState(...)` 时用它包住条件渲染更省心。 */
export function useModalState() {
  const [open, setOpen] = useState(false);
  return {
    open,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    setOpen,
  };
}
