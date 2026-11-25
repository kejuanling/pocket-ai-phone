'use strict';
// anthropic-adapter.js —— OpenAI Chat Completions <-> Anthropic Messages 纯函数翻译层。
//
// 约束：纯数据转换，不联网、不读写文件、不起定时器，可离线单元测试。
// 依据：Anthropic 官方 Streaming messages 文档（事件流：message_start -> [content_block_start ->
//   content_block_delta* -> content_block_stop]* -> message_delta+ -> message_stop；ping/未知事件要容错；
//   message_delta 的 usage 是「累计值」；tool_use 的 input 以 input_json_delta 片段到达，需累积到
//   content_block_stop 再解析；thinking 块以 signature_delta 收尾，回传时必须带签名）。
//
// 对外接口：
//   toAnthropicRequest(openaiBody, opts)  -> Anthropic /v1/messages 请求体
//   createStreamTranslator(opts)          -> 逐 SSE 事件喂入，吐出 OpenAI chat.completion.chunk 列表
//   fromAnthropicResponse(json)           -> 非流式响应转 OpenAI chat.completion
//   mapStopReason(reason)                 -> finish_reason

const DEFAULT_MAX_TOKENS = 16384;
// Claude 自适应思考档位（2026-10-28 探针实测：display=summarized 才返回可读思考文字）
const THINKING_EFFORTS = ['low', 'medium', 'high'];
const LEGACY_EFFORT_BUDGETS = { low: 2048, medium: 4096, high: 8192 };

// ---------------------------------------------------------------- 小工具
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function textOf(content) {
  // OpenAI content 可能是 string 或 part 数组；只取文本拼接（图片由 toBlocks 处理）
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (p) {
      if (typeof p === 'string') return p;
      if (p && (p.type === 'text' || p.type === 'input_text') && typeof p.text === 'string') return p.text;
      return '';
    }).join('');
  }
  return String(content);
}

function parseJsonSafe(s, fallback) {
  if (isObj(s)) return s;
  if (typeof s !== 'string' || !s.trim()) return fallback;
  try {
    const v = JSON.parse(s);
    return isObj(v) ? v : fallback;
  } catch (e) { return fallback; }
}

// OpenAI image_url -> Anthropic image 块。data: URL 走 base64 来源，其余走 url 来源。
function imagePartToBlock(part) {
  const url = part && part.image_url && (typeof part.image_url === 'string' ? part.image_url : part.image_url.url);
  if (!url || typeof url !== 'string') return null;
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  return { type: 'image', source: { type: 'url', url: url } };
}

// OpenAI content -> Anthropic content blocks（文本 + 图片）。空文本不产出块（Anthropic 拒绝空文本块）。
function contentToBlocks(content) {
  if (content == null) return [];
  if (typeof content === 'string') return content.length ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) { const t = String(content); return t.length ? [{ type: 'text', text: t }] : []; }
  const out = [];
  for (const p of content) {
    if (typeof p === 'string') { if (p.length) out.push({ type: 'text', text: p }); continue; }
    if (!p) continue;
    if ((p.type === 'text' || p.type === 'input_text') && typeof p.text === 'string') {
      if (p.text.length) out.push({ type: 'text', text: p.text });
    } else if (p.type === 'image_url') {
      const b = imagePartToBlock(p);
      if (b) out.push(b);
    }
    // 其余类型（file 等）Anthropic 原生接口未必认，这里丢弃，不冒险发未知块
  }
  return out;
}

// ---------------------------------------------------------------- 请求转换
// 输入：已经过 role-mapper 的 OpenAI 风格 body（messages 里可有 system/user/assistant/tool）。
// 输出：Anthropic Messages 请求体。
// [2026-11-01] 四层缓存断点（Anthropic 上限 4 个），按「变化频率」分层：
//   B1 system 人设末尾   —— 改人设才失效
//   B2 跨窗口注入块末尾   —— 快照重建 / 勾选变化 / Notebook 索引变才失效
//   B3 状态块末尾        —— 状态机 commitMerge 才失效
//   B4 消息尾巴          —— 每轮新增内容，不可避免
// 前缀语义：某层内容一变，只作废它之后的层，前面的照常命中。
// 改造前 B1/B2 合成一块（人设与 5 个注入块进同一字符串、共享同一断点），注入块一变，
// 连 tools 和人设一起白写——实测 2026-11-01 04:51/04:57 两次 blocks=4→5 各重写十万字符。
// [2026-11-04] 缓存时长：默认 5 分钟（不写 ttl）；会话里打开「Claude 加强缓存」→ 请求头 x-claude-cache-ttl=1h → opts.cacheTtl，断点全部改 1 小时。
// 同一请求里所有断点同一时长（1h 必须排在 5m 前面，全同一档就不会违反）。
function ccObj(ttl) { return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }; }

