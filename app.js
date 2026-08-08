/* ============================================================
 * VibeForge 核心逻辑
 *  - 生成推荐（流式输出，双响应格式兼容）
 *  - 创新性分析（5 维打分）
 *  - 历史记录（localStorage）
 *  - 复制 / 导出 Markdown
 *  - Key 永不进入前端：所有请求走本地代理 / Cloudflare Worker
 * ============================================================ */

/* ---------- 提示词（核心资产） ---------- */
const SYSTEM_PROMPT = `你是一位资深的 Vibe Coding 导师，擅长把想法变成能动手做出来的项目。
用户会提供：想法、领域、难度（1-10，越大越难）。请推荐一个具体、当下流行、可落地的 Vibe Coding 项目，并给出从 0 到 1 的完整工作流。

输出要求（必须严格遵守）：
1. 只返回一个 JSON 对象。不要任何解释、不要用 markdown 代码块包裹。
2. JSON 结构如下：
{
  "project_name": "项目名称（简洁、响亮、中文）",
  "description": "一句话简介（100 字内）",
  "tech_stack": "推荐技术栈（尽量免费/开源，如 HTML/CSS/JS + DeepSeek API）",
  "difficulty_label": "难度描述（入门/简单/中等/进阶/困难 之一）",
  "workflow": [
    {"step": 1, "title": "环境搭建", "content": "具体到命令、文件名的操作指引"},
    {"step": 2, "title": "PRD 撰写", "content": "…"},
    {"step": 3, "title": "原型构建", "content": "…"},
    {"step": 4, "title": "核心功能迭代", "content": "…"},
    {"step": 5, "title": "调试优化", "content": "…"},
    {"step": 6, "title": "部署上线", "content": "…"}
  ]
}
3. workflow 恰好 6 步，顺序必须覆盖：环境搭建、PRD 撰写、原型构建、核心功能迭代、调试优化、部署上线。
   每步 content 要具体可执行：包含关键命令、文件名、技术选型、验收点。
4. difficulty_label 与难度数值匹配：1-3 入门，4-6 中等，7-8 进阶，9-10 困难。`;

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
4. existing_projects 列 1-3 个真实存在的类似产品；若确实没有，返回空数组 []。`;

/* ---------- 领域 & 常量 ---------- */
/* 领域数据在 fields.js：FIELD_CATEGORIES（15 类 × 120 个）/ ALL_FIELDS */
const LEVEL_LABEL = ["", "入门", "入门", "入门", "中等", "中等", "中等", "进阶", "进阶", "困难", "困难"];
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
const difficultySlider = $("difficultySlider");
const difficultyDisplay = $("difficultyDisplay");
const generateBtn = $("generateBtn");
const randomBtn = $("randomBtn");
const outputArea = $("outputArea");
const resultCard = $("resultCard");
const historyCard = $("historyCard");
const historyList = $("historyList");
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
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (e) { /* 继续尝试整段 */ }
  }
  try { return JSON.parse(text); } catch (e) {}
  throw new Error("AI 返回的内容不是合法 JSON，请重试或降低难度");
}

/* ---------- API 调用（支持流式 / 非流式） ---------- */
async function callChat(messages, { temperature = CONFIG.temperature, stream = false, onDelta = null } = {}) {
  const body = { model: CONFIG.model, messages, temperature, max_tokens: CONFIG.maxTokens, stream };

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
    group.className = "field-group";
    group.dataset.name = cat.name;

    const head = document.createElement("div");
    head.className = "field-group-head";
    const title = document.createElement("span");
    title.className = "field-group-title";
    title.textContent = cat.name;
    const actions = document.createElement("span");
    actions.className = "field-group-actions";
    const selAll = document.createElement("button");
    selAll.className = "link-btn";
    selAll.textContent = "全选";
    const clr = document.createElement("button");
    clr.className = "link-btn";
    clr.textContent = "清空";
    actions.append(selAll, clr);
    head.append(title, actions);

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
    group.style.display = visible ? "" : "none";
  });
}

function updateDifficulty() {
  const v = parseInt(difficultySlider.value, 10);
  difficultyDisplay.textContent = `Lv.${v} · ${LEVEL_LABEL[v]}`;
}

/* 示例快捷填充 */
document.querySelectorAll(".qs-chip").forEach((chip) => {
  chip.onclick = () => {
    ideaInput.value = chip.dataset.idea;
    ideaInput.focus();
  };
});

/* ---------- 生成推荐 ---------- */
async function generateProject() {
  const idea = ideaInput.value.trim() || "没有具体想法，请推荐一个当下热门、好玩又好上手的 Vibe Coding 项目";
  const fields = selectedFields.length ? selectedFields.join("、") : "全领域";
  const level = parseInt(difficultySlider.value, 10);

  setBusy(true);
  outputArea.hidden = false;
  resultCard.innerHTML = loadingHTML();
  showStream("");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `想法：${idea}\n领域：${fields}\n难度：${level}/10` },
  ];

  try {
    let text;
    if (CONFIG.stream) {
      text = await callChat(messages, { stream: true, onDelta: (d) => showStream((streamText += d)) });
    } else {
      showStreamHint();
      text = await callChat(messages, { stream: false });
    }
    const result = normalizeResult(text);
    currentProject = result;
    renderResult(result);
    saveHistory(result);
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    resultCard.innerHTML = `<div class="error-msg">❌ 生成失败：${esc(e.message)}</div>`;
  } finally {
    setBusy(false);
  }
}

let streamText = ""; // 当前流式缓冲（onDelta 里累加）

function loadingHTML() {
  return `
    <div class="loading">
      <div class="spinner"></div>
      <div id="streamBoxWrap">
        <p>DeepSeek 正在策划项目…</p>
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
  const r = parseJsonFromText(text);
  if (!r.project_name && !r.workflow) throw new Error("返回缺少 project_name / workflow 字段");
  r.project_name = r.project_name || "未命名项目";
  r.description = r.description || "";
  r.tech_stack = r.tech_stack || "";
  r.difficulty_label = r.difficulty_label || "";
  if (!Array.isArray(r.workflow)) r.workflow = [];
  r.workflow = r.workflow.map((s, i) => ({
    step: s.step || i + 1,
    title: s.title || `步骤 ${i + 1}`,
    content: s.content || "",
  }));
  return r;
}

