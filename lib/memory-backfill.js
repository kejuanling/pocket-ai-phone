'use strict';
// 老数据重跑 = 记忆清洗器（2026-10-02 记忆系统改造 §8 第 5 项；2026-11-08 产品确定输入输出重构）
//
// 干什么：把记忆池里已有的活跃记忆逐批过一遍，让 LLM 清洗——去重复、修过时、补关键词、建议沉底。
// **不抽新记忆**（create 已砍：抽新的活归每天蒸馏）。产出**一律进待审**。
// 四动作（1110 产品确定改对象式输出 {"do":...}，字段名固定不靠位置；旧数组写法仍兼容解析；
// 「没改的不进待审」归一化比对——正文/关键词/分类都没变才算没改）：
//   keep        不用动（没被点名的 id 一律按 keep 处理）
//   tag         补关键词（se=1 开着参与检索没词的必须补；关键词不分类，靠「参与检索」开关决定是否参与召回）
//   update      正文过时/有误/啰嗦 → 给润色后的完整新正文（可带新关键词/新分类；进待审后排队门卫评分）
//   merge       两条以上同一件事的碎片 → 合成一条（内容=润色后的完整正文；进待审后排队门卫评分）
//   sink        明显过时/失效 → 待审卡，通过=旧条归档（active→archived，11-08 起不再写建议列表黑洞）
//   supplement  （兼容旧输出）信息不全 → 往里加，等同 update 处理
//
// 输入（一行一条，出处直接取记忆自带 provenance.quote，零检索）：
//   id｜kind｜se｜关键词｜正文
//   └ 当时原文：「……」（仅有 quote 的条目带这行）
// 工具（质量优先，11-08「高效不是快是质量」）：memory_search 查池内重复矛盾 / context_search 搜对话原文，
// 模型拿不准才要，上限 10 轮（原 4 轮）。预取证据（日期猜测+语义检索+bigram 过滤）整套砍掉——
// 实测一批 60 条要 60 次检索+最多 6 次模型调用+36KB 材料，21 分钟；材料里真正有用的只有记忆正文本身。
//
// 数据：data/memory_backfill_config.json   { enabled, time, batch_size, last_run_at, last_run_result }
//       data/memory_backfill_state.json    { done: { 记忆id: ISO时间 } }
//       data/memory_backfill_prompt.json   { system_prompt, user_prompt }
//       data/memory_sink_suggestions.json  已废弃（sink 改走待审；文件保留不删，历史不迁移）

const fs = require("fs-extra");
const path = require("path");
const { httpPostJson, readJsonSafe, pad2, makeNormalizeTime } = require("./http_json");
const timeUtils = require("../utils/time_utils");
const llmLog = require("./llm_log");
const { normalizeText } = require("../memory/judge-adapter");   // 「没改的不进待审」归一化比对，与检索/门卫同一口径

const DEFAULT_CONFIG = {
  enabled: false,     // 默认关：产出要人工审，别偷偷跑
  time: "04:00",      // 避开蒸馏（默认 03:00）与两块总结（默认 03:30）
  batch_size: 15,     // 每批多少条记忆（产出要人工审，宁小勿大）
  last_run_at: null,
  last_run_result: null,
};

const CHECK_MS = 30000;
const CATCHUP_WINDOW_MS = 30 * 60 * 1000;
const MODEL_ROLE = "backfill";             // 1003-11 拆分：老数据重跑独立配置（结构化 JSON 输出）
const LLM_TIMEOUT_MS = 600000;// 1005-19 修：全局 fetch 底层 undici 有不可配的 300s headersTimeout，长 prompt 会莫名 fetch failed；
// 且独立进程直连上游也常失败（gateway 内蒸馏早已改用直发，backfill 漏改）。此处与蒸馏同款：
// http/https 模块直发，超时自控（LLM_TIMEOUT_MS 600s 与 nginx 读超时对齐）。


// 工具回合（11-08 产品确定：原 SEARCH_ROUNDS=4 太少，「高效不是快是质量」→ 10 轮上限，防死循环不是防查证）
const TOOLS_MAX_ROUNDS = 10;
/* [位置:lib/memory-backfill.js·CHAR_BUDGET] [一批材料总字数封顶] [需求:11-10「60条限制去掉，改为限制总字数10000」→ 追加更正为 10 万；条数(batch_size)保留只作调节数，选材按排好的顺序拿到条数用完或字数到顶为止。字数按实际发给模型的材料算（行+当时原文），所见即所得] [注释时间 2026-11-10] */
const CHAR_BUDGET = 100000;
const TOOLS_MAX_PER_ROUND = 4;       // 每轮最多受理几个工具请求
const TOOL_MEM_RESULTS = 5;          // memory_search 每次返回条数上限
const TOOL_CTX_RESULTS = 8;          // context_search 每次返回条数上限
const TOOL_RESULT_CHAR = 3200;       // 单轮工具回灌总字符上限（防单轮撑爆上下文）
const ACTIONS = ["keep", "update", "supplement", "merge", "sink", "tag"];


const normalizeTime = makeNormalizeTime(DEFAULT_CONFIG.time);


