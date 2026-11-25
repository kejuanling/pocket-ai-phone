// server.js appendRequestMessages 步骤 0（重新生成 / 编辑后重新生成 的版本存档）真代码测试：
// 从 server.js 原文把函数抽出来，用内存时间线 + 桩依赖跑；版本文件写到临时目录。node tests/versions/test_append_regen.js
// 注意（init-order skill）：这是「抽函数」式测试，只验算法；语句顺序/提升类问题靠 node --check 与上线后的真请求验证。
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(REPO, "server.js"), "utf8");
const a = src.indexOf("function appendRequestMessages(");
const b = src.indexOf("// 2026-10-08 方案A：清尾（重生成截断/尾部对齐）后的 v2 快照处理。");
assert(a > 0 && b > a, "找不到 appendRequestMessages 的范围");
// 带上它依赖的同级纯函数（isToolNoteMessage / stripFrontendToolNote 都在 appendRequestMessages 之前），原文照抽不做桩
const pre = src.slice(src.lastIndexOf("function isToolNoteMessage(", a), a);
const fnSrc = pre + src.slice(a, b);

let n = 0;
function t(name, fn) { fn(); n++; console.log("ok  " + name); }

function harness(opts) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "arq-"));
  const state = { tl: opts.tl, saved: 0, snapCalls: [], saveOk: opts.saveOk !== false, ranges: opts.ranges || [] };
  const env = {
    loadTimeline: () => state.tl.map((m) => Object.assign({}, m)),
    saveTimeline: (m) => { if (!state.saveOk) return false; state.tl = m.map((x) => Object.assign({}, x)); state.saved++; return true; },
    cardCanon: (x) => x, normalizeContentToText: (c) => (typeof c === "string" ? c : JSON.stringify(c)),
    isSpecialEvent: () => false, unarchiveSession: () => {}, sseNotify: () => {},
    handleSnapshotAfterTailCut: (sid, tl, idx) => { state.snapCalls.push(idx); },
    contextReplacements: { locateEnabledRanges: () => state.ranges },
    resolveSessionSystemPrompt: undefined, sessionPromptBackupId: () => "", crypto: require("crypto"),
    require: (p) => require(p.startsWith("./") ? path.join(REPO, p) : p),
    __dirname: base, console: { log() {}, warn() {}, error() {} },
  };
  // handleSnapshotAfterTailCut 在 server.js 里是 appendRequestMessages 同级函数，这里用桩
  const fn = new Function(...Object.keys(env), fnSrc + "\nreturn appendRequestMessages;")(...Object.values(env));
  const tv = require(path.join(REPO, "lib", "timeline-versions"));
  return { run: (sid, req, o) => fn(sid, req, o), state, base, store: (sid) => tv.load(base, sid), clean: () => fs.rmSync(base, { recursive: true, force: true }) };
}
const M = (id, role, content, pos) => ({ id, role, content, position: pos, time: "2026-11-10T00:00:00Z" });
const baseTl = () => [M("u1", "user", "你好", 1), M("a1", "assistant", "嗨", 2), M("u2", "user", "讲个故事", 3), M("a2", "assistant", "故事一", 4), M("a2b", "assistant", "补充一", 5)];
const req = (content) => [M("u1", "user", "你好"), M("a1", "assistant", "嗨"), M("u2", "user", content || "讲个故事")];

t("重新生成：尾巴存成版本，时间线截到锚点", () => {
  const h = harness({ tl: baseTl() });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  assert.deepStrictEqual(h.state.tl.map((m) => m.id), ["u1", "a1", "u2"]);
  const e = h.store("s1").u2;
  assert.strictEqual(e.slots.length, 2); assert.strictEqual(e.cur, 1);
  assert.deepStrictEqual(e.slots[0].tail.map((m) => m.id), ["a2", "a2b"]);
  assert.strictEqual(e.slots[0].content, "讲个故事");
  assert.deepStrictEqual(h.state.snapCalls, [2]);
  h.clean();
});

t("同一次请求的第二次调用（MCP 写回）不重复存档", () => {
  const h = harness({ tl: baseTl() });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  assert.strictEqual(h.store("s1").u2.slots.length, 2);
  h.clean();
});

t("没带 regenVersion（失败重试）：照旧截断，但不存版本、不写版本文件", () => {
  const h = harness({ tl: baseTl() });
  h.run("s1", req(), { regenAnchorId: "u2" });
  assert.deepStrictEqual(h.state.tl.map((m) => m.id), ["u1", "a1", "u2"]);
  assert.ok(!fs.existsSync(path.join(h.base, "data", "timeline_versions")));
  h.clean();
});

