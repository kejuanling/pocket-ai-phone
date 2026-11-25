// lib/timeline-versions.js 单元测试（临时目录，不碰线上数据）。node tests/versions/test_timeline_versions.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const tv = require("../../lib/timeline-versions");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "tv-test-"));
const sid = "s_test_1";
let n = 0;
function t(name, fn) { fn(); n++; console.log("ok  " + name); }
const U = (id, c) => ({ id, role: "user", content: c, position: 1 });
const A = (id, c, pos) => ({ id, role: "assistant", content: c, position: pos || 2 });

// 时间线：sys, u1, a1, u2, a2(旧), a2b(旧)
const timeline = [{ role: "system", content: "sp" }, U("u1", "你好"), A("a1", "嗨", 2), U("u2", "讲个故事"), A("a2", "故事一", 4), A("a2b", "补充一", 5)];

t("首次存档：2 槽、当前是第 2 个", () => {
  const store = {};
  const r = tv.archive(store, "u2", { content: "讲个故事", tail: timeline.slice(4) });
  assert.deepStrictEqual(r, { count: 2, cur: 1 });
  assert.strictEqual(store.u2.slots[0].tail.length, 2);
  assert.strictEqual(store.u2.slots[1].tail, null);
});

t("存档是深拷贝，之后改时间线不影响存档", () => {
  const store = {}; const tail = [A("x", "原文")];
  tv.archive(store, "u2", { content: "q", tail });
  tail[0].content = "被改了";
  assert.strictEqual(store.u2.slots[0].tail[0].content, "原文");
});

t("编辑后重新生成：旧内容和新内容各占一槽，切回去内容也跟着回来", () => {
  const store = {};
  tv.archive(store, "u2", { content: "讲个故事", tail: timeline.slice(4) });
  // 新内容 + 新回复现在活在时间线里
  const live = { content: "讲个恐怖故事", tail: [A("a2n", "恐怖故事", 6)] };
  const out = tv.switchTo(store, "u2", 0, live);
  assert.strictEqual(out.content, "讲个故事");
  assert.deepStrictEqual(out.tail.map(m => m.id), ["a2", "a2b"]);
  assert.strictEqual(store.u2.cur, 0);
  // 再切回新的
  const out2 = tv.switchTo(store, "u2", 1, { content: out.content, tail: out.tail });
  assert.strictEqual(out2.content, "讲个恐怖故事");
  assert.deepStrictEqual(out2.tail.map(m => m.id), ["a2n"]);
});

t("切到当前 / 越界 / 不存在的锚点返回 null", () => {
  const store = {}; tv.archive(store, "u2", { content: "q", tail: [A("a", "x")] });
  assert.strictEqual(tv.switchTo(store, "u2", 1, { content: "q", tail: [] }), null);
  assert.strictEqual(tv.switchTo(store, "u2", 5, { content: "q", tail: [] }), null);
  assert.strictEqual(tv.switchTo(store, "nope", 0, { content: "q", tail: [] }), null);
  assert.strictEqual(tv.switchTo(store, "u2", -1, { content: "q", tail: [] }), null);
});

t("在第 1 个版本上再重新生成：新槽追加到末尾，旧的第 1 个版本真身回写", () => {
  const store = {};
  tv.archive(store, "u2", { content: "q", tail: [A("a1v", "v1")] });         // 槽0=v1, 槽1=活
  tv.switchTo(store, "u2", 0, { content: "q", tail: [A("a2v", "v2")] });      // 活到槽0，v2 回写槽1
  const r = tv.archive(store, "u2", { content: "q", tail: [A("a1v", "v1")] }); // 在 v1 上再生成
  assert.deepStrictEqual(r, { count: 3, cur: 2 });
  assert.strictEqual(store.u2.slots[0].tail[0].id, "a1v");
  assert.strictEqual(store.u2.slots[1].tail[0].id, "a2v");
});

t("超过 20 槽丢最旧的非当前槽，cur 仍指向活槽", () => {
  const store = {};
  for (let i = 0; i < 25; i++) tv.archive(store, "u2", { content: "q" + i, tail: [A("a" + i, "t" + i)] });
  assert.strictEqual(store.u2.slots.length, tv.MAX_SLOTS);
  assert.strictEqual(store.u2.cur, tv.MAX_SLOTS - 1);
  assert.strictEqual(store.u2.slots[0].content, "q6");   // 25 次存档共 26 槽，最旧的 6 个被挤掉
});

t("删非当前版本：cur 随下标调整；删到只剩活的那个就整条回收", () => {
  const store = {};
  tv.archive(store, "u2", { content: "q", tail: [A("a1", "1")] });
  tv.archive(store, "u2", { content: "q", tail: [A("a2", "2")] });   // 3 槽，cur=2
  assert.strictEqual(tv.removeSlot(store, "u2", 2), false);          // 不能删当前
  assert.strictEqual(tv.removeSlot(store, "u2", 0), true);
  assert.strictEqual(store.u2.cur, 1);
  assert.strictEqual(tv.removeSlot(store, "u2", 0), true);
  assert.strictEqual(store.u2, undefined);
});

