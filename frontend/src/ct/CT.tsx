import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileScan,
  Link2,
  Layers,
  List,
  Printer,
  ShieldCheck,
} from "lucide-react";

import { AdminGate } from "../common/AdminGate";
import { PageHeader, PrivateBadge } from "../common/PageHeader";
import { Empty, ErrorBlock, Loading } from "../common/State";
import { ExitPresence } from "../common/Modal";
import { useModalHistory } from "../common/useModalHistory";
import { copyText } from "../common/http";
import { BTN_PRIMARY, BTN_SECONDARY } from "../common/ui";
import { ctApi, type CtReportMeta } from "./api";
import { CT_REPORT_SCOPE, extractReport, scopeCss } from "./embed";
import { Lightbox, useImageClick } from "./Lightbox";
import {
  activeSectionIndex,
  collectImageExamMap,
  imageExamLabels,
  parseExams,
  pagedCss,
} from "./exams";
import { collectImages } from "./images";

/**
 * CT 报告分享页 /ct
 *
 * 目的：把一份 CT 报告（HTML，含内嵌报告照片）通过网站分享给医生看。
 *
 * 渲染方式：**整个报告融进页面**。
 * 报告自带的 `<style>` 经作用域化（`h1` → `.ct-report h1`）后随正文一起注入，
 * 正文用 `dangerouslySetInnerHTML` 铺进容器 —— 页面上看到的就是报告本身，
 * 没有 iframe、没有嵌套文档。
 *
 * 多次检查的导航（2026-11-13）
 * --------------------------
 * 报告把每次检查装进一个 `<section>`。用户会不断追加检查，所以：
 * - `parseExams` 从正文解析出「共几次 / 每次的日期与项目」，追加后自动适配；
 * - 顶部 sticky 导航条显示「第 X / N 次」+ 日期 + 项目，可直接点选、上一/下一；
 * - 两种浏览方式：「连续」原样铺开（滚动自动高亮当前检查）/「逐次」一次只看一次；
 * - 灯箱图片标题带上「第几次检查」，医生放大照片时不会看串。
 *
 * 返回键（2026-11-13）
 * -------------------
 * 图片灯箱接 `useModalHistory`：打开时压一条历史记录，浏览器返回键 / 手机侧滑
 * 只关灯箱、不离开页面；主动关闭时把记录弹掉，历史保持干净。
 */

type ViewMode = "continuous" | "paged";

