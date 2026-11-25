/* 小手机 · 桌面三屏（每屏 4 列 × 7 行的格子，主屏 #grid 是 4 行）：左 = 卡片墙，中 = 主屏，右 = 整月日历 / 备份 / 记忆池 + 2 个图标。未登录时是示例数据。
   11-17 起卡片格位由布局表驱动（见下方「桌面格位编辑」段）：拖动让位、跨页、尺寸档位、添加面板。 */
(function(){
"use strict";
var P=window.PH; if(!P||!P.tools||!P.open) return;
var D=P.D, $=P.$, buzz=P.buzz, toast=P.toast, anim=P.anim, SP='cubic-bezier(.2,.9,.25,1)';
var esc=P.esc||function(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
var home=$('#home'), pcard=$('.pcard',home), grid=$('#grid'), pill=$('#pillLine'), pager=$('.pager',home);
if(!home||!pcard||!grid||!pager) return;
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
var IC={tool:'<svg viewBox="0 0 24 24"><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/></svg>',
  ctx:svg('<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>'),
  svc:svg('<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>'),
  save:svg('<path d="M5 3h12l4 4v14H5zM8 3v6h8M8 21v-7h8v7"/>'),
  mem:svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/>'),
  log:svg('<path d="M4 5h16M4 10h10M4 15h16M4 20h8"/>'),
  push:svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a2 2 0 0 0 3.4 0"/>'),
  pin:svg('<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>'),
  star:svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  cross:svg('<rect x="3" y="4" width="13" height="13" rx="3"/><path d="M8 20h10a3 3 0 0 0 3-3V9"/>'),
  swap:svg('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
  wake:svg('<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>'),
  heart:svg('<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>'),
  diary:svg('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/>'),
  todo:svg('<path d="m4 7 2 2 4-4M4 15l2 2 4-4M14 7h6M14 15h6"/>'),
  photo:svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  ok:svg('<path d="m5 12 4.5 4.5L19 7"/>'),
  x:svg('<path d="M6 6l12 12M18 6 6 18"/>')
};
function chip(k){ try{ return P.tools.def[k].chip(); }catch(e){ return ''; } }
function ringVars(pct,r){ var C=2*Math.PI*r; return '--C:'+C.toFixed(1)+';--o:'+(C*(1-pct/100)).toFixed(1); }
function title(ic,t,em){ return '<div class="hw-t"><i>'+IC[ic]+'</i>'+t+(em?'<em>'+em+'</em>':'')+'</div>'; }

/* ---------- 数据（占位） ----------
   [位置:phone-nw-widgets.js·FEED/QUEUE/LOGS/STARS/TODOS/DAYS] [桌面小组件的占位数据] [演示数据已删（2026-10-22）：联网前只放「读取中…」，联网后 liveBoot 换成真数据；数组不能放空（轮播 / 取模要用到长度）。11-16 批1：信封卡删除，LETTER 占位与拉信请求一并清掉] [注释时间 2026-11-16 改] */
var FEED=[{k:'wake',t:'唤醒',time:'—',m:'正在读取…'}];
var QUEUE=[];
var LOGS=[['wake','正在读取…']];
var STARS=[['正在读取…','']];
var TODOS=[];
var DAYS=[];
var LV=false, LT=0, CTXP=0, NOWAKE=false;   /* NOWAKE：后端说没有锁定会话/没有下一次，倒计时显示 --（2026-10-28） */

/* ---------- 页面 HTML ---------- */
function page2(){
  return ''+
  '<div class="hw hw-star glass tap" data-sz="4x2" data-go="app:star" style="--i:0" role="button" aria-label="随机标星">'+title('star','随机一个标星',chip('star'))+'<div id="hwStar" class="hw-sv"></div></div>'+
  '<div class="hw hw-hero glass tap" data-sz="2x2" data-go="app:wake" style="--i:2" role="button" aria-label="唤醒状态">'+
    '<div class="hw-top"><span class="hw-live"><i></i>连接中…</span><div class="hw-ring hw-r1" id="hwR1" style="'+ringVars(50,34)+'"><svg viewBox="0 0 80 80"><circle class="bg" cx="40" cy="40" r="34" stroke-width="7"/><circle class="fg" cx="40" cy="40" r="34" stroke-width="7"/></svg><b id="hwPct">--</b></div></div>'+
    '<div class="hw-tx"><small>距下次唤醒</small><b id="hwCd">--:--:--</b><em id="hwGap"></em></div>'+
    '</div>'+   /* [位置:phone-nw-widgets.js·page2 唤醒卡] [去掉「叫醒他」按钮] [11-03：手动叫醒本来就没接口，按钮去掉] [注释时间 2026-11-03] */
  '<div class="hw hw-todo glass tap" data-sz="2x2" data-go="app:todo" style="--i:3" role="button" aria-label="待办">'+title('todo','待办','<b id="hwTn">'+TODOS.length+'</b>')+'<ul class="hw-tl" id="hwTl"></ul></div>'+
  /* [位置:phone-nw-widgets.js·page2 hwTabs] [AI 在做什么默认页签=推送] [11-16：打开卡片先看到推送（wake/tool 页签还在，点切换）；actTab 初值在下方 showAct 附近同步改] [注释时间 2026-11-16] */
  '<div class="hw hw-act glass" data-sz="4x3" data-lid="act" style="--i:4" aria-label="AI 在做什么">'+title('heart','AI 在做什么')+'<div class="hw-tabs" id="hwTabs" role="tablist"><button type="button" data-t="wake">唤醒</button><button type="button" data-t="tool">工具</button><button type="button" data-t="push" class="on">推送</button></div><div class="hw-pg" id="hwPg" hidden></div><div class="hw-a" id="hwA"></div></div>';
}
var RIGHT_ICONS=['trace'];   /* [位置:phone-nw-widgets.js·RIGHT_ICONS] [桌面第三页右侧图标] [11-20：提示词页删了，第三页不再放提示词图标，只留痕迹] [注释时间 2026-11-20] */
function page3(){
  return ''+
  P.icon(RIGHT_ICONS[0],'',0)+
  '<div class="hw hw-bak glass tap" data-sz="2x1" data-go="app:pulse" style="--i:2" role="button" aria-label="后台 · 备份">'+title('save','后台 · 备份')+
    '<div class="hw-big">—</div><div class="hw-tick">'+DAYS.map(function(d,i){ return '<span class="'+(d?'':'gap')+'" style="--k:'+i+'"></span>'; }).join('')+'</div></div>'+
  /* [位置:phone-nw-widgets.js·page3] [第三页卡片：月历/后台备份/记忆池 + 两个图标] [11-16 产品确定：信封 App 删除，「信封 · 随机一封」卡一起删（C2）；记忆池卡拉高补上腾出的一行（4x2→4x3，与 phone-nw-widgets.css「第三页版式钉住」的格位成对改：hw-mem 5/1/7/5 → 5/1/8/5）] [注释时间 2026-11-16 改] */
  '<div class="hw hw-mem glass tap" data-sz="4x3" data-go="app:mem" style="--i:3" role="button" aria-label="记忆池 · 审批">'+title('mem','记忆池 · 审批','待审核 <b id="hwQn">'+QUEUE.length+'</b>')+'<div class="hw-q" id="hwQ"></div></div>';
}

/* ---------- 搭页面：把原桌面内容搬进第 1 页，其余两页新建 ---------- */
var wrap=document.createElement('div'); wrap.className='hpages';
var track=document.createElement('div'); track.className='hp-track';
var p1=document.createElement('div'), p2=document.createElement('div'), p3=document.createElement('div');
p1.className='hp-page hp-p1 in'; p2.className='hp-page hp-p2'; p3.className='hp-page hp-p3';
p1.appendChild(pcard); if(pill) p1.appendChild(pill); p1.appendChild(grid);
var photo=document.createElement('div'); photo.className='hw hw-photo glass tap'; photo.setAttribute('data-sz','2x2'); photo.setAttribute('data-go','app:photo'); photo.setAttribute('role','button'); photo.setAttribute('aria-label','随机照片');
photo.innerHTML=title('photo','随机一张照片')+'<div class="hw-pol"><i></i><small>相册还是空的</small></div>'; grid.appendChild(photo);
/* [位置:phone-nw-widgets.js·随机照片] [接相册真数据 + 点击直开相册] [10-27：拍立得原来是写死的「相册还是空的」，点了落到「即将开放」占位页（photo 没有注册页）。现在：liveBoot 时有缓存先秒显一张（peek('album')，与相册页共用同一份缓存），再拉 /v1/album 覆盖；回前台、翻回桌面第一页时换一张随机照片（不加定时器，桌面后台不空转）。图片预载成功才上背景，加载失败保持原样；换图带序号守卫，快速连换不会被慢图回写。11-16：不再「先开我的页、等展开再弹相册」——给 me 页挂 meAlbumDirect 标记，meSetup 里 setup 完成立刻 openAlbum（相册子页在窗口展开动画期间就盖上，视觉上就是直接打开相册），见 phone-pages.js·meSetup] [注释时间 2026-11-16 改] */
var PHOTOS=[], hwPol=photo.querySelector('.hw-pol'), phSeq=0;
function paintPhoto(){
  var i=hwPol.querySelector('i'), sm=hwPol.querySelector('small'), seq=++phSeq;
  if(!PHOTOS.length){ i.style.backgroundImage=''; sm.textContent='相册还是空的'; return; }
  var it=PHOTOS[Math.floor(Math.random()*PHOTOS.length)];
  var im=new Image();
  im.onload=function(){ if(seq!==phSeq) return; i.style.backgroundImage='url("'+String(it.url||'').replace(/"/g,'%22')+'")'; i.style.backgroundSize='cover'; i.style.backgroundPosition='center'; sm.textContent=String(it.desc||'').slice(0,18); };
  im.onerror=function(){};
  im.src=it.url;
}
document.addEventListener('visibilitychange',function(){ if(!document.hidden&&PHOTOS.length>1&&!busyUI()) paintPhoto(); });   /* 回前台换一张 */
photo.addEventListener('click',function(e){
  e.stopPropagation();   /* 拦住通用 data-go 跳转（photo 没注册页会落「即将开放」）；布局编辑是 wrap 上的捕获监听，先于这里跑并拦截，长按编辑不受影响 */
  if(busyUI()) return;
  buzz(8);
  P.meAlbumDirect=1;   /* me 页 setup 读到就立刻开相册子页（不等展开动画走完），不用再等 560ms 看一眼前「我的」 */
  P.open('me',photo);
});
p2.innerHTML='<div class="hw-g hw-g2">'+page2()+'</div>';
p3.innerHTML='<div class="hw-g hw-g3">'+page3()+'</div>';
track.appendChild(p2); track.appendChild(p1); track.appendChild(p3); wrap.appendChild(track);
home.insertBefore(wrap,pager);

/* ---------- 右屏顶部：整月日历卡（点一下进月历） ---------- */
var g3=p3.querySelector('.hw-g3');
(function(){
  var C=P.cal; if(!C) return;
  var card=document.createElement('div');
  card.className='hw hw-month glass tap'; card.setAttribute('data-sz','4x3'); card.setAttribute('data-go','app:cal'); card.setAttribute('role','button'); card.setAttribute('aria-label','月历'); card.style.setProperty('--i','0');
  g3.insertBefore(card,g3.firstChild);
  var WKN=['日','一','二','三','四','五','六'];
  function syncPill(){ var pl=card.querySelector('.pl'); if(pl&&pill) pl.textContent=pill.textContent; }
  function draw(){
    var n=new Date(), y=n.getFullYear(), m=n.getMonth(), td=n.getDate(), tk=C.key(y,m,td), first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate(), cells='', i;
    var mini=card.getAttribute('data-sz')==='4x2';   /* 迷你档（4x2）：只画当周，其余档画整月 */
    var d0=mini?td-((first+td-1)%7):1, d1=mini?Math.min(d0+6,dim):dim;
    for(i=0;i<(mini?(first+d0-1)%7:first);i++) cells+='<div class="hmc blank"></div>';
    for(var d=d0;d<=d1;d++){
      var dw=(first+d-1)%7, k=C.key(y,m,d), cls='hmc', r;
      if(k===tk) cls+=' today';
      if((r=C.inRange(k,C.PERIODS))) cls+=' p'+((k===r[0]||dw===0||d===1)?' ps':'')+((k===r[1]||dw===6||d===dim)?' pe':'');
      else if(C.inRange(k,C.PRED)) cls+=' pp';
      var ev=C.DATA[k];
      cells+='<div class="'+cls+'"><div class="nr"><b>'+d+'</b></div>'+(C.diaryOf(ev).length?'<i></i>':'')+((ev&&ev.heart)?'<em>♥</em>':'')+'</div>';
    }
    var nd=C.diaryOf(C.DATA[tk]).length;
    card.innerHTML='<div class="hm-h"><b>'+(m+1)+'月</b><small>'+y+(nd?' · 今天 '+nd+' 篇日记':'')+'</small><span class="pl"></span></div><div class="hm-wk">'+WKN.map(function(w){ return '<span>'+w+'</span>'; }).join('')+'</div><div class="hm-g">'+cells+'</div>';
    syncPill();
  }
  /* [位置:phone-nw-widgets.js·月历定时] [后台不空转] [原 30s 定时后台照跑；hidden 时跳过，回前台立即补画一次] [注释时间 2026-10-26] */
  /* [位置:phone-nw-widgets.js·月历定时] [不在桌面页不重绘] [2026-11-01 性能批 1：原来只判 hidden，切到别的桌面页或 app 后仍每 30s 重建整张月历；加当前页守卫（回到该页后下一拍/visibility 会补画）] [注释时间 2026-11-01] */
  /* [2026-11-01：不要后台偷偷跑——桌面组件只在「桌面可见（没开 app、没切后台）且在该页」时重绘] */
  card.__redraw=draw;   /* 档位变了让 doResize 重画（迷你周视图/整月） */
  draw(); setInterval(function(){ if(document.hidden||D.classList.contains('app-open')||pageOf(card)!==cur) return; draw(); },30000); window.addEventListener('ph:cal',function(){ if(document.hidden||D.classList.contains('app-open')||pageOf(card)!==cur) return; draw(); });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) draw(); });
})();
function pageOf(el){ return pages.indexOf(el.closest('.hp-page')); }
var pages=[p2,p1,p3], dots=pager.querySelectorAll('i'), N=pages.length, cur=1, visited={1:1};

/* ---------- 翻页 ---------- */
function W(){ return wrap.clientWidth||D.clientWidth; }
function setPos(p,animate){
  var tr=animate?'transform .55s '+SP+',opacity .45s':'none';
  track.style.transition=animate?'transform .55s '+SP:'none';
  track.style.transform='translate3d('+(-p*W())+'px,0,0)';
  pages.forEach(function(pg,i){ var d=Math.min(1,Math.abs(i-p)); pg.style.transition=tr; pg.style.opacity=String(1-d*.5); pg.style.transform='scale('+(1-d*.05)+')'; });
}
function paintDots(){ Array.prototype.forEach.call(dots,function(d,i){ d.classList.toggle('on',i===cur); }); }
function go(i,silent){
  i=Math.max(0,Math.min(N-1,i)); var changed=i!==cur; cur=i; setPos(i,true); paintDots();
  if(changed) closeSizes();   /* [注释 2026-11-17 补] 翻页时收掉档位/操作条：它挂在 home 上，不跟页走，留着会浮到新页盖住卡片 */
  if(!visited[i]){ visited[i]=1; pages[i].classList.add('in'); enter(i); }
  if(changed&&i===1&&PHOTOS.length>1) paintPhoto();   /* 翻回桌面第一页换一张 */
  if(changed&&!silent) buzz(6);
}
setPos(cur,false); paintDots();

/* ---------- 桌面格位编辑（替代旧「同尺寸互换」） ----------
   [位置:phone-nw-widgets.js·桌面格位编辑] [拖动让位+跨页+尺寸档位+添加面板] [11-17：要 iPhone 桌面那一套——卡片拖到哪放到哪、被压的卡自动让路、可跨页拖（图标也行）、点卡片变大小、编辑时左上角 ＋ 添加卡片/App；布局存 ph.layout.v7，旧 v6 只存顺序，按旧顺序流式近似迁移成格位] [注释时间 2026-11-17]
   模型：每个可放物在 LAY 里记 [页,行,列,宽,高]（视觉页 0=左卡片墙 1=主屏 2=右屏；主屏 #grid 只有 4 行）；OFF=收起（不占格，添加面板可放回）。 */
var LKEY='ph.layout.v7', ITEMSEL='.hp-page .hw[data-go],.hp-page .hw[data-lid],.hp-page .app-ic[data-app]';
var ROWS=[7,4,7];   /* 每视觉页的行数 */
var GC=[p2.querySelector('.hw-g2'),grid,p3.querySelector('.hw-g3')];   /* 三页的格子容器 */
var edit=false, drg=null, lp=null, lp2={x:0,y:0}, lastEnd=0, barJust=0, edgeTm=0, edgeSide=0, bar=null, sbar=null, addOv=null, offHint=false;   /* [注释 2026-11-17 改] 删 plus/hinted：＋ 并进底部编辑栏，顶部不再常驻浮钮、也不再弹压卡的长提示 */
/* 卡片目录：档位（变这些尺寸时卡内排版跟着变，CSS 按 data-sz 分档）、面板名字、面板图标键（PH.ICON 的键） */
var SIZES={
  'app:star':[[4,1],[4,2],[2,2]],
  'app:wake':[[2,1],[2,2],[4,2]],
  'app:todo':[[2,1],[2,2],[2,3],[4,2]],
  'act':[[4,2],[4,3],[4,4]],
  'app:cal':[[4,2],[4,3],[4,4]],
  'app:pulse':[[2,1],[4,1]],
  'app:mem':[[4,2],[4,3],[4,4]],
  'app:photo':[[1,1],[2,2],[4,2],[4,3]]
};
var CARDS={
  'app:photo':{n:'随机一张照片',ic:'photo',w:2,h:2},
  'app:star':{n:'随机一个标星',ic:'star',w:4,h:2},
  'app:wake':{n:'唤醒状态',ic:'wake',w:2,h:2},
  'app:todo':{n:'待办',ic:'todo',w:2,h:2},
  'act':{n:'AI 在做什么',ic:'heart',w:4,h:3},
  'app:cal':{n:'整月月历',ic:'cal',w:4,h:3},
  'app:pulse':{n:'后台 · 备份',ic:'pulse',w:2,h:1},
  'app:mem':{n:'记忆池 · 审批',ic:'mem',w:4,h:3}
};
/* 添加面板可放的 App 图标（dock 常驻的 聊天/主题/设置 不重复列） */
var ADDAPPS=['diary','heart','world','note','tools','perm','trace','cal','todo','wake','mem','star','push','pulse','photo'];
/* 默认布局 = 2026-11-17 版式：AI 卡 4x3 收进左屏 7 行（旧 4x4 是溢出格线的），主屏图标照片贴底两行，右屏原样 */
var DEF={
  'app:star':[0,1,1,4,2],'app:wake':[0,3,1,2,2],'app:todo':[0,3,3,2,2],'act':[0,5,1,4,3],
  'note':[1,3,1,1,1],'tools':[1,3,2,1,1],'perm':[1,4,1,1,1],'app:photo':[1,3,3,2,2],
  'app:cal':[2,1,1,4,3],'trace':[2,4,1,1,1],'app:pulse':[2,4,3,2,1],'app:mem':[2,5,1,4,3]
};
var LAY={}, OFF=[];
function idOf(el){ return el.getAttribute('data-go')||el.getAttribute('data-lid')||el.getAttribute('data-app'); }
function qa(root,s){ return Array.prototype.slice.call(root.querySelectorAll(s)); }   /* [位置:phone-nw-widgets.js·qa] [querySelectorAll 转数组] [格位编辑段沿用旧编辑的助手，POOL 收集用] [注释时间 2026-11-17] */
var POOL={};
qa(home,ITEMSEL).forEach(function(el){ var id=idOf(el); if(id) POOL[id]=el; });

/* ---- 占用图：'页:行:列' → 占它的 id；让位/落点全靠它 ---- */
function markOcc(occ,p,r,c,w,h,id){ for(var rr=r;rr<r+h;rr++) for(var cc=c;cc<c+w;cc++) occ[p+':'+rr+':'+cc]=id; }
function freeOcc(occ,p,r,c,w,h){ for(var rr=r;rr<r+h;rr++) for(var cc=c;cc<c+w;cc++) delete occ[p+':'+rr+':'+cc]; }
function fitsOcc(p,r,c,w,h,occ){
  if(r<1||c<1||r+h-1>ROWS[p]||c+w-1>4) return false;
  for(var rr=r;rr<r+h;rr++) for(var cc=c;cc<c+w;cc++) if(occ[p+':'+rr+':'+cc]) return false;
  return true;
}
function occFrom(lay,skip){ var o={}; Object.keys(lay).forEach(function(id){ if(id===skip) return; var a=lay[id]; markOcc(o,a[0],a[1],a[2],a[3],a[4],id); }); return o; }
function findFit(p,w,h,occ){
  for(var r=1;r<=ROWS[p]-h+1;r++) for(var c=1;c<=5-w;c++) if(fitsOcc(p,r,c,w,h,occ)) return [r,c];
  return null;
}
/* ---- 让位：把压到目标矩形的卡一个个推开（先横后竖再斜，距离近的先试）；推不开返回 false ---- */
function pushAside(p,tr,tc,tw,th,dragId,lay){
  var hit=Object.keys(lay).filter(function(id){
    if(id===dragId) return false; var a=lay[id]; if(a[0]!==p) return false;
    return !(a[1]+a[3]-1<tr||tr+th-1<a[1]||a[2]+a[4]-1<tc||tc+tw-1<a[2]);
  });
  if(!hit.length) return true;
  hit.sort(function(A,B){ var a=lay[A],b=lay[B]; return (Math.abs(a[1]-tr)+Math.abs(a[2]-tc))-(Math.abs(b[1]-tr)+Math.abs(b[2]-tc)); });
  var occ=occFrom(lay,dragId); markOcc(occ,p,tr,tc,tw,th,'#t');   /* 目标位先算占（拖动卡要来） */
  var da=lay[dragId];
  if(da&&da[0]===p) markOcc(occ,p,da[1],da[2],da[3],da[4],'#d');   /* 拖动卡 ghost 现在占的格子也不许被推进来，否则提交时会重叠 */
  for(var i=0;i<hit.length;i++){
    var id=hit[i], a=lay[id], done=null;
    freeOcc(occ,p,a[1],a[2],a[3],a[4]);   /* 自己原来的格子先腾出来再找新位，否则原地附近的候选全被自己挡住 */
    for(var rad=1;rad<=6&&!done;rad++){
      var offs=rad===1?[[0,1],[0,-1],[1,0],[-1,0]]:[[rad,0],[-rad,0],[0,rad],[0,-rad],[rad,rad],[rad,-rad],[-rad,rad],[-rad,-rad]];
      for(var k=0;k<offs.length;k++){
        var nr=a[1]+offs[k][0], nc=a[2]+offs[k][1];
        if(fitsOcc(p,nr,nc,a[3],a[4],occ)){ done=[nr,nc]; break; }
      }
    }
    if(!done) return false;
    a[1]=done[0]; a[2]=done[1]; markOcc(occ,p,a[1],a[2],a[3],a[4],id);
    if(POOL[id]) place(POOL[id],p,a[1],a[2],a[3],a[4],true);
  }
  return true;
}
/* ---- 摆放：换父容器 + 写格位；anim=true 时 FLIP（改前改后各量一次 rect，transform 滑过去） ---- */
function flipApply(el,fn){
  var a=el.getBoundingClientRect(); fn();
  var b=el.getBoundingClientRect(), dx=a.left-b.left, dy=a.top-b.top;
  if(dx||dy){
    el.classList.add('moved'); el.style.transition='none'; el.style.transform='translate('+dx+'px,'+dy+'px)'; void el.offsetHeight;
    el.style.transition='transform .42s '+SP; el.style.transform='';
    setTimeout(function(){ el.style.transition=''; },470);
  }
}
function place(el,p,r,c,w,h,anim){
  var cont=GC[p];
  var fn=function(){
    if(el.parentNode!==cont) cont.appendChild(el);
    el.style.gridArea=r+'/'+c+'/'+(r+h)+'/'+(c+w);
    el.setAttribute('data-sz',w+'x'+h);
    if(el.__redraw) el.__redraw();   /* 月历这类要按档位重画内容的卡 */
  };
  if(anim) flipApply(el,fn); else fn();
}
function renderLayout(anim){
  Object.keys(POOL).forEach(function(id){
    var el=POOL[id];
    if(OFF.indexOf(id)>=0){ if(el.parentNode) el.parentNode.removeChild(el); return; }
    var a=LAY[id]; if(!a) return;
    place(el,a[0],a[1],a[2],a[3],a[4],anim);
  });
}
/* ---- 存取与迁移 ---- */
function saveLayout(){ try{ localStorage.setItem(LKEY,JSON.stringify({v:7,items:LAY,off:OFF})); }catch(e){} }
function normalize(j){   /* 校验 v7：坏条目落最近空位，缺的（新卡/新 App）补默认位，满页的进收起 */
  LAY={}; OFF=[];
  ((j&&j.off)||[]).forEach(function(id){ if(POOL[id]) OFF.push(id); });
  var occ={};
  Object.keys((j&&j.items)||{}).forEach(function(id){
    var a=j.items[id]; if(!POOL[id]||!Array.isArray(a)||a.length<5) return;
    a=[+a[0],+a[1],+a[2],+a[3],+a[4]];
    if(a[0]<0||a[0]>2||a[3]<1||a[4]<1) return;
    if(!fitsOcc(a[0],a[1],a[2],a[3],a[4],occ)){ var f=findFit(a[0],a[3],a[4],occ); if(!f) return; a=[a[0],f[0],f[1],a[3],a[4]]; }
    LAY[id]=a; markOcc(occ,a[0],a[1],a[2],a[3],a[4],id);
  });
  Object.keys(POOL).forEach(function(id){
    if(LAY[id]||OFF.indexOf(id)>=0) return;
    var d=DEF[id]||[1,1,1,1,1];
    var f=findFit(d[0],d[3],d[4],occ);
    if(!f){ OFF.push(id); return; }
    LAY[id]=[d[0],f[0],f[1],d[3],d[4]]; markOcc(occ,d[0],f[0],f[1],d[3],d[4],id);
  });
}
function migrate(o){   /* v6 只有各页顺序：铺默认布局，再按旧顺序在各自页流式重排（近似还原当时摆法） */
  LAY={}; OFF=[];
  Object.keys(DEF).forEach(function(id){ LAY[id]=DEF[id].slice(); });
  if(!o) return;
  (o.off||[]).forEach(function(id){ if(POOL[id]&&LAY[id]) OFF.push(id); });
  [[o.p2,0],[o.p3,2]].forEach(function(pr){
    var list=pr[0], p=pr[1]; if(!Array.isArray(list)) return;
    var ids=list.filter(function(id){ return LAY[id]&&LAY[id][0]===p&&OFF.indexOf(id)<0; });
    if(ids.length<2) return;
    ids.forEach(function(id){ delete LAY[id]; });
    var occ={};
    Object.keys(LAY).forEach(function(id){ var a=LAY[id]; if(a[0]===p) markOcc(occ,a[0],a[1],a[2],a[3],a[4],id); });
    ids.forEach(function(id){ var d=DEF[id]; var f=findFit(p,d[3],d[4],occ)||[d[1],d[2]];
      LAY[id]=[p,f[0],f[1],d[3],d[4]]; markOcc(occ,p,f[0],f[1],d[3],d[4],id); });
  });
  if(Array.isArray(o.g)){
    var g=o.g.filter(function(id){ return LAY[id]&&LAY[id][0]===1&&OFF.indexOf(id)<0; });
    if(g.length>1){
      g.forEach(function(id){ delete LAY[id]; });
      var occ={};
      Object.keys(LAY).forEach(function(id){ var a=LAY[id]; if(a[0]===1) markOcc(occ,a[0],a[1],a[2],a[3],a[4],id); });
      g.forEach(function(id){ var d=DEF[id]; var f=findFit(1,d[3],d[4],occ)||[d[1],d[2]];
        LAY[id]=[1,f[0],f[1],d[3],d[4]]; markOcc(occ,1,f[0],f[1],d[3],d[4],id); });
    }
  }
}
(function(){   /* 启动：读 v7 → 校验；没有 v7 → 从 v6 迁移；再整场摆放 */
  var j=null; try{ j=JSON.parse(localStorage.getItem(LKEY)||'null'); }catch(e){}
  if(j&&j.v===7) normalize(j);
  else{ var o=null; try{ o=JSON.parse(localStorage.getItem('ph.layout.v6')||'null'); }catch(e){}
    migrate(o); saveLayout(); }
  renderLayout(false);
})();
function resetLayout(){
  LAY={}; OFF=[];
  Object.keys(DEF).forEach(function(id){ LAY[id]=DEF[id].slice(); });
  renderLayout(true);
  try{ localStorage.removeItem(LKEY); }catch(_){}
  saveLayout(); buzz(10); toast('已还原默认布局');
}
function toggleOff(el,on){
  var id=idOf(el);
  if(on){ if(LAY[id]) delete LAY[id]; if(OFF.indexOf(id)<0) OFF.push(id);
    if(el.parentNode) el.parentNode.removeChild(el);
    buzz(10); if(!offHint){ offHint=true; toast('已收起，编辑栏里的 ＋ 能放回来'); } }
  else{
    var d=DEF[id]||[cur,1,1,1,1];
    var f=findFit(d[0],d[3],d[4],occFrom(LAY));
    if(!f){ toast('现在没有空位，先挪一挪'); return; }
    OFF.splice(OFF.indexOf(id),1); LAY[id]=[d[0],f[0],f[1],d[3],d[4]];
    place(el,d[0],f[0],f[1],d[3],d[4],true); buzz(12);
  }
  saveLayout();
}
/* ---- 整理：三页各自按视觉序流式压实，空洞全消 ---- */
function tidy(){
  var ids=Object.keys(LAY).sort(function(a,b){ var A=LAY[a],B=LAY[b]; return A[0]-B[0]||A[1]-B[1]||A[2]-B[2]; });
  var occ={};
  ids.forEach(function(id){ var a=LAY[id]; var f=findFit(a[0],a[3],a[4],occ); if(f){ a[1]=f[0]; a[2]=f[1]; } markOcc(occ,a[0],a[1],a[2],a[3],a[4],id); });
  renderLayout(true); saveLayout(); buzz(8);
}
/* ---- 尺寸档位条：编辑模式点卡片弹出；图标只有「移除」 ---- */
function closeSizes(){ if(!sbar) return; var b=sbar; sbar=null; b.classList.remove('show'); setTimeout(function(){ if(b.parentNode) b.parentNode.removeChild(b); },280); }
/* [位置:phone-nw-widgets.js·posBar] [档位/操作条定位] [11-17 改：原来优先放卡上方，卡在第一行时条压在自己身上把内容盖住；改优先贴卡下沿，卡贴底时转上方，上下都夹在可视区内] [注释时间 2026-11-17] */
function posBar(b,r,hr){
  b.style.left='0px'; b.style.top='0px'; home.appendChild(b);
  var left=r.left-hr.left+r.width/2-b.offsetWidth/2;
  left=Math.max(10,Math.min(hr.width-b.offsetWidth-10,left));
  var below=r.bottom-hr.top+10, above=r.top-hr.top-b.offsetHeight-10;
  var top=(below+b.offsetHeight<=hr.height-12)?below:(above>=56?above:Math.max(56,hr.height-b.offsetHeight-14));
  b.style.left=left+'px'; b.style.top=top+'px';
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ b.classList.add('show'); }); });
  sbar=b;
}
function openItemBar(el){
  closeSizes();
  var r=el.getBoundingClientRect(), hr=home.getBoundingClientRect();
  var b=document.createElement('div'); b.className='hw-sizebar glass';
  b.innerHTML='<button type="button" data-rm="1">从桌面移除</button>';
  b.addEventListener('click',function(e){ var t=e.target.closest('[data-rm]'); if(!t) return; e.stopPropagation(); closeSizes(); toggleOff(el,true); });
  posBar(b,r,hr);
}
function openSizes(el){
  closeSizes();
  var id=idOf(el), list=SIZES[id];
  if(!list){ openItemBar(el); return; }
  var a=LAY[id], r=el.getBoundingClientRect(), hr=home.getBoundingClientRect();
  var b=document.createElement('div'); b.className='hw-sizebar glass';
  b.innerHTML=list.map(function(s){
    var on=a&&a[3]===s[0]&&a[4]===s[1];
    return '<button type="button" data-sz2="'+s[0]+'x'+s[1]+'"'+(on?' class="on"':'')+'><i style="width:'+(s[0]*6+4)+'px;height:'+(s[1]*5+4)+'px"></i><span>'+s[0]+'×'+s[1]+'</span></button>';
  }).join('');
  b.addEventListener('click',function(e){
    var t=e.target.closest('[data-sz2]'); if(!t) return; e.stopPropagation();
    var wh=t.getAttribute('data-sz2').split('x'); closeSizes(); doResize(el,+wh[0],+wh[1]);
  });
  posBar(b,r,hr);
}
/* [位置:phone-nw-widgets.js·doResize] [变档落位] [11-17 修：卡片在右侧列变宽档（如第 3 列点 4x2）时旧逻辑只在原地推挤，宽高写进 LAY 就越出 4 列格线，布局落库后变非法；先把目标格夹回界内、推挤后再复核，失败整场回滚] [注释时间 2026-11-17] */
function doResize(el,w,h){
  var id=idOf(el), a=LAY[id]; if(!a) return;
  var p=a[0], tr=Math.min(a[1],ROWS[p]-h+1), tc=Math.min(a[2],5-w);   /* 越界的档先夹回格内，宁可自己挪一点也别溢出 */
  var snap=JSON.stringify(LAY), done=false;
  if(fitsOcc(p,tr,tc,w,h,occFrom(LAY,id))) done=true;
  else if(pushAside(p,tr,tc,w,h,id,LAY)&&fitsOcc(p,tr,tc,w,h,occFrom(LAY,id))) done=true;
  if(done){ a[1]=tr; a[2]=tc; }
  else{
    try{ LAY=JSON.parse(snap); }catch(e){}
    var f=findFit(p,w,h,occFrom(LAY,id)); if(!f){ renderLayout(true); toast('旁边没有空间，先挪一挪'); return; }
    a=LAY[id]; a[1]=f[0]; a[2]=f[1];
  }
  a[3]=w; a[4]=h;
  place(el,a[0],a[1],a[2],a[3],a[4],true);
  saveLayout(); buzz(10);
}
/* ---- 添加面板：编辑栏左端 ＋ ---- */
function closeAdd(){ if(!addOv) return; var o=addOv; addOv=null; o.classList.remove('show'); setTimeout(function(){ if(o.parentNode) o.parentNode.removeChild(o); },320); }
function addState(id){ return LAY[id]?1:(OFF.indexOf(id)>=0?2:0); }   /* 1=已在桌面 2=已收起 0=可添加 */
function buildAddItems(ids,meta){
  return ids.map(function(id){
    var st=addState(id), m=meta(id); if(!m) return '';
    return '<button type="button" class="hw-addit tap'+(st===1?' in':'')+'" data-add="'+id+'"'+(st===1?' disabled':'')+'>'+
      '<span class="sq"><svg viewBox="0 0 24 24">'+m.ic+'</svg></span><span class="nm">'+esc(m.n)+'</span>'+
      '<span class="sb">'+(st===1?'已在桌面':(st===2?'已收起 · 点回':m.sub))+'</span></button>';
  }).join('');
}
function openAdd(){
  closeSizes();
  if(addOv){ closeAdd(); return; }
  var PHAPP=window.PH||{}, iconk=PHAPP.ICON||{}, appsk=PHAPP.APPS||{};
  var ov=document.createElement('div'); ov.className='hw-addov';
  ov.innerHTML='<div class="hw-addbg"></div><div class="hw-addsheet glass">'+
    '<div class="hw-add-h">添加到桌面</div>'+
    '<div class="hw-add-sec">卡片</div><div class="hw-add-grid">'+buildAddItems(Object.keys(CARDS),function(id){
      var m=CARDS[id]; return {n:m.n,ic:iconk[m.ic]||'',sub:m.w+'×'+m.h}; })+'</div>'+
    '<div class="hw-add-sec">App</div><div class="hw-add-grid">'+buildAddItems(ADDAPPS,function(id){
      var a=appsk[id]; if(!a) return null; return {n:a.n,ic:iconk[a.i]||'',sub:'1×1'}; })+'</div>'+
    '</div>';
  home.appendChild(ov);
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ ov.classList.add('show'); }); });
  ov.addEventListener('click',function(e){
    if(e.target.closest('.hw-addbg')){ closeAdd(); return; }
    var t=e.target.closest('[data-add]'); if(!t||t.disabled) return;
    e.stopPropagation(); addFromPanel(t.getAttribute('data-add'));
  });
  addOv=ov;
}
/* [位置:phone-nw-widgets.js·buildIcon] [给从没上过桌面的 App 现建图标] [11-17：面板里点「心动」没反应——可拖元素池 POOL 只收当前 DOM 里的卡和图标，注册表里有名字却没有节点；按 PH.icon 同一套标记现建一个再入池] [注释时间 2026-11-17] */
function buildIcon(id){
  var html=(window.PH&&window.PH.icon)?window.PH.icon(id,'hw-pop',0):'';
  if(!html) return null;
  var box=document.createElement('div'); box.innerHTML=html;
  var el=box.firstElementChild;
  if(!el) return null;
  POOL[id]=el;
  return el;
}
function addFromPanel(id){
  var isCard=!!CARDS[id], d=DEF[id]||[cur,1,1,1,1], w=isCard?d[3]:1, h=isCard?d[4]:1, el=POOL[id]||buildIcon(id);
  if(!el) return;
  var pages=[cur,0,1,2], got=null;
  for(var i=0;i<pages.length&&!got;i++){ var f=findFit(pages[i],w,h,occFrom(LAY)); if(f) got=[pages[i],f[0],f[1]]; }
  if(!got){ toast('三页都放不下，先挪一挪'); return; }
  var oi=OFF.indexOf(id); if(oi>=0) OFF.splice(oi,1);
  LAY[id]=[got[0],got[1],got[2],w,h];
  place(el,got[0],got[1],got[2],w,h,false);
  saveLayout(); closeAdd(); go(got[0]); buzz(12);
}
/* ---- 编辑模式与拖动 ---- */
/* [位置:phone-nw-widgets.js·setBar] [底部编辑栏] [11-17 改：原编辑栏悬在 y≈52、＋ 在左上角，两者都压住第一行卡片且吃掉点击；现在 ＋ 并进同一条栏、整条放到 dock 那一格，编辑时 dock 变暗让位] [注释时间 2026-11-17] */
function setBar(on2){
  if(on2&&!bar){
    bar=document.createElement('div'); bar.className='hw-edbar glass';
    bar.innerHTML='<button type="button" class="plus" data-ed="add" aria-label="添加卡片或 App">+</button><span class="sep"></span><button type="button" data-ed="tidy">整理</button><button type="button" data-ed="reset">还原</button><button type="button" class="ok" data-ed="done">完成</button>';
    home.appendChild(bar);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ bar.classList.add('show'); }); });
    bar.addEventListener('click',function(e){
      var b=e.target.closest('[data-ed]'); if(!b) return; e.stopPropagation();
      var k=b.getAttribute('data-ed');
      if(k==='done') exitEdit();
      else if(k==='tidy') tidy();
      else if(k==='reset') resetLayout();
      else if(addOv) closeAdd(); else openAdd();
    });
  } else if(!on2&&bar){
    var b=bar; bar=null; b.classList.remove('show'); setTimeout(function(){ if(b.parentNode) b.parentNode.removeChild(b); },360);
    closeSizes(); closeAdd();
  }
}
function enterEdit(){ if(edit) return; edit=true; home.classList.add('editing'); setBar(true); }   /* [注释 2026-11-17 改] 去掉进入时那条顶部长提示：它盖住第一行卡片、还吃掉点击；− 角标与底部编辑栏已够自解释 */
function exitEdit(){ if(!edit) return; edit=false; home.classList.remove('editing'); setBar(false); buzz(8); }
function inBadge(c,e){ var r=c.getBoundingClientRect(); return e.clientX-r.left<34&&e.clientY-r.top<34; }
function setDeny(b){ if(!drg) return; drg.deny=b; if(drg.el.classList) drg.el.classList.toggle('hw-deny',b); }
function startDrag(el,x,y,pid,fromLp){
  closeSizes();   /* 起拖先收掉开着的档位/操作条，别让它浮在半空挡视线 */
  var r=el.getBoundingClientRect(), hr=home.getBoundingClientRect();
  var fly=el.cloneNode(true); fly.removeAttribute('data-go'); fly.removeAttribute('data-lid'); fly.classList.remove('stag','tap','in'); fly.classList.add('hw-fly');
  fly.style.cssText='left:'+(r.left-hr.left)+'px;top:'+(r.top-hr.top)+'px;width:'+r.width+'px;height:'+r.height+'px;right:auto;bottom:auto;grid-area:auto';
  home.appendChild(fly); requestAnimationFrame(function(){ fly.classList.add('up'); });
  el.classList.add('moved','hw-ghost');
  drg={el:el,id:idOf(el),fly:fly,gx:x-r.left,gy:y-r.top,sx:x,sy:y,moved:false,lp:!!fromLp,deny:false,draft:null,lastKey:'',lastT:0};
  buzz(14);
  try{ wrap.setPointerCapture(pid); }catch(_){}
}
function moveDrag(x,y){
  if(!drg) return;
  if(!drg.moved&&Math.hypot(x-drg.sx,y-drg.sy)>8){ drg.moved=true; try{ drg.draft=JSON.parse(JSON.stringify(LAY)); }catch(e){ drg.draft={}; } }
  if(!drg.moved) return;
  var hr=home.getBoundingClientRect();
  drg.fly.style.left=(x-hr.left-drg.gx)+'px'; drg.fly.style.top=(y-hr.top-drg.gy)+'px';
  var side=x<hr.left+36?-1:(x>hr.right-36?1:0);
  if(side!==edgeSide){ edgeSide=side; clearTimeout(edgeTm); if(side) edgeTm=setTimeout(function(){ if(drg&&edgeSide){ go(cur+edgeSide); drg.lastKey=''; edgeSide=0; } },520); }
  var now=performance.now();
  if(now-drg.lastT<130) return; drg.lastT=now;
  var cont=GC[cur], rc=cont.getBoundingClientRect();
  var fr=drg.fly.getBoundingClientRect();
  var fx=fr.left+fr.width/2, fy=fr.top+fr.height/2;
  var a=drg.draft[drg.id]; if(!a){ setDeny(true); return; }
  var w=a[3], h=a[4];
  if(fx<rc.left-10||fx>rc.right+10||fy<rc.top-10||fy>rc.bottom+10){ drg.lastKey=''; setDeny(true); return; }
  var c=Math.max(1,Math.min(5-w,Math.floor((fx-rc.left)/(rc.width/4))+1));
  var r=Math.max(1,Math.min(ROWS[cur]-h+1,Math.floor((fy-rc.top)/(rc.height/ROWS[cur]))+1));
  var key=cur+':'+r+':'+c;
  if(key===drg.lastKey) return;
  drg.lastKey=key;

  if(fitsOcc(cur,r,c,w,h,occFrom(drg.draft,drg.id))){ setDeny(false); drg.draft[drg.id]=[cur,r,c,w,h]; place(drg.el,cur,r,c,w,h,true); return; }
  var saved=JSON.stringify(drg.draft);
  if(pushAside(cur,r,c,w,h,drg.id,drg.draft)){ setDeny(false); drg.draft[drg.id]=[cur,r,c,w,h]; place(drg.el,cur,r,c,w,h,true); return; }
  /* 让不开：同尺寸互换（旧编辑的行为——拖 A 压到同尺寸的 B 上，A 落 B 处、B 退到 A 原位） */
  var sw=null;
  Object.keys(drg.draft).some(function(id){
    if(id===drg.id) return false;
    var a2=drg.draft[id];
    if(a2[0]!==cur||a2[3]!==w||a2[4]!==h) return false;
    if(a2[1]+h-1<r||r+h-1<a2[1]||a2[2]+w-1<c||c+w-1<a2[2]) return false;
    sw=id; return true;
  });
  if(sw){
    var old=drg.draft[drg.id];
    drg.draft[sw]=[old[0],old[1],old[2],w,h];
    drg.draft[drg.id]=[cur,r,c,w,h];
    setDeny(false);
    if(POOL[sw]) place(POOL[sw],old[0],old[1],old[2],w,h,true);
    place(drg.el,cur,r,c,w,h,true);
  }
  else{ drg.draft=JSON.parse(saved); setDeny(true); }
}
function layValid(lay){   /* 提交前的兜底校验：界内 + 无重叠；算力便宜，宁可多查 */
  var occ={};
  for(var id in lay){
    var a=lay[id];
    if(!Array.isArray(a)||a.length<5) return false;
    if(a[0]<0||a[0]>2||a[1]<1||a[2]<1||a[1]+a[4]-1>ROWS[a[0]]||a[2]+a[3]-1>4) return false;
    for(var r=a[1];r<a[1]+a[4];r++) for(var c=a[2];c<a[2]+a[3];c++){ var k=a[0]+':'+r+':'+c; if(occ[k]) return false; occ[k]=id; }
  }
  return true;
}
function endDrag(){
  if(!drg) return; var d=drg; drg=null; clearTimeout(edgeTm); edgeSide=0;
  lastEnd=performance.now();
  if(d.moved) { swallow=true; setTimeout(function(){ swallow=false; },160); }
  var r=d.el.getBoundingClientRect(), hr=home.getBoundingClientRect();
  if(d.fly.parentNode){
    d.fly.classList.remove('up');
    d.fly.style.transition='left .32s '+SP+',top .32s '+SP+',transform .32s '+SP+',box-shadow .3s';
    d.fly.style.left=(r.left-hr.left)+'px'; d.fly.style.top=(r.top-hr.top)+'px';
    setTimeout(function(){ d.el.classList.remove('hw-ghost'); if(d.fly.parentNode) d.fly.parentNode.removeChild(d.fly); },340);
  }
  if(!d.moved&&!d.lp){   /* 视为点按（进入编辑的那次长按不算）：卡片左上角=收起，其余弹尺寸档/操作条 */
    barJust=performance.now();
    if(d.el.classList.contains('hw')&&inBadge(d.el,{clientX:d.sx,clientY:d.sy})){ toggleOff(d.el,true); return; }
    if(SIZES[d.id]) openSizes(d.el); else openItemBar(d.el);
    return;
  }
  if(!d.deny&&d.draft&&layValid(d.draft)){ LAY=d.draft; saveLayout(); buzz(10); }
  else{ renderLayout(true); buzz([6,40,6]); }   /* 放不下/校验不过：整场弹回拖动前的布局 */
}
wrap.addEventListener('pointerdown',function(e){
  if(e.pointerType==='mouse'&&e.button!==0) return;
  var c=e.target.closest&&e.target.closest(ITEMSEL);
  if(edit){ if(c&&!drg&&!(c.classList.contains('hw')&&inBadge(c,e))){ e.stopImmediatePropagation(); on=false; axis=null; startDrag(c,e.clientX,e.clientY,e.pointerId); } return; }
  if(!c) return;
  clearTimeout(lp&&lp.t); var px=e.clientX, py=e.clientY, pi=e.pointerId;
  lp2={x:px,y:py};
  lp={x:px,y:py,t:setTimeout(function(){ var el=c; lp=null; on=false; axis=null; enterEdit(); startDrag(el,lp2.x,lp2.y,pi,true); },430)};
});
wrap.addEventListener('pointermove',function(e){
  if(drg){ e.preventDefault(); moveDrag(e.clientX,e.clientY); return; }
  if(lp){ lp2.x=e.clientX; lp2.y=e.clientY; if(Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>9){ clearTimeout(lp.t); lp=null; } }
});
function lpEnd(){ if(lp){ clearTimeout(lp.t); lp=null; } if(drg) endDrag(); }
wrap.addEventListener('pointerup',lpEnd); wrap.addEventListener('pointercancel',lpEnd);
wrap.addEventListener('click',function(e){
  if(!edit) return; e.stopPropagation(); e.preventDefault();
  if(performance.now()-barJust<450||performance.now()-lastEnd<400) return;   /* 刚点开档位条/刚拖完/刚收起 */
  if(sbar&&!e.target.closest('.hw-sizebar')){ closeSizes(); return; }
  var c=e.target.closest&&e.target.closest(ITEMSEL);
  if(c&&c.classList.contains('hw')&&inBadge(c,e)){ toggleOff(c,true); return; }   /* 角标按下不走拖动，收起在这里接 */
  if(!c) exitEdit();
},true);
wrap.addEventListener('contextmenu',function(e){ if(edit||lp||drg) e.preventDefault(); });
home.addEventListener('pointerdown',function(e){ if(edit&&!e.target.closest('.hpages,.hw-edbar,.hw-addov,.hw-sizebar,.pager')) exitEdit(); },true);var sx=0,sy=0,st=0,on=false,axis=null,base=0,pid=0,swallow=false;
wrap.addEventListener('pointerdown',function(e){ if(e.pointerType==='mouse'&&e.button!==0) return; on=true; axis=null; sx=e.clientX; sy=e.clientY; st=performance.now(); base=cur; pid=e.pointerId; });
wrap.addEventListener('pointermove',function(e){
  if(!on) return; var dx=e.clientX-sx, dy=e.clientY-sy;
  if(axis===null){ if(Math.abs(dx)<8&&Math.abs(dy)<8) return; axis=Math.abs(dx)>Math.abs(dy)?'x':'y'; if(axis==='x'){ try{ wrap.setPointerCapture(pid); }catch(_){} } }
  if(axis!=='x') return;
  var p=base-dx/W(); if(p<0) p*=.3; else if(p>N-1) p=(N-1)+(p-(N-1))*.3;
  setPos(p,false);
});
function end(e){
  if(!on) return; on=false; if(axis!=='x') return;
  var dx=e.clientX-sx, dt=Math.max(1,performance.now()-st), v=dx/dt, t=cur;
  if(Math.abs(dx)>W()*.2||Math.abs(v)>.4) t=dx<0?cur+1:cur-1;
  swallow=true; setTimeout(function(){ swallow=false; },80); go(t);
}
wrap.addEventListener('pointerup',end); wrap.addEventListener('pointercancel',end);
wrap.addEventListener('click',function(e){ if(swallow){ e.stopPropagation(); e.preventDefault(); } },true);
pager.addEventListener('click',function(e){ var d=e.target.closest('i'); if(!d) return; go(Array.prototype.indexOf.call(dots,d)); });
addEventListener('resize',function(){ setPos(cur,false); });

