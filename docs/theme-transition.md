# 亮/暗切换过渡 · 方案与实施记录

> 状态：**已实施并上线（2026-09-30）**。产物 `index-oHQmV0_m.js` / `index-Db_1pB5i.css`。
> 需求：「亮色和暗色模式切换的时候，感觉过渡有点生硬，有办法让切换过程更加优雅吗？」
> 结论：**做了，成本很低**（前端 2 个文件、约 45 行）。生产实测 **24/25 通过**，唯一非满分项（汉字页 47fps）是**既有基线**、非本次回归，见 §10。

> ⚠️ **实施时对原方案做了两处改良**，见 §2.3：
> ① 过渡包裹点从 `toggle()` 上移到「应用 class 的 effect」→ **自动时段切换也获得过渡**
> ② `withThemeAnim` 实现为模块级函数 + 模块级计时器，而非 hook 内闭包

---

## 1. 先定位「生硬」到底出在哪（实测，不是猜）

在生产环境用 puppeteer-core 探测各页面的元素规模与过渡现状：

| 页面 | 元素数 | 已带 transition | **无 transition（瞬时跳变）** |
|---|---|---|---|
| 首页 | 257 | 49 | **208（81%）** |
| 睡前故事页 | 366 | — | — |
| 汉字页 | 1068 | — | — |
| 儿歌页 | 1470 | — | — |
| 智能推荐页 | 1887 | — | — |

**关键实测：** 给 `<html>` 挂上 `site-night` 后，连续采样 6 帧 `body` 背景色：

```
帧 0: rgb(23, 18, 15)     ← 已经是暗色终值
帧 1: rgb(23, 18, 15)
...
帧 5: rgb(23, 18, 15)
→ 取值种类 = 1  ⇒ ❌ 单帧内直接跳到终值，零插值
```

三个页面（首页 / 故事页 / 儿歌页）**结果完全一致**。这就是「生硬」的直接原因：**不是过渡不好看，是根本没有过渡。**

### 另外两类「注定会跳」的元素

| 类型 | 数量（首页） | 原因 |
|---|---|---|
| 含 `background-image` 渐变的元素 | **28 个** | **CSS 渐变不可插值** —— 加任何 `transition` 都没用 |
| `color-scheme: light → dark` | 1（`<html>`） | 浏览器原生行为，不可过渡 |

现有 49 个带 transition 的元素，时长分别是 130ms（下压反馈）、150ms、250ms（卡片悬停）、300ms —— **没有一个是为主题切换服务的**。

---

## 2. 方案：`html.theme-anim`（切换瞬间才启用过渡）

### 2.1 核心机制

新增一个与主题**解耦**的临时类：

```ts
// useTheme.ts（模块级，实际实现）
const THEME_ANIM_MS = 320;        // 必须与 index.css 的 --dur-theme 一致
const ANIM_CLASS = "theme-anim";
let animTimer = 0;

function withThemeAnim(apply: () => void) {
  if (typeof window === "undefined") return;
  const el = document.documentElement;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    apply();
    return;
  }
  el.classList.add(ANIM_CLASS);
  apply();                                   // 同步改 .site-night，下一帧统一算样式 → 插值
  window.clearTimeout(animTimer);            // 连点重置，避免打断第二次过渡
  animTimer = window.setTimeout(() => el.classList.remove(ANIM_CLASS), THEME_ANIM_MS + 60);
}

// 包裹点：应用 class 的 effect（不是 toggle()）—— 理由见 §2.3
const firstApply = useRef(true);
useEffect(() => {
  const el = document.documentElement;
  const apply = () => el.classList.toggle("site-night", night);
  if (firstApply.current) {                 // 首屏 = 接管，不是切换 → 不能带动画
    firstApply.current = false;
    apply();
    return;
  }
  withThemeAnim(apply);
}, [night]);
```