export default function CT() {
  return (
    <AdminGate
      title="CT 检查结果"
      subtitle="私有功能 · 分享口令"
      desc="输入分享口令即可查看 CT 报告原文，并可复制链接发给医生。"
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
  const [meta, setMeta] = useState<CtReportMeta | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // 多次检查导航
  const [viewMode, setViewMode] = useState<ViewMode>("continuous");
  const [activeExam, setActiveExam] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  // 灯箱状态：图片列表 + 当前下标（-1 = 未打开）
  const [images, setImages] = useState<string[]>([]);
  const [imageExam, setImageExam] = useState<number[]>([]);
  const [lightIndex, setLightIndex] = useState(-1);
  /** 报告容器节点（回调 ref 写入：报告是异步渲染的，用 useRef+useEffect 会错过挂载时机） */
  const [reportNode, setReportNode] = useState<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setLoading(true);
    setErr(null);
    ctApi
      .meta()
      .then((d) => {
        setExists(d.exists);
        setMeta(d.report);
        if (!d.exists) {
          setHtml(null);
          return null;
        }
        return ctApi.report().then((r) => setHtml(r.html));
      })
      .catch((e) => {
        if ((e as { status?: number })?.status === 401) {
          onUnauthorized();
          return;
        }
        setErr((e as Error)?.message || "加载失败");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  /** 报告自带 CSS 作用域化 + 正文拆分（memo：正文不变就不重算） */
  const embedded = useMemo(() => {
    if (!html) return null;
    const parsed = extractReport(html);
    return { css: scopeCss(parsed.css), body: parsed.body, exams: parseExams(parsed.body) };
  }, [html]);

  const exams = embedded?.exams ?? [];
  const hasExams = exams.length > 0;

  /** 报告渲染后收集图片与「图片属于第几次检查」的映射 */
  useEffect(() => {
    if (!reportNode) {
      setImages([]);
      setImageExam([]);
      return;
    }
    setImages(collectImages(reportNode));
    setImageExam(collectImageExamMap(reportNode));
  }, [reportNode, embedded]);

  const examLabels = useMemo(() => imageExamLabels(exams, imageExam), [exams, imageExam]);

  /* ---------------- 返回键：灯箱压历史栈，侧滑只关灯箱 ---------------- */

  const closeLightbox = useCallback(() => setLightIndex(-1), []);
  const lightHistory = useModalHistory("ctLightbox", closeLightbox);

  /** 打开灯箱（并压一条历史记录） */
  const openImage = useCallback(
    (index: number) => {
      setLightIndex(index);
      lightHistory.push();
    },
    [lightHistory],
  );

  /** 主动关闭灯箱（把压进去的那条记录弹掉） */
  const closeImage = useCallback(() => {
    setLightIndex(-1);
    lightHistory.pop();
  }, [lightHistory]);

  /** 挂点击监听（callback ref 专用：报告异步渲染，useEffect 会错过挂载时机） */
  const attachClick = useImageClick(openImage);
  /** 回调 ref：既挂点击监听，又把节点存进 state（供收集图片用） */
  const reportRefCb = useCallback(
    (node: HTMLDivElement | null) => {
      setReportNode(node);
      attachClick(node);
    },
    [attachClick],
  );

  /* ---------------- 连续模式：滚动感知当前是第几次 ---------------- */

  useEffect(() => {
    if (viewMode !== "continuous" || !hasExams || !reportNode) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const sections = Array.from(reportNode.querySelectorAll("section"));
      if (!sections.length) return;
      // 判定线取导航条底边（盖住 sticky 条，避免标题被压住时高亮错一次）
      const threshold = (navRef.current?.getBoundingClientRect().bottom ?? 120) + 24;
      const tops = sections.map((s) => s.getBoundingClientRect().top);
      // 兜底：滚到页面底部时最后一次检查可能永远到不了判定线以上
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
      const active = activeSectionIndex(tops, threshold, atBottom);
      setActiveExam((cur) => (cur === active ? cur : active));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [viewMode, hasExams, reportNode]);

  /** 点选某一次检查：连续模式滚过去，逐次模式直接切页 */
  const gotoExam = useCallback(
    (index: number) => {
      if (index < 0 || index >= exams.length) return;
      setActiveExam(index);
      setNavOpen(false);
      if (viewMode === "continuous") {
        const node = reportNode?.querySelectorAll("section")[index] as HTMLElement | undefined;
        if (node) {
          const top = node.getBoundingClientRect().top + window.scrollY - 132;
          window.scrollTo({ top, behavior: "smooth" });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [exams.length, viewMode, reportNode],
  );

  const stepExam = useCallback(
    (delta: number) => gotoExam(activeExam + delta),
    [gotoExam, activeExam],
  );

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/ct` : "/ct";

  const copyLink = () => {
    copyText(shareUrl)
      .then((ok) => {
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* 复制失败不打断页面 */
      });
  };

  return (
    <div className="pt-8">
      <PageHeader
        title="CT 检查结果"
        subtitle="报告原文原样呈现 · 可直接打印或转发给医生"
        icon={FileScan}
        iconClass="text-brand-blue"
        badge={<PrivateBadge />}
        size="compact"
        actions={
          <>
            <button type="button" onClick={copyLink} className={`${BTN_SECONDARY} px-3 py-2 text-xs`}>
              <Link2 size={14} />
              {copied ? "已复制链接" : "复制分享链接"}
            </button>
            <a
              href={ctApi.rawUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className={`${BTN_SECONDARY} px-3 py-2 text-xs`}
            >
              <ExternalLink size={14} />
              新窗口打开原版
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className={`${BTN_PRIMARY} px-3 py-2 text-xs`}
            >
              <Printer size={14} />
              打印
            </button>
          </>
        }
      />

      <div className="mt-6 space-y-4">
        {err && <ErrorBlock message={err} onRetry={load} />}

        {loading && <Loading label="正在加载报告…" className="py-16" />}

        {!loading && !err && exists === false && (
          <div className="glass rounded-3xl shadow-card">
            <Empty
              text="尚未导入报告"
              hint="把 CT 报告的 HTML 文件导入后，这里会原样显示报告内容。"
            />
          </div>
        )}

        {!loading && !err && exists && embedded && (
          <>
            {/* 元信息条 */}
            {meta && (
              <div className="glass flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl p-4 text-xs text-paper-700 shadow-card">
                <span className="font-semibold text-paper-900">{meta.title || "CT 检查结果"}</span>
                <span>更新于 {meta.updated_at}</span>
                <span>{(meta.bytes / 1024).toFixed(0)} KB</span>
                <span className="flex items-center gap-1">
                  <ShieldCheck size={12} className="text-brand-blue" />
                  摘要 {meta.sha256.slice(0, 12)}
                </span>
              </div>
            )}

            {/* 多次检查导航条（sticky，滚动时一直能感知「正在看第几次」） */}
            {hasExams && (
              <div ref={navRef} className="sticky top-[65px] z-20 -mx-1">
                <div className="glass rounded-2xl p-3 shadow-card">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 当前进度：第 X / N 次 */}
                    <div className="flex items-center gap-1.5">
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-blue/20 to-brand-blue2/10 text-brand-blue">
                        <Layers size={16} />
                      </span>
                      <div className="leading-tight">
                        <div className="text-sm font-bold tabular-nums text-paper-900">
                          第 {activeExam + 1} / {exams.length} 次
                          <span className="ml-1.5 text-xs font-medium text-paper-600">
                            共 {exams.length} 次检查
                          </span>
                        </div>
                        <div className="text-[11px] text-paper-600">
                          {exams[activeExam]?.date || "—"}
                          {exams[activeExam]?.project && ` · ${exams[activeExam].project}`}
                        </div>
                      </div>
                    </div>

                    <div className="ml-auto flex items-center gap-1.5">
                      {/* 上/下切换 */}
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
                        onClick={() => setNavOpen((v) => !v)}
                        title="选择检查"
                        aria-expanded={navOpen}
                        className="press flex h-8 items-center gap-1 rounded-xl border border-paper-200 px-2.5 text-xs font-medium text-paper-700 transition hover:border-brand-gold/50"
                      >
                        <List size={13} />
                        选择
                        <ChevronDown size={12} className={`transition ${navOpen ? "rotate-180" : ""}`} />
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

                  {/* 进度点：一眼看到「还剩几次」 */}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {exams.map((e, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => gotoExam(i)}
                        title={`第 ${i + 1} 次 · ${e.date || ""}`}
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

                  {/* 展开的全部检查列表 */}
                  {navOpen && (
                    <div className="mt-3 grid gap-1.5 border-t border-paper-100 pt-3">
                      {exams.map((e, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => gotoExam(i)}
                          className={`press flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                            i === activeExam
                              ? "bg-brand-blue/12 text-brand-blue ring-1 ring-brand-blue/25"
                              : "text-paper-700 hover:bg-paper-100"
                          }`}
                        >
                          <span className="w-12 shrink-0 font-semibold tabular-nums">
                            第 {i + 1} 次
                          </span>
                          <span className="shrink-0 tabular-nums text-paper-600">{e.date || "—"}</span>
                          <span className="min-w-0 flex-1 truncate text-paper-600">
                            {e.project || "—"}
                          </span>
                          {i === activeExam && <span className="shrink-0 text-[10px] font-semibold">当前</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 浏览方式：连续（原样铺开）/ 逐次（一次只看一次） */}
                  <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-paper-100 pt-2.5">
                    <span className="text-[11px] text-paper-500">浏览方式</span>
                    <div className="flex items-center gap-1 rounded-xl border border-paper-200 bg-paper-100 p-0.5">
                      {(
                        [
                          ["continuous", "连续浏览"],
                          ["paged", "逐次查看"],
                        ] as [ViewMode, string][]
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setViewMode(mode);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className={`press rounded-lg px-3 py-1 text-[11px] font-medium transition ${
                            viewMode === mode
                              ? "bg-white text-paper-900 shadow-sm"
                              : "text-paper-600 hover:text-paper-900"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 报告正文：自带样式已作用域化到 .ct-report，整份报告融进本页 */}
            <div className="glass rounded-3xl shadow-card">
              <style>{embedded.css}</style>
              {/* 放大提示 + 分页：报告自带 CSS 不含交互，这里补（不改报告 DOM） */}
              <style>{`.${CT_REPORT_SCOPE} img { cursor: zoom-in; }`}</style>
              {viewMode === "paged" && hasExams && <style>{pagedCss(activeExam)}</style>}
              <div
                ref={reportRefCb}
                className={CT_REPORT_SCOPE}
                data-paged={viewMode === "paged" && hasExams ? "1" : undefined}
                dangerouslySetInnerHTML={{ __html: embedded.body }}
              />
            </div>

            {/* 逐次模式：底部上/下一次，避免长报告里必须滚回顶部才能切 */}
            {viewMode === "paged" && hasExams && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => stepExam(-1)}
                  disabled={activeExam === 0}
                  className={`${BTN_SECONDARY} px-3 py-2 text-xs`}
                >
                  <ChevronLeft size={14} /> 上一次
                </button>
                <span className="text-xs tabular-nums text-paper-600">
                  第 {activeExam + 1} / {exams.length} 次
                  {activeExam < exams.length - 1 && ` · 还有 ${exams.length - activeExam - 1} 次`}
                  {activeExam === exams.length - 1 && " · 已是最后一次"}
                </span>
                <button
                  type="button"
                  onClick={() => stepExam(1)}
                  disabled={activeExam === exams.length - 1}
                  className={`${BTN_SECONDARY} px-3 py-2 text-xs`}
                >
                  下一次 <ChevronRight size={14} />
                </button>
              </div>
            )}

            {images.length > 0 && (
              <p className="text-[11px] text-paper-500">
                提示：点击报告里的照片可放大查看（← → 切换，Esc 或返回键关闭）。
              </p>
            )}

            <p className="text-[11px] leading-relaxed text-paper-500">
              分享方式：把站点地址连同分享口令发给对方，对方打开后输入口令即可看到上面的报告原文。
              报告内容原样呈现，未做任何改写。
            </p>
          </>
        )}
      </div>

      {/* 报告图片灯箱（点报告里的照片放大） */}
      <ExitPresence open={lightIndex >= 0}>
        {lightIndex >= 0 && (
          <Lightbox
            images={images}
            index={lightIndex}
            onIndexChange={setLightIndex}
            onClose={closeImage}
            labels={examLabels}
          />
        )}
      </ExitPresence>
    </div>
  );
}
