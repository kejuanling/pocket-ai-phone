'use strict';
// routes/workflow-files.js —— 小手机「我的 → 工作流」文件管理接口（/admin/workflow/*：list/read/raw/dl/save/create/upload/delete/rename/move/undo）
// 2026-11-03 从 server.js 拆出（server.js 拆分批 1；原位置 9014-9280 行，逻辑一字未改，只把 __dirname 换成 deps.baseDir、fs/path 就地 require）。
// 依赖注入：deps.basicAuth（管理台鉴权）、deps.atomicWriteFileSync（原子写）、deps.baseDir（项目根，原 __dirname）。
// 块内定义的 WF_DIR/WF_BAK/WF_UNDO_FILE/WF_BIN_EXT/wf* 辅助函数、WF_RAW_TYPES/WF_FIT_CSS/wfInjectFit 只在本文件使用。
const fs = require('fs');
const path = require('path');

module.exports = function (app, deps) {
const { basicAuth, atomicWriteFileSync, baseDir } = deps;

// ================= [位置:server.js·工作流文件管理] [小手机「我的 → 工作流」：工作流文件夹增删改查 + 撤销] [10-27：她本地操作不到服务器 工作流/ 目录，做网页管理（前端 phone-wf.js）；保存即落盘；写/删先留底到 工作流/备份/wf/，撤销栈落盘 data/wf_undo.json（最近 50 条，重启不丢）；路径 resolve 后必须仍在 工作流/ 内，防穿越；二进制后缀不给编辑] [注释时间 2026-10-27]
const WF_DIR = path.join(baseDir, "工作流");
const WF_BAK = path.join(WF_DIR, "备份", "wf");
const WF_UNDO_FILE = path.join(baseDir, "data", "wf_undo.json");
// [位置:routes/workflow-files.js·WF_BIN_EXT] [二进制后缀名单（不给文本读/编辑/保存/新建，防乱码写坏文件）] [11-10：exe 传上来后点开会被当文本读出乱码，此时按保存会把二进制当文本写回、文件直接损坏；名单补上可执行/安装包/镜像类后缀——这类文件点开提示「二进制不可编辑」、可长按下载，与 zip/pdf 行为一致；bat/cmd/ps1/sh 是纯文本，保持可编辑] [注释时间 2026-11-10]
const WF_BIN_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tar|mp3|mp4|wav|ogg|woff2?|ttf|otf|eot|wasm|class|jar|pyc|so|bin|db|sqlite3?|sticker|exe|msi|com|scr|apk|dmg|appimage|deb|rpm|ipa|7z|rar|iso|vhd)$/i;
// 直传单文件上限：nginx 对应 location client_max_body_size 220m（parser 220MB + nginx 留余量）
const WF_UPLOAD_MAX = 200 * 1024 * 1024;

function wfSafe(rel) {
  const abs = path.resolve(WF_DIR, String(rel || ""));
  if (abs !== WF_DIR && !abs.startsWith(WF_DIR + path.sep)) return null;
  return abs;
}
function wfRel(abs) { return path.relative(WF_DIR, abs); }
function wfBakPath(rel, isDir) {
  return path.join(WF_BAK, String(rel).split(path.sep).join("__") + "." + Date.now() + (isDir ? "" : ".bak"));
}
function wfCopy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) wfCopy(path.join(src, n), path.join(dst, n));
  } else fs.copyFileSync(src, dst);
}
function wfUndoLoad() { try { return JSON.parse(fs.readFileSync(WF_UNDO_FILE, "utf8")); } catch (e) { return []; } }
function wfUndoWrite(st) { try { atomicWriteFileSync(WF_UNDO_FILE, JSON.stringify(st)); } catch (e) { console.warn("[wf] undo 栈落盘失败:", e.message); } }
function wfUndoPush(op) { wfUndoWrite(wfUndoLoad().concat([op]).slice(-50)); }

