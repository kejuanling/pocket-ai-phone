/* 小手机 · 联网层：统一的请求、登录弹窗（和聊天页共用同一个管理台会话 cookie）、时间格式 */
(function(){
"use strict";
var P=window.PH, esc=P.esc, buzz=P.buzz;
var pending=null, warned=false;

function loginSheet(){
  if(pending) return pending;
  pending=new Promise(function(res,rej){
    var el=document.createElement('div'); el.className='phlogin';
    el.innerHTML='<div class="scrim"></div><div class="lg-box"><b>先登录一下</b><p>和聊天页用同一个账号，登录一次大约 30 天不用再登。</p>'+
      '<input id="lgU" type="text" placeholder="账号" autocomplete="username" autocapitalize="none" autocorrect="off">'+
      '<input id="lgP" type="password" placeholder="密码" autocomplete="current-password">'+
      '<div class="lg-msg" id="lgM"></div><div class="lg-bt"><button class="no tap">先不登</button><button class="go tap">登录</button></div></div>';
    P.D.appendChild(el); requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('show'); }); });
    var u=el.querySelector('#lgU'), p=el.querySelector('#lgP'), m=el.querySelector('#lgM'), go=el.querySelector('.go'), bx=el.querySelector('.lg-box');
    var unkb=null, fitT=0, backT=0, cancelled=false;
    /* [位置:phone-net.js·loginSheet kbFit] [登录居中弹窗软键盘避让] [11-13：中央弹窗输入时跟随页面上移，避免软键盘遮挡密码框和登录按钮；按键盘高度把 .lg-box 用 margin-top 向上平移，关弹窗注销监听] [注释时间 2026-11-13] */
    function kbFit(kb){
      if(!bx||!bx.isConnected) return;
      bx.style.marginTop='';
      kb=Math.round(kb||0); if(kb<=0) return;
      var bR=bx.getBoundingClientRect(), hR=P.D.getBoundingClientRect();
      var kbTop=(window.innerHeight||document.documentElement.clientHeight||0)-kb;
      var need=Math.round(bR.bottom+16-kbTop);
      if(need<=0) return;
      var cap=Math.round(bR.top-hR.top-16);
      if(cap<0) cap=0;
      bx.style.marginTop='-'+Math.min(need,cap)+'px';
    }
    function kbNow(){ var vv=window.visualViewport; if(!vv) return 0; return Math.max(0,Math.round((window.innerHeight||document.documentElement.clientHeight||0)-(vv.height||0)-(vv.offsetTop||0))); }
    function kbOn(){ if(!P.kb) return; if(!unkb) unkb=P.kb(kbFit); clearTimeout(fitT); kbFit(kbNow()); fitT=setTimeout(function(){ if(unkb) kbFit(kbNow()); },320); }
    function kbOff(){ clearTimeout(fitT); clearTimeout(backT); backT=setTimeout(function(){ if(!bx||document.activeElement===u||document.activeElement===p) return; if(unkb){ unkb(); unkb=null; } bx.style.marginTop=''; },200); }
    u.addEventListener('focus',kbOn); u.addEventListener('blur',kbOff);
    p.addEventListener('focus',kbOn); p.addEventListener('blur',kbOff);
    /* [位置:phone-net.js·loginSheet close] [ESC 关弹窗 + 关闭后不再写登录态] [11-13 审查 P2-1 / P3-1：弹窗原来只能点遮罩关闭，没 ESC；另外点「先不登」后在途的 chat-login 成功仍会写 han_logged_in 并派发 ph:login，页面以为已登录、后续请求接着 401。现在 close 里置 cancelled 并注销键盘监听，回包先看 cancelled] [注释时间 2026-11-14] */
    function onKey(e){ if(e.key!=='Escape'||e.isComposing) return; e.stopPropagation(); close(); }
    document.addEventListener('keydown',onKey,true);
    function close(){ cancelled=true; document.removeEventListener('keydown',onKey,true); clearTimeout(fitT); clearTimeout(backT); if(unkb){ unkb(); unkb=null; } if(bx) bx.style.marginTop=''; el.classList.remove('show'); setTimeout(function(){ el.remove(); },320); pending=null; }
    function submit(){
      var a=u.value.trim(), b=p.value.trim(); if(!a||!b){ m.textContent='账号和密码都要填'; return; }
      go.disabled=true; go.textContent='验证中…'; m.textContent='';
      fetch('/heartbeat/admin/chat-login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({user:a,password:b})})
        .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return {ok:r.ok,j:j}; }); })
        .then(function(x){
          if(cancelled) return;   /* 弹窗已关（点了先不登 / 按了 ESC），回包不再写登录态、不再派发 ph:login */
          if(x.ok&&x.j.ok){ try{ localStorage.setItem('han_logged_in','1'); }catch(e){} buzz(10); close(); res(); try{ window.dispatchEvent(new Event('ph:login')); }catch(e){} }
          else{ m.textContent=(x.j&&x.j.error)||'账号或密码不对'; go.disabled=false; go.textContent='登录'; }
        }).catch(function(){ if(cancelled) return; m.textContent='网络不通，稍后再试'; go.disabled=false; go.textContent='登录'; });
    }
    go.addEventListener('click',submit); p.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
    el.querySelector('.no').addEventListener('click',function(){ close(); rej(new Error('未登录')); });
    el.querySelector('.scrim').addEventListener('click',function(){ close(); rej(new Error('未登录')); });
    setTimeout(function(){ try{ u.focus(); }catch(e){} },380);
  });
  return pending;
}

