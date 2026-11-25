/* 小手机 · 左边缘右划返回
   [位置:phone-swipeback.js·整个文件] [边缘右划返回] [从屏幕左边缘往右划 = 返回上一层，所有页面通用；不改任何现有页面，找当前最上层，替它点它自己的返回按钮] [注释时间 2026-10-21；2026-10-22 改：手指改用 touch 事件（pointer 会被滚动的 pointercancel 打断），横向意图成立才 preventDefault，竖着划照旧滚]

   为什么这样做：小手机每一层（app 窗口 / 子页 / 聊天内子页 / 聊天层 / 底板 / 抽屉）都自带返回或关闭按钮，关闭逻辑各是各的闭包，
   没有全局入口。与其逐页接手势，不如在全局放一层手势：划完「替最上层点一下它自己的返回」，原有的关闭动画与收尾（onBack、列表刷新、状态复位）全部照旧。
   新页面只要有 data-x="back" / .back / .tk-bk 之一，就自动支持，不用再写任何手势代码。

   判定「最上层」靠 z-index 的层叠约定（见 LAYERS 表）；确认框、录音、图片放大、多选、笔记本翻页、锁屏、桌面、通知中心一律不触发。
   起点必须在左边缘 EDGE 像素内，且横向位移远大于纵向，才算返回手势，不会和列表左滑、气泡长按、横向滚动打架。
   10-22 起分两条腿：手指走 touch 事件（touchmove 非 passive，判定成横划之后 preventDefault，浏览器不会再把这段手势判给滚动），鼠标走 pointer。 */
