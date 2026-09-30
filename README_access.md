# 访问管理（Access）· 需求与实现文档

> 2026-09-30 上线。一句话：门户里加一个**密码保护的访问管理页**（`/access`），
> 记录「谁、什么时候、从哪个 IP / 地区、访问了哪些接口与功能」，
> 支持一行一请求的明细、按 IP 与访客双维度聚合、图表分析、CSV 导出与地区下钻。

- 管理页：<https://doudoutech.cloud/access>（私有，密码同全站操作密码）
- 设计文档：[docs/access-management-design.md](./docs/access-management-design.md)

---

## 1. 背景与目标

站点是公开的（家人、朋友都可能来），但**没有登录体系** —— 想知道「到底来了几个人、
从哪来、在看哪个功能、有没有人在扫我」，就需要一条独立的访问审计通道。

| 需求 | 落点 |
|---|---|
| 记录有哪些访客、访问了哪些接口 / 功能 | 中间件记接口维度 + 前端埋点记页面维度 |
| 记录时间、IP、UA、来源、状态码、耗时 | `access_logs` 明细表 |
| IP 映射成地区 | 内置离线库 `ip2region`（省 / 市 / 运营商） |
| 一条记录一行（明细） | 明细 Tab：一行一请求，可筛选 + 分页 + 导出 |
| 按 IP 聚合，看「这个 IP 访问了啥」 | IP 聚合 Tab + 单 IP 档案弹窗 |
| 清晰有条理地展示、支持图表 | 概览 Tab：趋势 / 功能分布 / Top 接口 / 状态码 / 地区 |
| 私有功能入口（密码保护） | 门户「私有产品」区块卡片，复用全站密码门 |

## 2. 已确认的决策

| 项 | 决策 |
|---|---|
| **采集点** | **应用层 FastAPI 中间件**（不是 nginx 日志 —— 隧道下 nginx 只看到 `127.0.0.1`，且 SPA 路由无法区分功能页） |
| **真实访客 IP** | `cf-connecting-ip` → `x-forwarded-for` 首段 → socket 对端。前者是 Cloudflare **默认必发**的，**无需任何后台配置** |
| **地区来源** | 内置离线库 `ip2region xdb`（v4 + v6）。**不联网、不外发访客 IP、零第三方 API** |
| 存储 | 独立库 `access.db`（与 `visit_stats.db` 隔离，避免写入 / 清理互相锁） |
| 记录粒度 | 一行一请求（接口级）+ 页面级埋点；**探测与高频轮询按分钟聚合**防爆表 |
| 聚合维度 | **双维度**：按 IP（网络视角）+ 按访客（人视角，前端持久 UUID 跨 IP 归并） |
| 自动化流量 | **记录但标记**（`ua_class`），前端默认过滤、一键显示 |
| 明细保留 | **90 天**（`LOTTERY_ACCESS_KEEP_DAYS` 可覆盖）；IP / 访客档案**永久保留** |
| IP 存储 | **全量**（私有功能；掩码后无法排查） |
| 静态资源 | **不记录**（量级大且走 nginx） |
| 页面级埋点 | **要** —— SPA 靠 nginx 与中间件都分不清功能页 |
| 部署改动面 | nginx / systemd / Cloudflare **零改动** |

## 3. 功能范围

### 3.1 `/access` 管理页（私有，6 个 Tab）

| Tab | 内容 |
|---|---|
| **概览** | KPI（请求 / 独立 IP / 独立访客 / 页面浏览 / 错误率 / P95 耗时）· 趋势面积图（按天 / 按小时 × 请求 / 访客 / IP / 页面）· 功能域环形图 · Top 接口 · 状态码分布 · 地区排行 · 运营商分布 |
| **明细** | 一行一请求：时间 / 类型 / 功能 / 方法与路径 / 状态 / 耗时 / IP / 地区 / 客户端；支持类型、功能、状态段、路径关键词筛选，分页，**导出 CSV** |
| **IP 聚合** | 一行一 IP：地区 / 运营商 / 请求数 / 页面数 / 功能分布迷你条 / 首次 / 最近 / 客户端；可按请求数或最近访问排序、搜索；点 IP 打开档案弹窗（汇总 + 功能分布 + 接口 Top + 访问时间线 + **备注 / 标签**） |
| **访客** | 一行一访客（跨 IP 归并）：首次 / 最近 / 活跃天数 / 请求 / IP 数 / 地区 / 功能分布；点开看该访客**用过的所有 IP**、功能分布与完整时间线，可**起名** |
| **地区** | 按国家 / 省 / 市切换排行 + 运营商分布；无地区数据时明确提示「N 条未解析」 |
| **维护** | 库大小 / 行数 / 地区解析覆盖率 / 写入队列 / 离线库状态 / 按天清理 / 回填历史 / 一键清空 |

