'use strict';
// theme-sync.js —— 聊天主题配置云同步：存 data/chat-theme.json，小手机「设置→主题」与月夜玻璃设置子页用。
// [位置:routes/theme-sync.js] [GET /admin/chat-theme · POST /admin/chat-theme/save] [11-05：气泡主题配置只存在本机 localStorage，
//   换设备/浏览器全是默认值；改成服务器存一份，以云端为准，手机打开时拉取覆盖本机。个性化配置照 10-27 会话头像、11-01 颜文字的教训存服务器] [注释时间 2026-11-05]
//
// 文件格式：{"look":{…ph.look.v2},"bubble":{…ph.bubble.v1},"bgimg":"背景照片地址","style":"bubble|min","cn":"字体id","en":"字体id","cthemes":[自定义主题存档],"updated_at":"…"}
// 没有文件=还没保存过：GET 返回 data:null（手机据此把本机配置当首次保存上传）。
// 保存是整份覆盖；bgimg 不传=保持云端原值（传不上照片时不把云端的照片抹掉），传空串=清除背景照片。
// cthemes=自定义主题存档（随手记第 27 条，2026-11-14）：[{id,name,ts,look,bubble,bgimg}]，月夜玻璃三段快照的命名克隆；不传=保持云端原值（旧前端不带这个字段，别把云端已有的存档抹掉），传了=整段替换。 [注释时间 2026-11-05；2026-11-14 加 cthemes 段]

const fs = require('fs');
const path = require('path');

const STYLES = ['bubble', 'min'];
const FONT_RE = /^[a-z0-9_-]{1,40}$/i;
const MAX_OBJ_BYTES = 20 * 1024;      // look / bubble 各自序列化后的上限（正常只有 1~2KB）
const MAX_IMG_CHARS = 900 * 1024;     // 背景照片：正常是 /uploads 地址；传不上时手机会回退成 dataURL，这里限长
const MAX_CT = 20;                    // cthemes 条数上限（前端同值，手机存前也会拦）
const MAX_CT_BYTES = 64 * 1024;       // cthemes 序列化后的总上限（每条 look+bubble 正常 1~2KB，20 条远够）

// 只收「扁平对象 + 标量值」：滑杆数字、颜色字符串、开关；嵌套结构一律丢弃，防止把任意数据塞进文件
function cleanFlat(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k of Object.keys(o)) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(k)) continue;
    const v = o[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= 200) out[k] = v;
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_OBJ_BYTES) return null;
  return out;
}

// cthemes 白名单：逐条收 id/name/ts/look/bubble/bgimg，坏条目直接丢（坏一条不连坐整段）；
// 超条数截断、总量超限返回 null（调用方 400），防止把任意数据塞进文件
function cleanCthemes(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const it of v) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const look = cleanFlat(it.look), bubble = cleanFlat(it.bubble);
    if (!look || !bubble) continue;
    const id = typeof it.id === 'string' && /^[A-Za-z0-9]{1,24}$/.test(it.id) ? it.id : '';
    const name = typeof it.name === 'string' ? it.name.slice(0, 20).trim() : '';
    if (!id || !name) continue;
    const ts = typeof it.ts === 'number' && isFinite(it.ts) ? it.ts : Date.now();
    let bgimg = '';
    if (typeof it.bgimg === 'string' && it.bgimg.length <= MAX_IMG_CHARS && (!it.bgimg || /^(\/|https?:\/\/|data:image\/)/.test(it.bgimg))) bgimg = it.bgimg;
    out.push({ id, name, ts, look, bubble, bgimg });
    if (out.length >= MAX_CT) break;
  }
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_CT_BYTES) return null;
  return out;
}

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;
  const FILE = deps.file || path.join(deps.baseDir, 'data', 'chat-theme.json');

  function read() {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (j && typeof j === 'object') return j;
    } catch (e) { /* 无文件/坏文件=还没保存过 */ }
    return null;
  }

  app.get('/admin/chat-theme', { preHandler: basicAuth }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const d = read();
    reply.send({ ok: true, data: d });
  });

  app.post('/admin/chat-theme/save', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const look = cleanFlat(b.look), bubble = cleanFlat(b.bubble);
      if (!look || !bubble) return reply.code(400).send({ ok: false, msg: '配置格式不对' });
      const style = STYLES.indexOf(b.style) >= 0 ? b.style : 'bubble';
      const cn = typeof b.cn === 'string' && FONT_RE.test(b.cn) ? b.cn : '';
      const en = typeof b.en === 'string' && FONT_RE.test(b.en) ? b.en : '';
      const old = read() || {};
      let bgimg = old.bgimg || '';
      if (typeof b.bgimg === 'string') {
        if (b.bgimg.length > MAX_IMG_CHARS) return reply.code(400).send({ ok: false, msg: '背景照片太大' });
        if (b.bgimg && !/^(\/|https?:\/\/|data:image\/)/.test(b.bgimg)) return reply.code(400).send({ ok: false, msg: '背景照片地址不对' });
        bgimg = b.bgimg;
      }
      let cthemes = old.cthemes || [];   // 不传=保持云端原值（旧前端不带这字段，别把已有存档抹掉）
      if (b.cthemes !== undefined) {
        cthemes = cleanCthemes(b.cthemes);
        if (cthemes === null) return reply.code(400).send({ ok: false, msg: '自定义主题太大' });
      }
      const data = { look, bubble, bgimg, style, cn, en, cthemes, updated_at: new Date().toISOString() };
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, FILE);   // 原子替换，写一半断电不会留下坏文件
      reply.send({ ok: true, updated_at: data.updated_at });
    } catch (e) {
      req.log && req.log.error && req.log.error(e);
      reply.code(500).send({ ok: false, msg: '保存失败' });
    }
  });
};
