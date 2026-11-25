const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// 影子目录隔离（2026-10-26 单测纪律）：模块内 FILE_PATH 基于 __dirname，把模块复制进临时目录再
// require，读写自动落在临时 data/ 下——绝不碰真 data/wake-alarms.json（gateway 进程正在读它）。
// lib/ 与 data/ 都要建：真环境 data/ 恒存在，锁文件与数据文件都落在里面。
// 用 WAKE_ALARMS_SRC 可指定待测副本（上线前预检用），缺省测 lib/ 真身。
const SRC = process.env.WAKE_ALARMS_SRC || path.join(__dirname, "..", "..", "lib", "wake-alarms.js");
const TMP = fs.mkdtempSync("/tmp/wake-alarms-test-");
fs.mkdirSync(path.join(TMP, "lib"), { recursive: true });
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
fs.copyFileSync(SRC, path.join(TMP, "lib", "wake-alarms.js"));
const wa = require(path.join(TMP, "lib", "wake-alarms.js"));
const DATA_FILE = path.join(TMP, "data", "wake-alarms.json");
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("nextAlarmAtFor 只看本会话，返回最早一条；无闹钟会话返回 null", () => {
  const now = Date.now();
  assert.equal(wa.setAlarm("A", { at: new Date(now + 3600e3).toISOString() }).ok, true);
  assert.equal(wa.setAlarm("A", { at: new Date(now + 600e3).toISOString() }).ok, true);
  assert.equal(wa.setAlarm("B", { at: new Date(now + 60e3).toISOString() }).ok, true);
  const a = wa.nextAlarmAtFor("A");
  assert.ok(a && Math.abs(a.getTime() - (now + 600e3)) < 2000, "A 的最早应是 +10min 那条");
  assert.equal(wa.nextAlarmAtFor("C"), null, "无闹钟会话应为 null");
});

test("advanceDueAlarmsFor 按会话推进：只动该会话到点 once，别的会话原样保留（重复响修复）", async () => {
  const now = Date.now();
  // setAlarm 拒绝 now+2s 内的时间 → 设 now+2100，等 150ms 后进入到点窗（t <= now+grace2000）
  assert.equal(wa.setAlarm("A2", { at: new Date(now + 2100).toISOString() }).ok, true);
  assert.equal(wa.setAlarm("B2", { at: new Date(now + 2100).toISOString() }).ok, true);
  await sleep(150);
  const r = wa.advanceDueAlarmsFor("A2");
  assert.equal(r.ok, true);
  assert.equal(r.once_removed, 1);
  assert.equal(wa.listAlarms("A2").length, 0, "A2 的 once 应已删");
  assert.equal(wa.listAlarms("B2").length, 1, "B2 未推进应保留（此前整轮收尾的缺陷即在此）");
  const r2 = wa.advanceDueAlarmsFor("B2");
  assert.equal(r2.once_removed, 1);
  assert.equal(wa.listAlarms("B2").length, 0);
});

test("daily 到点推到未来且只留一条：多天漏触发一次推到位", () => {
  // 3 天前再早 1 秒（负偏移）：推 4 档后落在 now+1d-1s，既越过 grace 又在一天之内
  const t = Date.now() - 3 * 86400e3 - 1000;
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, sessions: { D: { alarms: [{ id: "d1", at: new Date(t).toISOString(), repeat: "daily" }] } } }));
  const r = wa.advanceDueAlarmsFor("D");
  assert.equal(r.daily_advanced, 1);
  assert.equal(r.once_removed, 0);
  const alarms = wa.listAlarms("D");
  assert.equal(alarms.length, 1, "推完只留一条");
  const at = new Date(alarms[0].at).getTime();
  assert.ok(at > Date.now() + 2000, "应推到未来（超过 grace）");
  assert.ok(at - Date.now() < 86400e3, "且在一天之内");
});

test("整轮 advanceDueAlarms 重构回归：到点 once 删、未来闹钟与到点计数正确", () => {
  const now = Date.now();
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, sessions: {
    E: { alarms: [
      { id: "e1", at: new Date(now - 5000).toISOString(), repeat: "once" },
      { id: "e2", at: new Date(now + 86400e3).toISOString(), repeat: "once" }
    ] },
    F: { alarms: [{ id: "f1", at: new Date(now - 5000).toISOString(), repeat: "once" }] }
  } }));
  const r = wa.advanceDueAlarms();
  assert.equal(r.ok, true);
  assert.equal(r.once_removed, 2);
  assert.equal(r.daily_advanced, 0);
  const e = wa.listAlarms("E");
  assert.equal(e.length, 1, "E 只剩未来的 e2");
  assert.equal(e[0].id, "e2");
  assert.equal(wa.listAlarms("F").length, 0, "F 的到点 once 已删");
});

test("未到点 no-op：advanceDueAlarmsFor 对未来闹钟零改动", () => {
  const now = Date.now();
  assert.equal(wa.setAlarm("G", { at: new Date(now + 3600e3).toISOString() }).ok, true);
  const r = wa.advanceDueAlarmsFor("G");
  assert.equal(r.ok, true);
  assert.equal(r.once_removed, 0);
  assert.equal(r.daily_advanced, 0);
  assert.equal(wa.listAlarms("G").length, 1, "未来闹钟不应被动");
});

test("nextAlarmAt（全局）回归：不受重构影响", () => {
  const now = Date.now();
  assert.equal(wa.setAlarm("H", { at: new Date(now + 3600e3).toISOString() }).ok, true);
  assert.equal(wa.setAlarm("I", { at: new Date(now + 120e3).toISOString() }).ok, true);
  const g = wa.nextAlarmAt();
  assert.ok(g && Math.abs(g.getTime() - (now + 120e3)) < 2000, "全局最早应是 I 的 +2min");
});