// 与 context/context-v2-builder.js 的 HEADERS 同源；那边改标题，这里要同步。
// 刻意不 require context 层：adapter 被 routes 直接依赖，不想把 context 的依赖图带进来。
const V2_INJECT_HEADERS = [
  '## System Instructions',
  '## Core Identity',
  '## Long-term Understanding',
  '## Earlier Days',
  '## Starred Dialog',
  '## Notebook Index',
  '## Pinned Notes',
  '## Memory Keywords',
];
const STATE_BLOCK_HEADER = '## Conversation State';

// 「人设」与「跨窗口注入块」的分界下标；无注入块返回 -1（不切）。
// 只在第一个注入块标题出现在非 0 位置时切——0 表示整段都是注入块，没有独立人设可保。
function injectCutIndex(sys) {
  let cut = -1;
  for (let i = 0; i < V2_INJECT_HEADERS.length; i++) {
    const at = sys.indexOf(V2_INJECT_HEADERS[i]);
    if (at > 0 && (cut < 0 || at < cut)) cut = at;
  }
  return cut;
}

function markBreakpoint(block, ttl) {
  if (!block) return false;
  block.cache_control = ccObj(ttl);
  return true;
}

/* [位置:lib/anthropic-adapter.js·isVolatileTailUser] [跨轮会变的尾巴消息识别] [B4 断点要打在「跨轮一字不变」的块上才有意义：原来只认 injectElapsed 的 [elapsed:…]，漏了 role-mapper 把对话中的 developer（唤醒块/推送回执/摘要块）转成的 user 消息——它们每响一次内容就不同（当前时间、距上次多久、这次为什么醒），断点打上去等于一轮一废] [注释时间 2026-11-06；原为 isElapsedBearingUser，11-06 扩判据并改名] */
// 两类都要跳过：
//   1) injectElapsed 加过 [elapsed:…] 的她这一轮说的话（发出去带标签、落盘不带）；
//   2) [系统唤醒]/[系统回执]/[系统消息] 开头的 developer 转 user 消息（前缀由 lib/role-mapper.js·claudeDevTag 加）。
// 不跳过的：工具结果（tool_result）、算不出间隔因而没加标签的她的话、AI 上一轮回复——跨轮形态一致，能命中。
// 判据只看最后一个 text 块，且以「该块能否跨轮复现」为准，不涉及内容长度。
function isVolatileTailUser(m) {
  if (!m || m.role !== 'user' || !Array.isArray(m.content)) return false;
  for (let i = m.content.length - 1; i >= 0; i--) {
    const b = m.content[i];
    if (!b || typeof b.text !== 'string') continue; // 图片等非文本块跳过，找最后一个文本块
    if (b.text.indexOf('[elapsed:') >= 0) return true;
    return /^\[(系统唤醒|系统回执|系统消息)\]/.test(b.text);
  }
  return false;
}

