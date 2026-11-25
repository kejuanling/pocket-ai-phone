// 命中页（随手记15）：mergeItems 合并去重 / trace-context 的 at 时间锚定 / logRecallHit 落盘
// 不写真数据：jsonl 写进 os.tmpdir 临时目录，时间线用内存假数据。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

const recallHits = require("../../routes/recall-hits");
const traceNotes = require("../../routes/trace-notes");
const runtime = require("../../context/context-v2-runtime");

ok("srcOf：trace:/album: 前缀分类，其余是记忆池", () => {
  assert.strictEqual(recallHits.srcOf("trace:tn_abc"), "trace");
  assert.strictEqual(recallHits.srcOf("album:42"), "album");
  assert.strictEqual(recallHits.srcOf("mp_c1adc6b5e428"), "memory");
  assert.strictEqual(recallHits.srcOf(""), "memory");
});

const hooks = [
  { ts: "2026-11-14T03:00:40Z", session: "s1", mode: "inject", query: "她问酱菜", hits: [{ id: "trace:tn_1", src: "trace", score: 4.5, head: "她提到「酱菜」。你记得 2026-11-10 写过的此刻…" }] },
  { ts: "2026-11-14T04:00:00Z", session: "s1", mode: "preview", query: "早点吃什么", hits: [{ id: "mp_a", score: 2, head: "记忆A" }] },
];
const floats = [
  { sid: "s1", msg_id: "fm1", float_id: "trace:tn_1", time: "2026-11-14T03:00:41Z", text: "浮现1", query: "她问酱菜" },
  { sid: "s2", msg_id: "fm2", float_id: "mp_b", time: "2026-11-14T02:00:00Z", text: "旧浮现", query: "旧问题" },
  { sid: "s1", msg_id: "fm3", float_id: "mp_c", time: "2026-11-14T09:00:00Z", text: "晚上的", query: "" },
];

ok("mergeItems：inject 钩子吞掉 ±2min 同 float_id 的浮现条，挂 anchor_msg_id", () => {
  const r = recallHits.mergeItems(hooks, floats, { s1: "日常" }, 50);
  assert.strictEqual(r.total, 4, "fm1 被吞，剩 hook1/hook2/fm2/fm3");
  const h1 = r.items.find(x => x.ts === "2026-11-14T03:00:40Z");
  assert.strictEqual(h1.anchor_msg_id, "fm1");
  assert.strictEqual(h1.kind, "hook");
  assert.strictEqual(r.items.find(x => x.id === "f:fm1"), undefined, "fm1 不能再独立出现");
});
ok("mergeItems：preview 不吞浮现，独立浮现保留为 kind=float", () => {
  const r = recallHits.mergeItems(hooks, floats, null, 50);
  assert.strictEqual(r.items.find(x => x.id === "h:2026-11-14T04:00:00Z:s1:preview").mode, "preview");
  const fm2 = r.items.find(x => x.id === "f:fm2");
  assert.strictEqual(fm2.kind, "float");
  assert.strictEqual(fm2.hits[0].src, "memory");
});
ok("mergeItems：倒序 + before 过滤 + limit 截取 + 会话名映射", () => {
  const r = recallHits.mergeItems(hooks, floats, { s1: "日常" }, 2, "2026-11-14T05:00:00Z");
  assert.strictEqual(r.total, 3, "before 05:00 之后只剩 hook2/hook1/fm2");
  assert.deepStrictEqual(r.items.map(x => x.ts), ["2026-11-14T04:00:00Z", "2026-11-14T03:00:40Z"]);
  assert.strictEqual(r.items[0].session_name, "日常");
  assert.strictEqual(r.items[1].session_name, "日常");
  assert.strictEqual(r.items[0].hits[0].score, 2);
});

/* ---- trace-context 的 at 时间锚定 ---- */
const tl = [
  { id: "u1", role: "user", time: "2026-11-14T03:00:00Z", content: "问题一" },
  { id: "a1", role: "assistant", time: "2026-11-14T03:00:30Z", content: "答一" },
  { id: "d1", role: "developer", float_id: "mp_x", hidden: true, time: "2026-11-14T03:00:35Z", content: "浮现条" },
  { id: "u2", role: "user", time: "2026-11-14T03:05:00Z", content: "问题二" },
  { id: "a2", role: "assistant", time: "2026-11-14T03:05:30Z", content: "答二" },
  { id: "x1", role: "user", deleted: true, time: "2026-11-14T03:06:00Z", content: "删掉的不算" },
];
const deps = {
  loadTimeline: () => tl,
  isRealMessageForTimeline: (m) => m.role === "user" || m.role === "assistant",
  normalizeContentToText: (c) => (typeof c === "string" ? c : ""),
};

