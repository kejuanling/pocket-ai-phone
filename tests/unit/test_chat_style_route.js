'use strict';
// [位置:tests/unit/test_chat_style_route.js] [POST /v1/sessions/chat-style：写会话的 chat_style，不动头像；空＝清除；非法拒绝] [10-28] [注释时间 2026-10-28]
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
const routes = {};
const app = { get() {}, put() {}, delete() {}, post: (p, h) => { routes['POST ' + p] = h; } };
require('../../routes/session-preset')(app, { baseDir: tmp, basicAuth: () => {} });
const { createSessionCfg } = require('../../lib/session-cfg');
const cfg = createSessionCfg(tmp);
const call = async (b) => { let out, code = 200; await routes['POST /v1/sessions/chat-style']({ body: b }, { send: x => out = x, code: c => ({ send: x => { code = c; out = x; } }) }); return { code, out }; };
(async () => {
  cfg.saveLook('s_abcd_efgh', { avatar: '/uploads/a.jpg', style: 'bubble' });
  let r = await call({ session_id: 's_abcd_efgh', style: 'min' });
  assert.ok(r.out.ok && r.out.style === 'min');
  assert.deepStrictEqual(cfg.readLook('s_abcd_efgh'), { avatar: '/uploads/a.jpg', style: 'min' }, '头像保持不变');
  r = await call({ session_id: 's_abcd_efgh', style: '' });
  assert.ok(r.out.ok && r.out.style === '' && cfg.readLook('s_abcd_efgh').style === '' && cfg.readLook('s_abcd_efgh').avatar === '/uploads/a.jpg');
  assert.strictEqual((await call({ session_id: 's_abcd_efgh', style: 'glass' })).code, 400);
  assert.strictEqual((await call({ session_id: '../x', style: 'min' })).code, 400);
  r = await call({ session_id: 'default', style: 'min' });
  assert.ok(r.out.ok && cfg.readLook('default').style === 'min');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('chat-style route: all ok');
})().catch(e => { console.error(e); process.exit(1); });
