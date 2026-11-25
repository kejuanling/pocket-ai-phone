"use strict";
/* 11-09 检索质量批：routes/chat.js 的多词关键词腿 / snip=1 / exclude_sid+exclude_recent_min / /internal/messages 撞号全发
 * 同样在临时目录放假时间线、桩住依赖、直接调路由处理函数。跑法（项目目录下）：node tests/search-exclude/test_search_multiterm.js */
const fs = require("fs");
const os = require("os");
const path = require("path");

const base = fs.mkdtempSync(path.join(os.tmpdir(), "se-multi-"));
fs.mkdirSync(path.join(base, "timeline_data"));
fs.mkdirSync(path.join(base, "data"));
process.env.SEARCH_EXCLUDE_SETTINGS = path.join(base, "settings.json");
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
function tl(sid, msgs) { fs.writeFileSync(path.join(base, "timeline_data", "enhanced_messages_" + sid + ".json"), JSON.stringify(msgs)); }
const pad = (n) => "。".repeat(n);
tl("s_a", [
  { id: "a_old", role: "user", content: pad(80) + "上周去水族馆，聊到蓝鲸的饲养方式，她说很难" + pad(80), time: ago(300) },
  { id: "dup1", role: "assistant", content: "这条在两个会话里都有副本，内容不一样 A", time: ago(299) },
  { id: "a_new", role: "user", content: "蓝鲸饲养的事我刚刚说过一遍", time: ago(5) },
]);
tl("s_b", [
  { id: "b_only", role: "user", content: "蓝鲸真的好大", time: ago(400) },
  { id: "dup1", role: "assistant", content: "这条在两个会话里都有副本，内容不一样 B", time: ago(399) },
]);

const routes = {};
const app = { get: (p, h) => { routes[p] = h; }, post() {}, put() {}, delete() {}, addHook() {}, all() {}, patch() {}, register() {} };
const deps = new Proxy({
  baseDir: base,
  loadTimeline: (sid) => JSON.parse(fs.readFileSync(path.join(base, "timeline_data", "enhanced_messages_" + sid + ".json"), "utf8")),
  isRealMessageForTimeline: () => true,
  normalizeContentToText: (c) => String(c),
  readSessionArchive: () => []
}, { get: (t, k) => (k in t ? t[k] : (k === "recentReplies" || k === "activeGenMap" ? new Map() : function () {})) });
require("../../routes/chat")(app, deps);

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }
async function call(route, url, qs) {
  let out; await routes[route]({ url: url, query: qs }, { send: (x) => { out = x; }, code() { return this; } }); return out;
}
const ids = (r) => (r.results || []).map((x) => x.msg_id);

(async () => {
  const I = "/internal/search?q=x";
  // 1) 多词分开写：以前关键词腿 0 分
  let r = await call("/internal/search", I, { q: "蓝鲸 饲养", with_id: "1" });
  ok(ids(r).includes("a_old") && ids(r).includes("a_new") && ids(r).includes("b_only"), "多词搜到三条（含只有一个词的）→ " + ids(r));
  const iOld = ids(r).indexOf("a_old"), iOnly = ids(r).indexOf("b_only");
  ok(iOld >= 0 && iOld < iOnly, "两个词都有的排在只有一个词的前面");
  ok(r.results.every((x) => typeof x.text === "string"), "不带 snip：仍回整条 text（手机旧行为不变）");
  ok(r.excluded_recent === undefined, "不带排除参数：无 excluded_recent");

  // 2) snip=1
  r = await call("/internal/search", I, { q: "蓝鲸 饲养 水族馆", with_id: "1", snip: "1" });
  const a = r.results.find((x) => x.msg_id === "a_old");
  ok(a && a.snippet && a.text === undefined, "snip=1：回 snippet、不回 text");
  ok(a && a.snippet.includes("水族馆") && a.snippet.includes("蓝鲸") && a.snippet.includes("饲养") && a.snippet.length < 120, "snippet 是命中处片段（盖住三个词、不是整条）→ " + (a && a.snippet));
  const b = r.results.find((x) => x.msg_id === "b_only");
  ok(b && b.snippet === "蓝鲸真的好大", "短消息 snippet 就是原文");

  // 3) 排除当前会话最近 60 分钟
  r = await call("/internal/search", I, { q: "蓝鲸 饲养", with_id: "1", exclude_sid: "s_a", exclude_recent_min: "60" });
  ok(!ids(r).includes("a_new") && ids(r).includes("a_old") && ids(r).includes("b_only"), "排除 s_a 最近 60 分钟：a_new 没了，旧的和别的会话还在 → " + ids(r));
  ok(r.excluded_recent === 1, "excluded_recent=1 → " + r.excluded_recent);
  r = await call("/internal/search", I, { q: "蓝鲸 饲养", with_id: "1", sid: "s_a", exclude_sid: "s_a", exclude_recent_min: "60" });
  ok(ids(r).join() === "a_old", "scope=current（sid=）同样排除 → " + ids(r));
  r = await call("/internal/search", I, { q: "蓝鲸 饲养", with_id: "1", exclude_recent_min: "60" });
  ok(ids(r).includes("a_new"), "只给 exclude_recent_min 不给 exclude_sid：不排除");
  r = await call("/internal/search", I, { q: "蓝鲸 饲养", with_id: "1", exclude_sid: "s_a", exclude_recent_min: "abc" });
  ok(ids(r).includes("a_new"), "exclude_recent_min 不是数字：不排除");
  r = await call("/internal/search", I, { q: "香蕉不存在的词", exclude_sid: "s_a", exclude_recent_min: "60" });
  ok(r.excluded_recent === undefined, "没匹配上的消息不计入 excluded_recent");

  // 4) 单词查询仍可用
  r = await call("/internal/search", I, { q: "蓝鲸", with_id: "1" });
  ok(ids(r).length === 3, "单词查询 → " + ids(r));

  // 5) 手机端 /v1/search 也认 snip
  r = await call("/v1/search", "/v1/search?q=x", { q: "蓝鲸 饲养", snip: "1" });
  ok(r.results.length >= 2 && r.results.every((x) => x.snippet && x.text === undefined), "/v1/search snip=1 同样回 snippet");

  // 6) /internal/messages 撞号：副本全发
  r = await call("/internal/messages", "/internal/messages?ids=dup1", { ids: "dup1", ctx: "2" });
  const ms = (r.multi_session || []).map((g) => g.session).sort().join(",");
  ok(r.ok === false && ms === "s_a,s_b" && !r.ambiguous, "同 id 两个会话：回 multi_session 两组，没有 ambiguous → " + JSON.stringify(r));
  r = await call("/internal/messages", "/internal/messages?ids=a_old", { ids: "a_old", ctx: "1" });
  ok(r.ok === true && r.messages.some((m) => m.msg_id === "a_old" && m.hit === true), "唯一 id：行为不变（单会话直接返回）");
  r = await call("/internal/messages", "/internal/messages?ids=dup1", { ids: "dup1", sid: "s_b", ctx: "0" });
  ok(r.ok === true && r.messages.length === 1 && r.messages[0].text.endsWith("B"), "带 sid 取：只取该会话那份");

  fs.rmSync(base, { recursive: true, force: true });
  console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
})();
