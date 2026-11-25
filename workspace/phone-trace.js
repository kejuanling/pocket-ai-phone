/* [位置:phone-trace.js·文件头] [小手机「痕迹」app：trace_notes 可读页 + 召回命中记录页] [11-07：桌面第三页游戏胶囊整个删掉，位置换「痕迹」——按时间倒序列出他写的每一条此刻；点开看整句、切分出的关键词（gram）、命中时给他的召回文案、msg_id 的上下文（前后各 6 条，与 AI 的 context get 同款口径）] [11-14 命中分段（随手记15）：顶栏下加「痕迹/命中」分段——命中视图按时间倒序列出每次召回（哪个会话、她说了什么、命中了哪些记忆/此刻/相册条目，注入=真给了他、预览=本应命中），点开看命中条目与当时上下文；列表来自 /v1/recall-hits（context-v2-runtime 钩子落盘 + 时间线历史浮现），上下文锚点用 anchor_msg_id（浮现消息）或 at（时间）] [注释时间 2026-11-07，11-14 加命中分段] */
(function(){
"use strict";
var P=window.PH; if(!P||!P.register||!P.net) return;
var $=P.$, esc=P.esc||function(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }, buzz=P.buzz||function(){}, toast=P.toast||function(){};
var two=P.net.two;
var VIEW='trace'; /* 当前分段：trace=此刻列表 | hits=召回命中 */
var CTX={};   /* msg_id -> 上下文数组；undefined=没拉过，null=拉失败 */
var OPEN={};  /* msg_id -> 展开中 */
var tcN=null; /* 顶栏条数（在 topbar 里，setup 时抓） */
var hdata=[];     /* 命中视图条目 */
var hOpen={};     /* 命中条目 id -> 展开中 */
var hCtx={};      /* 上下文缓存：键 ctxKey(it)，undefined=没拉过，null=拉失败 */
var hPending=0;   /* 服务端历史浮现索引还没扫完的文件数（>0 时列表底部提示） */

/* [位置:phone-trace.js·fmtStamp] [折叠行的时间戳] [今年不带年；与设计稿同款 MM-DD HH:mm] [注释时间 2026-11-07] */
function fmtStamp(iso){ var d=P.net.parse(iso); if(!d) return ''; var n=new Date(), y=d.getFullYear()===n.getFullYear()?'':d.getFullYear()+'-'; return y+two(d.getMonth()+1)+'-'+two(d.getDate())+' '+two(d.getHours())+':'+two(d.getMinutes()); }

/* [位置:phone-trace.js·roleName] [上下文消息的发言名字] [user/assistant 读主题统一称呼，其他角色兜底显示角色名] [注释时间 2026-11-25] */
function roleName(r){ return r==='user'?esc((P.names&&P.names.me)?P.names.me():'用户'):r==='assistant'?esc((P.names&&P.names.ai)?P.names.ai():'助手'):esc(String(r||'')); }

/* [位置:phone-trace.js·clean] [上下文正文轻洗] [剥 <current_time> 标签（AI 看到的原文里带，人看不需要）；空文本给占位] [注释时间 2026-11-07] */
function clean(t){ return String(t||'').replace(/<current_time>[\s\S]*?<\/current_time>/gi,'').trim(); }

/* [位置:phone-trace.js·srcName/modeName] [命中条目来源与模式的中文名] [11-14 命中分段] [注释时间 2026-11-14] */
function srcName(s){ return s==='trace'?'此刻':s==='album'?'相册':'记忆'; }
function modeName(m){ return m==='preview'?'预览':'注入'; }

/* [位置:phone-trace.js·ctxKey] [命中条目的上下文缓存键与请求锚点：有 anchor_msg_id（浮现消息）用 msg_id 精确锚，没有用命中时刻 at] [注释时间 2026-11-14] */
function ctxKey(it){ return it.anchor_msg_id ? 'm|'+it.session+'|'+it.anchor_msg_id : 't|'+it.session+'|'+it.ts; }
function ctxUrl(it){ return '/v1/trace-context?sid='+encodeURIComponent(it.session||'')+(it.anchor_msg_id ? '&msg_id='+encodeURIComponent(it.anchor_msg_id) : '&at='+encodeURIComponent(it.ts||'')); }

/* [位置:phone-trace.js·rangeOf] [上下文窗口的起止时间] [11-07 extra：每条消息不带时间（短消息右边空一大块），时间收成一段放「上下文」标题行右边；同天只显时刻，跨天带日期] [注释时间 2026-11-07] */
function rangeOf(th){ if(!th||!th.length) return ''; var a=P.net.parse(th[0].time), b=P.net.parse(th[th.length-1].time); if(!a||!b) return '';
  var f=function(d){ return two(d.getMonth()+1)+'-'+two(d.getDate())+' '+two(d.getHours())+':'+two(d.getMinutes()); };
  return a.toDateString()===b.toDateString() ? two(a.getHours())+':'+two(a.getMinutes())+' – '+two(b.getHours())+':'+two(b.getMinutes()) : f(a)+' – '+f(b); }

/* [位置:phone-trace.js·html] [页面骨架] [常显毛玻璃顶栏（返回 / 痕迹 / 条数）+ 分段（痕迹/命中）+ 列表容器] [注释时间 2026-11-07，11-14 加分段] */
function html(){
  return '<div class="content tc">'+
    '<div class="topbar"><button class="back tap" aria-label="返回"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><div class="ttl">痕迹</div><span class="tc-n" id="tcN"></span></div>'+
    '<div class="tc-seg" id="tcSeg"><button class="tap on" type="button" data-view="trace">痕迹</button><button class="tap" type="button" data-view="hits">命中</button></div>'+
    '<div class="tc-scroll" id="tcScroll"><div class="tc-list" id="tcList"></div></div>'+
  '</div>';
}

/* ---- 此刻（trace）视图 ---- */

/* [位置:phone-trace.js·thSec] [msg_id 的上下文区块] [四态：没拉过→加载动画；null→失败可重试；空→没找到；正常→标题行右侧带起止时间（11-07 extra）] [注释时间 2026-11-07] */
function thSec(it){
  var th=CTX[it.msg_id], h='<div class="tc-sec"><div class="tc-sec-h"><label>msg_id 的上下文 · 前后各 6 条</label><span class="tc-rng">'+esc(rangeOf(th))+'</span></div>';
  if(th===undefined) return h+'<div class="tc-ld">'+(P.load?P.load.html():'')+'</div></div>';
  if(th===null) return h+'<div data-ctxretry="'+esc(it.msg_id)+'">'+P.net.failBox()+'</div></div>';
  if(!th.length) return h+'<p class="tc-ph">没找到这条原文</p></div>';
  return h+'<div class="tc-th">'+th.map(function(m){
    return '<div class="tc-m'+(m.hit?' hit':'')+'"><b>'+roleName(m.role)+'</b><p>'+esc(clean(m.text))+'</p></div>';
  }).join('')+'</div></div>';
}

/* [位置:phone-trace.js·bodyHTML] [展开体] [整句（衬线正文）→ 关键词 → 召回给他的 → msg_id 的上下文；顺序与设计稿一致] [注释时间 2026-11-07] */
function bodyHTML(it,op){
  var h='<div class="tc-in"><p class="tc-full">'+esc(it.content)+'</p>';
  h+='<div class="tc-sec"><label>关键词 '+((it.grams||[]).length)+'</label><div class="tc-grams">'+(it.grams||[]).map(function(g){ return '<i>'+esc(g)+'</i>'; }).join('')+'</div></div>';
  h+='<div class="tc-sec"><label>召回给他的</label><p class="tc-recall">'+esc(it.recall)+'</p></div>';
  h+= it.msg_id ? thSec(it) : '<div class="tc-sec"><label>msg_id 的上下文</label><p class="tc-ph">这条没带 msg_id</p></div>';
  return h+'</div>';
}

/* [位置:phone-trace.js·cardHTML] [单条卡片] [展开态直接渲染展开体并 height:auto（静默刷新重画后保持展开）] [注释时间 2026-11-07] */
function cardHTML(it,i){
  var op=!!OPEN[it.msg_id];
  return '<article class="tc-card stag'+(op?' open':'')+'" style="--i:'+(i+1)+'" data-tid="'+esc(it.msg_id||it.id)+'">'+
    '<button class="tc-row tap" type="button"><time>'+esc(fmtStamp(it.at))+'</time><span class="tc-txt">'+esc(it.content)+'</span><em class="tc-chev">›</em></button>'+
    (op?'<div class="tc-body" style="height:auto">'+bodyHTML(it)+'</div>':'<div class="tc-body"></div>')+
  '</article>';
}

/* ---- 命中（hits）视图（11-14）---- */

/* [位置:phone-trace.js·hitSec] [命中的条目区块] [每条：来源徽标（记忆/此刻/相册）+ id（小字等宽）+ 注入文案摘要 + 分数] [注释时间 2026-11-14] */
function hitSec(it){
  var arr=it.hits||[];
  return '<div class="tc-sec"><label>命中的条目 '+arr.length+'</label><div class="tc-hits">'+arr.map(function(x){
    return '<div class="tc-hit"><i class="src s-'+esc(x.src||'memory')+'">'+esc(srcName(x.src))+'</i><div class="hc"><code>'+esc(x.id)+'</code><p>'+esc(x.head||'')+'</p></div>'+(x.score!=null?'<em>'+esc(x.score)+'</em>':'')+'</div>';
  }).join('')+'</div></div>';
}

/* [位置:phone-trace.js·hCtxSec] [命中时刻的上下文区块] [锚点：anchor_msg_id（浮现消息）精确锚，否则 at 时间锚（服务端取 ≤ 时刻的最后一条真实消息）；四态同 thSec] [注释时间 2026-11-14] */
function hCtxSec(it){
  var key=ctxKey(it), th=hCtx[key], h='<div class="tc-sec"><div class="tc-sec-h"><label>当时的上下文 · 前后各 6 条</label><span class="tc-rng">'+esc(rangeOf(th))+'</span></div>';
  if(th===undefined) return h+'<div class="tc-ld">'+(P.load?P.load.html():'')+'</div></div>';
  if(th===null) return h+'<div data-hctxretry="'+esc(key)+'">'+P.net.failBox()+'</div></div>';
  if(!th.length) return h+'<p class="tc-ph">这个会话里没找到当时的消息</p></div>';
  return h+'<div class="tc-th">'+th.map(function(m){
    return '<div class="tc-m'+(m.hit?' hit':'')+'"><b>'+roleName(m.role)+'</b><p>'+esc(clean(m.text))+'</p></div>';
  }).join('')+'</div></div>';
}

/* [位置:phone-trace.js·hBodyHTML] [命中展开体] [会话行（模式徽标+会话名）→ 她说的话（衬线）→ 命中的条目 → 当时的上下文] [注释时间 2026-11-14] */
function hBodyHTML(it){
  var h='<div class="tc-in"><div class="tc-meta"><em class="tc-badge'+(it.mode==='preview'?' prev':'')+'">'+esc(modeName(it.mode))+'</em><b>'+esc(it.session_name||it.session||'')+'</b></div>';
  h+= it.query ? '<p class="tc-full tc-q">'+esc(clean(it.query))+'</p>' : '';
  h+=hitSec(it);
  h+=hCtxSec(it);
  return h+'</div>';
}

/* [位置:phone-trace.js·hCardHTML] [命中折叠行] [时间 + 模式徽标 + 触发话摘要（浮现已并入的用 query，独立浮现没有 query 就用浮现文案）+ 箭头] [注释时间 2026-11-14] */
function hCardHTML(it,i){
  var op=!!hOpen[it.id];
  var row=clean(it.query || ((it.hits&&it.hits[0]&&it.hits[0].head) || ''));
  return '<article class="tc-card stag'+(op?' open':'')+'" style="--i:'+(i+1)+'" data-hid="'+esc(it.id)+'">'+
    '<button class="tc-row tap" type="button"><time>'+esc(fmtStamp(it.ts))+'</time><em class="tc-badge'+(it.mode==='preview'?' prev':'')+'">'+esc(modeName(it.mode))+'</em><span class="tc-txt">'+esc(row)+'</span><em class="tc-chev">›</em></button>'+
    (op?'<div class="tc-body" style="height:auto">'+hBodyHTML(it)+'</div>':'<div class="tc-body"></div>')+
  '</article>';
}

/* [位置:phone-trace.js·paint] [画此刻列表] [缓存秒显+静默刷新共用；入场逐条浮起，动画期间禁命中（同 diary）；空态「还没有痕迹」；顶栏条数同步] [注释时间 2026-11-07] */
var data=[], list=null, entering=0;
function paint(items){
  if(VIEW!=='trace') return;
  if(P.afterGesture&&!P.afterGesture('trace',function(){ paint(items); })) return;
  data=items||[];
  if(tcN) tcN.textContent=data.length||'';
  if(!data.length){ list.innerHTML='<div class="tc-empty">还没有痕迹</div>'; return; }
  list.innerHTML=data.map(cardHTML).join('');
  /* 展开中的卡片重画后保持展开（bodyHTML 已按 CTX 渲染，height 直接 auto） */
  Array.prototype.forEach.call(list.querySelectorAll('.tc-card.open .tc-body'),function(b){ b.style.height='auto'; });
  list.classList.add('entering'); clearTimeout(paint._et);
  paint._et=setTimeout(function(){ list.classList.remove('entering'); },Math.min(420,120+data.length*20));
}

/* [位置:phone-trace.js·hPaint] [画命中列表] [同 paint 的缓存秒显/入场/展开保持；空态「还没有命中记录」；服务端浮现索引没扫完时底部给整理中提示] [注释时间 2026-11-14] */
function hPaint(items){
  if(VIEW!=='hits') return;
  if(P.afterGesture&&!P.afterGesture('trace',function(){ hPaint(items); })) return;
  hdata=items||[];
  if(tcN) tcN.textContent=hdata.length||'';
  if(!hdata.length){ list.innerHTML='<div class="tc-empty">还没有命中记录</div>'; return; }
  list.innerHTML=hdata.map(hCardHTML).join('')+(hPending>0?'<div class="tc-hint">历史命中还在整理，再等等…</div>':'');
  Array.prototype.forEach.call(list.querySelectorAll('.tc-card.open .tc-body'),function(b){ b.style.height='auto'; });
  list.classList.add('entering'); clearTimeout(hPaint._et);
  hPaint._et=setTimeout(function(){ list.classList.remove('entering'); },Math.min(420,120+hdata.length*20));
}

/* [位置:phone-trace.js·load] [拉当前分段的列表] [先本机缓存秒显，再拉新的覆盖；失败且没缓存→failBox 可重试；命中视图服务端 pending>0 时静默续拉（索引按请求增量推进，一次最多 12 轮）] [注释时间 2026-11-07，11-14 分流命中] */
function load(){
  if(VIEW==='hits') return loadHits();
  return P.net.get('/v1/trace-notes').then(function(j){
    var items=(j&&j.items)||[]; P.net.keep('trace-notes',items); paint(items);
  }).catch(function(){
    P.net.offline();
    if(data.length) return;
    list.innerHTML=P.net.failBox();
  });
}
function loadHits(){
  return P.net.get('/v1/recall-hits').then(function(j){
    hPending=(j&&j.pending)||0;
    var items=(j&&j.items)||[]; P.net.keep('recall-hits',items); hPaint(items);
    if(hPending>0) chainHits();
  }).catch(function(){
    P.net.offline();
    if(hdata.length) return;
    list.innerHTML=P.net.failBox();
  });
}
var chainRun=0;
function chainHits(){
  if(chainRun) return;
  chainRun=1;
  var n=0;
  var go=function(){
    if(VIEW!=='hits'||hPending<=0||n++>=12){ chainRun=0; return; }
    P.net.get('/v1/recall-hits').then(function(j){
      hPending=(j&&j.pending)||0;
      hPaint((j&&j.items)||[]);
      setTimeout(go,400);
    }).catch(function(){ chainRun=0; });
  };
  go();
}

/* [位置:phone-trace.js·loadCtx] [按 msg_id 拉上下文（此刻视图）] [展开时才拉，一次缓存住；失败记 null 可重试；重画对应区块] [注释时间 2026-11-07] */
function loadCtx(it){
  var mid=it.msg_id; if(!mid||CTX[mid]!==undefined) return;
  P.net.get('/v1/trace-context?msg_id='+encodeURIComponent(mid)+'&sid='+encodeURIComponent(it.session_id||'')).then(function(j){
    CTX[mid]=(j&&j.messages)||[]; repaintSec(mid);
    /* 命中那条滚到可视区中间（人就是为了看它才展开的） */
    var card=list.querySelector('.tc-card[data-tid="'+mid.replace(/"/g,'\\\"')+'"]'); var h=card&&card.querySelector('.tc-m.hit');
    if(h) h.scrollIntoView({block:'center',behavior:'smooth'});
  }).catch(function(){ CTX[mid]=null; repaintSec(mid); });
}

/* [位置:phone-trace.js·hLoadCtx] [按锚点拉上下文（命中视图）] [同 loadCtx，键是 ctxKey；拉回来不自动滚，避免打断阅读] [注释时间 2026-11-14] */
function hLoadCtx(it){
  var key=ctxKey(it); if(hCtx[key]!==undefined) return;
  P.net.get(ctxUrl(it)).then(function(j){
    hCtx[key]=(j&&j.messages)||[]; hRepaint(it.id);
  }).catch(function(){ hCtx[key]=null; hRepaint(it.id); });
}

/* [位置:phone-trace.js·repaintSec] [只重画一条的展开体] [上下文回来后原位更新，不动整列表、不闪] [注释时间 2026-11-07] */
function repaintSec(mid){
  var card=list.querySelector('.tc-card[data-tid="'+mid.replace(/"/g,'\\"')+'"]'); if(!card) return;
  var it=null; for(var i=0;i<data.length;i++){ if((data[i].msg_id||data[i].id)===mid){ it=data[i]; break; } }
  if(!it) return;
  var body=card.querySelector('.tc-body'); if(!body) return;
  var wasAuto=body.style.height==='auto';
  body.innerHTML=bodyHTML(it);
  if(wasAuto) body.style.height='auto';
}

/* [位置:phone-trace.js·hRepaint] [只重画一条命中展开体] [同 repaintSec] [注释时间 2026-11-14] */
function hRepaint(hid){
  var card=list.querySelector('.tc-card[data-hid="'+String(hid).replace(/"/g,'\\"')+'"]'); if(!card) return;
  var it=null; for(var i=0;i<hdata.length;i++){ if(hdata[i].id===hid){ it=hdata[i]; break; } }
  if(!it) return;
  var body=card.querySelector('.tc-body'); if(!body) return;
  var wasAuto=body.style.height==='auto';
  body.innerHTML=hBodyHTML(it);
  if(wasAuto) body.style.height='auto';
}

/* [位置:phone-trace.js·toggle] [展开 / 收起（此刻视图）] [高度过渡：0→scrollHeight→auto（收起反向），弹簧曲线；展开同时懒拉上下文] [注释时间 2026-11-07] */
function toggle(card){
  var mid=card.getAttribute('data-tid');
  var it=null; for(var i=0;i<data.length;i++){ if((data[i].msg_id||data[i].id)===mid){ it=data[i]; break; } }
  if(!it) return;
  var body=card.querySelector('.tc-body'); if(!body) return;
  var opening=!card.classList.contains('open');
  card.classList.toggle('open',opening);
  if(opening){
    OPEN[mid]=1;
    body.innerHTML=bodyHTML(it);
    body.style.height=body.scrollHeight+'px';
    var done=function(){ if(card.classList.contains('open')) body.style.height='auto'; body.removeEventListener('transitionend',te); };
    var te=function(e){ if(e.propertyName==='height') done(); };
    body.addEventListener('transitionend',te);
    setTimeout(done,450);   /* transitionend 丢了也能开 */
    buzz(5);
    loadCtx(it);
    /* 命中条滚到可见（首展开时上下文还在拉，回来后 repaintSec 里再做一次也来不及——拉回来后不自动滚，避免打断阅读） */
  }else{
    delete OPEN[mid];
    body.style.height=body.scrollHeight+'px';
    void body.offsetHeight;
    body.style.height='0px';
  }
}

/* [位置:phone-trace.js·hToggle] [展开 / 收起（命中视图）] [同 toggle 的过渡曲线；展开懒拉当时的上下文] [注释时间 2026-11-14] */
function hToggle(card){
  var hid=card.getAttribute('data-hid');
  var it=null; for(var i=0;i<hdata.length;i++){ if(hdata[i].id===hid){ it=hdata[i]; break; } }
  if(!it) return;
  var body=card.querySelector('.tc-body'); if(!body) return;
  var opening=!card.classList.contains('open');
  card.classList.toggle('open',opening);
  if(opening){
    hOpen[hid]=1;
    body.innerHTML=hBodyHTML(it);
    body.style.height=body.scrollHeight+'px';
    var done=function(){ if(card.classList.contains('open')) body.style.height='auto'; body.removeEventListener('transitionend',te); };
    var te=function(e){ if(e.propertyName==='height') done(); };
    body.addEventListener('transitionend',te);
    setTimeout(done,450);
    buzz(5);
    hLoadCtx(it);
  }else{
    delete hOpen[hid];
    body.style.height=body.scrollHeight+'px';
    void body.offsetHeight;
    body.style.height='0px';
  }
}

/* [位置:phone-trace.js·paintView] [按当前分段画：先缓存秒显再拉新的] [切换分段时清两边的展开态，避免键串视图] [注释时间 2026-11-14] */
function paintView(){
  OPEN={}; hOpen={};
  if(VIEW==='trace'){
    (function(){ var c=P.net.peek('trace-notes'); if(c&&c.length) paint(c); })();
    if(!data.length) list.innerHTML='<div class="tc-ld">'+(P.load?P.load.html():'')+'</div>';
    load();
  }else{
    (function(){ var c=P.net.peek('recall-hits'); if(c&&c.length) hPaint(c); })();
    if(!hdata.length) list.innerHTML='<div class="tc-ld">'+(P.load?P.load.html():'')+'</div>';
    load();
  }
}

function setup(win){
  list=$('#tcList',win);
  tcN=$('#tcN',win);
  var seg=$('#tcSeg',win);

  /* 缓存秒显 → 拉新的（默认此刻视图） */
  paintView();

  /* 分段切换 */
  if(seg) seg.addEventListener('click',function(e){
    var b=e.target.closest('[data-view]');
    if(!b||b.classList.contains('on')) return;
    VIEW=b.getAttribute('data-view');
    Array.prototype.forEach.call(seg.querySelectorAll('button'),function(x){ x.classList.toggle('on',x===b); });
    buzz(5);
    paintView();
  });

  /* 点折叠行开合；失败按钮重试（上下文 / 整页列表两路）；命中视图走自己的重试与开合 */
  list.addEventListener('click',function(e){
    if(e.target.closest('[data-retry]')){ list.innerHTML='<div class="tc-ld">'+(P.load?P.load.html():'')+'</div>'; load(); return; }
    if(VIEW==='hits'){
      var hr=e.target.closest('[data-hctxretry]');
      if(hr){
        var k=hr.getAttribute('data-hctxretry');
        var it3=null; for(var i2=0;i2<hdata.length;i2++){ if(ctxKey(hdata[i2])===k){ it3=hdata[i2]; break; } }
        if(it3){ hCtx[k]=undefined; hLoadCtx(it3); }
        return;
      }
      var row2=e.target.closest('.tc-row');
      if(row2) hToggle(row2.parentNode);
      return;
    }
    var retry=e.target.closest('[data-ctxretry]');
    if(retry){
      var mid=retry.getAttribute('data-ctxretry');
      var it2=null; for(var i=0;i<data.length;i++){ if((data[i].msg_id||data[i].id)===mid){ it2=data[i]; break; } }
      if(it2){ CTX[mid]=undefined; loadCtx(it2); }
      return;
    }
    var row=e.target.closest('.tc-row');
    if(row) toggle(row.parentNode);
  });
}
P.register('trace',{html:html,setup:setup});
})();
