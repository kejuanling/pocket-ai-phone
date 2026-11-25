/* [位置:phone-drawer.js·整个文件] [极简主题全局布局：聊天为根 + 左侧栏抽屉 + 极简设置页] [仅在非宽屏且 P.chatStyle==='min' 时激活；月夜玻璃与宽屏双栏完全不走这里] [注释时间 2026-11-19] */
(function(){
"use strict";
var P=window.PH; if(!P||!P.D) return;
var D=P.D, $=P.$, buzz=P.buzz||function(){}, toast=P.toast||function(){};
var root=document.documentElement;
if(root.classList.contains('wide')) return;

function isMin(){
  try{ return !!(P.appLayout?P.appLayout.get()==='min':(P.chatStyle&&P.chatStyle.get()==='min')); }catch(e){ return false; }
}
if(!isMin()) return;

root.classList.add('min-layout');
/* 极简主题除聊天页外统一加载思源宋体 */
(function(){
  if(!document.querySelector('link[href*="fonts/chat/noserif/f.css"]')){
    var l=document.createElement('link'); l.rel='stylesheet'; l.href='fonts/chat/noserif/f.css'; document.head.appendChild(l);
  }
})();

var LAST_SID_K='ph.min.last_sid';
function getLastSid(){ try{ return localStorage.getItem(LAST_SID_K)||''; }catch(e){ return ''; } }
function setLastSid(id){ try{ if(id) localStorage.setItem(LAST_SID_K,id); }catch(e){} }

var drawer=null, csWin=null, meHost=null, isOpen=false, metaFreshAt=0;

function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
var IC={
  chev:svg('<path d="m9 6 6 6-6 6"/>'),
  find:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  more:svg('<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>'),
  pen:svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  cam:svg('<path d="M4 8h3l2-2h6l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  grid:svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  world:svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  book:svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>'),
  ok:svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  diary:svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M12 14.5s-3.2-2-3.2-4.2a1.8 1.8 0 0 1 3.2-1.1 1.8 1.8 0 0 1 3.2 1.1c0 2.2-3.2 4.2-3.2 4.2z"/>'),
  set:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')
};

function getSign(){ try{ return localStorage.getItem('ph.me.sign')||'今天也在认真生活 ✦'; }catch(e){ return '今天也在认真生活 ✦'; } }

/* [位置:phone-drawer.js·抽屉菜单项持久化排序] [长按可排序] [2026-11-23：全部 15 个入口统一走持久化顺序 ph.min.drawer.order，前 3 项常显在顶部，其余收在「更多」里；长按 420ms 浮起可上下拖拽重排] */
var DR_ORD_K='ph.min.drawer.order';
function drawerCatalog(){
  var list=[
    {id:'perm',kind:'app',name:'永久上下文',ic:(P.ICON&&P.ICON.perm)||''},
    {id:'theme',kind:'app',name:'主题',ic:(P.ICON&&P.ICON.theme)||''},
    {id:'diary',kind:'me',name:'日记',svg:IC.diary},
    {id:'posts',kind:'me',name:'朋友圈',svg:IC.cam},
    {id:'album',kind:'me',name:'相册',svg:IC.grid},
    {id:'world',kind:'me',name:'小世界',svg:IC.world},
    {id:'wf',kind:'me',name:'工作流',svg:IC.book},
    {id:'jot',kind:'me',name:'随手记',svg:IC.ok}
  ];
  ['note','cal','trace','wake','mem','star','todo'].forEach(function(id){
    if(P.APPS&&P.APPS[id]){
      var a=P.APPS[id];
      list.push({id:id,kind:'app',name:a.n,ic:(P.ICON&&P.ICON[a.i])||''});
    }
  });
  return list;
}
function drawerOrdered(){
  var cat=drawerCatalog(), map={}, out=[], seen={};
  cat.forEach(function(x){ map[x.id]=x; });
  var saved=null;
  try{ saved=JSON.parse(localStorage.getItem(DR_ORD_K)||'null'); }catch(e){}
  if(Array.isArray(saved)){
    saved.forEach(function(id){ if(map[id]&&!seen[id]){ seen[id]=1; out.push(map[id]); } });
  }
  cat.forEach(function(x){ if(!seen[x.id]){ seen[x.id]=1; out.push(x); } });
  return out;
}
function drawerSaveOrder(ids){
  try{ localStorage.setItem(DR_ORD_K,JSON.stringify(ids)); }catch(e){}
}
function drawerRowHTML(item){
  var attr=item.kind==='app'?('data-minapp="'+item.id+'"'):('data-mego="'+item.id+'"');
  var icon=item.svg||('<svg viewBox="0 0 24 24">'+item.ic+'</svg>');
  return '<button class="mn-me-row tap" type="button" data-drid="'+item.id+'" '+attr+'>'+icon+'<span>'+item.name+'</span></button>';
}
function renderDrawerMenu(){
  if(!drawer) return;
  var box=drawer.querySelector('.mn-me-list'); if(!box) return;
  var items=drawerOrdered(), top=items.slice(0,3), rest=items.slice(3);
  var open=drawer.classList.contains('me-open');
  box.innerHTML=
    top.map(drawerRowHTML).join('')+
    '<button class="mn-me-row mn-me-more tap" type="button" id="mnMeMoreBtn" aria-expanded="'+(open?'true':'false')+'"'+(open?' hidden':'')+'>'+IC.more+'<span>更多</span></button>'+
    '<div class="mn-me-extra'+(open?' open':'')+'" id="mnMeExtra"><div class="mn-me-extra-in">'+
      rest.map(drawerRowHTML).join('')+
      '<button class="mn-me-row mn-me-fold tap" type="button" id="mnMeFoldBtn"><svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6"/></svg><span>收起</span></button>'+
    '</div></div>';
}

function buildDrawer(){
  if(drawer) return drawer;
  drawer=document.createElement('div');
  drawer.className='mn-drawer';

  drawer.innerHTML=
    '<aside class="mn-pane" aria-label="侧栏">'+
      '<div class="mn-top">'+
        '<span class="mn-brand">Love</span>'+
        '<button class="mn-ib tap" type="button" id="mnFindBtn" aria-label="搜索">'+IC.find+'</button>'+
        '<button class="mn-ib tap" type="button" id="mnMoreBtn" aria-label="更多">'+IC.more+'</button>'+
      '</div>'+
      '<div class="mn-scroll" id="mnScroll">'+
        '<div class="mn-me">'+
          '<div class="mn-me-list"></div>'+
        '</div>'+
        '<div class="mn-chats" id="mnChats"></div>'+
      '</div>'+
      '<div class="mn-foot">'+
        '<button class="mn-foot-av tap" type="button" id="mnSetBtn" aria-label="设置"><div class="av me" data-l="'+((P.names&&P.names.letter)?P.names.letter('me'):'用')+'"></div></button>'+
        '<button class="mn-new-pill tap" type="button" id="mnNewBtn">'+IC.pen+'<span>新聊天</span></button>'+
      '</div>'+
    '</aside>';
  D.appendChild(drawer);
  renderDrawerMenu();

  /* 挂载 chats 窗口到侧栏中间 */
  var app=P.app&&P.app('chats');
  if(app){
    csWin=document.createElement('div');
    csWin.className='win mn-cs-host';
    csWin.dataset.win='chats';
    csWin.innerHTML=app.html();
    drawer.querySelector('#mnChats').appendChild(csWin);
    try{ app.setup(csWin); }catch(err){ console.error(err); }
    /* [位置:phone-drawer.js·buildDrawer·csLs 重画回高亮] [11-20：开侧栏会静默刷新列表（见 openDrawer），render 整段重画会把 cs-sel 当前行高亮冲掉；盯着 #csLs 重画，侧栏开着就重新 syncSel] [注释时间 2026-11-20] */
    var lsEl=csWin.querySelector('#csLs');
    if(lsEl&&window.MutationObserver) new MutationObserver(function(){ if(isOpen) syncSel(); }).observe(lsEl,{childList:true});
  }

  /* 挂载隐藏的 me 容器，复用 meMount 的全部子页逻辑（朋友圈/相册/小世界/工作流/随手记/日记/名片） */
  if(P.pages&&P.pages.mountMe){
    meHost=document.createElement('div');
    meHost.className='win mn-me-host';
    meHost.style.cssText='position:absolute;inset:0;z-index:29;pointer-events:none;background:transparent';
    meHost.innerHTML='<div class="content" style="pointer-events:none"><div class="pg" style="display:none"></div></div>';
    D.appendChild(meHost);
    P.pages.mountMe(meHost,meHost.querySelector('.pg'),function(){});
    /* 监听 meHost 里子页/底板打开时放开点击，关掉时恢复穿透 */
    new MutationObserver(function(){
      var c=meHost.querySelector('.content');
      var has=!!(c&&c.querySelector('.pg-sub,.pg-sheet,.pg-cf,.dysub'));
      meHost.style.pointerEvents=has?'auto':'none';
      if(c) c.style.pointerEvents=has?'auto':'none';
    }).observe(meHost.querySelector('.content'),{childList:true});
  }

  drawer.querySelector('#mnFindBtn').addEventListener('click',function(){
    buzz(6);
    if(P.chats&&P.chats.find) P.chats.find();
  });
  drawer.querySelector('#mnMoreBtn').addEventListener('click',function(){
    buzz(6);
    if(P.chats&&P.chats.top) P.chats.top();
  });
  drawer.querySelector('#mnNewBtn').addEventListener('click',function(){
    buzz(6);
    if(P.chats&&P.chats.newSess) P.chats.newSess();
  });
  /* [位置:phone-drawer.js·buildDrawer·长按拖拽排序] [2026-11-23：长按抽屉应用行 420ms 浮起，上下拖放重排并持久化，前 3 项自动常显] */
  var drJust=0, drHint=0;
  (function(){
    var dg=null, overRow=null;
    var box=drawer.querySelector('.mn-me-list');
    function clearOver(){ if(overRow){ overRow.classList.remove('mn-dr-over'); overRow=null; } }
    function visibleRows(){
      return Array.prototype.slice.call(box.querySelectorAll('.mn-me-row[data-drid]')).filter(function(r){
        return r.offsetParent!==null&&r.getBoundingClientRect().height>4;
      });
    }
    function onTM(e){ if(dg&&dg.on&&e.cancelable) e.preventDefault(); }
    function off(){
      document.removeEventListener('pointermove',onMove);
      document.removeEventListener('pointerup',onUp);
      document.removeEventListener('pointercancel',onUp);
      document.removeEventListener('touchmove',onTM);
    }
    function onMove(e){
      if(!dg) return;
      if(!dg.on){
        if(Math.abs(e.clientY-dg.y0)>10||Math.abs(e.clientX-dg.x0)>10){ clearTimeout(dg.tm); dg=null; off(); }
        return;
      }
      var dy=e.clientY-dg.y0;
      dg.row.style.transform='translateY('+dy+'px) scale(1.03)';
      clearOver();
      var rows=visibleRows();
      for(var i=0;i<rows.length;i++){
        var r=rows[i]; if(r===dg.row) continue;
        var rc=r.getBoundingClientRect();
        if(e.clientY>=rc.top&&e.clientY<=rc.bottom){ overRow=r; r.classList.add('mn-dr-over'); break; }
      }
    }
    function onUp(e){
      var d=dg; if(!d) return;
      clearTimeout(d.tm); dg=null; off(); clearOver();
      if(!d.on||!d.row.isConnected) return;
      drJust=Date.now();
      d.row.classList.remove('mn-dr-lift');
      d.row.style.transform='';
      var rows=visibleRows();
      var ids=drawerOrdered().map(function(x){ return x.id; });
      var fromId=d.row.getAttribute('data-drid');
      var fromIdx=ids.indexOf(fromId);
      if(fromIdx<0||rows.length<2) return;
      var cy=e.clientY, targetId=null, afterLast=false;
      for(var i=0;i<rows.length;i++){
        var r=rows[i]; if(r===d.row) continue;
        var rc=r.getBoundingClientRect();
        if(cy<rc.top+rc.height/2){ targetId=r.getAttribute('data-drid'); break; }
      }
      if(!targetId) afterLast=true;
      ids.splice(fromIdx,1);
      if(afterLast){
        var lastVis=rows[rows.length-1];
        var lastId=lastVis===d.row?(rows[rows.length-2]&&rows[rows.length-2].getAttribute('data-drid')):lastVis.getAttribute('data-drid');
        var li=ids.indexOf(lastId);
        ids.splice(li>=0?li+1:ids.length,0,fromId);
      } else {
        var ti=ids.indexOf(targetId);
        ids.splice(ti>=0?ti:0,0,fromId);
      }
      drawerSaveOrder(ids);
      renderDrawerMenu();
      buzz([8,25,8]);
    }
    box.addEventListener('pointerdown',function(e){
      if(!drawer.classList.contains('me-open')) return;
      var row=e.target.closest('.mn-me-row[data-drid]'); if(!row) return;
      dg={row:row,x0:e.clientX,y0:e.clientY,on:false,tm:setTimeout(function(){
        if(!dg) return;
        dg.on=true; dg.row.classList.add('mn-dr-lift'); buzz([10,30,10]);
        if(!drHint){ drHint=1; toast('上下拖动排序，松手放好'); }
      },420)};
      document.addEventListener('pointermove',onMove);
      document.addEventListener('pointerup',onUp);
      document.addEventListener('pointercancel',onUp);
      document.addEventListener('touchmove',onTM,{passive:false});
    });
  })();
  /* [位置:phone-drawer.js·buildDrawer·更多区自动收起] [滑动会话列表/点列表空白自动收起] [11-20：更多展开时，在会话列表区上下滑动、或点到列表空白处（非会话行/按钮）就收起更多区，不用专门去够「收起」] [注释时间 2026-11-20] */
  (function(){
    var tsX=0, tsY=0, armed=false;
    drawer.addEventListener('touchstart',function(e){
      if(e.touches.length!==1){ armed=false; return; }
      var t=e.touches[0];
      tsX=t.clientX; tsY=t.clientY;
      armed=!!(e.target.closest&&e.target.closest('.mn-chats'))&&drawer.classList.contains('me-open');
    },{passive:true});
    drawer.addEventListener('touchmove',function(e){
      if(!armed||e.touches.length!==1) return;
      var t=e.touches[0], dx=t.clientX-tsX, dy=t.clientY-tsY;
      if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.2){
        armed=false; setMoreOpen(false); buzz(5);
      }
    },{passive:true});
    drawer.addEventListener('click',function(e){
      if(!drawer.classList.contains('me-open')) return;
      var t=e.target;
      if(!t.closest||!t.closest('.mn-chats')) return;
      if(t.closest('.cs-it,.cs-mbar,.cs-hint,button,input,a,[role="button"]')) return;
      setMoreOpen(false); buzz(5);
    });
  })();
  drawer.addEventListener('click',function(e){
    if(Date.now()-drJust<450) return;
    if(e.target.closest('#mnMeMoreBtn')){ setMoreOpen(true); buzz(5); return; }
    if(e.target.closest('#mnMeFoldBtn')){ setMoreOpen(false); buzz(5); return; }
    var ab=e.target.closest('[data-minapp]');
    if(ab){
      var aid=ab.getAttribute('data-minapp');
      buzz(6);
      closeDrawer();
      setTimeout(function(){ if(P.open) P.open(aid,ab); },340);
      return;
    }
    var b=e.target.closest('[data-mego]'); if(!b) return;
    var k=b.getAttribute('data-mego');
    buzz(6);
    closeDrawer();
    if(meHost){
      var t=meHost.querySelector('.pg [data-go="'+k+'"]');
      if(t) setTimeout(function(){ t.click(); },340);
    }
  });
  drawer.querySelector('#mnSetBtn').addEventListener('click',function(){
    var btn=this;
    buzz(6);
    if(P.open) P.open('set',btn);
  });

  bindClose();

  if(P.markAv) P.markAv();
  return drawer;
}

/* 推开式：聊天层在上、侧栏在下；聊天层整层右移 = 露出侧栏（和月夜玻璃「回会话列表」同手感）。
   p=0 关、p=1 全开；拖动中 p 由手指决定，松手后由 openDrawer/closeDrawer 带过渡落位 */
function chatEl(){ return D.querySelector('.win.tk-layer'); }
function paneEl(){ return drawer&&drawer.querySelector('.mn-pane'); }
function place(p){
  var c=chatEl(), pane=paneEl(), W=pane?pane.offsetWidth:0;
  if(c){ c.style.transform=p?'translateX('+(p*W)+'px)':''; c.classList.toggle('mn-pushed',p>0); }
  if(pane) pane.style.transform='translateX('+(-(1-p)*28)+'%)';
}
var moreFoldT=0;
function openDrawer(){
  clearTimeout(moreFoldT);
  buildDrawer();
  root.classList.remove('mn-dragging');
  drawer.classList.remove('dragging');
  isOpen=true;
  drawer.classList.add('open');
  place(1);
  syncSel();
  /* [位置:phone-drawer.js·openDrawer·列表静默刷新] [11-20：列表的名字/状态只在 load 时才拉，聊天页起完名、锁屏期间唤醒改的名，侧栏一直显示旧的（「新会话」）；每次拉开侧栏静默刷一次名单（15 秒节流，load 只在内容有变时重画、不闪），当前行高亮被重画冲掉由 csLs 的 observer 重新点亮] [注释时间 2026-11-20] */
  var now=Date.now();
  if(now-metaFreshAt>15000){ metaFreshAt=now; if(P.chats&&P.chats.refresh){ try{ P.chats.refresh(); }catch(e){} } }
  if(P.markAv) P.markAv();
}
function syncSel(){
  if(!csWin) return;
  var id=(P.talkCtx&&P.talkCtx.id)||'';
  Array.prototype.forEach.call(csWin.querySelectorAll('#csLs .cs-it'),function(r){
    r.classList.toggle('cs-sel',!!id&&r.getAttribute('data-id')===id);
  });
}
/* [位置:phone-drawer.js·closeDrawer] [抽屉收起时自动收起「更多」列表] [11-21：侧栏关闭动画结束后若「更多」仍展开，自动折叠并复位滚动条，避免关抽屉瞬间画面跳动] [注释时间 2026-11-21] */
function closeDrawer(){
  if(!drawer) return;
  root.classList.remove('mn-dragging');
  drawer.classList.remove('dragging');
  isOpen=false;
  drawer.classList.remove('open');
  place(0);
  clearTimeout(moreFoldT);
  if(drawer.classList.contains('me-open')){
    moreFoldT=setTimeout(function(){ if(!isOpen) setMoreOpen(false); },340);
  }
}
/* [位置:phone-drawer.js·setMoreOpen] [更多区展开/收起状态管理] [11-20：从 buildDrawer 内提为全局，进会话时也要能顺手收起；收起时整个抽屉回顶部，展开时会话列表回顶部] [注释时间 2026-11-20] */
function setMoreOpen(on){
  if(!drawer) return;
  var mb=drawer.querySelector('#mnMeMoreBtn'), eb=drawer.querySelector('#mnMeExtra'), ms=drawer.querySelector('#mnScroll');
  eb.classList.toggle('open',on);
  if(mb){ mb.hidden=on; mb.setAttribute('aria-expanded',on?'true':'false'); }
  drawer.classList.toggle('me-open',on);
  if(!on&&ms) ms.scrollTop=0;
  if(on){ var cs=drawer.querySelector('.mn-cs-host .cs-sc'); if(cs) cs.scrollTop=0; }
}
/* [位置:phone-drawer.js·setInGroup] [进会话组时收起顶部功能区] [11-21：进组后隐藏「永久上下文/主题/日记/更多」区，让组内会话列表直接顶到抽屉上方展开；若「更多」正展开一并收起] [注释时间 2026-11-21] */
function setInGroup(on){
  if(!drawer) return;
  if(on&&drawer.classList.contains('me-open')) setMoreOpen(false);
  drawer.classList.toggle('in-grp',!!on);
}
/* 跟手拖动（左缘右划由 phone-swipeback.js 统一判定后调这三个） */
function dragStart(){
  buildDrawer(); drawer.classList.add('dragging'); root.classList.add('mn-dragging'); syncSel();
}
function dragTo(dx){
  var W=paneEl().offsetWidth||1; place(Math.max(0,Math.min(1,dx/W)));
}
function dragEnd(dx,v){
  var W=paneEl().offsetWidth||1;
  if(dx/W>.3||(v>.5&&dx>40)) openDrawer(); else closeDrawer();
}
/* 侧栏打开后：往左划（侧栏里或露出的那条聊天页上）跟手收回；点露出的聊天页也收回。
   侧栏里会话行自带的「左滑露出详情」在这里不要——左滑只绑一件事 */
function bindClose(){
  var sx=0, sy=0, lx=0, lt=0, v=0, on=false, lock=false;
  function inScope(t){
    if(!t||!t.closest) return false;
    if(t.closest('.ses-pop,.cs-ov,.cs-dw,.pg-sheet,.pg-sub')) return false;
    return !!t.closest('.mn-pane,.win.tk-layer');
  }
  D.addEventListener('touchstart',function(e){
    if(!isOpen||e.touches.length!==1||!inScope(e.target)){ on=false; return; }
    var t=e.touches[0]; sx=lx=t.clientX; sy=t.clientY; lt=performance.now(); v=0; on=true; lock=false;
  },{passive:true,capture:true});
  D.addEventListener('touchmove',function(e){
    if(!on||!isOpen||e.touches.length!==1) return;
    var t=e.touches[0], dx=t.clientX-sx, dy=t.clientY-sy;
    if(!lock){
      if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)){ on=false; return; }
      if(dx>-10) return;
      lock=true; drawer.classList.add('dragging'); root.classList.add('mn-dragging');
    }
    if(e.cancelable) e.preventDefault();
    var now=performance.now(); v=(t.clientX-lx)/Math.max(1,now-lt); lx=t.clientX; lt=now;
    var W=paneEl().offsetWidth||1; place(Math.max(0,Math.min(1,1+dx/W)));
  },{passive:false,capture:true});
  function end(e){
    if(!on) return; on=false;
    if(!lock) return; lock=false;
    var x=(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientX:lx;
    var dx=x-sx, W=paneEl().offsetWidth||1;
    if(-dx/W>.25||(v<-.5&&dx<-40)){ buzz(8); closeDrawer(); } else openDrawer();
  }
  D.addEventListener('touchend',end,{passive:true,capture:true});
  D.addEventListener('touchcancel',function(){ if(lock){ lock=false; on=false; openDrawer(); } on=false; },{passive:true,capture:true});

  /* 会话行的横向拖动不给它：它收不到向左的 pointermove，行就不会被拽出来 */
  var px=0, py=0;
  drawer.addEventListener('pointerdown',function(e){ px=e.clientX; py=e.clientY; },true);
  drawer.addEventListener('pointermove',function(e){
    var dx=e.clientX-px, dy=e.clientY-py;
    if(dx<-6&&Math.abs(dx)>Math.abs(dy)*1.2&&e.target.closest&&e.target.closest('.mn-chats')) e.stopPropagation();
  },true);

  /* 点露出的那条聊天页 = 收回侧栏，这一下不穿透到聊天页 */
  D.addEventListener('click',function(e){
    if(!isOpen||!e.target.closest||e.target.closest('.mn-drawer')||!e.target.closest('.win.tk-layer')) return;
    e.preventDefault(); e.stopPropagation(); closeDrawer();
  },true);
}