// B3 + B4：在 messages 上打两个断点。
// B3 找状态块所在消息（含 ## Conversation State），打在其最后一个非 thinking 块上；
// B4 打在整段消息尾巴。两者若落在同一块只打一次，不浪费断点配额。
// 找不到对应位置就什么都不做（宁可不缓存，也不乱打点）。
function applyMessageCacheBreakpoints(messages, ttl, stateInSystem) {
  if (!Array.isArray(messages) || !messages.length) return;
  // [2026-11-04] 状态块若已在 system 里拿了自己的断点（B3），消息里就不再找 B3，四个断点正好是 人设/注入/状态/尾巴。
  for (let i = messages.length - 1; i >= 0 && !stateInSystem; i--) {
    const m = messages[i];
    if (!m || !Array.isArray(m.content)) continue;
    let isState = false;
    for (let k = 0; k < m.content.length; k++) {
      const b = m.content[k];
      if (b && typeof b.text === 'string' && b.text.indexOf(STATE_BLOCK_HEADER) >= 0) { isState = true; break; }
    }
    if (!isState) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (!b || b.type === 'thinking' || b.type === 'redacted_thinking') continue;
      markBreakpoint(b, ttl);
      break;
    }
    break;
  }
  // B4：尾巴，但跳过「跨轮会变」的 user 消息。
  // [2026-11-01 修复实测] 原来打在最后一条消息上，而最后一条是「她这一轮说的话」——发送出口的
  // injectElapsed（routes/chat.js）会在这条末尾追加 \n[elapsed:2min58s]，且明确不落盘；
  // 下一轮它在历史里不带这个标签 → 块内容不同 → B4 整块作废，命中回退到 B3。
  // Anthropic 是按块匹配的（一个字符不同整块不命中）。
  // 实测 2026-11-01 12:03/12:06 两轮 cached 恒定 61,041、ccreate 30,052/30,600。
  // [2026-11-06 扩判据] 11-05 那次漏网的是唤醒块：0900 起唤醒走的是「末尾追加 developer [唤醒] 块」，
  // 该块由 role-mapper 转成 user 并带 [系统唤醒] 前缀，原文含「当前时间：2026-11-06 00:07。
  // 距离上一次对话：3 分钟前。这次是因为…」——每响一次都不同，B4 打上去一次没命中过。
  // 实测同一份 491 条上下文相隔 4 分钟：聊天（B4 打在 AI 上一轮回复）prompt 150540 命中 149905 新建 632；
  // 唤醒（B4 打在唤醒块）prompt 150530 命中 71353 新建 79174，新建量差 125 倍。
  // 现在末尾连续的回执/唤醒/摘要消息会被一并跳过，断点落到最近一条真实消息上（通常是 AI 上一轮回复）。
  // 代价不变：断点之后的增量（她这一轮的话 + 唤醒信息）每轮重写几百 token，这才是不可避免的量。
  // 判据见 isVolatileTailUser：带 [elapsed:…]，或以 [系统唤醒]/[系统回执]/[系统消息] 开头。
  let tail = messages.length - 1;
  while (tail >= 0 && isVolatileTailUser(messages[tail])) tail--;
  if (tail < 0) tail = messages.length - 1; // 整段都是她的话（极短对话）：退回末尾，聊胜于无
  for (let i = tail; i >= 0; i--) {
    const m = messages[i];
    if (!m || !Array.isArray(m.content)) continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (!b || b.type === 'thinking' || b.type === 'redacted_thinking') continue;
      if (b.cache_control) return; // 与 B3 落在同一块，不重复打点
      markBreakpoint(b, ttl);
      return;
    }
  }
}

// 从模型名里取 Claude 版本（claude-opus-5-5 → 5.5，claude-opus-4-6 → 4.6）。
// 只在 "claude" 之后找版本号：前面带数字的命名空间（v2-gateway/claude-…）不算版本。
/* [位置:lib/anthropic-adapter.js·parseClaudeVersion/normalizeThinkingEffort] [Claude 思考链分代] [4.6+ 用 adaptive+effort，5.x 可显式 adaptive；off 不发 legacy 字段；探针依据官方 thinking 文档与 2026-10-28 实测] [注释时间 2026-10-28] */
function parseClaudeVersion(modelId) {
  const s = String(modelId || '').toLowerCase();
  const i = s.indexOf('claude');
  if (i < 0) return null;
  const m = s.slice(i).match(/[-/]?(\d+)(?:[-.](\d{1,2}))?(?:$|[^0-9])/);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] ? Number(m[2]) : 0 };
}
function normalizeThinkingEffort(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'off' || s === 'none' || s === 'disabled') return null;
  return THINKING_EFFORTS.indexOf(s) >= 0 ? s : null;
}

function normalizeReplayContentBlocks(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const b of list) {
    if (!b) continue;
    if (b.type === 'thinking' && typeof b.thinking === 'string' && typeof b.signature === 'string' && b.signature) {
      out.push({ type: 'thinking', thinking: b.thinking, signature: b.signature });
    } else if (b.type === 'redacted_thinking' && typeof b.data === 'string' && b.data) {
      out.push({ type: 'redacted_thinking', data: b.data });
    } else if (b.type === 'text' && typeof b.text === 'string' && b.text) {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use' && b.id && b.name) {
      const input = parseJsonSafe(b.input, {});
      out.push({ type: 'tool_use', id: String(b.id), name: String(b.name), input: input });
    }
  }
  return out.length ? out : null;
}

