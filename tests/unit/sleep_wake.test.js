const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// 2026-11-09 睡眠唤醒 + 用户闹钟：影子目录隔离（同 wake_user_time_gate.test.js 的纪律），数据文件全落临时 data/，绝不碰真 data/。
const ROOT = path.join(__dirname, "..", "..");
const TMP = fs.mkdtempSync("/tmp/sleep-wake-test-");
for (const d of ["lib", "utils", "memory", "context", "mcp"]) { if (fs.existsSync(path.join(ROOT, d))) cp.execSync("cp -r " + JSON.stringify(path.join(ROOT, d)) + " " + JSON.stringify(TMP + "/")); }
fs.mkdirSync(path.join(TMP, "workspace"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "workspace", "phone-tags.js"), path.join(TMP, "workspace", "phone-tags.js"));
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(TMP, "node_modules"));
for (const d of ["data", "timeline_data", "config"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
const SCHED = path.join(TMP, "lib", "wake-scheduler.js");
const ALARMS = require(path.join(TMP, "lib", "wake-alarms.js"));
const CFG = require(path.join(TMP, "lib", "sleep-wake-config.js"));
const dpath = n => path.join(TMP, "data", n);
const writeJson = (rel, o) => fs.writeFileSync(path.join(TMP, rel), JSON.stringify(o));
const readJson = rel => JSON.parse(fs.readFileSync(path.join(TMP, rel), "utf8"));
const ago = min => new Date(Date.now() - min * 60000).toISOString();
let n = 0;
function mkSession(userMinAgo, locked) {
  const sid = "s_sw_" + (++n);
  writeJson("timeline_data/enhanced_messages_" + sid + ".json", [{ role: "user", content: "hi", time: ago(userMinAgo) }, { role: "assistant", content: "嗯", time: ago(userMinAgo - 1) }]);
  const cur = fs.existsSync(dpath("wake-event-sessions.json")) ? readJson("data/wake-event-sessions.json") : [];
  if (locked) writeJson("data/wake-event-sessions.json", cur.concat(sid)); else if (!fs.existsSync(dpath("wake-event-sessions.json"))) writeJson("data/wake-event-sessions.json", []);
  return sid;
}
function mkSch() {
  const calls = [];
  const sch = require(SCHED)({
    baseDir: TMP, readEnvValue: () => "", touchHeartbeat() {}, sendPushNotification: async () => ({ ok: true }),
    applyWakeEventV2: () => ({ ok: true }), wakeDeps: {}, activeGenMap: new Map(), ACTIVE_GEN_TTL_MS: 600000,
    runWakeCompletion: async (deps, o) => { calls.push(o); return { text: "[NO_ACTION]", toolHistory: [], wakeBlockId: null }; }
  });
  return { sch, calls };
}
const quiet = async fn => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
test.beforeEach(() => { for (const f of ["wake_cycle.json", "sleep-wake.json", "wake-alarms.json", "wake-event-sessions.json", "wake_schedule.json"]) fs.rmSync(dpath(f), { force: true }); });

test("配置：默认值、逐项校验、坏文件按默认；旧文件里的概率字段被丢掉", () => {
  assert.deepEqual(CFG.read(), { enabled: true, afterMin: 120, userAlarmQuietMin: 60, note: "" });
  const c = CFG.write({ afterMin: 5, userAlarmQuietMin: -3, enabled: "no", note: "x".repeat(900), probOn: true, probPct: 30, evil: 1 });
  assert.equal(c.afterMin, 120); assert.equal(c.userAlarmQuietMin, 60); assert.equal(c.enabled, true); assert.equal(c.note.length, 500); assert.ok(!("evil" in c)); assert.ok(!("probOn" in c) && !("probPct" in c));
  assert.equal(CFG.write({ afterMin: 90, enabled: false }).enabled, false);
  assert.equal(CFG.read().afterMin, 90);
  fs.writeFileSync(dpath("sleep-wake.json"), "{坏");
  assert.equal(CFG.read().afterMin, 120); assert.equal(CFG.read().enabled, true);
});

test("睡眠唤醒：停满 120 分钟叫一次，之后她不说话就不再叫", async () => {
  const sid = mkSession(180, true);
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].wake_tail, "这次是因为她好像睡着了。");
  await quiet(() => sch.runNow());
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 1, "醒过一次后不该再叫，实际 " + calls.length);
  assert.ok(readJson("data/wake_cycle.json").sessions[sid]);
});

