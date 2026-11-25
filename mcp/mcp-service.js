/**
 * mcp-service.js
 * 服务层：把 MCP 服务器工具整合成 OpenAI 兼容的 tools 数组，并执行工具调用。
 *
 * 设计目标（隔离式）：
 *  - server.js 直通转发链路完全不动。
 *  - 本模块独立负责：加载配置、连接 MCP 服务器、工具名冲突处理、把 MCP 工具
 *    转换为 OpenAI 兼容 tools[]、执行 tools/call、把结果扁平化为 markdown 文本。
 *
 * 工具名冲突处理参照 kelivo mcp_tool_service：
 *  - 同名工具用 "server__tool" 改名
 *  - 名字清洗（非 [a-zA-Z0-9_-] 替换为 _，截断 64 字符）
 *  - 首字符非字母/下划线时加 mcp_ 前缀
 */
"use strict";

const fs = require("fs");
const { createClients, McpServerClient } = require("./mcp-client");
const mcpToolOverrides = require("../lib/mcp-tool-overrides");   // 工具说明/参数覆盖层（小手机「工具集」页可改，见 lib/mcp-tool-overrides.js）

// ---- 工具名清洗（参照 kelivo _sanitizeToolNamePart / _limitToolName）----
function sanitizeNamePart(value, fallback = "tool") {
  let s = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^-+/, "");

  // 高亮：display 里的部分被当作代码块给用户看，这里只清洗工具名本身
  s = s.replace(/[_-]+$/, "");
  return s || fallback;
}

function limitName(name, max = 64) {
  return name.length > max ? name.slice(0, max) : name;
}

function qualifiedToolName(serverName, toolName) {
  const s = sanitizeNamePart(serverName, "mcp");
  const t = sanitizeNamePart(toolName, "tool");
  let name = `${s}__${t}`;
  if (!/^[a-zA-Z_]/.test(name)) name = `mcp_${name}`;
  return limitName(name);
}

/* [位置:mcp-service.js·toolKey] [会话级工具开关的稳定标识] [工具暴露名会因重名/开关集合变化而改，会话里存的开关用「服务器id::工具名」] [注释时间 2026-10-21] */
function toolKey(serverId, toolName) { return String(serverId) + "::" + String(toolName); }

/* [位置:mcp-service.js·sessionClients] [补建全局停用服务器的客户端] [createClients 只建全局启用的；会话里单独开了某个全局停用服务器的工具时，要为它补一个客户端（按 id 复用连接）] [注释时间 2026-10-21] */
const _extraClients = new Map(); // serverId -> McpServerClient
function sessionClients(serverClients, sessionOn, configPath) {
  const out = serverClients.slice();
  if (!sessionOn || !configPath) return out;
  const have = new Set(serverClients.map((c) => c.id));
  let servers = [];
  try { servers = JSON.parse(fs.readFileSync(configPath, "utf-8")).servers || []; } catch (e) { return out; }
  for (const cfg of servers) {
    if (!cfg || cfg.enabled !== false || have.has(cfg.id)) continue;   // 只补「全局停用」的
    if (!Array.from(sessionOn).some((k) => k.indexOf(cfg.id + "::") === 0)) continue;
    let c = _extraClients.get(cfg.id);
    if (!c) { c = new McpServerClient(Object.assign({}, cfg, { enabled: true })); _extraClients.set(cfg.id, c); }
    out.push(c);
  }
  return out;
}

/* [位置:mcp-service.js·sessionClientsByRules] [规则要开、但全局停用的服务器补建客户端] [10-27：规则里该服务器默认开 / 点名开了某些工具，而它在全局是停用的，就按 id 补一个客户端（和 sessionClients 同一套缓存）] [注释时间 2026-10-27] */
function sessionClientsByRules(serverClients, rules, configPath) {
  const out = serverClients.slice();
  if (!rules || !configPath) return out;
  const rl = require("../lib/mcp-rules");
  const have = new Set(serverClients.map((c) => c.id));
  let servers = [];
  try { servers = JSON.parse(fs.readFileSync(configPath, "utf-8")).servers || []; } catch (e) { return out; }
  for (const cfg of servers) {
    if (!cfg || cfg.enabled !== false || have.has(cfg.id)) continue;
    if (!rl.serverNeeded(rules, { id: cfg.id, enabled: false, blockTools: cfg.blockTools })) continue;
    let c = _extraClients.get(cfg.id);
    if (!c) { c = new McpServerClient(Object.assign({}, cfg, { enabled: true })); _extraClients.set(cfg.id, c); }
    out.push(c);
  }
  return out;
}

