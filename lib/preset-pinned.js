"use strict";

/* [位置:lib/preset-pinned.js] [按预设隔离的永久上下文存储] [每个自定义预设拥有独立的永久上下文 JSON 文件，完全隔离且不回退到全局 pinned.json] [注释时间 2026-11-25] */

const fs = require("fs-extra");
const fsp = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const PRESET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function normalizePresetId(presetId) {
  const s = String(presetId || "").trim();
  const raw = s.startsWith("preset:") ? s.slice(7) : s;
  if (!PRESET_ID_RE.test(raw)) return "";
  return raw;
}

function storeDir(baseDir) {
  return path.join(baseDir, "data", "preset_pinned");
}

function filePath(baseDir, presetId) {
  const id = normalizePresetId(presetId);
  if (!id) throw new Error("无效的 preset_id");
  return path.join(storeDir(baseDir), id + ".json");
}

function contentSignature(content) {
  return String(content || "").trim();
}

async function atomicWriteJson(file, data) {
  await fs.ensureDir(path.dirname(file));
  const tmp = file + ".tmp." + process.pid + "." + Date.now();
  await fs.writeJson(tmp, data, { spaces: 2 });
  await fs.rename(tmp, file);
}

function withFileLock(file, fn, timeoutMs) {
  if (timeoutMs === undefined) timeoutMs = 8000;
  const lockFile = file + ".lock";
  const start = Date.now();
  return (async () => {
    await fs.ensureDir(path.dirname(file));
    for (;;) {
      let fd = null;
      try {
        try { fd = await fsp.open(lockFile, "wx"); } catch (e) { if (e.code !== "EEXIST") throw e; }
        if (fd) { await fd.close(); break; }
        if (Date.now() - start > timeoutMs) {
          try { await fsp.unlink(lockFile); } catch (e) {}
          continue;
        }
        await new Promise(r => setTimeout(r, 40));
      } catch (err) { throw err; }
    }
    try { return await fn(); } finally { try { await fsp.unlink(lockFile); } catch (e) {} }
  })();
}

function readSync(baseDir, presetId) {
  const id = normalizePresetId(presetId);
  if (!id) return [];
  const fp = path.join(storeDir(baseDir), id + ".json");
  try {
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readJsonSync(fp);
    if (!Array.isArray(raw)) return [];
    return raw.slice().sort((a, b) => (Number(a && a.order) || 0) - (Number(b && b.order) || 0));
  } catch (e) {
    return [];
  }
}

async function readAsync(file) {
  try {
    const raw = await fs.readJson(file);
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function list(baseDir, presetId) {
  return readSync(baseDir, presetId);
}

function counts(baseDir) {
  const dir = storeDir(baseDir);
  const out = {};
  try {
    if (!fs.existsSync(dir)) return out;
    const files = fs.readdirSync(dir);
    for (const fn of files) {
      if (!fn.endsWith(".json")) continue;
      const id = fn.slice(0, -5);
      if (!PRESET_ID_RE.test(id)) continue;
      try {
        const raw = fs.readJsonSync(path.join(dir, fn));
        out[id] = Array.isArray(raw) ? raw.length : 0;
      } catch (e) {
        out[id] = 0;
      }
    }
  } catch (e) {}
  return out;
}

async function add(baseDir, presetId, entry) {
  const fp = filePath(baseDir, presetId);
  const title = entry && entry.title ? String(entry.title) : "";
  const content = entry && entry.content ? String(entry.content) : "";
  if (!content.trim()) return null;
  const sig = contentSignature(content);
  return withFileLock(fp, async () => {
    const fresh = await readAsync(fp);
    if (fresh.some(m => contentSignature(m && m.content) === sig)) return null;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const ord = (entry && entry.order !== undefined && entry.order !== null) ? Number(entry.order) : fresh.length;
    const mem = { id, title, content, order: ord, created_at: now, updated_at: now };
    fresh.push(mem);
    await atomicWriteJson(fp, fresh);
    return mem;
  });
}

async function update(baseDir, presetId, id, updates) {
  const fp = filePath(baseDir, presetId);
  return withFileLock(fp, async () => {
    const fresh = await readAsync(fp);
    const idx = fresh.findIndex(m => m && m.id === id);
    if (idx === -1) return null;
    const patch = {};
    if (updates && updates.title !== undefined) patch.title = String(updates.title);
    if (updates && updates.content !== undefined) patch.content = String(updates.content);
    if (updates && updates.order !== undefined) patch.order = Number(updates.order);
    fresh[idx] = Object.assign({}, fresh[idx], patch, { updated_at: new Date().toISOString() });
    await atomicWriteJson(fp, fresh);
    return fresh[idx];
  });
}

async function reorder(baseDir, presetId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const fp = filePath(baseDir, presetId);
  return withFileLock(fp, async () => {
    const fresh = await readAsync(fp);
    const byId = new Map();
    fresh.forEach(m => { if (m && m.id) byId.set(m.id, m); });
    const next = [];
    const seen = new Set();
    ids.forEach(id => {
      if (byId.has(id) && !seen.has(id)) { next.push(byId.get(id)); seen.add(id); }
    });
    fresh.forEach(m => { if (m && m.id && !seen.has(m.id)) { next.push(m); seen.add(m.id); } });
    next.forEach((m, i) => { m.order = i; });
    await atomicWriteJson(fp, next);
    return next;
  });
}

async function remove(baseDir, presetId, id) {
  const fp = filePath(baseDir, presetId);
  return withFileLock(fp, async () => {
    const fresh = await readAsync(fp);
    const before = fresh.length;
    const next = fresh.filter(m => !(m && m.id === id));
    if (next.length < before) {
      await atomicWriteJson(fp, next);
      return true;
    }
    return false;
  });
}

async function clone(baseDir, fromPresetId, toPresetId) {
  const srcList = readSync(baseDir, fromPresetId);
  const dstFp = filePath(baseDir, toPresetId);
  const now = new Date().toISOString();
  const copied = srcList.map((m, i) => ({
    id: crypto.randomUUID(),
    title: String((m && m.title) || ""),
    content: String((m && m.content) || ""),
    order: i,
    created_at: now,
    updated_at: now,
  }));
  if (!copied.length) return [];
  return withFileLock(dstFp, async () => {
    await atomicWriteJson(dstFp, copied);
    return copied;
  });
}

async function removeScope(baseDir, presetId) {
  const id = normalizePresetId(presetId);
  if (!id) return false;
  const fp = path.join(storeDir(baseDir), id + ".json");
  try {
    if (fs.existsSync(fp)) {
      await fsp.unlink(fp);
      return true;
    }
  } catch (e) {}
  return false;
}

function toPinnedEntries(baseDir, presetId) {
  return readSync(baseDir, presetId).map(p => ({
    id: p && p.id,
    title: p && p.title,
    content: p && p.content,
    order: p && p.order,
    target: "instructions",
  }));
}

function mtimeMs(baseDir, presetId) {
  const id = normalizePresetId(presetId);
  if (!id) return 0;
  try {
    return fs.statSync(path.join(storeDir(baseDir), id + ".json")).mtimeMs || 0;
  } catch (e) {
    return 0;
  }
}

module.exports = {
  normalizePresetId,
  storeDir,
  filePath,
  list,
  counts,
  add,
  update,
  reorder,
  remove,
  clone,
  removeScope,
  toPinnedEntries,
  mtimeMs,
};
