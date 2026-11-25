/* 小手机 · 统一称呼状态与头像工具
   - 称呼权威来源：服务器 /heartbeat/admin/chat-settings 的 cfg.user_name / cfg.ai_name
   - 缺省值：用户 / 助手，头像字母取首字（兜底 用 / 助）
   - 不使用全局 DOM 文本替换，也不让旧本机缓存覆盖发布默认值 */
(function(){
"use strict";
var P=window.PH;
var DEF={me:'用户',ai:'助手'};
var S={me:{name:DEF.me,av:''},ai:{name:DEF.ai,av:''}};
var loaded=false, loading=null;

function cleanName(v,fb){
  var s=typeof v==='string'?v.trim().slice(0,24):'';
  return s||fb;
}
function firstChar(s,fb){
  var a=Array.from(String(s||'').trim());
  return a[0]||fb;
}
function snapshot(){
  return {
    me:S.me.name,
    ai:S.ai.name,
    meLetter:firstChar(S.me.name,'用'),
    aiLetter:firstChar(S.ai.name,'助')
  };
}
function syncChrome(){
  var cur=snapshot();
  var pair=document.getElementById('homePairNm');
  if(pair) pair.textContent=cur.me+' & '+cur.ai;
  var lkNm=document.getElementById('lkNotiNm');
  if(lkNm) lkNm.textContent=cur.ai;
  ['#home .av.me','#lock .av.me'].forEach(function(sel){
    Array.prototype.forEach.call(document.querySelectorAll(sel),function(el){ el.setAttribute('data-l',cur.meLetter); });
  });
  ['#home .av.ai','#lock .av.ai'].forEach(function(sel){
    Array.prototype.forEach.call(document.querySelectorAll(sel),function(el){ el.setAttribute('data-l',cur.aiLetter); });
  });
}
function emit(){
  syncChrome();
  try{ document.dispatchEvent(new CustomEvent('ph:names',{detail:snapshot()})); }catch(e){}
}
function applyPatch(patch){
  if(!patch||typeof patch!=='object') return false;
  var ch=false;
  if(patch.me!==undefined||patch.user_name!==undefined){
    var nm=cleanName(patch.me!==undefined?patch.me:patch.user_name,DEF.me);
    if(nm!==S.me.name){ S.me.name=nm; ch=true; }
  }
  if(patch.ai!==undefined||patch.ai_name!==undefined){
    var na=cleanName(patch.ai!==undefined?patch.ai:patch.ai_name,DEF.ai);
    if(na!==S.ai.name){ S.ai.name=na; ch=true; }
  }
  if(ch) emit();
  return ch;
}
function load(force){
  if(loaded&&!force) return Promise.resolve(snapshot());
  if(loading&&!force) return loading;
  var fetcher=(P.net&&P.net.get)
    ? P.net.get('/heartbeat/admin/chat-settings',{noLogin:true}).then(function(r){ return (r&&r.data&&r.data.cfg)||(r&&r.cfg)||null; })
    : fetch('/heartbeat/admin/chat-settings',{credentials:'include'}).then(function(r){ return r.ok?r.json():null; }).then(function(j){ return (j&&j.data&&j.data.cfg)||(j&&j.cfg)||null; });
  loading=Promise.resolve(fetcher).then(function(c){
    loaded=true; loading=null;
    if(c) applyPatch({me:c.user_name,ai:c.ai_name});
    return snapshot();
  },function(){
    loading=null;
    return snapshot();
  });
  return loading;
}

/* ---- 头像裁剪工具（保留供调用方按需复用） ---- */
function applyAv(k){
  var r=document.documentElement.style;
  if(S[k].av) r.setProperty('--av-'+k+'-x','url("'+S[k].av+'")'); else r.removeProperty('--av-'+k+'-x');
  Array.prototype.forEach.call(document.querySelectorAll('.av.'+k),function(e){ if(S[k].av) e.classList.add('hasimg'); });
}
function cropToDataURL(file){
  return new Promise(function(res,rej){
    var fr=new FileReader();
    fr.onerror=function(){ rej(new Error('读不了这张图')); };
    fr.onload=function(){
      var im=new Image();
      im.onerror=function(){ rej(new Error('这张图打不开')); };
      im.onload=function(){
        var s=Math.min(im.naturalWidth,im.naturalHeight), sx=(im.naturalWidth-s)/2, sy=(im.naturalHeight-s)/2, N=256, c=document.createElement('canvas');
        c.width=c.height=N; var g=c.getContext('2d'); g.imageSmoothingQuality='high'; g.drawImage(im,sx,sy,s,s,0,0,N,N);
        res(c.toDataURL('image/jpeg',.88));
      };
      im.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function openCrop(file){
  return new Promise(function(res){
    var fr=new FileReader();
    fr.onerror=function(){ res(null); };
    fr.onload=function(){
      var im=new Image();
      im.onerror=function(){ P.toast('这张图打不开'); res(null); };
      im.onload=function(){
        var D=P.D, el=document.createElement('div'); el.className='crop';
        el.innerHTML='<div class="scrim"></div><div class="cr-box"><div class="cr-t">拖一拖、捏一捏，圆圈里就是头像</div><div class="cr-stage"><img alt="" draggable="false"><i class="cr-ring"></i></div>'+
          '<input class="cr-zoom" type="range" min="1" max="4" step="0.01" value="1" aria-label="缩放"><div class="cr-bt"><button class="no tap">取消</button><button class="go tap">用这张</button></div></div>';
        D.appendChild(el);
        var stage=el.querySelector('.cr-stage'), img=el.querySelector('img'), zoom=el.querySelector('.cr-zoom'), Z=260;
        img.src=im.src; var nw=im.naturalWidth, nh=im.naturalHeight, s0=Z/Math.min(nw,nh), z=1, cx=nw/2, cy=nh/2;
        function clamp(){ var s=s0*z, hx=Z/2/s, hy=Z/2/s; cx=Math.max(hx,Math.min(nw-hx,cx)); cy=Math.max(hy,Math.min(nh-hy,cy)); }
        function paint(){ clamp(); var s=s0*z; img.style.width=nw*s+'px'; img.style.height=nh*s+'px'; img.style.transform='translate('+(Z/2-cx*s)+'px,'+(Z/2-cy*s)+'px)'; zoom.value=z; }
        paint();
        var pts={}, last=0;
        stage.addEventListener('pointerdown',function(e){ try{ stage.setPointerCapture(e.pointerId); }catch(_){} pts[e.pointerId]={x:e.clientX,y:e.clientY}; last=0; });
        stage.addEventListener('pointermove',function(e){
          var p=pts[e.pointerId]; if(!p) return; var ids=Object.keys(pts), s=s0*z;
          if(ids.length===1){ cx-=(e.clientX-p.x)/s; cy-=(e.clientY-p.y)/s; }
          p.x=e.clientX; p.y=e.clientY;
          if(ids.length===2){ var a=pts[ids[0]], b=pts[ids[1]], d=Math.hypot(a.x-b.x,a.y-b.y); if(last) z=Math.max(1,Math.min(4,z*d/last)); last=d; }
          paint();
        });
        function up(e){ delete pts[e.pointerId]; last=0; }
        stage.addEventListener('pointerup',up); stage.addEventListener('pointercancel',up);
        stage.addEventListener('wheel',function(e){ e.preventDefault(); z=Math.max(1,Math.min(4,z*(e.deltaY<0?1.06:.94))); paint(); },{passive:false});
        zoom.addEventListener('input',function(){ z=+zoom.value; paint(); });
        function close(v){ el.classList.remove('show'); setTimeout(function(){ el.remove(); },320); res(v); }
        el.querySelector('.scrim').addEventListener('click',function(){ close(null); });
        el.querySelector('.no').addEventListener('click',function(){ close(null); });
        el.querySelector('.go').addEventListener('click',function(){
          var s=s0*z, N=256, c=document.createElement('canvas'); c.width=c.height=N; var g=c.getContext('2d'); g.imageSmoothingQuality='high';
          g.drawImage(im,cx-Z/2/s,cy-Z/2/s,Z/s,Z/s,0,0,N,N); close(c.toDataURL('image/jpeg',.9));
        });
        requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('show'); }); });
      };
      im.src=fr.result;
    };
    fr.readAsDataURL(file);
  });
}

P.names={
  DEF:DEF,
  get:snapshot,
  me:function(){ return S.me.name; },
  ai:function(){ return S.ai.name; },
  letter:function(k){ return k==='ai'?firstChar(S.ai.name,'助'):firstChar(S.me.name,'用'); },
  set:applyPatch,
  load:load,
  syncChrome:syncChrome
};

P.profile={
  DEF:DEF,
  get:function(k){ return {name:S[k].name,av:S[k].av}; },
  setName:function(k,v){
    var pt={}; pt[k]=v; return applyPatch(pt);
  },
  setAvatar:function(k,file){
    return cropToDataURL(file).then(function(url){ S[k].av=url; applyAv(k); return url; });
  },
  crop:openCrop,
  setAvatarData:function(k,url){ S[k].av=url; applyAv(k); return url; },
  reset:function(k){ var pt={}; pt[k]=DEF[k]; S[k].av=''; applyAv(k); applyPatch(pt); }
};

if(P._initChatCfg){ applyPatch(P._initChatCfg); }
syncChrome();
})();
