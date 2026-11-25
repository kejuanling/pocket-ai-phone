'use strict';
// 小手机「AI 在做什么」卡只读数据源（10-20 第十七轮，需求 149/151）。
// 唤醒结果：每次唤醒做了什么——没动作的原因 / 日记 id / 推送判定。
//   2026-11-11 起回执只报失败（lib/wake-scheduler.js·buildWakeReceipt），这些信息改从唤醒那一轮的 assistant 消息里取
//   （kind=noaction 的原因、kind=diary、push 对象）；11-11 之前的旧回执（developer 层）照旧解析，两边按「唤醒轮」合成一条。
//   唤醒日志里只有判定没有原因，前端原来想直接读 timeline 文件，但该目录不走公网（SPA 兜底），故出此接口。
// 工具调用：assistant.tools（聊天与唤醒都会落时间线），只出工具名 + 时间 + 一句话摘要；
//   参数正文与结果一律不出网（里面有日记全文、手机 App 记录等私密内容）。
const path = require('path');
const fsx = require('fs-extra');
const { timelineDirOf } = require('./timeline-dir');

const RECEIPT_KEYS = ['日记写入成功', '未发送推送', '本次未推送', '发送成功', '发送失败'];

function listAllTimelines(baseDir) {
  const tlDir = timelineDirOf(baseDir);
  const files = fsx.existsSync(tlDir) ? fsx.readdirSync(tlDir) : [];
  const result = [];
  if (fsx.existsSync(path.join(tlDir, 'enhanced_messages.json'))) result.push({ sessionId: 'default', path: path.join(tlDir, 'enhanced_messages.json') });
  for (const f of files) {
    const m = f.match(/^enhanced_messages_([A-Za-z0-9_-]+)\.json$/);
    if (m) result.push({ sessionId: m[1], path: path.join(tlDir, f) });
  }
  return result;
}

// 解析一条系统回执 → { noaction, diary, diaryId, pushS, pushU, pushNo }；不是回执返回 null
function parseReceipt(content) {
  const c = String(content || '');
  if (!RECEIPT_KEYS.some(k => c.includes(k))) return null;
  let m;
  const r = { noaction: '', diary: false, diaryId: '', pushS: '', pushU: '', pushNo: false };
  if ((m = c.match(/未发送推送[：:]\s*([^\n。]+)/))) r.noaction = m[1].trim();
  if ((m = c.match(/日记写入成功，id：(\d+)/))) { r.diary = true; r.diaryId = m[1]; }
  if ((m = c.match(/发送成功，时间：([\d\-]+ [\d:]+)/))) r.pushS = m[1];
  else if ((m = c.match(/发送失败：([^\n。]+)/))) r.pushU = m[1].trim();
  else if (/本次未推送/.test(c)) r.pushNo = true;
  if (!r.noaction && !r.diary && !r.pushS && !r.pushU && !r.pushNo) return null;
  return r;
}

/* [位置:lib/phone-activity.js·noActionReasonOf] [NO_ACTION 原因完整提取] [11-11 上午自 lib/wake-scheduler.js 原样搬来：回执不再带原因后，唯一用户是首页活动卡。
   多行合并成一行（换行 → 空格）、连续空格压成一个；NO_ACTION_REASON_MAX=300 只防模型失常整篇输出（超过才在末尾加「…」）。
   aiText 是旧写法文本（以「[NO_ACTION]」开头）；rawText 是原文，有 <noaction> 标签时优先取标签内内容（标签外的旁白/其它标签不算原因）] [注释时间 2026-11-11] */