test("睡眠唤醒：没停满不叫；未开睡眠唤醒的会话不叫", async () => {
  mkSession(60, true);
  mkSession(300, false);
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 0);
});

test("睡眠唤醒：阈值读设置（改成 30 分钟，45 分钟前的发言就够了）", async () => {
  CFG.write({ afterMin: 30 });
  mkSession(45, true);
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 1);
});

test("睡眠唤醒：她再发言后重新计时", async () => {
  const sid = mkSession(180, true);
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 1);
  writeJson("timeline_data/enhanced_messages_" + sid + ".json", [{ role: "user", content: "我回来了", time: ago(1) }]);
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 1, "刚发言不够 120 分钟");
  writeJson("timeline_data/enhanced_messages_" + sid + ".json", [{ role: "user", content: "我回来了", time: ago(1) }]);
  const lw = readJson("data/wake_cycle.json"); lw.sessions[sid] = ago(200); writeJson("data/wake_cycle.json", lw);   // 模拟又过了几小时
  const t = new Date(Date.now() - 125 * 60000).toISOString();
  writeJson("timeline_data/enhanced_messages_" + sid + ".json", [{ role: "user", content: "我回来了", time: t }]);
  const m2 = mkSch();
  await quiet(() => m2.sch.runNow());
  assert.equal(m2.calls.length, 1, "新发言停满 120 分钟又该叫一次");
});

test("总开关：关了不叫（名单保留），重新打开又叫；闹钟照响", async () => {
  CFG.write({ enabled: false });
  const sid = mkSession(180, true);
  const m1 = mkSch();
  await quiet(() => m1.sch.runNow());
  assert.equal(m1.calls.length, 0, "总开关关着不该睡眠唤醒");
  assert.equal(m1.sch.describeNext().items.filter(i => i.kind === "cycle").length, 0, "关着时 /v1/wake-next 不列睡眠唤醒");
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid]: { alarms: [{ id: "ai1", at: new Date(Date.now() - 1000).toISOString(), repeat: "once", label: "看火" }] } } });
  await quiet(() => m1.sch.runNow());
  assert.equal(m1.calls.length, 1, "关睡眠唤醒不影响闹钟");
  CFG.write({ enabled: true });
  fs.rmSync(dpath("wake_cycle.json"), { force: true });
  const m2 = mkSch();
  await quiet(() => m2.sch.runNow());
  assert.equal(m2.calls.length, 1, "重新打开后该叫就叫");
});