/* 根聊天页启动：打开最近会话（或默认会话） */
function openRootChat(sid){
  buildDrawer();
  var hotSid=window.__phHotRestore&&window.__phHotRestore.sid;
  var target=sid||hotSid||getLastSid();
  if(!target){
    try{
      var c0=P.net&&P.net.peek&&P.net.peek('chats');
      if(c0&&c0.sessions&&c0.sessions.length) target=c0.sessions[0].id;
    }catch(e){}
  }
  if(!target) target='default';
  setLastSid(target);
  if(P.chats&&P.chats.switchTo){
    P.chats.switchTo(target);
  }else{
    var app=P.app&&P.app('talk');
    if(app){
      P.talkCtx={id:target,name:(P.names&&P.names.ai)?P.names.ai():'助手'};
      var t=document.createElement('div'); t.className='win tk-layer'; t.dataset.win='talk'; t.style.zIndex='20'; t.style.background='var(--tkbg,#eef4fb)'; t.innerHTML=app.html();
      D.appendChild(t); try{ app.setup(t); }catch(err){ console.error(err); }
    }
  }
}

/* 监听聊天层打开，记录最近会话 id，并把聊天顶栏返回键改成打开侧栏 */
new MutationObserver(function(muts){
  muts.forEach(function(m){
    Array.prototype.forEach.call(m.addedNodes,function(n){
      if(n.nodeType===1&&n.classList&&n.classList.contains('tk-layer')){
        if(P.talkCtx&&P.talkCtx.id) setLastSid(P.talkCtx.id);
        setMoreOpen(false);
        closeDrawer();
        var bk=n.querySelector('.tk-top .back');
        if(bk){
          bk.setAttribute('aria-label','打开侧栏');
          bk.addEventListener('click',function(e){
            e.stopImmediatePropagation();
            e.preventDefault();
            buzz(6);
            openDrawer();
          },true);
        }
      }
    });
  });
}).observe(D,{childList:true});