/* ---------- 卡片点击 → 展开详情 ---------- */
function busyUI(){ return !!D.querySelector('.win,.tl-ov'); }
wrap.addEventListener('click',function(e){
  var q=e.target.closest('[data-q]'); if(q){ e.stopPropagation(); judge(q.getAttribute('data-q')==='y',+(q.getAttribute('data-qi')||0)); return; }   /* 记忆卡一次显两条，按钮带上自己那条的序号（2026-11-10） */
  var c=e.target.closest('.hw[data-go],.app-ic[data-go]'); if(!c||busyUI()) return;
  var g=c.getAttribute('data-go'), org=c.classList.contains('app-ic')?(c.querySelector('.sq')||c):c; buzz(8);
  if(g.indexOf('tool:')===0){ P.tools.open(D,g.slice(5),org); }
  else if(g.indexOf('app:')===0){
    var parts=g.slice(4).split('@'); if(parts[0]==='star') P.starFocus=(STARS[si]||[])[0]||null; P.open(parts[0],org);
    if(parts[1]) setTimeout(function(){ var w=D.querySelector('.win[data-win="'+parts[0]+'"]'), t=w&&w.querySelector(parts[1]); if(t&&t.scrollIntoView) t.scrollIntoView({behavior:'smooth',block:'start'}); },700);
  }
});

