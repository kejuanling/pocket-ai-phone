'use strict';
// session-mcp.js —— 会话级 MCP 工具开关（聊天页「+」面板的「MCP」入口）。
//
// 分层：配置页里的 MCP 服务器/工具开关是全局的（/admin/mcp/servers）；本接口是会话级的，
// 存在 data/session_cfg/<会话>.json 的 mcp_on（工具 key 列表，"服务器id::工具名"）。
//   - 没存过 = 跟随全局；存了 = 以它为准（可以开全局关着的，也可以关全局开着的）。
//   - 会话建立后首次取工具时，mcp-tool-loop 会把当时的全局状态复制成会话自己的开关。
//   - 改开关会清掉该会话快照里冻结的 tools，下一轮按新开关重新拉取（上游提示词缓存失效一次）。
// 全局停用的服务器默认不探测（stdio 类型连接会拉起子进程），前端点开那一家时才带 probe=<id> 去探。

const fs = require('fs');
const path = require('path');
const { probeServer } = require('../mcp/mcp-client');
const { toolKey } = require('../mcp/mcp-service');
const { createSessionCfg } = require('../lib/session-cfg');
const rl = require('../lib/mcp-rules');   // 2026-10-27 工具规则模型（每个服务器 默认开/关 + 例外）
const snapshotV2 = require('../context/context-snapshot-v2');

const SID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const KEY_RE = /^[^\s]{1,200}::.{1,200}$/;
const PROBE_TIMEOUT_MS = 12000;

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(function (resolve) { setTimeout(function () { resolve({ connected: false, tools: [], error: '连接超时' }); }, ms); }),
  ]);
}

