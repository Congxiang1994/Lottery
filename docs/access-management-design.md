# 访问管理 · 需求分析与技术设计

> 状态：**方案待确认（2026-09-30）**，未开始编码。
> 目标：新增私有入口 `/access`，记录「谁在什么时候、从哪个 IP / 地区、访问了哪些接口与功能」，支持明细、IP 聚合、图表多维展示。
> 定位：与现有 6 个功能域同一套架构，**零新增基础设施**（不引入 ES / ClickHouse / 第三方埋点）。

---

## 0. 结论先行

| 项 | 结论 |
|---|---|
| 人工配置 | **0 项** —— 不改 Cloudflare、不改 nginx、不改 systemd |
| 数据来源 | **应用层 FastAPI 中间件**（不是 nginx 日志，见 §3 实测证据） |
| 地区信息 | **内置离线 IP 库 `ip2region`**（v4 + v6），纯本地查询、不联网、不外发访客 IP |
| 存储 | 新增独立库 `/data/lottery/access.db`（与 `visit_stats.db` 隔离，避免写入/清理互相锁） |
| 记录粒度 | **一行一请求**（接口级）+ 页面级埋点；被扫描的未知路径降级为「按分钟聚合行」防爆表 |
| 聚合维度 | **双维度**：按 IP（网络视角）+ 按访客（人视角，靠前端持久 UUID 跨 IP 归并） |
| 后端改动 | 新增 `app/access/` 一个模块（config / store / geo / middleware / router）+ `main.py` 注册 |
| 前端改动 | 新增 `/access` 页 + `usePageTrack.ts` + 门户卡片 + 路由 + 导航分支 |
| 预计数据量 | 实测 API 请求 **526 行 / 天**、总请求 1134 → 一年约 **20 万行**，SQLite 无压力 |
| 内存开销 | geo 索引 **约 1 MB / worker**（v4+v6 各 512 KB，见 §4.3） |
| 预研状态 | ✅ **离线库已在服务器上跑通**（下载/Apache-2.0 客户端/查询/性能全实测，见 §4.2 §4.3） |

### 0.1 唯一还用到 Cloudflare 的地方（且不需要你配置）

真实访客 IP 只能从 `cf-connecting-ip` 请求头拿 —— 隧道下 nginx 看到的是 `127.0.0.1`。
但这个头是 **Cloudflare 默认必发**的，实测已通（`218.94.124.82`），**不需要开任何开关**。

被放弃的是 `cf-ipcity` / `cf-iplatitude` / `cf-iplongitude` / `cf-timezone` 这组 ——
它们需要手动开 `Add visitor location headers`，**故整组弃用**，地区改由本地离线库提供。

---

## 1. 需求拆解

| # | 需求 | 落点 |
|---|---|---|
| R1 | 记录有哪些访客、访问了哪些接口 / 功能 | 中间件写 `access_logs`（接口粒度）+ 前端埋点（功能/页面粒度） |
| R2 | 记录时间、IP、UA、来源、状态码、耗时 | 同上 |
| R3 | IP 映射成地区 | 本地离线库 `ip2region`（省 / 市 / 运营商） |
| R4 | 一条记录一行（明细） | 明细 Tab，一行一请求，可筛选 + 分页 + 导出 |
| R5 | 按 IP 聚合，可看「这个 IP 访问了啥」 | IP 聚合 Tab + 单 IP 详情（时间线 / 接口 Top / 功能分布） |
| R6 | 清晰有条理地展示、支持图表 | 概览 Tab：趋势面积图 / 功能环图 / Top 接口横条 / 状态码 / 地区排行 |
| R7 | 私有功能入口（密码保护） | 门户「私有产品」区块加卡片，页面复用现有密码门模式 |

---

## 2. 复用既有模式（不发明新东西）

| 能力 | 直接复用 | 出处 |
|---|---|---|
| SQLite 连接（WAL / 自动 commit / 0600 硬化） | `get_conn` | `backend/app/common/db.py` |
| 密码校验 + 防爆破（失败递增锁定） | `results_store.verify_password` | `backend/app/lottery/services/results_store.py` |
| 会话签名（HMAC，持久化密钥，多 worker 共享） | `trigger.config.sign_session / verify_session` | `backend/app/trigger/config.py` |
| 建表并发安全（`flock` 串行化） | `story/store.py::init` 的写法 | `backend/app/story/store.py` |
| 密码门 UI / Tab / 表格 / 弹窗 / 图标按钮 | `Trigger.tsx` 的 `PasswordGate` / `IconBtn` / `ConfirmModal` | `frontend/src/trigger/Trigger.tsx` |
| 接口调用日志中间件的写法 | `v1_call_logger` | `backend/app/story/router.py` |
| 图表库 | **recharts 已在依赖里**（`^2.12.7`），无需新装 | `frontend/package.json` |
| 弹窗基础设施 | `common/Modal.tsx` + `useModalHistory` + `ExitPresence` | `frontend/src/common/` |
| 失败态 UI | `common/State.tsx` 的 `ErrorBlock` | `frontend/src/common/State.tsx` |

**唯一新增依赖**：`py-ip2region`（纯 Python、Apache-2.0、镜像已有 3.0.4）。见 §4。

---

## 3. 数据从哪来：为什么必须是应用层

### 3.1 实测证据（2026-09-30 现场核查线上）

