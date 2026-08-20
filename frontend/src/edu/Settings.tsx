import { useEffect, useState } from "react";
import { KeyRound, Bookmark, ClipboardCopy, RefreshCw, CheckCircle2 } from "lucide-react";
import { Api } from "./api";

const TOKEN_SCRIPT =
  '(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith("ND_UC_AUTH"));if(!k)return alert("未找到Token，请确认已登录");const t=JSON.parse(JSON.parse(localStorage.getItem(k)).value).access_token;navigator.clipboard.writeText(t);console.log("Token已复制:",t)})()';

export default function Settings() {
  const [hasAuth, setHasAuth] = useState(false);
  const [authCode, setAuthCode] = useState("获取中…");
  const [token, setToken] = useState("");
  const [showBookmark, setShowBookmark] = useState(false);
  const [bookmark, setBookmark] = useState("");
  const [saving, setSaving] = useState(false);

  const refreshAuth = async () => {
    try {
      setHasAuth((await Api.authStatus()).has_auth);
    } catch {
      setHasAuth(false);
    }
  };

  useEffect(() => {
    refreshAuth();
    Api.authCode()
      .then((d) => setAuthCode(d.code))
      .catch(() => setAuthCode("获取失败"));
  }, []);

  const genBookmark = async () => {
    let code = authCode;
    if (authCode === "获取中…" || authCode === "获取失败") {
      try {
        code = (await Api.authCode()).code;
        setAuthCode(code);
      } catch {
        return;
      }
    }
    const server = window.location.origin;
    const bm =
      'javascript:(function(){var k=Object.keys(localStorage).find(function(x){return x.indexOf("ND_UC_AUTH")===0});if(!k){alert("未找到登录信息，请先在 basic.smartedu.cn 登录");return}var t;try{t=JSON.parse(JSON.parse(localStorage.getItem(k)).value).access_token}catch(e){alert("解析登录信息失败");return}var x=new XMLHttpRequest();x.open("POST","' +
      server +
      '/api/edu/auth/code",true);x.setRequestHeader("Content-Type","application/json");x.onload=function(){alert(x.status===200?"登录信息已绑定到你的下载助手，可以返回使用了":"绑定失败："+x.status)};x.onerror=function(){alert("无法连接下载助手")};x.send(JSON.stringify({code:"' +
      code +
      '",token:t}))})();';
    setBookmark(bm);
    setShowBookmark(true);
    try {
      await navigator.clipboard.writeText(bm);
    } catch {
      /* ignore */
    }
  };

  const saveAuth = async () => {
    setSaving(true);
    try {
      await Api.setAuth(token);
      await refreshAuth();
      setToken("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-rise max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">设置 · 登录信息</h2>
        <p className="mt-0.5 text-sm text-white/45">每个浏览器会话独立配置自己的平台登录信息，互不影响</p>
      </div>

      {/* 一键授权 */}
      <div className="glass rounded-2xl p-6">
        <div className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <Bookmark size={20} className="text-brand-red2" /> 一键授权（推荐）
        </div>
        <p className="mb-4 text-sm text-white/55">收藏一个书签，在平台登录后点一下即可自动绑定，无需打开控制台。</p>

        <div className="mb-4 rounded-xl border border-dashed border-brand-red/40 bg-white/5 p-4">
          <div className="mb-1 text-xs text-white/40">我的授权码（每个浏览器独立）</div>
          <div className="select-all text-2xl font-bold tracking-widest text-brand-red2">{authCode}</div>
          <button
            onClick={genBookmark}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:opacity-90"
          >
            <ClipboardCopy size={14} /> 复制我的专属书签
          </button>
        </div>

        <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-white/60">
          <li>点击「复制我的专属书签」，把生成的内容收藏为书签</li>
          <li>
            浏览器打开 <b>basic.smartedu.cn</b> 并登录账号
          </li>
          <li>在平台任意页面点击收藏的书签，弹出“已绑定”即成功</li>
          <li>返回本页，右上角应显示「已配置登录」</li>
        </ol>

        <details className="group mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-brand-red2">
            📖 如何收藏书签（详细操作）
          </summary>
          <div className="mt-3 space-y-4 text-sm text-white/60">
            <div>
              <div className="mb-1 font-semibold text-white/80">方法一：收藏当前页 + 改地址（最简单，推荐）</div>
              <ol className="list-decimal space-y-1 pl-5">
                <li>点「复制我的专属书签」→ 代码已复制</li>
                <li>
                  按 <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">Ctrl + D</code>（Mac 为{" "}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">Cmd + D</code>）收藏当前页面 → 点「完成」
                </li>
                <li>在书签栏找到刚收藏的书签，<b>右键 → 编辑</b></li>
                <li>
                  把「网址/URL」一栏内容<b>删干净</b>，<b>粘贴</b>复制的书签代码 → 保存
                </li>
              </ol>
            </div>
            <div>
              <div className="mb-1 font-semibold text-white/80">方法二：直接新建书签</div>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <b>Chrome / Edge</b>：按{" "}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">Ctrl + Shift + O</code> 打开书签管理器 →
                  右上角 <b>⋯ → 添加新书签</b> → 名称随便填 → 「网址」粘贴代码 → 保存
                </li>
                <li>
                  <b>Firefox</b>：按{" "}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">Ctrl + Shift + O</code> 打开书签库 →
                  右键 → <b>新建书签</b> → 同上粘贴
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2.5 text-xs text-amber-300">
              <b>关键点：</b>收藏后<b>不要</b>在平台外点开它（它是一段代码，不是普通网址）。需在{" "}
              <b>basic.smartedu.cn 登录后</b>，在平台页面点一下书签才会运行并完成绑定。若粘贴后保存不了，检查是否把原「网址」栏内容删干净了再粘贴。
            </div>
          </div>
        </details>

        {showBookmark && (
          <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="mb-1.5 text-xs font-medium text-white/60">你的专属书签（已复制，可收藏为书签）</div>
            <textarea readOnly value={bookmark} rows={4} className="input !bg-black/30 text-[11px] font-mono" />
          </div>
        )}

        <button
          onClick={refreshAuth}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 px-3 py-2 text-sm font-medium text-white/70 transition hover:border-white/25 hover:text-white"
        >
          <RefreshCw size={14} /> 检测状态
        </button>
        {hasAuth && (
          <span className="ml-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-300">
            <CheckCircle2 size={16} /> 已配置登录
          </span>
        )}
      </div>

      {/* 手动 token */}
      <div className="glass rounded-2xl p-6">
        <div className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <KeyRound size={20} className="text-brand-gold" /> 手动粘贴 Token（进阶）
        </div>
        <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-white/60">
          <li>
            浏览器打开 <b>basic.smartedu.cn</b> 并登录
          </li>
          <li>
            按 <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">F12</code> 打开控制台，粘贴以下代码回车（自动复制 Token）
          </li>
        </ol>
        <div className="mb-4 break-all rounded-xl bg-black/40 p-3 text-xs font-mono text-sky-300">{TOKEN_SCRIPT}</div>
        <div className="mb-3">
          <div className="mb-1.5 text-sm font-medium text-white/70">登录 Token（Access Token / X-Nd-Auth）</div>
          <textarea
            rows={2}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="粘贴上面复制的 Token"
            className="input"
          />
        </div>
        <button
          onClick={saveAuth}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存登录信息"}
        </button>
        <p className="mt-3 text-xs text-white/40">
          登录信息保存在服务器内存（绑定到当前浏览器会话），重启后需重新配置。普通文件可直连下载；视频走服务器；受限课件需登录。
        </p>
      </div>
    </div>
  );
}
