'use strict';
// 统一「自主唤醒调用器」（2026-09-15 唤醒并入网关）：
// 从会话时间线重建结构化上下文（与对话侧同一套加工函数：替换/容量提醒/工具记录转换/配对修复），
// 末尾追加 developer [唤醒] 块（落盘），
// 走工具循环（失败回退直连）调模型，返回文本。
// 唤醒特有行为（Bark 推送/[NO_ACTION]/日记/<wake> 定时/写回时间线）仍由调用方负责，本模块不碰。
//
// role 法（2026-09-15 定稿；0920 起 V2 开启时上下文与聊天侧完全统一——
// 同一 assembleAndApply 入口：system 人设 → V2 固定块（instructions/identity/
// understanding/moments/continuity）→ 历史 → Relevant → [唤醒] 块（落盘）→ 生成 assistant。
// V2 关闭时回退旧路径：system 人设 → 历史 → [唤醒]）。
// 内部消息出口前经 lib/role-mapper.js 按供应商 profile 翻译（default: developer→system）。

const fs = require('fs');
const path = require('path');
const contextReplacements = require('../context/context-replacements');
const upstreamAlert = require('../lib/upstream-alert'); // 2026-09-28 上游 402（余额不足）提醒
const mcp = require('../mcp/mcp-tool-loop');
const { McpServerClient, loadConfig, createClients } = require('../mcp/mcp-client');
const { mapMessagesForProvider } = require('../lib/role-mapper');
const worldbook = require('../lib/worldbook'); // 2026-11-21：世界书动态注入指令（与聊天侧同口径）
const chatCtx = require('./chat-context');
const ctxV2Runtime = require('../context/context-v2-runtime');
const outboundImages = require('../lib/outbound-images');
const modelRouter = require('../lib/model-router');   // 2026-11-06：出站图片加工唯一入口，与 routes/chat.js 同一套（此前唤醒侧完全不带表情包图、也不补绝对URL）

// 2026-10-30：取消唤醒侧工具白名单——唤醒与普通聊天完全同源：
// 同一份 config/mcp-servers.json（enabled:false 同步停用）+ 同一套会话 mcp_rules 过滤；
// 原来只挑「工具集合 + 花园 + 邮箱」，实测主会话聊天 17 个工具、唤醒 0 个（会话规则里只开了云服务器/搜索）。
// 2026-09-28：去掉永久缓存——与聊天侧一致，每次唤醒重新 loadConfig，
// 管理台改 mcp-servers.json（增/停服务器）即时生效，无需重启 gateway。
/* [位置:routes/wake-chat.js·getWakeMcpClients] [唤醒工具集与聊天完全一致] [2026-10-30报「唤醒链路的快照工具要跟普通聊天一模一样」：原来唤醒只挑「工具集合 + 花园 + 邮箱」白名单，且仍要再过一次会话 mcp_rules——实测主会话 s_mvtbmql2_v6xxu5 聊天侧 17 个工具（云服务器/DS搜索/glm搜索），唤醒侧白名单交集后 **0 个工具**；而且两边共用 mcp-tool-loop 的 30 秒工具缓存（键只有 sessionId），唤醒先跑还会把「少工具」的清单缓存给紧随其后的聊天。现在改为与 server.js 聊天链路完全同源：createClients(config/mcp-servers.json)，会话级 mcp_rules 仍由 loadToolsFor 统一过滤，两侧工具清单逐项一致] [注释时间 2026-10-30] */
function getWakeMcpClients(baseDir) {
  try {
    // 与 server.js 的 getMcpClients() 同一实现：全部 enabled 服务器，不再另设白名单。
    return createClients(path.join(baseDir, "config", "mcp-servers.json"));
  } catch (e) {
    wakeLogWarn("加载 MCP 工具配置失败: " + e.message);
    return [];
  }
}

/* [位置:routes/wake-chat.js·WAKE_MAX_TOOL_ROUNDS] [唤醒工具循环轮数上限=20（11-04 由 10 放宽）] [2026-10-28：唤醒对话限制 10 轮（主聊天/子智能体不限 Infinity）；唤醒是后台行为没人盯着，保留上限防死循环烧 token；打满不报错，循环强制 tool_choice=none 收尾，模型仍要工具才在正文尾附 roundCapNotice（小手机「继续」按钮锚）] [注释时间 2026-10-28] */
const WAKE_MAX_TOOL_ROUNDS = 20;   // 11-04：放宽到 20 轮（原 10，干活会话唤醒一轮常用满，最后一轮被迫收尾）

