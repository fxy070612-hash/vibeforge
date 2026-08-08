# VibeForge · AI 项目工坊

> 描述想法 → 选领域 → 调难度 → DeepSeek 帮你生成**可落地的 Vibe Coding 项目** + **创新性打分**

把"找项目 / 做项目 / 评估项目"串成一条链：AI 推荐一个当下热门的具体项目，给出从环境搭建到部署上线的 6 步工作流，再对你这个点子做 5 维创新性打分。纯前端 + DeepSeek，零后端依赖。

## ✨ 功能

| 模块 | 说明 |
| --- | --- |
| 🎲 项目生成 | 一句话想法 + 领域多选 + 难度滑块（1-10），DeepSeek 返回项目名 / 简介 / 技术栈 / 难度 + 6 步工作流 |
| ⚡ 流式输出 | 生成过程逐字显示（可关，`config.js` 里 `stream: false`） |
| 📊 创新性分析 | 独特性 / 市场需求 / 技术可行性 / 替代品稀缺度 / 潜在影响力 5 维打分 + 同类产品 + 评语 |
| 🕘 历史记录 | localStorage 保存最近 10 条，点一下就能重新打开 |
| 📋 复制 / 导出 | 一键复制工作流 Markdown、导出 `.md`、浏览器打印存 PDF |

## 🚀 本地跑起来

```bash
./start.sh
# 打开 http://127.0.0.1:8000
```

`start.sh` 会同时启动：
- **API 代理** `vibeforge_proxy.py`（127.0.0.1:11436）—— 转发 DeepSeek 请求，Key 藏在 `.env.local`，前端零 Key
- **静态服务器**（127.0.0.1:8000）

依赖：Python 3（代理用）、能访问 `api.deepseek.com` 的网络。

## 🔐 安全设计

**Key 永不进入前端代码。** 两条链路都遵循这个原则：

```
本地开发：  浏览器 ──> vibeforge_proxy.py (:11436) ──> api.deepseek.com
生产环境：  浏览器 ──> Cloudflare Worker ──> api.deepseek.com
```

- 本地：`.env.local` 存 Key（已被 `.gitignore` 忽略），代理进程持有
- 生产：Key 存 Cloudflare Worker 的**机密环境变量**，`worker.js` 做转发

## ☁️ 部署上线（可选）

1. **Cloudflare Worker 代理**
   - 命令行：`npm i -g wrangler && wrangler deploy`
   - 或在 Cloudflare 控制台新建 Worker，粘贴 `worker.js`，在「设置 > 变量和机密」里加机密 `DEEPSEEK_API_KEY`
2. **改 `config.js`**：`apiUrl` 换成 `https://<你的worker>.workers.dev/v1/chat/completions`
3. **托管前端**（任一免费方案）：
   - GitHub Pages：把 `index.html / style.css / config.js / app.js` 推仓库，开启 Pages
   - Vercel / Netlify：拖拽目录部署

## 📁 文件结构

```
vibeforge/
├── index.html          # 页面骨架
├── style.css           # 样式
├── config.js           # 配置（apiUrl / model / stream……前端唯一要改的文件）
├── app.js              # 核心逻辑（生成 / 分析 / 历史 / 复制导出）
├── vibeforge_proxy.py  # 本地 API 代理（含 Key，勿上传）
├── worker.js           # Cloudflare Worker 代理（生产用）
├── .env.local          # 本地 Key（gitignore 忽略）
├── .env.example        # 环境变量示例
└── start.sh            # 一键启动
```

## ⚠️ 注意事项

- DeepSeek 是内陆 API，走代理时别让代理配置把 `api.deepseek.com` 挡了。
- 前端 `config.js` 若被改过 `stream: true` 且浏览器不支持流式，会自动提示改回 `false`。
- 生成的 JSON 解析做了容错（容忍 markdown 代码块包裹），极少情况模型返回异常会提示重试。

---
由 DeepSeek 驱动 · 灵感来自 Vibe Coding 社区
