import { useEffect, useRef, useState } from "react";
import {
  Pencil,
  Minus,
  Square,
  Circle,
  Eraser,
  Undo2,
  Trash2,
  Download,
  Maximize,
  Minimize,
  type LucideIcon,
} from "lucide-react";

// 内部分辨率（CSS 自适应缩放，保证清晰且不随窗口缩放丢内容）
const W = 1280;
const H = 720;
const BG = "#ffffff";
const MAX_HISTORY = 60;

type ToolKey = "pen" | "line" | "rect" | "ellipse" | "eraser";

const TOOLS: { key: ToolKey; label: string; icon: LucideIcon }[] = [
  { key: "pen", label: "画笔", icon: Pencil },
  { key: "line", label: "直线", icon: Minus },
  { key: "rect", label: "矩形", icon: Square },
  { key: "ellipse", label: "椭圆", icon: Circle },
  { key: "eraser", label: "橡皮", icon: Eraser },
];

const COLORS = [
  "#111827",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#92400e",
];

export default function DrawTool() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const baseRef = useRef<ImageData | null>(null); // 图形拖拽时的底图快照
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);

  const [tool, setTool] = useState<ToolKey>("pen");
  const [color, setColor] = useState("#111827");
  const [size, setSize] = useState(4);
  const [canUndo, setCanUndo] = useState(false);
  const [isFull, setIsFull] = useState(false);

  // 全屏状态跟随浏览器实际状态（ESC 退出也同步）
  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  const toggleFull = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      const req = el.requestFullscreen || (el as any).webkitRequestFullscreen;
      req.call(el);
    }
  };

  // 把工具/颜色/粗细同步进 ref，绘制时读取最新值
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    sizeRef.current = size;
  }, [tool, color, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    historyRef.current = [ctx.getImageData(0, 0, W, H)];
    setCanUndo(false);
  }, []);

  const pushHistory = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, W, H));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 1);
  };

  const undo = () => {
    const ctx = ctxRef.current;
    if (!ctx || historyRef.current.length <= 1) return;
    historyRef.current.pop();
    ctx.putImageData(historyRef.current[historyRef.current.length - 1], 0, 0);
    setCanUndo(historyRef.current.length > 1);
  };

  const clear = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    historyRef.current = [ctx.getImageData(0, 0, W, H)];
    setCanUndo(false);
  };

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height),
    };
  };

  const applyStroke = (ctx: CanvasRenderingContext2D) => {
    const t = toolRef.current;
    ctx.lineWidth = t === "eraser" ? sizeRef.current * 2.4 : sizeRef.current;
    ctx.strokeStyle = t === "eraser" ? BG : colorRef.current;
    ctx.fillStyle = t === "eraser" ? BG : colorRef.current;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    drawingRef.current = true;
    canvas.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    startRef.current = p;
    lastRef.current = p;
    pushHistory(); // 落笔前记录状态，供撤销
    applyStroke(ctx);
    if (toolRef.current === "pen" || toolRef.current === "eraser") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
    } else {
      baseRef.current = ctx.getImageData(0, 0, W, H); // 图形：先存底图
    }
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxRef.current;
    if (!ctx || !drawingRef.current || !startRef.current) return;
    const p = toCanvas(e);
    const t = toolRef.current;
    if (t === "pen" || t === "eraser") {
      if (lastRef.current) {
        ctx.beginPath();
        ctx.moveTo(lastRef.current.x, lastRef.current.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      lastRef.current = p;
    } else {
      // 图形预览：恢复底图后重绘
      if (baseRef.current) ctx.putImageData(baseRef.current, 0, 0);
      applyStroke(ctx);
      const s = startRef.current;
      if (t === "line") {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (t === "rect") {
        ctx.strokeRect(s.x, s.y, p.x - s.x, p.y - s.y);
      } else if (t === "ellipse") {
        const cx = (s.x + p.x) / 2;
        const cy = (s.y + p.y) / 2;
        const rx = Math.abs(p.x - s.x) / 2;
        const ry = Math.abs(p.y - s.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drawingRef.current = false;
    startRef.current = null;
    lastRef.current = null;
    baseRef.current = null;
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `whiteboard-${Date.now()}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  return (
    <div
      ref={wrapRef}
      className={
        isFull
          ? "flex h-screen flex-col bg-[#0f172a] p-3"
          : "space-y-4"
      }
    >
      {/* 工具栏 */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3 shadow-card">
        {/* 工具 */}
        <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              title={t.label}
              onClick={() => setTool(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                tool === t.key
                  ? "bg-white text-paper-900 shadow-sm"
                  : "text-paper-600 hover:text-paper-900"
              }`}
            >
              <t.icon size={15} /> <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* 颜色 */}
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => {
                setColor(c);
                if (tool === "eraser") setTool("pen");
              }}
              className={`h-6 w-6 rounded-full border transition ${
                color === c && tool !== "eraser"
                  ? "ring-2 ring-[#0d9488] ring-offset-1"
                  : "border-paper-300 hover:scale-110"
              }`}
              style={{ background: c }}
            />
          ))}
          <label
            title="自定义颜色"
            className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-paper-300"
            style={{ background: color }}
          >
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                if (tool === "eraser") setTool("pen");
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>

        {/* 粗细 */}
        <div className="flex items-center gap-2 text-xs text-paper-600">
          <span>粗细</span>
          <input
            type="range"
            min={1}
            max={40}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-28 accent-[#0d9488]"
          />
          <span className="tabular-nums w-6 text-paper-800">{size}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:opacity-40"
          >
            <Undo2 size={14} /> 撤销
          </button>
          <button
            onClick={clear}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <Trash2 size={14} /> 清空
          </button>
          <button
            onClick={download}
            className="flex items-center gap-1.5 rounded-xl border border-[#0d9488]/30 bg-[#0d9488]/10 px-3 py-1.5 text-xs font-medium text-[#0d9488] transition hover:bg-[#0d9488]/20"
          >
            <Download size={14} /> 下载 PNG
          </button>
          <button
            onClick={toggleFull}
            title={isFull ? "退出全屏" : "全屏"}
            className="flex items-center gap-1.5 rounded-xl border border-[#0d9488]/30 bg-[#0d9488]/10 px-3 py-1.5 text-xs font-medium text-[#0d9488] transition hover:bg-[#0d9488]/20"
          >
            {isFull ? <Minimize size={14} /> : <Maximize size={14} />}
            {isFull ? "退出全屏" : "全屏"}
          </button>
        </div>
      </div>

      {/* 画布（全屏时居中放大、保持比例） */}
      <div className={isFull ? "flex flex-1 items-center justify-center overflow-hidden" : ""}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          className={
            isFull
              ? "touch-none rounded-2xl border border-paper-200 bg-white shadow-card max-h-full max-w-full"
              : "w-full touch-none rounded-2xl border border-paper-200 bg-white shadow-card"
          }
          style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
        />
      </div>
      {!isFull && (
        <p className="text-xs text-paper-500">
          鼠标按住拖动即可手绘；选「直线 / 矩形 / 椭圆」后拖拽生成图形；「橡皮」擦成白底。
        </p>
      )}
    </div>
  );
}
