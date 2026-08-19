interface Cell {
  number: number;
  count: number;
}

interface HeatmapProps {
  items: Cell[];
  kind?: "red" | "blue";
  title?: string;
}

export default function Heatmap({ items, kind = "red", title }: HeatmapProps) {
  const max = Math.max(...items.map((i) => i.count), 1);
  const min = Math.min(...items.map((i) => i.count), 0);
  return (
    <div>
      {title && <div className="mb-3 text-sm font-semibold text-white/70">{title}</div>}
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
        {items.map((it) => {
          const t = max > min ? (it.count - min) / (max - min) : 0.4;
          const bg =
            kind === "red"
              ? `rgba(255,59,92,${0.12 + t * 0.78})`
              : `rgba(59,130,246,${0.12 + t * 0.78})`;
          return (
            <div key={it.number} className="group relative">
              <div
                className="grid aspect-square place-items-center rounded-lg text-sm font-bold text-white"
                style={{ background: bg }}
                title={`${it.number} · 出现 ${it.count} 次`}
              >
                {it.number}
              </div>
              <div className="mt-0.5 text-center text-[10px] text-white/40">{it.count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
