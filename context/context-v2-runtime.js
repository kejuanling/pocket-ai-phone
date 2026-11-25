'use strict';

// 聊天与唤醒共用的 Context V2 运行时（0920 完全统一）：
// 聊天（routes/chat.js）与唤醒（routes/wake-chat.js）调模型用的上下文组装，
// 全部走本模块 assembleAndApply 同一入口——输入组装（shadow.assembleInput）→
// SiliconFlow BAAI/bge-m3 语义算分（仅 event，失败回落字面）→ buildContextBlocks → apply。
// 同一时刻同一会话，两侧产出逐字一致（上游前缀缓存共享）。
//
// apply 的块插入（0919 修正版，0920 起聊天唤醒共用这一份）：
// V2 固定块插到开头连续 system 人设之后——人设永远最顶。
// 不再按已删除旧块数量定位：旧逻辑 old.length>0 时插到 0，把 V2 块排到人设
// 前面（唤醒侧 0920 实翻车；聊天侧同款 bug 已于 0919 修复）。
//
// 记忆浮现写入（floatMemoriesToTimeline）同样归一在此：命中记忆原样写时间线
// 永久在场，聊天与唤醒行为一致（0920 用户拍板）。

const path = require('path');
const fs = require('fs');
const fsp = require('fs-extra');
const { buildContextBlocks, HEADERS: V2_HEADERS } = require('./context-v2-builder');
const { getDatePartsInTimeZone } = require('../utils/time_utils');
const shadow = require('./context-v2-shadow');
const crypto = require('crypto'); // 1010 需求3：标星 contentKey 同口径
const { createSessionCfg } = require('../lib/session-cfg');   // 2026-10-03：会话级跨窗口开关
const { getInheritedState } = require('../lib/conversation-state'); // 1010 需求2：状态机快照继承（最后一次聊天会话）
const { safeSessionToken } = require('../lib/session-token'); // 1010 需求3：标星跨会话扫描时间线文件
const { cleanDialogText } = require('../lib/dialog-clean');
const frozenBlocks = require('../lib/frozen-blocks'); // 1018：日记/标星/笔记本建好即固定，重建不刷新

// 1005-17：相关注入参数（memory_v2_config.json relevant 段，管理台可调）
function readRelevantCfg(baseDir) {
  try {
    const c = fsp.readJsonSync(path.join(baseDir, 'data', 'memory_v2_config.json'));
    if (c && c.relevant && typeof c.relevant === 'object') {
      const r = c.relevant;
      return {
        relevantWordWeight: r.wordWeight,
        relevantSemWeight: r.semWeight,
        relevantMinHybridScore: r.minHybridScore,
        relevantHybridTopK: r.topK,
      };
    }
  } catch (_) {}
  return {};
}

// 1005-17：注入预览——记录最近 20 轮"本应注入哪条 + 混合分"（观察用，不进 prompt）
function appendPreview(baseDir, sessionId, query, hits) {
  try {
    const p = path.join(baseDir, 'data', 'relevant_preview.json');
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    if (!Array.isArray(arr)) arr = [];
    arr.unshift({
      time: new Date().toISOString(),
      session: String(sessionId || '').slice(0, 40),
      query: String(query || '').slice(0, 500),
      hits: (hits || []).map(function (h) {
        return { id: h && h.id, kind: h && h.kind, score: h && h.score, wordScore: h && h.wordScore, vibeScore: h && h.vibeScore, text: (h && h.text || '').slice(0, 160) };
      }),
    });
    arr = arr.slice(0, 20);
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  } catch (_) {}
}

/* [位置:context/context-v2-runtime.js·logRecallHit] [命中审计：每轮召回命中的条目按月追加落盘，给小手机「命中」页读] [11-14 随手记15：命中此前无持久记录（preview 只滚动留 20 轮、markHit 只存 last_hit_at），在 relevantHits 定型处补唯一写入口——inject=真注入（记忆池+万物召回）、preview=注入关着时的「本应命中」；只增不改，失败静默绝不影响主链路；读侧在 routes/recall-hits.js] [注释时间 2026-11-14] */
function logRecallHit(baseDir, sessionId, mode, query, hits) {
  try {
    const list = (Array.isArray(hits) ? hits : []).filter(function (h) { return h && h.id; });
    if (!list.length) return;
    const now = new Date();
    const ym = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
    const p = path.join(baseDir || path.join(__dirname, '..'), 'data', 'recall_hits_' + ym + '.jsonl');
    const line = JSON.stringify({
      ts: now.toISOString(),
      session: String(sessionId || ''),
      mode: mode === 'preview' ? 'preview' : 'inject',
      query: String(query || '').slice(0, 300),
      hits: list.slice(0, 20).map(function (h) {
        return {
          id: String(h.id),
          src: /^trace:/.test(String(h.id)) ? 'trace' : (/^album:/.test(String(h.id)) ? 'album' : 'memory'),
          score: Math.round((Number(h.score) || 0) * 100) / 100,
          head: String(h.text || '').slice(0, 120),
        };
      }),
    });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, line + '\n');
  } catch (_) { /* 审计失败不影响主链路 */ }
}


