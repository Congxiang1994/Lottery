# 前端规范 · 样式 / 交互 / 动画

> 配套 [architecture.md](./architecture.md)（分层与技术栈）与 [theme-transition.md](./theme-transition.md)（主题过渡实现细节）。
> 本文只讲**怎么写**：新页面照抄这里的组件与 token，不照抄就会和全站不一致 —— 这正是这轮重构要解决的问题。

## 一句话原则

**能复用 `src/common/` 的，绝不自己写第二份。** 各功能可以有不同色调（`tint-*` / 域强调色），
但**结构、动效、反馈、状态呈现必须全站同一套**。

---

## 1. 页面骨架

```tsx
export default function MyPage() {
  return (
    <div className="pt-8">
      <PageHeader
        title="我的功能"
        subtitle="一句话说清这页有什么 / 数据口径"
        icon={Sparkles}            // 按域选图标
        iconClass="text-brand-gold" // 按域选色调
        actions={<Button />}        // 右对齐操作区
      />
      {/* 内容 */}
    </div>
  );
}
```

- 首页级（门户 / 彩票 / 儿歌 / 汉字）：`pt-8`；其余页面同样 `pt-8`，管理台用 `compact` 档头部。
- 路由容器已有 `anim-page-in`（`App.tsx` 的 `key={pathname}`），**页面内不要再加整页入场动画**。

### PageHeader 三档（只准用这三档）

| size | 标题 | 用在哪 |
|---|---|---|
| `hero` | `text-4xl sm:text-5xl`，居中 | 首屏落地页：彩票首页 / 儿歌 / 汉字课 / 下载管理 |
| `page` | `text-3xl`（默认） | 功能主页：历史开奖 / 算法广场 / 睡前故事 / 触发器 / 工具 |
| `compact` | `text-2xl`，副标题更细 | 高密度页：捡漏 / 捡漏设置 / 访问管理 |

> 反例（改造前真实存在）：同类页面标题在 `text-2xl` / `text-3xl` / `text-4xl` 之间乱跳，
> 从「历史开奖」切到「捡漏」标题会肉眼可见地变矮。

---

## 2. 三态（加载 / 空 / 错误）

```tsx
import { Empty, ErrorBlock, Loading, errText } from "../common/State";

if (loading) return <Loading />;                       // 不要手写 Loader2 + 文本
if (err)     return <ErrorBlock message={err} onRetry={reload} />;  // 必须给重试出口
if (!items.length) return <Empty text="还没有记录" hint="任务触发后会出现在这里" />;
```

- **`ErrorBlock` 一定要传 `onRetry`**：只有文案没有出口，用户唯一动作是刷新整页。
- **`Empty` 尽量给 `hint`**：讲清「为什么现在是空的 / 空之后会有什么」。
- 不要 `catch(() => {})` 静默吞异常；确实要静默（如非首屏刷新失败），至少保留旧数据。

---

## 3. 请求

```ts
// src/<domain>/api.ts
import { createApi } from "../common/http";
const api = createApi("/api/<domain>");

export const myApi = {
  list: (limit = 20) => api.get<Item[]>("/list", { limit }),
  create: (data: Item) => api.post<Item>("/items", data),
};
```

- **页面里不许出现裸 `fetch`**（改造前 5 个域各写一份封装，401 判定与错误文案已经漂移）。
- 失败统一是 `ApiError`：`e.status` 判 401 / 5xx，`errText(e)` 转人话。
- query 用 `query()` 拼（自动跳过空值与 `false`），不要手写 `?a=${a}&b=${b}`。

---

## 4. 私有页（密码保护）

```tsx
export default function MyAdmin() {
  return (
    <AdminGate
      title="我的管理"
      subtitle="私有功能 · 验证后可改配置"
      desc="一句话说明能改什么。"
      probe={() => myApi.session()}
      login={(pwd) => myApi.auth(pwd)}
      logout={() => myApi.logout()}
      accent="gold"
    >
      {({ onUnauthorized, logout }) => (
        <MyAdminPanel onUnauthorized={onUnauthorized} logout={logout} />
      )}
    </AdminGate>
  );
}
```

- 面板里任何请求碰到 401 就调 `onUnauthorized()` → 退回密码门，**不要**把「会话过期」显示成红色错误条。
- 标题旁挂 `<PrivateBadge />`（`PageHeader` 的 `badge` 属性）。
- 5 个私有页（trigger / story-admin / babysong-admin / access / deals-admin）的密码门外观、
  错误文案、loading 表现必须完全一致 —— 全部由 `AdminGate` 保证。

---

## 5. 弹窗

