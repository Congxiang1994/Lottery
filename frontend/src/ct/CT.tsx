import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileScan,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  Link2,
} from "lucide-react";

import { AdminGate } from "../common/AdminGate";
import { PageHeader, PrivateBadge } from "../common/PageHeader";
import { Empty, ErrorBlock, Loading } from "../common/State";
import { ExitPresence } from "../common/Modal";
import { useModalHistory } from "../common/useModalHistory";
import { ctApi, type CtExam } from "./api";
import { Lightbox, type LightboxImage } from "./Lightbox";
import { shortDate } from "./logic";

/**
 * CT 检查记录分享页 /ct（只读）
 *
 * 2026-11-13 重构：报告从「整段 HTML 原样嵌入」改为**结构化字段渲染**。
 * 每次检查一张卡片，字段分行展示（检查时间 / 检查项目 / 影像链接 / 备注），
 * 照片单独成块 —— 比纯文本清晰，也便于后面增删改查。
 *
 * 数据来自 ``GET /api/ct/exams``（ct_exam + ct_photo 两张表），照片是
 * 服务器 ``/data/lottery/ct_photos/`` 下的独立文件，不再内嵌 base64。
 *
 * 导航：sticky「第 X / N 次」+ 进度点 + 上/下一次 + 选择列表，默认连续浏览。
 * 灯箱接 useModalHistory：返回键只关预览不离开页面。
 */

export default function CT() {
  return (
    <AdminGate
      title="CT 检查结果"
      subtitle="私有功能 · 分享口令"
      desc="输入分享口令即可查看检查记录，并可把链接发给医生。"
      probe={() => ctApi.session()}
      login={(pwd) => ctApi.auth(pwd)}
      logout={() => ctApi.logout()}
      accent="sky"
    >
      {({ onUnauthorized }) => <CTPanel onUnauthorized={onUnauthorized} />}
    </AdminGate>
  );
}

function CTPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [exams, setExams] = useState<CtExam[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeExam, setActiveExam] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  /** 点「上/下一次」触发的 smooth scroll 期间，锁住滚动自动感知，
      否则监听会在滚动刚开始时把 activeExam 覆盖回旧值（点下一次没反应）。 */
  const programmaticScroll = useRef(false);
  const unlockRef = useRef<(() => void) | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    ctApi
      .exams()
      .then((items) => {
        setExams(items);
        setActiveExam((cur) => Math.min(cur, Math.max(0, items.length - 1)));
      })
      .catch((e) => {
        if ((e as { status?: number })?.status === 401) {
          onUnauthorized();
          return;
        }
        setErr((e as Error)?.message || "加载失败");
      })
      .finally(() => setLoading(false));
  }, [onUnauthorized]);

  useEffect(load, [load]);

  const hasExams = exams.length > 0;

  /* ---------------- 返回键：灯箱压历史栈，侧滑只关灯箱 ---------------- */

  /** 正在预览的照片（null = 关闭）。单张预览，不做左右切换。 */
  const [preview, setPreview] = useState<LightboxImage | null>(null);

  const closeLightbox = useCallback(() => setPreview(null), []);
  const lightHistory = useModalHistory("ctLightbox", closeLightbox);

  const closeImage = useCallback(() => {
    setPreview(null);
    lightHistory.pop();
  }, [lightHistory]);

  /** 点某次检查里的第 k 张照片 → 开单张预览 */
  const openPhoto = useCallback(
    (examIndex: number, photoIndex: number) => {
      const e = exams[examIndex];
      const p = e?.photos[photoIndex];
      if (!p) return;
      setPreview({
        url: p.url,
        caption: p.caption || `第 ${examIndex + 1} 次检查 · ${shortDate(e.exam_time)}`,
      });
      lightHistory.push();
    },
    [exams, lightHistory],
  );

  /* ---------------- 滚动感知当前是第几次 ---------------- */

  useEffect(() => {
    if (!hasExams) return;
    let raf = 0;
    let unlockTimer = 0;
    const measure = () => {
      raf = 0;
      // 程序化滚动（点上/下一次）未结束时，不让自动感知抢着改 activeExam
      if (programmaticScroll.current) return;
      const threshold = (navRef.current?.getBoundingClientRect().bottom ?? 120) + 24;
      const tops = cardRefs.current
        .slice(0, exams.length)
        .map((el) => (el ? el.getBoundingClientRect().top : Infinity));
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
      let active = 0;
      tops.forEach((t, i) => {
        if (t <= threshold) active = i;
      });
      // 兜底只在「页面确实滚到底」时生效：最后一次检查若很短，永远到不了判定线以上。
      // ⚠️ 不能无条件用 atBottom —— 报告整体较短时几乎任何位置都满足，
      //    会把用户刚点选的「第 2 次」强行改成最后一次。
      if (atBottom && tops.length > 1 && tops[tops.length - 1] < window.innerHeight) {
        active = exams.length - 1;
      }
      setActiveExam((cur) => (cur === active ? cur : active));
    };
    const onScroll = () => {
      if (programmaticScroll.current) return;
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    const unlock = () => {
      // 只解锁，不重算：用户刚点的那次检查就是他要的，
      // 此时 smooth scroll 可能还没完全停稳，重算容易把 activeExam 改回旧值。
      // 之后用户再手动滚动，onScroll 会正常接管。
      programmaticScroll.current = false;
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    unlockRef.current = () => {
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(unlock, 900);
    };
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.clearTimeout(unlockTimer);
      unlockRef.current = null;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [hasExams, exams.length]);

  /** 点选某次检查：按导航条实际底边算偏移，保证卡片顶边不被遮挡 */
  const gotoExam = useCallback(
    (index: number) => {
      if (index < 0 || index >= exams.length) return;
      setActiveExam(index);
      setNavOpen(false);
      const node = cardRefs.current[index];
      if (node) {
        programmaticScroll.current = true;
        const navBottom = navRef.current?.getBoundingClientRect().bottom ?? 120;
        const top = node.getBoundingClientRect().top + window.scrollY - Math.max(120, navBottom) - 16;
        window.scrollTo({ top, behavior: "smooth" });
        unlockRef.current?.();
      }
    },
    [exams.length],
  );

  const stepExam = useCallback(
    (delta: number) => gotoExam(activeExam + delta),
    [gotoExam, activeExam],
  );

  return (
    <div className="pt-8">
      <PageHeader
        title="CT 检查结果"
        subtitle="检查记录 · 可直接转发给医生"
        icon={FileScan}
        iconClass="text-brand-blue"
        badge={<PrivateBadge />}
        size="compact"
      />

      <div className="mt-6 space-y-4">
        {err && <ErrorBlock message={err} onRetry={load} />}
        {loading && <Loading label="正在加载检查记录…" className="py-16" />}

        {!loading && !err && !hasExams && (
          <div className="glass rounded-3xl shadow-card">
            <Empty text="还没有检查记录" hint="在管理页添加第一次检查后，这里就会显示。" />
          </div>
        )}

        {!loading && !err && hasExams && (
          <>
            {/* 多次检查导航条 */}
            <div ref={navRef} className="sticky top-[65px] z-20 -mx-1">
              <div className="glass relative rounded-2xl p-3 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  {/* 「第 X / N 次」整块就是下拉触发器：点一下展开选择列表 */}
                  <button
                    type="button"
                    onClick={() => setNavOpen((v) => !v)}
                    title="点击选择其他检查"
                    aria-expanded={navOpen}
                    aria-label={`当前第 ${activeExam + 1} 次，共 ${exams.length} 次，点击选择`}
                    className="press flex items-center gap-1.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-paper-100"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-blue/20 to-brand-blue2/10 text-brand-blue">
                      <Layers size={16} />
                    </span>
                    <span className="leading-tight">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-sm font-bold tabular-nums text-paper-900">
                          第 {activeExam + 1} / {exams.length} 次
                        </span>
                        <span className="text-xs font-medium text-paper-600">共 {exams.length} 次检查</span>
                        <ChevronDown
                          size={13}
                          className={`ml-0.5 self-center text-paper-500 transition ${navOpen ? "rotate-180" : ""}`}
                        />
                      </span>
                      <span className="block text-[11px] text-paper-600">
                        {shortDate(exams[activeExam]?.exam_time || "")}
                        {exams[activeExam]?.project && ` · ${exams[activeExam].project}`}
                      </span>
                    </span>
                  </button>

                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => stepExam(-1)}
                      disabled={activeExam === 0}
                      title="上一次检查"
                      aria-label="上一次检查"
                      className="press grid h-8 w-8 place-items-center rounded-xl border border-paper-200 text-paper-700 transition hover:border-brand-gold/50 disabled:opacity-35"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepExam(1)}
                      disabled={activeExam === exams.length - 1}
                      title="下一次检查"
                      aria-label="下一次检查"
                      className="press grid h-8 w-8 place-items-center rounded-xl border border-paper-200 text-paper-700 transition hover:border-brand-gold/50 disabled:opacity-35"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>

                {/* 进度点 */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  {exams.map((e, i) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => gotoExam(i)}
                      title={`第 ${i + 1} 次 · ${shortDate(e.exam_time)}`}
                      aria-label={`跳转到第 ${i + 1} 次检查`}
                      className={`h-1.5 flex-1 rounded-full transition ${
                        i === activeExam
                          ? "bg-brand-blue"
                          : i < activeExam
                            ? "bg-brand-blue/35"
                            : "bg-paper-300 hover:bg-brand-blue/30"
                      }`}
                    />
                  ))}
                </div>

                {/* 选择列表：绝对定位浮层，不撑高导航条 */}
                {navOpen && (
                  <div className="absolute inset-x-0 top-full z-30 mt-2 grid max-h-[55vh] gap-1.5 overflow-y-auto rounded-2xl border border-paper-200 bg-white/95 p-2 shadow-card backdrop-blur-xl">
                    {exams.map((e, i) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => gotoExam(i)}
                        className={`press flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                          i === activeExam
                            ? "bg-brand-blue/12 text-brand-blue ring-1 ring-brand-blue/25"
                            : "text-paper-700 hover:bg-paper-100"
                        }`}
                      >
                        <span className="w-12 shrink-0 font-semibold tabular-nums">第 {i + 1} 次</span>
                        <span className="shrink-0 tabular-nums text-paper-600">{shortDate(e.exam_time)}</span>
                        <span className="min-w-0 flex-1 truncate text-paper-600">{e.project || "—"}</span>
                        {i === activeExam && <span className="shrink-0 text-[10px] font-semibold">当前</span>}
                      </button>
                    ))}
                  </div>
                )}

              </div>
            </div>

            {/* 检查卡片：一次检查一个块，连续铺开 */}
            <div className="space-y-4">
              {exams.map((e, k) => (
                <ExamCard
                  key={e.id}
                  exam={e}
                  index={k}
                  total={exams.length}
                  onPhotoClick={(pi) => openPhoto(k, pi)}
                  setRef={(el) => { cardRefs.current[k] = el; }}
                />
              ))}
            </div>

            {exams.some((e) => e.photos.length > 0) && (
              <p className="text-[11px] text-paper-500">
                提示：点击报告照片可放大查看（双指缩放，Esc 或返回键关闭）。
              </p>
            )}
          </>
        )}
      </div>

      <ExitPresence open={preview !== null}>
        {preview !== null && <Lightbox image={preview} onClose={closeImage} />}
      </ExitPresence>
    </div>
  );
}

