/* [位置:phone-jot.js·文件头] [小手机「我的 → 随手记」：工作流/00用户随手记 的网页版] [10-28：想随手记点东西、划掉就算完成，主要是给 AI 看的；数据就是 00 那个文本文件（后端 routes/jotter.js），这里只是读/加/改/删/划，不另存。设计稿：右上笔图标点开输入行（右侧保存勾，下面一排快速分类，保存后整块收起）；列表按分类分组；最下面已完成；长按＝编辑/删除。10-29 二改：去掉滑动划掉手势（容易误触，划掉用勾选钮），保存中锁输入行（连点不重复存）；2026-11-01 #52：划掉后条目由后端直接搬进 归档/00用户随手记_已完成.md，列表不再显示已完成，「已完成」折叠区仅兜底手写已完成格式的存量行] [注释时间 2026-10-28；2026-11-01 改] */
(function(){
"use strict";
var P=window.PH, PG=P.pages, esc=P.esc, buzz=P.buzz, toast=P.toast;
var AB='/heartbeat/admin/jotter';
var SVGF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
var PEN=SVGF+'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
var CHK=SVGF+'<path d="m6.5 12.5 3.8 3.8L17.5 8.5"/></svg>';
var CHEV=SVGF+'<path d="m9 6 6 6-6 6"/></svg>';
/* [位置:phone-jot.js·PNAME] [四个分类的名字] [10-28：☁️优先 🔖方案 🌱计划 🍃再说；文件里只存符号，名字只在快速分类按钮上显示，分组标题只放符号] [注释时间 2026-10-28] */
var PNAME={'☁️':'优先','🔖':'方案','🌱':'计划','🍃':'再说'};   /* 默认分类=☁️优先（10-29：之前一直是🔖方案，顺手修掉） */
function pn(p){ return PNAME[p]||''; }

/* [位置:phone-jot.js·open] [随手记入口] [「我的」页单独一行进来。未完成按分类分组（☁️🔖🌱🍃，组内保持文件里的先后），已完成放最下面] [注释时间 2026-10-28] */
function open(win){
  var st={items:[],head:'',pris:['☁️','🔖','🌱','🍃'],fold:false,ok:false,editId:'',pri:'☁️'};
  var s=PG.sub(win,'随手记',
    '<div class="jt"><div class="jt-cp"><div class="jt-cpi"><div class="pg-g jt-cg"><div class="jt-in"><span class="jt-sq"></span><textarea class="jt-ti" rows="1" placeholder="请输入…" maxlength="300" enterkeyhint="done"></textarea><button type="button" class="jt-sv" aria-label="保存">'+CHK+'</button></div><div class="jt-qc"></div></div></div></div>'+
    '<div class="jt-box"><div class="pg-empty">读取中…</div></div></div>',
    {right:'<button class="pg-cb tap" data-go="jtpen" aria-label="记一条">'+PEN+'</button>',
     go:function(k){ if(k==='jtpen'){ buzz(6); if(cp.classList.contains('open')&&!st.editId) closeCp(); else openCp(''); } }});
  var box=s.querySelector('.jt-box'), cp=s.querySelector('.jt-cp'), ti=s.querySelector('.jt-ti'), qc=s.querySelector('.jt-qc');

  function rank(p){ var i=st.pris.indexOf(p); return i<0?9:i; }
  function row(x,showPri){
    return '<div class="jt-sw" data-id="'+esc(x.id)+'">'+
      '<div class="jt-it'+(x.done?' done':'')+'"><button class="jt-chk" aria-label="'+(x.done?'撤回':'完成')+'">'+CHK+'</button>'+
      (showPri?'<span class="jt-p">'+esc(x.pri)+'</span>':'')+'<div class="jt-tx"><span>'+esc(x.text)+'</span>'+(x.done&&x.doneAt?'<em>'+esc(x.doneAt)+'</em>':'')+'</div></div></div>';
  }
  function paint(){
    var done=st.items.filter(function(x){ return x.done; }), h='', n=0;
    if(st.head) h+='<div class="jt-hd">'+esc(st.head)+'</div>';
    st.pris.concat(st.items.map(function(x){ return x.pri; }).filter(function(p){ return st.pris.indexOf(p)<0; })).filter(function(p,i,a){ return a.indexOf(p)===i; }).forEach(function(p){
      var g=st.items.filter(function(x){ return !x.done&&x.pri===p; }); if(!g.length) return; n+=g.length;
      h+='<div class="jt-gh"><span>'+esc(p)+'</span><b>'+g.length+'</b></div><div class="pg-g jt-g">'+g.map(function(x){ return row(x,false); }).join('')+'</div>';
    });
    if(!n) h+='<div class="pg-empty">'+(done.length?'都划掉了，进了归档':'空的，点右上角笔记一条')+'</div>';
    if(done.length) h+='<button class="jt-fold'+(st.fold?'':' open')+'" data-fold="1">已完成 <b>'+done.length+'</b>'+CHEV+'</button>'+
      (st.fold?'':'<div class="pg-g jt-g jt-dn">'+done.slice().reverse().map(function(x){ return row(x,true); }).join('')+'</div>');
    box.innerHTML=h;
  }
  function apply(r){ st.items=r.items||[]; st.head=r.head||''; if(r.pris&&r.pris.length) st.pris=r.pris; st.ok=true; paint(); }
  function load(){
    P.net.get(AB).then(function(r){ if(r&&r.ok) apply(r); else fail((r&&r.msg)||'读不到'); },function(e){ fail(e&&e.status===404?'后台还没带上随手记接口，重启一下 gateway 就好':'没连上后台'); });   /* 404＝后端没重启，路由还没加载，别说成断网 */
  }
  function fail(msg){
    if(st.ok){ toast(msg); return; }
    box.innerHTML='<div class="pg-empty">'+esc(msg)+'</div>';
    var b=document.createElement('button'); b.className='pg-btn tap'; b.textContent='重试'; b.onclick=function(){ box.innerHTML='<div class="pg-empty">读取中…</div>'; load(); }; box.appendChild(b);
  }

  /* [位置:phone-jot.js·输入行] [右上笔图标点开的输入行：保存勾 + 一排快速分类；新建和编辑共用，保存（或再点笔图标）后整块收起] [10-28 设计稿，「快速分类是新建的时候有，保存完就收起」] [注释时间 2026-10-28] */
  function paintChips(){
    qc.innerHTML=st.pris.map(function(p){ return '<button type="button" class="jt-c'+(p===st.pri?' on':'')+'" data-p="'+esc(p)+'">'+esc(p)+(pn(p)?'<i>'+esc(pn(p))+'</i>':'')+'</button>'; }).join('');
  }
  function openCp(id){
    var x=id?st.items.filter(function(z){ return z.id===id; })[0]:null;
    st.editId=x?x.id:''; st.pri=x?x.pri:(st.pris.indexOf(st.pri)>=0?st.pri:'☁️'); ti.value=x?x.text:''; ti.placeholder=x?'改一下…':'请输入…'; grow();
    paintChips(); cp.classList.add('open'); cp.classList.toggle('edit',!!x);
    setTimeout(function(){ try{ ti.focus(); }catch(_){} },260);
  }
  function closeCp(){ cp.classList.remove('open','edit'); st.editId=''; ti.blur(); }
  qc.addEventListener('click',function(e){ var c=e.target.closest('.jt-c'); if(!c) return; buzz(5); st.pri=c.dataset.p; paintChips(); });
  function save(){
    if(st._busy) return;   /* 在途锁：请求没回来前再点保存/回车不重发（10-29：点三下存了三条） */
    var v=ti.value.trim(); if(!v){ P.shake(cp.querySelector('.jt-in')); return; }
    var url=st.editId?AB+'/edit':AB+'/add', body=st.editId?{id:st.editId,text:v,pri:st.pri}:{text:v,pri:st.pri}, was=!!st.editId;
    st._busy=1;
    P.net.post(url,body).then(function(r){
      st._busy=0;
      if(r&&r.ok){ apply(r); closeCp(); ti.value=''; grow(); buzz([10,40,10]); toast(was?'改好了':'记下了'); flash(r.added||r.edited); }
      else { toast((r&&r.msg)||'没保存上'); load(); }   /* 失败也刷新：万一后台存上了，界面别显示旧的 */
    },function(e){ st._busy=0; toast(e&&e.status===404?'这条找不到了，刷新看看':'没保存上，没连上后台'); if(e&&e.status===404){ closeCp(); load(); } else load(); });
  }
  s.querySelector('.jt-sv').addEventListener('click',save);
  /* [位置:phone-jot.js·grow/flash] [多行输入 + 保存即显 + 保存在途锁] [10-29：输入框只有一行高，长内容看不见；记下了列表也不动，得退出重进——① textarea 随内容长高（存仍单行，00 文件一行一条，Enter 还是保存）；② 保存成功把新条目滚进视口并闪一下，肉眼立刻确认；③ 10-29：保存键点三下存了三条——请求在途时再点不重发，回来才解锁] [注释时间 2026-10-29] */
  function grow(){ ti.style.height='auto'; ti.style.height=Math.min(ti.scrollHeight,132)+'px'; }
  ti.addEventListener('input',grow);
  function flash(id){
    if(!id||!/^[-\w]+$/.test(String(id))) return;
    var el=box.querySelector('.jt-sw[data-id="'+id+'"]'); if(!el) return;
    try{ el.scrollIntoView({block:'center',behavior:'smooth'}); }catch(_){}
    el.classList.add('jt-new'); setTimeout(function(){ el.classList.remove('jt-new'); },1400);
  }
  ti.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); save(); } });

  /* 划掉 / 撤回：先本地标上（划线动画），再发给后端；后端回的整表覆盖本地。失败就还原并提示 */
  function flip(sw){
    if(!sw||sw._bz) return; sw._bz=1;
    var id=sw.dataset.id, it=sw.querySelector('.jt-it'), x=st.items.filter(function(z){ return z.id===id; })[0]; if(!x){ return; }
    var to=!x.done; buzz(to?[10,40,10]:8);
    it.classList.toggle('done',to);
    P.net.post(AB+'/toggle',{id:id,done:to}).then(function(r){
      setTimeout(function(){ if(r&&r.ok) apply(r); else { sw._bz=0; it.classList.toggle('done',!to); toast((r&&r.msg)||'没划成'); } },to?520:260);
    },function(e){ sw._bz=0; it.classList.toggle('done',!to); toast(e&&e.status===404?'这条找不到了，刷新看看':'没划成，没连上后台'); if(e&&e.status===404) load(); });
  }
  box.addEventListener('click',function(e){
    var f=e.target.closest('[data-fold]'); if(f){ buzz(5); st.fold=!st.fold; paint(); return; }
    var c=e.target.closest('.jt-chk'); if(c) flip(c.closest('.jt-sw'));
  });


  /* [位置:phone-jot.js·长按菜单] [长按一条出「编辑 / 删除」；编辑＝打开顶上输入行并带上原文和分类，删除先确认] [10-28 设计稿] [注释时间 2026-10-28] */
  PG.hold(box,function(el){
    var sw=el.closest('.jt-sw'); if(!sw) return; var id=sw.dataset.id;
    var x=st.items.filter(function(z){ return z.id===id; })[0]; if(!x) return;
    buzz([10,30,10]);
    PG.sheet(win,'这一条','<div class="pg-g">'+PG.r({t:'编辑',act:'ed'})+PG.r({t:'删除',act:'del',red:1})+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){
        var b=e.target.closest('[data-act]'); if(!b) return; close();
        if(b.dataset.act==='ed'){ s.querySelector('.pg-sc').scrollTo({top:0,behavior:'smooth'}); openCp(id); }
        else PG.confirm(win,'删除这一条？',esc(x.text.length>40?x.text.slice(0,40)+'…':x.text),'删除',true,function(){
          P.net.post(AB+'/delete',{id:id}).then(function(r){ if(r&&r.ok){ apply(r); toast('删掉了'); } else toast((r&&r.msg)||'没删掉'); },
            function(er){ toast(er&&er.status===404?'这条找不到了，刷新看看':'没删掉，没连上后台'); if(er&&er.status===404) load(); });
        });
      });
    });
  },'.jt-it');
  load();
  return s;
}
P.jot={open:open};
})();
