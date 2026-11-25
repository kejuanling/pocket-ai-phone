const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// 影子目录隔离（同 wake_alarms.test.js 的纪律）：把 lib/utils/memory/context/mcp 整份拷进临时目录再 require，
// 数据文件全落临时 data/，绝不碰真 data/。WAKE_SCHEDULER_SRC 可指定待测副本（拿修前备份验证「确实会空转」）。
const ROOT = path.join(__dirname, "..", "..");
const SRC = process.env.WAKE_SCHEDULER_SRC || path.join(ROOT, "lib", "wake-scheduler.js");
const TMP = fs.mkdtempSync("/tmp/wake-sched-test-");
for (const d of ["lib", "utils", "memory", "context", "mcp"]) { if (fs.existsSync(path.join(ROOT, d))) cp.execSync("cp -r " + JSON.stringify(path.join(ROOT, d)) + " " + JSON.stringify(TMP + "/")); }
fs.copyFileSync(SRC, path.join(TMP, "lib", "wake-scheduler.js"));
fs.mkdirSync(path.join(TMP, "workspace"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "workspace", "phone-tags.js"), path.join(TMP, "workspace", "phone-tags.js"));   // 2026-10-28：tag-parser/diary 现在共用这份注册表
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(TMP, "node_modules"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "timeline_data"), { recursive: true });
fs.mkdirSync(path.join(TMP, "config"), { recursive: true });
const SID = "s_test_wake";
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("闹钟唤醒跑着时反复 armTimedWake：不空转、不重复唤醒", async () => {
  fs.writeFileSync(path.join(TMP, "timeline_data", "enhanced_messages_" + SID + ".json"), JSON.stringify([{ role: "user", content: "hi", time: new Date(Date.now() - 3600e3).toISOString() }]));
  fs.writeFileSync(path.join(TMP, "data", "wake-event-sessions.json"), JSON.stringify([SID]));
  fs.writeFileSync(path.join(TMP, "data", "wake-alarms.json"), JSON.stringify({ version: 1, sessions: { [SID]: { alarms: [{ id: "wa_t1", at: new Date(Date.now() - 5000).toISOString(), repeat: "once" }] } } }));
  let calls = 0;
  const logs = [];
  const origLog = console.log;
  console.log = function () { logs.push(Array.prototype.join.call(arguments, " ")); };
  try {
    const sch = require(path.join(TMP, "lib", "wake-scheduler.js"))({
      baseDir: TMP, readEnvValue: () => "", touchHeartbeat() {}, sendPushNotification: async () => ({ ok: true }),
      applyWakeEventV2: () => ({ ok: true }), wakeDeps: {}, activeGenMap: new Map(), ACTIVE_GEN_TTL_MS: 600000,
      runWakeCompletion: async () => { calls++; await sleep(600); return { text: "[NO_ACTION]", toolHistory: [], wakeBlockId: null }; }
    });
    sch.armTimedWake();                       // 过期分支：补触发一次
    for (let i = 0; i < 300; i++) { sch.armTimedWake(); if (i % 30 === 0) await sleep(20); }   // 模拟周期检查/文件感知/收尾反复重挂
    await sleep(1800);                        // 等第一次唤醒结束 + 可能的二次唤醒
    const catchups = logs.filter(l => l.indexOf("补触发唤醒") >= 0).length;
    console.log = origLog;
    assert.equal(calls, 1, "只该唤醒一次，实际 " + calls);
    assert.ok(catchups <= 2, "补触发日志不该空转，实际 " + catchups + " 条");
    const left = JSON.parse(fs.readFileSync(path.join(TMP, "data", "wake-alarms.json"), "utf-8"));
    assert.ok(!left.sessions || !left.sessions[SID], "once 闹钟唤醒成功后应已消费");
  } finally { console.log = origLog; }
});


test("describeNext：没锁定没闹钟=null；锁定=睡眠；有未到点闹钟=闹钟与睡眠各列一条（各管各的）", async () => {
  const mk = () => require(path.join(TMP, "lib", "wake-scheduler.js"))({
    baseDir: TMP, readEnvValue: () => "", touchHeartbeat() {}, sendPushNotification: async () => ({ ok: true }),
    applyWakeEventV2: () => ({ ok: true }), wakeDeps: {}, activeGenMap: new Map(), ACTIVE_GEN_TTL_MS: 600000, runWakeCompletion: async () => ({ text: "" })
  });
  const sch = mk();
  fs.writeFileSync(path.join(TMP, "data", "wake-event-sessions.json"), "[]");
  fs.writeFileSync(path.join(TMP, "data", "wake-alarms.json"), JSON.stringify({ version: 1, sessions: {} }));
  let r = sch.describeNext();
  assert.equal(r.next, null); assert.equal(r.locked, 0);
  fs.writeFileSync(path.join(TMP, "data", "wake-event-sessions.json"), JSON.stringify([SID]));
  // 2026-11-09 睡眠唤醒：上一条用例唤醒成功后「这条发言已了结」，要等她再发言才重新计时 → 清周期状态并让最后发言落在 10 分钟前
  fs.rmSync(path.join(TMP, "data", "wake_cycle.json"), { force: true });
  fs.writeFileSync(path.join(TMP, "timeline_data", "enhanced_messages_" + SID + ".json"), JSON.stringify([{ role: "user", content: "hi", time: new Date(Date.now() - 600e3).toISOString() }]));
  const sch2 = mk();
  r = sch2.describeNext();
  assert.equal(r.locked, 1); assert.equal(r.next && r.next.kind, "cycle"); assert.equal(r.next.thr, 120); assert.equal(r.next.segment, "睡眠");
  const at = new Date(Date.now() + 3600e3).toISOString();
  fs.writeFileSync(path.join(TMP, "data", "wake-alarms.json"), JSON.stringify({ version: 1, sessions: { [SID]: { alarms: [{ id: "wa_n1", at: at, repeat: "daily", label: "看火" }] } } }));
  r = sch2.describeNext();
  assert.equal(r.items.length, 2, "2026-11-10 起闹钟与睡眠唤醒各管各的：闹钟一条 + 睡眠一条");
  assert.equal(r.next.kind, "alarm"); assert.equal(r.next.label, "看火"); assert.equal(r.next.repeat, "daily");
  assert.ok(r.items.some(x => x.kind === "cycle" && x.thr === 120), "睡眠项仍在");
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} setTimeout(() => process.exit(0), 50); });
