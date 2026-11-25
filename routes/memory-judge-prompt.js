'use strict';
// routes/memory-judge-prompt.js —— 记忆流水线「judge 判定提示词」配置接口（提示词页用）：GET/POST/DELETE /admin/memory-judge/prompt
//   数据落 data/judge_prompt.json（由 memory/judge-adapter.js 读写：getJudgePromptConfig / saveJudgeTemplate）。
// 2026-11-03 从 server.js 拆出（server.js 拆分批 4c；原位置 4125-4143 行，3 条路由，逻辑一字未改；judgeAdapter 只在这里用，require 路径改成 ../memory/judge-adapter）。
// 依赖注入：basicAuth。
// 11-08 加（产品确定「攒批评分」）：GET 响应带 batch 批量评分状态；POST /batch 存每批评分条数（落 data/memory_v2_config.json）；
//   POST /batch-run 立刻把攒着的评分任务全部评掉（攒不满也跑）。
module.exports = function (app, deps) {
const { basicAuth, admission, baseDir } = deps;
const fs = require("fs-extra");
const path = require("path");
const CFG_FILE = path.join(baseDir || process.cwd(), "data", "memory_v2_config.json");

// 记忆流水线 judge 判定提示词（提示词页配置，2026-09-19）
const judgeAdapter = require("../memory/judge-adapter");
app.get("/admin/memory-judge/prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const c = judgeAdapter.getJudgePromptConfig();
    const out = { template: c.effective, custom_set: !!c.custom, default_template: c.default_template };
    // 11-08：批量评分状态（当前攒批数 / 每批条数）——设置页「入库判定」卡显示进度用
    if (admission && typeof admission.judgeBatchStats === "function") out.batch = admission.judgeBatchStats();
    reply.send(out);
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/memory-judge/prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const t = judgeAdapter.saveJudgeTemplate((req.body || {}).template);
    reply.send({ ok: true, custom_set: !!t });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.delete("/admin/memory-judge/prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    judgeAdapter.saveJudgeTemplate("");
    reply.send({ ok: true, custom_set: false });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

/* [位置:routes/memory-judge-prompt.js·POST batch] [每批评分条数落盘] [需求:11-08：批数在设置页「入库判定」卡里调；存 memory_v2_config.json 的 judge_batch_size（1-60，缺 30），admission 重启读配置生效，路由侧同时回当前值] [注释时间 2026-11-08] */
app.post("/admin/memory-judge/batch", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const n = Math.max(1, Math.floor(Number((req.body || {}).size) || 0) || 30);   // 1110 产品确定：60 上限去掉，自己调
    let cfg = {};
    try { cfg = fs.readJsonSync(CFG_FILE); } catch (_) { cfg = {}; }
    if (!cfg || typeof cfg !== "object") cfg = {};
    cfg.judge_batch_size = n;
    fs.writeJsonSync(CFG_FILE, cfg, { spaces: 2 });
    reply.send({ ok: true, size: n, batch: admission && typeof admission.judgeBatchStats === "function" ? admission.judgeBatchStats() : null });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

/* [位置:routes/memory-judge-prompt.js·POST batch-run] [立刻评一批] [需求:11-08：攒不满也要能手动跑——把当前攒着的评分任务全评掉（llm 模式批量调用，超一批循环跑完）] [11-11 改协议：触发即返回——有任务 {started:true,batches,items} 后台接着跑；已在跑 {running:true}；没任务 {processed:0,note}。进度和结果走 GET /admin/memory-judge/runs 轮询。以前是一次 HTTP 挂到跑完（40 条要几分钟），锁屏就断] [注释时间 2026-11-11] */
app.post("/admin/memory-judge/batch-run", { preHandler: basicAuth }, async (req, reply) => {
  try {
    if (!admission || typeof admission.runJudgeBatchNow !== "function") return reply.code(503).send({ error: "memory-v2 admission 未初始化" });
    const r = await admission.runJudgeBatchNow();
    if (r && r.running) return reply.send({ success: false, started: false, running: true, note: r.note || "已经在评分了" });
    if (r && r.started) return reply.send({ success: true, started: true, batches: r.batches || 0, items: r.items || 0 });
    reply.send({ success: true, started: false, processed: r.processed || 0, batches: r.batches || 0, degraded: r.degraded || 0, last_error: r.last_error || null, note: r.note || null });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

/* [位置:routes/memory-judge-prompt.js·GET runs] [评分跑批日志/实时进度] [需求:11-11「跑了没日志，不知道跑到哪了」——{batch:当前攒批+running 状态, runs:最近 50 条跑批记录（新→旧，含手动跑的 summary 汇总条）}；设置页 5 秒轮询它刷新「评着呢·第几批·已评多少」和评分日志子页] [注释时间 2026-11-11] */
app.get("/admin/memory-judge/runs", { preHandler: basicAuth }, async (req, reply) => {
  try {
    if (!admission || typeof admission.judgeRunsInfo !== "function") return reply.code(503).send({ error: "memory-v2 admission 未初始化" });
    reply.send(admission.judgeRunsInfo());
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
};
