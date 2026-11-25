'use strict';
// Claude 出口 developer 原位转 user（2026-10-31）：
//   唤醒块/回执不再并入顶层 system，第一条真实对话之后的 developer 原位转 user 并细分标注；
//   头部注入块照旧并入 system；default 出口不受影响。
// 2026-11-12：gemini 出口改为与 claude 同款（产品确定，修 Antigravity「结尾 model 回合」400），
//   文件尾补了经 gemini-adapter 的端到端断言。
// 2026-11-25：grok 出口改为与 claude 同款（产品确定只改 Grok 订阅、沿用三个系统前缀），
//   并保留 default 的 assistant 思考字段处理；补经 grok-responses.toResponsesRequest 的端到端断言。
// 运行：node tests/role-mapper/test_claude_dev_position.js
const assert = require('assert');
const { mapMessagesForProvider } = require('../../lib/role-mapper');

function ok(cond, name) { if (!cond) { console.error('FAIL: ' + name); process.exitCode = 1; } else { console.log('ok ' + name); } }

const WAKE = '这是一次系统唤醒，当前时间：2026-10-31 05:30。距离上一次对话：1 分钟前。\n自由活动。';
const RCV = '本次未推送。下一次系统自动唤醒时间：2026-10-31 13:30';
const OTHER = '（记忆浮现）某条旧记忆';
const msgs = [
  { role: 'system', content: '人设正文' },
  { role: 'developer', content: '头部注入块A（永久上下文）' },
  { role: 'developer', content: '头部注入块B（状态摘要）' },
  { role: 'user', content: '她好' },
  { role: 'assistant', content: '我在' },
  { role: 'developer', content: WAKE },
  { role: 'developer', content: RCV },
  { role: 'developer', content: OTHER },
  { role: 'user', content: '她在说话' },
];

const out = mapMessagesForProvider('claude', msgs);

// 条数：头部 2 条 developer 并入 system（-2），对话中 3 条 developer 转 user（条数不变）：8 - 2 = 6 条 +? 原始 9 条 - 2 = 7
ok(out.length === 7, '消息条数 9→7（两条头部 developer 并入 system）');

// 顶层 system：人设 + 头部注入块，不含唤醒块/回执
ok(out[0].role === 'system', '首条是 system');
ok(out[0].content.indexOf('人设正文') >= 0 && out[0].content.indexOf('头部注入块A') >= 0 && out[0].content.indexOf('头部注入块B') >= 0, 'system=人设+头部注入块');
ok(out[0].content.indexOf('这是一次系统唤醒') < 0 && out[0].content.indexOf('本次未推送') < 0, 'system 不含唤醒块/回执');
ok(out.filter(m => m.role === 'system').length === 1, 'system 只有 1 条（供 anthropic-adapter 抬顶层+缓存断点）');