// ---------------- 缓存断点诊断（只读，供 routes/anthropic-proxy.js 打一行日志） ----------------
// [位置:lib/anthropic-adapter.js·describeCacheBreakpoints] [四层断点落点与内容指纹] [需求：11-06 主会话连续三次「命中 74464 / 新建约 4 万」，网关不落请求体，只能靠 token 数反推是哪一层失效；打完这四个断点的位置与内容 sha1 前 8 位，下次直接看 hash 就知道是人设/注入块/状态块/尾巴哪一层变了] [注释时间 2026-11-06]
// 只读 req，不改任何字段；不联网、不读写文件，仍是纯函数。
const _crypto = require('crypto');
function _sha8(s) {
  try { return _crypto.createHash('sha1').update(String(s == null ? '' : s)).digest('hex').slice(0, 8); }
  catch (e) { return ''; }
}
function describeCacheBreakpoints(req) {
  const r = isObj(req) ? req : {};
  const out = [];
  const sys = Array.isArray(r.system) ? r.system : [];
  for (let i = 0; i < sys.length; i++) {
    const b = sys[i];
    if (!b || !b.cache_control) continue;
    const t = typeof b.text === 'string' ? b.text : '';
    out.push({ where: 'sys' + i, ttl: (b.cache_control && b.cache_control.ttl) || '5m', chars: t.length, hash: _sha8(t) });
  }
  const msgs = Array.isArray(r.messages) ? r.messages : [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i] || {};
    const c = Array.isArray(m.content) ? m.content : [];
    for (let j = 0; j < c.length; j++) {
      const b = c[j];
      if (!b || !b.cache_control) continue;
      const t = (typeof b.text === 'string') ? b.text : JSON.stringify(b);
      out.push({ where: 'msg' + i + '#' + j + '(' + (m.role || '?') + ')', ttl: (b.cache_control && b.cache_control.ttl) || '5m', chars: t.length, hash: _sha8(t) });
    }
  }
  return out;
}

