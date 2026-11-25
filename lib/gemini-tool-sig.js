'use strict';
// gemini-tool-sig.js —— 给 Gemini 官方端点的工具调用补 thoughtSignature 占位。
//
// 为什么需要（2026-11-04）：Gemini 3 系列的 function calling 回放要求每个 functionCall
// 带 thoughtSignature，OpenAI 兼容层用 `tool_calls[i].extra_content.google.thought_signature`
// 承载；缺了直接 400（"Function call is missing a thought_signature"）。
// 我们不做真签名：主链路的历史里没有签名载体，流式聚合（mcp-tool-loop accToolCall）只留
// id/name/args，时间线落盘也会丢。实测 Gemini 兼容层接受占位值
// `skip_thought_signature_validator`（与 Antigravity 的哨兵同一做法，curl 往返 200）。
//
// 只对 generativelanguage.googleapis.com（Gemini 官方 OpenAI 兼容端点）生效：
// 其他上游（OpenAI 官方 / DeepSeek / 中转）不认识这个字段，一个字节都不加。
/* [位置:lib/gemini-tool-sig.js·模块] [Gemini 工具调用签名占位] [Gemini 3 回放 functionCall 必须带 thoughtSignature，主链路无载体，用官方接受的哨兵值补上，否则工具循环第二轮起必 400] [注释时间 2026-11-04] */

const SENTINEL = 'skip_thought_signature_validator';

function isGeminiEndpoint(url) {
  return /generativelanguage\.googleapis\.com/i.test(String(url || ''));
}

function hasSig(tc) {
  return !!(tc && tc.extra_content && tc.extra_content.google && tc.extra_content.google.thought_signature);
}

// 浅拷贝到「需要补签名的 assistant 消息」为止，不污染调用方传进来的消息对象
// （那些对象可能要落盘/进时间线，不该多出上游适配用的字段）
function stamp(messages) {
  if (!Array.isArray(messages)) return messages;
  let touched = false;
  const out = messages.map(function (m) {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls) || !m.tool_calls.length) return m;
    const needs = m.tool_calls.some(function (tc) { return tc && tc.function && !hasSig(tc); });
    if (!needs) return m;
    touched = true;
    return Object.assign({}, m, {
      tool_calls: m.tool_calls.map(function (tc) {
        if (!tc || !tc.function || hasSig(tc)) return tc;
        const ec = tc.extra_content || {};
        return Object.assign({}, tc, {
          extra_content: Object.assign({}, ec, {
            google: Object.assign({}, ec.google || {}, { thought_signature: SENTINEL }),
          }),
        });
      }),
    });
  });
  return touched ? out : messages;
}

// 发上游前的统一入口：不是 Gemini 端点就原样返回（零开销、零副作用）
function maybeStamp(messages, upstreamUrl) {
  if (!isGeminiEndpoint(upstreamUrl)) return messages;
  return stamp(messages);
}

module.exports = {
  SENTINEL: SENTINEL,
  isGeminiEndpoint: isGeminiEndpoint,
  stamp: stamp,
  maybeStamp: maybeStamp,
};