/* ---------- 第 2 页：唤醒倒计时 ---------- */
var cd=$('#hwCd',wrap), pct=$('#hwPct',wrap), r1=$('#hwR1',wrap), C1=2*Math.PI*34;
var gapMin=(P.settings&&P.settings.dayGap)||60, left=0, total=gapMin*60;   /* 联网前不编倒计时（2026-10-22：原来是假的 41 分钟前醒过） */
function paintWake(){
  if(!LV||NOWAKE){ cd.textContent='--:--:--'; pct.textContent='--'; r1.style.setProperty('--o',C1.toFixed(1)); return; }
  var h=Math.floor(left/3600), m=Math.floor(left%3600/60), s=left%60;
  cd.textContent=('0'+h).slice(-2)+':'+('0'+m).slice(-2)+':'+('0'+s).slice(-2);
  var p=Math.max(0,Math.min(1,left/total)); r1.style.setProperty('--o',(C1*(1-p)).toFixed(1)); pct.textContent=Math.round(p*100)+'%';
}
/* [位置:phone-nw-widgets.js·唤醒倒计时] [后台不空转] [hidden 时跳过刷帧（left 每次按真实时间重算，回来就是准的，不用补）] [注释时间 2026-10-26] */
paintWake(); /* [2026-11-01 性能批 1 修复：pageOf(wrap) 永远是 -1（wrap 是 hpages 容器），1s 唤醒倒计时实际从没被页面守卫拦住；改用 p1（桌面首页）判定当前页 */
setInterval(function(){ if(document.hidden||D.classList.contains('app-open')||pageOf(p1)!==cur) return; if(LV){ if(LT) left=Math.max(0,Math.round((LT-Date.now())/1000)); } else if(left>0) left--; paintWake(); },1000);

