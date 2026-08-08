// ============================================================
// VibeForge 配置（前端唯一需要改的地方）
//
// 【本地开发】apiUrl 指向本机的 vibeforge_proxy.py（端口 11436），
//   DeepSeek Key 只存在 .env.local / 代理进程里，前端完全不碰 Key。
// 【部署上线】把 apiUrl 换成你的 Cloudflare Worker 地址，例如：
//   https://vibeforge.your-name.workers.dev/v1/chat/completions
//   同时把 KEY 的配置从本地代理挪到 Worker 的环境变量里（见 worker.js）。
// ============================================================
const CONFIG = {
  apiUrl: "http://127.0.0.1:11436/v1/chat/completions", // 本地代理 / Cloudflare Worker
  model: "deepseek-chat",          // DeepSeek 模型
  temperature: 0.7,                // 生成推荐时的温度（创意度）
  maxTokens: 1600,                 // 单次输出上限
  stream: true,                    // 生成推荐时流式输出（分析固定非流式）
  historyLimit: 10,                // 本地历史记录条数
};
