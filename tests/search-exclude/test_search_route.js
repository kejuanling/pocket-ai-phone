"use strict";
/* 第11项：routes/chat.js 的 /v1/search（手机）与 /internal/search（AI）——临时目录里放假时间线，桩住依赖，直接调路由处理函数
 * 跑法（项目目录下）：node tests/search-exclude/test_search_route.js */
const fs = require("fs");
const os = require("os");
const path = require("path");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "se-route-"));
fs.mkdirSync(path.join(base, "timeline_data"));
fs.mkdirSync(path.join(base, "data"));
const tmpSet = path.join(base, "settings.json");
process.env.SEARCH_EXCLUDE_SETTINGS = tmpSet;
function putSettings(groups) { fs.writeFileSync(tmpSet, JSON.stringify({ cfg: { session_groups: groups } })); const t = new Date(Date.now() + (putSettings.n = (putSettings.n || 0) + 1) * 2000); fs.utimesSync(tmpSet, t, t); }
function tl(sid, text) {
  fs.writeFileSync(path.join(base, "timeline_data", "enhanced_messages_" + sid + ".json"),
    JSON.stringify([{ id: "m_" + sid, role: "user", content: text, time: new Date().toISOString() }]));
}
tl("s_main", "香蕉蛋糕的做法在主会话里");
tl("s_work", "香蕉蛋糕的做法在干活组里");
tl("s_sub_abc123", "香蕉蛋糕的做法在子会话里");

const routes = {};
const app = { get: (p, h) => { routes[p] = h; }, post() {}, put() {}, delete() {}, addHook() {}, all() {}, patch() {}, register() {} };
const deps = new Proxy({
  baseDir: base,
  loadTimeline: (sid) => JSON.parse(fs.readFileSync(path.join(base, "timeline_data", "enhanced_messages_" + sid + ".json"), "utf8")),
  isRealMessageForTimeline: () => true,
  normalizeContentToText: (c) => String(c),
  readSessionArchive: () => { try { return JSON.parse(fs.readFileSync(path.join(base, "data", "session-archive.json"), "utf8")); } catch (e) { return []; } }
}, { get: (t, k) => (k in t ? t[k] : (k === "recentReplies" || k === "activeGenMap" ? new Map() : function () {})) });
try { require("../../routes/chat")(app, deps); } catch (e) { console.log("注册路由时出错（桩不够）:", e.message); }

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }
async function call(route, url, qs) {
  let out; await routes[route]({ url: url, query: qs }, { send: (x) => { out = x; }, code() { return this; } }); return out;
}
(async () => {
  const q = { q: "香蕉蛋糕", with_id: "1" };
  putSettings([]);
  let ai = await call("/internal/search", "/internal/search?q=x", q), ph = await call("/v1/search", "/v1/search?q=x", q);
  const sd = (r) => (r.results || []).map((x) => x.sid).sort().join(",");
  ok(sd(ai) === "s_main,s_work", "没有不参与组：AI 搜到主会话和干活组，搜不到子会话 → " + sd(ai));
  ok(sd(ph) === "s_main,s_work", "手机搜索同样不含子会话 → " + sd(ph));
  putSettings([{ id: "g", sids: ["s_work"], noSearch: true }]);
  ai = await call("/internal/search", "/internal/search?q=x", q); ph = await call("/v1/search", "/v1/search?q=x", q);
  ok(sd(ai) === "s_main", "开了「不参与检索」：AI 只搜到主会话 → " + sd(ai));
  ok(sd(ph) === "s_main,s_work", "手机上的人工搜索不受影响，仍搜到干活组 → " + sd(ph));
  const own = await call("/internal/search", "/internal/search?q=x", Object.assign({ sid: "s_work" }, q));
  ok(sd(own) === "s_work", "在那个会话自己里搜当前会话（sid=）不受影响 → " + sd(own));
  putSettings([]);
  ai = await call("/internal/search", "/internal/search?q=x", q);
  ok(sd(ai) === "s_main,s_work", "关掉开关立刻恢复（索引缓存跟着重建） → " + sd(ai));
  // 11-09 补：归档（AI 侧后台检索切到这一套后，归档会话必须搜不到；手机人工搜索同样不含已归档，口径同主列表）
  fs.writeFileSync(path.join(base, "data", "session-archive.json"), JSON.stringify(["s_main"]));
  ai = await call("/internal/search", "/internal/search?q=x", q);
  ok(sd(ai) === "s_work", "s_main 归档后：AI 只搜到 s_work → " + sd(ai));
  const own2 = await call("/internal/search", "/internal/search?q=x", Object.assign({ sid: "s_main" }, q));
  ok(sd(own2) === "s_main", "归档会话自己里搜当前会话（sid=）仍可（人工口径） → " + sd(own2));
  fs.writeFileSync(path.join(base, "data", "session-archive.json"), JSON.stringify([]));
  ai = await call("/internal/search", "/internal/search?q=x", q);
  ok(sd(ai) === "s_main,s_work", "取消归档立刻恢复 → " + sd(ai));
  // 11-09 补：time_prefix（后台状态机的「按关键词搜、再按时间段过滤」）
  const localNow = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const day = localNow.slice(0, 10), hour = localNow.slice(0, 13).replace("T", " ");
  let tp = await call("/internal/search", "/internal/search?q=x", Object.assign({ time_prefix: day }, q));
  ok(sd(tp) === "s_main,s_work", "time_prefix=今天（东八区）命中 → " + sd(tp));
  tp = await call("/internal/search", "/internal/search?q=x", Object.assign({ time_prefix: hour }, q));
  ok(sd(tp) === "s_main,s_work", "time_prefix 精确到小时（T 与空格都认）命中 → " + sd(tp));
  tp = await call("/internal/search", "/internal/search?q=x", Object.assign({ time_prefix: day + "T" + hour.slice(11) }, q));
  ok(sd(tp) === "s_main,s_work", "time_prefix 写成 2026-..T.. 形式也认 → " + sd(tp));
  tp = await call("/internal/search", "/internal/search?q=x", Object.assign({ time_prefix: "2001-01-01" }, q));
  ok((tp.results || []).length === 0, "time_prefix=很久以前 → 没有命中");
  const noTp = await call("/internal/search", "/internal/search?q=x", q);
  ok(sd(noTp) === "s_main,s_work", "不传 time_prefix 行为不变（手机/AI 工具）→ " + sd(noTp));
  fs.rmSync(base, { recursive: true, force: true });
  console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
})();
