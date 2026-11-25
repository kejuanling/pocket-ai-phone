'use strict';
// sleep-wake-config.js —— 「睡眠唤醒」的全局设置（2026-11-09，产品确定：全局一份、放手机「唤醒设置」页）。
// 睡眠唤醒 = 她在某个已开启「睡眠唤醒」的会话里最后一条发言之后，聊天停满 afterMin 分钟就叫他一次（不分白天黑夜）；
//   同一条发言只叫一次，她一发言旧计时作废。enabled=总开关（2026-11-10 产品确定加回，关了=所有会话都不再睡眠唤醒，名单保留）。
//   概率不在这里了：2026-11-10 起概率挪到「她自己设的闹钟」上，每个闹钟各设各的（lib/wake-alarms.js 的 prob 字段）。
// userAlarmQuietMin：用户自己设的闹钟，到点前这么多分钟内她发过言 → 这一轮不响（每天的推到明天，一次性的作废）；0=不作废。
// note：睡眠唤醒时追加进唤醒提示词末尾的一段文字（可空）。
// 数据：data/sleep-wake.json；读写原子、字段逐项校验，坏文件按默认值处理（不挡唤醒）。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'sleep-wake.json');
const DEFAULTS = { enabled: true, afterMin: 120, userAlarmQuietMin: 60, note: '' };
const NOTE_MAX = 500;

function int(v, lo, hi, d) {
  const n = Math.round(Number(v));
  return (Number.isFinite(n) && n >= lo && n <= hi) ? n : d;
}
function normalize(o) {
  o = (o && typeof o === 'object') ? o : {};
  return {
    enabled: o.enabled !== false,
    afterMin: int(o.afterMin, 10, 1440, DEFAULTS.afterMin),
    userAlarmQuietMin: int(o.userAlarmQuietMin, 0, 720, DEFAULTS.userAlarmQuietMin),
    note: typeof o.note === 'string' ? o.note.replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX) : ''
  };
}
function read() {
  try { return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) { return normalize(null); }
}
// patch 里只认已知字段；返回写入后的完整配置
function write(patch) {
  const cur = read();
  const p = (patch && typeof patch === 'object') ? patch : {};
  const next = normalize(Object.assign({}, cur, Object.keys(DEFAULTS).reduce(function (a, k) { if (k in p) a[k] = p[k]; return a; }, {})));
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
  fs.renameSync(tmp, FILE);
  return next;
}

module.exports = { read, write, DEFAULTS, NOTE_MAX, FILE };
