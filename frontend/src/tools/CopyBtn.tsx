import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** 一键复制按钮：复制成功显示「已复制」对勾，1.5s 后复位。 */
export default function CopyBtn({ text, title = "复制" }: { text: string; title?: string }) {
  const [ok, setOk] = useState(false);
  const copy = () => {
    if (!text) return;
    const done = () => {
      setOk(true);
      window.setTimeout(() => setOk(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      // 退化方案：部分浏览器（非 HTTPS / 旧版）无 clipboard API
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* 忽略 */
      }
      document.body.removeChild(ta);
      done();
    }
  };
  return (
    <button
      onClick={copy}
      title={title}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-paper-200 bg-white/50 text-paper-700 transition hover:bg-paper-100 hover:text-paper-900"
    >
      {ok ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
    </button>
  );
}