t("编辑后重新生成：锚点换新内容；旧内容 + 旧尾巴在版本里；请求里带的新内容不会再追加一条", () => {
  const h = harness({ tl: baseTl() });
  h.run("s1", req("讲个恐怖故事"), { regenAnchorId: "u2", regenVersion: true, regenEdit: "讲个恐怖故事" });
  assert.deepStrictEqual(h.state.tl.map((m) => m.id), ["u1", "a1", "u2"]);
  assert.strictEqual(h.state.tl[2].content, "讲个恐怖故事");
  const e = h.store("s1").u2;
  assert.strictEqual(e.slots[0].content, "讲个故事");
  assert.deepStrictEqual(e.slots[0].tail.map((m) => m.id), ["a2", "a2b"]);
  assert.strictEqual(e.slots.length, 2);
  h.clean();
});

t("编辑后重新生成 + 重复调用（MCP 写回）：内容已是新的，不重复存", () => {
  const h = harness({ tl: baseTl() });
  const o = { regenAnchorId: "u2", regenVersion: true, regenEdit: "讲个恐怖故事" };
  h.run("s1", req("讲个恐怖故事"), o); h.run("s1", req("讲个恐怖故事"), o);
  assert.strictEqual(h.store("s1").u2.slots.length, 2);
  h.clean();
});

t("锚点是盘尾最后一条（没有尾巴）时编辑后重新生成：换内容、旧内容存成版本、快照按锚点处理", () => {
  const h = harness({ tl: baseTl().slice(0, 3) });
  h.run("s1", req("改一下"), { regenAnchorId: "u2", regenVersion: true, regenEdit: "改一下" });
  assert.strictEqual(h.state.tl[2].content, "改一下");
  const e = h.store("s1").u2;
  assert.strictEqual(e.slots.length, 2); assert.strictEqual(e.slots[0].content, "讲个故事"); assert.deepStrictEqual(e.slots[0].tail, []);
  assert.deepStrictEqual(h.state.snapCalls, [2]);
  h.clean();
});

t("尾巴为空且内容没变：什么都不做（不存版本）", () => {
  const h = harness({ tl: baseTl().slice(0, 3) });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true, regenEdit: "讲个故事" });
  assert.ok(!fs.existsSync(path.join(h.base, "data", "timeline_versions")));
  h.clean();
});

t("锚点之后有压缩块：照旧截断，但不存版本", () => {
  const h = harness({ tl: baseTl(), ranges: [{ s: 3, e: 4, hidden: false }] });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  assert.deepStrictEqual(h.state.tl.map((m) => m.id), ["u1", "a1", "u2"]);
  assert.ok(!fs.existsSync(path.join(h.base, "data", "timeline_versions")));
  h.clean();
});

t("时间线落盘被拒：不写版本文件", () => {
  const h = harness({ tl: baseTl(), saveOk: false });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  assert.ok(!fs.existsSync(path.join(h.base, "data", "timeline_versions")));
  h.clean();
});

t("锚点不是用户消息：忽略（不截断、不存版本）", () => {
  const h = harness({ tl: baseTl() });
  h.run("s1", baseTl(), { regenAnchorId: "a1", regenVersion: true, regenEdit: "x" });   // 请求带完整历史（尾是 assistant）：旧的「尾部对齐」也不会动盘
  assert.strictEqual(h.state.tl.length, 5);
  assert.strictEqual(h.state.tl[1].content, "嗨");
  assert.ok(!fs.existsSync(path.join(h.base, "data", "timeline_versions")));
  h.clean();
});

t("连续两次重新生成：第二次在第一次的新回复上再存，共 3 个版本、当前是第 3 个", () => {
  const h = harness({ tl: baseTl() });
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  h.state.tl.push(M("a2n", "assistant", "故事二", 6));   // 第一次重新生成的新回复
  h.run("s1", req(), { regenAnchorId: "u2", regenVersion: true });
  const e = h.store("s1").u2;
  assert.strictEqual(e.slots.length, 3); assert.strictEqual(e.cur, 2);
  assert.deepStrictEqual(e.slots[1].tail.map((m) => m.id), ["a2n"]);
  h.clean();
});

t("不带锚点的普通发送：版本文件不被碰", () => {
  const h = harness({ tl: baseTl().slice(0, 2) });
  h.run("s1", [...baseTl().slice(0, 2), M("u9", "user", "新问题")], {});
  assert.strictEqual(h.state.tl.length, 3);
  assert.ok(!fs.existsSync(path.join(h.base, "data", "timeline_versions")));
  h.clean();
});

console.log("全部通过：" + n + " 项");
