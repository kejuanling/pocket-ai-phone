'use strict';
/* [位置:routes/recall-hits.js·文件头] [命中页接口：小手机「痕迹」app「命中」分段读召回命中记录] [11-14 随手记15：数据两路——① context/context-v2-runtime.js·logRecallHit 钩子按月落盘的 data/recall_hits_YYYYMM.jsonl（mode=inject 真注入 / preview 注入关着时的「本应命中」）；② 时间线里的历史浮现消息（hidden developer 带 float_id，9-10 月存量），按逐文件指纹（mtime+size）增量索引到 data/cache/recall-floats-index.json（纯缓存，删了自动重建；每次请求最多解析 25 个变化文件，防 gateway 事件循环长阻塞，没扫完回 pending 由前端续拉）。合并去重：钩子 inject 记录吞掉同会话 ±2 分钟内 float_id 相同的浮现条（浮现 msg_id 挂成 anchor_msg_id 做上下文锚点），独立浮现保留为 kind=float。列表按时间倒序分页；上下文窗口复用 /v1/trace-context（msg_id 或新增的 at= 时间锚定）] [注释时间 2026-11-14] */
const fs = require('fs');
const path = require('path');
const TIMELINE_DIR = require('../lib/timeline-dir').TIMELINE_DIR;
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache', 'recall-floats-index.json');
const HOOK_FILE_RE = /^recall_hits_\d{6}\.jsonl$/;
const TL_FILE_RE = /^enhanced_messages[_-][A-Za-z0-9_-]+\.json$/;
const SCAN_BUDGET = 60;          // 单次请求最多解析的时间线文件数（实测约 8ms/文件，追赶期单请求 ≤0.6s）
const MERGE_WINDOW_MS = 120000;  // 钩子记录与浮现条的合并窗口

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return dflt; } }

/* [位置:routes/recall-hits.js·sidOf] [时间线文件名 → 会话 id（legacy 主文件=default，同 /v1/search 口径）] [注释时间 2026-11-14] */
function sidOf(f) { return f === 'enhanced_messages.json' ? 'default' : f.replace(/^enhanced_messages_/, '').replace(/\.json$/, ''); }

/* [位置:routes/recall-hits.js·srcOf] [命中条目来源分类：trace:/album: 前缀是万物召回，其余是记忆池] [注释时间 2026-11-14] */
function srcOf(id) { const s = String(id || ''); return /^trace:/.test(s) ? 'trace' : (/^album:/.test(s) ? 'album' : 'memory'); }

/* ---- 历史浮现索引（纯缓存）---- */

let scanState = null;   // 进程内 { fileFp:{文件:指纹}, floats:[{sid,msg_id,float_id,time,text,query}] }

function saveFloatIndex(cacheFile) {
  const file = cacheFile || CACHE_FILE;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), fileFp: scanState.fileFp, floats: scanState.floats }));
    fs.renameSync(tmp, file);
  } catch (_) { /* 缓存写失败不影响列表 */ }
}

