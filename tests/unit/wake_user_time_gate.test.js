const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// 影子目录隔离（同 wake_scheduler_catchup.test.js 的纪律）：lib/utils/memory/context/mcp 整份拷进临时目录再 require，
// 数据文件全落临时 data/，绝不碰真 data/。
// 测的是 2026-11-05 的「用户消息时间前置」修复：显式闹钟/事件唤醒没有用户消息时间也照常醒；普通周期解析不出按 skip。
const ROOT = path.join(__dirname, "..", "..");
const TMP = fs.mkdtempSync("/tmp/wake-utime-test-");
for (const d of ["lib", "utils", "memory", "context", "mcp"]) { if (fs.existsSync(path.join(ROOT, d))) cp.execSync("cp -r " + JSON.stringify(path.join(ROOT, d)) + " " + JSON.stringify(TMP + "/")); }
fs.copyFileSync(path.join(ROOT, "lib", "wake-scheduler.js"), path.join(TMP, "lib", "wake-scheduler.js"));
fs.mkdirSync(path.join(TMP, "workspace"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "workspace", "phone-tags.js"), path.join(TMP, "workspace", "phone-tags.js"));
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(TMP, "node_modules"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "timeline_data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "config"), { recursive: true });
const SID = "s_test_utime";
const SCHED = path.join(TMP, "lib", "wake-scheduler.js");
let calls = 0;

function writeJson(rel, obj) { fs.writeFileSync(path.join(TMP, rel), JSON.stringify(obj)); }
function rmData(name) { try { fs.rmSync(path.join(TMP, "data", name), { force: true }); } catch (e) {} }
// 无 time 字段、正文也无可解析时间的时间线（复现「未找到用户消息时间」的极端数据）
function noTimeTimeline() { writeJson("timeline_data/enhanced_messages_" + SID + ".json", [{ role: "user", content: "在吗" }, { role: "assistant", content: "在" }]); }
function mkScheduler() {
  return require(SCHED)({
    baseDir: TMP, readEnvValue: () => "", touchHeartbeat() {}, sendPushNotification: async () => ({ ok: true }),
    applyWakeEventV2: () => ({ ok: true }), wakeDeps: {}, activeGenMap: new Map(), ACTIVE_GEN_TTL_MS: 600000,
    runWakeCompletion: async () => { calls++; return { text: "[NO_ACTION]", toolHistory: [], wakeBlockId: null }; }
  });
}

test("无用户消息时间：普通周期安静跳过（skip 不 fail），不调模型不计失败", async () => {
  calls = 0;
  noTimeTimeline();
  writeJson("data/wake-event-sessions.json", [SID]);
  rmData("wake-alarms.json"); rmData("wake_schedule.json");
  const sch = require(SCHED)({ baseDir: TMP, readEnvValue: () => "", touchHeartbeat() {}, sendPushNotification: async () => ({ ok: true }), applyWakeEventV2: () => ({ ok: true }), wakeDeps: {}, activeGenMap: new Map(), ACTIVE_GEN_TTL_MS: 600000, runWakeCompletion: async () => { calls++; return { text: "[NO_ACTION]", toolHistory: [], wakeBlockId: null }; } });
  const st = await sch.runNow();
  assert.equal(calls, 0, "不该调模型");
  assert.notEqual(st, "failed", "普通周期解析不出用户消息时间不算失败（不进失败计数/不触发放弃告警）");
});

test("无用户消息时间：到点的工具闹钟照常唤醒并消费（Bug2 修复点）", async () => {
  calls = 0;
  noTimeTimeline();
  writeJson("data/wake-event-sessions.json", []);
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [SID]: { alarms: [{ id: "wa_u1", at: new Date(Date.now() - 5000).toISOString(), repeat: "once", label: "吃药" }] } } });
  const sch = mkScheduler();
  const st = await sch.runNow();
  assert.equal(calls, 1, "闹钟到点必须唤醒一次，实际 " + calls);
  assert.equal(st, "ok");
  const left = JSON.parse(fs.readFileSync(path.join(TMP, "data", "wake-alarms.json"), "utf-8"));
  assert.ok(!left.sessions || !left.sessions[SID], "once 闹钟唤醒成功后应已消费");
});

test("无用户消息时间：事件唤醒（睡着/醒来）照常醒", async () => {
  calls = 0;
  noTimeTimeline();
  writeJson("data/wake-event-sessions.json", []);
  rmData("wake-alarms.json");
  writeJson("data/wake-event-sessions.json", [SID]);
  writeJson("data/wake-subs.json", { off: {}, sessions: {} });
  const sch = mkScheduler();
  const r = await sch.fireEvent("sleep");
  assert.equal(calls, 1, "事件唤醒必须醒一次，实际 " + calls);
  assert.equal(r.status, "ok");
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} setTimeout(() => process.exit(0), 50); });
