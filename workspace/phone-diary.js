/* 小手机 · 日记（朋友圈版式）：用户发动态，助手点赞、评论 */
(function(){
"use strict";
var P=window.PH, D=P.D, $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast;
function meName(){ return (P.names&&P.names.me)?P.names.me():'用户'; }
function aiName(){ return (P.names&&P.names.ai)?P.names.ai():'助手'; }
function meLet(){ return (P.names&&P.names.letter)?P.names.letter('me'):'用'; }
var SVG={
  back:'<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  pen:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  heart:'<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>',
  chat:'<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'
};
var TILES=['linear-gradient(135deg,#dfeaf8,#c4d6ee)','linear-gradient(135deg,#e6e1f6,#cfd5f0)','linear-gradient(135deg,#eef4fb,#d3e0f1)'];


function pics(p){
  var urls=p.imgs||[], n=urls.length||p.pics||0;
  if(!n) return '';
  var cols=n===1?1:3;
  var h='<div class="pics" style="grid-template-columns:repeat('+cols+',1fr);max-width:'+(n===1?'190px':'236px')+'">';
  for(var i=0;i<n;i++) h+=urls[i]?'<i class="ph" data-s="'+esc(urls[i])+'" style="background:url('+esc(urls[i])+') center/cover"></i>':'<i style="background:'+TILES[i%3]+'"></i>';
  return h+'</div>';
}
function cmtHTML(p){
  if(!p.likes.length&&!p.cm.length) return '';
  var h='';
  if(p.likes.length) h+='<div class="likes">'+SVG.heart+p.likes.map(function(k){ return esc(k==='me'?meName():aiName()); }).join('，')+'</div>';
  p.cm.forEach(function(c){ h+='<div class="c"><b>'+esc(c.n)+'</b>：<span>'+esc(c.t)+'</span></div>'; });
  return h;
}
function postHTML(p,i){
  return '<article class="post stag" style="--i:'+(i+1)+'"><div class="av me" data-l="'+esc(meLet())+'"></div><div class="bd">'+
    '<div class="nm">'+esc(meName())+'</div>'+(p.x?'<div class="tx">'+esc(p.x)+'</div>':'')+pics(p)+
    (p.mood?'<div class="moodrow">'+esc(p.mood)+'</div>':'')+
    '<div class="meta"><span class="time">'+esc(p.t)+'</span><button class="dots tap" aria-label="更多"><svg width="16" height="16" viewBox="0 0 24 24" fill="#5a78b0"><circle cx="6" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18" cy="12" r="1.9"/></svg></button>'+
    '<div class="popm"><button data-a="like">'+SVG.heart+'<span>赞</span></button><button data-a="cmt">'+SVG.chat+'<span>评论</span></button>'+(p.id?'<button data-a="del"><span>删除</span></button>':'')+'</div></div>'+
    '<div class="cmt">'+cmtHTML(p)+'</div></div></article>';
}

function html(){
  return '<div class="content dy"><div class="topbar"><button class="back tap" aria-label="返回">'+SVG.back+'</button><div class="ttl">日记</div><button class="ibtn tap" id="dyNew" aria-label="写日记">'+SVG.pen+'</button></div>'+
    '<div class="scroll" id="dyScroll"><div class="cover"><div class="wm">Diary</div>'+
    '<div class="who"><span class="nm">'+esc(meName())+'</span><div class="av me" data-l="'+esc(meLet())+'"></div></div></div>'+
    '<div class="feed" id="dyFeed"></div></div>'+
    '<div class="cbar" id="cbar"><div class="cfield"><input id="cin" placeholder="评论" enterkeyhint="send"></div><button class="csend tap" id="csend">发送</button></div></div>';
}

function setup(win){
  var sc=$('#dyScroll',win), feed=$('#dyFeed',win), top=$('.topbar',win), cover=$('.cover',win), cbar=$('#cbar',win), cin=$('#cin',win);
  var data=[], LK='ph.diary.likes', likedMap={};
  try{ likedMap=JSON.parse(localStorage.getItem(LK)||'{}')||{}; }catch(e){ likedMap={}; }
  function saveLikes(){ try{ localStorage.setItem(LK,JSON.stringify(likedMap)); }catch(e){} }
  function mapEntry(e){
    return {id:e.id,x:e.text||'',mood:'',t:P.net.fmtTime(e.ts),pics:0,imgs:e.images||[],likes:likedMap[e.id]?['me']:[],
      cm:(e.comments||[]).map(function(c){ return {n:c.author==='xie'?aiName():meName(),t:c.text}; })};
  }
  /* [位置:phone-diary.js·paint] [手势中推迟重画] [缓存先画一次、请求回来再整段重画，落在按下与抬起之间就把按下那条摘掉了] [注释时间 2026-10-27] */
  function paint(list){
    if(P.afterGesture&&!P.afterGesture('diary',function(){ paint(list); })) return;
    data=list; feed.innerHTML=data.length?data.map(postHTML).join(''):'<div class="dy-empty">还没有日记，点右上角写第一篇吧</div>';
    /* [位置:phone-diary.js·paint 入场守卫] [动画期间先别点] [10-28：帖子带位移动画+逐条 70ms 延迟，没走完时点到的不是看到的行；feed 挂 entering 禁命中，最后一条动画完解除（上限 1.2s，长列表不等全部）] [注释时间 2026-10-28] */
    feed.classList.add('entering'); clearTimeout(paint._et);
    paint._et=setTimeout(function(){ feed.classList.remove('entering'); },Math.min(1200,300+data.length*70));
    Array.prototype.forEach.call(feed.querySelectorAll('.post'),function(el,i){ el._p=data[i]; renderCmt(el); });
    P.markAv();
  }
  /* [位置:phone-diary.js·sync] [静默刷新日记缓存] [删日记/发评论这类不重拉列表的写操作成功后，后台拉一份新的只更新本机缓存（不动界面），下次打开秒出的就是新数据] [注释时间 2026-10-26] */
  function sync(){ P.net.get('/diary/api/entries').then(function(l){ P.net.keep('diary',l); }).catch(function(){}); }
  /* [位置:phone-diary.js·staleOnce] [缓存降级一次性提示] [批5：拉失败又拿着旧缓存显示时 toast 一次，成功后复位] [注释时间 2026-11-17] */
  var staleOnce=false;
  function load(){
    return P.net.get('/diary/api/entries').then(function(list){ staleOnce=false; P.net.keep('diary',list); paint((list||[]).map(mapEntry)); })
      .catch(function(){ P.net.offline(); if(data.length){ if(!staleOnce){ staleOnce=true; toast('没连上，先显示上次的内容'); } return; } feed.innerHTML=P.net.failBox(); });
  }
  /* [位置:phone-diary.js·setup 缓存秒显] [打开先画本机缓存再校正] [有缓存（ph_c_diary）先秒出上次的日记流，后台照常拉新的覆盖；没缓存照旧显示「翻日记中…」] [注释时间 2026-10-26] */
  (function(){ var c=P.net.peek('diary'); if(c&&c.length) paint(c.map(mapEntry)); })();
  if(!data.length) feed.innerHTML=P.net.loadBox('翻日记中…'); load();
  feed.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ feed.innerHTML=P.net.loadBox('翻日记中…'); load(); } });

  sc.addEventListener('scroll',function(){ top.classList.toggle('solid',sc.scrollTop>cover.offsetHeight-84); },{passive:true});

  function renderCmt(el){ var p=el._p, box=el.querySelector('.cmt'); box.innerHTML=cmtHTML(p); box.classList.toggle('on',!!(p.likes.length||p.cm.length)); }
  function closePops(except){ Array.prototype.forEach.call(feed.querySelectorAll('.popm.open'),function(x){ if(x!==except) x.classList.remove('open'); }); }
  function burst(fromEl){
    var r=P.rectIn(fromEl), h=document.createElement('div'); h.className='hburst'; h.innerHTML=SVG.heart; h.style.left=(r.x+r.w/2-11)+'px'; h.style.top=(r.y-4)+'px'; D.appendChild(h); setTimeout(function(){ h.remove(); },900);
  }
  var cmtTarget=null;
  function openCbar(el){ cmtTarget=el; cbar.classList.add('show'); cin.value=''; cin.placeholder='评论'; setTimeout(function(){ cin.focus(); },60); }
  function closeCbar(){ cbar.classList.remove('show'); cin.blur(); cmtTarget=null; }
  function sendCmt(){
    var v=cin.value.trim(); if(!v||!cmtTarget) { if(!v) P.shake(cbar); return; }
    var el=cmtTarget, p=el._p; closeCbar();
    P.net.post('/diary/api/entries/comment',{id:p.id,text:v,author:'user'}).then(function(){
      sync(); p.cm.push({n:meName(),t:v}); renderCmt(el); buzz(8);
      var last=el.querySelector('.cmt .c:last-child'); if(last) last.classList.add('fresh');
    }).catch(function(){ toast('评论没发出去，稍后再试'); });
  }
  $('#csend',win).addEventListener('click',sendCmt);
  cin.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); sendCmt(); } });
  var unkb=P.kb(function(kb){ cbar.style.transform=kb&&cbar.classList.contains('show')?'translateY(-'+kb+'px)':''; });
  /* [位置:phone-diary.js·setup 键盘监听注销] [修复内存泄漏] [P.kb 返回的注销函数在页面被移除时调用，避免监听堆积] [注释时间 2026-10-28] */
  if(unkb){ var kbmo=new MutationObserver(function(){ if(!win.isConnected){ unkb(); kbmo.disconnect(); } }); if(win.parentNode) kbmo.observe(win.parentNode,{childList:true}); }

  win.addEventListener('click',function(e){
    var dots=e.target.closest('.dots');
    if(dots){ var pop=dots.parentNode.querySelector('.popm'); closePops(pop); pop.classList.toggle('open'); buzz(5); return; }
    var act=e.target.closest('.popm button');
    if(act){
      var el=act.closest('.post'), pop2=act.closest('.popm'); pop2.classList.remove('open');
      if(act.getAttribute('data-a')==='like'){
        var p=el._p, k=p.likes.indexOf('me'); if(k>=0) p.likes.splice(k,1); else { p.likes.unshift('me'); burst(act); buzz(12); }
        if(p.id){ if(k>=0) delete likedMap[p.id]; else likedMap[p.id]=1; saveLikes(); }
        renderCmt(el);
      } else if(act.getAttribute('data-a')==='del'){
        var pp=el._p; P.confirm(win,{title:'删掉这篇日记？',msg:'删掉之后找不回来，他之前的留言也会一起没有。',ok:'删除',danger:true},function(){
          P.net.post('/diary/api/entries/delete',{id:pp.id}).then(function(){ sync(); el.classList.add('gone'); setTimeout(function(){ el.remove(); },380); data=data.filter(function(x){ return x!==pp; }); toast('已删除'); buzz(8); }).catch(function(){ toast('没删成，稍后再试'); });
        });
      } else openCbar(el);
      return;
    }
    if(!e.target.closest('#cbar')){ closePops(); if(cbar.classList.contains('show')) closeCbar(); }
  });

  $('#dyNew',win).addEventListener('click',function(){
    /* [位置:phone-diary.js·dyNew 发表] [支持图片/纯图片] [10-28：发表器开 images，提交 {text,images}，二者至少有一；后端 entries/add 已放宽：text 空但 images 非空即过] [注释时间 2026-10-28] */
    P.sheet(win,{title:'写日记',ph:'今天发生了什么…',hint:aiName()+'可以看到',btn:'发表',images:true,onSubmit:function(v,imgs){
      /* [位置:phone-diary.js·dyNew 发表] [失败不清空] [11-13 审查：原来先关弹层再提交，断网时整篇内容和已传图片一起消失；现在返回 Promise，失败时弹层留着、内容还在，直接再点一次就能重试] [注释时间 2026-11-13] */
      return P.net.post('/diary/api/entries/add',{text:v,images:imgs||[]}).then(function(){
        return P.net.get('/diary/api/entries').then(function(list){
          P.net.keep('diary',list); paint((list||[]).map(mapEntry)); var el=feed.querySelector('.post'); if(el){ el.classList.remove('stag'); el.classList.add('newpost'); }
          sc.scrollTo({top:cover.offsetHeight-60,behavior:'smooth'}); buzz(10); toast('发表啦，他会看到');
        },function(){ toast('发表啦，但列表没刷新，回来看一眼'); });
      }).catch(function(e){ toast('没发出去，内容还在，再点一次'); throw e; });
    }});
  });
  /* 点图看大图 */
  feed.addEventListener('click',function(e){ var im=e.target.closest('.pics i.ph'); if(!im) return; var o=document.createElement('div'); o.className='dy-big'; o.innerHTML='<img src="'+im.dataset.s+'" alt="">'; o.addEventListener('click',function(){ o.classList.remove('show'); setTimeout(function(){ o.remove(); },260); }); win.appendChild(o); requestAnimationFrame(function(){ o.classList.add('show'); }); });
}

P.register('diary',{html:html,setup:setup});
})();
