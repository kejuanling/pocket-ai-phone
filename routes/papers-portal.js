"use strict";

// 小手机「笔记本」页的读写接口（2026-10-22 批 B）。
// 与 AI 工具走的 /internal/paper* 分开：这里是用户视角——能看到关键词（tags）和系统维护的「笔记本目录」笔记，
// 能新增 / 改 / 删；用网关口令（Bearer GATEWAY_API_KEY / X-API-Key）或管理台登录 cookie 放行（auth 由 server.js 注入，同 /xie-diary/api）。
// 数据只有一份：data/papers.json（lib/paper-store.js），AI 的 notebook 工具读写同一份，用户和 AI 写的笔记完全同款。
const fs = require("fs");
const path = require("path");

module.exports = function registerPapersPortal(app, deps) {
  const { auth, baseDir } = deps;
  const papers = require("../lib/papers");
  const notebooks = require("../lib/notebooks");
  const pre = { preHandler: auth };

  function intId(v) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  function nbBaseOf(req) {
    const nb = (req.query && req.query.nb) || (req.body && req.body.nb) || "default";
    return notebooks.resolveBaseDir(baseDir, nb) || baseDir;
  }

  /* [位置:routes/papers-portal.js·/papers/api/notebooks*] [多本笔记本列表/新建/重命名/删除] [11-25：桌面笔记本 App 顶部切本与预设绑定共用] [注释时间 2026-11-25] */
  app.get("/papers/api/notebooks", pre, async (req, reply) => {
    try { reply.send({ notebooks: notebooks.list(baseDir) }); }
    catch (err) { reply.code(500).send({ error: err.message }); }
  });
  app.post("/papers/api/notebooks/add", pre, async (req, reply) => {
    try {
      const r = notebooks.create(baseDir, (req.body || {}).name);
      if (!r.ok) return reply.code(400).send({ error: r.error });
      reply.send({ success: true, notebook: r.notebook });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });
  app.post("/papers/api/notebooks/rename", pre, async (req, reply) => {
    try {
      const b = req.body || {};
      const r = notebooks.rename(baseDir, b.id, b.name);
      if (!r.ok) return reply.code(400).send({ error: r.error });
      reply.send({ success: true, notebook: r.notebook });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });
  app.post("/papers/api/notebooks/delete", pre, async (req, reply) => {
    try {
      const r = notebooks.remove(baseDir, (req.body || {}).id);
      if (!r.ok) return reply.code(400).send({ error: r.error });
      reply.send({ success: true, id: r.id });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  // 列表（q 为空 = 全部，目录笔记置顶；有 q = 搜索，标题 / 摘要 / 原因 / 关键词 / 正文）
  app.get("/papers/api/notes", pre, async (req, reply) => {
    try {
      const q = String((req.query || {}).q || "").trim();
      const res = papers.withBaseDir(nbBaseOf(req), () => ({
        notes: q ? papers.portalSearch(q) : papers.portalList(),
        folders: papers.portalFoldersBrief(),
        q,
      }));
      reply.send(res);
    } catch (err) {
      console.error("[papers-portal] 列表失败:", err);
      reply.code(500).send({ error: err.message });
    }
  });

  app.get("/papers/api/note", pre, async (req, reply) => {
    try {
      const id = intId((req.query || {}).id);
      const n = id ? papers.withBaseDir(nbBaseOf(req), () => papers.portalRead(id)) : null;
      if (!n) return reply.code(404).send({ error: "笔记不存在" });
      reply.send(n);
    } catch (err) {
      console.error("[papers-portal] 读取失败:", err);
      reply.code(500).send({ error: err.message });
    }
  });

  app.post("/papers/api/note/add", pre, async (req, reply) => {
    try {
      const b = req.body || {};
      const r = papers.withBaseDir(nbBaseOf(req), () => papers.portalAdd({ content: b.content, title: b.title, summary: b.summary, reason: b.reason, tags: b.tags, folder: b.folder }));
      if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "保存失败" });
      /* [位置:papers-portal.js·note/add 回包] [拆篇要回 parts] [11-16：正文超 2 万字后端自动拆成多篇，小手机要按 parts 提示「拆成了 N 篇」，只回一个 id 前端不知道] [注释时间 2026-11-16] */
      reply.send({ success: true, id: r.id, ids: r.ids || [r.id], parts: r.parts || 1, created_at: r.created_at });
    } catch (err) {
      console.error("[papers-portal] 新增失败:", err);
      reply.code(500).send({ error: err.message });
    }
  });

  app.post("/papers/api/note/update", pre, async (req, reply) => {
    try {
      const b = req.body || {};
      const id = intId(b.id);
      if (!id) return reply.code(400).send({ error: "缺 id" });
      const r = papers.withBaseDir(nbBaseOf(req), () => papers.portalUpdate({ id, content: b.content, title: b.title, summary: b.summary, reason: b.reason, tags: b.tags, folder: b.folder }));
      if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "保存失败" });
      reply.send({ success: true, id, ids: r.ids || [id], parts: r.parts || 1, unchanged: !!r.unchanged, updated_at: r.updated_at });
    } catch (err) {
      console.error("[papers-portal] 修改失败:", err);
      reply.code(500).send({ error: err.message });
    }
  });

  app.post("/papers/api/note/delete", pre, async (req, reply) => {
    try {
      const id = intId((req.body || {}).id);
      if (!id) return reply.code(400).send({ error: "缺 id" });
      const r = papers.withBaseDir(nbBaseOf(req), () => papers.portalDelete(id));
      if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "删除失败" });
      reply.send({ success: true, id });
    } catch (err) {
      console.error("[papers-portal] 删除失败:", err);
      reply.code(500).send({ error: err.message });
    }
  });

  // 文件夹与移动（10-28 笔记本文件管理化）：POST note/move {id, folder} · folder/add {path} · folder/rename {path, name} · folder/delete {path}（只能删空的）
  function folderRoute(url, fn, label) {
    app.post(url, pre, async (req, reply) => {
      try {
        const r = papers.withBaseDir(nbBaseOf(req), () => fn(req.body || {}));
        if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || label + "失败" });
        reply.send(Object.assign({ success: true }, r));
      } catch (err) {
        console.error("[papers-portal] " + label + "失败:", err);
        reply.code(500).send({ error: err.message });
      }
    });
  }
  folderRoute("/papers/api/note/move", b => { const id = intId(b.id); return id ? papers.portalMove(id, b.folder) : { ok: false, error: "缺 id" }; }, "移动");
  folderRoute("/papers/api/folder/add", b => papers.portalFolderAdd(b.path), "新建文件夹");
  folderRoute("/papers/api/folder/rename", b => papers.portalFolderRename(b.path, b.name), "重命名");
  folderRoute("/papers/api/folder/delete", b => papers.portalFolderDelete(b.path), "删除文件夹");
  folderRoute("/papers/api/folder/summary", b => papers.portalFolderSummary(b.path, b.summary), "编辑摘要");
  // 手动重写「笔记本目录」（阅读页右上角刷新按钮，10-29）：正常增删改本来就会自动重写，这是兜底
  folderRoute("/papers/api/index/refresh", () => papers.portalIndexRefresh(), "刷新目录");
  /* [位置:routes/papers-portal.js·note/pin] [手机置顶/取消置顶] [11-02：长按笔记菜单置顶；置顶的笔记列表排最前、名称带·已置顶，全文进上下文 Pinned Notes 块（重建快照时更新）] [注释时间 2026-11-02] */
  folderRoute("/papers/api/note/pin", b => { const id = intId(b.id); return id ? papers.pinPaper(id, b.pinned) : { ok: false, error: "缺 id" }; }, "置顶");
  /* [位置:routes/papers-portal.js·note/index-show] [文件夹内单篇笔记是否在目录中显示] [11-21：文件夹在目录中默认折叠，长按文件夹内笔记可单独开启/关闭是否在所属文件夹行下显示] [注释时间 2026-11-21] */
  folderRoute("/papers/api/note/index-show", b => { const id = intId(b.id); return id ? papers.setShowInIndex(id, b.show) : { ok: false, error: "缺 id" }; }, "目录显示");

  /* [位置:routes/papers-portal.js·notebook-meta/prompt] [笔记本摘要与关键词提示词读写/恢复默认] [11-21：笔记本设置页点开编辑，与 image-desc/prompt 同款协议] [注释时间 2026-11-21] */
  const nbMeta = () => require("../lib/notebook-meta");
  app.get("/admin/notebook-meta/prompt", pre, async (req, reply) => reply.send(nbMeta().adminGet()));
  app.post("/admin/notebook-meta/prompt", pre, async (req, reply) => {
    try { nbMeta().adminSave(req.body || {}); reply.send({ ok: true }); }
    catch (e) { reply.code(400).send({ ok: false, error: e.message }); }
  });
  app.delete("/admin/notebook-meta/prompt", pre, async (req, reply) => { nbMeta().adminReset(); reply.send({ ok: true }); });

  // 本机笔记迁入：body = { notes: [{ ts, title, content, tags }], raw: "<ph.note.v2 原文>" }。
  // 先把 raw 原样落一份到 data/backups/（迁入前备份），再逐条写入；幂等（同一个 ts 不会重复入库）。
  app.post("/papers/api/note/import", pre, async (req, reply) => {
    try {
      const b = req.body || {};
      const notes = Array.isArray(b.notes) ? b.notes.slice(0, 500) : [];
      if (!notes.length) return reply.send({ success: true, added: 0, skipped: 0, ids: [] });
      try {
        const dir = path.join(baseDir, "data", "backups");
        fs.mkdirSync(dir, { recursive: true });
        const raw = typeof b.raw === "string" && b.raw.length < 2000000 ? b.raw : JSON.stringify(notes);
        fs.writeFileSync(path.join(dir, "phone-notes-import-" + Date.now() + ".json"), raw, "utf8");
      } catch (e) {
        // 备份写不下就不迁，免得丢了原文
        console.error("[papers-portal] 迁入前备份失败，放弃迁入:", e.message);
        return reply.code(500).send({ error: "迁入前备份失败：" + e.message });
      }
      const r = papers.portalImport(notes);
      reply.send({ success: true, added: r.added, skipped: r.skipped, ids: r.ids });
    } catch (err) {
      console.error("[papers-portal] 迁入失败:", err);
      reply.code(500).send({ error: err.message });
    }
  });
};
