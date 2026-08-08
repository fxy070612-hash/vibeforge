/* ============================================================
 * VibeForge 核心逻辑
 *  - 生成推荐（流式输出，双响应格式兼容）
 *  - 创新性分析（5 维打分）
 *  - 历史记录（localStorage）
 *  - 复制 / 导出 Markdown
 *  - Key 永不进入前端：所有请求走本地代理 / Cloudflare Worker
 * ============================================================ */

/* ---------- 提示词（核心资产） ---------- */
const SYSTEM_PROMPT = `你是一位疯狂的 Vibe Coding 导师。用户会提供：想法、领域（可能很具体）、难度（1-10，越大越难）。

你的使命：推荐一个【具体、反套路、让人看完立刻想动手】的项目。宁可怪，不要平庸。

创作铁律：
1. 绝对禁止烂大街项目：待办清单、番茄钟、记账本、博客、天气应用、随机数工具、纯增删改查、仿某官网。除非你给它们一个真正让人拍大腿的 twist。
2. 每个项目必须有一个"记忆点 hook"：反常识设定 / 反差玩法 / 出人意料的组合 / 极客梗 / 有传播力的细节。让人一眼觉得"这个有意思，我要开做"。
3. 必须 2-3 天内能用 Vibe Coding 落地：纯前端 + 免费 API 优先，别推荐需要烧钱服务器的项目。
4. 参考真实存在的爆款小项目的"具体感"，但不要照抄。

输出要求（必须严格遵守）：
1. 只返回一个 JSON 对象。不要任何解释、不要用 markdown 代码块包裹。
2. JSON 结构如下：
{
  "project_name": "响亮的名字，最好带梗或反差（中文）",
  "hook": "一句话记忆点：为什么有意思/为什么能火（30字内，越具体越好）",
  "description": "120字内简介：是什么 + 好玩在哪",
  "tech_stack": "具体技术栈（含具体库/API 名称，纯前端+免费 API 优先）",
  "difficulty_label": "入门/简单/中等/进阶/困难 之一",
  "features": [
    {"name": "核心功能名", "detail": "该功能独特的细节：做到什么效果、用户会有什么体验"}
  ],
  "workflow": [
    {"step": 1, "title": "环境搭建", "content": "…", "skill": "技能关键词（如 React Hooks）", "github": "真实开源地址或 \"\""},
    {"step": 2, "title": "PRD 撰写", "content": "…", "skill": "…", "github": "…"},
    {"step": 3, "title": "原型构建", "content": "…", "skill": "…", "github": "…"},
    {"step": 4, "title": "核心功能迭代", "content": "…", "skill": "…", "github": "…"},
    {"step": 5, "title": "调试优化", "content": "…", "skill": "…", "github": "…"},
    {"step": 6, "title": "部署上线", "content": "…", "skill": "…", "github": "…"}
  ],
  "similar_projects": [
    {"name": "相似开源项目名", "url": "https://github.com/…", "fit": 85, "note": "像在哪/可借鉴什么（一句话）"}
  ]
}
3. features 给 3-5 个，每个都要有一个具体、好玩的细节（不是"支持上传""响应式布局"这种废话）。
4. workflow 恰好 6 步，顺序固定：环境搭建、PRD 撰写、原型构建、核心功能迭代、调试优化、部署上线。
   每步 content 必须具体到能直接照做：用什么工具、敲什么命令、建什么文件、怎么用 AI 写这段、做完怎么验收。每步 60-150 字。
5. difficulty_label 与难度匹配：1-3 入门，4-6 中等，7-8 进阶，9-10 困难（越难功能越复杂、技术越深）。
6. workflow 每一步附 1 个推荐 skill（技能关键词，如 "React Hooks"）和 1 个 github 开源地址。github 只给确定真实存在、广为人知的仓库（官方文档/常用库/知名模板），不确定就写空字符串 ""，严禁编造不存在的链接。
7. similar_projects 列 2-4 个【真实存在】的相似开源项目（给 GitHub 地址），fit 是 0-100 的拟合度（越高越像这个想法），note 一句话说明像在哪、能借鉴什么。拿不准真实性的项目不要列，严禁编造不存在的仓库。`;

const ANALYSIS_PROMPT = `你是产品创新顾问。用户给出一个项目，请判断市场上是否已有类似产品，并从 5 个维度打分（每个 1-10 分）：
novelty 独特性、demand 市场需求、feasibility 技术可行性、competition 替代品稀缺度、impact 潜在影响力。

输出要求（必须严格遵守）：
1. 只返回一个 JSON 对象。不要任何解释、不要用 markdown 代码块包裹。
2. JSON 结构如下：
{
  "existing_projects": [{"name": "现有产品名", "note": "一句话说明相似之处"}],
  "scores": {"novelty": 8, "demand": 7, "feasibility": 9, "competition": 6, "impact": 8},
  "total_score": 38,
  "comment": "80 字内的犀利评语"
}
3. total_score = 5 个维度分数之和（满分 50）。
4. existing_projects 列 1-3 个真实存在的类似产品；若确实没有，返回空数组 []。
5. 如果用户提供了「相似开源项目」清单，comment 必须点名其中 1-2 个做对比，明确说出这个项目与它们的不同点、优势或风险。`;

const CANDIDATES_PROMPT = `你是 Vibe Coding 创意策划。基于用户提供：想法、领域、难度（1-10）、野度（1-10），一次性给出 3 个【截然不同】的项目候选方向。

要求：
1. 3 个方向差异越大越好（比如：一个游戏化、一个工具型、一个社交/内容向），不要都是同一种类型。
2. 每个候选都要有记忆点 hook、不要烂大街（禁待办清单/番茄钟/记账本/博客/天气）。
3. 都要 2-3 天能用 Vibe Coding 落地（纯前端 + 免费 API 优先）。

只返回一个 JSON 对象（不要解释、不要 markdown 代码块）：
{
  "candidates": [
    {"name": "方向名", "hook": "一句话记忆点", "desc": "一句话简介", "difficulty_label": "入门/简单/中等/进阶/困难", "tech_stack": "技术栈"},
    {"name": "…", "hook": "…", "desc": "…", "difficulty_label": "…", "tech_stack": "…"},
    {"name": "…", "hook": "…", "desc": "…", "difficulty_label": "…", "tech_stack": "…"}
  ]
}`;

