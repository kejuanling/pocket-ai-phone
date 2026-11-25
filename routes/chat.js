'use strict';
// 从 server.js 拆出的 /v1/* 路由(models/sessions/history/events/timeline-sync + chat/completions)。
// 依赖注入：server.js 里用到的函数经 deps 传入；baseDir = 项目根目录。
// 鉴权沿用 server.js 的全局 addHook，不需要在此重复。
const path = require('path');
const fsp = require('fs-extra');
const mcp = require('../mcp/mcp-tool-loop');
const tagParser = require('../lib/tag-parser');
const imageDesc = require('../lib/image-desc');
const modelRouter = require('../lib/model-router');
const upstreamTarget = require('../lib/upstream-target');   // 2026-10-28：判断本轮是否走 Claude 原生翻译代理
const wakeSchedule = require('../lib/wake-schedule');
const contextReplacements = require('../context/context-replacements');
const upstreamAlert = require('../lib/upstream-alert'); // 2026-09-28 上游 402（余额不足）提醒
const contextCompactor = require('../context/context-compactor');
const { imageAbsUrl } = require('./imgurl');
const outboundImages = require('../lib/outbound-images');   // 2026-11-06：出站图片加工唯一入口（图片id注入/表情包转图/URL补全/内联base64），聊天与唤醒共用
const { formatDateTimeInTimeZone } = require('../utils/time_utils');
const { parsePushEcho, parseWakeEcho } = require('../utils/push');
// 对话侧/唤醒侧共用上下文加工函数（2026-09-15 唤醒并入网关）
const chatCtx = require('./chat-context');
const ctxV2Runtime = require('../context/context-v2-runtime'); // Context V2 共享运行时（0920 完全统一：聊天唤醒同一组装入口）
const { mapMessagesForProvider } = require('../lib/role-mapper');
const worldbook = require('../lib/worldbook'); // 2026-11-21：世界书动态注入指令（不落盘，按开关生效）
const { buildContextBlocks } = require('../context/context-v2-builder'); // 1008 分支注入快照（父口径组装）
const { createChatRequestLog } = require('../lib/chat-request-log'); // 1018：聊天请求记录（「上一个会话」唯一依据，唤醒不记）

/* [位置:routes/chat.js·normSid] [会话 ID 入口统一规范化] [11-14 审查 P3-1 收尾：此前 8 处入口只 String+trim 裸用，配置/快照/SSE 拿原始值而 loadTimeline 内部走 safeSessionToken 的 token——id 含非法字符时同一请求两套口径，可能配置写 A 会话数据写 B 会话。现在入口统一走这一个函数：空返回 ""（各调用方原有 `|| 'default'` / 400 分支不变）；合法 id（同版本路由 VER_SID_OK 口径 ^[A-Za-z0-9_-]{1,80}$，现网 s_* 会话全命中）原样返回零行为变化；异常 id 清洗/token 化（与 loadTimeline 同口径，数据不串），超长 token 兜底 md5 短串防 ENAMETOOLONG，都留 warn 日志] [注释时间 2026-11-14] */
const SID_OK = /^[A-Za-z0-9_-]{1,80}$/;
function normSid(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (SID_OK.test(s)) return s;
  const t = require('../lib/session-token').safeSessionToken(s);
  const out = (t && t.length <= 80) ? t : ("h" + require('crypto').createHash('md5').update(s).digest('hex').slice(0, 12));
  console.warn("[chat.js] 会话ID含异常字符，已按安全口径归一：" + JSON.stringify(s.slice(0, 40)) + " -> " + out);
  return out;
}
const frozenBlocks = require('../lib/frozen-blocks'); // 1018：日记/标星/笔记本建好即固定
const timelineVersions = require('../lib/timeline-versions'); // 2026-11-10：重新生成/编辑后重新生成的旧内容存成版本（‹2/3› 切换）
const contextV2Shadow = require('../context/context-v2-shadow'); // 1008 分支注入快照（assembleInput）

// 推送回显（成功推送的「刚刚给 X 发了 X 推送：」记录）需要在聊天页显示给用户看，
// 其余特殊事件（容量提醒/唤醒/日记/记忆浮现等）保持对前端隐藏。
function isPushEchoLike(m) {
  if (!m || m.role !== 'assistant' || typeof m.content !== 'string') return false;
  if (m.event_type === 'push') return true;
  return !!parsePushEcho(m.content);
}

// ---- 跨会话语义检索（TF-IDF + 字符 bigram，与前端旧逻辑同口径）----
// 文本 → 字符 bigram 序列（小写化；中英文数字以外的字符折成空格并丢弃；不足两字时退化为单字序列）
function charBigrams(text) {
  if (!text) return [];
  const t = String(text).toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ' ');
  const chars = [];
  for (let i = 0; i < t.length; i++) if (t[i] !== ' ') chars.push(t[i]);
  if (chars.length < 2) return chars;
  const r = [];
  for (let i = 0; i < chars.length - 1; i++) r.push(chars[i] + chars[i + 1]);
  return r;
}
// 对 items 建 TF-IDF 向量索引（每文档 L2 归一化），返回 { vocab, rows, items } 供 semanticSearch 点积
function buildSemIndex(items) {
  const vocab = {};
  const docFreq = [];
  const docs = [];
  for (let i = 0; i < items.length; i++) {
    const tokens = charBigrams(items[i].text);
    docs.push(tokens);
    const seen = {};
    for (let j = 0; j < tokens.length; j++) {
      const tok = tokens[j];
      if (seen[tok]) continue;
      seen[tok] = true;
      if (vocab[tok] === undefined) { vocab[tok] = docFreq.length; docFreq.push(1); }
      else docFreq[vocab[tok]]++;
    }
  }
  const n = docs.length;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const tokens = docs[i];
    if (!tokens.length) { rows[i] = { idx: [], val: [] }; continue; }
    const tf = {};
    for (let j = 0; j < tokens.length; j++) { const t = tokens[j]; tf[t] = (tf[t] || 0) + 1; }
    const total = tokens.length;
    const idx = [], val = []; let nsq = 0;
    for (const t in tf) {
      const k = vocab[t]; if (k === undefined) continue;
      const tfv = tf[t] / total;
      const idfv = Math.log((n + 1) / (docFreq[k] + 1)) + 1;
      const v = tfv * idfv;
      idx.push(k); val.push(v); nsq += v * v;
    }
    const nm = Math.sqrt(nsq);
    if (nm > 0) for (let k = 0; k < val.length; k++) val[k] /= nm;
    rows[i] = { idx, val };
  }
  return { vocab, rows, items };
}
// 查询向量与索引逐行点积（稀疏交集），返回 [{ i, score }] 按分降序；低于 threshold 丢弃（默认 0.05）
function semanticSearch(index, query, threshold) {
  if (!threshold) threshold = 0.05;
  const qTokens = charBigrams(query);
  if (!qTokens.length) return [];
  const qTf = {};
  for (let i = 0; i < qTokens.length; i++) { const t = qTokens[i]; qTf[t] = (qTf[t] || 0) + 1; }
  const qTotal = qTokens.length;
  const qIdx = [], qVal = []; let qNsq = 0;
  for (const t in qTf) {
    if (index.vocab[t] === undefined) continue;
    const k = index.vocab[t];
    const v = qTf[t] / qTotal;
    qIdx.push(k); qVal.push(v); qNsq += v * v;
  }
  if (!qIdx.length) return [];
  const qNm = Math.sqrt(qNsq);
  for (let k = 0; k < qVal.length; k++) qVal[k] /= qNm;
  const results = [];
  for (let i = 0; i < index.rows.length; i++) {
    const row = index.rows[i];
    if (!row.idx.length) continue;
    let dot = 0;
    for (let qi = 0; qi < qIdx.length; qi++) {
      const qk = qIdx[qi];
      for (let di = 0; di < row.idx.length; di++) {
        if (row.idx[di] === qk) { dot += row.val[di] * qVal[qi]; break; }
      }
    }
    if (dot >= threshold) results.push({ i, score: dot });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ---- 会话列表元数据缓存（以文件 mtimeMs+size 为失效键，避免每次全量 loadTimeline）----
const sessionMetaCache = new Map();

// ---- 跨会话搜索索引缓存（以全部时间线文件的 mtime+size 指纹为失效键）----
// 前端仅 180ms 防抖，连续击键会连续触发 /v1/search；items 收集 + TF-IDF 建索引都按指纹复用
const searchIndexCache = { fp: null, index: null };
/* [位置:routes/chat.js·searchIndexCacheAi] [AI 检索专用索引缓存] [10-27 第11项：AI 走 /internal/search 要排除「不参与检索」组的会话，手机走 /v1/search 不排除，两边的会话集合不同，索引缓存分开放，免得互相顶掉反复重建] [注释时间 2026-10-27] */
const searchIndexCacheAi = { fp: null, index: null };

  // ===== 10-29 #42/#45：检索缓存持久化=====
  // raw（每会话可搜原始条目）+ per-file 指纹落盘 data/cache/search-cache-<kind>.json。
  // 纯缓存文件，删了会自动重建，不算数据。写盘 5s 防抖 + 60s 节流：聊天期间每条新消息都会让指纹变化，
  // 不节流的话每条消息后都要 stringify 十几 MB 大 JSON 卡主线程几十毫秒到几百毫秒（手机烫）。
  const SEARCH_CACHE_DIR = path.join(__dirname, '..', 'data', 'cache'); // 顶层无 baseDir（工厂参数）——10-29 挪到顶层时漏改，require 即炸 ReferenceError，elapsed 修复时顺手纠（等价项目根，与 deps.baseDir 同义）
  const searchCacheTimers = {};
  const searchCacheLastWrite = { t: 0 };
  function loadSearchCache(kind, fp) {
    try {
      const j = JSON.parse(fsp.readFileSync(path.join(SEARCH_CACHE_DIR, 'search-cache-' + kind + '.json'), 'utf8'));
      if (!j || j.v !== 1 || j.fp !== fp || !j.raw || typeof j.raw !== 'object' || !j.fileFp) return null;
      const raw = new Map();
      for (const sid in j.raw) if (Array.isArray(j.raw[sid]) && j.raw[sid].length) raw.set(sid, j.raw[sid]);
      return raw.size ? { raw, fileFp: j.fileFp } : null;
    } catch (e) { return null; }
  }
  function saveSearchCache(kind, fp, raw, fileFp) {
    if (searchCacheTimers[kind]) clearTimeout(searchCacheTimers[kind]);
    const flush = function () {
      const now = Date.now();
      if (searchCacheLastWrite.t && now - searchCacheLastWrite.t < 60000) {
        searchCacheTimers[kind] = setTimeout(flush, 60000 - (now - searchCacheLastWrite.t)); return;
      }
      searchCacheLastWrite.t = now;
      try {
        fsp.mkdirSync(SEARCH_CACHE_DIR, { recursive: true });
        const obj = { v: 1, fp: fp, savedAt: new Date().toISOString(), fileFp: fileFp, raw: {} };
        for (const [sid, row] of raw) if (row.length) obj.raw[sid] = row;
        const tmp = path.join(SEARCH_CACHE_DIR, 'search-cache-' + kind + '.json.tmp');
        fsp.writeFileSync(tmp, JSON.stringify(obj));
        fsp.renameSync(tmp, path.join(SEARCH_CACHE_DIR, 'search-cache-' + kind + '.json'));
      } catch (e) { console.warn('[search-cache] 落盘失败（不影响检索）:', e.message); }
    };
    searchCacheTimers[kind] = setTimeout(flush, 5000);
  }

// ---- 工具调用记录 → role=tool 消息组（发送模型前的内存转换，不落盘）----
// 2026-09-15 已搬至 routes/chat-context.js（对话侧/唤醒侧共用），此处经 chatCtx 调用。

// 1020：发给上游的请求体只留 OpenAI 兼容字段（白名单）。此前直连路把整个客户端请求体 {...body} 原样转发，
// 前端私有字段 session_id / client_msg_id / reply_msg_id / regen_anchor_id 也一起发给了上游，严格上游会 400。
// stream_options 只在流式时带（OpenAI 规定非流式带它会报错，前端不分流式都会发）。
const UPSTREAM_BODY_KEYS = ["model", "stream", "temperature", "top_p", "max_tokens", "max_completion_tokens", "stop",
  "presence_penalty", "frequency_penalty", "seed", "n", "response_format", "tools", "tool_choice", "parallel_tool_calls",
  "logprobs", "top_logprobs", "logit_bias", "user", "reasoning_effort", "thinking", "enable_thinking", "top_k"];
function buildUpstreamBody(body, messages) {
  const out = {};
  for (const k of UPSTREAM_BODY_KEYS) {
    if (body && body[k] !== undefined && body[k] !== null) out[k] = body[k];
  }
  if (out.stream === true && body && body.stream_options && typeof body.stream_options === "object") out.stream_options = body.stream_options;
  out.messages = messages;
  return out;
}

/* [位置:routes/chat.js·_IMG_400_DEGRADE_RE] [图片400去图重试识别] [10-27：三类上游拒图错误都值得「剥图重试一次」兜底——上游拉不到图（09-15 起）、deepseek 拒 assistant 带图、GLM 端点拒一切图（code 1210）；后两类是 10-25 表情包出口转图上线后撞出来的，转图侧已收紧为只转 user，这里兜住漏网（直连分支用；MCP 分支的同款常量在 mcp/mcp-tool-loop.js）] [注释时间 2026-10-27] */
const _IMG_400_DEGRADE_RE = /failed to download image|timed out while trying to download the file|Image in assistant message is not supported|messages\.content\.type[^"']*参数非法/i;

/* ========================
   10-29（用户 #49 三改）：[elapsed:45s] 距上一条消息的时间差标签——改回发送出口动态注入，不落盘。
   落盘方案试了半天（tag 随消息写进时间线），污染消息数据：前端要专门藏、编辑框能看到、
   检索会命中，产品确定回退动态注入——tag 只在 outboundMessages 出口加一次，时间线/快照/检索/
   前端全部干净；已落盘期间的历史 tag 留在盘上无害（前端 stripCT 已剥、AI 看着也合理），不清。
   跳过「本轮消息」按位置不按内容：动态注入发生在本轮已落盘之后，时间线末尾第一条真实 user
   就是本轮（重新生成=触发消息本身），跳过它往前取一条真实消息（通常是 AI 的回复）；
   2026-10-31 起间隔=两条消息的 time 相减，不再用 now 减上一条 user 的时间（详见 findPrevMsgTime）；
   首版内容匹配因落盘版带时间缀、发模型版
   被剥（开关关）必失败 → 恒显示 1s，10-29 已修。纯函数放顶层可单测（module.exports._elapsed）。 */
function elapsedFmt(ms) {
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return s + 's';
  const mi = Math.floor(s / 60), rs = s % 60;
  if (mi < 60) return rs ? mi + 'min' + rs + 's' : mi + 'min';
  const h = Math.floor(mi / 60), rm = mi % 60;
  if (h < 24) return rm ? h + 'h' + rm + 'min' : h + 'h';
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? d + 'd' + rh + 'h' : d + 'd';
}
/* 时间线倒序取「本轮用户消息」和「它之前那条真实消息」的时间，返回 { curMs, prevMs }。
   注入发生在本轮已落盘之后，末尾第一条真实 user 就是本轮（重新生成=触发消息本身，其后
   可能还留着上一轮的 assistant 回复，所以不能直接拿「时间线最后两条」）；再从它往前找
   第一条真实消息（user/assistant；developer 唤醒块/回执、system、特殊事件都不算），
   通常就是 AI 的回复。间隔 = 两条消息的 time 相减，即「她这条消息距上一条消息多久」。
   2026-10-31改：原来取上一条 user 消息的 time 减 Date.now，把 AI 自己回话的耗时
   （几十秒到几分钟）也算进了间隔；现在只量两条消息之间的间隔。连发的两条 user 照实算，
   AI 主动唤醒发的消息也算「上一条」，不做特殊跳过。
   会话第一条（往前没了）/上一条无 time 字段（老数据）返回 prevMs=null → 不加标签。 */
function findPrevMsgTime(timeline, isReal) {
  const tl = Array.isArray(timeline) ? timeline : [];
  let curMs = null, prevMs = null, seenCur = false;
  for (let i = tl.length - 1; i >= 0; i--) {
    const m = tl[i];
    if (!m) continue;
    if (!seenCur) {
      if (m.role !== 'user' || (isReal && !isReal(m))) continue;
      seenCur = true;
      const d = m.time ? new Date(m.time) : null;
      curMs = (d && !isNaN(d.getTime())) ? d.getTime() : null;
      continue;
    }
    if (isReal && !isReal(m)) continue;
    const d = m.time ? new Date(m.time) : null;
    prevMs = (d && !isNaN(d.getTime())) ? d.getTime() : null;
    break;
  }
  return { curMs: curMs, prevMs: prevMs };
}
/* 发送出口动态注入：给 msgs 最后一条 user 末尾加 '\n[elapsed:2h]'（独立一行，AI 阅读清晰；
   string/parts 两种形态；只替换该消息为新对象，不原地改防污染共享引用）。
   开关关/首条消息/算不出间隔都不加；出错不挡发送。纯函数（env 注入 resolve/loadTimeline/isReal）可单测。
   2026-10-31：倒序找目标时跳过 _fromDeveloper（role-mapper 在本函数之前把对话中 developer 转成了
   user——claude 出口唤醒块/回执原位转 user，要求转换消息不带时间差标签；重新生成等场景时间线
   尾部可能停在 developer 回执上，不跳过会把 [elapsed] 加到回执而不是她那条消息）。 */
function injectElapsed(sessionId, msgs, env) {
  try {
    if (!env.resolve(sessionId)) return;
    if (!Array.isArray(msgs) || !msgs.length) return;
    let idx = -1, cur = null;
    for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i] && msgs[i].role === 'user' && !msgs[i]._fromDeveloper) { idx = i; cur = msgs[i]; break; } }   /* 10-31: 跳过 developer 转的 user（见上方注释） */
    if (!cur) return;
    const pair = findPrevMsgTime(env.loadTimeline(sessionId), env.isReal) || {};
    if (!pair.prevMs) return;
    const gap = (pair.curMs || Date.now()) - pair.prevMs;   /* 两条消息的 time 相减；本轮无 time 时才用当前时间兜底 */
    if (!isFinite(gap) || gap <= 0) return;
    const tag = '\n[elapsed:' + elapsedFmt(gap) + ']';
    let nc = null;
    if (typeof cur.content === 'string') nc = cur.content + tag;
    else if (Array.isArray(cur.content)) {
      const arr = cur.content.slice(); let done = false;
      for (let i = arr.length - 1; i >= 0; i--) { const p = arr[i]; if (p && p.type === 'text' && typeof p.text === 'string') { arr[i] = Object.assign({}, p, { text: p.text + tag }); done = true; break; } }
      if (!done) arr.push({ type: 'text', text: tag });
      nc = arr;
    }
    if (nc != null) msgs[idx] = Object.assign({}, cur, { content: nc });
  } catch (e) { try { console.warn('[elapsed] 注入失败（不影响发送）: ' + (e && e.message)); } catch (_) {} }
}