/* [位置:routes/session-mcp.js·probeCached] [探测结果短缓存 + 并发合并] [11-05：完整接口每次都逐个连 MCP 服务器，实测 4~10 秒，弹层每开一次都等。探测成功的结果按「服务器配置」缓存 45 秒；同一服务器同时多个请求合并成一次探测；失败 / 超时不缓存；点开某服务器的 probe=<id> 强制重探。服务器配置（url / 命令 / 环境）变了 key 就变，不会读到旧结构；全局工具开关不在探测里（探测拿的是服务器自己的工具清单），所以开关改了立即生效] [注释时间 2026-11-05] */
const PROBE_TTL_MS = 45000;
const probeCache = new Map();   // key -> { at, res } | { pending: Promise }
function probeCached(server, force) {
  const key = String(server.id) + '|' + JSON.stringify([server.url, server.command, server.args, server.env, server.headers, server.transport, server.type]);
  const hit = probeCache.get(key);
  if (!force && hit) {
    if (hit.pending) return hit.pending;
    if (Date.now() - hit.at < PROBE_TTL_MS) return Promise.resolve(hit.res);
  }
  const pending = withTimeout(probeServer(server), PROBE_TIMEOUT_MS).then(function (res) {
    if (res && res.connected && !res.error && Array.isArray(res.tools) && res.tools.length) probeCache.set(key, { at: Date.now(), res: res });
    else probeCache.delete(key);
    return res;
  }, function (e) { probeCache.delete(key); throw e; });
  probeCache.set(key, { pending: pending });
  return pending;
}

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;
  const baseDir = deps.baseDir;
  const cfgFile = path.join(baseDir, 'config', 'mcp-servers.json');
  const sessionCfg = createSessionCfg(baseDir);

  function readServers() {
    try { return JSON.parse(fs.readFileSync(cfgFile, 'utf-8')).servers || []; } catch (e) { return []; }
  }

  /* [位置:routes/session-mcp.js·GET /admin/session-mcp] [会话级 MCP 工具列表] [每个服务器的工具 + 全局开着没 + 本会话开着没；供「+」面板的 MCP 弹层渲染] [注释时间 2026-10-21] */
  app.get('/admin/session-mcp', { preHandler: basicAuth }, async function (req, reply) {
    try {
      const sid = String((req.query && req.query.session_id) || '').trim();
      if (!SID_RE.test(sid)) return reply.code(400).send({ ok: false, error: '会话 ID 不合法' });
      const probeId = String((req.query && req.query.probe) || '').trim();
      const on = sessionCfg.readMcpOn(sid);                 // null = 跟随全局
      const onSet = on ? new Set(on) : null;
      const seenArr = sessionCfg.readMcpSeen(sid), seenSet = seenArr ? new Set(seenArr) : null;   // 见过的工具（新工具默认开，见 session-cfg.js）
      const exact = sessionCfg.readMcpExact(sid) === true;   // 精确模式：on 就是 on，不再给「没见过+全局开着」的补开（预设开会话要所见即所得）
      const storedRules = sessionCfg.readMcpRules(sid);      // 2026-10-27：有规则就以规则为准（旧 mcp_on/seen/exact 保留不动）
      /* [位置:routes/session-mcp.js·GET light] [轻量模式：只回本会话存的规则，不探测服务器] [11-05：完整接口要逐个连 MCP 探测，4~10 秒；手机弹层新会话先拿全局缓存画，开关是上个会话的残影，还可能被误点覆盖预设规则。light=1 毫秒级返回 rules / follow_global，前端先套规则再等完整数据；没有存规则（旧清单会话）rules=null，前端继续等完整接口换算] [注释时间 2026-11-05] */
      if (String((req.query && req.query.light) || '') === '1') {
        return reply.send({ ok: true, session_id: sid, light: true, follow_global: on === null && !storedRules, rules: storedRules || null, rules_source: storedRules ? 'rules' : (on ? 'legacy' : 'global') });
      }
      const servers = await Promise.all(readServers().map(async function (s) {
        const base = { id: s.id, name: s.name || s.id, enabled_global: s.enabled !== false };
        const srvInfo = { id: s.id, enabled: s.enabled !== false, blockTools: Array.isArray(s.blockTools) ? s.blockTools.map(String) : [] };
        const hasOn = storedRules ? rl.serverNeeded(storedRules, srvInfo) : !!(on && on.some(function (k) { return k.indexOf(s.id + '::') === 0; }));
        if (!(s.enabled !== false || probeId === String(s.id) || hasOn)) return Object.assign(base, { probed: false, tools: [] });
        const pr = await probeCached(Object.assign({}, s, { enabled: true }), probeId === String(s.id));
        const allow = Array.isArray(s.allowTools) ? s.allowTools.map(String) : null;   // 白名单是硬过滤，会话也不能越过
        const block = Array.isArray(s.blockTools) ? s.blockTools.map(String) : [];
        const tools = (pr.tools || []).filter(function (t) { return !allow || allow.indexOf(t.name) >= 0; }).map(function (t) {
          const key = toolKey(s.id, t.name);
          const globalOn = s.enabled !== false && block.indexOf(t.name) < 0;
          const onNow = storedRules ? rl.toolVisible(storedRules, srvInfo, t.name) : (onSet ? (onSet.has(key) || (!exact && !!(seenSet && !seenSet.has(key) && globalOn))) : globalOn);
          return { key: key, name: t.name, description: t.description || '', global_on: globalOn, blocked: block.indexOf(t.name) >= 0, on: onNow };
        });
        /* [位置:routes/session-mcp.js·服务端已停用的工具] [工具集合自己的「停用名单」里的工具也列出来（灰着，不能开）] [10-23：全局工具页读的是完整清单（18 个，停 2 个），会话面板问服务器只拿到在用的 16 个，两边数不一样；现在把工具集合 tools_manifest.json 里 enabled=false 的补在后面，标 disabled_server，总数就对上了] [注释时间 2026-10-23] */
        if (/:8771(\/|$)/.test(String(s.url || ''))) {
          try {
            const man = JSON.parse(fs.readFileSync(path.join(baseDir, 'ai-toolbox', 'tools_manifest.json'), 'utf-8'));
            (man.tools || []).forEach(function (t) {
              if (t && t.name && t.enabled === false && !tools.some(function (x) { return x.name === t.name; })) tools.push({ key: toolKey(s.id, t.name), name: t.name, description: t.description || '', global_on: false, on: false, disabled_server: true });
            });
          } catch (e) { /* 读不到清单就不补，不影响面板 */ }
        }
        return Object.assign(base, { probed: true, connected: !!pr.connected, error: pr.error || '', tools: tools });
      }));
      /* [位置:routes/session-mcp.js·GET rules] [返回会话的工具规则] [10-27：rules = 会话存的规则；没有规则但有旧清单时，换算成等价规则给前端编辑（严格保持老行为，不升级）；都没有 = null（跟随全局，前端用全局现状打底）。
         rules_source: rules / legacy / global。弹层与预设编辑页都以这份规则为编辑对象，保存时 PUT {rules}] [注释时间 2026-10-27] */
      let rules = storedRules, source = storedRules ? 'rules' : 'global';
      if (!rules && on) {
        const live = {};
        servers.forEach(function (sv) { live[sv.id] = (sv.tools || []).filter(function (t) { return !t.disabled_server; }).map(function (t) { return t.name; }); });
        rules = rl.deriveFromLegacy({ on: on, seen: seenArr, exact: exact }, readServers().map(function (s2) { return { id: s2.id, enabled: s2.enabled !== false, blockTools: s2.blockTools || [] }; }), { upgradeFull: false, live: live });
        source = 'legacy';
      }
      reply.send({ ok: true, session_id: sid, follow_global: on === null && !storedRules, exact: exact, on_keys: on || [], rules: rules || null, rules_source: source, servers: servers });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });

  /* [位置:routes/session-mcp.js·PUT /admin/session-mcp] [保存会话级 MCP 工具开关] [on=本会话开着的工具 key 列表；reset=true 回到跟随全局；保存后清快照里冻结的 tools，下一轮重新拉] [注释时间 2026-10-21] */
  app.put('/admin/session-mcp', { preHandler: basicAuth }, async function (req, reply) {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(body.session_id || '').trim();
      if (!SID_RE.test(sid)) return reply.code(400).send({ ok: false, error: '会话 ID 不合法' });
      let saved;
      if (body.reset === true) {
        saved = sessionCfg.saveMcpOn(sid, null);
        sessionCfg.saveMcpSeen(sid, null);
        sessionCfg.saveMcpExact(sid, false);   // 重置回跟随全局，精确标记一并清
        sessionCfg.saveMcpRules(sid, null);
      } else if (body.rules !== undefined && body.rules !== null) {
        /* [位置:routes/session-mcp.js·PUT rules] [保存会话工具规则] [10-27：弹层 / 预设开会话 都发 {rules}；旧字段不动（清掉规则即回旧逻辑，可回滚）] [注释时间 2026-10-27] */
        const norm = rl.normalizeRules(body.rules);
        if (!norm) return reply.code(400).send({ ok: false, error: 'rules 不合法（应为 {rest, servers:{id:{def,except}}}）' });
        sessionCfg.saveMcpRules(sid, norm);
        saved = [];
      } else {
        sessionCfg.saveMcpRules(sid, null);   // 旧客户端（页面没刷新）还在发清单：清掉规则，让清单生效，免得改了没反应
        const arr = Array.isArray(body.on) ? body.on.map(String) : null;
        if (!arr || arr.length > 1000 || arr.some(function (k) { return !KEY_RE.test(k); })) return reply.code(400).send({ ok: false, error: 'on 必须是工具 key 数组（服务器id::工具名）' });
        saved = sessionCfg.saveMcpOn(sid, arr);
        // exact=true 存精确标记（预设开会话用）；false=清；不带=不动。精确会话之后在弹层手动开关也保持精确
        if (body.exact === true) sessionCfg.saveMcpExact(sid, true);
        else if (body.exact === false) sessionCfg.saveMcpExact(sid, false);
        // 面板把当时列出的全部工具 key 一起交上来（seen），连同 on 并进「见过的」；之后全局新增的工具才会被当成新工具
        const seenIn = Array.isArray(body.seen) ? body.seen.map(String).filter(function (k) { return KEY_RE.test(k); }).slice(0, 2000) : [];
        sessionCfg.saveMcpSeen(sid, arr.concat(seenIn), true);
      }
      /* [位置:routes/session-mcp.js·保存后清工具缓存] [改会话开关即时生效] [1026 取消工具冻结后工具清单走 30 秒缓存（原为清快照里冻结的 tools），改开关当场清不等 TTL] [注释时间 2026-10-26] */
      try { require("../mcp/mcp-tool-loop").invalidateToolsCache(sid); } catch (e) { /* 缓存失败不影响保存 */ }
      reply.send({ ok: true, session_id: sid, follow_global: saved === null, rules_saved: !!(body.rules && saved), count: saved ? saved.length : null });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });
};