| 检查项 | 实测结果 | 结论 |
|---|---|---|
| 线上 nginx access.log 的 IP 字段 | 隧道流量**全是 `127.0.0.1`**；只有直连 8081 才是真 IP（实测 `218.94.124.82`） | ❌ **nginx 日志拿不到 CF 后的真实访客 IP** |
| nginx 是否自定义 `log_format` | 未定义，用默认 combined（`$remote_addr`） | 同上 |
| 今日 `/api/` 请求数 | **526** | 量级很小 |
| 今日总请求数 | **1134** | 一年约 20 万行，SQLite 绰绰有余 |
| 现有库 | `/data/lottery/{algo_results,auth,babysong_dl,story,trigger,visit_stats}.db` | 无 access 库，需新建 |

链路是 `CF Tunnel → cloudflared → nginx(8081) → gunicorn(8000)`，cloudflared 从回环发起连接，所以 nginx 看到的对端永远是 `127.0.0.1`。

### 3.2 结论

采集点放在 **FastAPI 中间件**，理由：

1. 能拿到 `cf-connecting-ip`（真实 IP）；
2. 能拿到 **业务上下文**——状态码、耗时、命中的功能域、是否已通过私有功能密码门；
3. 单一数据源写在 SQLite，查询 / 聚合 / 清理都在一个地方，不依赖日志轮转与 gzip 解析；
4. 已有 `v1_call_logger` 先例，模式成熟；
5. SPA 的页面路由全部回退到 `index.html`，nginx 根本分不清用户在看哪个功能 → **页面粒度必须靠前端埋点**，天然属于应用层。

**nginx 配置零改动**。nginx access log 保留现状（作为兜底审计），第一版不动它。

### 3.3 IP 提取优先级

```
1. cf-connecting-ip                # Cloudflare 默认必发（实测透传 ✅，218.94.124.82）
2. x-forwarded-for 的第一段        # nginx $proxy_add_x_forwarded_for → "真实IP, 127.0.0.1"
3. request.client.host             # 直连 8081 / 本地开发
```

⚠️ 取 XFF 必须取 **首段**：nginx 的 `$proxy_add_x_forwarded_for` 会把自己的 `$remote_addr`（隧道下是 `127.0.0.1`）追加在后面。

---

## 4. 地区信息：内置离线库（完全代码实现）

### 4.1 选型对比

| 方案 | 需要 CF 配置 | 需联网 | 精度（国内） | 成本 | 结论 |
|---|---|---|---|---|---|
| Cloudflare 托管转换头 | ✅ 要手动开 | 否 | 高（含经纬度） | 免费 | ❌ **弃用**（用户不动 CF） |
| 第三方 IP 定位 API | 否 | ✅ 每次外发访客 IP | 差（同一 IP 三家分歧） | 免费额度有限 | ❌ 弃用（隐私 + 不可靠） |
| **ip2region xdb（本地离线）** | **否** | **否** | **高（省 / 市 / 运营商）** | 一次性下载 10.6 MB | ✅ **采用** |
| MaxMind GeoLite2 | 否 | 否 | 中 | 需账号 + License 限制再分发 | ❌ 弃用 |

**为什么是 ip2region**：`ipv4_source.txt` 有 51 万+ 个 IP 段，生成阶段做了「相邻同 region 段合并 + region 文本去重」，xdb 只有 10.6 MB；查询靠 256×256 的向量索引做两跳定位，**微秒级**。国内数据质量优于 GeoLite2，且**参数里直接带运营商**（电信/联通/移动），对识别移动网络很有用。

### 4.2 实测可达性（2026-09-30 现场验证）

| 检查项 | 实测结果 |
|---|---|
| `ip2region_v4.xdb`（GitHub raw，走服务器 mihomo:7890 代理） | **HTTP 200，content-length 11,122,036**（10.6 MB） |
| `ip2region_v6.xdb`（同上） | **HTTP 200，content-length 37,277,813**（35.5 MB） |
| jsDelivr CDN（**直连**，免代理备用源） | HTTP 200 |
| 服务器 mihomo 代理探活 | `curl -x http://127.0.0.1:7890 https://api.github.com` → **200** |
| pip 腾讯云内网镜像 | `py-ip2region 3.0.4` 可用（纯 Python，Requires-Python ≥3.7） |
| Python binding 源码许可 | **Apache-2.0** |

### 4.3 落地方式

**客户端**：`pip install py-ip2region`（官方 Python 客户端，**纯标准库实现、零 C 扩展**，兼容 3.14.5）。
写进 `requirements.txt` 与 `pyproject.toml`；服务器侧装一次（venv 属主是 ubuntu，无需 sudo）。

**数据文件**：`/data/lottery/geo/ip2region_v4.xdb` + `ip2region_v6.xdb`
（环境变量 `LOTTERY_GEO_DIR` 可覆盖，本地开发指到 `backend/.geo/`；该目录进 `.gitignore`，**大文件不进仓库**）

**下载与更新**：新增 `tools/geo_update.py`，一键完成
```
多源尝试：GitHub raw（走代理）→ jsDelivr（直连）→ gitee 镜像
   ↓
下载到 .tmp → md5 记录 → os.replace() 原子替换（更新失败不影响在跑的进程）
   ↓
用 ip2region 的 verify_from_file() 校验 xdb 与客户端版本匹配
```
⚠️ 服务器下载**必须带代理**（`-x http://127.0.0.1:7890`）—— 服务器上非交互 shell 不读 `.bashrc`，代理 env 得脚本自带（既有硬规则）。

