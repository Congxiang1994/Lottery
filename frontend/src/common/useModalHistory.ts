import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * 弹窗历史栈：弹窗打开时压入一条历史记录，浏览器返回键 / 手机侧滑返回只关弹窗、
 * 不离开页面；主动关闭时把那条记录弹掉，保持浏览器历史干净。
 *
 * 用法（配合 `common/Modal.tsx` 的 Portal 容器）：
 * ```tsx
 * const modal = useModalHistory("storyModal", () => setActive(null));
 * // 打开： setActive(s); modal.push();
 * // 关闭： setActive(null); modal.pop();
 * ```
 * 第三个参数不需要传「弹窗是否打开」—— 状态由调用方自己管，hook 只负责历史记录
 * 与返回键语义，避免两套 open 状态互相打架。
 *
 * ⚠️ 两个竞态必须都处理，少一个就出 bug（2026-09-29 抽 hook 时发现
 * `/hanzi` 与 `/babysong` 两处都只处理了第 1 条）：
 *
 * 1. `pushedRef` —— 防重复压栈。弹窗内「下一篇 / 下一首 / 切集」会再次触发「打开」
 *    逻辑，若不拦截会压出多条记录，用户得连按好几次返回才能退出。
 *
 * 2. `selfPopRef` —— `history.back()` 到 `popstate` 派发之间是**异步**的。
 *    主动关闭后若用户立刻又点开一个，那次迟到的 popstate 会把刚打开的新弹窗
 *    误关掉。用自己的标记吃掉这一次即可。
 *
 * `onClose` 通过 ref 取最新值，所以监听只绑一次、不需要重绑，也不会拿到过期闭包。
 */
export function useModalHistory(tag: string, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const pushedRef = useRef(false);
  const selfPopRef = useRef(false);

  useEffect(() => {
    const onPop = () => {
      if (selfPopRef.current) {
        selfPopRef.current = false; // 自己发起的 back，忽略
        return;
      }
      if (!pushedRef.current) return;
      pushedRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback(() => {
    if (pushedRef.current) return;
    pushedRef.current = true;
    window.history.pushState({ [tag]: true }, "");
  }, [tag]);

  const pop = useCallback(() => {
    if (!pushedRef.current) return;
    pushedRef.current = false;
    selfPopRef.current = true;
    window.history.back();
  }, []);

  /* 返回稳定引用：调用方可以放心把它写进 useCallback / useEffect 的依赖数组 */
  return useMemo(() => ({ push, pop }), [push, pop]);
}
