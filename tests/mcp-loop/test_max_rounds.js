"use strict";
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// 1028-01（2026-10-28）：工具循环轮数上限调整（产品确定）——主聊天/子智能体不限（Infinity）、唤醒限 10 轮。
// 本文件验证 maxToolRounds 两条边界在 runWithTools / streamToolLoop 都成立：
//   1) Infinity：mock 让模型连续要 60 轮工具才收尾 → 全部跑完正常收尾，正文不带「轮次已达上限」，
//      且每轮请求 tool_choice 都是 "auto"（不会出现打满那轮强制 "none"）
//   2) 10：mock 让模型一直要工具 → 第 11 轮请求 tool_choice="none"；
//      a) 模型守规矩输出正文 → 正常收尾、不带截断提醒
//      b) 模型不守规矩仍发 tool_calls → 循环退出，正文尾带「（工具调用轮次已达上限（10 轮）」（小手机「继续」按钮识别锚）
// mock 手法照抄 tests/diary-timeline（mock MCP client + mock 上游，不连真服务、不写真数据）。
const assert = require("assert");
const path = require("path");

const ROOT = PROJECT_ROOT;
const mcp = require(path.join(ROOT, "mcp", "mcp-tool-loop.js"));

// ---------- mock MCP client（满足 loadTools + callToolByExposedName 两处接口） ----------
function makeClient() {
  const calls = [];
  return {
    id: "srv_mock", name: "mock", enabled: true, connected: false, config: {}, calls,
    async connect() { this.connected = true; },
    async listTools() {
      return [{ name: "memory_search", description: "查记忆", inputSchema: { type: "object", properties: { q: { type: "string" } } } }];
    },
    async callTool(name, args) { calls.push({ name, args }); return { content: [{ type: "text", text: name + " ok" }] }; }
  };
}

// ---------- 非流式 JSON 上游（runWithTools 用） ----------
function makeJsonFetch(plan, seen) {
  let round = 0;
  return async function (url, opts) {
    const body = JSON.parse(opts.body);
    seen.push(body);
    const msg = plan(round, body);
    round++;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg, finish_reason: (msg.tool_calls ? "tool_calls" : "stop") }] }), text: async () => "" };
  };
}

// ---------- 流式 SSE 上游（streamToolLoop 用） ----------
function sseFrame(delta, finish) {
  return "data: " + JSON.stringify({ choices: [{ delta, finish_reason: finish || null }] }) + "\n\n";
}
function toolCallFrame(name, argStr, id) {
  return sseFrame({ tool_calls: [{ index: 0, id: id || "call_1", function: { name, arguments: argStr } }] }, "tool_calls");
}
function makeSseResponse(frames) {
  const body = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    }
  });
  return { ok: true, status: 200, body, json: async () => ({}), text: async () => "" };
}
function makeSseFetch(plan, seen) {
  let round = 0;
  return async function (url, opts) {
    const body = JSON.parse(opts.body);
    seen.push(body);
    const msg = plan(round, body);
    round++;
    const frames = [sseFrame({ role: "assistant" }, null)];
    if (msg.content) frames.push(sseFrame({ content: msg.content }, null));
    if (msg.tool_calls) for (const tc of msg.tool_calls) frames.push(toolCallFrame(tc.function.name, tc.function.arguments, tc.id));
    frames.push(msg.tool_calls ? sseFrame({}, "tool_calls") : sseFrame({}, "stop"));
    frames.push("data: [DONE]\n\n");
    return makeSseResponse(frames);
  };
}

const BASE = {
  upstreamUrl: "http://upstream.invalid/v1",
  upstreamKey: "k",
  model: "m",
  messages: [{ role: "user", content: "干活" }],
  sessionId: "s_test_rounds"
};

function toolMsg(i, withText) {
  return { content: withText ? ("第" + i + "步有点进展。") : "", tool_calls: [{ id: "c" + i, type: "function", function: { name: "memory_search", arguments: JSON.stringify({ q: "x" + i }) } }] };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.log("  ✗ " + name + "\n      " + e.message); }
}