/* ---------- 记忆待审：直接 ✓ ✗ ---------- */
/* [位置:phone-nw-widgets.js·showQ/judge] [待审卡一次显一条、正文放大] [11-10：之前一次两条每条被截成一行看不全；改成一次一条、正文最多 4 行；按 data-qi 定位，判完从下一条起重画（两条改一条，同日更新）] [注释时间 2026-11-10] */
var hq=$('#hwQ',wrap), qn=$('#hwQn',wrap), qi=0, qleft=QUEUE.length, qbusy=false;
/* [位置:phone-nw-widgets.js·qRow] [记忆待审卡重排：按钮横排沉底带文字、顶部加「第几条/共几条」+ 进度条] [11-17：原来 ✕✓ 竖排贴右侧中间、正文下方大片空白、不知道还剩几条；改成 分类+序号 在上、正文占满中间、「忽略 / 收下」两个宽按钮在底部（拇指好够，也不容易点错——驳回不可恢复）；逻辑/接口/data-q 协议一律没动] [注释时间 2026-11-17] */
function qRow(q,i){
  var tot=QUEUE.length||1, pc=Math.round((i+1)/tot*100);
  return '<div class="hw-qi" data-qi="'+i+'"><div class="hw-qh"><span class="cat">'+esc(q.c)+'</span><span class="hw-qc"><b>'+(i+1)+'</b> / '+tot+'</span></div>'+
    '<div class="hw-qp"><u style="width:'+pc+'%"></u></div>'+
    '<p>'+esc(q.t)+'</p>'+
    '<div class="hw-qb"><button type="button" data-q="n" data-qi="'+i+'" aria-label="忽略">'+IC.x+'<em>忽略</em></button><button type="button" class="y" data-q="y" data-qi="'+i+'" aria-label="收下">'+IC.ok+'<em>收下</em></button></div></div>';
}
function showQ(){
  if(qi>=QUEUE.length){ hq.innerHTML='<div class="hw-qe">'+(LV?IC.ok+'待审已清空 ✦':'读取中…')+'</div>'; return; }
  hq.innerHTML=qRow(QUEUE[qi],qi);
}
function judge(yes,i){
  var it=hq.querySelector('.hw-qi[data-qi="'+i+'"]'); if(!it||qbusy) return;
  if(LV&&QUEUE[i]&&QUEUE[i].id){
    qbusy=true;
    P.net.post('/heartbeat/admin/memory-review/queue/'+encodeURIComponent(QUEUE[i].id)+(yes?'/approve':'/reject'),yes?{}:{note:''}).then(function(){ qbusy=false; judge2(yes,it,i); },function(){ qbusy=false; toast('没处理成功，稍后再试'); });
    return;
  }
  judge2(yes,it,i);
}
function judge2(yes,it,i){
  if(qbusy) return; qbusy=true; buzz(yes?12:6);
  it.classList.add(yes?'gone-y':'gone-n'); qleft--; qn.textContent=qleft; toast(yes?'已收进记忆池':'已忽略');
  setTimeout(function(){ qi=i+1; showQ(); qbusy=false; },440);
}
showQ();