// 1018：跨窗口注入里的对话条目统一格式（标星对话）：
//   2026年10月18日 17:18 · 用户
//   正文
//
//   ---
// 说话人：用户优先取 .env 的 USER_DISPLAY_NAME，为空时回退主题设置 config/chat-settings.json 的 user_name，再默认「用户」；AI 一律写「我」（这块是写给「我」读的）；时间精确到分钟，缺失只写说话人。
// 正文在标星入库时已清洗（lib/dialog-clean.js，见 context-replacements.setMark/updateMark），这里只套头，不再现拼。
const { getUserDisplayName } = require('../lib/display-names');
function speakerName(role) {
  if (role === 'user') return getUserDisplayName();
  return '我';
}
function formatDialogEntry(role, text, time) {
  const body = String(text || '').trim();
  if (!body) return '';
  let head = '';
  try {
    const d = time ? new Date(time) : null;
    if (d && !isNaN(d.getTime())) {
      const p = getDatePartsInTimeZone(d);
      head = Number(p.year) + '年' + Number(p.month) + '月' + Number(p.day) + '日 ' + p.hour + ':' + p.minute + ' · ';
    }
  } catch (e) { head = ''; }
  return head + speakerName(role) + '\n' + body + '\n\n---';
}

// 标星跨窗口注入：marks 文件保存的原文是主数据源；仅旧记录缺原文时才回查时间线。
// key 兼容旧版 contentKey 与新版 message id。按 role+正文指纹去重，避免复制窗口重复注入。
// 1017：excludeMsgs＝当前窗口已有的消息（分支/导入/复制窗口里标星原文本来就在对话里），
// 指纹命中的不再进 Starred Dialog，避免同一条标星在对话和注入块里各出现一次。
// 1018：返回选中的标星条目 [{key, role, text, time}]（key = marks 里的键，「建好即固定」按条冻结用）。
// onlyKeys（Set/数组）：只取这几条（冻结成员；取消标星的自然消失、改过的用当前原文、新标星进不来），此时不再按条数截取。
function readStarredDialogEntries(baseDir, loadTimeline, limit, excludeMsgs, onlyKeys) {
  let marks = {};
  try {
    const d = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'context_compaction_marks.json'), 'utf8'));
    if (d && d.marks && typeof d.marks === 'object') marks = d.marks;
  } catch (e) { return []; }
  const only = onlyKeys ? new Set(Array.from(onlyKeys).map(String)) : null;
  const entries = Object.entries(marks).filter(function (kv) { return !only || only.has(String(kv[0])); });
  if (!entries.length) return [];

  const contentKey = function (role, text) {
    return crypto.createHash('sha256').update(String(role || '') + '\u0000' + String(text || '')).digest('hex').slice(0, 32);
  };
  const collect = [];
  const missing = [];
  const seen = new Set();
  for (const m of (Array.isArray(excludeMsgs) ? excludeMsgs : [])) {
    if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()) {
      seen.add(contentKey(m.role, m.text));
      seen.add(contentKey(m.role, cleanDialogText(m.text)));   // 入库时正文已清洗，窗口原文要按清洗后也比一遍
    }
  }
  function add(markKey, role, text, time, fallbackTime) {
    if (typeof text !== 'string' || !text.trim()) return;
    const k = contentKey(role, text);
    if (seen.has(k)) return;
    seen.add(k);
    collect.push({ key: String(markKey), time: String(time || fallbackTime || ''), role: role, text: text.trim() });
  }

  for (const [key, entry] of entries) {
    if (entry && typeof entry.content === 'string' && entry.content.trim()) {
      add(key, entry.role || '', entry.content, entry.time || '', entry.markedAt || '');
    } else if (!(entry && entry.orphan)) {
      // orphan：原消息已不在任何时间线（1018 迁移时标记），不再触发全量扫描
      missing.push(String(key));
    }
  }

  // 只有旧标星条目缺少原文时，才扫描时间线。新记录通常直接从 marks.content 注入。
  if (missing.length) {
    const wanted = new Set(missing);
    const files = ['enhanced_messages.json'];
    const tlDir = require('../lib/timeline-dir').timelineDirOf(baseDir); // 1018-12
    try {
      for (const f of fs.readdirSync(tlDir)) {
        if (/^enhanced_messages_s_.*\.json$/.test(f)) files.push(f);
      }
    } catch (e) {}
    for (const f of files) {
      let tl = [];
      try { tl = JSON.parse(fs.readFileSync(path.join(tlDir, f), 'utf8')); } catch (e) { continue; }
      if (!Array.isArray(tl)) continue;
      for (const m of tl) {
        if (!m || ['system', 'developer', 'tool'].includes(m.role) || m.kind === 'diary' || m.kind === 'noaction') continue;
        if (typeof m.content !== 'string' || !m.content.trim()) continue;
        const byId = m.id != null && wanted.has(String(m.id));
        const ck = contentKey(m.role, m.content);
        const byContent = wanted.has(ck);
        if (!byId && !byContent) continue;
        add(byId ? String(m.id) : ck, m.role || '', m.content, m.time || '', '');
      }
    }
  }
  // 按真实时刻排序（时间串格式不一时字符串比较会错位）；解析不了的排最前、彼此保持原顺序
  const _t = function (x) { const v = Date.parse(x.time); return isNaN(v) ? -Infinity : v; };
  collect.sort(function (a, b) { const ta = _t(a), tb = _t(b); return ta === tb ? 0 : (ta < tb ? -1 : 1); });
  const n = Number(limit);
  return (!only && Number.isFinite(n) && n > 0) ? collect.slice(-Math.min(10000, Math.floor(n))) : collect;
}

