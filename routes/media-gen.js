'use strict';
// media-gen.js —— 生图 / 生视频（Grok 订阅），后端接口。
// [位置:routes/media-gen.js] [订阅出图出片链路] [11-17：「那些模型那么好用结果都不接」，先把后端跑通：
//   生图 POST api.x.ai/v1/images/generations（同步回 URL，实测 200 + cost_in_usd_ticks 200000000）；
//   生视频 POST api.x.ai/v1/videos/generations 拿 request_id，GET /v1/videos/<id> 轮询（实测 done 回 mp4 URL + cost 2500000000）。
//   产物一律下载转存本站 data/uploads（上游是临时桶，链接会过期），文件名 img-gen<ts>-<rand> 以便直接进相册；
//   临时区不能无限长：每次生成前按「收藏过的不删 + 7 天 TTL + 200 个 / 300MB 上限」清一遍；Gemini 订阅的图像模型
//   实测 403 SUBSCRIPTION_REQUIRED（license 不覆盖），音乐订阅里压根没有，所以这轮只做 Grok 图/片] [注释时间 2026-11-17]
const fs = require('fs');
const path = require('path');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egressGuard = require('../lib/egress-guard');
const oauth = require('../lib/oauth-login');
const pool = require('../lib/oauth-pool');

function PROXY() { return egressGuard.requireProxyUrl(); }
function getAgent() { return new HttpsProxyAgent(PROXY()); }
const XAI_HOST = 'api.x.ai';
const TIMEOUT_MS = 180000;

const IMG_MODELS = ['grok-imagine-image', 'grok-imagine-image-2.0'];
const VIDEO_MODEL = 'grok-imagine-video';
const TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_ITEMS = 200;
const MAX_BYTES = 300 * 1024 * 1024;
const NAME_TAG = 'img-gen';

async function xaiRequest(host, reqPath, method, token, body) {
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    const buf = Buffer.from(body ? JSON.stringify(body) : '', 'utf8');
    const headers = { authorization: 'Bearer ' + token, 'user-agent': 'grok-cli' };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = buf.length; }
    const req = https.request({ hostname: host, path: reqPath, method: method, agent: getAgent(), headers: headers }, function (res) {
      let raw = ''; res.setEncoding('utf8');
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { resolve({ status: res.statusCode, raw: raw }); });
    });
    req.setTimeout(TIMEOUT_MS, function () { const e = new Error('上游超时'); req.destroy(e); });
    req.on('error', reject);
    req.end(body ? buf : undefined);
  });
}

async function download(url, dest) {
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('产物 URL 非法')); }
    const req = https.request({
      hostname: u.hostname, path: (u.pathname || '/') + (u.search || ''), method: 'GET', agent: getAgent(),
    }, function (res) {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('产物 HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(dest);
      let bytes = 0;
      res.on('data', function (c) { bytes += c.length; if (bytes > 600 * 1024 * 1024) { req.destroy(new Error('产物过大')); } });
      res.pipe(ws);
      ws.on('finish', function () { resolve(bytes); });
      ws.on('error', reject);
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS * 2, function () { req.destroy(new Error('下载超时')); });
    req.on('error', reject);
    req.end();
  });
}

