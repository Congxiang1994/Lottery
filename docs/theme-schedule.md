# 主题按时段自动切换 · 方案与实施记录

> 状态：**已实施（2026-09-30）**。
> 规则：**每天 07:00–17:59 亮色，18:00–次日 06:59 暗色**（用户 2026-09-30 拍板）。
> 交互：**右上角只有亮 / 暗两档按钮**，时段只作为「默认状态」。
> 本文取代此前的「跟随日出日落」方案（见 §7 决策记录）。

---

## 0. 结论先行

| 项 | 原「日出日落」方案 | 最终「固定时段」方案 |
|---|---|---|
| 后端改动 | 新增 `geo.py` + `/api/geo` 接口 | **0** |
| 前端新增文件 | `sun.ts` 等 2 个 | **0** |
| 前端改动点 | 6 处 | **3 处** |
| 基础设施 | 需在 CF 后台开托管转换 | **0** |
| 需要位置/网络 | 是（经纬度、IP 定位） | **否，用浏览器本地时间** |
| 算法 | NOAA 天文模型（约 30 行） | **一行比较** |
| 你要做的操作 | 去 CF 后台点开关 | **无** |

**核心判断只有一行：**

```ts
const h = new Date().getHours();
const night = h < 7 || h >= 18;
```

> 💡 关键点：`new Date()` 取的是**浏览器本地时间**，天然就是用户所在时区的「墙上时间」。
> 所以**不需要**知道经纬度、不需要时区换算、不需要联网——这也是「日出日落」方案下最麻烦的那部分。

---

## 1. 交互设计：两档按钮 + 时段默认（本文档的核心变更）

### 1.1 为什么不是三档

初版曾把「自动」做成按钮的第三档（`auto → day → night` 循环）。**这是错的**，用户当场指出：

> 「右上角的切换模式按钮，咋有 3 档了？不应该就只有亮色和暗色两档吗？」

判断：**自动逻辑属于默认值，不该占用按钮档位。** 按钮的语义是「我要亮 / 我要暗」，
不应该让用户为了「回到自动」而在三档之间循环——那是把实现细节暴露给了用户。

### 1.2 最终形态

| 层级 | 行为 |
|---|---|
| **默认** | 按时段：07:00–17:59 亮色，其余暗色 |
| **按钮** | 只有两档，点一下切到另一档（亮 ⇄ 暗），图标 / 提示随当前档位变 |
| **手动选择** | 只对**当前时段**有效，写入带到期时间的覆盖，到下一个时段边界自动失效 |
| **恢复自动** | 无需操作，到点自动回到时段默认 |

覆盖记录结构：

```json
{ "v": "day" | "night", "until": <到期时间戳> }
```

`until` = **下一个时段边界**（今天 7:00 / 今天 18:00 / 明天 7:00）。

举例：上午 10:00 手动切到暗色 → `until` = 今天 18:00；到 18:00 后该覆盖失效，
恰好好此时段本身就是暗色，用户无感；次日 7:00 自动回亮。

> 这么设计的好处：一次误点不会**永久**关掉自动行为，最多影响一个时段。

---

## 2. 要改的地方（3 处，全在前端）

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `frontend/index.html` | 内联脚本：渲染前按时段算 night，再叠加有效覆盖 |
| 2 | `frontend/src/common/useTheme.ts` | 重写为「时段默认 + 覆盖到期」；含 `setTimeout` 精确定时与 `visibilitychange` 兜底 |
| 3 | `frontend/src/common/Nav.tsx` | 保持原有的两档按钮（`Sun` / `Moon`），不引入第三档图标 |

### 改动 1：`index.html` 内联脚本

```js
(function () {
  try {
    var h = new Date().getHours();
    var night = h < 7 || h >= 18;              // 1) 先按时段算
    var raw = localStorage.getItem("site_theme_override");
    if (raw) {                                  // 2) 再叠加未过期的覆盖
      var o = JSON.parse(raw);
      if (o && (o.v === "day" || o.v === "night")
          && typeof o.until === "number" && Date.now() < o.until) {
        night = o.v === "night";
      }
    }
    if (night) document.documentElement.classList.add("site-night");
  } catch (e) {}
})();
```