**缓存策略**：

| 文件 | 策略 | 常驻内存 | 单次查询 |
|---|---|---|---|
| `ip2region_v4.xdb` | `vectorIndex`（512 KB 索引常驻） | 512 KB | ~100 µs |
| `ip2region_v6.xdb` | `vectorIndex` | 512 KB | ~100 µs |
| **合计** | | **约 1 MB / worker** | |

**为什么不用 `content` 全量缓存**（10.6 + 35.5 MB）：查询发生在**后台写入线程**，写入 QPS < 0.02 次/秒，对 31 µs 还是 10 µs 完全不敏感；而 `content` 要多占约 48 MB × 2 worker ≈ 96 MB，在 3.7 GB 内存的机器上没必要。用最小的内存换掉「够用」的性能。
（实测数据：vectorIndex 模式 **31.3 µs/次**、索引加载 **1 ms**，见 §4.3）

**查询结果格式**（实测确认 **固定 5 段**）：

```
[0]国家 | [1]省/州 | [2]城市 | [3]ISP | [4]国家码
```

**2026-09-30 服务器实测输出**（`/opt/lottery/backend/.venv/bin/python` + vectorIndex 模式）：

| 输入 IP | 备注 | 返回 |
|---|---|---|
| `218.94.124.82` | **用户本机公网 IP** | `中国\|江苏省\|南京市\|电信\|CN` ✅ 准确 |
| `114.114.114.114` | 114DNS | `中国\|江苏省\|南京市\|0\|CN` |
| `223.5.5.5` | 阿里 DNS | `中国\|浙江省\|杭州市\|阿里\|CN` |
| `117.136.15.26` | 移动示例 | `中国\|四川省\|成都市\|移动\|CN` |
| `101.226.4.6` | 上海电信 DNS | `中国\|上海市\|上海市\|电信\|CN` |
| `8.8.8.8` | Google | `United States\|California\|0\|Google LLC\|US` |
| `129.226.0.1` | 腾讯云（新加坡） | `Singapore\|Singapore\|0\|Tencent Building, Kejizhongyi Avenue\|SG` |
| `127.0.0.1` | 回环 | `Reserved\|Reserved\|Reserved\|0\|0` |
| `192.168.1.1` | 私网 | `Reserved\|Reserved\|Reserved\|0\|0` |

**性能实测**：vectorIndex 模式 **31.3 µs / 次**（2000 次循环均值），索引加载 **1 ms**。比预估还快 3 倍。

**⚠️ 必须做的归一化（这些脏值都会直接毁掉聚合）**：

| 脏值 | 处理 |
|---|---|
| 任一段是 `0` 或 `Reserved` | 一律转**空串** —— 否则 UI 上会出现「Reserved」「0」这种垃圾 |
| 回环 / 私网 IP | **不进库查**，直接 `country=内网`、`region=本机`、`geo_src=private` |
| 省份带后缀（`江苏省` / `上海市`） | 剥掉「省 / 市 / 自治区 / 特别行政区 / 壮族自治区 / 回族自治区 / 维吾尔自治区」→ `江苏` / `上海` / `内蒙古` / `广西`。**不剥会被 `GROUP BY` 拆成「江苏」和「江苏省」两组** |
| 直辖市（`上海市\|上海市`，省 = 市） | 检测到省市相同 → 省列显示「上海（直辖市）」，城市列留空，避免占两行 |
| 境外 `United States\|California\|0` | 国家用中文名、州用原值、城市空；另存 `country_code`（`US`）供国旗/聚合 |
| ISP 过长（`Tencent Building, Kejizhongyi Avenue`） | 截断到 16 字符 + 逗号前取主名 |
| 国内 ISP 是 `0`（如 114DNS） | 转「未知」，展示为 `-` |

**白捡的云厂商识别**：`ISP` 段里出现 `Tencent` / `Alibaba` / `Amazon` / `Google` / `Microsoft` / `云` 等关键词 → 该 IP 大概率是爬虫 / 扫描器 / 代理，在 IP 聚合里自动打标，并在概览里单独出一个「云厂商流量」占比。

### 4.4 兜底与降级（每一层都不能让服务挂）

| 场景 | 处理 |
|---|---|
| 回环 / 私网 IP（`127.*` / `10.*` / `192.168.*` / `172.16-31.*` / `::1`） | **预判并短路**，不进库：标记 `country=内网`、`region=本机`、`geo_src=private`（库里对这些 IP 返回的 `Reserved\|Reserved\|Reserved` 是脏值，必须拦掉） |
| 离线库不存在 / 加载失败 | 地区字段留空，UI 显示「未解析」+ 库缺失提示；**绝不因 geo 库缺失让服务起不来** |
| `import ip2region` 失败 | 同上，启动日志 WARN 一条，其余功能全不受影响 |
| 查询抛异常（如把 IPv6 传给 v4 searcher） | 按 IP 版本自动路由到对应 searcher；异常被吞掉并记 `geo_src=none`，不冒泡 |
| 查询未命中（新分配 IP 段） | 地区留空，保留原始 IP；**库更新后可批量回填**（`/maintenance/backfill`） |
| 本地开发（无 CF 头） | IP 是 `127.0.0.1` → 「内网 / 本机」，天然合理 |