```css
/* index.css */
:root {
  --dur-theme: 320ms;
  --ease-theme: cubic-bezier(0.4, 0, 0.2, 1);
}

html.theme-anim,
html.theme-anim body, html.theme-anim main, html.theme-anim header, html.theme-anim footer,
html.theme-anim section, html.theme-anim article, html.theme-anim aside, html.theme-anim nav,
html.theme-anim h1, html.theme-anim h2, html.theme-anim h3, html.theme-anim h4,
html.theme-anim p, html.theme-anim li, html.theme-anim span, html.theme-anim a,
html.theme-anim label, html.theme-anim small, html.theme-anim div, html.theme-anim button,
html.theme-anim svg, html.theme-anim path, html.theme-anim input, html.theme-anim textarea,
html.theme-anim select {
  transition-property: color, background-color, border-color, fill, stroke, scale !important;
  transition-duration: var(--dur-theme) !important;
  transition-timing-function: var(--ease-theme) !important;
  transition-delay: 0ms !important;
}

/* 🔴 必须排除 —— 见 §4 */
html.theme-anim .glass,
html.theme-anim .glass * {
  transition-property: none !important;
}

@media (prefers-reduced-motion: reduce) {
  html.theme-anim, html.theme-anim * { transition-duration: 0ms !important; }
}
```

### 2.2 ⭐ 三条设计要点（每条都有实测/原理支撑）

**① `theme-anim` 绝不能写成 `.site-night { transition: ... }`**

直觉写法是在 `.site-night` 段里加 `transition`。**这是错的**：切回亮色时 `.site-night` 先被移除，`transition` 声明随之消失 → **反向过渡失效**，只有「亮→暗」优雅、「暗→亮」还是硬跳。

必须挂在**不随主题变化**的类上，由 JS 控制生命周期。

> POC 已验证双向：亮→暗插值 **18** 个中间取值，暗→亮同样 **18** 个 → ✅ 两个方向都生效。

**② 必须「只在切换瞬间」挂，不能常驻**

常驻会有两个后果：
- 暗色用户**刷新页面时会看到亮→暗的渐入动画** —— 等于把 `index.html` 里那套首屏防闪烁机制废掉
- 每次 hover / 状态变化都变成 320ms，交互手感变钝

**③ 快速连点的计时器要重置**

连点两次期间，第一次的计时器会在中途摘掉 `theme-anim` → 第二次过渡被打断。必须 `clearTimeout` 后重新计时。

### 2.3 实施时对方案的两处改良

**① 包裹点上移到「应用 class 的 effect」，而不是 `toggle()`**

原方案是把 `toggle()` 包起来。但 `setNight()` 有**三条**调用路径：手动点按钮、到点自动切换、`visibilitychange` 回到页面时纠正。只包 `toggle()` 的话，后两条依然硬跳。

上移到「`night` 变化 → 应用 class」的 effect 后，**三条路径自动全部覆盖**，而且只有一处改动点。

代价是必须用 `firstApply` ref **把首屏第一次应用排除掉** —— 首屏是「接管内联脚本已算好的状态」，不是「切换」。不排除的话，暗色用户每次刷新都会看到一次「亮→暗」渐入，直接把首屏防闪烁废掉。

**② 实现为模块级函数 + 模块级计时器**

`withThemeAnim` 和 `animTimer` 都在模块作用域，不进 hook。好处是多个 `useThemeState` 实例（理论上只该有一个）共享同一个计时器，不会出现「实例 A 的计时器摘掉实例 B 刚挂的 class」。`matchMedia` 增加了 `typeof` 守卫，兼容 SSR / 老环境。

---

## 3. POC 实测：过渡确实生效

注入上述规则后，采样 `body` 背景色随时间的变化：

