"use strict";
// 会话「建好即固定」的注入块（2026-10-18 跨窗口注入定稿，规格见 工作流/02「跨窗口注入（1018 定稿）」）
//
// 日记 Earlier Days / 标星对话：会话第一次注入时**选中的是哪几篇**就永远是那几篇——
// 冻结的是成员（日记 id / 标星键），不是文字：
//   · 之后新写的日记、新标星进不来；
//   · 成员被手动修改 → 重建时用改后的内容；被删除 / 隐藏 / 取消标星 → 自然去掉。
// 快照重建（手动 / 状态机提交 / 压缩块变化）只按成员重新渲染这两块。
// 2026-10-22：笔记本目录（notebook_index）不再冻结——每次快照重建都按当前笔记重出（lib/papers.js indexLines）；
//   存量会话 frozen 文件里留着的 notebook_index 成员 / legacy 文字不再被读取。
//
// 数据：data/session_frozen_blocks/<safeSessionToken>.json
//   { members: { conversation_continuity: [diaryId], starred_dialog: [markKey] },
//     legacy:  { <key>: content|null },   // 只在推不出成员时保留的旧文字冻结（兜底，原样注入）
//     updated_at }
// 键不存在 = 还没冻结过；成员为空数组 = 冻结时这块是空的（之后也保持空）。
const path = require("path");
const fs = require("fs-extra");
const { safeSessionToken } = require("./session-token");

const FROZEN_KEYS = ["conversation_continuity", "starred_dialog"];
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

function fileOf(baseDir, sessionId) {
  return path.join(baseDir, "data", "session_frozen_blocks", safeSessionToken(sessionId || "default") + ".json");
}

function load(baseDir, sessionId) {
  try {
    const o = fs.readJsonSync(fileOf(baseDir, sessionId));
    if (!o || typeof o !== "object") return null;
    // 兼容 1018 首版（{blocks:{key:content}}，按文字冻结）→ 归入 legacy
    return { members: Object.assign({}, o.members || {}), legacy: Object.assign({}, o.legacy || {}, o.blocks || {}) };
  } catch (e) { return null; }
}

function save(baseDir, sessionId, store) {
  const f = fileOf(baseDir, sessionId);
  fs.ensureDirSync(path.dirname(f));
  const tmp = f + ".tmp-" + process.pid;
  fs.writeJsonSync(tmp, { members: store.members || {}, legacy: store.legacy || {}, updated_at: new Date().toISOString() });
  fs.renameSync(tmp, f);
}

// ---- 从冻结的文字反推成员（存量会话迁移 / 快照被删前兜底）----
function deriveMembers(baseDir, key, content) {
  const text = String(content || "");
  if (!text) return null;
  try {
    if (key === "conversation_continuity") {
      const ids = require("./diary-store").listEntries(baseDir)
        .filter(e => e && String(e.content || "").trim() && text.includes(String(e.content).trim()))
        .map(e => e.id);
      return ids.length ? ids : null;
    }
    if (key === "starred_dialog") {
      const marks = (fs.readJsonSync(path.join(baseDir, "data", "context_compaction_marks.json")) || {}).marks || {};
      const keys = Object.keys(marks).filter(k => {
        const c = marks[k] && typeof marks[k].content === "string" ? marks[k].content.trim() : "";
        return c && text.includes(c);
      });
      return keys.length ? keys : null;
    }
  } catch (e) { /* 推不出就留文字兜底 */ }
  return null;
}

// 快照被删 / 被不含注入块的内容覆盖之前，把其中三块登记下来（优先推成员，推不出才留文字）。
function seedFromSnapshot(baseDir, sessionId, snap) {
  try {
    if (!snap || !Array.isArray(snap.fixed_blocks) || !snap.fixed_blocks.length) return false;
    const store = load(baseDir, sessionId) || { members: {}, legacy: {} };
    let changed = false;
    for (const b of snap.fixed_blocks) {
      if (!b || FROZEN_KEYS.indexOf(b.key) < 0) continue;
      if (has(store.members, b.key) || has(store.legacy, b.key)) continue;
      const content = (typeof b.content === "string" && b.content) ? b.content : null;
      const m = content ? deriveMembers(baseDir, b.key, content) : null;
      if (m) store.members[b.key] = m; else store.legacy[b.key] = content;
      changed = true;
    }
    if (changed) save(baseDir, sessionId, store);
    return changed;
  } catch (e) {
    console.warn("[frozen-blocks] 从快照补登记失败:", e && e.message);
    return false;
  }
}

// ---- 组装前：按成员收窄 builder 输入 ----
// input：shadow.assembleInput 的产物（会被就地修改）；ctx：{ loadTimeline, starredLimit, excludeMsgs }
// 返回 capture（finalize 登记新成员用）。starred 行也在这里算好（runtime / 分支预置 / 红点比对同一口径）。
function prepareInput(baseDir, sessionId, input, wantSet, ctx) {
  const c = ctx || {};
  const store = load(baseDir, sessionId) || { members: {}, legacy: {} };
  const want = (k) => !wantSet || wantSet.has(k);
  const capture = { store: store };
  const rt = require("../context/context-v2-runtime");
  // 日记：只留成员（被隐藏的 assembleInput 已过滤；删掉的自然不在），篇数放宽到成员数，保证成员都能进
  const dm = store.members.conversation_continuity;
  if (Array.isArray(dm)) {
    const set = new Set(dm.map(String));
    input.diaryEntries = (input.diaryEntries || []).filter(e => set.has(String(e.id)));
    input.config = Object.assign({}, input.config || {}, { diaryCount: Math.max(1, dm.length) });
  }
  // 标星
  if (want("starred_dialog")) {
    const sm = store.members.starred_dialog;
    const entries = Array.isArray(sm)
      ? rt.readStarredDialogEntries(baseDir, c.loadTimeline, 0, null, sm)
      : rt.readStarredDialogEntries(baseDir, c.loadTimeline, c.starredLimit || 0, c.excludeMsgs);
    input.starredLines = entries.map(x => rt.formatDialogEntry(x.role, x.text, x.time));
    capture.starredKeys = entries.map(x => x.key);
  }
  // 笔记本目录不冻结（10-22）：input.notebookLines 就是装配层按当前笔记算好的，原样用
  return capture;
}

// ---- 组装后：登记首次出现的成员；推不出成员的旧文字冻结原样套回 ----
// capture.diaryIds 由调用方从 buildContextBlocks(...).members 填入。readOnly=true（红点比对）只套用、不登记。
function finalize(baseDir, sessionId, blocks, wantSet, capture, readOnly) {
  const list = Array.isArray(blocks) ? blocks : [];
  const store = (capture && capture.store) || load(baseDir, sessionId) || { members: {}, legacy: {} };
  const want = (k) => !wantSet || wantSet.has(k);
  let changed = false;
  const out = [];
  for (const b of list) {
    if (!b || FROZEN_KEYS.indexOf(b.key) < 0) { out.push(b); continue; }
    if (!has(store.members, b.key) && has(store.legacy, b.key)) {
      const lc = store.legacy[b.key];
      if (typeof lc === "string" && lc) out.push(Object.assign({}, b, { content: lc, empty: false }));
      continue;
    }
    out.push(b);
  }
  if (!readOnly) {
    const byKey = new Map(list.filter(Boolean).map(b => [b.key, b]));
    for (const k of FROZEN_KEYS) {
      if (!want(k) || has(store.members, k) || has(store.legacy, k)) continue;
      const blk = byKey.get(k);
      const nonEmpty = blk && !blk.empty && blk.content;
      if (k === "conversation_continuity") store.members[k] = nonEmpty && capture && Array.isArray(capture.diaryIds) ? capture.diaryIds : [];
      else if (k === "starred_dialog") store.members[k] = nonEmpty && capture && Array.isArray(capture.starredKeys) ? capture.starredKeys : [];
      changed = true;
    }
    if (changed) {
      try { save(baseDir, sessionId, store); }
      catch (e) { console.warn("[frozen-blocks] 登记失败（本次照常注入）:", e && e.message); }
    }
  }
  return out;
}

// 分支：子会话是父会话的延续，成员沿用父会话的
function copy(baseDir, fromSessionId, toSessionId) {
  try {
    const src = load(baseDir, fromSessionId);
    if (!src) return false;
    save(baseDir, toSessionId, src);
    return true;
  } catch (e) { return false; }
}

function remove(baseDir, sessionId) {
  try { fs.removeSync(fileOf(baseDir, sessionId)); return true; } catch (e) { return false; }
}

module.exports = { FROZEN_KEYS, load, seedFromSnapshot, deriveMembers, prepareInput, finalize, copy, remove };
