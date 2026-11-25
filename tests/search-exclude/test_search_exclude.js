"use strict";
/* 第11项「不参与检索」：lib/search-exclude 单元 + 对真实时间线的只读集成（searchContextEnhanced 跨会话路径）
 * 跑法（项目目录下）：node tests/search-exclude/test_search_exclude.js */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = path.join(os.tmpdir(), "se-settings-" + process.pid + ".json");
process.env.SEARCH_EXCLUDE_SETTINGS = tmp;
const ex = require("../../lib/search-exclude");
const ctx = require("../../context/context-replacements");

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }
function write(groups) { fs.writeFileSync(tmp, JSON.stringify({ cfg: { session_groups: groups } })); const t = new Date(Date.now() + (write.n = (write.n || 0) + 1) * 1000); fs.utimesSync(tmp, t, t); }

(async () => {
  write([{ id: "g1", sids: ["s_a", "s_b"], noSearch: true }, { id: "g2", sids: ["s_c"] }, { id: "g3", sids: ["s_d"], noSearch: false }]);
  ok(ex.isExcluded("s_a") && ex.isExcluded("s_b"), "组里开了 noSearch 的会话被排除");
  ok(!ex.isExcluded("s_c") && !ex.isExcluded("s_d"), "没开/关掉的组不排除");
  ok(ex.isExcluded("s_sub_abc123") && !ex.isExcluded("s_mine"), "子会话一律排除，普通会话不排除");
  write([]);
  ok(!ex.isExcluded("s_a"), "关掉后（文件变了）立刻生效，不用重启");
  fs.writeFileSync(tmp, "{坏json"); const t = new Date(Date.now() + 60000); fs.utimesSync(tmp, t, t);
  ok(ex.noSearchSids().size === 0, "配置文件读坏了不抛错");

  // 集成：真实时间线只读
  write([]);
  const r1 = await ctx.searchContextEnhanced("", { latest: 100, allSessions: true, limit: 100 });
  const sids = {}; (r1.matches || []).forEach(m => { sids[m.session] = (sids[m.session] || 0) + 1; });
  ok(!Object.keys(sids).some(s => /^s_sub_/.test(s)), "跨会话最近 N 条里没有子会话: " + Object.keys(sids).length + " 个会话");
  const top = Object.keys(sids).sort((a, b) => sids[b] - sids[a])[0];
  if (top) {
    write([{ id: "g", sids: [top], noSearch: true }]);
    const r2 = await ctx.searchContextEnhanced("", { latest: 100, allSessions: true, limit: 100 });
    ok((r2.matches || []).length > 0 && !(r2.matches || []).some(m => m.session === top), "把最活跃的 " + top + " 放进不参与组后，跨会话结果里没有它");
  }
  try { fs.unlinkSync(tmp); } catch (e) {}
  console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
})();
