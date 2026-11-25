'use strict';
// 子智能体运行器（2026-10-25，需求单 26 重设计版）：主 AI 派杂活给独立小会话，
// 子会话只带「云服务器 + DeepSeek搜索」两套工具，干完按任务里约定的 <标签> 输出报告；
// 主 AI 用 subagent 工具（8771 转调 /internal/subagent/*）取报告 / 按行号查过程。
//
// 10-25 定稿口径：
//  - run 只传 task＝新建；传 session_id＋task＝复用（同一个子 AI 带着上下文接着干）
//  - report 按 session_id＋tag 取最新一份报告；没找到＝「暂无，还未完成」；中断＝提示会话中断
//  - 标签名随意（乱数字也行），同一会话内不重复即可，只为提取特定内容
//  - log 行号必填，且行号在写入时自带（logs 每条带自增 no）
//  - 模型未配 → 报错引导去配置页（用途模型 → 子智能体），不回退全局默认（防误用贵模型）
//  - 跑完自动进「已归档」；会话名自动加「子进程 · 」前缀
//  - 不用唤醒通道——主 AI 自己来查；「不可自行重启网关」约束写在 8771 工具说明里（就这一处）
//  - 状态全落盘 data/subagent/<sid>.json；网关重启后 json 还是 running 但不在内存 → interrupted（惰性判定）
//
// 子会话人设走 session-prompts → prompt-backups（带 marker:"subagent"），否则网关会把 system 换成
// 全局人设（10-23 订阅测试事故的根源）。子会话不建上下文快照，工具清单每次实时算。
// 2026-10-26 修缮（代码梳理落地）：任务全文落时间线｜只配 model 未绑 provider 显式拦截｜轮次打满记 failed｜
//   listTools 挪进 _run（start 零 await：8771 转调不再超时产生孤儿任务、并发检查无竞态窗口）｜prompt-backups 损坏中止派活
// 2026-10-26 批3（前端配套）：+stop（前端终止按钮，stopped 单独终态）+detail（过程抽屉只读数据源）；server.js 出 /admin/subagent-{detail,stop} 两口
// 2026-10-27（产品确定）：人设共享化——「没有人设」机制上不存在（session-prompts 不指就回退全局人设），所有子会话共用
//   一条「子智能体 · 全栈工程师」备份；任务全文只走时间线 user 消息；工具开关（mcp_on/mcp_exact）在 _run 里补写成一致
// 2026-10-27（产品确定，工具搬家）：subagent 工具从 8771「工具集合」搬到「云服务器」（yun-mcp-v2/mcp_server.py），
//   并发上限 2 -> 3（说明写「最多三个并行」）；子会话加 SUBAGENT_BLOCKED_TOOLS 挡套娃（subagent 搬进云服务器后
//   子会话白名单会顺带拿到它）；start 的 hint 补一句「子模型慢，可定 wake 回来查」。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadConfig, McpServerClient } = require("../mcp/mcp-client");

const DATA_DIR = path.join(__dirname, "..", "data");
const SUBAGENT_DIR = path.join(DATA_DIR, "subagent");
// 时间线目录：<项目根>/timeline_data/（不在 data/ 下）——照 wake-scheduler 同一来源，别手拼
const { timelineDirOf } = require("./timeline-dir");
const SESSION_ARCHIVE_FILE = path.join(DATA_DIR, "session-archive.json");

const SID_PREFIX = "s_sub_";
// 子会话工具白名单：云服务器 + DeepSeek搜索（10-25：两小套）。按 id 或名字匹配，改配置文件不用动这里。
function isSubagentToolServer(s) {
  const key = (s.name || "") + " " + (s.id || "") + " " + (s.url || "");
  return s.id === "15de5875-6caa-4f5f-8aa9-19beba9a02b9" || /云服务器/.test(key)
    || s.id === "ds-mcp-local" || /DeepSeek搜索/.test(key);
}

// 子会话禁用工具（2026-10-27）：subagent 从 8771「工具集合」搬进云服务器后，子会话白名单里会顺带拿到它，
// 不挡就会套娃（子智能体再派子智能体）。两道口都挡：getSubagentClients 给客户端加 blockTools（首轮 listTools 生效），
// _run 里拉清单 / 写 mcp_on 时再过滤一遍（避免工具 key 流进会话开关）。
const SUBAGENT_BLOCKED_TOOLS = ["subagent"];

// 2026-10-27（产品确定）：「把那个限制去掉吧，反正我盯着」——轮数上限取消，0 = 不限。
// 原来的 40 轮是硬伤：打满那轮 mcp-tool-loop 仍传 tools 但把 tool_choice 强制成 "none"
// （2026-10-27 实证 s_sub_c7881f3c），模型想调工具却被禁，就把调用写成内部文本标记
// <｜｜DSML｜｜calls>…，网关当正文收下——状态 done、正文全是标签、没有 report，白跑 40 轮。
// 兜底改由三件东西承担：绝对超时 30 分钟、前端终止按钮、模型不调工具时自然收尾。
const MAX_ROUNDS = 0;
const ABS_TIMEOUT_MS = 30 * 60 * 1000;    // 30 分钟绝对超时
const MAX_CONCURRENT = Infinity;          // 并发上限取消（2026-10-27：「并发上限去掉吧」）；原 2 -> 3 -> 不限。超时（30 分钟）与终止按钮仍在
const SUMMARY_MAX = 20;                   // 会话名里任务摘要截断字数
// 轮次打满识别锚（2026-10-26）：streamToolLoop 轮数耗尽不抛错，只在正文尾部追加固定文案；
// 该前缀同时是 mcp/mcp-tool-loop.js roundCapNotice() 与 workspace/phone-talk.js「继续」按钮的识别锚，改措辞三处同步
const ROUND_CAP_ANCHOR = "（工具调用轮次已达上限";

