import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Sparkles, Download, Link2, Trash2, Loader2 } from "lucide-react";
import { Api, type BookItem, type LinkData, type CourseToc } from "./api";
import CatalogTree, { toSelItem, type SelItem } from "./components/CatalogTree";
import LessonModal from "./components/LessonModal";

const FORMATS = [
  { suffix: "pdf", name: "文档(PDF)", def: true },
  { suffix: "mp3", name: "音频(MP3)", def: false },
  { suffix: "jpg", name: "图片", def: false },
  { suffix: "srt", name: "字幕", def: false },
];

const TYPES = {
  course: { api: "course", label: "课程教学", icon: "🎬" },
  textbook: { api: "textbook", label: "电子教材", icon: "📖" },
};

export default function Browse() {
  const navigate = useNavigate();
  const [type, setType] = useState<"course" | "textbook">("course");
  const [tree, setTree] = useState<BookItem | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelItem>>(new Map());
  const [formats, setFormats] = useState<Set<string>>(new Set(["pdf"]));
  const [useVideo, setUseVideo] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<LinkData[]>([]);
  const [parsedSel, setParsedSel] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [emptyMsg, setEmptyMsg] = useState("");

  // 课时弹窗
  const [modal, setModal] = useState<{ book: BookItem } | null>(null);
  const [tocs, setTocs] = useState<CourseToc[]>([]);
  const [tocsLoading, setTocsLoading] = useState(false);

  const loadTree = useCallback(async (t: string) => {
    setTreeLoading(true);
    try {
      setTree(await Api.catalog(TYPES[t as keyof typeof TYPES].api));
    } catch {
      setTree(null);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTree(type);
  }, [type, loadTree]);

  // 课时加载
  useEffect(() => {
    if (!modal) return;
    const bookID = modal.book.BookID;
    setTocs([]);
    setTocsLoading(true);
    Api.course(bookID)
      .then(setTocs)
      .catch(() => setTocs([]))
      .finally(() => setTocsLoading(false));
  }, [modal]);

  const toggleSelect = useCallback(
    (node: BookItem, checked: boolean) => {
      setSelected((prev) => {
        const next = new Map(prev);
        const key = node.BookID
          ? type === "course"
            ? `course:${node.BookID}`
            : `textbook:${node.BookID}`
          : node.Name;
        if (checked) next.set(key, toSelItem(node, type));
        else next.delete(key);
        return next;
      });
    },
    [type],
  );

  const toggleLesson = useCallback((it: { courseID: string; rt: string; title: string }, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = `lesson:${it.courseID}`;
      if (checked) next.set(key, { kind: "course", id: it.courseID, resourceType: it.rt, title: it.title });
      else next.delete(key);
      return next;
    });
  }, []);

  const parse = async () => {
    if (selected.size === 0) {
      alert("请先在左侧勾选教材或课时，再点击「解析资源」");
      return;
    }
    setParsing(true);
    const items = Array.from(selected.values()).map((v) => ({ kind: v.kind, id: v.id, resourceType: v.resourceType || "" }));
    const payload = useVideo
      ? { items, video: true }
      : { items, formats: Array.from(formats).length ? Array.from(formats) : ["pdf"] };
    try {
      const links = await Api.parse(payload);
      setParsed(links || []);
      setParsedSel(new Set((links || []).map((_, i) => i)));
      if (!links || links.length === 0) {
        setEmptyMsg(
          "未解析到资源。可尝试：① 勾选「仅下载视频(m3u8)」；② 点教材的「课时」选择具体课时；③ 部分受限资源需先在「设置」配置登录信息。",
        );
      } else {
        setEmptyMsg("");
      }
    } catch (e) {
      alert("解析失败：" + (e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const directDownload = async (links: LinkData[]) => {
    const nonVideo = links.filter((l) => l.Format !== "m3u8");
    if (!nonVideo.length) {
      alert("没有可直连的文件（视频需走服务器）");
      return;
    }
    try {
      const items = await Api.direct({ links: nonVideo });
      items.forEach((it, idx) =>
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = it.url;
          a.download = it.title;
          a.target = "_blank";
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, idx * 500),
      );
    } catch (e) {
      alert("获取直连链接失败：" + (e as Error).message);
    }
  };

  const serverDownload = async () => {
    const links = parsed.filter((_, i) => parsedSel.has(i));
    if (!links.length) return;
    setSubmitting(true);
    try {
      await Api.createTask({ links, name: "下载资源" });
      navigate("/edu/tasks");
    } catch (e) {
      alert("提交失败：" + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const clearSel = () => setSelected(new Map());

  const parsedNonVideo = useMemo(() => parsed.filter((l) => l.Format !== "m3u8"), [parsed]);

  return (
    <div className="animate-rise">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">资源浏览</h2>
          <p className="mt-0.5 text-sm text-white/45">勾选教材或课时，右侧点击「解析资源」生成可下载清单</p>
        </div>
        <div className="flex gap-2">
          {Object.entries(TYPES).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setType(k as "course" | "textbook")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                type === k
                  ? "bg-gradient-to-br from-brand-red to-brand-red2 text-white shadow-glow"
                  : "border border-white/12 text-white/60 hover:text-white"
              }`}
            >
              {v.icon} {v.label}
            </button>
          ))}
          <button
            onClick={() => loadTree(type)}
            className="ml-1 inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2 text-sm font-medium text-white/70 transition hover:border-white/25 hover:text-white"
            title="刷新"
          >
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
        {/* 左：目录树 */}
        <div className="glass rounded-2xl p-3 h-[70vh] overflow-y-auto">
          {treeLoading ? (
            <div className="flex items-center justify-center py-14 text-white/40">
              <Loader2 size={20} className="animate-spin mr-2" /> 正在加载{TYPES[type].label}目录…
            </div>
          ) : tree ? (
            <CatalogTree
              tree={tree}
              type={type}
              selected={selected}
              onToggle={toggleSelect}
              onOpenLessons={(node) => setModal({ book: node })}
            />
          ) : (
            <div className="py-12 text-center text-sm text-white/40">目录为空，请稍后重试</div>
          )}
        </div>

        {/* 右：操作区 */}
        <div className="h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* 已选 */}
          <div className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold text-white">
                📦 已选资源 <span className="font-bold text-brand-red2">{selected.size}</span>
              </div>
              <button
                onClick={clearSel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:border-white/25 hover:text-white"
              >
                <Trash2 size={13} /> 清空
              </button>
            </div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {selected.size === 0 && <div className="py-1 text-xs text-white/40">尚未选择任何资源</div>}
              {Array.from(selected.values()).map((v, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] text-white/55"
                >
                  {v.kind === "course" ? "🎬" : "📖"} {v.title}
                </span>
              ))}
            </div>
          </div>

          {/* 资源类型 */}
          <div className="glass rounded-2xl p-4">
            <div className="mb-2 font-semibold text-white">🔖 资源类型</div>
            <div className="flex flex-wrap gap-3">
              {FORMATS.map((f) => (
                <label key={f.suffix} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={formats.has(f.suffix)}
                    onChange={(e) => {
                      setFormats((prev) => {
                        const n = new Set(prev);
                        e.target.checked ? n.add(f.suffix) : n.delete(f.suffix);
                        return n;
                      });
                    }}
                    className="accent-brand-red"
                  />{" "}
                  {f.name}
                </label>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={useVideo}
                  onChange={(e) => setUseVideo(e.target.checked)}
                  className="accent-brand-red"
                />{" "}
                🎬 仅下载视频(m3u8)
              </label>
            </div>
          </div>

          <button
            onClick={parse}
            disabled={parsing || selected.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-4 py-3 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-50"
          >
            {parsing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} 解析资源
          </button>

          {/* 解析结果 */}
          {(parsed.length > 0 || emptyMsg) && (
            <div className="glass animate-rise rounded-2xl p-4">
              {emptyMsg ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-300">
                  {emptyMsg}
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold text-white">
                      解析结果 <span className="font-bold text-brand-red2">{parsed.length}</span>
                    </div>
                    {parsedNonVideo.length > 0 && (
                      <button
                        onClick={() => directDownload(parsed.filter((_, i) => parsedSel.has(i)))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:border-white/25 hover:text-white"
                      >
                        <Link2 size={13} /> 直连下载非视频
                      </button>
                    )}
                  </div>
                  <div className="mb-2 text-xs text-white/40">普通文件可「直连」浏览器下载(不占服务器)；视频需服务器合并</div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {parsed.map((l, i) => {
                      const isVideo = l.Format === "m3u8";
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${parsedSel.has(i) ? "bg-white/5" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={parsedSel.has(i)}
                            onChange={(e) => {
                              setParsedSel((prev) => {
                                const n = new Set(prev);
                                e.target.checked ? n.add(i) : n.delete(i);
                                return n;
                              });
                            }}
                            className="w-3.5 h-3.5 shrink-0 accent-brand-red"
                          />
                          <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                            {l.Format.toUpperCase()}
                          </span>
                          <span className="flex-1 truncate text-sm text-white/80" title={l.Title}>
                            {l.Title}
                          </span>
                          <span className="shrink-0 text-xs text-white/40">{fmt(l.Size)}</span>
                          {!isVideo ? (
                            <button
                              onClick={() => directDownload([l])}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/12 px-3 py-1.5 text-xs font-medium text-white/60 transition hover:border-white/25 hover:text-white"
                              title="浏览器直连 CDN，不占服务器流量"
                            >
                              <Link2 size={13} /> 直连
                            </button>
                          ) : (
                            <span className="shrink-0 text-[11px] text-white/30">服务器</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={serverDownload}
                    disabled={submitting || parsedSel.size === 0}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-gold to-brand-red2 px-4 py-3 text-sm font-semibold text-ink-900 transition hover:opacity-90 disabled:opacity-50"
                  >
                    <Download size={16} /> 服务器批量下载（含视频/打包）
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <LessonModal
        open={!!modal}
        bookTitle={modal?.book.BookName || ""}
        bookID={modal?.book.BookID || ""}
        tocs={tocs}
        loading={tocsLoading}
        selected={selected}
        onToggle={toggleLesson}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

function fmt(n: number) {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
