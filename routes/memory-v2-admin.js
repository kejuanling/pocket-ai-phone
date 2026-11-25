"use strict";
// Memory V2 管理台路由：集合查看/编辑 + 聊天页入池 + 旧池形状映射视图（0919 管理台数据源切换；0920 删重要级/时间衰减）
// 依赖注入：admission = memory-admission 实例（可空）；baseDir = 项目根。

const path = require("path");
const { createStore } = require("../memory/memory-v2");
const v2vectors = require("../memory/memory-v2-vectors");
const embedClient = require("../utils/memory-embed-client");   /* 11-16 批1 D5：lastFailReason 给 similar-groups 的 503 带真实原因 */
const memoryPoolIo = require("../lib/memory-pool-io");

const KIND_MAP = { "关于她": "fact", "认账": "rule", "拓本": "fact", fact: "fact", rule: "rule", event: "event" }; // 旧池类名 → V2 kind（管理台表单仍传类名，落库前翻译；1002-14 删 quote/milestone，1005-19 加 event）

module.exports = function registerMemoryV2Admin(app, deps) {
  const { basicAuth, admission, baseDir } = deps;

  // 每请求新建 store 实例：memory-v2 惰性加载且写穿透，无跨请求缓存成本
  function store() {
    return createStore({ rootDir: baseDir, config: {} });
  }

  // V2 集合全量列表 + 统计
  app.get("/admin/memory-v2/entries", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const s = store();
      const items = s.list({}).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      const stats = { total: items.length, active: 0, superseded: 0, archived: 0, by_kind: {} };
      for (const it of items) {
        if (it.status === "active") stats.active++;
        else if (it.status === "superseded") stats.superseded++;
        else if (it.status === "archived") stats.archived++;
        stats.by_kind[it.kind] = (stats.by_kind[it.kind] || 0) + 1;
      }
      reply.send({ success: true, stats, items });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 旧池形状映射视图：管理台记忆池页数据源（0919 起前端显示 V2 数据）
  app.get("/admin/memory-v2/pool-view", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const s = store();
      const q = String(req.query.q || "").trim();
      const category = String(req.query.category || "").trim();
      const sort = String(req.query.sort || "recent");
      let mapped = s.list({}).map(e => ({
        id: e.id,
        content: e.text,
        category: e.kind,
        active: e.status === "active",
        pinned: !!e.anchor,
        sunk: e.status === "archived",
        updated_at: e.created_at,
        retrieval_count: 0, // V2 检索恒只读无计数（旧池污染字段的结构性根除）
        source: e.origin,
        status: e.status,
        // 1005-16：评估标签透传（judge/探针产出；未评估为 null，前端显示占位）
        worth: (typeof e.worth === "number") ? e.worth : null,
        worth_reason: e.worth_reason || null,
        volatility: e.volatility || null,
        volatility_reason: e.volatility_reason || null,
        // 1005-19：关键词/氛围透传（记忆池卡片 mpTagsHtml 渲染用；此前漏映射导致前端恒显示暂无关键词）
        triggers: Array.isArray(e.triggers) ? e.triggers : [],
        vibe: e.vibe || null,
      }));
      if (q) mapped = mapped.filter(x => x.content.includes(q));
      if (category) mapped = mapped.filter(x => x.category === category);
      // 0920 用户拍板：排序只留 最新(recent，默认)/最旧(oldest) 两种
      const dir = sort === "oldest" ? 1 : -1;
      mapped.sort((a, b) => dir * String(a.updated_at || "").localeCompare(String(b.updated_at || "")));
      const stats = {
        total: mapped.length,
        active: mapped.filter(x => x.active).length,
        pinned: mapped.filter(x => x.pinned).length,
        sunk: mapped.filter(x => x.sunk).length,
      };
      reply.send({ success: true, stats, items: mapped });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 相似分组（0919 第六个统计按钮）：活跃条目按语义向量聚类成组，供人工沉底重复条目。
  // 阈值 ?th= 可调（0.5-0.99，默认 0.85）；向量服务不可用时返回 503。
  app.get("/admin/memory-v2/similar-groups", { preHandler: basicAuth }, async (req, reply) => {
    try {
      let th = Number(req.query.th);
      if (!Number.isFinite(th)) th = 0.85;
      th = Math.min(0.99, Math.max(0.5, th));
      const s = store();
      const rows = s.list({ status: "active" });
      if (!rows.length) return reply.send({ success: true, threshold: th, group_count: 0, groups: [] });
      const ready = await v2vectors.ensureVectors(rows);
      /* [位置:routes/memory-v2-admin.js·similar-groups 503] [带出真实原因] [11-16 批1 D5：原来只回一句「向量服务暂不可用」，前端显示成「向量服务没开」；实际向量服务进程一直活着，503 多来自 embed 熔断（一次失败 60 秒冷却）或「没有可用 embedding 供应商」（硅基流动体验被停用后无其他 embeddings 服务商）；reason 供前端如实显示] [注释时间 2026-11-16] */
      if (!ready) return reply.code(503).send({ error: "向量服务暂不可用，请稍后重试", reason: embedClient.lastFailReason() || "" });
      v2vectors.pruneVectors(rows); // 全量行清理已消失 id（检索等子集调用不做清理，防误删）
      const byId = new Map(rows.map((r) => [r.id, r]));
      const groups = v2vectors.similarGroups(rows, th).map((g) => ({
        max_sim: g.max_sim,
        items: g.ids.map((id) => {
          const e = byId.get(id);
          return { id: e.id, text: e.text, kind: e.kind, created_at: e.created_at };
        }),
      }));
      reply.send({ success: true, threshold: th, group_count: groups.length, groups });
    } catch (err) {
      console.error("[GET /admin/memory-v2/similar-groups] error:", err.message);
      reply.code(500).send({ error: err.message });
    }
  });

  // 新增/编辑入口。
  // 管理台表单（direct:true）=人工即准入，直接建条目（P1 直通，不经 review）；
  // 聊天页长按入池（无 direct）=manual_review，走流水线进 review 队列人工裁决。
  app.post("/admin/memory-v2/entries", { preHandler: basicAuth }, async (req, reply) => {
    try {
      if (!admission) return reply.code(503).send({ error: "Memory V2 admission 未初始化" });
      const b = req.body || {};
      const content = String(b.content || "").trim();
      if (!content) return reply.code(400).send({ error: "content 必填" });

      if (b.direct === true) {
        /* [位置:routes/memory-v2-admin.js·POST entries direct] [手动新增直通入库] [需求:11-06：记忆池没有新增入口，要能自己写一条；手写的就是要的，直通不让人再审自己；但池里已经有一条很像的先提示一句（b.force=true 表示确认要加），入库成功后后台静默补评分；顺带支持 event 与关键词（原报错文案停在只收 fact/rule 的旧年代）] [注释时间 2026-11-06] */
        const kind = KIND_MAP[String(b.category || "").trim()] || null;
        if (!kind) return reply.code(400).send({ error: "category 必须是 fact/rule/event" });
        // 查重：不硬拦，只回 409 + 相似条目，前端弹一句"还加吗"；向量服务慢/挂了就放行（2.5s 上限）
        if (b.force !== true && admission && typeof admission.checkSimilar === "function") {
          let similar = [];
          try {
            similar = await Promise.race([
              admission.checkSimilar(content, 0.85),
              new Promise(function (res) { setTimeout(function () { res([]); }, 2500); }),
            ]);
          } catch (_e) { similar = []; }
          if (Array.isArray(similar) && similar.length) {
            return reply.code(409).send({ success: false, error: "similar", similar: similar });
          }
        }
        const createInput = {
          text: content, kind,
          origin: "manual",
          provenance: { method: "admin_form", channel: "manual_form" },
        };
        if (Array.isArray(b.triggers) && b.triggers.length) createInput.triggers = b.triggers;
        if (b.search_enabled !== undefined) createInput.search_enabled = !!b.search_enabled;   // 11-08：新增表单的「参与检索」开关（缺省由 _buildEntry 按 kind 取默认）
        const r2 = store().create(createInput);
        if (!r2.ok) return reply.code(400).send({ error: r2.error });
        if (b.pinned === true) store().updateFields(r2.entry.id, { anchor: true });
        /* [位置:routes/memory-v2-admin.js·POST entries direct 评分] [手动直通改排队攒批评分] [需求:11-10：静默单评（scoreEntry）下线，统一塞评分任务进门卫攒批队列——带相似检索、评完自动回写标签并移卡；失败不打扰入库结果] [注释时间 2026-11-10] */
        if (admission && typeof admission.enqueueManualScore === "function") {
          try { admission.enqueueManualScore(r2.entry); } catch (_e) {}
        }
        const fresh = store().get(r2.entry.id) || r2.entry;
        return reply.send({ success: true, action: "admit_new", id: r2.entry.id, entry: fresh });
      }

      const r = await admission.submitManual(
        { content, category: b.category, kind: b.kind, speaker: b.speaker, msg_time: b.msg_time },
        { sessionId: String(b.session_id || "").trim() || null },
        "manual_review"
      );
      if (r.action === "reject") {
        return reply.send({ success: false, action: "reject", reasons: (r.validation && r.validation.reasons) || [] });
      }
      reply.send({
        success: true, action: r.action, mode: r.mode,
        queue_id: r.queue_id || null, entry_id: r.entry_id || null,
        note: r.action === "review" ? "已进 review 队列，待人工裁决后入库" : undefined,
      });
    } catch (err) {
      console.error("[POST /admin/memory-v2/entries] error:", err.message);
      reply.code(500).send({ error: err.message });
    }
  });

  // 编辑（管理台表单）：content/category/pinned → text/kind/anchor（importance/priority 已删）
  app.put("/admin/memory-v2/entries/:id", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = req.body || {};
      const patch = {};
      if (b.content != null) patch.text = String(b.content);
      if (b.category != null) {
        const kind = KIND_MAP[String(b.category).trim()];
        if (!kind) return reply.code(400).send({ error: "category 非法（fact/rule/event）" });
        patch.kind = kind;
      }
      if (b.pinned != null) patch.anchor = !!b.pinned;
      /* [位置:routes/memory-v2-admin.js·PUT entries] [编辑接口接受关键词] [需求:11-06：记忆池详情长按改关键词要能落库；原来只收 content/category/pinned，triggers 永远进不去] [注释时间 2026-11-06] */
      if (b.triggers !== undefined) patch.triggers = b.triggers;
      if (b.search_enabled !== undefined) patch.search_enabled = !!b.search_enabled;   /* 11-08：编辑弹层的「参与检索」开关落库 */
      const r = store().updateFields(req.params.id, patch);
      if (!r.ok) return reply.code(400).send({ error: r.error });
      reply.send({ success: true, entry: r.entry });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 记忆池硬删除：管理台「彻底删除」按钮用（basicAuth；不可恢复，区别于 archive 软沉底）
  // [2026-11-03 server.js 拆分批 4c：从 server.js 并入本文件，原用 require("./memory/memory-v2").createStore({ rootDir: __dirname, config: {} })，现用本文件已有的 createStore + baseDir，同一调用]
  app.post("/admin/memory-v2/entries/:id/delete", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const r = createStore({ rootDir: baseDir, config: {} }).hardDelete(req.params.id);
      if (!r.ok) return reply.code(404).send({ error: r.error });
      reply.send({ success: true });
    } catch (err) {
      console.error("[POST /admin/memory-v2/entries/:id/delete] error:", err.message);
      reply.code(500).send({ error: err.message });
    }
  });

  // 状态机操作：archive（沉底/删除语义，可恢复）| revive（归档恢复）
  app.post("/admin/memory-v2/entries/:id/status", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const action = String((req.body || {}).action || "");
      let r;
      if (action === "archive") r = store().updateStatus(req.params.id, "archived", { reason: "archived" });
      else if (action === "revive") r = store().updateStatus(req.params.id, "active");
      else return reply.code(400).send({ error: "action 必须是 archive/revive" });
      if (!r.ok) return reply.code(400).send({ error: r.error });
      reply.send({ success: true, entry: r.entry });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // 置顶（anchor 注入层标记）
  app.post("/admin/memory-v2/entries/:id/pin", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const r = store().updateFields(req.params.id, { anchor: !!((req.body || {}).pinned) });
      if (!r.ok) return reply.code(400).send({ error: r.error });
      reply.send({ success: true, entry: r.entry });
    } catch (err) {
      reply.code(500).send({ error: err.message });
    }
  });

  // ---- 导出 / 导入（清洗记忆池用；逻辑在 lib/memory-pool-io.js，2026-10-11）----
  // 导出：只导出 active；category = all / fact / rule / event
  app.get("/admin/memory-v2/export", { preHandler: basicAuth }, async (req, reply) => {
    try {
      const out = memoryPoolIo.exportActive(store(), req.query && req.query.category);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      reply.header("Content-Disposition", 'attachment; filename="memory_pool_' + out.category + "_" + stamp + '.json"');
      reply.send(out);
    } catch (err) {
      reply.code(400).send({ error: err.message });
    }
  });

  // 导入：dry_run 缺省或 true = 只预览（不写入任何数据）；dry_run === false 才真正写入（写入前先备份集合文件）
  let importing = false;
  app.post("/admin/memory-v2/import", { preHandler: basicAuth, bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (importing) return reply.code(409).send({ error: "另一个导入正在进行，请稍后再试" });
    importing = true;
    try {
      const b = req.body || {};
      const entries = memoryPoolIo.extractEntries(b);
      const dry = b.dry_run !== false;
      const result = dry ? memoryPoolIo.previewImport(store(), entries) : memoryPoolIo.applyImport(store(), entries);
      if (!dry) {
        console.log("[memory-pool-io] 导入完成:", JSON.stringify({ total: result.total, failed: result.failed, update: result.update, create: result.create, archive: result.archive, revive: result.revive, unchanged: result.unchanged }), "备份:", result.backup);
      }
      reply.send({ success: true, dry_run: dry, result });
    } catch (err) {
      console.error("[memory-pool-io] 导入出错:", err.message);
      reply.code(400).send({ error: err.message });
    } finally {
      importing = false;
    }
  });
};