(function(){
"use strict";
var P=window.PH; if(!P||!P.D) return;
var D=P.D, buzz=P.buzz||function(){};
var EDGE=26;          /* 起手必须离左边缘多近（px） */
var COMMIT=.34;       /* 松手时位移超过屏宽的多少算返回 */
var FAST=.55;         /* 或者速度（px/ms）超过多少也算 */
var LOCK_DX=10;       /* 横向位移超过多少才锁定为返回手势 */

/* 层表：自上而下。sel = 这一层是谁；back = 在这一层里找哪个按钮代点；kind = 预览怎么动 */
var LAYERS=[
  {sel:'.pg-cf',                    skip:true},                                   /* 确认框：不响应，防误触 */
  {sel:'.phlogin.show',             skip:true},                                   /* 登录框：必须填，不能划走 */
  {sel:'.tk-rec',                   skip:true},                                   /* 录音中 */
  {sel:'.tk-view,.tk-vw',           skip:true},                                   /* 图片放大 */
  {sel:'.ses-pop.show',             scrim:'.scrim', kind:'fade'},                 /* 底板弹层：点遮罩关 */
  {sel:'.pg-sheet.show',            scrim:'.scrim', kind:'sheet'},                /* 配置里的底板：点遮罩关 */
  {sel:'.tk-ed.show',               scrim:'.scrim', kind:'fade'},                 /* 编辑框 */
  {sel:'.xw-pop.show',              scrim:'.scrim', kind:'fade'},                 /* 说明小卡 */
  {sel:'.tk-ov.show,.cs-ov.show',   scrim:'.scrim', kind:'fade'},                 /* 长按菜单 */
  {sel:'.cs-dw.show,.tk-dw.show',   scrim:'.scrim', kind:'fade'},                 /* 抽屉 */
  {sel:'.tk-page.show',             back:'.tk-bk', kind:'slide'},                 /* 聊天内子页（状态机 / 原文） */
  {sel:'.pg-sub.show',              back:'[data-x="back"]', kind:'slide'},        /* 配置等的子页 */
  {sel:'.win.tk-layer',             back:'.back', kind:'slide', layer:true},      /* 聊天层（叠在会话列表上） */
  {sel:'.win[data-win]',            back:'.back', kind:'win'}                     /* app 窗口：回桌面 */
];

/* 这些状态下整个手势都不开。
   锁屏 / 桌面 / 没开任何 app：D 里没有 .win，topLayer() 找不到层，天然不触发，不用单独判断。 */
function blocked(){
  if(document.documentElement.classList.contains('wide')) return true;   /* 10-28 宽屏双栏：左边缘不是「返回」手势（浏览器自己的边缘返回/页面里都有明确的返回键） */
  var nc=document.getElementById('nc'); if(nc&&nc.classList.contains('open')) return true;     /* 通知中心拉下来了 */
  if(D.querySelector('.msel')) return true;                                                  /* 聊天多选模式：点气泡是选中，不是返回 */
  return false;
}
function visible(el){ if(!el||!el.isConnected) return false; var r=el.getBoundingClientRect(); return r.width>20&&r.height>20; }

/* 找最上层：按 LAYERS 顺序，第一个「存在且可见」的就是；遇到 skip 层就整体放弃 */
function topLayer(){
  var minOn=!!(P.minLayout&&P.minLayout.on);
  var hasTopWin=minOn&&Array.prototype.some.call(D.querySelectorAll('.win[data-win]'),function(w){
    return !w.classList.contains('tk-layer')&&!w.classList.contains('mn-cs-host')&&!w.classList.contains('mn-me-host')&&visible(w);
  });
  for(var i=0;i<LAYERS.length;i++){
    var L=LAYERS[i], els=D.querySelectorAll(L.sel); if(!els.length) continue;
    if(hasTopWin&&L.sel==='.win.tk-layer') continue;
    var el=els[els.length-1]; if(!visible(el)) continue;
    if(L.skip) return null;
    return {L:L,el:el};
  }
  return null;
}
/* 这一层能不能真的返回：有可点的返回元素才算 */
function exit(t){
  var L=t.L, el=t.el;
  if(L.scrim){ return el.querySelector(L.scrim); }
  var cands=el.querySelectorAll(L.back), pick=null;
  for(var i=0;i<cands.length;i++){ var c=cands[i]; if(c.hidden||c.getAttribute('aria-hidden')==='true'||c.offsetParent===null) continue;
    if(L.kind==='slide'&&c.closest('.pg-sub,.tk-page')!==el&&el.matches('.pg-sub,.tk-page')) continue;      /* 只认本层自己的，不认嵌在里面的别层 */
    pick=c; break; }
  if(L.kind==='win'&&pick&&pick.closest('.nb-pg')) pick=null;   /* 笔记本封底不是返回按钮 */
  return pick;
}

var G=null;   /* 当前手势 */
function begin(x,y,id){
  if(blocked()) return false;
  var t=topLayer(); if(!t) return false;
  if(P.minLayout&&P.minLayout.on&&t.L.sel==='.win.tk-layer'){
    if(P.minLayout.isDrawerOpen&&P.minLayout.isDrawerOpen()) return false;      /* 侧栏已开：收回由 phone-drawer.js 自己管 */
    G={id:id,x:x,y:y,lock:false,dead:false,t:{L:{kind:'drawer'},el:t.el},btn:null,w:D.clientWidth,lastX:x,lastT:performance.now(),v:0,under:null,prevTrans:'',prevTf:'',uPrev:null};
    return true;
  }
  var btn=exit(t); if(!btn) return false;
  G={id:id,x:x,y:y,lock:false,dead:false,t:t,btn:btn,w:D.clientWidth,lastX:x,lastT:performance.now(),v:0,under:null,prevTrans:'',prevTf:'',uPrev:null};
  return true;
}
/* 只有判定成「横划」那一下才 preventDefault：竖着划（滚动）完全不受影响 */
function step(x,y,ev){
  if(!G||G.dead) return;
  var dx=x-G.x, dy=y-G.y;
  if(!G.lock){
    if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)){ unbind(); G=null; return; }        /* 竖着划：让位给滚动 */
    if(dx<-6){ unbind(); G=null; return; }                                            /* 往左：不是返回 */
    if(dx<LOCK_DX) return;
    G.lock=true; prep();
  }
  if(ev&&ev.cancelable&&ev.preventDefault) ev.preventDefault();
  var now=performance.now(); G.v=(x-G.lastX)/Math.max(1,now-G.lastT); G.lastX=x; G.lastT=now;
  paint(Math.max(0,dx));
}
function finish(x){
  var g=G; if(!g) return; unbind(); G=null;
  if(!g.lock||g.dead){ return; }
  var dx=Math.max(0,x-g.x);
  if(g.t.L.kind==='drawer'){ P.minLayout.dragEnd(dx,g.v); if(P.minLayout.isDrawerOpen()) buzz(8); return; }
  var go=(dx/g.w>COMMIT)||(g.v>FAST&&dx>40);
  if(!go){ G=g; restore(true); G=null; return; }
  /* 提交：先把预览状态还原到「没动过」，再替它点返回——原有的关闭动画从原位置开始，不会闪。
     弹层类没有返回按钮，点遮罩即关。 */
  var btn=g.btn; G=g; restore(false); G=null; buzz(8);
  try{ btn.click(); }catch(err){ console.error(err); }
}
function abort(){
  var g=G; if(!g) return; unbind(); G=null;
  if(g.lock){ if(g.t.L.kind==='drawer'){ P.minLayout.dragEnd(0,0); return; } G=g; restore(true); G=null; }
}

