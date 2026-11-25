/* [位置:lib/session-branches.js] [会话分支父子关系登记（data/session-branches.json）] [11-10：手机端「开启分支」只复制时间线，父级关系要靠前端另发 PUT /admin/session-branches 才落库，跨设备看不到分支出处；改成后端 branch-inherit 自己登记。文件结构沿用旧格式 map[子会话]={fromSession,fromIndex,createdAt}（已有 15 条旧数据，读写必须原样保留），新登记多带可选 anchorId（分支点消息 id）；写盘一律 tmp+rename 原子写，防半个文件] [注释时间 2026-11-10] */
'use strict';
const fs = require('fs-extra');
const path = require('path');

// 会话 id 口径与 routes/chat.js 的接口校验一致：只允许字母数字下划线横杠
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

function isValidSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

function branchesFile(baseDir) {
  return path.join(baseDir || path.join(__dirname, '..'), 'data', 'session-branches.json');
}

/* 读全表；坏文件/坏条目一律跳过不抛（调用方是列表接口，不能因为一个坏文件 500）。
   返回值为浅拷贝，调用方改返回值不会影响文件内容。 */
function read(baseDir) {
  const out = {};
  try {
    const f = branchesFile(baseDir);
    if (!fs.existsSync(f)) return out;
    const v = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const k of Object.keys(v)) {
      const it = v[k];
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      if (!isValidSessionId(k)) continue;
      out[k] = Object.assign({}, it);   // 旧格式原样带出（含未知字段），不做归一化
    }
  } catch (e) {
    console.warn('[session-branches] 读取失败:', (e && e.message) || e);
  }
  return out;
}

/* 原子写：同目录 tmp 文件 + rename；失败抛给调用方（登记失败要能让上层知道） */
function writeAll(baseDir, map) {
  const f = branchesFile(baseDir);
  fs.ensureDirSync(path.dirname(f));
  const tmp = f + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  try {
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf-8');
    fs.renameSync(tmp, f);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

/* 登记（或覆盖）一个子会话的分支出处。非法输入返回 false 不写盘。
   opts = { fromSession, fromIndex, anchorId? }；已有其它条目一字不改。 */
function register(baseDir, child, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const fromSession = typeof o.fromSession === 'string' ? o.fromSession.trim() : '';
  const fromIndex = Number(o.fromIndex);
  if (!isValidSessionId(child) || !isValidSessionId(fromSession)) return false;
  if (!Number.isInteger(fromIndex) || fromIndex < 0) return false;
  const map = read(baseDir);
  const entry = { fromSession: fromSession, fromIndex: fromIndex, createdAt: new Date().toISOString() };
  const anchorId = (o.anchorId == null) ? '' : String(o.anchorId).trim();
  if (anchorId) entry.anchorId = anchorId;
  map[child] = entry;
  writeAll(baseDir, map);
  return true;
}

/* 删除一个子会话的登记；删掉了返回 true，本来没有返回 false */
function removeChild(baseDir, child) {
  if (!isValidSessionId(child)) return false;
  const map = read(baseDir);
  if (!Object.prototype.hasOwnProperty.call(map, child)) return false;
  delete map[child];
  writeAll(baseDir, map);
  return true;
}

module.exports = { read, register, removeChild, isValidSessionId, branchesFile, SESSION_ID_RE };