function readStarredDialogLines(baseDir, loadTimeline, limit, excludeMsgs, onlyKeys) {
  return readStarredDialogEntries(baseDir, loadTimeline, limit, excludeMsgs, onlyKeys)
    .map(function (x) { return formatDialogEntry(x.role, x.text, x.time); })
    .filter(Boolean);
}

// 当前窗口已有的对话（user/assistant 正文），供 Starred Dialog 去重；任何异常按“没有”处理。
function _starExclude(opts) {
  const out = [];
  try {
    for (const m of (opts.messages || [])) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const t = opts.normalizeContentToText ? opts.normalizeContentToText(m.content) : m.content;
      if (typeof t === 'string' && t.trim()) out.push({ role: m.role, text: t });
    }
  } catch (e) {}
  return out;
}

// 把 builder 输出套进消息：剔除旧 [永久上下文]/[跨窗口] developer 块 →
// 固定块插到开头连续 system 之后；relevant_memories 单独追加到
// 末尾连续 user 消息之前（当轮待回复前，位于历史之后）。
function apply(messages, blocks) {
  const old = [];
  // 1004-11：V2 块头是 "## System Instructions" 等（HEADERS），旧前缀 [永久上下文]/[跨窗口] 是
  // V1 时代遗留——只匹配旧前缀时防御失效（新块清不掉）。
  // 1010-26：补齐 V2 全部块头（含顶层引导与新增的标星/最近）。此前漏了 Context Assembly / Starred Dialog /
  //   Recent Dialog，导致"快照里已有一份 + apply 再插一份"→ 这三块双份注入。
  //   引导块内容前缀是无空格的 "##Context Assembly"（面板自带），内置兜底是有空格的 "## Context Assembly"，两种都收。
  //   刻意不匹配 "## Conversation State"——那是会话自身状态块，不能清。
  // 1018：并入 builder 的 HEADERS 全集——此前手写清单漏了 "## Notebook Index"，快照读取路径每轮重复注入一份。
  const _v2Heads = ['## Recent Dialog'].concat(Object.values(V2_HEADERS));
  (messages || []).forEach((m, i) => {
    if (m && m.role === 'developer' && typeof m.content === 'string' &&
      (m.content.startsWith('[永久上下文]') || m.content.startsWith('[跨窗口]') || _v2Heads.some(function (h) { return m.content.startsWith(h); }))) old.push(i);
  });
  const fixed = (blocks || []).filter(b => b.key !== 'relevant_memories' && !b.empty).map(b => ({ role: 'developer', content: b.content }));
  const relevant = (blocks || []).find(b => b.key === 'relevant_memories' && !b.empty);
  const out = (messages || []).filter((m, i) => old.indexOf(i) < 0);
  // 插入点（0919 修正版）：跳过开头连续 system（人设），不按已删除旧块定位
  let at = 0;
  while (at < out.length && out[at] && out[at].role === 'system') at++;
  out.splice(at, 0, ...fixed);
  if (relevant) { let tail = out.length; while (tail && out[tail - 1].role === 'user') tail--; out.splice(tail, 0, { role: 'developer', content: relevant.content }); }
  return out;
}

