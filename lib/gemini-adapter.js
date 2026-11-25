'use strict';
// gemini-adapter.js —— OpenAI Chat Completions ⇄ Gemini (Cloud Code Assist) 的纯函数翻译。
// Gemini（gemini-cli 身份）与 Antigravity（antigravity 身份）共用这一层：两家说的是同一条
// v1internal 协议，只有端点/指纹/信封/模型目录不同（在 routes/oauth-proxy.js 的 CLOUDCODE）。
//
// 文本 + 工具调用（2026-11-04 起）：tools ⇄ functionDeclarations、assistant.tool_calls ⇄
// functionCall、role:tool ⇄ functionResponse、响应 functionCall ⇄ tool_calls（含流式 delta）。
// 图片（2026-11-12 起）：user 消息里的 data: 图片翻成 inlineData；非 data: 的 URL 上游拉不到，
// 落成文字占位。本站图转 base64、不能看图的模型剥图都在调用方 oauth-proxy 做完再进来。
// 空文本一律替换成一个空格：Gemini 的 part 是 protobuf oneof，{"text":""} 会被判成
// "未初始化"直接 400。

const NE = ' ';

function nonEmpty(s) {
  const t = (s === null || s === undefined) ? '' : String(s);
  return t.length ? t : NE;
}

function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(function (p) {
      if (!p) return '';
      if (typeof p === 'string') return p;
      if (p.type === 'text') return String(p.text || '');
      return '';
    }).filter(Boolean).join('');
  }
  return c === null || c === undefined ? '' : String(c);
}

/* [位置:lib/gemini-adapter.js·toGeminiSchema] [OpenAI JSON Schema → Gemini Schema] [Gemini 是 protobuf JSON：type 用大写枚举、不认识 $schema/additionalProperties 等扩展关键字，白名单清洗防止上游 400] [注释时间 2026-11-04；2026-11-12 改动：anyOf/oneOf/allOf 不再透传，拍平成单一类型（Antigravity 给 claude/gpt-oss 的翻译层不接受联合类型 schema，见下方拍平注释）] */
const TYPE_UP = {
  object: 'OBJECT', string: 'STRING', number: 'NUMBER', integer: 'INTEGER',
  boolean: 'BOOLEAN', array: 'ARRAY',
};
// Gemini Schema proto 认识的字段；OpenAI 侧其余关键字（$schema、additionalProperties、oneOf…）丢弃
const SCHEMA_KEYS = ['format', 'description', 'nullable', 'enum', 'minItems', 'maxItems',
  'required', 'minProperties', 'maxProperties', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'default', 'propertyOrdering'];

function toGeminiSchema(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return undefined;
  /* [位置:lib/gemini-adapter.js·toGeminiSchema anyOf拍平] [联合类型拍平成单一类型] [2026-11-12 实测：Gemini 订阅里的 claude/gpt-oss 模型，上游把 functionDeclarations 翻成 Anthropic custom 工具时带 anyOf 的 input_schema 过不了它家 JSON Schema draft 2020-12 校验，第一轮就 400（screenshot.click、ds_search 两处实锤）。拍法：null 型分支转完为 undefined 自然滤掉，剩一个分支并入本体（保留外层 default/description），剩多个取第一个——上游不支持联合类型，schema 提示略降但功能不受影响；gemini 模型对拍平后的 schema 同样接受（探针验证 200）] [注释时间 2026-11-12] */
  const combKey = Array.isArray(s.anyOf) ? 'anyOf' : (Array.isArray(s.oneOf) ? 'oneOf' : (Array.isArray(s.allOf) ? 'allOf' : ''));
  if (combKey) {
    const branches = s[combKey].map(toGeminiSchema).filter(Boolean);
    if (branches.length) {
      const merged = Object.assign({}, branches[0]);          // 分支的 type/items 等具体定义优先
      for (let i = 0; i < SCHEMA_KEYS.length; i++) {
        const k = SCHEMA_KEYS[i];
        if (s[k] !== undefined && merged[k] === undefined) merged[k] = s[k];   // 外层 default/description 补进来
      }
      if (s.properties && typeof s.properties === 'object') {   // allOf 常见外层带 properties，别丢
        merged.properties = merged.properties || {};
        Object.keys(s.properties).forEach(function (pk) {
          if (merged.properties[pk] === undefined) {
            /* [位置:lib/gemini-adapter.js·anyOf外层properties] [外层 properties 的子 schema 也要过 toGeminiSchema] [11-15：此前把原始对象直接塞进 merged.properties，组合节点自带外层 properties 时，子 schema 的 OpenAI 关键字（$schema/additionalProperties）与小写 type 会原样发给上游，白名单清洗等于被绕过] [注释时间 2026-11-15] */
            const pv = toGeminiSchema(s.properties[pk]);
            if (pv) merged.properties[pk] = pv;
          }
        });
      }
      return merged;
    }
    // 分支全空（全 null 型）：落到下面按普通字段处理，组合关键字本身不带出去
  }
  const out = {};
  const t = TYPE_UP[String(s.type || '').toLowerCase()];
  if (t) out.type = t;
  for (let i = 0; i < SCHEMA_KEYS.length; i++) {
    const k = SCHEMA_KEYS[i];
    if (s[k] === undefined) continue;
    out[k] = s[k];
  }
  if (s.properties && typeof s.properties === 'object') {
    const props = {};
    Object.keys(s.properties).forEach(function (pk) {
      const pv = toGeminiSchema(s.properties[pk]);
      if (pv) props[pk] = pv;
    });
    out.properties = props;
  }
  if (Array.isArray(s.items)) out.items = s.items.map(toGeminiSchema).filter(Boolean);
  else if (s.items) { const it = toGeminiSchema(s.items); if (it) out.items = it; }
  return Object.keys(out).length ? out : undefined;
}

