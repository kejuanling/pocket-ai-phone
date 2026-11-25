/**
 * mcp-tool-loop.js
 * 工具执行循环：把 MCP 工具注入模型请求，处理多轮 tool_calls，直到模型不再要工具，
 * 最终把纯文本结果转成 OpenAI 兼容 SSE 流。
 *
 * 设计（隔离式）：
 *  - 不改动 server.js 现有直通转发逻辑。
 *  - 提供 runWithTools()：给定消息/模型配置，内部循环调用上游，返回最终 assistant 文本。
 *  - 提供 buildSSE()：把最终文本 + 思考链 + 工具调用记录转成 chat.html 可消费的 SSE 流。
 *
 * 流式体验：工具调用轮次用非流式（等结果），最后一次流式回传（保持前端打字效果）。
 * 透传内容：思考链 reasoning_content、工具调用记录 tool_trace（供前端渲染工具胶囊）。
 */
"use strict";

const { loadTools, toOpenAITools, callToolByExposedName, toolKey, sessionClients, sessionClientsByRules } = require("./mcp-service");
const { createSessionCfg } = require("../lib/session-cfg");
const _path = require("path");
const upstreamAlert = require("../lib/upstream-alert"); // 2026-09-28 上游 402（余额不足）提醒

/* [位置:mcp/mcp-tool-loop.js·upstreamErrText] [上游报错转人话] [此前把上游响应体整段 JSON 拼进报错，手机上是一坨花括号；改为优先取 OpenAI 形状的 error.message（订阅账号的「去验证」链接就藏在这里，截断长度必须容得下整条链接）] [注释时间 2026-11-04] */
function upstreamErrText(raw) {
  const t = String(raw || '');
  try {
    const j = JSON.parse(t);
    const m = j && j.error && (j.error.message || j.error.code);
    if (m) return String(m).slice(0, 900);
  } catch (e) { /* 不是 JSON，原样截断 */ }
  return t.slice(0, 600);
}
// 2026-11-04：Gemini 3 的 functionCall 回放要求 thoughtSignature（OpenAI 兼容层用
// tool_calls[i].extra_content.google.thought_signature 承载），缺了必 400；给 Gemini 官方
// 端点补官方接受的哨兵值，其他上游不受影响（见 lib/gemini-tool-sig.js）
const geminiSig = require("../lib/gemini-tool-sig");
const egressGuard = require("../lib/egress-guard");

// 2026-09-30 日志加时间（q5 清理项）：error.log 无时间戳，本模块被聊天/唤醒共用，
// 错误统一带本地时间前缀，与 wake-scheduler.js logErr / wake-chat.js wakeLogWarn 同一口径。
// 时间独立成前缀、原 [mcp]/[mcp-diag]/[diary] tag 保留在消息里，按 tag grep 的旧习惯不受影响。
function mcpNowLocal() {
  try {
    const tu = require("../utils/time_utils");
    const p = tu.getDatePartsInTimeZone(new Date(), tu.resolveTimeZone());
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second;
  } catch (e) { return new Date().toISOString(); }
}
function mcpLogWarn(msg) { console.warn("[" + mcpNowLocal() + "] " + msg); }

const DEFAULT_MAX_TOOL_ROUNDS = 50; // 1024-01：工具循环上限 10→50（修东西会话 2026-10-24 两轮实证：10 轮打满即中断，见 roundCapNotice）；1004-03：6→10
// 1028-01（2026-10-28）：三条生产链路改显式传参——主聊天 server.js 传 Infinity（「主聊天50轮限制去掉」）、
// 唤醒 wake-chat.js 传 10（唤醒限 10 轮）、子智能体 subagent-runner 传 Infinity（10-27 已不限）。
// 本默认值只兜底未显式传参的调用方（含测试），不可删除：删了未传方拿到 undefined，
// `round < maxToolRounds + 1` 直接不进循环，恒空回复。
const MAX_REASONING_CHARS = 4000; // 思考链最多保留字符数，避免过长
// 轮内上游超时：与 server.js 全局口径一致（此前硬编码 120s，比全局 180s 短，长回复会先于全局超时被误杀）
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 180000;
// 单条工具结果写进时间线的截断上限：防止超大结果（读文件/长网页）把 enhanced_messages.json 撑爆
const MAX_TOOL_RESULT_CHARS = 30000;
const UNTRUNCATED_RESULT_TOOLS = new Set(["session_context"]);   // 2026-11-24：跨客户端获取会话完整原文免除 30KB 截断

// 会话级工具（2026-09-12）：执行时由服务端把当前聊天会话 id 强制注入参数 session_id（覆盖模型给的值，
// 模型伪造无效）。工具端（tools_server.py）据此把日记/留纸写到对应会话目录。
const SESSION_SCOPED_TOOLS = new Set(["lovediary_add", "lovediary", "notebook", "memory", "notebook_add", "notebook_list", "memory_add", "album", "context", "wake", "claim_lock"]); // 1025-26：wake 的 session_id 也是当前会话（闹钟设给自己） // 1010-17：memory_add 提交的记忆自动带当前会话（source_session 溯源） // 1112-07：claim_lock 也注入——聊天会话的 AI 用工具登记占坑落到本会话键，浮球算自己的、清除按钮能退；第三方应用直连工具集没有网关注入，仍落 tool_ 键（浮球标「工具」）
/* [位置:mcp-tool-loop.js·rebuild_snapshot] [AI 自己触发会话快照重建] [10-23：工具更新后会话快照里是旧工具清单，AI 在任意一次工具调用里带 rebuild_snapshot=true，网关拦下（不转给工具），本轮（整个工具循环）结束 3 秒后清掉该会话 v2 快照 + 失效标记，下一轮对话懒生成新快照，效果等同会话菜单「重建快照」；回执里附一句说明，工具卡上能看到；同一轮重复带只算一次] [注释时间 2026-10-23] */
const _rebuildPending = new Set();
function _takeRebuildFlag(args) {
  if (!args || typeof args !== "object" || !("rebuild_snapshot" in args)) return false;
  const v = args.rebuild_snapshot; delete args.rebuild_snapshot;
  return v === true || v === 1 || /^(true|1|yes)$/i.test(String(v));
}
function _markRebuild(sessionId) { const sid = String(sessionId || "").replace(/[^A-Za-z0-9_-]/g, ""); if (sid) _rebuildPending.add(sid); }
function _flushRebuild(sessionId) {
  const sid = String(sessionId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!sid || !_rebuildPending.has(sid)) return;
  _rebuildPending.delete(sid);
  setTimeout(function () {
    try {
      const sv2 = require("../context/context-snapshot-v2"), base = _path.join(__dirname, "..");
      sv2.deleteSnapshot(base, sid); sv2.clearStale(base, sid);
      mcpLogWarn("[snapshot] AI 触发重建：已清除 session=" + sid + " 的快照，下一轮重新生成");
    } catch (e) { mcpLogWarn("[snapshot] AI 触发重建失败: " + (e && e.message)); }
  }, 3000);
}
const REBUILD_NOTE = "\n\n[系统] 已安排重建快照：本轮结束后清掉旧快照，下一轮对话起使用最新的工具清单、人设和长期记忆等内容（与会话菜单里的「重建快照」相同）。";
/* [位置:mcp-tool-loop.js·_persistArgs] [落盘/事件里的入参不带网关注入的 session_id] [10-28 第7项复核：session_id 是网关强制注入的内部通道（_injectSessionArg 直接改 args 对象），落盘的 tools[].args 和 tool_start 事件的 args 都带着它，AI 回看自己以前的调用会学着填、前端工具卡也显示出来；注入照常发生，只是记录里不留] [注释时间 2026-10-28] */
function _persistArgs(name, args) {
  if (SESSION_SCOPED_TOOLS.has(name) && args && typeof args === "object" && !Array.isArray(args) && "session_id" in args) {
    const c = Object.assign({}, args); delete c.session_id; return c;
  }
  return args;
}
function _injectSessionArg(name, args, sessionId) {
  if (sessionId && SESSION_SCOPED_TOOLS.has(name) && args && typeof args === "object" && !Array.isArray(args)) {
    args.session_id = String(sessionId);
  }
}

// diary_add 写日记 → 时间线落库。工具端只把正文写进日记存储、回执不返正文，服务端无从从回执里
// 提取 [DIARY] 落库，AI 重建上下文时就看不到自己写过什么（keh3 9-28 三篇全缺）。由调用方传
// onDiaryWritten 回调补一条 kind=diary 隐藏消息（isRealDiary 保护，永不压缩）。
// 2026-10-03：原先这段只写在 executeToolCalls（非流式兜底路径）里，streamToolLoop —— 也就是生产
// 主路径 —— 完全没有，导致流式对话里用 diary_add 工具写的日记从不落时间线。现由两条循环共用本函数，
// 判定口径只有这一处，不会再漂移。
function _notifyDiaryWritten(name, args, error, result, onDiaryWritten, sessionId) {
  // 2026-10-22：lovediary_add 与 lovediary 合并成 lovediary（action=add 才是写日记；action=list 只是查看，不落时间线）
  const isDiaryAdd = name === "lovediary_add" || (name === "lovediary" && args && String(args.action || "").trim().toLowerCase() === "add");
  if (!isDiaryAdd || error || typeof onDiaryWritten !== "function") return;
  const dText = (args && typeof args.content === "string" && args.content.trim()) ? args.content.trim() : "";
  if (!dText) return;
  // 2026-10-19：从工具回执解析新条目 id（tools_server.py 的 diary_add 返回 JSON 带 diary_id），
  // 时间线消息据此打外键。解析失败（旧版工具/非 JSON 回执）不阻断落库，只是这条没有外键。
  let diaryId = null;
  try {
    const parsed = JSON.parse(String((result && result.markdown) || ""));
    if (parsed && parsed.diary_id != null) diaryId = parsed.diary_id;
  } catch (e) {}
  try { onDiaryWritten(sessionId, dText, diaryId); } catch (e) { mcpLogWarn("[diary] 时间线落库回调失败: " + e.message); }
}


