/* 表情包裁剪器（微信式）：固定取景框，图片缩放平移对准画面
   [位置:workspace/sticker-cropper.js] [openStickerCropper(src, opts) → Promise<jpeg dataURL|null>（取消返回 null）]
   [11-08：表情包新增的裁剪交互，参考微信添加表情——框不动、图动：单指平移、双指捏合缩放、
   双击在「铺满」和「放大两倍」之间切换；图片不许缩到露出框外（cover 约束）；
   完成输出 160x160 jpeg，与现有表情同规格。纯原生无依赖，只给表情包新增用（聊天附件裁剪走 img-editor.js 不动）]
   [2026-11-16 批2 E2 参数化] opts={title,aspect,outLong}：不传=原行为零变化（方形框、160 输出、标题「裁剪表情」）；
   aspect=宽/高（如聊天背景传 390/844 竖构图），outLong=输出长边 px（聊天背景 1280，与 shrink 同规格）；
   框体从正方形换成按 aspect 的矩形，其余手势/约束/映射公式同源。批 3 K3 换桌面图标可继续用缺省方形。
   [注释时间 2026-11-08；2026-11-16 参数化] */
(function () {
  'use strict';
  if (window.openStickerCropper) return;

  var CSS = [
    '.stkcv-ov{position:fixed;inset:0;z-index:2000000001;background:#0b0b0d;display:flex;flex-direction:column;',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
      '-webkit-tap-highlight-color:transparent;overscroll-behavior:contain;user-select:none;-webkit-user-select:none;animation:stkcv-in .18s ease}',
    '@keyframes stkcv-in{from{opacity:0}to{opacity:1}}',
    '.stkcv-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px}',
    '.stkcv-title{flex:1;text-align:center;font-size:14px;color:rgba(255,255,255,.85)}',
    '.stkcv-btn{appearance:none;-webkit-appearance:none;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;',
      'border-radius:999px;padding:8px 14px;font-size:13px;line-height:1;cursor:pointer}',
    '.stkcv-btn:active{background:rgba(255,255,255,.22)}',
    '.stkcv-done{background:#3478F6;border-color:#3478F6;font-weight:600}',
    '.stkcv-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;padding:16px;touch-action:none}',
    /* wrap 即取景框：框外压暗走大扩散 box-shadow（同 img-editor 的思路），白细线描边+四角白色角标 */
    '.stkcv-wrap{position:relative;line-height:0;box-shadow:0 0 0 9999px rgba(0,0,0,.55);outline:1px solid rgba(255,255,255,.3);touch-action:none;cursor:move}',
    '.stkcv-wrap img{position:absolute;left:0;top:0;max-width:none;pointer-events:none;will-change:transform}',
    '.stkcv-c{position:absolute;width:20px;height:20px;pointer-events:none}',
    '.stkcv-c.tl{left:-2px;top:-2px;border-left:2.5px solid #fff;border-top:2.5px solid #fff}',
    '.stkcv-c.tr{right:-2px;top:-2px;border-right:2.5px solid #fff;border-top:2.5px solid #fff}',
    '.stkcv-c.bl{left:-2px;bottom:-2px;border-left:2.5px solid #fff;border-bottom:2.5px solid #fff}',
    '.stkcv-c.br{right:-2px;bottom:-2px;border-right:2.5px solid #fff;border-bottom:2.5px solid #fff}',
    '.stkcv-tip{padding:10px 0 calc(20px + env(safe-area-inset-bottom,0px));text-align:center;font-size:12px;color:rgba(255,255,255,.4)}'
  ].join('');

  function openStickerCropper(src, opts) {
    opts = opts || {};
    var TITLE = opts.title || '裁剪表情';
    var ASP = opts.aspect || 1;              /* 取景框宽/高，1=方形（默认） */
    var OUTS = opts.outLong || 0;            /* 有值=按长边出图（矩形框）；0=方形 160（表情规格） */
    var OUT = 160;   /* 方形输出边长：对齐 workspace/stickers/t/ 现有 63 张的规格 */
    return new Promise(function (resolve) {
      var ov = document.createElement('div'); ov.className = 'stkcv-ov';
      ov.innerHTML =
        '<style>' + CSS + '</style>' +
        '<div class="stkcv-top">' +
          '<button type="button" class="stkcv-btn" data-x="cancel">取消</button>' +
          '<div class="stkcv-title">' + TITLE + '</div>' +
          '<button type="button" class="stkcv-btn stkcv-done" data-x="done">完成</button>' +
        '</div>' +
        '<div class="stkcv-stage"><div class="stkcv-wrap">' +
          '<img alt="">' +
          '<i class="stkcv-c tl"></i><i class="stkcv-c tr"></i><i class="stkcv-c bl"></i><i class="stkcv-c br"></i>' +
        '</div></div>' +
        '<div class="stkcv-tip">单指拖动 · 双指缩放 · 双击放大</div>';
      document.body.appendChild(ov);

      var wrap = ov.querySelector('.stkcv-wrap'), img = ov.querySelector('.stkcv-wrap img');
      var natW = 0, natH = 0, fw = 0, fh = 0, minS = 1, scale = 1, offX = 0, offY = 0;
      var wr = null, closed = false, animRaf = 0;
      var pts = new Map(), drag0 = null, pinch0 = null, pinchUsed = false, down0 = null, tapInfo = null;

      function close(v) {
        if (closed) return; closed = true;
        if (animRaf) cancelAnimationFrame(animRaf);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onResize);
        ov.remove(); resolve(v || null);
      }
      function onKey(e) { if (e.key === 'Escape') close(null); }
      function onResize() { if (!natW) return; fit(); render(); }

      /* fit：wrap 取舞台内能放下的最大取景框（方形或按 ASP 的矩形）；图片 cover 铺满为最小缩放（不露底）并居中 */
      function fit() {
        var st = ov.querySelector('.stkcv-stage');
        var maxW = Math.max(80, st.clientWidth - 32), maxH = Math.max(80, st.clientHeight - 32);
        fh = Math.min(maxH, maxW / ASP);
        fw = fh * ASP;
        wrap.style.width = Math.round(fw) + 'px'; wrap.style.height = Math.round(fh) + 'px';
        wr = wrap.getBoundingClientRect();
        minS = Math.max(fw / natW, fh / natH);
        scale = minS;
        offX = (fw - natW * scale) / 2; offY = (fh - natH * scale) / 2;
      }
      function render() {
        img.style.width = (natW * scale) + 'px';
        img.style.height = (natH * scale) + 'px';
        img.style.left = Math.round(offX * 10) / 10 + 'px';
        img.style.top = Math.round(offY * 10) / 10 + 'px';
      }
      /* setScaleAt：以 wrap 坐标 (ax,ay) 为锚点把缩放调到 ns；锚点下的图像点缩放前后不动（微信捏合手感）；
         一律夹回 cover 约束：scale>=minS、图片不滑出框 */
      function setScaleAt(ns, ax, ay, base) {
        scale = Math.max(ns, minS);
        offX = ax - (ax - base.ox0) / base.s0 * scale;
        offY = ay - (ay - base.oy0) / base.s0 * scale;
        var dw = natW * scale, dh = natH * scale;
        offX = Math.min(0, Math.max(fw - dw, offX));
        offY = Math.min(0, Math.max(fh - dh, offY));
      }
      /* animateTo：双击在铺满/两倍之间切换，200ms 缓出（rAF 插值，手势一开始就打断） */
      function animateTo(target, ax, ay) {
        var fromS = scale, fromX = offX, fromY = offY, t0 = Date.now(), DUR = 200;
        if (animRaf) cancelAnimationFrame(animRaf);
        (function step() {
          var p = Math.min(1, (Date.now() - t0) / DUR);
          var e = 1 - Math.pow(1 - p, 3);
          setScaleAt(fromS + (target - fromS) * e, ax, ay, { s0: fromS, ox0: fromX, oy0: fromY });
          render();
          animRaf = p < 1 ? requestAnimationFrame(step) : 0;
        })();
      }

      img.onload = function () {
        natW = img.naturalWidth || img.width; natH = img.naturalHeight || img.height;
        if (!natW || !natH) { ov.remove(); resolve(null); return; }
        fit(); render();
      };
      img.onerror = function () { close(null); };
      img.src = src;
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onResize);

      wrap.addEventListener('pointerdown', function (e) {
        if (closed) return;
        e.preventDefault();
        if (animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; }
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { wrap.setPointerCapture(e.pointerId); } catch (_) { }
        if (pts.size === 1) {
          down0 = { x: e.clientX, y: e.clientY };
          drag0 = { x: e.clientX, y: e.clientY, ox: offX, oy: offY };
          pinchUsed = false;
        } else if (pts.size === 2) {
          drag0 = null; pinchUsed = true;
          var a = Array.from(pts.values());
          pinch0 = {
            d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1,
            s0: scale, ox0: offX, oy0: offY
          };
        }
      });
      wrap.addEventListener('pointermove', function (e) {
        if (closed || !pts.has(e.pointerId)) return;
        e.preventDefault();
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1 && drag0) {
          offX = drag0.ox + (e.clientX - drag0.x);
          offY = drag0.oy + (e.clientY - drag0.y);
          var dw = natW * scale, dh = natH * scale;
          offX = Math.min(0, Math.max(fw - dw, offX));
          offY = Math.min(0, Math.max(fh - dh, offY));
          render();
        } else if (pts.size === 2 && pinch0) {
          var a = Array.from(pts.values());
          var cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
          var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
          setScaleAt(pinch0.s0 * d / pinch0.d0, cx - wr.left, cy - wr.top, pinch0);
          render();
        }
      });
      function up(e) {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        if (pts.size < 2) pinch0 = null;
        if (pts.size === 1) {
          var only = Array.from(pts.values())[0];
          drag0 = { x: only.x, y: only.y, ox: offX, oy: offY };   /* 捏合回落单指：重定位基准 */
        }
        if (pts.size === 0 && down0 && !pinchUsed) {
          var moved = Math.hypot(e.clientX - down0.x, e.clientY - down0.y);
          var now = Date.now();
          if (moved < 12) {
            if (tapInfo && now - tapInfo.t < 320 && Math.hypot(e.clientX - tapInfo.x, e.clientY - tapInfo.y) < 44) {
              animateTo(scale <= minS * 1.01 ? minS * 2 : minS, e.clientX - wr.left, e.clientY - wr.top);
              tapInfo = null;
            } else tapInfo = { t: now, x: e.clientX, y: e.clientY };
          }
          down0 = null;
        }
      }
      wrap.addEventListener('pointerup', up);
      wrap.addEventListener('pointercancel', up);
      /* 手指滑出框外也要收得到：挂窗口兜底（capture 已设，双保险） */
      window.addEventListener('pointerup', function (e) { if (pts.size && !closed) up(e); });

      ov.querySelector('[data-x="cancel"]').addEventListener('click', function () { close(null); });
      ov.querySelector('[data-x="done"]').addEventListener('click', function () {
        if (closed || !natW) { close(null); return; }
        /* 显示态 → 源图坐标：取景框(fw×fh) 映射回源图裁剪窗口；方形档输出 160 方图，矩形档按长边 OUTS 出图 */
        var sw = fw / scale, sh = fh / scale;
        var sx = Math.max(0, Math.min(natW - sw, -offX / scale));
        var sy = Math.max(0, Math.min(natH - sh, -offY / scale));
        var ow, oh;
        if (OUTS) { var k = OUTS / Math.max(sw, sh); ow = Math.round(sw * k); oh = Math.round(sh * k); }
        else { ow = OUT; oh = OUT; }
        var c = document.createElement('canvas'); c.width = ow; c.height = oh;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh);
        close(c.toDataURL('image/jpeg', .85));
      });
    });
  }

  window.openStickerCropper = openStickerCropper;
})();