/* [位置:lib/gemini-adapter.js·toolsOf] [OpenAI tools → functionDeclarations] [把主链路注入的 OpenAI 工具定义翻译成 Gemini 的 tools 形状，Gemini 订阅链路才能参与 MCP 工具循环] [注释时间 2026-11-04] */
function toolsOf(body) {
  const list = Array.isArray(body && body.tools) ? body.tools : [];
  const decls = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i] || {};
    const fn = t.function && typeof t.function === 'object' ? t.function : t;
    if (!fn || !fn.name) continue;
    const d = { name: String(fn.name), description: String(fn.description || '') };
    const ps = toGeminiSchema(fn.parameters);
    if (ps) d.parameters = ps;
    decls.push(d);
  }
  return decls;
}

function toolConfigOf(body) {
  const tc = body && body.tool_choice;
  if (!tc || tc === 'auto') return null; // AUTO 是默认，省字节
  if (tc === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (tc === 'required') return { functionCallingConfig: { mode: 'ANY' } };
  if (typeof tc === 'object' && tc.type === 'function' && tc.function && tc.function.name) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [String(tc.function.name)] } };
  }
  return null;
}

// 工具结果内容 → functionResponse.response（必须是 object）：
// 能 parse 成 object 就原样，否则字符串包进 {result}
function respOf(content) {
  let txt;
  if (typeof content === 'string') txt = content;
  else if (content === null || content === undefined) txt = '';
  else { try { txt = JSON.stringify(content); } catch (e) { txt = String(content); } }
  if (txt && txt.trim()) {
    try {
      const j = JSON.parse(txt);
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch (e) { /* 字符串结果 */ }
  }
  return { result: txt || '(空结果)' };
}

/* [位置:lib/gemini-adapter.js·userPartsOf] [user 消息 → Gemini parts（含图片）] [11-12：Gemini 订阅发图被整包拒；上游实测 gemini/claude 模型都接受 inlineData（探针 workspace/_tests/probe-gemini-image-e2e.js，claude 档配额紧打满会 429，以首轮 200 且描述正确为准）。按原顺序保留文字与图片：data: URL → inlineData；其它 URL 上游拉不到（不会来下本站域名），落成「（图片）」占位不让整轮失败；相邻文字合并成一个 text part] [注释时间 2026-11-12] */
const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/i;
function imageUrlOfPart(p) {
  if (!p || typeof p !== 'object') return '';
  if (p.type !== 'image_url' && p.type !== 'image' && p.type !== 'input_image') return '';
  const raw = p.image_url !== undefined ? p.image_url : p.url;
  const u = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? raw.url : '');
  return typeof u === 'string' ? u : '';
}
/* [位置:lib/gemini-adapter.js·audioOfPart] [user 消息 → 音频 inlineData] [11-12：Gemini 订阅上游实测 gemini 系模型收 inlineData 音频（探针 workspace/_tests/probe-gemini-audio-e2e.js，200 且能转述内容；claude/gpt 档 400，剥占位在 oauth-proxy·prepareCloudCodeAudio 按模型做，adapter 保持纯函数不知道模型）。只翻 data: base64；站内 URL 引用内联也由 prepareCloudCodeAudio 做，到不了这里落「（语音）」占位。mime：data: 前缀里带的优先，没有就按 format 字段（wav→audio/wav），再没有兜底 audio/wav] [注释时间 2026-11-12] */
function audioOfPart(p) {
  if (!p || typeof p !== 'object' || p.type !== 'input_audio') return null;
  const ia = (p.input_audio && typeof p.input_audio === 'object') ? p.input_audio : {};
  const raw = typeof ia.data === 'string' ? ia.data : (typeof ia.url === 'string' ? ia.url : '');
  const m = /^data:([^;,]*);base64,(.+)$/i.exec(raw);
  if (!m) return null;
  const fmt = String(ia.format || '').trim().toLowerCase();
  const mime = m[1] || (fmt ? 'audio/' + fmt : 'audio/wav');
  return { mimeType: mime, data: m[2] };
}
function userPartsOf(content) {
  if (!Array.isArray(content)) {
    const t = textOf(content);
    return t.trim() ? [{ text: nonEmpty(t) }] : [];
  }
  const out = [];
  let buf = '';
  const flushText = function () { if (buf.trim()) out.push({ text: buf }); buf = ''; };
  for (let i = 0; i < content.length; i++) {
    const p = content[i];
    if (!p) continue;
    if (typeof p === 'string') { buf += p; continue; }
    if (p.type === 'text') { buf += String(p.text || ''); continue; }
    const url = imageUrlOfPart(p);
    if (url || p.type === 'image_url' || p.type === 'image' || p.type === 'input_image') {
      const m = DATA_URL_RE.exec(String(url || ''));
      if (m) { flushText(); out.push({ inlineData: { mimeType: m[1], data: m[2] } }); }
      else buf += '（图片）';
      continue;
    }
    const au = audioOfPart(p);
    if (au) { flushText(); out.push({ inlineData: au }); }
    else if (p.type === 'input_audio') buf += '（语音）';
  }
  flushText();
  return out;
}

