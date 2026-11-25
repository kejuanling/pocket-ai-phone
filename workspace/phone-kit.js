/* 小手机 · 公共小工具：键盘避让、底部输入抽屉、抖一抖 */
(function(){
"use strict";
var P=window.PH, toast=P.toast, buzz=P.buzz;
P.esc=function(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
P.kb=function(fn){
  if(!window.visualViewport) return null;
  var f=function(){ fn(Math.max(0,innerHeight-visualViewport.height-visualViewport.offsetTop)); };
  visualViewport.addEventListener('resize',f); visualViewport.addEventListener('scroll',f);
  /* [位置:phone-kit.js·P.kb] [返回注销函数] [2026-10-27 审查：原来没有注销接口，弹层关掉后监听永远留在
     visualViewport 上、闭包钉住整层 DOM，键盘每次起落跑 N 个回调各写一次样式（用久了键盘一弹就卡）；
     返回值不接也不影响老调用方] [注释时间 2026-10-27] */
  return function(){ visualViewport.removeEventListener('resize',f); visualViewport.removeEventListener('scroll',f); };
};
/* 键盘弹起时整台手机挂上 .kbup：键盘已经盖住了底部的 home 条区域，
   输入栏 / 抽屉原来给 home 条留的那截底边距（safe-area + 20 多 px）就要收掉，不然和键盘之间空一大块 */
P.kb(function(kb){ P.D.classList.toggle('kbup',kb>60); });
/* [位置:phone-kit.js·P.imgShrink] [图片压缩] [10-28：与聊天附件 shrink 同款——GIF 原样透传（canvas 会打死动画）、非图透传，其他压到 max 边长输出 jpeg dataURL；小图直过不发重压] [注释时间 2026-10-28] */
P.imgShrink=function(fl,max){ return new Promise(function(res,rej){ var rd=new FileReader(); rd.onerror=rej; rd.onload=function(){
  if(/^image\/gif/.test(fl.type)){ res(rd.result); return; }
  if(!/^image\//.test(fl.type)){ res(rd.result); return; }
  var im=new Image(); im.onerror=function(){ res(rd.result); }; im.onload=function(){
    var k=Math.min(1,max/Math.max(im.width,im.height));
    if(k>=1&&fl.size<1.5e6){ res(rd.result); return; }
    var c=document.createElement('canvas'); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k);
    c.getContext('2d').drawImage(im,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',.86));
  }; im.src=rd.result; }; rd.readAsDataURL(fl); }); };
P.shake=function(el){ P.anim(el,[{transform:'translateX(0)'},{transform:'translateX(-8px)'},{transform:'translateX(7px)'},{transform:'translateX(-4px)'},{transform:'translateX(0)'}],{duration:320,fill:'none'}); };
P.sheet=function(win,o){
  var el=document.createElement('div'); el.className='sheetw';
  /* [位置:phone-kit.js·P.sheet 发表器九宫格] [可选图片附件] [10-28：朋友圈要能发图（可纯图）——o.images 时输入框下出九宫格：添加 / 上传中转圈 / 失败点图重试 / 单张移除，上限 9 张；只有传成功的 URL 交给 onSubmit(v,urls)，其他调用方不传 images 走原路] [注释时间 2026-10-28] */
  var IMGS=[], SEQ=0;
  var grid=o.images?'<div class="sh-grid"><div class="sh-gd"></div><button type="button" class="sh-add tap"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="1.6"/><path d="m5 18 4.5-4.5 3 3L17 12l4 4"/></svg><span>添加图片</span></button><input type="file" accept="image/*" multiple hidden></div>':'';
  el.innerHTML='<div class="scrim"></div><div class="sheet"><div class="grab2"></div>'+(o.title?'<div class="sh-t">'+P.esc(o.title)+'</div>':'')+
    '<textarea rows="4" placeholder="'+P.esc(o.ph||'')+'"></textarea>'+grid+'<div class="sh-row"><span class="sh-hint">'+P.esc(o.hint||'')+'</span><button class="sh-btn tap">'+P.esc(o.btn||'好')+'</button></div></div>';
  win.appendChild(el);
  var ta=el.querySelector('textarea'), sh=el.querySelector('.sheet');
  var gd=o.images?el.querySelector('.sh-gd'):null, fin=o.images?el.querySelector('input[type=file]'):null, addb=o.images?el.querySelector('.sh-add'):null;
  function gPaint(){
    gd.innerHTML=IMGS.map(function(a){
      var st=a.st==='err'?' err':a.st==='ready'?'':' busy';
      return '<div class="sh-it'+st+'" data-g="'+a.id+'">'+(a.thumb?'<img src="'+P.esc(a.thumb)+'" alt="">':'<i></i>')+'<button type="button" class="sx" data-gx="'+a.id+'" aria-label="移除">×</button></div>';
    }).join('');
    addb.hidden=IMGS.length>=9;
  }
  function up(a){
    var ext=/^data:image\/gif/.test(a.du)?'.gif':/^data:image\/png/.test(a.du)?'.png':/^data:image\/webp/.test(a.du)?'.webp':'.jpg';
    var bin=atob(a.du.split(',')[1]||''), arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    var fd=new FormData(); fd.append('file',new Blob([arr],{type:'image/'+ext.slice(1)}),'diary'+ext);
    a.st='busy'; gPaint();
    P.net.req('/diary/api/upload',{form:fd,timeout:120000}).then(function(r){
      if(!r||!r.url) throw new Error('没传上'); a.url=r.url; a.st='ready'; gPaint();
    },function(){ a.st='err'; gPaint(); toast('有张图没传上，点它重试'); buzz([20,30,20]); });
  }
  if(gd){
    gPaint();
    addb.addEventListener('click',function(){ fin.click(); });
    fin.addEventListener('change',function(){ Array.prototype.forEach.call(fin.files||[],function(fl){
      if(IMGS.length>=9){ return; }
      /* 后端 /diary/api/upload 上限 10MB；GIF 不压缩，超了直接拦 */
      if(/gif/i.test(fl.type||'')&&fl.size>10*1024*1024){ toast('这张动图超过 10MB，传不了'); return; }
      var a={id:++SEQ,st:'busy',thumb:'',url:'',du:''}; IMGS.push(a); gPaint();
      P.imgShrink(fl,1600).then(function(du){ a.du=du; a.thumb=du; up(a); },function(){ a.st='err'; gPaint(); });
    }); fin.value=''; });
    gd.addEventListener('click',function(e){
      var x=e.target.closest('[data-gx]');
      if(x){ IMGS=IMGS.filter(function(a){ return a.id!==+x.getAttribute('data-gx'); }); buzz(5); gPaint(); return; }
      var it=e.target.closest('.sh-it.err'); if(!it) return;
      var a=IMGS.filter(function(z){ return z.id===+it.getAttribute('data-g'); })[0];
      if(a&&a.du) up(a);
    });
  }
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('show'); }); setTimeout(function(){ try{ ta.focus(); }catch(_){} },320); });
  var closed=false, btn=el.querySelector('.sh-btn'), sending=false;
  /* [位置:phone-kit.js·P.sheet ESC] [键盘关发表器] [11-13 审查 P2-1：全站只有 3 处 Escape 处理，9 个用 P.sheet 的入口都只能精准点遮罩；这里补上 ESC 关闭，关闭时注销监听（避免多次开关叠监听、闭包钉住整层 DOM）；输入法组合中的 ESC 不响应] [注释时间 2026-11-14] */
  function onKey(e){ if(e.key!=='Escape'||e.isComposing) return; e.stopPropagation(); close(); }
  document.addEventListener('keydown',onKey,true);
  function close(){ if(closed) return; closed=true; sending=false; btn.disabled=true; document.removeEventListener('keydown',onKey,true); if(unkb) unkb(); el.classList.remove('show'); try{ ta.blur(); }catch(_){} sh.style.transform=''; sh.style.bottom=''; setTimeout(function(){ el.remove(); },420); }
  el.querySelector('.scrim').addEventListener('click',close);
  /* [位置:phone-kit.js·P.sheet 提交] [连点去重 + 失败保留内容] [11-13 审查：close() 后 420ms 淡出窗口内还能再点，onSubmit 会跑两遍（日记发两篇、待办落两条）；失败时内容随弹层消失。现在：提交瞬间 sending 置位 + 按钮禁用，closed 后一律不响应；onSubmit 返回 false = 本地校验没过（留在弹层），返回 Promise = 等结果，成功才关、失败恢复按钮并保留输入与已传图片；不返回 = 维持原有立即关闭行为] [注释时间 2026-11-13] */
  btn.addEventListener('click',function(){
    if(closed||sending) return;
    var v=ta.value.trim(), urls=null;
    if(gd){
      if(IMGS.some(function(a){ return a.st==='busy'; })){ toast('图片还在传，等一下'); P.shake(sh); return; }
      urls=IMGS.filter(function(a){ return a.st==='ready'&&a.url; }).map(function(a){ return a.url; });
      if(!v&&!urls.length){ P.shake(sh); return; }
    } else if(!v){ P.shake(sh); return; }
    sending=true; btn.disabled=true; btn.classList.add('busy');
    var ret;
    try{ ret=gd?o.onSubmit(v,urls):o.onSubmit(v); }
    catch(e){ sending=false; btn.disabled=false; btn.classList.remove('busy'); throw e; }
    if(ret===false){ sending=false; btn.disabled=false; btn.classList.remove('busy'); return; }
    if(ret&&typeof ret.then==='function'){
      ret.then(function(){ close(); },function(){ sending=false; btn.disabled=false; btn.classList.remove('busy'); P.shake(sh); });
      return;
    }
    close();
  });
  /* [位置:phone-kit.js·P.sheet 键盘避让] [发表器抬 bottom 不占 transform] [10-28：发表器接拉高后 transform 归拖动用，键盘避让改抬 bottom（skin 的 .kbup 规则被内联覆盖，行为不变）；短输入板保持原 transform 方式。10-31：两档化（自然高⇄满高），不记档] [注释时间 2026-10-28；2026-10-31 两档化] */
  var unkb=null;
  if(o.images){ if(P.kb) unkb=P.kb(function(kb){ if(closed) return; sh.style.bottom=kb>60?kb+'px':''; });
    if(P.sheetDrag) P.sheetDrag(sh,close); /* [位置:phone-kit.js·P.sheet 发表器] [去掉上拉满高] [11-02：写日记发表器不需要拉高，只留下拉关闭（legacy 分支）] [注释时间 2026-11-02] */ }
  else unkb=P.kb(function(kb){ if(!closed) sh.style.transform=kb?'translateY(-'+kb+'px)':''; });
  return {close:close};
};
/* 1024：图片加载失败全局兜底——破图统一换成占位小块（聊天表情包/图片、日记大图等所有 img 生效） */
document.addEventListener('error',function(e){
  var t=e.target; if(!t||t.tagName!=='IMG'||t.dataset.bk) return; t.dataset.bk='1';
  var ph=document.createElement('span'); ph.className='img-fallback'; ph.textContent=t.getAttribute('alt')||'图片没加载出来';
  t.replaceWith(ph);
},true);
})();

