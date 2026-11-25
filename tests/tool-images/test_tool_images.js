"use strict";
// 工具返回的图片（2026-10-27）：存盘去重 / 保留期清理 / 按模型能不能看图分流（链接 vs 转写）。
// 运行：node --test tests/tool-images/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.PUBLIC_BASE_URL = "https://example.test";
const toolImages = require("../../lib/tool-images");
const modelRouter = require("../../lib/model-router");
const { callToolByExposedName } = require("../../mcp/mcp-service");
const loop = require("../../mcp/mcp-tool-loop");

// 1x1 png
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tool-images-"));

test("saveToolImage：按内容哈希存一份，重复不再写；不认的类型/空数据返回 null", () => {
  const a = toolImages.saveToolImage("image/png", PNG, TMP);
  const b = toolImages.saveToolImage("image/png", PNG, TMP);
  assert.equal(a.file, b.file);
  assert.match(a.file, /^shot-[0-9a-f]{16}\.png$/);
  assert.equal(a.absUrl, "https://example.test/uploads/" + a.file);
  assert.equal(fs.readdirSync(TMP).filter((n) => n.startsWith("shot-")).length, 1);
  assert.equal(toolImages.saveToolImage("application/pdf", PNG, TMP), null);
  assert.equal(toolImages.saveToolImage("image/png", "", TMP), null);
});

test("cleanup：超过张数或天数的 shot-* 连同 .txt 一起删，别的文件不动", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tool-images-clean-"));
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const f = path.join(d, "shot-" + String(i).padStart(16, "a") + ".jpg");
    fs.writeFileSync(f, "x"); fs.writeFileSync(f + ".txt", "desc");
    const t = new Date(now - i * 1000); fs.utimesSync(f, t, t);
  }
  const old = path.join(d, "shot-" + "b".repeat(16) + ".jpg"); fs.writeFileSync(old, "x");
  const ot = new Date(now - 9 * 86400000); fs.utimesSync(old, ot, ot);
  fs.writeFileSync(path.join(d, "img-keep.jpg"), "x");
  const removed = toolImages.cleanup(d, { keep: 3, days: 7 });
  assert.equal(removed, 3);   // 超张数 2 张 + 过期 1 张
  const left = fs.readdirSync(d).sort();
  assert.ok(left.includes("img-keep.jpg"));
  assert.equal(left.filter((n) => /^shot-.*\.jpg$/.test(n)).length, 3);
  assert.equal(left.filter((n) => n.endsWith(".txt")).length, 3);
});

function fakeClient() {
  const c = {
    id: "s1", name: "S", enabled: true, connected: true, config: {},
    connect: async () => {},
    listTools: async () => [{ name: "screenshot", description: "d", inputSchema: { type: "object", properties: {} } }],
    callTool: async () => ({ content: [{ type: "text", text: "已截图" }, { type: "image", mimeType: "image/png", data: PNG }] })
  };
  return c;
}

test("flatten：图片块存盘，文字里写 ![](链接)，不再是占位符", async () => {
  const client = fakeClient();
  const routes = [{ exposedName: "screenshot", client, serverId: "s1", serverName: "S", tool: { name: "screenshot" } }];
  const r = await callToolByExposedName([client], routes, "screenshot", {});
  assert.match(r.markdown, /!\[\]\(https:\/\/example\.test\/uploads\/shot-[0-9a-f]{16}\.png\)/);
  assert.doesNotMatch(r.markdown, /\[图片: image/);
  assert.equal(r.images.length, 1);
  fs.unlinkSync(path.join(r.images[0].dir, r.images[0].file));
});

function upstreamTwoStep(seen) {
  let n = 0;
  return async (url, init) => {
    seen.push(JSON.parse(init.body));
    n++;
    const message = n === 1
      ? { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "screenshot", arguments: "{}" } }] }
      : { role: "assistant", content: "看到了" };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: n === 1 ? "tool_calls" : "stop" }], usage: { total_tokens: 1 } }), text: async () => "" };
  };
}

