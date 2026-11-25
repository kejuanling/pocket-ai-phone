"use strict";
/* [位置:lib/send-queue.js] [发送排队：干活的会话回复/做事期间，用户中途发的话] [11-04：干活会话一轮能跑很久，中途想提醒一句只能干等。现在回复期间能「排队发送」：消息进这里，工具循环在下一次请求上游之前把它们作为 user 消息插进去（pullInjected）；这一轮没走到下一次请求（回复已结束）的，由前端在结束时取回 flush 再正常发出。
   存放：纯内存（网关重启即丢——回复本来就跟着没了）。pending=还没被取走；taken=已被工具循环取走、等本轮落盘时写进时间线（排在用户本轮消息之后、AI 回复之前）；takenIds=最近取走的 id，前端轮询用。] [注释时间 2026-11-04] */
const Q = new Map();
const MAX_PENDING = 10;
const MAX_TEXT = 20000;
const TAKEN_KEEP_MS = 10 * 60 * 1000;

function slot(sid) {
  let s = Q.get(sid);
  if (!s) { s = { pending: [], taken: [], takenIds: new Map() }; Q.set(sid, s); }
  return s;
}
function gc(s) { const now = Date.now(); for (const [id, ts] of s.takenIds) if (now - ts > TAKEN_KEEP_MS) s.takenIds.delete(id); }

function enqueue(sid, item) {
  const s = slot(sid);
  if (s.pending.length >= MAX_PENDING) return { ok: false, error: "排队的消息太多了（最多 " + MAX_PENDING + " 条），等他取走几条再发" };
  const text = String(item && item.text || "");
  if (!text.trim()) return { ok: false, error: "消息是空的" };
  if (text.length > MAX_TEXT) return { ok: false, error: "消息太长了（排队的单条最多 " + MAX_TEXT + " 字）" };
  const id = String(item && item.id || "").slice(0, 64) || ("q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  if (s.pending.some((x) => x.id === id) || s.taken.some((x) => x.id === id)) return { ok: true, id, dup: true, pending: s.pending.length };
  s.pending.push({ id, text, time: new Date().toISOString() });
  return { ok: true, id, pending: s.pending.length };
}
// 工具循环取走：全部 pending → taken，返回给调用方插进对话
function take(sid) {
  const s = Q.get(sid);
  if (!s || !s.pending.length) return [];
  const got = s.pending.splice(0, s.pending.length);
  got.forEach((x) => { s.taken.push(x); s.takenIds.set(x.id, Date.now()); });
  return got;
}
// 本轮落盘时取走「已被取走」的，返回并清空
function drainTaken(sid) {
  const s = Q.get(sid);
  if (!s || !s.taken.length) return [];
  return s.taken.splice(0, s.taken.length);
}
function cancel(sid, id) {
  const s = Q.get(sid);
  if (!s) return false;
  const i = s.pending.findIndex((x) => x.id === id);
  if (i < 0) return false;
  s.pending.splice(i, 1);
  return true;
}
// 回复结束后，前端取回没被取走的（返回并清空）
function flush(sid) {
  const s = Q.get(sid);
  if (!s) return [];
  return s.pending.splice(0, s.pending.length);
}
function status(sid) {
  const s = Q.get(sid);
  if (!s) return { pending: [], taken: [] };
  gc(s);
  return { pending: s.pending.map((x) => ({ id: x.id })), taken: Array.from(s.takenIds.keys()) };
}
module.exports = { enqueue, take, drainTaken, cancel, flush, status, MAX_PENDING, MAX_TEXT };