### 4.5 进程内查询缓存

同一访客会反复出现，`geo.py` 内置一个 **IP → 解析结果 的内存字典缓存**（上限 5000 条，超限按 FIFO 清一半）。
命中缓存 `O(1)`，避免每条日志都走一次索引查询。缓存只在后台写入线程内访问，无锁。

### 4.6 顺带拿到的东西：运营商

ip2region 返回的第 5 段是 ISP，白捡一个很有用的维度：

- **识别云厂商 IP**（腾讯云 / 阿里云 / 华为云）→ 大概率是爬虫、扫描器或代理，可在 IP 聚合里直接打标；
- **识别移动网络**：中国移动/联通/电信的 4G/5G 出口 IP **会频繁漂移**，同一个访客一天可能换十几个 IP。
  → 这正是下面 §5.3「双维度聚合」的动机。

---

## 5. 数据模型

库：`/data/lottery/access.db`（`harden_dir` 已把目录降到 0700，`get_conn` 把文件降到 0600）

### 5.1 `access_logs` —— 明细，一行一请求

```sql
CREATE TABLE IF NOT EXISTS access_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT    NOT NULL,               -- 'YYYY-MM-DD HH:MM:SS' 服务器本地时间(+08)
    day        TEXT    NOT NULL,               -- 'YYYY-MM-DD'，按天聚合 / 按天清理
    kind       TEXT    NOT NULL DEFAULT 'api', -- api | page | probe
    feature    TEXT    NOT NULL DEFAULT '',    -- 功能域：portal/lottery/hanzi/babysong/story/trigger/admin/other
    method     TEXT    NOT NULL DEFAULT '',
    path       TEXT    NOT NULL DEFAULT '',    -- 归一化路径（数字段 → {id}），聚合用
    raw_path   TEXT    NOT NULL DEFAULT '',    -- 原始路径
    query      TEXT    NOT NULL DEFAULT '',    -- 脱敏后的 query（剔除 key/token/password 类字段）
    status     INTEGER NOT NULL DEFAULT 0,
    latency_ms REAL,
    bytes      INTEGER NOT NULL DEFAULT 0,
    ip         TEXT    NOT NULL DEFAULT '',
    country    TEXT    NOT NULL DEFAULT '',
    region     TEXT    NOT NULL DEFAULT '',    -- 省（已归一化，无「省」后缀）
    city       TEXT    NOT NULL DEFAULT '',
    isp        TEXT    NOT NULL DEFAULT '',    -- 运营商（ip2region 第 5 段）
    geo_src    TEXT    NOT NULL DEFAULT '',    -- offline | cf | private | none（地区来自哪一层）
    ua_class   TEXT    NOT NULL DEFAULT '',    -- browser|mobile|bot|script|probe|unknown
    ua         TEXT    NOT NULL DEFAULT '',
    referer    TEXT    NOT NULL DEFAULT '',
    visitor    TEXT    NOT NULL DEFAULT '',    -- 前端 visitor_id 的加盐哈希（与 visit_visitors 同盐，可跨表关联）
    hits       INTEGER NOT NULL DEFAULT 1,     -- 普通行恒 1；聚合行 = 合并条数
    is_private INTEGER NOT NULL DEFAULT 0,     -- 命中私有功能（/trigger /story-admin /babysong-admin /access）
    auth       TEXT    NOT NULL DEFAULT ''     -- 携带了哪个会话 cookie（只存 cookie 名，不存值）
);
CREATE INDEX IF NOT EXISTS idx_al_ts      ON access_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_day     ON access_logs (day);
CREATE INDEX IF NOT EXISTS idx_al_ip_ts   ON access_logs (ip, ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_visitor ON access_logs (visitor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_path_ts ON access_logs (path, ts DESC);
CREATE INDEX IF NOT EXISTS idx_al_feature ON access_logs (feature, ts DESC);
```

### 5.2 `ip_profile` —— IP 档案（人工标注 + 首次出现，**不随明细过期**）

```sql
CREATE TABLE IF NOT EXISTS ip_profile (
    ip         TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL DEFAULT '',       -- 写入时顺手更新（便于排序，不做聚合依据）
    note       TEXT NOT NULL DEFAULT '',       -- 备注：如「我的 Mac」「公司」
    tag        TEXT NOT NULL DEFAULT '',       -- me | family | friend | bot | scan | unknown
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
```

**设计取舍**：所有**统计量**（请求数、功能分布、首末次）一律**实时 `GROUP BY` 明细表**，不在聚合表里冗余计数 —— 避免「双写不一致」这个经典坑。`ip_profile` 只放两张明细算不出来的东西：**首次出现时间**（明细被清理后会丢）与**人工标注**。首次出现用 `INSERT OR IGNORE` 幂等写入。

查询性能：20 万行量级 + `(ip, ts DESC)` / `(visitor, ts DESC)` 索引，`GROUP BY` 在几十毫秒级，无需预聚合表。

### 5.3 双维度聚合：为什么不能只看 IP

用户的核心诉求是「**记录系统有哪些访客**」。但**按 IP 聚合 ≠ 按人聚合**：

- 中国移动/联通的移动网络出口 IP **会频繁漂移**，同一个访客一天可能命中十几个 IP；
- 只看 IP，会把「一个人」拆成「十几行」，看起来像来了十几个人。