/* [位置:phone-kit.js·frontUpdate] [前端自动更新] [chat.html 同款移植（chat 2026-09-26 拍板：仅前台检测+避让中；2026-10-24 移植到小手机）：页面加载时与每次切回前台，HEAD /phone-new.html 比对 nginx ETag，HTML 更新过就记待刷；避让中不刷——AI 回复中（.tk-send.stop，phone-talk.js busyPaint）/ 录音中（.recording）/ 输入框有字（#tkTa）/ 通话中（#cpCall.ringing/.live），每 15 秒那一拍只负责「待刷且已空闲就 reload」。11-14 审查：原来只盯 HTML，改了 31 个 JS / 19 个 CSS 里任意一个而没 touch HTML，已打开页面永远跑旧代码；现在每次检查额外把页面实际加载的 script/link 全扫一遍 ETag（每批 6 个并发，一分钟内不重复扫），任何资产变了同样触发 reload，不再靠「改完顺手 touch HTML」这条口头约定] [注释时间 2026-10-24；2026-11-14 加资产指纹] */
(function(){
  "use strict";
  var etag0=null, pending=false, seen={}, assets=null;
  function busy(){
    try{
      if(document.querySelector('.tk-send.stop')) return true;
      if(document.querySelector('.recording')) return true;
      if(document.querySelector('#cpCall.ringing,#cpCall.live,.cp.ringing,.cp.live')) return true;
      var ta=document.getElementById('tkTa');
      if(ta&&ta.value&&ta.value.trim()) return true;
    }catch(e){}
    return false;
  }
  /* [位置:phone-kit.js·frontUpdate assetList] [要盯的静态资产清单] [从页面实际加载的 script/link 里取同源地址，只取一次；以后新增 JS/CSS 不用改这里] [注释时间 2026-11-14] */
  function assetList(){
    if(assets) return assets;
    try{
      var out=[];
      Array.prototype.forEach.call(document.querySelectorAll('script[src],link[rel="stylesheet"]'),function(el){
        var u=el.src||el.href||''; if(!u) return; if(u.indexOf(location.origin)!==0) return;
        if(out.indexOf(u)<0) out.push(u);
      });
      assets=out;
    }catch(e){ assets=[]; }
    return assets;
  }
  /* [位置:phone-kit.js·frontUpdate probeAsset] [资产指纹比对] [HEAD 取 ETag 与上一次比，变了就记待刷；首次只记基准不触发；失败/无 ETag 当未变（弱网不误刷）] [注释时间 2026-11-14] */
  function probeAsset(u){
    try{
      return fetch(u,{method:'HEAD',cache:'no-store'}).then(function(r){
        if(!r||!r.ok) return;
        var t=r.headers.get('etag'); if(!t) return;
        var old=seen[u]; seen[u]=t;
        if(old&&old!==t){ pending=true; tryReload(); }
      },function(){});
    }catch(e){}
  }
  /* [位置:phone-kit.js·frontUpdate sweep] [一次扫完全部资产] [每批 6 个并发、排完就撒，不阻塞页面也不一次性占满连接；一分钟内不重复扫] [注释时间 2026-11-14] */
  var sweeping=false, lastSweep=0;
  function sweep(){
    if(sweeping||Date.now()-lastSweep<60000) return;
    var list=assetList(); if(!list.length) return;
    sweeping=true; lastSweep=Date.now();
    var i=0;
    (function next(){
      if(i>=list.length){ sweeping=false; return; }
      var batch=list.slice(i,i+6); i+=6;
      Promise.all(batch.map(probeAsset)).then(next,next);
    })();
  }
  function check(){
    try{
      fetch('/phone-new.html?t='+Date.now(),{method:'HEAD',cache:'no-store'}).then(function(r){
        if(!r||!r.ok) return;
        var t=r.headers.get('etag');
        if(!etag0){ etag0=t; return; }
        if(t&&t!==etag0){ pending=true; tryReload(); }
      },function(){});
      sweep();
    }catch(e){}
  }
  /* [位置:phone-kit.js·frontUpdate swSync] [reload 前让 SW 先把静态缓存对齐] [11-19 加载提速 C4：SW 对 js/css 是 cache-first，若直接 reload，刷出来的页面还是 SW 缓存里的旧资产——「刷了还是旧的」。这里在 reload 前给 SW 发 ph-sync（它会把缓存条目全部协商换新），等到 ph-synced 再刷；SW 不在/没回执/15s 超时都直接刷（退化为旧行为，不卡刷新）] [注释时间 2026-11-19] */
  function swSync(){
    try{
      var nsw=navigator.serviceWorker;
      if(!nsw||!nsw.controller) return Promise.resolve();
      var ctl=nsw.controller;
      return new Promise(function(res){
        var done=0;
        function fin(){ if(done) return; done=1; clearTimeout(t); try{ nsw.removeEventListener('message',onMsg); }catch(e){} res(); }
        var t=setTimeout(fin,15000);
        function onMsg(e){ if(e.data&&e.data.type==='ph-synced') fin(); }
        nsw.addEventListener('message',onMsg);
        try{ ctl.postMessage({type:'ph-sync'}); }catch(e){ fin(); }
      });
    }catch(e){ return Promise.resolve(); }
  }
  /* [位置:phone-kit.js·frontUpdate 顶部进度条与原地恢复] [11-21：前端自动更新时不再弹回锁屏；重载前在顶部显示细进度条并把当前页面/会话存入 sessionStorage(ph_hot_reload)，重载后直接跳过锁屏、原地恢复刚才的页面并完成进度条收尾] [注释时间 2026-11-21] */
  function ensureProgBar(){
    var b=document.getElementById('phHotProg');
    if(b) return b;
    var st=document.getElementById('phHotProgCss');
    if(!st){
      st=document.createElement('style'); st.id='phHotProgCss';
      st.textContent='#phHotProg{position:fixed;left:0;right:0;top:0;height:3px;z-index:9999;pointer-events:none;opacity:1;transition:opacity .32s ease}'+
        '#phHotProg i{display:block;height:100%;width:0%;border-radius:0 2px 2px 0;background:linear-gradient(90deg,rgba(125,156,207,.65),var(--acc,#7d9ccf));transition:width .45s cubic-bezier(.2,.8,.2,1)}'+
        'html.min-layout #phHotProg i{background:#111111}'+
        'html.min-layout #device[data-theme="dark"] #phHotProg i{background:#e9e9e9}';
      document.head.appendChild(st);
    }
    b=document.createElement('div'); b.id='phHotProg'; b.innerHTML='<i></i>';
    (P.D||document.body).appendChild(b);
    return b;
  }
  function progStart(){
    try{
      var b=ensureProgBar(), bar=b.firstChild;
      b.style.opacity='1'; bar.style.width='18%';
      requestAnimationFrame(function(){ bar.style.width='76%'; });
    }catch(e){}
  }
  function progFinish(){
    try{
      var b=ensureProgBar(), bar=b.firstChild;
      b.style.opacity='1'; bar.style.transition='none'; bar.style.width='72%';
      void bar.offsetWidth;
      bar.style.transition='width .36s cubic-bezier(.2,.8,.2,1)';
      requestAnimationFrame(function(){
        bar.style.width='100%';
        setTimeout(function(){ b.style.opacity='0'; setTimeout(function(){ if(b.parentNode) b.parentNode.removeChild(b); },340); },220);
      });
    }catch(e){}
  }
  function saveHotState(){
    try{
      var lk=document.getElementById('lock');
      var unlocked=!lk||lk.style.display==='none'||lk.style.visibility==='hidden'||getComputedStyle(lk).visibility==='hidden'||getComputedStyle(lk).display==='none';
      var cw=P.curWin?P.curWin():null;
      var appId=(cw&&cw.dataset&&cw.dataset.win)||'';
      var sid=(P.talkCtx&&P.talkCtx.id)||'';
      var drawer=!!(P.minLayout&&P.minLayout.isDrawerOpen&&P.minLayout.isDrawerOpen());
      sessionStorage.setItem('ph_hot_reload',JSON.stringify({at:Date.now(),unlocked:unlocked,app:appId,sid:sid,drawer:drawer}));
    }catch(e){}
  }
  function tryReload(){
    if(pending&&!busy()){
      pending=false;
      progStart();
      saveHotState();
      swSync().then(function(){ location.reload(); });
    }
  }
  /* 重载后原地恢复页面并收尾进度条 */
  window.addEventListener('load',function(){
    var st=window.__phHotRestore;
    if(!st) return;
    progFinish();
    if(!st.unlocked) return;
    setTimeout(function(){
      try{
        var isMin=!!(P.minLayout&&P.minLayout.on);
        if(isMin){
          if(st.app&&st.app!=='chats'&&P.open){
            P.open(st.app,null,{instant:true});
          }else if(st.drawer&&P.minLayout.openDrawer){
            P.minLayout.openDrawer();
          }
        }else if(!document.documentElement.classList.contains('wide')){
          if(st.app&&P.open){
            var ic=document.querySelector('[data-app="'+st.app+'"] .sq');
            P.open(st.app,ic||null,{instant:true});
            if(st.app==='chats'&&st.sid){
              setTimeout(function(){ if(P.chats&&P.chats.switchTo) P.chats.switchTo(st.sid); },120);
            }
          }
        }
      }catch(e){}
    },40);
  });
  check();
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) check(); });
  /* [2026-11-01：后台不偷跑——SW 更新检查只在可见时做，15s 一拍；后台切回来由 visibilitychange 的 check 补上] */
  setInterval(function(){ if(document.hidden) return; tryReload(); },15000);
  /* [位置:phone-kit.js·frontUpdate SW 注册] [页面加载即注册 /sw.js] [11-19 加载提速 C4：原来只有开「网页推送」时才注册（设置页 subscribe），没开推送的设备没有 SW、静态缓存不生效；register 幂等（已注册返回原注册），顺带触发一次 SW 自身更新检查。加载完再注册，不抢首屏] [注释时间 2026-11-19] */
  try{
    if('serviceWorker' in navigator){
      window.addEventListener('load',function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
    }
  }catch(e){}
})();

