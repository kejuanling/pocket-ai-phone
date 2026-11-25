'use strict';
// image-desc.js —— 图片转写（2026-10-27）
// 目的：不能看图的聊天模型也能通过文字转写理解图片。转写随消息保存在 image_desc 扩展字段，
// 出口前才渲染成 [图片转写] 文本；时间线原文、聊天气泡、前端编辑都不改。
// 模型走用途 image_desc（lib/model-router.js），提示词在 data/image_desc_prompt.json。
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../utils/json_atomic');

const ROOT = path.join(__dirname, '..');
const PROMPT_FILE = path.join(ROOT, 'data', 'image_desc_prompt.json');
const UPLOADS_DIR = path.join(ROOT, 'data', 'uploads');
const STICKERS_DIR = path.join(ROOT, 'workspace', 'stickers');
const DESC_PREFIX = '[图片转写] ';

const DEFAULT_PROMPT = '你是图片转写员。请把图片里的内容写成一段准确、直观的文字，给无法直接看到图片的 AI 阅读。\n\n要求：\n1. 按重要程度描述主体、人物动作和表情、物体、场景、构图、颜色与光线；保留对理解图片有用的细节。\n2. 图中清晰可见的文字尽量逐字抄出，并说明所在位置；看不清就写“看不清”，不要猜。\n3. 如果是表情包、漫画、截图或界面，除了画面，还要说明文字与画面的关系、显而易见的笑点或用途。\n4. 只依据图片，不识别现实人物身份，不推测姓名、关系、经历或拍摄者意图。\n5. 只输出转写正文，不要前言，不要说“这是一张图片”，不要额外评价，一般不超过 300 字。';

function readCfg() {
  try { return JSON.parse(fs.readFileSync(PROMPT_FILE, 'utf-8')) || {}; } catch (e) { return {}; }
}
function prompts() {
  const d = readCfg();
  const timeout = Math.max(10, Math.min(120, Number(d.timeout_sec) || 60));
  return { template: String(d.template || '').trim() ? String(d.template) : DEFAULT_PROMPT, timeout_sec: timeout };
}
function adminGet() {
  const p = prompts(), d = readCfg();
  return { template: p.template, custom_set: !!String(d.template || '').trim(), timeout_sec: p.timeout_sec };
}
function adminSave(body) {
  const d = readCfg();
  const t = String((body && body.template) || '').trim();
  if (!t) throw new Error('提示词不能是空的');
  d.template = t;
  if (body && body.timeout_sec !== undefined) d.timeout_sec = Math.max(10, Math.min(120, Number(body.timeout_sec) || 60));
  fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
  writeJsonAtomic(PROMPT_FILE, d);
}
function adminReset() {
  const d = readCfg();
  delete d.template;
  fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
  writeJsonAtomic(PROMPT_FILE, d);
}

function imageUrlOf(part) {
  if (!part || typeof part !== 'object') return '';
  if (part.type !== 'image_url' && part.type !== 'image' && !part.image_url) return '';
  const raw = part.image_url;
  const url = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? raw.url : '');
  return typeof url === 'string' ? url : '';
}
function imageParts(content) {
  return (Array.isArray(content) ? content : []).filter(function (p) { return !!imageUrlOf(p); });
}
function imageUrls(content) {
  const out = [];
  for (const p of imageParts(content)) { const u = imageUrlOf(p); if (u && out.indexOf(u) < 0) out.push(u); }
  return out;
}
function entriesOf(msg) {
  const v = msg && msg.image_desc;
  return (Array.isArray(v) ? v : []).filter(function (x) { return x && typeof x === 'object' && typeof x.source === 'string'; });
}
function entryFor(msg, url) {
  const u = String(url || '');
  return entriesOf(msg).find(function (x) { return x.source === u; }) || null;
}
function descriptionFor(msg, url) {
  const e = entryFor(msg, url);
  return e && typeof e.text === 'string' && e.text.trim() ? e.text.trim() : '';
}
function descText(text) { return DESC_PREFIX + String(text || '').trim(); }
function historyText(msg, url) {
  const d = descriptionFor(msg, url);
  return d ? descText(d) : '（图片）';
}