### 3.2 双维度聚合：为什么不能只看 IP

「系统有哪些访客」这个诉求，**按 IP 聚合 ≠ 按人聚合**：中国移动 / 联通的移动网络出口 IP
会频繁漂移，同一个访客一天可能命中十几个 IP —— 只看 IP 会把「一个人」拆成「十几行」。

前端把持久 UUID（`localStorage.lottery_visitor_id`）同步进 cookie，中间件加盐哈希后写入
`visitor` 字段。**盐与 `visit_stats.db` 完全相同**，所以导航栏上「N 人来访」的那个数字，
在这里可以逐个点开看。

## 4. 技术方案

### 4.1 数据流

```
浏览器请求
   │
   ├─ 中间件 access_logger（极薄：纯字符串处理）
   │    ├─ 忽略 /api/access/*、/api/health、/assets/*、静态资源
   │    ├─ 提取 IP / UA 分类 / 功能域 / 路径归一化 / query 脱敏
   │    └─ 投入内存队列 → 立即返回响应         ← 请求路径上零 IO、零建库查询
   │
   └─ 后台写入线程（200 条或 1 秒，先到者触发）
        ├─ 补全地区（geo.lookup）
        ├─ 探测 / 高频行按 (IP, 路径, 分钟) 聚合
        └─ 批量 INSERT + 写 IP / 访客档案
```

页面维度由前端 `usePageTrack` 上报（`POST /api/access/page`）——
SPA 所有路由都回退 `index.html`，只有前端知道用户在哪个功能页。

### 4.2 地区解析（离线库）

`ip2region` 的官方 Python binding 以 **vendored 副本**随仓库分发
（`backend/app/access/ip2region/`，Apache-2.0，纯标准库、零 C 扩展）——
不增加 pip 依赖、不需要服务器联网安装、数据文件与解析器版本一起锁定。

数据文件放 `/data/lottery/geo/`（**不进仓库**），由 `tools/geo_update.py` 下载。
脚本本身要落在 `/opt/lottery/tools/geo_update.py`（它靠 `__file__/../backend` 定位
binding，放错位置 import 会失败）：

```bash
# 服务器（自动尝试 jsDelivr 直连 → GitHub raw 走代理 → gitee 镜像）
cd /opt/lottery && /opt/lottery/backend/.venv/bin/python tools/geo_update.py
/opt/lottery/backend/.venv/bin/python tools/geo_update.py --only v4 --dry-run
```

下载流程：`.tmp` → 校验（大小 + `verify_from_file` + 抽样对答案）→ `os.replace()` **原子替换**。
**校验失败绝不覆盖现有文件** —— 更新失败不影响在跑的进程。

⚠️ **v6 走不到 jsDelivr**：v4（11.1 MB）jsDelivr 直连可用；v6（37.3 MB）超了
jsDelivr 的 20 MB 单文件上限，**稳定返 403**。所以服务器端实际生效的是
**第二跳 GitHub raw + mihomo 代理**（实测 ~164 KB/s，37 MB 约 4 分钟）。
本机若加 `--no-proxy`，第二跳会走直连（国内网络下时通时不通），v6 建议走代理。

**三层降级**（任何一层都不会让服务起不来）：

| 场景 | 处理 |
|---|---|
| 库文件不存在 / 损坏 | 只记 WARN，地区字段留空，页面提示「离线库未加载」 |
| `import` binding 失败 | 同上，其余功能完全不受影响 |
| 回环 / 私网 / 保留段 IP | **预判短路**，不进库（见下方两类标签） |
| 查询未命中 | 地区留空，保留原始 IP；库更新后可 `POST /maintenance/backfill` 批量回填 |

**非公网 IP 分两类 —— 别一律叫「内网」**（`cf-connecting-ip` 是客户端可伪造的）：

| 类别 | 网段 | 标签 | 含义 |
|---|---|---|---|
| 真内网 | `127/8` `10/8` `172.16/12` `192.168/16` `169.254/16` `100.64/10` `::1` `fc00::/7` `fe80::/10` | `内网 / 本机` | 真来自本机或内网（含**绕过 Cloudflare 直连源站**的请求，本身就是要看的信号） |
| 保留段 | RFC 5737 文档段 `192.0.2/24` `198.51.100/24` `203.0.113/24`、`198.18/15`（基准测试）、`240/4`（保留） | `保留地址` | **几乎只有扫描器与伪造头会发** |

