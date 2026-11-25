'use strict';
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
/* 笔记蒸馏·候选没进待审时不能把笔记标已蒸（11-15）
 * 覆盖：条级标记（失败候选只卡住它引用的那篇，同批其它笔记照常标已蒸）/
 *       快照与 notesDone 同批写（否则那篇会因「内容没变」从待蒸清单消失）/
 *       回执说清「没进待审 N 条、相关 X 篇下次还会蒸」/ 下次真的还在待蒸清单里
 * 全程临时目录，不碰线上 data；LLM、模型路由、门卫全部打桩，不发真请求。
 * 运行： node tests/distill-notes/test_notes_queue_fail.js
 */
const assert = require('assert');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const llmLog = require(path.join(ROOT, 'lib', 'llm_log'));
const modelRouter = require(path.join(ROOT, 'lib', 'model-router'));
const upstreamTarget = require(path.join(ROOT, 'lib', 'upstream-target'));
const createMemoryDistill = require(path.join(ROOT, 'lib', 'memory-distill'));

let fail = 0;
function ok(cond, name) { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fail++; }

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'distill-notes-'));
  fs.ensureDirSync(path.join(d, 'data'));
  return d;
}

const NOTES = [
  { id: 11, title: '橘猫', content: '涵 11-14 买了一只橘猫，取名团子，说以后每天早上要喂它。', created_at: '2026-11-14T09:00:00Z', updated_at: '2026-11-14T09:00:00Z' },
  { id: 12, title: '忌口', content: '约定以后不在她面前提香菜，闻到就难受。', created_at: '2026-11-14T10:00:00Z', updated_at: '2026-11-14T10:00:00Z' },
  { id: 13, title: '杂记', content: '今天在楼下便利店买了个新的马克杯，蓝色的。', created_at: '2026-11-14T11:00:00Z', updated_at: '2026-11-14T11:00:00Z' },
];

// LLM 返回两条候选，分别引用 note_11 / note_12；note_13 没产出候选
const LLM_RAW = JSON.stringify({
  candidates: [
    { text: '涵 11-14 买了一只橘猫，取名团子', kind: 'event', evidence: ['note_11'], confidence: 'high', triggers: ['橘猫'] },
    { text: '约定以后不在她面前提香菜', kind: 'rule', evidence: ['note_12'], confidence: 'high', triggers: ['香菜'] },
  ],
});

// ---- 打桩：LLM / 模型路由 / 上游出口（properties 在调用时取值，可直接覆盖） ----
const realPost = llmLog.post;
const realResolveRole = modelRouter.resolveRoleModel;
const realThinkingPatch = modelRouter.thinkingPatch;
const realResolveTarget = upstreamTarget.resolveTarget;
llmLog.post = async function () {
  return { status: 200, text: JSON.stringify({ choices: [{ message: { content: LLM_RAW }, finish_reason: 'stop' }] }) };
};
modelRouter.resolveRoleModel = function () { return { provider: { id: 'p_stub', name: '打桩供应商' }, model: 'stub-model' }; };
modelRouter.thinkingPatch = function () { return {}; };
upstreamTarget.resolveTarget = function () { return { url: 'https://stub.invalid/v1/chat/completions', key: 'sk-stub', headers: {}, viaProxy: false }; };

function mockAdmission() {
  const seen = [];
  return {
    seen: seen,
    // 引用橘猫那条（note_11）入队抛错，模拟门卫抖动；其它照常收
    submitPromotion: async function (body) {
      const text = String((body && body.content) || '');
      if (text.indexOf('橘猫') >= 0) throw new Error('mock：admission 抖动');
      seen.push(body);
      return { action: 'review', queue_id: 'q' + seen.length };
    },
  };
}