// 采样参数按 provider 配置适配（sampling_override in ai-providers.json）：与 routes/chat.js 聊天链路同一套钳制规则。
// [2026-10-30：唤醒链路要和普通聊天一模一样] 原来这里只适配 top_p、temperature/max_tokens 一律不传；现在三个参数都跟
// 「配置 → 生成定义 → 自定义参数」走，供应商 sampling_override 优先，null = 该供应商拒收该参数 → 不传。
function adaptGenForProvider(prov, gen) {
  const out = { temperature: gen && gen.temperature, top_p: gen && gen.top_p, max_tokens: gen && gen.max_tokens };
  const so = prov && prov.sampling_override;
  if (so) {
    if (so.temperature === null) out.temperature = undefined;
    else if (so.temperature !== undefined && out.temperature !== undefined && out.temperature !== so.temperature) out.temperature = so.temperature;
    if (so.top_p === null) out.top_p = undefined;
    else if (so.top_p !== undefined && out.top_p !== undefined) out.top_p = so.top_p;
  }
  return out;
}

// 2026-09-30 唤醒链路错误/警告日志统一带本地时间前缀（error.log 无时间戳，此前排障需人工对照 out.log）
function wakeNowLocal() {
  try {
    const tu = require("../utils/time_utils");
    return tu.formatDateTimeInTimeZone(new Date(), tu.resolveTimeZone());
  } catch (e) { return new Date().toISOString(); }
}
function wakeLogWarn(msg) { console.warn("[wake-chat " + wakeNowLocal() + "] " + msg); }

// 唤醒基础上下文：与聊天侧共用统一对话构建器（createConversationBuilder，见 chat-context.js）。
// 同源同前缀——同一会话同一时刻，唤醒请求与聊天请求的构建器输出逐字一致，上游前缀缓存共享。
// （原唤醒专属拼装/图片降级已并入构建器，2026-09-15 批3）
function buildWakeBaseMessages(deps, sessionId, buildConversation) {
  const msgs = buildConversation(sessionId);
  // 1025：时间缀开关——关 = 唤醒上下文里她的消息同样剥 <current_time>（幂等，剥过再剥无变化）
  try { if (typeof deps.resolveTimeTagToAi === "function" && !deps.resolveTimeTagToAi(sessionId) && typeof deps.stripTimeTagsFromMessages === "function") deps.stripTimeTagsFromMessages(msgs); } catch (e) {}
  // 2026-11-21：trace 剥离开关——开 = 唤醒上下文里 assistant 消息同样剥 <trace>（与聊天侧同口径）
  try { if (typeof deps.readStripTraceToAi === "function" && deps.readStripTraceToAi(sessionId) && typeof deps.stripTraceFromMessages === "function") deps.stripTraceFromMessages(msgs); } catch (e) {}
  return msgs;
}

// 统一唤醒补全：返回 { text, toolHistory, model }。
// opts: { session_id, wake_block, top_p(可选，不传则跟随设置里的「自定义参数」), with_tools=true, persist_wake_block=true }
/* [位置:routes/wake-chat.js·readGenSettings] [唤醒跟随「配置 → 生成定义 → 自定义参数」（三项全读）] [10-22 只补 top_p（新模型拒收 top_p 导致唤醒连续失败）；10-30 产品要求唤醒与聊天一模一样：temperature / top_p / max_tokens 三项都按聊天链路同一份设置补，没填/关着就不传；供应商 sampling_override 仍由 adaptGenForProvider 最后钳制] [注释时间 2026-10-30] */
function readGenSettings(baseDir) {
  const out = { temperature: undefined, top_p: undefined, max_tokens: undefined };
  try {
    const d = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'chat-settings.json'), 'utf-8'));
    const c = (d && d.cfg) || {};
    ['temperature', 'top_p', 'max_tokens'].forEach(function (k) {
      const v = c[k];
      if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) out[k] = Number(v);
    });
  } catch (e) { /* 读不到按「没开自定义参数」处理，不传 */ }
  return out;
}
/* [位置:routes/wake-chat.js·adoptToolLoopResult] [工具循环结果怎么用] [1112 口径堵掉了「工具循环抛错退回直连」；这里补另一条口子：正文为空时 text 仍空，会落进 if (!text) 补发一次无工具请求（丢掉工具上下文的「看着有回复、实际啥都没干」）。口径（11-15 产品确定更正）：只要 streamToolLoop 正常返回，这次唤醒就算成功——正文空是「这轮不说话」，属静默成功（scheduler 侧 if (!aiText) 本来就按静默处理），不判失败、不抛错；只留一条明确日志，并让调用方别再走无工具直连。只有本轮没带工具时才允许直连] [注释时间 2026-11-15] */
function adoptToolLoopResult(clients, r, deps) {
  const hasText = !!(r && typeof r.text === "string" && deps.normalizeContentToText(r.text).trim());
  if (hasText) {
    return {
      text: r.text,
      toolHistory: r.toolHistory || [],
      // 2026-09-24 P3-3：透出思考链（streamToolLoop 已收集 reasoning），供 applyWakeEventV2 落盘——
      // 否则唤醒回复刷新后无思考链区块，与聊天链路不一致
      reasoning: r.reasoning || "",
      streamTimeline: Array.isArray(r.streamTimeline) ? r.streamTimeline : null,
      usage: r.usage || null
    };
  }
  if (clients && clients.length) {   /* 带工具：本轮静默成功，不补发无工具请求，只落一条日志好排查 */
    wakeLogWarn("[wake-chat] 工具循环已返回但正文为空（带工具 " + clients.length + " 个），按静默成功处理，不再补发无工具请求");
  }
  return null;   // 没拿到正文：调用方据此跳过「有正文」分支（是否直连由 clients 是否为空决定）
}