// 共享组装入口（聊天与唤醒唯一调用形态）：
// opts: { baseDir, sessionId, messages, loadTimeline, normalizeContentToText }
// 返回 { messages, relevantHits }；失败向上抛，由调用方 catch 回退旧上下文。
let _vecScoreWarned = false;
// 快照模式下相关记忆动态计算的最小输入（1002-11，方案 B）：
// 只读 memory_v2 + 浮标清单 + 当前 query，其余固定输入字段置空——固定块由快照提供，
// 这里只为 relevant_memories 块（按本轮 user 消息浮动）与 relevantHits 服务。
function minimalAssembleInput(opts) {
  const dataDir = path.join(opts.baseDir, 'data');
  let memoriesV2 = [];
  try { memoriesV2 = JSON.parse(fs.readFileSync(path.join(dataDir, 'memory_v2.json'), 'utf8')); } catch (e) {}
  let query = '';
  try {
    const llmMessages = Array.isArray(opts.messages) ? opts.messages : [];
    for (let i = llmMessages.length - 1; i >= 0; i--) {
      const m = llmMessages[i];
      if (m && m.role === 'user') { query = opts.normalizeContentToText(m.content) || ''; break; }
    }
  } catch (e) {}
  let excludeIds = [];
  try {
    const map = JSON.parse(fs.readFileSync(path.join(dataDir, 'context_v2_floated.json'), 'utf8'));
    const arr = map[String(opts.sessionId || 'default')];
    excludeIds = Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) {}
  // 1002 §8 第 6 项：快照模式也要能重建两块总结（不能被快照冻住），故 pinned 与总结缓存都要读。
  // pinned 进 Core Identity 块（手工固定的人设常驻内容保留），总结替代条目原文直注。
  const pinnedData = shadow.readPinnedEntries(dataDir, { baseDir: opts.baseDir, sessionId: opts.sessionId });
  return { pinnedEntries: pinnedData.pinnedEntries, timeline: [], diaryEntries: [], memoriesV2: memoriesV2, query: query, excludeIds: excludeIds, config: Object.assign({ diaryCount: 0 }, readRelevantCfg(opts.baseDir)), map: null, summaryBlocks: shadow.readSummaryBlocks(dataDir), sessionId: opts.sessionId || null };
}

// 语义算分（Relevant 仅对有 vibe 的 event 计算 vibe 向量；失败回落纯词面）
async function attachVecScores(input) {
  try {
    const activeRows = require('../memory/memory-v2').createStore({ config: {} }).list({ status: 'active' }).filter(r => r.kind === 'event' && typeof r.vibe === 'string' && r.vibe.trim());
    const rs = await require('../memory/memory-v2-vectors').relevantVibeScores(activeRows, input.query);
    if (rs && rs.ok) input.vecScores = rs.scores;
  } catch (e) {
    if (!_vecScoreWarned) {
      _vecScoreWarned = true;
      console.warn('[context-v2] 语义算分不可用，本次起回落字面检索（后续同类失败不再重复告警）:', e && e.message);
    }
  }
}

// 1018：本会话勾选集合（null 配置 = 全局默认）
function wantSetOf(baseDir, sessionId) {
  try {
    const cfg = createSessionCfg(baseDir);
    const inj = cfg.readInjectBlocks(sessionId);
    return new Set(Array.isArray(inj) ? inj : cfg.DEFAULT_INJECT_BLOCKS);
  } catch (e) { return null; }
}

