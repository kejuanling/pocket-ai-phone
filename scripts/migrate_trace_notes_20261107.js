#!/usr/bin/env node
/* [位置:scripts/migrate_trace_notes_20261107.js] [一次性迁移：旧气味词典/字段拆分 → 整句逐条记录库 trace_notes.json] [1) 备份并归档 data/scent_dict.json、data/trace_private.json、data/pinned.json 到 data/backups/trace-20261107/；2) 扫全部会话时间线，把每条带 trace 的消息整句重组（新结构直接用 content，旧拆字段结构拼回一句话）入 lib/trace-notes.js（按 msg_id 幂等，可重跑）；3) 输出统计] [11-07 trace 整句化重构] [注释时间 2026-11-07] */
"use strict";
const fs = require("fs");
const ROOT = require('../lib/project-root').projectRoot();
const BN = ROOT + "/data/backups/trace-20261107";

fs.mkdirSync(BN, { recursive: true });
for (const f of ["scent_dict.json", "trace_private.json", "pinned.json"]) {
  const src = ROOT + "/data/" + f;
  if (fs.existsSync(src) && !fs.existsSync(BN + "/" + f)) fs.copyFileSync(src, BN + "/" + f);
}

const tn = require(ROOT + "/lib/trace-notes");
const dir = ROOT + "/timeline_data";
const files = fs.readdirSync(dir).filter((x) => /^enhanced_messages_.+\.json$/.test(x));
let sessions = 0, traced = 0, added = 0, lockedSkip = 0, emptySkip = 0;
for (const f of files) {
  const sid = f.replace(/^enhanced_messages_/, "").replace(/\.json$/, "");
  let msgs;
  try { msgs = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8")); } catch (_) { continue; }
  if (!Array.isArray(msgs)) continue;
  let hit = false;
  for (const m of msgs) {
    const t = m && m.trace;
    if (!t) continue;
    hit = true; traced++;
    if (t.locked) { lockedSkip++; continue; }   // 历史上 lock 从未出现过（trace_private.json 0 条），防御性跳过
    let content = "";
    if (t.content) content = String(t.content);
    else {
      const parts = [];
      if (t.scent) parts.push(t.scent);
      if (Array.isArray(t.moves) && t.moves.length) parts.push(t.moves.map((x) => (x.name || "") + (x.dir === "up" ? "↑" : "↓") + (x.level || "")).join("，"));
      if (t.want) parts.push("想要" + t.want);
      if (t.chose) parts.push("选了" + t.chose);
      if (t.held) parts.push("忍住" + t.held);
      if (t.note) parts.push(t.note);
      content = parts.join("。");
    }
    content = content.replace(/\s+/g, " ").trim();
    if (!content) { emptySkip++; continue; }
    if (tn.add({ content, session_id: sid, msg_id: m.id, at: t.at || m.time })) added++;
  }
  if (hit) sessions++;
}
console.log("[migrate] 会话=" + sessions + " trace总数=" + traced + " 新入库=" + added + " 现库总量=" + tn.list().length + " locked跳过=" + lockedSkip + " 空跳过=" + emptySkip);
if (added === 0 && tn.list().length === 0) { console.error("[migrate] 一条都没入，检查时间线目录"); process.exit(1); }