// 本地图片转 dataURL：上游不必能访问本站公网地址，网关直接把文件内容带给看图模型。
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function trustedLocalPath(url) {
  const raw = String(url || '');
  let pathname = raw;
  let host = '';
  if (/^https?:\/\//i.test(raw)) {
    try { const u = new URL(raw); pathname = u.pathname; host = u.hostname; } catch (e) { return null; }
    const base = String(process.env.PUBLIC_BASE_URL || '').trim();
    const baseHost = base ? (function () { try { return new URL(base).hostname; } catch (e) { return ''; } })() : '';
    const externalHost = host && host !== baseHost && !/^(localhost|127\.|::1|10\.|172\.(1[6-9]|2\d|3\[01])\.|192\.168\.)/.test(host);
    if (externalHost) return null;
  }
  let m = pathname.match(/^\/uploads\/([^/?#]+)$/);
  if (m) {
    let name; try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; }
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return null;
    return { file: path.join(UPLOADS_DIR, name), ext: path.extname(name).toLowerCase() };
  }
  m = pathname.match(/^\/stickers\/(?:t\/)?([^/?#]+)$/);
  if (m) {
    let name; try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; }
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return null;
    return { file: path.join(STICKERS_DIR, 't', name), ext: path.extname(name).toLowerCase() };
  }
  return null;
}
function payloadFor(url) {
  const raw = String(url || '');
  if (/^data:/i.test(raw) || /^https?:\/\//i.test(raw)) {
    const local = trustedLocalPath(raw);
    if (!local) return raw;
    try {
      const st = fs.statSync(local.file);
      if (!st.isFile() || st.size > 15 * 1024 * 1024) return raw;
      const mime = MIME_BY_EXT[local.ext] || 'image/jpeg';
      return 'data:' + mime + ';base64,' + fs.readFileSync(local.file).toString('base64');
    } catch (e) { return raw; }
  }
  const local = trustedLocalPath(raw);
  if (local && fs.existsSync(local.file)) {
    const mime = MIME_BY_EXT[local.ext] || 'image/jpeg';
    return 'data:' + mime + ';base64,' + fs.readFileSync(local.file).toString('base64');
  }
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base) return base + (raw.charAt(0) === '/' ? raw : '/' + raw);
  return raw;
}

async function describe(url) {
  const router = require('./model-router');
  const upstreamTarget = require('./upstream-target');
  const { provider, model } = router.resolveRoleModel('image_desc', { ignoreEnabled: true });
  if (!provider || !model) throw new Error('没配图片转写模型（后台·模型·用途模型·图片转写）');
  const prompt = prompts().template;
  if (!prompt.trim()) throw new Error('图片转写提示词是空的');
  const target = upstreamTarget.resolveTarget(provider, function (k) { return process.env[k] || ''; }, model);
  if (!target.url || !target.key) throw new Error('图片转写供应商未配置 API 地址或 Key');
  /* [位置:image-desc.js·describe thinkingPatch] [图片转写显式开思考] [11-09：原先不发思考参数靠厂商默认；glm 视觉模型上锁 thinking.enabled。顺带补 max_tokens 4096——实测 glm-5.3-flash 思考能把默认输出预算吃穿致正文为空（智谱四坑同款）] [注释时间 2026-11-09] */
  const body = Object.assign({
    model, stream: false, temperature: 0.2, max_tokens: 4096,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: payloadFor(url) } },
      { type: 'text', text: prompt }
    ] }]
  }, router.thinkingPatch(provider));
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, prompts().timeout_sec * 1000);
  let resp;
  try {
    resp = await fetch(target.url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + target.key }, target.headers || {}),
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '图片转写超时' : ('图片转写连不上：' + e.message));
  } finally { clearTimeout(timer); }
  const raw = await resp.text();
  let j = null; try { j = JSON.parse(raw); } catch (e) {}
  if (!resp.ok) throw new Error('图片转写失败 HTTP ' + resp.status + '：' + ((j && j.error && (j.error.message || j.error)) || raw.slice(0, 120)));
  const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const text = String(typeof out === 'string' ? out : '').trim().replace(/^["“「]+|["”」]+$/g, '').replace(/\s*\n+\s*/g, ' ');
  if (!text) throw new Error('图片转写模型返回空内容');
  return text.slice(0, 2000);
}

// 本轮末尾连续 user 消息：只有这些图片保真发给模型，也只对这些新图做自动转写。
function trailingUserTargets(messages) {
  const out = [];
  const arr = Array.isArray(messages) ? messages : [];
  for (let i = arr.length - 1; i >= 0 && out.length < 20; i--) {
    const m = arr[i];
    if (!m) continue;
    if (m.role === 'user') { out.push(m); continue; }
    if (m.role === 'assistant' || m.role === 'tool') break;
  }
  return out.reverse();
}

// 发给不能看图的模型前，在原图 part 后面补转写文本。supplement 是本轮刚生成但可能还没落盘的兜底映射。
function annotateCurrentImages(messages, supplement) {
  const extra = supplement instanceof Map ? supplement : null;
  return (Array.isArray(messages) ? messages : []).map(function (m) {
    if (!m || !Array.isArray(m.content) || !imageParts(m.content).length) return m;
    const parts = [];
    for (const p of m.content) {
      parts.push(p);
      const url = imageUrlOf(p);
      if (!url) continue;
      const d = descriptionFor(m, url) || (extra ? String(extra.get(url) || '').trim() : '');
      if (d) parts.push({ type: 'text', text: descText(d) });
    }
    return Object.assign({}, m, { content: parts });
  });
}

