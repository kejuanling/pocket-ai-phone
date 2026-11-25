'use strict';
// Gemini 工具签名占位（2026-11-04）：
//   Gemini 3 的 functionCall 回放必须带 thoughtSignature，缺了 400；
//   主链路历史里没有签名载体，用 Gemini 官方接受的哨兵值补上。
// 运行：node tests/gemini-tool-sig/test_stamp.js
const assert = require('assert');
const sig = require('../../lib/gemini-tool-sig');

let failed = 0;
function ok(cond, name, extra) {
  if (cond) { console.log('ok ' + name); return; }
  failed++; process.exitCode = 1;
  console.error('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra)));
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const OTHER_URL = 'https://api.deepseek.com/v1/chat/completions';

// 1. 端点识别
{
  ok(sig.isGeminiEndpoint(GEMINI_URL), '识别 Gemini 官方端点');
  ok(!sig.isGeminiEndpoint(OTHER_URL), '非 Gemini 端点不识别');
  ok(!sig.isGeminiEndpoint(''), '空串安全');
  ok(!sig.isGeminiEndpoint(null), 'null 安全');
}

// 2. 非 Gemini 端点：原样返回（同一引用，零改动）
{
  const msgs = [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] }];
  const out = sig.maybeStamp(msgs, OTHER_URL);
  ok(out === msgs, '非 Gemini：同一引用');
  ok(!msgs[0].tool_calls[0].extra_content, '非 Gemini：不加字段');
}

// 3. Gemini 端点：补哨兵
{
  const msgs = [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] }];
  const out = sig.maybeStamp(msgs, GEMINI_URL);
  ok(out !== msgs, 'Gemini：返回新数组（不污染原对象）');
  ok(!msgs[0].tool_calls[0].extra_content, 'Gemini：原对象未被修改');
  ok(out[0].tool_calls[0].extra_content.google.thought_signature === sig.SENTINEL, 'Gemini：补上哨兵值');
}

// 4. 已有真签名：不覆盖
{
  const msgs = [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f' }, extra_content: { google: { thought_signature: 'REAL_SIG' } } }] }];
  const out = sig.maybeStamp(msgs, GEMINI_URL);
  ok(out[0].tool_calls[0].extra_content.google.thought_signature === 'REAL_SIG', 'Gemini：已有真签名不覆盖');
}

// 5. 多工具 / 多轮 / 无 tool_calls 的消息
{
  const msgs = [
    { role: 'user', content: '北京和上海' },
    { role: 'assistant', content: '', tool_calls: [
      { id: 'a', type: 'function', function: { name: 'w', arguments: '{"c":"北京"}' } },
      { id: 'b', type: 'function', function: { name: 'w', arguments: '{"c":"上海"}' } },
    ] },
    { role: 'tool', tool_call_id: 'a', content: '晴' },
    { role: 'tool', tool_call_id: 'b', content: '雨' },
    { role: 'assistant', content: '都查到了' },
  ];
  const out = sig.maybeStamp(msgs, GEMINI_URL);
  ok(out[1].tool_calls.every(function (tc) { return tc.extra_content.google.thought_signature === sig.SENTINEL; }), 'Gemini：并行工具每个都补');
  ok(out[0] === msgs[0] && out[2] === msgs[2] && out[4] === msgs[4], 'Gemini：无关消息原引用返回');
  ok(!out[4].extra_content, 'Gemini：无 tool_calls 的 assistant 不动');
}

// 6. 空/异常输入安全
{
  ok(sig.maybeStamp(null, GEMINI_URL) === null, 'null messages 安全');
  ok(Array.isArray(sig.maybeStamp([], GEMINI_URL)) && sig.maybeStamp([], GEMINI_URL).length === 0, '空数组安全');
  const bad = [{ role: 'assistant', tool_calls: [null, { id: 'x' }, { id: 'y', function: { name: 'f' } }] }];
  const out = sig.maybeStamp(bad, GEMINI_URL);
  ok(out[0].tool_calls[2].extra_content.google.thought_signature === sig.SENTINEL, '异常 tool_calls 跳过坏项', out[0].tool_calls);
}

// 7. 保留原有 extra_content 的其它键
{
  const msgs = [{ role: 'assistant', tool_calls: [{ id: 'c', function: { name: 'f' }, extra_content: { other: 1, google: { keep: 'x' } } }] }];
  const out = sig.maybeStamp(msgs, GEMINI_URL);
  ok(out[0].tool_calls[0].extra_content.other === 1 && out[0].tool_calls[0].extra_content.google.keep === 'x' && out[0].tool_calls[0].extra_content.google.thought_signature === sig.SENTINEL, 'Gemini：合并而不覆盖其它键');
}

console.log(failed ? ('\nFAILED: ' + failed) : '\nALL PASS');
