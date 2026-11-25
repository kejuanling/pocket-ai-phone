'use strict';
// migrate_mcp_rules.js —— 把会话 / 预设里旧的工具清单（mcp_on + mcp_seen + mcp_exact）换算成「规则」（lib/mcp-rules.js）。
// [位置:scripts/migrate_mcp_rules.js] [一次性迁移 + 新旧对比] [10-27：预设存规则不存清单；迁移前先对比每个会话在新旧两种算法下开着的工具是否一致，
//   不一致的列出来，只有「全开服务器的新工具自动进入」这种预期差异才放行] [注释时间 2026-10-27]
//
// 用法：
//   node scripts/migrate_mcp_rules.js --compare           只对比，不写任何文件（默认）
//   node scripts/migrate_mcp_rules.js --apply             对比通过后写入：会话配置加 mcp_rules、预设加 mcp_rules；先整体备份到 data/backups/mcp-rules-<时间>/
//   node scripts/migrate_mcp_rules.js --rollback <备份目录>  把备份还原回去
// 跳过 s_sub_ 前缀的子智能体会话（子智能体引擎每次运行都会重写 mcp_on，规则会盖住它）。
// 旧字段一律保留（清掉 mcp_rules 即回到旧逻辑）。

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const R = require('../lib/mcp-rules');
const { probeServer } = require('../mcp/mcp-client');

const CFG_DIR = path.join(BASE, 'data', 'session_cfg');
const SERVERS_FILE = path.join(BASE, 'config', 'mcp-servers.json');
const CHAT_SETTINGS = path.join(BASE, 'config', 'chat-settings.json');
const args = process.argv.slice(2);
const APPLY = args.indexOf('--apply') >= 0;

function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
function writeJson(f, o) { const t = f + '.tmp-' + process.pid; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); }

async function probeAll(servers) {
  const live = {}, ok = {};
  for (const s of servers) {
    const r = await Promise.race([probeServer(Object.assign({}, s, { enabled: true })), new Promise((res) => setTimeout(() => res({ tools: [], error: 'timeout' }), 12000))]);
    ok[s.id] = !r.error && (r.tools || []).length > 0;
    const allow = Array.isArray(s.allowTools) ? s.allowTools.map(String) : null;
    live[s.id] = (r.tools || []).map((t) => t.name).filter((n) => !allow || allow.indexOf(n) >= 0);
  }
  return { live, ok };
}

