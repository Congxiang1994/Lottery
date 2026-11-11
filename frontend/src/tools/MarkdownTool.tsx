import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFootnotes from "remark-footnotes";
import rehypeHighlight from "rehype-highlight";
import { FileText, Trash2, Undo2, UnfoldVertical } from "lucide-react";
import CopyBtn from "./CopyBtn";
import { unescapeMarkdown } from "./mdUnescape";

const STORAGE_KEY = "tools_md";

const SAMPLE = `# 一级标题

支持 **加粗**、*斜体*、~~删除线~~ 与 \`行内代码\`。

## 二级标题

### 列表

- 无序项 A
- 无序项 B
  - 嵌套子项

1. 有序一
2. 有序二

### 任务列表

- [x] 已完成任务
- [ ] 未完成任务

### 引用

> 这是一段引用文字，可以跨行。
> 第二行仍在引用内。

### 表格

| 名称 | 说明 | 是否启用 |
| --- | --- | :---: |
| 时间戳 | 双向转换 | ✅ |
| JSON | 格式化与纠错 | ✅ |

### 代码块

\`\`\`js
const a = 1;
function add(x, y) {
  return x + y; // 注释
}
\`\`\`

### 链接与图片

[访问 doudoutech.cloud](https://doudoutech.cloud)

### 脚注

这里有脚注引用[^1]。

[^1]: 脚注的具体内容写在这里。
`;

export default function MarkdownTool() {
  const [src, setSrc] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? SAMPLE);
  /** 还原前的原文（非空时显示「撤销」条，6 秒后自动收起） */
  const [undo, setUndo] = useState<{ text: string; changes: number; stripped: boolean } | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, src);
  }, [src]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  /** 当前内容里可还原的转义个数（0 表示按钮禁用；剥外层引号也算一处） */
  const unescapeResult = useMemo(() => unescapeMarkdown(src), [src]);
  const pending = unescapeResult.changes + (unescapeResult.strippedQuotes ? 1 : 0);

  const restore = () => {
    if (pending === 0) return;
    setUndo({ text: src, changes: unescapeResult.changes, stripped: unescapeResult.strippedQuotes });
    setSrc(unescapeResult.text);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-paper-600">
          <FileText size={13} className="text-[#0d9488]" /> 实时预览（左编辑 · 右渲染）
          <span className="ml-2 tabular-nums">{src.length} 字符</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={restore}
            disabled={pending === 0}
            title='把字面量转义（\\n、\\t、\\" 等）还原成真实字符；整段被一对引号包住时顺手剥掉'
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200 disabled:cursor-default disabled:opacity-40"
          >
            <UnfoldVertical size={13} /> 还原转义
            {pending > 0 && (
              <span className="rounded-full bg-brand-gold/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-brand-gold">
                {pending}
              </span>
            )}
          </button>
          <CopyBtn text={src} title="复制 Markdown 源码" />
          <button
            onClick={() => setSrc(SAMPLE)}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <FileText size={13} /> 示例
          </button>
          <button
            onClick={() => {
              setUndo(null);
              setSrc("");
            }}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <Trash2 size={13} /> 清空
          </button>
        </div>
      </div>

      {undo && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/25 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {undo.changes > 0 ? `已还原 ${undo.changes} 处转义` : "已去掉外层引号"}
          {undo.changes > 0 && undo.stripped && "，并去掉外层引号"}
          <button
            onClick={() => {
              setSrc(undo.text);
              setUndo(null);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-medium transition hover:bg-emerald-100"
          >
            <Undo2 size={12} /> 撤销
          </button>
          <button
            onClick={() => setUndo(null)}
            className="rounded-lg px-2 py-0.5 text-emerald-700/90 transition hover:bg-emerald-100"
          >
            收起
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <textarea
          className="h-[520px] w-full resize-y rounded-2xl border border-paper-200 bg-white/60 px-4 py-3 font-mono text-sm leading-relaxed text-paper-900 outline-none focus:border-brand-gold/50"
          value={src}
          spellCheck={false}
          placeholder="在此输入 Markdown…（从接口/日志里复制出的一整行带 \n 的文本，可点右上角「还原转义」）"
          onChange={(e) => setSrc(e.target.value)}
        />
        <div className="glass h-[520px] overflow-auto rounded-3xl p-5 shadow-card">
          {src.trim() ? (
            <div className="md-preview">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkFootnotes as never]}
                rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
              >
                {src}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-paper-500">预览区为空，输入 Markdown 后立即渲染。</p>
          )}
        </div>
      </div>
    </div>
  );
}
