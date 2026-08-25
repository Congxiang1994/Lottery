import { ShieldAlert } from "lucide-react";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-paper-100 bg-paper-100/60">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-600/25 bg-amber-50 p-4 text-sm text-amber-800">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="leading-relaxed">
            <b className="text-amber-700">理性购彩声明：</b>
            彩票开奖完全随机，任何历史统计与「预测」均不具备科学依据，本平台所有推荐仅供娱乐参考。
            请量力而行、理性投注，切勿沉迷。未满 18 周岁禁止购彩。
          </p>
        </div>
        <div className="mt-6 flex flex-col items-center justify-between gap-2 text-xs text-paper-600 sm:flex-row">
          <span>Lottery · 数据工具与智能应用聚合站</span>
          <span>理性购彩 · 量力而行</span>
        </div>
      </div>
    </footer>
  );
}