所以前端已有持久 UUID（`localStorage.lottery_visitor_id`），中间件把它**加盐哈希**后写进 `visitor` 字段：

| 聚合维度 | 回答的问题 | 归并键 |
|---|---|---|
| **按 IP** | 网络视角：哪些地址在敲我？某地址干了什么？ | `ip` |
| **按访客** | 人视角：**到底来了几个人**？各自用了哪些功能？ | `visitor`（跨 IP、跨天归并） |

⭐ 哈希盐与 `visit_stats.db` 的 `LOTTERY_VISIT_SALT` **完全一致** → 两库可以交叉关联：
Nav 上显示「**4 人来访**」的那个数字，在访问管理里能**逐个点开看**这 4 个人分别是谁、用了什么、从哪来。

---

## 6. 采集与写入

### 6.1 中间件职责（保持极薄）

```
access_logger(request, call_next)
  ├─ 路径在忽略名单（/api/access/*、/api/health、/assets/*）→ 直接放行
  ├─ 记录 start = perf_counter()
  ├─ response = await call_next(request)
  ├─ 组装行（只做纯字符串处理：IP 提取 / UA 分类 / feature 映射 / query 脱敏）
  └─ 投入内存队列，立刻返回 response
```

⭐ **地区解析不在这里做** —— 中间件只投递原始 `ip` 字段；`geo` 查询在**后台写入线程**里逐条补全。
这样请求路径上不做任何 IO 或索引查询，中间件的开销只剩几次字符串操作。

### 6.2 写入：内存队列 + 单后台线程批量 flush

- 每请求 **不直接写库**（同步 SQLite 写在 async 路径上会阻塞事件循环）。
- 队列攒 **200 条或 1 秒**（先到者触发）一次性 `executemany` 批量 insert，走 WAL。
- flush 时顺带：geo 补全 → 首次出现的 IP 写 `ip_profile`（`INSERT OR IGNORE`）。
- 两个 worker 各自持有队列、各自写同一个库：WAL 支持多写者串行，`busy_timeout=30s` 足够；批量写进一步降冲突概率。
- **写入失败绝不冒泡**：整体 try/except，与 `v1_call_logger` 一致；队列满（>5000）时丢弃最旧并计数告警，保证中间件永不成为业务瓶颈。
- 启动时 `flock` 建表（幂等），遵循既有硬规则 —— 否则 `-w 2` 首启 `database is locked` 会拖垮整个 gunicorn master。
- 进程退出（`lifespan` 的 `yield` 之后）flush 一次剩余队列。

### 6.3 护栏（防爆表 / 防自噬）

| 规则 | 做法 |
|---|---|
| **自噬** | `/api/access/*` 一律不记（否则每查一次页面新增几十行） |
| **噪音** | `/api/health`、`/assets/*`、favicon 不记 |
| **扫描器** | 未命中接口白名单的路径 / 4xx 响应 → `kind='probe'`，**按 (ip, 分钟) 聚合成一行**，`hits` 累加、`path` 记样本 —— 既能看到「有人在扫」，又不会被刷爆 |
| **自动化流量** | **照样记录**，但打 `ua_class`（`script`/`bot`）+ 回环 IP 标记，前端**默认过滤**、可一键切换显示（比丢弃更有价值：能看清自己的验证脚本有多吵） |
| **私有接口高频轮询** | 如儿歌下载的 3s 轮询 → 单 (ip, path) 每分钟超过 60 条即降级为聚合行 |

> 与站点访问统计（`visit_stats.db`）的关系：**并存、互不影响**。Nav 顶部的「N 人来访」徽章仍走轻量的 `/api/stats/visit`，不会去查大表。两库靠同一个盐的 `visitor` 哈希交叉关联。

---

## 7. 后端接口设计（`/api/access/*`）

认证：`POST /auth` 校验密码（复用 `results_store.verify_password` + 防爆破）→ 签发 12h httpOnly cookie `access_session`（复用 trigger 的签名密钥，独立 cookie 名，与 story / babysong 一致）。除 `/auth` `/session` `/page` 外全部校验 cookie，无效 → 401。

### 7.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth` | 密码校验，签发 cookie |
| GET | `/session` | 会话是否有效（免重复输密码） |
| POST | `/logout` | 清除 cookie |