/**
 * 执行带工具的多轮对话。
 * @param {Object} opts
 *  - upstreamUrl / upstreamKey : 上游 API 地址与密钥
 *  - model : 模型名
 *  - messages : 已处理好的消息数组（OpenAI 兼容）
 *  - serverClients : 已连接的 MCP server client 列表
 *  - temperature / top_p / max_tokens : 可选
 *  - maxToolRounds : 工具循环上限
 *  - fetch : 可注入的 fetch（测试用），默认全局 fetch
 *  - onDiaryWritten : 可选回调 (sessionId, 正文)，diary_add 工具成功后调用，把日记落时间线
 * @returns {Promise<{text:string, rounds:number, usage:any, reasoning:string, toolHistory:Array}>}
 */

// MiniMax 等模型把思考链直接写在 content 的 <think> 块里（非 reasoning_content 字段），
// 剥离进 reasoning，避免思考泄漏成正文显示/落库。
function splitThinkBlock(text) {
  if (typeof text !== "string" || !text) return { body: "", think: "" };
  const re = /<think>([\s\S]*?)<\/think>/g;
  const thinks = [];
  let m;
  while ((m = re.exec(text))) { if (m[1] && m[1].trim()) thinks.push(m[1].trim()); }
  if (!thinks.length) return { body: text, think: "" };
  return { body: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), think: thinks.join("\n") };
}

// 2026-10-01 MiniMax 跨帧剥离状态机：SSE 帧可能把 <think> 拆成 <th / ink> 等多帧，
// 逐帧正则匹配不到，必须 buffer 累积：完整块提取进思考链，残片（含未闭合 <think> 前缀）等下一帧。
// 1008-16 修复：push 兜底分支此前从 buf[0] 切片输出，完整 think 块匹配后（last 已越过该块）
// 又把思考链原样复制回正文 → MiniMax 正文出现 thinking 链且折叠区也有一份（复制而非移除）。
// 改为从 last 切片，仅输出未处理的尾部；拆帧（<th/ink> 等）由 PREFIXES 保留逻辑继续兜底。
// Claude 思考块回传前的最小净化：只认带签名的 thinking / redacted_thinking，
// 字节原样保留（不重排、不改写），坏形状直接丢——坏块回传必 400，宁可不传。
/* [位置:mcp/mcp-tool-loop.js·normalizeThinkingBlocks] [Claude 思考块轮内回传] [上游终帧带 thinking_blocks，下一轮 assistant 必须原样带回；只做形状过滤不做内容变换] [注释时间 2026-10-28] */
function normalizeThinkingBlocks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const b of list) {
    if (!b) continue;
    if (b.type === 'thinking' && typeof b.signature === 'string' && b.signature) {
      out.push({ type: 'thinking', thinking: typeof b.thinking === 'string' ? b.thinking : '', signature: b.signature });
    } else if (b.type === 'redacted_thinking' && typeof b.data === 'string' && b.data) {
      out.push({ type: 'redacted_thinking', data: b.data });
    }
  }
  return out;
}
// Anthropic 交错思考回放：同一 assistant 里 thinking/text/tool_use 的相对顺序参与签名校验。
// content_blocks 是翻译层按上游 content_block_stop 顺序捕获的原样块；这里只过滤形状，不重排、不改内容。
function normalizeAnthropicContentBlocks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const b of list) {
    if (!b) continue;
    if (b.type === 'thinking' && typeof b.signature === 'string' && b.signature) {
      out.push({ type: 'thinking', thinking: typeof b.thinking === 'string' ? b.thinking : '', signature: b.signature });
    } else if (b.type === 'redacted_thinking' && typeof b.data === 'string' && b.data) {
      out.push({ type: 'redacted_thinking', data: b.data });
    } else if (b.type === 'text' && typeof b.text === 'string' && b.text) {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use' && b.id && b.name) {
      let input = (b.input && typeof b.input === 'object' && !Array.isArray(b.input)) ? b.input : {};
      if (typeof b.input === 'string' && b.input.trim()) {
        try { const parsed = JSON.parse(b.input); input = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}; } catch (e) { input = {}; }
      }
      out.push({ type: 'tool_use', id: String(b.id), name: String(b.name), input: input });
    }
  }
  return out;
}

function createThinkStripper() {
  let buf = "";
  let thinking = "";
  const re = /<think>([\s\S]*?)<\/think>/g;
  const PREFIXES = ["<", "<t", "<th", "<thi", "<thin", "<think"];
  return {
    push(text, cb) {
      buf += text;
      let out = "", last = 0;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(buf))) {
        out += buf.slice(last, m.index);
        if (m[1] && m[1].trim()) thinking += m[1].trim() + "\n";
        last = m.index + m[0].length;
      }
      const openIdx = buf.indexOf("<think", last);
      if (openIdx >= 0) {
        out += buf.slice(last, openIdx);
        buf = buf.slice(openIdx);
      } else {
        let keep = 0;
        for (let i = 0; i < PREFIXES.length; i++) {
          if (buf.endsWith(PREFIXES[i])) keep = Math.max(keep, PREFIXES[i].length);
        }
        if (keep > 0) {
          out += buf.slice(last, buf.length - keep);
          buf = buf.slice(buf.length - keep);
        } else {
          out += buf.slice(last);
          buf = "";
        }
      }
      if (out && cb) cb(out);
      return this;
    },
    takeThinking() {
      const t = thinking;
      thinking = "";
      return t;
    },
    flush() {
      buf = "";
    }
  };
}
/* [位置:mcp-tool-loop.js·sessionToolOpts/loadToolsFor] [会话级 MCP 工具开关] [会话存了 mcp_on（工具 key 列表）就以它为准加载工具，没存就跟随全局；全局停用的服务器被会话单独开了也能用] [注释时间 2026-10-21] */
function sessionToolOpts(baseDir, sessionId) {
  if (!baseDir || !sessionId) return null;
  try {
    // 2026-10-27：有规则（mcp_rules）就以规则为准；没有才走旧的 mcp_on / mcp_seen / mcp_exact（子智能体等仍写旧字段）
    const rules = createSessionCfg(baseDir).readMcpRules(sessionId);
    if (rules) return { sessionRules: rules };
    const on = createSessionCfg(baseDir).readMcpOn(sessionId);
    if (!Array.isArray(on)) return null;
    const seen = createSessionCfg(baseDir).readMcpSeen(sessionId);
    const exact = createSessionCfg(baseDir).readMcpExact(sessionId) === true;   // 精确模式：跳过「新工具默认开」（预设开会话=所见即所得）
    const o = Array.isArray(seen) ? { sessionOn: on, sessionSeen: seen } : { sessionOn: on };
    o.sessionExact = exact;
    return o;
  } catch (e) { return null; }
}
async function loadToolsFor(baseDir, sessionId, serverClients) {
  const o = sessionToolOpts(baseDir, sessionId);
  if (!o) return loadTools(serverClients);
  const cfgPath = _path.join(baseDir, "config", "mcp-servers.json");
  if (o.sessionRules) return loadTools(sessionClientsByRules(serverClients, o.sessionRules, cfgPath), o);
  return loadTools(sessionClients(serverClients, new Set(o.sessionOn), cfgPath), o);
}
// 1026（产品确定）：取消工具列表冻结。原机制（1007）：工具列表冻死在会话快照里——工具服务更新/重启
// 后 AI 仍拿旧工具，要重建快照才生效（日记 q 搜索这次就踩了：网关重启了，mcp-tools 的新参数 AI 看不到）。
// 改为实时拉取 + 30 秒缓存：工具更新最迟半分钟生效；内容不变时序列化不变，上游提示词缓存不受影响，
// 仅工具真变化的那一轮缓存失效一次；拉取失败退回上一次的工具（工具服务抖动不闪断聊天）。
// 会话级 MCP 开关（mcp_on）照旧由 loadToolsFor 内部生效；快照里遗留的 tools/tools_fp 字段成为历史记录，
// 消费方已下线（server.js 快照过期检测的 tools 比对同步移除）。
const _TOOLS_TTL_MS = 30000;
const _toolsCache = new Map(); // sessionId -> { tools, at }；invalidateToolsCache() 主动清
async function getToolsForSession(snapshotV2, baseDir, sessionId, serverClients) {
  const key = sessionId || "_";
  const c = _toolsCache.get(key);
  if (c && Date.now() - c.at < _TOOLS_TTL_MS) return c.tools;
  try {
    const routes = await loadToolsFor(baseDir, sessionId, serverClients);
    const tools = toOpenAITools(routes || []);
    if (_toolsCache.size > 50) _toolsCache.clear();
    _toolsCache.set(key, { tools: tools, at: Date.now() });
    return tools;
  } catch (e) {
    console.warn("[mcp] 拉取工具失败" + (c ? "，沿用上一次的清单" : "（本轮无工具）") + ":", e && e.message);
    return c ? c.tools : [];
  }
}
/* [位置:mcp/mcp-tool-loop.js·invalidateToolsCache] [工具缓存主动失效] [MCP 配置热重载 / 会话开关保存后调用，工具变化不等 30 秒 TTL] [注释时间 2026-10-26] */
function invalidateToolsCache(sessionId) { if (sessionId) _toolsCache.delete(sessionId); else _toolsCache.clear(); }

