'use strict';
// mcp-rules.js —— 会话 / 预设的 MCP 工具「规则」模型（纯函数，无 IO）。
// [位置:lib/mcp-rules.js] [工具开关由「冻结的清单」改成「规则」：每个服务器 = 默认开/关 + 例外名单；新增的服务器按 rest 处理] [10-27：预设存的应该是规则不是清单，
//   原来的 mcp_on + mcp_seen + mcp_exact 三件套要靠「见过哪些」去猜新工具，普通会话和预设会话两套策略还互相打架；预设里的工具清单一冻就不再跟着工具集合更新，还会留死 key] [注释时间 2026-10-27]
//
// 规则形状：{ v:1, rest:'global'|'off', servers:{ <服务器id>:{ def:'on'|'off', except:[工具名...] } } }
//   def='on'  ：这个服务器的工具默认全开，except 里列的是「关掉」的（以后新增的工具自动开）；
//   def='off' ：默认全关，except 里列的是「开着」的（以后新增的工具自动关）；
//   没写规则的服务器（比如以后新加的）：rest='global' 跟它的全局开关走，rest='off' 一律关。
// 全局硬规则不变：服务器的 allowTools 白名单永远是硬过滤（调用方负责）；全局 blockTools 黑名单对「默认开」是硬挡
//   （默认开的服务器里，全局禁用的工具照样不进来），要用被全局禁用的工具，得点名开（def='off' + except 里列出）。
// 旧三件套（mcp_on / mcp_seen / mcp_exact）：没有规则的会话仍按旧逻辑跑；deriveFromLegacy 把它们等价换算成规则（迁移 / 弹层编辑时用）。

const V = 1;
const MAX_SERVERS = 200, MAX_EXCEPT = 1000, MAX_NAME = 200;

function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

// 清洗：不合法返回 null；合法返回干净的新对象
function normalizeRules(r) {
  if (!isObj(r)) return null;
  const out = { v: V, rest: r.rest === 'off' ? 'off' : 'global', servers: {} };
  const sv = isObj(r.servers) ? r.servers : {};
  Object.keys(sv).slice(0, MAX_SERVERS).forEach(function (id) {
    if (!id || id.length > 200 || !isObj(sv[id])) return;
    const def = sv[id].def === 'on' ? 'on' : 'off';
    const ex = Array.from(new Set((Array.isArray(sv[id].except) ? sv[id].except : []).map(String).filter(function (n) { return n && n.length <= MAX_NAME; }))).slice(0, MAX_EXCEPT);
    out.servers[id] = { def: def, except: ex };
  });
  return out;
}

// server = { id, enabled, blockTools }（来自 mcp-servers.json 条目 / 客户端配置）
function isBlocked(server, name) { return Array.isArray(server.blockTools) && server.blockTools.indexOf(name) >= 0; }

function toolVisible(rules, server, toolName) {
  const sr = rules.servers[server.id];
  if (sr) {
    const inEx = sr.except.indexOf(toolName) >= 0;
    return sr.def === 'on' ? (!inEx && !isBlocked(server, toolName)) : inEx;
  }
  if (rules.rest === 'global') return server.enabled !== false && !isBlocked(server, toolName);
  return false;
}

// 这个服务器要不要连上去取工具（def=off 且没有例外 = 一个都不开，不必连）
function serverNeeded(rules, server) {
  const sr = rules.servers[server.id];
  if (sr) return sr.def === 'on' || sr.except.length > 0;
  return rules.rest === 'global' && server.enabled !== false;
}

// 旧逻辑（mcp-service.loadTools 里 sessionOn / sessionSeen / sessionExact 那段）的等价函数——只给测试与迁移对比用，线上加载仍走 loadTools 原代码
function legacyVisible(legacy, server, toolName) {
  const key = server.id + '::' + toolName;
  const on = legacy.on instanceof Set ? legacy.on : new Set(legacy.on || []);
  if (on.has(key)) return true;
  const seen = Array.isArray(legacy.seen) ? new Set(legacy.seen) : (legacy.seen instanceof Set ? legacy.seen : null);
  const wantNew = !!(seen && server.enabled !== false && !legacy.exact);
  return !!(wantNew && !seen.has(key) && !isBlocked(server, toolName));
}

function namesOf(keys, prefix) {
  return keys.filter(function (k) { return k.indexOf(prefix) === 0; }).map(function (k) { return k.slice(prefix.length); });
}

