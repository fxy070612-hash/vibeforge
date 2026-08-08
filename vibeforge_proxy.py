#!/usr/bin/env python3
"""VibeForge 本地 API 代理（与 codex 无关，专用版）。

作用：浏览器 -> 本代理(11436) -> DeepSeek。
DeepSeek Key 只存在于 .env.local 和这个进程里，前端代码零 Key。

特性：
  - 全参数透传（temperature / max_tokens / stream / response_format 都不丢）
  - 流式响应原样转发（SSE）
  - CORS 允许本机静态页面跨域调用

启动：python3 vibeforge_proxy.py    （或直接跑 ./start.sh）
"""
import json
import os
import sys
import urllib.request
import urllib.error
import http.server

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"

def load_key():
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if key:
        return key
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.local")
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("DEEPSEEK_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

KEY = load_key()

class Handler(http.server.BaseHTTPRequestHandler):
    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        req = urllib.request.Request(
            DEEPSEEK_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {KEY}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                self.send_response(resp.status)
                self._cors_headers()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                while True:  # 流式/大响应分块转发
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(500)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode())

    def do_GET(self):
        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "service": "vibeforge-proxy"}).encode())

    def log_message(self, *a):
        pass  # 静默，避免刷屏

if __name__ == "__main__":
    if not KEY:
        print("!! 缺少 Key：请在 .env.local 里写 DEEPSEEK_API_KEY=sk-... 后重试", file=sys.stderr)
        sys.exit(1)
    server = http.server.HTTPServer(("127.0.0.1", 11436), Handler)
    print("VibeForge 代理运行中： http://127.0.0.1:11436  （只监听本机，安全）", file=sys.stderr, flush=True)
    server.serve_forever()
