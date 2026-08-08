/* ============================================================
 * VibeForge · Cloudflare Worker（生产环境 API 代理）
 *
 * 作用：把浏览器发来的 DeepSeek 请求转发到官方 API，
 *       API Key 只存在 Worker 环境变量里，前端零 Key。
 *
 * 部署（两种方式任选）：
 *   1) 命令行：安装 wrangler 后在项目目录运行
 *        npm i -g wrangler
 *        wrangler deploy   （首次会引导登录 Cloudflare）
 *   2) 控制台：cloudflare.com -> Workers & Pages -> 创建 Worker
 *       粘贴本文件，并在「设置 > 变量和机密」里新增机密
 *       DEEPSEEK_API_KEY = 你的 Key
 *
 * 部署后在 config.js 里把 apiUrl 改成：
 *   https://<你的worker名>.workers.dev/v1/chat/completions
 * ============================================================ */
export default {
  async fetch(request) {
    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const target = "https://api.deepseek.com/v1/chat/completions";
    const resp = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: request.body,
    });

    // 原样转发（含 SSE 流式 / 非流式），加上 CORS 头
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": resp.headers.get("Content-Type") || "application/json",
      },
    });
  },
};
