/* [位置:routes/mcp-tool-overrides.js] [工具集：本机自建 MCP 服务器的工具清单 + 说明/参数覆盖] [10-27：小手机桌面「工具集」要装下所有服务器自建的 MCP 工具，且每个工具都能改说明和参数、能还原到最初；8771（工具集合）已有自己的一套（tools_config.json + 管理台），其他本机服务器没有覆盖机制，这里在网关注入侧统一兜住，服务器代码零改动] [注释时间 2026-10-27] */
"use strict";

const fs = require("fs");
const path = require("path");
const { McpServerClient } = require("../mcp/mcp-client");
const overrides = require("../lib/mcp-tool-overrides");

const PROBE_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 60000;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const DESC_MAX = 20000;
const SCHEMA_MAX_BYTES = 20000;

/* 「本机自建」的判定：服务跑在这台机器上（含经本机 nginx / 本机公网 IP 反代回来的）。
   外部第三方（花园 / 4399 / glm / parallel / openmeteo）不算，不进工具集。 */
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1"].concat(String(process.env.LOCAL_MCP_HOSTS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean));;
const LOCAL_IDS = [
  "e4a5f214-2e52-475a-92aa-d36f647e2dea",   // 工具集合 8771
  "15de5875-6caa-4f5f-8aa9-19beba9a02b9",   // 云服务器 9010（yun-mcp-v2）
  "ds-mcp-local",                            // DeepSeek搜索 8772
  "a16a31bf-1278-4075-b120-a0bbc87893c6",   // 网易云 3303
  "0974ce16-f744-4479-b79e-d7b3170ab331",   // 邮箱 5000
  "zzf-mcp",                                 // zzf-remote-toy 8890
  "0626c189-93d7-40cb-8aca-cdc3068d57a0"    // 大富翁 8773
];

function isLocalServer(s) {
  if (!s || !s.id) return false;
  if (LOCAL_IDS.indexOf(String(s.id)) >= 0) return true;
  const url = String(s.url || "");
  if (!url) return false;   // stdio 类不在这里管（都要走本机命令，属于另一套）
  try { return LOCAL_HOSTS.indexOf(new URL(url).hostname) >= 0; } catch (e) { return false; }
}

function isManaged8771(s) { return s.name === "工具集合" || /:8771(\/|$)/.test(String(s.url || "")); }

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(function (resolve) { setTimeout(function () { resolve({ connected: false, error: "连接超时" }); }, ms); })
  ]);
}

