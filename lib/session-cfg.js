"use strict";
// 会话级配置读写（2026-10-03 从 server.js 抽出）
//
// 为什么抽：跨窗口注入开关要真正生效，就得让 context-v2-runtime.js 读到
// sessionCrossInjectOverride——而 context-v2-runtime.js 是被 server.js require 的，
// 反向 require 会形成循环依赖。故把这一族提到 lib，双方 require 同一份实现。
// （server.js 里的模型供应商/模型名覆盖仍留在原地：只有 server 侧消费，无需共享。）
//
// 数据落点不变：data/session_cfg/<safeSessionToken(sessionId)>.json，无文件 = 跟随全局。
const path = require("path");
const fs = require("fs-extra");
const { safeSessionToken } = require("./session-token");
// 2026-10-29 修复（审查 P1）：本文件十余处 save* 原本都是「读整份 JSON → 改一个字段 →
// fs.writeJsonSync 整文件覆盖写」。writeJsonSync 不是原子写：进程在写中途被强杀（pm2 内存重启、
// 机器掉电）会留下半截 JSON，下一次读取解析失败 → catch 里 `o = {}` → 整份会话配置丢失
// （工具开关、跨窗口注入、人设、模型等全部回默认值，且不报错）。
// 统一改用项目已有的原子写（tmp + rename），至少保证「要么是旧内容、要么是新内容」，不会出现半截。
const { writeJsonAtomic } = require("../utils/json_atomic");

