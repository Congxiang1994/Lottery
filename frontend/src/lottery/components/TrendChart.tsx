import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from "recharts";
import { Draw } from "../types";

interface Props {
  draws: Draw[];
  redMax: number;
  blueMax: number;
}

export default function TrendChart({ draws, redMax, blueMax }: Props) {
  const redPts: { x: number; y: number }[] = [];
  const bluePts: { x: number; y: number }[] = [];
  draws.forEach((d, i) => {
    d.red.forEach((n) => redPts.push({ x: i, y: n }));
    d.blue.forEach((n) => bluePts.push({ x: i, y: n }));
  });

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-xs text-white/80 shadow-card">
        <div>第 {draws[p.x]?.issue} 期</div>
        <div>
          {payload[0].name === "红球" ? "红" : "蓝"}球号码：<b>{p.y}</b>
        </div>
      </div>
    );
  };

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: -10 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, Math.max(draws.length - 1, 1)]}
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
            tickFormatter={(v) => draws[v]?.issue ?? ""}
            interval={Math.floor(draws.length / 6)}
            reversed
          />
          <YAxis
            type="number"
            domain={[1, Math.max(redMax, blueMax)]}
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
            width={32}
          />
          <ZAxis range={[54, 54]} />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter name="红球" dataKey="y" data={redPts} fill="#ff3b5c" fillOpacity={0.85} />
          <Scatter name="蓝球" dataKey="y" data={bluePts} fill="#3b82f6" fillOpacity={0.9} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
