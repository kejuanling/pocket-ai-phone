"use strict";
// PUT /v1/prompt-backups 条数上限（11-15 健壮性）：超过 120 条必须明确报错、整表一个字节都不写。
// 真调用路由：起 fastify + registerChatRoutes（deps 用 Proxy 兜底，baseDir 指临时目录），不碰线上 data/。
const assert = require("assert");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const Fastify = require("fastify");
const registerChatRoutes = require("../../routes/chat");

const LIMIT = 120;

function boot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pb-limit-"));
  fs.ensureDirSync(path.join(d, "data"));
  const deps = new Proxy({ baseDir: d }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const app = Fastify({ logger: false });
  registerChatRoutes(app, deps);
  return { d, app, file: path.join(d, "data", "prompt-backups.json") };
}
function seed(file, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({ id: "pb_" + i, name: "人设" + i, grp: "", content: "正文" + i, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" });
  }
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), "utf-8");
  return arr;
}
function read(file) { return JSON.parse(fs.readFileSync(file, "utf-8")); }

const cases = [];
const c = (name, fn) => cases.push([name, fn]);

c("已满 120 条时新增第 121 条 → 400 拒绝，盘上原样 120 条且不含新条", async (ctx) => {
  const { d, app, file } = boot();
  seed(file, LIMIT);
  const res = await app.inject({ method: "PUT", url: "/v1/prompt-backups", payload: { upserts: [{ id: "pb_new", name: "新人设", content: "新正文" }], delIds: [] } });
  assert.strictEqual(res.statusCode, 400, "超限必须报错，body=" + res.body);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.code, "prompt_backups_limit");
  assert.strictEqual(body.limit, LIMIT);
  assert.strictEqual(body.count, LIMIT + 1);
  assert.ok(String(body.error).includes("120"), "错误里要说清上限：" + body.error);
  const onDisk = read(file);
  assert.strictEqual(onDisk.length, LIMIT, "不能写盘");
  assert.ok(!onDisk.some((x) => x.id === "pb_new"), "最新那条不能被静默丢掉后还回成功");
  await app.close(); fs.removeSync(d);
});

c("满 120 条时改已有的（总数不变）→ 200 正常保存", async (ctx) => {
  const { d, app, file } = boot();
  seed(file, LIMIT);
  const res = await app.inject({ method: "PUT", url: "/v1/prompt-backups", payload: { upserts: [{ id: "pb_5", name: "改名了", content: "新正文" }], delIds: [] } });
  assert.strictEqual(res.statusCode, 200, res.body);
  assert.strictEqual(JSON.parse(res.body).count, LIMIT);
  const onDisk = read(file);
  assert.strictEqual(onDisk.length, LIMIT);
  assert.strictEqual(onDisk.find((x) => x.id === "pb_5").name, "改名了", "改的那条要真的落到盘上");
  await app.close(); fs.removeSync(d);
});

c("119 条新增 1 条 → 200，正好到 120 条并包含新条", async (ctx) => {
  const { d, app, file } = boot();
  seed(file, LIMIT - 1);
  const res = await app.inject({ method: "PUT", url: "/v1/prompt-backups", payload: { upserts: [{ id: "pb_add", name: "补一条", content: "正文" }], delIds: [] } });
  assert.strictEqual(res.statusCode, 200, res.body);
  const onDisk = read(file);
  assert.strictEqual(onDisk.length, LIMIT);
  assert.ok(onDisk.some((x) => x.id === "pb_add"), "新增的那条必须在盘上");
  await app.close(); fs.removeSync(d);
});

c("删一条再补一条（120→119→120）→ 200", async (ctx) => {
  const { d, app, file } = boot();
  seed(file, LIMIT);
  const res = await app.inject({ method: "PUT", url: "/v1/prompt-backups", payload: { upserts: [{ id: "pb_swap", name: "换一条", content: "正文" }], delIds: ["pb_0"] } });
  assert.strictEqual(res.statusCode, 200, res.body);
  const onDisk = read(file);
  assert.strictEqual(onDisk.length, LIMIT);
  assert.ok(!onDisk.some((x) => x.id === "pb_0"), "删掉的不在了");
  assert.ok(onDisk.some((x) => x.id === "pb_swap"), "换上的在");
  await app.close(); fs.removeSync(d);
});

c("旧格式整表 121 条 → 400 拒绝，盘上仍是原来 120 条", async (ctx) => {
  const { d, app, file } = boot();
  const before = seed(file, LIMIT);
  const payload = { backups: before.concat([{ id: "pb_old_new", name: "整表新人设", content: "正文" }]), replace: true };
  const res = await app.inject({ method: "PUT", url: "/v1/prompt-backups", payload });
  assert.strictEqual(res.statusCode, 400, res.body);
  assert.strictEqual(JSON.parse(res.body).code, "prompt_backups_limit");
  assert.strictEqual(read(file).length, LIMIT, "整表也不能写进去");
  await app.close(); fs.removeSync(d);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of cases) {
    try { await fn(); pass++; console.log("PASS " + name); }
    catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e && e.message || e)); }
  }
  console.log("\ntest_prompt_backups: " + pass + " passed, " + fail + " failed（共 " + cases.length + " 例）");
  process.exit(fail ? 1 : 0);
})();