/* 预览：只有「滑入式」的层（子页 / 聊天层 / 聊天内子页）跟手；弹层和 app 窗口用轻微位移 + 渐隐，避免预览和原动画打架 */
function prep(){
  var el=G.t.el, k=G.t.L.kind;
  if(k==='drawer'){ P.minLayout.dragStart(); return; }
  G.prevTrans=el.style.transition; G.prevTf=el.style.transform;
  if(k==='slide'||k==='sheet'||k==='win'||k==='fade'){ el.style.transition='none'; }
  if(k==='slide'){ var u=underOf(G.t); if(u){ G.under=u; G.uPrev={tf:u.style.transform,tr:u.style.transition,op:u.style.opacity}; u.style.transition='none'; } }
}
function underOf(t){
  if(t.L.sel==='.pg-sub.show') return t.el.parentNode&&t.el.parentNode.querySelector('.pg:not(.pg-sub)');
  if(t.L.layer) return D.querySelector('.win[data-win="chats"]');
  return null;
}
function paint(dx){
  var el=G.t.el, k=G.t.L.kind, p=Math.min(1,dx/G.w);
  if(k==='drawer'){ P.minLayout.dragTo(dx); return; }
  if(k==='slide'){ el.style.transform='translateX('+dx+'px)'; if(G.under){ G.under.style.transform='translateX('+(-22*(1-p))+'%)'; G.under.style.opacity=String(.6+.4*p); } }
  else if(k==='win'){ el.style.transform='translateX('+(dx*.5)+'px) scale('+(1-p*.08)+')'; el.style.opacity=String(1-p*.5); }
  else { el.style.transform='translateX('+(dx*.25)+'px)'; el.style.opacity=String(1-p*.6); }
}
function restore(anim){
  var el=G.t.el, g=G;
  var fin=function(){ if(!el.isConnected) return; el.style.transition=g.prevTrans||''; el.style.transform=g.prevTf||''; el.style.opacity=''; if(g.under){ g.under.style.transition=g.uPrev.tr||''; g.under.style.transform=g.uPrev.tf||''; g.under.style.opacity=g.uPrev.op||''; } };
  if(!anim){ fin(); return; }
  el.style.transition='transform .32s cubic-bezier(.2,.9,.25,1),opacity .3s'; el.style.transform=g.prevTf||''; el.style.opacity='';
  if(g.under){ g.under.style.transition='transform .32s cubic-bezier(.2,.9,.25,1),opacity .3s'; g.under.style.transform=g.uPrev.tf||''; g.under.style.opacity=g.uPrev.op||''; }
  setTimeout(fin,340);
}

