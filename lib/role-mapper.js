'use strict';
// role 出口映射层（2026-09-15 role 法定稿）。
// 内部统一消息表示：system / developer / user / assistant / tool。
// 时间线存储与内存构建永远用内部表示，只在「发给上游前」按供应商 profile 翻译一次。
// profile 取自 AI 供应商配置的 profile 字段（无则 default）。

// 出口翻译分发：按供应商 profile 选映射器（claude/gemini/grok 专用，其余一律 default）；
// 非数组输入或缺 role 的消息项先过滤再传给对应映射器
function mapMessagesForProvider(profile, messages, opt) {
  const p = String(profile || "default").trim().toLowerCase();
  const msgs = (Array.isArray(messages) ? messages : []).filter(m => m && m.role);
  if (p === "claude") return mapForClaude(msgs);
  if (p === "gemini") return mapForGemini(msgs);
  if (p === "grok") return mapForGrok(msgs, opt);
  return mapForDefault(msgs, opt);
}

// 默认（OpenAI 兼容上游）：developer → system，位置与内容原样保留。
// 注：DeepSeek 等主流兼容上游不认 developer 角色，故 default profile 必须做此映射。
/* [位置:lib/role-mapper.js·mapForDefault·dropHistReasoning] [按渠道剥历史思考回传] [2026-11-12 GLM订阅：智谱 Coding Plan 端点「保留式思考」默认开启（请求带历史 reasoning_content 才生效），历史思考每轮白占数千~数万字符且照计 prompt token；官方文档明确回传是可选能力，实测带 tools 的历史 assistant(tool_calls) 无 reasoning_content 请求返回 200（2026-11-12 glmplan/glm-5.3-flash）。渠道配置 drop_hist_reasoning: true 时本函数剥掉全部历史 assistant 的思考（含 0928 空串补全），仅影响出口——落盘与前端思考显示不动；工具循环轮内的思考回传（mcp/mcp-tool-loop.js 自行 push）不经过本函数，不受影响] [注释时间 2026-11-12] */
function mapForDefault(msgs, opt) {
  const dropRc = !!(opt && opt.dropHistReasoning);
  return msgs.map(m => {
    if (m.role === "developer") return { ...m, role: "system" };
    if (m.role !== "assistant") return m;
    if (dropRc) {
      const { reasoning, reasoning_content, ...rest } = m;
      return rest;
    }
    // 2026-09-26：DeepSeek thinking 模型（deepseek-flash）要求思考链字段名必须是
    // reasoning_content；时间线内部存储用 reasoning（2026-09-24 思考链透出落盘）。
    // 出口前把 assistant 消息的 reasoning 归一为 reasoning_content，否则带 tools 的
    // 首轮请求会被 400 "reasoning_content must be passed back" 拒绝，导致唤醒/聊天
    // 工具循环间歇性失败回退直连（实测：改名后通过；无 reasoning 字段的消息保持原样）。
    // 2026-09-28 补全（DeepSeek 官方规则）：携带 tools 参数的请求里**每条** assistant 消息都必须
    // 回传 reasoning_content（无思考内容也给空串 ""）——0926 只补了"有 reasoning 的"，
    // 唤醒上下文里 0924 思考链落盘前的旧 assistant 消息无 reasoning 字段仍会 400。
    if (m.reasoning_content === undefined) {
      const { reasoning, ...rest } = m;
      return { ...rest, reasoning_content: (reasoning !== undefined && reasoning !== null) ? reasoning : "" };
    }
    return m;
  });
}

// 对话中的 developer 消息转 user 时的细分标注前缀（2026-10-31 拍板 C 方案）：
// 唤醒块 → [系统唤醒]、推送/唤醒回执 → [系统回执]、其余（摘要块/记忆浮现/容量提醒等）→ [系统消息]。
function claudeDevTag(t) {
  const s = t.trim();
  if (/^这是一次系统唤醒/.test(s)) return "[系统唤醒] ";
  // 2026-11-11：回执只报失败后，可能以「日记写入失败」「唤醒设置失败」开头（lib/wake-scheduler.js·buildWakeReceipt）；前四个兼容旧回执
  if (/^(发送成功|本次未推送|未发送推送|发送失败|日记写入失败|唤醒设置失败)/.test(s)) return "[系统回执] ";
  return "[系统消息] ";
}

