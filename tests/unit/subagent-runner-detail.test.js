const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// 影子目录隔离：所有记录、时间线和归档都只写 /tmp，不碰 gateway 正在使用的 data/。
const SRC = process.env.SUBAGENT_RUNNER_SRC || path.join(__dirname, "..", "..", "lib", "subagent-runner.js");
const TMP = fs.mkdtempSync("/tmp/subagent-detail-test-");
for (const d of ["lib", "mcp", "data/subagent", "timeline_data"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
let source = fs.readFileSync(SRC, "utf8");
const exported = "return { start, report, log, statusOf, statusAll, _running, findReportInTimeline, stop, detail, ensureSubPersona };";
if (!source.includes(exported)) throw new Error("subagent-runner 导出入口已变化，请同步测试锚点");
// 只在测试副本里暴露 _run/_activity，生产文件不增加测试接口。
source = source.replace(exported, "return { start, report, log, statusOf, statusAll, _running, _activity, _run, findReportInTimeline, stop, detail, ensureSubPersona };");
fs.writeFileSync(path.join(TMP, "lib", "subagent-runner.js"), source);
fs.writeFileSync(path.join(TMP, "mcp", "mcp-client.js"), "exports.loadConfig=()=>[]; exports.McpServerClient=function(){};");
fs.writeFileSync(path.join(TMP, "lib", "timeline-dir.js"), "const p=require('path'); exports.timelineDirOf=b=>p.join(b,'timeline_data');");

const createRunner = require(path.join(TMP, "lib", "subagent-runner.js"));
const seen = [];
let liveStub = null;
let runner;
function timelinePath(sid) { return path.join(TMP, "timeline_data", "enhanced_messages_" + sid + ".json"); }
function recordPath(sid) { return path.join(TMP, "data", "subagent", sid + ".json"); }
function putRecord(sid, status) {
  fs.writeFileSync(recordPath(sid), JSON.stringify({
    version: 1, subagent_id: sid, task: "核对抽屉运行状态", model: "test-model",
    status: status || "running", created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    ended_at: null, rounds: 0, total_logs: 0, error: null, logs: []
  }));
}
function appendMessages(sid, messages) {
  const p = timelinePath(sid);
  const arr = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  arr.push.apply(arr, messages);
  fs.writeFileSync(p, JSON.stringify(arr));
}
runner = createRunner({
  baseDir: TMP,
  readEnvValue: () => "",
  appendMessages,
  normalizeContentToText: String,
  streamToolLoop: async (opts) => {
    if (opts.sessionId === "s_sub_rt") return await liveStub(opts);
    opts.onEvent({ type: "reasoning", text: "先核对" });
    seen.push(["reasoning", runner._activity.get(opts.sessionId).phase]);
    opts.onEvent({ type: "tool_start", name: "read_file", args: {} });
    seen.push(["tool_start", runner._activity.get(opts.sessionId).phase, runner._activity.get(opts.sessionId).tool]);
    opts.onEvent({ type: "tool_end", name: "read_file", args: {}, result: "ok" });
    seen.push(["tool_end", runner._activity.get(opts.sessionId).phase]);
    opts.onEvent({ type: "text", text: "完成" });
    seen.push(["text", runner._activity.get(opts.sessionId).phase]);
    return {
      text: "完成", rounds: 1, reasoning: "先核对",
      toolHistory: [{ name: "read_file", args: {}, result: "ok", time: "2026-10-27 19:00:00" }],
      streamTimeline: [{ type: "reasoning", text: "先核对" }, { type: "text", text: "完成" }]
    };
  }
});

test("运行事件只更新轻量 activity，结束后清理；完整时间线仍按原链路落盘", async () => {
  const sid = "s_sub_live";
  putRecord(sid, "running");
  fs.writeFileSync(timelinePath(sid), JSON.stringify([{ role: "user", content: "核对抽屉运行状态" }]));
  await runner._run(sid, [{ role: "user", content: "核对抽屉运行状态" }], { model: "test-model", clients: [], url: "", key: "" });
  assert.deepEqual(seen, [
    ["reasoning", "thinking"],
    ["tool_start", "tool", "read_file"],
    ["tool_end", "thinking"],
    ["text", "writing"]
  ]);
  assert.equal(runner._activity.has(sid), false);
  const rec = JSON.parse(fs.readFileSync(recordPath(sid), "utf8"));
  assert.equal(rec.status, "done");
  const full = runner.detail(sid);
  assert.equal(full.timeline.length, 2);
  assert.equal(full.timeline[1].content, "完成");
  assert.equal(full.timeline[1].stream_timeline.length, 2);
  assert.equal(Object.hasOwn(full, "logs"), false, "logs 不喂浏览器");
});

test("meta 只给状态和任务，不回传完整 timeline；原完整详情保持兼容", () => {
  const sid = "s_sub_meta";
  putRecord(sid, "done");
  fs.writeFileSync(timelinePath(sid), JSON.stringify([
    { role: "user", content: "核对抽屉运行状态" },
    { role: "assistant", content: "完整报告", reasoning: "r", tools: [], stream_timeline: [] }
  ]));
  const meta = runner.detail(sid, { meta: true });
  assert.equal(meta.meta, true);
  assert.equal(meta.status, "done");
  assert.equal(meta.task, "核对抽屉运行状态");
  assert.equal(Object.hasOwn(meta, "timeline"), false);
  const full = runner.detail(sid);
  assert.equal(full.meta, undefined);
  assert.equal(full.timeline[1].content, "完整报告");
});

test("终止等待期 activity=stopping，且 abort 与 stopped 记录语义不变", () => {
  const sid = "s_sub_stop";
  putRecord(sid, "running");
  const ac = new AbortController();
  runner._running.set(sid, { ac, startedAt: Date.now() });
  const r = runner.stop({ session_id: sid });
  assert.equal(r.ok, true);
  assert.equal(r.status, "stopping");
  assert.equal(ac.signal.aborted, true);
  const meta = runner.detail(sid, { meta: true });
  assert.equal(meta.activity.phase, "stopping");
  assert.equal(meta.status, "running", "工具尚未收尾时执行器仍在内存，UI 由 activity 显示正在收尾");
  const rec = JSON.parse(fs.readFileSync(recordPath(sid), "utf8"));
  assert.equal(rec.status, "stopped");
  runner._running.delete(sid);
  assert.equal(runner.detail(sid, { meta: true }).status, "stopped");
});

/* 2026-10-27 批1：子会话抽屉实时——运行中 detail 把引擎实时写的 liveTimeline 当最后一条 assistant 消息给；rev 随事件增长；带 since 且没变化只回状态；跑完清掉、不再自动归档 */
test("运行中 detail 给实时过程，since 没变化不回全文，结束后清理且不自动归档", async () => {
  const sid = "s_sub_rt";
  putRecord(sid, "running");
  fs.writeFileSync(timelinePath(sid), JSON.stringify([{ role: "user", content: "实时任务" }]));
  let release; const gate = new Promise((r) => { release = r; });
  let mid;
  liveStub = async (opts) => {
    opts.liveTimeline.push({ type: "reasoning", text: "想一想" });
    opts.onEvent({ type: "reasoning", text: "想一想" });
    opts.liveTimeline.push({ type: "tool", tool: { index: 0, id: "c0", name: "read_file", args: "{}", status: "running", result: "", error: null } });
    opts.onEvent({ type: "tool_start", name: "read_file", args: {} });
    mid = runner.detail(sid);
    await gate;
    return { text: "完成", rounds: 1, reasoning: "想一想", toolHistory: [], streamTimeline: opts.liveTimeline.slice() };
  };
  const p = runner._run(sid, [{ role: "user", content: "实时任务" }], { model: "test-model", clients: [], url: "", key: "" });
  await new Promise((r) => setTimeout(r, 20));
  const d1 = runner.detail(sid);
  assert.equal(d1.status, "running");
  const live = d1.timeline[d1.timeline.length - 1];
  assert.equal(live.live, true);
  assert.equal(live.role, "assistant");
  assert.equal(live.stream_timeline.length, 2);
  assert.equal(live.stream_timeline[1].tool.status, "running");
  assert.ok(d1.rev >= 2, "rev 随事件增长: " + d1.rev);
  const d2 = runner.detail(sid, { since: String(d1.rev) });
  assert.equal(d2.same, true);
  assert.equal(Object.hasOwn(d2, "timeline"), false);
  const d3 = runner.detail(sid, { since: "0" });
  assert.equal(Object.hasOwn(d3, "timeline"), true);
  assert.equal(runner.statusAll()[sid], "running");
  release(); await p;
  const d4 = runner.detail(sid);
  assert.equal(d4.timeline.some((m) => m.live), false, "跑完不再带 live，落盘的是最终版");
  assert.equal(d4.timeline[d4.timeline.length - 1].content, "完成");
  assert.equal(runner.statusAll()[sid], "done");
  assert.equal(fs.existsSync(path.join(TMP, "data", "session-archive.json")), false, "不再自动归档");
});

/* 2026-10-27：终止/失败时没有正文，也要把已做的思考/工具定稿落盘（用户真机：点终止后抽屉里过程全没了） */
test("失败/终止没有正文时，实时过程定稿落盘，运行中的工具标成失败", async () => {
  const sid = "s_sub_rt";
  putRecord(sid, "running");
  fs.writeFileSync(timelinePath(sid), JSON.stringify([{ role: "user", content: "会被终止的任务" }]));
  liveStub = async (opts) => {
    opts.liveTimeline.push({ type: "reasoning", text: "先想" });
    opts.liveTimeline.push({ type: "tool", tool: { index: 0, id: "c0", name: "run_command", args: "{}", status: "running", result: "", error: null } });
    throw new Error("boom");
  };
  await runner._run(sid, [{ role: "user", content: "会被终止的任务" }], { model: "test-model", clients: [], url: "", key: "" });
  const d = runner.detail(sid);
  assert.equal(d.status, "failed");
  const last = d.timeline[d.timeline.length - 1];
  assert.equal(last.role, "assistant");
  assert.equal(last.stream_timeline.length, 2);
  assert.equal(last.stream_timeline[1].tool.status, "failed");
  assert.match(last.stream_timeline[1].tool.error, /还没返回|没有跑完/);
  assert.equal(last.live, undefined);
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
