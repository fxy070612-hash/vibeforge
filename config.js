// ============================================================
// VibeForge 配置
//
// 【本地开发】默认 apiUrl 指向本机的 vibeforge_proxy.py（端口 11436），
//   DeepSeek Key 只存在 .env.local / 代理进程里，前端完全不碰 Key。
// 【部署公网】部署到 GitHub Pages 后，需要把 API 请求交给一个公网代理：
//   ① 用 Cloudflare Worker（worker.js，Key 放环境变量），部署后得到
//      https://你的worker名.workers.dev/v1/chat/completions
//   ② 填到下面的 publicApiUrl，或部署后在页脚「⚙ API 设置」里填（存浏览器本地）。
//
// 前端自动识别：本机(localhost/127.0.0.1)走本地代理；公网走 publicApiUrl。
// ============================================================
const CONFIG = {
  apiUrl: "http://127.0.0.1:11436/v1/chat/completions", // 本地代理
  publicApiUrl: "",        // ← 部署公网时填你的 Cloudflare Worker 地址
  model: "deepseek-chat",  // DeepSeek 模型
  temperature: 0.85,       // 默认温度（会被野度滑块覆盖）
  maxTokens: 3000,         // 单次输出上限
  stream: true,            // 流式输出
  historyLimit: 10,        // 本地历史条数
};

// 运行时解析 API 地址：① 用户手动保存的覆盖 ② 公网用 publicApiUrl ③ 否则本地代理
(function () {
  try {
    const saved = localStorage.getItem("vibeforge_api_url");
    if (saved) { CONFIG.apiUrl = saved; return; }
    const host = location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (!isLocal && CONFIG.publicApiUrl) CONFIG.apiUrl = CONFIG.publicApiUrl;
  } catch (e) { /* file:// 或隐私模式等，忽略 */ }
})();
