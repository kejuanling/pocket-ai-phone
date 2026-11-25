"use strict";

// tag-parser.js — AI 回复内轻量记号的解析入库与剥离：
//   extractAndStore：各收尾路径各调一次，识别 <memory>/<star>/<paper> 并执行入库副作用
//                    （记忆池/标星/留纸；<pin> 已于 1021 停用，仅剥离不入库），返回剥净全部标签的正文供下发/落盘；
//   stripTags      ：纯剥离，流式过滤与时间线内容匹配复用。

const memoryEngine = require("../memory/memory-engine");

const MEMORY_TAG_RE = /<\s*memory\b([^>]*)>([\s\S]*?)<\s*\/memory\s*>/gi;   // 2026-10-28：第 1 组是属性（新写法 <memory kind=\"fact\">），第 2 组是正文
// 留纸记号（2026-10-17 简化）：只认标准写法 <paper title="标题">内容</paper>。
//   只有包住的内容进纸；气泡里这段正文照常显示，只去掉标记本身。一条回复可以包多段，各存各的。
//   标题一样（去首尾空白后精确相同）就追加到那张纸，不一样就新增。覆盖请用 notebook 工具。
//   没写标题：照存为一张无标题的新纸（不丢内容，也不会被追加）。自闭合 <paper/> 或包空内容：不存。

// 代码块保护 + 标签剥离（2026-10-28 第6项收拢）：掩码与注册表现在只在 workspace/phone-tags.js 一份（前端同用）——
//   围栏 ```/~~~、HTML code/pre、表格、行内反引号里的标签一律不解析不剥离；剥离清单 = 注册表里 srv 非 0 的标签。
//   （2026-10-25 事故加固的原文：讲解标签时写在反引号/代码块里的真实形态标签被照单全收，产出脏纸、脏日记、脏待审、脏标星。）
const PHTags = require("../workspace/phone-tags.js");
function codeMask(text) { return PHTags.mask(text); }
function stripTags(text) { return PHTags.strip(text, "srv"); }

