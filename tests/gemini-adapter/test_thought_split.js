'use strict';
// Gemini/Antigravity 思考链分离（2026-11-12）：
//   上游把思考放在 {thought:true, text:...} 的 part 里（gpt-oss-120b-medium 实测），
//   翻译层必须与正文分开：正文进 content，思考进 reasoning_content。
//   样本取自 2026-11-12 真实探针（scripts/probe-antigravity.js 直连）。
// 运行：node tests/gemini-adapter/test_thought_split.js
const assert = require('assert');
const gm = require('../../lib/gemini-adapter');

let failed = 0;
function ok(cond, name, extra) {
  if (cond) { console.log('ok ' + name); return; }
  failed++; process.exitCode = 1;
  console.error('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra)));
}

// 探针实测形状：part[0] 正文无标记，part[1] 思考带 thought:true
function upJson(text, thoughtText) {
  const parts = [];
  if (text) parts.push({ text: text });
  if (thoughtText) parts.push({ thought: true, text: thoughtText });
  return { response: { candidates: [{ content: { parts: parts }, finishReason: 'STOP' }] } };
}

// ---- 1. 非流式：思考进 reasoning_content，正文干净 ----
{
  const o = gm.fromResponse(upJson('我是基于GPT‑4架构的大语言模型。', 'User asks in Chinese: "Do you know which model you are?"'), 'gpt-oss-120b-medium');
  const m = o.choices[0].message;
  ok(m.content === '我是基于GPT‑4架构的大语言模型。', '非流式：正文不含思考', m.content);
  ok(m.reasoning_content === 'User asks in Chinese: "Do you know which model you are?"', '非流式：思考进 reasoning_content', m.reasoning_content);
  ok(!m.tool_calls, '非流式：无 tool_calls');
}

// ---- 2. 无思考 part：行为与旧版一致（不添 reasoning_content 字段） ----
{
  const o = gm.fromResponse(upJson('正常'), 'gemini-3.8-flash-medium');
  const m = o.choices[0].message;
  ok(m.content === '正常', '无思考：正文原样', m.content);
  ok(m.reasoning_content === undefined, '无思考：不产生空 reasoning_content', m.reasoning_content);
}

// ---- 3. 工具调用 + 思考混合 ----
{
  const j = { response: { candidates: [{ content: { parts: [
    { thought: true, text: 'need weather' },
    { functionCall: { name: 'get_weather', args: { city: '北京' } } },
  ] }, finishReason: 'STOP' }] } };
  const o = gm.fromResponse(j, 'gpt-oss-120b-medium');
  const m = o.choices[0].message;
  ok(o.choices[0].finish_reason === 'tool_calls', '混合：finish=tool_calls');
  ok(Array.isArray(m.tool_calls) && m.tool_calls[0].function.name === 'get_weather', '混合：tool_calls 保留');
  ok(m.reasoning_content === 'need weather', '混合：思考照常进 reasoning_content', m.reasoning_content);
}

// ---- 4. 提取函数单测 ----
{
  const c = { content: { parts: [{ text: 'A' }, { thought: true, text: 'T1' }, { text: 'B' }, { thought: true, text: 'T2' }] } };
  ok(gm.textFromCandidate(c) === 'AB', 'textFromCandidate：滤掉 thought part', gm.textFromCandidate(c));
  ok(gm.thoughtFromCandidate(c) === 'T1T2', 'thoughtFromCandidate：只取思考', gm.thoughtFromCandidate(c));
  ok(gm.thoughtFromCandidate({ content: { parts: [{ text: 'A' }] } }) === '', 'thoughtFromCandidate：无思考返回空串');
}

// ---- 5. 流式差量复用：思考与正文各自独立累积/差量 ----
{
  // 上游累积模式：思考 chunk 全量重复
  let st = '';
  let d1 = gm.textDeltaAdaptive(gm.thoughtFromCandidate({ content: { parts: [{ thought: true, text: 'think ' }] } }), st);
  st += d1;
  let d2 = gm.textDeltaAdaptive(gm.thoughtFromCandidate({ content: { parts: [{ thought: true, text: 'think more' }] } }), st);
  st += d2;
  ok(d1 === 'think ' && d2 === 'more' && st === 'think more', '流式思考：累积模式差量正确', { d1: d1, d2: d2, st: st });

  // 增量模式：思考碎片直发
  st = '';
  const f1 = gm.textDeltaAdaptive('The', st); st += f1;
  const f2 = gm.textDeltaAdaptive(' user asks', st); st += f2;
  ok(f1 === 'The' && f2 === ' user asks' && st === 'The user asks', '流式思考：增量模式碎片不丢字', { f1: f1, f2: f2, st: st });

  // 正文累积不受思考累积干扰
  let sent = '';
  const c1 = gm.textDeltaAdaptive(gm.textFromCandidate({ content: { parts: [{ thought: true, text: 'T' }, { text: '正文' }] } }), sent);
  sent += c1;
  const c2 = gm.textDeltaAdaptive(gm.textFromCandidate({ content: { parts: [{ thought: true, text: 'T' }, { text: '正文第二句' }] } }), sent);
  ok(c1 === '正文' && c2 === '第二句', '流式：正文差量不受 thought part 干扰', { c1: c1, c2: c2 });
}

// ---- 6. 回传安全：带 reasoning_content 的 assistant 历史不会把思考塞回正文 ----
{
  const req = gm.toRequest({
    messages: [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '答', reasoning_content: '思考内容' },
      { role: 'user', content: '继续' },
    ],
  });
  const modelTurn = req.contents[1];
  ok(modelTurn.role === 'model' && modelTurn.parts.length === 1 && modelTurn.parts[0].text === '答',
    '回传：reasoning_content 不进 contents', modelTurn);
}

if (failed) console.error('FAILED: ' + failed);
else console.log('ALL PASS');
