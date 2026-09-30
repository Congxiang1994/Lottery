import { useEffect, useRef, useState, ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

/** 入场动画时长，与下面的 transition 保持一致 */
const DUR_MS = 700;

/** 进入视口时淡入上浮。 */
export default function Reveal({ children, delay = 0, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  /** 入场动画放完 → 撤掉内联 transform / transition */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          ob.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setSettled(true), delay + DUR_MS);
    return () => window.clearTimeout(t);
  }, [shown, delay]);

  return (
    <div
      ref={ref}
      className={className}
      style={
        settled
          ? { opacity: 1 }
          : {
              opacity: shown ? 1 : 0,
              transform: shown ? "translateY(0)" : "translateY(26px)",
              transition: `opacity ${DUR_MS}ms cubic-bezier(0.22,1,0.36,1), transform ${DUR_MS}ms cubic-bezier(0.22,1,0.36,1)`,
              transitionDelay: `${delay}ms`,
            }
      }
    >
      {/* ⚠️ `settled` 之后必须把内联 transform 整个撤掉，不能停在 `translateY(0)`。
          任何非 `none` 的 transform 都会让这个 div 成为 `position: fixed` 后代的
          包含块（CSS Transforms L1 §3.1），弹窗 / 遮罩的 `inset-0` 就会相对它定位。
          本站已经为这个坑做过两轮修（`animation-fill-mode: backwards` + Portal），
          Reveal 是有名的「最容易忘记的一个」—— 它自己就常驻着一个内联 transform。 */}
      {children}
    </div>
  );
}
