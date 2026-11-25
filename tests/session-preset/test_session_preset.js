"use strict";
// POST /v1/sessions/from-preset：一次性用预设建会话（routes/session-preset.js）。单项接口用记录型假路由替身，工具走真 routes/session-mcp。
// 运行：node tests/session-preset/test_session_preset.js
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSessionCfg } = require("../../lib/session-cfg");

function setup(presets, failing) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "spreset-"));
  fs.mkdirSync(path.join(base, "config")); fs.mkdirSync(path.join(base, "data"), { recursive: true });
  fs.writeFileSync(path.join(base, "config", "chat-settings.json"), JSON.stringify({ cfg: { sess_presets: presets } }));
  fs.writeFileSync(path.join(base, "config", "mcp-servers.json"), JSON.stringify({ servers: [] }));
  const app = require("fastify")();
  const calls = [];
  const rec = (name) => async (req, reply) => {
    calls.push({ name, url: req.url, body: req.body, cookie: req.headers.cookie, csrf: req.headers["x-csrf-token"] });
    if (failing && failing.indexOf(name) >= 0) return reply.code(400).send({ error: name + " 失败了" });
    return { ok: true };
  };
  app.post("/v1/sessions/:id/cross-inject", rec("跨窗口"));
  app.post("/v1/sessions/:id/model-provider", rec("模型"));
  app.post("/v1/sessions/:id/time-tag-to-ai", rec("时间缀"));
  app.put("/admin/session-prompts", rec("人设"));
  app.post("/admin/context-compaction/config", rec("状态机模型"));
  app.post("/admin/context-compaction/prompts", rec("状态机提示词"));
  require("../../routes/session-mcp")(app, { basicAuth: async () => {}, baseDir: base });   // 真的工具规则接口
  // 状态机提示词清单用假的（不碰线上 prompts 文件）：只有 prm_a 这一套
  require("../../routes/session-preset")(app, { baseDir: base, conversationState: { listPrompts: () => [{ id: "prm_a", name: "精简版" }] } });
  return { app, base, calls, cfg: createSessionCfg(base) };
}
const full = { id: "sp_full", name: "全配置", av: "/uploads/a.png", ps: "pb_1", md: "prov1|model-x|v2", style: "min", tt: false, xw: { on: false, blocks: ["core_identity"] },
  mcp_mode: "s", mcp_rules: { v: 1, rest: "global", servers: { a: { def: "on", except: ["x"] } } } };
const post = (app, payload, headers) => app.inject({ method: "POST", url: "/v1/sessions/from-preset", headers: Object.assign({ "content-type": "application/json" }, headers || {}), payload: JSON.stringify(payload) });

test("全配置预设：按顺序配好 6 项，转发登录凭据，头像/主题/规则落到会话配置", async () => {
  const { app, calls, cfg } = setup([full]);
  const r = await post(app, { preset_id: "sp_full", session_id: "s_mvqixcfo_e5xbqj" }, { cookie: "admin_session=abc", "x-csrf-token": "tok" });
  const j = JSON.parse(r.body);
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(j.applied, ["跨窗口", "人设", "模型", "时间缀", "工具", "头像和主题"]);
  assert.deepStrictEqual(j.failed, []);
  assert.deepStrictEqual(calls.map(c => c.name), ["跨窗口", "人设", "模型", "时间缀"], "跨窗口必须第一个");
  assert.deepStrictEqual(calls[0].body, { enabled: false, inject_blocks: ["core_identity"] });
  assert.deepStrictEqual(calls[2].body, { model_provider_id: "prov1", model_name: "model-x|v2" });
  assert.deepStrictEqual(calls[1].body, { set: { s_mvqixcfo_e5xbqj: "pb_1" }, unset: [] });
  assert.strictEqual(calls[0].cookie, "admin_session=abc"); assert.strictEqual(calls[0].csrf, "tok");
  assert.deepStrictEqual(cfg.readMcpRules("s_mvqixcfo_e5xbqj"), { v: 1, rest: "global", servers: { a: { def: "on", except: ["x"] } } });
  assert.deepStrictEqual(cfg.readLook("s_mvqixcfo_e5xbqj"), { avatar: "/uploads/a.png", style: "min" });
  assert.strictEqual(j.avatar, "/uploads/a.png");
});

test("状态机模型/提示词：落到会话配置，套被删了就静默跳过", async () => {
  const p = { id: "sp_cmp", name: "带状态机", xw: { on: true }, cmp_model: "prov1|model-z", cmp_prompt: "prm_a" };
  const t = setup([p]);
  const j = JSON.parse((await post(t.app, { preset_id: "sp_cmp", session_id: "s_mvqixcfo_dddddd" })).body);
  assert.strictEqual(j.ok, true);
  assert.ok(j.applied.indexOf("状态机模型") >= 0);
  assert.ok(j.applied.indexOf("状态机提示词") >= 0);
  assert.deepStrictEqual(j.failed, []);
  const mc = t.calls.filter(c => c.name === "状态机模型")[0];
  assert.match(mc.url, /\/admin\/context-compaction\/config\?session_id=s_mvqixcfo_dddddd$/);
  assert.deepStrictEqual(mc.body, { compaction_model_provider: "prov1", compaction_model: "model-z" });
  const mp = t.calls.filter(c => c.name === "状态机提示词")[0];
  assert.deepStrictEqual(mp.body, { action: "select", id: "prm_a" });

  const gone = { id: "sp_cmp2", name: "引用已删", xw: { on: true }, cmp_model: "__role__", cmp_prompt: "prm_gone" };
  const t2 = setup([gone]);
  const j2 = JSON.parse((await post(t2.app, { preset_id: "sp_cmp2", session_id: "s_mvqixcfo_eeeeee" })).body);
  assert.strictEqual(j2.ok, true);
  assert.deepStrictEqual(j2.failed, [], "套被删不算失败");
  assert.strictEqual(j2.applied.indexOf("状态机提示词"), -1, "套被删就跳过这一步");
  assert.deepStrictEqual(t2.calls.filter(c => c.name === "状态机模型")[0].body, { compaction_model_provider: "", compaction_model: "__role__" }, "__role__ 原样存=跟随全局状态机");
});

