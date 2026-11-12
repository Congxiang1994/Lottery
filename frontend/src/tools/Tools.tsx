import { useState } from "react";
import { PageHeader } from "../common/PageHeader";
import { Braces, Clock, FileText, Pencil, Wrench, type LucideIcon } from "lucide-react";
import TimestampTool from "./TimestampTool";
import JsonTool from "./JsonTool";
import MarkdownTool from "./MarkdownTool";
import DrawTool from "./DrawTool";

type TabKey = "timestamp" | "json" | "markdown" | "draw";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "timestamp", label: "时间戳", icon: Clock },
  { key: "json", label: "JSON", icon: Braces },
  { key: "markdown", label: "Markdown", icon: FileText },
  { key: "draw", label: "画板", icon: Pencil },
];

export default function Tools() {
  const [tab, setTab] = useState<TabKey>("timestamp");
  return (
    <div className="pt-8">
      <PageHeader
        title="实用小工具"
        icon={Wrench}
        iconClass="text-[#0d9488]"
        subtitle="开发者随身工具箱：时间戳转换、JSON 工作台（格式化 / 树与网格 / 查询 / Diff / 转换 / Schema / 代码生成 / JSONL）、Markdown 预览、随手画板。"
      />

      {/* Tab 切换（沿用全站 segmented 样式） */}
      <div className="mt-5 flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-1 text-sm font-medium w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 transition ${
              tab === t.key ? "bg-white text-paper-900 shadow-sm" : "text-paper-600 hover:text-paper-900"
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "timestamp" && <TimestampTool />}
        {tab === "json" && <JsonTool />}
        {tab === "markdown" && <MarkdownTool />}
        {tab === "draw" && <DrawTool />}
      </div>
    </div>
  );
}
