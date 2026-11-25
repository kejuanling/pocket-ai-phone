const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// 2026-11-09 路由层：闹钟新增/编辑（她自己设）与 /v1/sleep-wake 的输入校验。
// 影子目录：把 lib/routes/utils 整份拷进临时目录再 require，数据全落临时 data/，绝不碰真 data/。
const ROOT = path.join(__dirname, "..", "..");
const TMP = fs.mkdtempSync("/tmp/sw-routes-test-");
for (const d of ["lib", "routes", "utils"]) { if (fs.existsSync(path.join(ROOT, d))) cp.execSync("cp -r " + JSON.stringify(path.join(ROOT, d)) + " " + JSON.stringify(TMP + "/")); }
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(TMP, "node_modules"));
fs.mkdirSync(path.join(TMP, "data"), { recursive: true });
const Fastify = require(path.join(TMP, "node_modules", "fastify"));

let armed = 0;
async function mkApp(authOk) {
  const app = Fastify();
  const basicAuth = async (req, reply) => { if (!authOk) { reply.code(401).send({ error: "unauth" }); } };
  const deps = { basicAuth, wakeScheduler: { armTimedWake() { armed++; } } };
  require(path.join(TMP, "routes", "session-status.js"))(app, deps);
  require(path.join(TMP, "routes", "wake-subs.js"))(app, deps);
  await app.ready();
  return app;
}
const future = ms => new Date(Date.now() + ms).toISOString();
const post = (app, url, payload) => app.inject({ method: "POST", url, payload });

test("add：合法请求落库为 by=user，并重挂定时器；缺 session_id / 非法 sid / 过去时间 / 非法 repeat / note 非文字 一律 400", async () => {
  const app = await mkApp(true);
  const before = armed;
  const ok = await post(app, "/admin/wake-alarms/add", { session_id: "s_a", at: future(3600e3), repeat: "daily", note: " 带伞 " });
  assert.equal(ok.statusCode, 200);
  const j = ok.json(); assert.equal(j.ok, true); assert.equal(j.alarm.by, "user"); assert.equal(j.alarm.note, "带伞"); assert.equal(j.alarm.repeat, "daily");
  assert.ok(armed > before, "新增后要重挂精确定时器");
  const bad = [
    { at: future(3600e3) },
    { session_id: "../etc", at: future(3600e3) },
    { session_id: "s_a b", at: future(3600e3) },
    { session_id: "s_a", at: new Date(Date.now() - 5000).toISOString() },
    { session_id: "s_a", at: "不是时间" },
    { session_id: "s_a", at: future(3600e3), repeat: "weekly" },
    { session_id: "s_a", at: future(3600e3), note: 123 }
  ];
  for (const b of bad) assert.equal((await post(app, "/admin/wake-alarms/add", b)).statusCode, 400, JSON.stringify(b));
  await app.close();
});

test("add：每会话最多 10 个，第 11 个 400", async () => {
  const app = await mkApp(true);
  for (let i = 0; i < 9; i++) await post(app, "/admin/wake-alarms/add", { session_id: "s_full", at: future((i + 1) * 3600e3) });
  assert.equal((await post(app, "/admin/wake-alarms/add", { session_id: "s_full", at: future(30e6) })).statusCode, 200);
  assert.equal((await post(app, "/admin/wake-alarms/add", { session_id: "s_full", at: future(40e6) })).statusCode, 400);
  await app.close();
});

test("update：只能改她自己设的；改 AI 设的 / 不存在的 / 过去时间 400；清空备注生效", async () => {
  const app = await mkApp(true);
  const mine = (await post(app, "/admin/wake-alarms/add", { session_id: "s_u", at: future(3600e3), note: "原备注" })).json().alarm;
  const alarms = require(path.join(TMP, "lib", "wake-alarms.js"));
  const ai = alarms.setAlarm("s_u", { at: future(7200e3), label: "ai的" }).alarm;
  assert.equal((await post(app, "/admin/wake-alarms/update", { session_id: "s_u", alarm_id: ai.id, note: "改" })).statusCode, 400);
  assert.equal((await post(app, "/admin/wake-alarms/update", { session_id: "s_u", alarm_id: "wa_nope", note: "x" })).statusCode, 400);
  assert.equal((await post(app, "/admin/wake-alarms/update", { session_id: "s_u", alarm_id: mine.id, at: new Date(Date.now() - 9000).toISOString() })).statusCode, 400);
  const r = await post(app, "/admin/wake-alarms/update", { session_id: "s_u", alarm_id: mine.id, repeat: "once", note: "" });
  assert.equal(r.statusCode, 200); assert.equal(r.json().alarm.repeat, "once"); assert.equal(r.json().alarm.note, undefined);
  await app.close();
});

