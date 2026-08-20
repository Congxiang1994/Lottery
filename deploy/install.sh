#!/usr/bin/env bash
#
# Lottery · 一键部署脚本（无 Docker，聚合门户 + 多模块）
#
# 在 Ubuntu 服务器上以 root 或 sudo 运行。
# 前置：仓库根已同步到 /opt/lottery（含 backend/ frontend/dist/ deploy/）。
#
# 约定：
#   - 前端：Nginx 在 8081 托管 frontend/dist（SPA），反代 /api → gunicorn:8000
#   - 公网访问：Cloudflare Tunnel 穿透到 8081（国内未备案域名免拦截，自带 HTTPS）
#   - 后端：gunicorn 起 FastAPI；算法结果落 /data/lottery（独立于部署目录，重部署不丢）
#   - 扩展：未来新模块只需在 deploy/ 放 <module>.service(+.timer)，本脚本会自动注册
#
set -euo pipefail

APP_DIR=/opt/lottery
BACKEND="$APP_DIR/backend"
PY="$BACKEND/.venv/bin/python"
GUNICORN="$BACKEND/.venv/bin/gunicorn"

step() { echo -e "\n\033[36m==> $1\033[0m"; }

step "[1/6] 安装系统依赖 (nginx / python3-venv / ffmpeg)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx python3-venv python3-pip git curl ffmpeg

step "[2/6] 创建 Python 虚拟环境并安装后端依赖"
python3 -m venv "$BACKEND/.venv"
"$PY" -m pip install --upgrade pip -q
"$PY" -m pip install -r "$BACKEND/requirements.txt" -q

step "[3/6] 抓取 / 校准历史数据（500彩票网）"
if (cd "$BACKEND" && PYTHONPATH="$BACKEND" "$PY" scripts/fetch_data.py); then
  echo "数据抓取完成"
else
  echo "⚠️ 抓取失败，将使用已附带的历史数据（ssq.json / dlt.json）"
fi

step "[3.5/6] 创建持久化数据目录 /data/lottery（独立于部署目录，重部署不丢数据）"
mkdir -p /data/lottery
chown -R ubuntu:ubuntu /data/lottery

# edu 模块（智慧教育平台资源下载助手）下载目录，独立于彩票数据
mkdir -p /data/edu
chown -R ubuntu:ubuntu /data/edu
# 首次部署：若旧路径有库则迁移过来（幂等，不覆盖已有新库）
if [ -f "$BACKEND/app/data/algo_results.db" ] && [ ! -f /data/lottery/algo_results.db ]; then
  cp "$BACKEND/app/data/algo_results.db" /data/lottery/algo_results.db
  chown ubuntu:ubuntu /data/lottery/algo_results.db
  echo "已迁移旧库 → /data/lottery/algo_results.db"
fi

step "[4/6] 配置 Nginx（listen 8081，反代 /api，SPA 回退）"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/lottery.conf
ln -sf /etc/nginx/sites-available/lottery.conf /etc/nginx/sites-enabled/lottery.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx

step "[5/6] 注册并启动 systemd 服务（自动发现 deploy/ 下所有 *.service / *.timer）"
# 先复制所有单元文件
shopt -s nullglob
units=("$APP_DIR"/deploy/*.service "$APP_DIR"/deploy/*.timer)
shopt -u nullglob
for u in "${units[@]}"; do
  cp "$u" /etc/systemd/system/"$(basename "$u")"
done
systemctl daemon-reload

# 收集 timer 名（由 timer 驱动的 service 不应 enable --now）
timers=()
for t in "$APP_DIR"/deploy/*.timer; do
  [ -e "$t" ] || continue
  timers+=("$(basename "$t" .timer)")
done

# 启用所有 timer（定时调度）
for name in "${timers[@]}"; do
  systemctl enable "$name.timer"
done

# 启用所有 service；若存在同名 timer，则交给 timer 驱动（不 enable --now）
for s in "$APP_DIR"/deploy/*.service; do
  [ -e "$s" ] || continue
  svc="$(basename "$s" .service)"
  is_timer_driven=0
  for name in "${timers[@]}"; do
    [ "$name" = "$svc" ] && is_timer_driven=1
  done
  if [ "$is_timer_driven" -eq 1 ]; then
    echo "  · $svc.service 由 ${svc}.timer 驱动，跳过 enable --now"
  else
    systemctl enable --now "$svc.service"
  fi
done

# 首次部署：立即跑一次被 timer 驱动的入库任务（异步，不阻塞）
for name in "${timers[@]}"; do
  systemctl start "$name.service" 2>/dev/null || true
done

step "[6/6] 开放本地防火墙 8081（Cloudflare Tunnel 走出站，公网无需入站放行）"
ufw allow 8081/tcp 2>/dev/null || true

echo -e "\n\033[32m✅ 部署完成！\033[0m"
echo "   公网访问： https://doudoutech.cloud/   （Cloudflare Tunnel → Nginx:8081）"
echo "   本机调试： http://127.0.0.1:8081/"
echo "   API 健康检查： curl http://127.0.0.1:8000/api/health"
echo "   查看后端日志： journalctl -u lottery -f"
echo "   查看入库日志： journalctl -u lottery-algos -f"
echo "   下次定时跑批： systemctl list-timers lottery-algos.timer"
echo "   手动立即跑批： systemctl start lottery-algos.service"
echo "   重新抓取数据： cd $BACKEND && $PY scripts/fetch_data.py"