async function runWakeCompletion(deps, opts) {
  const sessionId = String(opts.session_id || "").trim();
  if (!sessionId) throw new Error("session_id is required");
  let wakeBlock = String(opts.wake_block || "").trim();
  // 1010-14：temperature 不再显式传，用模型默认
  const _gen = readGenSettings(deps.baseDir);   /* 与聊天侧同一份自定义参数设置 */
  const topP = (opts.top_p !== undefined && Number.isFinite(Number(opts.top_p))) ? Number(opts.top_p) : _gen.top_p;
  const withTools = opts.with_tools !== false;
  let reasoning = "";   // 2026-09-24 P3-3：思考链透出（默认空串，直连兜底路径无思考链）
  const persistWakeBlock = opts.persist_wake_block !== false;
  // 声明在 try 外（2026-11-12）：LLM 最终失败时外层 catch 要靠它撤回已落盘的 [唤醒] 块
  let wakeBlockId = null;

  // 让替换/压缩按当前会话时间线工作（onResponse 钩子复位由 HTTP 层兜底，这里手动收口）
  contextReplacements.setActiveSession(sessionId || null);
  try {
    let msgs = buildWakeBaseMessages(deps, sessionId, ensureBuilder(deps));
    // 唤醒与聊天共用 Context V2 组装（0920 完全统一：同一 assembleAndApply 入口，
    // 同一时刻同一会话两侧上下文逐字一致，人设 system 恒在最顶）；开关关闭时完全保留旧路径。
    if (ctxV2Runtime.enabled(deps.baseDir)) {
      try {
        const r = await ctxV2Runtime.assembleAndApply({
          baseDir: deps.baseDir,
          sessionId: sessionId,
          messages: msgs,
          loadTimeline: deps.loadTimeline,
          normalizeContentToText: deps.normalizeContentToText,
        });
        msgs = r.messages;
        // 记忆浮现与聊天侧对齐（0920 拍板）：命中记忆原样写入时间线永久在场
        if (r.relevantHits && r.relevantHits.length) {
          const n = ctxV2Runtime.floatMemoriesToTimeline({ appendMessages: deps.appendMessages, sessionId, mems: r.relevantHits, baseDir: deps.baseDir });
          if (n) console.log('[wake-chat] 本轮记忆浮现', n, '条');
        }
      } catch (e) { wakeLogWarn("Context V2 组装失败，回退旧上下文: " + e.message); }
    }

    if (opts.wake_tail && wakeBlock) wakeBlock = wakeBlock + "\n\n" + String(opts.wake_tail);   // 事件叫醒的「这次是因为…」永远放最后

    // [唤醒] 块：先落盘（追加式、原地不动、不插位），再注入本次请求末尾。
    // 静默唤醒（模型不回话）时它就是该次唤醒在时间线里的唯一留痕。
    if (wakeBlock) {
      let blockContent = wakeBlock;
      if (persistWakeBlock) {
        try {
          // 唤醒块是时间线中的普通历史指令：每轮只追加，不删除旧块。
          // 旧块可由 context-replacements 在其进入被替换区间后随历史一起压缩。
          // 不在 buildConversation 之后删时间线消息，避免快照 content/snap_point 与时间线错位。
          const created = deps.appendMessages(sessionId, [{ role: "developer", content: blockContent }]);
          wakeBlockId = (created && created[0] && created[0].id) || null;
          console.log(`[wake-chat] developer [唤醒] 块已落盘（session ${sessionId}，${blockContent.length} 字）`);
        } catch (e) {
          wakeLogWarn("[唤醒] 块落盘失败（仍注入本次请求）: " + e.message);
        }
      }
      msgs.push({ role: "developer", content: blockContent });
    }

    // 容量提醒建议段的时间反查表（role+content → Date）：从会话时间线构建，
    // 与对话侧同口径。2026-09-22 审查 §3.5：此前只认 `tm.time` 字段（无则跳过），
    // 而对话侧用的是 extractTimestampWithMemory 的多级降级（time 字段 → <current_time> 标签 →
    // 行首/行尾日期），两侧对同一份历史会算出不同的时间区间。改为共用同一实现。
    const timeByKey = new Map();
    try {
      for (const tm of deps.loadTimeline(sessionId)) {
        if (!tm || tm.role === "system" || deps.isSpecialEvent(tm)) continue;
        const key = tm.role + "\u0000" + deps.normalizeContentToText(tm.content);
        // 1025：开关关时消息正文剥了 <current_time>，反查表同时放原始/剥后两个 key，两种形态都能命中
        const keyStripped = tm.role + "\u0000" + String(deps.normalizeContentToText(tm.content) || "").replace(/\n?<current_time>[\s\S]*?<\/current_time>/gi, "").replace(/\s+$/, "");
        const t = typeof deps.extractTimestampWithMemory === "function" ? deps.extractTimestampWithMemory(tm) : (tm.time ? new Date(tm.time) : null);
        if (t && !isNaN(t.getTime())) { if (!timeByKey.has(key)) timeByKey.set(key, t); if (keyStripped !== key && !timeByKey.has(keyStripped)) timeByKey.set(keyStripped, t); }
      }
    } catch (e) { /* 反查表失败不阻断，提醒退化为无时间锚 */ }

    // 2026-09-21 审查 H9：替换/容量提醒/工具转换/配对修复/出口净化全部收敛进统一管道
    // prepareModelMessages，顺序与聊天侧逐字一致（此前本侧是 replace→guard→convert→repair，与 chat.js 相反）。
    // 上下文替换由构建器按 id 定位套用（1018 起不再在管道里做内容锚点兜底）。
    /* [位置:routes/wake-chat.js·历史图分流] [历史图按模型看图能力分流（与聊天侧同口径）] [11-08 拍板：能看图=历史图保真（出口 decorate 注图片 id）；不能看图=历史图降级为带 id 占位（有转写附转写），当轮段不降级。模型解析从下方 mapMessagesForProvider 前提前到这里——分流必须在 sanitize 之前做（sanitizeForUpstream 是字段白名单，会剥 image_desc，转写要按它匹配）] [注释时间 2026-11-08] */
    const { provider: prov, model: resolvedModel } = deps.resolveChatModel(sessionId, null);
    const model = resolvedModel || deps.readEnvValue("MODEL_NAME") || "";
    const _wVision = modelRouter.modelSupportsVision(prov, model);
    const _shapedMsgs = chatCtx.shapeHistoryImagesForModel(msgs, { vision: _wVision });
    const sanitized = chatCtx.prepareModelMessages(_shapedMsgs, {
      ctxLimitGuard: ensureGuard(deps),
      sessionId,
      timeByKey,
      logPrefix: "[wake-chat]"
    });

    const _ut = require("../lib/upstream-target").resolveTarget(prov, deps.readEnvValue, model);
    const url = _ut.url;
    const key = _ut.key;
    if (_ut.headers && typeof deps.readClaudeCache1h === "function" && require("../lib/upstream-target").isClaudeChat(prov) && deps.readClaudeCache1h(sessionId)) _ut.headers["x-claude-cache-ttl"] = "1h";   // 11-04 Claude 加强缓存
    /* 缓存诊断日志（routes/anthropic-proxy.js·缓存断点日志）靠它区分会话；只给 Anthropic 代理加 */
    if (_ut.headers && require("../lib/upstream-target").isClaudeChat(prov)) _ut.headers["x-session-id"] = sessionId;
    const extraHeaders = _ut.headers;
    if (!url || !key) throw new Error("TARGET_API_URL / TARGET_API_KEY 或 AI 供应商未配置");
    // 2026-09-30 按最终模型适配采样参数（kimi → 1/1）；10-30 三项参数与聊天同口径
    const sampling = adaptGenForProvider(prov, { temperature: _gen.temperature, top_p: topP, max_tokens: _gen.max_tokens });
    /* [位置:routes/wake-chat.js·唤醒思考档位] [与聊天链路一致：走 Anthropic 翻译代理的供应商按会话注入 reasoning_effort，off 时不传] [注释时间 2026-10-30] */
    let reasoningEffort = null;
    try {
      const _utg = require("../lib/upstream-target");
      /* [位置:routes/wake-chat.js·唤醒思考档位] [与聊天链路一致：真·Claude 链路按会话注入 reasoning_effort，off 时不传；2026-11-12 收紧为 isClaudeChat（Gemini 订阅的思考由模型名档位后缀管，发了也没人读）] [注释时间 2026-10-30；改动 2026-11-12] */
      if (_utg.isClaudeChat(prov) && typeof deps.readClaudeThinkingEffort === "function") {
        reasoningEffort = deps.readClaudeThinkingEffort(sessionId) || null;
      }
      /* [位置:routes/wake-chat.js·唤醒 Grok 档位] [唤醒与聊天同口径：Grok 订阅按会话档位写 reasoning_effort] [11-16：grok-4.x 才认（grokEffortFor 统一归一，xhigh 在 4.5 及以下夹回 high）；空=不传，厂商默认 high] [注释时间 2026-11-16] */
      if (_utg.isGrokChat(prov) && typeof deps.readGrokThinkingEffort === "function") {
        reasoningEffort = _utg.grokEffortFor(model, deps.readGrokThinkingEffort(sessionId)) || null;
      }
    } catch (e) { reasoningEffort = null; }
    const profile = (prov && prov.profile) || "default";
    /* [位置:routes/wake-chat.js·出口思考开关] [按渠道关历史思考回传] [2026-11-12 GLM订阅：与聊天侧同口径，渠道配 drop_hist_reasoning 或会话配 glm_drop_hist_reasoning 时剥历史思考（唤醒上下文还原的历史工具消息思考同样剥掉），落盘与前端思考显示不动] [注释时间 2026-11-12；2026-11-15 会话级开关接通] */
    let _wakeDropRc = false;
    try {
      const _utg = require("../lib/upstream-target");
      if (_utg.isGlmChat(prov) && typeof deps.readGlmDropHistReasoning === "function") {
        _wakeDropRc = deps.readGlmDropHistReasoning(sessionId);
      }
    } catch (e) { _wakeDropRc = false; }
    const _wbSanitized = worldbook.injectWorldbook(sanitized, deps.baseDir, sessionId);
    const outbound = mapMessagesForProvider(profile, _wbSanitized, { dropHistReasoning: _wakeDropRc || !!(prov && prov.drop_hist_reasoning) });
    /* [位置:routes/wake-chat.js·出站图片装饰] [唤醒侧与聊天侧同口径加工出站图片] [11-06 实测：同一份历史聊天出站 5 个图块、唤醒 0 个（连她发的照片都没有），两侧前缀从第一张表情包就分叉，缓存从 B3（74464）往后四万 token 每轮重写；这里调的是聊天侧同一个 lib/outbound-images.js·decorateOutboundMessages] [注释时间 2026-11-06] */
    const _deco = outboundImages.decorateOutboundMessages(outbound, { vision: _wVision });   /* 2026-11-12：vision 模型表情包只发标签不发图，与聊天侧同口径 */

    /* [位置:routes/wake-chat.js·唤醒捕获 tools] [唤醒存档也带实际工具定义] [10-29 #46：上游实报含工具定义；白名单 clients 从下方工具循环处上移到捕获前，getToolsForSession 取真实清单（30s 缓存，与工具循环同源同值）；直连时无 tools 存空] [注释时间 2026-10-29] */
    const clients = withTools ? getWakeMcpClients(deps.baseDir) : [];
    const _wakeTools = clients.length ? await mcp.getToolsForSession(null, deps.baseDir, sessionId, clients) : [];
    // 捕获发给模型的完整上下文（管理台日志页可查看唤醒上下文）
    if (deps.setLastLLMCapture) {
      deps.setLastLLMCapture(outbound.map(m => {
        const cap = deps.splitMultimodalContent ? deps.splitMultimodalContent(m.content) : { content: m.content };
        return {
          role: m.role,
          content: cap.content,
          images: cap.images && cap.images.length ? cap.images : undefined,
          attachments: cap.attachments || undefined,
          tool_calls: m.tool_calls || undefined,
          tool_call_id: m.tool_call_id || undefined,
          /* 10-29 #46：存档保留思考链（reasoning_content / Claude 思考块原样回传）——上游计 token，统计页并入「最近对话」 */
          reasoning_content: m.reasoning_content || undefined,
          thinking_blocks: (Array.isArray(m.thinking_blocks) && m.thinking_blocks.length) ? m.thinking_blocks : undefined,
          anthropic_content_blocks: (Array.isArray(m.anthropic_content_blocks) && m.anthropic_content_blocks.length) ? m.anthropic_content_blocks : undefined
        };
      }), new Date().toISOString(), sessionId, _wakeTools);
    }

    /* [位置:routes/wake-chat.js·图片出口加工] [补全绝对URL + 内联本站图] [11-06 收敛：原来这里只调了内联，既没补绝对URL、也没有表情包转图，与聊天侧口径不一致；现在调聊天侧同一个 lib/outbound-images.js·fillAndInlineImages（内联只对 Claude 翻译代理生效：deepseek 只认 https 绝对 URL）] [注释时间 2026-11-06] */
    let _imgStats = null;
    try {
      _imgStats = await outboundImages.fillAndInlineImages(outbound, {
        resolveUrl: outboundImages.makeUrlResolver(outboundImages.publicOrigin()),
        isAnthropicProxy: outboundImages.isClaudeImageUpstream(prov),
      });
      if (_imgStats.inlined) console.log('[wake-chat] 本地图内联 base64: ' + _imgStats.inlined + ' 张 ' + Math.round(_imgStats.inlineBytes / 1024) + 'KB, 未内联 ' + _imgStats.inlineFailed + ' 张');
      if (!outboundImages.publicOrigin()) wakeLogWarn('[wake-chat] PUBLIC_BASE_URL 未配置，出站相对路径图未补绝对URL');
    } catch (_ie) { wakeLogWarn('[wake-chat] 图片出口加工失败（保持原样）: ' + _ie.message); }
    console.log('[wake-chat] 出站图: 表情包 ' + _deco.stickers + ' 张, 图片id ' + _deco.imageIds + ' 个, 图块共 ' + (_imgStats ? _imgStats.imageBlocks : -1) + ' 个');

    // 2026-11-12 出站音频：与聊天侧同口径——input_audio 只有 Gemini 订阅（Cloud Code 链路）认，
    // 其余供应商在这里剥成占位文字（转写文字附在「[语音消息 N秒 #id]」标签后，无信息损失）
    if (!(prov && (prov.oauth_provider === 'antigravity' || prov.oauth_provider === 'gemini'))) {
      const _audN = outboundImages.stripAudioPartsFromMessages(outbound);
      if (_audN) console.log('[wake-chat] 出站音频剥离 ' + _audN + ' 条（供应商不认音频 part）');
    }

    console.log(JSON.stringify({
      event: "wake_completion_forward",
      session: sessionId,
      model,
      with_tools: withTools && getWakeMcpClients(deps.baseDir).length > 0,
      messages: outbound.length,
      chars: sanitized.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0)
    }));

    let text = "";
    let toolHistory = [];
    /* [位置:routes/wake-chat.js·streamTimeline] [唤醒时间线传出] [streamToolLoop 已返回 streamTimeline 但此前被丢弃，applyWakeEventV2 拿不到 → 唤醒带工具的消息永远退化为思考工具全堆开头；传给 wake-scheduler → applyWakeEventV2 落盘] [注释时间 2026-10-28] */
    let streamTimeline = null;
    /* [位置:routes/wake-chat.js·usage] [唤醒 token 用量透出] [2026-11-01：静默/唤醒消息在时间线里算正常消息，抽屉统计行（输入/命中/未命中/输出）也要有——streamToolLoop 返回里本就带 usage（内部一直收集，2026-10-08 修过 Kimi 空 choices 帧那个 bug），直连兜底 data.usage 现成但此前两处都被丢弃；取回 → wake-scheduler → applyWakeEventV2 落盘，前端 dataOf→tokHTML 零改动] [注释时间 2026-11-01] */
    let usage = null;
    if (clients.length) {
      try {
        // 2026-09-23：工具循环由 runWithTools（非流式）改为 streamToolLoop（流式），
        // 与对话侧（server.js handleMcpRequest）**统一为同一条实现**。
        // 动因：此前两条链路各有一套工具循环，唯独唤醒侧只走非流式 runWithTools——
        // 这正是「同一批工具调用，只有 [wake-chat] 反复报 reasoning_content 400、
        // 对话侧从不报」的结构性原因（口径漂移）。项目既有约束是「两条链路必须同一套」
        // （见 routes/chat-context.js 文件头），工具循环层是最后一个未收敛的环节。
        // 唤醒没有 SSE 输出需求，故 onEvent 传 null（对话侧非流式请求同样如此，代码内
        // 有 `onEvent: (body.stream === true) ? onEvent : null` 的判空，安全）。
        // 返回字段兼容：r.text / toolHistory / reasoning / streamTimeline / usage 统一由 adoptToolLoopResult 取（11-15 起）；
        // 1028-01：maxToolRounds 显式传 WAKE_MAX_TOOL_ROUNDS（10，产品确定唤醒限 10 轮），
        // 不再共用 DEFAULT_MAX_TOOL_ROUNDS（主聊天侧已改 Infinity）。
        // 回滚：把下面 streamToolLoop 改回 runWithTools 即可（一行，记得同步带上 maxToolRounds）。
        const r = await mcp.streamToolLoop({
          upstreamUrl: url,
          upstreamKey: key,
          upstreamHeaders: extraHeaders,
          model,
          messages: outbound,
          serverClients: clients,
          sessionId,
          // 1028-01：唤醒工具循环限 10 轮（WAKE_MAX_TOOL_ROUNDS），不再共用主聊天默认值（主聊天已 Infinity）
          maxToolRounds: WAKE_MAX_TOOL_ROUNDS,
          temperature: sampling.temperature,
          top_p: sampling.top_p,
          max_tokens: sampling.max_tokens,
          reasoningEffort: reasoningEffort,
          onEvent: null,
          // 2026-10-03：与对话侧同一实现——唤醒时用 diary_add 工具写的日记同样要落时间线
          onDiaryWritten: deps.onDiaryWritten || null,
          // 1007 上下文快照 v2：工具冻死
          snapshotV2: Object.assign(require("../context/context-snapshot-v2"), { baseDir: deps.baseDir }),
          baseDir: deps.baseDir
        });
        // 11-15：工具循环结果统一过 adoptToolLoopResult——带工具却拿到空正文（没抛错）按失败抛出，
        // 不再落进下面的 if (!text) 悄悄补一次无工具请求（1112 口径漏掉的那条口子）
        const adopted = adoptToolLoopResult(clients, r, deps);
        if (adopted) {
          text = adopted.text;
          toolHistory = adopted.toolHistory;
          reasoning = adopted.reasoning;
          streamTimeline = adopted.streamTimeline;
          usage = adopted.usage;
          console.log(`[wake-chat] 工具循环完成：调用工具 ${toolHistory.length} 个，正文 ${text.length} 字`);
        }
      } catch (e) {
        /* [位置:routes/wake-chat.js·工具循环失败口径] [带工具唤醒失败直接报错] [1112（产品确定）对齐对话侧 1020 口径：带工具的请求失败不再退回无工具直连——没工具的回复「看着正常实际啥都没干」，降级被藏进一行日志；失败抛回 wake-scheduler 统一记为唤醒失败（槽位保留待重试，见 R3）] [注释时间 2026-11-12] */
        wakeLogWarn("工具循环失败，直接报错（不再退回无工具直连）: " + e.message);
        throw new Error("工具循环失败：" + ((e && e.message) || String(e)));
      }
    }

    if (!text && !clients.length) {
      // 无工具直连：只服务「本轮没带工具」的唤醒（clients 为空，会话没开 MCP）。
      // 带工具的：抛错由上面的 catch 兜（1112 口径），正常返回但没正文按静默成功（11-15 产品确定更正）——
      // 两种情形都不许补发无工具请求，否则就是「看着有回复、实际丢了工具上下文」的降级
      const _fbBody = { model, messages: outbound, stream: false };
      if (sampling.temperature !== undefined) _fbBody.temperature = sampling.temperature;
      if (sampling.top_p !== undefined) _fbBody.top_p = sampling.top_p;
      if (sampling.max_tokens !== undefined) _fbBody.max_tokens = sampling.max_tokens;
      if (reasoningEffort) _fbBody.reasoning_effort = reasoningEffort;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.UPSTREAM_TIMEOUT_MS || 180000);
      let resp;
      let respText;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }, extraHeaders),
          body: JSON.stringify(_fbBody),
          signal: controller.signal
        });
        // body 读取也必须在超时窗口内（2026-09-15 修复）：此前 finally 在 fetch 返回即清定时器，
        // 上游回完头再挂起时读 body 无超时（退化成 undici 默认 300s），唤醒互斥锁被长时间占死
        respText = await resp.text();
      } finally {
        clearTimeout(timer);
      }
      let data;
      try { data = JSON.parse(respText); }
      catch { throw new Error(`上游返回的不是 JSON（HTTP ${resp.status}）：${respText.slice(0, 300)}`); }
      if (!resp.ok) {
        if (resp.status === 402) upstreamAlert.note402({ model, detail: respText, sessionId }).catch(function () {});
        throw new Error(`上游模型请求失败（HTTP ${resp.status}）：${respText.slice(0, 300)}`);
      }
      text = String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
      usage = (data && data.usage) || null;
      if (text) console.log(`[wake-chat] 直连完成：正文 ${text.length} 字`);
    }

    return { text, toolHistory, reasoning, model, wakeBlockId, streamTimeline, usage };
  } catch (e) {
    /* [位置:routes/wake-chat.js·runWakeCompletion 失败回滚] [唤醒失败撤回已落盘的[唤醒]块] [此前失败中止时块永久留在时间线：2026-11-12 Gemini 订阅切 antigravity 后上游连续 400，每 10 分钟失败一次往主会话时间线堆了 60 条唤醒块（约 8k 字符/请求持续进上下文），产品确定清理历史块并要求失败回滚。按 appendMessages 返回的唯一 id 删（复用 server.js·removeTimelineMessages：splice 原地删保 __fp 指纹，filter 会丢指纹绕过快照守卫）；只删本块，不动工具循环已写入的日记等其他消息；静默唤醒（空文本但请求成功）走正常 return 不进此分支，块仍是唯一留痕；回滚自身失败只告警，不掩盖上游原始错误；deps 无该函数（旧测试环境）时跳过] [注释时间 2026-11-12] */
    if (persistWakeBlock && wakeBlockId && typeof deps.removeTimelineMessages === "function") {
      try {
        const removed = deps.removeTimelineMessages(sessionId, function (m) { return m && m.id === wakeBlockId && m.role === "developer"; });
        if (removed) console.log(`[wake-chat] 唤醒失败，已撤回 [唤醒] 块（session ${sessionId}，${removed} 条）`);
      } catch (re) {
        wakeLogWarn("[唤醒] 块回滚失败（保留原块）: " + re.message);
      }
    }
    throw e;
  } finally {
    try { contextReplacements.setActiveSession(null); } catch (e) {}
  }
}