### 7.2 采集

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/page` | 前端页面埋点（公开，无需 cookie）；body: `{path, title, referer, visitor_id}` |

### 7.3 查询（全部支持 `?days=N` 时间窗，默认 7）

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/summary` | KPI：今日/近 N 日请求数、独立 IP 数、**独立访客数**、页面浏览数、4xx/5xx 率、P50/P95 耗时 |
| GET | `/timeseries` | `?bucket=hour\|day&metric=requests\|ips\|visitors\|pages` → 折线数据（补零） |
| GET | `/top-paths` | `?limit=20` 接口排行（次数 / 平均耗时 / 错误率） |
| GET | `/features` | 功能域分布（次数 / 独立 IP / 独立访客） |
| GET | `/geo` | `?level=country\|region\|city` 地区分布 |
| GET | `/isp` | 运营商分布（电信 / 联通 / 移动 / 云厂商 / 未知） |
| GET | `/status-codes` | 状态码分布（2xx/3xx/4xx/5xx 分组 + 明细） |
| GET | `/ua-classes` | 客户端类型分布 |
| GET | `/ips` | `?sort=requests\|last_seen&q=&tag=&include_auto=0&limit=&offset=` IP 聚合列表 |
| GET | `/ips/{ip}` | 单 IP 档案：汇总 + 功能分布 + 接口 Top + 时间线（分页） |
| PUT | `/ips/{ip}` | 写备注 / 标签 |
| GET | `/visitors` | **按访客聚合**：`?sort=&include_auto=0` → 一行一个访客（跨 IP 归并） |
| GET | `/visitors/{visitor}` | 单访客档案：用过的 IP 列表 + 功能分布 + 时间线 |
| GET | `/logs` | 明细分页：`?kind=&feature=&ip=&visitor=&path=&status=&include_auto=&limit=&offset=` |
| GET | `/export.csv` | 导出当前筛选结果（UTF-8 BOM，Excel 直开） |
| GET | `/live` | `?since_id=` 增量拉取（实时滚动用） |

### 7.4 维护

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/maintenance` | 库大小、总行数、最早/最晚时间、各 kind 行数、**geo 库版本与覆盖率**（已解析 IP 占比） |
| POST | `/maintenance/purge` | `{before: 'YYYY-MM-DD'}` 按天删除明细（分批 1000 行/次，避免长事务锁库） |
| POST | `/maintenance/backfill` | geo 库更新后，批量回填历史行里地区为空的记录 |

保留策略：明细默认 **90 天**（`LOTTERY_ACCESS_KEEP_DAYS` 可覆盖），清理在应用启动时 + 每天一次；`ip_profile` **永久保留**。**不自动 VACUUM**（会整库加锁），需要时手动触发。

---

## 8. 前端页面设计（`/access`）

### 8.1 结构

```
密码门（复用 PasswordGate 形态）
  └─ KPI 行：今日请求 | 今日独立 IP | 今日独立访客 | 错误率 | P95 耗时
  └─ Tab 1 概览   图表矩阵
  └─ Tab 2 明细   一行一请求（表格）
  └─ Tab 3 IP 聚合 一行一 IP（表格）+ 单 IP 详情
  └─ Tab 4 访客   一行一访客（跨 IP 归并）+ 单访客详情
  └─ Tab 5 地区   省 → 市 下钻 / 运营商分布