// OpenAI messages -> Gemini GenerateContentRequest
/* [位置:lib/gemini-adapter.js·toRequest] [消息翻译（含工具往返）] [assistant.tool_calls 翻成 model 的 functionCall、role:tool 翻成 user 的 functionResponse 并按轮合并，漏答的补哑响应，保证历史带回上游不 400] [注释时间 2026-11-04；改动：叠加工具往返；2026-11-12：functionCall/functionResponse 都带上调用 id——Antigravity 给 claude/gpt-oss 把请求翻成 Anthropic tool_use/tool_result，id 为空或缺失直接 400] */
function toRequest(body, opts) {
  const o = opts || {};
  const contents = [];
  const systems = [];
  const msgs = Array.isArray(body && body.messages) ? body.messages : [];

  // tool_call_id -> 工具名（functionResponse 要 name，OpenAI 的 role:tool 只给 id）
  const id2name = {};
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] || {};
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    for (let k = 0; k < calls.length; k++) {
      const c = calls[k];
      if (c && c.id && c.function && c.function.name) id2name[String(c.id)] = String(c.function.name);
    }
  }

  // 待回填的工具响应（来自 model 的 functionCall）；flush 时合成一个 user turn，
  // 没等到结果的补哑响应——Gemini 要求每个 functionCall 必须紧跟 functionResponse，缺了直接 400
  let pending = [];
  const flushTools = function () {
    if (!pending.length) return;
    contents.push({
      role: 'user',
      parts: pending.map(function (t) {
        const fr = { name: t.name, response: t.response || { result: '(工具结果缺失)' } };
        // 2026-11-12：id 与 functionCall 配对（Anthropic 侧的 tool_result.tool_use_id），
        // claude/gpt-oss 模型缺 id 直接 400 "tool_use_id: Field required"
        if (t.id) fr.id = t.id;
        return { functionResponse: fr };
      }),
    });
    pending = [];
  };

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] || {};
    const role = String(m.role || 'user');

    if (role === 'system' || role === 'developer') {
      const txt = textOf(m.content);
      if (txt.trim()) systems.push(txt);
      continue;
    }

    if (role === 'tool') {
      const id = String(m.tool_call_id || '');
      const name = id2name[id] || String(m.name || '') || 'tool';
      let slot = null;
      for (let k = 0; k < pending.length; k++) {
        if (pending[k].id === id && pending[k].response === undefined) { slot = pending[k]; break; }
      }
      if (!slot) {
        for (let k = 0; k < pending.length; k++) {
          if (pending[k].name === name && pending[k].response === undefined) { slot = pending[k]; break; }
        }
      }
      if (!slot) { pending.push({ id: id, name: name, response: undefined }); slot = pending[pending.length - 1]; }
      slot.name = name;
      slot.response = respOf(m.content);
      continue; // 连续 tool 结果合成一个 user turn，等下一条非 tool 消息再 flush
    }

    if (role === 'assistant') {
      const txt = textOf(m.content);
      const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : [])
        .filter(function (c) { return c && c.function && c.function.name; });
      if (!txt.trim() && !calls.length) continue;
      flushTools();
      const parts = [];
      if (txt.trim()) parts.push({ text: nonEmpty(txt) });
      for (let k = 0; k < calls.length; k++) {
        const c = calls[k];
        let args = {};
        try {
          const a = c.function.arguments ? JSON.parse(c.function.arguments) : {};
          if (a && typeof a === 'object' && !Array.isArray(a)) args = a;
          else args = { value: a };
        } catch (e) { args = { _raw: String(c.function.arguments) }; }
        const fc = { name: String(c.function.name), args: args };
        // 2026-11-12：回放必须带 id——上游给 claude/gpt-oss 把请求翻成 Anthropic tool_use，
        // id 为空直接 400（"Expected the 'id' of ... 'tool_calls' ... to be populated"）
        if (c.id) fc.id = String(c.id);
        const fcPart = { functionCall: fc };
        // Antigravity 回放带 functionCall 的 model turn 时必须带 thoughtSignature，
        // 而 OpenAI 的历史里没有签名载体，只能用官方哨兵值（CLIProxyAPI / DSH 同一做法）
        if (o.replaySignature) fcPart.thoughtSignature = String(o.replaySignature);
        parts.push(fcPart);
        pending.push({ id: String(c.id || ''), name: String(c.function.name), response: undefined });
      }
      contents.push({ role: 'model', parts: parts });
      continue;
    }

    // user
    const uparts = userPartsOf(m.content);
    if (!uparts.length) continue;
    flushTools();
    contents.push({ role: 'user', parts: uparts });
  }
  flushTools();
  if (contents.length && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
  }
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: NE }] });

  const req = { contents: contents };
  if (systems.length) req.systemInstruction = { parts: [{ text: systems.join('\n\n') }] };

  const decls = toolsOf(body);
  if (decls.length) req.tools = [{ functionDeclarations: decls }];
  const tcfg = toolConfigOf(body);
  if (tcfg) req.toolConfig = tcfg;

  const gc = {};
  if (typeof body.temperature === 'number') gc.temperature = body.temperature;
  if (typeof body.top_p === 'number') gc.topP = body.top_p;
  const maxTokens = Number.isInteger(o.maxTokens) ? o.maxTokens : (Number.isInteger(body.max_tokens) ? body.max_tokens : 0);
  if (maxTokens > 0) gc.maxOutputTokens = maxTokens;
  // Antigravity 的 -tiered 模型把档位放在请求里（-low/-medium/-high 变体则写在模型名后缀上）
  /* [位置:lib/gemini-adapter.js·toRequest thinkingConfig] [思考档位与思考文本开关] [2026-11-12 实测：上游对 gemini 模型默认只烧 thoughtsTokenCount 不吐思考文本，请求带 thinkingConfig.includeThoughts 后吐 thought part（非流式/流式探针 probe-gemini-thought-stream.js：流式思考先到正文后到；claude/gpt-oss 后端不认这个参数，claude 实测无视）→ 调用方 oauth-proxy 按模型名决定传不传 includeThoughts，adapter 只负责把两参数合并进同一个 thinkingConfig] [注释时间 2026-11-12] */
  if (o.thinkingLevel || o.includeThoughts) {
    gc.thinkingConfig = {};
    if (o.thinkingLevel) gc.thinkingConfig.thinkingLevel = String(o.thinkingLevel);
    if (o.includeThoughts) gc.thinkingConfig.includeThoughts = true;
  }
  if (Object.keys(gc).length) req.generationConfig = gc;
  return req;
}

