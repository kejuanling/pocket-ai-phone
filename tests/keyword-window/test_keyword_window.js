"use strict";
/* lib/keyword-window.js 零依赖用例。跑法（项目目录下）：node tests/keyword-window/test_keyword_window.js */
const assert = require("assert");
const kw = require("../../lib/keyword-window");

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("  PASS " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
}
const pad = (n, c) => (c || "啊").repeat(n);

console.log("-- 切词");
check("空白/标点切词，保留单字与虚词", () => {
  assert.deepStrictEqual(kw.terms("蓝鲸 饲养，水族馆"), ["蓝鲸", "饲养", "水族馆"]);
  assert.deepStrictEqual(kw.terms("我的猫"), ["我的猫"]);
  assert.deepStrictEqual(kw.terms("我 的 猫"), ["我", "的", "猫"]);
  assert.deepStrictEqual(kw.terms("2026-08-28 19:34"), ["2026-08-28", "19:34"]);
  assert.deepStrictEqual(kw.terms("A a  B"), ["a", "b"]);
  assert.deepStrictEqual(kw.terms("   "), []);
});

console.log("-- 片段：单词");
check("单词：命中处前后各 30 字", () => {
  const t = pad(100) + "蓝鲸" + pad(100);
  const s = kw.snippet(t, "蓝鲸");
  assert.ok(s.startsWith("…") && s.endsWith("…"));
  assert.strictEqual(s.length, 1 + 30 + 2 + 30 + 1);
  assert.ok(s.includes("蓝鲸"));
});
check("单词在开头：前面没有省略号", () => {
  const s = kw.snippet("蓝鲸" + pad(100), "蓝鲸");
  assert.ok(!s.startsWith("…") && s.endsWith("…") && s.startsWith("蓝鲸"));
});
check("短文本整条给，不加省略号", () => {
  assert.strictEqual(kw.snippet("今天看了蓝鲸", "蓝鲸"), "今天看了蓝鲸");
});

console.log("-- 片段：多词（修的病根）");
check("多词相邻：一个片段盖住两个词（旧算法会退化成开头）", () => {
  const t = "开头" + pad(200) + "上周去水族馆聊到蓝鲸的饲养方式" + pad(200);
  const s = kw.snippet(t, "蓝鲸 饲养 水族馆");
  assert.ok(s.includes("水族馆") && s.includes("蓝鲸") && s.includes("饲养"), s);
  assert.ok(!s.includes("开头"));
});
check("多词相距远：两段都给，按原文顺序，用「……」连", () => {
  const t = "前面" + pad(10) + "蓝鲸" + pad(300) + "中间" + pad(300) + "饲养" + pad(10);
  const s = kw.snippet(t, "蓝鲸 饲养");
  assert.ok(s.includes("蓝鲸") && s.includes("饲养"), s);
  assert.ok(s.includes("……"), s);
  assert.ok(s.indexOf("蓝鲸") < s.indexOf("饲养"));
});
check("三个词：两个相邻一个很远，最多两段", () => {
  const t = pad(50) + "蓝鲸饲养" + pad(300) + "水族馆" + pad(50);
  const s = kw.snippet(t, "蓝鲸 饲养 水族馆");
  assert.ok(s.includes("蓝鲸饲养") && s.includes("水族馆"));
  assert.strictEqual(s.split("……").length, 2);
});
check("两个窗口会重叠就合并成一段", () => {
  const t = pad(100) + "蓝鲸" + pad(80) + "饲养" + pad(100);
  const s = kw.snippet(t, "蓝鲸 饲养");
  assert.ok(!s.includes("……"), s);
  assert.ok(s.includes("蓝鲸") && s.includes("饲养"));
});
check("整句连写命中优先于分散命中", () => {
  const t = "蓝鲸" + pad(300) + "蓝鲸饲养" + pad(300) + "饲养";
  const s = kw.snippet(t, "蓝鲸 饲养");
  assert.ok(s.includes("蓝鲸饲养"), s);
});

console.log("-- 片段：描述句 / 无命中 / 边界");
check("描述型长句：原词锚不上，退到 grams 找到相关位置", () => {
  const t = pad(200) + "他说蓝鲸的饲养其实很难" + pad(200);
  const s = kw.snippet(t, "我记得上次聊过蓝鲸饲养的事");
  assert.ok(s.includes("蓝鲸"), s);
  assert.ok(!s.startsWith("啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊"), s);
});
check("一个词面都锚不上：开头 62 字 + 省略号", () => {
  const t = "开" + pad(200);
  const s = kw.snippet(t, "完全不相干的词");
  assert.strictEqual(s, t.slice(0, 62) + "…");
});
check("没有命中且文本很短：原样", () => {
  assert.strictEqual(kw.snippet("你好呀", "zzz"), "你好呀");
});
check("空文本/空查询不炸", () => {
  assert.strictEqual(kw.snippet("", "a"), "");
  assert.strictEqual(kw.snippet("abc", ""), "abc");
  assert.strictEqual(kw.snippet(null, null), "");
});
check("含虚词的词：我的猫 能命中（grams 会丢，原词不丢）", () => {
  const t = pad(100) + "我的猫在睡觉" + pad(100);
  assert.ok(kw.snippet(t, "我的猫").includes("我的猫在睡觉"));
});
check("大小写不敏感，换行被压成空格", () => {
  const s = kw.snippet("Hello\n\nWORLD blue\nwhale", "world WHALE");
  assert.ok(s.includes("WORLD") && s.includes("whale"));
  assert.ok(!/\n/.test(s));
});
check("超长文本（8 万字）不卡", () => {
  const t = ("的" + pad(30)).repeat(2600);
  const t0 = Date.now();
  kw.snippet(t, "的 啊");
  assert.ok(Date.now() - t0 < 500, "耗时 " + (Date.now() - t0) + "ms");
});
check("词数组直接传（笔记用）", () => {
  const s = kw.snippet(pad(80) + "蓝鲸" + pad(80), ["蓝鲸"], { head: 30 });
  assert.ok(s.includes("蓝鲸"));
});
check("head 可调（日记 26 / 笔记 30）", () => {
  assert.strictEqual(kw.snippet("a".repeat(100), "zzz", { head: 26 }), "a".repeat(26) + "…");
});

