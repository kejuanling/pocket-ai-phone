"use strict";
/* [位置:lib/notebook-meta.js·整个文件] [笔记摘要与关键词后台自动生成] [11-21：笔记新建或正文变动后，异步调用独立用途模型角色 notebook_meta（默认配 Gemini 订阅模型），带上本次改动的具体内容与可选参考摘要，用正向轻松的提示词生成「何时查阅 + 压缩记忆」摘要和关键词，静默写回并刷新目录；只改摘要/关键词/标题/置顶不触发] [注释时间 2026-11-21] */
const fs = require("fs");
const path = require("path");
const { writeJsonAtomic } = require("../utils/json_atomic");
const ROOT_DIR = path.join(__dirname, "..");
const PROMPT_FILE = path.join(ROOT_DIR, "data", "notebook_meta_prompt.json");

const DEFAULT_PROMPT = [
  "你是一位细心、轻快的笔记整理助手，帮 AI 的个人笔记本维护清晰的目录摘要和主题关键词。",
  "",
  "请阅读这篇笔记的标题、正文、本次改动的内容，以及原有的摘要/关键词（如果写作者顺手附带了参考摘要，也可以自然吸收里面的想法），整理出两项内容：",
  "",
  "1. summary（目录摘要，约 60~180 字，单行纯文本）：",
  "   - 先用简明直观的一句话点出「什么时候适合翻开这篇笔记」（例如聊到某个具体话题、推进某件事、或需要核对某份设定/记录时）。",
  "   - 紧接着把笔记里最值得记住的核心信息、结论、设定或脉络浓缩成紧凑好读的压缩记忆，让读者扫一眼就能抓住重点。",
  "   - 如果本次是追加或局部修改，在原有摘要基础上顺滑融入新变化，保持连贯准确。",
  "",
  "2. tags（关键词数组，3~8 个词或短语）：",
  "   - 提炼最贴合这篇笔记核心主题的词或短语（如人物、项目、概念、地点、事件、情绪或适用场景），每个词简短精炼，方便后续按话题关联。",
  "",
  "请直接返回一个 JSON 对象，格式如下：",
  '{"summary": "……", "tags": ["词1", "词2", "词3"]}'
].join("\n");

function readPromptCfg() {
  try { return JSON.parse(fs.readFileSync(PROMPT_FILE, "utf8")) || {}; } catch (e) { return {}; }
}
function getPrompt() {
  const d = readPromptCfg();
  const timeout = Math.max(10, Math.min(120, Number(d.timeout_sec) || 45));
  return {
    template: String(d.template || "").trim() ? String(d.template) : DEFAULT_PROMPT,
    timeout_sec: timeout,
  };
}
function adminGet() {
  const p = getPrompt(), d = readPromptCfg();
  return { template: p.template, custom_set: !!String(d.template || "").trim(), timeout_sec: p.timeout_sec };
}
function adminSave(body) {
  const d = readPromptCfg();
  const t = String((body && body.template) || "").trim();
  if (!t) throw new Error("提示词不能是空的");
  d.template = t;
  if (body && body.timeout_sec !== undefined) d.timeout_sec = Math.max(10, Math.min(120, Number(body.timeout_sec) || 45));
  fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
  writeJsonAtomic(PROMPT_FILE, d);
}
function adminReset() {
  const d = readPromptCfg();
  delete d.template;
  fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
  writeJsonAtomic(PROMPT_FILE, d);
}

function clip(s, max) {
  const t = String(s == null ? "" : s).trim();
  if (!t || t.length <= max) return t;
  return t.slice(0, max) + "…（后略，共 " + t.length + " 字）";
}

function formatChange(change) {
  if (!change || typeof change !== "object") return "新建或更新了正文。";
  if (change.type === "create") return "操作类型：新建笔记。";
  if (change.type === "append") {
    return "操作类型：在末尾追加了新内容。\n【本次追加的部分】\n" + clip(change.added, 3000);
  }
  if (change.type === "patch") {
    return "操作类型：局部替换了正文中的片段" + (change.replace_all ? "（全部匹配处）" : "") + "。\n" +
      "【原片段】\n" + clip(change.old, 1500) + "\n【替换为】\n" + clip(change.new, 1500);
  }
  if (change.type === "replace") {
    const prev = clip(change.previous_body, 2500);
    return "操作类型：整篇更新了正文。" + (prev ? "\n【修改前的旧正文】\n" + prev : "");
  }
  return "操作类型：更新了正文。";
}

function buildUserMessage(job) {
  const parts = [];
  parts.push("【笔记标题】" + (job.title || "（无标题）"));
  if (job.folder) parts.push("【所在文件夹】" + job.folder);
  parts.push("【本次改动】\n" + formatChange(job.change));
  if (job.hintSummary) parts.push("【写作者附带的参考摘要】\n" + clip(job.hintSummary, 600));
  if (job.prevSummary) parts.push("【原有摘要】\n" + clip(job.prevSummary, 600));
  if (Array.isArray(job.prevTags) && job.prevTags.length) parts.push("【原有关键词】" + job.prevTags.join("、"));
  parts.push("【当前完整正文】\n" + clip(job.body, 8000));
  return parts.join("\n\n");
}

