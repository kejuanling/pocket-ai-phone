'use strict';
// 推送回显管理路由（自 server.js 拆出；依赖 basicAuth + baseDir + loadTimeline/saveTimeline）
const path = require('path');
const fsx = require('fs-extra');
const { parsePushEcho, parseWakeEcho, buildPushEcho, fmtLocalAt, pushEchoMeta, toEpoch } = require('../utils/push');

const TIMELINE_FILE = 'enhanced_messages.json';

const { safeSessionToken } = require('../lib/session-token');
const { timelineDirOf } = require('../lib/timeline-dir'); // 1018-12 // 2026-09-22 审查 §四.7：收敛手抄副本

// 时间线文件路径（走共享 safeSessionToken，与 gateway / diary / context-replacements 同口径）：
// 清洗为空 → md5 哈希文件名，避免纯中文等非法字符 sid 被错误解析到主会话时间线（读错数据/改错会话）
function timelinePathFor(baseDir, sessionId) {
  const token = safeSessionToken(sessionId);
  if (token === 'default') return path.join(timelineDirOf(baseDir), TIMELINE_FILE);
  return path.join(timelineDirOf(baseDir), `enhanced_messages_${token}.json`);
}

// 扫描所有会话时间线文件，返回 [{ sessionId, path }]
function listAllTimelines(baseDir) {
  const tlDir = timelineDirOf(baseDir);
  const files = fsx.existsSync(tlDir) ? fsx.readdirSync(tlDir) : [];
  const result = [];
  // 主会话
  if (fsx.existsSync(path.join(tlDir, TIMELINE_FILE))) {
    result.push({ sessionId: 'default', path: path.join(tlDir, TIMELINE_FILE) });
  }
  // 分会话
  for (const f of files) {
    const m = f.match(/^enhanced_messages_([A-Za-z0-9_-]+)\.json$/);
    if (m) {
      result.push({ sessionId: m[1], path: path.join(tlDir, f) });
    }
  }
  return result;
}

// [push] 标签内文 → 推送正文（对齐 wake-scheduler 发送前的清洗：剥 DIARY/wake 标签、标题/正文前缀、合行）
function pushBodyFromTag(content) {
  const m = String(content || "").match(/\[push\]([\s\S]*?)\[\/push\]/i) || String(content || "").match(/<push>([\s\S]*?)<\/push>/i);   // 2026-10-28：新写法 <push>
  if (!m) return "";
  return m[1]
    .replace(/\[DIARY\]|\[\/DIARY\]/gi, "")
    .replace(/<wake>[\s\S]*?<\/wake>/gi, "")
    .replace(/^标题[：:]\s*/gm, "")
    .replace(/^正文[：:]\s*/gm, "")
    .split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join(" ").trim();
}

// 时间线 → 推送回显条目：取未删除消息中可解析出推送元数据的（pushEchoMeta），附上所属会话。
// 10-20 晚：新格式「发送成功，时间：…」回执不带正文（body 空），正文在同刻（±5s）assistant 的
// [push]…[/push] 消息里——不补的话前端只能拿回执文本当内容显示。
function extractPushItems(timeline, sessionId) {
  if (!Array.isArray(timeline)) return [];
  const tms = function (x) { const d = x && x.time ? new Date(x.time).getTime() : NaN; return isNaN(d) ? 0 : d; };
  const asstPush = timeline.filter(function (x) { return x && !x.deleted && x.role === "assistant" && typeof x.content === "string" && /\[push\]|<push>/i.test(x.content); });
  /* [位置:routes/push-events.js·extractPushItems 去重] [新旧两种推送记录不重复] [11-11 回执删除：11-11 之前的推送同时有「成功回执」和 assistant 的 push 对象两份，
     旧的仍由回执那条代表（位置、编辑删除口径都不变）——所以 push 对象 5 秒内找得到成功回执（含已软删的，免得删过的推送借 push 对象复活）就跳过；
     找不到回执的（11-11 之后的新推送）才由 push 对象出条目] [注释时间 2026-11-11] */
  const legacySentAt = timeline.filter(function (y) { return y && y.role === "developer" && !!parsePushEcho(y.content); }).map(tms);
  const out = [];
  for (const x of timeline) {
    if (!x || x.deleted) continue;
    const meta = pushEchoMeta(x);
    if (!meta) continue;
    if (meta.source === "push") {
      const pt = tms(x);
      if (legacySentAt.some(function (t) { return Math.abs(t - pt) < 5000; })) continue;
    }
    if (meta.sent && !meta.body && !meta.structured) {
      const mt = tms(x);
      const near = asstPush.find(function (a) { return Math.abs(tms(a) - mt) < 5000; });
      if (near) meta.body = pushBodyFromTag(near.content);
    }
    out.push(Object.assign({}, meta, { session_id: sessionId }));
  }
  return out;
}

