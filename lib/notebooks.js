"use strict";

/* [位置:lib/notebooks.js] [多本笔记本注册表与路径解析] [11-25：内置 default 指向原 data/papers.json 零迁移；自定义本子落 data/notebooks/<id>/data/papers.json，彻底隔离；支持按会话 session-cfg.notebook_id 解析] [注释时间 2026-11-25] */

const fs = require("fs");
const path = require("path");
const paperStore = require("./paper-store");

const NB_ID_RE = /^nb_[a-z0-9_-]{3,40}$/;
const DEFAULT_BOOK = { id: "default", name: "默认笔记本", builtin: true };

function registryPath(rootDir) {
  return path.join(rootDir, "data", "notebooks.json");
}

function loadRegistry(rootDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(rootDir), "utf8"));
    if (raw && Array.isArray(raw.books)) return raw;
  } catch (e) {}
  return { version: 1, books: [] };
}

function saveRegistry(rootDir, reg) {
  const fp = registryPath(rootDir);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function normalizeId(nbId) {
  const s = String(nbId || "").trim();
  if (!s || s === "default") return "default";
  if (s === "none") return "none";
  if (NB_ID_RE.test(s)) return s;
  return "default";
}

function resolveBaseDir(rootDir, nbId) {
  const id = normalizeId(nbId);
  if (id === "none") return null;
  if (id === "default") return rootDir;
  return path.join(rootDir, "data", "notebooks", id);
}

function countNotes(base) {
  if (!base) return 0;
  try {
    return paperStore.listEntries(base).filter(e => e && !e.is_index).length;
  } catch (e) {
    return 0;
  }
}

function list(rootDir) {
  const reg = loadRegistry(rootDir);
  const out = [
    Object.assign({}, DEFAULT_BOOK, { count: countNotes(rootDir) }),
  ];
  for (const b of reg.books) {
    if (!b || !NB_ID_RE.test(String(b.id || ""))) continue;
    const base = resolveBaseDir(rootDir, b.id);
    out.push({
      id: b.id,
      name: String(b.name || b.id),
      builtin: false,
      created_at: b.created_at || "",
      count: countNotes(base),
    });
  }
  return out;
}

function create(rootDir, name) {
  const nm = String(name || "").trim().slice(0, 20);
  if (!nm) return { ok: false, error: "先起个笔记本名" };
  const reg = loadRegistry(rootDir);
  if (nm === DEFAULT_BOOK.name || reg.books.some(b => b && b.name === nm)) {
    return { ok: false, error: "已经有同名笔记本了" };
  }
  const id = "nb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const book = { id, name: nm, created_at: new Date().toISOString() };
  reg.books.push(book);
  saveRegistry(rootDir, reg);
  return { ok: true, notebook: Object.assign({ builtin: false, count: 0 }, book) };
}

function rename(rootDir, id, name) {
  const nid = String(id || "").trim();
  const nm = String(name || "").trim().slice(0, 20);
  if (!NB_ID_RE.test(nid)) return { ok: false, error: "默认笔记本不能改名" };
  if (!nm) return { ok: false, error: "名字不能为空" };
  const reg = loadRegistry(rootDir);
  const target = reg.books.find(b => b && b.id === nid);
  if (!target) return { ok: false, error: "笔记本不存在" };
  if (nm === DEFAULT_BOOK.name || reg.books.some(b => b && b.id !== nid && b.name === nm)) {
    return { ok: false, error: "已经有同名笔记本了" };
  }
  target.name = nm;
  saveRegistry(rootDir, reg);
  return { ok: true, notebook: Object.assign({ builtin: false, count: countNotes(resolveBaseDir(rootDir, nid)) }, target) };
}

function remove(rootDir, id) {
  const nid = String(id || "").trim();
  if (!NB_ID_RE.test(nid)) return { ok: false, error: "默认笔记本不能删除" };
  const reg = loadRegistry(rootDir);
  const idx = reg.books.findIndex(b => b && b.id === nid);
  if (idx === -1) return { ok: false, error: "笔记本不存在" };
  const [removed] = reg.books.splice(idx, 1);
  saveRegistry(rootDir, reg);
  // 备份后再删除目录，防误删丢数据
  const dir = resolveBaseDir(rootDir, nid);
  try {
    if (dir && fs.existsSync(dir)) {
      const bakDir = path.join(rootDir, "data", "backups", "notebook-delete", new Date().toISOString().replace(/[:.]/g, "-") + "_" + nid);
      fs.mkdirSync(path.dirname(bakDir), { recursive: true });
      fs.renameSync(dir, bakDir);
    }
  } catch (e) {}
  return { ok: true, id: nid, name: removed && removed.name };
}

function resolveForSession(rootDir, sessionId) {
  let nbId = "default";
  try {
    const scfg = require("./session-cfg").createSessionCfg(rootDir);
    const v = scfg.readNotebookId(sessionId);
    if (v) nbId = v;
  } catch (e) {}
  return { id: normalizeId(nbId), baseDir: resolveBaseDir(rootDir, nbId) };
}

function mtimeMs(rootDir, nbId) {
  const base = resolveBaseDir(rootDir, nbId);
  if (!base) return 0;
  try {
    return fs.statSync(paperStore.storePath(base)).mtimeMs || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  DEFAULT_BOOK,
  normalizeId,
  resolveBaseDir,
  resolveForSession,
  list,
  create,
  rename,
  remove,
  mtimeMs,
};
