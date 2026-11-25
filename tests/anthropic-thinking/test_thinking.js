'use strict';
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// Claude 思考链（2026-10-28）：请求形态、终帧带签名块、工具循环续轮原样回传、关档零参数。
// 全部离线；不碰真实账号、不写业务数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const adapter = require('../../lib/anthropic-adapter');
const loop = require('../../mcp/mcp-tool-loop');
const chatCtx = require('../../routes/chat-context');
const { createSessionCfg } = require('../../lib/session-cfg');

const MSGS = [{ role: 'user', content: '在吗' }];
const BLOCK = Object.freeze({ type: 'thinking', thinking: '先想一下', signature: 'sig-keep-bytes' });

test('请求形态：4.6/5.x 用 adaptive+effort+summarized，且剥采样参数', () => {
  for (const model of ['claude-opus-4-6', 'claude-opus-5-5']) {
    const req = adapter.toAnthropicRequest({ model, messages: MSGS, reasoning_effort: 'high', temperature: 0.7, top_p: 0.9 }, {});
    assert.deepEqual(req.thinking, { type: 'adaptive', display: 'summarized' }, model);
    assert.deepEqual(req.output_config, { effort: 'high' }, model);
    assert.equal(req.temperature, undefined, model + ' 不带 temperature');
    assert.equal(req.top_p, undefined, model + ' 不带 top_p');
  }
});

test('请求形态：关档 = 不发 thinking / output_config；5.x 不出现 legacy 字段', () => {
  const req = adapter.toAnthropicRequest({ model: 'claude-opus-5-5', messages: MSGS }, {});
  assert.equal(req.thinking, undefined);
  assert.equal(req.output_config, undefined);
  assert.equal(req.temperature, undefined); // 4.6+ 无论开关都拒采样参数
});

test('请求形态：老模型保留 enabled+budget_tokens，effort 映射预算', () => {
  const req = adapter.toAnthropicRequest({ model: 'claude-3-7-sonnet', messages: MSGS, reasoning_effort: 'medium' }, {});
  assert.deepEqual(req.thinking, { type: 'enabled', budget_tokens: 4096, display: 'summarized' });
  assert.equal(req.output_config, undefined);
});

test('交错思考回放：anthropic_content_blocks 保住 thinking/tool_use 原顺序', () => {
  const ordered = [
    { type: 'thinking', thinking: '先想', signature: 'sig-1' },
    { type: 'tool_use', id: 'toolu_1', name: 'first', input: { a: 1 } },
    { type: 'thinking', thinking: '看完成绩再想', signature: 'sig-2' },
    { type: 'tool_use', id: 'toolu_2', name: 'second', input: { b: 2 } },
  ];
  const req = adapter.toAnthropicRequest({
    model: 'claude-opus-5-5',
    messages: [
      { role: 'assistant', content: '', anthropic_content_blocks: ordered, tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'first', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'ok' },
      { role: 'user', content: '继续' },
    ],
  }, {});
  const a = req.messages.find(m => m.role === 'assistant');
  assert.deepEqual(a.content, ordered);

  const strInputReq = adapter.toAnthropicRequest({
    model: 'claude-opus-5-5',
    messages: [{ role: 'assistant', content: '', anthropic_content_blocks: [{ type: 'tool_use', id: 'toolu_s', name: 'x', input: '{"a":1}' }] }],
  }, {});
  const strA = strInputReq.messages.find(m => m.role === 'assistant');   // 单条 assistant 开头会被前插占位 user
  assert.deepEqual(strA.content[0].input, { a: 1 });
});

test('历史回传：assistant.thinking_blocks 还原成原样 Anthropic 块', () => {
  const req = adapter.toAnthropicRequest({
    model: 'claude-opus-5-5',
    messages: [
      { role: 'assistant', content: '', thinking_blocks: [BLOCK, { type: 'redacted_thinking', data: 'redacted-data' }], tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'ok' },
      { role: 'user', content: '继续' },
    ],
  }, {});
  const a = req.messages.find(m => m.role === 'assistant');
  assert.deepEqual(a.content[0], { type: 'thinking', thinking: BLOCK.thinking, signature: BLOCK.signature });
  assert.deepEqual(a.content[1], { type: 'redacted_thinking', data: 'redacted-data' });
});

test('流式翻译：思考正文增量下发；终帧顶层带原样 thinking_blocks', () => {
  const tr = adapter.createStreamTranslator({ model: 'claude-opus-5-5' });
  const chunks = [
    ...tr.push({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 3 } } }),
    ...tr.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: BLOCK.thinking } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: BLOCK.signature } }),
    ...tr.push({ type: 'content_block_stop', index: 0 }),
    ...tr.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } }),
    ...tr.push({ type: 'message_stop' }),
  ];
  assert.equal(tr.done, true);
  assert.ok(chunks.some(c => c.choices && c.choices[0].delta && c.choices[0].delta.reasoning_content === BLOCK.thinking));
  const final = chunks[chunks.length - 1];
  assert.deepEqual(final.thinking_blocks, [BLOCK]);
});

