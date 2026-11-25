'use strict';
/* [位置:routes/trace-notes.js·文件头] [痕迹页接口：小手机「痕迹」app（桌面第三页游戏胶囊位）读 trace_notes] [11-07：列表带切分关键词（grams，与召回同一套切词）和同款召回文案；msg_id 的上下文窗口口径对齐 routes/chat.js /internal/messages 的 buildForSession（真实消息 ±ctx、邻居截 500 字、命中条 6000、总量超 60 从最旧邻居丢）——页面是人看的，不做全库定位与推送回显展开，sid 必填] [注释时间 2026-11-07] */
const recallSources = require("../lib/recall-sources");
const traceNotes = require("../lib/trace-notes");

/* [位置:routes/trace-notes.js·decorate] [单条 trace 装饰：关键词（长词在前，同长按出现位置）+ 召回文案（lib/recall-sources 唯一公式，不复制）] [纯函数便于单测] [注释时间 2026-11-07] */
function decorate(it) {
  const c80 = String((it && it.content) || "").slice(0, 80);
  const gs = Array.from(recallSources.grams(c80));
  const grams = gs
    .map((g, i) => [g, i])
    .sort((a, b) => b[0].length - a[0].length || a[1] - b[1])
    .map((x) => x[0]);
  return {
    id: it.id, content: it.content, at: it.at || null, msg_id: it.msg_id || null, session_id: it.session_id || null,
    grams, recall: recallSources.traceRecallText(it),
  };
}

/* [位置:routes/trace-notes.js·listAll] [全量列表，新的在前] [注释时间 2026-11-07] */
function listAll() {
  return traceNotes.list()
    .slice()
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .map(decorate);
}

/* [位置:routes/trace-notes.js·buildContext] [msg_id / at 的上下文窗口] [sid 必填（页面知道 session_id；归档会话也查得到）；可见对话只算真实消息（isRealMessageForTimeline，developer/tool/diary/删除不出现）；±ctx 条、重叠合并、总量超 60 从最旧邻居开始丢（命中条永不丢）] [11-14 命中页（routes/recall-hits.js）：新增 at=时间锚定——msg_id 缺省时锚到「时间 ≤ at 的最后一条真实消息」（没有更早的则锚第一条），命中钩子记录/预览记录没有触发消息的 msg_id，按命中时刻回窗口；msg_id 路径行为不变] [纯函数便于单测] [注释时间 2026-11-07，11-14 加 at 锚定] */
function buildContext(deps, sid, msgId, ctx, atIso) {
  const tl = deps.loadTimeline(sid) || [];
  const want = String(msgId || "");
  const hitIdx = [];
  if (want) tl.forEach((m, i) => { if (m && m.id != null && !m.deleted && String(m.id) === want) hitIdx.push(i); });
  const visibleIdx = [];
  const visiblePos = new Map();
  tl.forEach((m, i) => {
    if (!m || m.deleted) return;
    if (m.role === "developer" || m.role === "tool" || m.kind === "diary") return;
    if (!deps.isRealMessageForTimeline(m)) return;
    visiblePos.set(i, visibleIdx.length);
    visibleIdx.push(i);
  });
  if (want) {
    if (!hitIdx.length) return { ok: false, error: "这个会话里没有这条 msg_id", missing: [want] };
  } else if (atIso) {
    const atMs = Date.parse(atIso);
    if (!Number.isFinite(atMs)) return { ok: false, error: "at 不是有效时间" };
    let bestVi = -1, bestT = -Infinity;
    for (const vi of visibleIdx) {
      const t = Date.parse((tl[vi] && tl[vi].time) || "");
      if (Number.isFinite(t) && t <= atMs && t >= bestT) { bestT = t; bestVi = vi; }
    }
    if (bestVi < 0) bestVi = visibleIdx.length ? visibleIdx[0] : -1;   // 没有更早的：锚到第一条可见消息
    if (bestVi < 0) return { ok: false, error: "这个会话里没有可锚定的消息" };
    hitIdx.push(bestVi);
  } else {
    return { ok: false, error: "msg_id 与 at 至少一个" };
  }
  const include = new Set(hitIdx);
  for (const ti of hitIdx) {
    const vp = visiblePos.get(ti);
    if (vp === undefined) continue;
    for (let k = 1; k <= ctx; k++) {
      if (vp - k >= 0) include.add(visibleIdx[vp - k]);
      if (vp + k < visibleIdx.length) include.add(visibleIdx[vp + k]);
    }
  }
  let list = Array.from(include).sort((a, b) => a - b);
  if (list.length > 60) {
    let dropped = 0;
    for (const ti of list) {
      if (list.length - dropped <= 60) break;
      if (hitIdx.includes(ti)) continue;
      include.delete(ti); dropped++;
    }
    list = Array.from(include).sort((a, b) => a - b);
  }
  const messages = list.map((ti) => {
    const m = tl[ti];
    const hit = hitIdx.includes(ti);
    let text = deps.normalizeContentToText(m.content) || "";
    const cap = hit ? 6000 : 500;
    if (text.length > cap) text = text.slice(0, cap) + (hit ? "…（后文截断）" : "…（邻居截断）");
    return { msg_id: String(m.id), role: m.role, time: m.time || "", text, hit };
  });
  return { ok: true, total: messages.length, window: ctx, messages };
}

function factory(app, deps) {
  deps = deps || {};
  app.get("/v1/trace-notes", async (req, reply) => {
    try { reply.send({ ok: true, items: listAll() }); }
    catch (e) { reply.code(500).send({ ok: false, error: e.message }); }
  });
  app.get("/v1/trace-context", async (req, reply) => {
    try {
      const q = req.query || {};
      const sid = String(q.sid || "").replace(/[^A-Za-z0-9_-]/g, "");
      const msgId = String(q.msg_id || "").trim();
      const at = String(q.at || "").trim();
      if (!sid || (!msgId && !at)) return reply.code(400).send({ ok: false, error: "sid 必填，msg_id 与 at 至少一个" });
      let ctx = parseInt(String(q.ctx || "6"), 10);
      if (!Number.isFinite(ctx) || ctx <= 0) ctx = 6;
      ctx = Math.min(ctx, 30);
      const r = buildContext(deps, sid, msgId, ctx, at);
      if (!r.ok) return reply.code(404).send(r);
      reply.send(r);
    } catch (e) { reply.code(500).send({ ok: false, error: e.message }); }
  });
}
factory.listAll = listAll;
factory.buildContext = buildContext;
module.exports = factory;