app.get("/admin/workflow/list", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const dir = wfSafe((req.query || {}).dir || "");
    if (!dir) return reply.code(400).send({ ok: false, msg: "路径不对" });
    const dirs = [], files = [];
    for (const n of fs.readdirSync(dir)) {
      let st; try { st = fs.statSync(path.join(dir, n)); } catch (e) { continue; }
      const rel = wfRel(path.join(dir, n));
      if (st.isDirectory()) dirs.push({ n, p: rel });
      else files.push({ n, p: rel, size: st.size, mtime: st.mtimeMs });
    }
    const zh = (a, b) => a.n.localeCompare(b.n, "zh");
    dirs.sort(zh); files.sort(zh);
    return { ok: true, dirs, files };
  } catch (e) { return reply.code(404).send({ ok: false, msg: "读不到：" + e.message }); }
});

app.get("/admin/workflow/read", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const f = wfSafe((req.query || {}).path);
    if (!f || f === WF_DIR) return reply.code(400).send({ ok: false, msg: "路径不对" });
    const st = fs.statSync(f);
    if (st.isDirectory()) return reply.code(400).send({ ok: false, msg: "这是目录" });
    if (WF_BIN_EXT.test(f)) return { ok: true, text: false, size: st.size };
    return { ok: true, text: true, content: fs.readFileSync(f, "utf8") };
  } catch (e) { return reply.code(404).send({ ok: false, msg: "读不到：" + e.message }); }
});

// [位置:server.js·/admin/workflow/raw/*] [工作流原文件只读接口] [11-01：工作流页点开 .html/.htm 要 iframe 直接渲染（前端 phone-wf.js·setMode html 分支），路径式 URL 让文件里的相对资源（同目录图片/字体）解析后也落回本接口；按后缀白名单给 Content-Type，只读、不进撤销栈、不给写；凭据同 basicAuth（admin_session cookie 或 Basic 头都行）；no-store 保证保存后重载 iframe 拿到新版；11-01 html 响应注入小屏适配 CSS（11-01：审查报告类 html 里固定列宽表格把文档撑到 ~500pt，手机 iframe 里文字被裁、整页横晃——表格转块级内部横滚、媒体限宽、防 grid/flex 子项 min-width:auto 撑破；只动接口响应不动物理文件，收藏室那种 min-width 设计稿不受影响，元素/类选择器优先级高于 *；11-14 加无后缀文件嗅探（wfSniffHtml：后缀不认识时读文件头 1KB，像 HTML 就按 text/html，上传的「捏捏」没后缀原来 415 打不开）] [注释时间 2026-11-14]
const WF_RAW_TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", xml: "text/xml; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
  pdf: "application/pdf",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
};
// [位置:server.js·WF_FIT_CSS/wfInjectFit] [html 响应小屏适配注入] [11-01：报告类 html 的固定列宽表格在手机 iframe（~390pt）里把文档撑宽、文字被裁、整页能横拖；统一注入一段兜底 CSS——表格 display:block 内部横滚（不再撑破页面）、img/video 限宽、code 长串可断行、* min-width:0 防 grid/flex 子项内容最小宽撑破；只注入到响应流，物理文件不动（桌面浏览器打开还是原布局）；优先插 </head> 前，退化 <body> 开标签后，再退化整体前置；已带标记不重复注入] [注释时间 2026-11-01]
const WF_FIT_CSS = "table{display:block;width:max-content;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}"
  + "img,video,canvas{max-width:100%;height:auto}svg,iframe,embed,object{max-width:100%}"
  + "pre{max-width:100%;overflow-x:auto}code{overflow-wrap:anywhere}"
  + "*{min-width:0}";
// [位置:routes/workflow-files.js·wfSniffHtml] [无后缀文件 HTML 嗅探] [11-14：上传的「捏捏」是 HTML 但文件名没带后缀，raw 接口按后缀白名单查不到类型一律 415，工作流页打不开渲染；后缀不认识时读文件头 1KB 判别（容忍 BOM），像 HTML 就按 text/html 给出，配合前端 phone-wf.js·isHtmlContent 的同款判定；只影响原先 415 的文件，已有后缀类型不受影响] [注释时间 2026-11-14]
function wfSniffHtml(f, st) {
  let fh = null;
  try {
    if (!st || !st.size) return null;
    fh = fs.openSync(f, "r");
    const buf = Buffer.alloc(Math.min(1024, st.size));
    fs.readSync(fh, buf, 0, buf.length, 0);
    if (/^\uFEFF?\s*(<!doctype\s+html|<html[\s>])/i.test(buf.toString("utf8"))) return WF_RAW_TYPES.html;
  } catch (e) {} finally {
    /* [位置:routes/workflow-files.js·wfSniffHtml] [名称:嗅探失败也要关 fd] [需求:11-15 健壮性——原来 openSync 后 readSync 抛错（权限/句柄异常）不会 closeSync，工作流页每刷一次就漏一个 fd，进程慢慢耗尽句柄；现在 try/finally 必关] [注释时间 2026-11-15] */
    if (fh !== null) { try { fs.closeSync(fh); } catch (_) {} }
  }
  return null;
}

