'use strict';
// 标星正文入库前的清洗（1018）：存进 marks 文件就是干净的，注入时不再现拼。
// 去 <current_time>…</current_time>、<voice> 标签、正文自带的 --- 横线，压掉多余空行。
function cleanDialogText(text) {
  return String(text || '')
    .replace(/<current_time>[\s\S]*?<\/current_time>/g, '')
    .replace(/<\/?voice>/g, '')
    .replace(/^[ \t]*-{3,}[ \t]*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// marks 按真实时刻升序重排（无 time 用 markedAt；解析不了的排最前、彼此保持原顺序）
function sortMarks(marks) {
  const t = (e) => { const v = Date.parse((e && (e.time || e.markedAt)) || ''); return isNaN(v) ? -Infinity : v; };
  const out = {};
  Object.keys(marks || {})
    .map((k, i) => ({ k, i, t: t(marks[k]) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : (a.t < b.t ? -1 : 1)))
    .forEach((x) => { out[x.k] = marks[x.k]; });
  return out;
}

module.exports = { cleanDialogText, sortMarks };