const DETAIL_PROMPT = `你是资深的产品与工程方案撰写人。下面是一个待落地的 Vibe Coding 项目方案。
请为它写一篇【约 2000 字】的详细项目方案介绍。纯文本，用空行分段，用「一、二、三…」分章，不要用 markdown 标题符号（不要 #、**），不要 JSON。

内容必须覆盖：
一、项目背景与灵感：为什么做、解决什么问题、灵感从哪来
二、产品定位与目标用户：给谁用、什么场景、什么心情下会用
三、核心功能详解：把每个功能展开说清楚（怎么操作、用户会有什么体验）
四、技术实现思路：技术栈、核心模块怎么划分、数据存哪、用哪些关键 API
五、关键难点与解决方案：开发中会卡住的点 + 具体怎么破
六、用户体验与设计细节：交互、视觉、值得记住的小彩蛋
七、亮点与差异化：跟别人的方案哪里不一样、为什么可能火
八、迭代方向：上线后第一版要改进什么

写满约 2000 字，有血有肉、具体可执行，别写空话。`;

/* ---------- 领域 & 常量 ---------- */
/* 领域数据在 fields.js：FIELD_CATEGORIES（15 类 × 120 个）/ ALL_FIELDS */
const LEVEL_LABEL = ["", "入门", "入门", "入门", "中等", "中等", "中等", "进阶", "进阶", "困难", "困难"];
const WILD_LABEL = ["", "稳如老狗", "稳妥", "务实", "小惊喜", "适中", "有点野", "放飞", "很野", "超野", "彻底放飞"];
const SCORE_MAP = [
  ["novelty", "独特性"],
  ["demand", "市场需求"],
  ["feasibility", "技术可行性"],
  ["competition", "替代品稀缺度"],
  ["impact", "潜在影响力"],
];
const HISTORY_KEY = "vibeforge_history_v1";

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const fieldsBody = $("fieldsBody");
const fieldSearch = $("fieldSearch");
const fieldCount = $("fieldCount");
const clearFieldsBtn = $("clearFieldsBtn");
const ideaInput = $("ideaInput");
const micBtn = $("micBtn");
const difficultySlider = $("difficultySlider");
const difficultyDisplay = $("difficultyDisplay");
const wildnessSlider = $("wildnessSlider");
const wildnessDisplay = $("wildnessDisplay");
const generateBtn = $("generateBtn");
const randomBtn = $("randomBtn");
const outputArea = $("outputArea");
const resultCard = $("resultCard");
const apiSetBtn = $("apiSetBtn");
const chatWrap = $("chatWrap");
const chatMsgs = $("chatMsgs");
const chatInput = $("chatInput");
const chatSendBtn = $("chatSendBtn");
const chatCloseBtn = $("chatCloseBtn");
const historyCard = $("historyCard");
const historyList = $("historyList");
const historySearch = $("historySearch");
const clearHistoryBtn = $("clearHistoryBtn");
const toast = $("toast");

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 1800);
}

/* 统一提取响应文本：兼容标准 chat completions 和本地代理的 Responses 格式 */
function extractText(data) {
  if (!data) return "";
  if (data.choices && data.choices[0] && data.choices[0].message && typeof data.choices[0].message.content === "string") {
    return data.choices[0].message.content;
  }
  if (data.output && data.output[0] && data.output[0].content) {
    const c = data.output[0].content;
    if (typeof c === "string") return c;
    const t = c.map((x) => (x && x.text) || "").join("");
    if (t) return t;
  }
  if (data.error) throw new Error(data.error.message || data.error || "API 错误");
  return "";
}

/* 流式 SSE 单行 delta：兼容 chat 格式与 Responses 格式 */
function extractDelta(obj) {
  if (!obj || typeof obj !== "object") return "";
  // Responses 格式：只取 output_text.delta 事件（done/completed 不再重复取）
  if (obj.type) {
    if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") return obj.delta;
    return "";
  }
  // 标准 chat 格式
  if (obj.choices && obj.choices[0] && obj.choices[0].delta && typeof obj.choices[0].delta.content === "string") {
    return obj.choices[0].delta.content;
  }
  return "";
}

/* 从文本里抠出合法 JSON（容忍 markdown 代码块/前后缀） */
function parseJsonFromText(text) {
  let t = String(text).trim();
  // 剥离 markdown 代码块围栏（```json ... ```）
  t = t.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (e) { /* 继续尝试整段 */ }
  }
  try { return JSON.parse(t); } catch (e) {}
  throw new Error("AI 返回的内容不是合法 JSON，请重试或调低野度");
}

/* ---------- API 调用（支持流式 / 非流式） ---------- */
async function callChat(messages, { temperature = CONFIG.temperature, stream = false, onDelta = null, json = true, maxTokens = CONFIG.maxTokens } = {}) {
  const body = {
    model: CONFIG.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };
  // 需要结构化输出时强制 JSON 模式；聊天/追问是自由文本，关掉
  if (json) body.response_format = { type: "json_object" };

  if (stream) {
    const resp = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(await readError(resp));
    if (!resp.body) throw new Error("当前浏览器不支持流式读取，请在 config.js 把 stream 改为 false");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // 末行可能不完整，留到下一轮
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const dataStr = t.slice(5).trim();
        if (dataStr === "[DONE]") continue;
        try {
          const d = extractDelta(JSON.parse(dataStr));
          if (d) { full += d; onDelta && onDelta(d); }
        } catch (e) { /* 跳过解析失败的零散行 */ }
      }
    }
    return full;
  }

  const resp = await fetch(CONFIG.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await readError(resp));
  return extractText(await resp.json());
}

