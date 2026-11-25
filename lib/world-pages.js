"use strict";
/* [位置:lib/world-pages.js] [小世界页面清单] [10-24：手机「我的 → 小世界」要列出他用 world 工具摆在 little-world/apps/world/ 下的页面。
   这里只读目录：一个页面 = 一个带 index.html 的目录，或根下的 .html 文件（根上的 index.html 是占位门牌，不算）；
   标题取 <title>，描述取 <meta name="description">；不跟符号链接、不读隐藏项；最多找三层、最多 200 个。
   注意区分：这是 AI 的 world 沙盒（工具 world_*，页面经 nginx /world/ 直出）；旧的「小世界·月下」门户是 workspace/index.html 那份静态页，和这里无关。] [注释时间 2026-10-24] */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "little-world", "apps", "world");
const MAX = 200;

// [位置:lib/world-pages.js·head] [读页面头部 8KB 取 title/description] [11-15 健壮性：原实现 openSync 后 readSync 抛错（对目录/EIO/竞态）就不会 closeSync，手机「小世界」每列一次清单漏一个 fd，进程慢慢耗尽句柄；现在 let fh + try/finally 必关，失败仍返回空串，只影响该条标题/描述，清单条数与接口形状不变（同 routes/workflow-files.js·wfSniffHtml 的写法）] [注释时间 2026-11-15]
function head(file) {
  let fh = null;
  try {
    fh = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192), n = fs.readSync(fh, buf, 0, 8192, 0);
    return buf.slice(0, n).toString("utf8");
  } catch (e) { return ""; } finally {
    if (fh !== null) { try { fs.closeSync(fh); } catch (_) {} }
  }
}
function unent(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function info(file) {
  const h = head(file);
  const t = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const d = (h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1]
    || (h.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1];
  return { title: unent(t).slice(0, 60), desc: unent(d).slice(0, 80) };
}
function walk(dir, rel, depth, out) {
  let names;
  try { names = fs.readdirSync(dir).sort(); } catch (e) { return; }
  for (const name of names) {
    if (out.length >= MAX) return;
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(full); } catch (e) { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      const idx = path.join(full, "index.html");
      let ist = null;
      try { ist = fs.lstatSync(idx); } catch (e) {}
      if (ist && ist.isFile()) {
        const i = info(idx);
        out.push({ path: rel + name + "/", title: i.title || name, desc: i.desc, mtime: ist.mtime.toISOString() });
      } else if (depth < 3) walk(full, rel + name + "/", depth + 1, out);
    } else if (st.isFile() && /\.html?$/i.test(name) && name !== "index.html") {
      const i = info(full);
      out.push({ path: rel + name, title: i.title || name.replace(/\.html?$/i, ""), desc: i.desc, mtime: st.mtime.toISOString() });
    }
  }
}
// [位置:lib/world-pages.js·list] [名称:清单根目录可注入] [需求:测试要拿临时目录当 little-world/apps/world 造页（含坏页）验 fd，加一个可选 rootDir；线上 server.js 不带参，走 ROOT，行为不变] [注释时间 2026-11-15]
function list(rootDir) {
  const out = [];
  walk(rootDir || ROOT, "", 1, out);
  out.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
  return out;
}
module.exports = { list, ROOT };