// 1018：继承上个会话状态块——本会话还没有自己的状态时每轮都注入（旧实现只在首轮出现）；
// 正文是建会话那一刻冻结的副本，不进快照，本会话第一次 commitMerge 后自然消失。
function inheritStateBlock(sessionId, wantSet) {
  try {
    if (!wantSet || !wantSet.has('state_inherit')) return null;
    const inh = getInheritedState(sessionId);
    if (!inh || !inh.text) return null;
    return { key: 'state_inherit', title: '', content: '## Conversation State\nRunning state of this conversation, summarized by a model. Updated periodically, not in real time; some details may be missing.\n\n' + inh.text, empty: false };
  } catch (e) { return null; }
}

async function assembleAndApply(opts) {
  // 相关记忆开关（1002 拍板）：关=不检索、不注入、不写时间线、不调 embed。
  const relOn = relevantEnabled(opts.baseDir);
  // 会话级跨窗口总开关（1010-28 用户拍板）：关闭 = 本会话不注入任何跨窗口内容，且**不生成注入快照**
  //（反正也不做跨窗口组装）；之后重新开启，下一轮照常懒生成。
  const crossOff = createSessionCfg(opts.baseDir).sessionCrossInjectOverride(opts.sessionId) === false;
  // 1005-17 预览模式：注入关闭但 relevant.preview=true 时，照常检索算分观察"本应注入哪条"，
  // 但不进 prompt、不浮现时间线、不打点（真实命中打点只在真注入时发生）。
  let relPreview = false;
  if (!relOn) {
    try { relPreview = fsp.readJsonSync(path.join(opts.baseDir, 'data', 'memory_v2_config.json')).relevant.preview === true; }
    catch (_) { relPreview = false; }
  }
  // 1010-31 阶段4c：注入块唯一来源=v2 快照（B.fixed_blocks/inject_meta）。
  // 旧注入快照 A 已退役：存量经 4b 批量迁移 + 4a 懒迁移全部入 B；无 B 的会话走下方首次组装从当前源重算。
  let existing = null;
  try {
    const _b = require('./context-snapshot-v2').loadSnapshot(opts.baseDir, opts.sessionId);
    if (_b && (Array.isArray(_b.fixed_blocks) || _b.inject_meta)) {
      existing = { fixed_blocks: Array.isArray(_b.fixed_blocks) ? _b.fixed_blocks : [] };
    }
  } catch (e) { existing = null; }
  let blocks;
  let relevantHits = [];
  let hookQuery = '';   // 命中审计用的触发消息文本（本轮最后一条 user，同 builder 的 query 口径）
  if (existing && Array.isArray(existing.fixed_blocks)) {
    // ---- 快照模式（1002-11）：人设与固定块永不重算，仅相关记忆动态 ----
    // 1018：存量会话首次走到这里时，把快照里的日记/标星/笔记本登记为固定内容（之后重建沿用）
    try {
      const _fbFile = require('path').join(opts.baseDir, 'data', 'session_frozen_blocks', safeSessionToken(opts.sessionId || 'default') + '.json');
      if (!fs.existsSync(_fbFile)) frozenBlocks.seedFromSnapshot(opts.baseDir, opts.sessionId, require('./context-snapshot-v2').loadSnapshot(opts.baseDir, opts.sessionId));
    } catch (e) { /* 登记失败不影响本轮 */ }
    const input = minimalAssembleInput(opts);
    // 关闭时 query 置空：buildRelevant 首行即返回空 → 无块、无 hits（顺带跳过 embed 请求）
    if (relOn || relPreview) { if (!relOn) input.previewOnly = true; await attachVecScores(input); } else input.query = '';
    hookQuery = input.query || '';
    const built = buildContextBlocks(input);
    blocks = existing.fixed_blocks
      .filter(function (b) { return b && b.content; })
      .map(function (b) { return { key: b.key, title: b.title || '', content: b.content, empty: false }; });
    // 1007 用户拍板：V2 注入块全部冻死（System Instructions / Core Identity / Long-term Understanding /
    // Earlier Days 都从快照读，不再实时构建覆盖）。此前 1002 §8 的"两块总结实时覆盖"逻辑已删除——
    // 记忆池/总结/文案变化都不会再即时反映，只有手动重建快照（或状态摘要/编辑消息触发重建）才更新。
    // 唯一仍动态的是 relevant_memories（相关记忆按本轮 user 消息现算）。
    const _inhBlk = inheritStateBlock(opts.sessionId, wantSetOf(opts.baseDir, opts.sessionId));
    if (_inhBlk) blocks.push(_inhBlk);
    const rel = built.blocks.find(function (b) { return b.key === 'relevant_memories' && !b.empty; });
    if (rel) blocks.push(rel);
    relevantHits = built.relevantHits || [];
    // 1005-17 预览：每轮都记录（即使命中为空），否则开关已开启但无命中时看起来像预览没运行。
    // 只观察、不进 prompt、不浮现、不打点；真注入时此段不触发。
    if (relPreview) {
      try { logRecallHit(opts.baseDir, opts.sessionId, 'preview', hookQuery, relevantHits); } catch (_) {}
      try { appendPreview(opts.baseDir, opts.sessionId, input.query, relevantHits); } catch (_) {}
      relevantHits = [];
    }
  } else {
    // ---- 首次（新会话 / 存量会话无快照）：全量组装并固化快照 ----
    const input = shadow.assembleInput({
      baseDir: opts.baseDir,
      sessionId: opts.sessionId,
      llmMessages: opts.messages,
      loadTimeline: opts.loadTimeline,
      normalizeContentToText: opts.normalizeContentToText,
    });
    // 1010-26：先把会话级多选（inject_blocks）解析出来，**过滤之后再固化快照**。
    // 旧实现是先冻全量、再过滤本次输出 → "新建会话时定型"根本不成立（快照里始终是全部块）。
    let wantBlocks = null; // 注入块白名单；null = 未解析成功（不过滤，保守放行）
    try {
      const cfg = createSessionCfg(opts.baseDir);
      const inj = cfg.readInjectBlocks(opts.sessionId);
      wantBlocks = new Set(Array.isArray(inj) ? inj : cfg.DEFAULT_INJECT_BLOCKS);
    } catch (e) { console.warn('[ctx-v2] inject_blocks 解析失败（本次不过滤）:', e && e.message); }
    // 1018：日记/标星/笔记本按冻结成员收窄输入（标星行也在这里算：成员 or 按条数限额现取）。失败静默（空块自然被跳过）。
    //（最近对话是建会话时写进时间线的原消息，不在这里组装。）
    let _frozenCap = null;
    try {
      _frozenCap = frozenBlocks.prepareInput(opts.baseDir, opts.sessionId, input, wantBlocks, {
        loadTimeline: opts.loadTimeline,
        starredLimit: createSessionCfg(opts.baseDir).readStarredDialogLimit(opts.sessionId),
        excludeMsgs: _starExclude(opts),
      });
    } catch (e) { console.warn('[ctx-v2] 固定块输入准备失败（按现算组装）:', e && e.message); }
    if (relOn || relPreview) { if (!relOn) input.previewOnly = true; await attachVecScores(input); } else input.query = '';
    hookQuery = input.query || '';
    const built = buildContextBlocks(input);
    if (_frozenCap) _frozenCap.diaryIds = (built.members && built.members.conversation_continuity) || [];

    // relevant_memories 不受多选控制（独立总闸）。
    // 其余块 key 与多选 key 一一对应（system_instructions / core_identity / long_term_understanding /
    // conversation_continuity / starred_dialog）。
    let selected = wantBlocks
      ? built.blocks.filter(function (b) {
          if (!b || !b.key) return true;
          if (b.key === 'relevant_memories') return true;
          return wantBlocks.has(b.key);
        })
      : built.blocks;
    // 1018：首次出现的日记/标星/笔记本登记成员（之后重建只按成员渲染）
    selected = frozenBlocks.finalize(opts.baseDir, opts.sessionId, selected, wantBlocks, _frozenCap, false);

    if (!crossOff) {
      // 1010-30 阶段4a：注入块直写 v2 快照（B 唯一快照；不再写旧注入快照 A）。
      // merge 语义保留 B 已有 content/snap_point（buildConversation 先写的），这里只补注入块。
      const sysMsg = (opts.messages || []).find(function (m) { return m && m.role === 'system'; });
      try {
        const sv2 = require('./context-snapshot-v2');
        const _fixed = selected
          .filter(function (b) { return b.key !== 'relevant_memories' && !b.empty; })
          .map(function (b) { return { key: b.key, title: b.title || '', content: b.content }; });
        const _n = sv2.mergeInjectBlocks(opts.baseDir, opts.sessionId, _fixed, {
          systemContent: sysMsg && sysMsg.content ? String(sysMsg.content) : '',
          selected: wantBlocks ? Array.from(wantBlocks) : null,   // 1018：红点「结构变化」比对基准
        });
        console.log('[ctx-v2] 会话注入块已并入 v2 快照: session=' + opts.sessionId + ' blocks=' + _n);
      } catch (e) {
        console.warn('[ctx-v2] 注入块并入快照失败（不影响本次请求，下次重试）:', e && e.message);
      }
    } else {
      console.log('[ctx-v2] 跨窗口总开关关闭，跳过生成注入快照: session=' + opts.sessionId);
    }
    blocks = selected;
    relevantHits = built.relevantHits || [];
    // 1010-26：继承状态块（可选 state_inherit）——b 没有自己的状态机时，把「最后一次聊天的会话 a」的
    // 状态正文作为 ## Conversation State 块 live 注入。不进快照：b 一旦自己 commitMerge，
    // 由替换块通道 ctxrep_state_<b> 自然接管。
    // 顺序（用户拍板）：日记 → 标星的对话 → 状态机；最近对话是建会话时写进时间线的原消息，不组装成块。
    const _inhBlk = inheritStateBlock(opts.sessionId, wantBlocks);
    if (_inhBlk) {
      blocks = blocks.concat([_inhBlk]);
      console.log('[ctx-v2] 状态机继承注入: session=' + opts.sessionId + '（' + _inhBlk.content.length + ' 字，建会话时冻结的副本）');
    }
    // 1005-17 预览：每轮都记录（即使命中为空），否则开关已开启但无命中时看起来像预览没运行。
    // 只观察、不进 prompt、不浮现、不打点；真注入时此段不触发。
    if (relPreview) {
      try { logRecallHit(opts.baseDir, opts.sessionId, 'preview', hookQuery, relevantHits); } catch (_) {}
      try { appendPreview(opts.baseDir, opts.sessionId, input.query, relevantHits); } catch (_) {}
      relevantHits = [];
    }
  }
  // 11-04 万物可召回（方案 B）：记忆池 event 之外，再按用户这条消息召回「此刻记录 / 相册批注」（lib/recall-sources.js：11-08 已确定——不限次数、每轮 1 条、同条 48h 内不重复且按会话隔离）。
  // 命中的并进 relevantHits（本轮拼进相关记忆块 + 像记忆一样浮现进时间线，id 形如 trace:xx / album:xx）；失败不影响主链路。
  if (relOn) {
    try {
      const _ri = minimalAssembleInput(opts);
      hookQuery = _ri.query || hookQuery;
      const _ex = require('../lib/recall-sources').pick({ query: _ri.query, sessionId: opts.sessionId, excludeIds: _ri.excludeIds });
      if (_ex.hits.length) {
        relevantHits = relevantHits.concat(_ex.hits);
        const _lines = _ex.hits.map(function (h) { return h.text; });
        const _rb = blocks.find(function (b) { return b && b.key === 'relevant_memories'; });
        if (_rb) _rb.content = _rb.content + '\n' + _lines.join('\n');
        else blocks.push({ key: 'relevant_memories', title: 'Possibly Relevant Memories', content: '## Possibly Relevant Memories\n' + _lines.join('\n'), empty: false });
        console.log('[ctx-v2] 万物召回命中:', _ex.hits.map(function (h) { return h.id; }).join(','));
      }
    } catch (e) { console.warn('[ctx-v2] 万物召回失败（不影响主链路）:', e && e.message); }
  }
  // 1002 第 4 项：相关记忆命中打点 → entry.last_hit_at（评估用）。
  // builder 是纯函数，副作用只在运行时做；打点失败静默，绝不影响上下文组装。
  try {
    const adm = require('../memory/memory-admission').getAdmission();
    if (adm && typeof adm.markHit === 'function' && relevantHits.length) {
      adm.markHit(relevantHits.map(function (h) { return h && h.id; }).filter(function (id) { return !/^(trace|album):/.test(String(id)); }));
    }
    // 1005-17：event 衰减（注入 +0.05 在 markHit 内；这里跑每日 -0.01 扫描，跌破 0.2 归档+进待审）
    // 1018：只在相关注入开启时衰减——注入关闭（含预览模式）时 event 永远拿不到 markHit 加分，
    // 只扣不加会把全部 event 逐步推进归档+待审。
    if (relOn && adm && typeof adm.decayEvents === 'function') {
      try { adm.decayEvents(); } catch (_) { /* 衰减失败不影响主链路 */ }
    }
  } catch (_) { /* 打点失败不影响主链路 */ }
  // 会话级跨窗口总开关（1010-26 口径）：关闭 = 本会话不注入任何跨窗口内容，只剩人设
  //（system 角色的人设 + 时间线本身）。相关记忆（relevant_memories）不受本开关控制。
  // [位置:context/context-v2-runtime.js·crossOff] [预设独立永久上下文与跨窗口解耦] [11-25：绑定了预设永久上下文且独立开关开启的会话，即使跨窗口关闭也照常保留 system_instructions；全局默认会话保持原行为] [注释时间 2026-11-25]
  if (crossOff) {
    let keepPresetPinned = false;
    try {
      const _ps = createSessionCfg(opts.baseDir).readPinnedScope(opts.sessionId);
      if (_ps && _ps.scope && _ps.scope.startsWith('preset:') && _ps.enabled !== false) keepPresetPinned = true;
    } catch (e) {}
    blocks = blocks.filter(function (b) {
      return b && (b.key === 'relevant_memories' || (keepPresetPinned && b.key === 'system_instructions'));
    });
  }
  // 11-14 命中审计：真注入（记忆池 + 万物召回）定型后落盘，读侧 routes/recall-hits.js
  if (relevantHits.length) { try { logRecallHit(opts.baseDir, opts.sessionId, 'inject', hookQuery, relevantHits); } catch (_) {} }
  return { messages: apply(opts.messages, blocks), relevantHits: relevantHits };
}