function wfInjectFit(html) {
  if (/<style[^>]*data-wf-raw-fit/i.test(html)) return html;
  const tag = "<style data-wf-raw-fit>" + WF_FIT_CSS + "</style>";
  const lower = html.toLowerCase();
  const headEnd = lower.lastIndexOf("</head>");
  if (headEnd >= 0) return html.slice(0, headEnd) + tag + html.slice(headEnd);
  const bodyAt = lower.indexOf("<body");
  if (bodyAt >= 0) { const gt = html.indexOf(">", bodyAt); if (gt >= 0) return html.slice(0, gt + 1) + tag + html.slice(gt + 1); }
  return tag + html;
}
app.get("/admin/workflow/raw/*", { preHandler: basicAuth }, async (req, reply) => {
  let rel = req.params["*"] || "";
  // fastify 对通配参数已做过一次 decode；这里 try-decode 一次是兜底直连场景，解码失败（文件名带字面 %）保持原值
  try { rel = decodeURIComponent(rel); } catch (e) {}
  const f = wfSafe(rel);
  if (!f || f === WF_DIR) return reply.code(400).send("路径不对");
  let st; try { st = fs.statSync(f); } catch (e) { return reply.code(404).send("读不到"); }
  if (st.isDirectory()) return reply.code(400).send("这是目录");
  const type = WF_RAW_TYPES[path.extname(f).slice(1).toLowerCase()] || wfSniffHtml(f, st);
  if (!type) return reply.code(415).send("这个后缀不支持预览");
  reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  // html：读入注入小屏适配 CSS 后整体返回（上限 4MB，超了不注入按原样流式；现网报告/设计稿都在百 KB 级）
  if (type.startsWith("text/html") && st.size <= 4 * 1024 * 1024) {
    let html;
    try { html = fs.readFileSync(f, "utf8"); } catch (e) { return reply.code(500).send("读不到"); }
    reply.header("Content-Type", type);
    return reply.send(wfInjectFit(html));
  }
  reply.header("Content-Type", type);
  reply.header("Content-Length", st.size);
  return reply.send(fs.createReadStream(f));
});

// [位置:server.js·/admin/workflow/dl] [工作流文件下载接口] [11-01：工作流页长按文件加「下载到手机」（前端 phone-wf.js·长按菜单 dl 分支）；raw 接口是给预览用的——后缀白名单外直接 415、html 响应会注入适配 CSS（下下来就不是原文件）、响应没有附件头，都不适合做下载；本接口任意后缀原样流式发送（不限大小、不整读进内存），Content-Disposition: attachment 让浏览器走系统下载进「下载」目录，中文名按 RFC 5987 编码（filename*）+ ASCII 兜底（filename）不乱码；只读、不进撤销栈、凭据同 basicAuth] [注释时间 2026-11-01]
app.get("/admin/workflow/dl", { preHandler: basicAuth }, async (req, reply) => {
  const f = wfSafe((req.query || {}).path);
  if (!f || f === WF_DIR) return reply.code(400).send("路径不对");
  let st; try { st = fs.statSync(f); } catch (e) { return reply.code(404).send("读不到"); }
  if (st.isDirectory()) return reply.code(400).send("这是目录");
  const nm = path.basename(f);
  const ascii = nm.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_") || "file";
  const type = WF_RAW_TYPES[path.extname(f).slice(1).toLowerCase()] || "application/octet-stream";
  reply.header("Content-Type", type);
  reply.header("Content-Length", st.size);
  reply.header("Content-Disposition", "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(nm));
  reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  return reply.send(fs.createReadStream(f));
});

app.post("/admin/workflow/save", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const f = wfSafe(b.path);
  if (!f || f === WF_DIR) return reply.code(400).send({ ok: false, msg: "路径不对" });
  if (WF_BIN_EXT.test(f)) return reply.code(400).send({ ok: false, msg: "二进制文件不支持编辑" });
  try {
    const next = String(b.content == null ? "" : b.content);
    let old = null;
    try { old = fs.readFileSync(f, "utf8"); } catch (e) {}
    if (old != null && old === next) return { ok: true, same: true };
    if (old != null) {
      fs.mkdirSync(WF_BAK, { recursive: true });
      const bak = wfBakPath(wfRel(f), false);
      fs.writeFileSync(bak, old);
      wfUndoPush({ t: "save", p: wfRel(f), bak });
    }
    atomicWriteFileSync(f, next);
    return { ok: true };
  } catch (e) { return reply.code(500).send({ ok: false, msg: "没存上：" + e.message }); }
});

