"use strict";

const assert = require("assert");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const notebooks = require("../../lib/notebooks");
const papers = require("../../lib/papers");
const { createSessionCfg } = require("../../lib/session-cfg");
const shadow = require("../../context/context-v2-shadow");

function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "multi-nb-test-"));
  fs.ensureDirSync(path.join(base, "data"));

  // 1. Registry CRUD
  assert.strictEqual(notebooks.list(base).length, 1);
  assert.strictEqual(notebooks.list(base)[0].id, "default");

  const c1 = notebooks.create(base, "干活的");
  assert.ok(c1.ok && c1.notebook && c1.notebook.id.startsWith("nb_"));
  const nbWork = c1.notebook.id;

  const dup = notebooks.create(base, "干活的");
  assert.strictEqual(dup.ok, false, "duplicate name should fail");

  const r1 = notebooks.rename(base, nbWork, "工作笔记");
  assert.ok(r1.ok && r1.notebook.name === "工作笔记");

  // 2. Complete data isolation via withBaseDir
  const defAdd = papers.withBaseDir(base, () => papers.portalAdd({ title: "默认笔记", content: "DEFAULT_NOTE_BODY", summary: "默认摘要" }));
  assert.ok(defAdd.ok);
  papers.withBaseDir(base, () => papers.pinPaper(defAdd.id, true));

  const workDir = notebooks.resolveBaseDir(base, nbWork);
  const workAdd = papers.withBaseDir(workDir, () => papers.portalAdd({ title: "工作任务", content: "WORK_NOTE_BODY", summary: "工作摘要" }));
  assert.ok(workAdd.ok);
  papers.withBaseDir(workDir, () => papers.pinPaper(workAdd.id, true));

  const defList = papers.withBaseDir(base, () => papers.portalList().filter(e => !e.is_index));
  const workList = papers.withBaseDir(workDir, () => papers.portalList().filter(e => !e.is_index));
  assert.strictEqual(defList.length, 1);
  assert.strictEqual(defList[0].title, "默认笔记");
  assert.strictEqual(workList.length, 1);
  assert.strictEqual(workList[0].title, "工作任务");

  // 3. Session binding & context-v2-shadow isolation
  const scfg = createSessionCfg(base);
  scfg.saveNotebookId("s_def", "default");
  scfg.saveNotebookId("s_work", nbWork);
  scfg.saveNotebookId("s_none", "none");

  const inDef = shadow.assembleInput({ baseDir: base, sessionId: "s_def", llmMessages: [], loadTimeline: () => [], normalizeContentToText: s => s });
  const inWork = shadow.assembleInput({ baseDir: base, sessionId: "s_work", llmMessages: [], loadTimeline: () => [], normalizeContentToText: s => s });
  const inNone = shadow.assembleInput({ baseDir: base, sessionId: "s_none", llmMessages: [], loadTimeline: () => [], normalizeContentToText: s => s });

  assert.ok(inDef.notebookLines.join("\n").includes("默认笔记"));
  assert.ok(!inDef.notebookLines.join("\n").includes("工作任务"));
  assert.ok(inDef.pinnedNotesLines.join("\n").includes("DEFAULT_NOTE_BODY"));

  assert.ok(inWork.notebookLines.join("\n").includes("工作任务"));
  assert.ok(!inWork.notebookLines.join("\n").includes("默认笔记"));
  assert.ok(inWork.pinnedNotesLines.join("\n").includes("WORK_NOTE_BODY"));
  assert.ok(!inWork.pinnedNotesLines.join("\n").includes("DEFAULT_NOTE_BODY"));

  assert.strictEqual(inNone.notebookLines.length, 0, "none binding must inject no notebook index");
  assert.strictEqual(inNone.pinnedNotesLines.length, 0, "none binding must inject no pinned notes");

  // 4. Delete custom notebook (with backup) & protect default
  assert.strictEqual(notebooks.remove(base, "default").ok, false);
  const del = notebooks.remove(base, nbWork);
  assert.ok(del.ok);
  assert.strictEqual(notebooks.list(base).length, 1);

  fs.removeSync(base);
  console.log("ALL MULTI-NOTEBOOK TESTS PASSED");
}

main();