```tsx
<ExitPresence open={open}>
  {open && (
    <AppModal
      onClose={close}
      size="md"                       // sm 确认 / md 表单 / lg 内容
      title={<><Icon size={16} className="text-brand-gold" /> 标题</>}
      description="可选副标题"
      footer={<>…按钮组…</>}
    >
      表单内容
    </AppModal>
  )}
</ExitPresence>
```

- **不要手写 `anim-overlay fixed inset-0 …` + `anim-panel …`**：遮罩色调、层级、滚动分层、Esc 全在 `AppModal` 里。
- 破坏性操作（删除 / 清空）一律 `<ConfirmDialog danger>`（红色按钮）。
- 嵌套弹窗传 `z={60}`；页面自己要做分级 Esc 时传 `escapeClose={false}`。
- 详情类弹窗（阅读页 / 播放器）用 `bare` 裸壳，自己画标题栏，但仍共用遮罩与出场动画。
- 出场动画 = `ExitPresence`（保留 children 快照 200ms）+ `.modal-host[data-closing]`（见 index.css）。
  **弹窗必须挂到 `document.body`**（`Modal` 内部 `createPortal`），否则会被路由容器的 `transform` 困住。

---

## 6. 交互基线（已在 index.css 全局生效，别覆盖）

| 行为 | 规格 |
|---|---|
| 按压反馈 | `scale: .97`，130ms，`--ease-interact`；用 CSS `scale` 独立属性（不覆盖 `transform` 定位） |
| 悬停抬升 | `.card-hover`，250ms `cubic-bezier(.22,1,.36,1)`，双层阴影 |
| 键盘焦点 | 品牌金描边 2px + offset 2px（`:where()` 权重 0，组件可覆盖） |
| 主题过渡 | 320ms + 分层错峰 40ms，挂在 `html.theme-anim`（**不挂 `.site-night`**） |
| 页面入场 | `anim-page-in` 450ms，`animation-fill-mode: backwards`（🔴 不能 `both`） |
| 降级 | `prefers-reduced-motion` 下全部关掉，弹窗改为立即卸载 |

- 自己写的可点元素若不是 `button` / `a` / `[role=button]`，记得加 `press` 类。
- 🔴 `animation-fill-mode` **一律 `backwards`**：`both` 会永久保留 `to{transform}`，
  让祖先成为 `position: fixed` 后代的包含块 → 弹窗遮罩盖不住导航栏、滚动后弹窗掉出视口。

---

## 7. 色调（不同功能可以有不同色，但要成体系）

| 域 | 色调 | 用法 |
|---|---|---|
| 彩票 | 品牌红 `brand-red` / 蓝 `brand-blue` | 图标、渐变文字、按钮 |
| 睡前故事 | 金 `brand-gold` + 纸面 `paper-sheet` | 阅读页基调 |
| 儿歌 | 翠绿 `emerald`（强调「本地」） | 本地标记、播放态 |
| 汉字课 | 水墨（`#3d2b1f` / `#b93a3a` / `#d4c4a8`） | 整页独立水墨皮肤 |
| 捡漏 | 金 `brand-gold` | 折扣 / 信号 chip |
| 访问管理 | 金 + 中性 `paper-*` | 管理台 |

- 门户卡片的域色调用 `.tint-*`（`tint-red/sky/gold/violet/amber/teal`），夜间映射已内置。
- 🔴 **新增语义色或半透明底色，必须回 `index.css` 的 `.site-night` 段补一条映射** ——
  那是白名单式覆盖，漏一条夜里就是一个亮块（emerald / rose 整套漏映射过，`bg-paper-50/xx` 漏过）。

---

## 8. 暗色模式

- 只有**亮 / 暗两档**，不引入「自动」第三档。默认按时段（07:00–17:59 亮）。
- 页面里优先用 `paper-*` / `brand-*` 语义类，它们有夜间映射；**不要硬编码浅色十六进制**。
- 汉字课是例外（水墨皮肤），它的色值在 `.site-night` 里有逐个映射，新增色值要一并补。
- 改 `useTheme.ts` 的常量必须同步 `index.html` 首屏内联脚本，否则会闪一下。

---

## 9. 提交前自检

```bash
cd frontend
env -u NODE_OPTIONS npx tsc --noEmit     # 必须 0 错误
env -u NODE_OPTIONS npm run build        # 必须成功
```

- [ ] 没有裸 `fetch`、没有手写密码门、没有手写弹窗骨架、没有手写三态
- [ ] 新路由是 `React.lazy`；已在 `Portal.APPS` / `App.tsx` / `Nav.useNavLinks` 三处注册
- [ ] 新增语义色 / 半透明底色已在 `.site-night` 补映射
- [ ] 私有页的 401 会退回密码门
- [ ] 弹窗能 Esc 关、能点遮罩关、退场有动画、手机上不卡住滚动
