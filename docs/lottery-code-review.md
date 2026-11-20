> 本文是 [README_lottery.md](../README_lottery.md) 的代码审查报告（第 3 层文档）。
> 审查日期 2026-11-19｜范围：`backend/app/lottery/` + `backend/app/common/` + `frontend/src/lottery/` + `backend/scripts/` + `deploy/`（约 1.4 万行）。
> **本文只列问题，不含代码改动。** 所有"已复现"条目均在本机 `backend/.venv`（Python 3.14.5）实测，或对线上 `doudoutech.cloud` 直接验证。

# 彩票数据站 · 全量代码审查报告

## 0. 结论先行

四个模块（服务层 / 算法引擎 / 前端 / 脚本与部署）并行审查，共发现 **68 个问题**，其中：

| 档位 | 数量 | 其中已实证复现 |
|---|---|---|
| 严重（数据损坏 / 安全 / 功能确定坏） | 18 | 15 |
| 中（静默失败 / 性能 / 口径错误） | 31 | 18 |
| 轻（死代码 / 可读性 / a11y） | 19 | — |

**最该先动的五件事**：

1. **KNN 标签错位一期**（`similarity.py:27`）—— 7 个距离算法 + knn 全部在用错误的标签训练，修正后推荐号码完全改变。
2. **抓取失败静默回退种子并覆盖真实数据** —— 一次网络抖动就丢 94 期，且 `/refresh` 返回"成功"。
3. **会话令牌无作用域**（`admin.py:83`）—— 只读的 CT 分享口令可走到全站 6 个管理域。
4. **密码锁定可被匿名者做成永久 DoS**（`security.py:80`）—— 正确密码在锁定期也被拒。
5. **上一轮我自己的修复引入了一个回归** —— 期号校验与种子数据期号格式冲突，抓取失败时跑批必崩（详见 §6）。

---

## 1. 严重问题

### 1.1 算法引擎

#### A1 · KNN 标签整体错位一期（`similarity.py:27`）

```python
segs = np.stack([H[i:i + win].ravel() for i in range(n - win - 1)])  # 窗口 i..i+win-1
nxt  = H[win + 1: n]                                                 # ← 应为 H[win:n]
```

窗口 `i` 覆盖 `i..i+win-1`，其"下一期"是 `H[i+win]`，代码取的是 `H[i+win+1]`。

**已复现**（构造矩阵 n=12、win=5）：

```
nxt[i] == H[i+win]    （正确）: False
nxt[i] == H[i+win+1]  （晚一期）: True
```

**影响面**：`dist_euclidean` / `dist_manhattan` / `dist_chebyshev` / `dist_cosine` / `dist_hamming` / `dist_jaccard` / `dist_mahalanobis` + `knn_multi` + `dtw` 共 9 个算法。修好后 ssq top6 从 `[6,9,19,22,31,32]` 变为 `[8,11,13,17,23,24]` —— **推荐结果完全改变**。

> `dtw` 用的是 `H[i+win]`（正确），反证 `_windows` 有问题。

#### A2 · `meta_stack` 线上静默返回均匀分布（`ensemble.py:147` → `backtest.py`）

```python
w = meta_weights(ctx, folds=4, max_cost=1)   # evaluate() 默认 allow_compute=False
```

`evaluate` 缓存未命中直接 `return None`；而生产只写 `folds=200, max_cost=2` 的缓存，**永远不存在 `folds=4, max_cost=1`**。`meta_stack` 于是返回 `red` 全 0.5、`detail={}`。

**已复现**：

```
red 唯一值: {0.5}
detail: {}              ← 连 error 都没有
推荐号码: [1, 31, 30, 29, 28, 27]   ← 完全由 1e-9 jitter 决定
```

前端显示"成功执行、cost=4、耗时 48ms"，用户看不出它是假的。

#### A3 · `bollinger` 恒等于 0.5，是浮点噪声（`timeseries.py:261-272`）

`ma` 与 `cur` 是**同一个量**（`roll` 最后一行窗口恰好等于最后 30 期），于是 `pctb ≡ 0.5`。

**已复现**：`red` 极差 `4.888e-09`，32 个不同值 —— 全部是舍入误差。而 `_run_pool` 的 `normalize` 会把这 `1e-9` 级噪声放大到 `[0,1]`，"超卖优先"的排序完全由浮点误差决定。

#### A4 · `hot_cold` 的"冷号回补"被代数抵消（`statistical.py:66-79`）