// 记忆浮现写入（S4 聊天侧实现原样搬入，0920 起两侧共用）：
// 命中的记忆原样写入时间线永久在场（hidden 前端不显示；LLM 清洗自动剥离）；
// 防重复由 builder 的 excludeIds（context_v2_floated.json）保证。
// opts: { appendMessages, sessionId, mems, baseDir }；返回写入条数。
function floatMemoriesToTimeline(opts) {
  const list = (Array.isArray(opts.mems) ? opts.mems : []).filter(m => m && m.id && String(m.text || '').trim());
  if (!list.length) return 0;
  opts.appendMessages(opts.sessionId, list.map(m => ({
    role: 'developer',
    content: strSafeEntry(m),
    float_id: m.id,
    hidden: true,
  })), { silent: true });
  shadow.appendFloatIds(path.join(opts.baseDir, 'data', 'context_v2_floated.json'), opts.sessionId, list.map(m => m.id));
  return list.length;

  function strSafeEntry(m) {
    const t = String(m.text || '').trim();
    const d = m.established_at && /^\d{4}-\d{2}-\d{2}/.test(String(m.established_at)) ? String(m.established_at).slice(0, 10) : (m.created_at && /^\d{4}-\d{2}-\d{2}/.test(String(m.created_at)) ? String(m.created_at).slice(0, 10) : null);
    return d ? t + '（' + d + '）' : t;
  }
}