async function readError(resp) {
  let msg = `HTTP ${resp.status}`;
  try {
    const d = await resp.json();
    msg = (d.error && d.error.message) || msg;
  } catch (e) { /* ignore */ }
  return msg;
}

/* ---------- 状态 ---------- */
let selectedFields = [];
let currentProject = null;

/* ---------- 初始化 UI ---------- */
function initFields() {
  fieldsBody.innerHTML = "";
  FIELD_CATEGORIES.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "field-group collapsed";
    group.dataset.name = cat.name;

    const head = document.createElement("div");
    head.className = "field-group-head";
    const left = document.createElement("span");
    left.className = "field-group-left";
    const caret = document.createElement("span");
    caret.className = "field-group-caret";
    caret.textContent = "▸";
    const title = document.createElement("span");
    title.className = "field-group-title";
    title.textContent = cat.name;
    const cnt = document.createElement("span");
    cnt.className = "field-group-count";
    cnt.textContent = `${cat.items.length}`;
    left.append(caret, title, cnt);

    const actions = document.createElement("span");
    actions.className = "field-group-actions";
    const selAll = document.createElement("button");
    selAll.className = "link-btn";
    selAll.textContent = "全选";
    const clr = document.createElement("button");
    clr.className = "link-btn";
    clr.textContent = "清空";
    actions.append(selAll, clr);

    head.append(left, actions);
    head.onclick = (e) => {
      if (e.target.closest(".link-btn")) return; // 点按钮不触发折叠
      group.classList.toggle("collapsed");
      caret.textContent = group.classList.contains("collapsed") ? "▸" : "▾";
    };

    const chips = document.createElement("div");
    chips.className = "field-chips";
    cat.items.forEach((name) => {
      const tag = document.createElement("span");
      tag.className = "field-tag";
      tag.textContent = name;
      tag.dataset.field = name;
      tag.dataset.group = cat.name;
      tag.onclick = () => { tag.classList.toggle("active"); syncSelected(); };
      chips.appendChild(tag);
    });

    selAll.onclick = () => setGroup(cat.name, true);
    clr.onclick = () => setGroup(cat.name, false);

    group.append(head, chips);
    fieldsBody.appendChild(group);
  });

  fieldSearch.addEventListener("input", searchFields);
  clearFieldsBtn.onclick = clearAllFields;
  updateFieldCount();
}

/* ---------- 领域选择辅助 ---------- */
function syncSelected() {
  selectedFields = Array.from(document.querySelectorAll(".field-tag.active")).map((el) => el.dataset.field);
  updateFieldCount();
}

function setGroup(catName, on) {
  document.querySelectorAll(`.field-tag[data-group="${catName}"]`).forEach((el) => el.classList.toggle("active", on));
  syncSelected();
}

function clearAllFields() {
  document.querySelectorAll(".field-tag.active").forEach((el) => el.classList.remove("active"));
  syncSelected();
}

function updateFieldCount() {
  fieldCount.textContent = selectedFields.length
    ? `已选 ${selectedFields.length} 项（${selectedFields.length} / ${ALL_FIELDS.length}）`
    : "已选 0 项 · 默认全领域";
  document.querySelectorAll(".field-group").forEach((group) => {
    const cnt = group.querySelector(".field-group-count");
    if (!cnt) return;
    const tags = group.querySelectorAll(".field-tag");
    const n = group.querySelectorAll(".field-tag.active").length;
    cnt.textContent = n ? `${tags.length} · 已选 ${n}` : `${tags.length}`;
  });
}

function searchFields() {
  const q = fieldSearch.value.trim().toLowerCase();
  document.querySelectorAll(".field-group").forEach((group) => {
    let visible = 0;
    group.querySelectorAll(".field-tag").forEach((tag) => {
      const hit = !q || tag.textContent.toLowerCase().includes(q);
      tag.style.display = hit ? "" : "none";
      if (hit) visible++;
    });
    const show = visible > 0;
    group.style.display = show ? "" : "none";
    if (show && q) { // 搜索时自动展开命中的组
      group.classList.remove("collapsed");
      const caret = group.querySelector(".field-group-caret");
      if (caret) caret.textContent = "▾";
    }
  });
}

function updateDifficulty() {
  const v = parseInt(difficultySlider.value, 10);
  difficultyDisplay.textContent = `Lv.${v} · ${LEVEL_LABEL[v]}`;
}

function updateWildness() {
  const v = parseInt(wildnessSlider.value, 10);
  wildnessDisplay.textContent = `Lv.${v} · ${WILD_LABEL[v]}`;
}

/* 野度(1-10) → temperature：0.2（稳）→ 1.15（放飞，但保持可读） */
function wildToTemp(w) {
  const v = Math.max(1, Math.min(10, w));
  return Math.round((0.2 + ((v - 1) / 9) * 0.95) * 100) / 100;
}

/* 野度 → 给 AI 的动态创作指令（高野度也强制"逻辑自洽"，防语无伦次） */
function wildHint(w) {
  if (w <= 3) return `野度=${w}：求稳！推荐靠谱、成熟、马上能落地的项目，中规中矩也行，关键是实用。`;
  if (w <= 7) return `野度=${w}：适中！推荐有记忆点、好玩、带点脑洞的项目，别太离谱。`;
  return `野度=${w}：很野！允许大胆脑洞、极客梗、反常识设定、冒犯性幽默，但必须逻辑自洽、让人看得懂、2-3 天能做出来。宁可怪得有道理，不要乱。`;
}