module.exports = function registerChatRoutes(app, deps) {
  // 显式停止只取消对应会话/回复，不把普通浏览器断线误当成用户取消。
  const activeChatRequests = new Map();
  const {
    baseDir,
    configuredModelName,
    loadTimeline,
    isRealMessageForTimeline,
    timelineFileFor,
    normalizeMessageForTimeline,
    buildTimeline,
    saveTimeline,
    appendMessages,
    appendRequestMessages,
    readSessionArchive,
    tailHasReply,
    markSessionDeleted,
    sseSubscribe,
    sseUnsubscribe,
    sseNotify,
    SSE_HEARTBEAT_MS,
    setClientVisible,
    isClientWatching,
    recentReplies,
    activeGenMap,
    ACTIVE_GEN_TTL_MS,
    isRecentReplyCacheable,
    IDEMPOTENCY_TTL_MS,
    IDEMPOTENCY_PENDING_WAIT_MS,
    IDEMPOTENCY_PENDING_TOTAL_MS,
    setRecentReply,
    beginPendingReply,
    waitPendingReply,
    clearPendingReply,
    sessionCrossInjectOverride,
    saveSessionCrossInjectOverride,
    prepareMessageForLLM,
    normalizeContentToText,
    isSpecialEvent,
    extractTimestampWithMemory,
    stripPosition,
    resolveChatModel,
    resolveSessionSystemPrompt,
    sessionModelProviderOverride,
    saveSessionModelProviderOverride,
    readEnvValue,
    UPSTREAM_TIMEOUT_MS,
    handleMcpRequest,
    getMcpClients,
    splitMultimodalContent,
    extractAssistantThinking,
    parseWakeTagAndSchedule,
    createContentTagFilter,
    appendSpecialEvent,
    MCP_ENABLED,
    summarizeMessagesForLog,
    setLastLLMCapture
  } = deps;
  const TL_DIR = require('../lib/timeline-dir').timelineDirOf(baseDir); // 1018-12：时间线统一放 timeline_data/

  /* [位置:routes/chat.js·fail/fail500] [统一错误出口] [11-14 审查 B 批 a：全文件 84 处错误响应各写各的，500 直接把 err.message 原文（可能带文件路径、内部参数）回给客户端，前端只能正则从字符串里抠状态码。现在统一成 { error: 人话, code: 机器码 }——error 保持字符串是为了兼容已有 20 多处按字符串直接展示的调用方与第三方脚本，code 给新前端按码处理；500 的原文只进服务端日志。工具报错、内部异常一律不再外泄] [注释时间 2026-11-14] */
  function fail(reply, status, code, message, extra) {
    const body = { error: String(message == null ? '出错了' : message), code: code || 'error' };
    if (extra && typeof extra === 'object') Object.assign(body, extra);
    return reply.code(status).send(body);
  }
  function fail500(reply, e, code, message, extra) {
    console.error('[chat.js]', code || 'internal_error', (e && e.message) || e || 'unknown');
    return fail(reply, 500, code || 'internal_error', message || '服务器出错了，稍后再试', extra);
  }

  // 会话上下文容量提醒守卫（2026-09-15 搬至 routes/chat-context.js，对话侧/唤醒侧共用同一实现）
  const ctxLimitGuard = chatCtx.createCtxLimitReminderGuard({
    contextCompactor,
    contextReplacements,
    loadTimeline,
    saveTimeline,
    appendSpecialEvent,
    isSpecialEvent,
    normalizeContentToText
  });

  // 统一对话构建器（2026-09-15 批3核心）：聊天与唤醒同源同前缀的唯一上下文来源
  const buildConversation = chatCtx.createConversationBuilder({
    loadTimeline,
    prepareMessageForLLM,
    stripPosition,
    resolveSessionSystemPrompt,
    incrementalContext: contextReplacements.buildIncrementalContext,   // 0929 增量：块摘要化+尾部现算
    fullCache: false,   // 0929 聊天只走增量；整体缓存留给唤醒/重试（fp 不变场景）
    // 1007 上下文快照 v2：前缀缓存（人设+V2块+工具+历史冻死，仅三类事件重建）
    snapshotV2: Object.assign(require("../context/context-snapshot-v2"), { baseDir })
  });

  // 日记共享模块（2026-09-16）：日常聊天 [DIARY] 提取与保存（与唤醒共用 lib/diary.js）
  const diaryLib = require('../lib/diary')({ baseDir, readEnvValue });

  // （Context V2 输入组装 assembleInput 由 server.js /admin/cross-window-inject 预览接口直接调用；
  //   Shadow 观察分支已随 S3 观察期结束退役，2026-09-28。）

  // S4 的换块（applyContextV2）与记忆浮现写入（floatMemoriesToTimeline）已于 0920 上移到
  // context-v2-runtime 共享运行时（与唤醒侧完全统一，同一 assembleAndApply 入口），此处不再保留本地副本。

  app.get('/v1/models', async (req, reply) => {
    reply.send({
      object: 'list',
      data: [{ id: configuredModelName(), object: 'model', created: 0, owned_by: 'gateway' }]
    });
  });

  /* [位置:routes/chat.js·stripPhoneOnlySystemBlocks] [跨客户端剥离小手机专用永久上下文块] [保留 data/pinned.json 原样供小手机使用，仅在 session_context 返回给外部客户端时剔除 Tag Usage / 互动卡片 / 表情包 三段小手机专用标签说明] [注释时间 2026-11-24] */
  function stripPhoneOnlySystemBlocks(messages) {
    const PHONE_ONLY_TITLES = ['Tag Usage', '互动卡片', '表情包'];
    const reList = PHONE_ONLY_TITLES.map(function (t) {
      const escT = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(?:^|\\n)\\[' + escT + '\\]\\n[\\s\\S]*?(?=\\n\\[(?:[^\\]\\n]+)\\]\\n|\\n## |$)', 'g');
    });
    function cleanStr(s) {
      if (typeof s !== 'string' || s.indexOf('## System Instructions') < 0) return s;
      let out = s;
      for (let i = 0; i < reList.length; i++) out = out.replace(reList[i], '');
      return out.replace(/\n{3,}/g, '\n\n').trim();
    }
    return (Array.isArray(messages) ? messages : []).map(function (m) {
      if (!m || !m.content) return m;
      if (typeof m.content === 'string') {
        const next = cleanStr(m.content);
        return next === m.content ? m : Object.assign({}, m, { content: next });
      }
      if (Array.isArray(m.content)) {
        let changed = false;
        const arr = m.content.map(function (p) {
          if (p && p.type === 'text' && typeof p.text === 'string') {
            const nt = cleanStr(p.text);
            if (nt !== p.text) { changed = true; return Object.assign({}, p, { text: nt }); }
          }
          return p;
        });
        return changed ? Object.assign({}, m, { content: arr }) : m;
      }
      return m;
    });
  }

  /* [位置:routes/chat.js·/internal/session-context 与 /internal/session-state] [跨客户端实时上下文与状态机更新接口] [提供给 MCP tools_server.py 按 session_id 实时拼装最新完整上下文（含人设/永久上下文/目录/状态机/对话与工具记录），以及查看或推进状态机新版本并立刻重建快照] [注释时间 2026-11-24] */
  app.get('/internal/session-context', async (req, reply) => {
    const sid = String((req.query && (req.query.session_id || req.query.session)) || '').trim();
    if (!sid) return reply.code(400).send({ ok: false, error: '缺少 session_id' });
    try {
      const _sv2 = require('../context/context-snapshot-v2');
      try { _sv2.markStale(baseDir, sid, 'session-context-fresh'); } catch (e) {}
      let llmMessages = buildConversation(sid, { noCache: true });
      if (typeof deps.resolveTimeTagToAi === 'function' && !deps.resolveTimeTagToAi(sid) && typeof deps.stripTimeTagsFromMessages === 'function') {
        deps.stripTimeTagsFromMessages(llmMessages);
      }
      if (typeof deps.readStripTraceToAi === 'function' && deps.readStripTraceToAi(sid) && typeof deps.stripTraceFromMessages === 'function') {
        deps.stripTraceFromMessages(llmMessages);
      }
      const v2Cfg = await fsp.readJson(path.join(baseDir, 'data', 'memory_v2_config.json')).catch(() => ({}));
      if (v2Cfg && v2Cfg.ctx_v2_enabled === true) {
        try {
          const r = await ctxV2Runtime.assembleAndApply({
            baseDir: baseDir,
            sessionId: sid,
            messages: llmMessages,
            loadTimeline: loadTimeline,
            normalizeContentToText: normalizeContentToText,
          });
          if (r && Array.isArray(r.messages)) llmMessages = r.messages;
        } catch (e) {
          console.warn('[internal/session-context] ctx-v2 组装失败，回退基础上下文:', e && e.message);
        }
      }
      llmMessages = stripPhoneOnlySystemBlocks(llmMessages);
      return reply.send({
        ok: true,
        session_id: sid,
        generated_at: new Date().toISOString(),
        message_count: llmMessages.length,
        messages: llmMessages,
      });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err && err.message) || String(err) });
    }
  });

  app.get('/internal/session-state', async (req, reply) => {
    const sid = String((req.query && (req.query.session_id || req.query.session)) || '').trim();
    if (!sid) return reply.code(400).send({ ok: false, error: '缺少 session_id' });
    try {
      contextReplacements.setActiveSession(sid);
      const cs = require('../lib/conversation-state');
      return reply.send(cs.getState(sid));
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err && err.message) || String(err) });
    } finally {
      contextReplacements.setActiveSession(null);
    }
  });

  app.post('/internal/session-state', async (req, reply) => {
    const body = req.body || {};
    const sid = String(body.session_id || body.session || (req.query && req.query.session_id) || '').trim();
    if (!sid) return reply.code(400).send({ ok: false, error: '缺少 session_id' });
    try {
      contextReplacements.setActiveSession(sid);
      const cs = require('../lib/conversation-state');
      const res = cs.updateStateDirect({
        session: sid,
        state: body.state,
        lu_add: body.lu_add,
        lu_insert: body.lu_insert,
        lu_update: body.lu_update,
      });
      if (!res || res.ok === false) return reply.code(400).send(res || { ok: false, error: '更新状态机失败' });
      let snapshotRebuilt = false;
      try {
        const _sv2 = require('../context/context-snapshot-v2');
        _sv2.deleteSnapshot(baseDir, sid);
        _sv2.clearStale(baseDir, sid);
        buildConversation(sid, { noCache: true });
        snapshotRebuilt = true;
      } catch (e) {
        console.warn('[internal/session-state] 自动重建快照失败:', e && e.message);
      }
      return reply.send(Object.assign({}, res, { snapshot_rebuilt: snapshotRebuilt }));
    } catch (err) {
      return reply.code(500).send({ ok: false, error: (err && err.message) || String(err) });
    } finally {
      contextReplacements.setActiveSession(null);
    }
  });

  // 1020（产品确定）：会话列表「名字下面的最新一句」——取最后一条真实对话（用户或 AI 都算），剥掉标签/思考/卡片，
  // 图片、语音、卡片给占位，只回前 40 字（前端按宽度省略）。跟 total/real 一起进 sessionMetaCache，文件不变不重算。
  function sessionLastText(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (!m || m.deleted || m.hidden || m.kind === 'diary' || m.kind === 'noaction' || !isRealMessageForTimeline(m)) continue;   // 2026-11-01：预览只取真实对话，静默原因不进「最新一句」
      let t = tagParser.stripForDisplay(normalizeContentToText(m.content) || '');   // 11-15：清洗链收进 lib/tag-parser.js·stripForDisplay，列表预览与搜索索引共用一份（此处行为与原来逐字一致）
      const hasImg = Array.isArray(m.content) && m.content.some(p => p && (p.type === 'image_url' || p.type === 'image'));
      if (!t && hasImg) t = '[图片]';
      if (!t) continue;
      return { last_text: t.slice(0, 40), last_role: m.role };
    }
    return { last_text: '', last_role: '' };
  }

  // 多会话列表：扫描本目录下所有 enhanced_messages*.json，返回会话摘要（命中缓存只 stat 不重读）
  app.get('/v1/sessions', async (req, reply) => {
    try {
      const _lookCfg = require('../lib/session-cfg').createSessionCfg(baseDir);   // 2026-10-27：会话头像 / 聊天主题随列表带回（存会话配置，不再只在手机本地）
      // 0929-30：一次性读人设映射+备份名+全局模型，循环内查表，避免每会话重复读文件
      let spMap = {};
      try { const _j = JSON.parse(fsp.readFileSync(path.join(baseDir, 'data', 'session-prompts.json'), 'utf-8')); if (_j && typeof _j === 'object') spMap = _j; } catch (e) { console.warn('[chat.js:228] optional read failed:', e.message || e); }
      let pbList = [];
      try { const _a = JSON.parse(fsp.readFileSync(path.join(baseDir, 'data', 'prompt-backups.json'), 'utf-8')); if (Array.isArray(_a)) pbList = _a; } catch (e) { console.warn('[chat.js:230] optional read failed:', e.message || e); }
      const pbNameOf = function (bid) { const h = pbList.find(b => b && b.id === bid); return (h && h.name) ? h.name : ''; };
      let globalModel = '';
      try { globalModel = readEnvValue ? (readEnvValue('MODEL_NAME') || 'gateway-model') : 'gateway-model'; } catch (e) { globalModel = 'gateway-model'; }
      const files = fsp.readdirSync(TL_DIR).filter(f => /^enhanced_messages[_-][A-Za-z0-9_-]+\.json$/.test(f));
      const sessions = [];
      const seen = new Set();
      const archiveSet = new Set((typeof readSessionArchive === "function" ? readSessionArchive() : []));
      // 11-10：分支父子关系整表只读一次（不塞进 sessionMetaCache——缓存的是时间线 meta，别混进请求级字段）
      let branchMap = {};
      try { branchMap = require('../lib/session-branches').read(baseDir) || {}; } catch (e) { console.warn('[chat.js:413] branch map read failed:', e.message || e); }
      for (const f of files) {
        const sid = f.replace(/^enhanced_messages_/, '').replace(/\.json$/, '');
        if (!sid) continue;
        seen.add(sid);
        try {
          const filePath = path.join(TL_DIR, f);
          const st = fsp.statSync(filePath);
          const cached = sessionMetaCache.get(sid);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
            let cPersona = '', cModel = '';
            const cBid = spMap[sid]; if (cBid) cPersona = pbNameOf(cBid);
            try { cModel = (deps.sessionModelNameOverride ? (deps.sessionModelNameOverride(sid) || '') : ''); } catch (e) { cModel = ''; }  // 0929-30: 无 override 返回空，前端显示「默认」
            /* [位置:routes/chat.js·/v1/sessions 读会话外观] [一次读到位] [11-14 审查 C 批 d：同一行里 readLook(sid) 调了两次（头像 + 聊天样式），每个会话多一次 statSync；354 个会话就是多 354 次。readLook 内部有 mtime 缓存，重复调博不了多少但没必要] [注释时间 2026-11-14] */
            const _lk = _lookCfg.readLook(sid);
            sessions.push({ id: sid, name: sid, total: cached.total, real: cached.real, last_time: cached.last_time, created: cached.created || '', created_iso: cached.created_iso || '', is_default: false, archived: archiveSet.has(sid), persona_name: cPersona, model_name: cModel, avatar: _lk.avatar, chat_style: _lk.style, last_text: cached.last_text || '', last_role: cached.last_role || '' });
            continue;
          }
          const arr = loadTimeline(sid);
          // kind=diary 是隐藏日记消息（前端不显示），不计入「真实消息」数（2026-09-15）
          const real = arr.filter(m => isRealMessageForTimeline(m) && m.kind !== 'diary');
          /* [位置:chat.js·/v1/sessions created] [会话创建时间 = 时间线里第一条有时间的非 system 消息的时间，上海时区 YYYY-MM-DD HH:MM] [小手机会话列表左拉详情的「创建」；随 meta 缓存，不多读文件] [注释时间 2026-10-22] */
          const _first = arr.find(m => m && m.role !== 'system' && m.time && !isNaN(new Date(m.time).getTime()));
          /* [位置:chat.js·/v1/sessions created_iso] [空会话（建了还没发消息）的创建时间兜底] [11-13：空会话没有消息就取不到「第一条消息时间」，行上「创建」显示 —、排序会沉到最底；这里用文件创建时间（birthtime，取不到退 ctime/mtime）兜底：created 仍是本地展示格式给左拉详情，created_iso 单独给前端排序——两种格式不能混着比大小（'2026-11-14 00:13' 里的空格比 ISO 的 T 小，同一天会排错）] [注释时间 2026-11-14] */
          const _bornMs = arr.length === 0 ? (st.birthtimeMs || st.ctimeMs || st.mtimeMs || 0) : 0;
          const _createdAt = _first ? new Date(_first.time) : (_bornMs ? new Date(_bornMs) : null);
          const created = _createdAt ? _createdAt.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16) : '';
          const created_iso = _createdAt ? _createdAt.toISOString() : '';
          const meta = { mtimeMs: st.mtimeMs, size: st.size, total: arr.length, real: real.length, last_time: (arr[arr.length - 1] && arr[arr.length - 1].time) || null, created, created_iso, ...sessionLastText(arr) };
          sessionMetaCache.set(sid, meta);
          let persona = '', modelN = '';
          const bid = spMap[sid]; if (bid) persona = pbNameOf(bid);
          try { modelN = (deps.sessionModelNameOverride ? (deps.sessionModelNameOverride(sid) || '') : ''); } catch (e) { modelN = ''; }  // 0929-30: 无 override 返回空，前端显示「默认」
          const _lk2 = _lookCfg.readLook(sid);   /* 11-14：头像与聊天样式一次读完，不再同一行调两个 readLook */
          sessions.push({ id: sid, name: sid, total: meta.total, real: meta.real, last_time: meta.last_time, created: meta.created, created_iso: meta.created_iso, is_default: false, archived: archiveSet.has(sid), persona_name: persona, model_name: modelN, avatar: _lk2.avatar, chat_style: _lk2.style, last_text: meta.last_text, last_role: meta.last_role });
        } catch (e) { console.error('[chat.js:262]', e.message || e); }
      }
      // 清理已删除会话的缓存项，避免陈旧
      for (const k of Array.from(sessionMetaCache.keys())) {
        if (!seen.has(k)) sessionMetaCache.delete(k);
      }
      // 11-10：分支出处统一补在 push 之后（缓存命中的分支也走到这里），没登记的不加字段
      for (const s of sessions) {
        const b = branchMap[s.id];
        if (!b || !b.fromSession) continue;
        s.branch_from = {
          id: String(b.fromSession),
          anchor_id: b.anchorId ? String(b.anchorId) : null,
          created_at: b.createdAt ? String(b.createdAt) : null,
        };
      }
      reply.send({ ok: true, sessions });
    } catch (err) {
      console.error('[GET /v1/sessions] error:', err.message);
      fail500(reply, err);
    }
  });

  // 快照过期状态按需检查：会话列表首屏只返回轻量元数据，不逐个重组上下文块。
  // 前端打开单个会话菜单时才调用本接口，避免 N 个会话的快照核验拖慢列表响应。
  app.get('/v1/sessions/:id/snapshot-stale', async (req, reply) => {
    try {
      const sid = String(req.params.id || '').trim();
      if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) {
        return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      }
      const filePath = (typeof timelineFileFor === 'function')
        ? timelineFileFor(sid)
        : path.join(TL_DIR, `enhanced_messages_${sid}.json`);
      if (!fsp.existsSync(filePath)) {
        return reply.code(404).send({ error: '会话不存在', code: 'session_not_found' });
      }
      let result = { stale: false, reasons: [] };
      if (typeof deps.snapshotStaleOf === 'function') {
        try { result = (await deps.snapshotStaleOf(sid)) || result; } catch (e) { /* client/stream cleanup */ }
      }
      return reply.send({
        ok: true,
        session_id: sid,
        snap_stale: !!result.stale,
        snap_stale_reasons: Array.isArray(result.reasons) ? result.reasons : []
      });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/snapshot-stale] error:', err.message);
      return fail500(reply, err);
    }
  });

  // 快照过期批量核验：会话列表头像角标用（10-25：角标纯展示不可点，重建仍走长按菜单的单会话流程）。
  // 并发全量核验（100 会话实测 ~0.3s），30 秒内存缓存防连点；default 与菜单红点口径一致不参与（菜单从来不查主会话）。
  let _snapStaleAllAt = 0, _snapStaleAllMap = null;
  app.get('/v1/sessions/snapshot-stale-all', async (req, reply) => {
    try {
      if (typeof deps.snapshotStaleOf !== 'function') {
        return reply.code(501).send({ error: '当前网关版本不支持批量核验', code: 'not_implemented' });
      }
      const now = Date.now();
      if (_snapStaleAllMap && now - _snapStaleAllAt < 30000) {
        return reply.send({ ok: true, stale: _snapStaleAllMap, cached: true });
      }
      let ids = [];
      try {
        ids = fsp.readdirSync(TL_DIR)
          .filter(f => /^enhanced_messages[_-][A-Za-z0-9_-]+\.json$/.test(f))
          .map(f => f.replace(/^enhanced_messages_/, '').replace(/\.json$/, ''))
          .filter(id => id && id !== 'default');
      } catch (e) { ids = []; }
      const pairs = await Promise.all(ids.map(async (sid) => {
        try {
          const r = await deps.snapshotStaleOf(sid);
          return [sid, (r && r.stale && Array.isArray(r.reasons) && r.reasons.length) ? r.reasons : null];
        } catch (e) { return [sid, null]; }
      }));
      const map = {};
      for (const [sid, reasons] of pairs) { if (reasons) map[sid] = reasons; }
      _snapStaleAllAt = now; _snapStaleAllMap = map;
      return reply.send({ ok: true, stale: map });
    } catch (err) {
      console.error('[GET /v1/sessions/snapshot-stale-all] error:', err.message);
      return fail500(reply, err);
    }
  });

  // 删除会话：删除与会话ID对应的独立时间线文件。主会话(default)不允许删除。
  app.delete('/v1/sessions/:id', async (req, reply) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = id.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== id) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const file = timelineFileFor(safe);
      if (!fsp.existsSync(file)) {
        /* [位置:routes/chat.js·DELETE 会话·no-file] [时间线已经不在时也把会话配置清掉] [2026-11-14：「清吧清吧」——3f 后发现墓碑期内迟到的 cross-inject 会为已删会话写下 data/session_cfg/<id>.json，而这里原来直接 return，cfg 永远清不掉（列表里也看不到，属于隐形残件）] [注释时间 2026-11-14] */
        try { const _cfg = path.join(baseDir, 'data', 'session_cfg', safe + '.json'); if (fsp.existsSync(_cfg)) fsp.removeSync(_cfg); } catch (e) { console.warn('[chat.js] 清会话配置失败:', e.message || e); }
        return reply.send({ ok: true, deleted: false, note: 'no-file' });
      }
      const bakDir = path.join(baseDir, 'backups');
      if (fsp.existsSync(bakDir)) {
        const bak = path.join(bakDir, path.basename(file) + '.deleted-' + new Date().toISOString().replace(/[:.]/g, '-'));
        fsp.copySync(file, bak);
      }
      // 删除墓碑（2026-09-20 审查 F-3）。2026-09-22 审查 M10：必须**先立墓碑、再删文件**——
      // 原顺序是「removeSync → 清理周边 → 最后才写墓碑」，中间的窗口里迟到的写入
      // （生成中回复收尾/唤醒事件等）因「文件不存在且无墓碑」被 saveTimeline 放行，
      // 已删会话会以「空时间线+新消息」的残骸文件复活。墓碑守卫条件是「文件不存在 + 墓碑期内」，
      // 故先立墓碑即关闭该窗口。记录删除时刻，24h 内迟到写入被拒；过期自动失效，同 id 重建不受影响。
      try { if (typeof markSessionDeleted === 'function') markSessionDeleted(safe); } catch (e) { console.warn('[chat.js:324] cleanup failed:', e.message); }
      fsp.removeSync(file);
      // 2026-09-13 审查修复：同步清理会话周边文件——此前只删时间线，跨窗口快照/会话配置/
      // 唤醒锁定槽位永久残留，同 id 重建会话会继承旧快照固化的 created_at 导致日记注入边界漂移
      const cleanupTargets = [
        path.join(baseDir, 'cross_snapshot_' + safe + '.json'),
        path.join(baseDir, 'data', 'session_cfg', safe + '.json')
      ];
      let cleaned = 0;
      for (const t of cleanupTargets) {
        try { if (fsp.existsSync(t)) { fsp.removeSync(t); cleaned++; } } catch (e) { console.warn('[chat.js:334] cleanup failed:', e.message); }
      }
      try {
        const wakeLockedPath = path.join(baseDir, 'data', 'wake-locked.json');
        if (fsp.existsSync(wakeLockedPath)) {
          const locked = fsp.readJsonSync(wakeLockedPath);
          if (Array.isArray(locked) && locked.includes(safe)) {
            fsp.writeJsonSync(wakeLockedPath, locked.filter(s => s !== safe));
            cleaned++;
          }
        }
      } catch (e) { console.error('[chat.js:345]', e.message || e); }
      try {   // 2026-11-10 事件唤醒名单（睡眠唤醒已并入这份）也要清，免得同 id 重建会话继承
        const evPath = path.join(baseDir, 'data', 'wake-event-sessions.json');
        if (fsp.existsSync(evPath)) {
          const evs = fsp.readJsonSync(evPath);
          if (Array.isArray(evs) && evs.includes(safe)) { fsp.writeJsonSync(evPath, evs.filter(s => s !== safe)); cleaned++; }
        }
      } catch (e) { console.error('[chat.js] 清事件唤醒名单失败', e.message || e); }
      /* [位置:chat.js·DELETE 会话·清守护副本] [删会话时把 timeline_guard 的自动备份一起清] [2026-11-14 查 3f 时发现：saveTimeline 每写一次都往 data/timeline_guard 存守护副本，而删除只清了 cross_snapshot / session_cfg；watchdog 只在 24h 墓碑期内跳过恢复，墓碑过期后会把已删会话从副本整份恢复回来。这里连主副本带轮转 .1/.2/.3 一起删，主动删除才真的删干净] [注释时间 2026-11-14] */
      try {
        const gDir = path.join(baseDir, 'data', 'timeline_guard');
        const gBase = path.basename(file);
        if (fsp.existsSync(gDir)) {
          for (const g of fsp.readdirSync(gDir)) {
            if (g === gBase || g.indexOf(gBase + '.') === 0) {
              try { fsp.removeSync(path.join(gDir, g)); cleaned++; } catch (e) { console.warn('[chat.js] 清守护副本失败:', e.message || e); }
            }
          }
        }
      } catch (e) { console.warn('[chat.js] 清守护副本失败:', e.message || e); }
      // 1010-30 阶段4a：v2 快照与失效标记一并清（防同 id 重建继承旧前缀缓存；v1 注入快照已退役）
      try {
        const sv2 = require('../context/context-snapshot-v2');
        if (sv2.deleteSnapshot(baseDir, safe)) cleaned++;
        sv2.clearStale(baseDir, safe);
        if (frozenBlocks.remove(baseDir, safe)) cleaned++;   // 1018：固定块登记随会话删除
      } catch (e) { console.error('[chat.js:351]', e.message || e); }
      try { if (timelineVersions.dropSession(baseDir, safe)) cleaned++; } catch (e) { console.warn('[chat.js] 删会话清版本存档失败:', e.message || e); }   // 2026-11-10 版本存档随会话删除
      // 2026-11-10 它自己作为分支的登记一并删；以它为父的子分支会话保持独立（不连带删），列表里显示「原会话已删除」
      try { if (require('../lib/session-branches').removeChild(baseDir, safe)) cleaned++; } catch (e) { console.warn('[chat.js] 删会话清分支登记失败:', e.message || e); }
      console.log(`[sessions] 会话 ${safe} 已删除，周边文件清理 ${cleaned} 处`);
      reply.send({ ok: true, deleted: true, cleaned });
    } catch (err) {
      console.error('[DELETE /v1/sessions/:id] error:', err.message);
      fail500(reply, err);
    }
  });

  // 只读返回时间线（供自建聊天前端拉取历史；剥离内部 position 字段，保留 role/content/time）。
  // 2026-09-29 前端"纯显示器"分页：
  //   GET /v1/history?session_id=X                     → 全量（旧客户端/导出兼容）
  //   GET /v1/history?session_id=X&mode=tail[&limit=N] → 尾部窗口：从"最后一块摘要结尾"起（未压缩原文），
  //                                                      响应带 tail_start_id（前端渲染起点，稳定；新压缩块
  //                                                      出现时联动变化）+ has_more（起点前还有更早原文）
  //   GET /v1/history?session_id=X&before=<id>&limit=N → 更早窗口：before 为当前窗口最早消息 id，
  //                                                      返回其前 N 条原文（含压缩区间原文）
  // 1004-05：进行中生成快照查询——前端断流/切回前台后轮询这里续显，不用刷新
  app.post('/v1/chat/stop', async (req, reply) => {
    try {
      if ((req.headers['x-client'] || '').trim() !== 'dylan-chat') return reply.code(403).send({ error: 'forbidden', code: 'forbidden' });
      const body = req.body || {};
      const sessionId = normSid(body.session_id);
      const replyMsgId = String(body.reply_msg_id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: 'session_id required', code: 'session_id_required' });
      const activeKey = replyMsgId ? sessionId + "\u0000" + replyMsgId : null;
      let active = activeKey ? activeChatRequests.get(activeKey) : null;
      // 1025：停止只认会话——复合键查不到（前端丢了 reply_msg_id，如生成中退出重进）时按会话兜底：
      // 找该会话最新登记的活跃请求。一会话同时只有一个生成（发送守卫/幂等锁/唤醒闸门三处保证），
      // 会话 id 足以唯一定位；前端不再需要攥着 reply_msg_id 才能停。带 rid 的旧调用走精确匹配不受影响。
      if (!active || (replyMsgId && active.replyMsgId !== replyMsgId) || active.controller.signal.aborted) {
        active = null;
        for (const [k, v] of activeChatRequests) {
          if (v && !v.controller.signal.aborted && String(k).split("\u0000")[0] === sessionId) active = v;   // Map 保持插入序，取最新一条
        }
        if (!active) return reply.send({ ok: true, stopped: false });
      }
      active.cancelled = true;
      active.controller.abort();
      console.warn('[chat] 收到用户停止请求 (session=' + sessionId + ', reply=' + String(active.replyMsgId || '-').slice(0, 8) + (replyMsgId ? '' : ', 按会话兜底') + ')');
      if (active.finished) {
        let timeoutId;
        await Promise.race([active.finished, new Promise(resolve => { timeoutId = setTimeout(resolve, 4000); })]);
        if (timeoutId) clearTimeout(timeoutId);
      }
      return reply.send({ ok: true, stopped: true });
    } catch (e) {
      return fail500(reply, e);
    }
  });

  app.get('/v1/chat/status', async (req, reply) => {
    try {
      if ((req.headers['x-client'] || '').trim() !== 'dylan-chat') return reply.code(403).send({ error: 'forbidden', code: 'forbidden' });
      const sessionId = normSid(req.query.session_id);
      if (!sessionId) return reply.send({ active: false, done: true, phase: "idle" });
      const ag = activeGenMap.get(sessionId);
      if (!ag) return reply.send({ active: false, done: true, phase: "idle" });
      if (ag.done && Date.now() - ag.ts > ACTIVE_GEN_TTL_MS) { activeGenMap.delete(sessionId); return reply.send({ active: false, done: true, phase: "idle" }); }
      // 1021：显式阶段，客户端不必再从 text/reasoning/tools 反推。只给枚举，中文措辞交给客户端。
      // 枚举：idle（无快照）/ waiting（等上游首字）/ reasoning（只有思考流）/ writing（有正文）/ tool（有工具在跑）/ done / aborted / failed（上游报错）
      // done 与 aborted 在读时按 done 标记推导，不依赖各条收尾路径回写，避免漏改造成阶段卡死。
      const _phase = ag.done ? (ag.error ? "failed" : ag.aborted ? "aborted" : "done") : (ag.phase || "waiting");
      const _running = (ag.tools || []).filter(function (t) { return t && t.status === "running"; });
      const _startedAt = ag.startedAt || ag.ts;
      // 1025：快照里按到达顺序的 parts（思考/正文/工具交错，1024-02 起 server.js onEvent 在记）——
      // 生成中退出重进的前端靠它还原实时排版；此前只给平铺 text/reasoning/tools，前端只能兜底成
      // 「思考整段在前、工具一排、正文垫底」。工具节点只留 id/name/status（args/result 在 tools 里
      // 已全量给，不在 1.5 秒一轮的轮询响应里翻倍）；text/reasoning 带内容（分段边界只有这里有）。
      const _parts = Array.isArray(ag.parts) ? ag.parts.map(function (p) {
        if (!p || !p.type) return null;
        if (p.type === "tool") { const _t = p.tool || {}; return { type: "tool", id: _t.id, name: _t.name, status: _t.status, ts: p.ts }; }   // 2026-11-18：带 ts（节点时刻）——重进续显时极简主题思考行也算得出耗时
        return { type: p.type, text: p.text || "", ts: p.ts };
      }).filter(Boolean) : [];
      /* [位置:routes/chat.js·/v1/chat/status lite] [续显轮询瘦身] [2026-10-29 性能批：生成中前端每 1.5~2s 轮询一次全量快照（实测平均 86KB、最大 242KB，两个会话并行约 5.4MB/分钟）。lite=1 只回阶段/长度/运行中工具（约 1KB），正文/思考/工具靠 SSE 增量；首帧与断流恢复仍用全量。不传 lite 的老前端行为完全不变] */
      const _lite = String(req.query.lite || "") === "1" && String(req.query.full || "") !== "1";
      if (_lite) return reply.send({ lite: 1, active: !ag.done, done: ag.done, aborted: !!ag.aborted, phase: _phase, phase_at: ag.phaseAt || ag.ts, tool: (_running[0] && _running[0].name) || "", running_tools: _running.map(function (t) { return t && t.name; }).filter(Boolean), elapsed_ms: Math.max(0, Date.now() - _startedAt), error: ag.error || "", text_len: (ag.text || "").length, reasoning_len: (ag.reasoning || "").length, tools_count: (ag.tools || []).length, ts: ag.ts, started_at: _startedAt, persisted: !!ag.persisted, reply_msg_id: ag.replyMsgId || "" });
      return reply.send({ active: !ag.done, done: ag.done, aborted: !!ag.aborted, phase: _phase, phase_at: ag.phaseAt || ag.ts, tool: (_running[0] && _running[0].name) || "", running_tools: _running.map(function (t) { return t && t.name; }).filter(Boolean), elapsed_ms: Math.max(0, Date.now() - _startedAt), error: ag.error || "", text: ag.text || "", reasoning: ag.reasoning || "", tools: ag.tools || [], parts: _parts, ts: ag.ts, started_at: _startedAt, persisted: !!ag.persisted, reply_msg_id: ag.replyMsgId || "" });
    } catch (e) {
      /* [位置:routes/chat.js·/v1/chat/status catch] [异常不再伪装空闲] [11-13 审查：原来任何异常都回 active:false/done:true/phase:idle，前端会把发送键从「停止」切回「发送」，用户以为他没在回而重复发消息；现在回 500 + code，前端保持现状并重试，异常原文只进服务端日志] [注释时间 2026-11-13] */
      console.error('[chat.js:status]', e && e.message || e);
      return fail(reply, 500, 'status_unavailable', '查不到聊天状态，稍后再试');
    }
  });

  // 1021：客户端可见性上报（页面 visibilitychange 时发一次）。
  // 不改 SSE，实时能力不变；只让服务端知道「她是不是真的在看这个会话」。
  app.post('/v1/client-state', async (req, reply) => {
    try {
      if ((req.headers['x-client'] || '').trim() !== 'dylan-chat') return reply.code(403).send({ error: 'forbidden', code: 'forbidden' });
      const sessionId = normSid((req.body && req.body.session_id) || '');
      if (!sessionId) return reply.code(400).send({ error: 'session_id required', code: 'session_id_required' });
      setClientVisible(sessionId, !!(req.body && req.body.visible));
      return reply.send({ ok: true, watching: isClientWatching(sessionId) });
    } catch (e) { return fail500(reply, e); }
  });

  app.get('/v1/history', async (req, reply) => {
    try {
      const sessionId = normSid(req.query.session_id || req.headers['x-session-id']);
      const timeline = loadTimeline(sessionId);
      // 稳定 id 迁移：老数据无 id，首次被 history 读到就补 uuid 并写回（前端据此做 diff 编辑/删除）。
      let needWrite = false;
      for (const m of timeline) { if (m && !m.id) { m.id = (require('crypto').randomUUID) ? require('crypto').randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2); needWrite = true; } }
      if (needWrite) saveTimeline(timeline, sessionId);
      /* [位置:routes/chat.js·wake 断组标记] [唤醒轮另起一组] [2026-10-31：气泡样式每组上面一行头像，唤醒后 AI 主动说的话原来跟上一轮他的消息连成一组、没有头像；
         时间线里 [唤醒] 块（role=developer）之后、直到用户回复之前的 assistant 消息都算同一轮，下发时打 wake 标，前端据此另起一组；
         读取时顺着 timeline 推断，不落盘、老会话零迁移，历史里的唤醒轮刷新后同样断开] [注释时间 2026-10-31] */
      const wakeIds = new Set();
      { let aw = false;
        for (const m of timeline) {
          if (!m || m.deleted) continue;
          if (m.role === 'developer') aw = true;
          else if (m.role === 'user') aw = false;
          else if (m.role === 'assistant' && aw && m.id) wakeIds.add(m.id);
        }
      }
      const fullItems = timeline
        .filter(m => isRealMessageForTimeline(m) || (m && !m.deleted && isPushEchoLike(m)))
        // role 法（2026-09-15）：developer 块（[唤醒]等）与日记（kind=diary）只落盘不对前端展示；
        // 2026-11-01 用户需求：noaction 静默原因放行到消息流（手机端虚线气泡显示），kind 随下方 clean 下发
        .filter(m => !(m && (m.role === 'developer' || m.role === 'tool' || m.kind === 'diary')))
        .map(m => {
          const clean = { role: m.role };
          if (m.id !== undefined) clean.id = m.id;
          if (m.content !== undefined) clean.content = m.content;
          if (m.time) clean.time = m.time;
          if (m.reasoning !== undefined) clean.reasoning = m.reasoning;
          if (m.tools !== undefined) clean.tools = m.tools;
          if (m.segments !== undefined) clean.segments = m.segments;
          // 2026-09-24 B3 探针发现：9-23 落盘加了 stream_timeline，但本接口白名单漏同步——
          // 前端刷新后一直收不到服务端这份真实时间线（靠 localStorage 自存补回）。补上。
          if (m.stream_timeline !== undefined) clean.stream_timeline = m.stream_timeline;
          if (m.tokens !== undefined) clean.tokens = m.tokens;
          if (m.trace !== undefined && m.role === 'assistant') clean.trace = m.trace;   // 11-04 此刻 <trace>：只下发气味名等（lock 的消息只有 {locked:true}，原文不在时间线里）
          if (m.kind !== undefined) clean.kind = m.kind;   // 2026-11-01：noaction 判定随消息下发（前端免二次解析正文）
          if (wakeIds.has(m.id)) clean.wake = 1;
          return clean;
        });
      /* [位置:routes/chat.js·/v1/history after] [增量拉取] [2026-10-29 性能批：SSE history_update 后前端原来整份重拉 tail（实测平均 202KB、最大 921KB）。after=<最后一条可见消息 id> 只回其后新增；无新增回 unchanged:true。after 在盘上找不到（上下文压缩/重建）回 fallback:true + 全量，前端退回整份渲染] */
      const afterId = req.query.after !== undefined ? String(req.query.after || '').trim() : '';
      if (afterId) {
        const pos = fullItems.findIndex(function (m) { return m && m.id === afterId; });
        if (pos < 0) return reply.send({ ok: true, fallback: true, total: fullItems.length, items: fullItems, session_id: sessionId || 'default' });
        const win = fullItems.slice(pos + 1);
        return reply.send({ ok: true, total: fullItems.length, unchanged: win.length === 0, items: win, session_id: sessionId || 'default' });
      }
      const mode = String(req.query.mode || '');
      if (mode === 'tail' || req.query.before !== undefined) {
        const limit = req.query.limit !== undefined ? Math.min(Math.max(1, Number(req.query.limit) || 1), 500) : null;
        const cs = contextReplacements.computeTailStart(sessionId, timeline);
        // 渲染起点 = tailIndex 起第一条可见消息的 id（tailIndex 可能指向 developer/tool 等被过滤消息，向后找）
        let tailId = null;
        if (cs.tailIndex < timeline.length) {
          const visibleIds = new Set();
          for (const m of fullItems) { if (m && m.id) visibleIds.add(m.id); }
          for (let i = cs.tailIndex; i < timeline.length; i++) {
            const m = timeline[i];
            if (m && m.id && visibleIds.has(m.id)) { tailId = m.id; break; }
          }
        }
        if (req.query.before !== undefined) {
          // 更早窗口：before 消息之前的 limit 条
          const beforeId = String(req.query.before || '');
          const pos = fullItems.findIndex(m => m && m.id === beforeId);
          const lim = limit || 100;
          if (pos < 0) {
            return reply.send({ ok: true, total: fullItems.length, tail_start_id: tailId, has_more: false, items: [], session_id: sessionId || 'default' });
          }
          const start = Math.max(0, pos - lim);
          const win = fullItems.slice(start, pos);
          return reply.send({ ok: true, total: fullItems.length, tail_start_id: tailId, has_more: start > 0, items: win, session_id: sessionId || 'default' });
        }
        // mode=tail：从起点返回（limit 缺省 → 起点后全部，供 SSE 整段替换）
        const startIdx = tailId ? fullItems.findIndex(m => m && m.id === tailId) : fullItems.length;
        if (startIdx < 0) {
          return reply.send({ ok: true, total: fullItems.length, tail_start_id: tailId, has_more: false, items: [], session_id: sessionId || 'default' });
        }
        // 1021：last=N 只回尾部窗口的最后 N 条（小手机打开会话用，不再整段下发）；has_more 表示前面还有
        const last = req.query.last !== undefined ? Math.min(Math.max(1, Number(req.query.last) || 1), 500) : null;
        if (last && !limit && startIdx < fullItems.length) {
          const from = Math.max(startIdx, fullItems.length - last);
          return reply.send({ ok: true, total: fullItems.length, tail_start_id: tailId, has_more: from > 0, items: fullItems.slice(from), session_id: sessionId || 'default' });
        }
        const win = limit ? fullItems.slice(startIdx, startIdx + limit) : fullItems.slice(startIdx);
        if (!win.length && startIdx >= fullItems.length) {
          // 2026-09-29：会话全部被压缩（无未压缩尾部原文）→ 从压缩块尾部起始点回退固定拉最后 limit 条原文，
          // 前端点进去至少有最近 100 条可见；tail_start_id 设为这批第一条，向上翻页继续拉更早。
          const back = Math.max(0, fullItems.length - (limit || last || 100));
          const winBack = fullItems.slice(back);
          return reply.send({ ok: true, total: fullItems.length, tail_start_id: winBack.length ? winBack[0].id : null, has_more: back > 0, items: winBack, session_id: sessionId || 'default' });
        }
        return reply.send({ ok: true, total: fullItems.length, tail_start_id: tailId, has_more: startIdx > 0, items: win, session_id: sessionId || 'default' });
      }
      reply.send({ ok: true, total: fullItems.length, items: fullItems, session_id: sessionId || 'default' });
    } catch (err) {
      console.error('[GET /v1/history] error:', err.message);
      fail500(reply, err);
    }
  });
  // 跨会话全量搜索：扫描所有会话时间线，混合模式 = 语义分（TF-IDF+bigram 余弦）与关键词命中分五五开合成排序。
  // 语义索引只存两字 bigram，单字/纯符号查询在语义侧必为 0 分，靠关键词腿保底（2026-09-13，替代原 semantic|keyword 二选一）。
  // 2026-10-21 四修：①关键词腿按命中次数分级替代二值（单字查询不再全员并列 0.5 分塌方成文件扫描序）；②同分按消息时间倒序；
  // ③sid 去重（legacy 主文件与 default 新文件二选一）+ ≥20 字相同文本内容去重（分支/继承副本无标记）；
  // ④已归档会话不参与搜索（归档状态并入指纹缓存键，取消归档自动恢复可搜）。
  /* [位置:routes/chat.js·/v1/search 与 /internal/search] [AI 的 context 工具直接用小手机搜索这一套] [10-24 需求 29：同一个处理函数挂两个路径（/v1/search 给手机，/internal/search 给工具，鉴权不同）；新增两个可选参数——sid=只搜这一个会话（现建小索引，不做跨会话内容去重，所以分支继承来的同文也搜得到）、with_id=1 结果里带 msg_id 和 role（标星要用）；不传这两个参数时和以前完全一样。2026-11-09 再加 sids=（逗号分隔多个会话 id）：小手机会话组内搜索，与 sid= 同口径逐个现建小索引，不受归档/子会话/「不参与检索」限制（人工口径，给什么搜什么），上限 100 个会话；不传时行为不变] [注释时间 2026-10-24，2026-11-09 补 sids] */
  const searchHandler = async (req, reply) => {
    try {
      const q = String(req.query.q || '').trim();
      /* [位置:routes/chat.js·searchHandler limit] [上下限都夹紧] [11-14 审查 B 批 c：原来只有上限 500——传 -1 得到 -1，后面 slice(0,-1) 会吐出除最后一条外的全部命中，封顶形同虚设；传 0 被 ||200 吞成 200。现在照 /v1/history 的写法双向夹紧（1~500），非法值回默认 200] [注释时间 2026-11-14] */
      const _limRaw = Number(req.query.limit);
      const limit = Number.isFinite(_limRaw) && _limRaw > 0 ? Math.min(Math.floor(_limRaw), 500) : 200;
      if (!q) return reply.send({ ok: true, mode: 'hybrid', total: 0, results: [] });
      const isAi = String(req.url || '').indexOf('/internal/') === 0;   // 第11项：AI 的检索要排除「不参与检索」组
      const C = isAi ? searchIndexCacheAi : searchIndexCache;
      const excl = isAi ? require('../lib/search-exclude') : null;
      const onlySid = String(req.query.sid || '').replace(/[^A-Za-z0-9_-]/g, '');
      /* [位置:routes/chat.js·/v1/search sids] [多会话范围搜索] [11-09：小手机会话组内搜索——组菜单「搜索」把组员 id 清单（逗号分隔）传进来，只搜这些会话；与 sid= 同口径现建小索引（不跨会话去重），不受归档/子会话/「不参与检索」限制（人工搜索口径，给什么搜什么）；上限 100 个会话防极端请求；不传时行为不变，AI 的 /internal/search 不受影响] [注释时间 2026-11-09] */
      const onlySids = String(req.query.sids || '').split(',').map(s => String(s).replace(/[^A-Za-z0-9_-]/g, '')).filter(Boolean).slice(0, 100);
      const withId = String(req.query.with_id || '') === '1';
      /* [位置:routes/chat.js·searchHandler 新参数] [snip / exclude_sid / exclude_recent_min] [11-09 检索质量批：①snip=1 网关直接按「多关键词最优窗口」（lib/keyword-window.js）算好 snippet 返回、不再回整条 text（AI 的 context 工具与手机搜索共用，算法只有一份）；②exclude_sid + exclude_recent_min：排除某会话最近 N 分钟的消息（AI 的 context 工具传当前会话+60，上下文里已有那一小时的内容）——不能复用 sid=（sid 是「只搜这一个会话」），scope=all 时也要能排当前会话；被排除的条数在 excluded_recent 里返回；不传则行为完全不变（手机端不受影响）] [注释时间 2026-11-09] */
      const kw = require('../lib/keyword-window');
      const wantSnip = String(req.query.snip || '') === '1';
      const exclSid = String(req.query.exclude_sid || '').replace(/[^A-Za-z0-9_-]/g, '');
      const exclMinRaw = Number(req.query.exclude_recent_min);
      const exclCutoff = (exclSid && Number.isFinite(exclMinRaw) && exclMinRaw > 0) ? Date.now() - Math.min(exclMinRaw, 1440) * 60000 : 0;
      /* [位置:routes/chat.js·searchHandler time_prefix] [只留消息时间（东八区）以这个前缀开头的命中] [11-09 后台检索切到这一套：状态机的检索请求带「time」时是「按关键词搜、再按时间段过滤」，老检索（context-replacements）里有这一步，切过来后在这里做；格式同老逻辑——T 当空格，如 2026-09-28 或 2026-09-28 21；没有时间的消息不算命中。手机和 AI 的 context 工具不传，行为不变] [注释时间 2026-11-09] */
      const timePrefix = String(req.query.time_prefix || '').trim().replace(/[Tt]/g, ' ');
      const localTime = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      const files = fsp.readdirSync(TL_DIR).filter(f => f === 'enhanced_messages.json' || /^enhanced_messages[_-][A-Za-z0-9_-]+\.json$/.test(f));
      // 指纹缓存：任一时间线文件变化（mtime/size/增删）才重建 items，否则直接复用
      let fp = '';
      try {
        fp = files.map(f => {
          const st = fsp.statSync(path.join(TL_DIR, f));
          return f + ':' + st.mtimeMs + ':' + st.size;
        }).join('|');
      } catch (e) { fp = String(Date.now()); } // stat 失败则本次放弃缓存命中
      // 2026-10-21 归档过滤：归档状态存 data/session-archive.json（归档/取消归档不改时间线文件），
      // 必须并入指纹，否则归档变了 items 缓存还是旧集合。
      try {
        const ast = fsp.statSync(path.join(baseDir, 'data', 'session-archive.json'));
        fp += '|arch:' + ast.mtimeMs + ':' + ast.size;
      } catch (e) { fp += '|arch:none'; }
      if (excl) fp += '|ex:' + excl.signature();
      let items = [];
      /* ===== 10-29 #42/#45：检索条目缓存=====
         原版时间线一有变化就重读全部会话文件重新收集+去重（新消息后首搜慢的大头）。
         现在 raw（每个会话的可搜原始条目，未跨会话去重）按 per-file 指纹增量收集，并持久化到
         data/cache/search-cache-<kind>.json（冷启动免全量收集）。结果口径与原版完全一致：
         归档/子会话/「不参与检索」组仍在合并阶段过滤（它们的副本不参与同文去重、不挤掉可搜条目），
         ≥20 字相同文本仍只保留时间最新的一条；TF-IDF 语义索引仍按指纹同步重建（结果严格一致）。 */
      const kind = isAi ? 'ai' : 'phone';
      if (C.fp === fp && C.items) {
        items = C.items;
      } else {
        // 2026-10-21 已归档会话不参与搜索（与主列表「归档」抽屉口径一致；有新消息会自动取消归档、重新可搜）。
        const archivedSet = new Set(typeof readSessionArchive === 'function' ? readSessionArchive() : []);
        if (!C.raw) {   // 冷启动：先试读盘缓存（指纹完全一致才用，坏了就当没有）
          C.raw = new Map(); C.fileFp = {};
          const disk = loadSearchCache(kind, fp);
          if (disk) { C.raw = disk.raw; C.fileFp = disk.fileFp; }
        }
        // sid → 文件映射：legacy 主文件 enhanced_messages.json 与 default 新文件二选一（同原版口径）
        const fileBySid = new Map();
        for (const f of files) {
          const sid = f === 'enhanced_messages.json' ? 'default' : f.replace(/^enhanced_messages_/, '').replace(/\.json$/, '');
          if (!sid) continue;
          const cur = fileBySid.get(sid);
          if (!cur || (cur === 'enhanced_messages.json' && f !== 'enhanced_messages.json')) fileBySid.set(sid, f);
        }
        // per-file 增量：指纹没变的会话直接复用 raw；变了/新出现的才重新收集；子会话（干活会话）仍不收集
        for (const [sid, f] of fileBySid) {
          let st = null; try { st = fsp.statSync(path.join(TL_DIR, f)); } catch (e) {}
          const k = st ? (st.mtimeMs + ':' + st.size) : 'gone';
          if (C.fileFp[f] === k && C.raw.has(sid)) continue;
          C.fileFp[f] = k;
          if (!st) { C.raw.delete(sid); continue; }
          let arr = [];
          try { arr = loadTimeline(sid); } catch (e) { C.raw.delete(sid); continue; }
          const row = [];
          // sidx 口径必须与 /v1/history 的可见序列完全一致（真实消息+推送回显可见；developer/tool/diary 隐藏；
          // 2026-11-01 起 noaction 静默消息可见，两端口径同步放行）——前端按该下标定位跳转，错位会落在错误消息上（2026-09-15 修复）。
          arr.filter(m => (isRealMessageForTimeline(m) || (m && !m.deleted && isPushEchoLike(m)))
            && !(m && (m.role === 'developer' || m.role === 'tool' || m.kind === 'diary')))
            .forEach((m, i) => {
              const text = tagParser.stripForDisplay(normalizeContentToText(m.content) || '');   // 11-15：索引文本与列表预览同口径，<suggest>/<title> 等标签内容不进索引与摘要（/v1/history 原样下发不动）
              if (!text) return;
              row.push({ sidx: i, text: text, ts: Date.parse((m && m.time) || '') || 0, mid: m.id, role: m.role });
            });
          C.raw.set(sid, row);
        }
        const fileSet = new Set(fileBySid.values());
        for (const f in C.fileFp) {   // 文件已删除的会话：清指纹也清条目
          if (fileSet.has(f)) continue;
          const sid = f === 'enhanced_messages.json' ? 'default' : f.replace(/^enhanced_messages_/, '').replace(/\.json$/, '');
          delete C.fileFp[f]; C.raw.delete(sid);
        }
        // 合并：归档 / 子会话 / 「不参与检索」组在此过滤——它们的副本不参与内容去重，不挤掉可搜会话的同文原条（口径同原版）；
        // ≥20 字相同文本只保留时间最新的一条（分支/继承副本无标记），短文本不判重（"嗯。"/"爱你"这类口语重复是真实的独立消息）。
        const DEDUP_MIN_LEN = 20;
        const byText = new Map();
        for (const [sid, row] of C.raw) {
          if (/^s_sub_/.test(sid)) continue;
          if (archivedSet.has(sid)) continue;
          if (excl && excl.isExcluded(sid)) continue;
          for (const r of row) {
            const it = { sid: sid, sidx: r.sidx, name: sid, text: r.text, low: r.text.toLowerCase(), ts: r.ts, mid: r.mid, role: r.role };
            if (r.text.length >= DEDUP_MIN_LEN) {
              const old = byText.get(r.text);
              if (!old || r.ts > old.ts) byText.set(r.text, it);
            } else {
              items.push(it);
            }
          }
        }
        for (const it of byText.values()) items.push(it);
        C.fp = fp;
        C.items = items;
        // 2026-09-30 V1 修复：items 重建后旧 index 的 h.i 下标全部失效，必须随之作废——
        // 否则下方指纹判断恒命中（fp 刚被置成当前值），旧索引被永久复用：新消息不进语义腿、语义分挂错消息。
        C.index = null;
        saveSearchCache(kind, fp, C.raw, C.fileFp);   // 防抖节流异步落盘，不挡本次响应
      }
      // 指纹命中时直接复用已建索引（TF-IDF 建索引是大头，不能每次请求重跑）
      let index;
      if (onlySid || onlySids.length) {
        // 只搜一个会话（sid=）/ 指定一组会话（sids=，组内搜索）：逐个用可见序列现建小索引（口径同上面的全量构建，但不做跨会话内容去重）
        items = [];
        const targets = onlySid ? [onlySid] : onlySids;
        for (const t of targets) {
          try {
            loadTimeline(t).filter(m => (isRealMessageForTimeline(m) || (m && !m.deleted && isPushEchoLike(m)))
              && !(m && (m.role === 'developer' || m.role === 'tool' || m.kind === 'diary')))
              .forEach((m, i) => {
                const text = tagParser.stripForDisplay(normalizeContentToText(m.content) || '');   // 11-15：索引文本与列表预览同口径，<suggest>/<title> 等标签内容不进索引与摘要（/v1/history 原样下发不动）
                if (!text) return;
                items.push({ sid: t, sidx: i, name: t, text, low: text.toLowerCase(), ts: Date.parse((m && m.time) || '') || 0, mid: m.id, role: m.role });
              });
          } catch (e) {}   // 单个会话读不到（已删/坏文件）就跳过，不让它挡掉整组搜索
        }
        index = buildSemIndex(items);
      } else {
        index = (C.fp === fp) ? C.index : null;
        if (!index) {
          index = buildSemIndex(items);
          C.fp = fp;
          C.index = index;
        }
      }
      const semScores = new Array(items.length).fill(0);
      semanticSearch(index, q, 0.05).forEach(h => { semScores[h.i] = h.score; });
      // 总分 = 语义 50% + 关键词 50%；关键词按命中次数分级（1次≈0.33 / 2次≈0.67 / 3次满格），任一腿有分即入结果。
      // 2026-10-21 修排序塌方：此前关键词腿是二值（命中=1），单字查询语义腿必为 0（索引只存 bigram）→
      // 全体命中并列 0.5 分、稳定排序退化为文件扫描序（字母序），最老的 s_mtd* 批次吃满 limit=200，
      // 最新会话永远进不了结果。现改为次数分级 + 同分按消息时间倒序 tie-break（最新的排前面）。
      /* [位置:routes/chat.js·searchHandler 关键词腿] [多词覆盖打分] [11-09：原来 n=整句 q 当子串出现的次数，AI 传「蓝鲸 饲养」两词分开写 → 关键词腿 0 分、全靠语义腿硬扛；现在由 lib/keyword-window.makeScorer 打分：单词与旧公式 min(1,n/3) 完全一致，多词 = max(整句子串分, 覆盖比×(0.5+0.5×平均深度))，盖得词多的排前面，旧行为是下限。语义腿与 50/50 结构不动（产品确定）] [注释时间 2026-11-09] */
      const kwScore = kw.makeScorer(q);
      const results = [];
      let excludedRecent = 0;
      items.forEach((it, i) => {
        if (timePrefix && !(it.ts > 0 && localTime(it.ts).startsWith(timePrefix))) return;
        const k = kwScore(it.low);
        if (!k && !semScores[i]) return;
        if (exclCutoff && it.sid === exclSid && it.ts > exclCutoff) { excludedRecent++; return; }   // 当前会话最近 N 分钟：上下文里已有，不检索
        const score = 0.5 * semScores[i] + 0.5 * k;
        const row = { sid: it.sid, sidx: it.sidx, name: it.name, text: it.text, score, time: it.ts };
        if (withId) { row.msg_id = it.mid; row.role = it.role; }
        results.push(row);
      });
      results.sort((a, b) => b.score - a.score || b.time - a.time);
      const picked = results.slice(0, limit);
      if (wantSnip) picked.forEach(r => { r.snippet = kw.snippet(r.text, q); delete r.text; });
      const body = { ok: true, mode: 'hybrid', total: results.length, results: picked };
      if (excludedRecent) body.excluded_recent = excludedRecent;
      reply.send(body);
    } catch (err) {
      console.error('[GET /v1/search] error:', err.message);
      fail500(reply, err);
    }
  };
  app.get('/v1/search', searchHandler);
  app.get('/internal/search', searchHandler);
  /* [位置:routes/chat.js·/internal/messages] [按 msg_id 取原文：可带前后文窗口、可不带会话全库定位] [11-03 建接口：AI 看详细对话只需要 msg_id，sid 由工具注入当前会话；11-07 三改（context-get窗口）：①ctx=N(1-30) 时命中条之外带前后各 N 条可见对话——口径同 /v1/search 索引（真实消息+推送回显，developer/tool/diary/deleted 不占名额不出现），多命中窗口重叠按时间线合并、每条带 hit 标记，总量超 60 从最旧邻居开始丢（命中条永不丢，trimmed=true）；不传 ctx=旧行为只回命中条（响应无 hit 字段），向后兼容；②sid 可不传——msg_id 全库定位（口径同 AI 检索 /internal/search：排除子会话 s_sub_、归档、「不参与检索」组），唯一命中→按该会话返回（messages 带 session 字段），命中多个会话（分支/继承副本 id 相同，全库 535/30335 条）或不同 id 落不同会话→ok:false+multi_session 分组让调用方逐会话取（11-09 起撞号不再报 ambiguous，副本全发）；③窗口逻辑收拢在 buildForSession 一处，sid/无 sid 两路共用] [注释时间 2026-11-07] */
  app.get('/internal/messages', async (req, reply) => {
    try {
      const sid = String(req.query.sid || '').replace(/[^A-Za-z0-9_-]/g, '');
      const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20);
      if (!ids.length) return reply.code(400).send({ ok: false, error: 'ids 必填（一次最多 20 条）', code: 'ids_required' });
      const ctxRaw = parseInt(String(req.query.ctx || ''), 10);
      const ctx = Number.isFinite(ctxRaw) && ctxRaw > 0 ? Math.min(ctxRaw, 30) : 0;
      const want = new Set(ids);
      const rowOf = (m, hit, withSession) => {
        const r = { msg_id: String(m.id), role: m.role, time: m.time || '', text: normalizeContentToText(m.content) || '' };
        if (withSession) r.session = withSession;
        if (hit !== undefined) r.hit = hit;
        return r;
      };
      // 单会话取数 + 窗口展开（sid 模式与全库定位唯一命中共用；收拢一处防两份口径漂移）
      const buildForSession = (fsid, withSession) => {
        const tl = loadTimeline(fsid) || [];
        const hitTis = [];
        tl.forEach((m, i) => { if (m && m.id != null && !m.deleted && want.has(String(m.id))) hitTis.push(i); });
        let out;
        if (!ctx) {
          out = hitTis.map(ti => rowOf(tl[ti], undefined, withSession));
        } else {
          // 可见对话 = 真实消息 + 推送回显（口径同 /v1/search 索引），developer/tool/diary/deleted 不占名额不出现
          const visibleIdx = [];
          const visiblePos = new Map();
          tl.forEach((m, i) => {
            if (!m || m.deleted) return;
            if (m.role === 'developer' || m.role === 'tool' || m.kind === 'diary') return;
            if (!(isRealMessageForTimeline(m) || isPushEchoLike(m))) return;
            visiblePos.set(i, visibleIdx.length);
            visibleIdx.push(i);
          });
          const includeIdx = new Set(hitTis);
          for (const ti of hitTis) {
            const vp = visiblePos.get(ti);
            if (vp === undefined) continue;   // 命中条本身不可见（如 developer 记账）：仍返回该条，但不展开邻居
            for (let k = 1; k <= ctx; k++) {
              if (vp - k >= 0) includeIdx.add(visibleIdx[vp - k]);
              if (vp + k < visibleIdx.length) includeIdx.add(visibleIdx[vp + k]);
            }
          }
          let list = Array.from(includeIdx).sort((a, b) => a - b);
          let trimmed = false;
          if (list.length > 60) {
            let dropped = 0;
            for (const ti of list) {
              if (list.length - dropped <= 60) break;
              if (hitTis.includes(ti)) continue;   // 命中条永不丢
              includeIdx.delete(ti); dropped++;
            }
            if (dropped > 0) { trimmed = true; list = Array.from(includeIdx).sort((a, b) => a - b); }
          }
          out = list.map(ti => rowOf(tl[ti], hitTis.includes(ti), withSession));
          if (trimmed) out._trimmed = true;
        }
        const got = new Set(out.map(x => x.msg_id));
        return { messages: out, missing: ids.filter(x => !got.has(x)), trimmed: !!out._trimmed };
      };
      if (sid) {
        const r = buildForSession(sid);
        const o = { ok: true, total: r.messages.length, messages: r.messages, missing: r.missing };
        if (ctx) o.window = ctx;
        if (r.trimmed) o.trimmed = true;
        return reply.send(o);
      }
      // 无 sid：msg_id 全库定位（口径同 AI 检索：排除子会话/归档/「不参与检索」组，11-07 确认）
      const excl = require('../lib/search-exclude');
      const archivedSet = new Set(typeof readSessionArchive === 'function' ? readSessionArchive() : []);
      const files = fsp.readdirSync(TL_DIR).filter(f => f === 'enhanced_messages.json' || /^enhanced_messages[_-][A-Za-z0-9_-]+\.json$/.test(f));
      const byId = new Map();   // msg_id -> Set(会话)
      for (const f of files) {
        const fsid = f === 'enhanced_messages.json' ? 'default' : f.replace(/^enhanced_messages_/, '').replace(/\.json$/, '');
        if (!fsid || /^s_sub_/.test(fsid) || archivedSet.has(fsid) || excl.isExcluded(fsid)) continue;
        let arr; try { arr = loadTimeline(fsid); } catch (e) { continue; }
        for (const m of (arr || [])) {
          if (!m || m.id == null || m.deleted) continue;
          const mid = String(m.id);
          if (!want.has(mid)) continue;
          if (!byId.has(mid)) byId.set(mid, new Set());
          byId.get(mid).add(fsid);
        }
      }
      /* [位置:routes/chat.js·/internal/messages 撞号全发] [同 id 在多个会话有副本时，每个会话的副本都返回] [11-09：原来回 ambiguous 让调用方带 session 重试，但 AI 手里根本没有会话 id（search 当前会话时不返回 session）——撞号（分支/继承副本，全库约 1.8%）直接按会话分组全发，由现成的 multi_session 路径逐会话取窗口；删 ambiguous 分支] [注释时间 2026-11-09] */
      const missing = [], perSid = new Map();
      for (const id of ids) {
        const sids = Array.from(byId.get(id) || []).sort();
        if (!sids.length) { missing.push(id); continue; }
        for (const sd of sids) {
          if (!perSid.has(sd)) perSid.set(sd, []);
          perSid.get(sd).push(id);
        }
      }
      if (!perSid.size) return reply.send({ ok: true, total: 0, messages: [], missing });
      if (perSid.size === 1) {
        const [fsid] = Array.from(perSid.keys());
        const r = buildForSession(fsid, fsid);
        const o = { ok: true, total: r.messages.length, messages: r.messages, missing: r.missing };
        if (ctx) o.window = ctx;
        if (r.trimmed) o.trimmed = true;
        return reply.send(o);
      }
      // 不同 id 落在不同会话：返回分组定位，调用方逐会话带 sid 再取（窗口在带 sid 的调用里展开）
      return reply.send({ ok: false, multi_session: Array.from(perSid).map(([s, mids]) => ({ session: s, msg_ids: mids })), missing });
    } catch (err) { fail500(reply, err, null, null, { ok: false }); }
  });
  // 2026-09-21 审查清理：GET/PUT /v1/themes（主题云同步）已删除——chat.html 重构后全文件
  // 零调用，两端均无消费者。历史数据 data/saved-themes.json（9 个主题）保留在盘，git 可恢复本接口。
  // 系统提示词备份跨设备同步（存 data/prompt-backups.json）
  const PROMPT_BACKUPS_FILE = path.join(baseDir, 'data', 'prompt-backups.json');
  /* [位置:routes/chat.js·PROMPT_BACKUPS_LIMIT] [人设备份条数上限] [需求:11-15 健壮性——原来超 120 条用 slice 静默截掉最新的还回 ok，等于丢数据；上限提成常量，超限时整表不写、明确报错，旧数据原样] [注释时间 2026-11-15] */
  const PROMPT_BACKUPS_LIMIT = 120;
  app.get('/v1/prompt-backups', async (req, reply) => {
    try {
      let backups = [];
      try { if (fsp.existsSync(PROMPT_BACKUPS_FILE)) backups = JSON.parse(fsp.readFileSync(PROMPT_BACKUPS_FILE, 'utf-8')) || []; } catch (e) { console.error('[chat.js:555]', e.message || e); }
      if (!Array.isArray(backups)) backups = [];
      reply.send({ ok: true, backups });
    } catch (err) {
      console.error('[GET /v1/prompt-backups] error:', err.message);
      fail500(reply, err);
    }
  });
  app.put('/v1/prompt-backups', async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const now = new Date().toISOString();
      const norm = function (b) {
        if (!b || typeof b !== 'object' || typeof b.content !== 'string') return null;
        return {
          id: String(b.id || '').slice(0, 64) || ('pb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
          name: String(b.name || '未命名').slice(0, 60),
          // 2026-11-14（产品确定）：grp=人设分组名，随人设本体一起存取；marker=子智能体任务提示词标记，原样保留（此前 upsert 会把它抹掉）
          grp: String(b.grp || '').slice(0, 30),
          ...(b.marker ? { marker: String(b.marker).slice(0, 40) } : {}),
          // 2026-11-15（产品确定）：elapsed_tag_to_ai=人设级时间差标签开关（false=该人设的会话不注入 [elapsed]，true=注入；缺字段=清除开关回到跟随默认）——rp 预设组统一关的配套，白名单不收会被前端保存抹掉（10-22 同款坑）
          ...(typeof b.elapsed_tag_to_ai === 'boolean' ? { elapsed_tag_to_ai: b.elapsed_tag_to_ai } : {}),
          content: b.content,
          createdAt: String(b.createdAt || now).slice(0, 40),
          updatedAt: String(b.updatedAt || now).slice(0, 40)
        };
      };
      let existing = [];
      try { if (fsp.existsSync(PROMPT_BACKUPS_FILE)) existing = JSON.parse(fsp.readFileSync(PROMPT_BACKUPS_FILE, 'utf-8')) || []; } catch (e) { console.error('[chat.js:578]', e.message || e); }
      if (!Array.isArray(existing)) existing = [];
      // 新格式（2026-09-26 多端合并）：{ upserts: [备份...], delIds: [id...] } 按 id 合并，不做整表覆盖。
      // delIds 删除时同步清理 session-prompts.json 中引用该备份的会话键，避免悬挂引用导致静默回退全局。
      if (Array.isArray(body.upserts) || Array.isArray(body.delIds)) {
        const upserts = (Array.isArray(body.upserts) ? body.upserts : []).map(norm).filter(Boolean);
        const delIds = (Array.isArray(body.delIds) ? body.delIds : []).filter(id => typeof id === 'string' && id);
        for (const b of upserts) {
          const idx = existing.findIndex(x => x && x.id === b.id);
          if (idx >= 0) existing[idx] = b; else existing.push(b);
        }
        if (delIds.length) {
          existing = existing.filter(x => delIds.indexOf(x && x.id) < 0);
          const spFile = path.join(baseDir, 'data', 'session-prompts.json');
          try {
            if (fsp.existsSync(spFile)) {
              const sp = JSON.parse(fsp.readFileSync(spFile, 'utf-8')) || {};
              let changed = false;
              for (const k of Object.keys(sp)) { if (delIds.indexOf(sp[k]) >= 0) { delete sp[k]; changed = true; } }
              if (changed) fsp.writeFileSync(spFile, JSON.stringify(sp, null, 2), 'utf-8');
            }
          } catch (e) { console.warn('[prompt-backups] 清理会话引用失败:', e.message); }
        }
        /* [位置:routes/chat.js·PUT /v1/prompt-backups 超限拒绝] [名称:超限显式报错，不再静默丢最新] [需求:11-15 健壮性——原来 existing.slice(0,120) 把最后追加的备份（就是这次新存/改的那条）静默截掉还回 saved:true，前端以为存上了、数据其实没落盘；现在合并结果超上限直接 400 拒绝、整表一个字节都不写，前端走失败分支 toast，旧数据原样] [注释时间 2026-11-15] */
        if (existing.length > PROMPT_BACKUPS_LIMIT) {
          return fail(reply, 400, 'prompt_backups_limit',
            '人设备份最多 ' + PROMPT_BACKUPS_LIMIT + ' 条，这次保存会到 ' + existing.length + ' 条，已拒绝（没有丢数据）：先删掉不用的人设再存',
            { limit: PROMPT_BACKUPS_LIMIT, count: existing.length, saved: false });
        }
        fsp.writeFileSync(PROMPT_BACKUPS_FILE, JSON.stringify(existing, null, 2), 'utf-8');
        reply.send({ ok: true, saved: true, count: existing.length });
        return;
      }
      // 旧格式整表（兼容旧缓存页面）
      const clean = (Array.isArray(body.backups) ? body.backups : []).map(norm).filter(Boolean);
      if (clean.length === 0 && existing.length > 0 && !body.replace) {
        reply.send({ ok: true, saved: false, skipped: 'empty', count: existing.length });
        return;
      }
      // 旧格式整表同样受上限约束：放它超限写进去，下一次 upsert 就会撞上限被拒，两条路径口径要一致
      if (clean.length > PROMPT_BACKUPS_LIMIT) {
        return fail(reply, 400, 'prompt_backups_limit',
          '人设备份最多 ' + PROMPT_BACKUPS_LIMIT + ' 条，这次整表保存是 ' + clean.length + ' 条，已拒绝（没有丢数据）：先删掉不用的人设再存',
          { limit: PROMPT_BACKUPS_LIMIT, count: clean.length, saved: false });
      }
      fsp.ensureDirSync(path.join(baseDir, 'data'));
      fsp.writeFileSync(PROMPT_BACKUPS_FILE, JSON.stringify(clean, null, 2), 'utf-8');
      reply.send({ ok: true, saved: true, count: clean.length });
    } catch (err) {
      console.error('[PUT /v1/prompt-backups] error:', err.message);
      fail500(reply, err);
    }
  });

  // 会话合并：读多个源会话时间线，按消息时间稳定排序合并写入新会话时间线；源会话不动。
  // 前端生成新 sid 传入（与 newSession 流程一致），服务端只负责合并与落盘。
  // 1008 分支/合并共享：按源会话口径为新会话生成系统注入快照（几大块完整继承）。
  // 用源会话的 sessionId 组装（cutoffDate=源首条消息日期、system=源人设），写入目标会话名下。
  // 1018：按勾选过滤（selectBlocks 显式传入优先，否则用源会话的 inject_blocks / 全局默认），
  // 并补喂标星行（与 runtime 首次组装同源同限）。此前不看勾选全塞、且标星块恒缺。
  function buildInjectSnapshotForNewSession(srcSessionId, newSessionId, srcTl, selectBlocks) {
    let blocks = 0;
    try {
      const sv2 = require('../context/context-snapshot-v2');
      const { createSessionCfg } = require('../lib/session-cfg');
      const cfg = createSessionCfg(baseDir);
      const sel = Array.isArray(selectBlocks) ? cfg.normalizeInjectBlocks(selectBlocks) : cfg.readInjectBlocks(srcSessionId);
      const want = new Set(Array.isArray(sel) ? sel : cfg.DEFAULT_INJECT_BLOCKS);
      const input = contextV2Shadow.assembleInput({
        baseDir,
        sessionId: srcSessionId,
        llmMessages: [],
        loadTimeline,
        normalizeContentToText
      });
      // 固定块按新会话的成员登记（分支已先复制父会话成员；合并是新登记）
      const cap = frozenBlocks.prepareInput(baseDir, newSessionId, input, want, { loadTimeline, starredLimit: cfg.readStarredDialogLimit(srcSessionId) });
      const built = buildContextBlocks(input);
      cap.diaryIds = (built.members && built.members.conversation_continuity) || [];
      const picked = frozenBlocks.finalize(baseDir, newSessionId, built.blocks.filter(b => b && want.has(b.key)), want, cap, false);
      const fixed = picked
        .filter(b => b && b.key !== 'relevant_memories' && !b.empty)
        .map(b => ({ key: b.key, title: b.title || '', content: b.content }));
      const srcSys = (srcTl && srcTl[0] && srcTl[0].role === 'system' && srcTl[0].content) ? srcTl[0].content : '';
      // 1010-30 阶段4a：预置块直写 v2 快照（overwriteShell：content=[] + snap_point=0，
      // 读取路径尾部现取=整条新时间线；不再写旧注入快照 A）
      const n = sv2.mergeInjectBlocks(baseDir, newSessionId, fixed, { overwriteShell: true, systemContent: srcSys, selected: Array.from(want) });
      blocks = n >= 0 ? n : 0;
    } catch (e) {
      console.warn('[branch/merge] 注入快照生成失败（会话仍可用）:', e.message);
    }
    return blocks;
  }

  app.post('/v1/sessions/merge', async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const ids = Array.isArray(body.ids) ? body.ids.map(x => String(x || '').trim()).filter(Boolean) : [];
      if (ids.length < 2) return reply.code(400).send({ error: '至少选择两个会话', code: 'need_two_sessions' });
      /* [位置:routes/chat.js·/v1/sessions/merge ids 上限] [数量夹紧] [11-14 审查 B 批 c：原来不限数量，一次能传几百个 id（线上 354 个会话 ≈ 245MB 时间线），全量读盘 + 全量消息常驻，而合并本来就是个低频人工操作；夹到 20，超限直接 400 告知，不静默截断（静默截断会合出一半，更难排查）] [注释时间 2026-11-14] */
      if (ids.length > 20) return reply.code(400).send({ error: '一次最多合并 20 个会话', code: 'too_many_sessions' });
      for (const id of ids) {
        // 1009-06：default 主会话概念已清理，不再特殊拒绝
        if (!/^[A-Za-z0-9_-]+$/.test(id)) return reply.code(400).send({ error: '非法会话ID: ' + id, code: 'bad_request' });
      }
      const target = String(body.target || '').trim();
      if (!target || !/^[A-Za-z0-9_-]+$/.test(target)) return reply.code(400).send({ error: '非法目标会话ID', code: 'invalid_target_id' });
      if (ids.indexOf(target) >= 0) return reply.code(400).send({ error: '目标会话不能是源会话', code: 'target_is_source' });
      if (fsp.existsSync(timelineFileFor(target))) return reply.code(409).send({ error: '目标会话已存在', code: 'target_exists' });

      // 各源会话按自身顺序取真实消息；无 time 的消息沿用同会话内前一条的时间，保持相对顺序。
      // 全局按 (ts, 源序, 会话内序) 稳定排序 —— buildTimeline 不重排真实消息，顺序由此保证。
      const entries = [];
      let total = 0;
      const maxTsById = Object.create(null);
      ids.forEach((id, si) => {
        let lastTs = 0;
        loadTimeline(id).filter(isRealMessageForTimeline).forEach((m, oi) => {
          const ts = (m.time && Number(new Date(m.time))) || 0;
          if (ts) lastTs = ts;
          entries.push({ m, ts: ts || lastTs, si, oi });
          total++;
        });
        maxTsById[id] = lastTs;
      });
      if (total === 0) return reply.code(400).send({ error: '所选会话都没有消息', code: 'empty_sessions' });
      entries.sort((a, b) => (a.ts - b.ts) || (a.si - b.si) || (a.oi - b.oi));
      const rebuilt = buildTimeline(entries.map(e => e.m), target);
      saveTimeline(rebuilt, target);
      // 源会话状态块复制到合并会话：matched 内容锚点在目标时间线重定位，按内容序列去重。
      // 复制语义：源会话块保留（源会话继续显示摘要），同时复制一份归属到目标会话。
      // 1008 手动块失效：migrateSessionBlocks 只迁移状态块（ctxrep_state_）。
      /* [位置:routes/chat.js·/v1/sessions/merge 部分成功] [失败不再静默] [11-14 审查 B 批 c：主时间线已写盘后，状态块迁移 / 快照清理 / 注入块预置任一失败原来只进日志，接口照样回 ok:true，界面报「合并成功」而新会话的上下文注入是空的；现在把失败收集成 warnings 跟回包一起给，前端可以提示「合并了，但上下文没继承全」] [注释时间 2026-11-14] */
      const warnings = [];
      let migrateStat = null;
      try {
        migrateStat = contextReplacements.migrateSessionBlocks(ids, target);
        if (migrateStat) console.log(`[sessions/merge] 复制状态块:`, JSON.stringify(migrateStat));
      } catch (e) { console.error('[sessions/merge] 复制状态块失败:', e.message); warnings.push('状态摘要没复制过来'); }
      // 1008 合并注入快照：按最近活跃的源会话口径生成几大块（用户拍板 B 方案），
      // 合并会话系统注入完整继承该源（cutoffDate/人设/记忆都与该源一致）。
      let injectBlocks = 0;
      /* [位置:routes/chat.js·/v1/sessions/merge 注入源] [不再二次读盘] [11-14 审查 B 批 c：原来为了找「最近活跃的源会话」又对同一批 id 全量 loadTimeline 一遍（254 会话量级 ≈ 再解析一次全量）；第一遍已经算过每个会话的最后时间，直接用] [注释时间 2026-11-14] */
      let injectSrc = ids[0], injectSrcTs = -1;
      try {
        for (const id of ids) {
          const lastTs = maxTsById[id] || 0;
          if (lastTs > injectSrcTs) { injectSrcTs = lastTs; injectSrc = id; }
        }
      } catch (e) { console.warn('[sessions/merge] 注入源选择失败:', e.message); }
      // 1008 快照防御 + 1010-30 阶段4a：先清目标会话旧 v2 快照再预置注入块
      //（预置已直写 v2 快照，后清会把刚写的清掉——顺序必须"先清后写"）
      try {
        const sv2 = require('../context/context-snapshot-v2');
        sv2.deleteSnapshot(baseDir, target);
        sv2.clearStale(baseDir, target);
      } catch (e) { console.error('[sessions/merge] 清目标会话快照失败:', e.message); warnings.push('旧上下文快照没清干净'); }
      try {
        injectBlocks = buildInjectSnapshotForNewSession(injectSrc, target, loadTimeline(injectSrc));
      } catch (e) { console.warn('[sessions/merge] 注入快照预置失败:', e.message); warnings.push('上下文注入块没预置'); }
      if (warnings.length) console.warn('[sessions/merge] 部分成功:', warnings.join('；'));
      console.log(`[sessions/merge] 合并 ${ids.length} 个会话 -> ${target}（${total} 条源消息）注入源=${injectSrc || ''} 注入块=${injectBlocks}`);
      /* [位置:routes/chat.js·/v1/sessions/merge 回包] [带 warnings] [前端据此提示「合并了但上下文没继承全」，不再是纯 ok:true] [注释时间 2026-11-14] */
      reply.send({ ok: true, session_id: target, merged: total, total: rebuilt.filter(isRealMessageForTimeline).length, inject_blocks: injectBlocks, warnings: warnings });
    } catch (err) {
      console.error('[POST /v1/sessions/merge] error:', err.message);
      fail500(reply, err);
    }
  });

  // 会话分支：继承父会话中「完全落在分支点之前」的压缩块（复制语义，父会话块保留）。
  // 前端开分支后调用，branchIndex 是分支点消息在前端 msgs（真实消息序列）里的下标。
  app.post('/v1/sessions/branch-inherit', async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const srcSession = String(body.srcSession || '').trim();
      const newSession = String(body.newSession || '').trim();
      const branchIndex = Number(body.branchIndex);
      if (!srcSession || !newSession || !Number.isInteger(branchIndex) || branchIndex < 0) {
        return reply.code(400).send({ error: '缺少参数', code: 'params_required' });
      }
      if (!/^[A-Za-z0-9_-]+$/.test(srcSession) || !/^[A-Za-z0-9_-]+$/.test(newSession)) {
        return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      }
      // 11-10：源=目标等于自己给自己复制时间线（后端原本不校验，saveTimeline 会把源时间线截断写回）；新会话时间线已存在也不许覆盖
      if (srcSession === newSession) return reply.code(400).send({ error: '源会话与新会话相同', code: 'same_session' });
      if (fsp.existsSync(timelineFileFor(newSession))) return reply.code(409).send({ error: '新会话已存在', code: 'session_exists' });
      const anchorId = body.anchorId ? String(body.anchorId) : '';
      // 1008 分支会话继承改造：
      // 1) 父完整时间线 + 分支点定位（时间线数组下标；anchorId 反查优先，回退前端可见序列映射）
      const tl = loadTimeline(srcSession);
      if (!Array.isArray(tl) || tl.length === 0) return reply.code(404).send({ error: '源会话时间线为空', code: 'empty_timeline' });
      let bIdx = -1;
      if (anchorId) { for (let i = 0; i < tl.length; i++) { if (tl[i] && tl[i].id === anchorId) { bIdx = i; break; } } }
      if (bIdx < 0) {
        const visible = [];
        for (let i = 0; i < tl.length; i++) {
          const m = tl[i];
          if (!m || m.role === 'system') continue;
          if (m.tool_calls) continue;
          if (m.kind === 'recent_inherit') continue;   // 1018：承接来的原消息前端不显示，不占可见下标
          if (m.role !== 'user' && m.role !== 'assistant') continue;
          const t = normalizeContentToText(m.content) || '';
          if (m.role === 'user' && String(t).trim().startsWith('<system>')) continue;
          visible.push(i);
        }
        if (branchIndex < 0 || branchIndex >= visible.length) {
          return reply.code(404).send({ error: '分支点消息在源会话时间线中找不到', code: 'anchor_not_found' });
        }
        bIdx = visible[branchIndex];
      }
      // 2) 分支时间线 = 父时间线 1..分支点 原文全量复制（保留 time/position/id，含 system 兜底人设）
      const branchTimeline = tl.slice(0, bIdx + 1).map(m => Object.assign({}, m));
      // 3) 状态块继承（inheritSessionBlocks 内部只认状态块；bIdx 以 hint 传入避免二次定位）
      const stat = contextReplacements.inheritSessionBlocks(srcSession, newSession, branchIndex, anchorId, bIdx);
      if (stat.error) return reply.code(404).send({ error: stat.error, code: 'not_found' });
      // 4) 清目标会话旧 v2 快照（防御异常路径残留；必须先清——预置注入块直写 v2 快照，后清会清掉刚写的）
      try {
        const sv2 = require('../context/context-snapshot-v2');
        sv2.deleteSnapshot(baseDir, newSession);
        sv2.clearStale(baseDir, newSession);
      } catch (e) { console.error('[sessions/branch-inherit] 清目标会话快照失败:', e.message); }
      // 5) 注入块预置（1010-30 阶段4a：按父会话口径直写 v2 快照，分支会话系统注入完整继承旧会话）
      //    1018：分支是父会话的延续——日记/标星/笔记本沿用父会话的固定内容
      try { frozenBlocks.copy(baseDir, srcSession, newSession); } catch (e) {}
      const injectBlocks = buildInjectSnapshotForNewSession(srcSession, newSession, tl);
      // 6) 写分支时间线
      saveTimeline(branchTimeline, newSession);
      /* [位置:routes/chat.js·branch-inherit·配置继承+父子登记] [11-10：手机端开分支只复制时间线，会话配置（跨注入/注入块/标星条数/日记篇数）不继承、父子关系不登记，跨设备看不出这是谁的分支。两件都放在时间线写盘成功之后，各自 try：失败只告警，不回收已经复制好的时间线（回滚代价比丢登记大）] [注释时间 2026-11-10] */
      try {
        if (require('../lib/session-cfg').createSessionCfg(baseDir).inheritFrom(srcSession, newSession)) console.log('[sessions/branch-inherit] ' + newSession + ' 继承父会话 ' + srcSession + ' 的会话配置');
      } catch (e) { console.warn('[sessions/branch-inherit] 继承会话配置失败:', e.message); }
      let branchRegistered = false;
      try { branchRegistered = require('../lib/session-branches').register(baseDir, newSession, { fromSession: srcSession, fromIndex: bIdx, anchorId: anchorId }) === true; }
      catch (e) { console.warn('[sessions/branch-inherit] 登记分支关系失败:', e.message); }
      reply.send({ ok: true, inherited: stat.inherited, skippedNoMatch: stat.skippedNoMatch, skippedCross: stat.skippedCross, timeline_count: branchTimeline.length, inject_blocks: injectBlocks, branch_point: bIdx, branch_registered: branchRegistered });
    } catch (err) {
      console.error('[POST /v1/sessions/branch-inherit] error:', err.message);
      fail500(reply, err);
    }
  });
  // ---- 1018「上一个会话」helpers ----
  function sessionNameOf(sid) {
    try { const m = fsp.readJsonSync(path.join(baseDir, 'data', 'session-names.json')); return (m && m[sid]) ? String(m[sid]) : ''; } catch (e) { return ''; }
  }
  function readSessionState(sid) {
    try {
      const st = fsp.readJsonSync(path.join(baseDir, 'data', 'conversation_state.json'))[sid];
      const text = st && String(st.text || '').trim();
      return text ? { version: Number(st.version) || null, text: text } : null;
    } catch (e) { return null; }
  }
  // 会话现在的状态：ok / archived（归档）/ deleted（删除或时间线已不在）
  function sessionStatusOf(sid, deleted, archived) {
    if (deleted.has(sid) || !fsp.existsSync(timelineFileFor(sid))) return 'deleted';
    if (archived.has(sid)) return 'archived';
    return 'ok';
  }
  // 1018：上一个会话 = 聊天请求记录里最新一条（排除自己）。它若已归档/删除，额外给出再往前最近的可用会话，
  // 由用户决定跳过（承接 fallback）还是不跳过（承接失败）。返回 { latest, status, fallback } 或 null。
  function resolveInherit(excludeId) {
    let deleted = new Set();
    try { const d = fsp.readJsonSync(path.join(baseDir, 'data', 'deleted_sessions.json')); deleted = new Set(Array.isArray(d) ? d : Object.keys(d || {})); } catch (e) {}
    let archived = new Set();
    try { archived = new Set(typeof readSessionArchive === 'function' ? readSessionArchive() : []); } catch (e) {}
    const log = createChatRequestLog(baseDir);
    const latest = log.latestExcept(excludeId);
    if (!latest) return null;
    const status = sessionStatusOf(latest.session, deleted, archived);
    const fallback = status === 'ok' ? null : log.latestExcept(excludeId, function (sid) {
      return sid !== latest.session && sessionStatusOf(sid, deleted, archived) === 'ok';
    });
    return { latest: latest, status: status, fallback: fallback };
  }
  function inheritPublic(inh) {
    if (inh && inh.failed) return { failed: true, reason: inh.reason, latest: inh.latest, latest_name: sessionNameOf(inh.latest) || inh.latest_name || '', at: inh.at || null };
    if (!inh || !inh.from) return null;
    return { from: inh.from, from_name: sessionNameOf(inh.from) || inh.from_name || '', at: inh.at || null, state_version: inh.state_version || null, has_state: !!inh.state_text, recent_count: inh.recent_count || 0 };
  }
  // 新建会话弹窗预览：现在新建的话会承接哪个会话（只读，不固化）
  app.get('/v1/sessions/inherit-candidate', async (req, reply) => {
    try {
      const exclude = String((req.query && req.query.exclude) || '').trim();
      const r = resolveInherit(exclude);
      if (!r) return reply.send({ ok: true, candidate: null });
      const pub = function (e) {
        if (!e) return null;
        const st = readSessionState(e.session);
        return { session: e.session, name: sessionNameOf(e.session), time: e.time, count: e.count, state_version: st ? st.version : null };
      };
      reply.send({ ok: true, candidate: Object.assign(pub(r.latest), { status: r.status }), fallback: pub(r.fallback) });
    } catch (err) { fail500(reply, err); }
  });

  // 2026-10-27：用预设一次性建会话（POST /v1/sessions/from-preset，实现见 routes/session-preset.js；内部复用下面这些单项接口，行为完全一致）
  require('./session-preset')(app, { baseDir: baseDir });

  // 会话级跨窗口注入覆盖（新建会话时设置）：true=本会话强制注入, false=本会话关闭, null=跟随全局。
  // 仅影响该会话是否注入跨窗口记忆，不触碰管理台全局配置。
  app.get('/v1/sessions/:id/cross-inject', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const override = deps.sessionCrossInjectOverride(sessionId);
      // 1010 需求3：多选注入块一并返回（null=全部注入）
      const injectBlocks = deps.readInjectBlocks(sessionId);
      let _inh = null;
      try { _inh = inheritPublic(require('../lib/session-cfg').createSessionCfg(baseDir).readInheritRecord(sessionId)); } catch (e) { _inh = null; }
      reply.send({ session_id: sessionId, cross_inject_enabled: override, follow_global: override === null, inject_blocks: injectBlocks, diary_count_override: typeof deps.readSessionDiaryCount === "function" ? deps.readSessionDiaryCount(sessionId) : null, inherit: _inh });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/cross-inject] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/cross-inject', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      let val = null;
      if (body.enabled === true || body.enabled === 'true') val = true;
      else if (body.enabled === false || body.enabled === 'false') val = false;
      // 其余（undefined/null/''）→ null 跟随全局
      const saved = deps.saveSessionCrossInjectOverride(sessionId, val);
      // 1010 需求3：多选注入块一并保存（body.inject_blocks 数组；缺省=不改动/全部注入）
      let savedBlocks = null;
      if (body.inject_blocks !== undefined) savedBlocks = deps.saveInjectBlocks(sessionId, body.inject_blocks);
      if (body.starred_dialog_limit !== undefined && typeof deps.saveStarredDialogLimit === 'function') deps.saveStarredDialogLimit(sessionId, body.starred_dialog_limit);
      if (body.diary_count_override !== undefined && typeof deps.saveSessionDiaryCount === 'function') deps.saveSessionDiaryCount(sessionId, body.diary_count_override);
      /* [位置:routes/chat.js·cross-inject 改勾选清快照] [11-21：修改已有会话的跨窗口开关或注入块勾选，B2 缓存层本来就会失效，顺手清旧快照让下一轮自动重建生效（新建空会话无快照幂等无副作用）] [注释时间 2026-11-21] */
      try {
        const sv2 = require("../context/context-snapshot-v2");
        if (sv2.hasSnapshot(baseDir, sessionId)) {
          sv2.deleteSnapshot(baseDir, sessionId);
          sv2.clearStale(baseDir, sessionId);
          console.log("[ctx-snapshot-v2] 跨窗口注入配置变更，已清快照等待重建 session=" + sessionId);
        }
      } catch (e) {}
      // 1018 跨窗口注入定稿：新建会话那一刻（时间线还是空的 = 真新建）固化「上一个会话」——
      // 聊天请求记录里最新一条、排除自己、且时间线还在的会话。承接信息（含当时状态机正文副本）写进
      // 会话配置 inherit，之后不再变；勾了「最近对话」则把它末尾 N 轮原消息原样复制进本会话时间线
      //（不拍扁：保留 role/content/time/tools，打 kind=recent_inherit + hidden：前端不显示、不计数，
      // 只给 AI 看，可被本会话状态机压缩）。已有承接信息（重复 POST）不重找、不重复写。
      let inheritInfo = null;
      try {
        const _tl = deps.loadTimeline(sessionId);
        const _isNew = !Array.isArray(_tl) || _tl.length === 0;
        const _cfg = require('../lib/session-cfg').createSessionCfg(baseDir);
        inheritInfo = _cfg.readInheritRecord(sessionId);
        /* [位置:routes/chat.js·cross-inject 指定承接] [inherit_from 指定承接对象] [10-29：继承上一个会话改为可指定——会话列表长按「复制会话 id」→ 新建会话「读剪贴板」带上 inherit_from；合法（存在且有对话）就用它，不再自动找「最近聊天的会话」；没带照旧自动承接；指定了但源不存在/没对话 → 记 failed(src_missing) 界面可见，不悄悄换成别的会话] [注释时间 2026-10-29] */
        const _want0 = String(body.inherit_from || '').trim();
        const _want = (_want0 && /^[A-Za-z0-9_-]+$/.test(_want0) && _want0 !== sessionId) ? _want0 : '';
        let _explicit = null;
        if (_want) { try { const _stl = deps.loadTimeline(_want); if (Array.isArray(_stl) && _stl.length) _explicit = _want; } catch (e) {} }
        /* 「最近对话」块：把承接源末尾 N 轮原消息原样复制进新会话（自动承接与指定承接共用同一套） */
        const _copyRecent = function (srcSid) {
          const _keys = (savedBlocks && Array.isArray(savedBlocks.inject_blocks)) ? savedBlocks.inject_blocks : [];
          if (_keys.indexOf('recent_dialog') < 0) return;
          let _rounds = Number(body.recent_dialog_rounds);
          if (!isFinite(_rounds) || _rounds < 1) _rounds = 20;
          if (_rounds > 100) _rounds = 100;
          const _srcReal = deps.loadTimeline(srcSid).filter(function (m) {
            return m && !m.deleted && deps.isRealMessageForTimeline(m) && String(deps.normalizeContentToText(m.content) || '').trim();
          }).slice(-(_rounds * 2));
          if (!_srcReal.length) return;
          const _out = _srcReal.map(function (m) {
            const c = Object.assign({}, m);
            delete c.id; delete c.position; delete c.spRev;
            c.kind = 'recent_inherit'; c.hidden = true; c.inherit_from = srcSid;
            return c;
          });
          _out.unshift({ role: 'developer', hidden: true, kind: 'recent_inherit', time: _srcReal[0].time, content: '（以下 ' + _srcReal.length + ' 条对话承接自上一个会话，原样保留）' });
          deps.appendMessages(sessionId, _out, { silent: true });
          inheritInfo.recent_count = _srcReal.length;
          _cfg.saveInherit(sessionId, inheritInfo);
        };
        if (_isNew && !inheritInfo && _want && !_explicit) {
          inheritInfo = { failed: true, reason: 'src_missing', latest: _want, latest_name: sessionNameOf(_want), at: new Date().toISOString() };
          _cfg.saveInherit(sessionId, inheritInfo);
          console.log('[cross-inject] 指定承接失败: ' + sessionId + ' <- ' + _want + '（该会话不存在或没有对话）');
        } else if (_isNew && !inheritInfo && _explicit) {
          const _st = readSessionState(_explicit);
          inheritInfo = {
            from: _explicit,
            from_name: sessionNameOf(_explicit),
            at: new Date().toISOString(),
            state_version: _st ? _st.version : null,
            state_text: _st ? _st.text : null,
          };
          _cfg.saveInherit(sessionId, inheritInfo);
          _copyRecent(_explicit);
          console.log('[cross-inject] 新会话承接（指定）: ' + sessionId + ' <- ' + _explicit + '（状态机 v' + (inheritInfo.state_version || '-') + '，最近对话 ' + (inheritInfo.recent_count || 0) + ' 条）');
        } else if (_isNew && !inheritInfo) {
          // 最近聊天的会话已归档/删除：inherit_skip=true（默认）→ 跳过改承接再往前最近的可用会话；
          // inherit_skip=false → 承接失败（记一条 failed 记录，界面可见），不注入继承状态与最近对话。
          const _r = resolveInherit(sessionId);
          let _cand = null;
          if (_r && _r.status === 'ok') _cand = _r.latest;
          else if (_r && body.inherit_skip === false) {
            inheritInfo = { failed: true, reason: _r.status, latest: _r.latest.session, latest_name: sessionNameOf(_r.latest.session), at: new Date().toISOString() };
            _cfg.saveInherit(sessionId, inheritInfo);
            console.log('[cross-inject] 新会话承接失败: ' + sessionId + '（最近聊天的 ' + _r.latest.session + ' 已' + (_r.status === 'archived' ? '归档' : '删除') + '，用户选择不跳过）');
          } else if (_r) _cand = _r.fallback;
          if (_cand) {
            const _st = readSessionState(_cand.session);
            inheritInfo = {
              from: _cand.session,
              from_name: sessionNameOf(_cand.session),
              at: new Date().toISOString(),
              state_version: _st ? _st.version : null,
              state_text: _st ? _st.text : null,
            };
            _cfg.saveInherit(sessionId, inheritInfo);
            _copyRecent(_cand.session);
            console.log('[cross-inject] 新会话承接: ' + sessionId + ' <- ' + _cand.session + '（状态机 v' + (inheritInfo.state_version || '-') + '，最近对话 ' + (inheritInfo.recent_count || 0) + ' 条）');
          }
        }
      } catch (e) { console.warn('[cross-inject] 承接上一个会话失败（不影响建会话）:', e && e.message); }
      /* [位置:routes/chat.js·cross-inject 空时间线] [建会话那一刻落一个空时间线，会话列表才列得出来] [11-13：/v1/sessions 只扫时间线文件，新建会话只写会话配置，一条消息没发的会话在服务器上根本不存在——手机只在内存 unshift 一行，退出重进就没了。三条建会话路径（预设 from-preset 内部走本接口、旧逐项路径、自定义新建）都经过这里，一处覆盖。两个约束：① 必须走 saveTimeline 不用 fs 直写——墓碑守卫在 server.js:1272，文件不存在且 24h 墓碑期内会 return false，已删会话不会被写回来；② s_sub_ 子会话跳过——子会话的时间线由 subagent-preset-runner 的占位消息建立，配一半失败的派单本来就不该出现在会话列表] [注释时间 2026-11-14] */
      try {
        if (String(sessionId).indexOf('s_sub_') !== 0) {
          const _tf = timelineFileFor(sessionId);
          if (!fsp.existsSync(_tf) && saveTimeline([], sessionId) === false) {
            console.warn('[cross-inject] 空时间线没落盘（会话可能在墓碑期）: ' + sessionId);
          }
        }
      } catch (e) { console.warn('[cross-inject] 空时间线落盘失败（不影响建会话）:', e && e.message); }
      reply.send({ ok: true, session_id: sessionId, cross_inject_enabled: val, saved: saved, inject_blocks: savedBlocks, inherit: inheritPublic(inheritInfo) });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/cross-inject] error:', err.message);
      fail500(reply, err);
    }
  });

  // 会话级模型供应商覆盖：本会话单独用哪个 AI 供应商（不存在/停用则回退全局）。
  // 仅影响该会话的转发目标（api_url/api_key/model），不触碰管理台全局配置。
  app.get('/v1/sessions/:id/model-provider', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const override = deps.sessionModelProviderOverride(sessionId);
      const modelName = deps.sessionModelNameOverride(sessionId);
      // 2026-10-28：带上「实际会用到」的供应商/模型与是否 Claude。跟随默认时前端也要能判断，
      // 否则 Claude 思考开关只在手动选 Claude 时出现，默认就是 Claude 的会话会丢入口。
      const eff = await deps.resolveChatModel(sessionId, null, { quiet: true });
      const effProv = (eff && eff.provider) || null;
      reply.send({
        session_id: sessionId, model_provider_id: override, model_name: modelName, follow_global: override === null,
        effective_provider_id: effProv ? String(effProv.id || '') : '',
        effective_model: String((eff && eff.model) || ''),
        effective_is_claude: upstreamTarget.isClaudeChat(effProv),
        effective_is_glm: upstreamTarget.isGlmChat(effProv),
        /* [位置:routes/chat.js·GET model-provider grok 标记] [前端按实际模型显隐「Grok 思考」] [11-16：effective_is_grok=实际解析到的供应商是 Grok 订阅；effective_grok_xhigh=实际模型是 grok-4.6 及以上（「极高」只对它们显示），版本比较与后端 grokEffortFor 同一套判据] [注释时间 2026-11-16] */
        effective_is_grok: upstreamTarget.isGrokChat(effProv),
        effective_grok_xhigh: upstreamTarget.grokSupportsXhigh(String((eff && eff.model) || '')),
      });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/model-provider] error:', err.message);
      fail500(reply, err);
    }
  });
  // 重建会话注入前缀快照（1002-12）：清除该会话快照条目，下一轮请求按当前人设/记忆/日记重新生成
  app.post('/v1/sessions/:id/snapshot/rebuild', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      // 2026-10-08 方案A：重建入口接到 v2 快照系统上——此前调旧 context-snapshot.deleteSnapshot
      // 只删旧注入快照，v2 快照文件纹丝不动（「重建快照」点了没效果的根因）。
      // 现在删 v2 快照 + 清失效标记 + 保留删旧注入快照，下次请求懒生成全新 v2 快照。
      const sv2 = require("../context/context-snapshot-v2");
      const existed = sv2.hasSnapshot(baseDir, safe);
      sv2.deleteSnapshot(baseDir, safe);
      sv2.clearStale(baseDir, safe);
      // 1010-27 回退：rebuild 只删快照，不当场重建；下次发消息时自然懒生成，
      // 成功后聊天响应头 X-Snapshot-Rebuilt=1 通知前端弹横幅。
      // 1010-31 阶段4c：v1 注入快照已退役，只删 v2（existed 按 v2 快照判定）。
      reply.send({ ok: true, session_id: safe, existed: existed });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/snapshot/rebuild] error:', err.message);
      fail500(reply, err);
    }
  });

  // 一键删除全部会话注入前缀快照（1009-04）：清空 v2 快照目录全部文件（含失效标记）。
  // 1010-31 阶段4c：v1 注入快照已退役（A 文件归档于 archives/），不再涉及。
  app.post('/v1/snapshots/clear-all', async (req, reply) => {
    try {
      const v2dir = path.join(baseDir, "data", "session_ctx_snapshots_v2");
      let deleted = 0;
      if (fsp.existsSync(v2dir)) {
        for (const name of fsp.readdirSync(v2dir)) {
          if (name.endsWith('.json')) {
            try { fsp.unlinkSync(path.join(v2dir, name)); deleted++; } catch (e) { console.warn('[chat.js:894] cleanup failed:', e.message); }
          }
        }
      }

      console.log('[snapshot-clear-all] 已清空全部快照: 删除 ' + deleted + ' 个文件');
      // [位置:routes/chat.js·clear-all] [重置批量核验缓存] [设置页清完全部快照后，列表马上拉 snapshot-stale-all 不能再吃到 30 秒缓存里的旧红点] [注释时间 2026-10-28]
      _snapStaleAllAt = 0; _snapStaleAllMap = null;
      reply.send({ ok: true, deleted });
    } catch (err) {
      console.error('[POST /v1/snapshots/clear-all] error:', err.message);
      fail500(reply, err);
    }
  });

  app.post('/v1/sessions/:id/model-provider', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      let val = null;
      if (typeof body.model_provider_id === 'string' && body.model_provider_id.trim()) val = body.model_provider_id.trim();
      // 其余（undefined/null/''）→ null 跟随全局
      // 2026-10-22：设的供应商现在用不了（停用 / 没凭证 / 不存在）就直接拒绝并说原因，不存——
      // 以前照存，之后每次聊天悄悄回退全局默认，前端还显示「换好了」
      if (val && typeof deps.providerUnusableReason === 'function') {
        const why = deps.providerUnusableReason(val);
        if (why) return reply.code(400).send({ error: why, model_provider_id: val, code: 'bad_request' });
      }
      const saved = deps.saveSessionModelProviderOverride(sessionId, val);
      let modelName = null;
      if (typeof body.model_name === 'string' && body.model_name.trim()) modelName = body.model_name.trim();
      const savedModel = deps.saveSessionModelNameOverride(sessionId, modelName);
      reply.send({ ok: true, session_id: sessionId, model_provider_id: val, model_name: modelName, saved: saved });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/model-provider] error:', err.message);
      fail500(reply, err);
    }
  });

  /* 位置:routes/chat.js·GET/POST /v1/sessions/:id/claude-cache 名称:Claude加强缓存 需求:头像菜单只在 Claude 会话显示；默认 5 分钟缓存，打开后断点改 1 小时 注释时间:2026-11-04 */
  app.get('/v1/sessions/:id/claude-cache', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      reply.send({ session_id: sessionId, long: (typeof deps.readClaudeCache1h === 'function') ? !!deps.readClaudeCache1h(sessionId) : false });
    } catch (err) { fail500(reply, err); }
  });
  app.post('/v1/sessions/:id/claude-cache', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId || sessionId.replace(/[^A-Za-z0-9_-]/g, '') !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const on = deps.saveClaudeCache1h(sessionId, body.long === true);
      reply.send({ ok: true, session_id: sessionId, long: on });
    } catch (err) { fail500(reply, err); }
  });

  /* 位置:routes/chat.js·GET/POST /v1/sessions/:id/claude-thinking 名称:Claude思考档位 需求:头像菜单只在 Claude 会话显示默认/低/中/高；off=不发 effort（5.x 上游自身仍可能内置思考，返回块照回传） 注释时间:2026-10-28 */
  app.get('/v1/sessions/:id/claude-thinking', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const effort = (typeof deps.readClaudeThinkingEffort === 'function') ? deps.readClaudeThinkingEffort(sessionId) : null;
      reply.send({ session_id: sessionId, effort: effort || 'off' });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/claude-thinking] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/claude-thinking', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const raw = String(body.effort || 'off').trim().toLowerCase();
      if (['off', 'low', 'medium', 'high'].indexOf(raw) < 0) return reply.code(400).send({ error: 'effort 只支持 off/low/medium/high', code: 'invalid_enum' });
      const saved = deps.saveClaudeThinkingEffort(sessionId, raw === 'off' ? null : raw);
      reply.send({ ok: true, session_id: safe, effort: saved || 'off' });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/claude-thinking] error:', err.message);
      fail500(reply, err);
    }
  });

  /* 位置:routes/chat.js·GET/POST /v1/sessions/:id/grok-thinking 名称:Grok思考档位 需求:头像菜单只在实际模型是 grok-4.x 时显示默认/低/中/高/极高；off=不发参数（厂商默认 high，不能关思考） 注释时间:2026-11-16 */
  app.get('/v1/sessions/:id/grok-thinking', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const effort = (typeof deps.readGrokThinkingEffort === 'function') ? deps.readGrokThinkingEffort(sessionId) : null;
      reply.send({ session_id: sessionId, effort: effort || 'off' });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/grok-thinking] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/grok-thinking', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const raw = String(body.effort || 'off').trim().toLowerCase();
      if (['off', 'low', 'medium', 'high', 'xhigh'].indexOf(raw) < 0) return reply.code(400).send({ error: 'effort 只支持 off/low/medium/high/xhigh', code: 'invalid_enum' });
      if (typeof deps.saveGrokThinkingEffort !== 'function') return reply.code(500).send({ error: '保存入口未接上', code: 'not_wired' });
      const saved = deps.saveGrokThinkingEffort(sessionId, raw === 'off' ? null : raw);
      reply.send({ ok: true, session_id: safe, effort: saved || 'off' });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/grok-thinking] error:', err.message);
      fail500(reply, err);
    }
  });

  /* 位置:routes/chat.js·GET/POST /v1/sessions/:id/glm-thinking 名称:GLM历史思考开关 需求:头像菜单只在 GLM 会话显示历史思考开关；默认开（回传），关=出口剥历史思考 注释时间:2026-11-15 */
  app.get('/v1/sessions/:id/glm-thinking', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const drop = (typeof deps.readGlmDropHistReasoning === 'function') ? deps.readGlmDropHistReasoning(sessionId) : false;
      reply.send({ session_id: sessionId, send_hist_reasoning: !drop });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/glm-thinking] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/glm-thinking', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const sendHist = body.send_hist_reasoning !== false;
      const drop = !sendHist;
      if (typeof deps.saveGlmDropHistReasoning === 'function') deps.saveGlmDropHistReasoning(sessionId, drop);
      reply.send({ ok: true, session_id: safe, send_hist_reasoning: sendHist });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/glm-thinking] error:', err.message);
      fail500(reply, err);
    }
  });

  // 1025：会话级时间缀开关——她的消息末尾 <current_time> 是否发给模型。
  // GET：{ time_tag_to_ai: true|false|null, follow_global }（null=跟随全局）
  // POST：{ time_tag_to_ai: true|false|null }，存 session_cfg；开关影响快照里固化的历史消息 →
  //       存完清该会话 v2 快照（与手动重建同口径），下轮请求懒生成全新。
  app.get('/v1/sessions/:id/time-tag-to-ai', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const override = deps.sessionTimeTagOverride(sessionId);
      // 11-04：多带 effective（实际生效值）和 global（全局默认）——头像菜单改成开关，要显示实际状态，切到与全局默认相同时回到「跟随默认」
      reply.send({ session_id: sessionId, time_tag_to_ai: override, follow_global: override === null, effective: !!deps.resolveTimeTagToAi(sessionId), global: !!deps.resolveTimeTagToAi('__global__') });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/time-tag-to-ai] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/time-tag-to-ai', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const val = (typeof body.time_tag_to_ai === 'boolean') ? body.time_tag_to_ai : null;
      const saved = deps.saveSessionTimeTagOverride(sessionId, val);
      try {
        const sv2 = require('../context/context-snapshot-v2');
        sv2.deleteSnapshot(baseDir, safe);
        sv2.clearStale(baseDir, safe);
      } catch (e) { console.warn('[time-tag-to-ai] 清快照失败:', e.message); }
      // 1025：不回显 saved（整个 session_cfg，含 mcp_on/mcp_seen 大工具清单，几 KB 白传）；前端只用 follow_global
      reply.send({ ok: true, session_id: safe, time_tag_to_ai: val, follow_global: val === null });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/time-tag-to-ai] error:', err.message);
      fail500(reply, err);
    }
  });

  /* [位置:routes/chat.js·/v1/sessions/:id/strip-trace] [会话级 trace 剥离开关] [11-21：开=发给 AI 前剥掉历史 assistant 消息里的 <trace>（仅前端显示）；关=保留发给 AI（默认）。切换会影响快照里的历史消息，清快照让下一轮自动重建] [注释时间 2026-11-21] */
  app.get('/v1/sessions/:id/strip-trace', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const strip = typeof deps.readStripTraceToAi === 'function' ? !!deps.readStripTraceToAi(sessionId) : false;
      reply.send({ session_id: sessionId, strip_trace: strip });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/strip-trace] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/strip-trace', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const strip = body.strip_trace === true;
      if (typeof deps.saveStripTraceToAi === 'function') deps.saveStripTraceToAi(sessionId, strip);
      try {
        const sv2 = require('../context/context-snapshot-v2');
        sv2.deleteSnapshot(baseDir, safe);
        sv2.clearStale(baseDir, safe);
      } catch (e) { console.warn('[strip-trace] 清快照失败:', e.message); }
      reply.send({ ok: true, session_id: safe, strip_trace: strip });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/strip-trace] error:', err.message);
      fail500(reply, err);
    }
  });

  // 10-29（用户 #49）：会话级 [elapsed] 标签开关。三改回动态注入：tag 只在发送出口加、不落盘，
  // 开关切了下一轮请求生效，历史消息不受影响；不碰快照 → 切换不清快照。
  // 10-29 拍板：两个时间开关各用各的方便——时间缀全量（切换清快照整体重建）、elapsed 动态注入（不动）。
  // GET：{ elapsed_tag_to_ai: true|false|null, follow_global }；POST：{ elapsed_tag_to_ai: true|false|null }，null=跟随全局（全局默认开）
  app.get('/v1/sessions/:id/elapsed-tag', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      const override = deps.sessionElapsedTagOverride(sessionId);
      reply.send({ session_id: sessionId, elapsed_tag_to_ai: override, follow_global: override === null, effective: !!deps.resolveElapsedTagToAi(sessionId), global: !!deps.resolveElapsedTagToAi('__global__') });
    } catch (err) {
      console.error('[GET /v1/sessions/:id/elapsed-tag] error:', err.message);
      fail500(reply, err);
    }
  });
  app.post('/v1/sessions/:id/elapsed-tag', async (req, reply) => {
    try {
      const sessionId = String(req.params.id || '').trim();
      if (!sessionId) return reply.code(400).send({ error: '会话ID不能为空', code: 'session_id_required' });
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '');
      if (safe !== sessionId) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const val = (typeof body.elapsed_tag_to_ai === 'boolean') ? body.elapsed_tag_to_ai : null;
      deps.saveSessionElapsedTagOverride(sessionId, val);
      reply.send({ ok: true, session_id: safe, elapsed_tag_to_ai: val, follow_global: val === null });
    } catch (err) {
      console.error('[POST /v1/sessions/:id/elapsed-tag] error:', err.message);
      fail500(reply, err);
    }
  });

  // 实时事件流（SSE）：聊天页用 EventSource 订阅本会话，收到 history_update 后拉一次历史。
  app.get('/v1/events', async (req, reply) => {
    const sessionId = normSid(req.query.session_id || req.headers['x-session-id']) || 'default';
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    reply.raw.write('retry: 3000\n\n');
    reply.raw.write('data: ' + JSON.stringify({ type: 'hello', session_id: sessionId, at: Date.now() }) + '\n\n');

    sseSubscribe(sessionId, reply);
    /* [位置:routes/chat.js·/v1/events 心跳] [断线要真关连接] [11-14 审查 C 批 d：心跳写失败只停定时器 + 摘订阅，没 reply.raw.end()，死连接靠 req.raw 的 close 兜底；而且对已销毁的 socket 调 write 不一定抛错，原来的 catch 形同虚设。现在心跳前先看 destroyed/writableEnded，异常或断开都走同一个 stop（幂等：停心跳 + 摘订阅 + 关连接）] [注释时间 2026-11-14] */
    let heartbeat = null;
    const stopHeartbeat = () => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      try { sseUnsubscribe(sessionId, reply); } catch (e) {}
      try { if (!reply.raw.writableEnded) reply.raw.end(); } catch (e) {}
    };
    heartbeat = setInterval(() => {
      if (reply.raw.destroyed || reply.raw.writableEnded) { stopHeartbeat(); return; }
      try { reply.raw.write(': ping\n\n'); } catch (e) { stopHeartbeat(); }
    }, SSE_HEARTBEAT_MS);
    try { reply.raw.on('error', stopHeartbeat); } catch (e) {}
    req.raw.on('close', stopHeartbeat);
  });

  /* [位置:routes/chat.js·/v1/timeline/versions · version/switch · version/delete] [同会话版本：查 / 切换 / 删一个版本] [11-10：重新生成与编辑后重新生成把旧内容存成版本（数据在 lib/timeline-versions.js，存档动作在 server.js appendRequestMessages 步骤 0）；这里提供：GET 摘要（哪些用户消息有几个版本、当前第几个）、POST 切换（整段尾巴 + 用户内容对调）、POST 删版本。切换 / 删当前版本会改时间线：生成中拒绝；锚点所在或之后有压缩块拒绝；时间线落盘成功才写版本文件；改完按锚点处理快照并推 SSE] [注释时间 2026-11-10] */
  const VER_SID_OK = /^[A-Za-z0-9_-]+$/;
  function isGeneratingSession(sid) {
    for (const [k, v] of activeChatRequests) { if (v && !v.controller.signal.aborted && String(k).split('\u0000')[0] === sid) return true; }
    return false;
  }
  // 公共：校验 → 算出要换上去的 {content, tail} → 时间线落盘 → 写版本文件 → 快照 / SSE。op(store, live) 返回 {content, tail} 或 null
  function runVersionOp(sid, anchorId, op) {
    const timeline = loadTimeline(sid);
    const ai = timeline.findIndex(m => m && m.id === anchorId);
    if (ai < 0 || timeline[ai].role !== 'user') return { code: 404, error: '找不到这条消息' };
    const ranges = contextReplacements.locateEnabledRanges ? contextReplacements.locateEnabledRanges(sid, timeline) : [];
    if (ranges.some(r => !r.hidden && r.e >= ai)) return { code: 400, error: '这条消息所在或之后有已压缩的内容，不能切换版本（先停用该压缩块再试）' };
    const store = timelineVersions.load(baseDir, sid);
    const out = op(store, { content: timeline[ai].content, tail: timeline.slice(ai + 1) });
    if (!out) return { code: 400, error: '没有这个版本' };
    const next = timelineVersions.composeTimeline(timeline, ai, out.content, out.tail);
    if (saveTimeline(next, sid) === false) return { code: 500, error: '时间线写入被拒，这次没有切换' };
    timelineVersions.save(baseDir, sid, store);
    try { deps.handleSnapshotAfterTailCut(sid, next, ai); } catch (e) { console.warn('[timeline-versions] 切换后快照处理失败:', e && e.message); }
    sseNotify(sid);
    const e = store[anchorId];
    return { ok: true, count: e ? e.slots.length : 1, cur: e ? e.cur : 0 };
  }
  function versionReqCheck(req, reply) {
    if ((req.headers['x-client'] || '').trim() !== 'dylan-chat') { reply.code(403).send({ error: 'forbidden', code: 'forbidden' }); return null; }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const sid = normSid(body.session_id);
    const anchorId = String(body.anchor_id || '').trim();
    const index = Number(body.index);
    if (!VER_SID_OK.test(sid) || !anchorId || !Number.isInteger(index) || index < 0) { reply.code(400).send({ error: '参数不对', code: 'bad_params' }); return null; }
    if (isGeneratingSession(sid)) { reply.code(409).send({ error: '他还在回，等这一条结束', code: 'busy' }); return null; }
    return { sid, anchorId, index };
  }
  app.get('/v1/timeline/versions', async (req, reply) => {
    try {
      const sid = String((req.query && req.query.session_id) || '').trim();
      if (!VER_SID_OK.test(sid)) return reply.code(400).send({ error: '非法会话ID', code: 'invalid_session_id' });
      const store = timelineVersions.load(baseDir, sid);
      if (!Object.keys(store).length) return reply.send({ ok: true, versions: {} });
      const ids = new Set(loadTimeline(sid).map(m => m && m.id).filter(Boolean));
      reply.send({ ok: true, versions: timelineVersions.summary(store, ids) });
    } catch (err) {
      console.error('[GET /v1/timeline/versions] error:', err.message);
      reply.code(500).send({ error: '读取版本失败', code: 'version_read_failed' });
    }
  });
  function versionCodeOf(status) { return ({ 400: 'bad_request', 403: 'forbidden', 404: 'version_not_found', 409: 'busy' })[status] || 'error'; }
  app.post('/v1/timeline/version/switch', async (req, reply) => {
    try {
      const p = versionReqCheck(req, reply); if (!p) return;
      const r = runVersionOp(p.sid, p.anchorId, (store, live) => timelineVersions.switchTo(store, p.anchorId, p.index, live));
      if (!r.ok) return reply.code(r.code).send({ error: r.error, code: versionCodeOf(r.code) });
      console.log('[timeline-versions] 切换 session=' + p.sid + ' anchor=' + p.anchorId.slice(0, 8) + ' → ' + (p.index + 1) + '/' + r.count);
      reply.send({ ok: true, count: r.count, cur: r.cur });
    } catch (err) {
      console.error('[POST /v1/timeline/version/switch] error:', err.message);
      reply.code(500).send({ error: '切换失败', code: 'switch_failed' });
    }
  });
  app.post('/v1/timeline/version/delete', async (req, reply) => {
    try {
      const p = versionReqCheck(req, reply); if (!p) return;
      const store0 = timelineVersions.load(baseDir, p.sid);
      const e0 = store0[p.anchorId];
      if (!e0 || p.index >= e0.slots.length) return reply.code(404).send({ error: '没有这个版本', code: 'version_not_found' });
      if (p.index !== e0.cur) {   // 删的不是当前版本：时间线不动，只改版本文件
        timelineVersions.removeSlot(store0, p.anchorId, p.index);
        timelineVersions.save(baseDir, p.sid, store0);
        const e1 = store0[p.anchorId];
        return reply.send({ ok: true, count: e1 ? e1.slots.length : 1, cur: e1 ? e1.cur : 0 });
      }
      // 删的是当前版本：先切到相邻版本，再把它删掉
      const nb = p.index > 0 ? p.index - 1 : p.index + 1;
      const r = runVersionOp(p.sid, p.anchorId, (store, live) => {
        const out = timelineVersions.switchTo(store, p.anchorId, nb, live);
        if (out) timelineVersions.removeSlot(store, p.anchorId, p.index);
        return out;
      });
      if (!r.ok) return reply.code(r.code).send({ error: r.error, code: versionCodeOf(r.code) });
      reply.send({ ok: true, count: r.count, cur: r.cur });
    } catch (err) {
      console.error('[POST /v1/timeline/version/delete] error:', err.message);
      reply.code(500).send({ error: '删除版本失败', code: 'version_delete_failed' });
    }
  });

  // 本地编辑/删除同步：聊天页「编辑 / 删除消息」目前只改本机 localStorage，
  // 真正写回服务端时间线要靠下一次发消息的全量重建。这里补一个轻量端点。
  // 双分支（兼容）：body.ops 是 diff 操作（新增，走 patch 定点、position 稳定）；
  //               body.messages 是旧整份（保留，靠 buildTimeline 全量，编辑/删除生效但会重排 position）。
  app.post('/v1/timeline/sync', async (req, reply) => {
    try {
      const body = req.body || {};
      const isClientChat = (req.headers['x-client'] || '').trim() === 'dylan-chat';
      if (!isClientChat) return reply.code(403).send({ error: 'forbidden', code: 'forbidden' });
      const sessionId = normSid(body.session_id || req.headers['x-session-id']);
      // 新 diff 分支：body.ops = [{op:'edit',id,newContent} | {op:'delete',id}]，按 id 定点，不重排
      if (Array.isArray(body.ops)) {
        /* [位置:routes/chat.js·/v1/timeline/sync ops 边界] [批量写入先限规模与类型] [11-14 审查 B 批 c：原来 ops 不限条数、newContent 不限类型不限长度直接落盘，每个 op 还要对全时间线 findIndex（O(n×m)）；鉴权只看 X-Client 头（前端硬编码可伪造）+ 全局 key，等于对写接口开放。现在限 500 条、id 限长、newContent 必须是字符串且限 20 万字，超限 400] [注释时间 2026-11-14] */
        if (body.ops.length > 500) return reply.code(400).send({ error: '一次最多 500 条操作', code: 'too_many_ops' });
        for (const op of body.ops) {
          if (!op || typeof op !== 'object') return reply.code(400).send({ error: 'ops 里每一条都要是对象', code: 'invalid_op' });
          if (op.id != null && String(op.id).length > 200) return reply.code(400).send({ error: 'op.id 太长', code: 'invalid_op_id' });
          if (op.newContent != null && (typeof op.newContent !== 'string' || op.newContent.length > 200000)) return reply.code(400).send({ error: 'newContent 必须是不超过 20 万字的文本', code: 'invalid_content' });
        }
        let ok = 0, miss = 0, del = 0, editedIds = [], deletedIds = [];
        // 批量：一次 load+save，避免多选删除大段时逐 op 各读写盘一次
        const timeline = loadTimeline(sessionId);
        // 2026-10-08 方案A：压缩块区间内禁改 + 编辑/删除改「截断」而非全量重建
        const sv2 = require("../context/context-snapshot-v2");
        const _snap = sv2.loadSnapshot(baseDir, sessionId);
        const snapPoint = (_snap && Array.isArray(_snap.content) && Number.isFinite(_snap.snap_point)) ? Number(_snap.snap_point) : null;
        const ranges = (contextReplacements.locateEnabledRanges ? contextReplacements.locateEnabledRanges(sessionId, timeline) : []);
        // 预检：任一 op 落在可见压缩块区间 → 整批拒绝（不落盘）
        const rejected = [];
        for (const op of body.ops) {
          if (!op || !op.id) continue;
          const idx = timeline.findIndex(m => m && m.id === op.id);
          if (idx < 0) continue;
          for (const r of ranges) {
            if (r.hidden) continue;
            if (idx >= r.s && idx <= r.e) { rejected.push({ id: op.id, idx: idx }); break; }
          }
        }
        if (rejected.length) {
          console.warn("[timeline-sync] 压缩块区间内禁止编辑/删除，整批拒绝 (session=" + (sessionId || 'default') + ", " + rejected.length + "条)");
          /* [位置:routes/chat.js·timeline-sync 拒改] [压缩块区间禁改改 HTTP 409] [11-14 审查 B 批收尾：原先 ok:false 但 HTTP 200，前端要靠 d.ok===false 单独判，与全站「错误走 HTTP 状态码 + {error, code}」的口径不一致；改 409 + code=compaction_locked，rejected 数组保留（前端要标是哪几条被拦）] [注释时间 2026-11-14] */
          return reply.code(409).send({ error: "压缩块区间内的消息不能编辑或删除（先停用该压缩块再试）", code: "compaction_locked", rejected: rejected.map(r => r.id), session_id: sessionId || 'default' });
        }
        let changed = false;
        let minContentIdx = null;   // 方案A：content 区被操作的最小 index（截断点候选）
        for (const op of body.ops) {
          if (!op || !op.id) continue;
          const idx = timeline.findIndex(m => m && m.id === op.id);
          if (idx < 0) { miss++; continue; }
          if (op.op === 'edit') {
            const updated = { ...timeline[idx], content: op.newContent, id: op.id };
            // 2026-10-07 1007-04：编辑正文后旧 stream_timeline 不再可信，删除之。
            // 前端 2026-09-25 ⑦ 已约定编辑后丢弃 timeline 走「旧数据合成」，服务端此前漏同步：
            // 只更新 content、stream_timeline 残留流式旧正文 → 重开应用 fetchHistory 拉回
            // content 新 + timeline 旧，气泡渲染读 timeline 显示旧正文、编辑弹窗读 content 显示
            // 新正文（用户误以为编辑没生效）。与服务端渲染口径一致后两者对齐。
            if (Array.isArray(updated.stream_timeline) && updated.stream_timeline.length) delete updated.stream_timeline;
            // 编辑特殊事件（推送回显/唤醒回显）：手动改 content 后，结构化元数据不再可信，
            // 用规范格式重新解析并同步更新字段；解析失败则清除字段退化为普通消息，
            // 避免管理台「推送管理」与聊天显示不一致。
            if (updated.event_type || updated.push_title || updated.push_body) {
              const parsed = parsePushEcho(op.newContent) || parseWakeEcho(op.newContent);
              if (parsed) {
                updated.event_type = (parsed.channel === '未发送') ? 'wake' : 'push';
                updated.push_at = parsed.at || updated.push_at;
                updated.push_user = parsed.user || updated.push_user;
                updated.push_channel = parsed.channel;
                updated.push_title = parsed.title;
                updated.push_body = parsed.body;
                updated.push_tail = parsed.tail;
              } else {
                delete updated.event_type;
                delete updated.push_at; delete updated.push_user; delete updated.push_channel;
                delete updated.push_title; delete updated.push_body; delete updated.push_tail;
              }
            }
            /* [位置:routes/chat.js·timeline-sync edit·trace] [编辑后 trace 同步] [11-08「编辑窗里得看原始标签」牵涉项：编辑保存不经 appendMessages 的提取钩子，msg.trace 与 trace_notes 会停在旧值。照上面推送回显的既有惯例（元数据不再可信→重新解析同步）：新正文含 <trace> → keepBody 重挂（不动正文）+ 按 msg_id 更新记录库；新不含但原含 → 她删了标签，清字段+删记录（气泡消失）；两边都不含（旧消息正文落盘时剥过）→ 不动，防误删旧气泡] [注释时间 2026-11-08] */
            if (updated.role === 'assistant') {
              try {
                const _oldHasTrace = typeof timeline[idx].content === 'string' && timeline[idx].content.toLowerCase().indexOf('<trace') >= 0;
                const _newHasTrace = typeof op.newContent === 'string' && op.newContent.toLowerCase().indexOf('<trace') >= 0;
                if (_newHasTrace) {
                  if (require('../lib/trace').extractFromMessage(updated, sessionId, true) && updated.trace && updated.trace.content) {
                    try { require('../lib/trace-notes').upsertByMsgId({ content: updated.trace.content, session_id: sessionId, msg_id: updated.id, at: updated.trace.at }); } catch (_) {}
                  }
                } else if (_oldHasTrace) {
                  delete updated.trace;
                  try { require('../lib/trace-notes').removeByMsgId(op.id, sessionId); } catch (_) {}
                }
              } catch (e) { console.warn('[timeline-sync] trace 同步失败:', e && e.message); }
            }
            timeline[idx] = updated;
            ok++;
            editedIds.push(op.id);
            if (snapPoint !== null && idx < snapPoint) minContentIdx = (minContentIdx === null || idx < minContentIdx) ? idx : minContentIdx;
          } else if (op.op === 'delete') {
            timeline.splice(idx, 1);
            del++;
            deletedIds.push(op.id);
            if (snapPoint !== null && idx < snapPoint) minContentIdx = (minContentIdx === null || idx < minContentIdx) ? idx : minContentIdx;
          } else {
            miss++;
            continue;
          }
          changed = true;
        }
        if (changed) {
          const saved = saveTimeline(timeline, sessionId);
          // 2026-10-07 1007-02 P1：saveTimeline 三道写守卫（损坏/快照过期/墓碑）拒写时返回 false，
          // 此前不检查返回值 → 接口照回 ok:true，前端显示「已保存」实际未落盘。拒写时回 ok:false。
          if (!saved) {
            console.error("[timeline-sync] 编辑/删除未落盘：saveTimeline 拒写 (session=" + (sessionId || 'default') + ", 改=" + ok + ", 删=" + del + ")");
            /* [位置:routes/chat.js·timeline-sync 拒写] [写入被拒改 HTTP 409] [11-14 审查 B 批收尾：同上，ok:false 但 HTTP 200 会让前端以为请求层没问题；改 409 + code=timeline_write_rejected，语义=服务端状态冲突（损坏/快照过期/墓碑），本次修改未保存] [注释时间 2026-11-14] */
            return reply.code(409).send({ error: "时间线写入被拒（文件损坏/快照过期/会话墓碑），本次修改未保存", code: "timeline_write_rejected", edited: ok, deleted: del, missed: miss, session_id: sessionId || 'default' });
          }
          // 2026-11-10 版本跟锚点走：删掉的消息若是某组版本的锚点（用户消息），它名下的旧版本一起清掉
          if (deletedIds.length && sessionId) {
            try {
              const _vs = timelineVersions.load(baseDir, sessionId);
              if (timelineVersions.dropAnchors(_vs, deletedIds)) timelineVersions.save(baseDir, sessionId, _vs);
            } catch (e) { console.warn('[timeline-versions] 删消息清版本失败:', e && e.message); }
          }
          // 2026-10-08 方案A：快照处理——编辑/删除落在 content 区时「截断」而非全量重建；
          // 截断点之后仍有 rep 块 → 全量重建（避免摘要丢失）；尾部区操作快照不含 → 无需处理。
          if (snapPoint !== null && minContentIdx !== null) {
            const hasRepAfter = ranges.some(function (r) { return !r.hidden && r.e > minContentIdx; });
            if (hasRepAfter) {
              try { sv2.markStale(baseDir, sessionId, "timeline-edit-truncate-rep"); }
              catch (e) { console.warn("[ctx-snapshot-v2] 编辑标记快照失效失败:", e && e.message); }
            } else {
              const keepIds = [];
              for (let i = 0; i < minContentIdx && i < timeline.length; i++) { const m = timeline[i]; if (m && m.id) keepIds.push(m.id); }
              const okT = sv2.truncateSnapshot(baseDir, sessionId, keepIds, minContentIdx);
              if (okT) console.log("[ctx-snapshot-v2] 快照已截断 session=" + (sessionId || 'default') + " snap_point=" + minContentIdx);
              else console.warn("[ctx-snapshot-v2] 快照截断失败（读取侧自愈兜底） session=" + (sessionId || 'default'));
            }
          }
          // 纯尾部区操作：快照不含尾部消息，无需失效标记（原「编辑即全量 markStale」按方案A废弃）
          sseNotify(sessionId);
        }
        console.log(`[timeline-sync] diff编辑/删除同步 (session=${sessionId || 'default'}, 改=${ok}, 删=${del}, 未命中=${miss}, 编辑ids=${editedIds.length ? editedIds.join(',') : '-'})`);
        return reply.send({ ok: true, edited: ok, deleted: del, missed: miss, session_id: sessionId || 'default' });
      }
      // 旧整份分支（老前端/退化场景）：改「以盘上为基同步请求差量」（2026-09-20 审查 F-2）——
      // 此前整份 buildTimeline 重建会把「客户端列表里没有的服务器新写入」（他端新消息/唤醒事件）
      // 物理删除。appendRequestMessages 语义=人设同步+按 id 去重补齐+重生成清尾：盘上已有的跳过、
      // 缺的补齐；仅请求尾是 user（重生成）才清尾。中部删除不再支持走此分支（diff 分支按 id 定点
      // 删除不受影响）；空 messages 不再把时间线清空。变更时 appendRequestMessages 内部已 sseNotify。
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const syncRes = appendRequestMessages(sessionId, messages);
      const afterTl = loadTimeline(sessionId);
      console.log(`[timeline-sync] 旧整份分支改差量同步 (session=${sessionId || 'default'}, 补齐=${syncRes.appended}, 清尾=${syncRes.removedTail}, 总条数=${afterTl.length})`);
      reply.send({ ok: true, total: afterTl.length, appended: syncRes.appended, removedTail: syncRes.removedTail, session_id: sessionId || 'default' });
    } catch (err) {
      console.error('[timeline-sync] error:', err.message);
      fail500(reply, err);
    }
  });

  // ========================
  // /v1/chat/completions（从 server.js 拆出）
  // ========================
