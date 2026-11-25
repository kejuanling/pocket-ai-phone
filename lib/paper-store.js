"use strict";

// 留纸 JSON 统一读写模块（2026-10-03）：data/papers.json
// schema: { version: 1, next_id, entries: [{ id, title, summary, category, reason, tags, created_at, updated_at, content, is_index?, pinned?, pinned_at? }] }
// 2026-10-22 批 B：新增 summary（一句话摘要）；category 不再对外使用（旧数据里的值原样留着，不读不写）；
//   tags 仅用户可见可写（AI 工具不带）；is_index=true 是系统维护的「笔记本目录」笔记（只读，每次增删改后重写）。
// 2026-11-02 笔记置顶：pinned=true + pinned_at 是可选字段（取消置顶即删字段，旧代码自动忽略）；置顶不进历史、不动 updated_at。
// entries 按 id 升序 = 创建顺序；留纸全局共享（1009-10 起不再存 session）；原子写（tmp + rename）。
const fs = require("fs");
const path = require("path");

function storePath(baseDir) {
  return path.join(baseDir, "data", "papers.json");
}

function load(baseDir) {
  try {
    const d = JSON.parse(fs.readFileSync(storePath(baseDir), "utf8"));
    if (d && Array.isArray(d.entries)) return d;
  } catch (e) {}
  return { version: 1, next_id: 1, entries: [] };
}

function save(baseDir, store) {
  fs.mkdirSync(path.dirname(storePath(baseDir)), { recursive: true });
  const tmp = storePath(baseDir) + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, storePath(baseDir));
}

function addEntry(baseDir, entry) {
  const st = load(baseDir);
  const id = st.next_id;
  st.entries.push({
    id,
    title: entry.title == null ? "" : String(entry.title),
    summary: entry.summary == null ? "" : String(entry.summary),
    category: entry.category == null ? "" : String(entry.category),
    reason: entry.reason == null ? "" : String(entry.reason),
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    created_at: entry.created_at || new Date().toISOString(),
    updated_at: entry.updated_at || entry.created_at || new Date().toISOString(),
    content: String(entry.content || ""),
    ...(entry.is_index ? { is_index: true } : {}),
  });
  st.next_id = id + 1;
  save(baseDir, st);
  return id;
}

function getEntry(baseDir, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const st = load(baseDir);
  return st.entries.find(e => e.id === n) || null;
}

function listEntries(baseDir) {
  return load(baseDir).entries.slice(); // 已按 id 升序
}

// ── 2026-10-16 工具集 v2：编辑 + 覆盖前留存上一版 ──
// 历史文件 data/papers-history.json：{ version: 1, records: [{ paper_id, saved_at, reason, title, category, tags, content, updated_at }] }
// 只追加；每篇纸最多留最近 20 个版本。网关单进程写，原子写（tmp + rename）。
const MAX_HISTORY_PER_PAPER = 20;

function historyPath(baseDir) {
  return path.join(baseDir, "data", "papers-history.json");
}

function loadHistory(baseDir) {
  try {
    const d = JSON.parse(fs.readFileSync(historyPath(baseDir), "utf8"));
    if (d && Array.isArray(d.records)) return d;
  } catch (e) {}
  return { version: 1, records: [] };
}

function appendHistory(baseDir, rec) {
  const h = loadHistory(baseDir);
  h.records.push(rec);
  const mine = h.records.filter(r => r.paper_id === rec.paper_id);
  if (mine.length > MAX_HISTORY_PER_PAPER) {
    const drop = new Set(mine.slice(0, mine.length - MAX_HISTORY_PER_PAPER));
    h.records = h.records.filter(r => !drop.has(r));
  }
  fs.mkdirSync(path.dirname(historyPath(baseDir)), { recursive: true });
  const tmp = historyPath(baseDir) + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(h, null, 2), "utf8");
  fs.renameSync(tmp, historyPath(baseDir));
}

