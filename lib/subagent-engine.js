'use strict';
// subagent-engine.js —— 子智能体引擎分发（2026-10-27，需求单第 12 项）
// 两套引擎并存：legacy = lib/subagent-runner.js（自己跑工具循环，记录在 data/subagent/<sid>.json），
//   preset = lib/subagent-preset-runner.js（用预设开的普通会话）。
// 规则：
//   - 新建（start 不带 session_id）：看 data/subagent-engine.json 的 {"engine":"preset"|"legacy"}，缺省 preset；改文件立即生效，不用重启
//   - 带 session_id 的操作（续派/report/log/detail/stop/状态）：该会话在 data/subagent/ 有旧记录就走 legacy，否则走 preset
//     ——老的 s_sub_ 会话继续用老引擎，不迁移任何数据
//   - statusAll：两边合并，旧记录优先
const fs = require('fs');
const path = require('path');

module.exports = function createEngine(deps) {
  const { legacy, preset, baseDir } = deps;
  const ENGINE_FILE = path.join(baseDir, 'data', 'subagent-engine.json');
  function engine() {
    try { const o = JSON.parse(fs.readFileSync(ENGINE_FILE, 'utf-8')); return o && o.engine === 'legacy' ? 'legacy' : 'preset'; } catch (e) { return 'preset'; }
  }
  function hasLegacy(sid) {
    const s = String(sid || '').trim();
    return !!s && /^[A-Za-z0-9_-]+$/.test(s) && fs.existsSync(path.join(baseDir, 'data', 'subagent', s + '.json'));
  }
  function pick(sid) { return hasLegacy(sid) ? legacy : preset; }
  return {
    engine: engine,
    start: function (o) {
      const sid = o && o.session_id;
      if (sid) return pick(sid).start(o);
      return (engine() === 'legacy' ? legacy : preset).start(o);
    },
    report: function (o) { return pick(o && o.session_id).report(o); },
    log: function (o) { return pick(o && o.session_id).log(o); },
    detail: function (sid, o) { return pick(sid).detail(sid, o); },
    stop: function (o) { return pick(o && o.session_id).stop(o); },
    statusOf: function (sid) { return pick(sid).statusOf(sid); },
    statusAll: function () { return Object.assign({}, preset.statusAll(), legacy.statusAll()); }
  };
};