test("单项失败不挡其它项：failed 里说清哪项、为什么", async () => {
  const { app, cfg } = setup([full], ["模型"]);
  const r = await post(app, { preset_id: "sp_full", session_id: "s_mvqixcfo_aaaaaa" });
  const j = JSON.parse(r.body);
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(j.failed.map(f => f.item), ["模型"]);
  assert.match(j.failed[0].error, /HTTP 400.*模型 失败了/);
  assert.ok(j.applied.indexOf("工具") >= 0 && j.applied.indexOf("头像和主题") >= 0);
  assert.strictEqual(cfg.readLook("s_mvqixcfo_aaaaaa").style, "min");
});

test("全部失败 -> 502 带原因；预设不存在 -> 404；会话 ID 格式不对 -> 400；不给 ID 服务器生成", async () => {
  const bare = { id: "sp_bare", name: "只有跨窗口", xw: { on: true } };
  let t = setup([bare], ["跨窗口"]);
  let r = await post(t.app, { preset_id: "sp_bare", session_id: "s_mvqixcfo_bbbbbb" });
  assert.strictEqual(r.statusCode, 502); assert.match(JSON.parse(r.body).error, /HTTP 400/);
  t = setup([bare]);
  assert.strictEqual((await post(t.app, { preset_id: "nope" })).statusCode, 404);
  assert.strictEqual((await post(t.app, { preset_id: "sp_bare", session_id: "../etc" })).statusCode, 400);
  assert.notStrictEqual((await post(t.app, { preset_id: "sp_bare", session_id: "s_sub_a1b2c3d4" })).statusCode, 400, "子会话 id（s_sub_xxxxxxxx）放行");
  assert.strictEqual((await post(t.app, { preset_id: "sp_bare", session_id: "s_sub_x" })).statusCode, 400, "太短的 s_sub_ id 仍拒绝");
  const j = JSON.parse((await post(t.app, { preset_id: "sp_bare" })).body);
  assert.match(j.session_id, /^s_[a-z0-9]+_[a-z0-9]+$/);
});

test("旧预设（只有 mcps 清单）仍按旧格式写工具；没有头像/主题就不写", async () => {
  const legacy = { id: "sp_old", name: "旧", xw: { on: true }, mcp_mode: "s", mcps: ["a::t1"], mcp_seen: ["a::t1", "a::t2"] };
  const { app, cfg, base } = setup([legacy]);
  const j = JSON.parse((await post(app, { preset_id: "sp_old", session_id: "s_mvqixcfo_cccccc" })).body);
  assert.deepStrictEqual(j.applied, ["跨窗口", "工具"]);
  assert.deepStrictEqual(cfg.readMcpOn("s_mvqixcfo_cccccc"), ["a::t1"]);
  assert.strictEqual(cfg.readMcpExact("s_mvqixcfo_cccccc"), true);
  assert.deepStrictEqual(cfg.readLook("s_mvqixcfo_cccccc"), { avatar: "", style: "" });
});

test("readLook/saveLook：只收 http(s)/站内路径头像和 min|bubble 主题；mtime 变了缓存失效", () => {
  const { cfg } = setup([]);
  assert.deepStrictEqual(cfg.saveLook("s_x1", { avatar: "javascript:alert(1)", style: "zzz" }), { avatar: "", style: "" });
  assert.deepStrictEqual(cfg.saveLook("s_x1", { avatar: "https://a.b/c.png", style: "bubble" }), { avatar: "https://a.b/c.png", style: "bubble" });
  assert.strictEqual(cfg.readLook("s_x1").avatar, "https://a.b/c.png");
  cfg.saveLook("s_x1", { avatar: "/u/1.png", style: "" });
  assert.deepStrictEqual(cfg.readLook("s_x1"), { avatar: "/u/1.png", style: "" });
  assert.deepStrictEqual(cfg.readLook("s_never"), { avatar: "", style: "" });
});

test("look-sync：老会话本地头像/主题一次性上云，只补没有的、不覆盖已有的、非法的忽略", async () => {
  const { app, cfg } = setup([]);
  cfg.saveLook("s_mvqixcfo_have01", { avatar: "/u/server.png", style: "min" });
  const r = await app.inject({ method: "POST", url: "/v1/sessions/look-sync", headers: { "content-type": "application/json" }, payload: JSON.stringify({ items: {
    s_mvqixcfo_have01: { avatar: "/u/local.png", style: "bubble" },
    s_mvqixcfo_newone: { avatar: "/u/local2.png", style: "bubble" },
    s_mvqixcfo_bad001: { avatar: "javascript:1", style: "x" },
    "../evil": { avatar: "/u/e.png" },
  } }) });
  assert.strictEqual(JSON.parse(r.body).saved, 1);
  assert.deepStrictEqual(cfg.readLook("s_mvqixcfo_have01"), { avatar: "/u/server.png", style: "min" });
  assert.deepStrictEqual(cfg.readLook("s_mvqixcfo_newone"), { avatar: "/u/local2.png", style: "bubble" });
  assert.deepStrictEqual(cfg.readLook("s_mvqixcfo_bad001"), { avatar: "", style: "" });
});
