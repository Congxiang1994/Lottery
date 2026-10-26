import { useState } from "react";
import { Braces, Clock, FileText, Wrench, type LucideIcon } from "lucide-react";
import TimestampTool from "./TimestampTool";
import JsonTool from "./JsonTool";
import MarkdownTool from "./MarkdownTool";

type TabKey = "timestamp" | "json" | "markdown";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "timestamp", label: "时间戳", icon: Clock },
  { key: "json", label: "JSON", icon: Braces },
  { key: "markdown", label: "Markdown", icon: FileText },
];

export default function Tools() {
  const [tab, setTab] = useState<TabKey>("timestamp");
  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <Wrench size={26} className="text-[#0d9488]" /> 实用小工具
          </h1>
          <p className="mt-1 text-sm text-paper-700">
            开发者随身工具箱：时间戳双向转换、JSON 格式化与纠错、Markdown 实时预览。
          </p>
        </div>
      </div>

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
      </div>
    </div>
  );
}