/* 请求：自动带 cookie；401 弹登录再重试一次；返回 JSON */
function cookie(n){ try{ var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)')); return m?decodeURIComponent(m[1]):''; }catch(e){ return ''; } }
/* [位置:phone-net.js·httpErr] [HTTP 错误解析成 {message,status,code,body}] [11-14 审查 B 批 a：后端错误结构统一成 { error: 人话, code: 机器码 }（部分老接口仍是裸字符串），req 与 stream 两条通道共用这一份解析；message 保留「HTTP 400 人话」形状，兼容现有按 /^HTTP \d+/ 剥前缀、按状态码正则匹配的调用方] [注释时间 2026-11-14] */
function httpErr(status,t){
  var body=null; try{ body=JSON.parse(t); }catch(_e){}
  var msg='', code='';
  if(body&&typeof body==='object'){
    if(typeof body.error==='string') msg=body.error;
    else if(body.error&&typeof body.error==='object'){ msg=body.error.message||''; code=body.error.code||''; }
    if(!msg&&typeof body.message==='string') msg=body.message;
    if(!code&&typeof body.code==='string') code=body.code;
  }
  if(!msg) msg=t?t.slice(0,120):'';
  var e=new Error('HTTP '+status+(msg?' '+msg:'')); e.status=status; e.code=code; e.body=body;
  return e;
}
function req(url,opt){
  opt=opt||{}; var o={credentials:'include',headers:{'Accept':'application/json'}}, ck=cookie('admin_csrf');
  if(ck) o.headers['X-CSRF-Token']=ck;
  if(opt.headers) Object.assign(o.headers,opt.headers);
  if(opt.body!==undefined&&opt.body!==null){ o.method=opt.method||'POST'; o.headers['Content-Type']='application/json'; o.body=JSON.stringify(opt.body); }
  /* [位置:phone-net.js·req FormData] [multipart 上传通道] [10-28：朋友圈发表器传图走 /diary/api/upload（Flask 只认 multipart）；传 opt.form 不设 Content-Type，浏览器自带 boundary；已有调用方不受影响] [注释时间 2026-10-28] */
  else if(opt.form){ o.method=opt.method||'POST'; o.body=opt.form; }
  else if(opt.method) o.method=opt.method;
  if(opt.signal) o.signal=opt.signal;
  /* [位置:phone-net.js·req 超时] [默认 45s 超时] [2026-10-27 审查：原来没有超时，弱网页面请求永久挂起
     （加载态永远在转）；大文件上传等慢操作用 opt.timeout 覆盖，0=不限。stream 另有自己的 180s 静默超时，不动] [注释时间 2026-10-27]
     [11-14 审查 C 批：原来条件是 !opt.signal——调用方一旦传了取消信号，整段 45s 超时直接跳过，弱网下又变成永久挂起；
      现在超时与外部信号合并：本方单独一个 controller，外部 abort 转成本方 abort，超时照样生效] */
  var to=(opt.timeout==null?45000:opt.timeout), myCtrl=null, myTimer=null, timedOut=false, extAbort=null;
  if(to>0&&window.AbortController){
    myCtrl=new AbortController(); o.signal=myCtrl.signal;
    myTimer=setTimeout(function(){ timedOut=true; try{ myCtrl.abort(); }catch(e){} },to);
    if(opt.signal){
      if(opt.signal.aborted){ try{ myCtrl.abort(); }catch(e){} }
      else { extAbort=function(){ try{ myCtrl.abort(); }catch(e){} }; try{ opt.signal.addEventListener('abort',extAbort); }catch(e){} }
    }
  } else if(opt.signal) o.signal=opt.signal;
  function done(){ if(myTimer){ clearTimeout(myTimer); myTimer=null; } if(extAbort&&opt.signal&&opt.signal.removeEventListener){ try{ opt.signal.removeEventListener('abort',extAbort); }catch(e){} extAbort=null; } }
  return fetch(url,o).then(function(r){
    done();
    if(r.status===401&&!opt._retried&&!opt.noLogin) return loginSheet().then(function(){ return req(url,Object.assign({},opt,{_retried:true})); });
    /* [位置:phone-net.js·req 错误体] [错误响应带上解析后的 body + 人话] [需求:11-06：手动新增记忆查重时后端回 409 + 相似条目，原来错误只有截断的 message，前端拿不到完整数据；这里多挂一个 e.body，message 与行为完全不变] [注释时间 2026-11-06]
       [11-14 审查 B 批 a：后端错误结构统一成 { error: 人话, code: 机器码 }（部分老接口仍是裸字符串），这里统一解成人话 + e.code；message 仍是「HTTP 400 人话」的形状——保留 HTTP 前缀是为了兼容现有按 /^HTTP \d+/ 剥前缀、按状态码正则匹配的调用方] */
    if(!r.ok) return r.text().then(function(t){ throw httpErr(r.status,t); });
    var ct=r.headers.get('content-type')||''; return ct.indexOf('json')>=0?r.json():r.text();
  },function(e){
    done();
    if(myCtrl&&myCtrl.signal.aborted&&e&&e.name==='AbortError'){
      if(timedOut) throw new Error('请求超时（'+Math.max(1,Math.round(to/1000))+'s 没等到回应）');
      throw new Error('请求已取消');   /* 外部 signal 主动取消，不冒充超时 */
    }
    throw e;
  });
}

/* 流式 POST（SSE）：每个 data: 帧解析成 JSON 交给 onFrame；180 秒没有任何数据就掐掉 */
function stream(url,body,onFrame,opt){
  opt=opt||{}; var ctl=new AbortController(), timer=null, ck=cookie('admin_csrf');
  var headers={'Content-Type':'application/json','Accept':'text/event-stream'}; if(ck) headers['X-CSRF-Token']=ck; if(opt.headers) Object.assign(headers,opt.headers);
  function arm(){ clearTimeout(timer); timer=setTimeout(function(){ ctl.abort(); },opt.silence||180000); }
  function go(retried){
    arm();
    return fetch(url,{method:'POST',credentials:'include',headers:headers,body:JSON.stringify(body),signal:ctl.signal}).then(function(r){
      if(r.status===401&&!retried){ clearTimeout(timer); return loginSheet().then(function(){ return go(true); }); }
      /* [位置:phone-net.js·stream 错误体] [错误响应也带 e.body] [11-14 审查 C 批：req 自 11-06 起就把解析后的 body 挂在 e.body 上，stream 没跟，同一个后端的错误在两条通道里形状不一样（流式那边只能正则抠文案）；这里对齐] [注释时间 2026-11-14] */
      if(!r.ok) return r.text().then(function(t){ throw httpErr(r.status,t); });
      var rd=r.body.getReader(), dec=new TextDecoder(), buf='';
      function line(l){ if(l.indexOf('data:')!==0) return; var d=l.slice(5).trim(); if(!d||d==='[DONE]') return; var j; try{ j=JSON.parse(d); }catch(e){ return; } onFrame(j); }
      return (function pump(){
        return rd.read().then(function(x){
          arm();
          if(x.done){ if(buf.trim()) line(buf.trim()); return; }
          buf+=dec.decode(x.value,{stream:true}); var i;
          while((i=buf.indexOf('\n'))>=0){ line(buf.slice(0,i).replace(/\r$/,'')); buf=buf.slice(i+1); }
          return pump();
        });
      })();
    }).then(function(v){ clearTimeout(timer); return v; },function(e){ clearTimeout(timer); throw e; });
  }
  var pr=go(false); pr.abort=function(){ try{ ctl.abort(); }catch(e){} }; return pr;
}

function two(n){ return ('0'+n).slice(-2); }
function parse(iso){ if(!iso) return null; if(iso instanceof Date) return isNaN(iso)?null:iso; var d=new Date(typeof iso==='number'?iso:String(iso).replace(' ','T')); return isNaN(d)?null:d; }
function fmtTime(iso){
  var d=parse(iso); if(!d) return ''; var n=new Date(), t0=new Date(n.getFullYear(),n.getMonth(),n.getDate()), d0=new Date(d.getFullYear(),d.getMonth(),d.getDate()), diff=Math.round((t0-d0)/864e5), hm=two(d.getHours())+':'+two(d.getMinutes());
  if(diff===0) return '今天 '+hm; if(diff===1) return '昨天 '+hm;
  if(d.getFullYear()===n.getFullYear()) return (d.getMonth()+1)+'月'+d.getDate()+'日';
  return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';
}
function hm(iso){ var d=parse(iso); return d?two(d.getHours())+':'+two(d.getMinutes()):''; }
function ymd(d){ d=d||new Date(); return d.getFullYear()+'-'+two(d.getMonth()+1)+'-'+two(d.getDate()); }

/* [位置:phone-net.js·offline/failBox/loadBox] [没连上后台 / 读取中 的统一提示] [演示数据已全部删除（2026-10-22）：没连上不再退回示例内容，各页面用 failBox 显示「没连上后台 · 点一下重试」，用 loadBox 显示「正在读取…」；点 [data-retry] 的重试由各页面自己接] [注释时间 2026-10-22] */
function offline(){ if(warned) return; warned=true; P.toast('没连上后台');
  /* [位置:phone-net.js·offline] [断网提示恢复后重置] [网络恢复后重置 warned，下次断网再提示] [注释时间 2026-10-28] */
  window.addEventListener('online',function(){ warned=false; },{once:true}); }
function failBox(msg){ return '<div class="pd-st pd-fail"><span>'+(msg||'没连上后台')+'</span><button class="pd-retry tap" type="button" data-retry>点一下重试</button></div>'; }
/* [位置:phone-net.js·loadBox] [「读取中」统一换成全局加载动画] [11-05：原来是一个小圆点转圈 + 「正在读取…」文字，全站七八个页面各用各的、观感不一；现在统一交给 ph-load.js（白天纸船 / 夜里星光，不放文字）。用小号档（不铺满）：这些 loadBox 多半嵌在小卡片/分区里，铺满会把动画甩到窗口正中、离开原来的位置。11-14 审查：形参 msg 早已不用，调用方传的字串全被忽略，参数去掉（多传的实参不影响调用，各页面不用改）] [注释时间 2026-11-05；2026-11-14 去死参数] */
function loadBox(){ return '<div class="pd-st pd-load">'+(window.PH&&PH.load?PH.load.html():'')+'</div>'; }

/* [位置:phone-net.js·peek/keep/idb] [本地缓存工具] [10-24 需求 21：只读缓存，只管「先画出来」，不替代请求——用缓存的页面照样会去后端拉一遍，拉到了覆盖校正；peek/keep 是 localStorage 小数据（键 ph_c_*，超过 7 天的当没有），idb 是聊天历史快照（库 ph_cache，表 kv）；任何一步出错都当没缓存；不做离线写、不做离线队列] [注释时间 2026-10-24] */
function peek(k,maxAge){ try{ var j=JSON.parse(localStorage.getItem('ph_c_'+k)||'null'); if(!j||!j.t||Date.now()-j.t>(maxAge||6048e5)) return null; return j.v; }catch(e){ return null; } }
function keep(k,v){ try{ localStorage.setItem('ph_c_'+k,JSON.stringify({t:Date.now(),v:v})); }catch(e){} }
/* [位置:phone-net.js·清掉旧快照库] [10-24 去掉聊天历史本地快照：把这台设备上之前存的快照库（IndexedDB ph_cache）和它的索引一次性删掉；只做一次] [注释时间 2026-10-24] */
try{ if(localStorage.getItem('ph_c_idb_gone')!=='1'){ if(window.indexedDB) indexedDB.deleteDatabase('ph_cache'); localStorage.removeItem('ph_c_tailidx'); localStorage.setItem('ph_c_idb_gone','1'); } }catch(e){}

P.net={peek:peek,keep:keep,req:req,get:function(u,o){ return req(u,o); },post:function(u,b,o){ return req(u,Object.assign({body:b},o||{})); },
  stream:stream,cookie:cookie,login:loginSheet,fmtTime:fmtTime,hm:hm,ymd:ymd,parse:parse,two:two,offline:offline,failBox:failBox,loadBox:loadBox};
})();
