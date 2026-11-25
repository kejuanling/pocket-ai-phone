'use strict';
// routes/memory-summary-tools.js —— 记忆相关的两组小接口：
//   ①相关记忆注入：GET/POST /admin/memory-v2/relevant-config、GET /admin/memory-v2/relevant-preview（读写 data/memory_v2_config.json、data/relevant_preview.json）
//   ②两块总结版本存档：GET/POST/DELETE /admin/memory-summary/history、POST /admin/memory-summary/use-version（读写 data/memory_summary_history.json、memory_summary_cache.json）
// 2026-11-03 从 server.js 拆出（server.js 拆分批 4b；原位置 4364-4470 行，共 7 条路由，逻辑一字未改：__dirname→deps.baseDir）。
// 注意：server.js 的 fs 是 fs-extra（relevant-config 用到 readJson/writeJson），这里也 require('fs-extra')。
// 只在本块用的 _SUMMARY_HIST_FILE/_readSummaryHistory/_writeSummaryHistory 一并搬来。依赖注入：basicAuth、baseDir。
const fs = require('fs-extra');
const path = require('path');

module.exports = function (app, deps) {
const { basicAuth, baseDir } = deps;

// ===== 1005-17 相关记忆注入：参数配置 + 注入预览 =====
app.get("/admin/memory-v2/relevant-config", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const p = path.join(baseDir, 'data', 'memory_v2_config.json');
    const c = await fs.readJson(p).catch(() => ({}));
    reply.send({ ctx_v2_relevant_enabled: c.ctx_v2_relevant_enabled === true, relevant: c.relevant || {} });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-v2/relevant-config", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const p = path.join(baseDir, 'data', 'memory_v2_config.json');
    const c = await fs.readJson(p).catch(() => ({}));
    const b = req.body || {};
    const oldRel = c.relevant || {};
    const rel = {
      preview: b.preview !== undefined ? !!b.preview : oldRel.preview,
      wordWeight: b.wordWeight !== undefined ? Number(b.wordWeight) : oldRel.wordWeight,
      semWeight: b.semWeight !== undefined ? Number(b.semWeight) : oldRel.semWeight,
      minHybridScore: b.minHybridScore !== undefined ? Number(b.minHybridScore) : oldRel.minHybridScore,
      topK: b.topK !== undefined ? Number(b.topK) : oldRel.topK,
    };
    const next = Object.assign({}, c, {
      ctx_v2_relevant_enabled: b.enabled !== undefined ? !!b.enabled : (c.ctx_v2_relevant_enabled === true),
      relevant: rel,
    });
    await fs.writeJson(p, next, { spaces: 2 });
    reply.send({ ok: true, ctx_v2_relevant_enabled: next.ctx_v2_relevant_enabled, relevant: rel });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/memory-v2/relevant-preview", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const p = path.join(baseDir, 'data', 'relevant_preview.json');
    const arr = await fs.readJson(p).catch(() => []);
    reply.send({ items: Array.isArray(arr) ? arr : [] });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
// 1009-11 两块总结版本存档 CRUD（Core Identity / Long-term Understanding 的历史生成内容）
const _SUMMARY_HIST_FILE = path.join(baseDir, "data", "memory_summary_history.json");
function _readSummaryHistory() {
  try { const j = JSON.parse(fs.readFileSync(_SUMMARY_HIST_FILE, "utf8")); return (j && typeof j === "object") ? j : {}; } catch (e) { return {}; }
}
function _writeSummaryHistory(h) {
  try { fs.writeFileSync(_SUMMARY_HIST_FILE, JSON.stringify(h, null, 2), "utf8"); } catch (e) { console.error("[memory-summary/history] 写存档失败:", e.message); }
}
app.get("/admin/memory-summary/history", { preHandler: basicAuth }, async (req, reply) => {
  const h = _readSummaryHistory();
  // 11-12：标出生效版——拿缓存正文和历史逐版比对，text 一致的那版就是生效。
  // cache 里的 selected_history_version 是「用这版」写入的，流水线重新生成后不更新，是陈旧值不可信（实测停在 5，正文已是 v7）。
  // 正文对不上（历史裁剪 shift 掉 / 缓存异常）回 null，前端不标，退化为原样。
  const cacheFile = path.join(baseDir, "data", "memory_summary_cache.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch (e) { cache = {}; }
  const current = {};
  for (const key of ["core_identity", "understanding"]) {
    const text = (cache && cache[key] && typeof cache[key].text === "string") ? cache[key].text : "";
    const hit = text ? (h[key] || []).find(e => e.text === text) : null;
    current[key] = hit ? Number(hit.version) : null;
  }
  reply.send({ core_identity: h.core_identity || [], understanding: h.understanding || [], current });
});
// 将指定历史版本设为当前总结缓存：只替换 cache 的 text/lines，不碰快照文件、fingerprint 或 snapshot。
// 已有会话继续使用冻结快照；新建会话才会从当前缓存读取该版本。
app.post("/admin/memory-summary/use-version", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const b = req.body || {};
    const key = String(b.block || "").trim();
    if (key !== "core_identity" && key !== "understanding") return reply.code(400).send({ error: "block 需为 core_identity 或 understanding" });
    const ver = Number(b.version);
    if (!Number.isInteger(ver) || ver < 1) return reply.code(400).send({ error: "version 需为正整数" });
    const h = _readSummaryHistory();
    const hit = (h[key] || []).find(e => Number(e.version) === ver);
    if (!hit || !String(hit.text || "").trim()) return reply.code(404).send({ error: "版本不存在或正文为空：v" + ver });
    const cacheFile = path.join(baseDir, "data", "memory_summary_cache.json");
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch (_) { /* client/stream cleanup */ }
    const prev = (cache && cache[key] && typeof cache[key] === "object") ? cache[key] : {};
    const text = String(hit.text);
    cache[key] = Object.assign({}, prev, {
      text,
      lines: text.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      selected_history_version: ver,
      selected_history_at: new Date().toISOString(),
    });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
    reply.send({ ok: true, block: key, version: ver, chars: text.length, snapshot_changed: false });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/memory-summary/history", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const key = String(b.block || "").trim();
  if (key !== "core_identity" && key !== "understanding") return reply.code(400).send({ error: "block 需为 core_identity 或 understanding" });
  const ver = Number(b.version);
  if (!Number.isInteger(ver) || ver < 1) return reply.code(400).send({ error: "version 需为正整数" });
  const text = String(b.text || "").trim();
  if (!text) return reply.code(400).send({ error: "text 不能为空" });
  const h = _readSummaryHistory();
  const arr = h[key] || [];
  const hit = arr.find(e => Number(e.version) === ver);
  if (!hit) return reply.code(404).send({ error: "版本不存在：v" + ver });
  const oldText = String(hit.text);
  hit.text = text;
  hit.edited_at = new Date().toISOString();
  h[key] = arr;
  _writeSummaryHistory(h);
  // 11-12：改的若是生效版（缓存正文与旧 text 比对一致），缓存 text/lines 同步刷——不然按正文比对判生效会断，新会话还读旧文。旧会话仍用冻结快照，不受影响
  const cacheFile = path.join(baseDir, "data", "memory_summary_cache.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch (e) { cache = {}; }
  let synced = false;
  if (cache[key] && typeof cache[key].text === "string" && cache[key].text === oldText) {
    cache[key].text = text;
    cache[key].lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf8");
    synced = true;
  }
  reply.send({ ok: true, block: key, version: ver, edited_at: hit.edited_at, cache_synced: synced });
});
app.delete("/admin/memory-summary/history", { preHandler: basicAuth }, async (req, reply) => {
  const key = String((req.query || {}).block || "").trim();
  if (key !== "core_identity" && key !== "understanding") return reply.code(400).send({ error: "block 需为 core_identity 或 understanding" });
  const ver = Number((req.query || {}).version);
  if (!Number.isInteger(ver) || ver < 1) return reply.code(400).send({ error: "version 需为正整数" });
  const h = _readSummaryHistory();
  const arr = (h[key] || []).filter(e => Number(e.version) !== ver);
  if (arr.length === (h[key] || []).length) return reply.code(404).send({ error: "版本不存在：v" + ver });
  h[key] = arr;
  _writeSummaryHistory(h);
  reply.send({ ok: true, block: key, version: ver });
});
};