console.log("-- 后台材料截断 clipAround");
check("不超上限：原样（保留换行）", () => {
  assert.strictEqual(kw.clipAround("a\nb", "a", 6000), "a\nb");
});
check("超上限：以最优窗口为中心取 cap 字", () => {
  const t = pad(5000) + "蓝鲸饲养" + pad(5000);
  const c = kw.clipAround(t, "蓝鲸 饲养", 1000);
  assert.ok(c.includes("蓝鲸饲养"));
  assert.ok(c.startsWith("…") && c.endsWith("…"));
  assert.strictEqual(c.length, 1002);
});
check("超上限且无命中：取开头", () => {
  const t = "头" + pad(7000);
  const c = kw.clipAround(t, "没有", 6000);
  assert.ok(c.startsWith("头") && c.endsWith("…") && c.length === 6001);
});
check("命中在末尾：窗口贴着尾部，不越界", () => {
  const t = pad(7000) + "蓝鲸";
  const c = kw.clipAround(t, "蓝鲸", 6000);
  assert.ok(c.endsWith("蓝鲸") && c.length === 6001);
});

check("cap 很小（最小允许 100）：命中词仍在截取范围里，长度不超 cap+2", () => {
  const t = pad(400) + "蓝鲸的饲养方式很特别" + pad(400);
  for (const cap of [100, 120, 200, 500]) {
    const c = kw.clipAround(t, "蓝鲸 饲养", cap);
    assert.ok(c.includes("蓝鲸") && c.includes("饲养"), "cap=" + cap + " 命中词被挤出：" + c.length);
    assert.ok(c.length <= cap + 2, "cap=" + cap + " 超长 " + c.length);
  }
});

console.log("-- 排序腿 makeScorer");
const R = (q, text) => kw.makeScorer(q)(text.toLowerCase());
check("单词：与旧公式 min(1,n/3) 完全一致", () => {
  assert.strictEqual(R("蓝鲸", "蓝鲸"), 1 / 3);
  assert.strictEqual(R("蓝鲸", "蓝鲸 蓝鲸 蓝鲸 蓝鲸"), 1);
  assert.strictEqual(R("蓝鲸", "没有"), 0);
  assert.strictEqual(R("a", "aaa"), 1);
});
check("多词分开写：以前是 0 分，现在有分", () => {
  assert.ok(R("蓝鲸 饲养", "蓝鲸怎么饲养") > 0.5);
  assert.ok(R("蓝鲸 饲养", "蓝鲸 …… 饲养") > 0.5);
});
check("覆盖词数优先：两个词各一次 > 只有一个词出现三次", () => {
  assert.ok(R("蓝鲸 饲养", "蓝鲸和饲养") > R("蓝鲸 饲养", "蓝鲸 蓝鲸 蓝鲸"));
});
check("只有一个词的消息仍有分（排在后面）", () => {
  const one = R("蓝鲸 饲养", "蓝鲸");
  assert.ok(one > 0 && one < R("蓝鲸 饲养", "蓝鲸饲养"));
});
check("整句连写的旧行为是下限：不会比以前低", () => {
  for (const [q, t] of [["蓝鲸 饲养", "蓝鲸 饲养"], ["蓝鲸 饲养", "蓝鲸 饲养 蓝鲸 饲养 蓝鲸 饲养"]]) {
    const old = Math.min(1, (t.split(q).length - 1) / 3);
    assert.ok(R(q, t) >= old, q + "|" + t);
  }
});
check("分数始终在 0..1", () => {
  for (const t of ["", "蓝鲸".repeat(50) + "饲养".repeat(50), "无关"]) {
    const s = R("蓝鲸 饲养 水族馆", t);
    assert.ok(s >= 0 && s <= 1, String(s));
  }
});
check("多个词都没出现：0", () => {
  assert.strictEqual(R("蓝鲸 饲养", "完全无关"), 0);
});
check("空查询：0", () => {
  assert.strictEqual(R("", "abc"), 0);
});

console.log("\n" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
