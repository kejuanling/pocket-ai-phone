/* 图片编辑器（附件缩略图点开）：画笔标记 / 批注 / 裁剪
   用法：openImgEditor(src) → Promise<dataURL | null>（取消返回 null）
   纯原生实现，无依赖；chat.html 与 phone-new.html 共用。
   2026-11-23：参考 iOS 标记页重构布局；新增可自由拖动与调整整体大小/颜色/底框的「批注」工具，支持撤销与重做。 */
(function () {
  'use strict';
  if (window.openImgEditor) return;
  var CSS = [
    '.ime-ov{position:fixed;inset:0;z-index:2000000000;background:#141416;display:flex;flex-direction:column;',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
      '-webkit-tap-highlight-color:transparent;overscroll-behavior:contain;user-select:none;-webkit-user-select:none;touch-action:none;animation:ime-in .2s ease}',
    '@keyframes ime-in{from{opacity:0}to{opacity:1}}',
    '.ime-ov [hidden]{display:none!important}',
    '.ime-top{position:relative;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 10px;color:#fff}',
    '.ime-title{position:absolute;left:50%;transform:translateX(-50%);font-size:17px;font-weight:500;letter-spacing:.06em;color:rgba(255,255,255,.92);pointer-events:none}',
    '.ime-cir{appearance:none;-webkit-appearance:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;',
      'background:rgba(255,255,255,.10);border:.5px solid rgba(255,255,255,.16);color:#fff;cursor:pointer;transition:transform .15s,background .15s}',
    '.ime-cir:active{transform:scale(.92);background:rgba(255,255,255,.20)}',
    '.ime-cir svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.ime-his{display:flex;align-items:center;height:44px;padding:0 4px;border-radius:999px;background:rgba(255,255,255,.10);border:.5px solid rgba(255,255,255,.16)}',
    '.ime-his button{appearance:none;-webkit-appearance:none;width:42px;height:36px;border:0;background:none;color:#fff;border-radius:999px;display:grid;place-items:center;cursor:pointer;transition:opacity .18s,background .15s}',
    '.ime-his button:active{background:rgba(255,255,255,.14)}',
    '.ime-his button[disabled]{opacity:.3;pointer-events:none}',
    '.ime-his svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.ime-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;padding:8px 14px}',
    '.ime-stack{position:relative;z-index:1;line-height:0;box-shadow:0 12px 44px rgba(0,0,0,.55);border-radius:8px}',
    '.ime-stack canvas{display:block;border-radius:8px}',
    '.ime-draw{position:absolute;left:0;top:0;touch-action:none;cursor:crosshair}',
    '.ime-txlayer{position:absolute;inset:0;overflow:hidden;border-radius:8px;pointer-events:none}',
    '.ime-txlayer.on{pointer-events:auto}',
    '.ime-tx{position:absolute;transform:translate(-50%,-50%);padding:4px 10px;border-radius:10px;white-space:pre-wrap;text-align:center;',
      'font-weight:700;line-height:1.25;max-width:92%;word-break:break-word;cursor:move;touch-action:none;pointer-events:auto;',
      'border:1.5px dashed transparent;transition:border-color .15s}',
    '.ime-tx.sel{border-color:rgba(255,255,255,.88);background-clip:padding-box}',
    '.ime-tx.st-stroke{text-shadow:0 2px 8px rgba(0,0,0,.78),0 0 2px rgba(0,0,0,.95)}',
    '.ime-tx.st-pill{background:rgba(18,18,22,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
    '.ime-tx-del,.ime-tx-rsz{position:absolute;width:24px;height:24px;border-radius:50%;display:none;place-items:center;border:0;padding:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.45)}',
    '.ime-tx.sel .ime-tx-del,.ime-tx.sel .ime-tx-rsz{display:grid}',
    '.ime-tx-del{right:-12px;top:-12px;background:#ff453a;color:#fff;font-size:14px;line-height:1}',
    '.ime-tx-rsz{right:-12px;bottom:-12px;background:#fff;color:#141416;cursor:nwse-resize;touch-action:none}',
    '.ime-tx-rsz svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    '.ime-crop{position:absolute;inset:0;cursor:move}',
    '.ime-crect{position:absolute;border:1.5px solid rgba(255,255,255,.95);box-shadow:0 0 0 9999px rgba(0,0,0,.62);cursor:move}',
    '.ime-crect::before,.ime-crect::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.32}',
    '.ime-crect::before{background:linear-gradient(to right,transparent 33.2%,#fff 33.2%,#fff calc(33.2% + 1px),transparent calc(33.2% + 1px),transparent 66.5%,#fff 66.5%,#fff calc(66.5% + 1px),transparent calc(66.5% + 1px))}',
    '.ime-crect::after{background:linear-gradient(to bottom,transparent 33.2%,#fff 33.2%,#fff calc(33.2% + 1px),transparent calc(33.2% + 1px),transparent 66.5%,#fff 66.5%,#fff calc(66.5% + 1px),transparent calc(66.5% + 1px))}',
    '.ime-h{position:absolute;width:24px;height:24px;border-radius:50%;background:transparent;display:grid;place-items:center}',
    '.ime-h::after{content:"";width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.45)}',
    '.ime-h[data-h="nw"]{left:-12px;top:-12px;cursor:nwse-resize}',
    '.ime-h[data-h="ne"]{right:-12px;top:-12px;cursor:nesw-resize}',
    '.ime-h[data-h="sw"]{left:-12px;bottom:-12px;cursor:nesw-resize}',
    '.ime-h[data-h="se"]{right:-12px;bottom:-12px;cursor:nwse-resize}',
    '.ime-bar{position:relative;z-index:3;padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:14px}',
    '.ime-sub{display:flex;align-items:center;justify-content:center;gap:12px;min-height:36px;flex-wrap:wrap}',
    '.ime-sub-col{display:flex;flex-direction:column;align-items:center;gap:10px}',
    '.ime-sws{display:flex;align-items:center;justify-content:center;gap:12px}',
    '.ime-sw{width:24px;height:24px;border-radius:50%;border:1.5px solid rgba(255,255,255,.28);cursor:pointer;display:inline-block;transition:transform .2s cubic-bezier(.2,.9,.3,1.2),border-color .15s,box-shadow .15s}',
    '.ime-sw.on{border:2.5px solid #fff;transform:scale(1.24);box-shadow:0 2px 10px rgba(0,0,0,.4)}',
    '.ime-wbtn{appearance:none;-webkit-appearance:none;height:30px;padding:0 11px;border-radius:999px;background:rgba(255,255,255,.10);border:.5px solid rgba(255,255,255,.16);',
      'color:#fff;display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;transition:background .15s}',
    '.ime-wbtn:active{background:rgba(255,255,255,.22)}',
    '.ime-wdot{display:inline-block;border-radius:50%;background:#fff;transition:width .18s,height .18s}',
    '.ime-tsize{display:flex;align-items:center;gap:8px;padding:0 10px;height:30px;border-radius:999px;background:rgba(255,255,255,.10);border:.5px solid rgba(255,255,255,.16);color:#fff;font-size:12px}',
    '.ime-tsize input{width:104px;accent-color:#fff;touch-action:pan-x}',
    '.ime-cact{appearance:none;-webkit-appearance:none;height:34px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:500;cursor:pointer;',
      'background:rgba(255,255,255,.11);border:.5px solid rgba(255,255,255,.18);color:#fff;transition:transform .15s,background .15s}',
    '.ime-cact:active{transform:scale(.95);background:rgba(255,255,255,.22)}',
    '.ime-cact.pri{background:#fff;color:#141416;border-color:#fff}',
    '.ime-dock{position:relative;display:flex;align-items:center;justify-content:flex-start;min-height:74px;padding-right:88px}',
    '.ime-tools{display:flex;align-items:center;gap:18px;margin:0 auto}',
    '.ime-tool{appearance:none;-webkit-appearance:none;border:0;background:none;padding:0;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;color:rgba(255,255,255,.68);transition:color .18s}',
    '.ime-tool i{width:50px;height:50px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.11);border:.5px solid rgba(255,255,255,.14);color:#fff;transition:background .2s,color .2s,transform .15s}',
    '.ime-tool:active i{transform:scale(.93)}',
    '.ime-tool.on{color:#fff}',
    '.ime-tool.on i{background:#fff;color:#141416;border-color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.35)}',
    '.ime-tool svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.ime-tool span{font-size:12px;letter-spacing:.04em}',
    '.ime-done{position:absolute;right:0;bottom:8px;appearance:none;-webkit-appearance:none;height:44px;padding:0 20px;border-radius:999px;border:0;',
      'background:#fff;color:#141416;font-size:15px;font-weight:600;letter-spacing:.04em;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.38);transition:transform .15s,opacity .15s}',
    '.ime-done:active{transform:scale(.95);opacity:.9}',
    '.ime-note{position:absolute;z-index:4;left:50%;top:calc(64px + env(safe-area-inset-top,0px));transform:translateX(-50%);',
      'background:rgba(28,28,32,.92);border:.5px solid rgba(255,255,255,.14);color:#fff;font-size:12.5px;padding:7px 14px;border-radius:999px;pointer-events:none;',
      'opacity:0;transition:opacity .22s;white-space:nowrap}',
    '.ime-note.show{opacity:1}',
    '.ime-edpop{position:absolute;inset:0;z-index:6;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:20px}',
    '.ime-edbox{width:min(320px,100%);background:#232328;border:.5px solid rgba(255,255,255,.16);border-radius:20px;padding:16px;display:flex;flex-direction:column;gap:12px;box-shadow:0 20px 50px rgba(0,0,0,.55)}',
    '.ime-edbox textarea{width:100%;box-sizing:border-box;min-height:76px;padding:10px 12px;border-radius:12px;border:.5px solid rgba(255,255,255,.18);',
      'background:rgba(255,255,255,.07);color:#fff;font:500 16px/1.45 inherit;outline:0;resize:none;user-select:text;-webkit-user-select:text}',
    '.ime-edbox .ebts{display:flex;justify-content:flex-end;gap:8px}'
  ].join('');

  var ICO = {
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a5.5 5.5 0 0 1 0 11H11"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a5.5 5.5 0 0 0 0 11h3"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M4 19.5c2-1 3.5-2.8 4.8-5.2 1.2-2.2 2.4-3.8 3.6-3.8 1.3 0 1.4 2.1.2 4.1-.9 1.5-.3 2.9 1.2 2.9 1.8 0 3.7-2.2 6.2-5.5"/><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L14 13l-3.5.5.5-3.5Z"/></svg>',
    text: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.5" stroke-dasharray="3 2.5"/><path d="M8.5 9h7M12 9v7"/></svg>',
    crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    rsz: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
  };

  function openImgEditor(src) {
    return new Promise(function (resolve) {
      var SWHTML =
        '<div class="ime-sws">' +
          '<span class="ime-sw" data-c="#111111" style="background:#111111"></span>' +
          '<span class="ime-sw on" data-c="#FF453A" style="background:#FF453A"></span>' +
          '<span class="ime-sw" data-c="#FFD60A" style="background:#FFD60A"></span>' +
          '<span class="ime-sw" data-c="#30D158" style="background:#30D158"></span>' +
          '<span class="ime-sw" data-c="#0A84FF" style="background:#0A84FF"></span>' +
          '<span class="ime-sw" data-c="#BF5AF2" style="background:#BF5AF2"></span>' +
          '<span class="ime-sw" data-c="#FFFFFF" style="background:#FFFFFF"></span>' +
        '</div>';
      var ov = document.createElement('div'); ov.className = 'ime-ov';
      ov.innerHTML =
        '<div class="ime-top">' +
          '<button type="button" class="ime-cir" data-x="cancel" aria-label="取消">' + ICO.x + '</button>' +
          '<div class="ime-title">标记</div>' +
          '<div class="ime-his">' +
            '<button type="button" data-x="undo" aria-label="撤销" disabled>' + ICO.undo + '</button>' +
            '<button type="button" data-x="redo" aria-label="重做" disabled>' + ICO.redo + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="ime-stage"><div class="ime-stack">' +
          '<canvas class="ime-base"></canvas><canvas class="ime-draw"></canvas>' +
          '<div class="ime-txlayer"></div>' +
          '<div class="ime-crop" hidden><div class="ime-crect">' +
            '<i class="ime-h" data-h="nw"></i><i class="ime-h" data-h="ne"></i>' +
            '<i class="ime-h" data-h="sw"></i><i class="ime-h" data-h="se"></i></div></div>' +
        '</div></div>' +
        '<div class="ime-bar">' +
          '<div class="ime-sub" data-p="draw">' +
            SWHTML +
            '<button type="button" class="ime-wbtn" data-x="width" aria-label="切换笔触粗细"><i class="ime-wdot" style="width:7px;height:7px"></i><span data-wl>中</span></button>' +
          '</div>' +
          '<div class="ime-sub ime-sub-col" data-p="text" hidden>' +
            SWHTML +
            '<div class="ime-sub" style="min-height:0;gap:8px">' +
              '<label class="ime-tsize"><span>大小</span><input type="range" id="imeTsz" min="14" max="72" value="28"></label>' +
              '<button type="button" class="ime-wbtn" data-x="tstyle"><span data-tsl>描边</span></button>' +
              '<button type="button" class="ime-wbtn" data-x="tadd">+ 批注</button>' +
            '</div>' +
          '</div>' +
          '<div class="ime-sub" data-p="crop" hidden>' +
            '<button type="button" class="ime-cact" data-x="cropReset">重置选区</button>' +
            '<button type="button" class="ime-cact pri" data-x="cropOk">应用裁剪</button>' +
          '</div>' +
          '<div class="ime-dock">' +
            '<div class="ime-tools">' +
              '<button type="button" class="ime-tool on" data-m="draw"><i>' + ICO.pen + '</i><span>画笔</span></button>' +
              '<button type="button" class="ime-tool" data-m="text"><i>' + ICO.text + '</i><span>批注</span></button>' +
              '<button type="button" class="ime-tool" data-m="crop"><i>' + ICO.crop + '</i><span>裁剪</span></button>' +
            '</div>' +
            '<button type="button" class="ime-done" data-x="done">完成</button>' +
          '</div>' +
        '</div>' +
        '<div class="ime-note"></div>';
      document.body.appendChild(ov);

      var baseC = ov.querySelector('.ime-base'), drawC = ov.querySelector('.ime-draw');
      var bctx = baseC.getContext('2d'), dctx = drawC.getContext('2d');
      var txLayer = ov.querySelector('.ime-txlayer');
      var cropEl = ov.querySelector('.ime-crop'), rectEl = ov.querySelector('.ime-crect');
      var noteEl = ov.querySelector('.ime-note'), tszIn = ov.querySelector('#imeTsz');
      var undoBtn = ov.querySelector('[data-x="undo"]'), redoBtn = ov.querySelector('[data-x="redo"]');
      var img = new Image(); var mode = 'draw'; var color = '#FF453A';
      var strokes = []; var annots = []; var selIdx = -1;
      var hist = []; var redoHist = [];
      var W_IDX = 1, WIDTHS = [3, 6, 11], W_DOTS = [4, 7, 11], W_NAMES = ['细', '中', '粗'];
      var T_STYLES = ['stroke', 'pill', 'plain'], T_SLABS = ['描边', '底框', '纯字'];
      var rect = null, noteT = null, closed = false;

      function snap() { return { s: strokes.map(function (x) { return { c: x.c, w: x.w, p: x.p.slice() }; }), a: annots.map(function (x) { return Object.assign({}, x); }) }; }
      function pushHist() { hist.push(snap()); if (hist.length > 40) hist.shift(); redoHist = []; syncHis(); }
      function applySnap(st) { strokes = st.s; annots = st.a; if (selIdx >= annots.length) selIdx = annots.length - 1; repaint(); renderTx(); syncHis(); }
      function syncHis() {
        if (undoBtn) undoBtn.disabled = !hist.length;
        if (redoBtn) redoBtn.disabled = !redoHist.length;
      }
      function close(v) { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); }
      function note(t, longer) { noteEl.textContent = t; noteEl.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(function () { noteEl.classList.remove('show'); }, longer ? 3200 : 1600); }
      function onKey(e) { if (e.key === 'Escape' && !ov.querySelector('.ime-edpop')) close(null); }
      document.addEventListener('keydown', onKey, true);

      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { note('图片加载失败'); setTimeout(function () { close(null); }, 900); return; }
        var kk = Math.min(1, 2200 / Math.max(w, h));
        w = Math.max(1, Math.round(w * kk)); h = Math.max(1, Math.round(h * kk));
        baseC.width = w; baseC.height = h; drawC.width = w; drawC.height = h;
        bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, w, h); bctx.drawImage(img, 0, 0, w, h);
        fit();
        if (/^data:image\/gif/i.test(src || '')) note('动图编辑后会变成静图', true);
      };
      img.onerror = function () { note('图片加载失败'); setTimeout(function () { close(null); }, 900); };
      img.src = src;

      function fit() {
        var stage = ov.querySelector('.ime-stage');
        var aw = stage.clientWidth - 16, ah = stage.clientHeight - 16;
        if (aw <= 0 || ah <= 0) return;
        var kk = Math.min(aw / baseC.width, ah / baseC.height);
        var wpx = (baseC.width * kk) + 'px', hpx = (baseC.height * kk) + 'px';
        baseC.style.width = wpx; baseC.style.height = hpx;
        drawC.style.width = wpx; drawC.style.height = hpx;
        if (mode === 'crop') placeRect();
        renderTx();
      }
      var onWinResize = function () { if (closed) { window.removeEventListener('resize', onWinResize); return; } fit(); };
      window.addEventListener('resize', onWinResize);

      function pxk() { return baseC.width / (baseC.clientWidth || 1); }

      function repaint() {
        dctx.clearRect(0, 0, drawC.width, drawC.height);
        dctx.lineCap = 'round'; dctx.lineJoin = 'round';
        strokes.forEach(function (s) {
          dctx.strokeStyle = s.c; dctx.lineWidth = s.w;
          dctx.beginPath();
          s.p.forEach(function (pt, i) { if (i) dctx.lineTo(pt.x, pt.y); else dctx.moveTo(pt.x, pt.y); });
          if (s.p.length === 1) dctx.lineTo(s.p[0].x + 0.1, s.p[0].y + 0.1);
          dctx.stroke();
        });
      }

      /* ── 批注渲染与交互 ── */
      function syncTextControls() {
        var a = annots[selIdx];
        if (!a) return;
        if (tszIn) tszIn.value = String(Math.round(a.sz));
        var tsl = ov.querySelector('[data-tsl]');
        if (tsl) tsl.textContent = T_SLABS[a.st || 0];
        syncSwatches(a.c);
      }
      function renderTx() {
        txLayer.innerHTML = '';
        annots.forEach(function (a, i) {
          var el = document.createElement('div');
          el.className = 'ime-tx st-' + T_STYLES[a.st || 0] + (mode === 'text' && i === selIdx ? ' sel' : '');
          el.setAttribute('data-ti', String(i));
          el.style.left = (a.rx * 100) + '%';
          el.style.top = (a.ry * 100) + '%';
          el.style.fontSize = Math.round(a.sz) + 'px';
          el.style.color = a.c;
          el.textContent = a.t;
          var del = document.createElement('button');
          del.type = 'button'; del.className = 'ime-tx-del'; del.setAttribute('data-tdel', String(i)); del.textContent = '×';
          var rsz = document.createElement('span');
          rsz.className = 'ime-tx-rsz'; rsz.setAttribute('data-trsz', String(i)); rsz.innerHTML = ICO.rsz;
          el.appendChild(del); el.appendChild(rsz);
          txLayer.appendChild(el);
        });
        syncTextControls();
      }
      function openTextPrompt(idx) {
        var isNew = idx == null || idx < 0, curA = isNew ? null : annots[idx];
        var pop = document.createElement('div'); pop.className = 'ime-edpop';
        pop.innerHTML = '<div class="ime-edbox"><textarea placeholder="输入批注文字…">' + (curA ? curA.t.replace(/</g, '&lt;') : '') + '</textarea><div class="ebts"><button type="button" class="ime-cact" data-eb="no">取消</button><button type="button" class="ime-cact pri" data-eb="ok">确定</button></div></div>';
        ov.appendChild(pop);
        var ta = pop.querySelector('textarea');
        setTimeout(function () { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }, 40);
        pop.addEventListener('click', function (e) {
          var b = e.target.closest('[data-eb]');
          if (e.target === pop || (b && b.getAttribute('data-eb') === 'no')) { pop.remove(); return; }
          if (b && b.getAttribute('data-eb') === 'ok') {
            var val = (ta.value || '').trim();
            pop.remove();
            if (!val) return;
            pushHist();
            if (isNew) {
              var sz0 = tszIn ? (+tszIn.value || 28) : 28;
              annots.push({ t: val, rx: 0.5, ry: Math.min(0.8, 0.38 + (annots.length % 4) * 0.1), sz: sz0, c: color, st: 0 });
              selIdx = annots.length - 1;
            } else {
              annots[idx].t = val;
              selIdx = idx;
            }
            renderTx();
          }
        });
      }
      txLayer.addEventListener('pointerdown', function (e) {
        if (mode !== 'text') return;
        var del = e.target.closest('[data-tdel]');
        if (del) { e.preventDefault(); e.stopPropagation(); var di = +del.getAttribute('data-tdel'); pushHist(); annots.splice(di, 1); selIdx = annots.length - 1; renderTx(); return; }
        var rsz = e.target.closest('[data-trsz]');
        if (rsz) {
          e.preventDefault(); e.stopPropagation();
          var ri = +rsz.getAttribute('data-trsz'), a = annots[ri]; if (!a) return;
          selIdx = ri; renderTx();
          var sx = e.clientX, sy = e.clientY, sz0 = a.sz, moved = false;
          function rmv(ev) {
            var d = ((ev.clientX - sx) + (ev.clientY - sy)) * 0.25;
            if (!moved && Math.abs(d) > 1) { pushHist(); moved = true; }
            a.sz = Math.max(14, Math.min(72, Math.round(sz0 + d)));
            var el2 = txLayer.querySelector('[data-ti="' + ri + '"]');
            if (el2) el2.style.fontSize = a.sz + 'px';
            if (tszIn) tszIn.value = String(a.sz);
          }
          function rup() { window.removeEventListener('pointermove', rmv, true); window.removeEventListener('pointerup', rup, true); }
          window.addEventListener('pointermove', rmv, true); window.addEventListener('pointerup', rup, true);
          return;
        }
        var item = e.target.closest('.ime-tx');
        if (!item) { selIdx = -1; renderTx(); return; }
        e.preventDefault(); e.stopPropagation();
        var ti = +item.getAttribute('data-ti'), a2 = annots[ti]; if (!a2) return;
        var wasSel = (selIdx === ti);
        selIdx = ti; renderTx();
        var rectL = txLayer.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, rx0 = a2.rx, ry0 = a2.ry, dragged = false;
        function dmv(ev) {
          var dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (!dragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) { pushHist(); dragged = true; }
          if (!dragged) return;
          a2.rx = Math.max(0.06, Math.min(0.94, rx0 + dx / Math.max(1, rectL.width)));
          a2.ry = Math.max(0.06, Math.min(0.94, ry0 + dy / Math.max(1, rectL.height)));
          var el3 = txLayer.querySelector('[data-ti="' + ti + '"]');
          if (el3) { el3.style.left = (a2.rx * 100) + '%'; el3.style.top = (a2.ry * 100) + '%'; }
        }
        function dup() {
          window.removeEventListener('pointermove', dmv, true); window.removeEventListener('pointerup', dup, true);
          if (!dragged && wasSel) openTextPrompt(ti);
        }
        window.addEventListener('pointermove', dmv, true); window.addEventListener('pointerup', dup, true);
      });
      if (tszIn) {
        var tszPushed = false;
        tszIn.addEventListener('pointerdown', function () { tszPushed = false; });
        tszIn.addEventListener('input', function () {
          var a = annots[selIdx]; if (!a) return;
          if (!tszPushed) { pushHist(); tszPushed = true; }
          a.sz = +tszIn.value;
          var el = txLayer.querySelector('[data-ti="' + selIdx + '"]');
          if (el) el.style.fontSize = a.sz + 'px';
        });
      }

      /* ── 画笔 ── */
      var cur = null;
      function ptOf(e) {
        var r = drawC.getBoundingClientRect(), kk = pxk();
        return { x: Math.min(drawC.width, Math.max(0, (e.clientX - r.left) * kk)), y: Math.min(drawC.height, Math.max(0, (e.clientY - r.top) * kk)) };
      }
      drawC.addEventListener('pointerdown', function (e) {
        if (mode !== 'draw') return; e.preventDefault();
        try { drawC.setPointerCapture(e.pointerId); } catch (_) {}
        pushHist();
        cur = { c: color, w: Math.max(1.5, WIDTHS[W_IDX] * pxk()), p: [ptOf(e)] }; strokes.push(cur); repaint();
      });
      drawC.addEventListener('pointermove', function (e) { if (mode !== 'draw' || !cur) return; e.preventDefault(); cur.p.push(ptOf(e)); repaint(); });
      function endStroke() { cur = null; }
      drawC.addEventListener('pointerup', endStroke);
      drawC.addEventListener('pointercancel', endStroke);

      /* ── 裁剪 ── */
      function placeRect() {
        if (!rect) return;
        var kk = pxk();
        rectEl.style.left = (rect.x / kk) + 'px'; rectEl.style.top = (rect.y / kk) + 'px';
        rectEl.style.width = (rect.w / kk) + 'px'; rectEl.style.height = (rect.h / kk) + 'px';
      }
      function initRect() {
        rect = { x: baseC.width * 0.08, y: baseC.height * 0.08, w: baseC.width * 0.84, h: baseC.height * 0.84 };
        placeRect();
      }
      function clampRect() {
        var MIN = 40 * pxk(), w = baseC.width, h = baseC.height;
        rect.w = Math.min(Math.max(rect.w, MIN), w); rect.h = Math.min(Math.max(rect.h, MIN), h);
        rect.x = Math.min(Math.max(rect.x, 0), w - rect.w); rect.y = Math.min(Math.max(rect.y, 0), h - rect.h);
      }
      function dragCrop(e, target) {
        e.preventDefault();
        var start = { x: e.clientX, y: e.clientY }, r0 = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, kk = pxk();
        function mv(ev) {
          var dx = (ev.clientX - start.x) * kk, dy = (ev.clientY - start.y) * kk;
          if (target === 'move') { rect.x = r0.x + dx; rect.y = r0.y + dy; }
          else {
            if (target.indexOf('w') >= 0) { rect.x = r0.x + dx; rect.w = r0.w - dx; }
            if (target.indexOf('e') >= 0) { rect.w = r0.w + dx; }
            if (target.indexOf('n') >= 0) { rect.y = r0.y + dy; rect.h = r0.h - dy; }
            if (target.indexOf('s') >= 0) { rect.h = r0.h + dy; }
          }
          clampRect(); placeRect();
        }
        function up() { window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); }
        window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true);
      }
      rectEl.addEventListener('pointerdown', function (e) { if (mode !== 'crop') return; e.preventDefault(); dragCrop(e, 'move'); });
      Array.prototype.forEach.call(ov.querySelectorAll('.ime-h'), function (hd) {
        hd.addEventListener('pointerdown', function (e) {
          if (mode !== 'crop') return; e.preventDefault(); e.stopPropagation();
          dragCrop(e, hd.getAttribute('data-h'));
        });
      });
      function drawAnnotsTo(fx, kk) {
        annots.forEach(function (a) {
          var fs = Math.round(a.sz * kk), lh = Math.round(fs * 1.25);
          fx.save();
          fx.font = '700 ' + fs + 'px -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
          fx.textAlign = 'center'; fx.textBaseline = 'middle';
          var lines = String(a.t || '').split('\n');
          var cx = a.rx * baseC.width, cy = a.ry * baseC.height;
          var maxW = 0; lines.forEach(function (ln) { maxW = Math.max(maxW, fx.measureText(ln).width); });
          var totH = lines.length * lh;
          if (a.st === 1) {
            var px = Math.round(10 * kk), py = Math.round(6 * kk), rr = Math.round(10 * kk);
            var bx = cx - maxW / 2 - px, by = cy - totH / 2 - py, bw = maxW + px * 2, bh = totH + py * 2;
            fx.fillStyle = 'rgba(18,18,22,0.78)';
            fx.beginPath();
            if (fx.roundRect) fx.roundRect(bx, by, bw, bh, rr);
            else fx.rect(bx, by, bw, bh);
            fx.fill();
          }
          lines.forEach(function (ln, li) {
            var y = cy - totH / 2 + lh * (li + 0.5);
            if (!a.st) {
              fx.lineJoin = 'round';
              fx.lineWidth = Math.max(2, fs * 0.14);
              fx.strokeStyle = 'rgba(0,0,0,0.82)';
              fx.strokeText(ln, cx, y);
            }
            fx.fillStyle = a.c;
            fx.fillText(ln, cx, y);
          });
          fx.restore();
        });
      }
      function composeFlat() {
        var flat = document.createElement('canvas'); flat.width = baseC.width; flat.height = baseC.height;
        var fx = flat.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, flat.width, flat.height);
        fx.drawImage(baseC, 0, 0); fx.drawImage(drawC, 0, 0);
        drawAnnotsTo(fx, pxk());
        return flat;
      }
      function doCrop(silent) {
        if (!rect) return;
        var sx = Math.max(0, Math.round(rect.x)), sy = Math.max(0, Math.round(rect.y));
        var sw = Math.max(1, Math.min(baseC.width - sx, Math.round(rect.w)));
        var sh = Math.max(1, Math.min(baseC.height - sy, Math.round(rect.h)));
        var flat = composeFlat();
        var nc = document.createElement('canvas'); nc.width = sw; nc.height = sh;
        nc.getContext('2d').drawImage(flat, sx, sy, sw, sh, 0, 0, sw, sh);
        baseC.width = sw; baseC.height = sh; drawC.width = sw; drawC.height = sh;
        bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, sw, sh); bctx.drawImage(nc, 0, 0);
        strokes = []; annots = []; selIdx = -1; hist = []; redoHist = []; rect = null; syncHis();
        if (!silent) { setMode('draw'); fit(); note('已裁剪'); }
      }

      /* ── 模式与按钮 ── */
      function syncSwatches(c) {
        Array.prototype.forEach.call(ov.querySelectorAll('.ime-sw'), function (x) { x.classList.toggle('on', x.getAttribute('data-c') === c); });
      }
      function setMode(m) {
        mode = m;
        Array.prototype.forEach.call(ov.querySelectorAll('.ime-tool'), function (t) { t.classList.toggle('on', t.getAttribute('data-m') === m); });
        ov.querySelector('[data-p="draw"]').hidden = m !== 'draw';
        ov.querySelector('[data-p="text"]').hidden = m !== 'text';
        ov.querySelector('[data-p="crop"]').hidden = m !== 'crop';
        cropEl.hidden = m !== 'crop';
        txLayer.classList.toggle('on', m === 'text');
        if (m === 'crop' && !rect) initRect();
        if (m === 'crop') placeRect();
        drawC.style.pointerEvents = m === 'draw' ? 'auto' : 'none';
        renderTx();
      }
      setMode('draw');
      Array.prototype.forEach.call(ov.querySelectorAll('.ime-tool'), function (t) {
        t.addEventListener('click', function () {
          var m = t.getAttribute('data-m');
          if (m === 'text') {
            if (mode !== 'text') {
              setMode('text');
              if (!annots.length) openTextPrompt(-1);
              else if (selIdx < 0) { selIdx = annots.length - 1; renderTx(); }
            } else {
              setMode('view');
            }
            return;
          }
          setMode(m === mode ? 'view' : m);
        });
      });
      Array.prototype.forEach.call(ov.querySelectorAll('.ime-sw'), function (s) {
        s.addEventListener('click', function () {
          color = s.getAttribute('data-c');
          syncSwatches(color);
          if (mode === 'text' && annots[selIdx]) {
            pushHist();
            annots[selIdx].c = color;
            renderTx();
          } else if (mode !== 'draw' && mode !== 'text') {
            setMode('draw');
          }
        });
      });
      ov.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-x]') : null; if (!b) return;
        var x = b.getAttribute('data-x');
        if (x === 'cancel') close(null);
        else if (x === 'done') { if (mode === 'crop' && rect) doCrop(true); close(composeFlat().toDataURL('image/jpeg', 0.92)); }
        else if (x === 'undo') { if (!hist.length) return; redoHist.push(snap()); applySnap(hist.pop()); }
        else if (x === 'redo') { if (!redoHist.length) return; hist.push(snap()); applySnap(redoHist.pop()); }
        else if (x === 'width') {
          W_IDX = (W_IDX + 1) % WIDTHS.length;
          var dot = ov.querySelector('.ime-wdot'), wl = ov.querySelector('[data-wl]');
          if (dot) { dot.style.width = W_DOTS[W_IDX] + 'px'; dot.style.height = W_DOTS[W_IDX] + 'px'; }
          if (wl) wl.textContent = W_NAMES[W_IDX];
          note('笔触：' + W_NAMES[W_IDX]);
        }
        else if (x === 'tadd') openTextPrompt(-1);
        else if (x === 'tstyle') {
          var a = annots[selIdx]; if (!a) { note('先添加一个批注'); return; }
          pushHist(); a.st = ((a.st || 0) + 1) % T_STYLES.length; renderTx();
        }
        else if (x === 'cropReset') initRect();
        else if (x === 'cropOk') doCrop(false);
      });
    });
  }
  var st = document.createElement('style'); st.id = 'ime-css'; st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);
  window.openImgEditor = openImgEditor;
})();
