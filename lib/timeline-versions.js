/* [位置:lib/timeline-versions.js] [同会话版本存档（重新生成 / 编辑后重新生成留旧版本，‹2/3› 切换）] [11-10：重新生成以前直接删掉锚点之后的全部内容，旧回复找不回；现在截断前把「用户消息内容 + 它之后的整段尾巴」存成一个版本，时间线本身仍是一条直线（上下文拼接 / 状态机压缩 / 快照 / 多端同步都不用动），版本只在旁路文件里] [注释时间 2026-11-10]
   文件：data/timeline_versions/<sid>.json  =  { "<锚点 user 消息 id>": { cur: Number, slots: [ {content, tail, at} ] } }
   约定：cur 指向「此刻活在时间线里」的那一槽，它自己的 content/tail 是空的（真身在时间线）；其余槽存完整的用户内容和整段尾巴。切换 = 把活的那槽的真身写回槽里，再把目标槽取出来换上去。
   本文件只做数据变换和读写，不碰时间线：调用方先算出结果、先把时间线落盘成功，再 save 版本文件（时间线落盘失败时版本文件保持原样）。 */
"use strict";
const fs = require("fs");
const path = require("path");

const MAX_SLOTS = 20;   // 每个锚点最多留多少个版本；超出丢最旧的非当前槽
const SID_RE = /^[A-Za-z0-9_-]+$/;

function dirOf(baseDir) { return path.join(baseDir, "data", "timeline_versions"); }
function fileOf(baseDir, sid) {
  if (!SID_RE.test(String(sid || ""))) throw new Error("非法会话ID");
  return path.join(dirOf(baseDir), sid + ".json");
}

function load(baseDir, sid) {
  try {
    const f = fileOf(baseDir, sid);
    if (!fs.existsSync(f)) return {};
    const o = JSON.parse(fs.readFileSync(f, "utf8"));
    return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
  } catch (e) { console.warn("[timeline-versions] 读取失败 " + sid + ": " + e.message); return {}; }
}

// 空对象 = 没有任何版本，直接删文件，不留空壳
function save(baseDir, sid, store) {
  const f = fileOf(baseDir, sid);
  if (!store || !Object.keys(store).length) { try { fs.unlinkSync(f); } catch (e) { if (e.code !== "ENOENT") throw e; } return; }
  fs.mkdirSync(dirOf(baseDir), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, f);
}

function dropSession(baseDir, sid) {
  try { fs.unlinkSync(fileOf(baseDir, sid)); return true; } catch (e) { if (e.code !== "ENOENT") console.warn("[timeline-versions] 删会话版本失败 " + sid + ": " + e.message); return false; }
}

