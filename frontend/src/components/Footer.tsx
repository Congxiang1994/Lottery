import { ShieldAlert } from "lucide-react";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-white/5 bg-ink-900/60">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100/90">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-300" />
          <p className="leading-relaxed">
            <b className="text-amber-200">理性购彩声明：</b>
            彩票开奖完全随机，任何历史统计与「预测」均不具备科学依据，本平台所有推荐仅供娱乐参考。
            请量力而行、理性投注，切勿沉迷。未满 18 周岁禁止购彩。
          </p>
        </div>
        <div className="mt-6 flex flex-col items-center justify-between gap-2 text-xs text-white/35 sm:flex-row">
          <span>Lottery · 彩票数据可视化与智能推荐</span>
          <span>理性购彩 · 量力而行</span>
        </div>
      </div>
    </footer>
  );
}