```python
return 0.6 * hot + 0.4 * cold * 0.8     # cold = normalize(-ratio)
```

因 `normalize(a) + normalize(-a) ≡ 1`，代入得 `score = 0.32 + 0.28·hot` —— **是 hot 的单调增函数**。

**已复现**：`red` 值域恰为 `(0.32, 0.60)`。算法名、`detail["策略"]`、模块注释三处都声称"冷热平衡"，实际是纯追热。

#### A5 · `gat` 训练目标用了已开奖的最后一期（`deeplearning.py:698`）

```python
nxt = H[-1]      # 最后一期已开奖
target[g] = nxt[gong == g].sum() / max(nxt.sum(), 1)
```

这是全仓唯一真正的"偷看未来"。回测里 `sub_context` 保证 `H[-1]` 是 cut 前最后一期，所以**回测发现不了** —— 线上表现与回测口径不一致。

#### A6 · 空 cuts 产出"结构完整但全零"的回测并落库（`backtest.py:164-165`）

```python
cuts = [c for c in cuts if c >= 200]     # n_all=150 → cuts=[]
```

`f = max(s["folds"], 1)` 兜住除零，于是返回 `folds=0` 但 `algos` 齐全的结果，且写入缓存。实测 `red_ci=[-1.559, 1.559]`（下限为负，无意义）。

#### A7 · Borda 计数对退化算法不公平（`ensemble.py:118-125`）

`safe_run` 失败返回常量 0.5，`np.argsort(-0.5)` 给出**按号码序号**的确定性名次，失败算法把 1、2、3… 系统性排到前面。实测注入 10 个失败算法后 top6 从 `[6,9,18,19,22,24]` 翻转成 `[1,5,6,9,10,19]`。

`_run_pool` 记录了 `ok` 标记却**从未使用**。

### 1.2 服务层与安全

#### A8 · 会话令牌无作用域，只读分享口令可越权全站（`common/admin.py:83-95`）

```python
def sign_session(expires_at: float) -> str:
    payload = str(int(expires_at))        # 只有过期时间，没有 scope
```

`verify_session` 只验 HMAC + 过期，**不区分 cookie 名**。实测：`POST /api/ct/auth`（分享口令）拿到的 `ct_session`，直接当 `ct_admin_session` 请求 `GET /api/ct/admin/exams` → **200**；当 `trigger_session` 请求 `/api/trigger/tasks` → **200**。

`admin.py:31` 的设计前提是"全站只有一个密码"，但 `ctshare` 引入了第二把口令，前提已被破坏。

#### A9 · 密钥文件为空 → `SECRET=b''`，任何人可伪造会话（`admin.py:69-73`）

```python
except FileExistsError:
    data = _SECRET_FILE.read_bytes().strip()   # 不重新校验长度
return data
```

**已复现**：空文件时 `len(data)=0` 仍被返回，`SECRET=b''`。而 `SECRET = _load_secret()` 在 import 时执行一次，**无自愈** —— 文件一旦被清空（磁盘满、误截断、`cp /dev/null`），全站管理域裸奔且不重启永远不恢复。

#### A10 · 密码锁定可被匿名者做成永久 DoS（`security.py:80-85`）

```python
if locked_until > now:
    return False, f"密码错误次数过多，请 {wait} 秒后再试", 429   # ← 根本没验密码
```

**已复现**：

```
5 次错密码 → 30s 锁定
锁定期内用【正确】密码 → 429 密码错误次数过多
```

任何匿名者每 30 秒发一次错密码，即可让站长永久无法 `/run-all`、`/refresh`、登录 6 个管理域。锁定到期后 `fail_count` 也不清零，直接跳下一档。

#### A11 · 抓取失败静默回退种子并覆盖真实数据（`scraper.py:123-126` + `router.py:337`）

`fetch_lottery` 抓取失败只 `log.warning`，随后回退 `_parse_seed`，**返回值没有任何"这是兜底数据"标记**；`/refresh` 无条件 `save_lottery`。

**已量化**：种子 ssq 截止 `2026-04-05`（3435 期），线上真实数据到 `2026-11-17`（3529 期）。一次抖动 → **丢 94 期**，接口还返回 `{"count": 3435, "updated_at": ...}` 看起来"成功"。

#### A12 · 号码只校验个数、不校验范围（`scraper.py:59-63`）

```python
if len(red) != meta["red_count"]: continue   # 不检查 1..red_max
```

