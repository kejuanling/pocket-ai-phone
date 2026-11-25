/* 小手机整合版 · 页面：我的 / 配置 / 记忆池 / 唤醒
   共用一套零件：圆按钮页头、分组行、开关、步进、滑杆、子页（从右推进来）、底板、确认框。
   每个控件都有反馈：点了会动、会震、会有结果提示。接口写在各段注释里。
   [位置:phone-pages.js·文件头] [小手机各 app 页面] [「我的 / 配置 / 记忆池 / 唤醒 / 标星 / 永久上下文 / 工具集 / 提示词 / 笔记本 / 后台 / 主题 / 设置」] [注释时间 2026-11-13 更新]
   11-13 审查 A 批：配置页与记忆池页还剩一批设计稿时代的降级分支（数据没读到时照样写本地数组、播「已保存」、甚至显示编造内容），已全部改成如实拒绝——没连上就提示「没连上后台，没存」，不写本地、不播成功、不关页；假执行器 run() 与写死结果的 RUN 表、假余额、假 Key、假测试结果、相似记忆样例、记忆池设置整页设计稿一并删除。
   没连上后台时，保存类按钮一律如实提示「没连上后台，没存」，不再假装「存好了（示例）」。
   1024 更新：删掉「桌面图标样式」（iconsPage / ISK / 配置页 icons 分发）——图标只保留 PWA 图标上传（设置页「桌面图标 · 换一张」）；本地样式换皮功能未接后端，按拍板不要了。 */
(function(){
"use strict";
var P=window.PH; if(!P||!P.register) return;
var $=P.$, buzz=P.buzz, toast=P.toast;
var esc=P.esc||function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
/* [位置:phone-pages.js·wallLocal] [后端 UTC 时间转本机时间] [11-07：记忆池 / 工具集这些接口给的时间都是 toISOString 的 UTC（带 Z），前端原来直接切字符串当墙上时间印，比北京时间少 8 小时、跨夜连日期都错；统一走这里转本地再显示。返回 {d:'MM-DD', hm:'HH:mm', ym:'YYYY.MM.DD'}，解析不出来返回 null] [注释时间 2026-11-07] */
function wallLocal(iso){ var d=P.net.parse(iso); if(!d) return null;
  return {d:P.net.two(d.getMonth()+1)+'-'+P.net.two(d.getDate()), hm:P.net.two(d.getHours())+':'+P.net.two(d.getMinutes()), ym:d.getFullYear()+'.'+P.net.two(d.getMonth()+1)+'.'+P.net.two(d.getDate())}; }
var I={
  back:svg('<path d="m15 18-6-6 6-6"/>'), ch:'<svg class="ch" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>', plus:svg('<path d="M12 5v14M5 12h14"/>'),
  cam:svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'), gear:svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  heart:svg('<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/>'), chat:svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  find:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'), pin:svg('<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>'), ok:svg('<path d="m5 12 4.5 4.5L19 7"/>'),
  ai:svg('<path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3zM9 18h6M10 21h4"/>'), prompt:svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  sliders:svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'), cloud:svg('<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.2a4.4 4.4 0 0 1 .5 8.8z"/>'),
  mic:svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'), plug:svg('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'),
  star:svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'), world:svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'), grid:svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  bell:svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a2 2 0 0 0 3.4 0"/>'), key:svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'), lock:svg('<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  phone:svg('<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/>'), out:svg('<path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H8"/>'), route:svg('<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>'),
  up:svg('<path d="M12 19V5M5 12l7-7 7 7"/>'), down:svg('<path d="M12 5v14M5 12l7 7 7-7"/>'), clock:svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'), layers:svg('<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>'),
  book:svg('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/>'),
  /* [位置:phone-pages.js·I.diary] [「我的」日记入口图标] [和工作流 book 同一个本子外框（桌面日记图标同款），中间换成一颗心，一眼能区分「他的日记」和「工作流」] [注释时间 2026-11-18] */
  diary:svg('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h7"/><path d="M12 16.4s-2.5-1.5-3.3-3.1a2 2 0 0 1 3.3-2.1 2 2 0 0 1 3.3 2.1c-.8 1.6-3.3 3.1-3.3 3.1z"/>'),
  refresh:svg('<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>'), sink:svg('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>'),
  alarm:svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 2M5 3.5 2.5 6M19 3.5 21.5 6"/>'), wave:svg('<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>'), user:svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'), token:svg('<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 12h4M15 10v4"/>'),
  more:'<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18" cy="12" r="1.9"/></svg>',
  trash:svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  /* [位置:phone-pages.js·I 扩展图标] [设置页 MCP 工具组与后台组线性图标] [server: 服务器/网关，shield: 备份，wrench: 工具集合，detail: 详情列表；风格与 I 现有线性 SVG 一致] [注释时间 2026-11-24] */
  server:svg('<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><circle cx="7" cy="7" r=".8" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".8" fill="currentColor" stroke="none"/><path d="M11 7h6M11 17h6"/>'),
  backup:svg('<path d="M12 3a9 9 0 1 1-6.4 2.6"/><path d="M3 4v5h5M12 8v4l3 2"/>'),
  wrench:svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.6 5.6a1.6 1.6 0 0 0 2.3 2.3l5.6-5.6a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.3-2.3z"/>'),
  detail:svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>')
};
var AV=(function(){ var g=function(k){ var m=(getComputedStyle(document.documentElement).getPropertyValue('--av-'+k)||'').match(/url\("?([^")]+)/); return m?m[1]:''; }; return {me:function(){ return g('me')||'/uploads/img-mu9ojyma-e5b58623.jpg'; },ai:function(){ return g('ai')||'/uploads/img-mu9ok9in-09f154a0.jpg'; }}; })();

/* ================= 零件 ================= */
function head(t,right,main,left){ var bk='<button class="pg-cb tap'+(main?' back"':'" data-x="back"')+' aria-label="返回">'+I.back+'</button>'; return '<div class="pg-hd">'+(left?('<span class="pg-hdl">'+bk+left+'</span>'):bk)+'<div class="ttl">'+t+'</div>'+(right||'<span class="pg-cb ghost"></span>')+'</div>'; }
function rb(ic,c,ci){ return ic?'<span class="ri" style="'+(c?'--c:'+c+';':'')+(ci?'--ci:'+ci:'')+'">'+I[ic]+'</span>':''; }
/* r({ic,c,t,s,v,go,tg,on,st,red,id,run,data}) */
/* [位置:phone-pages.js·r·步进器] [数量器支持直接输入] [中间数字 <b> 换 <input.pg-st-v inputmode=numeric>，点数字直接打字；失焦由 wire 夹紧范围并派发 pg-st-change，读取方一律取 .pg-st input 的 .value] [注释时间 2026-11-07] */
function r(o){
  var cls='pg-r'+(o.ic?' ic':'')+(o.tg?' tg':'')+(o.on?' on':'')+(o.red?' red':'')+(o.go?' go':'')+(o.cls?' '+o.cls:'');
  var tag=(o.go||o.act)?'button':'div', attr=(o.go?' data-go="'+o.go+'"':'')+(o.act?' data-act="'+o.act+'"':'')+(o.id?' id="'+o.id+'"':'')+(o.tg?' data-tg="'+(o.tgname||String(o.t).replace(/<[^>]+>/g,'').replace(/"/g,'').trim())+'"':'')+(o.data||'');
  var right='';
  if(o.tg) right='<button type="button" class="pg-sw" role="switch" aria-checked="'+(o.on?'true':'false')+'" aria-label="'+String(o.t).replace(/<[^>]+>/g,'').replace(/"/g,'').trim()+'"></button>';
  else if(o.st) right='<span class="pg-st" data-min="'+o.st.min+'" data-max="'+o.st.max+'" data-step="'+(o.st.step||1)+'"><button type="button" data-d="-1">−</button><input class="pg-st-v" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-last="'+o.st.v+'" value="'+o.st.v+'" aria-label="数量，可直接输入"><button type="button" data-d="1">＋</button></span>';
  else if(o.right) right=o.right;
  else { if(o.v!=null) right+='<span class="rv">'+o.v+'</span>'; if(o.go) right+=I.ch; }
  return '<'+tag+' class="'+cls+'"'+attr+(tag==='button'?' type="button"':'')+'>'+rb(o.ic,o.c,o.ci)+'<span class="rt"><b>'+o.t+'</b>'+(o.s?'<small>'+o.s+'</small>':'')+'</span>'+right+'</'+tag+'>';
}
function grp(t,rows,ft,i){ return (t?'<div class="pg-gt">'+t+'</div>':'')+'<div class="pg-g pg-rise" style="--i:'+(i||0)+'">'+rows.join('')+'</div>'+(ft?'<div class="pg-ft">'+ft+'</div>':''); }
function slider(id,label,v,min,max,step,fmt){ return '<div class="pg-r col"><div class="pg-sl"><div class="sh"><span>'+label+'</span><em data-fmt="'+(fmt||'')+'">'+v+(fmt==='pc'?'%':fmt==='px'?'px':'')+'</em></div><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+v+'"></div></div>'; }
function btns(list){ return '<div class="pg-bts">'+list.map(function(b){ return '<button class="pg-btn tap '+(b[2]||'')+'" type="button" '+(b[1]?'data-run="'+b[1]+'"':'')+'>'+b[0]+'</button>'; }).join('')+'</div>'; }
function seg(names,k){ return '<div class="pg-seg" style="--n:'+names.length+';--k:'+(k||0)+'"><i></i>'+names.map(function(n,i){ return '<button type="button" data-seg="'+i+'"'+(i===(k||0)?' class="on"':'')+'>'+n+'</button>'; }).join('')+'</div>'; }

/* 一页的通用交互（开关 / 步进 / 滑杆 / 分段 / 运行按钮 / 返回 / 子页） */
function wire(root,ctx){
  root.addEventListener('click',function(e){
    var t;
    if((t=e.target.closest('.pv-i[data-tip]'))){ e.stopPropagation(); tip(t); return; }
    if((t=e.target.closest('[data-x="back"]'))&&root.contains(t)){ e.stopPropagation(); if(ctx.back) ctx.back(t); return; }
    if((t=e.target.closest('.pg-st button'))){ var st=t.parentNode, b=st.querySelector('input'), step=+st.dataset.step, v=Math.max(+st.dataset.min,Math.min(+st.dataset.max,(+b.value.replace(/,/g,''))+step*(+t.dataset.d))); b.value=v; b.dataset.last=v; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); buzz(5); return; }
    if((t=e.target.closest('.pg-r.tg .pg-sw'))){ var sw=t; t=t.closest('.pg-r'); t.classList.toggle('on'); sw.setAttribute('aria-checked',t.classList.contains('on')?'true':'false'); buzz(8); if(ctx.toggle) ctx.toggle(t,t.classList.contains('on')); return; }
    if((t=e.target.closest('[data-seg]'))){ var sg=t.parentNode, k=+t.dataset.seg; sg.style.setProperty('--k',k); Array.prototype.forEach.call(sg.querySelectorAll('button'),function(x,i){ x.classList.toggle('on',i===k); });
      /* [2026-11-06 AI的/我的 固定到顶部槽] 侧切换改成切 .lk-pane（跟页签的 .pg-pane 分开，两者都在顶部槽的兄弟关系下就不会互相干扰）；页签切换时连带显隐侧行（只有「气泡」页签有他的/我的） */
      if(sg.classList.contains('lk-side')){ var lkHost=sg.closest('.pg-sub')||sg.closest('.pg')||document; Array.prototype.forEach.call(lkHost.querySelectorAll('.lk-pane'),function(p,i){ p.classList.toggle('on',i===k); }); }
      else { var host=sg.parentNode; if(sg.closest('.lk-tabbar')) host=sg.closest('.pg')||document;   /* [2026-11-06] 页签挪到底栏后被 .lk-tabbar 包了一层，host 要从 !.pg 算，不然找不到滚动区里的面板 */
        Array.prototype.forEach.call(host.querySelectorAll(':scope > .pg-sc > .pg-pane, :scope > .pg-pane'),function(p,i){ p.classList.toggle('on',i===k); });
        }
      buzz(6); if(ctx.seg) ctx.seg(k); return; }
    if((t=e.target.closest('[data-run]'))){ if(t.dataset.run==='tp') return; /* 工具页「推送到后台」有专用监听自己处理，见 :3582 */ noLive(t); return; }
    /* [位置:phone-pages.js·wire·data-go 分发] [点行报错可见] [11-02：记忆池设置「模型」行点了完全没反应，疑似回调里抛异常被吞；ctx.go 包 try/catch，抛错时弹 toast 显示报错原文+console.error，不再静默失效] [注释时间 2026-11-02] */
    if((t=e.target.closest('[data-go]'))&&ctx.go){ buzz(6); try{ ctx.go(t.dataset.go,t); }catch(err){ try{ console.error('[data-go]',t.dataset.go,err); toast('出错了：'+String((err&&err.message)||err).slice(0,60)); }catch(_){} } return; }
    if((t=e.target.closest('[data-act]'))&&ctx.act){ ctx.act(t.dataset.act,t); return; }
  });
  /* [位置:phone-pages.js·wire·步进器手输] [数量器直接输入] [点中间数字打字：输入只留数字，Enter 直接提交；失焦夹紧 min/max、空值回退上次值，有变化才派发 pg-st-change 给各页落盘；relatedTarget 是 +/- 按钮时不派发（点击路径自己会存，避免双写）] [注释时间 2026-11-07] */
  root.addEventListener('keydown',function(e){ if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('pg-st-v')){ e.preventDefault(); e.target.blur(); } });
  root.addEventListener('focusout',function(e){ var x=e.target; if(!(x.classList&&x.classList.contains('pg-st-v'))||!x.isConnected) return; var st=x.closest('.pg-st'); if(!st) return; var min=+st.dataset.min, max=+st.dataset.max, last=parseInt(x.dataset.last,10); if(isNaN(last)) last=min; var raw=x.value.trim(), v=raw===''?NaN:Math.max(min,Math.min(max,parseInt(raw,10))); if(isNaN(v)){ v=last; x.value=v; } else if(String(v)!==raw){ x.value=v; } x.dataset.last=v;
    if(v===last) return; var rt=e.relatedTarget; if(rt&&rt.closest&&rt.closest('.pg-st button')) return; x.classList.remove('bump'); void x.offsetWidth; x.classList.add('bump'); buzz(5); st.dispatchEvent(new CustomEvent('pg-st-change',{bubbles:true})); });
  root.addEventListener('input',function(e){ var x=e.target; if(x.classList&&x.classList.contains('pg-st-v')){ var c=x.value.replace(/[^0-9]/g,''); if(c!==x.value) x.value=c; return; } if(x.type!=='range') return; var em=x.parentNode.querySelector('em'); var f=em.dataset.fmt; em.textContent=f==='pct'?Math.round(x.value*100)+'%':f==='pc'?x.value+'%':f==='px'?x.value+'px':x.value; });
  /* [位置:phone-pages.js·wire·滑杆直拖] [修复 iOS Safari 滚动容器内 input[type=range] 滑不动只能点] [2026-11-23：纵向滑让位给页面滚动，横向位移 >4px 接管并按触点位置实时算值派发 input，松手派发 change] */
  var slAct=null;
  function slVal(el,x){
    var rc=el.getBoundingClientRect(), mn=+el.min||0, mx=el.max===''?100:+el.max, st=+el.step||1;
    var p=Math.max(0,Math.min(1,(x-rc.left)/Math.max(1,rc.width)));
    var v=mn+Math.round((p*(mx-mn))/st)*st;
    v=Math.max(mn,Math.min(mx,+v.toFixed(4)));
    if(String(el.value)!==String(v)){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); }
  }
  root.addEventListener('touchstart',function(e){
    var el=e.target&&e.target.closest&&e.target.closest('.pg-sl input[type="range"]');
    if(!el||e.touches.length!==1) return;
    slAct={el:el,sx:e.touches[0].clientX,sy:e.touches[0].clientY,drag:false,moved:false};
  },{passive:true});
  root.addEventListener('touchmove',function(e){
    if(!slAct||e.touches.length!==1) return;
    var t=e.touches[0], dx=t.clientX-slAct.sx, dy=t.clientY-slAct.sy;
    if(!slAct.drag){
      if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){ slAct=null; return; }
      if(Math.abs(dx)>4) slAct.drag=true;
      else return;
    }
    if(e.cancelable) e.preventDefault();
    slAct.moved=true;
    slVal(slAct.el,t.clientX);
  },{passive:false});
  root.addEventListener('touchend',function(){
    if(!slAct) return;
    var el=slAct.el, mv=slAct.moved; slAct=null;
    if(mv) el.dispatchEvent(new Event('change',{bubbles:true}));
  },{passive:true});
  root.addEventListener('touchcancel',function(){ slAct=null; },{passive:true});
  /* [位置:phone-pages.js·wire 软键盘避让] [.pg-sc 滚动子页/主页面接入 P.kb 底部留白与聚焦滚入可视区] [键盘弹起时给 .pg-sc 补足 padding-bottom，输入框聚焦自动居中滚入；关页或节点卸载时注销 P.kb] [注释时间 2026-11-23] */
  var pgSc=root.querySelector&&root.querySelector(':scope > .pg-sc');
  if(pgSc&&!pgSc._kbWired){
    pgSc._kbWired=1;
    var pgKbOff=null, pgKbT1=0, pgKbT2=0;
    function isPgKbIn(el){
      if(!el||!el.tagName) return false;
      if(el.tagName==='TEXTAREA'||el.isContentEditable) return true;
      if(el.tagName==='INPUT'){
        var ty=(el.type||'text').toLowerCase();
        return !/^(button|submit|reset|checkbox|radio|range|color|file|hidden|image)$/.test(ty);
      }
      return false;
    }
    function pgKbNow(){
      if(!window.visualViewport) return 0;
      return Math.max(0,Math.round((window.innerHeight||document.documentElement.clientHeight||0)-visualViewport.height-visualViewport.offsetTop));
    }
    function pgScFocus(el){
      if(!el||!el.isConnected) return;
      try{ el.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){ try{ el.scrollIntoView(false); }catch(_){} }
    }
    function pgKbCleanup(){
      clearTimeout(pgKbT1); clearTimeout(pgKbT2);
      if(pgKbOff){ pgKbOff(); pgKbOff=null; }
      pgSc.style.paddingBottom='';
    }
    function applyPgKb(kb){
      if(!root.isConnected){ pgKbCleanup(); return; }
      kb=Math.max(0,Math.round(kb||0));
      var ae=document.activeElement;
      var inSc=!!(ae&&pgSc.contains(ae)&&isPgKbIn(ae));
      if(kb>60&&(inSc||pgSc.querySelector('input,textarea,[contenteditable="true"]'))){
        pgSc.style.paddingBottom=(kb+64)+'px';
        if(inSc){
          clearTimeout(pgKbT1);
          pgKbT1=setTimeout(function(){ if(root.isConnected&&document.activeElement===ae) pgScFocus(ae); },80);
        }
      } else {
        pgSc.style.paddingBottom='';
      }
    }
    pgSc.addEventListener('focusin',function(e){
      var t=e.target; if(!isPgKbIn(t)) return;
      var cur=pgKbNow(); if(cur>60) applyPgKb(cur);
      clearTimeout(pgKbT1); clearTimeout(pgKbT2);
      pgKbT1=setTimeout(function(){ if(root.isConnected&&document.activeElement===t) pgScFocus(t); },120);
      pgKbT2=setTimeout(function(){ if(root.isConnected&&document.activeElement===t) pgScFocus(t); },340);
    });
    if(P.kb) pgKbOff=P.kb(applyPgKb);
    if(root.classList&&root.classList.contains('pg-sub')){
      (root.__phOnClose=root.__phOnClose||[]).push(pgKbCleanup);
    }
  }
}
/* [位置:phone-pages.js·bgo/bend] [保存类按钮统一动效] [点按 → 转圈（图标钮只转圈，文字钮显示「保存中…」）→ 成功打勾「已保存」停 1.5 秒 → 复原；失败只抖一下并复原，原因由调用方 toast。2026-10-22 批 A-2：此前只有 run() 有完整动画，真保存多数只有灰 busy 或文字切换] [注释时间 2026-10-22] */
var BTX=new WeakMap();
function bgo(b,msg){ if(b.classList.contains('busy')) return false; clearTimeout(b._bt); if(b.classList.contains('ok')||b.classList.contains('bad')){ b.classList.remove('ok','bad'); if(BTX.has(b)) b.innerHTML=BTX.get(b); } BTX.set(b,b.innerHTML); b.classList.add('busy'); b.innerHTML='<i class="pg-spin"></i>'+(b.matches('.pg-cb,.pm2-ed')?'':(msg||'保存中…')); buzz(8); return true; }
/* [位置:phone-pages.js·bend] [失败给人看得见的原因] [11-13 审查 P2-3：失败时只抖一下、按钮文字不变，用户不知道是没存上还是自己点偏了；现在失败把按钮文字临时换成「没存上」或调用方给的 msg（700ms 后复原），不用 toast，避免和调用方已有的 toast 叠两条] [注释时间 2026-11-14] */
function bend(b,ok,msg){ clearTimeout(b._bt); var ic=b.matches('.pg-cb,.pm2-ed'), txt=BTX.has(b)?BTX.get(b):b.innerHTML; b.classList.remove('busy');
  if(ok){ b.classList.add('ok'); b.innerHTML=I.ok.replace('<svg','<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2.6"')+(ic?'':(msg||'已保存')); buzz([10,40,10]); }
  else { b.classList.add('bad'); if(!ic) b.innerHTML=(msg||'没存上'); if(P.shake) P.shake(b); }
  b._bt=setTimeout(function(){ b.classList.remove('ok','bad'); b.innerHTML=txt; BTX.delete(b); },ok?1500:900); }
/* 成功后给打勾留 450ms 再关 / 再换页（弹层、编辑卡片一成功就关掉的地方用） */
function later(fn){ setTimeout(fn,450); }
P.bgo=bgo; P.bend=bend; P.later=later;   /* 供本文件后面几个 IIFE 用 */
/* 「运行」类按钮：转圈 → 完成打勾 → 复原 */
/* [位置:phone-pages.js·noLive] [没连上后台的保存类按钮统一拒绝] [11-13 审查：数据没读到时点保存，原来转一圈说「已保存」其实没进后台，两秒后真数据回来把改动抹掉；这里统一改成如实拒绝——不写本地数组、不播成功、不关页，只抖一下并提示] [注释时间 2026-11-13] */
function noLive(b){ if(b){ clearTimeout(b._bt); b.classList.remove('busy','ok'); if(P.shake) P.shake(b); } toast('没连上后台，没存'); buzz([20,30,20]); }
/* 子页：从右边推进来，原页往左退一点 */
function sub(win,title,body,opt){
  opt=opt||{}; var base=win.querySelector('.pg:not(.pg-sub)'), s=document.createElement('div'); s.className='pg pg-sub';
  /* [2026-11-06 底部槽] opt.bottom：贴在子页底部的固定栏（气泡设置页的页签导航）。有底栏时给 .pg-sub 加 has-bot，滚动区底部留白交给底栏自己算（含安全区） */
  s.innerHTML=head(title,opt.right,0,opt.left)+(opt.top||'')+'<div class="pg-sc">'+body+'</div>'+(opt.bottom||''); if(opt.bottom) s.classList.add('has-bot');
  win.querySelector('.content').appendChild(s); requestAnimationFrame(function(){ requestAnimationFrame(function(){ s.classList.add('show'); if(base) base.classList.add('under'); }); });
  function close(){ if(s.__phOnClose) s.__phOnClose.forEach(function(f){ try{ f(); }catch(e){} }); s.classList.remove('show'); if(base&&!win.querySelectorAll('.pg-sub.show').length) base.classList.remove('under'); setTimeout(function(){ s.remove(); if(typeof alCleanup==='function') alCleanup(); },420); buzz(6); }
  wire(s,{back:function(){ if(opt.guard&&opt.guard(close)) return; close(); },go:opt.go,act:opt.act,toggle:opt.toggle,seg:opt.seg});   /* [2026-11-05 guard(close)：返回键/右滑返回前的拦截，返回 true=已接管（弹「要保存吗」），页面不关；月夜玻璃设置子页用] */ if(opt.setup) opt.setup(s,close); return s;
}
/* [位置:phone-pages.js·subLoad] [子页「数据还没到」的加载态] [11-05：人设/语音/MCP/供应商第一次进去都先画一句「还没读到数据」、数据到了也不重画。
   动画挂在子页元素 .pg-sub 自己身上（它有 position:absolute，是现成的定位祖先，inset:0 正好铺满这一页），
   不能塞进 .pg-sc 里——那样 inset:0 会相对里面某个高度 0 的 div 算，元素在但高度 0，屏幕上根本看不见（11-05 实测 phRect 高 0）。
   on 开始转并清空内容区，off 散去；子页被关掉（返回键 / 右滑返回）时自动散，不会留下一个孤儿层] [注释时间 2026-11-05；2026-11-16 批4 I1 改：创建即铺动画——之前数据已在内存/缓存时 paint 直接 off，动画从来不出；现在进子页先见动画（最短时长由 ph-load.show 兜底），on 语义不变，off 散去] */
function subLoad(s,host){
  var h=null;
  function stop(){ if(h){ h.done(); h=null; } }
  (s.__phOnClose=s.__phOnClose||[]).push(stop);
  if(P.load) h=P.load.show(s,{page:1});   /* 创建即转：有数据没数据都先动画，动画结束页面即用态（11-16 口径） */
  return {
    on:function(){ if(!h&&P.load) h=P.load.show(s,{page:1}); if(host) host.innerHTML=''; },
    off:stop
  };
}
function sheet(win,title,body,setup,right){
  var s=document.createElement('div'); s.className='pg-sheet'; s.innerHTML='<div class="scrim"></div><div class="pane"><i class="grab"></i><div class="sh"><b>'+title+'</b>'+(right||'')+'</div><div class="sb">'+body+'</div></div>';
  /* [位置:phone-pages.js·sheet 宿主兜底] [弹层挂载点] [2026-11-21 真机：极简设置「其他」是 pg-sub 子页（无 .content），从子页里调 sheet（火种 VPN / 机场订阅 / 地点）时 querySelector 抛 null 弹层出不来；同 10-30 colorSheet 先例，往上找宿主 .win 的 .content，再兜 #device / body；正常窗口调用行为不变] [注释时间 2026-11-21] */
  var host=win.querySelector('.content')||((win.closest&&win.closest('.win'))?win.closest('.win').querySelector('.content'):null)||document.getElementById('device')||document.body;
  host.appendChild(s); buzz(6); requestAnimationFrame(function(){ requestAnimationFrame(function(){ s.classList.add('show'); }); });
  var kbOff=null;
  /* [位置:phone-pages.js·sheet ESC] [键盘关底板] [11-13 审查 P2-1：配置页的底板只能点遮罩或往下拖关闭，没 ESC；关闭时注销监听防叠监听；输入法组合中的 ESC 不响应] [注释时间 2026-11-14] */
  function onKey(e){ if(e.key!=='Escape'||e.isComposing) return; e.stopPropagation(); close(); }
  document.addEventListener('keydown',onKey,true);
  function close(){ document.removeEventListener('keydown',onKey,true); clearTimeout(shFt1); clearTimeout(shFt2); if(kbOff) kbOff(); s.classList.remove('show'); setTimeout(function(){ s.remove(); },420); }
  s.querySelector('.scrim').addEventListener('click',close); wire(s,{});
  /* [位置:phone-pages.js·sheet 拉高] [配置页底板拉高] [10-28：pg-sheet 内容型底板接上拉高（natural 起步，手势共用 phone-sheetdrag）；确认框 pg-cf 是另一套 DOM 不受影响。10-31：两档化——自然高度⇄满高，不记档] [注释时间 2026-10-28；2026-10-31 两档化] */
  dragClose(s.querySelector('.pane'),close,{stretch:{natural:true}});
  /* [位置:phone-pages.js·sheet 键盘避让] [底板里有输入框时键盘盖住下半截] [键盘起来时把底板整体抬到键盘上方，并限制最高不超出可视区；收起复原；2026-11-23 补：输入框聚焦自动滚入可视区中央] [注释时间 2026-10-22；2026-11-23 补] */
  /* [位置:phone-pages.js·sheet 键盘避让 off] [关底板时注销键盘监听] [2026-10-27 审查：P.kb 原来没有注销接口，
     每开一个弹层 2 个 visualViewport 监听永不摘、闭包钉住整层 DOM，键盘每次起落跑十几个回调各写一次样式（用久了键盘一弹就卡）] [注释时间 2026-10-27] */
  var shFt1=0, shFt2=0, shSb=s.querySelector('.sb');
  function shScrollIn(el){ if(!el||!el.isConnected) return; try{ el.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){ try{ el.scrollIntoView(false); }catch(_){} } }
  if(shSb){
    shSb.addEventListener('focusin',function(e){
      var t=e.target; if(!t||!t.tagName) return;
      if(t.tagName!=='TEXTAREA'&&!t.isContentEditable&&!(t.tagName==='INPUT'&&!/^(button|submit|reset|checkbox|radio|range|color|file|hidden|image)$/.test((t.type||'text').toLowerCase()))) return;
      clearTimeout(shFt1); clearTimeout(shFt2);
      shFt1=setTimeout(function(){ if(s.isConnected&&document.activeElement===t) shScrollIn(t); },120);
      shFt2=setTimeout(function(){ if(s.isConnected&&document.activeElement===t) shScrollIn(t); },340);
    });
  }
  if(P.kb){ var pn=s.querySelector('.pane'); kbOff=P.kb(function(kb){ if(!s.isConnected){ if(kbOff) kbOff(); return; } pn.style.bottom=kb>60?kb+'px':''; pn.style.maxHeight=kb>60?'calc(100% - '+(kb+16)+'px)':''; if(kb>60){ var ae=document.activeElement; if(ae&&shSb&&shSb.contains(ae)){ clearTimeout(shFt1); shFt1=setTimeout(function(){ if(s.isConnected&&document.activeElement===ae) shScrollIn(ae); },80); } } }); }
  if(setup) setup(s,close); return s;
}
/* 底板往下拖：按住顶部（把手 / 标题那一行）往下拽，拽过一截或甩一下就关，不够就弹回去 */
function dragClose(pane,close,opts){ if(window.PH&&PH.sheetDrag) PH.sheetDrag(pane,close,opts); }
function confirmBox(win,title,msg,ok,danger,fn){
  /* [位置:phone-pages.js·confirmBox 按钮顺序] [取消在左、执行在右（不再按危险分位）] [11-13 定「危险在左、取消在右」；11-14 00:45 修：这条原来不分危险一律套用，导致「重启网关」的确认框把主按钮放到了左边，而打开它的服务弹层里重启在右边——她按原位再点一下右边，实际点中的是取消，整条链路一声不晌地结束（无请求无提示）。改成按 danger 分位：danger=true 危险在左、取消在右；danger=false 取消在左、确认在右（与打开它的按钮同侧，iOS 习惯）；data-c 值不变，仍是 0=取消 1=确认] [注释时间 2026-11-13；2026-11-14 改；2026-11-16 再改：产品确定「不管删除还是确认保存，执行键一律放右边」——danger 只决定红/主色，不再换位置] */
  var c=document.createElement('div'); c.className='pg-cf';
  var bOk='<button class="pg-btn tap '+(danger?'red':'pri')+'" data-c="1">'+ok+'</button>', bNo='<button class="pg-btn tap" data-c="0">取消</button>';
  c.innerHTML='<div class="box"><b>'+title+'</b><p>'+msg+'</p><div class="bt">'+(bNo+bOk)+'</div></div>';
  (win.querySelector('.content')||P.D||document.body).appendChild(c); buzz([10,30,10]); requestAnimationFrame(function(){ c.classList.add('show'); });   /* [2026-11-17 批5] 挂载点兜底：App 窗口有 .content，月夜玻璃这类 sub 子页没有（win.querySelector('.content') 为 null 直接抛错，E3 确认弹层因此弹不出来），兜到 #device 全屏覆盖 */
  var used=false;   /* 淡出 220ms 内再点会让 fn 跑第二遍（按下标删除会多删一条），加一次性守卫 */
  /* [位置:phone-pages.js·confirmBox ESC] [键盘当取消] [11-13 审查 P2-1：确认框没 ESC，键盘用户只能精准点「取消」；按 ESC = 点取消（不执行 fn），同样走一次性守卫] [注释时间 2026-11-14] */
  function onKey(e){ if(e.key!=='Escape'||e.isComposing) return; e.stopPropagation(); dismiss(false); }
  document.addEventListener('keydown',onKey,true);
  function dismiss(run){ if(used) return; used=true; document.removeEventListener('keydown',onKey,true); c.classList.remove('show'); setTimeout(function(){ c.remove(); },220); if(run) fn(); }
  c.addEventListener('click',function(e){ var b=e.target.closest('[data-c]'); if(!b&&e.target!==c) return; dismiss(b&&b.dataset.c==='1'); });
}
/* 隐式说明：点 ⓘ 冒一个小气泡，点别处消失（说明文字不直接铺在页面上） */
var INFO='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
function hint(txt){ return ' <span class="pv-i tap" role="button" tabindex="0" data-tip="'+txt+'" aria-label="说明">'+INFO+'</span>'; }
function tip(el){ var old=document.querySelector('.pv-tip'); if(old){ old.remove(); if(old._el===el) return; } var host=el.closest('.content')||document.body, t=document.createElement('div'); t.className='pv-tip'; t._el=el; t.textContent=el.dataset.tip; var rc=el.getBoundingClientRect(), hr=host.getBoundingClientRect(); host.appendChild(t); var w=t.offsetWidth; t.style.left=Math.max(12,Math.min(hr.width-w-12,rc.left-hr.left+rc.width/2-w/2))+'px'; t.style.top=(rc.bottom-hr.top+8)+'px'; requestAnimationFrame(function(){ t.classList.add('show'); }); buzz(5); var sc=el.closest('.pg-sc,.sb'); if(sc) sc.addEventListener('scroll',function f(){ t.remove(); sc.removeEventListener('scroll',f); }); setTimeout(function(){ document.addEventListener('click',function off(e){ if(e.target.closest('.pv-tip')) return; t.classList.remove('show'); setTimeout(function(){ t.remove(); },200); document.removeEventListener('click',off,true); if(e.target.closest('.pv-i')===el) e.stopPropagation(); },true); },0); }
function shell(t,right,body,top){ return '<div class="content"><div class="pg">'+head(t,right,1)+(top||'')+'<div class="pg-sc">'+body+'</div></div></div>'; }
/* [位置:phone-pages.js·pageSearch] [设置/配置页顶部输入即过滤] [11-13 #11：两页都是长分组列表，找一项要滚到底；顶部一个轻量搜索框，输入即隐藏不匹配的行，组内全不匹配就把组标题一起藏，清空复原；只隐藏不重画，不动任何控件状态；页面被异步重画后会自动插回去] [注释时间 2026-11-14] */
function pageSearch(win,ph,rootSel,flat){
  var host=win.querySelector(rootSel||'.pg'); if(!host||host.querySelector('.pg-q')) return;
  var sc=host.querySelector('.pg-sc')||host;
  var box=document.createElement('div'); box.className='pg-q'+(flat?' flat':'');
  box.innerHTML='<div class="pg-search">'+I.find+'<input class="pg-in" type="search" enterkeyhint="search" placeholder="'+esc(ph||'搜设置项')+'"><em class="pg-qe" hidden>没有叫这个的</em></div>';
  function mount(){ if(!host.isConnected||box.isConnected) return; var s=host.querySelector('.pg-sc'); if(s&&s.parentNode) s.parentNode.insertBefore(box,s); else host.insertBefore(box,host.firstChild); }
  mount();
  var inp=box.querySelector('input'), none=box.querySelector('.pg-qe'), q='';
  function apply(){
    var s=host.querySelector('.pg-sc')||host; if(!s) return;
    var els=s.children, hit=0;
    function hide(el,on){ el.classList.toggle('qhide',!!on); }
    for(var i=0;i<els.length;i++){ var el=els[i];
      if(el===box) continue;
      if(el.classList.contains('pg-g')){
        var rows=el.children, shown=0, gt=el.previousElementSibling;
        var gMatch=!!(q&&gt&&gt.classList.contains('pg-gt')&&(gt.textContent||'').toLowerCase().indexOf(q)>=0);   /* 搜到组名就把整组亮出来（搜「天气」不该只剩「启用天气」） */
        for(var j=0;j<rows.length;j++){ var rr=rows[j]; if(!rr.classList.contains('pg-r')) continue;
          var ok=!q||gMatch||(rr.textContent||'').toLowerCase().indexOf(q)>=0; hide(rr,q&&!ok); if(ok) shown++; }
        hide(el,q&&!shown); hit+=q?shown:0;
        if(gt&&gt.classList.contains('pg-gt')) hide(gt,q&&!shown);
      } else if(el.classList.contains('pg-gt')){ if(!q) hide(el,false); }
      else if(q){ hide(el,true); el.dataset.qh='1'; }
      else if(el.dataset.qh){ hide(el,false); delete el.dataset.qh; }
    }
    none.hidden=!(q&&!hit);
  }
  inp.addEventListener('input',function(){ q=inp.value.trim().toLowerCase(); apply(); });
  inp.addEventListener('keydown',function(e){ if(e.key!=='Enter') return; e.preventDefault(); apply(); try{ inp.blur(); }catch(_){} });
  if(window.MutationObserver){ var mo=new MutationObserver(function(){ if(!win.isConnected){ mo.disconnect(); return; } if(!box.isConnected){ mount(); if(q) apply(); } }); mo.observe(host,{childList:true}); }
}
/* [位置:phone-pages.js·threeBox] [三选一确认框] [11-25 提至组 1 导出：confirmBox 只有取消/确认两键；月夜玻璃与预设编辑页「有未保存的修改」共用三个出口：保存 / 继续编辑 / 不保存，复用 .pg-cf 外观，点遮罩=继续编辑；fn(act) act=save|keep|drop] [注释时间 2026-11-25] */
function threeBox(win,title,msg,fn){
  var c=document.createElement('div'); c.className='pg-cf c3'; c.innerHTML='<div class="box"><b>'+title+'</b><p>'+msg+'</p><div class="bt col3"><button class="pg-btn tap pri" data-c="save">保存</button><button class="pg-btn tap" data-c="keep">继续编辑</button><button class="pg-btn tap red" data-c="drop">不保存</button></div></div>';
  var host=(win.querySelector&&win.querySelector('.content'))||((win.closest&&win.closest('.win'))?win.closest('.win').querySelector('.content'):null)||document.getElementById('device')||document.body;
  host.appendChild(c); buzz([10,30,10]); requestAnimationFrame(function(){ c.classList.add('show'); });
  c.addEventListener('click',function(e){ var b=e.target.closest('[data-c]'); if(!b&&e.target!==c) return; c.classList.remove('show'); setTimeout(function(){ c.remove(); },220); fn(b?b.dataset.c:'keep'); });
}
function closeWin(win){ var b=win.querySelector('.back'); if(b) b.click(); }
P.pages={hold:hold,mountMe:function(w,r,b){ meMount(w,r,b); },mountCfg:function(w,r,b){ cfgMount(w,r,b); },cfgBodyHTML:function(){ return cfgBody(); },hint:hint,tip:tip,r:r,grp:grp,sub:sub,subLoad:subLoad,sheet:sheet,confirm:confirmBox,threeBox:threeBox,wire:wire,head:head,shell:shell,search:pageSearch,I:I,slider:slider,btns:btns,seg:seg,noLive:noLive,mdSelHtml:mdSelHtml,mdBind:mdBind};

/* ================= 我的：朋友圈 + 相册 =================
   朋友圈 = 用户的碎碎念（/diary/api/entries，add/comment/delete），助手会点赞和评论；
   相册 = 用户发的照片 + 自己上传；每张带着当时那段对话，AI 可见、可批注（后端要新做）。 */
/* [位置:phone-pages.js·相册数据] [相册页接真数据] [10-23：相册 = 聊天里长按「加入相册」的图 + 她在相册页直接上传的图 + 他存的图（<album> 标签 / album 工具）；数据在网关 data/album.json，只存引用（图片文件还在 /uploads），接口 /v1/album*；原来的演示图、假对话、假批注全部删掉] [注释时间 2026-10-23] */
var ALBUM={items:[],ok:false};
/* [位置:phone-pages.js·alSeed/alLoad] [相册缓存秒显] [有缓存（ph_c_album）先秒出上次的照片墙，alLoad 照常拉新的覆盖并回写缓存；上传/删除/改描述后都回写] [注释时间 2026-10-26] */
function alSeed(){ if(ALBUM.ok) return; var c=P.net.peek('album'); if(c&&c.length){ ALBUM.items=c; ALBUM.ok=true; } }
function alLoad(){ return P.net.get('/v1/album').then(function(r){ ALBUM.items=(r&&r.items)||[]; ALBUM.ok=true; P.net.keep('album',ALBUM.items); return ALBUM.items; }); }
function alBg(it){ return 'url(\''+it.url+'\') center/cover'; }
/* [位置:phone-pages.js·alLazy] [相册图片按需挂载] [2026-10-27（子智能体性能调查第 3 条）：相册原来把原图 URL 直接塞进每个格子的 background —— 原图 4000x3000 一张解码出来是几十 MB，几十张一次性铺开，进相册那一下必然卡（还和 pg-rise 入场动画抢主线程）。现在格子先只带 data-bg 占位，等它接近视口（含上下各 220px）才真正设置 background 并停止观察。不支持的浏览器降级成一次性全设（跟原来一样）] [注释时间 2026-10-27] */
/* 每个滚动容器（root）一个观察器：名片在「我的」页、相册在自己的 .pg-sc 里，
   共用一个实例的话 root 只会固定成先来的那个，另一处的格子会永远被判"不可见" */
var alIOs = (typeof Map==='function') ? new Map() : null;
/* [位置:phone-pages.js·alCleanup] [关掉的相册页观察器回收] [2026-10-27 审查：alIOs 是模块级 Map 且从不 delete，
   每开一次相册/「我的」就钉住一棵 DOM（整棵格子和没滚到的观察目标）永不释放。这里把滚动容器已断连的观察器
   disconnect 并删掉；在子页关闭和相册打开时各兜一次底] [注释时间 2026-10-27] */
function alCleanup(){
  if(!alIOs) return;
  Array.prototype.forEach.call(Array.from(alIOs.keys()),function(k){
    if(k&&k.nodeType===1&&!k.isConnected){ var io=alIOs.get(k); if(io&&io.disconnect) io.disconnect(); alIOs.delete(k); }
  });
}
function alLazy(box,root){
  if(!box) return;
  var els=box.querySelectorAll('[data-bg]'); if(!els.length) return;
  function mount(e){ var bg=e.getAttribute('data-bg'); if(bg){ e.style.background=bg; e.removeAttribute('data-bg'); } }
  if(typeof IntersectionObserver!=='function'||!alIOs){ Array.prototype.forEach.call(els,mount); return; }
  var key=(root&&root.nodeType===1)?root:null;
  var io=alIOs.get(key);
  if(!io){
    io=new IntersectionObserver(function(list){
      list.forEach(function(x){ if(!x.isIntersecting) return; mount(x.target); io.unobserve(x.target); });
    },{root:key,rootMargin:'220px 0px'});
    alIOs.set(key,io);
  }
  Array.prototype.forEach.call(els,function(e){ io.observe(e); });
}
function alById(id){ return ALBUM.items.filter(function(x){ return x.id===id; })[0]||null; }
function alMeta(id){ var it=alById(id), d=it&&P.net.parse(it.added_at); return d?[(d.getMonth()+1)+'月'+d.getDate()+'日',P.net.hm(d)]:['','']; }
function alMonths(items){ var g={}, order=[]; items.forEach(function(it){ var d=P.net.parse(it.added_at)||new Date(), k=d.getFullYear()*100+d.getMonth(); if(!g[k]){ g[k]={m:(d.getMonth()+1)+'月',items:[]}; order.push(k); } g[k].items.push(it); }); return order.map(function(k){ return g[k]; }); }
function alShrink(fl,max){ return new Promise(function(res,rej){ var rd=new FileReader(); rd.onerror=rej; rd.onload=function(){ var im=new Image(); im.onerror=rej; im.onload=function(){ var k=Math.min(1,max/Math.max(im.width,im.height)), c=document.createElement('canvas'); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k); c.getContext('2d').drawImage(im,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',.88)); }; im.src=rd.result; }; rd.readAsDataURL(fl); }); }
/* 「我的」= 会话页底部「我的」tab 的当页内容（不跳新窗口）：名片 + 朋友圈 + 相册。
   朋友圈直接用现在小手机的日记页（phone-diary.js，/diary/api/entries），头像下加一句签名（点一下就能改）；相册点进去，大图手指拖着翻面。 */
var SIGN_K='ph.me.sign';
function getSign(){ try{ return localStorage.getItem(SIGN_K)||'今天也在认真生活 ✦'; }catch(e){ return '今天也在认真生活 ✦'; } }
function setSign(v){ try{ localStorage.setItem(SIGN_K,v); }catch(e){} }
function meBody(){
  /* 名片上 3 个 30px 小方块也是原图，先只占位（.me-th i 有底色），首屏渲染完 700ms 再挂 —— 别和入场动画抢主线程 */
  var th=ALBUM.items.slice(0,3).map(function(it){ return '<i data-bg="'+esc(alBg(it))+'"></i>'; }).join('');
  var uNm=(P.names&&P.names.me)?P.names.me():'用户', uLt=(P.names&&P.names.letter)?P.names.letter('me'):'用';
  return '<button class="me-card pg-rise tap" data-go="prof"><div class="av me" data-l="'+esc(uLt)+'"></div><div class="tx"><b>'+esc(uNm)+'</b><small class="me-sg">'+esc(getSign())+'</small></div>'+I.ch+'</button>'+
    '<div class="pg-g pg-rise" style="--i:1">'+r({ic:'cam',t:'朋友圈',go:'posts',c:'rgba(122,160,216,.2)',right:'<span class="me-new" hidden></span>'+I.ch})+'</div>'+
    '<div class="pg-g pg-rise" style="--i:2;margin-top:12px">'+r({ic:'grid',t:'相册',go:'album',c:'rgba(232,172,92,.18)',ci:'#c58a3a',right:'<span class="me-th">'+th+'</span>'+I.ch})+'</div>'+
    '<div class="pg-g pg-rise" style="--i:3;margin-top:12px">'+r({ic:'world',t:'小世界',go:'world',c:'rgba(160,140,214,.2)',ci:'#7d6bb8'})+'</div>'+
    '<div class="pg-g pg-rise" style="--i:4;margin-top:12px">'+r({ic:'book',t:'工作流',go:'wf',c:'rgba(122,160,216,.2)',ci:'#5a7fbf'})+'</div>'+
    /* [位置:phone-pages.js·meBody 随手记入口] [「我的」里单独一行：随手记（数据=工作流/00用户随手记，页面在 phone-jot.js）] [10-28] [注释时间 2026-10-28] */
    '<div class="pg-g pg-rise" style="--i:5;margin-top:12px">'+r({ic:'ok',t:'随手记',go:'jot',c:'rgba(110,190,140,.2)',ci:'#4e9a72'})+'</div>'+
    /* [位置:phone-pages.js·meBody 日记入口] [「我的」最下方一行：日记＝他写的恋爱日记（/xie-diary/，little-world/apps/love-diary，iframe 嵌原版）] [11-18：要把小世界里 AI 的日记页接进我的；名字就叫「日记」；放最下方；不做未读红点。——注意「朋友圈」才是用户自己的碎碎念，两者别混] [注释时间 2026-11-18] */
    '<div class="pg-g pg-rise" style="--i:6;margin-top:12px">'+r({ic:'diary',t:'日记',go:'diary',c:'rgba(216,160,138,.2)',ci:'#b98a6d'})+'</div>';
}
function meHTML(){ return shell('我的','',meBody()); }
function meSetup(win){ var pg=$('.pg',win); meMount(win,pg,function(){ closeWin(win); }); }
/* 长按：按住 0.48 秒不动就算；sel 给了就只认里面那一种元素 */
function hold(el,fn,sel){ var t=0, p=null;
  el.addEventListener('pointerdown',function(e){ var x=sel?e.target.closest(sel):el; if(!x||(sel&&!el.contains(x))) return; var bt=e.target.closest('button,a,input,textarea'); if(bt&&bt!==x&&x.contains(bt)) return; p={x:e.clientX,y:e.clientY}; clearTimeout(t); t=setTimeout(function(){ p=null; fn(x); },480); });
  el.addEventListener('pointermove',function(e){ if(p&&Math.abs(e.clientX-p.x)+Math.abs(e.clientY-p.y)>10){ clearTimeout(t); p=null; } });
  ['pointerup','pointercancel'].forEach(function(k){ el.addEventListener(k,function(){ clearTimeout(t); p=null; }); });
  el.addEventListener('contextmenu',function(e){ if(!sel||e.target.closest(sel)) e.preventDefault(); });
}
function meMount(win,root,onBack){
  if(!root.innerHTML.trim()) root.innerHTML=meBody();
  /* ---------- 朋友圈：整页套用现在的日记页 ---------- */
  function openPosts(){
    var app=P.app&&P.app('diary'); if(!app){ toast('日记页没加载'); return; }
    var dot=root.querySelector('.me-new'); if(dot) dot.classList.add('seen');
    markPostsSeen();
    var s=document.createElement('div'); s.className='pg-sub dysub'; s.innerHTML=app.html();
    win.querySelector('.content').appendChild(s);
    var bk=s.querySelector('.back'); bk.classList.add('dy-bk');
    function close(){ s.classList.remove('show'); setTimeout(function(){ s.remove(); },420); buzz(6); markPostsSeen(); }
    bk.addEventListener('click',function(e){ e.stopPropagation(); close(); });
    app.setup(s);
    /* 头像下面一句话：这里只看，改在「我的」名片里 */
    var sg=document.createElement('div'); sg.className='dy-sign'; sg.innerHTML='<span>'+esc(getSign())+'</span>';
    var cv=s.querySelector('.cover'); cv.parentNode.insertBefore(sg,cv.nextSibling);
    /* 朋友圈封面：长按出抽屉换图（存后端前先只在这台手机上，ph.me.cover） */
    var CK='ph.me.cover'; try{ var ci=localStorage.getItem(CK); if(ci) cv.style.backgroundImage='url('+ci+')', cv.classList.add('dy-img'); }catch(e){}
    function pickCover(){ var f=document.createElement('input'); f.type='file'; f.accept='image/*'; f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl) return; var rd=new FileReader(); rd.onload=function(){ cv.style.backgroundImage='url('+rd.result+')'; cv.classList.add('dy-img'); try{ localStorage.setItem(CK,rd.result); }catch(er){} toast('封面换好了'); buzz([8,30,8]); }; rd.readAsDataURL(fl); }; f.click(); }
    hold(cv,function(){ buzz([10,30,10]); sheet(win,'封面','<div class="pg-g">'+r({ic:'cam',t:'换一张图',act:'pick'})+(cv.classList.contains('dy-img')?r({ic:'refresh',t:'换回默认',act:'def'}):'')+'</div>',function(sh2,cl){ sh2.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; cl(); if(x.dataset.act==='pick') pickCover(); else { cv.style.backgroundImage=''; cv.classList.remove('dy-img'); try{ localStorage.removeItem(CK); }catch(er){} toast('换回默认了'); } }); }); });
    /* 评论：长按一条删掉（/diary/api/entries/comment/delete，按评论下标删） */
    hold(s,function(c){ var post=c.closest('.post'), p=post&&post._p, i=[].indexOf.call(c.parentNode.querySelectorAll('.c'),c); buzz([10,30,10]);
      confirmBox(win,'删掉这条评论？',esc(c.textContent.slice(0,40)),'删除',true,function(){ function gone(){ c.classList.add('dy-gone'); setTimeout(function(){ c.remove(); if(p&&p.cm&&i>=0) p.cm.splice(i,1); },300); toast('删掉了'); }
        if(p&&p.id!=null&&i>=0) P.net.post('/diary/api/entries/comment/delete',{id:p.id,ci:i}).then(gone,function(){ toast('没删掉'); buzz([20,30,20]); }); else gone(); }); },'.cmt .c');
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ s.classList.add('show'); P.markAv&&P.markAv(); }); });
  }
  /* [位置:phone-pages.js·openWorld] [我的 → 小世界] [10-24 需求 1：照旧小世界门户的小卡片样式，去掉顶部大卡，左边一条虚线小径，月相一个个挂在径上（新月走到残月循环）；列的是他用 world 工具摆在 little-world/apps/world/ 下的页面（后端 GET /admin/world-pages 读目录取标题）+ 一张「谢的沙盒」（/xie-sandbox/，和其它页面同列，不单独分区）；点一张就在 App 里用 iframe 打开，返回键 / 左边缘右划都能退回来。
     注意区分：这里是 AI 的 world 沙盒；旧的「小世界·月下」门户是 workspace/index.html 那份静态网页（含在一起计时、日记入口等），本页不搬那些。情绪海图（sea）本来就在 world 目录里，会自动出现。] [注释时间 2026-10-24] */
  function openWorld(){
    var s=sub(win,'小世界','<div id="meWorld"></div>',{
      right:'<button class="pg-cb tap" data-act="up" aria-label="添加页面">'+I.plus+'</button>',
      act:function(k){ if(k==='up') pickWorldPage(); }
    });
    var box=s.querySelector('#meWorld'), n=0, LD=subLoad(s,box);
    function card(href,title,small){ var i=n++; return '<li class="pg-rise" style="--i:'+Math.min(i,10)+'"><button class="wd-c tap" type="button" data-href="'+esc(href)+'" data-t="'+esc(title)+'"><span class="phase p'+(i%8)+'"></span><span class="tx"><b>'+esc(title)+'</b>'+(small?'<small>'+esc(small)+'</small>':'')+'</span>'+I.ch+'</button></li>'; }
    /* [位置:phone-pages.js·openWorld paint] [手势中推迟重画] [缓存画一次、请求回来再整段重画，落在按下与抬起之间就把按下的卡片摘掉了] [注释时间 2026-10-27] */
    function paint(pages){ if(P.afterGesture&&!P.afterGesture('world',function(){ paint(pages); })) return; n=0;
      var cs=pages.map(function(p){ return card('/world/'+p.path,p.title,(p.desc?p.desc+' · ':'')+'更新 '+(P.net.fmtTime?P.net.fmtTime(p.mtime):'')); });
      cs.push(card('/xie-sandbox/','谢的沙盒','纸条墙 · 暗号门 · 成分表'));   /* 谢的沙盒也是小世界里的一个，不单独分区（10-24） */
      box.innerHTML='<div class="wd-st">世 界</div><ul class="wd-road">'+cs.join('')+'</ul>'; }
    /* [位置:phone-pages.js·openWorld load] [小世界列表缓存秒显] [页面列表只有他摆文件时才变：有缓存（ph_c_world）先秒出，后台照常拉新的覆盖；拉失败且已画出缓存就不清屏。2026-11-16 批4 I1：读取中的占位不再塞行内 loadBox，改由 subLoad 铺整页动画（创建即转），成功/失败都 off() 散去，缓存先画的那层由动画盖着] [注释时间 2026-10-26；2026-11-16 改] */
    var shown=false, staleW=0;   /* [2026-11-17 批5] staleW=缓存降级一次性提示标记（拉失败又画着旧列表时 toast 一次，成功后复位） */
    function load(){ var c0=P.net.peek('world'); if(c0&&c0.length&&!shown){ shown=true; paint(c0); } P.net.get('/heartbeat/admin/world-pages').then(function(r){ var ps=(r&&r.pages)||[]; P.net.keep('world',ps); shown=true; paint(ps); staleW=0; LD.off(); },function(){ if(!shown) box.innerHTML=P.net.failBox?P.net.failBox('没连上后台'):'没连上后台'; else if(!staleW){ staleW=1; toast('没连上，先显示上次的内容'); } LD.off(); }); }
    function openPage(href,title){ var t=String(title||'').slice(0,14);
      var f=sub(win,esc(t),'<div class="wd-fw"><iframe class="wd-fr" src="'+esc(href)+'" referrerpolicy="no-referrer"></iframe><i class="wd-edge"></i></div>',{}); f.classList.add('wd-view'); }
    box.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ LD.on(); load(); return; }
      var c=e.target.closest('[data-href]'); if(!c) return; buzz(6); openPage(c.getAttribute('data-href'),c.getAttribute('data-t')); });
    function pickWorldPage(){
      var inp=document.createElement('input'); inp.type='file'; inp.accept='.html,.htm,text/html'; inp.style.display='none';
      document.body.appendChild(inp);
      inp.addEventListener('change',function(){
        var fl=inp.files&&inp.files[0]; document.body.removeChild(inp);
        if(!fl) return;
        var nm=fl.name.replace(/\.[^.]+$/,'').replace(/[^\w\u4e00-\u9fa5.-]/g,'_').slice(0,30)||'page';
        var r=new FileReader();
        r.onload=function(){
          P.net.post('/heartbeat/admin/world-pages/upload',{name:nm,data:r.result}).then(function(res){
            if(res&&res.ok){ toast('已添加：'+nm); load(); } else toast((res&&res.msg)||'添加失败');
          },function(){ toast('添加失败'); });
        };
        r.readAsDataURL(fl);
      });
      inp.click();
    }
    load();
  }
  /* ---------- 日记：他写的恋爱日记，iframe 嵌原版 ---------- */
  /* [位置:phone-pages.js·openDiary] [我的 → 日记] [11-18：把「小世界」里 AI 写的日记页（/xie-diary/，little-world/apps/love-diary）接到「我的」最下方，名字就叫「日记」；拍到板上的是：iframe 嵌原版、页头页脚全保留、不要未读红点、跟随小手机日夜。11-18 二轮：原页顶上「‹ 小世界 ／ 月亮」那行去掉（返回键小手机顶栏有），昼夜切换并进「恋爱日记」标题行——见 dressHead。同源直接读写 iframe，原页文件不动；容器/边缘手势复用「我的 → 小世界」那套（.wd-view/.wd-fw/.wd-fr）] [注释时间 2026-11-18；2026-11-18 二轮改页头] */
  function openDiary(){
    var s=sub(win,'日记','<div class="wd-fw"><iframe class="wd-fr" title="日记"></iframe><i class="wd-edge"></i></div>',{});
    s.classList.add('wd-view'); buzz(6);
    /* [位置:phone-pages.js·openDiary 加载动画] [点开日记先转小手机自己的加载动画] [11-18：iframe 嵌原版时，原页面 HTML 到得快、但卡片要等 /xie-diary/api/list 回来才展开，且带逐条淡入——实测点开后 2~3 秒上半截只有搜索框、卡片区一片空白，像卡死。沿用 11-16 openWorld 的 subLoad：创建即转，等 iframe 里真画出第一篇（或空态）再散开；8 秒兜底。口令框/登录页例外：那种情况不盖，先让她看见再弹登录] [注释时间 2026-11-18] */
    var LD=subLoad(s);
    var fr=s.querySelector('.wd-fr'), mo=null, dead=false, tim=0, waited=0, asked=false;
    function dark(){ var d=document.getElementById('device'); return !!(d&&d.getAttribute('data-theme')==='dark'); }
    function doc(){ try{ return fr.contentDocument; }catch(e){ return null; } }
    /* 日夜跟随：只改 iframe 里的 data-theme，不动原页存的 xie_diary_theme（她在页内点月亮＝只这次生效，再进来还是跟小手机） */
    function syncTheme(){ var d=doc(); if(!d||!d.documentElement) return; d.documentElement.setAttribute('data-theme',dark()?'night':'paper'); }
    /* 先按当前日夜铺底色，原页面加载完之前不闪白/黑（夜间底色取自原页 body 渐变起始色 #1b1613） */
    fr.style.background=dark()?'#1b1613':'#fdf6ed';
    /* [位置:phone-pages.js·openDiary 先探登录态再给 src] [别让 iframe 里长出一个小登录页] [11-18：登录态过期时后端把 /xie-diary/ 整页踢到 /login?back=…，iframe 里就是一张套在手机里的登录页（实测清 cookie 后 frame url = /login?back=/xie-diary/），又难看又退不出。改成先探一次 /heartbeat/admin/current-session：P.net 遇 401 会弹小手机自己的登录框并重试，成功了才给 iframe 设 src，从第一帧起就是日记页] [注释时间 2026-11-18] */
    function goSrc(){ if(!dead){ fr.src='/xie-diary/'; waitReady(); } }
    if(P.net&&P.net.get) P.net.get('/heartbeat/admin/current-session').then(goSrc,function(){ if(dead) return; LD.off(); toast('没登录，日记打不开'); close(); }); else goSrc();
    function ready(){ var d=doc(); if(!d) return false; return !!(d.querySelector('#list .card')||d.querySelector('#list .empty.revealed')); }
    /* [位置:phone-pages.js·openDiary 口令门] [口令框/登录页在轮询里检测，不在 load 时就判] [11-18：iframe load 时原页面刚起跑、还没 fetch 到 401，load 那一刻 keyGate 还是 none，于是遮罩会一直空转到 8 秒超时才散——其实小手机登录框早该弹了。改成每 120ms 顺带看一眼：口令框露脸、或整页被踢到 /login，就收遮罩并调小手机登录框，登完重新给 iframe 设 src] [注释时间 2026-11-18] */
    function gateUp(){
      var d=doc(); if(!d) return false;
      var g=d.getElementById('keyGate'); if(g&&g.offsetParent!==null) return true;
      try{ if(/^\/login/.test(fr.contentWindow.location.pathname)) return true; }catch(e){}
      return false;
    }
    function stopWait(){ if(tim){ clearInterval(tim); tim=0; } }
    function askLogin(){
      if(asked) return; asked=true;
      stopWait(); LD.off();
      if(!(P.net&&P.net.login)){ asked=false; return; }
      P.net.login().then(function(){ if(dead) return; asked=false; LD.on(); goSrc(); },function(){ asked=false; });
    }
    function waitReady(){
      stopWait(); waited=0;
      tim=setInterval(function(){
        waited+=120;
        if(dead){ stopWait(); return; }
        tick();
        if(gateUp()){ askLogin(); return; }
        if(waited>8000||ready()){ stopWait(); LD.off(); }
      },120);
    }
    function close(){
      if(dead) return; dead=true;
      stopWait(); if(mo) mo.disconnect();
      s.classList.remove('show');
      var base=win.querySelector('.pg:not(.pg-sub)');
      setTimeout(function(){ s.remove(); if(base&&!win.querySelectorAll('.pg-sub.show').length) base.classList.remove('under'); },420);
      buzz(6);
    }
    /* [位置:phone-pages.js·openDiary dressHead] [去掉原页顶上那行、昼夜按钮并进标题行] [11-18：原页顶部「‹ 小世界 ／ 月亮」这一行在手机里多余（返回键小手机顶栏已有），整行去掉；但昼夜切换要留着，挪到「恋爱日记」标题同一行的右侧。同源直接搬 DOM：建一个 flex 行把 h1 和 #themeBtn 装进去、删掉 .head-row，再注入两行样式——原页文件不动，门户里直接开 /xie-diary/ 还是原样（这层只在 iframe 里生效）。原页 #themeBtn 的监听绑在元素上，移动节点不断。只在三件元素都在时才认领（__dyDressed），否则等下一轮轮询——提前认领会把还没解析完的文档永久跳过] [注释时间 2026-11-18] */
    function dressHead(d){
      if(!d||d.__dyDressed) return;
      var hr=d.querySelector('.head-row'), tb=d.querySelector('#themeBtn'), h1=d.querySelector('h1');
      if(!hr||!tb||!h1) return;
      d.__dyDressed=1;
      var row=d.createElement('div'); row.className='dy-h1row';
      h1.parentNode.insertBefore(row,h1); row.appendChild(h1); row.appendChild(tb); hr.remove();
      var st=d.createElement('style'); st.id='dyDress';
      st.textContent='.dy-h1row{display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem}.dy-h1row h1{margin:0;flex:1;min-width:0}.dy-h1row #themeBtn{margin-left:auto;flex:none}';
      (d.head||d.documentElement).appendChild(st);
    }
    /* [位置:phone-pages.js·openDiary tick] [不依赖 iframe 的 load 事件] [2026-11-18 实测：同一路径连开两次，有一次 14 秒还挂着「正在翻开恋爱日记…」和加载动画、原页头部也没被收掉——iframe 的 load 漏了，waitReady 没启动，8 秒兜底自然也不会跑，遮罩永远不散。现在源一设就开轮询，每 120ms 顺手做三件幂等的事：同步日夜、收原页头部、判卡片画好没；load 只当快路径] [注释时间 2026-11-18] */
    function tick(){ var d=doc(); if(d&&d.documentElement){ syncTheme(); dressHead(d); } }
    fr.addEventListener('load',function(){ tick(); waitReady(); });
    var dev=document.getElementById('device');
    if(dev&&typeof MutationObserver==='function'){ mo=new MutationObserver(syncTheme); mo.observe(dev,{attributes:true,attributeFilter:['data-theme']}); }
    (s.__phOnClose=s.__phOnClose||[]).push(function(){ dead=true; stopWait(); if(mo) mo.disconnect(); });
  }
  /* ---------- 相册 ---------- */
  /* [位置:phone-pages.js·fillTh] [名片小图延后挂] [3 张 30px 的格子用原图解码很浪费，且会和「我的」页入场动画抢主线程；先出占位色，700ms 后（首屏稳定了）再挂图] [注释时间 2026-10-27] */
  function fillTh(){
    var th=root.querySelector('.me-th'); if(!th) return;
    th.innerHTML=ALBUM.items.slice(0,3).map(function(it){ return '<i data-bg="'+esc(alBg(it))+'"></i>'; }).join('');
    clearTimeout(fillTh._t);
    fillTh._t=setTimeout(function(){ if(th.isConnected) alLazy(th,th.closest('.pg-sc')||root); },700);
  }
  /* [位置:phone-pages.js·fillPostsNew] [朋友圈行接真数据] [10-26：右侧「谢头像+红点」原来是写死的常亮假数据；现在进「我的」时拉 /diary/api/entries，只有存在谢（author=xie）的评论、且时间晚于上次打开朋友圈（localStorage ph.me.posts.seen）才亮头像+红点；没有未读/拉失败就整个隐藏——红点只代表真的有他新评论。ts 是 6 位微秒，削到 3 位再 parse（防 Safari 挑食）] [注释时间 2026-10-26] */
  var POSTS_SEEN_K='ph.me.posts.seen';
  function postsSeen(){ try{ return +localStorage.getItem(POSTS_SEEN_K)||0; }catch(e){ return 0; } }
  function markPostsSeen(){ try{ localStorage.setItem(POSTS_SEEN_K,String(Date.now())); }catch(e){} }
  function fillPostsNew(){
    var el=root.querySelector('.me-new'); if(!el) return;
    P.net.get('/diary/api/entries').then(function(list){
      var es=Array.isArray(list)?list:((list&&list.entries)||[]), seen=postsSeen(), fresh=0;
      es.forEach(function(p){ (p.comments||[]).forEach(function(c){
        if(c.author!=='xie'||!c.ts) return;
        var t=P.net.parse(String(c.ts).replace(/(\.\d{3})\d+$/,'$1')); if(!t) return;
        var ms=t.getTime(); if(ms>seen&&ms>fresh) fresh=ms;
      }); });
      if(fresh){ el.hidden=false; el.classList.remove('seen'); el.innerHTML='<span class="av ai" data-l="谢"></span><i></i>'; P.markAv&&P.markAv(); }
      else el.hidden=true;
    },function(){ el.hidden=true; });
  }
  function openAlbum(){
    var s=sub(win,'相册','<div id="mePhotos"></div>',{right:'<button class="pg-cb tap" data-act="up" aria-label="上传照片">'+I.plus+'</button>',act:function(k){ if(k==='up') pick(); }});
    var photos=s.querySelector('#mePhotos'), LD=subLoad(s,photos);   /* [位置:phone-pages.js·openAlbum] [读取中的整页动画] [2026-11-16 批4 I1：行内 loadBox 占位换成 subLoad（创建即转，整页动画）；缓存仍然先经 alSeed 画在底下，拉取落定才散] */
    /* [位置:phone-pages.js·openAlbum render] [手势中推迟重画] [缓存画一次、reload 回来再整段重画，落在按下与抬起之间就把按下的照片格摘掉了] [注释时间 2026-10-27] */
    /* [位置:phone-pages.js·openAlbum render] [相册不重复整段重画 + 图片按需挂载] [2026-10-27：原来打开相册会画两遍（缓存画一次、reload 回来再整段重写一次），第二遍把刚解出来的 DOM 全丢掉重建，等于把成本付两次；现在用「条目 id 串联」当签名，内容没变就不重画。格子也不再直接塞原图 background，改 data-bg + IntersectionObserver 按需挂] [注释时间 2026-10-27] */
    var lastSig='';
    function albumSig(){ return ALBUM.items.map(function(x){ return x.id; }).join(','); }
    function render(){
      if(P.afterGesture&&!P.afterGesture('album',render)) return;
      fillTh();
      if(!ALBUM.items.length){ photos.innerHTML='<div class="pd-st"><span>相册还是空的</span></div>'; lastSig=''; return; }
      var sg=albumSig();
      if(sg===lastSig&&photos.querySelector('[data-ph]')){ return; }   /* 内容没变：不重画，已经挂上的图也不重新解码 */
      lastSig=sg;
      photos.innerHTML=alMonths(ALBUM.items).map(function(g){ return '<div class="al-mon"><b>'+g.m+'</b><small>'+g.items.length+' 张</small></div><div class="al-g">'+g.items.map(function(it,i){ return '<button class="tap pg-rise" style="--i:'+Math.min(i,12)+'" data-bg="'+esc(alBg(it))+'" data-ph="'+it.id+'" aria-label="照片">'+(it.ctx&&it.ctx.length?'<span class="n">'+I.chat+'</span>':'')+'</button>'; }).join('')+'</div>'; }).join('');
      alLazy(photos,photos.closest('.pg-sc'));
    }
    function reload(){ return alLoad().then(render,function(){ if(!ALBUM.items.length) photos.innerHTML=P.net.failBox?P.net.failBox('没连上后台'):'没连上后台'; }); }
    /* [位置:phone-pages.js·openAlbum pick] [多选上传改串行] [2026-10-27 审查：原来 forEach 全部并行解码原图
       （iPhone 相册 4000x3000 一张几十 MB 位图，5 张并行几百 MB，Safari 会直接杀页面），且每张成功各 reload 一次；
       现在逐张处理（单张失败不挡后面的）、收尾统一刷一次] [注释时间 2026-10-27] */
    function pick(){ var f=document.createElement('input'); f.type='file'; f.accept='image/*'; f.multiple=true;
      f.onchange=function(){ var files=Array.prototype.slice.call(f.files||[]); if(!files.length) return;
        var chain=Promise.resolve();
        files.forEach(function(fl){ chain=chain.then(function(){ return upOne(fl); }); });
        chain.then(function(){ return reload(); }).then(function(){ toast('传好了 · '+files.length+' 张'); buzz([8,30,8]); },function(){}); };
      f.click(); }
    function upOne(fl){ buzz(8); toast('上传中…'); return alShrink(fl,1600).then(function(du){ return P.net.post('/v1/upload-image',{data:du},{timeout:120000}); }).then(function(r){ if(!r||!r.url) throw new Error(''); return P.net.post('/v1/album/add',{url:r.url,source:'upload'}); }).catch(function(e){ /* 1025：以前吞掉真实原因只说「没传上」，排障全靠猜；现在把服务端 error 字段/网络错误原样亮出来（截 44 字）；失败 resolve 不挡后面几张 */ var m=String((e&&e.message)||''); var em=m.match(/"error"\s*:\s*"([^"]+)"/); toast('没传上：'+(em?em[1]:m.replace(/^HTTP \d+\s*/,'').slice(0,44)||'网络不通')); buzz([20,30,20]); }); }
    photos.addEventListener('click',function(e){
      if(e.target.closest('[data-retry]')){ LD.on(); reload(); return; }
      var b=e.target.closest('[data-ph]'); if(!b) return; buzz(6); view(Array.prototype.slice.call(photos.querySelectorAll('[data-ph]')),b); });
    P.me.photo=function(){ var b=photos.querySelector('[data-ph]'); if(b) b.click(); };
    P.me.refreshAlbum=render;
    if(typeof alCleanup==='function') alCleanup();   /* 窗口直关（没走子页 close）时钉住的观察器在这里兜底回收 */
    alSeed(); if(ALBUM.ok) render();
    reload().then(function(){ LD.off(); },function(){ LD.off(); });   /* 初次进页：拉取落定就散动画；上传完成后的 reload 不重铺，免得刚传完又盖一层 */
  }
  /* 大图：图在正中，背后是它自己的模糊。手指按住图片左右拖 = 跟着手翻过去（3D 透视 + 光影），松手过半就翻、不过半弹回；
     背面没有底色，字浮在模糊上。底下三个图标选背面写什么；图片外面左右滑换一张。
     2026-11-10（背面误触翻面修复）：背面改成阅读态——上下滑动滚内容、不转卡片，点一下翻回正面；翻面手势只在正面生效。 */
  var AX={chat:svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),note:svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>'),desc:svg('<path d="M5 6h14M5 11h14M5 16h9"/>')};
  function face(k,id){
    var it=alById(id)||{}, m=alMeta(id);
    if(k==='chat'){
      var cx=it.ctx||[]; if(!cx.length) return '<div class="ax-h">当时的对话</div><p class="ax-none">无</p>';
      return '<div class="ax-h">当时的对话 · '+m[1]+'</div><div class="ax-chat">'+cx.map(function(c){ return '<p class="'+(c.role==='user'?'me':'ai')+'">'+esc(c.text).replace(/\n/g,'<br>')+'</p>'; }).join('')+'</div>';
    }
    if(k==='note') return '<div class="ax-h">'+(it.note_by==='ai'?'<span class="av ai" data-l="谢"></span>他的批注':'批注')+'</div>'+(it.note?'<p class="ax-note">'+esc(it.note)+'</p>':'<p class="ax-none">他还没写批注</p>');
    return '<div class="ax-h">描述</div><p class="ax-desc" contenteditable="true" spellcheck="false" data-ph="写点描述，他看不到图的时候靠它认图">'+esc(it.desc||'')+'</p>';
  }
  function view(list,el){
    var idx=list.indexOf(el), v=document.createElement('div'); v.className='al-x';
    v.innerHTML='<div class="ax-bg"></div><div class="ax-dim"></div>'+
      '<div class="ax-top"><button class="pg-cb tap" data-ax="close" aria-label="返回">'+I.back+'</button><div class="ax-dt"><b></b><small></small></div><button class="pg-cb tap" data-ax="more" aria-label="更多">'+I.more+'</button></div>'+
      '<div class="ax-st"><div class="ax-card"><div class="ax-f ax-fr"><i class="ax-sh"></i></div><div class="ax-f ax-bk"><div class="ax-in"></div></div></div></div>'+
      '<div class="ax-bar">'+['chat','note','desc'].map(function(k){ return '<button class="tap" data-k="'+k+'" aria-label="'+{chat:'当时的对话',note:'他的批注',desc:'描述'}[k]+'">'+AX[k]+'</button>'; }).join('')+'</div>';
    win.querySelector('.content').appendChild(v);
    var card=v.querySelector('.ax-card'), fr=v.querySelector('.ax-fr'), bk=v.querySelector('.ax-bk'), sh=v.querySelector('.ax-sh'), inn=v.querySelector('.ax-in'), cur='', A=0, raf=0;
    function pid(){ return list[idx].dataset.ph||''; }
    function fill(k){ cur=k; inn.innerHTML=face(k,pid()); P.markAv&&P.markAv(); Array.prototype.forEach.call(v.querySelectorAll('.ax-bar button'),function(x){ x.classList.toggle('on',x.dataset.k===k); }); }
    /* 按角度画：哪面朝前、光影、轻微缩放和抬起 */
    function draw(a){
      var rad=a*Math.PI/180, c=Math.cos(rad), s=Math.abs(Math.sin(rad)), back=c<0;
      card.style.transform='translateZ(0) rotateY('+a.toFixed(2)+'deg) scale('+(1-.07*s).toFixed(4)+')';
      fr.style.visibility=back?'hidden':'visible'; bk.style.visibility=back?'visible':'hidden';
      sh.style.opacity=(s*.9).toFixed(3); sh.style.backgroundPosition=(50+Math.sin(rad)*60).toFixed(1)+'% 0';
      fr.style.boxShadow='0 '+(24+20*s).toFixed(0)+'px '+(60+30*s).toFixed(0)+'px rgba(20,28,48,'+(.32-.12*s).toFixed(2)+'),0 0 0 .5px rgba(255,255,255,.4)';
      v.classList.toggle('reading',back);
      /* [位置:phone-pages.js·view draw] [触摸归属跟着面切换] [需求：背面是阅读态要上下滚内容（pan-y），正面才归翻面手势（none）；翻转动画途中浏览器已锁定本次触摸的手势，下一次触摸才按新值走，不会打断拖翻] [注释时间 2026-11-10，改：相册背面误触翻面修复] */
      var ta=back?'pan-y':'none'; if(card.style.touchAction!==ta) card.style.touchAction=ta;
    }
    function settle(to,dur){ var from=A, t0=performance.now(); dur=dur||620; cancelAnimationFrame(raf);
      (function f(now){ var p=Math.min(1,(now-t0)/dur), q=p-1, k=1+2.4*q*q*q+1.4*q*q; A=from+(to-from)*k; draw(A); if(p<1) raf=requestAnimationFrame(f); else { A=to; draw(A); A=((A%360)+360)%360; if(A===0&&!v.classList.contains('reading')) Array.prototype.forEach.call(v.querySelectorAll('.ax-bar button'),function(x){ x.classList.remove('on'); }); } })(t0); }
    function isBack(){ return Math.cos(A*Math.PI/180)<0; }
    function paint(dir){
      /* [位置:phone-pages.js·view paint] [大图图源与懒加载挂载解耦] [2026-10-27 审查 P0：alLazy 未挂载的格子
         只有 data-bg 没有 style.background——大图左右滑快一点、或删一张后 paint 拿到空串，白屏只剩文字] [注释时间 2026-10-27] */
      var b=list[idx], bg=b.style.background||b.getAttribute('data-bg')||'', m=alMeta(pid());
      v.querySelector('.ax-bg').style.background=bg; fr.style.background=bg;
      v.querySelector('.ax-dt b').textContent=m[0]; v.querySelector('.ax-dt small').textContent=m[1]+' · '+(idx+1)+' / '+list.length;
      if(dir){ A=0; draw(0); cur=''; Array.prototype.forEach.call(v.querySelectorAll('.ax-bar button'),function(x){ x.classList.remove('on'); }); card.classList.remove('sl','sr'); void card.offsetWidth; card.classList.add(dir>0?'sl':'sr'); }
    }
    function show(k){
      if(!k||(k===cur&&isBack())){ settle(isBack()?Math.round(A/360)*360+(A%360>180?360:0):A); buzz(6); return; }
      if(isBack()){ inn.classList.add('fade'); setTimeout(function(){ fill(k); inn.classList.remove('fade'); },160); buzz(6); return; }
      fill(k); settle(A+180); buzz(8);
    }
    /* [位置:phone-pages.js·view fit] [大图卡片宽高用像素写死] [需求：iPhone 上左滑翻面/换图后卡片被压成一条扁条（宽 310 高 56），退出重进才恢复；原来高度靠 CSS aspect-ratio:3/4 推，叠上 3D 旋转和动画时 iOS 会算塌，现在按舞台实际尺寸算好 3:4 的宽高直接写进去，CSS 里的 aspect-ratio 只留作兜底] [注释时间 2026-11-10] */
    function fit(){ var s=v.querySelector('.ax-st'), W=s.clientWidth, H=s.clientHeight; if(!W||!H) return; var w=Math.min(W*.8,320), h=w*4/3; if(h>H*.98){ h=H*.98; w=h*3/4; } card.style.width=Math.round(w)+'px'; card.style.height=Math.round(h)+'px'; }
    fit(); window.addEventListener('resize',fit);
    paint(); draw(0); requestAnimationFrame(function(){ requestAnimationFrame(function(){ v.classList.add('show'); }); });
    function close(){ window.removeEventListener('resize',fit); v.classList.remove('show'); setTimeout(function(){ v.remove(); },380); buzz(6); }
    /* 手指拖着翻 */
    var dn=null;
    /* [位置:phone-pages.js·view 手势 down] [按下时记下当时在哪面] [需求：翻面手势只在正面生效；拖动中会翻过 90°，所以要在按下那一刻定死，不能用实时的 isBack()] [注释时间 2026-11-10，改：相册背面误触翻面修复] */
    card.addEventListener('pointerdown',function(e){ if(e.target.closest('.ax-in button,.ax-desc')) return; cancelAnimationFrame(raf); dn={x:e.clientX,y:e.clientY,back:isBack(),a:A,t:performance.now(),moved:false,lx:e.clientX,lt:performance.now(),vx:0}; card.setPointerCapture(e.pointerId); });
    /* [位置:phone-pages.js·view 手势 move] [背面让路给滚动] [需求：在背面时手势不再转卡片——挪过一点就标记 moved（表示不是点按，抬起别翻面），卡片跟手转只在正面发生；原来的正面预载 fill 逻辑不变（dn.back 已挡掉背面，isBack() 判断成了恒真，顺势简化）] [注释时间 2026-11-10，改：相册背面误触翻面修复（原来背面拖 6px 就开始转卡，上滑对话被当成翻面）] */
    card.addEventListener('pointermove',function(e){ if(!dn) return;
      if(dn.back){ if(!dn.moved&&(Math.abs(e.clientY-dn.y)>6||Math.abs(e.clientX-dn.x)>6)) dn.moved=true; return; }
      var dx=e.clientX-dn.x; if(!dn.moved&&Math.abs(dx)<6) return; if(!dn.moved){ dn.moved=true; if(!cur) fill('chat'); else fill(cur); buzz(4); }
      var now=performance.now(); dn.vx=(e.clientX-dn.lx)/Math.max(1,now-dn.lt); dn.lx=e.clientX; dn.lt=now;
      A=dn.a+dx/card.offsetWidth*180; draw(A);
      var half=Math.round(A/180); if(half!==dn.h){ if(dn.h!=null) buzz(6); dn.h=half; } });
    function up(){ if(!dn) return; var d=dn; dn=null;
      if(!d.moved){ if(isBack()) show(''); else show(cur||'chat'); return; }
      var target=Math.round((A+d.vx*160)/180)*180; if(target!==Math.round(d.a/180)*180) buzz([8,24,8]); settle(target,560); }
    /* [位置:phone-pages.js·view 手势 cancel] [系统接管不当作点按] [需求：滚动一启动浏览器就发 pointercancel，原来和 pointerup 共用一个处理，滚对话会被当成「点一下」翻回正面；现在 cancel 只按当前角度就近停住，不翻面、不触发点按] [注释时间 2026-11-10，改：相册背面误触翻面修复] */
    function drop(){ if(!dn) return; var d=dn; dn=null; if(!d.moved) return; settle(Math.round(A/180)*180,240); }
    card.addEventListener('pointerup',up); card.addEventListener('pointercancel',drop);
    v.addEventListener('click',function(e){
      var t=e.target.closest('[data-k]'); if(t){ show(t.dataset.k); return; }
      t=e.target.closest('[data-ax]'); if(!t) return; var a=t.dataset.ax;
      if(a==='close') close();
      else if(a==='more') sheet(win,'这张照片','<div class="pg-g">'+r({ic:'down',t:'存到手机',act:'save'})+r({ic:'trash',t:'删除',red:1,act:'del'})+'</div>',function(sh2,cl){ sh2.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; cl(); var k=x.dataset.act, it=alById(pid());
        if(!it) return;
        if(k==='save'){ var an=document.createElement('a'); an.href=it.url; an.download=it.file||'photo.jpg'; an.target='_blank'; document.body.appendChild(an); an.click(); an.remove(); toast('在存了'); buzz(8); }
        else confirmBox(win,'删掉这张照片？','聊天记录里那张还在。','删除',true,function(){ P.net.req('/v1/album/'+encodeURIComponent(it.id),{method:'DELETE'}).then(function(){ ALBUM.items=ALBUM.items.filter(function(y){ return y.id!==it.id; }); P.net.keep('album',ALBUM.items); var b=list[idx]; b.style.transition='all .35s'; b.style.transform='scale(.5)'; b.style.opacity=0; setTimeout(function(){ b.remove(); if(P.me.refreshAlbum) P.me.refreshAlbum(); },360); list.splice(idx,1); toast('已删除'); if(!list.length){ close(); return; } idx=Math.min(idx,list.length-1); paint(1); },function(){ toast('没删掉，稍后再试'); }); }); }); });
    });
    /* 描述写完（失去焦点）存起来 */
    inn.addEventListener('focusout',function(e){ var d=e.target.closest&&e.target.closest('.ax-desc'); if(!d) return; var it=alById(pid()); if(!it) return; var tx=d.textContent.trim(); if(tx===(it.desc||'')) return;
      P.net.post('/v1/album/desc',{id:it.id,desc:tx}).then(function(){ it.desc=tx; P.net.keep('album',ALBUM.items); toast('描述存好了'); },function(){ toast('描述没存上'); }); });
    /* 图片外面左右滑：换一张 */
    var sx=0, sy=0, st=v.querySelector('.ax-st');
    st.addEventListener('pointerdown',function(e){ if(e.target.closest('.ax-card')) return; sx=e.clientX; sy=e.clientY; st._d=1; });
    st.addEventListener('pointerup',function(e){ if(!st._d) return; st._d=0; var dx=e.clientX-sx, dy=e.clientY-sy; if(Math.abs(dx)<50||Math.abs(dx)<Math.abs(dy)) return; var n=idx+(dx<0?1:-1); if(n<0||n>=list.length){ card.classList.remove('nope'); void card.offsetWidth; card.classList.add('nope'); buzz([12,30,12]); return; } idx=n; paint(dx<0?1:-1); buzz(6); });
    P.me.view={show:show,next:function(d){ idx=Math.max(0,Math.min(list.length-1,idx+(d||1))); paint(d||1); },close:close,angle:function(a){ cancelAnimationFrame(raf); if(!cur) fill('chat'); A=a; draw(a); },settle:settle};
  }
  wire(root,{back:onBack,go:function(k){
    if(k==='posts') openPosts(); else if(k==='album') openAlbum(); else if(k==='world') openWorld(); else if(k==='wf'){ if(P.wf) P.wf.open(win); else toast('工作流页没加载'); } else if(k==='jot'){ if(P.jot) P.jot.open(win); else toast('随手记页没加载'); } else if(k==='diary'){ openDiary(); }   /* 11-18 +日记（他的恋爱日记，iframe 嵌 /xie-diary/） */   /* 10-28 +随手记（phone-jot.js） */   /* 10-27 +工作流管理（phone-wf.js） */
    else if(k==='prof'){ var curMe=(P.names&&P.names.me)?P.names.me():'用户', curLt=(P.names&&P.names.letter)?P.names.letter('me'):'用'; sheet(win,'我的名片','<div class="me-pf"><div class="av me" data-l="'+esc(curLt)+'"></div></div><div class="pg-g"><div class="pg-r col"><span class="rt"><b>名字</b></span><input class="pg-in" style="margin-top:8px" value="'+esc(curMe)+'"></div><div class="pg-r col"><span class="rt"><b>签名</b></span><input class="pg-in" style="margin-top:8px" value="'+esc(getSign())+'"></div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>好</button></div>',function(sh,close){ P.markAv&&P.markAv(); sh.querySelector('[data-ok]').addEventListener('click',function(){ var v=sh.querySelectorAll('input'), nn=(v[0].value||'').trim()||'用户'; root.querySelector('.me-card b').textContent=nn; var mav=root.querySelector('.me-card .av'); if(mav) mav.setAttribute('data-l',Array.from(nn)[0]||'用'); root.querySelector('.me-sg').textContent=v[1].value; setSign(v[1].value); if(P.names) P.names.set({me:nn}); P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:{user_name:nn}}}).catch(function(){}); close(); toast('改好了'); buzz(8); }); }); }
  }});
  P.markAv&&P.markAv();
  P.me={posts:openPosts,album:openAlbum,world:openWorld,diary:openDiary,prof:function(){ root.querySelector('.me-card').click(); }};
  /* [位置:phone-pages.js·meSetup meAlbumDirect] [相册卡片直开相册] [11-16：桌面随机照片卡不再「先看我的页、等 560ms 再弹相册」——卡片点击先挂 P.meAlbumDirect，这里 setup 完立刻 openAlbum：相册子页在窗口展开动画（.win.opening .content 渐入 .12s+.38s）期间就盖上，「我的」内容还没显形就被盖住，视觉上就是直接打开相册；用完即清，普通进「我的」不受影响] [注释时间 2026-11-16] */
  if(P.meAlbumDirect){ P.meAlbumDirect=0; try{ openAlbum(); }catch(e){} }
  alSeed(); fillTh(); alLoad().then(fillTh,function(){});
  fillPostsNew();
}
P.register('me',{html:meHTML,setup:meSetup});

/* ================= 配置 =================
   AI（提示词 / 生成参数）、模型供应商（/admin/ai-providers）、图片转写与语音识别（/admin/model-roles/:role）、语音（/admin/voice-config）、
   MCP（/admin/mcp/servers）、默认模型、账号与数据（chat-settings / change-password）。 */
/* 演示供应商 / 人设 / 语音 / MCP 数据已全部删除（2026-10-22）：读不到就是空，由 load() 读真数据 */
var PROV=[];
var PERS=[];
var VPS=[];
/* [位置:phone-pages.js·VACT/DEFP 声明] [补回被「删演示数据」误删的两个变量声明] [VACT=当前朗读用的语音服务 id，DEFP=默认人设 id；都由 vcFrom / psFrom 读到真数据后赋值；文件是严格模式，不声明就直接 ReferenceError，语音模型页和人设提示词页都会空白] [注释时间 2026-10-22] */
var VACT='', DEFP='';
VPS.forEach(function(v){ v.rid=v.rid||'seed-tts-2.0'; v.emo=v.emo||'calm'; v.vol=v.vol==null?1:v.vol; v.pitch=v.pitch||0; v.sr=v.sr||(v.ty==='minimax'?32000:24000); v.fmt=v.fmt||'mp3'; });
/* 语音识别：后端只接了豆包（/admin/asr → bigmodel_nostream，独立的 asr_api_key + asr_resource_id），同一时间只用一个 */
/* 语音识别：固定两条真实链路（2026-10-23 豆包识别下线，模型走用途 voice_desc，见 lib/voice-msg.js）：
   语音消息（发出去的）= /v1/voice/send → 转写+［声音描写］（可开思考）；麦克风（输入框按住说话）= /admin/asr → 只转文字。
   模型共用「用途 voice_desc·语音识别与描述」，列表副标题的模型名 paint 时按 ROLES 现算（模型清单晚到会重画一次） */
var ASRS=[{id:'asr_voice',ty:'annotated',n:'语音消息'},{id:'asr_mic',ty:'plain',n:'麦克风'}];
function arModelDisp(){ var x=ROLES.filter(function(r){ return r[0]==='voice_desc'; })[0]; return (x&&x[2])?String(x[2]).replace(/[（）()]/g,''):'跟随默认'; }
var EMO=[['calm','平静'],['happy','开心'],['sad','难过'],['angry','生气'],['fearful','害怕'],['surprised','惊讶'],['disgusted','厌恶']], SRS=[16000,24000,32000,44100], FMTS=['mp3','wav','pcm'];
var VTEST='你好呀，今天过得怎么样？';
/* [位置:phone-pages.js·VTY] [TTS 服务商预设] [结构[名,type,后端已接?,默认接口地址,默认模型,默认音色]；2026-10-31 按 OpenAI 兼容 /audio/speech 格式补齐 Groq/阶跃/Fish Audio（接口必须填完整 /audio/speech 地址，后端 openai 分支 Bearer 直发；Fish 默认音色取自官方文档示例，失效就换）；2026-11-13 点亮 Gemini（generateContent，后端把裸 PCM 包成 WAV 回来）] [注释时间 2026-11-13] */
var VTY=[['OpenAI','openai',1,'https://api.openai.com/v1/audio/speech','gpt-4o-mini-tts','alloy'],['MiniMax','minimax',1,'https://api.minimaxi.com/v1','speech-2.8-turbo','male-qn-qingse'],['豆包','doubao',1,'','seed-tts-2.0',''],['Gemini','gemini',1,'https://generativelanguage.googleapis.com/v1beta','gemini-2.5-flash-preview-tts','Kore'],['Azure','',0],['Qwen','',0],['Qwen Audio','',0],['Groq','openai',1,'https://api.groq.com/openai/v1/audio/speech','playai-tts','Fritz-PlayAI'],['xAI','',0],['ElevenLabs','',0],['MiMo','',0],['阶跃','openai',1,'https://api.stepfun.com/v1/audio/speech','step-tts-mini','wenrounansheng'],['Fish Audio','openai',1,'https://api.fish.audio/compat/v1/audio/speech','s2-pro','933563129e564b19a115bedd57b7406a']];
/* [位置:phone-pages.js·GVOICES] [Gemini TTS 官方 30 个预置音色] [需求：Gemini 音色是固定清单（大小写敏感），选它时整表预填不用手敲；label 取官方语气描述词的中文，重复的措辞错开] [注释时间 2026-11-13] */
var GVOICES=[['明亮','Zephyr'],['活泼','Puck'],['博学','Charon'],['坚定','Kore'],['亢奋','Fenrir'],['青春','Leda'],['稳重','Orus'],['轻快','Aoede'],['随和','Callirrhoe'],['明快','Autonoe'],['气声','Enceladus'],['清晰','Iapetus'],['松弛','Umbriel'],['柔滑','Algieba'],['轻柔','Despina'],['清澈','Erinome'],['沙哑','Algenib'],['知性','Rasalgethi'],['昂扬','Laomedeia'],['轻软','Achernar'],['笃定','Alnilam'],['平稳','Schedar'],['成熟','Gacrux'],['直率','Pulcherrima'],['友好','Achird'],['随意','Zubenelgenubi'],['温柔','Vindemiatrix'],['灵动','Sadachbia'],['睿智','Sadaltager'],['温暖','Sulafat']];
/* [位置:phone-pages.js·VURL/voUrlOf] [服务商开放平台链接] [需求：充值/拿 Key 一键跳平台；按接口地址域名匹配，豆包按类型兜底，匹配不到不显示] [注释时间 2026-10-31] */
var VURL=[['mosi.cn','https://platform.mosi.cn/'],['minimaxi.com','https://platform.minimaxi.com/'],['openspeech','https://console.volcengine.com/speech/app'],['api.openai.com','https://platform.openai.com/'],['api.groq.com','https://console.groq.com/keys'],['api.stepfun.com','https://platform.stepfun.com/interface-key'],['api.fish.audio','https://fish.audio/'],['generativelanguage.googleapis.com','https://aistudio.google.com/apikey'],['dashscope','https://bailian.console.aliyun.com/'],['api.x.ai','https://console.x.ai/'],['api.elevenlabs.io','https://elevenlabs.io/app/settings/api-keys'],['portal.azure.com','https://portal.azure.com/']];
function voUrlOf(base,ty){ base=String(base||'').toLowerCase(); for(var i=0;i<VURL.length;i++){ if(base.indexOf(VURL[i][0])>=0) return VURL[i][1]; } return ty==='doubao'?'https://console.volcengine.com/speech/app':''; }
var ROLES=[['compaction','状态机',''],['memory_admit','门卫（记忆入库判定）',''],['memory_summary','两大块总结',''],['backfill','老数据重跑',''],['distill','每日蒸馏',''],['image_desc','图片转写',''],['voice_desc','语音识别与描述','']];
/* MCPS 演示数组已删（11-16 批3 K1：全仓无引用的死代码，2026-10-22 删演示数据时漏网） */
function pvLogo(p,big){ return '<span class="pvlg'+(big?' big':'')+'" style="--c:'+p.c+'">'+esc(p.n.slice(0,1).toUpperCase())+'</span>'; }
/* [位置:phone-pages.js·mdSelHtml/mdFillSel/mdGroups/mdBind] [行内原生分组下拉·全站唯一的选模型样式] [11-05 晚：模型列表统一成按供应商分组、条目只写模型名（和「这个会话·模型」长得一样，她说那样更清晰）；配置页原来点行弹自绘抽屉（顶部供应商导航+分组卡片），现在点行直接弹系统原生分组菜单，抽屉整套退场——少一层跳转，App 里只剩一种选模型的样子。行的外观完全照旧（标题+右侧小灰字+箭头），透明 select 铺满整行接管点击，值文本由 JS 同步，所以样式零变化、只是展开的列表变成分组的] [注释时间 2026-11-05] */
function mdSelHtml(o){
  return '<div class="pg-r md-r'+(o.ic?' ic':'')+(o.cls?' '+o.cls:'')+'"'+(o.id?' id="'+o.id+'"':'')+(o.k?' data-md="'+o.k+'"':'')+'>'+
    rb(o.ic,o.c,o.ci)+'<span class="rt"><b>'+o.t+'</b>'+(o.s?'<small>'+o.s+'</small>':'')+'</span>'+
    '<span class="rv"></span>'+I.ch+'<select class="mdsel" aria-label="'+esc(String(o.t).replace(/<[^>]+>/g,''))+'" data-mdfl="'+esc(o.follow||'跟随默认')+'"></select></div>';
}
/* [位置:phone-pages.js·mdFillSel] [把分组清单填进下拉] [清单形态 [[供应商名,[[值,名],…]],…]（模型）或 [[值,名],…]（别的），分组的渲染成 <optgroup>：组头供应商、条目只写模型名；存的值已经不在清单里就按「跟随」显示，别假装选中] [注释时间 2026-11-05] */
function mdFillSel(sel,groups,cur,follow){
  if(!sel) return;
  var h='<option value="">'+esc(follow||sel.getAttribute('data-mdfl')||'跟随默认')+'</option>';
  (groups||[]).forEach(function(g){ if(!g) return;
    if(Array.isArray(g[1])) h+='<optgroup label="'+esc(g[0])+'">'+(g[1]||[]).map(function(x){ return '<option value="'+esc(x[0])+'">'+esc(x[1])+'</option>'; }).join('')+'</optgroup>';
    else h+='<option value="'+esc(g[0])+'">'+esc(g[1])+'</option>'; });
  sel.innerHTML=h;
  sel.value=cur==null?'':cur;
  if(cur&&sel.value!==cur) sel.value='';
}
/* [位置:phone-pages.js·mdGroups] [取分组模型清单] [优先 P.sessOpts（本机 7 天缓存、供应商改了会 clear），没有再读 aiprovs 缓存 / 接口；停用的供应商整组不出] [注释时间 2026-11-05] */
function mdGroups(cb){
  function conv(list){ return (list||[]).map(function(p){ if(!p||p.enabled===false) return null;
    var ms=(p.models||[]).map(function(m){ var n=typeof m==='string'?m:(m&&(m.id||m.name)); return n?[p.id+'|'+n,n]:null; }).filter(Boolean);
    return ms.length?[p.name||p.id,ms]:null; }).filter(Boolean); }
  if(P.sessOpts){ P.sessOpts(true).then(function(o){ cb((o&&o.models)||[]); },function(){ cb([]); }); return; }
  var c=P.net&&P.net.peek?P.net.peek('aiprovs',864e5):null;
  if(c&&c.length){ cb(conv(c)); return; }
  P.net.get('/heartbeat/admin/ai-providers',{noLogin:true}).then(function(r){ var a=(r&&r.providers)||[]; if(P.net.keep&&a.length) P.net.keep('aiprovs',a); cb(conv(a)); },function(){ cb([]); });
}
/* [位置:phone-pages.js·mdBind] [给一行接上下拉] [cur=当前值 "供应商id|模型名"（空=跟随）；onPick(v,供应商id,模型名,旧值)；返回 {sel,row,want(v),reload()}：want=改选中值（清单还没到时先记下，到了自动应用，保存失败也用它回滚）] [注释时间 2026-11-05] */
function mdBind(row,cur,onPick,extra){
  if(!row) return null;
  /* [位置:phone-pages.js·mdBind extra] [下拉在供应商分组之上补固定项] [11-06：预设「状态机模型」要多一个「跟随全局状态机」（值 __role__）；extra=[[值,名],…]，不传=零变化] [注释时间 2026-11-06] */
  var sel=row.querySelector('select.mdsel'), rv=row.querySelector('.rv'), groups=null, wantV=cur||'', ready=false, EX=extra||[];
  function sync(){ if(!rv) return; var o=sel.options[sel.selectedIndex];
    rv.textContent=o?(o.value?o.textContent:(sel.getAttribute('data-mdfl')||'跟随默认')):(sel.getAttribute('data-mdfl')||'跟随默认'); }
  function fill(v){ mdFillSel(sel,EX.concat(groups||[]),v); sync(); }
  function load(){ mdGroups(function(g){ groups=g; fill(wantV); ready=true; }); }
  load();
  sel.addEventListener('change',function(){ var prev=wantV, v=sel.value||'';
    wantV=v; sync(); var i=v.indexOf('|');
    if(onPick) onPick(v, i<0?'':v.slice(0,i), i<0?'':v.slice(i+1), prev); });
  return {sel:sel,row:row,want:function(v){ wantV=v||''; if(ready) fill(wantV); },reload:function(){ load(); }};
}

/* [位置:phone-pages.js·promptBriefRows] [设置里的两行用途提示词] [11-20：用途提示词目录页删掉，收进设置；点开走 P.pedit，存的还是原来的接口。下标 8/7 对应 PROMPTS。同日再改：唤醒提示词这行挪去唤醒 App 设置「睡眠唤醒的细节」组，这里只留两条转写] [注释时间 2026-11-20] */
var PRBRIEF=[[8,'图片转写提示词'],[7,'语音转写提示词']];
function promptBriefRows(){
  return PRBRIEF.map(function(it){
    var v=P.pvals&&P.pvals[it[0]];
    return r({t:it[1]+(v&&v.custom_set?' <span class="pg-tag">改过</span>':''),s:v&&P.plen?P.plen(it[0]).toLocaleString()+' 字':' ',go:'pr'+it[0]});
  });
}

/* ===================== MCP 服务管理（组 1 文件级共用块，原 cfgMount 内嵌） =====================
   [位置:phone-pages.js·MCP 模块（PX/fd/kv 行/mcpCard/mcpList/mcpEdit/mcFrom/mcTo/mcSave/mcLoad/mcTools/cfgWait）]
   [11-21 工具集 MCP 改版：MCP 服务器卡要内联进工具集页、设置页要一行一台列启用的服务器，这些 UI 都不在配置页里，
   而整块逻辑原来锁在 cfgMount 闭包内。整块提到组 1 文件作用域（win 改参数传入），跨组经 P.pages.mcp 导出给工具集页（第 5 组）。
   行为不变：GET/PUT /admin/mcp/servers、逐台探测、编辑弹层、cfgWait('mc') 数据晚到重画；mcLoad 加 force（?refresh=1）和并发合并]
   [注释时间 2026-11-21] */
var PX={heart:'<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.3-8.8A5.2 5.2 0 0 1 12 6.3a5.2 5.2 0 0 1 9.3 4.9C19 15.6 12 20 12 20z"/><path d="M3.5 12h4l1.6-2.6 2.6 5 1.8-2.4h7"/></svg>',trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',eye:'<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',eyeoff:'<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',cfg:'<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',box:'<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',dl:'<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',info:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'};
function fd(label,inner,extra){ return '<div class="pv-fd'+(extra||'')+'"><label>'+label+'</label>'+inner+'</div>'; }
function kvList(rows){ return '<div class="pg-g pv-kv">'+rows.map(kvRow).join('')+'</div><div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn tap" data-kv="add">'+I.plus+' 添加一行</button></div>'; }
function kvRow(x){ return '<div class="pv-kvr"><input class="pg-in mono" placeholder="名称" value="'+esc(x[0])+'"><input class="pg-in mono" placeholder="值" value="'+esc(x[1])+'"><button class="tap" data-kv="rm" aria-label="删除">'+PX.trash+'</button></div>'; }
function kvWire(s){ s.addEventListener('click',function(e){ var b=e.target.closest('[data-kv]'); if(!b) return; buzz(6); if(b.dataset.kv==='add'){ var g=b.closest('.pg-pane').querySelector('.pv-kv'); g.insertAdjacentHTML('beforeend',kvRow(['',''])); var n=g.lastChild; n.classList.add('flash'); n.querySelector('input').focus(); } else { var rw=b.closest('.pv-kvr'); rw.classList.add('gone'); setTimeout(function(){ rw.remove(); },300); } }); }
/* ---------- MCP 服务（GET /admin/mcp/servers 会逐个探测：connected / tools[{name,description,params,enabled}] / toolCount；PUT 保存）----------
   传输类型照 mcp-client.js：streamable-http / custom-jsonrpc / auto。工具开关 = blockTools（工具集合走 mcp-tools 的 disabled）。请求头不回明文。 */
var MT={'streamable-http':'HTTP','custom-jsonrpc':'JSON-RPC','auto':'自动'};
function tl(n,d,p,on){ return {n:n,d:d,p:p||[],on:on!==false}; }
var MCPD=[];
var MC_OK=false;   /* 真数据到过（原 cfgMount 闭包里的 LV.mc，11-21 随整块上提） */
var MX={term:'<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4"/></svg>',wrench:'<svg viewBox="0 0 24 24"><path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/></svg>'};
function mcpCard(m,i){
  var en=m.tools.filter(function(t){ return t.on; }).length, st=!m.on?'off':m.ok?'ok':'bad';
  return '<button class="mc-card pg-rise tap'+(m.on?'':' dis')+'" style="--i:'+i+'" data-m="'+i+'"><span class="mc-ic '+st+'">'+MX.term+'<i></i></span><span class="mc-bd"><b>'+esc(m.n)+'</b><span class="mc-ch">'+
    (m.on?'<em class="'+(m.ok?'ok':'bad')+'">'+(m.ok?'已连接':'未连接')+'</em>':'<em class="gray">已禁用</em>')+'<em>'+MT[m.ty]+'</em>'+(m.tools.length?'<em>'+MX.wrench+en+'/'+m.tools.length+'</em>':'')+(m.own?'<em>内置</em>':'')+'</span></span><i class="pg-sw'+(m.on?' on':'')+'" data-sw></i></button>';
}
/* [位置:phone-pages.js·CFGWAIT] [配置页数据晚到就重画一次] [11-05：第一次点进「配置→人设提示词」没拉取，退出来再点才正常。
   根因：personas 挂载时就按当时的 PERS 画完了，数据 2s 后才由 load 填进来，没有任何人通知它重画。
   注意 LV.ps / LV.pv / LV.vc 只表示「真数据到了」，编辑/设为默认/删除/保存那几个分支靠它们判断该不该打接口，别拿它们当「拉完了」（原 LV.mc 已随 MCP 块上提成 MC_OK）；
   「拉完了」看 CDONE（见下面的 cfgWait/cfgReady）。2026-11-21 随 MCP 块从 cfgMount 提到文件作用域，供设置页 MCP 组 / 工具集页共用] [注释时间 2026-11-05；2026-11-21 上提] */
var CFGWAIT={ps:[],pv:[],vc:[],mc:[],rl:[]}, CDONE={ps:false,pv:false,vc:false,mc:false,rl:false}, CERR={ps:false,pv:false,vc:false,mc:false,rl:false};   /* [2026-11-16 批4 补 rl 键] rolesPage 一直在用 CDONE.rl / cfgWait('rl',…)，但这两张表里根本没有 rl：cfgWait('rl') 会 push 到 undefined 直接抛 TypeError（只在「角色清单还没回来就点进用途模型」那条路径走到，所以一直没被发现）；补上键，顺手把模型清单的晚到重画接回统一接线 */
/* [位置:phone-pages.js·cfgWait/cfgReady] [配置子页「数据晚到就重画一次」的统一接线] [11-05：人设提示词页第一次点进去没拉取，退出来再点才正常；同模式的还有语音 / MCP / 供应商。
   病根一样：子页挂载时就按当时的内存数组画完了，数据 2s 后才由 load 填进来，没有人通知它重画。
   用法：子页 paint 里先 cfgWait(键, paint) 登记一次，load/mcLoad 拿到结果（成功或失败都算）调 cfgReady(键, ok) 把登记的页面重画一遍。
   CDONE=这次拉取已经有结果了（不是「有数据」），没好之前子页显示加载动画；CERR=失败了，显示「没读到数据，网络好了再进来看看」。都只认第一次结果，重试不会来回翻] [注释时间 2026-11-05] */
function cfgWait(k,fn){ if(CDONE[k]) return; CFGWAIT[k].push(fn); }
function cfgReady(k,ok){ if(CDONE[k]) return; CDONE[k]=true; CERR[k]=!ok;
  var a=CFGWAIT[k]||[]; CFGWAIT[k]=[]; a.forEach(function(f){ try{ f(); }catch(e){ if(window.console) console.warn('[cfgReady]',e); } }); }
var MCAB='/heartbeat/admin/', MC_PEND=null;
function mcFrom(list,fromCache){ MCPD.length=0; (list||[]).forEach(function(x){ var hd=Object.keys(x.headers||{}).map(function(k){ return [k,'']; });
    MCPD.push({id:x.id,raw:x,n:x.name||'',ty:MT[x.type]?x.type:'auto',on:x.enabled!==false,ok:!!x.connected,err:x.error||x.note||'',url:x.url||'',hd:hd,own:!!x.managedTools,tools:(x.tools||[]).map(function(t){ return tl(t.name,t.description||'',t.params||Object.keys((t.inputSchema&&t.inputSchema.properties)||{}),t.enabled!==false); })}); });
  if(!fromCache){ MC_OK=true; if(P.net&&P.net.keep&&list) P.net.keep('mcpsrv',list); cfgReady('mc',true); } }
function mcTo(m){ var o=Object.assign({},m.raw||{}); ['connected','toolCount','tools','error','note','headers_set','managedTools'].forEach(function(k){ delete o[k]; }); if(!m.id) m.id=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():'mc_'+Date.now().toString(36);
  o.id=m.id; o.name=m.n; o.type=m.ty; o.url=m.url; o.enabled=!!m.on; var h={}; (m.hd||[]).forEach(function(x){ if(x[0]) h[x[0]]=x[1]||''; }); o.headers=h; if(!m.own&&m.tools.length) o.blockTools=m.tools.filter(function(t){ return !t.on; }).map(function(t){ return t.n; }); return o; }
function mcSave(){ if(!MC_OK) return Promise.resolve(); return P.net.req(MCAB+'mcp/servers',{method:'PUT',body:{servers:MCPD.map(mcTo)}}).catch(function(e){ toast('MCP 没存上'); buzz([20,30,20]); throw e; }); }
/* [位置:phone-pages.js·mcLoad] [force 与并发合并] [11-21：force=true 带 ?refresh=1 让后端跳过 60 秒探测缓存（探测按钮用）；在途请求直接复用同一个 Promise——30 秒后台轮询和页面各自触发也不会打出双份] [注释时间 2026-11-21] */
function mcLoad(force){
  if(MC_PEND&&!force) return MC_PEND;
  MC_PEND=P.net.get(MCAB+'mcp/servers'+(force?'?refresh=1':'')).then(function(r){ mcFrom((r&&r.servers)||[]); },function(e){ cfgReady('mc',false); throw e; });
  var fin=function(){ MC_PEND=null; };
  MC_PEND.then(fin,fin);
  return MC_PEND;
}
function mcTools(m){ if(!m.own) return mcSave(); return P.net.req(MCAB+'tools',{method:'PUT',body:{disabled:m.tools.filter(function(t){ return !t.on; }).map(function(t){ return t.n; })}}).catch(function(){ toast('工具开关没存上'); }); }
/* [位置:phone-pages.js·mcpList(win,o.direct)] [工具集直达 MCP 页] [11-17：从工具集点「MCP 服务」，原来是先开配置 App 露出配置首页、480ms 后 MCP 子页再滑进来（先跳配置页）；返回时 MCP 页只关自己，落在配置首页，再返回才关配置窗口。现在 o.direct：MCP 页创建即就位（.direct 去掉滑入动画），返回键 / 右滑返回直接关掉整个配置窗口（closeApp 把当前窗口还给底下的工具集）；宽屏右栏是替换式，关掉后把工具集重新开回右栏。11-21 工具集页改为内联卡片（tlMcHTML），本页保留给配置页 go 路由 'mcp'，win 由调用方传入] [注释时间 2026-11-17；2026-11-21 加 win 参数] */
function mcpList(win,o){
  var direct=!!(o&&o.direct), s;
  s=sub(win,'MCP','<div id="mcL"></div>',{guard:direct?function(){ try{ (s.__phOnClose||[]).forEach(function(f){ f(); }); }catch(e){} closeWin(win); if(document.documentElement.classList.contains('wide')&&P.open) setTimeout(function(){ P.open('tools'); },30); return true; }:null,right:'<span class="pv-hd"><button class="pg-cb tap" data-act="probe" aria-label="重新探测">'+I.refresh+'</button><button class="pg-cb tap" data-act="add" aria-label="添加">'+I.plus+'</button></span>',
    act:function(k,t){ if(k==='add') mcpEdit(win,-1,paint); else if(MC_OK){ buzz(6); probe(t).then(function(){ toast('探测完：'+MCPD.filter(function(m){ return m.on&&m.ok; }).length+' 个连上'); buzz([8,30,8]); }); } else { buzz(6); probe(t).then(function(){ toast(MC_OK?'探测完：'+MCPD.filter(function(m){ return m.on&&m.ok; }).length+' 个连上':'没读到服务清单，稍后再试'); }); } }});
  var L=s.querySelector('#mcL'), LD=subLoad(s,L); s.classList.add('pv-dt'); if(direct) s.classList.add('direct');
  function probe(t){ if(t) t.classList.add('spin'); Array.prototype.forEach.call(L.querySelectorAll('.mc-card:not(.dis) .mc-ic'),function(x){ x.className='mc-ic wait'; });
    return mcLoad(true).then(function(){ if(t) t.classList.remove('spin'); paint(); },function(){ if(t) t.classList.remove('spin'); paint(); if(P.net.offline) P.net.offline(); }); }   /* [11-21] probe 改 mcLoad(true)：后端有了 60 秒探测缓存，强制重探才是「探测」该有的语义 */
  if(!MC_OK) setTimeout(function(){ probe(s.querySelector('[data-act="probe"]')).then(function(){ var n=MCPD.filter(function(m){ return m.on&&m.ok; }).length; if(MC_OK) toast(n+' 个连上了'); }); },60);
  function paint(flash){
    if(!MCPD.length&&!CDONE.mc){ LD.on(); return; }   /* 探测还没回来：转圈，别先说「还没读到数据」 */
    LD.off();
    L.innerHTML=MCPD.map(mcpCard).join('')||'<div class="pg-empty">'+(CERR.mc?'没读到数据，网络好了再进来看看':'还没有 MCP 服务')+'</div>'; var cnt=document.querySelector('[data-go="mcp"] .rv'); if(cnt) cnt.textContent=MCPD.filter(function(m){ return m.on; }).length+' / '+MCPD.length+' 开着'; if(flash!=null){ var n=L.querySelector('[data-m="'+flash+'"]'); if(n){ n.classList.add('flash'); n.scrollIntoView({block:'center',behavior:'smooth'}); } } }
  cfgWait('mc',function(){ paint(); });
  paint();
  L.addEventListener('click',function(e){ var c=e.target.closest('.mc-card'); if(!c) return; var i=+c.dataset.m, m=MCPD[i];
    if(e.target.closest('[data-sw]')&&MC_OK){ m.on=!m.on; buzz(8); paint(); mcSave().then(function(){ toast(m.n+(m.on?' 开了，探测一下…':' 关了，他调不到了')); if(m.on) probe(); },function(){ m.on=!m.on; paint(); }); return; }
    if(e.target.closest('[data-sw]')){ noLive(c); return; }
    buzz(6); mcpEdit(win,i,paint); });
  P.cfg.mcpEdit=function(i,tab){ mcpEdit(win,i==null?1:i,paint,tab); }; P.cfg.mcpAdd=function(){ mcpEdit(win,-1,paint); };
}
/* 编辑 / 添加：基础设置 / 工具 两页 */
function mcpEdit(win,i,repaint,tab){
  var isNew=i<0, m=isNew?{n:'',ty:'streamable-http',on:1,url:'',hd:[],tools:[]}:MCPD[i];
  function toolsHTML(){ if(m.on&&!m.ok) return '<div class="mc-err">'+esc(m.err||'还没连上')+'</div>'; if(!m.tools.length) return '<div class="pg-empty">这个服务没有工具</div>'; return m.tools.map(function(t,j){ return '<div class="mc-tool pg-rise'+(t.on?'':' off')+'" style="--i:'+j+'"><div class="h"><b>'+esc(t.n)+'</b><i class="pg-sw'+(t.on?' on':'')+'" data-tl="'+j+'"></i></div>'+(t.d?'<p>'+esc(t.d)+'</p>':'')+(t.p.length?'<div class="ps">'+t.p.map(function(x){ return '<em>'+esc(x)+'</em>'; }).join('')+'</div>':'')+'</div>'; }).join(''); }
  var tySeg=seg(['Streamable HTTP','JSON-RPC','自动'],['streamable-http','custom-jsonrpc','auto'].indexOf(m.ty)).replace('pg-seg','pg-seg pv-seg mc-ty');
  var base='<div class="pg-g">'+r({t:'启用',tg:1,on:m.on,tgname:'en'})+'</div>'+
    '<div class="pg-g pv-form" style="margin-top:12px">'+fd('名称','<input class="pg-in" id="mcN" placeholder="给它起个名" value="'+esc(m.n)+'">')+fd('传输类型',tySeg)+fd('服务器地址','<input class="pg-in mono" id="mcU" placeholder="https://…/mcp" value="'+esc(m.url)+'">')+'</div>'+
    '<div class="mc-hdt"><span>自定义请求头</span><button class="tap" data-kv="add">'+I.plus+'添加</button></div><div class="pg-g pv-kv mc-kv">'+m.hd.map(function(h){ return kvRow([h[0],'']).replace('placeholder="值" value=""','placeholder="'+(h[0]?'已设置 · 留空不改':'值')+'" value=""'); }).join('')+'</div>';
  sheet(win,isNew?'添加 MCP':'编辑 MCP',(isNew?'':seg(['基础设置','工具'+(m.tools.length?' '+m.tools.filter(function(t){ return t.on; }).length+'/'+m.tools.length:'')],0))+'<div class="pg-pane on" style="padding-top:12px">'+base+'</div>'+(isNew?'':'<div class="pg-pane mc-tools" style="padding-top:12px">'+toolsHTML()+'</div>')+
    '<div class="pg-bts mc-bts">'+(isNew?'':'<button class="pg-btn red tap" data-mc="del">删除</button>')+'<button class="pg-btn pri tap" data-mc="ok">'+(isNew?'添加':'保存')+'</button></div>',
    function(sh,close){
      sh.classList.add('mc-sheet'); if(!isNew) sh.classList.add('mc-fix'); kvWire(sh);
      var bts=sh.querySelector('.mc-bts'); sh.querySelector('.pane').appendChild(bts);
      sh.addEventListener('click',function(e){ var g=e.target.closest('[data-seg]'); if(g) bts.hidden=g.dataset.seg==='1'; });
      if(isNew) setTimeout(function(){ sh.querySelector('#mcN').focus(); },380);
      if(tab) setTimeout(function(){ var b=sh.querySelector('[data-seg="1"]'); if(b) b.click(); },50);
      var hdBtn=sh.querySelector('.mc-hdt [data-kv]'); hdBtn.addEventListener('click',function(e){ e.stopPropagation(); var g=sh.querySelector('.mc-kv'); g.insertAdjacentHTML('beforeend',kvRow(['',''])); g.lastChild.classList.add('flash'); g.lastChild.querySelector('input').focus(); buzz(6); });
      sh.addEventListener('click',function(e){
        var sw=e.target.closest('[data-tl]'); if(sw){ if(!MC_OK){ noLive(sw); return; } var t=m.tools[+sw.dataset.tl]; t.on=!t.on; if(!isNew) mcTools(m); sw.classList.toggle('on',t.on); sw.closest('.mc-tool').classList.toggle('off',!t.on); var sb=sh.querySelector('[data-seg="1"]'); if(sb) sb.textContent='工具 '+m.tools.filter(function(x){ return x.on; }).length+'/'+m.tools.length; buzz(8); return; }
        var b=e.target.closest('[data-mc]'); if(!b) return;
        if(b.dataset.mc==='ok'){ var n=sh.querySelector('#mcN'), u=sh.querySelector('#mcU'); if(!n.value.trim()){ n.focus(); buzz([20,30,20]); return; } if(!u.value.trim()){ u.focus(); buzz([20,30,20]); return; }
          if(!MC_OK){ noLive(b); return; } m.n=n.value.trim(); m.url=u.value.trim(); m.on=sh.querySelector('[data-tg="en"]').classList.contains('on'); var k=+getComputedStyle(sh.querySelector('.mc-ty')).getPropertyValue('--k')||0; m.ty=['streamable-http','custom-jsonrpc','auto'][k];
          if(isNew){ m.ok=0; MCPD.push(m); i=MCPD.length-1; }
          var kv=[].map.call(sh.querySelectorAll('.mc-kv .pv-kvr'),function(rw){ var ip=rw.querySelectorAll('input'); return [ip[0].value.trim(),ip[1].value]; }).filter(function(x){ return x[0]; }); m.hd=kv;
          b.innerHTML='<i class="pg-spin"></i>连接中'; b.classList.add('busy');
          mcSave().then(function(){ return mcLoad(); }).then(function(){ var nm=MCPD.filter(function(x){ return x.id===m.id; })[0]; close(); repaint(nm?MCPD.indexOf(nm):null); toast(nm&&nm.ok?'保存好了 · 连上了'+(nm.tools.length?' · '+nm.tools.length+' 个工具':''):'保存好了'+(nm&&nm.on?'，但还没连上':'')); buzz([8,30,8]); },function(){ b.classList.remove('busy'); b.textContent=isNew?'添加':'保存'; if(isNew){ MCPD.splice(i,1); } }); }
        else confirmBox(win,'删掉「'+esc(m.n)+'」？','他就再也调不到这里的工具了。','删除',true,function(){ if(!MC_OK){ noLive(null); return; } close(); var gone=MCPD.splice(i,1)[0]; setTimeout(function(){ repaint(); toast('删掉了'); },300); mcSave().catch(function(){ MCPD.splice(i,0,gone); repaint(); }); });
      });
    },isNew?'':'<button class="mc-rf tap" aria-label="刷新工具">'+I.refresh+'</button>');
  var sh=win.querySelector('.pg-sheet:last-child'), rf=sh&&sh.querySelector('.mc-rf');
  if(rf) rf.addEventListener('click',function(){ rf.classList.add('spin'); buzz(6); var pane=sh.querySelector('.mc-tools');
    if(MC_OK){ mcLoad(true).then(function(){ rf.classList.remove('spin'); var nm=MCPD.filter(function(x){ return x.id===m.id; })[0]; if(nm){ m=nm; } pane.innerHTML=toolsHTML(); toast(m.ok?'工具列表刷新了 · '+m.tools.length+' 个':'还是连不上'); buzz(m.ok?[8,30,8]:[20,40,20]); },function(){ rf.classList.remove('spin'); }); return; }
    rf.classList.remove('spin'); noLive(rf); });
}
P.pages.mcp={data:MCPD,ok:function(){ return MC_OK; },done:function(){ return !!CDONE.mc; },err:function(){ return !!CERR.mc; },seed:function(list){ if(!MC_OK&&!MCPD.length&&list&&list.length) mcFrom(list,true); },card:mcpCard,load:mcLoad,save:mcSave,edit:mcpEdit};
/* [位置:phone-pages.js·mcpBriefSrc/mcpBriefRows] [设置页「MCP 工具」组：启用的服务器一行一台 + 详情] [11-21：设置里直接看启用的 MCP 服务器（一行：名字 + 已连接 · 开着/总数 个工具 / 没连上），末行「详情」进工具集整页。数据优先内存（MCPD），没有就吃本地缓存 ph_c_mcpsrv（登录后 30 秒后台轮询在写），都没有先显示读取中，mcLoad 回来由 cfgMount 里的 cfgWait('mc') 重画整组] [注释时间 2026-11-21] */
function mcpBriefSrc(){
  var raw=null;
  if(MC_OK&&MCPD.length) raw=MCPD.map(function(m){ return {n:m.n,on:m.on,ok:!!m.ok,tools:(m.tools||[]).map(function(t){ return {on:t.on!==false}; })}; });
  else if(P.net&&P.net.peek){ var c=P.net.peek('mcpsrv'); if(c&&c.length) raw=c.map(function(x){ return {n:x.name||'',on:x.enabled!==false,ok:!!x.connected,tools:(x.tools||[]).map(function(t){ return {on:t.enabled!==false}; })}; }); }
  if(!raw) return null;
  return raw.filter(function(x){ return x.on; }).map(function(x){ var en=x.tools.filter(function(t){ return t.on; }).length;
    return {n:String(x.n||''),sub:x.ok?('已连接 · '+en+'/'+x.tools.length+' 个工具'):'没连上'}; });
}
/* [位置:phone-pages.js·mcpBriefRows] [设置页「MCP 工具」组行生成] [2026-11-24 补齐每行线性图标 ic（plug / detail），与上方分组对齐] */
function mcpBriefRows(){
  var out=[], src=mcpBriefSrc();
  if(src===null) out.push(r({ic:'plug',t:'MCP 服务器',s:'读取中…'}));
  else if(!src.length) out.push(r({ic:'plug',t:'还没有启用的 MCP 服务器'}));
  else src.forEach(function(x){ out.push(r({ic:'plug',t:esc(x.n),s:x.sub})); });
  out.push(r({ic:'detail',t:'详情',go:'tools'}));
  return out;
}
/* [位置:phone-pages.js·pulseBriefRows] [极简设置里直接展开的后台] [11-20：备份状态、网关 / yun 工具 / MCP 工具的重启，加一行详情跳进后台整页。语音工具是打错字，指 yun-mcp-v2。只在极简布局出现，月夜玻璃仍走桌面那张卡和后台 App] [注释时间 2026-11-20；2026-11-24 为每行补齐线性图标 ic（backup / server / route / wrench / wave）] */
function pulseBriefRows(){
  function svc(ic,title,name,id){
    return r({ic:ic,t:title,s:'读取中…',id:id,cls:'pb-row',data:' data-pb="'+name+'"',right:'<span class="pg-dot" data-pdot="'+name+'"></span><button class="pb-rs tap" type="button" data-pbrs="'+name+'">重启</button>'});
  }
  return [
    r({ic:'backup',t:'备份',s:'读取中…',id:'pbBk'}),
    svc('server','网关','gateway','pbGw'),
    svc('route','yun 工具','yun-mcp-v2','pbYun'),
    svc('wrench','工具集合','mcp-tools','pbMcp'),
    r({ic:'wave',t:'详情',go:'pdetail'})
  ];
}
function cfgBody(){
  var accRows=[r({ic:'bell',t:'系统通知',tg:1,on:1}),r({ic:'key',t:'网关 Key',v:'',go:'pass'}),r({ic:'lock',t:'修改密码',go:'pwd'}),r({ic:'phone',t:'本机数据',v:'',go:'local'})];
  if(P.minLayout&&P.minLayout.on) accRows.push(r({ic:'grid',t:'桌面图标',v:'换一张',go:'icon'}),r({ic:'sliders',t:'其他',v:'推送 · 天气 · 网络',go:'other'}));
  accRows.push(r({ic:'out',t:'退出登录 <span class="pv-na-t">未接</span>',red:1,act:'logout'}));
  return (
    grp('AI',[r({ic:'prompt',t:'人设提示词',v:PERS.length?PERS.length+' 个':'',go:'prompts'}),r({ic:'grid',t:'自定义开始',v:'',go:'spreset'}),r({ic:'sliders',t:'生成定义',v:'跟随默认',go:'gen'})],null,0)+
    /* [位置:phone-pages.js·cfgBody 模型组] [精简为 4 项，去掉外层语音识别与用途提示词分组] [11-21：语音识别与语音转写提示词已在语音模型内；图片转写改为二级页（含模型+提示词）；笔记模型与提示词收进笔记本页右上角设置] [注释时间 2026-11-21] */
    grp('模型',[r({ic:'cloud',t:'模型供应商',v:'',go:'prov',c:'rgba(122,160,216,.2)'}),mdSelHtml({ic:'ai',t:'默认聊天模型',k:'def'}),r({ic:'cam',t:'图片转写',v:'',go:'imgdesc'}),r({ic:'mic',t:'语音模型',v:'',go:'voice',c:'rgba(224,138,160,.18)',ci:'#c9607a'})],null,1)+
    grp('MCP 工具',mcpBriefRows(),null,2)+
    ((P.minLayout&&P.minLayout.on)?grp('后台',pulseBriefRows(),null,3):'')+
    grp('账号与数据',accRows,null,4)+
    '');
}
/* [2026-11-16 批2 E1] 原「扩展」组（唯一一行 MCP 服务入口）按用户的要求挪进工具集 App：tlBody 顶部加了同款行（data-go=mcp，角标 mcpList·paint 的 document 级选择器照常命中）；配置页 go 路由的 'mcp' 分支保留（工具集入口经 openApp('cfg')+P.cfg.go('mcp') 走的就是它，P.cfg.mcpEdit/mcpAdd 外部入口也还挂在上面） */
function cfgHTML(){ return shell('配置','',cfgBody()); }
function cfgSetup(win){ cfgMount(win,$('.pg',win),function(){ closeWin(win); }); }
/* ================= 列表分组（人设/预设共用） ================= */
/* [位置:phone-pages.js·grpHead 等] [列表分组头与展开状态] [11-14：人设页与预设页按 grp 字段分组共用——组头显示组名+条数，点组头切换；重命名分组时迁移键。11-16 批3 H3：默认全部收起、不记上一次的展开状态——状态改存内存（GRPOPEN），每次进页 grpResetOpen 清掉重新收起；原 localStorage 键 psgrp_open/spgrp_open 不再读写] [注释时间 2026-11-14；2026-11-16 默认收起改内存] */
var GRPOPEN={};
function grpResetOpen(kind){ delete GRPOPEN[kind]; }
function grpOpen(kind,g){ var m=GRPOPEN[kind]; return !!(m&&m[g]); }
function grpSetOpen(kind,g,v){ var m=GRPOPEN[kind]||(GRPOPEN[kind]={}); if(v) m[g]=1; else delete m[g]; }
function grpRenameKey(kind,o,n){ var m=GRPOPEN[kind]; if(m&&m[o]){ m[n]=m[o]; delete m[o]; } }
function grpHead(kind,g,n){ return '<div class="pg-grp" data-grpk="'+kind+'" data-grp="'+esc(g)+'"><b>'+esc(g)+'</b><small>'+(grpOpen(kind,g)?(n+' 个'):(n+' 个 · 已收起'))+'</small></div>'; }
function cfgMount(win,root,onBack){
  if(!root.innerHTML.trim()) root.innerHTML=cfgBody();
  /* [位置:phone-pages.js·cfgMount·paintPromptRow] [两行用途提示词的字数] [目录页删了以后，改完仍要刷这几行的「改过」和字数；P.pedit 的 after 调这里。唤醒提示词 2026-11-20 挪去唤醒 App 设置，行刷新在那边（wpPaint）] [注释时间 2026-11-20] */
  function paintPromptRow(i){
    var e=root.querySelector('[data-go="pr'+i+'"]'); if(!e) return;
    var v=P.pvals&&P.pvals[i], b=e.querySelector('.rt b'), sm=e.querySelector('.rt small');
    var name=''; PRBRIEF.forEach(function(it){ if(it[0]===i) name=it[1]; });
    if(b) b.innerHTML=(name||'提示词')+(v&&v.custom_set?' <span class="pg-tag">改过</span>':'');
    if(!sm){ sm=document.createElement('small'); if(b&&b.parentNode) b.parentNode.appendChild(sm); }
    if(sm) sm.textContent=v&&P.plen?P.plen(i).toLocaleString()+' 字':'读不到';
  }
  if(P.pfetch&&PRBRIEF.some(function(it){ return root.querySelector('[data-go="pr'+it[0]+'"]'); })) PRBRIEF.forEach(function(it){ P.pfetch(it[0]).then(function(){ paintPromptRow(it[0]); },function(){ paintPromptRow(it[0]); }); });
  /* [位置:phone-pages.js·cfgMount·paintMcpGroup] [设置页「MCP 工具」组刷新] [11-21：进设置先吃内存/缓存秒画，后台静默拉一次 mcLoad 校正；数据晚到由 cfgWait('mc') 重画该组] [注释时间 2026-11-21] */
  (function(){
    var det=root.querySelector('[data-go="tools"]'); if(!det) return;
    var grpEl=det.closest('.pg-g'); if(!grpEl) return;
    function paintMcpGroup(){
      var tmp=document.createElement('div'); tmp.innerHTML=mcpBriefRows().join('');
      grpEl.innerHTML=tmp.innerHTML;
    }
    cfgWait('mc',paintMcpGroup);
    mcLoad().then(paintMcpGroup,function(){});
  })();
  /* [位置:phone-pages.js·cfgMount·pulseBrief] [极简设置后台组的状态和重启] [读 /admin/backup/status 和 /admin/services，重启走现成的 services/:name/restart；网关沿用 gwRestartAt 冷却，和后台整页同一把锁] [注释时间 2026-11-20] */
  (function(){
    var bk=root.querySelector('#pbBk'); if(!bk) return;
    var PST={online:1,active:1,running:1};
    var LAB={gateway:'网关','yun-mcp-v2':'yun 工具','mcp-tools':'MCP 工具'};
    function cooling(){ try{ var t=Number(localStorage.getItem('gwRestartAt'))||0; return !!t&&Date.now()-t<60000; }catch(e){ return false; } }
    function paintSvc(list){
      var seen={};
      (list||[]).forEach(function(s){ if(!LAB[s.name]) return; seen[s.name]=1;
        var row=root.querySelector('[data-pb="'+s.name+'"]'); if(!row) return;
        var ok=!!PST[s.status], cool=s.name==='gateway'&&cooling()&&!ok;
        var sm=row.querySelector('small'); if(sm) sm.textContent=cool?'重启中 · 排空中':(ok?'在跑':'没在跑');
        var dot=row.querySelector('[data-pdot]'); if(dot) dot.className='pg-dot'+((ok&&!cool)?'':(cool?' warn':' off'));
        var btn=row.querySelector('[data-pbrs]'); if(btn&&!btn.classList.contains('busy')){ btn.disabled=!!cool; btn.textContent=cool?'排空中':'重启'; }
      });
      Object.keys(LAB).forEach(function(name){ if(seen[name]) return; var sm=root.querySelector('[data-pb="'+name+'"] small'); if(sm) sm.textContent='不在清单里'; });
    }
    function loadBrief(){
      P.net.get('/heartbeat/admin/backup/status').then(function(d){
        var sm=bk.querySelector('small'); if(!sm) return;
        if(!d||d.ok===false){ sm.textContent=(d&&d.error)||'读不到'; return; }
        sm.textContent=d.latest?((d.is_today?'今天备份过了':((d.stale_days||'?')+' 天没备份'))+' · 共 '+(d.count||0)+' 份'):'还没有备份';
      },function(){ var sm=bk.querySelector('small'); if(sm) sm.textContent='读不到'; });
      P.net.get('/heartbeat/admin/services').then(function(r){ paintSvc((r&&r.services)||[]); },function(){
        Object.keys(LAB).forEach(function(name){ var sm=root.querySelector('[data-pb="'+name+'"] small'); if(sm) sm.textContent='读不到'; });
      });
    }
    loadBrief();
    root.addEventListener('click',function(e){
      var b=e.target.closest('[data-pbrs]'); if(!b||!root.contains(b)) return;
      e.preventDefault(); e.stopPropagation();
      if(b.disabled||b.classList.contains('busy')) return;
      var name=b.getAttribute('data-pbrs'), label=LAB[name]||name;
      if(name==='gateway'&&cooling()){ toast('网关正在重启 · 排空中，约 60 秒后再操作'); return; }
      confirmBox(win,'重启'+label+'？',name==='gateway'?'重启网关期间聊天会断几秒，进行中的回复会中断。':'大约几秒，期间这个功能用不了。','重启',false,function(){
        b.classList.add('busy'); b.textContent='重启中…';
        if(name==='gateway'){ try{ localStorage.setItem('gwRestartAt',String(Date.now())); }catch(e2){} }
        P.net.post('/heartbeat/admin/services/'+encodeURIComponent(name)+'/restart',{}).then(function(r2){
          if(name==='gateway'&&r2&&r2.ok===false){ try{ localStorage.removeItem('gwRestartAt'); }catch(e2){} }
          b.classList.remove('busy'); toast(label+(r2&&r2.ok===false?' 没重启成':' 在重启'));
          setTimeout(loadBrief,name==='gateway'?6000:1500);
        },function(){
          b.classList.remove('busy');
          if(name==='gateway'){ toast('网关在重启，过几秒再看'); setTimeout(loadBrief,6000); return; }
          toast(label+' 没重启成');
        });
      });
    },true);
  })();
  /* 跨窗口默认数量：日记篇数接 /admin/cross-inject/config（真的）；原文轮数、标星条数后端还没有全局默认（标星只能按会话设，没设＝全部），先只改这台手机 */
  function xdefPage(){
    var D=P.xdef||(P.xdef={diary:3,recent:10,star:0});
    var pg=sub(win,'跨窗口默认数量',grp('',[r({t:'日记篇数',st:{v:D.diary,min:1,max:30},cls:'xd-diary'}),r({t:'原文轮数 <span class="pv-na-t">未接</span>',st:{v:D.recent,min:1,max:100},cls:'xd-recent'}),r({t:'标星条数 <span class="pv-na-t">未接</span>',st:{v:D.star,min:0,max:500,step:5},cls:'xd-star'})],null,0),{right:'<span class="pg-cb ghost"></span>'});
    function val(c){ var e=pg.querySelector('.'+c+' .pg-st input'); return e?+e.value.replace(/,/g,''):0; }
    if(P.net) P.net.get('/heartbeat/admin/cross-inject/config',{noLogin:true}).then(function(d){ if(d&&d.cross_inject_diary_count!=null){ xlive=true; D.diary=+d.cross_inject_diary_count; var b=pg.querySelector('.xd-diary .pg-st input'); if(b){ b.value=D.diary; b.dataset.last=D.diary; } } },function(){});
    var tmr=0, xlive=false;
    /* [位置:phone-pages.js·xdCommit] [跨窗口数量落盘] [数量器支持直接输入后，点 +/- 和手输 blur（pg-st-change）两种改法共用一份保存逻辑] [注释时间 2026-11-07] */
    function xdCommit(){ setTimeout(function(){
      D.diary=val('xd-diary'); D.recent=val('xd-recent'); D.star=val('xd-star');
      clearTimeout(tmr); tmr=setTimeout(function(){ if(!xlive){ toast('没连上后台，没存'); return; } P.net.post('/heartbeat/admin/cross-inject/config',{cross_inject_diary_count:D.diary}).then(function(){ toast('默认日记篇数改成 '+D.diary+' 篇'); },function(){ toast('没存上，稍后再试'); }); },600); },0); }
    pg.addEventListener('click',function(e){ if(!e.target.closest('.pg-st button')) return; xdCommit(); });
    pg.addEventListener('pg-st-change',xdCommit);
  }
  /* ================= 自定义开始：新会话预设 ================= */
  /* [位置:phone-pages.js·presetPage] [自定义开始管理页] [10-26：预设 = 一套建会话配置（名称/头像/人设/模型/聊天主题/时间缀给AI/跨窗口注入/MCP 工具预开），存 chat-settings.cfg.sess_presets；新建会话弹窗点预设卡直接开始，这里只管增删改；入口计数走 setRv('spreset')] [注释时间 2026-10-26] */
  function presetList(){ var L=LV.cs&&LV.cs.cfg&&LV.cs.cfg.sess_presets; return Array.isArray(L)?L:[]; }
  function spSum(p){ return P.sessPref&&P.sessPref.sum?P.sessPref.sum(p):''; }   /* 摘要与弹窗预设卡共用 P.sessPref.sum（2026-10-26 晚收拢） */
  function presetPage(){
    grpResetOpen('sp');   /* 每次进页分组全部收起（11-16 批3 H3） */
    var pg=sub(win,'自定义开始',
      '<div class="pg-g pg-rise" style="--i:0"><div id="spLs"></div></div>',   /* [位置:phone-pages.js·presetPage 底部按钮] [去掉通栏「新建预设」与多余「新会话预设」小标题] [11-20/11-23] */
      {right:'<button class="pg-cb tap" data-spnew aria-label="新建预设">'+I.plus+'</button>',
       setup:function(s){
         /* [位置:phone-pages.js·presetPage·长按排序] [10-26：列表行长按 430ms 拿起（抖一下+提示），上下拖换位，松手按落点存顺序；数组顺序 = 新会话弹窗里的顺序] [注释时间 2026-10-26] */
         var DG=null, JUST=0, SPTH=0, GT=null, GJUST=0;
         function dragRows(){ return Array.prototype.slice.call(s.querySelectorAll('[data-sped]')); }
         s.addEventListener('pointerdown',function(e){
           if(e.target.closest('[data-spnew]')||DG) return;
           /* [位置:phone-pages.js·presetPage·组头手势] [组头长按弹改名/解散菜单，点按收起/展开] [11-14：手势与行拖拽同一套（480ms 计时、移动取消、click 看 GJUST 防长按后误触）] [注释时间 2026-11-14] */
           var gh=e.target.closest('[data-grpk="sp"]');
           if(gh){ GT={y0:e.clientY,g:gh.getAttribute('data-grp'),tm:setTimeout(function(){ if(!GT) return; var g2=GT.g; GT=null; GJUST=Date.now(); spGrpMenu(g2); },480)}; return; }
           var row=e.target.closest('[data-sped]'); if(!row) return;
           DG={row:row,i0:+row.getAttribute('data-sped'),y0:e.clientY,dy:0,on:false,tm:setTimeout(function(){
             if(!DG) return; DG.on=true; DG.row.classList.add('sp-lift'); buzz([10,30,10]); if(!SPTH){ SPTH=1; toast('上下拖，松手放好'); } },430)};
         });
         s.addEventListener('pointermove',function(e){
           if(GT){ if(Math.abs(e.clientY-GT.y0)>10){ clearTimeout(GT.tm); GT=null; } return; }
           if(!DG) return;
           if(!DG.on){ if(Math.abs(e.clientY-DG.y0)>10){ clearTimeout(DG.tm); DG=null; } return; }
           DG.dy=e.clientY-DG.y0; DG.row.style.transform='translateY('+DG.dy+'px) scale(1.04)';
         });
         function spDrop(e){
           if(GT){ clearTimeout(GT.tm); GT=null; }
           if(!DG) return; clearTimeout(DG.tm); var d=DG; DG=null;
           if(!d.on) return; JUST=Date.now();
           d.row.classList.remove('sp-lift'); d.row.style.transform='';
           var L=presetList(); if(!L.length) return;
           var H=d.row.getBoundingClientRect().height||56;   /* 11-14 分组后行间不再等距（隔着组头），H 改用行自身高度 */
           var ni=Math.max(0,Math.min(L.length-1,d.i0+Math.round(d.dy/H)));
           /* [位置:phone-pages.js·presetPage·组内拖动] [带分组的预设只能在组内换序] [11-14：渲染时同组收在一起，跨组拖没有意义——ni 夹到该组成员的序号范围内；成员在数组里不必连续（渲染按 grp 归拢），夹取语义不受影响] [注释时间 2026-11-14] */
           var git=L[d.i0]&&L[d.i0].grp;
           if(git){ var lo=1e9, hi=-1; L.forEach(function(q,i2){ if(q&&q.grp===git){ if(i2<lo) lo=i2; if(i2>hi) hi=i2; } }); ni=Math.max(lo,Math.min(hi,ni)); }
           /* [位置:phone-pages.js·presetPage·长按复制] [长按拿起后原地松手（没拖动）弹出菜单：复制这个预设] [11-09 随手记：自定义预设可长按复制；拖动换位的手势不变，只是「拿起后没动」这一种松手原来什么都不发生，现在给它一个用途] [注释时间 2026-11-09] */
           if(Math.abs(d.dy)<10){ presetCopySheet(d.i0,e&&e.clientX!=null?e.clientX:0,e&&e.clientY!=null?e.clientY:0); return; }
           if(ni===d.i0) return;
           var it=L.splice(d.i0,1)[0]; L.splice(ni,0,it);
           P.sessPref.save(L).then(function(){ if(LV.cs){ if(!LV.cs.cfg) LV.cs.cfg={}; LV.cs.cfg.sess_presets=L; } paint(); toast('顺序存好了'); },function(){ paint(); toast('没存上，还是原顺序'); });
         }
         /* [位置:phone-pages.js·presetCopySheet] [预设长按松手：贴着手指冒一个小气泡「复制一份」，点一下就复制] [11-09：不要底部抽屉，一个选项不值得那么大阵仗；气泡落在手指上方（上方放不下放下方），点空白处收起；样式 phone-pages.css .sp-bub] [注释时间 2026-11-09] */
         function presetCopySheet(i,px,py){
           var L=presetList(), src=L[i]; if(!src) return;
           var wr=win.getBoundingClientRect(), ov=document.createElement('div'); ov.className='sp-bubov';
           ov.innerHTML='<div class="sp-bubsc"></div><button class="sp-bub tap" type="button" style="visibility:hidden"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"/></svg>复制一份</button>';
           win.appendChild(ov);
           var bb=ov.querySelector('.sp-bub'), w=bb.offsetWidth, h=bb.offsetHeight;
           var x=Math.max(12,Math.min(wr.width-w-12,(px-wr.left)-w/2)), up=(py-wr.top)-h-22>60, y=up?(py-wr.top)-h-22:(py-wr.top)+22;
           bb.style.left=Math.round(x)+'px'; bb.style.top=Math.round(y)+'px'; bb.style.transformOrigin=(Math.max(8,Math.min(w-8,(px-wr.left)-x)))+'px '+(up?'100%':'0');
           bb.style.visibility=''; requestAnimationFrame(function(){ ov.classList.add('show'); });
           function gone(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); },200); }
           var t0=Date.now(); ov.querySelector('.sp-bubsc').addEventListener('click',function(){ if(Date.now()-t0>400) gone(); });   /* 松手那一下可能补发 click，落在遮罩上会秒关 */
           bb.addEventListener('click',function(){
             var cp=JSON.parse(JSON.stringify(src)); cp.id='sp_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); cp.name=String(src.name||'未命名').slice(0,17)+' 副本';
             var NL=L.slice(); NL.splice(i+1,0,cp); gone();
             P.sessPref.save(NL).then(function(){ if(LV.cs){ if(!LV.cs.cfg) LV.cs.cfg={}; LV.cs.cfg.sess_presets=NL; } if(P.net) P.net.post('/heartbeat/admin/logs/pinned/clone',{from_preset_id:src.id,to_preset_id:cp.id}).catch(function(){}); paint(); setRv('spreset',NL.length+' 个'); toast('复制好了'); buzz([8,30,8]); },function(){ toast('没复制成'); buzz([12,30,12]); });
           });
         }
         /* [位置:phone-pages.js·presetPage·spSetGrp] [整组预设换分组] [11-14：改名/解散共用——改内存 grp 后走 P.sessPref.save 整键上云；grp 为空删字段不存空串] [注释时间 2026-11-14] */
         function spSetGrp(idx,g,done){
           var L=presetList(), ch=false;
           idx.forEach(function(i){ if(L[i]&&(L[i].grp||'')!==g){ if(g) L[i].grp=g; else delete L[i].grp; ch=true; } });
           if(!ch){ if(done) done(); return; }
           P.sessPref.save(L).then(function(){ if(LV.cs){ if(!LV.cs.cfg) LV.cs.cfg={}; LV.cs.cfg.sess_presets=L; } paint(); if(done) done(); },function(){ paint(); toast('没存上'); buzz([20,30,20]); }); }
         function spGrpMenu(g){
           var L=presetList(), idx=L.map(function(p,i){ return p&&p.grp===g?i:-1; }).filter(function(i){ return i>=0; });
           if(!idx.length){ paint(); return; }
           buzz([10,30,10]);
           sheet(win,'分组「'+esc(g)+'」','<div class="pg-bts" style="padding:4px 0 0"><button class="pg-btn tap" type="button" data-ga="ren">重命名分组</button><button class="pg-btn tap" type="button" data-ga="dis">解散分组</button></div>',function(sh,close){
             sh.addEventListener('click',function(ev){
               if(ev.target.closest('[data-ga="ren"]')){ close(); spGrpRename(g,idx); return; }
               if(ev.target.closest('[data-ga="dis"]')){ close(); confirmBox(win,'解散「'+esc(g)+'」？','组里 '+idx.length+' 个预设变成不分组，预设本身不动。','解散',true,function(){ spSetGrp(idx,'',function(){ toast('已解散'); }); }); } }); }); }
         function spGrpRename(g,idx){
           sheet(win,'重命名分组','<div class="pv-fd"><label>组名</label><input class="pg-in" id="spGN" maxlength="20" value="'+esc(g)+'"></div><div class="pg-bts"><button class="pg-btn pri tap" type="button" data-ga="ok">改好</button></div>',function(sh,close){
             sh.addEventListener('click',function(ev){ if(!ev.target.closest('[data-ga="ok"]')) return;
               var v=(sh.querySelector('#spGN').value||'').trim(); if(!v){ try{ sh.querySelector('#spGN').focus(); }catch(e3){} toast('先起个名'); return; }
               if(v===g){ close(); return; }
               spSetGrp(idx,v,function(){ grpRenameKey('sp',g,v); close(); toast('改好了'); }); }); }); }
         s.addEventListener('pointerup',spDrop); s.addEventListener('pointercancel',spDrop);
         s.addEventListener('touchmove',function(e){ if(DG&&DG.on) e.preventDefault(); },{passive:false});
         function paint(){ var L=presetList(), box=s.querySelector('#spLs'); if(!box) return;
           function row(p,i){ var avh=P.sessPref&&P.sessPref.avHtml?P.sessPref.avHtml(p.av,p.id||p.name,'sp-pav'):('<span class="av ai sp-pav'+(p.av?' hasimg':'')+'" style="background-image:'+(p.av?P.sessPref.avBg(p.av):'none')+'" data-l="'+esc(Array.from(String(p.name||'设'))[0])+'"></span>');
             return '<button type="button" class="pg-r ic go" data-sped="'+i+'">'+avh+'<span class="rt"><b>'+esc(p.name||'未命名')+'</b><small>'+esc(spSum(p))+'</small></span>'+I.ch+'</button>'; }
           /* [位置:phone-pages.js·presetPage·paint 分组] [预设按 grp 字段分区] [11-14：rp 预设组——不带 grp 的在前照旧平铺，带 grp 的收进组（组头=组名+条数，点按收起/展开，长按改名/解散）；全没分组时和原来一样] [注释时间 2026-11-14] */
           var html='';
           if(L.some(function(p){ return p&&p.grp; })){
             L.forEach(function(p,i){ if(p&&p.grp) return; html+=row(p,i); });
             var gs={}, go=[];
             L.forEach(function(p,i){ var g=p&&p.grp; if(!g) return; if(!gs[g]){ gs[g]=[]; go.push(g); } gs[g].push(i); });
             go.forEach(function(g){ html+=grpHead('sp',g,gs[g].length); if(grpOpen('sp',g)) gs[g].forEach(function(i){ html+=row(L[i],i); }); });
           } else L.forEach(function(p,i){ html+=row(p,i); });
           box.innerHTML=L.length?html:'<div class="pg-empty">还没有预设。建一个，新会话时点一下就直接开始。</div>';
           P.markAv&&P.markAv(); }
         paint();
         if(!LV.cs) P.net.get(AB+'chat-settings',{noLogin:true}).then(function(r){ if(!LV.cs&&s.isConnected){ LV.cs=(r&&r.data)||{}; paint(); setRv('spreset',presetList().length?presetList().length+' 个':''); } },function(){});
         s.addEventListener('click',function(e){
           if(Date.now()-JUST<450) return;
           var gh2=e.target.closest('[data-grpk="sp"]');
           if(gh2){ if(Date.now()-GJUST<450) return; var g2=gh2.getAttribute('data-grp'); grpSetOpen('sp',g2,!grpOpen('sp',g2)); paint(); return; }
           if(e.target.closest('[data-spnew]')){ presetEdit(-1,paint); return; }
           var ed=e.target.closest('[data-sped]'); if(ed) presetEdit(+ed.getAttribute('data-sped'),paint); });
       }});
  }
  /* [位置:phone-pages.js·spCmpPrm] [预设的状态机提示词管理页] [11-06：预设里能挑状态机提示词，也要能就地新建/编辑/删除整套（照聊天页参数面板的「管理」入口，用户要的那一项）；数据同一份 /admin/context-compaction/prompts，存删后回来自动刷新预设里那行下拉；删掉正在用的那套 = 这个预设回到跟随默认；编辑走底板（带键盘避让），列表是子页] [注释时间 2026-11-06] */
  function spCmpPrm(win,curId,onChg){
    var L={list:[]};
    function fetch(){ return P.net.get('/heartbeat/admin/context-compaction/prompts',{noLogin:true}).then(function(d){ L.list=(d&&d.list)||[]; return L.list; },function(){ return L.list; }); }
    function rows(){
      if(!L.list.length) return '<div class="pg-empty">还没有自己的一套</div>';
      return L.list.map(function(p){
        return '<div class="pg-r go" data-prm="'+esc(p.id||'')+'"><span class="rt"><b>'+esc(p.name||'未命名')+'</b></span>'+(p.id===curId?'<span class="pg-tag">在用</span>':'')+
          '<button type="button" class="sp-cm-btn tap" data-prmdel="'+esc(p.id||'')+'">删除</button></div>'; }).join('');
    }
    sub(win,'状态机提示词','<div class="pg-gt">这几种写法谁用谁生效</div><div class="pg-g pg-rise" style="--i:0"><div id="spPrmLs"><div class="pg-empty">读取中…</div></div></div>'+
      '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-prmnew>新建一套</button></div>',
      {setup:function(s){
        var box=s.querySelector('#spPrmLs');
        function paint(){ if(box) box.innerHTML=rows(); }
        function reload(){ return fetch().then(function(list){ paint(); if(onChg) onChg(list); }); }
        paint(); reload();
        function edit(rec){
          var body='<div class="pv-fd"><label>名称</label><input class="pg-in" id="spPrmN" maxlength="30" placeholder="比如：精简版" value="'+esc((rec&&rec.name)||'')+'"></div>'+
            '<div class="pv-fd"><label>状态写法</label><textarea class="pg-in" id="spPrmS" placeholder="留空 = 用内置默认">'+esc((rec&&rec.system)||'')+'</textarea></div>'+
            '<div class="pv-fd"><label>原文模板</label><textarea class="pg-in" id="spPrmT" placeholder="${PREV_STATE} 上一版状态 · ${LU} 来路账本 · ${CHUNK_INFO} 并入范围 · ${CONVERSATION_TEXT} 对话原文；留空 = 用内置模板">'+esc((rec&&rec.user_template)||'')+'</textarea></div>'+
            '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-prmsv>保存</button></div>';
          sheet(win,rec?'编辑这一套':'新建一套',body,function(sh,close){
            sh.addEventListener('click',function(ev){
              var b=ev.target.closest('[data-prmsv]'); if(!b) return;
              var nm=sh.querySelector('#spPrmN');
              if(!nm.value.trim()){ try{ nm.focus(); }catch(e){} toast('先起个名字'); buzz([20,30,20]); return; }
              if(!bgo(b)) return;
              P.net.post('/heartbeat/admin/context-compaction/prompts',{action:'save',id:(rec&&rec.id)||'',name:nm.value,system:sh.querySelector('#spPrmS').value,user_template:sh.querySelector('#spPrmT').value},{noLogin:true})
                .then(function(){ bend(b,true); later(function(){ close(); toast('存好了'); reload(); }); },
                      function(x){ bend(b,false); toast('没存上'+(x&&x.message?'：'+String(x.message).slice(0,30):'')); });
            });
          });
        }
        s.addEventListener('click',function(e){
          if(e.target.closest('[data-prmnew]')){ edit(null); return; }
          var del=e.target.closest('[data-prmdel]');
          if(del){
            var id=del.getAttribute('data-prmdel');
            var hit=L.list.filter(function(x){ return x&&x.id===id; })[0]||{};
            confirmBox(win,'删掉「'+esc(hit.name||'这套')+'」？','用它的地方会回到跟随默认。','删',true,function(){
              P.net.post('/heartbeat/admin/context-compaction/prompts',{action:'delete',id:id},{noLogin:true}).then(function(){
                if(id===curId){ curId=''; }
                toast('删掉了'); reload();
              },function(){ toast('没删掉'); });
            });
            return;
          }
          var row=e.target.closest('[data-prm]');
          if(row){ var rid=row.getAttribute('data-prm'); edit(L.list.filter(function(x){ return x&&x.id===rid; })[0]||null); }
        });
      }});
  }
  /* [位置:phone-pages.js·grpOptsHtml] [分组下拉选项] [11-15：预设/人设编辑页的分组行从手输+datalist 改原生下拉——「不分组」+现有组名（按传入顺序去重）+「新建分组…」哨兵 __new__；cur 不在清单（改名残留等）兜底补一项] [注释时间 2026-11-15] */
  function grpOptsHtml(cur,names){
    var gs=[],seen={};
    (names||[]).forEach(function(g){ if(g&&!seen[g]){ seen[g]=1; gs.push(g); } });
    if(cur&&!seen[cur]) gs.push(cur);
    return '<option value="">不分组</option>'+gs.map(function(g){ return '<option value="'+esc(g)+'"'+(g===cur?' selected':'')+'>'+esc(g)+'</option>'; }).join('')+'<option value="__new__">新建分组…</option>'; }
  /* [位置:phone-pages.js·grpSelBind] [分组下拉行为] [11-15：选中「新建分组…」先把 select 退回原值再弹新建弹窗——弹窗被点遮罩/下拉拖掉/ESC 关掉都不留哨兵值，干净回退；重名=直接选中已有选项（意图是归组不报错）；新名插在哨兵前并选中] [注释时间 2026-11-15] */
  function grpSelBind(sel,newSheet){
    var prev=sel.value;
    sel.addEventListener('change',function(){
      if(sel.value!=='__new__'){ prev=sel.value; buzz(6); return; }
      sel.value=prev;
      newSheet(function(name){ if(!name) return;
        var hit=null; Array.prototype.forEach.call(sel.options,function(o){ if(o.value===name) hit=o; });
        if(!hit){ hit=document.createElement('option'); hit.value=name; hit.textContent=name;
          sel.insertBefore(hit,sel.querySelector('option[value="__new__"]')); }
        sel.value=name; prev=name; buzz(6); }); }); }
  /* [位置:phone-pages.js·grpNewSheet] [新建分组弹窗] [11-15：分组下拉「新建分组…」配套——空名不让过；确定 done(组名)，取消/遮罩关闭 done('') 不落值；底板表单样式照 spGrpRename] [注释时间 2026-11-15] */
  function grpNewSheet(win,done){
    sheet(win,'新建分组','<div class="pv-fd"><label>组名</label><input class="pg-in" id="grpNewN" maxlength="20" placeholder="起个组名"></div><div class="pg-bts"><button class="pg-btn tap" type="button" data-ga="no">取消</button><button class="pg-btn pri tap" type="button" data-ga="ok">确定</button></div>',function(sh,close){
      sh.addEventListener('click',function(ev){
        if(ev.target.closest('[data-ga="no"]')){ close(); done(''); return; }
        if(!ev.target.closest('[data-ga="ok"]')) return;
        var v=(sh.querySelector('#grpNewN').value||'').trim(); if(!v){ try{ sh.querySelector('#grpNewN').focus(); }catch(e4){} toast('先起个名'); return; }
        close(); done(v); }); }); }
  /* [位置:phone-pages.js·presetEdit] [预设编辑页] [新建（idx=-1）/编辑共用。头像走主题页同款压缩上传（thShrink+/v1/upload-image）；人设/主题/时间缀用列表弹层、模型是行内原生分组下拉（mdSelHtml/mdBind）；跨窗口复用 P.xinject 九宫格；MCP 工具清单读 /admin/session-mcp（占位会话号预览清单），勾选存预设，「跟随全局」开=不带工具设置；会话头像/聊天主题是本机映射，建会话时才落；保存走 P.sessPref.save（chat-settings.cfg_patch.sess_presets 整键合并）。2026-11-16 批3：加「距上一轮回复时间」三态（p.et，建会话时才落会话级 elapsed-tag）。2026-11-24：头像按钮排加「选图标」（emSheet），图标头像存成 emoji:图标|#底色，渲染在 P.sessPref 一处] [注释时间 2026-10-26；2026-11-16 加距上一轮；2026-11-24 加选图标] */
  function presetEdit(idx,repaint){
    var isNew=idx<0;
    var p=isNew?{id:'sp_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),name:'',av:'',ps:'',md:'',mdg:[],style:'',tt:null,et:null,perm_on:false,xw:{on:true,blocks:null},mcps:null,mcp_mode:'s',mcp_seen:null}
               :JSON.parse(JSON.stringify(presetList()[idx]||{}));
    p.xw=p.xw||{on:true,blocks:null};
    p.perm_on=!!p.perm_on;
    /* [位置:phone-pages.js·presetEdit·永久上下文与未保存守卫] [11-25：每个预设独立永久上下文与独立开关 perm_on；新建/编辑未保存退出弹 threeBox] [注释时间 2026-11-25] */
    var permCount=isNew?0:-1, permTouched=false, savedOk=false, userTouched=false, initSig='';
    /* [位置:phone-pages.js·presetEdit·工具三态] [工具来源跟全局/本预设自选] [10-26 晚：全不勾=明确全关，不再被当成跟随全局；旧预设没这个字段按 mcps 推断] [注释时间 2026-10-26 晚] */
    if(!p.mcp_mode) p.mcp_mode=Array.isArray(p.mcps)?'s':'g';
    /* [位置:phone-pages.js·presetEdit·工具规则] [预设存「规则」不存清单] [10-27：每个服务器 默认开/关 + 例外名单（形状同 lib/mcp-rules.js），新增的工具跟着所在服务器的默认走，不用再进来手动补；旧预设（只有 mcps 清单）读到服务器清单后换算，保存时变成规则；共用 P.mcpr] [注释时间 2026-10-27] */
    var OPTS={pers:[],models:[]}, MR=P.mcpr, RUL=(p.mcp_rules&&p.mcp_rules.servers)?p.mcp_rules:null;
    function VIEW(){ return RUL||MR.fromGlobal(MSCP.servers); }
    function findTool(k){ var hit=null; MSCP.servers.forEach(function(s2){ s2.tools.forEach(function(t2){ if(t2.key===k) hit={s:s2,t:t2}; }); }); return hit; }
    function seedSel(){ if(p.mcp_mode==='s'&&!RUL&&MSCP.servers.length){ RUL=Array.isArray(p.mcps)?MR.fromPreset(p,MSCP.servers):MR.fromGlobal(MSCP.servers); if(!userTouched&&pg) initSig=snapState(); } }
    var tmp=document.createElement('div'); tmp.innerHTML=P.xinject.html(Array.isArray(p.xw.blocks)?p.xw:{on:p.xw.on!==false});
    var pg=sub(win,isNew?'新建预设':'编辑预设',
      /* [位置:phone-pages.js·presetEdit·sp-hero] [顶部合并名片卡：头像点击弹面板 + 名称/分组单行行内输入] [11-25：收掉「基本/头像」两块冗长说明与四粒大按钮，统一成顶部紧凑名片卡] [注释时间 2026-11-25] */
      '<div class="pg-g pg-rise sp-hero" style="--i:0">'+
        '<div class="sp-avhd"><button type="button" class="sp-avtap tap" data-spavopen aria-label="更换头像">'+
          (P.sessPref&&P.sessPref.avHtml?P.sessPref.avHtml(p.av,p.id||p.name||'new','sp-av','spAv'):('<span class="av ai sp-av'+(p.av?' hasimg':'')+'" style="background-image:'+(p.av?P.sessPref.avBg(p.av):'none')+'" data-l="'+esc(Array.from(String(p.name||'设'))[0])+'" id="spAv"></span>'))+
          '<span class="sp-avcap">更换头像</span></button></div>'+
        '<div class="pg-r sp-fdr"><span class="rt"><b>名称</b></span><input class="sp-fi" id="spN" maxlength="20" placeholder="比如：自定义1" value="'+esc(p.name)+'"></div>'+
        '<div class="pg-r sp-fdr sp-selr"><span class="rt"><b>分组</b></span><select class="sp-fs" id="spG">'+grpOptsHtml(p.grp||'',presetList().map(function(q){ return q&&q.grp; }))+'</select><span class="sp-chv">'+I.arr+'</span></div>'+
      '</div>'+
      grp('会话配置',[
        r({t:'人设',v:'',go:'ps',id:'spRowPs'}), mdSelHtml({t:'模型',k:'spmd',id:'spRowMd'}),
        /* [位置:phone-pages.js·presetEdit·候选模型行] [子智能体模型组 failover 入口] [10-31：主模型挂了自动换下一个（引擎 subagent-preset-runner·modelGroupOf 读预设 mdg），这里管理候选列表] [注释时间 2026-10-31] */
        r({t:'候选模型',v:'',go:'mdg',id:'spRowMdg'}),
        r({t:'聊天主题',v:'',go:'st',id:'spRowSt'}), r({t:'时间缀给AI',v:'',go:'tt',id:'spRowTt'}),
        r({t:'笔记本',v:'',go:'nb',id:'spRowNb'})],null,1)+
      grp('永久上下文',[
        r({t:'启用永久上下文',tg:1,tgname:'spperm',on:!!p.perm_on}),
        r({t:'管理永久上下文',v:isNew?'无':'读取中…',go:'perm',id:'spRowPerm'})],null,2)+
      grp('跨窗口注入',['<div>'+tmp.innerHTML+'</div>'],null,3)+
      /* [位置:phone-pages.js·presetEdit·状态机组] [预设带状态机模型和提示词，挪到 MCP 工具前] [11-23：MCP 列表太长，状态机放到工具前更顺手] [注释时间 2026-11-23] */
      grp('状态机',[
        mdSelHtml({t:'状态机模型',k:'spcmpm',id:'spRowCmpM',follow:'跟随会话模型'}),
        mdSelHtml({t:'状态机提示词',k:'spcmpp',id:'spRowCmpP',follow:'跟随默认'}),
        r({t:'管理提示词',id:'spRowCmpMg',right:'<button type="button" class="sp-cm-btn tap" data-spcmpmg>管理</button>'})],null,4)+
      grp('MCP 工具预开',[r({t:'工具来源',v:'',go:'mcpmode',id:'spRowMm'}),'<div id="spMcp"><div class="pg-empty">读取工具清单…</div></div>'],null,5)+
      '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-spsv>保存</button></div>',
      /* [位置:phone-pages.js·presetEdit] [删除按钮挪到标题行右上（10-26：点进去就得能看到删）；11-25 补独立永久上下文开关与未保存退出确认] [注释时间 2026-11-25] */
      {right:(isNew?'':'<button class="pg-cb tap" data-spdel2 aria-label="删除这个预设" style="color:#c9607a">'+I.trash+'</button>'),go:spGo,
       toggle:function(t,on){ if(t.dataset.tg==='spperm'){ userTouched=true; p.perm_on=!!on; buzz(6); } },
       guard:function(close){
         if(savedOk||(!permTouched&&snapState()===initSig)) return false;
         threeBox(win,'要保存修改吗',isNew?'这个新预设还没保存。':'这一页的修改还没保存。',function(act){
           if(act==='save'){ save(close); }
           else if(act==='drop'){
             savedOk=true;
             if(isNew&&permTouched&&P.net) P.net.req('/heartbeat/admin/logs/pinned/scope/'+encodeURIComponent(p.id),{method:'DELETE'}).catch(function(){});
             close();
           }
         });
         return true;
       }});
    function snapState(){
      var nEl=pg.querySelector('#spN'), gEl=pg.querySelector('#spG');
      return JSON.stringify({
        n:nEl?nEl.value.trim():'', g:gEl?(gEl.value||'').trim():'',
        av:p.av||'', ps:p.ps||'', md:p.md||'', mdg:Array.isArray(p.mdg)?p.mdg:[],
        st:p.style||'', tt:p.tt==null?null:!!p.tt, et:p.et==null?null:!!p.et, nb:p.nb||'',
        po:!!p.perm_on, xw:P.xinject?P.xinject.read(pg):p.xw,
        cm:p.cmp_model||'', cp:p.cmp_prompt||'',
        mm:p.mcp_mode||'g', mr:RUL||null
      });
    }
    var NB_LIST=[{id:'default',name:'默认笔记本',builtin:true,count:0}];
    if(P.net) P.net.get('/papers/api/notebooks',{noLogin:true}).then(function(r){
      if(r&&Array.isArray(r.notebooks)&&r.notebooks.length){ NB_LIST=r.notebooks; rname(); }
    },function(){});
    /* [位置:phone-pages.js·presetEdit·分组下拉绑定] [新建分组入口] [11-15：选「新建分组…」弹 grpNewSheet，确定后选项就地插入并选中] [注释时间 2026-11-15] */
    grpSelBind(pg.querySelector('#spG'),function(done){ grpNewSheet(win,done); });
    pg.querySelector('#spG').addEventListener('change',function(){ userTouched=true; });
    function nbLabelOf(id){
      if(id==='none') return '无';
      if(!id||id==='default') return '默认笔记本';
      var hit=NB_LIST.filter(function(x){ return x&&x.id===id; })[0];
      return hit?hit.name:'已选笔记本';
    }
    function rname(){
      var b;
      if((b=pg.querySelector('#spRowPs .rv'))) b.textContent=p.ps?(((P.sessFlat?P.sessFlat(OPTS.pers):OPTS.pers).filter(function(x){ return x[0]===p.ps; })[0]||[,'已选人设'])[1]):'跟随默认';   /* 11-14 人设清单带分组，摊平后再找名字 */
      if((b=pg.querySelector('#spRowMdg .rv'))) b.textContent=(Array.isArray(p.mdg)&&p.mdg.length)?(p.mdg.length+' 个备用，失败自动换'):'不加（主模型挂了直接报错）';
      if((b=pg.querySelector('#spRowSt .rv'))) b.textContent=p.style==='min'?'极简':p.style==='bubble'?'气泡':'跟随本机设置';
      if((b=pg.querySelector('#spRowTt .rv'))) b.textContent=p.tt===true?'开':p.tt===false?'关':'跟随默认';
      if((b=pg.querySelector('#spRowEt .rv'))) b.textContent=p.et===true?'注入':p.et===false?'不注入':'跟随默认';
      if((b=pg.querySelector('#spRowNb .rv'))) b.textContent=nbLabelOf(p.nb);
      if((b=pg.querySelector('#spRowPerm .rv'))) b.textContent=permCount<0?'读取中…':(permCount?(permCount+' 段'):'无');
      if((b=pg.querySelector('#spRowMm .rv'))) b.textContent=p.mcp_mode==='s'?'本预设自选':'跟随全局'; }
    if(!isNew&&P.net){
      P.net.get('/heartbeat/admin/logs/pinned?preset_id='+encodeURIComponent(p.id),{noLogin:true}).then(function(r){
        permCount=(r&&Array.isArray(r.list))?r.list.length:0; rname();
      },function(){ permCount=0; rname(); });
    }
    initSig=snapState();
    /* [位置:phone-pages.js·presetEdit 人设/模型清单] [先用本机缓存，再等接口校正] [11-05：同头像菜单/新建会话——原来这里也要现拉两个接口才出清单] [注释时间 2026-11-05] */
    if(P.sessOpts){ var so0=P.sessOpts.now?P.sessOpts.now():null; if(so0){ OPTS=so0; rname(); }
      P.sessOpts(true).then(function(o){ OPTS=o; rname(); }); } else rname();
    /* [位置:phone-pages.js·presetEdit·主模型行] [行内原生分组下拉] [11-05 晚：预设的模型也用同一个分组下拉，存 p.md（"供应商id|模型名"，空=跟随默认）] [注释时间 2026-11-05] */
    mdBind(pg.querySelector('#spRowMd'),p.md||'',function(v,pid,model){ p.md=pid?(pid+'|'+model):''; buzz(6); });   /* 预设不即时保存，点保存时一起提交，失败无需回滚 */
    /* [位置:phone-pages.js·presetEdit·状态机模型行] [预设的状态机模型] [11-06：跟聊天页参数面板同一个下拉——空=跟随这个预设开会话后的聊天模型，__role__=跟随全局状态机，其余存 供应商id|模型名；「跟随全局状态机」用 mdBind 的 extra 补在供应商分组之上] [注释时间 2026-11-06] */
    mdBind(pg.querySelector('#spRowCmpM'),p.cmp_model||'',function(v){ p.cmp_model=v||''; buzz(6); },[['__role__','跟随全局状态机']]);
    /* [位置:phone-pages.js·presetEdit·状态机提示词行] [预设用哪套状态机提示词] [11-06：清单和聊天页的管理入口同一份（/admin/context-compaction/prompts）；这里只挑不写内容，写内容走下面「管理提示词」；存 p.cmp_prompt，空=跟随默认；存的套后来被删了 → 进页面就清成跟随默认，不存死引用] [注释时间 2026-11-06] */
    var CMPP={list:[],loaded:false,reload:null};
    (function(){
      var row=pg.querySelector('#spRowCmpP'); if(!row) return;
      var sel=row.querySelector('select.mdsel'), rv=row.querySelector('.rv');
      function label(){ var o=sel.options[sel.selectedIndex]; if(rv) rv.textContent=(o&&o.value)?o.textContent:'跟随默认'; }
      function paint(){
        sel.innerHTML='<option value="">跟随默认</option>'+CMPP.list.map(function(x){ return '<option value="'+esc(x.id||'')+'">'+esc(x.name||'未命名')+'</option>'; }).join('');
        sel.value=p.cmp_prompt||'';
        if(p.cmp_prompt&&sel.value!==p.cmp_prompt){ p.cmp_prompt=''; sel.value=''; }   /* 选的套已经不在清单里：按跟随默认显示 */
        label(); }
      CMPP.reload=function(cb){ P.net.get('/heartbeat/admin/context-compaction/prompts',{noLogin:true}).then(function(d){
          CMPP.list=(d&&d.list)||[]; CMPP.loaded=true; paint(); if(cb) cb(CMPP.list);
        },function(){ if(cb) cb(CMPP.list); }); };
      sel.addEventListener('change',function(){ p.cmp_prompt=sel.value||''; label(); buzz(6); });
      CMPP.reload();
    })();
    function spGo(k){
      if(k==='ps') spPick('人设',[['','跟随默认']].concat(OPTS.pers),p.ps,function(v){ p.ps=v; rname(); });
      else if(k==='mdg'){
        /* [位置:phone-pages.js·presetEdit·候选模型组弹层] [列表增删 + 长按拖动换序，顺序=重试顺序；存 mdg（元素同 md 格式 "providerId|model"）] [10-31 建立（当时整页重绘把底板骨架一起换掉导致关不掉，改成只重绘 #mdgList）；11-06：说明文字收进标题 ⓘ，列表改成卡内行（序号+模型名+× 淡底方块），删除先淡出再重排（按值删，连点两行不会删错），长按 430ms 拖起换序（列表区掐断按下事件的冒泡，免得底板拉高手势抢走长按），顺序只改内存、点保存才提交] [注释时间 2026-11-06] */
        var MDG={th:0,dg:null,just:0}, XICO=svg('<path d="M7 7l10 10M17 7 7 17"/>');
        function mdgName(x){ return esc(String(x).split('|').slice(1).join('|')); }
        function mdgListHtml(inIdx){
          var L=Array.isArray(p.mdg)?p.mdg:[];
          return (L.length?('<div class="pg-g mdg-card">'+L.map(function(x,i){
              return '<div class="mdg-it'+(inIdx===i?' in':'')+'" data-mdgi="'+i+'"><b class="mdg-n">'+(i+1)+'</b><span class="mdg-m">'+mdgName(x)+'</span>'+
                '<button class="mdg-x tap" type="button" data-mdgdel="'+i+'" aria-label="删除 '+mdgName(x)+'">'+XICO+'</button></div>'; }).join('')+'</div>')
            :'<div class="pg-g mdg-card"><div class="pg-empty">还没有备用模型</div></div>')+
            '<div class="pg-g" style="margin-top:10px">'+mdSelHtml({t:'加一个备用模型',k:'mdgadd',follow:'选一个加进来'})+'</div>';
        }
        function mdgHtml(){ return '<div id="mdgList" class="mdg-list">'+mdgListHtml(-1)+'</div>'; }
        function mdgPaint(s,inIdx){
          if(!Array.isArray(p.mdg)) p.mdg=[];
          var box=s.querySelector('#mdgList'); if(box) box.innerHTML=mdgListHtml(inIdx==null?-1:inIdx);
          rname();
          var row=s.querySelector('[data-md="mdgadd"]');
          if(row) mdBind(row,'',function(v,pid,model){ if(!pid||!model) return; if(!Array.isArray(p.mdg)) p.mdg=[]; p.mdg.push(pid+'|'+model); buzz(6); mdgPaint(s,p.mdg.length-1); });
        }
        sheet(win,'候选模型组',mdgHtml(),function(s){
          var listBox=s.querySelector('#mdgList');
          /* 列表里的按下：自己起长按计时并掐断冒泡——底板拉高是同一套 pointer 手势，不掐会被它抢走 */
          listBox.addEventListener('pointerdown',function(e){
            if(e.target.closest('.mdg-x')) return;
            var row=e.target.closest('[data-mdgi]'); if(!row) return;
            if(!Array.isArray(p.mdg)||p.mdg.length<2) return;
            e.stopPropagation();
            MDG.dg={row:row,i0:+row.getAttribute('data-mdgi'),y0:e.clientY,dy:0,on:false,tm:setTimeout(function(){
              var d=MDG.dg; if(!d) return; d.on=true; d.row.classList.add('sp-lift'); buzz([10,30,10]);
              if(!MDG.th){ MDG.th=1; toast('按住上下拖，松手放好'); } },430)};
            document.addEventListener('pointermove',mdgMove);
            document.addEventListener('pointerup',mdgDrop);
            document.addEventListener('pointercancel',mdgDrop);
            document.addEventListener('touchmove',mdgTM,{passive:false});
          });
          function mdgTM(e){ if(MDG.dg&&MDG.dg.on) e.preventDefault(); }
          function mdgOff(){ document.removeEventListener('pointermove',mdgMove); document.removeEventListener('pointerup',mdgDrop); document.removeEventListener('pointercancel',mdgDrop); document.removeEventListener('touchmove',mdgTM); }
          function mdgMove(e){
            var d=MDG.dg; if(!d) return;
            if(!d.on){ if(Math.abs(e.clientY-d.y0)>10){ clearTimeout(d.tm); MDG.dg=null; mdgOff(); } return; }
            d.dy=e.clientY-d.y0; d.row.style.transform='translateY('+d.dy+'px) scale(1.04)';
          }
          function mdgDrop(){
            var d=MDG.dg; if(!d) return; clearTimeout(d.tm); MDG.dg=null; mdgOff();
            if(!d.on||!d.row.isConnected) return;   /* 拖到一半底板被关掉：行已不在页面上，别再算位置 */
            MDG.just=Date.now(); d.row.classList.remove('sp-lift'); d.row.style.transform='';
            var L=Array.isArray(p.mdg)?p.mdg:[]; if(L.length<2) return;
            var rl=Array.prototype.slice.call(s.querySelectorAll('[data-mdgi]'));
            var H=rl.length>1?(rl[1].getBoundingClientRect().top-rl[0].getBoundingClientRect().top):(d.row.getBoundingClientRect().height||50);
            var ni=Math.max(0,Math.min(L.length-1,d.i0+Math.round((d.dy||0)/H)));
            if(ni===d.i0) return;
            var it=L.splice(d.i0,1)[0]; L.splice(ni,0,it); buzz(6); mdgPaint(s);
          }
          s.addEventListener('click',function(e){
            if(Date.now()-MDG.just<250) return;   /* 刚拖完那一下浏览器合成的收尾点击不算删除（实测十几毫秒内就到，250ms 足够且不影响紧接着点 ×） */
            var del=e.target.closest('[data-mdgdel]'); if(!del) return;
            if(!Array.isArray(p.mdg)) p.mdg=[];
            var i=+del.getAttribute('data-mdgdel'), v=p.mdg[i]; if(v==null) return;
            var row=del.closest('.mdg-it'); buzz(6); if(row) row.classList.add('out');
            setTimeout(function(){ var k2=p.mdg.indexOf(v); if(k2>=0) p.mdg.splice(k2,1); mdgPaint(s); },220);   /* 按值删：连着点两行也不会因下标错位删错 */
          });
          mdgPaint(s);
        },hint('按顺序当备用：派活时主模型失败自动换下一个，全试完才报失败（每次失败要等约 2 分钟判定）。长按某一行可上下拖动换顺序。')); }
      else if(k==='st') spPick('聊天主题',[['','跟随本机设置'],['bubble','气泡'],['min','极简']],p.style,function(v){ userTouched=true; p.style=v; rname(); });
      else if(k==='tt') spPick('时间缀给AI',[['','跟随默认'],['1','开'],['0','关']],p.tt==null?'':(p.tt?'1':'0'),function(v){ userTouched=true; p.tt=v===''?null:(v==='1'); rname(); });
      else if(k==='et') spPick('距上一轮回复时间',[['','跟随默认'],['1','注入'],['0','不注入']],p.et==null?'':(p.et?'1':'0'),function(v){ userTouched=true; p.et=v===''?null:(v==='1'); rname(); });
      else if(k==='nb'){
        var curNb=p.nb||'default';
        var rows=NB_LIST.map(function(x){
          var on=x.id===curNb;
          return '<button type="button" class="mp-it'+(on?' on':'')+'" data-v="'+esc(x.id)+'"><span>'+esc(x.name)+' <small style="opacity:.55">'+(x.count||0)+' 篇</small></span>'+I.ok+'</button>';
        }).join('')+
        '<button type="button" class="mp-it'+(curNb==='none'?' on':'')+'" data-v="none"><span>无（不绑定笔记本）</span>'+I.ok+'</button>'+
        '<button type="button" class="mp-it" data-v="__new__"><span style="color:var(--acc)">+ 新建笔记本…</span></button>';
        sheet(win,'绑定笔记本','<div class="mp-sc">'+rows+'</div>',function(s,close){
          s.addEventListener('click',function(e){
            var b=e.target.closest('.mp-it'); if(!b) return;
            var v=b.getAttribute('data-v'); close(); buzz(6);
            if(v==='__new__'){
              sheet(win,'新建笔记本','<div class="pg-g"><div class="pg-r col"><span class="rt"><b>名字</b></span><input class="pg-in" id="spNbNew" maxlength="20" style="margin-top:8px" placeholder="比如：干活的、rp专用"></div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" type="button" data-nbok>创建并绑定</button></div>',function(s2,close2){
                function goNew(){
                  var inp=s2.querySelector('#spNbNew'), nm=(inp&&inp.value||'').trim();
                  if(!nm){ toast('先起个名'); return; }
                  P.net.post('/papers/api/notebooks/add',{name:nm}).then(function(r){
                    if(r&&r.notebook){ NB_LIST.push(r.notebook); userTouched=true; p.nb=r.notebook.id; rname(); close2(); toast('建好并绑定了'); }
                  },function(){ toast('没建上，可能重名了'); });
                }
                s2.querySelector('[data-nbok]').addEventListener('click',goNew);
                s2.addEventListener('keydown',function(ev){ if(ev.key==='Enter') goNew(); });
                setTimeout(function(){ var inp=s2.querySelector('#spNbNew'); if(inp) inp.focus(); },120);
              });
              return;
            }
            userTouched=true; p.nb=(v==='default'?'':v); rname();
          });
        });
      }
      else if(k==='perm'){
        if(P.openPermSub){
          var nm0=(pg.querySelector('#spN').value||'').trim()||p.name||'预设';
          P.openPermSub(win,{presetId:p.id,title:nm0+' · 永久上下文',onChange:function(n,touched){ permCount=n; if(touched){ permTouched=true; userTouched=true; } rname(); }});
        }
      }
      else if(k==='mcpmode') spPick('工具来源',[['s','本预设自选'],['g','跟随全局']],p.mcp_mode,function(v){ userTouched=true; p.mcp_mode=v;
        if(v==='s') seedSel();
        rname(); mcpPaint(); }); }
    function spPick(title,items,cur,cb){
      /* [位置:phone-pages.js·presetEdit·spPick 分组] [选择弹层支持分组条目] [11-14：人设清单带组（[组名,[[值,名],…]]）——组渲染成不可点的组头行，条目照旧；扁平项不受影响] [注释时间 2026-11-14] */
      function it(x){ return '<button type="button" class="mp-it'+(String(x[0])===String(cur)?' on':'')+'" data-v="'+esc(x[0])+'"><span>'+esc(x[1])+'</span>'+I.ok+'</button>'; }
      var html=items.map(function(x){ return (x&&Array.isArray(x[1]))?('<div class="mp-gh">'+esc(x[0])+'</div>'+x[1].map(it).join('')):it(x); }).join('');
      sheet(win,title,'<div class="mp-sc">'+html+'</div>',function(s,close){
        s.addEventListener('click',function(e){ var b=e.target.closest('.mp-it'); if(!b) return; cb(b.getAttribute('data-v')); close(); buzz(6); }); }); }
    /* [位置:phone-pages.js·presetEdit·loadMcp] [预设的 MCP 工具预开列表] [10-26：照会话级 MCP 弹层那样——服务器一行（名字+「工具: n/m」pill+整组开关），点行展开工具，不铺满平铺；勾选只以规则 RUL 为准（返回里的 on 是占位会话的状态，忽略；10-27 起存规则不存清单）；全局停用的服务器点行带 probe 拉一次，停用工具置灰] [注释时间 2026-10-26] */
    var MSCP={servers:[],open:{}};
    function mcpBox(){ return pg.querySelector('#spMcp'); }
    function loadMcp(){
      var box=mcpBox(); if(!box) return;
      if(!P.net){ box.innerHTML='<div class="pg-empty">没连上后台，读不到工具清单</div>'; return; }
      function mapSv(s2){ return {id:s2.id,name:s2.name||s2.id,probed:!!s2.probed,connected:s2.connected,enabled_global:s2.enabled_global!==false,
          tools:((s2.tools)||[]).map(function(t2){ return {key:t2.key,name:t2.name,dis:!!t2.disabled_server,blocked:!!t2.blocked,on:!!t2.on}; })}; }
      /* [位置:phone-pages.js·presetEdit·loadMcp 结构打底] [MCP 清单先吃全局结构缓存] [聊天页抽屉写的 tkMcp:struct（服务器+工具清单，探测贵、基本不变）先画出来秒显，勾选仍只认规则 RUL；拉到真数据覆盖；拉失败且已画出缓存就不清屏。只读不写——这里映射后的形状比抽屉的精简，回写会弄丢抽屉要的字段] [注释时间 2026-10-26] */
      var c0=null; try{ c0=JSON.parse(localStorage.getItem('tkMcp:struct')||'null'); }catch(e){}
      if(c0&&c0.servers&&c0.servers.length){ MSCP.servers=c0.servers.map(mapSv); seedSel(); mcpPaint(); }
      P.net.get('/heartbeat/admin/session-mcp?session_id=sp_preview',{noLogin:true}).then(function(r){
        MSCP.servers=((r&&r.servers)||[]).map(mapSv);
        /* [位置:phone-pages.js·presetEdit·loadMcp 打底] [10-26：新建预设的勾选以全局现状打底（照会话级弹层 follow_global 语义）——进来看到的勾选=全局开着的那些，pill 也就不是凭空全开；编辑已有预设时不覆盖已存的勾选；10-26 晚：只在本预设自选模式且还没存过勾选清单时打底（跟随全局不打底，全关预设也不被重新填上）] [注释时间 2026-10-26 晚改] */
        seedSel();
        mcpPaint();
      },function(){ if(!MSCP.servers.length) box.innerHTML='<div class="pg-empty">没读成，返回再进一次</div>'; }); }
    function mcpPaint(){
      var box=mcpBox(); if(!box) return;
      if(!MSCP.servers.length){ box.innerHTML='<div class="pg-empty">没有配置 MCP 服务</div>'; return; }
      box.innerHTML='<div class="sp-mcl'+(p.mcp_mode==='s'?'':' g')+'">'+MSCP.servers.map(function(s2,i){
        var ct=MR.count(VIEW(),s2), tot=ct.tot, n=ct.n;   /* 分母含停用工具：与聊天页弹层、全局工具页同口径（16/18） */
        var pill=!s2.probed?'工具: –':(s2.connected===false?'没连上':'工具: '+n+'/'+tot);
        var rows=(MSCP.open[i]&&s2.tools.length)?'<div class="sp-mct">'+s2.tools.map(function(t2){
            return '<div class="sp-mtl'+(t2.dis?' dis':(MR.toolOn(VIEW(),s2,t2)?' on':''))+'" data-spk="'+esc(t2.key)+'"><label>'+esc(t2.name)+'</label><i class="sp-sw"></i></div>'; }).join('')+'</div>':'';
        return '<div class="sp-mcg"><div class="sp-mcs'+(n>0?' on':'')+(s2.enabled_global?'':' off')+'" data-sps="'+i+'"><label>'+esc(s2.name)+'</label><span class="sp-pill">'+esc(pill)+'</span><i class="sp-sw"></i></div>'+rows+'</div>';
      }).join('')+'</div>'; }
    function mcpProbe(i,then){
      var box=mcpBox(); if(box) box.classList.add('busy');
      P.net.get('/heartbeat/admin/session-mcp?session_id=sp_preview&probe='+encodeURIComponent(MSCP.servers[i].id),{noLogin:true}).then(function(r){
        if(box) box.classList.remove('busy');
        var ns=((r&&r.servers)||[]).filter(function(x){ return x.id===MSCP.servers[i].id; })[0];
        if(ns){ MSCP.servers[i]={id:ns.id,name:ns.name||ns.id,probed:true,connected:ns.connected,enabled_global:ns.enabled_global!==false,
          tools:((ns.tools)||[]).map(function(t2){ return {key:t2.key,name:t2.name,dis:!!t2.disabled_server,blocked:!!t2.blocked,on:!!t2.on}; })};
          if(!MSCP.servers[i].tools.length) toast(ns.error||'没拿到工具'); }
        then&&then();
      },function(){ if(box) box.classList.remove('busy'); toast('没探成，稍后再试'); }); }
    loadMcp();
    /* [位置:phone-pages.js·presetEdit·pickAv] [预设头像选择] [自包含压缩（读图/解码/画布每步失败都明说），上传成功才写 p.av 并即时换预览；点头像圆圈也能选] [注释时间 2026-10-26] */
    function pickAv(mode){ var f=document.createElement('input'); f.type='file'; f.accept='image/*'; if(mode==='cam') f.setAttribute('capture','user');
      f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl){ toast('没拿到图，再试一次'); return; }
        toast('头像处理中…');
        var rd=new FileReader();
        rd.onerror=function(){ toast('这张图读不出来，换一张试试'); buzz([20,30,20]); };
        rd.onload=function(){ var im=new Image();
          im.onerror=function(){ toast('这张图解不开，换一张试试'); buzz([20,30,20]); };
          im.onload=function(){ try{
              var k=Math.min(1,512/Math.max(im.width,im.height)), c=document.createElement('canvas');
              c.width=Math.round(im.width*k); c.height=Math.round(im.height*k);
              c.getContext('2d').drawImage(im,0,0,c.width,c.height);
              toast('头像上传中…');
              P.net.post('/v1/upload-image',{data:c.toDataURL('image/jpeg',.88)}).then(function(r2){ if(!r2||!r2.url) throw new Error('后台没回图地址');
                p.av=String(r2.url).replace(/^https?:\/\/[^/]+/,''); paintAv(); buzz([8,30,8]); toast('头像传好了');
              },function(e2){ var m=String(e2&&e2.message||''); toast('没传上：'+m.replace(/^HTTP \d+\s*/,'').slice(0,40)); buzz([20,30,20]); });
            }catch(e3){ toast('图处理失败：'+String(e3&&e3.message||'').slice(0,30)); buzz([20,30,20]); } };
          im.src=rd.result; };
        rd.readAsDataURL(fl); };
      f.click(); }
    /* [位置:phone-pages.js·presetEdit·avSheet] [头像选择底部面板] [11-25：点击顶部名片卡头像弹出底部选项（从相册选 / 拍一张 / 选图标 / 清除），替代原页面内四粒胶囊按钮] [注释时间 2026-11-25] */
    function avSheet(){
      var items=[['lib','从相册选'],['cam','拍一张']];
      if(P.sessPref&&P.sessPref.avHtml) items.push(['em','选图标']);
      if(p.av) items.push(['clr','清除头像',1]);
      var html='<div class="pg-g sp-avsh">'+items.map(function(x){
        return '<button class="pg-r tap'+(x[2]?' sp-avclr':'')+'" type="button" data-spav="'+x[0]+'"><span class="rt"><b>'+x[1]+'</b></span></button>';
      }).join('')+'</div>';
      sheet(win,'更换头像',html,function(sh,close){
        sh.addEventListener('click',function(ev){
          var b=ev.target.closest('[data-spav]'); if(!b) return;
          var m2=b.getAttribute('data-spav'); close(); buzz(6);
          if(m2==='clr'){ userTouched=true; p.av=''; paintAv(); }
          else if(m2==='em'){ emSheet(); }
          else pickAv(m2);
        });
      });
    }
    /* [位置:phone-pages.js·presetEdit·emSheet] [图标头像选择底板] [11-24：预设头像除了传图，还能选一个可爱图标配柔和圆底色。上面大预览跟着选的实时换，中间图标网格、下面一排底色；「随机」一次换图标和底色；点「用这个」才落到 p.av（存 emoji:图标|#底色，和上传图片同一个字段，保存预设时一起上云），关掉底板=不改。进来时：已经是图标头像就选它，否则按预设 id 稳定挑一个做起点] [注释时间 2026-11-24] */
    function emSheet(){
      var SP=P.sessPref, EM=SP.EMOJIS, PL=SP.EMPAL;
      var cur=SP.emOf(p.av), seed=String(p.id||p.name||'new'), hh=2166136261;
      for(var i=0;i<seed.length;i++){ hh^=seed.charCodeAt(i); hh=(hh*16777619)>>>0; }
      var ch=cur?cur.ch:EM[hh%EM.length], bg=cur?cur.bg:PL[0];
      function val(){ return 'emoji:'+ch+'|'+bg; }
      return sheet(win,'选图标',
        '<div class="sp-em-pv">'+SP.avHtml(val(),'new','sp-em-big')+'</div>'+
        '<div class="sp-em-grid">'+EM.map(function(e){ return '<button class="sp-em tap" type="button" data-em="'+e+'" aria-label="图标 '+e+'">'+e+'</button>'; }).join('')+'</div>'+
        '<div class="sp-em-pal">'+PL.map(function(c){ return '<button class="sp-em-c tap" type="button" data-emc="'+c+'" style="background:'+c+'" aria-label="底色 '+c+'"></button>'; }).join('')+'</div>'+
        '<div class="pg-bts"><button class="pg-btn tap" type="button" data-emo="rand">随机</button><button class="pg-btn pri tap" type="button" data-emo="ok">用这个</button></div>',
        function(s,close){
          var pv=s.querySelector('.sp-em-big');
          function paint(){
            if(pv){ pv.style.backgroundImage=SP.avBg(val()); pv.classList.remove('pop'); void pv.offsetWidth; pv.classList.add('pop'); }
            Array.prototype.forEach.call(s.querySelectorAll('[data-em]'),function(b){ b.classList.toggle('on',b.getAttribute('data-em')===ch); });
            Array.prototype.forEach.call(s.querySelectorAll('[data-emc]'),function(b){ b.classList.toggle('on',b.getAttribute('data-emc')===bg); }); }
          paint();
          s.addEventListener('click',function(e){
            var b=e.target.closest('[data-em],[data-emc],[data-emo]'); if(!b) return;
            var k=b.getAttribute('data-emo');
            if(k==='rand'){ var n=ch; while(n===ch&&EM.length>1) n=EM[Math.floor(Math.random()*EM.length)]; ch=n; bg=PL[Math.floor(Math.random()*PL.length)]; paint(); buzz(6); return; }
            if(k==='ok'){ p.av=val(); paintAv(); buzz([8,30,8]); close(); toast('头像换成图标了，点保存才存'); return; }
            if(b.hasAttribute('data-em')) ch=b.getAttribute('data-em'); else bg=b.getAttribute('data-emc');
            paint(); buzz(6); }); }); }
    function paintAv(){ var a=pg.querySelector('#spAv'); if(!a) return;
      if(P.sessPref&&P.sessPref.avHtml){
        var tmp2=document.createElement('div');
        tmp2.innerHTML=P.sessPref.avHtml(p.av,p.id||p.name||pg.querySelector('#spN').value||'new','sp-av','spAv');
        if(tmp2.firstChild) a.replaceWith(tmp2.firstChild);
      } else {
        a.classList.toggle('hasimg',!!p.av);
        a.style.backgroundImage=p.av?P.sessPref.avBg(p.av):'none';
        a.setAttribute('data-l',Array.from(String(p.name||pg.querySelector('#spN').value||'设'))[0]);
      } }
    pg.addEventListener('click',function(e){
      if(P.xinject.click(e,pg)) return;
      if(e.target.closest('[data-spcmpmg]')){ buzz(6); spCmpPrm(win,p.cmp_prompt,function(){ if(CMPP.reload) CMPP.reload(); }); return; }
      if(e.target.closest('[data-spavopen],#spAv')){ buzz(6); avSheet(); return; }
      if(p.mcp_mode!=='s'&&e.target.closest('.sp-sw')&&e.target.closest('.sp-mcs,.sp-mtl')){ toast('现在是跟随全局，切「本预设自选」再勾'); return; }
      var tl=e.target.closest('.sp-mtl');
      if(tl){ if(tl.classList.contains('dis')){ toast('该工具已停用，到全局设置里启用'); return; }
        var k5=tl.getAttribute('data-spk'), hit=findTool(k5); if(hit) RUL=MR.setTool(VIEW(),hit.s,hit.t,!MR.toolOn(VIEW(),hit.s,hit.t)); buzz(6); mcpPaint(); return; }
      var mcs=e.target.closest('.sp-mcs');
      if(mcs){ var i5=+mcs.getAttribute('data-sps'), s5=MSCP.servers[i5]; if(!s5) return;
        if(e.target.closest('.sp-sw')&&s5.probed){ var any5=MR.count(VIEW(),s5).n>0; RUL=MR.setServer(VIEW(),s5,!any5); buzz(6); mcpPaint(); return; }
        if(!s5.probed){ mcpProbe(i5,function(){ MSCP.open[i5]=true; mcpPaint(); }); return; }
        MSCP.open[i5]=!MSCP.open[i5]; buzz(6); mcpPaint(); return; }
      var av=e.target.closest('[data-spav]');
      if(av){ var m2=av.getAttribute('data-spav'); if(m2==='clr'){ p.av=''; paintAv(); buzz(6); } else if(m2==='em'){ emSheet(); } else pickAv(m2); return; }
      if(e.target.closest('[data-spsv]')){ save(); return; }
      if(e.target.closest('[data-spdel],[data-spdel2]')){ del(); return; } });
    pg.querySelector('#spN').addEventListener('input',function(){ userTouched=true; var a=pg.querySelector('#spAv'); if(a&&!p.av) a.setAttribute('data-l',Array.from(String(this.value.trim()||'设'))[0]); });
    function save(onDone){
      var nm=pg.querySelector('#spN').value.trim(); if(!nm){ pg.querySelector('#spN').focus(); toast('先起个名'); buzz([20,30,20]); return; }
      p.name=nm;
      p.perm_on=!!p.perm_on;
      if(!p.nb||p.nb==='default') delete p.nb;
      /* [位置:phone-pages.js·presetEdit·save 分组] [分组名随保存一起上云] [11-14：空=不分组，删掉字段不存空串] [注释时间 2026-11-14] */
      var gv=(pg.querySelector('#spG').value||'').trim().slice(0,20); if(gv) p.grp=gv; else delete p.grp;
      /* [位置:phone-pages.js·presetEdit·save 清空组] [候选删光了就不落字段，别存空数组] [注释时间 2026-10-31] */
      if(Array.isArray(p.mdg)&&!p.mdg.length) delete p.mdg;
      /* 距上一轮跟随默认就不落字段（2026-11-16 批3 H1），与时间缀同规矩 */
      if(p.et==null) delete p.et;
      var xw=P.xinject.read(pg); if(xw) p.xw=xw;
      /* [位置:phone-pages.js·presetEdit·save 工具规则] [自选=存规则（每个服务器 默认开/关 + 例外，已不存在的工具名顺手清掉）；跟随全局=清空工具字段；旧的 mcps/mcp_seen 清单字段不再写] [10-27；工具清单没读到、又没有任何已存的工具设置时不让存，免得存成空规则] [注释时间 2026-10-27] */
      if(p.mcp_mode==='s'){
        if(RUL||MSCP.servers.length){ p.mcp_rules=MR.prune(VIEW(),MSCP.servers); delete p.mcps; delete p.mcp_seen; }
        else if(!p.mcp_rules&&!Array.isArray(p.mcps)){ toast('工具清单还没读到，稍等一下再存'); buzz([20,30,20]); return; }
      } else { p.mcp_rules=null; p.mcps=null; p.mcp_seen=null; }
      /* [位置:phone-pages.js·presetEdit·save 状态机两项] [提示词套已经不在清单里就清成跟随默认，没选的字段不落] [11-06] [注释时间 2026-11-06] */
      if(p.cmp_prompt&&CMPP.loaded&&!CMPP.list.some(function(x){ return x&&x.id===p.cmp_prompt; })) p.cmp_prompt='';
      if(!p.cmp_prompt) delete p.cmp_prompt;
      if(!p.cmp_model) delete p.cmp_model;
      var L=presetList(); if(isNew) L.push(p); else L[idx]=p;
      var b=pg.querySelector('[data-spsv]'); if(!bgo(b)) return;
      P.sessPref.save(L).then(function(){ bend(b,true); savedOk=true;
        if(LV.cs){ if(!LV.cs.cfg) LV.cs.cfg={}; LV.cs.cfg.sess_presets=L; }
        setRv('spreset',L.length?L.length+' 个':'');
        later(function(){ if(typeof onDone==='function') onDone(); else { var bk=pg.querySelector('[data-x="back"]'); if(bk) bk.click(); } if(repaint) repaint(); toast('预设存好了'); });
      },function(){ bend(b,false); toast('没存上'); buzz([20,30,20]); }); }
    function del(){ confirmBox(win,'删掉「'+esc(p.name)+'」？','已经用它开的会话不受影响。','删',true,function(){
        var L=presetList(); L.splice(idx,1);
        P.sessPref.save(L).then(function(){ savedOk=true; if(LV.cs){ if(!LV.cs.cfg) LV.cs.cfg={}; LV.cs.cfg.sess_presets=L; }
          setRv('spreset',L.length?L.length+' 个':'');
          var bk=pg.querySelector('[data-x="back"]'); if(bk) bk.click(); if(repaint) repaint(); toast('删掉了');
        },function(){ toast('没删成'); buzz([20,30,20]); }); }); }
  }
  function go(k,o){
    if(k==='prompts') personas();
    else if(k==='gen'){ var C=(LV.cs&&LV.cs.cfg)||{}, gg=genOf(C), B=function(k2,d){ return C[k2]==null?d:!!C[k2]; };
      var gpg=sub(win,'生成定义',
      grp('生成参数',[r({t:'自定义参数',tg:1,tgname:'gp',on:gg.on}),'<div class="gn-box'+(gg.on?' on':'')+'"><div>'+slider('t1','温度 temperature',String(gg.t),0,2,.05)+slider('t2','Top P',String(gg.p),0,1,.01)+r({t:'最长回复',s:'max_tokens',st:{v:gg.mx,min:256,max:32768,step:256}})+'</div></div>'],null,0)+
      grp('思考链',[r({t:'显示思考',tg:1,on:B('show_thinking',1),tgname:'show_thinking'}),r({t:'显示工具调用',tg:1,on:B('show_tools',1),tgname:'show_tools'})],null,1)+
      grp('排版',[r({t:'他的消息用 Markdown',tg:1,on:B('ai_md',1),tgname:'ai_md'}),r({t:'我的消息用 Markdown',tg:1,on:B('user_md',1),tgname:'user_md'}),r({t:'代码块折叠',tg:1,on:B('fold_code',0),tgname:'fold_code'}),r({t:'代码自动换行',tg:1,on:B('code_wrap',0),tgname:'code_wrap'})],null,2)+'<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-gsv>保存</button></div>',
      {setup:function(pg){ pg.querySelector('[data-gsv]').addEventListener('click',function(){ var b=this, on=function(n){ var e=pg.querySelector('[data-tg="'+n+'"]'); return !!(e&&e.classList.contains('on')); }, cust=on('gp');
          /* 原来就没设的项（null）没动过就继续不设，免得凭空多出一个回复长度上限 */
          function keep(k2,v,d){ return (C[k2]==null||C[k2]==='')&&v===d?null:v; }
          var patch={temperature:cust?keep('temperature',+pg.querySelector('#t1').value,gg.t):null,top_p:cust?keep('top_p',+pg.querySelector('#t2').value,gg.p):null,max_tokens:cust?keep('max_tokens',+pg.querySelector('.gn-box .pg-st input').value.replace(/,/g,''),gg.mx):null};
          ['show_thinking','show_tools','ai_md','user_md','fold_code','code_wrap'].forEach(function(n){ patch[n]=on(n); });
          if(!LV.cs){ toast('没连上后台，没存'); buzz([20,30,20]); return; } if(!bgo(b)) return;
          P.net.req(AB+'chat-settings',{method:'PUT',body:{cfg_patch:patch}}).then(function(){ bend(b,true); LV.cs.cfg=Object.assign(LV.cs.cfg||{},patch); setRv('gen',cust?'自定义参数':'跟随默认'); toast('存好了 · 下一条消息起生效'); buzz([8,30,8]); },function(){ bend(b,false); toast('没存上'); buzz([20,30,20]); }); }); },
       toggle:function(t,on){ if(t.dataset.tg!=='gp') return; t.parentNode.querySelector('.gn-box').classList.toggle('on',on); }}); }
    else if(k==='spreset') presetPage();
    else if(k==='prov') provList();
    else if(k==='imgdesc') imgDescPage();
    else if(k==='voice') voicePage();
    else if(k==='pr7'||k==='pr8'){ var pi=+k.slice(2); if(P.pedit) P.pedit(win,pi,function(){ paintPromptRow(pi); }); }
    else if(k==='pdetail'){ if(P.open) P.open('pulse',o); }
    else if(k==='tools'){ if(P.open) P.open('tools',o); }   /* [11-21] 设置「MCP 工具」组的详情行：直接开工具集整页（MCP 卡内联在第一屏） */
    else if(k==='mcp') mcpList(win,o);
    else if(k==='other'){
      var body=(P.pages&&P.pages.setBodyHTML)?P.pages.setBodyHTML(true):'';
      var opg=sub(win,'其他',body,{right:'<span class="pg-cb ghost"></span>'});
      if(P.pages&&P.pages.mountSet) P.pages.mountSet(opg);
    }
    else if(k==='icon'){
      var f=document.createElement('input'); f.type='file'; f.accept='image/*'; f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl) return; var rd=new FileReader(); rd.onload=function(){ var im=new Image(); im.onload=function(){
        function out(n){ var c=document.createElement('canvas'); c.width=c.height=n; var x=c.getContext('2d'), s=Math.min(im.width,im.height); x.drawImage(im,(im.width-s)/2,(im.height-s)/2,s,s,0,0,n,n); return c.toDataURL('image/png'); }
        var p192=out(192), p512=out(512);
        sheet(win,'换成这个图标？','<div style="display:flex;justify-content:center;padding:6px 0 2px"><img src="'+p192+'" alt="图标预览" style="width:132px;height:132px;border-radius:28px;display:block;box-shadow:0 8px 24px rgba(0,0,0,.18)"></div><div class="pg-ft" style="text-align:center">桌面上会显示成这样（正方形居中裁切）</div><div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn tap" type="button" data-ik="re">重选</button><button class="pg-btn pri tap" type="button" data-ik="ok">确认更换</button></div>',function(s,close){
          s.addEventListener('click',function(e){
            var b=e.target.closest('[data-ik]'); if(!b) return;
            if(b.getAttribute('data-ik')==='re'){ close(); setTimeout(function(){ go('icon'); },350); return; }
            if(!bgo(b)) return; toast('上传中…');
            P.net.post('/v1/set-app-icon',{icon192:p192,icon512:p512}).then(function(){ bend(b,true); close(); toast('桌面图标换好了 · iOS 要删掉主屏图标重新添加才看得到'); buzz([8,30,8]); },function(){ bend(b,false); toast('没换成'); buzz([20,30,20]); }); }); }); }; im.src=rd.result; }; rd.readAsDataURL(fl); }; f.click();
    }
    else if(k==='pass') sub(win,'网关 Key',grp('',[r({t:'当前',v:'<code class="gk-v">'+(LV.pv?'已设置':'没读到')+'</code>'}),'<div class="pg-r col"><span class="rt"><b>新的 Key</b></span><div class="gk-in"><input class="pg-in" id="gkNew" type="password" placeholder="填一个新的，或者点右边随机" autocomplete="off"><button class="pg-cb tap" id="gkGen" type="button" aria-label="随机生成">'+I.refresh+'</button></div></div>'],null,0)+'<div class="pg-bts"><button class="pg-btn tap pri" type="button" data-gk>保存</button></div>',
      {setup:function(sw){ var g=sw.querySelector('#gkGen'), n=sw.querySelector('#gkNew'); g.addEventListener('click',function(){ var c='abcdefghijkmnpqrstuvwxyz23456789', o='sk-hb-'; for(var i=0;i<24;i++) o+=c[Math.floor(Math.random()*c.length)]; n.value=o; n.type='text'; buzz(6); });
        sw.querySelector('[data-gk]').addEventListener('click',function(){ var v=n.value.trim(), bt=this; if(v.length<8){ n.focus(); buzz([20,30,20]); toast('至少 8 位'); return; }
          if(LV.pv){ confirmBox(win,'换网关 Key？','小手机和聊天页用登录就行，不受影响；用 Key 连进来的别的客户端（比如 Kelivo）要改成新的。','换',true,function(){ bt.classList.add('busy');
              (LV.env?Promise.resolve(LV.env):P.net.get(AB+'env').then(function(r){ LV.env=r; return r; })).then(function(r){ var e=(r&&r.env)||{}; if(!e.TARGET_API_URL||!e.MODEL_NAME) throw new Error('读不到后台配置');
                return P.net.post(AB+'save',{target_url:e.TARGET_API_URL,model_name:e.MODEL_NAME,gateway_api_key:v}); }).then(function(){ bt.classList.remove('busy'); sw.querySelector('.gk-v').textContent=v.slice(0,6)+'••••••••'+v.slice(-4); setRv('pass','••••'+v.slice(-4)); n.value=''; n.type='password'; toast('换好了'); buzz([8,30,8]); },function(e){ bt.classList.remove('busy'); toast('没换成'+(e&&e.message?'：'+e.message.slice(0,30):'')); buzz([20,30,20]); }); }); return; } toast('还没读到后台配置，稍后再存'); buzz([20,30,20]); }); }});   /* 以前这里只改界面文字就报「换好了」，服务端其实没变 */
    else if(k==='pwd') sheet(win,'修改密码','<input class="pg-in" type="password" placeholder="现在的密码" style="margin-bottom:8px" autocomplete="current-password"><input class="pg-in" type="password" placeholder="新密码" style="margin-bottom:8px" autocomplete="new-password"><input class="pg-in" type="password" placeholder="再输一遍" autocomplete="new-password"><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-pw>改好了</button></div>',function(sh,close){
        sh.querySelector('[data-pw]').addEventListener('click',function(){ var ip=sh.querySelectorAll('input'), o=ip[0].value, a=ip[1].value.trim(), b2=ip[2].value.trim(), bt=this;
          if(!o){ ip[0].focus(); buzz([20,30,20]); return; } if(a.length<4){ ip[1].focus(); toast('新密码至少 4 位'); buzz([20,30,20]); return; } if(a!==b2){ ip[2].focus(); toast('两次不一样'); buzz([20,30,20]); return; }
          if(!bgo(bt,'修改中…')) return; P.net.post(AB+'change-password',{old_password:o,new_password:a}).then(function(r){ if(r&&r.ok===false){ bend(bt,false); toast(r.error||'没改成'); return; } bend(bt,true,'已修改'); later(function(){ close(); toast('改好了 · 所有设备要重新登录'); buzz([8,30,8]); try{ localStorage.removeItem('han_logged_in'); }catch(e){} }); },function(e){ bend(bt,false); toast(/400/.test(String(e&&e.message))?'现在的密码不对':'没改成'); buzz([20,30,20]); }); }); });
    /* [位置:phone-pages.js·cfgMount(go:local)] [本机数据页] [看这台手机存了什么（真实大小）、清掉本机缓存、一键清掉所有会话的快照] [注释时间 2026-10-21]
       旧版是写死的数字（2 KB / 1.9 MB…）和「导出 / 导入所有数据」假动作（标着未接）。现在：
       ①列表读 localStorage 里 ph.* 的真实字节数 ②「清空本机数据」只清 ph.* 键（桌面布局 / 外观 / 草稿 / 笔记缓存…），不碰登录标记 ③「清除所有会话快照」调 POST /v1/snapshots/clear-all
       「导出 / 导入所有数据」没有对应后端接口，整组删掉，不再画假按钮。 */
    else if(k==='local'){
      var LS_GROUPS=[['桌面布局','ph.nw.'],['聊天主题 · 气泡外观','ph.look.'],['设置 · 主题','ph.set.'],['我的 · 签名 / 封面','ph.me.'],['笔记本缓存','ph.note.'],['气泡最近用','ph.bubble.'],['草稿','ph.draft.']];
      function lsBytes(prefix){ var n=0; try{ for(var i=0;i<localStorage.length;i++){ var key=localStorage.key(i); if(key&&key.indexOf(prefix)===0){ n+=key.length+String(localStorage.getItem(key)||'').length; } } }catch(e){} return n*2; }
      function fmtB(n){ return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B'; }
      function rowsLocal(){ return LS_GROUPS.map(function(g){ return r({t:g[0],v:fmtB(lsBytes(g[1]))}); }); }
      /* [位置:phone-pages.js·cfgMount(go:local) 操作区] [本机数据页：强制刷新 / 清快照 / 清本机数据，三个全宽按钮] [11-05 拍板方案 C：原来「清快照」是一行、「清空本机数据」是红胶囊，形态不统一，还缺一个自救入口；现三个都用 pg-btn 各占一行（强制刷新普通字、两个清除红字），说明收进底部一句。按钮按 data-act 精确绑定（旧版 querySelector('.pg-btn.red') 取第一个红按钮，两个红按钮并存会把「清快照」绑成「清空本机数据」的确认框）；loading 走通用 bgo/bend。强制刷新：清 Cache Storage + 让 SW 检查更新 + 带时间戳 reload，600ms 兜底，防某个 Promise 卡住按钮点了没反应] [注释时间 2026-11-05] */
      /* [位置:phone-pages.js·cfgMount(go:local) 操作区 样式改版] [强制刷新通栏 + 两个清除并排，圆角矩形带图标，不带说明小字] [11-05：方案 C 三条等宽胶囊太丑，说明小字也不要；改成一个通栏主按钮 + 两个并排的危险按钮（淡红底细红边），类名 ld-*，不动共用的 pg-btn] [注释时间 2026-11-05] */
      function actBtn(txt,act,red,ic){ return '<button class="ld-btn tap'+(red?' red':'')+'" type="button" data-act="'+act+'">'+svg(ic)+'<span>'+txt+'</span></button>'; }
      var IC_REF='<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>', IC_LAY='<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>', IC_TRS='<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
      function forceFresh(b){
        if(!bgo(b,'刷新中…')) return;
        var gone=false; function go(){ if(gone) return; gone=true; location.replace(location.pathname+'?fresh='+Date.now()); }
        setTimeout(go,600);
        var ps=[];
        try{ if(window.caches&&caches.keys) ps.push(caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); })); }catch(e){}
        try{ if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations) ps.push(navigator.serviceWorker.getRegistrations().then(function(rs){ return Promise.all(rs.map(function(x){ return x.update(); })); })); }catch(e){}
        Promise.all(ps).then(go,go);
      }
      sub(win,'本机数据',grp('在这台手机上',rowsLocal(),null,0)+
        '<div class="ld-acts pg-rise" style="--i:1">'+actBtn('强制刷新页面','refresh',false,IC_REF)+'<div class="ld-row2">'+actBtn('清除会话快照','snapall',true,IC_LAY)+actBtn('清空本机数据','localclear',true,IC_TRS)+'</div></div>',
        {act:function(k2,t2){
          if(t2.classList.contains('busy')) return;   /* 忙碌中再点不重复弹确认框 */
          if(k2==='refresh'){ forceFresh(t2); return; }
          if(k2==='snapall'){
            confirmBox(win,'清除所有会话的快照？','下一轮对话会按当前人设、记忆、日记重新生成。','清除',true,function(){
              if(!bgo(t2,'清除中…')) return;
              P.net.post('/v1/snapshots/clear-all',{}).then(function(d){ if(d&&d.error){ bend(t2,false); toast('没清掉：'+String(d.error).slice(0,40)); return; }
                if(P.chats&&P.chats.invalidateSnapshots) P.chats.invalidateSnapshots();   /* 10-28：同时清前端 SNAP 缓存，回列表红点立即消失 */
                bend(t2,true,'已清除'); toast(d&&typeof d.deleted==='number'?'清掉了 '+d.deleted+' 个，下次聊天自动重建':'快照已清除，下次聊天自动重建'); },
                function(e){ bend(t2,false); toast('没清掉：'+String(e&&e.message||'').replace(/^HTTP /,'').slice(0,40)); }); });
            return; }
          if(k2==='localclear'){
            confirmBox(win,'清空本机数据？','桌面布局、聊天外观、笔记缓存、草稿会回到默认。服务器上的东西和登录状态不受影响。','清空',true,function(){
              try{ var ks=[]; for(var i=0;i<localStorage.length;i++){ var key=localStorage.key(i); if(key&&key.indexOf('ph.')===0) ks.push(key); } ks.forEach(function(x){ localStorage.removeItem(x); }); }catch(e){}
              var pgs=t2.closest('.pg-sub').querySelector('.pg-g'); if(pgs) pgs.innerHTML=rowsLocal().join(''); toast('清空了，下次打开恢复默认'); buzz([8,30,8]); }); }
        }});
    }
  }
/* ---------- 模型供应商（/admin/ai-providers；测试 /admin/providers/test；余额 /admin/providers/balance）----------
   真实字段：name / enabled / api_url（= 基址 + 路径）/ api_key / profile（default=OpenAI 兼容，claude=Anthropic）/ balance_url / models[] / model（默认）/ sampling_override。
   预设照 chat.html 的 PROVIDER_TYPES。多 Key、Response API、代理、自定义请求后端没有，画出来标「未接」。 */
var PV_TYPES=[['OpenAI','https://api.openai.com/v1','/chat/completions','default','','官方'],['Claude','https://api.anthropic.com','/v1/messages','claude','','官方'],['Gemini','https://generativelanguage.googleapis.com/v1beta/openai','/chat/completions','default','','官方'],['DeepSeek','https://api.deepseek.com/v1','/chat/completions','default','https://api.deepseek.com/user/balance','官方'],['Kimi','https://api.moonshot.cn/v1','/chat/completions','default','https://api.moonshot.cn/v1/users/me/balance','官方'],['智谱 GLM','https://open.bigmodel.cn/api/paas/v4','/chat/completions','default','','官方'],['阿里云百炼','https://dashscope.aliyuncs.com/compatible-mode/v1','/chat/completions','default','','官方'],['火山方舟','https://ark.cn-beijing.volces.com/api/v3','/chat/completions','default','','官方'],['腾讯混元','https://api.hunyuan.cloud.tencent.com/v1','/chat/completions','default','','官方'],['百度千帆','https://qianfan.baidubce.com/v2','/chat/completions','default','','官方'],['MiniMax','https://api.minimaxi.com/v1','/chat/completions','default','','官方'],['阶跃星辰','https://api.stepfun.com/v1','/chat/completions','default','','官方'],['xAI','https://api.x.ai/v1','/chat/completions','default','','官方'],['Groq','https://api.groq.com/openai/v1','/chat/completions','default','','官方'],['Mistral','https://api.mistral.ai/v1','/chat/completions','default','','官方'],['OpenRouter','https://openrouter.ai/api/v1','/chat/completions','default','https://openrouter.ai/api/v1/key','中转'],['硅基流动','https://api.siliconflow.cn/v1','/chat/completions','default','https://api.siliconflow.cn/v1/user/info','中转'],['AiHubMix','https://aihubmix.com/v1','/chat/completions','default','','中转'],['302.AI','https://api.302.ai/v1','/chat/completions','default','','中转'],['Together','https://api.together.xyz/v1','/chat/completions','default','','中转'],['Claude 订阅','http://127.0.0.1:3000/internal/anthropic','/chat/completions','claude','','登录','claude'],['Gemini 订阅','http://127.0.0.1:3000/internal/oauth','/chat/completions','default','','登录','gemini'],['Antigravity 订阅','http://127.0.0.1:3000/internal/oauth','/chat/completions','default','','登录','antigravity'],['ChatGPT 订阅','http://127.0.0.1:3000/internal/oauth','/chat/completions','default','','登录','codex'],['Grok 订阅','http://127.0.0.1:3000/internal/oauth','/chat/completions','default','','登录','grok']];


var PVD=[];
  /* [位置:phone-pages.js·cfgMount·默认聊天模型行] [行内原生分组下拉] [11-05 晚：原来点这行弹自绘抽屉，现在行里就是一个原生 select（外观照旧），点整行弹系统分组菜单；选中即改供应商默认模型并保存（PUT /admin/ai-providers），失败回滚选中值] [注释时间 2026-11-05] */
  var defMd=null;
  (function(){
    var row=root.querySelector('[data-md="def"]'); if(!row) return;
    defMd=mdBind(row,'',function(v,pid,model,prev){
      var pv=pid?PVD.filter(function(p){ return p.id===pid; })[0]:null;
      if(!pv){ toast('这个供应商不在列表里了'); if(defMd) defMd.want(prev); return; }
      var old=PVD.map(function(p){ return [p.isDef,p.def]; });
      PVD.forEach(function(p){ p.isDef=p===pv; }); pv.def=model;
      pvSave().then(function(){ toast('默认聊天模型改成 '+model); buzz([8,30,8]); },function(){ PVD.forEach(function(p,j){ p.isDef=old[j][0]; p.def=old[j][1]; }); if(defMd) defMd.want(prev); });
    });
  })();
  /* [位置:phone-pages.js·cfgMount·imgDescPage] [图片转写二级页：模型 + 提示词] [11-21：原外层模型下拉和用途提示词分组里的图片转写提示词收拢到同一个二级页，和语音模型页风格统一] [注释时间 2026-11-21] */
  function imgDescPage(){
    function pSub(){ var v=P.pvals&&P.pvals[8]; return v&&P.plen?P.plen(8).toLocaleString()+' 字':'读取中…'; }
    function pTitle(){ var v=P.pvals&&P.pvals[8]; return '图片转写提示词'+(v&&v.custom_set?' <span class="pg-tag">改过</span>':''); }
    var pg=sub(win,'图片转写',
      '<div class="pg-gt">模型</div><div class="pg-g">'+mdSelHtml({ic:'cam',t:'图片转写模型'+hint('给不能看图的聊天模型生成图片文字转写'),k:'imM'})+'</div>'+
      '<div class="pg-gt">提示词</div><div class="pg-g">'+r({t:pTitle(),s:pSub(),act:'imP',right:I.ch,id:'imPRow'})+'</div>',
      {act:function(k){ if(k==='imP'){ buzz(6); if(P.pedit) P.pedit(win,8,paintP); } }});
    function paintP(){
      var rw=pg.querySelector('#imPRow'); if(!rw) return;
      var b=rw.querySelector('.rt b'), sm=rw.querySelector('.rt small');
      if(b) b.innerHTML=pTitle();
      if(sm) sm.textContent=pSub();
    }
    if(P.pfetch) P.pfetch(8).then(paintP,paintP);
    var inst=mdBind(pg.querySelector('[data-md="imM"]'),'',function(v,pid,model,prev){
      P.net.req('/heartbeat/admin/model-roles/image_desc',{method:'PUT',body:{provider_id:pid,model:model}}).then(function(){
        toast('图片转写 → '+(pid?model:'跟随聊天模型')); buzz([8,30,8]);
      },function(){ toast('没改成'); buzz([20,30,20]); inst.want(prev); });
    });
    P.net.get('/heartbeat/admin/model-roles',{noLogin:true}).then(function(res){
      var x=res&&res.roles&&res.roles.image_desc;
      inst.want((x&&x.provider_id&&x.model)?(x.provider_id+'|'+x.model):'');
    },function(){});
  }
  /* [位置:phone-pages.js·用途模型页] [已删] [11-20：整页不要了——入口从配置页模型组撤掉，页面代码连同 go:'roles' 分支一起删；图片转写/语音识别这两项挪进模型组（见上面 cfgBody 的两行和下面 roleInsts），其余五项用途（状态机/门卫/两大块总结/老数据重跑/每日蒸馏）暂时没有界面入口，改的时候直接打 /admin/model-roles/:role] [注释时间 2026-11-20] */

/* [位置:phone-pages.js·pvOauthText] [订阅登录状态的一句话] [列表和详情里把「已连接/未登录/登录已失效」说清楚，失效时直接给入口] [注释时间 2026-10-22] */
function pvOauthText(st){
  if(!st||!st.connected) return st&&st.needs_reauth?'登录已失效':'未登录';
  if(st.needs_reauth) return '登录已失效';
  return '已连接'+(st.email?' · '+st.email:'')+(st.expired?'（已过期）':'');
}
/* [位置:phone-pages.js·provOauthRelogin] [订阅账号重新授权] [手机上换号或登录失效时不用回电脑：拿授权链接 → 粘贴回调 → 换令牌] [注释时间 2026-10-22] */
function provOauthRelogin(op, account, done){
  if(!op) return;
  var qs=account?'?account='+encodeURIComponent(account):'';
  P.net.get(AB+'oauth/'+op+'/start'+qs).then(function(j){
    if(!j||!j.ok){ toast((j&&j.error)||'启动失败'); buzz([20,30,20]); return; }
    try{ window.open(j.auth_url,'_blank'); }catch(e){}
    sheet(win,'登录 '+(j.label||op),
      '<div class="pg-g"><div class="pg-tip">授权后把地址栏整条粘到这里（浏览器跳到 localhost 打不开是正常的）</div>'+
      '<input class="pg-in mono" id="oaU" placeholder="http://localhost:.../callback?code=..." autocomplete="off" spellcheck="false"></div>'+
      '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-oa="go" type="button">换取令牌</button></div>',
      function(sh, close){
        var inp=sh.querySelector('#oaU'), bt=sh.querySelector('[data-oa="go"]');
        bt.addEventListener('click', function(){
          var u=(inp.value||'').trim();
          if(!u){ inp.focus(); return; }
          bt.classList.add('busy'); bt.textContent='换取中…';
          P.net.post(AB+'oauth/'+op+'/exchange',{url:u, account:account||'default'}).then(function(r){
            bt.classList.remove('busy'); bt.textContent='换取令牌';
            if(!r||!r.ok){ toast((r&&r.error)||'换 token 失败'); buzz([20,40,20]); return; }
            close(); toast('已连接'+(r.status&&r.status.email?' · '+r.status.email:'')); buzz([8,30,8]);
            if(done) done(r.status);
          },function(){ bt.classList.remove('busy'); bt.textContent='换取令牌'; toast('换 token 失败'); });
        });
      });
  },function(){ toast('启动失败'); });
}
/* [位置:phone-pages.js·provOauthAccounts] [订阅账号列表] [同一家挂多个号时在这里看/加/删/重登，一个号被限流会自动换下一个] [注释时间 2026-10-22] */
function provOauthAccounts(op, done){
  var label=({claude:'Claude',gemini:'Gemini',antigravity:'Antigravity',codex:'ChatGPT',grok:'Grok'})[op]||op;
  P.net.get(AB+'oauth/'+op+'/status').then(function(j){
    var list=(j&&j.accounts)||[];
    var rows=list.map(function(a){
      var st=pvOauthText(a)+(a.cooling?' · 冷却中':'');
      return '<div class="pg-g" style="margin-top:10px"><div class="pg-r"><span class="rt"><b>'+esc(a.email||a.account)+'</b><small>'+st+'</small></span>'+
        '<button class="pg-btn tap" type="button" data-re="'+esc(a.account)+'">重登</button>'+
        (a.account==='default'?'':'<button class="pg-btn tap red" type="button" data-rm="'+esc(a.account)+'">删</button>')+
        '</div></div>';
    }).join('');
    sheet(win,label+' 订阅账号',
      '<div class="pg-tip">挂多个号时，一个被限流会自动换下一个。</div>'+
      (rows||'<div class="pg-empty">还没有账号</div>')+
      '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" type="button" data-add="1">添加账号</button></div>',
      function(sh, close){
        sh.addEventListener('click', function(e){
          var b=e.target.closest('[data-re],[data-rm],[data-add]');
          if(!b) return; buzz(6);
          if(b.dataset.add){ close(); provOauthRelogin(op, 'a'+Date.now().toString(36), done); return; }
          if(b.dataset.rm){
            var acc=b.dataset.rm;
            confirmBox(win,'删除这个账号？','只是删掉这份令牌，随时可以重新登录。','删除',true,function(){
              P.net.post(AB+'oauth/'+op+'/logout',{account:acc}).then(function(){ close(); if(done) done(); },function(){ toast('没删成'); });
            });
            return;
          }
          if(b.dataset.re){ close(); provOauthRelogin(op, b.dataset.re, done); }
        });
      });
  },function(){ toast('读不到账号状态'); });
}
function provList(){
  var q='';
  var s=sub(win,'模型供应商','<div class="pg-search">'+I.find+'<input class="pg-in" id="pvQ" placeholder="搜索供应商"></div><div class="pg-g pg-rise pv-list" id="pvL"></div>',{right:'<button class="pg-cb tap" data-act="add" aria-label="添加供应商">'+I.plus+'</button>',act:function(k){ if(k==='add') provAdd(changed); }});
  var L=s.querySelector('#pvL'), LD=subLoad(s,L);
  function paint(flash){
    /* 第一次进来数据还在路上（load() 那条 ai-providers 要 2s）：先转圈，别先画一句「还没读到数据」再自己变 */
    if(!PVD.length&&!CDONE.pv){ LD.on(); return; }
    LD.off();
    /* [位置:phone-pages.js·provList·paint] [启用供应商置顶] [11-09：列表里启用的排前面、停用的沉后面；只在过滤副本上排序，PVD 本身顺序不动，data-p 存的仍是 PVD 下标，详情跳转/整表保存不受影响] [注释时间 2026-11-09] */ var arr=PVD.filter(function(p){ return !q||p.n.toLowerCase().indexOf(q)>=0; }).sort(function(a,b){ return (b.on?1:0)-(a.on?1:0); }); L.innerHTML=arr.map(function(p){ var i=PVD.indexOf(p); return '<button class="pg-r pv-row" data-p="'+i+'">'+pvLogo(p)+'<span class="rt"><b>'+esc(p.n)+'</b><small>'+(p.oauth?pvOauthText(p.st):(p.models.length+' 个模型'))+'</small></span><span class="pv-pill'+(p.on?'':' off')+'">'+(p.on?'启用':'禁用')+'</span>'+I.ch+'</button>'; }).join('')||'<div class="pg-empty">'+(q?'没有叫这个的':CERR.pv?'没读到数据，网络好了再进来看看':'还没有供应商')+'</div>'; if(flash!=null){ var n=L.querySelector('[data-p="'+flash+'"]'); if(n){ n.classList.add('flash'); n.scrollIntoView({block:'center',behavior:'smooth'}); } } var cnt=document.querySelector('[data-go="prov"] .rv'); if(cnt) cnt.textContent=PVD.filter(function(p){ return p.on; }).length+' 个在用'; }
  function changed(f){ paint(f); pvSaveSoon(); }
  cfgWait('pv',function(){ paint(); });
  paint();
  s.querySelector('#pvQ').addEventListener('input',function(){ q=this.value.trim().toLowerCase(); paint(); });
  L.addEventListener('click',function(e){ var b=e.target.closest('[data-p]'); if(!b) return; buzz(6); provDetail(+b.dataset.p,changed); });
  P.cfg.provAdd=function(){ provAdd(changed); }; P.cfg.provOpen=function(i){ provDetail(i||0,changed); };
}
/* 详情：底部两页（配置 / 模型），右上 体检（测试连接）/ 删除 */
function provDetail(i,repaint){
  var p=PVD[i], showKey=false, picking=false, sel={};
  var formFields=
      fd('名称','<input class="pg-in" id="pvN" value="'+esc(p.n)+'">')+
      fd('API Key','<div class="pv-key"><input class="pg-in mono" id="pvK" type="password" placeholder="'+(p.keySet?'已设置 · 留空不改':'sk-…')+'" value="'+esc(p.key)+'"><button class="tap" data-act="eye" aria-label="显示">'+PX.eye+'</button></div>')+
      fd('API Base URL','<input class="pg-in mono" id="pvB" value="'+esc(p.base)+'">')+
      fd('API 路径','<input class="pg-in mono" id="pvP" value="'+esc(p.path)+'">')+
      fd('消息格式',seg(['OpenAI 兼容','Anthropic'],p.prof==='claude'?1:0).replace('pg-seg','pg-seg pv-seg'))+
      fd('余额接口'+hint('查余额时 GET 这个地址；选了预设会自动带上'),'<input class="pg-in mono" id="pvBl" placeholder="没有就空着" value="'+(p.balUrl!=null?esc(p.balUrl):(p.bal?esc(p.base.replace(/\/v1$/,'')+'/user/balance'):''))+'">');
  var cfgPane=
    '<div class="pg-g pg-rise">'+r({t:'是否启用',tg:1,on:p.on,tgname:'en'})+(p.oauth?'':r({t:'获取账户余额',act:'bal',right:'<span class="rv" id="pvBal">'+(p.bal?'点一下查':'')+'</span>'+I.ch}))+'</div>'+
    (p.oauth
      ? '<div class="pg-g pg-rise pv-fold" style="--i:1;margin-top:12px"><button type="button" class="pg-r pv-fold-hd tap" data-act="fold"><span class="rt"><b>基本配置</b><small>名称 · 接口地址 · 消息格式</small></span><span class="rv" id="pvFoldN">'+esc(p.n)+'</span><svg class="pv-fchv" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button><div class="pv-fold-bd pv-form">'+formFields+'<div class="pg-bts" style="padding:12px 14px 16px"><button class="pg-btn pri tap" data-act="save">保存</button></div></div></div>'+
        '<div class="pg-g pg-rise" style="--i:2;margin-top:12px">'+r({t:'订阅登录',v:pvOauthText(p.st),act:'oa',s:(p.st&&p.st.needs_reauth?'点这里重新授权':'换号或重新授权')})+
        ((p.oauth==='claude'||p.oauth==='antigravity'||p.oauth==='grok')?r({t:'订阅额度',act:'qt',right:'<span class="rv" id="pvQ">点一下查</span>'+I.ch})+'<div class="pv-qt" id="pvQt"></div>':'')+'</div>'
      : '<div class="pg-g pg-rise pv-form" style="--i:1;margin-top:12px">'+formFields+'</div><div class="pg-bts" style="padding:18px 0 0"><button class="pg-btn pri tap" data-act="save">保存</button></div>');
  var s=sub(win,esc(p.n),'<div class="pg-pane on" id="pvCfg">'+cfgPane+'</div><div class="pg-pane" id="pvMd"></div>',{
    right:'<span class="pv-hd"><button class="pg-cb tap" data-act="test" aria-label="测试连接">'+PX.heart+'</button><button class="pg-cb tap" data-act="del" aria-label="删除">'+PX.trash+'</button></span>',
    toggle:function(t,on){ if(t.dataset.tg==='en'){ p.on=on; repaint(); toast(on?'启用了':'停用了'); } },
    act:function(k,t){
      if(k==='eye'){ showKey=!showKey; var inp=s.querySelector('#pvK'); inp.type=showKey?'text':'password'; t.innerHTML=showKey?PX.eyeoff:PX.eye; buzz(5); }
      else if(k==='bal'){ var v=s.querySelector('#pvBal'); if(!p.bal){ v.textContent='没配余额接口'; v.classList.add('warn'); buzz([12,30,12]); s.querySelector('#pvBl').focus(); return; } v.innerHTML='<i class="pg-spin"></i>'; v.className='rv';
        if(LV.pv){ P.net.post(AB+'providers/balance',{id:p.id}).then(function(r){ if(r&&r.ok){ v.textContent=(r.currency==='USD'?'$ ':'¥ ')+(+r.balance).toFixed(2); v.classList.add('ok'); buzz([8,30,8]); } else { v.textContent=String((r&&r.error)||'查不到').slice(0,16); v.classList.add('warn'); buzz([12,30,12]); } },function(){ v.textContent='查不到'; v.classList.add('warn'); }); return; }
        v.textContent='先保存'; v.classList.add('warn'); buzz([12,30,12]); }
      /* [位置:phone-pages.js·provDetail·qt 查额度] [点一下查订阅额度] [POST /admin/providers/claude-usage（5 小时 / 7 天两条）或 gemini-usage（一个模型一行 + 套餐名小字，已用多的排前）；先转圈，成功展开进度条（条宽从 0 过渡到值），失败只在行右侧写一句原因；再点一次=重新查（后端 60 秒内走缓存）] [注释时间 2026-11-09；改动 2026-11-12：按 p.oauth 分流，Gemini 走 gemini-usage，qt-r 支持 gm 变体；用户 03:34：各模型重置时间基本同一时刻，收进标题行右侧，行内只给跟它差超 5 分钟的补小字；2026-11-18：Grok 走 grok-usage，「本周」主行（重置倒计时走 Claude 式行内小字）+ 产品占比一行小字（.qt-plan 复用）] */
      else if(k==='qt'){ var qv=s.querySelector('#pvQ'), qb=s.querySelector('#pvQt'), isGm=p.oauth==='antigravity', isGk=p.oauth==='grok'; if(qv.querySelector('.pg-spin')) return;
        if(!p.id||!LV.pv){ qv.textContent='先保存'; qv.className='rv warn'; buzz([12,30,12]); return; }
        qv.innerHTML='<i class="pg-spin"></i>'; qv.className='rv';
        P.net.post(AB+'providers/'+(isGm?'gemini-usage':isGk?'grok-usage':'claude-usage'),{id:p.id}).then(function(r2){
          if(!r2||!r2.ok){ qv.textContent=String((r2&&r2.error)||'查不到').slice(0,22); qv.className='rv warn'; qb.classList.remove('on'); buzz([12,30,12]); return; }
          qv.textContent=r2.cached?'刚查过':'已更新'; qv.className='rv ok';
          function lvl(v){ return v>=90?' hi':(v>=70?' mid':''); }
          function rst(t){ if(!t) return ''; var d=t*1000-Date.now(); if(d<=0) return '已重置'; var m=Math.round(d/60000), h=Math.floor(m/60); if(h>=24) return Math.floor(h/24)+' 天 '+(h%24)+' 小时后重置'; return (h?h+' 小时 ':'')+(m%60)+' 分后重置'; }
          function row(nm,w,cls){ var v=w&&w.used_pct!=null?w.used_pct:null; if(v==null) return '';
            var rs=rst(w.reset_at);
            return '<div class="qt-r'+(cls?' '+cls:'')+'"><span class="qt-l">'+esc(nm)+'</span><span class="qt-b"><i class="'+lvl(v).trim()+'" data-w="'+v+'"></i></span><span class="qt-v">'+v+'%</span>'+(rs?'<small>'+rs+'</small>':'')+'</div>'; }
          qb.innerHTML = isGm
            ? (function(){ var ms=(r2.models||[]);
                /* 按池收拢（用户 04:56 拍板）：实测同一池所有模型共享同一个剩余比例和重置窗口（gemini 系九个数字一致、claude/gpt 三个一致），逐模型列出来全是重复；按前缀分池，每池取已用最大值作代表，池内含 0% 的模型也一并代表掉，不再要「未使用」摘要行。池排序已用多的在前 */
                var pools=[], byKey={};
                ms.forEach(function(m){ var k=/^gemini/i.test(m.id)?'gemini':'other'; var p=byKey[k]; if(!p){ p=byKey[k]={key:k,used:0,reset:0,n:0,fams:{}}; pools.push(p); }
                  p.n++; if((m.used_pct||0)>p.used) p.used=m.used_pct||0; if(m.reset_at&&(!p.reset||m.reset_at<p.reset)) p.reset=m.reset_at;
                  var fam=String(m.id).split('-')[0]; if(fam) p.fams[fam]=1; });
                pools.sort(function(a,b){ return b.used-a.used; });
                function pname(p){ var core; if(p.key==='gemini') core='Gemini 系'; else { var f=Object.keys(p.fams).sort(); core=f.length>1?'Claude / GPT 系':(f[0]==='claude'?'Claude 系':(f[0]==='gpt'?'GPT 系':(f.join(' / ')||'其他')+' 系')); } return core+' · '+p.n+' 个模型'; }
                var rsl=pools.map(function(p){ return p.reset||0; }).filter(Boolean), headRst=rsl.length?Math.min.apply(null,rsl):0;
                if(headRst) qv.textContent=rst(headRst);
                return '<div>'
                  +(pools.length?pools.map(function(p){ return row(pname(p),{used_pct:p.used,reset_at:(headRst&&p.reset&&Math.abs(p.reset-headRst)<=300)?0:p.reset},'gm'); }).join(''):'<div class="qt-plan">目录里没拿到额度数据</div>')
                  +'</div>'; })()
            : isGk
              ? '<div>'+row('本周',r2)+((r2.products||[]).length?'<div class="qt-plan" style="padding-bottom:14px">'+r2.products.map(function(m){ return '产品 '+m.id+' · '+m.used_pct+'%'; }).join('　')+'</div>':'')+'</div>'
              : '<div>'+row('5 小时',r2.five_hour)+row('7 天',r2.seven_day)+'</div>';
          qb.classList.add('on');
          requestAnimationFrame(function(){ requestAnimationFrame(function(){ Array.prototype.forEach.call(qb.querySelectorAll('i[data-w]'),function(x){ x.style.width=x.dataset.w+'%'; }); }); });
          /* 展开后把「订阅额度」行滚到滚动区顶部附近：额度块多半长在表单底部，不滚会被底部页签挡住（05:07 截图发现） */
          setTimeout(function(){ var sc2=qb.closest('.pg-sc'), tr=qv.closest('.pg-r'); if(sc2&&tr) sc2.scrollTo({top: sc2.scrollTop + tr.getBoundingClientRect().top - sc2.getBoundingClientRect().top - 10, behavior:'smooth'}); },480);
          buzz([8,30,8]);
        },function(){ qv.textContent='查不到'; qv.className='rv warn'; qb.classList.remove('on'); buzz([12,30,12]); }); }
      else if(k==='fold'){ var fl=t.closest('.pv-fold'); if(fl) fl.classList.toggle('open'); buzz(6); }
      else if(k==='oa'){ provOauthAccounts(p.oauth, function(){ P.net.get(AB+'oauth/'+p.oauth+'/status').then(function(j){ if(j&&j.status){ p.st=j.status; var rv=s.querySelector('[data-act="oa"] .rv'); if(rv) rv.textContent=pvOauthText(p.st); } }); repaint(i); }); }
      else if(k==='save'){ if(!LV.pv){ noLive(t); return; } p.n=s.querySelector('#pvN').value.trim()||p.n; p.base=s.querySelector('#pvB').value.trim(); p.path=s.querySelector('#pvP').value.trim(); var nk=s.querySelector('#pvK').value.trim(); if(nk&&nk!==p.key) p.newKey=nk; p.balUrl=s.querySelector('#pvBl').value.trim(); p.bal=p.balUrl?'有':''; s.querySelector('.pg-hd .ttl').textContent=p.n; var fn=s.querySelector('#pvFoldN'); if(fn) fn.textContent=p.n; repaint(i);
        if(!bgo(t)) return; pvSave().then(function(){ bend(t,true); s.querySelector('#pvK').value=''; s.querySelector('#pvK').placeholder='已设置 · 留空不改'; toast('存好了'); buzz([8,30,8]); },function(){ bend(t,false); }); }
      else if(k==='test') provTest(p);
      else if(k==='del') confirmBox(win,'删除「'+esc(p.n)+'」？','用到它的用途模型会改回跟随聊天模型。','删除',true,function(){ if(!LV.pv){ noLive(null); return; } s.querySelector('[data-x="back"]').click(); PVD.splice(i,1); setTimeout(function(){ repaint(); toast('删掉了'); },300); });
    },
    seg:function(k){ p.prof=k?'claude':'default'; var pp=s.querySelector('#pvP'); if(k&&/chat\/completions/.test(pp.value)) pp.value='/v1/messages'; else if(!k&&/messages/.test(pp.value)) pp.value='/chat/completions'; pp.classList.add('flash'); setTimeout(function(){ pp.classList.remove('flash'); },700); }
  });
  s.classList.add('pv-dt');
  /* [位置:phone-pages.js·provDetail 自动查额度] [2026-11-23：进订阅详情页自动查一次额度并展开，不用每次手动点「点一下查」] */
  if(p.oauth&&(p.oauth==='claude'||p.oauth==='antigravity'||p.oauth==='grok')&&p.id&&LV.pv&&(!p.st||p.st.connected!==false)){
    setTimeout(function(){ var qr=s.querySelector('[data-act="qt"]'); if(qr&&s.isConnected) qr.click(); },180);
  }
  /* 底部两页切换 */
  var tb=document.createElement('div'); tb.className='pv-tab'; tb.innerHTML='<i></i><button class="on" data-t="0">'+PX.cfg+'<span>配置</span></button><button data-t="1">'+PX.box+'<span>模型</span></button>'; s.appendChild(tb);
  tb.addEventListener('click',function(e){ var b=e.target.closest('[data-t]'); if(!b) return; var k=+b.dataset.t; tb.style.setProperty('--k',k); s.classList.toggle('pv-on-m',!!k); Array.prototype.forEach.call(tb.querySelectorAll('button'),function(x){ x.classList.toggle('on',x===b); }); s.querySelector('#pvCfg').classList.toggle('on',!k); s.querySelector('#pvMd').classList.toggle('on',!!k); s.querySelector('.pg-sc').scrollTop=0; buzz(6); });
  var md=s.querySelector('#pvMd');
  /* [位置:phone-pages.js·provDetail·paintM] [模型列表头像与名称同行、状态标签分级] [2026-11-24：头像移进名称行，代理 / 看图 / 默认使用独立状态类；多选、默认模型与编辑索引不变] [注释时间 2026-11-24] */
  function paintM(){
    var n=Object.keys(sel).length; s.classList.toggle('pv-picking',picking);
    md.innerHTML='<div class="pv-mh">'+(picking?'<span class="pv-mhr pv-mseg"><button class="tap" data-mb="cancel">取消</button><button class="tap" data-mb="all">全选</button><button class="tap" data-mb="vm">看图</button>'+(p.pxall?'':'<button class="tap" data-mb="pm">代理</button>')+'<button class="tap red" data-mb="rm">删除'+(n?' '+n+' 个':'')+'</button></span>':'<b>模型</b><span class="pg-tag">'+p.models.length+'</span><span class="pv-mhr">'+(p.models.length?'<button class="tap" data-mb="pick">多选</button>':'')+'</span>')+'</div><div class="pg-g pg-rise pv-ml'+(picking?' picking':'')+'">'+p.models.map(function(m,j){
      var tags=(p.pxall||(p.pm||[]).indexOf(m)>=0?'<span class="pv-px pv-proxy" aria-label="走代理">代理</span>':'')+((p.vm||[]).indexOf(m)>=0?'<span class="pv-px pv-vision" aria-label="直接看图">看图</span>':'')+(m===p.def?'<span class="pg-tag ok">默认</span>':'');
      return '<button class="pg-r pv-m'+(sel[m]?' sel':'')+'"'+(sel[m]?' style="background:var(--sel-bg)"':'')+' data-m="'+j+'"><i class="ck">'+I.ok+'</i><span class="rt"><span class="pv-m-head"><span class="mlg">'+esc(m.replace(/^\[.*?\]/,'').slice(0,1).toUpperCase())+'</span><b>'+esc(m)+'</b></span>'+(tags?'<span class="pv-m-tags">'+tags+'</span>':'')+'</span></button>';
    }).join('')+'</div>'+
      '';
    updSelUI();
  }
/* [位置:phone-pages.js·provDetail·paintM 多选批量动作] [多选底栏加「看图」「代理」] [2026-11-14 第 25 条：多选吸顶行加批量标记动作，智能开关——选中模型全有该标记就整批取消（按钮转「取消×」态），部分有/没有就整批补齐；写同一份 p.vm/p.pm 配置（与 modelSheet 编辑弹层同源），存链路走 repaint(=changed→pvSaveSoon)；订阅类供应商(pxall)不渲染「代理」：订阅类一律经本机代理出海（同 modelSheet 走代理锁定，11-11），批量开关对它无语义；不碰 p.vm/p.pm 的读取链路（发图转写豁免、代理路由）。样式顺手收拾（注释备注 2026-11-14 二改）：多选时吸顶行收成一行——隐藏「模型 N」标题（「删除 N 个」已带计数）、动作钮 white-space:nowrap + 缩内边距字号（11.5px/0 6px）、pv-mhr 居中，防六个按钮挤成两行文字竖排；选中行加 var(--sel-bg) 浅底、按钮「取消×」态转浅强调。样式全走生成 HTML 的内联 style（本次任务纪律只改 phone-pages.js，不动 CSS 文件）] [注释时间 2026-11-14] */
  function pvBatchOn(key){ var ns=Object.keys(sel); return !!ns.length&&ns.every(function(m){ return (p[key]||[]).indexOf(m)>=0; }); }
/* [位置:phone-pages.js·updSelUI] [已选态改走 .on 类] [多选操作条改一体分段控件后按钮不带内联配色，选中态统一由 CSS 的 .pv-mhr button.on 给底，内联色会压在分段底上盖掉分隔线与圆角] [注释时间 2026-11-15] */
    function updSelUI(){ var ns=Object.keys(sel), rm=md.querySelector('[data-mb="rm"]'); if(rm) rm.textContent='删除'+(ns.length?' '+ns.length+' 个':'');
    var vm=md.querySelector('[data-mb="vm"]'); if(vm){ var a=pvBatchOn('vm'); vm.textContent=a?'取消看图':'看图'; vm.classList.toggle('on',a); }
    var pm=md.querySelector('[data-mb="pm"]'); if(pm){ var b=pvBatchOn('pm'); pm.textContent=b?'取消代理':'代理'; pm.classList.toggle('on',b); } }
  var mb=document.createElement('div'); mb.className='pv-mb pv-mb2'; mb.innerHTML='<button class="tap" data-mb="fetch">'+PX.dl+'获取</button><button class="tap pri" data-mb="add">'+I.plus+'添加新模型</button>'; s.appendChild(mb);
  mb.addEventListener('click',function(e){ var b=e.target.closest('[data-mb]'); if(!b) return; var k=b.dataset.mb; buzz(6);
    if(k==='fetch'){ if(b.classList.contains('busy')) return;
      /* [位置:phone-pages.js·provDetail·fetch] [订阅类供应商免 Key 校验直接拉模型目录] [2026-11-20：订阅类（p.oauth）没有 API Key，原来 !ky&&!p.keySet 会直接拦住弹「还没填 Key」，改为 !p.oauth&&!ky&&!p.keySet] [注释时间 2026-11-20] */
      if(LV.pv){ var ky=(s.querySelector('#pvK').value||'').trim()||p.newKey; if(!p.oauth&&!ky&&!p.keySet){ toast('还没填 Key'); buzz([12,30,12]); return; }
        b.classList.add('busy'); b.innerHTML='<i class="pg-spin"></i>获取中'; pvModels(p,ky).then(function(l){ b.classList.remove('busy'); b.innerHTML=PX.dl+'获取'; if(!l.length){ toast('没拉到模型'); return; } fetchSheet(l); },function(e){ b.classList.remove('busy'); b.innerHTML=PX.dl+'获取'; toast('拉不到：'+((e&&e.message)||'对方不让浏览器直接访问')); buzz([20,30,20]); }); return; }
      toast('未连接后台'); }
    else modelSheet(null); });
  paintM();
  md.addEventListener('click',function(e){
    var b=e.target.closest('[data-mb]');
    if(b){ var k=b.dataset.mb; buzz(6);
      if(k==='pick'){ picking=true; sel={}; paintM(); }
      else if(k==='cancel'){ picking=false; sel={}; paintM(); }
      else if(k==='all'){ var allOn=Object.keys(sel).length===p.models.length; sel={}; if(!allOn) p.models.forEach(function(m){ sel[m]=1; }); paintM(); }
      else if(k==='vm'||k==='pm'){ var ns=Object.keys(sel); if(!ns.length){ toast('先点选要标记的'); return; } var arr=p[k]||[], allOn=ns.every(function(m){ return arr.indexOf(m)>=0; }); if(allOn) p[k]=arr.filter(function(m){ return ns.indexOf(m)<0; }); else ns.forEach(function(m){ if(arr.indexOf(m)<0) arr.push(m); }); paintM(); Array.prototype.forEach.call(md.querySelectorAll('.pv-m.sel'),function(x){ x.classList.add('flash'); }); repaint(); toast(allOn?'已取消 '+ns.length+' 个的'+(k==='vm'?'看图':'代理'):'已给 '+ns.length+' 个开了'+(k==='vm'?'看图':'代理')); buzz([8,30,8]); }
      else if(k==='rm'){ var n=Object.keys(sel); if(!n.length){ toast('先点选要删的'); return; } confirmBox(win,'删掉 '+n.length+' 个模型？','只是从这家的列表里拿掉。','删除',true,function(){ Array.prototype.forEach.call(md.querySelectorAll('.pv-m.sel'),function(x){ x.classList.add('gone'); }); setTimeout(function(){ p.models=p.models.filter(function(m){ return !sel[m]; }); p.pm=(p.pm||[]).filter(function(m){ return p.models.indexOf(m)>=0; }); if(p.models.indexOf(p.def)<0) p.def=p.models[0]||''; picking=false; sel={}; paintM(); repaint(); toast('删好了'); },320); }); }
      else if(k==='fetch'){ toast('未连接后台'); }
      else if(k==='add') modelSheet(null);
      return; }
    var m=e.target.closest('.pv-m'); if(!m) return; var name=p.models[+m.dataset.m];
    if(picking){ if(sel[name]) delete sel[name]; else sel[name]=1; m.classList.toggle('sel'); m.style.background=sel[name]?'var(--sel-bg)':''; buzz(5); updSelUI(); return; }
    buzz(6); modelSheet(name);
  });
  /* 获取（GET /models）：拉到的先在抽屉里勾，已经有的置灰，勾好了再加；2026-11-23 加顶部搜索框（多词空格分词、大小写不敏感、全选仅作用于当前筛出项） */
  function fetchSheet(real){
    var stem=(p.models[0]||p.n).replace(/^\[.*?\]/,'').replace(/-(pro|flash|lite|mini|vision|preview|code)$/,'');
    var got=(real||p.models.concat([stem+'-preview',stem+'-mini',stem+'-vision',stem+'-thinking',stem+'-0925',stem+'-embedding'])).filter(function(m,j,a){ return a.indexOf(m)===j; }), pk={};
    sheet(win,'拉到 '+got.length+' 个模型',
      '<div class="pg-search fm-s">'+I.find+'<input class="pg-in" data-fmq placeholder="搜模型名（空格可多词）" aria-label="搜模型名"><span class="fm-hit" aria-live="polite"></span><button class="fm-clr tap" data-fm="clr" type="button" hidden aria-label="清空搜索">×</button></div>'+
      '<div class="pg-g fm-l">'+got.map(function(m,j){ var has=p.models.indexOf(m)>=0; return '<button class="pg-r fm-it'+(has?' has':'')+'" type="button" data-j="'+j+'"'+(has?' disabled':'')+'><i class="ck">'+I.ok+'</i><span class="rt"><b>'+esc(m)+'</b></span>'+(has?'<span class="pg-tag">已有</span>':'')+'</button>'; }).join('')+'<div class="fm-empty" hidden>没有匹配的模型</div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-fm="ok">添加</button></div>',
      function(sh,close){
        var ok=sh.querySelector('[data-fm="ok"]'), qIn=sh.querySelector('[data-fmq]'), hitEl=sh.querySelector('.fm-hit'), clrB=sh.querySelector('[data-fm="clr"]'), empEl=sh.querySelector('.fm-empty'), allB=sh.querySelector('[data-fm="all"]');
        var items=[].slice.call(sh.querySelectorAll('.fm-it')), low=got.map(function(m){ return String(m||'').toLowerCase(); });
        function visFree(){ return items.filter(function(x){ return !x.hidden&&!x.disabled; }); }
        function syncAllBtn(){ if(!allB) return; var vf=visFree(), all=!!vf.length&&vf.every(function(x){ return !!pk[got[+x.dataset.j]]; }); allB.textContent=all?'全不选':'全选'; }
        function cnt(){ var n=Object.keys(pk).length; ok.textContent=n?'添加 '+n+' 个':'添加'; syncAllBtn(); }
        function filter(){
          var raw=(qIn.value||'').trim().toLowerCase(), toks=raw?raw.split(/\s+/).filter(Boolean):[], shown=0;
          items.forEach(function(x){ var m=low[+x.dataset.j], on=!toks.length||toks.every(function(t){ return m.indexOf(t)>=0; }); x.hidden=!on; if(on) shown++; });
          if(empEl) empEl.hidden=shown>0;
          if(hitEl) hitEl.textContent=raw?(shown+'/'+got.length):'';
          if(clrB) clrB.hidden=!raw;
          syncAllBtn();
        }
        if(qIn) qIn.addEventListener('input',filter);
        sh.addEventListener('click',function(e){ var a=e.target.closest('[data-fm]'), it=e.target.closest('.fm-it');
          if(it&&!it.disabled){ var m=got[+it.dataset.j]; if(pk[m]) delete pk[m]; else pk[m]=1; it.classList.toggle('sel',!!pk[m]); buzz(5); cnt(); return; }
          if(!a) return;
          if(a.dataset.fm==='clr'){ if(qIn){ qIn.value=''; filter(); qIn.focus(); } buzz(5); return; }
          if(a.dataset.fm==='all'){ var vf=visFree(), all=!!vf.length&&vf.every(function(x){ return !!pk[got[+x.dataset.j]]; }); vf.forEach(function(x){ var m=got[+x.dataset.j]; if(all) delete pk[m]; else pk[m]=1; x.classList.toggle('sel',!!pk[m]); }); buzz(6); cnt(); return; }
          var add=Object.keys(pk); if(!add.length){ buzz([20,30,20]); toast('先勾要加的'); return; }
          add.forEach(function(m){ p.models.push(m); }); if(!p.def) p.def=p.models[0]; close(); paintM(); Array.prototype.slice.call(md.querySelectorAll('.pv-m')).slice(-add.length).forEach(function(x){ x.classList.add('flash'); }); repaint(); toast('加了 '+add.length+' 个模型'); buzz([8,30,8]);
        });
      },'<button class="fm-all tap" data-fm="all">全选</button>');
  }
  /* 编辑 / 添加模型：基本设置 / 高级设置 */
  function modelSheet(name){
    var isNew=!name;
    sheet(win,isNew?'添加新模型':'编辑模型',seg(['基本设置','高级设置'],0)+
      '<div class="pg-pane on" style="padding-top:12px"><div class="pg-g pv-form">'+fd('模型 ID','<input class="pg-in mono" id="mdId" placeholder="比如 deepseek-v4-pro" value="'+esc(name||'')+'">')+'</div><div class="pg-g" style="margin-top:12px">'+r({t:'设为这家的默认',tg:1,on:name&&name===p.def,tgname:'def'})+'</div></div>'+
      '<div class="pg-pane" style="padding-top:12px"><div class="pg-g">'+(p.nosamp?'<div class="so-lock">'+r({t:'采样覆盖'+hint('该供应商的模型不支持自定义采样参数，已固定关闭'),tg:1,on:0,tgname:'so'})+'</div>':r({t:'采样覆盖'+hint('整家供应商生效，覆盖生成参数里的温度和 Top P'),tg:1,on:p.so,tgname:'so'}))+'<div class="so-box'+((p.so&&!p.nosamp)?'':' dis')+'">'+slider('mt','温度','1',0,2,.05)+slider('mp','Top P','0.95',0,1,.01)+'</div></div>'+
      /* [位置:phone-pages.js·modelSheet 直接看图] [图片转写豁免] [10-27：有些聊天模型本来就能看图，发图时不做转写、直接发原图；在这里逐模型勾选] [注释时间 2026-10-27] */
      /* [位置:phone-pages.js·modelSheet 走代理] [订阅登录类供应商的「走代理」开关锁成开、点不动] [11-11：订阅类的请求本来就全部经本机代理出海（lib/upstream-target.js 的 isAnthropicProxy 分支优先，proxy_models 对它不参与路由），开关能点会误导「新模型要不要开」；锁定后不再写 proxy_models] [注释时间 2026-11-11] */
      '<div class="pg-g" style="margin-top:12px">'+(p.pxall?'<div class="px-lock">'+r({t:'走代理'+hint('这是订阅登录类供应商：它的模型一律经本机代理出海，这个开关对它不起作用'),tg:1,on:1,tgname:'px'})+'</div>':r({t:'走代理'+hint('只管这个模型：请求经本机代理（设置里火种 VPN 的出口）发出去，别的模型不受影响。代理不通时会直接报错，不会悄悄改成直连'),tg:1,on:!!(name&&(p.pm||[]).indexOf(name)>=0),tgname:'px'}))+r({t:'直接看图'+hint('这个模型能看原图：发图时不做图片转写，直接把原图发给它'),tg:1,on:!!(name&&(p.vm||[]).indexOf(name)>=0),tgname:'vis'})+'</div></div>'+
      '<div class="pg-bts" style="padding:16px 0 0">'+(isNew?'':'<button class="pg-btn red tap" data-md="rm">删除</button>')+'<button class="pg-btn pri tap" data-md="ok">'+(isNew?'添加':'保存')+'</button></div>',
      function(sh,close){
        sh.classList.add('pv-msheet');
        /* [位置:phone-pages.js·采样覆盖锁定] [不支持自定义采样参数的供应商（Claude 订阅等，后端 sampling_override 为 null）：采样覆盖固定关闭、点不动，旁边的 ⓘ 气泡写明原因；点开关只弹一句提示] [注释时间 2026-10-22] */
        sh.addEventListener('click',function(e){ if(e.target.closest('.so-lock [data-tg="so"]')&&!e.target.closest('.pv-i')){ e.stopPropagation(); e.preventDefault(); toast('该供应商的模型不支持自定义采样参数'); buzz([20,30,20]); } },true);
        /* [位置:phone-pages.js·走代理锁定·点击拦截] [订阅类点「走代理」只提示] [开关是锁死状态，点了别让人以为切成功了；ⓘ 说明气泡照常弹] [注释时间 2026-11-11] */
        sh.addEventListener('click',function(e){ if(e.target.closest('.px-lock [data-tg="px"]')&&!e.target.closest('.pv-i')){ e.stopPropagation(); e.preventDefault(); toast('订阅类供应商全部走代理，不用开'); buzz([20,30,20]); } },true);
        if(isNew) setTimeout(function(){ sh.querySelector('#mdId').focus(); },380);
        sh.addEventListener('click',function(e){ if(e.target.closest('[data-tg="so"] .pg-sw')) sh.querySelector('.so-box').classList.toggle('dis',!sh.querySelector('[data-tg="so"]').classList.contains('on')); });
        sh.addEventListener('click',function(e){ var b=e.target.closest('[data-md]'); if(!b) return;
          if(b.dataset.md==='ok'){ var v=sh.querySelector('#mdId').value.trim(); if(!v){ sh.querySelector('#mdId').focus(); buzz([20,30,20]); return; } if(isNew) p.models.push(v); else p.models[p.models.indexOf(name)]=v; if(sh.querySelector('[data-tg="def"]').classList.contains('on')||!p.def) p.def=v; else if(name===p.def) p.def=v; var pxo=sh.querySelector('[data-tg="px"]'); if(!p.pxall){ p.pm=(p.pm||[]).filter(function(m){ return m!==name&&m!==v; }); if(pxo&&pxo.classList.contains('on')) p.pm.push(v); } var vis=sh.querySelector('[data-tg="vis"]'); p.vm=(p.vm||[]).filter(function(m){ return m!==name&&m!==v; }); if(vis&&vis.classList.contains('on')) p.vm.push(v); close(); paintM(); var n=md.querySelector('[data-m="'+p.models.indexOf(v)+'"]'); if(n) n.classList.add('flash'); repaint(); toast(isNew?'加好了':'改好了'); buzz(8); }
          else { close(); p.models.splice(p.models.indexOf(name),1); p.pm=(p.pm||[]).filter(function(m){ return m!==name; }); p.vm=(p.vm||[]).filter(function(m){ return m!==name; }); if(p.def===name) p.def=p.models[0]||''; paintM(); repaint(); toast('删掉了'); }
        });
      });
  }
  P.cfg.pvTab=function(k){ tb.querySelector('[data-t="'+k+'"]').click(); }; P.cfg.pvModel=function(){ md.querySelector('.pv-m').click(); }; P.cfg.pvPick=function(){ md.querySelector('[data-mb="pick"]').click(); setTimeout(function(){ md.querySelector('.pv-m').click(); },300); };
}
/* 测试连接：选模型 → 测 → 连通 / 报错 */
function provTest(p){
  var c=document.createElement('div'); c.className='pg-cf pv-test'; var m=p.def;
  c.innerHTML='<div class="box"><b>测试连接</b><button class="pv-tm tap" data-t="'+(LV.pv?'':'pick')+'"><span>'+esc(m)+'</span>'+I.ch+'</button><div class="pv-res"></div><div class="bt"><button class="pg-btn tap" data-t="x">取消</button><button class="pg-btn pri tap" data-t="go">测试</button></div></div>';
  win.querySelector('.content').appendChild(c); buzz(6); requestAnimationFrame(function(){ c.classList.add('show'); });
  function close(){ c.classList.remove('show'); setTimeout(function(){ c.remove(); },220); }
  c.addEventListener('click',function(e){ var b=e.target.closest('[data-t]'); if(!b){ if(e.target===c) close(); return; } var k=b.dataset.t, res=c.querySelector('.pv-res');
    if(k==='x') close();
    else if(k==='pick'){ var box=c.querySelector('.box'), l=box.querySelector('.pv-tl'); if(l){ l.remove(); return; } l=document.createElement('div'); l.className='pv-tl'; l.innerHTML=p.models.map(function(x){ return '<button class="tap'+(x===m?' on':'')+'">'+esc(x)+'</button>'; }).join(''); b.after(l); buzz(5); l.addEventListener('click',function(ev){ var x=ev.target.closest('button'); if(!x) return; ev.stopPropagation(); m=x.textContent; b.querySelector('span').textContent=m; l.remove(); res.className='pv-res'; res.innerHTML=''; buzz(5); }); }
    else if(k==='go'&&LV.pv){ b.innerHTML='<i class="pg-spin"></i>测试中'; b.classList.add('busy'); res.className='pv-res'; res.innerHTML='';
      P.net.post(AB+'providers/test',{id:p.id}).then(function(r){ b.classList.remove('busy'); b.textContent='再测一次';
        if(r&&r.ok){ res.className='pv-res ok show'; res.innerHTML=I.ok+'<div><b>连通 · '+((r.latency_ms||0)/1000).toFixed(2)+'s</b><small>'+esc(r.note||'')+'</small></div>'; buzz([8,30,8]); }
        else { res.className='pv-res bad show'; res.innerHTML='<i>!</i><div><b>没连上</b><small>'+esc((r&&r.error)||'')+'</small></div>'; buzz([20,40,20]); } },function(e){ b.classList.remove('busy'); b.textContent='再测一次'; res.className='pv-res bad show'; res.innerHTML='<i>!</i><div><b>没测成</b><small>'+esc(String((e&&e.message)||''))+'</small></div>'; }); }
    else if(k==='go'){ toast('未连接后台'); }
  });
}
/* 添加供应商：选一家自动填好，或者自定义自己填 */
function provAdd(repaint){
  var pick=-1;
  var PCOL=['#4a4f66','#d08a6a','#5f8fe0','#5f8fe0','#4a4f66','#4b6fd0','#e0a060','#6ab0c8','#4aa0e0','#5c7fe6','#e08aa0','#5aa0b0','#4a4f66','#d08a6a','#e0a060','#8a8fd8','#9b86d0','#7aa0d8','#c39ad6','#5aa0b0'];
  function tyBtn(t,j){ return '<button class="tap" data-ty="'+j+'"><span class="pvlg" style="--c:'+PCOL[j%PCOL.length]+'">'+t[0].slice(0,1)+'</span><small>'+t[0]+'</small></button>'; }
  sheet(win,'添加供应商','<div class="pv-tyh">官方</div><div class="pv-types">'+PV_TYPES.map(function(t,j){ return t[5]==='官方'?tyBtn(t,j):''; }).join('')+'</div><div class="pv-tyh">订阅登录</div><div class="pv-types">'+PV_TYPES.map(function(t,j){ return t[5]==='登录'?tyBtn(t,j):''; }).join('')+'</div><div class="pv-tyh">中转站</div><div class="pv-types">'+PV_TYPES.map(function(t,j){ return t[5]==='中转'?tyBtn(t,j):''; }).join('')+'<button class="tap cu" data-ty="-1"><span class="pvlg">'+I.plus+'</span><small>自定义</small></button></div>'+
    '<div class="pv-addf"><div class="pg-g pv-form">'+fd('名称','<input class="pg-in" id="adN" placeholder="起个名字">')+fd('API Key','<input class="pg-in mono" id="adK" placeholder="sk-...">')+fd('API Base URL','<input class="pg-in mono" id="adB" placeholder="https://">')+fd('API 路径','<input class="pg-in mono" id="adP" value="/chat/completions">')+fd('消息格式',seg(['OpenAI 兼容','Anthropic'],0).replace('pg-seg','pg-seg pv-seg'))+'</div>'+'<div class="pg-g" id="adOa" style="display:none;margin-top:10px"><button class="pg-btn tap" data-oa="go" style="width:100%">登录账号</button><input class="pg-in mono" id="adU" placeholder="授权后，把地址栏整条粘贴到这里" style="margin-top:8px"><div class="pg-tip" id="adS" style="margin-top:6px"></div></div>'+'<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn tap" data-ad="test">测试</button><button class="pg-btn pri tap" data-ad="ok">添加</button></div></div>',
    function(sh,close){
      var f=sh.querySelector('.pv-addf');
      function setSeg(k){ var sg=sh.querySelector('.pv-seg'); sg.style.setProperty('--k',k); Array.prototype.forEach.call(sg.querySelectorAll('button'),function(x,i){ x.classList.toggle('on',i===k); }); }
      [].forEach.call(sh.querySelectorAll('.pv-types'),function(tg){ tg.addEventListener('click',function(e){ var b=e.target.closest('[data-ty]'); if(!b) return; pick=+b.dataset.ty; [].forEach.call(sh.querySelectorAll('.pv-types [data-ty]'),function(x){ x.classList.toggle('on',x===b); }); buzz(8); f.classList.add('show');
        var t=PV_TYPES[pick], ins=f.querySelectorAll('input');
        if(t){ ins[0].value=t[0]; ins[2].value=t[1]; ins[3].value=t[2]; setSeg(t[3]==='claude'?1:0); [0,2,3].forEach(function(j){ ins[j].classList.remove('flash'); void ins[j].offsetWidth; ins[j].classList.add('flash'); }); setTimeout(function(){ ins[1].focus(); },300); }
        else { ins[0].value=''; ins[2].value=''; ins[3].value='/chat/completions'; setSeg(0); setTimeout(function(){ ins[0].focus(); },300); }
        var oa=sh.querySelector('#adOa'), op=t&&t[6]?t[6]:'';
        if(oa) oa.style.display=op?'block':'none';
        var keyWrap=ins[1]&&ins[1].parentElement; if(keyWrap) keyWrap.style.display=op?'none':'';
        if(op){ var st=sh.querySelector('#adS'); if(st) st.textContent=''; }
      }); });
      f.addEventListener('click',function(e){ var oa=e.target.closest('[data-oa]'); if(oa){ var t=pick>=0?PV_TYPES[pick]:null, op=t&&t[6]; var st=f.querySelector('#adS'); if(!op) return; /* 2026-10-22：Claude 也走统一的登录流程了（后端 /admin/oauth/claude/* 已支持），不再有「令牌已在服务端配好」的特例 */
          if(st) st.textContent='正在打开授权页…';
          P.net.get(AB+'oauth/'+op+'/start').then(function(j){ if(!j||!j.ok){ if(st) st.textContent=(j&&j.error)||'启动失败'; return; } try{ window.open(j.auth_url,'_blank'); }catch(err){} if(st) st.textContent='授权后，把地址栏整条粘到下面'; },function(){ if(st) st.textContent='启动失败'; }); return; }
        var b=e.target.closest('[data-ad]'); if(!b) return; var ins=f.querySelectorAll('input');
        if(b.dataset.ad==='test'){ if(!ins[1].value.trim()){ ins[1].focus(); toast('先填 Key'); buzz([20,30,20]); return; }
          if(LV.pv){ b.classList.add('busy'); b.textContent='测试中…'; P.net.post(AB+'providers/test',{api_url:ins[2].value.trim().replace(/\/+$/,'')+ins[3].value.trim(),api_key:ins[1].value.trim(),profile:segK(sh.querySelector('.pv-seg'))?'claude':'default'}).then(function(r){ b.classList.remove('busy'); b.textContent=r&&r.ok?'连通 ✓':'没连上'; toast(r&&r.ok?'连通了 · '+((r.latency_ms||0)/1000).toFixed(2)+'s':'没连上：'+String((r&&r.error)||'').slice(0,40)); buzz(r&&r.ok?[8,30,8]:[20,40,20]); },function(){ b.classList.remove('busy'); b.textContent='测试'; toast('没测成'); }); return; }
          noLive(b); return; }
        if(!ins[0].value.trim()||!ins[2].value.trim()){ (ins[0].value.trim()?ins[2]:ins[0]).focus(); buzz([20,30,20]); return; }
        if(!LV.pv){ noLive(b); return; }
        var op0=(pick>=0&&PV_TYPES[pick][6])?PV_TYPES[pick][6]:'';
                if(op0){
          var uIn=f.querySelector('#adU'), st0=f.querySelector('#adS');
          if(uIn && uIn.value.trim()){
            try{ b.classList.add('busy'); }catch(e2){}
            P.net.post(AB+'oauth/'+op0+'/exchange',{url:uIn.value.trim()}).then(function(j){
              try{ b.classList.remove('busy'); }catch(e3){}
              if(!j||!j.ok){ if(st0) st0.textContent=(j&&j.error)||'换 token 失败'; buzz([20,30,20]); return; }
              if(st0) st0.textContent='已连接'+(j.status&&j.status.email?' · '+j.status.email:'');
              uIn.value='';
            },function(){ try{ b.classList.remove('busy'); }catch(e3){} if(st0) st0.textContent='换 token 失败'; });
          }
        }
        var bu=pick>=0?PV_TYPES[pick][4]:'';
        PVD.push({oauth:op0||'',n:ins[0].value.trim(),on:true,c:pick>=0?'#7aa0d8':'#9aa3b8',base:ins[2].value.trim(),path:ins[3].value.trim(),prof:segK(sh.querySelector('.pv-seg'))?'claude':'default',bal:bu?'有':'',balUrl:bu,key:'',newKey:ins[1].value.trim(),keySet:false,models:[],def:'',isDef:!PVD.some(function(x){ return x.isDef; })}); close(); setTimeout(function(){ repaint(PVD.length-1); toast('加好了，去「模型」里获取一下'); buzz([8,30,8]); },300);
      });
    });
}
  /* 人设提示词：一个列表（data/prompt-backups.json）。默认 = chat-settings.system_prompt 正在用的那份（现在是「优化版」，一字不差），亮一点、排最上面。
     点一行 = 编辑；长按 = 菜单（设为默认 / 删除）。设为默认 = 把这份正文写进 chat-settings.system_prompt。 */
  function personas(){
    grpResetOpen('ps');   /* 每次进页分组全部收起（11-16 批3 H3） */
    function row(p){ var i=PERS.indexOf(p), d=p[0]===DEFP; return '<button class="pg-r go ps-row'+(d?' def':'')+'" type="button" data-p="'+i+'"><span class="rt"><b>'+esc(p[1])+(d?'<em class="ps-dt">默认</em>':'')+'</b><small>'+p[2].toLocaleString()+' 字 · '+p[3]+(p[4]?' · '+p[4]+' 个会话在用':'')+'</small></span><span class="ps-rdots" data-pmore="'+i+'" role="button" aria-label="人设操作"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></span></button>'; }   /* [位置:phone-pages.js·personas·row] [行尾常驻操作点] [11-20：编辑/设为默认/移动分组/删除不再只靠长按，行尾 ⋯ 直接开；箭头去掉，⋯ 就是行的主要操作] [注释时间 2026-11-20] */
    var psQ='';   /* 搜索词（小写），空 = 全部 */
    function psHead(key,label,n,open,dots){ return '<div class="pg-grp'+(open?' open':'')+'" data-grpk="ps" data-grp="'+esc(key)+'"><i class="ps-chv'+(open?' open':'')+'"></i><b>'+esc(label)+'</b><span class="ps-gcnt">'+n+'</span>'+(dots?'<span class="ps-gdots" data-gdots="'+esc(key)+'" role="button" aria-label="分组操作"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></span>':'')+'</div>'; }   /* [位置:phone-pages.js·personas·psHead] [卡片式分组头：箭头 + 组名 + 数量胶囊 + ⋯] [11-23 重构：默认人设独立成卡，每个分组独立成卡，展开后组头带浅底、子项右缩进，层级一眼分清] [注释时间 2026-11-23] */
    /* [位置:phone-pages.js·personas·grpBody/grpItems] [分组子项] [11-24：一个分组展开后的子项包进 .ps-gbody（带 data-gbody=组名），首屏和组头点按共用一份；搜索词照样过滤] [注释时间 2026-11-24] */
    function grpItems(g){ return PERS.filter(function(p){ return p[5]===g&&p[0]!==DEFP&&(!psQ||String(p[1]).toLowerCase().indexOf(psQ)>=0); }); }
    function grpBody(g,items){ return '<div class="ps-gbody" data-gbody="'+esc(g)+'">'+items.map(function(x){ return row(x); }).join('')+'</div>'; }
    /* [位置:phone-pages.js·personas·grpToggle] [点组头原地展开/收起] [11-24 报「人设页展开/收起分组整页闪」：原来点组头走 repaint 整块重写 #psLs，所有卡片重播 .pg-rise 入场动画。现在只动这一张卡：组头切 .open（箭头跟着转），卡片高度做过渡，展开=插入这组的子项并按顺序淡入，收起=子项先淡出再摘掉；其它卡片一个节点都不换] [注释时间 2026-11-24] */
    function grpToggle(gh){
      var g=gh.getAttribute('data-grp'), card=gh.closest('.ps-grp-card'), open=!gh.classList.contains('open'), body=null;
      grpSetOpen('ps',g,open); gh.classList.toggle('open',open); var cv=gh.querySelector('.ps-chv'); if(cv) cv.classList.toggle('open',open);
      if(!card) return;
      Array.prototype.forEach.call(card.children,function(el){ if(el.classList.contains('ps-gbody')&&el.getAttribute('data-gbody')===g) body=el; });
      /* 连点保护：上一次收起还挂着「先淡出再摘」的计时器，这次要展开就把它撤掉，子项留着直接用（否则会出现「组头是展开态、子项已被摘掉」） */
      clearTimeout(card._gt); card._gt=0; if(body) body.style.opacity='';
      /* 高度过渡：先量旧高，换内容，再从旧高过渡到新高；卡片本是自适应高度，过渡完把行内高度清掉。新高按自然高度量（上一次过渡没走完时行内还挂着高度，得先临时摘掉） */
      function swap(fn){ var h0=card.offsetHeight, keep=card.style.height; fn(); card.style.height=''; var h1=card.offsetHeight; if(h0===h1){ card.style.height=keep; return; }
        card.style.height=h0+'px'; card.style.overflow='clip'; card.getBoundingClientRect(); card.style.transition='height .32s cubic-bezier(.2,.8,.2,1)'; card.style.height=h1+'px';
        clearTimeout(card._ht); card._ht=setTimeout(function(){ card.style.height=''; card.style.overflow=''; card.style.transition=''; },360); }
      if(open){ if(body) return; var items=grpItems(g); buzz(6);
        swap(function(){ gh.insertAdjacentHTML('afterend',grpBody(g,items)); card.classList.add('tgl'); });
        clearTimeout(card._tt); card._tt=setTimeout(function(){ card.classList.remove('tgl'); },520); return; }
      if(!body) return; buzz(6);
      body.style.transition='opacity .18s'; body.style.opacity='0';
      card._gt=setTimeout(function(){ card._gt=0; if(body.isConnected) swap(function(){ body.remove(); }); },170); }
    function list(){ if(!PERS.length){ if(!CDONE.ps) return ''; return '<div class="pg-empty">'+(CERR.ps?'没读到数据，网络好了再进来看看':'还没有人设')+'</div>'; }
      var vis=PERS.map(function(p,i){ return {p:p,i:i}; }).filter(function(x){ return !psQ||String(x.p[1]).toLowerCase().indexOf(psQ)>=0; });
      if(!vis.length) return '<div class="pg-empty">没有叫这个的人设</div>';
      var unfold=!!psQ;
      var out='', def=vis.filter(function(x){ return x.p[0]===DEFP; })[0];
      if(def) out+='<div class="pg-g pg-rise ps-list ps-def-card">'+row(def.p)+'</div>';
      var gs={}, go=[];
      vis.forEach(function(x){ var g=x.p[5]; if(!g||x.p[0]===DEFP) return; if(!gs[g]){ gs[g]=[]; go.push(g); } gs[g].push(x); });
      go.forEach(function(g){
        var o=unfold||grpOpen('ps',g), inner=psHead(g,g,gs[g].length,o,true);
        if(o) inner+=grpBody(g,gs[g].map(function(x){ return x.p; }));
        out+='<div class="pg-g pg-rise ps-list ps-grp-card">'+inner+'</div>';
      });
      var un=vis.filter(function(x){ return !x.p[5]&&x.p[0]!==DEFP; });
      if(un.length){
        var uo=unfold||grpOpen('ps','__un__'), uInner='';
        if(go.length){
          uInner=psHead('__un__','未分组',un.length,uo,false);
          if(uo) uInner+=grpBody('__un__',un.map(function(x){ return x.p; }));
          out+='<div class="pg-g pg-rise ps-list ps-grp-card">'+uInner+'</div>';
        } else {
          un.forEach(function(x){ uInner+=row(x.p); });
          out+='<div class="pg-g pg-rise ps-list">'+uInner+'</div>';
        }
      }
      return out; }
    var s=sub(win,'人设提示词','<div class="pg-search">'+I.find+'<input class="pg-in" id="psQ" placeholder="搜人设"></div><div id="psLs"></div>',{right:'<button class="pg-cb tap" data-act="add" aria-label="新建人设">'+I.plus+'</button>',act:function(k){ if(k==='add') edit(-1); }});   /* [位置:phone-pages.js·personas 建页] [顶部加搜索框，列表独立容器] [11-20：搜索只重画 #psLs，不打断输入；原来整页 innerHTML 连滚动位一起清] [注释时间 2026-11-20] */
    var sc=s.querySelector('.pg-sc'), LD=subLoad(s,sc);
    /* [位置:phone-pages.js·personas·repaint] [人设列表重画] [11-24：soft=true 表示这是一次原地重画（搜索、删除、设默认），新画的卡片摘掉 .pg-rise，不然每敲一个字整页都重播一遍入场动画] [注释时间 2026-11-20；2026-11-24 加 soft] */
    function repaint(flash,soft){ if(!PERS.length&&!CDONE.ps){ LD.on(); return; } LD.off(); var box=sc.querySelector('#psLs'); if(box){ box.innerHTML=list(); if(soft) Array.prototype.forEach.call(box.querySelectorAll('.pg-rise'),function(el){ el.classList.remove('pg-rise'); }); } var c=document.querySelector('[data-go="prompts"] .rv'); if(c) c.textContent=PERS.length+' 个'; if(flash!=null){ var n=sc.querySelector('[data-p="'+flash+'"]'); if(n) n.classList.add('flash'); } }
    /* 头一次进来数据还在路上：list() 画的是转圈，数据到了让 cfgFire 把这一页重画一遍（repaint 只碰自己这一层，退出去后 sc 已脱离文档也不报错） */
    if(!PERS.length&&!CDONE.ps) LD.on();
    cfgWait('ps',repaint);
    /* [位置:phone-pages.js·personas 已在内存] [别再让加载动画空转] [11-20：第二次以后进这人设页，列表明明在、动画却一直转——cfgWait 在已完成的键上直接 return（回调根本不会跑），所以这里补一次落页面，LD.off 才会执行] [注释时间 2026-11-20] */
    if(CDONE.ps) repaint();
    var qInp=sc.querySelector('#psQ');
    if(qInp) qInp.addEventListener('input',function(){ psQ=this.value.trim().toLowerCase(); repaint(null,true); });
    var lpT=0, fired=false, sx=0, sy=0;
    /* [位置:phone-pages.js·personas·组头手势] [组头长按 480ms 弹改名/解散菜单，点按收起/展开] [11-14：与行长按同一套手势（pointerdown 计时、移动取消、click 看 fired 防长按后误触）] [注释时间 2026-11-14] */
    sc.addEventListener('pointerdown',function(e){ var b=e.target.closest('.ps-row,[data-grpk="ps"]'); if(!b) return; fired=false; sx=e.clientX; sy=e.clientY; clearTimeout(lpT); lpT=setTimeout(function(){ fired=true; if(!b.classList.contains('pg-grp')){ menu(b); return; } var gk=b.getAttribute('data-grp'); if(gk!=='__un__') psGrpMenu(gk); },480); });   /* 未分组头长按不弹菜单：没有改名/解散语义 */
    sc.addEventListener('pointermove',function(e){ if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>10) clearTimeout(lpT); });
    ['pointerup','pointercancel'].forEach(function(t){ sc.addEventListener(t,function(){ clearTimeout(lpT); }); });
    sc.addEventListener('scroll',function(){ clearTimeout(lpT); });
    sc.addEventListener('contextmenu',function(e){ if(e.target.closest('.ps-row')) e.preventDefault(); });
    sc.addEventListener('click',function(e){
      var rd=e.target.closest('[data-pmore]');   /* 行尾 ⋯：开人设操作（编辑/设为默认/移动分组/删除） */
      if(rd){ if(fired){ fired=false; return; } buzz(6); var rb=sc.querySelector('[data-p="'+rd.getAttribute('data-pmore')+'"]'); if(rb) menu(rb); return; }
      var gd=e.target.closest('[data-gdots]');   /* 组头 ⋯：开分组操作（改名/解散） */
      if(gd){ if(fired){ fired=false; return; } buzz(6); psGrpMenu(gd.getAttribute('data-gdots')); return; }
      var gh=e.target.closest('[data-grpk="ps"]');
      if(gh){ if(fired){ fired=false; return; } grpToggle(gh); return; }
      var b=e.target.closest('.ps-row'); if(!b) return; if(fired){ fired=false; return; } buzz(6); edit(+b.dataset.p); });
    function menu(b){ var i=+b.dataset.p, p=PERS[i], d=p[0]===DEFP; buzz([10,30,10]);
      var host=win.querySelector('.content'), hr=host.getBoundingClientRect(), rc=b.getBoundingClientRect();
      var scr=document.createElement('div'); scr.className='ps-scrim'; host.appendChild(scr);
      var m=document.createElement('div'); m.className='ps-menu'; m.innerHTML='<button type="button" data-m="edit"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>编辑</span></button><button type="button" data-m="def"'+(d?' disabled':'')+'>'+I.star+'<span>'+(d?'已是默认':'设为默认')+'</span></button><button type="button" data-m="mv"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span>移动分组</span></button><button type="button" class="red" data-m="del">'+PX.trash+'<span>删除</span></button>'; host.appendChild(m);   /* [位置:phone-pages.js·personas·menu] [⋯菜单四项] [11-20：加「编辑」「移动分组」，长按与行尾 ⋯ 走同一个菜单] [注释时间 2026-11-20] */
      var top=rc.bottom-hr.top+6; if(top+m.offsetHeight>hr.height-24) top=rc.top-hr.top-m.offsetHeight-6;
      m.style.top=top+'px'; m.style.right=Math.max(16,hr.right-rc.right+14)+'px'; m.style.transformOrigin='right '+(top>rc.top-hr.top?'top':'bottom');
      b.classList.add('lp'); requestAnimationFrame(function(){ m.classList.add('show'); });
      function close(){ m.classList.remove('show'); b.classList.remove('lp'); scr.remove(); setTimeout(function(){ m.remove(); },220); }
      scr.addEventListener('click',close);
      m.addEventListener('click',function(e){ var x=e.target.closest('[data-m]'); if(!x||x.disabled) return; close();
        if(x.dataset.m==='edit'){ edit(i); return; }
        if(x.dataset.m==='mv'){ moveSheet(i); return; }
        if(x.dataset.m==='def'&&LV.ps){ P.net.req(AB+'chat-settings',{method:'PUT',body:{system_prompt:PCONT[p[0]]||''}}).then(function(){ if(LV.cs) LV.cs.system_prompt=PCONT[p[0]]; DEFP=p[0]; buzz(8); sc.scrollTo({top:0,behavior:'smooth'}); setTimeout(function(){ repaint(i,true); toast('默认人设换成「'+p[1]+'」'); },160); },function(){ toast('没换成'); buzz([20,30,20]); }); return; }
        if(x.dataset.m==='def'){ noLive(x); return; }
        if(d){ buzz([20,30,20]); toast('它是默认的，先把别的设为默认再删'); return; }
        confirmBox(win,'删除「'+esc(p[1])+'」？',p[4]?p[4]+' 个会话会改用默认人设。':'删了就没了。','删除',true,function(){ function gone(){ var n=sc.querySelector('[data-p="'+i+'"]'); if(n) n.classList.add('gone'); setTimeout(function(){ PERS.splice(i,1); repaint(null,true); },300); toast('删掉了'); }
          if(!LV.ps){ noLive(null); return; } P.net.req('/v1/prompt-backups',{method:'PUT',body:{upserts:[],delIds:[p[0]]}}).then(function(){ gone(); if(P.sessOpts&&P.sessOpts.refresh) P.sessOpts.refresh()['catch'](function(){}); },function(){ toast('没删掉'); buzz([20,30,20]); }); });   /* 11-15 删完就地刷清单缓存，选择器不再端旧名单 */
      });
    }
    /* [位置:phone-pages.js·personas·moveSheet] [移动分组] [11-20：⋯菜单「移动分组」——列现有分组、可就地新建（grpNewSheet）、可移出；分组本身不单独存、跟着人设的 grp 字段走，所以「新建分组」总是伴随把这个人设挪进去] [注释时间 2026-11-20] */
    function moveSheet(i){
      var p=PERS[i], gs=[]; PERS.forEach(function(x){ var g=x[5]; if(g&&x[0]!==DEFP&&gs.indexOf(g)<0) gs.push(g); });
      var opts=gs.map(function(g){ return '<button class="pg-btn tap" type="button" data-g="'+esc(g)+'">'+esc(g)+'</button>'; }).join('');
      sheet(win,'移动「'+esc(p[1])+'」','<div class="pg-bts">'+opts+(gs.length?'':'<div class="pg-empty">还没有分组</div>')+'<button class="pg-btn pri tap" type="button" data-gnew>新建分组…</button>'+(p[5]?'<button class="pg-btn tap" type="button" data-gout>移出分组</button>':'')+'</div>',function(sh,close){
        sh.addEventListener('click',function(ev){
          var nb=ev.target.closest('[data-g]'); if(nb){ close(); psSetGrp([p],nb.getAttribute('data-g'),function(){ toast('挪到「'+nb.getAttribute('data-g')+'」了'); }); return; }
          if(ev.target.closest('[data-gnew]')){ close(); grpNewSheet(win,function(g){ if(g) psSetGrp([p],g,function(){ toast('已放进「'+g+'」'); }); }); return; }
          if(ev.target.closest('[data-gout]')){ close(); psSetGrp([p],'',function(){ toast('已移出分组'); }); }
        });
      });
    }
    /* [位置:phone-pages.js·personas·psSetGrp] [整组人设换分组] [11-14：改名/解散共用——upsert 带新 grp（正文用 PCONT 内存值原样送回），成功后改内存 PERS 再重画；11-15 补透传 elapsed_tag_to_ai（p[6]），否则整组挪一次开关就被 norm 抹掉] [注释时间 2026-11-14；2026-11-15 补字段透传] */
    function psSetGrp(members,g,done){
      if(!LV.ps){ toast('没连上后台，没存'); buzz([20,30,20]); return; }
      var up=members.map(function(p){ var o={id:p[0],name:p[1],content:PCONT[p[0]]||'',grp:g,updatedAt:new Date().toISOString()}; if(p[6]==='off') o.elapsed_tag_to_ai=false; else if(p[6]==='on') o.elapsed_tag_to_ai=true; return o; });
      P.net.req('/v1/prompt-backups',{method:'PUT',body:{upserts:up,delIds:[]}}).then(function(){
        members.forEach(function(p){ p[5]=g; }); repaint(); if(done) done(); if(P.sessOpts&&P.sessOpts.refresh) P.sessOpts.refresh()['catch'](function(){});   /* 11-15 整组挪完就地刷清单缓存 */
      },function(){ toast('没存上'); buzz([20,30,20]); }); }
    function psGrpMenu(g){
      var members=PERS.filter(function(p){ return p[5]===g; }); if(!members.length){ repaint(); return; }
      buzz([10,30,10]);
      sheet(win,'分组「'+esc(g)+'」','<div class="pg-bts" style="padding:4px 0 0"><button class="pg-btn tap" type="button" data-ga="ren">重命名分组</button><button class="pg-btn tap" type="button" data-ga="dis">解散分组</button></div>',function(s,close){
        s.addEventListener('click',function(ev){
          if(ev.target.closest('[data-ga="ren"]')){ close(); psGrpRename(g); return; }
          if(ev.target.closest('[data-ga="dis"]')){ close(); confirmBox(win,'解散「'+esc(g)+'」？','组里 '+members.length+' 个人设变成不分组，人设本身不动。','解散',true,function(){ psSetGrp(members,'',function(){ toast('已解散'); }); }); } }); }); }
    function psGrpRename(g){
      sheet(win,'重命名分组','<div class="pv-fd"><label>组名</label><input class="pg-in" id="psGN" maxlength="20" value="'+esc(g)+'"></div><div class="pg-bts"><button class="pg-btn pri tap" type="button" data-ga="ok">改好</button></div>',function(s,close){
        s.addEventListener('click',function(ev){ if(!ev.target.closest('[data-ga="ok"]')) return;
          var v=(s.querySelector('#psGN').value||'').trim(); if(!v){ try{ s.querySelector('#psGN').focus(); }catch(e2){} toast('先起个名'); return; }
          if(v===g){ close(); return; }
          var members=PERS.filter(function(p){ return p[5]===g; });
          psSetGrp(members,v,function(){ grpRenameKey('ps',g,v); close(); toast('改好了'); }); }); }); }
    function edit(i){ var isNew=i<0, p=isNew?['','',0,'',0,'','']:PERS[i];
      var psEd=sub(win,isNew?'新建人设':esc(p[1]),'<div class="pg-g pv-form ps-form">'+fd('显示名称','<input class="pg-in" id="psN" placeholder="给这份人设起个名字" value="'+esc(p[1])+'">')+fd('分组','<select class="pg-in" id="psG">'+grpOptsHtml(p[5]||'',PERS.map(function(q){ return q[5]; }))+'</select>')+fd('提示词','<textarea class="pg-in ps-ta" id="psT" placeholder="他是谁、怎么说话…">'+(isNew?'':LV.ps?esc(PCONT[p[0]]||''):esc('（「'+p[1]+'」的人设全文，'+p[2]+' 字。预览里不放真实正文。）'))+'</textarea>')+'</div>'+
        '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-act="sv">'+(isNew?'创建':'保存')+'</button></div>',
        {act:function(k,t){ var me=win.querySelector('.pg-sub:last-child'), nm=me.querySelector('#psN'), ta=me.querySelector('#psT'); if(!nm.value.trim()){ nm.focus(); buzz([20,30,20]); return; }
          var td=new Date(), md=P.net.two(td.getMonth()+1)+'-'+P.net.two(td.getDate());
          if(LV.ps){ var id=isNew?'pb_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6):p[0], tx=ta.value, nmv=nm.value.trim().slice(0,60), gv=(me.querySelector('#psG').value||'').trim().slice(0,20), ev=p[6]||''; if(!bgo(t)) return;
            /* 11-15：elapsed_tag_to_ai 随人设一起存。2026-11-16 批3 H2：编辑页「距上一轮回复时间」下拉删了（加错位置，开关挪去预设编辑）；这里原样透传 p[6]（内存值来自清单接口），否则保存一次人设就把已存的开关抹回跟随默认 */
            var up={id:id,name:nmv,content:tx,grp:gv,updatedAt:td.toISOString()}; if(ev==='off') up.elapsed_tag_to_ai=false; else if(ev==='on') up.elapsed_tag_to_ai=true;
            var jobs=[P.net.req('/v1/prompt-backups',{method:'PUT',body:{upserts:[up],delIds:[]}})];   /* 11-14：grp 分组名随人设一起存（routes/chat.js norm 落盘） */
            if(!isNew&&id===DEFP) jobs.push(P.net.req(AB+'chat-settings',{method:'PUT',body:{system_prompt:tx}}));
            Promise.all(jobs).then(function(){ bend(t,true); PCONT[id]=tx; if(P.sessOpts&&P.sessOpts.refresh) P.sessOpts.refresh()['catch'](function(){});   /* 11-15 存完就地刷清单缓存，新/改人设选择器立刻可见 */ if(isNew){ PERS.push([id,nmv,tx.length,md,0,gv,ev]); i=PERS.length-1; isNew=false; } else { p[1]=nmv; p[2]=tx.length; p[3]=md; p[5]=gv; p[6]=ev; } later(function(){ repaint(i); toast(id===DEFP?'存好了 · 默认人设也跟着更新':'存好了'); buzz([8,30,8]); }); },function(){ bend(t,false); toast('没存上'); buzz([20,30,20]); }); return; }
          noLive(t); }});
      /* [位置:phone-pages.js·personas·edit 分组下拉] [人设分组改原生下拉] [11-15：手输+datalist 改 grpOptsHtml/grpSelBind，选「新建分组…」弹 grpNewSheet 就地建组；保存读值 psG 不变（空=不分组）] [注释时间 2026-11-15] */
      grpSelBind(psEd.querySelector('#psG'),function(done){ grpNewSheet(win,done); });
    }
  }
  /* 语音模型：照 /admin/voice-config（providers[{type,name,api_base,tts_model,voices[{label,value}],active_voice,speed}] + active_provider；识别 = 豆包 seed-asr）。
     一行里只认按钮：设置 / 试听 / 删除 / 选用。 */
  var VI={cfg:svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),play:svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),del:svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),ok:svg('<path d="m5 12 4.5 4.5L19 7"/>'),mic:svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')};
  function vcRow(v,i){ var vo=v.voices[v.av]; return '<div class="vc-r" data-i="'+i+'"><span class="vlg">'+esc(v.n.slice(0,1).toUpperCase())+'</span><span class="rt"><b>'+esc(v.n)+'</b><small>'+esc(v.ty==='doubao'?v.rid:v.model)+(vo?' · '+esc(vo[0]):'')+'</small></span><button class="tap" data-v="cfg" aria-label="设置">'+VI.cfg+'</button><button class="tap" data-v="play" aria-label="试听">'+VI.play+'</button><button class="tap" data-v="del" aria-label="删除">'+VI.del+'</button><button class="tap ck'+(v.id===VACT?' on':'')+'" data-v="use" aria-label="用这个">'+VI.ok+'</button></div>'; }
  function asRow(a,i){ return '<div class="vc-r" data-a="'+i+'"><span class="vlg mic">'+VI.mic+'</span><span class="rt"><b>'+esc(a.n)+'</b><small>'+esc((a.ty==='annotated'?'转写+声音描写':'只转文字')+' · '+arModelDisp())+'</small></span><button class="tap" data-v="acfg" aria-label="设置">'+VI.cfg+'</button></div>'; }
  function voicePage(){
    var s=sub(win,'语音模型','<div class="vc-gt"><span>文字转语音</span><button class="tap" data-va="t" aria-label="添加">'+I.plus+'</button></div><div class="pg-g pg-rise" id="vcT"></div>'+
      '<div class="vc-gt"><span>语音识别</span></div><div class="pg-g pg-rise" style="--i:1" id="vcA"></div>');
    var T=s.querySelector('#vcT'), A=s.querySelector('#vcA'), LD=subLoad(s,T);
    function paint(){
      if(!VPS.length&&!CDONE.vc){ LD.on(); }   /* 第一次进来 voice-config 还在路上：T 区转圈；识别区两条是固定的，不等它 */
      else { LD.off(); T.innerHTML=VPS.map(vcRow).join('')||'<div class="pg-empty">'+(CERR.vc?'没读到数据，网络好了再进来看看':'还没有')+'</div>'; }
      A.innerHTML=ASRS.map(asRow).join(''); var v=document.querySelector('[data-go="voice"] .rv'), a=VPS.filter(function(x){ return x.id===VACT; })[0]; if(v) v.textContent=a?a.n:'没选'; }
    cfgWait('vc',function(){ paint(); });
    cfgWait('rl',function(){ if(CDONE.vc&&s.isConnected) paint(); });   /* 模型清单晚到：识别区副标题里的模型名重画一次 */
    paint();
    s.addEventListener('click',function(e){ var a=e.target.closest('[data-va]'); if(a){ buzz(6); voiceEdit(-1,paint); return; }
      var b=e.target.closest('[data-v]'); if(!b) return; var k=b.dataset.v, row=b.closest('.vc-r'); if(!row) return;
      if(row.dataset.a!=null){ var j=+row.dataset.a;
        if(k==='acfg'){ buzz(6); asrEdit(j,paint); }
        return; }
      var i=+row.dataset.i, v=VPS[i];
      if(k==='cfg'){ buzz(6); voiceEdit(i,paint); }
      else if(k==='play'){ if(!LV.vc){ noLive(b); return; } if(b.classList.contains('busy')) return; b.classList.add('busy'); buzz(6);
        say(VTEST,v.id,(v.voices[v.av]||[])[1]).then(function(){ b.classList.remove('busy'); }); }
      else if(k==='use'){ if(!LV.vc){ noLive(b); return; } VACT=v.id; paint(); buzz(8); vcSave(); toast('朗读改用 '+v.n); }
      else confirmBox(win,'删掉「'+esc(v.n)+'」？','它下面的音色也一起删掉。','删除',true,function(){ if(!LV.vc){ noLive(null); return; } row.classList.add('gone'); setTimeout(function(){ VPS.splice(i,1); if(VACT===v.id) VACT=VPS[0]?VPS[0].id:''; paint(); vcSave(); },300); toast('删掉了'); });
    });
  }
  function segK(el){ return +getComputedStyle(el).getPropertyValue('--k')||0; }
  /* 文字转语音：字段照 /admin/voice-config 四种类型——
     豆包 doubao：Key / 基址 / Resource-Id；MiniMax：Key / 基址 / 模型 / 情感 / 音量 / 音调；OpenAI 兼容：Key / 完整 /audio/speech 地址 / 模型；
     Gemini：Key / 基址 / 模型 / 语气指令（可选，非空前缀给模型让它照着念；音色=官方 30 个预置，选型时整表预填；接口不支持调语速/采样率/格式，滑杆对它无效，与 openai 分支同现状）。
     点一个音色 = 选它 + 马上用下面那句试听文字念一遍（POST /admin/tts，带 provider_id + speaker）。 */
  function voiceEdit(i,repaint){
    var isNew=i<0, v=isNew?{id:'vp_'+Date.now().toString(36),ty:'openai',n:'OpenAI',base:VTY[0][3],model:VTY[0][4],rid:'seed-tts-2.0',emo:'calm',vol:1,pitch:0,sr:24000,fmt:'mp3',sp:1,av:0,st:'',voices:[['alloy','alloy']]}:VPS[i];
    var ty=v.ty, av=v.av, vs=v.voices.map(function(x){ return x.slice(); }), emo=v.emo;
    var ED=svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>');
    function vrow(x,j){ return '<div class="vc-vo'+(j===av?' on':'')+'" data-j="'+j+'"><i class="ck">'+VI.ok+'</i><span class="vt2"><b>'+esc(x[0]||x[1])+'</b><small>'+esc(x[1])+'</small></span><i class="eq"><u></u><u></u><u></u></i><button class="tap" type="button" data-ve aria-label="改">'+ED+'</button><button class="tap" type="button" data-vd aria-label="删除">'+VI.del+'</button></div>'; }
    function vt(types,html){ return '<div class="vt '+types.split(' ').map(function(t){ return 'vt-'+t; }).join(' ')+'">'+html+'</div>'; }
    var me=sub(win,isNew?'添加语音服务':esc(v.n),
      (isNew?'<div class="vc-gt"><span>服务商</span></div><div class="pg-g vc-tys">'+VTY.map(function(t,j){ return '<button class="tap'+(j?'':' on')+(t[2]?'':' na')+'" type="button" data-ty="'+j+'">'+t[0]+'</button>'; }).join('')+'</div>':'')+
      '<div class="vc-gt"><span>语音服务</span></div><div class="pg-g pv-form">'+fd('名称','<input class="pg-in" id="vcN" placeholder="起个名字" value="'+esc(v.n)+'">')+fd('API Key','<div class="pv-key"><input class="pg-in mono" id="vcK" type="password" placeholder="'+(isNew?'sk-… / 火山的 Key':'已设置 · 留空不改')+'"><button class="tap" data-act="eye" aria-label="显示">'+PX.eye+'</button></div>')+
        fd('API 基址','<input class="pg-in mono" id="vcB" placeholder="https://" value="'+esc(v.base)+'">')+
        fd('开发者平台'+hint('跳到这家服务商的开放平台：充值、拿 Key、查余额；跟着上面的接口地址自动匹配'),'<a class="pg-in vc-url tap" id="vcU" target="_blank" rel="noopener">开发者平台 ↗</a>')+
        vt('doubao',fd('Resource-Id','<input class="pg-in mono" id="vcR" placeholder="seed-tts-2.0" value="'+esc(v.rid)+'">'))+
        vt('minimax openai gemini',fd('模型','<input class="pg-in mono" id="vcM" placeholder="speech-2.8-turbo" value="'+esc(v.model)+'">'))+
        vt('gemini',fd('语气指令'+hint('Gemini 能听懂怎么念，比如「用温柔的语气说」；留空就原样念'),'<input class="pg-in" id="vcST" placeholder="比如：用温柔的语气说" value="'+esc(v.st||'')+'">'))+
        vt('minimax',fd('情感','<div class="vc-chips" id="vcE">'+EMO.map(function(e){ return '<button class="tap'+(e[0]===emo?' on':'')+'" type="button" data-e="'+e[0]+'">'+e[1]+'</button>'; }).join('')+'</div>'))+'</div>'+
      '<div class="vc-gt"><span>音色 <em>'+vs.length+'</em></span><button class="tap" data-va="v" aria-label="加一个音色">'+I.plus+'</button></div><div class="pg-g vc-vos">'+vs.map(vrow).join('')+'</div>'+
      '<div class="pg-g" style="margin-top:12px">'+slider('vcS','语速',String(v.sp),.5,2,.1)+'<div class="pv-fd"><label>试听文字</label><input class="pg-in" id="vcX" placeholder="点音色时念这一句" value="'+esc(VTEST)+'"></div></div>'+
      '<div class="vc-gt"><span>输出</span></div><div class="pg-g">'+vt('minimax',slider('vcV','音量',String(v.vol),.1,10,.1)+slider('vcP','音调',String(v.pitch),-12,12,1))+
        '<div class="pv-fd"><label>采样率</label>'+seg(SRS.map(function(x){ return (x/1000)+'k'; }),Math.max(0,SRS.indexOf(v.sr))).replace('pg-seg','pg-seg pv-seg vc-sr')+'</div>'+
        '<div class="pv-fd"><label>格式</label>'+seg(FMTS,Math.max(0,FMTS.indexOf(v.fmt))).replace('pg-seg','pg-seg pv-seg vc-fm')+'</div></div>'+
      '<div class="pg-bts" style="padding:16px 0 0"><button class="pg-btn pri tap" data-act="sv">'+(isNew?'添加':'保存')+'</button></div>',
      {act:function(k,t){
        if(k==='eye'){ var inp=me.querySelector('#vcK'); inp.type=inp.type==='password'?'text':'password'; t.innerHTML=inp.type==='text'?PX.eyeoff:PX.eye; buzz(5); return; }
        if(!ty){ buzz([20,30,20]); toast('这家后端还没接，先选 OpenAI / MiniMax / 豆包'); return; }
        if(!LV.vc){ noLive(t); return; }
        v.ty=ty; v.n=me.querySelector('#vcN').value.trim()||v.n; v.base=me.querySelector('#vcB').value; v.model=me.querySelector('#vcM').value; v.st=(me.querySelector('#vcST')||{value:''}).value.trim(); v.rid=me.querySelector('#vcR').value||'seed-tts-2.0'; v.emo=emo;
        v.vol=+me.querySelector('#vcV').value; v.pitch=+me.querySelector('#vcP').value; v.sp=+me.querySelector('#vcS').value; v.sr=SRS[segK(me.querySelector('.vc-sr'))]; v.fmt=FMTS[segK(me.querySelector('.vc-fm'))];
        v.voices=vs; v.av=Math.max(0,Math.min(av,vs.length-1)); VTEST=me.querySelector('#vcX').value||VTEST; var vk=me.querySelector('#vcK').value.trim(); if(vk) v.newKey=vk;
        if(isNew){ VPS.push(v); isNew=false; if(!VACT) VACT=v.id; }
        if(!bgo(t)) return; vcSave().then(function(){ bend(t,true); toast('存好了'); later(function(){ me.querySelector('[data-x="back"]').click(); repaint(); }); },function(){ bend(t,false); }); }});
    var vos=me.querySelector('.vc-vos');
    function syncTy(){ [].forEach.call(me.querySelectorAll('.vt'),function(x){ x.hidden=!x.classList.contains('vt-'+ty); }); }
    function paintV(flash){ vos.innerHTML=vs.map(vrow).join('')||'<div class="pg-empty">还没有音色</div>'; me.querySelector('.vc-gt em').textContent=vs.length; if(flash!=null&&vos.children[flash]) vos.children[flash].classList.add('flash'); }
    function voSheet(j){ var x=j<0?['','']:vs[j];
      sheet(win,j<0?'加一个音色':'改音色','<div class="pg-g pv-form">'+fd('显示名称','<input class="pg-in" id="voN" placeholder="比如 温润男声" value="'+esc(x[0])+'">')+fd('音色 ID','<input class="pg-in mono" id="voI" placeholder="比如 male-qn-qingse" value="'+esc(x[1])+'">')+'</div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-vo>'+(j<0?'加上':'好')+'</button></div>',function(sh,close){
        setTimeout(function(){ sh.querySelector(j<0?'#voI':'#voN').focus(); },380);
        sh.querySelector('[data-vo]').addEventListener('click',function(){ var id=sh.querySelector('#voI').value.trim(), nm=sh.querySelector('#voN').value.trim(); if(!id){ sh.querySelector('#voI').focus(); buzz([20,30,20]); return; }
          if(j<0){ vs.push([nm||id,id]); j=vs.length-1; if(vs.length===1) av=0; } else vs[j]=[nm||id,id]; close(); paintV(j); buzz(8); }); }); }
    syncTy();
    /* [位置:phone-pages.js·voiceEdit·vurlSync] [开发者平台链接行] [跟着接口地址实时匹配开放平台，豆包按类型兜底，匹配不到隐藏整行；选服务商类型也会刷新] [注释时间 2026-10-31] */
    var vU=me.querySelector('#vcU'), vUW=vU.parentNode;
    function vurlSync(){ var u=voUrlOf(me.querySelector('#vcB').value,ty); if(u){ vU.href=u; vUW.style.display=''; } else { vU.removeAttribute('href'); vUW.style.display='none'; } }
    vurlSync();
    me.querySelector('#vcB').addEventListener('input',vurlSync);
    me.addEventListener('click',function(e){
      var tb=e.target.closest('[data-ty]'); if(tb){ var t=VTY[+tb.dataset.ty]; [].forEach.call(tb.parentNode.children,function(x){ x.classList.toggle('on',x===tb); }); buzz(6); ty=t[1]; if(!t[2]) toast(t[0]+' 后端还没接');
        me.querySelector('#vcN').value=t[0]; me.querySelector('#vcB').value=t[3]||(ty==='doubao'?'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional':''); me.querySelector('#vcM').value=t[4]||''; vs=ty==='gemini'?GVOICES.slice():(t[5]?[[t[5],t[5]]]:[]); av=0; paintV(); syncTy(); vurlSync();
        ['#vcN','#vcB'].forEach(function(q){ var x=me.querySelector(q); x.classList.remove('flash'); void x.offsetWidth; x.classList.add('flash'); }); return; }
      var em=e.target.closest('#vcE [data-e]'); if(em){ emo=em.dataset.e; [].forEach.call(em.parentNode.children,function(x){ x.classList.toggle('on',x===em); }); buzz(5); return; }
      if(e.target.closest('[data-va="v"]')){ buzz(6); voSheet(-1); return; }
      var ed=e.target.closest('[data-ve]'); if(ed){ buzz(6); voSheet(+ed.parentNode.dataset.j); return; }
      var dd=e.target.closest('[data-vd]'); if(dd){ var rw=dd.parentNode, j=+rw.dataset.j; rw.classList.add('gone'); buzz(6); setTimeout(function(){ vs.splice(j,1); if(av>=vs.length) av=Math.max(0,vs.length-1); else if(j<av) av--; paintV(); },260); return; }
      var vo=e.target.closest('.vc-vo'); if(vo){ var jj=+vo.dataset.j; av=jj; [].forEach.call(vos.children,function(x){ x.classList.toggle('on',x===vo); x.classList.remove('play'); }); buzz(6); vo.classList.add('play'); clearTimeout(vo._t);
        if(LV.vc&&!isNew&&VPS.indexOf(v)>=0){ say(me.querySelector('#vcX').value||VTEST,v.id,vs[jj][1]).then(function(){ vo._t=setTimeout(function(){ vo.classList.remove('play'); },1600); }); return; }
        vo._t=setTimeout(function(){ vo.classList.remove('play'); },2200); }
    });
  }
  /* 语音识别：后端真实链路（2026-10-23 豆包识别下线，走用途 voice_desc 的模型）——固定两条，模型共用：
     语音消息（发出去的）= /v1/voice/send → 转写+［声音描写］，可选开思考（描写细但要等十几秒）；麦克风（输入框按住说话）= /admin/asr → 只转文字。
     模型 / 思考开关 / 提示词全部即时生效，没有保存按钮；「转写提示词」点开就地编辑（P.pedit 的语音页，两个字段正好对应这两条）。
     麦克风条的「试一下」= 录一句 → POST /admin/asr，就是麦克风的真链路。 */
  function asrEdit(i,repaint){
    var a=ASRS[i], isMsg=a.ty==='annotated', vp=null;   /* vp=voice-desc/prompt 生效值（template/asr_template/think），思考开关保存要原样带回去；null=还在拉，false=没拉到 */
    function arMdCur(){ var x=ROLES.filter(function(x){ return x[0]==='voice_desc'; })[0]; return (x&&x[3]&&x[4])?(x[3]+'|'+x[4]):''; }
    var me=sub(win,isMsg?'语音消息 · 转写标注':'麦克风 · 转文字',
      '<div class="vc-gt"><span>识别模型</span></div><div class="pg-g">'+mdSelHtml({ic:'mic',t:'听录音的模型'+hint('语音消息和麦克风共用这一档，跟「用途模型」页是同一行；跟着用途走，没单独配就跟随默认聊天模型'),k:'arM'})+'</div>'+
      (isMsg?'<div class="vc-gt"><span>发出去之前</span></div><div class="pg-g">'+r({t:'转写时开思考'+hint('开了［声音描写］更细，但要等十几秒才发出去；关了快很多'),tg:1,tgname:'arThink',on:1})+'</div>':'')+
      '<div class="vc-gt"><span>转写提示词</span></div><div class="pg-g">'+r({t:'两份都能改'+hint('发出去的语音、输入框麦克风各一份，点开就地编辑'),act:'arP',right:I.ch})+'</div>'+
      (isMsg?'':'<div class="vc-gt"><span>试一下</span></div><div class="pg-g ar-t"><button class="ar-mic tap" type="button" aria-label="按住说话">'+VI.mic+'<i></i></button><p class="ar-o">按住说一句</p></div>'),
      {act:function(k){ if(k==='arP'){ buzz(6); P.pedit(win,7); } },
       toggle:function(t,on){ if(t.dataset.tg!=='arThink') return;
         if(!vp){ toast('没读到当前提示词，稍后再试'); t.classList.toggle('on',!on); return; }
         P.net.post(AB+'voice-desc/prompt',{template:String(vp.template||''),asr_template:String(vp.asr_template||''),think:on}).then(function(){ toast(on?'会想了 · 描写细一点，转写慢一点':'关掉了 · 转写快很多'); buzz([8,30,8]); },function(){ toast('没存上'); t.classList.toggle('on',!on); var sw=t.querySelector('.pg-sw'); if(sw) sw.setAttribute('aria-checked',on?'false':'true'); }); }});
    P.net.get(AB+'voice-desc/prompt').then(function(v){ vp=(v&&v.template&&v.asr_template)?v:false; var tg=me.querySelector('[data-tg="arThink"]'); if(tg&&vp&&vp.think===false){ tg.classList.remove('on'); tg.querySelector('.pg-sw').setAttribute('aria-checked','false'); } },function(){ vp=false; });
    var inst=mdBind(me.querySelector('[data-md="arM"]'),arMdCur(),function(v,pid,model,prev){
      function done(){ var x=ROLES.filter(function(x){ return x[0]==='voice_desc'; })[0]; if(x){ x[2]=pid?model:'跟随默认'; x[3]=pid; x[4]=model; } if(repaint) repaint(); toast('识别模型 → '+(pid?model:'跟随默认')); buzz([8,30,8]); }
      if(!LV.rl){ done(); return; }
      P.net.req(AB+'model-roles/voice_desc',{method:'PUT',body:{provider_id:pid,model:model}}).then(done,function(){ toast('没改成'); buzz([20,30,20]); inst.want(prev); });
    });
    var mic=me.querySelector('.ar-mic'), out=me.querySelector('.ar-o'), rec=0;
    /* 录音：16k 单声道 16bit WAV（后端要这个格式） */
    var ac=null, stm=null, node=null, buf=[];
    function wav(chunks,rate){ var n=chunks.reduce(function(a,c){ return a+c.length; },0), f=new Float32Array(n), o=0; chunks.forEach(function(c){ f.set(c,o); o+=c.length; });
      var ratio=rate/16000, m=Math.floor(n/ratio), dv=new DataView(new ArrayBuffer(44+m*2)); function ws(p,t){ for(var i=0;i<t.length;i++) dv.setUint8(p+i,t.charCodeAt(i)); }
      ws(0,'RIFF'); dv.setUint32(4,36+m*2,true); ws(8,'WAVE'); ws(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true); dv.setUint32(24,16000,true); dv.setUint32(28,32000,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true); ws(36,'data'); dv.setUint32(40,m*2,true);
      for(var i=0;i<m;i++){ var x=Math.max(-1,Math.min(1,f[Math.floor(i*ratio)])); dv.setInt16(44+i*2,x<0?x*0x8000:x*0x7fff,true); }
      var u=new Uint8Array(dv.buffer), s2=''; for(var j=0;j<u.length;j+=8192) s2+=String.fromCharCode.apply(null,u.subarray(j,j+8192)); return btoa(s2); }
    function down(e){ e.preventDefault(); if(rec) return; rec=1; mic.classList.add('rec'); out.className='ar-o'; out.textContent='在听…'; buzz(8);
      buf=[];
      navigator.mediaDevices.getUserMedia({audio:true}).then(function(st){ if(!rec){ st.getTracks().forEach(function(t){ t.stop(); }); return; } stm=st; ac=new (window.AudioContext||window.webkitAudioContext)(); var src=ac.createMediaStreamSource(st); node=ac.createScriptProcessor(4096,1,1); node.onaudioprocess=function(ev){ buf.push(new Float32Array(ev.inputBuffer.getChannelData(0))); }; src.connect(node); node.connect(ac.destination); },function(){ rec=0; mic.classList.remove('rec'); out.className='ar-o'; out.textContent='没拿到麦克风权限'; }); }
    function up(){ if(!rec) return; rec=0; mic.classList.remove('rec'); out.innerHTML='<i class="pg-spin"></i>识别中…'; buzz(6);
      var rate=ac?ac.sampleRate:48000; try{ node&&node.disconnect(); stm&&stm.getTracks().forEach(function(t){ t.stop(); }); ac&&ac.close(); }catch(e){}
      if(!buf.length){ out.className='ar-o'; out.textContent='太短了，再说一次'; return; }
      P.net.post(AB+'asr',{audio:wav(buf,rate)},{timeout:60000}).then(function(r){ out.className='ar-o'+(r&&r.text?' ok':''); out.textContent=(r&&r.text)||'没听清'; buzz([8,30,8]); },function(e){ out.className='ar-o'; out.textContent='识别失败：'+String((e&&e.message)||'').slice(0,40); }); }
    if(mic){ mic.addEventListener('pointerdown',down); ['pointerup','pointercancel','pointerleave'].forEach(function(t){ mic.addEventListener(t,up); }); }
  }
  function pick(title,opts,cur,fn){
    sheet(win,title,'<div class="pg-g cf-pick">'+opts.map(function(o){ return r({t:o,act:'pk',cls:o===cur?'on':'',right:'<span class="ck">'+I.ok+'</span>'}); }).join('')+'</div>',function(s,close){
      s.addEventListener('click',function(e){ var t=e.target.closest('[data-act="pk"]'); if(!t) return; Array.prototype.forEach.call(t.parentNode.children,function(x){ x.classList.toggle('on',x===t); }); buzz(8); setTimeout(function(){ close(); fn(t.querySelector('b').textContent); },260); });
    });
  }
  /* ================= 接真数据（10-20） =================
     读：ai-providers / model-roles / chat-settings / prompt-backups / session-prompts / voice-config 一起拉，谁先到谁先换上；MCP 进页面才拉（它会逐个探测，慢）。
     写：供应商 = 整表 PUT（改完半秒自动存）；用途模型 = 单条 PUT；人设 = upserts / delIds；默认人设 = 把正文写进 chat-settings.system_prompt；
     生成定义 = chat-settings cfg_patch；语音 = 整表 PUT；MCP = 整表 PUT（工具集合的工具开关走 /admin/tools）。都是热生效，不用重启。拿不到就继续用示例。 */
  var LV={pv:false,ps:false,vc:false,rl:false,cs:null,vcfg:null,env:null}, AB='/heartbeat/admin/', PCONT={};
  function setRv(k,v){ var e=root.querySelector('[data-go="'+k+'"] .rv'); if(e) e.textContent=v; }
  function pvSplit(u){ u=String(u||''); var m=u.match(/^(.*?)(\/v\d+\/messages|\/chat\/completions|\/messages)$/); return m?[m[1],m[2]]:[u,'']; }
  var PCOLS=['#7aa0d8','#5f8fe0','#6ab0c8','#8a8fd8','#9b86d0','#e0a060','#4a4f66','#e08aa0','#5c7fe6','#4b6fd0','#c39ad6','#4aa0e0'];
  function pvFrom(x,j){ var sp=pvSplit(x.api_url||x.base_url); return {id:x.id,raw:x,n:x.name||'',on:x.enabled!==false,c:PCOLS[j%PCOLS.length],base:sp[0],path:sp[1],prof:x.profile||'default',bal:x.balance_url?'有':'',balUrl:x.balance_url||'',key:'',keySet:!!x.api_key_set,models:(x.models||[]).slice(),def:x.model||((x.models||[])[0])||'',so:!!x.sampling_override&&!(x.sampling_override.temperature===null||x.sampling_override.top_p===null),nosamp:!!(x.sampling_override&&(x.sampling_override.temperature===null||x.sampling_override.top_p===null)),isDef:!!x.is_default,pm:(x.proxy_models||[]).slice(),vm:(x.vision_models||[]).slice(),oauth:x.oauth_provider||'',st:x.oauth_status||null,pxall:!!(x.via_anthropic_proxy===true||x.oauth_provider==='claude')}; }   /* pxall：与后端 lib/upstream-target.js 的 isAnthropicProxy 同一口径（via_anthropic_proxy 或 oauth_provider=claude）——这类供应商的请求恒走本机翻译代理，proxy_models 不参与路由，所以「走代理」开关锁死；不要用「oauth_provider 非空」或「api_url 含 /internal/」判，会把还有效的 proxy_models（如 Gemini API、花粉）误锁 */   /* oauth：订阅登录类（claude/gemini/codex）要带着走，否则 pvTo 回存时会把 oauth_provider 等字段删掉（10-22 事故：Claude 订阅供应商被改存一次就「不可用」，会话悄悄回退到默认模型） */
  function pvTo(p){ var o=Object.assign({},p.raw||{}); delete o.api_key_set; delete o.base_url; if(!p.id) p.id='p_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); o.id=p.id; o.name=p.n; o.enabled=!!p.on; o.api_url=p.path?String(p.base||'').replace(/\/+$/,'')+p.path:String(p.base||''); o.api_key=p.newKey||''; o.models=p.models.slice(); o.model=p.def||p.models[0]||''; o.is_default=!!p.isDef; o.profile=p.prof||'default'; o.balance_url=p.balUrl||''; o.proxy_models=(p.pm||[]).filter(function(m){ return p.models.indexOf(m)>=0; }); o.vision_models=(p.vm||[]).filter(function(m){ return p.models.indexOf(m)>=0; });   /* 10-27 图片转写：勾了的模型直接看原图，不转写 */   /* 10-24 需求 37：每个模型自己的「走代理」开关 */
    if(p.oauth){ o.oauth_provider=p.oauth; o.via_anthropic_proxy=true; o.auth_type='bearer'; if(p.oauth==='claude') o.anthropic_base=o.anthropic_base||'https://api.anthropic.com'; }
    else { delete o.oauth_provider; delete o.via_anthropic_proxy; delete o.auth_type; }
    return o; }
  var pvT=0;
  function pvSaveSoon(){ if(!LV.pv) return; clearTimeout(pvT); pvT=setTimeout(pvSave,500); }
  function pvSave(){ clearTimeout(pvT); if(!LV.pv) return Promise.resolve(); return P.net.req(AB+'ai-providers',{method:'PUT',body:{providers:PVD.map(pvTo)}}).then(function(){ PVD.forEach(function(p){ if(p.newKey){ p.keySet=true; p.newKey=''; } }); pvSummary(); if(P.sessOpts&&P.sessOpts.clear) P.sessOpts.clear();   /* 11-05 晚：模型清单变了，作废本机那份缓存，下拉立刻是新列表 */ },function(e){ toast('供应商没存上'+(e&&e.status?'（'+e.status+'）':'')); buzz([20,30,20]); throw e; }); }
  function pvSummary(){ setRv('prov',PVD.filter(function(p){ return p.on; }).length+' 个在用'); var d=PVD.filter(function(p){ return p.isDef; })[0]; if(defMd) defMd.want(d&&d.def?(d.id+'|'+d.def):''); }
  /* [位置:phone-pages.js·pvModels] [拉模型列表] [走后端 POST /admin/providers/models，用服务端已保存的 Key；表单里新填的 Key 也交给后端转发，不再浏览器直连] [注释时间 2026-10-21 改：原为浏览器拿表单 Key 直连供应商，没填 Key 就拉不了] */
  function pvModels(p,key){ return P.net.post(AB+'providers/models',{id:p.id||'',api_url:p.path?String(p.base||'').replace(/\/+$/,'')+p.path:String(p.base||''),api_key:key||'',profile:p.prof||'default'}).then(function(r){ if(!r||!r.ok) throw new Error((r&&r.error)||'没拉到'); return r.models||[]; }); }
  function genOf(c){ c=c||{}; return {on:c.temperature!=null&&c.temperature!==''||c.top_p!=null&&c.top_p!=='', t:c.temperature!=null&&c.temperature!==''?+c.temperature:1, p:c.top_p!=null&&c.top_p!==''?+c.top_p:1, mx:+c.max_tokens||4096}; }
  function psFrom(list,sp){ var cnt={}; Object.keys(sp||{}).forEach(function(k){ cnt[sp[k]]=(cnt[sp[k]]||0)+1; }); PERS.length=0; PCONT={};
    /* [位置:phone-pages.js·psFrom] [人设元组加 grp 分组名（第 6 位，空=不分组）] [11-14：rp 预设组配套，分组随人设本体走（routes/chat.js norm 落盘）] [注释时间 2026-11-14] */
    (list||[]).forEach(function(b){ PCONT[b.id]=String(b.content||''); if(b.marker==='subagent') return; /* 2026-10-25：子智能体任务提示词（网关自动写入），不进人设列表 */ PERS.push([b.id,b.name||'(未命名)',PCONT[b.id].length,String(b.updatedAt||b.createdAt||'').slice(5,10),cnt[b.id]||0,String(b.grp||''),b.elapsed_tag_to_ai===false?'off':(b.elapsed_tag_to_ai===true?'on':'')]); });
    /* [位置:phone-pages.js·psFrom·第7位] [人设级时间差标签开关状态] [11-15：rp 预设组统一关 [elapsed] 标签的配套——''=跟随默认/'off'=不注入/'on'=注入，编辑页 psE 下拉读写，保存 PUT 透传 elapsed_tag_to_ai（routes/chat.js norm 白名单落盘）] [注释时间 2026-11-15] */
    var sys=LV.cs&&String(LV.cs.system_prompt||'').trim(), hit=PERS.filter(function(p){ return sys&&PCONT[p[0]].trim()===sys; })[0]; DEFP=hit?hit[0]:''; setRv('prompts',PERS.length+' 个'); }
  function vcFrom(c){ LV.vcfg=c; VPS.length=0; (c.providers||[]).forEach(function(x){ var vs=(x.voices||[]).map(function(v){ return [v.label||v.value,v.value]; }), av=Math.max(0,vs.map(function(v){ return v[1]; }).indexOf(x.active_voice));
      VPS.push({id:x.id,raw:x,ty:x.type||'doubao',n:x.name||x.type,base:x.api_base||'',model:x.tts_model||'',st:x.style_prompt||'',rid:x.resource_id||'seed-tts-2.0',emo:x.emotion||'calm',vol:x.vol==null?1:x.vol,pitch:x.pitch||0,sr:x.sample_rate||24000,fmt:x.audio_format||'mp3',sp:x.speed==null?1:x.speed,av:av,voices:vs,keySet:!!x.api_key_set}); });
    VACT=c.active_provider||(VPS[0]&&VPS[0].id)||'';
    var a=VPS.filter(function(v){ return v.id===VACT; })[0]; setRv('voice',a?a.n:'没选'); }
  function vcTo(v){ var o=Object.assign({},v.raw||{}); delete o.api_key_set; o.id=v.id; o.type=v.ty; o.name=v.n; o.api_base=v.base; o.tts_model=v.model; o.style_prompt=v.st||''; o.resource_id=v.rid; o.emotion=v.emo; o.vol=v.vol; o.pitch=v.pitch; o.sample_rate=v.sr; o.audio_format=v.fmt;
    if(v.ty!=='doubao') o.speed=v.sp; o.voices=v.voices.map(function(x){ return {label:x[0],value:x[1]}; }); o.active_voice=(v.voices[v.av]||[])[1]||''; o.api_key=v.newKey||''; if(o.enabled==null) o.enabled=true; return o; }
  function vcSave(){ if(!LV.vc) return Promise.resolve(); var c=LV.vcfg||{};
    /* asr_api_key / asr_resource_id 已是死配置（2026-10-23 起识别走千问 Omni，后端不再读）：传空串，后端按「空=保留旧值」原样兜着 */
    return P.net.req(AB+'voice-config',{method:'PUT',body:{enabled:c.enabled!==false,active_provider:VACT,providers:VPS.map(vcTo),asr_api_key:'',asr_resource_id:''}}).then(function(){ VPS.forEach(function(v){ if(v.newKey){ v.keySet=true; v.newKey=''; } }); },function(){ toast('语音没存上'); buzz([20,30,20]); }); }
  var AUD=null;
  function say(text,pid,speaker){ if(!LV.vc) return Promise.resolve(false); return P.net.post(AB+'tts',{text:text||VTEST,provider_id:pid,speaker:speaker}).then(function(r){ if(!r||!r.audio) throw new Error((r&&r.error)||'没有声音'); try{ if(AUD) AUD.pause(); }catch(e){} AUD=new Audio('data:audio/'+(r.format==='wav'?'wav':r.format==='pcm'?'wav':'mpeg')+';base64,'+r.audio); return AUD.play().then(function(){ return true; },function(){ return true; }); }).catch(function(e){ toast('试听失败：'+String((e&&e.message)||'').replace(/^HTTP \d+ ?/,'').slice(0,40)); return false; }); }
  function load(){
    P.net.get(AB+'ai-providers').then(function(r){ var a=(r&&r.providers)||[]; PVD.length=0; a.forEach(function(x,j){ PVD.push(pvFrom(x,j)); }); if(P.net.keep&&a.length) P.net.keep('aiprovs',a); LV.pv=true; pvSummary(); cfgReady('pv',true); },function(){ if(P.net.offline) P.net.offline(); cfgReady('pv',false); });   /* 1027：顺手写供应商本地缓存，模型选择器冷启动秒开 */
    P.net.get(AB+'model-roles').then(function(r){ var rs=(r&&r.roles)||{}; ROLES.length=0; Object.keys(rs).forEach(function(k){ var x=rs[k]; ROLES.push([k,x.label||k,x.model_display||x.model||'跟随聊天模型',x.provider_id||'',x.model||'']); }); LV.rl=true; cfgReady('rl',true); },function(){ cfgReady('rl',false); });
    var cs=P.net.get(AB+'chat-settings').then(function(r){ LV.cs=(r&&r.data)||{}; var g=genOf(LV.cs.cfg); setRv('gen',g.on?'自定义参数':'跟随默认'); setRv('spreset',presetList().length?presetList().length+' 个':''); },function(){});
    Promise.all([cs,P.net.get('/v1/prompt-backups'),P.net.get(AB+'session-prompts').catch(function(){ return {}; })]).then(function(x){ psFrom((x[1]&&x[1].backups)||[],(x[2]&&x[2].prompts)||{}); LV.ps=true; cfgReady('ps',true); },function(){ cfgReady('ps',false); });
    P.net.get(AB+'voice-config').then(function(r){ if(r&&r.config){ vcFrom(r.config); LV.vc=true; } cfgReady('vc',true); },function(){ cfgReady('vc',false); });
    setRv('pass','已设置');
  }
  load();
  /* [位置:phone-pages.js·cfgMount(act:logout)] [退出登录] [这台手机上退出：清登录标记，下次请求弹登录框重新输账号密码] [注释时间 2026-10-21]
     先调 POST /admin/chat-logout 让服务端把 admin_session / admin_csrf 过期（HttpOnly 的 cookie 只有服务端能删）；接口还没上线（404）或网络不通时，
     仍清本机登录标记和可读的 admin_csrf，并如实提示「这台手机要重新登录」，不说「已退出」——此时 cookie 其实还在，只是前端当作未登录。 */
wire(root,{back:onBack,go:go,act:function(k){ if(k==='logout') confirmBox(win,'退出登录？','这台手机上要重新输账号密码才能用。','退出',true,function(){
    var clear=function(real){ try{ localStorage.removeItem('han_logged_in'); }catch(e){} try{ document.cookie='admin_csrf=; Max-Age=0; path=/'; }catch(e){}
      toast(real?'已退出，下次要重新登录':'这台手机要重新登录'); buzz([8,30,8]); try{ window.dispatchEvent(new Event('ph:logout')); }catch(e){}
      setTimeout(function(){ P.net.get('/v1/sessions',{}).catch(function(){}); },420); };   /* 随手发一个请求：cookie 若真没了会 401 → 弹出登录框 */
    P.net.post(AB+'chat-logout',{},{noLogin:true}).then(function(){ clear(true); },function(){ clear(false); }); }); },toggle:function(t,on){ toast('系统通知'+(on?'已打开':'已关闭')); }});
  P.cfg={go:go};
}
P.register('cfg',{html:cfgHTML,setup:function(w){ cfgSetup(w); pageSearch(w,'搜配置项'); }});


/* ================= 记忆池 =================
   主体：统计 / 搜索 / 分类 / 排序 / 列表（/admin/memory-v2/entries、pool-view），点一条：编辑、pin、沉底。
   右上设置：相关记忆注入 + 预览、两块总结（定时 + 版本存档）、记忆蒸馏、老数据重跑、导入导出（真实字段照管理台）。 */
var MEMS=[];   /* 演示记忆已删（2026-10-22） */
/* 待审（/admin/memory-review/queue）：字段照真实队列——candidate{text,kind,origin,backfill}、merge、judge{worth,worth_reason,volatility,volatility_reason,suggested_kind,similar[]}。
   示例文字是编的（真实队列内容私密，不放进预览页）。 */
var QUEUE=[];   /* 演示待审队列已删（2026-10-22） */
var KN={rule:['rule','ok','#6fa98a'],fact:['fact','','#7d9ccf'],event:['event','warn','#d99a6c']};
var VOL={stable:'稳定',situational:'看情境',volatile:'易变'}, SJ={user:'关于她',relationship:'关于我们',self:'关于他',external:'外部'};
var MI={sort:svg('<path d="M4 7h11M4 12h8M4 17h5M18 6v13M15 16l3 3 3-3"/>'),sim:svg('<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>'),q:svg('<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18.5" cy="16.5" r="3"/>')};
/* [位置:phone-pages.js·SRC/srcKey/srcOf/srcWhy] [记忆来源统一标签] [需求:11-06「来源不准确」：origin 只有 5 个粗粒度值，promotion 一个值兜住了压缩块解析 / 蒸馏对话 / 蒸馏笔记 / 老数据重跑四类，前端一律显示成「从总结里提上来的」；改为 channel（新数据）优先、旧数据按 block_id / msg_id / 时间窗推导，详情再给一句具体来路] [注释时间 2026-11-06] */
var SRC={chat_tag:'聊天里记的',pick:'聊天里挑的',form:'手动填的',note:'蒸馏·笔记',dialog:'蒸馏·对话',compress:'压缩块解析',backfill:'梳理旧记忆',unknown:'来源未记录',import:'导入的',tool:'工具记的',decay:'久没用·复查',bf:'老数据重跑'};
function srcKey(o,pv,ts){
  pv=pv||{}; o=String(o||'');
  var ch=pv.channel,bid=String(pv.block_id||''),mid=String(pv.msg_id||''),t=String(ts||'');
  if(ch==='note_distill') return 'note';
  if(ch==='dialog_distill') return 'dialog';
  if(ch==='compress_reparse') return 'compress';
  if(ch==='backfill') return 'backfill';
  if(ch==='manual_form') return 'form';
  if(ch==='manual_pick') return 'pick';
  if(ch==='chat_tag') return 'chat_tag';
  if(ch==='mcp_memory_add') return 'form';
  if(o==='memory_tag') return 'chat_tag';
  if(o==='tool') return 'tool';
  if(o==='import') return 'import';
  if(o==='manual') return pv.session_id?'pick':'form';
  if(bid.indexOf('legacy:')===0) return 'import';
  if(bid.indexOf('ctxrep')===0) return 'compress';
  if(mid.indexOf('note_')===0) return 'note';
  if(mid) return 'dialog';
  if(t>='2026-10-05T09:00'&&t<='2026-10-05T14:00') return 'backfill';
  return 'unknown';
}
function srcOf(o,pv,ts){ return SRC[srcKey(o,pv,ts)]||SRC.unknown; }
function srcWhy(o,pv,ts){
  var pv2=pv||{}, k=srcKey(o,pv,ts), mid=String(pv2.msg_id||'');
  if(k==='note') return mid?('来自笔记 '+mid.replace('note_','#')):'来自笔记本里的笔记';
  if(k==='dialog') return '来自那几天的对话原文';
  if(k==='compress') return '2026-09-28 把压缩掉的老对话原文重新抽了一遍（压缩块已下线）';
  if(k==='backfill') return '2026-10-05 那轮老数据重跑整理的';
  if(k==='chat_tag') return '聊天时打记忆标签记下的';
  if(k==='pick') return '聊天里长按挑出来入池的';
  if(k==='form') return pv2.channel==='mcp_memory_add'?'AI 用记忆工具写进去的':'在记忆池里手写的';
  if(k==='import') return '从旧记忆池迁移 / 文件导入的';
  if(k==='tool') return '通过记忆工具写入的';
  if(k==='decay') return '长期没被用到，衰减到 20% 以下';
  return '早期入库，当时没记来路';
}
/* [位置:phone-pages.js·kwSheet] [关键词编辑底板] [需求:11-06：待审卡与记忆池详情共用一套关键词编辑（长按改、点＋加、清空即删）；关底板（点空白 / 下拉 / 返回）自动存，不额外要一次确认] [注释时间 2026-11-06] */
function kwSheet(win,title,list,onSave){
  var cur=(list||[]).slice(), orig=JSON.stringify(cur), saved=false;
  function kw(x){ return '<span class="tr" data-kw>'+esc(x)+'</span>'; }
  sheet(win,title,'<div class="mm-kws kw-sk">'+cur.map(kw).join('')+'<span class="tr add" data-addkw>＋</span></div><div class="pg-ft">长按改，点＋加；改空就删。关掉自动存。</div>',function(sh){
    var box=sh.querySelector('.mm-kws');
    function edit(t){ if(!t||t.isContentEditable) return; t.contentEditable='true'; t.classList.add('ed'); t.focus(); var rg=document.createRange(); rg.selectNodeContents(t); var se=getSelection(); se.removeAllRanges(); se.addRange(rg); buzz([8,30,8]); }
    function add(){ var d=document.createElement('div'); d.innerHTML='<span class="tr" data-kw></span>'; var n=d.firstChild; box.insertBefore(n,box.querySelector('[data-addkw]')); edit(n); }
    hold(box,function(t){ edit(t); },'[data-kw]');
    box.addEventListener('click',function(e){ if(e.target.closest('[data-addkw]')) add(); });
    box.addEventListener('focusout',function(e){ var t=e.target.closest('[data-kw]'); if(!t) return; t.contentEditable='false'; t.classList.remove('ed'); t.textContent=t.textContent.replace(/^#+/,'').trim(); if(!t.textContent){ t.classList.add('gone'); setTimeout(function(){ t.remove(); },250); } });
    box.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); } });
    function fire(){
      if(saved) return;
      var v=[].map.call(box.querySelectorAll('[data-kw]:not(.gone)'),function(x){ return x.textContent.trim(); }).filter(Boolean);
      if(JSON.stringify(v)===orig) return;
      saved=true; onSave(v,function(){ saved=false; toast('没存上'); });
    }
    /* 关闭路径统一收口：点空白 / 下拉关闭都会把 .show 摘掉，这里等到摘掉那一刻取值 */
    var mo=new MutationObserver(function(){ if(!sh.classList.contains('show')){ mo.disconnect(); fire(); } });
    mo.observe(sh,{attributes:true,attributeFilter:['class']});
  });
}
function memHTML(){
  return shell('记忆池','<button class="pg-cb tap" id="mmSet" aria-label="设置">'+I.gear+'</button>',
    '<div class="pg-search mm4-s">'+I.find+'<input class="pg-in" id="mmQ" placeholder="搜记忆" aria-label="搜记忆"><span id="mmHit" aria-live="polite"></span></div>'+
    '<div class="mm4-bar"><div class="mm3-tabs" id="mmK" role="tablist"><button class="on" data-k="">all</button><button data-k="fact">fact</button><button data-k="rule">rule</button><button data-k="event">event</button><i></i></div>'+
      '<button class="mm4-ic tap" id="mmPickBtn" aria-label="多选">'+svg('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>')+'</button><button class="mm4-ic tap" id="mmSort" aria-label="排序">'+MI.sort+'</button><button class="mm4-q tap" id="mmQ2" aria-label="待审">'+QUEUE.length+'</button>'+
      '<div class="mm-menu" id="mmMenu"><button data-s="recent" class="on">最新'+I.ok+'</button><button data-s="old">最早'+I.ok+'</button><button data-s="worth">值得记'+I.ok+'</button><button data-s="sunk">已沉底'+I.ok+'</button><hr><button data-s="sim" class="go">相似的放一起看<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button></div></div>'+
    '<div class="mm-fl" id="mmFl"></div><div id="mmPin"></div><div id="mmL" class="mm4-list"></div>'+
    /* [位置:phone-pages.js·memHTML mm-fab] [新增记忆悬浮按钮] [需求:11-06：记忆池一直没有新增入口；右下角常驻一个＋（圆角矩形，不做成圆的）] [注释时间 2026-11-06] */
    '<button class="mm-fab tap" id="mmAdd" aria-label="新增记忆">'+I.plus+'</button>'+
    '<div class="mm-mbar" id="mmMbar" hidden></div>');
}
function memSetup(win){
  var L=$('#mmL',win), fk='', fs='recent', q='', pinOpen=false, live=false, mst='load', MB='/heartbeat/admin/memory-v2/', RQ='/heartbeat/admin/memory-review/queue', mmMulti=false, mmPick={};
  /* ---- 真数据：/admin/memory-v2/entries（全量，不分页；superseded = 被新版本替掉的旧条，不显示）、/admin/memory-review/queue ----
     置顶 = anchor（常驻注入）；沉底 = archived，后台 7 天后会自动删掉；值得记 / 会不会过时是门卫评估出来的，只用来看。 */
  SJ.about_user='关于她'; SJ.toward_user='对她'; SJ.self_discipline='管自己';
  function mFrom(x){ var c=String(x.created_at||''), wl=wallLocal(c); return {id:x.id,k:KN[x.kind]?x.kind:'fact',t:x.text||'',w:x.worth==null?null:+x.worth,wr:x.worth_reason||'',vol:x.volatility||'',sj:x.direction||'',tr:(x.triggers||[]).slice(),pin:!!x.anchor,d:wl?wl.d:c.slice(5,10),ts:c,sunk:x.status==='archived',o:x.origin||'',pv:x.provenance||null,se:x.search_enabled!==undefined?!!x.search_enabled:null}; }   /* 2026-11-06：带 provenance 供 srcOf 判来源细分通道；11-08：se=参与检索开关（null=存量没这字段，显示时按 kind 推默认） */
  function qFrom(x){ var c=x.candidate||{}, j=x.judge, bf=c.backfill, wl=wallLocal(x.created_at);
    return {id:x.id,k:c.kind||'',k0:c.kind||'',t:c.text||'',o:c.origin||'',sj:c.direction||'',at:wl?(wl.d.replace('-','.')+' '+wl.hm):'',
      j:j&&j.worth!=null?{w:+j.worth,wr:j.worth_reason||'',v:j.volatility||'',vr:j.volatility_reason||'',sk:j.suggested_kind||'',skr:j.suggested_kind_reason||''}:null,
      sim:((j&&j.similar)||[]).map(function(m){ return {id:m.id,t:m.text||m.content||'',rel:m.relation||m.rel||'need_review',sc:+(m.score!=null?m.score:m.sim||0),why:m.reason||m.why||''}; }),
      /* 2026-11-06：tr = 候选关键词（后端本次起透传 draft.triggers）；pv = provenance 判来源；11-08：se=参与检索开关（null 推默认） */
      tr:((c.triggers)||[]).slice(), pv:x.provenance||null, ts:String(x.created_at||''), js:x.judge_status||null, se:c.search_enabled===undefined||c.search_enabled===null?null:!!c.search_enabled,
      bf:bf?{a:bf.action,old:bf.old_text||'',n:(bf.merge_ids||[]).length,ids:(bf.merge_ids||[]).length?(bf.merge_ids||[]):(bf.target_id?[bf.target_id]:[]),why:bf.reason||''}:null}; }   /* 2026-11-05：ids 给通过后本地标旧条沉底用（不再整池重拉）；11-08：js=评分状态供轮询局部回填；11-08 清洗器：sink 卡的 ids 取 target_id（通过后本地标 sunk、toast 文案判断用） */
  function load(){ return P.net.get(MB+'entries').then(function(r2){ var a=((r2&&r2.items)||[]).filter(function(x){ return x.status!=='superseded'; }); MEMS.length=0; a.forEach(function(x){ MEMS.push(mFrom(x)); }); live=true; mst='ok';
      $('#mmQ',win).placeholder='在 '+MEMS.filter(function(m){ return !m.sunk; }).length+' 条里找'; paint(); },function(){ if(P.net.offline) P.net.offline(); mst='fail'; MEMS.length=0; paint(); }); }
  win.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ mst='load'; paint(); load(); loadQ(); } });
  function loadQ(){ return P.net.get(RQ).then(function(r2){ QUEUE=((r2&&r2.items)||[]).map(qFrom); var b=$('#mmQ2',win); b.textContent=QUEUE.length; b.classList.toggle('done',!QUEUE.length); },function(){}); }
  function mPin(m){ if(!live||!m.id) return; P.net.post(MB+'entries/'+encodeURIComponent(m.id)+'/pin',{pinned:m.pin}).catch(function(){ m.pin=!m.pin; paint(); toast('没改成'); }); }
  function mSink(m){ if(!live||!m.id) return; P.net.post(MB+'entries/'+encodeURIComponent(m.id)+'/status',{action:m.sunk?'archive':'revive'}).catch(function(){ m.sunk=!m.sunk; paint(); toast('没改成'); }); }
  var mImap=null;   /* [位置:phone-pages.js·memSetup mImap] [渲染下标查表] [2026-10-27 审查：原来每行 indexOf 全表扫，
     搜索时整列表重建+每行一次 indexOf = O(n²)，几百条记忆输入明显掉字；paint 开头建一次 Map] [注释时间 2026-10-27] */
  function hl(s){ var h=esc(s); if(!q) return h; var k=esc(q); return h.split(k).join('<mark>'+k+'</mark>'); }
  /* [位置:phone-pages.js·memSetup row] [记忆列表多选：勾选圈] [11-13：记忆列表没有多选，只有左滑单条置顶/沉底；多选态下每行前出勾选圈，选中行高亮] [注释时间 2026-11-13] */
  function row(m){ var i=(mImap&&mImap.get(m)!=null)?mImap.get(m):MEMS.indexOf(m); return '<div class="mm-sw'+(mmPick[m.id]?' sel':'')+'" data-i="'+i+'" data-mid="'+esc(String(m.id||''))+'"><i class="ck">'+I.ok+'</i><div class="acts"><button data-a="pin" class="p tap">'+I.pin+'<span>'+(m.pin?'取消':'置顶')+'</span></button><button data-a="sink" class="s tap">'+I.sink+'<span>'+(m.sunk?'恢复':'沉底')+'</span></button></div><button class="mm-it2'+(m.sunk?' sunk':'')+'"><div class="mt"><span class="kn k-'+m.k+'">'+KN[m.k][0]+'</span><span>'+m.d.replace('-','.')+'</span>'+(m.w==null?'':'<span class="wn" aria-label="值得记">'+m.w.toFixed(2)+'</span>')+'</div><p>'+hl(m.t)+'</p>'+(m.tr.length?'<div class="mm-kw2">'+m.tr.slice(0,5).map(function(x){ return '<span>'+esc(x)+'</span>'; }).join('')+'</div>':'')+'</button></div>'; }   /* [位置:phone-pages.js·memSetup row 关键词] [列表行显示关键词] [11-03：记忆列表里关键词没显示（详情抽屉里有、列表行没有）；正文下面一行小标签，最多 5 个，没有关键词的不占行] [注释时间 2026-11-03] */
  function paint(){
    L.classList.toggle('picking',mmMulti);
    if(mst!=='ok'){ L.innerHTML=mst==='load'?P.net.loadBox():P.net.failBox(); $('#mmPin',win).innerHTML=''; return; }
    mImap=new Map(); MEMS.forEach(function(m,i){ mImap.set(m,i); });
    var list=MEMS.filter(function(m){ return (!fk||m.k===fk)&&(!q||m.t.indexOf(q)>=0||m.tr.some(function(x){ return x.indexOf(q)>=0; }))&&(fs==='sunk'?m.sunk:!m.sunk); });
    list=list.slice().sort(fs==='worth'?function(a,b){ return (b.w==null?-1:b.w)-(a.w==null?-1:a.w); }:fs==='old'?function(a,b){ return (a.ts||a.d)<(b.ts||b.d)?-1:1; }:function(a,b){ return (a.ts||a.d)<(b.ts||b.d)?1:-1; });
    /* 置顶的放最上面一排横着滑；搜索 / 沉底时不出现 */
    var pins=MEMS.filter(function(m){ return m.pin&&!m.sunk&&(!fk||m.k===fk); }), pv=$('#mmPin',win);
    pv.innerHTML=(!q&&fs!=='sunk'&&pins.length)?'<button class="mm4-mh mm4-pt'+(pinOpen?' open':'')+'" type="button" aria-expanded="'+pinOpen+'"><b>置顶</b><small>'+pins.length+'</small><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button><div class="mm4-rw'+(pinOpen?' open':'')+'"><div class="mm4-rail">'+pins.map(function(m){ return '<button class="mm4-pc" data-i="'+((mImap&&mImap.get(m)!=null)?mImap.get(m):MEMS.indexOf(m))+'"><small class="kn k-'+m.k+'">'+KN[m.k][0]+'</small><p>'+esc(m.t)+'</p></button>'; }).join('')+'</div></div>':'';
    if(fs==='worth') L.innerHTML=list.length?'<div class="mm4-grp pg-rise">'+list.map(row).join('')+'</div>':'';
    else { var G=[], mp={}; list.forEach(function(m){ var k=m.d.slice(0,2); if(!mp[k]){ mp[k]={m:k,a:[]}; G.push(mp[k]); } mp[k].a.push(m); });
      L.innerHTML=G.map(function(g,gi){ return '<div class="mm4-mh"><b>'+(+g.m)+' 月</b><small>'+g.a.length+'</small></div><div class="mm4-grp pg-rise" style="--i:'+gi+'">'+g.a.map(row).join('')+'</div>'; }).join(''); }
    if(!list.length) L.innerHTML='<div class="pg-empty">'+(q?'没找到「'+esc(q)+'」':'这里空空的')+'</div>';
    $('#mmHit',win).textContent=q?list.length+' 条':'';
    var fl=$('#mmFl',win), tags=[]; if(fs==='worth') tags.push('按值得记'); if(fs==='old') tags.push('从最早'); if(fs==='sunk') tags.push('已沉底');
    fl.innerHTML=tags.map(function(x){ return '<span>'+x+'</span>'; }).join('')+(tags.length?'<button class="tap" data-clr>清除</button>':''); fl.classList.toggle('on',!!tags.length);
  }
  /* [位置:phone-pages.js·memSetup seDef/seEff] [参与检索默认口径（共用）] [11-08：event 默认开、fact/rule 默认关；11-16 D2 从 detail 提到 memSetup 顶层，批量动作与编辑弹层共用同一口径——seEff(m)=存量没字段的按 kind 推默认] [注释时间 2026-11-16] */
  function seDef(k){ return k==='event'; }
  function seEff(m){ return m.se==null?seDef(m.k):m.se; }
  /* [位置:phone-pages.js·memSetup 多选底栏] [记忆列表批量置顶/沉底/参与检索] [11-13：列表加多选；底栏给置顶、沉底、参与检索、取消，不给彻底删除（沉底 7 天后自动删、可恢复）；串行提交，已成功的保留、失败的最后报数。11-16 D2 ：加「参与检索」批量动作，智能开关——选中项全部开着就整批关（按钮转「关检索」），否则整批开（同 11-14 供应商多选「看图/代理」的 pvBatchOn 模式）；存链路走单条 PUT entries/:id {search_enabled}（后端 11-08 起支持部分字段更新，已核对 routes/memory-v2-admin.js·PUT entries）] [注释时间 2026-11-16 改] */
  function seBatchOn(){ var ms=MEMS.filter(function(m){ return mmPick[m.id]; }); return !!ms.length&&ms.every(seEff); }
  function mmBar(){ var bar=$('#mmMbar',win); if(!bar) return; var n=Object.keys(mmPick).length; bar.hidden=!mmMulti; var fab=$('.mm-fab',win); if(fab) fab.style.display=mmMulti?'none':''; if(!mmMulti){ bar.innerHTML=''; return; }
    var seAll=seBatchOn();
    bar.innerHTML='<span class="n">已选 '+n+' 条</span><button class="tap" data-mm="pin" type="button"'+(n?'':' disabled')+'>置顶</button><button class="tap" data-mm="sink" type="button"'+(n?'':' disabled')+'>沉底</button><button class="tap" data-mm="se" type="button"'+(n?'':' disabled')+(seAll?' data-on="1"':'')+'>'+(seAll?'关检索':'参与检索')+'</button><button class="tap" data-mm="cancel" type="button">取消</button>'; }
  function mmApply(kind){ var ms=MEMS.filter(function(m){ return mmPick[m.id]; }); if(!ms.length) return; var done=0, bad=0, n=ms.length, seq=Promise.resolve(), seOn=false, LBL={pin:'置顶',sink:'沉底',se:'参与检索'};
    if(kind==='se') seOn=!seBatchOn();   /* 智能开关：全开→整批关，否则整批开 */
    toast(LBL[kind]+' '+n+' 条…');
    ms.forEach(function(m){ seq=seq.then(function(){
      var req=kind==='pin'?P.net.post(MB+'entries/'+encodeURIComponent(m.id)+'/pin',{pinned:true}):kind==='se'?P.net.req(MB+'entries/'+encodeURIComponent(m.id),{method:'PUT',body:{search_enabled:seOn}}):P.net.post(MB+'entries/'+encodeURIComponent(m.id)+'/status',{action:'archive'});
      return req.then(function(){ if(kind==='pin') m.pin=true; else if(kind==='se') m.se=seOn; else m.sunk=true; done++; },function(){ bad++; }); }); });
    seq.then(function(){ mmMulti=false; mmPick={}; var pb=$('#mmPickBtn',win); if(pb) pb.classList.remove('on'); paint(); mmBar(); toast(LBL[kind]+(kind==='se'?(seOn?' 已开 ':' 已关 '):'了 ')+done+' 条'+(bad?'，'+bad+' 条没成':'')); buzz(8); }); }
  $('#mmPickBtn',win).addEventListener('click',function(){ mmMulti=!mmMulti; mmPick={}; this.classList.toggle('on',mmMulti); paint(); mmBar(); buzz(6); });
  win.addEventListener('click',function(e){ var b=e.target.closest('[data-mm]'); if(!b) return; var k=b.dataset.mm;
    if(k==='cancel'){ mmMulti=false; mmPick={}; var pb2=$('#mmPickBtn',win); if(pb2) pb2.classList.remove('on'); paint(); mmBar(); return; } mmApply(k); });
  paint(); load(); loadQ();
  wire($('.pg',win),{back:function(){ closeWin(win); }});
  var kt=$('#mmK',win);
  function slide(){ var b=kt.querySelector('button.on'), i=kt.querySelector('i'); if(!b) return; i.style.width=b.offsetWidth-20+'px'; i.style.transform='translateX('+(b.offsetLeft+10)+'px)'; }
  kt.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; fk=b.dataset.k; Array.prototype.forEach.call(kt.querySelectorAll('button'),function(x){ x.classList.toggle('on',x===b); }); slide(); buzz(5); paint(); });
  requestAnimationFrame(slide);
  $('#mmFl',win).addEventListener('click',function(e){ if(!e.target.closest('[data-clr]')) return; fk=''; fs='recent'; Array.prototype.forEach.call(kt.querySelectorAll('button'),function(x){ x.classList.toggle('on',!x.dataset.k); }); slide(); Array.prototype.forEach.call($('#mmMenu',win).querySelectorAll('[data-s]'),function(x){ x.classList.toggle('on',x.dataset.s==='recent'); }); buzz(6); paint(); });
  var mqT=0;   /* [位置:phone-pages.js·mmQ 防抖] [搜索输入 120ms 合并] [2026-10-27 审查：每敲一字全列表 innerHTML 重建，中文输入法每个拼音组合都触发] [注释时间 2026-10-27] */
  $('#mmQ',win).addEventListener('input',function(){ q=this.value.trim(); clearTimeout(mqT); mqT=setTimeout(paint,120); });
  var menu=$('#mmMenu',win);
  $('#mmSort',win).addEventListener('click',function(e){ e.stopPropagation(); menu.classList.toggle('open'); buzz(5); });
  menu.addEventListener('click',function(e){ var b=e.target.closest('[data-s]'); if(!b) return; e.stopPropagation(); menu.classList.remove('open'); buzz(6); if(b.dataset.s==='sim'){ simGroups(); return; } fs=b.dataset.s; Array.prototype.forEach.call(menu.querySelectorAll('[data-s]'),function(x){ x.classList.toggle('on',x===b); }); paint(); });
  win.addEventListener('click',function(e){ if(!e.target.closest('#mmMenu')) menu.classList.remove('open'); });
  /* 左滑：置顶 / 沉底 */
  var sx=0, sy=0, cur=null, dx=0;
  function closeSw(except){ Array.prototype.forEach.call(L.querySelectorAll('.mm-sw.open'),function(x){ if(x!==except){ x.classList.remove('open'); x.querySelector('.mm-it2').style.transform=''; } }); }
  L.addEventListener('touchstart',function(e){ var s=e.target.closest('.mm-sw'); if(!s||mmMulti) return; cur=s; sx=e.touches[0].clientX; sy=e.touches[0].clientY; dx=0; closeSw(s); },{passive:true});
  L.addEventListener('touchmove',function(e){ if(!cur) return; var x=e.touches[0].clientX-sx, y=e.touches[0].clientY-sy; if(Math.abs(y)>Math.abs(x)&&!dx) { cur=null; return; } dx=Math.min(0,Math.max(-150,x+(cur.classList.contains('open')?-140:0))); var it=cur.querySelector('.mm-it2'); it.style.transition='none'; it.style.transform='translateX('+dx+'px)'; },{passive:true});
  L.addEventListener('touchend',function(){ if(!cur) return; var it=cur.querySelector('.mm-it2'); it.style.transition=''; if(dx<-60){ cur.classList.add('open'); it.style.transform='translateX(-140px)'; buzz(6); } else { cur.classList.remove('open'); it.style.transform=''; } cur=null; });
  L.addEventListener('click',function(e){
    /* [位置:phone-pages.js·memSetup 多选点击] [多选态点行 = 勾选/取消，不进详情] [11-13] [注释时间 2026-11-13] */
    if(mmMulti){ var sw0=e.target.closest('.mm-sw'); if(sw0&&sw0.dataset.mid){ var id0=sw0.dataset.mid; if(mmPick[id0]) delete mmPick[id0]; else mmPick[id0]=1; sw0.classList.toggle('sel',!!mmPick[id0]); mmBar(); buzz(5); } return; }
    var a=e.target.closest('.acts button');
    if(a){ var sw=a.closest('.mm-sw'), m=MEMS[+sw.dataset.i]; buzz(8);
      if(a.dataset.a==='pin'){ m.pin=!m.pin; mPin(m); toast(m.pin?'置顶了，每次都带上':'取消置顶'); closeSw(); setTimeout(paint,250); }
      else { m.sunk=!m.sunk; mSink(m); sw.classList.add('gone'); setTimeout(paint,330); toast(m.sunk?(live?'沉底了 · 7 天后自动删掉':'沉底了'):'恢复了'); }
      return; }
    var it=e.target.closest('.mm-it2'); if(!it) return; var sw2=it.closest('.mm-sw'); if(sw2.classList.contains('open')){ closeSw(); return; }
    detail(MEMS[+sw2.dataset.i]);
  });
  /* 点一条：全文可改；值得记的理由藏在 ⓘ 里 */
  function detail(m){
    buzz(6);
    function kw(x){ return '<span class="tr" data-kw>'+esc(x)+'</span>'; }
    var KS=['fact','rule','event'], ki=KS.indexOf(m.k), mk=KS[ki<0?0:ki];
    /* [位置:phone-pages.js·memSetup detail se] [参与检索开关（编辑页）] [需求:11-08：编辑弹层里直接勾选参与检索（event 默认开 fact/rule 默认关）；开着关键词行就显示（三类都能带词），关着收起；没手动动过开关时切分类跟随新分类默认值；切分类不再清关键词。11-16 批1 D3：关键词行不再单独占一行，并进门卫评价那行（见下方 mm-nw2 标签行）] [注释时间 2026-11-16 改] */
    var seTouched=false;
    var se=seEff(m);   /* se=编辑中的开关值（存量没字段的按 kind 推默认；seDef/seEff 11-16 从这里提到 memSetup 顶层，供批量「参与检索」共用同一口径） */
    /* [位置:phone-pages.js·detail 标签行] [评价与关键词合并一行] [11-16：门卫评价（SJ/VOL）后接 #关键词，同一行、字号一致；kwset 是关键词组容器（.mm-nw2 .kwset：display:contents 并入行内，参与检索关着整组隐藏、评价标签保留），编辑交互不变——box=.kwset，长按改、点＋加、关开关收起] [注释时间 2026-11-16] */
    sheet(win,'<span class="kn k-'+m.k+'">'+KN[m.k][0]+'</span><span class="mm-dd">'+m.d.replace('-','.')+'</span>','<textarea class="pg-in mm-ta">'+esc(m.t)+'</textarea>'+
      '<div class="mm-nw">'+seg(KS,ki<0?0:ki)+'</div>'+
      '<div class="mm-tags mm-nw2">'+(SJ[m.sj]?'<span>'+SJ[m.sj]+'</span>':'')+(VOL[m.vol]?'<span>'+VOL[m.vol]+'</span>':'')+'<span class="kwset'+(se?' on':'')+'">'+(se?(m.tr.map(kw).join('')+'<span class="tr add" data-addkw>＋</span>'):'')+'</span></div>'+
      '<div class="pg-g" style="margin-top:12px">'+r({t:'置顶',tg:1,on:m.pin,tgname:'pin'})+r({t:'参与检索'+hint('开着且有关键词，AI 检索能靠词召回这条；开了还没词的，会插队老数据重跑先补词'),tg:1,on:se,tgname:'mmse'})+(m.w==null?'':r({t:'值得记'+(m.wr?hint(esc(m.wr)):''),v:m.w.toFixed(2)}))+r({t:'来源'+hint(esc(live?srcWhy(m.o,m.pv,m.ts):'对话 · 主会话')),v:live?srcOf(m.o,m.pv,m.ts):'对话 · 主会话'})+'</div>'+
      '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn tap" data-x2="sink">'+(m.sunk?'恢复':'沉底')+'</button><button class="pg-btn pri tap" data-x2="sv">更新</button></div>',function(s,close){
      var box=s.querySelector('.kwset');   /* 11-16 D3：关键词组并进 .mm-tags 行里，容器从 .mm-kws 换成 .kwset（编辑/联动逻辑原样） */
      /* [位置:phone-pages.js·memSetup detail syncSe] [开关与关键词行联动] [需求:11-08：拨「参与检索」开关（或没碰过开关时切分类），关键词行平滑展开/收起；开着且行里没词时按原关键词重建] [注释时间 2026-11-08] */
      function seNow(sh){ var tg=sh.querySelector('[data-tg="mmse"]'); return !!(tg&&tg.classList.contains('on')); }
      function syncSe(sh){ se=seNow(sh); if(box){ box.classList.toggle('on',se); if(se&&!box.querySelector('[data-addkw]')) box.innerHTML=m.tr.map(kw).join('')+'<span class="tr add" data-addkw>＋</span>'; } }
      function edit(t){ if(!t||t.isContentEditable) return; t.contentEditable='true'; t.classList.add('ed'); t.focus(); var rg=document.createRange(); rg.selectNodeContents(t); var gsel=getSelection(); gsel.removeAllRanges(); gsel.addRange(rg); buzz([8,30,8]); }
      function addKw(){ if(!box||!seNow(s)) return; var d=document.createElement('div'); d.innerHTML=kw(''); var n=d.firstChild; box.insertBefore(n,box.querySelector('[data-addkw]')); edit(n); }
      /* 长按词进编辑（短按不响应，防误触）；点行尾虚线＋加一个；改空自动删；开关关着时关键词行收起，编辑入口一并关掉（三类都可带词，不再限 event） */
      if(box){
        hold(box,function(t){ if(!live||!seNow(s)) return; edit(t); },'[data-kw]');
        box.addEventListener('click',function(e){ if(!live||!seNow(s)) return; if(e.target.closest('[data-addkw]')){ addKw(); return; } if(e.target.closest('[data-kw]')) return; if(e.target===box) addKw(); });
        box.addEventListener('focusout',function(e){ var t=e.target.closest('[data-kw]'); if(!t) return; t.contentEditable='false'; t.classList.remove('ed'); t.textContent=t.textContent.replace(/^#+/,'').trim(); if(!t.textContent){ t.classList.add('gone'); setTimeout(function(){ t.remove(); },250); } });
        box.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); } });
      }
      s.addEventListener('click',function(e){
        /* [位置:phone-pages.js·memSetup detail 分类联动] [切分类同步标题] [需求:2026-11-08 分类可改：seg 点击后换 mk、标题 kn 跟着变色换字；11-08 起切分类不再清关键词、关键词行显隐只跟「参与检索」开关走——没碰过开关时切分类跟随新分类默认值] [注释时间 2026-11-08] */
        var sg=e.target.closest('[data-seg]');
        if(sg){ var nk=KS[+sg.dataset.seg]||'fact';
          if(nk!==mk){ mk=nk; var kn2=s.querySelector('.sh .kn'); if(kn2){ kn2.className='kn k-'+nk; kn2.textContent=nk; }
            if(!seTouched){ var tg0=s.querySelector('[data-tg="mmse"]'); if(tg0){ tg0.classList.toggle('on',seDef(nk)); tg0.setAttribute('aria-checked',seDef(nk)?'true':'false'); } syncSe(s); } }
          return; }
        /* 拨「参与检索」开关：标记已手动动过（之后切分类不再代管），并联动关键词行显隐 */
        if(e.target.closest('[data-tg="mmse"]')){ seTouched=true; setTimeout(function(){ syncSe(s); },0); }
        var b=e.target.closest('[data-x2]'); if(!b) return; var k=b.dataset.x2, n;
        if(k==='sv'&&live){ var nt=s.querySelector('textarea').value.trim(), np=s.querySelector('[data-tg="pin"]').classList.contains('on'), ns=seNow(s); if(!nt){ buzz([20,30,20]); return; } b.classList.add('busy');
          var ntr=(ns&&box)?[].map.call(box.querySelectorAll('[data-kw]:not(.gone)'),function(x){ return x.textContent.trim(); }).filter(Boolean):null;
          var body={content:nt,pinned:np,category:mk,search_enabled:ns}; if(ntr) body.triggers=ntr;
          P.net.req(MB+'entries/'+encodeURIComponent(m.id),{method:'PUT',body:body}).then(function(r2){ var en=(r2&&r2.entry)||{}; m.t=en.text||nt; m.pin=np; m.k=en.kind||mk; m.tr=Array.isArray(en.triggers)?en.triggers.slice():(m.tr||[]); m.se=en.search_enabled!==undefined?!!en.search_enabled:ns; close(); paint(); var n2=L.querySelector('[data-i="'+MEMS.indexOf(m)+'"]'); if(n2) n2.classList.add('flash'); toast('更新好了'); buzz(8); },function(){ b.classList.remove('busy'); toast('没存上'); buzz([20,30,20]); }); return; }
        if(k!=='sv'){ m.sunk=!m.sunk; mSink(m); close(); n=L.querySelector('[data-i="'+MEMS.indexOf(m)+'"]'); if(n) n.classList.add('gone'); setTimeout(paint,340); toast(m.sunk?(live?'沉底了 · 7 天后自动删掉':'沉底了'):'恢复了'); buzz(8); }   /* [2026-11-17 批5 清理] 原来 k==='sv' 还有一段 !live 的假保存死分支（只改内存就 toast「更新好了」，不落服务器）：detail 唯一入口是 MEMS 列表行（:1968），MEMS 非空必经 load() 成功（live=true），该分支不可达，删 */
      });
    });
  }
  /* 待审：通过 / 改一下 / 不要 */
  /* [位置:phone-pages.js·memSetup review] [名称:待审队列分批渲染 + 按条局部更新] [需求:11-05「待审页特别卡顿、按钮点好几下才响应、驳回一条整页刷很久」——根因是 118 张卡一次全建(布局 180~540ms)、阶梯动画第 118 张延迟 5.2s、通过一条重拉 486 条记忆池全量、父级 blur(30px) 全屏重算；改为每批 30 条 + 屏外 content-visibility + 阶梯封顶 6 + 按 data-id 局部增删 + 通过后本地入池不重拉 + 本子页去模糊] [注释时间 2026-11-05] */
  function review(){
    /* [位置:phone-pages.js·review 来源] [待审卡用统一来源标签] [需求:11-06：原来这里是一张只有 4 个值的小表，promotion 一律显示「压缩块」，且「老数据重跑」永远命中不了（前端拿 origin 查表，重跑的 origin 也是 promotion）；改为与记忆池详情共用 srcOf，重跑/衰减按 backfill 动作单独标] [注释时间 2026-11-06] */
    var REL={duplicate:'重复',update:'更新',contradiction:'矛盾',coexist:'可共存',need_review:'待定'}, VOLN={stable:'基本不会',volatile:'可能会',situational:'一次性'}, BFA={update:'润色',supplement:'补充',merge:'合并',create:'补抽',sink:'建议沉底',decay:'衰减复查',label:'补标签'};
    var PAGE=30;   /* [位置:phone-pages.js·review PAGE] [每批渲染条数] [30 条一次布局约 19ms，118 条一次 180ms+；滚到底前 700px 自动接下一批] [注释时间 2026-11-05] */
    var multi=false, pick={}, shown=0, sent=null, io=null;
    var RVI={no:svg('<path d="M6 6l12 12M18 6 6 18"/>'),ed:svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>'),ok:svg('<path d="m5 12 4.5 4.5L19 7"/>')};
    var s=sub(win,'待审 <span class="rv-n" id="rvN">'+QUEUE.length+'</span>','<div id="mmRv"></div>',{right:'<button class="pg-cb tap" data-act="multi" aria-label="多选">'+svg('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>')+'</button>',act:function(k,t){ if(k!=='multi') return; multi=!multi; pick={}; t.classList.toggle('on',multi); s.classList.toggle('multi',multi); markSel(); bar(); }});
    s.classList.add('rvpg');   /* 本子页去掉父级 blur(30px)；多选的勾选圈 / 底部按钮 / 更换分类按钮由 CSS 按 .multi 显隐，切多选零重建 */
    var box=s.querySelector('#mmRv'), sc=s.querySelector('.pg-sc');
    /* [位置:phone-pages.js·review scroll 兜底] [滚动到底接下一批] [IntersectionObserver 在部分环境下回调有延迟（headless / 低端机掉帧），滚动事件里再补一次检查，两个机制都调 more()，more() 自身幂等] [注释时间 2026-11-05] */
    var scT=0; sc.addEventListener('scroll',function(){ if(scT) return; scT=setTimeout(function(){ scT=0; checkFill(); },30); },{passive:true});
    function card(x,i,anim){ var j=x.j, bf=x.bf;
      return '<div class="rv2 rv3'+(anim?' pg-rise':'')+(multi&&pick[x.id]?' sel':'')+'"'+(anim?' style="--i:'+Math.min(i,5)+'"':'')+' data-id="'+esc(x.id)+'">'+
        '<div class="rv2-m"><span class="kn k-'+(x.k||'none')+'">'+(x.k||'未分类')+'</span><span class="src">'+(bf?(bf.a==='decay'?SRC.decay:SRC.bf):srcOf(x.o,x.pv,x.ts))+' · '+x.at+'</span><i class="ck">'+I.ok+'</i></div>'+
        '<p class="rv2-t">'+esc(x.t)+'</p>'+
        /* [位置:phone-pages.js·review card] [待审卡显示关键词] [需求:11-06：待审卡也要看得到关键词；点一下不动，长按进编辑底板改词（不用先通过）] [注释时间 2026-11-06] */
        ((x.tr&&x.tr.length)?('<div class="rv2-kw">'+x.tr.slice(0,5).map(function(t){ return '<span class="tr" data-kwt>'+esc(t)+'</span>'; }).join('')+(x.tr.length>5?('<span class="more">+'+(x.tr.length-5)+'</span>'):'')+'</div>'):'')+
        (bf?'<div class="rv3-s"><h6>'+(BFA[bf.a]||bf.a)+(bf.n?' · '+bf.n+' 条':'')+'</h6>'+(bf.a==='sink'?'<small>通过 = 这条记忆直接沉底归档，不再出现在池里'+(bf.why?' · '+esc(bf.why):'')+'</small>':'<p class="old">'+esc(bf.old)+'</p><small>'+esc(bf.why)+'</small>')+'</div>':'')+
        (j?'<div class="rv3-s rv3-ev"><div><h6>值得记</h6><b>'+Math.round(j.w*100)+'<i>%</i></b><small>'+esc(j.wr)+'</small></div><div><h6>会不会过时</h6><b>'+(VOLN[j.v]||j.v)+'</b><small>'+esc(j.vr)+'</small></div></div>':'<div class="rv3-s"><h6>评估</h6><small>还没评估</small></div>')+
        (j&&j.sk&&j.sk!==x.k?'<div class="rv3-s rv3-sg"><div><h6>建议分类</h6><b class="kn k-'+j.sk+'">'+j.sk+'</b><small>'+esc(j.skr)+'</small></div><button class="tap" data-r="sk">更换</button></div>':'')+
        /* [位置:phone-pages.js·review card 相似] [相似记忆默认展开] [需求:11-06：相似记忆默认收起，要看到内容得先点一下；判重判改最需要看的正是这部分，改成默认展开、点标题才收起] [注释时间 2026-11-06] */
        (x.sim.length?'<div class="rv3-s"><button class="rv2-sh open" data-r="sim" type="button">相似 '+x.sim.length+' 条<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button><div class="rv2-sim open"><div>'+x.sim.map(function(m,k){ return '<div class="si'+(m.sunk?' sunk':'')+'" data-k="'+k+'"><p>'+esc(m.t)+'</p><div class="sb"><span class="rel r-'+m.rel+'">'+(REL[m.rel]||m.rel)+'</span><span>'+m.sc.toFixed(2)+'</span><button class="tap" data-r="sink"'+(m.sunk?' disabled':'')+'>'+(m.sunk?'已沉底':'沉底')+'</button></div><small class="why">'+esc(m.why)+'</small></div>'; }).join('')+'</div></div></div>':'')+
        '<div class="rv2-bt"><button class="tap" data-r="no">'+RVI.no+'驳回</button><button class="tap" data-r="ed">'+RVI.ed+'编辑</button><button class="tap ok" data-r="ok">'+RVI.ok+(bf&&bf.n?'通过 · 旧沉':'通过')+'</button></div>'+
      '</div>'; }
    function el(x){ var ls=box.querySelectorAll('.rv2'); for(var i=0;i<ls.length;i++){ if(ls[i].dataset.id===x.id) return ls[i]; } return null; }
    function repl(x){ var n=el(x); if(!n) return null; var t=document.createElement('div'); t.innerHTML=card(x,0,false); var nn=t.firstChild; n.replaceWith(nn); return nn; }
    function markSel(){ var ls=box.querySelectorAll('.rv2'); for(var i=0;i<ls.length;i++) ls[i].classList.toggle('sel',!!pick[ls[i].dataset.id]); }
    function watch(t){
      if(!('IntersectionObserver' in window)){ more(); return; }   /* 老浏览器退化成一次全排 */
      if(!io) io=new IntersectionObserver(function(es){ for(var i=0;i<es.length;i++) if(es[i].isIntersecting){ more(); return; } },{root:sc,rootMargin:'700px 0px'});
      io.observe(t);
    }
    function more(){
      if(sent){ if(io) io.unobserve(sent); sent.remove(); sent=null; }
      if(shown>=QUEUE.length) return;
      var i, end=Math.min(shown+PAGE,QUEUE.length), h='';
      for(i=shown;i<end;i++) h+=card(QUEUE[i],i-shown,i-shown<6);   /* 每批只有前 6 张走入场上浮，屏外那堆不再各跑一条 0.55s 动画 */
      shown=end;
      box.insertAdjacentHTML('beforeend',h);
      if(shown<QUEUE.length){ sent=document.createElement('div'); sent.className='rv-sent'; sent.setAttribute('aria-hidden','true'); box.appendChild(sent); watch(sent); }
    }
    function checkFill(){ if(!sent) return; var r=sent.getBoundingClientRect(), r2=sc.getBoundingClientRect(); if(r.top<r2.bottom+700) more(); }
    function paintQ(){ shown=0; if(io){ io.disconnect(); io=null; } sent=null; box.innerHTML='';
      if(!QUEUE.length){ box.innerHTML='<div class="pg-empty">都审完了 ✦</div>'; bar(); return; }
      more(); bar(); }
    function count(){ var b=$('#mmQ2',win); b.textContent=QUEUE.length; b.classList.toggle('done',!QUEUE.length); }
    /* [位置:phone-pages.js·review paintN] [待审标题旁数字] [需求:11-08：待审标题旁实时显示队列条数，轮询回来就刷] [注释时间 2026-11-08] */
    function paintN(){ var el=s.querySelector('#rvN'); if(el) el.textContent=QUEUE.length; }
    /* [位置:phone-pages.js·memQueue decide] [按元素引用批候选] [2026-10-27 审查 P0：通过/驳回延迟 380ms 后
       才执行，原来传的是点击瞬间的下标——380ms 里前一张已 splice 掉一条，队列整体前移，第二张会批到别的候选上
      （服务端 approve/reject 错 id），下标越界时 TypeError 卡死整段回调。改成传候选对象本身，删除按引用定位]
       [2026-11-05：改成返回 Promise 供串行批量裁决；成功通过不再 load() 重拉记忆池，本地并进 MEMS] [注释时间 2026-11-05] */
    /* [位置:phone-pages.js·decide rvResolved] [本地裁决过的 id 不因轮询回填] [需求:11-08：轮询合并以本地为准——裁决成功（approve/reject 都算）的记录即使下一帧接口还带着也不加回队列] [注释时间 2026-11-08] */
    var rvResolved={};
    function decide(x,ok){
      if(!live) return Promise.resolve(true);
      return P.net.post(RQ+'/'+encodeURIComponent(x.id)+'/'+(ok?'approve':'reject'),ok&&x.k&&x.k!==x.k0?{edit:{kind:x.k}}:{}).then(function(r){ rvResolved[x.id]=1; if(ok) addLocal(x,r&&r.entry_id); return true; },function(){ return false; });
    }
    /* [位置:phone-pages.js·review addLocal/schedulePaint] [通过后本地入池] [原来 decide 成功就 load() 重拉 486 条 / 500KB 并重画 191 条列表，而这份列表此时被待审页盖着、看不见；改成只往 MEMS 头插一条，空闲时再重画一次] [注释时间 2026-11-05] */
    var memDirty=false, memPending=false;
    function addLocal(x,eid){
      if(x.bf&&x.bf.ids&&x.bf.ids.length){ for(var i=0;i<MEMS.length;i++) if(x.bf.ids.indexOf(MEMS[i].id)>=0) MEMS[i].sunk=true; }
      var d=new Date(), p2=function(n){ return (n<10?'0':'')+n; };
      /* 2026-11-06：tr 原来写死空数组——通过一条带关键词的记忆，词会当场消失、刷新才回来；连同来源一起带上。
         2026-11-08：sj 原来写死 'user'——rule 候选带「关于谁」（toward_user/about_user/self_discipline）通过后，本地详情标签会错到手动刷新；改用候选自带的 direction */
      MEMS.unshift({id:eid||('local_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)),k:x.k||'fact',t:x.t,w:x.j?x.j.w:.7,wr:x.j?x.j.wr:'',vol:x.j?x.j.v:'stable',sj:x.sj||'',tr:(x.tr||[]).slice(),pin:false,d:p2(d.getMonth()+1)+'-'+p2(d.getDate()),ts:d.toISOString(),sunk:false,o:x.o||'',pv:x.pv||null,se:x.se===null||x.se===undefined?(x.k==='event'):x.se});
      schedulePaint();
    }
    function schedulePaint(){ memDirty=true; if(memPending) return; memPending=true;
      var run=function(){ memPending=false; if(!memDirty) return; memDirty=false; paint(); };
      if(window.requestIdleCallback) requestIdleCallback(run,{timeout:2500}); else setTimeout(run,1200); }
    function bar(){ var b=s.querySelector('.rv2-bar'), n=Object.keys(pick).length;
      if(!multi){ if(b){ b.classList.remove('show'); setTimeout(function(){ b.remove(); },300); } return; }
      if(!b){ b=document.createElement('div'); b.className='st2-bar rv2-bar'; s.appendChild(b); requestAnimationFrame(function(){ b.classList.add('show'); });
        b.addEventListener('click',function(e){ var x=e.target.closest('[data-b]'); if(!x) return; var k=x.dataset.b, ids=Object.keys(pick);
          if(k==='all'){ var all=QUEUE.every(function(q){ return pick[q.id]; }); pick={}; if(!all) QUEUE.forEach(function(q){ pick[q.id]=1; }); buzz(6); markSel(); bar(); return; }
          if(!ids.length){ toast('先点选'); buzz([12,30,12]); return; }
          confirmBox(win,(k==='ok'?'通过 ':'驳回 ')+ids.length+' 条？',k==='ok'?'进记忆池，之后在列表里能看到。':'驳回后从队列移除，不能恢复。',k==='ok'?'通过':'驳回',k!=='ok',function(){
            /* 2026-11-05：原来 20 条并发打 20 个 POST、每条成功又各重拉一次全量；改成乐观移除 + 串行裁决 + 只在最后收口一次 */
            var want={}, list=QUEUE.filter(function(q){ return pick[q.id]; });
            list.forEach(function(q){ want[q.id]=1; });
            QUEUE=QUEUE.filter(function(q){ return !want[q.id]; });
            pick={}; multi=false; s.classList.remove('multi'); s.querySelector('[data-act="multi"]').classList.remove('on');
            Array.prototype.forEach.call(box.querySelectorAll('.rv2.sel'),function(n){ n.dataset.bulk='1'; n.classList.add(k==='ok'?'yes':'no'); });
            setTimeout(function(){ Array.prototype.forEach.call(box.querySelectorAll('[data-bulk]'),function(n){ n.remove(); }); if(!QUEUE.length) paintQ(); else checkFill(); },340);
            count(); bar();
            var ii=0, bad=0;
            (function next(){ if(ii>=list.length){ if(bad){ toast('有 '+bad+' 条没处理成，刷回来了'); loadQ().then(paintQ); } else { toast(k==='ok'?'收进记忆池了':'驳回了'); buzz([8,30,8]); } return; }
              decide(list[ii++],k==='ok').then(function(g){ if(!g) bad++; next(); }); })();
          }); }); }
      var RB={all:svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),n:svg('<path d="M4 7h16M4 12h10M4 17h7"/>'),ok:svg('<path d="m5 12 4.5 4.5L19 7"/>'),no:svg('<path d="M6 6l12 12M18 6 6 18"/>')};
      b.innerHTML='<button class="tap" data-b="all">'+RB.all+'全选</button><span class="n">'+RB.n+'已选 '+n+'</span><button class="tap'+(n?'':' dis')+'" data-b="ok">'+RB.ok+'通过</button><button class="tap no'+(n?'':' dis')+'" data-b="no">'+RB.no+'驳回</button>';
    }
    paintQ();
    /* [位置:phone-pages.js·review 轮询] [待审数字实时 + 评分回填局部更新] [需求:11-08：门卫后台评分是在攒满一批后一次跑完的，开着的待审页要能看到——8 秒轮询队列（只在子页开着期间跑，关页即停）；标题旁数字实时；已有卡片评分/状态变了按 data-id 局部替换（复用 repl，不打断正在点的操作）；新入队的追加到队尾并补渲染；本地裁决过的 id 不回填] [注释时间 2026-11-08] */
    var rvTimer=0, rvDead=false;
    function rvStop(){ if(rvTimer){ clearInterval(rvTimer); rvTimer=0; } }
    (s.__phOnClose=s.__phOnClose||[]).push(function(){ rvDead=true; rvStop(); });
    function rvTick(){
      if(rvDead||!s.isConnected||!s.classList.contains('show')){ rvStop(); return; }
      P.net.get(RQ).then(function(r2){
        if(rvDead||!s.isConnected||!s.classList.contains('show')){ rvStop(); return; }
        var fresh=((r2&&r2.items)||[]).map(qFrom);
        var byId={}; fresh.forEach(function(x){ byId[x.id]=x; });
        var wasEmpty=QUEUE.length===0, added=0;
        QUEUE.forEach(function(x,i){
          var f=byId[x.id]; if(!f) return;
          var sig1=JSON.stringify(x.j||null)+(x.js||''), sig2=JSON.stringify(f.j||null)+(f.js||'');
          if(sig1!==sig2){ QUEUE[i]=f; if(i<shown){ var n2=repl(f); if(n2) n2.classList.add('flash'); } }
        });
        fresh.forEach(function(f){
          for(var i=0;i<QUEUE.length;i++) if(QUEUE[i].id===f.id) return;
          if(rvResolved[f.id]) return;
          QUEUE.push(f); added++;
        });
        if(QUEUE.length!==+s.querySelector('#rvN').textContent||added||wasEmpty){ count(); paintN(); }
        if(added&&wasEmpty) paintQ();          /* 从空态恢复列表 */
        else if(added&&shown<QUEUE.length) checkFill();   /* 屏外还有没渲染的，接着补 */
      },function(){});
    }
    rvTimer=setInterval(rvTick,8000);
    /* [位置:phone-pages.js·review 关键词长按] [待审卡长按关键词改词] [需求:11-06：看到关键词不对不用先通过再改；长按 0.48 秒开编辑底板，关掉自动存（走 queue/:id/edit，后端本次起接受 triggers）] [注释时间 2026-11-06] */
    hold(box,function(el){
      var c=el.closest('.rv2'); if(!c) return;
      var x=null; for(var i=0;i<QUEUE.length;i++) if(QUEUE[i].id===c.dataset.id){ x=QUEUE[i]; break; }
      if(!x) return;
      buzz([10,30,10]);
      kwSheet(win,'关键词',x.tr,function(v,fail){
        P.net.post(RQ+'/'+encodeURIComponent(x.id)+'/edit',{triggers:v}).then(function(){ x.tr=v; x.triggers=v; var n=repl(x); if(n) n.classList.add('flash'); toast('改好了'); buzz(8); },function(){ fail(); });
      });
    },'[data-kwt]');
    box.addEventListener('click',function(e){ var c=e.target.closest('.rv2'); if(!c) return;
      var i, x=null; for(i=0;i<QUEUE.length;i++) if(QUEUE[i].id===c.dataset.id){ x=QUEUE[i]; break; } if(!x) return;
      if(multi){ if(e.target.closest('.pv-i')) return; if(pick[x.id]) delete pick[x.id]; else pick[x.id]=1; c.classList.toggle('sel',!!pick[x.id]); buzz(5); bar(); return; }
      var b=e.target.closest('[data-r]'); if(!b) return; var k=b.dataset.r;
      if(k==='sim'){ b.classList.toggle('open'); b.nextElementSibling.classList.toggle('open'); buzz(5); return; }
      if(k==='sink'){ var si=b.closest('.si'), m=x.sim[+si.dataset.k]; confirmBox(win,'沉底这条记忆？','沉底后不再参与检索浮现。','沉底',true,function(){ m.sunk=1; if(live&&m.id){ P.net.post(MB+'entries/'+encodeURIComponent(m.id)+'/status',{action:'archive'}).then(function(){ for(var z=0;z<MEMS.length;z++) if(MEMS[z].id===m.id) MEMS[z].sunk=true; },function(){ toast('没沉成'); }); } si.classList.add('sunk'); b.textContent='已沉底'; b.disabled=true; toast('已沉底'); buzz(8); }); return; }
      if(k==='sk'){ x.k=x.j.sk; buzz(6); var n1=repl(x); if(n1) n1.classList.add('flash'); toast('分类换成 '+x.k); return; }
      /* [位置:phone-pages.js·review 编辑候选] [待审编辑弹层带参与检索开关] [需求:11-08：编辑页里都要有开关（列表/新增/待审三处齐）；event 默认开 fact/rule 默认关，随 edit 接口落 draft] [注释时间 2026-11-08] */
      if(k==='ed'){ var ki=['fact','rule','event'].indexOf(x.k); var ese=x.se===null||x.se===undefined?(x.k==='event'):x.se;
        sheet(win,'编辑候选',seg(['fact','rule','event'],ki<0?0:ki)+'<textarea class="pg-in" style="min-height:150px;margin-top:12px">'+esc(x.t)+'</textarea><div class="pg-g" style="margin-top:12px">'+r({t:'参与检索'+hint('开着且有关键词，AI 检索能靠词召回这条；开了还没词的，会插队老数据重跑先补词'),tg:1,tgname:'edse',on:ese})+'</div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-sv>保存</button></div>',function(sh,close){
          sh.querySelector('[data-sv]').addEventListener('click',function(){ var kk=+getComputedStyle(sh.querySelector('.pg-seg')).getPropertyValue('--k')||0; var etg=sh.querySelector('[data-tg="edse"]'); var es=!!(etg&&etg.classList.contains('on')); x.k=['fact','rule','event'][kk]; x.t=sh.querySelector('textarea').value.trim()||x.t; x.se=es; if(live) P.net.post(RQ+'/'+encodeURIComponent(x.id)+'/edit',{text:x.t,kind:x.k,search_enabled:es}).then(function(){ x.k0=x.k; },function(){ toast('没存上'); loadQ().then(paintQ); }); close(); var n2=repl(x); if(n2) n2.classList.add('flash'); toast('改好了'); buzz(8); }); }); return; }
      /* 乐观更新：立刻滑走、计数 -1、出队；请求失败再整队拉回来 */
      var ok=k==='ok', qi=QUEUE.indexOf(x); c.classList.add(ok?'yes':'no'); buzz(ok?[8,30,8]:10);
      if(qi>=0) QUEUE.splice(qi,1); count();
      setTimeout(function(){ if(c.parentNode) c.remove(); if(!QUEUE.length) paintQ(); else checkFill(); },340);
      decide(x,ok).then(function(good){
        if(!good){ toast('有一条没处理成，刷回来了'); loadQ().then(paintQ); return; }
        toast(ok?(x.bf&&x.bf.a==='sink'?'沉底了，池里不再有它':(x.bf&&x.bf.n?'收下了，旧的 '+x.bf.n+' 条沉底':'收进记忆池了')):'驳回了');
      });
    });
  }
  /* [位置:phone-pages.js·memSetup addMem] [手动新增记忆] [需求:11-06：记忆池没有新增入口，要能自己写一条；手写直通入库（不让她再审自己），池里已有很像的先问一句，入库后后台静默补评分] [11-08：加「参与检索」开关（event 默认开 fact/rule 默认关），关键词行跟随开关显隐（三类都能带词）] [注释时间 2026-11-06] */
  function addMem(){
    if(!live){ toast('还没连上后台'); return; }
    var kind='fact', nwSe=false, nwTouched=false;   /* nwSe=开关当前值（默认分类 fact=关）；nwTouched=手动动过就不再随分类代管 */
    sheet(win,'写一条记忆',
      '<textarea class="pg-in mm-ta" id="nwT" placeholder="想让我记住什么"></textarea>'+
      '<div class="mm-nw" id="nwK">'+seg(['fact','rule','event'],0)+'</div>'+
      '<div class="mm-kws nw-kw" id="nwW"><span class="tr add" data-addkw>＋</span></div>'+
      '<div class="pg-g" style="margin-top:8px">'+r({t:'置顶',tg:1,tgname:'nwpin'})+r({t:'参与检索'+hint('开着且有关键词，AI 检索能靠词召回这条；开了还没词的，会插队老数据重跑先补词'),tg:1,tgname:'nwse'})+'</div>'+
      '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-nw>加进去</button></div>',function(sh,close){
      var ta=sh.querySelector('#nwT'), kbox=sh.querySelector('#nwK'), wbox=sh.querySelector('#nwW'), btn=sh.querySelector('[data-nw]');
      /* [位置:phone-pages.js·addMem nwSync] [开关与关键词行联动] [需求:11-08：拨「参与检索」开关或切分类后同步关键词行显隐；初始按默认分类 fact=关（行收起）] [注释时间 2026-11-08] */
      function nwSync(){ var tg=sh.querySelector('[data-tg="nwse"]'); nwSe=!!(tg&&tg.classList.contains('on')); wbox.classList.toggle('on',nwSe); if(nwSe&&!wbox.querySelector('[data-addkw]')) wbox.insertAdjacentHTML('afterbegin','<span class="tr add" data-addkw>＋</span>'); }
      (function(){ var tg=sh.querySelector('[data-tg="nwse"]'); if(tg){ tg.parentNode.classList.remove('on'); tg.setAttribute('aria-checked','false'); } wbox.classList.remove('on'); })();
      function kwEdit(t){ if(!t||t.isContentEditable) return; t.contentEditable='true'; t.classList.add('ed'); t.focus(); var rg=document.createRange(); rg.selectNodeContents(t); var gsel=getSelection(); gsel.removeAllRanges(); gsel.addRange(rg); buzz([8,30,8]); }
      hold(wbox,function(t){ kwEdit(t); },'[data-kw]');
      wbox.addEventListener('click',function(e){ if(!e.target.closest('[data-addkw]')) return; var d=document.createElement('div'); d.innerHTML='<span class="tr" data-kw></span>'; var n=d.firstChild; wbox.insertBefore(n,wbox.querySelector('[data-addkw]')); kwEdit(n); });
      wbox.addEventListener('focusout',function(e){ var t=e.target.closest('[data-kw]'); if(!t) return; t.contentEditable='false'; t.classList.remove('ed'); t.textContent=t.textContent.replace(/^#+/,'').trim(); if(!t.textContent){ t.classList.add('gone'); setTimeout(function(){ t.remove(); },250); } });
      wbox.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); } });
      /* 关键词行跟随「参与检索」开关（三类都能带词，不再只 event）；开关没被手动动过时，切分类跟随新分类默认值 */
      /* [位置:phone-pages.js·addMem 分类联动] [切分类联动开关与关键词行] [需求:11-08：切分类时没碰过开关就按新分类默认（event 开 / 其余关）代管；关键词行 max-height 过渡展开收起] [注释时间 2026-11-08] */
      kbox.addEventListener('click',function(e){ var b=e.target.closest('[data-seg]'); if(!b) return; kind=['fact','rule','event'][+b.dataset.seg]||'fact';
        if(!nwTouched){ var want=kind==='event'; var tg=sh.querySelector('[data-tg="nwse"]'); if(tg){ tg.classList.toggle('on',want); tg.setAttribute('aria-checked',want?'true':'false'); } }
        nwSync(); });
      sh.addEventListener('click',function(e){ if(e.target.closest('[data-tg="nwse"]')){ nwTouched=true; setTimeout(nwSync,0); } });
      function go(force){
        var txt=ta.value.trim();
        if(!txt){ buzz([20,30,20]); ta.focus(); return; }
        nwSync();
        var tr=[].map.call(wbox.querySelectorAll('[data-kw]:not(.gone)'),function(x){ return x.textContent.trim(); }).filter(Boolean);
        var body={content:txt,category:kind,pinned:sh.querySelector('[data-tg="nwpin"]').classList.contains('on'),direct:true,search_enabled:nwSe};
        if(nwSe&&tr.length) body.triggers=tr;
        if(force) body.force=true;
        if(btn.dataset.busy) return;
        btn.dataset.busy='1'; btn.classList.add('busy');
        P.net.post(MB+'entries',body).then(function(res){
          delete btn.dataset.busy; btn.classList.remove('busy');
          var e=res&&res.entry;
          close();
          if(e){ MEMS.unshift(mFrom(e)); }
          paint();
          var n2=L.querySelector('[data-i="0"]'); if(n2) n2.classList.add('flash');
          $('#mmQ',win).placeholder='在 '+MEMS.filter(function(m){ return !m.sunk; }).length+' 条里找';
          toast('加进去了'); buzz([8,30,8]);
          setTimeout(function(){ if(win.isConnected) load(); },2500);   /* 后台评分回来后静默刷一次 */
        },function(err){
          delete btn.dataset.busy; btn.classList.remove('busy');
          if(err&&err.status===409&&err.body&&err.body.similar&&err.body.similar.length){
            var hit=err.body.similar[0];
            confirmBox(win,'池里已经有一条很像的','「'+String(hit.text||'').slice(0,40)+(String(hit.text||'').length>40?'…':'')+'」 '+Math.round((hit.score||0)*100)+'% 像。还加吗？','还是要加',false,function(){ go(true); });
            return;
          }
          /* 后端没重启时会回 400（旧版只认 fact/rule），把原因说出来，别让人对着"没加进去"猜 */
          toast((err&&err.body&&err.body.error)?('没加进去：'+String(err.body.error).slice(0,40)):'没加进去');
        });
      }
      btn.addEventListener('click',function(){ go(false); });
    });
  }
  /* 滚动时悬浮＋轻微收起，停下回弹（避免挡内容又始终保持可点） */
  var fab=$('#mmAdd',win), scpg=$('.pg-sc',win), fabT=0;
  if(fab&&scpg){ scpg.addEventListener('scroll',function(){ if(!fab) return; fab.classList.add('dim'); clearTimeout(fabT); fabT=setTimeout(function(){ fab.classList.remove('dim'); },420); },{passive:true}); fab.addEventListener('click',function(){ buzz(6); addMem(); }); }
  /* 相似的放一起看（/admin/memory-v2/similar-groups，阈值 0.85） */
  function simGroups(){ if(live){ simLive(); return; }
    toast('没连上后台，读不到相似分组');
  }
  $('#mmQ2',win).addEventListener('click',function(){ buzz(6); review(); });
  $('#mmPin',win).addEventListener('click',function(e){ var t=e.target.closest('.mm4-pt'); if(t){ pinOpen=!pinOpen; t.classList.toggle('open',pinOpen); t.setAttribute('aria-expanded',pinOpen); t.nextElementSibling.classList.toggle('open',pinOpen); buzz(5); return; } var c=e.target.closest('.mm4-pc'); if(c) detail(MEMS[+c.dataset.i]); });
  /* 右上设置 */
  $('#mmSet',win).addEventListener('click',function(){ buzz(6); if(live){ setLive(); return; } toast('没连上后台，读不到设置'); });
  /* 相似的放一起看：/admin/memory-v2/similar-groups?th=，只看 active；点「沉底」= archive */
  function simLive(){
    /* [位置:phone-pages.js·simLive seWhy] [503 原因翻译] [11-16 D5：原来 e.status===503 一律显示「向量服务没开」，但向量服务进程一直活着——503 实际来自 embed 熔断（任何一次算向量失败→60 秒冷却）或「没有可用 embedding 供应商」（如 硅基流动体验 被停用后没有其他 embeddings 服务商）；后端现在把真实原因带在 body.reason（见 routes/memory-v2-admin.js·similar-groups 503），前端如实显示] [注释时间 2026-11-16] */
    function seWhy(r){ r=String(r||''); if(/provider unavailable/i.test(r)) return '：没有可用的向量供应商（在配置页启用一个 embeddings 服务商后再试）'; if(/timeout/i.test(r)) return '：刚才算向量超时了，等一分钟再试'; return r?('：'+r.slice(0,60)):'，稍后再试'; }
    var pg=sub(win,'相似的记忆','<div class="mm-th"><span>相似度</span><div class="pg-sl" style="flex:1"><input type="range" min=".5" max=".99" step=".01" value=".85" id="simTh"></div><em>0.85</em></div><div id="simB"><div class="pg-empty"><i class="pg-spin"></i></div></div>');
    var B=pg.querySelector('#simB'), th=pg.querySelector('#simTh');
    function go(){ B.innerHTML='<div class="pg-empty"><i class="pg-spin"></i></div>'; P.net.get(MB+'similar-groups?th='+(+th.value).toFixed(2)).then(function(r2){ var gs=(r2&&r2.groups)||[];
        B.innerHTML=gs.length?gs.map(function(g,gi){ return '<div class="pg-gt">'+Math.round((g.max_sim||0)*100)+'% 像</div><div class="pg-g pg-rise" style="--i:'+gi+'">'+(g.items||[]).map(function(it){ return '<div class="mm-si" data-id="'+esc(it.id)+'"><p>'+esc(it.text||'')+'</p><button class="tap" type="button" data-sk>沉底</button></div>'; }).join('')+'</div>'; }).join(''):'<div class="pg-empty">这个相似度下没有挨得很近的</div>'; },function(e){ var rs=(e&&e.body&&e.body.reason)||''; B.innerHTML='<div class="pg-empty">'+(e&&e.status===503?('向量服务连不上'+seWhy(rs)):'没拉到')+'</div>'; }); }
    th.addEventListener('input',function(){ pg.querySelector('.mm-th em').textContent=(+this.value).toFixed(2); });
    th.addEventListener('change',go); go();
    B.addEventListener('click',function(e){ var b=e.target.closest('[data-sk]'); if(!b) return; var row=b.closest('.mm-si'), id=row.dataset.id; confirmBox(win,'沉底这条？','沉底后不再参与检索浮现，7 天后自动删掉。','沉底',true,function(){
      P.net.post(MB+'entries/'+encodeURIComponent(id)+'/status',{action:'archive'}).then(function(){ row.classList.add('gone'); setTimeout(function(){ row.remove(); },330); var m=MEMS.filter(function(x){ return x.id===id; })[0]; if(m){ m.sunk=true; paint(); } toast('沉底了'); buzz(8); },function(){ toast('没沉成'); }); }); }); }
  /* 记忆池设置：相关记忆注入（relevant-config）、两块总结 / 蒸馏 / 老数据重跑（各自 config + run + status）、版本存档（memory-summary/history）、导出 / 导入；11-02 加：入库判定组（memory-judge 提示词 + 门卫模型）与四组就地改提示词（P.pedit）/模型（行内分组下拉） */
  function setLive(){ var RB='/heartbeat/admin/';
    var pg=sub(win,'记忆池设置','<div id="msB"><div class="pg-empty"><i class="pg-spin"></i></div></div>',{right:'<span class="pg-cb ghost"></span>',toggle:function(t){ onTg(t); },go:function(k,t){ onGo(k,t); }});
    var B=pg.querySelector('#msB'), PV=[], CF={}, onTg=function(){}, onGo=function(){};
    function gs(u){ return P.net.get(RB+u).catch(function(){ return null; }); }
    function on(n){ var e=B.querySelector('[data-tg="'+n+'"]'); return !!(e&&e.classList.contains('on')); }
    function stv(c){ var e=B.querySelector('.'+c+' .pg-st input'); return e?+e.value.replace(/,/g,''):null; }
    function rv(go){ var e=B.querySelector('[data-go="'+go+'"] .rv'); return e?e.textContent:''; }
    var rt=0; function relSave(){ clearTimeout(rt); rt=setTimeout(function(){ P.net.post(RB+'memory-v2/relevant-config',{enabled:on('re'),preview:on('rp'),wordWeight:+B.querySelector('#w1').value,semWeight:+B.querySelector('#w2').value,minHybridScore:+B.querySelector('#w3').value,topK:stv('ms-tk')}).then(function(){ toast('存好了'); },function(){ toast('没存上'); }); },500); }
    function cfgSave(mod){ var b={enabled:on(mod[0]+'e'),time:rv('t:'+mod)}; if(mod==='summary') b.incremental=on('si'); else b.batch_size=stv(mod==='distill'?'ms-db':'ms-bb');
      P.net.post(RB+'memory-'+mod+'/config',b).then(function(){ toast('存好了'); },function(){ toast('没存上'); }); }
    Promise.all([gs('memory-v2/relevant-config'),gs('memory-summary/config'),gs('memory-distill/config'),gs('memory-backfill/config'),gs('memory-v2/relevant-preview'),gs('model-roles'),gs('memory-judge/prompt'),gs('memory-distill/prompt'),gs('memory-summary/prompt'),gs('memory-backfill/prompt')]).then(function(x){
      var rc=x[0]||{}, rl=rc.relevant||{}, sm=x[1]||{}, ds=x[2]||{}, bf=x[3]||{}; PV=(x[4]&&x[4].items)||[]; CF={summary:sm,distill:ds,backfill:bf}; var MRS=(x[5]&&x[5].roles)||{}; [[3,x[6]],[4,x[7]],[5,x[8]],[6,x[9]]].forEach(function(a){ P.pvals[a[0]]=a[1]?Object.assign({},a[1]):null; });
      /* [位置:phone-pages.js·setLive jb] [攒批评分：进度 / 批数 / 立刻评] [需求:11-08：门卫攒满一批才评，进度和批数都在「入库判定」卡看和改；批数存后端即时生效；「立刻评一批」把攒着的全评掉（跟别的「立即跑」一个套路）] [注释时间 2026-11-08] */
      var jb=(x[6]&&x[6].batch)||null;
      /* [位置:phone-pages.js·setLive jbPaint] [攒批进度行含运行态] [11-11：门卫评分跑到哪要看得见——batch.running 时显示「评着呢 · 第 x/y 批 · 已评 n/m 条」，平时照旧显示攒批数] [注释时间 2026-11-11] */
      function jbPaint(){ var e2=B.querySelector('[data-jb] .rv'); if(!e2) return; var rn=jb&&jb.running;
        e2.textContent=jb?(rn?('评着呢 '+rn.batch_index+'/'+rn.batch_total+' 批'):(jb.pending+' / '+jb.batch_size+' 条')):'读不到'; }
      /* [位置:phone-pages.js·setLive·jbRuns] [评分跑批：实时进度 + 上次评分 + 日志子页 + 立刻评跟随] [需求:11-11「跑了没日志，不知道跑到哪了」——设置页开着每 5 秒拉 /admin/memory-judge/runs（子页链式 setTimeout，页面关了 isConnected=false 即停）：攒批进度行运行中显示第几批/已评多少，上次评分行显示最近一次（手动汇总优先），评分日志子页翻最近 50 条；「立刻评一批」新后端触发即返回，点完进跟随态，轮询发现跑完就恢复按钮并弹汇总——锁屏断网回来照样看到真实进度；后端未重启时 batch-run 仍同步回 processed，走旧分支直接弹结果] [注释时间 2026-11-11] */
      var jbPrevRun=null, jbLogPg=null;
      function jbDur(ms){ ms=+ms||0; return ms>=60000?(Math.floor(ms/60000)+'分'+Math.round(ms%60000/1000)+'秒'):(Math.round(ms/100)/10+'秒'); }
      function jbRecText(rc){ var w=wallLocal(rc.ts)||{};
        return (w.d?w.d+' '+w.hm:'')+' · '+(rc.trigger==='manual'?'手动':'自动')+(rc.summary?(' '+rc.batches+' 批'):'')+' '+rc.items+' 条 · 值得 '+(rc.worth||0)+' / 不值得 '+(rc.not_worth||0)+(rc.degraded?' · 降级 '+rc.degraded:'')+' · '+jbDur(rc.duration_ms)+(rc.error?' · 出错':''); }
      function jbLastPaint(runs){ var e3=B.querySelector('[data-jblast] .rt small'); if(!e3) return;
        if(!runs||!runs.length){ e3.textContent='还没评过'; return; }
        var s=null; for(var i=0;i<runs.length;i++) if(runs[i].summary){ s=runs[i]; break; }
        if(!s) s=runs[0]; e3.textContent=jbRecText(s); }
      function jbLogPaint(x2){
        if(!jbLogPg||!jbLogPg.isConnected) return;
        var box=jbLogPg.querySelector('#jlgB'); if(!box) return;
        var runs=(x2&&x2.runs)||[], rn=x2&&x2.batch&&x2.batch.running, html='';
        if(rn){ var w2=wallLocal(rn.started_at)||{};
          html+='<div class="mm-pv"><b>评着呢 · '+(rn.trigger==='manual'?'手动':'自动')+' · 第 '+rn.batch_index+'/'+rn.batch_total+' 批 · 已评 '+rn.scored+' / '+rn.items+' 条</b>开始于 '+(w2.d?w2.d+' '+w2.hm:'')+'</div>'; }
        if(runs.length) html+=runs.map(function(rc){
          return '<div class="mm-pv'+(rc.summary?' jlg-sum':'')+'"><b>'+esc(jbRecText(rc))+'</b>'+esc(rc.summary?'这次手动跑批的汇总':(rc.ok?'':'整批解析失败，已逐条降级重评'))+'</div>'; }).join('');
        else if(!rn) html='<div class="pg-empty">还没有评分记录</div>';
        box.innerHTML=html; }
      function jbLogPage(){ jbLogPg=sub(win,'评分日志','<div id="jlgB"><div class="pg-empty"><i class="pg-spin"></i></div></div>');
        P.net.get(RB+'memory-judge/runs').then(jbLogPaint,function(){ if(jbLogPg&&jbLogPg.isConnected) jbLogPg.querySelector('#jlgB').innerHTML='<div class="pg-empty">没拉到</div>'; }); }
      function paintRuns(x2){
        if(!x2) return;
        if(x2.batch) jb=x2.batch;
        jbPaint(); jbLastPaint(x2.runs);
        var rn=jb&&jb.running, jbr=B.querySelector('[data-jbrun]');
        if(rn){ if(jbr&&!jbr.classList.contains('busy')){ jbr.classList.add('busy'); jbr.innerHTML='<i class="pg-spin"></i>评着呢…'; }
          jbr.innerHTML='<i class="pg-spin"></i>评着呢 · '+rn.scored+'/'+rn.items; }
        else if(jbPrevRun&&jbr&&jbr.classList.contains('busy')){   /* 跟着的这次（手动点或打开页面时正在跑的）结束了 */
          jbr.classList.remove('busy'); jbr.textContent='立刻评一批'; buzz([8,30,8]);
          var s=null; (x2.runs||[]).some(function(rc){ if(rc.summary){ s=rc; return true; } return false; });
          toast(s?('评完了 '+s.items+' 条 · 值得记 '+(s.worth||0)+' / 不值得 '+(s.not_worth||0)+(s.degraded?' · 降级 '+s.degraded:'')+(s.error?' · 有出错':'')):'这批评完了');
          P.net.get(RB+'memory-judge/prompt').then(function(p2){ if(p2&&p2.batch){ jb=p2.batch; jbPaint(); } },function(){});
          if(live) loadQ();
        }
        jbPrevRun=rn?Object.assign({},rn):null;
        if(jbLogPg&&jbLogPg.isConnected) jbLogPaint(x2);
      }
      (function jbPoll(){ if(!pg.isConnected) return;
        P.net.get(RB+'memory-judge/runs').then(paintRuns,function(){});
        setTimeout(jbPoll,5000); })();
      /* [位置:phone-pages.js·setLive·pipeLogs] [名称:蒸馏/重跑运行日志] [需求:11-12「这两个。加记录日志之类的」——「记忆蒸馏」「老数据重跑」两组各加一行「运行日志」：副标题=上次运行时间+结果摘要（用已拉到的 config.last_run_result，不新增请求）；点开子页拉 /admin/memory-distill/runs、/admin/memory-backfill/runs（最近 50 条，新→旧），子页开着每 5 秒轮询、跑着呢横幅置顶，关页即停（isConnected 断链）；条目样式与评分日志同款 mm-pv] [注释时间 2026-11-12] */
      function pipeTrigTxt(t){ return t==='manual'?'手动':(t==='notes'?'笔记':(t==='catchup'||t==='schedule-catchup')?'补跑':'定时'); }
      function pipeLastTxt(o){ var r0=o&&o.last_run_result, w=wallLocal(o&&o.last_run_at)||{};
        if(!r0) return '还没跑过';
        var base=(w.d?w.d+' '+w.hm:'');
        if(r0.ok===false) return (base||'上次')+' · 出错';
        if(typeof r0.queued==='number') return (base||'上次')+' · 进待审 '+r0.queued+' 条';
        return base||'还没跑过'; }
      /* [位置:phone-pages.js·bfLastTxt] [名称:重跑运行日志副标题] [需求:11-14「每次重跑显示几条记忆参与」——共用 pipeLastTxt 只显示进待审数，重跑换专用：参与 N / 进待审 X / 还剩 K 条没跑过；失败=没跑成下次再试（后端失败现在也写 last_run_result）；空跑=全部跑完了。蒸馏仍走 pipeLastTxt，互不干扰] [注释时间 2026-11-14] */
      function bfLastTxt(o){ var r0=o&&o.last_run_result, w=wallLocal(o&&o.last_run_at)||{};
        if(!r0) return '还没跑过';
        var base=(w.d?w.d+' '+w.hm:'');
        if(r0.ok===false) return (base||'上次')+' · 参与 '+(r0.count||0)+' · 没跑成，下次再试';
        if(!(r0.count>0)) return (base||'上次')+' · 全部跑完了';
        return (base||'上次')+' · 参与 '+r0.count+' · 进待审 '+(r0.queued||0)+(typeof r0.remaining==='number'?' · 还剩 '+r0.remaining+' 条没跑过':''); }
      function pipePaint(box,x2){ if(!box) return; var rn=x2&&x2.running, runs=(x2&&x2.runs)||[], html='';
        if(rn){ var w2=wallLocal(rn.started_at)||{}; html+='<div class="mm-pv"><b>跑着呢 · '+esc(pipeTrigTxt(rn.trigger)+(rn.kind==='notes'?' · 笔记':''))+'</b>开始于 '+(w2.d?w2.d+' '+w2.hm:'')+'</div>'; }
        if(runs.length) html+=runs.map(function(rc){ var w3=wallLocal(rc.ts)||{};
          return '<div class="mm-pv"><b>'+esc((w3.d?w3.d+' '+w3.hm:'')+' · '+pipeTrigTxt(rc.trigger)+(rc.kind==='notes'?' · 笔记':'')+(rc.dry_run?' · 试跑':'')+(rc.ok?'':' · 出错'))+'</b>'+esc(rc.ok?(rc.summary||'跑完了'):((rc.error||'').slice(0,160)||'不知道为啥'))+'</div>'; }).join('');
        else if(!rn) html='<div class="pg-empty">还没有运行记录</div>';
        box.innerHTML=html; }
      function pipeLogPage(title,url){ var pgl=sub(win,title,'<div id="plgB"><div class="pg-empty"><i class="pg-spin"></i></div></div>');
        P.net.get(url).then(function(x2){ pipePaint(pgl.querySelector('#plgB'),x2); },function(){ var box=pgl.querySelector('#plgB'); if(box&&pgl.isConnected) box.innerHTML='<div class="pg-empty">没拉到</div>'; });
        (function poll(){ if(!pgl.isConnected) return; P.net.get(url).then(function(x2){ pipePaint(pgl.querySelector('#plgB'),x2); },function(){}); setTimeout(poll,5000); })(); }
      function jbSave(){ var n=stv('ms-jb'); if(n==null) return; P.net.post(RB+'memory-judge/batch',{size:n}).then(function(r2){ if(r2&&r2.batch){ jb=r2.batch; jbPaint(); } toast('存好了 · 攒 '+((jb&&jb.pending)||0)+' / '+n); buzz(8); },function(){ toast('没存上'); }); }
      function nz(v,d){ return v==null?d:v; }
      function prow(go,pi){ var v=P.pvals[pi]; return r({t:'提示词'+(v&&v.custom_set?' <span class="pg-tag">改过</span>':''),s:v==null?'读不到':P.plen(pi).toLocaleString()+' 字',go:go}); }
      /* [位置:phone-pages.js·setLive·mrow] [模型行＝行内原生分组下拉] [11-05 晚：原来点行弹自绘抽屉；现在行里就是 select，选中即 PUT /admin/model-roles/:role 存下，失败回滚选中值] [注释时间 2026-11-05] */
      function mrow(go,key){ return mdSelHtml({t:'模型',k:'m:'+key}); }
      /* [位置:phone-pages.js·setLive/paintP·paintM] [就地行局部刷新] [11-02：就地改完提示词/模型只刷那一行的标题与副标题，不整页重画（开关/步进状态都在 DOM 上）] [注释时间 2026-11-02] */
      function paintP(go,pi){ var e=B.querySelector('[data-go="'+go+'"]'); if(!e) return; var v=P.pvals[pi], b=e.querySelector('.rt b'), sm=e.querySelector('.rt small'); if(b) b.innerHTML='提示词'+(v&&v.custom_set?' <span class="pg-tag">改过</span>':''); if(sm) sm.textContent=v==null?'读不到':P.plen(pi).toLocaleString()+' 字'; }
      B.innerHTML=grp('相关记忆注入',[r({t:'真注入',tg:1,on:rc.ctx_v2_relevant_enabled,tgname:'re'}),r({t:'观察模式',tg:1,on:rl.preview,tgname:'rp'}),slider('w1','词面权重',String(nz(rl.wordWeight,.4)),0,1,.05),slider('w2','语义权重',String(nz(rl.semWeight,.6)),0,1,.05),slider('w3','混合分门槛',String(nz(rl.minHybridScore,.3)),0,1,.01),r({t:'每轮最多条数',st:{v:nz(rl.topK,5),min:1,max:10},cls:'ms-tk'}),r({t:'预览（最近几轮）',v:PV.length+' 次',go:'pv'})],null,0)+
        grp('入库判定',[prow('p3',3),mrow('m1','memory_admit'),r({t:'攒批进度',v:'',data:' data-jb="1"'}),r({t:'上次评分',s:'还没评过',go:'jblog',data:' data-jblast="1"'}),r({t:'每批评分条数',st:{v:nz(jb&&jb.batch_size,30),min:1,max:1000000},cls:'ms-jb'}),'<div class="pg-bts"><button class="pg-btn tap" type="button" data-jbrun>立刻评一批</button></div>'],null,1)+
        grp('两块总结',[r({t:'每晚自动检查',tg:1,on:sm.enabled,tgname:'se'}),r({t:'检查时间',v:esc(sm.time||'03:30'),go:'t:summary'}),r({t:'增量生成',tg:1,on:sm.incremental,tgname:'si'}),r({t:'版本存档',go:'ver'}),prow('p5',5),mrow('m3','memory_summary'),'<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-mr="summary">立即生成</button><button class="pg-btn tap" type="button" data-mr="summary!">强制重生成</button></div>'],null,2)+
        grp('记忆蒸馏',[r({t:'自动蒸馏',tg:1,on:ds.enabled,tgname:'de'}),r({t:'每天运行时间',v:esc(ds.time||'03:00'),go:'t:distill'}),r({t:'每批天数',st:{v:nz(ds.batch_size,5),min:1,max:20},cls:'ms-db'}),prow('p4',4),mrow('m2','distill'),r({t:'运行日志',s:esc(pipeLastTxt(ds)),go:'dlog'}),'<div class="pg-bts"><button class="pg-btn tap" type="button" data-mr="distill">立即跑一次</button><button class="pg-btn tap" type="button" data-dp="1">选日期蒸</button><button class="pg-btn tap" type="button" data-dn="1">蒸馏笔记</button></div>'],null,3)+
        grp('老数据重跑',[r({t:'每晚自动跑一批',tg:1,on:bf.enabled,tgname:'be'}),r({t:'跑的时间',v:esc(bf.time||'04:00'),go:'t:backfill'}),r({t:'每批条数',st:{v:nz(bf.batch_size,15),min:1,max:1000000},cls:'ms-bb'}),prow('p6',6),mrow('m4','backfill'),r({t:'运行日志',s:esc(bfLastTxt(bf)),go:'blog'}),'<div class="pg-bts"><button class="pg-btn tap" type="button" data-mr="backfill">立即跑一批</button><button class="pg-btn tap" type="button" data-mr="backfill?">试试（不写入）</button></div>'],null,4)+
        grp('导入导出',['<div class="pg-bts"><button class="pg-btn tap" type="button" data-mx="ex">导出</button><button class="pg-btn tap" type="button" data-mx="ext">导出TXT</button><button class="pg-btn tap" type="button" data-mx="im">导入</button></div>'],null,5);
      var MKEY={m1:'memory_admit',m2:'distill',m3:'memory_summary',m4:'backfill'};
      Object.keys(MKEY).forEach(function(gk){ var rk=MKEY[gk], o=MRS[rk]||{}, cur=(o.provider_id&&o.model)?(o.provider_id+'|'+o.model):'';
        var inst=mdBind(B.querySelector('[data-md="m:'+rk+'"]'),cur,function(v,pid,model,prev){
          P.net.req(RB+'model-roles/'+encodeURIComponent(rk),{method:'PUT',body:{provider_id:pid,model:model}}).then(function(){ toast('模型改成 '+(pid?model:'跟随聊天模型')); buzz([8,30,8]); },function(){ toast('没改成'); buzz([20,30,20]); inst.want(prev); });
        });
      });
      onTg=function(t){ var n=t.dataset.tg; if(n==='re'||n==='rp') relSave(); else cfgSave({s:'summary',d:'distill',b:'backfill'}[n[0]]); };
      onGo=function(k,t){
        if(k.indexOf('t:')===0){ var cur=t.querySelector('.rv').textContent; sheet(win,'选时间','<input class="pg-in" type="time" value="'+esc(cur)+'" style="font-size:22px;height:56px;text-align:center"><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>好</button></div>',function(s2,close){ s2.querySelector('[data-ok]').addEventListener('click',function(){ t.querySelector('.rv').textContent=s2.querySelector('input').value; close(); cfgSave(k.slice(2)); buzz(8); }); }); }
        else if(k==='pv') sub(win,'相关注入预览',PV.length?grp('最近几轮',PV.map(function(p2){ var h=p2.hits||[]; return '<div class="mm-pv"><b>'+esc((function(w){ return w?w.d+' '+w.hm:''; })(wallLocal(p2.time)))+' · '+h.length+' 条命中</b>'+esc(String(p2.query||'').slice(0,60))+(h[0]?'<br><small>'+esc(String(h[0].text||h[0].content||'').slice(0,60))+'</small>':'')+'</div>'; }),null,0):'<div class="pg-empty">还没有</div>');
        else if(k==='ver') verPage();
        else if(k==='jblog') jbLogPage();
        else if(k==='dlog') pipeLogPage('蒸馏运行日志',RB+'memory-distill/runs');
        else if(k==='blog') pipeLogPage('重跑运行日志',RB+'memory-backfill/runs');
        /* [位置:phone-pages.js·setLive/onGo 就地提示词/模型行] [11-02：记忆池设置四组就地改提示词（P.pedit）与模型（11-05 晚改成行内分组下拉 mdBind）；p3/p4/p5/p6=PROMPTS 下标（判定/蒸馏/两块/老数据），m1..m4=memory_admit/distill/memory_summary/backfill] [注释时间 2026-11-02] */
        else if(/^p\d$/.test(k)){ var pi=+k.slice(1); P.pedit(win,pi,function(){ paintP(k,pi); }); }
      };
      B.addEventListener('change',function(e){ if(e.target.matches('#w1,#w2,#w3')) relSave(); });
      B.addEventListener('click',function(e){ if(e.target.closest('.pg-st button')) setTimeout(function(){ var g=e.target.closest('.pg-r'); if(g.classList.contains('ms-tk')) relSave(); else if(g.classList.contains('ms-db')) cfgSave('distill'); else if(g.classList.contains('ms-bb')) cfgSave('backfill'); else if(g.classList.contains('ms-jb')) jbSave(); },0);
      B.addEventListener('pg-st-change',function(e){ var g=e.target.closest('.pg-r'); if(g.classList.contains('ms-tk')) relSave(); else if(g.classList.contains('ms-db')) cfgSave('distill'); else if(g.classList.contains('ms-bb')) cfgSave('backfill'); else if(g.classList.contains('ms-jb')) jbSave(); });   /* [位置:phone-pages.js·记忆设置·pg-st-change] [手输数量直接落盘] [数量器直接输入后 blur 提交走这里，+/- 仍走上面 click；relSave 自带防抖，cfgSave 幂等] [注释时间 2026-11-07] */
        var jbr=e.target.closest('[data-jbrun]');
        if(jbr){ if(jbr.classList.contains('busy')) return; jbr.classList.add('busy'); jbr.innerHTML='<i class="pg-spin"></i>评着呢…'; buzz(6);
          /* [位置:phone-pages.js·setLive jbrun] [立刻评一批：触发即返回+轮询跟随] [11-11：新后端点了就回 started，进度在轮询 paintRuns 里收尾（恢复按钮+弹汇总），锁屏断网不影响；后端没重启时仍同步回 processed，走旧分支直接弹结果] [注释时间 2026-11-11] */
          P.net.post(RB+'memory-judge/batch-run',{}).then(function(r2){
            if(r2&&(r2.started||r2.running)){ if(r2.running) toast('已经在评分了，看着进度就行'); return; }
            jbr.classList.remove('busy'); jbr.textContent='立刻评一批'; var n=(r2&&r2.processed)||0;
            var dg=(r2&&r2.degraded)?('（'+r2.degraded+' 条走了逐条）'):'';
            toast(n?('评完了 '+n+' 条'+dg):'没有攒着的评分'); buzz(n?[8,30,8]:[12,30,12]);
            P.net.get(RB+'memory-judge/prompt').then(function(p2){ if(p2&&p2.batch){ jb=p2.batch; jbPaint(); } },function(){}); if(live) loadQ(); },function(){ jbr.classList.remove('busy'); jbr.textContent='立刻评一批'; toast('没跑起来'); }); }
        var m=e.target.closest('[data-mr]'); if(m) runMod(m);
        var dpb=e.target.closest('[data-dp]'); if(dpb) dayPick(dpb);
        var dnb=e.target.closest('[data-dn]'); if(dnb) notePick(dnb);
        var xb=e.target.closest('[data-mx]'); if(xb) xb.dataset.mx==='ex'?exportAll(xb):(xb.dataset.mx==='ext'?exportAllTxt(xb):importAll()); });
    });
    /* [位置:phone-pages.js·dayPick/distillMsg] [蒸馏选日期 + 跑完回执] [11-03：①跑完提示要说清蒸的是哪一天、抽出几条、进待审几条、还剩几天（后端结果 days/candidates/queued/remaining 一直有，只是提示没显示）；②「选日期蒸」列出时间线里每一天（新到旧），蒸过的标「已生成过 · 完成时间」，点哪天蒸哪天（已蒸过的会先确认，再蒸门卫会拦重复）；一次一天] [注释时间 2026-11-03] */
    function distillMsg(lr){ if(!lr.picked) return '没有可蒸的日期了'; var ds=(lr.days||[]).map(function(d){ return String(d).slice(5); }).join('、');
      return '蒸了 '+ds+' · 抽出 '+(lr.candidates||0)+' 条 · '+(lr.queued||0)+' 条进待审'+(lr.rejected?' · 门卫拦下 '+lr.rejected:'')+(lr.forcedDays?'':' · 还剩 '+(lr.remaining||0)+' 天'); }
    /* [位置:phone-pages.js·bfMsg] [重跑跑完回执 toast] [需求:11-14——立即跑一批跑完要说参与几条、进待审几条、还剩几条没跑过；试组装显示参与数且注明没调模型；空跑说全部已跑过] [注释时间 2026-11-14] */
    function bfMsg(lr){ if(lr.mode==='dry_run') return '试组装：参与 '+(lr.count||0)+' 条，没调模型'; if(!(lr.count>0)) return '没有要跑的了，全部已跑过'; return '参与 '+(lr.count||0)+' · '+(lr.queued||0)+' 条进待审'+(typeof lr.remaining==='number'?' · 还剩 '+lr.remaining+' 条没跑过':''); }
    /* [位置:phone-pages.js·notePick] [蒸馏笔记按钮] [11-04：把还没蒸过的笔记按蒸馏提示词蒸成记忆，候选只进待审；后台分批跑，这里轮询状态，跑完弹结果；已蒸过的下次不再蒸；11-11 改：攒着的列出来——新 / 更新（+字数），更新的只蒸新增部分；11-12 改：确认框换底板清单，点一下叉掉——这次不蒸（skip 传后端）、下次还在清单里，再点恢复，底部「开蒸 N 篇」实时计数、全叉掉置灰] [注释时间 2026-11-12] */
    function notePick(b){ if(b.classList.contains('busy')) return; var t0=b.textContent;
      P.net.get(RB+'memory-distill/notes').then(function(r){ var n=(r&&r.pending)||0;
        if(!n){ toast('没有新的或更新过的笔记'); return; }
        var L=(r&&r.items)||[], skip=[];
        function fin(msg,ok){ b.classList.remove('busy'); b.textContent=t0; toast(msg); buzz(ok?[8,30,8]:[20,40,20]); loadQ(); }
        function go(){ b.classList.add('busy'); b.innerHTML='<i class="pg-spin"></i>蒸着呢…'; buzz(6);
          P.net.post(RB+'memory-distill/notes-run',{skip:skip}).then(function(r2){
            if(r2&&r2.started===false){ fin(r2.note||'没有要蒸的',true); return; }
            if(r2&&r2.started&&skip.length&&r2.skipped==null) toast('后端没重启，叉掉的这次也蒸上了');
            (function poll(k){ setTimeout(function(){ P.net.get(RB+'memory-distill/status').then(function(st){ var ns=(st&&st.notes)||{};
              if(st&&st.running&&k<1500){ poll(k+1); return; }
              var l=ns.last||{}; fin(l.note||'跑完了',!l.failed); },function(){ fin('看不到进度了，去待审看看',false); }); },4000); })(0);
          },function(e2){ fin(e2&&e2.status===409?'已经在跑了':'没跑起来',false); }); }
        sheet(win,'蒸馏笔记 · 攒了 '+n+' 篇','<div class="pg-g dp-l np-l">'+L.map(function(x){ return '<button class="pg-r tap np-i" type="button" data-id="'+esc(x.id)+'"><span class="np-k'+(x.kind==='updated'?' up':'')+'">'+(x.kind==='updated'?'更新':'新')+'</span><span class="rt"><b>'+esc(x.title)+'</b></span><em class="np-c">'+(x.kind==='updated'?'+'+x.chars+' 字':x.chars+' 字')+'</em><i class="np-x">'+I.ok+'<svg class="x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></i></button>'; }).join('')+'</div><div class="pg-ft">点一下叉掉，叉掉的这次不蒸、下次还在清单里；更新的只蒸上次之后改的那段，候选进待审、不直接入池。</div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-np>开蒸 '+L.length+' 篇</button></div>',function(s,close){
          var btn=s.querySelector('[data-np]');
          function count(){ var k=L.length-skip.length; btn.textContent='开蒸 '+k+' 篇'; btn.classList.toggle('off',!k); }
          s.addEventListener('click',function(e){ var it=e.target.closest('.np-i');
            if(it){ var id=it.dataset.id, i=skip.indexOf(id); if(i<0){ skip.push(id); it.classList.add('off'); } else { skip.splice(i,1); it.classList.remove('off'); } buzz(5); count(); return; }
            if(e.target.closest('[data-np]')&&!btn.classList.contains('off')){ close(); go(); } });
        });
      },function(){ toast('笔记清单没拉到'); }); }
    function dayPick(b){ if(b.classList.contains('busy')) return;
      P.net.get(RB+'memory-distill/days').then(function(r){ var L=(r&&r.days)||[];
        function tm(iso){ var d=new Date(iso); if(isNaN(d)) return ''; function z(n){ return n<10?'0'+n:n; } return z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes()); }
        var rows=L.map(function(x){ var t=x.done?tm(x.done):''; return '<button class="pg-r tap dp-i" type="button" data-d="'+esc(x.date)+'" data-done="'+esc(t)+'"'+(x.today?' disabled':'')+'><span class="rt"><b>'+esc(x.date)+'</b></span><em class="dp-t'+(x.done?' on':'')+'">'+(x.today?'今天 · 还没过完':x.done?'已生成过 · '+esc(t):'还没蒸')+'</em></button>'; }).join('');
        sheet(win,'选日期蒸',L.length?'<div class="pg-g dp-l">'+rows+'</div><div class="pg-ft">一次蒸一天，会调一次模型。已生成过的再蒸一遍，候选进待审，门卫会拦掉重复的。</div>':'<div class="pg-empty">时间线里没有日期</div>',function(s,close){
          s.addEventListener('click',function(e){ var it=e.target.closest('.dp-i'); if(!it||it.disabled) return; var d=it.dataset.d, was=it.dataset.done;
            confirmBox(win,'蒸 '+d+'？',(was?'这天已经蒸过了（'+was+'）。再蒸一次会重新抽候选进待审。':'')+'会调一次模型，大约要几分钟。','开蒸',false,function(){ close(); runMod(b,{k:'distill',days:[d]}); }); }); });
      },function(){ toast('日期清单没拉到'); }); }
    function runMod(b,x){ var k=(x&&x.k)||b.dataset.mr, mod=k.replace(/[!?]$/,''), t0=b.textContent; if(b.classList.contains('busy')) return; b.classList.add('busy'); b.innerHTML='<i class="pg-spin"></i>跑着呢…'; buzz(6);
      function done(msg,ok){ b.classList.remove('busy'); b.textContent=t0; toast(msg); buzz(ok?[8,30,8]:[20,40,20]); }
      var body=mod==='summary'?{force:/!$/.test(k)}:mod==='backfill'?(/\?$/.test(k)?{dry_run:true}:{}):(mod==='distill'&&x&&x.days?{days:x.days}:{});
      P.net.post(RB+'memory-'+mod+'/run',body).then(function(r2){
        if(mod!=='summary'){ var lr=(r2&&(r2.result||r2.last_run_result))||r2||{}; done(lr.ok===false?'没跑成：'+String(lr.error||lr.reason||'').slice(0,40):(mod==='distill'?distillMsg(lr):mod==='backfill'?bfMsg(lr):'跑完了'+(lr.queued!=null?' · '+lr.queued+' 条进待审':'')+(lr.count!=null?' · 处理 '+lr.count+' 条':'')),lr.ok!==false); if(mod!=='summary') loadQ(); return; }
        (function poll(n){ setTimeout(function(){ P.net.get(RB+'memory-summary/status').then(function(st){ if(st&&st.running&&n<100){ poll(n+1); return; } var lr=(st&&st.last_run_result)||{}; done(lr.ok===false?'没生成：'+String(lr.reason||st.last_error||'').slice(0,30):'生成好了',lr.ok!==false); },function(){ done('看不到进度了',false); }); },3000); })(0);
      },function(e){ done(e&&e.status===409?'已经在跑了':'没跑起来',false); }); }
    /* [位置:phone-pages.js·verPage] [名称:两块总结·版本存档] [需求:历史版本展开看全文；11-11 改:正文不再 slice(0,400) 硬截断，全文渲染交给 CSS 三行折叠，点开即全文；11-12 改:标出生效版（按缓存正文比对，生效中徽章+版本号变色，切版后徽章即挪）+ 头部小铅笔改正文——生效版改完同步刷缓存，新会话起用] [注释时间 2026-11-12] */
    function verPage(){ var vp=sub(win,'两块总结 · 版本存档',seg(['Core Identity','长期理解'],0)+'<div id="vrB"><div class="pg-empty"><i class="pg-spin"></i></div></div>',{seg:function(k){ paintV(k?'understanding':'core_identity'); }}), H=null, CUR={};
      function paintV(bk){ var l=((H&&H[bk])||[]).slice().reverse(), cu=CUR[bk]||0, V=vp.querySelector('#vrB');
        V.innerHTML=l.length?grp('',l.map(function(v){ var on=+v.version===cu; return '<div class="mm-ver'+(on?' cur':'')+'" data-v="'+esc(v.version)+'"><div class="h"><b>v'+esc(v.version)+'</b><small>'+esc((function(w){ return w?w.d+' '+w.hm:''; })(wallLocal(v.at||v.created_at||v.updated_at)))+'</small>'+(on?'<span class="cur-b">生效中</span>':'<button class="pg-btn tap" data-use>用这版</button>')+'<button class="h-ed tap" data-ed aria-label="改这一版"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/></svg></button></div><p>'+esc(String(v.text||''))+'</p></div>'; }),null,0):'<div class="pg-empty">还没有存档</div>'; V.dataset.bk=bk; }
      function editVer(bk,ver){ var it=(H[bk]||[]).filter(function(x){ return +x.version===ver; })[0]; if(!it) return;
        /* [位置:phone-pages.js·verPage.editVer] [版本存档编辑器] [11-12：头部铅笔进 textarea 改正文，保存走 history 接口；生效版改完服务端会同步刷缓存，提示新会话起用] [注释时间 2026-11-12] */
        sheet(win,'改 v'+ver,'<textarea class="pg-in" style="min-height:200px">'+esc(String(it.text||''))+'</textarea><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-vsv>保存</button></div>',function(s,close){
          var ta=s.querySelector('textarea');
          s.querySelector('[data-vsv]').addEventListener('click',function(){
            var t=ta.value.trim(); if(!t){ toast('空的不存'); return; }
            P.net.post(RB+'memory-summary/history',{block:bk,version:ver,text:t}).then(function(){
              it.text=t; paintV(bk); close(); toast('改好了'+(+CUR[bk]===ver?' · 新开的会话起用':'')); buzz(8);
            },function(){ toast('没存上'); });
          });
        }); }
      P.net.get(RB+'memory-summary/history').then(function(h){ H=h||{}; CUR=h.current||{}; paintV('core_identity'); },function(){ vp.querySelector('#vrB').innerHTML='<div class="pg-empty">没拉到</div>'; });
      vp.addEventListener('click',function(e){ var u=e.target.closest('[data-use]'), ed=e.target.closest('[data-ed]'), v=e.target.closest('.mm-ver'); if(u){ e.stopPropagation(); var bk=vp.querySelector('#vrB').dataset.bk; P.net.post(RB+'memory-summary/use-version',{block:bk,version:isNaN(+v.dataset.v)?v.dataset.v:+v.dataset.v}).then(function(){ CUR[bk]=isNaN(+v.dataset.v)?v.dataset.v:+v.dataset.v; paintV(bk); toast('切到这一版了 · 新开的会话起用'); buzz(8); },function(){ toast('没切成'); }); return; } if(ed&&v){ editVer(vp.querySelector('#vrB').dataset.bk,+v.dataset.v); return; } if(v){ v.classList.toggle('open'); buzz(5); } }); }
    function exportAll(b){ b.classList.add('busy'); P.net.get(MB+'export?category=all').then(function(j){ b.classList.remove('busy'); var d=new Date(), p2=function(n){ return (n<10?'0':'')+n; }, bl=new Blob([JSON.stringify(j,null,2)],{type:'application/json'}), a=document.createElement('a'); a.href=URL.createObjectURL(bl); a.download='记忆池_'+d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+'.json'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },800); toast('导出了 '+((j&&j.count)||0)+' 条'); buzz([8,30,8]); },function(){ b.classList.remove('busy'); toast('没导出来'); }); }
    /* [位置:phone-pages.js·setLive/exportAllTxt] [名称:记忆池导出TXT] [需求:记忆池导出加纯文本格式，txt 只要每条记忆正文（空行分隔），别的不带] [注释时间 2026-10-29] */
    function exportAllTxt(b){ b.classList.add('busy'); P.net.get(MB+'export?category=all').then(function(j){ b.classList.remove('busy'); var es=(j&&j.entries)||[], ls=es.map(function(e){ return String(e.text||'').trim(); }).filter(Boolean); if(!ls.length){ toast('没有可导出的活跃记忆'); return; }
      var txt=ls.join('\n\n'), d=new Date(), p2=function(n){ return (n<10?'0':'')+n; }, bl=new Blob(['\ufeff',txt],{type:'text/plain;charset=utf-8'}), a=document.createElement('a'); a.href=URL.createObjectURL(bl); a.download='记忆池_正文_'+d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+'.txt'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },800); toast('导出了 '+ls.length+' 条正文'); buzz([8,30,8]); },function(){ b.classList.remove('busy'); toast('没导出来'); }); }
    function importAll(){ var f=document.createElement('input'); f.type='file'; f.accept='.json,application/json'; f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl) return; var rd=new FileReader(); rd.onload=function(){ var obj; try{ obj=JSON.parse(rd.result); }catch(e){ toast('不是能读的 JSON'); return; }
        P.net.post(MB+'import',Object.assign({},obj,{dry_run:true})).then(function(r2){ var x=(r2&&r2.result)||{};
          confirmBox(win,'导入 '+(x.total||0)+' 条？','新增 '+(x.create||0)+' · 覆盖 '+(x.update||0)+' · 沉底 '+(x.archive||0)+' · 恢复 '+(x.revive||0)+' · 不变 '+(x.unchanged||0)+(x.failed?' · '+x.failed+' 条有问题':'')+'。会先自动备份。','导入',true,function(){
            P.net.post(MB+'import',Object.assign({},obj,{dry_run:false})).then(function(){ toast('导入好了'); buzz([8,30,8]); load(); },function(e){ toast(e&&e.status===409?'另一个导入还在跑':'没导入成'); }); }); },function(){ toast('这个文件读不懂'); }); }; rd.readAsText(fl); }; f.click(); }
  }
  P.mem={set:function(){ $('#mmSet',win).click(); },add:function(){ addMem(); },open:function(i){ L.querySelectorAll('.mm-it2')[i||0].click(); },review:function(){ $('#mmQ2',win).click(); },sim:simGroups,menu:function(){ $('#mmSort',win).click(); },swipe:function(i){ var s=L.querySelectorAll('.mm-sw')[i||0]; s.classList.add('open'); s.querySelector('.mm-it2').style.transform='translateX(-140px)'; }};
}
P.register('mem',{html:memHTML,setup:memSetup});

/* ================= 唤醒 v5 =================
   一页几张卡片：下次醒来、唤醒设置、推送管理、原始日志。没有圆环、没有列表。
   接口：/v1/sleep-wake（睡眠唤醒：总开关/聊天停多久/我设的闹钟作废窗口/追加文字，2026-11-09 取代原 /admin/env 的白天/夜间六项）、/v1/wake-next（下次醒来）、/admin/wake-event-sessions、
   /admin/logs/wake-prompt、/admin/logs/wake-up?lines=1500（跟 chat 端一样：按「开始自动唤醒」切段，取最近 10 段，旧→新，原样显示）、/admin/push-events。
   示例数据 = 服务器 10-19 的真实日志与 .env 取值。设置里「你有动静」「会话太长」后端未接，标「未接」。 */
var WSEG=[];   /* 演示日志快照已删（2026-10-22） */
var WKST={log:'load',push:'load'};   /* 读取状态：load / ok / fail */
/* [位置:phone-pages.js·唤醒设置·SUBS] [「你有动静时」订阅开关接真] [10-23 第 9 条：原来是示例数据（标「未接」）；现在从 /v1/wake-subs 读（只列后端已经接好的项），点开关立刻存，存不上就弹回去并提示；这里是她的总开关——关一项，不管他在各会话里怎么订，那一项都不再叫他，再打开就恢复；11-02 改：不再有「他自己订不订」，开着就叫所有锁定唤醒的会话，AI 确认步骤已去掉] [注释时间 2026-11-02] */
var SUBS=[];   /* [名字, 开(1/0), '', key] */
var WS={tok:80,lock:'主会话'};
/* [位置:phone-pages.js·唤醒设置·SW] [睡眠唤醒的全局设置] [11-09：定时唤醒的白天/夜间两套间隔删掉，换成「睡眠唤醒」——你最后一句话之后聊天停满 afterMin 分钟叫他一次（不分昼夜），可按概率叫；probPct=概率；userAlarmQuietMin=你自己设的闹钟响铃前这么久你还在聊就这一轮不响；note=睡眠唤醒时多告诉他的一句话。数据在后端 data/sleep-wake.json，读写走 /v1/sleep-wake] [注释时间 2026-11-09] */
var SW={enabled:true,afterMin:120,userAlarmQuietMin:60,note:''}, SWOK=false;
var LOC={cooldownMin:30,maxGapMin:5,problem:''}, LOCOK=false;   /* 位置唤醒：冷却分钟 + 最近一次的问题说明（有问题时才在位置行下出小字） */
var WX={set:svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),go:svg('<path d="m9 6 6 6-6 6"/>')};
function wkRaw(){ if(!WSEG.length) return WKST.log==='load'?P.net.loadBox():WKST.log==='fail'?P.net.failBox():'<div class="pg-empty">日志里还没有记录</div>'; return WSEG.map(function(g){ return '<div class="sg">'+g.map(esc).join('<br>')+'</div>'; }).join(''); }
var WKI={ed:svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>'),del:svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>')};
function wkPush(){ var l=PUSHL(); return l.length?l.map(function(p,i){ return '<div class="wk5-pi'+(p[3]?'':' bad')+'" data-i="'+i+'"><i class="ps-ic'+(p[3]?'':' bad')+'">'+I.bell+'</i><div class="bd"><span>'+esc(p[0])+'</span><time>'+p[1]+' · '+esc(p[2])+(p[3]?'':' · 没送到')+'</time></div><button class="wk5-ib tap" type="button" data-pe aria-label="修改">'+WKI.ed+'</button><button class="wk5-ib tap" type="button" data-pd aria-label="删除">'+WKI.del+'</button></div>'; }).join(''):WKST.push==='load'?P.net.loadBox():WKST.push==='fail'?P.net.failBox():'<div class="pg-empty">还没有推送</div>'; }
function wakeHTML(){
  var ok=PUSHN(), last=(WSEG.length?WSEG[WSEG.length-1]:[]).join('\n'), m=last.match(/起点 \d{4}-\d\d-\d\d (\d\d:\d\d)（(.)天），阈值 (\d+) 分钟，到点 \d{4}-\d\d-\d\d (\d\d:\d\d)/);
  return shell('唤醒','<button class="pg-cb tap" type="button" data-go="set" aria-label="唤醒设置">'+WX.set+'</button>',
    '<div class="wk5">'+
    '<section class="pg-g pg-rise wk5-c wk5-nx" style="--i:0"><div class="wk5-h"><small>下次醒来</small><i class="pg-dot sp" role="img" aria-label="运行正常"></i></div>'+
      '<b class="wk5-at" id="wkAt">'+(m?m[4]:'--:--')+'</b><em class="wk5-cd" id="wkCd"></em>'+
      '<p class="wk5-why" id="wkWhy">'+(m?(m[2]==='白'?'白天':'夜里')+' · 起点 '+m[1]+' · 安静 '+m[3]+' 分钟叫他':'')+'</p></section>'+
    '<section class="pg-g pg-rise wk5-c" style="--i:1"><div class="wk5-h"><b>推送管理</b><small id="wkPn"></small></div>'+
      '<div class="wk5-ps" id="wkPs">'+wkPush()+'</div></section>'+
    '<section class="pg-g pg-rise wk5-c" style="--i:2"><div class="wk5-h"><b>原始日志</b><small id="wkN">最近 '+WSEG.length+' 次 · 旧→新</small><button class="wk5-cb tap sp" type="button" id="wkRf" aria-label="刷新">'+I.refresh+'</button></div>'+
      '<div class="wk5-raw" id="wkRaw">'+wkRaw()+'</div></section>'+
    '</div>');
}
function PUSHN(){ var l=PUSHL(), bad=l.filter(function(p){ return !p[3]; }).length; return [l.length,bad]; }
function PUSHL(){ return (P.pushData&&P.pushData())||[]; }
function wkWhen(at){ var d=P.net&&P.net.parse(at); if(!d) return String(at||''); var n=new Date(), t0=new Date(n.getFullYear(),n.getMonth(),n.getDate()), d0=new Date(d.getFullYear(),d.getMonth(),d.getDate()), df=Math.round((t0-d0)/864e5), two=P.net.two, hm=two(d.getHours())+':'+two(d.getMinutes()); return df===0?'今天 '+hm:df===1?'昨天 '+hm:two(d.getMonth()+1)+'-'+two(d.getDate())+' '+hm; }
var WCH={webpush:'Web 推送',bark:'Bark','未发送':'没发出去'};
function wakeSetup(win){
  var left=0, raw=$('#wkRaw',win), ps=$('#wkPs',win), live=false;
  var AB='/heartbeat/admin/';
  /* 推送：/admin/push-events 不传 session_id = 全部会话（不分页，取最近 200 条）；改 / 删按 session_id + position 定位 */
  function loadPush(){ return P.net.get(AB+'push-events').then(function(r){ var a=((r&&r.items)||[]).slice(0,200), L=PUSHL(); L.length=0;
      a.forEach(function(x){ L.push([String(x.body||x.title||x.content||''),wkWhen(x.at),WCH[x.channel]||x.channel||'',x.sent===false?0:1,{pos:x.position,sid:x.session_id,title:x.title||''}]); }); live=true; WKST.push='ok'; ppaint(); },function(){ if(P.net.offline) P.net.offline(); WKST.push='fail'; PUSHL().length=0; ppaint(); }); }
  /* 原始日志：/admin/logs/wake-up?lines=1500，按「开始自动唤醒」切段取最近 10 段；下次醒来从日志里最后一句「到点 / 已设定定时唤醒」读出来 */
  function loadLog(){ return P.net.get(AB+'logs/wake-up?lines=1500').then(function(r){ var ls=(r&&r.lines)||[], g=[], cur=null;
      ls.forEach(function(l){ if(/开始自动唤醒/.test(l)){ cur=[l]; g.push(cur); } else if(cur) cur.push(l); });
      WKST.log='ok'; if(g.length){ WSEG.length=0; g.slice(-10).forEach(function(x){ WSEG.push(x); }); } repaint(true); wkKeep({seg:WSEG.slice()});
      var at=null, why='';
      for(var i=ls.length-1;i>=0&&!at;i--){ var m=ls[i].match(/到点 (\d{4}-\d\d-\d\d \d\d:\d\d)/)||ls[i].match(/已设定定时唤醒：(\d{4}-\d\d-\d\d \d\d:\d\d)/); if(m){ at=m[1]; var w=ls[i].match(/起点 \d{4}-\d\d-\d\d (\d\d:\d\d)（(.)天），阈值 (\d+) 分钟/); if(w) why=(w[2]==='白'?'白天':'夜里')+' · 起点 '+w[1]+' · 安静 '+w[3]+' 分钟叫他'; } }
      var d=at&&P.net.parse(at), now=Date.now();
      if(d&&d>now){ left=Math.round((d-now)/1000); $('#wkAt',win).textContent=at.slice(11); $('#wkWhy',win).textContent=why; }
      else { left=0; $('#wkAt',win).textContent='--:--'; $('#wkWhy',win).textContent=at?'上一次到点 '+at.slice(5)+'，等下一次检查':''; }
      tick(); },function(){ /* 拉失败：日志段已画出（缓存或内存态）就保留内容，只提示；空白才换失败框 */
        if(WSEG.length){ WKST.log='ok'; toast('没连上，先显示上次的日志'); } else { WKST.log='fail'; WSEG.length=0; }
        repaint(true); }); }
  function tick(){ var h=Math.floor(left/3600), m=Math.floor(left%3600/60), s=left%60; $('#wkCd',win).textContent=left>0?'还有 '+(h?h+':':'')+('0'+m).slice(-2)+':'+('0'+s).slice(-2):''; }
  /* [位置:phone-pages.js·唤醒页·下次醒来] [优先读后端 /v1/wake-next] [11-09：日志里不再有“起点 白/夜 阈值”那句，下次醒来改由后端直接说是哪一种——睡眠唤醒（聊天停多久）/ 闹钟（他设的、你设的）；取不到才用日志里读到的时刻] [注释时间 2026-11-09] */
  function nextWhy(n){
    if(n.kind==='cycle') return '睡眠 · 聊天停 '+(+n.thr||'—')+' 分钟叫他';
    if(n.kind==='slot') return '他设的定时';
    return (n.by==='user'?'你设的闹钟':'他设的闹钟')+(n.label?' · '+n.label:'');
  }
  function loadNext(){
    return P.net.get('/v1/wake-next',{noLogin:true}).then(function(r){
      if(!r||!r.ok) return false;
      var n=r.next, two=P.net.two;
      if(n){ var d=new Date(n.at); left=Math.max(0,Math.round((d-Date.now())/1000)); $('#wkAt',win).textContent=two(d.getHours())+':'+two(d.getMinutes()); $('#wkWhy',win).textContent=nextWhy(n); }
      else { left=0; $('#wkAt',win).textContent='--:--'; $('#wkWhy',win).textContent=r.locked?'等你下次聊天后重新计时':'还没有开事件唤醒的会话'; }
      wkKeep({next:n?{at:n.at,why:nextWhy(n)}:null});
      tick(); return true;
    },function(){ return false; });
  }
  /* loadNext 成功后把「下次醒来」卡存进缓存（含没有下次的 null 态，别让旧时刻顶着） */
  tick(); var tm=setInterval(function(){ if(!win.isConnected){ clearInterval(tm); return; } if(left>0) left--; tick(); },1000);
  requestAnimationFrame(function(){ raw.scrollTop=raw.scrollHeight; });
  function repaint(quiet){ raw.innerHTML=wkRaw(); $('#wkN',win).textContent='最近 '+WSEG.length+' 次 · 旧→新'; raw.scrollTo({top:raw.scrollHeight,behavior:quiet?'auto':'smooth'}); }
  function pcount(){ var n=PUSHN(); $('#wkPn',win).innerHTML=n[0]+' 条'+(n[1]?' · <span class="bad">'+n[1]+' 没送到</span>':''); }
  function ppaint(flash){ var st=ps.scrollTop; ps.innerHTML=wkPush(); ps.scrollTop=st; pcount(); if(flash!=null){ var n=ps.querySelector('[data-i="'+flash+'"]'); if(n) n.classList.add('flash'); } }
  /* [位置:phone-pages.js·wakeSetup·缓存秒开] [唤醒页先吃上次的日志段和下次醒来] [11-19 加载提速批 A：冷启动直开唤醒页时三张卡都在等网络；有缓存（ph_c_wake）先把最近 10 段日志和「下次醒来」卡填出来（倒计时按缓存的绝对时刻重算），后台照常拉新覆盖；推送管理卡数据大（200 条）不缓存、拉到再画。二次开页本就有内存态，这里主要救冷启动] [注释时间 2026-11-19] */
  var cW=P.net.peek('wake');
  if(cW){
    if(cW.seg&&cW.seg.length){ WSEG.length=0; cW.seg.forEach(function(x){ WSEG.push(x); }); WKST.log='ok'; repaint(true); }
    if(cW.next&&cW.next.at){ var dn=P.net.parse(cW.next.at), two0=P.net.two;
      if(dn){ left=Math.max(0,Math.round((dn-Date.now())/1000)); $('#wkAt',win).textContent=two0(dn.getHours())+':'+two0(dn.getMinutes()); $('#wkWhy',win).textContent=cW.next.why||''; } }
  }
  /* [位置:phone-pages.js·wakeSetup·wkKeep] [唤醒页缓存写入] [loadLog 存切段后的日志段（比 1500 行原始日志小得多）、loadNext 存下次醒来卡；两处写同一键用 merge，谁后到谁覆盖自己的字段] [注释时间 2026-11-19] */
  function wkKeep(patch){ var o=P.net.peek('wake')||{}; Object.keys(patch).forEach(function(k){ o[k]=patch[k]; }); P.net.keep('wake',o); }
  /* [位置:phone-pages.js·wakeSetup·整页加载] [唤醒页进页统一加载动画] [11-16 批3 L1：以前「下次醒来/推送管理/原始日志」三张卡各转各的小圈；现在进页铺一层整页加载动画（复用 PH.load.show page 档，白天纸船/夜里星光），推送+日志两个源都回来（失败也算回来，各自卡内显示失败态）再散去；点卡内「点一下重试」同样先铺整层] [注释时间 2026-11-16；2026-11-19 改：缓存已画出内容时不再铺整层动画盖住它，只有空白（无缓存）才铺] */
  var ld=null, ldone=0;
  function reveal(){ if(ldone) return; ldone=1; if(ld) ld.done(); }
  function refetch(){ ldone=0; ld=(!cW&&(window.PH&&PH.load))?PH.load.show(win,{page:true}):null;
    Promise.all([loadPush(),loadLog().then(loadNext)]).then(reveal,reveal); cW=null; }
  pcount(); refetch();
  win.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ WKST.log='load'; WKST.push='load'; repaint(true); ppaint(); refetch(); } });
  /* 推送：只认铅笔 / 垃圾桶 */
  ps.addEventListener('click',function(e){ var b=e.target.closest('[data-pe],[data-pd]'); if(!b) return; var it=b.closest('.wk5-pi'), i=+it.dataset.i, L=PUSHL(), p=L[i];
    var ref=p[4]||{};
    if(b.hasAttribute('data-pd')){ confirmBox(win,'删掉这条推送记录？','他的上下文里也不再出现这条。','删除',true,function(){
      if(live) P.net.post(AB+'push-events/delete',{session_id:ref.sid,position:ref.pos}).then(function(r){ if(r&&r.error){ toast(r.error); loadPush(); } },function(e){ toast(e&&e.status===409?'记录刚变过，刷新了一下':'没删掉'); loadPush(); });
      it.classList.add('gone'); setTimeout(function(){ L.splice(i,1); ppaint(); },320); toast('已删除'); }); return; }
    buzz(6); sheet(win,'改这条推送','<textarea class="pg-in" style="min-height:110px">'+esc(p[0])+'</textarea><div class="pg-bts" style="padding:14px 0 0">'+(p[3]||live?'':'<button class="pg-btn tap" data-run="run">重新推送</button>')+'<button class="pg-btn pri tap" data-sv>保存</button></div>',function(sh,close){
      sh.querySelector('[data-sv]').addEventListener('click',function(){ var v=sh.querySelector('textarea').value.trim(), bt=this; if(!v){ buzz([20,30,20]); return; }
        if(!live){ p[0]=v; close(); ppaint(i); toast('已修改'); buzz(8); return; }
        if(!bgo(bt)) return; P.net.post(AB+'push-events/update',{session_id:ref.sid,position:ref.pos,title:ref.title,body:v}).then(function(r){ if(r&&r.error){ bend(bt,false); toast(r.error); return; } bend(bt,true); later(function(){ p[0]=v; close(); ppaint(i); toast('已修改'); buzz(8); }); },function(e){ bend(bt,false); toast(e&&e.status===409?'记录刚变过，刷新后再改':'没存上'); loadPush(); }); }); });
  });
  $('#wkRf',win).addEventListener('click',function(){ var b=this; b.classList.add('spin'); buzz(6); var t0=Date.now();
    loadLog().then(loadNext).then(function(){ setTimeout(function(){ b.classList.remove('spin'); repaint(); toast('刷新了 · '+WSEG.length+' 次'); },Math.max(0,500-(Date.now()-t0))); }); });
  /* 唤醒参数：GET /admin/env 读；POST /admin/save 存（整表单接口，必须带 target_url / model_name，没带的字段保持原值；热生效，
     但已经排好的那一次检查还按旧间隔走） */
  P.net.get('/v1/wake-subs').then(function(r){ SUBS=((r&&r.items)||[]).map(function(x){ return [x.name,x.on?1:0,'',x.key]; }); },function(){});
  P.net.get('/v1/sleep-wake').then(function(r){ if(r&&r.config){ Object.assign(SW,r.config); SWOK=true; } },function(){});
  P.net.get('/v1/location-wake').then(function(r){ if(r&&r.config){ LOC.cooldownMin=r.config.cooldownMin; LOC.maxGapMin=r.config.maxGapMin; LOC.problem=(r.problem&&r.problem.msg)||''; LOCOK=true; } },function(){});
  /* 唤醒设置 */
  function swNoteText(){ var t=SW.note||''; return t?esc(t.length>12?t.slice(0,12)+'…':t):'无'; }
  /* [位置:phone-pages.js·唤醒设置·wpPaint] [唤醒提示词行（「睡眠唤醒的细节」组第三行）] [11-20：入口从配置页「用途提示词」组挪来——他叫醒时用什么提示词，对所有唤醒方式生效，所以不吃「睡眠唤醒」开关的变灰；点开走 P.pedit(0)（PROMPTS 下标 0），存取接口不变；字数与「改过」标记同配置页那两行，开页 P.pfetch(0) 现拉后刷新] [注释时间 2026-11-20] */
  function wpTag(){ var v=P.pvals&&P.pvals[0]; return (v&&v.custom_set)?' <span class="pg-tag">改过</span>':''; }
  function wpSub(){ var v=P.pvals&&P.pvals[0]; return (v&&P.plen)?P.plen(0).toLocaleString()+' 字':' '; }
  function wpPaint(t){
    var e=t||win.querySelector('[data-go="prw"]'); if(!e) return;
    var b=e.querySelector('.rt b'), sm=e.querySelector('.rt small');
    if(b) b.innerHTML='唤醒提示词'+wpTag();
    if(!sm){ sm=document.createElement('small'); if(b&&b.parentNode) b.parentNode.appendChild(sm); }
    if(sm) sm.textContent=wpSub();
  }
  function settings(){
    sub(win,'唤醒设置',
      grp('睡眠唤醒的细节'+hint('在开了“事件唤醒”的会话里，你最后一句话之后聊天停满这么久，就叫他一次，白天黑夜都一样。他醒过一次后，要等你再说话才重新计时。要不要叫由下面“你有动静时”里的“睡眠唤醒”开关管'),[
        r({t:'聊天停多久叫他',cls:'sw-dep'+(SW.enabled?'':' off'),st:{v:SW.afterMin,min:10,max:600,step:10}}),
        r({t:'叫他时多说一句',cls:'sw-dep'+(SW.enabled?'':' off'),v:swNoteText(),go:'note'}),
        r({t:'唤醒提示词'+wpTag(),s:wpSub(),go:'prw'})
      ],null,0)+
      grp('你设的闹钟'+hint('闹钟在聊天页右上角“…”里的“闹钟”设置，每个闹钟可以单独设“按概率响”。响铃前这么久你还在说话，这一轮就不响，每天的闹钟明天再响；0 表示照响不误'),[
        r({t:'刚聊过就不响（分钟）',st:{v:SW.userAlarmQuietMin,min:0,max:240,step:10}})
      ],null,1)+
      grp('你有动静时'+hint('在开了“事件唤醒”的会话里生效，这里关掉哪项就不再因它叫他。睡眠唤醒：你最后一句话之后聊天停满设定时间，叫一次。碎碎念：你每发一条叫一次。经期：你记录或修改经期时叫一次。心情：你自己记当天心情时叫一次，他写的不算。相册：你自己传图时叫一次。位置：来自手机“查岗”，只比较连续上报（两次相隔不超过 '+LOC.maxGapMin+' 分钟）的位置，地点和上次叫他时不同、且过了冷却才叫，上报断了就不比较、不叫。同类事件叫醒期间又来了新的，叫完补叫一次；你正在聊天时先让路'),[r({t:'睡眠唤醒',tg:1,on:SW.enabled,tgname:'se'})].concat(SUBS.map(function(x,i){ return r({t:x[0]+(x[2]?' <span class="wk3-un">'+x[2]+'</span>':''),s:(x[3]==='location'&&LOC.problem)?esc(LOC.problem):'',tg:1,on:x[1],tgname:'s'+i}); })),null,2)+
      grp('位置唤醒'+hint('地点变了叫他一次之后，这么久之内不再因为位置叫他；冷却期间发生的位置变化直接忽略、不补叫，冷却过后位置再变一次才会叫'),[
        r({t:'位置冷却（分钟）',st:{v:LOC.cooldownMin,min:5,max:240,step:5}})
      ],null,3)+
      grp('会话太长 <span class="pv-na-t">未接</span>',[r({t:'超过多少 k tok 提醒一次',st:{v:WS.tok,min:20,max:400,step:10}})],null,4)+
      '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-wks>保存</button></div>',
      {setup:function(pg){ pg.querySelector('[data-wks]').addEventListener('click',function(){ var b=this, v=[].map.call(pg.querySelectorAll('.pg-st input'),function(x){ return +x.value.replace(/,/g,''); });
          if(!SWOK){ toast('还没读到后台设置，稍后再存'); buzz([20,30,20]); return; }
          if(!bgo(b)) return;
          var jobs=[P.net.post('/v1/sleep-wake',{afterMin:v[0],userAlarmQuietMin:v[1]})]; if(LOCOK) jobs.push(P.net.post('/v1/location-wake',{cooldownMin:v[2]}));
          Promise.all(jobs).then(function(rs){ var r=rs[0], r2=rs[1]; if(r&&r.error){ bend(b,false); toast(r.error); return; } if(r2&&r2.error){ bend(b,false); toast(r2.error); return; } if(r&&r.config) Object.assign(SW,r.config); if(r2&&r2.config) LOC.cooldownMin=r2.config.cooldownMin; WS.tok=v[3]; bend(b,true); toast('存好了'); buzz([8,30,8]); loadNext(); },function(){ bend(b,false); toast('没存上'); buzz([20,30,20]); }); }); },
       toggle:function(t,on){
        if(t.dataset.tg==='se'){
          var deps=function(v){ [].forEach.call(win.querySelectorAll('.sw-dep'),function(el){ el.classList.toggle('off',!v); }); };
          var back=function(){ SW.enabled=!on; deps(!on); t.classList.toggle('on',!on); var sw=t.querySelector('.pg-sw'); if(sw) sw.setAttribute('aria-checked',on?'false':'true'); };
          if(!SWOK){ back(); toast('还没读到后台设置，稍后再试'); return; }
          SW.enabled=!!on; deps(!!on);
          P.net.post('/v1/sleep-wake',{enabled:!!on}).then(function(r){ if(r&&r.error){ back(); toast(r.error); return; } loadNext(); },function(){ back(); toast('没存上，稍后再试'); });
          return;
        }
        var x=SUBS[+t.dataset.tg.slice(1)]; if(!x) return; x[1]=on?1:0;
        P.net.post('/v1/wake-subs/switch',{key:x[3],on:!!on}).catch(function(){ x[1]=on?0:1; t.classList.toggle('on',!on); var sw=t.querySelector('.pg-sw'); if(sw) sw.setAttribute('aria-checked',on?'false':'true'); toast('没存上，稍后再试'); }); },
       go:function(g,t){
        if(g==='prw'){ if(P.pedit) P.pedit(win,0,function(){ wpPaint(t); }); return; }
        if(g==='note') sheet(win,'叫他时多说一句','<textarea class="pg-in" maxlength="500" placeholder="睡眠唤醒时，这段话会接在提示词后面一起告诉他。留空就不加" style="min-height:130px">'+esc(SW.note)+'</textarea><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>保存</button></div>',function(s,close){
          s.querySelector('[data-ok]').addEventListener('click',function(){ var bt=this, val=s.querySelector('textarea').value;
            if(!SWOK){ toast('还没读到后台设置，稍后再存'); buzz([20,30,20]); return; }
            if(!bgo(bt)) return;
            P.net.post('/v1/sleep-wake',{note:val}).then(function(r){ if(r&&r.error){ bend(bt,false); toast(r.error); return; } if(r&&r.config) SW.note=r.config.note; bend(bt,true); later(function(){ var rv=t.querySelector('.rv'); if(rv) rv.innerHTML=swNoteText(); close(); toast('存好了'); buzz(8); }); },function(){ bend(bt,false); toast('没存上'); buzz([20,30,20]); }); }); });
      }});
    if(P.pfetch) P.pfetch(0).then(function(){ wpPaint(); },function(){ wpPaint(); });
  }
  wire($('.pg',win),{back:function(){ closeWin(win); },go:function(k){ if(k==='set') settings(); }});
  P.wake={set:settings,raw:function(){ raw.scrollIntoView({block:'center'}); }};
}
P.register('wake',{html:wakeHTML,setup:wakeSetup});
})();

/* ===================== 第 5 组：标星 / 推送 / 永久上下文 / 工具集 / 提示词 / 信封 ===================== */
(function(){
"use strict";
var P=window.PH, G=P&&P.pages; if(!G) return;
var bgo=P.bgo, bend=P.bend, later=P.later;   /* 保存按钮动效（定义在文件第一块） */
var $=P.$, buzz=P.buzz, toast=P.toast, I=G.I, r=G.r, grp=G.grp, sub=G.sub, subLoad=G.subLoad, sheet=G.sheet, confirmBox=G.confirm, wire=G.wire, btns=G.btns, seg=G.seg, hold=G.hold;   /* [2026-11-14] 补导入 hold：第一组的局部函数（:250），组间共享走 P.pages——permSetup :2768 裸调它在开页时必抛 ReferenceError，长按删除/拖拽排序/P.perm2 的挂接全断在半截（自入库就有，见 05汇总q5） */
/* [位置:phone-pages.js·P.chatFontSheet] [聊天字体选择弹层] [设置 → 主题 →「字体与字号」两行（中文字体 / 英文字体）共用（2026-10-31：从聊天外观页挪进主题页）；每个选项用它自己的字体显示名字和一句示例；点选立刻存本机并生效（P.chatFont.set 会重写 --cfont），已经打开着的聊天页马上变] [注释时间 2026-10-22] */
P.chatFontSheet=function(win,kind){ var cf=P.chatFont; if(!cf) return; var cur=cf.get(kind), L=kind==='cn'?cf.CN:cf.EN; cf.preload(kind);
  var samp=kind==='cn'?'还没睡呀。今天 23:40 了，我一直在等你。':'Okay, I’m here — 23:40, still awake?';
  sheet(win,kind==='cn'?'中文字体':'英文字体','<div class="pg-g">'+L.map(function(x){ var fa=cf.famAttr(kind,x.id);
    return '<button class="pg-r tap" type="button" data-cf="'+x.id+'"><span class="rt"><b style="font-family:'+fa+'">'+esc(x.name)+'</b><small>'+esc(x.desc)+'</small>'+(x.id==='none'?'':'<small style="font-family:'+fa+';font-size:14px;opacity:.8;margin-top:3px">'+esc(samp)+'</small>')+'</span><span class="rv">'+(x.id===cur?'使用中':'')+'</span></button>'; }).join('')+'</div><div class="pg-foot" style="padding:8px 4px;font-size:12px;opacity:.55">只改聊天页的字体，选完马上生效</div>',function(box,close){
    box.addEventListener('click',function(e){ var b=e.target.closest('[data-cf]'); if(!b) return; cf.set(kind,b.getAttribute('data-cf')); buzz(8);
      [].forEach.call(win.querySelectorAll('[data-go="'+(kind==='cn'?'cfcn':'cfen')+'"] .rv'),function(v){ v.textContent=cf.nameOf(kind); });
      [].forEach.call(box.querySelectorAll('[data-cf] .rv'),function(v){ v.textContent=''; }); b.querySelector('.rv').textContent='使用中'; setTimeout(close,260); }); }); };
var esc=P.esc||function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
function closeWin(win){ var b=win.querySelector('.back'); if(b) b.click(); }
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
/* [位置:phone-pages.js·wallLocal] [后端 UTC 时间转本机时间] [11-07：记忆池 / 工具集这些接口给的时间都是 toISOString 的 UTC（带 Z），前端原来直接切字符串当墙上时间印，比北京时间少 8 小时、跨夜连日期都错；统一走这里转本地再显示。返回 {d:'MM-DD', hm:'HH:mm', ym:'YYYY.MM.DD'}，解析不出来返回 null] [注释时间 2026-11-07] */
function wallLocal(iso){ var d=P.net.parse(iso); if(!d) return null;
  return {d:P.net.two(d.getMonth()+1)+'-'+P.net.two(d.getDate()), hm:P.net.two(d.getHours())+':'+P.net.two(d.getMinutes()), ym:d.getFullYear()+'.'+P.net.two(d.getMonth()+1)+'.'+P.net.two(d.getDate())}; }
var hold=G.hold;
var X={x:svg('<path d="M7 7l10 10M17 7 7 17"/>'),drag:svg('<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/>'),edit:svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),copy:svg('<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),trash:svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),env:svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7.5 8.5 6 8.5-6"/>'),restart:svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>')};

/* ---------- 标星管理：/admin/context-compaction/marked-list（content / role / time / markedAt / in_context），
   改字 /marked/update，取消 /mark {marked:false}。不分类，重在管：搜、排序、改、批量取消，看清占了多少字、哪句没进上下文。 ---------- */
var STARS=[];
var TOTAL=0, CHARS=0;
var SX={ex:'<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',arr:'<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',sort:'<svg viewBox="0 0 24 24"><path d="M4 7h11M4 12h8M4 17h5M18 6v13M15 16l3 3 3-3"/></svg>',sel:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',edit:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',un:'<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/><path d="M4 4l16 16"/></svg>'};
function starHTML(){ return G.shell('标星','<button class="pg-cb tap" id="stEx" aria-label="导出">'+SX.ex+'</button>',
  '<div class="pg-search st3-s">'+I.find+'<input class="pg-in" id="stQ" placeholder="搜一句话、日期" aria-label="搜标星"><span id="stHit" aria-live="polite"></span></div>'+
  '<div class="st3-bar"><span class="st3-sum"><b id="stN">'+TOTAL+'</b> 句 · <b id="stC">'+CHARS.toLocaleString()+'</b> 字</span><button class="st3-out tap" id="stO" hidden></button><span style="flex:1"></span>'+
    '<button class="st3-ord tap" id="stOrd" aria-label="切换顺序"><span>最早在前</span>'+SX.arr+'</button><button class="st3-ic tap" id="stSel" aria-label="多选">'+SX.sel+'</button></div>'+
  '<div class="st3" id="stL"></div><div class="st2-more" id="stMore"></div>'); }
function starSetup(win){
  var open={}, L=$('#stL',win), LD=subLoad(L.closest('.pg'),L), q='', asc=true, onlyOut=false, picking=false, sel={}, live=false, st='load';
  var SB='/heartbeat/admin/context-compaction/';
  /* 真数据：marked-list 一次全给（不分页）。in_context 是拿「最后一次发给模型的请求」比的，网关刚重启时全是 false——
     这时就当不知道，不标「未进上下文」，免得一片红。 */
  function tk(s){ return s.t||('2026-'+s.d); }
  function load(){ st='load'; return P.net.get(SB+'marked-list').then(function(r){ var a=(r&&r.results)||[], any=a.some(function(x){ return x.in_context; });
      STARS.length=0; a.forEach(function(x){ var t=String(x.time||x.markedAt||'').replace('T',' ').slice(0,16); STARS.push({x:String(x.content||''),w:x.role==='assistant'?'ai':'me',d:t.slice(5),t:t,m:String(x.markedAt||'').slice(5,10),in:any?(x.in_context?1:0):1,key:x.key,role:x.role}); });
      TOTAL=STARS.length; CHARS=STARS.reduce(function(n,s){ return n+s.x.length; },0); live=true; st='ok'; paint(); stats(); },function(e){ st='fail'; STARS.length=0; TOTAL=0; CHARS=0; paint(); stats(); toast('没连上后台'); }); }
  function mark(s,on){ if(!live) return Promise.resolve(); return P.net.post(SB+'mark',on?{key:s.key,marked:true,content:s.x,role:s.role}:{key:s.key,marked:false}).catch(function(){ toast(on?'没恢复成功':'没取消成功，刷新一下'); load(); }); }
  function len(s){ return s.x.length; }
  function hl(s){ var h=esc(s); if(!q) return h; var k=esc(q); return h.split(k).join('<mark>'+k+'</mark>'); }
  function stMe(){ return (P.names&&P.names.me)?P.names.me():'用户'; }
  function stAi(){ return (P.names&&P.names.ai)?P.names.ai():'助手'; }
  function stLet(w){ return (P.names&&P.names.letter)?P.names.letter(w):(w==='ai'?'助':'用'); }
  function match(s){ return !q||s.x.indexOf(q)>=0||s.d.indexOf(q)>=0||((q==='他'||q===stAi())&&s.w==='ai')||((q==='我'||q===stMe())&&s.w==='me'); }
  function current(){ return STARS.filter(function(s){ return match(s)&&(!onlyOut||!s.in); }).sort(function(a,b){ var ka=tk(a), kb=tk(b), ma=ka.slice(0,7), mb=kb.slice(0,7); if(ma!==mb) return (ma<mb?-1:1)*(asc?1:-1); return ka<kb?-1:ka>kb?1:0; }); }   /* 1021：切换顺序只翻月份；月内永远正序 */
  function stats(){ $('#stN',win).textContent=TOTAL; $('#stC',win).textContent=CHARS.toLocaleString(); var o=STARS.filter(function(s){ return !s.in; }).length, b=$('#stO',win); b.hidden=!o; b.textContent=onlyOut?'看全部':o+' 句未进上下文'; b.classList.toggle('on',onlyOut); }
  var CUT=100;
  function body(s){ var t=s.x; if(t.length<=CUT||q&&t.indexOf(q)>=CUT||open[tk(s)+s.key]) return hl(t)+(t.length>CUT?' <button type="button" class="st3-tg tap" data-tg>收起</button>':''); return hl(t.slice(0,CUT))+'…'+' <button type="button" class="st3-tg tap" data-tg>展开全部</button>'; }
  var sImap=null;   /* [位置:phone-pages.js·starSetup sImap] [渲染下标查表] [2026-10-27 审查：同记忆池，paint 建一次 Map 替掉逐行 indexOf] [注释时间 2026-10-27] */
  function card(s){ var i=(sImap&&sImap.get(s)!=null)?sImap.get(s):STARS.indexOf(s); return '<div class="st3-c pg-rise'+(s.w==='me'?' me':'')+(sel[i]?' sel':'')+(s.in?'':' out')+'" data-i="'+i+'" role="button" tabindex="0"><i class="ck" aria-hidden="true">'+I.ok+'</i><p>'+body(s)+'</p><div class="ft"><span class="av '+s.w+'" data-l="'+esc(stLet(s.w))+'"></span><span>'+s.d+'</span><span>'+len(s)+' 字</span>'+(s.in?'':'<em>未进上下文</em>')+'<button class="un tap" data-un aria-label="取消标星">'+I.star+'</button></div></div>'; }
  function paint(){
    sImap=new Map(); STARS.forEach(function(x,i){ sImap.set(x,i); });
    var list=current(), G=[], mp={};
    list.forEach(function(s){ var k=tk(s).slice(0,7); if(!mp[k]){ mp[k]={m:k.slice(5),a:[]}; G.push(mp[k]); } mp[k].a.push(s); });
    L.classList.toggle('picking',picking);
    L.innerHTML=list.length?G.map(function(g){ return '<div class="st3-mh"><b>'+(+g.m)+' 月</b><small>'+g.a.length+'</small></div>'+g.a.map(card).join(''); }).join(''):'<div class="pg-empty" id="stE">'+(q?'没有「'+esc(q)+'」':st==='fail'?'没连上后台，点一下重试':'还没有标星')+'</div>';
    /* 还在读（marked-list 没回来）：整页转圈。原来是把动画塞进 .st3 里——那容器高度 0，动画算出来的框高 0，屏幕上根本看不见（11-05 实测）*/
    if(!list.length&&st==='load'&&!q){ LD.on(); } else { LD.off(); }
    $('#stHit',win).textContent=q?list.length+' 句':'';
    $('#stMore',win).textContent=list.length&&!q&&!onlyOut&&TOTAL>STARS.length?'再往下 '+(TOTAL-STARS.length)+' 句':'';
    P.markAv&&P.markAv(); bar();
  }
  function bar(){ var b=$('.st2-bar',win), n=Object.keys(sel).length, c=Object.keys(sel).reduce(function(a,i){ return a+len(STARS[i]); },0);
    if(!picking){ if(b){ b.classList.remove('show'); setTimeout(function(){ b.remove(); },300); } return; }
    if(!b){ b=document.createElement('div'); b.className='st2-bar'; $('.pg',win).appendChild(b); requestAnimationFrame(function(){ b.classList.add('show'); });
      b.addEventListener('click',function(e){ var x=e.target.closest('[data-b]'); if(!x) return; var k=x.dataset.b;
        if(k==='all'){ var vis=current(), all=vis.every(function(s){ return sel[(sImap&&sImap.get(s)!=null)?sImap.get(s):STARS.indexOf(s)]; }); sel={}; if(!all) vis.forEach(function(s){ sel[(sImap&&sImap.get(s)!=null)?sImap.get(s):STARS.indexOf(s)]=1; }); buzz(6); paint(); }
        else if(k==='ex') exportSheet('sel'); else if(k==='x') setPick(false); else unstarMany(); }); }
    b.innerHTML='<button class="tap" data-b="x" aria-label="退出多选">'+svg('<path d="M6 6l12 12M18 6 6 18"/>')+'</button><button class="tap" data-b="all">全选</button><button class="tap'+(n?'':' dis')+'" data-b="ex">导出</button><button class="tap red'+(n?'':' dis')+'" data-b="un">取消'+(n?' '+n+' 句':'')+'</button>';
  }
  function setPick(on){ var u=$('.st2-undo',win); if(u) u.remove(); picking=on; sel={}; $('#stSel',win).classList.toggle('on',on); buzz(6); paint(); }
  function remove(ids){ var c=0; ids.sort(function(a,b){ return b-a; }).forEach(function(i){ c+=len(STARS[i]); STARS.splice(i,1); }); TOTAL-=ids.length; CHARS-=c; return c; }
  function bump(){ ['#stN','#stC'].forEach(function(k){ var e=$(k,win); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }); }
  function unstarMany(){ var ids=Object.keys(sel).map(Number); if(!ids.length){ toast('先点选'); buzz([12,30,12]); return; }
    G.confirm(win,'取消 '+ids.length+' 句标星？','聊天里的原话还在，只是不再一直带在他的上下文里。','取消标星',true,function(){ ids.forEach(function(i){ mark(STARS[i],false); });  ids.forEach(function(i){ var el=L.querySelector('[data-i="'+i+'"]'); if(el) el.classList.add('gone'); }); setTimeout(function(){ var c=remove(ids); picking=false; sel={}; $('#stSel',win).classList.remove('on'); paint(); stats(); bump(); toast('省下 '+c+' 字'); buzz([8,30,8]); },340); }); }
  function unstar(i){ var s=STARS[i], el=L.querySelector('[data-i="'+i+'"]'); if(el) el.classList.add('gone'); buzz([8,30,8]); mark(s,false);
    setTimeout(function(){ remove([i]); paint(); stats(); bump(); },340);
    undo('取消了一句',function(){ mark(s,true); STARS.splice(i,0,s); TOTAL++; CHARS+=len(s); paint(); stats(); var n=L.querySelector('[data-i="'+i+'"]'); if(n) n.classList.add('flash'); }); }
  function undo(msg,fn){ var o=$('.st2-undo',win); if(o) o.remove(); var u=document.createElement('div'); u.className='st2-undo'; u.innerHTML='<span>'+msg+'</span><button class="tap">撤销</button>'; $('.pg',win).appendChild(u); requestAnimationFrame(function(){ u.classList.add('show'); });
    var t=setTimeout(function(){ u.classList.remove('show'); setTimeout(function(){ u.remove(); },300); },4000); u.querySelector('button').addEventListener('click',function(){ clearTimeout(t); u.classList.remove('show'); setTimeout(function(){ u.remove(); },300); fn(); buzz(8); }); }
  function edit(i){ var s=STARS[i];
    sheet(win,(s.w==='ai'?stAi():stMe())+' · '+s.d,'<textarea class="pg-in st2-ta">'+esc(s.x)+'</textarea><div class="st2-cnt"><span id="stCnt">'+len(s)+'</span> 字</div>',function(sh,close){
      var ta=sh.querySelector('textarea'); ta.addEventListener('input',function(){ var d=ta.value.length-len(s); sh.querySelector('#stCnt').textContent=ta.value.length+(d?' ('+(d>0?'+':'')+d+')':''); });
      sh.querySelector('[data-sv]').addEventListener('click',function(){ var v=ta.value.trim(); if(!v){ ta.focus(); buzz([20,30,20]); return; }
        function done(c){ CHARS+=c.length-len(s); s.x=c; close(); paint(); stats(); var n=L.querySelector('[data-i="'+i+'"]'); if(n) n.classList.add('flash'); toast('改好了'); buzz(8); }
        if(!live){ done(v); return; } var b=this; if(!bgo(b)) return;
        P.net.post(SB+'marked/update',{key:s.key,content:v}).then(function(r){ if(r&&r.error){ bend(b,false); toast(r.error); return; } bend(b,true); later(function(){ done((r&&r.content)||v); }); },function(){ bend(b,false); toast('没存上，稍后再试'); buzz([20,30,20]); }); });
    },'<button class="pg-cb tap" data-sv aria-label="保存">'+I.ok+'</button>'); }
  /* 导出：默认范围跟着当前情况走（多选了 → 选中的；在搜 → 搜到的；否则全部） */
  /* 导出：只出纯文本，格式同 chat 端「导出 TXT」（「2026年10月12日 18:54 · 用户」↵正文↵↵---）。
     范围跟着当前情况走：多选了 → 选中的；在搜 / 只看未进上下文 → 当前列表；否则全部（按时间正序）。点了选「复制」或「存成文件」就直接做。 */
  /* [位置:phone-pages.js·标星导出text] [AI署名统一为谢] [10-29 产品要求导出署名旧称"小机"改"谢"，与 chat 端标星导出一致；面板内显示用"他"，不受影响] [注释时间 2026-10-29] */
  function exportSheet(){
    var byT=function(a,b){ var x=tk(a), y=tk(b); return x<y?-1:x>y?1:0; };
    var l=picking&&Object.keys(sel).length?current().filter(function(s){ return sel[STARS.indexOf(s)]; }).sort(byT):(q||onlyOut)?current().sort(byT):STARS.slice().sort(function(a,b){ var x=tk(a), y=tk(b); return x<y?-1:x>y?1:0; });
    if(!l.length){ toast('这里没有可导出的'); buzz([12,30,12]); return; }
    function text(){ return l.map(function(s){ var m=tk(s).match(/^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)/); return (m?m[1]+'年'+(+m[2])+'月'+(+m[3])+'日 '+m[4]+' · ':'')+(s.w==='ai'?stAi():stMe())+'\n'+s.x.trim()+'\n\n---'; }).join('\n\n')+'\n'; }
    var EX={cp:'<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',dl:'<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'};
    var old=win.querySelector('.st3-pop'); if(old){ old.remove(); return; }
    var pop=document.createElement('div'); pop.className='st3-pop'; pop.innerHTML='<small>'+l.length+' 句 · TXT</small><button type="button" data-ex="cp">'+EX.cp+'复制</button><button type="button" data-ex="dl">'+EX.dl+'存成文件</button>';
    win.querySelector('.content').appendChild(pop); buzz(6); requestAnimationFrame(function(){ pop.classList.add('show'); });
    function close(){ pop.classList.remove('show'); document.removeEventListener('pointerdown',off,true); setTimeout(function(){ pop.remove(); },220); }
    function off(e){ if(!pop.contains(e.target)&&!e.target.closest('#stEx')) close(); }
    setTimeout(function(){ document.addEventListener('pointerdown',off,true); },0);
    pop.addEventListener('click',function(e){ var b=e.target.closest('[data-ex]'); if(!b) return;
      if(b.dataset.ex==='cp'){ var tx=text(), okc=function(){ close(); toast('复制了 '+l.length+' 句'); buzz(8); }, bad=function(){ var ta=document.createElement('textarea'); ta.value=tx; ta.style.cssText='position:fixed;left:-999px;top:0;opacity:0'; document.body.appendChild(ta); ta.select(); var g=false; try{ g=document.execCommand('copy'); }catch(_e){} ta.remove(); if(g) okc(); else toast('复制没成功，换个方式试试'); };
        try{ navigator.clipboard.writeText(tx).then(okc,bad); }catch(er){ bad(); } return; }
      var d=new Date(), p=function(n){ return (n<10?'0':'')+n; }, blob=new Blob(['﻿',text()],{type:'text/plain;charset=utf-8'}), a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='标星内容_'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'.txt'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },800); close(); toast('已导出 '+l.length+' 条标星内容'); buzz([8,30,8]); });
  }
  paint(); stats(); wire($('.pg',win),{}); load();
  var sqT=0;   /* [位置:phone-pages.js·stQ 防抖] [搜索输入 120ms 合并，同记忆池] [注释时间 2026-10-27] */
  $('#stQ',win).addEventListener('input',function(){ q=this.value.trim(); clearTimeout(sqT); sqT=setTimeout(paint,120); });
  $('#stOrd',win).addEventListener('click',function(){ asc=!asc; this.classList.toggle('asc',asc); this.querySelector('span').textContent=asc?'最早在前':'最新在前'; buzz(6); L.classList.remove('flip'); void L.offsetWidth; L.classList.add('flip'); paint(); });
  $('#stO',win).addEventListener('click',function(){ onlyOut=!onlyOut; buzz(6); stats(); paint(); });
  $('#stSel',win).addEventListener('click',function(){ setPick(!picking); });
  $('#stEx',win).addEventListener('click',function(){ buzz(6); exportSheet(picking&&Object.keys(sel).length?'sel':null); });
  /* 点卡片 = 改；多选时 = 选；长按 = 进多选；星星 = 取消 */
  var lp=0, lpd=false;
  L.addEventListener('pointerdown',function(e){ var c=e.target.closest('.st3-c'); if(!c||picking||e.target.closest('[data-un]')||e.target.closest('[data-tg]')) return; lpd=false; c.classList.add('press'); lp=setTimeout(function(){ lpd=true; c.classList.remove('press'); setPick(true); sel[+c.dataset.i]=1; paint(); buzz([10,40,14]); },480); });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){ L.addEventListener(ev,function(){ clearTimeout(lp); [].forEach.call(L.querySelectorAll('.st3-c.press'),function(x){ x.classList.remove('press'); }); },true); });
  L.addEventListener('scroll',function(){ clearTimeout(lp); },true);
  L.addEventListener('click',function(e){ if(lpd){ lpd=false; return; }
    var tg=e.target.closest('[data-tg]'); if(tg){ e.stopPropagation(); var tc=tg.closest('.st3-c'), ts=STARS[+tc.dataset.i], tkk=tk(ts)+ts.key; if(open[tkk]) delete open[tkk]; else open[tkk]=1; buzz(5); tc.querySelector('p').innerHTML=body(ts); return; }
    if(st==='fail'&&e.target.closest('#stE')){ buzz(6); paint(); load(); return; }
    var c=e.target.closest('.st3-c'); if(!c) return; var i=+c.dataset.i;
    if(e.target.closest('[data-un]')&&!picking){ unstar(i); return; }
    if(picking){ if(sel[i]) delete sel[i]; else sel[i]=1; c.classList.toggle('sel'); buzz(5); bar(); return; }
    buzz(6); edit(i); });
  L.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var c=e.target.closest('.st3-c'); if(c) c.click(); } });
  if(P.starFocus){ var sf=P.starFocus; P.starFocus=null; setTimeout(function(){ var k=-1; STARS.forEach(function(s,i){ if(k<0&&(s.x===sf||s.x.indexOf(sf)>=0||sf.indexOf(s.x)>=0)) k=i; }); var n=k>=0&&L.querySelector('[data-i="'+k+'"]'); if(n){ n.scrollIntoView({block:'center',behavior:'smooth'}); n.classList.add('flash'); } },650); }
  P.star={open:function(){ L.querySelector('.st3-c').click(); },pick:function(){ setPick(true); [0,4,7].forEach(function(i){ sel[i]=1; }); paint(); },unstar:function(i){ unstar(i||1); },order:function(){ $('#stOrd',win).click(); },search:function(v){ var x=$('#stQ',win); x.value=v; x.dispatchEvent(new Event('input')); },exp:function(){ $('#stEx',win).click(); }};
}
P.register('star',{html:starHTML,setup:starSetup});

/* ---------- 推送管理：/admin/push-events（update / delete） ---------- */
var PUSH=[];   /* 演示推送已删（2026-10-22） */
/* 推送 app 已删（唤醒里有推送管理），这份示例数据给唤醒页用 */
P.pushData=function(){ return PUSH; };

/* ---------- 永久上下文：/admin/logs/pinned（list / 增 / 改 / 删 / reorder，一段 = {id,title,content}），每次请求都固定带上。
   照旧小手机：一段一张卡，默认全展开；顶上一条连着的导航（滑到哪段亮哪段，点一下跳过去）；长按卡片直接拖着排；
   右上「调整顺序」= 全部收起好拖；卡片右上「编辑」→ 改完点 ✓ 存回去。示例文字是编的（真实内容私密，不放进预览页）。 */
/* [位置:phone-pages.js·permMount/P.openPermSub] [永久上下文页按作用域复用] [11-25：桌面/抽屉入口管理全局默认；预设编辑页点进子页复用同一套 UI 与逻辑，通过 preset_id 读写独立文件、绝不串数据] [注释时间 2026-11-25] */
var PINS=[];   /* 演示数据已删（2026-10-22） */
function permHeadRight(){ return '<span class="pv-hd"><button class="pg-cb tap" id="pmS" data-pms aria-label="调整顺序">'+X.drag+'</button><button class="pg-cb tap" id="pmA" data-pma aria-label="新增一段">'+I.plus+'</button></span>'; }
function permHTML(){ return G.shell('永久上下文',permHeadRight(),'<div class="pm2-l" id="pmL"></div><div class="pm2-pad" id="pmP"></div>','<nav class="pm2-nav" id="pmN"></nav>'); }
function permMount(root,win,opts){
  opts=opts||{};
  var pid=opts.presetId?String(opts.presetId):'';
  var qs=pid?('?preset_id='+encodeURIComponent(pid)):'';
  var items=pid?[]:PINS;
  var L=root.querySelector('.pm2-l'), N=root.querySelector('.pm2-nav'), sc=root.querySelector('.pg-sc'), pad=root.querySelector('.pm2-pad');
  var btnS=root.querySelector('[data-pms]'), btnA=root.querySelector('[data-pma]');
  var fold=false, lock=0, live=false, pst='load', LD=subLoad(root.classList&&root.classList.contains('pg')?root:L.closest('.pg'),L);
  var PB='/heartbeat/admin/logs/pinned';
  function notify(touched){ if(opts.onChange) opts.onChange(items.length,!!touched); }
  function load(){ return P.net.get(PB+qs).then(function(r){ var a=(r&&r.list)||[]; items.length=0; a.forEach(function(x){ items.push([String(x.title||''),String(x.content||''),x.id]); }); live=true; pst='ok'; paint(); LD.off(); notify(false); setTimeout(function(){ fit(); spy(true); },60); },function(){ if(P.net.offline) P.net.offline(); pst='fail'; items.length=0; paint(); LD.off(); }); }
  root.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ pst='load'; LD.on(); load(); } });
  function fail(m){ toast(m||'没存上，刷新一下'); buzz([20,30,20]); load(); }
  function card(p,i){ return '<section class="pm2-c" data-i="'+i+'"><div class="pm2-h"><span class="no">'+(i+1)+'</span><b>'+esc(p[0])+'</b><em>'+p[1].length.toLocaleString()+' 字</em><span class="pm2-gp" data-gp aria-label="拖动排序">'+X.drag+'</span><button class="pm2-ed tap" type="button" data-ed aria-label="编辑">'+X.edit+'</button></div><div class="pm2-b"><div><p>'+esc(p[1]).replace(/\n/g,'<br>')+'</p></div></div></section>'; }
  function top(el){ return el.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop; }
  function paint(){ L.innerHTML=pst==='load'?'':pst==='fail'?P.net.failBox():items.length?items.map(card).join(''):'<div class="pg-empty">还没有永久上下文</div>'; N.innerHTML=items.map(function(p,i){ return '<button type="button" data-n="'+i+'">'+esc(p[0])+'</button>'; }).join('')+'<i class="ul"></i>'; L.classList.toggle('fold',fold); spy(true); setTimeout(fit,fold?420:0); }
  function fit(){ var l=L.lastElementChild; pad.style.height=l?Math.max(0,sc.clientHeight-l.offsetHeight-28)+'px':'0'; }
  function mark(i,now){ var on=null; [].forEach.call(N.querySelectorAll('[data-n]'),function(b){ var y=+b.dataset.n===i; b.classList.toggle('on',y); if(y) on=b; }); if(!on) return; var ul=N.querySelector('.ul'); if(now) ul.style.transition='none'; ul.style.width=Math.max(14,on.offsetWidth-26)+'px'; ul.style.transform='translateX('+(on.offsetLeft+13)+'px)'; if(now){ void ul.offsetWidth; ul.style.transition=''; } N.scrollTo({left:on.offsetLeft-N.clientWidth/2+on.offsetWidth/2,behavior:'smooth'}); }
  function spy(now){ if(now!==true&&Date.now()-lock<650) return; var cur=0; [].forEach.call(L.children,function(c,i){ if(top(c)-sc.scrollTop<=24) cur=i; }); if(sc.scrollTop+sc.clientHeight>=sc.scrollHeight-2&&!pad.offsetHeight) cur=L.children.length-1; mark(cur,now===true); }
  var spyT=0; sc.addEventListener('scroll',function(){ if(spyT) return; spyT=requestAnimationFrame(function(){ spyT=0; spy(); }); },{passive:true});
  N.addEventListener('click',function(e){ var b=e.target.closest('[data-n]'); if(!b) return; var c=L.children[+b.dataset.n]; lock=Date.now(); sc.scrollTo({top:top(c)-8,behavior:'smooth'}); mark(+b.dataset.n); buzz(5); });
  paint(); if(!pid) wire($('.pg',win),{}); setTimeout(function(){ fit(); spy(true); },700); load();
  btnS.addEventListener('click',function(){ var ing=L.querySelector('.ing [data-ed]'); if(ing) ing.click(); fold=!fold; this.innerHTML=fold?I.ok:X.drag; L.classList.toggle('fold',fold); buzz(6); setTimeout(function(){ fit(); lock=0; spy(true); },440); if(!fold) toast('顺序存好了'); });
  function fd2(l,inner){ return '<div class="pv-fd"><label>'+l+'</label>'+inner+'</div>'; }
  btnA.addEventListener('click',function(){ buzz(6);
    var pg=sub(win,'新增一段','<div class="pg-g pv-form pm2-new">'+fd2('标题','<span class="pm2-tw"><input class="pg-in" id="pnT" placeholder="这一段叫什么"><button class="pm2-clr tap" type="button" aria-label="清空">'+X.x+'</button></span>')+fd2('内容','<textarea class="pg-in" id="pnX" placeholder="写给他的，每次请求都会带上"></textarea>')+'</div>'+btns([['加上','','pri']]));
    setTimeout(function(){ pg.querySelector('#pnT').focus(); },380);
    pg.querySelector('.pm2-clr').addEventListener('click',function(){ var t=pg.querySelector('#pnT'); t.value=''; t.focus(); buzz(5); });
    pg.querySelector('.pg-btn.pri').addEventListener('click',function(){ var t=pg.querySelector('#pnT').value.trim(), v=pg.querySelector('#pnX').value.trim(); if(!t){ pg.querySelector('#pnT').focus(); buzz([20,30,20]); return; } if(!v){ pg.querySelector('#pnX').focus(); buzz([20,30,20]); return; }
      if(live){ var bt=this; bt.classList.add('busy'); P.net.post(PB+qs,{title:t,content:v}).then(function(r){ bt.classList.remove('busy'); if(!r||!r.memory){ toast('这段内容已经有了'); buzz([20,30,20]); return; } items.push([r.memory.title||t,r.memory.content||v,r.memory.id]); notify(true); after(); },function(){ bt.classList.remove('busy'); toast('没加上，稍后再试'); buzz([20,30,20]); }); return; }
      toast('没连上后台，没加上'); return;
      function after(){ pg.querySelector('[data-x="back"]').click(); if(fold) btnS.click(); paint(); setTimeout(function(){ var c=L.lastElementChild; lock=Date.now(); sc.scrollTo({top:top(c)-8,behavior:'smooth'}); mark(items.length-1); c.classList.add('flash'); toast('加在最后了'); buzz(8); },420); } });
  });
  function edit(c){ var i=+c.dataset.i, p=items[i], h=c.querySelector('.pm2-h'), bd=c.querySelector('.pm2-b>div');
    c.classList.add('ing'); h.querySelector('b').outerHTML='<span class="pm2-tw"><input class="pm2-ti" value="'+esc(p[0])+'" placeholder="这一段叫什么"></span>';
    bd.innerHTML='<textarea class="pm2-ta" placeholder="写给他的，每次请求都会带上">'+esc(p[1])+'</textarea>';
    var ta=bd.querySelector('textarea');
    var mir=null;
    function meas(txt){ if(!mir){ mir=document.createElement('div'); document.body.appendChild(mir); } var cs=getComputedStyle(ta); var css='position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;width:'+ta.offsetWidth+'px;box-sizing:'+cs.boxSizing+';font:'+cs.font+';line-height:'+cs.lineHeight+';padding:'+cs.padding+';border:'+cs.borderTopWidth+' solid transparent;letter-spacing:'+cs.letterSpacing; if(mir._css!==css){ mir._css=css; mir.style.cssText=css; } mir.textContent=txt+'\u200b'; return mir.offsetHeight; }
    function caretBottom(){ return ta.getBoundingClientRect().top+meas(ta.value.slice(0,ta.selectionStart||0))-ta.scrollTop-(parseFloat(getComputedStyle(ta).paddingBottom)||0); }
    function seeCaret(){ if(!ta.isConnected){ if(mir){ mir.remove(); mir=null; } return; } var vv=window.visualViewport, lim=Math.min(sc.getBoundingClientRect().bottom, vv?vv.offsetTop+vv.height:1e9)-24, cb=caretBottom(); if(cb>lim) sc.scrollTop+=cb-lim; else { var tp=sc.getBoundingClientRect().top+60; if(cb<tp) sc.scrollTop-=tp-cb; } }
    function grow(){ var h=Math.max(120,meas(ta.value)); if(Math.abs(h-ta.offsetHeight)>1) ta.style.height=h+'px'; }
    grow(); ta.addEventListener('input',function(){ grow(); seeCaret(); setTimeout(seeCaret,120); setTimeout(seeCaret,420); });
    var vv=window.visualViewport;
    function onVV(){ if(!ta.isConnected){ vv.removeEventListener('resize',onVV); vv.removeEventListener('scroll',onVV); sc.style.paddingBottom=''; if(mir){ mir.remove(); mir=null; } return; }
      var kb=Math.max(0,innerHeight-vv.height-vv.offsetTop); sc.style.paddingBottom=kb>60?(kb+60)+'px':''; void c.offsetHeight; seeCaret(); setTimeout(seeCaret,120); setTimeout(seeCaret,400); }
    if(vv){ vv.addEventListener('resize',onVV); vv.addEventListener('scroll',onVV); }
    ta.addEventListener('focus',function(){ setTimeout(seeCaret,300); setTimeout(seeCaret,700); });
    ta.addEventListener('keyup',function(e){ if(e.key==='Enter') seeCaret(); }); ta.addEventListener('click',function(){ setTimeout(seeCaret,60); });
    h.querySelector('em').outerHTML='<button class="pm2-cx tap" type="button" data-cx aria-label="取消编辑">'+X.x+'</button>';
    var ed=h.querySelector('[data-ed]'); ed.innerHTML=I.ok; ed.classList.add('ok'); ed.setAttribute('aria-label','保存');
    setTimeout(function(){ ta.focus(); },300);
  }
  L.addEventListener('click',function(e){ var c=e.target.closest('.pm2-c'); if(!c) return; var i=+c.dataset.i;
    var clr=e.target.closest('.pm2-clr'); if(clr){ var ti=c.querySelector('.pm2-ti'); ti.value=''; ti.focus(); buzz(5); return; }
    if(e.target.closest('[data-cx]')){ var tp0=document.createElement('div'); tp0.innerHTML=card(items[i],i); c.replaceWith(tp0.firstChild); sc.style.paddingBottom=''; try{ document.activeElement.blur(); }catch(_){} fit(); buzz(5); return; }
    var ed=e.target.closest('[data-ed]'); if(!ed) return;
    if(!c.classList.contains('ing')){ buzz(6);
      var ing0=L.querySelector('.pm2-c.ing'); if(ing0&&ing0!==c){ var cx0=ing0.querySelector('[data-cx]'); if(cx0) cx0.click(); }
      edit(c); return; }
    var t=c.querySelector('.pm2-ti').value.trim(), v=c.querySelector('.pm2-ta').value.trim();
    if(!t){ c.querySelector('.pm2-ti').focus(); buzz([20,30,20]); return; }
    function finish(){ items[i]=[t,v,p0(i)]; var tmp=document.createElement('div'); tmp.innerHTML=card(items[i],i); c.replaceWith(tmp.firstChild); L.children[i].classList.add('flash'); N.querySelector('[data-n="'+i+'"]').textContent=t; spy(true); fit(); notify(true); toast('存好了'); buzz(8); }
    if(live){ if(!bgo(ed)) return; P.net.req(PB+'/'+encodeURIComponent(p0(i))+qs,{method:'PUT',body:{title:t,content:v}}).then(function(){ bend(ed,true); later(finish); },function(){ bend(ed,false); fail(); }); }
    else G.noLive(ed);
  });
  function p0(i){ return items[i]&&items[i][2]; }
  hold(L,function(c){ if(fold||c.classList.contains('ing')) return; var i=+c.dataset.i; buzz([10,30,10]);
    var host=win.querySelector('.content'), hr=host.getBoundingClientRect(), rc=c.querySelector('.pm2-h').getBoundingClientRect();
    var scr=document.createElement('div'); scr.className='ps-scrim'; host.appendChild(scr);
    var m=document.createElement('div'); m.className='ps-menu'; m.innerHTML='<button type="button" data-m="copy">'+X.copy+'<span>复制这段</span></button><button type="button" class="red" data-m="del">'+X.trash+'<span>删除这段</span></button>'; host.appendChild(m);
    var tp=rc.bottom-hr.top+4; if(tp+m.offsetHeight>hr.height-24) tp=rc.top-hr.top-m.offsetHeight-4; m.style.top=tp+'px'; m.style.right='26px'; m.style.transformOrigin='right '+(tp>rc.top-hr.top?'top':'bottom');
    c.classList.add('lp'); requestAnimationFrame(function(){ m.classList.add('show'); });
    function close(){ m.classList.remove('show'); c.classList.remove('lp'); scr.remove(); setTimeout(function(){ m.remove(); },220); }
    scr.addEventListener('click',close);
    m.addEventListener('click',function(e){ var x=e.target.closest('[data-m]'); if(!x) return; close();
      if(x.dataset.m==='copy'){ var tx=items[i][1]||'', okc=function(){ toast('复制好了'); buzz(8); }, bad=function(){ var ta=document.createElement('textarea'); ta.value=tx; ta.style.cssText='position:fixed;left:-999px;top:0;opacity:0'; document.body.appendChild(ta); ta.select(); var g=false; try{ g=document.execCommand('copy'); }catch(_e){} ta.remove(); if(g) okc(); else toast('复制没成功，换个方式试试'); };
        try{ navigator.clipboard.writeText(tx).then(okc,bad); }catch(_er){ bad(); } return; }
      confirmBox(win,'删掉「'+esc(items[i][0])+'」？','他之后就不会再读到这段了。','删除',true,function(){ if(live) P.net.req(PB+'/'+encodeURIComponent(p0(i))+qs,{method:'DELETE'}).then(function(r){ if(r&&r.ok===false) fail('那段已经不在了'); },function(){ fail('没删掉，刷新一下'); }); c.classList.add('gone'); setTimeout(function(){ items.splice(i,1); paint(); notify(true); },320); toast('删掉了'); }); });
  },'.pm2-c');
  var dg=null;
  function pt(e){ var t=e.touches?e.touches[0]:e; return {x:t.clientX,y:t.clientY}; }
  function down(e){ if(!fold) return; var g=e.target.closest('[data-gp]'); if(!g) return; var c=g.closest('.pm2-c'); if(e.cancelable&&e.type==='mousedown') e.preventDefault(); begin(c,pt(e).y); }
  function begin(c,y){ var cs=[].slice.call(L.children), rs=cs.map(function(x){ return x.getBoundingClientRect(); }); dg={c:c,cs:cs,rs:rs,i:cs.indexOf(c),to:cs.indexOf(c),y0:y,py:y,s0:sc.scrollTop,gap:cs.length>1?rs[1].top-rs[0].bottom:10,b:sc.getBoundingClientRect()}; c.classList.add('lift'); L.classList.add('dragging'); buzz([10,30,10]); requestAnimationFrame(tick); }
  function upd(){ var d=dg, dy=d.py-d.y0+(sc.scrollTop-d.s0), r=d.rs[d.i], mid=r.top+r.height/2+dy, to=d.i;
    d.c.style.transform='translateY('+dy+'px) scale(1.015)';
    d.rs.forEach(function(q,k){ if(k<d.i&&mid<q.top+q.height/2) to=Math.min(to,k); if(k>d.i&&mid>q.top+q.height/2) to=Math.max(to,k); });
    if(to!==d.to){ d.to=to; buzz(4); }
    var h=r.height+d.gap; d.cs.forEach(function(x,k){ if(x===d.c) return; var m=(d.i<to&&k>d.i&&k<=to)?-h:(d.i>to&&k<d.i&&k>=to)?h:0; x.style.transform=m?'translateY('+m+'px)':''; }); }
  function tick(){ if(!dg) return; var b=dg.b; if(dg.py<b.top+70) sc.scrollTop-=8; else if(dg.py>b.bottom-70) sc.scrollTop+=8; upd(); requestAnimationFrame(tick); }
  function move(e){ if(!dg) return; if(e.cancelable) e.preventDefault(); dg.py=pt(e).y; upd(); }
  function up(){ if(!dg) return; var d=dg; dg=null; L.classList.remove('dragging'); var it=items.splice(d.i,1)[0]; items.splice(d.to,0,it); paint(); if(live&&d.to!==d.i){ P.net.post(PB+'/reorder'+qs,{ids:items.map(function(x){ return x[2]; })}).catch(function(){ fail('顺序没存上'); }); notify(true); } var n=L.children[d.to]; if(n) n.classList.add('flash'); if(d.to!==d.i) toast('排到第 '+(d.to+1)+' 段了'); buzz(8); }
  L.addEventListener('touchstart',down,{passive:false}); L.addEventListener('touchmove',move,{passive:false}); L.addEventListener('touchend',up); L.addEventListener('touchcancel',up);
  function winMove(e){ if(!root.isConnected){ window.removeEventListener('mousemove',winMove); window.removeEventListener('mouseup',winUp); return; } move(e); }
  function winUp(e){ if(!root.isConnected){ window.removeEventListener('mousemove',winMove); window.removeEventListener('mouseup',winUp); return; } up(e); }
  L.addEventListener('mousedown',down); window.addEventListener('mousemove',winMove); window.addEventListener('mouseup',winUp);
  if(!pid) P.perm2={edit:function(i){ L.children[i||0].querySelector('[data-ed]').click(); },fold:function(){ btnS.click(); },jump:function(i){ N.querySelector('[data-n="'+i+'"]').click(); },add:function(){ btnA.click(); },drag:function(i,to){ var c=L.children[i], r=c.getBoundingClientRect(); begin(c,r.top+20); dg.py=r.top+20+(to||0); upd(); },drop:up};
}
function permSetup(win){ permMount(win,win,{}); }
P.openPermSub=function(win,opts){
  opts=opts||{};
  var sp=sub(win,opts.title||'永久上下文','<div class="pm2-l"></div><div class="pm2-pad"></div>',{right:permHeadRight(),top:'<nav class="pm2-nav"></nav>'});
  permMount(sp,win,opts);
  return sp;
};
P.register('perm',{html:permHTML,setup:permSetup});

/* ---------- 工具集：本机自建的全部 MCP 服务器（8771「工具集合」仍走 /admin/tools，其余走 /admin/mcp/tool-overrides）
   [位置:phone-pages.js·toolsHTML/toolsSetup] [工具集：多服务器 + 每个工具可改可还原] [10-27：工具集原来只放 8771 一家，现在服务器自建的都要进来（工具集合/云服务器/DeepSeek搜索/网易云/邮箱/zzf/大富翁），每台每个工具的说明和参数都能改，也能还原到最初没改的样子。8771 之外的服务器没有覆盖机制，统一在网关注入侧改（lib/mcp-tool-overrides.js），保存即生效、不用重启]
   [注释时间 2026-10-27] ---------- */
var TLSRV=[], TLHIST=[], TLFLAT=[], TLOPEN={};   /* TLOPEN：服务器分组的展开状态（键=服务器 id/名字），默认空=全部收起；重画（保存/重读）后保持 */
var TLB='/heartbeat/admin/mcp/tool-overrides';
function tlKey(s){ return String(s.id||s.name||''); }
/* 键序无关的深度相等（照管理台 jsonEq）：判断参数 JSON 是否真被改过，避免无谓覆盖 */
function tlJsonEq(a,b){ function sk(o){ if(Array.isArray(o)) return o.map(sk); if(o&&typeof o==='object'){ var x={}; Object.keys(o).sort().forEach(function(k){ x[k]=sk(o[k]); }); return x; } return o; } return JSON.stringify(sk(a))===JSON.stringify(sk(b)); }
function tlErr(er){ var m=String((er&&er.message)||er||''); return m.replace(/^HTTP \d+ ?/,'').replace(/^\{"ok":false,"error":"?/,'').replace(/"?\}$/,'').slice(0,44)||'没存上'; }
/* 排序：能连上的、启用中的在前；停用的居中；连不上的垫底（同档内保持配置文件里的顺序） */
function tlRank(s){ return !s.connected?2:(s.enabled?0:1); }
function tlBody(){
  var n=0; TLSRV.forEach(function(s){ n+=s.tools.length; });
  TLFLAT=[]; var seq=0;
  return '<div><div class="tl-sum pg-rise"><span class="pg-dot"></span>共 <b>'+TLSRV.length+'</b> 台服务器 · <b>'+n+'</b> 个工具</div>'+
    /* [位置:phone-pages.js·tlBody 内联 MCP 服务] [MCP 服务直接全部展开在工具集第一屏] [11-21：不再点一行跳去配置 App 的 MCP 子页，直接在工具集页内展开全部服务器卡片（开关可拨、点卡片开编辑弹层、右上小按钮探测/添加）] [注释时间 2026-11-21] */
    '<div class="pg-gt" style="display:flex;align-items:center;justify-content:space-between;padding-right:4px"><span>MCP 服务</span><span class="pv-hd" style="gap:4px"><button class="pg-cb tap" type="button" data-mcact="probe" aria-label="重新探测" style="width:28px;height:28px">'+I.refresh+'</button><button class="pg-cb tap" type="button" data-mcact="add" aria-label="添加 MCP" style="width:28px;height:28px">'+I.plus+'</button></span></div>'+
    '<div id="tlMc"></div>'+
    /* [位置:phone-pages.js·tlBody 分组折叠] [服务器分组默认收起] [11-17：7 台服务器的几十个工具平铺在一页，太乱；每台服务器改成一张卡，标题行点一下展开/收起（默认全收起），标题行副文字给「几个工具 · 几个改过 · 几个停用」，不展开也看得到概况。展开状态记在 TLOPEN，保存/重读重画后不丢] [注释时间 2026-11-17] */
    '<div class="pg-gt">服务器</div>'+
    TLSRV.map(function(s,gi){
      var hd=esc(s.name)+(s.connected?'':' <span class="pg-tag gray">连不上</span>')+(!s.enabled?' <span class="pg-tag gray">未启用</span>':'');
      var rows, chg=0, dis=0;
      if(!s.tools.length){
        rows=[r({t:'取不到工具',s:esc(s.connected?'服务器没给出清单':String(s.error||'连不上').slice(0,22))})];
      } else {
        rows=s.tools.map(function(t){ var i=seq++; TLFLAT[i]={s:s,t:t};
          var ov=t.overridden||{}; if(ov.description||ov.inputSchema) chg++; if(t.disabled) dis++;
          return r({t:'<code class="tl-n">'+esc(t.name)+'</code>'+((ov.description||ov.inputSchema)?' <span class="pg-tag">改过</span>':''),s:t.disabled?'停用中':'',go:'t'+i}); });
      }
      var open=!!TLOPEN[tlKey(s)];
      var sum=s.tools.length?(s.tools.length+' 个工具'+(chg?' · '+chg+' 个改过':'')+(dis?' · '+dis+' 个停用':'')):'没有工具';
      return '<div class="tlf-sec pg-rise'+(open?' open':'')+'" style="--i:'+(gi+1)+'"><div class="pg-g">'+
        r({t:hd,s:sum,act:'fold',cls:'tlf-hd',data:' data-sec="'+gi+'" aria-expanded="'+(open?'true':'false')+'"',right:'<span class="tlf-chv">'+I.ch+'</span>'})+
        '<div class="tlf-body"><div class="tlf-in">'+rows.join('')+'</div></div></div></div>';
    }).join('')+'</div>';
}
function toolsHTML(){ return G.shell('工具集','<button class="pg-cb tap" id="tlR" aria-label="重新读取工具清单">'+I.refresh+'</button>','<div id="tlB"></div>'); }   /* [2026-11-16 批4 I1] 读取中的占位不再塞行内 loadBox，改由 toolsSetup 的 subLoad 铺整页动画 */
function toolsSetup(win){
  var LD=subLoad($('#tlB',win).closest('.pg'),$('#tlB',win));   /* 进页即整页动画；load() 成功/失败都 off()，手动重读先 on() */
  var MC=G.mcp;
  function paintMc(flash){
    var box=$('#tlMc',win); if(!box||!MC) return;
    if(!MC.data.length&&!MC.ok()&&P.net&&P.net.peek){ var c=P.net.peek('mcpsrv'); if(c&&c.length) MC.seed(c); }
    var list=MC.data;
    if(!list.length&&!MC.ok()){
      box.innerHTML=MC.done()?'<div class="pg-empty">'+(MC.err()?'没读到 MCP 服务':'还没有 MCP 服务')+'</div>':'<div class="pg-empty">读取 MCP 服务中…</div>';
      return;
    }
    box.innerHTML=list.map(MC.card).join('')||'<div class="pg-empty">还没有 MCP 服务</div>';
    if(flash!=null){ var n=box.querySelector('[data-m="'+flash+'"]'); if(n){ n.classList.add('flash'); n.scrollIntoView({block:'center',behavior:'smooth'}); } }
  }
  function paint(){ var L=$('#tlB',win); if(L){ L.innerHTML=tlBody(); paintMc(); } }
  function loadMc(force){
    if(!MC) return Promise.resolve();
    return MC.load(!!force).then(function(){ paintMc(); },function(){ paintMc(); });
  }
  function load(force){
    /* [位置:phone-pages.js·toolsSetup load 缓存秒开] [工具集进页先吃上次清单] [11-19 加载提速批 A：129KB 的清单每次进页都白等网络；有缓存（ph_c_tools）先把服务器分组画出来（折叠状态在 TLOPEN、不受重画影响），后台照常拉新，拉到才重画；拉失败且已画出缓存就不清屏（同小世界页做法）。手动重读（force）不吃缓存] [注释时间 2026-11-19] */
    var shown=false, c0=!force&&P.net.peek('tools');
    if(c0&&c0.servers){
      TLHIST=c0.history||[];
      TLSRV=(c0.servers||[]).slice().sort(function(a,b){ return tlRank(a)-tlRank(b); });
      paint(); LD.off(); shown=true;
    }
    return P.net.get(TLB+(force?'?refresh=1':'')).then(function(j){
      if(!j||!j.ok) throw new Error((j&&j.error)||'读不到工具清单');
      TLHIST=j.history||[];
      TLSRV=(j.servers||[]).slice().sort(function(a,b){ return tlRank(a)-tlRank(b); });
      P.net.keep('tools',{servers:j.servers||[],history:j.history||[]});
      paint(); LD.off();
    },function(er){ var L=$('#tlB',win); if(L&&!shown) L.innerHTML=P.net.failBox();
      if(shown) toast('没连上，先显示上次的清单');
      LD.off(); throw er; });
  }
  /* 保存：8771 走原来的 /admin/tools（写 ai-toolbox/tools_config.json，和管理台同一份）；其余走覆盖层 */
  function saveReq(s,name,v){
    if(s.managed){
      var body={descriptions:{},schemas:{}};
      body.descriptions[name]=(v.description==null?null:v.description);
      body.schemas[name]=(v.inputSchema==null?null:v.inputSchema);
      return P.net.req('/heartbeat/admin/tools',{method:'PUT',body:body});
    }
    return P.net.req(TLB,{method:'PUT',body:{serverId:s.id,tool:name,description:(v.description==null?null:v.description),inputSchema:(v.inputSchema==null?null:v.inputSchema)}});
  }
  /* 保存/还原后把服务器的回执写回本地那条工具，列表标签（改过）当场更新 */
  function applySaved(s,t,j){
    if(j&&j.history) TLHIST=j.history;
    if(s.managed){
      var c=(j&&j.config)||{}, d=(c.descriptions||{})[t.name], sc=(c.schemas||{})[t.name];
      t.overridden={description:d!=null,inputSchema:sc!=null};
      t.description=(d!=null?d:t.defaultDescription||'');
      t.inputSchema=(sc!=null?sc:(t.defaultInputSchema||{type:'object',properties:{}}));
    } else {
      t.overridden={description:!!(j&&j.description!=null),inputSchema:!!(j&&j.inputSchema!=null)};
      t.description=(j&&j.description!=null?j.description:(t.defaultDescription||''));
      t.inputSchema=(j&&j.inputSchema!=null?j.inputSchema:(t.defaultInputSchema||{type:'object',properties:{}}));
    }
    paint();
  }
  function histRows(s,t){
    return TLHIST.filter(function(h){ return h.tool===t.name&&(!h.server_id||h.server_id===s.id); }).slice(0,5).map(function(h){
      var F={enabled:'开关',description:'说明',inputSchema:'参数'};
      return r({t:esc((F[h.field]||h.field)+(h.field==='enabled'?(h['new']?' · 开':' · 关'):'')),s:esc((function(w){ return w?(w.ym+' '+w.hm):String(h.time||'').replace('T',' ').slice(0,16); })(wallLocal(h.time))+(h.source?' · '+h.source:''))});
    });
  }
  /* 编辑页（子页，照「用途提示词」页形态）：工具说明 + 参数定义 + 底部「还原 / 保存」 */
  function openTool(s,t){
    var hs=histRows(s,t);
    var pg=sub(win,esc(t.name),
      '<div class="tl-note">改的是他调用工具时看到的说明和参数，不改工具本身</div>'+
      '<div class="pg-gt">工具说明</div><textarea class="pg-in tl-ta" data-f="d">'+esc(t.description||'')+'</textarea>'+
      '<div class="pg-gt">参数定义（JSON）</div><textarea class="pg-in mono tl-ta tl-js" data-f="s" spellcheck="false">'+esc(JSON.stringify(t.inputSchema||{type:'object',properties:{}},null,1))+'</textarea>'+
      '<div class="pg-bts"><button class="pg-btn tap" type="button" data-tl="rs">还原</button><button class="pg-btn pri tap" type="button" data-tl="sv">保存</button></div>'+
      (hs.length?grp('改动记录',hs,null,2):''));
    var dta=pg.querySelector('[data-f="d"]'), sta=pg.querySelector('[data-f="s"]');
    pg.addEventListener('click',function(e){
      var b=e.target.closest('[data-tl]'); if(!b) return;
      if(b.dataset.tl==='sv'){
        var dv=dta.value.trim();
        if(!dv){ dta.focus(); buzz([20,30,20]); toast('说明不能是空的'); return; }
        var sv=sta.value.trim(), obj=null;
        if(sv){
          try{ obj=JSON.parse(sv); }catch(er){ sta.focus(); buzz([20,30,20]); toast('参数 JSON 格式不对：'+String(er.message).replace(/\s+/g,' ').slice(0,50)); return; }
          if(!obj||typeof obj!=='object'||Array.isArray(obj)){ sta.focus(); buzz([20,30,20]); toast('参数定义要是一个 JSON 对象'); return; }
        }
        var defD=String(t.defaultDescription||''), defS=t.defaultInputSchema||{type:'object',properties:{}};
        var dVal=(dv!==defD.trim())?dv:null;
        var sVal=(obj&&!tlJsonEq(obj,defS))?obj:null;
        if(dVal===null&&sVal===null){ toast('和最初的一样，没东西要存'); buzz(6); return; }
        if(!bgo(b)) return;
        saveReq(s,t.name,{description:dVal,inputSchema:sVal}).then(function(j){ bend(b,true); applySaved(s,t,j);
          buzz([8,30,8]); toast('存好了 · 他下次调工具就看到'); },function(er){ bend(b,false); toast(tlErr(er)); buzz([20,30,20]); });
      } else {
        confirmBox(win,'还原成最初的样子？','你改过的说明和参数都会被丢掉，回到工具自带的那份。','还原',true,function(){
          if(!bgo(b)) return;
          saveReq(s,t.name,{description:null,inputSchema:null}).then(function(j){ bend(b,true); applySaved(s,t,j);
            dta.value=t.defaultDescription||''; sta.value=JSON.stringify(t.defaultInputSchema||{type:'object',properties:{}},null,1);
            buzz(6); toast('回到最初的样子了'); },function(er){ bend(b,false); toast(tlErr(er)); buzz([20,30,20]); });
        });
      }
    });
  }
  wire($('.pg',win),{go:function(k,t){
    if(k.charAt(0)!=='t') return; var it=TLFLAT[+k.slice(1)]; if(it) openTool(it.s,it.t); },
    act:function(k,t){ if(k!=='fold') return; var sec=t.closest('.tlf-sec'), s=TLSRV[+t.dataset.sec]; if(!sec||!s) return;
      var open=!sec.classList.contains('open'); sec.classList.toggle('open',open); t.setAttribute('aria-expanded',open?'true':'false'); TLOPEN[tlKey(s)]=open; buzz(5); }});
  /* [位置:phone-pages.js·toolsSetup 内联 MCP 交互] [卡片开关 / 点卡编辑 / 探测 / 添加] [11-21：工具集页内直接操作 MCP 服务器，不再跳配置页] [注释时间 2026-11-21] */
  $('#tlB',win).addEventListener('click',function(e){
    if(!MC) return;
    var act=e.target.closest('[data-mcact]');
    if(act){
      var k=act.getAttribute('data-mcact');
      if(k==='add'){ buzz(6); MC.edit(win,-1,paintMc); return; }
      if(k==='probe'){
        buzz(6); act.classList.add('spin');
        Array.prototype.forEach.call(win.querySelectorAll('#tlMc .mc-card:not(.dis) .mc-ic'),function(x){ x.className='mc-ic wait'; });
        loadMc(true).then(function(){ act.classList.remove('spin'); toast('探测完：'+MC.data.filter(function(m){ return m.on&&m.ok; }).length+' 个连上'); buzz([8,30,8]); },function(){ act.classList.remove('spin'); });
        return;
      }
    }
    var c=e.target.closest('#tlMc .mc-card'); if(!c) return;
    var i=+c.dataset.m, m=MC.data[i];
    if(e.target.closest('[data-sw]')){
      if(!MC.ok()||!m){ G.noLive(c); return; }
      m.on=!m.on; buzz(8); paintMc();
      MC.save().then(function(){ toast(m.n+(m.on?' 开了，探测一下…':' 关了，他调不到了')); if(m.on) loadMc(true); },function(){ m.on=!m.on; paintMc(); });
      return;
    }
    if(!m){ toast('MCP 数据还在读取，稍等一下'); return; }
    buzz(6); MC.edit(win,i,paintMc);
  });
  /* 右上「重新读取」：强制现连各服务器刷新清单（平时有 60 秒缓存；工具服务刚重启过就用这个） */
  $('#tlR',win).addEventListener('click',function(){ var b=this; if(b.classList.contains('busy')) return;
    b.classList.add('busy'); b.innerHTML='<i class="pg-spin" style="width:16px;height:16px"></i>';
    LD.on();   /* 手动重读：先铺整页动画（同时清掉旧清单），拉回来由 load() 里的 LD.off() 散去 */
    Promise.all([load(true),loadMc(true)]).then(function(){ b.classList.remove('busy'); b.innerHTML=I.refresh; buzz(8); },function(){ b.classList.remove('busy'); b.innerHTML=I.refresh; }); });
  load(false).catch(function(){});
  loadMc(false).catch(function(){});
}
P.register('tools',{html:toolsHTML,setup:toolsSetup});

/* ---------- 用途提示词：目录页已删（11-20）。九条数据和 P.pedit 留下——设置页三行、记忆池四组、语音模型页还在用。会话状态机提示词和容量提醒提示词按用户的选择先不放入口。 ---------- */
var PROMPTS=[['唤醒提示词','醒来以后做什么',640,'唤醒'],['会话状态机提示词','System + User 模板',1260,'状态机'],['容量提醒提示词','上下文快满时提醒他',410,'工具'],['记忆流水线 · 判定','门卫判断要不要入库',780,'记忆'],['记忆蒸馏 · 抽取','从日记里抽记忆候选',1100,'记忆'],['两块总结 · 合并','Core Identity / 长期理解',1420,'记忆'],['老数据重跑 · 整理','逐批整理已有记忆',990,'记忆'],['语音转写提示词','发出去的语音 / 输入框转文字，两栏',900,'语音'],['图片转写提示词','发给不能看图的模型的图片描述',760,'图片'],['笔记摘要与关键词提示词','笔记正文变动后后台自动整理摘要与关键词',600,'笔记']];
var PRD=[{u:'logs/wake-prompt',f:[['text','']],rs:''},{u:'conversation-state/prompt',f:[['system','System'],['user_template','User 模板']],rs:'act'},{u:'context-compaction/ctx-limit-prompt',f:[['template','']],rs:'del'},
  {u:'memory-judge/prompt',f:[['template','']],rs:'del'},{u:'memory-distill/prompt',f:[['distill_system_prompt','System'],['distill_user_prompt','User'],['distill_notes_user_prompt','笔记附加说明（蒸馏笔记用）']],rs:'del'},{u:'memory-summary/prompt',f:[['system_prompt','System'],['user_prompt','User']],rs:'del'},{u:'memory-backfill/prompt',f:[['system_prompt','System'],['user_prompt','User']],rs:'del'},
  {u:'voice-desc/prompt',f:[['template','发出去的语音（转写 + 说话方式标注）'],['asr_template','输入框麦克风（只转文字）']],rs:'del'},
  {u:'image-desc/prompt',f:[['template','图片转写正文']],rs:'del'},
  {u:'notebook-meta/prompt',f:[['template','摘要与关键词提示词']],rs:'del'}];
/* [位置:phone-pages.js·P.pvals/plen/pfetch] [用途提示词值缓存与取数（跨页共用）] [11-02：提示词要放进各功能设置页就地改（记忆池设置四组），缓存/字数/取数从本页闭包提到 P 上共用；P.pvals 下标=PROMPTS 下标，null=没拉到（点开时现拉）] [注释时间 2026-11-02] */
/* [位置:phone-pages.js·P.pfetch] [用途提示词取数加本地缓存] [11-19 加载提速批 A：进提示词页要等 9 个请求全回才见字数；现在内存（P.pvals）没有、缓存（ph_c_pr_N）有时先同步填进 P.pvals——目录页首次 paint 就能显示各条字数，pedit 也能直接开编辑器；后台照常拉新覆盖并 keep。拉失败时缓存值兜底返回（离线也能看）。o.noLogin 只给空闲预取用：401 不弹登录。P.pstale[i]=1 标记当前值来自缓存（pedit 打开时据此做后台校验，见下）] [注释时间 2026-11-19] */
P.pvals=[]; P.pstale=[]; var PRAB='/heartbeat/admin/';
P.plen=function(i){ var v=P.pvals[i]; if(!v) return 0; return PRD[i].f.reduce(function(n,f){ return n+String(v[f[0]]||'').length; },0); };
P.pfetch=function(i,o){
  o=o||{};
  var c0=P.pvals[i]||P.net.peek('pr_'+i);
  if(c0&&!P.pvals[i]){ P.pvals[i]=c0; P.pstale[i]=1; }
  return P.net.get(PRAB+PRD[i].u,{noLogin:!!o.noLogin}).then(function(v){ P.pvals[i]=v||{}; P.pstale[i]=0; P.net.keep('pr_'+i,P.pvals[i]); return P.pvals[i]; },function(er){ if(c0) return c0; throw er; });
};
/* [位置:phone-pages.js·P.pedit] [用途提示词编辑页全局出口] [11-02：记忆池设置就地改提示词用，与「用途提示词」目录页同一套编辑/保存/恢复逻辑（原 promptSetup 闭包版抽出）；win=宿主窗口，i=PROMPTS 下标，after=存/恢复成功后刷新调用方；没拉到值先现拉一次，仍没有就显示预置说明] [注释时间 2026-11-02] */
P.pedit=function(win,i,after){
  var p=PROMPTS[i], D=PRD[i];
  function open(v){
    if(!v){
      sub(win,p[0],'<textarea class="pg-in mono pr-ta">'+esc('【'+p[0]+'】\n'+p[1]+'。\n\n（这是预置说明，实际内容以后台为准）')+'</textarea>'+btns([['恢复默认',''],['保存','save','pri']])); return; }
    var multi=D.f.length>1;
    var pg=sub(win,p[0],D.f.map(function(f){ return (multi?'<div class="pg-gt">'+f[1]+'</div>':'')+'<textarea class="pg-in mono pr-ta" data-f="'+f[0]+'"'+(multi?' data-multi="1"':'')+'>'+esc(String(v[f[0]]||''))+'</textarea>'; }).join('')+
      '<div class="pg-bts">'+(D.rs?'<button class="pg-btn tap" type="button" data-pr="rs">恢复默认</button>':'')+'<button class="pg-btn pri tap" type="button" data-pr="sv">保存</button></div>');
    pg.addEventListener('click',function(e){ var b=e.target.closest('[data-pr]'); if(!b) return;
      if(b.dataset.pr==='sv'){ var body={}; [].forEach.call(pg.querySelectorAll('.pr-ta'),function(t){ body[t.dataset.f]=t.value; });
        if(D.f.length===1&&!String(body[D.f[0][0]]).trim()){ buzz([20,30,20]); toast('不能是空的'); return; }
        if(!bgo(b)) return; P.net.post(PRAB+D.u,body).then(function(r2){ if(r2&&(r2.error||r2.ok===false)){ bend(b,false); toast(String(r2.error||'没存上').slice(0,40)); return; } bend(b,true); return P.pfetch(i).then(function(){ if(after) after(); toast((r2&&r2.warnings&&r2.warnings.length)?'存好了 · '+r2.warnings[0]:'存好了'); buzz([8,30,8]); }); },function(er){ bend(b,false); toast(String((er&&er.message)||'没存上').replace(/^HTTP \d+ ?/,'').replace(/^\{"error":"?|"?\}$/g,'').slice(0,50)); buzz([20,30,20]); }); return; }
      confirmBox(win,'恢复默认？','你改过的这份会被内置的默认替换掉。','恢复',true,function(){
        var job=D.rs==='act'?P.net.post(PRAB+D.u,{action:'reset'}):P.net.req(PRAB+D.u,{method:'DELETE'});
        job.then(function(){ return P.pfetch(i); }).then(function(nv){ [].forEach.call(pg.querySelectorAll('.pr-ta'),function(t){ t.value=String(nv[t.dataset.f]||''); }); if(after) after(); toast('恢复默认了'); buzz(8); },function(){ toast('没恢复成'); }); }); });
    /* [位置:phone-pages.js·P.pedit 缓存校验] [编辑器吃缓存打开时后台核一遍新] [11-19 加载提速批 A：pfetch 的缓存兜底让「基于旧正文保存、盖掉期间后台改动」的窗口从一次页面会话放大到 7 天；这里照状态机参数面板的口径收口——打开的是缓存值（P.pstale）就后台拉最新，你一个字没动过且正文真变了就原位换上新版并说一声，动过就不碰（你的输入优先）；拉失败算了，下次再核] [注释时间 2026-11-19] */
    if(P.pstale&&P.pstale[i]){
      P.net.get(PRAB+D.u).then(function(nv){
        P.pstale[i]=0; if(!nv) return;
        P.pvals[i]=nv; P.net.keep('pr_'+i,nv);
        var tas=pg.querySelectorAll('.pr-ta'), dirty=false;
        [].forEach.call(tas,function(t){ if(t.value!==String(v[t.dataset.f]||'')) dirty=true; });
        if(dirty) return;   /* 你已经在改了，不碰 */
        var diff=D.f.some(function(f){ return String(nv[f[0]]||'')!==String(v[f[0]]||''); });
        if(diff){ [].forEach.call(tas,function(t){ t.value=String(nv[t.dataset.f]||''); }); toast('后台有新版本，给你换上了'); }
      },function(){});
    }
  }
  if(P.pvals[i]){ open(P.pvals[i]); return; }
  P.pfetch(i).then(function(v){ open(v); },function(){ open(null); });
};
/* [位置:phone-pages.js·promptSetup] [用途提示词目录页已删] [11-20：九条清单页不要了，三行收进设置；P.pedit / PROMPTS / 空闲预取保留] [注释时间 2026-11-20] */


/* [位置:phone-pages.js·信封情书包装层] [已删] [11-16 产品确定：信封 App 整个下掉——这里原来包 phone-love.js 的旧页（顶栏换标题、藏贴便签按钮）再 P.register('love')；包装层和注册一起删。11-17 批5：phone-love.js 本体与信封样式（phone-apps.css 恋爱日记段、.lv2）一并删除（备份 工作流/备份/批5_20261117/），script 标签同步摘除，入口零残留] [注释时间 2026-11-16；2026-11-17 批5 清理] */

/* 笔记本：2026-10-22 起整页重做，搬到 phone-notes.js（列表式，数据同服务器 papers）；原来的 3D 书已删 */

/* ===================== 空闲预取（加载提速批 B+C1） ===================== */
/* [位置:phone-pages.js·idlePrefetch] [主屏空闲预热常用页数据] [11-19 加载提速批 B+C1：主屏稳定 2.5s 后的空闲时刻，把工具集清单（TLB 同一 URL）和 9 条用途提示词串行拉一遍、keep 进 ph_c_* 本地缓存——之后点开工具集/提示词页（或记忆池设置里就地改提示词）直接吃缓存秒出、后台再校正；再顺手暖 lottie 运行库的协商缓存（168KB，原先 head 里的 prefetch 已删，不再抢首屏带宽，改由这里 idle 拉）。请求全部 noLogin：401 静默跳过（不弹登录），登录成功 ph:login 后重跑一轮；切后台暂停、回前台续跑；一次页面会话只跑一轮] [注释时间 2026-11-19] */
(function(){
"use strict";
var P=window.PH; if(!P||!P.net||!P.pfetch) return;
var ran=false;
function run(){
  if(ran||document.visibilityState!=='visible') return; ran=true;
  var jobs=[];
  jobs.push(function(){ return P.net.get('/heartbeat/admin/mcp/tool-overrides',{noLogin:true}).then(function(j){ if(j&&j.ok) P.net.keep('tools',{servers:j.servers||[],history:j.history||[]}); }); });
  jobs.push(function(){ return P.net.get('/heartbeat/admin/mcp/servers',{noLogin:true}).then(function(r){ if(r&&r.servers) P.net.keep('mcpsrv',r.servers); }); });
  PRD.forEach(function(d,k){ jobs.push(function(){ return P.pfetch(k,{noLogin:true}); }); });
  jobs.push(function(){ return window.lottie?Promise.resolve():fetch('/vendor/lottie_light.min.js',{credentials:'omit'}).then(function(){ return null; }); });
  var ix=0;
  (function step(){
    if(ix>=jobs.length) return;
    if(document.visibilityState!=='visible'){ setTimeout(step,3000); return; }
    jobs[ix++]().catch(function(){}).then(function(){ setTimeout(step,300); });
  })();
}
window.addEventListener('load',function(){
  setTimeout(function(){ (window.requestIdleCallback||function(f){ setTimeout(f,1500); })(run); },2500);
});
window.addEventListener('ph:login',function(){ ran=false; setTimeout(run,1200); });
})();

/* ===================== MCP 后台静默轮询（每 30 秒） ===================== */
/* [位置:phone-pages.js·mcpBgPoll] [登录后后台静默拉取 MCP 缓存] [11-21：登录 App 后不阻塞聊天，每 30 秒在后台静默拉一次 /admin/mcp/servers 和 /admin/mcp/tool-overrides 写进本地缓存（ph_c_mcpsrv / ph_c_tools）；页面切后台暂停，回前台若距上次超过 30 秒立刻补一轮；全部 noLogin:true，401 不弹登录框] [注释时间 2026-11-21] */
(function(){
"use strict";
var P=window.PH; if(!P||!P.net) return;
var IV=30000, lastAt=0, busy=false, tmr=0;
function loggedIn(){ try{ return localStorage.getItem('han_logged_in')==='1'; }catch(e){ return false; } }
function tick(){
  if(busy||document.visibilityState!=='visible'||!loggedIn()) return;
  busy=true; lastAt=Date.now();
  Promise.all([
    P.net.get('/heartbeat/admin/mcp/servers',{noLogin:true}).then(function(r){ if(r&&r.servers) P.net.keep('mcpsrv',r.servers); },function(){}),
    P.net.get('/heartbeat/admin/mcp/tool-overrides',{noLogin:true}).then(function(j){ if(j&&j.ok) P.net.keep('tools',{servers:j.servers||[],history:j.history||[]}); },function(){})
  ]).then(function(){ busy=false; },function(){ busy=false; });
}
function arm(){ clearInterval(tmr); tmr=setInterval(tick,IV); }
window.addEventListener('load',function(){ setTimeout(function(){ arm(); },4000); });
window.addEventListener('ph:login',function(){ lastAt=0; setTimeout(tick,1500); arm(); });
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'&&Date.now()-lastAt>=IV) setTimeout(tick,600);
});
})();

})();

/* ===================== Dock：后台 / 主题 / 设置 + 下拉通知中心 ===================== */
(function(){
"use strict";
var P=window.PH, G=P&&P.pages; if(!G) return;
var bgo=P.bgo, bend=P.bend, later=P.later;   /* 保存按钮动效（定义在文件第一块） */
var $=P.$, buzz=P.buzz, toast=P.toast, I=G.I, r=G.r, grp=G.grp, sub=G.sub, sheet=G.sheet, confirmBox=G.confirm, wire=G.wire, btns=G.btns, seg=G.seg, slider=G.slider, hold=G.hold;   /* [2026-11-14 第27条] 补导入 hold：它是第一组的局部函数（:250），组间共享只能走 P.pages——裸调会在 themeSetup 抛 not defined，自定义主题区块的监听挂一半就断 */
var esc=P.esc||function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
var X={pulse:svg('<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>'),shield:svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),server:svg('<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>'),save:svg('<path d="M5 3h12l4 4v14H5zM8 3v6h8M8 21v-7h8v7"/>'),music:svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),send:svg('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>'),cpu:svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),sun:svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),vib:svg('<rect x="8" y="4" width="8" height="16" rx="2"/><path d="M4 9v6M20 9v6M2 11v2M22 11v2"/>'),bubble:svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),palette:svg('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.7C21 6 17 3 12 3z"/>'),img:svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),pin:svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>')};

/* ---------- 后台：服务 / 备份 / 安全哨兵 / 网易云 / 推送渠道 / 干活的模型（/admin/services、backup/status、alerts、netease、providers/test） ---------- */
var SVC=[];   /* 演示数据已删（2026-10-22） */
var SENT=[];   /* 演示数据已删（2026-10-22） */
var LLM=[];   /* 演示数据已删（2026-10-22） */
/* 后台 · 真数据：/admin/services（只有状态，没有运行时长 / 内存）、/admin/backup/status、/admin/alerts（含余额 / 容量 / 哨兵提醒）、/admin/netease、
   /admin/model-roles（后台任务用哪个模型）+ memory-summary / distill / backfill 的 status（上次跑的时间）。操作：/admin/services/:name/:action、netease/save、/v1/notify/reply-done（测试推送）。
   注意：services / alerts 后端是一条条同步跑 shell 命令，打开这页会让网关卡一两秒。 */
var PB='/heartbeat/admin/', PST={online:1,active:1,running:1};
/* [位置:phone-pages.js·gwCooling] [网关重启冷却窗口] [10-31：重启网关后要排空几十秒，服务页此时会短暂读不到状态，容易误点「启动」造成二次重启；点过重启/启动就记 60 秒冷却，期间显示「重启中 · 排空中」并禁用操作] [注释时间 2026-10-31]；10-31 修：读到 gateway online 就提前结束冷却，避免恢复后还显示「排空中」 */
var GWCOOL=60*1000;
function gwAt(){ try{ return Number(localStorage.getItem('gwRestartAt'))||0; }catch(e){ return 0; } }
function gwCooling(){ var t=gwAt(); return !!t&&Date.now()-t<GWCOOL; }
function gwMark(){ try{ localStorage.setItem('gwRestartAt',String(Date.now())); }catch(e){} }
function gwUnmark(){ try{ localStorage.removeItem('gwRestartAt'); }catch(e){} }
function puAgo(iso){ var d=P.net&&P.net.parse(iso); if(!d) return ''; var m=Math.round((Date.now()-d)/60000); return m<1?'刚刚':m<60?m+' 分钟前':m<1440?Math.round(m/60)+' 小时前':Math.round(m/1440)+' 天前'; }
function pulseBody(D){
  /* [位置:phone-pages.js·pulseBody] [后台页没读到数据] [演示服务 / 备份 / 哨兵 / 后台模型已删（2026-10-22）：null＝读取中，'fail'＝没连上，带重试] [注释时间 2026-10-22] */
  if(!D) return P.net.loadBox(); if(D==='fail') return P.net.failBox();
  var sv=D.svc||[]; sv.forEach(function(s){ s.unk=s.type==='port'&&!PST[s.status]; if(s.name==='gateway'&&gwCooling()&&!PST[s.status]) s.cooling=1; }); var bad=sv.filter(function(s){ return !PST[s.status]&&!s.unk&&!s.cooling; }), al=D.alerts||[], bk=D.bk, ne=D.ne;
  return '<div class="bk-hero bk-hero2 pg-rise"><span class="radar"><i></i><b></b></span><div><b>'+(bad.length||al.length?(bad.length?bad.length+' 个服务没在跑':'')+(bad.length&&al.length?' · ':'')+(al.length?al.length+' 条提醒':''):'一切正常')+'</b><small>'+sv.length+' 个服务 · '+(al.length?al.length+' 条提醒':'没有提醒')+'</small></div></div>'+
  (sv.length?grp('服务',sv.map(function(s,i){ return r({t:esc(s.label||s.name),s:esc(s.name+' · '+(s.cooling?'重启中 · 排空中':s.unk?'状态读不到':s.status)),go:'s'+i,right:'<span class="pg-dot'+(s.cooling?' warn':PST[s.status]?'':s.unk?' warn':' off')+'"></span>'+I.ch}); }),null,0):'')+
  grp('备份',[bk&&bk.ok!==false?r({t:bk.latest?(bk.is_today?'今天备份过了':(bk.stale_days||'?')+' 天没备份'):'还没有备份',s:bk.latest?'共 '+bk.count+' 份 · 最新 '+(bk.latest.size/1048576).toFixed(0)+' MB · '+esc(String(bk.latest.ymd||'').replace(/^(\d{4})(\d\d)(\d\d)$/,'$2-$3')):'',right:'<span class="pg-tag '+(bk.is_today?'ok':'warn')+'">'+(bk.is_today?'正常':'留意')+'</span>'}):r({t:'备份状态',s:esc((bk&&bk.error)||'读不到')})],null,1)+
  grp('提醒',al.length?al.map(function(a,i){ return r({t:esc(a.title||a.type),s:esc(a.desc||''),go:'a'+i,right:'<span class="pg-tag warn">留意</span>'}); }):[r({t:'没有提醒',s:'余额 / 容量 / 哨兵都正常'})],null,2)+
  grp('网易云',[r({t:'登录状态',s:ne?(ne.sessionUpdatedAt?'cookie 更新于 '+esc(String(ne.sessionUpdatedAt).slice(5,16)):''):'读不到',right:'<span class="pg-tag '+(ne&&ne.account?'ok':'warn')+'">'+(ne&&ne.account?'有效':ne&&ne.sessionSet?'可能过期':'没登录')+'</span>'}),r({t:'更新 cookie',go:'ck'}),r({t:'扫码登录',go:'qr'})],null,3)+
  grp('后台模型',(D.roles||[]).map(function(x,i){ return r({t:esc(x.label),s:esc(x.model_display||'跟随聊天模型')+(x.last?' · 上次 '+x.last:''),go:'l'+i,right:'<span class="pg-dot'+(x.bad?' warn':'')+'"></span>'+I.ch}); }),null,5); }
function pulseHTML(){ return G.shell('后台','<button class="pg-cb tap" id="bkR" aria-label="刷新">'+I.refresh+'</button>','<div id="puB">'+pulseBody(null)+'</div>'); }
function pulseSetup(win){
  var D=null, rt=0, rtT=0;   /* rt=启动窗口自动重试计数，rtT=重试计时器 [10-25：每回 gateway 重启，后台页这波并发正好撞进启动窗口，一次失败就停死要手点；现在失败自动 2s/4s/8s 退避重试，三次不成才停成手点] [注释时间 2026-10-25] */
  function rtStop(){ clearTimeout(rtT); rtT=0; }
  function load(fresh){ if(fresh) rt=0; rtStop(); var d={};
    var soft=function(u){ return P.net.get(PB+u).catch(function(){ return null; }); };
    return Promise.all([soft('services'),soft('backup/status'),soft('alerts'),soft('netease'),soft('model-roles'),soft('memory-summary/status'),soft('memory-distill/status'),soft('memory-backfill/status')]).then(function(x){
      if(!x[0]&&!x[1]&&!x[4]){ if(P.net.offline) P.net.offline();
        var cw=gwCooling();
        if(cw||rt<3){ if(!cw) rt++; $('#puB',win).innerHTML=P.net.failBox('网关可能正在重启 · 自动重试中…'); rtT=setTimeout(function(){ if(!win.isConnected) return; load(); },cw?5000:Math.pow(2,rt)*1000); return; }
        $('#puB',win).innerHTML=pulseBody('fail'); return; }
      d.svc=(x[0]&&x[0].services)||[]; d.bk=x[1]; d.alerts=(x[2]&&x[2].alerts)||[]; d.ne=x[3]&&x[3].netease;
      var rs=(x[4]&&x[4].roles)||{}, st={memory_summary:x[5]&&{at:x[5].last_run_at,ok:x[5].last_run_result&&x[5].last_run_result.ok},distill:x[6]&&{at:x[6].config&&x[6].config.last_run_at||x[6].startedAt,ok:!x[6].lastError},backfill:x[7]&&{at:x[7].last_run_at,ok:x[7].last_run_result&&x[7].last_run_result.ok}};
      d.roles=Object.keys(rs).map(function(k){ var o=Object.assign({key:k},rs[k]), s2=st[k]; if(s2&&s2.at){ o.last=puAgo(s2.at); o.bad=s2.ok===false; } return o; });
      rt=0; rtStop(); D=d; var gws=(d.svc||[]).filter(function(s){ return s.name==='gateway'; })[0]; if(gws&&PST[gws.status]) gwUnmark(); $('#puB',win).innerHTML=pulseBody(D); if(gwCooling()) rtT=setTimeout(function(){ if(!win.isConnected) return; load(); },5000); }); }
  win.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ $('#puB',win).innerHTML=pulseBody(null); load(1); } });
  /* [位置:phone-pages.js·act] [网关冷却打标/清标] [2026-11-01 审查修复：请求前打标保留（重启中立刻防误点），但服务端明确返回 ok:false（根本没重启成功）时清掉冷却，避免白锁 60 秒“启动”；网络错误分支不清——重启时连接被掐很常见，留着保护] [注释时间 2026-11-01] */
  function act(name,a,label){ if(name==='gateway'){ if(a==='start'&&gwCooling()){ toast('网关正在重启 · 排空中，约 60 秒后再操作'); return Promise.resolve(); } if(a==='restart'||a==='start') gwMark(); } return P.net.post(PB+'services/'+encodeURIComponent(name)+'/'+a,{}).then(function(r2){ if(name==='gateway'&&r2&&r2.ok===false&&(a==='restart'||a==='start')) gwUnmark(); toast(label+(r2&&r2.ok===false?' 没成功':' 好了')); buzz([8,30,8]); setTimeout(load,1500); },function(e){ if(name==='gateway'){ toast('网关在重启，过几秒再刷新'); setTimeout(load,6000); return; } toast(label+' 没成功'); buzz([20,30,20]); }); }
  /* 会话 token 提醒上限：存在 context-compactor 配置的 ctx_limit_alert_tokens（0 = 不提醒）；沿用压缩页已有的保存接口 */
  function openLimit(a){
    var usedK = a&&a.token_used ? Math.round(a.token_used/1000) : null;
    P.net.get('/heartbeat/admin/context-compaction/config').catch(function(){ return null; }).then(function(cfg){
      var cur = cfg&&typeof cfg.ctx_limit_alert_tokens==='number' ? cfg.ctx_limit_alert_tokens : ((a&&a.token_limit)||0);
      sheet(win,esc(a.title||'会话 token 提醒'),'<div class="pg-g">'+
        r({t:'类型',v:esc(a.type||'capacity')})+(a.session_name?r({t:'会话',v:esc(a.session_name)}):'')+
        (usedK!=null?r({t:'上下文',v:usedK+'k / '+Math.round(cur/1000)+'k'}):'')+
        r({t:'上限',right:'<input class="pg-in mono" id="tkLim" type="number" inputmode="numeric" min="0" step="1" value="'+Math.round(cur/1000)+'" style="width:80px;height:34px;text-align:right"> k'})+
        '</div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn tap" type="button" data-off>关掉提醒</button><button class="pg-btn pri tap" type="button" data-sv>保存</button></div>',
        function(sh,close){
          function save(v){ P.net.post('/heartbeat/admin/context-compaction/config',{ctx_limit_alert_tokens:v}).then(function(r2){
            if(r2&&r2.ok===false){ toast(String(r2.error||r2.message||'没存上').slice(0,40)); return; }
            close(); toast(v?'上限改成 '+Math.round(v/1000)+'k':'提醒关掉了'); buzz(8); setTimeout(load,600);
          },function(){ toast('没存上'); buzz([20,30,20]); }); }
          sh.querySelector('[data-sv]').addEventListener('click',function(){ var n=Math.max(0,Math.floor(Number(sh.querySelector('#tkLim').value)||0))*1000; save(n); });
          sh.querySelector('[data-off]').addEventListener('click',function(){ save(0); });
        });
    });
  }
  wire($('.pg',win),{go:function(k,t){
    var i=+k.slice(1);
    if(D&&k[0]==='s'){ var s=D.svc[i], ok=!!PST[s.status], cooling=s.name==='gateway'&&gwCooling()&&!ok; sheet(win,esc(s.label||s.name),'<div class="pg-g">'+r({t:'状态',right:'<span class="pg-tag '+(ok&&!cooling?'ok':'warn')+'">'+esc(cooling?'重启中 · 排空中':s.status)+'</span>'})+r({t:'进程名',v:esc(s.name)})+r({t:'类型',v:esc(s.type||'')})+'</div><div class="pg-bts" style="padding:14px 0 0">'+(cooling?'<button class="pg-btn tap" type="button" disabled>重启中 · 排空中</button>':ok?'<button class="pg-btn tap red" data-stop>停止</button><button class="pg-btn pri tap" data-rs>重启</button>':'<button class="pg-btn pri tap" data-go2>启动</button>')+'</div>',function(sh,close){
        var rs=sh.querySelector('[data-rs]'), sp=sh.querySelector('[data-stop]'), go2=sh.querySelector('[data-go2]');
        if(rs) rs.addEventListener('click',function(){ confirmBox(win,'重启'+esc(s.label||s.name)+'？',s.name==='gateway'?'重启网关期间聊天会断几秒，进行中的回复会中断。':'大约几秒，期间这个功能用不了。','重启',false,function(){ rs.innerHTML='<i class="pg-spin"></i>重启中…'; act(s.name,'restart','重启').then(close,close); }); });
        if(sp) sp.addEventListener('click',function(){ confirmBox(win,'停止'+esc(s.label||s.name)+'？',s.name==='gateway'||s.name==='nginx'?'停了这个，小手机就连不上后台了，要去服务器上手动启动。':'停了以后要手动启动。','停止',true,function(){ close(); act(s.name,'stop','停止'); }); });
        if(go2) go2.addEventListener('click',function(){ go2.innerHTML='<i class="pg-spin"></i>启动中…'; act(s.name,'start','启动').then(close,close); }); }); return; }
    if(D&&k[0]==='a'){ var a=D.alerts[i];
      if(a.type==='capacity'){ openLimit(a); return; }
      sheet(win,esc(a.title||a.type),'<div class="pg-g">'+r({t:'类型',v:esc(a.type)})+(a.session_name?r({t:'会话',v:esc(a.session_name)}):'')+(a.token_used?r({t:'上下文',v:Math.round(a.token_used/1000)+'k / '+Math.round((a.token_limit||0)/1000)+'k'}):'')+r({t:'详情',s:esc(a.desc||'')})+'</div>'); return; }
    if(D&&k[0]==='l'){ var m=D.roles[i]; sheet(win,esc(m.label),'<div class="pg-g">'+r({t:'用途',v:esc(m.key)})+r({t:'供应商',v:esc(m.provider_name||'跟随聊天模型')})+r({t:'模型',v:esc(m.model_display||'')})+(m.last?r({t:'上次跑',v:m.last+(m.bad?' · 失败':'')}):'')+'</div><div class="bk-tr" id="bkTr"></div>',function(sh){ var tb=sh.querySelector('[data-tt]'), out=sh.querySelector('#bkTr'); if(!tb) return;
        tb.addEventListener('click',function(){ if(tb.classList.contains('spin')) return; if(!m.provider_id){ toast('跟随聊天模型，去配置里测'); return; } tb.classList.add('spin'); out.className='bk-tr'; buzz(6);
          P.net.post(PB+'providers/test',{id:m.provider_id}).then(function(r2){ tb.classList.remove('spin'); out.className='bk-tr '+(r2&&r2.ok?'ok':'bad')+' show'; out.innerHTML=(r2&&r2.ok?I.ok+'<span>连通 · '+((r2.latency_ms||0)/1000).toFixed(2)+'s</span>':'<span>'+esc((r2&&r2.error)||'没连上')+'</span>'); buzz(r2&&r2.ok?[8,30,8]:[20,40,20]); },function(){ tb.classList.remove('spin'); out.className='bk-tr bad show'; out.innerHTML='<span>没测成</span>'; }); }); },'<button class="pg-cb tap bk-tt" data-tt aria-label="测连通">'+X.pulse+'</button>'); return; }
    if(D&&k==='ck'){ sheet(win,'更新网易云 cookie','<textarea class="pg-in mono" placeholder="粘贴 MUSIC_U 的值" style="min-height:110px"></textarea><div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn pri tap" data-ck>保存</button></div>',function(sh,close){ sh.querySelector('[data-ck]').addEventListener('click',function(){ var b=this, v=sh.querySelector('textarea').value.trim().replace(/^MUSIC_U=/,'').replace(/;.*$/,''); if(!v){ buzz([20,30,20]); return; } b.classList.add('busy');
        P.net.post(PB+'netease/save',{music_u:v}).then(function(r2){ b.classList.remove('busy'); close(); toast(r2&&r2.account?'换好了 · 登录有效':'存了，但账号没读出来'); buzz([8,30,8]); load(); },function(e){ b.classList.remove('busy'); toast(/400/.test(String(e&&e.message))?'格式不对，只要 MUSIC_U 的值':'没存上'); buzz([20,30,20]); }); }); }); return; }
    /* [位置:phone-pages.js·pulseSetup] [网易云扫码登录] [10-25：cookie 过期只能开电脑网页复制 MUSIC_U。现在点「扫码登录」出二维码，手机网易云 App 扫一扫确认，网关轮询 801=待扫 / 802=已扫待确认 / 803=成功自动落盘 / 800=过期可重新生成；sheet 从 DOM 摘掉（sh.isConnected=false）即停轮询，不用依赖 sheet 内部事件。二维码白底是给深色模式垫的，黑块在暗底下看得见] [注释时间 2026-10-25] */
    if(D&&k==='qr'){ sheet(win,'扫码登录网易云','<div style="display:flex;justify-content:center"><div id="qrBox" style="background:#fff;padding:10px;border-radius:14px;line-height:0"><span class="pg-spin"></span></div></div><div class="pg-ft" style="text-align:center" id="qrTip">二维码拿取中…</div><div class="pg-bts" style="padding:4px 0 2px;justify-content:center"><button class="pg-btn tap" id="qrRe" hidden>重新生成</button></div>',function(sh,close){
      var box=sh.querySelector('#qrBox'), tip=sh.querySelector('#qrTip'), re=sh.querySelector('#qrRe'), uk='', tm=0;
      function stop(){ clearTimeout(tm); tm=0; }
      function check(){
        if(!sh.isConnected){ stop(); return; }
        P.net.post(PB+'netease/qr/check',{unikey:uk}).then(function(r2){
          if(!sh.isConnected) return;
          var c=r2&&r2.code;
          if(c===803){ stop(); if(sh.querySelector('[data-x]')) sh.querySelector('[data-x]').click(); else close();
            toast(r2&&r2.account?'登录好了 · cookie 已更新':'扫码成功，cookie 已更新'); buzz([8,30,8]); load(); return; }
          if(c===800){ stop(); tip.textContent='二维码过期了'; re.hidden=false; return; }
          tip.textContent=c===802?'扫到了，到手机上点确认':'打开手机网易云，右上角扫一扫';
          tm=setTimeout(check,2000);
        },function(){ if(!sh.isConnected) return; tip.textContent='网络没通，重试中…'; tm=setTimeout(check,3000); });
      }
      function create(){
        stop(); re.hidden=true; tip.textContent='二维码拿取中…'; box.innerHTML='<span class="pg-spin"></span>';
        P.net.post(PB+'netease/qr/create',{}).then(function(r2){
          if(!sh.isConnected) return;
          uk=r2.unikey||''; box.innerHTML=r2.qrSvg||'';
          var svg=box.querySelector('svg');
          if(svg){ svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width='190px'; svg.style.height='190px'; svg.style.display='block'; }
          tip.textContent='打开手机网易云，右上角扫一扫';
          tm=setTimeout(check,1500);
        },function(){ if(!sh.isConnected) return; box.innerHTML=''; tip.textContent='没拿到二维码，稍后再试'; re.hidden=false; });
      }
      re.addEventListener('click',function(){ buzz(6); create(); });
      create();
    }); return; }
    pulseDemo(k,t,i);
  }});
  function pulseDemo(k,t,i){
    if(k[0]==='s'){ var s=SVC[i]; sheet(win,s[1],'<div class="pg-g">'+r({t:'状态',right:'<span class="pg-tag ok">在线</span>'})+r({t:'进程名',v:s[0]})+r({t:'已运行',v:s[3]})+r({t:'内存',v:s[4]})+'</div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn tap red" data-stop>停止</button><button class="pg-btn pri tap" data-rs>重启</button></div>',function(sh,close){
      sh.querySelector('[data-rs]').addEventListener('click',function(){ var b=sh.querySelector('[data-rs]'); b.innerHTML='<i class="pg-spin"></i>重启中…'; setTimeout(function(){ close(); t.classList.add('flash'); toast(s[1]+' 重启好了'); buzz([8,30,8]); },1600); });
      sh.querySelector('[data-stop]').addEventListener('click',function(){ close(); t.querySelector('.pg-dot').classList.add('off'); toast(s[1]+' 已停止'); }); }); }
    else if(k==='bk') sub(win,'备份记录',grp('',['10-19 03:00 · 186 MB','10-18 03:00 · 185 MB','10-17 03:00 · 183 MB'].map(function(b){ return r({t:b.split(' · ')[0],v:b.split(' · ').slice(1).join(' · ')}); }),null,0));
    else if(k[0]==='n'){ var e=SENT[i]; sheet(win,e[0],'<div class="pg-g">'+r({t:'时间',v:e[1].split(' · ')[0]})+r({t:'详情',s:e[1].split(' · ').slice(1).join(' · ')})+'</div>'); }
    else if(k==='ck') sheet(win,'更新网易云 cookie','<textarea class="pg-in mono" placeholder="粘贴 MUSIC_U=…" style="min-height:110px"></textarea><div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn pri tap" data-run="save">保存</button></div>');
    else if(k[0]==='l'){ var m=LLM[i]; sheet(win,m[0],'<div class="pg-g">'+r({t:'用途',v:m[1]})+r({t:'模型',v:m[2]})+r({t:'上次调用',v:m[3]})+r({t:'耗时',v:m[4]})+'</div>'); }
  }
  $('#bkR',win).addEventListener('click',function(){ var b=this; b.style.transition='transform .6s'; b.style.transform='rotate(360deg)'; setTimeout(function(){ b.style.transition='none'; b.style.transform=''; },620); var h=$('.bk-hero',win); if(h){ h.classList.remove('zap'); void h.offsetWidth; h.classList.add('zap'); } buzz(6);
    if(D){ load().then(function(){ toast('刷新了'); }); } else { load(1); } });
  load();
  P.pulse2={svc:function(){ $('[data-go="s0"]',win).click(); }};
}
P.register('pulse',{html:pulseHTML,setup:pulseSetup});


/* ---------- 聊天主题 · 气泡外观（2026-10-31：原「配置 → 聊天外观」整页并入 设置 → 主题）----------
   主题卡（THEMES）：月夜玻璃=bubble（气泡主题）、极简=min；点卡切全局聊天主题（P.chatStyle，键没变），选月夜玻璃才显示气泡编辑区；
   编辑区 = 预览 + 两边气泡（颜色 / 文字颜色 / 透明度 / 模糊 / 阴影）+ 圆角 + 聊天背景，只对气泡主题生效（极简在 .tkmin 里把这些变量定回自己的值，见 phone-talk.css）；字体与字号两种主题通用；
   颜色、圆角、背景交给 phone-bubble.js（P.bubble，聊天页的气泡本来就是它画的）；
   每边单独的透明度 / 模糊 / 阴影 / 文字颜色、字号是 look 段，用 CSS 变量套到聊天页气泡上（P.lookApply）。本机统一存 ph.chattheme.v1（见 phone-kit.js·P.chatTheme，2026-11-14 第 24 条 b 收拢，原 ph.look.v2 等散键读时迁移）。 */
/* [位置:phone-pages.js·LDEF] [look 段缺省改指统一存储的 SCHEMA] [字段缺省的唯一定义点挪到 phone-kit.js·P.chatTheme.SCHEMA.look，这里只留引用；PatG=生成器参数串（g1|款式|角度|透明度|底色|色1,色2,色3|色带宽），Pat='gen' 时生效；线框 Ls 样式(none/solid/dash/wave)、Lw 粗细px、Lc 颜色(空=跟气泡色)；图案 Pat=图案id、PatS=密度(tile边长px)、PatC=图案色(空=跟气泡色)] [注释时间 2026-11-14] */
var LDEF=P.chatTheme.SCHEMA.look;
var AIC=['#f6f9ff','#fdf1f4','#fff7ea','#2f3447'];   /* [位置:phone-pages.js·AIC] [他的气泡推荐色] [10-31 四轮：推荐色减到 4 个，加最近用 2 + ＋ 刚好一行（去掉跟默认淡蓝白几乎一样的纯白、薄荷绿）] [注释时间 2026-10-31 四轮] */
/* [位置:phone-pages.js·migLook/bgType] [形状档与背景类型分到两边] [2026-11-06：公共也要分两边，只是各自的公共——形状档、背景类型都要每边一套。老数据只有全局 bs，迁移时两边都取它；背景类型没存过就按「有没有图案」推断：有图案的边=图案，没有=实色] [注释时间 2026-11-06] */
function migLook(o){
  var bs=(o.bs==='sms'||o.bs==='hsq'||o.bs==='tailsvg')?o.bs:'def';
  ['ai','me'].forEach(function(s){
    if(o[s+'Bs']!=='def'&&o[s+'Bs']!=='sms'&&o[s+'Bs']!=='hsq'&&o[s+'Bs']!=='tailsvg') o[s+'Bs']=bs;   /* [2026-11-17 批5 修] 白名单补 hsq：批2 E4 加档时这里漏了，存了 hsq 的配置每次 lookLoadSaved 都被打回旧档（形状档「存不住」） */
    if(o[s+'BgType']!=='pat'&&o[s+'BgType']!=='solid') o[s+'BgType']=((o[s+'Pat']&&o[s+'Pat']!=='none')?'pat':'solid');
    /* [位置:phone-pages.js·migLook] [气泡间距分到两边] [2026-11-10：内边距/外边距原来是他的和我的共用一份（bpad/bgap），现在每边一套（aiPad/mePad/aiGap/meGap）。老数据没有新键时两边都取老的共用值，升级后观感零变化] [注释时间 2026-11-10] */
    if(o[s+'Pad']==null) o[s+'Pad']=o.bpad||8;
    if(o[s+'Gap']==null) o[s+'Gap']=(o.bgap==null?4:o.bgap);
    if(o[s+'MaxW']==null) o[s+'MaxW']=(s==='ai'?90:80);
  });
  if(o.avPos!=='top'&&o.avPos!=='side') o.avPos='top';
  return o;
}
function bgType(o,s){ o=o||P.lookV; var t=o[s+'BgType']; return (t==='pat'||t==='solid')?t:((o[s+'Pat']&&o[s+'Pat']!=='none')?'pat':'solid'); }
P.lookV=migLook(P.lookV||(function(){ var o=Object.assign({},LDEF); try{ var o1=P.chatTheme.read(); if(o1&&o1.look) Object.assign(o,o1.look); }catch(e){} return o; })());   /* [2026-11-14 收拢] 本机读取改走 P.chatTheme（ph.chattheme.v1·look 段，旧键读时迁移） */
P.lookApply=function(){ var V=P.lookV, rs=document.documentElement.style;
  rs.setProperty('--hsq-ai',(V.aiHsqR==null?11:V.aiHsqR)+'px'); rs.setProperty('--hsq-me',(V.meHsqR==null?11:V.meHsqR)+'px');   /* [2026-11-17] 两方两圆方角变量：look 载入/恢复自定义主题（lookLoadSaved 只走这里、不走 bubble.applyVars）也要刷；与 phone-bubble.js·applyVars 同源双写 */
  rs.setProperty('--tk-ai-a',String(V.aiA/100)); rs.setProperty('--tk-me-a',String(V.meA/100));
  /* [位置:phone-pages.js·lookApply 背景模糊] [模糊两种背景都生效] [2026-11-10：图案透明度调低后，图案下面那层会透出聊天背景；模糊挪成两种背景共用，图案模式也能把图案下面那层糊掉（原 11-06 图案模式模糊归零的限制取消）] [注释时间 2026-11-10] */
  rs.setProperty('--tk-ai-bl',V.aiBl+'px'); rs.setProperty('--tk-me-bl',V.meBl+'px');
  rs.setProperty('--tk-ai-sh',String(V.aiSh/100)); rs.setProperty('--tk-me-sh',String(V.meSh/100));
  if(V.aiInk) rs.setProperty('--tk-ai-ink',V.aiInk); else rs.removeProperty('--tk-ai-ink');
  if(V.meInk) rs.setProperty('--tk-me-ink',V.meInk); else rs.removeProperty('--tk-me-ink');
  if(P.bubble&&P.bubble.refresh) P.bubble.refresh();   /* [2026-11-18] 气泡字色变化时同步重算自定义主题卡片配色 */
  rs.setProperty('--tk-fs',V.fs+'px');
  /* [位置:phone-pages.js·lookApply 形状/输入框档] [2026-11-02：输入框三选挂 #device 的 data-ib（phone-talk.css 按 attr 出规则）；内边距/外边距/输入框圆角/高度写根变量；默认值=现状，没调过零变化。气泡形状档不在这条里——11-06 起形状分边、挂到每个气泡自己身上（.b[data-bs]，phone-bubble.js·redraw 写、phone-bubble.css 出规则），这里只在末尾管 data-ib/data-av/data-avpos] [注释时间 2026-11-02；2026-11-17 批5 勘误；2026-11-23 加气泡最大宽度与头像位置] */
  rs.setProperty('--bpad-ai',(V.aiPad||8)+'px'); rs.setProperty('--bpad-me',(V.mePad||8)+'px'); rs.setProperty('--bgap-ai',(V.aiGap==null?4:V.aiGap)+'px'); rs.setProperty('--bgap-me',(V.meGap==null?4:V.meGap)+'px');   /* [2026-11-10] 内/外边距每边一套 */
  rs.setProperty('--bmaxw-ai',(V.aiMaxW==null?90:V.aiMaxW)+'%'); rs.setProperty('--bmaxw-me',(V.meMaxW==null?80:V.meMaxW)+'%');
  rs.setProperty('--ibr',(V.ibr==null?21:V.ibr)+'px'); rs.setProperty('--ibh',(V.ibh==null?44:V.ibh)+'px');
  var D=P.D||document.getElementById('device'); if(D){ D.classList.toggle('tkbl-ai',V.aiBl>0); D.classList.toggle('tkbl-me',V.meBl>0);
    D.classList.toggle('bgp-ai',bgType(V,'ai')==='pat'); D.classList.toggle('bgp-me',bgType(V,'me')==='pat');   /* [2026-11-06 图案背景] 图案模式：该边气泡不铺实色底（phone-bubble.css） */
    D.setAttribute('data-ib',V.ib||'def'); D.setAttribute('data-av',(V.av==null||V.av)?'1':'0'); D.setAttribute('data-avpos',V.avPos==='side'?'side':'top'); }   /* 形状档不再挂 #device（11-06 起挂到每个气泡自己身上，两边各一套） */
  if(P.lookDraftEl&&P.lookDraftEl._chk) P.lookDraftEl._chk(); };   /* [2026-11-05 所有改动路径（滑杆/选卡/颜色/背景）最后都经 lookApply，在这里通知设置子页重算「有没有未保存修改」] */
/* [位置:phone-pages.js·lookPut/lookLoadSaved/lookFlush] [look 配置的存取：草稿 / 已保存分开] [2026-11-05：月夜玻璃设置子页改成「点保存才落盘」。子页开着（P.lookDraftEl 还在 DOM 里）时 lookPut 只改内存+样式，不写 localStorage、不上云；主题页（字体字号）和其它没草稿的场合照旧改完即存并 1 秒后上云。lookFlush=点保存时整份写本机（写不进会抛错）；lookLoadSaved=丢掉草稿、从本机已保存的重读（原地改 P.lookV，别处拿着引用也跟着变）] [注释时间 2026-11-05] */
function lookDrafting(){ return !!(P.lookDraftEl&&P.lookDraftEl.isConnected); }
P.lookPut=function(o){ Object.assign(P.lookV,o||{}); if(!lookDrafting()){ try{ P.chatTheme.save({look:P.lookV}); }catch(e){} if(P.themeSync) P.themeSync.touch(); } P.lookApply(); };   /* [2026-11-14 收拢] 落盘改走 P.chatTheme（配额不足照旧吞掉，与原 setItem 一致） */
P.lookFlush=function(){ P.chatTheme.save({look:P.lookV}); };   /* [2026-11-14 收拢] 点保存整份写本机，写不进照旧抛错（save 配额不足原样往上抛） */
P.lookLoadSaved=function(){ var o=null; try{ var o1=P.chatTheme.read(); o=o1?o1.look:null; }catch(e){} Object.keys(P.lookV).forEach(function(k){ delete P.lookV[k]; }); Object.assign(P.lookV,LDEF,o||{}); migLook(P.lookV); var fi=document.querySelector('.th-fs .pg-st input'); if(fi&&document.activeElement!==fi) fi.value=P.lookV.fs; P.lookApply(); };   /* [2026-11-14 收拢] 已保存的 look 从 P.chatTheme 读（丢弃草稿、原地改 P.lookV，别处拿着引用也跟着变）；[2026-11-14 第27条] 补同步主题页字号步进器——原来只刷内存和 CSS 变量，输入框还挂旧数：恢复自定义主题后再点一下就从快照值跳到旧值+1（探针实测 17→19）；正用手输时不抢 */
P.lookApply();
function bubG(){ return P.bubble?P.bubble.get():{me:'#7298d6',ai:'#f6f9ff',r:15,bg:'',veil:0}; }
function bubS(o){ if(P.bubble) P.bubble.set(o); P.lookApply(); }
function bgName(){ var g=bubG(); if(!g.bg) return '跟随桌面'; if(g.bg==='img') return '自己的照片'; return (P.bubble&&P.bubble.BG[g.bg])?P.bubble.BG[g.bg][0]:'跟随桌面'; }
function swRow(side,title){ return '<div class="pg-r col lk-c" data-side="'+side+'"><span class="rt"><b>'+title+'</b></span><div class="th-sw"></div></div>'; }
function inkRow(side){ return '<div class="pg-r lk-i" data-side="'+side+'"><span class="rt"><b>文字颜色</b></span><span class="lk-ink"><button type="button" class="tap lk-auto">自动</button><button type="button" class="tap lk-pick" aria-label="自己调文字颜色"><i></i></button></span></div>'; }
/* [位置:phone-pages.js·frRow] [线框颜色行] [照 inkRow 同构（.lk-i.lf）：跟随=空值走气泡色；pick 弹 colorSheet。class 带 lf 区分文字色行（paint/click 分支都按 .lf 先截）] [注释时间 2026-11-02] */
function frRow(side){ return '<div class="pg-r lk-i lf" data-side="'+side+'"><span class="rt"><b>线框颜色</b></span><span class="lk-ink"><button type="button" class="tap lk-auto">跟随气泡色</button><button type="button" class="tap lk-pick" aria-label="自己调线框颜色"><i></i></button></span></div>'; }
function pfRow(side){ return '<div class="pg-r lk-i pf" data-side="'+side+'"><span class="rt"><b>图案颜色</b></span><span class="lk-ink"><button type="button" class="tap lk-auto">跟随气泡色</button><button type="button" class="tap lk-pick" aria-label="自己调图案颜色"><i></i></button></span></div>'; }   /* [2026-11-02 图案颜色行：结构同 frRow，class=pf 区分（click 分支在 lf 前拦）] */
/* [位置:phone-pages.js·solidRows] [实色背景的三行] [颜色 / 透明度 / 模糊——只在这个边选「实色」时出现；透明度、模糊是实色特有的（11-06）] [注释时间 2026-11-06] */
function solidRows(s){ var V=P.lookV, p=s==='ai'?'ai':'me';
  return swRow(s,'气泡颜色')+slider('lk'+p+'A','透明度',V[p+'A'],10,100,1,'pc')+slider('lk'+p+'Bl','背景模糊',V[p+'Bl'],0,24,1,'px'); }
/* [位置:phone-pages.js·bgtHTML] [背景二选一] [实色 / 图案——两个是两套背景配置，只能选一个；切到图案时自动载入一款默认底图，不至于点了是空的] [注释时间 2026-11-06] */
function bgtHTML(p){ var bt=bgType(P.lookV,p);
  return '<div class="pg-r col lk-bgt" data-bgt="'+p+'"><div class="lk-opts">'+
    [['solid','实色','lk-bgs'],['pat','图案','lk-bgp']].map(function(o){ return '<button type="button" class="tap'+(bt===o[0]?' on':'')+'" data-bgtv="'+o[0]+'" data-bgtp="'+p+'"><i class="'+o[2]+'"></i><span>'+o[1]+'</span></button>'; }).join('')+
    '</div></div>'; }
/* [位置:phone-pages.js·lookTopHTML] [主题设置子页预览（页头槽，滑动固定）] [2026-10-31 四轮：预览放 sub 的 top 槽（滚动区外面），往下滑调滑块时固定在标题栏下面一直看得见；原聊天外观页同款位置] [注释时间 2026-10-31 四轮] */
/* [位置:phone-pages.js·lookTopHTML] [主题设置子页预览（页头槽，滑动固定）] [2026-10-31 四轮：预览放 sub 的 top 槽（滚动区外面），往下滑调滑块时固定在标题栏下面一直看得见] [注释时间 2026-10-31 四轮；11-02：预览输入框要和聊天页一样——换成真实 composer 同构（plus 猫 / field 圆角高度背景 / send 纸飞机），样式与三档规则在 phone-talk.css·.lk-ibw 与真机 .composer 并排复刻；svg path 与 phone-talk.js·I.cat/I.plane 同源，改图标记得两边一起改] [注释时间 2026-11-02] */
/* [位置:phone-pages.js·lookTopHTML] [顶部固定区：按页签分三段预览 + AI的/我的 + 两边同步] [2026-11-06：气泡页只预览这一边的气泡、输入框页只预览输入框、聊天背景页给整张；「AI 的 / 我的」和「两边同步」都固定，同步单独占一行] [注释时间 2026-11-06] */
function lookTopHTML(){ var CAT='<path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/>',
  PLANE='<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>', V=P.lookV;
  /* [位置:phone-pages.js·lookTopHTML 图标] [预览发送键独立类名] [2026-11-02截图：预览发送键蓝球没飞机——按钮借用真机 .tk-send 类名，被真机发送键的规则群（反色/字号/!important 一族）波及，环境一变图标就丢；换独立 .lk-send/.lk-plus 与真机规则彻底脱钩，svg 加显式 width/height 属性兜底（不依赖任何 CSS）；组尾 .tail 直接在预览 HTML 里标，与真机渲染链标尾同口径] [注释时间 2026-11-02] */
  var aNm=(P.names&&P.names.ai)?P.names.ai():'助手', uNm=(P.names&&P.names.me)?P.names.me():'用户', aLt=(P.names&&P.names.letter)?P.names.letter('ai'):'助', uLt=(P.names&&P.names.letter)?P.names.letter('me'):'用';
  var HD_AI='<div class="lk-hd"><i>'+esc(aLt)+'</i><span class="lk-nt"><span class="lk-nm">'+esc(aNm)+' · </span><span class="lk-tm">11.02  10:00</span></span></div>', HD_ME='<div class="lk-hd me"><i>'+esc(uLt)+'</i><span class="lk-nt"><span class="lk-nm">'+esc(uNm)+' · </span><span class="lk-tm">11.02  10:01</span></span></div>';
  var B_AI='<div class="b ai first">今天也要好好吃饭。</div><div class="b ai tail">晚饭想吃什么呀？</div>', B_ME='<div class="b me first tail">知道啦</div>';
  var G_AI='<div class="lk-grp ai">'+HD_AI+'<div class="lk-col">'+B_AI+'</div></div>', G_ME='<div class="lk-grp me">'+HD_ME+'<div class="lk-col">'+B_ME+'</div></div>';
  var IB='<div class="lk-ibw"><button class="lk-plus" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">'+CAT+'</svg></button><div class="field"><span>随便聊聊…</span><button class="lk-send" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20">'+PLANE+'</svg></button></div></div>';
  return '<div class="lk-top">'+
    /* 页签 0 · 气泡：只显当前这一边的气泡（切边时整块换） */
    '<div class="lk-pvw on" data-pvw="0"><div class="th-pv lk-pv bb-pv lk-pvbub" id="thPv">'+
      '<div class="lk-ms lk-sd-ai">'+G_AI+'</div>'+
      '<div class="lk-ms lk-sd-me">'+G_ME+'</div>'+
    '</div></div>'+
    /* 页签 1 · 输入框：只显输入栏 */
    '<div class="lk-pvw" data-pvw="1"><div class="th-pv lk-pv bb-pv lk-pvib">'+IB+'</div></div>'+
    /* 页签 2 · 聊天背景：整张（两边气泡 + 输入栏） */
    '<div class="lk-pvw" data-pvw="2"><div class="th-pv lk-pv bb-pv"><div class="lk-ms">'+G_AI+G_ME+'</div>'+IB+'</div></div>'+
  '</div>'+
  '<div class="lk-sidebar">'+
    '<div class="lk-sidewrap">'+seg(['AI 的','我的'],0).replace('class="pg-seg"','class="pg-seg lk-side"')+'</div>'+
  '</div>'+
  /* [2026-11-06] 两边同步单独一行，放在切边行下面 */
  '<div class="lk-syncbar"><span class="lk-synclab">两边同步</span><span class="lk-syncd">开着时改一边，另一边跟着变</span><button type="button" class="pg-sw'+(V.sync?' on':'')+'" data-tg="lksync" role="switch" aria-checked="'+(V.sync?'true':'false')+'" aria-label="两边同步"></button></div>'; }   /* [2026-11-16 批2 E8] 描述改新语义：只同步开启之后的改动 */
/* [位置:phone-pages.js·lkOpts] [选择卡（迷你示意+名字，横排）] [2026-11-02：气泡样式 / 输入框选择器用；attr=写进按钮的 data 属性名；ico=示意块 class（形状在 phone-pages.css·lk-opts）] [注释时间 2026-11-02] */
var BS_LIST=[['def','默认圆角','lk-sh-d'],['sms','经典收角','lk-sh-s'],['hsq','两方两圆','lk-sh-h'],['tailsvg','小尾巴','lk-sh-v']];   /* [2026-11-02对比后定留 SVG 版（fc24b78 iMessage 弯尾），CSS 版已删；2026-11-16 批2 E4 加两方两圆 hsq（AI 左角方/我右角方，示意图标 lk-sh-h 见 phone-pages.css）] */
var IB_LIST=[['def','胶囊','lk-ibo'],['glass','玻璃','lk-ibo lk-ibo-g'],['moon','月光河','lk-ibo lk-ibo-m']];
/* [位置:phone-pages.js·LW_LIST] [线框样式四选] [图标 lk-fr-* 在 phone-pages.css（小方块示意：无=斜杠框/单线=实线框/虚线=dashed/波浪=内嵌波形）；data 属性名带角色（data-lsai/data-lsme）——lkOpts 的 attr 直接拼值，两个角色的组不能同名] [注释时间 2026-11-02] */
var LW_LIST=[['none','无','lk-fr-n'],['solid','单线','lk-fr-s'],['dash','虚线','lk-fr-d'],['wave','波浪','lk-fr-w']];
/* [位置:phone-pages.js·PAT_LIST] [图案底纹十选] [图标 lk-pt-* 在 phone-pages.css（dataURI 小 SVG，色调统一灰蓝）；「无」复用线框斜杠框 lk-fr-n；缺省=不铺图案] [注释时间 2026-11-02] */
var PAT_LIST=[['none','无','lk-fr-n'],['dot','圆点','lk-pt-dot'],['ring','圆环','lk-pt-ring'],['heart','爱心','lk-pt-heart'],['star','星星','lk-pt-star'],['sparkle','闪星','lk-pt-sparkle'],['paw','猫爪','lk-pt-paw'],['drop','水滴','lk-pt-drop'],['plus','十字','lk-pt-plus'],['grid','格子','lk-pt-grid'],['stripe','条纹','lk-pt-stripe']];
/* [位置:phone-pages.js·PAT_CATS/patGridHTML/gcolHTML/patBodyHTML] [成品底图选择器与微调面板] [11-05：图案区不再是「10 个小图案+密度」，改成 20 款成品底图缩略图（点一款=载入它的参数），选中后下面出 大小/透明度/角度/颜色 微调；缩略图用 P.bubble.patURI 现画，和真气泡图案是同一套渲染代码，不会图不对版] [注释时间 2026-11-05] */
var PAT_CATS=[['格','格纹'],['点','点状'],['线','线条'],['图','图案']];
function patGridHTML(p){
  var cur=P.lookV[p+'Pat']||'none', B=P.bubble, g=(cur==='gen'&&B&&B.genParse)?B.genParse(P.lookV[p+'PatG']):null, st=g?g.style:'';
  var h='<div class="pg-r col"><div class="lk-pcats" data-pcs="'+p+'"><button type="button" class="tap on" data-pc="">全部</button>'+PAT_CATS.map(function(c){ return '<button type="button" class="tap" data-pc="'+c[0]+'">'+c[1]+'</button>'; }).join('')+'</div></div>';
  h+='<div class="pg-r col"><div class="lk-pats" data-patg="'+p+'">';
  h+='<button type="button" class="tap'+(cur==='none'?' on':'')+'" data-pg="none" data-cat=""><i class="lk-pnone"></i><span>无</span></button>';
  (B?B.GEN:[]).forEach(function(o){
    h+='<button type="button" class="tap'+((cur==='gen'&&st===o[0])?' on':'')+'" data-pg="'+o[0]+'" data-cat="'+o[2]+'"><i style="background-image:'+B.patURI(o[3],18)+';background-size:18px 18px"></i><span>'+o[1]+'</span></button>';
  });
  h+='</div></div>';
  return h;
}
function gcolHTML(g){
  var h='<button type="button" class="tap gc-bg" data-gcb="1" style="--c:'+(g.bg||'transparent')+'" aria-label="底色"></button>';
  (g.cols||[]).forEach(function(c,i){ h+='<button type="button" class="tap gc" data-gci="'+i+'" style="--c:'+c+'" aria-label="'+c+'"></button>'; });
  if((g.cols||[]).length<3) h+='<button type="button" class="tap gc-add" data-gcadd="1" aria-label="加一个颜色">+</button>';
  return h;
}
function patBodyHTML(p){
  var V=P.lookV, B=P.bubble, up=(p==='ai'?'Ai':'Me'), cur=V[p+'Pat']||'none';
  var g=(cur==='gen'&&B&&B.genParse)?B.genParse(V[p+'PatG']):null;
  /* [2026-11-05 透明度解耦] 旧 10 图案也补「图案透明度」滑杆（存 aiPatO/mePatO，缺省 100=维持原来 .4 的浓度）——气泡透明度只管纯色底，图案浓度自己管，两套图案一个概念 */
  if(!g) return slider('lk'+up+'PatS','图案密度',V[p+'PatS']==null?16:V[p+'PatS'],10,28,1,'px')
    +slider('lk'+up+'PatOX','图案透明度',V[p+'PatO']==null?100:V[p+'PatO'],0,100,1,'pc')+slider('lk'+p+'BlP','背景模糊',V[p+'Bl'],0,24,1,'px')+pfRow(p);   /* [2026-11-10] 背景模糊紧跟图案透明度：图案变淡后透出的底层靠它糊掉，两处滑杆（实色 lk?Bl / 图案 lk?BlP）读写同一个 aiBl/meBl */
  var icon=B.IC_RE&&B.IC_RE.test(g.style), h='';
  h+=slider('lk'+up+'PatS','图案大小',V[p+'PatS']==null?16:V[p+'PatS'],10,44,1,'px');
  h+=slider('lk'+up+'PatO','图案透明度',g.op,0,100,1,'pc');   /* [2026-11-05] 范围 0~100：0 = 完全不要图案（跟「无」的区别是底图还留着），100 = 设计原样 */
  h+=slider('lk'+p+'BlP','背景模糊',V[p+'Bl'],0,24,1,'px');
  if(icon) h+=slider('lk'+up+'PatA','旋转角度',g.ang,0,345,15,'');
  else h+='<div class="pg-r col"><span class="rt"><b>角度</b></span><div class="lk-pang" data-pang="'+p+'">'+[0,45,90].map(function(a){ return '<button type="button" class="tap'+(g.ang===a?' on':'')+'" data-pa="'+a+'">'+a+'°</button>'; }).join('')+'</div></div>';
  h+='<div class="pg-r col"><span class="rt"><b>颜色</b></span><div class="lk-gcol" data-gc="'+p+'">'+gcolHTML(g)+'</div>'
    +'<div class="lk-gbtns"><button type="button" class="tap" data-grand="'+p+'">随机配色</button><button type="button" class="tap" data-gcbg0="'+p+'">跟气泡色</button></div></div>';
  return h;
}

function lkOpts(list,cur,attr){ return '<div class="pg-r col"><div class="lk-opts">'+list.map(function(o){ return '<button type="button" class="tap'+(o[0]===cur?' on':'')+'" '+attr+'="'+o[0]+'"><i class="'+o[2]+'"></i><span>'+o[1]+'</span></button>'; }).join('')+'</div></div>'; }
/* [位置:phone-pages.js·lookBubbleHTML] [月夜玻璃主题设置子页内容] [2026-10-31 三轮：他的气泡 + 我的气泡（圆角两边各一个，可以不同）+ 聊天背景（网格直接展开，不再点行弹底板）；预览在 top 槽（lookTopHTML），不放滚动区里] [注释时间 2026-10-31 三轮；四轮拆出预览；11-02 加气泡样式/气泡间距/输入框三组] */
/* [位置:phone-pages.js·lookBubbleHTML/sideSec] [气泡主题配置页整理：页签 + 他/我切换 + 两边同步] [2026-11-03：原来 10 个分组一条长页（约 3000px，他的/我的各重复一份气泡/线框/图案），改成顶部固定三个页签「气泡 / 输入框 / 背景」；「气泡」页里用「他的 / 我的」切换，只显示一边的 气泡·线框·图案 三组；「两边同步」开着时，透明度/模糊/阴影/圆角/线框/图案跟着另一边一起变（颜色与文字色各管各，见 lookSetup·mirrorAll）。控件 id / data 属性一个没改（两边 DOM 都在，只是切换显隐），事件与落盘（ph.look.v2）原样。页签 seg 放顶部槽（lookTopHTML 之后），面板在滚动区里] [注释时间 2026-11-03] */
/* [位置:phone-pages.js·sideSec] [一边气泡的完整设置] [2026-11-06 定的层级：外形（这一边的气泡共用：形状档·圆角·阴影·描边）→ 背景（实色 or 图案，二选一）→ 文字颜色。原来「颜色」和「图案」是两组并列、能同时存在且互相盖，形状档又被排到整页末尾，所以看着矛盾] [注释时间 2026-11-06] */
function sideSec(s){ var V=P.lookV, p=s, up=s==='ai'?'Ai':'Me', g=bubG(), bt=bgType(V,p);
  var R=(p==='ai'?g.aiR:g.meR)||15;
  return grp('外形',[
      lkOpts(BS_LIST,V[p+'Bs']||'def','data-bs'+p),
      /* [位置:phone-pages.js·sideSec hsq 方角滑杆] [两方两圆专用「方角」固定值] [11-17：「加一个方角固定值…选两方两圆的时候才有」——行显隐 paint 按 data-hsq 切（值保留，切档不丢）；存 look 段 aiHsqR/meHsqR 缺省 11，滑杆接线在 lookSetup input/change 分支] [注释时间 2026-11-17] */
      '<div class="pg-r col lk-hsqrow" data-hsq="'+p+'"'+((V[p+'Bs']||'def')!=='hsq'?' hidden':'')+'>'+slider('lk'+p+'HsqR','方角',V[p+'HsqR']==null?11:V[p+'HsqR'],0,16,0.5,'px')+'</div>',
      slider('lk'+p+'R','圆角',R,4,24,1,'px'),
      slider('lk'+p+'Sh','阴影',V[p+'Sh'],0,60,1,'pc'),
      lkOpts(LW_LIST,V[p+'Ls']||'none','data-ls'+p),
      '<div class="pg-r col lk-lfrows" data-lfs="'+p+'"'+((V[p+'Ls']||'none')==='none'?' hidden':'')+'>'+slider('lk'+up+'Lw','线框粗细',V[p+'Lw']==null?2:V[p+'Lw'],1,4,1,'px')+'<div class="lk-ldw" data-ldw="'+p+'"'+(/^(dash|wave)$/.test(V[p+'Ls']||'')?'':' hidden')+'>'+slider('lk'+up+'Ld','线条疏密（右边更密）',V[p+'Ld']==null?50:V[p+'Ld'],10,100,1,'')+'</div>'+slider('lk'+up+'Lo','线框透明度',V[p+'Lo']==null?100:V[p+'Lo'],0,100,1,'pc')+frRow(p)+'</div>'   /* [2026-11-16 批2 E7] 线框透明度：存 aiLo/meLo（0-100 缺省 100），实色/虚线/波浪三档都吃（drawFrame/svgShape 的 stroke-opacity） */
    ],null,0)+
  grp('气泡间距',[slider('lk'+up+'Pad','内边距',V[p+'Pad']==null?8:V[p+'Pad'],4,18,1,'px'),slider('lk'+up+'Gap','外边距',V[p+'Gap']==null?4:V[p+'Gap'],0,20,1,'px'),slider('lk'+up+'MaxW','气泡最大宽度',V[p+'MaxW']==null?(p==='ai'?90:80):V[p+'MaxW'],50,100,1,'pc')],null,1)+
  grp('背景',[
      bgtHTML(p),
      '<div class="lk-solidrows" data-sol="'+p+'"'+(bt==='pat'?' hidden':'')+'>'+solidRows(p)+'</div>',
      '<div class="lk-patbox" data-patw="'+p+'"'+(bt==='pat'?'':' hidden')+'>'+patGridHTML(p)+'<div class="pg-r col lk-pfrows" data-pfs="'+p+'">'+patBodyHTML(p)+'</div></div>',
      inkRow(s)
    ],null,2); }
/* [位置:phone-pages.js·lookTopHTML/lookBottomHTML] [固定区拆两处：顶部=预览+切边行，底部=页签导航] [2026-11-06：页签放到底部做导航栏；「AI 的 / 我的」留顶部固定；「两边同步」单独一行放在切边行下面] [注释时间 2026-11-06] */
/* [位置:phone-pages.js·lookBottomHTML] [底部页签导航] [2026-11-06：气泡 / 输入框 / 聊天背景放到底部做导航栏] [注释时间 2026-11-06] */
function lookBottomHTML(){ return '<div class="lk-tabbar">'+seg(['气泡','输入框','聊天背景'],0).replace('class="pg-seg"','class="pg-seg lk-tabs"')+'</div>'; }
function lookBubbleHTML(){ var g=bubG(), veil=g.veil||0, cur=g.bg||'', V=P.lookV, avOn=(V.av==null?true:!!V.av);
  return '<div class="pg-pane on">'+
      /* [2026-11-06] 切边条与同步开关都在顶部槽（lookTopHTML），这里只剩两边的面板；面板用 .lk-pane 跟页签的 .pg-pane 区分 */
      '<div class="lk-pane on">'+sideSec('ai')+'</div><div class="lk-pane">'+sideSec('me')+'</div>'+
      /* [位置:phone-pages.js·头像开关] [显示消息头像 + 头像位置] [2026-11-02：气泡主题里加开关；2026-11-23：紧跟加「头像位置」二选一（消息上方 / 气泡左侧），关闭显示头像时置灰不可点] [注释时间 2026-11-02；2026-11-23 加头像位置] */
      grp('其它',[
        r({t:'显示消息头像',tg:1,tgname:'lkav',on:avOn}),
        '<div class="pg-r lk-avpos'+(avOn?'':' off')+'"><span class="rt"><b>头像位置</b></span>'+seg(['消息上方','气泡左侧'],V.avPos==='side'?1:0).replace('class="pg-seg"','class="pg-seg th-seg lk-avp"')+'</div>'
      ],null,4)+
    '</div>'+
    '<div class="pg-pane">'+grp('输入框',[lkOpts(IB_LIST,V.ib||'def','data-ib'),slider('lkIBr','输入框圆角',V.ibr==null?21:V.ibr,8,24,1,'px'),slider('lkIBh','输入框高度',V.ibh==null?44:V.ibh,44,64,1,'px')],null,0)+'</div>'+
    '<div class="pg-pane">'+grp('聊天背景',['<div class="pg-r col"><div class="th-bgs">'+bgList().map(function(o){ return '<button class="tap'+(o[0]===cur?' on':'')+'" data-bg="'+o[0]+'" style="--bg:'+o[2]+'"><span>'+o[1]+'</span></button>'; }).join('')+'</div></div>',
      slider('lkVeil','背景透明度',100-veil,0,100,1,'pc'),
      '<div class="pg-r lk-bgre" data-bgre hidden><button type="button" class="tap lk-bgbak" data-bgsnap="1">恢复上一套搭配</button></div>'],null,0)+'</div>'; }   /* [2026-11-17 批5 E3] 恢复行：切换内置背景确认后出现，点了整套回到切换前（bgRestore），平时藏着 */
/* [位置:phone-pages.js·bgList] [聊天背景候选] [跟随桌面 / 预设渐变（P.bubble.BG）/ 自己的照片；主题设置子页把网格直接铺出来（原「背景」行弹底板那套作废）] [注释时间 2026-10-31 三轮] */
function bgList(){ var B=(P.bubble&&P.bubble.BG)||{};
  return [['','跟随桌面','linear-gradient(180deg,#eef4fb,#c9d8ea)']].concat(Object.keys(B).map(function(k){ return [k,B[k][0],B[k][1]]; })).concat([['img','自己的照片','repeating-linear-gradient(45deg,#eef2f8 0 8px,#e2e8f2 8px 16px)']]); }
/* [位置:phone-pages.js·lookCommonHTML] [字体与字号（全局，放聊天主题上方）] [2026-10-31 二轮：中文字体 / 英文字体 + 字号是所有主题共用的（--tk-fs 极简正文也跟着走），按用户的意思放在「聊天主题」卡片上方——全局项排在主题选择前面，视觉语义就对了] [注释时间 2026-10-31 二轮] */
function lookCommonHTML(){ return grp('字体与字号',[r({t:'中文字体',v:(P.chatFont?P.chatFont.nameOf('cn'):''),go:'cfcn'}),r({t:'英文字体',v:(P.chatFont?P.chatFont.nameOf('en'):''),go:'cfen'}),r({t:'字号',st:{v:P.lookV.fs,min:12,max:20},cls:'th-fs'})],null,3); }
/* [位置:phone-pages.js·bgPick] [选聊天背景] [主题设置子页网格直接点：内置背景（跟随桌面+预设渐变）点先弹确认——确认前把当前整套 look+bubble 存快照（bgSnap），网格下方出现「恢复上一套搭配」，点了整套回去；切换时气泡颜色跟着背景配套换（palOf）、文字色回自动；BG 表某款显式配了形状档（[2].bs）才连形状一起换（bsOf 返回 null=不碰用户形状）。自己的照片走 裁剪（2026-11-16 批2 E2，sticker-cropper 参数化矩形框）+上传（传不上去存本机）+照片主色取气泡色，有自己的取消余地不弹确认。切换/恢复都在子页草稿态内进行（点「保存」才落盘，与子页既有语义一致）；原 lookGo 弹底板版作废] [注释时间 2026-10-31 三轮；2026-11-16 批2 E2；2026-11-17 批5 E3] */
var bgSnap=null;   /* [位置:phone-pages.js·bgSnap] [切背景前的整套搭配快照] [批5 E3：{look,bubble} 两段深拷贝，恢复入口在聊天背景网格下方；会话内存态，恢复或再次切换后更新] */
function bgPick(host,b){ var v=b.getAttribute('data-bg'); buzz(6);
  function done(){ Array.prototype.forEach.call(b.parentNode.children,function(x){ x.classList.toggle('on',x===b); }); }
  /* [位置:phone-pages.js·bgPick 自动配气泡色] [换内置背景时颜色跟着换] [10-30：已有背景里搭好气泡颜色，换过去自动配；自定义的文字颜色一并回自动（不然白字配浅色气泡看不清）；色板那排通过 lookrepaint 刷新选中态] [注释时间 2026-10-30；2026-11-17 批5 E3] */
  if(v!=='img'){
    var cur=(P.bubble&&P.bubble.get?String(P.bubble.get().bg||''):'');
    if(cur===v){ done(); return; }   /* 点的就是当前背景：只补选中态 */
    var bs=(P.bubble&&P.bubble.bsOf)?P.bubble.bsOf(v):null;
    try{ bgSnap={look:JSON.parse(JSON.stringify(P.lookV)),bubble:JSON.parse(JSON.stringify(P.bubble.get()))}; }catch(e){ bgSnap=null; }
    var pl=P.bubble&&P.bubble.palOf?P.bubble.palOf(v):null;
    bubS(Object.assign({bg:v},pl?{me:pl.me,ai:pl.ai}:{}));
    /* [2026-11-23] 切内置背景时把气泡装饰（线框/图案/透明度/字色）切回配置默认，只保留跟随背景的配套气泡颜色；不弹确认框打断 */
    var lk={meInk:'',aiInk:'',aiLs:'none',meLs:'none',aiLc:'',meLc:'',aiPat:'none',mePat:'none',aiBgType:'solid',meBgType:'solid',aiA:100,meA:100,aiBl:0,meBl:0,aiSh:0,meSh:0};
    if(bs!=null){ lk.aiBs=bs; lk.meBs=bs; }
    P.lookPut(lk);
    if(P.bubble&&P.bubble.lookChanged) P.bubble.lookChanged();
    done(); host.dispatchEvent(new CustomEvent('lookrepaint'));
    var re=$('.lk-bgre',host); if(re) re.hidden=false;
    toast('已切换背景'); buzz([8,30,8]);
    return; }
  var f=document.createElement('input'); f.type='file'; f.accept='image/*';
  f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl) return; if(fl.size>8*1024*1024){ toast('照片太大了（8MB 以内）'); return; }
    var palP=null, rd=new FileReader();
    rd.onerror=function(){ toast('这张读不出来'); };
    rd.onload=function(){ if(!window.openStickerCropper){ toast('裁剪组件没加载上，刷新一下页面'); return; }
      /* [2026-11-16 批2 E2 先裁剪再上传] ：聊天背景上传加裁剪。取景框按手机屏幕比例（竖构图），微信式框不动图动；输出长边 1280 与原 shrink 同规格（shrink 已于批5 删除），所以裁完直接用；取消裁剪=什么都不动 */
      openStickerCropper(rd.result,{title:'裁剪聊天背景',aspect:((P.D&&P.D.clientWidth)?P.D.clientWidth/Math.max(1,P.D.clientHeight):(390/844)),outLong:1280}).then(function(crop){
        if(!crop) return;
        palP=imgPalette(crop); toast('上传中…');
        var up=P.net?P.net.post('/v1/upload-image',{data:crop}).then(function(j){ if(!j||!j.url) throw new Error(''); return j.url; }):Promise.reject();
        return up.catch(function(){ return crop; }); }).then(function(u){ if(u==null) return; try{ P.bubble.setBgImage(u); }catch(er){ toast(er.message||'存不下'); return; } P.lookApply(); done(); buzz([8,30,8]);
        /* [位置:phone-pages.js·bgPick 照片自动取色] [换自己的照片时气泡颜色按照片主色配] [10-30：取色用缩好的 dataURL（不会污染画布），算完设我方/对方气泡色、文字色回自动，取不到就只换背景] [注释时间 2026-10-30；2026-11-16 数据源换成裁剪输出] */
        Promise.resolve(palP).then(function(pl){ if(pl){ bubS({me:pl.me,ai:pl.ai,bgDark:!!pl.dark,bgTintTop:pl.tintTop,bgTintBot:pl.tintBot}); P.lookPut({meInk:'',aiInk:''}); host.dispatchEvent(new CustomEvent('lookrepaint')); } toast(pl?'背景换好了，气泡颜色跟着照片配好了':'背景换好了'); }); },function(){ toast('这张读不出来'); }); };
    rd.readAsDataURL(fl); };
  f.click(); }
/* [位置:phone-pages.js·imgPalette/hsl2hex] [从照片取主色，配一套气泡色] [10-30：缩成 32x32 逐像素算 HSL；色相取「饱和度x不偏灰」加权的圆周平均（灰/黑白照片退回默认蓝 215），整体明度 L 判深浅：我方 = 同色相、饱和 .35~.6、明度 .56 的中等色（白字好读）；对方 = 浅照片配近白淡色(.96)，深照片配深色(.24)，都带一点同色相] [注释时间 2026-10-30] */
function hsl2hex(h,s,l){ var a=s*Math.min(l,1-l); function f(n){ var k=(n+h/30)%12; return l-a*Math.max(-1,Math.min(k-3,9-k,1)); }
  function hx(x){ var t=Math.round(Math.max(0,Math.min(1,x))*255).toString(16); return t.length<2?'0'+t:t; } return '#'+hx(f(0))+hx(f(8))+hx(f(4)); }
function imgPalette(src){ return new Promise(function(ok){ var im=new Image(); im.onerror=function(){ ok(null); };
  im.onload=function(){ try{ var N=32, c=document.createElement('canvas'); c.width=c.height=N; var cx=c.getContext('2d'); cx.drawImage(im,0,0,N,N);
      /* [2026-11-01：背景照片的顶部/底部渐隐层要取照片可见上/下缘的颜色，不是全图平均色。按 center/cover 的裁切比例算可见取景框，再取上/下 15% 的平均 RGB] */
      var iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height;
      var tw=(window.PH&&PH.D)?PH.D.clientWidth:390, th=(window.PH&&PH.D)?PH.D.clientHeight:844;
      var sc=Math.max(tw/iw, th/ih), wf=Math.min(1, tw/(iw*sc)), hf=Math.min(1, th/(ih*sc));
      var x0=(1-wf)/2*N, x1=x0+wf*N, y0=(1-hf)/2*N, y1=y0+hf*N, slot=Math.max(1, Math.round(hf*N*0.15));
      var d=cx.getImageData(0,0,N,N).data, n=N*N, sx=0, sy=0, wsum=0, L=0, S=0, ar=0, ag=0, ab=0, tr=0, tg=0, tb=0, tn=0, br=0, bg2=0, bb=0, bn=0;
      for(var i=0;i<d.length;i+=4){ ar+=d[i]; ag+=d[i+1]; ab+=d[i+2];
        var px=(i>>2)%N, py=((i>>2)/N)|0;
        if(px>=x0&&px<x1&&py>=y0&&py<y1){
          if(py>=y0&&py<y0+slot){ tr+=d[i]; tg+=d[i+1]; tb+=d[i+2]; tn++; }
          if(py>=y1-slot&&py<y1){ br+=d[i]; bg2+=d[i+1]; bb+=d[i+2]; bn++; }
        }
        var r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255, mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2, dl=mx-mn, s=dl?dl/(1-Math.abs(2*l-1)):0, h=0;
        if(dl){ if(mx===r) h=((g-b)/dl+6)%6; else if(mx===g) h=(b-r)/dl+2; else h=(r-g)/dl+4; h*=60; }
        L+=l; S+=s; var w=s*(1-Math.abs(2*l-1)); sx+=Math.cos(h*Math.PI/180)*w; sy+=Math.sin(h*Math.PI/180)*w; wsum+=w; }
      L/=n; S/=n;
      var hue=wsum>n*0.02?((Math.atan2(sy,sx)*180/Math.PI)+360)%360:215, sat=Math.max(.35,Math.min(.6,.28+S*.5));
      var avgR=Math.round(ar/n), avgG=Math.round(ag/n), avgB=Math.round(ab/n);
      var tintTop=tn?(Math.round(tr/tn)+','+Math.round(tg/tn)+','+Math.round(tb/tn)):(avgR+','+avgG+','+avgB);
      var tintBot=bn?(Math.round(br/bn)+','+Math.round(bg2/bn)+','+Math.round(bb/bn)):(avgR+','+avgG+','+avgB);
      ok({me:hsl2hex(hue,sat,.56),ai:L>.5?hsl2hex(hue,.35,.96):hsl2hex(hue,.28,.24),dark:L<=.5,tintTop:tintTop,tintBot:tintBot}); }catch(e){ ok(null); } };
  im.src=src; }); }
/* [位置:phone-pages.js·bgRestore] [恢复上一套搭配] [批5 E3：把 bgPick 确认前存的整套搭配（bgSnap={look,bubble}）原样写回内存并重画；恢复与切换一样在子页草稿态内（P.bubble.set 不落盘，点「保存」才生效），恢复按钮行用完即藏] [注释时间 2026-11-17] */
function bgRestore(win){
  if(!bgSnap){ var e0=$('.lk-bgre',win); if(e0) e0.hidden=true; return; }   /* 没快照却按到（理论上按钮藏着的）：顺手把行收好 */
  var s=bgSnap; bgSnap=null;
  Object.keys(P.lookV).forEach(function(k){ if(!(k in s.look)) delete P.lookV[k]; });
  Object.assign(P.lookV,s.look);
  P.bubble.set(s.bubble);
  P.lookApply();
  if(P.bubble&&P.bubble.lookChanged) P.bubble.lookChanged();
  if(P.bubble&&P.bubble.refresh) P.bubble.refresh();
  var re=$('.lk-bgre',win); if(re) re.hidden=true;
  win.dispatchEvent(new CustomEvent('lookrepaint'));
  toast('已恢复上一套搭配 · 点「保存」生效'); buzz(8);
}
   /* [2026-11-17 批5 清理] shrink() 整函数删除：原聊天背景上传的压缩步骤，批2 E2 起被 sticker-cropper 裁剪器取代（裁剪输出已 ≤1280，全仓调用面复核零引用、git log -S 无误删史），原文见 工作流/备份/批5_20261117/phone-pages.js */
/* [位置:phone-pages.js·rgbStr2hex] ['r,g,b' 串转 #rrggbb] [预设背景（P.bubble.BG 第 4 项）的上下缘色是 '253,228,236' 这种串，自动配色的色相要从它起算] [注释时间 2026-11-16] */
function rgbStr2hex(s){ var a=String(s||'').split(','); if(a.length<3) return '';
  function h(x){ x=Math.max(0,Math.min(255,Math.round(+x||0))).toString(16); return x.length<2?'0'+x:x; } return '#'+h(a[0])+h(a[1])+h(a[2]); }
/* [位置:phone-pages.js·bgAutoPair] [气泡颜色「自动」：按当前聊天背景吸色+随机抖动生成一套] [11-16 批2 E5：色板行的「自动」按钮。自己的照片=复用 imgPalette 的整图加权主色与深浅判定（读不出退 bgTintTop 均色+bgDark）；预设渐变=BG 表上/下缘色、深浅看 [2].dark（暮色）；跟随桌面=默认蓝 215。生成口径照 imgPalette：我方=同色相 s .32~.62 l .5~.64 的中等色（白字可读），浅底对方=近白淡色 l .93~.97、深底对方=深色 l .2~.3；「比较随机」=每次色相 ±14°（对方 ±10°）再各分量小抖，点一次一套、再点再换。只动气泡色不动文字色（文字色自动反白在 phone-bubble·applyVars/lookApply）] [注释时间 2026-11-16] */
function bgAutoPair(win){
  var st=P.bubble?P.bubble.get():null; if(!st||!win) return;
  function apply(hue,light){ hue=((hue%360)+360)%360;
    var me=hsl2hex(hue+(Math.random()*28-14),Math.max(.32,Math.min(.62,.3+Math.random()*.3)),.5+Math.random()*.14);
    var ai=light?hsl2hex(hue+(Math.random()*20-10),.18+Math.random()*.16,.93+Math.random()*.04):hsl2hex(hue+(Math.random()*20-10),.22+Math.random()*.1,.2+Math.random()*.1);
    bubS({me:me,ai:ai}); win.dispatchEvent(new CustomEvent('lookrepaint')); toast('气泡颜色按背景自动配好了'); }
  if(st.bg==='img'){ var u=P.bubble.bgImage(); if(!u){ apply(215,true); return; }
    imgPalette(u).then(function(p){ if(p) apply(hex2hsv(p.me).h,!p.dark); else apply(hex2hsv(rgbStr2hex(st.bgTintTop)||'#7298d6').h,String(st.bgDark)!=='true'); }); return; }
  if(st.bg){ var B=P.bubble.BG, ent=B&&B[st.bg], hex=rgbStr2hex(ent&&ent[3]&&ent[3].top)||rgbStr2hex(ent&&ent[3]&&ent[3].bot)||'#7298d6', dark=!!(ent&&ent[2]&&ent[2].dark);
    apply(hex2hsv(hex).h,!dark); return; }
  apply(215,true); }
/* ---------- 自建调色面板（10-30）：iOS 原生取色器点一下就关、没法细调；点任何颜色（色板 / 最近用 / ＋ / 文字色轮）都弹这个面板：深浅方块 + 色相条 + 十六进制，拖到满意点「好了」才真正应用 ---------- */
/* [位置:phone-pages.js·hex2hsv/hsv2hex] [颜色进制换算] [面板内部用 HSV（色相/饱和/明度）好拖，落盘统一 #rrggbb] [注释时间 2026-10-30] */
function hex2hsv(hex){ var m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return {h:215,s:.43,v:.84};
  var n=parseInt(m[1],16), r=(n>>16&255)/255, g=(n>>8&255)/255, b=(n&255)/255, mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn, h=0;
  if(d){ if(mx===r) h=((g-b)/d+6)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; }
  return {h:h,s:mx?d/mx:0,v:mx}; }
function hsv2hex(h,s,v){ var c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c, r=0,g=0,b=0;
  if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
  function to(q){ var t=Math.round((q+m)*255).toString(16); return t.length<2?'0'+t:t; }
  return '#'+to(r)+to(g)+to(b); }
/* [位置:phone-pages.js·colorSheet] [自建调色面板] [拖 SV 方块 / 色相条实时预览、hex 可直接输；点「好了」才 ok(hex)，点黑处取消不动现有颜色] [注释时间 2026-10-30] */
function colorSheet(win,title,init,ok){
  var hsv=hex2hsv(init);
  /* [位置:phone-pages.js·colorSheet 宿主窗口] [聊天外观是 pg-sub 子页，lookSetup 收到的 win 是子页本身，没有 .content；sheet() 要整个应用窗口，往上找 .win] [10-30 真机：点任何色板/文字色轮都没反应——sheet 里 win.querySelector('.content') 为 null，appendChild 抛错，面板一直没弹出来（上一版 10-30 自建调色面板引入）] [注释时间 2026-10-30] */
  win=(win.closest&&win.closest('.win'))||win;
  sheet(win,title,'<div class="cp-sv"><i class="cp-dot"></i></div><div class="cp-hue"><i class="cp-dot"></i></div>'+
    '<div class="cp-line"><input class="cp-hex" maxlength="7" spellcheck="false" aria-label="十六进制颜色"><span class="cp-pv">预览</span></div>'+
    '<div class="pg-bts"><button class="pg-btn pri tap cp-ok" type="button">好了</button></div>',function(s,close){
    var sv=$('.cp-sv',s), hue=$('.cp-hue',s), hex=$('.cp-hex',s), pv=$('.cp-pv',s);
    function dot(el,x,y){ var d=el.querySelector('.cp-dot'); d.style.left=(x*100)+'%'; d.style.top=(y*100)+'%'; }
    function paint(){ var c=hsv2hex(hsv.h,hsv.s,hsv.v); sv.style.setProperty('--h',hsv.h+'deg');
      dot(sv,hsv.s,1-hsv.v); dot(hue,hsv.h/360,.5); hex.value=c; pv.style.background=c;
      pv.style.color=(0.299*parseInt(c.slice(1,3),16)+0.587*parseInt(c.slice(3,5),16)+0.114*parseInt(c.slice(5,7),16))/255>0.72?'#3d4660':'#fff'; }
    function drag(el,fn){ var on=false;
      el.addEventListener('pointerdown',function(e){ on=true; try{ el.setPointerCapture(e.pointerId); }catch(er){} fn(e); e.preventDefault(); });
      el.addEventListener('pointermove',function(e){ if(on) fn(e); });
      el.addEventListener('pointerup',function(){ on=false; }); el.addEventListener('pointercancel',function(){ on=false; }); }
    drag(sv,function(e){ var r=sv.getBoundingClientRect(); hsv.s=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)); hsv.v=Math.max(0,Math.min(1,1-(e.clientY-r.top)/r.height)); paint(); });
    drag(hue,function(e){ var r=hue.getBoundingClientRect(); hsv.h=Math.max(0,Math.min(359.9,(e.clientX-r.left)/r.width*360)); paint(); });
    hex.addEventListener('change',function(){ if(/^#?([0-9a-f]{6})$/i.test(hex.value)){ hsv=hex2hsv(hex.value); paint(); } else paint(); });
    $('.cp-ok',s).addEventListener('click',function(){ buzz(8); close(); ok(hsv2hex(hsv.h,hsv.s,hsv.v)); });
    paint();
  }); }
function lookSetup(win){
  var pv=$('#thPv',win);
  var RK='ph.bubble.recent';
  /* [位置:phone-pages.js·lookSetup·mirrorAll/mirrorKey] [两边同步] [2026-11-03：开着时，一边的 透明度/模糊/阴影/圆角/线框(样式·粗细·颜色)/图案(样式·密度·颜色) 改了，另一边同步成一样；气泡颜色与文字颜色不同步（我方蓝/对方白本来就该不同）。滑杆拖动走 mirrorKey（只拷那一项，不每帧重画别的）；点选类走 mirrorAll（整套拷一遍并重画）；MIR 标志防止程序回写滑杆触发 input 又镜像回来] [注释时间 2026-11-03] */
  /* [2026-11-06] 同步范围加上形状档（Bs）与背景类型（BgType）：开着同步时整套外形+背景一起拷到另一边；颜色和文字色照旧各管各 */
  var SYNCK=['Bs','A','Bl','Sh','HsqR','Pad','Gap','MaxW','Ls','Lw','Ld','Lc','Lo','Pat','PatS','PatC','PatG','PatO','BgType'], MIR=0;   /* [2026-11-16 批2 E7] 同步范围加 Lo（线框透明度）；[2026-11-17] 加 HsqR（两方两圆方角）；[2026-11-23] 加 MaxW（气泡最大宽度） */
  function otherOf(s0){ return s0==='ai'?'me':'ai'; }
  function setSlider(id,v){ var x=win.querySelector('#'+id); if(!x||v==null) return; MIR=1; try{ x.value=v; x.dispatchEvent(new Event('input',{bubbles:true})); }finally{ MIR=0; } }
  function sliderIds(o){ var up=o==='ai'?'Ai':'Me'; return {A:'lk'+o+'A',Bl:'lk'+o+'Bl',Sh:'lk'+o+'Sh',R:'lk'+o+'R',HsqR:'lk'+o+'HsqR',Lw:'lk'+up+'Lw',Ld:'lk'+up+'Ld',Lo:'lk'+up+'Lo',PatS:'lk'+up+'PatS',PatO:'lk'+up+'PatOX',Pad:'lk'+up+'Pad',Gap:'lk'+up+'Gap',MaxW:'lk'+up+'MaxW'}; }
  function twinBl(p){ var v=P.lookV[p+'Bl'], x=win.querySelector('#lk'+p+'BlP'), y=win.querySelector('#lk'+p+'Bl'); [x,y].forEach(function(e){ if(!e) return; e.value=v; var em=e.closest('.pg-sl'); em=em&&em.querySelector('em'); if(em) em.textContent=v+'px'; }); }   /* 图案/实色两处模糊滑杆互相对齐 */
  function mirrorKey(s0,k){ if(!P.lookV.sync) return; var o=otherOf(s0); P.lookV[o+k]=P.lookV[s0+k]; setSlider(sliderIds(o)[k],P.lookV[o+k]); if(k==='Bl') twinBl(o); }
  /* [位置:phone-pages.js·lookSetup·mirrorKeys] [两边同步·按改动镜像] [2026-11-16 拍板新语义（批2 E8）：开关只管「开着期间发生的改动」——调用方传这次改动涉及的键组，只把这些键拷到另一边并回位对应滑杆；关掉之后再改不镜像，两边各自保留。旧 mirrorAll「任一改动就整套 SYNCK 快照镜像」废弃，只保留给「恢复默认」（整边重置本来就是一个事件）用；打开开关也不再整套拷贝（见 lksync 分支）。拷完按键组补重画：线框组→lookFrameChanged，图案/背景类型→lookPatChanged，形状档→lookChanged，最后 paint 刷新选中态与显隐] [注释时间 2026-11-16 批2 E8；前身 mirrorAll 2026-11-03] */
  var FRKEYS={Ls:1,Lw:1,Ld:1,Lc:1,Lo:1}, PTKEYS={Pat:1,PatS:1,PatC:1,PatG:1,PatO:1,BgType:1};
  function mirrorKeys(s0,ks){ if(!P.lookV.sync) return; var o=otherOf(s0), ids=sliderIds(o), SB={Lw:2,Ld:50,Lo:100,HsqR:11,PatS:16,PatO:100,Pad:8,Gap:4,MaxW:o==='ai'?90:80}, fr=0, pt=0, bs=0, i, k;
    for(i=0;i<ks.length;i++){ k=ks[i]; P.lookV[o+k]=P.lookV[s0+k];
      if(ids[k]) setSlider(ids[k],P.lookV[o+k]==null?SB[k]:P.lookV[o+k]);
      if(k==='Bl') twinBl(o);
      if(FRKEYS[k]) fr=1; if(PTKEYS[k]) pt=1; if(k==='Bs') bs=1; }
    P.lookPut({});
    paint(); if(P.bubble){ if(fr&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); if(pt&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); if(bs&&P.bubble.lookChanged) P.bubble.lookChanged(); } }
  /* 整边重置专用（恢复默认）：整套 SYNCK 拷过去，外加圆角（圆角存 bubble 段不在 lookV，单独走 bubS） */
  function mirrorAll(s0){ if(!P.lookV.sync) return; mirrorKeys(s0,SYNCK); var o=otherOf(s0), g=bubG(); if(g[s0+'R']!=null){ var rr={}; rr[o+'R']=g[s0+'R']; bubS(rr); setSlider(sliderIds(o).R,g[s0+'R']); } }
  /* [位置:phone-pages.js·lookSetup·genOf/putGen/randPal] [成品底图参数读写] [genOf=当前参数（坏串/空串兜底成格纹默认）；putGen=改一项后重拼参数串、落盘、重画图案层、顺带两边同步；randPal=随机配色（同色系错开色相，底色取很淡的同色相）] [注释时间 2026-11-05] */
  function genOf(p){ var g=P.bubble&&P.bubble.genParse?P.bubble.genParse(P.lookV[p+'PatG']):null; return g||P.bubble.genParse(P.bubble.genDef('ging')[3]); }
  function putGen(p,patch){ var g=genOf(p); Object.assign(g,patch); var o={}; o[p+'PatG']=P.bubble.genStr(g); o[p+'Pat']='gen'; P.lookPut(o); paint(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); mirrorKeys(p,['Pat','PatG','PatS']); }   /* [2026-11-16 批2 E8] 事件语义：只同步图案相关键 */
  function hsl2hex(h,s,l){ h=((h%360)+360)%360; s/=100; l/=100;
    var c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2, r=0,g2=0,b=0;
    if(h<60){ r=c; g2=x; } else if(h<120){ r=x; g2=c; } else if(h<180){ g2=c; b=x; } else if(h<240){ g2=x; b=c; } else if(h<300){ r=x; b=c; } else { r=c; b=x; }
    function q(v){ var n=Math.round((v+m)*255); n=Math.max(0,Math.min(255,n)); return ('0'+n.toString(16)).slice(-2); }
    return '#'+q(r)+q(g2)+q(b); }
  function randPal(g){ var h=Math.round(Math.random()*360), n=Math.max(1,(g.cols||[]).length), cols=[], sat=36+Math.round(Math.random()*24), li=52+Math.round(Math.random()*12), i;
    for(i=0;i<n;i++) cols.push(hsl2hex(h+i*26,sat,li+i*7));
    return {cols:cols,bg:hsl2hex(h,32,96)}; }
  /* [位置:phone-pages.js·lookSetup·pvShow/pvSide] [按页签切预览、按边切预览] [三段预览都在顶部槽里按 .lk-pvw.on 显隐；切换后要重画一次——隐藏时元素量到 0 尺寸、三个绘制函数都会提前 return，回到可见状态必须显式重画，否则气泡是空的] [注释时间 2026-11-06] */
  function pvShow(k){ Array.prototype.forEach.call(win.querySelectorAll('.lk-pvw'),function(x,i){ x.classList.toggle('on',i===k); });
    var sb=win.querySelector('.lk-sidebar'), sy=win.querySelector('.lk-syncbar');
    if(sb) sb.hidden=(k!==0); if(sy) sy.hidden=(k!==0);
    requestAnimationFrame(function(){ if(P.bubble&&P.bubble.pvShape) P.bubble.pvShape(win); }); }
  function pvSide(k){ var box=win.querySelector('.lk-pvbub'); if(!box) return; box.classList.toggle('sd-me',k===1);
    requestAnimationFrame(function(){ if(P.bubble&&P.bubble.pvShape) P.bubble.pvShape(win); }); }
  function recent(){ try{ return JSON.parse(localStorage.getItem(RK)||'[]'); }catch(e){ return []; } }
  /* [位置:phone-pages.js·lookSetup·hsqIcons] [两方两圆示意图标同形] [11-17 方角可调：lk-sh-h 图标按该边 aiHsqR/meHsqR×0.6 写 inline 圆角（30×18 图标圆角 9 基准、真气泡 15，同比缩放），paint 与拖「方角」滑杆都调] [注释时间 2026-11-17] */
  function hsqIcons(){ var b;
    var rAi=((P.lookV.aiHsqR==null?11:P.lookV.aiHsqR)*0.6)+'px', rMe=((P.lookV.meHsqR==null?11:P.lookV.meHsqR)*0.6)+'px';
    b=win.querySelector('.lk-opts button[data-bsai] i.lk-sh-h'); if(b) b.style.borderRadius=rAi+' 9px 9px '+rAi;
    b=win.querySelector('.lk-opts button[data-bsme] i.lk-sh-h'); if(b) b.style.borderRadius=rMe+' 9px 9px '+rMe; }
  function paint(){ var g=bubG();
    /* [2026-11-06 背景二选一] 实色行 / 图案区按背景类型显隐；两张小卡回选中态 */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-solidrows'),function(row){ row.hidden=bgType(P.lookV,row.getAttribute('data-sol'))!=='solid'; });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-patbox'),function(row){ row.hidden=bgType(P.lookV,row.getAttribute('data-patw'))!=='pat'; });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-bgt'),function(row){ var bp=row.getAttribute('data-bgt'), bt=bgType(P.lookV,bp);
      Array.prototype.forEach.call(row.querySelectorAll('button[data-bgtv]'),function(x){ x.classList.toggle('on',x.getAttribute('data-bgtv')===bt); }); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-c'),function(row){ var side=row.dataset.side, base=side==='me'?BUB:AIC, cur=g[side], rc=recent().filter(function(c){ return base.indexOf(c)<0; }).slice(0,2);   /* [10-31 四轮：最近用最多 2 个，色板一整行放得下] */
      row.querySelector('.th-sw').innerHTML=base.map(function(c){ return '<button class="'+(c===cur?'on':'')+'" style="--c:'+c+'" data-c="'+c+'" aria-label="'+c+'"></button>'; }).join('')+(rc.length?'<i class="sep"></i>':'')+rc.map(function(c){ return '<button class="rc'+(c===cur?' on':'')+'" style="--c:'+c+'" data-c="'+c+'" aria-label="'+c+'"></button>'; }).join('')+'<button class="aut tap" type="button" aria-label="按当前背景自动配色">自动</button><button class="cus tap" type="button" aria-label="自己调颜色">＋</button>'; });   /* [2026-11-16 批2 E5] 加「自动」：按当前聊天背景吸色生成一套（bgAutoPair），点一次一套、再点再换 */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-i:not(.lf):not(.pf)'),function(row){ var k=row.dataset.side+'Ink', v=P.lookV[k]; row.querySelector('.lk-auto').classList.toggle('on',!v); var pk=row.querySelector('.lk-pick'); pk.classList.toggle('on',!!v); pk.style.setProperty('--c',v||'transparent'); });
    /* [位置:phone-pages.js·paint 线框回画] [样式四选选中态 / 粗细+颜色行显隐（「无」时藏）/ 颜色行 auto-pick 态；预览气泡线框随 pvShape→redraw 一起画] [注释时间 2026-11-02] */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-lsai]'),function(x){ x.classList.toggle('on',x.getAttribute('data-lsai')===(P.lookV.aiLs||'none')); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-lsme]'),function(x){ x.classList.toggle('on',x.getAttribute('data-lsme')===(P.lookV.meLs||'none')); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-lfrows'),function(row){ row.hidden=(P.lookV[row.getAttribute('data-lfs')+'Ls']||'none')==='none'; });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-hsqrow'),function(row){ row.hidden=(P.lookV[row.getAttribute('data-hsq')+'Bs']||'def')!=='hsq'; });   /* [2026-11-17] 「方角」滑杆只在两方两圆时显示（选两方两圆的时候才有） */
    hsqIcons();
    Array.prototype.forEach.call(win.querySelectorAll('.lk-ldw'),function(row){ row.hidden=!/^(dash|wave)$/.test(P.lookV[row.getAttribute('data-ldw')+'Ls']||''); });   /* 疏密只对虚线/波浪有意义 */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-i.lf'),function(row){ var k=row.dataset.side+'Lc', v=P.lookV[k]; row.querySelector('.lk-auto').classList.toggle('on',!v); var pk=row.querySelector('.lk-pick'); pk.classList.toggle('on',!!v); pk.style.setProperty('--c',v||'transparent'); });
    /* [位置:phone-pages.js·paint 图案回画] [11 选选中态 / 密度+颜色行显隐（「无」时藏）/ 图案颜色行跟随-自定态] [注释时间 2026-11-02] */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-patai]'),function(x){ x.classList.toggle('on',x.getAttribute('data-patai')===(P.lookV.aiPat||'none')); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-patme]'),function(x){ x.classList.toggle('on',x.getAttribute('data-patme')===(P.lookV.mePat||'none')); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-pfrows'),function(row){ row.hidden=(P.lookV[row.getAttribute('data-pfs')+'Pat']||'none')==='none'; });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-i.pf'),function(row){ var k=row.dataset.side+'PatC', v=P.lookV[k]; row.querySelector('.lk-auto').classList.toggle('on',!v); var pk=row.querySelector('.lk-pick'); pk.classList.toggle('on',!!v); pk.style.setProperty('--c',v||'transparent'); });
    /* [位置:phone-pages.js·paint 成品底图] [网格选中态 / 角度档选中 / 面板按款式重建 / 透明度·角度滑杆回填 / 色板重画] [面板 body 是子页建好时一次性拼的静态 HTML，换款式后必须重建（否则还显示上一档的控件）；重建只在结构变化时做（款式/图标还是色带/颜色个数/有没有底色），拖透明度角度不重建，免得滑杆被抽掉] [注释时间 2026-11-05] */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-pats'),function(grid){ var p=grid.getAttribute('data-patg'), cur=P.lookV[p+'Pat']||'none';
      var g=(cur==='gen')?P.bubble.genParse(P.lookV[p+'PatG']):null, st=g?g.style:'';
      Array.prototype.forEach.call(grid.children,function(b){ var id=b.getAttribute('data-pg');
        b.classList.toggle('on', id==='none' ? cur==='none' : (cur==='gen'&&st===id)); }); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-pang'),function(row){ var p=row.getAttribute('data-pang');
      var g=(P.lookV[p+'Pat']==='gen')?P.bubble.genParse(P.lookV[p+'PatG']):null;
      Array.prototype.forEach.call(row.children,function(b){ b.classList.toggle('on', !!g && +b.getAttribute('data-pa')===g.ang); }); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-pfrows'),function(row){
      if(row.hidden) return;
      var p=row.getAttribute('data-pfs'), cur=P.lookV[p+'Pat'], g=(cur==='gen')?P.bubble.genParse(P.lookV[p+'PatG']):null;
      var sig=cur+'|'+(g?(g.style+'|'+((P.bubble.IC_RE&&P.bubble.IC_RE.test(g.style))?'i':'b')+'|'+g.cols.length+'|'+(g.bg?'y':'n')):'');
      if(row.getAttribute('data-sig')!==sig){ row.setAttribute('data-sig',sig); row.innerHTML=patBodyHTML(p); } });
    ['ai','me'].forEach(function(p){ var up=p==='ai'?'Ai':'Me', g=(P.lookV[p+'Pat']==='gen')?P.bubble.genParse(P.lookV[p+'PatG']):null, x;
      if((x=win.querySelector('#lk'+up+'PatOX'))) x.value=(P.lookV[p+'PatO']==null?100:P.lookV[p+'PatO']);   /* [2026-11-05] 旧 10 图案的浓度滑杆回填 */
      if(!g) return;
      if((x=win.querySelector('#lk'+up+'PatO'))) x.value=g.op;
      if((x=win.querySelector('#lk'+up+'PatA'))) x.value=g.ang;
      var box=win.querySelector('.lk-gcol[data-gc="'+p+'"]'); if(box) box.innerHTML=gcolHTML(g); });
    /* [位置:phone-pages.js·paint 选卡] [气泡样式 / 输入框选择卡选中态 + 预览气泡按当前档重画（小尾巴·SVG 的形状画在预览里）] [注释时间 2026-11-02] */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-bsai]'),function(x){ x.classList.toggle('on',x.getAttribute('data-bsai')===(P.lookV.aiBs||'def')); });   /* [2026-11-06] 形状档分边 */
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-bsme]'),function(x){ x.classList.toggle('on',x.getAttribute('data-bsme')===(P.lookV.meBs||'def')); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-opts button[data-ib]'),function(x){ x.classList.toggle('on',x.getAttribute('data-ib')===(P.lookV.ib||'def')); });
    var avOn2=P.lookV.av==null?true:!!P.lookV.av, avSide2=P.lookV.avPos==='side';
    Array.prototype.forEach.call(win.querySelectorAll('[data-tg="lkav"]'),function(x){ x.classList.toggle('on',avOn2); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-avpos'),function(row){ row.classList.toggle('off',!avOn2); });
    Array.prototype.forEach.call(win.querySelectorAll('.lk-avp'),function(sg){ sg.style.setProperty('--k',avSide2?1:0); Array.prototype.forEach.call(sg.querySelectorAll('button'),function(x,i){ x.classList.toggle('on',i===(avSide2?1:0)); }); });
    Array.prototype.forEach.call(win.querySelectorAll('[data-tg="lksync"]'),function(x){ x.classList.toggle('on',!!P.lookV.sync); });   /* [2026-11-03 两边同步开关态] */
    if(P.bubble&&P.bubble.pvShape) P.bubble.pvShape(win); }
  paint();
  win.addEventListener('lookrepaint',paint);   /* 选背景自动配色/换背景后刷新色板与选择卡选中态（phone-pages.js·bgPick/bgRestore 触发） */
  /* [位置:phone-pages.js·lookSetup 恢复行回显] [会话内快照还在就亮出恢复入口] [批5 E3：恢复行平时藏着，但 bgSnap 是内存态、子页关了重开它还在——挂载时按快照有无同步显隐，不然「恢复上一套搭配」没入口] [注释时间 2026-11-17] */
  if(bgSnap){ var bgre=$('.lk-bgre',win); if(bgre) bgre.hidden=false; }
  function remember(c){ var rc=recent().filter(function(x){ return x!==c; }); rc.unshift(c); try{ localStorage.setItem(RK,JSON.stringify(rc.slice(0,3))); }catch(er){} }
  win.addEventListener('click',function(e){ var b;
    /* [2026-11-06] 页签 / 切边：只换预览，面板切换由 wire 处理 */
    if((b=e.target.closest('.lk-tabs button[data-seg]'))){ pvShow(+b.dataset.seg); return; }
    if((b=e.target.closest('.lk-side button[data-seg]'))){ pvSide(+b.dataset.seg); return; }
    /* [位置:phone-pages.js·lookSetup 点色板] [点任何颜色都弹自建调色面板] [以点的颜色为起点，拖到满意点「好了」才应用并记入最近用；＋ 和文字色轮走同一个面板] [注释时间 2026-10-30] */
    if((b=e.target.closest('.lk-c .aut'))){ bgAutoPair(win); buzz(6); return; }   /* [2026-11-16 批2 E5] 气泡颜色「自动」：按背景吸色生成 me/ai 一套（颜色不参与两边同步，与色板手选同口径） */
    if((b=e.target.closest('.lk-c button[data-c],.lk-c .cus'))){ var side=b.closest('.lk-c').dataset.side;
      colorSheet(win,side==='me'?'我的气泡颜色':'AI 的气泡颜色',b.dataset.c||bubG()[side],function(hex){ var o={}; o[side]=hex; bubS(o); remember(hex); paint(); }); buzz(6); return; }
    /* [位置:phone-pages.js·lookSetup 线框颜色] [.lf 行的 pick/auto——必须在文字色分支前面：closest('.lk-pick') 对线框行也会命中，不先截就走错分支] [注释时间 2026-11-02] */
    /* [位置:phone-pages.js·lookSetup 图案颜色] [.pf 行的 pick/auto——放 .lf 前拦（两分支 closest 同元素，先注册先命中）] [注释时间 2026-11-02] */
    if((b=e.target.closest('.lk-i.pf .lk-pick'))){ var s5=b.closest('.lk-i').dataset.side, k5=s5+'PatC';
      colorSheet(win,s5==='me'?'我的图案颜色':'AI 的图案颜色',P.lookV[k5]||(s5==='me'?'#7298d6':'#5b6b8c'),function(hex){ var o7={}; o7[k5]=hex; P.lookPut(o7); paint(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); mirrorKeys(s5,['PatC']); }); buzz(6); return; }
    if((b=e.target.closest('.lk-i.pf .lk-auto'))){ var s7b=b.closest('.lk-i').dataset.side, o7b={}; o7b[s7b+'PatC']=''; P.lookPut(o7b); paint(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); mirrorKeys(s7b,['PatC']); buzz(6); return; }
    if((b=e.target.closest('.lk-i.lf .lk-pick'))){ var s4=b.closest('.lk-i').dataset.side, k4c=s4+'Lc';
      colorSheet(win,s4==='me'?'我的线框颜色':'AI 的线框颜色',P.lookV[k4c]||(s4==='me'?'#7298d6':'#5b6b8c'),function(hex){ var o4={}; o4[k4c]=hex; P.lookPut(o4); paint(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); mirrorKeys(s4,['Lc']); }); buzz(6); return; }
    if((b=e.target.closest('.lk-i.lf .lk-auto'))){ var s4b=b.closest('.lk-i').dataset.side, o4b={}; o4b[s4b+'Lc']=''; P.lookPut(o4b); paint(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); mirrorKeys(s4b,['Lc']); buzz(6); return; }
    if((b=e.target.closest('.lk-pick'))){ var side2=b.closest('.lk-i').dataset.side, k2=side2+'Ink';
      colorSheet(win,side2==='me'?'我的文字颜色':'AI 的文字颜色',P.lookV[k2]||(side2==='me'?'#ffffff':'#3d4660'),function(hex){ var o2={}; o2[k2]=hex; P.lookPut(o2); paint(); }); buzz(6); return; }
    if((b=e.target.closest('.lk-auto'))){ var o2={}; o2[b.closest('.lk-i').dataset.side+'Ink']=''; P.lookPut(o2); paint(); buzz(6); return; }
    if((b=e.target.closest('[data-bgsnap]'))){ bgRestore(win); return; }   /* [2026-11-17 批5 E3] 恢复上一套搭配（bgSnap） */
    if((b=e.target.closest('.lk-opts button[data-bsai]'))){ P.lookPut({aiBs:b.getAttribute('data-bsai')}); paint(); if(P.bubble&&P.bubble.lookChanged) P.bubble.lookChanged(); mirrorKeys('ai',['Bs']); buzz(6); return; }   /* [2026-11-02 形状档；2026-11-06 分边；2026-11-16 批2 E8 只同步 Bs] */
    if((b=e.target.closest('.lk-opts button[data-bsme]'))){ P.lookPut({meBs:b.getAttribute('data-bsme')}); paint(); if(P.bubble&&P.bubble.lookChanged) P.bubble.lookChanged(); mirrorKeys('me',['Bs']); buzz(6); return; }
    /* [2026-11-06 背景二选一] 切到图案时顺手载入一款默认底图（不然点了是空的）；切完要重算文字色（图案底色可能跟气泡色深浅相反）并整量重画 */
    if((b=e.target.closest('.lk-bgt button[data-bgtv]'))){ var pb=b.getAttribute('data-bgtp'), val=b.getAttribute('data-bgtv'), ob={};
      ob[pb+'BgType']=val;
      if(val==='pat'&&(P.lookV[pb+'Pat']||'none')==='none'){ var dfa=P.bubble.genDef('ging'); ob[pb+'Pat']='gen'; ob[pb+'PatG']=dfa[3]; ob[pb+'PatS']=dfa[4]; }
      P.lookPut(ob); paint();
      if(P.bubble){ if(P.bubble.refresh) P.bubble.refresh(); if(P.bubble.lookChanged) P.bubble.lookChanged(); }
      mirrorKeys(pb,['BgType','Pat','PatG','PatS']); buzz(6); return; }   /* [2026-11-16 批2 E8] 事件语义：只同步这次真正改到的键 */
    if((b=e.target.closest('.lk-opts button[data-ib]'))){ P.lookPut({ib:b.getAttribute('data-ib')}); paint(); buzz(6); return; }   /* [2026-11-02 输入框档：纯 CSS 变量切换，落盘即可] */
    if((b=e.target.closest('.lk-opts button[data-lsai]'))){ P.lookPut({aiLs:b.getAttribute('data-lsai')}); paint(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); mirrorKeys('ai',['Ls']); buzz(6); return; }   /* [2026-11-02 线框样式：落盘+选中态+行显隐（paint）+聊天页/预览线框层重画；2026-11-16 批2 E8 只同步 Ls] */
    if((b=e.target.closest('.lk-opts button[data-lsme]'))){ P.lookPut({meLs:b.getAttribute('data-lsme')}); paint(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); mirrorKeys('me',['Ls']); buzz(6); return; }
    if((b=e.target.closest('.lk-opts button[data-patai]'))){ P.lookPut({aiPat:b.getAttribute('data-patai')}); paint(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); mirrorKeys('ai',['Pat']); buzz(6); return; }   /* [2026-11-02 图案样式：落盘+选中态+行显隐（paint）+图案层重画；2026-11-16 批2 E8 只同步 Pat] */
    if((b=e.target.closest('.lk-opts button[data-patme]'))){ P.lookPut({mePat:b.getAttribute('data-patme')}); paint(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); mirrorKeys('me',['Pat']); buzz(6); return; }
    /* [位置:phone-pages.js·lookSetup 成品底图交互] [点成品=载入默认参数（可继续微调）/ 点角度档 / 改某个颜色 / 加颜色 / 随机配色 / 底色回「跟气泡色」] [注释时间 2026-11-05] */
    if((b=e.target.closest('.lk-pats button[data-pg]'))){ var pga=b.closest('.lk-pats').dataset.patg, pid=b.getAttribute('data-pg'), oa={};
      if(pid==='none'){ oa[pga+'Pat']='none'; if(bgType(P.lookV,pga)==='pat') oa[pga+'BgType']='solid'; P.lookPut(oa); }   /* [2026-11-06] 选「无」= 这个边不要图案了，顺手切回实色，不留一个空壳的图案背景 */
      else { var dfa=P.bubble.genDef(pid); oa[pga+'Pat']='gen'; oa[pga+'PatG']=dfa[3]; oa[pga+'PatS']=dfa[4]; P.lookPut(oa); }
      paint(); if(P.bubble){ if(P.bubble.refresh) P.bubble.refresh(); if(P.bubble.lookPatChanged) P.bubble.lookPatChanged(); } mirrorKeys(pga,['Pat','PatG','PatS']); buzz(6); return; }
    if((b=e.target.closest('.lk-pcats button[data-pc]'))){ var pcw=b.closest('.lk-pcats'), catv=b.getAttribute('data-pc');
      Array.prototype.forEach.call(pcw.children,function(x){ x.classList.toggle('on',x===b); });
      Array.prototype.forEach.call(pcw.parentNode.nextElementSibling.querySelectorAll('.lk-pats button[data-pg]'),function(x){ x.hidden=!!catv&&x.getAttribute('data-cat')!==catv; });
      buzz(4); return; }
    if((b=e.target.closest('.lk-pang button[data-pa]'))){ putGen(b.closest('.lk-pang').dataset.pang,{ang:+b.getAttribute('data-pa')}); buzz(6); return; }
    if((b=e.target.closest('.lk-gcol .gc'))){ var pgb=b.closest('.lk-gcol').dataset.gc, gib=+b.getAttribute('data-gci'), ggb=genOf(pgb);
      colorSheet(win,'图案颜色',ggb.cols[gib]||'#f06292',function(hex){ var nb=ggb.cols.slice(); nb[gib]=hex; putGen(pgb,{cols:nb}); }); buzz(6); return; }
    if((b=e.target.closest('.lk-gcol .gc-bg'))){ var pgc=b.closest('.lk-gcol').dataset.gc, ggc=genOf(pgc);
      colorSheet(win,'图案底色',ggc.bg||'#ffffff',function(hex){ putGen(pgc,{bg:hex}); }); buzz(6); return; }
    if((b=e.target.closest('.lk-gcol .gc-add'))){ var pgd=b.closest('.lk-gcol').dataset.gc, ggd=genOf(pgd);
      colorSheet(win,'再加一个颜色',(ggd.cols||[])[ggd.cols.length-1]||'#f06292',function(hex){ var nd=ggd.cols.slice(); nd.push(hex); putGen(pgd,{cols:nd,ws:(ggd.ws||[]).concat([30])}); }); buzz(6); return; }
    if((b=e.target.closest('[data-grand]'))){ var pge=b.getAttribute('data-grand'); putGen(pge,randPal(genOf(pge))); buzz(8); return; }
    if((b=e.target.closest('[data-gcbg0]'))){ putGen(b.getAttribute('data-gcbg0'),{bg:''}); buzz(6); return; }
    if((b=e.target.closest('[data-tg="lksync"]'))){ var syOn=!P.lookV.sync; P.lookPut({sync:syOn?1:0}); b.setAttribute('aria-checked',syOn?'true':'false'); toast(syOn?'两边同步开着：之后改一边，另一边跟着变':'两边同步关了：两边各改各的'); paint(); buzz(6); return; }   /* [2026-11-16 批2 E8 新语义：打开不再整套拷贝，只对之后的改动逐键镜像；关闭后改动不跟随（旧行为「打开时以当前边整套拷」废弃）] */
    if((b=e.target.closest('[data-tg="lkav"]'))){ var avOn=!(P.lookV.av==null?true:!!P.lookV.av); P.lookPut({av:avOn?1:0}); paint(); requestAnimationFrame(function(){ if(P.bubble&&P.bubble.pvShape) P.bubble.pvShape(win); }); buzz(6); return; }   /* [2026-11-02 头像开关：r() 的 .on 在行上，paint 统一回画] */
    if((b=e.target.closest('.lk-avp button[data-seg]'))){ P.lookPut({avPos:(+b.dataset.seg)===1?'side':'top'}); paint(); requestAnimationFrame(function(){ if(P.bubble&&P.bubble.pvShape) P.bubble.pvShape(win); }); buzz(6); return; }   /* [2026-11-23 头像位置：消息上方 top / 气泡左侧 side] */
    if((b=e.target.closest('.th-bgs button[data-bg]'))){ bgPick(win,b); return; } });   /* 聊天背景网格：子页直接展开，点格子就换（10-31 三轮） */
  win.addEventListener('input',function(e){ var x=e.target, id=x.id||''; if(MIR) return;   /* mirror 程序回写滑杆时不再镜像回去 */
    var mbp=/^lk(ai|me)BlP$/.exec(id); if(mbp){ var sb=mbp[1]; P.lookV[sb+'Bl']=+x.value; mirrorKey(sb,'Bl'); twinBl(sb); P.lookApply(); return; }   /* [位置:phone-pages.js·lookSetup 滑块] [图案面板里的背景模糊] [2026-11-10：与实色面板的 lk?Bl 同一个值（aiBl/meBl），拖这条要把另一条同步过去] [注释时间 2026-11-10] */
    var m=/^lk(ai|me)(A|Bl|Sh)$/.exec(id); if(m){ /* [位置:phone-pages.js·lookSetup 滑块] [拖动不再每帧同步写 localStorage] [2026-10-27 审查：
       range 拖动每秒几十次 input，每次 JSON.stringify+同步 setItem（Safari 落盘可阻塞主线程几十 ms）是拖动发涩的主因；
       input 只更新内存与 CSS 变量，change 才落盘] [注释时间 2026-10-27] */ var o3={}; o3[m[1]+m[2]]=+x.value; Object.assign(P.lookV,o3); mirrorKey(m[1],m[2]); if(m[2]==='Bl') twinBl(m[1]); P.lookApply();
      /* [2026-11-05] 透明度变了要让尾巴档的形状 SVG 重画（底色 alpha 烘在 SVG 里，CSS 变量改了不会自动更新） */
      if(m[2]==='A'&&P.bubble&&P.bubble.lookAlphaChanged) P.bubble.lookAlphaChanged();
      return; }
    var mr=/^lk(ai|me)R$/.exec(id); if(mr){ var o6={}; o6[mr[1]+'R']=+x.value; if(P.lookV.sync){ o6[otherOf(mr[1])+'R']=+x.value; setSlider(sliderIds(otherOf(mr[1])).R,+x.value); } bubS(o6); return; }   /* 圆角两边各一个，拖动即时生效并落盘（10-31 三轮） */
    /* [位置:phone-pages.js·lookSetup 滑块] [两方两圆方角] [2026-11-23 修复：拖动时同步调 P.lookApply + P.bubble.refresh + P.bubble.lookChanged，气泡圆角与线框/图案 SVG 轮廓实时跟着变] */
    var mh=/^lk(ai|me)HsqR$/.exec(id); if(mh){ var shq=mh[1]; P.lookV[shq+'HsqR']=+x.value; mirrorKey(shq,'HsqR'); P.lookApply(); if(P.bubble){ if(P.bubble.refresh) P.bubble.refresh(); if(P.bubble.lookChanged) P.bubble.lookChanged(); } hsqIcons(); return; }
    /* [位置:phone-pages.js·lookSetup 形状滑杆] [内边距/外边距/输入框圆角/高度：拖动只更新内存与变量（lookApply），change 统一落盘——与透明度滑杆同策略，不每帧写 localStorage] [注释时间 2026-11-02] */
    var m5=/^lk(Ai|Me)Lw$/.exec(id); if(m5){ P.lookV[m5[1].toLowerCase()+'Lw']=+x.value; mirrorKey(m5[1].toLowerCase(),'Lw'); P.lookApply(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); return; }
    /* [位置:phone-pages.js·lookSetup 线条疏密] [虚线段长/波浪波长随 Ld 变] [11-03：同粗细滑杆——input 只更内存+重画线框，change 统一落盘] [注释时间 2026-11-03] */
    var m7=/^lk(Ai|Me)Ld$/.exec(id); if(m7){ P.lookV[m7[1].toLowerCase()+'Ld']=+x.value; mirrorKey(m7[1].toLowerCase(),'Ld'); P.lookApply(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); return; }
    /* [位置:phone-pages.js·lookSetup 线框透明度] [2026-11-16 批2 E7] [同粗细滑杆——input 只更内存+重画线框，change 统一落盘；mirrorKey 走 SYNCK 里新加的 Lo] [注释时间 2026-11-16] */
    var m8=/^lk(Ai|Me)Lo$/.exec(id); if(m8){ P.lookV[m8[1].toLowerCase()+'Lo']=+x.value; mirrorKey(m8[1].toLowerCase(),'Lo'); P.lookApply(); if(P.bubble&&P.bubble.lookFrameChanged) P.bubble.lookFrameChanged(); return; }
    /* [位置:phone-pages.js·lookSetup 底图滑杆] [透明度 / 旋转角度：拖的时候只更内存+重画图案层（不每帧写盘），松手 change 统一落盘] [注释时间 2026-11-05] */
    var mo=/^lk(Ai|Me)PatO$/.exec(id); if(mo){ var po=mo[1].toLowerCase(), go=genOf(po); go.op=+x.value; P.lookV[po+'PatG']=P.bubble.genStr(go); P.lookApply(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); return; }
    /* [2026-11-05] 旧 10 图案的浓度滑杆（PatOX，与新款的 PatO 分开：新款存 gen 参数串的 op，旧款存 aiPatO/mePatO） */
    var mx=/^lk(Ai|Me)PatOX$/.exec(id); if(mx){ var px2=mx[1].toLowerCase(); P.lookV[px2+'PatO']=+x.value; if(P.lookV.sync) mirrorKey(px2,'PatO'); if(!lookDrafting()){ try{ P.chatTheme.save({look:P.lookV}); }catch(e){} if(P.themeSync) P.themeSync.touch(); } P.lookApply(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); return; }   /* [2026-11-14 收拢] 落盘改走 P.chatTheme */
    var mn=/^lk(Ai|Me)PatA$/.exec(id); if(mn){ var pn=mn[1].toLowerCase(), gn=genOf(pn); gn.ang=+x.value; P.lookV[pn+'PatG']=P.bubble.genStr(gn); P.lookApply(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); return; }
    var m6=/^lk(Ai|Me)PatS$/.exec(id); if(m6){ P.lookV[m6[1].toLowerCase()+'PatS']=+x.value; mirrorKey(m6[1].toLowerCase(),'PatS'); P.lookApply(); if(P.bubble&&P.bubble.lookPatChanged) P.bubble.lookPatChanged(); return; }   /* [2026-11-02 图案密度：内存+变量+图案层重画，change 统一落盘] */   /* [2026-11-02 线框粗细：内存+变量+只重画线框层（形状图 key 不含 FVER 零重画），change 统一落盘] */
    var m4=/^lk(IBr|IBh)$/.exec(id); if(m4){ var k4={IBr:'ibr',IBh:'ibh'}[m4[1]]; P.lookV[k4]=+x.value; P.lookApply(); return; }
    /* [位置:phone-pages.js·lookSetup 滑块] [内/外边距与最大宽度每边一个] [2026-11-10；2026-11-23 加 MaxW：拖动实时更新 CSS 变量，两边同步开着时拷到另一边，change 统一落盘] [注释时间 2026-11-10；2026-11-23 加 MaxW] */
    var m7=/^lk(Ai|Me)(Pad|Gap|MaxW)$/.exec(id); if(m7){ var s7=m7[1].toLowerCase(); P.lookV[s7+m7[2]]=+x.value; mirrorKey(s7,m7[2]); P.lookApply(); if((m7[2]==='Pad'||m7[2]==='MaxW')&&P.bubble&&P.bubble.pvShape) P.bubble.pvShape(win); return; }
    if(id==='lkVeil') bubS({veil:100-x.value}); });
  win.addEventListener('change',function(e){ var x=e.target;
    if(/^(lk(ai|me)(A|Bl|BlP|Sh)|lkIBr|lkIBh|lk(Ai|Me)(Pad|Gap|MaxW)|lkAiLw|lkMeLw|lkAiLd|lkMeLd|lkAiLo|lkMeLo|lkAiPatS|lkMePatS|lkAiPatO|lkMePatO|lkAiPatOX|lkMePatOX|lkAiPatA|lkMePatA|lk(ai|me)HsqR)$/.test(x.id||'')){ P.lookPut({});
      var mc=/^lk(Ai|Me)(PatS|PatO|PatA)$/.exec(x.id||''); if(mc&&P.lookV.sync) mirrorKeys(mc[1].toLowerCase(),['Pat','PatG','PatS']);   /* [2026-11-23 修] 大小写修正 Ai|Me，开启两边同步时图案滑杆松手可正常镜像 */
      return; }   /* 把拖完的内存值落一次盘（见 input 分支注释） */
  });
}

/* 2026-10-31：聊天外观页撤掉，编辑区由主题页 themeHTML/themeSetup 直接用上面的函数（P.lookUI 出口一并删） */
/* ---------- 主题：我们（头像 / 名字）、触感、预设主题 ---------- */
/* [位置:phone-pages.js·THEMES] [聊天主题卡] [2026-10-31 三轮：主题卡=全局聊天主题——月夜玻璃=bubble（气泡主题）、极简=min；点卡=切到该主题并跳进它的设置子页（themePageOpen，编辑配置都在子页里，主题页本体只留卡片不挤）；以后加主题往数组加一项、phone-talk.js 按 id 接上] [注释时间 2026-10-31 三轮] */
var THEMES=[{id:'bubble',name:'月夜玻璃',desc:'现在这套 · 蓝色气泡，跟着天色变',bg:'linear-gradient(180deg,#5b66a8,#363e7c)',ink:'#fff'},
  {id:'min',name:'极简',desc:'Claude 风 · 无气泡纯文字',bg:'linear-gradient(180deg,#faf9f5,#ece7d9)',ink:'#1f1e1d'},
  /* [位置:phone-pages.js·THEMES 占位] [微信 / CRT 预告卡] [2026-11-02：先占位，之后各自单独做成主题（样式底子已在旧 chat.html 里考据过：wx=绿底方角尾巴气泡、crt=琥珀终端）；wip=1 只弹提示不切换、不进会话级下拉] [注释时间 2026-11-02] */
  {id:'wx',name:'微信',desc:'装修中 · 绿色气泡带尾巴',bg:'linear-gradient(180deg,#dcefd2,#a8d894)',ink:'#17320f',wip:1},
  {id:'crt',name:'CRT',desc:'装修中 · 琥珀单色终端',bg:'linear-gradient(180deg,#2a2015,#0d0b08)',ink:'#e0b36a',wip:1}];
var BUB=['#7298d6','#e892a8','#7fbf9c','#4a4f66'];   /* [位置:phone-pages.js·BUB] [我的气泡推荐色] [10-31 四轮：同 AIC 减到 4 个，一行放得下（去掉浅蓝 / 紫）] [注释时间 2026-10-31 四轮] */
function themeHTML(){
  var actId=cthemeActiveId(), actCt=actId?cthemeById(actId):null;
  var curLy=P.appLayout?P.appLayout.get():(P.chatStyle&&P.chatStyle.get()==='min'?'min':'phone');
  var curCs=P.chatStyle?P.chatStyle.get():'bubble';
  var lyCards=[
    {id:'phone',name:'小手机布局',desc:'锁屏 · 桌面图标 · 玻璃卡片',bg:'linear-gradient(180deg,#5b66a8,#363e7c)',ink:'#fff'},
    {id:'min',name:'极简布局',desc:'侧栏抽屉 · 纯净纸面外壳',bg:'linear-gradient(180deg,#faf9f5,#ece7d9)',ink:'#1f1e1d'}
  ];
  var uNm=(P.names&&P.names.me)?P.names.me():'用户', aNm=(P.names&&P.names.ai)?P.names.ai():'助手', uLt=(P.names&&P.names.letter)?P.names.letter('me'):'用', aLt=(P.names&&P.names.letter)?P.names.letter('ai'):'助';
  return G.shell('主题','',
  '<div class="th-us pg-rise"><div class="pair"><button class="av me tap" data-l="'+esc(uLt)+'" data-av="me"></button><button class="av ai tap" data-l="'+esc(aLt)+'" data-av="ai"></button></div><div class="nm"><button class="tap" data-nm="me">'+esc(uNm)+'</button><span>&amp;</span><button class="tap" data-nm="ai">'+esc(aNm)+'</button></div></div>'+
  grp('外观',['<div class="pg-r th-apr">'+seg(P.appear.LIST.map(function(x){ return x[1]; }),Math.max(0,P.appear.LIST.map(function(x){ return x[0]; }).indexOf(P.appear.get()))).replace('class="pg-seg"','class="pg-seg th-seg th-ap"')+'</div>'],null,0)+
  grp('触感',[r({ic:'',t:'震动反馈',tg:1,on:1}),'<div class="pg-r">'+'<span class="rt"><b>力度</b></span>'+seg(['轻','中','重'],1).replace('class="pg-seg"','class="pg-seg th-seg"')+'</div>'],null,0)+
  lookCommonHTML()+
  '<div class="pg-gt">整体布局</div><div class="th-grid">'+lyCards.map(function(t,i){ var on=curLy===t.id; return '<button class="th-card pg-rise'+(on?' on':'')+'" style="--i:'+i+';--bg:'+t.bg+';--ink:'+t.ink+'" data-ly="'+t.id+'"><i><u></u><u></u><u></u></i><b>'+t.name+'</b><small>'+esc(t.desc)+'</small></button>'; }).join('')+'</div>'+
  grp('聊天页',[
    '<div class="pg-r"><span class="rt"><b>默认聊天风格</b></span>'+seg(['气泡','极简'],curCs==='min'?1:0).replace('class="pg-seg"','class="pg-seg th-seg th-cstyle"')+'</div>',
    r({t:'聊天外观与皮肤',s:'气泡 · 输入框 · 背景 · 自定义皮肤',v:actCt?esc(actCt.name):'默认',go:'chatlook'})
  ],null,4)); }
/* [位置:phone-pages.js·P.themeSync] [聊天主题配置云同步] [2026-11-05：以前整套配置只在这台手机的 localStorage，换设备/浏览器全是默认值。现在服务器存一份（/admin/chat-theme，data/chat-theme.json），以云端为准：打开小手机、切回前台、恢复联网时拉一次，云端有就覆盖本机；云端还是空而本机有配置=把本机当首次保存传上去（别的设备先开也不会用默认值盖掉）。上传的内容永远取「本机已保存」的（localStorage），不取子页里的草稿。touch=主题页自动保存类改动后 1 秒上传；push=点保存时立即传，传上才清「待上传」标记（ph.themesync.dirty），没传上的下次拉取前先补传，不会被云端旧值盖掉。背景照片只传地址（已是 /uploads 地址），回退成 dataURL 的先补传一次，传不上就这次不带这个字段（云端原照片保留）。同步范围：本机 ph.chattheme.v1 六段（2026-11-14 第 24 条 b 收拢，原 ph.look.v2 / ph.bubble.v1 / ph.chatbg.img / ph_chat_style / ph_chat_font_cn/en 读时迁移；云端六段格式不变）+ cthemes 自定义主题存档段（2026-11-14 第 27 条：collect 永远带上；云端响应没带 cthemes（旧后端）时 same 不比对、apply 不覆盖，功能照常只是不跨设备，重启 gateway 后自动接上）] [注释时间 2026-11-05；2026-11-14 本机存储收拢；当晚第 27 条加 cthemes 段] */
P.themeSync=(function(){
  var DK='ph.themesync.dirty', IK='ph.chatbg.img', tm=0, lastPull=0;   /* [2026-11-14 收拢] BK 撤掉，本机读写全走 P.chatTheme；IK 只留给 collect 的未迁移兜底 */
  function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function js(k){ try{ return JSON.parse(ls(k)||'null'); }catch(e){ return null; } }
  function hasLocal(){ return P.chatTheme.hasAny(); }   /* [2026-11-14 收拢] 新键或旧键（bgimg 单独存在不算，口径与原来一致） */
  function collect(){ var o=P.chatTheme.read(); return {look:(o&&o.look)||{},bubble:(o&&o.bubble)||{},bgimg:o?String(o.bgimg||''):(ls(IK)||''),style:P.chatStyle?P.chatStyle.get():'bubble',cn:P.chatFont?P.chatFont.get('cn'):'',en:P.chatFont?P.chatFont.get('en'):'',cthemes:(o&&Array.isArray(o.cthemes))?o.cthemes:[]}; }   /* [2026-11-14 收拢] 上云负载改从统一存储取，六段键名与改前逐字相同 [2026-11-14 第27条] 带 cthemes（自定义主题存档）第七段；旧后端不认就静默丢，前端 same() 已做兼容 */
  function norm(o){ var r={}; Object.keys(o||{}).sort().forEach(function(k){ var v=o[k]; if(v!==''&&v!=null) r[k]=v; }); return r; }
  function ctJ(o){ return JSON.stringify(Array.isArray(o&&o.cthemes)?o.cthemes:[]); }   /* [2026-11-14 第27条] 云端响应没带 cthemes 字段（旧后端未重启）时 same() 里这项当「云端同意」处理，不比对也不覆盖本机 */
  function same(a,b){ var ct=Array.isArray(b.cthemes)?ctJ(b):''; return JSON.stringify([norm(a.look),norm(a.bubble),a.bgimg||'',a.style||'',a.cn||'',a.en||'',Array.isArray(b.cthemes)?ctJ(a):''])===JSON.stringify([norm(b.look),norm(b.bubble),b.bgimg||'',b.style||'',b.cn||'',b.en||'',ct]); }
  function setDirty(on){ try{ if(on) localStorage.setItem(DK,'1'); else localStorage.removeItem(DK); }catch(e){} }
  function push(){ clearTimeout(tm); tm=0; var d=collect(), img=d.bgimg, pre; setDirty(true);
    if(img&&img.indexOf('data:')===0) pre=P.net.post('/v1/upload-image',{data:img},{timeout:120000}).then(function(j){ return j&&j.url?j.url:null; },function(){ return null; });
    else pre=Promise.resolve(img);
    return pre.then(function(u){ if(u===null) delete d.bgimg; else d.bgimg=u; return P.net.post('/heartbeat/admin/chat-theme/save',d,{timeout:60000}); })   /* [2026-11-06 修] 原来写 /admin/...，nginx 的 location /admin 会 301 到 /heartbeat，POST 被浏览器降级成 GET → 404，永远传不上去 */
      .then(function(r){ if(!r||!r.ok) throw new Error((r&&r.msg)||'没存上'); if(!tm) setDirty(false); P.chatTheme.clearLegacy(); return true; }); }   /* [2026-11-14 收拢] 首次保存成功起清旧散键（幂等；此后新键是唯一真源） */
  function touch(){ setDirty(true); clearTimeout(tm); tm=setTimeout(function(){ tm=0; push().catch(function(){}); },1000); }
  function apply(d){
    try{ var pt={look:d.look||{},bubble:d.bubble||{},bgimg:String(d.bgimg||'')}; if(d.style) pt.style=d.style; if(d.cn) pt.cn=d.cn; if(d.en) pt.en=d.en; if(Array.isArray(d.cthemes)) pt.cthemes=d.cthemes; P.chatTheme.save(pt); }catch(e){}   /* [2026-11-14 收拢] 云端拉下来的整包写进 ph.chattheme.v1；style/cn/en 空着不写＝保留本机现有值，与原「不动散键」一致；bgimg 空＝删背景照片 [2026-11-14 第27条] 云端带了 cthemes 才整段写回，没带（旧后端）不碰本机列表 */
    if(P.chatStyle&&d.style) P.chatStyle.set(d.style,true);
    if(P.chatFont){ if(d.cn) P.chatFont.set('cn',d.cn,true); if(d.en) P.chatFont.set('en',d.en,true); }
    P.lookLoadSaved(); if(P.bubble) P.bubble.loadSaved(); }
  function pull(force){ var now=Date.now(); if(!force&&now-lastPull<20000) return Promise.resolve(); lastPull=now;
    if(lookDrafting()) return Promise.resolve();   /* 子页开着不拉：别在她调的时候换掉底下的数据 */
    if(ls(DK)==='1'||tm) return push().catch(function(){});   /* 本机有没传上去的保存：先补传，不让云端旧值盖掉 */
    return P.net.get('/heartbeat/admin/chat-theme',{noLogin:true}).then(function(r){
      if(!r||!r.ok||lookDrafting()) return;
      if(!r.data){ if(hasLocal()) return push().catch(function(){}); return; }
      if(!same(collect(),r.data)) apply(r.data); },function(){}); }
  setTimeout(function(){ pull(true); },1500);
  document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') pull(); });
  window.addEventListener('online',function(){ pull(true); });
  return {touch:touch,push:push,pull:pull};
})();

/* ---------- 自定义主题：月夜玻璃配置的命名克隆（2026-11-14随手记第 27 条） ---------- */
/* [位置:phone-pages.js·ctheme*] [自定义主题存档：增删改查] [11-14：月夜玻璃里调好看的配置想存下来复用。入口两个：月夜玻璃子页头部「存为主题」按钮（快照=现在看到的样子，含未保存草稿，与之后保存/不保存互不影响）、主题页「自定义主题」区块末尾「＋ 存当前配置」（快照=本机已保存值）；点区块行=整套恢复（当前不在月夜玻璃顺手切回来，否则气泡配置不生效），长按 480ms 弹改名/删除；再存时若与某条快照完全一致、或恢复过某条后又调过（P.cthemeLast）→ 轻确认「覆盖 / 另存」。快照内容=look+bubble+bgimg 三段；照片只存地址：data: 先传 /v1/upload-image 换 URL，传不上这条不带照片并提示。落点=统一存储 ph.chattheme.v1·cthemes 段（见 phone-kit.js·P.chatTheme），上限 CTHEME_MAX 条、新的在前，改动即 themeSync.touch 上云] [注释时间 2026-11-14] */
var CTHEME_MAX=20;
var CTHEME_OK='<svg class="th-ct-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
var CTHEME_BM='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h10c.6 0 1 .4 1 1v16l-6-3.8-6 3.8v-16c0-.6.4-1 1-1Z"/></svg>';   /* 书签：子页头部「存为主题」按钮图标 */
function cthemeList(){ var o=null; try{ o=P.chatTheme.read(); }catch(e){} return (o&&Array.isArray(o.cthemes))?o.cthemes:[]; }
function cthemeById(id){ var L=cthemeList(),i; for(i=0;i<L.length;i++){ if(L[i]&&L[i].id===id) return L[i]; } return null; }
function cthemePut(L){ try{ P.chatTheme.save({cthemes:L}); }catch(e){ throw new Error('存不下，腾点空间再试'); } if(P.themeSync) P.themeSync.touch(); }   /* 整段替换写回并 1 秒上云；配额不足抛错由调用方接 */
function cthemeNorm0(o){ var r={},ks,i; ks=Object.keys(o||{}).sort(); for(i=0;i<ks.length;i++){ var v=o[ks[i]]; if(v!==''&&v!=null) r[ks[i]]=v; } return r; }
function cthemeSig(cap){ return JSON.stringify([cthemeNorm0(cap.look),cthemeNorm0(cap.bubble),String(cap.bgimg||'')]); }   /* 快照指纹：三段归一后比对，themeSync.norm 同款口径 */
function cthemeFindSame(L,cap){ var i,s=cthemeSig(cap); for(i=0;i<L.length;i++){ if(L[i]&&cthemeSig(cthemeCapOf(L[i]))===s) return L[i]; } return null; }
function cthemeCapOf(e){ return {look:e.look||{},bubble:e.bubble||{},bgimg:String(e.bgimg||'')}; }
function cthemeColor(v,def){ v=String(v||''); return /^#[0-9a-fA-F]{3,8}$/.test(v)?v:def; }   /* 圆点预览色只认 #hex，脏数据回缺省，不进 style 属性 */
/* [位置:phone-pages.js·cthemeCapture] [当前配置快照] [live=真——取 P.lookV / P.bubble 内存值（月夜玻璃子页开着时含草稿，「存为主题」存的就是她现在看到的）；live=假——取统一存储已保存段（主题页「＋ 存当前配置」，永远不取草稿，与 themeSync.collect 口径一致）] [注释时间 2026-11-14] */
function cthemeCapture(live){
  if(live) return {look:Object.assign({},P.lookV||{}),bubble:P.bubble?P.bubble.get():{},bgimg:P.bubble?String(P.bubble.bgImage()||''):''};
  var o=null; try{ o=P.chatTheme.read(); }catch(e){}
  return {look:Object.assign({},(o&&o.look)||{}),bubble:Object.assign({},(o&&o.bubble)||{}),bgimg:o?String(o.bgimg||''):''};
}
function cthemeActiveId(){
  var id=P.cthemeLast;
  if(!id){ try{ id=localStorage.getItem('ph_ctheme_act')||''; }catch(e){} }
  if(id&&cthemeById(id)) return id;
  var same=cthemeFindSame(cthemeList(),cthemeCapture(false));
  return same?same.id:'';
}
function cthemeSetActive(id){
  P.cthemeLast=id||null;
  try{ if(id) localStorage.setItem('ph_ctheme_act',id); else localStorage.removeItem('ph_ctheme_act'); }catch(e){}
}
function cthemeBgStyle(e){
  var g=(e&&e.bubble)||{}, bg=String(g.bg||'');
  if(bg==='img'&&e&&e.bgimg){
    var u=String(e.bgimg).replace(/["'()\\]/g,'');
    if(u) return 'url("'+u+'")';
  }
  var hit=bg&&P.bubble&&P.bubble.BG&&P.bubble.BG[bg];
  if(hit&&hit[1]) return hit[1];
  return 'linear-gradient(155deg,#e8f0fb,#cfdcf2)';
}
var CTHEME_MORE='<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
function cthemeRowsHTML(){
  var L=cthemeList(), actId=cthemeActiveId(), rows=L.map(function(e,i){
    var g=e.bubble||{}, on=!!(actId&&actId===e.id);
    var cai=cthemeColor(g.ai,'#f6f9ff'), cme=cthemeColor(g.me,'#7298d6');
    return '<div class="pg-r ct-row tap'+(on?' on':'')+'" role="button" tabindex="0" data-ct="'+esc(e.id)+'">'+
      '<span class="ct-dots"><i style="--c:'+cai+'"></i><i style="--c:'+cme+'"></i></span>'+
      '<span class="rt"><b>'+esc(e.name)+'</b></span>'+
      (on?'<span class="ct-act">生效中</span>':'')+
      '<button type="button" class="ct-more tap" data-ctmore="'+esc(e.id)+'" aria-label="更多">'+CTHEME_MORE+'</button>'+
    '</div>';
  });
  var body=rows.length?('<div class="pg-g ct-list">'+rows.join('')+'</div>'):'<div class="pg-empty" style="padding:18px 8px 6px">还没有保存的自定义皮肤</div>';
  return body+'<button type="button" class="th-ct-add ct-add tap" data-ctadd>＋ 存为新皮肤</button>';
}
function cthemeHTML(){ return '<div class="pg-gt">自定义皮肤</div><div class="th-ct">'+cthemeRowsHTML()+'</div>'; }
function cthemeRepaint(win){
  var b=$('.th-ct',win); if(b) b.innerHTML=cthemeRowsHTML();
  var aid=cthemeActiveId(), ac=aid?cthemeById(aid):null;
  var lk=$('[data-go="chatlook"] .rv',win); if(lk) lk.textContent=ac?ac.name:'默认';
  var bc=$('.th-card[data-th="bubble"] small',win);
  if(bc) bc.textContent=ac?('生效中 · '+ac.name):THEMES[0].desc;
}
/* [位置:phone-pages.js·cthemeUpdateActive] [保存时同步更新当前生效中的自定义主题] [2026-11-23：切到某套自定义主题后在其基础上改配置，点「保存」直接原地更新那套自定义主题，不再逼着新建一套] [注释时间 2026-11-23] */
function cthemeUpdateActive(cap){
  var id=cthemeActiveId(), cur=id?cthemeById(id):null;
  if(!cur) return null;
  var L=cthemeList(), i;
  for(i=0;i<L.length;i++){
    if(L[i]&&L[i].id===id){
      L[i]=Object.assign({},L[i],{ts:Date.now(),look:cap.look,bubble:cap.bubble,bgimg:String(cap.bgimg||'')});
      break;
    }
  }
  try{ cthemePut(L); }catch(e){ return null; }
  return cur.name;
}
/* [位置:phone-pages.js·cthemeSheet] [聊天外观与皮肤内嵌自定义皮肤抽屉] [2026-11-23：双列迷你聊天预览卡片网格 + 生效中角标 + 显式「⋯」改名/删除 + 「＋ 存为新皮肤」，切换皮肤不再强改整体布局或默认聊天风格] [注释时间 2026-11-23] */
function cthemeSheet(win,pg,onApplied){
  var CTJ=0;
  sheet(win,'自定义皮肤','<div class="th-ct">'+cthemeRowsHTML()+'</div>',function(sh,close){
    hold(sh,function(row){ var e=cthemeById(row.getAttribute('data-ct')); if(!e) return; CTJ=Date.now(); buzz([10,30,10]);
      close(); cthemeMenu(win,e); },'.ct-row');
    sh.addEventListener('click',function(ev){
      if(Date.now()-CTJ<450) return;
      var more=ev.target.closest('[data-ctmore]');
      if(more){ ev.stopPropagation(); var me=cthemeById(more.getAttribute('data-ctmore')); if(!me) return; buzz(6); close(); cthemeMenu(win,me); return; }
      if(ev.target.closest('[data-ctadd]')){ close(); buzz(6); cthemeNameSheet(win,cthemeCapture(true),null); return; }
      var row=ev.target.closest('[data-ct]'); if(!row) return;
      var id=row.getAttribute('data-ct'), e=cthemeById(id); if(!e) return;
      buzz(6);
      try{ P.chatTheme.save({look:e.look||{},bubble:e.bubble||{},bgimg:String(e.bgimg||'')}); }catch(er){ toast('存不下'); return; }
      P.lookLoadSaved(); if(P.bubble) P.bubble.loadSaved();
      if(P.themeSync) P.themeSync.touch();
      cthemeSetActive(id);
      cthemeRepaint(win);
      if(onApplied) onApplied(e);
      close();
      toast('已切换为「'+e.name+'」'); buzz([8,30,8]);
    });
  });
}
/* [位置:phone-pages.js·cthemeSaveFlow] [存为主题入口] [先找目标：快照与某条完全一致=那条；否则刚恢复过又调过的=那条（P.cthemeLast）——两种都先弹「覆盖 / 另存」轻确认；没有目标直接命名。满了先拦（覆盖不占新位不算）] [注释时间 2026-11-14] */
function cthemeSaveFlow(win,cap){
  var L=cthemeList(), tgt=cthemeFindSame(L,cap)||((P.cthemeLast&&cthemeById(P.cthemeLast))||null);
  if(!tgt&&L.length>=CTHEME_MAX){ toast('最多存 '+CTHEME_MAX+' 套，先长按删一套'); buzz([20,30,20]); return; }
  if(tgt){ sheet(win,'存为主题','<div class="pg-g">'+r({t:'覆盖「'+esc(tgt.name)+'」',act:'ow'})+r({t:'另存为新主题',act:'new'})+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; var a=x.dataset.act; close(); buzz(6);
        if(a==='ow') cthemeWrite(win,tgt.id,tgt.name,cap);
        else cthemeNameSheet(win,cap,null); }); });
    return; }
  cthemeNameSheet(win,cap,null);
}
/* [位置:phone-pages.js·cthemeNameSheet] [命名底板] [默认名「自定义 N」跳过已有的；撞名不直接盖——再弹一层「覆盖 / 换个名字另存」，另存的默认名带 2/3 后缀] [注释时间 2026-11-14] */
function cthemeNameSheet(win,cap,pre){
  var L=cthemeList(), def=pre;
  if(!def){ var n=1; def='自定义 '+n; while(L.some(function(e){ return e&&e.name===def; })){ n++; def='自定义 '+n; } }
  sheet(win,'存为主题','<input class="pg-in" value="'+esc(def)+'" maxlength="20" aria-label="主题名字">'+'<div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn pri tap" data-ok>好</button></div>',function(sh,close){
    sh.querySelector('[data-ok]').addEventListener('click',function(){
      var v=sh.querySelector('input').value.trim().slice(0,20);
      if(!v){ buzz([20,30,20]); return; }
      var dup=null; L.forEach(function(e){ if(e&&e.name===v) dup=e; });
      close();
      if(dup){ sheet(win,'已有同名','<div class="pg-g">'+r({t:'覆盖「'+esc(v)+'」',act:'ow'})+r({t:'换个名字另存',act:'new'})+'</div>',function(sh2,close2){
          sh2.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; var a=x.dataset.act; close2(); buzz(6);
            if(a==='ow') cthemeWrite(win,dup.id,v,cap);
            else cthemeNameSheet(win,cap,v+' 2'); }); });
        return; }
      cthemeWrite(win,null,v,cap);
    }); });
}
/* [位置:phone-pages.js·cthemeWrite] [落盘一条] [id 给了=覆盖原位并挪到最上（最近调的最常找）；没给=新条插到最前。草稿里刚选的照片还是 dataURL：先传服务器换地址再存，传不上这条不带照片（提示，不阻断）] [注释时间 2026-11-14] */
function cthemeWrite(win,id,name,cap){
  function done(bgimg){
    var L=cthemeList(), e={id:id||('ct'+Date.now().toString(36)),name:name,ts:Date.now(),look:cap.look,bubble:cap.bubble,bgimg:bgimg||''}, i;
    if(id){ for(i=0;i<L.length;i++){ if(L[i]&&L[i].id===id){ L.splice(i,1); break; } } }
    if(L.length>=CTHEME_MAX){ toast('最多存 '+CTHEME_MAX+' 套，先长按删一套'); return; }
    L.unshift(e);
    try{ cthemePut(L); }catch(er){ toast(er.message||'存不下'); return; }
    cthemeSetActive(e.id);
    cthemeRepaint(win);
    toast((id?'覆盖了「':'存好了「')+name+'」'); buzz([8,30,8]); }
  var u=String(cap.bgimg||'');
  if(u.indexOf('data:')===0){ toast('照片先传一下…');
    P.net.post('/v1/upload-image',{data:u},{timeout:120000}).then(function(j){ var ok=!!(j&&j.url); if(!ok) toast('照片没传上，这条先不带背景'); done(ok?j.url:''); },function(){ toast('照片没传上，这条先不带背景'); done(''); });
    return; }
  done(u);
}
/* [位置:phone-pages.js·cthemeApply] [点行整套恢复] [三段写回统一存储（save 是整段替换，快照缺的键回落 LDEF/DEF 缺省，正是当时的样子）；不在月夜玻璃先切回来（silent 写避免双 touch，底下统一 touch 一次）；草稿子页开着不响应——别在她调的时候换底下的数据] [注释时间 2026-11-14] */
function cthemeApply(win,id){
  if(lookDrafting()){ toast('子页还在调，先保存或放弃那边的修改'); return; }
  var e=cthemeById(id); if(!e) return;
  try{ P.chatTheme.save({look:e.look||{},bubble:e.bubble||{},bgimg:String(e.bgimg||'')}); }catch(er){ toast('存不下，腾点空间再试'); return; }
  P.lookLoadSaved(); if(P.bubble) P.bubble.loadSaved();
  if(P.themeSync) P.themeSync.touch();
  cthemeSetActive(id);
  cthemeRepaint(win);
  toast('换成「'+e.name+'」了'); buzz([8,30,8]);
}
/* [位置:phone-pages.js·cthemeMenu/cthemeRename/cthemeDelete] [长按菜单与改名/删除] [手势与 presetPage 同款：hold 480ms、click 看 JUST 防长按后误触（挂 themeSetup）；删除走 confirmBox 红键，删完行淡出再重画] [注释时间 2026-11-14] */
function cthemeMenu(win,e){
  sheet(win,esc(e.name),'<div class="pg-g">'+r({t:'改名',act:'ren'})+r({t:'删除',act:'del',red:1})+'</div>',function(sh,close){
    sh.addEventListener('click',function(ev){ var x=ev.target.closest('[data-act]'); if(!x) return; var a=x.dataset.act; close(); buzz(6);
      if(a==='ren') cthemeRename(win,e.id); else cthemeDelete(win,e.id); }); });
}
function cthemeRename(win,id){
  var e=cthemeById(id); if(!e) return;
  sheet(win,'改名字','<input class="pg-in" value="'+esc(e.name)+'" maxlength="20" aria-label="主题名字">'+'<div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn pri tap" data-ok>好</button></div>',function(sh,close){
    sh.querySelector('[data-ok]').addEventListener('click',function(){
      var v=sh.querySelector('input').value.trim().slice(0,20); if(!v){ buzz([20,30,20]); return; }
      close();
      var L=cthemeList(),i; for(i=0;i<L.length;i++){ if(L[i]&&L[i].id===id) L[i].name=v; }
      try{ cthemePut(L); }catch(er){ toast('没存上'); return; }
      cthemeRepaint(win); toast('改好了'); buzz(8); }); });
}
function cthemeDelete(win,id){
  var e=cthemeById(id); if(!e) return;
  confirmBox(win,'删除「'+esc(e.name)+'」？','删了就找不回来了','删除',true,function(){
    var L=cthemeList(),i; for(i=0;i<L.length;i++){ if(L[i]&&L[i].id===id){ L.splice(i,1); break; } }
    if(cthemeActiveId()===id) cthemeSetActive(null);
    try{ cthemePut(L); }catch(er){ toast('没删掉'); return; }
    var row=$('.ct-row[data-ct="'+id+'"],.th-ct-row[data-ct="'+id+'"]',win);
    if(row){ row.classList.add('th-ct-gone'); setTimeout(function(){ cthemeRepaint(win); },270); }
    else cthemeRepaint(win);
    toast('删掉了'); buzz([8,30,8]); });
}

/* [位置:phone-pages.js·threeBox] [复用组 1 导出的三选一确认框] [11-25] [注释时间 2026-11-25] */
function threeBox(win,title,msg,fn){ return G.threeBox(win,title,msg,fn); }
/* [位置:phone-pages.js·themePageOpen] [主题设置子页] [2026-10-31 三轮；2026-11-05 手动保存；2026-11-23：书签钮直接管理自定义主题存档，保存时若当前生效的是某套自定义主题则原地更新该主题] */
function themePageOpen(win,th){
  if(th.id!=='bubble'){ sub(win,th.name,'<div class="pg-empty" style="padding:46px 20px">这个主题暂时没有可调的设置。</div>',{right:'<span class="pg-cb ghost"></span>'}); return; }
  var snap='', dirty=false, saving=false, btn=null, pg=null;
  var SAVE='<button type="button" class="pg-cb pg-sv tap" disabled aria-label="保存"><span class="t">保存</span><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>';
  var CTSV='<button type="button" class="pg-cb pg-cti tap" aria-label="自定义主题" title="自定义主题">'+CTHEME_BM+'</button>';
  function sigOf(){ var b=P.bubble, u=b?b.bgImage():''; return JSON.stringify([norm0(P.lookV),norm0(b?b.get():{}),u.length+':'+u.slice(-40)]); }
  function norm0(o){ var r={}; Object.keys(o).sort().forEach(function(k){ var v=o[k]; if(v!==''&&v!=null) r[k]=v; }); return r; }
  function chk(){ var d=sigOf()!==snap; if(d===dirty) return; dirty=d; if(btn){ btn.classList.toggle('on',d); btn.disabled=!d||saving; } }
  function discard(){ dirty=false; P.lookLoadSaved(); if(P.bubble) P.bubble.loadSaved(); snap=sigOf(); if(btn){ btn.classList.remove('on'); btn.disabled=true; } }
  function saveLocal(){ try{ P.lookFlush(); P.bubble.flush(); }catch(er){ toast(er.message||'存不下'); return false; } var updatedName=cthemeUpdateActive(cthemeCapture(true)); snap=sigOf(); dirty=false; if(btn){ btn.classList.remove('on'); } cthemeRepaint(win); if(updatedName) toast('已更新「'+updatedName+'」'); return true; }
  function bu(e){ if(!pg.isConnected){ window.removeEventListener('beforeunload',bu); return; } if(dirty){ e.preventDefault(); e.returnValue=''; } }
  function save(){ if(!dirty||saving) return;
    saving=true; btn.disabled=true; btn.classList.add('busy'); buzz(8);
    if(!saveLocal()){ saving=false; btn.classList.remove('busy'); btn.disabled=false; return; }
    P.themeSync.push().then(function(){ return true; },function(){ toast('已保存在本机，上传云端没成功，稍后自动重试'); return false; }).then(function(ok){
      saving=false; btn.classList.remove('busy'); btn.classList.add('ok'); buzz([10,40,10]); btn.disabled=!dirty;
      setTimeout(function(){ btn.classList.remove('ok'); },1300); }); }
  pg=sub(win,th.id==='bubble'?'聊天主题':th.name,lookBubbleHTML(),{top:lookTopHTML(),bottom:lookBottomHTML(),left:CTSV,right:SAVE,
    guard:function(close){ if(!dirty) return false;
      threeBox(win,'要保存修改吗','这一页的修改还没保存。',function(act){
        if(act==='save'){ if(saveLocal()){ P.themeSync.push().catch(function(){ toast('已保存在本机，上传云端没成功，稍后自动重试'); }); close(); } }
        else if(act==='drop'){ discard(); close(); } });
      return true; }});
  lookSetup(pg);
  btn=pg.querySelector('.pg-sv'); snap=sigOf(); pg._chk=chk; P.lookDraftEl=pg;
  btn.addEventListener('click',save); window.addEventListener('beforeunload',bu);
  var ctb=pg.querySelector('.pg-cti');
  if(ctb) ctb.addEventListener('click',function(){ buzz(6); cthemeSheet(win,pg,function(){ snap=sigOf(); dirty=false; if(btn){ btn.classList.remove('on'); btn.disabled=true; } pg.dispatchEvent(new CustomEvent('lookrepaint')); }); });
  var iv=setInterval(function(){ if(pg.isConnected) return; clearInterval(iv); window.removeEventListener('beforeunload',bu); if(dirty){ dirty=false; P.lookLoadSaved(); if(P.bubble) P.bubble.loadSaved(); } if(P.lookDraftEl===pg) P.lookDraftEl=null; if(win._ctPaint) win._ctPaint(); },800); }
function thShrink(fl,max){ return new Promise(function(res,rej){ var rd=new FileReader(); rd.onerror=rej; rd.onload=function(){ var im=new Image(); im.onerror=rej; im.onload=function(){ var k=Math.min(1,max/Math.max(im.width,im.height)), c=document.createElement('canvas'); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k); c.getContext('2d').drawImage(im,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',.88)); }; im.src=rd.result; }; rd.readAsDataURL(fl); }); }
function themeSetup(win){
  P.markAv&&P.markAv();
  P.net.get('/heartbeat/admin/chat-settings').then(function(r2){ var c=(r2&&r2.data&&r2.data.cfg)||{}; if(P.names&&(c.user_name||c.ai_name)) P.names.set({me:c.user_name,ai:c.ai_name}); [['me','user_name','用'],['ai','ai_name','助']].forEach(function(x){ var b=win.querySelector('[data-nm="'+x[0]+'"]'), av=win.querySelector('[data-av="'+x[0]+'"]'); if(b&&c[x[1]]){ var nv=String(c[x[1]]).trim(); b.textContent=nv; if(av) av.setAttribute('data-l',Array.from(nv)[0]||x[2]); } }); },function(){});
  /* [位置:phone-pages.js·themeSetup wire] [主题页行点击] [字体两行走 P.chatFontSheet；聊天外观与皮肤走 themePageOpen] [注释时间 2026-11-23] */
  wire($('.pg',win),{toggle:function(t,on){ toast(on?'震动开了':'震动关了'); },go:function(k,t){
    if(k==='cfcn'||k==='cfen'){ P.chatFontSheet(win,k==='cfcn'?'cn':'en'); }
    else if(k==='chatlook'){ themePageOpen(win,THEMES[0]); }
  }});
  /* [位置:phone-pages.js·themeSetup 字号落盘] [字号步进] [字号（全局）的 +/− 由公共 wire 画数字，落盘在这里接；气泡编辑挪进主题子页后 lookSetup 只挂子页，不再管主题页本体的字号] [注释时间 2026-10-31 三轮] */
  win.addEventListener('click',function(e){ if(!e.target.closest('.th-fs .pg-st button')) return; setTimeout(function(){ P.lookPut({fs:+win.querySelector('.th-fs .pg-st input').value}); },0); });
  win.addEventListener('pg-st-change',function(){ P.lookPut({fs:+win.querySelector('.th-fs .pg-st input').value}); });   /* [位置:phone-pages.js·themeSetup·pg-st-change] [字号手输直接落盘] [数量器直接输入后 blur 提交走这里；lookPut 幂等] [注释时间 2026-11-07] */
  /* [位置:phone-pages.js·themeSetup] [外观三档：跟随时间 / 白天 / 夜晚] [点档位 → P.appear.set，立刻换色] [注释时间 2026-10-22] */
  $('.th-ap',win).addEventListener('click',function(e){ var b=e.target.closest('[data-seg]'); if(!b) return; P.appear.set(P.appear.LIST[+b.dataset.seg][0]); buzz(8); });
  /* [位置:phone-pages.js·themeSetup 整体布局切换] [小手机布局 / 极简布局解耦 + 丝滑加载过渡 + 切完回到主题页] [2026-11-23] */
  var lyGrid=$('.th-grid',win);
  if(lyGrid) lyGrid.addEventListener('click',function(e){
    var b=e.target.closest('.th-card[data-ly]'); if(!b) return;
    var id=b.dataset.ly, cur=P.appLayout?P.appLayout.get():'phone';
    if(id===cur){ buzz(4); return; }
    Array.prototype.forEach.call(this.children,function(x){ x.classList.toggle('on',x===b); });
    buzz(8);
    var mask=document.createElement('div');
    mask.className='ly-mask';
    mask.innerHTML='<div class="ly-sp"></div><span>正在切换到'+(id==='min'?'极简布局':'小手机布局')+'…</span>';
    document.body.appendChild(mask);
    requestAnimationFrame(function(){ mask.classList.add('show'); });
    try{ sessionStorage.setItem('ph_hot_reload',JSON.stringify({at:Date.now(),unlocked:true,app:'theme'})); }catch(er){}
    if(P.appLayout) P.appLayout.set(id);
    setTimeout(function(){ location.reload(); },260);
  });
  /* [位置:phone-pages.js·themeSetup 默认聊天风格] [气泡 / 极简纯聊天页风格，不改整体布局也不刷新] [2026-11-23] */
  var csSeg=$('.th-cstyle',win);
  if(csSeg) csSeg.addEventListener('click',function(e){
    var b=e.target.closest('[data-seg]'); if(!b) return;
    var v=(+b.dataset.seg)===1?'min':'bubble';
    if(P.chatStyle) P.chatStyle.set(v);
    buzz(8);
    toast('默认聊天风格已切为'+(v==='min'?'极简':'气泡')+' · 新打开聊天生效');
  });
  /* [位置:phone-pages.js·themeSetup·th-ct] [自定义主题区块事件] [点「＋ 存当前配置」走 cthemeSaveFlow（快照取已保存值）；点行整套恢复（cthemeApply，草稿子页开着在里面拦）；长按 480ms 出改名/删除菜单（hold 与 presetPage 同款，CTJ 时间戳防长按后那次 click 误触发恢复）；子页关闭时由 themePageOpen 的收尾定时器调 win._ctPaint 重画（快照/恢复都在子页里发生，回来列表要是最新的）] [注释时间 2026-11-14] */
  var ctb=$('.th-ct',win);
  if(ctb){ var CTJ=0;
    win._ctPaint=function(){ if(ctb.isConnected) ctb.innerHTML=cthemeRowsHTML(); };
    hold(ctb,function(row){ CTJ=Date.now(); var e=cthemeById(row.getAttribute('data-ct')); if(!e) return; buzz([10,30,10]); cthemeMenu(win,e); },'.th-ct-row');
    ctb.addEventListener('click',function(e){ if(Date.now()-CTJ<450) return;   /* 长按刚弹了菜单，紧接着的 click 不当恢复 */
      var add=e.target.closest('[data-ctadd]');
      if(add){ if(lookDrafting()){ toast('子页还在调，先保存或放弃那边的修改'); return; } buzz(6); cthemeSaveFlow(win,cthemeCapture(false)); return; }
      var row=e.target.closest('[data-ct]'); if(!row) return; buzz(6); cthemeApply(win,row.getAttribute('data-ct')); }); }
  $('.th-us',win).addEventListener('click',function(e){ var a=e.target.closest('[data-av]'), n=e.target.closest('[data-nm]');
    if(a){ var key=a.dataset.av; buzz(6); sheet(win,key==='me'?'我的头像':'他的头像','<div class="th-avbig"><div class="av '+key+'"></div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn tap" data-pk="lib">从相册选</button><button class="pg-btn tap" data-pk="cam">拍一张</button></div>',function(s,close){ P.markAv&&P.markAv();
        s.addEventListener('click',function(e){ var b=e.target.closest('[data-pk]'); if(!b) return; var f=document.createElement('input'); f.type='file'; f.accept='image/*'; if(b.dataset.pk==='cam') f.setAttribute('capture','user');
          f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl) return; b.classList.add('busy');
            thShrink(fl,512).then(function(du){ return P.net.post('/v1/upload-image',{data:du}); }).then(function(r2){ if(!r2||!r2.url) throw new Error('没传上'); var u=String(r2.url).replace(/^https?:\/\/[^/]+/,''), pt={}; pt[key==='me'?'user_avatar':'ai_avatar']=u;
              return P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:pt}}).then(function(){ document.documentElement.style.setProperty('--av-'+key,'url("'+u+'")'); P.markAv&&P.markAv(); close(); toast('头像换好了'); buzz([8,30,8]); }); })
              .catch(function(e2){ b.classList.remove('busy'); toast('没换成'+(e2&&e2.message?'：'+String(e2.message).slice(0,30):'')); buzz([20,30,20]); }); }; f.click(); }); }); }
    if(n){ buzz(6); sheet(win,'改名字','<input class="pg-in" value="'+esc(n.textContent)+'">'+'<div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn pri tap" data-ok>好</button></div>',function(s,close){ s.querySelector('[data-ok]').addEventListener('click',function(){ var v=s.querySelector('input').value.trim(); if(!v){ buzz([20,30,20]); return; } var isMe=n.dataset.nm==='me', pt={}; pt[isMe?'user_name':'ai_name']=v;
        P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:pt}}).then(function(){ n.textContent=v; var av=win.querySelector('[data-av="'+(isMe?'me':'ai')+'"]'); if(av) av.setAttribute('data-l',Array.from(v)[0]||(isMe?'用':'助')); if(P.names) P.names.set(pt); close(); toast('名字改好了'); buzz(8); },function(){ toast('没改成'); buzz([20,30,20]); }); }); }); }
  });
}
P.register('theme',{html:themeHTML,setup:themeSetup});

/* ---------- 设置：推送 / 天气（真数据：GET /admin/env；保存 POST /admin/save，整表单接口，只带要改的几项 + 必填的 target_url / model_name，热生效） ----------
   网页推送照 chat.html：Notification.requestPermission() → serviceWorker /sw.js → pushManager.subscribe（VAPID 公钥 /v1/push/vapid-public-key）→ POST /v1/push/subscribe。
   桌面图标（也是推送图标）：POST /v1/set-app-icon（192 / 512 两张 PNG）。天气地点搜索用 open-meteo 的公开地理接口。 */
function setBodyHTML(noDesk){
  return grp('推送',['<div class="pg-r st-wp" id="stWp"><span class="rt"><b>网页推送</b><small>他的消息 · 没送到自动改走 Bark</small></span><button class="pg-btn tap wp-b" type="button">开启</button></div>',
    '<div class="pg-r"><span class="rt"><b>他的消息走</b></span>'+seg(['Bark','网页推送'],0).replace('class="pg-seg"','class="pg-seg th-seg st-pv" style="--n:2;width:170px"')+'</div>',
    '<div class="pg-r col"><span class="rt"><b>Bark Key</b></span><input class="pg-in mono st-bk" style="margin-top:8px" placeholder="https://api.day.app/ 后面那串"></div>','<div class="pg-r"><span class="rt"><b>测试推送</b><small>存好 Key 后先试一条</small></span><button class="pg-btn tap" type="button" data-run="tp" style="height:32px;padding:0 14px;font-size:12.5px;opacity:.85">发条测试</button></div>'],null,0)+
  (noDesk?'':grp('桌面',[r({t:'桌面图标',v:'换一张',go:'icon'})],null,1))+
  /* [位置:phone-pages.js·setHTML 天气组] [示例值清干净+经纬度行可点] [11-16 批3 K1/K2：地点/经纬度不再写死「东莞」「23.02, 113.75」，初始「没设」「—」，拉不到就停在这两个值；经纬度行改可点，弹层与地点行同一个（现成的 用现在的位置 + open-meteo 城市搜索，选完两行一起更新）] [注释时间 2026-11-16] */
  grp('天气',[r({t:'启用天气',tg:1,on:1,tgname:'wx'}),r({t:'地点',v:'没设',go:'city'}),r({t:'经纬度',v:'—',go:'city',cls:'st-ll'}),'<div class="pg-r"><span class="rt"><b>单位</b></span>'+seg(['℃','℉'],0).replace('class="pg-seg"','class="pg-seg th-seg st-un" style="--n:2;width:120px"')+'</div>'],null,1)+
  grp('网络',[r({t:'火种 VPN',v:'<i class="net-wait"></i>',go:'hz'}),r({t:'机场订阅',v:'<i class="net-wait"></i>',go:'ap'})],null,1)+
  '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-ssv>保存</button></div>';
}
function setHTML(){
  if(P.minLayout&&P.minLayout.on) return P.minLayout.minSetHTML();
  return G.shell('设置','',setBodyHTML(false));
}
function wpPaint(win){ var row=$('#stWp',win); if(!row) return; var b=row.querySelector('.wp-b'), sm=row.querySelector('small'), ok=('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);
  b.classList.remove('on'); b.disabled=false; delete b.dataset.perm;
  if(!ok){ b.textContent='用不了'; b.disabled=true; sm.textContent='要 iOS 16.4 以上，从主屏幕图标打开'; return; }
  var pm=Notification.permission;
  if(pm==='granted'){ b.textContent='已开启'; b.classList.add('on'); sm.textContent='他的消息 · 没送到自动改走 Bark'; }
  /* [位置:phone-pages.js·wpPaint denied] [「被拒绝了」不再做成看着能点的胶囊] [11-13：状态文案换成明确的「去开启」按钮，点了给手指路；原来 disabled 的胶囊既不可点又像按钮] [注释时间 2026-11-13] */
  else if(pm==='denied'){ b.textContent='去开启'; b.disabled=false; b.dataset.perm='1'; sm.textContent='去 iOS 设置 → 通知 里打开'; }
  else { b.textContent='开启'; sm.textContent='他的消息 · 没送到自动改走 Bark'; }
}
function u8(b64){ var pad='='.repeat((4-b64.length%4)%4), raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/')), out=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
/* [位置:phone-pages.js·netSetup] [设置页「网络」分组] [火种 VPN 登录 / 机场订阅导入的入口：状态读 /admin/network/status，点开底部弹层操作；token 和订阅链接只在输入框里短暂存在，不存本机] [注释时间 2026-10-21；注：phone-set.js 里也注册了 'set' 页，但被本文件后注册的覆盖，网络分组只能加在这里] */
function netSetup(win){
  var NET='/heartbeat/admin/network', cur=null, failed=false;
  function hzText(h){ if(!h) return '读不到'; if(!h.container) return '容器没跑'; if(!h.logged_in) return '未登录'; if(h.connected&&h.egress_ok) return '已连接'; if(h.connected) return '线路异常'; return '已断开'; }
  function apText(a){ if(!a) return '读不到'; if(!a.configured) return '未导入'; if(!a.running) return '没在跑'; return a.nodes!=null?a.nodes+' 个节点':'已导入'; }
  function setV(k,v){ var e=win.querySelector('[data-go="'+k+'"] .rv'); if(e) e.innerHTML=v; }
  /* [位置:phone-pages.js·netSetup paint] [网络两行不再静态写「读取中…」] [11-13：慢网时两行一直四个字，看不出是卡住还是没配置；未返回时只给一个呼吸小点，失败时行内直接「读不到 · 重试」，不必进子页] [注释时间 2026-11-13] */
  function paint(){ if(!cur){ setV('hz','<i class="net-wait"></i>'); setV('ap','<i class="net-wait"></i>'); return; }
    if(failed){ setV('hz','<button class="net-retry tap" type="button" data-netretry="1">读不到 · 重试</button>'); setV('ap','<button class="net-retry tap" type="button" data-netretry="1">读不到 · 重试</button>'); return; }
    setV('hz',hzText(cur.hz)); setV('ap',apText(cur.airport)); }
  function load(){ return P.net.get(NET+'/status',{noLogin:true}).then(function(r){ failed=false; cur=r; paint(); return r; },function(){ failed=true; cur=null; paint(); return cur; }); }
  win.addEventListener('click',function(e){ if(e.target.closest('[data-netretry]')){ e.preventDefault(); e.stopPropagation(); failed=false; cur=null; paint(); load(); } },true);
  function stLine(box){ var el=box.querySelector('.nt-st'); return function(t,bad){ el.textContent=t; el.style.color=bad?'#d5738c':''; }; }
  function hz(){
    var h=(cur&&cur.hz)||null, line=h?(hzText(h)+(h.connected&&h.egress_ip?' · '+h.egress_ip:'')):'读取中…';
    sheet(win,'火种 VPN','<div class="pg-g"><div class="pg-r"><span class="rt"><b class="nt-st">'+esc(line)+'</b></span></div>'+
      '<div class="pg-r col nt-lg" style="display:none"><a class="pg-btn tap nt-lk" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">打开登录页</a><input class="pg-in mono nt-in" style="margin-top:8px" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴登录 token"></div></div>'+
      '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-nt="go">'+(h&&h.logged_in?'重新登录':'登录')+'</button>'+(h&&h.logged_in?'<button class="pg-btn tap" type="button" data-nt="rc">重连</button>':'')+'</div>',function(box,close){
      var say=stLine(box), lg=box.querySelector('.nt-lg'), go=box.querySelector('[data-nt=go]'), rc=box.querySelector('[data-nt=rc]'), inp=box.querySelector('.nt-in'), lk=box.querySelector('.nt-lk'), mode='start', busy=false;
      /* [位置:phone-pages.js·netSetup hz 迟到状态] [弹层先弹后读到] [弹层打开时 status 可能还没回来（docker inspect+exec 要几秒），原来把空对象当「容器没跑」误导；先显示读取中，读到且弹层还开着就刷新状态行] [注释时间 2026-11-21] */
      if(!cur) load().then(function(){ if(!document.contains(box)||!cur||!cur.hz) return; var h2=cur.hz; say(hzText(h2)+(h2.connected&&h2.egress_ip?' · '+h2.egress_ip:'')); });
      function done(r){ busy=false; load(); if(r&&r.ok&&r.connected){ buzz([8,30,8]); toast('线路通了'); close(); } else { go.textContent=mode==='submit'?'提交':'登录'; say((r&&r.error)||'没成功',true); } }
      go.addEventListener('click',function(){
        if(busy) return;
        if(mode==='start'){ busy=true; go.textContent='取链接…';
          P.net.post(NET+'/hz/login/start',{},{noLogin:true}).then(function(r){ busy=false;
            if(!r||!r.ok){ go.textContent='登录'; say((r&&r.error)||'没拿到登录链接',true); return; }
            lk.href=r.url; lg.style.display=''; mode='submit'; go.textContent='提交'; say('登录后把 token 贴在下面'); },function(e){ busy=false; go.textContent='登录'; say('没连上后台：'+((e&&e.message)||''),true); });
          return; }
        var tk=inp.value.trim(); if(!tk){ buzz([12,30,12]); return; }
        busy=true; go.textContent='连接中…'; say('正在登录并连线路，约半分钟');
        P.net.post(NET+'/hz/login/token',{token:tk},{noLogin:true}).then(done,function(e){ done({error:'没连上后台：'+((e&&e.message)||'')}); });
      });
      if(rc) rc.addEventListener('click',function(){ if(busy) return; busy=true; rc.textContent='重连中…'; say('正在重连');
        P.net.post(NET+'/hz/reconnect',{},{noLogin:true}).then(function(r){ rc.textContent='重连'; done(r); },function(e){ rc.textContent='重连'; done({error:'没连上后台：'+((e&&e.message)||'')}); }); });
    });
  }
  function ap(){
    var a=(cur&&cur.airport)||null, line=a?(a.configured?((a.host||'已导入')+(a.nodes!=null?' · '+a.nodes+' 个节点':'')):(a.running?'还没导入订阅（现在用手写的节点）':'还没导入')):'读取中…';
    sheet(win,'机场订阅','<div class="pg-g"><div class="pg-r"><span class="rt"><b class="nt-st">'+esc(line)+'</b></span></div>'+
      '<div class="pg-r col"><input class="pg-in mono nt-in" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴订阅链接"></div></div>'+
      '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-nt="im">导入</button></div>',function(box,close){
      var say=stLine(box), inp=box.querySelector('.nt-in'), im=box.querySelector('[data-nt=im]'), busy=false;
      /* [位置:phone-pages.js·netSetup ap 迟到状态] [同 hz：弹层打开时 status 没到先显示读取中，到了且弹层还开着就刷新] [注释时间 2026-11-21] */
      if(!cur) load().then(function(){ if(!document.contains(box)||!cur||!cur.airport) return; var a2=cur.airport; say(a2.configured?((a2.host||'已导入')+(a2.nodes!=null?' · '+a2.nodes+' 个节点':'')):(a2.running?'还没导入订阅（现在用手写的节点）':'还没导入')); });
      im.addEventListener('click',function(){
        if(busy) return; var u=inp.value.trim(); if(!u){ buzz([12,30,12]); return; }
        busy=true; im.textContent='导入中…'; say('正在下载节点并测试，最多半分钟');
        P.net.post(NET+'/airport/import',{url:u},{noLogin:true}).then(function(r){ busy=false; im.textContent='导入'; load();
          if(r&&r.ok){ inp.value=''; buzz([8,30,8]); toast('导入好了'+(r.nodes!=null?'：'+r.nodes+' 个节点':'')); close(); } else say((r&&r.error)||'没导进去',true); },
          function(e){ busy=false; im.textContent='导入'; say('没连上后台：'+((e&&e.message)||''),true); });
      });
    });
  }
  load();
  return {hz:hz,ap:ap};
}
function setSetup(win){
  var AB='/heartbeat/admin/', ENV=null, W={on:true,name:'',lat:'',lon:'',un:'metric'};
  function segSet(el,k){ if(!el) return; el.style.setProperty('--k',k); [].forEach.call(el.querySelectorAll('button'),function(x,i){ x.classList.toggle('on',i===k); }); }
  function segGet(el){ return +getComputedStyle(el).getPropertyValue('--k')||0; }
  function sid(){ return P.net.get(AB+'current-session').then(function(r){ return (r&&r.session)||'default'; },function(){ return 'default'; }); }
  /* 网页推送：同意 → 订阅 → 上报（已授权的话每次打开顺手重新上报一次，刷新会话绑定） */
  function subscribe(){ return navigator.serviceWorker.register('/sw.js').then(function(){ return navigator.serviceWorker.ready; }).then(function(reg){ return reg.pushManager.getSubscription().then(function(s){ if(s) return s;
      return P.net.get('/v1/push/vapid-public-key').then(function(k){ if(!k||!k.publicKey) throw new Error('服务器没配 VAPID 公钥'); return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(k.publicKey)}); }); }); })
    .then(function(s){ return sid().then(function(id){ return P.net.post('/v1/push/subscribe',{session_id:id,subscription:s.toJSON()}); }); }); }
  var NS=netSetup(win);
  wpPaint(win);
  $('#stWp .wp-b',win).addEventListener('click',function(){ var b=this; if(b.disabled) return; if(b.dataset.perm){ buzz(6); toast('去 iOS 设置 → 通知 → 找到小手机，把通知打开'); return; } buzz(6); b.innerHTML='<i class="pg-spin"></i>';
    var p; try{ p=Notification.requestPermission(); }catch(e){ p=null; }
    Promise.resolve(p).then(function(r2){ if(r2!=='granted'){ wpPaint(win); if(r2==='denied') buzz([20,40,20]); return; }
      return subscribe().then(function(){ wpPaint(win); toast('网页推送开好了'); buzz([8,30,8]); }); }).catch(function(e){ wpPaint(win); toast('开启失败：'+String((e&&e.message)||e).slice(0,40)); }); });
  try{ if(window.Notification&&Notification.permission==='granted') subscribe().catch(function(){}); }catch(e){}
  /* 读现在的配置 */
  P.net.get(AB+'env').then(function(r2){ ENV=(r2&&r2.env)||null; if(!ENV) return; var w=r2.weather||{};
    segSet($('.st-pv',win),ENV.PUSH_PROVIDER==='webpush'?1:0);
    var bk=$('.st-bk',win); bk.value=''; bk.placeholder=ENV.BARK_KEY_SET?'已设置 · 留空不改':'https://api.day.app/ 后面那串';
    W.on=String(w.enabled)==='true'; W.name=w.locationName||''; W.lat=w.lat||''; W.lon=w.lon||''; W.un=w.units||'metric';
    var tg=$('[data-tg="wx"]',win); if(tg){ tg.classList.toggle('on',W.on); var sw=tg.querySelector('.pg-sw'); if(sw) sw.setAttribute('aria-checked',W.on?'true':'false'); }
    $('[data-go="city"] .rv',win).textContent=W.name||'没设'; $('.st-ll .rv',win).textContent=W.lat&&W.lon?(+W.lat).toFixed(2)+', '+(+W.lon).toFixed(2):'—'; segSet($('.st-un',win),W.un==='fahrenheit'?1:0);
    var icRow=$('[data-go="icon"] .rv',win); if(icRow) icRow.textContent=''; },function(){ if(P.net.offline) P.net.offline(); });
  $('[data-ssv]',win).addEventListener('click',function(){ var b=this;
    if(!ENV){ toast('没连上后台，没存'); buzz([20,30,20]); return; } if(!ENV.TARGET_API_URL||!ENV.MODEL_NAME){ toast('读不到后台配置'); return; }
    var body={target_url:ENV.TARGET_API_URL,model_name:ENV.MODEL_NAME,push_provider:segGet($('.st-pv',win))?'webpush':'bark',weather_enabled:$('[data-tg="wx"]',win).classList.contains('on'),weather_units:segGet($('.st-un',win))?'fahrenheit':'metric'};
    var bk=$('.st-bk',win).value.trim().replace(/^https?:\/\/api\.day\.app\//,'').replace(/\/.*$/,''); if(bk) body.bark_key=bk;
    if(W.name) body.weather_location_name=W.name; if(W.lat!=='') body.weather_lat=String(W.lat); if(W.lon!=='') body.weather_lon=String(W.lon);
    if(!bgo(b)) return;
    P.net.post(AB+'save',body).then(function(){ bend(b,true); ENV.PUSH_PROVIDER=body.push_provider; if(bk){ ENV.BARK_KEY_SET=true; $('.st-bk',win).value=''; $('.st-bk',win).placeholder='已设置 · 留空不改'; } toast('存好了'); buzz([8,30,8]); },function(){ bend(b,false); toast('没存上'); buzz([20,30,20]); }); });
  /* 测试推送 */
  var pgRoot=win.classList.contains('pg')?win:$('.pg',win);
  if(pgRoot) pgRoot.addEventListener('click',function(e){ var b=e.target.closest('[data-run="tp"]'); if(!b) return; e.stopImmediatePropagation(); if(!ENV){ toast('没连上后台，没推'); return; } buzz(6);
    (function(){ var id='s_pushtest_'+Date.now().toString(36); return Promise.resolve(id); })().then(function(id){ return P.net.post('/v1/notify/reply-done',{preview:'这是一条测试推送 ✦',session_id:id}); }).then(function(r2){ toast(r2&&r2.ok?'推出去了'+(r2.providerLabel?' · '+r2.providerLabel:''):'没推出去'+(r2&&r2.reason?'：'+r2.reason:'')); buzz(r2&&r2.ok?[8,30,8]:[20,40,20]); },function(){ toast('没推出去'); }); },true);
  /* [位置:phone-pages.js·setIcon] [桌面图标·先预览再换] [11-16 批3 K3：以前选完图直接就传了；现在先弹预览（正方形居中裁切后的样子），可重选，点确认才上传；出 192/512 两张 PNG 的裁切与接口不变] [注释时间 2026-11-16] */
  function setIcon(){ var f=document.createElement('input'); f.type='file'; f.accept='image/*'; f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl) return; var rd=new FileReader(); rd.onload=function(){ var im=new Image(); im.onload=function(){
      function out(n){ var c=document.createElement('canvas'); c.width=c.height=n; var x=c.getContext('2d'), s=Math.min(im.width,im.height); x.drawImage(im,(im.width-s)/2,(im.height-s)/2,s,s,0,0,n,n); return c.toDataURL('image/png'); }
      var p192=out(192), p512=out(512);
      sheet(win,'换成这个图标？','<div style="display:flex;justify-content:center;padding:6px 0 2px"><img src="'+p192+'" alt="图标预览" style="width:132px;height:132px;border-radius:28px;display:block;box-shadow:0 8px 24px rgba(0,0,0,.18)"></div><div class="pg-ft" style="text-align:center">桌面上会显示成这样（正方形居中裁切）</div><div class="pg-bts" style="padding:12px 0 0"><button class="pg-btn tap" type="button" data-ik="re">重选</button><button class="pg-btn pri tap" type="button" data-ik="ok">确认更换</button></div>',function(s,close){
        s.addEventListener('click',function(e){
          var b=e.target.closest('[data-ik]'); if(!b) return;
          if(b.getAttribute('data-ik')==='re'){ close(); setTimeout(setIcon,350); return; }
          if(!ENV){ toast('没连上后台，没换'); return; }
          if(!bgo(b)) return; toast('上传中…');
          P.net.post('/v1/set-app-icon',{icon192:p192,icon512:p512}).then(function(){ bend(b,true); close(); toast('桌面图标换好了 · iOS 要删掉主屏图标重新添加才看得到'); buzz([8,30,8]); },function(){ bend(b,false); toast('没换成'); buzz([20,30,20]); }); }); }); }; im.src=rd.result; }; rd.readAsDataURL(fl); }; f.click(); }
  wire(pgRoot||win,{go:function(k,t){
    if(k==='hz'){ NS.hz(); return; }
    if(k==='ap'){ NS.ap(); return; }
    if(k==='icon'){ setIcon(); return; }
    if(k==='city') sheet(win,'地点','<div class="pg-search">'+I.find+'<input class="pg-in" id="ctQ" placeholder="搜城市" value="'+esc(W.name)+'"></div><div class="pg-g" id="ctL">'+r({t:'用现在的位置',act:'here',right:'<span class="ri" style="--c:none">'+X.pin+'</span>'})+'</div>',function(s,close){
      var L2=s.querySelector('#ctL'), q=s.querySelector('#ctQ'), tm=0, res=[], seq=0;
      function pick(n,la,lo){ W.name=n; W.lat=la; W.lon=lo; t.querySelector('.rv').textContent=n; var ll=$('.st-ll .rv',win); if(ll) ll.textContent=(+la).toFixed(2)+', '+(+lo).toFixed(2); close(); toast('改成 '+n+' · 记得点保存'); buzz(6); }
      /* [位置:phone-pages.js·city srch] [旧响应不覆盖新结果] [2026-10-27 审查：无序号时网络抖动会让先发的旧响应
         后到，列表与坐标变成不是最后一次搜索的；catch 也从静默改成提示] [注释时间 2026-10-27] */
      function srch(){ var v=q.value.trim(); if(!v){ return; } var my=++seq; fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=zh&format=json&name='+encodeURIComponent(v)).then(function(x){ return x.json(); }).then(function(j){ if(my!==seq) return; res=(j&&j.results)||[];
          L2.innerHTML=r({t:'用现在的位置',act:'here',right:'<span class="ri" style="--c:none">'+X.pin+'</span>'})+res.map(function(c,j2){ return r({t:esc(c.name),s:esc([c.admin1,c.country].filter(Boolean).join(' · ')),act:'c'+j2}); }).join(''); }).catch(function(){ if(my===seq) toast('城市没搜到，稍后再试'); }); }
      q.addEventListener('input',function(){ clearTimeout(tm); tm=setTimeout(srch,350); }); if(q.value) srch();
      s.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; buzz(6); var a=x.dataset.act;
        if(a==='here'){ if(!navigator.geolocation){ toast('拿不到位置'); return; } navigator.geolocation.getCurrentPosition(function(p){ pick('当前位置',p.coords.latitude.toFixed(4),p.coords.longitude.toFixed(4)); },function(){ toast('没给定位权限'); },{timeout:8000}); return; }
        var c=res[+a.slice(1)]; if(c) pick(c.name,c.latitude,c.longitude); }); });
  }});
}
P.pages.mountSet=function(w){ setSetup(w); };
P.pages.setBodyHTML=function(noDesk){ return setBodyHTML(noDesk); };
P.register('set',{html:setHTML,setup:function(w){
  if(P.minLayout&&P.minLayout.on){ P.minLayout.minSetSetup(w); return; }
  setSetup(w); P.pages.search(w,'搜设置项');
}});


/* ---------- 下拉通知中心：他的推送 + 后台提醒，分两组；点开看全文，左滑删掉，一键清空 ---------- */
(function(){
  var nc=document.getElementById('nc'); if(!nc) return;
  /* [位置:phone-pages.js·通知中心] [演示通知已删（2026-10-22）] [还没有真正的通知来源，先如实显示「没有新通知」；以后接真时往 NS（他的推送）/ SYS（后台提醒）里放] [注释时间 2026-10-22] */
  var NS=[], SYS=[];
  function card(n,i,kind){ return '<div class="nc-c glass" data-k="'+kind+'" data-i="'+i+'">'+(kind==='ai'?'<div class="av ai" data-l="谢"></div>':'<span class="nc-ic '+n[0]+'">'+(n[0]==='warn'?X.shield:X.cpu)+'</span>')+'<div class="bd"><div class="t"><b>'+esc(n[1])+'</b><small>'+n[3]+'</small></div><p>'+esc(n[2])+'</p></div></div>'; }
  function paint(){ nc.innerHTML='<div class="nc-hd"><h3>通知</h3><button class="nc-clr tap" type="button">清空</button></div>'+
    (NS.length?'<div class="nc-gt">他</div>'+NS.map(function(n,i){ return card(n,i,'ai'); }).join(''):'')+
    (SYS.length?'<div class="nc-gt">后台</div>'+SYS.map(function(n,i){ return card(n,i,'sys'); }).join(''):'')+
    (!NS.length&&!SYS.length?'<div class="pg-empty" style="color:var(--ink2)">没有新通知</div>':'')+'<div class="grab"></div>'; P.markAv&&P.markAv(); }
  paint();
  nc.addEventListener('click',function(e){
    if(e.target.closest('.nc-clr')){ e.stopPropagation(); Array.prototype.forEach.call(nc.querySelectorAll('.nc-c'),function(c,i){ setTimeout(function(){ c.classList.add('gone'); },i*50); }); setTimeout(function(){ NS=[]; SYS=[]; paint(); },420); buzz([8,30,8]); return; }
    var c=e.target.closest('.nc-c'); if(c){ e.stopPropagation(); c.classList.toggle('open'); buzz(5); }
  },true);
  var sx=0, cc=null;
  nc.addEventListener('pointerdown',function(e){ cc=e.target.closest('.nc-c'); sx=e.clientX; },true);
  nc.addEventListener('pointerup',function(e){ if(cc&&sx-e.clientX>60){ var k=cc.dataset.k, i=+cc.dataset.i; cc.classList.add('gone'); setTimeout(function(){ (k==='ai'?NS:SYS).splice(i,1); paint(); },320); buzz(6); } cc=null; },true);
})();
})();