async function _runWithToolsCore({
  upstreamUrl,
  upstreamKey,
  upstreamHeaders,
  model,
  messages,
  serverClients,
  temperature,
  top_p,
  max_tokens,
  reasoningEffort = null,
  extraBody = null,   /* [位置:mcp-tool-loop.js·extraBody] [引擎透传思考参数] [11-09：子智能体按供应商上锁思考——reasoning_effort 已有参数，智谱系 thinking.enabled 等对象从这透进请求体；不传=行为不变，对话/唤醒主链路不受影响] [注释时间 2026-11-09] */
  maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
  fetchFn = fetch,
  resume = null,
  onEvent = null,
  sessionId = null,
  onDiaryWritten = null,
  snapshotV2 = null,
  baseDir = null,
  signal = null,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS
}) {
  fetchFn = egressGuard.wrapFetchFn(fetchFn);
  // 1. 加载 MCP 工具，转成 OpenAI tools[]（1007：快照优先，冻死）
  const openaiTools = await getToolsForSession(snapshotV2, baseDir, sessionId, serverClients);
  const allRoutes = openaiTools;
  // 1007-17 修复：下面 toolCtx 与函数返回值都引用了 routes，但 1007-16 把工具加载改成
  // getToolsForSession 后只留下 openaiTools，routes 已无人定义 → ReferenceError，
  // 工具循环一进来就崩、回退原逻辑。这里补回原始 MCP 路由：
  // 注意两者不是一回事——openaiTools 是发给上游的工具定义（走快照冻死），
  // routes 是「按暴露名找到并执行工具」用的原始路由（含 exposedName/serverId/tool.name），
  // callToolByExposedName 只认后者，不能用 openaiTools 顶替。
  const routes = await loadToolsFor(baseDir, sessionId, serverClients);
  // 2026-10-03：onDiaryWritten 必须进 toolCtx —— executeToolCalls 读的是 ctx.onDiaryWritten，
  // 而本函数的参数表此前根本不接受它、toolCtx 也不带，server.js 传的回调在签名这层就被丢掉，
  // 0929-03 那次「修复」实际从未生效：diary_add 写的日记两条路径都没落过时间线。
  const toolCtx = { serverClients, routes, upstreamUrl, upstreamKey, model, sessionId, onDiaryWritten, signal };

  let working = messages.slice();
  let totalUsage = null;
  let rounds = 0;
  let lastFinish = "", loopDone = false;   // 空回复兜底用：上游结束原因 / 是否正常收尾（模型不再要工具）

  // 收集思考链（reasoning_content）与工具调用记录（tool_trace）
  const reasoningParts = [];
  const toolHistory = [];
  // T-0922 修复：每一轮模型说过的话都收集（同轮"文本+工具调用"混合时文本不再丢弃），
  // 按轮次拼接为最终回复——与主流聊天一致："我帮你查一下" →（工具跑）→ 结果补充
  const contentParts = [];
  /* [位置:mcp/mcp-tool-loop.js·_runWithToolsCore streamTimeline] [非流式路径补时间线] [10-27：此前非流式兜底不产出 streamTimeline，前端拿到 undefined 退化为思考工具全堆开头；按轮内顺序 reasoning→text→tool 构建，与流式路径同构] [注释时间 2026-10-28] */
  const streamTimeline = [];

  // 方案2：逐轮即时回传。onEvent 把「本轮正文/思考 + 每个工具 start/end」实时推给调用方，
  // 供前端渲染工具卡与正文交错 + running→done 状态。落盘/缓存仍用 toolHistory（终态快照），不受影响。
  // 2026-09-21 审查 R7：onEvent 抛错（客户端断开）置 clientGone，工具循环随即中断，不再白烧 token
  let clientGone = false;
  const emit = (evt) => { try { if (typeof onEvent === "function") onEvent(evt); } catch (e) { clientGone = true; } };
  let toolSeq = 0;

  // 直通续跑模式（T-0922）：流式直通路径已把该 assistant 消息（含 tool_calls）透传给客户端，
  // 从"执行其工具"开始接续；其 content 客户端已见过，不进 contentParts（避免重复显示）
  if (resume && resume.assistantMsg) {
    const am = resume.assistantMsg;
    // 同主循环：续跑起点若带思考链也必须回传，否则 thinking mode 上游仍会 400。
    working.push({
      role: "assistant",
      content: am.content || "",
      reasoning_content: am.reasoning_content || undefined,
      tool_calls: am.tool_calls
    });
    await executeToolCalls(am.tool_calls || [], working, toolHistory, toolCtx);
  }

  for (let round = 0; round < maxToolRounds + 1; round++) {
    if (signal && signal.aborted) { const e = new Error("用户已停止生成"); e.name = "AbortError"; throw e; }
    if (clientGone) { console.log("[mcp] 客户端已断开，工具循环提前结束"); break; }
    rounds = round;
    const body = {
      model,
      messages: geminiSig.maybeStamp(working, upstreamUrl),
      stream: false,
      temperature,
      top_p,
      max_tokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(extraBody || {})
    };
    // 只在还有工具时注入 tools；最后一轮带 tools 定义但 tool_choice="none"：
    // 保持 tools 定义能让严格上游接受带 tool_calls/tool 历史的请求（历史里引用过的工具必须在 tools 里），
    // tool_choice="none" 阻止模型再发起新一轮工具调用
    if (round < maxToolRounds && openaiTools.length > 0) {
      body.tools = openaiTools;
      body.tool_choice = "auto";
    } else if (openaiTools.length > 0) {
      body.tools = openaiTools;
      body.tool_choice = "none";
      body.messages = geminiSig.maybeStamp(working.concat([{ role: "user", content: DSML_FORCED_NOTE }]), upstreamUrl);   // 11-04 同流式：最后一轮追加提示
    }

    const controller = new AbortController();
    const _abortFromParent = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", _abortFromParent, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    let resp;
    try {
      resp = await fetchFn(upstreamUrl, {
        method: "POST",
        headers: Object.assign({
          "Content-Type": "application/json",
          Authorization: `Bearer ${upstreamKey}`
        }, upstreamHeaders || {}),
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      // 2026-09-26：上游拉不到图片时整包 400，去图重试一次（与聊天侧图片降级同源保护）
      if (resp.status === 400 && _IMG_400_DEGRADE_RE.test(t) && stripImagePartsForDegrade(working)) {
        mcpLogWarn("[mcp] runWithTools 上游拉取图片失败(400)，去图后重试本轮");
        round--;
        continue;
      }
      // 2026-09-23 诊断（reasoning_content 400 定位用）：记录出错轮次与上下文中
      // 「带 tool_calls 的 assistant」及其 reasoning_content 覆盖情况——
      // 用于区分「首轮上下文问题」还是「后续轮回传问题」。定位到根因后可移除或降级。
      try {
        const _tcA = working.filter(function (m) { return m && m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length; });
        const _tcRc = _tcA.filter(function (m) { return typeof m.reasoning_content === "string" && m.reasoning_content.length > 0; });
        mcpLogWarn("[mcp-diag] runWithTools 上游失败: status=" + resp.status +
          " round=" + round + "/" + maxToolRounds +
          " model=" + model +
          " working=" + working.length +
          " assistantWithToolCalls=" + _tcA.length +
          " ofWhichHasRc=" + _tcRc.length +
          " tail3=" + working.slice(-3).map(function (m) { return (m && m.role) || "?"; }).join("/"));
      } catch (e) {}
      if (resp.status === 402) upstreamAlert.note402({ model, detail: t, sessionId }).catch(function () {});
      throw new Error(`上游请求失败 HTTP ${resp.status}: ${upstreamErrText(t)}`);
    }

    const data = await resp.json();
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error("上游返回无 choices");
    const msg = choice.message || {};
    const roundThinkingBlocks = normalizeThinkingBlocks(msg.thinking_blocks);
    const roundContentBlocks = normalizeAnthropicContentBlocks(msg.content_blocks);
    lastFinish = String(choice.finish_reason || "");
    if (data.usage) totalUsage = data.usage;
    const roundGrokItems2 = Array.isArray(data.grok_reasoning_items) ? data.grok_reasoning_items : null;   // 2026-11-16：非流式（子智能体兜底）同样接住思考项

    // 收集思考链（reasoning_content/reasoning 字段 + content 内 <think> 块，2026-09-29 MiniMax 修复）
    const _sp = splitThinkBlock(stripDsml(msg.content || ""));   // 11-04 DSML 泄漏：丢掉标记及之后
    const _rparts = [];
    const _rc = String(msg.reasoning_content || msg.reasoning || "").trim();
    if (_rc) _rparts.push(_rc);
    if (_sp.think) _rparts.push(_sp.think);
    const rtext = _rparts.join("\n").trim();
    if (rtext) { reasoningParts.push(rtext); streamTimeline.push({ type: "reasoning", text: rtext, ts: Date.now() }); emit({ type: "reasoning", text: rtext }); }

    // 收集本轮正文（<think> 块已剥离；混合轮文本保留，见 contentParts 注释）
    const ctext = _sp.body.trim();
    if (ctext) {
      contentParts.push(ctext);
      streamTimeline.push({ type: "text", text: ctext, ts: Date.now() });
      // 轮次间补一个空行分隔：保证客户端流式拼接的 full 与最终 text(contentParts.join("\n\n")) 一致，
      // 前端 makeMsgEl/segSplitText 按空行拆段与 afterSeg 才能对得上
      if (contentParts.length > 1) emit({ type: "text", text: "\n\n" });
      emit({ type: "text", text: ctext });
    }

    // 记录这一轮 assistant 消息（含 tool_calls 则保留）
    // 2026-09-23 修复：thinking mode 下必须把本轮思考链原样回传给上游，否则下一轮请求会被拒：
    //   HTTP 400 "The `reasoning_content` in the thinking mode must be passed back to the API"
    // 此前只 push 了 content/tool_calls，唤醒侧（wake-chat.js 走本函数）每轮都 400 失败、
    // 退化为「无工具直连」，工具能力实际失效（日志实测 35 次）。
    // 与 streamToolLoop 同口径：无思考链时传 undefined，让 JSON.stringify 省略该键。
    working.push({
      role: "assistant",
      content: _sp.body || "",
      reasoning_content: rtext,   // 2026-09-28：DeepSeek 要求所有 assistant 都带 rc（空串也可），不能省略
      thinking_blocks: roundThinkingBlocks.length ? roundThinkingBlocks : undefined,   // Claude 工具循环续轮必须原样回传（2026-10-28）
      anthropic_content_blocks: roundContentBlocks.length ? roundContentBlocks : undefined,   // 交错思考：thinking/tool_use 相对顺序必须原样
      grok_reasoning_items: roundGrokItems2 || undefined,   // 2026-11-16：Grok 思考项原样回传（不进前端）
      tool_calls: msg.tool_calls
    });

    // 没有 tool_calls -> 结束
    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) { loopDone = true; break; }

    // 执行每个 tool_call，并记录到 toolHistory 供前端展示（方案2：逐工具实时推 tool_start/tool_end）
    // afterSeg：工具所在轮正文之后、按空行粒度拆出的段下标（与前端 makeMsgEl 分段一致；-1=正文为空/最前）
    const _segCount = (txt) => String(txt || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).length;
    const _toolsBefore = toolHistory.length;
    await executeToolCalls(toolCalls, working, toolHistory, toolCtx, emit, () => toolSeq++, _segCount(contentParts.join("\n\n")) - 1);
    /* 非流式路径：新执行的工具进时间线（与流式路径同结构） */
    for (let _ti = _toolsBefore; _ti < toolHistory.length; _ti++) {
      const _tt = toolHistory[_ti] || {};
      streamTimeline.push({ type: "tool", tool: { index: _ti, id: "", name: _tt.name || "", args: _tt.args || "", status: _tt.error ? "failed" : "done", result: _tt.result || "", error: _tt.error || null }, ts: Date.now() });
    }
  }

  // 最终回复 = 各轮正文拼接；兜底：轮次耗尽模型全程没说过话时占位提示，
  // 避免 handleMcpRequest 因空文本跳过时间线写入、客户端收到无日志的空回复。
  // resume 模式除外：客户端已有直通文本，这里为空就空着，由调用方决定。
  let text = contentParts.join("\n\n").trim();
  const _ex = !loopDone && !clientGone;
  if (!text && !(resume && resume.assistantMsg)) {
    text = emptyReplyNotice({ exhausted: _ex, finishReason: lastFinish, toolCount: toolHistory.length, hadReasoning: reasoningParts.length > 0 });
    mcpLogWarn("[mcp] 空回复兜底: rounds=" + rounds + " finish=" + (lastFinish || "-") + " tools=" + toolHistory.length + " exhausted=" + _ex);
  } else if (_ex && text) {
    // 1024-01（2026-10-24）：轮次耗尽且已有中间正文——原来静默结束，用户看到的是"工具跑一半就没了"；
    // 现在正文后附加截断提醒（独立成段）。小手机 phone-talk.js 按「（工具调用轮次已达上限」前缀渲染成黄色「继续」按钮。
    // resume 模式 contentParts 恒空，走不到这里。
    text += "\n\n" + roundCapNotice(maxToolRounds);
    mcpLogWarn("[mcp] 轮次耗尽截断提醒已附加: rounds=" + rounds + " finish=" + (lastFinish || "-") + " tools=" + toolHistory.length);
  }
  /* 同流式路径：轮次提醒/空回复兜底写进时间线 */
  const _rawText = contentParts.join("\n\n").trim();
  if (text !== _rawText) {
    const _suffix = _rawText ? text.slice(_rawText.length) : text;
    if (_suffix) {
      const _lastTl = streamTimeline.length ? streamTimeline[streamTimeline.length - 1] : null;
      if (_lastTl && _lastTl.type === "text") _lastTl.text += _suffix;
      else streamTimeline.push({ type: "text", text: _suffix, ts: Date.now() });
    }
  }

  // 汇总思考链（截断上限）
  const reasoning = reasoningParts.join("\n\n").slice(0, MAX_REASONING_CHARS);

  // segments 按空行粒度拆（与前端 makeMsgEl 一致），工具 afterSeg 也以同一分段下标对齐
  const segs = String(text || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (!segs.length) segs.push(text || "");
  /* [位置:mcp-tool-loop.js·工具循环返回值 tools] [返回值带上实际发出的工具定义] [10-29 #46：tools 只活在循环内部，捕获侧拿不到当次真实清单；返回值带出后，server.js 捕获 lastLLM 时经第 4 参存进会话存档，统计页「工具定义」行才有数] [注释时间 2026-10-29] */
  return { text, rounds, usage: totalUsage, routes, reasoning, toolHistory, tools: openaiTools.slice(), streamTimeline: streamTimeline.slice(), segments: segs.slice(), finalMessages: working.slice() };
}

/* [位置:mcp-tool-loop.js·_applyToolImages/_pushRoundImages] [工具返回的图按模型分流] [10-27：能看图的模型 → 把图片链接作为本轮的 image_url 发给上游（role:tool 的消息带不了图，所以整轮工具结果之后补一条只存在于本轮 working 的 user 消息，不落时间线）；不能看图的模型 → 用后台「图片转写」模型转成文字追加进工具结果（按图片哈希缓存）；判断依据是供应商里勾的 vision_models。拿不到公开链接（没配 PUBLIC_BASE_URL）也走转写。永不抛错，失败只在结果里写原因] [注释时间 2026-10-27] */
async function _applyToolImages(result, name, model, roundImages) {
  try {
    if (!result || !Array.isArray(result.images) || !result.images.length) return;
    const vision = require("../lib/model-router").modelNameSupportsVision(model) && result.images.every(function (i) { return i.absUrl; });
    if (vision) { result.images.forEach(function (i) { roundImages.push({ name: name, url: i.absUrl }); }); return; }
    const toolImages = require("../lib/tool-images");
    const notes = [];
    for (let k = 0; k < result.images.length; k++) {
      const d = await toolImages.describeFor(result.images[k]);
      const tag = result.images.length > 1 ? "图片转写 " + (k + 1) : "图片转写";
      notes.push(d.text ? "[" + tag + "] " + d.text : "[" + tag + "失败：" + d.error + "]");
    }
    result.markdown = String(result.markdown || "") + "\n" + notes.join("\n");
  } catch (e) { /* 图片处理失败不影响工具结果本身 */ }
}
function _pushRoundImages(working, roundImages) {
  if (!roundImages.length) return;
  const parts = [];
  roundImages.forEach(function (im) {
    parts.push({ type: "text", text: "（工具 " + im.name + " 返回的图片）" });
    parts.push({ type: "image_url", image_url: { url: im.url } });
  });
  working.push({ role: "user", content: parts });
}

// 执行一批 tool_call：结果写入 working（供下一轮上游请求）与 toolHistory（供前端展示）
// 方案2 onEvent/nextIndex 可选：开启时每个工具实时推 tool_start（执行前）/tool_end（执行后），
// 前端据此渲染"执行中→已完成/失败"状态卡；index 用于配对 start/end。老调用不传则跳过（兼容）。
// 2026-09-22 用户拍板：单轮工具数上限取消（AI 实际很少用工具，上限反而制造两份实现漂移）——
// 本函数与 streamToolLoop 现在都不限额；轮数仍由 maxToolRounds 兜底。
async function executeToolCalls(toolCalls, working, toolHistory, ctx, onEvent, nextIndex, afterSeg) {
  const { serverClients, routes, upstreamUrl, upstreamKey, model } = ctx;
  const roundImages = [];
  for (let _i = 0; _i < toolCalls.length; _i++) {
    if (ctx.signal && ctx.signal.aborted) { const e = new Error("用户已停止生成"); e.name = "AbortError"; throw e; }
    const tc = toolCalls[_i];
    const fn = tc.function || {};
    const name = fn.name || "";
    const args = _parseArgs(fn.arguments);
    _injectSessionArg(name, args, ctx.sessionId);
    const _rb = _takeRebuildFlag(args); if (_rb) _markRebuild(ctx.sessionId);
    const index = (typeof nextIndex === "function") ? nextIndex() : toolHistory.length;
    const id = tc.id || ("call_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7));
    const toolTime = _toolCallTime();   // 调用时间=执行起点，进模型上下文与 toolHistory 同一份
    let result;
    let error = null;
    try {
      if (typeof onEvent === "function") onEvent({ type: "tool_start", index, id, name, args: _persistArgs(name, args), afterSeg: (typeof afterSeg === "number") ? afterSeg : -1 });
      result = await callToolByExposedName(serverClients, routes, name, args);
    } catch (e) {
      error = e.message || String(e);
      result = { markdown: JSON.stringify({ type: "tool_error", error: "mcp_service_error", message: error }) };
    }
    if (_rb && result) result.markdown = String(result.markdown || "") + REBUILD_NOTE;
    if (!error) await _applyToolImages(result, name, model, roundImages);
    const resTrunc = _truncateResult(result.markdown || "", error ? 0 : 20000);
    working.push({
      role: "tool",
      tool_call_id: id,
      // 来源标记：工具名+调用时间+状态（成功/失败/空返回显式），模型不必靠内容特征猜；
      // 截断超大工具结果：时间线/后续轮次上下文都不需要完整大结果，30k 字符足够模型引用
      content: buildToolResultContent({ name, time: toolTime, error: error || null, markdown: UNTRUNCATED_RESULT_TOOLS.has(name) ? String(result.markdown || "") : _truncateResult(result.markdown || "", MAX_TOOL_RESULT_CHARS) })
    });
    toolHistory.push({
      name,
      args: _persistArgs(name, args),
      time: toolTime,
      result: resTrunc,
      error,
      afterSeg: (typeof afterSeg === "number") ? afterSeg : -1   // 方案2刷新：该工具位于第 afterSeg 段正文之后（-1=最前）
    });
    _notifyDiaryWritten(name, args, error, result, ctx.onDiaryWritten, ctx.sessionId);
    if (typeof onEvent === "function") onEvent({ type: "tool_end", index, id, name, args, result: resTrunc, error, ok: !error, afterSeg: (typeof afterSeg === "number") ? afterSeg : -1 });
  }
  _pushRoundImages(working, roundImages);
}

// 2026-10-27：图片 400 去图重试的识别范围（runWithTools/streamToolLoop 两处共用）。
// 原来只认「failed to download image」（上游拉不到图）；10-25 表情包出口转图上线后撞出两类新拒法——
// deepseek 拒 assistant 带图（"Image in assistant message is not supported"，s_mvo5eqoq_zt7gmy 每发必炸）、
// GLM 端点拒一切图（code 1210 "messages.content.type 参数非法"）——都按同款兜底剥图重试。
// 转图侧（routes/chat.js）已收紧为只转 user 消息，这里兜历史里已有的图和漏网模型。
const _IMG_400_DEGRADE_RE = /failed to download image|timed out while trying to download the file|Image in assistant message is not supported|messages\.content\.type[^"']*参数非法/i;

// 2026-09-26 查岗截图配套：上游拉不到图片（CDN 拦截/文件失效）会整包 400。与聊天侧同款
// 保护——把消息里的 image_url 部件换成占位文本，调用方重试一次。返回是否发生了降级。
function stripImagePartsForDegrade(working) {
  let degraded = false;
  for (const m of working) {
    if (!m || !Array.isArray(m.content)) continue;
    for (let i = 0; i < m.content.length; i++) {
      const p = m.content[i];
      if (p && p.type === "image_url") {
        m.content[i] = { type: "text", text: "（图片暂时无法读取，本轮已省略）" };
        degraded = true;
      }
    }
  }
  return degraded;
}

// 解析 function 的 arguments（可能是字符串或对象）
// 模型没产出任何可见正文时的占位提示：按真实原因说，别一律说「工具调用轮次已达上限」。
//   exhausted：循环跑满轮数仍没收尾（真·轮次耗尽）；finishReason：上游给的结束原因；toolCount：本次用过几次工具
function emptyReplyNotice(info) {
  const i = info || {};
  if (i.exhausted) return "（工具调用轮次已达上限，模型未给出最终回复，请重试或简化请求）";
  if (i.finishReason === "length") {
    return i.hadReasoning
      ? "（模型的输出额度被思考用完了，没来得及写出回复。请重试，或在设置里调大最大输出长度）"
      : "（模型输出被长度上限截断，没有生成可见回复。请重试，或在设置里调大最大输出长度）";
  }
  if (i.finishReason === "content_filter") return "（回复被上游的内容安全过滤拦下了，没有生成内容，换个说法重试看看）";
  if (i.toolCount > 0) return "（模型调用了工具，但没有给出最终回复，请重试）";
  return i.hadReasoning
    ? "（模型只想了一通，没有写出回复，请重试）"
    : "（模型空回复，请重试）";
}

// 1024-01（2026-10-24）：轮次耗尽但已有中间正文时的收尾提醒（原来看不见，用户只觉得"断掉了"）。
// 前缀「（工具调用轮次已达上限」是小手机 phone-talk.js 的识别锚点（渲染成黄色「继续」按钮），改措辞需两端同步。
function roundCapNotice(maxRounds) {
  // 1028-01：maxToolRounds=Infinity（主聊天/子智能体不限轮）时本函数理论不可达（_ex 恒 false），防御一下防未来误用显示「Infinity 轮」；锚点前缀「（工具调用轮次已达上限」不能变（phone-talk.js「继续」按钮识别）
  if (!isFinite(maxRounds)) return "（工具调用轮次已达上限，回答在这里中断。发「继续」可接着做。）";
  return "（工具调用轮次已达上限（" + maxRounds + " 轮），回答在这里中断。发「继续」可接着做。）";
}

function _parseArgs(args) {
  if (args == null) return {};
  if (typeof args === "object") return args;
  if (typeof args === "string") {
    try { return JSON.parse(args) || {}; } catch (e) { return {}; }
  }
  return {};
}

// 截断工具返回摘要，避免 tool_trace 过大
function _truncateResult(text, max = 800) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// 工具调用时间（精确到秒）；调用时间取执行起点，跨轮回灌时随 toolHistory 落盘复用。
// 2026-09-13 审查修复：改用可配置 TIME_ZONE（与 server.js 同一 resolveTimeZone 口径）——
// 此前硬编码 UTC+8，非 +8 时区部署时工具调用时间戳会错 8 小时并随 toolHistory 进模型上下文
const { getDatePartsInTimeZone, resolveTimeZone } = require("../utils/time_utils");
const TOOLCALL_TIME_ZONE = resolveTimeZone();
function _toolCallTime(d = new Date()) {
  const p = getDatePartsInTimeZone(d, TOOLCALL_TIME_ZONE);
  return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second;
}

// 工具结果进模型上下文的统一标头（与 routes/chat.js 跨轮回灌转换保持同一格式，两处改要同步）：
// 让模型明确知道「这是工具 X 在时间 T 返回的」，不靠内容特征猜；
// 失败/空返回显式标注，绝不静默省略或给空字符串。
/* [位置:mcp-tool-loop.js·compactPrettyJson] [缩进格式的 JSON 结果压成单行] [10-28 第7项复核：老工具结果落盘时是 indent=2 的缩进 JSON，回放给 AI 白占 10-20% 字符；只在整段是「缩进排版的合法 JSON」时才压（其它文本、被截断的不动），JSON.parse→stringify 保留中文不转义；buildToolResultContent 是轮内与回放的唯一出口，两边口径一致，不会让前缀缓存左右不一] [注释时间 2026-10-28] */
function compactPrettyJson(text) {
  const t = String(text == null ? "" : text);
  if (!/^\s*[\[{]\s*\n/.test(t)) return t;
  try { const c = JSON.stringify(JSON.parse(t)); return c.length < t.length ? c : t; } catch (e) { return t; }
}
function buildToolResultContent({ name, time, error, markdown }) {
  const body = compactPrettyJson(String(markdown ?? "").trim());
  const status = error ? "失败" : (body ? "成功" : "成功但无返回内容");
  const lines = [
    "[工具调用结果]",
    "工具：" + (name || "unknown"),
    "调用时间：" + (time || _toolCallTime()),
    "状态：" + status
  ];
  if (error) lines.push("错误信息：" + error);
  if (body) { lines.push("----"); lines.push(body); }
  return lines.join("\n");
}

/**
 * 流式工具循环（2026-09-09，修复「用工具慢 + 工具卡堆末尾」）：
 * 全程以 stream:true 请求上游，正文/思考链增量实时回传，工具参数在某轮齐了就就地执行
 * （onEvent 推 tool_start/tool_end，前端据此内联渲染工具卡），再把工具结果喂回上游继续流式补正文。
 * 与 runWithTools 同返回结构；调用方可在抛错时回退 runWithTools（失败兜底）。
 * 关键：不再整轮非流式等待，正文秒出；工具卡按真实到达顺序内联。
 */
async function _streamToolLoopCore({
  upstreamUrl,
  upstreamKey,
  upstreamHeaders,
  model,
  messages,
  serverClients,
  temperature,
  top_p,
  max_tokens,
  maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
  reasoningEffort = null,
  extraBody = null,   /* [位置:mcp-tool-loop.js·streamToolLoop extraBody] [流式引擎透传思考参数] [同 _runWithToolsCore：子智能体上锁思考用；不传=行为不变] [注释时间 2026-11-09] */
  pullInjected = null,   // 11-04 发送排队：每轮请求上游前取走用户中途排队的消息（返回 [{id,text}]），作为 user 消息插进去
  hasInjected = null,    // 11-04：有没有排队中的消息（AI 这一轮没调工具、本该结束时，有排队就多跑一轮去回应）
  onEvent = null,
  fetchFn = fetch,
  sessionId = null,
  onDiaryWritten = null,
  snapshotV2 = null,
  baseDir = null,
  signal = null,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
  liveTimeline = null   /* [位置:mcp-tool-loop.js·liveTimeline] [调用方共享的实时时间线数组] [10-27 批1：子会话抽屉要像普通会话一样实时看——调用方传入数组，引擎直接往里 push 思考/正文/工具节点（原来是内部 const，收尾才返回），调用方随时可读；不传则行为不变] [注释时间 2026-10-27] */
}) {
  fetchFn = egressGuard.wrapFetchFn(fetchFn);
  const openaiTools = await getToolsForSession(snapshotV2, baseDir, sessionId, serverClients);
  // 1007-17 修复：同上——本函数返回值里也引用了 routes（原加载被 getToolsForSession 替换后
  // 就没人定义了）。这是「回复整条丢失」的直接原因：流程全部跑完、到最后 return 才抛错，
  // catch 拿不到 r，外层只能回退。
  const routes = await loadToolsFor(baseDir, sessionId, serverClients);
  let working = messages.slice();
  let totalUsage = null;
  let rounds = 0;
  let lastFinish = "", loopDone = false;   // 空回复兜底用：上游结束原因 / 是否正常收尾（模型不再要工具）
  const reasoningParts = [];
  const toolHistory = [];
  const streamTimeline = Array.isArray(liveTimeline) ? liveTimeline : [];
  /* [位置:mcp/mcp-tool-loop.js·pushReasoningNode] [思考节点进时间线] [每轮思考增量按真实先后写进 streamTimeline（{type:'reasoning'}），小手机抽屉据此交替显示 思考->工具->思考；只影响显示用的 stream_timeline，不碰 working（发给上游的消息）与 reasoning 总字符串] [注释时间 2026-10-21]
     2026-11-18 加 ts：全文件时间线节点统一带 ts（=节点进入时间线的时刻，ms）——小手机极简主题据此算每段思考耗时（下一节点 ts − 本节点 ts）；合并增量不改 ts（起点不变）] */
  function pushReasoningNode(t) {
    if (!t) return;
    const last = streamTimeline.length ? streamTimeline[streamTimeline.length - 1] : null;
    if (last && last.type === "reasoning") last.text += t;
    else streamTimeline.push({ type: "reasoning", text: t, ts: Date.now() });
  }
  const contentParts = [];
  let toolSeq = 0;
  // 2026-09-21 审查 R7：客户端断开标志（onEvent 抛错即置位），读取与工具循环据此中断
  let clientGone = false;
  const emit = (evt) => { try { if (typeof onEvent === "function") onEvent(evt); } catch (e) { clientGone = true; } };

  for (let round = 0; round < maxToolRounds + 1; round++) {
    if (signal && signal.aborted) { const e = new Error("用户已停止生成"); e.name = "AbortError"; throw e; }
    // 普通客户端断线不取消；只有明确的 stop API 会触发 signal。
    rounds = round;
    if (round > 0 && typeof pullInjected === "function") {
      try { const _inj = pullInjected(); if (Array.isArray(_inj)) _inj.forEach(function (x) { if (x && String(x.text || "").trim()) working.push({ role: "user", content: String(x.text) }); }); } catch (e) { mcpLogWarn("[mcp] 取排队消息失败: " + (e && e.message)); }
    }
    /* [位置:mcp-tool-loop.js·streamToolLoop 请求体] [流式固定要 usage 帧] [11-16：xAI（Grok）流式默认不回 usage，tokens 落盘就恒 null；固定带 stream_options.include_usage（OpenAI 兼容通用字段），Gemini/Claude 内部代理忽略未知字段。同一行的 reasoning_effort 由调用方按 upstream-target.grokEffortFor 归一后传入，Grok 走顶层] [注释时间 2026-11-16] */
    const body = { model, messages: geminiSig.maybeStamp(working, upstreamUrl), stream: true, stream_options: { include_usage: true }, temperature, top_p, max_tokens, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), ...(extraBody || {}) };
    let _dsmlForced = false;   // 2026-11-14：被禁调工具的最后一轮才开 DSML 泄漏闸，普通轮正文引用标记不腰斩
    if (round < maxToolRounds && openaiTools.length > 0) { body.tools = openaiTools; body.tool_choice = "auto"; }
    else if (openaiTools.length > 0) { _dsmlForced = true; body.tools = openaiTools; body.tool_choice = "none"; body.messages = geminiSig.maybeStamp(working.concat([{ role: "user", content: DSML_FORCED_NOTE }]), upstreamUrl); }   // 11-04：最后一轮追加「别再调工具」提示，不落进 working

    const controller = new AbortController();
    const _abortFromParent = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", _abortFromParent, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    let resp;
    try {
      resp = await fetchFn(upstreamUrl, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json", Authorization: `Bearer ${upstreamKey}` }, upstreamHeaders || {}),
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
      // 保留 parent abort 监听直到流式 reader 结束；fetch 返回 headers 不代表正文已读完。
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      // 2026-09-26：上游拉不到图片时整包 400，去图重试一次（与聊天侧图片降级同源保护）
      if (resp.status === 400 && _IMG_400_DEGRADE_RE.test(t) && stripImagePartsForDegrade(working)) {
        mcpLogWarn("[mcp] streamToolLoop 上游拉取图片失败(400)，去图后重试本轮");
        round--;
        continue;
      }
      // 2026-09-23 诊断：同 runWithTools，记录轮次与带 tool_calls 的 assistant 的 rc 覆盖情况
      try {
        const _tcA = working.filter(function (m) { return m && m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length; });
        const _tcRc = _tcA.filter(function (m) { return typeof m.reasoning_content === "string" && m.reasoning_content.length > 0; });
        mcpLogWarn("[mcp-diag] streamToolLoop 上游失败: status=" + resp.status +
          " round=" + round + "/" + maxToolRounds +
          " model=" + model +
          " working=" + working.length +
          " assistantWithToolCalls=" + _tcA.length +
          " ofWhichHasRc=" + _tcRc.length);
      } catch (e) {}
      if (resp.status === 402) upstreamAlert.note402({ model, detail: t, sessionId }).catch(function () {});
      throw new Error(`上游请求失败 HTTP ${resp.status}: ${upstreamErrText(t)}`);
    }
    if (!resp.body) throw new Error("上游无响应体");

    // 流式读取：正文/思考链实时 emit；tool_calls 分片聚合成整轮工具
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let roundContent = "";
    let roundReasoning = "";
    let roundGrokItems = [];   // 2026-11-16：Grok 走 Responses 时本轮思考项（含 encrypted_content），挂回 assistant 供下一轮原样回传
    let seenContent = false;
    const thinkStripper = createThinkStripper();
    const dsmlGate = makeDsmlGate();
    if (!_dsmlForced) dsmlGate.setActive(false);   // 2026-11-14：普通轮不开闸——讲解/引用 DSML 标记的正文是合法内容（实证被腰斩 4 条）
    const toolCallAcc = [];
    let roundThinkingBlocks = [];
    let roundContentBlocks = [];
    const accToolCall = (tcs) => {
      for (const tc of (tcs || [])) {
        if (!tc) continue;
        const idx = typeof tc.index === "number" ? tc.index : 0;
        let slot = toolCallAcc[idx];
        if (!slot) {
          slot = toolCallAcc[idx] = { id: "", name: "", args: "", eventIndex: null, startSent: false };
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function && tc.function.name) slot.name += tc.function.name;
        if (typeof tc.function.arguments === "string") {
          const deltaArgs = tc.function.arguments;
          slot.args += deltaArgs;
          if (slot.eventIndex !== null) emit({ type: "tool_args_delta", index: slot.eventIndex, id: slot.id, delta: deltaArgs });
        }
        // 第一次拿到工具名时分配最终全局 index；start/end 永远复用它。
        if (slot.name && slot.eventIndex === null) {
          slot.eventIndex = toolSeq++;
          slot.startSent = true;
          const toolNode = { type: "tool", tool: { index: slot.eventIndex, id: slot.id, name: slot.name, args: slot.args || "", status: "running", result: "", error: null }, ts: Date.now() };
          streamTimeline.push(toolNode);
          emit({ type: "tool_start", index: slot.eventIndex, id: slot.id, name: slot.name, args: slot.args || "" });
        }
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // 客户端断开不取消上游流——网关继续跑完，结果存时间线，前端重连后可见
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).replace(/^\s+/, "");
        if (!payload || payload === "[DONE]") continue;
        let evt; try { evt = JSON.parse(payload); } catch { continue; }
        if (evt && Array.isArray(evt.grok_reasoning_items) && evt.grok_reasoning_items.length) roundGrokItems = evt.grok_reasoning_items;
        // 1008-16 修复：Kimi/Moonshot 等上游的 usage 帧 choices 为空数组，此前被 !choice continue 跳过 → 落盘 tokens 恒 null
        if (evt && evt.usage) totalUsage = evt.usage;
        // anthropic-proxy 终帧顶层带 thinking_blocks（含签名），轮内接住，下一轮原样回传
        if (Array.isArray(evt.thinking_blocks)) roundThinkingBlocks = normalizeThinkingBlocks(evt.thinking_blocks);
        if (Array.isArray(evt.content_blocks)) roundContentBlocks = normalizeAnthropicContentBlocks(evt.content_blocks);
        const choice = evt && evt.choices && evt.choices[0]; if (!choice) continue;
        if (choice.finish_reason) lastFinish = String(choice.finish_reason);
        const delta = choice.delta || {};
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length) {
          roundReasoning += delta.reasoning_content;
          pushReasoningNode(delta.reasoning_content);
          emit({ type: "reasoning", text: delta.reasoning_content });
        }
        if (typeof delta.content === "string" && delta.content.length) {
          // 2026-10-01 MiniMax：content 内 <think> 块跨帧剥离进思考链（streamToolLoop 此前漏修，补齐）
          // 不在后端注入任何“气泡分隔符”。气泡分隔符属于前端配置，工具/正文顺序由事件时间线保存。
          thinkStripper.push(delta.content, function (cleanText) {
            cleanText = dsmlGate.push(cleanText);
            if (!cleanText) return;
            seenContent = true;
            roundContent += cleanText;
            const lastTimeline = streamTimeline.length ? streamTimeline[streamTimeline.length - 1] : null;
            if (lastTimeline && lastTimeline.type === "text") lastTimeline.text += cleanText;
            else streamTimeline.push({ type: "text", text: cleanText, ts: Date.now() });
            emit({ type: "text", text: cleanText });
          });
          const _thinkDelta = thinkStripper.takeThinking();
          if (_thinkDelta) { roundReasoning += _thinkDelta; pushReasoningNode(_thinkDelta); emit({ type: "reasoning", text: _thinkDelta }); }
        }
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) accToolCall(delta.tool_calls);
        if (evt.usage) totalUsage = evt.usage;
      }
    }
    // 上游最后一帧可能没有换行；把残留 SSE 行补处理。
    buf += decoder.decode();
    if (buf.trim()) {
      const trimmed = buf.endsWith("\r") ? buf.slice(0, -1) : buf;
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.slice(5).replace(/^\s+/, "");
        if (payload && payload !== "[DONE]") {
          let evt; try { evt = JSON.parse(payload); } catch { evt = null; }
          if (evt && Array.isArray(evt.grok_reasoning_items) && evt.grok_reasoning_items.length) roundGrokItems = evt.grok_reasoning_items;
          if (evt && evt.usage) totalUsage = evt.usage;
          if (Array.isArray(evt.thinking_blocks)) roundThinkingBlocks = normalizeThinkingBlocks(evt.thinking_blocks);
          if (Array.isArray(evt.content_blocks)) roundContentBlocks = normalizeAnthropicContentBlocks(evt.content_blocks);
          const choice = evt && evt.choices && evt.choices[0];
          if (choice) {
            if (choice.finish_reason) lastFinish = String(choice.finish_reason);
            const delta = choice.delta || {};
            if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length) {
              roundReasoning += delta.reasoning_content;
              pushReasoningNode(delta.reasoning_content);
              emit({ type: "reasoning", text: delta.reasoning_content });
            }
            if (typeof delta.content === "string" && delta.content.length) {
              thinkStripper.push(delta.content, function (cleanText) {
                cleanText = dsmlGate.push(cleanText);
                if (!cleanText) return;
                seenContent = true;
                roundContent += cleanText;
                const lastTimeline = streamTimeline.length ? streamTimeline[streamTimeline.length - 1] : null;
                if (lastTimeline && lastTimeline.type === "text") lastTimeline.text += cleanText;
                else streamTimeline.push({ type: "text", text: cleanText, ts: Date.now() });
                emit({ type: "text", text: cleanText });
              });
              const _thinkDelta = thinkStripper.takeThinking();
              if (_thinkDelta) { roundReasoning += _thinkDelta; pushReasoningNode(_thinkDelta); emit({ type: "reasoning", text: _thinkDelta }); }
            }
            if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) accToolCall(delta.tool_calls);
            if (evt.usage) totalUsage = evt.usage;
          }
        }
      }
    }
    if (roundReasoning) reasoningParts.push(roundReasoning);
    thinkStripper.flush();
    {
      // 11-04 DSML 闸：扣住的尾巴放出来；若泄漏了标记且这一轮没剩任何正文、也没有真工具调用，补一句说明
      const _gt = dsmlGate.flush();
      if (_gt) {
        seenContent = true; roundContent += _gt;
        const lastTimeline = streamTimeline.length ? streamTimeline[streamTimeline.length - 1] : null;
        if (lastTimeline && lastTimeline.type === "text") lastTimeline.text += _gt; else streamTimeline.push({ type: "text", text: _gt, ts: Date.now() });
        emit({ type: "text", text: _gt });
      }
      if (dsmlGate.leaked && !roundContent.trim() && !toolCallAcc.some(Boolean)) {
        seenContent = true; roundContent = DSML_EMPTY_NOTE;
        streamTimeline.push({ type: "text", text: DSML_EMPTY_NOTE, ts: Date.now() });
        emit({ type: "text", text: DSML_EMPTY_NOTE });
      }
    }
    if (seenContent) contentParts.push(roundContent);

    // 客户端断开后继续执行工具——结果要攒下来写入时间线
    const toolCalls = toolCallAcc.map(function (s, i) {
      if (!s || !s.name) return null;
      return { _sourceIndex: i, id: s.id || ("call_" + Date.now() + "_" + i), type: "function", function: { name: s.name, arguments: s.args || "{}" } };
    }).filter(Boolean);
    working.push({ role: "assistant", content: roundContent || "", reasoning_content: roundReasoning, thinking_blocks: roundThinkingBlocks.length ? roundThinkingBlocks : undefined, anthropic_content_blocks: roundContentBlocks.length ? roundContentBlocks : undefined, grok_reasoning_items: roundGrokItems.length ? roundGrokItems : undefined, tool_calls: toolCalls.length ? toolCalls : undefined });   // 2026-11-16：Grok 的 reasoning 项（含 encrypted_content）随 assistant 挂住，下一轮由 grok-responses 原样放回 input；不进前端/时间线   // 2026-09-28：rc 空串也保留；2026-10-28：Claude 思考块按原顺序回传
    if (!toolCalls.length) {
      if (typeof hasInjected === "function" && round < maxToolRounds) { let _has = false; try { _has = !!hasInjected(); } catch (e) {} if (_has) continue; }   // 11-04：有排队消息就再跑一轮去回应它
      loopDone = true; break;
    }

    const roundImages = [];
    for (let i = 0; i < toolCalls.length; i++) {
      if (signal && signal.aborted) { const e = new Error("用户已停止生成"); e.name = "AbortError"; throw e; }
      const tc = toolCalls[i];
      const fn = tc.function || {}; const name = fn.name || "";
      const args = _parseArgs(fn.arguments);
      _injectSessionArg(name, args, sessionId);
      const _rb = _takeRebuildFlag(args); if (_rb) _markRebuild(sessionId);
      const slot = toolCallAcc[typeof tc._sourceIndex === "number" ? tc._sourceIndex : i] || null;
      const index = slot && slot.eventIndex !== null ? slot.eventIndex : toolSeq++;
      const id = tc.id;
      const toolTime = _toolCallTime();   // 调用时间=执行起点
      // tool_start 已在上游流中实时发出；只有异常情况下没拿到名字的才补发。
      if (!slot || !slot.startSent) {
        streamTimeline.push({ type: "tool", tool: { index, id, name, args: "", status: "running", result: "", error: null }, ts: Date.now() });
        emit({ type: "tool_start", index, id, name, args: "" });
      }
      let result, error = null;
      try { result = await callToolByExposedName(serverClients, routes, name, args); }
      catch (e) { error = e.message || String(e); result = { markdown: JSON.stringify({ type: "tool_error", error: "mcp_service_error", message: error }) }; }
      // 1004-11：落盘/前端 20KB 截断（防 assistant.tools 膨胀）；发给模型的走 MAX_TOOL_RESULT_CHARS(30KB)，
      // 模型可见更全、落盘瘦身——两条口径有意不同，勿合并。
      if (_rb && result) result.markdown = String(result.markdown || "") + REBUILD_NOTE;
      if (!error) await _applyToolImages(result, name, model, roundImages);
      const resTrunc = _truncateResult(result.markdown || "", error ? 0 : 20000);
      // 来源标记：与 executeToolCalls 同一格式（工具名+调用时间+状态+结果，空/失败显式）
      working.push({ role: "tool", tool_call_id: id, content: buildToolResultContent({ name, time: toolTime, error, markdown: UNTRUNCATED_RESULT_TOOLS.has(name) ? String(result.markdown || "") : _truncateResult(result.markdown || "", MAX_TOOL_RESULT_CHARS) }) });
      toolHistory.push({ name, args: _persistArgs(name, args), time: toolTime, result: resTrunc, error });
      // 2026-10-03：与 executeToolCalls 同口径补齐——流式主路径此前漏写，diary_add 日记不落时间线
      _notifyDiaryWritten(name, args, error, result, onDiaryWritten, sessionId);
      const timelineTool = streamTimeline.find(function (n) { return n && n.type === "tool" && n.tool && n.tool.index === index; });
      if (timelineTool && timelineTool.tool) {
        // 工具名/ID 可能在流的早期尚未到齐；终态必须把完整身份回填到 canonical timeline。
        timelineTool.tool.id = id;
        timelineTool.tool.name = name;
        timelineTool.tool.args = args;
        timelineTool.tool.time = toolTime;
        timelineTool.tool.result = resTrunc;
        timelineTool.tool.error = error;
        timelineTool.tool.status = error ? "failed" : "done";
      }
      emit({ type: "tool_end", index, id, name, args, result: resTrunc, error, ok: !error });
    }
    _pushRoundImages(working, roundImages);
  }

  let text = contentParts.join("\n\n").trim();
  const _ex = !loopDone && !clientGone;
  if (!text) {
    text = emptyReplyNotice({ exhausted: _ex, finishReason: lastFinish, toolCount: toolHistory.length, hadReasoning: reasoningParts.length > 0 });
    mcpLogWarn("[mcp] 空回复兜底(流式): rounds=" + rounds + " finish=" + (lastFinish || "-") + " tools=" + toolHistory.length + " exhausted=" + _ex);
  } else if (_ex && text) {
    // 1024-01（2026-10-24）：同 runWithTools——轮次耗尽不再静默，正文后附加截断提醒（独立成段）
    text += "\n\n" + roundCapNotice(maxToolRounds);
    mcpLogWarn("[mcp] 轮次耗尽截断提醒已附加(流式): rounds=" + rounds + " finish=" + (lastFinish || "-") + " tools=" + toolHistory.length);
  }
  /* [位置:mcp/mcp-tool-loop.js·_streamToolLoopCore 时间线同步提醒] [轮次提醒/空回复兜底写进时间线] [10-27：此前只改正文不进 streamTimeline，前端 tlCheck 判定不等 → 整条退化为思考工具全堆开头；把追加的提醒同步进最后一个 text 节点，新消息时间线与正文直接对得上] [注释时间 2026-10-28] */
  const _rawText = contentParts.join("\n\n").trim();
  if (text !== _rawText) {
    const _suffix = _rawText ? text.slice(_rawText.length) : text;
    if (_suffix) {
      const _lastTl = streamTimeline.length ? streamTimeline[streamTimeline.length - 1] : null;
      if (_lastTl && _lastTl.type === "text") _lastTl.text += _suffix;
      else streamTimeline.push({ type: "text", text: _suffix, ts: Date.now() });
    }
  }
  const reasoning = reasoningParts.join("\n\n").slice(0, MAX_REASONING_CHARS);
  const segs = String(text || "").split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!segs.length) segs.push(text || "");
  /* [位置:mcp-tool-loop.js·工具循环返回值 tools] [返回值带上实际发出的工具定义] [10-29 #46：tools 只活在循环内部，捕获侧拿不到当次真实清单；返回值带出后，server.js 捕获 lastLLM 时经第 4 参存进会话存档，统计页「工具定义」行才有数] [注释时间 2026-10-29] */
  return { text, rounds, usage: totalUsage, routes, reasoning, toolHistory, tools: openaiTools.slice(), streamTimeline: streamTimeline.slice(), segments: segs.slice(), finalMessages: working.slice() };
}


