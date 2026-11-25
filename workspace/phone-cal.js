/* 小手机 · 月历：日期格 + 经期胶囊 + 当日详情（记账 / 当天的日记，按时间正序）。
   日记条目的 at 字段决定显示位置：'cal' 显示在月历，'love' 显示在情书信封页（后端接好后由日记工具写入）。 */
(function(){
"use strict";
var P=window.PH, $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast, anim=P.anim;
var L='<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>', R='<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
var WK=['日','一','二','三','四','五','六'];
function key(y,m,d){ return y+'-'+('0'+(m+1)).slice(-2)+'-'+('0'+d).slice(-2); }
function fromKey(k){ var a=k.split('-'); return new Date(+a[0],+a[1]-1,+a[2]); }
/* 数据来自后端 /monthly/api（经期、记账、今日总结）；纪念日由「在一起」那天算出来 */
var PERIODS=[], PRED=[], DATA={}, TOGETHER='2026-07-02', loaded=false, loading=null;
/* [位置:phone-cal.js·心情] [月历每天的「总结心情」：她和他各一份，每天 1~3 个，也可以自定义一段文字/emoji] [10-23：表在后端 /monthly/api/mood/table（id/名字/说明），图标是 mood/<id>.svg（微软 Fluent Emoji Flat，MIT）；日期格数字下面两个小图标（她在左、他在右，各取第一个），点开某天在详情里「心情」一行：她那行点一下选（最多 3 个，自定义也算 1 个），他那行只读；数据来自 markers 的 mood] [注释时间 2026-10-23] */
var MT=null;
function moodTable(){ if(MT) return Promise.resolve(MT); return P.net.get('/monthly/api/mood/table').then(function(t){ MT=t||[]; return MT; }); }
function moodName(id){ var m=(MT||[]).filter(function(x){ return x.id===id; })[0]; return m?m.name:id; }
function moodSrc(id){ return 'mood/'+id+'.svg?v=1'; }
function moodFirst(v){ return v&&((v.ids&&v.ids[0])||(v.custom?'custom':'')); }
function moodChips(v){ if(!v) return ''; var h=(v.ids||[]).map(function(id){ return '<span class="mo-c"><img src="'+moodSrc(id)+'" alt="">'+esc(moodName(id))+'</span>'; }).join('');
  if(v.custom) h+='<span class="mo-c"><img src="'+moodSrc('custom')+'" alt="">'+esc(v.custom)+'</span>'; return h; }
function heartOf(k){
  if(k<TOGETHER) return '';
  var n=Math.round((fromKey(k)-fromKey(TOGETHER))/864e5);
  if(n===0) return '在一起的那天';
  if(n>0&&n%100===0) return '在一起第 '+n+' 天';
  if(n===365) return '在一起一周年';
  return '';
}
function fillPred(){
  PRED.length=0; if(!PERIODS.length) return;
  var starts=PERIODS.map(function(r){ return r[0]; }).sort(), gaps=[], lens=[], i;
  for(i=1;i<starts.length;i++){ var g=dayDiff(starts[i-1],starts[i]); if(g>=18&&g<=45) gaps.push(g); }
  PERIODS.forEach(function(r){ var l=dayDiff(r[0],r[1])+1; if(l>=2&&l<=10) lens.push(l); });
  var cyc=gaps.length?Math.round(gaps.reduce(function(a,b){ return a+b; },0)/gaps.length):28, len=lens.length?Math.round(lens.reduce(function(a,b){ return a+b; },0)/lens.length):5;
  var last=starts[starts.length-1], d=fromKey(last); d.setDate(d.getDate()+cyc);
  var ps=key(d.getFullYear(),d.getMonth(),d.getDate()), pe=fromKey(ps); pe.setDate(pe.getDate()+len-1);
  PRED.push([ps,key(pe.getFullYear(),pe.getMonth(),pe.getDate())]);
}
/* [位置:phone-cal.js·用量统计] [月历详情里的「这一天的对话」：她发几条、他回几条、用了多少 token] [10-23 需求 44：纯展示，数据来自 GET /v1/daily-stats?month=（网关按时间线现状算，token 只算存了用量的消息，老消息没有用量所以只会少不会多）；一个月缓存一份，超过 60 秒再点开会后台刷新一次；没有对话的那天不显示这一行] [注释时间 2026-10-23] */
var STATS={}, STBUSY={};
function fmtN(n){ n=+n||0; if(n>=1e8) return (n/1e8).toFixed(1).replace(/\.0$/,'')+' 亿'; if(n>=1e4) return (n/1e4).toFixed(1).replace(/\.0$/,'')+' 万'; return String(n); }
function loadAll(){
  if(loading) return loading;
  var today=P.net.ymd();
  loading=Promise.all([P.net.get('/monthly/api/periods'),P.net.get('/monthly/api/markers'),P.net.get('/xie-diary/api/list',{noLogin:true}).catch(function(){ return null; })]).then(function(r){
    PERIODS.length=0; (r[0]||[]).forEach(function(p){ if(p.start) PERIODS.push([p.start,p.end||today]); });
    Object.keys(DATA).forEach(function(k){ delete DATA[k]; });
    var mk=r[1]||{}; (mk.finance||[]).forEach(function(k){ if(/^\d{4}-/.test(k)) (DATA[k]=DATA[k]||{}).exp=[]; });
    (mk.summary||[]).forEach(function(k){ (DATA[k]=DATA[k]||{}).sum=true; });
    Object.keys(mk.mood||{}).forEach(function(k){ (DATA[k]=DATA[k]||{}).mood=mk.mood[k]; });
    /* 恋爱日记（他的陪伴日记）按写的那天放进日历；要登录过才读得到，没登录就先没有 */
    ((r[2]&&r[2].entries)||[]).forEach(function(e){
      if(e.kind==='letter') return; var d=P.net.parse(e.created_at); if(!d) return;
      var txt=String(e.content||'').replace(/\r/g,'').split('\n').filter(function(l){ return !/^#{1,3}\s/.test(l); }).join('\n').replace(/\n{3,}/g,'\n\n').trim(); if(!txt) return;
      var k=key(d.getFullYear(),d.getMonth(),d.getDate()), ev=DATA[k]||(DATA[k]={}); (ev.diary=ev.diary||[]).push({t:P.net.hm(d),x:txt,m:'',at:'cal',id:e.id,hid:!!e.hidden});
    });
    fillPred(); loaded=true; try{ window.dispatchEvent(new Event('ph:cal')); }catch(e){}
  }).catch(function(){ loading=null; throw 0; });
  return loading;
}
/* [位置:phone-cal.js·diaryOf/diaryAll] [日记在月历里可编辑/隐藏] [10-23 需求 49：隐藏了的日记也要能在月历详情里看到并恢复；diaryOf 照旧不含隐藏的（日期格的小点和别处引用都不变），详情里用 diaryAll（含隐藏）] [注释时间 2026-10-23] */
function diaryAll(ev){ return ((ev&&ev.diary)||[]).filter(function(d){ return d.at==='cal'; }).sort(function(a,b){ return a.t<b.t?-1:a.t>b.t?1:0; }); }
function diaryOf(ev){ return diaryAll(ev).filter(function(d){ return !d.hid; }); }
function inRange(k,rs){ for(var i=0;i<rs.length;i++){ if(k>=rs[i][0]&&k<=rs[i][1]) return rs[i]; } return null; }
function dayDiff(a,b){ return Math.round((fromKey(b)-fromKey(a))/864e5); }

function html(){
  return '<div class="content cl">'+P.head('','<span class="sp"></span><button class="ibtn tap" id="clToday" aria-label="回到今天">今天</button>')+
    '<div class="ltitle"><div><h1 id="clTitle">10月</h1><div class="sub" id="clYear">2026</div></div><div class="cl-nav"><button class="tap" id="clPrev" aria-label="上月">'+L+'</button><button class="tap" id="clNext" aria-label="下月">'+R+'</button></div></div>'+
    '<div class="sc" id="clSc"><div class="cl-card glass"><div class="cl-wk">'+WK.map(function(w){ return '<span>'+w+'</span>'; }).join('')+'</div><div class="cl-gw"><div class="cl-sel" id="clSel"></div><div class="cl-g" id="clG"></div></div></div>'+
    '<div class="cl-det glass" id="clDet"></div></div></div>';
}
function setup(win){
  var now=new Date(), todayK=key(now.getFullYear(),now.getMonth(),now.getDate());
  var vy=now.getFullYear(), vm=now.getMonth(), selK=todayK;
  var G=$('#clG',win), sel=$('#clSel',win), det=$('#clDet',win);

  function build(){
    var first=new Date(vy,vm,1), start=first.getDay(), dim=new Date(vy,vm+1,0).getDate(), prevDim=new Date(vy,vm,0).getDate(), h='';
    $('#clTitle',win).textContent=(vm+1)+'月'; $('#clYear',win).textContent=vy;
    for(var i=0;i<42;i++){
      var d, m=vm, y=vy, out=false, n=i-start+1;
      if(n<1){ d=prevDim+n; m=vm-1; out=true; } else if(n>dim){ d=n-dim; m=vm+1; out=true; } else d=n;
      var dt=new Date(y,m,d), k=key(dt.getFullYear(),dt.getMonth(),dt.getDate()), cls='cl-d'+(out?' out':'')+(k===todayK?' today':''), r;
      if((r=inRange(k,PERIODS))){ cls+=' p'+(k===r[0]?' ps':'')+(k===r[1]?' pe':'')+(i%7===0?' rs':'')+(i%7===6?' re':''); }
      else if((r=inRange(k,PRED))){ cls+=' pp'; }
      var ev=DATA[k], dots='';
      if(ev){ if(ev.exp) dots+='<i class="e"></i>'; if(diaryOf(ev).length||ev.sum) dots+='<i class="s"></i>'; }
      if(heartOf(k)) dots+='<i class="h"></i>';
      var mf=ev&&ev.mood&&moodFirst(ev.mood.her), ma=ev&&ev.mood&&moodFirst(ev.mood.ai);
      var mh='<span class="mo-row"><span>'+(mf?'<img src="'+moodSrc(mf)+'" alt="">':'')+'</span><span>'+(ma?'<img src="'+moodSrc(ma)+'" alt="">':'')+'</span></span>';
      h+='<button class="'+cls+'" data-k="'+k+'"><b>'+dt.getDate()+'</b><span class="dots">'+dots+'</span>'+mh+'</button>';
    }
    G.innerHTML=h; moveSel(false);
  }
  function moveSel(anm){
    var c=G.querySelector('.cl-d[data-k="'+selK+'"]:not(.out)');
    if(!c){ sel.style.opacity='0'; return; }
    sel.style.transition=anm===false?'none':''; sel.style.opacity='1';
    sel.style.transform='translate('+(c.offsetLeft+(c.offsetWidth-36)/2)+'px,'+(c.offsetTop+3)+'px)';
    if(anm===false){ void sel.offsetWidth; sel.style.transition=''; }
  }
  var RAW=[];
  function ongoing(){ return RAW.some(function(p){ return p.start&&!p.end; }); }
  function fetchDay(k){
    var ev=DATA[k]||(DATA[k]={}); if(ev._ok||ev._busy) return; ev._busy=true;
    Promise.all([P.net.get('/monthly/api/records/'+k),P.net.get('/monthly/api/summary/'+k)]).then(function(r){
      var f=(r[0]&&r[0].finance)||[]; ev.exp=f.map(function(x){ return {id:x.id,n:(function(t){ t=String(t); return t.length>14?t.slice(0,13)+'…':t; })(x.note||x.category||'支出')+(x.type==='收入'?'（收入）':''),a:x.amount,inc:x.type==='收入'}; });
      ev.sumText=(r[1]&&r[1].text)||''; ev._ok=true; ev._busy=false;
      if(!ev.exp.length) delete ev.exp; if(ev.sumText) ev.sum=true;
      if(selK===k){ detail(false); build(); }
    }).catch(function(){ ev._busy=false; });
  }
  function statRow(k){
    var ym=k.slice(0,7), m=STATS[ym];
    if((!m||Date.now()-m.t>60000)&&!STBUSY[ym]){ STBUSY[ym]=1; P.net.get('/v1/daily-stats?month='+ym).then(function(r){ STBUSY[ym]=0; STATS[ym]={t:Date.now(),days:(r&&r.days)||{}}; if(selK&&selK.slice(0,7)===ym) detail(false); },function(){ STBUSY[ym]=0; }); }
    var s=m&&m.days[k]; if(!s||(!s.u&&!s.a)) return '';
    var tok=(s.in||0)+(s.out||0);
    return '<div class="cl-row"><div class="ic lv">∑</div><div class="tt"><small>这一天的对话</small><div class="st-ln">她发 '+s.u+' 条 · 他回 '+s.a+' 条</div><div class="st-ln">'+(tok?'用了 '+fmtN(tok)+' token（输入 '+fmtN(s.in)+' · 输出 '+fmtN(s.out)+'）':'token 没有记录')+'</div></div></div>';
  }
  /* [位置:phone-cal.js·diaryAct] [日记「编辑」「隐藏/恢复」] [10-23 需求 49：详情里每篇日记下面两个文字按钮；编辑弹一个输入框（走 /xie-diary/api/update，服务端先存历史版本、同步时间线）；隐藏/恢复走 /xie-diary/api/hide（隐藏＝不再进他的跨窗口注入，可恢复），隐藏后这篇变淡、标「已隐藏」，日期格上的小点也跟着去掉] [注释时间 2026-10-23] */
  function diaryFind(id){ var r=null; ((DATA[selK]&&DATA[selK].diary)||[]).forEach(function(d){ if(d.id===id) r=d; }); return r; }
  function diaryAct(act,id){
    var d=diaryFind(id); if(!d) return;
    if(act==='hide'){ var want=!d.hid;
      P.net.post('/xie-diary/api/hide',{id:id,hidden:want}).then(function(){ d.hid=want; build(); detail(false); buzz(8); toast(want?'隐藏了':'恢复了'); },function(){ toast('没成功，稍后再试'); }); return; }
    P.pages.sheet(win,'编辑日记','<textarea class="cl-dta" rows="8"></textarea><div class="pg-bts"><button class="pg-btn pri tap" type="button" data-dok>保存</button></div>',function(s,close){
      var ta=s.querySelector('textarea'); ta.value=d.x; setTimeout(function(){ try{ ta.focus(); }catch(e){} },320);
      s.querySelector('[data-dok]').addEventListener('click',function(){ var v=ta.value.trim(); if(!v){ toast('不能是空的'); return; } if(v===d.x){ close(); return; }
        P.net.post('/xie-diary/api/update',{id:id,text:v}).then(function(){ d.x=v; close(); detail(false); buzz(10); toast('改好了'); },function(){ toast('没保存上，稍后再试'); }); });
    });
  }
  function detail(fly){
    var d=fromKey(selK), ev=DATA[selK]||{}, h='', rr;
    var head='<div class="cl-dh"><h3>'+(d.getMonth()+1)+'月'+d.getDate()+'日 周'+WK[d.getDay()]+'</h3><small>'+(selK===todayK?'今天':(dayDiff(todayK,selK)>0?dayDiff(todayK,selK)+' 天后':-dayDiff(todayK,selK)+' 天前'))+'</small></div>';
    /* [位置:phone-cal.js·detail 经期行] [经期横行整行可点切换] [11-16 批3：经期行整行点一下=开始/结束（行尾灰字提示当前动作），底部三个按钮因此删掉；只在经期实际/预计范围内显示的原逻辑不变] [注释时间 2026-11-16] */
    if((rr=inRange(selK,PERIODS))) h+='<div class="cl-row cl-tap"><div class="ic pk">●</div><div class="tt"><small data-per>经期'+(ongoing()&&rr[1]>=todayK?' · 进行中':'')+'</small>第 '+(dayDiff(rr[0],selK)+1)+' 天 · 好好休息，我替你记着</div><span class="cl-act" data-per>'+(ongoing()?'结束':'开始')+'</span></div>';
    else if((rr=inRange(selK,PRED))) h+='<div class="cl-row cl-tap"><div class="ic pk">○</div><div class="tt"><small data-per>经期（预计）</small>预计第 '+(dayDiff(rr[0],selK)+1)+' 天，到时我提醒你</div><span class="cl-act" data-per>'+(ongoing()?'结束':'开始')+'</span></div>';   /* [位置:phone-cal.js·detail 经期行热区] [点「经期」两字或行尾「开始/结束」触发，整行不再是大块热区] [11-17 批5：三行热区收窄到标题文字，与记账/总结语义一致；动作逻辑未变] [注释时间 2026-11-17] */
    var hh=heartOf(selK); if(hh) h+='<div class="cl-row"><div class="ic pk">♥</div><div class="tt"><small>纪念日</small>'+esc(hh)+'</div></div>';
    var tot=0;
    if(ev.exp&&ev.exp.length) tot=ev.exp.filter(function(x){ return !x.inc; }).reduce(function(s,x){ return s+(+x.a||0); },0);
    /* [位置:phone-cal.js·detail 记账行] [记账行右侧「导入」入口] [11-16：旧小应用月历的「导入账单」没搬进新前端；行常驻（没账也显示），点「导入」弹导入账单弹层（openImport），后端接口一直在] [注释时间 2026-11-16] */
    /* [位置:phone-cal.js·detail 记账行热区] [点「记账」标题字记一笔] [11-16 批3：原底部按钮入口挪到行上，「导入」从描边小按钮改成行尾灰字。11-17 批5 收窄：data-exp 标记从整行移到标题 small 上——点「记账」两个字弹「记一笔」，行尾「导入」、金额明细行都不再误触；动作逻辑未变] [注释时间 2026-11-17] */
    h+='<div class="cl-row cl-tap"><div class="ic">¥</div><div class="tt"><div class="cl-fx"><small data-exp>'+(ev.exp&&ev.exp.length?'记账 · 支出合计 ¥'+(Math.round(tot*100)/100):'记账')+'</small><button class="cl-impt tap" type="button" data-imp>导入</button></div>'+
      (ev.exp&&ev.exp.length?ev.exp.map(function(x){ return '<div class="ex"><span>'+esc(x.n)+'</span><em>'+(x.inc?'+':'')+'¥'+x.a+'</em></div>'; }).join(''):'')+'</div></div>';
    var mo=ev.mood||{}, mher=mo.her&&((mo.her.ids&&mo.her.ids.length)||mo.her.custom), mai=mo.ai&&((mo.ai.ids&&mo.ai.ids.length)||mo.ai.custom);
    h+='<div class="cl-row"><div class="ic"><img class="mo-ico" src="'+moodSrc('happy')+'" alt=""></div><div class="tt"><small>这一天的心情</small>'+
      '<div class="mo-ln her tap" data-mo="her"><em>她</em><span class="mo-cs">'+(mher?moodChips(mo.her):'<span class="mo-no">点一下，记这天的心情</span>')+'</span></div>'+
      '<div class="mo-ln"><em>他</em><span class="mo-cs">'+(mai?moodChips(mo.ai):'<span class="mo-no">他还没写</span>')+'</span></div></div></div>';
    h+=statRow(selK);
    /* [位置:phone-cal.js·detail 总结行热区] [点「今日总结」标题字进编辑] [11-16 批3：原底部按钮入口挪到行上。11-17 批5 收窄：data-sum 标记从整行移到标题 small 上——点「今日总结」进编辑；展开后的总结正文走原有折叠/展开交互，不再误触编辑] [注释时间 2026-11-17] */
    h+='<div class="cl-row cl-tap"><div class="ic lv">✎</div><div class="tt"><small data-sum>今日总结</small>'+(ev.sumText?'<div class="cl-dy open"><p>'+esc(ev.sumText)+'</p></div>':'<div class="cl-sum" style="color:var(--ink3)">'+(ev._ok?'这一天还没有总结':'翻一翻…')+'</div>')+'</div></div>';
    var di=diaryAll(ev);
    if(di.length) h+='<div class="cl-row"><div class="ic lv">✎</div><div class="tt"><small>日记 · '+di.length+' 篇</small>'+di.map(function(d){ return '<div class="cl-dy'+(d.hid?' hid':'')+'" data-did="'+d.id+'"><time>'+esc(d.t)+(d.hid?' · 已隐藏':'')+'</time><p>'+esc(d.x)+'</p>'+(d.m?'<em>'+esc(d.m)+'</em>':'')+'<div class="cl-da"><button class="tap" type="button" data-da="edit">编辑</button><button class="tap" type="button" data-da="hide">'+(d.hid?'恢复':'隐藏')+'</button></div></div>'; }).join('')+'</div></div>';
    det.innerHTML=head+h;
    if(fly) anim(det,[{opacity:.2,transform:'translateY(12px)'},{opacity:1,transform:'none'}],{duration:420,easing:'cubic-bezier(.2,.9,.25,1)',fill:'none'});
    if(loaded) fetchDay(selK);
  }
  function openMood(){
    var k=selK, ev=DATA[k]||(DATA[k]={}), cur=(ev.mood&&ev.mood.her)||{ids:[],custom:''}, pick=(cur.ids||[]).slice(), d=fromKey(k);
    moodTable().then(function(t){
      var body='<div class="mo-g">'+t.map(function(m){ return '<button class="mo-p tap" type="button" data-id="'+m.id+'"><img src="'+moodSrc(m.id)+'" alt=""><span>'+esc(m.name)+'</span></button>'; }).join('')+'</div>'+
        '<div class="mo-cu"><img src="'+moodSrc('custom')+'" alt=""><input class="mo-in" maxlength="20" placeholder="自定义：几个字，或一个 emoji" value="'+esc(cur.custom||'')+'"></div>'+
        '<div class="mo-ft"><span class="mo-n"></span>'+((cur.ids&&cur.ids.length)||cur.custom?'<button class="pg-btn red tap" type="button" data-mc="clear">清空</button>':'')+'<button class="pg-btn pri tap" type="button" data-mc="save">保存</button></div>';
      P.pages.sheet(win,k===todayK?'今天的心情':(d.getMonth()+1)+'月'+d.getDate()+'日的心情',body,function(s,close){
        var inp=s.querySelector('.mo-in'), cnt=s.querySelector('.mo-n');
        function total(){ return pick.length+(inp.value.trim()?1:0); }
        function paint(){ Array.prototype.forEach.call(s.querySelectorAll('.mo-p'),function(b){ b.classList.toggle('on',pick.indexOf(b.getAttribute('data-id'))>=0); }); cnt.textContent='已选 '+total()+' / 3'; }
        paint();
        s.addEventListener('click',function(e){
          var b=e.target.closest('.mo-p');
          if(b){ var id=b.getAttribute('data-id'), i=pick.indexOf(id);
            if(i>=0) pick.splice(i,1); else if(total()>=3){ toast('最多选 3 个'); P.shake(b); return; } else pick.push(id);
            paint(); buzz(5); return; }
          var a=e.target.closest('[data-mc]'); if(!a) return;
          if(a.getAttribute('data-mc')==='clear'){
            P.net.get('/monthly/api/mood/'+k+'?side=her',{method:'DELETE'}).then(function(){ if(ev.mood){ delete ev.mood.her; } close(); build(); detail(false); buzz(8); toast('清掉了'); })
              .catch(function(){ toast('没清掉，稍后再试'); }); return; }
          var cv=inp.value.trim();
          if(total()<1){ toast('选一个吧'); return; } if(total()>3){ toast('最多 3 个，先取消一个'); return; }
          P.net.post('/monthly/api/mood/'+k,{side:'her',ids:pick,custom:cv}).then(function(){ ev.mood=ev.mood||{}; ev.mood.her={ids:pick.slice(),custom:cv}; close(); build(); detail(false); buzz(10); toast('记下啦'); })
            .catch(function(){ toast('没保存上，稍后再试'); });
        });
        inp.addEventListener('input',function(){ if(total()>3){ toast('最多 3 个，先取消一个'); } paint(); });
      });
    }).catch(function(){ toast('没读到心情表，稍后再试'); });
  }
  /* [位置:phone-cal.js·openImport] [导入账单弹层] [11-16：把旧小应用月历的账单导入搬进新前端。后端 /monthly/api/finance/import（little-world/backend.py:337）：confirm=false 只解析不落库，confirm=true 按账单日期各自入账，无去重所以确认键置 busy 防重复提交；上传用原生 fetch 发 FormData（P.net.post 只收发 JSON），同源自带登录 cookie；xlsx 由后端按扩展名自动走微信解析器，分段只选「支付宝/微信」；成功 refresh 整月重拉（点、详情一起更新）] [注释时间 2026-11-16] */
  function openImport(){
    var tp='alipay', busy=false, file=null;
    var body='<div class="cl-imp">'+
      '<div class="cl-imp-seg"><button class="tap on" type="button" data-tp="alipay">支付宝</button><button class="tap" type="button" data-tp="wechat">微信</button></div>'+
      '<button class="cl-fp tap" type="button" data-fp><span class="cl-fp-t">点这里选账单文件</span><small>支付宝 CSV，或微信导出的 CSV / xlsx</small></button>'+
      '<input type="file" accept=".csv,.xlsx" class="cl-finput" hidden>'+
      '<div class="cl-imp-r"></div>'+
      '<div class="pg-bts"><button class="pg-btn pri tap" type="button" data-ok style="display:none">确认导入</button></div>'+
    '</div>';
    P.pages.sheet(win,'导入账单',body,function(s,close){
      var inp=s.querySelector('.cl-finput'), fp=s.querySelector('.cl-fp'), fpT=s.querySelector('.cl-fp-t'),
          res=s.querySelector('.cl-imp-r'), okB=s.querySelector('[data-ok]');
      function send(ok){
        var fd=new FormData(); fd.append('file',file); fd.append('type',tp); fd.append('confirm',ok?'true':'false');
        return fetch('/monthly/api/finance/import',{method:'POST',body:fd}).then(function(r){
          return r.text().then(function(t){ var j=null; try{ j=JSON.parse(t); }catch(e){}
            if(!j) throw new Error(r.status===401?'没连上后台，先登录':'服务器没按规矩回话');
            if(j.error) throw new Error(j.error);
            return j; });
        });
      }
      function paint(j){
        var list=j.records||[];
        var rows=list.map(function(x){
          return '<div class="cl-ir"><span class="d">'+esc(String(x.date).slice(5))+'</span><span class="t'+(x.type==='收入'?' in':'')+'">'+esc(x.type)+'</span><span class="n">'+esc(x.note||'')+'</span><b>'+(x.type==='收入'?'+':'-')+'¥'+x.amount+'</b></div>';
        }).join('');
        res.innerHTML='<div class="cl-imp-sum">解析出 '+j.total+' 条'+(j.total>list.length?'（预览前 '+list.length+' 条）':'')+'，确认后按账单上的日期各自入账'+(j.dup?'；其中 '+j.dup+' 条和已有账目相同，会自动跳过':'')+'</div><div class="cl-imp-list">'+rows+'</div>';
        okB.style.display='';
      }
      s.querySelector('.cl-imp-seg').addEventListener('click',function(e){
        var b=e.target.closest('[data-tp]'); if(!b||busy) return;
        tp=b.getAttribute('data-tp');
        Array.prototype.forEach.call(s.querySelectorAll('[data-tp]'),function(x){ x.classList.toggle('on',x===b); });
        if(file) run();   /* 换类型后同一文件要重新解析（两种账单字段不同） */
      });
      fp.addEventListener('click',function(){ if(!busy) inp.click(); });
      inp.addEventListener('change',function(){ if(inp.files[0]){ file=inp.files[0]; fpT.textContent=file.name+'（'+(file.size/1024).toFixed(0)+' KB）'; run(); } });
      function run(){
        if(!file||busy) return; busy=true; okB.style.display='none';
        res.innerHTML='<div class="cl-imp-wait">正在解析…</div>';
        send(false).then(function(j){ busy=false; paint(j); })
          .catch(function(e){ busy=false; res.innerHTML='<div class="cl-imp-err">'+esc((e&&e.message)||'解析失败，检查文件格式')+'</div>'; });
      }
      okB.addEventListener('click',function(){
        if(busy||!file) return; busy=true; okB.disabled=true; okB.textContent='导入中…';
        send(true).then(function(j){ close(); buzz(10); toast('导入了 '+j.written+' 条'+(j.skipped?'，跳过 '+j.skipped+' 条重复':'')); return refresh(); })
          .catch(function(e){ busy=false; okB.disabled=false; okB.textContent='确认导入'; res.innerHTML='<div class="cl-imp-err">'+esc((e&&e.message)||'没导进去，再试一次')+'</div>'; });
      });
    });
  }
  function shift(dm){
    vm+=dm; if(vm<0){ vm=11; vy--; } if(vm>11){ vm=0; vy++; }
    build(); anim(G,[{opacity:0,transform:'translateX('+(dm*34)+'px)'},{opacity:1,transform:'none'}],{duration:400,easing:'cubic-bezier(.2,.9,.25,1)',fill:'none'});
    buzz(5);
  }
  $('#clPrev',win).addEventListener('click',function(){ shift(-1); });
  $('#clNext',win).addEventListener('click',function(){ shift(1); });
  $('#clToday',win).addEventListener('click',function(){
    var dm=(now.getFullYear()-vy)*12+now.getMonth()-vm; selK=todayK;
    if(dm){ vy=now.getFullYear(); vm=now.getMonth(); build(); anim(G,[{opacity:0,transform:'scale(.96)'},{opacity:1,transform:'none'}],{duration:400,easing:'cubic-bezier(.2,.9,.25,1)',fill:'none'}); } else moveSel(true);
    detail(true); buzz(6);
  });
  G.addEventListener('click',function(e){
    var c=e.target.closest('.cl-d'); if(!c) return; var k=c.getAttribute('data-k');
    if(c.classList.contains('out')){ var d=fromKey(k); vy=d.getFullYear(); vm=d.getMonth(); selK=k; build(); }
    else{ selK=k; moveSel(true); }
    detail(true); buzz(5);
  });
  det.addEventListener('click',function(e){
    var da=e.target.closest('[data-da]'); if(da){ e.stopPropagation(); diaryAct(da.getAttribute('data-da'),+da.closest('.cl-dy').getAttribute('data-did')); return; }
    /* [位置:phone-cal.js·det 点击分发] [详情行级动作] [11-16 批3：经期/记账/总结三行动作从底部按钮挪到行上，动作逻辑未变。11-17 批5 收窄热区：data-per/exp/sum 标记挂在各行的标题 small 上（经期行尾「开始/结束」灰字一并挂着），点标题字才触发；行级判断仍在 .cl-dy 折叠判断之前，总结行自己的正文先被行级判断吃掉的问题不存在了（正文无标记，落到折叠分支）] [注释时间 2026-11-16；2026-11-17 热区收窄] */
    if(e.target.closest('[data-per]')){
      var on=!ongoing(), k3=selK, dd=fromKey(k3);
      P.confirm(win,{title:on?'从这天开始记经期？':'经期结束在这天？',msg:(dd.getMonth()+1)+'月'+dd.getDate()+'日。他会收到这条记录。',ok:on?'开始':'结束'},function(){
        P.net.post('/monthly/api/period/toggle',{on:on,date:k3}).then(function(){ loading=null; return refresh(); }).then(function(){ buzz(10); toast(on?'记下了':'好好休息'); })
          .catch(function(){ toast('没成功，稍后再试'); });
      });
      return; }
    if(e.target.closest('[data-imp]')){ openImport(); return; }
    if(e.target.closest('[data-exp]')){
      P.sheet(win,{title:'记一笔',ph:'例如：奶茶 18',hint:'最后一个数字当金额',btn:'记下',onSubmit:function(v){
        var m=v.match(/(\d+(?:\.\d+)?)\s*$/), a=m?parseFloat(m[1]):NaN;
        if(isNaN(a)){ toast('金额写在最后面，比如「奶茶 18」'); return false; }
        var k=selK;
        return P.net.post('/monthly/api/finance/'+k,{type:'支出',amount:a,note:v.replace(m[0],'').trim()||'支出',category:'',by:(P.names&&P.names.me)?P.names.me():'用户'}).then(function(){
          delete (DATA[k]||{})._ok; if(DATA[k]) DATA[k]._busy=false; fetchDay(k); buzz(10); toast('记好了');
        }).catch(function(e){ toast('没记上，内容还在，再点一次'); throw e; });
      }});
      return; }
    if(e.target.closest('[data-sum]')){
      var k2=selK;
      P.sheet(win,{title:'今日总结',ph:'今天过得怎么样…',hint:((P.names&&P.names.ai)?P.names.ai():'助手')+'可以看到',btn:'保存',onSubmit:function(v){
        return P.net.post('/monthly/api/summary/'+k2,{text:v,by:(P.names&&P.names.me)?P.names.me():'用户'}).then(function(){ var ev=DATA[k2]||(DATA[k2]={}); ev.sumText=v; ev.sum=true; ev._ok=true; build(); detail(true); buzz(10); toast('保存啦'); })
          .catch(function(e){ toast('没保存上，内容还在，再点一次'); throw e; });
      }});
      return; }
    if(e.target.closest('.mo-ln.her')){ openMood(); return; }
    var dy=e.target.closest('.cl-dy'); if(dy){ dy.classList.toggle('open'); buzz(5); return; }
  });
  function refresh(){
    return P.net.get('/monthly/api/periods').then(function(r){ RAW=r||[]; return loadAll(); }).then(function(){ build(); detail(false); });
  }
  build(); detail(false);
  P.net.get('/monthly/api/periods').then(function(r){ RAW=r||[]; }).catch(function(){});
  loadAll().then(function(){ build(); detail(false); }).catch(function(){ P.net.offline(); });
  moodTable().then(function(){ detail(false); }).catch(function(){});
  anim($('.cl-card',win),[{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'none'}],{duration:520,easing:'cubic-bezier(.2,.9,.25,1)',fill:'none'});
  setTimeout(function(){ moveSel(false); },80);
}
P.cal={PERIODS:PERIODS,PRED:PRED,DATA:DATA,diaryOf:diaryOf,inRange:inRange,key:key,heartOf:heartOf,load:loadAll};
/* 桌面日历卡也要数据：开机就拉一次 */
setTimeout(function(){ loadAll().catch(function(){}); },800);
window.addEventListener('ph:login',function(){ loading=null; loadAll().catch(function(){}); });
P.register('cal',{html:html,setup:setup});
})();
