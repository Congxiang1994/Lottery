import { useEffect, useRef } from "react";
import { Draw } from "../types";

/**
 * 500 彩票网风格开奖走势图（Canvas 绘制）
 *
 * - 左列：期号
 * - 中部：红球 1..redMax 列（浅红底），右侧蓝球 1..blueMax 列（浅蓝底）
 * - 每期一行：开出号码以彩色球绘制在对应列
 * - 连线：相邻期同号直落（竖线）、相邻期 ±1 号斜连（斜线）
 * - 底部：遗漏行（每个号码当前遗漏期数）
 */
interface Props {
  draws: Draw[];            // 旧 → 新（上 → 下）
  redMax: number;
  blueMax: number;
  redOmit: number[];        // 每号当前遗漏（1-based index）
  blueOmit: number[];
  title?: string;
}

const ISSUE_W = 64;
const COL_W = 30;
const ROW_H = 26;
const OMIT_H = 30;
const HEAD_H = 24;

export default function TrendMatrix({ draws, redMax, blueMax, redOmit, blueOmit, title }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || draws.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const cols = redMax + blueMax;
    const width = ISSUE_W + cols * COL_W;
    const height = HEAD_H + draws.length * ROW_H + OMIT_H;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const RED = "#ff3b5c";
    const BLUE = "#3b82f6";
    const GOLD = "#f5c451";
    const CELL_BG = "rgba(255,255,255,0.03)";
    const RED_BG = "rgba(255,59,92,0.05)";
    const BLUE_BG = "rgba(59,130,246,0.06)";

    // ---------- 表头 ----------
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("期号", ISSUE_W / 2, HEAD_H / 2);
    for (let n = 1; n <= redMax; n++) {
      const x = ISSUE_W + (n - 1) * COL_W + COL_W / 2;
      ctx.fillStyle = RED;
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText(String(n), x, HEAD_H / 2);
    }
    for (let n = 1; n <= blueMax; n++) {
      const x = ISSUE_W + (redMax + n - 1) * COL_W + COL_W / 2;
      ctx.fillStyle = BLUE;
      ctx.fillText(String(n), x, HEAD_H / 2);
    }

    const colX = (colIdx: number) => ISSUE_W + colIdx * COL_W + COL_W / 2;
    const rowY = (rowIdx: number) => HEAD_H + rowIdx * ROW_H + ROW_H / 2;

    // ---------- 列背景 ----------
    ctx.fillStyle = RED_BG;
    ctx.fillRect(ISSUE_W, HEAD_H, redMax * COL_W, draws.length * ROW_H);
    ctx.fillStyle = BLUE_BG;
    ctx.fillRect(ISSUE_W + redMax * COL_W, HEAD_H, blueMax * COL_W, draws.length * ROW_H);
    // 行分隔线
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= draws.length; i++) {
      const y = HEAD_H + i * ROW_H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // ---------- 连线（直落竖线 + 斜连） ----------
    const posMap = (d: Draw) => {
      const m = new Map<number, number>();
      d.red.forEach((n) => m.set(n - 1, 0));          // 红球列索引
      d.blue.forEach((n) => m.set(redMax + n - 1, 1)); // 蓝球列索引
      return m;
    };
    ctx.lineWidth = 1.6;
    for (let i = 1; i < draws.length; i++) {
      const cur = posMap(draws[i]);
      const prev = posMap(draws[i - 1]);
      const y0 = rowY(i - 1);
      const y1 = rowY(i);
      for (const [colIdx] of cur) {
        // 直落：同列（同一号码连续开出）
        if (prev.has(colIdx)) {
          ctx.strokeStyle = colIdx < redMax ? "rgba(255,59,92,0.4)" : "rgba(59,130,246,0.4)";
          ctx.beginPath();
          ctx.moveTo(colX(colIdx), y0 + 8);
          ctx.lineTo(colX(colIdx), y1 - 8);
          ctx.stroke();
        }
        // 斜连：±1 列（号码相邻，斜向走势）
        if (prev.has(colIdx - 1) && colIdx >= 1 && colIdx <= redMax) {
          ctx.strokeStyle = "rgba(245,196,81,0.4)";
          ctx.beginPath();
          ctx.moveTo(colX(colIdx - 1), y0 + 8);
          ctx.lineTo(colX(colIdx), y1 - 8);
          ctx.stroke();
        }
        if (prev.has(colIdx + 1) && colIdx < redMax) {
          ctx.strokeStyle = "rgba(245,196,81,0.4)";
          ctx.beginPath();
          ctx.moveTo(colX(colIdx + 1), y0 + 8);
          ctx.lineTo(colX(colIdx), y1 - 8);
          ctx.stroke();
        }
      }
    }

    // ---------- 号码球 + 期号 ----------
    ctx.font = "bold 10px Inter, sans-serif";
    for (let i = 0; i < draws.length; i++) {
      const d = draws[i];
      const y = rowY(i);
      // 期号
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px Inter, monospace";
      ctx.fillText(d.issue, ISSUE_W - 8, y);
      ctx.textAlign = "center";
      ctx.font = "bold 10px Inter, sans-serif";
      const drawBall = (colIdx: number, text: string, isBlue: boolean) => {
        const x = colX(colIdx);
        const r = 10.5;
        const g = ctx.createRadialGradient(x - 3, y - 3, 1.5, x, y, r);
        if (isBlue) { g.addColorStop(0, "#60a5fa"); g.addColorStop(1, BLUE); }
        else { g.addColorStop(0, "#ff6b85"); g.addColorStop(1, RED); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(text, x, y + 0.5);
      };
      d.red.forEach((n) => drawBall(n - 1, String(n), false));
      d.blue.forEach((n) => drawBall(redMax + n - 1, String(n), true));
    }

    // ---------- 遗漏行 ----------
    ctx.fillStyle = CELL_BG;
    ctx.fillRect(0, HEAD_H + draws.length * ROW_H, width, OMIT_H);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, HEAD_H + draws.length * ROW_H);
    ctx.lineTo(width, HEAD_H + draws.length * ROW_H);
    ctx.stroke();
    const omitY = HEAD_H + draws.length * ROW_H + OMIT_H / 2;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "10px Inter, sans-serif";
    ctx.fillText("遗漏", ISSUE_W - 8, omitY);
    ctx.textAlign = "center";
    for (let n = 1; n <= redMax; n++) {
      const v = redOmit[n - 1] ?? 0;
      ctx.fillStyle = v === 0 ? "rgba(255,59,92,0.85)" : "rgba(255,255,255,0.4)";
      ctx.fillText(v === 0 ? "0" : String(v), colX(n - 1), omitY);
    }
    for (let n = 1; n <= blueMax; n++) {
      const v = blueOmit[n - 1] ?? 0;
      ctx.fillStyle = v === 0 ? "rgba(59,130,246,0.85)" : "rgba(255,255,255,0.4)";
      ctx.fillText(v === 0 ? "0" : String(v), colX(redMax + n - 1), omitY);
    }
  }, [draws, redMax, blueMax, redOmit, blueOmit]);

  return (
    <div className="w-full overflow-x-auto">
      {title && (
        <div className="mb-2 flex items-center gap-3 text-[11px] text-white/45">
          {title}
          <span className="flex items-center gap-1"><span className="h-[2px] w-5 bg-brand-red/60" /> 直落（同号连开）</span>
          <span className="flex items-center gap-1"><span className="h-[2px] w-5 bg-brand-gold/60" /> 斜连（±1 邻号）</span>
          <span className="text-white/30">· 底部为当前遗漏期数</span>
        </div>
      )}
      <canvas ref={ref} className="block rounded-xl border border-white/5" />
    </div>
  );
}
