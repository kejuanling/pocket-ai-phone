'use strict';
// session-preset.js —— 用预设一次性建会话：POST /v1/sessions/from-preset  { preset_id, session_id? }
// [位置:routes/session-preset.js] [服务器端一次性建会话] [10-27：原来手机点预设后自己挨个发 5 个请求（跨窗口/人设/模型/时间缀/工具）再在本地写头像和主题，
//   中途断网就配一半，还要一大段「哪项没设上」的补救代码；现在手机只发一句「用这个预设开会话」，服务器读预设、按顺序一项项配好，返回 applied / failed]
// 实现方式：服务器内部用 app.inject 调用现成的单项接口（跨窗口含「承接上一个会话」、人设、模型、时间缀、工具规则），
//   转发原请求的登录凭据——行为与手机单发完全一致，不复制任何业务逻辑；头像 / 聊天主题直接写会话配置（lib/session-cfg readLook/saveLook）。
// 顺序执行（不并发）：这几项都会改同一个会话配置文件，并发会互相覆盖；跨窗口放第一项（它靠「时间线还是空的」判断是不是真新建）。
// 失败隔离：单项失败不挡其它项，记进 failed；全部失败返回 502 让手机明说原因。

const fs = require('fs');
const path = require('path');
const { createSessionCfg } = require('../lib/session-cfg');

const SID_RE = /^(?:s_[a-z0-9]{4,16}_[a-z0-9]{3,16}|s_sub_[a-z0-9]{6,16})$/;   // 2026-10-27：子会话 id（s_sub_xxxxxxxx）也放行，子智能体用预设建会话要用
const FWD = ['cookie', 'authorization', 'x-csrf-token', 'x-gateway-api-key', 'x-api-key'];

