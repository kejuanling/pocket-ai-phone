"use strict";
/* 第6项步骤1a：workspace/phone-tags.js 的掩码与剥离单元测试（服务端与前端共用同一份，这里用 node 跑）
 * 跑法（项目目录下）：node tests/tag-parser/test_tag_mask.js */
const T = require("../../workspace/phone-tags.js");
let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }
const S = (t) => T.strip(t, "srv"), F = (t) => T.strip(t, "fe");

// ---- 不解析：这些写法里的标签原样保留（两边都是）----
const FENCE = "讲解一下：\n```\n<todo remind_at=\"2026-10-29 09:00\">买牛奶</todo>\n```\n完了";
ok(S(FENCE) === FENCE && F(FENCE) === FENCE, "``` 围栏里的标签不剥");
const TILDE = "看：\n~~~\n<lovediary>日记</lovediary>\n~~~\n";
ok(S(TILDE) === TILDE, "~~~ 围栏里的标签不剥");
const OPEN_FENCE = "先说\n```\n<memory>没写完的围栏";
ok(S(OPEN_FENCE) === OPEN_FENCE, "没闭合的围栏吞到结尾，里面不剥");
const INLINE = "写法是 `<todo>买牛奶</todo>` 这样";
ok(S(INLINE) === INLINE && F(INLINE) === INLINE, "行内反引号里的标签不剥");
const TABLE = "| 标签 | 例子 |\n|---|---|\n| todo | <todo>买牛奶</todo> |\n| mood | <mood>开心</mood> |\n\n后面正文";
ok(S(TABLE) === TABLE && F(TABLE) === F(TABLE) && F(TABLE).indexOf("<todo>") >= 0, "表格里的标签不剥");
const TABLE2 = "| a | b |\n| :--- | ---: |\n| <star/> | x |";
ok(S(TABLE2) === TABLE2, "带对齐冒号的分隔行也算表格");
const PRE = "<pre>\n<notebook title=\"x\">y</notebook>\n</pre> 和 <code><wake time=\"30\"/></code>";
ok(S(PRE) === PRE, "HTML pre/code 里的标签不剥");
// 单行以 | 开头但不成表格：不掩，照常剥
const NOT_TABLE = "| 只有一行 | <todo>买牛奶</todo> |";
ok(S(NOT_TABLE) === "| 只有一行 |  |", "只有一行、没有分隔行的不算表格，标签照剥");
// 缩进代码块不算：照常剥
ok(S("    <todo>买牛奶</todo>").trim() === "", "缩进式代码块不掩码（误伤面太大）");

// ---- 剥离口径 ----
ok(S("好的<todo remind_at=\"2026-10-29 09:00\">买牛奶</todo>。") === "好的。", "新标签 todo 服务端整段去掉");
ok(S("a<mood ids=\"3,5\" date=\"2026-10-28\"/>b") === "ab", "自闭合新标签去掉");
ok(S("a<lovediary kind=\"letter\" title=\"t\">正文\n多行</lovediary>b") === "ab", "lovediary 成对多行整段去掉");
ok(S("x<notebook id=\"70\" mode=\"append\">补</notebook>y") === "xy", "notebook 整段去掉");
ok(S("x<paper title=\"t\">正文</paper>y") === "x正文y", "旧 paper 留内容去标记");
ok(S("x<star/>y<star msg_ids=\"m1,m2\"/>z") === "xyz", "star 自闭合/带属性都去掉");
ok(S("x<wake time=\"07:30\" repeat=\"daily\" label=\"叫她\"/>y") === "xy", "新 wake 自闭合去掉");
ok(S("x<wake>30 keep=true</wake>y") === "xy", "旧 wake 成对去掉");
ok(S("x<active her_murmurs=\"yes\" period=\"no\"/>y") === "xy", "新 active 属性写法去掉");
ok(S("<push>降温了</push>") === "<push>降温了</push>" && S("<noaction>睡了</noaction>") === "<noaction>睡了</noaction>", "push/noaction 服务端不剥（时间线流水账原样）");
ok(F("<push>降温了</push>") === "降温了" && F("[push]降温了[/push]") === "降温了", "前端 push 去标记留内容（新旧写法）");
ok(F("<noaction>睡了</noaction>") === "" , "前端 noaction 整段去掉");
ok(F("<title>会话名</title>正文<status>待反馈</status>") === "正文", "前端 title/status 去掉");
ok(F("正文<title>写了一半") === "正文", "前端 title 开标签没闭合：到结尾去掉");
ok(S("<title>会话名</title>正文") === "<title>会话名</title>正文", "服务端 title/status 保留原文");
ok(F("a[DIARY]日记[/DIARY]b") === "ab" && F("a[DIARY]没闭合") === "a", "前端 [DIARY] 整段去掉，含没闭合");
ok(S("a<compacted>完成</compacted>b") === "ab" && F("a<compacted>完成</compacted>b") === "ab", "compacted 两边同口径去掉");
ok(S("孤立的 </todo> 和 <memory> 尾巴") === "孤立的  和  尾巴", "孤立的开/收尾标记去掉");
ok(S("结尾写一半<todo remind_") === "结尾写一半", "结尾写了一半的标记去掉");
ok(S("<results>不是 result</results>") === "<results>不是 result</results>", "名字相近的不误伤（\\b）");

// ---- 掩码对象 ----
const cm = T.mask("a `b` c\n```\nd\n```\n| x |\n|---|\n");
ok(cm.text.indexOf("`") < 0 && cm.restore(cm.text) === "a `b` c\n```\nd\n```\n| x |\n|---|\n", "mask/restore 往返无损");
const t2 = "ab `c<` d";
const m2 = T.mask(t2);
ok(m2.toRaw(m2.text.indexOf(" d")) === t2.indexOf(" d"), "toRaw：掩码下标换回原文下标");
console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
