'use strict';
/* lib/grok-responses.js —— Grok 订阅 Responses API ⇄ OpenAI Chat Completions 转换层（2026-11-16）
 *
 * 为什么：xAI 的 Chat Completions 流里 reasoning_content 只是碎片文本，拿不到「思考摘要」；Responses API 的
 * reasoning 项自带 summary（官方 summary:"detailed" 才有完整摘要）和 encrypted_content（加密思考，可跨轮回传保质量）。
 * 对外仍是 Chat Completions（调用方 mcp-tool-loop.js / routes/chat.js 一行不改），只在这一层翻译。
 *
 * 实测口径（2026-11-16 探针 workspace/_tests/grok-responses/probe*.json）：
 *   - 请求：{model, instructions, input, tools:[{type:'function',name,description,parameters}], tool_choice,
 *            parallel_tool_calls, reasoning:{effort,summary:'detailed'}, include:['reasoning.encrypted_content'], store:false,
 *            stream, temperature, top_p, max_output_tokens}
 *   - 流事件：response.output_text.delta / response.reasoning_summary_text.delta / response.reasoning_text.delta /
 *            response.output_item.added|done / response.function_call_arguments.delta|done / response.completed
 *   - 用量：input_tokens / output_tokens / output_tokens_details.reasoning_tokens / total_tokens
 *     **output_tokens 含 reasoning，total = input + output**；而 Chat Completions 的 completion_tokens 不含思考、
 *     total = prompt + completion + reasoning。所以这里 completion = output - reasoning，再拼 total，两边口径一致。
 *
 * 安全：reasoning 项（含 encrypted_content）只挂在 assistant 消息上用于下一轮回传；本层永不把它写进
 * choices[0].delta.content，也不在返回的 message 里给前端看（前端只拿 summary 文本当 reasoning_content）。
 */

const REASONING_SUMMARY = 'detailed';   // auto 只有五六十字，detailed 才是完整摘要（实测 183 字/3 帧）

/* 2026-11-16：是否回传思考项，看调用方有没有按工具循环的口径要 usage——
   mcp-tool-loop 固定发 stream_options.include_usage（服务端消费，需要思考项跨轮）；
   routes/chat.js 无工具直连时把 SSE 原样转给浏览器（那里不需要、也不该看到 encrypted_content）。
   这样既保住跨轮思考质量，又不让加密串出现在前端可见的流里。 */
function wantsReasoningItems(body) {
  const b = body || {};
  return !!(b.stream_options && b.stream_options.include_usage === true);
}

function isReasoningEffort(v) {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh';
}

/* chat 的 content（字符串 / [{type:'text'|'image_url'}]）→ Responses 的输入内容 */
function toInputContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : String(content);
  const parts = [];
  for (const p of content) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && typeof p.text === 'string') parts.push({ type: 'input_text', text: p.text });
    else if (p.type === 'image_url') {
      const u = (p.image_url && (p.image_url.url || p.image_url)) || '';
      if (u) parts.push({ type: 'input_image', image_url: String(u) });
    } else if (p.type === 'input_text' || p.type === 'input_image') parts.push(p);
  }
  return parts.length ? parts : '';
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (p) {
      if (!p) return '';
      if (typeof p === 'string') return p;
      if (typeof p.text === 'string') return p.text;
      return '';
    }).filter(Boolean).join('\n');
  }
  return content == null ? '' : String(content);
}

function toResponsesTool(t) {
  if (!t || typeof t !== 'object') return null;
  const fn = t.function || t;
  if (!fn || !fn.name) return null;
  const out = { type: 'function', name: String(fn.name) };
  if (fn.description) out.description = String(fn.description);
  if (fn.parameters && typeof fn.parameters === 'object') out.parameters = fn.parameters;
  else out.parameters = { type: 'object', properties: {} };
  if (fn.strict != null) out.strict = !!fn.strict;
  return out;
}

function toResponsesToolChoice(tc) {
  if (tc == null) return null;
  if (typeof tc === 'string') return tc;
  if (typeof tc === 'object') {
    const fn = tc.function || tc;
    if (fn && fn.name) return { type: 'function', name: String(fn.name) };
  }
  return null;
}