const NO_ACTION_REASON_MAX = 300;
function noActionReasonOf(aiText, rawText) {
  let body = null;
  const raw = String(rawText || "");
  if (raw) {
    const m = raw.match(/<\s*noaction\b[^>]*>([\s\S]*?)<\s*\/noaction\s*>/i);
    if (m) body = m[1];
  }
  if (body === null) body = String(aiText || "").replace(/^\[NO_ACTION\]\s*/, "");
  const s = body
    .replace(/\r/g, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return s.length > NO_ACTION_REASON_MAX ? s.slice(0, NO_ACTION_REASON_MAX) + "…" : s;
}

// 活动卡标题上的那一小句原因：取到第一个句号为止（与此前从回执里抠的口径一致，卡片长度不变）
function noActionBrief(content) {
  const c = String(content || '');
  const i = c.indexOf('[NO_ACTION]');
  const full = noActionReasonOf(i >= 0 ? c.slice(i) : '', c).replace(/^原因[：:]\s*/, '');
  const m = full.match(/[^\n。]+/);
  return m ? m[0].trim() : '';
}

/* [位置:lib/phone-activity.js·receiptsOfTimeline] [按唤醒轮汇总结果] [11-11 回执删除：一轮 = developer 唤醒块（「这是一次系统唤醒」开头）到下一条 user 之前。
   轮内 assistant 消息派生：kind=noaction → 原因；kind=diary → 写了日记；push 对象 → 推送时间；轮内的旧回执（11-11 前）并进同一条，缺的字段由回执补。
   时间取轮内最后一条产出的时间（前端按「唤醒完成时刻 ±90 秒」对号）；什么信息都没有的轮不出条目。不在任何轮里的旧回执单独成条（兼容更早的数据）] [注释时间 2026-11-11] */
const WAKE_BLOCK_RE = /^\s*这是一次系统唤醒/;
/* [位置:lib/phone-activity.js·contentHasNoaction] [正文里有没有静默标记] [代码块/反引号/表格里的讲解字样不算，跟 tag-actions·speakIsNoaction 同一套掩码] [注释时间 2026-11-19] */
function contentHasNoaction(c) {
  const s = String(c || '');
  if (!/<\s*noaction\b|\[NO_ACTION\]/i.test(s)) return false;
  try { return /<\s*noaction\b|\[NO_ACTION\]/i.test(require('../workspace/phone-tags').mask(s).text); }
  catch (e) { return true; }
}
function receiptsOfTimeline(data, sessionId) {
  const out = [];
  let cur = null;
  const flush = function () {
    if (cur && (cur.noaction || cur.diary || cur.pushS || cur.pushU || cur.pushNo)) out.push(cur);
    cur = null;
  };
  for (const x of data) {
    if (!x || x.deleted) continue;
    const c = typeof x.content === 'string' ? x.content : '';
    if (x.role === 'user') { flush(); continue; }
    if (x.role === 'developer') {
      if (WAKE_BLOCK_RE.test(c)) {
        flush();
        cur = { time: x.time || '', session: sessionId, noaction: '', diary: false, diaryId: '', pushS: '', pushU: '', pushNo: false };
        continue;
      }
      const r = parseReceipt(c);
      if (!r) continue;
      if (!cur) { out.push(Object.assign({ time: x.time || '', session: sessionId }, r)); continue; }
      cur.time = x.time || cur.time;
      cur.noaction = cur.noaction || r.noaction;
      if (r.diary) { cur.diary = true; cur.diaryId = cur.diaryId || r.diaryId; }
      cur.pushS = cur.pushS || r.pushS;
      cur.pushU = cur.pushU || r.pushU;
      cur.pushNo = cur.pushNo || r.pushNo;
      continue;
    }
    if (x.role !== 'assistant' || !cur) continue;
    cur.time = x.time || cur.time;
    if (x.kind === 'diary') { cur.diary = true; if (x.diary_id != null && !cur.diaryId) cur.diaryId = String(x.diary_id); continue; }
    /* [位置:lib/phone-activity.js·receiptsOfTimeline] [没打 kind 也认静默原因] [2026-11-19：旧唤醒先写 <trace> 再写 <noaction>，kind 空，活动卡丢了原因。标签或 [NO_ACTION] 在正文里（代码块里的不算）同样取原因；新落库的 kind 照旧] [注释时间 2026-11-19] */
    if (x.kind === 'noaction' || contentHasNoaction(c)) { const why = noActionBrief(c); if (why) cur.noaction = why; }
    if (x.push && typeof x.push === 'object' && x.push.at && !x.push.deleted) cur.pushS = String(x.push.at);
  }
  flush();
  return out;
}

// 最近 N 条唤醒结果（跨全部会话，按时间倒序）
function wakeReceipts(baseDir, limit) {
  limit = Math.min(limit || 20, 50);
  const out = [];
  for (const tl of listAllTimelines(baseDir)) {
    try {
      const st = fsx.statSync(tl.path);
      if (st.size > 8 * 1024 * 1024) continue; // 病态大文件跳过，防拖垮请求
      const data = fsx.readJsonSync(tl.path);
      if (!Array.isArray(data)) continue;
      for (const it of receiptsOfTimeline(data, tl.sessionId)) out.push(it);
    } catch (e) { /* 单文件坏不影响整体 */ }
  }
  out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return out.slice(0, limit);
}

// 工具摘要字段白名单：只挑短关键词类入参，绝不回传 args/result 原文
const HINT_FIELDS = ['query', 'q', 'keyword', 'search', 'content', 'text', 'name', 'title', 'action', 'date', 'kind'];
function hintOf(args) {
  if (!args || typeof args !== 'object') return '';
  for (const k of HINT_FIELDS) {
    const v = args[k];
    if (typeof v === 'string' && v.trim() && v.trim().length <= 20) return v.trim();
  }
  const keys = Object.keys(args);
  const nums = keys.filter(k => typeof args[k] === 'number' || typeof args[k] === 'boolean');
  if (keys.length && nums.length === keys.length) return keys.map(k => k + ' ' + args[k]).join(' ').slice(0, 20);
  return '';
}

// 最近 N 次工具调用（跨全部会话，按时间倒序、同一次调用去重）
function recentTools(baseDir, limit) {
  limit = Math.min(limit || 30, 60);
  const out = [];
  for (const tl of listAllTimelines(baseDir)) {
    try {
      const st = fsx.statSync(tl.path);
      if (st.size > 8 * 1024 * 1024) continue; // 病态大文件跳过，防拖垮请求
      const data = fsx.readJsonSync(tl.path);
      if (!Array.isArray(data)) continue;
      for (let i = data.length - 1; i >= 0; i--) {
        const x = data[i];
        if (!x || x.deleted || !Array.isArray(x.tools) || !x.tools.length) continue;
        const mt = x.time ? new Date(x.time).getTime() : 0;
        for (const t of x.tools) {
          if (!t || !t.name) continue;
          const tt = t.time ? new Date(t.time).getTime() : mt;
          out.push({ name: t.name, time: tt ? new Date(tt).toISOString() : String(x.time || ''), hint: hintOf(t.args), session: tl.sessionId });
        }
      }
    } catch (e) { /* 单文件坏不影响整体 */ }
  }
  out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const seen = {}; const uniq = [];
  for (const o of out) { const k = o.session + '|' + o.time + '|' + o.name + '|' + o.hint; if (seen[k]) continue; seen[k] = 1; uniq.push(o); }
  return uniq.slice(0, limit);
}

module.exports = { parseReceipt, hintOf, wakeReceipts, receiptsOfTimeline, noActionReasonOf, recentTools, listAllTimelines };
