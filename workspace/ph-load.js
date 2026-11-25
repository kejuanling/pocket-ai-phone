/* ph-load.js —— 小手机 · 全局加载动画（转场 / 首屏 / 读取中）
   [位置:ph-load.js·P.load] [全局加载动画] [需求：进会话、切页、首屏读取时，屏幕正中一个可爱的小动画——白天纸船、夜里星光；
   不要骨架屏、不写「拉取中」这类文字；内容到了动画淡出、内容淡入 160ms；尺寸随屏幕放大（手机 48 / 整页 64，平板 56/72，宽屏 64/84）]
   [注释时间 2026-11-05]

   素材：LottieFiles 免费区（Lottie Simple License，可商用可修改）
     · anim/paper-boat.json — "paper boat" by Jacques（白天）
     · anim/sparkles.json   — "Sparkles Loop Loader" by Stephane（夜里）
   运行库：vendor/lottie_light.min.js（lottie-web 5.12.2 light 版，168KB，按需懒加载 + 浏览器缓存；首屏不下载）

   三种用法：
   1) 纯 HTML：字符串里写 <div class="ph-load"></div>（整页/消息区加 ph-page），元素进 DOM 后自动挂上动画，移出自动销毁；
   2) 运行时：P.load.show(hostEl,{page:1,dy:-36}) → {el, done()}，done() 淡出并在 160ms 后移除；
      dy = 整页那档的竖直偏移（px，负=往上）。有底栏的页面（聊天页输入框、会话列表标签栏）整窗几何中心偏低、
      看着不居中，由调用方按实测值传：聊天页 -36、会话列表首屏 -14（11-05 实测）；
   3) 手动补扫：P.load.scan()（一般用不到，MutationObserver 已经兜住）。
   lottie 脚本或素材没拉下来时退一个静态图案（.ld-fallback），不至于白屏。*/