function createSessionCfg(baseDir) {
  const SESSION_CFG_DIR = path.join(baseDir, "data", "session_cfg");   // 会话级配置（如跨窗口注入覆盖）；无文件=跟随全局

  // 会话级跨窗口注入覆盖：true=本会话强制注入, false=本会话关闭, null=跟随全局
  // 被消费方：context-v2-runtime.assembleAndApply（2026-10-03 commit 6c93586 起真正生效；
  // 1010-26/28 口径定为：override=false → 只保留人设+时间线本体，仅 relevant_memories 独立保留，
  // 且跳过生成注入快照）。此前 V1 拆除后无人读，API/UI 形同虚设。
  function sessionCrossInjectOverride(sessionId) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && typeof o.cross_inject_enabled === "boolean") return o.cross_inject_enabled;
      }
    } catch (e) { console.warn("[session-cfg] 读取覆盖失败:", e.message); }
    return null;
  }

  function saveSessionCrossInjectOverride(sessionId, enabled) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (enabled === null || enabled === undefined) delete o.cross_inject_enabled;
    else o.cross_inject_enabled = !!enabled;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o;
  }

  // 1010-26 契约重构：会话级「跨窗口注入内容」多选（inject_blocks），8 项 key。
  //   锁死（默认注入且不可取消）：system_instructions（永久上下文）/ state_machine（本会话状态机）
  //   默认（可取消）：core_identity / long_term_understanding / conversation_continuity（日记 Earlier Days）
  //   按需（默认不勾）：starred_dialog（标星的对话）/ notebook_index（笔记本目录，2026-10-16 新增）/ state_inherit（继承上个会话状态）/ recent_dialog（最近20条对话原文）/ memory_keywords（记忆池关键词目录，2026-11-02 新增，不冻结、重建时按当前记忆池重出）
  //   默认（可取消，2026-11-02 新增）：pinned_notes（置顶笔记全文 Pinned Notes 块；不冻结，每次快照建立/重建按当前置顶重出）
  // 结构：data/session_cfg/<token>.json 的 inject_blocks 数组；缺省 null = 跟随全局默认（DEFAULT_INJECT_BLOCKS）。
  // 旧 key 自动迁移：permanent→system_instructions / summary→core_identity+long_term_understanding /
  //                  diary→conversation_continuity / state→state_machine。
  const LOCKED_INJECT_BLOCKS = ["system_instructions", "state_machine"];
  // 1102 笔记置顶：pinned_notes 默认开（产品确定：置顶即常驻）；没置顶笔记时块为空、自然不注入
  const DEFAULT_INJECT_BLOCKS = ["system_instructions", "state_machine", "core_identity", "long_term_understanding", "conversation_continuity", "pinned_notes"];
  // 1102 记忆池关键词：memory_keywords 默认关（产品确定：手动勾才注入，存量会话零红点）；勾了的会话记忆池变化时亮红点提示重建
  const ALL_INJECT_BLOCKS = ["system_instructions", "core_identity", "long_term_understanding", "conversation_continuity", "starred_dialog", "notebook_index", "pinned_notes", "memory_keywords", "state_inherit", "recent_dialog", "state_machine"];
  const LEGACY_INJECT_BLOCKS = {
    permanent: ["system_instructions"],
    summary: ["core_identity", "long_term_understanding"],
    diary: ["conversation_continuity"],
    state: ["state_machine"],
  };

  // 归一化：合法 key 去重 + 旧 key 迁移 + 锁死项强制并入。返回 null 表示"未设置"（跟随全局默认）。
  function normalizeInjectBlocks(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    const push = function (k) { if (ALL_INJECT_BLOCKS.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); };
    list.forEach(function (k) {
      const mapped = LEGACY_INJECT_BLOCKS[k];
      if (mapped) mapped.forEach(push);
      else push(k);
    });
    LOCKED_INJECT_BLOCKS.forEach(push);
    return out;
  }

  function readInjectBlocks(sessionId) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && Array.isArray(o.inject_blocks)) {
          // 合法 key 去重 + 旧 key 迁移 + 锁死项强制并入（锁死项恒在，区别仅剩 null=跟随全局默认）
          return normalizeInjectBlocks(o.inject_blocks);
        }
      }
    } catch (e) { console.warn("[session-cfg] 读取 inject_blocks 失败:", e.message); }
    return null; // null = 跟随全局默认（DEFAULT_INJECT_BLOCKS 三块）
  }

  // 标星对话注入条数：0 = 全量；未设置时默认全量。
  function readStarredDialogLimit(sessionId) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        const n = Number(o && o.starred_dialog_limit);
        if (Number.isFinite(n) && n >= 0) return Math.min(10000, Math.floor(n));
      }
    } catch (e) { console.warn("[session-cfg] 读取 starred_dialog_limit 失败:", e.message); }
    return 0;
  }

  function saveStarredDialogLimit(sessionId, limit) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    let n = Number(limit);
    if (!Number.isFinite(n) || n < 0) n = 0;
    o.starred_dialog_limit = Math.min(10000, Math.floor(n));
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o;
  }

  // 会话级 Earlier Days 日记篇数：null = 跟随管理台全局配置；正整数 = 本会话覆盖。
  function readSessionDiaryCount(sessionId) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        const n = Number(o && o.diary_count_override);
        if (o && o.diary_count_override != null && Number.isFinite(n) && n >= 1) return Math.min(1000, Math.floor(n));
      }
    } catch (e) { console.warn("[session-cfg] 读取 diary_count_override 失败:", e.message); }
    return null;
  }

  function saveSessionDiaryCount(sessionId, count) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (count === null || count === undefined || String(count).trim() === "") delete o.diary_count_override;
    else {
      let n = Number(count);
      if (!Number.isFinite(n) || n < 1) n = 1;
      o.diary_count_override = Math.min(1000, Math.floor(n));
    }
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o;
  }

  function saveInjectBlocks(sessionId, blocks) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const list = normalizeInjectBlocks(blocks);
    if (list !== null) o.inject_blocks = list;   // 归一化后的集合（锁死项恒在）
    else delete o.inject_blocks;                 // null/undefined = 未设置（跟随全局默认）
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o;
  }


  // 2026-10-18 承接信息（跨窗口注入定稿「上一个会话」）：新建会话那一刻固化，之后不变。
  // { from, from_name, at, state_version, state_text }——state_text 是当时上一个会话的状态机正文（冻结副本），
  // 供「继承上个会话状态」注入与本会话状态机第一版当底稿；没有状态则只有 from。
  function readInherit(sessionId) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.inherit && typeof o.inherit === "object" && o.inherit.from) return o.inherit;
      }
    } catch (e) { console.warn("[session-cfg] 读取 inherit 失败:", e.message); }
    return null;
  }

  // 原始承接记录（含 failed 记录：最近聊天的会话已归档/删除且选择不跳过）——界面显示用；注入只认 readInherit
  function readInheritRecord(sessionId) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.inherit && typeof o.inherit === "object") return o.inherit;
      }
    } catch (e) { /* 无记录 */ }
    return null;
  }

  function saveInherit(sessionId, inherit) {
    const token = safeSessionToken(sessionId || "default");
    const file = path.join(SESSION_CFG_DIR, token + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (inherit && (inherit.from || inherit.failed)) o.inherit = inherit; else delete o.inherit;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o;
  }

  // 2026-10-15 会话分支继承：把父会话的会话级配置文件整体复制给子会话，
  // 覆盖 cross_inject_enabled / inject_blocks / starred_dialog_limit / diary_count_override
  // 及未来新增的会话级键。父会话无配置文件（跟随全局）→ 子会话同样跟随全局，不建文件。
  // 失败只告警不抛出，不影响分支映射本身的保存。
  function inheritFrom(fromSessionId, toSessionId) {
    try {
      const fromToken = safeSessionToken(fromSessionId || "");
      const toToken = safeSessionToken(toSessionId || "");
      if (!fromToken || !toToken || fromToken === toToken) return false;
      const fromFile = path.join(SESSION_CFG_DIR, fromToken + ".json");
      if (!fs.existsSync(fromFile)) return false;
      const o = fs.readJsonSync(fromFile);
      if (!o || typeof o !== "object") return false;
      // 1018：承接信息属于父会话自己（父会话承接自谁），分支是父会话的延续、不再另行承接
      const copy = Object.assign({}, o);
      delete copy.inherit;
      fs.ensureDirSync(SESSION_CFG_DIR);
      writeJsonAtomic(path.join(SESSION_CFG_DIR, toToken + ".json"), copy);
      return true;
    } catch (e) { console.warn("[session-cfg] 分支继承配置失败:", e.message); return false; }
  }

  // 1021 会话级 MCP 工具开关：本会话开着的工具 key 列表（"服务器id::工具名"）。
  // null = 没存过，跟随全局；有值 = 以它为准（会话建立后首次取工具时复制一份全局状态，之后全局再改不影响本会话）。
  function readMcpOn(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && Array.isArray(o.mcp_on)) return o.mcp_on.map(String);
      }
    } catch (e) { console.warn("[session-cfg] 读取 mcp_on 失败:", e.message); }
    return null;
  }
  function saveMcpOn(sessionId, arr) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (arr === null || arr === undefined) delete o.mcp_on;
    else o.mcp_on = Array.from(new Set((Array.isArray(arr) ? arr : []).map(String)));
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o.mcp_on || null;
  }

  /* [位置:session-cfg.js·readMcpSeen/saveMcpSeen] [会话「自己一份」的工具清单里「见过哪些工具」] [10-23：自己一份的会话和全局脱钩后，全局新增的工具在里面默认缺席又没提醒；现在多记一份「这份清单见过的工具 key」，没见过、且全局开着的工具（也就是新工具）默认算开，见过但关着的不动；存在同一个会话配置文件的 mcp_seen；merge=true 与已有的取并集；没存过返回 null（老行为：不自动开新工具）] [注释时间 2026-10-23] */
  function readMcpSeen(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && Array.isArray(o.mcp_seen)) return o.mcp_seen.map(String);
      }
    } catch (e) { console.warn("[session-cfg] 读取 mcp_seen 失败:", e.message); }
    return null;
  }
  function saveMcpSeen(sessionId, arr, merge) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (arr === null || arr === undefined) delete o.mcp_seen;
    else {
      const base = (merge && Array.isArray(o.mcp_seen)) ? o.mcp_seen : [];
      o.mcp_seen = Array.from(new Set(base.concat((Array.isArray(arr) ? arr : []).map(String))));
    }
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o.mcp_seen || null;
  }

  /* [位置:session-cfg.js·readMcpExact/saveMcpExact] [会话工具清单「精确模式」标记] [10-26 晚：预设开的会话要所见即所得——AI 实际工具=弹层显示=预设勾选，全局之后新增的工具不再自动开进这种会话（跳过「新工具默认开」策略）；存同一会话配置文件的 mcp_exact；save true=存，false=清，undefined=不动] [注释时间 2026-10-26 晚] */
  function readMcpExact(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.mcp_exact === true) return true;
      }
    } catch (e) { /* 读不到按非精确 */ }
    return false;
  }
  function saveMcpExact(sessionId, val) {
    if (val === undefined) return null;
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (val === true) o.mcp_exact = true;
    else delete o.mcp_exact;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o.mcp_exact === true;
  }

  /* [位置:session-cfg.js·readMcpRules/saveMcpRules] [会话工具「规则」] [10-27：每个服务器 = 默认开/关 + 例外名单，新增的工具按所在服务器的默认走，不再靠 mcp_seen / mcp_exact 去猜；
     存同一会话配置文件的 mcp_rules；有规则就以规则为准（旧 mcp_on / mcp_seen / mcp_exact 保留不动，清掉规则即回到旧逻辑，可回滚）；形状与语义见 lib/mcp-rules.js] [注释时间 2026-10-27] */
  function readMcpRules(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.mcp_rules) return require("./mcp-rules").normalizeRules(o.mcp_rules);
      }
    } catch (e) { console.warn("[session-cfg] 读取 mcp_rules 失败:", e.message); }
    return null;
  }
  function saveMcpRules(sessionId, rules) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const clean = (rules === null || rules === undefined) ? null : require("./mcp-rules").normalizeRules(rules);
    if (clean) o.mcp_rules = clean; else delete o.mcp_rules;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o.mcp_rules || null;
  }

  /* [位置:session-cfg.js·readClaudeThinkingEffort/saveClaudeThinkingEffort] [会话级 Claude 思考档位] [2026-10-28：头像菜单只在 Claude 会话显示「Claude 思考」默认/低/中/高；存本文件 claude_thinking_effort，null=默认；分支整体继承，默认不发参数] [注释时间 2026-10-28] */
  function readClaudeThinkingEffort(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        const v = String((o && o.claude_thinking_effort) || "").toLowerCase();
        if (v === "low" || v === "medium" || v === "high") return v;
      }
    } catch (e) { console.warn("[session-cfg] 读取 claude_thinking_effort 失败:", e.message); }
    return null;
  }
  function saveClaudeThinkingEffort(sessionId, effort) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const v = String(effort || "").toLowerCase();
    if (v === "low" || v === "medium" || v === "high") o.claude_thinking_effort = v;
    else delete o.claude_thinking_effort;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return (v === "low" || v === "medium" || v === "high") ? v : null;
  }

  /* [位置:session-cfg.js·readGrokThinkingEffort/saveGrokThinkingEffort] [会话级 Grok 思考档位] [2026-11-16：头像菜单只在实际模型是 grok-4.x 时显示「Grok 思考」默认/低/中/高/极高；存本文件 grok_thinking_effort，空=默认（不发参数，厂商默认 high，grok-4.6/4.7 不能关思考）；与 claude_thinking_effort 各存各的，互不覆盖] [注释时间 2026-11-16] */
  function readGrokThinkingEffort(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        const v = String((o && o.grok_thinking_effort) || "").toLowerCase();
        if (v === "low" || v === "medium" || v === "high" || v === "xhigh") return v;
      }
    } catch (e) { console.warn("[session-cfg] 读取 grok_thinking_effort 失败:", e.message); }
    return null;
  }
  function saveGrokThinkingEffort(sessionId, effort) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const v = String(effort || "").toLowerCase();
    if (v === "low" || v === "medium" || v === "high" || v === "xhigh") o.grok_thinking_effort = v;
    else delete o.grok_thinking_effort;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return (v === "low" || v === "medium" || v === "high" || v === "xhigh") ? v : null;
  }

  /* [位置:session-cfg.js·readClaudeCache1h/saveClaudeCache1h] [会话级 Claude 加强缓存] [11-04：默认 5 分钟缓存；会话开关打开后断点改 1 小时缓存。存本文件 claude_cache_1h（true/缺省）；头像菜单只在 Claude 会话显示] [注释时间 2026-11-04] */
  function readClaudeCache1h(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) { const o = fs.readJsonSync(file); return !!(o && o.claude_cache_1h === true); }
    } catch (e) { console.warn("[session-cfg] 读取 claude_cache_1h 失败:", e.message); }
    return false;
  }
  function saveClaudeCache1h(sessionId, on) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (on === true) o.claude_cache_1h = true; else delete o.claude_cache_1h;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return on === true;
  }

  /* [位置:session-cfg.js·readGlmHistReasoning/saveGlmHistReasoning] [会话级 GLM 历史思考回传开关] [11-15：头像菜单增加「GLM 历史思考」开关；默认开启回传（true），关掉时写入 glm_drop_hist_reasoning: true] [注释时间 2026-11-15] */
  function readGlmDropHistReasoning(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) { const o = fs.readJsonSync(file); return !!(o && o.glm_drop_hist_reasoning === true); }
    } catch (e) { console.warn("[session-cfg] 读取 glm_drop_hist_reasoning 失败:", e.message); }
    return false;
  }
  function saveGlmDropHistReasoning(sessionId, drop) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (drop === true) o.glm_drop_hist_reasoning = true; else delete o.glm_drop_hist_reasoning;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return drop === true;
  }

  /* [位置:session-cfg.js·readLook/saveLook] [会话自己的头像 / 聊天主题] [10-27：预设带的会话头像和聊天主题原来只存手机本地 localStorage，换设备/清缓存就丢、会话删了也不清；改存会话配置（avatar / chat_style），会话列表一起带回，手机本地只作兜底；
     avatar 只收 http(s) 或站内路径（上传接口返回的地址），chat_style 只收 min / bubble；按文件 mtime 缓存，列表每次带 158 个会话不多读磁盘] [注释时间 2026-10-27] */
  const _lookCache = new Map();
  function readLook(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      const st = fs.statSync(file);
      const c = _lookCache.get(file);
      if (c && c.m === st.mtimeMs && c.z === st.size) return c.v;
      const o = fs.readJsonSync(file) || {};
      const v = { avatar: typeof o.avatar === "string" ? o.avatar : "", style: (o.chat_style === "min" || o.chat_style === "bubble") ? o.chat_style : "" };
      if (_lookCache.size > 2000) _lookCache.clear();
      _lookCache.set(file, { m: st.mtimeMs, z: st.size, v: v });
      return v;
    } catch (e) { return { avatar: "", style: "" }; }
  }
  function saveLook(sessionId, look) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const av = String((look && look.avatar) || "").trim();
    if (av && av.length <= 1000 && /^(https?:\/\/|\/)/i.test(av)) o.avatar = av; else delete o.avatar;
    const st = look && look.style;
    if (st === "min" || st === "bubble") o.chat_style = st; else delete o.chat_style;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    _lookCache.delete(file);   // 自己写的立刻失效（同一毫秒内再读也不会拿到旧值）
    return { avatar: o.avatar || "", style: o.chat_style || "" };
  }

  /* [位置:session-cfg.js·readCompactionModel/saveCompactionModel] [会话级状态机模型] [用户 1024-24 需求1：状态机参数面板「模型选择」——本会话的状态机（上下文压缩）用哪个模型；provider_id+model 成对存，model 为空 = 跟随全局「压缩摘要」角色路由；存本文件的 compaction_model / compaction_model_provider 键] [注释时间 2026-10-24] */
  function readCompactionModel(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.compaction_model) return { provider_id: String(o.compaction_model_provider || ""), model: String(o.compaction_model) };
      }
    } catch (e) { console.warn("[session-cfg] 读取 compaction_model 失败:", e.message); }
    return null;
  }
  function saveCompactionModel(sessionId, providerId, model) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const m = String(model || "").trim();
    if (!m) { delete o.compaction_model; delete o.compaction_model_provider; }
    else { o.compaction_model = m; o.compaction_model_provider = String(providerId || ""); }
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return m ? { provider_id: o.compaction_model_provider, model: m } : null;
  }

  /* [位置:session-cfg.js·readCompactionPrompt/saveCompactionPrompt] [会话级状态机提示词选择] [11-01 #60：提示词要多套、按会话换；
     存本文件 compaction_prompt_id，空=跟随全局默认（内置或全局自定义单套）；分支继承 inheritFrom 整文件复制自动带上] [注释时间 2026-11-01] */
  function readCompactionPrompt(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.compaction_prompt_id) return String(o.compaction_prompt_id);
      }
    } catch (e) { console.warn("[session-cfg] 读取 compaction_prompt_id 失败:", e.message); }
    return "";
  }
  function saveCompactionPrompt(sessionId, id) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const v = String(id || "").trim();
    if (!v) delete o.compaction_prompt_id;
    else o.compaction_prompt_id = v.slice(0, 60);
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o.compaction_prompt_id || "";
  }

  /* [位置:lib/session-cfg.js·readWorldbookSwitches/saveWorldbookSwitches] [会话级动态注入开关] [条目库全局共用，每个会话单独记录开启了哪些条目；无文件默认全关] [注释时间 2026-11-21] */
  function readWorldbookSwitches(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && o.worldbook_switches && typeof o.worldbook_switches === "object" && !Array.isArray(o.worldbook_switches)) {
          const out = {};
          for (const k of Object.keys(o.worldbook_switches)) out[k] = !!o.worldbook_switches[k];
          return out;
        }
      }
    } catch (e) { console.warn("[session-cfg] 读取 worldbook_switches 失败:", e.message); }
    return {};
  }
  function saveWorldbookSwitches(sessionId, patchOrMap, replace) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const base = (!replace && o.worldbook_switches && typeof o.worldbook_switches === "object" && !Array.isArray(o.worldbook_switches))
      ? { ...o.worldbook_switches }
      : {};
    if (patchOrMap && typeof patchOrMap === "object" && !Array.isArray(patchOrMap)) {
      for (const k of Object.keys(patchOrMap)) {
        const v = patchOrMap[k];
        if (v === null || v === undefined) delete base[k];
        else base[k] = !!v;
      }
    }
    if (Object.keys(base).length) o.worldbook_switches = base;
    else delete o.worldbook_switches;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return base;
  }

  /* [位置:lib/session-cfg.js·readStripTraceToAi/saveStripTraceToAi] [会话级 trace 剥离开关] [11-21：开=发给 AI 前剥掉历史 assistant 消息里的 <trace>（仅前端显示）；关/缺省=保留发给 AI] [注释时间 2026-11-21] */
  function readStripTraceToAi(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && typeof o.strip_trace_to_ai === "boolean") return o.strip_trace_to_ai;
      }
    } catch (e) {}
    return false;
  }
  function saveStripTraceToAi(sessionId, strip) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    if (strip === true) o.strip_trace_to_ai = true;
    else delete o.strip_trace_to_ai;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return !!o.strip_trace_to_ai;
  }

  /* [位置:lib/session-cfg.js·readPinnedScope/savePinnedScope] [会话级永久上下文作用域与开关] [11-25：用预设开的会话记录 pinned_scope="preset:<id>" 与 pinned_enabled；全局默认会话无此字段，读全局 pinned.json] [注释时间 2026-11-25] */
  function readPinnedScope(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && typeof o === "object") {
          const scope = typeof o.pinned_scope === "string" ? o.pinned_scope.trim() : "";
          const enabled = typeof o.pinned_enabled === "boolean" ? o.pinned_enabled : null;
          return { scope, enabled };
        }
      }
    } catch (e) {}
    return { scope: "", enabled: null };
  }
  function savePinnedScope(sessionId, opts) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const scope = opts && typeof opts.scope === "string" ? opts.scope.trim() : "";
    if (scope) o.pinned_scope = scope;
    else delete o.pinned_scope;
    if (opts && typeof opts.enabled === "boolean") o.pinned_enabled = opts.enabled;
    else delete o.pinned_enabled;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return { scope: o.pinned_scope || "", enabled: typeof o.pinned_enabled === "boolean" ? o.pinned_enabled : null };
  }

  /* [位置:lib/session-cfg.js·readNotebookId/saveNotebookId] [会话级绑定笔记本 ID] [11-25：空/default=默认笔记本；none=不绑笔记本；nb_xxx=独立自定义笔记本] [注释时间 2026-11-25] */
  function readNotebookId(sessionId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    try {
      if (fs.existsSync(file)) {
        const o = fs.readJsonSync(file);
        if (o && typeof o.notebook_id === "string") return o.notebook_id.trim();
      }
    } catch (e) {}
    return "";
  }
  function saveNotebookId(sessionId, nbId) {
    const file = path.join(SESSION_CFG_DIR, safeSessionToken(sessionId || "default") + ".json");
    let o = {};
    try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
    const v = String(nbId || "").trim();
    if (v && v !== "default") o.notebook_id = v;
    else delete o.notebook_id;
    fs.ensureDirSync(SESSION_CFG_DIR);
    writeJsonAtomic(file, o);
    return o.notebook_id || "default";
  }

  return { SESSION_CFG_DIR, readClaudeCache1h, saveClaudeCache1h, readGlmDropHistReasoning, saveGlmDropHistReasoning, readCompactionModel, saveCompactionModel, readCompactionPrompt, saveCompactionPrompt, readClaudeThinkingEffort, saveClaudeThinkingEffort, readGrokThinkingEffort, saveGrokThinkingEffort, readMcpOn, saveMcpOn, readMcpSeen, saveMcpSeen, readMcpExact, saveMcpExact, readMcpRules, saveMcpRules, readWorldbookSwitches, saveWorldbookSwitches, readStripTraceToAi, saveStripTraceToAi, readPinnedScope, savePinnedScope, readNotebookId, saveNotebookId, readLook, saveLook, readInherit, readInheritRecord, saveInherit, sessionCrossInjectOverride, saveSessionCrossInjectOverride, readInjectBlocks, saveInjectBlocks, readStarredDialogLimit, saveStarredDialogLimit, readSessionDiaryCount, saveSessionDiaryCount, inheritFrom, normalizeInjectBlocks, ALL_INJECT_BLOCKS, DEFAULT_INJECT_BLOCKS, LOCKED_INJECT_BLOCKS };
}

module.exports = { createSessionCfg };