function unwrap(j) {
  if (j && typeof j === 'object' && j.response && typeof j.response === 'object') return j.response;
  return j || {};
}

function candidateOf(j) {
  const r = unwrap(j);
  const c = Array.isArray(r.candidates) ? r.candidates[0] : null;
  return c || null;
}

// 正文提取：thought:true 的 part 是思考链（2026-11-12 实测 gpt-oss-120b-medium，
// 响应同时含 {text:正文} 与 {thought:true,text:思考} 两种 part），不滤掉会混进正文
function textFromCandidate(c) {
  const parts = (c && c.content && Array.isArray(c.content.parts)) ? c.content.parts : [];
  return parts.filter(function (p) { return !(p && p.thought); })
    .map(function (p) { return String((p && p.text) || ''); }).join('');
}

/* [位置:lib/gemini-adapter.js·thoughtFromCandidate] [思考链文本提取] [上游把思考放在 thought:true 的 part 里，正文与思考必须分开取：思考导进 reasoning_content 进思考抽屉，此前全部混进正文直接显示给用户] [注释时间 2026-11-12] */
function thoughtFromCandidate(c) {
  const parts = (c && c.content && Array.isArray(c.content.parts)) ? c.content.parts : [];
  return parts.filter(function (p) { return p && p.thought && p.text; })
    .map(function (p) { return String(p.text); }).join('');
}