`AlgoContext.__init__` 用 `self.RH[i, row-1] = 1.0` 直接下标：`34-1=33` 越界崩；`0-1=-1` **静默写到最后一列**（污染 33 号）。源站改版即全站算法 500。

#### A13 · `/history` 分页越界返回整段数据（`router.py:68-75`）

与已修的 `history_matrix.page_slice` 是**同一 bug 的两份实现，只修了一份**。

**线上实测**：

| page | draws 返回条数 |
|---|---|
| 177（末页） | 9 |
| **200** | **3078 条（261 KB）** |
| 1000 | 0 |

#### A14 · `summary()` 用全局 `MAX(run_date)`，少一个彩种（`results_store.py:260-272`）

```sql
WHERE run_date = (SELECT MAX(run_date) FROM algo_results)
```

两彩种跑批日期不同（跨天、某彩种失败）时直接丢行。实测 ssq 在 `11-10`、dlt 在 `11-09` → **dlt 整行消失**。

#### A15 · `start_all` 部分失败泄漏已置位的 `running`（`runner.py:66-71`）

ssq 抢占成功、dlt 失败 → 只 `global_lock_end()`，**不回滚 ssq**。实测之后 `ssq` 永久 `running=True`、再启动永远 409。**不需要任何异常，正常操作即可触发**。

#### A16 · worker 被杀后 `running=1` 永久残留（`runner.py:52` + `results_store.py:373`）

后台任务是 `daemon=True` 线程，只有 `finally` 会 `progress_finish`。而 `lottery.service` 是 `Restart=always` —— 每次部署/重启/OOM 都杀线程且不执行 finally。`progress_start` 的抢占条件 `WHERE running=0` **没有任何超时回收**。

后果：一次正常部署即可让跑批永久瘫痪，每日 00:00 定时任务静默不跑。

### 1.3 脚本与部署

#### A17 · `--date` 先删数据再崩溃（`run_all_algorithms.py:132-138`）

```python
con.execute("DELETE FROM algo_results WHERE run_date = ?", (args.date,))   # 删两个彩种全部行
print(f"==> ... @ {args.date or datetime.now():%Y-%m-%d %H:%M:%S}")        # ← str 套 %Y 格式符 → ValueError
```

**已实测**：`--date 2026-11-19` → 删前 `[('2026-11-19',170)]`，跑完 `[]`，`EXIT=1`。数据已删、进程已退、无法回滚。

#### A18 · 部署链路三处确定性问题

| 位置 | 问题 | 实测 |
|---|---|---|
| `nginx.conf:18-26` | `/api/` 无 `client_max_body_size` → nginx 默认 1MB，而 CT 照片上限 10MB | 上传 2MB → **413**（nginx HTML，后端那套提示走不到） |
| `install.sh:113-118` | 只 `enable --now`，**服务已在跑时不重启** → 新代码永不生效，脚本却打印"✅ 部署完成" | 全文无 `systemctl restart lottery` |
| `install.sh:126` | `ufw allow 8081/tcp` 把 nginx 明文端口开到公网，绕过 Cloudflare | `http://124.222.39.15:8081/api/health` → **200** |

---

## 2. 中等问题

### 2.1 统计口径与评估

| # | 位置 | 问题 |
|---|---|---|
| M1 | `backtest.py:211` | 200 折训练窗口重叠 87%，`var/f` 低估方差 → CI 偏窄、`passes_fdr` 偏乐观 |
| M2 | `backtest.py:71-88` | `_bh_reject` 只对 `red_p` 校正，`passes_fdr` 完全不反映蓝球，而 `score` 混合两侧 |
| M3 | `backtest.py:260` | `null_red_lift` 是**点估计**而非分布，前端"箱线图对照"实际只有一个点，与 docstring 承诺不符 |
| M4 | `backtest.py:113` vs `results_store.py:78` | `step` 不在 sqlite 缓存键里（内存键有），不同 step 互相污染。实测 `step=7` 拿到 `step=1` 的结果 |
| M5 | `backtest.py:201` | 零假设基线 RNG 种子用**绝对** cut 值，数据追加后同一折的随机对照也变，跨运行不可比 |
| M6 | `config.py` + `base.py:122` | `ALGORITHM_COST_SECONDS` 与实测差 **12–240 倍**。实测 cost=1 的 24 个算法合计 15ms，而预估 0.15s/个 |

