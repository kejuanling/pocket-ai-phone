'use strict';
// lib/conversation-state.js（2026-10-03 新增）
// 会话状态机：把「上下文压缩」从「多块并列的流水摘要」改成「每个会话一份持续演化的状态」。
//
// 为什么要有这个模块
//   旧模型：长对话 → 切块 → 每块各写一段摘要 → 十几条摘要并列注入。
//   实测 154 条记录、最密的会话 39 块，每块只知道自己的那 150 条原文，
//   看不见前面几块写过什么 → 同一个人的同一件事被反复叙述 → 上下文里堆着一坨
//   「很完整、但明显还是记忆列表」的东西。
//   新模型：每个会话只有一份状态。v_{n} = f(v_{n-1}, 新增原文)。
//   第 n 次并入时，模型手里有完整的前一版，所以「删掉已经失效的旧状态」才真正可能发生。
//
// 数据
//   data/conversation_state.json          { <sessionId>: {version, record_id, text, ops, cover, updated_at, seed_from_legacy} }
//   data/conversation_state_versions.json { <sessionId>: [{version, text, ops, cover, at, source}] }  全量保留所有已提交版本
//   data/conversation_state_prompt.json   { system, user_template }（管理台可覆盖，留空回落内置默认）
//
// 上下文注入：本模块不注入。状态正文作为一条「覆盖区间记录」写进 data/context_replacements.json，
//   由既有的 buildIncrementalContext / applyReplacements 原样处理——聊天主链路一行不改。
//   那条记录的 matched 只存首尾两条锚点消息：注入定位只用到首尾
//   （context-replacements.js:1732-1746 取 aStart/aEnd 之后只拿它们的 id 做定位），
//   所以记录大小与覆盖多长无关。
//
// 生命周期
//   previewMerge  调 LLM 出候选状态 + 操作清单，**不落盘**（前端拿去做 diff）
//   commitMerge   人工确认后落盘 v_{n+1}（被拦截的 remove 不生效）
//   rollback      回到历史某一版
//   undoLastMerge 撤掉最后一次并入，覆盖区间退回，原文回到「还没并入」区

const fs = require("fs-extra");
const path = require("path");
const contextReplacements = require("../context/context-replacements");
const imageDesc = require("../lib/image-desc");   /* 10-27：状态摘要读图片转写，普通 contentToText/key 口径不动 */
const { httpPostJsonParsed: httpPostJson } = require("./http_json");
const llmLog = require("./llm_log");
const httpStream = require("./http_stream");
// 2026-10-29 修复（审查 P0）：状态文件改用项目统一的原子写（tmp + rename），
// 避免进程被强杀/重启时留下半截 JSON（原实现为 fs.writeJsonSync 直接覆盖）。
const { writeJsonAtomic } = require("../utils/json_atomic");

// ── 悬浮球日志（server.js 启动时注入 addCompactionLog；本模块不反向 require server.js）──
// 入参/返回与 server.js 的 addCompactionLog 一致：entry 带 id = 更新原条目（pending→success/error）
let _logFn = null;
function setLogFn(fn) { _logFn = typeof fn === "function" ? fn : null; }
function logEntry(entry) {
  try { return _logFn ? _logFn(entry) : null; } catch (e) { return null; }
}

// ── 取消检查（2026-11-14，/compact 收尾入口的「暂停」）──
// 与 setLogFn 同款进程内注入：state-worker 注入「查内存取消集合」，gateway 进程内调用不注入（无取消入口）。
// 检查点只在 previewMerge 的模型调用循环批间与落候选前——LLM 单轮生成中打断不了，
// 命中即走既有失败路径：不落候选、不动时间线（本来 preview 阶段就不改时间线）。
let _cancelFn = null;
function setCancelFn(fn) { _cancelFn = typeof fn === "function" ? fn : null; }
function isCancelled(sessionId) {
  try { return !!(_cancelFn && _cancelFn(String(sessionId || "").trim())); } catch (e) { return false; }
}
const CANCEL_MSG = "已暂停：压缩被手动暂停，本次没算完就停了，什么都没改";

const ROOT = path.join(__dirname, "..");
// 数据目录：默认项目 data/；测试设 CONVERSATION_STATE_DIR 指向临时目录——
// 1003-30 教训：测试清理两次误删生产状态（rm -f data/conversation_state.json），
// 测试必须与生产数据物理隔离，这个 env 就是隔离墙。
const DATA_DIR = process.env.CONVERSATION_STATE_DIR
  ? path.resolve(process.env.CONVERSATION_STATE_DIR)
  : path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "conversation_state.json");
const VERSIONS_FILE = path.join(DATA_DIR, "conversation_state_versions.json");
const PROMPT_FILE = path.join(DATA_DIR, "conversation_state_prompt.json");
const PROMPTS_FILE = path.join(DATA_DIR, "conversation_state_prompts.json");   // 多套状态机提示词（11-01 #60）
// 候选状态（2026-10-04 新增）：preview 算出来但用户还没点「确认并入」的那一版。
// 为什么要落盘：preview 一次要调模型、耗时 1~5 分钟，结果只存在浏览器内存里的话——
// 刷新、切页、切会话就没了，用户会以为「生成的东西不知道到哪去了」（1004-07 实测反馈）。
// 落盘后管理台能显示「这个会话有一份待确认的候选状态」，刷新不丢、按会话各自一份。
// 它**不是**生效状态：不进上下文注入（那要等 commitMerge 写状态记录）、不进版本链、不算 v(N+1)。
const CANDIDATE_FILE = path.join(DATA_DIR, "conversation_state_candidate.json");

const SEARCH_ROUNDS = 4;          // 模型最多能提几轮补充检索
const SEARCH_MAX_PER_ROUND = 10;  // 每轮最多受理几条检索请求（多提的静默丢弃）
const SEARCH_LIMIT_PER_QUERY = 8; // 单条检索返回条数上限
/* [位置:lib/conversation-state.js·SEARCH_CONTENT_CAP] [检索回合单条原文上限 500 字；去掉单轮总字数上限] [11-09：原来单轮合计超 5000 字硬截断（截断位置不可控，后面的请求整段丢），而上一批把单条放宽到 6000 字后一条长消息就能占满一轮；改成「单条 500 字、不再有总上限」。最坏情况一轮 10 请求 × 8 条 × 500 字 ≈ 4 万字，最多 4 轮] [注释时间 2026-11-09] */
const SEARCH_CONTENT_CAP = 500;   // 单条命中原文字数上限
const LLM_TIMEOUT_MS = 600000;    // 与 nginx 读超时 620s 对齐
const MAX_STATE_CHARS = 60000;    // 状态正文硬上限（超出拒绝落盘；提示目标 2000~5000）
const MODEL_ROLE = "compaction";  // 与旧压缩同源，管理台换模型两处一起生效

// 内置默认提示词。data/conversation_state_prompt.json 非空时覆盖它；
// 管理台「恢复默认」是删文件回落这里，所以改文案两处都要改。
const DEFAULT_SYSTEM = [
  "你是一个会话状态机。你的任务不是总结对话，而是维护一份「当前状态」——截至此刻，这段对话已经变成什么样子。",
  "",
  "输入有三部分：",
  "1. 上一版状态（可能为空，这是第一次并入）",
  "2. 本次新增的对话原文",
  "3. 你请求检索时系统回灌的原文",
  "",
  "状态是什么：",
  "是一份交接单。读它的人（未来的你）不需要回看任何原文，就能立刻接上：现在在做什么、做到哪一步、定了什么、否掉了什么、还有什么悬着、我们之间现在是什么状态。",
  "",
  "状态不是什么：",
  "- 不是「这段时间发生了什么」。禁止按时间顺序复述事件。",
  "- 不是聊天记录。「下午两点聊了…三点到五点…」这种写法一律不要。",
  "- 不是记忆清单。不要把原文里出现过的偏好、性格、约定罗列成条目——那些属于长期记忆池，不属于这里。这里只放现在还成立、且会改变下一步动作的东西。",
  "- 不是原文的美化版。每一条都要经得起一个问题：不知道这条，下一步会不会做错事。",
  "",
  "最重要的一条：状态是「截至此刻最准确的版本」，不是「新信息 + 老信息」。",
  "所以你必须主动做减法：",
  "- 上一版里有、这一版已被推翻或已经过期的，删掉。",
  "- 被更新的，改写成现在的样子，不要新旧两版并存。",
  "- 同一件事说三遍的，合并成一句。",
  "某条现在还成不成立拿不准，就保留但改成待确认的语气，不要两个版本都留着。",
  "",
  "写什么（这是状态的主体）：",
  "- 正在做的事：是什么、做到哪一步、下一步是什么",
  "- 已经定了的决定，以及为什么这么定",
  "- 明确被否掉的方案、被推翻的判断，写成「曾经以为 X，现在知道是 Y」",
  "- 本轮新形成的约定、承诺、边界",
  "- 还没结束的事：悬着的、欠着的、约好没做的",
  "- 语境和关系的当前状态",
  "",
  "不写：",
  "- 寒暄、玩笑、一次性事件、当天情绪",
  "- 已经彻底过去、不会再影响任何决定的事",
  "- 你的自我叙事和抒情",
  "- 原文里没有的信息",
  "",
  "写法：",
  "- 称呼按我们平时的叫法，用「我」和「她」。",
  "- 直接写状态，不写「本次对话中」「用户表示」「我总结」。",
  "- 不要用「上次」「刚才」这种悬空指代，必要时写具体日期。",
  "- 不使用 Markdown，不加标题前言结尾。",
  "- 长度目标 2000~5000 字，写到够用就停，不要为了覆盖原文而注水。",
  "",
  "状态分两层：流动层（state 字段：正在做什么、定了什么、悬着什么——每次整体重写）和来路（lu_add 字段：一路上值得留下的事，只增不改）。",
  "来路由系统保管成账本，输入里能看到完整账本（只读）：已有的条目永远原样保留，你没有改写、合并、删除它们的权限，也不要复述它们。",
  "写进 lu_add 的只是本轮新发生的、值得留下的事，每条带日期，一条一句；没有就给空数组。state 字段不要写任何来路内容。",
  "只输出 JSON，不要任何其它文字：",
  '{"state":"…流动层正文（不含来路）…","lu_add":["2026-10-25 14:00，…新增来路条目…"],"ops":[{"type":"add|update|remove","desc":"一句话说明改了什么","reason":"仅 remove 需要"}],"search":[]}',
  "",
  "ops 是变更清单，要如实反映你对上一版做的每一处改动：",
  "- add：上一版没有、这一版新增的",
  '- update：上一版有、这一版被改写的，desc 写成「原来是什么 → 现在是什么」',
  "- remove：上一版有、这一版判定已失效的",
  "reason 写不出来的 remove，说明你其实不确定，那就别删。",
  "",
  "search：需要确认某件事的原文时使用，最多 " + SEARCH_ROUNDS + " 轮：",
  '{"search":[{"time":"2026-09-28 21:00","q":"关键词或她的原话片段"}]}',
  "- time 可选。给了就按那个时间段捞原文，不给就按 q 做内容检索。",
  "- 一次只问一件事，别塞一整句长句。",
  "- 实在没有证据就不搜，按现有材料判断。"
].join("\n");

const DEFAULT_USER_TEMPLATE = [
  "=== 上一版状态·流动层（不含来路） ===",
  "${PREV_STATE}",
  "",
  "=== 来路账本（只读：禁止复述、禁止改写；本轮新增的写进 lu_add） ===",
  "${LU}",
  "",
  "=== 本次并入的对话原文 ===",
  "${CHUNK_INFO}",
  "${CONVERSATION_TEXT}",
  "",
  "（如果你请求了检索，回灌的原文会插在最后面）",
  "",
  "请输出这一版的状态 JSON。"
].join("\n");