/* ---------- 手指：touch（主路径） ----------
   [位置:phone-swipeback.js·touch 监听] [页面一刷新，划到一半就卡住] [触摸事件永远发给「起手那个元素」；那个元素中途被重画（MCP 列表这类页面会定时刷新状态）摘出 DOM 后，事件不再冒泡到 D，touchend 收不到，预览位移就留在屏幕上。改成起手时直接在那个元素上挂 move/end/cancel（元素摘掉了也照样触发），收尾时摘掉；再加看门狗兜底] [注释时间 2026-10-22] */
function unbind(){ if(!G||!G.tg) return; var tg=G.tg; tg.removeEventListener('touchmove',onMove,true); tg.removeEventListener('touchend',onEnd,true); tg.removeEventListener('touchcancel',onCancel,true); G.tg=null; clearTimeout(G.wd); }
function onMove(e){ if(!G) return; var t=e.touches[0]; if(!t) return; step(t.clientX,t.clientY,e); armWd(); }
function onEnd(e){ if(!G) return; var t=e.changedTouches&&e.changedTouches[0]; var x=t?t.clientX:G.lastX; unbind(); finish(x); }
function onCancel(){ if(!G) return; unbind(); abort(); }
/* 看门狗：已经锁定成返回手势，却 900ms 没有任何 touch 事件（事件丢了）→ 当作取消，把预览还原 */
function armWd(){ if(!G||!G.lock) return; clearTimeout(G.wd); G.wd=setTimeout(function(){ if(G&&G.lock){ unbind(); abort(); } },900); }
D.addEventListener('touchstart',function(e){
  if(G&&G.lock){ unbind(); abort(); }                      /* 上一次没收尾的残留 */
  if(e.touches.length!==1) return;
  if(e.target&&e.target.closest&&e.target.closest('input[type="range"]')) return;   /* 2026-11-23：放行滑杆，防止滑块在最左端时被右滑返回抢走 */
  var t=e.touches[0];
  if(t.clientX-D.getBoundingClientRect().left>EDGE) return;
  if(!begin(t.clientX,t.clientY,t.identifier)) return;
  var tg=e.target; G.tg=tg;
  tg.addEventListener('touchmove',onMove,{passive:false,capture:true});
  tg.addEventListener('touchend',onEnd,{capture:true});
  tg.addEventListener('touchcancel',onCancel,{capture:true});
},{passive:true,capture:true});

/* ---------- 鼠标：pointer（桌面调试用） ---------- */
D.addEventListener('pointerdown',function(e){
  if(e.pointerType!=='mouse'||e.buttons!==1) return;
  if(e.target&&e.target.closest&&e.target.closest('input[type="range"]')) return;
  if(e.clientX-D.getBoundingClientRect().left>EDGE) return;
  if(begin(e.clientX,e.clientY,e.pointerId)){ try{ D.setPointerCapture(e.pointerId); }catch(_){} }
},{passive:true,capture:true});
D.addEventListener('pointermove',function(e){
  if(!G||e.pointerType!=='mouse'||e.pointerId!==G.id) return;
  step(e.clientX,e.clientY,e);
},{passive:false});
D.addEventListener('pointerup',function(e){
  if(!G||e.pointerType!=='mouse') return;
  try{ D.releasePointerCapture(e.pointerId); }catch(_){}
  finish(e.clientX);
});
D.addEventListener('pointercancel',function(e){ if(!G||e.pointerType!=='mouse') return; abort(); });

/* 供测试和其它模块查询：当前最上层是谁、能不能返回 */
P.swipeback={top:function(){ var t=topLayer(); if(!t) return null; var b=exit(t); return {sel:t.L.sel,kind:t.L.kind,hasBack:!!b}; },EDGE:EDGE};
})();
