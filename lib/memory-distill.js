'use strict';
// 记忆蒸馏调度器（2026-10-02 记忆系统改造 §8 第 3 项：后台蒸馏管线）
// 数据：data/memory_distill_config.json { enabled, time, batch_size, last_run_at, last_run_result }
//       data/memory_distill_state.json  { done:{relPath:iso}, lastBatch:[], lastBatchAt, batches, lastSummary }
// 调度：每 30s 对表一次，跨过设定时刻（且当天没跑过）即触发；进程重启有 30 分钟补跑宽限窗。
// 手动：runNow() 不受 enabled 约束（开关关着也能手动跑一次）。
// 单飞：running 标志，同一时刻只允许一个蒸馏在跑。
// 选材：当天全部对话原文（lib/day-source.js，1004 起），排除 smoke-* 测试会话、已归档/已删除会话、
//       子会话 s_sub_* 与「不参与检索」会话组（1108-2 起与 AI 检索口径对齐）；★ 留纸 papers/ 不参与。
// 进度：state.done 记录已蒸馏的日期；★ 11-13 起只在候选真的进待审之后才写（markDone），跑批中途挂了不会有「已标记但没产出」的天，下次自动重跑。
// 取证：3.3 预取 = ①按日记日期定位当天原文（timePrefix，主通道）②按日记正文语义补检索（兜底），
//       两路合并去重后与日记一起打包；★ 只有日记是 AI 加工过一次的，取证强制回原文（3.5）。
// 施工进度：3.1 配置+调度+UI ✅；3.2 分批器 ✅；3.3 预取+打包（本版）；3.4 抽取 LLM；3.5 取证；3.6 落待审。

const fs = require("fs-extra");
const path = require("path");
const timeUtils = require("../utils/time_utils");
const llmLog = require("./llm_log");
// 1004：选材从「日记」切到「当天全部对话原文」，按天读取的基建
const daySource = require("./day-source");
/* [位置:lib/memory-distill.js·require] [去掉无效的 readJsonSafe 引入] [11-14 审查 B 批 b：这里原本从 http_json 解构 readJsonSafe，但本模块 165 行又定义了一个同名局部函数——函数声明提升，局部的永远胜出，这个引入从未生效，只会让人误以为走的是 http_json 那版（那版解析失败静默返回空、不留痕）。改成本地版自带损坏留证，引入一并删掉] [注释时间 2026-11-14] */
const { httpPostJson, pad2, makeNormalizeTime, EVIDENCE_SKIP_PATTERNS } = require("./http_json");
// 11-14 审查 B 批 b：本模块配置/进度/提示词/运行日志/笔记快照五处原为 fs.writeJsonSync 裸写，
// 被 pm2 重启或 SIGINT 打断会留半截 JSON，读时静默当空（354 天已蒸记录全丢、自定义提示词无声回退默认）。
// 统一接项目原子写（conversation-state.js 10-29 审查 P0 后已在用）。
const { writeJsonAtomic } = require("../utils/json_atomic");

const DEFAULT_CONFIG = {
  enabled: false,
  time: "03:00",
  // 1004：语义从「每次几篇日记」改为「每次几天」；一天 = 一次 LLM 调用
  batch_size: 1,
  last_run_at: null,
  last_run_result: null,
};

const CHECK_MS = 30000;          // 对表间隔
const CATCHUP_WINDOW_MS = 30 * 60 * 1000; // 重启补跑宽限窗：该时刻过去 30 分钟内重启才补跑
const EXCLUDE_SESSION_PREFIX = ["smoke-"]; // 测试会话不蒸馏

// 3.3 预取参数
const EVIDENCE_TIME_LIMIT = 25;    // 按日期定位：单篇日记最多取当天 25 条原文
const EVIDENCE_MAX_CHARS = 6000;   // 单篇日记打包的原文字符上限（防单批撑爆 LLM 上下文）
// 取证一致性阈值：msg_id 对上不等于语义对上，证据原文须真的包含该条记忆的内容（二元组重合率）
// 0.10 是实测调出来的：真规则（「23:50 Bark 提醒就去睡」vs 原文「你给我搞个定时bark好吧哥哥」）
// 重合率仅 12%，而假证据（「喜欢黑胡椒清汤面」vs 原文「嘴唇贴着你的发顶」）是 0%——阈值卡在中间
const EVIDENCE_MIN_RATIO = 0.25;
// 二段检索弱确认阈值（候选文本整体去检索，重合要求更高）
const EVIDENCE_WEAK_RATIO = 0.25;
const PACK_FILE = "memory_distill_last_pack.txt"; // 最近一批的打包文本（排障用，覆盖写）

// 1003 用户拍板：日记是 AI 第一人称自己写的，它落笔时心里有当时的场景，
// 我们按「日期 + 正文前 300 字」预取的原文未必对得上它那句「我记得那天……」。
// 所以给蒸馏也装上「模型自提检索」——与老数据重跑 memory-backfill 同款机制：
// 模型在 JSON 里写 {"search":[{"diary":1,"query":"..."}]}，系统代跑、把原文回灌，它再判断。
// （不是真 tools：蒸馏走 response_format:json_object，跟 function calling 在上游常互斥）
// 上限只防模型死循环（它可以每轮都提检索、永远不出结论），不防上游——与 backfill 保持一致
const SEARCH_ROUNDS = 4;            // 模型最多能提几轮补充检索
const SEARCH_MAX_PER_ROUND = 20;    // 每轮最多受理几条检索请求（多提的静默丢弃）
const SEARCH_LIMIT_PER_QUERY = 8;   // 每次检索返回条数上限

