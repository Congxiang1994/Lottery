/**
 * 左栏：按「行模型」渲染的 JSON 源码，与右栏节点树**行行对齐**。
 *
 * 为什么不再用 CodeMirror：
 *  用户要求「节点树展开/折叠时源码对应行同步展开/合并成 ...」，以及
 *  「悬停节点时整块黄底」。这两件事都要求源码是**可控的行序列**，
 *  而 CodeMirror 是自由文本编辑器，折叠与高亮只能靠 hack，且两边行数必然
 *  各自计算、容易错位。改成「同一份行模型 → 两边各渲染自己的样子」后，
 *  对齐是结构性的，不靠猜。
 *
 * 代价与取舍：不再支持任意自由编辑（打字、粘贴）。
 *  - 贴入/清空/示例 走工具栏按钮 → 重新解析 → 重新生成行；
 *  - 值要改的话，仍需回到「可编辑模式」（见 Toolbar 的编辑开关，后续可加）。
 *  当前实现保留一个隐藏 textarea 承接粘贴，避免完全丢失输入能力。
 */
import { useEffect, useMemo, useRef } from "react";
import type { SourceLine } from "./sourceLines.ts";

const TOKEN_COLOR: Record<string, string> = {
  string: "var(--cm-str, #b45309)",
  number: "var(--cm-num, #7c3aed)",
  boolean: "var(--cm-num, #7c3aed)",
  null: "var(--cm-null, #9c8769)",
};

export interface SourceViewProps {
  lines: SourceLine[];
  /** 当前悬停高亮的行区间（闭区间） */
  highlight: [number, number] | null;
  /** 点折叠行的 ... 时展开该节点 */
  onExpand?: (path: string) => void;
  /** 承接粘贴的原始文本变更（可选） */
  onReplace?: (text: string) => void;
}

export default function SourceView({ lines, highlight, onExpand, onReplace }: SourceViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  // 有高亮时确保高亮块可见（把区间首行滚进视野，但只在明显出界时才滚，
  // 免得用户正在看别处时被强行拉走）
  useEffect(() => {
    if (!highlight || !scroller.current) return;
    const el = scroller.current;
    const rowH = 22;
    const top = highlight[0] * rowH;
    const bottom = highlight[1] * rowH + rowH;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }, [highlight]);

  const hlSet = useMemo(() => {
    const s = new Set<number>();
    if (highlight) for (let i = highlight[0]; i <= highlight[1]; i += 1) s.add(i);
    return s;
  }, [highlight]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onReplace) return;
    const t = e.clipboardData.getData("text");
    if (t) {
      e.preventDefault();
      onReplace(t);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white/60">
      {/* 头部：与右栏同高同版式 */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-paper-200/70 px-3 text-xs text-paper-600">
        <span className="text-[#0d9488]">{"{}"}</span> JSON 源码
        <span className="ml-auto tabular-nums">{lines.length} 行</span>
      </div>

      {/* 行列表：行高固定 22px，与右栏 ROW_H 一致 → 严格对齐 */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto py-1">
        {lines.length === 0 ? (
          <p className="p-3 text-xs text-paper-500">粘贴或输入 JSON 后显示源码。</p>
        ) : (
          lines.map((l) => (
            <Line key={`${l.index}-${l.path}-${l.kind}`} line={l} highlighted={hlSet.has(l.index)} onExpand={onExpand} />
          ))
        )}
      </div>

      {/* 隐藏 textarea：承接 ⌘V 粘贴（行渲染是只读的，靠它拿到原文） */}
      {onReplace && (
        <textarea
          ref={ta}
          onPaste={handlePaste}
          onChange={() => { /* 只用于粘贴，输入不生效 */ }}
          className="h-0 w-0 resize-none border-0 p-0 opacity-0"
          aria-hidden
          tabIndex={-1}
        />
      )}

      {/* 底部状态行：与右栏同高 */}
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-paper-200/70 px-3 text-[11px] text-paper-500">
        展开 / 折叠与右侧节点树同步
      </div>
    </div>
  );
}

/** 单行：等宽字体 + 缩进 + 语法着色（key / 标量分开上色） */
function Line({
  line, highlighted, onExpand,
}: {
  line: SourceLine;
  highlighted: boolean;
  onExpand?: (path: string) => void;
}) {
  const { text, keyText, valueKind, foldPath } = line;

  // 把「缩进 + 可能存在的 "key": 」与「值部分」拆开，各部分单独着色
  const prefixLen = text.length - text.replace(/^\s*/, "").length;
  const indent = text.slice(0, prefixLen);
  let rest = text.slice(prefixLen);

  let keyPart = "";
  if (keyText !== null) {
    const km = rest.match(/^("(?:[^"\\]|\\.)*":\s*)/);
    if (km) {
      keyPart = km[1];
      rest = rest.slice(km[0].length);
    }
  }

  return (
    <div
      className={`flex h-[22px] items-center whitespace-pre font-mono text-[12.5px] leading-[22px] transition-colors duration-100 ${
        highlighted ? "bg-amber-300/35" : ""
      }`}
    >
      <span className="w-9 shrink-0 select-none pr-2 text-right text-[10px] tabular-nums text-paper-300">{line.index + 1}</span>
      <span className="text-paper-400">{indent}</span>
      {keyPart && <span style={{ color: "var(--cm-key, #0d9488)" }}>{keyPart}</span>}
      {foldPath ? (
        <button
          onClick={() => onExpand?.(foldPath)}
          title="点击展开"
          className="cursor-pointer text-paper-500 underline decoration-dotted underline-offset-2 hover:text-[#0d9488]"
        >
          {rest}
        </button>
      ) : (
        <span style={{ color: line.kind === "scalar" || line.kind === "inline" ? TOKEN_COLOR[valueKind] : "var(--cm-punc, #8b7355)" }}>
          {rest}
        </span>
      )}
    </div>
  );
}
