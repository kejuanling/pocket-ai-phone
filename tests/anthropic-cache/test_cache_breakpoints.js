"use strict";
// Claude 缓存断点（2026-11-04）：默认 5 分钟 / 加强 1 小时；人设/注入/状态/尾巴 四个断点；状态在 system 时单独成块。
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../lib/anthropic-adapter");

const PERSONA = "你叫谢意行，你是她的伴侣。";
const INJ = "## System Instructions\n\n说明\n\n## Long-term Understanding\n\nx\n\n## Core Identity\n\ny\n\n## Notebook Index\n\nn\n\n## Pinned Notes\n\np\n\n## Memory Keywords\n\nk";
const STATE = "## Conversation State 2026-11-04\n\n状态正文";
function req(sysText, extra, opts) {
  const msgs = [{ role: "system", content: sysText }].concat(extra);
  return A.toAnthropicRequest({ model: "claude-opus-5-5", messages: msgs, stream: true }, opts || {});
}
function cc(r) {
  const out = [];
  (Array.isArray(r.system) ? r.system : []).forEach((b, i) => { if (b.cache_control) out.push({ where: "sys" + i, cc: b.cache_control }); });
  r.messages.forEach((m, i) => m.content.forEach((b) => { if (b.cache_control) out.push({ where: "msg" + i, cc: b.cache_control, role: m.role }); }));
  return out;
}
const CHAT = [
  { role: "user", content: "你好\n<current_time>t1</current_time>" },
  { role: "assistant", content: "嗨" },
  { role: "user", content: "在吗\n<current_time>t2</current_time>\n[elapsed:3min]" },
];

test("默认 5 分钟：不写 ttl；加强 1 小时：全部 ttl=1h", () => {
  const a = cc(req(PERSONA + "\n\n" + INJ, CHAT, { oauthIdentity: "id" }));
  assert.ok(a.length >= 3 && a.every((x) => x.cc.ttl === undefined && x.cc.type === "ephemeral"));
  const b = cc(req(PERSONA + "\n\n" + INJ, CHAT, { oauthIdentity: "id", cacheTtl: "1h" }));
  assert.ok(b.every((x) => x.cc.ttl === "1h"));
});

test("人设/注入分块；Pinned Notes 与 Memory Keywords 留在注入块里", () => {
  const r = req(PERSONA + "\n\n" + INJ, CHAT, { oauthIdentity: "id" });
  assert.equal(r.system.length, 3);
  assert.ok(r.system[1].text.indexOf("你叫谢意行") === 0 && r.system[1].text.indexOf("## ") < 0);
  assert.ok(r.system[2].text.indexOf("## Pinned Notes") > 0 && r.system[2].text.indexOf("## Memory Keywords") > 0);
});

test("状态块夹在 system 里：单独一块拿断点，消息里不再找 B3，总数不超过 4", () => {
  const r = req(PERSONA + "\n\n" + INJ + "\n\n" + STATE, CHAT, { oauthIdentity: "id" });
  assert.equal(r.system.length, 4);
  assert.ok(r.system[3].text.indexOf("## Conversation State") === 0);
  assert.ok(cc(r).length <= 4);
  assert.ok(cc(r).filter((x) => x.where.indexOf("sys") === 0).length === 3);
});

test("状态块在消息里：B3 打在它上面", () => {
  const st = [{ role: "user", content: "[系统消息] " + STATE }, { role: "assistant", content: "收到" }];
  const r = req(PERSONA + "\n\n" + INJ, st.concat(CHAT), { oauthIdentity: "id" });
  const ms = cc(r).filter((x) => x.where.indexOf("msg") === 0);
  assert.equal(ms[0].where, "msg0");
  assert.ok(cc(r).length <= 4);
});

test("尾巴断点：她这一轮带 [elapsed] 的话跳过，打在上一条 AI 消息上", () => {
  const r = req(PERSONA + "\n\n" + INJ, CHAT, { oauthIdentity: "id" });
  const ms = cc(r).filter((x) => x.where.indexOf("msg") === 0);
  assert.equal(ms[ms.length - 1].role, "assistant");
});

test("API Key 供应商（无身份行）system 同样分块带断点", () => {
  const r = req(PERSONA + "\n\n" + INJ, CHAT, {});
  assert.ok(Array.isArray(r.system) && r.system.length === 2 && r.system.every((b) => b.cache_control));
});