/* [位置:lib/gemini-adapter.js·partsOf] [取 candidate 的 parts] [流式与非流式都要按 parts 逐个分辨 text/functionCall，抽成一处] [注释时间 2026-11-04] */
function partsOf(c) {
  return (c && c.content && Array.isArray(c.content.parts)) ? c.content.parts : [];
}

/* [位置:lib/gemini-adapter.js·toolCallsFromParts] [functionCall parts → OpenAI tool_calls] [Gemini 协议本身无调用 id，但 Antigravity 给 claude/gpt-oss 模型返回的 functionCall 带 Anthropic 风格真 id（toolu_vrtx_…）：带上真 id，回传时 functionCall/functionResponse 用同一个 id，上游才能翻成配对的 tool_use/tool_result；没有 id 的（现役 gemini 模型）才自造 call_gm_ 兜底] [注释时间 2026-11-04；2026-11-12 改动：优先用上游真 id，不再一律自造] */
function toolCallsFromParts(parts) {
  const out = [];
  (parts || []).forEach(function (p) {
    const fc = p && p.functionCall;
    if (fc && fc.name) {
      out.push({
        id: fc.id ? String(fc.id) : ('call_gm_' + Math.random().toString(36).slice(2, 12)),
        type: 'function',
        function: { name: String(fc.name), arguments: JSON.stringify(fc.args || {}) },
      });
    }
  });
  return out;
}

/* [位置:lib/gemini-adapter.js·usageOf] [用量映射补思考与缓存] [需求：Gemini 的候选 token 不含思考、思考单列 thoughtsTokenCount，缓存命中单列 cachedContentTokenCount；前端 Token 抽屉与月历统计只认 OpenAI 口径的 completion_tokens_details.reasoning_tokens / prompt_tokens_details.cached_tokens（2026-11-16 Grok 任务已统一），这里补齐后两处自然复用。totalTokenCount 实测 = prompt + candidates + thoughts，与 xAI「total 含思考、completion 不含」同构，故 total 原样带上] [注释时间 2026-11-16] */
function usageOf(j) {
  const u = unwrap(j).usageMetadata || {};
  const cd = { reasoning_tokens: Number(u.thoughtsTokenCount || 0) || 0 };
  const pd = { cached_tokens: Number(u.cachedContentTokenCount || 0) || 0 };
  return {
    prompt_tokens: u.promptTokenCount || 0,
    completion_tokens: u.candidatesTokenCount || 0,
    total_tokens: u.totalTokenCount || 0,
    completion_tokens_details: cd,
    prompt_tokens_details: pd,
  };
}

function finishOf(c, finishReason) {
  const r = String(finishReason || (c && c.finishReason) || 'STOP');
  if (r === 'MAX_TOKENS') return 'length';
  if (r === 'SAFETY' || r === 'RECITATION') return 'content_filter';
  return 'stop';
}

