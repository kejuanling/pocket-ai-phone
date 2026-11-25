'use strict';
// daily-stats.js —— 月历每天的统计（10-23 需求 44，纯展示）：每天她发了几条、他回了几条、用了多少 token。
//   数据口径＝各会话时间线现状（timeline_data/enhanced_messages_*.json）：
//     u = role=user 的消息条数；a = role=assistant 的消息条数（含唤醒时他说的话）；
//     in/out/hit = 助手消息上记着的上游用量（prompt_tokens / completion_tokens / 缓存命中），只有存了 tokens 字段的消息才有——
//       老消息（7、8 月几乎都没存）和某些路径写的消息没有用量，所以 token 只会少算、不会多算；
//     隐藏消息、带 kind 的系统消息（日记、事件回执等）、同一文件里重复 id 的消息都不数；
//     删除、重新生成掉的消息就不在时间线里了，也就不再计入（这是「现状」，不是「历史累计」）。
//   日期按上海时区。不新增写入点：每个文件按 mtime+size 缓存当日汇总，只有变过的文件才重读，月份查询只看最后修改在该月之后的文件。
const fs = require('fs');
const path = require('path');
const { timelineDirOf } = require('./timeline-dir');

const FILE_RE = /^enhanced_messages_(.+)\.json$/;
const SKIP_PREFIX = ['smoke-'];

function dayKey(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function usageOf(tk) {
  if (!tk || typeof tk !== 'object') return null;
  const pin = Number(tk.prompt_tokens != null ? tk.prompt_tokens : (tk.input_tokens != null ? tk.input_tokens : 0)) || 0;
  const out0 = Number(tk.completion_tokens != null ? tk.completion_tokens : (tk.output_tokens != null ? tk.output_tokens : 0)) || 0;
  /* [位置:daily-stats.js·usageOf reasoning] [思考 token 也算输出] [11-16：xAI（Grok）的 completion_tokens 不含思考，total = prompt + completion + reasoning；月历「用了多少 token」按实耗算，所以把 completion_tokens_details.reasoning_tokens 并进 out。其它供应商的思考本来就算在 completion 里、没有这个字段，不受影响] [注释时间 2026-11-16] */
  const cd = tk.completion_tokens_details || {};
  const rt = Number(cd.reasoning_tokens != null ? cd.reasoning_tokens : 0) || 0;
  const out = out0 + rt;
  const d = tk.prompt_tokens_details || {};
  const hit = Number(tk.prompt_cache_hit_tokens != null ? tk.prompt_cache_hit_tokens : (d.cached_tokens != null ? d.cached_tokens : (tk.cached_tokens != null ? tk.cached_tokens : (tk.cache_read_input_tokens || 0)))) || 0;
  if (!pin && !out) return null;
  return { in: pin, out: out, hit: hit };
}

function createDailyStats(opts) {
  const dir = timelineDirOf(opts.baseDir);
  const cache = new Map();            // 文件名 -> { sig, days }
  let running = null;

  async function scanFile(name, minMtimeMs) {
    const f = path.join(dir, name);
    let st;
    try { st = await fs.promises.stat(f); } catch (e) { return null; }
    if (minMtimeMs && st.mtimeMs < minMtimeMs) return null;
    const sig = st.mtimeMs + ':' + st.size;
    const c = cache.get(name);
    if (c && c.sig === sig) return c.days;
    let arr;
    try {
      const o = JSON.parse(await fs.promises.readFile(f, 'utf8'));
      arr = Array.isArray(o) ? o : ((o && o.messages) || []);
    } catch (e) { return c ? c.days : null; }
    const days = {}, seen = new Set();
    for (const m of arr) {
      if (!m || m.hidden || (m.kind && m.kind !== '')) continue;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      if (m.id) { if (seen.has(m.id)) continue; seen.add(m.id); }
      const k = dayKey(m.time);
      if (!k) continue;
      const d = days[k] || (days[k] = { u: 0, a: 0, in: 0, out: 0, hit: 0 });
      if (m.role === 'user') d.u++;
      else {
        d.a++;
        const u = usageOf(m.tokens);
        if (u) { d.in += u.in; d.out += u.out; d.hit += u.hit; }
      }
    }
    cache.set(name, { sig: sig, days: days });
    return days;
  }

  async function monthImpl(ym) {
    const startMs = Date.parse(ym + '-01T00:00:00+08:00');
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch (e) { return {}; }
    const res = {};
    for (const n of names) {
      const mm = FILE_RE.exec(n);
      if (!mm) continue;
      if (SKIP_PREFIX.some(function (p) { return mm[1].indexOf(p) === 0; })) continue;
      const days = await scanFile(n, startMs);
      if (!days) continue;
      for (const k of Object.keys(days)) {
        if (k.slice(0, 7) !== ym) continue;
        const d = res[k] || (res[k] = { u: 0, a: 0, in: 0, out: 0, hit: 0 });
        d.u += days[k].u; d.a += days[k].a; d.in += days[k].in; d.out += days[k].out; d.hit += days[k].hit;
      }
      await new Promise(function (r) { setImmediate(r); });   // 每读完一个文件让出一次事件循环，不卡聊天
    }
    return res;
  }
  // 同一时刻多次查询共用一次扫描
  function month(ym) {
    if (!running) running = monthImpl(ym).finally(function () { running = null; });
    else return running.then(function () { return monthImpl(ym); });
    return running;
  }
  return { month: month, dayKey: dayKey, usageOf: usageOf };
}

module.exports = { createDailyStats };