(async () => {
  if (args[0] === '--rollback') {
    const dir = args[1]; if (!dir || !fs.existsSync(dir)) { console.log('用法：--rollback <备份目录>'); process.exit(1); }
    let n = 0;
    for (const f of fs.readdirSync(path.join(dir, 'session_cfg'))) { fs.copyFileSync(path.join(dir, 'session_cfg', f), path.join(CFG_DIR, f)); n++; }
    fs.copyFileSync(path.join(dir, 'chat-settings.json'), CHAT_SETTINGS);
    console.log('已还原 session_cfg ' + n + ' 个 + chat-settings.json'); process.exit(0);
  }

  const raw = readJson(SERVERS_FILE).servers || [];
  const servers = raw.map((s) => ({ id: s.id, enabled: s.enabled !== false, blockTools: Array.isArray(s.blockTools) ? s.blockTools.map(String) : [] }));
  const byId = {}; servers.forEach((s) => { byId[s.id] = s; });
  const { live: liveAll, ok } = await probeAll(raw);
  // 探测失败的服务器不进 live：否则会被当成「现存工具为空」，把它例外里的名字全清掉
  const live = {}; Object.keys(liveAll).forEach((id) => { if (ok[id]) live[id] = liveAll[id]; });
  console.log('服务器 ' + servers.length + ' 个，探测成功 ' + Object.keys(ok).filter((k) => ok[k]).length + ' 个；现存工具共 ' + Object.values(live).reduce((a, b) => a + b.length, 0) + ' 个');
  console.log('探测失败（只能按已知名字对比）：' + (servers.filter((s) => !ok[s.id]).map((s) => (raw.find((r) => r.id === s.id) || {}).name || s.id).join('、') || '无'));

  const stats = { total: 0, skipped_sub: 0, no_legacy: 0, already_rules: 0, checked: 0, identical: 0, upgraded: 0, bad: 0 };
  const bad = [], upgradeNote = {}, writes = [];
  for (const f of fs.readdirSync(CFG_DIR)) {
    if (!f.endsWith('.json')) continue;
    stats.total++;
    const sid = f.replace(/\.json$/, '');
    if (sid.indexOf('s_sub_') === 0) { stats.skipped_sub++; continue; }
    let o; try { o = readJson(path.join(CFG_DIR, f)); } catch (e) { continue; }
    if (o.mcp_rules) { stats.already_rules++; continue; }
    if (!Array.isArray(o.mcp_on)) { stats.no_legacy++; continue; }
    stats.checked++;
    const legacy = { on: o.mcp_on.map(String), seen: Array.isArray(o.mcp_seen) ? o.mcp_seen.map(String) : null, exact: o.mcp_exact === true };
    const rules = R.deriveFromLegacy(legacy, servers, { upgradeFull: true, live });
    const seenAll = new Set((legacy.seen || []).concat(legacy.on));
    let sessionBad = [], sessionUp = [];
    servers.forEach((s) => {
      // 对比的工具集：现存工具；探测失败的服务器用「旧清单里出现过的名字」
      const names = ok[s.id] ? live[s.id] : Array.from(new Set(legacy.on.concat(legacy.seen || []).filter((k) => k.indexOf(s.id + '::') === 0).map((k) => k.slice(s.id.length + 2))));
      names.forEach((n) => {
        const key = s.id + '::' + n;
        const a = R.legacyVisible(legacy, s, n), b = R.toolVisible(rules, s, n);
        if (a === b) return;
        if (!a && b && !seenAll.has(key) && rules.servers[s.id] && rules.servers[s.id].def === 'on') sessionUp.push(key);   // 预期：全开服务器里「没见过的新工具」自动进入
        else sessionBad.push((a ? '丢了 ' : '多了 ') + key);
      });
    });
    if (sessionBad.length) { stats.bad++; bad.push([sid, sessionBad]); }
    else if (sessionUp.length) { stats.upgraded++; sessionUp.forEach((k) => { upgradeNote[k] = (upgradeNote[k] || 0) + 1; }); }
    else stats.identical++;
    if (!sessionBad.length) writes.push({ f, o, rules });
  }
  console.log('\n会话：共 ' + stats.total + '，跳过子智能体 ' + stats.skipped_sub + '，已有规则 ' + stats.already_rules + '，没有旧清单（跟随全局，不用迁）' + stats.no_legacy + '，需迁移 ' + stats.checked);
  console.log('  新旧完全一致 ' + stats.identical + '；只多出「新工具自动进入」' + stats.upgraded + '；有意外差异 ' + stats.bad);
  if (Object.keys(upgradeNote).length) console.log('  预期新增（工具 -> 影响几个会话）：' + JSON.stringify(upgradeNote));
  bad.forEach((b) => console.log('  意外差异 ' + b[0] + ': ' + b[1].slice(0, 6).join('；')));

  // 预设
  const cs = readJson(CHAT_SETTINGS), presets = ((cs.cfg || {}).sess_presets) || [];
  const presetOut = [];
  presets.forEach((p) => {
    const mode = p.mcp_mode || (Array.isArray(p.mcps) ? 's' : 'g');
    if (mode !== 's' || !Array.isArray(p.mcps)) { console.log('预设「' + p.name + '」跟随全局：不用迁'); return; }
    const rules = R.deriveFromPreset(p, servers, { live });
    const parts = servers.map((s) => { const r = rules.servers[s.id]; return (raw.find((x) => x.id === s.id) || {}).name + ':' + (r.def === 'on' ? '默认开' : (r.except.length ? '点名开' + r.except.length : '关')); });
    console.log('预设「' + p.name + '」→ ' + parts.join(' | '));
    presetOut.push({ p, rules });
  });

  if (!APPLY) { console.log('\n（只对比，没写任何文件。确认无误后加 --apply）'); process.exit(0); }
  if (stats.bad) { console.log('\n有意外差异，不写入。先处理上面列出的会话。'); process.exit(2); }
  const bak = path.join(BASE, 'data', 'backups', 'mcp-rules-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(path.join(bak, 'session_cfg'), { recursive: true });
  for (const w of writes) fs.copyFileSync(path.join(CFG_DIR, w.f), path.join(bak, 'session_cfg', w.f));
  fs.copyFileSync(CHAT_SETTINGS, path.join(bak, 'chat-settings.json'));
  for (const w of writes) { w.o.mcp_rules = w.rules; writeJson(path.join(CFG_DIR, w.f), w.o); }
  presetOut.forEach((x) => { x.p.mcp_rules = x.rules; x.p.mcp_mode = 's'; });
  if (presetOut.length) writeJson(CHAT_SETTINGS, cs);
  console.log('\n已写入：会话 ' + writes.length + ' 个、预设 ' + presetOut.length + ' 个。备份：' + bak + '（还原：node scripts/migrate_mcp_rules.js --rollback ' + bak + '）');
  process.exit(0);
})().catch((e) => { console.error('失败：', e); process.exit(1); });