```
t=5ms    rgb(250, 246, 241)   ← 亮色起点
t=48ms   rgb(246, 242, 237)
t=100ms  rgb(212, 207, 203)
t=151ms  rgb(136, 132, 128)   ← 中点
t=218ms  rgb(67, 62, 59)
t=234ms  rgb(57, 52, 49)
...（终值 rgb(23, 18, 15)）
→ 取值种类 = 23  ⇒ ✅ 真在逐帧插值
```

---

## 4. ⚠️ 性能实测：通配符会崩，必须限定选择器 + 排除 `.glass`

三种写法在**最重页面（儿歌页 1470 元素）**上的帧率：

| 方案 | 首页 257 | 故事页 366 | **儿歌页 1470** | 判定 |
|---|---|---|---|---|
| **A 现状**（无过渡） | 62fps | 63fps | 62fps | 基线 |
| **B1 通配符 `*`** | 62fps | 60fps | **30fps / 22 次卡帧** | ❌ **崩溃** |
| **B2 限定选择器 + 排除 `.glass`** | 61fps | 61fps | **61fps / 0 卡帧** | ✅ **采用** |
| B3 View Transitions API | 44fps / **280ms 卡滞** | 62fps | 57fps | ❌ 见 §7 |

### `.glass` 是性能杀手（最有价值的发现）

儿歌页每张卡片都是 `.glass`（`backdrop-filter: blur(14px)`），共 **48 个**：

```
排除 .glass → 61fps，0 卡帧
包含 .glass → 32fps，17 次卡帧
```

原因：`backdrop-filter` 需要在**每一帧重新采样背后内容**。背景在过渡 = 每一帧背后的像素都在变 = 48 个毛玻璃面板每帧重算模糊。这一条直接决定了方案能不能用。

**另外**：`.glass` 的背景是 `background-image: linear-gradient(...)`，**本来就没法过渡** —— 让它参与过渡是在花大价钱做无用功（过渡一个不可见的 `transparent`）。

### 最终方案全页面复核

| 页面 | 元素数 | `.glass` | 帧率 | 最大帧间隔 | 卡帧 |
|---|---|---|---|---|---|
| 首页 | 257 | 7 | 61fps | 18ms | 0 |
| 睡前故事页 | 366 | 17 | 61fps | 19ms | 0 |
| 儿歌页 | 1470 | 48 | 61fps | 17ms | 0 |
| 汉字页 | 1068 | 0 | **47–50fps** | 33ms | 0–2 |
| 智能推荐页 | 1887 | 3 | 61fps | 33ms | 1 |

汉字页复测 3 轮稳定 47–50fps、最大间隔 31–34ms（= 1 帧），**无肉眼可见卡顿**，可接受。

---

## 5. 会残留的「硬跳」（无法消除，需接受）

| 元素 | 为什么跳 | 处理建议 |
|---|---|---|
| **`.glass` 毛玻璃面板**（导航栏 + 儿歌 48 张卡 + 故事 17 张卡） | `backdrop-filter` 参与过渡把帧率打到 32fps | **接受跳变**。它半透明，背后背景在过渡 → 观感上仍有渐变感。替代方案见下 |
| `.bg-aurora` 全站背景的 3 层 `radial-gradient` | `background-image` 不可插值 | **无需处理**：它的 `background-color` 会过渡，渐变层 alpha 只有 0.07→0.10，肉眼无感 |
| `.paper-sheet` 纸纹 | 同上，alpha 仅 0.022 | 无需处理 |
| `.tint-*` 卡片图标底渐变 | 同上 | 小面积，可接受 |
| `color-scheme: light ↔ dark` | 浏览器原生 | 影响滚动条与原生控件；跳变可接受 |
| 滚动条 `::-webkit-scrollbar-thumb` | 伪元素不在选择器列表内 | ✅ **已加**（`html.theme-anim ::-webkit-scrollbar-thumb` 单独一条） |