/* 示例快捷填充 */
document.querySelectorAll(".qs-chip").forEach((chip) => {
  chip.onclick = () => {
    ideaInput.value = chip.dataset.idea;
    ideaInput.focus();
  };
});

/* ---------- 生成推荐 ---------- */
let lastWild = 5; // 记录最近一次野度，供"深入展开"沿用

async function generateProject() {
  const idea = ideaInput.value.trim() || "没有具体想法，请推荐一个当下热门、好玩又好上手的 Vibe Coding 项目";
  const fields = selectedFields.length ? selectedFields.join("、") : "全领域";
  const level = parseInt(difficultySlider.value, 10);
  const wild = parseInt(wildnessSlider.value, 10);
  lastWild = wild;
  const temperature = wildToTemp(wild);

  setBusy(true);
  outputArea.hidden = false;
  resultCard.innerHTML = loadingHTML("正在为你策划 3 个候选方向…");
  streamText = "";
  showStream("");

  const messages = [
    { role: "system", content: CANDIDATES_PROMPT },
    { role: "user", content: `想法：${idea}\n领域：${fields}\n难度：${level}/10\n${wildHint(wild)}` },
  ];

  try {
    let text;
    if (CONFIG.stream) {
      text = await callChat(messages, { temperature, stream: true, onDelta: (d) => showStream((streamText += d)) });
    } else {
      showStreamHint();
      text = await callChat(messages, { temperature, stream: false });
    }
    const parsed = parseJsonFromText(text);
    const cands = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    if (!cands.length) throw new Error("候选方案为空，请重试");
    renderCandidates(cands);
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    resultCard.innerHTML = `<div class="error-msg">❌ 生成失败：${esc(e.message)}</div>`;
  } finally {
    setBusy(false);
  }
}

/* 渲染 3 个候选方向卡片 */
function renderCandidates(cands) {
  resultCard.innerHTML = `
    <div class="cand-title">🎯 3 个候选方向（选一个深入）</div>
    <div class="cand-grid">
      ${cands.slice(0, 3).map((c, i) => `
        <div class="cand-card">
          <div class="cand-badge">候选 ${i + 1}</div>
          <div class="cand-name">${esc(c.name || "未命名")}</div>
          <div class="cand-hook">💡 ${esc(c.hook || "")}</div>
          <div class="cand-desc">${esc(c.desc || "")}</div>
          <div class="cand-chips">
            ${c.tech_stack ? `<span class="chip chip-tech">🛠 ${esc(c.tech_stack)}</span>` : ""}
            ${c.difficulty_label ? `<span class="chip">📊 ${esc(c.difficulty_label)}</span>` : ""}
          </div>
          <button class="btn btn-sm btn-primary cand-go" data-i="${i}">✨ 深入这个方案</button>
        </div>`).join("")}
    </div>
    <p class="cand-tip">都不满意？换个野度再生成，或试试「全随机」。</p>`;
  resultCard.querySelectorAll(".cand-go").forEach((btn) => {
    btn.onclick = () => expandCandidate(cands[Number(btn.dataset.i)]);
  });
}

/* 把选中的候选方向展开成完整方案 */
async function expandCandidate(cand) {
  if (!cand) return;
  setBusy(true);
  resultCard.innerHTML = loadingHTML(`正在把「${esc(cand.name || "这个方向")}」展开成完整方案…`);
  streamText = "";
  showStream("");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `请把下面的候选方向展开成完整项目方案：\n名字：${cand.name}\n记忆点：${cand.hook || ""}\n简介：${cand.desc || ""}\n难度：${cand.difficulty_label || ""}\n技术栈：${cand.tech_stack || ""}\n${wildHint(lastWild)}` },
  ];

  try {
    let text;
    if (CONFIG.stream) {
      text = await callChat(messages, { temperature: wildToTemp(lastWild), stream: true, onDelta: (d) => showStream((streamText += d)) });
    } else {
      showStreamHint();
      text = await callChat(messages, { temperature: wildToTemp(lastWild), stream: false });
    }
    const result = normalizeResult(text);
    currentProject = result;
    renderResult(result);
    saveHistory(result);
    chatWrap.hidden = true; // 新方案 → 收起并重置打磨对话
    chatState = null;
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    resultCard.innerHTML = `<div class="error-msg">❌ 展开失败：${esc(e.message)}</div>`;
  } finally {
    setBusy(false);
  }
}

let streamText = ""; // 当前流式缓冲（onDelta 里累加）

function loadingHTML(msg = "DeepSeek 正在策划项目…") {
  return `
    <div class="loading">
      <div class="spinner"></div>
      <div id="streamBoxWrap">
        <p>${esc(msg)}</p>
        <div class="stream-box" id="streamBox" hidden></div>
      </div>
    </div>`;
}

function showStream(text) {
  const box = $("streamBox");
  if (!box) return;
  box.hidden = false;
  box.textContent = text;
  box.classList.add("stream-cursor");
  box.scrollTop = box.scrollHeight;
}

function showStreamHint() {
  const wrap = $("streamBoxWrap");
  if (wrap) wrap.remove();
}