test("能看图的模型：整轮工具结果之后补一条 user 消息，image_url 是公开 https 链接", async () => {
  const orig = modelRouter.modelNameSupportsVision;
  modelRouter.modelNameSupportsVision = (m) => m === "vis-model";
  const seen = [];
  try {
    const r = await loop.runWithTools({ messages: [{ role: "user", content: "截个图" }], upstreamUrl: "http://x", upstreamKey: "k", model: "vis-model", serverClients: [fakeClient()], fetchFn: upstreamTwoStep(seen), maxToolRounds: 3 });
    assert.equal(r.text, "看到了");
    const second = seen[1].messages;
    const lastTool = second.map((m) => m.role).lastIndexOf("tool");
    const img = second[lastTool + 1];
    assert.equal(img.role, "user");
    const part = img.content.find((p) => p.type === "image_url");
    assert.match(part.image_url.url, /^https:\/\/example\.test\/uploads\/shot-[0-9a-f]{16}\.png$/);
    assert.doesNotMatch(second[lastTool].content, /图片转写/);
    fs.unlinkSync(path.join(toolImages.UPLOADS_DIR, part.image_url.url.split("/").pop()));
  } finally { modelRouter.modelNameSupportsVision = orig; }
});

test("不能看图的模型：不发图，转写文字追加进工具结果；转写失败也不炸", async () => {
  const orig = modelRouter.modelNameSupportsVision, origDesc = toolImages.describeFor;
  modelRouter.modelNameSupportsVision = () => false;
  try {
    for (const mode of ["ok", "fail"]) {
      toolImages.describeFor = async () => mode === "ok" ? { text: "一张纯黑的小图" } : { error: "没配转写模型" };
      const seen = [];
      const r = await loop.runWithTools({ messages: [{ role: "user", content: "截个图" }], upstreamUrl: "http://x", upstreamKey: "k", model: "text-model", serverClients: [fakeClient()], fetchFn: upstreamTwoStep(seen), maxToolRounds: 3 });
      assert.equal(r.text, "看到了");
      const second = seen[1].messages;
      assert.equal(second.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")), false, "不能看图的模型不收图");
      const tool = second[second.map((m) => m.role).lastIndexOf("tool")];
      if (mode === "ok") assert.match(tool.content, /\[图片转写\] 一张纯黑的小图/);
      else assert.match(tool.content, /\[图片转写失败：没配转写模型\]/);
    }
  } finally { modelRouter.modelNameSupportsVision = orig; toolImages.describeFor = origDesc; }
});

// 流式路径（主聊天走这条）：同一套分流
function sseResp(chunks) {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode("data: " + JSON.stringify(x) + "\n\n"))); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
  return { ok: true, status: 200, body, text: async () => "" };
}
function streamUpstream(seen) {
  let n = 0;
  return async (url, init) => {
    seen.push(JSON.parse(init.body)); n++;
    if (n === 1) return sseResp([{ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "screenshot", arguments: "{}" } }] } }] }, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }]);
    return sseResp([{ choices: [{ index: 0, delta: { content: "看到了" } }] }, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]);
  };
}
test("流式：能看图补 image_url 用户消息，不能看图追加转写", async () => {
  const orig = modelRouter.modelNameSupportsVision, origDesc = toolImages.describeFor;
  try {
    modelRouter.modelNameSupportsVision = () => true;
    let seen = [];
    let r = await loop.streamToolLoop({ messages: [{ role: "user", content: "截个图" }], upstreamUrl: "http://x", upstreamKey: "k", model: "vis", serverClients: [fakeClient()], fetchFn: streamUpstream(seen), maxToolRounds: 3 });
    assert.equal(r.text, "看到了");
    let second = seen[1].messages, lt = second.map((m) => m.role).lastIndexOf("tool");
    const part = second[lt + 1].content.find((p) => p.type === "image_url");
    assert.match(part.image_url.url, /^https:\/\/example\.test\/uploads\/shot-/);
    fs.unlinkSync(path.join(toolImages.UPLOADS_DIR, part.image_url.url.split("/").pop()));
    modelRouter.modelNameSupportsVision = () => false;
    toolImages.describeFor = async () => ({ text: "转写文字" });
    seen = [];
    r = await loop.streamToolLoop({ messages: [{ role: "user", content: "截个图" }], upstreamUrl: "http://x", upstreamKey: "k", model: "txt", serverClients: [fakeClient()], fetchFn: streamUpstream(seen), maxToolRounds: 3 });
    second = seen[1].messages; lt = second.map((m) => m.role).lastIndexOf("tool");
    assert.match(second[lt].content, /\[图片转写\] 转写文字/);
    assert.equal(second.some((m) => Array.isArray(m.content)), false);
    assert.match(r.toolHistory[0].result, /!\[\]\(https:\/\/example\.test\/uploads\/shot-/, "时间线里的工具结果保留链接，前端据此显示缩略图");
  } finally { modelRouter.modelNameSupportsVision = orig; toolImages.describeFor = origDesc; }
});

test.after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });
