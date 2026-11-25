"use strict";

// 留纸存储（2026-09-12；2026-10-03 改 data/papers.json 单 JSON）。
// 只写、不注入上下文。字段 id（创建顺序递增）/session/title/created_at/content。
// 2026-10-22 批 B（笔记本重做）：
//   · 新增 summary（一句话摘要），不再有分类（category 旧值留在数据里，不读不写不展示）；
//   · tags = 「关键词」，只有用户在小手机上写、AI 看不到也写不了（AI 工具不带、AI 可见的输出里一律去掉）；
//   · 「笔记本目录」是一篇真实笔记（is_index），内容 = 所有其它笔记的 id｜标题｜摘要｜更新时间，
//     每次增删改后自动重写；注入上下文的 Notebook Index 块不再冻结，每次会话快照重建时按当前笔记重出。
// 2026-10-29（文件夹摘要 + 目录树形改版，产品确定）：
//   · 文件夹有摘要：papers.json 顶层 folder_meta: { path: { summary, updated_at } }，folders 数组仍是全集真源；
//   · 目录改树形：文件夹行 fid｜路径｜摘要（子级缩进，默认闭合不列里面的文件），文件行 id｜标题｜摘要，
//     只列根目录文件，去掉更新时间列；fid = 全集按 zh 字典序排序后的 f1/f2…，三处（目录笔记/注入块/工具概览）同口径。
// 2026-11-02（笔记置顶，产品确定）：
//   · entries[i].pinned=true + pinned_at（取消即删两字段）；目录笔记（is_index）不能置顶；置顶不动正文、不进历史；
//   · 置顶笔记全文进上下文 Pinned Notes 块（pinnedNotesLines，不冻结，每次快照建立/重建按当前置顶重出；
//     篇数不限、单篇超 PINNED_NOTE_MAX_CHARS 截断并注明）；目录行标题带「·已置顶」（indexRow）。
const fs = require("fs");
const path = require("path");
const ROOT_DIR = path.join(__dirname, "..");  // 1018-13：模块已搬进子目录，项目根 = 上一级
const { getDatePartsInTimeZone, resolveTimeZone } = require("../utils/time_utils");
const paperStore = require("./paper-store");
const notebookMeta = require("./notebook-meta");

// 存储根目录：默认仓库根；测试用 PAPERS_BASE_DIR 指向临时目录；2026-11-25 多本笔记本通过 withBaseDir 同步切换作用域
let _activeBaseDir = null;
function baseDir() { return _activeBaseDir || process.env.PAPERS_BASE_DIR || ROOT_DIR; }
function withBaseDir(dir, fn) {
  const prev = _activeBaseDir;
  _activeBaseDir = dir || null;
  try { return fn(); } finally { _activeBaseDir = prev; }
}

/* [位置:lib/papers.js·MAX_PAPER_CHARS] [单篇正文上限（超限自动拆篇）] [11-16：原来 30000，新增超限是静默 slice 截断＝悄悄丢内容；改成 20000，超出的自动拆成多篇（标题带·1/·2），每篇都不超过上限；上限只量正文，不含自动加的标题行与日期行（标题 100、摘要 500、原因 200 各算各的）] [注释时间 2026-11-16] */
const MAX_PAPER_CHARS = 20000;
const SPLIT_MAX_PARTS = 50; // 防呆：一次写入最多拆这么多篇，再多就报错让她分几次写
const SHARED_TOKEN = "_shared";

function timeZone() {
  try { return resolveTimeZone(process.env.TIME_ZONE || ""); } catch (e) { return "Asia/Shanghai"; }
}

// 「最近」的统一口径（2026-10-31 产品确定）：按创建时间新到旧，平局再按 id 大到小。
// 不再看 updated_at——改正文/摘要不动排序，笔记本目录行不会因为编辑而挪位置（10-16 旧口径按更新时间，编辑即重排）。
// 迁入的旧纸带着原 created_at，不会因为 id 大就挤到最前面。
// 2026-11-01 审查修复：created_at 缺失/无法解析时用 updated_at 兜底（只影响字段不全的存量数据，正常条目仍只看创建时间），免得历史条目 recency=0 全部沉底。
function recency(e) {
  const c = Date.parse((e && e.created_at) || "");
  if (Number.isFinite(c)) return c;
  const u = Date.parse((e && e.updated_at) || "");
  return Number.isFinite(u) ? u : 0;
}
function byRecent(a, b) {
  return recency(b) - recency(a) || b.id - a.id;
}

function stamp(date) {
  const p = getDatePartsInTimeZone(date || new Date(), timeZone());
  return { date: p.year + "-" + p.month + "-" + p.day, hm: p.hour + ":" + p.minute };
}