**`.glass` 的三个替代方案**（都不理想，供评估）：
1. 切换期间临时 `backdrop-filter: none` → 毛玻璃会「突然变实」闪一下，**更难看**
2. 把 `.glass` 改成不透明面板 → 改变视觉设计，且失去毛玻璃质感
3. 只过渡 `.glass` 的 `border-color`（不过渡其他） → 边框渐变但面板本体跳，观感不协调

→ **建议接受**：导航栏 + 卡片直接跳，其余 90% 的元素平滑过渡，整体依然是"优雅"的。

---

## 6. 可选加分项：分层错峰

给不同层级加 0–60ms 的微小延迟，产生「色温从背景向内容流动」的呼吸感：

```css
html.theme-anim body                             { transition-delay: 0ms !important; }
html.theme-anim header, html.theme-anim nav      { transition-delay: 20ms !important; }
html.theme-anim article, html.theme-anim aside,
html.theme-anim .card-hover                      { transition-delay: 40ms !important; }
```

⚠️ 总时长会变成 `320 + 40 = 360ms`，`THEME_ANIM_MS` 要同步。延迟 >80ms 会显得拖沓散乱，**建议 ≤60ms**。

---

## 7. 备选方案：View Transitions API（不推荐做主力）

```js
document.startViewTransition(() => {
  document.documentElement.classList.toggle("site-night", next);
});
```

**优势**：浏览器对**整页做交叉淡入** —— 渐变、图片、`color-scheme` 等一切不可插值的属性**全都"过渡"了**。

**实测劣势**：
- 首页出现 **280ms 卡滞**（快照栅格化成本）
- 快照期间页面**不可交互**，快速连点会排队
- 本站 `header` 是 `position: sticky`，快照里可能视觉跳动（需 `view-transition-name` 单独处理）
- 支持度：Chrome/Edge 111+、Safari 18+、Firefox 139+ —— 覆盖率不错但非 100%，需降级分支
- 整页交叉溶解在元素位置不变时，会出现**两层半透明叠加**导致文字短暂发虚

**结论**：**不做主力**。真要加，应作为 `if (document.startViewTransition)` 的增强分支叠加在 §2 之上，但收益不抵复杂度。

---

## 8. 改动面与风险

| # | 文件 | 改什么 | 规模 |
|---|---|---|---|
| 1 | `frontend/src/index.css` | 新增 `--dur-theme` / `--ease-theme` 变量 + `html.theme-anim` 段 + reduced-motion | 约 30 行 |
| 2 | `frontend/src/common/useTheme.ts` | `toggle()` 外包 `withThemeAnim()`，含计时器重置 | 约 12 行 |
| 3 | `frontend/index.html` | **不动**（首屏不需要切换动画） | 0 |
| 4 | `backend/`、`deploy/` | **零改动** | 0 |

**风险清单：**

1. ⚠️ **常驻会废掉防闪烁** —— 必须只在切换瞬间挂 ≤360ms
2. ⚠️ **`.theme-anim` 必须与 `.site-night` 解耦**，否则反向过渡失效
3. ⚠️ **必须排除 `.glass`**，否则重页面掉到 30fps
4. ⚠️ **快速连点要重置计时器**
5. ⚠️ **`prefers-reduced-motion` 必须跳过**
6. ⚠️ `!important` 会在切换的 320ms 窗口内把按钮下压反馈从 130ms 拉长到 320ms → 已在属性列表里保留 `scale`，影响可忽略（窗口极短）

---

## 9. 结论与建议

| 项 | 建议 |
|---|---|
| 做不做 | **建议做**。成本约 40 行、纯前端、零后端改动，收益是整站观感明显提升 |
| 时长 | **320ms**（比站内卡片悬停 250ms 略长，从容但不拖沓） |
| 缓动 | `cubic-bezier(0.4, 0, 0.2, 1)`（与站内 `--ease-interact` 同族） |
| 分层错峰 | 可选，**建议先不加** —— 先看基础版效果，觉得"平"再加 |
| View Transitions | **不做** |
| 残留硬跳 | 接受 `.glass` 面板跳变；其余大面积元素（body / 文字 / 边框 / 卡片底色）都平滑 |