function schemaOk(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "参数定义要是一个 JSON 对象";
  if (v.type != null && v.type !== "object") return "参数定义的 type 只能是 object";
  if (v.properties != null && (typeof v.properties !== "object" || Array.isArray(v.properties))) return "properties 要是一个对象";
  if (v.required != null && (!Array.isArray(v.required) || v.required.some(function (x) { return typeof x !== "string"; }))) return "required 要是字符串数组";
  let s = "";
  try { s = JSON.stringify(v); } catch (e) { return "参数定义里有无法序列化的内容"; }
  if (s.length > SCHEMA_MAX_BYTES) return "参数定义太长了（上限 " + SCHEMA_MAX_BYTES + " 字符）";
  return null;
}

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;
  const baseDir = deps.baseDir;
  const cfgFile = path.join(baseDir, "config", "mcp-servers.json");
  const manifestFile = path.join(baseDir, "ai-toolbox", "tools_manifest.json");
  const toolsConfigFile = path.join(baseDir, "ai-toolbox", "tools_config.json");

  const _cache = new Map();   // serverId -> { at, data }

  function readJsonSafe(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch (e) { return fallback; }
  }
  function readServers() {
    const cfg = readJsonSafe(cfgFile, null);
    return (cfg && Array.isArray(cfg.servers)) ? cfg.servers : [];
  }
  function localServers() { return readServers().filter(isLocalServer); }

  /* 8771 的清单从 tools_manifest.json 取（含 defaultDescription / defaultInputSchema），
     生效说明来自 tools_config.json 的覆盖；和现有 /admin/tools、管理台同一份口径。 */
  function toolsFrom8771() {
    const man = readJsonSafe(manifestFile, null);
    if (!man || !Array.isArray(man.tools)) return { ok: false, error: "清单还没生成，重启 mcp-tools 后自动重生成", tools: [] };
    const tc = readJsonSafe(toolsConfigFile, {}) || {};
    const disabled = Array.isArray(tc.disabled) ? tc.disabled : [];
    const descs = (tc.descriptions && typeof tc.descriptions === "object") ? tc.descriptions : {};
    const schemas = (tc.schemas && typeof tc.schemas === "object") ? tc.schemas : {};
    const tools = man.tools.filter(function (t) { return t && t.name; }).map(function (t) {
      const dHas = descs[t.name] != null;
      const sHas = schemas[t.name] != null;
      return {
        name: t.name,
        description: dHas ? descs[t.name] : (t.description || ""),
        inputSchema: sHas ? schemas[t.name] : (t.inputSchema || { type: "object", properties: {} }),
        defaultDescription: t.description || "",
        defaultInputSchema: t.inputSchema || { type: "object", properties: {} },
        overridden: { description: dHas, inputSchema: sHas },
        disabled: disabled.indexOf(t.name) >= 0,
        updatedAt: null
      };
    });
    return { ok: true, tools: tools };
  }

  /* 其他本机服务器：现连一次拿完整工具定义（probeServer 只回名字+说明，这里要 inputSchema 才能编辑参数），
     再叠上本文件的覆盖表得到「生效说明」。 */
  async function toolsFromServer(s) {
    const c = new McpServerClient(Object.assign({}, s, { enabled: true }));
    let raw = [];
    try {
      await c.connect();
      raw = await c.listTools() || [];
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), tools: [] };
    } finally {
      try { c.close(); } catch (e) {}
    }
    const ov = overrides.getServerOverrides(s.id);
    const allow = Array.isArray(s.allowTools) ? s.allowTools.map(String) : null;
    const tools = raw.filter(function (t) { return t && t.name && (!allow || allow.indexOf(t.name) >= 0); }).map(function (t) {
      const o = ov[t.name] || {};
      const dHas = typeof o.description === "string" && !!o.description;
      const sHas = !!o.inputSchema && typeof o.inputSchema === "object";
      return {
        name: t.name,
        description: dHas ? o.description : (t.description || ""),
        inputSchema: sHas ? o.inputSchema : (t.inputSchema || { type: "object", properties: {} }),
        defaultDescription: t.description || "",
        defaultInputSchema: t.inputSchema || { type: "object", properties: {} },
        overridden: { description: dHas, inputSchema: sHas },
        disabled: false,
        updatedAt: o.updated_at || null
      };
    });
    return { ok: true, tools: tools };
  }

  /* [位置:routes/mcp-tool-overrides.js·GET /admin/mcp/tool-overrides] [工具集页数据] [一次给出本机自建各服务器的全部工具 + 生效说明/最初说明/改没改；现连服务器较慢，结果缓存 60 秒，?refresh=1 强刷] [注释时间 2026-10-27] */
  app.get("/admin/mcp/tool-overrides", { preHandler: basicAuth }, async function (req, reply) {
    try {
      const force = String((req.query && req.query.refresh) || "") === "1";
      const list = localServers();
      const servers = await Promise.all(list.map(async function (s) {
        const c = _cache.get(String(s.id));
        if (!force && c && Date.now() - c.at < CACHE_TTL_MS) return Object.assign({}, c.data);
        let data;
        if (isManaged8771(s)) {
          const r = toolsFrom8771();
          data = {
            id: s.id, name: s.name || s.id, managed: true,
            enabled: s.enabled !== false, connected: r.ok, error: r.error || "",
            tools: r.tools
          };
        } else {
          const r = await withTimeout(toolsFromServer(s), PROBE_TIMEOUT_MS);
          data = {
            id: s.id, name: s.name || s.id, managed: false,
            enabled: s.enabled !== false, connected: !!r.ok, error: r.error || "",
            tools: r.tools || []
          };
        }
        _cache.set(String(s.id), { at: Date.now(), data: data });
        return Object.assign({}, data);
      }));
      reply.send({
        ok: true,
        at: new Date().toISOString(),
        servers: servers,
        history: overrides.readHistory(100),
        note: "改的是他调用工具时看到的说明和参数；8771「工具集合」仍写管理台那份配置"
      });
    } catch (err) {
      console.error("[GET /admin/mcp/tool-overrides] error:", err.message);
      reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /* [位置:routes/mcp-tool-overrides.js·PUT /admin/mcp/tool-overrides] [保存/还原单个工具的覆盖] [description / inputSchema 传 null = 清掉该项覆盖（还原到最初）；两项都清 = 该工具整条覆盖删除；保存后清工具缓存，下一轮对话即生效] [注释时间 2026-10-27] */
  app.put("/admin/mcp/tool-overrides", { preHandler: basicAuth }, async function (req, reply) {
    try {
      const body = (req.body && typeof req.body === "object") ? req.body : {};
      const serverId = String(body.serverId || "").trim();
      const toolName = String(body.tool || "").trim();
      if (!serverId) return reply.code(400).send({ ok: false, error: "缺 serverId" });
      if (!TOOL_NAME_RE.test(toolName)) return reply.code(400).send({ ok: false, error: "工具名不合法" });
      const srv = localServers().find(function (s) { return String(s.id) === serverId; });
      if (!srv) return reply.code(400).send({ ok: false, error: "这台服务器不在工具集的管理范围里" });
      if (isManaged8771(srv)) return reply.code(400).send({ ok: false, error: "「工具集合」的说明和参数走 /admin/tools（管理台同一份配置），这里不接" });

      const patch = {};
      if (Object.prototype.hasOwnProperty.call(body, "description")) {
        const d = body.description;
        if (d !== null && d !== undefined) {
          if (typeof d !== "string") return reply.code(400).send({ ok: false, error: "说明要是文字" });
          if (d.length > DESC_MAX) return reply.code(400).send({ ok: false, error: "说明太长了（上限 " + DESC_MAX + " 字）" });
        }
        patch.description = d;
      }
      if (Object.prototype.hasOwnProperty.call(body, "inputSchema")) {
        const sc = body.inputSchema;
        if (sc !== null && sc !== undefined) {
          const bad = schemaOk(sc);
          if (bad) return reply.code(400).send({ ok: false, error: bad });
        }
        patch.inputSchema = sc;
      }
      if (!Object.keys(patch).length) return reply.code(400).send({ ok: false, error: "description 和 inputSchema 至少给一个" });

      const r = overrides.saveTool(serverId, toolName, patch, { serverName: srv.name || "" });

      /* 保存即生效：清掉各会话的工具清单缓存（30 秒 TTL 也够，但不必等） */
      try { require("../mcp/mcp-tool-loop").invalidateToolsCache(); } catch (e) { console.warn("[mcp-tool-overrides] 清工具缓存失败:", e.message); }
      _cache.delete(serverId);

      /* 回一份保存后的生效数据，前端就地更新列表标签 */
      const now = overrides.getServerOverrides(serverId)[toolName] || {};
      reply.send({
        ok: true,
        changed: r.changed,
        serverId: serverId,
        tool: toolName,
        description: typeof now.description === "string" ? now.description : null,
        inputSchema: now.inputSchema || null,
        updatedAt: now.updated_at || null,
        history: overrides.readHistory(100)
      });
    } catch (err) {
      console.error("[PUT /admin/mcp/tool-overrides] error:", err.message);
      reply.code(500).send({ ok: false, error: err.message });
    }
  });
};