⚠️ 判定**不能直接用 `ipaddress.is_private`**：CPython 把它把 RFC 5737 文档段与
`240/4` 一并算作 private，直接用会让伪造头伪装成「本机」流量。`geo.py` 用显式网段表。

**归一化**（不做就会毁掉聚合）：`0` / `Reserved` → 空串；省份剥「省 / 市 / 自治区」后缀；
直辖市省市同名 → 城市置空；超长 ISP 截断；境外国家码转中文名。
按省 / 市聚合时，本级为空会**回退到上一级**（保留地址只有国家、没有省份 →
显示「保留地址」而不是混进「未解析」）。
自检：`python -m app.access.geo --check`（对答案，不符返回非 0）。

### 4.3 nginx：SPA 回退必须挡住探测路径

这一层不是访问管理的内部实现，但它**直接决定审计数据真不真**，必须写下来。

原配置 `location / { try_files $uri $uri/ /index.html; }` 会让**任何**未命中文件的路径
拿到 `200 + index.html`。后果是扫描器请求 `/.env`、`/.git/config`、`/wp-login.php`
在访问管理里显示成「**命中 200**」——「有没有人在翻我的敏感文件」这个最该看清的
信号完全失真（2026-09-30 实测踩到）。

现在改成：

```nginx
location / {
    try_files $uri $uri/ @spa;
}

location @spa {
    if ($uri ~* "[.][A-Za-z0-9]{1,8}$") { return 404; }   # 末段带扩展名
    if ($uri ~  "/[.]")                 { return 404; }   # 任一段以点开头
    root /opt/lottery/frontend/dist;
    try_files /index.html =404;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

设计要点：

- **`/api/` `/assets/` `/hanzi/` `/song/` 一个字都没动** —— 它们的 location 在 `location /`
  之前就匹配完了，命名 location `@spa` 只承接「原本会落到 `/index.html`」的那部分请求。
  这比新增正则 location 安全得多（正则 location 会**抢占**前缀 location，那样
  `/assets/` 就得改成 `^~` 才不丢 immutable 缓存头）。
- **正则用字符类 `[.]` 而不是 `\.`** —— 实测带反斜杠的写法
  （`(/\\.)|(\\.[A-Za-z0-9]{1,8}$)`）对 `/.git/config` **匹配不上**，
  nginx 引号内反斜杠的解析结果与直觉不符。写成 `[.]` 无需转义、行为可预测。
  这是**真实返工点**：v1 只查末段扩展名漏了 `/.git/config`，v2 换交替正则仍然漏，
  v3 用 `[.]` + 拆两条才通。
- **两个 `if` 里只写 `return`** —— "if is evil" 只惩罚 `return`/`rewrite ... last`
  之外的用法；纯 `return` 是安全的。
- **`try_files /index.html =404`** 沿用配置里已有的 `@hanzi_spa` 同款写法（线上跑得通）。

行为矩阵（2026-09-30 服务器实测）：

| 路径 | 结果 |
|---|---|
| `/` `/access` `/story/12` `/lottery` `/hanzi/1` | `200 text/html`（SPA 深链） |
| `/.env` `/.git/config` `/.aws/credentials` `/wp-login.php` `/backup.zip` `/config.php` `/db.sql` | `404` |
| `/song-covers/EN001.jpg`（真实文件） | `200 image/jpeg` |
| `/assets/index-*.js` | `200 application/javascript` |
| `/api/nope` | `404 application/json` |

本地「后端单独直跑」时，`backend/app/main.py` 的 `spa_fallback` 实现了同样三条规则，
两边**改一处必须同步另一处**。

### 4.4 护栏

| 规则 | 做法 |
|---|---|
| **自噬** | `/api/access/*` 一律不记（否则每开一次页面就新增几十行） |
| **噪音** | `/api/health`、`/assets/*`、静态资源不记；SPA 页面导航请求不记（交给埋点） |
| **扫描器** | 未知路径 → `kind='probe'`，按 (IP, 路径, 分钟) 聚合成一行，`hits` 累加 |
| **高频轮询** | 同一 (IP, 路径) 每分钟超过 60 条 → 降级为聚合行 |
| **自动化流量** | 照样记录，但打 `ua_class`（`script` / `bot`），前端默认隐藏、一键显示 |
| **埋点侧** | 自动化环境（`navigator.webdriver` / Headless UA）直接跳过上报 |
| **隐私** | query 里的 `key` / `token` / `password` 一律打码；cookie **只存名不存值**；库 0600 / 目录 0700 |

## 5. 接口文档（`/api/access/*`）

除 `/auth`、`/session`、`/page` 外全部需要 cookie（`access_session`，12h httpOnly，
与 trigger / story / babysong 同一签名密钥）。

### 5.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth` | 密码校验（复用全站操作密码 + 失败递增锁定）→ 签发 cookie |
| GET | `/session` | 会话是否有效 |
| POST | `/logout` | 清除 cookie |

### 5.2 采集

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/page` | 前端页面埋点（**公开**）：`{path, title, referer, visitor_id}`；只接受已知路由 |

### 5.3 查询（除特别说明外均支持 `?days=N`，默认 7；`?include_auto=1` 显示自动化流量）

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/summary` | KPI + P50/P95 + 离线库状态 + 被隐藏的自动化流量数 |
| GET | `/timeseries?bucket=day\|hour&metric=requests\|ips\|visitors\|pages` | 折线数据（自动补零） |
| GET | `/top-paths?limit=20` | 接口排行（次数 / 平均耗时 / 错误数 / IP 数） |
| GET | `/features` | 功能域分布 |
| GET | `/geo?level=country\|region\|city` | 地区分布 |
| GET | `/isp` | 运营商 / 网络归属 |
| GET | `/status-codes` | 状态码分组（2xx/3xx/4xx/5xx）+ 明细 |
| GET | `/ua-classes` | 客户端类型分布 |
| GET | `/ips` | IP 聚合列表（`sort` / `q` / `tag` / 分页），含功能分布 |
| GET | `/ips/{ip}` | 单 IP 档案：汇总 + 功能分布 + 接口 Top + 时间线 |
| PUT | `/ips/{ip}` | 写备注 / 标签（`me` / `family` / `friend` / `bot` / `scan` / `unknown`） |
| GET | `/visitors` | 按访客聚合（跨 IP 归并，含最近地区与功能分布） |
| GET | `/visitors/{visitor}` | 单访客档案：IP 列表 + 功能分布 + 时间线 |
| PUT | `/visitors/{visitor}` | 给访客起名 / 加备注 |
| GET | `/logs` | 明细分页（`kind` / `feature` / `ip` / `visitor` / `path` / `status` / `private`） |
| GET | `/export.csv` | 导出当前筛选结果（UTF-8 BOM，Excel 直开） |
| GET | `/live?since_id=` | 增量拉取（实时滚动） |

### 5.4 维护

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/maintenance` | 库大小 / 行数 / 时间范围 / 各类型统计 / 地区覆盖率 / 队列状态 |
| POST | `/maintenance/purge` | `{before: 'YYYY-MM-DD'}` 按天分批删除明细 |
| POST | `/maintenance/backfill` | 离线库更新后回填历史行里地区为空的记录 |
| POST | `/maintenance/purge-all` | 一键清空（公开站点的 IP 属个人信息，留一个隐私出口） |
| GET | `/geo-status` | 离线库加载状态 |

`/maintenance` 里三个地区计数**口径必须分清**，否则覆盖率永远不达标：

| 字段 | 含义 |
|---|---|
| `geo_ips_total` | **本该由离线库解析的公网 IP 数**（分母，已排除私网 / 保留段） |
| `geo_ips_resolved` | 其中成功解析出地区的数量（分子） |
| `geo_ips_skipped` | 私网 / 保留段 IP 数 —— 按设计不查库，**不进分母** |
| `geo_coverage` | `resolved / total × 100`；`total == 0` 时返回 `100`（没有该解析的，不算失败） |

⚠️ 分母**必须**排掉 `geo_src='private'` 的行。把它们算进分母等于拿「设计如此」当
「解析失败」：只要有一条本机流量，覆盖率就永远上不了 100%，这个指标直接废掉
（2026-09-30 实测：本地库覆盖率从错误的 75% 修正为 100%，另有 2 个 IP 计入 skipped）。

### 5.5 状态码约定

| 码 | 含义 |
|---|---|
| 200 | 成功 |
| 401 | 未认证 / 会话过期（前端回到密码门） |
| 422 | 参数不合法（如 `bucket` / `level` / `tag` 取值非法、`before` 格式错误） |
| 429 | 密码错误次数过多，临时锁定 |

## 6. 数据模型

`/data/lottery/access.db`

| 表 | 用途 | 保留 |
|---|---|---|
| `access_logs` | 明细，一行一请求（含聚合行的 `hits`） | 90 天 |
| `ip_profile` | IP 档案：首次出现 + 人工备注 / 标签 | 永久 |
| `visitor_profile` | 访客档案：首次出现 + 起名 / 备注 | 永久 |

设计取舍：**所有统计量一律实时 `GROUP BY` 明细表**，不做预聚合 —— 20 万行量级 SQLite
毫无压力，而预聚合表必然引入「双写不一致」。计数统一用 `SUM(hits)` 而非 `COUNT(*)`，
因为聚合行代表多次访问。

## 7. 部署与运维

```bash
# 1) 服务器装离线库（首次 / 定期更新）。⚠️ 必须在 /opt/lottery 下跑（脚本靠 __file__ 定位 backend）
ssh <server> 'cd /opt/lottery && /opt/lottery/backend/.venv/bin/python tools/geo_update.py'

# 2) 验证地区解析（对答案，不符返回非 0）
ssh <server> 'cd /opt/lottery/backend && /opt/lottery/backend/.venv/bin/python -m app.access.geo --check'

# 3) 库状态 / 行数
ssh <server> 'sqlite3 /data/lottery/access.db "select count(*) from access_logs"'
```

**部署面**：`backend/app/access/`（含 vendored `ip2region/` binding）、`backend/app/main.py`
（注册中间件 + 路由 + SPA 回退）、`frontend/dist/`、`deploy/nginx.conf`（§4.3 的 `@spa`）、
`tools/geo_update.py`。⚠️ `tools/` **不在** 常规「backend + frontend/dist + deploy」部署集里，
新增工具要单独 `cp` 过去（2026-09-30 首次部署就漏了它，导致页面上的运维提示照做会报
`can't open file '/opt/lottery/tools/geo_update.py'`）。

**首次上线后必查的一条**：光看页面有数据不够，要确认记到的是**真实访客 IP**
而不是隧道地址 —— `cf-connecting-ip` 要能穿过
`Cloudflare → cloudflared → nginx(8081) → gunicorn(8000)` 整条链路：

```bash
ssh <server> '/opt/lottery/backend/.venv/bin/python -c "
import sqlite3;c=sqlite3.connect(\"/data/lottery/access.db\")
print(c.execute(\"select ip,country,region,isp,sum(hits) from access_logs group by ip order by 5 desc\").fetchall())"'
```

期望看到**自己的公网 IP + 正确省份**（实测 `218.94.124.82 → 中国/江苏/南京/电信`）。
`127.0.0.1` 只应出现在「服务器本机 curl」这类请求上，它是**绕过 Cloudflare 直连源站**
的痕迹，属正常且值得关注的信号。

- **无新增依赖**（ip2region binding 已 vendored 进仓库）
- **Cloudflare / systemd 零改动**（⚠️ nginx **有一处**改动，见 §4.3 的 `@spa`；已备份 + `nginx -t` + 行为矩阵验证）
- 明细清理：应用启动时 + 每天一次；`LOTTERY_ACCESS_KEEP_DAYS` 可覆盖
- 相关环境变量：`LOTTERY_ACCESS_KEEP_DAYS`、`LOTTERY_GEO_DIR`、`LOTTERY_GEO_PROXY`、`LOTTERY_VISIT_SALT`（与访问统计共用）

## 8. 已知限制

- **页面级数据依赖前端埋点**：禁用 JS 或自动化环境的访问不会产生 `kind='page'` 记录
  （接口维度仍完整）。这是 SPA 的固有约束，不是缺陷。
- **地区精度受离线库限制**：新分配 IP 段可能查不到（地区留空），更新库后可回填；
  同一 IP 归属偶尔会与商业库有差异（省 / 市粒度一致，街道级不提供）。
- **非公网 IP** 分「内网 / 本机」与「保留地址」两类，均不做地区解析（判定依据见 §4.2）。
- **`cf-connecting-ip` 可被客户端伪造**：绕过 Cloudflare 直连源站（`124.222.39.15:8081`）
  的请求会让中间件拿不到该头，回落到 `x-forwarded-for` / socket 地址。
  伪造值最多污染**它自己那一行**的地区字段，不影响计数；保留段会被标成「保留地址」便于识别。
- **多 worker 各自的分钟聚合状态独立**：极端情况下同一分钟窗口可能产生 2 行聚合行（不影响计数）。
- **明细 90 天为默认值**：更早的记录会被清理，但 IP / 访客档案与首次出现时间永久保留。
