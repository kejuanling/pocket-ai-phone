'use strict';
// lib/session-archive.js —— 会话归档名单读写（data/session-archive.json）
// 2026-11-03 从 server.js 拆出（server.js 拆分批 2）：server.js 前面几处（新消息落库自动取消归档、chat 路由 deps）要用，
// 所以不跟着 /admin/session-archive 路由一起进 routes/session-misc.js，单独成库；函数体一字未改。
const fs = require('fs-extra');
const path = require('path');

const SESSION_ARCHIVE_FILE = path.join(__dirname, "..", "data", "session-archive.json");
function readSessionArchive(){
  try{ if(fs.existsSync(SESSION_ARCHIVE_FILE)){ const v=JSON.parse(fs.readFileSync(SESSION_ARCHIVE_FILE,"utf-8"))||[]; if(Array.isArray(v)) return v.filter(function(s){return typeof s==="string"&&s;}); } }catch (e) { console.warn('[server.js:7499] optional read failed:', e.message || e); }
  return [];
}
function writeSessionArchive(list){ try{ fs.ensureDirSync(path.dirname(SESSION_ARCHIVE_FILE)); fs.writeFileSync(SESSION_ARCHIVE_FILE, JSON.stringify(list,null,2),"utf-8"); }catch (e) { console.error('[server.js:7502]', e.message || e); } }
function unarchiveSession(sessionId){
  // 新消息落库 → 自动取消归档（归档会话回到主列表；多端由 loadSessions 拉取同步）
  const sid=String(sessionId||"").trim();
  if(!sid) return;
  const list=readSessionArchive();
  if(list.indexOf(sid)<0) return;
  writeSessionArchive(list.filter(function(x){return x!==sid;}));
  console.log(`[session-archive] 会话 ${sid} 有新消息，自动取消归档`);
}

module.exports = { SESSION_ARCHIVE_FILE, readSessionArchive, writeSessionArchive, unarchiveSession };