/** 一次检查 = 一张卡片，字段分行展示 */
function ExamCard({
  exam,
  index,
  total,
  onPhotoClick,
  setRef,
}: {
  exam: CtExam;
  index: number;
  total: number;
  onPhotoClick: (photoIndex: number) => void;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  const hasLink = !!(exam.link_url || exam.link_text);
  return (
    <div ref={setRef} className="glass scroll-mt-40 overflow-hidden rounded-3xl shadow-card">
      {/* 卡片头：第几次 + 日期 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-paper-100 px-5 py-3">
        <span className="rounded-full bg-brand-blue/12 px-2.5 py-1 text-[11px] font-bold text-brand-blue">
          第 {index + 1} 次检查
        </span>
        {exam.exam_time && (
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-paper-700">
            <CalendarDays size={13} className="text-paper-500" />
            {exam.exam_time}
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-paper-500">
          {index + 1} / {total}
        </span>
      </div>

      <div className="space-y-3.5 p-5">
        {/* 字段行：label + value 两列，紧凑清晰 */}
        <FieldRow icon={FileText} label="检查项目" value={exam.project} strong />

        <FieldRow icon={Link2} label="影像链接">
          {hasLink ? (
            <div className="min-w-0">
              {exam.link_url ? (
                <a
                  href={exam.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-brand-blue underline decoration-brand-blue/40 underline-offset-2 hover:decoration-brand-blue"
                >
                  <span className="truncate">{exam.link_label || "打开影像"}</span>
                  <ExternalLink size={13} className="shrink-0" />
                </a>
              ) : (
                <span className="text-sm text-paper-700">—</span>
              )}
              {exam.link_text && (
                <div className="mt-1 break-all text-xs leading-relaxed text-paper-600">
                  {exam.link_text}
                </div>
              )}
            </div>
          ) : (
            <span className="text-sm text-paper-500">暂无</span>
          )}
        </FieldRow>

        {exam.note && <FieldRow icon={Info} label="备注" value={exam.note} />}

        {/* 报告照片 */}
        <div className="border-t border-paper-100 pt-3.5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-paper-600">
            <ImageIcon size={13} />
            报告照片
            <span className="text-paper-500">· {exam.photos.length} 张</span>
          </div>
          {exam.photos.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {exam.photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPhotoClick(i)}
                  title="点击放大"
                  className="press group overflow-hidden rounded-2xl border border-paper-200 bg-white text-left"
                >
                  <img
                    src={p.url}
                    alt={p.caption || "报告照片"}
                    className="block max-h-[420px] w-full object-contain transition group-hover:opacity-90"
                  />
                  {p.caption && (
                    <div className="border-t border-paper-100 px-3 py-1.5 text-[11px] text-paper-600">
                      {p.caption}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-paper-200 px-3 py-4 text-center text-xs text-paper-500">
              暂无照片
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** label + value 的统一样式行 */
function FieldRow({
  icon: Icon,
  label,
  value,
  strong,
  children,
}: {
  icon: typeof FileText;
  label: string;
  value?: string;
  strong?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="flex w-20 shrink-0 items-center gap-1.5 pt-0.5 text-xs font-medium text-paper-600">
        <Icon size={13} className="text-paper-500" />
        {label}
      </span>
      <div className="min-w-0 flex-1">
        {children ?? (
          <span className={`${strong ? "font-semibold text-paper-900" : "text-paper-700"} break-words`}>
            {value || <span className="font-normal text-paper-500">未填写</span>}
          </span>
        )}
      </div>
    </div>
  );
}