/* ---------- 最近动静：自己轮播 ---------- */
var ha=$('#hwA',wrap), pg=$('#hwPg',wrap), actIdx=0;
function actHTML(f){ return '<span class="ic">'+(IC[f.k]||IC.wake)+'</span><div class="bd"><div class="tt">'+esc(f.t)+'<small>'+esc(f.time)+'</small></div><div class="mm">'+esc(f.m)+'</div></div>'; }
function paintPg(){ Array.prototype.forEach.call(pg.children,function(d,i){ d.classList.toggle('on',i===actIdx); }); }
var actTab='push', TOOLF=[],   /* [位置:phone-nw-widgets.js·actTab] [AI 在做什么默认页签] [11-16：默认显示推送（原 wake），页签按钮的 class="on" 在 page2 里同步改] [注释时间 2026-11-16] */
  PUSHF=[], PEVT=false, TEV=false;
function loadToolsEv(){ return P.net.get('/heartbeat/admin/recent-tools?limit=12',{noLogin:true}).then(function(r){
  /* [位置:phone-nw-widgets.js·loadToolsEv] [最近动静里工具调用时间改成北京时间] [11-07：后端 recent-tools 给的是 toISOString 的 UTC，原来切字符串当墙上时间，少 8 小时；
     改用 P.net.parse 转本机时间取「MM-DD HH:mm」，与同一张卡里推送那栏（服务端 fmtLocalAt 已是本地时间）口径一致，长度也不变] [注释时间 2026-11-07] */
  TEV=true; var a=((r&&r.items)||[]).map(function(x){ var dt=P.net.parse(x.time); return {k:'tool',t:x.name,time:dt?(P.net.two(dt.getMonth()+1)+'-'+P.net.two(dt.getDate())+' '+P.net.two(dt.getHours())+':'+P.net.two(dt.getMinutes())):(x.time?String(x.time).slice(5,16):''),m:x.hint||''}; });
  TOOLF.length=0; Array.prototype.push.apply(TOOLF,a); showAct();
}).catch(function(){}); }
function chName(ch){ return /bark/i.test(ch)?'Bark':/web/i.test(ch)?'Web 推送':ch||'推送'; }
function setPushF(items){
  PEVT=true;
  PUSHF=(items||[]).slice(0,12).map(function(p){ var sent=p.sent!==false;
    return {k:'push',push:sent,t:(p.title?p.title+' · ':'')+(sent?chName(p.channel):'自动唤醒'),time:p.at?String(p.at).slice(5,16):'',m:sent?String(p.body||p.content||''):(p.body?('没发 · '+p.body):'没发')}; });
  showAct();
}
function loadPushEv(){ return P.net.get('/heartbeat/admin/push-events?all=1',{noLogin:true}).then(function(r){
  setPushF(((r&&r.items)||[]).filter(function(p){ return p.sent!==false?String(p.body||p.content||''):true; }));
}).catch(function(){}); }
function actList(){ if(actTab==='tool') return TOOLF; if(actTab==='push') return PUSHF.length?PUSHF:(PEVT?[]:FEED.filter(function(f){ return f.k==='push'; })); return FEED.filter(function(f){ return f.k!=='push'; }); }
function showAct(){
  var list=actList(); if(!list.length){ ha.innerHTML='<div class="hw-ae">还没有</div>'; return; }
  ha.innerHTML='<div class="pl-tl">'+list.map(function(f){ var isP=f.k==='push', icn=isP?(f.push?IC.push:IC.x):IC[f.k]||IC.wake;
    return '<div class="e on"><span class="ic k-'+f.k+'">'+(isP?'<i class="push-dot '+(f.push?'ok':'bad')+'"></i>':'')+icn+'</span><div class="bd"><div class="t">'+esc(f.t)+'<small>'+esc(f.time)+'</small></div><div class="m">'+esc(f.m)+'</div></div></div>'; }).join('')+'</div>'; ha.scrollTop=0;
}
showAct(); pg.style.display='none';
$('#hwTabs',wrap).addEventListener('click',function(e){ var b=e.target.closest('[data-t]'); if(!b) return; e.stopPropagation(); actTab=b.getAttribute('data-t'); Array.prototype.forEach.call(this.children,function(x){ x.classList.toggle('on',x===b); }); buzz(5); showAct(); });