function toAnthropicRequest(body, opts) {  const o = opts || {};
  const src = isObj(body) ? body : {};
  const msgs = Array.isArray(src.messages) ? src.messages : [];

  const sysParts = [];
  const turns = []; // [{role:'user'|'assistant', blocks:[...]}]，之后再合并相邻同角色

  function push(role, blocks) {
    if (!blocks.length) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role) { Array.prototype.push.apply(last.blocks, blocks); return; }
    turns.push({ role: role, blocks: blocks.slice() });
  }

  for (const m of msgs) {
    if (!m || !m.role) continue;
    if (m.role === 'system' || m.role === 'developer') {
      const t = textOf(m.content);
      if (t.trim()) sysParts.push(t);
      continue;
    }
    if (m.role === 'tool') {
      // 工具结果 -> user 消息里的 tool_result 块；连续多个工具结果会因 push 的合并落进同一条 user
      const id = m.tool_call_id ? String(m.tool_call_id) : '';
      if (!id) continue; // 没有 id 无法关联，丢弃比发错更安全
      const blk = { type: 'tool_result', tool_use_id: id, content: textOf(m.content) };
      push('user', [blk]);
      continue;
    }
    if (m.role === 'assistant' || m.role === 'model') {
      // Anthropic 交错思考回放：signed thinking 与 tool_use 的相对顺序参与签名校验。
      // anthropic_content_blocks 是翻译层从上游原样捕获的有序块；有它就整条回放，不再用
      // thinking_blocks + content + tool_calls 三份平行字段拼装（拼装会把思考前置，交错轮必 400）。
      const replay = normalizeReplayContentBlocks(m.anthropic_content_blocks);
      if (replay) { push('assistant', replay); continue; }
      const blocks = [];
      // 思考块（带签名才能回传；没有签名的不发，否则会被拒）
      if (Array.isArray(m.thinking_blocks)) {
        for (const tb of m.thinking_blocks) {
          if (tb && tb.type === 'thinking' && typeof tb.thinking === 'string' && tb.signature) {
            blocks.push({ type: 'thinking', thinking: tb.thinking, signature: tb.signature });
          } else if (tb && tb.type === 'redacted_thinking' && tb.data) {
            blocks.push({ type: 'redacted_thinking', data: tb.data });
          }
        }
      }
      Array.prototype.push.apply(blocks, contentToBlocks(m.content));
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (!tc || !tc.function || !tc.function.name) continue;
          blocks.push({
            type: 'tool_use',
            id: String(tc.id || ('toolu_' + Math.random().toString(36).slice(2, 12))),
            name: String(tc.function.name),
            input: parseJsonSafe(tc.function.arguments, {}),
          });
        }
      }
      push('assistant', blocks);
      continue;
    }
    // user 及其它未知角色一律按 user 处理
    push('user', contentToBlocks(m.content));
  }

  // Anthropic 要求首条为 user：若以 assistant 开头，前插一个占位 user（极少见，如会话从助手开场白开始）
  if (turns.length && turns[0].role !== 'user') {
    turns.unshift({ role: 'user', blocks: [{ type: 'text', text: o.leadingUserText || '（对话开始）' }] });
  }

  // tool_result 必须紧跟在含对应 tool_use 的 assistant 之后，并且在同一条 user 消息里排在其它内容之前
  for (const t of turns) {
    if (t.role !== 'user') continue;
    const results = t.blocks.filter(function (b) { return b.type === 'tool_result'; });
    if (results.length && results.length !== t.blocks.length) {
      const rest = t.blocks.filter(function (b) { return b.type !== 'tool_result'; });
      t.blocks = results.concat(rest);
    }
  }

  const messages = turns.map(function (t) {
    return { role: t.role, content: t.blocks };
  });

  // [位置:lib/anthropic-adapter.js·toAnthropicRequest] [提示词缓存断点] [只有打了 cache_control 的 prefix 会被缓存，长对话的缓存价值全在历史里；尾巴跟对话走，下一轮正好接上]
  // [2026-11-01] 四个断点全用上：B1 人设 + B2 注入块（见下方 system 分块）+ B3 状态块 + B4 消息尾巴。
  // 不打尾巴的话，历史每轮都全量重算，手机面板上就会一直显示「命中 0」。
  // 注：状态块是否在 system 里要等下面 system 切完才知道，所以消息断点放到 system 之后打（见下）。

  const req = {
    model: String(src.model || o.model || ''),
    max_tokens: pickMaxTokens(src, o),
    messages: messages,
    stream: src.stream === true,
  };
  const sys = sysParts.join('\n\n').trim();
  // [位置:lib/anthropic-adapter.js·toAnthropicRequest] [订阅凭证的身份行] [Claude 订阅 OAuth 要求 system 第一块是 Claude Code 身份行，缺了上游回不带原因的 429] [注释时间 2026-10-22]
  // 身份行单独一块、不加 cache_control（与 OpenMinis 一致）。
  // [2026-11-01] system 拆两块各拿一个断点：B1 人设 / B2 跨窗口注入块。
  // 注入块随快照重建、勾选变化、Notebook 索引变动而变；与人设捆一块时，它一变就拖着
  // tools（31k 字符）+ 人设（2.7k）一起重写。拆开后注入块失效只作废 B2 之后的层。
  // [2026-11-04] system 三段各拿一个断点：B1 人设 / B2 跨窗口注入块（含新加的 Pinned Notes、Memory Keywords）/ B3 状态块（状态机每次并入才变）。
  // 状态块若夹在 system 里（继承/快照写在注入块末尾的那种），单独切一段，状态一更新只重写它自己，不拖着前面整段注入块。
  // API Key 供应商此前 system 是一整串、没有断点，现在同样分块（身份行只有订阅凭证才有）。
  const ttl = o.cacheTtl === '1h' ? '1h' : '';
  let stateInSystem = false;
  if (o.oauthIdentity || sys) {
    const blocks = o.oauthIdentity ? [{ type: 'text', text: String(o.oauthIdentity) }] : [];
    if (sys) {
      const cut = injectCutIndex(sys);
      const stAt = sys.indexOf(STATE_BLOCK_HEADER);
      const parts = [];
      if (cut > 0) {
        parts.push(sys.slice(0, cut));
        if (stAt > cut) { parts.push(sys.slice(cut, stAt).replace(/\s+$/, '')); parts.push(sys.slice(stAt)); stateInSystem = true; }
        else parts.push(sys.slice(cut));
      } else {
        parts.push(sys);
      }
      parts.forEach(function (t) { if (t) blocks.push({ type: 'text', text: t, cache_control: ccObj(ttl) }); });
    }
    req.system = blocks.length ? blocks : undefined;
  }
  applyMessageCacheBreakpoints(messages, ttl, stateInSystem);

  // ---- 思考链（2026-10-28 官方文档复核 + 真实订阅探针）----
  // 4.6+：adaptive + output_config.effort；新一代默认 display=omitted（只剩签名），要可读正文必须 summarized。
  // 5.x：adaptive 属默认能力，显式 disabled/enabled 会被部分模型 400；这里只在选了档位时发 adaptive。
  // <4.6：保留 enabled+budget_tokens 老写法；4.6+ 无论开关一律不发 temperature/top_p。
  const modelVer = parseClaudeVersion(req.model);
  const isAdaptiveModel = !!modelVer && (modelVer.major > 4 || (modelVer.major === 4 && modelVer.minor >= 6));
  const effort = normalizeThinkingEffort(src.reasoning_effort != null ? src.reasoning_effort : o.thinkingEffort);
  if (isAdaptiveModel) {
    if (effort) {
      req.thinking = { type: 'adaptive', display: 'summarized' };
      req.output_config = { effort: effort };
    }
  } else {
    const thinking = buildThinking(src, o, req.max_tokens, effort);
    if (thinking) req.thinking = thinking;
    if (!thinking) {
      if (typeof src.temperature === 'number') req.temperature = src.temperature;
      if (typeof src.top_p === 'number' && typeof src.temperature !== 'number') req.top_p = src.top_p;
    }
  }
  if (Array.isArray(src.stop)) req.stop_sequences = src.stop.map(String).filter(Boolean);
  else if (typeof src.stop === 'string' && src.stop) req.stop_sequences = [src.stop];

  const tools = convertTools(src.tools);
  if (tools.length) {
    req.tools = tools;
    const tc = convertToolChoice(src.tool_choice);
    if (tc) req.tool_choice = tc;
  }
  return req;
}