app.post("/admin/workflow/create", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const f = wfSafe(b.path);
  if (!f || f === WF_DIR) return reply.code(400).send({ ok: false, msg: "路径不对" });
  if (WF_BIN_EXT.test(f)) return reply.code(400).send({ ok: false, msg: "这个后缀不支持建" });
  try {
    if (fs.existsSync(f)) return reply.code(409).send({ ok: false, msg: "已经有同名的了" });
    if (b.isDir) fs.mkdirSync(f);
    else atomicWriteFileSync(f, String(b.content || ""));
    wfUndoPush({ t: "create", p: wfRel(f), isDir: !!b.isDir });
    return { ok: true };
  } catch (e) { return reply.code(500).send({ ok: false, msg: "没建上：" + e.message }); }
});

// [位置:routes/workflow-files.js·wfUploadFinalize] [上传落盘公共流程] [11-10：原 upload（JSON+base64）的「重名自动加 (2) → 落盘 → 进撤销栈」抽成公共函数，新直传端点 upload-raw 复用，两通道行为一致；writer 收到最终绝对路径负责实际写入，返回字节数；返回 {code,msg} 时由调用方转 HTTP 错误] [注释时间 2026-11-10]
async function wfUploadFinalize(dirAbs, dir, name, writer) {
  if (!name || name === "." || name === "..") return { code: 400, msg: "文件名不对" };
  try {
    if (!fs.statSync(dirAbs).isDirectory()) return { code: 400, msg: "目标不是文件夹" };
  } catch (e) { return { code: 400, msg: "目标文件夹不存在" }; }
  const ext = path.extname(name), base = ext ? name.slice(0, -ext.length) : name;
  let final = name, n = 1, f = wfSafe(path.join(String(dir || ""), final));
  while (f && fs.existsSync(f) && n < 100) { n++; final = base + " (" + n + ")" + ext; f = wfSafe(path.join(String(dir || ""), final)); }
  if (!f || fs.existsSync(f)) return { code: 409, msg: "同名的太多了" };
  try {
    const size = await writer(f);
    wfUndoPush({ t: "create", p: wfRel(f), isDir: false });
    return { ok: true, name: final, path: wfRel(f), size, renamed: final !== name };
  } catch (e) { return { code: 500, msg: "没传上：" + e.message }; }
}

// [位置:routes/workflow-files.js·/admin/workflow/upload] [工作流上传文件（JSON+base64 小文件通道）] [10-28：新建菜单加「上传文件」，把手机里选的文件传进当前浏览的文件夹；同名自动改成「名字 (2).后缀」不覆盖；进撤销栈（撤销=删掉）；落盘流程已收拢到 wfUploadFinalize，行为不变] [注释时间 2026-11-10]
app.post("/admin/workflow/upload", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const dirAbs = wfSafe(b.dir || "");
  if (!dirAbs) return reply.code(400).send({ ok: false, msg: "路径不对" });
  const name = path.basename(String(b.name || "").replace(/\\/g, "/")).trim();
  const buf = Buffer.from(String(b.data || ""), "base64");
  if (buf.length > 14 * 1024 * 1024) return reply.code(413).send({ ok: false, msg: "文件超过 14MB，传不了" });
  const r = await wfUploadFinalize(dirAbs, b.dir, name, (f) => new Promise((res, rej) => {
    try { fs.writeFileSync(f, buf, { flag: "wx" }); res(buf.length); } catch (e) { rej(e); }
  }));
  if (r && r.ok) return r;
  return reply.code((r && r.code) || 500).send({ ok: false, msg: (r && r.msg) || "没传上" });
});