### 2.2 前端

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| M7 | `History.tsx:36-58` | 两个 useEffect 无 AbortController、无请求序号 | 快速翻页时**旧页数据覆盖新页**，页码与内容不一致 |
| M8 | `History.tsx:32-34` | `setPage(1)` 与发请求同批次，读到旧 page | 切彩种必多发一次 `(新彩种, 旧页码)` 请求 |
| M9 | `Algorithms.tsx:108-118` | 轮询 `catch(() => {})` **既不停表也不报错** | 一次 5xx → 界面永远"运行中"，按钮永久 disabled，只能刷新整页 |
| M10 | `Algorithms.tsx:71-77` | 回测 503 时 `bt=null` → 走 `: null` 分支 | **回测 tab 整块空白**，用户不知是没数据还是崩了 |
| M11 | `State.tsx:131-137` | `errText` 把 `status>=500` 统一改写 | 后端精心写的 503 文案（"请运行全部生成"）被吞掉 |
| M12 | `Predict.tsx:35` | `savedLatest` 的 404 被当故障 | 首次部署显示红色"加载失败"，**空态被当故障态** |
| M13 | `PredictionMatrix.tsx:76` | `const won = col.prize !== null` | 缺字段时 `undefined !== null` 为 true → **全部列显示中奖绿底** |
| M14 | `PredictionMatrix.tsx:196-249` | 15 行 × 86 列 ≈ 1290 个 Column，无 memo，**每行独立横向滚动** | 切筛选全量重渲染 ~1.3 万节点；要看同一算法列得滚 15 次 |
| M15 | `Algorithms.tsx:246` | Enter 键未判 `pwdLoading`（按钮判了） | 连按 Enter 并发 `POST /run-all` → **误触发 429 锁定** |
| M16 | `usePageTrack.ts:48-66` | 完全无去重，同一 pathname 每次进出都上报 | 访问统计虚高（`useVisitCount` 有 sessionStorage 门闩，这里没有） |
| M17 | `visitor.ts:34-37` | localStorage 不可用时每次返回**新的** anon id | 隐私模式下每次翻页服务端都算一个新访客 |
| M18 | `http.ts:41` | `query()` 丢弃 `v === false` | 未来带布尔开关的参数会被静默吞掉 |
| M19 | `Home.tsx:182` | `title={...（1-${summary?.red_max}）}` | 未就绪时渲染成可见的「红球（1-undefined）」 |
| M20 | `Home.tsx:39` | `stats?.hot_cold.red.hot[0]` 只对 `stats` 做了可选链 | `hot_cold` 缺失即 TypeError 白屏 |

### 2.3 服务层

| # | 位置 | 问题 |
|---|---|---|
| M21 | `history_matrix.py:68-74` | `runs_before` 逐期查询（N+1）。实测 3 页共 **45 次** SQL |
| M22 | `security.py:71-98` | scrypt（45ms）在 `BEGIN IMMEDIATE` 内执行，且与算法结果同库 → 匿名请求可阻塞跑批写库。实测 `progress_update` 被阻塞 0.90s |
| M23 | `router.py:110` | `max_cost=4` 公开无鉴权，单请求 **8.57s** CPU。2 worker 并发 3 个即打满 |
| M24 | `router.py:197,211,222,229` | 只读 sqlite 的接口仍强制 `_get()` 解析 299KB JSON |
| M25 | `results_store.py:196` | `INSERT OR REPLACE` 不清理本批已消失的算法，下线算法永久混入共识计票 |
| M26 | `stats.py:72` | dlt 蓝球池只有 12，`top=10` 时 hot 与 cold **重叠**。实测交集 `{7,8,9,10}` |
| M27 | `gua.py:20-26` | `_hour_to_zhi` 地支整体错位：`0→11`（应为子=1）、`1→12` |
| M28 | `gua.py:56-60` | `_lcg` 用低位取模，最低位严格 `0,1,0,1...`。实测 dlt 后区 66 个组合只覆盖 **36 个**，同奇偶样本 **0 个** |
| M29 | `security.py` vs `ctshare/store.py:291-335` | 锁定逻辑整段复制（~45 行逐字相同，含同样的 A10 缺陷） |
| M30 | `db.py:129-133` | migrations 吞掉**所有** `OperationalError`，`database is locked` / `no such table` 也被吞 |
| M31 | `history_matrix.py:97` vs `:187` | 共识 tiebreak seed 口径不一致（`[-6:]` vs 全串），7 位期号时两页号码分叉 |

### 2.4 运维