/* ---------- 渲染结果 ---------- */
function renderResult(data) {
  const wf = (data.workflow || [])
    .map((s) => `
      <div class="workflow-step">
        <div class="step-num">${esc(s.step)}</div>
        <div class="step-body">
          <div class="step-title">${esc(s.title)}</div>
          <div class="step-content">${esc(s.content)}</div>
        </div>
      </div>`)
    .join("");

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
    <p class="project-desc">${esc(data.description)}</p>
    <div class="workflow-title">📋 Vibe Coding 工作流</div>
    <div class="workflow-box">${wf}</div>
    <div class="result-actions">
      <button class="btn btn-sm btn-violet" id="analyzeBtn">📊 创新性分析</button>
      <button class="btn btn-sm btn-ghost" id="copyBtn">📋 复制工作流</button>
      <button class="btn btn-sm btn-ghost" id="exportBtn">⬇️ 导出 Markdown</button>
      <button class="btn btn-sm btn-ghost no-print" id="printBtn">🖨 打印 / PDF</button>
    </div>
    <div class="analysis-wrap" id="analysisWrap" hidden></div>`;

  $("analyzeBtn").onclick = () => analyzeProject(data);
  $("copyBtn").onclick = () => copyMarkdown(data);
  $("exportBtn").onclick = () => exportMarkdown(data);
  $("printBtn").onclick = () => window.print();
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
    { role: "user", content: `项目名称：${project.project_name}\n描述：${project.description}\n技术栈：${project.tech_stack}` },
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

function renderHistory() {
  const list = getHistory();
  historyCard.hidden = list.length === 0;
  historyList.innerHTML = list
    .map((it) => `
      <div class="history-item" data-name="${esc(it.project_name)}">
        <div class="h-name">${esc(it.project_name)}</div>
        <div class="h-desc">${esc(it.description || "")}</div>
      </div>`)
    .join("");
  historyList.querySelectorAll(".history-item").forEach((el) => {
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

/* ---------- 复制 / 导出 ---------- */
function buildMarkdown(p) {
  const wf = (p.workflow || []).map((s) => `${s.step}. **${s.title}** — ${s.content}`).join("\n");
  return `# ${p.project_name}

> ${p.description}

**技术栈：** ${p.tech_stack}
**难度：** ${p.difficulty_label}

## Vibe Coding 工作流
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
  const blob = new Blob([buildMarkdown(p)], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.project_name || "vibeforge"}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("⬇️ 已导出 Markdown");
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
renderHistory();

difficultySlider.oninput = updateDifficulty;
generateBtn.onclick = generateProject;
randomBtn.onclick = () => { randomize(); generateProject(); };
clearHistoryBtn.onclick = () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  showToast("历史已清空");
};