// 锚点消息被删：它名下所有版本一起删。返回是否有变化（调用方决定要不要 save）
function dropAnchors(store, ids) {
  let hit = false;
  (ids || []).forEach(function (id) { if (store[id]) { delete store[id]; hit = true; } });
  return hit;
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

/* 存档：重新生成 / 编辑后重新生成要截断尾巴前调用。live = {content: 锚点此刻的内容, tail: 锚点之后的整段（会被截掉的那些）}。
   首次：[旧真身] + [新的活槽]，cur 指向新槽；之后：把当前活槽的真身写回槽里，再追加一个新的活槽。返回 {count, cur}（修改的是传入的 store） */
function archive(store, anchorId, live) {
  let e = store[anchorId];
  if (!e || !Array.isArray(e.slots) || !e.slots.length) {
    e = { cur: 0, slots: [{ content: null, tail: null, at: null }] };
    store[anchorId] = e;
  }
  const now = new Date().toISOString();
  e.slots[e.cur] = { content: clone(live.content), tail: clone(live.tail || []), at: now };
  e.slots.push({ content: null, tail: null, at: now });
  e.cur = e.slots.length - 1;
  // 超上限：丢最旧的、且不是当前槽的
  while (e.slots.length > MAX_SLOTS) {
    const drop = e.cur === 0 ? 1 : 0;
    e.slots.splice(drop, 1);
    if (drop < e.cur) e.cur -= 1;
  }
  return { count: e.slots.length, cur: e.cur };
}

/* 切换：live = 时间线里此刻的真身；返回要换上去的 {content, tail}（深拷贝），store 里的活槽改指向 index。index 不合法返回 null */
function switchTo(store, anchorId, index, live) {
  const e = store[anchorId];
  if (!e || !Array.isArray(e.slots)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= e.slots.length || index === e.cur) return null;
  const target = e.slots[index];
  if (!target || target.tail == null) return null;   // 目标槽没存真身（数据损坏），不换
  const out = { content: clone(target.content), tail: clone(target.tail) };
  e.slots[e.cur] = { content: clone(live.content), tail: clone(live.tail || []), at: new Date().toISOString() };
  e.slots[index] = { content: null, tail: null, at: target.at || null };
  e.cur = index;
  return out;
}

/* 删掉一个非当前的版本；剩一个（只有活的那个）就把整条回收 */
function removeSlot(store, anchorId, index) {
  const e = store[anchorId];
  if (!e || !Array.isArray(e.slots)) return false;
  if (!Number.isInteger(index) || index < 0 || index >= e.slots.length || index === e.cur) return false;
  e.slots.splice(index, 1);
  if (index < e.cur) e.cur -= 1;
  if (e.slots.length <= 1) delete store[anchorId];
  return true;
}

// 给前端的摘要：只返回时间线里还存在的锚点；{anchorId: {count, cur}}
function summary(store, existingIds) {
  const out = {};
  const has = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  Object.keys(store || {}).forEach(function (id) {
    const e = store[id];
    if (!has.has(id) || !e || !Array.isArray(e.slots) || e.slots.length < 2) return;
    out[id] = { count: e.slots.length, cur: e.cur };
  });
  return out;
}

/* 把「锚点 + 用户内容 + 尾巴」组回一份新时间线（不改传入的 timeline） */
function composeTimeline(timeline, anchorIdx, content, tail) {
  const head = timeline.slice(0, anchorIdx + 1);
  const a = Object.assign({}, head[anchorIdx]);
  if (content !== undefined && content !== null) a.content = content;
  head[anchorIdx] = a;
  return head.concat(tail || []);
}

/* 压缩联动（2026-11-10 产品确定）：确认压缩块后，被压区间内的版本锚点条目一起删掉（不可逆——
   压缩掉的消息只剩摘要可看，它的重新生成旧版本没有意义；停用压缩块也不会恢复）。
   本函数只算不改：给定版本 store、时间线「消息id→下标」表、启用中的压缩块列表（按 matched 首尾锚点定区间），
   返回落在任一块区间内的锚点 id。调用方拿到后 dropAnchors + save。 */
function coveredAnchors(store, idPos, blocks) {
  const out = [];
  const range = [];
  (blocks || []).forEach(function (b) {
    const m = (b && Array.isArray(b.matched) && b.matched.length) ? b.matched : null;
    if (!m) return;
    let a = null, z = null;
    for (let i = 0; i < m.length; i++) { if (m[i] && m[i].id) { a = m[i]; break; } }
    for (let i = m.length - 1; i >= 0; i--) { if (m[i] && m[i].id) { z = m[i]; break; } }
    if (!a || !z) return;
    const s = idPos.get(String(a.id)), e = idPos.get(String(z.id));
    if (s === undefined || e === undefined) return;
    range.push(s <= e ? [s, e] : [e, s]);
  });
  if (!range.length) return out;
  Object.keys(store || {}).forEach(function (id) {
    const p = idPos.get(String(id));
    if (p === undefined) return;   // 锚点已不在时间线（被删/切走），归删除消息那条路管
    for (let i = 0; i < range.length; i++) { if (p >= range[i][0] && p <= range[i][1]) { out.push(id); break; } }
  });
  return out;
}

module.exports = { MAX_SLOTS, load, save, dropSession, dropAnchors, archive, switchTo, removeSlot, summary, composeTimeline, coveredAnchors, fileOf };