/* [位置:lib/role-mapper.js·mapForClaude] [Claude出口developer原位转user] [2026-10-31：唤醒块/回执不管哪个模型都要待在时间线正常位置——原实现把全部 system+developer 按序搅成一条顶层 system，唤醒块贴在状态摘要尾部、且每条唤醒回执都改写 system 尾部，Claude 提示词缓存前缀每响一次就碎一次。现改为：第一条真实对话（user/assistant/tool）之前的 developer（人设后头部注入块）照旧并入顶层 system（产品确定 q2），之后的 developer 逐条原位转 user、按 claudeDevTag 细分加标注前缀；带 _fromDeveloper 标记，供出口 injectElapsed（routes/chat.js）等按「真实 user」处理的动态注入跳过——转换消息不加时间差标签/时间缀（要求）。旧 <wake> 单槽回执「本次未推送。下一次系统自动唤醒时间：…」同以「本次未推送」开头，命中 [系统回执]] [注释时间 2026-10-31] */
// Claude 系：system 与「头部 developer 注入块」进顶层 system 参数（合并为首条 system 消息，
// 由 Claude 侧适配器再抬到顶层参数）；对话中的 developer 转成 user 消息原位保留，
// 由适配器按相邻同角色合并成 Anthropic 消息。assistant 的 tool_calls 与 role:tool 的工具结果都原样透传，
// 由 lib/anthropic-adapter 转成 tool_use / tool_result 块（tool_result 在 user 消息里、紧跟对应 tool_use）。
// 2026-10-21 修：原来把 role:tool 改写成普通 user 文本「[tool_result for …]」，适配器就收不到 tool_result，
// 历史里只要有 assistant.tool_calls + tool 成对（如唤醒上下文还原的 call_hist_），就会得到
// 「tool_use 后面没有 tool_result」的非法 Claude 请求。tool 消息不再改写。
function mapForClaude(msgs) {
  const sysParts = [];
  const rest = [];
  let seenReal = false;   // 是否已遇到第一条真实对话消息（user/assistant/tool）；之前的 developer 属头部注入块
  for (const m of msgs) {
    if (m.role === "system") { sysParts.push(String(m.content ?? "")); continue; }
    if (m.role === "developer") {
      if (!seenReal) { sysParts.push(String(m.content ?? "")); continue; }
      const t = typeof m.content === "string" ? m.content : String(m.content ?? "");
      /* [位置:lib/role-mapper.js·mapForClaude·developer转user] [回执与后一条真实消息粘在一起] [Anthropic 侧相邻 user 会被合并进同一条消息的多个 text 块（lib/anthropic-adapter.js·push），
         回执文本和紧随其后的真实 user 内容之间原来一个字都不隔，模型看到的是一句连着的
         「[系统回执] 未发送推送：……不吵她，（拍拍）」——「（拍拍）」其实是用户那条消息的开头。
         这里给转出来的块末尾补一个空行（两个换行），合并后各自成段；只影响出口翻译，时间线里 developer 原文不动] [注释时间 2026-11-11] */
      rest.push(Object.assign({}, m, { role: "user", content: claudeDevTag(t) + t + "\n\n", _fromDeveloper: true }));
      continue;
    }
    seenReal = true;
    rest.push(m.role === "model" ? { ...m, role: "assistant" } : m);
  }
  const out = [];
  if (sysParts.length) out.push({ role: "system", content: sysParts.join("\n\n").trim() });
  for (const m of rest) out.push(m);
  return out;
}

/* [位置:lib/role-mapper.js·mapForGemini] [Gemini订阅出口与Claude同款developer转user] [2026-11-12 拍板「和Claude一样的逻辑，换成user角色」：Antigravity 订阅上游要求请求以 user 回合结尾，唤醒块按旧口径转 system 后被 gemini-adapter 全量抽进 systemInstruction，contents 以 model 结尾，上游 400 "Requests ending with a model turn are not supported"——2026-11-12 07:42 起全部睡眠唤醒失败的根因（供应商配置 05:28 切回 antigravity 后首撞）。现与 mapForClaude 完全同款：头部 developer 并入首条 system，对话中 developer 原位转 user 加 [系统唤醒]/[系统回执]/[系统消息] 前缀（claudeDevTag）。旧实现把 assistant 改名 model 的归一不再保留：本映射器输出仍是 OpenAI 形状（发给 /internal/oauth/chat/completions），由 gemini-adapter.toRequest 翻译成 contents，那里只认 role:'assistant'，'model' 会掉进 user 分支把 AI 历史全变成用户发言] [注释时间 2026-11-12] */
function mapForGemini(msgs) {
  return mapForClaude(msgs);
}

/* [位置:lib/role-mapper.js·mapForGrok] [Grok出口developer原位转user并保留default思考字段处理] [2026-11-25 拍板「按这个改，只改Grok订阅，沿用Claude现有三个系统前缀」：Grok 订阅原先走 default，对话中 developer 只改名为 system，再被 lib/grok-responses.js 抽进顶层 instructions。现先按 mapForClaude 同款处理 developer（头部并入 system，其后原位转 user 并加 [系统唤醒]/[系统回执]/[系统消息] 前缀），再把结果交给 mapForDefault，只使用其中的 assistant 思考字段口径（dropHistReasoning / reasoning_content），此时已无 developer，不会再被改回 system] [注释时间 2026-11-25] */
function mapForGrok(msgs, opt) {
  return mapForDefault(mapForClaude(msgs), opt);
}

module.exports = { mapMessagesForProvider };
