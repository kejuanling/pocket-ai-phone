/* 小手机 · 聊天里的互动卡片
   他可以在对话里发一张卡片，你直接点、选、玩；答案会以事件 ph:card 抛出去，接上后台就能回传给他。

   卡片协议（后台以后只要把这段 JSON 放进他的消息里）：
     [[card:{"id":"c1","type":"choice","q":"今晚吃什么？","opts":[{"t":"火锅"},{"t":"小面"}]}]]
   type：choice 选择 / mood 心情 / fortune 抽签 / rps 猜拳 / checklist 小清单
   P.cards.parse(text) → {text, card}；P.cards.render(spec,{answer:fn}) → 元素 */
(function(){
"use strict";
var P=window.PH, esc=P.esc, buzz=P.buzz;
var KEY='ph.cards.v1', ST={}, NS='';
try{ ST=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ ST={}; }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(ST)); }catch(e){} }
/* [位置:phone-cards.js·scope/SK] [卡片状态按会话隔离] [原存储只按卡片id全局存：两个会话的AI撞了同一个id（如 form-20261029-01），A会话答过的内容被B会话没碰过的卡还原并锁死（假「已发给他」）。渲染入口先 P.cards.scope(会话id)，状态键变 会话id|卡片id；没调scope时键=裸id，行为同旧版。遗留：同会话内重发同id卡仍共享状态；彻底修=锁状态以时间线回执为准] [注释时间 2026-10-29] */
function scope(s){ NS=String(s==null?'':s); }
function SK(id){ return NS?NS+'|'+id:String(id); }
function pick(a){ return a[Math.floor(Math.random()*a.length)]; }

var IC={
  choice:'<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg>',
  mood:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.8 14.4c.9 1.3 2 1.9 3.2 1.9s2.3-.6 3.2-1.9"/><path d="M9 9.6v.1M15 9.6v.1"/></svg>',
  fortune:'<svg viewBox="0 0 24 24"><path d="M7 9h10l-1 11H8z"/><path d="M9.5 9V4.5M12 9V3M14.5 9V5"/></svg>',
  rps:'<svg viewBox="0 0 24 24"><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V10M10 10V5a1.5 1.5 0 0 1 3 0v5M13 10V6a1.5 1.5 0 0 1 3 0v6M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L4.5 15a1.6 1.6 0 0 1 2.6-1.8L7 14"/></svg>',
  checklist:'<svg viewBox="0 0 24 24"><path d="M4.5 6.5 6 8l2.5-2.5M4.5 12.5 6 14l2.5-2.5M4.5 18.5 6 20l2.5-2.5M11.5 7H20M11.5 13H20M11.5 19H20"/></svg>',
  blocks:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/></svg>',
  board:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/></svg>',
  touch:'<svg viewBox="0 0 24 24"><path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>'
};
var LABEL={choice:'选一个',mood:'心情打卡',fortune:'今日一签',rps:'猜拳',checklist:'小清单',blocks:'小卡片',board:'对弈',touch:'触碰'};

function shell(spec,body){
  return '<div class="cd-h"><i class="cd-i">'+IC[spec.type]+'</i><span>'+(spec.label||LABEL[spec.type]||'卡片')+'</span></div>'+
    (spec.q?'<div class="cd-q">'+esc(spec.q)+'</div>':'')+body;
}
function finish(spec,ctx,res){
  res=Object.assign({id:spec.id,type:spec.type},res);
  if(spec.id&&spec.type!=='rps'&&spec.type!=='board'&&spec.type!=='touch'){ ST[spec.__sk||spec.id]=res; save(); }   /* board/touch：不锁死本地状态，允许连续互动 */
  try{ window.dispatchEvent(new CustomEvent('ph:card',{detail:res})); }catch(e){}
  if(ctx&&ctx.answer) ctx.answer(res,spec);
}
function foot(el,t){ var f=el.querySelector('.cd-foot'); if(f){ f.textContent=t; f.classList.add('on'); } }

/* ---------- 选一个 ---------- */
function choice(spec,el,ctx){
  var multi=!!spec.multi, vs=!multi&&spec.opts.length===2&&spec.versus!==false&&spec.opts.some(function(o){ return o.e; });
  el.innerHTML=shell(spec,'<div class="cd-opts'+(vs?' vs':'')+'">'+spec.opts.map(function(o){
    return '<button class="cd-opt tap" data-k="'+esc(o.k||o.t)+'">'+(o.e?'<em>'+o.e+'</em>':'')+'<span>'+esc(o.t)+'</span><u></u></button>'; }).join('')+'</div>'+
    (multi?'<button class="cd-go tap" disabled>定了</button>':'')+'<div class="cd-foot"></div>');
  var btns=Array.prototype.slice.call(el.querySelectorAll('.cd-opt')), go=el.querySelector('.cd-go'), st=ST[spec.__sk||spec.id];
  function textOf(keys){ return btns.filter(function(b){ return keys.indexOf(b.dataset.k)>=0; }).map(function(b){ return b.querySelector('span').textContent; }).join('、'); }
  function lock(keys){ el.classList.add('locked'); btns.forEach(function(b){ b.classList.toggle('on',keys.indexOf(b.dataset.k)>=0); }); if(go) go.remove(); foot(el,'你选了：'+textOf(keys)); }
  if(st&&st.value){ lock(st.value); return; }
  var sel=[];
  btns.forEach(function(b){ b.addEventListener('click',function(){
    if(el.classList.contains('locked')) return; buzz(8);
    if(multi){ var k=b.dataset.k, i=sel.indexOf(k); if(i>=0) sel.splice(i,1); else sel.push(k); b.classList.toggle('on',i<0); go.disabled=!sel.length; return; }
    lock([b.dataset.k]); finish(spec,ctx,{value:[b.dataset.k],text:textOf([b.dataset.k])});
  }); });
  if(go) go.addEventListener('click',function(){ if(!sel.length) return; var v=sel.slice(); lock(v); buzz(10); finish(spec,ctx,{value:v,text:textOf(v)}); });
}

