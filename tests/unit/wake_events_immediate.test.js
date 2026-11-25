const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// 2026-11-10：事件唤醒去掉 5 分钟合并窗口——事件一来立刻叫；
// 叫醒进行中同类事件又来 → 不并发叫、记一笔，叫完补叫一次（连发多条最多两次）；不同事件各自独立。
// 全部用临时目录和假的 fire，不碰真 data/。
const ROOT = path.join(__dirname, "..", "..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dirs = [];
function mk(fire, subs) {
  const base = fs.mkdtempSync("/tmp/wake-events-imm-");
  dirs.push(base);
  fs.mkdirSync(path.join(base, "data"), { recursive: true });
  const ev = require(path.join(ROOT, "lib", "wake-events.js"))({
    baseDir: base, retryMs: 50, log() {},
    wakeSubs: { KEYS: ["mood", "album", "location"], subscribers: () => (subs === undefined ? ["s_a"] : subs) },
    fire
  });
  return { ev, base };
}

test("事件一来立刻叫：不等窗口", async () => {
  const calls = [];
  const { ev } = mk(async k => { calls.push(k); return { status: "ok" }; });
  const r = ev.notify("mood");
  assert.equal(r.armed, true);
  await sleep(60);
  assert.deepEqual(calls, ["mood"]);
  assert.deepEqual(ev.pending(), [], "叫完不留待办");
});

test("叫醒进行中同类事件连来多条：不并发叫，叫完只补叫一次（共 2 次，不是 N 次）", async () => {
  const calls = [];
  let release;
  const { ev } = mk(async k => { calls.push(k); if (calls.length === 1) await new Promise(r => { release = r; }); return { status: "ok" }; });
  ev.notify("mood");
  await sleep(40);
  assert.equal(calls.length, 1);
  assert.equal(ev.notify("mood").merged, true);
  ev.notify("mood"); ev.notify("mood");
  await sleep(40);
  assert.equal(calls.length, 1, "第一次还没叫完，不能并发再叫");
  release();
  await sleep(100);
  assert.equal(calls.length, 2, "叫完后补叫一次");
  await sleep(100);
  assert.equal(calls.length, 2, "补叫之后不再有");
  assert.deepEqual(ev.pending(), []);
});

test("叫醒期间没有新事件 → 不补叫", async () => {
  const calls = [];
  const { ev } = mk(async k => { calls.push(k); await sleep(30); return { status: "ok" }; });
  ev.notify("album");
  await sleep(200);
  assert.equal(calls.length, 1);
});

test("不同事件各自独立、各叫一次", async () => {
  const calls = [];
  const { ev } = mk(async k => { calls.push(k); return { status: "ok" }; });
  ev.notify("mood"); ev.notify("album");
  await sleep(80);
  assert.deepEqual(calls.sort(), ["album", "mood"]);
});

test("没人订阅的事件直接丢；非法 key 返回错误", async () => {
  const calls = [];
  const { ev } = mk(async k => { calls.push(k); return { status: "ok" }; }, []);
  assert.equal(ev.notify("mood").ignored, "no subscriber");
  assert.equal(ev.notify("nope").ok, false);
  await sleep(60);
  assert.deepEqual(calls, []);
});

test("会话正忙（skip）→ 隔一会儿重试，成功即止", async () => {
  const calls = [];
  const { ev } = mk(async k => { calls.push(k); return { status: calls.length === 1 ? "skip" : "ok" }; });
  ev.notify("location");
  await sleep(250);
  assert.equal(calls.length, 2);
  assert.deepEqual(ev.pending(), []);
});

test("待叫状态落盘，叫完清空", async () => {
  let release;
  const { ev, base } = mk(async () => { await new Promise(r => { release = r; }); return { status: "ok" }; });
  ev.notify("mood");
  await sleep(40);
  const f = path.join(base, "data", "wake-events.json");
  assert.ok(JSON.parse(fs.readFileSync(f, "utf8")).mood, "叫醒进行中应在盘上有记录（重启可接着叫）");
  release();
  await sleep(80);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), {});
});

test.after(() => { dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }); setTimeout(() => process.exit(0), 50); });
