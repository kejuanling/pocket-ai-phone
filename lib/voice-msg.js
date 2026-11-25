'use strict';
// voice-msg.js —— 语音消息与语音转文字（10-23：豆包识别下线，统一走千问 Omni）
//   describe(b64wav, mode)：mode='annotated' 转写+说话方式标注（发出去的语音）；mode='plain' 只转文字（输入框麦克风）
//   save(buf)：落盘 data/uploads/voice-<id>.wav，只留最近 keep 条（默认 10，data/voice_desc_prompt.json 的 keep 可改）
// 模型走用途 voice_desc（lib/model-router.js），提示词在 data/voice_desc_prompt.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const UP = path.join(ROOT, 'data', 'uploads');
const PROMPT_FILE = path.join(ROOT, 'data', 'voice_desc_prompt.json');

// 默认提示词（后台「用途提示词」页里「恢复默认」就是回到这两份；改过的存 data/voice_desc_prompt.json 的 template / asr_template）
const DEFAULT_ANNOTATED = "你是语音转写员。这是一段真人录音。请认真听声音本身，把说话人说的话逐字写下来，并在每一小句后面用全角方括号［］写出这句话「听起来是什么声音」。\n\n要求：\n1. 逐字转写，口头词（哎、嗯、呃、啊、那个）原样保留，不润色、不翻译。\n2. ［］里只描写声音，不解释意思。可以写：语气色彩（轻快、慵懒、撒娇、无奈、笑着说、闷闷的）、气息（气音、叹气、吸气）、拖音、颤抖、沙哑、鼻音、声音大小的变化、语速快慢、音高起伏、停顿，几个特征用逗号隔开。\n3. 绝对不要写这句话的作用或意图：解释、疑问、反问、提醒、指令、强调、否定、推测、回应、犹豫……这些是在分析意思，不是在描写声音，一个都不要出现。\n4. 几乎每一小句后面都要有一个［……］；即使是很平常的说话，也要简单描写一下，例如［平稳，语速偏快］。\n5. 说话以外的声音也要标：［轻笑］［大笑］［叹气］［吸鼻子］［咳嗽］［呼吸声］，背景有明显声音就写［背景：……］。\n6. 听不清写［听不清］，没有人声写［无人声］。\n7. 只输出结果，一行文字，不要前言、解释、引号。\n\n示例：\n哎［气音，拖长］好无聊啊［波浪音，声音变小］\n我今天……［停顿］真的有点累了［叹气，声音很轻］\n你猜我刚才看到什么了［轻笑，语速加快］";
const DEFAULT_PLAIN = "请把这段语音逐字转写成文字。只输出转写的文字本身，不加说明、引号、说话方式标注；口头词原样保留，听不清的地方直接略过，不要猜；整段没有人声就输出空。";
function readCfg() { try { return JSON.parse(fs.readFileSync(PROMPT_FILE, 'utf-8')) || {}; } catch (e) { return {}; } }
function prompts() {
  const d = readCfg();
  return { annotated: String(d.template || '').trim() ? String(d.template) : DEFAULT_ANNOTATED, plain: String(d.asr_template || '').trim() ? String(d.asr_template) : DEFAULT_PLAIN, keep: Math.max(1, Math.min(200, Number(d.keep) || 10)), think: d.think !== false };
}
// 后台页（手机「用途提示词」）读 / 存 / 恢复默认
function adminGet() { const p = prompts(), d = readCfg(); return { template: p.annotated, asr_template: p.plain, think: p.think, custom_set: !!(String(d.template || '').trim() || String(d.asr_template || '').trim()) }; }
function adminSave(body) {
  const d = readCfg(); const t = String((body && body.template) || '').trim(), a = String((body && body.asr_template) || '').trim();
  if (!t || !a) throw new Error('两份都不能是空的');
  d.template = t; d.asr_template = a;
  if (body && body.think != null) d.think = !!body.think;   /* 转写思考开关（只影响发出去的语音）：开着描写细但慢十几秒；不传就不动 */
  fs.writeFileSync(PROMPT_FILE, JSON.stringify(d, null, 2));
}
function adminReset() { const d = readCfg(); delete d.template; delete d.asr_template; fs.writeFileSync(PROMPT_FILE, JSON.stringify(d, null, 2)); }

