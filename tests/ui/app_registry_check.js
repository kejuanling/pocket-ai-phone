#!/usr/bin/env node
/* [位置:tests/ui/app_registry_check.js] [app 注册表一致性断言] [批次4c：桌面 order / 宽屏 appOrder / APPS 元数据三处以前各写一份，电话死项就是这么漏下的；此脚本只读文件做静态核对，不起服务不改数据。核对五条：①宽屏 appOrder 每项在 APPS 有元数据；②桌面 order 每项在 APPS；③phone-chats.js 的兜底数组与 phone-new.html 的 appOrder 逐项一致（防漂移）；④APPS.phone 死项不复活（电话入口走聊天页附件面板 data-p="phone"，桌面无入口）；⑤全部 app 的 ICON 图标齐备（icon() 渲染时 ICON[a.i] 缺失会画出空方块）。退出码 0=通过，1=失败] [注释时间 2026-11-14] */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'workspace', 'phone-new.html'), 'utf8');
const chats = fs.readFileSync(path.join(root, 'workspace', 'phone-chats.js'), 'utf8');

let bad = 0;
function fail(msg) { console.error('  FAIL ' + msg); bad = 1; }
function ok(msg) { console.log('  ok   ' + msg); }

/* 从 APPS={...} 对象字面量提取键（只取两空格缩进的 id:{n:'..'} 形态，避开注释与函数体） */
const appsBlock = html.match(/var APPS=\{([\s\S]*?)\n\};/);
if (!appsBlock) { fail('phone-new.html 里找不到 var APPS={...};'); process.exit(1); }
const appsKeys = new Set();
for (const m of appsBlock[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\{n:/gm)) appsKeys.add(m[1]);

/* 数组提取 */
function arrOf(src, name) {
  const at = src.indexOf(name);
  if (at < 0) return null;
  const a = src.indexOf('[', at), b = src.indexOf(']', a);
  if (a < 0 || b < 0) return null;
  return src.slice(a + 1, b).split(',').map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); }).filter(Boolean);
}
const deskOrder = arrOf(html, 'var order');
const appOrder = arrOf(html, 'var appOrder');
const chatFallback = arrOf(chats, 'var APP_ORDER=window.PH&&window.PH.appOrder||');

console.log('APPS 条目: ' + appsKeys.size + '，桌面 order: ' + (deskOrder || []).length + '，宽屏 appOrder: ' + (appOrder || []).length);

/* ① 宽屏 appOrder ⊆ APPS */
if (appOrder) {
  const miss = appOrder.filter(function (id) { return !appsKeys.has(id); });
  if (miss.length) fail('宽屏 appOrder 里有 APPS 没有的 id: ' + miss.join(', '));
  else ok('宽屏 appOrder 全部有 APPS 元数据');
} else fail('phone-new.html 里找不到 var appOrder=[...]');

/* ② 桌面 order ⊆ APPS */
if (deskOrder) {
  const miss = deskOrder.filter(function (id) { return !appsKeys.has(id); });
  if (miss.length) fail('桌面 order 里有 APPS 没有的 id: ' + miss.join(', '));
  else ok('桌面 order 全部有 APPS 元数据');
} else fail('phone-new.html 里找不到 var order=[...]');

/* ③ 兜底数组与注册表一致 */
if (chatFallback && appOrder) {
  if (JSON.stringify(chatFallback) === JSON.stringify(appOrder)) ok('phone-chats.js 兜底数组与 appOrder 一致');
  else fail('兜底数组漂移：phone-chats.js=[' + chatFallback.join(',') + '] appOrder=[' + appOrder.join(',') + ']');
} else if (!chatFallback) fail('phone-chats.js 里找不到 APP_ORDER 兜底数组');

/* ④ 死项防复活：APPS.phone 不应存在（电话入口在聊天页附件面板 data-p=phone，桌面无入口） */
if (appsKeys.has('phone')) fail('APPS.phone 又回来了（桌面电话死项）');
else ok('APPS 无 phone 死项');

/* ⑤ 图标齐备：icon() 用 ICON[a.i] 渲染，缺了画空块 */
const iconBlock = html.match(/var ICON=\{([\s\S]*?)\n\};/);
const iconKeys = new Set();
if (iconBlock) { for (const m of iconBlock[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):/gm)) iconKeys.add(m[1]); }
if (iconBlock && iconKeys.size) {
  const missIcon = [];
  for (const m of appsBlock[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\{n:[^}]*?i:'([a-z_]+)'/gm)) {
    if (!iconKeys.has(m[2])) missIcon.push(m[1] + '(缺 ' + m[2] + ')');
  }
  if (missIcon.length) fail('这些 app 的 ICON 图标缺失: ' + missIcon.join(', '));
  else ok('全部 app 的 ICON 图标齐备');
} else fail('phone-new.html 里找不到 var ICON={...};（或一条图标都没提出来）');

/* 收尾 */
if (bad) { console.error('\napp 注册表核对未通过'); process.exit(1); }
console.log('\napp 注册表核对通过');