// 旧三件套 → 规则。opts.upgradeFull（默认 true）：见过的工具全开着的服务器升级成「默认开」（新工具自动进，这正是要解决的问题）；
//   弹层编辑老会话时传 false，严格保持老行为（只换表示法，不改变任何一个工具的开关）。
// opts.live：{ 服务器id: [现存工具名] }，给了就把例外里已不存在的死名字剔掉。
function deriveFromLegacy(legacy, servers, opts) {
  const o = opts || {};
  const upgrade = o.upgradeFull !== false;
  const onArr = Array.from(legacy.on instanceof Set ? legacy.on : (legacy.on || [])).map(String);
  const onSet = new Set(onArr);
  const seenArr = Array.isArray(legacy.seen) ? legacy.seen.map(String) : (legacy.seen instanceof Set ? Array.from(legacy.seen) : null);
  const exact = !!legacy.exact;
  const rules = { v: V, rest: (!exact && seenArr) ? 'global' : 'off', servers: {} };
  servers.forEach(function (s) {
    const pre = s.id + '::';
    const onN = namesOf(onArr, pre);
    const seenN = seenArr ? namesOf(seenArr, pre) : [];
    const blocked = onN.some(function (n) { return isBlocked(s, n); });
    const wantNew = !!(seenArr && !exact && s.enabled !== false);
    let def = 'off', ex = onN.slice();
    if (wantNew) {
      if (!blocked) { def = 'on'; ex = seenN.filter(function (n) { return !onSet.has(pre + n); }); }
      else if (o.live && Array.isArray(o.live[s.id])) {
        // 已知限制：会话点名开了一个被全局禁用的工具，同时又靠「新工具默认开」——两件事没法用同一条规则表示。
        // 有现存工具清单时，把「现在会开着的」全部点名（保证当前行为不变），代价是这个服务器以后新增的工具不再自动开。
        const seenSet = new Set(seenArr);
        ex = Array.from(new Set(onN.concat(o.live[s.id].filter(function (n) { return !seenSet.has(pre + n) && !isBlocked(s, n); }))));
      }
    } else if (upgrade && seenN.length && onN.length && !blocked && seenN.every(function (n) { return onSet.has(pre + n); })) {
      def = 'on'; ex = [];
    }
    if (o.live && Array.isArray(o.live[s.id])) { const L = new Set(o.live[s.id]); ex = ex.filter(function (n) { return L.has(n); }); }
    rules.servers[s.id] = { def: def, except: ex };
  });
  return normalizeRules(rules);
}

// 旧预设（mcps 勾选清单 + mcp_seen）→ 规则：见过的工具全选了 = 整组「默认开」，否则按勾选的「默认关 + 点名开」；新服务器跟全局
function deriveFromPreset(p, servers, opts) {
  const o = opts || {};
  const onArr = (Array.isArray(p.mcps) ? p.mcps : []).map(String);
  const onSet = new Set(onArr);
  const seenArr = Array.from(new Set((Array.isArray(p.mcp_seen) ? p.mcp_seen : []).map(String).concat(onArr)));
  const rules = { v: V, rest: 'global', servers: {} };
  servers.forEach(function (s) {
    const pre = s.id + '::';
    const onN = namesOf(onArr, pre), seenN = namesOf(seenArr, pre);
    let def = 'off', ex = onN.slice();
    if (onN.length && seenN.every(function (n) { return onSet.has(pre + n); }) && !onN.some(function (n) { return isBlocked(s, n); })) { def = 'on'; ex = []; }
    if (o.live && Array.isArray(o.live[s.id])) { const L = new Set(o.live[s.id]); ex = ex.filter(function (n) { return L.has(n); }); }
    rules.servers[s.id] = { def: def, except: ex };
  });
  return normalizeRules(rules);
}

// 全局现状 → 规则（新建预设 / 没有任何设置的会话进编辑时打底）：全局开着的服务器 = 默认开，停用的 = 默认关
function deriveFromGlobal(servers) {
  const rules = { v: V, rest: 'global', servers: {} };
  servers.forEach(function (s) { rules.servers[s.id] = { def: s.enabled !== false ? 'on' : 'off', except: [] }; });
  return normalizeRules(rules);
}

// 规则 → 现存工具里哪些开着（key 集合）。toolsByServer：{ 服务器id: [工具名] }
function resolveKeys(rules, servers, toolsByServer) {
  const out = new Set();
  servers.forEach(function (s) {
    (toolsByServer[s.id] || []).forEach(function (n) { if (toolVisible(rules, s, n)) out.add(s.id + '::' + n); });
  });
  return out;
}

module.exports = { V, normalizeRules, toolVisible, serverNeeded, legacyVisible, deriveFromLegacy, deriveFromPreset, deriveFromGlobal, resolveKeys };