/* ---------- 第 3 页：日志滚动、标星轮换 ---------- */
var term=$('#hwTerm',wrap), li=0, sec=2;
function stamp(){ sec+=1+((li*7)%4); var s=sec%60, m=Math.floor(sec/60)%60; return '03:'+('0'+m).slice(-2)+':'+('0'+s).slice(-2); }
function pushLog(){
  if(LV||!term) return;
  var L=LOGS[li%LOGS.length]; li++;
  var d=document.createElement('div'); d.className='hw-ln'+(L[2]?' warn':'');
  d.innerHTML='<time>'+stamp()+'</time><b>'+L[0]+'</b><span>'+esc(L[1])+'</span>';
  term.appendChild(d); while(term.children.length>5) term.removeChild(term.firstChild);
}
for(var k=0;k<4;k++) pushLog();
setInterval(function(){ if(document.hidden||D.classList.contains('app-open')) return; if(term&&pageOf(term)===cur&&!busyUI()) pushLog(); },2600);
var hs=$('#hwStar',wrap), si=0;
function starHTML(s){ return '<p class="hw-quote big">“'+esc(s[0])+'”</p>'+(s[1]?'<div class="hw-sd">'+esc(s[1])+'</div>':''); }
hs.innerHTML=starHTML(STARS[0]); hs.style.cssText='display:flex;flex-direction:column;justify-content:center;flex:1;min-height:0;transition:opacity .3s,transform .4s '+SP;
setInterval(function(){ if(document.hidden||D.classList.contains('app-open')||pageOf(hs)!==cur||busyUI()) return; si=(si+1)%STARS.length; hs.style.opacity='0'; hs.style.transform='translateY(-6px)'; setTimeout(function(){ hs.innerHTML=starHTML(STARS[si]); hs.style.transform='translateY(6px)'; void hs.offsetHeight; hs.style.opacity='1'; hs.style.transform='none'; },300); },6500);

/* ---------- 待办卡 ---------- */
function paintTodo(){
  var ul=$('#hwTl',wrap), n=$('#hwTn',wrap); if(!ul) return;
  ul.innerHTML=TODOS.length?TODOS.slice(0,4).map(function(t){ return '<li><s></s><span>'+esc(t.t)+'</span></li>'; }).join(''):'<li class="e">'+(LV?'今天没有待办 ✦':'读取中…')+'</li>';
  if(n) n.textContent=TODOS.length;
}
paintTodo();   /* 11-16：信封卡删除（C2），paintLetter 与 LETTER 占位数据一并清掉 */