/* 多轮工具循环里 assistant 消息上挂的 reasoning 项（含 encrypted_content），给下一轮原样送回 */
function pickReasoningItems(items) {
  return (items || []).filter(function (it) {
    return it && it.type === 'reasoning' && (it.encrypted_content || it.id);
  }).map(function (it) {
    const o = { type: 'reasoning', id: it.id };
    if (it.summary) o.summary = it.summary;
    if (it.content) o.content = it.content;
    if (it.encrypted_content) o.encrypted_content = it.encrypted_content;
    return o;
  });
}

/* Chat Completions 请求体 → Responses 请求体 */
function toResponsesRequest(body, model) {
  const b = body || {};
  const sysTexts = [];
  const input = [];
  for (const m of (Array.isArray(b.messages) ? b.messages : [])) {
    if (!m) continue;
    if (m.role === 'system' || m.role === 'developer') {
      const t = textOfContent(m.content);
      if (t) sysTexts.push(t);
      continue;
    }
    if (m.role === 'user') {
      input.push({ role: 'user', content: toInputContent(m.content) });
      continue;
    }
    if (m.role === 'assistant') {
      /* 2026-11-16：上一轮的思考项（含 encrypted_content）先放回去，紧接着 assistant 正文与 function_call——
         顺序与上游 output[] 一致，跨轮思考质量才不丢 */
      if (Array.isArray(m.grok_reasoning_items) && m.grok_reasoning_items.length) {
        for (const it of m.grok_reasoning_items) if (it) input.push(it);
      }
      const txt = textOfContent(m.content);
      if (txt) input.push({ role: 'assistant', content: txt });
      for (const tc of (Array.isArray(m.tool_calls) ? m.tool_calls : [])) {
        const fn = (tc && tc.function) || {};
        if (!fn.name) continue;
        input.push({
          type: 'function_call',
          call_id: String(tc.id || ''),
          name: String(fn.name),
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {})
        });
      }
      continue;
    }
    if (m.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(m.tool_call_id || ''),
        output: textOfContent(m.content)
      });
    }
  }

  const payload = { model: String(model || b.model || ''), input: input, store: false };
  if (sysTexts.length) payload.instructions = sysTexts.join('\n\n');
  const tools = (Array.isArray(b.tools) ? b.tools : []).map(toResponsesTool).filter(Boolean);
  if (tools.length) {
    payload.tools = tools;
    const tc = toResponsesToolChoice(b.tool_choice);
    if (tc != null) payload.tool_choice = tc;
    if (typeof b.parallel_tool_calls === 'boolean') payload.parallel_tool_calls = b.parallel_tool_calls;
  }
  /* 思考档位 + 摘要：Grok 4.x 不能关思考，不传 effort 就是厂商默认（high） */
  const reasoning = { summary: REASONING_SUMMARY };
  if (isReasoningEffort(b.reasoning_effort)) reasoning.effort = b.reasoning_effort;
  payload.reasoning = reasoning;
  payload.include = ['reasoning.encrypted_content'];
  if (b.stream === true) payload.stream = true;
  if (typeof b.temperature === 'number') payload.temperature = b.temperature;
  if (typeof b.top_p === 'number') payload.top_p = b.top_p;
  const maxOut = b.max_tokens != null ? b.max_tokens : b.max_completion_tokens;
  if (typeof maxOut === 'number' && maxOut > 0) payload.max_output_tokens = maxOut;
  /* 明确不带：presence_penalty / frequency_penalty / stop / stream_options / n / logprobs / response_format ——
     Responses 不认或思考模型硬拒，白名单之外一律不转发 */
  return payload;
}

