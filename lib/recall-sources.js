/* [位置:lib/recall-sources.js] [「万物可召回」：召回源接口。记忆池 event 走原来的 buildRelevant；这里补两类感官/画面来源——此刻记录（AI 写 <trace> 的整句内容，lib/trace-notes.js）、相册批注（AI 存照片时写的批注）] [词面命中靠「短词」交集（2-4 字的片段，常见词/虚词过滤，库里太常见的片段不算）；排序=最长命中词优先；每轮最多 1 条（perTurn）；同会话当天刚写的不召回（上下文里已有）；
   11-07 已确定：trace 不再拆字段、不再有气味名——整句当 keyText 切词命中（同相册批注），召回文案带 msg_id（AI 拿 id 用 context 工具回看原文；msg_id 唯一，不带会话不带用法指引）。2 字片段的库频附加槛从 d<=2 放宽到 d<=3：整句存档后实词（如「蜂蜜」）会在多条记录里出现，旧槛会误伤（权衡记在 q5：高频实词仍可能被拦，观察再调）
   11-08 已确定：天上限（dailyMax=3）整个删除——不限制次数，各会话天然无上限（days 账本作废，state 只留 last）；同一条冷却 24→48 小时且按会话隔离——在哪个会话被想起过，只在那个会话 48h 内不再想起，别的会话不受影响（state.last 键 = sessionId + ":" + id，无会话调用落 "_" 桶）；trace 召回文案去末尾括号句（pinned「你心里的地方」末段已有同义句）；相册文案去「接不接，你定」、留 view_image 指引] [注释时间 2026-11-08]
   命中的条目由 context-v2-runtime 并进 relevantHits：本轮拼进相关记忆块，并像记忆一样浮现进时间线（hidden developer 消息，带 float_id=trace:xxx / album:xxx）；文案本体不带「是记忆不是此刻」类括号句（11-08 已确定删，pinned 已有同义句），接不接由 AI 定
   候选统一形状：{ id:'trace:..'|'album:..', src, keyText（拿来取短词的文本）, text（注入文案）, ts, whole?（整词名）, sessionId } */
"use strict";
const fs = require("fs");
const path = require("path");
const traceNotes = require("./trace-notes");

const ROOT = path.join(__dirname, "..");
const CFG_FILE = path.join(ROOT, "data", "recall_sources_config.json");
const STATE_FILE = path.join(ROOT, "data", "recall_sources_state.json");
const ALBUM_FILE = path.join(ROOT, "data", "album.json");
const DEFAULT_CFG = { enabled: true, trace: true, album: true, perTurn: 1, sameKeyHours: 48 };

const STOP_CH = /[的了是在和与及我你她他它们这那有就也都不吗呢啊吧么哦嗯呀啦吗]/;
const STOP_W = new Set(["今天", "明天", "昨天", "现在", "一下", "一个", "一点", "什么", "怎么", "可以", "觉得", "知道", "时候", "但是", "因为", "所以", "还是", "已经", "没有", "不是", "好像", "真的", "自己", "东西", "事情", "晚上", "早上", "中午", "时间", "出来", "起来", "过来", "回来", "看到", "看见", "一起", "这个", "那个", "已经", "应该", "需要", "感觉"]);

function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return dflt; } }
function writeJson(f, v) { try { const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); } catch (e) { console.warn("[recall-sources] 写失败:", f, e.message); } }
function cfgNow() { return Object.assign({}, DEFAULT_CFG, readJson(CFG_FILE, {})); }
function dateOf(iso) { return /^\d{4}-\d{2}-\d{2}/.test(String(iso || "")) ? String(iso).slice(0, 10) : ""; }

/* 取短词：中文连续段取 2-4 字片段（含虚词的片段、常见词丢掉）；英文数字取 ≥3 的词 */
function grams(text) {
  const out = new Set();
  const s = String(text == null ? "" : text).toLowerCase();
  const runs = s.match(/[一-龥]+|[a-z0-9]+/g) || [];
  for (const r of runs) {
    if (/^[a-z0-9]+$/.test(r)) { if (r.length >= 3) out.add(r); continue; }
    for (let L = 2; L <= 4; L++) for (let i = 0; i + L <= r.length; i++) {
      const g = r.slice(i, i + L);
      if (STOP_CH.test(g) || STOP_W.has(g)) continue;
      out.add(g);
    }
  }
  return out;
}

/* [位置:lib/recall-sources.js·traceRecallText] [trace 召回文案唯一公式] [11-07 痕迹页（routes/trace-notes.js）也要显示同款文案，抽出来共用，防两处漂移；11-08 已确定去末尾括号句——pinned「你心里的地方」末段已有「那是记忆，不是此刻；提不提，你定」，不再重复] [注释时间 2026-11-08] */
function traceRecallText(it) {
  const d = dateOf(it.at);
  const c80 = String(it.content || "").slice(0, 80);
  return "你记得 " + (d ? d + " " : "") + "写过的此刻：「" + c80 + "」" + (it.msg_id ? "。msg_id：" + it.msg_id : "");
}