test('流式翻译：终帧 content_blocks 按 thinking/text/tool_use 原顺序保存', () => {
  const tr = adapter.createStreamTranslator({ model: 'claude-opus-5-5' });
  const chunks = [
    ...tr.push({ type: 'message_start', message: {} }),
    ...tr.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先查' } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-a' } }),
    ...tr.push({ type: 'content_block_stop', index: 0 }),
    ...tr.push({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_9', name: 'lookup' } }),
    ...tr.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } }),
    ...tr.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } }),
    ...tr.push({ type: 'content_block_stop', index: 1 }),
    ...tr.push({ type: 'message_stop' }),
  ];
  assert.deepEqual(chunks[chunks.length - 1].content_blocks, [
    { type: 'thinking', thinking: '先查', signature: 'sig-a' },
    { type: 'tool_use', id: 'toolu_9', name: 'lookup', input: { q: 1 } },
  ]);
});

test('空正文块：不产生思考增量，但签名块仍随终帧给工具循环', () => {
  const tr = adapter.createStreamTranslator({ model: 'claude-opus-5-5' });
  const chunks = [
    ...tr.push({ type: 'message_start', message: {} }),
    ...tr.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'only-sig' } }),
    ...tr.push({ type: 'content_block_stop', index: 0 }),
    ...tr.push({ type: 'message_stop' }),
  ];
  assert.ok(!chunks.some(c => c.choices && c.choices[0].delta && c.choices[0].delta.reasoning_content));
  assert.deepEqual(chunks[chunks.length - 1].thinking_blocks, [{ type: 'thinking', thinking: '', signature: 'only-sig' }]);
});

test('流式翻译：content_block_stop 乱序到达也按 index 还原顺序', () => {
  const tr = adapter.createStreamTranslator({ model: 'claude-opus-5-5' });
  const chunks = [
    ...tr.push({ type: 'message_start', message: {} }),
    ...tr.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'first' } }),
    ...tr.push({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-o' } }),
    ...tr.push({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_o', name: 'lookup' } }),
    ...tr.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }),
    // 故意先停 index 1 再停 index 0
    ...tr.push({ type: 'content_block_stop', index: 1 }),
    ...tr.push({ type: 'content_block_stop', index: 0 }),
    ...tr.push({ type: 'message_stop' }),
  ];
  assert.deepEqual(chunks[chunks.length - 1].content_blocks, [
    { type: 'thinking', thinking: 'first', signature: 'sig-o' },
    { type: 'tool_use', id: 'toolu_o', name: 'lookup', input: {} },
  ]);
});

test('非流式翻译：message.content_blocks 与上游 content 顺序一致', () => {
  const out = adapter.fromAnthropicResponse({ content: [
    { type: 'thinking', thinking: '想一下', signature: 'sig-n' },
    { type: 'text', text: '我先查。' },
    { type: 'tool_use', id: 'toolu_n', name: 'noop', input: { x: true } },
  ] });
  assert.deepEqual(out.choices[0].message.content_blocks, [
    { type: 'thinking', thinking: '想一下', signature: 'sig-n' },
    { type: 'text', text: '我先查。' },
    { type: 'tool_use', id: 'toolu_n', name: 'noop', input: { x: true } },
  ]);
});

test('形状净化：无签名 thinking / 无 data redacted 丢弃，合法块字节不动', () => {
  const good = { type: 'thinking', thinking: 'x', signature: 's' };
  const redacted = { type: 'redacted_thinking', data: 'd' };
  const out = loop.normalizeThinkingBlocks([{ type: 'thinking', thinking: '坏块' }, { type: 'redacted_thinking' }, good, redacted]);
  assert.deepEqual(out, [good, redacted]);
});

function sseBody(events) {
  return events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
}
function streamResp(text) {
  return { ok: true, status: 200, text: async () => '', body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }) };
}
const BASE = {
  upstreamUrl: 'http://x', upstreamKey: 'k', model: 'claude-opus-5-5',
  messages: [{ role: 'user', content: '查一下' }], serverClients: [], maxToolRounds: 2,
};

