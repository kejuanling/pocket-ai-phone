"use strict";
/* [位置:tests/session-misc/test_session_misc.js] [会话杂项六个 PUT 的入参校验] [11-15：唤醒名单两处（wake-locked / wake-event-sessions）原来「sessions 缺失或不是数组就落成 []」再整表覆盖回 saved:true；
   五个映射接口（session-names / session-prompts / session-archive / session-pins / session-branches）在新旧两路都没命中时把读出来的旧表原样写回还回 saved:true（技术债池 10-27 那条，当时真丢过会话名）。
   这批用例验三件事：①认不出的 body 一律 400 且盘上一个字节都不变；②正常格式（新格式 + 旧格式）仍是 200 且 count 对（前端依赖 count）；③分支 set 里的垃圾值不再被当成删除。
   隔离：真起 fastify + 真注册 routes/session-misc，deps 全指临时 baseDir，不碰线上 data/。
   两处必须说明的替身：lib/session-archive.js 的路径写死在项目根，所以归档读写按它同款实现、只把目标路径换成临时文件（路由逻辑仍是真代码）；
   事件唤醒名单靠 deps.wakeEventFile 口子指到临时文件。线上 data 七个文件每个请求后都校一遍字节，变了立刻按快照还原并判红（负向验证跑旧代码时全靠这道护栏，见下方注释）] [注释时间 2026-11-15] */
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const Fastify = require("fastify");

const ROOT = path.join(__dirname, "..", "..");
const { writeJsonAtomic } = require(path.join(ROOT, "utils", "json_atomic.js"));
const { createSessionCfg } = require(path.join(ROOT, "lib", "session-cfg.js"));
const registerSessionMisc = require(path.join(ROOT, "routes", "session-misc.js"));

const REAL_NAMES = ["session-names", "session-prompts", "session-archive", "session-pins", "wake-locked", "wake-event-sessions", "session-branches"]
  .map((f) => path.join(ROOT, "data", f + ".json"));
