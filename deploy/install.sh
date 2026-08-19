#!/usr/bin/env bash
#
# Lottery · 一键部署脚本（无 Docker）
# 在 Ubuntu 服务器上以 root 或 sudo 运行。
# 前置：项目文件已放到 /opt/lottery（含 backend/ frontend/dist/ deploy/）。
#
set -euo pipefail

APP_DIR=/opt/lottery
BACKEND="$APP_DIR/backend"
PY="$BACKEND/.venv/bin/python"
GUNICORN="$BACKEND/.venv/bin/gunicorn"

step() { echo -e "\n\033[36m==> $1\033[0m"; }

step "[1/6] 安装系统依赖 (nginx / python3-venv)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx python3-venv python3-pip git curl

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

step "[3.5/7] 创建持久化数据目录 /data/lottery（独立于部署目录，重部署不丢数据）"
mkdir -p /data/lottery
chown -R ubuntu:ubuntu /data/lottery
# 首次部署：若旧路径有库则迁移过来（幂等，不覆盖已有新库）
if [ -f "$BACKEND/app/data/algo_results.db" ] && [ ! -f /data/lottery/algo_results.db ]; then
  cp "$BACKEND/app/data/algo_results.db" /data/lottery/algo_results.db
  chown ubuntu:ubuntu /data/lottery/algo_results.db
  echo "已迁移旧库 → /data/lottery/algo_results.db"
fi

step "[4/6] 配置 Nginx（80 端口）"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/lottery.conf
ln -sf /etc/nginx/sites-available/lottery.conf /etc/nginx/sites-enabled/lottery.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx

step "[5/7] 配置 systemd 服务（gunicorn）"
cp "$APP_DIR/deploy/lottery.service" /etc/systemd/system/lottery.service
chown -R ubuntu:ubuntu "$APP_DIR"
systemctl daemon-reload
systemctl enable --now lottery

step "[6/7] 配置每日 0:00 全量算法入库（systemd timer）"
cp "$APP_DIR/deploy/lottery-algos.service" /etc/systemd/system/lottery-algos.service
cp "$APP_DIR/deploy/lottery-algos.timer"    /etc/systemd/system/lottery-algos.timer
systemctl daemon-reload
systemctl enable --now lottery-algos.timer
# 装完立刻跑一次（异步，不阻塞 deploy）
systemctl start lottery-algos.service 2>/dev/null || true

step "[7/7] 开放防火墙 80 端口"
ufw allow 80/tcp 2>/dev/null || true

echo -e "\n\033[32m✅ 部署完成！\033[0m"
echo "   访问地址： https://doudoutech.cloud/"
echo "   API 健康检查： curl http://127.0.0.1/api/health"
echo "   查看后端日志： journalctl -u lottery -f"
echo "   查看入库日志： journalctl -u lottery-algos -f"
echo "   下次定时跑批： systemctl list-timers lottery-algos.timer"
echo "   手动立即跑批： systemctl start lottery-algos.service"
echo "   重新抓取数据：  cd $BACKEND && $PY scripts/fetch_data.py"
