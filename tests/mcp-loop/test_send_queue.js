"use strict";
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// 发送排队（2026-11-04）：回复期间排队的消息，在下一次请求上游前作为 user 消息插进去；AI 没调工具要结束时有排队就多跑一轮。
const assert = require("assert");
const path = require("path");
const ROOT = PROJECT_ROOT;
const mcp = require(path.join(ROOT, "mcp", "mcp-tool-loop.js"));
const sq = require(path.join(ROOT, "lib", "send-queue.js"));

function makeClient() {
  const calls = [];
  return { id: "srv_mock", name: "mock", enabled: true, connected: false, config: {}, calls,
    async connect() { this.connected = true; },
    async listTools() { return [{ name: "memory_search", description: "查", inputSchema: { type: "object", properties: { q: { type: "string" } } } }]; },
    async callTool(name, args) { calls.push({ name, args }); return { content: [{ type: "text", text: name + " ok" }] }; } };
}
function sseFrame(delta, finish) { return "data: " + JSON.stringify({ choices: [{ delta, finish_reason: finish || null }] }) + "\n\n"; }
function makeSse(frames) {
  const body = new ReadableStream({ start(c) { const e = new TextEncoder(); for (const f of frames) c.enqueue(e.encode(f)); c.close(); } });
  return { ok: true, status: 200, body, json: async () => ({}), text: async () => "" };
}
function makeFetch(plan, seen) {
  let round = 0;
  return async function (url, opts) {
    const body = JSON.parse(opts.body); seen.push(body);
    const msg = plan(round, body); round++;
    const frames = [sseFrame({ role: "assistant" }, null)];
    if (msg.content) frames.push(sseFrame({ content: msg.content }, null));
    if (msg.tool_calls) for (const tc of msg.tool_calls) frames.push(sseFrame({ tool_calls: [{ index: 0, id: tc.id, function: { name: tc.function.name, arguments: tc.function.arguments } }] }, "tool_calls"));
    frames.push(msg.tool_calls ? sseFrame({}, "tool_calls") : sseFrame({}, "stop")); frames.push("data: [DONE]\n\n");
    return makeSse(frames);
  };
}
const tool = (i) => ({ content: "", tool_calls: [{ id: "c" + i, type: "function", function: { name: "memory_search", arguments: JSON.stringify({ q: "x" + i }) } }] });
const BASE = { upstreamUrl: "http://upstream.invalid/v1", upstreamKey: "k", model: "m", messages: [{ role: "user", content: "干活" }] };

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + "\n      " + e.message); } }

(async function () {
  await test("A 排队消息在工具轮之后、下一次请求前插进去（user 消息，带原文）", async () => {
    const sid = "s_sq_a"; const seen = [];
    const fetchFn = makeFetch((round) => (round === 0 ? tool(0) : round === 1 ? tool(1) : { content: "好，按你说的改了" }), seen);
    // 第 1 轮工具执行期间用户排队一条
    const client = makeClient(); const origCall = client.callTool.bind(client);
    client.callTool = async (n, a) => { if (a.q === "x0") sq.enqueue(sid, { id: "m1", text: "先别动 B 文件\n<current_time>t</current_time>" }); return origCall(n, a); };
    const r = await mcp.streamToolLoop(Object.assign({}, BASE, { sessionId: sid, serverClients: [client], fetchFn, maxToolRounds: Infinity,
      pullInjected: () => sq.take(sid), hasInjected: () => sq.status(sid).pending.length > 0 }));
    assert.strictEqual(seen.length, 3, "应 3 次请求，实际 " + seen.length);
    const m1 = seen[1].messages, last = m1[m1.length - 1];
    assert.strictEqual(last.role, "user"); assert.ok(last.content.indexOf("先别动 B 文件") === 0, "第 2 次请求末尾应是排队消息：" + JSON.stringify(last));
    assert.ok(seen[0].messages.every((m) => String(m.content || "").indexOf("先别动") < 0), "第 1 次请求不应带它");
    assert.ok(r.text.indexOf("按你说的改了") >= 0);
    assert.deepStrictEqual(sq.drainTaken(sid).map((x) => x.id), ["m1"], "被取走的要留着等落盘");
  });

  await test("B AI 这一轮没调工具、结束时有排队 → 多跑一轮去回应", async () => {
    const sid = "s_sq_b"; const seen = [];
    const fetchFn = makeFetch((round) => (round === 0 ? { content: "第一版做好了" } : { content: "收到，改成你说的" }), seen);
    let first = true;
    const wrapped = async (u, o) => { const res = await fetchFn(u, o); if (first) { first = false; sq.enqueue(sid, { id: "m2", text: "再加一条" }); } return res; };
    const r = await mcp.streamToolLoop(Object.assign({}, BASE, { sessionId: sid, serverClients: [makeClient()], fetchFn: wrapped, maxToolRounds: Infinity,
      pullInjected: () => sq.take(sid), hasInjected: () => sq.status(sid).pending.length > 0 }));
    assert.strictEqual(seen.length, 2, "应多跑一轮，实际 " + seen.length);
    assert.strictEqual(seen[1].messages[seen[1].messages.length - 1].content, "再加一条");
    assert.ok(r.text.indexOf("收到，改成你说的") >= 0);
    sq.drainTaken(sid);
  });

  await test("C 没有排队时行为不变（一次请求直接收尾）", async () => {
    const seen = [];
    const r = await mcp.streamToolLoop(Object.assign({}, BASE, { sessionId: "s_sq_c", serverClients: [makeClient()], fetchFn: makeFetch(() => ({ content: "好了" }), seen), maxToolRounds: Infinity,
      pullInjected: () => sq.take("s_sq_c"), hasInjected: () => sq.status("s_sq_c").pending.length > 0 }));
    assert.strictEqual(seen.length, 1); assert.ok(r.text.indexOf("好了") >= 0);
  });

  await test("D 队列本身：上限/空消息/撤回/flush/重复 id", () => {
    const sid = "s_sq_d";
    assert.strictEqual(sq.enqueue(sid, { text: "  " }).ok, false);
    for (let i = 0; i < sq.MAX_PENDING; i++) assert.ok(sq.enqueue(sid, { id: "i" + i, text: "t" + i }).ok);
    assert.strictEqual(sq.enqueue(sid, { id: "x", text: "多一条" }).ok, false, "超上限要拒");
    assert.strictEqual(sq.cancel(sid, "i0"), true); assert.strictEqual(sq.cancel(sid, "i0"), false);
    assert.strictEqual(sq.enqueue(sid, { id: "i1", text: "重复" }).dup, true);
    const left = sq.flush(sid); assert.strictEqual(left.length, sq.MAX_PENDING - 1); assert.strictEqual(sq.status(sid).pending.length, 0);
  });

  console.log("\n通过 " + passed + " / 失败 " + failed); process.exit(failed ? 1 : 0);
})();
