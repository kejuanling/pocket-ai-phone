"use strict";
/* [位置:lib/search-exclude.js] [不参与 AI 检索的会话集合] [10-27 第11项：会话组「···」里的「不参与检索」开了以后，组里的会话不该被 AI 的对话检索搜到；子会话（s_sub_*，子智能体的干活会话）一律不参与。组存 config/chat-settings.json 的 cfg.session_groups（每组 {id,name,sids,noSearch}），按文件 mtime 缓存，改了下次检索自动生效，不用重启] [注释时间 2026-10-27] */
const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "..", "config", "chat-settings.json");
let cache = { file: "", mtime: -1, set: new Set() };

function noSearchSids() {
  const FILE = process.env.SEARCH_EXCLUDE_SETTINGS || DEFAULT_FILE;   // 环境变量只给测试用
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs === cache.mtime && FILE === cache.file) return cache.set;
    const cfg = (JSON.parse(fs.readFileSync(FILE, "utf-8")) || {}).cfg || {};
    const set = new Set();
    (Array.isArray(cfg.session_groups) ? cfg.session_groups : []).forEach(function (g) {
      if (g && g.noSearch === true && Array.isArray(g.sids)) g.sids.forEach(function (s) { if (typeof s === "string" && s) set.add(s); });
    });
    cache = { file: FILE, mtime: st.mtimeMs, set: set };
    return set;
  } catch (e) {
    return cache.set;   // 读不到就沿用上一份，别因为配置文件抖一下就把排除放开
  }
}

// 是否排除：sid 在「不参与检索」组里，或是子会话
function isExcluded(sid) {
  const s = String(sid || "");
  return /^s_sub_/.test(s) || noSearchSids().has(s);
}

// 给检索用的指纹片段：集合变了，索引缓存要跟着重建
function signature() {
  return Array.from(noSearchSids()).sort().join(",");
}

module.exports = { noSearchSids, isExcluded, signature };