function normalizeResult(text) {
  // 兼容字符串（AI 原文）和对象（打磨对话已解析的 plan）
  const r = typeof text === "string" ? parseJsonFromText(text) : text;
  if (!r || typeof r !== "object") throw new Error("方案数据为空");
  if (!r.project_name && !r.workflow) throw new Error("返回缺少 project_name / workflow 字段");
  r.project_name = r.project_name || "未命名项目";
  r.description = r.description || "";
  r.tech_stack = r.tech_stack || "";
  r.difficulty_label = r.difficulty_label || "";
  r.hook = r.hook || "";
  r.detail = ""; // 详细方案按需生成，新方案一律清空
  if (!Array.isArray(r.features)) r.features = [];
  r.features = r.features.map((f) => ({
    name: (f && f.name) || "",
    detail: (f && f.detail) || "",
  })).filter((f) => f.name);
  if (!Array.isArray(r.workflow)) r.workflow = [];
  r.workflow = r.workflow.map((s, i) => ({
    step: s.step || i + 1,
    title: s.title || `步骤 ${i + 1}`,
    content: s.content || "",
    skill: (s && s.skill) || "",
    github: toGithubUrl(s && s.github),
  }));
  if (!Array.isArray(r.similar_projects)) r.similar_projects = [];
  r.similar_projects = r.similar_projects.map((p) => ({
    name: (p && p.name) || "",
    url: toGithubUrl(p && p.url),
    fit: Math.max(0, Math.min(100, Number((p && p.fit)) || 0)),
    note: (p && p.note) || "",
  })).filter((p) => p.name);
  return r;
}

/* 把「facebook/react」或完整 URL 归一成安全的 github 链接；不合法返回空 */
function toGithubUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    return /^https?:\/\/[^\s]+$/i.test(s) && s.length < 300 ? s : "";
  }
  // 裸仓库名必须符合 owner/repo（合法字符），否则丢弃
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s) ? `https://github.com/${s}` : "";
}

/* ---------- 渲染结果 ---------- */
function renderResult(data) {
  detailBusy = false;
  const wf = (data.workflow || [])
    .map((s) => {
      const tags = [];
      if (s.skill) tags.push(`<span class="step-tag">🛠 ${esc(s.skill)}</span>`);
      if (s.github) tags.push(`<span class="step-tag step-tag-link">🔗 <a href="${esc(s.github)}" target="_blank" rel="noopener nofollow">${esc(s.github.replace(/^https?:\/\//i, ""))}</a></span>`);
      const tagRow = tags.length ? `<div class="step-tags">${tags.join("")}</div>` : "";
      return `
      <div class="workflow-step">
        <div class="step-num">${esc(s.step)}</div>
        <div class="step-body">
          <div class="step-title">${esc(s.title)}</div>
          <div class="step-content">${esc(s.content)}</div>
          ${tagRow}
        </div>
      </div>`;
    })
    .join("");

  const hookHtml = data.hook
    ? `<div class="hook-box">💡 <b>记忆点：</b>${esc(data.hook)}</div>`
    : "";
  const simHtml = data.similar_projects && data.similar_projects.length
    ? `
      <div class="workflow-title">🔎 相似开源项目（拟合度）</div>
      <div class="sim-list">
        ${data.similar_projects.map((p) => `
          <div class="sim-item">
            <div class="sim-head">
              ${p.url
                ? `<a href="${esc(p.url)}" target="_blank" rel="noopener nofollow">${esc(p.name)}</a>`
                : `<span>${esc(p.name)}</span>`}
              <span class="sim-fit">${p.fit}%</span>
            </div>
            <div class="sim-bar"><div class="sim-fill" style="width:${p.fit}%"></div></div>
            ${p.note ? `<div class="sim-note">${esc(p.note)}</div>` : ""}
          </div>`).join("")}
      </div>`
    : "";
  const featHtml = data.features.length
    ? `
      <div class="workflow-title">⚡ 核心亮点</div>
      <div class="features-grid">
        ${data.features.map((f) => `
          <div class="feature-item">
            <div class="feature-name">${esc(f.name)}</div>
            <div class="feature-detail">${esc(f.detail)}</div>
          </div>`).join("")}
      </div>`
    : "";

  resultCard.innerHTML = `
    <div class="result-head">
      <div>
        <div class="project-name">${esc(data.project_name)}</div>
        <div style="margin-top:6px;">
          ${data.tech_stack ? `<span class="chip chip-tech">🛠 ${esc(data.tech_stack)}</span>` : ""}
          ${data.difficulty_label ? `<span class="chip">📊 ${esc(data.difficulty_label)}</span>` : ""}
        </div>
      </div>
    </div>
    ${hookHtml}
    <p class="project-desc">${esc(data.description)}</p>
    ${data.detail
      ? `<div class="detail-box" id="detailBox">${esc(data.detail)}</div>`
      : `<div class="detail-box" id="detailBox" hidden></div>`}
    ${featHtml}
    ${simHtml}
    <div class="workflow-title">📋 Vibe Coding 工作流</div>
    <div class="workflow-box">${wf}</div>
    <div class="result-actions">
      <button class="btn btn-sm btn-violet" id="analyzeBtn">📊 创新性分析</button>
      <button class="btn btn-sm btn-ghost" id="copyBtn">📋 复制工作流</button>
      <button class="btn btn-sm btn-ghost" id="exportBtn">⬇️ 导出 Markdown</button>
      <button class="btn btn-sm btn-ghost no-print" id="printBtn">🖨 打印 / PDF</button>
      <button class="btn btn-sm btn-ghost no-print" id="detailBtn">${data.detail ? "📕 收起详细方案" : "📖 详细方案"}</button>
      <button class="btn btn-sm btn-ghost no-print" id="shareBtn">🔗 分享</button>
      <button class="btn btn-sm btn-ghost no-print" id="chatBtn">💬 进一步打磨</button>
    </div>
    <div class="analysis-wrap" id="analysisWrap" hidden></div>`;

  $("analyzeBtn").onclick = () => analyzeProject(data);
  $("copyBtn").onclick = () => copyMarkdown(data);
  $("exportBtn").onclick = () => exportMarkdown(data);
  $("printBtn").onclick = () => window.print();
  $("detailBtn").onclick = () => toggleDetail();
  $("shareBtn").onclick = () => shareProject();
  $("chatBtn").onclick = () => openChat();
}