/**
 * 把最终文本 + 思考链 + 工具记录转成 OpenAI 兼容 SSE 流。
 * 事件顺序：思考链 → 工具记录(tool_trace) → 正文 content → 结束。
 * 注意：这是伪流式——事件虽按小块切分，但整包一次性 enqueue 下发（无逐块延迟），
 * 仅保证客户端走与真流式相同的解析路径。
 * @returns {ReadableStream}
 */
function buildSSE(text, {
  model = "",
  finishReason = "stop",
  usage = null,
  reasoning = "",
  toolHistory = [],
  finalContent = null,      // 2026-09-24 B3：最终落盘版 content（含标签 storedText 口径），结尾帧以 final_content 下发
  finalTimeline = null      // 2026-09-24 B3：最终落盘版精简 timeline，结尾帧以 final_stream_timeline 下发
} = {}) {
  const enc = new TextEncoder();
  const events = [];
  const base = () => ({
    id: "chatcmpl-mcp",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model
  });
  const push = (obj) => events.push(`data: ${JSON.stringify(obj)}\n\n`);

  // 1. 思考链（reasoning_content）分块流出
  const rs = 60;
  for (let i = 0; i < reasoning.length; i += rs) {
    push({
      ...base(),
      choices: [{ index: 0, delta: { reasoning_content: reasoning.slice(i, i + rs) }, finish_reason: null }]
    });
  }

  // 2. 工具调用记录：一次性以 delta.tool_trace 下发，前端据此渲染工具胶囊
  if (toolHistory && toolHistory.length) {
    push({
      ...base(),
      choices: [{ index: 0, delta: { tool_trace: toolHistory }, finish_reason: null }]
    });
  }

  // 3. 正文 content 分块流出
  const size = 24;
  for (let i = 0; i < text.length; i += size) {
    push({
      ...base(),
      choices: [{ index: 0, delta: { content: text.slice(i, i + size) }, finish_reason: null }]
    });
  }

  // 4. 结尾（usage / finish_reason）
  push({
    ...base(),
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    usage,
    // 2026-09-24 B3：最终落盘版数据随流下发——自建前端据此落盘，与服务器时间线字节级一致，
    // 补拉不再触发数据替换。顶层字段（与 usage 平级），第三方客户端忽略未知字段，向后兼容；
    // 未提供时不下发（前端退回自己的映射，行为同旧版）。
    ...(finalContent != null ? { final_content: finalContent } : {}),
    ...(finalTimeline != null ? { final_stream_timeline: finalTimeline } : {})
  });
  events.push("data: [DONE]\n\n");

  const data = events.join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(data));
      controller.close();
    }
  });
}


