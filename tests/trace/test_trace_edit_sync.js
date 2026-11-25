/* [位置:tests/trace/test_trace_edit_sync.js] [编辑消息后的 trace 同步单测] [11-08：编辑窗改/删 <trace> 标签后 msg.trace 与 trace_notes 要跟着走。routes 层条件分支照 routes/chat.js timeline-sync 的判断复刻验证；trace_notes 用真库备份/还原法测 upsert/remove] [注释时间 2026-11-08] */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const traceLib = require("../../lib/trace");
const traceNotes = require("../../lib/trace-notes");

/* ---- 决策分支（与 routes/chat.js timeline-sync edit·trace 同款判断）：三种编辑场景 ---- */
function syncLikeRoute(updated, oldContent, newContent, sessionId) {
  if (updated.role !== "assistant") return "skip";
  const oldHas = typeof oldContent === "string" && oldContent.toLowerCase().indexOf("<trace") >= 0;
  const newHas = typeof newContent === "string" && newContent.toLowerCase().indexOf("<trace") >= 0;
  if (newHas) {
    if (traceLib.extractFromMessage(updated, sessionId, true) && updated.trace && updated.trace.content) return "upsert";
    return "noop";
  } else if (oldHas) {
    delete updated.trace;
    return "remove";
  }
  return "noop";
}

(function () {
  // 场景1：改 trace 内容（新正文含标签）→ 重挂 + upsert，正文不动
  // （真实链路里 updated = {...timeline[idx], content: op.newContent}，调提取前 content 已是新正文）
  const m1 = { role: "assistant", content: "趁热喝。\n\n<trace>凉掉的蜂蜜水</trace>", id: "m1" };
  assert.strictEqual(syncLikeRoute(m1, "趁热喝。\n\n<trace>热的蜂蜜水</trace>", m1.content, "s_t"), "upsert");
  assert.ok(m1.content.indexOf("<trace>凉掉的蜂蜜水</trace>") >= 0, "keepBody 不动正文");
  assert.strictEqual(m1.trace.content, "凉掉的蜂蜜水", "msg.trace 重挂成新内容");

  // 场景2：删掉标签（新正文不含，原含）→ 清字段，气泡消失
  const m2 = { role: "assistant", content: "趁热喝。\n\n<trace>热的蜂蜜水</trace>", trace: { content: "热的蜂蜜水", at: "t" }, id: "m2" };
  assert.strictEqual(syncLikeRoute(m2, m2.content, "趁热喝。", "s_t"), "remove");
  assert.strictEqual(m2.trace, undefined, "msg.trace 已清");

  // 场景3：旧消息（正文剥过、无标签、msg.trace 有值）编辑正文 → 不动，气泡保住
  const m3 = { role: "assistant", content: "趁热喝。", trace: { content: "热的蜂蜜水", at: "t" }, id: "m3" };
  const t3 = m3.trace;
  assert.strictEqual(syncLikeRoute(m3, m3.content, "趁热喝，别烫着。", "s_t"), "noop");
  assert.strictEqual(m3.trace, t3, "旧气泡没被误删");

  // 场景4：user 消息跳过
  assert.strictEqual(syncLikeRoute({ role: "user", content: "x" }, "x", "y", "s_t"), "skip");

  // 场景5：新正文含标签但提取为空（<trace></trace>）→ noop，不挂空 trace
  const m5 = { role: "assistant", content: "x", id: "m5" };
  assert.strictEqual(syncLikeRoute(m5, "x", "y\n\n<trace></trace>", "s_t"), "noop");
  assert.strictEqual(m5.trace, undefined, "空 trace 不挂");
})();

/* ---- trace_notes upsert/remove（真库备份/还原）---- */
(function () {
  const FILE = traceNotes.FILE;
  const bak = FILE + ".editsync-test-bak";
  fs.existsSync(FILE) && fs.copyFileSync(FILE, bak);
  try {
    const before = traceNotes.list().length;
    // 新增路径（msg_id 没见过 → add）
    const it = traceNotes.upsertByMsgId({ content: "编辑后的味道", session_id: "s_test", msg_id: "edit-sync-ut-1", at: "2026-11-08T00:00:00Z" });
    assert.ok(it && it.id, "新 msg_id 走 add");
    // 更新路径（同 msg_id 再 upsert → 原地改内容，不新增条目）
    const it2 = traceNotes.upsertByMsgId({ content: "又改了一次的味道", session_id: "s_test", msg_id: "edit-sync-ut-1", at: "2026-11-08T01:00:00Z" });
    assert.strictEqual(it2.id, it.id, "同 msg_id 原条目更新");
    assert.strictEqual(it2.content, "又改了一次的味道");
    assert.strictEqual(traceNotes.list().length, before + 1, "不产生重复条目");
    // 按 msg_id 删除
    assert.strictEqual(traceNotes.removeByMsgId("edit-sync-ut-1"), 1);
    assert.strictEqual(traceNotes.list().length, before, "删干净");
    assert.strictEqual(traceNotes.removeByMsgId("edit-sync-ut-1"), 0, "重复删=0");
    // 空防御
    assert.strictEqual(traceNotes.upsertByMsgId({ msg_id: "", content: "x" }), null);
    assert.strictEqual(traceNotes.upsertByMsgId({ msg_id: "x", content: "  " }), null);
  } finally {
    if (fs.existsSync(bak)) { fs.copyFileSync(bak, FILE); fs.unlinkSync(bak); }
  }
})();

console.log("test_trace_edit_sync 全部通过");
