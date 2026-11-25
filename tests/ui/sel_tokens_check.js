// [位置:tests/ui/sel_tokens_check.js] [4b选中态token只读断言] [断言 --sel-bg/--sel-ring/--sel-dim 定义在 phone-new.html :root 且值非空，且各 CSS 有真实使用；node 直跑只读不改] [批次4b] [注释时间 2026-11-14]
var fs = require('fs'), path = require('path');
var WS = path.join(__dirname, '..', '..', 'workspace');
var bad = false;
function ok(c, m) { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad = true; }

var html = fs.readFileSync(path.join(WS, 'phone-new.html'), 'utf8');
var iRoot = html.indexOf(':root{');
ok(iRoot >= 0, 'phone-new.html 有 :root 块');
if (iRoot >= 0) {
  var root = html.slice(iRoot + 6, html.indexOf('}', iRoot));
  ['--sel-bg', '--sel-ring', '--sel-dim'].forEach(function (t) {
    var i = root.indexOf(t + ':');
    var v = '';
    if (i >= 0) { var seg = root.slice(i + t.length + 1); v = seg.slice(0, seg.search(/[;,]/)).trim(); }
    ok(i >= 0 && v !== '', 'token ' + t + ' 定义在 :root 且值非空（' + (v || '缺失') + '）');
  });
}

// token 在 CSS 里有真实使用（防止定义了没人用；排除注释行里的提及）
var cssFiles = fs.readdirSync(WS).filter(function (f) { return /^phone-.*\.css$/.test(f); });
var use = { '--sel-bg': 0, '--sel-ring': 0, '--sel-dim': 0 };
cssFiles.forEach(function (f) {
  fs.readFileSync(path.join(WS, f), 'utf8').split('\n').forEach(function (line) {
    if (line.indexOf('/*') >= 0 && line.indexOf('*/') >= 0) line = line.slice(0, line.indexOf('/*')); // 去行内注释
    Object.keys(use).forEach(function (t) { if (line.indexOf('var(' + t + ')') >= 0) use[t]++; });
  });
});
Object.keys(use).forEach(function (t) { ok(use[t] > 0, t + ' 在 CSS 里有真实使用（' + use[t] + ' 行）'); });

process.exit(bad ? 1 : 0);
