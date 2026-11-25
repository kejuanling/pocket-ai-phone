/* [位置:tests/trace/test_trace_page.js] [痕迹页接口单测] [11-07：routes/trace-notes.js 的 buildContext / listAll 是纯函数，gateway 重启前就能验证窗口逻辑；不依赖 fastify、不动真时间线数据] [注释时间 2026-11-07] */
"use strict";
const assert = require("assert");
const factory = require("../../routes/trace-notes");

/* ---- listAll：真库只读核对 ---- */
(function () {
  const items = factory.listAll();
  assert.ok(Array.isArray(items) && items.length >= 38, "应至少有 38 条");
  const a = items[0], b = items[1];
  assert.ok(String(a.at) >= String(b.at), "新的在前");
  for (const it of items) {
    assert.ok(it.id && it.content, "id/content 必有");
    assert.ok(Array.isArray(it.grams), "grams 是数组");
    assert.ok(it.recall && it.recall.indexOf("（这是记忆，不是此刻；接不接，你定）") < 0, "召回文案无括号句（11-08 涵定，pinned 已有同义句）");
    if (it.msg_id) assert.ok(it.recall.indexOf(it.msg_id) > 0, "召回文案带 msg_id");
    assert.ok(it.grams.every((g) => typeof g === "string" && g.length >= 2), "gram 至少 2 字");
    for (let i = 1; i < it.grams.length; i++) assert.ok(it.grams[i - 1].length >= it.grams[i].length, "长词在前");
  }
  console.log("listAll OK:", items.length, "条；首条关键词数", items[0].grams.length);
})();

/* ---- buildContext：桩时间线 ---- */
const deps = {
  loadTimeline: (sid) => TL[sid] || [],
  isRealMessageForTimeline: (m) => !m.hidden,
  normalizeContentToText: (c) => String(c),
};
function msg(i, role, text, extra) { return Object.assign({ id: "m" + i, role: role || "user", content: text || ("正文" + i), time: "2026-11-07T10:00:00Z" }, extra || {}); }
const TL = { s_test: [] };
for (let i = 1; i <= 30; i++) TL.s_test.push(msg(i, i % 2 ? "user" : "assistant", i === 15 ? "命中条" + "长".repeat(700) : i === 14 ? "邻居长文" + "字".repeat(700) : "内容" + i));

(function () {
  /* 基本窗口：hit 标记 + 前后各 6 */
  const r = factory.buildContext(deps, "s_test", "m15", 6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.window, 6);
  assert.strictEqual(r.total, 13, "命中条 ±6");
  const hits = r.messages.filter((m) => m.hit);
  assert.strictEqual(hits.length, 1, "hit 只有命中条");
  assert.strictEqual(hits[0].msg_id, "m15", "hit 是命中条");
  assert.ok(r.messages[0].msg_id === "m9" && r.messages[r.messages.length - 1].msg_id === "m21", "窗口边界");

  /* 邻居截 500 / 命中 6000 */
  const nb = r.messages.find((m) => m.msg_id === "m14");
  const hit = hits[0];
  assert.ok(nb.text.length <= 507 + 4, "邻居截 500（+标记），实际 " + nb.text.length);
  assert.ok(nb.text.indexOf("…（邻居截断）") > 0, "邻居截断标记");
  assert.ok(hit.text.length > 700, "命中条不按 500 截");

  /* 窗口收紧 ctx=2 */
  const r2 = factory.buildContext(deps, "s_test", "m15", 2);
  assert.strictEqual(r2.total, 5);

  /* 大窗口裁剪：总量超 60 从最旧邻居丢，命中条不丢 */
  TL.s_big = [];
  for (let i = 1; i <= 80; i++) TL.s_big.push(msg(i, i % 2 ? "user" : "assistant"));
  const r3 = factory.buildContext(deps, "s_big", "m40", 30);
  assert.ok(r3.total <= 60, "总量超 60 被裁，实际 " + r3.total);
  assert.ok(r3.messages.some((m) => m.hit && m.msg_id === "m40"), "命中条永不丢");
  assert.ok(r3.messages[0].msg_id !== "m1", "从最旧邻居开始丢");

  /* 过滤：developer/tool/diary/hidden/deleted 不占窗口 */
  TL.s_mix = [];
  TL.s_mix.push(msg(1, "assistant"));
  TL.s_mix.push(msg(2, "developer"));
  TL.s_mix.push(msg(3, "assistant", "推文", { kind: "diary" }));
  TL.s_mix.push(msg(4, "assistant", "删了的", { deleted: true }));
  TL.s_mix.push(msg(5, "assistant", "隐藏", { hidden: true }));
  TL.s_mix.push(msg(6, "user"));
  TL.s_mix.push(msg(7, "assistant", "命中我"));
  TL.s_mix.push(msg(8, "tool"));
  TL.s_mix.push(msg(9, "user"));
  const r4 = factory.buildContext(deps, "s_mix", "m7", 6);
  const ids = r4.messages.map((m) => m.msg_id);
  assert.deepStrictEqual(ids, ["m1", "m6", "m7", "m9"], "developer/tool/diary/deleted/hidden 全过滤，实际 " + ids.join(","));

  /* 找不到 */
  const r5 = factory.buildContext(deps, "s_test", "nope", 6);
  assert.strictEqual(r5.ok, false);
  assert.deepStrictEqual(r5.missing, ["nope"]);
  console.log("buildContext OK: 窗口/截断/裁剪/过滤/missing 全过");
})();

console.log("test_trace_page 全部通过");