/* [位置:routes/recall-hits.js·ensureFloatIndex] [增量收集时间线里的浮现消息：指纹没变的会话直接复用，变化的才重新解析；单次最多 SCAN_BUDGET 个文件，返回还没扫完的数量] [浮浮现条带触发消息：向前找最近一条真实 user 消息（isRealMessageForTimeline），截 200 字当 query] [注释时间 2026-11-14] */
function ensureFloatIndex(deps) {
  const tlDir = (deps && deps.timelineDir) || TIMELINE_DIR;   // 测试可注入临时时间线目录；线上恒为真实目录
  const cacheFile = (deps && deps.cacheFile) || CACHE_FILE;
  if (!scanState) {
    const disk = readJson(cacheFile, null);
    scanState = (disk && disk.v === 1 && disk.fileFp && Array.isArray(disk.floats))
      ? { fileFp: disk.fileFp, floats: disk.floats }
      : { fileFp: {}, floats: [] };
  }
  let files = [];
  try { files = fs.readdirSync(tlDir).filter(f => f === 'enhanced_messages.json' || TL_FILE_RE.test(f)); } catch (_) { return 0; }
  const changed = [];
  for (const f of files) {
    let st = null; try { st = fs.statSync(path.join(tlDir, f)); } catch (_) {}
    const k = st ? (st.mtimeMs + ':' + st.size) : 'gone';
    if (scanState.fileFp[f] !== k) changed.push({ f, k });
  }
  const fileSet = new Set(files);
  for (const f in scanState.fileFp) {   // 文件已删除：清指纹也清该会话条目
    if (fileSet.has(f)) continue;
    delete scanState.fileFp[f];
    const sid = sidOf(f);
    scanState.floats = scanState.floats.filter(x => x.sid !== sid);
  }
  let processed = 0, attempted = 0;   // processed＝真扫完的（记了指纹），attempted＝本次用掉的预算（含读失败）
  for (const ch of changed) {
    if (attempted >= SCAN_BUDGET) break;
    attempted++;
    const sid = sidOf(ch.f);
    if (ch.k !== 'gone') {
      /* [位置:routes/recall-hits.js·ensureFloatIndex 读失败不记指纹] [名称:时间线读失败保留旧索引、下次重试] [需求:11-15 健壮性——原来先把 mtime+size 指纹写进 fileFp 再 loadTimeline，读抛错时该会话的浮现条目已被清空、指纹却已记下，这个会话在命中页永久消失且不会再扫；现在先读成功再清再记指纹，失败就整段跳过（不动已有条目、不记指纹），pending 里继续留着，前端续拉时重试] [注释时间 2026-11-15] */
      let arr = null, readFailed = false;
      try { arr = deps.loadTimeline(sid) || []; } catch (_) { readFailed = true; }
      if (readFailed) continue;   // 没扫完：不吃 processed，该文件仍算在 pending 里等下次重试
      scanState.floats = scanState.floats.filter(x => x.sid !== sid);
      scanState.fileFp[ch.f] = ch.k;
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i];
        if (!m || m.deleted || m.role !== 'developer' || !m.float_id) continue;
        let q = '';
        for (let j = i - 1; j >= 0; j--) {
          const pm = arr[j];
          if (!pm || pm.deleted || pm.role !== 'user') continue;
          if (deps.isRealMessageForTimeline && !deps.isRealMessageForTimeline(pm)) continue;
          q = String((deps.normalizeContentToText ? deps.normalizeContentToText(pm.content) : pm.content) || '').replace(/<current_time>[\s\S]*?<\/current_time>/gi, '').replace(/\s+/g, ' ').trim().slice(0, 200);
          break;
        }
        scanState.floats.push({
          sid,
          msg_id: String(m.id),
          float_id: String(m.float_id),
          time: m.time || '',
          text: String((deps.normalizeContentToText ? deps.normalizeContentToText(m.content) : m.content) || '').replace(/<current_time>[\s\S]*?<\/current_time>/gi, '').replace(/\s+/g, ' ').trim().slice(0, 200),
          query: q,
        });
      }
    } else {
      delete scanState.fileFp[ch.f];
      scanState.floats = scanState.floats.filter(x => x.sid !== sid);
    }
    processed++;
  }
  if (processed) saveFloatIndex(cacheFile);
  return Math.max(0, changed.length - processed);
}

/* ---- 钩子月度 jsonl ---- */

/* [位置:routes/recall-hits.js·readHookRecords] [读全部 recall_hits_YYYYMM.jsonl，坏行跳过] [注释时间 2026-11-14] */
function readHookRecords() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(DATA_DIR).filter(f => HOOK_FILE_RE.test(f)).sort(); } catch (_) { return out; }
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(DATA_DIR, f), 'utf8'); } catch (_) { continue; }
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s);
        if (o && o.ts && Array.isArray(o.hits) && o.hits.length) out.push(o);
      } catch (_) { /* 坏行跳过 */ }
    }
  }
  return out;
}