async function runWithTools(opts) { try { return await _runWithToolsCore(opts); } finally { _flushRebuild(opts && opts.sessionId); } }
/* [位置:mcp-tool-loop.js·DSML 泄漏防护] [被禁止调工具的最后一轮（tool_choice=none），deepseek 系模型仍想调工具，把调用写成 <｜｜DSML｜｜calls>、<｜invoke> 等文本标记当正文吐出来] [11-04：唤醒会话（限 10 轮）用完工具轮次后，正文里直接出现一屏 DSML 标记。2026-11-14 复盘修正：泄漏实证全部发生在「被禁止调工具的轮次」（10-27 子会话、11-04 唤醒都是 tool_choice=none 那一轮）；普通轮正文里的标记几乎必然是讲解/引用（实证：本会话 4 条讲解 DSML 的回复被旧闸腰斩）——闸只在被禁调工具的轮次开（streamToolLoop 里 setActive），普通轮不碰正文；匹配面扩到孤立 invoke/parameter/tool_calls 及闭合标记（vLLM #49117 同类形态，全角半角竖线都认）] [注释时间 2026-11-14 改] */
const DSML_RE = /<[｜|]{1,3}\s*DSML/i;   // 历史清洗（stripDsml）用：只认 DSML 特征，讲解/引用不腰斩
const LEAK_RE = /<\s*\/?\s*[｜|]{1,3}\s*(?:DSML|tool_calls|invoke|parameter)/i;   // 泄漏闸用：覆盖无 DSML 前缀的孤立调用标签
const DSML_FORCED_NOTE = "[系统] 工具调用次数已用完，这一轮不能再调用任何工具（写成文本标记也不会执行）。请直接用文字汇报：已经完成了什么、现在卡在哪、下一步建议；需要继续的话，让对方回复「继续」。";
const DSML_EMPTY_NOTE = "（这一轮的工具调用次数用完了，没能写出汇报。已做的部分在上面的工具记录里；回复「继续」我接着做。）";
function stripDsml(text) {
  const t = String(text == null ? "" : text);
  const at = t.search(DSML_RE);
  if (at < 0) return t;
  return t.slice(0, at).replace(/[\s<（(｜|]+$/, "");
}
function makeDsmlGate() {
  let pend = "", leaked = false, active = true;   // 默认开；普通轮由 streamToolLoop setActive(false)
  return {
    setActive(v) { active = !!v; if (!active) pend = ""; },
    push(text) {
      if (!active) return String(text == null ? "" : text);
      if (leaked) return "";
      pend += text;
      const at = pend.search(LEAK_RE);
      if (at >= 0) { leaked = true; const out = pend.slice(0, at).replace(/[\s<（(｜|]+$/, ""); pend = ""; return out; }
      // 尾部像标记开头（<、<｜、<｜｜D、<｜inv…）的先扣住，等下一帧确认；可疑尾巴本身超过 40 字就不像标记了，放行防正文悬挂
      const m = pend.match(/<\s*\/?\s*[｜|]{0,3}\s*(?:D(?:S(?:M(?:L)?)?)?|t(?:o(?:o(?:l(?:_(?:c(?:a(?:l(?:l(?:s)?)?)?)?)?)?)?)?)?|i(?:n(?:v(?:o(?:k(?:e)?)?)?)?)?|p(?:a(?:r(?:a(?:m(?:e(?:t(?:e(?:r)?)?)?)?)?)?)?)?)?$/i);
      if (m && m[0].length <= 40) { const out = pend.slice(0, m.index); pend = pend.slice(m.index); return out; }
      const out = pend; pend = ""; return out;
    },
    flush() { if (leaked || !active) return ""; const out = pend; pend = ""; return out; },
    get leaked() { return leaked; }
  };
}

async function streamToolLoop(opts) { try { return await _streamToolLoopCore(opts); } finally { _flushRebuild(opts && opts.sessionId); } }

module.exports = {
  makeDsmlGate,
  stripDsml,
  loadToolsFor,
  runWithTools,
  streamToolLoop,
  buildSSE,
  DEFAULT_MAX_TOOL_ROUNDS,
  buildToolResultContent,
  compactPrettyJson,
  SESSION_SCOPED_TOOLS,
  splitThinkBlock,
  createThinkStripper,
  normalizeThinkingBlocks,
  normalizeAnthropicContentBlocks,
  getToolsForSession,
  invalidateToolsCache,
  emptyReplyNotice
};