(async function main() {
  console.log("maxToolRounds 边界（主聊天 Infinity / 唤醒 10）\n");

  await test("A runWithTools Infinity：60 轮工具后收尾，不截断、全程 tool_choice=auto", async () => {
    const seen = [];
    const fetchFn = makeJsonFetch((round) => (round < 60 ? toolMsg(round, false) : { content: "终于做完了" }), seen);
    const r = await mcp.runWithTools(Object.assign({}, BASE, { serverClients: [makeClient()], fetchFn, maxToolRounds: Infinity }));
    assert.strictEqual(seen.length, 61, "应发 61 次请求（60 轮工具 + 1 轮收尾），实际 " + seen.length);
    assert.strictEqual(r.rounds, 60, "rounds 应为 60，实际 " + r.rounds);
    assert.ok(r.text.indexOf("终于做完了") >= 0, "收尾正文应在，实际 " + JSON.stringify(r.text));
    assert.ok(r.text.indexOf("工具调用轮次已达上限") < 0, "Infinity 不应出现轮次截断提醒");
    seen.forEach((b, i) => assert.strictEqual(b.tool_choice, "auto", "第 " + i + " 轮 tool_choice 应为 auto"));
  });

  await test("B streamToolLoop Infinity：同样 60 轮不限、干净收尾", async () => {
    const seen = [];
    const fetchFn = makeSseFetch((round) => (round < 60 ? toolMsg(round, false) : { content: "好了" }), seen);
    const r = await mcp.streamToolLoop(Object.assign({}, BASE, { serverClients: [makeClient()], fetchFn, maxToolRounds: Infinity }));
    assert.strictEqual(seen.length, 61, "应发 61 次请求，实际 " + seen.length);
    assert.ok(r.text.indexOf("好了") >= 0 && r.text.indexOf("工具调用轮次已达上限") < 0, "正文应干净收尾，实际 " + JSON.stringify(r.text));
  });

  await test("C runWithTools 10 轮：第 11 轮强制 tool_choice=none，守规矩模型正常收尾无提醒", async () => {
    const seen = [];
    const fetchFn = makeJsonFetch((round, body) => {
      if (round < 10) return toolMsg(round, false);
      assert.strictEqual(body.tool_choice, "none", "打满那轮应强制 tool_choice=none");
      return { content: "被强制收尾了" };
    }, seen);
    const r = await mcp.runWithTools(Object.assign({}, BASE, { serverClients: [makeClient()], fetchFn, maxToolRounds: 10 }));
    assert.strictEqual(seen.length, 11, "应恰好 11 次请求，实际 " + seen.length);
    assert.ok(r.text.indexOf("被强制收尾了") >= 0, "应有收尾正文");
    assert.ok(r.text.indexOf("工具调用轮次已达上限") < 0, "模型守规矩收尾时不应附加截断提醒，实际 " + JSON.stringify(r.text));
  });

  await test("D streamToolLoop 10 轮：模型打满仍要工具 → 正文尾带「10 轮」截断提醒（继续按钮锚）", async () => {
    const seen = [];
    const fetchFn = makeSseFetch((round, body) => {
      if (round < 10) return toolMsg(round, true);
      // 不守规矩：tool_choice=none 仍发 tool_calls（真实场景：某些模型把调用写成内部文本标记）
      assert.strictEqual(body.tool_choice, "none", "打满那轮应强制 tool_choice=none");
      return toolMsg(99, false);
    }, seen);
    const r = await mcp.streamToolLoop(Object.assign({}, BASE, { serverClients: [makeClient()], fetchFn, maxToolRounds: 10 }));
    assert.strictEqual(seen.length, 11, "打满后不应再发第 12 次请求，实际 " + seen.length);
    assert.ok(r.text.indexOf("（工具调用轮次已达上限（10 轮）") >= 0, "正文尾应带 10 轮截断提醒（继续按钮识别锚），实际 " + JSON.stringify(r.text));
  });

  console.log("\n通过 " + passed + "，失败 " + failed);
  process.exit(failed ? 1 : 0);
})();