/* [位置:lib/gemini-adapter.js·fromResponse] [非流式响应翻译] [带 functionCall 的响应翻成 tool_calls + finish_reason=tool_calls，工具循环才知道要执行工具；thought part 导进 message.reasoning_content，下游工具循环/主链路按 OpenAI 口径接住] [注释时间 2026-11-04；改动：叠加工具调用；2026-11-12：思考链分离进 reasoning_content] */
function fromResponse(j, model) {
  const c = candidateOf(j);
  const parts = partsOf(c);
  const calls = toolCallsFromParts(parts);
  const txt = textFromCandidate(c);
  const thought = thoughtFromCandidate(c);
  const message = { role: 'assistant', content: calls.length ? (txt || '') : txt };
  if (thought) message.reasoning_content = thought;
  if (calls.length) message.tool_calls = calls;
  return {
    id: 'chatcmpl-gemini',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || '',
    choices: [{
      index: 0,
      message: message,
      finish_reason: calls.length ? 'tool_calls' : finishOf(c),
    }],
    usage: usageOf(j),
  };
}

function openaiChunk(model, delta, finish) {
  return {
    id: 'chatcmpl-gemini',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || '',
    choices: [{ index: 0, delta: delta, finish_reason: finish || null }],
  };
}

/* [位置:lib/gemini-adapter.js·mergeUsage] [流式用量分片合并] [需求：Gemini 流式每帧都带一份 usageMetadata，但字段不齐（实测首帧只有 promptTokenCount/thoughtsTokenCount/totalTokenCount，没有 candidatesTokenCount），只留最后一份可能缺字段；token 计数在一条流里只增不减，所以逐字段取大即可得到完整的终值] [注释时间 2026-11-16] */
function mergeUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const pick = function (x, y) { return Math.max(Number(x || 0) || 0, Number(y || 0) || 0); };
  const ad = a.completion_tokens_details || {};
  const bd = b.completion_tokens_details || {};
  const ap = a.prompt_tokens_details || {};
  const bp = b.prompt_tokens_details || {};
  return {
    prompt_tokens: pick(a.prompt_tokens, b.prompt_tokens),
    completion_tokens: pick(a.completion_tokens, b.completion_tokens),
    total_tokens: pick(a.total_tokens, b.total_tokens),
    completion_tokens_details: { reasoning_tokens: pick(ad.reasoning_tokens, bd.reasoning_tokens) },
    prompt_tokens_details: { cached_tokens: pick(ap.cached_tokens, bp.cached_tokens) },
  };
}

/* [位置:lib/gemini-adapter.js·usageChunk] [流式末帧用量帧] [需求：Gemini 流式把 usageMetadata 放在没有 candidate 的尾帧里，handleCloudCode 原先只处理有 candidate 的帧、结尾只写 [DONE]，用量整条丢掉，聊天落盘的 tokens 恒为 null；这里给一个 choices:[] 的纯用量帧（与 OpenAI stream_options.include_usage 的终帧同形），工具循环与落盘都能接] [注释时间 2026-11-16] */
function usageChunk(model, usage) {
  return {
    id: 'chatcmpl-gemini',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || '',
    choices: [],
    usage: usage,
  };
}

/* [位置:lib/gemini-adapter.js·textDeltaAdaptive] [流式文本自适应差量] [上游流式 chunk 的 parts 累积/增量两种行为都见过：以已发文本为前缀则发差量（累积），否则整片直发（增量），两种都不丢字] [注释时间 2026-11-04] */
function textDeltaAdaptive(full, sent) {
  if (!full) return '';
  if (sent && full.length >= sent.length && full.slice(0, sent.length) === sent) return full.slice(sent.length);
  if (!sent) return full;
  return full; // 增量模式：full 是新分片，直接发
}

module.exports = {
  toRequest: toRequest,
  fromResponse: fromResponse,
  textFromCandidate: textFromCandidate,
  thoughtFromCandidate: thoughtFromCandidate,
  candidateOf: candidateOf,
  partsOf: partsOf,
  toolCallsFromParts: toolCallsFromParts,
  usageOf: usageOf,
  usageChunk: usageChunk,
  mergeUsage: mergeUsage,
  finishOf: finishOf,
  openaiChunk: openaiChunk,
  unwrap: unwrap,
  textDeltaAdaptive: textDeltaAdaptive,
  toGeminiSchema: toGeminiSchema,
  userPartsOf: userPartsOf,
};
