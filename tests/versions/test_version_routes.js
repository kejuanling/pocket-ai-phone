// routes/chat.js 的版本接口（GET versions / POST version/switch / POST version/delete）+ 删消息/删会话清理：fastify inject + 临时目录 + 桩依赖。
// node tests/versions/test_version_routes.js   不碰线上数据（baseDir 是临时目录；context-replacements 读的是真数据目录，但只读且会话 id 是测试专用）
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const fastify = require(path.join(REPO, "node_modules", "fastify"));
const tv = require(path.join(REPO, "lib", "timeline-versions"));

const base = fs.mkdtempSync(path.join(os.tmpdir(), "vr-"));
fs.mkdirSync(path.join(base, "timeline_data"), { recursive: true });
const SID = "s_vtest_routes";
const HDR = { "x-client": "dylan-chat", "content-type": "application/json" };
const M = (id, role, content, pos) => ({ id, role, content, position: pos, time: "2026-11-10T00:00:00Z" });
const tlFile = (sid) => path.join(base, "timeline_data", "enhanced_messages_" + sid + ".json");

let tl = [];
const snapCalls = [];
const deps = new Proxy({
  baseDir: base,
  loadTimeline: (sid) => (sid === SID ? tl.map((m) => Object.assign({}, m)) : []),
  saveTimeline: (m, sid) => { if (sid === SID) { tl = m.map((x) => Object.assign({}, x)); fs.writeFileSync(tlFile(sid), "[]"); } return true; },
  timelineFileFor: (sid) => tlFile(sid),
  sseNotify: () => {}, markSessionDeleted: () => {},
  handleSnapshotAfterTailCut: (sid, t, idx) => { snapCalls.push(idx); },
  readSessionArchive: () => [],
}, { get: (o, k) => (k in o ? o[k] : function () { return undefined; }) });

function seed() {
  tl = [M("u1", "user", "你好", 1), M("a1", "assistant", "嗨", 2), M("u2", "user", "讲个故事", 3), M("a2", "assistant", "故事三", 4)];
  const store = {};
  tv.archive(store, "u2", { content: "讲个故事", tail: [M("a2_v1", "assistant", "故事一", 4)] });
  tv.archive(store, "u2", { content: "讲个故事", tail: [M("a2_v2", "assistant", "故事二", 4)] });   // 3 槽，当前第 3 个
  tv.save(base, SID, store);
}

(async () => {
  const app = fastify();
  require(path.join(REPO, "routes", "chat.js"))(app, deps);
  await app.ready();
  const call = (method, url, payload, headers) => app.inject({ method, url, payload: payload ? JSON.stringify(payload) : undefined, headers: headers || HDR });
  let n = 0; const ok = (name) => { n++; console.log("ok  " + name); };

  seed();
  let r = await call("GET", "/v1/timeline/versions?session_id=" + SID);
  assert.deepStrictEqual(r.json().versions, { u2: { count: 3, cur: 2 } }); ok("GET 摘要：u2 共 3 个、当前第 3 个");
  r = await call("GET", "/v1/timeline/versions?session_id=../x"); assert.strictEqual(r.statusCode, 400); ok("GET 非法会话 id → 400");
  r = await call("GET", "/v1/timeline/versions?session_id=s_none"); assert.deepStrictEqual(r.json().versions, {}); ok("GET 没有版本 → 空表");

  r = await call("POST", "/v1/timeline/version/switch", { session_id: SID, anchor_id: "u2", index: 0 }, { "content-type": "application/json" });
  assert.strictEqual(r.statusCode, 403); ok("切换不带 x-client → 403");
  r = await call("POST", "/v1/timeline/version/switch", { session_id: SID, anchor_id: "u2", index: 9 });
  assert.strictEqual(r.statusCode, 400); assert.strictEqual(tl.length, 4); ok("切换越界 index → 400，时间线不动");
  r = await call("POST", "/v1/timeline/version/switch", { session_id: SID, anchor_id: "a1", index: 0 });
  assert.strictEqual(r.statusCode, 404); ok("锚点不是用户消息 → 404");

  r = await call("POST", "/v1/timeline/version/switch", { session_id: SID, anchor_id: "u2", index: 0 });
  assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual({ c: r.json().count, cur: r.json().cur }, { c: 3, cur: 0 });
  assert.deepStrictEqual(tl.map((m) => m.id), ["u1", "a1", "u2", "a2_v1"]);
  assert.deepStrictEqual(snapCalls, [2]); ok("切到第 1 个：整段尾巴换成 a2_v1，快照按锚点下标 2 处理");
  r = await call("POST", "/v1/timeline/version/switch", { session_id: SID, anchor_id: "u2", index: 2 });
  assert.deepStrictEqual(tl.map((m) => m.id), ["u1", "a1", "u2", "a2"]); ok("再切回第 3 个：原来的 a2 回来了");

  // 删非当前版本（删第 1 个）：时间线不动
  const before = JSON.stringify(tl);
  r = await call("POST", "/v1/timeline/version/delete", { session_id: SID, anchor_id: "u2", index: 0 });
  assert.strictEqual(r.statusCode, 200); assert.deepStrictEqual({ c: r.json().count, cur: r.json().cur }, { c: 2, cur: 1 });
  assert.strictEqual(JSON.stringify(tl), before); ok("删非当前版本：时间线原样，版本数 3→2，cur 随之前移");
  // 删当前版本（现在 cur=1，共 2 个）：先切到相邻再删，只剩一个 → 回收
  r = await call("POST", "/v1/timeline/version/delete", { session_id: SID, anchor_id: "u2", index: 1 });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(tl.map((m) => m.id), ["u1", "a1", "u2", "a2_v2"]);
  assert.deepStrictEqual(tv.load(base, SID), {}); assert.ok(!fs.existsSync(tv.fileOf(base, SID))); ok("删当前版本：切到相邻版本的内容，只剩一个就把整条存档回收（文件也删了）");

  // 删锚点消息 → 版本跟着清
  seed();
  r = await call("POST", "/v1/timeline/sync", { session_id: SID, ops: [{ op: "delete", id: "a1" }] });
  assert.ok(r.json().ok); assert.ok(tv.load(base, SID).u2); ok("删的不是锚点：版本保留");
  r = await call("POST", "/v1/timeline/sync", { session_id: SID, ops: [{ op: "delete", id: "u2" }] });
  assert.ok(r.json().ok, JSON.stringify(r.json())); assert.deepStrictEqual(tv.load(base, SID), {}); ok("删锚点用户消息：它名下的版本一起清掉");

  // 删会话 → 版本文件删
  seed(); fs.writeFileSync(tlFile(SID), "[]");
  r = await call("DELETE", "/v1/sessions/" + SID, null, {});
  assert.ok(r.json().deleted, JSON.stringify(r.json())); assert.ok(!fs.existsSync(tv.fileOf(base, SID))); ok("删会话：版本存档文件一起删");

  await app.close(); fs.rmSync(base, { recursive: true, force: true });
  console.log("全部通过：" + n + " 项（未覆盖：生成中拒绝切换 409、压缩块拒绝——依赖 chat.js 内部状态，靠重启后真机验证）");
})().catch((e) => { console.error("失败:", e); try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
