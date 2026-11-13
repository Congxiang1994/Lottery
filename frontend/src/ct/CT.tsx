import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileScan, Link2, Printer, ShieldCheck } from "lucide-react";

import { AdminGate } from "../common/AdminGate";
import { PageHeader, PrivateBadge } from "../common/PageHeader";
import { Empty, ErrorBlock, Loading } from "../common/State";
import { copyText } from "../common/http";
import { BTN_PRIMARY, BTN_SECONDARY } from "../common/ui";
import { ctApi, type CtReportMeta } from "./api";
import { CT_REPORT_SCOPE, extractReport, scopeCss } from "./embed";

/**
 * CT 报告分享页 /ct
 *
 * 目的：把一份 CT 报告（HTML，含内嵌报告照片）通过网站分享给医生看。
 *
 * 渲染方式：**整个报告融进页面**。
 * 报告自带的 `<style>` 经作用域化（`h1` → `.ct-report h1`）后随正文一起注入，
 * 正文用 `dangerouslySetInnerHTML` 铺进容器 —— 页面上看到的就是报告本身，
 * 没有 iframe、没有嵌套文档，打印/选中/返回键都跟普通页面一致。
 */

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
        // 元信息里没有正文 → 再取一次报告原文（一次性，页面级缓存）
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
    return { css: scopeCss(parsed.css), body: parsed.body };
  }, [html]);

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
            {meta && (
              <div className="glass rounded-2xl p-4 text-xs text-paper-700 shadow-card">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold text-paper-900">{meta.title || "CT 检查结果"}</span>
                  <span>更新于 {meta.updated_at}</span>
                  <span>{(meta.bytes / 1024).toFixed(0)} KB</span>
                  <span className="flex items-center gap-1">
                    <ShieldCheck size={12} className="text-brand-blue" />
                    摘要 {meta.sha256.slice(0, 12)}
                  </span>
                </div>
              </div>
            )}

            {/* 报告正文：自带样式已作用域化到 .ct-report，整份报告融进本页 */}
            <div className="glass rounded-3xl shadow-card">
              <style>{embedded.css}</style>
              <div
                className={CT_REPORT_SCOPE}
                dangerouslySetInnerHTML={{ __html: embedded.body }}
              />
            </div>

            <p className="text-[11px] leading-relaxed text-paper-500">
              分享方式：把站点地址连同分享口令发给对方，对方打开后输入口令即可看到上面的报告原文。
              报告内容原样呈现，未做任何改写。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
