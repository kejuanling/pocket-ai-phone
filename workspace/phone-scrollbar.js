/* [位置:phone-scrollbar.js] [全局滑动条] [小手机里所有纵向滚动区域的原生滚动条都被 display:none 藏了，这里统一补一根细滑动条：手指快速滑动（速度超过 FAST）时浮出，停下约 0.8 秒后淡出；不拦截点击] [注释时间 2026-10-21]
   - 只认真人操作带来的滚动（触摸/滚轮后 1.5 秒内），程序自己的滚动（新消息自动到底等）不显示，免得闪
   - 滑条挂在 body 上、position:fixed，按目标元素的 getBoundingClientRect 定位，不依赖各页面的定位祖先
   - 调快慢阈值改 FAST（像素/毫秒）；想慢滑也出现就调小
   - 2026-10-24：细条改淡白加粗（样式在 phone-fix.css），新增按住拖动：按住变胖变实，可直接拖着控制滚动位置 */
(function(){
  "use strict";
  var FAST = 0.5, HIDE_MS = 800, MIN_OVER = 80, INPUT_MS = 1500, PAD = 6, MIN_THUMB = 28;
  var bar = document.createElement('div');
  bar.className = 'ph-sbar';
  document.body.appendChild(bar);
  var last = new WeakMap(), cur = null, hideT = 0, lastInput = 0, touching = false, raf = 0;

  function input(){ lastInput = Date.now(); }
  window.addEventListener('touchstart', function(){ touching = true; input(); }, { capture: true, passive: true });
  window.addEventListener('touchmove', input, { capture: true, passive: true });
  window.addEventListener('touchend', function(){ touching = false; input(); }, { capture: true, passive: true });
  window.addEventListener('touchcancel', function(){ touching = false; input(); }, { capture: true, passive: true });
  window.addEventListener('wheel', input, { capture: true, passive: true });

  /* [位置:phone-scrollbar.js·scrollable] [overflowY 缓存] [2026-10-27（子智能体性能调查第 2 条）：这个函数在 window 上 capture 监听**所有** scroll 事件里跑，每个事件都 getComputedStyle 一次 —— 强制样式计算，比读 scrollHeight 贵得多，而 overflowY 基本不会变。改成 WeakMap 缓存：第一次算，之后直接取；节点被回收时缓存自然释放。scrollHeight 仍每次读（内容会变，且读它本身不触发布局）] [注释时间 2026-10-27] */
  var oyCache = new WeakMap();
  function overflowYOf(el){
    var v = oyCache.get(el);
    if (v === undefined) { try { v = getComputedStyle(el).overflowY || ''; } catch (e) { v = ''; } oyCache.set(el, v); }
    return v;
  }
  function scrollable(el){
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return false;
    /* [位置:phone-scrollbar.js·scrollable 抽屉豁免] [极简抽屉内不出细条] [11-20：会话抽屉（含会话列表与展开更多后的整页滚动）整体隐藏滚动条，其余页面照旧] [注释时间 2026-11-20] */
    if (el.closest && el.closest('.mn-drawer')) return false;
    var t = el.tagName; if (t === 'TEXTAREA' || t === 'INPUT') return false;
    if (el.scrollHeight - el.clientHeight < MIN_OVER) return false;
    var oy = overflowYOf(el);
    return oy === 'auto' || oy === 'scroll';
  }
  function place(){
    raf = 0; var el = cur; if (!el || !el.isConnected) { bar.classList.remove('on'); return; }
    /* [位置:phone-scrollbar.js·place ink] [状态机页滚动条墨色标记] [10-30：状态机页浅玻璃底，全局淡白细条几乎看不见；滚动目标落在状态机页（.tk-ps，含页内原文预览窗）或「发出去的原文」页（.tk-rawsc，11-09：浅玻璃底上白条隐形）时给细条加 .ink，配色在 phone-fix.css，其余页面照旧淡白] [注释时间 2026-10-30] */
    bar.classList.toggle('ink', !!(el.closest && el.closest('.tk-ps,.tk-rawsc')));
    var r = el.getBoundingClientRect(), ch = el.clientHeight, sh = el.scrollHeight;
    var track = r.height - PAD * 2; if (track < 40 || sh <= ch) { bar.classList.remove('on'); return; }
    var th = Math.max(MIN_THUMB, track * ch / sh), max = sh - ch;
    var top = r.top + PAD + (track - th) * Math.min(1, Math.max(0, el.scrollTop / max));
    bar.style.height = th + 'px';
    bar.style.transform = 'translate3d(' + (r.right - 5) + 'px,' + top + 'px,0)';
  }
  /* 停手后 800ms 淡出；还在按着就再续一次（原来是 show() 递归自己，多一层闭包和一次 add）。
     注意：这个文件是 "use strict"，不能用 arguments.callee（会直接抛错），用具名函数 */
  function armHide(){
    hideT = setTimeout(function(){
      if (touching) { armHide(); return; }
      bar.classList.remove('on'); cur = null;
    }, HIDE_MS);
  }
  function show(){ bar.classList.add('on'); clearTimeout(hideT); armHide(); }
  window.addEventListener('scroll', function(e){
    var el = e.target; if (!scrollable(el)) return;
    var now = performance.now(), p = last.get(el), top = el.scrollTop;
    last.set(el, { t: now, y: top });
    if (!p) return;
    var human = touching || Date.now() - lastInput < INPUT_MS; if (!human) return;
    var v = Math.abs(top - p.y) / Math.max(now - p.t, 12);
    if (cur !== el) { if (v < FAST) return; cur = el; }
    else if (v >= FAST) { /* 续命 */ }
    else if (!bar.classList.contains('on')) return;
    if (!raf) raf = requestAnimationFrame(place);
    if (v >= FAST || bar.classList.contains('on')) show();
  }, true);

  /* [位置:phone-scrollbar.js·drag] [按住滚动条拖动] [细条不光是指示，按住变胖变实后可以直接拖着走，像原生 App；几何与 place() 同一套算法，拖动中不停 input() 保持"真人操作"判定，不会被"程序滚动不显示"逻辑挡住] [注释时间 2026-10-24] */
  var drag = null;
  bar.addEventListener('pointerdown', function(e){
    if (!cur || !cur.isConnected) return;
    var r = cur.getBoundingClientRect();
    drag = { el: cur, y: e.clientY, top: cur.scrollTop, track: r.height - PAD * 2, max: cur.scrollHeight - cur.clientHeight };
    bar.classList.add('grab'); input(); clearTimeout(hideT);
    try { bar.setPointerCapture(e.pointerId); } catch(_){}
    e.preventDefault();
  });
  bar.addEventListener('pointermove', function(e){
    if (!drag) return;
    if (!drag.el.isConnected) { endDrag(); return; }
    input();
    drag.el.scrollTop = drag.top + (e.clientY - drag.y) / Math.max(drag.track, 40) * drag.max;
    if (!raf) raf = requestAnimationFrame(place);
  });
  function endDrag(){
    if (!drag) return;
    drag = null; bar.classList.remove('grab');
    hideT = setTimeout(function(){ bar.classList.remove('on'); cur = null; }, HIDE_MS);
  }
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
})();
