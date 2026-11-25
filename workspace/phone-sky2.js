/* 小手机 · 桌面氛围 v2：海一样的壁纸——底部深蓝向上渐淡、水面波纹线、顶部几颗闪烁的光点，手指点到哪里荡开涟漪；
   随天气与时间默默变化（日出 / 白天 / 日落 / 夜晚 / 雨 / 雪 / 雾 / 雷），月亮按真实日期显示月相。
   天气取自 Open-Meteo（免费免钥匙，东莞坐标）；取不到就只按时间变化。想预览：网址后加 #sky=night / rain / dawn / dusk / snow / fog / thunder，可用 + 叠加，如 #sky=night+rain */
(function(){
"use strict";
var P=window.PH; if(!P) return;
var D=P.D, reduce=P.reduce;
var LAT=23.0218, LON=113.7520, KEY='ph.sky.wx.v1', TTL=20*60*1000;
var wx={code:0,cloud:0,precip:0,sr:6.4,ss:17.9,at:0}, force={};

/* ---------- 预览参数 ---------- */
(function(){ var m=/sky=([\w+]+)/.exec(location.hash||''); if(!m) return;
  m[1].split('+').forEach(function(k){
    if(k==='night') force.t=23.5; else if(k==='dawn') force.t='sr'; else if(k==='dusk') force.t='ss'; else if(k==='day') force.t=13;
    else if(k==='rain') force.wx={rain:.8,cloud:.8}; else if(k==='drizzle') force.wx={rain:.35,cloud:.7};
    else if(k==='snow') force.wx={snow:.8,cloud:.7}; else if(k==='fog') force.wx={fog:.8,cloud:.5};
    else if(k==='thunder') force.wx={rain:1,cloud:.9,thunder:1}; else if(k==='cloud') force.wx={cloud:.7};
  }); })();

/* ---------- 天气码 → 强度 ---------- */
function classify(code,cloud){
  var o={rain:0,snow:0,fog:0,cloud:Math.max(0,Math.min(1,(cloud||0)/100)),thunder:0};
  var R={51:.3,53:.45,55:.6,56:.5,57:.6,61:.5,63:.75,65:1,66:.8,67:1,80:.5,81:.8,82:1,95:.85,96:1,99:1};
  var S={71:.4,73:.7,75:1,77:.4,85:.6,86:.9};
  if(R[code]) o.rain=R[code]; if(S[code]) o.snow=S[code];
  if(code===45||code===48) o.fog=.8;
  if(code>=95) o.thunder=1;
  if(o.rain||o.snow) o.cloud=Math.max(o.cloud,.75);
  if(code===1) o.cloud=Math.max(o.cloud,.1); if(code===2) o.cloud=Math.max(o.cloud,.4); if(code===3) o.cloud=Math.max(o.cloud,.7);
  return o;
}
function env(){ if(force.wx){ var o={rain:0,snow:0,fog:0,cloud:0,thunder:0}; for(var k in force.wx) o[k]=force.wx[k]; return o; } return classify(wx.code,wx.cloud); }

/* ---------- 取天气（本地缓存 20 分钟，失败不打扰） ---------- */
function hm(s){ var m=/T(\d+):(\d+)/.exec(s||''); return m?(+m[1]+(+m[2])/60):null; }
function loadWx(){
  try{ var c=JSON.parse(localStorage.getItem(KEY)||'null'); if(c){ wx=c; if(Date.now()-c.at<TTL) return; } }catch(e){}
  var ac=window.AbortController?new AbortController():null, to=setTimeout(function(){ if(ac) ac.abort(); },6000);
  fetch('https://api.open-meteo.com/v1/forecast?latitude='+LAT+'&longitude='+LON+'&current=weather_code,precipitation,cloud_cover&daily=sunrise,sunset&timezone=auto&forecast_days=1',{signal:ac&&ac.signal})
    .then(function(r){ return r.ok?r.json():null; }).then(function(j){
      if(!j||!j.current) return; var c=j.current, d=j.daily||{};
      wx={code:c.weather_code|0,cloud:c.cloud_cover||0,precip:c.precipitation||0,sr:hm(d.sunrise&&d.sunrise[0])||wx.sr,ss:hm(d.sunset&&d.sunset[0])||wx.ss,at:Date.now()};
      try{ localStorage.setItem(KEY,JSON.stringify(wx)); }catch(e){}
      update();
    }).catch(function(){}).then(function(){ clearTimeout(to); });
}

/* ---------- DOM ---------- */
var sky=document.createElement('div'); sky.id='sky';
sky.innerHTML='<i class="sk sk-dawn"></i><i class="sk sk-dusk"></i><i class="sk sk-night"></i><i class="sk sk-wash"></i><i class="sk sk-fog"></i>'+
  '<i class="sk-breath"></i><i class="sk-sun"><b></b></i><canvas class="sk-lune" width="640" height="640"></canvas><canvas id="skyc"></canvas><i class="sk-flash"></i>';
var anchor=document.getElementById('grain'); D.insertBefore(sky,anchor||D.firstChild);
/* 有时候有云：几团软软的灰白云慢慢从月亮前面飘过，跟着月亮走（预览版新加） */
var LC=null, CLOUD=Math.random()<.45;
try{ var qc=new URLSearchParams(location.search).get('cloud'); if(qc!=null) CLOUD=qc==='1'; }catch(e){}
if(CLOUD){ LC=document.createElement('i'); LC.className='sk-lcloud'; LC.innerHTML='<b></b><b></b><b></b>'; sky.insertBefore(LC,sky.querySelector('#skyc'));
  var cs=document.createElement('style'); cs.textContent='.sk-lcloud{position:absolute;left:0;top:0;width:320px;height:320px;margin:-160px 0 0 -160px;opacity:0;pointer-events:none;transition:transform 30s linear,opacity 20s linear;overflow:visible}'+
    '.sk-lcloud b{position:absolute;border-radius:50%;background:radial-gradient(closest-side,rgba(214,219,234,.78),rgba(200,207,225,.46) 55%,rgba(190,198,218,0));filter:blur(5px);animation:skCloud var(--d) linear infinite;animation-delay:var(--dl)}'+
    '.sk-lcloud b:nth-child(1){width:190px;height:58px;top:128px;--d:95s;--dl:-30s}'+
    '.sk-lcloud b:nth-child(2){width:130px;height:40px;top:166px;--d:120s;--dl:-80s;opacity:.8}'+
    '.sk-lcloud b:nth-child(3){width:240px;height:66px;top:104px;--d:150s;--dl:-120s;opacity:.65}'+
    '@keyframes skCloud{0%{transform:translateX(-260px)}100%{transform:translateX(360px)}}#sky.nofx .sk-lcloud{transition:none!important}';
  document.head.appendChild(cs); }
var L={dawn:sky.querySelector('.sk-dawn'),dusk:sky.querySelector('.sk-dusk'),night:sky.querySelector('.sk-night'),wash:sky.querySelector('.sk-wash'),fog:sky.querySelector('.sk-fog'),sun:sky.querySelector('.sk-sun'),moon:sky.querySelector('.sk-lune'),flash:sky.querySelector('.sk-flash')};
var cv=document.getElementById('skyc'), g=cv.getContext('2d'), W=0,H=0,dpr=1;
function resize(){ W=D.clientWidth; H=D.clientHeight; dpr=Math.min(2,window.devicePixelRatio||1); cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); cv.style.width=W+'px'; cv.style.height=H+'px'; g.setTransform(dpr,0,0,dpr,0,0); }
resize(); addEventListener('resize',function(){ resize(); seed(); });

/* ---------- 月相（真实日期） ---------- */
function moonPhase(d){ var syn=29.530588853, ref=Date.UTC(2000,0,6,18,14)/864e5, days=d.getTime()/864e5-ref; return ((days%syn)+syn)%syn/syn; }
var lunePhase=-1, moonX=0, moonY=0, moonA=0, mist=0;
/* 月亮（预览版 phone-sky2.js，10-20：要清晰，模糊随机）：
   每次打开随机一个「透亮度」：一半以上的时候是清清楚楚的硬边月亮，偶尔隔着薄雾、边缘化开一点；月相仍按真实日期 */
var HAZE=Math.random()<.6?Math.random()*.12:.25+Math.random()*.6, RING=Math.random()<.4;
function drawLune(){
  var p=moonPhase(new Date()); if(Math.abs(p-lunePhase)<.004) return; lunePhase=p;
  var c=L.moon, x=c.getContext('2d'), R=118; x.clearRect(0,0,640,640); x.save(); x.translate(320,320);
  var soft=.97-HAZE*.22, gr=x.createRadialGradient(-R*.18,-R*.2,0,0,0,R);   /* 盘面：亮而实，边缘只留 HAZE 决定的那一点点化开 */
  gr.addColorStop(0,'#fffaf0'); gr.addColorStop(.62,'#f5efe3'); gr.addColorStop(soft,'#ece4d4'); gr.addColorStop(1,'rgba(232,224,210,'+(HAZE>.2?0:.85)+')');
  x.fillStyle=gr; x.beginPath(); x.arc(0,0,R,0,6.283); x.fill();
  /* 一点月海的影子，看得出是月亮不是灯 */
  x.save(); x.globalCompositeOperation='source-atop';
  [[-.28,-.22,.3,.09],[.18,-.32,.2,.07],[.06,.14,.34,.08],[-.36,.3,.18,.06],[.4,.26,.15,.05]].forEach(function(m){ var cx=R*m[0], cy=R*m[1], r=R*m[2], g2=x.createRadialGradient(cx,cy,0,cx,cy,r); g2.addColorStop(0,'rgba(168,160,146,'+m[3]+')'); g2.addColorStop(.7,'rgba(168,160,146,'+(m[3]*.55).toFixed(3)+')'); g2.addColorStop(1,'rgba(168,160,146,0)'); x.fillStyle=g2; x.beginPath(); x.arc(cx,cy,r,0,6.283); x.fill(); }); x.restore();
  /* 暗面：用一个错开的圆去盖，交界永远是弯弯的弧线；画到画布外，只让模糊的影子落回来擦掉 */
  var waxing=p<.5, k=(1-Math.cos(2*Math.PI*p))/2, cres=k<.5, d=cres?R*(.15+1.32*k):R*1.62*(1-k);   /* k=亮的比例；上下弦时两边都正好亮一半，衔接不跳 */
  var sx=waxing?1:-1, ro=-.38, OFF=4000;
  /* [位置:phone-sky2.js·drawLune 内弧过渡] [月牙内弧（亮暗交界）多一层淡过渡] [11-11：交界太硬；先用更大的盖圆各半透明擦两次（亮面边缘渐淡成两级台阶），再正常擦一次；新月/满月附近 sc→0 不加，避免细月牙被吃掉、满月边缘被擦] [注释时间 2026-11-11] */
  function erase(ext,sh,col){
    x.save(); x.globalCompositeOperation='destination-out'; x.fillStyle='#000'; x.shadowColor=col; x.shadowBlur=sh; x.shadowOffsetX=-OFF;
    x.translate(OFF,0); x.rotate(ro); x.scale(sx,1); x.beginPath();
    if(cres){ x.arc(-d,0,R*1.04+ext,0,6.283); }
    else{ x.rect(-R*3,-R*3,R*6,R*6); x.arc(d,0,R*1.02-ext,0,6.283); }
    x.fill('evenodd'); x.restore();
  }
  var sc=Math.min(1,k*5,(1-k)*5);
  if(sc>.05){ erase(R*.2*sc,R*.1,'rgba(0,0,0,.22)'); erase(R*.1*sc,R*.07,'rgba(0,0,0,.3)'); }
  erase(0,R*(.035+HAZE*.3),'#000');
  /* 月晕垫在底下：一圈暖白，一圈更大更淡的冷光 */
  x.globalCompositeOperation='destination-over';
  /* 月晕：贴着月亮一圈亮的光辉，往外一圈淡一圈，像真的月亮那样一层层化开；外面偶尔一道彩色的晕环。强弱每次随机 */
  var GL=.75+Math.random()*.6;
  /* 每一圈都从 0 开始画、月亮半径以内全透明——不然暗面会被月晕填亮，看着像一个更大的白盘 */
  function ring(r0,r1,stops){ var g=x.createRadialGradient(0,0,0,0,0,r1); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(Math.max(0,r0/r1-.001),'rgba(0,0,0,0)'); stops.forEach(function(t){ g.addColorStop(Math.min(1,(r0+(r1-r0)*t[0])/r1),t[1]); }); x.fillStyle=g; x.beginPath(); x.arc(0,0,r1,0,6.283); x.fill(); }
  function col(r,gb,a){ return 'rgba('+r+','+gb+','+Math.max(0,a).toFixed(3)+')'; }
  /* 贴身的光辉跟着亮的那一弯走：把画好的月亮当成形状，只取它的影子（模糊一层层加大）垫到底下 */
  var tmp=document.createElement('canvas'); tmp.width=640; tmp.height=640; tmp.getContext('2d').drawImage(c,0,0);
  [[R*.07,.42],[R*.22,.38],[R*.55,.26],[R*1.05,.16]].forEach(function(l){ x.save(); x.setTransform(1,0,0,1,0,0); x.globalCompositeOperation='destination-over';
    x.shadowColor='rgba(255,246,226,'+Math.min(1,l[1]*GL*(1-HAZE*.3)).toFixed(3)+')'; x.shadowBlur=l[0]*(1+HAZE*.6); x.shadowOffsetX=4000; x.drawImage(tmp,-4000,0); x.restore(); });
  if(RING) ring(R*1.95,R*2.55,[[0,col(210,'222,255',0)],[.35,col(214,'226,255',.07*GL)],[.55,col(246,'226,214',.06*GL)],[1,col(246,'226,214',0)]]);
  ring(R*1.5,R*2.7,[[0,col(201,'214,236',0)],[.3,col(201,'214,236',.06)],[1,col(201,'214,236',0)]]);
  x.restore();
}

/* ---------- 时间 → 各层强度 ---------- */
function ss01(a,b,x){ var t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); }
function bell(c,w,x){ var t=Math.max(0,1-Math.abs(x-c)/w); return t*t*(3-2*t); }
var cur={night:0,rain:0,snow:0,fog:0,cloud:0,thunder:0,star:0,glint:0};
function nowH(){ if(force.t==='sr') return wx.sr+0.05; if(force.t==='ss') return wx.ss-0.05; if(typeof force.t==='number') return force.t; var d=new Date(); return d.getHours()+d.getMinutes()/60+d.getSeconds()/3600; }
function update(first){
  var t=nowH(), sr=wx.sr, ss=wx.ss, e=env();
  var night=t<12?1-ss01(sr-0.8,sr+0.4,t):ss01(ss-0.1,ss+0.9,t);
  var dawn=bell(sr+0.05,1.3,t)*(1-night*.35), dusk=bell(ss-0.05,1.6,t)*(1-night*.3);
  var clear=1-e.cloud*.75;
  cur={night:night,rain:e.rain,snow:e.snow,fog:e.fog,cloud:e.cloud,thunder:e.thunder,star:night*clear*(1-e.rain*.9)*(1-e.fog*.6),glint:(1-night)*(1-e.cloud*.7)*(1-e.rain)*(1-e.fog*.5)};
  if(first) sky.classList.add('nofx');
  L.dawn.style.opacity=(dawn*.62*(1-e.rain*.4)).toFixed(3);
  L.dusk.style.opacity=(dusk*.7*(1-e.rain*.4)).toFixed(3);
  L.night.style.opacity=(night*.97).toFixed(3);
  L.wash.style.opacity=Math.min(.85,(e.rain*.7+e.snow*.35+e.cloud*.28)*(1-night*.35)).toFixed(3);
  L.fog.style.opacity=(e.fog*.8).toFixed(3);
  /* 太阳：日出时从左侧爬起，正午在屏外上方，日落沉向右侧；有云有雨就淡下去 */
  var p=(t-(sr-0.3))/((ss+0.3)-(sr-0.3)), vis=p>0&&p<1;
  var sx=W*(.12+.76*Math.max(0,Math.min(1,p))), sy=H*(.5-.66*Math.sin(Math.PI*Math.max(0,Math.min(1,p))));
  var low=1-Math.sin(Math.PI*Math.max(0,Math.min(1,p)));            /* 越靠近地平线越明显 */
  var sunA=vis?(.25+.75*low)*(1-e.cloud*.8)*(1-e.rain)*(1-night):0;
  L.sun.style.transform='translate3d('+(sx-130).toFixed(0)+'px,'+(sy-130).toFixed(0)+'px,0)';
  L.sun.style.opacity=Math.max(0,sunA).toFixed(3);
  L.sun.className='sk-sun'+(low>.55?' warm':'');
  /* 月亮：夜里在右上缓缓移动 */
  var mp=t>=12?(t-ss)/(24-ss+sr):(t+24-ss)/(24-ss+sr);
  var mq=Math.max(0,Math.min(1,mp)); drawLune();
  var lit=(1-Math.cos(2*Math.PI*lunePhase))/2;
  moonX=W-64-W*.04*mq;   /* [位置:phone-sky2.js·月亮 X] [月亮完整显示] [11-10：原圆心离右边 24px、半径约 59px，右侧被屏幕切掉约 35px；左挪到右缘留 ~13px（11-11：再右移 8px），缓移幅度 5%→4% 保证整夜都不出屏] [注释时间 2026-11-10] */ moonA=night*Math.max(clear,.5+.4*e.fog)*(1-e.rain*.85)*(1-e.fog*.1)*(.6+.4*lit);
  moonY=H*.055+52-H*.01*Math.sin(Math.PI*mq); mist=Math.max(e.fog,Math.max(0,e.cloud-.35)*.9);
  L.moon.style.transform='translate3d('+moonX.toFixed(0)+'px,'+moonY.toFixed(0)+'px,0)';
  L.moon.style.opacity=moonA.toFixed(3);
  if(LC){ LC.style.transform=L.moon.style.transform; LC.style.opacity=moonA.toFixed(3); }
  /* 夜里桌面文字切成浅色（滞回，避免来回跳） */
  var isN=D.getAttribute('data-night')==='1';
  if(!isN&&night>.55) D.setAttribute('data-night','1'); else if(isN&&night<.42) D.removeAttribute('data-night');
  P.skyReady=true; if(P.appear) P.appear.sync(); /* 小手机外观「跟随时间」读 data-night，见 phone-set.js P.appear */
  D.setAttribute('data-wx',e.rain?'rain':e.snow?'snow':e.fog?'fog':'clear');
  if(first) requestAnimationFrame(function(){ requestAnimationFrame(function(){ sky.classList.remove('nofx'); }); });
  seed();
}