/* ---------- 联网：登录过就直接换成真数据（不弹登录框；没登录先保持示例，登录后自动换） ---------- */
function dur2(sec){ var d=Math.floor(sec/86400), h=Math.floor(sec%86400/3600), m=Math.floor(sec%3600/60); return d?d+' 天 '+h+' 小时':h?h+' 小时 '+m+' 分':m+' 分钟'; }
function tms(iso){ var d=new Date(iso); return isNaN(d)?0:d.getTime(); }
function ago2(ms){ var t=Math.max(0,Math.round((Date.now()-ms)/1000)); if(t<90) return '刚刚'; if(t<3600) return Math.round(t/60)+' 分钟前'; if(t<86400) return Math.round(t/3600)+' 小时前'; return Math.round(t/86400)+' 天前'; }
function setT(sel,txt){ var e=$(sel,wrap); if(e) e.textContent=txt; return e; }
function wakeParse(lines){
  var out=[], cur=null, tgt=null, logs=[], t='';
  lines.forEach(function(l){
    var m=/开始自动唤醒\s+(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}))/.exec(l);
    if(m){ t=m[2]; cur={k:'wake',t:'唤醒检查',time:m[1],m:'',raw:[],idle:false}; out.push(cur); return; }
    if(/^=+\s*$/.test(l.trim())) return;
    var tg=/^\[([^\]]+)\]\s*(.*)$/.exec(l); logs.push({t:t||'--:--',tag:tg?tg[1]:'log',txt:tg?tg[2]:l,warn:/失败|错误|超时|重试|异常/.test(l)});
    if(!cur) return;
    cur.raw.push(l.replace(/^\[[^\]]+\]\s*/,'').trim());
    var dn=/正文 (\d+) 字/.exec(l); if(dn) cur.body=+dn[1];
    var dc=/唤醒周期已重置：\S+ → ([^\s]+)/.exec(l); if(dc) cur.done=tms(dc[1]);
    var s=/暂不需要唤醒：起点 ([\d-]+ [\d:]+)（(白天|夜间)），阈值 (\d+) 分钟，到点 ([\d-]+ [\d:]+)/.exec(l);
    if(s){ cur.idle=true; cur.m='看了一眼，暂时不用叫醒他（'+s[2]+'，到点 '+s[4].slice(5)+'）'; tgt={at:s[4],thr:+s[3]}; }
    else if(/已保存日记/.test(l)){ cur.diary=1; cur.k='diary'; cur.t='写了日记'; }
    else if(/AI 选择发送推送/.test(l)) cur.pushS=1;
    else if(/推送失败/.test(l)) cur.pushU=l.replace(/^\[[^\]]+\]\s*/,'').slice(0,40);
    else if(/本次不发送推送/.test(l)) cur.pushNo=1;
  });
  out.forEach(function(c){ if(!c.m) c.m=c.raw[c.raw.length-1]||'醒来看了看。'; });
  var seenIdle=false, keep=[]; out.slice().reverse().forEach(function(c){ if(c.idle){ if(seenIdle) return; seenIdle=true; } keep.push(c); });
  return {feed:keep.slice(0,6).map(function(c){ var d=P.net.parse(c.time); return {k:c.k,t:c.t,time:d?P.net.fmtTime(d):c.time,m:c.m,done:c.done||0,body:c.body||0,diary:c.diary,pushS:c.pushS,pushU:c.pushU,pushNo:c.pushNo}; }),logs:logs.slice(-5),target:tgt};
}
function paintFeed(feed){
  FEED=feed.length?feed:[{k:'wake',t:'唤醒',time:'—',m:'最近没有唤醒记录'}];
  actIdx=0;
  var done=FEED.filter(function(f){ return !f.idle&&f.done; });
  if(!done.length){ showAct(); return; }
  P.net.get('/heartbeat/admin/wake-receipts?limit=20',{noLogin:true}).then(function(r){
    var its=(r&&r.items)||[];
    done.forEach(function(f){ var rec=null; for(var i=0;i<its.length;i++){ if(tms(its[i].time)&&Math.abs(tms(its[i].time)-f.done)<90000){ rec=its[i]; break; } } if(rec) applyRec(f,rec); else fb(f); });
    showAct();
  },function(){ done.forEach(fb); showAct(); });
}
function fb(f){ var mm=[]; if(f.diary&&f.body)mm.push('正文 '+f.body+' 字'); else if(f.body)mm.push('回了 '+f.body+' 字'); if(f.pushS)mm.push('推送已发出'); if(f.pushU)mm.push('推送没送到：'+f.pushU); else if(f.pushNo&&!f.diary)mm.push('没推送'); f.m=mm.join(' · ')||'醒来看了看'; }
/* 唤醒段 → 时间线里的系统回执：[NO_ACTION] 原因、日记字数、推送判定都在回执里，不在日志 */
var WAKESES='s_mv5m2v01_1jjxuo';
function applyRec(f,r){
  var mm=[];
  if(r.diary){ f.t='写了日记'; if(f.body) mm.push('正文 '+f.body+' 字'); }
  else { if(f.k==='diary') f.t='写了日记'; if(f.body) mm.push('回了 '+f.body+' 字'); }
  if(r.noaction) f.t='没动作 · '+r.noaction;
  if(r.pushS) mm.push('推送已发出'); else if(r.pushU) mm.push('推送没送到：'+r.pushU); else if(r.pushNo&&!r.diary) mm.push('没推送');
  if(mm.length) f.m=mm.join(' · ');
}
function paintTerm(logs){
  if(!term) return; term.innerHTML=''; (logs.length?logs:[{t:'--:--',tag:'wake',txt:'还没有日志',warn:false}]).forEach(function(L){
    var d=document.createElement('div'); d.className='hw-ln'+(L.warn?' warn':''); d.innerHTML='<time>'+esc(L.t)+'</time><b>'+esc(L.tag)+'</b><span>'+esc(L.txt)+'</span>'; term.appendChild(d);
  });
}
/* [位置:phone-nw-widgets.js·loadWake/wakeNext] [「距下次唤醒」倒计时读后端 /v1/wake-next] [10-28：原来解析日志里「暂不需要唤醒…到点」那一行，认不出闹钟/旧槽，没有锁定会话时数字停在旧值；现在后端直接给「下一次叫醒的时刻 + 原因（闹钟/旧槽/周期）」，没有锁定会话就明说，不再显示假倒计时；后端没取到才退回日志里的数字] [注释时间 2026-10-28] */
/* [位置:phone-nw-widgets.js·wakeNext/loadWake 重试] [倒计时取不到不再卡 00:00:00] [11-03 截图：首页唤醒小组件显示距下次唤醒 00:00:00（唤醒页是对的）。真浏览器复现：/v1/wake-next 那一下失败（没登录/网关刚重启/网络抖）就卡在 00:00:00，且原来要等日志请求先成功才会去取 wake-next。改：①未知显示 --:--:--；②wake-next 与日志并行取，互不依赖；③取不到 8 秒后重试（最多 8 次），之后照旧每分钟轮询] [注释时间 2026-11-03] */
var WKOK=false, wkTry=0, wkTimer=0;
function wakeNext(fallback){
  return P.net.get('/v1/wake-next',{noLogin:true}).then(function(r){
    if(!r||!r.ok){ if(fallback) fallback(); return; }
    WKOK=true;
    var sm='.hw-hero .hw-tx small', n=r.next;
    if(n){
      NOWAKE=false; LT=+new Date(n.at)||0; left=Math.max(0,Math.round((LT-Date.now())/1000));
      total=n.kind==='cycle'?(+n.thr||60)*60:Math.max(left,60);
      setT(sm,n.kind==='cycle'?'距下次唤醒':'距下次唤醒 · 闹钟');
      setT('#hwGap',n.kind==='cycle'?'睡眠 · 聊天停 '+(+n.thr||'—')+' 分钟叫他':(n.by==='user'?'你设的闹钟':'')+((n.by==='user'&&(n.label||n.name))?' · ':'')+(n.label||n.name||''));
    } else {
      NOWAKE=true; LT=0; left=0;
      setT(sm,r.locked?'距下次唤醒':'没有开事件唤醒的会话'); setT('#hwGap',r.locked?'等你下次聊天后重新计时':'开了事件唤醒才会自动叫他');
    }
    paintWake();
  },function(){ if(fallback) fallback(); });
}
function loadWake(){
  var pwRef=null;
  var a=P.net.get('/heartbeat/admin/logs/wake-up?lines=400',{noLogin:true}).then(function(r){
    var pw=wakeParse((r&&r.lines)||[]); pwRef=pw; paintFeed(pw.feed); paintTerm(pw.logs); return pw;
  });
  function useLog(){ return a.then(function(pw){ if(pw&&pw.target&&!WKOK){ NOWAKE=false; LT=+P.net.parse(pw.target.at)||0; total=pw.target.thr*60; if(LT){ left=Math.max(0,Math.round((LT-Date.now())/1000)); paintWake(); } } },function(){}); }
  var b=wakeNext(useLog);
  return Promise.all([a.catch(function(){}),b.catch(function(){})]).then(function(){
    if(!WKOK&&wkTry<8&&!wkTimer){ wkTry++; wkTimer=setTimeout(function(){ wkTimer=0; loadWake().catch(function(){}); },8000); }
    if(WKOK) wkTry=0;
  });
}
function paintTools(cfg){
  var d=P.tools.data(), TD=P.tools.def, i;
  var sv=(d.alerts&&d.alerts.services)||[], bad=sv.filter(function(x){ return !x.ok; });
  var dots=$('.hw-svc .hw-dots',wrap); if(dots) dots.innerHTML=sv.map(function(x){ return '<span class="'+(x.ok?'':'warn')+'"></span>'; }).join('');
  setT('.hw-svc .hw-sub',sv.length?(sv.length-bad.length)+' 正常'+(bad.length?' · '+bad.length+' 异常':''):'暂无数据');
  var bk=d.bk&&d.bk.latest; setT('.hw-bak .hw-big',bk?ago2(bk.mtime):'暂无'); var tk=$('.hw-bak .hw-tick',wrap); if(tk) tk.innerHTML='';
  var p=d.push[0]; setT('.hw-push .hw-quote',p?p.t:'还没有推送'); setT('.hw-push .hw-sub',p?p.w+' · '+p.ch:'');
  var ol=$('.hw-pin .hw-ol',wrap); if(ol) ol.innerHTML=(d.pin.length?d.pin.slice(0,3):['还没有固定注入的内容']).map(function(t){ return '<li><span>'+esc(t)+'</span></li>'; }).join('');
  STARS=d.stars.length?d.stars.map(function(x){ return [x.x,x.b+' · '+x.d]; }):[['还没有标星的句子','']]; si=0; hs.innerHTML=starHTML(STARS[0]);
  var sg=$('.hw-cross .hw-seg',wrap); if(sg) sg.style.display='none'; setT('.hw-cross .hw-sub','他下次会带上 '+((d.xw&&d.xw['实际注入'])||[]).length+' 段');
  var r=d.rep[0], cmp=$('.hw-swap .hw-cmp',wrap);
  if(cmp) cmp.innerHTML=r?'<small>'+esc(r.label)+'</small><p class="hw-note">'+esc(r.m)+'</p>':'<small>还没有压缩记录</small>';
  setT('.hw-swap .hw-sub',r?r.t:'');
  [['push','.hw-push'],['pin','.hw-pin'],['star','.hw-star'],['swap','.hw-swap']].forEach(function(x){ var em=$(x[1]+' .hw-t em',wrap); if(em) em.textContent=TD[x[0]].chip(); });
  var tok=d.layers.reduce(function(a,l){ return a+l[1]; },0), lim=(cfg&&(+cfg.ctx_limit_alert_tokens||(+cfg.compaction_context_limit_chars||0)/1.5))||0;
  CTXP=lim&&tok?Math.min(100,Math.round(tok/lim*100)):0;
  var cx=$('#hwCtx',wrap), r2=$('.hw-r2',wrap); if(cx) cx.textContent=tok&&lim?CTXP+'%':'—'; if(r2) r2.style.setProperty('--o',(2*Math.PI*42*(1-CTXP/100)).toFixed(1));
  setT('.hw-ctx .hw-chip',tok?tok.toLocaleString()+' tok':'暂无请求'); setT('.hw-ctx .hw-sub','实际发给模型的');
}
/* ---------- 卡片数据刷新（批4 I2：卡片与 app 页同源，改完回桌面跟着变） ---------- */
/* [位置:phone-nw-widgets.js·fetchTodos/fetchAlbum/fetchQueue/fetchStars] [卡片数据按需重拉] [11-16：桌面卡片的数据原来只有登录那一次（liveBoot）取，在 app 页里增删改后回桌面还是旧快照——「卡片和实际数据对不上」的主因，接口层面大多同源。现在提成模块级函数，关掉对应 app 后定向重拉（todo→待办、me→相册、mem→待审、star→标星），回前台四张全刷，2.5 秒防抖合并连续动作，未登录不动；失败静默保持旧值（卡片本来就是快照语义）] [注释时间 2026-11-16] */
/* [位置:phone-nw-widgets.js·staleTip] [卡片缓存降级一次性提示] [批5：四张桌面卡（待办/照片/待审/标星）拉失败保持旧值时 toast 一次；文件级共用一个标记，成功拉到任一份就复位——回前台四张全刷也不会连环弹] [注释时间 2026-11-17] */
var staleToasted=false;
function staleTip(){ if(staleToasted) return; staleToasted=true; toast('没连上，卡片先显示上次的内容'); }
function mapT(t){ var s=String(t.text||'').replace(/\s\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\s*$/,'').replace(/^\s*\u{1F4CC}\s*/u,'').trim(); var uPrefix=(P.names&&P.names.me)?P.names.me()+'：':''; if(uPrefix&&s.indexOf(uPrefix)===0) s=s.slice(uPrefix.length).trim(); return {id:t.id,t:s}; }
function fetchTodos(){
  return P.net.get('/todo/api/todos',{noLogin:true}).then(function(list){
    staleToasted=false;
    P.net.keep('todos',list);
    TODOS=(list||[]).map(mapT).sort(function(a,b){ return b.id-a.id; });
    paintTodo();
  },function(){ staleTip(); });
}
var alSig=null;
function fetchAlbum(){
  return P.net.get('/v1/album',{noLogin:true}).then(function(r){
    staleToasted=false;
    var its=(r&&r.items)||[], sg=its.map(function(x){ return x.id||x.url; }).join('|');
    P.net.keep('album',its); PHOTOS=its;
    if(sg!==alSig){ alSig=sg; paintPhoto(); }   /* 数据没变就不换图：回前台「换一张」那条 listener 已经先换过一次，这里再来一次会连闪两张 */
  },function(){ staleTip(); });
}
function fetchQueue(){
  return P.net.get('/heartbeat/admin/memory-review/queue',{noLogin:true}).then(function(r){
    staleToasted=false;
    if(qbusy) return;   /* 正在进行中的判定动完会自己往下画，这一轮结果可能已经过期 */
    QUEUE=((r&&r.items)||[]).map(function(x){ var c=x.candidate||{}; return {id:x.id,c:c.kind||'记忆',t:c.text||''}; });
    qi=0;   /* 回来的列表可能变短（刚批掉的已经不在），序号从第一条重来，不会越界指到空 */
    qleft=QUEUE.length; qn.textContent=qleft; showQ();
  },function(){ staleTip(); });
}
function fetchStars(){
  var d=P.tools&&P.tools.def&&P.tools.def.star;
  if(!d||!d.load) return Promise.resolve();
  return d.load().then(function(){
    staleToasted=false;
    var ds=(P.tools.data()||{}).stars||[];
    STARS=ds.length?ds.map(function(x){ return [x.x,x.b+' · '+x.d]; }):[['还没有标星的句子','']];
    si=0; if(hs) hs.innerHTML=starHTML(STARS[0]);
  },function(){ staleTip(); });
}
/* [位置:phone-nw-widgets.js·reqRefresh] [关 app / 回前台定向重拉] [ph:appclose 不带 app 名（11-01 天空恢复那套事件的锅），但 closeApp 派发时窗口还在 DOM 里（win.dataset.win=app id），从它读，不用改 phone-new.html] [注释时间 2026-11-16] */
var RFQ={todo:0,album:0,queue:0,star:0}, rfT=0;
function reqRefresh(k){ if(!LV||!k) return; RFQ[k]=1; clearTimeout(rfT);
  rfT=setTimeout(function(){ rfT=0; if(!LV) return;
    if(RFQ.todo){ RFQ.todo=0; fetchTodos(); }
    if(RFQ.album){ RFQ.album=0; fetchAlbum(); }
    if(RFQ.queue){ RFQ.queue=0; fetchQueue(); }
    if(RFQ.star){ RFQ.star=0; fetchStars(); }
  },2500); }