// 统一对话构建器（惰性创建，与聊天侧同一实例逻辑）
// 2026-09-30 M24 修复：单例按 deps 身份失效重建——生产 deps 为 server.js 模块级常量（恒定，
// 行为与原版相同）；测试/多实例注入不同 deps 时不再被首次固化卡住（原版串味）。
let buildConversation = null;
let _builderDeps = null;
function ensureBuilder(deps) {
  if (!buildConversation || _builderDeps !== deps) {
    _builderDeps = deps;
    buildConversation = chatCtx.createConversationBuilder({
      loadTimeline: deps.loadTimeline,
      prepareMessageForLLM: deps.prepareMessageForLLM,
      stripPosition: deps.stripPosition,
      resolveSessionSystemPrompt: deps.resolveSessionSystemPrompt,
      incrementalContext: deps.incrementalContext,   // 0929 增量：块摘要化+尾部现算
      fullCache: deps.fullCache !== false,   // 0929 唤醒：整体缓存命中直接返回（时间线未变）
      // 1007 上下文快照 v2：前缀缓存（与聊天侧共用，冻死块）
      snapshotV2: Object.assign(require("../context/context-snapshot-v2"), { baseDir: deps.baseDir })
    });
  }
  return buildConversation;
}

// 守卫惰性创建（依赖 server.js 注入的时间线函数；直接调用 runWakeCompletion 也可用）
let ctxLimitGuard = null;
let _guardDeps = null; // 2026-09-30 M24：同 ensureBuilder，deps 身份失效重建
function ensureGuard(deps) {
  if (!ctxLimitGuard || _guardDeps !== deps) {
    _guardDeps = deps;
    ctxLimitGuard = chatCtx.createCtxLimitReminderGuard({
      contextCompactor: require('../context/context-compactor'),
      contextReplacements,
      loadTimeline: deps.loadTimeline,
      saveTimeline: deps.saveTimeline,
      appendSpecialEvent: deps.appendSpecialEvent,
      isSpecialEvent: deps.isSpecialEvent,
      normalizeContentToText: deps.normalizeContentToText
    });
  }
  return ctxLimitGuard;
}

// 2026-09-21 审查清理：POST /internal/wake-completions 零消费者已删除——
// 唤醒调度（lib/wake-scheduler.js）在 gateway 进程内直调 runWakeCompletion，
// HTTP 自环端点自独立唤醒进程退役后即无调用方。runWakeCompletion 仍经下方导出供进程内使用。
module.exports = function registerWakeChatRoutes(app, deps) {
  ensureGuard(deps);
};

module.exports.runWakeCompletion = runWakeCompletion;
module.exports._adoptToolLoopResult = adoptToolLoopResult;   // 11-15：测试钩子（带工具+空正文判定），线上无消费者
