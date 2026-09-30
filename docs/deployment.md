# 部署与运维 · 无 Docker

> 本文讲**怎么上线和运维**：服务器部署流程、数据目录约定、常用运维命令。
> 架构设计见 [architecture.md](./architecture.md)；本地开发环境搭建见 [README.md](../README.md)。

## 服务器部署

生产环境：腾讯云 Ubuntu VM（单核即可），Nginx 监听 8081 对外服务，systemd 管进程，**无 Docker**。

### 1) 同步代码

把**仓库根目录**整体同步到服务器 `/opt/lottery`（前端需先在本地 `npm run build` 生成 `dist/`）：

```bash
# 在本地仓库根执行
cd frontend && npm run build && cd ..
rsync -az --exclude node_modules --exclude .venv --exclude 'app/lottery/data' --exclude '.git' \
  ./ user@<IP>:/opt/lottery/
```

> ⚠️ 必须排除 `app/lottery/data`：本地测试会生成历史数据缓存，若同步覆盖会冲掉服务器数据。
> 生产库已固定在 `/data/lottery/`，与部署目录分离，正常重部署不会清空。

### 2) 一键安装（首次）

在服务器以 root 执行：

```bash
sudo bash /opt/lottery/deploy/install.sh
```

脚本自动完成：装系统依赖（nginx / python3-venv / ffmpeg 等）→ 用 uv 准备 CPython 3.14.5 到
`/opt/python`（不动系统 Python）→ 建 venv 装包 → 爬取数据 →
建 `/data/lottery` 持久化目录（首次迁移旧库）→ 配置 Nginx(:8081) →
注册并启动所有 `deploy/*.service/*.timer`（含未来的新模块服务）→ 开放防火墙。

> 国内服务器拉取 python-build-standalone 需走代理：
> `https_proxy=http://127.0.0.1:7890 sudo -E bash deploy/install.sh`

### 3) 访问

浏览器访问 <https://doudoutech.cloud/>（公网经 Cloudflare Tunnel 穿透；服务器本机可直连 `http://<IP>:8081` 调试）。

## 数据目录约定

| 路径 | 内容 | 重部署是否保留 |
|---|---|---|
| `/data/lottery/*.db` | 各域 SQLite（算法结果 / 故事 / 触发器 / 访问审计 / 下载任务） | ✅ 保留（独立于部署目录） |
| `/data/hanzi/` | 汉字课视频（108 个 mp4） | ✅ 保留 |
| `/data/song/` | 儿歌本地视频（yt-dlp 下载产物） | ✅ 保留 |
| `/data/lottery/geo/` | ip2region 离线库（由 `tools/geo_update.py` 下载，不进仓库） | ✅ 保留 |
| `/opt/lottery/` | 代码 + 前端 dist | 🔄 整体覆盖 |

## 常用运维

```bash
journalctl -u lottery -f              # 后端日志
systemctl restart lottery             # 重启后端
journalctl -u lottery-algos -f        # 每日跑批日志
systemctl start lottery-algos.service # 手动立即跑批
systemctl list-timers                 # 查看全部定时任务（跑批 / B 站刷新等）
cd /opt/lottery/backend && .venv/bin/python scripts/fetch_data.py   # 更新开奖数据
curl -s http://127.0.0.1:8081/api/health   # 健康检查
sudo systemctl restart cloudflared    # 重启隧道（改 /etc/cloudflared/config.yml 后）
sudo nginx -t && sudo systemctl reload nginx   # 改 nginx 配置后
```

## 各域专属运维

- **访问管理离线库更新**：`cd /opt/lottery && ./backend/.venv/bin/python tools/geo_update.py`
  （⚠️ 必须在 `/opt/lottery` 下执行，脚本靠 `__file__/../backend` 定位 binding）
- **算法跑批**：每日 0:00 `lottery-algos.timer` 自动触发；也可算法广场页手动「运行全部」
- **儿歌 B 站链接**：每日 `babysong-bili.timer` 自动校验/找回（搬运下架自动补）；本地视频已下载的歌自动跳过
- **触发器**：进程内 asyncio 调度，重启自动恢复；`curl http://127.0.0.1:8000/api/trigger/status` 看心跳
