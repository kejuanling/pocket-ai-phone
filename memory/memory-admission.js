"use strict";

// ========================
// Memory Admission Pipeline（C4/C5）——流程编排，不含业务规则
// 流程（17.txt）：input → candidate_detector → provenance_builder → validator
//   → 决策 → state_executor（唯一写手）→ audit（记最终动作）
// C5 门控语义（v2_enabled × v2_shadow）：
//   v2_enabled=true  → 正式路径：旧池继续写（旧路由恒写，兼容承诺），V2 写主集合/主队列
//   v2_enabled=false + v2_shadow=true → 影子观察：V2 只写影子集合/队列，旧池照旧
//   两者皆 false     → V2 完全跳过（skipped_v2_off），旧池行为不变
// 决策策略（2026-09-19 起 LLM judge 正式启用，业务语义见 14.txt）：
//   detector 非候选 → reject；validator 硬规则命中 → reject；
//   找到相似既有记忆 → judge LLM 判关系：duplicate→reject、update/need_review→review、
//   coexist→admit（1002-14：quote 类已删，此注同步）；
//   没有相似既有 → 无需判定，直接 admit（原 quote→review 保守路径随分类删除）；
//   judge 失败/非法输出 → 回退上述保守路径并在 why 标注。
//   promotion/manual_review 通道 R7 不变：judge 只注解进 review 队列，不改变首入 review。
//   judge_mode 配置（memory_v2_config.json）：llm（默认）/ mock / off。
// 输出契约：{ action, candidate, validation, audit_id }（异步：调用方须 await）
// ========================

const fs = require("fs-extra");
const path = require("path");
const ROOT_DIR = path.join(__dirname, "..");  // 1018-13：模块已搬进子目录，项目根 = 上一级
const { buildProvenance } = require("./provenance-builder");
const { validate } = require("./admission-validator");
const { createAuditLogger } = require("./admission-audit");
const { createStore, DEFAULT_CONFIG } = require("./memory-v2");
const { createStateExecutor } = require("../context/state-executor");
const { buildPrompt, parseJudgeOutput, normalizeText, buildBatchPrompt, parseBatchOutput } = require("./judge-adapter");

// ---- 相似既有检索（1004-04 改造：取全部候选，不再只取最高分一条）----
//
// 1004-04 用户拍板：
//  · 权重从 0.55词面+0.25语义（满分 0.8）降到 0.4词面+0.1语义（满分 0.5）——语义只占 20%，让它当辅助
//  · 门槛 0.28 是旧满分口径下的值（相对 35%），新权重下等于相对 56%，
//    离线校准（probe-similarity-calibration，177 条真实数据）实测：0.28 下召回 0.0 条（完全失效），
//    噪声基线（库内任意两条的中位混合分）= 0.098，p99 = 0.184。
//    0.18 实测平均召回 2.1 条 / 中位 1 条 / 最多 18 条，且抽样确认高分对全是真重复 → 定为 0.18。
//  · 候选上限 20 条（用户拍板），超出的按分数截断
//
// 语义通道复用 memory-v2-vectors.relevantScores（embed 熔断/失败 → ok:false 自动降级纯词面）。
const JUDGE_SIM_THRESHOLD = 0.18;
const JUDGE_LIT_GATE = 0.1;
const JUDGE_SIM_MAX = 20;
const JUDGE_W_LIT = 0.4;
const JUDGE_W_SEM = 0.1;
// 返回全部达门槛的候选（分数降序，最多 20 条）；无相似返回 []。
// excludeIds（1110 产品确定「更新合并也要重新评分」）：评分队列里回填 update/merge 的新正文来自被替换旧条、
// 手动直通的条目已入库——不排除的话每张卡都会「命中自己要替换的那条」，相似清单全是噪声。
async function findSimilarExisting(store, text, excludeIds) {
  const key = normalizeText(text);
  if (!key) return [];
  const excl = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(String));
  const rows = store.list({ status: "active" }).filter(e => normalizeText(e.text) && !excl.has(String(e.id)));
  if (!rows.length) return [];
  const vectors = require("./memory-v2-vectors");
  const rs = await vectors.relevantScores(rows, key);
  const semById = rs && rs.ok ? rs.scores : null;
  const { tokenize, similarity } = require("../context/context-v2-adapter");
  const qt = tokenize(key);
  const hits = [];
  for (const e of rows) {
    const lit = similarity(qt, normalizeText(e.text));
    if (lit < JUDGE_LIT_GATE) continue; // 词面硬门槛先挡无关条目
    const sem = semById ? (semById[e.id] || 0) : 0;
    const score = semById ? (JUDGE_W_LIT * lit + JUDGE_W_SEM * sem) : (JUDGE_W_LIT * lit);
    if (score < JUDGE_SIM_THRESHOLD) continue;
    hits.push({ entry: e, score: Math.round(score * 1000) / 1000, lit: Math.round(lit * 1000) / 1000,
                sem: Math.round(sem * 1000) / 1000 });
  }
  hits.sort((a, b) => b.score - a.score || String(a.entry.id).localeCompare(String(b.entry.id)));
  return hits.slice(0, JUDGE_SIM_MAX);
}