function pickMaxTokens(src, o) {
  const cand = [src.max_tokens, src.max_completion_tokens, o.maxTokens];
  for (const v of cand) { if (Number.isInteger(v) && v > 0) return v; }
  return DEFAULT_MAX_TOKENS;
}

function buildThinking(src, o, maxTokens, effort) {
  // 显式 thinking 对象优先；其次请求侧 effort 映射；最后供应商 thinking_budget。
  // 预算必须 >=1024 且 < max_tokens。
  let budget = null;
  if (isObj(src.thinking) && src.thinking.type === 'enabled' && Number.isInteger(src.thinking.budget_tokens)) budget = src.thinking.budget_tokens;
  else if (effort && LEGACY_EFFORT_BUDGETS[effort]) budget = LEGACY_EFFORT_BUDGETS[effort];
  else if (Number.isInteger(o.thinkingBudget) && o.thinkingBudget > 0) budget = o.thinkingBudget;
  if (budget == null) return null;
  if (budget < 1024) budget = 1024;
  if (budget >= maxTokens) return null; // 预算不合法就不开，避免整包 400
  const out = { type: 'enabled', budget_tokens: budget };
  if (effort) out.display = 'summarized';
  return out;
}

function convertTools(tools) {
  if (!Array.isArray(tools)) return [];
  const out = [];
  for (const t of tools) {
    const f = t && t.type === 'function' ? t.function : null;
    if (!f || !f.name) continue;
    out.push({
      name: String(f.name),
      description: typeof f.description === 'string' ? f.description : '',
      input_schema: isObj(f.parameters) ? f.parameters : { type: 'object', properties: {} },
    });
  }
  return out;
}

function convertToolChoice(tc) {
  if (tc == null) return null;
  if (tc === 'auto') return { type: 'auto' };
  if (tc === 'required') return { type: 'any' };
  if (tc === 'none') return null; // Anthropic 无 none：不传 tools 才等价，这里交给调用方；不传 tool_choice 即 auto
  if (isObj(tc) && tc.type === 'function' && tc.function && tc.function.name) return { type: 'tool', name: String(tc.function.name) };
  return null;
}

// ---------------------------------------------------------------- 停止原因
function mapStopReason(r) {
  switch (r) {
    case 'end_turn': return 'stop';
    case 'stop_sequence': return 'stop';
    case 'max_tokens': return 'length';
    case 'tool_use': return 'tool_calls';
    case 'refusal': return 'content_filter';
    case 'pause_turn': return 'stop';
    default: return r ? 'stop' : null;
  }
}

// ---------------------------------------------------------------- 非流式响应
function fromAnthropicResponse(resp) {
  const r = isObj(resp) ? resp : {};
  let text = '';
  let reasoning = '';
  const toolCalls = [];
  const thinkingBlocks = [];
  const replayBlocks = [];
  for (const b of (Array.isArray(r.content) ? r.content : [])) {
    if (!b) continue;
    if (b.type === 'text' && typeof b.text === 'string') {
      text += b.text;
      if (b.text) replayBlocks.push({ type: 'text', text: b.text });
    } else if (b.type === 'thinking') {
      if (typeof b.thinking === 'string') reasoning += b.thinking;
      if (b.signature) {
        const rb = { type: 'thinking', thinking: b.thinking || '', signature: b.signature };
        thinkingBlocks.push(rb); replayBlocks.push(rb);
      }
    } else if (b.type === 'redacted_thinking' && b.data) {
      const rb = { type: 'redacted_thinking', data: b.data };
      thinkingBlocks.push(rb); replayBlocks.push(rb);
    } else if (b.type === 'tool_use') {
      replayBlocks.push({ type: 'tool_use', id: String(b.id || ''), name: String(b.name || ''), input: isObj(b.input) ? b.input : {} });
      toolCalls.push({
        id: String(b.id || ''),
        type: 'function',
        function: { name: String(b.name || ''), arguments: JSON.stringify(isObj(b.input) ? b.input : {}) },
      });
    }
  }
  const message = { role: 'assistant', content: text };
  if (reasoning) message.reasoning_content = reasoning;
  if (thinkingBlocks.length) message.thinking_blocks = thinkingBlocks;
  if (replayBlocks.length) message.content_blocks = replayBlocks;
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: String(r.id || ''),
    object: 'chat.completion',
    model: String(r.model || ''),
    choices: [{ index: 0, message: message, finish_reason: mapStopReason(r.stop_reason) }],
    usage: usageToOpenAI(r.usage),
  };
}

