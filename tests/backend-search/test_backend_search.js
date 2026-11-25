"use strict";
/* 后台（蒸馏 / 状态机检索回合 / 记忆回填）按关键词检索原文：searchContextEnhanced 带 q 时调网关 /internal/search（11-09）
 * 用一个假网关（本机随机端口）验证：请求参数与鉴权头、返回格式适配、单条字数上限、各种失败都返回 ok:false 而不是抛错；
 * 不带 q（按日期 / 最近 N 条）不碰网关
 * 跑法（项目目录下）：node tests/backend-search/test_backend_search.js */
const http = require("http");

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }

const KEY = "test-key-" + process.pid;
let calls = [];
let mode = "ok";
const longText = "开头一大段无关的话。".repeat(40) + "蓝鲸的饲养方式很特别" + "结尾又是一大段。".repeat(40);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  calls.push({ path: u.pathname, q: u.searchParams.get("q"), limit: u.searchParams.get("limit"), withId: u.searchParams.get("with_id"), tp: u.searchParams.get("time_prefix"), key: req.headers["x-internal-key"] });
  if (req.headers["x-internal-key"] !== KEY) { res.statusCode = 401; return res.end(JSON.stringify({ error: "bad key" })); }
  if (mode === "500") { res.statusCode = 500; return res.end(JSON.stringify({ error: "boom" })); }
  if (mode === "notjson") return res.end("<html>nope</html>");
  if (mode === "okfalse") return res.end(JSON.stringify({ ok: false }));
  if (mode === "hang") return;   // 不回，等客户端超时
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, mode: "hybrid", total: 2, results: [
    { sid: "s_a", sidx: 7, text: longText, score: 0.9, time: Date.parse("2026-11-01T02:03:04.000Z"), msg_id: "m1", role: "user" },
    { sid: "s_b", sidx: 3, text: "短的一条", score: 0.4, time: 0, msg_id: "m2", role: "assistant" },
  ] }));
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.GATEWAY_CALLBACK_URL = "http://127.0.0.1:" + server.address().port;
  process.env.INTERNAL_API_KEY = KEY;
  const ctx = require("../../context/context-replacements");
  const gw = require("../../lib/gateway-search");

  // 1. 正常：参数、鉴权头、格式
  let r = await ctx.searchContextEnhanced("蓝鲸 饲养", { allSessions: true, limit: 5, timePrefix: "2026-11-01", contentCap: 120 });
  ok(r.ok === true && r.matches.length === 2 && r.total === 2, "带关键词：返回 ok、两条命中");
  ok(calls.length === 1 && calls[0].path === "/internal/search" && calls[0].q === "蓝鲸 饲养" && calls[0].limit === "5" && calls[0].withId === "1" && calls[0].tp === "2026-11-01" && calls[0].key === KEY, "请求：路径/q/limit/with_id=1/time_prefix/鉴权头都对 " + JSON.stringify(calls[0]));
  const m0 = r.matches[0];
  ok(m0.session === "s_a" && m0.msg_id === "m1" && m0.role === "user" && m0.time === "2026-11-01T02:03:04.000Z" && m0.start_index === 7 && m0.source === "timeline", "字段适配：session/msg_id/role/time(ISO)/start_index/source");
  ok(m0.content.length <= 125 && m0.content.indexOf("蓝鲸") >= 0, "单条字数上限：cap=120 时截到命中词附近 → 长度 " + m0.content.length);
  ok(r.matches[1].content === "短的一条" && r.matches[1].time === null, "短文本原样返回；没有时间的消息 time=null");

  // 2. timePrefix 里的 T 当空格（和老逻辑一致）
  calls = [];
  await ctx.searchContextEnhanced("x词", { allSessions: true, timePrefix: "2026-09-28T21" });
  ok(calls[0] && calls[0].tp === "2026-09-28 21", "timePrefix 的 T 换成空格再传 → " + (calls[0] && calls[0].tp));

  // 3. 不支持的用法与失败：都不抛错
  r = await ctx.searchContextEnhanced("x词", { allSessions: false });
  ok(r.ok === false && /跨全部会话/.test(r.error), "带关键词但不是跨会话：明确报错，不去搜");
  mode = "500"; r = await ctx.searchContextEnhanced("x词", { allSessions: true });
  ok(r.ok === false && /HTTP 500/.test(r.error) && /boom/.test(r.error), "网关 500：ok:false，带原因 → " + r.error);
  mode = "notjson"; r = await ctx.searchContextEnhanced("x词", { allSessions: true });
  ok(r.ok === false, "网关回的不是 JSON：ok:false");
  mode = "okfalse"; r = await ctx.searchContextEnhanced("x词", { allSessions: true });
  ok(r.ok === false, "网关回 ok:false：ok:false");
  mode = "ok";
  const savedKey = process.env.INTERNAL_API_KEY; process.env.INTERNAL_API_KEY = "wrong-key";
  r = await ctx.searchContextEnhanced("x词", { allSessions: true });
  ok(r.ok === false && /401/.test(r.error), "钥匙不对：ok:false（401）→ " + r.error);
  delete process.env.INTERNAL_API_KEY;
  r = await ctx.searchContextEnhanced("x词", { allSessions: true });
  ok(r.ok === false && /INTERNAL_API_KEY/.test(r.error), "没配钥匙：ok:false，说明原因");
  process.env.INTERNAL_API_KEY = savedKey;
  const savedUrl = process.env.GATEWAY_CALLBACK_URL; process.env.GATEWAY_CALLBACK_URL = "http://127.0.0.1:1";
  r = await ctx.searchContextEnhanced("x词", { allSessions: true });
  ok(r.ok === false, "网关连不上：ok:false，不抛错");
  process.env.GATEWAY_CALLBACK_URL = savedUrl;
  mode = "hang";
  let threw = null; const t0 = Date.now();
  try { await gw.search({ q: "x词" }, { timeoutMs: 300 }); } catch (e) { threw = e; }
  ok(threw && /超时/.test(threw.message) && Date.now() - t0 < 3000, "网关不回：超时后抛错（300ms 设定）→ " + (threw && threw.message));
  mode = "ok";

  // 4. 不带 q：按日期 / 最近 N 条，不碰网关
  calls = [];
  r = await ctx.searchContextEnhanced("", { allSessions: true, latest: 3, limit: 3 });
  ok(r.ok === true && Array.isArray(r.matches) && calls.length === 0, "不带 q（最近 N 条）：不调网关，条数 " + (r.matches || []).length);
  r = await ctx.searchContextEnhanced("", { allSessions: true, timePrefix: "2001-01-01" });
  ok(r.ok === true && r.matches.length === 0 && calls.length === 0, "不带 q（按日期，很久以前）：空结果、不调网关");
  r = await ctx.searchContextEnhanced("", {});
  ok(r.ok === false, "什么都不给：报错");
  r = await ctx.searchContextEnhanced("", { allSessions: true, latest: 2, limit: 2, contentCap: 100 });
  ok((r.matches || []).every((m) => m.content.length <= 102), "最近 N 条也遵守单条字数上限");

  server.close();
  console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
