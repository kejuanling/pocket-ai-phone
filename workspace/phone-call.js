/* 小手机 · 电话 v2：一团会随声音起伏的雾（粒子）+ 文字浮现的字幕 + 最近通话 */
(function(){
"use strict";
var P=window.PH, D=P.D, $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast;
var PH_ICON='<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';
var MIC='<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
var SPK='<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
var KEY='<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>';
var RECENT=[];   /* 通话记录：演示数据已删（2026-10-22），只有本机实际通话后才出现 */
/* 演示台词：以后换成真实语音转写，调用 feed(who,text) 即可 */
function aiName(){ return (P.names&&P.names.ai)?P.names.ai():'助手'; }
var SCRIPT=[
  ['ai','喂，你好。'],['me','嗯，想听听你的声音。'],['ai','我在呢，一直都在。'],
  ['me','今天有点累。'],['ai','那就什么都别想，先把手机贴近一点，听我说话。'],
  ['me','好。'],['ai','窗外的雨小了，你听。'],['ai','早点睡，明天再聊。']
];
function html(){
  var nm=esc(aiName());
  return '<div class="content cp">'+P.head('')+
    '<div class="cp-hero"><div class="cp-orb"><canvas id="cpCv"></canvas></div>'+
    '<div class="cp-nm">'+nm+'</div><div class="cp-st" id="cpSt">想听声音的时候，就打给我</div><div class="cp-tm" id="cpTm"></div></div>'+
    '<div class="cp-cap" id="cpCap"></div>'+
    '<div class="cp-actions" id="cpAct"><button class="cp-ctl tap" data-c="mute"><span>'+MIC+'</span>静音</button><button class="cp-ctl tap" data-c="spk"><span>'+SPK+'</span>扬声器</button></div>'+
    '<div class="cp-recent" id="cpRecent"><h4>最近通话</h4>'+RECENT.map(function(r,i){ return '<div class="cp-r '+r.k+'" style="--i:'+i+'"><div class="ic">'+PH_ICON+'</div><div class="tt"><b>'+nm+'</b><small>'+esc(r.d)+'</small></div><time>'+r.t+'</time></div>'; }).join('')+(RECENT.length?'':'<div class="cp-none" style="padding:18px 4px;font-size:13px;color:var(--ink3);text-align:center">还没有通话记录</div>')+'</div>'+
    '<div class="cp-bar"><button class="cp-call tap" id="cpCall" aria-label="拨打">'+PH_ICON+'</button></div></div>';
}
function setup(win){
  var root=$('.cp',win), call=$('#cpCall',win), st=$('#cpSt',win), tm=$('#cpTm',win), cap=$('#cpCap',win), cv=$('#cpCv',win);
  var state='idle', tmr=null, sec=0, timers=[], who='ai', talking=false, amp=0, tgt=0, tint=0, tintT=0;
  function fmt(s){ return ('0'+Math.floor(s/60)).slice(-2)+':'+('0'+(s%60)).slice(-2); }
  function later(f,ms){ timers.push(setTimeout(f,ms)); }
  function clearAll(){ timers.forEach(clearTimeout); timers=[]; clearInterval(tmr); }

  /* ---------- 光团：几团模糊的粉 / 桃 / 紫 / 蓝，慢慢绕着转，说话时轻轻胀一下 ---------- */
  var S=400, dpr=Math.min(window.devicePixelRatio||1,2), g=cv.getContext('2d');
  cv.width=cv.height=S*dpr; cv.style.width=cv.style.height=S+'px'; g.scale(dpr,dpr); cv.style.filter='blur(16px)';
  var B=[{o:.34,w:.31,p:0,s:.62,a:[255,200,176],b:[160,206,255]},{o:.40,w:-.23,p:1.7,s:.58,a:[255,170,206],b:[186,170,255]},{o:.30,w:.41,p:3.1,s:.56,a:[190,172,255],b:[150,218,250]},
         {o:.42,w:-.37,p:4.4,s:.5,a:[150,204,255],b:[176,234,206]},{o:.22,w:.5,p:5.5,s:.52,a:[255,226,164],b:[196,212,255]},{o:0,w:0,p:0,s:.68,a:[255,212,194],b:[190,206,255]}];
  function mix(a,b,t){ return Math.round(a[0]+(b[0]-a[0])*t)+','+Math.round(a[1]+(b[1]-a[1])*t)+','+Math.round(a[2]+(b[2]-a[2])*t); }
  var t0=performance.now(), last=t0;
  function frame(now){
    if(!win.isConnected) return;
    var dt=Math.min(.05,(now-last)/1000); last=now; var t=(now-t0)/1000;
    var base=state==='live'?.16:state==='ring'?.3+.25*Math.sin(t*5):.08;
    if(state==='live'&&talking) tgt=.35+.65*Math.abs(Math.sin(t*7.3)*Math.sin(t*2.9+1)+Math.sin(t*13.1)*.25);
    else tgt=base;
    amp+=(tgt-amp)*Math.min(1,dt*9);
    tintT=(who==='me'&&state==='live')?1:0; tint+=(tintT-tint)*Math.min(1,dt*4);
    g.clearRect(0,0,S,S);
    var R=S*.3;
    for(var k=0;k<B.length;k++){ var b=B[k];
      var ang=b.p+t*b.w*(1+amp*1.1), br=1+Math.sin(t*(.9+k*.17)+b.p)*.08+amp*.14*Math.sin(t*5+b.p*2);
      var x=S/2+Math.cos(ang)*b.o*R*(1+amp*.22), y=S/2+Math.sin(ang*1.13)*b.o*R*(1+amp*.22), r=b.s*R*br*(1+amp*.16), c=mix(b.a,b.b,tint);
      var gr=g.createRadialGradient(x,y,0,x,y,r); gr.addColorStop(0,'rgba('+c+',.82)'); gr.addColorStop(.5,'rgba('+c+',.4)'); gr.addColorStop(1,'rgba('+c+',0)');
      g.fillStyle=gr; g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- 字幕：逐字浮现 ---------- */
  function say(w,text,done){
    who=w; talking=true;
    var line=document.createElement('div'); line.className='cl '+w; cap.appendChild(line);
    while(cap.children.length>4) cap.removeChild(cap.firstChild);
    Array.prototype.forEach.call(cap.children,function(c,n,a){ c.style.setProperty('--age',a.length-1-n); });
    var j=0, chars=Array.from(text);
    (function step(){ if(state!=='live') return;
      if(j<chars.length){ var s=document.createElement('span'); s.textContent=chars[j++]; line.appendChild(s); later(step,w==='ai'?120:95); }
      else { talking=false; later(done,700); } })();
  }
  function run(n){ if(state!=='live') return; var l=SCRIPT[n%SCRIPT.length]; say(l[0],l[1],function(){ later(function(){ run(n+1); },500); }); }

  function start(){
    state='ring'; root.classList.add('ringing'); st.textContent='正在呼叫…'; tm.textContent=''; D.dataset.mood='think'; buzz([20,60,20]);
    later(function(){
      state='live'; root.classList.remove('ringing'); root.classList.add('live'); st.textContent='通话中'; D.dataset.mood='speak'; sec=0; tm.textContent='00:00'; buzz(14);
      tmr=setInterval(function(){ sec++; tm.textContent=fmt(sec); },1000); later(function(){ run(0); },900);
    },2200);
  }
  function end(){
    var s=sec; clearAll(); state='idle'; talking=false; who='ai'; root.classList.remove('ringing','live'); D.dataset.mood='app'; st.textContent='想听声音的时候，就打给我'; tm.textContent=''; buzz(10);
    setTimeout(function(){ cap.innerHTML=''; },400);
    Array.prototype.forEach.call(root.querySelectorAll('.cp-ctl.on'),function(c){ c.classList.remove('on'); });
    toast(s?('通话结束 · '+fmt(s)):'已取消');
    if(s){ var box=$('#cpRecent',win), r=document.createElement('div'); r.className='cp-r out popin'; r.innerHTML='<div class="ic">'+PH_ICON+'</div><div class="tt"><b>'+esc(aiName())+'</b><small>'+(s<60?s+' 秒':Math.floor(s/60)+' 分钟')+'</small></div><time>刚刚</time>'; var nn=box.querySelector('.cp-none'); if(nn) nn.remove(); box.insertBefore(r,box.children[1]); }
  }
  /* [位置:phone-call.js·拨打确认] [确认弹窗防误触] [10-29：大按钮一点就进呼叫，先确认再拨；文案要改直接说] [注释时间 2026-10-29] */
  call.addEventListener('click',function(){ if(state==='idle') P.pages.confirm(win,'拨打给'+aiName()+'？','接通后开始通话。','拨打',false,start); else end(); });
  $('#cpAct',win).addEventListener('click',function(e){ var c=e.target.closest('.cp-ctl'); if(!c||state!=='live') return; c.classList.toggle('on'); buzz(6); });
  var back=win.querySelector('.back'); if(back) back.addEventListener('click',function(){ if(state!=='idle'){ clearAll(); state='idle'; talking=false; D.dataset.mood='app'; } });
}
P.register('phone',{html:html,setup:setup});
})();