// [位置:routes/workflow-files.js·/admin/workflow/upload-raw] [工作流上传文件（octet-stream 直传大文件通道）] [11-10：她要把 98MB 的 exe 传进「用户上传文件」，原 JSON+base64 通道（nginx 20m+base64 膨胀+前后端 14MB）传不了；新端点收 Content-Type: application/octet-stream 原始字节流（server.js·addContentTypeParser，fastify 5 自定义 parser 默认给 stream），边收边写临时文件、完成后 rename 落盘（同分区原子），不整读进内存；dir/name 走 query（前端 encodeURIComponent）；content-length 预检 + 流内计数双保险，超 200MB 掐断并删临时文件；客户端中途断开也删临时文件不残留；凭据/CSRF/撤销栈与 upload 一致] [注释时间 2026-11-10]
app.post("/admin/workflow/upload-raw", { preHandler: basicAuth }, async (req, reply) => {
  const q = req.query || {};
  const dirAbs = wfSafe(String(q.dir || ""));
  if (!dirAbs) return reply.code(400).send({ ok: false, msg: "路径不对" });
  const name = path.basename(String(q.name || "").replace(/\\/g, "/")).trim();
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > WF_UPLOAD_MAX) return reply.code(413).send({ ok: false, msg: "文件超过 200MB，传不了" });
  if (!req.body || typeof req.body.on !== "function") return reply.code(400).send({ ok: false, msg: "请求体不是字节流（Content-Type 要是 application/octet-stream）" });
  const r = await wfUploadFinalize(dirAbs, String(q.dir || ""), name, (f) => new Promise((res, rej) => {
    const tmp = f + ".wfupload-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".tmp";
    const clean = () => { try { fs.unlinkSync(tmp); } catch (e) {} };
    const out = fs.createWriteStream(tmp);
    let got = 0, settled = false;
    const done = (fn, val) => { if (settled) return; settled = true; fn(val); };
    req.body.on("data", (c) => {
      got += c.length;
      if (got > WF_UPLOAD_MAX) { req.body.destroy(); out.destroy(); clean(); done(rej, new Error("文件超过 200MB，传不了")); }
    });
    req.body.on("error", (e) => { out.destroy(); clean(); done(rej, e); });
    out.on("error", (e) => { req.body.destroy(); clean(); done(rej, e); });
    out.on("finish", () => { try { fs.renameSync(tmp, f); } catch (e) { clean(); return done(rej, e); } done(res, got); });
    req.body.pipe(out);
  }));
  if (r && r.ok) return r;
  return reply.code((r && r.code) || 500).send({ ok: false, msg: (r && r.msg) || "没传上" });
});

app.post("/admin/workflow/delete", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const f = wfSafe(b.path);
  if (!f || f === WF_DIR) return reply.code(400).send({ ok: false, msg: "路径不对" });
  try {
    if (!fs.existsSync(f)) return reply.code(404).send({ ok: false, msg: "已经不在了" });
    const isDir = fs.statSync(f).isDirectory();
    fs.mkdirSync(WF_BAK, { recursive: true });
    const bak = wfBakPath(wfRel(f), isDir);
    wfCopy(f, bak);
    fs.rmSync(f, { recursive: true });
    wfUndoPush({ t: "delete", p: wfRel(f), bak });
    return { ok: true };
  } catch (e) { return reply.code(500).send({ ok: false, msg: "没删掉：" + e.message }); }
});

// [位置:server.js·/admin/workflow/rename] [工作流文件/文件夹改名] [10-27：列表长按加「编辑文件名」；同目录内改名，防穿越/防重名/防改后缀；改名进撤销栈可撤回] [注释时间 2026-10-27]
app.post("/admin/workflow/rename", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const from = wfSafe(b.path);
  if (!from || from === WF_DIR) return reply.code(400).send({ ok: false, msg: "路径不对" });
  const name = String(b.name || "").trim();
  if (!name || name === "." || name === ".." || name.indexOf("/") >= 0 || name.indexOf("\\") >= 0) return reply.code(400).send({ ok: false, msg: "名字不对" });
  const to = wfSafe(path.join(path.dirname(path.relative(WF_DIR, from)), name));
  if (!to) return reply.code(400).send({ ok: false, msg: "名字不对" });
  try {
    if (!fs.existsSync(from)) return reply.code(404).send({ ok: false, msg: "已经不在了" });
    if (from === to) return { ok: true, same: true };
    if (fs.existsSync(to)) return reply.code(409).send({ ok: false, msg: "已经有同名的了" });
    if (WF_BIN_EXT.test(to) && !WF_BIN_EXT.test(from)) return reply.code(400).send({ ok: false, msg: "这个后缀不支持" });
    fs.renameSync(from, to);
    wfUndoPush({ t: "rename", from: wfRel(from), to: wfRel(to) });
    return { ok: true };
  } catch (e) { return reply.code(500).send({ ok: false, msg: "没改成：" + e.message }); }
});

