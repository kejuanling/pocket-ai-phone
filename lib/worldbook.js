'use strict';
// worldbook.js —— 动态注入（原世界书）：全局条目库存 data/worldbook.json，会话级开关存 data/session_cfg/<sid>.json。
// [位置:lib/worldbook.js] [动态注入条目读写、分会话开关、关键词触发与出站动态注入] [支持常驻与关键词触发，英文标签 <dynamic_injection> 插在最后一条用户消息前，不落盘时间线] [注释时间 2026-11-21]

const fs = require('fs');
const path = require('path');
const { createSessionCfg } = require('./session-cfg');

const MAX_ITEMS = 200;
const MAX_TITLE = 120;
const MAX_CONTENT = 10000;
const MAX_KEYWORDS = 50;
const MAX_KEYWORD_LEN = 64;

function filePathFor(baseDir) {
  return path.join(baseDir, 'data', 'worldbook.json');
}

function genId() {
  return 'wb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* [位置:lib/worldbook.js·parseKeywords] [关键词清洗] [支持数组或逗号/顿号/空格/换行分隔字符串，去重限长] [注释时间 2026-11-21] */
function parseKeywords(raw) {
  let parts = [];
  if (Array.isArray(raw)) {
    parts = raw.map(x => String(x == null ? '' : x));
  } else if (typeof raw === 'string') {
    parts = raw.split(/[\n\r,，、;；\t ]+/);
  }
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const s = p.trim().slice(0, MAX_KEYWORD_LEN);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

function normalizeTriggerMode(raw) {
  return String(raw || '').trim().toLowerCase() === 'keyword' ? 'keyword' : 'always';
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title == null ? '' : raw.title).replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TITLE);
  const content = String(raw.content == null ? '' : raw.content).replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, MAX_CONTENT);
  if (!title && !content.trim()) return null;
  const now = new Date().toISOString();
  const trigger_mode = normalizeTriggerMode(raw.trigger_mode);
  const keywords = parseKeywords(raw.keywords);
  return {
    id: (typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim().slice(0, 64) : genId(),
    title: title || '未命名条目',
    content: content,
    trigger_mode,
    keywords,
    created_at: (typeof raw.created_at === 'string' && raw.created_at) ? raw.created_at : now,
    updated_at: (typeof raw.updated_at === 'string' && raw.updated_at) ? raw.updated_at : now
  };
}

