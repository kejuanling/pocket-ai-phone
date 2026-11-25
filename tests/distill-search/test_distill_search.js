"use strict";
/* 蒸馏模型自提检索（11-09）：只搜全库，不再先按日期搜当天
 * 跑法（项目目录下）：node tests/distill-search/test_distill_search.js */
const path = require("path");
const createMemoryDistill = require("../../lib/memory-distill");

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }

(async () => {
  const calls = [];
  const md = createMemoryDistill({
    baseDir: path.join(__dirname, "..", ".."),
    searchContext: async (q, o) => { calls.push({ q, o }); return { ok: true, matches: [{ msg_id: "m" + calls.length, content: "原文 " + q, role: "user", time: "2026-11-01T00:00:00Z", session: "s_x" }] }; },
  });
  const seen = Object.create(null);
  const idx = Object.create(null);
  const r = await md.handleSearchRequests([{ diary: 1, query: "蓝鲸" }], [{ date: "2026-11-01" }], idx, seen);
  ok(calls.length === 1, "一个检索请求只调一次检索（原来先按日期搜当天、没结果再搜全库）: " + calls.length);
  ok(calls[0] && calls[0].o.timePrefix === undefined && calls[0].o.allSessions === true, "调用参数：跨全部会话，不带日期");
  ok(r.got === 1 && idx["m1"], "命中的原文回灌并进了证据索引");

  const md2 = createMemoryDistill({ baseDir: path.join(__dirname, "..", ".."), searchContext: async () => ({ ok: true, matches: [] }) });
  const r2 = await md2.handleSearchRequests([{ diary: 1, query: "没有的事" }], [{ date: "2026-11-01" }], Object.create(null), Object.create(null));
  ok(/已试：全库/.test(r2.text) && !/当天/.test(r2.text), "没搜到时的提示只说试过全库，不再提当天");
  console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