| # | 位置 | 问题 |
|---|---|---|
| M32 | `lottery-algos.service` | 无 `Restart=`、无 `OnFailure=`，oneshot 失败即静默躺成 failed |
| M33 | `lottery-algos.timer` | `Persistent=true` 只补"停机错过的"，**不重试失败**的跑批 |
| M34 | `run_all_algorithms.py:164` | `finally` 里 `_progress_finish(k)` 不传 error，崩溃后前端看到"正常完成" |
| M35 | `run_all_algorithms.py:170` | `main()` 无条件 `return 0`，抓取失败/数据未就绪/等锁超时全部当成功 |
| M36 | `run_all_algorithms.py:141` | `_progress_start` 返回值被丢弃，两套入口进度互相踩 |
| M37 | `nginx.conf` `@hanzi_spa`/`@pinzi_spa` | 未复制 `@spa` 的两条守卫。实测 `/hanzi/x.php`、`/hanzi/.env` → **200 + HTML** |
| M38 | `config.py:10` | 开奖数据落在**代码目录**，与 `/data/lottery` 的"重部署不丢"原则冲突 |

---

## 3. 轻量问题（合并）

**死代码**：`base.py` 的 `softmax` / `max_of` / `count_of` / `seed_scores` / `cyclic_distance`；`results_store.py` 的 `import sqlite3`；`runner.py` 的 `_RUNNING`（只写不读）；`config.py` 的 `VERIFY_RATE_LIMIT_PER_SECOND`（全仓无引用）；前端 `TrendMatrix.tsx`（208 行，**无任何页面 import**）；`Algorithms.tsx` 的 `expandedRef`；`api.ts` 的 `latest` / `predict` / `runBatch` / `combined` / `algoSummary`（5 个方法 0 调用方）。

**重复实现**：`_packet` 在 `algorithms/__init__.py` 与 `runner.py` 逐字重复；`_pool` 在 `runner.py` 有两份；`page_slice` 在 `router.py` 与 `history_matrix.py` 各一份（只修了一份 → A13）。

**其他**：`types.ts` 空接口 `LotteryInfo`、`phase` 联合类型被末尾 `| string` 吞掉；`Ball`/`Heatmap` 仅靠颜色区分无 `aria-label`；`TrendChart` 的 `CustomTooltip` 定义在组件体内；列表 `key={i}`；`physics.py:145` Neumann 边界少一半；`metaphysics.py:684` 时令映射 20/24 判错；`poisson_emulator` 的 `rng` 是死变量。

---

## 4. 测试有效性：哪些断言是假的

`verify_lottery_metrics.py` 宣称 42 条，**实测上限 36 条**（条数随库状态漂移：空库 30 / 仅 ssq 33 / 全量 36）。

| 段 | 条数 | 真能失败 | 假通过/装饰 |
|---|---|---|---|
| A | 3 | 2 | 1 |
| B | 6 | **6** | 0 |
| C | 4 | 2 | 2 |
| **D** | 6 | **0** | **6（全假）** |
| E / E2 | 5 | 0 | 5 |
| E 缓存段 | 6 | 0 | **6（静默跳过）** |
| F | 10 | **10** | 0 |
| G | 2 | 2 | 0 |
| 合计 | 36 | **22** | **14** |

**D 段全假的实证**：`check_D` 自己硬编码 `red_scores`/`blue_scores` 再喂给 `save_batch`，证明的只是"SQLite 能存 JSON 数组"。注入验证——把 `scores_to_picks` 改成不产出这两个字段，D 段**依然全绿**。

**E/E2 是常量比常量**：`_SYSTEMD_TIMEOUT_SEC = 1800` 是手抄 unit 文件、`_SERVER_SEC_PER_FOLD` 是手抄的历史实测值，脚本重跑不重新测。且**只算回测**，没算爬取（2×60s）、预测（~18s）、以及等锁的 900s（1192+900=2092s 已超 1800s）。

**E 缓存段的"跳过"**：`else: print("· 跳过…")` 不计入 `CHECKS`、不影响退出码 —— 干净机上这 6 条从未执行却算进"全绿"。

**其他假绿**：`check_algos.py` 空输入当成功；`selftest.py` 用 `os.environ.setdefault`，环境里已有 `LOTTERY_DB_DIR=/data/lottery` 时会**改生产口令**；`selftest.py` 不幂等（连跑第二次 9/11）。

---

## 5. 与上一轮改动的交互（重要）

上一轮的 5 个 P0 修复本身是对的（共识计票、蓝球可复现、回测加 CI），但审查发现它们与既有代码有 3 处冲突：

### 5.1 期号校验与种子数据冲突（**我引入的回归**）