// ---- 加载全部工具，转为 OpenAI 兼容 tools[] ----
// opts.sessionOn：会话级开关（工具 key 数组）。给了就以它为准，不看全局 enabled / blockTools（allowTools 白名单仍是硬过滤）。
async function loadTools(serverClients, opts) {
  const routes = []; // { serverId, serverName, tool, exposedName }
  const nameCounts = {};
  const sessionOn = (opts && Array.isArray(opts.sessionOn)) ? new Set(opts.sessionOn.map(String)) : null;
  // 2026-10-23：sessionSeen = 这份会话清单「见过的」工具 key。给了就让「没见过 + 全局开着」的新工具默认算开（见 session-cfg.js readMcpSeen）
  const sessionSeen = (opts && Array.isArray(opts.sessionSeen)) ? new Set(opts.sessionSeen.map(String)) : null;
  // 2026-10-26 晚：sessionExact = 精确模式（预设开的会话）——AI 实际工具精确等于 mcp_on，全局新增工具不再自动进来
  const sessionExact = !!(opts && opts.sessionExact);
  // 2026-10-27：sessionRules = 会话 / 预设的工具规则（lib/mcp-rules.js）。给了就以规则为准，旧 sessionOn / sessionSeen / sessionExact 不再参与
  const sessionRules = (opts && opts.sessionRules) || null;
  const rl = sessionRules ? require("../lib/mcp-rules") : null;
  const clientById = {};
  serverClients.forEach((c) => { clientById[c.id] = c; });

  for (const client of serverClients) {
    const srvInfo = sessionRules ? { id: client.id, enabled: !(client.config && client.config.enabled === false), blockTools: client.config && client.config.blockTools } : null;
    if (sessionRules && !rl.serverNeeded(sessionRules, srvInfo)) continue;   // 规则里这个服务器一个工具都不开 -> 不必连
    const hasOn = sessionOn && Array.from(sessionOn).some((k) => k.indexOf(client.id + "::") === 0);
    const wantNew = !!(sessionOn && sessionSeen && client.enabled && !sessionExact);   // 全局开着的服务器：即使会话里一个都没开，也要连上去看有没有新工具（精确模式跳过）
    if (!sessionRules && (sessionOn ? !(hasOn || wantNew) : !client.enabled)) continue;
    try {
      await client.connect();
      /* [位置:mcp/mcp-service.js·loadTools] [应用工具说明/参数覆盖] [10-27：本机自建服务器的工具说明和参数可以在小手机「工具集」页改，改的是注入给 AI 的这一份；覆盖只换 description/inputSchema，不碰工具名，也不越过 allowTools/blockTools/sessionOn 的过滤] [注释时间 2026-10-27] */
      const tools = mcpToolOverrides.applyToTools(client.id, await client.listTools());
      // 服务器级工具白名单：mcp-servers.json 条目配 allowTools: [工具名] 时，
      // 只注入名单内的工具，其余丢弃（防止外部服务器塞一堆没用的工具给模型）
      const allowRaw = client.config && client.config.allowTools;
      const allow = Array.isArray(allowRaw) ? allowRaw.map((n) => String(n)) : null;
      // 工具级黑名单（聊天端工具查看页的每工具开关）：blockTools 里的工具不注入模型；
      // 与 allowTools 叠加（先白后黑），新工具不在黑名单即默认可用
      const blockRaw = client.config && client.config.blockTools;
      const block = Array.isArray(blockRaw) ? blockRaw.map((n) => String(n)) : null;
      let visible = allow ? tools.filter((t) => allow.indexOf(t.name) >= 0) : tools;
      if (sessionRules) visible = visible.filter((t) => rl.toolVisible(sessionRules, srvInfo, t.name));
      else if (sessionOn) visible = visible.filter((t) => sessionOn.has(toolKey(client.id, t.name)) || (wantNew && !sessionSeen.has(toolKey(client.id, t.name)) && !(block && block.indexOf(t.name) >= 0)));
      else if (block) visible = visible.filter((t) => block.indexOf(t.name) < 0);
      if (allow && visible.length === 0 && tools.length > 0) {
        console.warn(`[mcp] 服务器 ${client.name} 的 allowTools 白名单未匹配任何工具（服务器共 ${tools.length} 个工具），请检查工具名拼写`);
      }
      visible.forEach((t) => {
        const key = t.name;
        nameCounts[key] = (nameCounts[key] || 0) + 1;
        routes.push({ serverId: client.id, serverName: client.name, tool: t });
      });
    } catch (e) {
      console.warn(`[mcp] 连接失败 ${client.id}: ${e.message}`);
    }
  }

  // 生成唯一 exposedName（参照 kelivo _toolRoutes）
  const usedNames = new Set();
  const result = [];
  for (const route of routes) {
    const conflicted = nameCounts[route.tool.name] > 1;
    const base = conflicted
      ? qualifiedToolName(route.serverName, route.tool.name)
      : route.tool.name;
    let unique = base;
    let counter = 2;
    while (usedNames.has(unique)) {
      unique = `${limitName(base)}_${counter++}`;
    }
    usedNames.add(unique);
    const item = { ...route, exposedName: unique };
    // 执行时直接用生成这条路由的客户端（会话补建的客户端不在 serverClients 里）；不可枚举，避免被序列化
    Object.defineProperty(item, "client", { value: clientById[route.serverId], enumerable: false });
    result.push(item);
  }

  return result;
}