/* ---------- 聊天外观统一存储（第 24 条 b，2026-11-14 产品确定收拢） ---------- */
/* [位置:phone-kit.js·P.chatTheme] [聊天外观统一存储] [原来聊天外观散在 5 个本机键（ph.look.v2 / ph.bubble.v1 / ph.chatbg.img / ph_chat_style / ph_chat_font_cn、ph_chat_font_en），读写口分散在 pages/bubble/set/talk 四个文件，动一个字段要改四处；收拢成一个键 ph.chattheme.v1（{v,look,bubble,bgimg,style,cn,en}），SCHEMA 是各段字段缺省的唯一定义点（phone-pages 的 LDEF、phone-bubble 的 DEF 改指这里）。读时迁移：新键不存在而 5 个旧键任一在（bgimg 单独存在不算，与原 themeSync·hasLocal 口径一致）→ 组装写新键、旧键保留；写时只写新键；themeSync 首次保存成功后 clearLegacy() 清旧键（幂等）。云端 chat-theme.json 六段格式不变，look/bubble 段原样存取不加缺省（归一仍由消费方 LDEF/DEF + normST/migLook 做，云上负载稀疏度与改前一致）。本文件是第一支 defer 脚本，bubble/set/talk/pages 的加载期读取都赶得上。保存是整键重写：bgimg 大字符串跟着一起落盘（dataURL 上限几百 KB，量级可接受），配额不足原样抛错、由调用方报「照片太大」。2026-11-14 第 27 条（随手记）：SCHEMA 加 cthemes 段——自定义主题存档（月夜玻璃配置的命名克隆，读写只经 save({cthemes}) 整段替换，界面在 phone-pages.js·ctheme* 系列函数）] [注释时间 2026-11-14；当晚第 27 条加 cthemes 段] */
(function(){
"use strict";
var P=window.PH;
var KEY='ph.chattheme.v1';
var LEGACY=['ph.look.v2','ph.bubble.v1','ph.chatbg.img','ph_chat_style','ph_chat_font_cn','ph_chat_font_en'];
function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function js(k){ try{ return JSON.parse(ls(k)||'null'); }catch(e){ return null; } }
function read(){ var o=js(KEY); if(o&&typeof o==='object'&&o.v===1) return o;   /* 迁移过的老数据（无 v 或旧结构）也走一遍重迁，别卡死 */
  var lg={look:js('ph.look.v2'),bubble:js('ph.bubble.v1'),style:ls('ph_chat_style'),cn:ls('ph_chat_font_cn'),en:ls('ph_chat_font_en')};
  if(!(lg.look||lg.bubble||lg.style!=null||lg.cn!=null||lg.en!=null)) return null;
  var m={v:1,look:lg.look||{},bubble:lg.bubble||{},bgimg:ls('ph.chatbg.img')||'',style:lg.style||'',cn:lg.cn||'',en:lg.en||''};
  try{ localStorage.setItem(KEY,JSON.stringify(m)); }catch(e){}   /* 迁移写失败不阻塞读：先返回内存值让页面用着 */
  return m; }
function save(patch){ var base=read()||{v:1,look:{},bubble:{},bgimg:'',style:'',cn:'',en:''};   /* 合并基准取磁盘最新值，防多标签拿旧缓存盖字段 */
  var next=Object.assign({},base,patch||{}); next.v=1;
  localStorage.setItem(KEY,JSON.stringify(next)); return next; }   /* 配额不足原样抛错（lookFlush/setBgImage 靠它报「存不下」） */
function bgimgGet(){ var o=read(); return o?String(o.bgimg||''):(ls('ph.chatbg.img')||''); }
function bgimgSet(u){ save({bgimg:String(u||'')}); }   /* 空串=删背景照片 */
function hasAny(){ if(read()) return true; var L=['ph.look.v2','ph.bubble.v1','ph_chat_style','ph_chat_font_cn','ph_chat_font_en']; return L.some(function(k){ return ls(k)!==null; }); }
function clearLegacy(){ LEGACY.forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} }); }
P.chatTheme={KEY:KEY,
  /* SCHEMA：字段缺省唯一定义点。look=气泡细调全字段（原 phone-pages·LDEF；PatG=生成器参数串 g1|款式|角度|透明度|底色|色1,色2,色3|色带宽，Pat='gen' 时生效；Ls 线框样式 none/solid/dash/wave、Lw 粗细px、Lc 颜色空=跟气泡色、PatS 密度=tile边长px、PatC 图案色）、bubble=气泡底色/圆角/背景（原 phone-bubble·DEF）；bgimg/style/cn/en 为原散键缺省 */
  SCHEMA:{look:{sync:0,aiA:100,meA:100,aiBl:0,meBl:0,aiSh:16,meSh:30,aiInk:'',meInk:'',fs:15,bs:'def',ib:'def',ibr:21,ibh:44,av:1,avPos:'top',aiMaxW:90,meMaxW:80,aiLs:'none',aiLw:2,aiLd:50,aiLc:'',aiLo:100,aiHsqR:11,meLs:'none',meLw:2,meLd:50,meLc:'',meLo:100,meHsqR:11,aiPat:'none',aiPatS:16,aiPatC:'',mePat:'none',mePatS:16,mePatC:'',aiPatG:'',mePatG:'',aiPatO:100,mePatO:100},   /* [2026-11-16 批2 E7] look 加 aiLo/meLo 线框透明度（缺省 100=原样，老存档没这字段渲染零变化）；[2026-11-17] 加 aiHsqR/meHsqR 两方两圆方角固定值（缺省 11 已确定；老存档缺字段读缺省，选了 hsq 的边会从旧公式≈4.5 变 11——即本次改动目的）；[2026-11-23] 加 aiMaxW/meMaxW（气泡最大宽度，缺省 90/80）与 avPos（头像位置 top/side，缺省 top） */
    bubble:{me:'#7298d6',ai:'#f6f9ff',a:1,aiR:15,meR:15,shadow:true,blur:0,bg:'',bgDark:false,clear:100,veil:0},bgimg:'',style:'bubble',cn:'',en:'',
    /* [2026-11-14 第 27 条] cthemes=自定义主题存档：[{id,name,ts,look,bubble,bgimg}]（月夜玻璃三段快照，bgimg 只存地址），上限 20 条、新的在前；缺省 []，旧数据无此段照常读 */
    cthemes:[]},
  read:read,save:save,bgimgGet:bgimgGet,bgimgSet:bgimgSet,hasAny:hasAny,clearLegacy:clearLegacy};
})();
