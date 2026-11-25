'use strict';
// subagent-preset-runner.js —— 子智能体 = 「用预设开的普通会话」（2026-10-27 产品确定，需求单第 12 项）
//
// 用户的思路：开子会话就是 AI 自己用预设开了个会话；取报告就是在时间线里按标签提取；真正新搞的只有 log
//   （给主 AI 看的简化版时间线）；前端只是用抽屉打开另一个会话。所以这里不再自己跑工具循环，全部走普通会话流水线：
//   start  = POST /v1/sessions/from-preset 建会话（人设/模型/工具规则/跨窗口/样式一次配好）+ 后台发一次 /v1/chat/completions（非流式）
//            同一 session_id 再 start = 往这个会话追加一条 user 提示词再发一次
//   report = 读会话时间线，按 <标签> 提取最新一份
//   log    = 从时间线按需派生：AI 的每次工具请求（名+参数）+ 每段正文，带稳定行号，长文按 1800 字切块（格式同旧版）
//   stop   = POST /v1/chat/stop
//   状态   = 会话是否正在生成（activeGenMap）+ 时间线末尾是什么，不再有「记录说 running 但已死」的惰性判定
// 内部发请求用 app.inject（不过网络），带管理员 Basic 凭据 + 网关 key + x-client: dylan-chat，行为与手机发的完全一致。
// 并发不限（10-27），30 分钟绝对超时到点自动 stop。
// 旧引擎 lib/subagent-runner.js 保留，按 lib/subagent-engine.js 分发（老的 s_sub_ 会话有旧记录文件，仍走旧引擎）。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const meta = require('./session-meta');
const { timelineDirOf } = require('./timeline-dir');

const SID_PREFIX = 's_sub_';
const DEFAULT_PRESET = 'sp_sub_agent';
const ABS_TIMEOUT_MS = 30 * 60 * 1000;
const SUMMARY_MAX = 20;
const WINDOW_MSGS = 30;      // 追加提示词时随请求带的历史条数（时间线「尾部对齐」按内容键认，带上才不会把已有回复当成要清的尾巴）
const LOG_BLOCK = 1800;