// 这条消息的推送记录是不是来自 push 对象（而不是旧的回执/回显行）——判定口径与 utils/push.js·pushEchoMeta 一致（旧结构化字段优先）。
// 注意已标 push.deleted 的也算：调用方要先挡掉，绝不能落到旧逻辑去重写 AI 的回复正文。
function isPushObjMsg(msg) {
  return !!(msg && msg.role === 'assistant' && msg.push && typeof msg.push === 'object' && !(msg.push_title || msg.push_body));
}

module.exports = function registerPushEventsRoutes(app, { basicAuth, baseDir, loadTimeline, saveTimeline }) {

  // 列出推送记录
  // - 传 session_id：只返回该会话的推送
  // - 不传 session_id：返回所有会话的推送（管理台用）
  app.get('/admin/push-events', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const rawSession = String(req.query?.session_id || '').trim();
      const sessionId = rawSession || 'default';
      const wantAll = rawSession === '' && (req.query?.all === '1' || req.query?.all === 'true');

      let items = [];
      if (wantAll || rawSession === '') {
        // 汇总所有会话
        const timelines = listAllTimelines(baseDir);
        for (const tl of timelines) {
          try {
            if (!fsx.existsSync(tl.path)) continue;
            const data = fsx.readJsonSync(tl.path);
            items = items.concat(extractPushItems(data, tl.sessionId));
          } catch (e) {
            console.warn('[push-events] 读取会话时间线失败:', tl.sessionId, e.message);
          }
        }
      } else {
        // 单会话
        const p = timelinePathFor(baseDir, sessionId);
        if (fsx.existsSync(p)) {
          const data = fsx.readJsonSync(p);
          items = extractPushItems(data, sessionId);
        }
      }

      items.sort(function (a, b) {
        const ta = toEpoch(a.at), tb = toEpoch(b.at);
        if (ta != null && tb != null) return tb - ta;
        return (b.position || 0) - (a.position || 0);
      });
      reply.send({ items: items, session_id: rawSession || 'all' });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  // 编辑推送内容（必须带 session_id）
  app.post('/admin/push-events/update', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = req.body || {};
      const sessionId = String(b.session_id || '').trim() || 'default';
      const position = Number(b.position);
      const title = String(b.title || '').trim();
      const body = String(b.body || '').trim();
      if (!body) return reply.send({ error: '内容不能为空' });
      const tlPath = timelinePathFor(baseDir, sessionId);
      if (!fsx.existsSync(tlPath)) return reply.code(404).send({ error: '时间线不存在' });
      // 2026-09-22 审查 R19：改走 gateway 的 loadTimeline/saveTimeline——原实现
      // readJsonSync → 改 → writeTimelineAtomic 整份写回，绕过 saveTimeline 四道守卫
      // （损坏 / 过期快照 / 墓碑 / __corrupt），且用固定 .tmp 名：读与写之间任何其它写入
      // （生成中回复收尾、唤醒落库）都会被整份覆盖掉。loadTimeline 带 __fp 快照指纹，
      // saveTimeline 据此拒写并发冲突，拒绝时回 409 让前端刷新重试而非静默丢数据。
      const timeline = loadTimeline(sessionId);
      if (!Array.isArray(timeline)) return reply.send({ error: '时间线不可读' });
      const idx = timeline.findIndex(function (x) { return (x.role === 'assistant' || x.role === 'developer') && x.position === position; });
      if (idx < 0) return reply.code(404).send({ error: '记录不存在' });
      const msg = timeline[idx];
      /* [位置:routes/push-events.js·update push对象] [编辑推送不动 AI 原话] [11-11：推送记录来自 assistant 消息的 push 对象时，只改 push.title/body；
         旧实现会把 content 重写成回显行——对象是 AI 的回复时那就是改她看到的 AI 原话，不行。旧回执条目照走下面的原逻辑] [注释时间 2026-11-11] */
      if (isPushObjMsg(msg)) {
        if (msg.push.deleted) return reply.code(404).send({ error: '记录不存在' });
        msg.push = Object.assign({}, msg.push, { title: title, body: body, edited_at: new Date().toISOString() });
        if (saveTimeline(timeline, sessionId) === false) {
          return reply.code(409).send({ error: '时间线已被其它写入更新（或已删除），请刷新后重试' });
        }
        return reply.send({ success: true, entry: Object.assign({}, pushEchoMeta(msg), { session_id: sessionId }), session_id: sessionId });
      }
      const meta = pushEchoMeta(msg) || {};
      msg.content = buildPushEcho({ at: meta.at || '', user: meta.user || '', channel: meta.channel || 'Bark', title: title, body: body, tail: meta.tail || '' });
      msg.push_title = title;
      msg.push_body = body;
      msg.push_tail = meta.tail || '';
      msg.updated_at = new Date().toISOString();
      if (saveTimeline(timeline, sessionId) === false) {
        return reply.code(409).send({ error: '时间线已被其它写入更新（或已删除），请刷新后重试' });
      }
      reply.send({ success: true, entry: Object.assign({}, pushEchoMeta(msg), { session_id: sessionId }), session_id: sessionId });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  // 删除推送（软删除，必须带 session_id）
  app.post('/admin/push-events/delete', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = req.body || {};
      const sessionId = String(b.session_id || '').trim() || 'default';
      const position = Number(b.position);
      const tlPath = timelinePathFor(baseDir, sessionId);
      if (!fsx.existsSync(tlPath)) return reply.code(404).send({ error: '时间线不存在' });
      // 2026-09-22 审查 R19：同 update 路由，改走 loadTimeline/saveTimeline（守卫 + 快照指纹）
      const timeline = loadTimeline(sessionId);
      if (!Array.isArray(timeline)) return reply.send({ error: '时间线不可读' });
      const idx = timeline.findIndex(function (x) { return (x.role === 'assistant' || x.role === 'developer') && x.position === position; });
      if (idx < 0) return reply.code(404).send({ error: '记录不存在' });
      const msg = timeline[idx];
      /* [位置:routes/push-events.js·delete push对象] [删推送记录不删 AI 的回复] [11-11：同上，push 对象的条目只标 push.deleted（推送管理不再列出），AI 那条回复留在聊天里] [注释时间 2026-11-11] */
      if (isPushObjMsg(msg)) {
        msg.push = Object.assign({}, msg.push, { deleted: true, deleted_at: new Date().toISOString() });
      } else {
        msg.deleted = true;
        msg.deleted_at = new Date().toISOString();
      }
      if (saveTimeline(timeline, sessionId) === false) {
        return reply.code(409).send({ error: '时间线已被其它写入更新（或已删除），请刷新后重试' });
      }
      reply.send({ success: true, session_id: sessionId });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });
};
// 单测入口（tests/unit/wake_receipt_fail_only.test.js）
module.exports.extractPushItems = extractPushItems;