仍然是**渲染前同步执行**，所以**刷新不会闪白**——这一点和现在一样，不需要额外处理。

### 改动 2：`useTheme.ts` 核心逻辑

```ts
const OVERRIDE_KEY = "site_theme_override";
export const DAY_START = 7;
export const DAY_END = 18;

/** 纯时段判断（不含手动覆盖） */
export function isNightByClock(d = new Date()): boolean {
  const h = d.getHours();
  return h < DAY_START || h >= DAY_END;
}

/** 下一个时段边界：今天 7 点 / 今天 18 点 / 明天 7 点 */
export function nextBoundary(d = new Date()): Date {
  const t = new Date(d);
  const h = d.getHours();
  if (h < DAY_START) t.setHours(DAY_START, 0, 0, 0);
  else if (h < DAY_END) t.setHours(DAY_END, 0, 0, 0);
  else { t.setDate(t.getDate() + 1); t.setHours(DAY_START, 0, 0, 0); }
  return t;
}

/** 有效覆盖优先，否则按时段 */
function computeNight(): boolean {
  const ov = readOverride();          // 已过期 / 非法 → null
  return ov ? ov === "night" : isNightByClock();
}
```

hook 关键部分：

- **应用 class**：`document.documentElement.classList.toggle("site-night", night)`（与现在一致）
- **定时**：`setTimeout` 精确定时到 `nextBoundary()`，到点重算并重新 `arm()`
- **`visibilitychange`**：回到页面时重算（覆盖电脑睡眠导致的定时器漂移）
- **`toggle()`**：写入覆盖 + `setNight(!night)`，覆盖有效期到下一个边界
- 返回 `{ theme, night, manual, toggle }`，其中 `manual` 标记是否处于手动状态（供 UI 参考）

> 用「定时到精确边界」，不用 `setInterval` 轮询：省电，且切换时刻不漂移、不滞后。

### 改动 3：`Nav.tsx` 两档按钮

```tsx
<button
  onClick={toggle}
  title={night ? "切换到亮色" : "切换到暗色"}
  className="ml-1 grid h-9 w-9 place-items-center rounded-lg border border-paper-200 ..."
>
  {night ? <Sun size={15} /> : <Moon size={15} />}
</button>
```

> ⚠️ 不要引入 `SunMoon` 图标，也不要加「自动」小圆点——那会让用户以为存在第三档。

---

## 3. 明确**不用**改的地方

改动面小，主要靠这部分证明：

| 文件 | 为什么不用改 |
|---|---|
| `frontend/src/index.css` 的 `.site-night` 段（约 160 行） | 机制不变，仍是 `<html>` 挂 class，CSS 白名单映射照旧生效 |
| `frontend/src/story/parts.tsx` 的 `useNightMode()` | 用 `MutationObserver` 监听 `<html>` class 变化 → **自动切换时它照常感知**，无需改动 |
| `frontend/src/common/Modal.tsx`、`State.tsx` | 仅注释提及 `site-night`，无逻辑依赖 |
| `frontend/src/App.tsx` | 只是 `ThemeCtx.Provider` 透传，类型自动跟随 |
| `backend/` 整个目录 | **零改动**（不新增接口、不碰数据库） |
| `deploy/nginx.conf` | **零改动** |

---

## 4. 边界情况

| 情况 | 处理 |
|---|---|
| 页面开着跨过 18:00 | 定时器到点自动切，无需刷新 |
| 电脑睡眠 / 切走标签页 | 回来时 `visibilitychange` 重算，立即纠正 |
| 跨日（如 23:59 → 次日） | `nextBoundary()` 返回「明天 7:00」，自动接续 |
| 首次访问（无 localStorage） | 按当前时间判断 —— 这正是「默认」的含义 |
| 用户在上午手动切暗 | 覆盖有效至当天 18:00，之后自动回到时段逻辑 |
| 用户在 18:00 后手动切亮 | 覆盖有效至次日 7:00（跨越整段夜间） |
| 本机时钟不准 | 按用户看到的本地时间为准（符合直觉） |
| 存量用户（有旧键 `site_theme`） | **忽略**，统一回到时段默认（见 §6.3） |