async function ensureTurnDescriptions(deps) {
  const o = deps || {};
  const router = require('./model-router');
  if (router.modelSupportsVision(o.provider, o.model)) return { skipped: 'vision', annotations: new Map(), described: 0, failed: 0 };
  let targets = trailingUserTargets(o.requestMessages).filter(function (m) { return imageUrls(m.content).length > 0; });
  // 请求窗口通常不带 image_desc 扩展字段；先按 id/内容从盘上补齐，重试/重新生成不重复转写
  try {
    const existingTimeline = o.loadTimeline(o.sessionId);
    const normalize = o.normalizeContentToText || function (c) { return typeof c === 'string' ? c : JSON.stringify(c || ''); };
    targets = targets.map(function (target) {
      for (let i = existingTimeline.length - 1; i >= 0; i--) {
        const tm = existingTimeline[i];
        if (!tm || tm.role !== 'user' || tm.deleted) continue;
        const byId = target.id && tm.id === target.id;
        const byContent = !target.id && normalize(tm.content) === normalize(target.content);
        if ((byId || byContent) && Array.isArray(tm.image_desc) && tm.image_desc.length) {
          return Object.assign({}, target, { image_desc: tm.image_desc });
        }
      }
      return target;
    });
  } catch (e) { /* 盘上查不到就按新图处理 */ }
  const urls = [];
  for (const m of targets) {
    for (const u of imageUrls(m.content)) {
      if (!entryFor(m, u) && urls.indexOf(u) < 0) urls.push(u);
    }
  }
  if (!urls.length) return { skipped: 'no-image', annotations: new Map(), described: 0, failed: 0 };

  const annotations = new Map();
  const errors = new Map();
  // 多图并行转写：一张一张串行会让多图消息等很久；单图仍只有一次看图调用
  await Promise.all(urls.map(async function (url) {
    try { annotations.set(url, await describe(url)); }
    catch (e) { errors.set(url, e && e.message ? e.message : String(e)); }
  }));

  let patched = 0;
  let saved = false;
  let staleMarked = false;
  try {
    const timeline = o.loadTimeline(o.sessionId);
    const normalize = o.normalizeContentToText || function (c) { return typeof c === 'string' ? c : JSON.stringify(c || ''); };
    const snap = o.snapshotV2 && o.snapshotV2.loadSnapshot ? o.snapshotV2.loadSnapshot(o.baseDir, o.sessionId) : null;
    const snapPoint = snap && Number.isFinite(snap.snap_point) ? Number(snap.snap_point) : null;
    for (const target of targets) {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const tm = timeline[i];
        if (!tm || tm.role !== 'user' || tm.deleted) continue;
        const byId = target.id && tm.id === target.id;
        const byContent = !target.id && tm.role === target.role && normalize(tm.content) === normalize(target.content);
        if (!byId && !byContent) continue;
        const sources = imageUrls(tm.content);
        if (!sources.length) continue;
        let list = Array.isArray(tm.image_desc) ? tm.image_desc.slice() : [];
        for (const url of sources) {
          if (list.some(function (x) { return x && x.source === url; })) continue;
          if (annotations.has(url)) list.push({ source: url, text: String(annotations.get(url)).slice(0, 2000), at: new Date().toISOString() });
          else if (errors.has(url)) list.push({ source: url, error: String(errors.get(url)).slice(0, 300), at: new Date().toISOString() });
          else continue;
          patched++;
        }
        if (list !== tm.image_desc) {
          timeline[i] = Object.assign({}, tm, { image_desc: list });
          if (snapPoint !== null && i < snapPoint) staleMarked = true;
        }
        break;
      }
    }
    if (patched && typeof o.saveTimeline === 'function') saved = !!o.saveTimeline(timeline, o.sessionId);
    if (staleMarked && o.snapshotV2 && o.snapshotV2.markStale) {
      try { o.snapshotV2.markStale(o.baseDir, o.sessionId, 'image-desc-upsert'); } catch (e) {}
    }
  } catch (e) {
    console.warn('[image-desc] 转写结果写回时间线失败（本轮仍用内存转写）：' + (e && e.message ? e.message : e));
  }

  if (annotations.size || errors.size) {
    console.log(JSON.stringify({ event: 'image_desc_summary', session: o.sessionId || '', images: urls.length, described: annotations.size, failed: errors.size, persisted: patched && saved }));
  }
  return { skipped: '', annotations, described: annotations.size, failed: errors.size, persisted: patched && saved };
}

module.exports = {
  DESC_PREFIX, DEFAULT_PROMPT,
  prompts, adminGet, adminSave, adminReset, describe,
  imageUrlOf, imageParts, imageUrls, entriesOf, entryFor, descriptionFor,
  descText, historyText, annotateCurrentImages, trailingUserTargets, ensureTurnDescriptions
};