/* [位置:lib/papers.js·splitBody/splitCutPos] [超长正文拆篇] [11-16：正文超过单篇上限不再截断，自动拆成多篇、标题后面加·1/·2；切点优先段落空行、其次换行，尽量不在 ``` 代码块内部切；拆出来每篇都不超过 max。切的时候只丢接缝处的空白，不丢内容] [注释时间 2026-11-16] */
function fenceRanges(t) {
  const out = [], re = /```/g;
  let m = null, start = -1;
  re.lastIndex = 0;
  while ((m = re.exec(t))) {
    if (start < 0) start = m.index;
    else { out.push([start, m.index + 3]); start = -1; }
  }
  if (start >= 0) out.push([start, t.length]);
  return out;
}
function inFence(pos, ranges) {
  for (let i = 0; i < ranges.length; i++) {
    if (pos > ranges[i][0] && pos < ranges[i][1]) return ranges[i];
  }
  return null;
}
function splitCutPos(t, max) {
  let cut = -1;
  const p2 = t.lastIndexOf("\n\n", max);           // 段落交界优先
  if (p2 > max * 0.3) cut = p2 + 2;                  // 太靠前说明这一段本身就超长，退到单换行
  if (cut < 0) { const p1 = t.lastIndexOf("\n", max); if (p1 > max * 0.3) cut = p1 + 1; }
  if (cut < 0) cut = max;
  const ranges = fenceRanges(t);
  const hit = inFence(cut, ranges);
  if (hit) cut = hit[0] > max * 0.15 ? hit[0] : max;  // 代码块起点太靠前（一整块巨长）只能硬切
  return Math.max(1, Math.min(cut, t.length));
}
function splitBody(text, max) {
  const t = String(text == null ? "" : text);
  const parts = [];
  let rest = t;
  while (rest.length > max && parts.length < SPLIT_MAX_PARTS) {
    const cut = splitCutPos(rest, max);
    const head = rest.slice(0, cut).replace(/\s+$/, "");
    const tail = rest.slice(cut).replace(/^\s+/, "");
    if (!tail) break;
    if (head) parts.push(head);
    rest = tail;
  }
  if (rest.trim()) parts.push(rest.trim() ? rest : rest);
  return parts.filter(p => p.trim().length > 0);
}

// 拆篇标题：base·1、base·2…（已被占用的编号跳过，避免和旧篇撞名）
function splitTitles(base, count) {
  const taken = new Set(paperStore.listEntries(baseDir()).map(e => String(e.title || "").trim()));
  const out = [];
  let n = 1;
  while (out.length < count && n < 5000) {
    const t = base + "·" + n;
    if (!taken.has(t)) { out.push(t); taken.add(t); }
    n++;
  }
  return out;
}
// 续篇标题：原标题已带·N 就从 N+1 起，否则从 ·2 起
function continuationTitles(title, count) {
  const m = String(title || "").match(/^(.*?)·(\d+)$/);
  const base = m ? m[1] : (String(title || "").trim() || "无标题");
  const taken = new Set(paperStore.listEntries(baseDir()).map(e => String(e.title || "").trim()));
  const out = [];
  let n = m ? Number(m[2]) + 1 : 2;
  while (out.length < count && n < 5000) {
    const t = base + "·" + n;
    if (!taken.has(t)) { out.push(t); taken.add(t); }
    n++;
  }
  return out;
}

// 落一篇：标题行 +（日期 时间）头 + 正文（savePaper 拆篇与追加重拆共用）
function addPartEntry(spec) {
  const now = spec.now || new Date();
  const s = stamp(now);
  const nowIso = now.toISOString();
  const header = (spec.title ? "# " + spec.title + "\n\n" : "") + "（" + s.date + " " + s.hm + "）\n\n";
  return paperStore.addEntry(baseDir(), {
    title: spec.title || "", summary: cleanSummary(spec.summary),
    tags: spec.tags, category: spec.category, reason: spec.reason,
    created_at: spec.created_at || nowIso, updated_at: nowIso,
    content: header + spec.body + "\n",
  });
}

// 落一张纸（savePaper）：超单篇上限自动拆成多篇（第一篇保留原摘要，后续「原标题 第N/M部分」；文件夹/原因/关键词每篇各一份）；首行标题 +（日期 时间）头。
// 1009-10：留纸全局共享，不再存 session 字段、内容头不注入会话编号
function savePaper(opts) {
  const clean = String((opts && opts.content) || "").trim();
  if (!clean) return { ok: false, error: "内容为空" };
  const title0 = String((opts && opts.title) || "").trim().slice(0, 100);
  const cleanList = value => (Array.isArray(value) ? value : (typeof value === "string" ? value.split(/[,，、;；\n]+/) : []))
    .map(v => String(v || "").trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 30).map(v => v.slice(0, 40));
  // 一个 tags 字段统一承载分类、标签和检索词；不强制模型填写。
  const tags = cleanList(opts && opts.tags);
  const category = cleanCategory(opts && opts.category);
  const reason = cleanReason(opts && opts.reason);
  const summary = cleanSummary(opts && opts.summary);
  const chunkList = splitBody(clean, MAX_PAPER_CHARS);
  if (!chunkList.length) return { ok: false, error: "内容为空" };
  if (chunkList.some(c => c.replace(/\s+$/, "").length > MAX_PAPER_CHARS)) return { ok: false, error: "内容太长：单段就超过 " + MAX_PAPER_CHARS + " 字，没法拆" };
  if (chunkList.length > SPLIT_MAX_PARTS) {
    return { ok: false, error: "内容太长：会拆成 " + chunkList.length + " 篇，超过一次 " + SPLIT_MAX_PARTS + " 篇的上限，请分几次写" };
  }
  const givenAt = opts && opts.created_at ? new Date(opts.created_at) : null;
  const now = givenAt && !isNaN(givenAt.getTime()) ? givenAt : new Date();
  const nowIso = now.toISOString();
  const s = stamp(now);
  const baseTitle = title0 || "无标题";
  const titles = chunkList.length > 1 ? splitTitles(baseTitle, chunkList.length) : [title0];
  try {
    const ids = [], chars = [];
    for (let i = 0; i < chunkList.length; i++) {
      const sum = i === 0 ? summary : cleanSummary(baseTitle + " 第" + (i + 1) + "/" + chunkList.length + "部分");
      const id = addPartEntry({ title: titles[i], summary: sum, tags, category, reason, body: chunkList[i], now, created_at: nowIso });
      ids.push(id); chars.push(chunkList[i].length);
      if (!(opts && opts.skipAutoMeta)) {
        notebookMeta.schedule({
          baseDir: baseDir(),
          id,
          title: titles[i],
          folder: opts && opts.folder ? String(opts.folder) : "",
          body: chunkList[i],
          change: { type: "create" },
          hintSummary: i === 0 ? summary : "",
          prevSummary: "",
          prevTags: tags,
        });
      }
    }
    syncIndexNote();
    return { ok: true, id: ids[0], ids, parts: chunkList.length, titles,
      title: titles[0], summary: chunkList.length > 1 ? "" : summary, tags, category, reason,
      chars: chars[0], chars_list: chars, time: s.date + " " + s.hm, created_at: nowIso, updated_at: nowIso };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// 全量列表（门户/管理台用）：data/papers.json 全部，按创建时间新到旧（1031 改，原按更新时间），每张带标题、标签和创建/更新时间
function listPapers(limit) {
  const tz = timeZone();
  const out = paperStore.listEntries(baseDir())
    .slice()
    .sort(byRecent)
    .map(e => {
      const p = getDatePartsInTimeZone(new Date(e.created_at), tz);
      return {
        id: e.id, title: e.title || "", summary: e.summary || "", tags: Array.isArray(e.tags) ? e.tags : [],
        folder: e.folder || "",
        time: p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute,
        created_at: e.created_at, updated_at: e.updated_at || e.created_at,
        content: String(e.content || "").slice(0, 24000),
      };
    });
  return limit ? out.slice(0, limit) : out;
}

// ───────── 2026-10-16 工具集 v2：分类 / 搜索 / 概览 / 编辑（notebook 工具经网关内部接口调用）─────────

function cleanCategory(value) {
  return String(value == null ? "" : value).trim().slice(0, 40);
}

// reason：为什么记这一篇（一句话，可选）
function cleanReason(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 200);
}

// summary：一句话摘要（可选，折成一行）；11-16 上限 120→500（与正文 20000、标题 100、原因 200 各自独立）
function cleanSummary(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 500);
}

function cleanTags(value) {
  return (Array.isArray(value) ? value : (typeof value === "string" ? value.split(/[,，、;；\n]+/) : []))
    .map(v => String(v || "").trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 30).map(v => v.slice(0, 40));
}

const DATE_HEADER_RE = /^（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）\n\n/;

// 存储正文 = [# 标题\n\n] + （日期 时间）\n\n + 正文。拆开方便追加/覆盖/改标题时保住创建日期头。
function splitHeader(entry) {
  let c = String(entry.content || "");
  const t = String(entry.title || "");
  const titleLine = t ? "# " + t + "\n\n" : "";
  const hadTitleLine = !!titleLine && c.startsWith(titleLine);
  if (hadTitleLine) c = c.slice(titleLine.length);
  const m = DATE_HEADER_RE.exec(c);
  const dateLine = m ? m[0] : "";
  return { hadTitleLine, dateLine, body: c.slice(dateLine.length) };
}

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function previewOf(entry) {
  return oneLine(splitHeader(entry).body).slice(0, 30);
}

/* [位置:lib/papers.js·snippetOf] [搜索命中片段] [11-09 检索质量批：原来只取「最早出现的那个词」前后各 30 字，多个词离得远时另一个词看不到；改用共享的多词最优窗口（lib/keyword-window.js，前后各 30 字，覆盖词最多的窗口优先，词离得远给两段）；命中在标题/标签/分类里、正文里找不到词时取正文开头 30 字（同原来）] [注释时间 2026-11-09] */
function snippetOf(body, terms) {
  return require("./keyword-window").snippet(body, terms, { head: 30 });
}

function sortedEntries() {
  return paperStore.listEntries(baseDir()).filter(e => !e.is_index).sort(byRecent); // 按创建时间新到旧（1031 改，原按更新时间；目录笔记不算，AI 的列表 / 搜索里不出现；要看可按 id 读）
}

// AI 可见的简表：没有 category / tags（关键词只给用户）；缺 summary / reason 留空串，由调用方显示「无」。
// 10-29 加 folder：AI 要知道每篇在哪个文件夹（目录树里文件夹是闭合的，位置信息只有这里给全）。
function brief(e, preview) {
  return {
    id: e.id, title: e.title || "", summary: e.summary || "", reason: e.reason || "",
    folder: e.folder || "",
    pinned: !!e.pinned,
    created_at: e.created_at, updated_at: e.updated_at || e.created_at,
    length: String(e.content || "").length, preview,
  };
}

// 搜索：q 按空白切词，所有词都要命中（标题/摘要/原因/正文；includeTags=true 时再加关键词，仅小手机用，AI 工具不传）。
// 10-29 加 folder：限定「直属」某个文件夹（含子文件夹的用各自路径再查）；folder="" = 根目录直属。
function queryPapers(opts) {
  const o = opts || {};
  let limit = parseInt(o.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 10;
  if (limit > (o.maxLimit || 50)) limit = (o.maxLimit || 50);
  let offset = parseInt(o.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;
  const empty = { total: 0, offset, limit, returned: 0, items: [] };
  let all = sortedEntries();
  if (o.folder !== undefined && o.folder !== null) {
    const folder = cleanFolder(o.folder);
    if (folder === null) return Object.assign(empty, { error: "文件夹名字不对" });
    if (folder && !folderSetOf(paperStore.load(baseDir())).has(folder)) return Object.assign(empty, { error: "没有这个文件夹：" + folder });
    all = all.filter(e => (e.folder || "") === folder);
  }
  const terms = String(o.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const snippets = new Map();
  if (terms.length) {
    all = all.filter(e => {
      const body = splitHeader(e).body;
      const hay = [e.title, e.summary, e.reason, o.includeTags ? (Array.isArray(e.tags) ? e.tags : []).join(" ") : "", body].join("\n").toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
      snippets.set(e.id, snippetOf(body, terms));
      return true;
    });
  }
  const items = all.slice(offset, offset + limit)
    .map(e => brief(e, snippets.has(e.id) ? snippets.get(e.id) : previewOf(e)));
  return { total: all.length, offset, limit, returned: items.length, items };
}

// 不带参数的 notebook list：总篇数 + 最近 10 篇 + 文件夹清单（fid｜路径｜摘要｜篇数，10-29）
function categoryOverview() {
  const all = sortedEntries();
  return { total: all.length, recent: all.slice(0, 10).map(e => brief(e, previewOf(e))), folders: folderRows() };
}

// 编辑：append（默认）追加 / replace 整篇覆盖 / patch 局部替换（old+new）；title/category/tags 可单独改。改之前旧版进历史。
function editPaper(opts) {
  const o = opts || {};
  const e0 = paperStore.getEntry(baseDir(), o.id);
  if (!e0) return { ok: false, error: "纸不存在：id=" + o.id };
  if (e0.is_index) return { ok: false, error: "这是系统自动维护的笔记本目录，不能改（每次笔记增删改后会自动重写）" };
  const hasSummary = o.summary !== undefined && o.summary !== null;
  const hasPatch = (o.old !== undefined && o.old !== null) || o.mode === "patch";
  const hasContent = hasPatch || (typeof o.content === "string" && o.content.trim() !== "");
  const hasTitle = o.title !== undefined && o.title !== null;
  const hasCategory = o.category !== undefined && o.category !== null;
  const hasTags = o.tags !== undefined && o.tags !== null;
  const hasReason = o.reason !== undefined && o.reason !== null;
  if (!hasContent && !hasTitle && !hasCategory && !hasTags && !hasReason && !hasSummary) {
    return { ok: false, error: "没有要改的内容：content / old+new / title / summary / reason 至少给一个" };
  }
  if (o.mode !== undefined && o.mode !== null && o.mode !== "" && o.mode !== "append" && o.mode !== "replace" && o.mode !== "patch") {
    return { ok: false, error: "mode 只能是 append、replace 或 patch" };
  }
  const mode = hasPatch ? "patch" : (o.mode === "replace" ? "replace" : "append");
  const parts = splitHeader(e0);
  const previousLength = String(e0.content || "").length;
  const prevBody = parts.body;
  let body = parts.body;
  let splitCont = null;   /* 追加后超上限：记下拆好的段落，落库后把续篇建出来（11-16） */
  let changeInfo = null;
  if (hasContent) {
    if (mode === "patch") {
      const oldStr = String(o.old == null ? "" : o.old);
      const newStr = String(o.new == null ? "" : o.new);
      if (!oldStr) return { ok: false, error: "局部替换时 old 不能为空" };
      let count = 0, pos = 0;
      while (true) {
        const idx = body.indexOf(oldStr, pos);
        if (idx < 0) break;
        count++;
        pos = idx + oldStr.length;
      }
      if (count === 0) {
        return { ok: false, error: "正文里找不到要替换的片段（old 须与原文一字不差，先 action=list 带 id 看全文）" };
      }
      if (!o.replace_all && count > 1) {
        return { ok: false, error: "正文里匹配到 " + count + " 处相同片段，请多带前后文让 old 唯一，或传 replace_all=true 全部替换" };
      }
      const nextBody = o.replace_all
        ? body.split(oldStr).join(newStr)
        : (function () { const i = body.indexOf(oldStr); return body.slice(0, i) + newStr + body.slice(i + oldStr.length); })();
      if (!nextBody.trim()) {
        return { ok: false, error: "替换后正文为空，如需删整篇请用 action=delete" };
      }
      if (nextBody.trim().length > MAX_PAPER_CHARS) {
        return { ok: false, error: "替换后超过单篇 " + MAX_PAPER_CHARS + " 字上限（当前 " + nextBody.trim().length + " 字）" };
      }
      body = nextBody.endsWith("\n") ? nextBody : nextBody + "\n";
      changeInfo = { type: "patch", old: oldStr, new: newStr, replace_all: !!o.replace_all };
    } else {
      const clean = String(o.content).trim();
      if (mode === "replace") {
        if (clean.length > MAX_PAPER_CHARS) return { ok: false, error: "覆盖内容超过单篇 " + MAX_PAPER_CHARS + " 字上限（当前 " + clean.length + " 字）" };
        body = clean + "\n";
        changeInfo = { type: "replace", previous_body: prevBody };
      } else {
        /* [位置:lib/papers.js·editPaper 追加超限拆篇] [追加后超上限就把整篇重拆] [11-16：连载类是一段段追加的，超上限直接续成下一篇最省事；第一篇沿用原 id，后面新建 标题·2/·3，不会再出现同名两篇、也不丢内容] [注释时间 2026-11-16] */
        const base = body.replace(/\s+$/, "");
        const joined = base ? base + "\n\n" + clean : clean;
        if (joined.length <= MAX_PAPER_CHARS) {
          body = joined + "\n";
        } else {
          const chunks = splitBody(joined, MAX_PAPER_CHARS);
          if (chunks.some(c => c.replace(/\s+$/, "").length > MAX_PAPER_CHARS)) {
            return { ok: false, error: "追加后太长：单段就超过 " + MAX_PAPER_CHARS + " 字，没法拆" };
          }
          if (chunks.length > SPLIT_MAX_PARTS) {
            return { ok: false, error: "追加后太长：会拆成 " + chunks.length + " 篇，超过一次 " + SPLIT_MAX_PARTS + " 篇的上限" };
          }
          body = chunks[0] + "\n";
          splitCont = chunks;
        }
        changeInfo = { type: "append", added: clean };
      }
    }
  }
  const newTitle = hasTitle ? String(o.title).trim().slice(0, 100) : String(e0.title || "");
  // 只有原来就带「# 标题」行、或这次显式改了标题，才写标题行；老条目没有的不凭空加
  const titleLine = newTitle && (parts.hadTitleLine || hasTitle) ? "# " + newTitle + "\n\n" : "";
  const patch = { content: titleLine + parts.dateLine + body };
  // 只改标签/原因不算「内容更新」，不动 updated_at（目录里的更新时间保持真实）；摘要显示在目录里，改了算更新
  if (hasContent || hasTitle || hasSummary) patch.updated_at = new Date().toISOString();
  if (hasSummary) patch.summary = cleanSummary(o.summary);
  if (hasTitle) patch.title = newTitle;
  if (hasCategory) patch.category = cleanCategory(o.category);
  if (hasTags) patch.tags = cleanTags(o.tags);
  if (hasReason) patch.reason = cleanReason(o.reason);
  const e = paperStore.updateEntry(baseDir(), e0.id, patch, { reason: hasContent ? mode : "meta" });
  if (!e) return { ok: false, error: "纸不存在：id=" + o.id };
  const extraIds = [];
  if (splitCont) {
    const baseTitle = String(e0.title || "").trim() || "无标题";
    const ttl = continuationTitles(baseTitle, splitCont.length - 1);
    const now = new Date();
    for (let i = 1; i < splitCont.length; i++) {
      const id = addPartEntry({ title: ttl[i - 1], summary: baseTitle + " 第" + (i + 1) + "部分",
        tags: e0.tags, category: e0.category, reason: e0.reason, body: splitCont[i], now });
      if (e0.folder) setFolder(id, e0.folder);   // 续篇跟着原篇的文件夹走
      extraIds.push(id);
      if (!o.skipAutoMeta) {
        notebookMeta.schedule({
          baseDir: baseDir(),
          id,
          title: ttl[i - 1],
          folder: e0.folder || "",
          body: splitCont[i],
          change: { type: "create" },
          hintSummary: "",
          prevSummary: "",
          prevTags: Array.isArray(e0.tags) ? e0.tags : [],
        });
      }
    }
  }
  syncIndexNote();
  /* [位置:lib/papers.js·editPaper 后台摘要/关键词触发] [仅正文改动触发小模型] [11-21：单独改摘要/关键词/标题不触发；正文变动时异步把改动部分和可选参考摘要发给 notebook_meta 小模型] [注释时间 2026-11-21] */
  if (hasContent && !o.skipAutoMeta) {
    notebookMeta.schedule({
      baseDir: baseDir(),
      id: e.id,
      title: e.title || "",
      folder: e.folder || "",
      body: body.trim(),
      change: changeInfo,
      hintSummary: hasSummary ? cleanSummary(o.summary) : "",
      prevSummary: e0.summary || "",
      prevTags: Array.isArray(e0.tags) ? e0.tags : [],
    });
  }
  return {
    ok: true, id: e.id, ids: [e.id].concat(extraIds), parts: 1 + extraIds.length,
    title: e.title || "", summary: e.summary || "", category: e.category || "", reason: e.reason || "",
    tags: Array.isArray(e.tags) ? e.tags : [], updated_at: e.updated_at,
    length: String(e.content || "").length, previous_length: previousLength,
    mode: hasContent ? mode : null,
  };
}

// ───────── 2026-10-22 批 B：笔记本目录（真实笔记 + 注入块共用同一份行）─────────
const INDEX_TITLE = "笔记本目录";
const MISSING = "无"; // 摘要 / 原因缺失时显示

// ───────── 2026-10-29 文件夹摘要（文件夹也有摘要，进目录、进注入块、手机长按可编辑、AI 工具可改）─────────
// 摘要存 papers.json 顶层 folder_meta: { path: { summary, updated_at } }；folders 数组仍是文件夹全集的真源，
// meta 只是附着在上面的摘要，缺了 = 无。重命名时 meta 键跟着迁移（portalFolderRename），删除时清掉（portalFolderDelete）。
function metaSummaryMap(st) {
  const m = st.folder_meta, out = {};
  if (m && typeof m === "object") Object.keys(m).forEach(p => { const c = cleanFolder(p); if (c && m[p] && typeof m[p].summary === "string") out[c] = m[p].summary; });
  return out;
}
function folderCount(st, p) { // 文件夹里的笔记总数（含子文件夹），和手机列表页同一个口径
  return st.entries.filter(e => !e.is_index && e.folder && (e.folder === p || e.folder.startsWith(p + "/"))).length;
}
// 文件夹全集排序 + fid 编号（f1/f2…）。目录笔记、注入块、AI 工具概览三处共用，口径一致。
function folderRows(base) {
  const st = paperStore.load(base || baseDir());
  const meta = metaSummaryMap(st);
  return Array.from(folderSetOf(st)).sort((a, b) => a.localeCompare(b, "zh")).map((p, i) => ({
    fid: "f" + (i + 1), path: p, summary: meta[p] || "", count: folderCount(st, p),
  }));
}
function portalFoldersBrief() { return folderRows(); }
// 改文件夹摘要：summary 空串 = 清掉；改完重写目录（摘要显示在目录里）
function portalFolderSummary(path, summary) {
  const p = cleanFolder(path);
  if (!p) return { ok: false, error: "文件夹名字不对" };
  const base = baseDir(), st = paperStore.load(base);
  if (!folderSetOf(st).has(p)) return { ok: false, error: "没有这个文件夹" };
  const s = cleanSummary(summary);
  st.folder_meta = st.folder_meta && typeof st.folder_meta === "object" ? st.folder_meta : {};
  if (s) st.folder_meta[p] = { summary: s, updated_at: new Date().toISOString() };
  else delete st.folder_meta[p];
  paperStore.save(base, st);
  syncIndexNote();
  return { ok: true, path: p, summary: s };
}
// 手动刷新目录（10-29：目录笔记阅读页右上角刷新按钮）——格式升级 / 怀疑目录没跟上时立刻重写一次；
// syncIndexNote 内容没变时返回 unchanged=true（不算白点）
function portalIndexRefresh() {
  const changed = syncIndexNote();
  const idx = paperStore.listEntries(baseDir()).find(e => e.is_index);
  return { ok: true, changed: !!changed, id: idx ? idx.id : null };
}

// AI 用：完整路径逐级建（"故事/第一卷" 一条建两层；已存在的层跳过）
function portalFolderAddDeep(path) {
  const p = cleanFolder(path);
  if (!p) return { ok: false, error: "文件夹名字不对（1-30 字一段，最多 5 层）" };
  const parts = p.split("/");
  for (let i = 0; i < parts.length; i++) {
    const r = portalFolderAdd(parts.slice(0, i + 1).join("/"));
    if (!r.ok && r.error !== "已经有这个文件夹了") return r;
  }
  return { ok: true, path: p };
}

// 目录里的一行（2026-11-21 产品确定：文件夹默认折叠，行本身带摘要 fid｜路径｜摘要；仅开启「在目录中显示」show_in_index 的文件夹内单篇笔记会缩进列在对应文件夹行下，格式同根目录行 id｜标题｜摘要）：
//   文件夹行：fid｜路径｜摘要（子级行首缩进全角空格，缩进=层级）
//   文件夹内开启目录显示的文件行：id｜标题｜摘要（缩进比所在文件夹深一级，带·已置顶标记）
//   根目录文件行：id｜标题｜摘要（只列根目录的）
function indexRow(e) {
  /* [位置:lib/papers.js·indexRow] [目录行带置顶标记] [11-02：已置顶的笔记标题后带·已置顶，目录笔记和 Notebook Index 块同源生效] [注释时间 2026-11-02] */
  let title = oneLine(e.title) || MISSING;
  if (e.pinned) title += "·已置顶";
  const sum = oneLine(e.summary) || MISSING;
  return e.id + "｜" + title.slice(0, 60) + "｜" + sum.slice(0, 200);   /* 11-16：摘要上限提到 500 后，目录行显示从 80 放宽到 200（全放会把快照撑肥） */
}
function folderIndexRow(r) {
  const indent = "　".repeat(r.path.split("/").length - 1);
  const sum = oneLine(r.summary) || MISSING;
  return indent + r.fid + "｜" + r.path + "｜" + sum.slice(0, 200);   /* 11-21：文件夹默认折叠，目录行恢复显示 fid｜路径｜摘要 */
}
/* [位置:lib/papers.js·folderFileRow] [文件夹内开启目录显示的文件行] [11-21：缩进深一级，展示 id｜标题[·已置顶]｜摘要] [注释时间 2026-11-21] */
function folderFileRow(e, depth) {
  return "　".repeat(depth) + indexRow(e);
}
/* [位置:lib/papers.js·folderSectionRows] [文件夹段整段行] [11-21：文件夹默认折叠（只列文件夹行 fid｜路径｜摘要），仅把该文件夹内开启了 show_in_index 的直属笔记缩进列在下方；注入块和目录笔记同源共用] [注释时间 2026-11-21] */
function folderSectionRows(folders, all) {
  const rows = [];
  for (const r of folders) {
    rows.push(folderIndexRow(r));
    const kids = all.filter(e => e.folder === r.path && e.show_in_index).sort(byRecent);
    Array.prototype.push.apply(rows, kids.map(e => folderFileRow(e, r.path.split("/").length)));
  }
  return rows;
}

// 所有普通笔记（不含目录自己），新到旧
function noteEntries(base) {
  return paperStore.listEntries(base || baseDir()).filter(e => !e.is_index).sort(byRecent);
}

// 注入块「Notebook Index」用的目录行（装配层调用，builder 保持纯函数）。没有笔记也没有文件夹返回 []。
// 不再冻结（10-22）：每次会话快照建立 / 重建时按当前笔记重出；之后新增的要等重建才进快照。
// 根目录文件最多列 INDEX_MAX 篇（新到旧），多出的提示用 notebook action=list 翻页看；文件夹全列且展开（行下列出直属文件）。
// 第一个参数是旧签名的「最近几篇」，已不起作用（目录要全），保留位置只为不改各处调用。
const INDEX_MAX = 80;
function indexLines(_legacyLimit, base) {
  const n = INDEX_MAX;
  const all = noteEntries(base);
  const folders = folderRows(base);
  if (!all.length && !folders.length) return [];
  const roots = all.filter(e => !e.folder);
  const shown = roots.slice(0, n);
  const lines = [
    /* 11-03：目录说明删到只剩一句——快照/重建说法、文件夹行格式解释都去掉（读法在最后一行 notebook action=list 里） */
    "这是你的笔记本目录（文件夹+根目录文件）。",
    folders.length + " 个文件夹、共 " + all.length + " 篇。",
  ];
  /* 11-16：文件夹展开——文件夹行下面缩进列出直属文件（id｜标题）；文件摘要不进目录，读法走最后一行的 notebook action=list */
  if (folders.length) Array.prototype.push.apply(lines, ["文件夹："].concat(folderSectionRows(folders, all)));
  Array.prototype.push.apply(lines, ["根目录文件" + (roots.length > shown.length ? "（最近 " + shown.length + " 篇，共 " + roots.length + " 篇）" : "（" + roots.length + " 篇）") + "："]);
  Array.prototype.push.apply(lines, shown.length ? shown.map(indexRow) : ["（无）"]);
  if (roots.length > shown.length) lines.push("更早的 " + (roots.length - shown.length) + " 篇没列进来：notebook action=list 翻页看。");
  lines.push("读全文或搜索：notebook action=list（id=看全文，q=搜索，folder=只看某个文件夹里的，limit/offset=翻页）。");
  return lines;
}

// ───────── 2026-11-02 笔记置顶（AI 工具和手机笔记本页都能置顶；置顶的笔记全文进上下文 Pinned Notes 块）─────────
// 2026-11-24（产品确定）：取消单篇 4000 字截断上限，置顶笔记始终完整注入全文。

/* [位置:lib/papers.js·pinPaper] [置顶/取消置顶] [11-02：AI 工具（/internal/paper/pin）和手机笔记本页（/papers/api/note/pin）共用；不动正文不进历史，只改 pinned/pinned_at，改完重写目录（目录行标题带·已置顶）] [注释时间 2026-11-02] */
function pinPaper(id, pinned) {
  const e0 = paperStore.getEntry(baseDir(), id);
  if (!e0) return { ok: false, error: "笔记不存在：id=" + id };
  if (e0.is_index) return { ok: false, error: "笔记本目录是系统自动维护的，不用置顶" };
  const want = !!pinned && pinned !== "false";   // 容错：字符串 "false" 也当取消
  const e = paperStore.setPinned(baseDir(), e0.id, want);
  syncIndexNote();
  return { ok: true, id: e.id, title: e.title || "", pinned: !!e.pinned };
}

/* [位置:lib/papers.js·setShowInIndex] [文件夹内单篇笔记是否在目录中显示] [11-21：小手机长按文件夹内笔记可开关是否在所属文件夹目录行下显示；改完自动重写目录] [注释时间 2026-11-21] */
function setShowInIndex(id, show) {
  const e0 = paperStore.getEntry(baseDir(), id);
  if (!e0) return { ok: false, error: "笔记不存在：id=" + id };
  if (e0.is_index) return { ok: false, error: "笔记本目录是系统自动维护的" };
  const want = !!show && show !== "false";
  const e = paperStore.setShowInIndex(baseDir(), e0.id, want);
  syncIndexNote();
  return { ok: true, id: e.id, title: e.title || "", show_in_index: !!e.show_in_index };
}

/* [位置:lib/papers.js·pinnedNotesLines] [Pinned Notes 注入块行] [11-02：置顶笔记全文进上下文；不冻结（同笔记本目录策略），每次快照建立/重建按当前置顶重出；最近置顶在最前；2026-11-24 取消单篇 4000 字截断，改为完整注入] [注释时间 2026-11-24] */
function pinnedNotesLines(base) {
  const all = paperStore.listEntries(base || baseDir()).filter(e => !e.is_index && e.pinned);
  if (!all.length) return [];
  all.sort((a, b) => Date.parse(b.pinned_at || "") - Date.parse(a.pinned_at || "") || b.id - a.id);
  const lines = [
    "以下是置顶的笔记（完整原文）。本块在会话快照建立或重建时按当前置顶生成；之后置顶 / 取消置顶、修改置顶笔记的内容，要等重建才生效。",
  ];
  for (const e of all) {
    /* [位置:lib/papers.js·pinnedNotesLines 去重复标题] [置顶笔记不再重复标题] [11-03：原来分隔行写一遍标题，正文开头又有系统存的「# 标题 + （日期）」头，笔记自己正文有时再带一个同名标题——同一个标题最多出现三次。现在：系统头去掉（日期并进分隔行），正文开头若是和标题一样的「# 标题」行也去掉；分隔行 = id｜标题·已置顶｜创建日期] [注释时间 2026-11-03] */
    const t0 = oneLine(e.title) || MISSING;
    const title = t0 + "·已置顶";
    const sp = splitHeader(e);
    const dm = /（(\d{4}-\d{2}-\d{2})/.exec(sp.dateLine || "");
    let body = String(sp.body || "").trim();
    const hm = /^#{1,3}\s*([^\n]*)\n+/.exec(body);
    if (hm && oneLine(hm[1]) === t0) body = body.slice(hm[0].length).trim();
    body = body || "（空）";
    lines.push("── " + e.id + "｜" + title + (dm ? "｜" + dm[1] : "") + " ──\n\n" + body);
  }
  return lines;
}

// 「笔记本目录」这篇真实笔记：内容 = 树形目录（文件夹段 + 根目录文件段），
// 每次笔记增删改、改文件夹摘要后重写（内容没变就不写，免得白白刷新更新时间）。
// 笔记一篇都没有、也没建过目录时什么都不做。失败只记日志，不影响笔记本身的写入。
function syncIndexNote() {
  try {
    const base = baseDir();
    const st = paperStore.load(base);
    const idx = st.entries.find(e => e.is_index);
    const folders = folderRows(base);
    const allNotes = noteEntries(base);
    const roots = allNotes.filter(e => !e.folder);
    if (!roots.length && !folders.length && !idx) return false;
    const body = "文件夹行：fid｜路径｜摘要（缩进=层级），默认折叠，仅开启「在目录中显示」的文件夹内笔记会缩进列在下方（id｜标题｜摘要）；根目录文件行：id｜标题｜摘要。系统自动生成的树形目录，每次笔记增删改后重写，不用手动改。\n\n" +
      "文件夹（" + folders.length + " 个）：\n" + (folders.length ? folderSectionRows(folders, allNotes).join("\n") : "（无）") + "\n\n" +
      "根目录文件（" + roots.length + " 篇）：\n" + (roots.length ? roots.map(indexRow).join("\n") : "（无）") + "\n";
    if (idx) {
      const cur = splitHeader(idx);
      if (cur.body === body) return false;
      idx.content = (idx.title ? "# " + idx.title + "\n\n" : "") + cur.dateLine + body;
      idx.updated_at = new Date().toISOString();
      paperStore.save(base, st);
      return true;
    }
    const now = new Date();
    const s = stamp(now);
    paperStore.addEntry(base, {
      title: INDEX_TITLE, summary: "所有笔记的目录（系统自动生成，只读）", reason: "系统自动维护",
      is_index: true, created_at: now.toISOString(), updated_at: now.toISOString(),
      content: "# " + INDEX_TITLE + "\n\n（" + s.date + " " + s.hm + "）\n\n" + body,
    });
    return true;
  } catch (e) {
    console.warn("[papers] 重写笔记本目录失败:", e && e.message);
    return false;
  }
}

// ───────── 小手机笔记本页用的读写（用户视角：能看到关键词 tags 和目录笔记；写入口在 routes/papers-portal.js）─────────
function portalBrief(e) {
  return {
    id: e.id, title: e.title || "", summary: e.summary || "", reason: e.reason || "",
    tags: Array.isArray(e.tags) ? e.tags : [], is_index: !!e.is_index, folder: e.is_index ? "" : (e.folder || ""),
    pinned: !!e.pinned, show_in_index: !!e.show_in_index,
    created_at: e.created_at, updated_at: e.updated_at || e.created_at,
    length: String(e.content || "").length, preview: previewOf(e),
  };
}

// 全部笔记：目录笔记置顶，其余按创建时间新到旧（1031 改，编辑不再挪位置）
function portalList() {
  const all = paperStore.listEntries(baseDir()).slice().sort((a, b) => (b.is_index ? 1 : 0) - (a.is_index ? 1 : 0) || byRecent(a, b));
  return all.map(portalBrief);
}

// 搜索：标题 / 摘要 / 原因 / 关键词 / 正文，每词都要命中；返回 portalBrief + 命中片段
function portalSearch(q) {
  const r = queryPapers({ q, limit: 200, maxLimit: 200, includeTags: true });
  const byId = new Map(paperStore.listEntries(baseDir()).map(e => [e.id, e]));
  return r.items.map(it => {
    const e = byId.get(it.id);
    return Object.assign(portalBrief(e), { preview: it.preview });
  });
}

function portalRead(id) {
  const e = paperStore.getEntry(baseDir(), id);
  if (!e) return null;
  return Object.assign(portalBrief(e), { body: splitHeader(e).body.trim() });
}

function portalAdd(o) {
  const folder = o.folder === undefined || o.folder === null ? "" : cleanFolder(o.folder);
  if (folder === null) return { ok: false, error: "文件夹名字不对" };
  const r = savePaper({
    content: o.content, title: o.title, summary: o.summary, reason: o.reason, tags: o.tags, created_at: o.created_at, folder,
  });
  if (r && r.ok && folder) {
    const ids = r.ids || [r.id];
    ids.forEach(id => setFolder(id, folder));   /* 11-16：超长拆成多篇时，每一篇都放进同一个文件夹 */
    syncIndexNote();
  }
  return r;
}

// 用户改一篇：正文整篇覆盖（编辑器里就是整篇文字）；没动的部分不传，免得只改了关键词也刷新更新时间
function portalUpdate(o) {
  const e0 = paperStore.getEntry(baseDir(), o.id);
  if (!e0) return { ok: false, error: "笔记不存在：id=" + o.id };
  if (o.folder !== undefined && o.folder !== null) {
    const m = portalMove(o.id, o.folder);
    if (!m.ok) return m;
  }
  const cur = splitHeader(e0);
  const patch = { id: e0.id, mode: "replace" };
  if (typeof o.content === "string") {
    if (!o.content.trim()) return { ok: false, error: "正文不能为空" };
    if (o.content.trim() !== cur.body.trim()) patch.content = o.content;
  }
  if (o.title !== undefined && o.title !== null && String(o.title).trim() !== String(e0.title || "").trim()) patch.title = o.title;
  if (o.summary !== undefined && o.summary !== null && cleanSummary(o.summary) !== (e0.summary || "")) patch.summary = o.summary;
  if (o.reason !== undefined && o.reason !== null && cleanReason(o.reason) !== (e0.reason || "")) patch.reason = o.reason;
  if (o.tags !== undefined && o.tags !== null && JSON.stringify(cleanTags(o.tags)) !== JSON.stringify(Array.isArray(e0.tags) ? e0.tags : [])) patch.tags = o.tags;
  if (Object.keys(patch).length === 2) return { ok: true, unchanged: true, id: e0.id };   // 只改了文件夹也走这里：移动不刷新更新时间
  return editPaper(patch);
}

// 删一篇：整篇先进 papers-history.json（reason=delete）再删；目录笔记不能删
function portalDelete(id) {
  const e0 = paperStore.getEntry(baseDir(), id);
  if (!e0) return { ok: false, error: "笔记不存在：id=" + id };
  if (e0.is_index) return { ok: false, error: "笔记本目录由系统维护，不能删" };
  paperStore.removeEntry(baseDir(), e0.id);
  syncIndexNote();
  return { ok: true, id: e0.id };
}

// ───────── 笔记本文件夹（10-28：笔记本页做成像工作流那样的文件管理）─────────
// 数据：entries[i].folder = "a/b"（空/缺省 = 根目录）；st.folders = 用户显式建的文件夹路径（空文件夹也要留住）。
// 文件夹 = 目录的并集：显式建的 + 笔记所在的 + 它们的上级；最多 5 层，名字 ≤30 字、不含 / \\、不能是 . 或 ..。
// 目录笔记（is_index）永远在根目录。移动笔记不刷新更新时间、不进历史。
// 10-29：AI 的 notebook 工具开始认文件夹（add 带 folder / list 按 folder / folder_add / edit 改文件夹摘要）。
function cleanFolder(v) {
  const parts = String(v == null ? "" : v).split("/").map(x => x.trim()).filter(Boolean);
  if (parts.length > 5) return null;
  for (const p of parts) { if (p.length > 30 || p === "." || p === ".." || /[\\\u0000-\u001f]/.test(p)) return null; }
  return parts.join("/");
}
function withParents(set, p) {
  const parts = p.split("/"); let cur = "";
  parts.forEach(x => { cur = cur ? cur + "/" + x : x; set.add(cur); });
}
function folderSetOf(st) {
  const set = new Set();
  (Array.isArray(st.folders) ? st.folders : []).forEach(p => { const c = cleanFolder(p); if (c) withParents(set, c); });
  st.entries.forEach(e => { if (!e.is_index && e.folder) { const c = cleanFolder(e.folder); if (c) withParents(set, c); } });
  return set;
}
function portalFolders() {
  return Array.from(folderSetOf(paperStore.load(baseDir()))).sort((a, b) => a.localeCompare(b, "zh"));
}
function setFolder(id, folder) {
  const base = baseDir(), st = paperStore.load(base), e = st.entries.find(x => x.id === Number(id));
  if (!e || e.is_index) return false;
  if (folder) e.folder = folder; else delete e.folder;
  paperStore.save(base, st);
  return true;
}
function portalMove(id, folder) {
  const f = cleanFolder(folder);
  if (f === null) return { ok: false, error: "文件夹名字不对" };
  const e = paperStore.getEntry(baseDir(), id);
  if (!e) return { ok: false, error: "笔记不存在：id=" + id };
  if (e.is_index) return { ok: false, error: "笔记本目录由系统维护，不能移动" };
  if (f && !portalFolders().includes(f)) return { ok: false, error: "没有这个文件夹" };
  if ((e.folder || "") !== f) setFolder(e.id, f);
  return { ok: true, id: e.id, folder: f };
}
function portalFolderAdd(path) {
  const p = cleanFolder(path);
  if (!p) return { ok: false, error: "文件夹名字不对（1-30 字，不含 / ，最多 5 层）" };
  const base = baseDir(), st = paperStore.load(base);
  if (folderSetOf(st).has(p)) return { ok: false, error: "已经有这个文件夹了" };
  const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  if (parent && !folderSetOf(st).has(parent)) return { ok: false, error: "上级文件夹不存在" };
  st.folders = Array.isArray(st.folders) ? st.folders : [];
  st.folders.push(p);
  paperStore.save(base, st);
  return { ok: true, path: p };
}
// 重命名：只改最后一段；里面的笔记和子文件夹跟着改；摘要 meta 键跟着迁移（10-29）
function portalFolderRename(path, name) {
  const p = cleanFolder(path), nn = cleanFolder(name);
  if (!p) return { ok: false, error: "文件夹名字不对" };
  if (!nn || nn.includes("/")) return { ok: false, error: "新名字不对（1-30 字，不含 /）" };
  const base = baseDir(), st = paperStore.load(base), set = folderSetOf(st);
  if (!set.has(p)) return { ok: false, error: "没有这个文件夹" };
  const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  const np = parent ? parent + "/" + nn : nn;
  if (np === p) return { ok: true, path: p, unchanged: true };
  if (set.has(np)) return { ok: false, error: "已经有同名文件夹了" };
  const mv = x => (x === p ? np : (x.startsWith(p + "/") ? np + x.slice(p.length) : x));
  st.folders = (Array.isArray(st.folders) ? st.folders : []).map(mv);
  if (st.folder_meta && typeof st.folder_meta === "object") {
    const nm = {};
    Object.keys(st.folder_meta).forEach(k => { nm[mv(k)] = st.folder_meta[k]; });
    st.folder_meta = nm;
  }
  st.entries.forEach(e => { if (e.folder) e.folder = mv(e.folder); });
  paperStore.save(base, st);
  syncIndexNote(); // 路径显示在目录里，重命名后要重写
  return { ok: true, path: np };
}
// 删除：只能删空的（里面没有笔记也没有子文件夹），免得一下删掉东西；摘要 meta 一并清掉（10-29）
function portalFolderDelete(path) {
  const p = cleanFolder(path);
  if (!p) return { ok: false, error: "文件夹名字不对" };
  const base = baseDir(), st = paperStore.load(base);
  if (!folderSetOf(st).has(p)) return { ok: false, error: "没有这个文件夹" };
  if (st.entries.some(e => !e.is_index && e.folder && (e.folder === p || e.folder.startsWith(p + "/")))) return { ok: false, error: "文件夹不是空的：里面还有笔记，先移走或删掉" };
  if ((st.folders || []).some(f => f.startsWith(p + "/"))) return { ok: false, error: "文件夹不是空的：里面还有子文件夹" };
  st.folders = (st.folders || []).filter(f => f !== p);
  if (st.folder_meta && typeof st.folder_meta === "object") delete st.folder_meta[p];
  paperStore.save(base, st);
  syncIndexNote();
  return { ok: true, path: p };
}

// 本机笔记（小手机 localStorage ph.note.v2）迁入：幂等——每条用 reason 里的「本机笔记迁入·时间戳」认，已迁过的跳过
function portalImport(notes) {
  const list = Array.isArray(notes) ? notes : [];
  const have = new Set(paperStore.listEntries(baseDir()).map(e => e.reason).filter(Boolean));
  let added = 0, skipped = 0;
  const ids = [];
  for (const n of list) {
    const ts = Number(n && n.ts);
    const key = "本机笔记迁入·" + (Number.isFinite(ts) && ts > 0 ? ts : "无时间");
    const text = String((n && n.content) || "").trim();
    if (!text) { skipped++; continue; }
    if (Number.isFinite(ts) && ts > 0 && have.has(key)) { skipped++; continue; }
    const r = savePaper({
      content: text, title: n.title || text.split("\n")[0].slice(0, 16), tags: n.tags, reason: key,
      created_at: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : undefined,
    });
    if (r && r.ok) { added++; ids.push(r.id); have.add(key); } else skipped++;
  }
  return { ok: true, added, skipped, ids };
}

// 按标题找已有的纸（<paper> 标记用：标题一样就接着写）。去首尾空白后精确比较，重名取最新创建的一张（1031 改，原取最近更新）；没有返回 null。
function findByTitle(title) {
  const t = String(title == null ? "" : title).trim();
  if (!t) return null;
  const hit = paperStore.listEntries(baseDir()).filter(e => !e.is_index && String(e.title || "").trim() === t).sort(byRecent)[0];
  return hit || null;
}

module.exports = { withBaseDir, savePaper, splitBody, MAX_PAPER_CHARS, listPapers, queryPapers, categoryOverview, editPaper, indexLines, findByTitle, syncIndexNote, portalIndexRefresh, portalList, portalSearch, portalRead, portalAdd, portalUpdate, portalDelete, portalImport, portalFolders, portalFoldersBrief, portalFolderAdd, portalFolderAddDeep, portalFolderRename, portalFolderDelete, portalFolderSummary, portalMove, pinPaper, setShowInIndex, pinnedNotesLines };