/* 极简设置页：直接复用配置页（AI / 模型 / 账号与数据，其中「其他」作为账号与数据里的跳转子页），顶部加个人名片卡 */
function minSetHTML(){
  var cfgHtml=(P.pages&&P.pages.cfgBodyHTML)?P.pages.cfgBodyHTML():'';
  var esc=P.esc||function(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
  var nm=(P.names&&P.names.me)?P.names.me():'用户';
  var card='<button class="me-card mn-set-card tap" type="button" id="mnSetProf"><div class="av me" data-l="'+esc(Array.from(nm)[0]||'用')+'"></div><div class="tx"><b>'+esc(nm)+'</b><small class="me-sg">'+esc(getSign())+'</small></div><svg class="ch" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>';
  return P.pages.shell('设置','',card+cfgHtml);
}

function minSetSetup(win){
  var sc=win.querySelector('.pg-sc');
  if(P.pages&&P.pages.mountCfg) P.pages.mountCfg(win,sc,function(){});
  var card=win.querySelector('#mnSetProf');
  if(card){
    card.addEventListener('click',function(){
      buzz(6);
      var esc=P.esc||function(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
      var nm=(P.names&&P.names.me)?P.names.me():'用户';
      P.pages.sheet(win,'我的名片',
        '<div class="me-pf"><div class="av me" data-l="'+esc(Array.from(nm)[0]||'用')+'"></div></div>'+
        '<div class="pg-g"><div class="pg-r col"><span class="rt"><b>名字</b></span><input class="pg-in" style="margin-top:8px" value="'+esc(nm)+'"></div>'+
        '<div class="pg-r col"><span class="rt"><b>签名</b></span><input class="pg-in" style="margin-top:8px" value="'+esc(getSign())+'"></div></div>'+
        '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>好</button></div>',
        function(sh,close){
          if(P.markAv) P.markAv();
          sh.querySelector('[data-ok]').addEventListener('click',function(){
            var ins=sh.querySelectorAll('input');
            var nn=(ins[0].value||'').trim()||'用户', ns=ins[1].value||'';
            try{ localStorage.setItem('ph.me.sign',ns); }catch(e){}
            if(P.names) P.names.set({me:nn});
            if(P.net&&P.net.req) P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:{user_name:nn}}}).catch(function(){});
            card.querySelector('b').textContent=nn;
            card.querySelector('.me-sg').textContent=ns;
            var av=card.querySelector('.av'); if(av) av.setAttribute('data-l',Array.from(nn)[0]||'用');
            if(P.markAv) P.markAv();
            close(); toast('改好了'); buzz(8);
          });
        }
      );
    });
  }
  if(P.markAv) P.markAv();
}

