'use strict';
/* [位置:lib/message-lookup.js] [按 msg_id 精确捞时间线原文] [需求:11-08「每条记忆不是有 msgid？为什么不直接用 msgid 做 context 检索」——蒸馏存的 provenance.msg_id 就是消息 uuid，但时间线是快照存储（会话清理/轮转后原文随之消失，2026-11-08 实测 177 条带 id 的记忆只有 52 条还能捞回）。此模块给蒸馏落库补抓拍、重跑查证用：全量 id 索引 + 文件 mtime 指纹缓存，命中返回原文，不命中返回 null（死链如实报告，不猜）] [注释时间 2026-11-08] */

const fs = require("fs-extra");
const path = require("path");
const { timelineDirOf } = require("./timeline-dir");
const searchExclude = require("./search-exclude");
const sessionArchive = require("./session-archive");

function createMessageLookup(opts = {}) {
  const baseDir = opts.baseDir || path.resolve(__dirname, "..");
  const dir = opts.timelineDir || timelineDirOf(baseDir);
  let cache = null; // { ids: Map<uuid, {content, role}>, stamp }

  function loadIndex() {
    // 指纹 = 文件名+mtime 拼接；没变直接用缓存（时间线只在会话活动时写，平时零开销）
    let names = [];
    try { names = fs.readdirSync(dir).filter((f) => /^enhanced_messages.*\.json$/.test(f)).sort(); } catch (e) { names = []; }
    let stamp = "";
    const alive = [];
    /* [位置:lib/message-lookup.js·loadIndex 检索口径过滤] [已归档、子会话、「不参与检索」组的会话不进 id 索引] [11-09：除了她手机上自己的搜索，其他读原文的地方都不能碰到这三类会话；归档名单、不参与检索组变了要重建索引，所以把它们也算进指纹] [注释时间 2026-11-09] */
    const archived = new Set(sessionArchive.readSessionArchive());
    const skip = function (f) {
      const m = /^enhanced_messages_(.+)\.json$/.exec(f);
      return !!m && (archived.has(m[1]) || searchExclude.isExcluded(m[1]));
    };
    for (const f of names) {
      if (skip(f)) continue;
      try { stamp += f + ":" + fs.statSync(path.join(dir, f)).mtimeMs + ";"; alive.push(f); } catch (_) {}
    }
    stamp += "|arch:" + Array.from(archived).sort().join(",") + "|excl:" + searchExclude.signature();
    if (cache && cache.stamp === stamp) return cache;
    const ids = new Map();
    for (const f of alive) {
      // 会话 id 藏在文件名里（enhanced_messages_s_xxx.json → s_xxx），命中时一并返回供 provenance.session_id 回填
      const fm = /^enhanced_messages_(s_[A-Za-z0-9_]+)\.json$/.exec(f);
      const session = fm ? fm[1] : null;
      let data = null;
      try { data = fs.readJsonSync(path.join(dir, f)); } catch (_) { continue; }
      let items = [];
      if (Array.isArray(data)) items = data;
      else if (data && typeof data === "object") {
        for (const v of Object.values(data)) if (Array.isArray(v)) items = items.concat(v);
      }
      for (const m of items) {
        if (m && m.id != null && String(m.id).trim() && !ids.has(String(m.id))) {
          ids.set(String(m.id), { content: String(m.content || ""), role: m.role || null, session: session });
        }
      }
    }
    cache = { ids, stamp };
    return cache;
  }

  // 返回 { msg_id, content, role, session } 或 null（含空 id / 死链）
  function lookup(msgId) {
    const id = String(msgId == null ? "" : msgId).trim();
    if (!id) return null;
    const hit = loadIndex().ids.get(id);
    if (!hit) return null;
    return { msg_id: id, content: hit.content, role: hit.role, session: hit.session };
  }

  function stats() {
    return { messages: loadIndex().ids.size, dir };
  }

  return { lookup, stats };
}

module.exports = { createMessageLookup };