`_validate_issue_bases`（`results_store.py:141`）要求期号是 **5 位数字**，而 `_parse_seed`（`scraper.py:100`）产出 **7 位**（`2026001`）。

**实测**：

```
种子 ssq 期号: ['2003001', '2003002', ...]  期号长度集合: [7]
校验结果: ValueError: ssq: 期号格式非法 ['2026037']（应为 5 位数字）
```

**后果**：抓取一旦失败 → 回退种子（A11）→ `save_batch` 抛 `ValueError` → **整次跑批中断**，而本地数据已被种子覆盖。两个 bug 叠加成"数据回退且跑不出结果"。

### 5.2 `page_slice` 只修了半套

上一轮修了 `history_matrix.page_slice`，但 `router.history` 里的**另一份同名实现没修** —— 就是 A13（线上 page=200 返回 3078 条）。

### 5.3 回测成本评估未计入等锁时间

E2 断言只算了 `per_fold × folds × 2`，漏掉 `run_all_algorithms.py:103-115` 的 **900s 等锁**。`1192 + 900 = 2092s > 1800s`，超时依然可能发生。

---

## 6. 修复优先级建议

```
P0（本周，数据/安全）
  A11 + 5.1  抓取失败标记 source，校验与种子期号对齐（同一链路，一起改）
  A1         KNN 标签错位（改一行，影响 9 个算法）
  A8 + A9    会话作用域 + 密钥长度校验
  A10        锁定期间仍验密码
  A17        --date 分支（或直接删掉该参数）

P0（本周，可用性）
  A16 + A15  stale 回收 + 启动回滚（否则一次部署就跑批瘫痪）
  A13        router.history 复用 page_slice
  A18        nginx 1MB / install.sh 不重启 / 8081 暴露

P1（下周）
  A2 + A3 + A4 + A5  算法退化与泄漏（meta_stack / bollinger / hot_cold / gat）
  A6 + A7            空 cuts 不落库；Borda 过滤 ok=False
  A14        summary 按彩种分组
  A12        号码范围校验

P2
  M1-M6      统计口径（bootstrap / 蓝球校正 / 分布化 null）
  M7-M20     前端竞态、空白页、错误态
  M21-M31    性能与口径

P3
  测试有效性（D 段重写、E/E2 改实测、条数写死基线）
  死代码清理
```

---

## 7. 审查方法与边界

- **四个模块并行审查**，各自完整通读 + 本机实测复现，最终由我逐条复核关键结论（A1/A8/A9/A10/A13/A14/A15/A17、A2/A3/A4、M13/M16、D 段假绿均已亲测）。
- **未覆盖**：`deeplearning.py` / `quantum.py` / `metaphysics.py` / `physics.py` / `symbolic.py` / `signal_img.py` 仅抽查（共约 2400 行），其余算法模块完整读过。
- **验证环境**：所有实测用 `LOTTERY_DB_DIR=/tmp/...` 隔离库，**未触碰 `/data/lottery`**；线上验证只发 GET。
- **副作用**：审查期间有一次本地 `run_all_algorithms.py` 执行刷新了 `backend/app/lottery/data/*.json`（期数与原先一致：3529/2950），该文件是 gitignore 的运行时缓存，`git status` 干净。
- **临时文件与后台进程**：已全部清理，无残留。

---

## 附：明确核对「没有问题」的部分（避免重复排查）

| 项 | 结论 |
|---|---|
| `batch_by_dates` 的 SQL 拼接 | **安全**，拼的是占位符个数，参数全走绑定 |
| `prizes.py` 奖级表 | 双色球 6 级 / 大乐透 9 级逐条对照官方规则**全部正确** |
| `page_slice`（history_matrix）的越界修复 | **正确** |
| `backtest.evaluate` 只读缓存的设计 | **正确**，`allow_compute=False` 默认值合理 |
| `backtest_claim` 跨进程互斥 | **有效**，8 进程并发仅 1 个成功 |
| `progress_start` / `global_lock_start` 的抢占原子性 | **有效**（问题在缺过期回收，不在抢占本身） |
| SPA fallback 三条规则（nginx vs main.py） | **对齐**，实测 `/.env`、`/.git/config`、`/wp-login.php`、`/backup.zip` 全部 404 |
| `ScoreShapeError` 在真实数据上的触发 | **0 次**，89 个算法打分长度全部合规 |
| 密码/密钥硬编码 | `deploy/` 与 scripts 里**零命中**；scrypt + 库存储设计正确 |
