import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ChevronDown, Folder, File as FileIcon, Download, Archive, Trash2, Loader2 } from "lucide-react";
import { Api, type FileEntry, fmtSize } from "./api";

function Node({
  f,
  depth,
  sel,
  setSel,
  refresh,
}: {
  f: FileEntry;
  depth: number;
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const indent = { paddingLeft: `${10 + depth * 18}px` };

  if (f.is_dir) {
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
          style={indent}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <ChevronDown size={16} className="text-white/40" />
          ) : (
            <ChevronRight size={16} className="text-white/40" />
          )}
          <Folder size={16} className="shrink-0 text-brand-gold" />
          <span className="text-sm text-white/80">{f.name}</span>
        </div>
        {open &&
          (f.children || []).map((c, i) => (
            <Node key={i} f={c} depth={depth + 1} sel={sel} setSel={setSel} refresh={refresh} />
          ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5" style={indent}>
      <span className="w-4" />
      <FileIcon size={16} className="shrink-0 text-brand-red2" />
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={sel.has(f.path)}
          onChange={(e) => {
            const n = new Set(sel);
            e.target.checked ? n.add(f.path) : n.delete(f.path);
            setSel(n);
          }}
          className="w-3.5 h-3.5 shrink-0 accent-brand-red"
        />
        <span className="truncate text-sm text-white/80" title={f.name}>
          {f.name}
        </span>
      </label>
      <span className="shrink-0 text-xs text-white/40">{fmtSize(f.size)}</span>
      <a href={Api.fileDownloadUrl(f.path)} download className="shrink-0 text-brand-red2 hover:text-white" title="下载">
        <Download size={14} />
      </a>
      <button
        onClick={async () => {
          if (confirm(`确定删除 ${f.name} ？`)) {
            await Api.deleteFile(f.path);
            refresh();
          }
        }}
        className="shrink-0 text-white/30 hover:text-red-400"
        title="删除"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function Files() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await Api.files(""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const zip = async () => {
    if (!sel.size) return;
    setZipping(true);
    try {
      const resp = await fetch("/api/edu/files/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: Array.from(sel) }),
      });
      if (!resp.ok) {
        alert("打包失败");
        return;
      }
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "smartedu-download.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">已下载文件</h2>
          <p className="mt-0.5 text-sm text-white/45">勾选文件可打包 ZIP 下载</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-white/55">
            已选 <b className="text-brand-red2">{sel.size}</b> 项
          </span>
          <button
            onClick={zip}
            disabled={zipping || sel.size === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red2 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:opacity-90 disabled:opacity-50"
          >
            {zipping ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />} 打包下载 ZIP
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-2 text-sm font-medium text-white/70 transition hover:border-white/25 hover:text-white"
          >
            刷新
          </button>
        </div>
      </div>

      <div className="glass rounded-2xl p-3">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-white/40">
            <Loader2 size={20} className="animate-spin mr-2" /> 加载中…
          </div>
        ) : files.length === 0 ? (
          <div className="py-12 text-center text-sm text-white/40">尚无已下载文件</div>
        ) : (
          files.map((f, i) => <Node key={i} f={f} depth={0} sel={sel} setSel={setSel} refresh={refresh} />)
        )}
      </div>
    </div>
  );
}
