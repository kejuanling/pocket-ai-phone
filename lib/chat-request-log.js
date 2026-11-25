"use strict";
// 聊天请求记录（2026-10-18 跨窗口注入定稿：「上一个会话」的唯一依据，替代 last_chat_session.json）
//
// 每次主聊天请求（routes/chat.js 主聊天入口；唤醒不记）记一条：
//   { time, session, count（真实消息条数）, state_version / state_record（该会话当时的状态机版本，没有为 null） }
// 最新在前，只留 20 条滚动。
// 新建会话那一刻取最新一条、排除新会话自己（且时间线还在的），就是「上一个会话」——
// 新会话那时还一条消息都没发，最新那条必然是刚才在聊的会话。
const path = require("path");
const fs = require("fs-extra");

const MAX = 20;

function createChatRequestLog(baseDir) {
  const FILE = path.join(baseDir, "data", "chat_request_log.json");

  function read() {
    try {
      const o = fs.readJsonSync(FILE);
      return Array.isArray(o && o.entries) ? o.entries : [];
    } catch (e) { return []; }
  }

  function stateOf(sessionId) {
    try {
      const st = fs.readJsonSync(path.join(baseDir, "data", "conversation_state.json"))[sessionId];
      if (st && st.version) return { version: Number(st.version), record: st.record_id || null };
    } catch (e) { /* 没有状态机文件 = 无状态 */ }
    return { version: null, record: null };
  }

  // 写入失败静默：绝不影响聊天主链路
  function record(sessionId, count) {
    const sid = String(sessionId || "").trim();
    if (!sid) return false;
    try {
      const st = stateOf(sid);
      const entries = [{
        time: new Date().toISOString(),
        session: sid,
        count: Number.isFinite(count) ? count : null,
        state_version: st.version,
        state_record: st.record,
      }].concat(read()).slice(0, MAX);
      fs.ensureDirSync(path.dirname(FILE));
      const tmp = FILE + ".tmp-" + process.pid;
      fs.writeJsonSync(tmp, { entries: entries }, { spaces: 1 });
      fs.renameSync(tmp, FILE);
      return true;
    } catch (e) {
      console.warn("[chat-request-log] 写入失败（不影响聊天）:", e.message);
      return false;
    }
  }

  // 最新一条「不是 excludeId、且 exists(session) 为真」的记录；没有返回 null
  function latestExcept(excludeId, exists) {
    const ex = String(excludeId || "").trim();
    for (const e of read()) {
      if (!e || !e.session || e.session === ex) continue;
      if (typeof exists === "function" && !exists(e.session)) continue;
      return e;
    }
    return null;
  }

  return { FILE, read, record, latestExcept };
}

module.exports = { createChatRequestLog };
