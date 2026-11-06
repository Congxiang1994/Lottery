import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { isUnauthorized } from "./http";
import { Loading } from "./State";
import { errText } from "./State";

/**
 * 私有功能的密码门 + 会话探测（**全站唯一实现**）。
 *
 * 背景
 * ----
 * 5 个私有页（/trigger /story-admin /babysong-admin /access /deals-admin）
 * 各自写了一份 ``PasswordGate``：同样的 key 图标、同样的输入框、同样的渐变按钮，
 * 但错误提示文案、loading 样式、`errText` 用法各写各的，
 * babysong 甚至只有内联表单、连卡片样式都不同。
 * 改造后这些差异没有一处是有意的 —— 私有功能的进入手感应当完全一致。
 *
 * 用法（页面只关心「验证通过之后」）
 * ---------------------------------
 * ```tsx
 * export default function StoryAdmin() {
 *   return (
 *     <AdminGate
 *       title="睡前故事管理"
 *       subtitle="私有功能 · 验证后可增删改查"
 *       desc="维护每日睡前故事，并签发 API 密钥。"
 *       probe={() => storyApi.session()}
 *       login={(pwd) => storyApi.auth(pwd)}
 *       logout={() => storyApi.logout()}
 *     >
 *       {({ onUnauthorized }) => <MyPanel onUnauthorized={onUnauthorized} />}
 *     </AdminGate>
 *   );
 * }
 * ```
 * ``children`` 用函数形式拿到 ``onUnauthorized``：任何一次请求碰到 401
 * （会话过期）就调它，页面退回密码门，而不是把「会话失效」显示成一个红色错误条。
 */
export interface AdminGateProps {
  /** 标题（页面内部名称，如「访问管理」） */
  title: string;
  /** 标题右侧的副标题（如「私有功能 · 验证后可查看」） */
  subtitle: string;
  /** 卡片里的一句功能说明 */
  desc: string;
  /** 会话探测：返回是否已登录 */
  probe: () => Promise<boolean>;
  /** 提交密码：抛异常即视为失败（401 密码错 / 429 锁定中） */
  login: (password: string) => Promise<unknown>;
  /** 退出（清 cookie） */
  logout: () => Promise<unknown>;
  /** 密码门的强调色（按功能域微调，默认为品牌红→金） */
  accent?: "red" | "gold" | "sky" | "violet";
  children: (ctx: { onUnauthorized: () => void; logout: () => void }) => ReactNode;
}

const ACCENT: Record<NonNullable<AdminGateProps["accent"]>, string> = {
  red: "from-brand-red/20 to-brand-gold/10 text-brand-red2",
  gold: "from-brand-gold/20 to-brand-red/10 text-brand-gold",
  sky: "from-brand-blue/20 to-brand-blue2/10 text-brand-blue",
  violet: "from-violet-500/20 to-brand-blue/10 text-violet-500",
};

export function AdminGate({
  title,
  subtitle,
  desc,
  probe,
  login,
  logout,
  accent = "red",
  children,
}: AdminGateProps) {
  /** null = 探测中（渲染同一张骨架卡，避免「先闪密码门再跳进页面」） */
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    probe()
      .then((ok) => !cancelled && setAuthed(ok))
      .catch(() => !cancelled && setAuthed(false));
    return () => {
      cancelled = true;
    };
    // probe 是调用方每次 render 新建的函数，故意只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogout = () => {
    setAuthed(false);
    logout().catch(() => {
      /* 退出失败也要退回密码门：cookie 过期时后端本就无需处理 */
    });
  };

  /* 探测中：卡片里必须有「正在确认会话」的反馈。
     ⚠️ 别写成裸的 <GateShell/>（只有标题和说明、下面一片空）——
     探测要一次往返（公网 ~1s），空卡片看起来就是「这页坏了」。
     保留同一张卡也让探测结束 → 密码框出现时不跳位。 */
  if (authed === null) {
    return (
      <GateShell title={title} subtitle={subtitle} desc={desc} accent={accent}>
        <Loading label="正在确认会话…" className="mt-6" />
      </GateShell>
    );
  }
  if (!authed) {
    return (
      <GateShell title={title} subtitle={subtitle} desc={desc} accent={accent}>
        <PasswordForm login={login} onPass={() => setAuthed(true)} />
      </GateShell>
    );
  }
  return <>{children({ onUnauthorized: () => setAuthed(false), logout: doLogout })}</>;
}

/** 卡片外壳：探测中 / 密码门共用，尺寸与位置完全一致（切换时不跳动）。 */
function GateShell({
  title,
  subtitle,
  desc,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  desc: string;
  accent: NonNullable<AdminGateProps["accent"]>;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center pt-10">
      <div className="glass w-full max-w-sm rounded-3xl p-7 shadow-card">
        <div className="flex items-center gap-2">
          <span
            className={`grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br ${ACCENT[accent]}`}
          >
            <KeyRound size={18} />
          </span>
          <div>
            <h1 className="text-lg font-bold text-paper-900">{title}</h1>
            <p className="text-xs text-paper-700">{subtitle}</p>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-paper-700">{desc}</p>
        {children}
      </div>
    </div>
  );
}

/** 密码表单（纯交互，不含外壳）。 */
function PasswordForm({
  login,
  onPass,
}: {
  login: (password: string) => Promise<unknown>;
  onPass: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = () => {
    if (!pwd || loading) return;
    setLoading(true);
    setErr(null);
    login(pwd)
      .then(() => {
        setPwd("");
        onPass();
      })
      .catch((e) => setErr(isUnauthorized(e) ? "密码错误，请重试" : errText(e)))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <input
        type="password"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="请输入操作密码"
        autoFocus
        className="mt-4 w-full rounded-xl border border-paper-200 bg-white/60 px-3 py-2.5 text-sm text-paper-900 outline-none transition focus:border-brand-gold/50"
      />
      {err && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-rose-600/25 bg-rose-50 px-3 py-2 text-xs text-rose-700"
        >
          {err}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={loading || !pwd}
        className="press mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-red to-brand-red2 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:opacity-90 disabled:opacity-40"
      >
        {loading ? (
          <>
            <Loader2 size={14} className="animate-spin" /> 校验中…
          </>
        ) : (
          "进入"
        )}
      </button>
    </>
  );
}