function readJson(file, fallback) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : fallback; } catch (e) { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

function createMediaGen(opts) {
  const baseDir = opts.baseDir;
  const log = opts.log || function (m) { console.log('[media-gen] ' + m); };
  const UPLOADS = path.join(baseDir, 'data', 'uploads');
  const JOBS = path.join(baseDir, 'data', 'media-gen-jobs.json');
  const LOGF = path.join(baseDir, 'data', 'media-gen-log.jsonl');

  function jobs() { const j = readJson(JOBS, { items: [] }); return Array.isArray(j.items) ? j.items : []; }
  function saveJobs(list) { writeJson(JOBS, { items: list.slice(-MAX_ITEMS * 2) }); }
  function albumFiles() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(baseDir, 'data', 'album.json'), 'utf8'));
      return new Set(((j && j.items) || []).map(function (x) { return String(x.file || ''); }).filter(Boolean));
    } catch (e) { return new Set(); }
  }
  function nameFor(ext) {
    return NAME_TAG + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  }

  // 清临时区：收藏过的不动；再按 TTL、个数、总大小依次砍最旧的
  function prune() {
    let list = jobs().filter(function (j) { return j && j.file; });
    const keep = albumFiles();
    let deleted = 0;
    const now = Date.now();
    list = list.filter(function (j) {
      const f = path.join(UPLOADS, j.file);
      if (keep.has(j.file)) return true;
      const at = Number(j.at_ts) || 0;
      if (now - at > TTL_MS) { try { fs.unlinkSync(f); } catch (e) {} deleted++; j.file = ''; j.pruned = true; return false; }
      return true;
    });
    let live = list.filter(function (j) { return j.file; });
    if (live.length > MAX_ITEMS) {
      live.slice(0, live.length - MAX_ITEMS).forEach(function (j) {
        try { fs.unlinkSync(path.join(UPLOADS, j.file)); } catch (e) {}
        deleted++; j.file = ''; j.pruned = true;
      });
      live = live.filter(function (j) { return j.file; });
    }
    let total = 0;
    live.forEach(function (j) {
      try { j.bytes = fs.statSync(path.join(UPLOADS, j.file)).size; } catch (e) { j.bytes = 0; }
      total += Number(j.bytes) || 0;
    });
    while (total > MAX_BYTES && live.length) {
      const j = live.shift();
      try { fs.unlinkSync(path.join(UPLOADS, j.file)); } catch (e) {}
      total -= Number(j.bytes) || 0;
      deleted++; j.file = ''; j.pruned = true;
    }
    saveJobs(jobs().filter(function (j) { return !j.pruned || j.file; }));
    return { deleted: deleted, bytes: total };
  }

  function token() {
    return oauth.getAccessToken('grok', { account: (pool.candidates('grok').ordered || [])[0] });
  }

  async function genImage(args) {
    const model = IMG_MODELS.indexOf(String(args.model || '')) >= 0 ? String(args.model) : IMG_MODELS[0];
    const body = { model: model, prompt: String(args.prompt || '').slice(0, 2000), n: 1 };
    if (args.resolution) body.resolution = String(args.resolution);
    if (args.quality) body.quality = String(args.quality);
    const t0 = Date.now();
    const tk = await token();
    const r = await xaiRequest(XAI_HOST, '/v1/images/generations', 'POST', tk, body);
    if (r.status !== 200) throw new Error('生图上游 HTTP ' + r.status + '：' + String(r.raw).slice(0, 200));
    let j = {};
    try { j = JSON.parse(r.raw); } catch (e) { throw new Error('生图返回非 JSON'); }
    const first = (j.data || [])[0] || {};
    const upstream = String(first.url || '');
    if (!upstream) throw new Error('生图没回 URL');
    const ext = (String(first.mime_type || '').indexOf('png') >= 0) ? 'png' : 'jpg';
    const file = nameFor(ext);
    const dest = path.join(UPLOADS, file);
    fs.mkdirSync(UPLOADS, { recursive: true });
    const bytes = await download(upstream, dest);
    const now = new Date();
    const job = {
      id: 'mg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: 'image', status: 'done', model: model, prompt: body.prompt,
      file: file, url: '/uploads/' + file, upstream_url: upstream,
      bytes: bytes, cost_ticks: (j.usage && j.usage.cost_in_usd_ticks) || 0,
      at: now.toISOString(), at_ts: now.getTime(), ms: Date.now() - t0,
    };
    const list = jobs(); list.push(job); saveJobs(list);
    appendLog({ id: job.id, kind: 'image', model: model, cost_ticks: job.cost_ticks, ms: job.ms, bytes: bytes, ok: true });
    return job;
  }

  async function genVideo(args) {
    const duration = Math.min(15, Math.max(3, Number(args.duration) || 5));
    const body = { model: VIDEO_MODEL, prompt: String(args.prompt || '').slice(0, 2000), duration: duration };
    const tk = await token();
    const r = await xaiRequest(XAI_HOST, '/v1/videos/generations', 'POST', tk, body);
    if (r.status !== 200) throw new Error('生视频上游 HTTP ' + r.status + '：' + String(r.raw).slice(0, 200));
    let j = {};
    try { j = JSON.parse(r.raw); } catch (e) { throw new Error('生视频返回非 JSON'); }
    const rid = String(j.request_id || '');
    if (!rid) throw new Error('生视频没回 request_id');
    const now = new Date();
    const job = {
      id: 'mg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: 'video', status: 'pending', model: VIDEO_MODEL, prompt: body.prompt, duration: duration,
      request_id: rid, progress: 0, file: '', url: '', at: now.toISOString(), at_ts: now.getTime(),
    };
    const list = jobs(); list.push(job); saveJobs(list);
    return job;
  }

  // 视频待取结果：GET /v1/videos/<request_id>，done 就下载转存
  async function pollVideo(job) {
    if (!job || job.kind !== 'video' || job.status !== 'pending') return job;
    const tk = await token();
    const r = await xaiRequest(XAI_HOST, '/v1/videos/' + encodeURIComponent(job.request_id), 'GET', tk, null);
    if (r.status !== 200) {
      job.status = 'error'; job.error = '状态查询 HTTP ' + r.status + '：' + String(r.raw).slice(0, 160);
      return job;
    }
    let j = {};
    try { j = JSON.parse(r.raw); } catch (e) { job.status = 'error'; job.error = '状态返回非 JSON'; return job; }
    job.progress = Number(j.progress) || 0;
    const vurl = String((j.video && j.video.url) || '');
    if (j.status === 'done' && vurl) {
      const file = nameFor('mp4');
      const dest = path.join(UPLOADS, file);
      fs.mkdirSync(UPLOADS, { recursive: true });
      const bytes = await download(vurl, dest);
      const now = new Date();
      Object.assign(job, {
        status: 'done', file: file, url: '/uploads/' + file, upstream_url: vurl, bytes: bytes,
        duration_out: (j.video && j.video.duration) || job.duration,
        cost_ticks: (j.usage && j.usage.cost_in_usd_ticks) || 0,
        at_ts: now.getTime(), done_at: now.toISOString(),
      });
      appendLog({ id: job.id, kind: 'video', model: VIDEO_MODEL, cost_ticks: job.cost_ticks, bytes: bytes, ok: true });
    } else if (j.status === 'error' || j.status === 'failed') {
      job.status = 'error'; job.error = String(j.error || j.status);
    }
    return job;
  }

  function appendLog(o) {
    try { fs.appendFileSync(LOGF, JSON.stringify(Object.assign({ at: new Date().toISOString() }, o)) + '\n'); } catch (e) {}
  }

  function saveJob(job) {
    const list = jobs();
    const i = list.findIndex(function (x) { return x.id === job.id; });
    if (i >= 0) list[i] = job; else list.push(job);
    saveJobs(list);
  }

  function findJob(idOrUrl) {
    const s = String(idOrUrl || '').trim();
    return jobs().find(function (j) { return j.id === s || j.file === s || j.url === s; }) || null;
  }

  return { prune, genImage, genVideo, pollVideo, saveJob, findJob, jobs, UPLOADS };
}