/* ---------- 创新性分析 ---------- */
async function analyzeProject(project) {
  const wrap = $("analysisWrap");
  wrap.hidden = false;
  wrap.innerHTML = `
    <div class="loading" style="padding:16px 0 10px;">
      <div class="spinner" style="width:28px;height:28px;"></div>
      <p>评估创新性中…</p>
    </div>`;
  $("analyzeBtn").disabled = true;

  const messages = [
    { role: "system", content: ANALYSIS_PROMPT },
    { role: "user", content: `项目名称：${project.project_name}\n记忆点：${project.hook || "无"}\n描述：${project.description}\n技术栈：${project.tech_stack}\n相似开源项目：${(project.similar_projects || []).map((s) => `${s.name}(${s.fit}%)`).join("、") || "无"}` },
  ];

  try {
    const text = await callChat(messages, { temperature: 0.4, stream: false });
    const result = parseJsonFromText(text);
    renderAnalysis(result);
  } catch (e) {
    wrap.innerHTML = `<div class="error-msg">分析失败：${esc(e.message)}</div>`;
  } finally {
    $("analyzeBtn").disabled = false;
  }
}

function renderAnalysis(result) {
  const scores = result.scores || {};
  const rows = SCORE_MAP
    .map(([key, label]) => {
      const v = Math.max(0, Math.min(10, Number(scores[key]) || 0));
      return `
      <div class="score-row">
        <span>${label}</span>
        <div class="score-bar"><div class="score-fill" style="width:${v * 10}%"></div></div>
        <span class="score-val">${v}/10</span>
      </div>`;
    })
    .join("");

  const total = Number(result.total_score) || SCORE_MAP.reduce((s, [k]) => s + (Number(scores[k]) || 0), 0);

  let existing = "";
  const ep = result.existing_projects;
  if (Array.isArray(ep) && ep.length) {
    const items = ep
      .map((p) => {
        if (typeof p === "string") return `<div class="existing-item">🔍 ${esc(p)}</div>`;
        return `<div class="existing-item"><strong>${esc(p.name)}</strong> — ${esc(p.note || "")}</div>`;
      })
      .join("");
    existing = `<div class="existing-list"><strong>🔍 已有类似项目：</strong>${items}</div>`;
  } else {
    existing = `<div class="existing-list">✅ 未发现明显同类产品，赛道较新</div>`;
  }

  const wrap = $("analysisWrap");
  wrap.innerHTML = `
    <div class="workflow-title">📊 创新性分析（满分 50）</div>
    <div class="score-grid">${rows}</div>
    <div class="score-total"><span>总分</span><span class="num">${total}/50</span></div>
    ${existing}
    ${result.comment ? `<div class="comment-box"><strong>💬 评语：</strong>${esc(result.comment)}</div>` : ""}`;
}

/* ---------- 历史记录 ---------- */
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch (e) { return []; }
}

function saveHistory(project) {
  const list = getHistory();
  const slim = { project_name: project.project_name, description: project.description, tech_stack: project.tech_stack };
  list.unshift({ savedAt: Date.now(), ...slim, _full: project });
  // 按项目名去重
  const seen = new Set();
  const dedup = list.filter((it) => (seen.has(it.project_name) ? false : (seen.add(it.project_name), true)));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(dedup.slice(0, CONFIG.historyLimit)));
  renderHistory();
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderHistory() {
  const list = getHistory();
  historyCard.hidden = list.length === 0;
  const q = (historySearch.value || "").trim().toLowerCase();
  const filtered = q
    ? list.filter((it) => `${it.project_name} ${it.description || ""}`.toLowerCase().includes(q))
    : list;
  historyList.innerHTML = filtered
    .map((it) => `
      <div class="history-item" data-name="${esc(it.project_name)}">
        <button class="h-del" title="删除这条">✕</button>
        <div class="h-name">${esc(it.project_name)} <span class="h-time">${fmtTime(it.savedAt)}</span></div>
        <div class="h-desc">${esc(it.description || "")}</div>
      </div>`)
    .join("");
  historyList.querySelectorAll(".history-item").forEach((el) => {
    el.querySelector(".h-del").onclick = (e) => {
      e.stopPropagation();
      delHistory(el.dataset.name);
    };
    el.onclick = () => {
      const hit = list.find((it) => it.project_name === el.dataset.name);
      if (hit && hit._full) {
        currentProject = hit._full;
        outputArea.hidden = false;
        renderResult(hit._full);
        resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
  });
}

function delHistory(name) {
  const list = getHistory().filter((it) => it.project_name !== name);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  renderHistory();
  showToast("🗑 已删除");
}

/* ---------- 复制 / 导出 ---------- */
function buildMarkdown(p, includeDetail = false) {
  const feat = (p.features || []).map((f) => `- **${f.name}**：${f.detail}`).join("\n");
  const wf = (p.workflow || []).map((s) => {
    let line = `${s.step}. **${s.title}** — ${s.content}`;
    if (s.skill) line += `\n    🛠 技能：${s.skill}`;
    if (s.github) line += `\n    🔗 GitHub：${s.github}`;
    return line;
  }).join("\n");
  const sim = (p.similar_projects || [])
    .map((s) => `- **${s.name}** ${s.url ? `(${s.url})` : ""} — 拟合度 ${s.fit}%${s.note ? `：${s.note}` : ""}`)
    .join("\n");
  return `# ${p.project_name}

${p.hook ? `> 💡 **记忆点：** ${p.hook}\n` : ""}> ${p.description}

**技术栈：** ${p.tech_stack}
**难度：** ${p.difficulty_label}

${feat ? `## ⚡ 核心亮点\n${feat}\n` : ""}${sim ? `## 🔎 相似开源项目\n${sim}\n` : ""}${includeDetail && p.detail ? `## 📖 详细方案\n${p.detail}\n\n` : ""}## Vibe Coding 工作流
${wf}`;
}

async function copyMarkdown(p) {
  const md = buildMarkdown(p);
  try {
    await navigator.clipboard.writeText(md);
    showToast("✅ 已复制工作流");
  } catch (e) {
    // 兼容非 https / 老浏览器
    const ta = document.createElement("textarea");
    ta.value = md;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast("✅ 已复制工作流");
  }
}

function exportMarkdown(p) {
  const blob = new Blob([buildMarkdown(p, true)], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.project_name || "vibeforge"}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("⬇️ 已导出 Markdown");
}

/* ---------- 打磨对话 ---------- */
let chatState = null; // 当前项目的对话上下文（重置时机：重新生成/采用新方案）
let detailBusy = false; // 详细方案生成中标志

function buildChatSystem(project) {
  return `你是 VibeForge 的「方案打磨助手」。这是当前已生成的项目方案 JSON：
${JSON.stringify({
    project_name: project.project_name,
    hook: project.hook,
    description: project.description,
    tech_stack: project.tech_stack,
    difficulty_label: project.difficulty_label,
    features: project.features,
    workflow: project.workflow,
  })}

用户的每句话都是针对这个方案的修改要求或追问。

规则：
1. 先简短说改动思路（1-2 句）；【每次修改方案】都用 markdown 代码块 \`\`\`json … \`\`\` 输出一份【完整更新后】的项目 JSON，结构与上面完全一致；workflow 恰好 6 步（环境搭建、PRD 撰写、原型构建、核心功能迭代、调试优化、部署上线），每步含 skill（技能关键词）和 github（真实存在的开源地址，不确定写 ""，严禁编造）；顶层含 similar_projects（2-4 个真实相似开源项目 + fit 拟合度 0-100 + note，严禁编造）。
2. 如果只是回答提问/闲聊，不需要输出 JSON，正常回答即可。
3. JSON 必须是完整版（不是只给改动部分），方便前端直接替换。`;
}

function seedChat() {
  chatState = [{ role: "system", content: buildChatSystem(currentProject) }];
  chatMsgs.innerHTML = "";
  const tip = document.createElement("div");
  tip.className = "chat-msg tip";
  tip.textContent =
    "👋 我在。可以：把难度降低 / 展开某一步成小任务 / 加个变现方式 / 换更简单的技术栈 / 让方案更具体… 改完的方案我会以 JSON 卡片给出，可一键采用。";
  chatMsgs.appendChild(tip);
}

function openChat() {
  if (!currentProject) return;
  chatWrap.hidden = false;
  if (!chatState) seedChat();
  chatInput.focus();
  chatWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addChatBubble(role, text) {
  const b = document.createElement("div");
  b.className = `chat-msg ${role}`;
  b.textContent = text;
  chatMsgs.appendChild(b);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  return b;
}

/* 把回复渲染进气泡：```json 块变 <pre>，其余纯文本（安全） */
function appendChatText(el, text) {
  const parts = String(text).split(/```(?:json)?\s*/i);
  parts.forEach((seg, i) => {
    if (!seg) return;
    if (i % 2 === 1) {
      const pre = document.createElement("pre");
      pre.textContent = seg.replace(/```/g, "").trim();
      el.appendChild(pre);
    } else {
      el.appendChild(document.createTextNode(seg));
    }
  });
}