ok("at 锚定：锚到 ≤ at 的最后一条真实消息，developer/删除不进窗口", () => {
  const r = traceNotes.buildContext(deps, "s1", "", 1, "2026-11-14T03:04:00Z");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.total, 3, "a1(hit) + u1 + u2，d1/x1 不算");
  const hit = r.messages.filter(m => m.hit);
  assert.strictEqual(hit.length, 1);
  assert.strictEqual(hit[0].msg_id, "a1", "03:04 前最后一条真实消息是答一");
});
ok("at 早于所有消息：锚到第一条可见消息；非法 at 报错", () => {
  const r = traceNotes.buildContext(deps, "s1", "", 2, "2026-11-01T00:00:00Z");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.messages.filter(m => m.hit)[0].msg_id, "u1");
  assert.strictEqual(traceNotes.buildContext(deps, "s1", "", 2, "not-a-time").ok, false);
});
ok("msg_id 路径行为不变（at 缺省）", () => {
  const r = traceNotes.buildContext(deps, "s1", "u2", 1);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.messages.filter(m => m.hit)[0].msg_id, "u2");
  assert.strictEqual(r.total, 3, "a1 + u2(hit) + a2");
  assert.strictEqual(traceNotes.buildContext(deps, "s1", "", 6).ok, false, "msg_id 和 at 都没有要拒绝");
});

/* ---- logRecallHit 落盘 ---- */
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "recall-hits-test-"));
ok("logRecallHit：按月写 jsonl，字段齐全，空命中不写", () => {
  runtime.logRecallHit(tmpBase, "s_test", "inject", "她问酱菜", [
    { id: "trace:tn_9", text: "她提到「酱菜」。你记得 …", score: 4.5 },
    { id: "mp_x", text: "记忆X", score: 1.2349 },
    { id: null },
  ]);
  const now = new Date();
  const ym = now.getFullYear() + String(now.getMonth() + 1).padStart(2, "0");
  const p = path.join(tmpBase, "data", "recall_hits_" + ym + ".jsonl");
  assert.ok(fs.existsSync(p), "月度文件要建出来");
  const line = JSON.parse(fs.readFileSync(p, "utf8").trim());
  assert.strictEqual(line.session, "s_test");
  assert.strictEqual(line.mode, "inject");
  assert.strictEqual(line.query, "她问酱菜");
  assert.strictEqual(line.hits.length, 2, "没有 id 的条目丢掉");
  assert.strictEqual(line.hits[0].src, "trace");
  assert.strictEqual(line.hits[1].src, "memory");
  assert.strictEqual(line.hits[1].score, 1.23, "分数两位小数");
  runtime.logRecallHit(tmpBase, "s_test", "preview", "q", []);
  runtime.logRecallHit(tmpBase, "s_test", "preview", "q", [{ id: "mp_y", text: "y" }]);
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 2, "空命中不写行");
  assert.strictEqual(JSON.parse(lines[1]).mode, "preview");
});
fs.rmSync(tmpBase, { recursive: true, force: true });