/* ---------- 心情 ---------- */
var FACES=[
  ['糟透了','M8.6 16.4c1-1.7 2.3-2.4 3.4-2.4s2.4.7 3.4 2.4','抱一下。今天什么都不用硬撑。'],
  ['有点低落','M9 15.8c.9-.8 1.9-1.2 3-1.2s2.1.4 3 1.2','嗯，我在这儿，慢慢来。'],
  ['一般般','M9 15.2h6','平平的一天也算数。'],
  ['还不错','M8.8 14.4c.9 1.3 2 1.9 3.2 1.9s2.3-.6 3.2-1.9','那就好，我也跟着亮了一点。'],
  ['超开心','M8 13.6h8c0 2.4-1.8 4-4 4s-4-1.6-4-4z','想把这一刻收进口袋里。']
];
function face(i){ return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2"/><circle class="f" cx="9" cy="10" r=".9"/><circle class="f" cx="15" cy="10" r=".9"/><path d="'+FACES[i][1]+'"/></svg>'; }
function mood(spec,el,ctx){
  el.innerHTML=shell(spec,'<div class="cd-faces">'+FACES.map(function(f,i){ return '<button class="cd-face tap" data-i="'+i+'" style="--h:'+(215+i*36)+'" aria-label="'+f[0]+'">'+face(i)+'<span>'+f[0]+'</span></button>'; }).join('')+'</div><div class="cd-foot"></div>');
  var btns=Array.prototype.slice.call(el.querySelectorAll('.cd-face')), st=ST[spec.__sk||spec.id];
  function lock(i){ el.classList.add('locked'); btns.forEach(function(b){ b.classList.toggle('on',+b.dataset.i===i); }); foot(el,FACES[i][2]); }
  if(st&&st.value!=null){ lock(st.value); return; }
  btns.forEach(function(b){ b.addEventListener('click',function(){ if(el.classList.contains('locked')) return; var i=+b.dataset.i; buzz(10); lock(i); finish(spec,ctx,{value:i,text:FACES[i][0]}); }); });
}

/* ---------- 抽签 ---------- */
var SLIPS=[
  ['大吉','你想见的人，正在想你。'],['上上签','今天会有一件小事，刚好合你的心意。'],['上签','你一直在认真生活，这份认真不会被辜负。'],
  ['中吉','慢一点也没关系，我在终点等你。'],['小吉','今晚早点睡，明天的好运在梦里先替你收着。'],['吉','想吃的那样东西，今天可以买。'],
  ['平','什么都不用证明，坐一会儿，喝点热的。'],['半吉','先把眼前这一口气喘匀，剩下的我陪你。']
];
function fortune(spec,el,ctx){
  el.innerHTML=shell(spec,'<button class="cd-tube tap" aria-label="摇签"><svg viewBox="0 0 64 72"><g class="stk"><rect x="22" y="2" width="4.5" height="30" rx="2.2"/><rect x="29.8" y="0" width="4.5" height="32" rx="2.2"/><rect x="37.6" y="4" width="4.5" height="28" rx="2.2"/></g><path class="tb" d="M14 30h36l-3.4 38a4 4 0 0 1-4 3.6H21.4a4 4 0 0 1-4-3.6z"/><path class="ln" d="M17 42h30M18 54h28"/></svg></button><div class="cd-hint">点一下，摇出今天的签</div><div class="cd-slip"><b></b><p></p></div>');
  var tube=el.querySelector('.cd-tube'), hint=el.querySelector('.cd-hint'), slip=el.querySelector('.cd-slip'), st=ST[spec.__sk||spec.id];
  function show(r){ slip.querySelector('b').textContent=r[0]; slip.querySelector('p').textContent=r[1]; slip.classList.add('on'); hint.textContent='这支签替你收好了'; el.classList.add('locked'); }
  if(st&&st.value){ show(st.value); return; }
  tube.addEventListener('click',function(){
    if(el.classList.contains('locked')||el.classList.contains('shaking')) return;
    el.classList.add('shaking'); hint.textContent='摇一摇…'; buzz(18); setTimeout(function(){ buzz(12); },260); setTimeout(function(){ buzz(10); },520);
    setTimeout(function(){ el.classList.remove('shaking'); var r=pick(spec.slips||SLIPS); show(r); buzz(14); finish(spec,ctx,{value:r,text:r[0]+'：'+r[1]}); },950);
  });
}

/* ---------- 猜拳 ---------- */
var HANDS=[['石头','✊'],['剪刀','✌️'],['布','🖐️']];
function rps(spec,el,ctx){
  el.innerHTML=shell(spec,'<div class="cd-rps"><div class="cd-arena"><div class="you"><em>·</em><small>你</small></div><div class="vs">vs</div><div class="him"><em>·</em><small>我</small></div></div>'+
    '<div class="cd-hands">'+HANDS.map(function(h,i){ return '<button class="cd-hand tap" data-i="'+i+'"><em>'+h[1]+'</em><span>'+h[0]+'</span></button>'; }).join('')+'</div></div><div class="cd-foot"></div>');
  var you=el.querySelector('.you em'), him=el.querySelector('.him em'), btns=el.querySelectorAll('.cd-hand'), busy=false;
  Array.prototype.forEach.call(btns,function(b){ b.addEventListener('click',function(){
    if(busy) return; busy=true; var me=+b.dataset.i, ai=Math.floor(Math.random()*3); buzz(8);
    el.classList.add('playing'); el.classList.remove('won','lost','tied'); you.textContent=HANDS[me][1]; him.textContent='…'; foot(el,'');
    setTimeout(function(){
      him.textContent=HANDS[ai][1]; var d=(me-ai+3)%3, r=d===0?'tied':d===1?'lost':'won';
      el.classList.remove('playing'); el.classList.add(r);
      var line={won:'你赢啦。这局让你了，才不是故意的。',lost:'我赢了。（小声）想要什么奖励？',tied:'平局。再来一局？'}[r];
      foot(el,line); buzz(r==='won'?16:8); busy=false;
      finish(spec,ctx,{value:r,text:{won:'我赢了',lost:'我输了',tied:'平局'}[r]});
    },720);
  }); });
}

/* ---------- 小清单 ---------- */
function checklist(spec,el,ctx){
  var st=ST[spec.__sk||spec.id], done=(st&&st.value)||spec.items.map(function(i){ return !!i.done; });
  el.innerHTML=shell(spec,'<div class="cd-prog"><i></i></div><div class="cd-list">'+spec.items.map(function(it,i){
    return '<button class="cd-item tap'+(done[i]?' on':'')+'" data-i="'+i+'"><u></u><span>'+esc(it.t)+'</span></button>'; }).join('')+'</div><div class="cd-foot"></div>');
  var items=el.querySelectorAll('.cd-item'), bar=el.querySelector('.cd-prog i');
  function paint(){ var n=done.filter(Boolean).length; bar.style.transform='scaleX('+(n/done.length)+')'; el.querySelector('.cd-h span').textContent=(spec.label||LABEL.checklist)+' · '+n+'/'+done.length; if(n===done.length) foot(el,'全划掉啦'); else{ var f=el.querySelector('.cd-foot'); f.classList.remove('on'); f.textContent=''; } }
  paint();
  Array.prototype.forEach.call(items,function(b){ b.addEventListener('click',function(){
    var i=+b.dataset.i; done[i]=!done[i]; b.classList.toggle('on',done[i]); buzz(done[i]?10:5); paint();
    finish(spec,ctx,{value:done.slice(),text:spec.items[i].t+(done[i]?' ✓':' ✗'),all:done.every(Boolean)});
  }); });
}


/* ---------- 积木卡片：他用一串积木拼，样式和交互都是现成的 ---------- */
function safeSrc(u){ u=String(u||''); return /^(https:\/\/|\/uploads\/|data:image\/(png|jpe?g|gif|webp);)/i.test(u)?u:''; }
/* [位置:phone-cards.js·fillSl] [滑杆已走过的那一段上色] [自绘滑杆轨道靠 --p（百分比）染色；拖动、还原时更新] [注释时间 2026-10-22] */
function fillSl(r){ var mn=+r.min||0, mx=+r.max||0, p=mx>mn?(r.value-mn)/(mx-mn)*100:0; r.style.setProperty('--p',p+'%'); }
/* [位置:phone-cards.js·growIn] [输入框随内容自动长高] [textarea 输入换行时按内容长高，到约 6 行封顶、再多内部滚动；渲染和还原后也调一次。量高推迟到下一帧：卡片渲染完还没挂进页面时 scrollHeight 是 0，直接量会把高度压成 0（只剩 padding 的扁条，真机聊天页同样是先渲染后挂载，会踩到）；空值时清掉内联高度、让 rows 属性接管初始行数] [注释时间 2026-10-31] */
function growIn(f){ requestAnimationFrame(function(){ if(!f.value){ f.style.height=''; return; } f.style.height='auto'; f.style.height=Math.min(f.scrollHeight,160)+'px'; }); }
function blocks(spec,el,ctx){
  var bl=(Array.isArray(spec.blocks)?spec.blocks:[]).slice(0,24), st=ST[spec.__sk||spec.id], saved=(st&&st.value&&st.value.vals)||null;
  var vals={}, html='', hasBtn=false, nInter=0, sole=null;
  bl.forEach(function(b,i){ b.__k=b.id||('b'+i); if(b.k==='button') hasBtn=true; if(/^(choice|slider|input|date)$/.test(b.k)){ nInter++; sole=b; } });
  var auto=!hasBtn&&nInter===1&&sole&&sole.k==='choice'&&!sole.multi;
  bl.forEach(function(b,i){
    var k=b.__k, q=b.q?'<div class="cd-bq">'+esc(b.q)+'</div>':'';
    if(b.k==='title') html+='<div class="cd-bt">'+esc(b.t||'')+'</div>';
    else if(b.k==='text') html+='<p class="cd-tx'+(b.s?' s':'')+'">'+esc(b.t||'')+'</p>';
    else if(b.k==='hr') html+='<i class="cd-hr"></i>';
    else if(b.k==='img'){ var u=safeSrc(b.src); if(u) html+='<img class="cd-img" loading="lazy" alt="'+esc(b.alt||'')+'" src="'+esc(u)+'">'; }
    else if(b.k==='countdown'){
      var d=new Date(b.to); if(!isNaN(d)){ var t0=new Date(); t0.setHours(0,0,0,0); var n=Math.round((d-t0)/864e5);
        html+='<div class="cd-cnt"><b>'+Math.abs(n)+'</b><span>天'+(n>=0?'后':'前')+(b.t?' · '+esc(b.t):'')+'</span></div>'; }
    }
    else if(b.k==='choice'&&Array.isArray(b.opts)) html+='<div class="cd-blk" data-k="'+esc(k)+'" data-t="choice">'+q+'<div class="cd-opts">'+b.opts.slice(0,12).map(function(o){
      return '<button class="cd-opt tap" data-v="'+esc(o.k||o.t)+'">'+(o.e?'<em>'+esc(o.e)+'</em>':'')+'<span>'+esc(o.t)+'</span><u></u></button>'; }).join('')+'</div></div>';
    else if(b.k==='slider'){ var mn=+b.min||0, mx=b.max==null?10:+b.max, df=b.def==null?Math.round((mn+mx)/2):+b.def;
      html+='<div class="cd-blk cd-sl" data-k="'+esc(k)+'" data-t="slider">'+(b.q?'<div class="cd-slh"><span>'+esc(b.q)+'</span><b>'+df+'</b></div>':'<div class="cd-slh"><span></span><b>'+df+'</b></div>')+
        '<input type="range" min="'+mn+'" max="'+mx+'" step="'+(+b.step||1)+'" value="'+df+'"></div>'; }
    /* [位置:phone-cards.js·blocks/input积木] [输入框自动换行+去字数限制] [10-31：原来默认单行 <input type=text>（天生不换行）且 maxlength 写死 120/300 有字数上限；改成统一 <textarea>（文字自动换行），默认 2 行、写 multi 时初始 3 行，无 maxlength；输入随内容自动长高（growIn）] [注释时间 2026-10-31] */
    else if(b.k==='input') html+='<div class="cd-blk" data-k="'+esc(k)+'" data-t="input">'+q+'<textarea class="cd-in" rows="'+(b.multi?3:2)+'" placeholder="'+esc(b.ph||'')+'"></textarea></div>';
    else if(b.k==='date') html+='<div class="cd-blk" data-k="'+esc(k)+'" data-t="date">'+q+'<input class="cd-in" type="date"></div>';
    else if(b.k==='button') html+='<button class="cd-btn tap'+(b.alt?' alt':'')+'" data-i="'+i+'">'+esc(b.t||'好了')+'</button>';
  });
  if(!hasBtn&&nInter&&!auto) html+='<button class="cd-btn tap" data-i="-1">好了</button>';
  el.innerHTML=shell(spec,'<div class="cd-blocks">'+html+'</div><div class="cd-foot"></div>');

  var boxes=Array.prototype.slice.call(el.querySelectorAll('.cd-blk')), btns=Array.prototype.slice.call(el.querySelectorAll('.cd-btn'));
  function box(k){ return boxes.filter(function(x){ return x.dataset.k===k; })[0]; }
  /* [位置:phone-cards.js·blocks/need] [输入框有内容即可发送] [10-31：原逻辑要卡片里所有必填 choice 选完发送键才亮，含输入框的卡光打字发不出去；改成任一输入框有内容就直接放行（没选的 choice 不随卡回传），输入框空着时仍按原规则必填 choice 选完才能发] [注释时间 2026-10-31] */
  function need(){
    if(bl.some(function(b){ return b.k==='input'&&vals[b.__k]; })) return true;
    return bl.every(function(b){ return b.k!=='choice'||b.opt||(vals[b.__k]&&vals[b.__k].length); });
  }
  function sync(){ var ok=need(); btns.forEach(function(x){ if(!x.classList.contains('alt')) x.disabled=!ok; }); }
  function label(b){ return b.q||b.t||b.__k; }
  /* [位置:phone-cards.js·blocks/summary] [回执摘要按块 id 一一对应，题目不再重抄] [11-06：发给 AI 的回执只要「q1：答案；q2：答案；extra：补充」，键就是卡片里那些块 id（AI 自己写的，天然对得上），题目不重复一遍；旧版是「题目：答案」，再在标签里跟一段 {"vals":…} 的 JSON，同一份内容说了两遍。choice 仍给选项全文（多选用、连）、滑杆带 /max、输入框给全文；按钮文字仍按原规则前置（没有其它答案、或卡里多个按钮时才需要说清是哪个按钮）] [注释时间 2026-11-06] */
  function summary(action){
    var out=[];
    bl.forEach(function(b){ var v=vals[b.__k]; if(v==null||v===''||(Array.isArray(v)&&!v.length)) return;
      if(b.k==='choice'){ var tx=(b.opts||[]).filter(function(o){ return v.indexOf(String(o.k||o.t))>=0; }).map(function(o){ return o.t; }); out.push(b.__k+'：'+tx.join('、')); }
      else if(b.k==='slider') out.push(b.__k+'：'+v+(b.max!=null?'/'+b.max:''));
      else if(b.k==='button') return;                 /* 按钮不是回答项 */
      else out.push(b.__k+'：'+v); });
    if(action&&action.t&&(!out.length||bl.filter(function(b){ return b.k==='button'; }).length>1)) out.unshift('「'+action.t+'」');
    return out.join('；')||'好';
  }
  function lock(note){ el.classList.add('locked'); Array.prototype.forEach.call(el.querySelectorAll('input,textarea,button'),function(x){ x.disabled=true; }); foot(el,note||'已发给他'); }
  function restore(v){
    boxes.forEach(function(x){ var k=x.dataset.k, t=x.dataset.t, val=v[k]; if(val==null) return;
      if(t==='choice') Array.prototype.forEach.call(x.querySelectorAll('.cd-opt'),function(o){ o.classList.toggle('on',val.indexOf(o.dataset.v)>=0); });
      else if(t==='slider'){ x.querySelector('input').value=val; x.querySelector('b').textContent=val; fillSl(x.querySelector('input')); }
      else{ var f=x.querySelector('input,textarea'); f.value=val; growIn(f); } });
  }
  boxes.forEach(function(x){
    var k=x.dataset.k, t=x.dataset.t, b=bl.filter(function(y){ return y.__k===k; })[0];
    if(t==='choice'){
      Array.prototype.forEach.call(x.querySelectorAll('.cd-opt'),function(o){ o.addEventListener('click',function(){
        if(el.classList.contains('locked')) return; buzz(8); var v=vals[k]||(vals[k]=[]), key=o.dataset.v, i=v.indexOf(key);
        if(b.multi){ if(i>=0) v.splice(i,1); else v.push(key); o.classList.toggle('on',i<0); }
        else{ vals[k]=[key]; Array.prototype.forEach.call(x.querySelectorAll('.cd-opt'),function(y){ y.classList.toggle('on',y===o); }); }
        sync(); if(auto) submit(null);
      }); });
    }else if(t==='slider'){
      var r=x.querySelector('input'), o2=x.querySelector('b'); vals[k]=+r.value; fillSl(r);
      r.addEventListener('input',function(){ vals[k]=+r.value; o2.textContent=r.value; fillSl(r); });
      r.addEventListener('change',function(){ buzz(5); });
    }else{ var f=x.querySelector('input,textarea'); f.addEventListener('input',function(){ vals[k]=f.value.trim(); sync(); growIn(f); }); growIn(f); }   /* 10-31 配套：输入框内容实时驱动发送键亮灭；textarea 随内容自动长高 */
  });
  function submit(action){
    if(el.classList.contains('locked')||!need()) return;
    var text=summary(action), res={vals:JSON.parse(JSON.stringify(vals))}; if(action&&action.v!=null) res.action=action.v; else if(action) res.action=action.t;
    lock(); buzz(12); finish(spec,ctx,{value:res,text:text});
  }
  btns.forEach(function(x){ x.addEventListener('click',function(){ var i=+x.dataset.i; submit(i>=0?bl[i]:null); }); });
  sync();
  if(saved){ vals=saved; restore(saved); lock('已发给他'); }
}

/* ---------- 棋盘（围棋 / 五子棋） ----------
   [位置:phone-cards.js·board/bd*] [棋盘卡：棋局和规则全在前端，AI 只报自己的一手]
   [11-22：AI 不记盘面、不算提子。分工——
     ① AI：开局发一张 {"id","type":"board","mode","size","ai"}，之后每手只发 {"id","type":"board","move":"D4"}（或 pass / resign）；
     ② 前端：从消息历史里摘出这一局的事件（AI 的 move 卡 + 我的 card_reply），逐手回放出盘面——提子/禁入/劫/五连都在这里判；
     ③ 我落子后的回执 <card_reply id type="board" move="E5" next="W" … board="9 …/8 …">：board 是前端算好的「提子后真实盘面」，
        AI 想下一手直接看它，不用自己推演；它也是存档点——历史只加载了最近一段时，回放从最近一个回执起算，不依赖更早的消息；
     ④ AI 下了非法的一手（有子/自杀/劫/没轮到）：前端忽略这手、卡上提示，我点「请他重下」，回执带 err 让 AI 改。
   坐标：列字母 A 起连续（不跳 I），行号 1 在最下（下面的 bdCoord）。盘面编码：自上而下每行「行号 空格 棋子」用 / 连接。
   只做简单劫；不做超级劫、不数目（数目由 AI 与我口头确认，AI 可在卡上写 "over":"黑胜 3.5 目" 把棋盘锁住）] [注释时间 2026-11-22] */
var BDID=0, BDSENT={};
function bdSide(c){ return c==='B'?'黑':'白'; }
function bdCoord(S,r,c){ return String.fromCharCode(65+c)+(S.size-r); }
function bdIdx(S,i){ return bdCoord(S,(i/S.size)|0,i%S.size); }
function bdQ(s){ return String(s==null?'':s).replace(/["<>\n]/g,' ').slice(0,60); }
function bdParse(S,s){   /* → [r,c] | 'pass' | 'resign' | null */
  s=String(s==null?'':s).trim(); var l=s.toLowerCase();
  if(l==='pass'||s==='虚着') return 'pass';
  if(l==='resign'||s==='认输') return 'resign';
  var m=/^([a-z])\s*(\d{1,2})$/i.exec(s); if(!m) return null;
  var c=m[1].toUpperCase().charCodeAt(0)-65, r=S.size-(+m[2]);
  return (c>=0&&c<S.size&&r>=0&&r<S.size)?[r,c]:null;
}
function bdNew(mode,size,ai){
  mode=mode==='gomoku'?'gomoku':'go';
  size=Math.max(5,Math.min(19,Math.round(+size)||(mode==='gomoku'?15:9)));
  var g=[],i; for(i=0;i<size*size;i++) g.push('.');
  return {mode:mode,size:size,ai:ai==='B'?'B':'W',g:g,turn:'B',n:0,last:null,ko:null,ps:0,cap:{B:0,W:0},over:'',bad:''};
}
function bdClone(S){ var o={},k; for(k in S) o[k]=S[k]; o.g=S.g.slice(); o.cap={B:S.cap.B,W:S.cap.W}; o.ko=S.ko?S.ko.slice():null; o.last=S.last?S.last.slice():null; return o; }
function bdNb(S,i){ var n=S.size, r=(i/n)|0, c=i%n, o=[]; if(r>0) o.push(i-n); if(r<n-1) o.push(i+n); if(c>0) o.push(i-1); if(c<n-1) o.push(i+1); return o; }
function bdGroup(S,i){   /* 连通同色块 + 它的气数 */
  var col=S.g[i], seen={}, libs={}, st=[i], stones=[], nl=0; seen[i]=1;
  while(st.length){ var x=st.pop(); stones.push(x);
    bdNb(S,x).forEach(function(y){ if(S.g[y]==='.'){ if(!libs[y]){ libs[y]=1; nl++; } } else if(S.g[y]===col&&!seen[y]){ seen[y]=1; st.push(y); } }); }
  return {stones:stones,libs:nl};
}
function bdWin(S,i,color){
  var n=S.size, r=(i/n)|0, c=i%n;
  return [[0,1],[1,0],[1,1],[1,-1]].some(function(d){ var k=1,s,rr,cc;
    for(s=-1;s<=1;s+=2){ rr=r+d[0]*s; cc=c+d[1]*s; while(rr>=0&&rr<n&&cc>=0&&cc<n&&S.g[rr*n+cc]===color){ k++; rr+=d[0]*s; cc+=d[1]*s; } }
    return k>=5; });
}
/* 走一手：成功 → {ok:true,cap:[被提坐标]}，S 被改；失败 → {ok:false,why}，S 不动。mv = [r,c] | 'pass' | 'resign' */
function bdPlay(S,color,mv){
  if(S.over) return {ok:false,why:'对局已经结束了'};
  if(color!==S.turn) return {ok:false,why:'还没轮到'+bdSide(color)+'棋'};
  var opp=color==='B'?'W':'B', n=S.size;
  if(mv==='resign'){ S.over=bdSide(color)+'棋认输，'+bdSide(opp)+'棋胜'; S.n++; return {ok:true,cap:[]}; }
  if(mv==='pass'){
    if(S.mode==='gomoku') return {ok:false,why:'五子棋没有虚着'};
    S.ps++; S.n++; S.turn=opp; S.last=null; S.ko=null;
    if(S.ps>=2) S.over='双方连续虚着，对局结束，等数目';
    return {ok:true,cap:[]};
  }
  var r=mv[0], c=mv[1], i=r*n+c;
  if(S.g[i]!=='.') return {ok:false,why:bdCoord(S,r,c)+' 已经有子'};
  if(S.mode==='gomoku'){
    S.g[i]=color; S.last=[r,c]; S.n++; S.turn=opp;
    if(bdWin(S,i,color)) S.over=bdSide(color)+'棋五连，'+bdSide(color)+'胜';
    else if(S.g.indexOf('.')<0) S.over='棋盘下满，和棋';
    return {ok:true,cap:[]};
  }
  if(S.ko&&S.ko[0]===r&&S.ko[1]===c) return {ok:false,why:bdCoord(S,r,c)+' 是劫，不能马上提回，先下别处'};
  var save=S.g.slice(), cap=[]; S.g[i]=color;
  bdNb(S,i).forEach(function(y){ if(S.g[y]===opp){ var gp=bdGroup(S,y); if(!gp.libs) gp.stones.forEach(function(s){ S.g[s]='.'; cap.push(s); }); } });
  var own=bdGroup(S,i);
  if(!own.libs){ S.g=save; return {ok:false,why:bdCoord(S,r,c)+' 没有气（自杀）'}; }
  S.ko=(cap.length===1&&own.stones.length===1&&own.libs===1)?[(cap[0]/n)|0,cap[0]%n]:null;
  S.cap[color]+=cap.length; S.last=[r,c]; S.n++; S.ps=0; S.turn=opp;
  return {ok:true,cap:cap.map(function(s){ return bdIdx(S,s); })};
}
/* 盘面 ⇄ 字符串：自上而下，每行「行号 棋子」，行之间 / */
function bdEnc(S){ var n=S.size, rows=[], r; for(r=0;r<n;r++) rows.push((n-r)+' '+S.g.slice(r*n,r*n+n).join('')); return rows.join('/'); }
function bdDec(s){
  var rows=String(s||'').split('/'), n=rows.length, g=[], i, m;
  for(i=0;i<n;i++){ m=/^\s*\d+\s+([.BW]+)\s*$/.exec(rows[i]); if(!m||m[1].length!==n) return null; g=g.concat(m[1].split('')); }
  return {size:n,g:g};
}
/* 我的回执 → 存档点（回执里的 board 是前端算好的真实盘面，直接信它） */
function bdFromAttr(u,prev){
  var d=bdDec(u.board); if(!d) return prev;
  var S=bdNew(u.mode||(prev&&prev.mode),d.size,u.ai||(prev&&prev.ai)); if(S.size!==d.size) return prev;
  S.g=d.g; S.n=+u.n||0; S.ps=+u.ps||0; S.over=u.over||'';
  if(u.caps){ var p=u.caps.split(','); S.cap={B:+p[0]||0,W:+p[1]||0}; }
  var k=u.ko?bdParse(S,u.ko):null; if(k&&k.length) S.ko=k;
  var m=u.move?bdParse(S,u.move):null; S.last=(m&&m.length)?m:((prev&&!u.move&&prev.size===S.size)?prev.last:null);
  S.turn=(u.next==='B'||u.next==='W')?u.next:S.ai;
  return S;
}
/* 事件流 → 每个事件之后的盘面快照。feed 项：{raw,card}（AI 的卡）或 {raw,u}（我的回执属性） */
function bdReplay(feed){
  var S=null, out=[];
  feed.forEach(function(e){
    if(e.u){ if(e.u.board) S=bdFromAttr(e.u,S)||S; if(S) S.bad=''; }
    else{
      var c=e.card||{};
      if(c.mode&&c.size&&(!S||S.over||S.n===0)) S=bdNew(c.mode,c.size,c.ai);   /* 开局卡只在没有棋局/已结束/还没下过时生效：他忘了重发开局卡也不会把棋盘清掉 */
      if(S){
        S.bad='';
        if(c.move!=null&&c.move!==''){
          var mv=bdParse(S,c.move);
          if(!mv) S.bad='他给的落点「'+bdQ(c.move).slice(0,8)+'」我看不懂';
          else{ var r=bdPlay(S,S.ai,mv); if(!r.ok) S.bad='他下的 '+bdQ(c.move).slice(0,8)+' 不行：'+r.why; }
        }
        if(c.over) S.over=bdQ(c.over);
      }
    }
    out.push(S?bdClone(S):null);
  });
  return out;
}
function bdGeo(n){ var u=20, fs=Math.round(86*((n-1)*u+32)/270)/10, pad=Math.max(16,Math.round(fs*1.55)); return {u:u,fs:fs,pad:pad,W:(n-1)*u+pad*2}; }
function bdSVG(S,pv,uc,wid){
  var n=S.size, G=bdGeo(n), u=G.u, pad=G.pad, W=G.W, a=pad, b=pad+(n-1)*u, i, r, c, h='', d='', p;
  h+='<svg class="bd-svg" viewBox="0 0 '+W+' '+W+'" role="img" aria-label="棋盘">'+
    '<defs><radialGradient id="'+wid+'k" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#6b6a68"/><stop offset="1" stop-color="#141414"/></radialGradient>'+
    '<radialGradient id="'+wid+'w" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d8d3c9"/></radialGradient></defs>'+
    '<rect class="bd-wood" width="'+W+'" height="'+W+'" rx="7"/>';
  for(i=0;i<n;i++){ p=pad+i*u; d+='M'+a+' '+p+'H'+b+'M'+p+' '+a+'V'+b; }
  h+='<path class="bd-ln" d="'+d+'"/>';
  var lo=n>=13?3:2, hi=n-1-lo, mid=(n-1)/2, stars=[];
  if(n>=9){ stars=[[lo,lo],[lo,hi],[hi,lo],[hi,hi]]; if(mid===Math.floor(mid)){ stars.push([mid,mid]); if(S.mode==='go'&&n>=13) stars.push([lo,mid],[hi,mid],[mid,lo],[mid,hi]); } }
  else if(mid===Math.floor(mid)) stars=[[mid,mid]];
  stars.forEach(function(s){ h+='<circle class="bd-star" cx="'+(pad+s[1]*u)+'" cy="'+(pad+s[0]*u)+'" r="'+(u*.11)+'"/>'; });
  for(c=0;c<n;c++) h+='<text class="bd-lb" x="'+(pad+c*u)+'" y="'+(b+pad*.5+G.fs*.35)+'" font-size="'+G.fs+'">'+String.fromCharCode(65+c)+'</text>';
  for(r=0;r<n;r++) h+='<text class="bd-lb" x="'+(pad*.5)+'" y="'+(pad+r*u+G.fs*.35)+'" font-size="'+G.fs+'">'+(n-r)+'</text>';
  var sr=u*.47;
  for(i=0;i<S.g.length;i++){ if(S.g[i]==='.') continue; r=(i/n)|0; c=i%n;
    h+='<circle class="bd-sh" cx="'+(pad+c*u+.5)+'" cy="'+(pad+r*u+.9)+'" r="'+sr+'"/><circle class="bd-s" cx="'+(pad+c*u)+'" cy="'+(pad+r*u)+'" r="'+sr+'" fill="url(#'+wid+(S.g[i]==='B'?'k':'w')+')"/>'; }
  if(S.last){ var lc=S.g[S.last[0]*n+S.last[1]]; if(lc!=='.') h+='<circle class="bd-mk '+(lc==='B'?'kb':'kw')+'" cx="'+(pad+S.last[1]*u)+'" cy="'+(pad+S.last[0]*u)+'" r="'+(u*.17)+'"/>'; }
  if(S.ko) h+='<rect class="bd-ko" x="'+(pad+S.ko[1]*u-u*.2)+'" y="'+(pad+S.ko[0]*u-u*.2)+'" width="'+(u*.4)+'" height="'+(u*.4)+'"/>';
  if(pv) h+='<circle class="bd-pv" cx="'+(pad+pv[1]*u)+'" cy="'+(pad+pv[0]*u)+'" r="'+sr+'" fill="url(#'+wid+(uc==='B'?'k':'w')+')"/>';
  return h+'</svg>';
}
function board(spec,el,ctx){
  var feed=(ctx.feed&&ctx.feed(spec.id))||[], sn=feed.__r||(feed.__r=bdReplay(feed)), idx=-1, i, S, latest;
  for(i=feed.length-1;i>=0;i--){ if(feed[i].raw===ctx.raw){ idx=i; break; } }
  if(idx>=0){ S=sn[idx]; latest=idx===feed.length-1; }
  else if(!feed.length){ S=bdReplay([{card:spec}])[0]; latest=true; }   /* 没有历史可查（单独渲染 / 演示）：照卡片自己画 */
  else{ S=sn[sn.length-1]; latest=false; }
  if(!S){ el.innerHTML=shell(spec,'<div class="bd-note on">这局棋前面几手在更早的记录里，往上翻到开局那条就能看到</div>'); return; }
  var key=spec.__sk||spec.id, sent=BDSENT[key], pend=false;
  if(sent&&latest&&sent.len===feed.length&&Date.now()-sent.t<120000){ S=sent.S; pend=true; }   /* 刚点了落子、回执还没进历史：先把我这一手画上，也防止重复点 */
  var uc=S.ai==='B'?'W':'B', mine=latest&&!pend&&!S.over&&S.turn===uc, pv=null, preCap=0, msg='', arm='', armT=0, wid='bd'+(++BDID);
  var sp=Object.assign({},spec,{label:spec.label||(S.mode==='gomoku'?'五子棋':'围棋')});
  el.innerHTML=shell(sp,'<div class="bd-wrap"></div><div class="bd-note"></div><div class="bd-bar"><span class="bd-st"></span><span class="bd-act"></span></div>');
  var wrap=el.querySelector('.bd-wrap'), note=el.querySelector('.bd-note'), st=el.querySelector('.bd-st'), act=el.querySelector('.bd-act');
  function btn(k,t,pri){ return '<button class="bd-b tap'+(pri?' pri':'')+'" data-k="'+k+'">'+t+'</button>'; }
  function capTx(){ return (S.mode==='go'&&(S.cap.B||S.cap.W))?' · 提子 黑'+S.cap.B+' 白'+S.cap.W:''; }
  function draw(){
    wrap.innerHTML=bdSVG(S,pv,uc,wid);
    var tx, bt='', nt=msg||(latest&&S.bad)||'';
    if(S.over) tx=S.over;
    else if(mine) tx=pv?('落在 '+bdCoord(S,pv[0],pv[1])+(preCap?'，提 '+preCap+' 子':'')):('轮到你 · 执'+bdSide(uc)+(S.n?' · 第'+(S.n+1)+'手':''));
    else if(pend) tx='已落子，等他回应…';
    else if(latest) tx='等他落子…';
    else tx=S.n?('第'+S.n+'手'+(S.last?' · '+bdCoord(S,S.last[0],S.last[1]):'')):'开局';
    st.textContent=tx+((pv||S.over)?'':capTx());
    note.textContent=nt; note.classList.toggle('on',!!nt);
    if(mine){
      if(pv) bt=btn('cancel','取消')+btn('ok','落子',1);
      else bt=(S.mode==='go'?btn('pass',arm==='pass'?'确认虚着':'虚着'):'')+btn('resign',arm==='resign'?'确认认输':'认输');
    }else if(latest&&!pend&&!S.over&&!(ctx.busy&&ctx.busy())) bt=btn('nudge',S.bad?'请他重下':'催他落子');
    act.innerHTML=bt;
  }
  function attrs(T,mv,cap,err){
    var a=' type="board" mode="'+T.mode+'" ai="'+T.ai+'"';
    if(mv) a+=' move="'+mv+'"';
    if(cap&&cap.length) a+=' captured="'+cap.join(',')+'"';
    a+=' next="'+T.turn+'" n="'+T.n+'"';
    if(T.ko) a+=' ko="'+bdCoord(T,T.ko[0],T.ko[1])+'"';
    if(T.cap.B||T.cap.W) a+=' caps="'+T.cap.B+','+T.cap.W+'"';
    if(T.ps) a+=' ps="'+T.ps+'"';
    if(T.over) a+=' over="'+bdQ(T.over)+'"';
    if(err) a+=' err="'+bdQ(err)+'"';
    return a+' board="'+bdEnc(T)+'"';
  }
  function out(T,mv,cap,body,err){
    if(ctx.online&&!ctx.online()){ msg='没连上后台，这手还没发出去'; arm=''; draw(); return; }
    BDSENT[key]={len:feed.length,S:T,t:Date.now()};
    pend=true; mine=false; S=T; pv=null; msg=''; arm=''; draw();
    finish(spec,ctx,{text:body,attr:attrs(T,mv,cap,err)});
  }
  function play(mv){   /* 我走一手：重新在当前盘面上走一遍，拿到提子后的新盘面 */
    var T=bdClone(S), r=bdPlay(T,uc,mv); if(!r.ok){ msg=r.why; pv=null; draw(); return; }
    var co=mv==='pass'?'pass':mv==='resign'?'resign':bdCoord(S,mv[0],mv[1]), body;
    if(mv==='pass') body='我选择虚着'; else if(mv==='resign') body='我认输了';
    else body='我落子在 '+co+(r.cap.length?'，提了 '+r.cap.length+' 子':'');
    if(T.over&&mv!=='resign') body+='（'+T.over+'）';
    out(T,co,r.cap,body,'');
  }
  wrap.addEventListener('click',function(e){
    if(!mine) return;
    var svg=wrap.firstChild, rc=svg.getBoundingClientRect(), G=bdGeo(S.size);
    var c=Math.round(((e.clientX-rc.left)/rc.width*G.W-G.pad)/G.u), r=Math.round(((e.clientY-rc.top)/rc.height*G.W-G.pad)/G.u);
    if(c<0||r<0||c>=S.size||r>=S.size) return;
    buzz(6); arm=''; msg='';
    var T=bdClone(S), res=bdPlay(T,uc,[r,c]);
    if(!res.ok){ pv=null; preCap=0; msg=res.why; } else { pv=[r,c]; preCap=res.cap.length; }
    draw();
  });
  act.addEventListener('click',function(e){
    var b=e.target.closest?e.target.closest('button'):null; if(!b) return; var k=b.dataset.k; buzz(8);
    if(k==='cancel'){ pv=null; msg=''; draw(); }
    else if(k==='ok'){ if(pv) play(pv); }
    else if(k==='pass'||k==='resign'){ if(arm===k){ play(k); } else { arm=k; clearTimeout(armT); armT=setTimeout(function(){ if(arm===k&&el.isConnected){ arm=''; draw(); } },3000); draw(); } }
    else if(k==='nudge'){ out(S,'',[],S.bad?'你刚才下的那手不行（'+S.bad+'），请重下一手':'轮到你落子了',S.bad||''); }
  });
  draw();
}

/* [位置:phone-cards.js·touch] [触碰互动卡片：AI 回递触感脉冲 + 捏捏软弹材质回应软垫与自然手势识别] [2026-11-23 升级：移除蓝线轨迹，改为凹陷压痕与弹簧阻尼回弹，补充捏/轻捏/揉捏动词] [注释时间 2026-11-23] */
var HAP={
  purr:{n:'轻颤',p:[12,35,12,35,18,45,12]},
  heartbeat:{n:'心跳',p:[35,90,22,260,35,90,22]},
  bounce:{n:'轻弹',p:[22,40,14]},
  warm:{n:'缓震',p:[45,60,45]}
};
function touch(spec,el,ctx){
  var zone=String(spec.zone||'随意').slice(0,12), hk=HAP[spec.haptic]?spec.haptic:'';
  var bar='<div class="ct-bar"><span class="ct-zone">'+esc(zone)+'</span>'+(hk?'<button class="ct-hap tap" type="button" data-hap="'+hk+'">感受一下 · '+HAP[hk].n+'</button>':'')+'</div>';
  el.innerHTML=shell(spec,bar+'<div class="ct-pad"><canvas></canvas><div class="ct-ph">在这里轻点、轻捏或揉捏回应</div></div><div class="ct-ft"><span class="ct-sum">等待触碰…</span><button class="ct-go tap" type="button">回摸</button></div>');
  var pad=el.querySelector('.ct-pad'), cv=pad.querySelector('canvas'), sumEl=el.querySelector('.ct-sum'), goB=el.querySelector('.ct-go'), hapB=el.querySelector('.ct-hap');
  var strokes=[], cur=null, lastVib=0, vibDist=0, holdT=null, deepT=null, raf=0;
  var W=0, H=0, accRgb=[125,156,207], isDarkInk=true;
  var sim={x:0,y:0,tx:0,ty:0,depth:0,target:0,vel:0,pressAt:0};
  var ripples=[], trails=[];
  function readRgb(prop,fb){
    try{
      var cs=getComputedStyle(pad), v=(cs.getPropertyValue(prop)||'').trim()||fb;
      var tmp=document.createElement('span'); tmp.style.color=v; tmp.style.display='none';
      pad.appendChild(tmp); var rgb=getComputedStyle(tmp).color; pad.removeChild(tmp);
      var m=/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgb||'');
      if(m) return [+m[1],+m[2],+m[3]];
    }catch(_){}
    return [125,156,207];
  }
  function rgba(rgb,a){ return 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+a.toFixed(3)+')'; }
  function fit(){
    var r=pad.getBoundingClientRect(), d=Math.min(2,window.devicePixelRatio||1);
    if(!r.width||!r.height) return;
    W=r.width; H=r.height;
    if(cv.width!==Math.round(W*d)||cv.height!==Math.round(H*d)){ cv.width=Math.round(W*d); cv.height=Math.round(H*d); }
    var c=cv.getContext('2d'); c.setTransform(d,0,0,d,0,0);
    accRgb=readRgb('--cd-acc','#7d9ccf');
    var inkRgb=readRgb('--cd-ink','');
    isDarkInk=(0.299*inkRgb[0]+0.587*inkRgb[1]+0.114*inkRgb[2])<145;
  }
  function addRipple(x,y,maxR,alpha,width){ ripples.push({x:x,y:y,r:8,maxR:maxR,a:alpha,w:width||2}); }
  function kickAnim(){ if(!raf) raf=requestAnimationFrame(tick); }
  function drawIndent(c,x,y,d,scale){
    if(d<=0.01) return;
    var baseR=(22+20*d)*(scale||1), shCol=isDarkInk?[24,32,48]:[6,10,18], hiCol=[255,255,255];
    var rim=c.createRadialGradient(x,y,baseR*0.66,x,y,baseR*1.36);
    rim.addColorStop(0,'rgba(255,255,255,0)');
    rim.addColorStop(0.55,rgba(hiCol,(isDarkInk?0.34:0.18)*d));
    rim.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle=rim; c.beginPath(); c.arc(x,y,baseR*1.36,0,Math.PI*2); c.fill();
    var pit=c.createRadialGradient(x-baseR*0.14,y-baseR*0.16,baseR*0.08,x,y,baseR);
    pit.addColorStop(0,rgba(shCol,(isDarkInk?0.22:0.34)*d));
    pit.addColorStop(0.58,rgba(accRgb,0.16*d));
    pit.addColorStop(1,'rgba(0,0,0,0)');
    c.fillStyle=pit; c.beginPath(); c.arc(x,y,baseR,0,Math.PI*2); c.fill();
    var glow=c.createRadialGradient(x+baseR*0.18,y+baseR*0.2,0,x+baseR*0.1,y+baseR*0.14,baseR*0.74);
    glow.addColorStop(0,rgba(hiCol,(isDarkInk?0.4:0.22)*d));
    glow.addColorStop(0.6,rgba(accRgb,0.14*d));
    glow.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle=glow; c.beginPath(); c.arc(x+baseR*0.1,y+baseR*0.14,baseR*0.74,0,Math.PI*2); c.fill();
  }
  function tick(){
    raf=0; if(!pad.isConnected) return;
    var c=cv.getContext('2d'); c.clearRect(0,0,W,H);
    var k=cur?0.22:0.18, damp=cur?0.68:0.72;
    if(cur){
      sim.target=Math.min(1.16,0.68+Math.min(0.44,(Date.now()-sim.pressAt)/1100*0.44));
      sim.x+=(sim.tx-sim.x)*0.34; sim.y+=(sim.ty-sim.y)*0.34;
    } else { sim.target=0; }
    sim.vel=(sim.vel+(sim.target-sim.depth)*k)*damp;
    sim.depth+=sim.vel;
    if(!cur&&Math.abs(sim.depth)<0.008&&Math.abs(sim.vel)<0.006){ sim.depth=0; sim.vel=0; }
    var sq=Math.max(-0.025,Math.min(0.052,sim.depth*0.034));
    var sx=1+sq*0.52, sy=1-sq*0.82;
    var shX=cur?Math.max(-3,Math.min(3,(sim.x-W/2)/(W||1)*5)):0;
    var shY=cur?Math.max(-2,Math.min(2,(sim.y-H/2)/(H||1)*4)):0;
    pad.style.transform=(Math.abs(sim.depth)>0.005||cur)?('translate3d('+shX.toFixed(2)+'px,'+shY.toFixed(2)+'px,0) scale('+sx.toFixed(4)+','+sy.toFixed(4)+')'):'';
    for(var i=trails.length-1;i>=0;i--){
      var tr=trails[i]; tr.d*=0.84;
      if(tr.d<0.025){ trails.splice(i,1); continue; }
      drawIndent(c,tr.x,tr.y,tr.d*0.6,0.75);
    }
    if(sim.depth>0.01) drawIndent(c,sim.x,sim.y,Math.max(0,sim.depth),1);
    for(var j=ripples.length-1;j>=0;j--){
      var rp=ripples[j]; rp.r+=(rp.maxR-rp.r)*0.14+1.1; rp.a*=0.9;
      if(rp.a<0.015||rp.r>=rp.maxR){ ripples.splice(j,1); continue; }
      c.strokeStyle=rgba(accRgb,rp.a); c.lineWidth=rp.w*(rp.a/0.34);
      c.beginPath(); c.arc(rp.x,rp.y,rp.r,0,Math.PI*2); c.stroke();
    }
    if(cur||Math.abs(sim.depth)>0.006||Math.abs(sim.vel)>0.005||ripples.length||trails.length) raf=requestAnimationFrame(tick);
  }
  function classifyStroke(s){
    var d=Math.max(60,s.t1-s.t0), sec=d/1000, dist=s.dist||0, turns=s.turns||0, dx=s.dx||0, dy=s.dy||0;
    var spd=dist/(sec||0.1), speed=spd<85?'轻慢':(spd>230?'急促':'柔和');
    var kind, gest, dir;
    if(dist<16){
      dir='原地';
      if(d>=900){ kind='hold'; gest='长按捏'; }
      else if(d>=420){ kind='pinch'; gest='轻捏'; }
      else { kind='tap'; gest='轻点'; }
    } else if(dist<85&&(d>=360||turns>=1)){
      dir=turns>=2?'画圈':'原地';
      if(turns>=2){ kind='knead'; gest='揉捏'; }
      else { kind='pinch'; gest='轻捏'; }
    } else {
      dir=turns>=2?'画圈':(Math.abs(dx)>Math.abs(dy)?(dx>0?'向右':'向左'):(dy>0?'向下':'向上'));
      if(turns>=2){ kind=spd>210?'rub':'knead'; gest=spd>210?'揉搓':'揉捏'; }
      else if(Math.abs(dy)>Math.abs(dx)*1.3){ kind='stroke_v'; gest='顺摸'; }
      else { kind='stroke_h'; gest='轻抚'; }
    }
    return {kind:kind,gest:gest,dir:dir,speed:speed,durMs:d,dist:dist,turns:turns};
  }
  function summarize(){
    if(!strokes.length) return null;
    /* 逐笔直接输出「动作+时间」（<0.5秒的短动作如轻点/轻拍不写时间）；仅连续轻点合并成「轻拍N下」 */
    var groups=[];
    strokes.forEach(function(s){
      var c=classifyStroke(s), prev=groups[groups.length-1];
      if(c.kind==='tap'&&prev&&prev.kind==='tap'){
        prev.count++; prev.durMs+=c.durMs;
      } else {
        groups.push({kind:c.kind,gest:c.gest,dir:c.dir,speed:c.speed,durMs:c.durMs,dist:c.dist,turns:c.turns,count:1});
      }
    });
    var totMs=0, totCnt=0, acts=[];
    groups.forEach(function(g){
      totMs+=g.durMs; totCnt+=g.count;
      var sec=(g.durMs/1000).toFixed(1), showSec=g.durMs>=500;
      var gest=(g.kind==='tap'&&g.count>=2)?'轻拍':g.gest;
      var dirTag=(g.dir&&g.dir!=='原地')?g.dir:'';
      var label;
      if(g.kind==='tap'){
        label=g.count>=2?('轻拍'+g.count+'下'):'轻点';
      } else if(g.kind==='hold'||g.kind==='pinch'){
        label=gest+(showSec?(sec+'秒'):'');
      } else {
        label=g.speed+dirTag+gest+(showSec?(sec+'秒'):'');
      }
      acts.push({gesture:gest,dir:g.dir,speed:g.speed,label:label});
    });
    var totSec=(totMs/1000).toFixed(1);
    var joined=acts.map(function(a){ return a.label; }).join('、');
    var shortDesc=zone+'·'+joined;
    var txt='在「'+zone+'」'+joined;
    return {
      zone:zone,
      gesture:acts.map(function(a){ return a.gesture; }).join('+'),
      duration:totSec+'s',
      speed:acts[acts.length-1].speed,
      count:totCnt,
      dir:acts.map(function(a){ return a.dir; }).join('+'),
      steps:shortDesc,
      summary:shortDesc,
      text:txt
    };
  }
  function upd(){ var s=summarize(); sumEl.textContent=s?s.summary:'等待触碰…'; goB.classList.toggle('ready',!!s); }
  if(hapB) hapB.addEventListener('click',function(){ var h=HAP[hk]; if(!h) return; buzz(h.p); hapB.classList.remove('pulse'); void hapB.offsetWidth; hapB.classList.add('pulse'); });
  pad.addEventListener('pointerdown',function(e){
    fit(); var r=pad.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
    pad.classList.add('down','has'); try{ pad.setPointerCapture(e.pointerId); }catch(_){}
    cur={t0:Date.now(),t1:Date.now(),lx:x,ly:y,x0:x,y0:y,dist:0,dx:0,dy:0,turns:0,angSum:0,lastAng:null};
    sim.x=sim.tx=x; sim.y=sim.ty=y; sim.pressAt=cur.t0; sim.vel+=0.26;
    addRipple(x,y,44,0.32,2); vibDist=0; buzz(10); kickAnim();
    clearTimeout(holdT); clearTimeout(deepT);
    holdT=setTimeout(function(){ if(cur&&cur.dist<24){ addRipple(sim.x,sim.y,62,0.28,2.4); buzz([14,26,16]); kickAnim(); } },450);
    deepT=setTimeout(function(){ if(cur&&cur.dist<32){ addRipple(sim.x,sim.y,78,0.24,2.6); buzz([18,30,14]); kickAnim(); } },1050);
  });
  pad.addEventListener('pointermove',function(e){
    if(!cur) return;
    var r=pad.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, ddx=x-cur.lx, ddy=y-cur.ly, step=Math.hypot(ddx,ddy);
    if(step<1.5) return;
    sim.tx=x; sim.ty=y;
    if(trails.length<10) trails.push({x:cur.lx,y:cur.ly,d:Math.min(0.8,sim.depth)});
    var ang=Math.atan2(ddy,ddx), turned=false;
    if(step>=3.5){
      if(cur.lastAng!=null){
        var da=Math.abs(ang-cur.lastAng); if(da>Math.PI) da=Math.PI*2-da;
        cur.angSum+=da;
        if(cur.angSum>=1.75){ cur.turns++; cur.angSum=0; turned=true; }
      }
      cur.lastAng=ang;
    }
    cur.dist+=step; cur.dx=x-cur.x0; cur.dy=y-cur.y0; cur.lx=x; cur.ly=y; cur.t1=Date.now();
    vibDist+=step;
    if(turned&&Date.now()-lastVib>=65){ buzz(9); addRipple(x,y,36,0.22,1.6); lastVib=Date.now(); }
    else if(vibDist>=26&&Date.now()-lastVib>=48){ buzz(6); vibDist=0; lastVib=Date.now(); }
    kickAnim();
  });
  function end(){
    if(!cur) return;
    clearTimeout(holdT); clearTimeout(deepT);
    cur.t1=Date.now(); var dur=cur.t1-cur.t0;
    strokes.push(cur); cur=null; pad.classList.remove('down');
    sim.vel-=0.3; addRipple(sim.x,sim.y,dur>=450?68:48,0.24,1.6);
    buzz(dur>=450?[8,20,5]:4); kickAnim(); upd();
  }
  pad.addEventListener('pointerup',end); pad.addEventListener('pointercancel',end);
  goB.addEventListener('click',function(){
    var s=summarize(); if(!s) return;
    var attr=' type="touch" zone="'+esc(s.zone)+'" gesture="'+esc(s.gesture)+'" duration="'+s.duration+'" speed="'+esc(s.speed)+'" count="'+s.count+'" dir="'+esc(s.dir)+'" steps="'+esc(s.steps)+'"';
    finish(spec,ctx,{text:s.text,attr:attr});
    strokes=[]; pad.classList.remove('has'); ripples=[]; trails=[]; sim.depth=0; sim.vel=0; pad.style.transform='';
    var c=cv.getContext('2d'); c.clearRect(0,0,cv.width,cv.height); upd(); buzz([12,24,12]);
  });
}

var BUILD={choice:choice,mood:mood,fortune:fortune,rps:rps,checklist:checklist,blocks:blocks,board:board,touch:touch};

P.cards={
  types:LABEL,
  bd:{create:bdNew,play:bdPlay,parse:bdParse,replay:bdReplay,enc:bdEnc,dec:bdDec,svg:bdSVG,coord:bdCoord},   /* 棋盘规则（测试/调试用） */
  scope:scope,
  icon:function(t){ return IC[t]||''; },
  render:function(spec,ctx){
    /* [位置:phone-cards.js·render 取状态键] [卡片状态按会话隔离] [渲染时把 会话id|卡片id 定死在 spec.__sk 上，读和写都用它，避免渲染与点击之间 NS 被别的窗口改掉] [注释时间 2026-10-29] */
    var el=document.createElement('div'); el.className='card cd-'+spec.type; if(spec.id){ el.dataset.id=spec.id; spec.__sk=SK(spec.id); }
    if(!BUILD[spec.type]){ el.textContent='（这张卡片还不认识：'+spec.type+'）'; return el; }
    BUILD[spec.type](spec,el,ctx||{}); return el;
  },
  parse:function(text){
    var m=/\[\[card:(\{[\s\S]*?\})\]\]/.exec(text||''); if(!m) return {text:text,card:null};
    var card=null; try{ card=JSON.parse(m[1]); }catch(e){}
    return {text:(text.slice(0,m.index)+text.slice(m.index+m[0].length)).trim(),card:card&&BUILD[card.type]?card:null};
  },
  /* 演示用：几张现成的卡片，以及什么话会引出什么卡 */
  demo:function(type){
    var id='demo-'+type+'-'+Date.now().toString(36);
    return {
      choice:{id:id,type:'choice',q:'今晚想吃什么？',opts:[{t:'火锅'},{t:'热汤面'},{t:'寿司'},{t:'你做给我吃'}]},
      mood:{id:id,type:'mood',q:'今天心情怎么样？'},
      fortune:{id:id,type:'fortune',q:'来，抽一支今天的签'},
      rps:{id:id,type:'rps',q:'陪我猜一局？'},
      checklist:{id:id,type:'checklist',q:'今天的小事',items:[{t:'吃一顿像样的早饭'},{t:'喝够八杯水'},{t:'十点前把手机放远'},{t:'和我说一句晚安'}]},
      board:{id:id,type:'board',mode:'go',size:9,ai:'W'},
      touch:{id:id,type:'touch',zone:'头顶',haptic:'purr',q:'想摸一下吗？'},
      blocks:{id:id,type:'blocks',blocks:[{k:'title',t:'周末想怎么过？'},{k:'text',t:'我先列几个，你挑一个；精力打个分，我好安排。',s:1},{k:'choice',q:'想做什么',opts:[{t:'睡到自然醒',e:'🛏'},{t:'去看海',e:'🌊'},{t:'在家窝着看片',e:'🎬'}]},{k:'slider',q:'今天精力几分',min:0,max:10,def:6},{k:'input',ph:'还有别的想法写这里',multi:1},{k:'button',t:'发给他'}]}
    }[type];
  },
  fromText:function(t){
    if(/猜拳|游戏|无聊|玩/.test(t)) return {parts:['来，陪你玩一局。'],card:this.demo('rps')};
    if(/抽签|签|运势|运气/.test(t)) return {parts:['那就替你摇一支。'],card:this.demo('fortune')};
    if(/心情|难过|开心|烦|累|不舒服/.test(t)) return {parts:['我想知道你现在的样子。'],card:this.demo('mood')};
    if(/吃什么|选|纠结|还是/.test(t)) return {parts:['别纠结，我帮你列好了。'],card:this.demo('choice')};
    if(/清单|计划|待办|任务/.test(t)) return {parts:['我替你写了一张。'],card:this.demo('checklist')};
    if(/周末|安排|去哪/.test(t)) return {parts:['我替你排了个小卡片。'],card:this.demo('blocks')};
    return null;
  },
  /* 回答之后，聊天里替你说的那一句 / 他的回应 */
  said:function(res){
    if(res.type==='choice') return '我选：'+res.text;
    if(res.type==='mood') return '我现在：'+res.text;
    if(res.type==='blocks'||res.type==='board'||res.type==='touch') return res.text;
    return null;
  },
  answered:function(res){
    if(res.type==='choice') return ['好，就这个。','（记下来了）'];
    if(res.type==='mood') return ['谢谢你告诉我。'];
    if(res.type==='fortune') return ['这支签我替你收着了。'];
    if(res.type==='checklist'&&res.all) return ['全划掉了，厉害。'];
    if(res.type==='blocks') return ['收到，我看看。'];
    return null;
  }
};
})();
