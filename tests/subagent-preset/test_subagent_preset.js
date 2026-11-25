"use strict";
// 子智能体新引擎（用预设开的普通会话）：start / 追加 / report / log / detail / 状态 / stop + 引擎分发。
// 全部用桩：inject 记录请求、时间线与生成状态放内存；数据目录用临时目录，不碰线上。
// 运行：node --test tests/subagent-preset/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sub-preset-"));
for (const d of ["config", "timeline_data", "data/subagent", "data"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
fs.writeFileSync(path.join(TMP, "config", "chat-settings.json"), JSON.stringify({ cfg: { sess_presets: [
  { id: "sp_sub_agent", name: "子会话", md: "p_x|glm-5.3-flash", ps: "pb_x" },
  { id: "sp_fast", name: "快速", md: "p_y|fast-model" }
] } }));
// session-meta 写 data/ 下的文件：指到临时目录
require("../../lib/session-meta")._setDataDir(path.join(TMP, "data"));
const createRunner = require("../../lib/subagent-preset-runner");
const createEngine = require("../../lib/subagent-engine");

const calls = [];
const timelines = {};
const gens = {};
let chatResponder = async () => ({ statusCode: 200, body: "{}" });
function mk() {
  return createRunner({
    baseDir: TMP, readEnvValue: (k) => (k === "GATEWAY_API_KEY" ? "gk" : ""),
    inject: async (o) => {
      const body = JSON.parse(o.payload);
      calls.push({ url: o.url, headers: o.headers, body });
      if (o.url === "/v1/sessions/from-preset") return { statusCode: 200, body: JSON.stringify({ ok: true, applied: ["人设"] }) };
      if (o.url === "/v1/chat/completions") return await chatResponder(body);
      return { statusCode: 200, body: JSON.stringify({ ok: true, stopped: true }) };
    },
    loadTimeline: (sid) => timelines[sid] || [],
    getGen: (sid) => gens[sid]
  });
}
const tick = () => new Promise((r) => setTimeout(r, 15));

test("start（新建）：用预设建会话 → 登记 AI 名 → 后台发非流式聊天请求，带模型名和内部凭据", async () => {
  calls.length = 0;
  const r = mk();
  const out = await r.start({ task: "查一下磁盘\n再看内存" });
  assert.equal(out.ok, true);
  assert.match(out.subagent_id, /^s_sub_[0-9a-f]{8}$/);
  assert.equal(out.model, "glm-5.3-flash");
  assert.equal(calls[0].url, "/v1/sessions/from-preset");
  assert.deepEqual({ p: calls[0].body.preset_id, s: calls[0].body.session_id }, { p: "sp_sub_agent", s: out.subagent_id });
  assert.equal(calls[0].headers["x-gateway-api-key"], "gk");
  assert.equal(calls[0].headers["x-client"], "dylan-chat");
  await tick();
  const chat = calls.find((c) => c.url === "/v1/chat/completions");
  assert.equal(chat.body.stream, false);
  assert.equal(chat.body.session_id, out.subagent_id);
  assert.equal(chat.body.model, "glm-5.3-flash");
  assert.equal(chat.body.messages.length, 1);
  assert.equal(chat.body.messages[0].role, "user");
  const names = JSON.parse(fs.readFileSync(path.join(TMP, "data", "session-names.json"), "utf-8"));
  assert.match(names[out.subagent_id], /^子进程 · 查一下磁盘/);
  const ai = JSON.parse(fs.readFileSync(path.join(TMP, "data", "session_title_ai.json"), "utf-8"));
  assert.equal(ai[out.subagent_id], names[out.subagent_id], "登记成 AI 起的名，子会话自己写 <title> 才能覆盖");
});

test("start：任务为空 / 预设不存在 / 建会话失败 都给清楚的错误，不发聊天请求", async () => {
  calls.length = 0;
  const r = mk();
  assert.equal((await r.start({ task: "" })).ok, false);
  const e1 = await r.start({ task: "x", preset: "不存在" });
  assert.equal(e1.ok, false); assert.match(e1.error, /找不到子会话预设/); assert.match(e1.error, /子会话、快速/);
  const r2 = createRunner({ baseDir: TMP, readEnvValue: () => "", inject: async () => ({ statusCode: 400, body: JSON.stringify({ error: "预设不存在" }) }), loadTimeline: () => [], getGen: () => null });
  const e2 = await r2.start({ task: "x" });
  assert.equal(e2.ok, false); assert.match(e2.error, /用预设建会话失败.*HTTP 400/);
  assert.equal(calls.filter((c) => c.url === "/v1/chat/completions").length, 0);
});

test("preset 参数按 id 或名字选预设，模型取该预设的", async () => {
  calls.length = 0;
  const r = mk();
  const out = await r.start({ task: "快点", preset: "快速" });
  assert.equal(out.model, "fast-model");
  assert.equal(calls[0].body.preset_id, "sp_fast");
});

test("追加提示词（同 id 再 start）：请求里带历史窗口 + 新 user，避免时间线尾部对齐把已有回复清掉；还在生成就拒绝", async () => {
  calls.length = 0;
  const r = mk();
  const sid = "s_sub_aabbccdd";
  timelines[sid] = [
    { id: "u1", role: "user", content: "任务一" },
    { id: "a1", role: "assistant", content: "做完了 <report>R1</report>" }
  ];
  gens[sid] = { done: false };
  const busy = await r.start({ task: "再来一个", session_id: sid });
  assert.equal(busy.ok, false); assert.match(busy.error, /还在跑/);
  gens[sid] = { done: true };
  const out = await r.start({ task: "再来一个", session_id: sid });
  assert.equal(out.ok, true); assert.equal(out.reused, true);
  assert.equal(calls.some((c) => c.url === "/v1/sessions/from-preset"), false, "复用不重新建会话");
  await tick();
  const chat = calls.find((c) => c.url === "/v1/chat/completions");
  assert.deepEqual(chat.body.messages.map((m) => m.role + ":" + m.content), ["user:任务一", "assistant:做完了 <report>R1</report>", "user:再来一个"]);
  assert.equal(chat.body.messages[0].id, "u1");
  assert.equal((await r.start({ task: "x", session_id: "s_main_abc" })).ok, false);
  delete gens[sid];
});

test("聊天请求失败：状态 failed，report 带原因；成功后不留 inflight", async () => {
  const r = mk();
  chatResponder = async () => ({ statusCode: 500, body: JSON.stringify({ error: "上游挂了" }) });
  const out = await r.start({ task: "会失败的活" });
  await tick();
  const sid = out.subagent_id;
  timelines[sid] = [{ role: "user", content: "会失败的活" }];
  assert.equal(r._inflight.has(sid), false);
  assert.equal(r.statusOf(sid), "failed");
  assert.match(r.report({ session_id: sid, tag: "report" }).message, /上游挂了/);
  chatResponder = async () => ({ statusCode: 200, body: "{}" });
});

test("状态与 report：生成中=running（有历史报告也给）；结束且末尾是 assistant=done；末尾是 user=interrupted；没标签给提示", () => {
  const r = mk();
  const sid = "s_sub_11223344";
  timelines[sid] = [{ role: "user", content: "t" }, { role: "assistant", content: "先说两句 <report>结论A</report> 后话" }];
  assert.equal(r.statusOf(sid), "done");
  assert.deepEqual(r.report({ session_id: sid, tag: "report" }), { status: "done", report: "结论A", tag: "report" });
  assert.match(r.report({ session_id: sid, tag: "essay" }).message, /没有找到 <essay> 报告/);
  // tag 不填：最新一份 report_NN 优先，再退到 <report>；同一条里多个取最后一个；多次任务取最新
  timelines[sid] = [{ role: "user", content: "t" }, { role: "assistant", content: "<report_01>第一次</report_01> 然后 <report_02>第二次的</report_02>" }, { role: "user", content: "再来" }, { role: "assistant", content: "<report_03>第三次</report_03>" }];
  assert.deepEqual(r.report({ session_id: sid }), { status: "done", report: "第三次", tag: "report_03", task_no: 2, task_preview: "再来" });   // 10-31 加：不填 tag 走任务边界，返回带 task_no/task_preview（2026-11-01 补断言）
  assert.equal(r.report({ session_id: sid, tag: "report_02" }).report, "第二次的");
  timelines[sid] = [{ role: "user", content: "t" }, { role: "assistant", content: "老式 <report>旧标签</report>" }];
  assert.deepEqual(r.report({ session_id: sid }), { status: "done", report: "旧标签", tag: "report", task_no: 1, task_preview: "t" });   // 2026-11-01 补任务边界元信息断言
  timelines[sid] = [{ role: "user", content: "t" }, { role: "assistant", content: "没写任何标签" }];
  assert.match(r.report({ session_id: sid }).message, /没有找到报告标签/);   // 10-31 任务边界后文案改成“回复里没有找到报告标签”
  timelines[sid] = [{ role: "user", content: "t" }, { role: "assistant", content: "先说两句 <report>结论A</report> 后话" }];
  gens[sid] = { done: false };
  assert.equal(r.statusOf(sid), "running");
  assert.equal(r.report({ session_id: sid, tag: "report" }).status, "running");
  assert.equal(r.report({ session_id: sid, tag: "report" }).report, "结论A");
  assert.equal(r.report({ session_id: sid }).report, "结论A", "不填标签也能取到旧式 <report>");
  gens[sid] = { done: true, aborted: true };
  assert.equal(r.statusOf(sid), "stopped");
  delete gens[sid];
  timelines[sid] = [{ role: "user", content: "t" }];
  assert.equal(r.statusOf(sid), "interrupted");
  assert.equal(r.report({ session_id: sid, tag: "report" }).status, "interrupted");
  assert.equal(r.statusOf("s_sub_nonexist"), "not_found");
});

test("log：工具请求（名+参数）和每段正文，行号稳定，长文切块，旧格式消息也能派生", () => {
  const r = mk();
  const sid = "s_sub_55667788";
  const long = "字".repeat(4000);
  timelines[sid] = [
    { role: "user", content: "任务" },
    { role: "assistant", time: "t1", content: "我先看看。\n好了。", stream_timeline: [
      { type: "reasoning", text: "思考不记" },
      { type: "text", text: "我先看看。" },
      { type: "tool", tool: { name: "run_command", args: { command: "df -h" }, result: "结果不记", status: "done" } },
      { type: "tool", tool: { name: "read_file", args: "{\"path\":\"a\"}", error: "不存在", status: "failed" } },
      { type: "text", text: long }
    ] },
    { role: "assistant", time: "t2", content: "旧格式正文", tools: [{ name: "list_dir", args: { path: "/" } }] }
  ];
  const all = r.buildLogs(sid);
  assert.deepEqual(all.map((x) => x.no), all.map((_, i) => i + 1));
  assert.equal(all[0].kind, "say"); assert.equal(all[0].text, "我先看看。");
  assert.match(all[1].text, /^run_command 参数=\{"command":"df -h"\}$/);
  assert.match(all[2].text, /read_file 参数=.*\n出错：不存在/);
  assert.match(all[3].text, /^（第1\/3块，第0-1799字，共4000字）/);
  assert.equal(all.some((x) => /思考不记|结果不记/.test(x.text)), false);
  const last2 = all.slice(-2);
  assert.match(last2[0].text, /list_dir 参数=/); assert.equal(last2[1].text, "旧格式正文");
  const page = r.log({ session_id: sid, start_line: 2, end_line: 3 });
  assert.equal(page.items.length, 2); assert.equal(page.total, all.length); assert.equal(page.has_more, true);
  assert.equal(r.log({ session_id: sid, start_line: 0 }).ok, false);
  assert.equal(r.log({ session_id: sid, start_line: 999 }).items.length, 0);
});

test("detail：历史走时间线，生成中把 activeGen 当最后一条 live 消息；since 没变化只回状态；旧契约字段齐全", () => {
  const r = mk();
  const sid = "s_sub_99aabbcc";
  timelines[sid] = [{ role: "user", content: "任务全文", time: "t0" }, { role: "assistant", content: "上一轮结果", time: "t1", stream_timeline: [{ type: "text", text: "上一轮结果" }, { type: "tool", tool: { name: "x", status: "done" } }] }];
  gens[sid] = { done: false, ts: 12345, phase: "tool", text: "写到一半", reasoning: "想", tools: [{ name: "run_command", status: "running" }],
    parts: [{ type: "reasoning", text: "想" }, { type: "tool", tool: { name: "run_command", status: "running", args: "{}", result: "" } }, { type: "text", text: "写到一半" }] };
  const d = r.detail(sid);
  assert.equal(d.status, "running"); assert.equal(d.task, "任务全文"); assert.equal(d.rounds, 1);
  assert.equal(d.rev, 12345);
  assert.deepEqual(d.activity.phase, "tool"); assert.equal(d.activity.tool, "run_command");
  const live = d.timeline[d.timeline.length - 1];
  assert.equal(live.live, true); assert.equal(live.stream_timeline.length, 3); assert.equal(live.content, "写到一半");
  assert.equal(r.detail(sid, { since: "12345" }).same, true);
  assert.equal(Object.hasOwn(r.detail(sid, { since: "1" }), "timeline"), true);
  gens[sid] = { done: true };
  const d2 = r.detail(sid);
  assert.equal(d2.timeline.some((m) => m.live), false); assert.equal(d2.status, "done");
  assert.equal(r.detail("s_sub_nope").ok, false);
  delete gens[sid];
});

test("statusAll：扫时间线目录里的 s_sub_ 会话", () => {
  const r = mk();
  fs.writeFileSync(path.join(TMP, "timeline_data", "enhanced_messages_s_sub_a1b2c3d4.json"), "[]");
  fs.writeFileSync(path.join(TMP, "timeline_data", "enhanced_messages_s_main_x.json"), "[]");
  timelines["s_sub_a1b2c3d4"] = [{ role: "user", content: "t" }, { role: "assistant", content: "ok" }];
  const all = r.statusAll();
  assert.equal(all["s_sub_a1b2c3d4"], "done");
  assert.equal("s_main_x" in all, false);
  gens["s_sub_a1b2c3d4"] = { done: false };
  assert.equal(r.statusAll()["s_sub_a1b2c3d4"], "running");
  delete gens["s_sub_a1b2c3d4"];
});

test("stop：调普通会话的 /v1/chat/stop", async () => {
  calls.length = 0;
  const r = mk();
  const out = await r.stop({ session_id: "s_sub_aabbccdd" });
  assert.equal(out.ok, true);
  assert.deepEqual(calls[0].body, { session_id: "s_sub_aabbccdd" });
  assert.equal(calls[0].url, "/v1/chat/stop");
});

test("引擎分发：新建按 engine 文件（缺省 preset，改文件立即切 legacy）；带 id 的按有没有旧记录；statusAll 合并旧记录优先", async () => {
  const hits = [];
  const legacy = { start: (o) => (hits.push("legacy.start"), { ok: true, who: "legacy" }), report: () => ({ who: "legacy" }), log: () => ({ who: "legacy" }), detail: () => ({ who: "legacy" }), stop: () => ({ who: "legacy" }), statusOf: () => "legacy", statusAll: () => ({ s_sub_old00001: "done", s_sub_both0001: "failed" }) };
  const preset = { start: (o) => (hits.push("preset.start"), { ok: true, who: "preset" }), report: () => ({ who: "preset" }), log: () => ({ who: "preset" }), detail: () => ({ who: "preset" }), stop: () => ({ who: "preset" }), statusOf: () => "preset", statusAll: () => ({ s_sub_new00001: "running", s_sub_both0001: "done" }) };
  const e = createEngine({ legacy, preset, baseDir: TMP });
  assert.equal(e.start({ task: "x" }).who, "preset");
  fs.writeFileSync(path.join(TMP, "data", "subagent-engine.json"), JSON.stringify({ engine: "legacy" }));
  assert.equal(e.start({ task: "x" }).who, "legacy");
  fs.writeFileSync(path.join(TMP, "data", "subagent-engine.json"), JSON.stringify({ engine: "preset" }));
  fs.writeFileSync(path.join(TMP, "data", "subagent", "s_sub_old00001.json"), "{}");
  assert.equal(e.start({ task: "x", session_id: "s_sub_old00001" }).who, "legacy", "有旧记录的会话续派走旧引擎");
  assert.equal(e.start({ task: "x", session_id: "s_sub_new00001" }).who, "preset");
  assert.equal(e.report({ session_id: "s_sub_old00001" }).who, "legacy");
  assert.equal(e.detail("s_sub_new00001").who, "preset");
  assert.equal(e.stop({ session_id: "s_sub_old00001" }).who, "legacy");
  assert.deepEqual(e.statusAll(), { s_sub_old00001: "done", s_sub_both0001: "failed", s_sub_new00001: "running" });
  assert.equal(e.report({ session_id: "../etc/passwd" }).who, "preset", "非法 id 不会去碰文件");
});

test("防蒸发：新建派单先落占位任务消息；请求被杀后，重启的新进程读占位 → interrupted、抽屉有任务全文", async () => {
  calls.length = 0;
  const r = mk();
  const out = await r.start({ task: "查个被杀的场景" });
  assert.equal(out.ok, true);
  const sid = out.subagent_id;
  // 占位文件不等聊天请求完成就已落盘
  const f = path.join(TMP, "timeline_data", "enhanced_messages_" + sid + ".json");
  assert.equal(fs.existsSync(f), true, "派单成功即有占位时间线");
  const ph = JSON.parse(fs.readFileSync(f, "utf-8"));
  assert.equal(ph.length, 1);
  assert.equal(ph[0].role, "user");
  assert.equal(ph[0].content, "查个被杀的场景");
  assert.equal(ph[0].position, 0.5);
  await tick();
  const chat = calls.find((c) => c.url === "/v1/chat/completions");
  assert.equal(chat.body.messages[0].id, ph[0].id, "占位与请求里那条 user 同 id，正式落盘按 id 认出不重复");
  assert.equal(chat.body.messages[0].content, ph[0].content, "内容也一致，内容键兜底也认得出");
  // 模拟网关重启：聊天请求没写任何回复就死了 → 新进程 loadTimeline 只读到占位、无 inflight/gen
  const r2 = createRunner({
    baseDir: TMP, readEnvValue: () => "",
    inject: async () => ({ statusCode: 200, body: "{}" }),
    loadTimeline: (s) => (s === sid ? JSON.parse(fs.readFileSync(f, "utf-8")) : []),
    getGen: () => null
  });
  assert.equal(r2.statusOf(sid), "interrupted", "重启后是「已中断」不是 not_found");
  const d = r2.detail(sid);
  assert.equal(d.ok, true);
  assert.equal(d.status, "interrupted");
  assert.equal(d.task, "查个被杀的场景", "抽屉能看到任务全文");
  const rep = r2.report({ session_id: sid });
  assert.equal(rep.status, "interrupted");
  assert.match(rep.message, /中断/);
});

test("占位只在新建时落：复用已有会话、预设不存在的失败路径都不新增文件", async () => {
  calls.length = 0;
  const r = mk();
  const before = fs.readdirSync(path.join(TMP, "timeline_data")).sort().join(",");
  const sid = "s_sub_reuse001";
  timelines[sid] = [{ id: "u0", role: "user", content: "老任务" }, { id: "a0", role: "assistant", content: "旧报告 <report_01>R</report_01>" }];
  await r.start({ task: "追加的活", session_id: sid });
  // 2026-11-01 起复用也先把任务消息落进时间线文件（appendTaskTimeline，防请求被杀后 statusOf 误判 done）：
  // 这里只断言「落的是任务消息、不是占位」；mock 的 timelines 不在盘上，文件内容 = 原有 2 条 + 追加的任务。
  const reuseFile = path.join(TMP, "timeline_data", "enhanced_messages_s_sub_reuse001.json");
  assert.equal(fs.existsSync(reuseFile), true, "复用会落任务消息");
  const reuseArr = JSON.parse(fs.readFileSync(reuseFile, "utf-8"));
  assert.equal(reuseArr.length, 3, "原有两条保留，末尾追加一条任务"); const lastM = reuseArr[reuseArr.length - 1];
  assert.equal(lastM.role, "user"); assert.ok(String(lastM.content).indexOf("追加的活") >= 0, "末尾是这次的任务全文，不是占位"); assert.equal(reuseArr[0].id, "u0");
  const before2 = fs.readdirSync(path.join(TMP, "timeline_data")).sort().join(",");
  const e1 = await r.start({ task: "y", preset: "不存在" });
  assert.equal(e1.ok, false);
  const after = fs.readdirSync(path.join(TMP, "timeline_data")).sort().join(",");
  assert.equal(after, before2, "失败路径不新增时间线文件");
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
