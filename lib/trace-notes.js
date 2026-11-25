/* [位置:lib/trace-notes.js] [此刻记录库：AI 每写一条 <trace>，整句内容存一条，带当时的 msg_id] [11-07：不再拆气味名/想要/选了/忍住字段，也不再有 lock 私密通道——整句直接存（同相册批注的待遇），检索由 lib/recall-sources.js 对整句切词命中，召回文案带 msg_id，AI 拿 id 可用 context 工具回看那条原文] [注释时间 2026-11-07] */
"use strict";
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "..", "data", "trace_notes.json");

function readAll() {
  try { const a = JSON.parse(fs.readFileSync(FILE, "utf8")); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function writeAll(items) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(items));
  fs.renameSync(tmp, FILE);
}

/* [位置:lib/trace-notes.js·sameMsgInSession] [msg_id 匹配的会话维度] [11-10：会话分支会原样复制时间线，同一个 msg_id 会同时存在父会话和分支会话里——只按 msg_id 匹配，编辑分支里那条会把父会话的记录改掉/删掉。匹配规则：msg_id 相同，且两边 session_id 相同或任一边为空（空=旧数据/迁移前数据，按旧口径照样匹配）] [注释时间 2026-11-10] */
function normSessionId(v) {
  return (v == null) ? "" : String(v);
}
function sameMsgInSession(x, msgId, sessionId) {
  if (!x || x.msg_id !== msgId) return false;
  const a = normSessionId(x.session_id);
  const b = normSessionId(sessionId);
  return !a || !b || a === b;
}

/* entry = {content, session_id, msg_id, at}；content 为空不入库。按 msg_id + 会话幂等：同一消息重复落盘/迁移重跑不产生重复条目 */
function add(entry) {
  const content = String((entry && entry.content) || "").replace(/\s+/g, " ").trim();
  if (!content) return null;
  const msgId = (entry && entry.msg_id) || null;
  const items = readAll();
  if (msgId && items.some((x) => sameMsgInSession(x, msgId, (entry && entry.session_id) || null))) return null;
  const it = {
    id: "tn_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    content: content.slice(0, 600),
    session_id: (entry && entry.session_id) || null,
    msg_id: msgId,
    at: (entry && entry.at) || new Date().toISOString(),
  };
  items.unshift(it);
  writeAll(items);
  return it;
}
function list() { return readAll(); }
function remove(id) { const items = readAll(); const next = items.filter((x) => x.id !== id); if (next.length !== items.length) writeAll(next); return items.length - next.length; }

/* [位置:lib/trace-notes.js·upsertByMsgId/removeByMsgId] [编辑消息后的同步] [11-08：编辑窗保存走 routes/chat.js patch（不经 appendMessages 钩子），正文里的 <trace> 改了/删了要同步到这条库——upsert=同 msg_id 更新内容（没有则新增），remove=删掉该 msg_id 的记录；痕迹页与召回即时跟着编辑走] [11-10 加会话维度：msg_id 会因分支复制而跨会话重复，remove 第二个参数传 sessionId（不传=旧口径，按 msg_id 全删）] [注释时间 2026-11-08] */
function upsertByMsgId(entry) {
  const msgId = (entry && entry.msg_id) || null;
  const content = String((entry && entry.content) || "").replace(/\s+/g, " ").trim();
  if (!msgId || !content) return null;
  const sessionId = (entry && entry.session_id) || null;
  const items = readAll();
  const old = items.find((x) => sameMsgInSession(x, msgId, sessionId));
  if (old) {
    old.content = content.slice(0, 600);
    old.at = (entry && entry.at) || old.at;
    if (!old.session_id && sessionId) old.session_id = sessionId;   // 旧数据没记会话 → 顺手补上，下次匹配就精确了
    writeAll(items);
    return old;
  }
  return add(entry);
}
function removeByMsgId(msgId, sessionId) {
  const mid = String(msgId || "");
  if (!mid) return 0;
  const items = readAll();
  const next = items.filter((x) => !sameMsgInSession(x, mid, sessionId));
  if (next.length !== items.length) writeAll(next);
  return items.length - next.length;
}

module.exports = { add, list, remove, upsertByMsgId, removeByMsgId, FILE };
