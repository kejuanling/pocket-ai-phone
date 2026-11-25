'use strict';
// session-meta.js —— 会话标题 / 进展状态（AI 在回复里用 <title>、<status> 标签更新）。
// [位置:lib/session-meta.js] [AI 改会话名 + 标进展状态] [10-27：标题原来只能起一次、且只靠前端（页面不开/唤醒轮次就收不到）；改成服务器收尾时解析，
//   AI 随时可以再改名，也能把会话标成 进行中/待回复/待反馈/已完成，列表里显示小标签] [注释时间 2026-10-27]
//
// 改名规则（区分手动 / AI，不改任何手动改名入口）：
//   data/session_title_ai.json 记「AI 上次给这个会话起的名字」。AI 再发 <title> 时：
//   - 现在没有名字，或现在的名字 == AI 上次起的名字（说明用户没动过）→ 覆盖；
//   - 现在的名字和 AI 上次起的不一样（用户手动改过）→ 不动。
// 状态：data/session-status.json = { 会话id: "已完成" }；只认 STATUSES 四个值，别的忽略。
// 标签都在 tag-parser 的代码块掩码之后才解析（反引号/代码块里讲解标签不会触发）。

const fs = require('fs');
const path = require('path');

const STATUSES = ['进行中', '待回复', '待反馈', '已完成'];
const NAME_MAX = 30;   // 与前端 autoTitle 的 slice(0,30) 同口径（提示词要求 15 字以内，这里只是兜底）

let dataDir = path.join(__dirname, '..', 'data');
function _setDataDir(d) { dataDir = d; }   // 仅测试用
function f(name) { return path.join(dataDir, name); }

function readMap(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}
function writeMap(file, o) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function cleanName(raw) {
  return String(raw == null ? '' : raw).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

// 返回 { ok, reason? }：reason = 'empty' | 'manual' | 'same'
function applyTitle(sid, raw) {
  const name = cleanName(raw);
  if (!sid || !name) return { ok: false, reason: 'empty' };
  const names = readMap(f('session-names.json'));
  const ai = readMap(f('session_title_ai.json'));
  const cur = names[sid];
  if (cur && cur !== ai[sid]) return { ok: false, reason: 'manual' };
  if (cur === name) {
    if (ai[sid] !== name) { ai[sid] = name; writeMap(f('session_title_ai.json'), ai); }
    return { ok: true, reason: 'same' };
  }
  names[sid] = name;
  ai[sid] = name;
  writeMap(f('session-names.json'), names);
  writeMap(f('session_title_ai.json'), ai);
  return { ok: true };
}

function normStatus(raw) {
  const s = String(raw == null ? '' : raw).replace(/<[^>]+>/g, '').trim();
  if (STATUSES.indexOf(s) >= 0) return s;
  return STATUSES.find(function (x) { return s.indexOf(x) >= 0; }) || '';
}
function applyStatus(sid, raw) {
  const st = normStatus(raw);
  if (!sid || !st) return { ok: false, reason: 'invalid' };
  const m = readMap(f('session-status.json'));
  if (m[sid] === st) return { ok: true, reason: 'same' };
  m[sid] = st;
  writeMap(f('session-status.json'), m);
  if (st === '已完成') { try { require('./claim-locks').clear(sid); } catch (e) { /* claim-locks 未装不影响状态 */ } }   /* [位置:lib/session-meta.js·applyStatus] [状态完成顺带清文件占用] [10-31：<claim> 占坑的会话标「已完成」自动退坑，AI 忘写 <claim clear> 也有兜底] [注释时间 2026-10-31] */
  return { ok: true };
}

function readStatusMap() {
  const m = readMap(f('session-status.json')), out = {};
  Object.keys(m).forEach(function (k) { if (STATUSES.indexOf(m[k]) >= 0) out[k] = m[k]; });
  return out;
}
// 手动设置 / 清除（PUT /admin/session-status 用）：set={sid:状态}, unset=[sid]
function patchStatus(set, unset) {
  const m = readMap(f('session-status.json'));
  if (set && typeof set === 'object') Object.keys(set).forEach(function (k) { const st = normStatus(set[k]); if (st) m[k] = st; });
  if (Array.isArray(unset)) unset.forEach(function (k) { if (typeof k === 'string') delete m[k]; });
  writeMap(f('session-status.json'), m);
  return readStatusMap();
}

function lastMatch(text, tag) {
  const re = new RegExp('<\\s*' + tag + '\\b[^>]*>([\\s\\S]*?)<\\s*\\/' + tag + '\\s*>', 'gi');
  let m, last = null;
  while ((m = re.exec(text))) last = m[1];
  return last;
}
// text 必须是已做过代码块掩码的文本；多个标签取最后一个
function applyFromText(sid, text) {
  const out = {};
  const t = lastMatch(text, 'title');
  if (t != null && t.indexOf('\u0000') < 0) out.title = applyTitle(sid, t);
  const s = lastMatch(text, 'status');
  if (s != null && s.indexOf('\u0000') < 0) out.status = applyStatus(sid, s);
  return out;
}

module.exports = { STATUSES, applyTitle, applyStatus, applyFromText, readStatusMap, patchStatus, cleanName, normStatus, _setDataDir };