test('流式工具循环：第二轮 assistant 原样带回 thinking_blocks 和 effort', async () => {
  const seen = [];
  const block = { type: 'thinking', thinking: '要查', signature: 'sig-round-1' };
  const orderedBlocks = [block, { type: 'tool_use', id: 'call_1', name: 'noop', input: {} }];
  const fetchFn = async (url, opts) => {
    seen.push(JSON.parse(opts.body));
    if (seen.length === 1) return streamResp(sseBody([
      { choices: [{ delta: { reasoning_content: '要查' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'noop', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { total_tokens: 1 }, thinking_blocks: [block], content_blocks: orderedBlocks },
    ]));
    return streamResp(sseBody([
      { choices: [{ delta: { content: '好了' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 2 } },
    ]));
  };
  const r = await loop.streamToolLoop(Object.assign({}, BASE, { fetchFn, reasoningEffort: 'high' }));
  assert.equal(r.text, '好了');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].reasoning_effort, 'high');
  assert.equal(seen[1].reasoning_effort, 'high');
  const a = seen[1].messages.find(m => m.role === 'assistant' && m.tool_calls);
  assert.ok(a, '第二轮含工具调用 assistant');
  assert.deepEqual(a.thinking_blocks, [block]);
  assert.deepEqual(a.anthropic_content_blocks, orderedBlocks);
  const replayReq = adapter.toAnthropicRequest({ model: BASE.model, messages: seen[1].messages });
  const replayA = replayReq.messages.find(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(x => x.type === 'tool_use'));
  assert.deepEqual(replayA.content, orderedBlocks);
});

test('非流式兜底：message.thinking_blocks 同样进入下一轮 assistant', async () => {
  const seen = [];
  const block = { type: 'redacted_thinking', data: 'redacted-round' };
  const orderedBlocks = [block, { type: 'tool_use', id: 'call_2', name: 'noop', input: {} }];
  const fetchFn = async (url, opts) => {
    seen.push(JSON.parse(opts.body));
    if (seen.length === 1) return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'noop', arguments: '{}' } }],
            thinking_blocks: [block], content_blocks: orderedBlocks,
          },
          finish_reason: 'tool_calls',
        }],
        usage: {},
      }),
    };
    return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '好了' }, finish_reason: 'stop' }], usage: {} }) };
  };
  const r = await loop.runWithTools(Object.assign({}, BASE, { fetchFn, reasoningEffort: 'low' }));
  assert.equal(r.text, '好了');
  const a = seen[1].messages.find(m => m.role === 'assistant' && m.tool_calls);
  assert.deepEqual(a.thinking_blocks, [block]);
  assert.deepEqual(a.anthropic_content_blocks, orderedBlocks);
});

test('出口净化：thinking_blocks 不落普通历史 / 不发给非 Anthropic 上游', () => {
  const clean = chatCtx.sanitizeForUpstream([{ role: 'assistant', content: 'hi', reasoning: '看完了', thinking_blocks: [BLOCK], anthropic_content_blocks: [BLOCK] }]);
  assert.deepEqual(clean, [{ role: 'assistant', content: 'hi', reasoning_content: '看完了' }]);
});

test('会话配置：档位只收 low/medium/high，off 删除键且不影响同文件其它配置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-cfg-'));
  try {
    const cfg = createSessionCfg(dir);
    fs.ensureDirSync(path.join(dir, 'data', 'session_cfg'));
    fs.writeJsonSync(path.join(dir, 'data', 'session_cfg', 's_test.json'), { mcp_exact: true });
    assert.equal(cfg.readClaudeThinkingEffort('s_test'), null);
    assert.equal(cfg.saveClaudeThinkingEffort('s_test', 'high'), 'high');
    assert.equal(cfg.readClaudeThinkingEffort('s_test'), 'high');
    assert.equal(cfg.saveClaudeThinkingEffort('s_test', 'bad'), null);
    assert.equal(cfg.readClaudeThinkingEffort('s_test'), null);
    assert.equal(cfg.readMcpExact('s_test'), true);
  } finally {
    fs.removeSync(dir);
  }
});

test('路由读档：model-provider 带实际是否 Claude；claude-thinking GET/POST 行为正确', async () => {
  const routes = new Map();
  const app = {};
  for (const verb of ['get', 'post', 'put', 'delete']) {
    app[verb] = function (p, h) { routes.set(verb.toUpperCase() + ' ' + p, h); };
  }
  let saved = null;
  require('../../routes/chat')(app, {
    baseDir: PROJECT_ROOT,
    resolveChatModel: async () => ({ provider: { id: 'p_claude_sub', oauth_provider: 'claude' }, model: 'claude-opus-5-5' }),
    sessionModelProviderOverride: () => null,
    sessionModelNameOverride: () => null,
    readClaudeThinkingEffort: () => saved,
    saveClaudeThinkingEffort: (_sid, v) => { saved = v; return v; },
  });
  function reply() { return { code(n) { this.status = n; return this; }, send(v) { this.body = v; return this; } }; }

  const r1 = reply();
  await routes.get('GET /v1/sessions/:id/model-provider')({ params: { id: 's_test' } }, r1);
  assert.equal(r1.body.effective_is_claude, true);
  assert.equal(r1.body.effective_model, 'claude-opus-5-5');

  const r2 = reply();
  await routes.get('GET /v1/sessions/:id/claude-thinking')({ params: { id: 's_test' } }, r2);
  assert.equal(r2.body.effort, 'off');

  const r3 = reply();
  await routes.get('POST /v1/sessions/:id/claude-thinking')({ params: { id: 's_test' }, body: { effort: 'medium' } }, r3);
  assert.equal(r3.body.ok, true);
  assert.equal(r3.body.effort, 'medium');

  const r4 = reply();
  await routes.get('POST /v1/sessions/:id/claude-thinking')({ params: { id: 's_test' }, body: { effort: 'xhigh' } }, r4);
  assert.equal(r4.status, 400);
});
