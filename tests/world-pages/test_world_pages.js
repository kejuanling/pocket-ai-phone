"use strict";
// 小世界页面清单（lib/world-pages.js）的 head() 不能泄漏 fd（11-15 健壮性）：
// 原来 openSync 成功、readSync 抛错时不会 closeSync，GET /admin/world-pages 每列一次清单漏一个句柄。
// 做法：临时目录当 little-world/apps/world 造页面（含读失败页、目录当页），/proc/self/fd 计数连跑 40 次 list()。
// 不碰线上任何目录、不打桩路由，只 patch fs 的两个调用点。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const wp = require("../../lib/world-pages");

const fdCount = () => fs.readdirSync("/proc/self/fd").length;
const tmpDirs = [];
function mkWorld(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "wp-" + tag + "-"));
  tmpDirs.push(d);
  fs.mkdirSync(path.join(d, "good"), { recursive: true });
  fs.writeFileSync(path.join(d, "good", "index.html"),
    '<!doctype html><html><head><title>好页</title><meta name="description" content="描述一"></head></html>', "utf-8");
  fs.writeFileSync(path.join(d, "plain.html"),
    '<html><head><title>裸页</title><meta content="描述二" name="description"></head></html>', "utf-8");
  return d;
}

// A：3 个页面，其中 bad.html 是「open 成功但 read 失败」的那一条（打桩模拟 EIO/EISDIR 竞态）
const A = mkWorld("a");
const badFile = path.join(A, "bad.html");
fs.writeFileSync(badFile, "<html><head><title>坏页</title></head></html>", "utf-8");
// B：3 个页面，其中 dirpage.html 是「名字像页面、其实是目录」，lstat 打桩成文件（模拟 lstat→open 之间被换掉）
const B = mkWorld("b");
const dirFile = path.join(B, "dirpage.html");
fs.mkdirSync(dirFile);
fs.writeFileSync(path.join(dirFile, "inner.txt"), "x", "utf-8");

const ok = [];
const bad = [];
const check = (name, fn) => { try { fn(); ok.push(name); console.log("PASS " + name); } catch (e) { bad.push(name); console.log("FAIL " + name + "\n  " + (e && e.message || e)); } };

// 1) 正常路径：3 条都在清单里，标题/描述与改前一致；读失败那条退回文件名、描述为空
const base = wp.list(A);
check("正常清单 3 条，标题/描述不变", () => {
  assert.strictEqual(base.length, 3, JSON.stringify(base));
  const byPath = Object.fromEntries(base.map((p) => [p.path, p]));
  assert.deepStrictEqual(Object.keys(byPath).sort(), ["bad.html", "good/", "plain.html"]);
  assert.strictEqual(byPath["good/"].title, "好页");
  assert.strictEqual(byPath["good/"].desc, "描述一");
  assert.strictEqual(byPath["plain.html"].title, "裸页");
  assert.strictEqual(byPath["plain.html"].desc, "描述二");
  assert.strictEqual(byPath["bad.html"].title, "坏页");
  for (const p of base) assert.ok(p.mtime && !isNaN(Date.parse(p.mtime)), "mtime 正常: " + JSON.stringify(p));
  assert.ok(base.every((p, i) => i === 0 || String(base[i - 1].mtime) >= String(p.mtime)), "仍按 mtime 倒序");
});

// 2) readSync 抛错：40 次 list() 不漏 fd，条数与标题语义不变
const realOpen = fs.openSync, realRead = fs.readSync, realLstat = fs.lstatSync;
const watched = new Set();
fs.openSync = function (p, ...a) { const fd = realOpen(p, ...a); if (String(p) === badFile) watched.add(fd); return fd; };
fs.readSync = function (fd, ...a) { if (watched.has(fd)) throw new Error("模拟 readSync 失败（EIO/EISDIR）"); return realRead(fd, ...a); };
let deltaA = -1, countsA = [];
try {
  const before = fdCount();
  for (let i = 0; i < 40; i++) { countsA.push(wp.list(A).length); }
  deltaA = fdCount() - before;
} finally { fs.openSync = realOpen; fs.readSync = realRead; }
check("readSync 抛错 40 次：不漏 fd（增量 ≤2）", () => {
  assert.ok(deltaA <= 2, "40 次 list() 漏了 " + deltaA + " 个 fd（>2 就算泄漏）");
});
check("readSync 抛错 40 次：每次仍是 3 条（失败页不消失）", () => {
  assert.deepStrictEqual(Array.from(new Set(countsA)), [3], JSON.stringify(countsA));
});

// 3) 目录当页：lstat 说它是文件、open 成功、readSync 报 EISDIR —— 真文件系统里的同一种失败面
fs.lstatSync = function (p, ...a) {
  if (String(p) === dirFile) return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, mtime: new Date() };
  return realLstat(p, ...a);
};
let deltaB = -1;
try {
  const before = fdCount();
  for (let i = 0; i < 40; i++) { wp.list(B); }
  deltaB = fdCount() - before;
} finally { fs.lstatSync = realLstat; }
check("目录被当成页面 40 次：不漏 fd（增量 ≤2）", () => {
  assert.ok(deltaB <= 2, "40 次 list() 漏了 " + deltaB + " 个 fd（>2 就算泄漏）");
});

// 4) 打桩撤掉后恢复：坏页仍正常读得到，标题没被状态带坏
check("打桩撤掉后仍正常读页面", () => {
  const l = wp.list(A);
  assert.strictEqual(l.length, 3);
  assert.strictEqual(l.find((p) => p.path === "bad.html").title, "坏页");
});

// 5) 线上真实目录：条数与标题仍能取出（只读，不写）
check("线上真实目录 list() 可正常出清单", () => {
  const real = wp.list();
  assert.ok(Array.isArray(real), "返回数组");
  for (const p of real) assert.ok(p.path && p.title, "每条都有 path/title: " + JSON.stringify(p));
  console.log("  线上真实目录条数 " + real.length + "：" + real.map((p) => p.path + "|" + p.title).join(" , "));
});

for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
console.log("\ntest_world_pages: " + ok.length + " passed, " + bad.length + " failed（共 " + (ok.length + bad.length) + " 例）fd 增量 A=" + deltaA + " B=" + deltaB);
process.exit(bad.length ? 1 : 0);