module.exports = function registerMediaGen(app, deps) {
  const baseDir = (deps && deps.baseDir) || path.join(__dirname, '..');
  const mg = createMediaGen({ baseDir: baseDir });
  const albumRef = function () { try { return require('../lib/album').get(); } catch (e) { return null; } };

  /* [位置:routes/media-gen.js·POST /v1/media/gen] [一句话出图/出片] [kind=image 同步回本站 URL；kind=video 只建任务、回 id 让调用方轮询 /v1/media/gen/:id；每次生成前先清临时区（收藏过的不动），避免无限长] [注释时间 2026-11-17] */
  app.post('/v1/media/gen', async function (req, reply) {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const kind = String(b.kind || 'image').toLowerCase();
    if (kind !== 'image' && kind !== 'video') return reply.code(400).send({ ok: false, error: 'kind 只能是 image 或 video' });
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return reply.code(400).send({ ok: false, error: '缺少 prompt' });
    try { mg.prune(); } catch (e) { /* 清理失败不影响生成 */ }
    try {
      const job = kind === 'image' ? await mg.genImage(b) : await mg.genVideo(b);
      return reply.send({ ok: true, job: job });
    } catch (e) {
      const msg = String((e && e.message) || e);
      console.error('[media-gen] ' + kind + ' 失败：' + msg);
      return reply.code(502).send({ ok: false, error: msg });
    }
  });

  /* [位置:routes/media-gen.js·GET /v1/media/gen/:id] [取任务结果：视频每次进来都向上游查一次，done 就当场下载转存] [注释时间 2026-11-17] */
  app.get('/v1/media/gen/:id', async function (req, reply) {
    const job = mg.findJob(req.params.id);
    if (!job) return reply.code(404).send({ ok: false, error: '没有这个任务' });
    try {
      if (job.kind === 'video' && job.status === 'pending') { await mg.pollVideo(job); mg.saveJob(job); }
    } catch (e) { return reply.code(502).send({ ok: false, error: String((e && e.message) || e), job: job }); }
    return reply.send({ ok: true, job: job });
  });

  /* [位置:routes/media-gen.js·GET /v1/media/items] [临时区清单：不含已清理、含是否已收藏] [注释时间 2026-11-17] */
  app.get('/v1/media/items', async function (req, reply) {
    let keep = new Set();
    try {
      const a = albumRef();
      if (a) keep = new Set((a.list().items || []).map(function (x) { return String(x.file || ''); }));
    } catch (e) { /* 读不到相册就都算未收藏 */ }
    const items = mg.jobs().filter(function (j) { return j.file && fs.existsSync(path.join(mg.UPLOADS, j.file)); }).map(function (j) {
      let bytes = Number(j.bytes) || 0;
      try { bytes = fs.statSync(path.join(mg.UPLOADS, j.file)).size; } catch (e) {}
      return { id: j.id, kind: j.kind, url: j.url, file: j.file, bytes: bytes, at: j.at, prompt: j.prompt, cost_ticks: j.cost_ticks || 0, collected: keep.has(j.file) };
    }).reverse();
    return reply.send({ ok: true, items: items, total_bytes: items.reduce(function (s, x) { return s + x.bytes; }, 0) });
  });

  /* [位置:routes/media-gen.js·POST /v1/media/collect] [把生成的图收藏进相册] [相册只收图片，视频暂不入册；收藏过的文件在清理时不会被砍] [注释时间 2026-11-17] */
  app.post('/v1/media/collect', async function (req, reply) {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const job = mg.findJob(b.id || b.url);
    if (!job || !job.file) return reply.code(404).send({ ok: false, error: '没有这个产物（可能已被清理）' });
    if (job.kind !== 'image') return reply.code(400).send({ ok: false, error: '相册只收图片，视频请直接下载' });
    const a = albumRef();
    if (!a) return reply.code(500).send({ ok: false, error: '相册模块没初始化' });
    const r = a.add({ url: job.url, by: 'her', source: 'upload', note: b.note || '' });
    return reply.send(Object.assign({ ok: !!r.ok, media: job }, r));
  });

  /* [位置:routes/media-gen.js·POST /v1/media/prune] [手动清临时区（以后压缩/定时任务也能调这一口）] [注释时间 2026-11-17] */
  app.post('/v1/media/prune', async function (req, reply) {
    try { return reply.send(Object.assign({ ok: true }, mg.prune())); }
    catch (e) { return reply.code(500).send({ ok: false, error: String((e && e.message) || e) }); }
  });

  return mg;
};

module.exports._internal = { createMediaGen: createMediaGen, IMG_MODELS: IMG_MODELS, VIDEO_MODEL: VIDEO_MODEL };