/* [位置:routes/recall-hits.js·mergeItems] [钩子记录 + 浮现条 → 统一列表（纯函数，便于单测）：inject 钩子吞掉同会话 ±2min 且 float_id 命中的浮现条并把浮现 msg_id 挂成 anchor_msg_id；剩余浮现成为 kind=float 独立条；倒序、before 分页、limit 截取、会话名映射] [注释时间 2026-11-14] */
function mergeItems(hooks, floats, names, limit, before) {
  const usedFloat = new Set();
  for (const h of hooks) {
    if (h.mode !== 'inject') continue;
    const ids = new Set((h.hits || []).map(x => String(x.id)));
    const hMs = Date.parse(h.ts) || 0;
    for (const fl of floats) {
      if (usedFloat.has(fl.msg_id) || fl.sid !== h.session) continue;
      if (!ids.has(fl.float_id)) continue;
      const d = Math.abs((Date.parse(fl.time) || 0) - hMs);
      if (d <= MERGE_WINDOW_MS) { usedFloat.add(fl.msg_id); h.anchor_msg_id = fl.msg_id; }
    }
  }
  let items = [];
  for (const h of hooks) {
    items.push({
      kind: 'hook',
      id: 'h:' + h.ts + ':' + h.session + ':' + (h.mode || ''),
      ts: h.ts,
      session: h.session || '',
      mode: h.mode === 'preview' ? 'preview' : 'inject',
      query: String(h.query || ''),
      hits: (h.hits || []).map(x => ({ id: String(x.id), src: x.src || srcOf(x.id), score: (x.score == null ? null : Number(x.score)), head: String(x.head || '') })),
      anchor_msg_id: h.anchor_msg_id || null,
    });
  }
  for (const fl of floats) {
    if (usedFloat.has(fl.msg_id)) continue;
    items.push({
      kind: 'float',
      id: 'f:' + fl.msg_id,
      ts: fl.time,
      session: fl.sid || '',
      mode: 'inject',
      query: String(fl.query || ''),
      hits: [{ id: fl.float_id, src: srcOf(fl.float_id), score: null, head: String(fl.text || '') }],
      anchor_msg_id: fl.msg_id,
    });
  }
  items.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  if (before) {
    const bMs = Date.parse(before);
    if (Number.isFinite(bMs)) items = items.filter(x => (Date.parse(x.ts) || 0) < bMs);
  }
  const page = items.slice(0, Math.max(1, limit)).map(it => Object.assign({}, it, { session_name: (names && names[it.session]) || null }));
  return { items: page, total: items.length };
}

/* [位置:routes/recall-hits.js·listHits] [列表主入口：增量扫浮现索引 → 读钩子 → 合并分页] [注释时间 2026-11-14] */
function listHits(deps, limit, before) {
  const pending = ensureFloatIndex(deps);
  const hooks = readHookRecords();
  const floats = scanState ? scanState.floats : [];
  const names = readJson(path.join(DATA_DIR, 'session-names.json'), {}) || {};
  const r = mergeItems(hooks, floats, names, limit, before);
  return { items: r.items, total: r.total, pending };
}

function factory(app, deps) {
  deps = deps || {};
  app.get('/v1/recall-hits', async (req, reply) => {
    try {
      const q = req.query || {};
      let limit = parseInt(String(q.limit || '50'), 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = 50;
      limit = Math.min(limit, 200);
      const before = String(q.before || '').trim();
      const r = listHits(deps, limit, before);
      reply.send({ ok: true, items: r.items, total: r.total, pending: r.pending });
    } catch (e) { reply.code(500).send({ ok: false, error: e.message }); }
  });
}

factory.listHits = listHits;
factory.ensureFloatIndex = ensureFloatIndex;   /* 单测钩子（11-15 读失败重试） */
factory._resetFloatIndex = function () { scanState = null; };   /* 单测钩子：清进程内索引，模拟重启 */
factory.mergeItems = mergeItems;
factory.srcOf = srcOf;
module.exports = factory;