已实测验证的边界（本地时间）：

```
06:59  暗色 🌙   下一切换点 09/30 07:00
07:00  亮色 ☀️   下一切换点 09/30 18:00
17:59  亮色 ☀️   下一切换点 09/30 18:00
18:00  暗色 🌙   下一切换点 10/01 07:00
23:59  暗色 🌙   下一切换点 10/01 07:00
00:00  暗色 🌙   下一切换点 09/30 07:00
```

覆盖有效期实测：

```
06:00 切换 → 有效至 07:00
08:00 切换 → 有效至 18:00
18:00 切换 → 有效至 次日 07:00
```

一致性回归：模拟时钟 24 组 ×（含覆盖 / 过期）共 30 组用例，与 `index.html` 内联脚本判定**全部一致**。

---

## 5. 暗色起点定在 18:00 的理由

原建议 19:00，用户拍板 **18:00**。理由：

- `/story` 睡前故事时段通常在 **18:00–18:30**
- 若暗色起点 19:00 → 孩子看故事时页面还是亮的，与「睡前」氛围不符
- 18:00 起切暗，正好覆盖睡前时段

| 方案 | 亮色区间 | 睡前故事时段（18:00–18:30） |
|---|---|---|
| 原先建议 | 07:00–18:59 | 亮色 ☀️ |
| **最终采用** | 07:00–17:59 | 暗色 🌙 |

---

## 6. 注意事项

1. **两处必须同步**：`index.html` 内联脚本与 `useTheme.ts` 的阈值 / 覆盖规则改动要一起改，
   否则会出现「首屏 class 与 React 状态打架」的闪烁。
2. **`prefers-color-scheme` 不参与判断**。若把系统配色也作为输入，逻辑会变成「时间 OR 系统」的叠加规则，
   可解释性变差——**不建议**加。真加了也该是独立第四态。
3. **旧键 `site_theme` 不迁移**（用户拍板）。新键是 `site_theme_override`，旧键被忽略 → 默认回到时段逻辑。
4. **阈值写常量**，别散在代码里：`DAY_START = 7`、`DAY_END = 18`，方便日后调。

---

## 7. 决策记录：为什么放弃「日出日落」

前一版方案（`docs/sunrise-sunset-theme.md`，已删除）调研结论摘要，供日后回看：

| 结论 | 详情 |
|---|---|
| 算法本身可行 | NOAA 简化模型，内核 984 字符 / gzip 478 字节，实测南京误差 ≤2 分钟 |
| **卡点在位置** | 位置来自 HTTP 请求头，浏览器 JS 读不到 → 与「首屏不闪烁」天然冲突 |
| CF 能提供位置 | 实测 `cf-connecting-ip` 已透传，但 `cf-iplatitude` 等为空 → 需去 CF 后台开「Add visitor location headers」开关（免费，但我无法代做） |
| 精度要求不高 | 切换误差 ≤15 分钟用户无感；但时区兜底最坏 132 分钟，不可当主力 |
| **最终取舍** | 精度收益（日出日落 vs 固定时段，差 1–2 小时）**换不来**位置获取、缓存时间戳、跨日重算这一整套复杂度 → 改用固定时段 |

一句话：**天文精度对这个用途是过剩的**，固定时段够用且好维护。

---

## 8. 需求演进时间线（2026-09-30）

| 阶段 | 需求 | 结果 |
|---|---|---|
| 1 | 按日出日落决定主题 | 出方案，调研 NOAA 算法 + CF 地理头；因位置获取与首屏同步冲突而搁置 |
| 2 | 简化为固定时段 07:00–19:00 | 出改动清单；但按钮被做成三态循环 |
| 3 | 拍板：留手动开关 / 暗色起点 18:00 / 旧键不迁移 | 实施三态版并部署 |
| 4 | 反馈：按钮不该有三档 | **重构为两档按钮 + 覆盖到期**，本文档即最终形态 |
