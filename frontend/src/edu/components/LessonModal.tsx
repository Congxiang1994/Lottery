import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { CourseToc } from "../api";
import type { SelItem } from "./CatalogTree";

export default function LessonModal({
  open,
  bookTitle,
  bookID,
  tocs,
  loading,
  selected,
  onToggle,
  onClose,
}: {
  open: boolean;
  bookTitle: string;
  bookID: string;
  tocs: CourseToc[];
  loading: boolean;
  selected: Map<string, SelItem>;
  onToggle: (item: { courseID: string; rt: string; title: string }, checked: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] flex flex-col glass rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="font-semibold text-white truncate">选择课时 · {bookTitle}</div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载课时…
            </div>
          ) : tocs.length === 0 ? (
            <div className="py-12 text-center text-sm text-white/40">未找到课时</div>
          ) : (
            <div className="space-y-4">
              {tocs.map((u) => (
                <div key={u.Index}>
                  <div className="text-sm font-semibold text-brand-red2 mb-1.5">{u.Title}</div>
                  <div className="space-y-0.5">
                    {(u.Children || []).map((it, i) => {
                      const key = `lesson:${it.CourseID}`;
                      const checked = selected.has(key);
                      return (
                        <label
                          key={i}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              onToggle({ courseID: it.CourseID, rt: it.ResourceType, title: it.Title }, e.target.checked)
                            }
                            className="w-3.5 h-3.5 accent-brand-red"
                          />
                          <span className="text-sm text-white/80">{it.Title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
