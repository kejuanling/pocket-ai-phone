'use strict';
// Gemini 适配器工具调用往返（2026-11-04）：
//   OpenAI tools ⇄ Gemini functionDeclarations、assistant.tool_calls ⇄ functionCall、
//   role:tool ⇄ functionResponse、响应 functionCall ⇄ tool_calls（含流式）。
// 运行：node tests/gemini-adapter/test_tool_roundtrip.js
const assert = require('assert');
const gm = require('../../lib/gemini-adapter');

let failed = 0;
function ok(cond, name, extra) {
  if (cond) { console.log('ok ' + name); return; }
  failed++; process.exitCode = 1;
  console.error('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra)));
}

// ---- 1. 纯文本回归 ----
{
  const req = gm.toRequest({
    messages: [
      { role: 'system', content: '人设' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '在' },
      { role: 'user', content: '' },
    ],
  });
  ok(req.contents.length === 2, '纯文本：空 user 消息跳过', req.contents);
  ok(req.contents[0].role === 'user' && req.contents[0].parts[0].text === '你好', '纯文本：user 内容');
  ok(req.contents[1].role === 'model' && req.contents[1].parts[0].text === '在', '纯文本：assistant→model');
  ok(req.systemInstruction.parts[0].text === '人设', '纯文本：systemInstruction');
  ok(!req.tools, '纯文本：无 tools 字段');
}

// ---- 2. tools 翻译：type 大写、未知关键字丢弃、无参工具 ----
{
  const req = gm.toRequest({
    messages: [{ role: 'user', content: '查天气' }],
    tools: [
      { type: 'function', function: { name: 'get_weather', description: '查天气', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市' }, days: { type: 'integer', enum: [1, 2] } }, required: ['city'], additionalProperties: false, $schema: 'x' } } },
      { type: 'function', function: { name: 'noop', description: '' } },
    ],
  });
  ok(Array.isArray(req.tools) && req.tools.length === 1, 'tools：单个 tools 包一层');
  const decls = req.tools[0].functionDeclarations;
  ok(decls.length === 2, 'tools：两个声明', decls.length);
  ok(decls[0].name === 'get_weather', 'tools：函数名');
  ok(decls[0].parameters.type === 'OBJECT', 'tools：type 大写 OBJECT', decls[0].parameters);
  ok(decls[0].parameters.properties.city.type === 'STRING', 'tools：嵌套属性 type 大写');
  ok(decls[0].parameters.properties.days.enum && decls[0].parameters.properties.days.enum.length === 2, 'tools：enum 保留');
  ok(decls[0].parameters.required[0] === 'city', 'tools：required 保留');
  ok(!('additionalProperties' in decls[0].parameters) && !('$schema' in decls[0].parameters), 'tools：未知关键字被丢弃', decls[0].parameters);
  ok(!decls[1].parameters, 'tools：无参工具不带 parameters');
  ok(!req.toolConfig, 'tools：未给 tool_choice 时不发 toolConfig');
}

// ---- 3. tool_choice 映射 ----
{
  const map = function (tc) { return gm.toRequest({ messages: [{ role: 'user', content: 'x' }], tools: [{ function: { name: 'f' } }], tool_choice: tc }).toolConfig; };
  ok(map('auto') === undefined, 'tool_choice auto：不发（默认 AUTO）');
  ok(map('none').functionCallingConfig.mode === 'NONE', 'tool_choice none → NONE');
  ok(map('required').functionCallingConfig.mode === 'ANY', 'tool_choice required → ANY');
  const named = map({ type: 'function', function: { name: 'f' } });
  ok(named.functionCallingConfig.mode === 'ANY' && named.functionCallingConfig.allowedFunctionNames[0] === 'f', 'tool_choice 具名 → ANY+allowlist');
}

// ---- 4. 工具往返：assistant.tool_calls → functionCall，role:tool → functionResponse ----
{
  const req = gm.toRequest({
    messages: [
      { role: 'system', content: '系统' },
      { role: 'user', content: '查天气' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temp":25}' },
    ],
    tools: [{ function: { name: 'get_weather' } }],
  });
  ok(req.contents.length === 3, '往返：user/model/user 三段', req.contents.length);
  const modelTurn = req.contents[1];
  ok(modelTurn.role === 'model' && modelTurn.parts.length === 1 && modelTurn.parts[0].functionCall.name === 'get_weather', '往返：functionCall part', modelTurn);
  ok(modelTurn.parts[0].functionCall.args.city === '北京', '往返：args 解析成对象');
  const toolTurn = req.contents[2];
  ok(toolTurn.role === 'user' && toolTurn.parts[0].functionResponse.name === 'get_weather', '往返：functionResponse 在 user turn', toolTurn);
  ok(toolTurn.parts[0].functionResponse.response.temp === 25, '往返：JSON 结果原样作 response');
}

// ---- 5. 连续两个工具结果合并成一个 user turn ----
{
  const req = gm.toRequest({
    messages: [
      { role: 'user', content: '查两个' },
      { role: 'assistant', content: '好的', tool_calls: [
        { id: 'a', type: 'function', function: { name: 'f1', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'f2', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'a', content: '结果一' },
      { role: 'tool', tool_call_id: 'b', content: '结果二' },
      { role: 'assistant', content: '汇总' },
    ],
  });
  ok(req.contents.length === 4, '并行工具：user/model/user/model 四段', req.contents.length);
  const t = req.contents[2];
  ok(t.parts.length === 2, '并行工具：两个 functionResponse 合并一个 turn', t.parts.length);
  ok(t.parts[0].functionResponse.name === 'f1' && t.parts[1].functionResponse.name === 'f2', '并行工具：按调用顺序配对');
  ok(req.contents[1].parts[0].text === '好的', '并行工具：model turn 文本 + 两个 functionCall', req.contents[1].parts.length === 3);
}

// ---- 6. 漏答工具结果补哑响应（历史残缺不 400） ----
{
  const req = gm.toRequest({
    messages: [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'maybe', arguments: '{}' } }] },
      { role: 'user', content: '算了继续' },
    ],
  });
  ok(req.contents.length === 4, '漏答：多出一个补哑 turn', req.contents.length);
  const toolTurn = req.contents[2];
  ok(toolTurn.role === 'user' && toolTurn.parts[0].functionResponse.name === 'maybe', '漏答：补哑 functionResponse', toolTurn);
  ok(String(toolTurn.parts[0].functionResponse.response.result).indexOf('缺失') >= 0, '漏答：哑响应带提示');
}

// ---- 7. 字符串工具结果包 {result} ----
{
  const req = gm.toRequest({
    messages: [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'z', type: 'function', function: { name: 'g', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'z', content: '纯文本结果' },
    ],
  });
  ok(req.contents[2].parts[0].functionResponse.response.result === '纯文本结果', '字符串结果 → {result}');
}

// ---- 8. 响应翻译：functionCall → tool_calls + finish_reason ----
{
  const j = { response: { candidates: [{ content: { role: 'model', parts: [{ text: '查一下' }, { functionCall: { name: 'get_weather', args: { city: '上海' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } } };
  const out = gm.fromResponse(j, 'gemini-3.5-flash-lite');
  const ch = out.choices[0];
  ok(ch.finish_reason === 'tool_calls', '响应：有 functionCall 时 finish_reason=tool_calls', ch.finish_reason);
  ok(ch.message.content === '查一下', '响应：文本保留');
  ok(ch.message.tool_calls.length === 1, '响应：一个 tool_call');
  ok(ch.message.tool_calls[0].type === 'function', '响应：tool_call type');
  ok(ch.message.tool_calls[0].function.name === 'get_weather', '响应：tool_call 名字');
  ok(JSON.parse(ch.message.tool_calls[0].function.arguments).city === '上海', '响应：arguments 是 JSON 字符串');
  ok(out.usage.total_tokens === 15, '响应：usage');

  const plain = gm.fromResponse({ candidates: [{ content: { parts: [{ text: '好' }] }, finishReason: 'STOP' }] }, 'm');
  ok(plain.choices[0].finish_reason === 'stop' && !plain.choices[0].message.tool_calls, '响应：纯文本无 tool_calls');
}

// ---- 9. toolCallsFromParts 多个 + partsOf ----
{
  const parts = [{ functionCall: { name: 'a', args: {} } }, { text: '中间' }, { functionCall: { name: 'b', args: { n: 1 } } }];
  const calls = gm.toolCallsFromParts(parts);
  ok(calls.length === 2 && calls[0].function.name === 'a' && calls[1].function.name === 'b', 'parts：多个 functionCall 顺序正确');
  ok(calls.every(function (c) { return /^call_gm_/.test(c.id); }), 'parts：自造 id 前缀');
  ok(gm.partsOf({ content: { parts: parts } }).length === 3, 'partsOf：取 parts');
  ok(gm.partsOf(null).length === 0, 'partsOf：null 安全');
}

// ---- 10. 流式文本差量自适应 ----
{
  ok(gm.textDeltaAdaptive('你好世界', '') === '你好世界', '差量：首片全发');
  ok(gm.textDeltaAdaptive('你好世界', '你好') === '世界', '差量：累积模式发差量');
  ok(gm.textDeltaAdaptive('世界', '你好') === '世界', '差量：增量模式整片发');
  ok(gm.textDeltaAdaptive('', '你好') === '', '差量：空片不发');
}

// ---- 11. user 空文本占位 + 完全空请求 ----
{
  const req = gm.toRequest({ messages: [] });
  ok(req.contents.length === 1 && req.contents[0].parts[0].text === ' ', '空请求：占位空格（protobuf oneof 防 400）');
  // Cloud Code 后端拒绝以 model 开头的会话：首条 assistant 前要补一条 user
  const req2 = gm.toRequest({ messages: [{ role: 'assistant', content: '嗯' }] });
  ok(req2.contents.length === 2 && req2.contents[0].role === 'user' && req2.contents[1].role === 'model', '首条 assistant：补 user 前置', req2.contents.map(function (x) { return x.role; }));
}

// ---- 12. anyOf 拍平时外层自带 properties（11-15）----
// 组合节点（anyOf/oneOf/allOf）自己还带 properties 时，外层这些子 schema 也必须过 toGeminiSchema：
// 否则 OpenAI 关键字（$schema/additionalProperties）与小写 type 会原样发上游，白名单清洗被绕过。
{
  const req = gm.toRequest({
    messages: [{ role: 'user', content: '查天气' }],
    tools: [{ type: 'function', function: { name: 'combo', description: '组合', parameters: {
      anyOf: [{ type: 'object' }, { type: 'null' }],
      description: '外层描述',
      properties: {
        city: { type: 'string', description: '城市', additionalProperties: false, $schema: 'x' },
        days: { type: 'integer', enum: [1, 2] },
      },
      required: ['city'],
    } } }],
  });
  const p = req.tools[0].functionDeclarations[0].parameters;
  ok(p.type === 'OBJECT', 'anyOf 外层 properties：本体 type 保留（拍平后仍 OBJECT）', p);
  ok(p.properties && p.properties.city && p.properties.city.type === 'STRING', 'anyOf 外层 properties：子 schema type 转大写', p.properties);
  ok(!('additionalProperties' in p.properties.city) && !('$schema' in p.properties.city), 'anyOf 外层 properties：子 schema 未知关键字被丢弃', p.properties.city);
  ok(p.properties.days.type === 'INTEGER' && p.properties.days.enum && p.properties.days.enum.length === 2, 'anyOf 外层 properties：子 schema enum 保留');
  ok(Array.isArray(p.required) && p.required[0] === 'city', 'anyOf 外层 properties：required 保留', p.required);
  ok(p.description === '外层描述', 'anyOf 外层 properties：外层 description 保留', p.description);
  ok(p.properties.city.description === '城市', 'anyOf 外层 properties：子 schema description 保留');
}

console.log(failed ? ('\nFAILED: ' + failed) : '\nALL PASS');