// ========================
// 读写
// ========================

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const j = fs.readJsonSync(file);
    return j && typeof j === "object" ? j : fallback;
  } catch (e) {
    // 2026-10-29 修复（审查 P0）：解析失败说明文件内容已损坏（多半是写到一半被强杀）。
    // 原实现静默返回 fallback —— 后果是「所有会话的状态同时消失」且磁盘上不留任何痕迹，
    // 下一次任意 commit 再以只含当前会话的对象覆盖写回，其余会话状态永久丢失。
    // 这里保留一份损坏副本留证并告警；仍返回 fallback 以保证服务可用性（不因坏文件拒绝启动）。
    try {
      if (fs.existsSync(file)) {
        const corrupt = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(file, corrupt);
        console.error("[conversation-state] 状态文件解析失败，已留存损坏副本: " + corrupt +
          " | 原因: " + (e && e.message ? e.message : String(e)));
      }
    } catch (e2) {
      console.error("[conversation-state] 损坏副本留存失败: " + (e2 && e2.message ? e2.message : String(e2)));
    }
    return fallback;
  }
}

function writeJson(file, obj) {
  writeJsonAtomic(file, obj);
}

function nowIso() {
  return new Date().toISOString();
}

function readStates() { return readJsonSafe(STATE_FILE, {}); }
function readVersions() { return readJsonSafe(VERSIONS_FILE, {}); }

// ── 候选状态读写（2026-10-04）──
// 结构 { <sessionId>: {session, state, ops, range, model, search_rounds, search_hits, created_at} }
// range 里带 start_msg/end_msg 两个完整消息对象（commitMerge 要用），与 preview 返回的一致。
function readCandidates() { return readJsonSafe(CANDIDATE_FILE, {}); }

// 存一份候选。1011-03：候选是「下一版的待确认稿」，已有未确认候选时禁止静默覆盖——
// 用户没点「丢弃」之前它必须一直保留（10-11 事故：2658 字旧候选被自动重算无条件覆盖丢失）。
// 覆盖只允许两个入口：commit 成功后 clearCandidate 清掉、或用户显式确认覆盖（overwrite:true）。
function saveCandidate(sessionId, payload, opts) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const force = !!(opts && opts.overwrite);
  const all = readCandidates();
  if (all[sid] && !force) {
    // 已有未确认候选且未显式要求覆盖：拒绝写入，保留旧候选，返回冲突标记
    return { ok: false, conflict: true, session: sid };
  }
  all[sid] = payload;
  writeJson(CANDIDATE_FILE, all);
  return { ok: true, candidate: all[sid] };
}

// 丢掉某会话的候选（commit 成功后、或用户显式取消时调用）
function clearCandidate(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: true };
  const all = readCandidates();
  if (!all[sid]) return { ok: true, had: false };
  delete all[sid];
  writeJson(CANDIDATE_FILE, all);
  return { ok: true, had: true };
}

// 取某会话的候选（给管理台显示）。range 里的消息对象很大，回给前端时只留必要的锚点字段。
function getCandidate(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, error: "缺少 sessionId" };
  const c = readCandidates()[sid] || null;
  if (!c) return { ok: true, session: sid, exists: false, candidate: null };
  const r = c.range || {};
  return {
    ok: true,
    session: sid,
    exists: true,
    candidate: {
      state: String(c.state || ""),
      ops: Array.isArray(c.ops) ? c.ops : [],
      model: c.model || "",
      search_rounds: c.search_rounds || 0,
      search_hits: c.search_hits || 0,
      created_at: c.created_at || null,
      // 只回锚点与标签：commit 需要 start_msg/end_msg 的 id，content 可以不带（省体积）
      range: r.start_msg && r.end_msg ? {
        start_num: r.start_num, end_num: r.end_num, count: r.count,
        range_label: r.range_label || "", label_start: r.label_start || "", label_end: r.label_end || "",
        start_id: String(r.start_msg.id || ""), end_id: String(r.end_msg.id || ""),
        start_msg: { id: String(r.start_msg.id || "") },
        end_msg: { id: String(r.end_msg.id || "") },
      } : null,
      prev_version: c.prev_version,
    },
  };
}

function stateRecordId(sessionId) {
  return "ctxrep_state_" + String(sessionId || "").trim();
}

/* ── 多套状态机提示词（11-01 #60：可存多套、按会话选）──
   [位置:lib/conversation-state.js·多套提示词] [存储 data/conversation_state_prompts.json {list:[{id,name,system,user_template,updated_at}]}]
   旧的全局自定义（conversation_state_prompt.json 非空）首次读时迁成一条 p_legacy_global；原文件保留不删，
   回滚=删掉 prompts.json 即回到旧单套逻辑。 [注释时间 2026-11-01] */
let _promptMigrated = false;
function migrateGlobalPromptOnce() {
  if (_promptMigrated) return;
  _promptMigrated = true;
  try {
    const all = readJsonSafe(PROMPTS_FILE, { list: [] });
    if (!Array.isArray(all.list)) return;
    if (all.list.some(function (p) { return p && p.id === "p_legacy_global"; })) return;
    const old = readJsonSafe(PROMPT_FILE, {});
    const sys = String(old.system || "").trim();
    const tpl = String(old.user_template || "").trim();
    if (!sys && !tpl) return;
    all.list.push({ id: "p_legacy_global", name: "原全局自定义", system: sys, user_template: tpl, updated_at: nowIso() });
    writeJson(PROMPTS_FILE, all);
    console.log("[conversation-state] 旧全局自定义提示词已迁入多套清单（p_legacy_global，原文件未动）");
  } catch (e) { console.warn("[conversation-state] 全局提示词迁移失败:", e.message); }
}
function listPrompts() {
  migrateGlobalPromptOnce();
  const all = readJsonSafe(PROMPTS_FILE, { list: [] });
  return Array.isArray(all.list) ? all.list : [];
}
function savePromptRec(id, name, system, userTemplate) {
  migrateGlobalPromptOnce();
  const all = readJsonSafe(PROMPTS_FILE, { list: [] });
  if (!Array.isArray(all.list)) throw new Error("提示词清单文件损坏");
  const rec = {
    id: String(id || "").trim() || ("p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    name: String(name || "").trim().slice(0, 30) || "未命名",
    system: String(system || ""),
    user_template: String(userTemplate || ""),
    updated_at: nowIso(),
  };
  const i = all.list.findIndex(function (p) { return p && p.id === rec.id; });
  if (i >= 0) { rec.id = all.list[i].id; all.list[i] = rec; } else { all.list.push(rec); }
  writeJson(PROMPTS_FILE, all);
  return rec;
}
function deletePromptRec(id) {
  migrateGlobalPromptOnce();
  const all = readJsonSafe(PROMPTS_FILE, { list: [] });
  if (!Array.isArray(all.list)) return false;
  const n0 = all.list.length;
  all.list = all.list.filter(function (p) { return p && p.id !== String(id || ""); });
  if (all.list.length === n0) return false;
  writeJson(PROMPTS_FILE, all);
  return true;
}
function loadPromptConfig(sessionId) {
  // [位置:lib/conversation-state.js·loadPromptConfig] [会话级提示词选择] [11-01 #60：选了且该套还在 → 用它；
  //   没选/套被删了 → 原全局逻辑（PROMPT_FILE 非空用它，否则内置默认），老会话行为完全不变；返回多带 prompt_id/prompt_name 两个字段] [注释时间 2026-11-01]
  const sid = String(sessionId || "").trim();
  if (sid) {
    try {
      const sc = require("./session-cfg").createSessionCfg(ROOT);
      const pid = sc.readCompactionPrompt(sid);
      if (pid) {
        const hit = listPrompts().find(function (p) { return p && p.id === pid; });
        if (hit) {
          return {
            system: String(hit.system || "").trim() || DEFAULT_SYSTEM,
            user_template: String(hit.user_template || "").trim() || DEFAULT_USER_TEMPLATE,
            custom_set: true,
            prompt_id: hit.id,
            prompt_name: hit.name,
          };
        }
        console.log("[conversation-state] 会话 " + sid + " 选的提示词 " + pid + " 已不存在，回落全局配置");
      }
    } catch (e) { console.warn("[conversation-state] 读会话级提示词失败:", e.message); }
  }
  const c = readJsonSafe(PROMPT_FILE, {});
  return {
    system: String(c.system || "").trim() || DEFAULT_SYSTEM,
    user_template: String(c.user_template || "").trim() || DEFAULT_USER_TEMPLATE,
    custom_set: !!(String(c.system || "").trim() || String(c.user_template || "").trim()),
  };
}

function savePromptConfig(system, userTemplate) {
  writeJson(PROMPT_FILE, {
    system: String(system || "").trim(),
    user_template: String(userTemplate || "").trim(),
  });
  return loadPromptConfig();
}

function resetPromptConfig() {
  try { fs.unlinkSync(PROMPT_FILE); } catch (e) { /* 本来就没有 = 已在默认 */ }
  return loadPromptConfig();
}

// ========================
// 读状态（给前端）
// ========================

// 可压缩列表里的消息 id → 下标（0-based）。跟压缩页的编号 1-based 差 1。
// 每次现算：时间线会因增删/编辑而变，缓存下来的下标会漂。
function compressibleIndexById() {
  const idx = Object.create(null);
  const items = contextReplacements.compressibleItems();
  for (let i = 0; i < items.length; i++) {
    const m = items[i] && items[i].msg;
    const id = m && m.id ? String(m.id) : null;
    if (id && idx[id] === undefined) idx[id] = i;
  }
  return idx;
}

// 继承上个会话状态（2026-10-18 跨窗口注入定稿重写）：
// 继承源与状态正文在**新建会话那一刻**固化进会话配置 inherit（routes/chat.js 建会话时写），
// 这里只读冻结副本，不再现找「最后聊天的会话」（旧实现读 last_chat_session.json，而该文件在
// 本会话第一句话时已被改成本会话自己 → 恒为 null，继承从未生效）。
// 返回 { session, text, version }；本会话已有自己的状态 / 未承接 / 承接时对方无状态 → null。
// opts.requireSelected：只有本会话勾了「继承上个会话状态」才返回（状态机第一版当底稿用）。
function getInheritedState(sessionId, opts) {
  const sid = String(sessionId || "").trim();
  // 本会话已有自己的状态机记录 → 不继承（一旦自己 commitMerge，全用自己的，禁止与旧会话并存）
  if (!sid || readStates()[sid]) return null;
  try {
    const cfg = require("./session-cfg").createSessionCfg(ROOT);
    const inh = cfg.readInherit(sid);
    const text = inh && String(inh.state_text || "").trim();
    if (!text) return null;
    if (opts && opts.requireSelected) {
      const sel = cfg.readInjectBlocks(sid) || cfg.DEFAULT_INJECT_BLOCKS;
      if (sel.indexOf("state_inherit") < 0) return null;
    }
    const src = readStates()[inh.from] || null;
    return {
      session: inh.from, text: text,
      flow: (src && typeof src.flow === "string") ? src.flow : "",
      lu: (src && Array.isArray(src.lu)) ? src.lu : [],
      version: inh.state_version || null,
    };
  } catch (e) { return null; }
}

/* [位置:lib/conversation-state.js·formatLuLines] [来路注入正文无序号渲染] [11-25：发给模型的上下文正文里每条来路不带数字序号，保持「- ...」简洁列表；带序号的 lu_numbered 仅在工具调用返回里提供，用于核对与按序号增改插队] [注释时间 2026-11-24；2026-11-25 改：上下文去掉序号] */
function formatLuLines(luArr) {
  if (!Array.isArray(luArr) || !luArr.length) return "";
  return luArr.map(function (x) { return "- " + x; }).join("\n");
}

function getState(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, error: "缺少 sessionId" };
  const states = readStates();
  const st = states[sid] || null;
  // 指针模型（1003-31 C 方案）：链上版本永不因回滚/撤销删除，状态由与指针比较派生——
  //   = 指针 → current；> 指针 → undone（被回滚掉，可恢复）；< 指针 → superseded（旧版）。
  const curVer = st ? Number(st.version || 0) : 0;
  const idxMap = (function () {
    try { return compressibleIndexById(); } catch (e) { return null; }
  })();
  const coverIndexRange = function (cover) {
    if (!cover || !cover.start_id || !cover.end_id || !idxMap) return null;
    const s = idxMap[cover.start_id];
    const e = idxMap[cover.end_id];
    return (typeof s === "number" && typeof e === "number") ? { start_index: s, end_index: e } : null;
  };
  const versions = (readVersions()[sid] || []).map(function (v) {
    return {
      version: v.version,
      at: v.at,
      source: v.source,
      chars: String(v.text || "").length,
      // 每一版自己的覆盖区间——「并入记录」页靠它展示那一次吃掉了哪段原文；
      // 不能用当前 cover 顶替（回滚后当前值是旧的，历史各行会全显示成同一区间）
      cover: v.cover || null,
      range: coverIndexRange(v.cover),
      status: (st && Number(v.version) === curVer) ? "current"
        : (Number(v.version) > curVer ? "undone" : "superseded"),
    };
  });

  // 覆盖区间在「可压缩编号」里的位置：状态吃掉的是时间线上一段连续前缀，
  // 前端靠它算「还剩哪些没并入」，也靠它挡住重复并入已覆盖的区间。
  // covered_range 直接从 cover 的边界 id 现算（不依赖 span 记录里的 range 快照
  // ——那是 upsertSpanRecord 写入时的下标，时间线增删后会漂）。
  let coveredRange = null;
  if (st && st.cover && st.cover.start_id && st.cover.end_id) {
    try {
      const idx = compressibleIndexById();
      const s = idx[st.cover.start_id];
      const e = idx[st.cover.end_id];
      if (typeof s === "number" && typeof e === "number") {
        coveredRange = { start_index: s, end_index: e, count: e - s + 1 };
      }
    } catch (err) { /* 读不到就当没覆盖，页面会退回让用户手填区间 */ }
  }

  return {
    ok: true,
    session: sid,
    record_id: stateRecordId(sid),
    exists: !!st,
    version: st ? (st.version || 0) : 0,
    text: st ? String(st.text || "") : "",
    flow: st ? (typeof st.flow === "string" ? st.flow : "") : "",
    lu: st && Array.isArray(st.lu) ? st.lu : [],
    lu_numbered: (st && Array.isArray(st.lu)) ? st.lu.map(function (x, i) { return { index: i + 1, text: x }; }) : [],
    ops: st && Array.isArray(st.ops) ? st.ops : [],
    cover: st && st.cover ? st.cover : null,
    covered_range: coveredRange,
    updated_at: st ? st.updated_at : null,
    seed_from_legacy: st ? !!st.seed_from_legacy : false,
    // 1003-04 撞块自动退役：把「本次并入让位了几个存量旧块」显式告诉前端，
    // 让状态卡能显示一行「已退役 N 个旧块」，否则自动停用是不可见的。
    retired_count: st && Array.isArray(st.retired_refs) ? st.retired_refs.length : 0,
    retired_refs: (st && Array.isArray(st.retired_refs)) ? st.retired_refs.slice() : [],
    versions: versions,
  };
}

