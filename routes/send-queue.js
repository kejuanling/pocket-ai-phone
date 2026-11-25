"use strict";
/* [位置:routes/send-queue.js] [发送排队接口] [11-04：只对「允许发送排队」的会话组（chat-settings.cfg.session_groups[].queue===true，现在是「干活的」）里的会话开放；且必须有一轮正在进行的回复才收（没在回就该走正常发送）。鉴权走 /v1 全局 API Key。] [注释时间 2026-11-04] */
const fs = require("fs");
const path = require("path");
const sq = require("../lib/send-queue");

let _cache = { mtime: -1, set: new Set() };
function queueSids(baseDir) {
  const file = path.join(baseDir, "config", "chat-settings.json");
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs === _cache.mtime) return _cache.set;
    const cfg = (JSON.parse(fs.readFileSync(file, "utf-8")) || {}).cfg || {};
    const set = new Set();
    (Array.isArray(cfg.session_groups) ? cfg.session_groups : []).forEach((g) => {
      if (g && g.queue === true && Array.isArray(g.sids)) g.sids.forEach((s) => { if (typeof s === "string" && s) set.add(s); });
    });
    _cache = { mtime: st.mtimeMs, set };
    return set;
  } catch (e) { return _cache.set; }
}
function validSid(v) { const s = String(v || "").trim(); return s && s.replace(/[^A-Za-z0-9_-]/g, "") === s ? s : ""; }

module.exports = function registerSendQueue(app, ctx) {
  const baseDir = (ctx && ctx.baseDir) || path.join(__dirname, "..");
  const activeGenMap = ctx && ctx.activeGenMap;
  const enabled = (sid) => queueSids(baseDir).has(sid);

  app.get("/v1/chat/queue", async (req, reply) => {
    const sid = validSid(req.query && req.query.session_id);
    if (!sid) return reply.code(400).send({ error: "缺 session_id" });
    reply.send(Object.assign({ enabled: enabled(sid) }, sq.status(sid)));
  });
  app.post("/v1/chat/queue", async (req, reply) => {
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const sid = validSid(b.session_id);
    if (!sid) return reply.code(400).send({ error: "缺 session_id" });
    if (!enabled(sid)) return reply.code(403).send({ error: "这个会话所在的组没开「发送排队」" });
    const g = activeGenMap && activeGenMap.get(sid);
    if (!g || g.done) return reply.code(409).send({ error: "他现在没在回复，直接发就行" });
    const r = sq.enqueue(sid, { id: b.id, text: b.text });
    if (!r.ok) return reply.code(400).send({ error: r.error });
    reply.send(r);
  });
  app.post("/v1/chat/queue/cancel", async (req, reply) => {
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const sid = validSid(b.session_id);
    if (!sid) return reply.code(400).send({ error: "缺 session_id" });
    reply.send({ ok: true, removed: sq.cancel(sid, String(b.id || "")) });
  });
  app.post("/v1/chat/queue/flush", async (req, reply) => {
    const b = (req.body && typeof req.body === "object") ? req.body : {};
    const sid = validSid(b.session_id);
    if (!sid) return reply.code(400).send({ error: "缺 session_id" });
    reply.send({ ok: true, items: sq.flush(sid) });
  });
};