```

### 8.2 各 Tab 内容

**Tab 1 · 概览**（recharts）
- 请求量趋势：面积图（近 30 日，可切「按天 / 按小时」）
- 功能域分布：环形图（门户 / 彩票 / 汉字 / 儿歌 / 睡前故事 / 私有管理）
- Top 接口：横向柱状图（含平均耗时标注）
- 状态码分布：堆叠条 + 图例
- 地区排行：条形列表

**Tab 2 · 明细**（用户核心诉求：一行一请求、清晰有条理）
- 列：`时间 | 类型 | 功能 | 方法 + 路径 | 状态 | 耗时 | IP(可点) | 地区 | UA`
- 状态码用彩色徽章（2xx 绿 / 3xx 灰 / 4xx 琥珀 / 5xx 红）
- 筛选条：时间范围 / 功能域 / 类型（接口·页面·探测）/ IP / 访客 / 状态码段 / 关键词
- 分页 + 「导出 CSV」
- 默认隐藏自动化流量（见 §6.3），顶部一个开关可显示

**Tab 3 · IP 聚合**
- 一行一 IP：`IP | 地区 | 运营商 | 请求数 | 页面数 | 功能分布(迷你横条) | 首次 | 末次 | 客户端 | 标签`
- 排序：请求数 / 最近访问；搜索 IP；按标签过滤
- 快捷筛选：**「排除我自己」**（先把自己的 IP 标成 `me`）
- 点 IP → 打开详情弹窗：
  - 头部：IP + 地区 + 运营商 + 标签 / 备注编辑
  - 汇总：请求数 / 页面数 / 首次 / 末次 / 客户端类型
  - 该 IP 的**功能分布**与**接口 Top**
  - **访问时间线**（该 IP 的明细，分页）

**Tab 4 · 访客**（回答「到底来了几个人」）
- 一行一访客：`访客标识(短哈希/序号) | 首次 | 末次 | 活跃天数 | 请求数 | IP 数 | 地区 | 功能分布 | 客户端`
- 点开详情：该访客**用过的所有 IP 列表**（含各自次数与地区）+ 功能分布 + 完整时间线
- ⚠️ 隐私上更敏感，所以只显示**哈希前 8 位**作为标识，可手动给访客起名（存 `visitor_profile`，可复用 `ip_profile` 的思路）

**Tab 5 · 地区**
- 按 国家 → 省 → 市 逐级下钻，每级显示访问量 + 独立 IP + 独立访客
- 运营商分布（电信 / 联通 / 移动 / 云厂商 / 未知）
- 无地区数据时显示「未解析 N 条」+ geo 库状态提示，不静默空白

### 8.3 前端埋点 `common/usePageTrack.ts`

- 监听 `useLocation()` 变化 → `fetch('/api/access/page', {method:'POST', keepalive:true})`，body 带 `{path, title, referer, visitor_id}`。
- `visitor_id` 复用 `localStorage.lottery_visitor_id`（原始 UUID）；**服务端加盐哈希后入库**，与 `visit_visitors` 同盐 → 可关联。
- **自动化环境跳过**：把 `useVisitCount.ts` 里的 `isAutomated()` 抽到 `common/automation.ts`，两处共用。⚠️ 不抽出来就会出现「我自己的 puppeteer 验证脚本把访问管理刷满」——2026-09-30 清洗访问统计时，52 行访客里 48 行是自动化流量刷的，同一个坑不能再踩第二次。
- 私有管理页**也记录**（`is_private=1`）——「谁在敲我的私有功能」正是最该看到的信息。

### 8.4 必须遵守的既有前端硬规则

| 规则 | 原因 |
|---|---|
| 弹窗一律包 `common/Modal.tsx` | `createPortal` 挂 `document.body`，免疫祖先 `transform` / `overflow` 造成的包含块漂移 |
| 带历史栈的弹窗用 `common/useModalHistory.ts` | 内含防重复压栈 + 竞态防护，别自己写 `popstate` |
| 要出场动画再包 `common/ExitPresence` | 关闭后保持挂载 200ms |
| 弹窗滚动分层照抄 story 页配方 | 遮罩 `overflow-y-auto` / 面板 `max-h-[calc(100dvh-5rem)]` / 正文区 `min-h-0 flex-auto`（🔴 别用 `flex-1`） |
| 失败态用 `ErrorBlock`，禁止 `catch()` 静默 | 静默会让页面永远停在骨架屏 |
| 新增任意语义色 / 半透明色 → 回 `index.css` 补 `.site-night` 映射 | 夜间模式映射是白名单式的，不会自动生效 |
| 别用「日期等于当天」做高亮卡判定 | story「今晚的故事」的既有教训 |

---

## 9. 落地任务拆解

| 步 | 内容 | 产出 | 可独立验收 |
|---|---|---|---|
| **0** | **geo 库落地**（⚠️ **已完成预研**，见 §4.2/§4.3）：`tools/geo_update.py` 下载 v4+v6 到 `/data/lottery/geo/`、`verify_from_file()` 校验、抽样查 10 个已知 IP 对答案 | 离线库就位 | 已知 IP 对答案（`218.94.124.82 → 江苏·南京·电信`）；回环返回空而非 `Reserved`；库缺失时服务仍能起 |
| **1** | 后端骨架：`app/access/{config,store,geo,middleware,router}.py` + `main.py` 注册 + flock 建表 + 批量写入线程 | 中间件开始记录 | `sqlite3 access.db 'select count(*) from access_logs'` 随访问增长；地区字段非空 |
| **2** | 认证 + 查询接口全套 | `/api/access/*` 可 curl 通 | 密码门 → 各接口 200；无 cookie → 401 |
| **3** | 前端埋点 + 门户卡片 + 路由 + 导航分支 | 页面级记录生效 | 明细里能看到 `kind='page'` 的行 |
| **4** | 前端页面：密码门 + KPI + Tab1 概览 + Tab2 明细 | `/access` 可用 | 图表渲染、筛选、分页、导出全通 |
| **5** | Tab3 IP 聚合 + Tab4 访客 + Tab5 地区 + 维护 | 完整功能 | 聚合数字与明细 `COUNT(*)` / `COUNT(DISTINCT ip)` 对拍一致 |
| **6** | 部署 + 端到端验证 + `README_access.md` + 记忆 | 上线 | 浏览器实测 + 库行数增长 + 计数不污染 |

### 新增 / 改动文件清单

**后端（新增）**
```
backend/app/access/__init__.py
backend/app/access/config.py        # 库路径 / geo 路径 / 保留天数 / cookie / 忽略名单 / 功能域映射 / 护栏阈值
backend/app/access/geo.py           # ip2region 封装：加载 / 缓存 / 归一化 / 私网识别 / 优雅降级
backend/app/access/store.py         # 建表(flock) / 队列写入 / 聚合查询 / 标注 / 清理 / 回填
backend/app/access/middleware.py    # access_logger
backend/app/access/router.py        # /api/access/*
tools/geo_update.py                 # 离线库下载与更新（多源 + 代理 + 原子替换 + 校验）
```
**后端（改动）**：`main.py`（注册 router + middleware + lifespan 启停）、`requirements.txt` + `pyproject.toml`（加 `py-ip2region`）、`.gitignore`（排除 `backend/.geo/`）

**前端（新增）**
```
frontend/src/access/Access.tsx      # 页面主体 + 密码门
frontend/src/access/api.ts          # 接口封装
frontend/src/access/parts.tsx       # 图表卡 / 表格 / 徽章 / IP·访客 详情弹窗
frontend/src/common/usePageTrack.ts # 页面埋点
frontend/src/common/automation.ts   # 抽出 isAutomated()，与 useVisitCount 共用
```
**前端（改动）**：`App.tsx`（路由）、`Portal.tsx`（APPS 加卡片）、`Nav.tsx`（`useNavLinks` 加 `/access` 分支）、`common/useVisitCount.ts`（改用共享的 `isAutomated`）

**文档**：`README_access.md`（对外接口文档）、本文件

---

## 10. 风险与坑（逐条给对策）

| # | 风险 | 对策 |
|---|---|---|
| 1 | 中间件里同步写 SQLite 阻塞事件循环 | 内存队列 + 后台线程批量写，不用 `await` 写库 |
| 2 | 地区解析拖慢请求 | geo 查询**移出中间件**，放在批量写入线程里做 |
| 3 | 两个 worker 首启建表 `database is locked` → gunicorn master 退出 | `flock` 串行化建表（项目硬规则，已踩过） |
| 4 | 日志写入异常拖垮业务响应 | 全链路 try/except + 队列满丢弃，`v1_call_logger` 同款 |
| 5 | 被扫描器刷爆日志表 | 未知路径 / 4xx → `kind='probe'` 按分钟聚合 |
| 6 | 自噬：查页面本身产生大量记录 | `/api/access/*` 进忽略名单 |
| 7 | 自动化脚本污染数据 | `ua_class` 分类 + 默认过滤 + 埋点侧 `isAutomated()` 跳过 |
| 8 | 明细表无上限增长 | 90 天保留 + 每日清理 + 分批 DELETE（不自动 VACUUM） |
| 9 | **geo 库缺失 / 损坏导致服务起不来** | 三层降级（见 §4.4），加载失败只 WARN，地区字段留空 |
| 10 | **省份名不归一化 → 聚合被拆成多组**；回环返回 `Reserved`；城市/ISP 返回 `0` | `geo.py` 里写死归一化规则（见 §4.3 表），单测覆盖 10 个已知 IP（已实测出全部脏值形态） |
| 11 | 大文件进仓库 | xdb 只放 `/data/lottery/geo/`，`backend/.geo/` 进 `.gitignore` |
| 12 | 服务器下载离线库连不上 GitHub | 多源降级：GitHub raw（走 mihomo 代理）→ jsDelivr（直连，实测 200）→ gitee 镜像 |
| 13 | query 里的密钥被写进日志 | 脱敏：`key` / `token` / `password` / `secret` 一律替换为 `***`；cookie **只存名不存值** |
| 14 | 隐私：站点公开，IP 属个人信息 | 库 0600 / 目录 0700 已有；仅私有入口可见；访客标识只显示哈希前 8 位；提供一键清空 |
| 15 | 前端弹窗 / 滚动 / 夜间模式的老坑 | 严格照 §8.4 清单执行 |
| 16 | 部署验证自己污染统计 | 浏览器脚本走 `guardStats(page)`（`goto()` 之前调用），探测统计只准 GET |

---

## 11. 待你拍板

| # | 选项 | 我的建议 |
|---|---|---|
| Q1 | 明细保留期 | **90 天**（IP 档案永久保留） |
| Q2 | 是否记页面级访问（需前端埋点） | **要** —— 否则 SPA 看不出「访问了哪个功能」 |
| Q3 | IP 存全量 / 掩码 / 哈希 | **全量**（私有功能，仅你可见；掩码后无法排查） |
| Q4 | 是否下载 v6 离线库（+35.5 MB 磁盘、+512 KB 内存） | **要** —— 移动网络大量走 IPv6，不要会有一批访客显示「未解析」 |
| Q5 | 是否记录静态资源 / 视频播放 | **不记**（量级大且走 nginx）；「播放」这类行为改用前端事件补 |
| Q6 | 门户「私有产品」区块加入口 | **加**，tint `amber`，文案「访问管理」 |
| Q7 | 是否加「按访客聚合」Tab | **加** —— 移动 IP 会漂移，只看 IP 会把一个人算成十几个人 |

**没有需要你做的配置** —— CF 不改、nginx 不改、systemd 不改。

---

## 12. 决策记录

| 时间 | 决策 | 理由 |
|---|---|---|
| 2026-09-30 | 采集点放应用层中间件，不用 nginx 日志 | 实测 nginx 日志 IP 全是 `127.0.0.1`（隧道），且 SPA 路由无法区分功能 |
| 2026-09-30 | 独立库 `access.db`，不与 `visit_stats.db` 合库 | 写入量大、清理频繁，隔离避免互相锁；Nav 徽章仍走轻量接口 |
| 2026-09-30 | 统计量实时 `GROUP BY`，不做预聚合表 | 20 万行量级无需预聚合；避免双写不一致 |
| 2026-09-30 | **地区改由内置离线库 `ip2region` 提供，彻底弃用 CF 地理头** | 用户明确不动 CF 配置；离线库不联网、不外发访客 IP、国内精度更高，且顺带给出运营商 |
| 2026-09-30 | geo 缓存策略统一用 `vectorIndex` 而非 `content` | 查询发生在写入线程，QPS < 0.02，对 100 µs 不敏感；省下约 96 MB 内存 |
| 2026-09-30 | **新增「按访客聚合」维度** | 移动网络 IP 频繁漂移，按 IP 聚合会把一个人算成多个人，违背「有哪些访客」的诉求 |
| 2026-09-30 | 自动化流量「记录但标记并默认过滤」，而非丢弃 | 保留可审计性，同时不污染主视图 |
| 2026-09-30 | 地区解析放在后台写入线程，不放中间件 | 请求路径上零 IO / 零索引查询，中间件只剩字符串操作 |
| 2026-09-30 | **步 0 提前做了预研**：服务器实测下载 10.6 MB 库 + 跑通查询（31.3 µs/次）+ 摸清全部脏值形态（`Reserved` / `0` / `省=市` / 长 ISP） | 不让「可行性」停留在纸面；归一化规则是被实测数据逼出来的，不是猜的 |