/* [位置:lib/voice-msg.js·describe] [出口统一走 upstream-target，音频按出口分形态] [11-14：语音识别 11-12 切到 Gemini 订阅后就全挂了——手拼请求头只带 x-provider-id、没带 x-internal-key，/internal/ 是 fail-closed 直接 401；补上 key 后还有第二层：订阅代理只认站内 /uploads 引用才会内联，data: base64 会被剥成「（语音）」占位。现在出口交给 resolveTarget 决定，订阅类落一份临时 wav 用 url 引用（无论成败请求完删），直连供应商（千问这类）保持 data: base64 原样，以后切回去不用改代码；11-15：viaProxy 里还有普通代理这一类（routes/http-proxy.js 原样透传、上游不认站内路径，写站内引用必 400），改按 resolveTarget 的 proxyKind 分档——只有 subscription-proxy 落站内临时文件，普通代理与直连都走 data: base64] [注释时间 2026-11-15] */
async function describe(b64, mode) {
  const router = require('./model-router');
  const { resolveTarget } = require('./upstream-target');
  const { provider, model } = router.resolveRoleModel('voice_desc', { ignoreEnabled: true });
  if (!provider || !model) throw new Error('没配语音识别的模型（后台·默认模型·语音识别与描述）');
  const P = prompts();
  const text = mode === 'plain' ? P.plain : P.annotated;
  if (!text) throw new Error('语音提示词是空的');
  const t = resolveTarget(provider, function (k) { return process.env[k]; }, model);
  let url = String((t && t.url) || '').replace(/\/+$/, '');
  if (url && !t.viaProxy && !/\/chat\/completions$/.test(url)) url += '/chat/completions';
  if (!url || !t.key) throw new Error('语音识别的模型没配地址或密钥');
  /* 两类代理出口要的音频形态是相反的，不能只看 viaProxy：订阅代理（routes/oauth-proxy.js·prepareCloudCodeAudio）只把站内 /uploads 引用内联成 data:URL，收到 data: 会剥成「（语音）」占位、模型听不到声音；普通代理（routes/http-proxy.js）原样透传给上游，上游不认识站内路径、必 400。所以按 resolveTarget 给的 proxyKind 分档：订阅代理落站内临时文件用 url 引用，普通代理与直连一律 data: base64（与千问直连时同形）。 */
  let tmpFile = '';
  let audioPart;
  if (t.proxyKind === 'subscription-proxy') {
    tmpFile = path.join(UP, 'voiceq-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.wav');
    try { fs.mkdirSync(UP, { recursive: true }); fs.writeFileSync(tmpFile, Buffer.from(b64, 'base64')); }
    catch (e) { throw new Error('语音临时文件写不出来：' + e.message); }
    audioPart = { type: 'input_audio', input_audio: { url: '/uploads/' + path.basename(tmpFile), format: 'wav' } };
  } else {
    audioPart = { type: 'input_audio', input_audio: { data: 'data:;base64,' + b64, format: 'wav' } };
  }
  const body = {
    model, stream: false, modalities: ['text'], enable_thinking: mode === 'annotated' && P.think, temperature: 0.3,   // 发出去的语音开思考（标注才细，约 5~20 秒）；输入框转文字不开（约 1~2 秒）
    messages: [{ role: 'user', content: [audioPart, { type: 'text', text: text }] }]
  };
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 100000);
  const hdrs = Object.assign({ 'Content-Type': 'application/json' }, t.headers || {});
  if (t.key) hdrs.Authorization = 'Bearer ' + t.key;
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: hdrs, body: JSON.stringify(body), signal: ac.signal });
  } catch (e) { throw new Error(e.name === 'AbortError' ? '语音识别超时' : ('语音识别连不上：' + e.message)); }
  finally { clearTimeout(tm); if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (_e) {} } }
  const raw = await r.text();
  let j = null; try { j = JSON.parse(raw); } catch (e) {}
  if (!r.ok) throw new Error('语音识别失败 ' + r.status + '：' + ((j && j.error && (j.error.message || j.error)) || raw.slice(0, 120)));
  const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  return String(typeof out === 'string' ? out : '').trim().replace(/^["“「]+|["”」]+$/g, '').replace(/\s*\n+\s*/g, ' ');
}

function save(buf) {
  fs.mkdirSync(UP, { recursive: true });
  const id = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  fs.writeFileSync(path.join(UP, 'voice-' + id + '.wav'), buf);
  prune();
  return id;
}
function prune() {
  try {
    const keep = prompts().keep;
    const fl = fs.readdirSync(UP).filter(n => /^voice-[\w-]+\.wav$/.test(n)).map(n => ({ n, t: fs.statSync(path.join(UP, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    fl.slice(keep).forEach(x => { try { fs.unlinkSync(path.join(UP, x.n)); } catch (e) {} });
  } catch (e) {}
}
module.exports = { describe, save, prune, prompts, adminGet, adminSave, adminReset };