module.exports = function createMemoryBackfill(deps) {
  const opts = deps || {};
  const baseDir = opts.baseDir || path.resolve(__dirname, "..");
  const CFG_FILE = path.join(baseDir, "data", "memory_backfill_config.json");
  const STATE_FILE = path.join(baseDir, "data", "memory_backfill_state.json");
  const PROMPT_FILE = path.join(baseDir, "data", "memory_backfill_prompt.json");
  const SINK_FILE = path.join(baseDir, "data", "memory_sink_suggestions.json");
  const PACK_FILE = path.join(baseDir, "data", "memory_backfill_last_pack.txt");  // 最近一批的材料（排障用，覆盖写）
  const RAW_FILE = path.join(baseDir, "data", "memory_backfill_last_raw.txt");    // 最近一批的模型原始输出（排障用，覆盖写）
  const POOL_FILE = opts.poolFile || path.join(baseDir, "data", "memory_v2.json");
  const TZ = timeUtils.resolveTimeZone();
  const addLog = typeof opts.addCompactionLog === "function" ? opts.addCompactionLog : null;
  const persistLog = typeof opts.persistCompactionLogs === "function" ? opts.persistCompactionLogs : null;
  const searchContext = typeof opts.searchContext === "function" ? opts.searchContext : null;
  const memorySearch = typeof opts.memorySearch === "function" ? opts.memorySearch : null;   // 11-08：池内检索（查重复矛盾），server.js 注入
  const callLLMInject = typeof opts.callLLM === "function" ? opts.callLLM : null;            // 测试注入：跳过真实 HTTP
  const admission = opts.admission || null;

  const state = { timer: null, running: false, lastError: null };

  function log(msg) {
    // 1003-25：改传对象（字符串入参会被 addCompactionLog 拆成字符索引垃圾）
    try { if (addLog) addLog({ action: "system", label: "后台任务", status: "success", message: "[memory-backfill] " + msg }); } catch (_) {}
    try { if (persistLog) persistLog(); } catch (_) {}
  }

  /* [位置:lib/memory-backfill.js·重跑运行日志] [名称:memory_backfill_runs 文件 + runsInfo] [需求:11-12「这两个。加记录日志之类的」——每批重跑（空跑/dryRun/成功/失败）记一条（触发方式/一句人话摘要/耗时/错误）落 data/memory_backfill_runs.json 留最近 50 条，GET /admin/memory-backfill/runs 给设置页「运行日志」子页轮询；同款先例 memory/memory-admission.js 的 memory_judge_runs.json。appendRun 静默失败，不影响重跑主链路] [注释时间 2026-11-12] */
  const RUNS_FILE = path.join(baseDir, "data", "memory_backfill_runs.json");
  function runId() { return "br_" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }
  function loadRuns() {
    try { const j = fs.readJsonSync(RUNS_FILE); return Array.isArray(j && j.runs) ? j.runs : []; } catch (_) { return []; }
  }
  function appendRun(rec) {
    try {
      const runs = loadRuns(); runs.push(rec);
      fs.ensureDirSync(path.dirname(RUNS_FILE));
      fs.writeJsonSync(RUNS_FILE, { runs: runs.slice(-50) });
    } catch (_) { /* 日志写失败不影响重跑主链路 */ }
  }
  function runsInfo() {
    return { running: !!state.running, kind: "batch", trigger: state.lastTrigger || null, started_at: state.startedAt || null, runs: loadRuns().slice().reverse() };
  }

  // ---------------- 配置 / 状态 ----------------
  function readConfig() {
    const c = readJsonSafe(CFG_FILE, {});
    return {
      enabled: c.enabled !== undefined ? !!c.enabled : DEFAULT_CONFIG.enabled,
      time: normalizeTime(c.time || DEFAULT_CONFIG.time),
      batch_size: Math.max(1, Number(c.batch_size) || DEFAULT_CONFIG.batch_size),   // 1110：60 条上限去掉（字数封顶替代），数值保留可调
      last_run_at: c.last_run_at || null,
      last_run_result: c.last_run_result || null,
    };
  }

  function saveConfig(patch) {
    const cur = readJsonSafe(CFG_FILE, {});
    const next = Object.assign({}, cur);
    if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
    if (patch.time !== undefined) next.time = normalizeTime(patch.time);
    if (patch.batch_size !== undefined) next.batch_size = Math.max(1, Number(patch.batch_size) || DEFAULT_CONFIG.batch_size);
    if (patch.last_run_at !== undefined) next.last_run_at = patch.last_run_at;
    if (patch.last_run_result !== undefined) next.last_run_result = patch.last_run_result;
    fs.writeJsonSync(CFG_FILE, next, { spaces: 2 });
    return readConfig();
  }

  function readState() { return readJsonSafe(STATE_FILE, { done: {} }); }
  function writeState(next) { fs.writeJsonSync(STATE_FILE, next, { spaces: 2 }); }

  function readPromptConfig() {
    const c = readJsonSafe(PROMPT_FILE, {});
    return { system_prompt: String(c.system_prompt || ""), user_prompt: String(c.user_prompt || "") };
  }

  function savePromptConfig(patch) {
    const cur = readJsonSafe(PROMPT_FILE, {});
    const next = Object.assign({}, cur);
    for (const k of ["system_prompt", "user_prompt"]) {
      if (patch[k] !== undefined) next[k] = patch[k] == null ? "" : String(patch[k]);
    }
    fs.writeJsonSync(PROMPT_FILE, next, { spaces: 2 });
    return readPromptConfig();
  }

  // ---------------- 提示词（外置，data/memory_backfill_prompt.json 可覆盖；下方为 11-08 清洗器版默认稿） ----------------
  function defaultSystemPrompt() {
    return [
      "你是记忆池的清洗器。输入是记忆池里已有的活跃记忆，一行一条，格式：",
      "id｜kind｜se｜关键词｜正文",
      "有的条目下面跟着「└ 当时原文：」——那是这条记忆记下时的对话原文（只有部分记忆带）。",
      "se=1 表示这条记忆开着「参与检索」：它必须有关键词，AI 聊天时靠词召回它；没有词就要你补（tag 动作）。",
      "任务：逐条清洗——去重复、修过时、修啰嗦、补关键词、建议沉底。**不抽新记忆**（新记忆由每天的蒸馏负责）。",
      "",
      /* [位置:lib/memory-backfill.js·defaultSystemPrompt 动作表] [对象式动作（1110 产品确定）] [字段名固定不靠位置，模型好操作；关键词/分类都可带，参与检索开关系统自己继承不让模型管] [注释时间 2026-11-10] */
      "动作（最终输出 JSON：{\"actions\":[...]}，每个动作一个对象，字段名固定）：",
      '{"do":"tag","id":"某id","words":["词1","词2"],"why":"一句话原因"}',
      '{"do":"update","id":"某id","text":"完整新正文","words":["词1"],"kind":"event","why":"一句话原因"}',
      '{"do":"merge","ids":["id1","id2"],"text":"合并后的完整正文","words":["词1","词2"],"kind":"event","why":"一句话原因"}',
      '{"do":"sink","id":"某id","why":"一句话原因"}',
      "字段说明：",
      "- do 必填：tag=补关键词，update=改正文，merge=合并碎片，sink=建议沉底。**没被任何动作提到的 id 一律按 keep 处理**，不用逐条列。",
      "- sink 只在明显时才用：明显过时、失效、一次性琐事、早被替代的旧规矩；**沉底近似删除**，值得记住的具体事不是 sink（那是 event，保留）。拿不准就 keep。",
      "- id：tag/update/sink 的目标；ids：merge 的目标，至少 2 个。动作里出现的 id 必须是本批输入里真实存在的 id。",
      "- text：update/merge 必填，**写完整新正文**，不是只写改动处；update 允许纯润色；merge 要润色成能独立读懂、独立引用的一条，不是干巴巴拼接（合完变成拼盘就是合错了）；带日期的原话/语录**不合并**——价值就在于它是当时说的那一句。",
      "- words：关键词，最多 3 个，可选。先想这条记忆未来会在什么对话里派上用场，再反推她可能说出的自然口语、简称、事件/人/地点/作品名；宁少而准，「生活」「情绪」「关系」这类泛化宽词不要。update 不写沿用旧词；merge 不写自动取被合并几条的旧词。",
      "- kind：分类 fact/rule/event，可选，不写沿用第一条旧条的；merge 的几条分类不一致时建议明确写。关键词不是 event 专属——是否参与召回由「参与检索」开关决定，开关系统按旧条自动继承，你不用管。",
      "- why 必填：原因写一句人话——人工审核时只有这一句能帮她看懂。",
      "",
      /* [位置:lib/memory-backfill.js·defaultSystemPrompt 铁律] [11-08 定稿：删「不确定就keep/要有依据/保留细节」三条——重跑产物全进待审人工兜底，模型侧不必再压保守；留一条：原因写人话，且审核的人是她不是他] [注释时间 2026-11-08] */
      "",
      "工具（拿不准时先查证再出结论，别猜）：",
      '输出 {"tools":[{"name":"memory_search","query":"..."},{"name":"context_search","query":"..."}]}：',
      "- memory_search：查记忆池里其他记忆——你只能看到本批，全局的重复/矛盾要靠它找。",
      "- context_search：按关键词搜对话原文。",
      "系统执行后把结果回给你。最多提 " + TOOLS_MAX_ROUNDS + " 轮，之后必须出结论；有具体疑问才提，别为查而查。",
      "",
      '最终结论（只输出 JSON）：{"actions":[["动作",...],...]}。整批都不用动就输出 {"actions":[["keep"]]}。',
    ].join("\n");
  }

  function defaultUserPrompt() {
    return [
      "本批共 ${MEM_COUNT} 条记忆（行格式与动作规则见 system）。",
      "",
      "${MATERIALS}",
      "",
      '逐条清洗。没被点名的 id 按 keep 处理。需要查证先输出 {"tools":[...]}；否则直接输出 {"actions":[...]}。',
    ].join("\n");
  }

  function buildPrompt(materials, memCount) {
    const pc = readPromptConfig();
    const system = (pc.system_prompt || "").trim() || defaultSystemPrompt();
    const tpl = (pc.user_prompt || "").trim() || defaultUserPrompt();
    const user = tpl
      .replace(/\$\{MEM_COUNT\}/g, String(memCount))
      .replace(/\$\{MATERIALS\}/g, materials);
    return { system, user };
  }

  // ---------------- 选材 ----------------
  /* [位置:lib/memory-backfill.js·selectRows] [无词候选插队] [需求:11-08：开着「参与检索」但没有关键词的记忆，重跑时排最前面先补词（模型 label 会给 triggers，待审通过后自动参与 AI 检索）；其余照旧按创建时间从老到新] [注释时间 2026-11-08] */
  const { searchEnabled } = require("../memory/memory-v2");   // 参与检索开关统一口径
  function selectRows(limit, charBudget) {
    let all = [];
    try { all = fs.readJsonSync(POOL_FILE); } catch (e) { all = []; }
    if (!Array.isArray(all)) all = [];
    const st = readState();
    const done = st.done || {};
    const rows = all
      .filter(function (e) { return e && e.status === "active" && String(e.text || "").trim() && !done[String(e.id)]; })
      .sort(function (a, b) { return String(a.created_at || "").localeCompare(String(b.created_at || "")); });
    const ahead = [], rest = [];
    rows.forEach(function (e) {
      (searchEnabled(e) && !(Array.isArray(e.triggers) && e.triggers.length) ? ahead : rest).push(e);
    });
    // 1110：条数到顶或材料字数到 CHAR_BUDGET 停（至少收 1 条）；字数≈实际材料行（含当时原文）
    const budget = Math.max(1000, Number(charBudget) || CHAR_BUDGET);
    const picked = [];
    let used = 0;
    for (const e of ahead.concat(rest)) {
      if (picked.length >= limit) break;
      const cost = String(e.id || "").length + String(e.kind || "?").length + String(e.text || "").length
        + (Array.isArray(e.triggers) ? e.triggers.join("").length : 0)
        + String((e.provenance || {}).quote || "").length + 20;
      if (picked.length && used + cost > budget) break;
      picked.push(e); used += cost;
    }
    return picked
      .map(function (e) {
        // 11-08：se/triggers/quote 随行输出——packRows 拼「id｜kind｜se｜关键词｜正文」+「└ 当时原文」用
        const pv = e.provenance || {};
        return {
          id: String(e.id), kind: e.kind || null,
          text: String(e.text || "").trim(),
          created_at: e.created_at || null,
          se: searchEnabled(e) ? 1 : 0,
          triggers: Array.isArray(e.triggers) ? e.triggers.map(function (s) { return String(s || "").trim(); }).filter(Boolean) : [],
          quote: String(pv.quote || "").trim(),
          // 1110：评估标签随行带出——tag 卡不重评分，批准时直接继承旧条的 worth/volatility
          worth: typeof e.worth === "number" ? e.worth : null,
          worth_reason: e.worth_reason || null,
          volatility: e.volatility || null,
          volatility_reason: e.volatility_reason || null,
        };
      });
  }

  function countRemaining() {
    let all = [];
    try { all = fs.readJsonSync(POOL_FILE); } catch (e) { all = []; }
    if (!Array.isArray(all)) all = [];
    const st = readState();
    const done = st.done || {};
    return all.filter(function (e) { return e && e.status === "active" && String(e.text || "").trim() && !done[String(e.id)]; }).length;
  }

  // ---------------- 输入打包（11-08：一行一条，出处取记忆自带 quote，零检索） ----------------
  function packRows(rows) {
    return rows.map(function (r) {
      let line = r.id + "｜" + (r.kind || "?") + "｜" + (r.se ? 1 : 0) + "｜" + (r.triggers || []).join("、") + "｜" + r.text;
      if (r.quote) line += "\n  └ 当时原文：「" + r.quote + "」";
      return line;
    }).join("\n");
  }

  // ---------------- 工具回合（模型主动要才跑；memory_search 查池 / context_search 搜原文） ----------------
  function normToolReq(x) {
    if (!x || typeof x !== "object") return null;
    const name = String(x.name || x.tool || "").trim();
    const q = String(x.query || x.q || "").trim().slice(0, 120);
    if (!name || !q) return null;
    return { name: name, query: q };
  }

  async function runToolRequests(reqs, usedRounds) {
    const parts = [];
    let budget = TOOL_RESULT_CHAR;
    const list = (reqs || []).slice(0, TOOLS_MAX_PER_ROUND);
    for (const t of list) {
      let body = "";
      try {
        if (t.name === "memory_search" && memorySearch) {
          const hits = await memorySearch(t.query, TOOL_MEM_RESULTS);
          const rows = (Array.isArray(hits) ? hits : []).slice(0, TOOL_MEM_RESULTS).map(function (h) {
            return "- [" + (h.kind || "?") + "] " + String(h.text || "").slice(0, 120) + "（id " + h.id + "）";
          });
          body = rows.length ? rows.join("\n") : "（池里没查到相关记忆）";
        } else if (t.name === "context_search" && searchContext) {
          const res = await searchContext(t.query, { allSessions: true, limit: TOOL_CTX_RESULTS });
          const ms = (res && res.ok && Array.isArray(res.matches) ? res.matches : []).slice(0, TOOL_CTX_RESULTS);
          const rows = ms.map(function (m) {
            return "- " + String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 200);
          }).filter(function (s) { return s.length > 2; });
          body = rows.length ? rows.join("\n") : "（没搜到相关原文）";
        } else {
          body = "（工具 " + t.name + " 不可用；可用：" + (memorySearch ? "" : "") + "memory_search=" + !!memorySearch + " context_search=" + !!searchContext + "）";
        }
      } catch (e) {
        body = "（工具执行失败：" + String((e && e.message) || e).slice(0, 120) + "）";
      }
      if (body.length > budget) body = body.slice(0, Math.max(200, budget)) + "\n…（超长截断）";
      budget -= body.length;
      parts.push("【" + t.name + "】" + t.query + "\n" + body);
      if (budget <= 200) break;
    }
    const tip = usedRounds >= TOOLS_MAX_ROUNDS
      ? "已到 " + TOOLS_MAX_ROUNDS + " 轮上限，现在必须出最终结论"
      : (usedRounds >= TOOLS_MAX_ROUNDS - 2 ? "（快到上限了）" : "");
    return "工具结果：\n\n" + parts.join("\n\n") + "\n\n（第 " + usedRounds + "/" + TOOLS_MAX_ROUNDS + " 轮" + tip + "）。继续要工具就输出 {\"tools\":[...]}，出结论就输出 {\"actions\":[...]}。";
  }


  // ---------------- LLM ----------------
  async function callLlm(system, msgs) {
    if (callLLMInject) return callLLMInject(system, msgs);   // 测试注入（mock 模型），不走真实 HTTP
    const router = require("./model-router");
    const { resolveTarget } = require("./upstream-target");
    const r = router.resolveRoleModel(MODEL_ROLE);
    if (!r || !r.provider || !r.model) throw new Error("模型未配置（role=" + MODEL_ROLE + "）");
    /* [位置:memory-backfill.js·callLlm resolveTarget] [出口统一走 upstream-target] [11-12：同 memory-summary，订阅类供应商自动转内部代理（x-provider-id + x-internal-key），普通供应商与原手拼零行为变化；直连保留 base 补全] [注释时间 2026-11-12] */
    const t = resolveTarget(r.provider, function (k) { return process.env[k]; }, r.model);
    let url = String((t && t.url) || "").replace(/\/+$/, "");
    if (url && !t.viaProxy && !/\/chat\/completions$/.test(url)) url += "/chat/completions";
    if (!url || !t.key) throw new Error("模型未配置（role=" + MODEL_ROLE + "）：供应商缺地址或密钥");
    // 1005-19 修：不用全局 fetch（undici 300s headersTimeout / 独立进程直连失败）→ http/https 直发
    /* [位置:memory-backfill.js·callLlm thinkingPatch] [重跑显式开思考] [11-09：deepseek 官方按供应商发 reasoning_effort=high 上锁（2026-11-09 实测接受），不再依赖厂商默认] [注释时间 2026-11-09] */
    const reqBody = Object.assign({
      model: r.model,
      messages: [{ role: "system", content: system }].concat(Array.isArray(msgs) ? msgs : [{ role: "user", content: String(msgs) }]),
      
      response_format: { type: "json_object" },
    }, router.thinkingPatch(r.provider));
    const res = await llmLog.post("memory_backfill", httpPostJson, url, JSON.stringify(reqBody), Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + t.key }, t.headers || {}), LLM_TIMEOUT_MS);
    if (res.status < 200 || res.status >= 300) throw new Error("LLM HTTP " + res.status + " " + String(res.text || "").slice(0, 200));
    const data = JSON.parse(res.text);
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return { text: String(text || ""), model: r.model };
  }

  // 剥思考块/围栏后按括号配对取第一个完整 JSON 对象。
  // 蒸馏侧实测：模型（尤其带推理的）会在 JSON 外裹 <think>、一口气吐两个对象，
  // 贪婪 indexOf("{")/lastIndexOf("}") 会把两个一起框进去解析必炸——按深度配对只取第一个。
  function extractJsonObj(s) {
    const t = String(s == null ? "" : s).replace(/<(think|reasoning|thinking)>[\s\S]*?<\/\1>/gi, "").trim();
    const start = t.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (!depth) {
          try { return JSON.parse(t.slice(start, i + 1)); } catch (_) { return null; }
        }
      }
    }
    return null;
  }

  // 动作解析（1110 产品确定对象式 {"do":...} 为主；11-08 数组式仍兼容）：→ 结构化。
  // 对象字段：do/id/ids/text/words/kind/why。丢弃原因全部记账（回执可见），不静默吞；同 id 同动作去重（取第一个）。
  const KINDS3 = ["fact", "rule", "event"];
  function parseWordsField(v) {
    return (Array.isArray(v) ? v : String(v || "").split(/[、,，;；\s]+/))
      .map((s) => String(s || "").trim()).filter(Boolean).slice(0, 3);
  }
  function normActions(rawActions, validIds) {
    const out = [];
    const dropped = [];
    const seenKey = Object.create(null);
    let n = 0;
    const inBatch = (id) => !!(validIds && validIds[id]);
    for (const a0 of (Array.isArray(rawActions) ? rawActions : [])) {
      n++;
      /* [位置:lib/memory-backfill.js·normActions 对象式] [主格式：字段名固定不靠位置] [需求:11-10「动作字段整理一遍，要让模型好操作」——数组式每个动作 id 位置都不一样还靠写反对调兜底；对象式字段名说话。words 不写由 applyActions 继承旧词；kind 不写沿用旧条；参与检索开关不让模型写] [注释时间 2026-11-10] */
      if (a0 && typeof a0 === "object" && !Array.isArray(a0)) {
        const action = String(a0.do || "").toLowerCase().trim();
        if (ACTIONS.indexOf(action) < 0) { dropped.push("第" + n + "项动作未知: " + String(a0.do || "空").slice(0, 20)); continue; }
        if (action === "keep") continue;
        const ids = Array.isArray(a0.ids) ? a0.ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
        const id = String(a0.id || "").trim() || (action !== "merge" ? ids[0] || "" : "");
        const words = parseWordsField(a0.words);
        const kind = KINDS3.indexOf(String(a0.kind || "").trim()) >= 0 ? String(a0.kind).trim() : null;
        const reason = String(a0.why != null ? a0.why : (a0.reason || "")).trim();
        const text = String(a0.text || "").trim();
        const targets = action === "merge" ? ids : [id];
        if (action === "merge" && ids.length < 2) { dropped.push("第" + n + "项 merge 少于 2 个 id"); continue; }
        if (action === "merge" ? false : !id) { dropped.push("第" + n + "项 " + action + " 缺 id"); continue; }
        const bad = targets.filter((x) => !inBatch(x));
        if (bad.length) { dropped.push("第" + n + "项 " + action + " 目标不在本批: " + bad.join(",").slice(0, 60)); continue; }
        if (action === "tag" && !words.length) { dropped.push("第" + n + "项 tag 缺词"); continue; }
        if ((action === "update" || action === "supplement") && !text) { dropped.push("第" + n + "项 " + action + " 缺正文"); continue; }
        const key = (action === "merge" ? ids.slice().sort().join(",") : id) + "|" + action;
        if (seenKey[key]) continue;
        seenKey[key] = true;
        out.push(action === "merge"
          ? { action: action, ids: ids, text: text, triggers: words, kind: kind, reason: reason }
          : { action: action, id: id, text: text, triggers: words, kind: kind, reason: reason });
        continue;
      }
      if (!Array.isArray(a0)) { dropped.push("第" + n + "项不是数组也不是对象"); continue; }
      const parts = a0.map((x) => String(x == null ? "" : x).trim());
      const action = (parts[0] || "").toLowerCase();
      if (ACTIONS.indexOf(action) < 0) { dropped.push("第" + n + "项动作未知: " + (parts[0] || "空").slice(0, 20)); continue; }
      if (action === "keep") continue;   // keep 只是示意，不落库
      if (action === "tag") {
        let words = (parts[1] || "").split(/[、,，;；\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
        let id = parts[2] || "";
        // 兜底：模型把 id 和词写反（parts[1] 在本批、parts[2] 不在）→ parts[1] 是 id、parts[2] 才是词
        if (!inBatch(id) && inBatch(parts[1])) { id = parts[1]; words = [parts[2]].filter(Boolean).slice(0, 3); }
        if (!words.length) { dropped.push("第" + n + "项 tag 缺词"); continue; }
        if (!id || !inBatch(id)) { dropped.push("第" + n + "项 tag 目标不在本批: " + (id || "空").slice(0, 30)); continue; }
        if (seenKey[id + "|tag"]) continue;
        seenKey[id + "|tag"] = true;
        out.push({ action: action, id: id, triggers: words, reason: parts[3] || "" });
      } else if (action === "merge") {
        let text = parts[1] || "";
        // 1110 兼容新数组式：[_,正文,词?,kind?,id1,id2,...]——在本批的当 id，fact/rule/event 当分类，其余按词拆
        const ids = [], extraWords = [];
        let kind = null;
        for (const seg of parts.slice(2).filter(Boolean)) {
          if (inBatch(seg)) { ids.push(seg); continue; }
          if (KINDS3.indexOf(seg) >= 0) { kind = seg; continue; }
          parseWordsField(seg).forEach((w) => extraWords.push(w));
        }
        if (!text) { dropped.push("第" + n + "项 merge 缺合并正文"); continue; }
        if (ids.length < 2) { dropped.push("第" + n + "项 merge 少于 2 个 id"); continue; }
        const bad = ids.filter((id) => !inBatch(id));
        if (bad.length) { dropped.push("第" + n + "项 merge 目标不在本批: " + bad.join(",").slice(0, 60)); continue; }
        const key = ids.slice().sort().join(",") + "|merge";
        if (seenKey[key]) continue;
        seenKey[key] = true;
        out.push({ action: action, ids: ids, text: text, triggers: extraWords.slice(0, 3), kind: kind, reason: "" });
      } else if (action === "sink") {
        const id = parts[1] || "";
        if (!id || !inBatch(id)) { dropped.push("第" + n + "项 sink 目标不在本批: " + (id || "空").slice(0, 30)); continue; }
        if (seenKey[id + "|sink"]) continue;
        seenKey[id + "|sink"] = true;
        out.push({ action: action, id: id, reason: parts[2] || "" });
      } else { // update / supplement
        let text = parts[1] || "";
        let id = parts[2] || "";
        // 兜底：id 和正文写反（id 在本批、另一段不在且更长）→ 对调
        if (inBatch(parts[1]) && !inBatch(parts[2]) && parts[2].length > parts[1].length) { const t1 = text; text = id; id = t1; }
        if (!text || !id) { dropped.push("第" + n + "项 " + action + " 缺正文或 id"); continue; }
        if (!inBatch(id)) { dropped.push("第" + n + "项 " + action + " 目标不在本批: " + id.slice(0, 30)); continue; }
        if (seenKey[id + "|" + action]) continue;
        seenKey[id + "|" + action] = true;
        out.push({ action: action, id: id, text: text, triggers: parseWordsField(parts[4]), kind: KINDS3.indexOf(String(parts[5] || "").trim()) >= 0 ? String(parts[5]).trim() : null, reason: parts[3] || "" });
      }
    }
    return { actions: out, dropped: dropped };
  }

  // 模型输出两种：{"tools":[...]}（要查证）／{"actions":[...]}（结论）
  function parseResponse(rawText, validIds) {
    const obj = extractJsonObj(rawText);
    if (!obj) return { tools: [], actions: [], dropped: [], error: "输出里没有可解析的 JSON 对象" };
    if (Array.isArray(obj.actions)) {
      const na = normActions(obj.actions, validIds);
      return { tools: [], actions: na.actions, dropped: na.dropped, error: null };
    }
    if (Array.isArray(obj.tools)) {
      const tools = obj.tools.map(normToolReq).filter(Boolean);
      if (tools.length) return { tools: tools, actions: [], dropped: [], error: null };
      return { tools: [], actions: [], dropped: [], error: "tools 数组里没有合法请求（缺 name/query）" };
    }
    return { tools: [], actions: [], dropped: [], error: '输出不是 {"actions":[...]} 也不是 {"tools":[...]}' };
  }

  
  // ---------------- 落处（全部走待审；11-08：sink 也是待审卡，approve=旧条归档） ----------------
  async function applyActions(actions, rows, batchRef) {
    const byId = Object.create(null);
    rows.forEach(function (r) { byId[r.id] = r; });
    const res = { queued: 0, skipped: 0, unchanged: 0, errors: [], items: [], failed: [] };   // failed＝有行 id 的失败清单：这些条不记 done，下一批重试（11-15）

    if (!admission || typeof admission.submitPromotion !== "function") {
      return Object.assign(res, { error: "admission 未注入，无法落待审" });
    }
    /* 失败行记账：只收本批真实存在的行 id，去重；没有行 id（如目标不在本批）不影响 done 判定 */
    function markFailed(ids) {
      for (const id of (Array.isArray(ids) ? ids : [])) {
        if (!id || !byId[id]) continue;
        const k = String(id);
        if (res.failed.indexOf(k) < 0) res.failed.push(k);
      }
    }

    for (const a of actions) {
      try {
        const targets = a.action === "merge" ? a.ids : [a.id];
        const bad = targets.filter(function (id) { return !byId[id]; });
        if (bad.length) { res.skipped++; res.errors.push(a.action + " 目标不在本批：" + bad.join(",")); continue; }
        const baseRow = byId[targets[0]];

        /* [位置:lib/memory-backfill.js·applyActions 没改不进待审] [归一化比对跳过无变化动作] [需求:11-08「那个重跑模型。输出的。没改的就不放到待审」——模型嘴上说 update 实际给了原文（归一化后相同）、tag 的词与现有完全一样，都不生成待审卡单独计数；1110 关键词/分类也可单独变：正文没变但词或分类变了照旧进待审] [注释时间 2026-11-10] */
        if (a.action === "update" || a.action === "supplement") {
          const sameText = normalizeText(a.text) === normalizeText(byId[a.id].text);
          const eqWords = (x, y) => {
            const norm = (arr) => (Array.isArray(arr) ? arr : []).map((t) => String(t || "").trim()).filter(Boolean).sort().join("|");
            return norm(x).length > 0 && norm(x) === norm(y);
          };
          const sameWords = !a.triggers || eqWords(a.triggers, byId[a.id].triggers);
          const sameKind = !a.kind || a.kind === byId[a.id].kind;
          if (sameText && sameWords && sameKind) { res.unchanged++; continue; }
        }
        if (a.action === "tag") {
          const cur = (byId[a.id].triggers || []).map(function (s) { return String(s || "").trim(); }).filter(Boolean).sort().join("|");
          if (cur && cur === a.triggers.slice().sort().join("|")) { res.unchanged++; continue; }
        }

        // sink：内容=旧条原文（不改字），approve 时 state-executor 按 backfill.action='sink' 直接归档旧条、不建新条
        // 关键词/分类（1110 产品确定）：模型写了用模型的；update 没写沿用旧词、merge 没写取旧词并集（最多 3 个）；
        // kind 没写沿用第一条旧条。参与检索开关不让模型写：update 沿用旧条、merge 任一条开着就开。
        let words;
        if (a.action === "tag") words = a.triggers;
        else if (a.triggers && a.triggers.length) words = a.triggers;
        else if (a.action === "merge") {
          const seenW = new Set(); words = [];
          for (const id of targets) for (const w of (byId[id].triggers || [])) {
            const t = String(w || "").trim();
            if (t && !seenW.has(t)) { seenW.add(t); words.push(t); }
          }
          words = words.slice(0, 3);
        } else words = (byId[a.id].triggers || []).map(function (t) { return String(t || "").trim(); }).filter(Boolean).slice(0, 3);
        const body = {
          content: a.action === "sink" ? baseRow.text : (a.text || baseRow.text),
          kind: a.kind || baseRow.kind,
          channel: "backfill",
          source: { type: "backfill", ref: batchRef },
          backfill: a.action === "merge"
            ? { action: "merge", target_id: null, merge_ids: a.ids, old_text: a.ids.map(function (id) { return byId[id].text; }).join(" ／ "), reason: a.reason }
            : { action: a.action, target_id: a.id, merge_ids: null, old_text: byId[a.id].text, reason: a.reason || ("清洗：" + a.action) },
        };
        /* [位置:lib/memory-backfill.js·applyActions skip_judge 收窄] [update/merge 排队门卫评分] [需求:11-10「只要更新了合并了那就得重新评」——update/merge 正文变了要门卫重新评（worth/相似），不再 skip_judge，落队列 judge_status=pending 进攒批；tag 只补词没新正文不评（批准时直接继承旧条 worth/volatility，见下）；sink 只归档不建新条也不评] [注释时间 2026-11-10] */
        if (a.action === "tag" || a.action === "sink") body.skip_judge = true;
        if (words && words.length) body.triggers = words;
        body.search_enabled = a.action === "merge"
          ? targets.some(function (id) { return searchEnabled(byId[id]); })
          : searchEnabled(byId[a.id]);
        if (a.action === "tag") {
          for (const k of ["worth", "worth_reason", "volatility", "volatility_reason"]) if (baseRow[k] != null) body[k] = baseRow[k];
        }
        const r = await admission.submitPromotion(body, { sessionId: null, msgId: null });
        if (r && (r.action === "review" || r.action === "admit")) {
          res.queued++;
          res.items.push({ action: a.action, id: a.action === "merge" ? targets.join(",") : a.id, old_text: body.backfill.old_text, text: body.content, reason: a.reason });
        } else {
          res.skipped++;
          res.errors.push(a.action + " 未入队：" + (r && r.action));
          markFailed(targets);
        }
      } catch (e) {
        res.errors.push((a && a.action || "?") + " 异常：" + String((e && e.message) || e).slice(0, 160));
        /* 在 catch 里能拿到 targets 就用它（失败发生在 submitPromotion 之后），拿不到就按动作自身 id 兜底 */
        markFailed(a && a.action === "merge" ? (Array.isArray(a.ids) ? a.ids : []) : [(a && a.id)]);
      }
    }
    /* [位置:lib/memory-backfill.js·applyActions 失败记账] [名称:单条失败要能让本批不记 done] [需求:11-15 健壮性——原来 catch 只 push errors、never 置 error，runOnce 只看 applied.error 就把整批标 done，失败那条再也不会被选中重试；现在失败的行 id 收进 failed 并置 res.error（调用方据此不记 done / 只标成功的），没入队（门卫拒收）同款处理] [注释时间 2026-11-15] */
    if (res.failed.length) {
      res.error = res.failed.length + " 条动作失败：" + String(res.errors[res.errors.length - 1] || "").slice(0, 120);
    }
    return res;
  }

  /* [位置:lib/memory-backfill.js·inheritDone] [替换产生的新条继承已跑标记] [需求:11-08「跑过的记忆不再参与重跑」——done 按 id 记，update/tag/merge 卡通过后旧条被替换成新 id，不继承的话新条立刻又会被下一批选中、模型把同一个改动再提一遍；这里把旧条里最早的 done 时间抄给新条，新条等下一轮全池轮完才会再被清洗] [注释时间 2026-11-08] */
  function inheritDone(oldIds, newId) {
    const st = readState();
    const done = st.done || {};
    let t = null;
    (Array.isArray(oldIds) ? oldIds : []).forEach(function (id) {
      const v = done[String(id)];
      if (v && (!t || v < t)) t = v;
    });
    if (!t || !newId) return { ok: false, reason: !t ? "旧条没有 done 记录" : "缺 newId" };
    done[String(newId)] = t;
    writeState({ done: done });
    return { ok: true, new_id: String(newId), done_at: t };
  }

  // ---------------- 跑一批 ----------------
  async function runOnce(reason, runOpts) {
    if (state.running) return { ok: false, error: "已有重跑在跑", running: true };
    state.running = true;
    const startedAt = Date.now();
    state.startedAt = new Date(startedAt).toISOString(); state.lastTrigger = String(reason || "manual");   // 运行日志 runsInfo 的实时状态要用
    const ro = runOpts || {};
    const cfg = readConfig();
    const batchSize = Math.max(1, Number(ro.batch_size) || cfg.batch_size);   // 1110：上限交给 CHAR_BUDGET
    const out = { reason: state.lastTrigger, started_at: state.startedAt, batch_size: batchSize, ok: true, error: null };
    try {
      const rows = selectRows(batchSize);
      out.count = rows.length;
      out.remaining = countRemaining();
      if (!rows.length) {
        out.ok = true;
        out.note = "没有待重跑的记忆（全部已处理）";
        /* [位置:lib/memory-backfill.js·runOnce 空跑回执] [名称:空跑也写 last_run_result] [需求:11-14「每次重跑显示几条记忆参与」——空跑原来不写 config，设置页运行日志副标题会停在旧一批的旧数字] [注释时间 2026-11-14] */
        try {
          saveConfig({
            last_run_at: new Date().toISOString(),
            last_run_result: { ok: true, reason: out.reason, count: 0, queued: 0, unchanged: 0, skipped: 0, remaining: out.remaining, duration_ms: Date.now() - startedAt },
          });
        } catch (_) {}
        appendRun({ id: runId(), ts: new Date().toISOString(), trigger: out.reason, kind: "batch", ok: true, summary: out.note, duration_ms: Date.now() - startedAt });
        return out;
      }
      const validIds = Object.create(null);
      rows.forEach(function (r) { validIds[r.id] = true; });
      const materials = packRows(rows);
      try { fs.writeFileSync(PACK_FILE, materials); } catch (_) {}
      const p = buildPrompt(materials, rows.length);
      let parsed = { tools: [], actions: [], dropped: [], error: "未调用" }, model = null, toolsUsed = 0;
      if (ro.dryRun) {
        out.mode = "dry_run";
        out.prompt_chars = p.system.length + p.user.length;
        out.note = "dryRun：未调模型";
        appendRun({ id: runId(), ts: new Date().toISOString(), trigger: out.reason, kind: "batch", ok: true, dry_run: true, summary: out.note, duration_ms: Date.now() - startedAt });
        return out;
      }
      try {
        const msgs = [{ role: "user", content: p.user }];
        let lastText = "";
        // 最多 TOOLS_MAX_ROUNDS + 1 次模型调用：首轮判断 + 每轮查证后重问；到上限强制出结论（模型只回 actions 时循环自然终止）
        for (let turn = 0; turn <= TOOLS_MAX_ROUNDS + 1; turn++) {
          const r = await callLlm(p.system, msgs);
          lastText = String(r.text || "");
          model = r.model;
          try { fs.writeFileSync(RAW_FILE, lastText); } catch (_) {}
          const pr = parseResponse(lastText, validIds);
          // 模型主动要查证（memory_search/context_search）：执行后回灌，它比我们更清楚该查什么
          if (pr.tools.length && toolsUsed < TOOLS_MAX_ROUNDS) {
            toolsUsed++;
            out.tool_rounds = toolsUsed;
            out.tool_requests = (out.tool_requests || 0) + pr.tools.length;
            msgs.push({ role: "assistant", content: lastText });
            msgs.push({ role: "user", content: await runToolRequests(pr.tools, toolsUsed) });
            continue;
          }
          parsed = pr;
          break;
        }
        out.parse_error = parsed.error;
        out.dropped_actions = parsed.dropped;
        out.raw_chars = lastText.length;
      } catch (e) {
        out.ok = false; out.error = String((e && e.message) || e).slice(0, 200);
        state.lastError = out.error;
        log("本批失败：" + out.error);
        /* [位置:lib/memory-backfill.js·runOnce 模型失败回执] [名称:失败也写 last_run_result] [需求:11-14——失败原来不写 config，副标题停在旧一批；失败不记 done、留待重试，本路径提前 return 不经过下方 done 写入，天然满足] [注释时间 2026-11-14] */
        try {
          saveConfig({
            last_run_at: new Date().toISOString(),
            last_run_result: { ok: false, reason: out.reason, count: out.count, queued: 0, unchanged: 0, skipped: 0, remaining: countRemaining(), duration_ms: Date.now() - startedAt },
          });
        } catch (_) {}
        appendRun({ id: runId(), ts: new Date().toISOString(), trigger: out.reason, kind: "batch", ok: false, error: out.error, duration_ms: Date.now() - startedAt });
        return out;
      }
      out.model = model;
      out.raw_actions = parsed.actions.length;
      const applied = await applyActions(parsed.actions, rows, rows.map(function (r) { return r.id; }).join(",").slice(0, 200));
      out.queued = applied.queued;
      out.unchanged = applied.unchanged;
      out.skipped = applied.skipped;
      out.apply_errors = applied.errors;
      out.items = applied.items;
      if (applied.error) { out.ok = false; out.error = applied.error; }

      // 11-14「跑成功才记 done，失败的不算、留待重试」；11-15 补：失败的只到条级——本批成功的照常标 done，
      // 只有失败那几条留给下一批（原来单条异常会把整批标 done，失败条永远不再重跑）。
      // 原「失败了也算跑过防死循环」口径作废——调度一天最多一次（ranToday），重跑 enabled=false 全靠手动。
      /* [位置:lib/memory-backfill.js·runOnce done 写入] [名称:失败条不记 done、成功的照常记] [需求:11-15 健壮性——原来只看 applied.error，单条动作异常时整批照样标 done，失败那条永远不再重试；现在失败的 id 排除在 done 外（本批其余成功的照常标，避免一条坏动作把整批钉死、每天重跑同一批）] [注释时间 2026-11-15] */
      if (out.ok || (applied.failed && applied.failed.length)) {
        const st = readState();
        const done = st.done || {};
        const at = new Date().toISOString();
        const failedSet = new Set(out.ok ? [] : (applied.failed || []));
        rows.forEach(function (r) { if (!failedSet.has(r.id)) done[r.id] = at; });
        writeState({ done: done });
        if (failedSet.size) out.retry_next = Array.from(failedSet);   // 回执里明说哪几条留着下次重试
      }
      out.remaining = countRemaining();   // 跑完后再算一次「还剩几条没跑过」，参与条数显示要用

      out.duration_ms = Date.now() - startedAt;
      out.finished_at = new Date().toISOString();
      /* 11-12：成功路径原来只有 log 一行人话，「运行日志」子页也要一句——note 在这里补拼（空跑/dryRun/失败各自有 note/error） */
      out.note = "参与 " + rows.length + " → 进待审 " + out.queued + " / 无变化 " + out.unchanged + (out.skipped ? " / 跳过 " + out.skipped : "")
        + "，还剩 " + out.remaining + " 条没跑过，查证 " + toolsUsed + " 轮，" + (out.duration_ms / 1000).toFixed(1) + "s"
        + (out.ok ? "" : ("（有动作失败：" + String(out.error || "").slice(0, 80) + (out.retry_next ? "；" + out.retry_next.length + " 条留待下批重试" : "") + "）"));
      try {
        saveConfig({
          last_run_at: new Date().toISOString(),
          last_run_result: { ok: out.ok, reason: out.reason, count: out.count, queued: out.queued, unchanged: out.unchanged, skipped: out.skipped, remaining: out.remaining, duration_ms: out.duration_ms },
        });
      } catch (_) {}
      appendRun({ id: runId(), ts: out.finished_at, trigger: out.reason, kind: "batch", ok: !!out.ok, summary: out.note, error: out.error || null, duration_ms: out.duration_ms });
      log("跑完一批（" + out.reason + "，" + rows.length + " 条 → 待审 " + out.queued + " / 无变化跳过 " + out.unchanged + "，查证 " + toolsUsed + " 轮，" + (out.duration_ms / 1000).toFixed(1) + "s）");
    } finally { state.running = false; }
    return out;
  }

  // ---------------- 调度 ----------------
  function parts() { return timeUtils.getDatePartsInTimeZone(new Date(), TZ); }
  function localDateKey(d) {
    const p = timeUtils.getDatePartsInTimeZone(d || new Date(), TZ);
    return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
  }
  function curHm() { const p = parts(); return pad2(p.hour) + ":" + pad2(p.minute); }
  function localMinutes() { const p = parts(); return Number(p.hour) * 60 + Number(p.minute); }
  function ranToday() {
    const c = readConfig();
    if (!c.last_run_at) return false;
    return localDateKey(new Date(c.last_run_at)) === localDateKey();
  }
  function dueNow() {
    const c = readConfig();
    if (!c.enabled || ranToday()) return false;
    const m = /^(\d{1,2}):(\d{2})$/.exec(c.time);
    const target = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    const now = localMinutes();
    return now >= target && now - target <= 5;
  }
  function tick() {
    if (!dueNow()) return;
    runOnce("schedule").catch(function (e) { state.lastError = String((e && e.message) || e); });
  }
  function start() {
    if (state.timer) return;
    state.timer = setInterval(tick, CHECK_MS);
    if (state.timer.unref) state.timer.unref();
    const c = readConfig();
    log("调度已启动：enabled=" + c.enabled + " time=" + c.time + " batch=" + c.batch_size + "（时区 " + TZ + "，本地现在 " + localDateKey() + " " + curHm() + "）");
    try {
      const minutes = localMinutes();
      const m = /^(\d{1,2}):(\d{2})$/.exec(c.time);
      const target = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
      if (c.enabled && !ranToday() && minutes - target >= 0 && minutes - target <= CATCHUP_WINDOW_MS / 60000) {
        runOnce("schedule-catchup").catch(function (e) { state.lastError = String((e && e.message) || e); });
      }
    } catch (_) {}
  }
  function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  function status() {
    const c = readConfig();
    const st = readState();
    const sink = readJsonSafe(SINK_FILE, { items: [] });
    return {
      enabled: c.enabled, time: c.time, batch_size: c.batch_size,
      running: state.running, schedulerOn: !!state.timer, tz: TZ,
      local_now: localDateKey() + " " + curHm(),
      ran_today: ranToday(),
      last_run_at: c.last_run_at, last_run_result: c.last_run_result, last_error: state.lastError,
      done_count: Object.keys((st && st.done) || {}).length,
      remaining: countRemaining(),
      sink_suggestions: Array.isArray(sink.items) ? sink.items.length : 0,
    };
  }

  function readSinkSuggestions() {
    const j = readJsonSafe(SINK_FILE, { items: [] });
    return { items: Array.isArray(j.items) ? j.items : [] };
  }
  function clearSinkSuggestion(id) {
    const j = readJsonSafe(SINK_FILE, { items: [] });
    const arr = Array.isArray(j.items) ? j.items : [];
    const next = arr.filter(function (x) { return String(x && x.id) !== String(id); });
    fs.writeJsonSync(SINK_FILE, { items: next }, { spaces: 2 });
    return { items: next };
  }

  return {
    readConfig, saveConfig,
    readState, readPromptConfig, savePromptConfig,
    defaultSystemPrompt, defaultUserPrompt, buildPrompt,
    selectRows, countRemaining, packRows, parseResponse, applyActions, inheritDone,
    readSinkSuggestions, clearSinkSuggestion,
    runNow: function (o) { return runOnce("manual", o); },
    runsInfo: runsInfo,
    status, start, stop,
  };
};