function getVersionText(sessionId, version) {
  const sid = String(sessionId || "").trim();
  const list = readVersions()[sid] || [];
  const v = list.find(function (x) { return Number(x.version) === Number(version); });
  if (!v) return { ok: false, error: "该版本不在版本链里" };
  return { ok: true, version: v.version, text: String(v.text || ""), ops: v.ops || [], cover: v.cover || null, at: v.at };
}

// ========================
// 消息 → 文本
// ========================

/* [位置:lib/conversation-state.js·contentToText] [状态摘要读图片转写] [10-27：状态机压缩图片消息时，有 image_desc 就把转写给摘要模型；只影响摘要原文，不改压缩块锚点/标星 key] [注释时间 2026-10-27] */
function contentToText(msg) {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map(function (p) {
      if (!p) return "";
      if (p.type === "image_url" || p.type === "image") {
        const d = imageDesc.descriptionFor(msg, imageDesc.imageUrlOf(p));
        return d ? imageDesc.descText(d) : "";
      }
      if (typeof p.text === "string") return p.text;
      if (p.type === "text" && typeof p.text === "string") return p.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

// 记忆浮现是记忆池注入内容，不是对话本身——不进状态（口径与旧压缩器一致）
function isMemoryFlash(msg) {
  if (!msg || msg.role !== "assistant") return false;
  return String(msg.content || "").indexOf("记忆浮现") !== -1;
}

const { getUserDisplayName } = require("./display-names");

function roleLabel(msg) {
  if (!msg) return "我";
  if (msg.role === "user") return getUserDisplayName();
  if (msg.role === "developer") return "系统";
  return "我";
}

// 1025 产品确定：单条工具结果不再截断（原 TOOL_RESULT_EACH_MAX=300），工具返回多长原文就带多长进压缩原文
// 1110 产品确定：思考链不再进压缩原文（原 REASONING_EACH_MAX=600 / REASONING_TOTAL_MAX=8000 截断预算随之删除）——时间线里的 reasoning 字段不动，只是不喂给状态机模型

/* [位置:lib/conversation-state.js·formatMessages] [区间原文拼装] [把时间线消息拼成状态机模型读的区间原文：正文+完整工具调用记录，思考链不进原文（1110 产品确定），聊天侧展示思考链不受影响] [注释时间 2026-11-10] */
function formatMessages(msgs) {
  const lines = msgs.map(function (m) {
    if (isMemoryFlash(m)) return null;
    const body = contentToText(m);
    const tag = "[" + roleLabel(m) + "] ";
    // 1004-08：assistant.tools（工具调用记录）追加进压缩原文，让摘要 LLM 能看到工具链
    // （此前只拼 content+reasoning，工具记录不进原文，状态摘要里写不出工具相关内容）
    const toolLines = [];
    if (m && m.role === "assistant" && Array.isArray(m.tools) && m.tools.length) {
      m.tools.forEach(function (t) {
        const name = String((t && t.name) || "unknown");
        const time = String((t && t.time) || "");
        const err = (t && t.error) ? "（失败：" + String(t.error) + "）" : "";
        const res = String((t && t.result) || "");
        toolLines.push("[工具调用] " + name + " · " + time + err + (res ? "：" + res : "（无返回内容）"));
      });
    }
    const toolText = toolLines.length ? "\n" + toolLines.join("\n") : "";
    return tag + body + toolText;
  }).filter(Boolean);
  return { text: lines.join("\n\n"), dropped: msgs.length - lines.length };
}

function fmtTimeLabel(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = function (x) { return String(x).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// 返回 {start, end, label}：状态覆盖的是「首次并入起 ~ 最近一次并入止」这一整段，
// 所以首尾分开存，累加时只换 end、不动 start（否则第 12 次并入后标签会缩成只剩最后一段）。
function rangeLabelPartsOf(msgs) {
  const t = msgs.map(function (m) { return m && m.time ? m.time : null; }).filter(Boolean);
  if (!t.length) return { start: "", end: "", label: "" };
  const start = fmtTimeLabel(t[0]);
  const end = fmtTimeLabel(t[t.length - 1]);
  return { start: start, end: end, label: start + " ~ " + end };
}

function rangeLabelOf(msgs) {
  return rangeLabelPartsOf(msgs).label;
}

// ========================
// LLM
// ========================

// 1024-24 需求1：读会话级状态机模型覆盖（session_cfg 的 compaction_model*，面板「模型选择」存的），无则 null=跟随全局
function sessionCompactionModel(sessionId) {
  try {
    const sc = require("./session-cfg").createSessionCfg(ROOT);
    const sid = String(sessionId || "").trim();
    const m = sc.readCompactionModel(sid);
    // 10-29：面板下拉选「跟随全局状态机」= 哨兵 __role__ → null，callLlm 走全局「压缩摘要」角色路由
    if (m && m.model === "__role__") return null;
    if (m && m.model) return m;
    // 10-29：没手动选过 → 默认跟随本会话聊天模型（session_cfg 的 model_provider_id/model_name，
    // 头像菜单「模型」下拉存的）；会话也没配 → null = 全局「压缩摘要」角色
    try {
      const f = path.join(sc.SESSION_CFG_DIR, require("./session-token").safeSessionToken(sid || "default") + ".json");
      if (fs.existsSync(f)) {
        const o = JSON.parse(fs.readFileSync(f, "utf-8"));
        if (o && o.model_name) return { provider_id: String(o.model_provider_id || ""), model: String(o.model_name) };
      }
    } catch (e2) { /* 会话没配过模型/读失败 = 跟全局 */ }
    return null;
  } catch (e) { return null; }
}

async function callLlm(system, msgs, ov) {
  const router = require("./model-router");
  let provider = null, model = "";
  // 1024-24 需求1：面板选了模型且供应商可用 → 用它；供应商失效回落全局「压缩摘要」角色（日志留痕）
  if (ov && ov.model) {
    const r2 = router.resolveExplicitModel(ov.provider_id, ov.model);
    if (r2.model) { provider = r2.provider; model = r2.model; }
    else console.warn("[conversation-state] 会话所选模型不可用（" + String(ov.provider_id || "?") + " / " + ov.model + "），回落全局角色");
  }
  if (!model) {
    const rr = router.resolveRoleModel(MODEL_ROLE);
    provider = rr.provider; model = rr.model;
  }
  /* [位置:lib/conversation-state.js·callLlm resolveTarget] [出口统一走 upstream-target] [全栈审查 B 批：状态机原先手拼 provider.api_url + Bearer api_key——订阅类供应商（Claude/Gemini 订阅走内部代理，配置里根本没有 api_key）把「压缩摘要」角色选中后，这里直接判「模型未配置」，整条状态机静默失败；供应商里标了「走代理」的模型也不经本机转发口。现在往哪发、带什么凭证交给 resolveTarget（与 memory-distill / memory-summary / 主链路同一套），普通供应商的 url 与 Authorization 和原手拼完全一致，零行为变化；直连时保留 base 补 /chat/completions（viaProxy 的内部地址本身完整，不补）] [注释时间 2026-11-14] */
  const _tg = require("./upstream-target").resolveTarget(provider, function (k) { return process.env[k]; }, model);
  const apiUrl = (function () {
    let u = String((_tg && _tg.url) || "").replace(/\/+$/, "");
    if (u && !_tg.viaProxy && !/\/chat\/completions$/.test(u)) u += "/chat/completions";
    return u;
  })();
  const apiKey = _tg && _tg.key;
  if (!apiUrl || !apiKey || !model) {
    throw new Error("模型未配置（role=" + MODEL_ROLE + "）：请在管理台给「压缩摘要」选一个模型");
  }
  // max_tokens 分档重试（口径同 context-compactor 的 outputBudgets）：
  // glm-5.3-flash 这类思考模型的思考也计入 max_tokens（记忆：智谱四坑），不给够预算
  // 正文会被截断 → JSON 解析失败。首档 16000 不够就逐档加到 50000。
  const outputBudgets = [32000, 50000, 80000]; // 1007-05：首档 16000→32000（思考链计入 max_tokens，用户拍板），末档 80000 兜底
  let lastErr = null;
  for (let attempt = 0; attempt < outputBudgets.length; attempt++) {
    const base = {
      model: model,
      messages: [{ role: "system", content: system }].concat(msgs),
      response_format: { type: "json_object" },
      max_tokens: outputBudgets[attempt],
    };
    /* [位置:conversation-state.js·callLlm thinkingPatch] [状态机显式开思考] [11-09：状态机原先不发思考参数——Claude 全裸（真没思考，主会话状态机质量问题的根源）、deepseek 靠厂商默认；现在按供应商显式上锁（Claude 固定 high，不跟随聊天档位）] [注释时间 2026-11-09] */
    Object.assign(base, router.thinkingPatch(provider));
    // 订阅/走代理的供应商要额外带 x-internal-key、x-provider-id 等头（由 resolveTarget 给）
    const headers = Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + apiKey }, (_tg && _tg.headers) || {});
    // 2026-10-18：走流式 + 网络错误自动重试。非流式长请求在中转站上会在 ~158s 被掐断（read ETIMEDOUT，
    // 10-17 00:36、10-18 14:43 两次实测）；流式数据一直有往来不会空闲。上游不认 stream 才退回非流式。
    let streamOk = true;
    let data;
    try {
      data = await httpStream.withRetry(async function () {
        if (streamOk) {
          try {
            const sp = JSON.stringify(Object.assign({}, base, { stream: true, stream_options: { include_usage: true } }));
            return await llmLog.post("state_machine", httpStream.postChatStream, apiUrl, sp, headers, LLM_TIMEOUT_MS);
          } catch (e) {
            if (!httpStream.isStreamUnsupported(e)) throw e;
            streamOk = false;
            console.warn("[conversation-state] 上游不支持流式，改用非流式：" + String(e.message || e).slice(0, 120));
          }
        }
        return await llmLog.post("state_machine", httpPostJson, apiUrl, JSON.stringify(base), headers, LLM_TIMEOUT_MS);
      }, { label: "conversation-state" });
    } catch (e) {
      throw httpStream.friendlyNetError(e);
    }
    const choice = data.choices && data.choices[0];
    const text = choice && choice.message && choice.message.content;
    const finish = choice && choice.finish_reason;
    if (!text || !String(text).trim() || finish === "length") {
      lastErr = new Error(!text || !String(text).trim()
        ? "上游返回空正文（HTTP 正常）"
        : "正文被截断（finish_reason=length，输出预算 " + outputBudgets[attempt] + " 不够）");
      continue;
    }
    return { text: String(text), model: model, finish_reason: finish, max_tokens: outputBudgets[attempt] };
  }
  throw lastErr || new Error("模型调用失败");
}

// [位置:lib/conversation-state.js·repairJsonPunct] [模型 JSON 标点容错] [2026-11-06：deepseek-flash 在 ops 段连出两类标点错——①多/少括号（0007：desc 后多一个 ]，json 在 5370 断）②结构处多一个引号（0014：]","ops" 处，json 在 4862 断）；整次作废=白烧 20 多万 token，产品要求解析侧容错。只动标点、不动内容：不匹配的闭合括号丢弃、紧跟 ]/} 且后接结构符的多余引号丢弃、字符串里的裸换行转义；字符串没闭合（内容真被截断）一律拒绝，不把半截正文伪装成完整] [注释时间 2026-11-06]
function repairJsonPunct(src) {
  const s = String(src || "");
  const isWs = function (ch) { return ch === " " || ch === "\n" || ch === "\r" || ch === "\t"; };
  const prevNonWs = function (i) { let j = i; while (j >= 0 && isWs(s[j])) j--; return j >= 0 ? s[j] : ""; };
  const nextNonWs = function (i) { let j = i; while (j < s.length && isWs(s[j])) j++; return j < s.length ? s[j] : ""; };
  let out = "", stack = [], inStr = false, esc = false, dropped = 0, escaped = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === "\n") { out += "\\n"; escaped++; continue; }
      if (ch === "\r") { out += "\\r"; escaped++; continue; }
      if (ch === "\t") { out += "\\t"; escaped++; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') {
      // 结构位置上的多余引号：[ 或 } 后面紧跟一个引号、再接 , : ] } —— 正常 JSON 里不可能出现
      const p = prevNonWs(i - 1), n = nextNonWs(i + 1);
      if ((p === "]" || p === "}") && (n === "," || n === ":" || n === "]" || n === "}")) { dropped++; continue; }
      inStr = true; out += ch; continue;
    }
    if (ch === "{" || ch === "[") { stack.push(ch); out += ch; continue; }
    if (ch === "}" || ch === "]") {
      const want = ch === "}" ? "{" : "[";
      if (stack[stack.length - 1] === want) { stack.pop(); out += ch; }
      else { dropped++; }        // 括号提前闭合/不匹配：丢掉，等真正的位置再补
      continue;
    }
    out += ch;
  }
  if (inStr) return { error: "字符串没闭合（内容被截断）" };
  while (stack.length) { out += (stack.pop() === "{" ? "}" : "]"); dropped++; }
  return { text: out, dropped: dropped, escaped: escaped };
}

// 思考模型会把推理混进 content：抠第一个完整 JSON 对象出来
function parseResponse(raw) {
  const s = String(raw || "");
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const a = body.indexOf("{");
  if (a === -1) return { error: "没找到 JSON 对象" };
  const b = body.lastIndexOf("}");
  if (b > a) {
    try { return JSON.parse(body.slice(a, b + 1)); } catch (e) { /* 落到下面的标点修复 */ }
  }
  // 标点写坏：先按 [第一个 {, 最后一个 }] 修；末尾连 } 都没有时退到最末再修
  const tries = b > a ? [body.slice(a, b + 1), body.slice(a)] : [body.slice(a)];
  for (let k = 0; k < tries.length; k++) {
    const r = repairJsonPunct(tries[k]);
    if (!r.text) continue;
    try {
      const o = JSON.parse(r.text);
      if (o && typeof o === "object" && !Array.isArray(o)) {
        o._repaired = true;
        o._repair_note = "补/丢标点 " + r.dropped + " 处" + (r.escaped ? "、转义换行 " + r.escaped + " 处" : "");
        return o;
      }
    } catch (e2) { /* 换下一种切法 */ }
  }
  return { error: "JSON 解析失败：" + (function () { try { JSON.parse(body.slice(a, Math.max(a + 1, b + 1))); } catch (e) { return e.message; } return "结构不完整"; })() };
}

function normalizeOps(ops) {
  if (!Array.isArray(ops)) return [];
  const out = [];
  ops.forEach(function (o) {
    if (!o || typeof o !== "object") return;
    const type = String(o.type || "").trim();
    if (["add", "update", "remove"].indexOf(type) === -1) return;
    const desc = String(o.desc || "").trim();
    if (!desc) return;
    out.push({ type: type, desc: desc, reason: String(o.reason || "").trim() });
  });
  return out;
}

// ========================
// 检索回合（照搬 memory-distill.js:951-971 的形态）
// ========================

async function runSearchRequests(reqs, seenBatch) {
  const list = Array.isArray(reqs) ? reqs.slice(0, SEARCH_MAX_PER_ROUND) : [];
  const parts = [];
  let got = 0;
  let dup = 0;
  for (const r of list) {
    const time = String((r && r.time) || "").trim();
    const q = String((r && r.q) || "").trim();
    if (!time && !q) continue;
    let res;
    try {
      const opts = { allSessions: true, limit: SEARCH_LIMIT_PER_QUERY, contentCap: SEARCH_CONTENT_CAP };
      if (time) opts.timePrefix = time;                   // 只给 time：按日期直接读原文；time 加 q：网关按关键词搜、再按时间段过滤（11-09 后台检索统一走网关 /internal/search）
      res = await contextReplacements.searchContextEnhanced(q, opts);
    } catch (e) {
      parts.push("【检索失败】" + (time || q) + "：" + e.message);
      continue;
    }
    /* [位置:lib/conversation-state.js·检索回合取结果] [字段名补 matches] [11-09：searchContextEnhanced 返回的字段叫 matches，这里原来取的是 results/messages/items 三个都不存在的名字，检索回合恒空手（取不到任何原文）；改成只认 matches] [注释时间 2026-11-09] */
    const hits = (res && res.matches) || [];
    const kept = [];
    for (const h of hits) {
      const id = String((h && (h.id || h.msg_id)) || "");
      if (!id) continue;
      if (seenBatch[id]) { dup++; continue; }             // 同一条原文本批只给一次
      seenBatch[id] = true;
      kept.push("#" + id + " [" + roleLabel(h) + "] " + contentToText(h));
      got++;
    }
    if (kept.length) {
      parts.push("【检索】" + (time || q) + "\n" + kept.join("\n"));
    } else {
      parts.push("【检索】" + (time || q) + "：没有新的原文（本批前面已给过的内容不再重复）。");
    }
  }
  const text = parts.join("\n\n");
  return { text: text, got: got, dupCount: dup };
}

// ========================
// 预览（不落盘）
// ========================

function sliceRange(sessionId, start, end) {
  const items = contextReplacements.compressibleItems();
  const total = items.length;
  const s = Math.max(1, Math.floor(Number(start) || 1));
  let e = Math.floor(Number(end));
  if (!Number.isInteger(e) || e < s) e = s;
  e = Math.min(e, total);
  if (s > total) return { ok: false, error: "起始编号超出可压缩范围（共 " + total + " 条）" };
  const slice = items.slice(s - 1, e);
  const msgs = slice.map(function (it) { return it.msg; }).filter(Boolean);
  return { ok: true, msgs: msgs, count: msgs.length, total: total, startNum: s, endNum: e };
}

// [位置:lib/conversation-state.js·rangeCharsOf] [区间实际送模型的字数] [2026-11-06：前端要按区间字数提示分块。口径必须和真正塞进 ${CONVERSATION_TEXT} 的一致——formatMessages 会带上工具调用结果（单条能到几十万字），只算消息正文会少算一个量级；显式切到目标会话再算] [注释时间 2026-11-06]
function rangeCharsOf(sessionId, start, end) {
  try {
    const sid = String(sessionId || "").trim();
    if (sid && contextReplacements.getActiveSession() !== sid) contextReplacements.setActiveSession(sid);
    const range = sliceRange(sid, start, end);
    if (!range.ok || !range.msgs.length) return 0;
    return formatMessages(range.msgs).text.length;
  } catch (e) { return 0; }
}

async function previewMerge(params) {
  const sessionId = String(params && params.session || "").trim();
  if (!sessionId) return { ok: false, error: "缺少 sessionId" };
  const range = sliceRange(sessionId, params.start, params.end);
  if (!range.ok) return range;
  if (!range.msgs.length) return { ok: false, error: "选中区间里没有可并入的消息" };

  const cur = getState(sessionId);
  // 1010 需求2：本会话还没有自己的状态时，PREV_STATE 继承「最后一次聊天的会话」的状态正文——
  // 让模型拿着 A 的最新状态演化出本会话的第一版（B 一旦自己 commitMerge，之后全用自己的）。
  // 1025 产品确定：状态分两层——流动层（每次整体重写）/ 追加层（来路账本，只增不改）。
  // PREV_STATE 只给流动层；账本单独给模型做只读参考（${LU}），输出时只提交新增（lu_add）。
  let prevText = cur.exists ? (typeof cur.flow === "string" && cur.flow ? cur.flow : cur.text) : "（无，这是这个会话的第一版状态）";
  let luArr = (cur.exists && Array.isArray(cur.lu)) ? cur.lu.slice() : [];
  if (!cur.exists) {
    // 1018：只有勾了「继承上个会话状态」才拿承接来的那一版当底稿，否则新会话从零开始
    const inh = getInheritedState(sessionId, { requireSelected: true });
    if (inh) {
      prevText = (typeof inh.flow === "string" && inh.flow) ? inh.flow : inh.text;
      // 账本取源会话当前账本（追加层只增，跨会话延续，不需要模型重新搬）
      luArr = Array.isArray(inh.lu) ? inh.lu.slice() : luArr;
    }
  }
  const luText = luArr.length ? formatLuLines(luArr) : "（空，还没有任何来路条目）";
  const fmt = formatMessages(range.msgs);
  const rangeParts = rangeLabelPartsOf(range.msgs);
  const pc = loadPromptConfig(sessionId);   // 11-01 #60：传会话，命中会话级选择的提示词
  /* [位置:lib/conversation-state.js·previewMerge] [生成日志标注提示词] [11-02：多套提示词生效与否悬浮球里看不出，选了新套不生效（state-worker 没重启）查了半天；pending/成功日志带上本次用的哪套（会话选套名/全局自定义/内置默认），当场现形] [注释时间 2026-11-02] */
  const promptTag = pc.prompt_name ? "用「" + pc.prompt_name + "」" : (pc.custom_set ? "用全局自定义" : "用内置默认");
  const userMsg = pc.user_template
    .replace(/\$\{PREV_STATE\}/g, prevText)
    .replace(/\$\{LU\}/g, luText)
    .replace(/\$\{CHUNK_INFO\}/g, "第 " + range.startNum + "~" + range.endNum + " 条，共 " + range.count + " 条，" + (rangeLabelOf(range.msgs) || "时间未知"))
    .replace(/\$\{CONVERSATION_TEXT\}/g, fmt.text);

  // 锚点：区间首尾**非记忆浮现**的消息（记忆浮现不进状态也不该当锚点）
  const anchorable = range.msgs.filter(function (m) { return m && m.id && !isMemoryFlash(m); });
  if (!anchorable.length) return { ok: false, error: "区间里没有可定位的消息 id" };
  const startMsg = anchorable[0];
  const endMsg = anchorable[anchorable.length - 1];

  const msgs = [{ role: "user", content: userMsg }];
  const seenBatch = Object.create(null);
  let raw = "";
  let parsed = null;
  let searchRounds = 0;
  let model = null;
  let lastErr = null;

  // 悬浮球日志：pending → success/error（addCompactionLog 的 id 语义：带 id 即更新原条目）
  // 1007-05：独立 worker 进程调用时由 gateway 登记任务时创建日志并传入 logId
  //（跨进程拿不到同步 id，沿用原条目更新即可）；gateway 进程内调用时保持原行为。
  const logId = params.logId ? String(params.logId) : (function () {
    const e = logEntry({
      label: "状态并入 · " + sessionId.slice(-12),
      session: sessionId,
      status: "pending",
      message: "正在算新状态：第 " + range.startNum + "~" + range.endNum + " 条（" + range.count + " 条）· " + promptTag,
    });
    return e && e.id;
  })();

  let cancelled = false;
  for (let turn = 0; turn <= SEARCH_ROUNDS + 1; turn++) {
    /* [位置:lib/conversation-state.js·previewMerge 取消检查] [批间暂停口] [/compact 收尾入口的「暂停」：每轮调模型前查取消，命中即停、走失败路径不落候选不动时间线] [注释时间 2026-11-14] */
    if (isCancelled(sessionId)) { cancelled = true; lastErr = new Error(CANCEL_MSG); break; }
    let r;
    try {
      r = await callLlm(pc.system, msgs, sessionCompactionModel(sessionId));   // 1024-24 需求1：会话级模型覆盖
    } catch (e) {
      lastErr = e;
      break;
    }
    raw = r.text;
    if (r.model) model = r.model;
    const p = parseResponse(raw);
    if (p.error) { lastErr = new Error(p.error + "（模型 " + (model || "?") + "，finish_reason=" + (r.finish_reason || "?") + "）"); break; }
    const searchReqs = Array.isArray(p.search) ? p.search : [];
    if (searchReqs.length && searchRounds < SEARCH_ROUNDS) {
      searchRounds++;
      logEntry({ id: logId, status: "pending", message: "模型自提检索第 " + searchRounds + " 轮（" + searchReqs.length + " 条请求）…" });
      const found = await runSearchRequests(searchReqs, seenBatch);
      msgs.push({ role: "assistant", content: raw });
      msgs.push({ role: "user", content: "【回灌原文】\n" + found.text });
      continue;
    }
    parsed = p;
    break;
  }

  if (!parsed) {
    /* [位置:lib/conversation-state.js·previewMerge 取消落账] [暂停走失败路径但不误导排查] [手动暂停时日志直接写「已暂停」，不拼模型原始输出冒充解析错误；返回带 cancelled 给 worker 侧记日志用] [注释时间 2026-11-14] */
    const errMsg = cancelled ? CANCEL_MSG :
      (lastErr && lastErr.message ? lastErr.message : "模型没给出可解析的 JSON") +
      (raw ? "（原始输出前 200 字：" + raw.slice(0, 200).replace(/\n/g, " ") + "）" : "");
    logEntry({ id: logId, status: "error", message: errMsg });
    return {
      ok: false,
      error: errMsg,
      cancelled: cancelled || undefined,
      raw_head: cancelled ? undefined : raw.slice(0, 500),
      model: model,
      search_rounds: searchRounds,
    };
  }

  let stateText = String(parsed.state || "").trim();
  if (!stateText) {
    const e2 = "模型没给出 state 正文";
    logEntry({ id: logId, status: "error", message: e2 });
    return { ok: false, error: e2, raw_head: raw.slice(0, 500) };
  }
  if (stateText.length > MAX_STATE_CHARS) {
    const e3 = "状态正文超长（" + stateText.length + " 字，硬上限 " + MAX_STATE_CHARS + "）";
    logEntry({ id: logId, status: "error", message: e3 });
    return { ok: false, error: e3 };
  }

  // 1025 追加层：归一化 lu_add；防御——模型若按老习惯把来路夹带进 state，剥出来进账本
  let luAdd = (Array.isArray(parsed.lu_add) ? parsed.lu_add : [])
    .map(function (x) { return String(x || "").replace(/\s+/g, " ").trim(); }).filter(Boolean);
  // 1025 补丁：防御触发条件收紧——「【来路】」必须独占一行才触发。
  // 原 indexOf("【来路】") 会命中正文里对这三个字的引用（如"曾以为靠找「【来路】」标记
  // 切分旧状态就够了"），把流动层拦腰截断、后半全文误入账本（02:37 实际发生，
  // s_zztmp_stoptest_1024a v2：flow 2535→1060 字，账本混入 21 条脏数据）。
  const _luM = stateText.match(/(^|\n)【来路】[ \t]*(\n|$)/);
  if (_luM) {
    const _luHead = _luM.index + _luM[1].length;
    stateText.slice(_luHead).split("\n").slice(1).forEach(function (ln) {
      const t = ln.trim().replace(/^-\s*/, "").replace(/\s+/g, " ").trim();
      if (t && t !== "【来路】") luAdd.push(t);
    });
    stateText = stateText.slice(0, _luHead).trim();
    console.warn("[conversation-state] 模型把来路写进了 state（独立段落），已剥出 " + luAdd.length + " 条进账本（防御逻辑）");
  }

  // 1004-11：候选版本号与 commitMerge 同口径（链上最大号+1，回滚后 cur.version 会小于链上最大）
  const _chainMaxVer = (function () {
    const _vs = readVersions()[sessionId] || [];
    let _mv = Number((cur && cur.version) || 0);
    _vs.forEach(function (v) { if (Number(v.version) > _mv) _mv = Number(v.version); });
    return _mv;
  })();
  const opsOut = (function () {
    const o = normalizeOps(parsed.ops);
    return luAdd.length ? o.concat([{ type: "add", desc: "来路新增 " + luAdd.length + " 条", reason: "" }]) : o;
  })();
  logEntry({
    id: logId,
    status: "success",
    message: "已算好 v" + (_chainMaxVer + 1) + " 候选（状态 " + stateText.length + " 字、变更 " +
      opsOut.length + " 条" + (luAdd.length ? "、来路新增 " + luAdd.length + " 条" : "") + (searchRounds ? "、检索 " + searchRounds + " 轮" : "") + "、" + promptTag +
      (parsed && parsed._repaired ? "；模型把 JSON 写坏（" + parsed._repair_note + "），已按结构补全" : "") +
      "），等确认并入",
  });

  const rangeOut = {
    start_num: range.startNum,
    end_num: range.endNum,
    count: range.count,
    range_label: rangeParts.label,
    label_start: rangeParts.start,
    label_end: rangeParts.end,
    start_id: String(startMsg.id),
    end_id: String(endMsg.id),
    start_msg: startMsg,
    end_msg: endMsg,
  };

  // 落盘候选（2026-10-04）：算一次要 1~5 分钟，结果只放浏览器内存的话刷新就没了——
  // 用户反馈「生成成功了但没显示、不知道到哪去了」。落盘后刷新/切会话都还在，
  // 管理台能显示「本会话有一份待确认的候选」，但它不进上下文、不进版本链，
  // 要点「确认并入」才真正生效。
  // 1011-03：已有未确认候选时禁止静默覆盖（默认不覆盖，除非显式 overwrite:true）——
  // 覆盖只走用户确认后的入口。冲突时返回 conflict 标记 + 旧候选信息，前端据此提示。
  /* [位置:lib/conversation-state.js·previewMerge 落候选前取消检查] [最后一道暂停口] [/compact 暂停：模型已出结果但还没落盘，此刻停则结果丢弃、什么都不写（与失败路径同口径）] [注释时间 2026-11-14] */
  if (isCancelled(sessionId)) {
    logEntry({ id: logId, status: "error", message: CANCEL_MSG });
    return { ok: false, error: CANCEL_MSG, cancelled: true };
  }
  const existingCand = readCandidates()[sessionId] || null;
  const overwrite = !!(params && params.overwrite);
  const candPayload = {
    session: sessionId,
    state: stateText,
    lu_add: luAdd,
    ops: opsOut,
    range: rangeOut,
    model: model,
    search_rounds: searchRounds,
    search_hits: Object.keys(seenBatch).length,
    prev_version: cur.version,
    created_at: nowIso(),
  };
  try {
    const saved = saveCandidate(sessionId, candPayload, { overwrite: overwrite });
    if (saved && saved.ok === false && saved.conflict) {
      const ex = existingCand;
      logEntry({
        id: logId,
        status: "error",
        message: "本会话已有一份未确认的候选（" + String(ex && ex.state || "").length + " 字，"
          + (ex && ex.created_at ? ex.created_at.slice(0, 10) : "时间未知") + " 生成），本次结果未覆盖；请先丢弃旧候选或确认覆盖后重算",
      });
      return {
        ok: false,
        error: "本会话已有一份未确认的候选，本次结果未覆盖；请先丢弃旧候选或确认覆盖后重算",
        conflict: true,
        existing: {
          chars: String(ex && ex.state || "").length,
          created_at: (ex && ex.created_at) || null,
        },
      };
    }
    console.log("[conversation-state] 候选状态已暂存 " + sessionId + "（" + stateText.length + " 字，等确认并入）");
  } catch (e) {
    // 暂存失败不影响本次预览结果返回——只是刷新后会丢，日志里留痕
    console.warn("[conversation-state] 候选状态暂存失败（刷新后会丢）：", e.message);
  }

  return {
    ok: true,
    session: sessionId,
    model: model,
    search_rounds: searchRounds,
    search_hits: Object.keys(seenBatch).length,
    prev_version: cur.version,
    state: stateText,
    lu_add: luAdd,
    ops: opsOut,
    range: rangeOut,
  };
}

// ========================
// 落盘
// ========================

// 确认并入：结果（成功/失败）都写悬浮球日志。并入本身是即时的（不调模型），
// 失败几乎都是校验拒绝（连续性断言/重叠断言/锚点丢失）——正需要日志说明原因。
function commitMerge(params) {
  const r = _commitMerge(params);
  const sessionId = String(params && params.session || "").trim();
  const ver = r.ok ? ("v" + r.version) : "?";
  const coverTxt = (r.ok && r.cover) ? ((r.cover.label_start || "") + " ~ " + (r.cover.label_end || "")) : "";
  logEntry({
    label: "状态并入 · " + (sessionId ? sessionId.slice(-12) : "?"),
    session: sessionId,
    status: r.ok ? "success" : "error",
    message: r.ok
      ? "已确认并入 → " + ver + "（覆盖 " + coverTxt + "，状态 " + String(r.text || "").length + " 字）"
      : "并入失败：" + (r.error || "未知原因"),
  });
  return r;
}

function _commitMerge(params) {
  const sessionId = String(params && params.session || "").trim();
  if (!sessionId) return { ok: false, error: "缺少 sessionId" };
  const text = String(params.state || "").trim();
  if (!text) return { ok: false, error: "状态正文为空" };
  if (text.length > MAX_STATE_CHARS) return { ok: false, error: "状态正文超长" };

  const cur = getState(sessionId);
  // 1025 追加层：新增来路条目——显式传入优先，其次取候选里暂存的；账本只增不改
  const candForLu = readCandidates()[sessionId] || null;
  const luAdd = (Array.isArray(params.lu_add) ? params.lu_add : (candForLu && Array.isArray(candForLu.lu_add) ? candForLu.lu_add : []))
    .map(function (x) { return String(x || "").replace(/\s+/g, " ").trim(); }).filter(Boolean);
  const curLu = (cur.exists && Array.isArray(cur.lu)) ? cur.lu.slice() : [];
  const newLu = curLu.concat(luAdd);
  const fullText = newLu.length
    ? text + "\n\n【来路】\n" + formatLuLines(newLu) + "\n"
    : text;
  // 版本号单调递增（指针模型）：回滚到 v5 后再并入，新版本是「链上最大号 +1」（如 v9），
  // 不是 cur.version+1（那会跟链上已存在的 v6 撞号）。
  const chain = readVersions()[sessionId] || [];
  let maxVer = cur.version || 0;
  chain.forEach(function (v) { if (Number(v.version) > maxVer) maxVer = Number(v.version); });
  const nextVersion = maxVer + 1;

  // 覆盖区间：首版取本次区间起点，之后固定住起点、只往后延（连续前缀）
  const endMsg = params.end_msg;
  if (!endMsg || !endMsg.id) return { ok: false, error: "缺少区间末尾锚点消息" };

  const tl = contextReplacements.loadTimeline();
  let coverStartMsg = null;
  // 1010-17 降级：时间线被裁剪/删除导致旧覆盖起点丢失时，若候选起点仍存在于时间线，
  // 以候选起点重新锚定并继续并入（等效整份重算），避免会话被「锚点已丢失」永久卡死。
  let coverStartDegraded = false;
  if (cur.exists && cur.cover && cur.cover.start_id) {
    coverStartMsg = tl.find(function (m) {
      return m && m.id && String(m.id) === String(cur.cover.start_id);
    }) || null;
    if (!coverStartMsg) {
      const candStart = (params.start_msg && params.start_msg.id) ? params.start_msg : null;
      if (!candStart) return { ok: false, error: "当前状态的起始锚点已不在时间线里，且缺少候选起点，请先整份重算" };
      const candFound = tl.some(function (m) { return m && m.id && String(m.id) === String(candStart.id); });
      if (!candFound) return { ok: false, error: "当前状态的起始锚点已不在时间线里，候选起点也不在时间线里，请先整份重算" };
      coverStartMsg = candStart;
      coverStartDegraded = true;
      console.warn("[conversation-state] 降级并入 " + sessionId + "：旧起始锚点(" + cur.cover.start_id + ")已不在时间线，改用候选起点(" + candStart.id + ")继续并入");
    }
  } else {
    coverStartMsg = (params.start_msg && params.start_msg.id) ? params.start_msg : null;
    if (!coverStartMsg) return { ok: false, error: "缺少区间起始锚点消息" };
  }

  // ★ 连续性断言：状态覆盖的是一段「连续前缀」，本次并入必须紧接在它后面。
  // 漏了这条会让一段从未被模型读过的原文被状态静默吞掉——表现是「那段对话像是从没发生过」，
  // 而且不可察觉（状态正文不报错、注入也正常）。宁可拒绝写入。
  if (cur.exists && cur.covered_range && typeof cur.covered_range.end_index === "number") {
    const idPos = compressibleIndexById();
    const newStart = (params.start_msg && params.start_msg.id) ? idPos[String(params.start_msg.id)] : undefined;
    const newEnd = endMsg.id ? idPos[String(endMsg.id)] : undefined;
    if (newStart === undefined || newEnd === undefined) {
      return { ok: false, error: "本次并入区间的消息在当前会话的可压缩列表里定位不到，换个区间再试" };
    }
    const expected = cur.covered_range.end_index + 1;   // 0-based
    if (newStart !== expected) {
      const gapFrom = expected + 1;
      return {
        ok: false,
        error: "并入区间必须紧接在状态覆盖范围之后。当前状态覆盖到第 " + cur.covered_range.end_index +
          " 条，本次却从第 " + (newStart + 1) + " 条开始——第 " + gapFrom + "~" + newStart +
          " 条会被状态吞掉，但模型从没读过它们。\n请从第 " + gapFrom + " 条开始并入（或用「自动分块」）。",
      };
    }
  }

  const recordId = stateRecordId(sessionId);
  // 覆盖区间标签：首次并入用本次起点，之后起点不动、只推进终点
  // （否则第 12 次并入后标签会缩成只剩最后一段，页面上会误导「这份状态只覆盖了最近一次」）
  const prevCover = (cur.exists && cur.cover) ? cur.cover : null;
  const passedLabel = String(params.range_label || "");
  const passedParts = passedLabel.split(" ~ ");
  // 1010-17：降级并入时旧 label_start 已随锚点作废，改用候选起点标签，保证标签与真实锚点一致
  const labelStart = coverStartDegraded
    ? (String(params.label_start || "") || passedParts[0] || "")
    : ((prevCover && prevCover.label_start)
      ? prevCover.label_start
      : (String(params.label_start || "") || passedParts[0] || ""));
  const labelEnd = String(params.label_end || "") || passedParts[1] || "";
  const cover = {
    start_id: String(coverStartMsg.id),
    end_id: String(endMsg.id),
    label_start: labelStart,
    label_end: labelEnd,
  };
  const coverLabel = labelStart && labelEnd ? (labelStart + " ~ " + labelEnd) : (labelStart || labelEnd || "");

  // 退役清单：本次退役的旧块会累加进来，回滚/撤销时据此开回来。
  let prevRetiredRefs = (cur.retired_refs && Array.isArray(cur.retired_refs)) ? cur.retired_refs.slice() : [];

  // ★ 撞块自动退役（2026-10-04）：存量旧块不迁移，状态机却在真跑。
  // 连续前缀从第 1 条起推，必然撞上存量旧块——原来 upsertSpanRecord 的重叠断言会直接拒，
  // 结果是「存量会话里状态机基本并不动」。改为先把相交的旧块停用（数据不删、可恢复），
  // 再写状态。
  //
  // 退役区间取「本次的完整覆盖前缀」而不是「本次并入的那一段」：状态记录替换的是
  // 起点固定、终点推进的整段，之前几版吃掉的区间也归这一条记录管，那些区间里的旧块
  // 同样要让位，否则 applyReplacements 定位会与旧块交错。
  //
  // 失败即复原：退役是「准备动作」，任何后续步骤失败都必须把旧块恢复原状，
  // 否则用户会遇到「并入没成功、旧块却凭空消失」。
  const retireRes = contextReplacements.retireOverlappingLegacyBlocks({
    session: sessionId,
    startId: cover.start_id,
    endId: cover.end_id,
    excludeId: recordId,
  });
  if (!retireRes.ok) {
    return { ok: false, error: retireRes.error || "退役冲突旧块失败" };
  }
  const retired = Array.isArray(retireRes.retired) ? retireRes.retired : [];
  // 退役清单随状态一起留档：回滚/撤销时据此把旧块开回来（指针模型下不截链，见 rollback）。
  if (retired.length) {
    retired.forEach(function (r) {
      prevRetiredRefs.push({ id: r.id, retired_at_version: nextVersion, at: nowIso() });
    });
  }

  const spanRes = contextReplacements.upsertSpanRecord({
    recordId: recordId,
    session: sessionId,
    startMsg: coverStartMsg,
    endMsg: endMsg,
    text: fullText,
    rangeLabel: coverLabel,
    count: params.count != null ? Number(params.count) : undefined,
    source: "state",
  });
  if (!spanRes.ok) {
    // 状态没写进去 → 旧块必须原样回来
    if (retired.length) contextReplacements.restoreRetiredBlocks(retired);
    return { ok: false, error: spanRes.error || spanRes.message || "写入状态记录失败" };
  }

  // 操作清单：前端标记为拦截的 remove 不写进历史（那是「本来就没删」的诚实记录）
  const blocked = Array.isArray(params.blocked) ? params.blocked.map(String) : [];
  const ops = normalizeOps(params.ops).filter(function (o) {
    return !(o.type === "remove" && blocked.indexOf(o.desc) !== -1);
  });

  const states = readStates();
  states[sessionId] = {
    version: nextVersion,
    record_id: recordId,
    flow: text,
    lu: newLu,
    text: fullText,
    ops: ops,
    cover: cover,
    updated_at: nowIso(),
    seed_from_legacy: false,
    retired_refs: prevRetiredRefs,
  };
  writeJson(STATE_FILE, states);

  const versions = readVersions();
  const list = versions[sessionId] || [];
  list.unshift({
    version: nextVersion,
    flow: text,
    lu: newLu,
    text: fullText,
    ops: ops,
    cover: cover,
    at: nowIso(),
    source: params.source || "merge",
    // 本版退役了哪些旧块（累计）。rollback 切回旧版时按它复原——否则回滚后
    // 那段旧块的原文永远回不来，而状态覆盖范围已经缩回去了。
    retired_refs: prevRetiredRefs.slice(),
  });
  // 所有已提交版本永久留在版本链中；回滚只移动当前指针，不删除任何历史版本。
  versions[sessionId] = list;
  writeJson(VERSIONS_FILE, versions);

  // 候选已并入 → 清掉（否则管理台会一直显示一份已经过期的「待确认」）
  try { clearCandidate(sessionId); } catch (e) { /* 清不掉不影响并入结果 */ }

  console.log("[conversation-state] 已并入 " + sessionId + " → v" + nextVersion +
    "（覆盖到 " + (params.range_label || "") + "，状态 " + text.length + " 字）");

  return getState(sessionId);
}

function rollback(params) {
  const sessionId = String(params && params.session || "").trim();
  const target = Number(params && params.version);
  if (!sessionId) return { ok: false, error: "缺少 sessionId" };
  const list = readVersions()[sessionId] || [];
  const v = list.find(function (x) { return Number(x.version) === target; });
  if (!v) return { ok: false, error: "该版本不在已保存的版本链中" };
  const cur = getState(sessionId);
  // 指针模型：cur.exists=false（整条已撤销）时也允许切——那就是「从并入记录里恢复」，
  // 状态从这里重建。没有状态时无所谓「挪指针」，就是原样恢复那一版。
  // 1025 追加层原语义「账本只增不减、不随回滚走」已于 2026-11-11 改为：流动层与账本都还原到那一版（见 rollLu）；
  // 注入文本按「该版流动层 + 该版账本」重拼，保持 text/flow/lu 自洽。
  // 老版本记录没有 flow（迁移前）时把 v.text 整份当流动层——可能夹带旧来路与账本重复，
  // 下次并入时模型按指令不复述来路，重复会被自然淘汰（回滚到迁移前版本是罕见路径）。
  const rollFlow = (typeof v.flow === "string" && v.flow) ? v.flow : String(v.text || "");
  // 2026-10-29 修复（审查 P0）：原写法在此处三元里引用了 1144 行才声明的 st，构成 TDZ，
  // 「整条状态已撤销后再回滚」这条路径必抛 ReferenceError: Cannot access 'st' before initialization
  // （已用最小复现确认）。且 1154 行 st.lu = rollLu 说明 st 是本函数新建的输出对象，
  // 拿它当「旧账本来源」读本身即逻辑错误。老版本无独立账本时回退取当前账本：
  // 整条撤销时账本已随 states[sessionId] 一并删除，此处取空数组即正确值
  // （原分支里 st.lu 在该场景下同样是 undefined，行为等价）。
  // 2026-11-11 产品确定改：切版本时来路账本也按「那一版当时存的」还原（v.lu，commitMerge/editStateText 都会写），
  // 切回最新版账本跟着回来；否则切到 v3 却看到 v8 的整串来路，预览（读 v3 全文）与切换后对不上。
  // 老版本记录没有 flow/lu（迁移前）时仍沿用当前账本——那种版本的 text 自带来路段，没有可还原的独立账本。
  const verHasLedger = typeof v.flow === "string" && v.flow && Array.isArray(v.lu);
  const rollLu = (verHasLedger
    ? v.lu
    : ((cur.exists && Array.isArray(cur.lu)) ? cur.lu : [])).slice();
  const rollText = rollLu.length
    ? rollFlow + "\n\n【来路】\n" + formatLuLines(rollLu) + "\n"
    : rollFlow;

  const tl = contextReplacements.loadTimeline();
  const startMsg = tl.find(function (m) { return m && m.id && String(m.id) === String(v.cover && v.cover.start_id); });
  const endMsg = tl.find(function (m) { return m && m.id && String(m.id) === String(v.cover && v.cover.end_id); });
  if (!startMsg || !endMsg) return { ok: false, error: "该版本的覆盖锚点已不在时间线里，无法回滚" };

  const spanRes = contextReplacements.upsertSpanRecord({
    recordId: stateRecordId(sessionId),
    session: sessionId,
    startMsg: startMsg,
    endMsg: endMsg,
    text: rollText,
    rangeLabel: (v.cover && v.cover.label_start && v.cover.label_end)
      ? (v.cover.label_start + " ~ " + v.cover.label_end)
      : ((cur.cover && (cur.cover.label_start || cur.cover.label_end))
        ? ((cur.cover.label_start || "") + (cur.cover.label_end ? " ~ " + cur.cover.label_end : ""))
        : ""),
    source: "state",
  });
  if (!spanRes.ok) return { ok: false, error: spanRes.error || "回滚写入失败" };

  // 旧块复原（2026-10-04）：回滚把覆盖范围缩回去了，那些被新版退役的旧块
  // 应当重新生效，否则用户回滚后才发现「那段对话的摘要也一起没了」。
  // 只复原 target 版之后退役的（target 自己的 retired_refs 是它并入时退役的，
  // 那些在 target 的覆盖范围内、仍由状态管着，不该开回来）。
  const targetRefs = Array.isArray(v.retired_refs) ? v.retired_refs : [];
  const newerRefs = ((cur.retired_refs && Array.isArray(cur.retired_refs)) ? cur.retired_refs : [])
    .filter(function (r) { return !targetRefs.some(function (x) { return x.id === r.id; }); });
  let restoredBlocks = 0;
  if (newerRefs.length) {
    const rr = contextReplacements.restoreRetiredBlocks(newerRefs.map(function (r) { return { id: r.id }; }));
    restoredBlocks = rr && rr.restored ? rr.restored : 0;
    if (rr && rr.ok === false) {
      console.warn("[conversation-state] 回滚后旧块复原未完全成功：" + rr.error);
    }
  }

  const states = readStates();
  const st = states[sessionId] || {
    record_id: stateRecordId(sessionId),
    ops: [],
    cover: v.cover || null,
    seed_from_legacy: false,
  };
  // 指针模型（1003-31 C 方案）：回滚 = 只挪指针，**不截链**。
  // 比 target 新的版本留在链上标「已撤销」，随时可以再切回去（恢复，不调模型）。
  st.version = Number(v.version);
  st.flow = rollFlow;
  st.lu = rollLu;
  st.text = rollText;
  st.ops = v.ops || [];
  st.cover = v.cover || st.cover;
  st.retired_refs = targetRefs.slice();
  st.updated_at = nowIso();
  states[sessionId] = st;
  writeJson(STATE_FILE, states);

  console.log("[conversation-state] 已切到 " + sessionId + " → v" + target +
    "（指针移动，链上 " + list.length + " 版保留" +
    (restoredBlocks ? "，已复原 " + restoredBlocks + " 个旧块" : "") + "）");
  return getState(sessionId);
}

/* [位置:lib/conversation-state.js·splitFlowLedger] [手改全文拆成「流动层 + 来路账本」] [11-02 bug「状态机编辑以后来路重复」：编辑框预填的是全文（流动层 + 【来路】段 + 账本条目），保存时原来把整段都写进 st.flow，账本 st.lu 又单独留着，之后凡是按「flow + lu」重拼的地方（页面显示/注入/回滚/下一轮模型输入）来路就出现两份。这里按「【来路】独占一行」（与模型夹带来路的防御口径同一条正则，避免正文里引用这三个字被误切）拆开；没有这一行=整段是流动层，账本保持原样；有这一行=以编辑后的条目为准（用户手改账本是明确操作，不静默丢弃）] [注释时间 2026-11-02] */
function splitFlowLedger(text, curLu) {
  const t = String(text || "").trim();
  const m = t.match(/(^|\n)【来路】[ \t]*(\n|$)/);
  if (!m) return { flow: t, lu: Array.isArray(curLu) ? curLu.slice() : [] };
  const head = m.index + m[1].length;
  const lu = t.slice(head).split("\n").slice(1)
    .map(function (ln) { return ln.trim().replace(/^(?:-\s*|\d+[.、)\]]\s*|\[\#?\d+\]\s*)/, "").replace(/\s+/g, " ").trim(); })
    .filter(function (x) { return x && x !== "【来路】"; });
  return { flow: t.slice(0, head).trim(), lu: lu };
}

// 手动改当前状态正文（2026-10-04，用户要求「当前状态的内容加个编辑」）。
//
// 语义（用户拍板）：**直接覆盖当前版、保存即生效**，不产生新版本、不进版本链。
//   · 覆盖走 upsertSpanRecord 的同款写入（matched 只动首尾锚点、区间不变），
//     所以注入侧行为与模型生成的版本完全一致，msgid 精确定位不受影响；
//   · 版本链不动：版本号不变、版本数不变，并入记录里那一行仍指向同一个版本
//     （只是它的正文变了）。要回到模型写的原版，得在并入记录里翻更早的版本
//     ——但注意本函数**不把旧正文存进 history**，所以同版本内手改不可回退
//     （这是「直接覆盖」这个选择的固有代价，用户知情选定）。
//   · 候选状态若存在，一并丢弃：它是在旧正文之上算的，正文都改了它就不再对。
function editStateText(params) {
  const sessionId = String(params && params.session || "").trim();
  if (!sessionId) return { ok: false, error: "缺少 sessionId" };
  const text = String(params && params.text != null ? params.text : "").trim();
  if (!text) return { ok: false, error: "状态正文不能为空" };
  if (text.length > MAX_STATE_CHARS) {
    return { ok: false, error: "状态正文太长（" + text.length + " 字，上限 " + MAX_STATE_CHARS + "）" };
  }

  const cur = getState(sessionId);
  if (!cur.exists) return { ok: false, error: "这个会话还没有状态，没什么可改" };
  // 11-02：全文拆成流动层 + 账本，再按提交口径（流动层 + 【来路】段）重拼成注入全文，不让账本在 flow 里再留一份
  const parts = splitFlowLedger(text, cur.lu);
  if (!parts.flow) return { ok: false, error: "流动层正文不能为空（只剩来路没有状态正文）" };
  const fullText = parts.lu.length
    ? parts.flow + "\n\n【来路】\n" + formatLuLines(parts.lu) + "\n"
    : parts.flow;
  const cover = cur.cover;
  if (!cover || !cover.start_id || !cover.end_id) {
    return { ok: false, error: "当前状态的覆盖区间不完整，无法定位写入位置" };
  }

  const tl = contextReplacements.loadTimeline();
  const startMsg = tl.find(function (m) { return m && m.id && String(m.id) === String(cover.start_id); });
  const endMsg = tl.find(function (m) { return m && m.id && String(m.id) === String(cover.end_id); });
  if (!startMsg || !endMsg) {
    return { ok: false, error: "覆盖区间的锚点消息已不在时间线里（可能时间线被编辑过），无法改写" };
  }

  const coverLabel = (cover.label_start && cover.label_end) ? (cover.label_start + " ~ " + cover.label_end) : "";
  const spanRes = contextReplacements.upsertSpanRecord({
    recordId: stateRecordId(sessionId),
    session: sessionId,
    startMsg: startMsg,
    endMsg: endMsg,
    text: fullText,
    rangeLabel: coverLabel,
    source: "state",
  });
  if (!spanRes.ok) return { ok: false, error: spanRes.error || spanRes.message || "写入状态记录失败" };

  const states = readStates();
  const st = states[sessionId];
  // 1025：手动编辑的是全文（可能含账本）；11-02 改：flow 只存流动层、lu 存账本，text 是两者重拼的全文（原来 flow 存了全文，账本重复）
  st.text = fullText;
  st.flow = parts.flow;
  st.lu = parts.lu;
  // 手动改过的标记：页面上显示一下，免得以后忘了这一版是手改的
  st.manual_edit = { at: nowIso(), from_chars: String(cur.text || "").length, to_chars: fullText.length };
  st.updated_at = nowIso();
  writeJson(STATE_FILE, states);

  // 版本链里同一版也同步正文（指针没动、版本号没变，只是那版的文字变了）
  const versions = readVersions();
  const list = versions[sessionId] || [];
  const curVer = list.find(function (v) { return Number(v.version) === Number(st.version); });
  if (curVer) {
    curVer.text = fullText;
    curVer.flow = parts.flow;
    curVer.lu = parts.lu;
    curVer.manual_edit = { at: st.manual_edit.at };
    versions[sessionId] = list;
    writeJson(VERSIONS_FILE, versions);
  }

  // 旧正文之上算的候选已不适用，丢掉免得误导
  try { clearCandidate(sessionId); } catch (e) { /* 清不掉不影响正文生效 */ }

  console.log("[conversation-state] 手动改写状态正文 " + sessionId + " → v" + st.version +
    "（" + String(cur.text || "").length + " → " + fullText.length + " 字，覆盖区间不变）");
  return getState(sessionId);
}

function undoLastMerge(params) {
  const sessionId = String(params && params.session || "").trim();
  if (!sessionId) return { ok: false, error: "缺少 sessionId" };
  // 撤销后旧候选一定不再适用（它是在被撤销的那版之上算出来的），一并清掉
  try { clearCandidate(sessionId); } catch (e) { /* 清不掉不影响撤销 */ }
  const list = readVersions()[sessionId] || [];
  if (!list.length) return { ok: false, error: "没有可撤销的并入" };

  const cur = getState(sessionId);
  // list 是 unshift 的，越靠前越新；current 后面那一项就是「比当前旧一版」
  const idx = list.findIndex(function (x) { return Number(x.version) === Number(cur.version); });
  const previous = idx >= 0 ? list[idx + 1] : null;

  // 没有更早的版本 → 状态指针清空、原文全部回到未覆盖区。
  // 指针模型（1003-32）：**版本链保留**，全部标「已撤销·可恢复」——
  // 撤销第一版 ≠ 丢失，并入记录里点两下就能原样恢复（不调模型）。
  // 此前这里连链一起删，用户撤销后并入记录直接变空（1003-32 实测反馈）。
  if (!previous) {
    const states = readStates();
    const st0 = states[sessionId];
    // 旧块全部复原（2026-10-04）：状态记录被整条移除后，那段原文要回来，
    // 被退役的旧块摘要也必须重新生效——否则「撤销」把两边一起弄没了。
    let restoredBlocks = 0;
    if (st0 && Array.isArray(st0.retired_refs) && st0.retired_refs.length) {
      const rr = contextReplacements.restoreRetiredBlocks(st0.retired_refs.map(function (r) { return { id: r.id }; }));
      restoredBlocks = rr && rr.restored ? rr.restored : 0;
      if (rr && rr.ok === false) console.warn("[conversation-state] 撤销时旧块复原未完全成功：" + rr.error);
    }
    delete states[sessionId];
    writeJson(STATE_FILE, states);
    const rm = contextReplacements.removeReplacement(stateRecordId(sessionId));
    logEntry({
      label: "状态撤销 · " + sessionId.slice(-12),
      session: sessionId,
      status: "success",
      message: "已撤销整条状态（原文全部回到未覆盖区" +
        (restoredBlocks ? "，已复原 " + restoredBlocks + " 个旧块" : "") +
        "；版本链保留，可在并入记录里恢复）",
    });
    console.log("[conversation-state] 已撤销 " + sessionId + " 的最后一次并入（指针清空，链保留 " + list.length + " 版，rm=" + (rm && rm.ok) +
      (restoredBlocks ? "，复原旧块 " + restoredBlocks : "") + "）");
    return { ok: true, removedAll: true, session: sessionId, restoredBlocks: restoredBlocks };
  }

  const r = rollback({ session: sessionId, version: previous.version });
  if (!r.ok) { logEntry({ label: "状态撤销 · " + sessionId.slice(-12), session: sessionId, status: "error", message: "撤销失败：" + (r.error || "?") }); return r; }
  logEntry({ label: "状态撤销 · " + sessionId.slice(-12), session: sessionId, status: "success", message: "已切回 v" + previous.version + "（v" + cur.version + " 标记为已撤销，链上可随时恢复）" });
  return { ok: true, removedAll: false, rolled_to: previous.version, state: r };
}

/* [位置:lib/conversation-state.js·updateStateDirect] [跨客户端直写状态机新版本] [跨客户端传入最新流动层正文与可选 lu_add/lu_insert/lu_update，按 1-based 顺序序号维护来路账本（修改→按序号插队→末尾追加），自动递增版本号写入版本链，并将覆盖范围延展至该会话当前最新可压缩消息，清理旧候选] [注释时间 2026-11-24] */
function updateStateDirect(params) {
  const sessionId = String(params && params.session || "").trim();
  if (!sessionId) return { ok: false, error: "缺少 session_id" };
  const rawState = String(params && params.state != null ? params.state : "").trim();
  if (!rawState) return { ok: false, error: "state 不能为空" };
  if (rawState.length > MAX_STATE_CHARS) {
    return { ok: false, error: "状态正文太长（" + rawState.length + " 字，上限 " + MAX_STATE_CHARS + "）" };
  }

  const cleanLuLine = function (x) {
    return String(x == null ? "" : x)
      .trim()
      .replace(/^(?:-\s*|\d+[.、)\]]\s*|\[\#?\d+\]\s*)/, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const cur = getState(sessionId);
  const prevVersion = cur.exists ? Number(cur.version || 0) : 0;
  const parts = splitFlowLedger(rawState, []);
  const text = parts.flow || rawState;
  const newLu = (cur.exists && Array.isArray(cur.lu)) ? cur.lu.slice() : [];

  // 1) 按序号更新已有来路（1-based index，基于调用前列表序号）
  let updatedLu = 0;
  const rawUpdates = Array.isArray(params && params.lu_update) ? params.lu_update : [];
  rawUpdates.forEach(function (u) {
    if (!u || typeof u !== "object") return;
    const idx = Number(u.index);
    const txt = cleanLuLine(u.text);
    if (!Number.isInteger(idx) || idx < 1 || idx > newLu.length || !txt) return;
    if (newLu[idx - 1] !== txt) {
      newLu[idx - 1] = txt;
      updatedLu++;
    }
  });

  // 2) 按序号插队补录（after=0 插在最前，after=N 插在第 N 条后面；按 after 倒序分批插入，同位置保持传入顺序）
  let insertedLu = 0;
  const rawInserts = Array.isArray(params && params.lu_insert) ? params.lu_insert : [];
  if (rawInserts.length) {
    const seenCur = new Set(newLu);
    const byPos = new Map();
    rawInserts.forEach(function (ins) {
      if (!ins || typeof ins !== "object") return;
      const txt = cleanLuLine(ins.text);
      if (!txt || seenCur.has(txt)) return;
      let pos = Number(ins.after);
      if (!Number.isFinite(pos)) pos = newLu.length;
      pos = Math.max(0, Math.min(newLu.length, Math.floor(pos)));
      if (!byPos.has(pos)) byPos.set(pos, []);
      byPos.get(pos).push(txt);
      seenCur.add(txt);
    });
    const positions = Array.from(byPos.keys()).sort(function (a, b) { return b - a; });
    positions.forEach(function (pos) {
      const batch = byPos.get(pos);
      newLu.splice.apply(newLu, [pos, 0].concat(batch));
      insertedLu += batch.length;
    });
  }

  // 3) 末尾追加新来路（去重）
  const extraLu = Array.isArray(params && params.lu_add) ? params.lu_add : [];
  const luAdd = parts.lu.concat(extraLu).map(cleanLuLine).filter(Boolean);
  const seenLu = new Set(newLu);
  const addedLu = [];
  luAdd.forEach(function (item) {
    if (!seenLu.has(item)) {
      seenLu.add(item);
      addedLu.push(item);
      newLu.push(item);
    }
  });

  const fullText = newLu.length
    ? text + "\n\n【来路】\n" + formatLuLines(newLu) + "\n"
    : text;

  const chain = readVersions()[sessionId] || [];
  let maxVer = prevVersion;
  chain.forEach(function (v) { if (Number(v.version) > maxVer) maxVer = Number(v.version); });
  const nextVersion = maxVer + 1;
  const recordId = stateRecordId(sessionId);

  const items = contextReplacements.compressibleItems();
  const tl = contextReplacements.loadTimeline();
  let coverStartMsg = null;
  let endMsg = null;
  if (items.length) {
    endMsg = items[items.length - 1].msg;
    if (cur.exists && cur.cover && cur.cover.start_id) {
      coverStartMsg = tl.find(function (m) { return m && m.id && String(m.id) === String(cur.cover.start_id); }) || null;
    }
    if (!coverStartMsg) coverStartMsg = items[0].msg;
  }

  const fmtLabel = function (m) {
    const t = m && m.time ? String(m.time) : "";
    return t ? t.slice(0, 16).replace("T", " ") : "";
  };
  const labelStart = (cur.exists && cur.cover && cur.cover.label_start && coverStartMsg && cur.cover.start_id === String(coverStartMsg.id))
    ? cur.cover.label_start
    : fmtLabel(coverStartMsg);
  const labelEnd = fmtLabel(endMsg);
  const cover = (coverStartMsg && endMsg) ? {
    start_id: String(coverStartMsg.id),
    end_id: String(endMsg.id),
    label_start: labelStart,
    label_end: labelEnd,
  } : (cur.cover || null);
  const coverLabel = (cover && cover.label_start && cover.label_end) ? (cover.label_start + " ~ " + cover.label_end) : "";

  let prevRetiredRefs = (cur.retired_refs && Array.isArray(cur.retired_refs)) ? cur.retired_refs.slice() : [];
  if (cover && coverStartMsg && endMsg) {
    const retireRes = contextReplacements.retireOverlappingLegacyBlocks({
      session: sessionId,
      startId: cover.start_id,
      endId: cover.end_id,
      excludeId: recordId,
    });
    if (!retireRes.ok) return { ok: false, error: retireRes.error || "退役冲突旧块失败" };
    const retired = Array.isArray(retireRes.retired) ? retireRes.retired : [];
    if (retired.length) {
      retired.forEach(function (r) {
        prevRetiredRefs.push({ id: r.id, retired_at_version: nextVersion, at: nowIso() });
      });
    }
    const spanRes = contextReplacements.upsertSpanRecord({
      recordId: recordId,
      session: sessionId,
      startMsg: coverStartMsg,
      endMsg: endMsg,
      text: fullText,
      rangeLabel: coverLabel,
      count: items.length,
      source: "state",
    });
    if (!spanRes.ok) {
      if (retired.length) contextReplacements.restoreRetiredBlocks(retired);
      return { ok: false, error: spanRes.error || spanRes.message || "写入状态记录失败" };
    }
  }

  const states = readStates();
  states[sessionId] = {
    version: nextVersion,
    record_id: recordId,
    flow: text,
    lu: newLu,
    text: fullText,
    ops: [],
    cover: cover,
    updated_at: nowIso(),
    seed_from_legacy: false,
    retired_refs: prevRetiredRefs,
  };
  writeJson(STATE_FILE, states);

  const versions = readVersions();
  const list = versions[sessionId] || [];
  list.unshift({
    version: nextVersion,
    flow: text,
    lu: newLu,
    text: fullText,
    ops: [],
    cover: cover,
    at: nowIso(),
    source: "mcp-update",
    retired_refs: prevRetiredRefs.slice(),
  });
  versions[sessionId] = list;
  writeJson(VERSIONS_FILE, versions);

  try { clearCandidate(sessionId); } catch (e) {}
  logEntry({
    label: "状态直写 · " + sessionId.slice(-12),
    session: sessionId,
    status: "success",
    message: "跨客户端更新状态 → v" + nextVersion + "（状态 " + fullText.length + " 字，新增来路 " + addedLu.length + " 条，插队 " + insertedLu + " 条，修改 " + updatedLu + " 条）",
  });
  const latest = getState(sessionId);
  return Object.assign({}, latest, {
    prev_version: prevVersion,
    chars: fullText.length,
    lu_total: newLu.length,
    lu_added: addedLu.length,
    lu_inserted: insertedLu,
    lu_updated: updatedLu,
  });
}

module.exports = {
  rangeCharsOf,
  parseResponse,
  splitFlowLedger,
  setLogFn,
  setCancelFn,
  getState,
  getInheritedState,
  getVersionText,
  previewMerge,
  commitMerge,
  updateStateDirect,
  rollback,
  undoLastMerge,
  // 手动改当前状态正文（2026-10-04）：直接覆盖当前版、保存即生效、不进版本链
  editStateText,
  // 候选状态（2026-10-04）：preview 算出来待用户确认的那一版，落盘保存、刷新不丢
  getCandidate,
  clearCandidate,
  CANDIDATE_FILE,
  loadPromptConfig,
  listPrompts,
  savePromptRec,
  deletePromptRec,
  savePromptConfig,
  resetPromptConfig,
  DEFAULT_SYSTEM,
  DEFAULT_USER_TEMPLATE,
};