/* 从回复里抽出「完整方案 JSON」（必须是带 project_name/workflow 的） */
function extractPlanJson(text) {
  const obj = parseJsonFromText(text);
  if (obj && (obj.project_name || obj.workflow)) return obj;
  throw new Error("no plan");
}

async function sendChat() {
  const q = chatInput.value.trim();
  if (!q || !currentProject) return;
  chatInput.value = "";
  chatState.push({ role: "user", content: q });
  addChatBubble("user", q);

  chatSendBtn.disabled = true;
  chatInput.disabled = true;

  const bubble = document.createElement("div");
  bubble.className = "chat-msg ai chat-typing";
  chatMsgs.appendChild(bubble);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;

  // 控制上下文长度：system + 最近 6 条（防超长）
  const msgs = [chatState[0], ...chatState.slice(-6)];
  let acc = "";
  try {
    await callChat(msgs, {
      temperature: 0.7,
      json: false,
      stream: true,
      onDelta: (d) => {
        acc += d;
        bubble.textContent = acc;
        chatMsgs.scrollTop = chatMsgs.scrollHeight;
      },
    });
  } catch (e) {
    acc = `⚠️ 出错了：${e.message}`;
  }

  // 流式结束：重新渲染（美化代码块）
  bubble.classList.remove("chat-typing");
  bubble.textContent = "";
  appendChatText(bubble, acc);

  // 若回复带完整方案 → 自动同步到上方项目卡，对话继续
  let plan = null;
  try { plan = extractPlanJson(acc); } catch (e) { /* 正常对话无方案 */ }
  if (plan) {
    if (tryApplyPlan(plan, true)) {
      const note = document.createElement("div");
      note.className = "chat-sync-note";
      note.textContent = "✅ 新方案已同步到上方项目卡";
      bubble.appendChild(note);
    } else {
      const note = document.createElement("div");
      note.className = "chat-sync-note";
      note.style.color = "#b91c1c";
      note.textContent = "⚠️ 方案缺少必要字段，未同步";
      bubble.appendChild(note);
    }
  }

  chatState.push({ role: "assistant", content: acc });
  chatSendBtn.disabled = false;
  chatInput.disabled = false;
  chatInput.focus();
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

/* 应用方案：更新上方项目卡；keepChat=true 保留对话并刷新上下文（可继续打磨） */
function tryApplyPlan(plan, keepChat = false) {
  try {
    const normalized = normalizeResult(plan);
    currentProject = normalized;
    saveHistory(normalized);
    renderResult(normalized);
    if (chatState && chatState.length) {
      chatState[0] = { role: "system", content: buildChatSystem(normalized) };
    }
    if (!keepChat) {
      chatWrap.hidden = true;
      chatState = null;
    }
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- 详细方案（约 2000 字，按需生成 + 缓存） ---------- */
function planForPrompt(p) {
  // 供提示词使用的精简项目数据（不含 detail）
  return {
    project_name: p.project_name,
    hook: p.hook,
    description: p.description,
    tech_stack: p.tech_stack,
    difficulty_label: p.difficulty_label,
    features: p.features,
    workflow: p.workflow,
    similar_projects: p.similar_projects,
  };
}

async function toggleDetail() {
  const btn = $("detailBtn");
  const box = $("detailBox");
  if (!btn || !box || detailBusy || !currentProject) return;

  // 已有详细内容 → 直接切换显隐
  if (currentProject.detail) {
    box.hidden = !box.hidden;
    btn.textContent = box.hidden ? "📖 详细方案" : "📕 收起详细方案";
    if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  // 首次：流式生成
  detailBusy = true;
  btn.disabled = true;
  btn.textContent = "⏳ 正在撰写（约 2000 字）…";
  box.hidden = false;
  box.textContent = "";
  box.classList.add("chat-typing");

  try {
    const text = await callChat(
      [
        { role: "system", content: DETAIL_PROMPT },
        { role: "user", content: `以下是已生成的项目方案：\n${JSON.stringify(planForPrompt(currentProject))}` },
      ],
      { temperature: 0.7, json: false, stream: true, maxTokens: 4000, onDelta: (d) => { box.textContent += d; box.scrollTop = box.scrollHeight; } }
    );
    currentProject.detail = text;
    box.classList.remove("chat-typing");
    btn.textContent = "📕 收起详细方案";
    btn.disabled = false;
  } catch (e) {
    box.innerHTML = `<div class="error-msg">详细方案生成失败：${esc(e.message)}</div>`;
    btn.textContent = "📖 详细方案";
    btn.disabled = false;
  } finally {
    detailBusy = false;
  }
}

/* ---------- 分享链接（方案编码进 URL hash，点开即恢复） ---------- */
function shareProject() {
  if (!currentProject) return;
  const hash = encodeURIComponent(JSON.stringify(planForPrompt(currentProject)));
  const url = `${location.origin}${location.pathname}#p=${hash}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast("✅ 分享链接已复制")).catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
  location.hash = `p=${hash}`;
}

function fallbackCopy(t) {
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  showToast("✅ 分享链接已复制");
}

function loadShared() {
  const m = location.hash.match(/#p=([\s\S]*)/);
  if (!m) return;
  try {
    const plan = normalizeResult(JSON.parse(decodeURIComponent(m[1])));
    currentProject = plan;
    outputArea.hidden = false;
    renderResult(plan);
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    console.warn("分享链接解析失败:", e);
  }
}

/* ---------- 语音输入想法（Web Speech API，中文） ---------- */
function startVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast("⚠️ 浏览器不支持语音输入，请用 Chrome / Edge");
    return;
  }
  if (micBtn.dataset.rec === "1") return; // 已在录音
  const rec = new SR();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.continuous = false;
  micBtn.dataset.rec = "1";
  micBtn.classList.add("recording");
  micBtn.textContent = "🔴";
  showToast("🎙 请说话…");
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    ideaInput.value = ideaInput.value.trim() ? `${ideaInput.value.trim()} ${t}` : t;
  };
  rec.onend = () => {
    micBtn.dataset.rec = "";
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤";
  };
  rec.onerror = (e) => {
    showToast("⚠️ 语音识别出错：" + e.error);
    micBtn.dataset.rec = "";
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤";
  };
  rec.start();
}

/* ---------- 全随机 ---------- */
function randomize() {
  ideaInput.value = "";
  document.querySelectorAll(".field-tag").forEach((el) => el.classList.remove("active"));
  const shuffled = [...ALL_FIELDS].sort(() => 0.5 - Math.random());
  const count = Math.floor(Math.random() * 3) + 1;
  const picked = shuffled.slice(0, count);
  document.querySelectorAll(".field-tag").forEach((el) => {
    if (picked.includes(el.dataset.field)) el.classList.add("active");
  });
  selectedFields = picked;
  updateFieldCount();
  const lv = Math.floor(Math.random() * 10) + 1;
  difficultySlider.value = lv;
  updateDifficulty();
  const wv = Math.floor(Math.random() * 10) + 1;
  wildnessSlider.value = wv;
  updateWildness();
}

/* ---------- 按钮状态 ---------- */
function setBusy(busy) {
  generateBtn.disabled = busy;
  randomBtn.disabled = busy;
  if (busy) generateBtn.textContent = "⏳ 生成中…";
  else generateBtn.textContent = "✨ 生成推荐";
}

/* ---------- 启动 ---------- */
initFields();
updateDifficulty();
updateWildness();
renderHistory();
loadShared();

difficultySlider.oninput = updateDifficulty;
wildnessSlider.oninput = updateWildness;
generateBtn.onclick = generateProject;
randomBtn.onclick = () => { randomize(); generateProject(); };
clearHistoryBtn.onclick = () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast("历史已清空");
};
micBtn.onclick = startVoiceInput;
chatSendBtn.onclick = sendChat;
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !chatSendBtn.disabled) sendChat();
});
chatCloseBtn.onclick = () => { chatWrap.hidden = true; };
historySearch.addEventListener("input", renderHistory);
apiSetBtn.onclick = () => {
  const cur = localStorage.getItem("vibeforge_api_url") || CONFIG.apiUrl;
  const input = prompt("API 地址（填你的 Cloudflare Worker 地址；留空恢复默认）：", cur);
  if (input === null) return;
  if (input.trim() === "") localStorage.removeItem("vibeforge_api_url");
  else localStorage.setItem("vibeforge_api_url", input.trim());
  showToast("✅ 已保存，即将刷新");
  setTimeout(() => location.reload(), 600);
};