t("summary 只返回锚点还在时间线里、且至少 2 个版本的", () => {
  const store = {};
  tv.archive(store, "u2", { content: "q", tail: [] });
  tv.archive(store, "gone", { content: "q", tail: [] });
  const s = tv.summary(store, new Set(["u2"]));
  assert.deepStrictEqual(s, { u2: { count: 2, cur: 1 } });
});

t("composeTimeline：换内容换尾巴，不改原数组", () => {
  const next = tv.composeTimeline(timeline, 3, "新问题", [A("z", "新答", 9)]);
  assert.strictEqual(next.length, 5);
  assert.strictEqual(next[3].content, "新问题");
  assert.strictEqual(next[4].id, "z");
  assert.strictEqual(timeline[3].content, "讲个故事");
  assert.strictEqual(timeline.length, 6);
});

t("文件读写：存、读、空了删文件、删锚点、删会话", () => {
  const store = {}; tv.archive(store, "u2", { content: "q", tail: [A("a", "x")] });
  tv.save(base, sid, store);
  assert.ok(fs.existsSync(tv.fileOf(base, sid)));
  assert.deepStrictEqual(Object.keys(tv.load(base, sid)), ["u2"]);
  const s2 = tv.load(base, sid);
  assert.strictEqual(tv.dropAnchors(s2, ["u2", "nope"]), true);
  tv.save(base, sid, s2);
  assert.ok(!fs.existsSync(tv.fileOf(base, sid)), "空了应删文件");
  tv.save(base, sid, store);
  assert.strictEqual(tv.dropSession(base, sid), true);
  assert.strictEqual(tv.dropSession(base, sid), false);
  assert.deepStrictEqual(tv.load(base, sid), {});
});

t("非法会话 id 拒绝（路径穿越）", () => {
  assert.throws(() => tv.fileOf(base, "../x"));
  assert.throws(() => tv.fileOf(base, ""));
  assert.deepStrictEqual(tv.load(base, "../etc"), {});
});

t("损坏的文件读成空，不抛", () => {
  fs.mkdirSync(path.join(base, "data", "timeline_versions"), { recursive: true });
  fs.writeFileSync(tv.fileOf(base, "bad"), "{not json");
  assert.deepStrictEqual(tv.load(base, "bad"), {});
});

t("coveredAnchors：落在启用块区间内的锚点被选中，区间外/不在时间线的不算", () => {
  const store = {};
  tv.archive(store, "a1", { content: "q", tail: [] });   // 假设 a1/a3/a5 都是锚点
  tv.archive(store, "a3", { content: "q", tail: [] });
  tv.archive(store, "a5", { content: "q", tail: [] });
  tv.archive(store, "a9", { content: "q", tail: [] });
  const idPos = new Map([["a0", 0], ["a1", 1], ["a2", 2], ["a3", 3], ["a4", 4], ["a5", 5], ["a6", 6], ["a9", 9]]);
  const blocks = [{ matched: [{ id: "a0" }, { id: "a2" }] }, { matched: [{ id: "a4" }, { id: "a6" }] }];
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, blocks).sort(), ["a1", "a5"]);
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, [{ matched: [{ id: "a4" }, { id: "a6" }] }]), ["a5"]);
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, [{ matched: [{ id: "nope" }, { id: "a2" }] }]), [], "块定位不到就不当覆盖");
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, [{ matched: [{ id: "a4" }, { id: "a2" }] }]), ["a3"], "首尾颠倒自动校正，取 [2,4]");
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, [{ matched: [] }]), []);
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, [{ matched: [{ role: "assistant" }, { id: "a1", role: "user" }] }]), ["a1"], "首条没 id 就取第一条有 id 的");
  assert.deepStrictEqual(tv.coveredAnchors(store, idPos, []), []);
  assert.deepStrictEqual(tv.coveredAnchors(null, idPos, blocks), []);
});

t("压缩联动收尾：算出覆盖锚点后 dropAnchors 真的删干净", () => {
  const store = {};
  tv.archive(store, "a1", { content: "q", tail: [] });
  tv.archive(store, "a5", { content: "q", tail: [] });
  const idPos = new Map([["a0", 0], ["a1", 1], ["a5", 5], ["a6", 6]]);
  const ids = tv.coveredAnchors(store, idPos, [{ matched: [{ id: "a0" }, { id: "a6" }] }]);
  assert.deepStrictEqual(ids, ["a1", "a5"]);
  assert.strictEqual(tv.dropAnchors(store, ids), true);
  assert.deepStrictEqual(store, {});
});

fs.rmSync(base, { recursive: true, force: true });
console.log("全部通过：" + n + " 项");
