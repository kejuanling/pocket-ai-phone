'use strict';
// wake-events.js —— 唤醒订阅的「事件 → 叫醒」触发器（10-23，需求文档第 9 条第二步）：
//   她发碎碎念 / 更新经期 / 记心情 / 上传相册（以及位置变了）时，来源（unified-backend、相册、location-detect）调用 notify(key)。
//   2026-11-10 产品确定：去掉原来的 5 分钟合并窗口，事件一来立刻叫（订阅了这一项且她没关的会话，由 fire 实现，见 lib/wake-scheduler.js fireEvent）。
//   同一种事件在「叫醒进行中」又来了新的：不并发叫，记一笔，这一次叫完后补叫一次（连发多条最多叫两次，不丢）；不同事件各自独立。
//   叫醒时那一刻会话正好有一次唤醒在跑（status=skip）就隔 60 秒再试，最多 5 次。
//   具体放行（同会话两次唤醒隔多久、她刚聊完让路多久）交给 wake-gate（.env 的 WAKE_GATE_*），这里不管。
//   待叫状态落盘（data/wake-events.json），网关重启后接着叫。
const fs = require('fs');
const path = require('path');

module.exports = function createWakeEvents(opts) {
  const baseDir = opts.baseDir;
  const fire = opts.fire;                       // async (key) => { status: 'ok'|'skip'|'fail'|'nosub'|... }
  const wakeSubs = opts.wakeSubs;
  const log = opts.log || function (m) { console.log('[wake-events] ' + m); };
  const WINDOW_MS = Math.max(0, Number(opts.windowMs) || 0);   // 默认 0 = 立刻叫；只给测试用，线上不再配置
  const RETRY_MS = Math.max(50, Number(opts.retryMs) || 60 * 1000);
  const MAX_RETRY = 5;
  const FILE = path.join(baseDir, 'data', 'wake-events.json');
  const timers = {};                            // key -> { at, n, again, timer }

  function persist() {
    try {
      const o = {};
      Object.keys(timers).forEach(function (k) { o[k] = { at: timers[k].at, n: timers[k].n }; });
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(o));
      fs.renameSync(tmp, FILE);
    } catch (e) { log('落盘失败: ' + e.message); }
  }
  function arm(key, at, n) {
    const t = { at: at, n: n || 1, again: false, timer: null };
    t.timer = setTimeout(function () { run(key, 0, null); }, Math.max(0, at - Date.now()));
    if (t.timer.unref) t.timer.unref();
    timers[key] = t;
  }
  async function run(key, tries, only) {
    const cur = timers[key];
    const n = cur ? cur.n : 1;
    let r = null;
    try { r = await fire(key, only); } catch (e) { r = { status: 'fail', reason: e.message }; }
    const st = r && r.status;
    if (st === 'skip' && tries < MAX_RETRY) {
      log(key + ' 这次没叫成（会话正忙），' + Math.round(RETRY_MS / 1000) + ' 秒后重试 ' + (tries + 1) + '/' + MAX_RETRY);
      const t = setTimeout(function () { run(key, tries + 1, (r && r.skipped && r.skipped.length) ? r.skipped : null); }, RETRY_MS);
      if (t.unref) t.unref();
      if (cur) cur.timer = t;
      return;
    }
    log(key + ' 共 ' + n + ' 次事件 → ' + (st || 'unknown') + (r && r.reason ? '（' + r.reason + '）' : ''));
    const again = !!(cur && cur.again);
    delete timers[key];
    persist();
    if (again) {
      log(key + ' 叫醒期间又来了新事件，叫完后再补叫一次');
      arm(key, Date.now() + WINDOW_MS, 1);
      persist();
    }
  }

  // 来源调用：有人订阅这一项才叫（没人订就直接丢，不占计时）
  function notify(key) {
    if (!wakeSubs.KEYS.includes(key)) return { ok: false, error: 'unknown key' };
    if (timers[key]) { timers[key].n++; timers[key].again = true; return { ok: true, merged: true }; }
    if (!wakeSubs.subscribers(key).length) return { ok: true, ignored: 'no subscriber' };
    arm(key, Date.now() + WINDOW_MS, 1);
    persist();
    log(key + ' 事件到来，' + (WINDOW_MS > 0 ? Math.round(WINDOW_MS / 1000) + ' 秒后叫醒' : '立刻叫醒'));
    return { ok: true, armed: true };
  }

  // 网关重启后接着叫（最早 10 秒后，等各模块起完）
  function restore() {
    try {
      const o = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      Object.keys(o || {}).forEach(function (k) {
        if (!wakeSubs.KEYS.includes(k) || !o[k] || !o[k].at) return;
        arm(k, Math.max(Number(o[k].at), Date.now() + 10000), o[k].n || 1);
        log('恢复 ' + k + ' 的待叫事件');
      });
    } catch (e) { /* 没有文件就没有待办 */ }
  }
  restore();
  return { notify: notify, pending: function () { return Object.keys(timers); } };
};
