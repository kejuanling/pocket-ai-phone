'use strict';
// kaomoji.js —— 颜文字库：小手机表情面板「颜文字」标签页的清单，存 data/kaomoji.json。
// [位置:routes/kaomoji.js] [GET /admin/kaomoji · POST /admin/kaomoji/save] [11-01：表情面板加颜文字页，点=填进输入框不发送；
//   长按单条=编辑/移到最前/删除，可新增——个性化清单照 10-27 会话头像的教训存服务器不存 localStorage（换设备/清缓存不丢）] [注释时间 2026-11-01]
//
// 文件格式：{"list":["(´▽`)","(≧▽≦)"],"updated_at":"…"}，数组顺序即展示顺序（移到最前=挪到数组头）。
// 没有文件=还没自定义过，返回内置默认清单（带 def:true 标记）；第一次保存才落盘。清洗规则：去空、去换行、单条 64 字内、去重、最多 200 条。

const fs = require('fs');
const path = require('path');

/* [位置:routes/kaomoji.js·DEFAULTS] [内置默认颜文字清单] [11-01 挑定的 32 个：开心/加油/委屈/生气/惊讶/无奈/撒娇/困累拜拜 八组；
   只在用户从没存过清单时兜底，用户一旦保存过就完全以保存的为准（删光也是用户的选择，返回空数组而不是默认）] [注释时间 2026-11-01] */
const DEFAULTS = [
  '(^▽^)', '(´▽`)', '(≧▽≦)', '(＾▽＾)', '(￣▽￣)', '(*^▽^*)',
  '(๑•̀ㅂ•́)و✧', '(ง •̀_•́)ง', 'ᕦ(ò_óˇ)ᕤ',
  '(´;ω;`)', '(ಥ﹏ಥ)', '(ㄒoㄒ)', '(；д；)', '(｡•́︿•̀｡)',
  '(｀Д´)', '(╬￣皿￣)', '(╯°□°）╯︵ ┻━┻',
  '(⊙_⊙)', '(°□°；)', 'Σ(°△°|||)',
  '¯\\_(ツ)_/¯', '(￣_￣)|||', '(´-ω-`)', '(・_・?)',
  '(｡♥‿♥｡)', '(づ￣ ³￣)づ', '(๑´ㅂ`๑)', '(ฅ´ω`ฅ)', '(♡°▽°♡)',
  '( _ )zzz', '(￣ω￣;)', 'ヾ(￣▽￣) Bye~'
];

function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const out = [], seen = {};
  for (const it of list) {
    const s = String(it == null ? '' : it).replace(/[\r\n\t]+/g, ' ').trim();
    if (!s || s.length > 64 || seen[s]) continue;
    seen[s] = 1;
    out.push(s);
    if (out.length >= 200) break;
  }
  return out;
}

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;
  const FILE = deps.file || path.join(deps.baseDir, 'data', 'kaomoji.json');

  function readList() {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (j && Array.isArray(j.list)) return cleanList(j.list) || [];
    } catch (e) { /* 无文件/坏文件=还没自定义过，用默认 */ }
    return null;
  }

  app.get('/admin/kaomoji', { preHandler: basicAuth }, async (req, reply) => {
    const list = readList();
    if (list) return reply.send({ ok: true, list });
    reply.send({ ok: true, list: DEFAULTS.slice(), def: true });
  });

  app.post('/admin/kaomoji/save', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const list = cleanList(b.list);
      if (!list || !list.length) return reply.code(400).send({ ok: false, msg: '清单是空的' });
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ list, updated_at: new Date().toISOString() }, null, 2), 'utf8');
      fs.renameSync(tmp, FILE);
      reply.send({ ok: true, list });
    } catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
  });
};
module.exports.DEFAULTS = DEFAULTS;
module.exports.cleanList = cleanList;