function candidates(cfg, sessionId) {
  const out = [];
  if (cfg.trace) {
    for (const it of traceNotes.list()) {
      if (it.session_id && sessionId && it.session_id === sessionId && Date.now() - Date.parse(it.at || 0) < 24 * 3600 * 1000) continue;   // 同会话一天内写的不召回（刚写过，没必要「想起」）
      const d = dateOf(it.at);
      const c80 = String(it.content || "").slice(0, 80);
      if (!c80) continue;
      const text = traceRecallText(it);
      out.push({ id: "trace:" + it.id, src: "trace", keyText: c80, whole: null, text, ts: it.at, sessionId: it.session_id || null });
    }
  }
  if (cfg.album) {
    const items = (readJson(ALBUM_FILE, {}) || {}).items || [];
    for (const it of items) {
      if (!it || !it.note) continue;
      if (sessionId && it.session_id === sessionId) continue;   // 本会话里发生的，上下文里已经有
      const note = String(it.note).replace(/\s+/g, " ").trim();
      const d = dateOf(it.added_at);
      const text = "相册里有一张相关的照片（" + (d ? d + "，" : "") + "照片 id：" + (it.img_id || it.id) + "）。你当时的批注：" + note.slice(0, 160) + "（想再看原图可以用 view_image）";
      out.push({ id: "album:" + it.id, src: "album", keyText: note.slice(0, 80), whole: null, text, ts: it.added_at || null, sessionId: it.session_id || null });
    }
  }
  return out;
}

/* 主入口（同步）。opts: { query, sessionId, excludeIds[], now?, commit? }
   返回 { hits:[{id,text,kind:'sense',src,score,created_at,established_at,wordScore,vibeScore}], keyHit } ；commit!==false 时记账（同条冷却时间，按会话隔离：state.last 键 = sessionId + ":" + id，11-08 已确定）。 */
function pick(opts) {
  const cfg = cfgNow();
  if (cfg.enabled === false) return { hits: [] };
  const now = opts.now || Date.now();
  const q = String(opts.query || "").replace(/<current_time>[\s\S]*?<\/current_time>/gi, " ").replace(/<[^>]+>/g, " ").trim();
  if (q.length < 2) return { hits: [] };
  const state = readJson(STATE_FILE, { last: {} });
  const exclude = new Set((opts.excludeIds || []).map(String));
  const all = candidates(cfg, opts.sessionId).filter((c) => !exclude.has(c.id));
  if (!all.length) return { hits: [] };
  const df = new Map();
  const gs = all.map((c) => { const g = grams(c.keyText); for (const x of g) df.set(x, (df.get(x) || 0) + 1); return g; });
  const maxDf = Math.max(4, Math.ceil(all.length * 0.25));
  const qg = grams(q);
  const qlow = q.toLowerCase();
  const scored = [];
  all.forEach((c, i) => {
    let best = 0, bestKey = "";
    if (c.whole && qlow.indexOf(String(c.whole).toLowerCase()) >= 0) { best = 10; bestKey = c.whole; }
    for (const g of gs[i]) {
      if (!qg.has(g)) continue;
      const d = df.get(g) || 1;
      if (d > maxDf) continue;
      const L = g.length;
      if (!(L >= 3 || d <= 3)) continue;   // 11-07：2 字片段附加槛 d<=2 → d<=3（整句存档后实词常跨多条，见头注释）
      const sc = L + (d <= 2 ? 0.5 : 0);
      if (sc > best) { best = sc; bestKey = g; }
    }
    if (best <= 0) return;
    const lastAt = Number((state.last || {})[(opts.sessionId || "_") + ":" + c.id]) || 0;
    if (lastAt && now - lastAt < (Number(cfg.sameKeyHours) || 48) * 3600 * 1000) return;   // 11-08：同条冷却 24→48h，按会话隔离（A 会话想起过不影响 B）
    scored.push({ c, score: best, key: bestKey });
  });
  if (!scored.length) return { hits: [] };
  scored.sort((a, b) => b.score - a.score || String(b.c.ts || "").localeCompare(String(a.c.ts || "")));
  const take = scored.slice(0, Math.max(1, Number(cfg.perTurn) || 1));
  if (opts.commit !== false) {
    state.last = state.last || {};
    delete state.days;   // 11-08 天上限作废，旧账本字段不再保留
    for (const t of take) state.last[(opts.sessionId || "_") + ":" + t.c.id] = now;
    writeJson(STATE_FILE, state);
  }
  return {
    hits: take.map((t) => ({ id: t.c.id, text: "她提到「" + t.key + "」。" + t.c.text, kind: "sense", src: t.c.src, score: t.score, created_at: null, established_at: null, wordScore: t.score, vibeScore: 0 })),
  };
}

module.exports = { pick, grams, candidates, traceRecallText, DEFAULT_CFG, CFG_FILE, STATE_FILE };