document.addEventListener('ph:appclose',function(){
  var w=D.querySelector('.win'), app=w&&w.getAttribute('data-win');
  if(app==='todo') reqRefresh('todo');
  else if(app==='me') reqRefresh('album');
  else if(app==='mem') reqRefresh('queue');
  else if(app==='star') reqRefresh('star');
});
document.addEventListener('visibilitychange',function(){ if(document.hidden) return; reqRefresh('todo'); reqRefresh('album'); reqRefresh('queue'); reqRefresh('star'); });
function liveBoot(){
  if(LV) return;
  P.net.get('/heartbeat/admin/env',{noLogin:true}).then(function(env){
    if(LV) return; LV=true; P.tools.setLive(true);
    var w=env.wake||{}, on=/^在线/.test(env.wakeStatus||''), lv=$('.hw-hero .hw-live',wrap);
    if(lv&&lv.lastChild) lv.lastChild.textContent=on?'运行正常':'唤醒服务离线';
    setT('.hw-hero .hw-top small','已运行 '+dur2(env.uptime||0));
    gapMin=+w.dayWakeAfter||gapMin; total=gapMin*60; left=0; NOWAKE=true; paintWake();   /* 联网后、拿到「下一次」之前是「不知道」，显示 --:--:-- 而不是假的 00:00:00（11-03 截图：取不到时一直停在 00:00:00） */
    /* [2026-11-16 批4] 删掉原来的「日间 X 分 · 夜间 Y 分」初始文案和只写不读的 window.__wakeNight：日/夜间隔口径 11-09 起已被 sleep-wake 取代，wake-next 成功会立即覆盖 #hwGap，失败时这行旧文案就留着误导人（全仓已核无 __wakeNight 读取点） */
    loadWake().catch(function(){});
    loadPushEv();
    loadToolsEv();
    /* [位置:phone-nw-widgets.js·唤醒轮询] [不在桌面页不拉取] [2026-11-01 性能批 1：原来只判 hidden，不在桌面页也每分钟打一次 /v1/wake-next；加当前页守卫，减少无线电唤醒] [注释时间 2026-11-01] */
    setInterval(function(){ if(document.hidden||D.classList.contains('app-open')||pageOf(p1)!==cur) return; loadWake().catch(function(){}); },60000);
    /* [位置:phone-nw-widgets.js·待办卡加载] [待办卡缓存秒显] [和待办页共用一份缓存（ph_c_todos，原始服务器格式，mapT 两边各自映射）：有缓存先秒出，后台拉到新的覆盖并回写。2026-11-16 批4 I2：网络那一段提成模块级 fetchTodos，关掉待办 app 后由 reqRefresh 再跑一次] [注释时间 2026-10-26；2026-11-16 改] */
    (function(){ var c0=P.net.peek('todos'); if(c0&&c0.length){ TODOS=c0.map(mapT).sort(function(a,b){ return b.id-a.id; }); paintTodo(); } })();
    fetchTodos();
    /* [位置:phone-nw-widgets.js·随机照片加载] [和相册页共用一份缓存（ph_c_album）] [有缓存先秒显，拉到新的覆盖并回写——相册里删光的照片不会在桌面死灰复燃。2026-11-16 批4 I2：拉取提成 fetchAlbum（带条目签名，数据没变不换图）] [注释时间 2026-10-27；2026-11-16 改] */
    (function(){ var c0=P.net.peek('album'); if(c0&&c0.length){ PHOTOS=c0; paintPhoto(); } })();
    fetchAlbum();
    /* [位置:phone-nw-widgets.js·记忆待审队列加载] [待审卡数据] [2026-11-16 批4 I2：提成模块级 fetchQueue（qbusy 时跳过、qi 收敛到 0），关掉记忆池 app 后重拉] [注释时间 2026-11-16] */
    fetchQueue();
    Promise.all([P.tools.loadAll(),P.net.get('/heartbeat/admin/context-compaction/config',{noLogin:true}).catch(function(){ return null; })]).then(function(r){ paintTools(r[1]); }).catch(function(){});
  }).catch(function(){});
}
liveBoot(); window.addEventListener('ph:login',liveBoot);

/* ---------- 首次进入页面时的小动画 ---------- */
function count(el,to,ms,suffix){ var t0=performance.now(); (function f(t){ var p=Math.min(1,(t-t0)/ms); el.textContent=Math.round(to*(1-Math.pow(1-p,3)))+(suffix||''); if(p<1) requestAnimationFrame(f); })(t0); }
function enter(i){ var cx=$('#hwCtx',wrap); if(cx&&pageOf(cx)===i) setTimeout(function(){ count(cx,LV?CTXP:0,1300,'%'); },350); }
})();