function taskSummary(task) { return String(task || '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) || '任务'; }
function isReal(m) { return !!m && !m.deleted && !m.hidden && (m.role === 'user' || m.role === 'assistant'); }
function textOf(m) { return typeof m.content === 'string' ? m.content : ''; }
function hasProcess(m) {
  return m.role === 'assistant' && ((Array.isArray(m.stream_timeline) && m.stream_timeline.length) || m.reasoning || (Array.isArray(m.tools) && m.tools.length));
}

/* [位置:subagent-preset-runner.js·taskBoundary] [任务边界：报告防旧的锚点] [10-31 报「取报告拿到旧卷子」：原 findReport 从整个时间线往前扫 report 标签，最新任务（18:55 租赁调研）被上游掐断一个字没写时，扫到的是上一个任务的旧报告，包在返回里被主 AI 当新报告用了。改：时间线里最后一条 user 消息=最新任务（位置/序号/开头预览）；tag 为空时只在它之后找报告，找不到就明说，绝不拿旧报告充数；按特定 tag 取（如 report_02）不受限——序号定位不会重复（报告有序号，按序号取不会错）] [注释时间 2026-10-31] */
function taskBoundary(arr) {
  let idx = -1, no = 0;
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (isReal(m) && m.role === 'user' && textOf(m).trim()) { no++; idx = i; }
  }
  if (idx < 0) return null;
  return { idx: idx, no: no, preview: textOf(arr[idx]).replace(/\s+/g, ' ').trim().slice(0, 24) };
}
/* [位置:subagent-preset-runner.js·modelGroupOf] [子会话模型组：主模型在前、备用在后] [10-31 模型组 failover；2026-11-01 审查修复两处：① 预设 md 是主模型、mdg 是备用（与预设编辑页一致），原来有 mdg 就丢掉 md，主模型永远轮不到；现在 md 永远排第一，mdg 去重只作备用。② 每个候选带出 provider_id（原来被剥掉只剩模型名），配合 start 里的逐轮切换——网关 resolveChatModel 会话级 provider/model 优先、会忽略 body.model，不切会话配置的话所有候选实际都打在主模型上（11-01 04:02 实测：日志写着试 deepseek-flash，上游跑的仍是 glm-5.3-flash）] [注释时间 2026-10-31；2026-11-01 修复] */
function parseCandidate(x) {
  const s = String(x || '').trim();
  const i = s.indexOf('|');
  return i < 0 ? { provider_id: '', model: s } : { provider_id: s.slice(0, i).trim(), model: s.slice(i + 1).trim() };
}
function modelGroupOf(preset) {
  const list = [];
  if (preset && preset.md) { const p = parseCandidate(preset.md); if (p.model) list.push(p); }
  if (preset && Array.isArray(preset.mdg)) preset.mdg.forEach(function (x) { const p = parseCandidate(x); if (p.model) list.push(p); });
  const seen = {};
  const out = list.filter(function (p) { const k = p.provider_id + '|' + p.model; if (seen[k]) return false; seen[k] = 1; return true; });
  if (!out.length) out.push({ provider_id: '', model: '' });
  return out.slice(0, 5);
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function summarizeAttempt(model, error) { return { model: model || '', error: String(error || '').slice(0, 200) }; }
/* [位置:subagent-preset-runner.js·taskHasReplySince] [这轮请求有没有真产出] [200 但本次尝试开始后时间线里仍没有 assistant 内容=上游一个字没吐（空闲超时被掐/空回复），failover 当失败换下一个；吐过正文或调过工具就算产出。2026-11-01：判定从「请求前数组长度」改成「本次尝试开始时间」——上一次失败留下的半截 assistant 会被下一次请求的尾部对齐截掉，按长度比会把新回复误判成零产出、甚至绕过好模型] [注释时间 2026-10-31；2026-11-01 改按时间判定] */
function taskHasReplySince(arr, sinceIso) {
  const since = Date.parse(sinceIso) || 0;
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (!isReal(m) || m.role !== 'assistant') continue;
    const t = Date.parse(m.time || '') || 0;
    if (t && t < since) continue;
    if (textOf(m).trim() || hasProcess(m)) return true;
  }
  return false;
}

module.exports = function createPresetRunner(deps) {
  const { baseDir, readEnvValue, inject, loadTimeline, getGen } = deps;
  const nowIso = deps.now || function () { return new Date().toISOString(); };
  const _inflight = new Map();    // sid -> {startedAt, timer, aborted, modelTouched}
  /* [位置:subagent-preset-runner.js·_errors] [失败原因的有效期] [2026-11-01 审查：值改成 {msg, ts}，1 小时内有效；时间线里出现比错误更新的 assistant 回复（用户手动续聊成功）也立即失效——原来只在下一次派活时清，失败后手动续聊成功状态仍永久 failed] [注释时间 2026-11-01] */
  const _errors = new Map();      // sid -> {msg, ts}
  const ERR_TTL_MS = 60 * 60 * 1000;
  const _stCache = new Map();     // sid -> {m, st}

  function timelineFile(sid) { return path.join(timelineDirOf(baseDir), 'enhanced_messages_' + sid + '.json'); }
  function readTimeline(sid) { try { const t = loadTimeline(sid); return Array.isArray(t) ? t : []; } catch (e) { return []; } }

  /* [位置:subagent-preset-runner.js·writePlaceholderTimeline] [新建派单先落占位任务消息] [2026-10-31报「抽屉显示找不到子智能体 s_sub_30299319」：新引擎子会话的状态全在时间线+内存里，from-preset 只配会话不建时间线文件，第一次聊天回复落盘才建文件；若后台聊天请求随网关重启被杀（10-31 05:55 的 s_sub_8f529f69/s_sub_30299319 就是这么丢的），时间线一行没写，重启后 statusOf=not_found，抽屉只能显示「找不到」，无法区分「不存在」和「派了被杀」。改：from-preset 成功后、发聊天请求前，先原子写入占位 user 消息（与聊天请求里那条同 id 同内容——正式落盘 appendRequestMessages 按 id 认出跳过，不会重复）；请求被杀时时间线留有任务全文，statusOf=interrupted，抽屉显示「已中断」] [注释时间 2026-10-31] */
  function writePlaceholderTimeline(sid, userMsg) {
    try {
      const f = timelineFile(sid);
      const tmp = f + '.tmp';
      const placeholder = [{ id: userMsg.id, role: userMsg.role, content: userMsg.content, time: nowIso(), position: 0.5 }];
      fs.writeFileSync(tmp, JSON.stringify(placeholder), 'utf-8');
      fs.renameSync(tmp, f);
    } catch (e) { console.warn('[subagent] 占位时间线写入失败（不影响派单）: ' + (e && e.message ? e.message : e)); }
  }
  /* [位置:subagent-preset-runner.js·appendTaskTimeline] [复用派单也先落任务消息] [2026-11-01 审查修复：占位只给新建，复用靠聊天请求落任务；请求在落盘前被杀（网关重启/上游直接挂）时时间线末尾还是上一个任务，statusOf 误判 done，report 空标签把上一个任务的旧报告当本轮最新交出去——10-31 修的报告防旧在复用路径漏了。复用派单改为先原子追加本次任务 user 消息（与聊天请求同 id 同内容，appendRequestMessages 按内容键去重不会重复）；被杀时状态是 interrupted、任务边界正确] [注释时间 2026-11-01] */
  function appendTaskTimeline(sid, userMsg) {
    try {
      const f = timelineFile(sid);
      const arr = readTimeline(sid);
      let maxPos = 0;
      for (const m of arr) { if (m && m.position && m.position > maxPos) maxPos = m.position; }
      arr.push({ id: userMsg.id, role: 'user', content: userMsg.content, time: nowIso(), position: maxPos + 0.5 });
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(arr), 'utf-8');
      fs.renameSync(tmp, f);
    } catch (e) { console.warn('[subagent] 任务消息落时间线失败（不影响派单）: ' + (e && e.message ? e.message : e)); }
  }
  function readSessionModel(sid) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'session_cfg', sid + '.json'), 'utf-8'));
      return { provider_id: String(o.model_provider_id || ''), model: String(o.model_name || '') };
    } catch (e) { return null; }
  }
  /* [位置:subagent-preset-runner.js·providerForModel] [只给了模型名时按模型表找供应商] [mdg 元素规范格式是 providerId|model；手写/旧预设可能只有模型名，直接带 null 供应商会落到全局默认、模型名对不上就回退成供应商默认模型（又打回原模型），这里按 ai-providers.json 的 models 表找回正确供应商] [注释时间 2026-11-01] */
  function providerForModel(model) {
    const want = String(model || '').trim();
    if (!want) return '';
    try {
      const L = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'ai-providers.json'), 'utf-8'));
      const provs = Array.isArray(L) ? L : ((L && L.providers) || []);
      const hit = provs.find(function (p) {
        if (!p || p.enabled === false) return false;
        const ms = Array.isArray(p.models) && p.models.length ? p.models : (p.model ? [p.model] : []);
        return ms.indexOf(want) >= 0;
      });
      return hit ? String(hit.id || '') : '';
    } catch (e) { return ''; }
  }
  /* [位置:subagent-preset-runner.js·stripSubInherit] [子会话不继承主会话状态] [2026-11-01 审查：from-preset 的跨窗口步骤在空时间线时会写 inherit（含当前主会话 state_text 副本），子会话 xw 关着用不到，只是把用户的状态复制进子会话配置；建完删掉 inherit，别的字段不动] [注释时间 2026-11-01] */
  function stripSubInherit(sid) {
    try {
      const f = path.join(baseDir, 'data', 'session_cfg', sid + '.json');
      const o = JSON.parse(fs.readFileSync(f, 'utf-8'));
      if (o && o.inherit) {
        delete o.inherit;
        const tmp = f + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf-8');
        fs.renameSync(tmp, f);
      }
    } catch (e) { /* 没有配置/读不了就不管 */ }
  }
  async function switchModel(sid, cand) {
    const pid = cand.provider_id || (cand.model ? providerForModel(cand.model) : '');
    return post('/v1/sessions/' + encodeURIComponent(sid) + '/model-provider', {
      model_provider_id: pid || null, model_name: cand.model || ''
    });
  }

  function gatewayHeaders() {
    const h = { 'content-type': 'application/json', 'x-client': 'dylan-chat' };
    const u = process.env.ADMIN_USER, p = process.env.ADMIN_PASSWORD;
    if (u && p) h.authorization = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
    const gk = readEnvValue ? readEnvValue('GATEWAY_API_KEY') : '';
    if (gk) h['x-gateway-api-key'] = gk;
    return h;
  }

  function readPresets() {
    try {
      const cs = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'chat-settings.json'), 'utf-8'));
      const L = (cs.cfg || {}).sess_presets;
      return Array.isArray(L) ? L : [];
    } catch (e) { return []; }
  }
  function findPreset(key) {
    const k = String(key || '').trim() || DEFAULT_PRESET;
    const L = readPresets();
    return L.find(function (p) { return p && p.id === k; }) || L.find(function (p) { return p && p.name === k; }) || null;
  }

  async function post(url, payload) {
    return inject({ method: 'POST', url: url, headers: gatewayHeaders(), payload: JSON.stringify(payload) });
  }
  function errMsg(r) {
    let m = ''; try { const j = JSON.parse(r.body); m = j.error || j.message || ''; } catch (e) { m = String(r.body || '').slice(0, 120); }
    return 'HTTP ' + r.statusCode + (m ? ' ' + String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 160) : '');
  }

  // ---- 状态 ----
  function generating(sid) {
    if (_inflight.has(sid)) return true;
    const g = getGen ? getGen(sid) : null;
    return !!(g && !g.done);
  }
  function lastRealRole(tl) { for (let i = tl.length - 1; i >= 0; i--) { if (isReal(tl[i]) && (textOf(tl[i]).trim() || hasProcess(tl[i]))) return tl[i].role; } return ''; }
  function lastAssistantTime(tl) { let t = ''; for (const m of tl) { if (isReal(m) && m.role === 'assistant' && m.time) { const s = String(m.time); if (s > t) t = s; } } return t; }
  /* [位置:subagent-preset-runner.js·errOf] [失败原因的有效期] [2026-11-01 审查：_errors 原来只在下一次派活时删、注释却写「1 小时」，失败后用户进子会话手动续聊成功，状态仍永久 failed；现在 1 小时过期，且时间线里出现比错误时间更新的 assistant 回复就清掉（那条错误不再代表当前状态）] [注释时间 2026-11-01] */
  function errOf(sid) {
    const e = _errors.get(sid);
    if (!e) return null;
    if (Date.now() - (e.ts || 0) > ERR_TTL_MS) { _errors.delete(sid); return null; }
    const last = lastAssistantTime(readTimeline(sid));
    if (last && Date.parse(last) > (e.ts || 0)) { _errors.delete(sid); return null; }
    return e.msg;
  }
  function statusOf(sid) {
    if (generating(sid)) return 'running';
    const tl = readTimeline(sid);
    if (!tl.length) return 'not_found';
    const g = getGen ? getGen(sid) : null;
    if (g && g.done && g.aborted) return 'stopped';
    if (errOf(sid) || (g && g.done && g.error)) return 'failed';
    return lastRealRole(tl) === 'assistant' ? 'done' : 'interrupted';
  }
  function statusAll() {
    const out = {};
    let files = [];
    try { files = fs.readdirSync(timelineDirOf(baseDir)); } catch (e) { return out; }
    for (const f of files) {
      const m = f.match(/^enhanced_messages_(s_sub_[A-Za-z0-9_-]+)\.json$/);
      if (!m) continue;
      const sid = m[1];
      if (generating(sid)) { out[sid] = 'running'; continue; }
      try {
        const mt = fs.statSync(path.join(timelineDirOf(baseDir), f)).mtimeMs;
        const c = _stCache.get(sid);
        const dyn = !!errOf(sid);
        if (c && c.m === mt && !dyn && c.st !== 'failed') { out[sid] = c.st; continue; }
        const st = statusOf(sid);
        _stCache.set(sid, { m: mt, st: st }); out[sid] = st;
      } catch (e) {}
    }
    return out;
  }

  // ---- 派活 ----
  function windowMessages(sid) {
    return readTimeline(sid).filter(function (m) { return isReal(m) && textOf(m).trim(); }).slice(-WINDOW_MSGS)
      .map(function (m) { return { id: m.id, role: m.role, content: textOf(m) }; });
  }

  /* [位置:subagent-preset-runner.js·start] [派活：新建/复用 + 模型组逐个试] [10-31 定稿；2026-11-01 审查修复：① 每轮先切会话模型再发请求——网关 resolveChatModel 会话级 provider/model 优先、忽略 body.model，不切配置时所有候选实际都打在主模型上 ② 复用也先落任务消息，防请求被杀后 report 交旧卷子 ③ 产出判定按本次尝试开始时间 ④ 结束/全失败还原派单前的会话模型 ⑤ 预设建会话的人设/工具/模型步骤失败直接报错，不带半个预设干活] [注释时间 2026-10-31；2026-11-01 修复] */
  async function start(opts) {
    const task = String((opts && opts.task) || '').trim();
    const reuseSid = String((opts && opts.session_id) || '').trim();
    if (!task) return { ok: false, error: '缺少 task（任务提示词）' };
    /* [位置:subagent-preset-runner.js·start model 校验] [主会话可指定本次任务模型] [11-14 随手记 #24：传了 model 先校验在启用供应商列表里（resolveModelByName），不在直接报错不建会话不盲跑；通过就单候选——显式指定只跑指定的，失败不偷偷换预设备胎，跑完还原会话模型的原逻辑不变；不传维持预设模型组] [注释时间 2026-11-14] */
    const wantModel = String((opts && opts.model) || '').trim();
    let explicitModel = null;
    if (wantModel) {
      const modelRouter = require('./model-router');
      const hit = modelRouter.resolveModelByName(wantModel);
      if (!hit) {
        const names = [];
        modelRouter.listEnabledModels().forEach(function (p) { (p.models || []).forEach(function (m) { if (names.indexOf(m) < 0) names.push(m); }); });
        const avail = names.length ? names.slice(0, 30).join('、') + (names.length > 30 ? ' …' : '') : '';
        return { ok: false, error: '模型「' + wantModel + '」不在启用列表里，没派活。' + (avail ? '可用的（部分）：' + avail + '；' : '当前没有启用中的供应商。') + '用 models 工具看完整清单。' };
      }
      explicitModel = { provider_id: hit.provider.id, model: hit.model };
    }

    let sid = reuseSid, preset, history = [];
    if (reuseSid) {
      if (reuseSid.indexOf(SID_PREFIX) !== 0) return { ok: false, error: 'session_id 不是子智能体会话（应以 ' + SID_PREFIX + ' 开头）' };
      if (!readTimeline(reuseSid).length) return { ok: false, error: '找不到子智能体 ' + reuseSid + ' 的时间线（可能已被删）；重新新建一个吧' };
      if (generating(reuseSid)) return { ok: false, error: '该子智能体上一轮还在跑，先用 report/log 看进度，别急' };
      history = windowMessages(reuseSid);
      preset = findPreset(opts && opts.preset);   // 复用时只为取模型组；预设找不到不拦（会话自己已配好）
    } else {
      preset = findPreset(opts && opts.preset);
      if (!preset) {
        const names = readPresets().map(function (p) { return p && p.name; }).filter(Boolean).join('、') || '（没有预设）';
        return { ok: false, error: '找不到子会话预设「' + String((opts && opts.preset) || DEFAULT_PRESET) + '」。去 小手机 → 我的 → 新建会话预设 建一个（建议叫「子会话」），现有预设：' + names };
      }
      sid = SID_PREFIX + crypto.randomBytes(4).toString('hex');
      let r;
      try { r = await post('/v1/sessions/from-preset', { preset_id: preset.id, session_id: sid }); }
      catch (e) { return { ok: false, error: '用预设建会话失败：' + e.message }; }
      if (r.statusCode >= 400) return { ok: false, error: '用预设建会话失败：' + errMsg(r) };
      /* [位置:subagent-preset-runner.js·start 预设步骤校验] [预设没配全不许开工] [2026-11-01 审查：from-preset 只要有一项生效就返回 200（跨窗口永远第一项、几乎必成），人设/工具/模型失败被吞；子会话会带着全局人设和全量工具跑，属 10-23 事故面。人设/工具/模型任一失败直接报错，会话没有时间线也不会出现在会话列表] [注释时间 2026-11-01] */
      let j = {};
      try { j = JSON.parse(String(r.body || '{}')); } catch (e) { j = {}; }
      if (j && j.ok === false) return { ok: false, error: '用预设建会话失败：' + (j.error || '未知原因') };
      const failed = Array.isArray(j && j.failed) ? j.failed : [];
      const critical = failed.filter(function (f) { return /人设|工具|模型/.test(String((f && f.item) || '')); });
      if (critical.length) {
        return { ok: false, error: '子会话预设没配全（' + critical.map(function (f) { return String(f.item || '') + '：' + String(f.error || ''); }).join('；') + '）；这次没派活，把预设补好再试' };
      }
      try { meta.applyTitle(sid, '子进程 · ' + taskSummary(task)); } catch (e) {}
    }
    stripSubInherit(sid);   // 新建/复用都清一次：复用的老会话可能带着旧代码写进去的 inherit

    /* [位置:subagent-preset-runner.js·start 任务落时间线] [复用也先落任务消息] [2026-11-01：原来只有新建写占位，复用靠聊天请求落任务；请求在落盘前被杀（网关重启/上游直接挂）时时间线末尾还是上一个任务，statusOf 误判 done，report 空标签把上一个任务的旧报告当本轮最新——10-31 修的防旧在复用路径漏了。taskNo 必须在追加之前算] [注释时间 2026-11-01] */
    const group = explicitModel ? [explicitModel] : modelGroupOf(preset);   // 11-14 随手记 #24：显式指定=单候选，不换预设备胎
    const userMsg = { id: crypto.randomUUID(), role: 'user', content: task };
    const taskNo = (taskBoundary(readTimeline(sid)) || { no: 0 }).no + 1;   // 本任务是子会话第几个
    if (!reuseSid) writePlaceholderTimeline(sid, userMsg); else appendTaskTimeline(sid, userMsg);
    _errors.delete(sid);
    const originalModel = readSessionModel(sid);   // 派单前的会话模型，收尾还原
    const entry = { startedAt: Date.now(), timer: null, aborted: false, modelTouched: false };
    _inflight.set(sid, entry);
    entry.timer = setTimeout(function () { entry.aborted = true; stop({ session_id: sid }).catch(function () {}); }, ABS_TIMEOUT_MS);
    if (entry.timer.unref) entry.timer.unref();
    (async function () {
      const attempts = [];
      let ok = false;
      let curModel = originalModel || { provider_id: '', model: '' };
      try {
        for (let i = 0; i < group.length; i++) {
          if (entry.aborted) break;
          const cand = group[i];
          const label = (cand && cand.model) || '';
          /* [位置:subagent-preset-runner.js·start 切模型] [候选模型要真的切到会话上] [网关的会话级 provider/model 优先于请求里的 model；不切配置，所有候选都会被打成主模型，failover 形同虚设] [注释时间 2026-11-01] */
          if (cand && (cand.provider_id || cand.model)) {
            const effPid = cand.provider_id || (cand.model ? providerForModel(cand.model) : '');
            const eff = { provider_id: effPid, model: cand.model || '' };
            if (eff.provider_id !== (curModel.provider_id || '') || eff.model !== (curModel.model || '')) {
              let sw;
              try { sw = await switchModel(sid, cand); } catch (e) { attempts.push(summarizeAttempt(label, '切换模型失败：' + (e && e.message ? e.message : e))); continue; }
              if (sw && sw.statusCode >= 400) { attempts.push(summarizeAttempt(label, '切换模型失败：' + errMsg(sw))); continue; }
              curModel = eff;
              entry.modelTouched = true;
            }
          }
          if (entry.aborted) break;
          const startedIso = nowIso();
          const body = { session_id: sid, stream: false, messages: history.concat([userMsg]) };
          if (cand && cand.model) body.model = cand.model;
          let r;
          try { r = await post('/v1/chat/completions', body); }
          catch (e) {
            attempts.push(summarizeAttempt(label, e.message || String(e)));
            console.warn('[subagent] 模型「' + (label || '会话默认') + '」请求失败，' + (i + 1 < group.length ? '换下一个：' + (group[i + 1].model || '会话默认') : '没有下一个了') + ' sid=' + sid);
            if (entry.aborted) break;
            continue;
          }
          if (entry.aborted) { attempts.push(summarizeAttempt(label, '已终止')); break; }   // 终止/超时后不再试下一个
          if (r.statusCode >= 400) {
            attempts.push(summarizeAttempt(label, errMsg(r)));
            console.warn('[subagent] 模型「' + (label || '会话默认') + '」HTTP ' + r.statusCode + '，' + (i + 1 < group.length ? '换下一个：' + (group[i + 1].model || '会话默认') : '没有下一个了') + ' sid=' + sid);
            continue;
          }
          if (!taskHasReplySince(readTimeline(sid), startedIso)) {
            attempts.push(summarizeAttempt(label, '上游一个字没吐（空闲超时被中断）'));
            console.warn('[subagent] 模型「' + (label || '会话默认') + '」零产出，' + (i + 1 < group.length ? '换下一个：' + (group[i + 1].model || '会话默认') : '没有下一个了') + ' sid=' + sid);
            continue;
          }
          ok = true;
          break;   // 这个模型成了
        }
        if (entry.aborted) return;
        if (!ok && attempts.length) {
          const detail = attempts.map(function (a) { return (a.model || '会话默认模型') + '：' + a.error; }).join('；');
          _errors.set(sid, { msg: '模型组全试完都失败 —— ' + detail, ts: Date.now() });
          console.warn('[subagent] 模型组全失败 sid=' + sid + ' ' + detail);
        }
      } finally {
        clearTimeout(entry.timer);
        /* [位置:subagent-preset-runner.js·start 还原模型] [派完把会话模型还原成派单前] [failover 的落点不该变成会话默认：下次手动聊/下次派活仍按预设的主模型走，备用只在本次失败时顶一下] [注释时间 2026-11-01] */
        if (entry.modelTouched) {
          try {
            const om = originalModel || { provider_id: '', model: '' };
            await switchModel(sid, { provider_id: om.provider_id || '', model: om.model || '' });
          } catch (e) { /* 还原失败不影响本次结果 */ }
        }
        _inflight.delete(sid);   // 还原期间仍算「在跑」，防这次派活刚结束就被下一单抢进同一个会话
      }
    })();
    return {
      ok: true, subagent_id: sid, reused: !!reuseSid, model: group[0] ? group[0].model : '', model_group: group.map(function (p) { return p.model; }).filter(Boolean), status: 'started',
      hint: '已开工（本子会话第 ' + taskNo + ' 个任务，报告标签建议 <report_' + pad2(taskNo) + '>）。过一会儿用 action=report（subagent_id=' + sid + '，不填标签=只取本任务产出的最新报告，不会拿旧任务的报告充数；要指定旧的才填 tag）取报告；action=log 按行号看过程。' + (group.length > 1 ? '预设配了 ' + group.length + ' 个候选模型，一个失败自动换下一个（每个失败要等约 2 分钟才判定）。' : '') + '子模型跑得慢，可以给自己定个 wake（比如 5 分钟后）到点回来查，不设也行。'
    };
  }

  /* [位置:subagent-preset-runner.js·stop] [终止：同时掐掉 failover 循环] [2026-11-01 审查：原来只 inject /v1/chat/stop，循环只认 30 分钟超时的 aborted；用户点终止后当前请求断了，循环会接着试下一个候选，看起来「点了终止又自己跑」。现在同时给 _inflight 打 aborted，当前请求返回后立即收尾、不再换模型] [注释时间 2026-10-26；2026-11-01 修复] */
  async function stop(opts) {
    const sid = String((opts && opts.session_id) || '').trim();
    if (!sid) return { ok: false, error: '缺少 session_id' };
    let r;
    try { r = await post('/v1/chat/stop', { session_id: sid }); } catch (e) { return { ok: false, error: e.message }; }
    if (r.statusCode >= 400) return { ok: false, error: errMsg(r) };
    const entry = _inflight.get(sid);
    if (entry) {
      entry.aborted = true;
      if (entry.timer) clearTimeout(entry.timer);
    }
    return { ok: true, session_id: sid, status: 'stopping', message: entry ? '终止信号已发，本次派活不会再换下一个模型' : '终止信号已发，正在收尾落盘' };
  }

  // ---- 取报告 ----
  /* [位置:subagent-preset-runner.js·findReport] [报告标签统一为 report_NN；tag 可不填] [10-27：子 AI 的报告标签固定成 <report_01>…</report_01>（第几次任务几号，AI 随便按序编也行）；主 AI 取报告不用再指定标签——不填就取最新一份 report_NN（没有再退到 <report>），填了就按填的取。原来主 AI 在任务里自己约定标签（如 <today>）、提示词里又写 <report>，一次回复里出现两个标签] [注释时间 2026-10-27] */
  function findReport(sid, tag) {
    const given = String(tag || '').trim();
    const arr = readTimeline(sid);
    const esc = function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    const pats = given ? [{ name: given, re: new RegExp('<\\s*' + esc(given) + '\\s*>([\\s\\S]*?)<\\s*/\\s*' + esc(given) + '\\s*>', 'ig') }]
      : [{ name: '', re: /<\s*(report_\d+)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/ig }, { name: 'report', re: /<\s*(report)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/ig }];
    const b = given ? null : taskBoundary(arr);   // 2026-10-31 防旧：不填标签只认「最新一次任务」之后的产出；填了标签按序号精确取，不受限
    const from = b ? b.idx : 0;
    for (const p of pats) {
      for (let i = arr.length - 1; i >= from; i--) {
        const m = arr[i];
        if (!m || m.hidden || m.role !== 'assistant') continue;
        let last = null, mm;
        p.re.lastIndex = 0;
        while ((mm = p.re.exec(textOf(m)))) { const body = given ? mm[1] : mm[2]; if (body && body.trim()) last = { tag: given || mm[1], text: body.trim(), time: m.time || '' }; }
        if (last) {
          if (b) { last.task_no = b.no; last.task_preview = b.preview; }
          return last;
        }
      }
    }
    return null;
  }
  function report(opts) {
    const sid = String((opts && opts.session_id) || '').trim();
    const tag = String((opts && opts.tag) || '').trim();   // 可不填：只取「最新一次任务」自己产出的报告
    if (!sid) return { status: 'not_found', message: '缺少 session_id' };
    const st = statusOf(sid);
    if (st === 'not_found') return { status: 'not_found', message: '找不到子智能体 ' + sid };
    const hit = findReport(sid, tag);
    const what = tag || 'report_NN';
    if (hit) {
      /* [位置:subagent-preset-runner.js·report 命中] [返回带元信息：第几个任务/任务预览/报告时间] [10-31：主 AI 拿到报告要能一眼核对是不是自己派的那个活] [注释时间 2026-10-31] */
      const out = { status: st, report: hit.text, tag: hit.tag };
      if (hit.task_no) { out.task_no = hit.task_no; out.task_preview = hit.task_preview; }
      if (hit.time) out.report_time = hit.time;
      if (st === 'running') out.message = '任务还在跑，这是它目前写出的最新一份 ' + hit.tag + ' 报告';
      else if (st !== 'done') out.message = '任务终态是 ' + st + (errOf(sid) ? '（' + errOf(sid) + '）' : '') + '，这是它留下的最新 ' + hit.tag + ' 报告';
      return out;
    }
    /* [位置:subagent-preset-runner.js·report 未命中] [最新任务没出报告就明说，绝不返回旧任务报告] [10-31「交旧卷子」修复的另一半：18:55 任务中断后时间线末尾还是 user 任务消息，旧逻辑把早上 06:07 的旧报告当「最新」交出去。现在 tag 空+无新报告 → 按终态给明确提示（附旧报告标签，真要旧的传 tag 指定）] [注释时间 2026-10-31] */
    const b = tag ? null : taskBoundary(readTimeline(sid));
    if (b) {
      const which = '第 ' + b.no + ' 个任务（' + b.preview + '…）';
      if (st === 'running') return { status: 'running', task_no: b.no, task_preview: b.preview, message: which + ' 还在跑，还没有产出报告' };
      if (st === 'failed') return { status: 'failed', task_no: b.no, task_preview: b.preview, message: which + ' 失败了（' + (errOf(sid) || '原因未知') + '），没留下报告' };
      if (st === 'stopped') return { status: 'stopped', task_no: b.no, task_preview: b.preview, message: which + ' 被终止，没留下报告' };
      if (st === 'interrupted') return { status: 'interrupted', task_no: b.no, task_preview: b.preview, message: which + ' 中断了（网关重启或上游没吐字），没留下报告。会话里以前的旧报告还在，确要旧的用 tag 明确指定（如 tag="report_01"）' };
      if (st === 'done') return { status: 'done', task_no: b.no, task_preview: b.preview, message: which + ' 已结束，但回复里没有找到报告标签——用 action=log 看它最后说了什么' };
    }
    if (st === 'running') return { status: 'running', message: '暂无，还未完成' };
    if (st === 'interrupted') return { status: 'interrupted', message: '会话中断（网关重启或请求没发出去，任务没有跑完）' };
    if (st === 'done') return { status: 'done', message: '任务已结束，但回复里没有找到 <' + what + '> 报告——可以用 action=log 看它最后说了什么' };
    return { status: st, message: errOf(sid) || ('任务终态 ' + st + '，也没有留下 ' + what + ' 报告') };
  }

  // ---- log：从时间线派生 ----
  /* [位置:subagent-preset-runner.js·buildLogs] [log = AI 的每次工具请求 + 每段正文，带稳定行号] [10-27：给主 AI 看，防止它漏写标签或别的情况；工具只记名+完整参数（结果与思考不记），正文全文、长的按 1800 字切块并标注（第x/y块，第a-b字，共N字）；时间线只追加，所以行号稳定] [注释时间 2026-10-27] */
  function buildLogs(sid, liveParts) {
    const items = [];
    function push(kind, time, text) {
      const s = String(text || '');
      if (!s.trim()) return;
      if (s.length <= LOG_BLOCK) { items.push({ no: items.length + 1, time: time || '', kind: kind, text: s }); return; }
      const n = Math.ceil(s.length / LOG_BLOCK);
      for (let i = 0; i < n; i++) {
        const seg = s.slice(i * LOG_BLOCK, (i + 1) * LOG_BLOCK);
        items.push({ no: items.length + 1, time: time || '', kind: kind, text: '（第' + (i + 1) + '/' + n + '块，第' + (i * LOG_BLOCK) + '-' + (i * LOG_BLOCK + seg.length - 1) + '字，共' + s.length + '字）' + seg });
      }
    }
    function toolLine(t) {
      let a = ''; try { a = typeof t.args === 'string' ? t.args : JSON.stringify(t.args || {}); } catch (e) { a = String(t.args || ''); }
      return (t.name || '?') + ' 参数=' + a + (t.error ? '\n出错：' + t.error : '');
    }
    for (const m of readTimeline(sid)) {
      if (!isReal(m) || m.role !== 'assistant') continue;
      const tl = Array.isArray(m.stream_timeline) ? m.stream_timeline : [];
      const hasNodes = tl.some(function (n) { return n && (n.type === 'tool' || n.type === 'text'); });
      if (hasNodes) {
        tl.forEach(function (n) {
          if (!n) return;
          if (n.type === 'text') push('say', m.time, n.text);
          else if (n.type === 'tool' && n.tool) push('tool', m.time, toolLine(n.tool));
        });
      } else {
        (Array.isArray(m.tools) ? m.tools : []).forEach(function (t) { push('tool', m.time, toolLine(t)); });
        push('say', m.time, textOf(m));
      }
    }
    /* [位置:subagent-preset-runner.js·buildLogs live] [运行中的实时尾段也要能 log 发现] [2026-11-01 审查：preset 的 log 只读时间线，跑的时候 total 不变、看不到任何过程（旧引擎是实时写的）；运行中把 activeGenMap 的 parts（正文/工具）接在时间线条目后面，行号只在本次运行内浮动，终态落盘后以时间线为准] [注释时间 2026-11-01] */
    if (Array.isArray(liveParts) && liveParts.length) {
      liveParts.forEach(function (n) {
        if (!n) return;
        if (n.type === 'text') push('say', n.time || '', n.text);
        else if (n.type === 'tool' && n.tool) push('tool', n.time || '', toolLine(n.tool));
      });
    }
    return items;
  }
  function log(opts) {
    const sid = String((opts && opts.session_id) || '').trim();
    const startLine = Number(opts && opts.start_line);
    const rawEnd = opts && opts.end_line;
    const endLine = (rawEnd === undefined || rawEnd === null || rawEnd === '') ? null : Number(rawEnd);
    if (!sid) return { ok: false, error: '缺少 session_id' };
    if (!Number.isFinite(startLine) || startLine < 1) return { ok: false, error: 'start_line 必填（从 1 开始的记录序号）' };
    const st = statusOf(sid);
    if (st === 'not_found') return { ok: false, error: '找不到子智能体 ' + sid };
    const g = getGen ? getGen(sid) : null;
    const liveParts = (g && !g.done && Array.isArray(g.parts)) ? g.parts : [];
    const all = buildLogs(sid, liveParts);
    const total = all.length;
    if (startLine > total) return { ok: true, subagent_id: sid, total: total, range: [], items: [], has_more: false, status: st, hint: 'start_line 超出范围，总共只有 ' + total + ' 条' };
    const end = (endLine && Number.isFinite(endLine)) ? Math.min(endLine, total) : Math.min(startLine + 40 - 1, total);
    return { ok: true, subagent_id: sid, status: st, total: total, range: [startLine, end], items: all.filter(function (l) { return l.no >= startLine && l.no <= end; }), has_more: end < total };
  }

  // ---- 抽屉数据：和旧引擎 detail 同一份契约（前端 subSheet 不用改）----
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function detail(sid, opts) {
    sid = String(sid || '').trim();
    const tl = readTimeline(sid);
    const g = getGen ? getGen(sid) : null;
    const running = generating(sid);
    if (!tl.length && !running) return { ok: false, error: '找不到子智能体 ' + sid };
    const real = tl.filter(isReal);
    const firstUser = real.filter(function (m) { return m.role === 'user'; })[0];
    /* [位置:subagent-preset-runner.js·detail task] [抽屉标题跟最新任务] [2026-11-01 审查：复用的子会话一直拿第一条 user（第一次任务）当标题，跑了 6 个任务后抽屉还写着第一个活；改成最后一条 user=本次/最近任务，legacy 引擎的 rec.task 本来就是最新一次] [注释时间 2026-11-01] */
    const lastUser = real.filter(function (m) { return m.role === 'user' && textOf(m).trim(); }).slice(-1)[0];
    const live = !!(g && !g.done);
    const rev = live ? (Number(g.ts) || 0) : tl.length;
    const rounds = real.reduce(function (n, m) { return n + (Array.isArray(m.stream_timeline) ? m.stream_timeline.filter(function (x) { return x && x.type === 'tool'; }).length : (Array.isArray(m.tools) ? m.tools.length : 0)); }, 0);
    const st = statusOf(sid);
    const base = {
      ok: true, subagent_id: sid, status: st, running: running,
      task: lastUser ? textOf(lastUser) : (firstUser ? textOf(firstUser) : ''), model: '', rounds: rounds,
      created_at: (real[0] && real[0].time) || '', ended_at: running ? '' : ((real[real.length - 1] && real[real.length - 1].time) || ''),
      error: errOf(sid) || (g && g.done && g.error) || null,
      total_logs: 0, rev: rev, activity: null
    };
    if (running) {
      const ph = g && g.phase;
      const rt = g && (g.tools || []).filter(function (t) { return t && t.status === 'running'; })[0];
      base.activity = { phase: ph === 'tool' ? 'tool' : ph === 'reasoning' ? 'thinking' : ph === 'writing' ? 'writing' : 'preparing', tool: (rt && rt.name) || '', updated_at: nowIso() };
    }
    if (opts && opts.meta) { base.meta = true; return base; }
    if (running && opts && opts.since !== undefined && opts.since !== '' && Number(opts.since) === rev) { base.same = true; return base; }
    const out = [];
    for (const m of real) {
      const c = textOf(m);
      if (!c.trim() && !hasProcess(m)) continue;
      out.push({ role: m.role, time: m.time || '', content: c, reasoning: m.reasoning || '', tools: Array.isArray(m.tools) ? m.tools : [], stream_timeline: Array.isArray(m.stream_timeline) ? m.stream_timeline : [] });
    }
    if (live) {
      let nodes = Array.isArray(g.parts) ? copy(g.parts.filter(Boolean)) : [];
      if (!nodes.length) {
        if (g.reasoning) nodes.push({ type: 'reasoning', text: String(g.reasoning) });
        if (g.text) nodes.push({ type: 'text', text: String(g.text) });
      }
      if (nodes.length) out.push({ role: 'assistant', time: nowIso(), content: String(g.text || ''), reasoning: String(g.reasoning || ''), tools: [], stream_timeline: nodes, live: true });
    }
    base.timeline = out;
    return base;
  }

  return { start, stop, report, log, detail, statusOf, statusAll, _inflight, _errors, buildLogs };
};
module.exports.SID_PREFIX = SID_PREFIX;