const _running = new Map();               // sid -> {ac, startedAt, timer}（进程内存；重启即空，配合 json 惰性判定中断）
const _stopped = new Set();               // 收过终止信号的 sid（2026-10-26 批3：_run 的 catch 里认领，记 stopped 终态，不跟超时/失败混）
// 抽屉只看当前阶段与工具名；内存即可，不写记录文件，也不把思考、参数或结果另开一条数据通道。
/* [位置:subagent-runner.js·_live] [子会话实时过程] [10-27 批1：打开子会话抽屉要和普通会话一样流式看；引擎把思考/正文/工具节点实时 push 进这里的数组（内存，收尾由 _run 落时间线并清掉），detail 运行中把它当最后一条 assistant 消息给前端；rev 每个引擎事件 +1，前端带 since 没变就不回全文] [注释时间 2026-10-27] */
const _live = new Map();                  // sid -> {tl:[], rev, started}
const _activity = new Map();              // sid -> {phase, tool, updated_at}
function setActivity(sid, phase, tool) {
  const name = String(tool || "");
  const prev = _activity.get(sid);
  if (prev && prev.phase === phase && prev.tool === name) return;
  _activity.set(sid, { phase: phase, tool: name, updated_at: new Date().toISOString() });
}
function activityOf(sid) {
  const a = _activity.get(sid);
  return a ? { phase: a.phase, tool: a.tool || "", updated_at: a.updated_at || "" } : null;
}

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return fallback; }
}
function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}
function recordPath(sid) { return path.join(SUBAGENT_DIR, sid + ".json"); }
function randomId(prefix) { return prefix + crypto.randomBytes(4).toString("hex"); }
function taskSummary(task) { return String(task || "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX) || "任务"; }

function createRunner(deps) {
  const {
    baseDir,
    readEnvValue,
    appendMessages,          // server.js 注入：落子会话时间线
    streamToolLoop,          // mcp/mcp-tool-loop 注入：执行引擎（与对话/唤醒同一条实现）
    normalizeContentToText
  } = deps;

  // ---- 记录（写入自带行号：logs 每条 no 自增，10-25 拍板；2026-10-27 晚改口径：logs=主 AI 的信息通道——
  //        AI 正文全文（kind=say）+ 每次工具调用名与完整参数（kind=tool，出错附错误信息）实时写入，长文约1800字切块；
  //        工具结果与思考不写（产品确定），结果看抽屉/时间线）----
  function newRecord(sid, task, parent, model) {
    return {
      version: 1,
      subagent_id: sid,
      parent_session: parent || null,
      task: task,
      model: model || "",
      status: "running",
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
      rounds: 0,
      total_logs: 0,
      error: null,
      logs: []
    };
  }
  function appendLog(rec, kind, text) {
    rec.logs = rec.logs || [];
    const no = (rec.logs.length ? rec.logs[rec.logs.length - 1].no : 0) + 1;
    rec.logs.push({ no, time: new Date().toISOString(), kind: String(kind || "info"), text: String(text || "").slice(0, 2000) });
    rec.total_logs = no;
    writeJsonAtomic(recordPath(rec.subagent_id), rec);
  }
  /* [位置:lib/subagent-runner.js·appendLogBlocks] [长内容按约1800字切块写log] [10-27 晚定稿：logs 是主 AI 的信息通道，正文/工具参数不截断——长文切块成多条，块首标注（第x/y块，第a-b字，共N字），AI 按行号取块即可拼出全文或跳到想要的段落（查询侧 start_line/end_line 原样可用，零改动）；块+标注控制在 appendLog 的 2000 字截断之内] [注释时间 2026-10-27] */
  function appendLogBlocks(rec, kind, text) {
    const s = String(text || "");
    const BLOCK = 1800;
    if (s.length <= BLOCK) { appendLog(rec, kind, s); return; }
    const n = Math.ceil(s.length / BLOCK);
    for (let i = 0; i < n; i++) {
      const seg = s.slice(i * BLOCK, (i + 1) * BLOCK);
      appendLog(rec, kind, "（第" + (i + 1) + "/" + n + "块，第" + (i * BLOCK) + "-" + (i * BLOCK + seg.length - 1) + "字，共" + s.length + "字）" + seg);
    }
  }

  // ---- 子会话时间线（读：给模型组装 messages / report 扫标签）----
  function timelinePath(sid) { return path.join(timelineDirOf(baseDir), "enhanced_messages_" + sid + ".json"); }
  function readTimeline(sid) {
    const arr = readJsonSafe(timelinePath(sid), []);
    return Array.isArray(arr) ? arr : [];
  }
  function timelineToMessages(sid) {
    const out = [];
    for (const m of readTimeline(sid)) {
      if (!m || m.hidden) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      const c = typeof m.content === "string" ? m.content : "";
      if (!c.trim()) continue;
      out.push({ role: m.role, content: c });
    }
    return out;
  }

  // ---- 倒序找最新一份 <tag>…</tag> 报告 ----
  function findReportInTimeline(sid, tag) {
    const t = String(tag || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!t) return null;
    const re = new RegExp("<\\s*" + t + "\\s*>([\\s\\S]*?)<\\s*/\\s*" + t + "\\s*>", "i");
    const arr = readTimeline(sid);
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (!m || m.hidden || m.role !== "assistant") continue;
      const c = typeof m.content === "string" ? m.content : "";
      const mm = c.match(re);
      if (mm && mm[1] && mm[1].trim()) return mm[1].trim();
    }
    return null;
  }

  // ---- 新建子会话的四件套（session_cfg / 共享人设 / session-prompts / session-names）----
  // 共享人设（2026-10-27 产品确定）：「人设无」机制上做不到——session-prompts 不指过去网关就回退全局人设（10-23 事故路径），
  // 退而取用户指定的次选：所有子会话共用一条「子智能体 · 全栈工程师」备份（marker:"subagent"，前端人设页照旧隐藏）。
  // 任务全文走时间线 user 消息（appendTaskMessage），不进人设；prompt-backups 不再每个任务涨一条。
  const SUB_PERSONA_ID = "pb_subpersona_eng";
  const SUB_PERSONA_NAME = "子智能体 · 全栈工程师";
  const SUB_PERSONA_SRC_ID = "pb_mvhu8s34a5g6oz";   // 用户指定的内容来源（全栈工程师提示词）；按 id 找，丢了再按名字兜底
  function subPersonaConventions() {
    return [
      "",
      "---",
      "",
      "# 子进程工作约定（主会话派活时读这段）",
      "",
      "你是被主会话派来干活的子进程：任务全文在对话的 user 消息里（不在这份人设里），只有云服务器和联网搜索两类工具。",
      "1. 完成任务（或阶段性完成）后，在回复最后用标签把报告包起来输出，默认 <report></report>；任务里指定了别的标签就按指定的（同一会话内标签不重复）。报告含：做了什么 / 执行了哪些命令或改了哪些文件 / 结果 / 没做完的。",
      "2. 报告简洁、结论先行，不要把全部过程贴进报告。",
      "3. 没做完就如实写没做完，不要编结果。",
      "4. 不可自行重启网关（gateway）——你手里有云服务器命令工具，禁止执行重启网关的命令；需要重启时在报告里说明，由用户决定。"
    ].join("\n");
  }
  function ensureSubPersona() {
    const pbFile = path.join(DATA_DIR, "prompt-backups.json");
    const arr = readJsonSafe(pbFile, null);
    if (!Array.isArray(arr)) throw new Error("prompt-backups.json 缺失或不是数组，为防子会话人设失效已中止派活；先修复该文件再派");
    const hit = arr.find(function (b) { return b && b.id === SUB_PERSONA_ID; });
    if (hit && String(hit.content || "").trim()) return SUB_PERSONA_ID;   // 已存在且非空：直接复用，不每次重写
    // 需要新建（或修复空内容）：内容 = 全栈工程师提示词（用户指定来源）+ 子进程工作约定
    let src = arr.find(function (b) { return b && b.id === SUB_PERSONA_SRC_ID && String(b.content || "").trim(); });
    if (!src) src = arr.find(function (b) { return b && /全栈工程师/.test(String(b.name || "")) && String(b.content || "").trim(); }) || null;
    const content = (src ? String(src.content) : "你是一名干了很多年的全栈工程师，独立完成主会话交代的开发任务；先理解再动手、小步验证、不将就补丁。") + subPersonaConventions();
    if (hit) { hit.content = content; hit.name = SUB_PERSONA_NAME; hit.marker = "subagent"; hit.updated_at = new Date().toISOString(); }
    else arr.push({ id: SUB_PERSONA_ID, name: SUB_PERSONA_NAME, content: content, marker: "subagent", created_at: new Date().toISOString() });
    writeJsonAtomic(pbFile, arr);
    return SUB_PERSONA_ID;
  }
  function setupSubagentSession(sid, task) {
    // ⓪ 人设：共享一条（ensureSubPersona 内含 prompt-backups 健康检查，坏了抛错中止派活、一个文件都没写过）
    const personaId = ensureSubPersona();
    // ① session_cfg：关跨窗口注入（产品确定）；工具开关（mcp_on/mcp_exact）由 _run 拉到工具清单后补写成一致
    writeJsonAtomic(path.join(DATA_DIR, "session_cfg", sid + ".json"), { cross_inject_enabled: false });
    // ② session-prompts 指共享人设（否则网关换全局人设）
    const spFile = path.join(DATA_DIR, "session-prompts.json");
    const sp = readJsonSafe(spFile, {});
    if (sp && typeof sp === "object") { sp[sid] = personaId; writeJsonAtomic(spFile, sp); }
    // ③ 会话名（10-25：自动加「子进程 · 」前缀）
    const snFile = path.join(DATA_DIR, "session-names.json");
    const names = readJsonSafe(snFile, {});
    if (names && typeof names === "object") { names[sid] = "子进程 · " + taskSummary(task); writeJsonAtomic(snFile, names); }
  }

  // ---- 归档（注意：appendMessages 落盘会自动取消归档，所以归档必须在写回复之后做）----
  function archiveSession(sid) {
    const list = readJsonSafe(SESSION_ARCHIVE_FILE, []);
    if (Array.isArray(list) && list.indexOf(sid) < 0) { list.push(sid); writeJsonAtomic(SESSION_ARCHIVE_FILE, list); }
  }

  // 任务全文落子会话时间线（2026-10-26 补，设计单原文「时间线注入一条 user 消息」）：
  // 复用轮 timelineToMessages 才能看到历轮任务；网关重启中断后当轮任务不丢；将来前端抽屉也能展示任务。
  // 失败只记 log 不中断派活——messages 已在内存，本轮执行不受影响。
  function appendTaskMessage(sid, task, rec) {
    try { appendMessages(sid, [{ role: "user", content: task }], { silent: true }); }
    catch (e) { appendLog(rec, "error", "任务消息落时间线失败（本轮执行不受影响，但复用/抽屉会缺这段）: " + e.message); }
  }

  // ---- 工具客户端：两台（云服务器 + DeepSeek搜索）----
  function getSubagentClients() {
    const servers = loadConfig(path.join(baseDir, "config", "mcp-servers.json"));
    return (servers || []).filter(s => s && s.enabled !== false && isSubagentToolServer(s)).map(function (s) {
      // 2026-10-27：克隆一份配置再加 blockTools，不改全局 mcp-servers.json 里的原对象（主会话照旧有这个工具）
      const cfg = Object.assign({}, s);
      const block = Array.isArray(cfg.blockTools) ? cfg.blockTools.slice() : [];
      for (const t of SUBAGENT_BLOCKED_TOOLS) { if (block.indexOf(t) < 0) block.push(t); }
      cfg.blockTools = block;
      return new McpServerClient(cfg);
    });
  }

  // ---- 执行（后台跑；start 立即返回）----
  async function _run(sid, messages, ctx) {
    let rec = readJsonSafe(recordPath(sid), null);
    if (!rec) rec = newRecord(sid, "", null, ctx.model);   // 2026-10-27 晚补：记录文件缺失/损坏时兜底重建，别让 appendLog 裸解 null 把整轮炸成 "Cannot read properties of null"
    const ac = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(function () { try { ac.abort(); } catch (e) {} }, ABS_TIMEOUT_MS);
    _running.set(sid, { ac: ac, startedAt: startedAt });
    setActivity(sid, "preparing");
    let status = "done", errText = null, text = "", rounds = 0;
    // 2026-10-27：工具历史 / 交错时间线 / 思考链提到函数作用域——收尾落盘时要一起写进时间线
    let th = [], streamTimeline = [], reasoningText = "", liveRef = null;   // liveRef：实时时间线数组的引用，终止/失败时用它把已做的部分定稿落盘
    try {
      // 工具清单实时拉（2026-10-26 从 start 挪进来；单台失败只标注不整体中断）
      const toolNames = [];
      const clientTools = new Map();   // client.id -> [toolName]（2026-10-27：顺手把会话工具开关写成一致）
      for (const c of ctx.clients) {
        try {
          const tls = await c.listTools();
          // 2026-10-27：清单里剔掉 SUBAGENT_BLOCKED_TOOLS（防套娃），toolNames 与写进 mcp_on 的清单都不带它
          const names = (tls || []).map(function (t) { return t.name; })
            .filter(function (n) { return SUBAGENT_BLOCKED_TOOLS.indexOf(n) < 0; });
          clientTools.set(c.id, names); for (const t of names) toolNames.push(t);
        }
        catch (e) { toolNames.push(c.name + "(连接失败)"); }
      }
      // 2026-10-27 产品确定「工具：云服务器+搜索」：实际工具一直由 serverClients 白名单把守（只有这两台）；
      // 这里把 session_cfg 的开关也补写成一致（mcp_exact 关掉「新工具默认开」），前端若开这会话的 MCP 弹层，显示与实际对齐。失败不挡执行。
      try {
        const cfgPath = path.join(DATA_DIR, "session_cfg", sid + ".json");
        const cfg = readJsonSafe(cfgPath, null);
        if (cfg && typeof cfg === "object") {
          const on = [];
          for (const c of ctx.clients) { for (const t of (clientTools.get(c.id) || [])) on.push(c.id + "::" + t); }
          cfg.mcp_exact = true; cfg.mcp_on = on;
          writeJsonAtomic(cfgPath, cfg);
        }
      } catch (e) {}
      const toolDesc = toolNames.length ? toolNames.join(" / ") : "（没拉到工具——检查云服务器/搜索服务器是否启用）";
      appendLog(rec, "start", "开始执行：模型 " + ctx.model + "；工具：" + toolDesc);
      /* [位置:lib/subagent-runner.js·_run onLogEvent] [logs 实时记录 AI 发言与工具调用] [10-27 晚定稿口径：logs=主 AI 的信息通道（抽屉只是用户的旁观窗）——AI 说的每段正文（kind=say）、每次工具调用的名+完整参数（kind=tool，出错附错误信息）实时成条写入；工具结果与思考不写（结果不写、思考不用写入）。onEvent 抛错会被引擎当客户端断开中断循环，这里吞掉一切异常只告警] [注释时间 2026-10-27] */
      const onLogEvent = function (evt) {
        try {
          if (!evt) return;
          { const lv = _live.get(sid); if (lv) lv.rev++; }
          if (evt.type === "reasoning") {
            setActivity(sid, "thinking");
          } else if (evt.type === "text") {
            setActivity(sid, "writing");
            if (String(evt.text || "").trim()) appendLogBlocks(rec, "say", evt.text);
          } else if (evt.type === "tool_start") {
            setActivity(sid, "tool", evt.name);
          } else if (evt.type === "tool_end") {
            setActivity(sid, "thinking");
            let a = "";
            try { a = typeof evt.args === "string" ? evt.args : JSON.stringify(evt.args || {}); } catch (e) { a = String(evt.args || ""); }
            appendLogBlocks(rec, "tool", (evt.name || "?") + " 参数=" + a + (evt.error ? "\n出错：" + evt.error : ""));
          }
        } catch (e) { try { console.warn("[subagent] log 实时写入失败:", e && e.message); } catch (e2) {} }
      };
      setActivity(sid, "thinking");
      liveRef = [];
      _live.set(sid, { tl: liveRef, rev: 0, started: new Date().toISOString() });
      const r = await streamToolLoop({
        upstreamUrl: ctx.url,
        upstreamKey: ctx.key,
        upstreamHeaders: ctx.headers || null,
        model: ctx.model,
        messages: messages,
        serverClients: ctx.clients,
        reasoningEffort: ctx.thinkingEffort || null,   // 11-09：后台显式开思考（Claude/deepseek 供应商走这）
        extraBody: ctx.thinkingExtra || null,          // 智谱系 thinking.enabled 等对象透传
        sessionId: sid,
        maxToolRounds: MAX_ROUNDS > 0 ? MAX_ROUNDS : Infinity,
        onEvent: onLogEvent,
        snapshotV2: null,
        baseDir: baseDir,
        signal: ac.signal,
        liveTimeline: liveRef
      });
      setActivity(sid, "finalizing");
      text = (r && typeof r.text === "string") ? r.text : "";
      rounds = (r && r.rounds) || 0;
      /* [位置:lib/subagent-runner.js·_run DSML 泄漏兜底] [模型把工具调用写成文本时别当正文] [2026-10-27 实证：deepseek-flash 在 tool_choice="none" 那一轮把调用写成 <｜｜DSML｜｜calls> 标签，被当正文落盘，状态还记 done——抽屉里看着像「报错」、主会话拿不到任何结论。这里识别到标记就砍掉标记之后的内容，保留前面真写出的话，状态记 failed 并说清怎么办，不再伪装成功。2026-11-14 复盘：不扩 invoke/parameter——真实泄漏形态都带 DSML 前缀（vLLM #49117：漏的只是外层包裹，invoke 块本身仍以 DSML 开头），而子会话报告是工程讨论正文，扩了会误杀讨论这些标记的报告] [注释时间 2026-11-14 改] */
      let dsmlLeak = false;
      // 锚定标记特征整体（全角/半角竖线都容忍）；search 返回 < 的下标，slice 正好把残渣一起砍掉
      const _dsmlAt = text.search(/<[｜|]{1,3}\s*DSML/i);
      if (_dsmlAt >= 0) {
        dsmlLeak = true;
        // 砍掉尾部没写完的标签残渣（实测样本尾部会剩 <｜｜ 这种半截，全角竖线也要清）
        const keep = text.slice(0, _dsmlAt).replace(/[\s<（(｜|]+$/, "").trim();
        appendLog(rec, "error", "模型把工具调用写成了文本标记（DSML），第 " + _dsmlAt + " 字之后的内容已丢弃" + (keep ? "，保留前面 " + keep.length + " 字" : "，前面也没有有效正文"));
        text = keep;
      }
      th = (r && r.toolHistory) || [];
      streamTimeline = (r && Array.isArray(r.streamTimeline)) ? r.streamTimeline : [];
      /* [位置:lib/subagent-runner.js·DSML 时间线同步截断] [正文被砍但时间线没砍 → content ≠ timeline → 前端退化] [DSML 泄漏时把所有 text 节点替换成截断后的正文（只留第一个），reasoning/tool 节点不动] [注释时间 2026-10-28] */
      if (dsmlLeak && streamTimeline.length) {
        let _firstText = true;
        streamTimeline = streamTimeline.map(function(n) {
          if (n && n.type === "text") {
            if (_firstText) { _firstText = false; return { type: "text", text: text }; }
            return null;
          }
          return n;
        }).filter(Boolean);
      }
      reasoningText = (r && typeof r.reasoning === "string") ? r.reasoning : "";
      // 2026-10-27 晚：正文与工具调用已由 onLogEvent 实时写入 logs（th 保留给收尾落时间线的 tools 字段），不再在这里批量补写工具记录
      if (dsmlLeak) {
        status = "failed";
        errText = "模型把工具调用写成了文本标记（DSML），本轮没产出报告；已做的部分在时间线里，可用同一 session_id 复用续跑（提示它正常调工具、并在轮次用尽前出报告）";
      } else if (MAX_ROUNDS > 0 && text.indexOf(ROUND_CAP_ANCHOR) >= 0) {
        // 2026-10-26：轮次打满原先被当 done（正文非空），report 查不到标签时会误导主 AI 去核对标签名；
        // 现在记 failed 并在 error 里说清，正文仍落时间线（保留已做的部分，可复用续活）
        // 2026-10-27 晚补：加 MAX_ROUNDS > 0 前置——不限轮数（0）时永远不存在「打满」，正文引用了引擎源码文案
        // （实证 s_sub_03bcc86e：报告分析 roundCapNotice 机制时原样引用了这句）会被误判成 failed，报告白跑
        status = "failed";
        errText = "工具调用轮次打满（" + MAX_ROUNDS + " 轮）还没出最终报告；已做的部分在时间线里，可用本会话 id 复用续活（把剩余部分拆小些）";   // MAX_ROUNDS=0（不限）时不会走到这里
      } else if (!text.trim()) { status = "failed"; errText = "模型没有返回正文"; }
    } catch (e) {
      if (_stopped.has(sid)) {
        // 2026-10-26 批3：被前端「终止」按钮主动叫停，单独记 stopped
        status = "stopped"; errText = "被主动终止（终止按钮）";
      } else if (ac.signal.aborted && (Date.now() - startedAt) >= (ABS_TIMEOUT_MS - 5000)) {
        status = "timeout"; errText = "超过 " + Math.round(ABS_TIMEOUT_MS / 60000) + " 分钟被强制结束";
      } else {
        status = "failed"; errText = e.message;
      }
    } finally {
      clearTimeout(timer);
      _running.delete(sid);
      _live.delete(sid);
      _activity.delete(sid);
      _stopped.delete(sid);
    }
    // 收尾（重读盘上最新记录， appendLog 期间可能已被工具历史更新过）
    rec = readJsonSafe(recordPath(sid), rec);
    if (!rec) rec = newRecord(sid, "", null, ctx.model);
    rec.status = status;
    if (rounds) rec.rounds = rounds;
    rec.ended_at = new Date().toISOString();
    if (errText) rec.error = errText;
    appendLog(rec, status === "done" ? "done" : status, status === "done" ? ("完成，正文 " + text.length + " 字，" + rounds + " 轮工具") : (errText || status));
    // 正文落时间线（report 扫的就是时间线里的 <标签>；带标签原文落，不剥）
    /* [位置:subagent-runner.js·_run 终止/失败也落已做的部分] [过程不能因为没出正文就消失] [10-27 真机：点终止后抽屉里的思考链、工具链全没了——原来只有 text 非空才落时间线，终止/超时/失败时 text 为空，批1 的实时内容在 finally 里随 _live 一起被清掉，什么都没留。现在没正文但实时时间线有内容时，把它定稿成一条 assistant 消息落盘（还在「运行中」的工具标成失败并写原因），抽屉就能照常看到做到哪一步] [注释时间 2026-10-27] */
    if (!text.trim() && liveRef && liveRef.length) {
      try {
        const nodes = JSON.parse(JSON.stringify(liveRef));
        let ctext = "", rtext = "";
        for (const n of nodes) {
          if (n && n.type === "text") ctext += String(n.text || "");
          else if (n && n.type === "reasoning") rtext += String(n.text || "");
          else if (n && n.type === "tool" && n.tool && n.tool.status === "running") { n.tool.status = "failed"; n.tool.error = n.tool.error || (status === "stopped" ? "被终止，这一步没有跑完" : "任务结束时这一步还没返回"); }
        }
        appendMessages(sid, [{
          role: "assistant", content: ctext, reasoning: rtext,
          tools: nodes.filter(function (n) { return n && n.type === "tool" && n.tool; }).map(function (n) { return { name: n.tool.name || "", args: n.tool.args || "", result: n.tool.result || "", error: n.tool.error || null, time: n.tool.time || "", status: n.tool.status === "failed" ? "error" : "done" }; }),
          segments: ctext.split(/\n\s*\n/).map(function (s2) { return s2.trim(); }).filter(Boolean),
          stream_timeline: nodes
        }], { silent: true });
      } catch (e) { appendLog(rec, "error", "未完成部分落时间线失败: " + e.message); }
    }
    if (text.trim()) {
      /* [位置:lib/subagent-runner.js·_run 回复落时间线] [子会话要是一条真会话] [10-27：抽屉里要看到跟点进会话一样的东西，所以按主会话口径落盘——content 全文（原来只落正文，没别的）、reasoning、tools、stream_timeline（思考/工具/正文交错，来自 streamToolLoop 返回值，工具带入参/结果/错误/状态）。工具过程从前只进内存，抽屉只能拿坏日志凑] [注释时间 2026-10-27] */
      try {
        appendMessages(sid, [{
          role: "assistant", content: text,
          reasoning: reasoningText || "",
          tools: th.map(function (t) { return { name: t.name || "", args: t.args || "", result: t.result || "", error: t.error || null, time: t.time || "", status: t.error ? "error" : "done" }; }),
          segments: String(text).split(/\n\s*\n/).map(function (s2) { return s2.trim(); }).filter(Boolean),
          stream_timeline: streamTimeline.length ? streamTimeline.slice() : undefined
        }], { silent: true });
      } catch (e) {
        appendLog(rec, "error", "时间线落盘失败: " + e.message);
      }
    }
    writeJsonAtomic(recordPath(sid), rec);
    /* [位置:subagent-runner.js·_run 收尾] [不再自动归档] [10-27 批1：子会话不再跑完自动归档，直接归在前端「子会话」组里，之后随时翻得到；archiveSession 函数保留不删] [注释时间 2026-10-27] */
  }

  // ---- 对外：派活 ----
  async function start(opts) {
    const task = String((opts && opts.task) || "").trim();
    const parentSession = String((opts && opts.parent_session) || "").trim() || null;
    const reuseSid = String((opts && opts.session_id) || "").trim();
    if (!task) return { ok: false, error: "缺少 task（任务提示词）" };

    if (_running.size >= MAX_CONCURRENT) {
      return { ok: false, error: "同时最多 " + MAX_CONCURRENT + " 个子任务在跑（当前 " + Array.from(_running.keys()).join("、") + "），等它跑完或先用 report/log 看进度" };
    }

    // 模型（未配 → 报错引导；配了但供应商不可用 → 同样报错，绝不悄悄回退全局 —— 10-25 拍板）
    const modelRouter = require("./model-router");
    /* [位置:subagent-runner.js·start model 覆盖] [主会话可指定本次任务模型] [11-14 随手记 #24：传了 model 先校验在启用供应商列表里，不在直接报错不派活；通过就跳过角色模型用它；不传走「用途模型→子智能体」的原检查链] [注释时间 2026-11-14] */
    const wantModel = String((opts && opts.model) || "").trim();
    let resolved;
    if (wantModel) {
      const hit = modelRouter.resolveModelByName(wantModel);
      if (!hit) {
        const names = [];
        modelRouter.listEnabledModels().forEach(function (p) { (p.models || []).forEach(function (m) { if (names.indexOf(m) < 0) names.push(m); }); });
        const avail = names.length ? names.slice(0, 30).join("、") + (names.length > 30 ? " …" : "") : "";
        return { ok: false, error: "模型「" + wantModel + "」不在启用列表里，没派活。" + (avail ? "可用的（部分）：" + avail + "；" : "当前没有启用中的供应商。") + "用 models 工具看完整清单。" };
      }
      resolved = hit;
    } else {
      const roleEntry = modelRouter.loadRoleModelsRaw().subagent;
      if (!roleEntry || (!roleEntry.provider_id && !roleEntry.model)) {
        return { ok: false, error: "子智能体还没配模型：去 配置页 → 用途模型 → 子智能体 选一个（建议便宜模型），配好再派。" };
      }
      if (!roleEntry.provider_id) {
        // 2026-10-26 堵口：只配 model 没绑 provider 时，resolveRoleModel 会跳过角色匹配悄悄落全局默认（配置里的模型名被无视）——
        // 正是「防误用贵模型」要拦的情形，显式报错引导，不静默回退
        return { ok: false, error: "子智能体只配了模型名、没绑供应商，直接派会悄悄跑在全局默认模型上（已拦截）：去 配置页 → 用途模型 → 子智能体 把供应商一起选好再派。" };
      }
      resolved = modelRouter.resolveRoleModel("subagent");
      if (!resolved.provider) return { ok: false, error: "子智能体配置的供应商不可用，去 配置页 → 用途模型 检查。" };
      if (resolved.provider.id !== roleEntry.provider_id) {
        return { ok: false, error: "子智能体配置的供应商已不可用（被回退到全局默认，已拦截），重新选一个供应商。" };
      }
      if (!resolved.model) return { ok: false, error: "子智能体没配模型名，去 配置页 → 用途模型 → 子智能体 补上。" };
    }
    const model = resolved.model || "";
    const upstreamTarget = require("./upstream-target").resolveTarget(resolved.provider, readEnvValue, model);
    if (!upstreamTarget.url || !upstreamTarget.key) {
      return { ok: false, error: "子智能体供应商缺地址或密钥，去 配置页 检查该供应商。" };
    }

    const clients = getSubagentClients();
    // 工具清单不在这里拉了（2026-10-26 挪进 _run）：start 全程零 await——
    // ① 8771 转调 60 秒不会再被 listTools 拖到超时（超时会产出 AI 拿不到 id 的孤儿任务）；
    // ② 并发上限检查到 _running.set 之间没有让出点，并行派活钻不了竞态空子

    let sid;
    let messages;
    if (reuseSid) {
      sid = reuseSid;
      if (sid.indexOf(SID_PREFIX) !== 0) return { ok: false, error: "session_id 不是子智能体会话（应以 " + SID_PREFIX + " 开头）" };
      if (!fs.existsSync(recordPath(sid))) return { ok: false, error: "找不到子智能体 " + sid + " 的记录" };
      if (_running.has(sid)) return { ok: false, error: "该子智能体上一轮还在跑，先用 report/log 看进度，别急" };
      messages = timelineToMessages(sid);
      if (!messages.length) return { ok: false, error: "该子智能体会话时间线是空的，复用不了（可能已被删）；重新新建一个吧" };
      messages.push({ role: "user", content: task });
      const rec = readJsonSafe(recordPath(sid), null);
      if (!rec) return { ok: false, error: "子智能体 " + sid + " 的记录文件存在但损坏（读不出 JSON），复用不了；新建一个吧" };   // 2026-10-27 晚补：原来裸解 rec，文件坏就 500
      rec.status = "running";
      rec.ended_at = null;
      rec.error = null;
      rec.model = model;
      rec.started_at = new Date().toISOString();
      writeJsonAtomic(recordPath(sid), rec);
      appendTaskMessage(sid, task, rec);   // 2026-10-26：本轮任务也落时间线，历轮任务齐全续活上下文才完整
      // 复用＝继续归档外的活：先出归档（跑完再归回去）
      try {
        const ar = readJsonSafe(SESSION_ARCHIVE_FILE, []);
        const i = ar.indexOf(sid);
        if (i >= 0) { ar.splice(i, 1); writeJsonAtomic(SESSION_ARCHIVE_FILE, ar); }
      } catch (e) {}
    } else {
      sid = randomId(SID_PREFIX);
      setupSubagentSession(sid, task);
      messages = [{ role: "user", content: task }];
      const recNew = newRecord(sid, task, parentSession, model);
      writeJsonAtomic(recordPath(sid), recNew);
      appendTaskMessage(sid, task, recNew);   // 2026-10-26：任务全文落时间线（设计单原文要求）
    }

    /* 11-04 Claude 加强缓存：子会话也是会话（产品确定：跟会话类型无关、跟模型有关），按它自己的 session_cfg 开关带 1h 头，与主聊天/唤醒同口径；开关默认关=5 分钟，行为不变 */
    if (upstreamTarget.headers && require("./upstream-target").isClaudeChat(resolved.provider) && require("./session-cfg").createSessionCfg(path.join(__dirname, "..")).readClaudeCache1h(sid)) {
      upstreamTarget.headers["x-claude-cache-ttl"] = "1h";
    }
    /* [位置:subagent-runner.js·ctx thinkingPatch] [子智能体显式开思考] [11-09：后台任务按供应商上锁——reasoning_effort 走引擎参数（Claude/deepseek 供应商），其余字段（如智谱 thinking.enabled）经 extraBody 透传（mcp-tool-loop 本轮新增）] [注释时间 2026-11-09] */
    const _tp = modelRouter.thinkingPatch(resolved.provider);
    const ctx = {
      url: upstreamTarget.url, key: upstreamTarget.key, headers: upstreamTarget.headers,
      model: model, clients: clients,
      thinkingEffort: _tp.reasoning_effort || null,
      thinkingExtra: _tp.reasoning_effort ? null : (Object.keys(_tp).length ? _tp : null)
    };
    _run(sid, messages, ctx).catch(function (e) {
      // 兜底：_run 自己漏出来的异常也要落终态，不能留一个永远 running 的假任务
      try {
        const rec = readJsonSafe(recordPath(sid), null);
        if (rec && rec.status === "running") {
          rec.status = "failed"; rec.error = e.message; rec.ended_at = new Date().toISOString();
          appendLog(rec, "failed", "执行器异常: " + e.message);
          writeJsonAtomic(recordPath(sid), rec);
        }
        _running.delete(sid);
        _activity.delete(sid);
      } catch (e2) {}
    });

    return {
      ok: true,
      subagent_id: sid,
      reused: !!reuseSid,
      model: model,
      status: "started",
      hint: "已开工。过一会儿用 action=report（session_id=" + sid + " + 任务里约定的标签）取报告；action=log 按行号看过程。子模型跑得慢，可以给自己定个 wake（比如 5 分钟后）到点回来查，不设也行。"
    };
  }

  // ---- 对外：取报告 ----
  function report(opts) {
    const sid = String((opts && opts.session_id) || "").trim();
    const tag = String((opts && opts.tag) || "").trim();
    if (!sid) return { status: "not_found", message: "缺少 session_id" };
    if (!tag) return { status: "not_found", message: "缺少 tag（要提取的报告标签名，不带尖括号）" };
    const rec = readJsonSafe(recordPath(sid), null);
    if (!rec) return { status: "not_found", message: "找不到子智能体 " + sid };
    const live = _running.has(sid);
    if (live) {
      const hit = findReportInTimeline(sid, tag);   // 复用场景下可能已有上一轮的报告
      if (hit) return { status: "running", report: hit, message: "任务还在跑，这是目前最新一份 " + tag + " 报告" };
      return { status: "running", message: "暂无，还未完成" };
    }
    if (rec.status === "running") {
      // json 是 running 但不在内存 → 网关重启过，任务死了
      return { status: "interrupted", message: "会话中断（网关重启，任务没有跑完）" };
    }
    const hit = findReportInTimeline(sid, tag);
    if (hit) {
      const out = { status: rec.status, report: hit };
      if (rec.status !== "done") out.message = "任务终态是 " + rec.status + (rec.error ? "（" + rec.error + "）" : "") + "，这是它留下的最新 " + tag + " 报告";
      return out;
    }
    if (rec.status === "done") return { status: "done", message: "任务已结束，但回复里没有找到 <" + tag + "> 报告——核对标签名是否和任务里约定的一致" };
    return { status: rec.status, message: rec.error || ("任务终态 " + rec.status + "，也没有留下 " + tag + " 报告") };
  }

  // ---- 对外：按行号查过程（行号必填——10-25 拍板）----
  function log(opts) {
    const sid = String((opts && opts.session_id) || "").trim();
    const startLine = Number(opts && opts.start_line);
    const rawEnd = (opts && opts.end_line);
    const endLine = (rawEnd === undefined || rawEnd === null || rawEnd === "") ? null : Number(rawEnd);
    if (!sid) return { ok: false, error: "缺少 session_id" };
    if (!Number.isFinite(startLine) || startLine < 1) return { ok: false, error: "start_line 必填（从 1 开始的记录序号）" };
    const rec = readJsonSafe(recordPath(sid), null);
    if (!rec) return { ok: false, error: "找不到子智能体 " + sid };
    const logs = rec.logs || [];
    const total = logs.length ? logs[logs.length - 1].no : 0;
    const end = (endLine && Number.isFinite(endLine)) ? Math.min(endLine, total) : Math.min(startLine + 40 - 1, total);
    if (startLine > total) return { ok: true, subagent_id: sid, total: total, range: [], items: [], has_more: false, status: statusOf(sid), hint: "start_line 超出范围，总共只有 " + total + " 条" };
    const items = logs.filter(function (l) { return l.no >= startLine && l.no <= end; });
    return {
      ok: true,
      subagent_id: sid,
      status: statusOf(sid),
      total: total,
      range: [startLine, end],
      items: items,
      has_more: end < total
    };
  }

  function statusOf(sid) {
    if (_running.has(sid)) return "running";
    const rec = readJsonSafe(recordPath(sid), null);
    if (!rec) return "not_found";
    return rec.status === "running" ? "interrupted" : rec.status;
  }

  // ---- 对外：主动终止（2026-10-26 批3，产品确定加终止按钮）：发 abort，_run 收尾统一落 stopped 终态 ----
  function stop(opts) {
    const sid = String((opts && opts.session_id) || "").trim();
    if (!sid) return { ok: false, error: "缺少 session_id" };
    if (!fs.existsSync(recordPath(sid))) return { ok: false, error: "找不到子智能体 " + sid };
    const ent = _running.get(sid);
    if (!ent || !ent.ac) return { ok: false, error: "该子任务不在运行中（当前 " + statusOf(sid) + "），不用终止" };
    _stopped.add(sid);
    setActivity(sid, "stopping");
    try { ent.ac.abort(); } catch (e) {}
    /* [位置:lib/subagent-runner.js·stop] [终止立刻可见] [10-27 问「停止按钮不是摆设吧」：abort 只掐得住上游流式请求，正在跑的 MCP 工具（run_command 之类）没有中断信号，要等它返回才真正收尾；原来这期间抽屉里一直显示「运行中」，看着像按钮没反应。这里先把终态写盘，前端刷新立刻能看到「已终止」；_run 收尾时按 _stopped 再确认一次，写的是同一个状态] [注释时间 2026-10-27] */
    try {
      const rec0 = readJsonSafe(recordPath(sid), null);
      if (rec0 && rec0.status === "running") {
        rec0.status = "stopped";
        rec0.error = "被主动终止（终止按钮）" + (ent.startedAt && (Date.now() - ent.startedAt) > 60000 ? "；正在执行中的工具要等它返回才真正收尾" : "");
        rec0.ended_at = new Date().toISOString();
        appendLog(rec0, "stopped", "收到终止信号" + (_running.has(sid) ? "（当前工具执行完即停）" : ""));
      }
    } catch (e) {}
    return { ok: true, session_id: sid, status: "stopping", message: "终止信号已发，正在收尾落盘" };
  }

  // ---- 对外：详情（2026-10-26 批3 前端过程抽屉数据源，只读）：记录精简 + 时间线（任务/回复） ----
  function detail(sid, opts) {
    sid = String(sid || "").trim();
    const rec = readJsonSafe(recordPath(sid), null);
    if (!rec) return { ok: false, error: "找不到子智能体 " + sid };
    const base = {
      ok: true, subagent_id: sid, status: statusOf(sid), running: _running.has(sid),
      task: rec.task || "", model: rec.model || "", rounds: rec.rounds || 0,
      created_at: rec.created_at || "", ended_at: rec.ended_at || "", error: rec.error || null,
      total_logs: rec.total_logs || (rec.logs || []).length,
      activity: activityOf(sid)
    };
    // running 时每 3 秒只取状态和当前动作；避免为一条状态反复读取、传输几十条完整工具结果。
    const lv = _live.get(sid);
    base.rev = lv ? lv.rev : 0;
    if (opts && opts.meta) { base.meta = true; return base; }
    // 运行中且前端带的 since 与当前版本一致：没变化，不回全文（抽屉 1.5 秒一轮，省流量）
    if (lv && opts && opts.since !== undefined && opts.since !== "" && Number(opts.since) === lv.rev) { base.same = true; return base; }
    const tl = [];
    for (const m of readTimeline(sid)) {
      if (!m || m.hidden) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      const c = typeof m.content === "string" ? m.content : "";
      // 2026-10-27：没正文但有思考/工具过程的 assistant 消息（终止/失败时定稿的那条）也要给前端，别按空内容跳过
      const hasProc = m.role === "assistant" && ((Array.isArray(m.stream_timeline) && m.stream_timeline.length) || m.reasoning || (Array.isArray(m.tools) && m.tools.length));
      if (!c.trim() && !hasProc) continue;
      /* [位置:lib/subagent-runner.js·detail] [过程抽屉的数据源给全] [10-27：正文原来 cut 在 4000 字（那条 12977 字的报告被砍掉三分之二，抽屉里看着像断了），reasoning / tools / stream_timeline 又没返回，前端没法按会话的样子渲染；现在按时间线原样给，前端复用聊天的思考行 / 工具行] [注释时间 2026-10-27] */
      tl.push({
        role: m.role, time: m.time || "", content: c,
        reasoning: m.reasoning || "",
        tools: Array.isArray(m.tools) ? m.tools : [],
        stream_timeline: Array.isArray(m.stream_timeline) ? m.stream_timeline : []
      });
    }
    /* logs 是主 AI 用 log 工具按行号查的信息通道，不喂浏览器；完整过程只走时间线。 */
    /* [位置:subagent-runner.js·detail 实时消息] [运行中把实时过程当最后一条 assistant 消息给前端] [抽屉按和已落盘消息同一套 stream_timeline 渲染，打开/关闭/再打开都拿到最新；live:true 让前端保留工具「运行中」状态] [注释时间 2026-10-27] */
    if (lv && lv.tl.length) {
      const nodes = JSON.parse(JSON.stringify(lv.tl));
      let content = "", reasoning = "";
      for (const n of nodes) {
        if (n && n.type === "text") content += String(n.text || "");
        else if (n && n.type === "reasoning") reasoning += String(n.text || "");
      }
      tl.push({ role: "assistant", time: lv.started, content: content, reasoning: reasoning, tools: [], stream_timeline: nodes, live: true });
    }
    base.timeline = tl;
    return base;
  }

  /* [位置:subagent-runner.js·statusAll] [所有子会话状态一次取] [10-27 批1：前端「子会话」组行要汇总 进行中/已完成 数；一口给全部，按文件 mtime 缓存，不是每次把几百 KB 记录全解析] [注释时间 2026-10-27] */
  const _stCache = new Map();   // sid -> {m, st}
  function statusAll() {
    const out = {};
    let files = [];
    try { files = fs.readdirSync(SUBAGENT_DIR); } catch (e) { return out; }
    for (const f of files) {
      if (!/^s_sub_[A-Za-z0-9_-]+\.json$/.test(f)) continue;
      const sid = f.slice(0, -5);
      if (_running.has(sid)) { out[sid] = "running"; continue; }
      try {
        const m = fs.statSync(path.join(SUBAGENT_DIR, f)).mtimeMs;
        const c = _stCache.get(sid);
        if (c && c.m === m) { out[sid] = c.st; continue; }
        const rec = readJsonSafe(path.join(SUBAGENT_DIR, f), null);
        const st = rec ? (rec.status === "running" ? "interrupted" : (rec.status || "unknown")) : "unknown";
        _stCache.set(sid, { m: m, st: st }); out[sid] = st;
      } catch (e) {}
    }
    return out;
  }

  return { start, report, log, statusOf, statusAll, _running, findReportInTimeline, stop, detail, ensureSubPersona };
}

module.exports = createRunner;
module.exports.SID_PREFIX = SID_PREFIX;
