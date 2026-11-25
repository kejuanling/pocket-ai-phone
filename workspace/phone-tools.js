/* 小手机 · 后台工具箱：把原来后台的 9 个折叠项做成卡片 → 点开展开成全屏小页面 */
(function(){
"use strict";
var P=window.PH, D=P.D, $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast, anim=P.anim, rectIn=P.rectIn;
var SP='cubic-bezier(.2,.9,.25,1)';
var IC={
  alert:'<svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
  log:'<svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h10M4 15h16M4 20h8"/></svg>',
  push:'<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M10.3 21a2 2 0 0 0 3.4 0"/></svg>',
  ctx:'<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/></svg>',
  cross:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="13" height="13" rx="3"/><path d="M8 20h10a3 3 0 0 0 3-3V9"/></svg>',
  pin:'<svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg>',
  star:'<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  swap:'<svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  save:'<svg viewBox="0 0 24 24"><path d="M5 3h12l4 4v14H5zM8 3v6h8M8 21v-7h8v7"/></svg>',
  back:'<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  grip:'<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  lock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  ok:'<svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>'
};
function stag(root,sel){ Array.prototype.forEach.call(root.querySelectorAll(sel||'.tl-r'),function(e,i){ e.style.setProperty('--i',i); e.classList.add('rise'); }); }
function collapse(el,done){ el.style.transition='opacity .3s,transform .4s '+SP; var h=el.offsetHeight; el.style.height=h+'px'; el.style.overflow='hidden'; void el.offsetHeight;
  el.style.transition='opacity .3s,transform .4s '+SP+',height .4s '+SP+' .1s,margin .4s '+SP+' .1s,padding .4s '+SP+' .1s'; el.style.opacity='0'; el.style.transform='translateX(-30px)'; el.style.height='0'; el.style.marginTop='0'; el.style.paddingTop='0'; el.style.paddingBottom='0'; setTimeout(function(){ el.remove(); done&&done(); },520); }
function ring(pct,col,sz){ var r=sz/2-6, C=2*Math.PI*r; return '<svg viewBox="0 0 '+sz+' '+sz+'" class="tl-rg" style="width:'+sz+'px;height:'+sz+'px"><circle cx="'+sz/2+'" cy="'+sz/2+'" r="'+r+'"/><circle class="fg" cx="'+sz/2+'" cy="'+sz/2+'" r="'+r+'" style="stroke:'+col+';stroke-dasharray:'+C+';stroke-dashoffset:'+C+'" data-to="'+C*(1-pct/100)+'"/></svg>'; }
function fillRings(root){ requestAnimationFrame(function(){ requestAnimationFrame(function(){ Array.prototype.forEach.call(root.querySelectorAll('.fg[data-to]'),function(c){ c.style.strokeDashoffset=c.getAttribute('data-to'); }); }); }); }

/* ================= 工具定义 ================= */
var T={};

/* 1 后台提醒 */
T.alert={ n:'后台提醒', s:'网易云 · 容量 · 服务 · 哨兵', i:'alert', tint:'a',
  chip:function(){ return '—'; },
  html:function(){ return '<div class="tl-bn tl-r" id="alBn"><span class="d"></span><div><b>有 1 项需要留意</b><small>邮件服务响应偏慢</small></div><button class="tap" id="alOk">知道了</button></div>'+
    '<div class="tl-g2">'+
    '<div class="tl-c tl-r"><div class="hd">网易云 <em class="ok">有效</em></div><div class="big">12<small>天后过期</small></div><div class="bar"><i style="--w:60%"></i></div></div>'+
    '<div class="tl-c tl-r"><div class="hd">磁盘容量 <em class="ok">充足</em></div><div class="rgw">'+ring(68,'var(--acc)',84)+'<b>68%</b></div><div class="sub">41 GB / 60 GB</div></div>'+
    '<div class="tl-c tl-r"><div class="hd">服务状态 <em class="warn">1 慢</em></div><div class="dots"><span class="ok"></span><span class="ok"></span><span class="ok"></span><span class="warn"></span></div><div class="sub">邮件 · 响应 2.4 秒</div></div>'+
    '<div class="tl-c tl-r"><div class="hd">安全哨兵 <em class="ok">安静</em></div><div class="radar"><i></i><b></b></div><div class="sub">24 小时 0 次异常</div></div></div>'; },
  setup:function(el){ fillRings(el); $('#alOk',el).addEventListener('click',function(){ var b=$('#alBn',el); b.classList.add('gone'); buzz(8); var chip=document.querySelector('[data-tool="alert"] .chip'); if(chip){ chip.textContent='一切安静'; chip.classList.add('calm'); } }); } };

/* 2 唤醒原始日志 */
var LOGS=[];   /* 演示数据已删（2026-10-22），联网后由真接口填 */
T.log={ n:'唤醒原始日志', s:'最近唤醒日志', i:'log', tint:'b', chip:function(){ return '—'; },
  html:function(){ return '<div class="tl-fl" id="lgFt"><button class="on" data-f="all">全部</button><button data-f="warn">警告</button><button data-f="err">错误</button><label class="lv tap"><i></i>实时</label></div><div class="tl-term" id="lgBox"></div>'; },
  setup:function(el){ var box=$('#lgBox',el), flt='all', live=false, iv=null, n=0;
    function line(l,fresh){ var d=document.createElement('div'); d.className='lg '+l[0]+(fresh?' in':''); var m=/^\[([^\]]+)\]\s*(.*)$/.exec(l[2]); d.innerHTML='<time>'+l[1]+'</time>'+(m?'<b class="tg">'+esc(m[1])+'</b><span>'+esc(m[2])+'</span>':'<span>'+esc(l[2])+'</span>'); return d; }
    function draw(){ box.innerHTML=''; LOGS.filter(function(l){ return flt==='all'||l[0]===flt; }).forEach(function(l,i){ var d=line(l); d.style.animationDelay=(i*55)+'ms'; d.classList.add('type'); box.appendChild(d); }); }
    draw();
    $('#lgFt',el).addEventListener('click',function(e){ var b=e.target.closest('button'); if(b){ flt=b.dataset.f; Array.prototype.forEach.call(b.parentNode.querySelectorAll('button'),function(x){ x.classList.toggle('on',x===b); }); draw(); buzz(5); return; }
      var lv=e.target.closest('.lv'); if(lv){ live=!live; lv.classList.toggle('on',live); buzz(6); clearInterval(iv); if(live) iv=setInterval(function(){ if(!el.isConnected){ clearInterval(iv); return; } var d=new Date(), t=('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)+':'+('0'+d.getSeconds()).slice(-2); n++; var l=['info',t,'[heartbeat] 心跳 #'+n+' 正常']; if(flt==='all'){ var ln=line(l,true); box.appendChild(ln); box.scrollTop=box.scrollHeight; } },1600); } });
    box.addEventListener('click',function(e){ var l=e.target.closest('.lg'); if(l){ l.classList.toggle('wrap'); buzz(4); } }); } };

/* 3 推送管理 */
var PUSH=[];   /* 演示数据已删（2026-10-22），联网后由真接口填 */
T.push={ n:'推送管理', s:'修改 · 删除推送记录', i:'push', tint:'p', chip:function(){ return PUSH.length+' 条'; },
  html:function(){ return '<div class="tl-hint tl-r">左滑删除 · 点一下修改</div><div id="pnL">'+PUSH.map(function(p,i){ return '<div class="pn tl-r" data-i="'+i+'"><div class="del"><button class="tap">'+IC.trash+'删除</button></div><div class="fg2"><span class="ic">'+IC.push+'</span><div class="bd"><b>'+esc(p.t)+'</b><small>'+p.w+' · Bark</small></div></div></div>'; }).join('')+'</div>'; },
  setup:function(el,win){ var L=$('#pnL',el);
    Array.prototype.forEach.call(L.querySelectorAll('.pn'),function(row){ var fg=row.querySelector('.fg2'), x=0, open=false;
      P.drag(fg,{ move:function(dx,dy,ax){ if(ax!=='x') return; x=Math.max(-96,Math.min(0,(open?-96:0)+dx)); fg.style.transition='none'; fg.style.transform='translateX('+x+'px)'; },
        end:function(dx,dy,dt,ax){ fg.style.transition='transform .4s '+SP; if(ax==='x'){ open=x<-44; fg.style.transform='translateX('+(open?-96:0)+'px)'; buzz(open?8:4); } else if(Math.abs(dx)<6&&Math.abs(dy)<6){ if(open){ open=false; fg.style.transform='none'; return; }
            var sh=P.sheet(win,{title:'修改推送',ph:'推送内容',btn:'保存',onSubmit:function(v){ fg.querySelector('b').textContent=v; toast('已修改'); buzz(8); }}); setTimeout(function(){ var ta=win.querySelector('.sheetw textarea'); if(ta) ta.value=fg.querySelector('b').textContent; },30); } } });
      row.querySelector('.del button').addEventListener('click',function(){ buzz(10); collapse(row,function(){ toast('已删除'); }); }); }); } };

/* 4 当前请求上下文 */
var LAYERS=[];   /* 演示数据已删（2026-10-22），联网后由真接口填 */
T.ctx={ n:'当前请求上下文', s:'只读，看实际发送了什么', i:'ctx', tint:'l', chip:function(){ return '—'; },
  html:function(){ var tot=LAYERS.reduce(function(a,l){ return a+l[1]; },0);
    return '<div class="tl-c tl-r"><div class="hd">本次请求 <em class="lk">'+IC.lock+'只读</em></div><div class="big">'+tot.toLocaleString()+'<small>tokens</small></div><div class="stk">'+LAYERS.map(function(l){ return '<i style="--w:'+(l[1]/tot*100)+'%;--c:'+l[2]+'"></i>'; }).join('')+'</div></div>'+
      LAYERS.map(function(l){ return '<div class="cx tl-r"><div class="top"><span class="sw" style="background:'+l[2]+'"></span><b>'+l[0]+'</b><em>'+l[1].toLocaleString()+'</em><svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></div><div class="bar"><i style="--w:'+(l[1]/tot*100*2.2)+'%;--c:'+l[2]+'"></i></div><div class="dt"><div><p>'+esc(l[3])+'</p></div></div></div>'; }).join(''); },
  setup:function(el){ el.addEventListener('click',function(e){ var c=e.target.closest('.cx'); if(c){ c.classList.toggle('open'); buzz(5); } }); } };

/* 5 跨窗口注入 */
var XW={};
T.cross={ n:'跨窗口注入', s:'他实际收到的记忆', i:'cross', tint:'b', chip:function(){ return '—'; },
  html:function(){ var ks=Object.keys(XW); return '<div class="tl-sg tl-r" id="xwSg" style="--n:4;--k:0"><i></i>'+ks.map(function(k,i){ return '<button class="'+(i?'':'on')+'" data-k="'+k+'">'+k+'</button>'; }).join('')+'</div><div class="tl-hint tl-r">总开关已开启 · 跨窗口会带上这些</div><div id="xwL"></div>'; },
  setup:function(el){ var L=$('#xwL',el), sg=$('#xwSg',el), cur='日记';
    function draw(){ L.innerHTML=XW[cur].map(function(t,i){ return '<div class="xi" style="--i:'+i+'"><span class="n">'+(i+1)+'</span>'+esc(t)+'</div>'; }).join(''); }
    draw(); sg.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; cur=b.dataset.k; var idx=Object.keys(XW).indexOf(cur); sg.style.setProperty('--k',idx); Array.prototype.forEach.call(sg.querySelectorAll('button'),function(x){ x.classList.toggle('on',x===b); }); draw(); buzz(5); }); } };

/* 6 永久注入上下文（拖动排序） */
var PIN=[];   /* 演示数据已删（2026-10-22），联网后由真接口填 */
T.pin={ n:'永久注入上下文', s:'固定注入 · 拖动排序', i:'pin', tint:'p', chip:function(){ return PIN.length+' 条固定'; },
  html:function(){ return '<div class="tl-hint tl-r">按住右侧把手上下拖动，顺序即注入顺序</div><div class="srt" id="srt" style="height:'+(PIN.length*66)+'px">'+PIN.map(function(t,i){ return '<div class="sr" data-i="'+i+'" style="transform:translateY('+i*66+'px)"><span class="no">'+(i+1)+'</span><div class="tx">'+esc(t)+'</div><span class="gp">'+IC.grip+'</span></div>'; }).join('')+'</div>'; },
  setup:function(el){ var box=$('#srt',el), H=66, order=PIN.map(function(_,i){ return i; }), rows=Array.prototype.slice.call(box.children);
    function place(skip){ order.forEach(function(ri,pos){ var r=rows[ri]; if(r===skip) return; r.style.transform='translateY('+pos*H+'px)'; r.querySelector('.no').textContent=pos+1; }); }
    rows.forEach(function(r,ri){ var g=r.querySelector('.gp'), startY, base;
      g.addEventListener('pointerdown',function(e){ e.preventDefault(); try{ g.setPointerCapture(e.pointerId); }catch(_){} startY=e.clientY; base=order.indexOf(ri)*H; r.classList.add('lift'); buzz(8);
        function mv(ev){ var y=Math.max(0,Math.min((rows.length-1)*H,base+ev.clientY-startY)); r.style.transform='translateY('+y+'px) scale(1.02)'; var np=Math.round(y/H), cp=order.indexOf(ri); if(np!==cp){ order.splice(cp,1); order.splice(np,0,ri); place(r); buzz(4); } }
        function up(){ g.removeEventListener('pointermove',mv); g.removeEventListener('pointerup',up); g.removeEventListener('pointercancel',up); r.classList.remove('lift'); place(); r.querySelector('.no').textContent=order.indexOf(ri)+1; toast('顺序已更新'); }
        g.addEventListener('pointermove',mv); g.addEventListener('pointerup',up); g.addEventListener('pointercancel',up); }); }); } };

/* 7 标星管理 */
var STARS=[];   /* 演示数据已删（2026-10-22），联网后由真接口填 */
T.star={ n:'标星管理', s:'查看 · 编辑 · 取消标星', i:'star', tint:'p', chip:function(){ return STARS.length+' 颗'; },
  html:function(){ return '<div class="tl-sr tl-r"><input id="stQ" placeholder="搜索标星的句子"></div><div id="stL"></div>'; },
  setup:function(el,win){ var items=STARS.map(function(s){ return Object.assign({},s); }), L=$('#stL',el), q='';
    function draw(){ L.innerHTML=items.filter(function(s){ return !q||s.x.indexOf(q)>=0; }).map(function(s,i){ return '<div class="sx" data-x="'+items.indexOf(s)+'" style="--i:'+i+'"><div class="tt">“'+esc(s.x)+'”</div><div class="ft"><span>'+s.b+' · '+s.d+'</span><button class="ed tap">编辑</button><button class="un tap" aria-label="取消标星">'+IC.star+'</button></div></div>'; }).join('')||'<div class="tl-emp">没有找到 ✦</div>'; }
    draw(); $('#stQ',el).addEventListener('input',function(){ q=this.value.trim(); draw(); });
    L.addEventListener('click',function(e){ var c=e.target.closest('.sx'); if(!c) return; var s=items[+c.dataset.x];
      if(e.target.closest('.un')){ buzz(8); c.classList.add('off'); setTimeout(function(){ collapse(c,function(){ items.splice(items.indexOf(s),1); var chip=document.querySelector('[data-tool="star"] .chip'); if(chip) chip.textContent=items.length+' 颗'; toast('已取消标星'); }); },260); }
      else if(e.target.closest('.ed')){ P.sheet(win,{title:'编辑这句',ph:'句子内容',btn:'保存',onSubmit:function(v){ s.x=v; c.querySelector('.tt').textContent='“'+v+'”'; toast('已保存'); }}); setTimeout(function(){ var ta=win.querySelector('.sheetw textarea'); if(ta) ta.value=s.x; },30); } }); } };

/* 8 替换记录 */
var REP=[];   /* 演示数据已删（2026-10-22），联网后由真接口填 */
T.swap={ n:'替换记录', s:'每次压缩 / 替换', i:'swap', tint:'l', chip:function(){ return REP.length+' 次'; },
  html:function(){ return REP.map(function(r){ var p=Math.round((1-r.b/r.a)*100); return '<div class="rp tl-r"><div class="top"><b>'+r.t+'</b><em>−'+p+'%</em></div><div class="bars"><div><small>前 · '+r.a+' 条</small><i class="b1" style="--w:100%"></i></div><div><small>后 · '+r.b+' 条</small><i class="b2" style="--w:'+(r.b/r.a*100)+'%"></i></div></div><div class="dt"><div><p>'+esc(r.m)+'</p></div></div></div>'; }).join(''); },
  setup:function(el){ el.addEventListener('click',function(e){ var c=e.target.closest('.rp'); if(c){ c.classList.toggle('open'); buzz(5); } }); } };

/* 9 备份状态 */
var DAYS=[];
T.save={ n:'备份状态', s:'最近备份 · 断档告警', i:'save', tint:'a', chip:function(){ return '—'; },
  html:function(){ return '<div class="tl-c tl-r sv"><div class="rgw big2" id="svRg">'+ring(100,'#79c2a4',150)+'<div class="mid"><b id="svT">3 小时前</b><small id="svS">每天 02:30 自动备份</small></div></div><button class="pl-bt tap" id="svGo">立即备份</button></div>'+
    '<div class="tl-c tl-r"><div class="hd">最近 14 天 <em class="warn">1 天断档</em></div><div class="hm">'+DAYS.map(function(d,i){ return '<span class="'+(d?'ok':'gap')+'" style="--i:'+i+'" title="'+(d?'已备份':'断档')+'"></span>'; }).join('')+'</div><div class="sub">粉色格子是没有备份的日子（10月8日）</div></div>'; },
  setup:function(el){ fillRings(el); var go=$('#svGo',el), busy=false; go.addEventListener('click',function(){ if(busy) return; busy=true; go.textContent='备份中…'; buzz([10,40,10]);
    var fg=$('#svRg .fg',el), C=+fg.getAttribute('data-to')+0, full=parseFloat(fg.style.strokeDasharray); fg.style.transition='none'; fg.style.strokeDashoffset=full; void fg.getBoundingClientRect(); fg.style.transition='stroke-dashoffset 2s '+SP; fg.style.strokeDashoffset=0;
    setTimeout(function(){ $('#svT',el).textContent='刚刚'; $('#svS',el).textContent='备份完成 ✓ · 共 318 MB'; go.textContent='立即备份'; busy=false; toast('备份完成'); buzz(14); },2100); }); } };

/* ================= 联网：接管理台的接口（和后台页同一个登录会话；没连上就还是示例） ================= */
var LIVE=false, SID='', CTXT=null;
function ago(ms){ var s=Math.max(0,Math.round((Date.now()-ms)/1000)); if(s<90) return '刚刚'; if(s<3600) return Math.round(s/60)+' 分钟前'; if(s<86400) return Math.round(s/3600)+' 小时前'; return Math.round(s/86400)+' 天前'; }
function wall(t){ var d=P.net.parse(t); return d?P.net.fmtTime(d):String(t||''); }
var A={alerts:[],services:[]}, BK=null, PINREC=[];
var orig={}; ['alert','log','push','ctx','cross','pin','star','swap','save'].forEach(function(k){ orig[k]={html:T[k].html,setup:T[k].setup,chip:T[k].chip}; });
function empty(t){ return '<div class="tl-emp">'+t+'</div>'; }

/* 1 后台提醒 */
T.alert.load=function(){ return P.net.get('/heartbeat/admin/alerts').then(function(r){ A.alerts=(r&&r.alerts)||[]; A.services=(r&&r.services)||[]; }); };
T.alert.chip=function(){ return LIVE?(A.alerts.length?A.alerts.length+' 项留意':'一切安静'):'—'; };
T.alert.html=function(){
  if(!LIVE) return empty('未连接后台 ✦');
  var sv=A.services, bad=sv.filter(function(x){ return !x.ok; }), net=A.alerts.filter(function(a){ return a.type==='netease'; }), sen=A.alerts.filter(function(a){ return a.type==='sentinel'; });
  var bn=A.alerts.length?A.alerts.slice(0,8).map(function(a){ return '<div class="tl-bn tl-r"><span class="d"></span><div><b>'+esc(a.title||'提醒')+'</b><small>'+esc(a.desc||'')+'</small></div><button class="tap alOk">知道了</button></div>'; }).join(''):'<div class="tl-hint tl-r">一切安静，没有需要留意的事 ✦</div>';
  return bn+'<div class="tl-g2">'+
    '<div class="tl-c tl-r"><div class="hd">网易云 <em class="'+(net.length?'warn':'ok')+'">'+(net.length?'失效':'有效')+'</em></div><div class="big">'+(net.length?'要重登':'正常')+'</div><div class="sub">'+(net.length?'MUSIC_U 需要重新设置':'登录会话可用')+'</div></div>'+
    '<div class="tl-c tl-r wide"><div class="hd">服务状态 <em class="'+(bad.length?'warn':'ok')+'">'+(bad.length?bad.length+' 异常':'正常')+'</em></div><div class="dots">'+sv.map(function(x){ return '<span class="'+(x.ok?'ok':'warn')+'"></span>'; }).join('')+'</div><div class="sub">'+(sv.length?(bad.length?esc(bad.map(function(x){ return x.label||x.name; }).join('、')):sv.length+' 个服务都在跑'):'暂无数据')+'</div></div>'+
    '<div class="tl-c tl-r"><div class="hd">安全哨兵 <em class="'+(sen.length?'warn':'ok')+'">'+(sen.length?sen.length+' 条':'安静')+'</em></div><div class="radar"><i></i><b></b></div><div class="sub">24 小时 '+sen.length+' 次异常</div></div></div>';
};
T.alert.setup=function(el){
  if(!LIVE) return;
  fillRings(el);
  el.addEventListener('click',function(e){ var b=e.target.closest('.alOk'); if(!b) return; b.closest('.tl-bn').classList.add('gone'); buzz(8); });
};

/* 2 唤醒原始日志 */
function loadLog(){ return P.net.get('/heartbeat/admin/logs/wake-up?lines=300').then(function(r){
  var t='', out=[];
  ((r&&r.lines)||[]).forEach(function(l){
    var m=/开始自动唤醒\s+\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/.exec(l); if(m) t=m[1]; if(/^=+\s*$/.test(l.trim())) return;
    var lv=/失败|错误|error|异常|拒绝/i.test(l)?'err':/警告|超时|重试|偏慢|warn/i.test(l)?'warn':'info';
    out.push([lv,t||'--:--',/^\[/.test(l)?l:'['+(m?'wake':'log')+'] '+l]);
  });
  LOGS=out.slice(-200);
}); }
T.log.load=loadLog;
T.log.chip=function(){ return LIVE?LOGS.length+' 行':'—'; };
T.log.setup=function(el,win){
  if(!LIVE) return;
  var iv=null, flt='all', box=el.querySelector('#lgBox');
  /* 登录版 setup 把演示版整个盖掉了，画日志和筛选的逻辑没人接力，这里补上（数据用 LOGS，每行 [级别,时间,正文]） */
  function line(l){ var d=document.createElement('div'); d.className='lg '+l[0]; var m=/^\[([^\]]+)\]\s*(.*)$/.exec(l[2]||''); d.innerHTML='<time>'+esc(l[1])+'</time>'+(m?'<b class="tg">'+esc(m[1])+'</b><span>'+esc(m[2])+'</span>':'<span>'+esc(l[2])+'</span>'); return d; }
  function draw(){ if(!box) return; box.innerHTML=''; LOGS.filter(function(l){ return flt==='all'||l[0]===flt; }).forEach(function(l){ box.appendChild(line(l)); }); box.scrollTop=box.scrollHeight; }
  draw();
  var ft=el.querySelector('#lgFt');
  if(ft) ft.addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; flt=b.dataset.f||'all'; Array.prototype.forEach.call(ft.querySelectorAll('button'),function(x){ x.classList.toggle('on',x===b); }); draw(); buzz(5); });
  if(box) box.addEventListener('click',function(e){ var l=e.target.closest('.lg'); if(l){ l.classList.toggle('wrap'); buzz(4); } });
  /* 「实时」：每 5 秒真的去拉一次日志，不再编心跳 */
  el.addEventListener('click',function(e){
    var b=e.target.closest('.lv'); if(!b) return; e.stopPropagation();
    var on=!b.classList.contains('on'); b.classList.toggle('on',on); buzz(6); clearInterval(iv);
    if(on) iv=setInterval(function(){ if(!el.isConnected){ clearInterval(iv); return; } loadLog().then(function(){ var cur=el.querySelector('#lgFt button.on'); if(cur) cur.click(); }).catch(function(){}); },5000);
  },true);
};

/* 3 推送管理 */
T.push.load=function(){ return P.net.get('/heartbeat/admin/push-events?all=1').then(function(r){
  PUSH=((r&&r.items)||[]).filter(function(p){ return p.sent!==false&&(p.body||p.title); }).slice(0,40).map(function(p){ return {t:p.body||p.title,title:p.title||'',w:wall(p.at),ch:p.channel||'推送',sid:p.session_id,pos:p.position}; });
}); };
T.push.chip=function(){ return LIVE?PUSH.length+' 条':'—'; };
T.push.html=function(){
  if(!LIVE) return empty('未连接后台 ✦');
  if(!PUSH.length) return empty('还没有推送记录 ✦');
  return '<div class="tl-hint tl-r">左滑删除 · 点一下修改</div><div id="pnL">'+PUSH.map(function(p,i){ return '<div class="pn tl-r" data-i="'+i+'"><div class="del"><button class="tap">'+IC.trash+'删除</button></div><div class="fg2"><span class="ic">'+IC.push+'</span><div class="bd"><b>'+esc(p.t)+'</b><small>'+esc(p.w)+' · '+esc(p.ch)+'</small></div></div></div>'; }).join('')+'</div>';
};
T.push.setup=function(el,win){
  if(!LIVE) return;
  var L=$('#pnL',el); if(!L) return;
  Array.prototype.forEach.call(L.querySelectorAll('.pn'),function(row){
    var fg=row.querySelector('.fg2'), x=0, open=false, rec=PUSH[+row.dataset.i];
    P.drag(fg,{ move:function(dx,dy,ax){ if(ax!=='x') return; x=Math.max(-96,Math.min(0,(open?-96:0)+dx)); fg.style.transition='none'; fg.style.transform='translateX('+x+'px)'; },
      end:function(dx,dy,dt,ax){ fg.style.transition='transform .4s '+SP;
        if(ax==='x'){ open=x<-44; fg.style.transform='translateX('+(open?-96:0)+'px)'; buzz(open?8:4); }
        else if(Math.abs(dx)<6&&Math.abs(dy)<6){
          if(open){ open=false; fg.style.transform='none'; return; }
          P.sheet(win,{title:'修改推送',ph:'推送内容',btn:'保存',onSubmit:function(v){
            return P.net.post('/heartbeat/admin/push-events/update',{session_id:rec.sid,position:rec.pos,title:rec.title,body:v}).then(function(){ rec.t=v; fg.querySelector('b').textContent=v; toast('已修改'); buzz(8); },function(e){ toast('没改成，内容还在'); throw e; });
          }});
          setTimeout(function(){ var ta=win.querySelector('.sheetw textarea'); if(ta) ta.value=rec.t; },30);
        } } });
    row.querySelector('.del button').addEventListener('click',function(){
      P.net.post('/heartbeat/admin/push-events/delete',{session_id:rec.sid,position:rec.pos}).then(function(){ buzz(10); collapse(row,function(){ toast('已删除'); }); },function(){ toast('没删掉，稍后再试'); });
    });
  });
};

/* 4 当前请求上下文：最后一次真正发给模型的内容，按分隔块分层，token 为字数估算 */
T.ctx.load=function(){ return P.net.get('/heartbeat/admin/logs/context').then(function(r){
  var msgs=(r&&r.messages)||[], pal=['#8aa6d8','#a89bd8','#e58fa4','#7fb9b0','#e3b27a'], layers=[], cur=null, hasDiv=msgs.some(function(m){ return m.role==='_divider'; });
  function txt(c){ if(typeof c==='string') return c; if(Array.isArray(c)) return c.map(function(p){ return (p&&p.text)||''; }).join(''); return c==null?'':JSON.stringify(c); }
  function start(n){ cur={n:n,chars:0,sample:''}; layers.push(cur); }
  msgs.forEach(function(m){
    if(m.role==='_divider'){ start(String(m.content||'').replace(/[-=—·\s]+/g,' ').trim().slice(0,12)||'分段'); return; }
    var conv=m.role!=='system'&&m.role!=='developer', nm=conv?'近期对话':(hasDiv?'开头':'系统提示');
    if(!cur||(conv&&cur.n!=='近期对话')||(!conv&&!hasDiv&&cur.n!=='系统提示')) start(nm);
    var t=txt(m.content); cur.chars+=t.length; if(!cur.sample) cur.sample=t.replace(/\s+/g,' ').slice(0,120);
  });
  LAYERS=layers.filter(function(l){ return l.chars>0; }).map(function(l,i){ return [l.n,Math.max(1,Math.round(l.chars/1.5)),pal[i%pal.length],l.sample+(l.chars>120?'…':'')]; });
  CTXT=r&&r.captureTime;
}); };
T.ctx.chip=function(){ if(!LIVE) return '—'; var n=LAYERS.reduce(function(a,l){ return a+l[1]; },0); return n?n.toLocaleString()+' tok':'暂无请求'; };
T.ctx.html=function(){ if(!LIVE) return empty('未连接后台 ✦'); if(!LAYERS.length) return empty('还没有捕获到请求，和他聊一句再来看 ✦'); return orig.ctx.html(); };

/* 5 跨窗口注入：他下一次真正会带上的内容 */
T.cross.load=function(){
  return P.net.get('/heartbeat/admin/current-session').then(function(r){ SID=(r&&r.session)||'default'; return P.net.get('/heartbeat/admin/cross-window-inject?session_id='+encodeURIComponent(SID)); }).then(function(r){
    var t=String((r&&r.text)||'').trim(); XW={'实际注入':t?t.split(/\n{2,}/).map(function(x){ return x.trim(); }).filter(Boolean).slice(0,40):[]};
  });
};
T.cross.chip=function(){ return LIVE?(XW['实际注入']||[]).length+' 段':'—'; };
T.cross.html=function(){
  if(!LIVE) return empty('未连接后台 ✦');
  var a=XW['实际注入']||[]; if(!a.length) return empty('现在没有要带过去的内容 ✦');
  return '<div class="tl-hint tl-r">他下一次发消息时，会带上这些跨窗口的内容</div><div id="xwL">'+a.map(function(t,i){ return '<div class="xi" style="--i:'+i+'"><span class="n">'+(i+1)+'</span>'+esc(t.length>400?t.slice(0,400)+'…':t)+'</div>'; }).join('')+'</div>';
};
T.cross.setup=function(el){ if(!LIVE) return; };

/* 6 永久注入：拖动换顺序，换完同步到后台 */
T.pin.load=function(){ return P.net.get('/heartbeat/admin/logs/pinned').then(function(r){ PINREC=(r&&r.list)||[]; PIN=PINREC.map(function(m){ return (m.title?'【'+m.title+'】':'')+String(m.content||''); }); }); };
T.pin.chip=function(){ return LIVE?PIN.length+' 条固定':'—'; };
T.pin.html=function(){ if(!LIVE) return empty('未连接后台 ✦'); if(!PIN.length) return empty('还没有固定注入的内容 ✦'); return orig.pin.html(); };
T.pin.setup=function(el,win){
  if(LIVE&&!PIN.length) return;
  if(!LIVE) return;
  try{ orig.pin.setup(el,win); }catch(_){}   /* 拖拽逻辑在演示版 setup 里，之前没人调用，把手拖不动 */
  var box=$('#srt',el), rows=Array.prototype.slice.call(box.children);
  function sync(){ setTimeout(function(){
    var ids=rows.map(function(r,ri){ return {id:PINREC[ri].id,pos:+r.querySelector('.no').textContent}; }).sort(function(a,b){ return a.pos-b.pos; }).map(function(x){ return x.id; });
    P.net.post('/heartbeat/admin/logs/pinned/reorder',{ids:ids}).catch(function(){ toast('顺序没同步上，稍后再试'); });
  },80); }
  rows.forEach(function(r){ var g=r.querySelector('.gp'); g.addEventListener('pointerup',sync); g.addEventListener('pointercancel',sync); });
};

/* 7 标星管理 */
T.star.load=function(){ return P.net.get('/heartbeat/admin/context-compaction/marked-list').then(function(r){
  STARS=((r&&r.results)||[]).map(function(x){ return {x:x.content,b:x.role==='user'?((P.names&&P.names.me)?P.names.me():'用户'):((P.names&&P.names.ai)?P.names.ai():'助手'),d:String(x.time||'').slice(5,16),key:x.key}; });
}); };
T.star.chip=function(){ return LIVE?STARS.length+' 颗':'—'; };
T.star.setup=function(el,win){
  if(!LIVE) return;
  var items=STARS.map(function(s){ return Object.assign({},s); }), L=$('#stL',el), q='';
  function draw(){ L.innerHTML=items.filter(function(s){ return !q||s.x.indexOf(q)>=0; }).map(function(s,i){ return '<div class="sx" data-x="'+items.indexOf(s)+'" style="--i:'+i+'"><div class="tt">“'+esc(s.x)+'”</div><div class="ft"><span>'+esc(s.b)+' · '+esc(s.d)+'</span><button class="ed tap">编辑</button><button class="un tap" aria-label="取消标星">'+IC.star+'</button></div></div>'; }).join('')||'<div class="tl-emp">没有找到 ✦</div>'; }
  draw(); $('#stQ',el).addEventListener('input',function(){ q=this.value.trim(); draw(); });
  L.addEventListener('click',function(e){ var c=e.target.closest('.sx'); if(!c) return; var s=items[+c.dataset.x]; if(!s) return;
    if(e.target.closest('.un')){
      P.net.post('/heartbeat/admin/context-compaction/mark',{key:s.key,marked:false}).then(function(){
        buzz(8); c.classList.add('off'); setTimeout(function(){ collapse(c,function(){ items.splice(items.indexOf(s),1); var chip=document.querySelector('[data-tool="star"] .chip'); if(chip) chip.textContent=items.length+' 颗'; toast('已取消标星'); }); },260);
      },function(){ toast('没取消成功，稍后再试'); });
    }else if(e.target.closest('.ed')){
      P.sheet(win,{title:'编辑这句',ph:'句子内容',btn:'保存',onSubmit:function(v){
        P.net.post('/heartbeat/admin/context-compaction/marked/update',{key:s.key,content:v}).then(function(){ s.x=v; c.querySelector('.tt').textContent='“'+v+'”'; toast('已保存'); },function(){ toast('没保存上，稍后再试'); });
      }});
      setTimeout(function(){ var ta=win.querySelector('.sheetw textarea'); if(ta) ta.value=s.x; },30);
    } });
};

/* 8 压缩记录（原「替换记录」：现在上下文走压缩，这里列压缩 / 状态并入的每一次） */
T.swap.n='压缩记录'; T.swap.s='每次压缩 · 状态并入';
T.swap.load=function(){ return P.net.get('/heartbeat/admin/context-compaction/logs').then(function(r){
  REP=((r&&r.logs)||[]).slice().sort(function(a,b){ return String(b.time).localeCompare(String(a.time)); }).slice(0,30).map(function(e){ return {t:wall(e.time),label:e.label||'压缩',bad:/fail|error|失败/i.test(String(e.status||'')),m:e.message||''}; });
}); };
T.swap.chip=function(){ return LIVE?REP.length+' 条':'—'; };
T.swap.html=function(){
  if(!LIVE) return empty('未连接后台 ✦');
  if(!REP.length) return empty('还没有压缩记录 ✦');
  return REP.map(function(r){ return '<div class="rp tl-r open"><div class="top"><b>'+esc(r.t)+'</b><em'+(r.bad?' class="warn"':'')+'>'+esc(r.label)+'</em></div><div class="dt"><div><p>'+esc(r.m)+'</p></div></div></div>'; }).join('');
};

/* 9 备份状态 */
T.save.load=function(){ return P.net.get('/heartbeat/admin/backup/status').then(function(r){ BK=r; }); };
T.save.chip=function(){ if(!LIVE||!BK) return '—'; if(!BK.latest) return '还没有备份'; return BK.stale_days>1?BK.stale_days+' 天没备份':'已备份'; };
T.save.html=function(){
  if(!LIVE||!BK) return empty('未连接后台 ✦');
  var l=BK.latest, old=BK.stale_days>1;
  return '<div class="tl-c tl-r sv"><div class="rgw big2" id="svRg">'+ring(l?100:0,old?'#d5738c':'#79c2a4',150)+'<div class="mid"><b>'+(l?ago(l.mtime):'暂无')+'</b><small>'+(l?'共 '+BK.count+' 份 · 最新 '+Math.max(1,Math.round(l.size/1048576))+' MB':'还没有备份文件')+'</small></div></div></div>'+
    '<div class="tl-hint tl-r">备份由后台每天自动做'+(old?'，已经 '+BK.stale_days+' 天没有新的了':'')+'；手动备份还没有接口</div>';
};
T.save.setup=function(el){ if(!LIVE||!BK) return; fillRings(el); };

/* ================= 外壳：卡片格 + 全屏展开 ================= */
P.tools={ def:T, order:['alert','log','push','ctx','cross','pin','star','swap','save'],
  grid:function(){ return P.tools.order.map(function(k,i){ var t=T[k]; return '<button class="tl-tile glass tint-'+t.tint+' tap" data-tool="'+k+'" style="--i:'+i+'"><span class="ic">'+IC[t.i]+'</span><b>'+t.n+'</b><small>'+t.s+'</small><em class="chip">'+t.chip()+'</em></button>'; }).join(''); },
  open:function(win,k,tile){ var t=T[k], W=D.clientWidth, Hh=D.clientHeight, pr=rectIn(tile), pre=(LIVE&&t.load)?t.load().then(function(){ return true; },function(){ return false; }):null;
    var R=document.createElement('div'); R.className='tl-ov'; R.innerHTML='<div class="tl-hd"><button class="bk tap" aria-label="返回">'+IC.back+'</button><div><h2>'+esc(t.n)+'</h2><small>'+esc(t.s)+'</small></div></div><div class="sc tl-body">'+(pre?'<div class="tl-emp">翻一翻…</div>':P.net.failBox())+'</div>';
    win.appendChild(R); R.style.transformOrigin='0 0'; tile.style.visibility='hidden';
    var body=R.querySelector('.tl-body'), hd=R.querySelector('.tl-hd'); body.style.opacity='0'; hd.style.opacity='0';
    anim(R,[{transform:'translate('+pr.x+'px,'+pr.y+'px) scale('+(pr.w/W)+','+(pr.h/Hh)+')',borderRadius:'24px'},{transform:'none',borderRadius:'0px'}],{duration:520,easing:SP});
    setTimeout(function(){ body.style.opacity='1'; hd.style.opacity='1'; buzz(8);
      /* [位置:phone-tools.js·open] [没连上后台] [演示卡片已删（2026-10-22）：没联网时显示「没连上后台 · 点一下重试」，重试＝让桌面小组件重新联网，1.8 秒后再拉这一页] [注释时间 2026-10-22] */
      if(!pre){ body.addEventListener('click',function(e){ if(!e.target.closest('[data-retry]')) return; body.innerHTML=P.net.loadBox(); try{ window.dispatchEvent(new Event('ph:login')); }catch(_){} setTimeout(function(){ if(!LIVE){ body.innerHTML=P.net.failBox(); return; } t.load().then(function(){ body.innerHTML=t.html(); stag(body,'.tl-r,.sx,.xi'); t.setup(body,win); var chip=document.querySelector('[data-tool="'+k+'"] .chip'); if(chip&&t.chip) chip.textContent=t.chip(); },function(){ body.innerHTML=empty('这一页没取到，稍后再试 ✦'); }); },1800); }); return; }
      pre.then(function(ok){
        if(!ok){ body.innerHTML=empty('这一页没取到，稍后再试 ✦'); return; }
        body.innerHTML=t.html(); stag(body,'.tl-r,.sx,.xi'); t.setup(body,win);
        var chip=document.querySelector('[data-tool="'+k+'"] .chip'); if(chip&&t.chip) chip.textContent=t.chip();
      });
    },230);
    var closing=false; function close(){ if(closing) return; closing=true; var pr2=rectIn(tile); body.style.opacity='0'; hd.style.opacity='0'; buzz(6);
      anim(R,[{transform:'none',borderRadius:'0px'},{transform:'translate('+pr2.x+'px,'+pr2.y+'px) scale('+(pr2.w/W)+','+(pr2.h/Hh)+')',borderRadius:'24px'}],{duration:400,easing:'cubic-bezier(.3,.9,.3,1)'}).finished.then(function(){ R.remove(); tile.style.visibility=''; }); }
    R.querySelector('.bk').addEventListener('click',close);
    P.drag(hd,{ can:function(e){ return !e.target.closest('.bk'); }, move:function(dx,dy,ax){ if(ax==='y'&&dy>0) R.style.transform='translateY('+dy*.6+'px) scale('+(1-Math.min(dy,300)/1800)+')'; },
      end:function(dx,dy,dt,ax){ if(ax==='y'&&dy>100) close(); else if(R.style.transform) anim(R,[{transform:R.style.transform},{transform:'none'}],{duration:300,easing:SP}).finished.then(function(){ R.style.transform=''; }); } });
  } };
P.tools.setLive=function(on,win){
  LIVE=!!on; if(!LIVE||!win) return;
  P.tools.order.forEach(function(k){
    var t=T[k], chip=win.querySelector('[data-tool="'+k+'"] .chip'); if(!chip||!t.load) return;
    chip.textContent='…';
    t.load().then(function(){ chip.textContent=t.chip(); },function(){ chip.textContent='—'; });
  });
};
/* 给桌面小组件用：一次取全，再按需读 */
P.tools.loadAll=function(){ return Promise.all(P.tools.order.map(function(k){ return T[k].load?T[k].load().catch(function(){ return null; }):null; })); };
P.tools.data=function(){ return {logs:LOGS,push:PUSH,pin:PIN,stars:STARS,rep:REP,bk:BK,alerts:A,layers:LAYERS,xw:XW}; };
})();
