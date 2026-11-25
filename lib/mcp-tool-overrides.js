/* [位置:lib/mcp-tool-overrides.js] [MCP 工具说明/参数覆盖层] [10-27：工具集要把本机自建的 MCP 服务器都放进来，每台每个工具的说明和参数都能在手机上改、也能还原到最初；各服务器自己的代码不动，统一在网关注入侧按 服务器id+工具名 改写 description/inputSchema，保存即生效（mtime 缓存，不用重启网关）] [注释时间 2026-10-27] */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "data", "mcp-tool-overrides.json");
const HISTORY_FILE = path.join(ROOT, "data", "mcp-tool-overrides-history.json");
const HISTORY_MAX = 300;
const OLD_SNAP_LIMIT = 400;   // 历史里旧值只留前 400 字，避免一份长说明把历史文件撑大

let _cache = null;
let _stamp = -1;

function _mtime() {
  try { return fs.statSync(FILE).mtimeMs; } catch (e) { return 0; }
}

function _readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch (e) { return fallback; }
}

/* 原子写：临时文件 + rename，写一半断电也不会留下半个 JSON */
function _writeAtomic(file, data) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

/* [位置:lib/mcp-tool-overrides.js·readAll] [读覆盖表（带 mtime 缓存）] [loadTools 每条聊天消息前都会调，不能每次重读文件；文件没变直接返回上次解析结果，保存后 mtime 变自然生效] [注释时间 2026-10-27] */
function readAll() {
  const st = _mtime();
  if (_cache && st === _stamp) return _cache;
  let servers = {};
  if (st) {
    const d = _readJsonSafe(FILE, null);
    if (d && typeof d === "object" && d.servers && typeof d.servers === "object") servers = d.servers;
    else if (d) console.warn("[mcp-tool-overrides] 覆盖文件结构不认识，本次按无覆盖处理");
    else console.warn("[mcp-tool-overrides] 覆盖文件解析失败，本次按无覆盖处理");
  }
  _cache = { version: 1, servers: servers };
  _stamp = st;
  return _cache;
}

/* 某台服务器的覆盖表（工具名 -> { description?, inputSchema?, updated_at? }） */
function getServerOverrides(serverId) {
  const all = readAll().servers || {};
  const o = all[String(serverId)];
  return (o && typeof o === "object") ? o : {};
}

/* [位置:lib/mcp-tool-overrides.js·applyToTools] [把覆盖应用到工具清单] [注入给 AI 的工具说明就是这里改的：只改 description / inputSchema，不碰名字、不过滤开关（开关仍归 allowTools/blockTools/sessionOn 管）；返回新数组，不污染客户端 listTools 的缓存对象] [注释时间 2026-10-27] */
function applyToTools(serverId, tools) {
  const ov = getServerOverrides(serverId);
  const names = Object.keys(ov);
  if (!names.length || !Array.isArray(tools)) return tools;
  return tools.map(function (t) {
    const o = t && ov[t.name];
    if (!o || typeof o !== "object") return t;
    const out = Object.assign({}, t);
    if (typeof o.description === "string" && o.description) out.description = o.description;
    if (o.inputSchema && typeof o.inputSchema === "object") out.inputSchema = o.inputSchema;
    return out;
  });
}

function _clip(v) {
  if (typeof v !== "string") return v;
  return v.length > OLD_SNAP_LIMIT ? v.slice(0, OLD_SNAP_LIMIT) + "…（后面省略）" : v;
}

function _pushHistory(entries) {
  if (!entries.length) return;
  const list = _readJsonSafe(HISTORY_FILE, []);
  const arr = Array.isArray(list) ? list : [];
  arr.unshift.apply(arr, entries);            // 新的在前
  _writeAtomic(HISTORY_FILE, arr.slice(0, HISTORY_MAX));
}

function readHistory(limit) {
  const arr = _readJsonSafe(HISTORY_FILE, []);
  return (Array.isArray(arr) ? arr : []).slice(0, Math.max(1, Number(limit) || 100));
}

/*
 * 保存一个工具的覆盖。
 * patch = { description?: string|null, inputSchema?: object|null }
 *   null / undefined / 空字符串 = 清掉该项覆盖（还原到服务器自带）。
 * 返回 { ok, changed: [字段...] }；两项都清空时整个工具键被删掉（幂等还原）。
 */
function saveTool(serverId, toolName, patch, meta) {
  const sid = String(serverId);
  const tn = String(toolName);
  const all = JSON.parse(JSON.stringify(readAll().servers || {}));
  const cur = (all[sid] && typeof all[sid] === "object") ? all[sid] : {};
  const before = (cur[tn] && typeof cur[tn] === "object") ? cur[tn] : {};
  const next = Object.assign({}, before);
  const changed = [];
  const hist = [];
  const at = new Date().toISOString();
  const who = (meta && meta.source) || "工具集";

  function logField(field, oldV, newV) {
    changed.push(field);
    hist.push({
      time: at,
      server_id: sid,
      server: (meta && meta.serverName) || "",
      tool: tn,
      field: field,
      old: _clip(oldV),
      new: _clip(newV),
      source: who
    });
  }

  if (patch && Object.prototype.hasOwnProperty.call(patch, "description")) {
    const v = patch.description;
    if (v === null || v === undefined || (typeof v === "string" && !v.trim())) {
      if (before.description != null) { delete next.description; logField("description", before.description, null); }
    } else if (typeof v === "string") {
      const txt = v.trim();
      if (txt !== before.description) { next.description = txt; logField("description", before.description || "", txt); }
    }
  }

  if (patch && Object.prototype.hasOwnProperty.call(patch, "inputSchema")) {
    const v = patch.inputSchema;
    if (v === null || v === undefined) {
      if (before.inputSchema != null) { delete next.inputSchema; logField("inputSchema", JSON.stringify(before.inputSchema), null); }
    } else if (typeof v === "object") {
      const a = JSON.stringify(v), b = JSON.stringify(before.inputSchema || null);
      if (a !== b) { next.inputSchema = v; logField("inputSchema", before.inputSchema ? JSON.stringify(before.inputSchema) : "", a); }
    }
  }

  if (changed.length) {
    /* 还原到底（description / inputSchema 都清）时不留空壳：除 updated_at 外没键了，就把这条工具覆盖整个删掉 */
    const alive = Object.keys(next).filter(function (k) { return k !== "updated_at"; });
    if (alive.length) { next.updated_at = at; cur[tn] = next; }
    else if (cur[tn]) { delete cur[tn]; }
    if (Object.keys(cur).length) all[sid] = cur; else delete all[sid];
    _writeAtomic(FILE, { version: 1, servers: all });
    _cache = null; _stamp = -1;          // 下次 readAll 强制重读
    _pushHistory(hist);
  }
  return { ok: true, changed: changed };
}

module.exports = {
  FILE: FILE,
  HISTORY_FILE: HISTORY_FILE,
  readAll: readAll,
  getServerOverrides: getServerOverrides,
  applyToTools: applyToTools,
  saveTool: saveTool,
  readHistory: readHistory
};