module.exports = function (app, deps) {
  const baseDir = deps.baseDir;
  const cfg = createSessionCfg(baseDir);
  /* [位置:routes/session-preset.js·提示词清单] [建会话前查一眼套还在不在] [11-06：预设可能引用一套后来被删掉的状态机提示词；deps.conversationState 供测试注入，正常走真实现] [注释时间 2026-11-06] */
  const cvs = (deps && deps.conversationState) || require('../lib/conversation-state');

  function readPreset(id) {
    try {
      const cs = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'chat-settings.json'), 'utf-8'));
      const L = (cs.cfg || {}).sess_presets;
      return Array.isArray(L) ? (L.find(function (p) { return p && p.id === id; }) || null) : null;
    } catch (e) { return null; }
  }

  app.post('/v1/sessions/from-preset', async function (req, reply) {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const preset = readPreset(String(body.preset_id || ''));
      if (!preset) return reply.code(404).send({ ok: false, error: '预设不存在（可能还没保存到云端）' });
      let sid = String(body.session_id || '').trim();
      if (sid && !SID_RE.test(sid)) return reply.code(400).send({ ok: false, error: '会话 ID 格式不对' });
      if (!sid) sid = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

      const fwd = {};
      FWD.forEach(function (h) { if (req.headers[h]) fwd[h] = req.headers[h]; });
      fwd['content-type'] = 'application/json';
      async function call(method, url, payload) {
        const r = await app.inject({ method: method, url: url, headers: fwd, payload: JSON.stringify(payload) });
        if (r.statusCode >= 400) {
          let msg = ''; try { msg = JSON.parse(r.body).error || JSON.parse(r.body).message || ''; } catch (e) { msg = ''; }
          throw new Error('HTTP ' + r.statusCode + (msg ? ' ' + String(msg).slice(0, 80) : ''));
        }
        return r;
      }
      const enc = encodeURIComponent(sid);
      const steps = [];
      const xw = preset.xw || { on: true };
      steps.push(['跨窗口', function () { return call('POST', '/v1/sessions/' + enc + '/cross-inject', { enabled: xw.on !== false, inject_blocks: Array.isArray(xw.blocks) ? xw.blocks : null }); }]);
      if (preset.ps) { const st = {}; st[sid] = String(preset.ps); steps.push(['人设', function () { return call('PUT', '/admin/session-prompts', { set: st, unset: [] }); }]); }
      if (preset.md) {
        const mm = String(preset.md).split('|');
        steps.push(['模型', function () { return call('POST', '/v1/sessions/' + enc + '/model-provider', { model_provider_id: mm[0], model_name: mm.slice(1).join('|') }); }]);
      }
      /* [位置:routes/session-preset.js·状态机两步] [预设带的状态机模型/提示词落到会话] [11-06：跟聊天页「状态机参数」面板同一套接口——模型 POST /admin/context-compaction/config?session_id（写 session_cfg.compaction_model*，__role__ 原样存=跟随全局状态机），提示词 POST /admin/context-compaction/prompts?session_id（action:select）；套已被删就静默跳过、不记失败（读侧本来也回落默认）] [注释时间 2026-11-06] */
      if (preset.cmp_model) {
        const cm = String(preset.cmp_model);
        let cmpPid = '', cmpModel = cm;
        if (cm !== '__role__') { const a = cm.split('|'); cmpPid = a[0]; cmpModel = a.slice(1).join('|'); }
        steps.push(['状态机模型', function () { return call('POST', '/admin/context-compaction/config?session_id=' + enc, { compaction_model_provider: cmpPid, compaction_model: cmpModel }); }]);
      }
      if (preset.cmp_prompt) {
        const cpid = String(preset.cmp_prompt);
        // [位置:routes/session-preset.js·提示词存在性] [套已被删就不入步骤表] [2026-11-06：入表但不发请求会被算进 applied（手机端会以为配上了）；这里建表时先查，不存在直接不排这一步，failed 里也不出现]
        let cmpPromptOk = false;
        try { const L = cvs.listPrompts(); cmpPromptOk = Array.isArray(L) && L.some(function (p) { return p && p.id === cpid; }); } catch (e) { cmpPromptOk = false; }
        if (cmpPromptOk) steps.push(['状态机提示词', function () { return call('POST', '/admin/context-compaction/prompts?session_id=' + enc, { action: 'select', id: cpid }); }]);
      }
      if (preset.tt === true || preset.tt === false) steps.push(['时间缀', function () { return call('POST', '/v1/sessions/' + enc + '/time-tag-to-ai', { time_tag_to_ai: preset.tt }); }]);
      // 距上一轮（[elapsed] 标签）三态（2026-11-16 批3 H1）：预设带布尔就落会话级 elapsed-tag，缺字段不动（跟随人设/全局）
      if (preset.et === true || preset.et === false) steps.push(['距上一轮', function () { return call('POST', '/v1/sessions/' + enc + '/elapsed-tag', { elapsed_tag_to_ai: preset.et }); }]);
      // 工具：规则优先（新）；还没迁移的旧预设（只有 mcps 清单）走旧格式，服务端保存时同样处理
      if (preset.mcp_rules && preset.mcp_rules.servers) {
        steps.push(['工具', function () { return call('PUT', '/admin/session-mcp', { session_id: sid, rules: preset.mcp_rules }); }]);
      } else if (Array.isArray(preset.mcps)) {
        const seen = (Array.isArray(preset.mcp_seen) && preset.mcp_seen.length) ? preset.mcp_seen : preset.mcps;
        steps.push(['工具', function () { return call('PUT', '/admin/session-mcp', { session_id: sid, exact: true, on: preset.mcps.slice(0, 1000), seen: seen.slice(0, 1000) }); }]);
      }
      if (preset.av || preset.style) steps.push(['头像和主题', async function () { cfg.saveLook(sid, { avatar: preset.av, style: preset.style }); }]);
      /* [位置:routes/session-preset.js·永久上下文绑定] [预设独立永久上下文与开关落到会话] [11-25：用预设建会话时绑定 preset:<id> 作用域与独立开关 perm_on，彻底与全局 pinned.json 及跨窗口开关解耦] [注释时间 2026-11-25] */
      steps.push(['永久上下文', async function () { cfg.savePinnedScope(sid, { scope: 'preset:' + preset.id, enabled: preset.perm_on === true }); }]);
      if (preset.nb && preset.nb !== 'default') {
        steps.push(['笔记本', async function () { cfg.saveNotebookId(sid, String(preset.nb)); }]);
      }

      const applied = [], failed = [];
      for (const s of steps) {
        try { await s[1](); applied.push(s[0]); } catch (e) { failed.push({ item: s[0], error: String((e && e.message) || e).slice(0, 120) }); }
      }
      if (!applied.length) return reply.code(502).send({ ok: false, session_id: sid, applied: applied, failed: failed, error: failed[0] ? failed[0].error : '没配上任何一项' });
      const look = cfg.readLook(sid);
      reply.send({ ok: true, session_id: sid, applied: applied, failed: failed, avatar: look.avatar, chat_style: look.style });
    } catch (err) {
      reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /* [位置:routes/session-preset.js·POST /v1/sessions/chat-style] [头像菜单里切本会话的聊天主题] [10-28：聊天主题切换放进聊天页的头像菜单；存会话配置的 chat_style（和预设带的是同一个字段，会话列表带回）；style 为空＝清掉、跟随全局；现在只收 min / bubble，以后抄玻璃/终端/微信/奶油少女等主题时在 lib/session-cfg.js 放开] [注释时间 2026-10-28] */
  app.post('/v1/sessions/chat-style', async function (req, reply) {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(b.session_id || '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return reply.code(400).send({ ok: false, error: '会话 id 不对' });
      const st = b.style == null ? '' : String(b.style);
      if (st !== '' && st !== 'min' && st !== 'bubble') return reply.code(400).send({ ok: false, error: '没有这个主题' });
      const cur = cfg.readLook(sid);
      const r = cfg.saveLook(sid, { avatar: cur.avatar, style: st });
      reply.send({ ok: true, style: r.style });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });

  /* [位置:routes/session-preset.js·POST /v1/sessions/session-avatar] [头像菜单里换本会话的头像] [10-29：会话头像以前只能靠预设带或 look-sync 补，头像菜单那一行真会话根本不显示；现在聊天页头像菜单加「会话头像」行（相册/拍照，压缩上传后把地址存这里）。avatar 空 = 摘掉、跟随全局；格式校验交给 saveLook（http(s)/ 开头、长度上限）] [注释时间 2026-10-29] */
  app.post('/v1/sessions/session-avatar', async function (req, reply) {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(b.session_id || '');
      if (!SID_RE.test(sid)) return reply.code(400).send({ ok: false, error: '会话 id 不对' });
      const cur = cfg.readLook(sid);
      const r = cfg.saveLook(sid, { avatar: b.avatar == null ? '' : String(b.avatar), style: cur.style });
      reply.send({ ok: true, avatar: r.avatar });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });

  /* [位置:routes/session-preset.js·POST /v1/sessions/:id/pinned-scope] [设置会话永久上下文作用域与开关] [11-25：供旧版客户端逐项建会话或后续会话级调整使用] [注释时间 2026-11-25] */
  app.post('/v1/sessions/:id/pinned-scope', async function (req, reply) {
    try {
      const sid = String((req.params && req.params.id) || '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return reply.code(400).send({ ok: false, error: '会话 id 不对' });
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const r = cfg.savePinnedScope(sid, {
        scope: typeof b.pinned_scope === 'string' ? b.pinned_scope : '',
        enabled: typeof b.pinned_enabled === 'boolean' ? b.pinned_enabled : null,
      });
      reply.send({ ok: true, pinned_scope: r.scope, pinned_enabled: r.enabled });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });

  /* [位置:routes/session-preset.js·POST /v1/sessions/:id/notebook] [设置会话绑定的笔记本 ID] [11-25] [注释时间 2026-11-25] */
  app.post('/v1/sessions/:id/notebook', async function (req, reply) {
    try {
      const sid = String((req.params && req.params.id) || '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return reply.code(400).send({ ok: false, error: '会话 id 不对' });
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const nb = cfg.saveNotebookId(sid, typeof b.notebook_id === 'string' ? b.notebook_id : '');
      reply.send({ ok: true, notebook_id: nb });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });

  /* [位置:routes/session-preset.js·POST /v1/sessions/look-sync] [老会话的头像/主题一次性上云] [10-27：以前用预设开的会话，头像和聊天主题只存在手机本地（ph_sess_av / ph_sess_style）；手机把本地映射一次性交上来，
     服务器只给「还没有头像和主题」的会话补，已有的不覆盖；{items:{会话id:{avatar,style}}}，一次最多 300 个] [注释时间 2026-10-27] */
  app.post('/v1/sessions/look-sync', async function (req, reply) {
    try {
      const items = (req.body && req.body.items && typeof req.body.items === 'object') ? req.body.items : {};
      let saved = 0;
      Object.keys(items).slice(0, 300).forEach(function (sid) {
        if (!SID_RE.test(sid) || !items[sid] || typeof items[sid] !== 'object') return;
        const cur = cfg.readLook(sid);
        if (cur.avatar || cur.style) return;
        const r = cfg.saveLook(sid, { avatar: items[sid].avatar, style: items[sid].style });
        if (r.avatar || r.style) saved++;
      });
      reply.send({ ok: true, saved: saved });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });
};