/* Responses 的 usage → Chat Completions 的 usage（口径对齐见文件头注释） */
function usageToChat(u) {
  const inTok = Number((u && u.input_tokens) || 0) || 0;
  const outTok = Number((u && u.output_tokens) || 0) || 0;
  const rt = Number((u && u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0) || 0;
  const ct = Math.max(0, outTok - rt);   // 上游 output 已含思考，减出来才是 Chat 口径的 completion
  const cached = Number((u && u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0) || 0;
  const total = (u && typeof u.total_tokens === 'number') ? u.total_tokens : (inTok + outTok);
  const out = {
    prompt_tokens: inTok,
    completion_tokens: ct,
    total_tokens: total,
    completion_tokens_details: { reasoning_tokens: rt },
    prompt_tokens_details: { cached_tokens: cached }
  };
  if (u && u.cost_in_usd_ticks != null) out.cost_in_usd_ticks = u.cost_in_usd_ticks;
  return out;
}

function reasoningTextOf(item) {
  if (!item) return '';
  const parts = [];
  for (const s of (item.summary || [])) if (s && s.text) parts.push(s.text);
  for (const c of (item.content || [])) if (c && (c.text || c.reasoning_text)) parts.push(c.text || c.reasoning_text);
  return parts.join('\n');
}

/* 一次 Responses 结果（output[]）→ Chat Completions 的 message / 工具调用 */
function fromResponsesOutput(output) {
  let text = '';
  let reasoning = '';
  const toolCalls = [];
  const reasoningItems = [];
  (output || []).forEach(function (it) {
    if (!it) return;
    if (it.type === 'reasoning') {
      reasoningItems.push(it);
      const t = reasoningTextOf(it);
      if (t) reasoning = reasoning ? reasoning + '\n' + t : t;
    } else if (it.type === 'message') {
      for (const c of (it.content || [])) if (c && typeof c.text === 'string') text += c.text;
    } else if (it.type === 'function_call') {
      toolCalls.push({
        index: toolCalls.length,
        id: String(it.call_id || it.id || ('call_' + toolCalls.length)),
        type: 'function',
        function: { name: String(it.name || ''), arguments: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments || {}) }
      });
    }
  });
  return { text, reasoning, toolCalls, reasoningItems: pickReasoningItems(reasoningItems) };
}

/* 非流式：Responses JSON → Chat Completions JSON */
function toChatCompletion(j, model, opts) {
  const o = opts || {};
  const r = (j && j.response) || j || {};
  const got = fromResponsesOutput(r.output);
  const message = { role: 'assistant', content: got.text || '' };
  if (got.reasoning) message.reasoning_content = got.reasoning;
  if (got.toolCalls.length) message.tool_calls = got.toolCalls;
  const out = {
    id: 'chatcmpl-' + String(r.id || Date.now()),
    object: 'chat.completion',
    created: Number(r.created_at) || Math.floor(Date.now() / 1000),
    model: String(r.model || model || ''),
    choices: [{ index: 0, message: message, finish_reason: got.toolCalls.length ? 'tool_calls' : 'stop' }],
    usage: usageToChat(r.usage || {})
  };
  if (got.reasoningItems.length && o.emitItems !== false) out.grok_reasoning_items = got.reasoningItems;   // 只给工具循环回传用（emitItems 由 stream_options.include_usage 判定，直连前端的路径不带，避免加密串出现在浏览器）
  return out;
}

/* 流式：Responses SSE 事件 → 一串 Chat Completions chunk */
function createStreamTranslator(model, opts) {
  const o = opts || {};
  const name = String(model || '');
  const createdAt = Math.floor(Date.now() / 1000);
  const slots = {};        // output_index → { index, id, name, sentName, argsSent }
  const order = [];
  let nextIndex = 0;
  let finish = 'stop';
  let completed = null;

  function chunk(delta, finishReason) {
    const c = { id: 'chatcmpl-grok', object: 'chat.completion.chunk', created: createdAt, model: name, choices: [{ index: 0, delta: delta || {}, finish_reason: finishReason || null }] };
    return 'data: ' + JSON.stringify(c) + '\n\n';
  }

  function slotFor(evt) {
    const oi = typeof evt.output_index === 'number' ? evt.output_index : 0;
    let s = slots[oi];
    if (!s) {
      s = slots[oi] = { index: nextIndex++, id: '', name: '', sentName: false, argsSent: 0 };
      order.push(oi);
    }
    return s;
  }

  function toolDelta(s, args, withId) {
    const fn = { name: s.sentName ? undefined : s.name };
    if (fn.name) s.sentName = true;
    if (args != null && args !== '') fn.arguments = args;
    const tc = { index: s.index, type: 'function', function: fn };
    if (withId && s.id) tc.id = s.id;
    if (!fn.name) delete fn.name;
    if (fn.arguments == null) delete fn.arguments;
    return chunk({ tool_calls: [tc] });
  }

  function handle(evt) {
    if (!evt || typeof evt !== 'object') return [];
    const out = [];
    const type = String(evt.type || '');

    if (type === 'response.output_text.delta') {
      if (typeof evt.delta === 'string' && evt.delta) out.push(chunk({ content: evt.delta }));
      return out;
    }
    if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
      if (typeof evt.delta === 'string' && evt.delta) out.push(chunk({ reasoning_content: evt.delta }));
      return out;
    }
    if (type === 'response.output_item.added' && evt.item && evt.item.type === 'function_call') {
      const s = slotFor(evt);
      s.id = String(evt.item.call_id || evt.item.id || '');
      s.name = String(evt.item.name || '');
      finish = 'tool_calls';
      out.push(toolDelta(s, evt.item.arguments || '', true));
      return out;
    }
    if (type === 'response.function_call_arguments.delta') {
      const s = slotFor(evt);
      const d = typeof evt.delta === 'string' ? evt.delta : '';
      if (d) { s.argsSent += d.length; out.push(toolDelta(s, d, s.id ? true : false)); }
      return out;
    }
    if (type === 'response.function_call_arguments.done') {
      const s = slotFor(evt);
      const full = typeof evt.arguments === 'string' ? evt.arguments : '';
      if (typeof evt.name === 'string' && evt.name) s.name = evt.name;
      if (!s.sentName && s.name) out.push(toolDelta(s, null, s.id ? true : false));
      if (full && full.length > s.argsSent) {
        const rest = full.slice(s.argsSent);
        s.argsSent = full.length;
        out.push(toolDelta(s, rest, false));
      }
      finish = 'tool_calls';
      return out;
    }
    if (type === 'response.output_item.done' && evt.item && evt.item.type === 'function_call') {
      const s = slotFor(evt);
      const it = evt.item;
      const full = typeof it.arguments === 'string' ? it.arguments : '';
      if (typeof it.call_id === 'string' && it.call_id) s.id = it.call_id;
      if (typeof it.name === 'string' && it.name) s.name = it.name;
      if (!s.sentName && s.name) out.push(toolDelta(s, null, true));
      if (full && full.length > s.argsSent) {
        const rest = full.slice(s.argsSent);
        s.argsSent = full.length;
        out.push(toolDelta(s, rest, false));
      }
      finish = 'tool_calls';
      return out;
    }
    if (type === 'response.completed') {
      completed = evt.response || {};
      const got = fromResponsesOutput(completed.output);
      if (got.toolCalls.length) {
        finish = 'tool_calls';
        /* 万一上游没走增量（只有 completed 里带整条 function_call），这里补齐，保证工具循环拿得到 */
        got.toolCalls.forEach(function (tc) {
          const known = order.some(function (oi) { const s = slots[oi]; return s && s.name === tc.function.name; });
          if (known) return;
          const s = { index: nextIndex++, id: tc.id, name: tc.function.name, sentName: false, argsSent: 0 };
          out.push(toolDelta(s, tc.function.arguments || '{}', true));
        });
      }
      const base = usageToChat(completed.usage || {});
      const last = { choices: [], usage: base, id: 'chatcmpl-grok', object: 'chat.completion.chunk', created: createdAt, model: name };
      if (got.reasoningItems.length && o.emitItems !== false) last.grok_reasoning_items = got.reasoningItems;
      out.push('data: ' + JSON.stringify(last) + '\n\n');
      return out;
    }
    return out;
  }

  function finishChunks() {
    const out = [chunk({}, finish), 'data: [DONE]\n\n'];
    return out;
  }

  return { handle: handle, finish: finishChunks, getFinish: function () { return finish; } };
}

module.exports = {
  toResponsesRequest: toResponsesRequest,
  usageToChat: usageToChat,
  fromResponsesOutput: fromResponsesOutput,
  toChatCompletion: toChatCompletion,
  createStreamTranslator: createStreamTranslator,
  wantsReasoningItems: wantsReasoningItems,
  _internal: { toInputContent: toInputContent, toResponsesTool: toResponsesTool, toResponsesToolChoice: toResponsesToolChoice, pickReasoningItems: pickReasoningItems, reasoningTextOf: reasoningTextOf, REASONING_SUMMARY: REASONING_SUMMARY }
};