// 日记目录候选（按顺序探测）：写死单个路径，目录一改名就静默空跑
const DIARY_DIR_CANDIDATES = ["diary", path.join("data", "diary_legacy"), path.join("little-world", "apps", "han-diary")];  // 1018-13：diary_legacy 搬进 data/
function pickDiaryDir(base) {
  for (const c of DIARY_DIR_CANDIDATES) {
    const p = path.join(base, c);
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return path.join(base, DIARY_DIR_CANDIDATES[0]);
}

// 单次 LLM 调用超时（与 nginx 读超时 620s 对齐）
// 1004：600s 是按 glm-5.3-flash 的速度定的（12 分钟吃 1.5 万字）。
// 选材改成「一整天原文」后体量上到 2–6 万字，600s 必然撞墙；放宽到 1800s。
// （本请求是服务端直连上游 provider，不经本机 nginx，所以 nginx 的 620s/300s 与它无关）
const LLM_TIMEOUT_MS = 1800000;
// 单条原文截断阈值（超过就截断并提示模型提检索看全文）
const DAY_MAX_MSG_CHARS = 2000;
// 工具返回结果单条截断阈值（1110-2：用户「蒸馏上下文要包括工具记录，完整的」——只留每条限制，不做每日预算；截断只影响模型看到的行，取证索引存全文）
const TOOL_RESULT_MAX_CHARS = 3000;
// 输出预算自动升级：与旧压缩系统（context-compactor.js）同款手法——
// 带推理的模型（MiniMax-M3 / glm 思考版）思考 token 也算进 max_tokens，
// 给少了会把正文/JSON 直接截断（finish_reason=length）。先给 16000，截断就加到 32000、50000。
const LLM_OUTPUT_BUDGETS = [16000, 32000, 50000];

// 用 http/https 模块发 JSON POST——绕开全局 fetch 底层 undici 的 300s headersTimeout。
// 那个超时不可配，长 prompt 场景会莫名其妙地 fetch failed（实跑踩过）。


const normalizeTime = makeNormalizeTime(DEFAULT_CONFIG.time);

function normalizeBatch(raw) {
  const n = Number(raw);
  if (!isFinite(n)) return DEFAULT_CONFIG.batch_size;
  return Math.min(20, Math.max(1, Math.round(n)));
}

// 日记文件名 → 排序键：日期 + 时间（无时间补 000000），保证跨会话按时间线混排
function sortKeyOf(relPath) {
  const base = String(path.basename(relPath) || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[_-](\d{2})(\d{2})(?:(\d{2}))?)?/.exec(base);
  if (!m) return "9999-99-99_000000_" + relPath;
  const date = m[1] + "-" + m[2] + "-" + m[3];
  const time = (m[4] || "00") + (m[5] || "00") + (m[6] || "00");
  return date + "_" + time + "_" + relPath;
}

function dateKeyOf(relPath) {
  const base = String(path.basename(relPath) || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(base);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
}

module.exports = function createMemoryDistill(deps) {
  const opts = deps || {};
  const baseDir = opts.baseDir || path.resolve(__dirname, "..");
  // 1003：日记目录被改名过（diary → diary_legacy），模块写死旧路径会静默空跑——
  // 104 篇日记躺了很久没被蒸馏。改成自动探测，找不到就大声报错，不再假装没事。
  const diaryDir = opts.diaryDir || pickDiaryDir(baseDir);
  const CFG_FILE = path.join(baseDir, "data", "memory_distill_config.json");
  const STATE_FILE = path.join(baseDir, "data", "memory_distill_state.json");
  const PROMPT_FILE = path.join(baseDir, "data", "memory_distill_prompt.json");
  const PACK_PATH = path.join(baseDir, "data", PACK_FILE);
  const TZ = timeUtils.resolveTimeZone();
  const addLog = typeof opts.addCompactionLog === "function" ? opts.addCompactionLog : null;
  const persistLog = typeof opts.persistCompactionLogs === "function" ? opts.persistCompactionLogs : null;
  const searchContext = typeof opts.searchContext === "function" ? opts.searchContext : null;
  const lookupMessage = typeof opts.lookupMessage === "function" ? opts.lookupMessage : null;   // 11-08：按 evidence uuid 直捞时间线原文（补抓拍出处用）
  const admission = opts.admission || null;   // 3.6 落待审用（Memory V2 admission 单例）

  const state = {
    timer: null,
    running: false,
    startedAt: null,
    lastTrigger: null,   // manual | schedule | catchup
    lastError: null,
    runs: 0,
  };

  function logErr(msg) { console.error("[memory-distill] " + msg); }
  function logInfo(msg) { console.log("[memory-distill] " + msg); }
  function logWarn(msg) { console.warn("[memory-distill] " + msg); }

  function noteLog(action, label, status, message) {
    if (!addLog) return null;
    try {
      const entry = addLog({ action: action, label: label, status: status, message: message });
      if (persistLog) { try { persistLog(); } catch (e) {} }
      return entry || null;
    } catch (e) { return null; }
  }

  /* [位置:lib/memory-distill.js·蒸馏运行日志] [名称:memory_distill_runs 文件 + runsInfo] [需求:11-12「这两个。加记录日志之类的」——每次蒸馏（对话/笔记，成功/失败）记一条（触发方式/天数/一句人话摘要/耗时/错误）落 data/memory_distill_runs.json 留最近 50 条，GET /admin/memory-distill/runs 给设置页「运行日志」子页轮询；同款先例 memory/memory-admission.js 的 memory_judge_runs.json。appendRun 静默失败，不影响蒸馏主链路] [注释时间 2026-11-12] */
  const RUNS_FILE = path.join(baseDir, "data", "memory_distill_runs.json");
  function runId() { return "dr_" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }
  function loadRuns() {
    try { const j = fs.readJsonSync(RUNS_FILE); return Array.isArray(j && j.runs) ? j.runs : []; } catch (_) { return []; }
  }
  function appendRun(rec) {
    try {
      const runs = loadRuns(); runs.push(rec);
      /* [位置:lib/memory-distill.js·appendRun] [运行日志原子写] [11-14 审查 B 批 b：裸写被打断会留半截 JSON，设置页「运行日志」直接读不出历史；改原子写，失败仍然不影响蒸馏主链路] [注释时间 2026-11-14] */
      writeJsonAtomic(RUNS_FILE, { runs: runs.slice(-50) });
    } catch (_) { /* 日志写失败不影响蒸馏主链路 */ }
  }
  function runsInfo() {
    return { running: !!state.running, kind: state.runningKind || "dialog", trigger: state.lastTrigger || null, started_at: state.startedAt || null, runs: loadRuns().slice().reverse() };
  }

  /* [位置:lib/memory-distill.js·readJsonSafe] [解析失败留证不静默] [11-14 审查 B 批 b：原来任何解析失败都直接返回空对象、磁盘不留痕：半截 JSON 会让 354 天已蒸记录集体消失、last_run_at 丢了还会在 30 分钟窗口内再补跑一次。现在照 conversation-state.js:162-184 的做法先存一份 .corrupt-<时间> 副本再告警，仍返回 fallback 保证服务可用] [注释时间 2026-11-14] */
  function readJsonSafe(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback || {};
      const raw = fs.readJsonSync(file);
      return raw && typeof raw === "object" ? raw : (fallback || {});
    } catch (e) {
      try {
        if (fs.existsSync(file)) {
          const corrupt = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
          fs.copyFileSync(file, corrupt);
          console.error("[memory-distill] 文件解析失败，已留存损坏副本: " + corrupt + " | 原因: " + (e && e.message ? e.message : String(e)));
        }
      } catch (e2) {
        console.error("[memory-distill] 损坏副本留存失败: " + (e2 && e2.message ? e2.message : String(e2)));
      }
      return fallback || {};
    }
  }

  // ---------------- 配置 ----------------
  function readConfig() {
    const c = readJsonSafe(CFG_FILE, {});
    return {
      enabled: !!c.enabled,
      time: normalizeTime(c.time),
      batch_size: normalizeBatch(c.batch_size),
      last_run_at: c.last_run_at || null,
      last_run_result: c.last_run_result || null,
    };
  }

  function saveConfig(patch) {
    const cur = readJsonSafe(CFG_FILE, {});
    const next = Object.assign({}, cur);
    const p = patch || {};
    if (p.enabled !== undefined) next.enabled = !!p.enabled;
    if (p.time !== undefined) next.time = normalizeTime(p.time);
    if (p.batch_size !== undefined) next.batch_size = normalizeBatch(p.batch_size);
    if (p.last_run_at !== undefined) next.last_run_at = p.last_run_at;
    if (p.last_run_result !== undefined) next.last_run_result = p.last_run_result;
    /* [位置:lib/memory-distill.js·saveConfig] [配置原子写] [11-14 审查 B 批 b：原地裸写被 SIGINT/pm2 重启打断会丢 last_run_at（重启后 30 分钟窗口内会再补跑一次）和自定义时间，改原子写；异常仍往上抛给调用方] [注释时间 2026-11-14] */
    writeJsonAtomic(CFG_FILE, next);
    return readConfig();
  }

  // ---------------- 提示词（管理台「提示词」页可改，落 data/memory_distill_prompt.json） ----------------
  function readPromptConfig() {
    const c = readJsonSafe(PROMPT_FILE, {});
    return {
      distill_system_prompt: String(c.distill_system_prompt || ""),
      distill_user_prompt: String(c.distill_user_prompt || ""),
      distill_notes_user_prompt: String(c.distill_notes_user_prompt || ""),   // 11-04 蒸馏笔记的「附加说明」（User 段），留空=用内置默认
    };
  }

  function savePromptConfig(patch) {
    const cur = readJsonSafe(PROMPT_FILE, {});
    const next = Object.assign({}, cur);
    const p = patch || {};
    if (p.distill_system_prompt !== undefined) next.distill_system_prompt = String(p.distill_system_prompt);
    if (p.distill_user_prompt !== undefined) next.distill_user_prompt = String(p.distill_user_prompt);
    if (p.distill_notes_user_prompt !== undefined) next.distill_notes_user_prompt = String(p.distill_notes_user_prompt);
    /* [位置:lib/memory-distill.js·savePromptConfig] [提示词原子写] [11-14 审查 B 批 b：半截 JSON 会让自定义提示词静默回退内置默认，改原子写] [注释时间 2026-11-14] */
    writeJsonAtomic(PROMPT_FILE, next);
    return readPromptConfig();
  }

  // ---------------- 进度 state ----------------
  function readState() {
    const s = readJsonSafe(STATE_FILE, {});
    return {
      done: (s.done && typeof s.done === "object") ? s.done : {},
      lastBatch: Array.isArray(s.lastBatch) ? s.lastBatch : [],
      lastBatchAt: s.lastBatchAt || null,
      batches: Number(s.batches) || 0,
      lastSummary: s.lastSummary || "",
      candidates: Number(s.candidates) || 0,
      queued: Number(s.queued) || 0,
      notesDone: (s.notesDone && typeof s.notesDone === "object") ? s.notesDone : {},   // 11-04 蒸馏笔记：已蒸过的笔记 id → 时间
      notesLast: s.notesLast || null,
    };
  }

  function writeState(next) {
    /* [位置:lib/memory-distill.js·writeState] [进度原子写] [11-14 审查 B 批 b：进度文件写一半被打断是最贵的一种——实测 done 里有 195 天，全丢就会从头重蒸；改临时文件+rename 原子替换] [注释时间 2026-11-14] */
    writeJsonAtomic(STATE_FILE, next);
    return next;
  }

  // ---------------- 选材：日记清单 ----------------
  function listDiaries() {
    // 1003-05 起日记搬进 data/diary.json（目录只剩改名后的 diary_legacy 旧件）。
    // 以新存储为准，否则蒸馏读的是旧件、新写的日记永远蒸馏不到。目录扫描仅作回退。
    const fromJson = listDiariesFromJson();
    if (fromJson) return fromJson;
    const out = [];
    if (!fs.existsSync(diaryDir)) return out;
    const walk = function (absDir, session) {
      let ents = [];
      try { ents = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return; }
      for (const ent of ents) {
        const abs = path.join(absDir, ent.name);
        if (ent.isDirectory()) {
          if (EXCLUDE_SESSION_PREFIX.some(function (p) { return ent.name.indexOf(p) === 0; })) continue;
          walk(abs, ent.name);
        } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
          const rel = path.relative(diaryDir, abs).split(path.sep).join("/");
          let chars = 0;
          try { chars = String(fs.readFileSync(abs, "utf-8") || "").length; } catch (e) {}
          out.push({
            relPath: rel,
            absPath: abs,
            session: session || "_root",
            date: dateKeyOf(ent.name),
            chars: chars,
            sortKey: sortKeyOf(rel),
          });
        }
      }
    };
    walk(diaryDir, "");
    out.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0); });
    return out;
  }

  // 1003-05 起日记存在 data/diary.json（单 JSON）；正文直接带在 item.text 上，不用读文件。
  // absPath 那条路只给 legacy 目录回退用。
  function readDiaryText(d) {
    if (d && typeof d.text === "string") return String(d.text || "").trim();
    if (d && d.absPath) {
      try { return String(fs.readFileSync(d.absPath, "utf-8") || "").trim(); } catch (e) { return ""; }
    }
    return "";
  }

  // created_at 是 UTC ISO，直接切前 10 位会错一天（"2026-07-20T16:00Z" 北京时间已是 07-21）
  function localDayOf(iso) {
    const dt = new Date(String(iso || ""));
    if (isNaN(dt.getTime())) return "";
    try { return dt.toLocaleDateString("en-CA", { timeZone: TZ }); }
    catch (e) { return String(iso).slice(0, 10); }
  }

  // 新存储（data/diary.json）：id 升序、跳过用户主动隐藏的篇（隐藏 = 不注入 Earlier Days，也不该被蒸馏）
  function listDiariesFromJson() {
    try {
      // ★ listEntries 必须传 baseDir（不传的话 path.join(undefined,...) 抛错，
      //   被 loadStore 的 catch 吞成空库——表现为"明明有 104 篇却读到 0 篇"）
      const jsonPath = path.join(baseDir, "data", "diary.json");
      if (!fs.existsSync(jsonPath)) return null;   // 没有新存储 → 回退目录扫描
      const ds = require(path.join(baseDir, "lib", "diary-store.js"));
      if (!ds || typeof ds.listEntries !== "function") return null;
      const entries = ds.listEntries(baseDir) || [];
      const out = [];
      for (const e of entries) {
        if (e && e.hidden) continue;
        const content = String((e && e.content) || "");
        if (!content.trim()) continue;
        const id = String((e && e.id) || "");
        out.push({
          relPath: "d" + id,
          absPath: null,
          session: (e && e.session) || "_root",
          date: localDayOf((e && e.created_at) || ""),
          chars: content.length,
          sortKey: String(id).padStart(10, "0"),
          text: content,
        });
      }
      out.sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0); });
      return out;
    } catch (e) {
      logWarn("读 data/diary.json 失败，回退目录扫描：" + (e && e.message || e));
      return null;
    }
  }

  /**
   * 选一批：已蒸馏（state.done）的跳过，按时间升序取 batch_size 篇。
   * dryRun=true 时不写盘，只算不记（测试/预览用）。
   */
  // 1004：选材从「按日记篇取 N 篇」改为「按天取 N 天」——一天一次调用，
  // 主料是当天全部对话原文，日记退为线索（旧 planBatch 已无调用方，随之删除）
  /* [位置:lib/memory-distill.js·planDay forceDays] [手动指定日期蒸] [11-03：蒸馏要能手动选日期——forceDays=['2026-10-09',…] 时只蒸这几天（已蒸过的也允许重蒸；必须是时间线里存在且有消息的日期），不动「按顺序追赶」的进度。11-13 起完成标记只在成功后由 markDone 写，手动重蒸失败不会动原来的完成时间，所以不再需要 prevDone 回滚] [注释时间 2026-11-03；改动 2026-11-13] */
  function planDay(batchSize, dryRun, forceDays) {
    const st = readState();
    const all = daySource.listDays(baseDir);
    const today = todayKey();
    // ★ 跳过当天：03:00 定时跑的时候「今天」还没过完，跑了只会拿到半天
    const pending = all.filter(function (d) { return !st.done[d] && d < today; });
    const n = Math.max(1, Math.floor(Number(batchSize) || 1));
    // ★ 跳过空天：会话索引是按「首次/最后活跃」区间展开的，中间会有空洞日
    //   （实测 92 天里 9 天一条消息都没有）。不跳过的话，一次跑批会白白消耗一个空天。
    const pickedDays = [];
    const emptyDays = [];
    /* [位置:lib/memory-distill.js·planDay forced 上限] [手动选日期限一次 30 天] [11-14 审查 B 批 c：forceDays 只校验格式与去重，不限数量——传全部日期会把几百天原文一次性 readDay 进内存，再拼成一个超长 prompt 打给模型（必失败且卡进程）；前端选日期本来就一次一天，这里是给管理台接口兜底] [注释时间 2026-11-14] */
    const _forcedAll = Array.isArray(forceDays) ? forceDays.map(String).filter(function (d, i, a) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && a.indexOf(d) === i && all.indexOf(d) >= 0; }) : [];
    const forced = _forcedAll.slice(0, 30);
    if (_forcedAll.length > forced.length) logWarn("指定日期超过 30 天，本次只蒸前 30 天（其余下次再跑）：" + _forcedAll.slice(30).join(","));
    if (forceDays && forceDays.length && !forced.length) logWarn("指定的日期都不在时间线里：" + forceDays.join(","));
    if (forced.length) {
      forced.forEach(function (d) {
        const probe = daySource.readDay(baseDir, d, {});
        if (!probe.msgs.length) { logWarn("指定日期 " + d + " 没有消息，跳过"); return; }
        pickedDays.push(d);
      });
    } else if (!(forceDays && forceDays.length)) {   // 传了日期但全不合法＝什么都不蒸（不能悄悄退回按顺序蒸别的天）
    for (let i = 0; i < pending.length && pickedDays.length < n; i++) {
      const probe = daySource.readDay(baseDir, pending[i], {});
      if (!probe.msgs.length) { emptyDays.push(pending[i]); continue; }
      pickedDays.push(pending[i]);
    }
    }
    const picked = pickedDays.map(function (d) {
      return { relPath: d, session: null, date: d, chars: 0 };
    });
    const plan = {
      picked: picked,
      pickedCount: picked.length,
      total: all.length,
      doneCount: all.length - pending.length,
      pending: pending.length,
      remaining: forced.length ? pending.length : pending.length - picked.length,   // 手动指定日期不占顺序追赶的进度
      chars: 0,
      batchIndex: st.batches + (picked.length ? 1 : 0),
      batchesTotal: Math.ceil(pending.length / Math.max(1, n)),
      // 检索回灌要按「日记当天」定位，所以 items 保留带 date 的对象形态
      items: pickedDays.map(function (d) { return { date: d, relPath: d, session: null }; }),
      days: pickedDays.slice(),      // 日期字符串数组，供打包用
      emptyDays: emptyDays.slice(),  // 顺手跳过的空天
      forced: forced.length > 0,     // 手动指定日期
    };
    /* [位置:lib/memory-distill.js·planDay] [选材不再提前记完成] [11-13 审查 A 批 c：原来在调 LLM 之前就把 picked / empty 写进 state.done 并落盘，LLM 失败或进程被杀时 catch 不执行，这天被永久跳过且界面显示「已生成过」；现在 planDay 只选材不写盘（dryRun 参数保留给老调用方，选材结果本来就一样），完成标记挪到 runOnce 真正入队成功之后（markDone）——没写就是没完成，下次自然重跑] [注释时间 2026-11-13] */
    return plan;
  }

  /* [位置:lib/memory-distill.js·markDone] [候选真入队后才记完成] [11-13 审查 A 批 c：done 标记从「跑批开始」挪到「候选真进待审之后」，空天也在这里标（它们确实没有可蒸内容）。写盘失败直接抱给 runOnce 记失败，下次重跑；重复候选由 admission 去重挡住。原来的 rollbackDays 与 __pendingCommit 化石一并删掉——done 没写就是没完成，不需要撤回] [注释时间 2026-11-13] */
  function markDone(plan) {
    if (!plan) return false;
    const days = Array.isArray(plan.days) ? plan.days.slice() : [];
    const empty = Array.isArray(plan.emptyDays) ? plan.emptyDays.slice() : [];
    if (!days.length && !empty.length) return false;
    const st = readState();
    const done = Object.assign({}, st.done || {});
    const at = new Date().toISOString();
    empty.forEach(function (d) { done[d] = at; });
    days.forEach(function (d) { done[d] = at; });
    writeState(Object.assign({}, st, {
      done: done,
      lastBatch: days.length ? days : (st.lastBatch || []),
      lastBatchAt: days.length ? at : (st.lastBatchAt || null),
      batches: days.length ? (st.batches || 0) + 1 : (st.batches || 0),
    }));
    return true;
  }


  // 一篇日记的原文打包文本（含 msg_id，供 3.4 抽取时引用、3.5 取证时核对）
  function packEvidence(matches) {
    let used = 0;
    const lines = [];
    for (const m of matches) {
      const c = String(m.content || "").replace(/\s+/g, " ").trim();
      if (!c) continue;
      if (used + c.length > EVIDENCE_MAX_CHARS) break;
      used += c.length;
      const t = m.time ? String(m.time).slice(0, 16) : "?";
      const id = m.msg_id ? ("#" + m.msg_id) : "#?";
      lines.push("[" + id + " · " + t + " · " + (m.role || "?") + "] " + c);
    }
    return { text: lines.join("\n"), chars: used, count: lines.length, truncated: lines.length < matches.length };
  }

  // 整批打包：日记正文 + 该日记的原文（供 3.4 直接喂 LLM）
  // 1004：整批 = 当天日记（线索，非证据） + 当天全部对话原文（主料 = 证据源）
  async function packDay(days) {
    const blocks = [];
    const evidenceIndex = Object.create(null);
    let evTotal = 0, evChars = 0, truncated = 0, dayDiaries = 0, toolsKept = 0, toolsChars = 0, toolsTruncated = 0;
    const diaries = listDiaries() || [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      /* [位置:lib/memory-distill.js·packDay 工具记录选项] [名称:选材带上工具记录] [需求:11-10「蒸馏上下文要包括工具记录，完整的」——daySource.readDay 默认不读工具，这里显式打开并传单条截断阈值；planDay 探空两处不传保持原行为] [注释时间 2026-11-10] */
      const dr = daySource.readDay(baseDir, day, { maxMsgChars: DAY_MAX_MSG_CHARS, includeTools: true, toolResultMaxChars: TOOL_RESULT_MAX_CHARS });
      // ★ 取证索引存「未截断」的正文：截断只影响喂给模型的材料，不该影响取证比对
      dr.msgs.forEach(function (m) {
        if (m && m.id) evidenceIndex[m.id] = { msg_id: m.id, content: m.content, time: m.time, role: m.role, session: m.session };
      });
      /* [位置:lib/memory-distill.js·packDay 工具取证条目] [名称:工具记录进取证索引] [需求:工具行进了材料，模型可引用 #宿主id#tN 作证据；索引同样存未截断全文（uuid 全小写，normId 后能精确命中；模型只引宿主 uuid 前缀时 matchId 先回宿主消息）] [注释时间 2026-11-10] */
      (dr.tools || []).forEach(function (t) {
        if (t && t.id) evidenceIndex[t.id] = { msg_id: t.id, content: t.result || t.error || "", time: t.time, role: "tool", session: t.session };
      });
      evTotal += dr.msgs.length;
      evChars += dr.chars;
      truncated += dr.stats.truncated;
      toolsKept += (dr.tools || []).length;
      toolsChars += (dr.stats && dr.stats.toolsChars) || 0;
      toolsTruncated += (dr.stats && dr.stats.toolsTruncated) || 0;
      const dayD = diaries.filter(function (d) { return d.date === day; });
      dayDiaries += dayD.length;
      const diaryBlock = dayD.length
        ? dayD.map(function (d) { return readDiaryText(d); }).join("\n\n")
        : "（当天没有日记）";
      blocks.push(
        "=== " + day + " · 日记 " + dayD.length + " 篇（仅供线索，不是证据） ===\n" + diaryBlock +
        "\n\n=== " + day + " · 当天对话原文 " + dr.msgs.length + " 条"
        + ((dr.tools || []).length ? " · 含工具记录 " + dr.tools.length + " 条（[tool · 时间 · #宿主id#tN] 行，可引用取证）" : "")
        + "（证据源，#msg_id 用于取证引用） ===\n" +
        (dr.lines.join("\n") || "（当天没有对话原文）")
      );
    }
    return {
      text: blocks.join("\n\n"),
      evidenceTotal: evTotal,
      evidenceChars: evChars,
      truncated: truncated,
      evidenceIndex: evidenceIndex,
      dayDiaries: dayDiaries,
      toolsKept: toolsKept,
      toolsChars: toolsChars,
      toolsTruncated: toolsTruncated,
    };
  }

  // ---------------- 3.4：LLM 抽取候选 ----------------
  const KINDS = ["fact", "rule", "event"];
  // 1007：subject 字段删除

  // 内置默认提示词（管理台提示词页可覆盖；留空即回落到这里）
  function defaultSystemPrompt() {
    return [
      "你是长期记忆抽取器。输入是「某一天的对话原文」加「当天的日记」。",
      "★ 证据只有对话原文：每条原文带 #msg_id，evidence 必须引用材料里真实出现的 id。",
      "★ 日记只是帮你定位重点的线索（AI 加工过一次，可能带写作偏差甚至幻觉），不是证据——日记里写了但原文对不上的东西一律不要抽。",
      "任务：从中提取值得长期记住的原子记忆候选。宁缺毋滥。",
      "",
      '只输出 JSON：{"candidates":[{"text":"...","kind":"fact|rule|event","evidence":["msg_id"],"confidence":"high|mid|low","note":"..."}]}（仅 event 可额外输出 triggers）',
      "",
      "字段规则：",
      "- text：一条独立、简洁、可执行或可验证的记忆。不复述上下文，不加材料里没有出现的因果关系。能短则短。",
      "- kind：fact = 稳定事实（她的偏好 / 经历 / 我们之间的事实）；rule = 规则、边界、承诺、交互约定（“以后不要……”“记住……”这类优先判 rule）；event = 具体发生过的一件事或做出来的东西（“她做了一个网页，域名是 xx”“上个月我们一起……”），之后聊天可能还会引用——具体的事归 event，稳定特质归 fact，别混。",
      "- evidence：支撑这条记忆的原文 msg_id（从材料里的 #xxx 取），必须是材料里真实出现的 id；找不到证据就别提这条。",
      "- confidence：high = 原文明确说过；mid = 原文有暗示但需推断；low = 只有日记提到、原文没对上。",
      "- note：可选，补充或存疑说明。\n- triggers：这是给 event 记忆设计的“召回入口”，不是主题摘要。先想这条具体记忆未来会在什么对话里派上用场，再反推她届时可能说出的词或口语表达。最多 3 个，少而准；只保留能指向这条具体记忆、且有助于词面命中的表达。\n  · 优先考虑真实聊天里自然出现的说法：事件/人/地点/作品的具体名称、简称、独特词、她可能会怎样问起或描述这件事；允许用与正文不同但有依据的口语说法。\n  · 不要只写“关系、情绪、偏好、生活”等主题分类；不要为凑数量堆泛词、近义词或长句；不要编造她没说过的昵称、事件细节或表达。每个 trigger 都要能回答：“她说出什么话时，我确实应该找回这条记忆？”\n  · 如果某个词出现在很多无关对话里也会命中，就太宽泛，尽量换成更有区分度的说法。没有可靠触发词时宁可少写。只有 event 需要输出 triggers（关键词召回入口）；fact/rule 不输出 triggers 字段。triggers 只供相关记忆注入使用，不供 memory_search 工具使用。\n- 输出前只对 event 检查：triggers 是否能帮助真实聊天命中这条具体事件。fact/rule 直接省略 triggers 字段。",
      "",
      "不要提取：当天情绪（一闪而过的聊天情绪不是记忆）、一次性琐事（吃了什么、寒暄、流水账）、已过期信息、由单次行为推导出的性格标签、心理分析、模型自我叙事，以及日记里我自己的抒情。\n★ event 边界：只抽“之后可能还会被聊到、被引用”的具体事（做出来的东西、说定的重要话、经历的关键事件）；纯粹过去了就完的一次性流水账仍不抽。",
      "★ 约定与准则（rule）最容易被时间淘汰：抽之前先问一句「这条现在还成立吗」。属于某个已经过去的情境或阶段（“那时候”“之前”“以前”“那阵子”）、或后来被改掉、被别的方式替代、往后不再提起的，一律当它已过期，不要抽——过时的旧规矩进池就是垃圾，还会顶掉真正有效的新约定。",
      "★ 亲昵细节（亲密互动、身体接触一类）只发生过一次的，按一次性事件处理，不抽（除非是值得记住的 event，比如第一次见面这种里程碑）；只有形成了稳定习惯、或明确说好了的约定才抽。",
    ].join("\n");
  }

  function defaultUserPrompt() {
    return [
      "以下是 ${DIARY_COUNT} 天的材料：每天先给当天日记（仅作线索），再给当天全部对话原文（每条带 #msg_id，这是唯一的证据源）。",
      "逐条判断哪些值得长期记住，按 system 规定的 JSON 格式输出；没有就输出 {\"candidates\":[]}。",
    ].join("\n");
  }

  function buildDistillPrompt(packText, lastSummary, diaryCount) {
    const pc = readPromptConfig();
    const system = (pc.distill_system_prompt || "").trim() || defaultSystemPrompt();
    const tpl = (pc.distill_user_prompt || "").trim() || defaultUserPrompt();
    const head = [
      "【上一批已提取过的记忆】不要重复输出；若发现与其中某条冲突、可更新或可合并，仍可输出，并在 note 里写明「更新/合并：<原记忆前 12 字>」。",
      (lastSummary && String(lastSummary).trim()) ? String(lastSummary).trim() : "（无，这是第一批）",
    ].join("\n");
    // 1003：检索说明硬编码追加——不依赖模板，管理台改了 distill_user_prompt 也照样生效
    const searchNote = [
      "",
      "【补充检索】材料里已经给了当天全部原文，检索只用在两种情况下：",
      "① 某条原文被截断（末尾标了「过长已截断」），你想看它的完整内容；② 你想确认的这件事发生在当天之外。",
      "遇到这几种情况，先别勉强输出，提检索请求：",
      "① 日记里提到的事在当天原文里找不到；② 你想抽一条记忆却找不到能引用的 #msg_id；",
      "③ 你想看看当时到底怎么说的（尤其被截断的那条）。",
      '格式：{"search":[{"diary":1,"query":"你认为能搜到原文的关键词，或她当时的原话片段"}]}',
      "（diary 填材料里第几天的序号，从 1 开始，不填就默认第 1 天；query 一次问一件事，别塞一整句长句）",
      "系统按你给的 query 在全部对话里搜，把原文回给你，你再判断。",
      "最多提 " + SEARCH_ROUNDS + " 轮，之后必须出最终 {\"candidates\":[...]}。",
      "★ 同一条原文本批只会给你一次：换个词又搜到同样的东西时，系统只回一句「本批前面已给过 #xxx」，不再重复。看到这句就说明没新信息了，别再用同义词反复搜。",
      "★ 回给你的原文同样只有带 #msg_id 的才能写进 evidence。",
    ].join("\n");
    const user = tpl.replace(/\$\{DIARY_COUNT\}/g, String(diaryCount || 0)) + "\n\n" + head + searchNote + "\n\n=== 材料 ===\n" + packText;
    return { system: system, user: user };
  }

  // 调 role=distill 的模型取 JSON（1003-11 拆分：日记蒸馏独立配置）
  // 1003：改传消息数组，支持「模型提检索 → 回灌原文 → 再问」多轮（单次调用时传一条 user 即可）
  async function callLlm(system, msgs) {
    const { resolveRoleModel, thinkingPatch } = require("./model-router");
    const { resolveTarget } = require("./upstream-target");
    const { provider, model } = resolveRoleModel("distill");
    /* [位置:memory-distill.js·callLlm resolveTarget] [出口统一走 upstream-target] [11-12：同 memory-summary，订阅类供应商自动转内部代理（x-provider-id + x-internal-key），普通供应商与原手拼零行为变化；直连保留 base 补全] [注释时间 2026-11-12] */
    const tg = resolveTarget(provider, function (k) { return process.env[k]; }, model);
    let apiUrl = String((tg && tg.url) || "").replace(/\/+$/, "");
    if (apiUrl && !tg.viaProxy && !/\/chat\/completions$/.test(apiUrl)) apiUrl += "/chat/completions";
    if (!apiUrl || !tg.key || !model) throw new Error("模型未配置（role=distill）：请先在管理台给「日记蒸馏」选一个模型");
    // 1003：不用全局 fetch——它底层的 undici 有 300s 的 headersTimeout，
    // 上游处理 2 万字 prompt 常常超过 300s 才吐第一个字节，结果不是我们 abort，
    // 是 undici 先抛 UND_ERR_HEADERS_TIMEOUT（实跑踩到过，表现为莫名的 fetch failed）。
    // 改用 http/https 模块直接发，超时自己控；600s 与 nginx 读超时 620s 对齐。
    let lastErr = null;
    for (let attempt = 0; attempt < LLM_OUTPUT_BUDGETS.length; attempt++) {
      const budget = LLM_OUTPUT_BUDGETS[attempt];
      const payload = JSON.stringify(Object.assign({
        model: model,
        messages: [{ role: "system", content: system }].concat(Array.isArray(msgs) ? msgs : [{ role: "user", content: String(msgs || "") }]),
        
        max_tokens: budget,
        response_format: { type: "json_object" },
      }, thinkingPatch(provider)));   /* [位置:memory-distill.js·callLlm thinkingPatch] [蒸馏显式开思考] [11-09：原先不发思考参数靠厂商默认；glm 系按供应商上锁 thinking.enabled，行为与现状一致但不再依赖厂商默认] [注释时间 2026-11-09] */
      let data;
      try {
        const res = await llmLog.post("memory_distill", httpPostJson, apiUrl, payload, Object.assign({
          "Content-Type": "application/json",
          "Authorization": "Bearer " + tg.key,
        }, tg.headers || {}), LLM_TIMEOUT_MS);
        if (res.status < 200 || res.status >= 300) {
          throw new Error("LLM HTTP " + res.status + " " + String(res.text || "").slice(0, 200));
        }
        data = JSON.parse(res.text);
      } catch (e) {
        if (!(e instanceof Error)) throw new Error(String(e));
        throw e;                       // 网络/HTTP 错误不重试预算，交给上层
      }
      const choice = data && data.choices && data.choices[0];
      const content = choice && choice.message && choice.message.content;
      const finish = choice && String(choice.finish_reason || "");
      const body = content == null ? "" : String(content);
      // 判「没吐完整」三种：空响应 / 上游明确说被截断 / 剥掉思考块后取不出完整 JSON 对象
      const noJson = !firstJsonObject(stripFences(body));
      const incomplete = !body || finish === "length" || noJson;
      if (incomplete && attempt < LLM_OUTPUT_BUDGETS.length - 1) {
        const why = !body ? "空响应" : (finish === "length" ? "finish_reason=length（输出被截断）" : "取不到完整 JSON 对象");
        logWarn("模型输出不完整（" + why + "），把 max_tokens 从 " + budget + " 加到 " + LLM_OUTPUT_BUDGETS[attempt + 1] + " 重试");
        lastErr = new Error("模型输出不完整：" + why);
        continue;
      }
      if (!body) throw new Error("LLM 空响应（已试到最大输出预算 " + budget + "）");
      return {
        text: body,
        model: model,
        finishReason: finish || null,
        attempts: attempt + 1,
        outputTokens: budget,
      };
    }
    throw lastErr || new Error("LLM 调用失败");
  }

  function normalizeCandidate(c) {
    if (!c || typeof c !== "object") return null;
    const text = String(c.text || c.content || "").trim();
    if (!text) return null;
    let kind = String(c.kind || "").trim();
    if (KINDS.indexOf(kind) < 0) kind = /以后|不要|记住|规则|约定|别再|必须/.test(text) ? "rule" : "fact";
    let confidence = String(c.confidence || "").trim();
    if (["high", "mid", "low"].indexOf(confidence) < 0) confidence = "mid";
    const ev = Array.isArray(c.evidence) ? c.evidence : (Array.isArray(c.msg_ids) ? c.msg_ids : []);
    // 1102 产品确定：triggers 收紧到最多 3 个（原 1-6）/ vibe（可选感受）由蒸馏 LLM 产出，随候选透传入库
    let triggers = [];
    if (Array.isArray(c.triggers)) {
      triggers = c.triggers.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
      triggers = [...new Set(triggers)].slice(0, 3);
    }
    const candidate = {
      text: text,
      kind: kind,
      evidence: ev.map(function (x) { return String(x || "").trim(); }).filter(Boolean),
      confidence: confidence,
      note: String(c.note || "").trim(),
    };
    /* [位置:lib/memory-distill.js·候选 triggers 不分类] [11-10 拍板「关键词不区分分类就都写，靠参与检索开关决定是否参与」] [原仅 event 保留 triggers，fact/rule 的词在这里被丢掉；现在三类都保留（有词才带），vibe 仍仅 event（11-04：气味/情感由 AI 存记忆时自己写）] [注释时间 2026-11-10] */
    if (triggers.length) candidate.triggers = triggers;
    return candidate;
  }

  // 1004：模型（尤其换模型时）常在 JSON 外面裹东西——```json 围栏、前后说明文字、
  // 甚至一口气吐两个对象。原来用 /\{[\s\S]*\}/ 贪婪匹配会把它俩一起框进去，
  // 结果 "Unexpected non-whitespace character after JSON"。改成按括号配对取第一个完整对象。
  function stripFences(s) {
    let t = String(s == null ? "" : s).trim();
    // ★ 必须先剥思考块：带推理的模型（MiniMax-M3 实测就是）会把 <think>…</think> 一起吐出来，
    //   里面常抄一份 JSON 模板占位（"text":"..." 之类），不剥就会被当成第一个 JSON 对象，
    //   结果只拿到一条假候选（1004 实测：剥之前 1 条、剥之后 6 条真候选）
    t = t.replace(/<(think|reasoning|thinking)>[\s\S]*?<\/\1>/gi, "").trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    return t.trim();
  }

  function firstJsonObject(s) {
    const start = s.indexOf("{");
    if (start < 0) return "";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return "";
  }

  function parseCandidates(raw) {
    let s = stripFences(raw);
    let obj = null;
    try { obj = JSON.parse(s); }
    catch (e) {
      const frag = firstJsonObject(s);
      if (!frag) return { candidates: [], error: "JSON 解析失败（" + (e && e.message) + "）" };
      try { obj = JSON.parse(frag); }
      catch (e2) { return { candidates: [], error: "JSON 解析失败（" + (e2 && e2.message) + "）" }; }
    }
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && Array.isArray(obj.candidates)) arr = obj.candidates;
    else if (obj && Array.isArray(obj.memories)) arr = obj.memories;
    if (!arr) return { candidates: [], error: "响应里没有候选数组" };
    const out = arr.map(normalizeCandidate).filter(Boolean);
    return { candidates: out, error: null };
  }

  // ---------------- 1003：模型自提检索 ----------------
  // 判断模型这一轮是「要检索」还是「出结论」。两种都允许同时出现，但只有 search 会触发回灌。
  function parseResponse(raw) {
    let s = stripFences(raw);
    let obj = null;
    try { obj = JSON.parse(s); }
    catch (e) {
      const frag = firstJsonObject(s);
      if (frag) { try { obj = JSON.parse(frag); } catch (e2) { obj = null; } }
    }
    if (!obj || typeof obj !== "object") return { search: [], done: false, error: "JSON 解析失败" };
    const rawSearch = Array.isArray(obj.search) ? obj.search : [];
    const search = [];
    // 单轮受理上限：多提的静默丢弃（不报错，避免模型卡在"为什么没回我"）
    for (const x of rawSearch.slice(0, SEARCH_MAX_PER_ROUND)) {
      if (!x || typeof x !== "object") continue;
      const q = String(x.query || x.q || "").trim();
      if (!q) continue;
      const n = Number(x.diary || x.d || 0);
      search.push({ diary: (n > 0 && n === Math.floor(n)) ? n : 0, query: q.slice(0, 200) });
    }
    const done = Array.isArray(obj.candidates) || Array.isArray(obj.memories);
    return { search: search, done: done, error: null };
  }

  // 按模型给的 query 替它搜原文：全库语义搜一次（当天原文已整批给过，不再单独搜当天）
  async function searchForDiary(query, limit, seenBatch) {
    const none = { lines: [], recs: [], tried: [], dups: [] };
    if (!searchContext) return none;
    const byId = Object.create(null);
    const dups = [];
    const push = function (m) {
      if (!m) return;
      const id = String(m.msg_id || "");
      const content = String(m.content || "").trim();
      if (!content) return;
      // 同预取：记忆/注入产物不是原文，喂进去会造成虚假取证
      if (EVIDENCE_SKIP_PATTERNS.some(function (re) { return re.test(content); })) return;
      if (id && byId[id]) return;
      // 1003：整批已给过 → 不重复回灌
      if (id && seenBatch && seenBatch[id]) { dups.push(id); return; }
      byId[id || ("_noid_" + Object.keys(byId).length)] = {
        msg_id: id,
        session: m.session || null,
        time: m.time || null,
        role: m.role || null,
        content: content,
        src: "llm_search",
      };
    };
    const tried = [];
    /* [位置:lib/memory-distill.js·searchForDiary] [自提检索只搜全库，不再先搜日记当天] [11-09：当天全部原文本来就整批发给模型了（lib/day-source.js），再按日期搜一遍当天只会返回「本批已给过」；留给模型的检索只用于「被截断的原文取全文」和「当天之外的事」] [注释时间 2026-11-09] */
    try {
      const r = await searchContext(query, { allSessions: true, limit: limit });
      if (r && r.ok && Array.isArray(r.matches)) r.matches.forEach(push);
      tried.push("全库");
    } catch (e) { logWarn("自提检索（全库）异常：" + (e && e.message || e)); }
    const recs = Object.keys(byId).map(function (k) { return byId[k]; });
    recs.forEach(function (m) { if (m && m.msg_id && seenBatch) seenBatch[m.msg_id] = true; });
    const packed = packEvidence(recs.slice(0, limit));
    return { lines: packed.text ? packed.text.split("\n") : [], recs: recs, tried: tried, dups: dups };
  }

  // 执行模型提的一批检索请求，把原文拼成一段回灌给它
  // 1003：整批共享 seenBatch——同一条原文只回灌一次，重复的只提示「本批前面已给过」
  async function handleSearchRequests(reqs, items, evidenceIndex, seenBatch) {
    const parts = [];
    let got = 0, dupTotal = 0;
    for (const s of reqs) {
      const idx = s.diary > 0 ? s.diary - 1 : 0;
      const d = (idx >= 0 && idx < items.length) ? items[idx] : items[0];
      const label = "日记 " + ((idx >= 0 && idx < items.length) ? s.diary : 1) + (d && d.date ? "（" + d.date + "）" : "");
      const r = await searchForDiary(s.query, SEARCH_LIMIT_PER_QUERY, seenBatch);
      // ★ 回灌的原文必须进证据索引，否则 3.5 取证认不出模型引用的这些 msg_id，白搜
      r.recs.forEach(function (m) { if (m && m.msg_id) evidenceIndex[m.msg_id] = m; });
      got += r.lines.length;
      dupTotal += r.dups.length;
      let body;
      if (r.lines.length) {
        body = r.lines.join("\n")
          + (r.dups.length ? "\n  └ （另有 " + r.dups.length + " 条本批前面已给过，不重复：#" + r.dups.slice(0, 5).join(" #") + "）" : "");
      } else if (r.dups.length) {
        body = "  └ （按「" + s.query + "」只搜到 " + r.dups.length + " 条，都是本批前面已给过的：#" + r.dups.slice(0, 5).join(" #") + "——没有新信息，换个话题搜，或按「找不到证据就别提这条」处理）";
      } else {
        body = "  └ 没搜到（已试：" + (r.tried.join(" / ") || "无") + "）——换个说法再提一次，或按「找不到证据就别提这条」处理";
      }
      parts.push("[" + label + " · 按「" + s.query + "」搜到 " + r.lines.length + " 条]\n" + body);
    }
    return {
      got: got,
      dupCount: dupTotal,
      text: "以下是按你给的关键词搜到的原文（#msg_id 才是证据，可直接写进 evidence）：\n\n" + parts.join("\n\n")
        + "\n\n看完就出最终结论 {\"candidates\":[...]}。",
    };
  }

  // ---------------- 3.5：取证（★ 强制：日记是 AI 加工过一次的，证据必须回原文确认） ----------------
  function normId(raw) {
    return String(raw == null ? "" : raw).trim().replace(/^#/, "").toLowerCase();
  }

  // msg_id 匹配：完整命中优先，其次前缀命中（LLM 常把 uuid 截成前 8 位）
  function matchId(id, index) {
    if (!id) return null;
    if (index[id]) return id;
    const keys = Object.keys(index);
    for (const k of keys) { if (k && k.toLowerCase().indexOf(id) === 0) return k; }
    return null;
  }

  // 证据一致性打分（0~1）：候选文本与证据原文到底说的是不是一回事。
  // 单看中文二元组不行——「23:50 Bark 提醒就去睡」和原文「你给我搞个定时bark好吧哥哥」措辞几乎不重叠，
  // 而「喜欢黑胡椒清汤面」和情感描写也是低重叠。区分点在强特征：Bark / 23:50 这类英文与数字 token。
  // 所以：①有强特征 token 时以它的命中率为准（真证据靠它过）②没有强特征就只看中文实词二元组（假证据在这儿现形）
  function evidenceScore(cand, src) {
    const cs = String(cand || "");
    const ss = String(src || "");
    // 只认「完整日期 / 时间 / 英文词」：裸年份(2026)、裸数字命中率虚高，一眼假证据也能过
    const toks = cs.match(/[A-Za-z]{2,}|\d{1,2}:\d{2}|\d{4}-\d{1,2}-\d{1,2}/g) || [];
    let tHit = 0;
    for (const t of toks) { if (ss.toLowerCase().indexOf(String(t).toLowerCase()) >= 0) tHit += 1; }
    const STOP = /[\u7684\u4e86\u662f\u6211\u4f60\u4ed6\u5979\u5b83\u4eec\u8fd9\u90a3\u4e0d\u6ca1\u5728\u6709\u4e2a\u5c31\u6765\u53bb\u4e0a\u4e2d\u4e0b\u5f88\u4e5f\u90fd\u8fd8\u8981\u4f1a\u5bf9\u628a\u88ab\u7ed9\u4e0e\u548c\u53ca\u6216\u5427\u5462\u5417\u554a]/;
    const han = cs.replace(/[^\u4e00-\u9fa5]/g, "");
    const grams = [];
    for (let i = 0; i + 2 <= han.length; i++) {
      const g = han.slice(i, i + 2);
      if (!STOP.test(g)) grams.push(g);
    }
    let gHit = 0;
    for (const g of grams) { if (ss.indexOf(g) >= 0) gHit += 1; }
    const gRatio = grams.length ? (gHit / grams.length) : 0;
    if (toks.length) return Math.max(gRatio, tHit / toks.length);
    return gRatio;
  }

  /**
   * 对每条候选回原文确认证据：
   *  ① evidence 里的 msg_id 能匹配预取原文 → 确认（quote 取该条原文）
   *  ② 匹配不上 → 用候选文本二段检索，重合率达标 → 弱确认（confidence 封顶 mid）
   *  ③ 都确认不了 → confidence 降为 low 并注明，仍然进待审交给人工
   */
  async function verifyCandidates(candidates, evidenceIndex, vopts) {
    const out = [];
    for (const c of candidates) {
      const ids = (c.evidence || []).map(normId).filter(Boolean);
      let hitKey = null;
      for (const id of ids) { const k = matchId(id, evidenceIndex); if (k) { hitKey = k; break; } }
      let status = "unconfirmed";
      let quote = "";
      let evSession = null, evTime = null, evMsgId = null;
      let mismatch = null;   // msg_id 对上但语义没对上时记下重合率，供人工判断
      if (hitKey) {
        const m = evidenceIndex[hitKey];
        const ratio = evidenceScore(c.text, String((m && m.content) || ""));
        if (ratio >= EVIDENCE_MIN_RATIO) {
          status = "confirmed";
          quote = String((m && m.content) || "").slice(0, 200);
          evSession = (m && m.session) || null;
          evTime = (m && m.time) || null;
          evMsgId = (m && m.msg_id) || null;
        } else {
          mismatch = ratio;   // 不匹配：留给二段检索找真正的原文
        }
      }
      if (status !== "confirmed" && searchContext && !(vopts && vopts.noSearch)) {
        try {
          const r = await searchContext(c.text, { allSessions: true, limit: 5 });
          const ms = (r && r.ok && Array.isArray(r.matches)) ? r.matches : [];
          let best = 0, bestM = null;
          for (const m of ms) {
            const ratio = evidenceScore(c.text, String((m && m.content) || ""));
            if (ratio > best) { best = ratio; bestM = m; }
          }
          if (bestM && best >= EVIDENCE_WEAK_RATIO) {
            status = "weak";
            quote = String(bestM.content || "").slice(0, 200);
            evSession = bestM.session || null;
            evTime = bestM.time || null;
            evMsgId = bestM.msg_id || null;
          }
        } catch (e) {
          logWarn("二段取证异常：" + (e && e.message || e));
        }
      }
      /* [位置:lib/memory-distill.js·verifyCandidates uuid直捞抓拍] [evidence未命中时按uuid直捞时间线原文存quote] [需求:11-08「每条记忆不是有msgid？为什么不直接用msgid做context检索」——蒸馏存的就是消息uuid，但证据索引/二段检索都可能落空，落空的条目quote是空的、出处只剩一个孤id（时间线被清理后成死链，实测177条只剩52条能捞回）。蒸馏那一刻uuid必活，这里直捞一次抓拍进quote，从此记忆自带出处。实拍+语义核验（evidenceScore）都过的才是 confirmed，直捞的单独记 snapshotted（原文在手但没做语义核验，confidence 提升保守一档）] [注释时间 2026-11-08] */
      if (status === "unconfirmed" && lookupMessage) {
        for (const eid of ids) {
          const m = lookupMessage(eid);
          if (m && String(m.content || "").trim()) {
            status = "snapshotted";
            quote = String(m.content).trim().slice(0, 200);
            evSession = m.session || null;
            evMsgId = m.msg_id || eid;
            break;
          }
        }
      }
      let confidence = c.confidence;
      if (status === "confirmed" || status === "snapshotted") {
        if (confidence === "low") confidence = "mid";
      } else if (status === "weak") {
        if (confidence === "high") confidence = "mid";
      } else {
        confidence = "low";
      }
      let tail = "证据已回原文确认";
      if (status === "snapshotted") tail = "已按 msg_id 直捞当时的原文抓拍（出处随记忆保存，不再依赖时间线）";
      else if (status === "weak") tail = "证据由二段检索弱确认（msg_id 未匹配或原文对不上）";
      else if (status === "unconfirmed") {
        tail = "证据未回原文确认" + (mismatch != null ? ("（msg_id 对上但原文与该条内容不匹配，重合率 " + Math.round(mismatch * 100) + "%）") : "（msg_id 未匹配，二段检索也没对上）");
      }
      out.push(Object.assign({}, c, {
        verified: status,
        evidenceHit: hitKey ? 1 : 0,
        confidence: confidence,
        quote: quote,
        session: evSession,
        msg_time: evTime,
        msg_id: evMsgId,
        note: (c.note ? c.note + "；" : "") + tail,
      }));
    }
    return out;
  }

  // ---------------- 3.6：落待审（走 admission judge 去重，产出不直接入池） ----------------
  /* [位置:lib/memory-distill.js·queueCandidates] [回传逐条结果] [需求:11-15：笔记蒸馏要按条判定「哪几篇能标已蒸」——失败候选只带一个计数，调用方定位不到是哪些笔记受影响；逐条记下 evidence（note_<笔记id>）就能只卡住被波及的那几篇。results 只增不改，对话路径继续只用 queued/rejected/failed] [注释时间 2026-11-15] */
  async function queueCandidates(cands, noQueue, refOverride) {
    const res = { queued: 0, rejected: 0, failed: 0, errors: [], queueIds: [], skippedNoAdmission: false, results: [] };
    if (!cands || !cands.length) return res;
    // 逐条结果：{ i, ok, action, evidence:[...], error/reason }；evidence 取自候选自己的 evidence（不依赖 verifyCandidates 回填的 msg_id——未确认的候选没有 msg_id）
    function evIds(c) { return (c && Array.isArray(c.evidence) ? c.evidence : []).map(function (x) { return String(x || "").trim(); }).filter(Boolean); }
    if (!admission) {
      res.skippedNoAdmission = true; res.failed = cands.length;
      cands.forEach(function (c, i) { res.results.push({ i: i, ok: false, action: "failed", reason: "no_admission", evidence: evIds(c) }); });
      return res;
    }
    // 1002 第 4 项：蒸馏产物标来源（source.type=distill，ref=本批日记路径），溯源用
    const stq = readState();
    const batchRef = refOverride || ((stq.lastBatch && stq.lastBatch.length)
      ? stq.lastBatch.join(",").slice(0, 200)
      : null);
    for (const c of cands) {
      const ev = evIds(c);
      const ri = res.results.length;
      if (noQueue) { res.queued += 1; res.results.push({ i: ri, ok: true, action: "queued", no_queue: true, evidence: ev }); continue; }   // 排障用：只统计不落库
      try {
        /* [位置:lib/memory-distill.js·queueCandidates] [蒸馏来源细分通道] [需求:11-06：蒸馏对话与蒸馏笔记在库里 method 完全相同（都是 summary_promotion），前端只能靠 msg_id 形态猜；写入时如实打 channel，新数据一步到位] [注释时间 2026-11-06] */
        const r = await admission.submitPromotion({
          content: c.text,
          kind: c.kind,
          // 1007：subject 已删
          quote: c.quote || "",
          msg_time: c.msg_time || null,
          triggers: c.triggers,
          channel: refOverride === "notes" ? "note_distill" : "dialog_distill",
          source: { type: "distill", ref: batchRef },
        }, { sessionId: c.session || null, msgId: c.msg_id || null });
        if (!r) { res.failed += 1; res.results.push({ i: ri, ok: false, action: "failed", reason: "no_result", evidence: ev }); continue; }
        if (r.action === "reject") { res.rejected += 1; res.results.push({ i: ri, ok: true, action: "rejected", evidence: ev }); }
        else {
          res.queued += 1; if (r.queue_id) res.queueIds.push(String(r.queue_id));
          res.results.push({ i: ri, ok: true, action: "queued", queue_id: r.queue_id ? String(r.queue_id) : null, evidence: ev });
        }
      } catch (e) {
        res.failed += 1;
        const em = String((e && e.message) || e).slice(0, 120);
        res.errors.push(em);
        res.results.push({ i: ri, ok: false, action: "failed", error: em, evidence: ev });
      }
    }
    return res;
  }

  // 批间衔接防重复：把本批抽到的记忆文本记进 state.lastSummary，下一批带上
  function appendSummary(cands, maxChars) {
    if (!cands || !cands.length) return;
    const st = readState();
    const lines = cands.map(function (c) { return "- [" + c.kind + "] " + c.text; });
    let s = (st.lastSummary ? st.lastSummary + "\n" : "") + lines.join("\n");
    const cap = maxChars || 20000;
    if (s.length > cap) s = s.slice(s.length - cap);
    writeState(Object.assign({}, st, { lastSummary: s }));
  }

  /* [位置:lib/memory-distill.js·notesDonePlan] [笔记条级已蒸判定] [需求:11-15：候选没能进待审时不能把笔记标成已蒸（原来整组无条件写 notesDone，失败那几条从待蒸清单永久消失、候选无声丢）。按失败候选的 evidence（note_<笔记id>）归到具体笔记，只给没被波及的笔记标 done；一条失败候选定位不到任何笔记时保守整组不标（宁可多蒸一次也不丢候选）。快照必须与 notesDone 同一批写——notesPending 靠快照判断「有没有变化」，刷了没标 done 的笔记的快照等于让它从清单里消失] [注释时间 2026-11-15] */
  function notesDonePlan(group, q) {
    const ids = (group || []).map(function (e) { return String(e.id); });
    const res = q || {};
    // 有失败却没有逐条结果（外部构造的 q、老口径）：整组不标
    if (res.failed > 0 && (!Array.isArray(res.results) || !res.results.length)) {
      return { ids: [], keep: ids.length, blocked: ids.length, untraced: 0 };
    }
    const blocked = Object.create(null);
    let untraced = 0;
    (res.results || []).forEach(function (r) {
      if (!r || r.ok !== false) return;
      let traced = false;
      (r.evidence || []).forEach(function (ev) {
        const m = /^note_(.+)$/.exec(String(ev || "").trim());
        if (!m) return;
        traced = true;
        if (ids.indexOf(m[1]) >= 0) blocked[m[1]] = true;
      });
      if (!traced) untraced += 1;
    });
    if (untraced) return { ids: [], keep: ids.length, blocked: ids.length, untraced: untraced };
    return { ids: ids.filter(function (id) { return !blocked[id]; }), keep: Object.keys(blocked).length, blocked: Object.keys(blocked).length, untraced: 0 };
  }

  function nowIso() { return new Date().toISOString(); }
  function nowLocal() { return timeUtils.formatDateTimeInTimeZone(new Date(), TZ); }

  function parts() { return timeUtils.getDatePartsInTimeZone(new Date(), TZ); }

  function todayKey() {
    const p = parts();
    return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
  }

  function runDateKey(cfg) {
    const s = cfg && cfg.last_run_at ? String(cfg.last_run_at) : "";
    if (!s) return "";
    // last_run_at 存 ISO（UTC）；按本地时区换算成日期，避免 03:00 跑完被算成"昨天"
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const p = timeUtils.getDatePartsInTimeZone(d, TZ);
    return p.year + "-" + pad2(p.month) + "-" + pad2(p.day);
  }

  // 今天设定时刻的 Date（本地时区）
  function dueToday(cfg) {
    const p = parts();
    const t = normalizeTime(cfg.time).split(":");
    return timeUtils.zonedWallTimeToDate({
      year: p.year, month: p.month, day: p.day,
      hour: Number(t[0]), minute: Number(t[1]), second: 0,
    }, TZ);
  }

  /**
   * 跑一次蒸馏（一批）。
   * 3.3：选材 + 原文预取 + 打包（打包文本落 data/memory_distill_last_pack.txt 供排障）；
   * 3.4 抽取 LLM / 3.5 取证 / 3.6 落待审 待接入。
   */
  async function runOnce(reason, runOpts) {
    if (state.running) {
      return { ok: false, error: "已有蒸馏在跑，请等它结束", startedAt: state.startedAt };
    }
    const ro = runOpts || {};
    const dryRun = !!ro.dryRun;
    const cfg = readConfig();
    state.running = true;
    state.startedAt = nowIso();
    state.lastTrigger = String(reason || "manual");
    state.lastError = null;
    const label = "记忆蒸馏（" + (reason === "schedule" ? "定时" : reason === "catchup" ? "重启补跑" : "手动") + "）";
    const logEntry = noteLog("distill", label, "pending", "开始跑：每次 " + cfg.batch_size + " 天（主料 = 当天全部对话原文）");
    const t0 = Date.now();
    try {
      const plan = planDay(cfg.batch_size, dryRun, ro.days);
      // 1004：空跑要喊清楚——不是「没有日记」，而是「没有待处理的日期」
      if (!plan.total) logWarn("时间线里一天对话都没有——本次空跑，请检查 timeline_data/enhanced_messages_*.json");
      else if (!plan.pickedCount) logInfo("没有待处理的日期（历史 " + plan.total + " 天已标基线，或只剩今天未过完的那天）");
      let pack = { text: "", evidenceTotal: 0, evidenceChars: 0, truncated: 0, evidenceIndex: {}, dayDiaries: 0, toolsKept: 0, toolsChars: 0, toolsTruncated: 0 };
      if (plan.days && plan.days.length) {
        pack = await packDay(plan.days);
        try { fs.writeFileSync(PACK_PATH, pack.text, "utf-8"); } catch (e) { logWarn("打包文本落盘失败：" + (e && e.message || e)); }
      }
      // 3.4：LLM 抽取候选（含 kind 判定 + 证据 msg_id）
      let extract = { candidates: [], error: null, promptChars: 0, raw: null, searchRounds: 0, searchRequests: 0, model: null };
      if (pack.text) {
        const st0 = readState();
        const pr = buildDistillPrompt(pack.text, st0.lastSummary, plan.pickedCount);
        extract.promptChars = pr.system.length + pr.user.length;
        try {
          // 1003：多轮——首轮判断，模型可提检索，我们代跑回灌，最多 SEARCH_ROUNDS 轮后必须出结论
          const msgs = [{ role: "user", content: pr.user }];
          // 1003：整批共享「已给过」集合，预取的原文也算已给过——否则模型换个词又搜回同一堆，token 白烧
          const batchSeen = Object.create(null);
          Object.keys(pack.evidenceIndex || {}).forEach(function (k) { batchSeen[k] = true; });
          let raw = "", searchRounds = 0, searchRequests = 0, parsed = null;
          for (let turn = 0; turn <= SEARCH_ROUNDS + 1; turn++) {
            const r = await callLlm(pr.system, msgs);
            raw = String(r.text || "");
            if (r.model) extract.model = r.model;
            // 排障用：输出预算是否被加到第二/三档、上游有没有报截断
            extract.finishReason = r.finishReason || null;
            extract.outputTokens = r.outputTokens || null;
            extract.llmAttempts = r.attempts || 1;
            const pr2 = parseResponse(raw);
            if (pr2.search.length && searchContext && searchRounds < SEARCH_ROUNDS) {
              searchRounds++;
              searchRequests += pr2.search.length;
              // 实时记账：否则中途抛异常时，跑了几轮/几条就全丢了（首次实跑就是这么丢的）
              extract.searchRounds = searchRounds;
              extract.searchRequests = searchRequests;
              const found = await handleSearchRequests(pr2.search, plan.items, pack.evidenceIndex, batchSeen);
              extract.searchDups = (extract.searchDups || 0) + (found.dupCount || 0);
              logInfo("模型自提检索 第 " + searchRounds + " 轮：" + pr2.search.length + " 条请求，回灌 " + found.got + " 条原文，去重 " + (found.dupCount || 0) + " 条");
              msgs.push({ role: "assistant", content: raw });
              msgs.push({ role: "user", content: found.text });
              continue;
            }
            parsed = parseCandidates(raw);
            break;
          }
          extract.raw = raw.slice(0, 2000);
          // 1004：整份原始返回落盘——解析失败时没 raw 就只能干瞪眼（上次换模型踩过）
          try { fs.writeFileSync(path.join(baseDir, "data", "memory_distill_last_raw.txt"), String(raw || ""), "utf-8"); } catch (e) {}
          extract.searchRounds = searchRounds;
          extract.searchRequests = searchRequests;
          const p = parsed || parseCandidates(raw);
          extract.candidates = p.candidates || [];
          extract.error = p.error || null;
        } catch (e) {
          // 带上 name/cause，否则只见 "fetch failed" 根本分不清是超时、断连还是上游拒了
          const cause = e && e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : "";
          extract.error = String((e && e.message) || e) + (e && e.name ? " [" + e.name + "]" : "") + (cause ? " (" + cause + ")" : "");
          extract.model = extract.model || null;
        }
      }
      // ★ 11-13：LLM 失败不再需要撤回——done 本来就没写（planDay 只选材），下次自然重跑
      // 3.5：取证（证据必须回原文确认，确认不了的下调 confidence）
      let verified = extract.candidates;
      if (extract.candidates.length) verified = await verifyCandidates(extract.candidates, pack.evidenceIndex);
      const confirmed = verified.filter(function (c) { return c.verified === "confirmed"; }).length;
      const weak = verified.filter(function (c) { return c.verified === "weak"; }).length;
      // 3.6：落待审（走 admission judge 去重；noQueue 为排障用，只统计不落库）
      const qres = await queueCandidates(verified, !!ro.noQueue);
      /* [位置:lib/memory-distill.js·runOnce 完成标记] [入队成功才标已蒸] [11-13 审查 A 批 c：候选真的进待审（或 noQueue 排障模式跑完）且没有入队失败、LLM 也没报错，才把本批日期标成已蒸；dryRun 不标。这样进程被杀 / LLM 失败 / 部分入队失败都不会丢那天，下次自动重跑，重复候选由 admission 去重] [注释时间 2026-11-13] */
      if (!dryRun && !extract.error && qres.failed === 0) markDone(plan);
      if (!ro.noQueue && verified.length) appendSummary(verified);
      const result = {
        ok: true,
        reason: state.lastTrigger,
        dryRun: dryRun,
        startedAt: state.startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - t0,
        batchSize: cfg.batch_size,
        batches: plan.pickedCount ? 1 : 0,
        picked: plan.pickedCount,
        pickedChars: pack.evidenceChars,
        total: plan.total,
        doneCount: plan.doneCount,
        remaining: plan.remaining,
        batchIndex: plan.batchIndex,
        batchesTotal: plan.batchesTotal,
        evidence: pack.evidenceTotal,
        evidenceChars: pack.evidenceChars,
        evidenceTruncated: pack.truncated,
        packChars: pack.text.length,
        searchRounds: extract.searchRounds,
        searchRequests: extract.searchRequests,
        searchDups: extract.searchDups || 0,
        model: extract.model,
        promptChars: extract.promptChars,
        candidates: verified.length,
        candidateList: verified.slice(0, 30),
        confirmed: confirmed,
        weak: weak,
        unconfirmed: verified.length - confirmed - weak,
        queued: qres.queued,
        rejected: qres.rejected,
        queueFailed: qres.failed,
        queueIds: qres.queueIds.slice(0, 30),
        noQueue: !!ro.noQueue,
        llmError: extract.error,
        promptChars: extract.promptChars,
        stage: "3.6-queued",
        files: plan.days ? plan.days.slice() : [],
        days: plan.days ? plan.days.slice() : [],
        forcedDays: !!plan.forced,
        dayDiaries: pack.dayDiaries,
        toolsKept: pack.toolsKept || 0,
        toolsChars: pack.toolsChars || 0,
        toolsTruncated: pack.toolsTruncated || 0,
        note: plan.pickedCount
          ? ("本批 " + plan.pickedCount + " 天（" + (plan.days || []).join(",") + "），原文 " + pack.evidenceTotal + " 条 / " + pack.evidenceChars + " 字"
             + ((pack.toolsKept || 0) ? "，工具记录 " + pack.toolsKept + " 条 / " + pack.toolsChars + " 字" : "")
             + "，日记 " + pack.dayDiaries + " 篇作线索，LLM 抽出候选 " + extract.candidates.length + " 条"
             + (extract.error ? ("（解析失败：" + extract.error + "）") : "")
             + "，取证确认 " + confirmed + " / 弱确认 " + weak + " / 未确认 " + (verified.length - confirmed - weak)
             + "，" + (ro.noQueue ? "（noQueue：未落库）" : ("进待审 " + qres.queued + " 条，门卫拒 " + qres.rejected + " 条")))
          : "没有待处理的日期（历史 " + plan.total + " 天已标基线，或只剩今天未过完的那天）",
      };
      saveConfig({ last_run_at: result.finishedAt, last_run_result: result });
      appendRun({ id: runId(), ts: result.finishedAt, trigger: state.lastTrigger, kind: "dialog", ok: true, dry_run: dryRun, no_queue: !!ro.noQueue, days: plan.days ? plan.days.slice() : [], summary: result.note, duration_ms: result.durationMs });
      state.runs += 1;
      if (logEntry && logEntry.id) noteLog("distill", label, "success", "完成：" + result.note);
      logInfo("跑完一次（" + state.lastTrigger + "）：" + result.note);
      return result;
    } catch (err) {
      // 走到这里＝整次跑批崩了（含进程被 pm2 内存重启杀掉前的那次）：done 还没写（markDone 只在成功路径），下次自动重跑
      const msg = err && err.message ? String(err.message) : String(err);
      state.lastError = msg;
      const result = { ok: false, reason: state.lastTrigger, startedAt: state.startedAt, finishedAt: nowIso(), error: msg };
      try { saveConfig({ last_run_at: result.finishedAt, last_run_result: result }); } catch (e) {}
      appendRun({ id: runId(), ts: result.finishedAt, trigger: state.lastTrigger, kind: "dialog", ok: false, error: msg, duration_ms: Date.now() - t0 });
      if (logEntry && logEntry.id) noteLog("distill", label, "error", "失败：" + msg);
      logErr("蒸馏失败：" + msg);
      return result;
    } finally {
      state.running = false;
      state.startedAt = null;
    }
  }

  function tick() {
    try {
      const cfg = readConfig();
      if (!cfg.enabled) return;
      if (state.running) return;
      if (runDateKey(cfg) === todayKey()) return;   // 今天跑过了
      const due = dueToday(cfg);
      const now = Date.now();
      if (now >= due.getTime()) runOnce("schedule").then(function (r) {
        /* [位置:lib/memory-distill.js·tick] [失败要有痕迹] [11-13 审查：runOnce 失败是 return {ok:false} 不是 throw，原来那个 .catch 永远不触发，定时跑挂了只在 saveConfig 里留一条；现在检查返回值补一条日志] [注释时间 2026-11-13] */
        if (r && r.ok === false) logErr("定时蒸馏失败：" + (r.error || "未知原因"));
      }, function (e) { logErr("定时触发异常：" + (e && e.message || e)); });
    } catch (e) {
      logErr("对表异常：" + (e && e.message || e));
    }
  }

  // 重启补跑：该时刻已过但在 30 分钟宽限窗内、且今天没跑过 → 补一次（防重启恰好跨过触发点导致整天漏跑）
  function catchupIfMissed() {
    try {
      const cfg = readConfig();
      if (!cfg.enabled) return;
      if (runDateKey(cfg) === todayKey()) return;
      const due = dueToday(cfg);
      const delta = Date.now() - due.getTime();
      if (delta > 0 && delta <= CATCHUP_WINDOW_MS) {
        logInfo("检测到今天 " + cfg.time + " 的蒸馏在重启窗口内被错过，补跑一次");
        runOnce("catchup").then(function (r) {
          if (r && r.ok === false) logErr("补跑蒸馏失败：" + (r.error || "未知原因"));
        }, function (e) { logErr("补跑异常：" + (e && e.message || e)); });
      }
    } catch (e) {
      logErr("补跑检查异常：" + (e && e.message || e));
    }
  }

  function start() {
    if (state.timer) return { started: false, note: "已在运行" };
    state.timer = setInterval(tick, CHECK_MS);
    if (state.timer.unref) state.timer.unref();
    const cfg = readConfig();
    const all = daySource.listDays(baseDir);
    logInfo("调度已启动：enabled=" + cfg.enabled + " time=" + cfg.time + " batch=" + cfg.batch_size +
      "（时区 " + TZ + "，本地现在 " + nowLocal() + "）可选天数 " + all.length +
      (searchContext ? "" : "；⚠ 未注入 searchContext，预取不可用"));
    catchupIfMissed();
    return { started: true, config: cfg, diaries: all.length };
  }

  function stop() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    return { stopped: true };
  }

  // ---------------- 蒸馏笔记（11-04）：把「还没蒸过的笔记」按同一份蒸馏提示词蒸成记忆，候选只进待审 ----------------
  /* [位置:lib/memory-distill.js·runNotes] [蒸馏笔记] [11-04：单纯想用那份提示词把笔记本里没蒸过的笔记整理一遍；不是按日期、不加材料选择器。流程：取 papers.json 里没标过「已蒸」的笔记 → 按字数分批（每批 ≤1.2 万字，单条 ≤6000 字截断给模型、取证用全文）→ 同一份蒸馏 system 提示词 + 笔记专用 user 提示词 → 候选取证（证据 id = #note_笔记id，只对笔记本身，不走对话二段检索）→ 进待审（走门卫查重）。成功的批次才标「已蒸」（state.notesDone），失败的下次还会蒸。11-12 改：支持 ro.skipIds——清单里叉掉的笔记本次全跳过。11-15 改：标记收窄到条级，有候选没进待审的笔记不标已蒸（笔记快照与 notesDone 同批写，否则快照一刷笔记就因「内容没变」从待蒸清单消失）。] [注释时间 2026-11-15] */
  const NOTE_BATCH_CHARS = 12000;
  const NOTE_MAX_CHARS = 6000;
  const paperStore = require("./paper-store");

  /* [位置:lib/memory-distill.js·notesSnap/noteDelta/notesPending] [蒸馏笔记·增量] [11-11：笔记会一直追加，原来只按 id 标「已蒸」看不到更新。现在每篇蒸完存一份内容快照（data/memory_distill_notes_snap.json）；没快照=新，内容和快照不一样=更新，只把改动段（公共前后缀之外）喂给模型，带一小段前文当背景。不自动跑，攒着等她点。首次加载按方案 A：notesDone 里的笔记以当前内容为底，只看之后的新改动] [注释时间 2026-11-11] */
  const NOTES_SNAP_FILE = path.join(baseDir, "data", "memory_distill_notes_snap.json");
  const NOTE_CTX_CHARS = 300;
  function readNotesSnap() {
    if (fs.existsSync(NOTES_SNAP_FILE)) return readJsonSafe(NOTES_SNAP_FILE, {});
    const snap = {};
    const done = readState().notesDone || {};
    let all = [];
    try { all = paperStore.listEntries(baseDir) || []; } catch (e) { all = []; }
    const at = nowIso();
    all.forEach(function (e) { if (e && e.id != null && done[String(e.id)]) snap[String(e.id)] = { at: at, content: String(e.content || ""), baseline: true }; });
    /* [位置:lib/memory-distill.js·readNotesSnap 初始化] [笔记快照原子写] [11-14 审查 B 批 b：首次初始化写入被打断会留下一份坏快照，之后所有笔记都被当「更新」重蒸一遍；改原子写，保持 spaces:0 紧凑格式（173KB）] [注释时间 2026-11-14] */
    try { writeJsonAtomic(NOTES_SNAP_FILE, snap, 0); } catch (e) { logWarn("笔记快照初始化写失败：" + e.message); }
    logInfo("笔记快照初始化：以当前内容为底 " + Object.keys(snap).length + " 篇");
    return snap;
  }
  /* [位置:lib/memory-distill.js·writeNotesSnap] [笔记快照原子写] [11-14 审查 B 批 b：同 readNotesSnap 初始化，半截 JSON 会让下次把所有笔记当更新重蒸；保持 spaces:0] [注释时间 2026-11-14] */
  function writeNotesSnap(snap) { writeJsonAtomic(NOTES_SNAP_FILE, snap, 0); }
  function noteDelta(oldText, cur) {
    const a = String(oldText || ""), b = String(cur || "");
    if (a === b) return null;
    let p = 0; const max = Math.min(a.length, b.length);
    while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let q = 0;
    while (q < max - p && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++;
    const added = b.slice(p, b.length - q);
    return { added: added, removed: a.length - p - q, ctx: b.slice(Math.max(0, p - NOTE_CTX_CHARS), p), appended: q === 0 && p === a.length };
  }
  function notesPending() {
    const snap = readNotesSnap();
    let all = [];
    try { all = paperStore.listEntries(baseDir) || []; } catch (e) { all = []; }
    const out = [];
    all.forEach(function (e) {
      if (!e || e.id == null || !String(e.content || "").trim()) return;
      const sp = snap[String(e.id)];
      if (!sp) { out.push(Object.assign({}, e, { _kind: "new", _chars: String(e.content).length })); return; }
      const d = noteDelta(sp.content, e.content);
      if (!d) return;
      if (!d.added.trim()) { out.push(Object.assign({}, e, { _kind: "trim", _chars: 0, _delta: d })); return; }   // 只删没加：不喂模型，蒸时顺手更新快照
      out.push(Object.assign({}, e, { _kind: "updated", _chars: d.added.length, _delta: d }));
    });
    return out;
  }
  function notesStatus() {
    let total = 0;
    try { total = (paperStore.listEntries(baseDir) || []).filter(function (e) { return e && String(e.content || "").trim(); }).length; } catch (e) {}
    const st = readState();
    const pend = notesPending();
    const real = pend.filter(function (e) { return e._kind !== "trim"; });
    return { total: total, pending: real.length, trimmed: pend.length - real.length,
      items: real.map(function (e) { return { id: e.id, title: e.title || "无标题", kind: e._kind, chars: e._chars, updated_at: e.updated_at || null }; }),
      last: st.notesLast || null, running: !!(state.running && state.runningKind === "notes") };
  }
  /* [位置:lib/memory-distill.js·defaultNotesUserPrompt] [蒸馏笔记的附加说明（User 段）默认文本] [11-04：可在提示词页单独改（distill_notes_user_prompt），留空用这里；${COUNT} 会换成本批笔记条数，笔记正文自动接在它后面] [注释时间 2026-11-04] */
  function defaultNotesUserPrompt() {
    return [
      "以下是 ${COUNT} 条笔记（我和她的笔记本里的条目）。每条前面的 #note_xx 是它的编号，这是本次唯一的证据源——上面说的 msg_id，在这里就指这个编号（evidence 写 note_xx）。",
      "逐条判断哪些值得长期记住，按上面规定的 JSON 格式输出；没有就输出 {\"candidates\":[]}。",
      "注意：笔记里的故事、梦、随手创作是虚构内容，不要当成事实抽；可以抽「某天做出了什么东西」这类事件，日期用笔记的创建日期。笔记里长期有效的约定、设定、使用说明可以抽。不需要提检索请求。",
    ].join("\n");
  }
  function buildNotesPrompt(packText, count) {
    const pc = readPromptConfig();
    const system = (pc.distill_system_prompt || "").trim() || defaultSystemPrompt();
    const tpl = (pc.distill_notes_user_prompt || "").trim() || defaultNotesUserPrompt();
    const user = tpl.split("${COUNT}").join(String(count)) + "\n\n" + packText;
    return { system: system, user: user };
  }
  async function runNotes(reason, runOpts) {
    if (state.running) return { ok: false, error: "已有蒸馏在跑，请等它结束", startedAt: state.startedAt };
    const ro = runOpts || {};
    state.running = true; state.runningKind = "notes"; state.startedAt = nowIso(); state.lastTrigger = String(reason || "manual"); state.lastError = null;
    const label = "记忆蒸馏·笔记（手动）";
    const logEntry = noteLog("distill", label, "pending", "开始：把没蒸过的笔记蒸成记忆");
    const t0 = Date.now();
    const res = { ok: true, startedAt: state.startedAt, notes: 0, batches: 0, batchesFailed: 0, candidates: 0, queued: 0, rejected: 0, queueFailed: 0, queueKeepNotes: 0, errors: [], model: null, noQueue: !!ro.noQueue };
    try {
      const pendAll = notesPending();
      /* [11-12：skipIds=清单里叉掉的笔记，本次全跳过。必须在 trims 更新快照之前过滤——「只删没加」的如果被顺手刷了快照，下次就不再出现在待蒸清单里；跳过的也不标已蒸，下次打开还在] */
      let work = pendAll, skipped = 0;
      if (Array.isArray(ro.skipIds) && ro.skipIds.length) {
        const sk = new Set(ro.skipIds.map(String));
        work = pendAll.filter(function (e) { const hit = sk.has(String(e.id)); if (hit) skipped++; return !hit; });
      }
      res.skipped = skipped;
      const trims = work.filter(function (e) { return e._kind === "trim"; });
      if (trims.length && !ro.noQueue) { const sn = readNotesSnap(); const at0 = nowIso(); trims.forEach(function (e) { sn[String(e.id)] = { at: at0, content: String(e.content) }; }); writeNotesSnap(sn); }
      const pending = work.filter(function (e) { return e._kind !== "trim"; });
      res.notes = pending.length; res.updated = pending.filter(function (e) { return e._kind === "updated"; }).length;
      const groups = []; let cur = [], chars = 0;
      pending.forEach(function (e) {
        const c = Math.min(e._kind === "updated" ? (e._delta.added.length + e._delta.ctx.length) : String(e.content).length, NOTE_MAX_CHARS) + 160;
        if (cur.length && chars + c > NOTE_BATCH_CHARS) { groups.push(cur); cur = []; chars = 0; }
        cur.push(e); chars += c;
      });
      if (cur.length) groups.push(cur);
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const idx = Object.create(null); const blocks = [];
        g.forEach(function (e) {
          const nid = "note_" + e.id;
          const full = String(e.content);
          idx[nid] = { msg_id: nid, content: full, time: e.updated_at || e.created_at || null, role: "note", session: null };
          if (e._kind === "updated") {
            const d = e._delta; const add = d.added.length > NOTE_MAX_CHARS ? d.added.slice(0, NOTE_MAX_CHARS) + "\n…（过长已截断）" : d.added;
            blocks.push("=== #" + nid + " · 《" + (e.title || "无标题") + "》 · 更新（上次蒸馏后" + (d.appended ? "追加" : "改动") + " " + d.added.length + " 字；旧内容已蒸过，只从【新增】里抽，【前文】只供理解、不要重复抽） · 修改 " + String(e.updated_at || "").slice(0, 10) + " ===\n" + (d.ctx ? "【前文】…" + d.ctx + "\n" : "") + "【新增】\n" + add);
            return;
          }
          const cut = full.length > NOTE_MAX_CHARS;
          blocks.push("=== #" + nid + " · 《" + (e.title || "无标题") + "》" + (e.folder ? " · 文件夹 " + e.folder : "") + " · 创建 " + String(e.created_at || "").slice(0, 10) + (e.updated_at && e.updated_at !== e.created_at ? " · 修改 " + String(e.updated_at).slice(0, 10) : "") + " ===\n" + (cut ? full.slice(0, NOTE_MAX_CHARS) + "\n…（过长已截断）" : full));
        });
        try {
          const pr = buildNotesPrompt(blocks.join("\n\n"), g.length);
          const r = await callLlm(pr.system, [{ role: "user", content: pr.user }]);
          if (r.model) res.model = r.model;
          const raw = String(r.text || "");
          try { fs.writeFileSync(path.join(baseDir, "data", "memory_distill_last_raw.txt"), raw, "utf-8"); } catch (e) {}
          const p = parseCandidates(raw);
          if (p.error) throw new Error(p.error);
          let verified = p.candidates || [];
          if (verified.length) verified = await verifyCandidates(verified, idx, { noSearch: true });
          const q = await queueCandidates(verified, !!ro.noQueue, "notes");
          res.candidates += verified.length; res.queued += q.queued; res.rejected += q.rejected; res.queueFailed += q.failed;
          res.batches += 1;
          logInfo("蒸馏笔记 第 " + (gi + 1) + "/" + groups.length + " 批完成：笔记 " + g.length + " 条 → 候选 " + verified.length + "，进待审 " + q.queued + "，拦 " + q.rejected + (q.failed ? ("，没进待审 " + q.failed) : ""));
          if (!ro.noQueue) {
            /* [位置:lib/memory-distill.js·runNotes 标记] [条级标记：没进待审的笔记不标已蒸，快照同批写] [需求:11-15：与对话路径 1093 的「入队失败不标 done」对齐；整组无条件标 + 刷快照会让失败那几条永久消失（快照一刷，notesPending 就认为它没变化）。快照只跟着 doneIds 写] [注释时间 2026-11-15] */
            const plan = notesDonePlan(g, q);
            res.queueKeepNotes += plan.keep;
            if (plan.ids.length) {
              const st = readState(); const nd = Object.assign({}, st.notesDone || {}); const at = nowIso();
              plan.ids.forEach(function (id) { nd[String(id)] = at; });
              writeState(Object.assign({}, st, { notesDone: nd }));
              const sn = readNotesSnap();
              g.forEach(function (e) { if (plan.ids.indexOf(String(e.id)) >= 0) sn[String(e.id)] = { at: at, content: String(e.content) }; });
              writeNotesSnap(sn);
            }
          }
        } catch (e) {
          res.batchesFailed += 1;
          res.errors.push("第 " + (gi + 1) + " 批：" + String((e && e.message) || e).slice(0, 120));
          logWarn("蒸馏笔记 第 " + (gi + 1) + " 批失败：" + String((e && e.message) || e));
        }
      }
      res.finishedAt = nowIso(); res.durationMs = Date.now() - t0;
      const skipTail = res.skipped ? ("；叉掉的 " + res.skipped + " 篇这次没蒸（下次还在清单里）") : "";
      /* [位置:lib/memory-distill.js·runNotes 回执] [失败要说人话] [需求:11-15：不能只报「进待审 N 条」——有候选没进待审就得明说，并说清相关笔记这次没标已蒸、下次还会蒸] [注释时间 2026-11-15] */
      const qFailTail = res.queueFailed
        ? ("，有 " + res.queueFailed + " 条候选没进待审" + (res.queueKeepNotes ? ("（" + res.queueKeepNotes + " 篇笔记这次没标已蒸，下次还会蒸）") : "（下次还会蒸）"))
        : "";
      res.note = res.notes ? ("笔记 " + res.notes + " 条（新 " + (res.notes - res.updated) + "、更新 " + res.updated + "）分 " + groups.length + " 批：成功 " + res.batches + " 批，抽出候选 " + res.candidates + " 条，进待审 " + res.queued + " 条，门卫拦 " + res.rejected + " 条" + (res.batchesFailed ? ("，失败 " + res.batchesFailed + " 批（下次还会蒸）") : "") + qFailTail + skipTail) : (res.skipped ? "叉掉的 " + res.skipped + " 篇这次没蒸，没有别的要蒸的" : "没有新的或更新过的笔记");
      if (!ro.noQueue) { const st2 = readState(); writeState(Object.assign({}, st2, { notesLast: { at: res.finishedAt, notes: res.notes, candidates: res.candidates, queued: res.queued, rejected: res.rejected, failed: res.batchesFailed, queue_failed: res.queueFailed, note: res.note } })); }
      appendRun({ id: runId(), ts: res.finishedAt, trigger: state.lastTrigger, kind: "notes", ok: !res.batchesFailed && !res.queueFailed, summary: res.note, duration_ms: res.durationMs });
      if (logEntry && logEntry.id) noteLog("distill", label, (res.batchesFailed || res.queueFailed) ? "error" : "success", res.note);
      logInfo("蒸馏笔记跑完：" + res.note);
      return res;
    } catch (err) {
      const msg = err && err.message ? String(err.message) : String(err);
      state.lastError = msg;
      if (logEntry && logEntry.id) noteLog("distill", label, "error", "失败：" + msg);
      logErr("蒸馏笔记失败：" + msg);
      appendRun({ id: runId(), ts: nowIso(), trigger: state.lastTrigger, kind: "notes", ok: false, error: msg, duration_ms: Date.now() - t0 });
      return { ok: false, error: msg, startedAt: res.startedAt, finishedAt: nowIso() };
    } finally {
      state.running = false; state.runningKind = null; state.startedAt = null;
    }
  }


  function status() {
    const cfg = readConfig();
    const st = readState();
    // 1004-11：选材已按天（planDay 写 st.done 用天 key），进度统计必须同口径——
    // 旧 listDiaries 按日记 relPath 查 done 永远查不到，管理台进度显示失真。
    const all = daySource.listDays(baseDir);
    const pending = all.filter(function (d) { return !st.done[d]; });
    return {
      running: state.running,
      startedAt: state.startedAt,
      lastTrigger: state.lastTrigger,
      lastError: state.lastError,
      runs: state.runs,
      schedulerOn: !!state.timer,
      checkMs: CHECK_MS,
      timezone: TZ,
      nowLocal: nowLocal(),
      today: todayKey(),
      ranToday: runDateKey(cfg) === todayKey(),
      prefetchReady: !!searchContext,
      progress: {
        total: all.length,
        done: all.length - pending.length,
        pending: pending.length,
        batches: st.batches,
        lastBatchAt: st.lastBatchAt,
        lastBatch: st.lastBatch,
      },
      config: cfg,
      notes: notesStatus(),
    };
  }

  return {
    configPath: CFG_FILE,
    statePath: STATE_FILE,
    readConfig: readConfig,
    saveConfig: saveConfig,
    readState: readState,
    listDiaries: listDiaries,
    // 1004：选材改为按天（旧 planBatch/packBatch 已删除）
    planDay: planDay,
    packDay: packDay,
    listDays: function () { return daySource.listDays(baseDir); },
    buildDistillPrompt: buildDistillPrompt,
    // 1003 自提检索（导出供排障/单测）
    parseResponse: parseResponse,
    searchForDiary: searchForDiary,
    handleSearchRequests: handleSearchRequests,
    defaultSystemPrompt: defaultSystemPrompt,
    defaultUserPrompt: defaultUserPrompt,
    readPromptConfig: readPromptConfig,
    savePromptConfig: savePromptConfig,
    evidenceScore: evidenceScore,
    parseCandidates: parseCandidates,
    verifyCandidates: verifyCandidates,   // 测试钩子（11-08：uuid 直捞抓拍 snapshotted 用例）
    runNow: function (reason, runOpts) { return runOnce(reason || "manual", runOpts); },
    runNotes: function (reason, runOpts) { return runNotes(reason || "manual", runOpts); },
    notesStatus: notesStatus,
    runsInfo: runsInfo,
    defaultNotesUserPrompt: defaultNotesUserPrompt,
    /* [位置:lib/memory-distill.js·daysStatus] [日期清单+是否蒸过] [11-03：手动选日期用——时间线里有的每一天（新到旧）+ 蒸过的完成时间；今天标 today（还没过完，默认不会自动蒸）] [注释时间 2026-11-03] */
    daysStatus: function () {
      const st = readState(), today = todayKey();
      return daySource.listDays(baseDir).slice().sort().reverse().map(function (d) { return { date: d, done: st.done[d] || null, today: d === today }; });
    },
    start: start,
    stop: stop,
    status: status,
    _state: state,
    _planDay: planDay,   // 测试钩子：选材逻辑（只算不写盘，完成标记在 runOnce 成功后才写）
    _markDone: markDone, // 测试钩子：把一批日期标成已蒸（runOnce 成功路径用）
  };
};
