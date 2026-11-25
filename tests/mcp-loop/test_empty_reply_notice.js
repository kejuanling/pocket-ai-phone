"use strict";
// 模型没产出可见正文时的占位提示：按真实原因说，不再一律「工具调用轮次已达上限」。
const test = require("node:test");
const assert = require("node:assert/strict");
const loop = require("../../mcp/mcp-tool-loop");
const { emptyReplyNotice } = loop;

const EXHAUST = /工具调用轮次已达上限/;

test("emptyReplyNotice：只有真·轮次耗尽才说轮次已达上限", () => {
  assert.match(emptyReplyNotice({ exhausted: true }), EXHAUST);
  assert.doesNotMatch(emptyReplyNotice({}), EXHAUST);
  assert.doesNotMatch(emptyReplyNotice({ toolCount: 3 }), EXHAUST);
  assert.doesNotMatch(emptyReplyNotice({ finishReason: "stop" }), EXHAUST);
});

test("emptyReplyNotice：按结束原因/有无思考/是否用过工具区分", () => {
  assert.match(emptyReplyNotice({ finishReason: "length", hadReasoning: true }), /思考用完/);
  assert.match(emptyReplyNotice({ finishReason: "length" }), /长度上限截断/);
  assert.match(emptyReplyNotice({ finishReason: "content_filter" }), /安全过滤/);
  assert.match(emptyReplyNotice({ toolCount: 2 }), /调用了工具，但没有给出最终回复/);
  assert.match(emptyReplyNotice({ hadReasoning: true }), /只想了一通/);
  assert.match(emptyReplyNotice({}), /模型空回复/);
});

function upstream(choice) {
  return async () => ({ ok: true, status: 200, json: async () => ({ choices: [choice], usage: { total_tokens: 1 } }), text: async () => "" });
}
const baseArgs = (fetchFn) => ({
  messages: [{ role: "user", content: "hi" }],
  upstreamUrl: "http://x", upstreamKey: "k", model: "m",
  serverClients: [], fetchFn, maxToolRounds: 2,
});

test("runWithTools：上游空回复 + finish_reason=length → 给出截断提示，不是轮次上限", async () => {
  const r = await loop.runWithTools(baseArgs(upstream({ message: { content: "" }, finish_reason: "length" })));
  assert.match(r.text, /长度上限截断/);
  assert.doesNotMatch(r.text, EXHAUST);
});

test("runWithTools：上游空回复且没用过工具 → 通用「没有生成任何回复」", async () => {
  const r = await loop.runWithTools(baseArgs(upstream({ message: { content: "" }, finish_reason: "stop" })));
  assert.match(r.text, /模型空回复/);
  assert.doesNotMatch(r.text, EXHAUST);
});

test("runWithTools：有正文时原样返回，不套占位", async () => {
  const r = await loop.runWithTools(baseArgs(upstream({ message: { content: "你好" }, finish_reason: "stop" })));
  assert.equal(r.text, "你好");
});

// ---- 流式路径（另一份兜底代码，同样要按原因说话） ----
function sseUpstream(events) {
  const body = events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n";
  return async () => ({
    ok: true, status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }),
    text: async () => "",
  });
}
const streamArgs = (fetchFn) => ({
  messages: [{ role: "user", content: "hi" }],
  upstreamUrl: "http://x", upstreamKey: "k", model: "m",
  serverClients: [], fetchFn, maxToolRounds: 2,
});

test("streamToolLoop：只有思考没有正文 + finish_reason=length → 思考用完提示", async () => {
  const r = await loop.streamToolLoop(streamArgs(sseUpstream([
    { choices: [{ delta: { reasoning_content: "想想想" } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] },
  ])));
  assert.match(r.text, /思考用完/);
  assert.doesNotMatch(r.text, EXHAUST);
});

test("streamToolLoop：完全空流（finish=stop）→ 通用提示；有正文则原样", async () => {
  const r1 = await loop.streamToolLoop(streamArgs(sseUpstream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])));
  assert.match(r1.text, /模型空回复/);
  assert.doesNotMatch(r1.text, EXHAUST);
  const r2 = await loop.streamToolLoop(streamArgs(sseUpstream([
    { choices: [{ delta: { content: "在的" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] },
  ])));
  assert.equal(r2.text, "在的");
});