function usageToOpenAI(u) {
  if (!isObj(u)) return undefined;
  const inp = Number(u.input_tokens) || 0;
  const out = Number(u.output_tokens) || 0;
  const cr = Number(u.cache_read_input_tokens) || 0;
  const cc = Number(u.cache_creation_input_tokens) || 0;
  const res = { prompt_tokens: inp + cr + cc, completion_tokens: out, total_tokens: inp + cr + cc + out };
  if (cr || cc) {
    res.prompt_tokens_details = { cached_tokens: cr, cache_creation_tokens: cc };
    /* 11-04 补（产品确定）：透传上游 cache_creation 细分（5m/1h 写入量）——此前归一化把细分丢了，[usage] 日志看不出断点写的哪种时长；旧上游无细分对象时不加字段 */
    const _ccs = isObj(u.cache_creation) ? u.cache_creation : null;
    if (_ccs) {
      const _cc5 = Number(_ccs.ephemeral_5m_input_tokens) || 0;
      const _cc1 = Number(_ccs.ephemeral_1h_input_tokens) || 0;
      if (_cc5) res.prompt_tokens_details.cache_creation_5m_tokens = _cc5;
      if (_cc1) res.prompt_tokens_details.cache_creation_1h_tokens = _cc1;
    }
  }
  return res;
}