test("鉴权：add/update 没登录 401（走 basicAuth）", async () => {
  const app = await mkApp(false);
  assert.equal((await post(app, "/admin/wake-alarms/add", { session_id: "s_a", at: future(3600e3) })).statusCode, 401);
  assert.equal((await post(app, "/admin/wake-alarms/update", { session_id: "s_a", alarm_id: "x" })).statusCode, 401);
  await app.close();
});

test("/v1/sleep-wake：GET 默认值；POST 只改传来的字段、越界被收敛；类型不对 400；改完重挂定时器", async () => {
  const app = await mkApp(true);
  const g = (await app.inject({ method: "GET", url: "/v1/sleep-wake" })).json();
  assert.deepEqual(g.config, { enabled: true, afterMin: 120, userAlarmQuietMin: 60, note: "" });
  const before = armed;
  const r = (await post(app, "/v1/sleep-wake", { afterMin: 90, enabled: false })).json();
  assert.equal(r.config.afterMin, 90); assert.equal(r.config.enabled, false);
  assert.ok(armed > before);
  assert.equal((await post(app, "/v1/sleep-wake", { afterMin: 3 })).json().config.afterMin, 120, "越界回默认");
  for (const b of [{ afterMin: "abc" }, { enabled: "yes" }, { note: 5 }]) assert.equal((await post(app, "/v1/sleep-wake", b)).statusCode, 400, JSON.stringify(b));
  const n = (await post(app, "/v1/sleep-wake", { note: "晚安".repeat(400) })).json().config.note;
  assert.equal(n.length, 500);
  await app.close();
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} setTimeout(() => process.exit(0), 50); });

test("/admin/wake-alarms/add|update：prob 1~100 才收，落库带 prob；100 清掉", async () => {
  const app = await mkApp(true);
  const future = ms => new Date(Date.now() + ms).toISOString();
  const ok = (await post(app, "/admin/wake-alarms/add", { session_id: "s_p", at: future(3600e3), prob: 40 })).json();
  assert.equal(ok.alarm.prob, 40);
  for (const prob of [0, 101, "abc"]) assert.equal((await post(app, "/admin/wake-alarms/add", { session_id: "s_p", at: future(3600e3), prob })).statusCode, 400, "prob=" + prob);
  const up = (await post(app, "/admin/wake-alarms/update", { session_id: "s_p", alarm_id: ok.alarm.id, prob: 100 })).json();
  assert.equal(up.alarm.prob, undefined);
  await app.close();
});

test("/v1/location-wake：GET 默认 30/5 + 无问题；POST 只收 1~1440 整数；问题说明从状态文件读出", async () => {
  const app = await mkApp(true);
  const g = (await app.inject({ method: "GET", url: "/v1/location-wake" })).json();
  assert.deepEqual(g.config, { enabled: true, cooldownMin: 30, maxGapMin: 5 }); assert.equal(g.problem, null);
  const r = (await post(app, "/v1/location-wake", { cooldownMin: 45 })).json();
  assert.equal(r.config.cooldownMin, 45);
  for (const b of [{ cooldownMin: 0 }, { cooldownMin: 1441 }, { cooldownMin: "abc" }, { cooldownMin: 3.5 }, {}]) assert.equal((await post(app, "/v1/location-wake", b)).statusCode, 400, JSON.stringify(b));
  fs.writeFileSync(path.join(TMP, "data", "location-detect-state.json"), JSON.stringify({ problem: { msg: "读不到查岗数据（HTTP 500）", at: 1 } }));
  assert.equal((await app.inject({ method: "GET", url: "/v1/location-wake" })).json().problem.msg, "读不到查岗数据（HTTP 500）");
  await app.close();
});
