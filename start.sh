#!/bin/bash
# VibeForge 本地开发一键启动
# 1) 起 API 代理（Key 藏在 .env.local，端口 11436）
# 2) 起静态服务器（页面在 http://127.0.0.1:8000）
set -e
cd "$(dirname "$0")"

# 启动 API 代理（若未在跑）
if ! curl -s -m 2 http://127.0.0.1:11436/ >/dev/null 2>&1; then
  echo "▶ 启动 DeepSeek 代理 (vibeforge_proxy.py)..."
  nohup python3 vibeforge_proxy.py > /tmp/vibeforge-proxy.log 2>&1 &
  sleep 1
fi

echo "▶ VibeForge 已就绪： http://127.0.0.1:8620"
echo "  (停止：Ctrl+C)"
python3 -m http.server 8620