// ---- 把路由列表转成 OpenAI 兼容 tools[] ----
function toOpenAITools(routes) {
  return routes.map((r) => ({
    type: "function",
    function: {
      name: r.exposedName,
      description: r.tool.description || "",
      parameters: r.tool.inputSchema || { type: "object", properties: {} }
    }
  }));
}

// ---- 执行一个工具调用，扁平化为 markdown 文本 ----
async function callToolByExposedName(serverClients, routes, exposedName, args) {
  const route = routes.find((r) => r.exposedName === exposedName);
  if (!route) {
    /* [位置:mcp-service.js·callToolByExposedName] [找不到工具的回执写清原因和办法] [10-23：工具更新后会话快照里还是旧的工具清单，AI 调到旧名字，原来只回「找不到工具: xxx」，AI 看不懂；现在说明是工具已更新、本会话还是旧快照，并告诉它带 rebuild_snapshot=true 可以在本轮结束后更新（拦截在 mcp-tool-loop.js _takeRebuildFlag）] [注释时间 2026-10-23] */
    return _toolError("tool_not_found", `工具「${exposedName}」已更新或已下线，暂不可用。更新工具：调用任意工具时带 rebuild_snapshot=true，本轮对话结束后更新。也可以直接让她在会话菜单点「重建缓存快照」。`);
  }
  const client = route.client || serverClients.find((c) => c.id === route.serverId);
  if (!client) {
    return _toolError("server_unavailable", `服务器不可用: ${route.serverName}`);
  }
  try {
    if (!client.connected) await client.connect();
    const res = await client.callTool(route.tool.name, args || {});
    return _flattenToolResult(res, route);
  } catch (e) {
    /* [位置:mcp-service.js·callToolByExposedName] [超时回执单独成码并写明后果] [网关等不到只是不再等，服务器上的命令多半还在跑；回成笼统的失败 AI 会以为没执行、直接重发造成重复，09-26 还诱发过编假成功] [注释时间 2026-10-22] */
    const raw = String((e && e.message) || e);
    if ((e && e.name === "AbortError") || /aborted|timed out|ETIMEDOUT|超时/i.test(raw)) {
      const sec = Math.round((Number(client.config && client.config.callTimeoutMs) || 15000) / 1000);
      return _toolError("tool_call_timeout", `超时（网关已等待 ${sec} 秒）：命令可能仍在服务器上执行，请先查状态再决定是否重试，不要直接重发`, route);
    }
    return _toolError("tool_call_failed", raw, route);
  }
}

// ---- 工具返回值扁平化（参照 kelivo _flattenToolResult）----
function _flattenToolResult(res, route) {
  if (!res) return _toolError("empty_result", "工具返回为空", route);
  const content = res.content || [];
  const parts = [];
  const images = [];   // 2026-10-27：存进 data/uploads 的工具图（见 lib/tool-images.js），工具循环按模型能不能看图分流
  for (const c of content) {
    if (!c) continue;
    if (c.type === "text" && c.text) {
      parts.push(c.text);
    } else if (c.type === "image") {
      if (c.url) parts.push(`![](${c.url})`);
      else if (c.data) {
        /* [位置:mcp-service.js·_flattenToolResult image] [工具返回的图存下来，不再只留占位符] [10-27 真机：screenshot 返回「[图片: image/jpeg]」，能看图的模型也看不到——图字节在这里被丢了。现在存进 data/uploads/shot-*，文字里写 ![](链接)（前端显示缩略图），同时把 {file,absUrl} 交给工具循环；存不下才回退占位符] [注释时间 2026-10-27] */
        const saved = require("../lib/tool-images").saveToolImage(c.mimeType, c.data);
        if (saved) { parts.push(`![](${saved.absUrl || saved.url})`); images.push(saved); }
        else parts.push(`[图片: ${c.mimeType || "image"}]`);
      }
    } else if (c.type === "resource" && c.text) {
      parts.push(c.text);
    } else if (c.text) {
      parts.push(c.text);
    } else if (c.uri) {
      parts.push(`resource: ${c.uri}`);
    } else {
      try {
        parts.push(JSON.stringify(c));
      } catch (e) {
        parts.push(String(c));
      }
    }
  }
  // 结构化 content（一部分 modern MCP 返回 structuredContent，当 text 缺失时兜底）
  if (parts.length === 0 && res.structuredContent) {
    parts.push(JSON.stringify(res.structuredContent, null, 2));
  }
  const text = parts.join("\n").trim();
  if (res.isError) {
    return _toolError("tool_error", text || "工具执行出错（isError=true）", route);
  }
  return images.length ? { markdown: text || "[工具无返回内容]", images: images } : { markdown: text || "[工具无返回内容]" };
}

function _toolError(code, message, route) {
  return {
    markdown: JSON.stringify(
      {
        type: "tool_error",
        error: code,
        message,
        tool: route?.exposedName,
        server: route?.serverName
      },
      null,
      2
    )
  };
}

module.exports = {
  toolKey,
  sessionClients,
  sessionClientsByRules,
  loadTools,
  toOpenAITools,
  callToolByExposedName
};