test("闹钟概率：没中这一轮不响（每天的推到明天、一次性的作废）；命中才响且排队重试不重掷；AI 闹钟不掷", async () => {
  const sid = mkSession(300, false);
  const due = new Date(Date.now() - 1000).toISOString();
  const alarms = [
    { id: "u_daily", at: due, repeat: "daily", by: "user", prob: 30 },
    { id: "u_once", at: due, repeat: "once", by: "user", prob: 30 }
  ];
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid]: { alarms } } });
  const orig = Math.random;
  try {
    Math.random = () => 0.9;   // 掷出 90，30% 没中
    const m1 = mkSch();
    await quiet(() => m1.sch.runNow());
    assert.equal(m1.calls.length, 0);
    const left = readJson("data/wake-alarms.json").sessions[sid].alarms;
    assert.equal(left.length, 1); assert.equal(left[0].id, "u_daily");
    assert.ok(new Date(left[0].at).getTime() > Date.now() + 23 * 3600e3);
    // 命中：直接用接口验证，掷过的标记保证第二次不重掷
    writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid]: { alarms: [{ id: "u_hit", at: due, repeat: "once", by: "user", prob: 30 }] } } });
    let r = ALARMS.rollDueUserAlarms(sid, 2000, () => 10);
    assert.deepEqual(r, { missed: 0, hit: 1 });
    r = ALARMS.rollDueUserAlarms(sid, 2000, () => 99);
    assert.deepEqual(r, { missed: 0, hit: 0 }, "掷过的这一轮不再重掷");
    // 不带概率的她的闹钟、AI 的闹钟、没到点的：都不掷
    writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid]: { alarms: [
      { id: "u_plain", at: due, repeat: "once", by: "user" },
      { id: "ai_p", at: due, repeat: "once", prob: 30 },
      { id: "u_future", at: new Date(Date.now() + 3600e3).toISOString(), repeat: "once", by: "user", prob: 30 }
    ] } } });
    assert.deepEqual(ALARMS.rollDueUserAlarms(sid, 2000, () => 99), { missed: 0, hit: 0 });
    assert.equal(readJson("data/wake-alarms.json").sessions[sid].alarms.length, 3);
  } finally { Math.random = orig; }
});

test("闹钟概率：新增/编辑校验（1~99 存，100/空清掉；AI 设的不收 prob；改时间作废旧掷骰）", () => {
  const sid = "s_prob";
  const at = new Date(Date.now() + 3600e3).toISOString();
  const a = ALARMS.setAlarm(sid, { at, by: "user", prob: 40 }).alarm;
  assert.equal(a.prob, 40);
  assert.equal(ALARMS.setAlarm(sid, { at, by: "user", prob: 100 }).alarm.prob, undefined);
  assert.equal(ALARMS.setAlarm(sid, { at, prob: 40 }).alarm.prob, undefined, "AI 设的不带概率");
  assert.equal(ALARMS.updateAlarm(sid, a.id, { prob: 70 }).alarm.prob, 70);
  assert.equal(ALARMS.updateAlarm(sid, a.id, { prob: null }).alarm.prob, undefined);
});

test("睡眠唤醒追加文字：设置页那段话跟在提示词末尾", async () => {
  CFG.write({ note: "晚安，别熬夜。" });
  mkSession(200, true);
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.match(calls[0].wake_tail, /晚安，别熬夜。/);
});

test("用户闹钟：到点前她刚聊过 → 这一轮不响，每天的推到明天、一次性的作废；AI 闹钟不受影响", async () => {
  const sid = mkSession(10, false);
  const due = new Date(Date.now() - 1000).toISOString();
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid]: { alarms: [
    { id: "u_daily", at: due, repeat: "daily", by: "user", note: "起床" },
    { id: "u_once", at: due, repeat: "once", by: "user" }
  ] } } });
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 0);
  const left = readJson("data/wake-alarms.json").sessions[sid].alarms;
  assert.equal(left.length, 1); assert.equal(left[0].id, "u_daily");
  assert.ok(new Date(left[0].at).getTime() > Date.now() + 23 * 3600e3, "每天闹钟应推到明天");

  const sid2 = mkSession(10, false);
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid2]: { alarms: [{ id: "ai1", at: due, repeat: "once", label: "看火" }] } } });
  const m2 = mkSch();
  await quiet(() => m2.sch.runNow());
  assert.equal(m2.calls.length, 1, "AI 设的闹钟她发言不影响");
  assert.match(m2.calls[0].wake_tail, /你设的闹钟「看火」/);
});