// 唤醒块/回执/其他 developer：原位转 user + 细分标注 + 标记
const iWake = out.findIndex(m => typeof m.content === 'string' && m.content.indexOf(WAKE) >= 0);
const iRcv = out.findIndex(m => typeof m.content === 'string' && m.content.indexOf(RCV) >= 0);
const iOther = out.findIndex(m => typeof m.content === 'string' && m.content.indexOf(OTHER) >= 0);
ok(iWake === 3 && iRcv === 4 && iOther === 5, '转换消息按原顺序原位排列（out[3..5]，assistant 之后、她的下一条 user 之前）');
ok(out[6].role === 'user' && out[6].content === '她在说话', '她的下一条真实 user 仍在末位');
ok(out[iWake].role === 'user' && out[iWake].content.indexOf('[系统唤醒] ') === 0, '唤醒块 → user + [系统唤醒] 前缀');
ok(out[iRcv].role === 'user' && out[iRcv].content.indexOf('[系统回执] ') === 0, '回执 → user + [系统回执] 前缀');
ok(out[iOther].role === 'user' && out[iOther].content.indexOf('[系统消息] ') === 0, '其余 developer → user + [系统消息] 前缀');
ok(out[iWake]._fromDeveloper === true && out[iRcv]._fromDeveloper === true, '转换消息带 _fromDeveloper 标记（供 injectElapsed 跳过）');
// 2026-11-11：转出的块末尾统一补一个空行（\n\n），否则 anthropic-adapter 合并相邻 user 后，
// 回执（「[系统回执] 未发送推送：……」）会和紧随其后的真实 user 消息粘成一句；正文本身不变。
ok(out[iWake].content === '[系统唤醒] ' + WAKE + '\n\n', '内容除前缀与末尾空行外逐字不变');
ok(out[iRcv].content === '[系统回执] ' + RCV + '\n\n', '回执末尾带空行（与后一条真实 user 分隔）');
ok(out[1].role === 'user' && out[1].content === '她好', '真实 user 消息不动、无标记');
// 2026-11-11：回执只报失败后的三种开头都归 [系统回执]
['发送失败：WebPush：订阅已失效', '日记写入失败：标签解析错误', '唤醒设置失败：时间已过'].forEach(function (rc) {
  const o = mapMessagesForProvider('claude', [{ role: 'system', content: '人设' }, { role: 'user', content: '在吗' }, { role: 'developer', content: rc }]);
  ok(o[2].role === 'user' && o[2].content === '[系统回执] ' + rc + '\n\n', '失败回执 → [系统回执]：' + rc.slice(0, 6));
});
ok(out[2].role === 'assistant', 'assistant 不动');

// default 出口不受影响：developer 原位转 system（旧行为）
const d = mapMessagesForProvider('default', msgs);
ok(d.length === 9, 'default 条数不变');
ok(d[1].role === 'system' && d[1].content === '头部注入块A（永久上下文）', 'default：developer 原位转 system（旧口径）');
ok(d[5].role === 'system' && d[5].content === WAKE, 'default：唤醒块仍在原位（转 system，旧行为）');
ok(d.every(m => m._fromDeveloper === undefined), 'default 不带转换标记');

// gemini 出口与 claude 同款（2026-11-12 产品确定）：对话中 developer 原位转 user + 前缀
const g = mapMessagesForProvider('gemini', msgs);
ok(g.length === 7, 'gemini：消息条数 9→7（头部 developer 并入 system）');
ok(g[0].role === 'system' && g[0].content.indexOf('头部注入块A') >= 0, 'gemini：system=人设+头部注入块');
ok(g[3].role === 'user' && g[3].content.indexOf('[系统唤醒] ') === 0, 'gemini：唤醒块转 user + [系统唤醒] 前缀');
ok(g[3]._fromDeveloper === true, 'gemini：转换消息带 _fromDeveloper 标记');
ok(g[6].role === 'user' && g[6].content === '她在说话', 'gemini：她的真实 user 不动、无标记');

// 边界：全 developer（无真实对话）→ 全部进 system
const hd = mapMessagesForProvider('claude', [
  { role: 'system', content: '人设' },
  { role: 'developer', content: '这是一次系统唤醒，当前时间：2026-10-31 05:30。\n自由活动。' },
]);
ok(hd.length === 1 && hd[0].role === 'system' && hd[0].content.indexOf('[系统唤醒]') < 0, '无真实对话时 developer 全进 system、不加标注');