// ---------------------------------------------------------------- 流式翻译器
// 用法：const tr = createStreamTranslator({ model });
//       for (const evt of anthropicEvents) { const chunks = tr.push(evt); ... }  // evt 为已解析的 JSON 对象
//       tr.done 为 true 表示收到 message_stop；tr.error 非空表示收到 error 事件。
// 每个 chunk 都是 OpenAI chat.completion.chunk 对象；调用方负责序列化为 `data: ...\n\n`，结束时补 ``。
function createStreamTranslator(opts) {
  const o = opts || {};
  let id = '';
  let model = String(o.model || '');
  let created = Math.floor(Date.now() / 1000);
  let roleSent = false;
  let inputUsage = {};
  let outputTokens = 0;
  let finishReason = null;
  const blocks = {}; // index -> {type, toolIndex?, thinking?, signature?, text?, id?, name?, json?}
  let toolCount = 0;
  const thinkingBlocks = []; // 收集已完成的思考块（含签名），供调用方落盘/回传
  const contentBlocks = [];  // 原样有序块（thinking/text/tool_use），交错思考回放必须保序
  const contentBlockStops = []; // {index, block}：SSE 完成事件理论上按序，仍按 index 排序兜底
  const state = { done: false, error: null };

  function chunk(delta, finish, usage) {
    const c = {
      id: id || 'chatcmpl-anthropic',
      object: 'chat.completion.chunk',
      created: created,
      model: model,
      choices: [{ index: 0, delta: delta || {}, finish_reason: finish || null }],
    };
    if (usage) c.usage = usage;
    return c;
  }

  function ensureRole(out) {
    if (roleSent) return;
    roleSent = true;
    out.push(chunk({ role: 'assistant', content: '' }));
  }

  function push(evt) {
    const out = [];
    if (!isObj(evt) || !evt.type) return out;
    switch (evt.type) {
      case 'message_start': {
        const m = isObj(evt.message) ? evt.message : {};
        if (m.id) id = String(m.id);
        if (m.model) model = String(m.model);
        if (isObj(m.usage)) { inputUsage = m.usage; if (Number.isFinite(m.usage.output_tokens)) outputTokens = m.usage.output_tokens; }
        ensureRole(out);
        break;
      }
      case 'content_block_start': {
        const b = isObj(evt.content_block) ? evt.content_block : {};
        const idx = evt.index;
        if (b.type === 'tool_use') {
          const ti = toolCount++;
          blocks[idx] = { type: 'tool_use', toolIndex: ti, id: String(b.id || ''), name: String(b.name || ''), json: '' };
          ensureRole(out);
          out.push(chunk({ tool_calls: [{ index: ti, id: String(b.id || ''), type: 'function', function: { name: String(b.name || ''), arguments: '' } }] }));
        } else if (b.type === 'thinking') {
          blocks[idx] = { type: 'thinking', thinking: '', signature: '' };
        } else if (b.type === 'redacted_thinking') {
          blocks[idx] = { type: 'redacted_thinking', data: b.data || '' };
        } else {
          blocks[idx] = { type: b.type || 'text' };
        }
        break;
      }
      case 'content_block_delta': {
        const d = isObj(evt.delta) ? evt.delta : {};
        const b = blocks[evt.index] || (blocks[evt.index] = { type: 'text' });
        if (d.type === 'text_delta' && typeof d.text === 'string') {
          b.text = (b.text || '') + d.text;
          ensureRole(out);
          if (d.text) out.push(chunk({ content: d.text }));
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          if (b.type === 'tool_use') {
            b.json = (b.json || '') + d.partial_json;
            ensureRole(out);
            out.push(chunk({ tool_calls: [{ index: b.toolIndex, function: { arguments: d.partial_json } }] }));
          }
        } else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') {
          b.thinking = (b.thinking || '') + d.thinking;
          ensureRole(out);
          if (d.thinking) out.push(chunk({ reasoning_content: d.thinking }));
        } else if (d.type === 'signature_delta' && typeof d.signature === 'string') {
          b.signature = (b.signature || '') + d.signature; // 签名不发给前端，仅内部保留
        }
        // 其它 delta 类型（citations 等）按官方要求容错忽略
        break;
      }
      case 'content_block_stop': {
        const b = blocks[evt.index];
        if (b && b.type === 'thinking' && b.signature) {
          contentBlockStops.push({ index: evt.index, block: { type: 'thinking', thinking: b.thinking || '', signature: b.signature } });
        } else if (b && b.type === 'redacted_thinking' && b.data) {
          contentBlockStops.push({ index: evt.index, block: { type: 'redacted_thinking', data: b.data } });
        } else if (b && b.type === 'text' && typeof b.text === 'string' && b.text) {
          contentBlockStops.push({ index: evt.index, block: { type: 'text', text: b.text } });
        } else if (b && b.type === 'tool_use' && b.id && b.name) {
          contentBlockStops.push({ index: evt.index, block: { type: 'tool_use', id: b.id, name: b.name, input: parseJsonSafe(b.json, {}) } });
        }
        break;
      }
      case 'message_delta': {
        const d = isObj(evt.delta) ? evt.delta : {};
        if (d.stop_reason) finishReason = mapStopReason(d.stop_reason);
        // usage 为累计值：直接覆盖，不累加
        if (isObj(evt.usage) && Number.isFinite(evt.usage.output_tokens)) outputTokens = evt.usage.output_tokens;
        break;
      }
      case 'message_stop': {
        // 官方流按 index 顺序发 content_block_stop；这里再显式排序，防中转/代理乱序破坏签名关联顺序。
        if (contentBlockStops.length) {
          contentBlockStops.sort(function (a, b) { return a.index - b.index; });
          contentBlocks.length = 0;
          thinkingBlocks.length = 0;
          for (const item of contentBlockStops) {
            contentBlocks.push(item.block);
            if (item.block.type === 'thinking' || item.block.type === 'redacted_thinking') thinkingBlocks.push(item.block);
          }
        }
        ensureRole(out);
        const usage = usageToOpenAI(Object.assign({}, inputUsage, { output_tokens: outputTokens }));
        const finalChunk = chunk({}, finishReason || 'stop', usage);
        // 工具循环续轮必须原样回传思考块（含签名）。顶层自定义字段老客户端会忽略；
        // mcp-tool-loop 读它，下一轮放进 assistant.thinking_blocks 再由本文件还原。
        if (thinkingBlocks.length) finalChunk.thinking_blocks = thinkingBlocks.slice();
        if (contentBlocks.length) finalChunk.content_blocks = contentBlocks.slice();
        out.push(finalChunk);
        state.done = true;
        break;
      }
      case 'error': {
        const e = isObj(evt.error) ? evt.error : {};
        state.error = { type: String(e.type || 'error'), message: String(e.message || 'upstream error') };
        break;
      }
      default:
        break; // ping 及未知事件：忽略
    }
    return out;
  }

  return {
    push: push,
    get done() { return state.done; },
    get error() { return state.error; },
    get thinkingBlocks() { return thinkingBlocks.slice(); },
  };
}

// 把 SSE 文本流增量解析成事件对象。调用方把收到的字符串分片喂给 feed()，返回本次解析出的事件数组。
function createSSEParser() {
  let buf = '';
  function feed(text) {
    buf += String(text);
    const events = [];
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      let data = '';
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
      }
      if (!data) continue;
      try { events.push(JSON.parse(data)); } catch (e) { /* 坏分片忽略，不让整条流崩 */ }
    }
    return events;
  }
  return { feed: feed };
}

module.exports = {
  DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS,
  THINKING_EFFORTS: THINKING_EFFORTS,
  parseClaudeVersion: parseClaudeVersion,
  normalizeThinkingEffort: normalizeThinkingEffort,
  describeCacheBreakpoints: describeCacheBreakpoints,
  toAnthropicRequest: toAnthropicRequest,
  fromAnthropicResponse: fromAnthropicResponse,
  createStreamTranslator: createStreamTranslator,
  createSSEParser: createSSEParser,
  mapStopReason: mapStopReason,
  usageToOpenAI: usageToOpenAI,
};
