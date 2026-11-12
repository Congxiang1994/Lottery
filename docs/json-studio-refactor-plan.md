# JSON 工具重构方案 · 对标 JsonStudio

> 状态：**方案待评审，未开发**。确认后再进入阶段 1。
> 日期：2026-11-12 · 目标：`/tools` 的 JSON 标签页
> 对标来源：[sundegan/JsonStudio](https://github.com/sundegan/JsonStudio)（[官网](https://jsonstudio.js.org/zh/)）

---

## 0. 结论先行

| 判断 | 结论 |
|---|---|
| 是否照搬 JsonStudio 全部功能 | **不照搬桌面独占能力**，把「数据处理内核 + 视图联动 + 输入兼容」全量引入 |
| 是否引入 Monaco | **否**。真实按需 0.7–1.1 MB gzip，是现有 `/tools` chunk（11.3 KB gzip）的 60–100 倍，会废掉首屏优化 |
| 编辑器替代 | **CodeMirror 6**（minimal ~75 KB / 全功能 ~135 KB gzip），懒加载成独立 chunk |
| 新增依赖总量 | **≈ 200–260 KB gzip**（自研代码生成 + CodeMirror minimal），全部不进首屏 |
| 代码生成 | **自研渲染层**覆盖 TS/Go/Python/Java/Rust，不引 quicktype-core（312 KB + `node:fs` 浏览器坑） |
| 落地方式 | 拆 5 个阶段，每阶段走「自检 → 部署 → 端到端验证 → commit + push」完整交付链 |

---

## 1. 现状盘点

### 1.1 本地实现（实测）

| 维度 | 现状 | 出处 |
|---|---|---|
| 输入 | 单个 textarea，`localStorage["tools_json"]` 持久化 | `JsonTool.tsx` |
| 输出 | 只读 textarea / 错误卡（中文报错 + 行列定位 + 出错行箭头） | `JsonTool.tsx:268-300` |
| 选项 | 格式化·压缩 / 2·4 空格 / 键名排序 | `JsonTool.tsx:135-174` |
| 转义 | `jsonEscape.ts` 纯函数，成对可往返，带 6s 撤销条 | `jsonEscape.ts` |
| 解析 | `JSON.parse` 一把梭，错误正则翻译 | `JsonTool.tsx:36-77` |
| 自测 | 38 条纯函数用例，0 失败 | `scripts/test-tools.mjs` |
| 审计 | 7 条 UI 一致性规则，0 违规 | `scripts/audit-ui.mjs` |
| 体积 | `/tools` chunk **11.3 KB gzip**；全站 JS **366 KB gzip** | `dist/assets/` 实测 |
| 路由 | `React.lazy` 懒加载，用户点进 `/tools` 才下载 | `App.tsx:45` |
| 拆包 | `vendor-react` / `vendor-chart` / `vendor-md` 三组 manualChunks | `vite.config.ts` |
| 主题 | 全站 `.site-night` 亮/暗**两档**，按本地时段自动切换 | `common/useTheme.ts` |
| 色板 | `paper-*` 米白系 + 品牌红/金，UI token 集中在 `common/ui.ts` | `frontend-standards.md` |

### 1.2 JsonStudio 能力清单（官网 + changelog + package.json 核实）

JsonStudio 是 **Tauri 2 + Svelte 5 + Monaco** 桌面应用，非 React。其「优秀功能」分三类：

**A. 数据内核（纯计算，Web 版可 1:1 复刻，价值最高）**
统一输入兼容（严格 JSON / JSON5 / JSONC / 转义 JSON / 可修复片段 / JSONL·NDJSON / 日志混合文本）、大整数无损、格式化与键名排序、`snake_case↔camelCase`、JSON 统计、JMESPath / JSONPath / JSON Pointer 查询、结构化 Diff、格式双向转换、Schema 生成与校验（Draft 7）、类型代码生成与反向提取、日志片段提取。

**B. 视图与交互（Web 版可复刻，需重写 UI）**
Monaco 编辑器（高亮 / 括号配对 / 折叠 / minimap / 查找替换 / 多光标）、Tree 与 Grid 三视图联动（双击编辑、拖拽调结构、复制路径、单元格编辑、光标联动定位）、并排 Diff（同步滚动 / 绿红黄 / 统计 / 内联编辑）、分屏 Schema / 转换 / 代码生成视图、JSONL 查看器（逐行统计 / 筛选 / 分页 / 展开预览）、CSV 彩虹列、图片导出。

**C. 桌面独占（Web 版无法复刻，不照搬）**
全局系统级快捷键、系统文件关联与双击打开、本地文件自动保存与外部修改监听、窗口置顶、原生窗口菜单、Rust 原生渲染图片导出、10+ 编辑器主题、双语 i18n、应用自动更新、单实例多窗口。

### 1.3 关键边界行为（changelog 里反复打磨，必须一并抄）

| 边界 | JsonStudio 做法 |
|---|---|
| key 顺序 | 格式化**默认保留原始顺序**，不排序（v1.2.0 修复） |
| 大整数 | 解析/格式化/压缩/Tree/Grid/JSONL/日志/转换/复制/导出**全链路无损**，覆盖 JSON5 十六进制与整数指数形式（v1.5.0） |
| 重复 key | 严格 JSON 保留重复 key；结构化视图展示；结果有歧义时阻止不安全编辑（v1.3.0） |
| 异步竞态 | 粘贴自动格式化、查询、远程校验均防「旧结果覆盖新输入」（v1.2.0 / v1.5.0） |
| 行尾与 BOM | CRLF/混合行尾、UTF-8/UTF-16 BOM 不导致源码定位偏移（v1.5.0） |
| 转换安全 | 目标格式无法安全表示整数/类型时**明确报错**，不静默丢精度（v1.5.0）；CSV 混入非对象直接报错（v1.4.0） |
| 日志提取 | **原文保持不变**，提取结果在独立面板展示；避免把独立转义 JSON 误判为日志（v1.2.0 / v1.3.0） |
| 存储上限 | 单 tab localStorage 1 MB（v1.0.0） |

---

## 2. 五条关键取舍（附证据）

### 2.1 不引 Monaco —— 体积与主题双重冲突

| 项 | 数字 |
|---|---|
| Bundlephobia 标注 monaco-editor@0.57.0 | 27.9 KB gzip（**误导**：只测了 2.7 KB 的 AMD 壳文件） |
| tarball 实测核心 chunk | `editor-BdtEMBbM.js` 2,472,349 B → **gzip 620,304 B**；`editorWorkerHost` **110,803 B**；CSS **127,919 B** |
| ESM 按需（只引 editor.api + json.contribution） | 依赖图 **704 个 .js / 7.36 MB 原始**，估 **0.7–1.1 MB gzip**（估计值，非实测 bundle） |
| 额外成本 | 必须配 `MonacoEnvironment.getWorker` 单独打 worker；`@monaco-editor/react` 默认从 jsdelivr CDN 拉，离线/内网需改 `loader.config` |
| 与本站冲突 | `App.tsx` 顶部记录：15 个静态路由曾打出 1.24 MB bundle、首屏 JS 4.16 s，才做了 lazy + manualChunks；Monaco 自带配色体系与全站 `paper` 色板 / `.site-night` 两档主题打架 |

**替代：CodeMirror 6。** 官方 bundle 文档：minimalSetup ~250 KB / **gzip ~75 KB**；basicSetup + 语言模式 ~400 KB / **gzip ~135 KB**。所需能力齐全：`@codemirror/lang-json`（高亮/语法）、`@codemirror/language` 的 `foldGutter()`/`foldKeymap`（折叠）、`@codemirror/search`（查找替换）、`@codemirror/commands`（defaultKeymap/history）。`react-simple-code-editor + prismjs`（合计 ~10.5 KB）只能做高亮，**做不到折叠与查找替换**，不选。

> 体积不是首屏问题：`/tools` 本身是 lazy 路由，CodeMirror 再大也不进首屏；但它是主线程常驻内存与交互卡顿的来源，且 75 KB 已是现有 Tools chunk 的 6.6 倍，故仍取 minimal 档。

### 2.2 纯函数内核优先，接进既有自测体系

所有数据处理落 `src/tools/json/*.ts`（无 React / 无 DOM / 无 `localStorage`），扩展 `scripts/test-tools.mjs`。符合项目硬规则：断言失败非 0 退出、**注入式验证**（故意注入必失败项证明断言有效）、空输入不算成功。现有 38 条用例（尤其 8 组转义往返）作为回归基线全保留。

### 2.3 代码生成自研，不引 quicktype-core

| 方案 | gzip | 风险 |
|---|---|---|
| quicktype-core@26.0.0 | **312.4 KB** | 依赖 `readable-stream`/`urijs` 等 13 个；issue #2763 报 Vite 下 `UnhandledSchemeError: Reading from "node:fs"`；须懒加载 + Worker + 实测 polyfill |
| json-to-ts@2.1.0 | 27.0 KB | 只出 TypeScript interface |
| **自研 schema 推断 + 模板渲染** | **≈ 10–20 KB** | 覆盖 TS/Go/Python/Java/Rust 5 种；类型合并、可空性、嵌套结构需自己写，但输入模型规整可控 |

选**自研**（用户主力语言 Python + 前端 TS，5 种足够）；反向代码提取（TS/Go/Rust → JSON）放 P2，JsonStudio 用 Tree-sitter AST 才做对，Web 版先做正则 + 括号平衡的有限子集并明确标注「尽力而为」。

### 2.4 Schema 校验不用 ajv

ajv@8.20.0 虽已修好 `node:url` 打包问题，但默认 `new Function` 编译 → 严格 CSP 下挂，且 CJS 互操作 tree-shaking 弱。改用 **`@cfworker/json-schema` 4.1.6（6.6 KB gzip，纯 ESM、无 eval、支持 draft 4/7/2019-09/2020-12）**；生成侧用 `genson-js` 0.0.8（1.8 KB，支持多份样本合并）。

### 2.5 XML / CSV 明确「有损」，不承诺无损往返

这是**数据模型问题不是库问题**：XML 有 attributes / 有序重复子元素 / mixed content / 命名空间 / CDATA，JSON 只有「唯一键对象 + 有序数组」；`fast-xml-parser` 官方 issue #284 即往返结果错误实证。CSV 是二维表，Papa Parse issue #266 明确不支持嵌套对象数组。

**产品约定**：JSON→XML 限定「规范化子集」（`@` 属性前缀 / `#text` 文本 / 数组统一）；JSON↔CSV 限定「对象数组 ↔ 平铺表」，嵌套值 `JSON.stringify` 入单元格；UI 明示「有损」；类型/大整数无法安全表示时**报错而非静默转换**（对齐 JsonStudio v1.5.0）。

---

## 3. 目标架构

### 3.1 目录

```
frontend/src/tools/
├── JsonTool.tsx                 # 壳：模式切换 + 工具栏 + 多标签 + 状态编排
├── jsonEscape.ts                # 保留不动（已验证的成对往返）
├── json/                        # 纯函数内核：无 React / 无 DOM
│   ├── parse.ts                 # 统一入口：严格/JSON5/JSONC/修复/转义/JSONL/日志
│   ├── lossless.ts              # 大整数无损 + 显示串/编辑串转换策略
│   ├── format.ts                # 格式化/压缩/缩进/键名排序/键名风格
│   ├── query.ts                 # JMESPath / JSONPath / JSON Pointer
│   ├── diff.ts                  # 结构化 diff + 文本 diff
│   ├── convert.ts               # YAML/XML/TOML/CSV/Properties/INI/MD Table
│   ├── schema.ts                # 生成 + 校验
│   ├── codegen.ts               # TS/Go/Python/Java/Rust
│   ├── stats.ts                 # 键数/深度/字节/行数
│   └── extract.ts               # 日志混合文本片段提取
├── json/views/                  # React 视图层（按模式 lazy）
│   ├── SourceView.tsx           # CodeMirror 6（懒加载）
│   ├── TreeView.tsx             # 可编辑树 + 拖拽 + 复制路径 + 虚拟滚动
│   ├── GridView.tsx             # 对象数组表格 + 单元格编辑
│   ├── DiffView.tsx / ConvertView.tsx / SchemaView.tsx
│   ├── CodegenView.tsx / JsonlView.tsx / ExtractPanel.tsx
│   └── QueryBar.tsx
└── json/theme.ts                # CodeMirror 主题：读全站 CSS 变量，跟随 .site-night
```

### 3.2 状态模型（唯一真源 = 文本）

```
JsonDoc = { id, title, text, mode, dirty, pinned }
  ↓ parse(text) → ParsedDoc { value, kind, errors, losslessMap, fragments }
  ↓ 所有视图（Tree/Grid/Diff/Schema/Convert/Codegen/Query）从 ParsedDoc 派生
  ↓ 视图编辑 → 回写 text（保持源码唯一真源）→ 重算 ParsedDoc
```

- **多标签**：内存数组 + localStorage 持久化；单文档 >1 MB 时降级为「不持久化 + 角标提示」（对齐 JsonStudio 1 MB 上限）。
- **异步竞态**：所有异步结果（粘贴自动格式化、查询、校验、远程）带 `doc.version` / `AbortController`，旧版本结果直接丢弃。
- **大整数**：`lossless-json` 的 `LosslessNumber` 贯穿全链路；统一策略「取值时转显示串、编辑时保留原串」，避免任何一处 `.toJSON()` 提前降级。

### 3.3 拆包策略

- **不新增「所有 JSON 功能共用」的 manualChunks 组** —— 这正是 `App.tsx` 注释里反对的：只被某视图用的重依赖不该进所有页面都得下的公共块。
- 每个 P1 视图 `React.lazy`，重依赖随视图走（ConvertView 带 fast-xml-parser、SchemaView 带 cfworker、CodegenView 带模板）。
- **CodeMirror 单独成 `vendor-cm`**：内容稳定、体积最大、复用率最高，改业务代码不换 hash。
- 进入 JSON tab 只下载「内核 + SourceView」≈ **100 KB gzip**；切到 Diff/转换/Schema 才追加各自 chunk。

---

## 4. 功能矩阵（JsonStudio 优秀功能 → Web 版落法）

优先级：**P0** = 内核重构 + 高频刚需；**P1** = 官网单独开子页的 6 个主推功能；**P2** = 差异化增强。

| # | 功能 | JsonStudio 做法 | Web 版方案 | 依赖 | 优先级 |
|---|---|---|---|---|---|
| 1 | 统一解析管线 | JSON/JSON5/JSONC/转义/可修复/JSONL/日志 | `parse.ts` 分级探测 + 明确标注命中类型 | json5 / jsonrepair / jsonc-parser / 自研 | **P0** |
| 2 | 大整数无损 | 全链路 LosslessNumber | `lossless.ts` + 显示/编辑串策略 | lossless-json | **P0** |
| 3 | 中文错误定位 | 行号 + 描述 | 保留并增强：多错误、点击跳转、CRLF/BOM 修正 | 自研 | **P0** |
| 4 | 格式化 / 压缩 | 2/4/Tab、保留 key 顺序 | 保留现有选项 + Tab + 默认不排序 | 自研 | **P0** |
| 5 | 键名风格转换 | snake↔camel 递归 | `format.ts` 一键切换 + 撤销 | change-case 或自研 | **P0** |
| 6 | 源码编辑器 | Monaco（高亮/折叠/minimap/查找替换/多光标） | CodeMirror 6 minimal + 自定义主题 | codemirror 6 系列 | **P0** |
| 7 | JSON 统计 | 键数/深度/字节/行数 | 状态条实时显示 | 自研 | **P0** |
| 8 | 多标签 | 拖拽排序/复用/重命名/未保存提示 | 内存多文档 + 复用空文档 + 角标 dirty | 自研 | **P0** |
| 9 | 文件工作流 | 拖拽打开/保存/另存为 | FileReader 拖拽 + Blob 下载导出 + 复制 | 浏览器原生 | **P0** |
| 10 | 转义/反转义 | 成对工具 | **保留现有实现**（已验证） | — | **P0** |
| 11 | 粘贴自动格式化 | 异步 + 竞态保护 | 粘贴探测 + version 校验 | 内核 | **P0** |
| 12 | Tree 视图 | 双击编辑 key/value、拖拽、复制路径/值、光标联动 | 自研树 + 虚拟滚动 + 复制路径 | @tanstack/react-virtual | **P1** |
| 13 | Grid 视图 | 对象数组→表格、单元格编辑、与源码同步 | 自研表格 + 类型保留 | 内核 | **P1** |
| 14 | 查询 | JMESPath / JSONPath / JSON Pointer，高亮匹配+祖先 | 查询栏 + 模式切换 + 结果高亮 | jsonpath-plus 10.3.x / jmespath | **P1** |
| 15 | Diff | 并排同步滚动、绿/红/黄、统计、内联编辑 | DiffView + 结构化 diff（按 key 对齐） | diff 9 / @sanity/diff-match-patch | **P1** |
| 16 | 格式转换 | YAML/XML/TOML/CSV + Properties/INI/MD Table 双向 | ConvertView + 明确「有损」标注 | js-yaml/browser / fast-xml-parser / smol-toml / papaparse | **P1** |
| 17 | Schema | Draft 7 生成 + 校验、行号错误、tooltip | SchemaView 分屏 + 错误定位 | @cfworker/json-schema / genson-js | **P1** |
| 18 | 代码生成 | TS/Go/Python/Java/Rust/C#/Swift/Kotlin，可编辑后复制 | CodegenView 5 语言 + 一键复制 | 自研模板 | **P1** |
| 19 | JSONL 查看器 | 逐行统计/筛选/分页/展开/保持每行一条 | JsonlView | 内核 | **P1** |
| 20 | 日志提取 | 混合文本多片段、原文不变、独立面板 | ExtractPanel + 多语言打印格式识别 | 自研 | **P2** |
| 21 | 图片导出 | Rust 原生渲染 | html-to-image 导出高亮 JSON 图 | html-to-image | **P2** |
| 22 | 反向代码提取 | Tree-sitter AST → JSON | 有限子集 + 「尽力而为」标注 | 自研 | **P2** |
| 23 | 快捷键 | 全局 + 应用内可自定义 | 应用内快捷键 + 帮助面板 | 自研 | **P2** |
| 24 | 远程 Schema | 加载 `$schema` HTTPS，限制响应大小 | **建议不做**（CORS）；需要则加 FastAPI 代理端点 | — | P2/不做 |
| 25 | 自动保存 | 文件型标签落盘 | localStorage 天然持久化 + 手动导出文件 | 已有 | 等价替代 |
| 26 | 10+ 主题 / i18n | Dracula/Nord/One Dark、中英双语 | 跟随全站 `.site-night` 两档；站点本就中文 | — | 等价替代 |

**明确不做**：全局系统级快捷键、系统文件关联与双击打开、外部文件修改监听、窗口置顶、原生窗口菜单、Rust 原生图片渲染、编辑器多主题、双语切换、应用自动更新、单实例多窗口。

---

## 5. 依赖选型（版本 / 体积 / License / 坑）

体积为 Bundlephobia min+gzip（含依赖），实测采集于 2026-11-12。

| 用途 | 包 | 版本 | gzip | License | 关键约束 |
|---|---|---|---|---|---|
| JSON5 | json5 | 2.2.3 | 9.2 KB | MIT | 近 4 年未发布但稳定 |
| JSON 修复 | jsonrepair | 3.15.0 | 3.0 KB | ISC | 原生 ESM |
| 大整数 | lossless-json | 4.3.3 | 3.7 KB | MIT | JsonStudio 同款 4.3.1 |
| 容错解析 | jsonc-parser | 3.3.1 | 6.6 KB | MIT | VS Code 同款 |
| 编辑器 | codemirror 6 + lang-json + search + commands | 6.0.2 | 75–135 KB | MIT | minimal 档；自定义主题对齐全站色板 |
| JSONPath | jsonpath-plus | **锁 10.3.x** | 8.8 KB | MIT | <10.3.0 有 RCE（CVE-2025-1302）；11.x 要求 Node≥22 且放弃旧浏览器；禁 `eval:'native'` |
| JMESPath | jmespath | 0.16.0 | 6.0 KB | Apache-2.0 | 官方停更，社区版 `@jmespath-community/jmespath` 为 MPL-2.0（弱 copyleft，暂不选） |
| Diff | diff | 9.0.0 | 7.9 KB | BSD-3 | 即 jsdiff 正规包（`jsdiff` 是 2014 年占位包，勿用） |
| YAML | js-yaml/browser | 5.5.0 | 18.3 KB | MIT | 显式用 `js-yaml/browser` 产物；`yaml@2.9.1` 31.3 KB 备选 |
| XML | fast-xml-parser | 5.12.0 | 24.6 KB | MIT | 往返有损，UI 明示 |
| TOML | smol-toml | 1.9.1 | 5.6 KB | BSD-3 | 活跃、体积最小 |
| CSV | papaparse | 5.7.1 | 6.8 KB | MIT | 嵌套不支持，限定对象数组；`escapeFormulae` 防注入 |
| Schema 校验 | @cfworker/json-schema | 4.1.6 | 6.6 KB | MIT | 无 eval / 无 Node 内置 / 多 draft |
| Schema 生成 | genson-js | 0.0.8 | 1.8 KB | Apache-2.0 | 零依赖、支持多样本合并 |
| 虚拟滚动 | @tanstack/react-virtual | 3.14.26 | 10.3 KB | MIT | headless，配合自研树 |
| 图片导出 | html-to-image | 1.11.13 | 5.3 KB | MIT | CORS/Safari 字体坑，需内嵌字体 |
| 代码生成 | **自研** | — | ≈ 10–20 KB | — | 不引 quicktype-core（312 KB） |
| 合计（不含 CodeMirror） | | | **≈ 125 KB** | | |
| 合计（含 CodeMirror minimal） | | | **≈ 200 KB** | | |
| 合计（含 CodeMirror 全功能） | | | **≈ 260 KB** | | |

**对照基线**：现有 `/tools` 11.3 KB gzip → 新增后约 200–260 KB，但 `/tools` 是 lazy 路由，首屏 chunk **不变**；进入 JSON tab 首载约 100 KB。

---

## 6. 分期计划

| 阶段 | 范围 | 交付物 | 验收 |
|---|---|---|---|
| **0** | 方案评审 | 本文档 | 用户确认 |
| **1** | 内核重构 | `json/` 全部纯函数 + 自测扩到 ~120 条（含注入式验证） | 现有 UI 行为零回归；38 条原用例全绿；audit-ui 0 违规 |
| **2** | 编辑体验 | CodeMirror 6 懒加载 + 多标签 + 统计条 + 文件拖拽 + 键名风格 + 粘贴自动格式化 | 体积基线对比；`.site-night` 切换下编辑器配色正确 |
| **3** | 可视化 | Tree + Grid + 查询栏，三视图联动 | 大整数 / 重复 key / 深层嵌套用例通过 |
| **4** | 工具箱 | Diff / 转换 / Schema / 代码生成 / JSONL，各视图独立 lazy | 有损转换提示、类型报错、异步竞态用例通过 |
| **5** | 差异化 | 日志提取 / 图片导出 / 应用内快捷键 | 混合日志多片段、CORS 降级验证 |

每阶段走完整交付链（项目硬规则）：

```
cd frontend && node scripts/audit-ui.mjs && npm test && npx tsc --noEmit && npm run build
→ 记录 chunk gzip 与基线对比
→ npm run build 生成 dist → rsync 到 124.222.39.15:/opt/lottery/
→ md5 比对确认落位（不信退出码）→ 真实环境端到端验证
→ commit + push（不问）
→ 收尾：job_list 清后台进程 / 清 /tmp 与工作区临时产物 / 报清理 MB
```

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| CodeMirror 主题与全站 `paper` 色板 / `.site-night` 不一致 | `json/theme.ts` 用 `EditorView.theme` 读 CSS 变量，随 `.site-night` 变化重配；不用自带暗色主题 |
| LosslessNumber 渗透不全导致某处丢精度 | 全链路统一「显示串 / 编辑串」策略；自测注入 `>2^53` 整数覆盖 parse→format→Tree→Grid→query→convert→codegen→copy 每条路径 |
| XML/CSV 静默丢数据 | UI 明示「有损」；类型/大整数不安全时报错；CSV 混入非对象直接报错（对齐 JsonStudio v1.4.0） |
| jsonpath-plus RCE | 锁 10.3.x、禁 `eval:'native'`；上线前 `npm audit` |
| 异步竞态（旧结果覆盖新输入） | `doc.version` + `AbortController`，注入延迟用例验证 |
| localStorage 1 MB 溢出 | 超阈值降级不持久化 + 角标提示；`try/catch` 包所有写入 |
| 远程 Schema CORS | 默认不做；确需则加 FastAPI 代理端点（服务器有 Python 3.14，无 Node）并限制响应大小 |
| 新增依赖拖慢构建 / 冲掉 manualChunks | 每阶段 build 后对比 chunk 表；`vendor-cm` 单独成块保证业务迭代不换 hash |

---

## 8. 参考来源

- [sundegan/JsonStudio](https://github.com/sundegan/JsonStudio) · [README](https://raw.githubusercontent.com/sundegan/JsonStudio/main/README.md) · [package.json](https://raw.githubusercontent.com/sundegan/JsonStudio/main/package.json)
- [官网首页](https://jsonstudio.js.org/zh/) · [格式化](https://jsonstudio.js.org/zh/json-formatter) · [Tree/Grid](https://jsonstudio.js.org/zh/json-tree-grid-view) · [Diff](https://jsonstudio.js.org/zh/json-diff) · [转换](https://jsonstudio.js.org/zh/json-converter) · [Schema](https://jsonstudio.js.org/zh/json-schema) · [代码生成](https://jsonstudio.js.org/zh/code-generator) · [changelog](https://jsonstudio.js.org/zh/changelog)
- [CodeMirror bundle size](https://codemirror.net/examples/bundle/) · [Monaco ESM 集成](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)
- [ajv CSP](https://ajv.js.org/standalone) · [ajv #2446 node:url 破坏浏览器打包](https://github.com/ajv-validator/ajv/issues/2446) · [quicktype #2763 node:fs](https://github.com/glideapps/quicktype/issues/2763)
- [CVE-2025-1302 jsonpath-plus RCE](https://nvd.nist.gov/vuln/detail/cve-2025-1302) · [fast-xml-parser #284 往返](https://github.com/NaturalIntelligence/fast-xml-parser/issues/284) · [PapaParse #266 嵌套](https://github.com/mholt/PapaParse/issues/266)
- [react-json-view #441 React 18 不兼容](https://github.com/mac-s-g/react-json-view/issues/441) · [Prism #1442 折叠未实现](https://github.com/PrismJS/prism/issues/1442)

> 注：[官网](https://jsonstudio.js.org/zh/)页脚写「MIT 许可证」，[package.json](https://raw.githubusercontent.com/sundegan/JsonStudio/main/package.json) 写 `Apache-2.0`。本方案只做功能对标、不复制其源码，许可证差异不影响；若将来真引用代码需先核实。
