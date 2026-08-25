import { LotteryInfo } from "../types";

interface TabsProps {
  lotteries: LotteryInfo[];
  value: string;
  onChange: (key: string) => void;
}

export default function LotteryTabs({ lotteries, value, onChange }: TabsProps) {
  return (
    <div className="inline-flex rounded-xl border border-paper-200 bg-paper-200 p-1">
      {lotteries.map((l) => {
        const active = l.key === value;
        const isRed = l.key === "ssq";
        return (
          <button
            key={l.key}
            onClick={() => onChange(l.key)}
            className={`relative rounded-lg px-4 py-2 text-sm font-semibold transition ${
              active
                ? isRed
                  ? "bg-gradient-to-br from-brand-red to-brand-red2 text-white shadow-glow"
                  : "bg-gradient-to-br from-brand-blue to-brand-blue2 text-white shadow-glowblue"
                : "text-paper-700 hover:text-paper-900"
            }`}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}