(async function () {
  const dir = tmpDir();
  fs.writeJsonSync(path.join(dir, 'data', 'papers.json'), { version: 1, next_id: 14, entries: NOTES }, { spaces: 2 });
  const adm = mockAdmission();
  const md = createMemoryDistill({ baseDir: dir, admission: adm });

  try {
    // ---------- 第一次：一条候选入队失败 ----------
    const r1 = await md.runNotes('manual', {});
    const done1 = Object.keys(md.readState().notesDone || {}).sort();
    const snap1 = fs.readJsonSync(path.join(dir, 'data', 'memory_distill_notes_snap.json'));

    ok(r1.ok === true, '跑完整体仍算跑过（不是整批炸掉）：' + JSON.stringify(r1.ok));
    ok(r1.candidates === 2 && r1.queued === 1 && r1.queueFailed === 1, '候选 2 条，进待审 1 条，失败 1 条（实际 ' + r1.candidates + '/' + r1.queued + '/' + r1.queueFailed + '）');
    ok(done1.join(',') === '12,13', '已蒸只标未受影响的 12、13，失败候选引用的 11 不标（实际 ' + done1.join(',') + '）');
    ok(!snap1['11'] && !!snap1['12'] && !!snap1['13'], '笔记快照也只为 12、13 刷新，11 不刷（否则会因「内容没变」从待蒸清单消失）');
    ok(/没进待审/.test(r1.note) && /下次还会蒸/.test(r1.note), '回执说清有候选没进待审、下次还会蒸：' + r1.note);
    ok(new RegExp('1 篇笔记这次没标已蒸').test(r1.note), '回执说清受影响 1 篇笔记');

    const pend1 = md.notesStatus().items.map(function (x) { return x.id; });
    ok(pend1.length === 1 && pend1[0] === 11, '待蒸清单只剩 11（12、13 已蒸完，内容未变不再出现）：' + JSON.stringify(pend1));

    // ---------- 第二次：失败那篇还在，真的会再蒸一次 ----------
    const r2 = await md.runNotes('manual', {});
    ok(r2.notes === 1 && r2.updated === 0, '下次只蒸那 1 篇（不是整批重来）：notes=' + r2.notes + ' updated=' + r2.updated);
    ok(r2.queueFailed === 1, '第二次仍然入队失败，11 继续留在待蒸清单');

    // ---------- 全成功对照组：三条都入队时照旧全标已蒸 ----------
    const dir2 = tmpDir();
    fs.writeJsonSync(path.join(dir2, 'data', 'papers.json'), { version: 1, next_id: 14, entries: NOTES }, { spaces: 2 });
    const md2 = createMemoryDistill({
      baseDir: dir2,
      admission: { submitPromotion: async function () { return { action: 'review', queue_id: 'q_ok' }; } },
    });
    const r3 = await md2.runNotes('manual', {});
    const done3 = Object.keys(md2.readState().notesDone || {}).sort();
    ok(r3.queueFailed === 0 && done3.join(',') === '11,12,13', '对照组：没有入队失败时三条都标已蒸（' + done3.join(',') + '）');
    ok(!/没进待审/.test(r3.note), '对照组回执不提失败');

    // ---------- 排障模式 noQueue：只看不写，一篇都不标 ----------
    const dir3 = tmpDir();
    fs.writeJsonSync(path.join(dir3, 'data', 'papers.json'), { version: 1, next_id: 14, entries: NOTES }, { spaces: 2 });
    const md3 = createMemoryDistill({ baseDir: dir3, admission: mockAdmission() });
    const r4 = await md3.runNotes('manual', { noQueue: true });
    ok(Object.keys(md3.readState().notesDone || {}).length === 0, 'noQueue 排障模式不写 notesDone');
    // 注意：快照文件本身可能已由读侧首次初始化建出来（改动前也一样），这里只看有没有真的写进这三篇
    let snap3 = null;
    try { snap3 = fs.readJsonSync(path.join(dir3, 'data', 'memory_distill_notes_snap.json')); } catch (e) { snap3 = null; }
    ok(!snap3 || Object.keys(snap3).length === 0, 'noQueue 排障模式不往笔记快照里写任何一篇：' + JSON.stringify(snap3 && Object.keys(snap3)));
    ok(r4.noQueue === true, '回执带 noQueue 标记');

    [dir, dir2, dir3].forEach(function (d) { try { fs.removeSync(d); } catch (e) {} });
  } finally {
    llmLog.post = realPost;
    modelRouter.resolveRoleModel = realResolveRole;
    modelRouter.thinkingPatch = realThinkingPatch;
    upstreamTarget.resolveTarget = realResolveTarget;
  }

  console.log(fail ? ('RESULT FAIL ' + fail) : 'RESULT ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error(e);
  try { llmLog.post = realPost; modelRouter.resolveRoleModel = realResolveRole; modelRouter.thinkingPatch = realThinkingPatch; upstreamTarget.resolveTarget = realResolveTarget; } catch (_e) {}
  process.exit(1);
});
