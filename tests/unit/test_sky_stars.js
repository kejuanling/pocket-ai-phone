"use strict";
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// 桌面星星按日期定（2026-11-04）：同一天同一片星空、隔天换；分格抖动不扎堆；洗牌后前几颗也散开。
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(require('path').join(PROJECT_ROOT, "workspace/phone-sky2.js"), "utf8");
const a = src.indexOf("function dayKey()"), b = src.indexOf("function seed()");
assert.ok(a > 0 && b > a, "找得到 dayKey/buildStars");
/* [2026-11-15] 11-10 给 buildStars 加了「星星不超过首页情侣大卡下沿」的自适应（document.querySelector + 画布高度 H），
   纯计算里混进了一处 DOM 读取，于是这个 node 里的 eval 直接 ReferenceError、从 11-10 起零覆盖。
   本测试要验的只是星星生成（数量/按日定/分格不扎堆/前几颗散开），所以给最小 stub：querySelector 一律回 null
   → pb=0 → 上界回退源码里的 .3，全部断言口径不变。根治（把星星计算与 DOM 渲染拆成两个函数）动产品代码，另议。 */
function build(dateStr) {
  const RealDate = Date;
  const fake = new RealDate(dateStr);
  const stubDoc = { querySelector: function () { return null; } };
  const code = "var stars=[], starDay=0, H=0;\n" + src.slice(a, b) + "\nbuildStars(); return stars;";
  const D = function () { return fake; }; D.prototype = RealDate.prototype;
  return new Function("Date", "document", code)(D, stubDoc);
}
const s1 = build("2026-11-04T08:00:00"), s1b = build("2026-11-04T23:59:00"), s2 = build("2026-11-05T08:00:00");
assert.strictEqual(s1.length, 24);
assert.deepStrictEqual(s1, s1b, "同一天任何时候都是同一片星空");
assert.notDeepStrictEqual(s1.map((s) => s.x.toFixed(3)), s2.map((s) => s.x.toFixed(3)), "隔天换一片");
/* [2026-11-15] 上界跟着源码走：11-10 起 y1 是按情侣大卡下沿动态算的，取不到卡片时回退 .3（源码里的注释就是这么写）。
   stub 让 querySelector 回 null → 这里就是回退态，所以断言上界是 .3 不是 .4。 */
s1.forEach((s) => { assert.ok(s.x >= .04 && s.x <= .96 && s.y >= .025 && s.y <= .3, "都在顶部区域内"); });
// 分格抖动：每格恰好一颗
/* [2026-11-15] 格子划分必须与源码同一套边界（8 列 × 3 行、y 上界用回退值 .3）；原来写死 .4，
   与 11-10 改后的源码错位，24 颗星会被算成只占 18 个格子——那是测试自己的错位，不是星星扎堆。 */
const cell = (s) => Math.floor((s.x - .04) / ((.96 - .04) / 8)) + "," + Math.floor((s.y - .025) / ((.3 - .025) / 3));
assert.strictEqual(new Set(s1.map(cell)).size, 24, "24 个格子各一颗，不扎堆");
// 先亮的前 8 颗不能全挤在一边（洗牌后覆盖到至少 5 列）
assert.ok(new Set(s1.slice(0, 8).map((s) => cell(s).split(",")[0])).size >= 5, "前 8 颗覆盖至少 5 列");
/* [2026-11-15] 11-10 产品确定去掉光晕（「要篝火页那种干净闪烁小白点」），星对象不再有 big 字段，
   原「4 颗大的带光晕」断言随之作废。改验现在的实际口径：半径 0.35~1.65px 的随机尺寸。 */
assert.ok(s1.every((s) => s.r >= .35 && s.r <= 1.65), "半径都在 0.35~1.65px（11-10 去光晕后的尺寸随机）");
console.log("sky stars: all ok");
