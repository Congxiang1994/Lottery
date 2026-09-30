/**
 * Esc 关闭弹窗 —— 全站统一手感（story 页的详情弹窗一直支持 Esc，其它弹窗没跟上）。
 *
 * ⚠️ 绑定时机：只在 `on` 为真时注册。若在组件挂载时就无条件注册，
 *    弹窗已关闭但监听还在，Esc 会去调用一个语义上已失效的回调。
 * ⚠️ 用冒泡阶段的 `keydown`、**不 preventDefault**：弹窗里若有输入框
 *    （如访客标注的备注），Esc 仍要能关窗，也不能吞掉输入法自身的取消键。
 * ⚠️ `close` 通常是个内联箭头函数（每次 render 新身份）→ effect 会重订阅。
 *    这是廉价的（加/删一个监听器），不要为此上 `useCallback`。
 */
import { useEffect } from "react";

export function useEscapeClose(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, close]);
}