function parseMetaJSON(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let candidate = s;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);
  try {
    const obj = JSON.parse(candidate);
    if (!obj || typeof obj !== "object") return null;
    const summary = String(obj.summary || "").replace(/\s+/g, " ").trim().slice(0, 500);
    const rawTags = Array.isArray(obj.tags)
      ? obj.tags
      : (typeof obj.tags === "string" ? obj.tags.split(/[,，、;；\s]+/) : []);
    const tags = rawTags
      .map(v => String(v || "").trim().slice(0, 40))
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 12);
    if (!summary && !tags.length) return null;
    return { summary, tags };
  } catch (e) {
    return null;
  }
}

async function generateMeta(job) {
  const router = require("./model-router");
  const upstreamTarget = require("./upstream-target");
  const { provider, model } = router.resolveRoleModel("notebook_meta", { ignoreEnabled: true });
  if (!provider || !model) {
    throw new Error("未配置 notebook_meta 用途模型");
  }
  const target = upstreamTarget.resolveTarget(provider, function (k) { return process.env[k] || ""; }, model);
  if (!target.url || !target.key) {
    throw new Error("notebook_meta 供应商未配置 API 地址或凭据");
  }
  const cfg = getPrompt();
  const body = Object.assign({
    model,
    stream: false,
    temperature: 0.3,
    max_tokens: 2048,
    messages: [
      { role: "system", content: cfg.template },
      { role: "user", content: buildUserMessage(job) },
    ],
  }, router.thinkingPatch(provider));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout_sec * 1000);
  let resp;
  try {
    resp = await fetch(target.url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + target.key }, target.headers || {}),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "请求超时" : ("请求失败：" + e.message));
  } finally {
    clearTimeout(timer);
  }
  const raw = await resp.text();
  let j = null;
  try { j = JSON.parse(raw); } catch (e) {}
  if (!resp.ok) {
    throw new Error("HTTP " + resp.status + "：" + ((j && j.error && (j.error.message || j.error)) || raw.slice(0, 120)));
  }
  const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const text = typeof content === "string"
    ? content
    : (Array.isArray(content) ? content.map(p => (p && typeof p.text === "string" ? p.text : "")).join("") : "");
  const parsed = parseMetaJSON(text);
  if (!parsed) throw new Error("返回内容无法解析为 JSON：" + String(text || "").slice(0, 120));
  return parsed;
}

// 按笔记 id 排队防抖：同一篇短时间连改多次时合并为最新一次，避免旧结果盖新结果
const timers = new Map();
const running = new Set();
const queued = new Map();

function runJob(job) {
  const id = Number(job.id);
  if (running.has(id)) {
    queued.set(id, job);
    return;
  }
  running.add(id);
  Promise.resolve().then(async () => {
    try {
      const paperStore = require("./paper-store");
      const papers = require("./papers");
      const cur = paperStore.getEntry(job.baseDir || ROOT_DIR, id);
      if (!cur || cur.is_index) return;
      const res = await generateMeta(job);
      // 再次检查条目是否仍存在，避免异步期间被删
      const again = paperStore.getEntry(job.baseDir || ROOT_DIR, id);
      if (!again || again.is_index) return;
      const patch = {};
      if (res.summary) patch.summary = res.summary;
      if (res.tags && res.tags.length) patch.tags = res.tags;
      if (!Object.keys(patch).length) return;
      paperStore.updateMetaSilent(job.baseDir || ROOT_DIR, id, patch);
      papers.syncIndexNote();
      console.log("[notebook-meta] 已更新笔记 #" + id + " 摘要(" + (patch.summary ? patch.summary.length : 0) + "字)与关键词(" + (patch.tags ? patch.tags.length : 0) + "个)");
    } catch (e) {
      console.warn("[notebook-meta] 笔记 #" + id + " 摘要/关键词生成失败:", e && e.message);
    } finally {
      running.delete(id);
      const next = queued.get(id);
      if (next) {
        queued.delete(id);
        runJob(next);
      }
    }
  });
}

function schedule(job) {
  if (!job || !job.id) return false;
  // 测试目录（PAPERS_BASE_DIR 指向临时目录）默认不发真实外网 LLM 请求
  if (process.env.PAPERS_BASE_DIR && path.resolve(process.env.PAPERS_BASE_DIR) !== path.resolve(ROOT_DIR)) {
    return false;
  }
  const id = Number(job.id);
  if (timers.has(id)) clearTimeout(timers.get(id));
  const t = setTimeout(() => {
    timers.delete(id);
    runJob(job);
  }, 400);
  if (t && typeof t.unref === "function") t.unref();
  timers.set(id, t);
  return true;
}

module.exports = { schedule, generateMeta, parseMetaJSON, buildUserMessage, formatChange, adminGet, adminSave, adminReset, DEFAULT_PROMPT };