/* ---------- 粒子：星星 / 雨 / 雪 / 涟漪 ---------- */
var stars=[], starDay=0, drops=[], flakes=[], rips=[], lastRip=0, nextFlash=0, flash=0;
function rnd(a,b){ return a+Math.random()*(b-a); }
/* [位置:phone-sky2.js·星星按日期定] [星星每天换一张图、同一天不变] [11-04「桌面的星星要有规律~每天变」：原来每次打开页面都 Math.random 重摆一遍，刷新一下满天星全挪位。现在用「年月日」做种子的伪随机数：同一天任何时候打开都是同一片星空，过了零点换一片；摆法用分格抖动（8 列×3 行各出一颗，不会扎堆也不会大片空着），再用同一个种子洗牌，保证先亮的那几颗（夜色浅时只亮前几颗）也是散开的。「大一点带光晕」的 4 颗也由种子定。跨零点：回到前台（visibilitychange）时检查日期，变了就重摆] [注释时间 2026-11-04] */
function dayKey(){ var d=new Date(); return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); }
function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function buildStars(){
  var key=dayKey(), R=mulberry(key*2654435761%4294967296^0x5bd1e995), cols=8, rows=3, out=[];
  var pc=document.querySelector('#home .pcard'), pb=pc&&H?pc.getBoundingClientRect().bottom/H:0;   /* [位置:phone-sky2.js·buildStars 上界] [星星不超过首页顶部情侣大卡] [11-10：按卡片实际下沿算比例，取不到（卡未渲染）回退 .3] [注释时间 2026-11-10] */
  var x0=.04, x1=.96, y0=.025, y1=(pb>.12&&pb<.6)?pb-.012:.3, cw=(x1-x0)/cols, rh=(y1-y0)/rows;
  for(var rr=0;rr<rows;rr++) for(var cc=0;cc<cols;cc++) out.push({x:x0+(cc+.15+R()*.7)*cw,y:y0+(rr+.15+R()*.7)*rh,r:(.7+R()*2.6)/2,ph:R()*6.28,sp:6.283/(2+R()*3),c:0});
  for(var i=out.length-1;i>0;i--){ var j=Math.floor(R()*(i+1)), t=out[i]; out[i]=out[j]; out[j]=t; }   /* 洗牌：前 N 颗也散开 */
  out.forEach(function(st,k){ st.c=k%2; });
  stars=out; starDay=key;
}
function seed(){
  if(!stars.length||starDay!==dayKey()) buildStars();
  var nd=Math.round(cur.rain*150), nf=Math.round(cur.snow*70);
  while(drops.length<nd) drops.push({x:rnd(-.1,1.1),y:rnd(0,1),l:rnd(10,22),v:rnd(620,980),a:rnd(.35,.8)});
  while(drops.length>nd) drops.pop();
  while(flakes.length<nf) flakes.push({x:rnd(0,1),y:rnd(0,1),r:rnd(1,2.8),v:rnd(18,48),ph:rnd(0,6.28)});
  while(flakes.length>nf) flakes.pop();
}
var SC=['255,255,255','240,242,255'];
/* [位置:phone-sky2.js·星星样式] [抄篝火页：纯白小圆点，直径 0.7~3.3px 随机，透明度 0.2↔1 按 2~5 秒周期缓动闪烁，无光晕无芒] [11-10：原「亮点加光晕」不好看，四角星/十字花哨；要篝火页那种干净的闪烁小白点，再大一丢丢] [注释时间 2026-11-10] */
var touchRips=[], lastTR=0, lastTX=0, lastTY=0;
function pt(e){ var r=D.getBoundingClientRect(); return {x:(e.clientX-r.left)*(W/r.width),y:(e.clientY-r.top)*(H/r.height)}; }
D.addEventListener('pointerdown',function(e){ if(reduce||D.querySelector('.win,.tl-ov')) return; var q=pt(e); lastTX=q.x; lastTY=q.y; lastTR=performance.now(); touchRips.push({x:q.x,y:q.y,t:0,d:.95,R:rnd(20,28)}); if(touchRips.length>14) touchRips.shift(); },{passive:true,capture:true});
D.addEventListener('pointermove',function(e){ return; if(reduce||!e.buttons&&e.pointerType==='mouse') return; if(D.querySelector('.win,.tl-ov')) return; var q=pt(e), now=performance.now(); if(now-lastTR<110||Math.hypot(q.x-lastTX,q.y-lastTY)<22) return; lastTR=now; lastTX=q.x; lastTY=q.y; touchRips.push({x:q.x,y:q.y,t:0,d:1.5,R:rnd(34,52)}); if(touchRips.length>14) touchRips.shift(); },{passive:true,capture:true});
var T0=performance.now(), last=0;
var SKYRUN=false;
function canSky(){ return !document.hidden && !D.classList.contains('app-open'); }
/* [位置:phone-sky2.js·天空帧循环] [app 打开/后台停帧] [2026-11-01 性能批 1：原来无论 app 开没开都一直 60fps 调度 rAF（app 里只是提前 return）；现在 app-open/后台直接不排帧。2026-11-01 二改：去掉 800ms 恢复轮询——关 app 由 closeApp 发 ph:appclose 事件恢复，回到前台由 visibilitychange 恢复，保证没有一个自己醒来的后台定时器] [注释时间 2026-11-01] */
function skyStart(){ if(SKYRUN||reduce) return; if(!canSky()) return; SKYRUN=true; last=0; requestAnimationFrame(frame); }
function frame(now){
  if(!canSky()){ SKYRUN=false; return; }
  requestAnimationFrame(frame);
  if(now-last<33) return; var dt=Math.min(.1,(now-last)/1000); last=now;
  if(D.querySelector('.tl-ov')) return;                    /* 时间线/全屏覆盖层打开时也停笔 */
  g.clearRect(0,0,W,H); var tt=(now-T0)/1000;
  /* 水面波纹线（很淡，慢慢漂） */
  var wa=1+cur.rain*.6, wc=cur.night>.5?'176,194,255':'255,255,255', WV=[[.60,7,.0105,.34,.11],[.69,9,.0078,.27,.085],[.78,6,.0135,.42,.125],[.88,10,.0062,.22,.08]];
  g.lineWidth=1.2; g.lineCap='round';
  for(var w=0;w<WV.length;w++){ var V=WV[w], by=H*V[0]; g.beginPath();
    for(var xx=0;xx<=W+3;xx+=3){ var yy=by+Math.sin(xx*V[2]+tt*V[3])*V[1]*wa+Math.sin(xx*V[2]*2.3+tt*V[3]*.7)*V[1]*.4; xx===0?g.moveTo(xx,yy):g.lineTo(xx,yy); }
    g.strokeStyle='rgba('+wc+','+(V[4]*(cur.night>.5?.8:1)).toFixed(3)+')'; g.stroke(); }
  /* 月前的雾：天气有雾（或云层较厚）才有，几缕横向的雾慢慢从月亮前飘过；没雾就没有 */
  var mA=mist*Math.min(1,cur.night*1.4);
  if(mA>.04){ var MW=[[0,.6,1.0,.16,.95,9],[.37,1.15,.75,.12,.7,6],[.71,-.35,.85,.1,.55,7.5]];
    for(var mi=0;mi<MW.length;mi++){ var mw=MW[mi], len=W*mw[2], u=((mw[0]+tt/(mw[5]*10))%1), cx=moonX+90-u*(len+180), cy=moonY+mw[1]*40, ry=len*mw[3];
      g.save(); g.translate(cx,cy); g.scale(1,ry/(len/2)); var mg2=g.createRadialGradient(0,0,0,0,0,len/2);
      mg2.addColorStop(0,'rgba(206,208,238,'+(mA*.6*mw[4]).toFixed(3)+')'); mg2.addColorStop(.55,'rgba(196,200,234,'+(mA*.3*mw[4]).toFixed(3)+')'); mg2.addColorStop(1,'rgba(196,200,234,0)');
      g.fillStyle=mg2; g.beginPath(); g.arc(0,0,len/2,0,6.283); g.fill(); g.restore(); } }
  /* 月光倒影：月亮正下方的水面上，几段银色短线轻轻闪 */
  if(moonA>.05&&cur.night>.3){ g.lineCap='round';
    for(var k=0;k<26;k++){ var ky=H*(.6+k*.0135), kw=(3+k*.9)*(.5+.5*Math.sin(tt*.9+k*1.7)), kx=moonX+Math.sin(tt*.5+k*2.3)*(2+k*.4);
      g.strokeStyle='rgba(226,226,255,'+(moonA*.2*(1-k/30)*(.4+.6*Math.sin(tt*1.3+k*2.1))).toFixed(3)+')'; g.lineWidth=.8;
      g.beginPath(); g.moveTo(kx-kw,ky); g.lineTo(kx+kw,ky); g.stroke(); } }
  /* 手指点出的涟漪 */
  for(var m=touchRips.length-1;m>=0;m--){ var tr=touchRips[m]; tr.t+=dt/tr.d; if(tr.t>=1){ touchRips.splice(m,1); continue; }
    var ez=1-Math.pow(1-tr.t,3), rc=cur.night>.5?'200,214,255':'255,255,255';
    for(var ri=0;ri<1;ri++){ var u=Math.max(0,Math.min(1,(tr.t-ri*.1)/(1-ri*.1))); if(u<=0) continue; var ue=1-Math.pow(1-u,3), rr=tr.R*ue*(1-ri*.22);
      g.strokeStyle='rgba('+rc+','+(Math.pow(1-u,1.6)*.3).toFixed(3)+')'; g.lineWidth=(1.9-ri*.5)*(1-u*.5); g.beginPath(); g.arc(tr.x,tr.y,rr,0,6.283); g.stroke(); }
    var gg=g.createRadialGradient(tr.x,tr.y,0,tr.x,tr.y,tr.R*ez*.8+1); gg.addColorStop(0,'rgba('+rc+','+((1-tr.t)*.07).toFixed(3)+')'); gg.addColorStop(1,'rgba('+rc+',0)'); g.fillStyle=gg; g.beginPath(); g.arc(tr.x,tr.y,tr.R*ez*.8+1,0,6.283); g.fill(); }
  /* 顶部的小光点：白天像水面反光，夜里是星星；数量随夜色增加 */
  var sn=Math.round(3+6*cur.night), sa=Math.max(cur.star,cur.glint*.7);
  if(sa>.03){
    for(var i=0;i<sn&&i<stars.length;i++){ var s=stars[i], tw=.5-.5*Math.cos(s.ph+tt*s.sp), a=sa*(.2+.8*tw), x=s.x*W, y=s.y*H;
      g.globalAlpha=a; g.fillStyle='rgba('+SC[s.c]+',1)'; g.beginPath(); g.arc(x,y,s.r,0,6.283); g.fill(); }
    g.globalAlpha=1;
  }
  if(drops.length){
    var dayC='108,136,186', nightC='214,226,255', k=cur.night, col=k>.5?nightC:dayC, slant=.22;
    g.lineWidth=1.1; g.lineCap='round';
    for(var j=0;j<drops.length;j++){ var d=drops[j]; d.y+=d.v*dt/H; d.x+=slant*d.v*dt/W*.5; if(d.y>1.05){ d.y=-.05; d.x=rnd(-.1,1.1); }
      var px=d.x*W, py=d.y*H; g.strokeStyle='rgba('+col+','+(d.a*(.5+.3*cur.rain)).toFixed(2)+')'; g.beginPath(); g.moveTo(px,py); g.lineTo(px-d.l*slant*.5,py-d.l); g.stroke(); }
    if(tt-lastRip>.16&&cur.rain>.15){ lastRip=tt; rips.push({x:rnd(.05,.95)*W,y:rnd(.45,.97)*H,t:0,R:rnd(10,26)}); }
    for(var r=rips.length-1;r>=0;r--){ var p=rips[r]; p.t+=dt/.95; if(p.t>=1){ rips.splice(r,1); continue; }
      g.strokeStyle='rgba('+col+','+((1-p.t)*.42).toFixed(2)+')'; g.lineWidth=1; g.beginPath(); g.ellipse(p.x,p.y,p.R*p.t,p.R*p.t*.4,0,0,6.283); g.stroke(); }
  }
  if(flakes.length){
    g.fillStyle='rgba(255,255,255,.85)';
    for(var q=0;q<flakes.length;q++){ var f=flakes[q]; f.y+=f.v*dt/H; f.x+=Math.sin(tt*.8+f.ph)*.012*dt*8; if(f.y>1.03){ f.y=-.03; f.x=rnd(0,1); }
      g.globalAlpha=.55+.4*Math.sin(f.ph+tt); g.beginPath(); g.arc(f.x*W,f.y*H,f.r,0,6.283); g.fill(); }
    g.globalAlpha=1;
  }
  if(cur.thunder){ if(!nextFlash) nextFlash=tt+rnd(6,14); if(tt>nextFlash){ nextFlash=tt+rnd(9,22); flash=1; } }
  if(flash>0){ flash=Math.max(0,flash-dt*3.2); L.flash.style.opacity=(flash>.5?flash*.5:flash*.2).toFixed(2); } else if(L.flash.style.opacity!=='0') L.flash.style.opacity='0';
}
skyStart();
document.addEventListener('visibilitychange',function(){ if(!document.hidden){ seed(); skyStart(); } else { SKYRUN=false; } });   /* 11-04：回前台顺手检查日期，跨零点换星空 */
document.addEventListener('ph:appclose',skyStart);   /* 2026-11-01：关 app 恢复天空（不再轮询） */

update(true); loadWx();
/* [位置:phone-sky2.js·定时器] [后台/开 app 不空转] [hidden 时跳过天空重绘和天气拉取；2026-11-01 性能批 1 起 app 打开时也跳过（桌面不可见，回来下一拍重算就准）] [注释时间 2026-10-26；2026-11-01 加 app-open 守卫] */
setInterval(function(){ if(document.hidden||D.classList.contains('app-open')) return; update(); },15000); setInterval(function(){ if(document.hidden||D.classList.contains('app-open')) return; loadWx(); },TTL+30000);
P.sky={update:update,force:function(o){ force=o||{}; update(); },state:function(){ return {wx:wx,cur:cur}; }};
})();
