'use strict';
// routes/memory-pipelines.js —— 记忆三条后台流水线的管理接口：
//   /admin/memory-distill/*（蒸馏：config/run/status/prompt/runs）、/admin/memory-summary/*（两块总结：config/run/status/prompt）、
//   /admin/memory-backfill/*（老数据重跑：config/run/status/prompt/runs）；共 23 条。
// 2026-11-03 从 server.js 拆出（server.js 拆分批 4a；原位置 4364-4371 的 requireDistill + 4481-4710 的路由整段，逻辑一字未改；
//   requireDistill/requireSummary/requireBackfill 三个「模块未初始化」守卫只在这里用，一并搬来）。
// 依赖注入：basicAuth，以及 memoryDistill/memorySummary/memoryBackfill 三个调度器对象——它们在 server.js 启动时用 let 赋值一次（失败则为 null，
//   守卫会回 500「模块未初始化」），本模块在赋值之后才被登记，所以直接按值传入即可。
module.exports = function (app, deps) {
const { basicAuth, memoryDistill, memorySummary, memoryBackfill } = deps;

// ========================
// 记忆蒸馏配置 / 手动触发 / 状态（1002 记忆改造 §8 3.1）
// ========================
function requireDistill(reply) {
  if (memoryDistill) return true;
  reply.code(500).send({ error: "蒸馏模块未初始化" });
  return false;
}

app.get("/admin/memory-distill/config", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try { reply.send(memoryDistill.readConfig()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-distill/config", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.time !== undefined) patch.time = String(b.time);
    if (b.batch_size !== undefined) patch.batch_size = Number(b.batch_size);
    reply.send(memoryDistill.saveConfig(patch));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 立即跑一次：不受 enabled 约束（关着也能手动跑）；单飞，已在跑返回 409
app.post("/admin/memory-distill/run", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try {
    if (memoryDistill.status().running) {
      return reply.code(409).send({ error: "已有蒸馏在跑", status: memoryDistill.status() });
    }
    // 1004：支持 dryRun / noQueue 透传——改选材后第一次试跑要先「不落库」看质量，
    // 免得抽出来的东西直接灌进待审队列、还要人工一条条删
    const o = (req && req.body && typeof req.body === "object") ? req.body : {};
    const runOpts = { dryRun: !!o.dryRun, noQueue: !!o.noQueue };
    /* 11-03：可指定日期蒸（days:['2026-10-09']，最多 3 天一次，防一下子烧太多钱）；不传＝照旧按顺序取下一天 */
    if (Array.isArray(o.days) && o.days.length) runOpts.days = o.days.map(String).slice(0, 3);
    const r = await memoryDistill.runNow("manual", runOpts);
    reply.send(r);
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 蒸馏笔记（11-04）：把还没蒸过的笔记按蒸馏提示词蒸成记忆，候选只进待审。后台跑，立即返回；进度看 /admin/memory-distill/status 的 notes 字段
app.get("/admin/memory-distill/notes", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try { reply.send(Object.assign({ ok: true }, memoryDistill.notesStatus())); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/memory-distill/notes-run", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try {
    if (memoryDistill.status().running) return reply.code(409).send({ error: "已有蒸馏在跑", status: memoryDistill.status() });
    const o = (req && req.body && typeof req.body === "object") ? req.body : {};
    // 11-12：清单里叉掉的不蒸——skip 传笔记 id 数组，本次全跳过（不喂模型、不标已蒸、快照不动，下次还在清单里）；不传=照旧全蒸
    const skipIds = Array.isArray(o.skip) ? o.skip.map(x => String(x)).filter(s => s.length <= 64).slice(0, 500) : null;
    const ns = memoryDistill.notesStatus();
    if (!ns.pending) return reply.send({ ok: true, started: false, pending: 0, note: "没有新的或更新过的笔记" });
    const willSkip = skipIds ? (ns.items || []).filter(e => skipIds.indexOf(String(e.id)) >= 0).length : 0;
    const willRun = ns.pending - willSkip;
    if (willRun <= 0) return reply.send({ ok: true, started: false, pending: 0, skipped: willSkip, note: "叉掉的都算了，这次没有要蒸的" });
    memoryDistill.runNotes("manual", { noQueue: !!o.noQueue, skipIds }).catch(function (e) { console.error("[memory-distill] 蒸馏笔记异常:", e && e.message); });
    reply.send({ ok: true, started: true, pending: willRun, skipped: willSkip });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/memory-distill/days", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try { reply.send({ ok: true, days: memoryDistill.daysStatus() }); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/memory-distill/status", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try { reply.send(memoryDistill.status()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

/* [位置:routes/memory-pipelines.js·GET distill/runs] [蒸馏运行日志/实时状态] [需求:11-12「这两个。加记录日志之类的」——{running,kind,trigger,started_at,runs:最近 50 条运行记录（新→旧）}，设置页「运行日志」子页 5 秒轮询它刷新跑着呢横幅和记录列表] [注释时间 2026-11-12] */
app.get("/admin/memory-distill/runs", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try { reply.send(memoryDistill.runsInfo()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

// 蒸馏抽取提示词（System + User）：留空 = 回落内置默认；DELETE = 清空自定义回到内置
app.get("/admin/memory-distill/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try {
    const c = memoryDistill.readPromptConfig();
    reply.send({
      distill_system_prompt: c.distill_system_prompt || "",
      distill_user_prompt: c.distill_user_prompt || "",
      distill_notes_user_prompt: c.distill_notes_user_prompt || "",
      default_distill_notes_user_prompt: memoryDistill.defaultNotesUserPrompt(),
      default_distill_system_prompt: memoryDistill.defaultSystemPrompt(),
      default_distill_user_prompt: memoryDistill.defaultUserPrompt(),
      custom_set: !!(c.distill_system_prompt || c.distill_user_prompt),
    });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-distill/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try {
    const b = req.body || {};
    const patch = {};
    if (b.distill_system_prompt !== undefined) patch.distill_system_prompt = String(b.distill_system_prompt).trim();
    if (b.distill_user_prompt !== undefined) patch.distill_user_prompt = String(b.distill_user_prompt).trim();
    if (b.distill_notes_user_prompt !== undefined) patch.distill_notes_user_prompt = String(b.distill_notes_user_prompt).trim();
    reply.send(memoryDistill.savePromptConfig(patch));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.delete("/admin/memory-distill/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireDistill(reply)) return;
  try {
    reply.send(memoryDistill.savePromptConfig({ distill_system_prompt: "", distill_user_prompt: "", distill_notes_user_prompt: "" }));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// ========================
// 两块 LLM 总结配置 / 手动生成 / 状态 / 提示词（1002 记忆改造 §8 第 6 项）
// ========================
function requireSummary(reply) {
  if (memorySummary) return true;
  reply.code(500).send({ error: "两块总结模块未初始化" });
  return false;
}

app.get("/admin/memory-summary/config", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try { reply.send(memorySummary.readConfig()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-summary/config", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.time !== undefined) patch.time = String(b.time);
    if (b.incremental !== undefined) patch.incremental = !!b.incremental;
    reply.send(memorySummary.saveConfig(patch));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 立即生成一次：不受 enabled 约束；force=true 时忽略指纹（池子没变也重生成）
app.post("/admin/memory-summary/run", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try {
    if (memorySummary.status().running) {
      return reply.code(409).send({ error: "已有生成在跑", status: memorySummary.status() });
    }
    const b = req.body || {};
    const force = !!b.force;
    // 1003-15：改后台异步——全量（可能 5-20 分钟）不再占 HTTP 连接（nginx 读超时 620s 兜不住），
    // 接口立即返回 started，前端轮询 /admin/memory-summary/status 直到跑完。
    setImmediate(function () {
      memorySummary.runNow({ force: force }).then(function (r) {
        console.log("[memory-summary] 后台生成完成:", JSON.stringify(r && { ok: r.ok, error: r.error, tool_rounds: r.tool_rounds, blocks: r.blocks }));
      }).catch(function (e) {
        console.error("[memory-summary] 后台生成异常:", e && e.message);
      });
    });
    reply.send({ ok: true, started: true, force: force });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/memory-summary/status", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try { reply.send(memorySummary.status()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

// 两块提示词：留空 = 回落内置默认；DELETE = 清空自定义
app.get("/admin/memory-summary/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try {
    const c = memorySummary.readPromptConfig();
    reply.send({
      system_prompt: c.system_prompt || "",
      user_prompt: c.user_prompt || "",
      default_system_prompt: memorySummary.defaultCombinedSystem(),
      default_user_prompt: memorySummary.defaultCombinedUser(),
      custom_set: !!(c.system_prompt || c.user_prompt),
    });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-summary/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try {
    const b = req.body || {};
    reply.send(memorySummary.savePromptConfig(b));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.delete("/admin/memory-summary/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireSummary(reply)) return;
  try {
    reply.send(memorySummary.savePromptConfig({ system_prompt: "", user_prompt: "" }));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// ========================
// 老数据重跑（1002 记忆改造 §8 第 5 项）
// ========================
function requireBackfill(reply) {
  if (memoryBackfill) return true;
  reply.code(500).send({ error: "老数据重跑模块未初始化" });
  return false;
}

app.get("/admin/memory-backfill/config", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try { reply.send(memoryBackfill.readConfig()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-backfill/config", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.time !== undefined) patch.time = String(b.time);
    if (b.batch_size !== undefined) patch.batch_size = Number(b.batch_size);
    reply.send(memoryBackfill.saveConfig(patch));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 跑一批：body.batch_size 可临时改批量；body.dry_run=true 只组装材料不调模型
app.post("/admin/memory-backfill/run", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try {
    if (memoryBackfill.status().running) return reply.code(409).send({ error: "已有重跑在跑" });
    const b = req.body || {};
    const r = await memoryBackfill.runNow({ batch_size: b.batch_size, dryRun: !!b.dry_run });
    reply.send(r);
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/memory-backfill/status", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try { reply.send(memoryBackfill.status()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

/* [位置:routes/memory-pipelines.js·GET backfill/runs] [重跑运行日志/实时状态] [需求:11-12「这两个。加记录日志之类的」——{running,kind,trigger,started_at,runs:最近 50 条运行记录（新→旧）}，设置页「运行日志」子页 5 秒轮询它刷新跑着呢横幅和记录列表] [注释时间 2026-11-12] */
app.get("/admin/memory-backfill/runs", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try { reply.send(memoryBackfill.runsInfo()); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

// 建议沉底列表（sink 是删除级，不混进新增候选；这里只列，不自动执行）

// 重跑提示词：留空 = 回落内置默认；DELETE = 清空自定义
app.get("/admin/memory-backfill/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try {
    const c = memoryBackfill.readPromptConfig();
    reply.send({
      system_prompt: c.system_prompt || "",
      user_prompt: c.user_prompt || "",
      default_system_prompt: memoryBackfill.defaultSystemPrompt(),
      default_user_prompt: memoryBackfill.defaultUserPrompt(),
      custom_set: !!(c.system_prompt || c.user_prompt),
    });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/memory-backfill/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try { reply.send(memoryBackfill.savePromptConfig(req.body || {})); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

app.delete("/admin/memory-backfill/prompt", { preHandler: basicAuth }, async (req, reply) => {
  if (!requireBackfill(reply)) return;
  try { reply.send(memoryBackfill.savePromptConfig({ system_prompt: "", user_prompt: "" })); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});
};
