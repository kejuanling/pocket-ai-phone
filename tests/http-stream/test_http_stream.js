"use strict";
// lib/http_stream.js：流式解析、网络错误自动重试、不支持 stream 的识别、友好报错。全程本地假上游。
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const hs = require("../../lib/http_stream");

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, url: "http://127.0.0.1:" + srv.address().port + "/v1/chat/completions" }));
  });
}
const sse = (res, events, { done = true } = {}) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const e of events) res.write(": keepalive\n\n" + "data: " + JSON.stringify(e) + "\n\n");
  if (done) res.write("data: [DONE]\n\n");
  res.end();
};
const BODY = JSON.stringify({ model: "m", messages: [], stream: true });

test("postChatStream：把流式分片拼成与非流式同形的结果（含思考、usage、finish_reason）", async () => {
  const { srv, url } = await startServer((req, res) => sse(res, [
    { id: "c1", model: "mm", choices: [{ delta: { reasoning_content: "想" } }] },
    { choices: [{ delta: { content: '{"a":' } }] },
    { choices: [{ delta: { content: '1}' } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { total_tokens: 7 } },
  ]));
  try {
    const r = await hs.postChatStream(url, BODY, {}, 5000);
    assert.equal(r.choices[0].message.content, '{"a":1}');
    assert.equal(r.choices[0].message.reasoning_content, "想");
    assert.equal(r.choices[0].finish_reason, "stop");
    assert.equal(r.usage.total_tokens, 7);
    assert.equal(r.model, "mm");
  } finally { srv.close(); }
});

test("postChatStream：上游忽略 stream 直接回整份 JSON，照样解析", async () => {
  const { srv, url } = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "整份" }, finish_reason: "stop" }] }));
  });
  try {
    const r = await hs.postChatStream(url, BODY, {}, 5000);
    assert.equal(r.choices[0].message.content, "整份");
  } finally { srv.close(); }
});

test("postChatStream：流中途断开（没有 [DONE] 也没 finish）→ 可重试的连接错误", async () => {
  const { srv, url } = await startServer((req, res) => sse(res, [{ choices: [{ delta: { content: "半截" } }] }], { done: false }));
  try {
    await assert.rejects(() => hs.postChatStream(url, BODY, {}, 5000), (e) => hs.isRetryable(e));
  } finally { srv.close(); }
});

test("postChatStream：HTTP 错误带 httpStatus；4xx 不重试，502/429 重试", async () => {
  const { srv, url } = await startServer((req, res) => { res.writeHead(401); res.end("bad key"); });
  try {
    const e = await hs.postChatStream(url, BODY, {}, 5000).catch((x) => x);
    assert.equal(e.httpStatus, 401);
    assert.equal(hs.isRetryable(e), false);
  } finally { srv.close(); }
  assert.equal(hs.isRetryable(Object.assign(new Error("HTTP 502: x"), { httpStatus: 502 })), true);
  assert.equal(hs.isRetryable(Object.assign(new Error("HTTP 429: x"), { httpStatus: 429 })), true);
  assert.equal(hs.isRetryable(new Error("read ETIMEDOUT [ETIMEDOUT]")), true);
  assert.equal(hs.isRetryable(new Error("上游返回空正文（HTTP 正常）")), false);
});

test("withRetry：前两次连接被掐、第三次成功 → 自动重试拿到结果", async () => {
  let hits = 0;
  const { srv, url } = await startServer((req, res) => {
    hits++;
    if (hits < 3) return req.socket.destroy();               // 模拟被中转站掐断
    sse(res, [{ choices: [{ delta: { content: "好了" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);
  });
  try {
    const r = await hs.withRetry(() => hs.postChatStream(url, BODY, {}, 5000), { delays: [0, 0], label: "t" });
    assert.equal(r.choices[0].message.content, "好了");
    assert.equal(hits, 3);
  } finally { srv.close(); }
});

test("withRetry：重试用尽 → 抛出可识别错误，friendlyNetError 说人话并带重试次数", async () => {
  let hits = 0;
  const { srv, url } = await startServer((req) => { hits++; req.socket.destroy(); });
  try {
    const e = await hs.withRetry(() => hs.postChatStream(url, BODY, {}, 5000), { delays: [0, 0], label: "t" }).catch((x) => x);
    assert.equal(hits, 3);
    const f = hs.friendlyNetError(e);
    assert.match(f.message, /上游连接中途断开（已自动重试 2 次仍失败）/);
    assert.match(f.message, /原始报错/);
  } finally { srv.close(); }
});

test("withRetry：业务错误（401）不重试，friendlyNetError 原样返回", async () => {
  let hits = 0;
  const { srv, url } = await startServer((req, res) => { hits++; res.writeHead(401); res.end("nope"); });
  try {
    const e = await hs.withRetry(() => hs.postChatStream(url, BODY, {}, 5000), { delays: [0, 0] }).catch((x) => x);
    assert.equal(hits, 1);
    assert.equal(hs.friendlyNetError(e), e);
  } finally { srv.close(); }
});

test("isStreamUnsupported：4xx 且报错提到 stream 才算不支持", () => {
  assert.equal(hs.isStreamUnsupported(new Error("HTTP 400: stream is not supported for this model")), true);
  assert.equal(hs.isStreamUnsupported(Object.assign(new Error("x stream"), { httpStatus: 422 })), true);
  assert.equal(hs.isStreamUnsupported(new Error("HTTP 400: invalid json")), false);
  assert.equal(hs.isStreamUnsupported(new Error("HTTP 500: stream failed")), false);
});