// 删一张纸：先把整篇写进历史（reason=delete，可从 papers-history.json 找回），再从库里去掉；返回被删条目，找不到返回 null。
function removeEntry(baseDir, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const st = load(baseDir);
  const i = st.entries.findIndex(x => x.id === n);
  if (i < 0) return null;
  const e = st.entries[i];
  appendHistory(baseDir, {
    paper_id: n,
    saved_at: new Date().toISOString(),
    reason: "delete",
    title: e.title || "",
    summary: e.summary || "",
    category: e.category || "",
    paper_reason: e.reason || "",
    tags: Array.isArray(e.tags) ? e.tags : [],
    content: e.content || "",
    created_at: e.created_at || "",
    updated_at: e.updated_at || e.created_at || "",
  });
  st.entries.splice(i, 1);
  save(baseDir, st);
  return e;
}

// 改一张纸：先把旧版写进历史，再落新版；返回改后的条目，找不到返回 null。
function updateEntry(baseDir, id, patch, meta) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const st = load(baseDir);
  const e = st.entries.find(x => x.id === n);
  if (!e) return null;
  appendHistory(baseDir, {
    paper_id: n,
    saved_at: new Date().toISOString(),
    reason: (meta && meta.reason) || "edit",
    title: e.title || "",
    summary: e.summary || "",
    category: e.category || "",
    paper_reason: e.reason || "", // 这篇「为什么记」的旧值；上面的 reason 是本次修改类型（append/replace/meta）
    tags: Array.isArray(e.tags) ? e.tags : [],
    content: e.content || "",
    updated_at: e.updated_at || e.created_at || "",
  });
  Object.assign(e, patch);
  save(baseDir, st);
  return e;
}

/* [位置:lib/paper-store.js·setPinned] [置顶/取消置顶] [11-02：置顶是状态不是内容，不进历史、不动 updated_at，只改 pinned/pinned_at（取消=删字段）；返回改后的条目，找不到返回 null] [注释时间 2026-11-02] */
function setPinned(baseDir, id, pinned) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const st = load(baseDir);
  const e = st.entries.find(x => x.id === n);
  if (!e) return null;
  if (pinned) { e.pinned = true; e.pinned_at = new Date().toISOString(); }
  else { delete e.pinned; delete e.pinned_at; }
  save(baseDir, st);
  return e;
}

/* [位置:lib/paper-store.js·setShowInIndex] [文件夹内单篇是否在目录中显示] [11-21：文件夹默认折叠，开启 show_in_index 的单篇笔记会缩进显示在所属文件夹目录行下；状态开关不进历史、不动 updated_at] [注释时间 2026-11-21] */
function setShowInIndex(baseDir, id, show) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const st = load(baseDir);
  const e = st.entries.find(x => x.id === n);
  if (!e) return null;
  if (show) e.show_in_index = true;
  else delete e.show_in_index;
  save(baseDir, st);
  return e;
}

/* [位置:lib/paper-store.js·updateMetaSilent] [后台小模型静默回写摘要与关键词] [11-21：不进历史、不碰正文与标题，仅回写 summary / tags] [注释时间 2026-11-21] */
function updateMetaSilent(baseDir, id, patch) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || !patch || typeof patch !== "object") return null;
  const st = load(baseDir);
  const e = st.entries.find(x => x.id === n);
  if (!e) return null;
  if (patch.summary !== undefined) e.summary = String(patch.summary || "");
  if (Array.isArray(patch.tags)) e.tags = patch.tags;
  save(baseDir, st);
  return e;
}

function listHistory(baseDir, id) {
  const n = Number(id);
  return loadHistory(baseDir).records.filter(r => r.paper_id === n);
}

module.exports = { storePath, load, save, addEntry, getEntry, listEntries, updateEntry, removeEntry, setPinned, setShowInIndex, updateMetaSilent, listHistory, historyPath };