// [位置:server.js·/admin/workflow/move] [工作流文件/文件夹移动] [10-28：列表长按加「移动到」，选目标文件夹挪过去；防穿越/防重名/防移进自己子目录；移动进撤销栈可撤回] [注释时间 2026-10-28]
app.post("/admin/workflow/move", { preHandler: basicAuth }, async (req, reply) => {
  const b = req.body || {};
  const nm = path.basename(String(b.path || ""));
  if (!nm || nm === "." || nm === "..") return reply.code(400).send({ ok: false, msg: "路径不对" });
  const from = wfSafe(b.path);
  const dir = wfSafe(b.dir || "");
  if (!from || from === WF_DIR || !dir) return reply.code(400).send({ ok: false, msg: "路径不对" });
  try {
    if (!fs.statSync(dir).isDirectory()) return reply.code(400).send({ ok: false, msg: "目标不是文件夹" });
  } catch (e) { return reply.code(400).send({ ok: false, msg: "目标文件夹不存在" }); }
  const to = wfSafe(path.join(String(b.dir || ""), nm));
  if (!to) return reply.code(400).send({ ok: false, msg: "路径不对" });
  try {
    if (!fs.existsSync(from)) return reply.code(404).send({ ok: false, msg: "已经不在了" });
    if (from === to) return { ok: true, same: true };
    if (fs.existsSync(to)) return reply.code(409).send({ ok: false, msg: "目标里已经有同名的了" });
    if (from === dir || (dir + path.sep).startsWith(from + path.sep)) return reply.code(400).send({ ok: false, msg: "不能移进自己里面" });
    fs.renameSync(from, to);
    wfUndoPush({ t: "move", from: wfRel(from), to: wfRel(to) });
    return { ok: true };
  } catch (e) { return reply.code(500).send({ ok: false, msg: "没移成：" + e.message }); }
});

app.post("/admin/workflow/undo", { preHandler: basicAuth }, async (req, reply) => {
  const st = wfUndoLoad();
  const op = st.pop();
  if (!op) return { ok: false, msg: "没有可撤销的操作" };
  try {
    // [位置:server.js·undo rename/move 分支] [10-28 改：移动与改名同用「rename 回去」的恢复逻辑，返回 topath 供前端改编辑器指向] [注释时间 2026-10-28]
    if (op.t === "rename" || op.t === "move") {
      const fr = wfSafe(op.from), to = wfSafe(op.to);
      if (!fr || !to) throw new Error("撤销目标路径不对");
      if (fs.existsSync(fr)) throw new Error("原名字已经被占用了");
      fs.renameSync(to, fr);
      wfUndoWrite(st);
      return { ok: true, msg: "已撤销：" + op.to + (op.t === "move" ? " 的移动" : " 的改名"), path: op.from, topath: op.to };
    }
    const f = wfSafe(op.p);
    if (!f) throw new Error("撤销目标路径不对");
    if (op.t === "save") atomicWriteFileSync(f, fs.readFileSync(op.bak, "utf8"));
    else if (op.t === "create") { if (fs.existsSync(f)) fs.rmSync(f, { recursive: true }); }
    else if (op.t === "delete") wfCopy(op.bak, f);
    else throw new Error("未知操作类型");
    wfUndoWrite(st);
    const act = { save: "的保存", create: "的新建", delete: "的删除" }[op.t] || "";
    return { ok: true, msg: "已撤销：" + op.p + act, path: op.p };
  } catch (e) {
    st.push(op); wfUndoWrite(st);
    return reply.code(500).send({ ok: false, msg: "没撤成：" + e.message });
  }
});
};