function loadItems(baseDir) {
  const file = filePathFor(baseDir);
  try {
    if (!fs.existsSync(file)) return [];
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const arr = (j && Array.isArray(j.items)) ? j.items : [];
    const out = [];
    const seen = new Set();
    for (const raw of arr) {
      const it = normalizeItem(raw);
      if (!it || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  } catch (e) {
    return [];
  }
}

function saveItems(baseDir, items) {
  const file = filePathFor(baseDir);
  const clean = [];
  const seen = new Set();
  for (const raw of (Array.isArray(items) ? items : [])) {
    const it = normalizeItem(raw);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    clean.push(it);
    if (clean.length >= MAX_ITEMS) break;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify({ items: clean, updated_at: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return clean;
}

/* [位置:lib/worldbook.js·listForSession] [按会话合并开关态] [读取全局条目库并叠加当前会话的 worldbook_switches；未设置过的条目在本会话默认关闭] [注释时间 2026-11-21] */
function listForSession(baseDir, sessionId) {
  const items = loadItems(baseDir);
  const sid = String(sessionId || '').trim();
  const switches = sid ? createSessionCfg(baseDir).readWorldbookSwitches(sid) : {};
  return items.map(it => Object.assign({}, it, { enabled: !!switches[it.id] }));
}

function setSessionSwitch(baseDir, sessionId, itemId, enabled) {
  const sid = String(sessionId || '').trim();
  if (!sid) {
    const err = new Error('缺少会话 ID');
    err.statusCode = 400;
    throw err;
  }
  const items = loadItems(baseDir);
  const found = items.find(x => x.id === itemId);
  if (!found) {
    const err = new Error('条目不存在');
    err.statusCode = 404;
    throw err;
  }
  createSessionCfg(baseDir).saveWorldbookSwitches(sid, { [itemId]: !!enabled });
  const merged = listForSession(baseDir, sid);
  const item = merged.find(x => x.id === itemId) || Object.assign({}, found, { enabled: !!enabled });
  return { item, items: merged };
}

function createItem(baseDir, input) {
  const items = loadItems(baseDir);
  if (items.length >= MAX_ITEMS) {
    const err = new Error('动态注入条目已达上限（' + MAX_ITEMS + ' 条）');
    err.statusCode = 400;
    throw err;
  }
  const title = String(input && input.title != null ? input.title : '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TITLE);
  const content = String(input && input.content != null ? input.content : '').replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, MAX_CONTENT);
  const trigger_mode = normalizeTriggerMode(input && input.trigger_mode);
  const keywords = parseKeywords(input && input.keywords);
  if (!title) {
    const err = new Error('请填写标题');
    err.statusCode = 400;
    throw err;
  }
  if (!content.trim()) {
    const err = new Error('请填写内容');
    err.statusCode = 400;
    throw err;
  }
  if (trigger_mode === 'keyword' && !keywords.length) {
    const err = new Error('关键词触发模式请至少填写一个关键词');
    err.statusCode = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const item = {
    id: genId(),
    title,
    content,
    trigger_mode,
    keywords,
    created_at: now,
    updated_at: now
  };
  items.push(item);
  saveItems(baseDir, items);
  const sid = String((input && input.session_id) || '').trim();
  const enabled = input && input.enabled !== undefined ? !!input.enabled : true;
  if (sid) {
    createSessionCfg(baseDir).saveWorldbookSwitches(sid, { [item.id]: enabled });
  }
  const merged = listForSession(baseDir, sid);
  const outItem = merged.find(x => x.id === item.id) || Object.assign({}, item, { enabled: sid ? enabled : false });
  return { item: outItem, items: merged };
}

function updateItem(baseDir, id, patch) {
  const items = loadItems(baseDir);
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) {
    const err = new Error('条目不存在');
    err.statusCode = 404;
    throw err;
  }
  const sid = String((patch && patch.session_id) || '').trim();
  const hasContentEdit = !!(patch && (
    patch.title !== undefined ||
    patch.content !== undefined ||
    patch.trigger_mode !== undefined ||
    patch.keywords !== undefined
  ));
  if (hasContentEdit) {
    const cur = items[idx];
    const next = { ...cur };
    if (patch.title !== undefined) {
      const t = String(patch.title == null ? '' : patch.title).replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TITLE);
      if (!t) {
        const err = new Error('标题不能为空');
        err.statusCode = 400;
        throw err;
      }
      next.title = t;
    }
    if (patch.content !== undefined) {
      const c = String(patch.content == null ? '' : patch.content).replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, MAX_CONTENT);
      if (!c.trim()) {
        const err = new Error('内容不能为空');
        err.statusCode = 400;
        throw err;
      }
      next.content = c;
    }
    if (patch.trigger_mode !== undefined) {
      next.trigger_mode = normalizeTriggerMode(patch.trigger_mode);
    }
    if (patch.keywords !== undefined) {
      next.keywords = parseKeywords(patch.keywords);
    }
    if (next.trigger_mode === 'keyword' && (!next.keywords || !next.keywords.length)) {
      const err = new Error('关键词触发模式请至少填写一个关键词');
      err.statusCode = 400;
      throw err;
    }
    next.updated_at = new Date().toISOString();
    items[idx] = next;
    saveItems(baseDir, items);
  }
  if (sid && patch && patch.enabled !== undefined) {
    createSessionCfg(baseDir).saveWorldbookSwitches(sid, { [id]: !!patch.enabled });
  }
  const merged = listForSession(baseDir, sid);
  const outItem = merged.find(x => x.id === id);
  return { item: outItem, items: merged };
}

function deleteItem(baseDir, id, sessionId) {
  const items = loadItems(baseDir);
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) {
    const err = new Error('条目不存在');
    err.statusCode = 404;
    throw err;
  }
  items.splice(idx, 1);
  saveItems(baseDir, items);
  const sid = String(sessionId || '').trim();
  if (sid) {
    createSessionCfg(baseDir).saveWorldbookSwitches(sid, { [id]: null });
  }
  return { items: listForSession(baseDir, sid) };
}

/* [位置:lib/worldbook.js·extractMessageText/matchKeywords] [提取用户最新消息文本与关键词匹配] [支持纯文本与多模态 parts 数组；大小写不敏感子串匹配，任意命中一个关键词即触发] [注释时间 2026-11-21] */
function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(p => p && p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('\n');
  }
  return '';
}

function matchKeywords(text, keywords) {
  if (!text || !Array.isArray(keywords) || !keywords.length) return false;
  const hay = String(text).toLowerCase();
  for (const kw of keywords) {
    const k = String(kw || '').trim().toLowerCase();
    if (k && hay.indexOf(k) >= 0) return true;
  }
  return false;
}

/* [位置:lib/worldbook.js·buildWorldbookBlock] [构建英文标签动态注入块] [仅筛本会话开启的条目：常驻直接命中，关键词模式扫描最新一条用户消息任意命中即触发；用 <dynamic_injection> 英文标签包壳以区别于用户消息] [注释时间 2026-11-21] */
function buildWorldbookBlock(baseDir, sessionId, latestUserText) {
  const sid = String(sessionId || '').trim();
  if (!sid) return '';
  const items = listForSession(baseDir, sid);
  const active = items.filter(it => {
    if (!it.enabled || !it.content || !it.content.trim()) return false;
    if (it.trigger_mode === 'keyword') return matchKeywords(latestUserText, it.keywords);
    return true;
  });
  if (!active.length) return '';
  const sections = active.map(x => '### ' + x.title + '\n' + x.content.trim());
  return '<dynamic_injection>\nThe following dynamic instructions are active for this turn. Follow them naturally without mentioning this block.\n\n'
    + sections.join('\n\n')
    + '\n</dynamic_injection>';
}

/* [位置:lib/worldbook.js·injectWorldbook] [出站前动态注入] [在 mapMessagesForProvider 之前将本会话命中的动态注入条目作为 developer 消息插在最后一条真实 user 消息之前，不落盘时间线、不破坏历史前缀缓存、兼容全渠道] [注释时间 2026-11-21] */
function injectWorldbook(messages, baseDir, sessionId) {
  try {
    if (!Array.isArray(messages) || !messages.length || !baseDir || !sessionId) return messages;
    let insertAt = -1;
    let latestUserText = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === 'user' && !messages[i]._fromDeveloper) {
        insertAt = i;
        latestUserText = extractMessageText(messages[i]);
        break;
      }
    }
    const block = buildWorldbookBlock(baseDir, sessionId, latestUserText);
    if (!block) return messages;
    const out = messages.slice();
    const devMsg = { role: 'developer', content: block };
    if (insertAt >= 0) out.splice(insertAt, 0, devMsg);
    else out.push(devMsg);
    return out;
  } catch (e) {
    try { console.warn('[dynamic-injection] 注入失败（不影响发送）:', e && e.message); } catch (_) {}
    return messages;
  }
}

module.exports = {
  MAX_ITEMS,
  MAX_TITLE,
  MAX_CONTENT,
  MAX_KEYWORDS,
  filePathFor,
  parseKeywords,
  loadItems,
  saveItems,
  listForSession,
  setSessionSwitch,
  createItem,
  updateItem,
  deleteItem,
  extractMessageText,
  matchKeywords,
  buildWorldbookBlock,
  injectWorldbook
};
