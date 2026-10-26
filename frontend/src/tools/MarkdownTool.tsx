import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFootnotes from "remark-footnotes";
import rehypeHighlight from "rehype-highlight";
import { FileText, Trash2 } from "lucide-react";
import CopyBtn from "./CopyBtn";

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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, src);
  }, [src]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-paper-600">
          <FileText size={13} className="text-[#0d9488]" /> 实时预览（左编辑 · 右渲染）
          <span className="ml-2 tabular-nums">{src.length} 字符</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <CopyBtn text={src} title="复制 Markdown 源码" />
          <button
            onClick={() => setSrc(SAMPLE)}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <FileText size={13} /> 示例
          </button>
          <button
            onClick={() => setSrc("")}
            className="flex items-center gap-1.5 rounded-xl border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs text-paper-700 transition hover:bg-paper-200"
          >
            <Trash2 size={13} /> 清空
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <textarea
          className="h-[520px] w-full resize-y rounded-2xl border border-paper-200 bg-white/60 px-4 py-3 font-mono text-sm leading-relaxed text-paper-900 outline-none focus:border-brand-gold/50"
          value={src}
          spellCheck={false}
          placeholder="在此输入 Markdown…"
          onChange={(e) => setSrc(e.target.value)}
        />
        <div className="glass h-[520px] overflow-auto rounded-2xl p-5 shadow-card">
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