/* 极简布局下：先挂载 P.minLayout，再触发 openRootChat（确保 buildDrawer -> chats.setup 时 P.minLayout.on 已就绪）[注释时间 2026-11-24] */
P.minLayout={
  on:true,
  openDrawer:openDrawer,
  closeDrawer:closeDrawer,
  isDrawerOpen:function(){ return isOpen; },
  dragStart:dragStart,
  dragTo:dragTo,
  dragEnd:dragEnd,
  openRootChat:openRootChat,
  setInGroup:setInGroup,
  minSetHTML:minSetHTML,
  minSetSetup:minSetSetup
};

/* 极简布局下：如果页面已经解锁（例如截图工具直接隐藏了锁屏），立即打开根聊天页；
   若锁屏还在，等它被隐藏/解锁时也自动补开（兼容外部直接改 lock.style.visibility/display 的解锁方式） */
(function(){
  function checkUnlocked(){
    if(D.querySelector('.win.tk-layer')) return true;
    var lk=document.getElementById('lock');
    if(!lk||lk.style.visibility==='hidden'||lk.style.display==='none'||getComputedStyle(lk).visibility==='hidden'||getComputedStyle(lk).display==='none'){
      openRootChat();
      return true;
    }
    return false;
  }
  if(!checkUnlocked()){
    var lk=document.getElementById('lock');
    if(lk){
      var mo=new MutationObserver(function(){ if(checkUnlocked()) mo.disconnect(); });
      mo.observe(lk,{attributes:true,attributeFilter:['style','class']});
    }
  }
})();
})();