/* [位置:lib/tag-parser.js·stripForDisplay] [展示口径纯文本（服务端）] [11-15：建搜索索引只用 normalizeContentToText，<suggest>/<title> 这类标签内容会进索引和摘要，与「最新一句」展示口径分叉；把 chat.js·sessionLastText 的清洗链原样收到这里一份，列表预览与搜索索引共用，避免两处各写一份再漂移。语义同展示：title/status/think/DIARY 整段丢弃，suggest 由 stripTags（srv:'drop'）丢弃，card_reply 保留人话、文件/卡片/图片落占位] [注释时间 2026-11-15] */
function stripForDisplay(text) {
  return stripTags(String(text == null ? "" : text))
    .replace(/<current_time>[\s\S]*?<\/current_time>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/\[DIARY\][\s\S]*?\[\/DIARY\]/g, "")
    .replace(/<\s*(?:title|status)\b[^>]*>[\s\S]*?<\s*\/(?:title|status)\s*>/gi, "")
    .replace(/<card_reply\b[^>]*\/>|<card_reply\b[^>]*>([\s\S]*?)<\/card_reply\s*>/gi, function (all, inner) {
      if (inner == null) return "";
      return /^\s*[\[{]/.test(inner) ? "" : inner;
    })
    .replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, " [文件] ")
    .replace(/<card\b[^>]*>[\s\S]*?<\/card>/gi, " [卡片] ")
    .replace(/<voice>([\s\S]*?)<\/voice>/gi, "$1")
    .replace(/<\/?[a-zA-Z_][\w-]*\b[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " [图片] ")
    .replace(/[*_`#>~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 宽松解析 {key:value,...}：值可不带引号，值里含逗号也能正确处理；
// 按 ",key:" 切分（只认已知键），兼容 <memory>{kind:...,...} 的宽松写法
function parseKeyValueBlock(raw, keys) {
  const trimmed = String(raw || "").trim().replace(/^\{|\}$/g, "");
  const re = new RegExp(",\\s*(?=(?:" + keys.join("|") + ")\\s*:)", "i");
  const parts = trimmed.split(re);
  const out = {};
  for (const part of parts) {
    const m = part.match(/^\s*(title|content|type|category|reason|pinned|kind)\s*[:=]\s*(.*)$/i)   /* 2026-10-28：补 kind——原来正则里没有 kind，<memory>{kind:\"rule\"} 的 kind 一直被丢掉（kv.kind 恒 undefined），记忆分类全靠门卫补 */;
    if (!m) continue;
    const key = m[1].toLowerCase();
    out[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// 写一份：同标题的纸已存在就追加，否则新增；追加失败也不丢内容（退回新增）。
function writePaper(papers, sessionId, title, body) {
  const hit = title ? papers.findByTitle(title) : null;
  if (hit) {
    const er = papers.editPaper({ id: hit.id, content: body, mode: "append" });
    if (er && er.ok) { console.log("[tag-parser] <paper> 已追加: id=" + er.id, "标题=" + title); return er; }
    console.warn("[tag-parser] <paper> 追加失败，改为新增保住内容:", (er && er.error) || "unknown");
  }
  const r = papers.savePaper({ sessionId, content: body, title });
  if (r && r.ok) console.log("[tag-parser] <paper> 已留纸: id=" + r.id, title ? ("标题=" + title) : "（无标题）");
  else console.warn("[tag-parser] <paper> 留纸失败:", (r && r.error) || "unknown");
  return r;
}

// 取开标记属性里的 title（双引号/单引号/无引号）；没写返回 ""。
function parsePaperTitle(attrStr) {
  const m = String(attrStr || "").match(/\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/i);
  return m ? String(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])).trim() : "";
}

async function extractAndStore(text, ctx) {
  if (!text) return text;

  const promises = [];
  const fails = [];                // 新写法标签没成功的说明（见 lib/tag-actions.js），收尾放进 ctx.notes 由调用方在回复落盘后追加 developer 消息
  const tagActions = require("./tag-actions");
  const cm = codeMask(text);      // 2026-10-25 代码块保护：存在性探测与标签定位都在掩码文本上做，取出的内容 restore 后再用
  const scan = cm.text;
  /* [位置:lib/tag-parser.js·isSubSession] [子会话只留 title/status/claim，不执行写副作用] [2026-11-01 审查：preset 子会话改走普通聊天流水线后，AI 报告正文里提到 <memory>/<star>/<paper>/<album>/<active>/<todo> 等标签会真的写记忆、标星、留纸、入相册、订阅、转调 8771 工具（报告常引用标签示例），子会话只是干活的不该动用户的数据；<title>/<status> 必须留（会话名/进展），<claim> 必须留（并行改代码占坑）] [注释时间 2026-11-01] */
  const isSub = /^s_sub_/.test(String((ctx && ctx.sessionId) || ''));

  // --- <title>/<status>（2026-10-27需求）：AI 随时更新本会话的名字与进展状态（进行中/待回复/待反馈/已完成）。
  //     原来 <title> 只有前端在新会话第一轮读一次；改成各收尾路径（聊天/流式/唤醒）都在这里解析，页面不开也生效。
  //     只存不剥（标签保留在时间线原文，前端自己隐藏，与 <title> 旧口径一致）；规则见 lib/session-meta.js。 ---
  if (ctx && ctx.sessionId && /<\s*(?:title|status)\b/i.test(scan)) {
    try {
      const r = require("./session-meta").applyFromText(ctx.sessionId, scan);
      if (r.title && r.title.ok && r.title.reason !== "same") console.log("[tag-parser] <title> 会话改名:", ctx.sessionId);
      if (r.title && !r.title.ok && r.title.reason === "manual") console.log("[tag-parser] <title> 跳过：会话名被手动改过", ctx.sessionId);
      if (r.status && r.status.ok && r.status.reason !== "same") console.log("[tag-parser] <status> 会话状态:", ctx.sessionId);
    } catch (err) {
      console.warn("[tag-parser] <title>/<status> 处理失败:", err.message);
    }
  }

  // --- <claim>/<claim clear>（10-31）：会话开工占坑/完成清坑（多会话并行改代码防撞车）。
  //     <claim>server.js、phone-pages.js</claim> 登记本会话要改的文件（只写文件名，动作不写；同会话重复写=覆盖）；
  //     <claim clear> 或会话状态「已完成」（session-meta 顺带清）退坑。后登记的与在册撞文件 →
  //     data/claim-alerts.json 告警（前端横幅轮询 /admin/claim-alerts）+ WebPush 浏览器通知。
  //     软提醒不拦工具；解析规则见 lib/claim-locks.js。与 <title>/<status> 同款：只存不剥，时间线保留原文。 ---
  if (ctx && ctx.sessionId && /<\s*claim\b/i.test(scan)) {
    try {
      const cl = require("./claim-locks");
      const pairRe = /<\s*claim\b([^>]*)>([\s\S]*?)<\s*\/claim\s*>/gi;
      let pm, last = null, doClear = false;
      while ((pm = pairRe.exec(scan))) {
        const body = cm.restore(pm[2] || '').trim();
        if (/^clear$/i.test(body) || /\bclear\b/i.test(pm[1])) { doClear = true; last = null; }
        else { doClear = false; last = body; }
      }
      const rest = scan.replace(pairRe, '');
      const selfRe = /<\s*claim\b([^>]*?)\/\s*>/gi;
      let sm;
      while ((sm = selfRe.exec(rest))) { if (/\bclear\b/i.test(sm[1])) { doClear = true; last = null; } }
      if (doClear) { const r = cl.clear(ctx.sessionId); console.log("[tag-parser] <claim> 清占用:", ctx.sessionId, r.reason || ""); }
      else if (last != null) {
        const r = cl.claim(ctx.sessionId, last);
        if (r.ok) console.log("[tag-parser] <claim> 登记 " + r.count + " 个文件" + (r.conflicts.length ? "，冲突 " + r.conflicts.length + " 项（已告警）" : "") + ":", ctx.sessionId);
        else console.log("[tag-parser] <claim> 没解析出文件清单，未登记:", ctx.sessionId);
      }
    } catch (err) { console.warn("[tag-parser] <claim> 处理失败:", err.message); }
  }

  // --- <paper> 留纸轻量辅助（2026-09-12，2026-10-17 收敛）：AI 写故事/梦/随手创作 → 落纸（只写、不注入上下文）。
  //     只认成对写法 <paper title="标题">内容</paper>：只有包住的内容进纸（剥掉内部其它标签），
  //     一条回复可包多段，同标题追加、不同标题新增；自闭合/空内容不存。
  //     留纸全局共享（1009-10 起不按会话隔离）；ctx.sessionId 不影响落点。 ---
  if (!isSub && /<\s*paper\b/i.test(scan)) {
    promises.push(
      Promise.resolve().then(async function () {
        const papers = require("./papers");
        const sessionId = ctx && ctx.sessionId;
        const pairRe = /<\s*paper\b([^>]*)>([\s\S]*?)<\s*\/paper\s*>/gi;
        let pm, last = null, n = 0;
        while ((pm = pairRe.exec(scan))) {
          if (/\/\s*$/.test(pm[1])) continue;   // 自闭合后面碰巧有别的 </paper>：不当成对
          const inner = stripTags(cm.restore(pm[2])).trim();
          if (!inner) continue;
          n++;
          last = writePaper(papers, sessionId, parsePaperTitle(pm[1]), inner);
        }
        if (!n) console.log("[tag-parser] <paper> 没有包住内容的标准写法，未留纸");
        return last;
      }).catch(function (err) {
        console.warn("[tag-parser] <paper> 留纸异常:", err.message);
      })
    );
  }

  // 1021：<pin> 入库已移除（标签不再使用）；stripTags 仍剥离 <pin>，模型惯性写出时静默消失，不显示也不入库。
  // <memory> → V2 待审池（2026-10-02 修复+改道）：0928-42 起本分支「直写 V2 主集合」，但 provenance.method
  //   误写 "memory_tag" 不在 PROVENANCE_METHODS 白名单（正确值 tag_inline，tests/admission 已锁定）→
  //   每次入库在 _buildEntry 抛错且失败路径静默无日志 → memory_v2.json 里 origin=memory_tag 恒为 0。
  //   现改为：复用 admission.executorMain 走 review 队列（人工批准才落主集合，与 V2「先审后入」一致），
  //   主集合+待审队列双查重，失败/跳过均有日志。（1002-14：quote 类已删，speaker 兜底逻辑随之移除）
  const V2_KINDS = ["fact", "rule", "event"];
  function getReviewExecutor() {
    // 优先复用 admission 单例 executorMain（唯一写手，避免多实例并发覆盖队列）；未初始化时自建兜底
    try {
      const adm = require("../memory/memory-admission").getAdmission();
      if (adm && adm.executorMain) return adm.executorMain;
    } catch (e) { /* 自建兜底 */ }
    const { createStore } = require("../memory/memory-v2");
    const { createStateExecutor } = require("../context/state-executor");
    return createStateExecutor({ store: createStore({ config: {} }) });
  }
  function memoryTagToV2(body, category, sessionId, vibe, triggers) {
    const { createStore } = require("../memory/memory-v2");
    const store = createStore({ config: {} });
    const text = String(body || "").trim();
    if (!text) return { skipped: true };
    // 去重1：主集合 active 同正文已存在则跳过（对齐旧池自动去重语义）
    const dup = (store.list({ status: "active" }) || []).some(function (e) { return String(e.text || "").trim() === text; });
    if (dup) return { skipped: true };
    // 分类映射：旧类名 → kind；V2 枚举（fact/rule）直用（1002-14：quote/milestone 已删）
    // 只认 fact/rule/event 三枚举；空或不合法一律留空（null）进待审，由门卫 judge 补 suggested_kind / 人工裁决
    let kind = category ? (V2_KINDS.includes(category) ? category : null) : null;
    // 去重2：待审队列 pending_review 同正文（防 AI 每轮回复重复写同一标签堆队列）
    const executor = getReviewExecutor();
    let dupQueue = false;
    try {
      dupQueue = (executor.listQueue("pending_review") || []).some(function (r) { return r.draft && String(r.draft.text || "").trim() === text; });
    } catch (e) { dupQueue = false; }
    if (dupQueue) return { skipped: true };
    const draft = {
      text: text,
      kind: kind,
      origin: "memory_tag",
      provenance: { method: "tag_inline", session_id: sessionId || null },
    };
    if (triggers) { const _tr = String(triggers).split(/[,，、;；]+/).map(function (x) { return x.trim().slice(0, 20); }).filter(Boolean).slice(0, 3); if (_tr.length) draft.triggers = _tr; }   // 11-04：AI 顺手写的关键词
    if (vibe) draft.vibe = String(vibe).trim().slice(0, 60);   // 11-04 产品确定：vibe（气味/情感）只由 AI 存记忆时自己写，记忆池模型不写
    const r = executor.review(draft, "AI 标签（<memory>）自动进审，待人工裁决", { details: [{ source: "memory_tag", category: category || null }] });
    return r && r.ok ? { added: 1, queue_id: r.queue_id } : { skipped: false, error: r && r.error };
  }

  // --- <memory> 轻量辅助：AI 顺手写的重要记忆 → V2 待审池（自动去重；人工批准才落库） ---
  // kind 直接写三枚举（fact/rule/event），如
  //   <memory>{kind:"rule"}她情绪低落时先抱住她，别急着讲道理</memory>
  //   <memory>{kind:"event"}用户（9-12）："因为是你。"</memory>
  // kind 不写、写错、写旧分类名 → 一律视为没写（留空进待审，由门卫 judge 补 suggested_kind/人工裁决）
  const memoryMatches = isSub ? [] : Array.from(scan.matchAll(MEMORY_TAG_RE));
  for (const match of memoryMatches) {
    const raw = cm.restore(match[2] || "").trim();
    if (!raw) continue;
    let body = raw, category = "";
    const memAttr = tagActions.parseAttrs(cm.restore(match[1] || ""));   // 新写法 <memory kind="fact">正文</memory>；旧的 {kind:…} 头在正文里，下面照旧解析并覆盖
    if (memAttr.kind) category = String(memAttr.kind).trim();
    const metaMatch = raw.match(/^\s*\{[\s\S]*?\}\s*([\s\S]*)$/);
    if (metaMatch && /^\s*\{/.test(raw)) {
      const head = raw.slice(0, raw.indexOf("}") + 1);
      // importance 已删：残留值不解析静默丢弃；pinned 已删：V2 无标签置顶语义，写了一律忽略
      const kv = parseKeyValueBlock(head, ["category", "type", "kind"]);
      if (kv.kind) category = String(kv.kind).trim();
      else if (kv.category) category = String(kv.category).trim();
      else if (kv.type) category = String(kv.type).trim();
      body = metaMatch[1].trim();
    }
    if (!body) continue;
    promises.push(
      Promise.resolve().then(function () {
        return memoryTagToV2(body, category, ctx && ctx.sessionId, memAttr.vibe, memAttr.triggers);
      }).then(function (r) {
        if (r && r.added) {
          console.log("[tag-parser] <memory> 已进待审池:", body.slice(0, 50), r.queue_id || "");
        } else if (r && r.skipped) {
          console.log("[tag-parser] <memory> 重复跳过:", body.slice(0, 50));
        } else {
          console.warn("[tag-parser] <memory> 进待审失败:", (r && r.error) || "unknown");
        }
        return r;
      }).catch(function (err) {
        console.warn("[tag-parser] <memory> 入库失败:", err.message);
      })
    );
  }

  // --- <star> 轻量辅助：AI 觉得这条回复重要 → 自标星（原文保留在上下文、不参与压缩，不入记忆池；
  //     与用户手动标星共用同一套 marks 存储；11-09 起 AI 的 context_star 工具已删，标别条原文的功能下线）。
  //     1007-17 标星改 msgid：主对话路径（routes/chat.js 流式/非流式）落盘前能拿到前端预生成的
  //     reply_msg_id，ctx.msgId 传入后按消息 id 存，编辑后不漂移。
  //     MCP 分支（server.js）与唤醒路径（wake-scheduler）拿不到 id，ctx.msgId 为空 → 回落内容键。
  //     已知缺陷（待修）：唤醒路径的 extractAndStore 收到的是剥过 <wake> 的文本，落盘却是含 <wake>
  //     的原文，两个 contentKey 不一致，前端双查（msgid + 含 wake 的内容键）都不命中
  //     → 唤醒回复里若同时带 <wake> 和 <star>，该自标星不生效。 ---
  // 2026-10-28：只有「不带 msg_ids」的 <star/> 才是标本条回复；带 msg_ids 的是标别条原文——11-09 起该功能下线（context 工具只剩 search/get），带 msg_ids 的标签不再有任何动作，这里仍要排除它，免得被当成标本条回复
  //   已知缺陷修复：唤醒路径收到的是剥过 <wake> 的文本，落盘却是含 <wake> 的原文，contentKey 不一致标星不生效——
  //   现由调用方传 ctx.starContent（= 实际落盘的那份文本）当键与内容
  const selfStar = (function () { const re = /<\s*star\b([^>]*)>/gi; let m; while ((m = re.exec(scan))) { if (!/\bmsg_ids\s*=/i.test(m[1])) return true; } return false; })();
  if (!isSub && selfStar) {
    promises.push(
      Promise.resolve().then(function () {
        const cr = require("../context/context-replacements");
        const _mid = (ctx && ctx.msgId) ? String(ctx.msgId).trim() : "";
        const _content = (ctx && typeof ctx.starContent === "string" && ctx.starContent) ? ctx.starContent : text;
        const key = _mid || cr.contentKey({ role: "assistant", content: _content });
        const r = cr.setMark(key, true, { content: _content, role: "assistant", msg_time: new Date().toISOString() });
        if (r && r.ok) console.log("[tag-parser] <star> 已标星本条回复 key=", key);
        return r;
      }).catch(function (err) {
        console.warn("[tag-parser] <star> 标星失败:", err.message);
      })
    );
  }

  // --- <album> 相册标签（10-23）：AI 想把她发的某张图存进相册，写 <album id="img-xxxx-xxxx">批注（可省）</album>
  //     或自闭合 <album id="img-xxxx-xxxx"/>；id 就是上下文里每张图前面的 [图片 id:xxx]。标签对她不显示，批注留在相册里。
  //     同一张图只入册一次；图不存在/id 不对只记日志，不影响回复。（工具 album 走同一套 lib/album.js） ---
  if (!isSub && /<\s*album\b/i.test(scan)) {
    promises.push(
      Promise.resolve().then(function () {
        const al = require("./album").get();
        if (!al) return null;
        // 1025 兼容：idOf 原来只认 id 属性，但 AI 会把 album 工具的参数格式记串成标签
        // （实测写了 <album action="add" img="img-xxx" note="…"/>，工具 schema 里参数就叫 action/img/note）
        // → 提取不到 id 全部入册失败。现在 id 属性取不到回退 img 属性；自闭合写法的批注也从 note 属性收（此前直接丢掉）。
        const grab = function (attr, name) { const m = String(attr || "").match(new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>/]+))", "i")); return m ? String(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])).trim() : ""; };
        const idOf = function (attr) { return grab(attr, "id") || grab(attr, "img"); };
        const one = function (attr, note) {
          if (/^al_/.test(idOf(attr))) return null;   // 相册条目 id（al_ 开头）是改批注，由 tag-actions 转调 album 工具
          const r = al.add({ img: idOf(attr), by: "ai", source: "chat", note: stripTags(cm.restore(note || grab(attr, "note") || "")).trim(), session_id: ctx && ctx.sessionId });
          if (r && r.ok) console.log("[tag-parser] <album> " + (r.existed ? "已在相册" : "已入册") + ": " + (r.item && r.item.img_id));
          else { console.warn("[tag-parser] <album> 没入册:", (r && r.error) || "unknown"); fails.push({ tag: "album", error: String((r && r.error) || "没入册").slice(0, 120) }); }
          return r;
        };
        const pairRe = /<\s*album\b([^>]*)>([\s\S]*?)<\s*\/album\s*>/gi;
        let pm, rest = scan;
        while ((pm = pairRe.exec(scan))) { if (/\/\s*$/.test(pm[1])) continue; one(pm[1], pm[2]); }
        rest = scan.replace(pairRe, "");
        const selfRe = /<\s*album\b([^>]*?)\/\s*>/gi;
        let sm; while ((sm = selfRe.exec(rest))) one(sm[1], "");
        return null;
      }).catch(function (err) { console.warn("[tag-parser] <album> 入册异常:", err.message); })
    );
  }

  // --- 新写法标签（2026-10-28 第6项）：lovediary(letter)/notebook/todo/mood/period/reply/album(改批注)/wake(time…)（star(msg_ids) 11-09 下线）
  //     属性名 = 工具参数名，转调工具集同名工具，口径只有一份；按出现顺序依次执行，失败收集说明 ---
  const actTasks = isSub ? [] : tagActions.collect(cm, ctx);
  if (actTasks.length) {
    promises.push((async function () {
      for (const t of actTasks) {
        const r = await t.run();
        if (r.ok) console.log("[tag-parser] <" + r.tag + "> 已执行");
        else { console.warn("[tag-parser] <" + r.tag + "> 没写成:", r.error); fails.push(r); }
      }
    })().catch(function (err) { console.warn("[tag-parser] 新标签执行异常:", err.message); }));
  }

  await Promise.all(promises);
  if (fails.length && ctx && Array.isArray(ctx.notes)) ctx.notes.push(tagActions.failureNote(fails));
  return stripTags(text).trim();
}

module.exports = { extractAndStore, stripTags, stripForDisplay, parsePaperTitle, codeMask };
