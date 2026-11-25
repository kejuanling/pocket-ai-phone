'use strict';
/* [位置:lib/location-detect.js] [位置变了就唤醒一下——只认实时的查岗数据] [11-04 首版；2026-11-10 重写判定]
   数据源：phone-report-api(8080) /state/latest 的 location + created_at（手机打开「查岗」快捷指令才会上报；查岗是延迟的，所以先看新不新）。
   服务端是「一行原地更新」，不留历史，所以网关每次读到时自己记下「上一份快照的时间 lastSnapAt」和「上次叫他时的位置 firedLoc（冷却内被吞掉的变化也会更新它）/ 时间 firedAt」。
   规则（每 tickMs 读一次，默认 1 分钟）：
     1. 读不到数据 / 没有 created_at / 没有位置 → 不叫，状态记为问题（设置页位置行下出小字）。
     2. 这份快照和上一份是同一份（没有新上报）→ 什么都不做。
     3. 没有上一份（冷启动，或旧状态文件）→ 只记下，不叫。
     4. 这份快照与上一份相隔 > maxGapMin（默认 5 分钟）→ 不连续，不比较、不叫，只把这份记成「上一份」。
     5. 相隔 ≤ maxGapMin：位置 = 上次叫他时的位置 → 不叫；位置不同且距上次叫他 ≥ cooldownMin（默认 30）→ 叫一次，firedLoc=现在位置；
        冷却没满 → 不叫，变化直接吞掉：firedLoc 记成现在的位置（firedAt 不动，冷却仍从上次叫他起算），冷却一过不补叫，只有再次变化才叫。
   提示词里不带具体地名（位置默认是不主动给 AI 的），要看她在哪让 AI 自己查 phone_state。
   配置 data/location-detect-config.json（可选）：{enabled:true, cooldownMin:30, maxGapMin:5}；设置页只改 cooldownMin（/v1/location-wake）。
   状态 data/location-detect-state.json：{firedLoc, firedAt, lastSnapAt, problem:{msg,at}|null}。 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = { enabled: true, cooldownMin: 30, maxGapMin: 5 };
function clampInt(v, lo, hi, d) { const n = Math.round(Number(v)); return (Number.isFinite(n) && n >= lo && n <= hi) ? n : d; }
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function normCfg(o) {
  o = (o && typeof o === 'object') ? o : {};
  return { enabled: o.enabled !== false, cooldownMin: clampInt(o.cooldownMin, 1, 1440, DEFAULTS.cooldownMin), maxGapMin: clampInt(o.maxGapMin, 1, 120, DEFAULTS.maxGapMin) };
}
const cfgPath = function (baseDir) { return path.join(baseDir, 'data', 'location-detect-config.json'); };
const statePath = function (baseDir) { return path.join(baseDir, 'data', 'location-detect-state.json'); };
// 设置页接口用（routes/wake-subs.js）：读配置、改冷却、读最近一次的问题说明
function readConfig(baseDir) { return normCfg(readJson(cfgPath(baseDir), {})); }
function writeConfig(baseDir, patch) {
  const raw = readJson(cfgPath(baseDir), {});
  const next = normCfg(Object.assign({}, raw, (patch && 'cooldownMin' in patch) ? { cooldownMin: patch.cooldownMin } : {}));
  const out = Object.assign({}, raw, { cooldownMin: next.cooldownMin });   // 保留文件里其他键（enabled/maxGapMin），只改冷却
  const f = cfgPath(baseDir); const t = f + '.tmp' + process.pid;
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(t, JSON.stringify(out, null, 1)); fs.renameSync(t, f);
  return normCfg(out);
}
function readProblem(baseDir) { const st = readJson(statePath(baseDir), null); return (st && st.problem && st.problem.msg) ? st.problem : null; }

function createLocationDetect(opts) {
  const baseDir = opts.baseDir;
  const notify = opts.notify;
  const getToken = opts.getToken || function () { return ''; };
  const log = opts.log || function (m) { console.log('[location-detect] ' + m); };
  const STATE = statePath(baseDir);
  const TICK_MS = Math.max(1000, Number(opts.tickMs) || 60 * 1000);
  const BASE = opts.apiBase || 'http://localhost:8080';
  let timer = null, busy = false;
  function writeJson(f, v) { try { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); } catch (e) { log('落盘失败: ' + e.message); } }
  const norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, '').trim(); };
  const hm = function (ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  async function latestSnapshot() {
    const token = getToken();
    const r = await fetch(BASE + '/state/latest?user_id=han', { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const s = (d && d.state) || {};
    // created_at 是 phone-report-api 的服务器本地时间 "YYYY-MM-DD HH:MM:SS"（同机，同时区），按本地时间解析
    const at = Date.parse(String(s.created_at || '').replace(' ', 'T'));
    return { loc: norm(s.location), snapAt: Number.isFinite(at) ? at : null };
  }
  // 问题写进状态文件给设置页读；同一条问题不重复写日志（日志只在变化时出一行）
  function setProblem(st, msg, now) {
    const prev = st.problem && st.problem.msg;
    st.problem = msg ? { msg: msg, at: now } : null;
    if (msg && msg !== prev) log(msg);
  }
  async function tick(now) {
    if (busy) return { skipped: 'busy' };
    busy = true;
    now = now || Date.now();
    let st = readJson(STATE, null) || {};
    try {
      const c = readConfig(baseDir);
      if (!c.enabled) return { skipped: 'off' };
      let snap;
      try { snap = await latestSnapshot(); }
      catch (e) { setProblem(st, '读不到查岗数据（' + e.message + '）', now); writeJson(STATE, st); return { error: e.message }; }
      if (!snap.loc) { setProblem(st, '查岗数据里没有位置', now); writeJson(STATE, st); return { skipped: 'no-location' }; }
      if (snap.snapAt == null) { setProblem(st, '查岗数据没有上报时间，没法判断新不新，暂不会叫', now); writeJson(STATE, st); return { skipped: 'no-time' }; }
      if (st.problem && /^(读不到|查岗数据)/.test(st.problem.msg)) setProblem(st, null, now);   // 数据恢复了，清掉「读不到/没时间」的提示
      if (st.lastSnapAt === snap.snapAt) return { same: 'snapshot' };   // 没有新上报：什么都不做
      const prevSnapAt = st.lastSnapAt;
      log('快照 ' + hm(snap.snapAt) + ' 位置=' + snap.loc + '（上次叫他时=' + (st.firedLoc || '无') + '）');   // 观察期日志：看叫他时位置是真变了还是地名抖动
      st.lastSnapAt = snap.snapAt;
      if (prevSnapAt == null || !st.firedLoc) {   // 冷启动 / 旧状态文件：只记下，不叫
        if (!st.firedLoc) { st.firedLoc = snap.loc; st.firedAt = st.firedAt || 0; }
        writeJson(STATE, st); log('冷启动：先记下当前快照和位置，不叫'); return { cold: true };
      }
      const gapMin = (snap.snapAt - prevSnapAt) / 60000;
      if (gapMin > c.maxGapMin) {
        setProblem(st, hm(snap.snapAt) + ' 的上报距上一次隔了 ' + Math.round(gapMin) + ' 分钟（超过 ' + c.maxGapMin + ' 分钟），没有比较，暂不会叫', now);
        writeJson(STATE, st); return { gap: Math.round(gapMin) };
      }
      setProblem(st, null, now);   // 连续上报了，之前的「隔太久」提示可以去掉
      if (snap.loc === st.firedLoc) { writeJson(STATE, st); return { same: true }; }
      if (now - (st.firedAt || 0) < c.cooldownMin * 60000) {   // 冷却内的变化直接吞掉：不叫，且把「上次位置」记成现在的，冷却一过只有再次变化才叫（不补叫）
        const was = st.firedLoc; st.firedLoc = snap.loc; writeJson(STATE, st); log('冷却内位置变了，已忽略：' + was + ' → ' + snap.loc); return { cooling: true };
      }
      const was = st.firedLoc; st.firedLoc = snap.loc; st.firedAt = now;
      writeJson(STATE, st);
      log('位置变了（连续上报，距上次叫已过 ' + c.cooldownMin + ' 分钟冷却）：' + was + ' → ' + snap.loc + ' → 事件 location');
      notify('location');
      return { fired: 'location' };
    } catch (e) { log('检测失败: ' + e.message); return { error: e.message }; }
    finally { busy = false; }
  }
  function start() {
    if (timer) return;
    const first = setTimeout(function () { tick(); }, 45 * 1000); if (first.unref) first.unref();
    timer = setInterval(function () { tick(); }, TICK_MS); if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick };
}
createLocationDetect.readConfig = readConfig;
createLocationDetect.writeConfig = writeConfig;
createLocationDetect.readProblem = readProblem;
module.exports = createLocationDetect;