---

## 10. 实施与上线记录（2026-09-30）

### 改动清单（最终）

| 文件 | 改了什么 |
|---|---|
| `frontend/src/index.css` | 文件末尾新增 `:root { --dur-theme, --ease-theme }` + `html.theme-anim` 段（含 `.glass` 排除、滚动条、`prefers-reduced-motion` 降级），约 100 行含注释 |
| `frontend/src/common/useTheme.ts` | 新增 `THEME_ANIM_MS` / `ANIM_CLASS` / `animTimer` / `withThemeAnim()`；class 应用 effect 改为「首屏直应用、之后走过渡」 |
| `frontend/index.html`、`backend/`、`deploy/` | **零改动** |

选择器相比原方案补了 `ul / ol / table / th / td / strong / em / code / pre / blockquote`（常见文字容器，成本极低）。

### 生产端到端验证：**24 通过 / 1 非满分**

| # | 场景 | 结果 |
|---|---|---|
| 1 | 暗色刷新首帧 `body` 已是 `rgb(23,18,15)`、无渐入、首屏未挂 `theme-anim` | ✅ |
| 2 | 点击切换 → `theme-anim` 于 **t=2ms** 挂上；`body` 背景出现 **19 种中间取值** | ✅ |
| 3 | 80ms / 260ms 仍在过渡，520ms 已摘除 | ✅ |
| 4 | 连点后 500ms 仍在过渡（计时器已重置） | ✅ |
| 5 | 过渡窗口内 `.glass` 的 `transition-property = none`，窗口外恢复 | ✅ |
| 6 | `prefers-reduced-motion: reduce` → 不挂 `theme-anim`，颜色直接跳变 | ✅ |
| 7 | 假时钟 17:59:55 跨 18:00 → **自动边界切换也走过渡** | ✅ |
| 8 | 帧率（见下） | 见下 |

### 生产帧率实测（切换期间）

| 页面 | 元素数 | 帧率 | 最大帧间隔 | 卡帧 |
|---|---|---|---|---|
| 首页 | 268 | **62fps** | 18ms | 0 |
| 睡前故事页 | 377 | **62fps** | 18ms | 0 |
| **儿歌页** | **1481** | **62fps** | 21ms | **0** |
| 汉字页 | 1079 | 47fps | 37ms | 1 |

**关键结论**：儿歌页 1481 个元素（含 48 个 `.glass` 毛玻璃卡）在切换期间 **62fps / 0 卡帧** —— 与 §4 的「排除 `.glass` → 61fps」一致，**证明排除策略在生产规模上成立**。

汉字页 47fps 是**既有基线**（原方案 §4 记录 47–50fps，本轮复测 47fps），不是本次引入的回归；最大间隔 37ms ≈ 2 帧，无肉眼可见卡顿。其余三页均 62fps。

### 部署

- 线上：`index-BxFSlr3k.js` + `index-DCcKonyD.css` → **`index-oHQmV0_m.js` + `index-Db_1pB5i.css`**，陈旧产物自动清 2 个
- 7 条路径 + 2 个新产物全 **200**，2 个旧产物全 **404**；**服务全程未重启**，日志 0 traceback
- 公网 md5 == 本地：JS `542f5439360ec9de9f82a7d9735542e1`、CSS `02608a7dd4e00596e1aac07dc0401ec3`
- 回滚点：`/tmp/dist-prev-20260930-085803.tgz`

### 后续可选优化（未做）

- **分层错峰**（§6）：给 header / 卡片加 20–40ms 微延迟做「色温流动」感。**先不加** —— 先看基础版观感，觉得「平」再补
- 汉字页 47fps 若日后想追平：需查清是图片解码还是 SVG 量导致，与本方案无关