(function(){
"use strict";
var P=window.PH; if(!P) return;
var LIB='/vendor/lottie_light.min.js', SRC={day:'/anim/paper-boat.json',night:'/anim/sparkles.json'};
var libP=null, dataP={}, liveEls=[], scanT=0, curTheme=themeNow();

function themeNow(){ var d=document.getElementById('device'); return d&&d.getAttribute('data-theme')==='dark'?'night':'day'; }
function reduce(){ try{ return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){ return false; } }

/* 运行库与素材都只下这一次 */
/* [位置:ph-load.js·loadLib 超时] [运行库请求卡死时不能让页面一直空着] [11-05 复现：浏览器会把 <link rel=prefetch> 那条和这次 script 请求并成一条，
   那条要是迟迟不回，onload/onerror 一个都不来，动画元素就停在 opacity:0——用户看到的是「点了没反应、过两秒突然出内容」。
   6s 认输，退回静态图案（.ld-fallback），并把 libP 清掉让下次还能重来] [注释时间 2026-11-05] */
function loadLib(){
  if(window.lottie) return Promise.resolve(window.lottie);
  if(libP) return libP;
  libP=new Promise(function(ok,no){
    var over=0, t=setTimeout(function(){ if(over) return; over=1; libP=null; no(new Error('lottie 超时')); },6000);
    var s=document.createElement('script'); s.src=LIB; s.async=1;
    s.onload=function(){ if(over) return; over=1; clearTimeout(t); if(window.lottie){ ok(window.lottie); } else { libP=null; no(new Error('lottie 空')); } };
    s.onerror=function(){ if(over) return; over=1; clearTimeout(t); libP=null; no(new Error('lottie 没加载')); };
    document.head.appendChild(s);
  });
  return libP;
}
/* 挂载中途被打断（元素被重画换掉、主题刚好在切）：把已挂标记退回去，让下一轮 scan 还能再试；
   连试 3 次不成就算了，别空转。原来这里直接 return，标记留着 1，之后任何 scan 都跳过它 —— 元素就永远是一块空白 */
function retry(el){ if(!el.isConnected) return; el.__ldTry=(el.__ldTry||0)+1; if(el.__ldTry>3) return; el.__ldMounted=0; el.classList.remove('ld-fallback'); schedule(); }
function loadData(k){
  if(dataP[k]) return dataP[k];
  var pr=fetch(SRC[k],{credentials:'omit'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });
  dataP[k]=pr;
  pr['catch'](function(){ if(dataP[k]===pr) dataP[k]=null; });
  return pr;
}

/* 一个 .ph-load 元素 = 一个 lottie 实例；主题变了重建，元素离场销毁 */
function kill(el){
  if(el.__ld){ try{ el.__ld.destroy(); }catch(e){} el.__ld=null; }
  el.__ldMounted=0; el.__ldTheme=''; el.__ldFail=0;
  if(el.classList){ el.classList.remove('ld-on'); el.classList.remove('ld-fallback'); }
  var slot=el.querySelector&&el.querySelector('.ld-box'); if(slot) slot.innerHTML='';
}
function mount(el){
  if(el.__ldMounted||!el.isConnected) return;
  el.__ldMounted=1;
  var th=themeNow(); el.__ldTheme=th;
  /* 350ms 还没画出动画（运行库/素材在路上，或那条请求卡住了）就先亮静态图案顶着：
     宁可先给一个安静的星，也别让人对着空白等。为什么不是一挂载就亮：运行库命中缓存时几十毫秒就位，
     立刻亮会「闪一下静态星再变真动画」；为什么不是 1.2s：实测慢的时候那 1.2s 就是一片空白，用户以为没反应。
     真动画一到就换掉（下面 success 分支 remove） */
  setTimeout(function(){ if(el.isConnected&&!el.classList.contains('ld-on')) el.classList.add('ld-fallback'); },350);
  if(!el.querySelector('.ld-box')){ var b=document.createElement('div'); b.className='ld-box'; el.appendChild(b); }
  loadLib().then(function(lot){
    if(!el.isConnected||el.__ldTheme!==th){ retry(el); return null; }
    return loadData(th).then(function(d){ return {lot:lot,d:d}; });
  }).then(function(x){
    if(!x||!el.isConnected||el.__ldTheme!==th){ retry(el); return; }
    var slot=el.querySelector('.ld-box'); if(!slot) return;
    slot.innerHTML='';
    el.__ld=x.lot.loadAnimation({container:slot,renderer:'svg',loop:true,autoplay:true,animationData:x.d});
    if(reduce()){ try{ el.__ld.setSpeed(0.4); }catch(e){} }   /* 系统「减弱动态效果」：慢放，不静止（静止就表达不了在等） */
    el.classList.remove('ld-fallback'); el.classList.add('ld-on');
  })['catch'](function(){ if(el.isConnected) el.classList.add('ld-fallback'); });
}
function flush(){
  var i,e;
  for(i=liveEls.length-1;i>=0;i--){ e=liveEls[i]; if(!e.isConnected){ kill(e); liveEls.splice(i,1); } }
  var els=document.querySelectorAll('.ph-load:not(.ld-on):not(.ld-fallback)');
  for(i=0;i<els.length;i++){ e=els[i]; if(e.__ldMounted) continue; liveEls.push(e); mount(e); }
}
/* [位置:ph-load.js·schedule] [没有加载态时零成本] [需求：聊天流式生成每 140ms 整段重绘一次，观察器不能每次都全文档找一遍；页面上没有 .ph-load 时只顺手清掉已离场的实例就返回] [注释时间 2026-11-05] */
function schedule(){ if(scanT) return; scanT=setTimeout(function(){ scanT=0;
  if(!document.querySelector('.ph-load')){
    for(var i=liveEls.length-1;i>=0;i--){ if(!liveEls[i].isConnected){ kill(liveEls[i]); liveEls.splice(i,1); } }
    return; }
  flush(); },80); }

try{
  var D0=document.getElementById('device')||document.body;
  new MutationObserver(schedule).observe(D0,{childList:true,subtree:true});
  new MutationObserver(function(){
    var t=themeNow(); if(t===curTheme) return; curTheme=t;
    liveEls.forEach(function(el){ if(el.isConnected){ kill(el); mount(el); } });
  }).observe(document.getElementById('device'),{attributes:true,attributeFilter:['data-theme']});
}catch(e){}

P.load={
  /* 生成 HTML（塞进 innerHTML 用）；page=1 是整页/消息区那档，比行内大一号 */
  html:function(o){ o=o||{}; return '<div class="ph-load'+(o.page?' ph-page':'')+'"'+(o.dy?' style="--ldy:'+(+o.dy)+'px"':'')+' role="status" aria-label="正在加载"></div>'; },
  /* 运行时往某个容器里放一个，返回句柄；done() 淡出后自己收掉。
     page:true = 铺满 host（host 要能定位：.win / #device / .pg-sub 都是），不铺底色不糊毛玻璃，内容到了调 done() 让它散去 */
  show:function(host,o){ o=o||{};
    var d=document.createElement('div'); d.className='ph-load'+(o.page?' ph-page':'');
    /* dy：整页那档的竖直偏移（负=往上）。挂在元素自己身上，主题切换重建实例、被重画打断后抢救重挂都不会丢 */
    if(o.dy) d.style.setProperty('--ldy',(+o.dy)+'px');
    d.setAttribute('role','status'); d.setAttribute('aria-label','正在加载');
    host.appendChild(d); schedule();
    /* [位置:ph-load.js·show 最短时长] [动画走完最短时长再散] [11-16 批4 I1：缓存秒回时 done 数据一到就调，动画 0ms 即散、等于从没出现过——「之前加的加载动画也不加载」的根因之一。记起始时刻，done 不足最短时长（默认 600ms，o.min 可覆盖，传 0 = 不等）就补足再淡出：动画时长与请求完成取 max，请求先回也让动画走完。宿主已被移走（子页先关了）就不再等，直接回调] [注释时间 2026-11-16] */
    var fin=0, t0=Date.now(), MIN=(o.min!=null?+o.min:600);
    return { el:d, done:function(cb){ if(fin) return; fin=1;
      function fade(){ if(!d.parentNode){ if(cb) cb(); return; } d.classList.add('ld-out');
        setTimeout(function(){ kill(d); if(d.parentNode) d.parentNode.removeChild(d); if(cb) cb(); },180); }
      var wait=MIN-(Date.now()-t0);
      if(wait>0&&d.parentNode) setTimeout(fade,wait); else fade(); } };
  },
  scan:flush,
  theme:themeNow
};
})();
