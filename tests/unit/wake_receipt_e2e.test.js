const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// 唤醒回执只报失败 · 整条链路（2026-11-11 拍板）：真跑 lib/wake-scheduler.js 的唤醒流程，
// 看最后交给 applyWakeEventV2 落时间线的 event（= developer 回执）是什么。
// 影子目录隔离（同 wake_user_time_gate.test.js 的纪律）：代码整份拷进临时目录再 require，数据全落临时 data/，绝不碰真 data/。
// 运行：node --test tests/unit/wake_receipt_e2e.test.js
const ROOT = path.join(__dirname, "..", "..");
const TMP = fs.mkdtempSync("/tmp/wake-receipt-e2e-");
for (const d of ["lib", "utils", "memory", "context", "mcp"]) { if (fs.existsSync(path.join(ROOT, d))) cp.execSync("cp -r " + JSON.stringify(path.join(ROOT, d)) + " " + JSON.stringify(TMP + "/")); }
fs.mkdirSync(path.join(TMP, "workspace"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "workspace", "phone-tags.js"), path.join(TMP, "workspace", "phone-tags.js"));
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(TMP, "node_modules"));
for (const d of ["data", "timeline_data", "config"]) fs.mkdirSync(path.join(TMP, d), { recursive: true });
const SID = "s_test_receipt";
const SCHED = path.join(TMP, "lib", "wake-scheduler.js");
function writeJson(rel, obj) { fs.writeFileSync(path.join(TMP, rel), JSON.stringify(obj)); }

// 用一只到点的一次性闹钟把唤醒叫起来，AI 回 aiText，返回落库入参
async function wakeWith(aiText, pushResult) {
  writeJson("timeline_data/enhanced_messages_" + SID + ".json", [{ role: "user", content: "在吗", time: new Date(Date.now() - 3600000).toISOString() }, { role: "assistant", content: "在", time: new Date(Date.now() - 3590000).toISOString() }]);
  writeJson("data/wake-event-sessions.json", []);
  try { fs.rmSync(path.join(TMP, "data", "wake_schedule.json"), { force: true }); } catch (e) {}
  writeJson("data/wake-alarms.json", { version: 1, sessions: { [SID]: { alarms: [{ id: "wa_r1", at: new Date(Date.now() - 5000).toISOString(), repeat: "once", label: "测试" }] } } });
  let saved = null; const pushed = [];
  const sch = require(SCHED)({
    baseDir: TMP, readEnvValue: () => "", touchHeartbeat() {},
    sendPushNotification: async (p) => { pushed.push(p); return pushResult || { ok: true, providerLabel: "WebPush" }; },
    applyWakeEventV2: (body) => { saved = body; return { ok: true }; },
    wakeDeps: { appendMessages() {} }, activeGenMap: new Map(), ACTIVE_GEN_TTL_MS: 600000,
    runWakeCompletion: async () => ({ text: aiText, toolHistory: [], wakeBlockId: null })
  });
  const st = await sch.runNow();
  assert.equal(st, "ok");
  return { saved, pushed };
}

test("没动作：AI 的回复照常落时间线，不再有回执", async () => {
  const { saved, pushed } = await wakeWith("<noaction>她睡着了，晚安是她先说的。别的不吵她。</noaction>");
  assert.ok(saved, "回复要落库");
  assert.match(saved.speak, /<noaction>她睡着了/);
  assert.equal(saved.event, undefined, "不该有回执：" + saved.event);
  assert.equal(pushed.length, 0);
});

test("推送成功：不再有回执，推送记录在 push 字段里", async () => {
  const { saved, pushed } = await wakeWith("<push>醒了吗</push>");
  assert.equal(pushed.length, 1);
  assert.equal(saved.event, undefined, "不该有回执：" + saved.event);
  assert.equal(saved.push.body, "醒了吗");
  assert.match(saved.push.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

test("没写 push 标签的普通回复：不再有「本次未推送」", async () => {
  const { saved } = await wakeWith("（看了一眼窗外，没什么要说的）");
  assert.equal(saved.event, undefined);
  assert.equal(saved.push, null);
});

test("推送失败：说一句", async () => {
  const { saved } = await wakeWith("<push>醒了吗</push>", { ok: false, providerLabel: "WebPush", reason: "订阅已失效" });
  assert.equal(saved.event, "发送失败：WebPush：订阅已失效");
  assert.equal(saved.push, null, "没发出去就不留推送记录");
});

test("<wake> 设成功：不再有回执，闹钟确实存上了", async () => {
  const { saved } = await wakeWith("<wake>30</wake>\n<noaction>等她下课。</noaction>");
  assert.equal(saved.event, undefined, "不该有回执：" + saved.event);
  const slot = fs.readFileSync(path.join(TMP, "data", "wake_schedule.json"), "utf-8");
  assert.ok(slot.indexOf(SID) >= 0, "旧槽里应有本会话的下次唤醒时间");
});

test("<wake> 时间已过 / 格式不对：说一句", async () => {
  let r = await wakeWith("<wake>2020-01-01 08:00</wake>\n<noaction>等她下课。</noaction>");
  assert.equal(r.saved.event, "唤醒设置失败：时间已过");
  r = await wakeWith("<wake>改天吧</wake>\n<noaction>等她下课。</noaction>");
  assert.equal(r.saved.event, "唤醒设置失败：时间格式无效");
});

test("日记：写成功不回执；标签写错说一句", async () => {
  let r = await wakeWith("[DIARY]今天她睡得很早。[/DIARY]\n<noaction>不吵她。</noaction>");
  assert.equal(r.saved.event, undefined, "不该有回执：" + r.saved.event);
  assert.ok(r.saved.diary, "日记照常落库");
  r = await wakeWith("[DIARY]今天她睡得很早。\n<noaction>不吵她。</noaction>");
  assert.equal(r.saved.event, "日记写入失败：标签解析错误");
});

test("多项失败：一条回执里用句号连起来", async () => {
  const { saved } = await wakeWith("<wake>2020-01-01 08:00</wake>\n<push>醒了吗</push>", { ok: false, providerLabel: "WebPush", reason: "订阅已失效" });
  assert.equal(saved.event, "发送失败：WebPush：订阅已失效。唤醒设置失败：时间已过");
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} setTimeout(() => process.exit(0), 50); });
