"use strict";
/* 第7项回放层：历史回放给 AI 的工具调用——去网关注入的 session_id（只限 SESSION_SCOPED 工具）、缩进 JSON 结果压单行；
 * 落盘入参不再带注入的 session_id（_persistArgs 经 streamToolLoop 的 toolHistory 验证见 test_stream_diary_fallback）。
 * 跑法（项目目录下）：node tests/tool-replay/test_replay_clean.js */
const assert = require("assert");
const { convertToolsFieldToToolRole } = require("../../routes/chat-context");
const { compactPrettyJson, buildToolResultContent, SESSION_SCOPED_TOOLS } = require("../../mcp/mcp-tool-loop");

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }

const pretty = JSON.stringify({ ok: true, alarm_id: "wa_x", items: [{ note: "中文\n换行", n: 1 }] }, null, 2);
const msgs = [{
  role: "assistant", id: "m1", content: "好", time: "t",
  tools: [
    { name: "album", args: { action: "add", img: "i1", session_id: "s_abc" }, time: "2026-10-27 03:54:26", result: pretty },
    { name: "subagent", args: { action: "report", session_id: "s_sub_keep" }, time: "2026-10-27 03:55:00", result: "plain text result" },
    { name: "notebook", args: { action: "list" }, time: "2026-10-27 03:56:00", result: "{\n  \"truncated" }
  ]
}];
const out = convertToolsFieldToToolRole(JSON.parse(JSON.stringify(msgs)));
const calls = out[0].tool_calls.map(c => ({ n: c.function.name, a: JSON.parse(c.function.arguments) }));
ok(!("session_id" in calls[0].a) && calls[0].a.action === "add" && calls[0].a.img === "i1", "album（注入型）的 session_id 回放时去掉，别的参数在");
ok(calls[1].a.session_id === "s_sub_keep", "subagent 的 session_id 是任务句柄，必须保留");
const t0 = out[1].content, t1 = out[2].content, t2 = out[3].content;
ok(t0.indexOf("\n  ") < 0 || t0.split("----\n")[1].indexOf("\n") < 0, "缩进 JSON 结果压成单行");
ok(JSON.parse(t0.split("----\n")[1]).items[0].note === "中文\n换行", "压缩后内容不变（中文、换行转义保留）");
ok(t1.endsWith("plain text result"), "普通文本不动");
ok(t2.indexOf("{\n  \"truncated") > 0, "被截断/非法 JSON 不动");
ok(compactPrettyJson('{"a":1}') === '{"a":1}', "本来就是单行的不动");
ok(SESSION_SCOPED_TOOLS.has("album") && SESSION_SCOPED_TOOLS.has("wake") && !SESSION_SCOPED_TOOLS.has("subagent"), "注入型工具集合含 album/wake，不含 subagent");
// 轮内与回放同一出口：同样的 markdown 得到同样的头+体
ok(buildToolResultContent({ name: "x", time: "t", error: null, markdown: pretty }) === buildToolResultContent({ name: "x", time: "t", error: null, markdown: compactPrettyJson(pretty) }), "轮内/回放口径一致");
console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
