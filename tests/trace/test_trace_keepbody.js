/* [位置:tests/trace/test_trace_keepbody.js] [trace 落盘保留（keepBody）单测] [11-08：正文原样落时间线回灌 AI；旧行为保留为默认参数，回滚即回归。覆盖：keepBody 提取/不回写、旧行为回归、防重两边剥（新旧库存数据）] [注释时间 2026-11-08] */
"use strict";
const assert = require("assert");
const traceLib = require("../../lib/trace");

const BODY = "<trace>热的蜂蜜水</trace>";
const full = "（递过杯子）趁热喝。\n\n" + BODY;

/* ---- keepBody=true：正文原样保留、trace 挂上、segments/stream_timeline 不动 ---- */
(function () {
  const nm = { role: "assistant", content: full, segments: ["（递过杯子）趁热喝。\n\n", BODY], stream_timeline: [{ type: "text", text: full }] };
  const r = traceLib.extractFromMessage(nm, "s_test", true);
  assert.strictEqual(r, true, "有 trace 返回 true");
  assert.ok(nm.content.indexOf("<trace>热的蜂蜜水</trace>") >= 0, "content 原样保留");
  assert.strictEqual(nm.content, full, "content 与原文全等");
  assert.deepStrictEqual(nm.segments, ["（递过杯子）趁热喝。\n\n", BODY], "segments 不动");
  assert.deepStrictEqual(nm.stream_timeline, [{ type: "text", text: full }], "stream_timeline 不动");
  assert.ok(nm.trace && nm.trace.content === "热的蜂蜜水", "trace 挂上（trace_notes 入库依据）");
  assert.ok(nm.trace.at, "trace.at 有值");
})();

/* ---- 默认（不传）：旧行为，正文剥掉 ---- */
(function () {
  const nm = { role: "assistant", content: full };
  const r = traceLib.extractFromMessage(nm, "s_test");
  assert.strictEqual(r, true);
  assert.ok(nm.content.indexOf("<trace") < 0, "旧行为：正文剥掉");
  assert.ok(nm.trace && nm.trace.content === "热的蜂蜜水", "旧行为：trace 照挂");
  const nm2 = { role: "assistant", content: "没有 trace 的普通回复" };
  assert.strictEqual(traceLib.extractFromMessage(nm2, "s_test", true), false, "无 trace 返回 false");
})();

/* ---- 防重（server.js tailHasReply 同款比对）：两边都剥，新旧库存数据都命中 ---- */
(function () {
  const reply = "（递过杯子）趁热喝。\n\n<trace>热的蜂蜜水</trace>";
  // 模拟 tailHasReply：_c = 剥过+cardCanon(新回复)；库存消息两边各剥一次后比对
  const canon = (s) => String(s).replace(/\s+/g, " ").trim();
  const _c = canon(traceLib.stripTrace(reply).text);
  // 新库存（11-08 后落盘，正文含 trace）
  const mNew = { role: "assistant", content: reply };
  const hitNew = canon(traceLib.stripTrace(mNew.content).text) === _c;
  // 旧库存（11-08 前落盘，正文已剥）
  const mOld = { role: "assistant", content: "（递过杯子）趁热喝。" };
  const hitOld = canon(traceLib.stripTrace(mOld.content).text) === _c;
  assert.ok(hitNew, "新库存（含 trace）防重命中");
  assert.ok(hitOld, "旧库存（无 trace）防重命中");
  // 无关回复不误伤
  assert.ok(canon(traceLib.stripTrace("别的回复").text) !== _c, "不同内容不误判");
})();

/* ---- trace_notes 钩子条件（server.js:1536 同款判断）---- */
(function () {
  const nm = { role: "assistant", content: full };
  const ok = traceLib.extractFromMessage(nm, "s_test", true) && nm.trace && nm.trace.content;
  assert.ok(ok, "钩子条件成立，traceNotes.add 会执行");
})();

console.log("test_trace_keepbody 全部通过");
