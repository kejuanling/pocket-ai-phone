'use strict';
/* [位置:lib/sleep-detect.js] [按手机 App 记录猜她睡着/醒来，两个点各叫醒一次] [11-04：根据手机 app 的记录来猜用户醒来和睡着的时间——记录停了一个小时以后=睡着了；停了很久以后重新出现记录=醒了；这两个点各唤醒一次。唤醒提示词里不下定论，只写「好像」（见 wake-subs.js 的 ITEMS）。
   数据源：phone-report-api(8080) 的 /summary（App 记录，带 created_at）+ /state/latest（查岗快照时间），取两者最新的一条当「最后动静」。
   2026-11-06 App 记录改成「一次使用一条」后，/summary 的 records 里会折一条使用段摘要（record_type=session，created_at=结束或最后活跃时刻），
   本文件的解析逻辑不用改，照样能读到最新动静。
   状态机（落盘 data/sleep-detect-state.json）：
     awake  且 现在-最后动静 ≥ sleepGapMin（默认 120）→ asleep，发 sleep 事件；
     asleep 且 出现比睡着时更新的动静 → awake；这一段静默 ≥ wakeGapMin（默认 300）才发 wakeup 事件（短于它只是歇了一会儿，不算睡过一觉，不叫）；
     冷启动（没有状态文件）不补发，只记当前状态。
   发的是 wakeEvents.notify(key)：5 分钟合并窗口 → 只叫「开了事件唤醒」的会话（wake-subs.subscribers）→ 过 wake-gate（她在聊就让路）。
   配置 data/sleep-detect-config.json（可选）：{enabled:true, sleepGapMin:60, wakeGapMin:180, nightOnly:false, nightFrom:22, nightTo:6}；nightOnly=true 时「睡着」只在夜间窗口里才算。] [注释时间 2026-11-04] */
const fs = require('fs');
const path = require('path');

module.exports = function createSleepDetect(opts) {
  const baseDir = opts.baseDir;
  const notify = opts.notify;
  const getToken = opts.getToken || function () { return ''; };
  const log = opts.log || function (m) { console.log('[sleep-detect] ' + m); };
  const CFG = path.join(baseDir, 'data', 'sleep-detect-config.json');
  const STATE = path.join(baseDir, 'data', 'sleep-detect-state.json');
  const TICK_MS = Math.max(1000, Number(opts.tickMs) || 5 * 60 * 1000);
  const BASE = opts.apiBase || 'http://localhost:8080';
  let timer = null, busy = false;

  function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
  function writeJson(f, v) { try { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); } catch (e) { log('落盘失败: ' + e.message); } }
  function cfg() { return Object.assign({ enabled: true, sleepGapMin: 120, wakeGapMin: 300, nightOnly: false, nightFrom: 22, nightTo: 6 }, readJson(CFG, {})); }
  function parseLocal(s) { const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/); if (!m) return 0; const t = Date.parse(m[1] + 'T' + (m[2].length === 5 ? m[2] + ':00' : m[2]) + '+08:00'); return Number.isFinite(t) ? t : 0; }

  async function get(p) {
    const token = getToken();
    const r = await fetch(BASE + p, { headers: token ? { Authorization: 'Bearer ' + token } : {}, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  /* 最后动静：App 记录与查岗快照里最新的一条 */
  async function lastActivity() {
    let t = 0;
    try { const d = await get('/summary?user_id=han&days=3'); (d.records || []).forEach(function (x) { t = Math.max(t, parseLocal(x && x.created_at)); }); } catch (e) { log('读 App 记录失败: ' + e.message); }
    try { const d = await get('/state/latest?user_id=han'); t = Math.max(t, parseLocal(d && d.state && d.state.created_at)); } catch (e) { /* 快照读不到不影响 */ }
    return t;
  }
  function inNight(ts, c) { const h = new Date(ts + 8 * 3600 * 1000).getUTCHours(); return c.nightFrom > c.nightTo ? (h >= c.nightFrom || h < c.nightTo) : (h >= c.nightFrom && h < c.nightTo); }

  async function tick(now) {
    if (busy) return { skipped: 'busy' };
    busy = true;
    try {
      const c = cfg();
      if (!c.enabled) return { skipped: 'off' };
      now = now || Date.now();
      const last = await lastActivity();
      if (!last) return { skipped: 'no-data' };
      const st = readJson(STATE, null);
      const idleMin = (now - last) / 60000;
      if (!st) {
        writeJson(STATE, { state: idleMin >= c.sleepGapMin ? 'asleep' : 'awake', lastAct: last, at: now, cold: idleMin >= c.sleepGapMin });   // cold=冷启动时就已静默：不知道是真睡了还是记录稀疏，第一次回来只切回醒着、不发 wakeup
        log('冷启动：当前按「' + (idleMin >= c.sleepGapMin ? '睡着' : '醒着') + '」记，不补发');
        return { cold: true };
      }
      if (st.state === 'awake') {
        if (idleMin >= c.sleepGapMin && (!c.nightOnly || inNight(last, c))) {
          writeJson(STATE, { state: 'asleep', lastAct: last, at: now });
          log('手机静了 ' + Math.round(idleMin) + ' 分钟，猜她睡着了 → 事件 sleep');
          notify('sleep');
          return { fired: 'sleep' };
        }
        if (last !== st.lastAct) writeJson(STATE, { state: 'awake', lastAct: last, at: now });
        return { state: 'awake' };
      }
      // asleep：有比「睡着时那条」更新的动静 = 回来了
      if (last > (st.lastAct || 0)) {
        const gapMin = (last - (st.lastAct || 0)) / 60000;
        writeJson(STATE, { state: 'awake', lastAct: last, at: now });
        if (st.cold) { log('冷启动后的第一次动静，只切回醒着，不叫'); return { fired: null, cold: true }; }
        if (gapMin >= c.wakeGapMin) { log('静了 ' + Math.round(gapMin) + ' 分钟后手机又有动静，猜她醒了 → 事件 wakeup'); notify('wakeup'); return { fired: 'wakeup' }; }
        log('静了 ' + Math.round(gapMin) + ' 分钟（不到 ' + c.wakeGapMin + '）又有动静，只算歇了一会儿，不叫');
        return { fired: null, short: true };
      }
      return { state: 'asleep' };
    } catch (e) { log('检测失败: ' + e.message); return { error: e.message }; }
    finally { busy = false; }
  }
  function start() {
    if (timer) return;
    const first = setTimeout(function () { tick(); }, 30 * 1000); if (first.unref) first.unref();
    timer = setInterval(function () { tick(); }, TICK_MS); if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick, lastActivity };
};
