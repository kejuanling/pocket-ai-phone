/* 小手机 · 待办：勾一下，划线、进度环转动，划掉就消失 */
(function(){
"use strict";
var P=window.PH, $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast, anim=P.anim;
var CHK='<svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.8 3.8L17.5 8.5"/></svg>';
var PLUS='<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
var CHEV='<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

/* 后端 todo：text 末尾带「 YYYY-MM-DD HH:mm」创建时间，他写的前面有「📌 」；划掉＝删除 */
function mapTodo(t){
  var raw=String(t.text||''), created='', m=raw.match(/\s(\d{4}-\d{2}-\d{2})(?:\s(\d{2}:\d{2}))?\s*$/);
  if(m){ created=m[1]+(m[2]?' '+m[2]:''); raw=raw.slice(0,m.index); }
  raw=raw.replace(/^\s*\u{1F4CC}\s*/u,'').trim();
  var uPrefix=(P.names&&P.names.me)?P.names.me()+'：':'';
  if(uPrefix&&raw.indexOf(uPrefix)===0) raw=raw.slice(uPrefix.length).trim();
  var today=P.net.ymd(), when='today', tag='';
  /* [位置:phone-todo.js·mapTodo 分组] [过期待办归「之前」] [11-16 批3 J1/J2：以前只有 今天/之后 两档，定时日在昨天及以前的、以及很久前建的没定时的全挤在「今天」；现在：定时日>今天=之后，<今天=之前，=今天=今天；没定时的按创建日，创建日不是今天就归「之前」] [注释时间 2026-11-16] */
  if(t.remind_at){ var d=t.remind_at.slice(0,10), hm=t.remind_at.slice(11,16); when=d>today?'later':(d<today?'before':'today'); tag=d===today?hm:(d.slice(5)+' '+hm); }
  else if(created){ var cd=created.slice(0,10); if(cd<today) when='before'; if(cd!==today) tag=cd.slice(5); }
  return {id:t.id,t:raw||'（空）',by:t.by==='xie'?'ai':'me',tag:tag,when:when,pos:(t.pos==null?null:t.pos)};
}

function html(){
  var n=new Date(), sub='今天 · '+(n.getMonth()+1)+'月'+n.getDate()+'日';
  return '<div class="content td">'+P.head('','<span class="sp"></span><button class="ibtn tap" id="tdAdd" aria-label="新待办">'+PLUS+'</button>')+
    '<div class="ltitle"><div><h1>待办</h1><div class="sub">'+sub+'</div></div>'+
    '<div class="td-ring"><svg viewBox="0 0 58 58"><circle class="bg" cx="29" cy="29" r="22"/><circle class="fg" id="tdFg" cx="29" cy="29" r="22"/></svg><b id="tdNum">0/0</b></div></div>'+
    '<div class="sc" id="tdSc"><div class="td-sec"><h4>今天</h4><div id="tdToday"></div></div><div class="td-sec"><h4>之后</h4><div id="tdLater"></div></div><div class="td-sec"><h4>之前</h4><div id="tdBefore"></div></div>'+
    '<div class="td-done" id="tdDoneW"><button id="tdDoneBtn">已完成 <b id="tdDoneN">0</b>'+CHEV+'</button><div class="list" id="tdDone"></div></div></div></div>';
}
function setup(win){
  var items=[], doneBin=[], first=true, live=false, st='load';   /* st：load 读取中 / ok / fail 没连上（演示数据已删，2026-10-22） */
  var elT=$('#tdToday',win), elL=$('#tdLater',win), elB=$('#tdBefore',win), elD=$('#tdDone',win), fg=$('#tdFg',win), num=$('#tdNum',win);
  function meName(){ return (P.names&&P.names.me)?P.names.me():'用户'; }
  function aiName(){ return (P.names&&P.names.ai)?P.names.ai():'助手'; }
  function avLet(side){ return (P.names&&P.names.letter)?P.names.letter(side):(side==='me'?'用':'助'); }
  function itemHTML(x,i){
    return '<div class="td-item'+(x.done?' done':'')+'" data-id="'+x.id+'"'+(first?' style="--i:'+i+'"':'')+'><button class="td-chk" aria-label="完成">'+CHK+'</button>'+
      '<div class="td-body"><div class="td-tx"><span>'+esc(x.t)+'</span></div><div class="td-meta"><div class="av '+x.by+'" data-l="'+esc(avLet(x.by))+'"></div>'+esc(x.by==='me'?meName():aiName())+(x.tag?'<span class="td-tag">'+esc(x.tag)+'</span>':'')+'</div></div></div>';
  }
  function ring(){
    var d=doneBin.length+items.filter(function(x){ return x.done; }).length, t=items.length+doneBin.length;
    fg.style.strokeDashoffset=String(138.2*(1-(t?d/t:0))); num.textContent=d+'/'+t; $('#tdDoneN',win).textContent=d;
  }
  /* [位置:phone-todo.js·render] [手势中推迟重画] [缓存先画一次、请求回来再整段重画，落在按下与抬起之间就把按下那行摘掉了] [注释时间 2026-10-27] */
  function render(){
    if(P.afterGesture&&!P.afterGesture('todos',render)) return;
    var act=items;
    var td=act.filter(function(x){ return x.when==='today'; }), lt=act.filter(function(x){ return x.when==='later'; }), bf=act.filter(function(x){ return x.when==='before'; });
    if(st!=='ok'){ elT.innerHTML=st==='load'?P.net.loadBox():P.net.failBox(); elL.innerHTML=''; elB.innerHTML=''; elD.innerHTML=''; return; }
    elT.innerHTML=td.length?td.map(itemHTML).join(''):'<div class="td-empty">今天的都划掉啦 ✦</div>';
    elL.innerHTML=lt.length?lt.map(itemHTML).join(''):'<div class="td-empty">之后暂时没有</div>';
    elB.innerHTML=bf.length?bf.map(itemHTML).join(''):'<div class="td-empty">之前没有落下的</div>';
    elD.innerHTML=doneBin.map(itemHTML).join('');
    P.markAv(); ring(); first=false;
    Array.prototype.forEach.call(win.querySelectorAll('.td-item'),function(el){ if(first===false&&el.style.getPropertyValue('--i')) el.classList.add('rise'); });
  }
  function sortItems(){ items.sort(function(a,b){ var na=a.pos==null, nb=b.pos==null; if(na&&nb) return b.id-a.id; if(na) return -1; if(nb) return 1; return a.pos-b.pos; }); }
  /* [位置:phone-todo.js·sync] [静默刷新待办缓存] [划掉/排序这类不重拉列表的写操作成功后，后台拉一份新的只更新本机缓存（不动界面），下次打开秒出的就是新数据] [注释时间 2026-10-26] */
  function sync(){ P.net.get('/todo/api/todos').then(function(l){ P.net.keep('todos',l); }).catch(function(){}); }
  /* [位置:phone-todo.js·staleOnce] [缓存降级一次性提示] [批5：拉失败又拿着旧缓存显示时 toast 一次（「没连上，先显示上次的内容」），成功后复位——反复重试不反复弹] [注释时间 2026-11-17] */
  var staleOnce=false;
  function load(){
    st=items.length?st:'load'; if(!items.length) render();
    return P.net.get('/todo/api/todos').then(function(list){ live=true; st='ok'; staleOnce=false; P.net.keep('todos',list); items=(list||[]).map(mapTodo); sortItems(); render(); setTimeout(ring,60); })
      .catch(function(){ P.net.offline(); live=false; if(items.length){ if(!staleOnce){ staleOnce=true; toast('没连上，先显示上次的内容'); } return; } st='fail'; doneBin=[]; render(); setTimeout(ring,60); });
  }
  win.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')) load(); });
  /* [位置:phone-todo.js·setup 缓存秒显] [打开先画本机缓存再校正] [有缓存（ph_c_todos）就秒出上次的列表，后台照常拉新的覆盖；没缓存照旧转圈；排序比较器和 load 共用 sortItems] [注释时间 2026-10-26] */
  (function(){ var c=P.net.peek('todos'); if(c&&c.length){ items=c.map(mapTodo); sortItems(); st='ok'; } })();
  render(); load();
  function spark(el){
    var cols=['#a9bfe6','#7d9ccf','#e58fa4','#d9d3f3'];
    for(var i=0;i<8;i++){
      var s=document.createElement('i'); s.className='td-spark'; s.style.background=cols[i%4]; el.appendChild(s);
      var a=Math.PI*2*i/8+Math.random()*.4, r=22+Math.random()*14;
      anim(s,[{transform:'translate(0,0) scale(1)',opacity:1},{transform:'translate('+Math.cos(a)*r+'px,'+Math.sin(a)*r+'px) scale(.2)',opacity:0}],{duration:620+Math.random()*200,easing:'cubic-bezier(.2,.9,.25,1)'}).finished.then((function(n){ return function(){ n.remove(); }; })(s));
    }
  }
  function find(id){ for(var i=0;i<items.length;i++) if(items[i].id===id) return items[i]; }
  function findDone(id){ for(var i=0;i<doneBin.length;i++) if(doneBin[i].id===id) return doneBin[i]; }
  win.addEventListener('click',function(e){
    var db=e.target.closest('#tdDoneBtn'); if(db){ $('#tdDoneW',win).classList.toggle('open'); buzz(5); return; }
    var chk=e.target.closest('.td-chk'); if(!chk) return;
    var el=chk.closest('.td-item'), id=+el.getAttribute('data-id'); if(el.dataset.busy) return; el.dataset.busy='1';
    var x=find(id);
    if(x){
      x.done=true; el.classList.add('done'); spark(el); buzz(12); ring();
      var req=live?P.net.post('/todo/api/todos/delete',{id:x.id}):Promise.resolve();
      req.catch(function(){ x.done=false; el.classList.remove('done'); delete el.dataset.busy; ring(); toast('没划掉，稍后再试'); throw 0; }).then(function(){
        sync();
        setTimeout(function(){
          var h=el.offsetHeight;
          anim(el,[{height:h+'px',opacity:1,marginBottom:'8px',paddingTop:'13px',paddingBottom:'13px'},{height:'0px',opacity:0,marginBottom:'0px',paddingTop:'0px',paddingBottom:'0px'}],{duration:380,easing:'cubic-bezier(.4,0,.2,1)'}).finished.then(function(){
            items=items.filter(function(y){ return y!==x; }); doneBin.unshift(x); render();
          });
        },700);
      }).catch(function(){});
      return;
    }
    var dx=findDone(id); if(!dx){ delete el.dataset.busy; return; }
    /* 从已完成里放回去：后端已经删掉了，重新写一条（他的用「📌」那条通道） */
    var txt=dx.t, back=live?P.net.post(dx.by==='ai'?'/todo/api/todos/xie':'/todo/api/todos/add',{text:txt}):Promise.resolve();
    back.then(function(){ doneBin=doneBin.filter(function(y){ return y!==dx; }); buzz(8); return live?load():render(); })
      .catch(function(){ delete el.dataset.busy; toast('没放回去，稍后再试'); });
  });
  /* [位置:phone-todo.js·长按排序] [待办长按拖动排序] [10-23 需求 53：长按一条约 0.4 秒它浮起来（轻震一下），手指拖动，其它条让位，松手落位；只能在同一组里拖（「今天」「之后」各排各的，已完成的不参与）；边缘附近自动滚动；落位后把当前全部未完成待办按显示顺序的 id 交给 POST /todo/api/todos/reorder，GET /todo/api/todos 之后会带 pos，没排过的新待办仍排在最前；没动就不发请求；存不上弹回去并提示。手指先动超过 8px 就当是滚动，不触发] [注释时间 2026-10-23] */
  (function(){
    var sc=$('#tdSc',win), drag=null, lpT=0, sx=0, sy=0, raf=0;
    function idOf(el){ return +el.getAttribute('data-id'); }
    win.addEventListener('pointerdown',function(e){
      if(drag) return; var el=e.target.closest('.td-item'); if(!el||el.classList.contains('done')||e.target.closest('.td-chk')) return;
      var pid=el.parentNode&&el.parentNode.id; if(pid!=='tdToday'&&pid!=='tdLater'&&pid!=='tdBefore') return;   /* 只能在同一组里拖（今天/之后/之前各排各的） */
      sx=e.clientX; sy=e.clientY; clearTimeout(lpT); lpT=setTimeout(function(){ lpT=0; start(el,e.pointerId,e.clientY); },400);
    });
    win.addEventListener('pointermove',function(e){
      if(lpT&&(Math.abs(e.clientX-sx)>8||Math.abs(e.clientY-sy)>8)){ clearTimeout(lpT); lpT=0; }
      if(drag){ drag.cy=e.clientY; place(); }
    },{passive:true});
    function stop(){ clearTimeout(lpT); lpT=0; if(drag) finish(); }
    win.addEventListener('pointerup',stop); win.addEventListener('pointercancel',stop);
    win.addEventListener('touchmove',function(e){ if(drag&&e.cancelable) e.preventDefault(); },{passive:false});
    win.addEventListener('contextmenu',function(e){ if(lpT||drag) e.preventDefault(); });
    function start(el,pid,y0){
      var sec=el.parentNode, els=[].filter.call(sec.children,function(c){ return c.classList.contains('td-item')&&!c.classList.contains('done'); });
      if(els.length<2) return;
      var rects=els.map(function(c){ var r=c.getBoundingClientRect(); return {top:r.top,h:r.height}; }), from=els.indexOf(el);
      drag={el:el,els:els,rects:rects,from:from,to:from,y0:y0,cy:y0,s0:sc.scrollTop};
      el.classList.add('td-lift'); els.forEach(function(c){ if(c!==el) c.classList.add('td-shift'); }); win.classList.add('td-dragging');
      buzz(14); try{ el.setPointerCapture(pid); }catch(x){} tick();
    }
    function tick(){ if(!drag) return; var r=sc.getBoundingClientRect();
      if(drag.cy<r.top+70) sc.scrollTop-=10; else if(drag.cy>r.bottom-70) sc.scrollTop+=10;
      place(); raf=requestAnimationFrame(tick); }
    function target(dy){
      var c=drag.rects[drag.from].top+drag.rects[drag.from].h/2+dy, n=0;
      drag.rects.forEach(function(r,j){ if(j!==drag.from&&r.top+r.h/2<c) n++; });
      return n;
    }
    function place(){
      var dy=drag.cy-drag.y0+(sc.scrollTop-drag.s0), to=target(dy), h=drag.rects[drag.from].h+8;
      drag.el.style.transform='translateY('+dy+'px) scale(1.02)';
      if(to!==drag.to){ drag.to=to; buzz(5); }
      drag.els.forEach(function(c,j){ if(c===drag.el) return; var sh=0;
        if(to>drag.from&&j>drag.from&&j<=to) sh=-h; else if(to<drag.from&&j>=to&&j<drag.from) sh=h;
        c.style.transform=sh?'translateY('+sh+'px)':''; });
    }
    function finish(){
      cancelAnimationFrame(raf); var d=drag; drag=null; win.classList.remove('td-dragging');
      var to=d.to, from=d.from, slot=0, i;
      if(to>from) for(i=from+1;i<=to;i++) slot+=d.rects[i].h+8; else if(to<from) for(i=to;i<from;i++) slot-=d.rects[i].h+8;
      d.el.classList.add('td-drop'); d.el.classList.remove('td-lift'); d.el.style.transform='translateY('+slot+'px)';
      setTimeout(function(){
        d.els.forEach(function(c){ c.classList.remove('td-shift','td-drop'); c.style.transform=''; });
        if(to===from) return;
        var ids=d.els.map(idOf), moved=ids.splice(from,1)[0]; ids.splice(to,0,moved);
        var pos=[]; items.forEach(function(x,k){ if(ids.indexOf(x.id)>=0) pos.push(k); });
        var byId={}; items.forEach(function(x){ byId[x.id]=x; });
        ids.forEach(function(id,k){ items[pos[k]]=byId[id]; });
        render(); ring(); buzz(10);
        if(!live) return;
        P.net.post('/todo/api/todos/reorder',{ids:items.map(function(x){ return x.id; })}).then(function(){ sync(); }).catch(function(){ toast('没存上顺序，稍后再试'); load(); });
      },210);
    }
  })();
  $('#tdAdd',win).addEventListener('click',function(){
    P.sheet(win,{title:'新待办',ph:'要做什么…',hint:aiName()+'可以看到',btn:'添加',onSubmit:function(v){
      if(!live){ toast('没连上后台，没添加成功'); return false; }
      return P.net.post('/todo/api/todos/add',{text:v}).then(function(){ return load(); }).then(function(){
        var ne=elT.querySelector('.td-item'); if(ne) ne.classList.add('popin'); $('#tdSc',win).scrollTo({top:0,behavior:'smooth'}); buzz(10);
      }).catch(function(e){ toast('没添加成功，内容还在，再点一次'); throw e; });
    }});
  });
}
P.register('todo',{html:html,setup:setup});
})();