// ---- 内置 LLM 通道（judgeLLM 的 callLLM 注入实现；测试可经 opts.callLLM 覆盖）----
// .env 直读（与 server.js readEnvValue 同口径；judge 在 admission 模块内，不走 server 助手）
let _envCache = null;
function readEnvValue(key) {
  if (process.env[key]) return process.env[key];
  if (_envCache === null) {
    _envCache = {};
    try {
      const lines = fs.readFileSync(path.join(ROOT_DIR, ".env"), "utf8").split(/\r?\n/);
      for (const l of lines) { const i = l.indexOf("="); if (i > 0) _envCache[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1"); }
    } catch (_) { /* .env 缺失用空 */ }
  }
  return _envCache[key] || "";
}

// 1004-04：worth 显示用（null → "-"，否则百分比整数）
function fmtW(w) { return (w == null) ? "-" : Math.round(w * 100) + "%"; }

// 1004-04：单次 judge 调用（existing 为 null 表示"无相似对照"，只取 worth/volatility）。
// 返回 {ok:true, relation, relation_reason, worth, worth_reason, volatility, volatility_reason, suggested_kind, suggested_kind_reason}
// 或 {ok:false, error}。
async function runJudge(candidateText, existingEntry, kindVal, opts) {
  try {
    const prompt = buildPrompt(candidateText, existingEntry ? existingEntry.text : "（无相似记忆）", {
      candidateKind: kindVal ? String(kindVal) : "",
      existingKind: existingEntry ? (existingEntry.kind + "/" + (existingEntry.status || "")) : "none",
    });
    const raw = await (typeof opts.callLLM === "function" ? opts.callLLM : defaultCallLLM)(prompt, 1);
    const parsed = parseJudgeOutput(raw);
    return parsed.ok ? parsed : { ok: false, error: parsed.error };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function defaultCallLLM(prompt, callOpts = {}) {
  const router = require("../lib/model-router");
  const { resolveTarget } = require("../lib/upstream-target");
  const { provider, model } = router.resolveRoleModel("memory_admit");
  /* [位置:memory-admission.js·defaultCallLLM resolveTarget] [出口统一走 upstream-target] [11-12：同 memory-summary，订阅类供应商自动转内部代理（x-provider-id + x-internal-key），普通供应商与原手拼零行为变化；直连保留 base 补全。fetch 只打本机内部地址/直连上游，超时最长 45~120s，碰不到 undici 300s headersTimeout] [注释时间 2026-11-12] */
  const t = resolveTarget(provider, function (k) { return process.env[k]; }, model);
  let apiUrl = String((t && t.url) || "").replace(/\/+$/, "");
  if (apiUrl && !t.viaProxy && !/\/chat\/completions$/.test(apiUrl)) apiUrl += "/chat/completions";
  if (!apiUrl || !t.key || !model) throw new Error("模型未配置（role=memory_admit：请在设置里给「记忆准入」选模型或启用默认供应商）");
  // 11-08：批量评分一次要输出 N 条结果，超时和 max_tokens 放宽（调用方传，单条路径默认不变）
  const timeoutMs = Number(callOpts.timeoutMs) || 45000;
  const maxTokens = Number(callOpts.maxTokens) || 2048;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + t.key }, t.headers || {}),
      /* [位置:memory-admission.js·defaultCallLLM thinkingPatch] [门卫评分显式开思考] [11-09：glm 按供应商上锁 thinking.enabled（实测接受且与 temperature 0.1 共存），不再依赖厂商默认] [注释时间 2026-11-09] */
      body: JSON.stringify(Object.assign({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1, max_tokens: maxTokens, response_format: { type: "json_object" },
      }, router.thinkingPatch(provider))),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error("LLM HTTP " + resp.status);
    const data = await resp.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("LLM 空响应");
    return String(content);
  } finally { clearTimeout(timer); }
}

// 旧池 category → V2 kind 翻译（manual 兼容层专用；未映射类别 kind 为空进待审）
const CATEGORY_MAP = {
  "关于她": { kind: "fact" },
  "认账": { kind: "rule", direction: "self_discipline" },
  "拓本": { kind: "fact" },
};

function readConfigFile(file) {
  try {
    return fs.readJsonSync(file);
  } catch (_) {
    return null; // 配置缺失/坏损回退默认；坏损不该阻塞（与存储层数据不同级）
  }
}

function mergeCfg(base, overrides) {
  const out = { ...base };
  if (!overrides) return out;
  for (const k of Object.keys(overrides)) {
    if (k === "paths" && overrides.paths && typeof overrides.paths === "object") {
      out.paths = { ...(base.paths || {}), ...overrides.paths };
    } else if (k === "defaults" && overrides.defaults && typeof overrides.defaults === "object") {
      out.defaults = { ...(base.defaults || {}), ...overrides.defaults };
    } else {
      out[k] = overrides[k];
    }
  }
  return out;
}

// opts: { rootDir?, config?, shadow? }（shadow=true 强制影子模式，测试用；默认读配置 v2_shadow）
function createAdmission(opts = {}) {
  const rootDir = opts.rootDir || ROOT_DIR;
  const fileCfg = readConfigFile(path.join(rootDir, "data", "memory_v2_config.json"));
  const cfg = mergeCfg(mergeCfg(DEFAULT_CONFIG, fileCfg), opts.config || null);
  const shadowForced = opts.shadow != null ? !!opts.shadow : null;
  const shadowOn = shadowForced != null ? shadowForced : cfg.v2_shadow === true;

  // 主集合/主队列：v2_enabled=true 的正式落点（本阶段默认关闭）
  const mainStore = createStore({ rootDir, config: { paths: cfg.paths } });
  const mainExecutor = createStateExecutor({ store: mainStore, queuePath: mainStore.paths.review_queue });
  // 影子集合/队列：shadow 观察模式的全部落点
  const shadowStore = createStore({
    rootDir,
    config: { paths: { collection: cfg.paths.shadow_collection, review_queue: cfg.paths.shadow_queue } },
  });
  const shadowExecutor = createStateExecutor({ store: shadowStore, queuePath: shadowStore.paths.review_queue });
  const audit = createAuditLogger({ rootDir, dir: "data" });

  const judgeMode = cfg.judge_mode != null ? String(cfg.judge_mode) : "llm";

  // manual 适配器：兼容旧 POST /admin/memory-pool body {content, category, importance}
  // 兼容策略：旧路由恒写旧池（v2_enabled=true 也不停）；本适配器只负责 V2 侧落点。
  // 异步（2026-09-19）：judge LLM 判定，调用方须 await。
  async function submitManual(body, ctx = {}, mode = "shadow") {
    const formal = mode === "formal";
    const isPromo = mode === "promotion";
    const isManualReview = mode === "manual_review"; // 0918：promotion 通道（压缩块原文提炼候选），R7 全落 review，不受双闸门控（按钮即人工授权）
    const isManualReviewGate = isPromo || isManualReview;
    if (!formal && !isManualReviewGate && !shadowOn) {
      // 影子观察未开启时跳过（正式 admit 通道只经 submitV2 的 v2_enabled 门进入）
      return { action: "skipped_shadow_off", candidate: null, validation: null, audit_id: null };
    }
    const exec = (formal || isManualReviewGate) ? mainExecutor : shadowExecutor;
    const originVal = isPromo ? "promotion" : "manual";
    const b = body || {};
    const text = strSafe(b.content || b.text);
    if (!text) {
      return { action: "reject", candidate: null, validation: { allowed: false, matched_rules: ["V6"], reasons: ["V6 text 为空"] }, audit_id: null, notes: "content 为空" };
    }
    const mapped = CATEGORY_MAP[b.category] || null;
    // 2026-10-01：聊天页入池显式携带说话人（user=用户 / ai=谢），优先于分类映射
    const explicitSpeaker = strSafe(b.speaker) || null;
    const speakerVal = explicitSpeaker || (mapped ? mapped.speaker || null : null);

    // [1] 分类：直接取上游显式 kind（蒸馏/重跑/提炼/工具提交都已由 LLM 或人工分好类）。
    // 1007：不再机械粗分——分类为空则 null，进待审由门卫给分类建议、人工更换后入库。
    const rawKind = mapped ? mapped.kind : (strSafe(b.kind) || null);
    const kindVal = (rawKind && ["fact", "rule", "event"].includes(rawKind)) ? rawKind : null;

    // [2] provenance_builder（manual：无 session/msg → null，不伪造；promotion：block_id 必带（压缩块溯源），msg_id=null）
    // method 一律用契约内合法值（2026-09-28 拍板方案B：原 chat_manual_pick 不在 LEGAL_METHODS 会被静默置 null）
    // 2026-11-06：channel 细分来源由调用方如实传入（蒸馏对话/笔记、压缩块解析、老数据重跑、手动）
    const provenance = buildProvenance({
      origin: originVal,
      method: isPromo ? "summary_promotion" : "admin_form",
      sessionId: strSafe(ctx.sessionId),
      msgId: strSafe(ctx.msgId),
      channel: strSafe(b.channel) || null,
    });
    if (strSafe(b.quote)) provenance.quote = String(b.quote).slice(0, 200);
    // 人工入池（聊天页/管理台）：整条消息即原文摘录，自动补 provenance.quote 供溯源
    // （1002-14：原 V9 强制「quote 必须附原文」已废，改为无条件补，溯源信息不丢）
    if (!isPromo && !strSafe(provenance.quote)) {
      provenance.quote = text.slice(0, 200);
    }
    // 消息时间（待审可见；入库时 _buildEntry 只保留 schema 五字段，msg_time 自然丢弃）
    if (strSafe(b.msg_time)) provenance.msg_time = String(b.msg_time).trim();
    if (isPromo && strSafe(b.block_id)) provenance.block_id = strSafe(b.block_id);

    // [3] validator（恒跑；kind 可空由 V7 放行）
    const validation = validate({
      text,
      kind: kindVal,
      origin: originVal,
      speaker: speakerVal,
      direction: mapped ? mapped.direction || null : null,
      provenance,
      source: originVal,
    });

    // [4] 决策（judge LLM 判定 + 保守回退）
    let { action, why } = decide(validation);
    let judgeNote = null;
    let mergeDraft = null; // 1004-04 起恒为 null（judge 不再生成合并草稿，保留变量供返回契约兼容）
    let judgeMeta = null; // 1004-04：{worth, worth_reason, volatility, volatility_reason, similar[]}
    // 1004-04：judge 退化为「只提供信息的人」——无条件跑、只打标、不做任何自动决策。
    // 有相似：逐条判关系（有上限，几条就调几次）；无相似：也跑一次只拿 worth/volatility。
    // 1008-13：老数据重跑（backfill）产出的记忆一律不经门卫模型——自带 kind/triggers/vibe/worth，直接进待审
    /* [位置:memory/memory-admission.js·submitManual judge 排队] [门卫评分统一攒批] [需求:11-10「门卫都说了要排队，攒着一批一批的搞」——主队列通道（formal/promotion/manual_review）不再同步跑 judge（蒸馏/压缩块解析以前是当场逐条评，慢又费 token），落队列 judge_status=pending 由 processMemoryAddJudgeBatch 统一攒批评分；skip_judge（tag/sink）照旧直接进待审；只有 shadow 影子观察保留同步评（影子队列不进攒批，测试兼容）] [注释时间 2026-11-10] */
    const judgeApplies = !formal && !isManualReviewGate && validation.allowed && judgeMode !== "off" && !(b.skip_judge === true);
    const similarList = [];   // 待审页展示用：[{id,text,kind,score,relation,relation_reason}]
    let judgeTimedOut = false;   // 超时降级后迟到的 judge 结果不再落（见 runJudgeStage 收尾）
    const JUDGE_TOTAL_TIMEOUT_MS = 90000; // 1010-16：judge 整体 90s 超时降级（长内容/高相似命中串行 judge 曾超 300s 致 memory_add timed out）
    if (judgeApplies) {
      // 抽成独立阶段：整体 90s 上限，超时降级入待审（judge 1004-04 起只打标不决策，缺失不影响准入，入待审人工把关最稳）
      async function runJudgeStage() {

      let hits = [];
      try { hits = await findSimilarExisting(mainStore, text); }
      catch (e) { judgeNote = "相似检索失败(" + ((e && e.message) || e) + ")"; }
      let worth = null, worthReason = null, volatility = null, volatilityReason = null;
      let suggestedKind = null, suggestedKindReason = null;   // 1007：门卫分类建议（只建议不操作）
      if (!hits.length) {
        // 无相似：仍跑一次 judge，只为拿 worth / volatility（用户 1004-04 拍板：没有相似也跑）
        const jr = await runJudge(text, null, kindVal, opts);
        if (jr && jr.ok) {
          worth = jr.worth; worthReason = jr.worth_reason;
          volatility = jr.volatility; volatilityReason = jr.volatility_reason;
          suggestedKind = jr.suggested_kind || null; suggestedKindReason = jr.suggested_kind_reason || null;
          judgeNote = "judge(无相似):worth=" + fmtW(worth) + "/" + (volatility || "-");
        } else if (jr) judgeNote = "judge 失败(" + jr.error + ")";
      } else {
        for (const h of hits) {
          const jr = await runJudge(text, h.entry, kindVal, opts);
          const item = { id: h.entry.id, text: h.entry.text, kind: h.entry.kind,
                         score: h.score, lit: h.lit, sem: h.sem,
                         relation: null, relation_reason: null, judge_error: null };
          if (jr && jr.ok) {
            item.relation = jr.relation;
            item.relation_reason = jr.relation_reason;
            item.judge_confidence = jr.confidence;
            // worth/volatility 是「候选记忆本身」的属性，取第一条成功判定的即可（同一候选，多个对照）
            if (worth == null && jr.worth != null) { worth = jr.worth; worthReason = jr.worth_reason; volatility = jr.volatility; volatilityReason = jr.volatility_reason; }
            // 1007：分类建议同 worth 一样是候选本身属性，取第一条成功判定的
            if (suggestedKind == null && jr.suggested_kind) { suggestedKind = jr.suggested_kind; suggestedKindReason = jr.suggested_kind_reason || null; }
          } else if (jr) {
            item.judge_error = jr.error;
          }
          similarList.push(item);
        }
        judgeNote = "judge:" + similarList.length + "条相似("
          + similarList.map(x => x.relation || "?").join("/") + ")/worth=" + fmtW(worth);
      }
      /* [位置:memory/memory-admission.js·runJudgeStage 收尾] [恢复 judgeMeta 赋值 + 相似/低分入待审] [11-03 发现：1010-16 把 judge 阶段抽成 runJudgeStage 时，原来紧跟在 if/else 后面的 judgeMeta={worth,worth_reason,volatility,volatility_reason,similar,suggested_kind,suggested_kind_reason} 赋值和「命中相似一律 review / 无相似但 worth<0.35 交人工」两段被一起误删——此后 promotion（蒸馏产出）路径上门卫模型照跑照花钱，但结果全丢：待审卡 judge=null 没有值得记/过时/相似/分类建议，draft.worth 等评估标签也没入库。这里原样恢复（逻辑与 1010-16 之前逐字一致）；judgeTimedOut=超时降级后迟到的结果直接丢弃，不覆盖已降级的状态] [注释时间 2026-11-03] */
      if (judgeTimedOut) return;
      judgeMeta = { worth, worth_reason: worthReason, volatility, volatility_reason: volatilityReason,
                    similar: similarList,
                    suggested_kind: suggestedKind, suggested_kind_reason: suggestedKindReason };
      // 1004-04：命中相似一律进 review（不再 duplicate→reject、不再 coexist→admit、不再生成合并草稿）
      if (similarList.length) {
        action = "review";
        why = "命中 " + similarList.length + " 条相似记忆，交人工裁决（judge 不做自动决策）";
      } else if (worth != null && worth < 0.35) {
        // 无相似但 judge 判定"不值得记"：1004 起同样交人工（不自动 reject），只提示
        action = "review";
        why = "judge 判定值得记 " + fmtW(worth) + "（低），交人工裁决";
      }

      }
      const judgeRace = await Promise.race([
        runJudgeStage().then(function () { return "done"; }),
        new Promise(function (resolve) { setTimeout(function () { resolve("timeout"); }, JUDGE_TOTAL_TIMEOUT_MS); }),
      ]);
      if (judgeRace === "timeout") {
        judgeTimedOut = true;
        // 超时降级：强制入待审（judge 后台即使最终完成，其标注也已错过本次响应，直接丢弃）
        action = "review";
        why = "judge 判定超时（" + Math.round(JUDGE_TOTAL_TIMEOUT_MS / 1000) + "s），降级入待审人工裁决";
        judgeNote = "judge 超时，降级入待审";
        judgeMeta = null;
      }
    }
    if (isManualReviewGate && action === "admit") {
      // R7：promotion 来源首入一律人工把关（提炼是二次加工，judge/mock 认准也不自动入库）
      action = "review";
      why = why + " +R7(" + (isPromo ? "promotion" : "manual_review") + " 人工发起一律 review)";
    }

    // [5] state_executor（唯一写手）+ audit
    //     review 路径先落审计拿 audit_id（队列记录要回链）；admit/reject 执行后记最终动作
    const draft = {
      text,
      kind: kindVal,
      direction: mapped ? mapped.direction || null : null,
      speaker: speakerVal,
      origin: originVal,
      provenance,
    };
    // 0920：重要级（importance）设定整体删除，不再映射 confidence（两者语义不同轴，历史映射一并移除）
    if (b.established_at) draft.established_at = String(b.established_at);
    // 1002 第 4 项：schema 新字段透传（可选）。上游（蒸馏 / 老数据重跑 / 管理台）可带 triggers 等，
    // 校验交给 memory-v2._buildEntry，非法值明确报错而非静默丢弃。
    // 1005-16：schema v2 已删 source/scope/valid_from/valid_to/action_hint——不再透传（_buildEntry 对已删字段宽容忽略，传了也无害）。
    // 11-08 加 search_enabled（参与检索开关）。
    for (const k of ["sensitive", "triggers", "vibe", "worth", "search_enabled"]) {
      if (b[k] !== undefined) draft[k] = b[k];
    }
    // 1005-17：来源会话（蒸馏取证后 c.session 反查；独立字段供相关注入"本会话不重复注入"排除）
    if (strSafe(ctx.sessionId)) draft.source_session = strSafe(ctx.sessionId);
    // 1002 第 5 项：老数据重跑的动作元信息（{action,target_id,merge_ids,old_text,reason,evidence}）。
    // 只供待审队列展示「改前改后对照 / 由哪几条合并 / 为什么」——入库时 _buildEntry 忽略未知字段，不进 schema。
    if (b.backfill !== undefined) draft.backfill = b.backfill;
    // 1004-04：judge 的纯信息输出（worth/volatility/similar[]）。draft.judge 只供待审展示；
    // 1005-16：用户拍板评估标签入库（schema v2），worth 四字段随 draft 透传给 _buildEntry。
    if (judgeMeta) {
      draft.judge = judgeMeta;
      draft.worth = judgeMeta.worth;
      draft.worth_reason = judgeMeta.worth_reason;
      draft.volatility = judgeMeta.volatility;
      draft.volatility_reason = judgeMeta.volatility_reason;
    }

    let execResult, auditRec;
    if (action === "review") {
      auditRec = audit.append(audit.buildRecord({
        candidateText: text, origin: originVal, validator: validation, action: "review",
        notes: { shadow: !formal && !isPromo, kind: kindVal, why, judge: judgeNote,
                 judge_meta: judgeMeta ? { worth: judgeMeta.worth, volatility: judgeMeta.volatility, similar_count: (judgeMeta.similar || []).length } : null },
      }));
      execResult = exec.review(draft, why, {
        auditId: auditRec.ok ? auditRec.id : null,
        details: validation.reasons.concat(judgeNote ? [judgeNote] : []),
        merge: mergeDraft || null,
        judge: judgeMeta || null,
        // 1110：主队列通道 judge_status=pending 进攒批评分队列；shadow 保持同步评完的老行为
        judge_status: (formal || isManualReviewGate) ? (judgeMode === "off" ? "completed" : "pending") : undefined,
        source: formal ? "formal" : (isPromo ? "promotion" : (isManualReview ? "manual_review" : null)),
      });
    } else if (action === "admit") {
      execResult = exec.admit(draft);
      auditRec = audit.append(audit.buildRecord({
        candidateText: text, origin: originVal, validator: validation,
        action: execResult.ok ? "admit" : "error",
        notes: { shadow: !formal && !isPromo, kind: kindVal, why, judge: judgeNote, entry_id: execResult.entry ? execResult.entry.id : null, error: execResult.error || null },
      }));
    } else {
      execResult = exec.reject(draft, why);
      auditRec = audit.append(audit.buildRecord({
        candidateText: text, origin: originVal, validator: validation, action: "reject",
        notes: { shadow: !formal && !isPromo, kind: kindVal, why, judge: judgeNote },
      }));
    }

    return {
      action: execResult.ok ? action : "error",
      candidate: { text, kind: kindVal, provenance },
      validation,
      judge: judgeNote,
      judge_meta: judgeMeta || null,
      audit_id: auditRec.ok ? auditRec.id : null,
      entry_id: execResult.entry ? execResult.entry.id : null,
      queue_id: execResult.queue_id || null,
      mode: isPromo ? "promotion" : (isManualReview ? "manual_review" : (formal ? "formal" : "shadow")),
    };
  }

  // promotion 通道（0918）：压缩块原文提炼的候选入口，走完整流水线但 R7 强制 review。
  // 不受 v2_enabled/v2_shadow 门控——管理台按钮点击即人工授权，候选只进 review 队列，入库仍需人工 approve。
  function submitPromotion(body, ctx = {}) {
    return submitManual(body, ctx, "promotion");
  }

  // V2 门控（挂旧路由钩子用）：enabled → 正式；shadow → 观察；皆关 → 跳过
  function submitV2(body, ctx = {}) {
    if (cfg.v2_enabled === true) return submitManual(body, ctx, "formal");
    if (cfg.v2_shadow === true) return submitManual(body, ctx, "shadow");
    return { action: "skipped_v2_off", candidate: null, validation: null, audit_id: null };
  }

  // memory_add 专用快速通道：基础校验后先持久化待审记录，绝不走自动 admit/reject 决策。
  function submitMemoryAdd(body, ctx = {}) {
    const b = body || {};
    const text = strSafe(b.content || b.text);
    if (!text || !String(text).trim()) {
      return { action: "reject", candidate: null, validation: { allowed: false, matched_rules: ["V6"], reasons: ["V6 text 为空"] }, audit_id: null, notes: "content 为空" };
    }
    const cleanText = String(text).trim();
    const rawKind = strSafe(b.kind) || null;
    const kindVal = rawKind && ["fact", "rule", "event"].includes(rawKind) ? rawKind : null;
    const provenance = buildProvenance({ origin: "manual", method: "admin_form", sessionId: strSafe(ctx.sessionId), msgId: null, channel: "mcp_memory_add" });
    provenance.quote = cleanText.slice(0, 200);
    const validation = validate({ text: cleanText, kind: kindVal, origin: "manual", speaker: null, direction: null, provenance, source: "manual" });
    if (!validation.allowed) {
      const auditRec = audit.append(audit.buildRecord({ candidateText: cleanText, origin: "manual", validator: validation, action: "reject", notes: { source: "memory_add", why: "validator 硬规则命中" } }));
      return { action: "reject", candidate: { text: cleanText, kind: kindVal, provenance }, validation, audit_id: auditRec.ok ? auditRec.id : null };
    }
    if (cfg.v2_enabled !== true && cfg.v2_shadow !== true) {
      return { action: "skipped_v2_off", candidate: null, validation, audit_id: null };
    }
    const draft = { text: cleanText, kind: kindVal, direction: null, speaker: null, origin: "manual", provenance };
    if (Array.isArray(b.triggers) && b.triggers.length) draft.triggers = b.triggers.map((x) => String(x).trim().slice(0, 20)).filter(Boolean).slice(0, 3);   // 11-04：AI 存记忆时顺手写的关键词
    if (b.search_enabled !== undefined) draft.search_enabled = !!b.search_enabled;   // 11-08：AI 存记忆时显式带的参与检索开关（缺省由 _buildEntry 按 kind 取默认）
    if (strSafe(b.vibe)) draft.vibe = String(b.vibe).trim().slice(0, 60);   // 11-04：AI 存记忆时自带的气味/情感（可选；非 event 入库时 _buildEntry 自然忽略）
    if (strSafe(ctx.sessionId)) draft.source_session = strSafe(ctx.sessionId);
    const auditRec = audit.append(audit.buildRecord({ candidateText: cleanText, origin: "manual", validator: validation, action: "review", notes: { source: "memory_add", async_judge: true, kind: kindVal, why: "memory_add 快速入待审，门卫后台评分" } }));
    const execResult = mainExecutor.review(draft, "memory_add 已提交，门卫后台评分中；须人工审核", {
      auditId: auditRec.ok ? auditRec.id : null,
      details: validation.reasons.concat(["门卫评分排队中"]),
      judge_status: judgeMode === "off" ? "completed" : "pending",
      source: "memory_add",
    });
    if (!execResult.ok) return { action: "error", candidate: { text: cleanText, kind: kindVal, provenance }, validation, audit_id: auditRec.ok ? auditRec.id : null, error: execResult.error };
    if (judgeMode !== "off") scheduleJudgeWorker();
    return { action: "review", candidate: { text: cleanText, kind: kindVal, provenance }, validation, judge: "门卫后台评分中", judge_meta: null, audit_id: auditRec.ok ? auditRec.id : null, queue_id: execResult.queue_id, mode: "memory_add" };
  }

  const judgeJobsInFlight = new Set();
  let judgeWorkerTimer = null;
  let judgeWorkerRunning = false;
  /* [位置:memory/memory-admission.js·judgeExcludeIdsOf] [评分相似检索排除名单] [需求:11-10：回填 update/merge 的卡排除被替换旧条（新正文就是从它们改出来的），手动直通排除已入库条目自己（否则每张卡都「命中自己」）] [注释时间 2026-11-10] */
  function judgeExcludeIdsOf(rec) {
    const ids = [];
    const push = (v) => { const t = v == null ? "" : String(v).trim(); if (t && ids.indexOf(t) < 0) ids.push(t); };
    const d = (rec && rec.draft) || {};
    const bf = d.backfill;
    if (bf && typeof bf === "object") {
      if (Array.isArray(bf.merge_ids)) bf.merge_ids.forEach(push);
      push(bf.target_id);
    }
    push(d.entry_id);   // manual_direct：条目已入库，别把自己当相似
    return ids;
  }
  /* [位置:memory/memory-admission.js·settleManualDirectScore] [手动直通评分收尾] [需求:11-10：手动直通条已入库，评分只为补「值得记/会不会过时」标签——评完写回条目、评分卡移出队列（该卡不占待审列表，路由已按 source=manual_direct 过滤）] [注释时间 2026-11-10] */
  function settleManualDirectScore(rec, judge) {
    if (!rec || rec.source !== "manual_direct") return;
    const entryId = rec.draft && rec.draft.entry_id;
    try {
      if (entryId && judge && typeof judge === "object") {
        const patch = {};
        if (typeof judge.worth === "number" && Number.isFinite(judge.worth)) {
          patch.worth = Math.round(Math.max(0, Math.min(1, judge.worth)) * 100) / 100;
          patch.worth_reason = judge.worth_reason || null;
        }
        if (judge.volatility && ["stable", "volatile", "situational"].indexOf(judge.volatility) >= 0) {
          patch.volatility = judge.volatility;
          patch.volatility_reason = judge.volatility_reason || null;
        }
        if (Object.keys(patch).length) mainStore.updateFields(String(entryId), patch);
      }
    } catch (_) { /* 回写失败不影响评分卡移除 */ }
    try { mainExecutor.resolveQueue(rec.id, "reject_with_reason", { reason: "manual_direct 评分完成，标签已回写条目" }); } catch (_) {}
  }
  async function processMemoryAddJudge(rec) {
    if (!rec || !rec.id || judgeJobsInFlight.has(rec.id)) return;
    judgeJobsInFlight.add(rec.id);
    try {
      const attempt = (Number(rec.judge_attempts) || 0) + 1;
      const claimed = mainExecutor.updatePendingJudge(rec.id, { judge_status: "running", judge_attempts: attempt, judge_error: null });
      if (!claimed.ok) return;
      const current = claimed.record;
      const text = String(current.draft && current.draft.text || "");
      const kind = current.draft && current.draft.kind || null;
      let hits = [];
      let searchError = null;
      try { hits = await findSimilarExisting(mainStore, text, judgeExcludeIdsOf(current)); } catch (e) { searchError = (e && e.message) || String(e); }
      let worth = null, worthReason = null, volatility = null, volatilityReason = null;
      let suggestedKind = null, suggestedKindReason = null;
      const similar = [];
      if (!hits.length) {
        const jr = await runJudge(text, null, kind, opts);
        if (jr && jr.ok) {
          worth = jr.worth; worthReason = jr.worth_reason; volatility = jr.volatility; volatilityReason = jr.volatility_reason;
          suggestedKind = jr.suggested_kind || null; suggestedKindReason = jr.suggested_kind_reason || null;
        } else if (!searchError) searchError = jr && jr.error || "judge 无结果";
      } else {
        for (const h of hits) {
          const jr = await runJudge(text, h.entry, kind, opts);
          const item = { id: h.entry.id, text: h.entry.text, kind: h.entry.kind, score: h.score, lit: h.lit, sem: h.sem, relation: null, relation_reason: null, judge_error: null };
          if (jr && jr.ok) {
            item.relation = jr.relation; item.relation_reason = jr.relation_reason; item.judge_confidence = jr.confidence;
            if (worth == null && jr.worth != null) { worth = jr.worth; worthReason = jr.worth_reason; volatility = jr.volatility; volatilityReason = jr.volatility_reason; }
            if (suggestedKind == null && jr.suggested_kind) { suggestedKind = jr.suggested_kind; suggestedKindReason = jr.suggested_kind_reason || null; }
          } else {
            item.judge_error = jr && jr.error || "judge 无结果";
          }
          similar.push(item);
        }
        if (!similar.some(x => x.relation || x.judge_confidence != null) && !searchError) searchError = "所有相似项评分失败";
      }
      if (searchError && worth == null && similar.every(x => !x.relation)) {
        const retry = attempt < 3;
        mainExecutor.updatePendingJudge(rec.id, { expectedText: text, judge_status: "failed", judge_error: searchError, details: ["门卫评分失败（第" + attempt + "次）: " + searchError] });
        return;
      }
      const judge = { worth, worth_reason: worthReason, volatility, volatility_reason: volatilityReason, suggested_kind: suggestedKind, suggested_kind_reason: suggestedKindReason, similar };
      const details = ["门卫后台评分完成" + (similar.length ? "（相似项 " + similar.length + " 条）" : "（未找到相似项）")];
      if (searchError) details.push("评分存在部分错误: " + searchError);
      mainExecutor.updatePendingJudge(rec.id, { expectedText: text, judge_status: "completed", judge, judge_error: searchError, details });
      settleManualDirectScore(current, judge);   // 1110：手动直通评完回写条目并移卡
    } catch (e) {
      const attempt = Number(rec.judge_attempts) || 0;
      mainExecutor.updatePendingJudge(rec.id, { expectedText: String(rec.draft && rec.draft.text || ""), judge_status: "failed", judge_attempts: attempt + 1, judge_error: (e && e.message) || String(e), details: ["门卫后台任务异常"] });
    } finally {
      judgeJobsInFlight.delete(rec.id);
    }
  }
  /* [位置:memory/memory-admission.js·评分跑批日志] [名称:judge runs 文件 + 实时状态] [需求:11-11「入库模型跑了怎么没日志，不知道跑到哪了」——每批评分记一条（触发方式/条数/值得·不值得/降级/耗时/错误）落 data/memory_judge_runs.json 留最近 50 条，手动「立刻评一批」结束再记一条 summary 汇总；内存 judgeRunState 给设置页实时显示跑到第几批；每批往 pm2 日志打一行。文件跟 rootDir 走，测试 tmpDir 天然隔离] [注释时间 2026-11-11] */
  const RUNS_FILE = path.join(rootDir, "data", "memory_judge_runs.json");
  const judgeRunState = { running: false, run_id: null, trigger: null, batch_index: 0, batch_total: 0, scored: 0, items: 0, started_at: null };
  let judgeRunManualBusy = false;   // 「立刻评一批」防重入（连点 / 手动与自动同时跑）
  function loadJudgeRuns() {
    try { const j = fs.readJsonSync(RUNS_FILE); return Array.isArray(j && j.runs) ? j.runs : []; } catch (_) { return []; }
  }
  function appendJudgeRun(rec) {
    try {
      const runs = loadJudgeRuns(); runs.push(rec);
      fs.ensureDirSync(path.dirname(RUNS_FILE));
      fs.writeJsonSync(RUNS_FILE, { runs: runs.slice(-50) });
    } catch (_) { /* 日志写失败不影响评分主链路 */ }
  }
  function judgeRunId() { return "jr_" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }
  function judgeRunStateClear() { Object.assign(judgeRunState, { running: false, run_id: null, trigger: null, batch_index: 0, batch_total: 0, scored: 0, items: 0, started_at: null }); }
  function fmtDur(ms) { ms = Number(ms) || 0; return ms >= 60000 ? Math.floor(ms / 60000) + "分" + Math.round((ms % 60000) / 1000) + "秒" : Math.round(ms / 100) / 10 + "秒"; }
  function judgeRunLine(rec) {
    const trig = rec.trigger === "manual" ? "手动" : "自动";
    const head = rec.summary ? ("跑批完成 " + trig + " " + rec.batches + " 批 ") : ("批次 " + (rec.batch_index || 1) + "/" + (rec.batch_total || 1) + " " + trig + " ");
    return "[memory-judge] " + head + rec.items + " 条 · 值得记 " + (rec.worth || 0) + " · 不值得 " + (rec.not_worth || 0) +
      (rec.degraded ? " · 降级 " + rec.degraded : "") + " · " + fmtDur(rec.duration_ms) + (rec.error ? " · 错误: " + rec.error : "");
  }

  /* [位置:memory/memory-admission.js·judgeBatchSize] [攒批评分条数] [需求:11-08：门卫攒满一批再一起评，批数在设置里可调；每次重读 memory_v2_config.json——改完批数即时生效，不用等重启；缺省 30，上限 60] [注释时间 2026-11-08] */
  function judgeBatchSize() {
    let n = null;
    try {
      const fileCfg = readConfigFile(path.join(rootDir, "data", "memory_v2_config.json"));
      if (fileCfg && fileCfg.judge_batch_size != null) n = Number(fileCfg.judge_batch_size);
    } catch (_) { /* 配置读不到用闭包值 */ }
    if (n == null || !Number.isFinite(n) || n < 1) n = Number(cfg.judge_batch_size);
    if (!Number.isFinite(n) || n < 1) n = 30;
    return Math.floor(n);   // 1110 产品确定：60 上限去掉，自己调
  }

  /* [位置:memory/memory-admission.js·pendingJudgeJobs] [评分队列扩面] [需求:11-10：所有进待审的候选都排队等门卫评——不再只数 memory_add，蒸馏/压缩块解析/回填 update+merge/手动直通的评分任务全在队列里攒批] [注释时间 2026-11-10] */
  function pendingJudgeJobs() {
    return mainExecutor.listQueue("pending_review")
      .filter(q => ["pending", "running", "failed"].includes(q.judge_status) && (Number(q.judge_attempts) || 0) < 3)
      .filter(q => !(q.judge_status === "failed" && q.judge_updated_at && Date.now() - new Date(q.judge_updated_at).getTime() < 30000))
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));   // 老到新：先来的先评
  }

  /* [位置:memory/memory-admission.js·processMemoryAddJudgeBatch] [门卫攒批评分] [需求:11-08：门卫逐条评分费 token 又慢（每条对每条相似记忆各调一次模型），改为攒满一批 → 相似检索仍逐条本地算，LLM 判定合并成一次调用批量出结果；整批解析失败自动降级回逐条老链路不丢数据；批量输出里缺哪条的索引就只补跑那一条] [11-11 加跑批日志：runCtx 带 run_id/触发方式/批号，每批落 runs 文件 + pm2 一行；返回值加 worth/not_worth 供汇总] [注释时间 2026-11-11] */
  async function processMemoryAddJudgeBatch(jobs, runCtx = null) {
    const items = [];
    for (const rec of jobs) {
      if (!rec || !rec.id || judgeJobsInFlight.has(rec.id)) continue;
      const attempt = (Number(rec.judge_attempts) || 0) + 1;
      const claimed = mainExecutor.updatePendingJudge(rec.id, { judge_status: "running", judge_attempts: attempt, judge_error: null });
      if (!claimed.ok) continue;
      judgeJobsInFlight.add(rec.id);
      const text = String(claimed.record.draft && claimed.record.draft.text || "");
      const kind = (claimed.record.draft && claimed.record.draft.kind) || null;
      const excludeIds = judgeExcludeIdsOf(rec);
      let hits = [], searchError = null;
      try { hits = await findSimilarExisting(mainStore, text, excludeIds); } catch (e) { searchError = (e && e.message) || String(e); }
      items.push({ rec, text, kind, hits, searchError });
    }
    if (!items.length) return { ok: true, batch: 0, degraded: 0, worth: 0, not_worth: 0 };
    const t0 = Date.now();

    let parsed = { ok: false, error: "未调用" };
    try {
      const prompt = buildBatchPrompt(items.map(function (it) {
        return { text: it.text, kind: it.kind, similar: it.hits.map(function (h) { return { text: h.entry.text, kind: h.entry.kind }; }) };
      }));
      // 测试可经 opts.callLLM 注入实现（与单条 runJudge 同款）；生产走 defaultCallLLM（批量放宽超时/max_tokens）
      const raw = (typeof opts.callLLM === "function")
        ? await opts.callLLM(prompt, 1)
        : await defaultCallLLM(prompt, { timeoutMs: 120000, maxTokens: Math.min(16384, 2048 + items.length * 320) });
      parsed = parseBatchOutput(raw, items.length);
    } catch (e) {
      parsed = { ok: false, error: String((e && e.message) || e) };
    }

    const fallback = [];
    if (parsed.ok) {
      items.forEach(function (it, i) {
        const r0 = parsed.results[i];
        if (!r0) { fallback.push(it.rec); return; }
        const judge = { worth: r0.worth, worth_reason: r0.worth_reason, volatility: r0.volatility, volatility_reason: r0.volatility_reason,
                        suggested_kind: r0.suggested_kind, suggested_kind_reason: r0.suggested_kind_reason,
                        similar: it.hits.map(function (h, k) {
                          const rr = (r0.similar || []).filter(function (m) { return m && m.sim_index === k + 1; })[0] || null;
                          return { id: h.entry.id, text: h.entry.text, kind: h.entry.kind, score: h.score, lit: h.lit, sem: h.sem,
                                   relation: rr ? rr.relation : null, relation_reason: rr ? rr.relation_reason : null,
                                   judge_confidence: (rr && rr.confidence != null) ? rr.confidence : undefined,
                                   judge_error: rr ? null : "批量输出缺这条关系" };
                        }) };
        const failedLike = it.searchError && judge.worth == null && judge.similar.every(x => !x.relation);
        const details = ["门卫批量评分完成（" + items.length + " 条一批）" + (judge.similar.length ? "（相似项 " + judge.similar.length + " 条）" : "（未找到相似项）")];
        if (it.searchError) details.push("评分存在部分错误: " + it.searchError);
        mainExecutor.updatePendingJudge(it.rec.id, {
          expectedText: it.text,
          judge_status: failedLike ? "failed" : "completed",
          judge: failedLike ? undefined : judge,
          judge_error: it.searchError,
          details,
        });
        if (!failedLike) settleManualDirectScore(it.rec, judge);   // 1110：手动直通评完回写条目并移卡
      });
    } else {
      // 整批失败（调用抛错 / 输出完全无法解析）：全部退回逐条老链路，评分不丢
      fallback.push.apply(fallback, items.map(function (it) { return it.rec; }));
    }
    for (const rec of fallback) {
      judgeJobsInFlight.delete(rec.id);   // 逐条路径自己管理 in-flight，先摘掉否则会被跳过
      await processMemoryAddJudge(rec);
    }
    // 11-11 跑批日志：worth 是 0-1 数值（parseBatchOutput 同单条口径），≥0.5 算值得记、<0.5 算不值得、null 不数；缺索引降级逐条的记在 degraded 里。每批一条落 runs 文件 + pm2 一行
    const worthN = parsed.ok ? items.filter((it, i) => { const r0 = parsed.results[i]; return r0 && r0.worth != null && Number(r0.worth) >= 0.5; }).length : 0;
    const notWorthN = parsed.ok ? items.filter((it, i) => { const r0 = parsed.results[i]; return r0 && r0.worth != null && Number(r0.worth) < 0.5; }).length : 0;
    const runRec = {
      id: ((runCtx && runCtx.run_id) || judgeRunId()) + "-b" + (runCtx ? runCtx.batch_index : 1),
      run_id: runCtx ? runCtx.run_id : null,
      ts: new Date().toISOString(),
      trigger: runCtx ? runCtx.trigger : "auto",
      batch_index: runCtx ? runCtx.batch_index : 1, batch_total: runCtx ? runCtx.batch_total : 1,
      items: items.length, worth: worthN, not_worth: notWorthN, degraded: fallback.length,
      ok: !!parsed.ok, error: parsed.ok ? null : String(parsed.error || "").slice(0, 200),
      duration_ms: Date.now() - t0,
    };
    if (runCtx) judgeRunState.scored += items.length;
    appendJudgeRun(runRec);
    console.log(judgeRunLine(runRec));
    return { ok: parsed.ok, batch: items.length, degraded: fallback.length, worth: worthN, not_worth: notWorthN, error: parsed.ok ? null : parsed.error };
  }

  async function runMemoryAddJudgeWorker() {
    if (judgeWorkerRunning || judgeMode === "off") return;
    judgeWorkerRunning = true;
    try {
      const jobs = pendingJudgeJobs();
      const batchSize = judgeBatchSize();
      // 11-08：llm 模式攒满一批才跑（不满一直攒，等「立刻评一批」或攒满）；mock 本地出结果照旧逐条不攒
      if (judgeMode === "llm" && jobs.length >= batchSize) {
        // 11-11：自动触发也进跑批日志与实时状态（runs 文件 + 设置页「评着呢」），出错也要把 running 状态放掉
        const chunk = jobs.slice(0, batchSize);
        const rid = judgeRunId();
        Object.assign(judgeRunState, { running: true, run_id: rid, trigger: "auto", batch_index: 1, batch_total: 1, scored: 0, items: chunk.length, started_at: new Date().toISOString() });
        try { await processMemoryAddJudgeBatch(chunk, { run_id: rid, trigger: "auto", batch_index: 1, batch_total: 1 }); }
        finally { if (judgeRunState.trigger === "auto") judgeRunStateClear(); }
      } else if (judgeMode !== "llm") {
        for (const job of jobs) await processMemoryAddJudge(job);
      }
    } catch (e) {
      console.error("[memory-add-judge] worker error:", (e && e.message) || e);
    } finally { judgeWorkerRunning = false; }
  }

  /* [位置:memory/memory-admission.js·runJudgeBatchNow] [立刻评一批] [需求:11-08：攒不满也等不及的话，设置页「立刻评一批」把当前攒着的全部评掉（超一批的按批数循环跑完）] [11-11 改：触发即返回 {started:true}，进度走 judgeRunState + GET /admin/memory-judge/runs 轮询——以前是一次 HTTP 请求挂到跑完，手机锁屏/断网前端就显示「没跑起来」，后台其实还在跑；结束记一条 summary 汇总进 runs；手动跑期间拉起 judgeWorkerRunning 防自动 worker 并发评分；正在跑时再点直接回 {running:true}] [注释时间 2026-11-11] */
  async function runJudgeBatchNow() {
    if (judgeRunManualBusy || judgeRunState.running) return { ok: false, running: true, note: "已经在评分了" };
    const jobs = pendingJudgeJobs();
    if (!jobs.length) return { ok: true, batches: 0, processed: 0, note: "没有攒着的评分任务" };
    judgeRunManualBusy = true;
    judgeWorkerRunning = true;   // 手动跑期间自动 worker 别插进来（两批并发打 LLM）
    const rid = judgeRunId(), size = judgeBatchSize(), total = Math.ceil(jobs.length / size);
    const t0 = Date.now();
    Object.assign(judgeRunState, { running: true, run_id: rid, trigger: "manual", batch_index: 0, batch_total: total, scored: 0, items: jobs.length, started_at: new Date().toISOString() });
    let processed = 0, batches = 0, degraded = 0, worthN = 0, notWorthN = 0, lastError = null;
    async function runAll() {
      try {
        for (let i = 0; i < jobs.length; i += size) {
          const chunk = jobs.slice(i, i + size);
          judgeRunState.batch_index = batches + 1;
          let r;
          if (judgeMode === "llm") r = await processMemoryAddJudgeBatch(chunk, { run_id: rid, trigger: "manual", batch_index: batches + 1, batch_total: total });
          else { for (const rec of chunk) await processMemoryAddJudge(rec); r = { ok: true, degraded: 0, worth: 0, not_worth: 0 }; }
          processed += chunk.length; batches++;
          judgeRunState.scored = processed;
          if (r && r.degraded) degraded += r.degraded;
          if (r) { worthN += r.worth || 0; notWorthN += r.not_worth || 0; }
          if (r && !r.ok) lastError = r.error || "批量评分失败（已逐条降级）";
        }
        const summary = { id: rid + "-s", run_id: rid, summary: true, ts: new Date().toISOString(), trigger: "manual",
          batches, items: processed, worth: worthN, not_worth: notWorthN, degraded, ok: !lastError,
          error: lastError ? String(lastError).slice(0, 200) : null, duration_ms: Date.now() - t0 };
        appendJudgeRun(summary);
        console.log(judgeRunLine(summary));
        return { ok: true, batches, processed, degraded, worth: worthN, not_worth: notWorthN, last_error: lastError };
      } finally {
        judgeRunManualBusy = false;
        judgeWorkerRunning = false;
        judgeRunStateClear();
      }
    }
    // done promise：编程/测试侧可 await 等整轮跑完；HTTP 路由只挑字段返回，前端靠轮询 runs 收尾
    return { ok: true, started: true, batches: total, items: jobs.length, done: runAll() };
  }

  function judgeBatchStats() {
    return { pending: pendingJudgeJobs().length, batch_size: judgeBatchSize(), judge_mode: judgeMode,
      running: judgeRunState.running ? { trigger: judgeRunState.trigger, batch_index: judgeRunState.batch_index,
        batch_total: judgeRunState.batch_total, scored: judgeRunState.scored, items: judgeRunState.items,
        started_at: judgeRunState.started_at } : null };
  }

  /* [位置:memory/memory-admission.js·judgeRunsInfo] [评分日志查询] [需求:11-11：设置页「评分日志」子页和实时进度——返回当前跑批状态 + 最近 50 条跑批记录（新→旧，GET /admin/memory-judge/runs 用）] [注释时间 2026-11-11] */
  function judgeRunsInfo() {
    return { batch: judgeBatchStats(), runs: loadJudgeRuns().slice().reverse() };
  }

  function scheduleJudgeWorker() {
    if (judgeWorkerTimer) return;
    judgeWorkerTimer = setInterval(runMemoryAddJudgeWorker, 2000);
    if (judgeWorkerTimer.unref) judgeWorkerTimer.unref();
    // 尽快启动，但不阻塞当前工具/API 响应。
    setImmediate(runMemoryAddJudgeWorker);
  }

  // 1002-09 待审草稿编辑（review 路由用）：改 draft 不裁决，动作进审计
  function editQueue(queueId, patch = {}) {
    const r = mainExecutor.editQueue(queueId, patch);
    if (r.ok) {
      audit.append(audit.buildRecord({
        candidateText: r.draft && r.draft.text ? r.draft.text : "",
        origin: "manual",
        action: "review_edited",
        notes: { queue_id: queueId, fields: r.fields || null },
      }));
    }
    return r;
  }

  /* [位置:memory/memory-admission.js·enqueueManualScore] [手动直通条目排队评分] [需求:11-10「各种新增记忆都门卫评分」——手机手写的条直通入库后不再单独静默评（scoreEntry 已删），统一塞一条 source=manual_direct 的评分任务进攒批队列，带相似检索、批内一起评；评完 settleManualDirectScore 回写 worth/volatility 并移卡；该卡不占待审列表（路由过滤），绝不影响入库结果] [注释时间 2026-11-10] */
  function enqueueManualScore(entry) {
    try {
      if (!entry || !entry.id) return false;
      const e = mainStore.get(String(entry.id)) || entry;
      if (e.worth != null && e.volatility != null) return true;   // 已有完整标签的不重评（原 scoreEntry 同口径）
      const draft = {
        text: String(e.text || "").trim(),
        kind: e.kind || null,
        direction: null,
        speaker: null,
        origin: "manual",
        provenance: e.provenance || null,
        entry_id: String(e.id),
      };
      if (!draft.text) return false;
      const auditRec = audit.append(audit.buildRecord({ candidateText: draft.text, origin: "manual", action: "review", notes: { source: "manual_direct", why: "手动直通入库，排队攒批评分" } }));
      mainExecutor.review(draft, "手动直通条目排队评分（不占待审列表）", {
        auditId: auditRec.ok ? auditRec.id : null,
        details: ["手动直通入库后的补评分任务"],
        judge_status: judgeMode === "off" ? "completed" : "pending",
        source: "manual_direct",
      });
      if (judgeMode !== "off") scheduleJudgeWorker();
      return true;
    } catch (_) { return false; }
  }

  /* [位置:memory/memory-admission.js·checkSimilar] [手动新增前的查重] [需求:11-06：手写记忆前若池里已经有一条很像的，先提示一句（不硬拦）；用余弦/词面取高的口径，跟「相似的放一起看」同一个阈值 0.85] [注释时间 2026-11-06] */
  async function checkSimilar(text, minScore) {
    const q = String(text || "").trim();
    const gate = Number.isFinite(minScore) ? minScore : 0.85;
    if (!q) return [];
    try {
      const rows = mainStore.list({ status: "active" });
      if (!rows.length) return [];
      const vectors = require("./memory-v2-vectors");
      const rs = await vectors.relevantScores(rows, q);
      const semById = rs && rs.ok ? rs.scores : null;
      const { tokenize, similarity } = require("../context/context-v2-adapter");
      const qt = tokenize(normalizeText(q));
      const out = [];
      for (const e of rows) {
        const sem = semById ? (semById[e.id] || 0) : 0;
        const lit = similarity(qt, normalizeText(e.text));
        const score = Math.round(Math.max(sem, lit) * 1000) / 1000;
        if (score >= gate) out.push({ id: e.id, text: e.text, kind: e.kind, score: score });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, 3);
    } catch (_) { return []; }
  }

  // 人工裁决回流（review 路由用）：裁决动作本身也进审计
  function resolveReview(queueId, decision, opts2 = {}) {
    const r = mainExecutor.resolveQueue(queueId, decision, opts2);
    const candidateText = r.resolved && r.resolved.draft ? r.resolved.draft.text : "";
    audit.append(audit.buildRecord({
      candidateText,
      origin: "manual",
      action: r.ok ? (decision === "approve" ? "review_approved" : "review_rejected") : "error",
      notes: { queue_id: queueId, decision, note: strSafe(opts2.note), error: r.error || null },
    }));
    return r;
  }

  return {
    cfg,
    shadowOn,
    judgeMode,
    submitManual,
    submitPromotion,
    submitV2,
    submitMemoryAdd,
    enqueueManualScore,
    checkSimilar,
    runMemoryAddJudgeWorker,
    runJudgeBatchNow,
    judgeBatchStats,
    judgeRunsInfo,
    stopMemoryAddJudgeWorker: () => { if (judgeWorkerTimer) clearInterval(judgeWorkerTimer); judgeWorkerTimer = null; },
    resolveReview,
    editQueue,
    executor: shadowExecutor,
    executorMain: mainExecutor,
    audit,
    paths: { main: mainStore.paths, shadow: shadowStore.paths },
    // 1002 第 4 项：检索命中打点（评估用）。两个集合都打（影子库命中同样计），
    // 复用本实例持有的 store（不新建），避免多实例并发写覆盖。
    markHit: (ids) => {
      try {
        // 1005-17：命中 event 时 worth +0.05（封顶 0.95）——"注入次数多，百分比增加一点"
        const arr = Array.isArray(ids) ? ids : [ids];
        for (const id of arr) {
          const e = mainStore.get(String(id));
          if (e && e.kind === "event" && e.status === "active" && typeof e.worth === "number") {
            mainStore.updateFields(String(id), { worth: Math.min(0.95, Math.round((e.worth + 0.05) * 100) / 100) });
          }
        }
        return (mainStore.markHit(ids) || 0) + (shadowStore.markHit(ids) || 0);
      }
      catch (_) { return 0; }
    },
    // 1005-17：event 衰减扫描——自 last_decay_at（无则 last_hit_at/created_at）起每天 -0.01；
    // 跌破 0.2 → 归档（updateStatus archived）+ 进待审（mainExecutor.review，人工决定保留/删除）。
    // 幂等：每次衰减后 last_decay_at 置 now，重复调用不会重复扣。
    decayEvents: () => {
      try {
        const rows = mainStore.list({ kind: "event", status: "active" });
        const now = Date.now();
        let decayed = 0, moved = 0;
        for (const e of rows) {
          const base = e.last_decay_at || e.last_hit_at || e.created_at;
          const t0 = base ? new Date(base).getTime() : 0;
          if (!(t0 > 0)) continue;
          const days = (now - t0) / 86400000;
          if (days < 1) continue;
          if (typeof e.worth !== "number") continue; // 未评估的 event 不衰减（等重跑/评估补 worth）
          const next = Math.max(0, Math.round((e.worth - 0.01 * days) * 100) / 100);
          if (next >= 0.2) {
            mainStore.updateFields(e.id, { worth: next, last_decay_at: new Date(now).toISOString() });
            decayed++;
          } else {
            mainStore.updateStatus(e.id, "archived", { reason: "event 衰减至 " + Math.round(next * 100) + "%" });
            mainExecutor.review({
              text: e.text, kind: e.kind,
              worth: next,
              provenance: e.provenance || null,
              backfill: { action: "decay", target_id: e.id, old_text: e.text, reason: "event 长期未注入，衰减至 20% 以下，待人工决定保留/删除" },
            }, "event 衰减到 20% 以下", { details: ["decayEvents"] });
            moved++;
          }
        }
        return { decayed, moved };
      } catch (_) { return { decayed: 0, moved: 0 }; }
    },
  };
  _lastAdmission = inst; // 模块级缓存最新实例：tag-parser 等轻量写者复用 executorMain（唯一写手）
  // 启动时恢复上次进程退出前尚未完成的 memory_add 门卫任务。
  if (judgeMode !== "off") scheduleJudgeWorker();
  return inst;
}

// 1004-04：safeMerged 已随「judge 不再生成合并文本」整体下线——合并改为人工在待审页对照决定。
// （原 0928 逻辑：LLM 合并产物安检，隐私命中/超长即丢弃。现零调用，删除避免误当活代码。）

function decide(validation) {
  // 1007：detector 已移除，不再有"非候选"概念——只有 validator 硬规则能自动拒
  if (!validation.allowed) return { action: "reject", why: "validator 硬规则命中: " + validation.matched_rules.join("/") };
  return { action: "admit", why: "校验通过" };
}

function strSafe(v) { return v == null ? null : String(v); }

let _lastAdmission = null;
function getAdmission() { return _lastAdmission; }
module.exports = { createAdmission, getAdmission };