test("用户闹钟：她很久没聊 → 照响，提示词带她留的附言；作废窗口设 0 则永不作废", async () => {
  const sid = mkSession(300, false);
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid]: { alarms: [{ id: "u1", at: new Date(Date.now() - 1000).toISOString(), repeat: "daily", by: "user", note: "今天要去图书馆" }] } } });
  const { sch, calls } = mkSch();
  await quiet(() => sch.runNow());
  assert.equal(calls.length, 1);
  assert.match(calls[0].wake_tail, /她设的闹钟到点了/);
  assert.match(calls[0].wake_tail, /她留的话：「今天要去图书馆」/);
  assert.ok(new Date(readJson("data/wake-alarms.json").sessions[sid].alarms[0].at).getTime() > Date.now(), "每天闹钟响完推到明天");

  CFG.write({ userAlarmQuietMin: 0 });
  const sid2 = mkSession(2, false);
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid2]: { alarms: [{ id: "u2", at: new Date(Date.now() - 1000).toISOString(), repeat: "once", by: "user" }] } } });
  const m2 = mkSch();
  await quiet(() => m2.sch.runNow());
  assert.equal(m2.calls.length, 1);
});

test("睡眠唤醒不被未到点的闹钟挡住（2026-11-10 各管各的）：她自己设的、他设的、旧 <wake> 槽都不让位，且闹钟/槽原样保留", async () => {
  const far = () => new Date(Date.now() + 5 * 3600e3).toISOString();
  const sid1 = mkSession(200, true);
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid1]: { alarms: [{ id: "u_far", at: far(), repeat: "daily", by: "user" }] } } });
  const a = mkSch();
  await quiet(() => a.sch.runNow());
  assert.equal(a.calls.length, 1, "她自己设的未到点闹钟不挡");

  const sid2 = mkSession(200, true);
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [sid2]: { alarms: [{ id: "ai_far", at: far(), repeat: "once" }] } } });
  const b = mkSch();
  await quiet(() => b.sch.runNow());
  assert.equal(b.calls.length, 1, "他设的未到点闹钟也不挡");
  assert.equal(readJson("data/wake-alarms.json").sessions[sid2].alarms.length, 1, "他的闹钟原样保留，到点另叫");

  const sid3 = mkSession(200, true);
  writeJson("data/wake_schedule.json", { version: 2, sessions: { [sid3]: { next_wake_at: far(), updated_at: ago(100) } } });
  const c = mkSch();
  await quiet(() => c.sch.runNow());
  assert.equal(c.calls.length, 1, "旧 <wake> 槽未到点也不挡");
  assert.ok(readJson("data/wake_schedule.json").sessions[sid3], "槽保留，到点另叫");
});

test("闹钟存储：by/note 落库、只有 user 闹钟可编辑、note 截 500、skip 只动 user", () => {
  const sid = "s_store";
  const at = new Date(Date.now() + 3600e3).toISOString();
  const u = ALARMS.setAlarm(sid, { at, repeat: "daily", by: "user", note: "  备注  " });
  const a = ALARMS.setAlarm(sid, { at, repeat: "once", label: "ai的" });
  assert.equal(u.alarm.by, "user"); assert.equal(u.alarm.note, "备注"); assert.ok(!a.alarm.by);
  assert.equal(ALARMS.updateAlarm(sid, a.alarm_id, { note: "改" }).ok, false);
  const at2 = new Date(Date.now() + 7200e3).toISOString();
  const r = ALARMS.updateAlarm(sid, u.alarm_id, { at: at2, repeat: "once", note: "x".repeat(800) });
  assert.equal(r.ok, true); assert.equal(r.alarm.at, at2); assert.equal(r.alarm.repeat, "once"); assert.equal(r.alarm.note.length, 500);
  assert.equal(ALARMS.updateAlarm(sid, u.alarm_id, { note: "" }).alarm.note, undefined);
  assert.equal(ALARMS.updateAlarm(sid, u.alarm_id, { at: new Date(Date.now() - 1000).toISOString() }).ok, false);
  assert.equal(ALARMS.updateAlarm(sid, "nope", {}).ok, false);
  assert.equal(ALARMS.skipDueUserAlarms(sid), 0, "未到点不动");
  assert.equal(ALARMS.nextAlarmAtFor(sid).toISOString(), at, "该会话最早的一个（她改到更晚后，最早的是他的）");
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} setTimeout(() => process.exit(0), 50); });
