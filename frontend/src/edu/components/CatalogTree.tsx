import { useState } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, Plus } from "lucide-react";
import type { BookItem } from "../api";

export interface SelItem {
  kind: string;
  id: string;
  resourceType?: string;
  title: string;
}

function selKey(node: BookItem, type: string): string {
  const id = node.BookID || node.ID || "";
  if (id) {
    if (type === "course") return `course:${id}`;
    return `textbook:${id}`;
  }
  return `tag:${node.TagID || node.Name}`;
}

export function toSelItem(node: BookItem, type: string): SelItem {
  if (type === "course")
    return { kind: "course", id: node.BookID, resourceType: "national_lesson", title: node.BookName || node.Name };
  return { kind: "textbook", id: node.BookID, title: node.BookName || node.Name };
}

function TreeNode({
  node,
  depth,
  type,
  selected,
  onToggle,
  onOpenLessons,
}: {
  node: BookItem;
  depth: number;
  type: string;
  selected: Map<string, SelItem>;
  onToggle: (node: BookItem, checked: boolean) => void;
  onOpenLessons: (node: BookItem) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isBook = node.IsBook === true;
  const children = node.Children || [];
  const key = selKey(node, type);
  const checked = selected.has(key);
  const indent = { paddingLeft: `${12 + depth * 16}px` };

  if (isBook) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 cursor-default"
        style={indent}
      >
        <span className="w-4 text-white/30" />
        <FileText className="w-4 h-4 text-brand-red2 shrink-0" />
        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onToggle(node, e.target.checked)}
            className="w-3.5 h-3.5 accent-brand-red shrink-0"
          />
          <span className="text-sm text-white/80 truncate" title={node.BookName || node.Name}>
            {node.BookName || node.Name}
          </span>
        </label>
        {type === "course" && (
          <button
            onClick={() => onOpenLessons(node)}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-brand-red/40 text-brand-red2 hover:bg-brand-red/15 transition"
          >
            <Plus className="w-3 h-3" /> 课时
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 cursor-pointer select-none"
        style={indent}
        onClick={() => setOpen((o) => !o)}
      >
        {children.length > 0 ? (
          open ? (
            <ChevronDown className="w-4 h-4 text-white/40" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/40" />
          )
        ) : (
          <span className="w-4" />
        )}
        <Folder className="w-4 h-4 text-brand-gold shrink-0" />
        <span
          className="text-sm text-white/70 truncate flex-1"
          title={`${node.TagName || node.Name || ""}${
            node.Name && node.Name !== node.TagName ? ` · ${node.Name}` : ""
          }`}
        >
          {node.TagName || node.Name || "-"}
        </span>
        {node.Name && node.Name !== node.TagName && (
          <span className="shrink-0 text-[10px] text-white/40 px-1.5 py-0.5 rounded bg-white/10">
            {node.Name}
          </span>
        )}
      </div>
      {open && children.length > 0 && (
        <div>
          {children.map((c, i) => (
            <TreeNode
              key={i}
              node={c}
              depth={depth + 1}
              type={type}
              selected={selected}
              onToggle={onToggle}
              onOpenLessons={onOpenLessons}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CatalogTree(props: {
  tree: BookItem;
  type: string;
  selected: Map<string, SelItem>;
  onToggle: (node: BookItem, checked: boolean) => void;
  onOpenLessons: (node: BookItem) => void;
}) {
  const root = props.tree;
  return (
    <div className="py-1">
      {root.Children && root.Children.length > 0 ? (
        root.Children.map((c, i) => (
          <TreeNode
            key={i}
            node={c}
            depth={0}
            type={props.type}
            selected={props.selected}
            onToggle={props.onToggle}
            onOpenLessons={props.onOpenLessons}
          />
        ))
      ) : (
        <div className="py-12 text-center text-sm text-white/40">目录为空，请稍后重试</div>
      )}
    </div>
  );
}