app.post("/v1/chat/completions", async (req, reply) => {
  // 幂等状态跨 try/catch/finally 使用：finally 只释放本请求认领的 pending 占位
  let clientMsgId = "";
  let pendingOwner = null;
  let requestController = null;
  let activeRequestEntry = null;
  let finishActiveRequest = null;
  let snapshotRebuilt = false;  // 1010-27：本轮请求是否触发了快照懒生成（从无到有），用于响应头通知前端弹横幅
  try {
    const body = req.body;
    /* [位置:routes/chat.js·/v1/chat/completions 入参] [请求体与 messages 先校验再往下走] [11-14 审查 C 批 c：原来直接 body.messages → .some/.map，传字符串/对象/null 就 TypeError 冒到 500，同函数的日志却已用 body?.model（说明知道 body 可空）；现在入口收口成 400 + 机器码，不把内部异常抛给客户端] [注释时间 2026-11-14] */
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply.code(400).send({ error: "请求体要是 JSON 对象", code: "invalid_body" });
    if (!Array.isArray(body.messages) || body.messages.length === 0) return reply.code(400).send({ error: "messages 必须是非空数组", code: "invalid_messages" });
    if (body.messages.some(function (m) { return !m || typeof m !== "object" || typeof m.role !== "string"; })) return reply.code(400).send({ error: "messages 里每条都要带 role", code: "invalid_message_item" });
    // 批注 2026-07-15：公开部署时日志不能默认写入完整上下文；
    // 这里只保留请求摘要，避免 system prompt、记忆和聊天正文进入 pm2 日志。
    console.log(JSON.stringify({
      event: "kelivo_request",
      model: body?.model || "",
      stream: body?.stream === true,
      messages: summarizeMessagesForLog(body?.messages || [])
    }));

    const kelivoMessages = body.messages || [];

    // 多会话：识别当前请求来自哪个会话
    let sessionId = normSid(body.session_id || req.headers["x-session-id"]);
    // 让压缩/替换按当前会话时间线工作（onResponse 钩子复位）
    contextReplacements.setActiveSession(sessionId || null);
    req.__ctxWasSet = true;
    // 客户端来源标记：自建前端(chat.html)带 x-client=dylan-chat；第三方客户端(如 Kelivo)不带。
    // 时间线已改为追加式增量写、不再全量覆盖，故放开「必须带 x-client 才写」的门槛：
    // 只要请求通过鉴权且携带真实消息就写时间线，第三方不带该头也能正常写入、供自建前端看到。
    const isClientChat = (req.headers["x-client"] || "").trim() === "dylan-chat";

    // ========================
    // 幂等回放：同一 client_msg_id 的重复请求（如浏览器断连重发）直接回放上次已生成的回复，
    // 不再次调用上游、不重复写时间线。
    // ========================
    clientMsgId = isClientChat ? String(body.client_msg_id || "").trim() : "";
    // 自建前端预生成的本条回复稳定 id（chat.html reply_msg_id）：落盘沿用，保证落库前后端 id 一致，
    // 回复刚落库、SSE 补拉之前的编辑/删除也能被 /v1/timeline/sync 的 diff 分支定点命中。
    // 第三方客户端不带此字段 → null → appendMessages 内部照旧生成 uuid，向后兼容。
    // 注意：本文件的流式/非流式落盘出口仅在 MCP 关闭/循环异常回退时执行，主出口在 server.js MCP 写回段。
    const replyMsgId = (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim())
      ? body.reply_msg_id.trim().slice(0, 64) : null;
    // 2026-09-23（F8）：把「回放已生成结果」抽成局部函数，供两种情形复用——
    //   ① 命中已完成的缓存结果（原有逻辑）；② 等待首轮请求完成之后（新增）。
    const _replayCachedReply = async function (cached) {
      console.log("[idempotency] 命中同 client_msg_id 的已生成回复，直接回放");
      if (body.stream === true) {
        // 2026-09-24 B3（M2）：回放同样下发 final 字段——cached.storedText（含标签，与时间线同源）
        // 专供前端落盘对齐（回放落盘=时间线 → 补拉不再校准）；正文仍用 cached.text（剥标签版，
        // 与实时下行口径一致）。重启前生成的旧缓存无这两个字段 → undefined → buildSSE 不下发
        // → 前端退回自己的映射，向后兼容。
        const stream = mcp.buildSSE(cached.text, { model: body.model || cached.model || "", usage: cached.usage, reasoning: cached.reasoning, toolHistory: cached.tools, finalContent: cached.storedText, finalTimeline: cached.streamTimeline });
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        const reader = stream.getReader();
        try {
          while (true) { const { done, value } = await reader.read(); if (done) break; reply.raw.write(value); }
          reply.raw.end();
        } catch (e) { try { reply.raw.end(); } catch (e) { /* client/stream cleanup */ } }
        return true;
      }
      reply.send({
        id: "chatcmpl-idem",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: cached.model || body.model || "",
        choices: [{ index: 0, message: { role: "assistant", content: cached.text }, finish_reason: "stop" }],
        usage: cached.usage || null
      });
      return true;
    };
    if (clientMsgId) {
      const cached = recentReplies.get(clientMsgId);
      // ① 已有未过期的完整结果 → 直接回放（原逻辑；多一个 !cached.pending 判断以免把占位当结果）
      if (cached && !cached.pending && isRecentReplyCacheable(cached) && (Date.now() - cached.ts) < IDEMPOTENCY_TTL_MS) {
        if (await _replayCachedReply(cached)) return;
      }
      // ② 2026-09-23（F8）：同 client_msg_id 的请求**仍在生成中** → 挂起等待首轮结果再回放。
      //    典型触发：前端网络层失败后 600ms 自动重发（chat.html 的 doFetch catch），而首轮仍在生成——
      //    此时缓存里还没有结果，旧实现会把它当新请求再调一次上游（双份 token，且可能重复落盘）。
      //    改为等待首轮产出后回放，用户无感且不重复烧 token；等待上限见 IDEMPOTENCY_PENDING_WAIT_MS。
      if (cached && cached.pending) {
        console.log("[idempotency] 同 client_msg_id 请求仍在处理中，挂起等待首轮结果（不重复调上游）");
        // 1003-27：等待超时后若首轮占位仍在（首轮还活着）→ 继续等待，不降级重调上游。
        // 修复背景：前端网络失败 600ms 自动重发（同 client_msg_id）+ 首轮长生成（工具循环/上游慢
        // 超过 90s）+ 原实现在等待超时即降级重调 → 首轮连接已断但服务端继续生成并落盘，
        // 双份上游调用产生两个一模一样的回复。只有占位消失（首轮失败/崩溃）或总上限到才降级。
        let waited = await waitPendingReply(clientMsgId, IDEMPOTENCY_PENDING_WAIT_MS);
        if (waited && isRecentReplyCacheable(waited)) {
          if (await _replayCachedReply(waited)) return;
        }
        const waitTotalMs = (typeof IDEMPOTENCY_PENDING_TOTAL_MS === "number" && IDEMPOTENCY_PENDING_TOTAL_MS > 0)
          ? IDEMPOTENCY_PENDING_TOTAL_MS : (IDEMPOTENCY_PENDING_WAIT_MS * 2);
        const deadline = Date.now() + waitTotalMs;
        while (Date.now() < deadline) {
          const cur = recentReplies.get(clientMsgId);
          if (!cur || !cur.pending) break; // 首轮已结束（成功被缓存 / 失败被清占位）
          console.warn("[idempotency] 首轮仍在生成（已等待 " + Math.round((Date.now() - cached.ts) / 1000) +
            "s），继续等待，不降级重调上游");
          waited = await waitPendingReply(clientMsgId, IDEMPOTENCY_PENDING_WAIT_MS);
          if (waited && isRecentReplyCacheable(waited)) {
            if (await _replayCachedReply(waited)) return;
          }
        }
        const finalEntry = recentReplies.get(clientMsgId);
        if (finalEntry && finalEntry.pending) {
          console.warn("[idempotency] 首轮超过 " + Math.round(waitTotalMs / 1000) + "s 仍未完成，保留占位并拒绝重复生成");
          return reply.code(409).send({ error: "同一消息仍在生成，请稍后重试", code: 'busy' });
        }
        console.warn("[idempotency] 首轮未产出可回放结果，本轮尝试认领生成权");
      }
      pendingOwner = beginPendingReply(clientMsgId);
      if (!pendingOwner) {
        const latest = recentReplies.get(clientMsgId);
        if (latest && !latest.pending && isRecentReplyCacheable(latest) && (Date.now() - latest.ts) < IDEMPOTENCY_TTL_MS) {
          if (await _replayCachedReply(latest)) return;
        }
        return reply.code(409).send({ error: "同一消息仍在生成，请稍后重试", code: 'busy' });
      }
    }

    // 只有通过幂等检查、真正取得生成权的请求才能注册为可停止任务；回放请求不能覆盖正在生成的任务。
    requestController = new AbortController();
    const activeKey = sessionId && replyMsgId ? sessionId + "\u0000" + replyMsgId : null;
    activeRequestEntry = {
      key: activeKey, replyMsgId: replyMsgId || '', controller: requestController, cancelled: false,
      finished: new Promise(resolve => { finishActiveRequest = resolve; })
    };
    if (activeKey) activeChatRequests.set(activeKey, activeRequestEntry);
    // [位置:routes/chat.js·noteUser] [通知唤醒闸门「用户刚发了消息」] [批D·27：唤醒要让路，等这一轮聊完并静默一小段再放行] [注释时间 2026-10-22]
    try { require("../lib/wake-gate").noteUser(sessionId || "default"); } catch (e) { /* 只是让路用，失败不影响聊天 */ }
    // MCP 路径通过 req 取得同一个取消信号；直通路径直接使用 requestController。
    req.chatAbortController = requestController;

    const oldTimeline = loadTimeline(sessionId);
    // 主聊天（客户端携带 system 身份提示）才做记忆/跨窗口/特殊事件注入；标题总结等旁路请求保持精简。
    // 2026-09-15 上传瘦身配套：x-client=dylan-chat（自建前端）本身就是主聊天信号——
    // 即使未配置人设（请求里无 system），聊天页请求也要走时间线重建，否则窗口化上传会变成上下文本身。
    // 10-29 #49：计算提前到时间线落盘块之前（逻辑未动）；落盘标注已回退动态注入，位置保留。
    const isMainChat = isClientChat || kelivoMessages.some(function (m) {
      if (!m) return false;
      if (m.role === "system") return true;
      if (m.role === "user" && typeof m.content === "string" && m.content.trim().indexOf("<system>") === 0) return true;
      return false;
    });
    /* [位置:routes/chat.js·_isSubSession] [子会话标记] [2026-11-01：子会话走普通聊天流水线，日记落盘和 <wake> 调度要跳过（标签写副作用在 lib/tag-parser.js 统一按前缀跳过）] [注释时间 2026-11-01] */
    const _isSubSession = /^s_sub_/.test(String(sessionId || ''));

    // 防误伤：携带真实消息(或首次建线)才写时间线。时间线已是追加式增量写、不再全量覆盖历史，
    // 故放宽原先「必须 x-client=dylan-chat 才写」的门槛——第三方客户端(如 Kelivo)不带该头
    // 且已带上真实消息，也能正常写入，供自建前端(chat.html)看到。
    if (kelivoMessages.some(isRealMessageForTimeline) || oldTimeline.length === 0) {
      // 2026-10-08 方案A：重生成锚点位于压缩块区间内 → 拒绝（区间内消息禁止重新生成）
      if (body.regen_anchor_id) {
        try {
          const _ranges = (contextReplacements.locateEnabledRanges ? contextReplacements.locateEnabledRanges(sessionId, oldTimeline) : []);
          const _ai = oldTimeline.findIndex(m => m && m.id === String(body.regen_anchor_id).trim());
          const inRange = _ai >= 0 && _ranges.some(function (r) { return !r.hidden && _ai >= r.s && _ai <= r.e; });
          if (inRange) {
            console.warn("[timeline] 重生成锚点位于压缩块区间内，拒绝 session=" + (sessionId || 'default') + " idx=" + _ai);
            return reply.code(400).send({ error: "该消息位于已压缩区间，不能重新生成（先停用该压缩块再试）", code: 'compressed_range' });
          }
        } catch (e) { /* client/stream cleanup */ }
      }
      // 方案二增量：落盘改为以盘上为基同步差量（新消息补齐/人设同步/重生成清尾），
      // 不再拿请求全量重建覆盖；通知由同步函数按需发出。
      // 2026-09-23：透传重生成锚点 id（前端「重新生成」时上报），服务端按 id 截断锚点 user 之后的全部内容
      /* [位置:routes/chat.js·regen 透传] [regen_version / regen_edit_content] [11-10：regen_version 真 = 前端显式「重新生成」或「编辑后重新生成」，截断前存版本；regen_edit_content = 编辑后的用户消息新内容（非空字符串或数组），随同一次请求换到锚点上；不带 regen_version 时 regen_edit_content 一律忽略（失败重试不存版本、也不改内容）] [注释时间 2026-11-10] */
      const _rv = !!body.regen_version && !!body.regen_anchor_id;
      let _re = null;
      if (_rv && body.regen_edit_content !== undefined && body.regen_edit_content !== null) {
        const _c = body.regen_edit_content;
        if ((typeof _c === 'string' && _c.trim()) || (Array.isArray(_c) && _c.length)) _re = _c;
        else return reply.code(400).send({ error: '编辑后的内容不能是空的', code: 'empty_content' });
      }
      appendRequestMessages(sessionId, kelivoMessages, { regenAnchorId: body.regen_anchor_id, regenVersion: _rv, regenEdit: _re });
      // 用户主动聊天 → 取消 AI 之前设的定时唤醒（keep=true 的闹钟除外，2026-09-26）
      try { wakeSchedule.clearSlotUnlessKeep(sessionId); } catch (e) { console.error('[chat.js:1237]', e.message || e); }
    } else {
      console.log("[timeline] 跳过时间线保存 (真实消息=" + kelivoMessages.some(isRealMessageForTimeline) + ")");
    }

    // 非主聊天（标题总结等旁路请求）的直通底稿；主聊天在下方由统一对话构建器重建覆盖
    let llmMessages = kelivoMessages
      .map(prepareMessageForLLM)
      .filter(Boolean);
    // 统一模型解析提前：图片转写要先知道本轮聊天模型是否被标为“直接看图”
    const { provider: chatProvider, model: chatModel } = deps.resolveChatModel(sessionId, body.model);
    if (chatModel) body.model = chatModel;
    let imageDescResult = null;

    // ========================
    // 统一对话构建器（2026-09-15 批3核心）：聊天与唤醒同源同前缀。
    // 服务端从时间线重建上下文（role 法全量：日记/历史[唤醒]块/工具记录齐全）；
    // 客户端窗口仅用于上方增量同步（appendRequestMessages），不再作为上下文底稿。
    // 非主聊天（标题总结等旁路请求）保持客户端直通，不注入完整上下文。
    // ========================
    if (isMainChat) {
      /* [位置:routes/chat.js·ensureTurnDescriptions] [新图自动转写] [10-27：不能看图的模型也要知道图片内容；只处理本轮末尾 user 消息的新图，结果按图片地址存进 image_desc，同一张图后续不再转写；模型被标为直接看图时跳过] [注释时间 2026-10-27] */
      try {
        imageDescResult = await imageDesc.ensureTurnDescriptions({
          baseDir, sessionId, provider: chatProvider, model: chatModel,
          requestMessages: kelivoMessages,
          loadTimeline, saveTimeline, normalizeContentToText,
          snapshotV2: Object.assign(require('../context/context-snapshot-v2'), { baseDir })
        });
      } catch (e) {
        console.warn('[image-desc] 本轮图片转写失败（聊天继续，图片按原链路发送）：' + (e && e.message ? e.message : e));
      }
      // 1010 需求2：主聊天请求 → 记录「最后一次聊天的会话」（继承源判定用，服务端语义，不依赖前端）
      try {
        const _cnt = loadTimeline(sessionId).filter(isRealMessageForTimeline).length;
        /* [位置:routes/chat.js·chatRequestLog 跳过子会话] [子智能体的聊天不算「上一个会话」] [10-27 第 12 项：子智能体改走普通聊天流水线后，它的请求会被记成「最后聊的会话」，新建会话「承接上一个会话」就会误接到子会话上；s_sub_ 会话不记] [注释时间 2026-10-27] */
        if (!/^s_sub_/.test(String(sessionId || ""))) createChatRequestLog(baseDir).record(sessionId, _cnt);
      } catch (e) { /* 记录失败不影响聊天 */ }
      // S4 修复：服务端时间线重建必须先于一切上下文加工（0919 静态测试抓出漏行）
      // 1010-27：快照懒生成成功检测（buildConversation 前无或失效、后有效 = 本轮新建/重建）
      const _sv2 = require("../context/context-snapshot-v2");
      /* [位置:routes/chat.js·模型/工具变更自动重建快照] [11-21：切模型/供应商或工具定义变化本身必然导致上游 Prompt Cache 零命中，发请求前比对 model_key 与 tools_fp，有变化就顺手 markStale 让本轮 buildConversation 自动整份重建快照；存量老快照无这两个字段时首次先补记、不误触发重建] [注释时间 2026-11-21] */
      const _curModelKey = String((chatProvider && chatProvider.id) || "") + "|" + String(chatModel || "");
      let _curToolsFp = "";
      try {
        if (MCP_ENABLED() && typeof getMcpClients === "function") {
          const _curTools = await mcp.getToolsForSession(_sv2, baseDir, sessionId, getMcpClients());
          _curToolsFp = _sv2.toolsFpOf(_curTools || []);
        } else {
          _curToolsFp = "off";
        }
      } catch (e) { _curToolsFp = ""; }
      try {
        const _preSnap = _sv2.loadSnapshot(baseDir, sessionId);
        if (_preSnap && !_sv2.isStale(baseDir, sessionId)) {
          if (_preSnap.model_key && _curModelKey && _preSnap.model_key !== _curModelKey) {
            _sv2.markStale(baseDir, sessionId, "model-changed");
            console.log("[ctx-snapshot-v2] 检测到切换模型(" + _preSnap.model_key + " -> " + _curModelKey + ")，自动重建快照 session=" + sessionId);
          } else if (_preSnap.tools_fp && _curToolsFp && _preSnap.tools_fp !== _curToolsFp) {
            _sv2.markStale(baseDir, sessionId, "tools-changed");
            console.log("[ctx-snapshot-v2] 检测到工具定义变化(" + _preSnap.tools_fp + " -> " + _curToolsFp + ")，自动重建快照 session=" + sessionId);
          }
        }
      } catch (e) {}
      const _hadSnap = _sv2.hasSnapshot(baseDir, sessionId);
      const _wasStale = _hadSnap && _sv2.isStale(baseDir, sessionId);
      llmMessages = buildConversation(sessionId);
      // 写回当前 model_key 与 tools_fp（供下一轮比对；存量老快照首次顺手补记）
      try {
        const _postSnap = _sv2.loadSnapshot(baseDir, sessionId);
        if (_postSnap) {
          let _metaDirty = false;
          if (_curModelKey && _postSnap.model_key !== _curModelKey) { _postSnap.model_key = _curModelKey; _metaDirty = true; }
          if (_curToolsFp && _postSnap.tools_fp !== _curToolsFp) { _postSnap.tools_fp = _curToolsFp; _metaDirty = true; }
          if (_metaDirty) _sv2.saveSnapshot(baseDir, sessionId, _postSnap);
        }
      } catch (e) {}
      // 1025：时间缀开关——关 = 发给模型的 user 消息剥 <current_time>（在 V2 组装前剥，
      // relevant_memories 的检索 query 也随之干净；时间线/唤醒调度（msg.time）/压缩账本不受影响）
      if (!deps.resolveTimeTagToAi(sessionId)) deps.stripTimeTagsFromMessages(llmMessages);
      // 2026-11-21：trace 剥离开关——开 = 发给模型的 assistant 消息剥 <trace>（前端照常显示、时间线原样保留）
      if (typeof deps.readStripTraceToAi === 'function' && deps.readStripTraceToAi(sessionId) && typeof deps.stripTraceFromMessages === 'function') {
        deps.stripTraceFromMessages(llmMessages);
      }
      try { snapshotRebuilt = (!_hadSnap || _wasStale) && _sv2.hasSnapshot(baseDir, sessionId) && !_sv2.isStale(baseDir, sessionId); } catch (e) { snapshotRebuilt = false; }
      // 开关在请求开始时快照读取（17.txt：防切换瞬间半新半旧）
      const v2Cfg = await fsp.readJson(path.join(baseDir, 'data', 'memory_v2_config.json')).catch(() => ({}));
      if (v2Cfg && v2Cfg.ctx_v2_enabled === true) {
        // ---- S4 正式上下文（0919 用户拍板；0920 起与唤醒共用同一 assembleAndApply 入口）----
        // V2 块替换旧两块 + Relevant 插尾 + 记忆浮现写入；回滚 = ctx_v2_enabled 置 false。
        try {
          const r = await ctxV2Runtime.assembleAndApply({
            baseDir: baseDir,
            sessionId: sessionId,
            messages: llmMessages,
            loadTimeline: loadTimeline,
            normalizeContentToText: normalizeContentToText,
          });
          llmMessages = r.messages;
          // 1010-30 阶段4a：V2 块回填逻辑删除——注入块已由 assembleAndApply 直接并入 v2 快照
          //（fixed_blocks + 派生 v2_blocks），无需装配后再补写。
          // 记忆浮现：命中的记忆原样写入时间线永久在场（hidden 前端不显示；清单防重复由 builder excludeIds 保证）
          if (r.relevantHits && r.relevantHits.length) {
            const n = ctxV2Runtime.floatMemoriesToTimeline({ appendMessages, sessionId, mems: r.relevantHits, baseDir });
            if (n) console.log('[ctx-v2] 本轮记忆浮现', n, '条');
          }
        } catch (e) { console.error('[ctx-v2] 切换层失败，回退旧上下文（不影响主聊天）:', e && e.message); }
      }
    }

    // 内容->时间 映射：容量提醒建议段反查时间用。2026-09-15 上传瘦身配套：改从服务端时间线构建
    // （此前按客户端全量请求构建，窗口化后老消息的时间锚会丢；与唤醒侧同口径）。
    const timeByKey = new Map();
    try {
      for (const tm of loadTimeline(sessionId)) {
        if (!tm || tm.role === "system" || isSpecialEvent(tm)) continue;
        const key = tm.role + "\u0000" + normalizeContentToText(tm.content);
        // 1025：开关关时消息正文剥了 <current_time>，反查表同时放原始/剥后两个 key，两种形态都能命中
        const keyStripped = tm.role + "\u0000" + String(normalizeContentToText(tm.content) || "").replace(/\n?<current_time>[\s\S]*?<\/current_time>/gi, "").replace(/\s+$/, "");
        const t = extractTimestampWithMemory(tm);
        if (t) { if (!timeByKey.has(key)) timeByKey.set(key, t); if (keyStripped !== key && !timeByKey.has(keyStripped)) timeByKey.set(keyStripped, t); }
      }
    } catch (e) { /* 反查表失败不阻断，提醒退化为无时间锚 */ }



    /* [位置:routes/chat.js·历史图分流] [历史图按模型看图能力分流] [11-08 拍板：构建器/缓存/快照存原始图块，出口分流——能看图=历史图保真（出口 decorate 注图片 id，不塞转写）；不能看图=历史图降级为带 id 占位（有转写附转写），当轮图块不降级、仍由 annotateCurrentImages 追加转写。分流必须在 prepareModelMessages 的 sanitize 前（白名单剥 image_desc）] [注释时间 2026-11-08；原 10-27 的「不看图才处理」合并进这里] */
    let _vision = false;
    if (isMainChat) {
      _vision = modelRouter.modelSupportsVision(chatProvider, chatModel);
      llmMessages = chatCtx.shapeHistoryImagesForModel(llmMessages, { vision: _vision });
      if (!_vision) llmMessages = imageDesc.annotateCurrentImages(llmMessages, imageDescResult && imageDescResult.annotations);
    }

    console.log(JSON.stringify({
      event: "llm_forward_summary",
      messages: summarizeMessagesForLog(llmMessages)
    }));

    // 2026-09-21 审查 H9：repair/replace/guard/convert/sanitize 五步收敛进统一管道
    // prepareModelMessages（与唤醒侧同序），此处不再散装调用。repair 在管道内第一步执行。

    // 统一模型解析（2026-09-08）：已在时间线落盘后提前解析一次，这里沿用同一结果
    const prov = chatProvider;
    const resolvedModel = chatModel;
    if (resolvedModel) body.model = resolvedModel;
    // 采样参数按 provider 配置适配（sampling_override in ai-providers.json）：
    // 供应商级别的采样限制（如 kimi 原生 API 只接受 temperature=1, top_p=0.95）
    // 在 handler 此处统一钳制：下方 MCP 工具循环与直连分支读同一 body，两路同时生效。
    /* [位置:routes/chat.js·全局自定义参数] [设置里「生成定义 → 自定义参数」是全局开关：开着且填了值，自建前端的请求没带的 temperature / top_p / max_tokens 就按设置补上；关着（值为空）一律不传] [原因：小手机前端发消息不带这几个参数，开关在手机上形同虚设；chat.html 自己会带（同一份设置），这里只补没带的，不覆盖；第三方客户端（Kelivo 等）自己管，不补；供应商 sampling_override 在下面最后钳制（kimi 固定值、Claude 订阅整个不传）] [注释时间 2026-10-22] */
    if (isClientChat) {
      try {
        const _gcfg = (JSON.parse(fsp.readFileSync(path.join(baseDir, "config", "chat-settings.json"), "utf-8")) || {}).cfg || {};
        ["temperature", "top_p", "max_tokens"].forEach(function (k) {
          const v = _gcfg[k];
          if (body[k] === undefined && v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))) body[k] = Number(v);
        });
      } catch (e) { /* 读不到设置就当没开自定义参数 */ }
    }
    if (prov && prov.sampling_override) {
      const so = prov.sampling_override;
      // so.xxx === null：这个供应商不接受自定义采样参数（Claude 订阅的新模型直接拒收 temperature/top_p），一律不传，
      // 不管设置里「自定义参数」开没开（2026-10-22 产品确定：同 kimi 一样按供应商处理）
      if (so.temperature === null && body.temperature !== undefined) { delete body.temperature; }
      if (so.top_p === null && body.top_p !== undefined) { delete body.top_p; }
      if (so.temperature !== undefined && so.temperature !== null && body.temperature !== undefined && body.temperature !== so.temperature) {
        console.warn("[chat] provider " + (prov.name || prov.id) + " 采样限制：temperature 钳到 " + so.temperature + "（原值 " + body.temperature + "）");
        body.temperature = so.temperature;
      }
      if (so.top_p !== undefined && so.top_p !== null && body.top_p !== undefined && body.top_p !== so.top_p) {
        body.top_p = so.top_p;
      }
    }
    // 2026-10-28：Claude 思考档位按会话注入。只有真·Claude 链路（isClaudeChat，含 Gemini 订阅排除）生效；
    // off 时显式剥掉 reasoning_effort，保证「关」就是关（第三方客户端手带也不越过会话设置）。
    if (isMainChat && upstreamTarget.isClaudeChat(prov)) {
      const _ct = (typeof deps.readClaudeThinkingEffort === 'function') ? deps.readClaudeThinkingEffort(sessionId) : null;
      if (_ct) body.reasoning_effort = _ct;
      else delete body.reasoning_effort;
    }
    /* [位置:routes/chat.js·Grok 思考档位注入] [Grok 订阅按会话档位写顶层 reasoning_effort] [11-16：只有实际模型是 grok-4.x 才认 reasoning_effort（grok-4.6/4.7 不能关思考，空=不传=厂商默认 high）；xhigh 在 4.5 及以下由 grokEffortFor 夹回 high；与 Claude 的字段分开存，第三方客户端手带的 effort 也按会话设置盖掉] [注释时间 2026-11-16] */
    if (isMainChat && upstreamTarget.isGrokChat(prov)) {
      const _ge = (typeof deps.readGrokThinkingEffort === 'function') ? deps.readGrokThinkingEffort(sessionId) : null;
      const _gv = upstreamTarget.grokEffortFor(body.model, _ge);
      if (_gv) body.reasoning_effort = _gv;
      else delete body.reasoning_effort;
    }

    // Claude 订阅（OAuth）：主链路只会说 OpenAI 兼容协议，交给内部 Anthropic 翻译代理。
    const _ut = upstreamTarget.resolveTarget(prov, readEnvValue, body.model);
    const targetApiUrl = _ut.url;
    const targetApiKey = _ut.key;
    /* 11-04：Claude 加强缓存（会话开关）——只对真·Claude 链路，用请求头告诉代理断点用 1h（2026-11-12 收紧：Gemini 订阅也命中 isAnthropicProxy 但没人读这个头） */
    if (isMainChat && upstreamTarget.isClaudeChat(prov) && _ut.headers && typeof deps.readClaudeCache1h === 'function' && deps.readClaudeCache1h(sessionId)) _ut.headers['x-claude-cache-ttl'] = '1h';
    /* 缓存诊断日志（routes/anthropic-proxy.js·缓存断点日志）靠它区分会话；只给 Anthropic 代理加，不污染其他上游 */
    if (upstreamTarget.isClaudeChat(prov) && _ut.headers) _ut.headers['x-session-id'] = sessionId;
    const targetExtraHeaders = _ut.headers;
    if (!targetApiUrl || !targetApiKey) {
      return reply.code(500).send({ error: "TARGET_API_URL / TARGET_API_KEY 或 AI 供应商未配置", code: 'model_not_configured' });
    }

    const requestedStream = body?.stream === true;

    // 上下文（人设 + V2 组装块 + 历史）由统一对话构建器重建（buildConversation），此处不再重复注入。

    // ========================
    // 对话时记忆浮现 / 时间注入：已随记忆池与摘要体系一起移除
    // ========================

    // 历史图片裁剪已移除（2026-09-08）：图片原样透传，不做任何保留窗口

    // 上下文压缩已统一进「上下文替换」：早期对话块摘要与 AI 记忆现在都是同一种替换记录，
    // 由构建器按消息 id 定位套用（buildIncrementalContext / 快照），旧内容锚点兜底 applyReplacements 已于 1018 退役。

    // 统一加工管道（2026-09-21 审查 H9）：repair→replace→guard→convert→sanitize
    const sanitizedMessages = chatCtx.prepareModelMessages(llmMessages, {
      ctxLimitGuard,
      sessionId,
      timeByKey,
      logPrefix: "[context-replacements]"
    });

    // 1005：非 kind:diary 的 assistant 消息剥掉 [DIARY] 块——日记已由 kind:diary 消息单独保留，避免重复
    for (const _m of sanitizedMessages) {
      if (_m.role !== 'assistant') continue;
      if (typeof _m.content !== 'string') continue;
      if (_m.content.indexOf('[DIARY]') === -1) continue;
      /* [位置:chat.js·非日记消息剥 [DIARY]] [带时间行的日记本体整条放行] [落库格式 （日期 时间 diary）+[DIARY]正文[/DIARY]，发上游前 formatTimelineDiaryForLLM 会追加 · id:xxx（无时间时为 （diary · id:xxx））；sanitize 已丢 kind，只剥标签块会留下孤零零的时间行、正文丢光，而「剥后为空还原原文」的兜底在这里不会触发] [注释时间 2026-10-22；2026-11-25 兼容 · id:xxx] */
      if (/^\s*（(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+)?diary(?:\s*·\s*id:\s*\d+)?）\s*\[DIARY\]/i.test(_m.content)) continue;
      const _diaryOrig = _m.content;
      _m.content = _m.content
        .replace(/\[DIARY\]([\s\S]*?)\[\/DIARY\]/gi, '')
        .replace(/\[DIARY\][\s\S]*$/i, '')
        .replace(/\[DIARY\]|\[\/DIARY\]/gi, '')
        .trim();
      // 2026-10-05 修复（s_mump5y8o_r1dy56 发消息 400）：prepareModelMessages 出口 sanitizeForUpstream
      // 已丢弃 kind 字段，旧版「kind==='diary' 则跳过」判断永远不成立，整条 [DIARY] 日记消息被剥成
      // 空串 → kimi 上游 400 "assistant must not be empty"。
      // 现改为：剥除后为空且原文非空时还原原文——kind:diary 日记本体保留完整 [DIARY] 内容，
      // 夹杂 [DIARY] 块的普通回复剥除后非空，行为不变。
      if (!_m.content && _diaryOrig) _m.content = _diaryOrig;
    }

    // role 出口映射（2026-09-15）：内部 developer 块按供应商 profile 翻译后再发上游
    // （default：developer→system；claude：并顶层 system+tool 裹 user；gemini：assistant→model）。
    const providerProfile = (prov && prov.profile) || 'default';
    /* [位置:routes/chat.js·出口思考开关] [按渠道关历史思考回传] [2026-11-12 GLM订阅：智谱 Coding Plan 保留式思考默认开启，历史思考每轮白占数千~数万字符照计 token；渠道配 drop_hist_reasoning 或会话配 glm_drop_hist_reasoning 时出口剥掉（含 DeepSeek 规则的空串补全），落盘与前端思考显示不动，其他渠道行为不变] [注释时间 2026-11-12；2026-11-15 会话级开关接通] */
    const _sessDropRc = (isMainChat && upstreamTarget.isGlmChat(prov) && typeof deps.readGlmDropHistReasoning === 'function')
      ? deps.readGlmDropHistReasoning(sessionId)
      : false;
    const _wbMessages = isMainChat ? worldbook.injectWorldbook(sanitizedMessages, baseDir, sessionId) : sanitizedMessages;
    const outboundMessages = mapMessagesForProvider(providerProfile, _wbMessages, { dropHistReasoning: _sessDropRc || !!(prov && prov.drop_hist_reasoning) });
    /* [位置:routes/chat.js·出站图片装饰] [图片 id + 表情包转图] [原这里是两段内联实现，11-06 收敛到 lib/outbound-images.js·decorateOutboundMessages：聊天与唤醒两条出口必须同一套口径，否则同一份历史两侧出站图块数不同（实测 5 个 vs 0 个），提示词缓存从第一张表情包就分叉] [注释时间 2026-11-06] */
    const _deco = outboundImages.decorateOutboundMessages(outboundMessages, { vision: _vision });   /* 2026-11-12：vision 模型表情包只发标签不发图（产品确定） */

    /* [位置:routes/chat.js·elapsed 注入] [距上一轮时间差标签] [10-29 #49 三改：她消息末尾动态加独立一行 \n[elapsed:2h]（复合单位 1min30s/2h5min/3d2h 见 elapsedFmt）——只加本轮最后一条 user、只此一处；动态注入不落盘，时间线/压缩/唤醒/状态机/前端都不带；时间差=时间线上「本轮她这条消息」与「它之前那条真实消息（通常是 AI 回复）」两条的 time 相减（findPrevMsgTime：按位置跳本轮——注入发生在本轮已落盘之后，末尾第一条真实 user 就是本轮，重新生成=触发消息本身；再往前取第一条真实消息，AI 主动唤醒发的消息也算；2026-10-31 改，原来取上一条 user 消息减 Date.now 会把 AI 回话耗时算进间隔）；会话开关 /v1/sessions/:id/elapsed-tag 默认开；会话第一条、上一条没时间都不加] [注释时间 2026-10-29；同日 1s 修复：内容匹配改按位置——时间缀开关关时落盘版/发模型版形态不一致匹配必失败；同日三改：落盘方案回退为动态注入；2026-10-31 改算法：间隔=本轮消息与它前一条真实消息两条的 time 相减，不再用 now 减上一条 user] */
    if (isMainChat) injectElapsed(sessionId, outboundMessages, { resolve: deps.resolveElapsedTagToAi, loadTimeline: loadTimeline, isReal: isRealMessageForTimeline });

    // 捕获发给 LLM 的完整上下文（管理台日志页可查看；= 真正发出的映射后消息）
    if (isMainChat) {
      setLastLLMCapture(outboundMessages.map(m => {
        const cap = splitMultimodalContent(m.content);
        return {
          role: m.role,
          content: cap.content,
          images: cap.images && cap.images.length ? cap.images : undefined,
          attachments: cap.attachments || undefined,
          tool_calls: m.tool_calls || undefined,
          tool_call_id: m.tool_call_id || undefined,
          /* 10-29 #46：存档保留思考链——上游计 token，统计页并入「最近对话」；走 MCP 时这份捕获随后会被工具循环结束后的那次覆盖（那次带真实 tools） */
          reasoning_content: m.reasoning_content || undefined,
          thinking_blocks: (Array.isArray(m.thinking_blocks) && m.thinking_blocks.length) ? m.thinking_blocks : undefined,
          anthropic_content_blocks: (Array.isArray(m.anthropic_content_blocks) && m.anthropic_content_blocks.length) ? m.anthropic_content_blocks : undefined
        };
      }), new Date().toISOString(), sessionId, (body && Array.isArray(body.tools) && body.tools.length) ? body.tools : null);
    }

    // 图片出口最后一步：相对路径补全 + 本站图内联。收敛到 lib/outbound-images.js·fillAndInlineImages，
    // 与唤醒侧调同一个函数（顺序写死：先 id/表情包装饰，再补全，最后内联）。
    // 内联只对 Claude 翻译代理生效：deepseek 只认 https 绝对 URL，收 base64 会整包拒。
    let _imgStats = null;
    try {
      _imgStats = await outboundImages.fillAndInlineImages(outboundMessages, {
        resolveUrl: function (u) { return imageAbsUrl(req, u); },
        isAnthropicProxy: outboundImages.isClaudeImageUpstream(prov),
      });
      if (_imgStats.inlined) console.log("[chat] 本地图内联 base64: " + _imgStats.inlined + " 张 " + Math.round(_imgStats.inlineBytes / 1024) + "KB, 未内联 " + _imgStats.inlineFailed + " 张");
    } catch (_e) { console.warn("[chat] 图片出口加工失败（保持原样）:", _e.message); }
    if (_deco.stickers || _deco.imageIds || (_imgStats && _imgStats.imageBlocks)) console.log("[chat] 出站图: 表情包 " + _deco.stickers + " 张, 图片id " + _deco.imageIds + " 个, 图块共 " + (_imgStats ? _imgStats.imageBlocks : -1) + " 个");

    // 2026-11-12 出站音频：input_audio 只有 Gemini 订阅（Cloud Code 链路）认——gemini 系内联最后一条、
    // claude/gpt 档剥占位（都在 oauth-proxy·prepareCloudCodeAudio）；其余供应商在这里剥成占位文字，
    // 转写文字本就附在「[语音消息 N秒 #id]」标签后，模型无信息损失。必须赶在 MCP 工具循环/转发之前。
    if (!(prov && (prov.oauth_provider === 'antigravity' || prov.oauth_provider === 'gemini'))) {
      const _audN = outboundImages.stripAudioPartsFromMessages(outboundMessages);
      if (_audN) console.log("[chat] 出站音频剥离 " + _audN + " 条（供应商不认音频 part）");
    }

    // 1010-27：MCP 循环前统一 setHeader（MCP 分支内部 writeHead 后 return，不到直连 writeHead）
    try { reply.raw.setHeader("X-Snapshot-Rebuilt", snapshotRebuilt ? "1" : "0"); } catch (e) { console.error('[chat.js:1425]', e.message || e); }
    // === MCP_TOOL_LOOP_BEGIN ===
    // MCP 工具循环：启用时若为主聊天，走 MCP 分支（工具轮次非流式，最终流式回传）
    // 这里传入已处理好的 sanitizedMessages，完整保留记忆/时间线/替换/裁剪上下文
    if (MCP_ENABLED()) {
      try {
        // 登记当前聊天会话：AI 在工具循环里调 context_replace 时，工具服务器回调
        // /internal/apply 是独立请求（ALS 已丢），靠这个登记把块记到正确会话
        contextReplacements.noteMcpChatSession(sessionId);
        if (await handleMcpRequest(body, reply, req, outboundMessages, sessionId, kelivoMessages)) return;
      } catch (mcpErr) {
        // 1020（产品确定）：工具循环失败不再退回「不带工具直连上游」——那样他会突然没了工具、上下文口径也变，
        // 还可能被严格上游二次拒收，用户只看到一个莫名其妙的报错。现在直接把真实原因报给前端。
        // （流式工具循环失败时 mcp 内部仍会先用非流式工具循环重试一次，那条也是带工具的。）
        console.warn("[mcp] 工具循环失败，直接报错（不再退回无工具直连）:", mcpErr.message, "| session:", sessionId, "| msgs:", Array.isArray(sanitizedMessages) ? sanitizedMessages.length : -1, "| model:", (body && body.model) || "");
        // SSE 头已发出：不能再改成普通 HTTP 错误，只结束现有流。
        if (reply.raw.headersSent) {
          try { reply.raw.end(); } catch (e) { /* client/stream cleanup */ }
          return;
        }
        /* [位置:routes/chat.js·工具循环失败] [不把上游原文外泄] [11-14 审查 B 批 a：原来把 mcpErr.message（上游 429/余额不足/内部堆栈片段）直接拼进返回体给客户端；现在对外只给人话+机器码，原文进日志（上面 2462 行那条 console.warn 已记）] [注释时间 2026-11-14] */
        return fail(reply, 502, 'upstream_failed', '上游模型这次没回成，稍后再试');
      }
    }
    // === MCP_TOOL_LOOP_END ===
    // 上游请求超时保护，避免上游挂起导致 /v1 请求永久阻塞
    let upstreamController = requestController || new AbortController();
    let upstreamTimer = setTimeout(() => upstreamController.abort(), UPSTREAM_TIMEOUT_MS);
    let response;
    try {
      const doFetch = () => fetch(targetApiUrl, {
        method: "POST",
        headers: Object.assign({
          "Content-Type": "application/json",
          Authorization: `Bearer ${targetApiKey}`
        }, targetExtraHeaders),
        body: JSON.stringify(buildUpstreamBody(body, outboundMessages)),
        signal: upstreamController.signal
      });
      response = await doFetch();
      // 2026-09-28 余额不足提醒：聊天直连 402 时记录并限频推 Bark（不阻断下方透传流程）
      if (response.status === 402) {
        upstreamAlert.note402({ model: String((body && body.model) || (resolvedModel) || ""), detail: "", sessionId }).catch(function (e) { console.error('[chat.js:1463] note402 failed:', e.message || e); });
      }
      // 图片 400 优雅降级（2026-09-15）：上游拉不到本轮新图（CDN 拦截供应商爬虫/文件失效）会整包 400，
      // 此前用户只能看到报错。这里把消息里的图片换成占位文本重试一次，保证回复仍能生成。
      // 用 clone() 探测错误体：非图片原因不降级时，原响应体保持可读、照常透传给客户端。
      if (response.status === 400) {
        const errText = await response.clone().text().catch(() => "");
        // 2026-10-27：识别范围扩成 _IMG_400_DEGRADE_RE（新增 assistant 带图被拒 / GLM 1210），去图重试逻辑不变
        if (_IMG_400_DEGRADE_RE.test(errText)) {
          let degraded = false;
          for (const m of outboundMessages) {
            if (!Array.isArray(m.content)) continue;
            for (let pi = 0; pi < m.content.length; pi++) {
              const p = m.content[pi];
              if (p && p.type === "image_url") {
                m.content[pi] = { type: "text", text: "（图片暂时无法读取，本轮已省略）" };
                degraded = true;
              }
            }
          }
          if (degraded) {
            console.warn("[chat] 上游拉取图片失败(400)，本轮图片换占位后重试一次");
            clearTimeout(upstreamTimer);
            if (requestController && requestController.signal.aborted) throw new Error("用户已停止生成");
            upstreamTimer = setTimeout(() => upstreamController.abort(), UPSTREAM_TIMEOUT_MS);
            response = await doFetch();
          }
        }
      }
    } catch (upstreamErr) {
      clearTimeout(upstreamTimer);
      throw upstreamErr;
    }

    const upstreamContentType = response.headers.get("content-type") || "";
    const shouldStreamResponse = requestedStream || upstreamContentType.includes("text/event-stream");

    // 批注 2026-07-11：Kelivo 关闭 stream 时需要收到普通 JSON；只在请求或上游确认为 SSE 时才按流式直通。
    if (!shouldStreamResponse) {
      const responseText = await response.text();
      let finalResponseText = responseText;

      // 解析 AI 回复，提取 <memory> 标签存入记忆池，并清洗返回给用户的内容
      try {
        const parsed = JSON.parse(responseText);
        const aiMessage = parsed.choices?.[0]?.message || {};
        // 2026-10-01 MiniMax 非流式修复：content 字符串里的 <think> 块剥离进思考链，正文用干净版（落盘/缓存/标签解析全走干净正文）
        const _sp = mcp.splitThinkBlock(String(aiMessage.content || ""));
        const aiContent = _sp.body;
        const aiThinking = [extractAssistantThinking(aiMessage), _sp.think].filter(Boolean).join("\n").trim();
        if (aiContent) {
          // 解析 <wake> 闹钟标签并写入调度（标签随后被剥离，不显示给用户）
          parseWakeTagAndSchedule(aiContent, sessionId);
          // 提取并存储记忆，同时拿到清洗后的文本
          // 1007-17 标星改 msgid：把落盘用的 reply_msg_id 一并传入，AI 自标星 <star> 按消息 id 存
          const _tagNotes = [];   // 2026-10-28 第6项：新写法标签没写成的说明，回复落盘后追加 developer 消息
          const cleanText = await tagParser.extractAndStore(aiContent, { sessionId, msgId: replyMsgId || undefined, notes: _tagNotes }).catch(err => {
            console.warn("[memory] 非流式标签解析失败:", err.message);
            return aiContent;
          });
          // 用清洗后的文本替换 JSON 中的 content
          if (cleanText !== aiContent) {
            parsed.choices[0].message.content = cleanText;
            finalResponseText = JSON.stringify(parsed);
          }
          // 方案二增量：回复只追加一条；盘尾已有同内容回复（重试/重发）则跳过，不重复写。
          // 存储用原始含标签文本（<wake>/<memory> 等是上下文一部分，模型可见、前端显示时剥、编辑框可见）。
          if ((kelivoMessages.some(isRealMessageForTimeline) || oldTimeline.length === 0)) {
            // 2026-09-16 [DIARY]：AI 在回复中写日记 → 存日记文件 + 时间线追加隐藏日记消息（带标签），可见回复剥掉日记块
            const diaryResult = _isSubSession ? { diaryContent: null, remainingText: aiContent } : diaryLib.extractDiaryFromResponse(aiContent);
            const visibleContent = diaryResult.diaryContent ? diaryResult.remainingText : aiContent;
            if (!tailHasReply(sessionId, visibleContent)) {
              const toAppend = [];
              if (diaryResult.diaryContent) {
                const diarySaved = diaryLib.appendDiaryEntry(diaryResult.diaryContent, sessionId);
                toAppend.push({ role: "assistant", content: diaryLib.wrapDiaryTag(diaryResult.diaryContent), kind: "diary", diary_id: (diarySaved && diarySaved.id) || undefined });
              }
              if (aiContent) {
                // 1005 改：后端时间线是流水账，落原始完整文本（含[DIARY]标签），不剥；
                // 日记内容另外存 diary.json + kind:diary 消息；前端可见内容由历史 API 下发时剥。
                toAppend.push({ id: replyMsgId || undefined, role: "assistant", content: aiContent, reasoning: aiThinking || "", tokens: (parsed && parsed.usage) || null });
              }
              if (toAppend.length) appendMessages(sessionId, toAppend);
              if (_tagNotes.length) appendMessages(sessionId, [{ role: "developer", content: _tagNotes.join("\n") }]);
            }
          } else {
            console.log("[timeline] 跳过回复落盘 (非流式)");
          }
          // 非流式同样写幂等缓存：同 client_msg_id 的重发直接回放，不重复调上游/重复写时间线
          if (cleanText && body && body.client_msg_id) {
            setRecentReply(String(body.client_msg_id).trim(), {
              text: cleanText, model: body.model || "", reasoning: aiThinking || "", tools: [], usage: (parsed && parsed.usage) || null, ts: Date.now()
            });
          }
        }
      } catch (parseErr) {
        console.warn("[memory] 非流式响应 JSON 解析失败:", parseErr.message);
      }

      clearTimeout(upstreamTimer);
      return reply
        .code(response.status)
        .header("Content-Type", upstreamContentType || "application/json")
        .header("X-Snapshot-Rebuilt", snapshotRebuilt ? "1" : "0")
        .send(finalResponseText);
    }

    if (!response.body) {
      return reply.code(response.status).send({ error: "上游 API 没有返回可读取的响应体", code: 'upstream_empty_body' });
    }

    // 2026-09-24 P3-2A：SSE 全文解析函数（正常路径与中断路径共用同一实现，杜绝口径漂移）
    const _splitThinkBlock = function (text) {
      if (typeof text !== "string" || !text) return { body: "", think: "" };
      const re = /<think>([\s\S]*?)<\/think>/g;
      const thinks = [];
      let m;
      while ((m = re.exec(text))) { if (m[1] && m[1].trim()) thinks.push(m[1].trim()); }
      if (!thinks.length) return { body: text, think: "" };
      return { body: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), think: thinks.join("\n") };
    };
    const _parseSseFull = function (rawSse) {
      let content = "", thinking = "", usage = null, parseErrors = 0;
      const _ls = String(rawSse || "").split("\n");
      for (const _l of _ls) {
        if (_l.startsWith("data: ") && _l !== "data: [DONE]") {
          try {
            const _evt = JSON.parse(_l.slice(6));
            const _d = _evt.choices?.[0]?.delta?.content;
            if (_d) content += _d;
            const _dt = _evt.choices?.[0]?.delta?.reasoning_content || _evt.choices?.[0]?.delta?.reasoning;
            if (_dt) thinking += (typeof _dt === "string" ? _dt : (_dt.text || ""));
            const _fc = _evt.choices?.[0]?.message?.content;
            if (_fc) content = _fc;
            if (_evt.usage) { usage = _evt.usage; }
          } catch (e) { parseErrors++; }
        }
      }
      const _sp = _splitThinkBlock(content);
      const _allT = [];
      if (_sp.think) _allT.push(_sp.think);
      if (thinking && thinking.trim()) _allT.push(thinking.trim());
      return { content: _sp.body, thinking: _allT.join("\n").trim(), usage: usage, parseErrors: parseErrors };
    };
    reply.raw.writeHead(response.status, {
      "Content-Type": upstreamContentType || "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Snapshot-Rebuilt": snapshotRebuilt ? "1" : "0"
    });

    const reader = response.body.getReader();
    // 2026-09-08：不再累积上游原始字节数组（长回复会双份内存），改为流内累积解码后的 SSE 全文，供流结束提取 AI 回复/记忆标签。
    let fullRawSse = "";
    let aiFullContent = "";   // 2026-09-24 P3-2A：提升到 while 循环外（正常路径赋值 + 中断路径兜底解析共用）
    let aiThinking = "";
    let aiUsage = null;
    // 放在流读取 try 外，后面的落盘阶段也需要更新同一份快照。
    // 1025：带上本条回复的稳定 id——status 接口把它吐给前端，续显恢复的前端也能拿到 reply_msg_id 调 /v1/chat/stop（10-25：暂停任何时候都要能停）
    const _partialGen = { text: "", reasoning: "", tools: [], ts: Date.now(), startedAt: Date.now(), done: false, persisted: false, phase: "waiting", phaseAt: Date.now(), replyMsgId: replyMsgId || "" };
    try {
    // Streaming tag filter: 上游会把 <memory>/<pin> 拆成 <、memory、> 等多个事件，
    // 字节层匹配不到完整标签，必须在 content 文本层过滤后再重组 SSE 事件。
    const contentFilter = createContentTagFilter();
    const thinkStripper = mcp.createThinkStripper();
    // 1012-01c：客户端断开后的 A 方案（与 MCP 路径 server.js streamDelta 同语义，1004-04 拍板）：
    // 断开后不再 write——向半死 socket 写会抛错 → 走 catch 只落盘半截、上游连接还要空跑到超时；
    // 改为静默丢弃下发但继续读完上游，流结束后按完整 fullRawSse 落盘。
    // 修复「停止后有时完整落盘、有时只落半截」的双现象（取决于 nginx 何时掐断 gateway socket）。
    let clientGone = false;
    const _publishPartialGen = () => {
      try {
        const previous = activeGenMap.get(sessionId);
        if (previous && previous !== _partialGen && !previous.done) return;
        _partialGen.ts = Date.now();
        activeGenMap.set(sessionId, _partialGen);
      } catch (e) { /* client/stream cleanup */ }
    };
    _publishPartialGen();
    const _clientGoneMark = (why) => {
      if (!clientGone) {
        clientGone = true;
        console.warn("[stream] " + why + "，继续后台读完并完整落盘（A 方案）");
      }
    };
    const _clientAlive = () => !reply.raw.destroyed && !reply.raw.writableEnded && !reply.raw.writableFinished;
    const safeWrite = (fn) => {
      if (!_clientAlive()) { _clientGoneMark("客户端已断开"); return; }
      try { fn(); } catch (e) { _clientGoneMark("客户端写失败（socket 半死）: " + e.message); }
    };
    const emitRawLine = (line) => safeWrite(() => reply.raw.write(line + "\n"));
    let sseBuffer = "";
    // UTF-8 流式解码：多字节字符（中文/emoji）可能被网络分包从字节中间切开，
    // 逐 chunk 独立 toString 会产出 U+FFFD 乱码并破坏 <memory>/<pin> 等标签的字节层匹配
    const sseDecoder = new TextDecoder("utf-8");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decodedChunk = sseDecoder.decode(value, { stream: true });
      sseBuffer += decodedChunk;
      fullRawSse += decodedChunk;
      let nl;
      while ((nl = sseBuffer.indexOf("\n")) !== -1) {
        const rawLine = sseBuffer.slice(0, nl);
        sseBuffer = sseBuffer.slice(nl + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line.startsWith("data:")) {
          emitRawLine(line);
          continue;
        }
        const payload = line.slice(5).replace(/^\s+/, "");
        if (!payload || payload === "[DONE]") {
          emitRawLine(line);
          continue;
        }
        let evt;
        try {
          evt = JSON.parse(payload);
        } catch {
          emitRawLine(line);
          continue;
        }
        const delta = evt && evt.choices && evt.choices[0] && evt.choices[0].delta;
        if (delta && typeof delta.reasoning_content === "string" && delta.reasoning_content.length) {
          _partialGen.reasoning += tagParser.stripTags(delta.reasoning_content);
          if (!_partialGen.text) { _partialGen.phase = "reasoning"; _partialGen.phaseAt = Date.now(); }
          _publishPartialGen();
        }
        // 空字符串 content 常伴随 finish_reason/usage（如末尾事件），必须原样透传
        if (delta && typeof delta.content === "string" && delta.content.length > 0) {
          contentFilter.push(delta.content, (filtered) => {
            // 2026-10-01 MiniMax：content 内 <think> 块跨帧剥离，剥离的思考以 reasoning_content 增量帧转发（前端实时显示思考链）
            thinkStripper.push(filtered, (cleanText) => {
              if (!cleanText) return;
              _partialGen.text += cleanText;
              _partialGen.phase = "writing"; _partialGen.phaseAt = Date.now();
              _publishPartialGen();
              delta.content = cleanText;
              safeWrite(() => reply.raw.write("data: " + JSON.stringify(evt) + "\n\n"));
            });
            const _td = thinkStripper.takeThinking();
            if (_td) {
              _partialGen.reasoning += _td;
              if (!_partialGen.text) { _partialGen.phase = "reasoning"; _partialGen.phaseAt = Date.now(); }
              _publishPartialGen();
              safeWrite(() => reply.raw.write("data: " + JSON.stringify({
                id: "chatcmpl-direct",
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: (body && body.model) || "",
                choices: [{ index: 0, delta: { reasoning_content: _td }, finish_reason: null }]
              }) + "\n\n"));
            }
          });
        } else {
          emitRawLine(line);
        }
      }
    }
    // 2026-09-24 P3-2A：直通降级路径（MCP 关/工具循环回退）此前只透传上游 SSE、不下发 final_content——
    // 前端本地合成 content 与服务器落盘 visibleContent 口径不一致，补拉时 added 恒空、新消息不逐条弹出。
    // 此处先解析完整正文，再与 MCP 主路径（server.js B3）同款协议下发终止帧；解析结果提升为外层变量，
    // 下方落盘块直接复用（解析只跑一次，不再各自解析）。
    const _pp = _parseSseFull(fullRawSse);
    aiFullContent = _pp.content;
    aiThinking = _pp.thinking;
    aiUsage = _pp.usage;
    _partialGen.text = aiFullContent || _partialGen.text;
    _partialGen.reasoning = aiThinking || _partialGen.reasoning;
    if (_pp.parseErrors > 0) console.warn("[stream] 本轮共 " + _pp.parseErrors + " 帧解析失败，落盘回复可能不完整");
    if (aiUsage) console.log("[usage] " + JSON.stringify(aiUsage));
    if (aiFullContent) {
      const _diaryR = diaryLib.extractDiaryFromResponse(aiFullContent);
      const _vis = _diaryR.diaryContent ? _diaryR.remainingText : aiFullContent;
      if (_vis) {
        // 直通终止帧：final_content = 可见内容（剥日记块，与时间线落盘同口径），
        // 前端 _finalContent 优先采用，本地缓存与服务器字节级一致（顶层字段第三方客户端忽略，向后兼容）
        safeWrite(() => reply.raw.write("data: " + JSON.stringify({
          id: "chatcmpl-direct",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: (body && body.model) || "",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: aiUsage || null,
          final_content: _vis
        }) + "\n\n"));
      }
    }
    // 收尾：丢弃未闭合标签/残留前缀，转发剩余行，结束响应
    // 2026-11-14 复盘：这里有意不带 emit——上方 final_content 帧已带完整校正正文，若把扣住的尾巴再补发一个 content 块，会落在 final_content 之后，前端可能拼接出重复尾巴
    contentFilter.flush();
    thinkStripper.flush();
    if (sseBuffer) emitRawLine(sseBuffer.replace(/\n+$/, ""));
    reply.raw.end();
    } catch (streamErr) {
      // 上游中断/超时时确保响应结束，避免连接悬挂
      // 2026-09-13 审查修复：不再 rethrow——rethrow 会跳过下方的落盘块（已生成的部分回复
      // 不落盘，刷新即丢），且外层 catch 会对已发头的响应二次 send。中断后仍走落盘块，
      // 把已收到的部分回复存档（tailHasReply 保证重试时不重复写）。
      console.warn("[stream] 流式中断（客户端断开/上游异常）:", streamErr.message);
      try { reply.raw.end(); } catch (e) { /* client/stream cleanup */ }
    } finally {
      clearTimeout(upstreamTimer);
    }

    // 流结束后解析 AI 回复（完整正文/思考链/usage 解析已在直通终止帧处完成，此处直接复用，
    // 2026-09-24 P3-2A：原解析循环前移，避免重复解析与口径漂移）
    try {
      // 中断路径兜底：while 循环抛错会跳过上方终止帧块（aiFullContent 仍为空），
      // 保留原「中断后仍落盘部分回复」语义（tailHasReply 保证重试时不重复写）
      if (requestController && requestController.signal.aborted) {
        // 用户明确停止：只保存截至取消时已过滤的正文，绝不把断开的连接当成继续生成。
        aiFullContent = _partialGen.text || "";
        aiThinking = _partialGen.reasoning || "";
      } else if (!aiFullContent && fullRawSse) {
        const _pp2 = _parseSseFull(fullRawSse);
        aiFullContent = _pp2.content;
        aiThinking = _pp2.thinking;
        aiUsage = _pp2.usage;
        if (_pp2.parseErrors > 0) console.warn("[stream] 中断路径共 " + _pp2.parseErrors + " 帧解析失败，落盘回复可能不完整");
      }
      if (aiFullContent) {
        // 解析 <wake> 闹钟标签并写入调度（标签随后被剥离，不显示给用户）
        parseWakeTagAndSchedule(aiFullContent, sessionId);
        // 提取并存储记忆，并拿到清洗后的文本
        // 1007-17 标星改 msgid：把落盘用的 reply_msg_id 一并传入，AI 自标星 <star> 按消息 id 存
        const _tagNotes = [];   // 2026-10-28 第6项：同非流式
        const cleanFull = await tagParser.extractAndStore(aiFullContent, { sessionId, msgId: replyMsgId || undefined, notes: _tagNotes }).catch(err => {
          console.warn("[memory] 流式标签解析失败:", err.message);
          return aiFullContent;
        });
        // 方案二增量：回复只追加一条（富字段 reasoning/tokens 一并落，跨设备刷新不丢）；
        // 盘尾已有同内容回复（重试/重发）则跳过，不重复写。
        // 存储用原始含标签文本（模型可见、前端显示时剥、编辑框可见）。
        if ((kelivoMessages.some(isRealMessageForTimeline) || oldTimeline.length === 0)) {
          // 2026-09-16 [DIARY]：同非流式，AI 回复中的日记块 → 日记文件 + 隐藏日记消息（带标签），可见回复剥掉日记块
          const diaryResult = _isSubSession ? { diaryContent: null, remainingText: aiFullContent } : diaryLib.extractDiaryFromResponse(aiFullContent);
          const visibleContent = diaryResult.diaryContent ? diaryResult.remainingText : aiFullContent;
          if (!tailHasReply(sessionId, visibleContent)) {
            const toAppend = [];
            if (diaryResult.diaryContent) {
              const diarySaved = diaryLib.appendDiaryEntry(diaryResult.diaryContent, sessionId);
              toAppend.push({ role: "assistant", content: diaryLib.wrapDiaryTag(diaryResult.diaryContent), kind: "diary", diary_id: (diarySaved && diarySaved.id) || undefined });
            }
            if (aiFullContent) {
              // 1005 改：后端流水账落原始完整文本（含[DIARY]标签），不剥；下发前端时剥。
              toAppend.push({ id: replyMsgId || undefined, role: "assistant", content: aiFullContent, reasoning: aiThinking || "", tokens: aiUsage || null });
            }
            if (toAppend.length) appendMessages(sessionId, toAppend);
            if (_tagNotes.length) appendMessages(sessionId, [{ role: "developer", content: _tagNotes.join("\n") }]);
          }
          _partialGen.persisted = true;
          _partialGen.done = true;
          _partialGen.ts = Date.now();
          activeGenMap.set(sessionId, _partialGen);
        } else {
          console.log("[timeline] 跳过回复落盘 (流式)");
        }
        // 缓存本次已生成的回复，供同 client_msg_id 的重复请求直接回放。
        if (cleanFull && body && body.client_msg_id) {
          setRecentReply(String(body.client_msg_id).trim(), {
            text: cleanFull, model: body.model || "", reasoning: aiThinking || "", tools: [], usage: aiUsage || null, ts: Date.now()
          });
        }
      }
    } catch (streamErr) {
      console.warn("[memory] 流式响应解析失败:", streamErr.message);
    }
    // 即使用户在首个 token 前停止，快照也必须结束，不能让状态轮询一直显示 active。
    if (!_partialGen.done) {
      _partialGen.done = true;
      _partialGen.ts = Date.now();
      activeGenMap.set(sessionId, _partialGen);
    }
  } catch (err) {
    console.error(err);
    // SSE 头已发送时不能再切换成普通 HTTP 500；只结束现有流。
    if (!reply.raw.headersSent) fail500(reply, err);
    else { try { reply.raw.end(); } catch (e) { /* client/stream cleanup */ } }
  } finally {
    // 覆盖所有提前 return 路径；成功缓存替换 owner 后，这里不会误清缓存或其他请求。
    if (clientMsgId && pendingOwner) clearPendingReply(clientMsgId, pendingOwner);
    if (activeRequestEntry && activeRequestEntry.key && activeChatRequests.get(activeRequestEntry.key) === activeRequestEntry) {
      activeChatRequests.delete(activeRequestEntry.key);
    }
    if (finishActiveRequest) finishActiveRequest();
  }
});
};
module.exports._elapsed = { elapsedFmt: elapsedFmt, findPrevMsgTime: findPrevMsgTime, injectElapsed: injectElapsed };   /* 单测钩子（10-29 #49 三改：回退动态注入三件套；2026-10-31 findPrevUserTime→findPrevMsgTime，返回两条消息的 time） */