function md5(p) { try { return crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex"); } catch (_) { return null; } }
const realBefore = REAL_NAMES.map(md5);

/* [位置:tests/session-misc/test_session_misc.js·护栏] [负向验证时护住线上数据] [11-15 实测教训：把旧版 routes/session-misc.js 换回来跑这批用例时，旧代码不认 deps.wakeEventFile，
   事件名单会落到写死的 lib/wake-subs.js·EVSESS（= 线上 data/wake-event-sessions.json），负向验证把自己验出事故来（当场按凌晨备份还原，md5 一致）。
   所以这里每个请求后都比一遍七个线上文件的字节：变了就立刻按快照写回（含 atime/mtime）并抛错，用例照样红、线上不被留在坏状态] [注释时间 2026-11-15] */
const realSnap = REAL_NAMES.map((p) => {
  try { return { bytes: fs.readFileSync(p), stat: fs.statSync(p) }; } catch (_) { return null; }
});
function assertRealIntact() {
  for (let i = 0; i < REAL_NAMES.length; i++) {
    const snap = realSnap[i];
    if (!snap) continue;
    const now = fs.readFileSync(REAL_NAMES[i]);
    if (Buffer.compare(now, snap.bytes) === 0) continue;
    fs.writeFileSync(REAL_NAMES[i], snap.bytes);                                  // 先还原再抛
    try { fs.utimesSync(REAL_NAMES[i], snap.stat.atime, snap.stat.mtime); } catch (_) {}
    throw new Error("线上 " + path.basename(REAL_NAMES[i]) + " 被这次请求改动了（已按快照还原）——说明被测代码没走 deps.wakeEventFile 注入");
  }
}

const TMPROOT = fs.mkdtempSync(path.join(os.tmpdir(), "sessmisc-ut-"));
const boots = [];

function boot() {
  const d = fs.mkdtempSync(path.join(TMPROOT, "b-"));
  fs.ensureDirSync(path.join(d, "data"));
  const files = {
    names: path.join(d, "data", "session-names.json"),
    prompts: path.join(d, "data", "session-prompts.json"),
    archive: path.join(d, "data", "session-archive.json"),
    pins: path.join(d, "data", "session-pins.json"),
    wakeLocked: path.join(d, "data", "wake-locked.json"),
    wakeEvent: path.join(d, "data", "wake-event-sessions.json"),
    branches: path.join(d, "data", "session-branches.json"),
  };
  // lib/session-archive.js 同款读写，只是把目标路径换成临时文件（线上那份路径写死在项目根，注入不了）
  const readArchive = function () {
    try {
      if (fs.existsSync(files.archive)) {
        const v = JSON.parse(fs.readFileSync(files.archive, "utf-8")) || [];
        if (Array.isArray(v)) return v.filter(function (s) { return typeof s === "string" && s; });
      }
    } catch (e) { console.warn("[test-session-misc] archive 读失败（与线上同口径返回 []）:", e.message || e); }
    return [];
  };
  const writeArchive = function (list) {
    try { fs.ensureDirSync(path.dirname(files.archive)); fs.writeFileSync(files.archive, JSON.stringify(list, null, 2), "utf-8"); }
    catch (e) { console.error("[test-session-misc] archive 写失败（与线上同口径吞掉）:", e.message || e); }
  };
  const app = Fastify({ logger: false });
  registerSessionMisc(app, {
    basicAuth: async () => {},
    subagentRunner: { detail: () => ({ ok: true }), statusAll: () => [], stop: () => ({ ok: true }) },
    writeJsonFileAtomic: writeJsonAtomic,
    sessionCfg: createSessionCfg(d),
    baseDir: d,
    SESSION_NAMES_FILE: files.names,
    readSessionArchive: readArchive,
    writeSessionArchive: writeArchive,
    wakeEventFile: files.wakeEvent,
  });
  const ctx = { d, app, files };
  boots.push(ctx);
  return ctx;
}

function seed(file, data) { fs.ensureDirSync(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8"); }
function bytes(file) { try { return fs.readFileSync(file, "utf-8"); } catch (_) { return null; } }
function disk(file) { return JSON.parse(fs.readFileSync(file, "utf-8")); }
async function put(app, url, payload) {
  const res = await app.inject({ method: "PUT", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  assertRealIntact();   // 每个请求后立刻校一遍线上数据（见上方护栏注释）
  return res;
}

const cases = [];
const c = (name, fn) => cases.push([name, fn]);

/* ============ 一、唤醒名单两处：缺 sessions / 形状不对 → 400，字节不变 ============ */
const WAKE = [
  { url: "/admin/wake-locked", key: "wakeLocked", label: "wake-locked" },
  { url: "/admin/wake-event-sessions", key: "wakeEvent", label: "wake-event-sessions" },
];
for (const w of WAKE) {
  c("PUT " + w.url + " 不带 sessions → 400 sessions_required，名单一个字节不变", async () => {
    const { app, files } = boot();
    seed(files[w.key], ["s_mv5m2v01_1jjxuo"]);
    const before = bytes(files[w.key]);
    const res = await put(app, w.url, {});
    assert.strictEqual(res.statusCode, 400, "不带 sessions 必须报错，body=" + res.body);
    assert.strictEqual(JSON.parse(res.body).code, "sessions_required");
    assert.strictEqual(bytes(files[w.key]), before, "盘上一个字节都不能变");
  });

  c("PUT " + w.url + " sessions 是 null / 字符串 / 对象 → 400，名单不变", async () => {
    const { app, files } = boot();
    const seedList = ["s_mv5m2v01_1jjxuo"];
    for (const payload of [{ sessions: null }, { sessions: "s_mv5m2v01_1jjxuo" }, { sessions: { a: 1 } }, { foo: 1 }]) {
      seed(files[w.key], seedList);
      const before = bytes(files[w.key]);
      const res = await put(app, w.url, payload);
      assert.strictEqual(res.statusCode, 400, JSON.stringify(payload) + " 必须报错，body=" + res.body);
      assert.strictEqual(JSON.parse(res.body).code, "sessions_required", JSON.stringify(payload));
      assert.strictEqual(bytes(files[w.key]), before, JSON.stringify(payload) + " 不能写盘");
    }
  });

  c("PUT " + w.url + " sessions 里有非字符串项 → 400 bad_sessions，名单不变", async () => {
    const { app, files } = boot();
    seed(files[w.key], ["s_mv5m2v01_1jjxuo"]);
    const before = bytes(files[w.key]);
    const res = await put(app, w.url, { sessions: [{ id: "s_x" }] });
    assert.strictEqual(res.statusCode, 400, "元素类型不对必须报错，body=" + res.body);
    assert.strictEqual(JSON.parse(res.body).code, "bad_sessions");
    assert.ok(String(JSON.parse(res.body).error).includes("第 1 项"), "错误里要说清第几项：" + JSON.parse(res.body).error);
    assert.strictEqual(bytes(files[w.key]), before, "不能写盘");
  });

  c("PUT " + w.url + " 正常 {sessions:[...]} → 200 count 对、盘上一致；空数组仍可显式清空", async () => {
    const { app, files } = boot();
    seed(files[w.key], ["s_old"]);
    const res = await put(app, w.url, { sessions: ["s_a", "s_b"] });
    assert.strictEqual(res.statusCode, 200, res.body);
    const j = JSON.parse(res.body);
    assert.deepStrictEqual({ ok: j.ok, saved: j.saved, count: j.count }, { ok: true, saved: true, count: 2 }, "成功返回结构不能动（前端依赖 count）");
    assert.deepStrictEqual(disk(files[w.key]), ["s_a", "s_b"], "整表覆盖语义照旧");
    const res2 = await put(app, w.url, { sessions: [] });
    assert.strictEqual(res2.statusCode, 200, "显式空数组是她主动取消全部勾选，不能拦");
    assert.strictEqual(JSON.parse(res2.body).count, 0);
    assert.deepStrictEqual(disk(files[w.key]), []);
  });
}

/* ============ 二、五个映射接口：正常格式 200 计数对 / 认不出 400 且字节不变 ============ */
c("PUT /admin/session-names：新格式 set、新格式 unset、旧格式整表都 200 且 count 对", async () => {
  const { app, files } = boot();
  seed(files.names, { s_a: "名A" });
  const r1 = await put(app, "/admin/session-names", { set: { s_b: "名B" } });
  assert.strictEqual(r1.statusCode, 200, r1.body);
  assert.strictEqual(JSON.parse(r1.body).count, 2, "按键合并：原有 s_a 不能被覆盖掉");
  const r2 = await put(app, "/admin/session-names", { unset: ["s_a"] });
  assert.strictEqual(r2.statusCode, 200, r2.body);
  assert.strictEqual(JSON.parse(r2.body).count, 1);
  const r3 = await put(app, "/admin/session-names", { names: { s_c: "名C" } });
  assert.strictEqual(r3.statusCode, 200, r3.body);
  assert.strictEqual(JSON.parse(r3.body).count, 1, "旧格式是整表覆盖，count = 1");
  assert.deepStrictEqual(disk(files.names), { s_c: "名C" });
});

c("PUT /admin/session-names：认不出的 body（含 10-27 那种裸键值）→ 400 bad_body，会话名一字不丢", async () => {
  const { app, files } = boot();
  for (const payload of [{ s_mv5m2v01_1jjxuo: "裸键值格式" }, {}, { set: [] }, { names: "不是对象" }, null]) {
    seed(files.names, { s_mv5m2v01_1jjxuo: "会话名不许丢" });
    const before = bytes(files.names);
    const res = await put(app, "/admin/session-names", payload);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(payload) + " 必须报错，body=" + res.body);
    assert.strictEqual(JSON.parse(res.body).code, "bad_body", JSON.stringify(payload));
    assert.strictEqual(bytes(files.names), before, JSON.stringify(payload) + " 不能写盘");
  }
});

c("PUT /admin/session-prompts：新格式 / 旧格式 200 计数对；认不出 → 400 且字节不变", async () => {
  const { app, files } = boot();
  seed(files.prompts, { s_a: "pb_1" });
  const r1 = await put(app, "/admin/session-prompts", { set: { s_b: "pb_2" }, unset: [] });
  assert.strictEqual(r1.statusCode, 200, r1.body);
  assert.strictEqual(JSON.parse(r1.body).count, 2);
  const r2 = await put(app, "/admin/session-prompts", { set: {}, unset: ["s_a"] });
  assert.strictEqual(r2.statusCode, 200, "前端「设定换回默认」就发 {set:{},unset:[sid]}，不能拦");
  assert.strictEqual(JSON.parse(r2.body).count, 1);
  const r3 = await put(app, "/admin/session-prompts", { prompts: { s_c: "pb_3" } });
  assert.strictEqual(r3.statusCode, 200, r3.body);
  assert.strictEqual(JSON.parse(r3.body).count, 1);
  for (const payload of [{ s_a: "pb_9" }, {}, { set: "x" }]) {
    const before = bytes(files.prompts);
    const res = await put(app, "/admin/session-prompts", payload);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(payload) + " 必须报错，body=" + res.body);
    assert.strictEqual(bytes(files.prompts), before, JSON.stringify(payload) + " 不能写盘");
  }
});

c("PUT /admin/session-archive：add/remove 与旧格式 archived 都 200 计数对；认不出 → 400 且字节不变", async () => {
  const { app, files } = boot();
  seed(files.archive, ["s_a"]);
  const r1 = await put(app, "/admin/session-archive", { add: ["s_b", "s_c"] });
  assert.strictEqual(r1.statusCode, 200, r1.body);
  assert.strictEqual(JSON.parse(r1.body).count, 3);
  const r2 = await put(app, "/admin/session-archive", { remove: ["s_a"] });
  assert.strictEqual(r2.statusCode, 200, r2.body);
  assert.strictEqual(JSON.parse(r2.body).count, 2);
  const r3 = await put(app, "/admin/session-archive", { archived: ["s_d"] });
  assert.strictEqual(r3.statusCode, 200, r3.body);
  assert.strictEqual(JSON.parse(r3.body).count, 1);
  assert.deepStrictEqual(disk(files.archive), ["s_d"]);
  for (const payload of [{ s_a: true }, {}, { add: "s_a" }]) {
    const before = bytes(files.archive);
    const res = await put(app, "/admin/session-archive", payload);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(payload) + " 必须报错，body=" + res.body);
    assert.strictEqual(bytes(files.archive), before, JSON.stringify(payload) + " 不能写盘");
  }
});

c("PUT /admin/session-pins：add/remove 与旧格式 pins 都 200 计数对；认不出 → 400 且字节不变", async () => {
  const { app, files } = boot();
  seed(files.pins, ["s_a"]);
  const r1 = await put(app, "/admin/session-pins", { add: ["s_b"] });
  assert.strictEqual(r1.statusCode, 200, r1.body);
  assert.strictEqual(JSON.parse(r1.body).count, 2);
  const r2 = await put(app, "/admin/session-pins", { remove: ["s_a"] });
  assert.strictEqual(r2.statusCode, 200, r2.body);
  assert.strictEqual(JSON.parse(r2.body).count, 1);
  const r3 = await put(app, "/admin/session-pins", { pins: ["s_c", "s_d"] });
  assert.strictEqual(r3.statusCode, 200, r3.body);
  assert.strictEqual(JSON.parse(r3.body).count, 2);
  for (const payload of [{ s_a: true }, {}, { pins: { a: 1 } }]) {
    const before = bytes(files.pins);
    const res = await put(app, "/admin/session-pins", payload);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(payload) + " 必须报错，body=" + res.body);
    assert.strictEqual(bytes(files.pins), before, JSON.stringify(payload) + " 不能写盘");
  }
});

c("PUT /admin/session-branches：set/unset、旧格式 branches 都 200 计数对；认不出 → 400 且字节不变", async () => {
  const { app, files } = boot();
  const legacy = { s_child_old: { fromSession: "s_parent_old", fromIndex: 4, createdAt: "2026-10-01T00:00:00Z" } };
  seed(files.branches, legacy);
  const r1 = await put(app, "/admin/session-branches", { set: { s_child_a: { fromSession: "s_parent_a", fromIndex: 2 } } });
  assert.strictEqual(r1.statusCode, 200, r1.body);
  assert.strictEqual(JSON.parse(r1.body).count, 2);
  const r2 = await put(app, "/admin/session-branches", { unset: ["s_child_old"] });
  assert.strictEqual(r2.statusCode, 200, r2.body);
  assert.strictEqual(JSON.parse(r2.body).count, 1);
  const r3 = await put(app, "/admin/session-branches", { branches: { s_child_b: { fromSession: "s_parent_b", fromIndex: 1 } } });
  assert.strictEqual(r3.statusCode, 200, r3.body);
  assert.strictEqual(JSON.parse(r3.body).count, 1, "旧格式整表覆盖");
  for (const payload of [{ s_child_a: "x" }, {}, { set: [] }]) {
    const before = bytes(files.branches);
    const res = await put(app, "/admin/session-branches", payload);
    assert.strictEqual(res.statusCode, 400, JSON.stringify(payload) + " 必须报错，body=" + res.body);
    assert.strictEqual(bytes(files.branches), before, JSON.stringify(payload) + " 不能写盘");
  }
});

/* ============ 三、分支 set 分支的「值不对」待遇（11-15 改动点，单独盯） ============ */
c("分支 set 里发垃圾值（字符串/数字/数组）不再删原登记，只跳过；显式 null 仍按取消分支", async () => {
  const { app, files } = boot();
  seed(files.branches, { s_child_x: { fromSession: "s_parent_x", fromIndex: 5, createdAt: "2026-10-01T00:00:00Z" } });
  for (const junk of ["垃圾", 0, true, []]) {
    const res = await put(app, "/admin/session-branches", { set: { s_child_x: junk } });
    assert.strictEqual(res.statusCode, 200, "形状不对的单个值不该整批报错，body=" + res.body);
    const j = JSON.parse(res.body);
    assert.strictEqual(j.count, 1, "登记不能被垃圾值顺手删掉（发的是 " + JSON.stringify(junk) + "）");
    assert.strictEqual(disk(files.branches).s_child_x.fromSession, "s_parent_x", "原登记必须原样保留");
  }
  const resNull = await put(app, "/admin/session-branches", { set: { s_child_x: null } });
  assert.strictEqual(resNull.statusCode, 200, resNull.body);
  assert.strictEqual(JSON.parse(resNull.body).count, 0, "显式 null = 取消分支（旧端的删除表达，行为保留）");
  assert.deepStrictEqual(disk(files.branches), {});
});

/* ============ 收尾 ============ */
(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of cases) {
    try { await fn(); pass++; console.log("PASS " + name); }
    catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e && e.message || e)); }
  }
  for (const ctx of boots) { try { await ctx.app.close(); } catch (_) {} }
  // 线上数据一个字节都不能动（多一道保险：注入错误时这里会红）
  for (let i = 0; i < REAL_NAMES.length; i++) {
    const now = md5(REAL_NAMES[i]);
    if (now !== realBefore[i]) { fail++; console.log("FAIL 线上 " + path.basename(REAL_NAMES[i]) + " 被改动了（测试没隔离干净）"); }
  }
  if (!fail) { try { fs.removeSync(TMPROOT); } catch (_) {} }
  console.log("\ntest_session_misc: " + pass + " passed, " + fail + " failed（共 " + cases.length + " 例）；临时目录保留：" + TMPROOT);
  process.exit(fail ? 1 : 0);
})();