/* ---- ensureFloatIndex：时间线读失败不能记指纹（11-15 健壮性） ---- */
function mkIdxCase() {
  const tlDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-hits-tl-"));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-hits-cache-"));
  return { tlDir, cacheDir, cacheFile: path.join(cacheDir, "recall-floats-index.json") };
}
const tlS1 = [
  { id: "u1", role: "user", time: "2026-11-14T03:00:00Z", content: "她问酱菜" },
  { id: "f1", role: "developer", float_id: "trace:tn_1", hidden: true, time: "2026-11-14T03:00:40Z", content: "浮现：酱菜" },
];
const tlS2 = [
  { id: "u2", role: "user", time: "2026-11-14T04:00:00Z", content: "另一句" },
  { id: "f2", role: "developer", float_id: "mp_y", hidden: true, time: "2026-11-14T04:00:30Z", content: "浮现2" },
];
function idxDepsFor(c, failSid) {
  return {
    timelineDir: c.tlDir,
    cacheFile: c.cacheFile,
    loadTimeline: (sid) => {
      if (sid === failSid) throw new Error("时间线读失败");
      return sid === "s1" ? tlS1 : (sid === "s2" ? tlS2 : []);
    },
    isRealMessageForTimeline: (m) => m.role === "user" || m.role === "assistant",
    normalizeContentToText: (c2) => (typeof c2 === "string" ? c2 : ""),
  };
}
ok("ensureFloatIndex：读失败不记指纹、不吃 pending，下次请求还会重试", () => {
  const c = mkIdxCase();
  fs.writeFileSync(path.join(c.tlDir, "enhanced_messages_s1.json"), "[]");
  fs.writeFileSync(c.cacheFile, JSON.stringify({ v: 1, savedAt: "2026-11-15T00:00:00Z", fileFp: {}, floats: [] }));
  recallHits._resetFloatIndex();
  const pending = recallHits.ensureFloatIndex(idxDepsFor(c, "s1"));
  const cache = JSON.parse(fs.readFileSync(c.cacheFile, "utf8"));
  assert.ok(!Object.prototype.hasOwnProperty.call(cache.fileFp, "enhanced_messages_s1.json"), "失败的文件绝不能记指纹（记了就永久不再扫）");
  assert.strictEqual(cache.floats.length, 0, "这次没索引到条目");
  assert.strictEqual(pending, 1, "读失败算没扫完，留在 pending");
  fs.rmSync(c.tlDir, { recursive: true, force: true });
  fs.rmSync(c.cacheDir, { recursive: true, force: true });
});
ok("ensureFloatIndex：读恢复后补扫成功，指纹与条目一起落盘", () => {
  const c = mkIdxCase();
  fs.writeFileSync(path.join(c.tlDir, "enhanced_messages_s1.json"), "[]");
  fs.writeFileSync(c.cacheFile, JSON.stringify({ v: 1, savedAt: "2026-11-15T00:00:00Z", fileFp: {}, floats: [] }));
  recallHits._resetFloatIndex();
  const pending = recallHits.ensureFloatIndex(idxDepsFor(c, null));
  assert.strictEqual(pending, 0, "扫完了 pending 归零");
  const cache = JSON.parse(fs.readFileSync(c.cacheFile, "utf8"));
  assert.ok(cache.fileFp["enhanced_messages_s1.json"], "读成功才记指纹");
  assert.strictEqual(cache.floats.length, 1);
  assert.strictEqual(cache.floats[0].float_id, "trace:tn_1");
  assert.strictEqual(cache.floats[0].query, "她问酱菜", "向前找真实 user 消息当 query");
  fs.rmSync(c.tlDir, { recursive: true, force: true });
  fs.rmSync(c.cacheDir, { recursive: true, force: true });
});
ok("ensureFloatIndex：一个会话读失败不影响别的会话，也不清空它已有条目", () => {
  const c = mkIdxCase();
  fs.writeFileSync(path.join(c.tlDir, "enhanced_messages_s1.json"), "[]");
  fs.writeFileSync(path.join(c.tlDir, "enhanced_messages_s2.json"), "[]");
  // 盘上先有一份 s1 的旧条目（模拟上次成功索引的结果），s2 本次新扫
  fs.writeFileSync(c.cacheFile, JSON.stringify({
    v: 1, savedAt: "2026-11-15T00:00:00Z", fileFp: {},
    floats: [{ sid: "s1", msg_id: "f_old", float_id: "mp_old", time: "2026-11-13T00:00:00Z", text: "旧浮现", query: "" }],
  }));
  recallHits._resetFloatIndex();
  const pending = recallHits.ensureFloatIndex(idxDepsFor(c, "s1"));
  assert.strictEqual(pending, 1, "s1 没扫完仍留在 pending");
  const cache = JSON.parse(fs.readFileSync(c.cacheFile, "utf8"));
  assert.ok(cache.fileFp["enhanced_messages_s2.json"], "另一个会话照常记指纹");
  assert.ok(!cache.fileFp["enhanced_messages_s1.json"], "失败会话不记指纹");
  assert.strictEqual(cache.floats.filter(x => x.sid === "s1").length, 1, "s1 的旧条目不能被清掉");
  assert.strictEqual(cache.floats.filter(x => x.sid === "s2").length, 1, "s2 新条目已进索引");
  fs.rmSync(c.tlDir, { recursive: true, force: true });
  fs.rmSync(c.cacheDir, { recursive: true, force: true });
});

console.log("done -", n, "checks");