// V2 总闸：memory_v2_config.json 的 ctx_v2_enabled（缺文件=false）
function enabled(baseDir) { try { return fsp.readJsonSync(path.join(baseDir, 'data', 'memory_v2_config.json')).ctx_v2_enabled === true; } catch (_) { return false; } }

// ── 相关记忆（Relevant）自动注入开关（2026-10-02 用户拍板关闭）──
// 背景（实测，见诊断报告）：184 条 active 记忆两两 bge 余弦 median 0.586 / p10 0.502，
// 而入选门槛换算只需 sem ≥0.41——门槛低于库内随机配对基线，"宁缺毋滥"在设计上不成立；
// 抽查 33 组命中约 65-70% 与当轮话题无关，且每轮硬取 3 条（1 真相关 + 2 凑数）。
// 另实测：77 条被浮现过的记忆里 75 条（97%）的信息已被 Core Identity / Long-term
// Understanding 两块总结覆盖，0 条是总结里没有的 → 自动检索属重复劳动。
// 关闭后：① 不生成 relevant_memories 块 ② 不写时间线浮现 ③ 省掉每轮一次 embed 请求。
// 兜底：模型仍可用 memory_search 工具主动检索。开关置 true 即恢复原行为。
// 缺省=true（保持向后兼容，显式 false 才关）。
function relevantEnabled(baseDir) {
  try {
    return fsp.readJsonSync(path.join(baseDir, 'data', 'memory_v2_config.json')).ctx_v2_relevant_enabled !== false;
  } catch (_) { return true; }
}

module.exports = { assembleAndApply, apply, floatMemoriesToTimeline, readStarredDialogLines, readStarredDialogEntries, formatDialogEntry, enabled, relevantEnabled, logRecallHit };