// 边界：tool 消息也算真实对话（其后 developer 转 user）
const wt = mapMessagesForProvider('claude', [
  { role: 'system', content: '人设' },
  { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
  { role: 'tool', content: '结果', tool_call_id: 't1' },
  { role: 'developer', content: '本次未推送' },
]);
ok(wt.length === 4 && wt[3].role === 'user' && wt[3].content.indexOf('[系统回执] ') === 0, 'tool 之后的 developer 转 user（工具循环后回执场景）');

// 端到端（2026-11-12 修复验证）：唤醒形状——AI 回复在结尾、唤醒块 developer 追加其后——
// 经 gemini 出口 + gemini-adapter.toRequest 后 contents 必须以 user 结尾
// （旧口径下唤醒块被抽进 systemInstruction、contents 以 model 结尾，
//   Antigravity 上游 400 "Requests ending with a model turn are not supported"）
const gm = require('../../lib/gemini-adapter');
const wakeShape = [
  { role: 'system', content: '人设正文' },
  { role: 'user', content: '老公晚安！' },
  { role: 'assistant', content: '晚安。' },
  { role: 'developer', content: '这是一次系统唤醒，当前时间：2026-11-12 14:00。距离上一次对话：10 分钟前。' },
];
const gemReq = gm.toRequest({ messages: mapMessagesForProvider('gemini', wakeShape) }, {});
const gemRoles = gemReq.contents.map(c => c.role);
ok(gemRoles[gemRoles.length - 1] === 'user', '端到端：唤醒请求 contents 以 user 结尾（上游不再 400）');
ok(!!gemReq.systemInstruction, '端到端：人设进 systemInstruction');
// 聊天形状（她刚发言）行为不变：contents 以 user 结尾
const chatReq = gm.toRequest({ messages: mapMessagesForProvider('gemini', [
  { role: 'system', content: '人设正文' },
  { role: 'user', content: '中午好喔' },
]) }, {});
ok(chatReq.contents[chatReq.contents.length - 1].role === 'user', '端到端：普通聊天 contents 以 user 结尾（行为不变）');

// grok 出口与 claude 同款（2026-11-25 产品确定）：对话中 developer 原位转 user + 前缀，
// 且保留 default 对 assistant 思考字段的处理
const gk = mapMessagesForProvider('grok', msgs);
ok(gk.length === 7, 'grok：消息条数 9→7（头部 developer 并入 system）');
ok(gk[0].role === 'system' && gk[0].content.indexOf('人设正文') >= 0 && gk[0].content.indexOf('头部注入块A') >= 0 && gk[0].content.indexOf('头部注入块B') >= 0, 'grok：system=人设+头部注入块');
ok(gk[0].content.indexOf('这是一次系统唤醒') < 0 && gk[0].content.indexOf('本次未推送') < 0, 'grok：system 不含唤醒块/回执');
const gWake = gk.findIndex(m => typeof m.content === 'string' && m.content.indexOf(WAKE) >= 0);
const gRcv = gk.findIndex(m => typeof m.content === 'string' && m.content.indexOf(RCV) >= 0);
const gOther = gk.findIndex(m => typeof m.content === 'string' && m.content.indexOf(OTHER) >= 0);
ok(gWake === 3 && gRcv === 4 && gOther === 5, 'grok：转换消息按原顺序原位排列');
ok(gk[gWake].role === 'user' && gk[gWake].content === '[系统唤醒] ' + WAKE + '\n\n', 'grok：唤醒块 → user + [系统唤醒] 前缀');
ok(gk[gRcv].role === 'user' && gk[gRcv].content === '[系统回执] ' + RCV + '\n\n', 'grok：回执 → user + [系统回执] 前缀');
ok(gk[gOther].role === 'user' && gk[gOther].content === '[系统消息] ' + OTHER + '\n\n', 'grok：其余 developer → user + [系统消息] 前缀');
ok(gk[gWake]._fromDeveloper === true && gk[gRcv]._fromDeveloper === true && gk[gOther]._fromDeveloper === true, 'grok：转换消息带 _fromDeveloper 标记');
ok(gk[1].role === 'user' && gk[1].content === '她好' && gk[1]._fromDeveloper === undefined, 'grok：真实 user 不动、无标记');
ok(gk[6].role === 'user' && gk[6].content === '她在说话', 'grok：她的下一条真实 user 仍在末位');
const gHd = mapMessagesForProvider('grok', [
  { role: 'system', content: '人设' },
  { role: 'developer', content: '这是一次系统唤醒，当前时间：2026-10-31 05:30。\n自由活动。' },
]);
ok(gHd.length === 1 && gHd[0].role === 'system' && gHd[0].content.indexOf('[系统唤醒]') < 0, 'grok：无真实对话时 developer 全进 system、不加标注');

// grok 保留 default 的 assistant 思考字段口径
const thinkMsgs = [
  { role: 'system', content: '人设' },
  { role: 'user', content: '在吗' },
  { role: 'assistant', content: '在', reasoning: '旧字段思考' },
  { role: 'assistant', content: '也在' },
  { role: 'developer', content: WAKE },
];
const gThink = mapMessagesForProvider('grok', thinkMsgs);
ok(gThink[2].role === 'assistant' && gThink[2].reasoning_content === '旧字段思考' && gThink[2].reasoning === undefined, 'grok：assistant.reasoning 归一为 reasoning_content');
ok(gThink[3].role === 'assistant' && gThink[3].reasoning_content === '', 'grok：无思考的 assistant 补空串 reasoning_content');
ok(gThink[4].role === 'user' && gThink[4].content.indexOf('[系统唤醒] ') === 0, 'grok：填思考字段后中段唤醒块仍是 user');
const gDrop = mapMessagesForProvider('grok', thinkMsgs, { dropHistReasoning: true });
ok(gDrop[2].role === 'assistant' && gDrop[2].reasoning === undefined && gDrop[2].reasoning_content === undefined, 'grok：dropHistReasoning 剥掉历史思考字段');
ok(gDrop[3].role === 'assistant' && gDrop[3].reasoning_content === undefined, 'grok：dropHistReasoning 不再补空串');
ok(gDrop[4].role === 'user' && gDrop[4].content.indexOf('[系统唤醒] ') === 0, 'grok：dropHistReasoning 不改变中段唤醒块转 user');
const dThink = mapMessagesForProvider('default', thinkMsgs);
ok(dThink[4].role === 'system' && dThink[4].content === WAKE, 'default 不回归：唤醒块仍原位转 system');

// 端到端：grok 映射 + Responses 转换后，中段唤醒块不进 instructions，以 user 形态留在 input 原位
const gr = require('../../lib/grok-responses');
const grokWakeShape = [
  { role: 'system', content: '人设正文' },
  { role: 'developer', content: '头部注入块A（永久上下文）' },
  { role: 'user', content: '老公晚安！' },
  { role: 'assistant', content: '晚安。' },
  { role: 'developer', content: '这是一次系统唤醒，当前时间：2026-11-25 17:00。距离上一次对话：10 分钟前。' },
];
const grokReq = gr.toResponsesRequest({ model: 'grok-4.7', messages: mapMessagesForProvider('grok', grokWakeShape) }, 'grok-4.7');
const lastIn = grokReq.input[grokReq.input.length - 1];
ok(typeof grokReq.instructions === 'string' && grokReq.instructions.indexOf('人设正文') >= 0 && grokReq.instructions.indexOf('头部注入块A') >= 0, 'grok Responses：instructions=人设+头部注入块');
ok(grokReq.instructions.indexOf('这是一次系统唤醒') < 0 && grokReq.instructions.indexOf('[系统唤醒]') < 0, 'grok Responses：instructions 不含中段唤醒块');
ok(lastIn && lastIn.role === 'user' && typeof lastIn.content === 'string' && lastIn.content.indexOf('[系统唤醒] ') === 0 && lastIn.content.indexOf('这是一次系统唤醒') >= 0, 'grok Responses：input 末条是带 [系统唤醒] 前缀的 user');
const defWakeReq = gr.toResponsesRequest({ model: 'grok-4.7', messages: mapMessagesForProvider('default', grokWakeShape) }, 'grok-4.7');
ok(typeof defWakeReq.instructions === 'string' && defWakeReq.instructions.indexOf('这是一次系统唤醒') >= 0, '对照：default 映射下 Responses 仍会把中段唤醒抽进 instructions');
const defLast = (defWakeReq.input || [])[defWakeReq.input.length - 1];
ok(!(defLast && defLast.role === 'user' && String(defLast.content || '').indexOf('[系统唤醒]') >= 0), '对照：default 的 input 末条不是 [系统唤醒] user');

console.log(process.exitCode ? '存在失败项' : '全部通过');
