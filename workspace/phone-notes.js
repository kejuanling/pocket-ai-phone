/* 小手机 · 笔记本（批 B 重做，2026-10-22）
   列表式：搜索、卡片（标题 + 一句话摘要 + 更新时间 + 关键词）、阅读 / 编辑 / 删除 / 新建。
   数据只有一份（服务器 data/papers.json）：用户写的和谢（AI）写的完全同款，一样有 标题 / 正文 / 一句话摘要 / 创建原因（缺失显示「无」）。
   「关键词」只有这里看得到、写得了，谢看不到。置顶的「笔记本目录」是系统自动维护的只读笔记（所有笔记的 id｜标题｜摘要｜更新时间）。
   接口（网关口令）：GET /papers/api/notes[?q=] · GET /papers/api/note?id= · POST /papers/api/note/{add,update,delete,import}
   这台手机上旧本子写的 ph.note.v2 会在第一次打开时自动并进服务器（服务器先备份原文），成功后本机不再保留。
   [位置:phone-notes.js·文件头] [文件夹化] [10-28：参考工作流页做成文件管理——先列文件夹再列笔记，点文件夹进去（一层一页）；右上 + 选「新建文件夹 / 新建笔记」，笔记建在当前文件夹；长按笔记：编辑 / 移动到 / 删除；长按文件夹：重命名 / 删除（只能删空的）；搜索不分文件夹，全局找，结果带位置。接口多了 POST note/move、folder/add、folder/rename、folder/delete，列表带 folder 与 folders。
   10-29：文件夹也有摘要——长按文件夹菜单加「编辑摘要」（留空=清掉）；文件夹行小字=篇数+摘要；
   笔记本目录改树形：文件夹行 fid｜路径｜摘要（默认闭合不列里面的文件），文件行 id｜标题｜摘要（只列根目录的，去更新时间）。
   接口多 POST folder/summary；folders 响应改 [{path,summary,count}]（兼容旧字符串数组）] [注释时间 2026-10-29] */
(function(){
"use strict";
var P=window.PH, G=P&&P.pages; if(!G) return;
var $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast, sub=G.sub, confirmBox=G.confirm, bgo=P.bgo, bend=P.bend, later=P.later;
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
var IC={plus:svg('<path d="M12 5v14M5 12h14"/>'),find:svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>'),
  edit:svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),trash:svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>'),
  lock:svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  refresh:svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  gear:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  right:svg('<path d="M9 6l6 6-6 6"/>'),
  ok:svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  dots:svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>')}; /* 10-29：目录刷新；11-21：齿轮设置；11-25：多本切本图标（右箭头展开旋90°向下） */
var B='/papers/api/';

/* 时间：今年的不写年；今天写「今天 HH:mm」 */
function when(iso){ var d=P.net.parse(iso); if(!d) return ''; var n=new Date(), two=P.net.two, hm=two(d.getHours())+':'+two(d.getMinutes());
  if(d.toDateString()===n.toDateString()) return '今天 '+hm;
  return (d.getFullYear()===n.getFullYear()?'':d.getFullYear()+'-')+two(d.getMonth()+1)+'-'+two(d.getDate())+' '+hm; }
/* 正文轻量渲染：转义 → 行首 # 变小标题 → **加粗** */
function md(t){ return esc(String(t||'')).replace(/^#{1,6}\s*(.+)$/gm,'<h4>$1</h4>').replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); }
function mark(txt,terms){ var h=esc(txt||''); terms.forEach(function(t){ if(!t) return; var e=esc(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); h=h.replace(new RegExp(e,'gi'),function(m){ return '<mark>'+m+'</mark>'; }); }); return h; }
/* [位置:phone-notes.js·indexRows] [目录笔记树形渲染] [10-29：文件夹行 fid｜路径｜摘要（行首全角空格=层级缩进），文件行 id｜标题｜摘要；兼容旧的四栏带时间] [注释时间 2026-10-29] */
function indexRows(body){
  return String(body||'').split('\n').filter(function(l){ return l.trim(); }).map(function(l){
    var lead=(l.match(/^　+/)||[''])[0], dep=lead.length, a=l.slice(lead.length).split('｜');
    if(/^f\d+$/.test(a[0].trim())&&a.length===3) return '<div class="r" style="padding-left:'+(14*dep)+'px"><b>'+esc(a[0])+'</b><span><u>'+esc(a[1])+'</u><i>'+esc(a[2])+'</i></span></div>';
    if(a.length===3&&/^\d+$/.test(a[0].trim())) return '<div class="r"'+(dep?' style="padding-left:'+(14*dep)+'px"':'')+'><b>'+esc(a[0])+'</b><span><u>'+esc(a[1])+'</u><i>'+esc(a[2])+'</i></span></div>';
    if(a.length===4&&/^\d+$/.test(a[0].trim())) return '<div class="r"><b>'+esc(a[0])+'</b><span><u>'+esc(a[1])+'</u><i>'+esc(a[2])+'</i></span><time>'+esc(a[3].replace(/^\d{4}-/,''))+'</time></div>';
    return '<p>'+esc(l)+'</p>'; }).join('');
}
function tagsOf(s){ return String(s||'').split(/[\s,，、;；]+/).filter(Boolean).filter(function(v,i,a){ return a.indexOf(v)===i; }).slice(0,30).map(function(v){ return v.slice(0,40); }); }

function html(){
  /* 外面包一层 .pg：阅读 / 编辑子页（G.sub）打开时，底下这层会像配置页一样退到左边变淡，不会透出页头的按钮 */
  /* [位置:phone-notes.js·html] [右上角齿轮设置 + 右下角悬浮新建] [11-21：原右上角＋换成齿轮进笔记本设置（模型+提示词），新建按钮悬浮在右下角并在滚动时变淡] [注释时间 2026-11-21] */
  /* [位置:phone-notes.js·html] [跟手连续上滑吸顶顶栏 + 顶部极简「笔记本」大标题] [11-25：大标题与搜索框置于滚动容器内随手指自然上滑，按滚动进度连续驱动顶栏中间「本子名 ›」+ 紧凑搜索框无跳变淡入] [注释时间 2026-11-25] */
  var hdMid='<div class="nt-hdmid">'+
    '<button type="button" class="nt-hdnb tap" id="ntHdNb" aria-expanded="false" aria-label="切换笔记本"><span class="nt-hdnb-t" id="ntHdName">默认笔记本</span><span class="nt-hdnb-a">'+IC.right+'</span></button>'+
    '<label class="nt-hdq">'+IC.find+'<input id="ntQ2" type="search" placeholder="搜索" autocomplete="off" enterkeyhint="search"></label></div>';
  return '<div class="content td nt"><div class="pg" id="ntPg">'+P.head('',hdMid+'<button class="ibtn tap" id="ntSet" aria-label="笔记本设置">'+IC.gear+'</button>')+
    '<div class="sc" id="ntSc">'+
      '<div class="nt-hero" id="ntHero">'+
        '<div class="ltitle" id="ntHeroT"><div><h1>笔记本</h1><div class="sub" id="ntSub">&nbsp;</div></div></div>'+
        '<label class="nt-q">'+IC.find+'<input id="ntQ" type="search" placeholder="搜索标题、摘要、正文、关键词" autocomplete="off" enterkeyhint="search"></label>'+
      '</div>'+
      '<div class="nt-list" id="ntList"></div>'+
    '</div>'+
    '<button class="nt-fab tap" id="ntAdd" type="button" aria-label="新建">'+IC.plus+'</button></div></div>';
}

function setup(win){
  var initNb='default';
  try{ if(P._wantNb){ initNb=String(P._wantNb); P._wantNb=''; } else { var sv=localStorage.getItem('nt_cur_nb'); if(sv) initNb=sv; } }catch(e){}
  var S={nb:initNb,books:[{id:'default',name:'默认笔记本',builtin:true,count:0}],all:[],res:[],folders:[],q:'',st:'load',live:false,seqA:0,seqS:0}, list=$('#ntList',win), q=$('#ntQ',win), q2=$('#ntQ2',win), subEl=$('#ntSub',win), hdNameEl=$('#ntHdName',win), hdNbBtn=$('#ntHdNb',win), pgEl=$('#ntPg',win), scEl=$('#ntSc',win), first=true, lastHold=0;
  function nbQs(extra){ var p=[]; if(S.nb&&S.nb!=='default') p.push('nb='+encodeURIComponent(S.nb)); if(extra) p.push(extra); return p.length?('?'+p.join('&')):''; }
  function nbBody(o){ var r=Object.assign({},o||{}); if(S.nb&&S.nb!=='default') r.nb=S.nb; return r; }
  function nbCacheKey(k){ return (!S.nb||S.nb==='default')?k:(k+':'+S.nb); }
  function curBook(){ for(var i=0;i<S.books.length;i++) if(S.books[i].id===S.nb) return S.books[i]; return S.books[0]||{id:'default',name:'默认笔记本',builtin:true}; }
  function paintNbTitle(){ if(hdNameEl) hdNameEl.textContent=curBook().name||'默认笔记本'; }
  function fetchBooks(){
    return P.net.get(B+'notebooks').then(function(r){
      var L=(r&&Array.isArray(r.notebooks)&&r.notebooks.length)?r.notebooks:[{id:'default',name:'默认笔记本',builtin:true,count:0}];
      S.books=L;
      if(!L.some(function(b){ return b.id===S.nb; })){ S.nb='default'; try{ localStorage.setItem('nt_cur_nb','default'); }catch(e){} }
      paintNbTitle();
      return L;
    },function(){ paintNbTitle(); return S.books; });
  }
  function switchBook(id){
    var nid=id||'default';
    if(nid===S.nb&&S.st==='ok') return;
    S.nb=nid; S.q=''; if(q) q.value=''; if(q2) q2.value=''; S.res=[]; S.all=[]; S.folders=[]; first=true;
    try{ localStorage.setItem('nt_cur_nb',nid); }catch(e){}
    Array.prototype.forEach.call(win.querySelectorAll('.pg-sub [data-x="back"]'),function(b){ b.click(); });
    paintNbTitle();
    (function(){ var c=P.net.peek(nbCacheKey('notes')); if(c&&c.length){ S.st='ok'; S.all=c; S.folders=(P.net.peek(nbCacheKey('notefolders'))||[]).map(function(f){ return typeof f==='string'?{path:f,summary:'',count:0}:f; }); } })();
    render(); fetchList();
  }
  /* [位置:phone-notes.js·openNbDrop] [就地下拉框切本与管理] [11-25：点击锚点正下方展开下拉浮层，箭头右→下旋转 90°，点外部收起] [注释时间 2026-11-25] */
  var ddClose=null;
  function openNbDrop(anchor){
    if(ddClose){ ddClose(); return; }
    var host=win.querySelector('.content')||win, hr=host.getBoundingClientRect();
    var ar=(anchor||hdNbBtn).getBoundingClientRect();
    var scr=document.createElement('div'); scr.className='nt-dd-sc';
    var pop=document.createElement('div'); pop.className='nt-dd';
    function inner(){
      return '<div class="nt-dd-list">'+S.books.map(function(b){
        var on=b.id===S.nb;
        return '<div class="nt-dd-it tap'+(on?' on':'')+'" data-nbid="'+esc(b.id)+'">'+
          '<span class="nt-dd-nm">'+esc(b.name)+'</span>'+
          '<span class="nt-dd-cnt">'+(b.count||0)+'</span>'+
          (on?'<span class="nt-dd-ck">'+IC.ok+'</span>':'')+
          (!b.builtin?'<button type="button" class="nt-dd-more tap" data-nbact="'+esc(b.id)+'" aria-label="管理笔记本">'+IC.dots+'</button>':'')+
          '</div>';
      }).join('')+'</div><div class="nt-dd-sep"></div>'+
      '<button type="button" class="nt-dd-add tap" data-nbnew>'+IC.plus+'<span>新建笔记本</span></button>';
    }
    pop.innerHTML=inner();
    host.appendChild(scr); host.appendChild(pop);
    var tp=Math.max(8,ar.bottom-hr.top+6), lf=Math.max(12,Math.min(ar.left-hr.left,hr.width-230));
    pop.style.top=Math.round(tp)+'px'; pop.style.left=Math.round(lf)+'px';
    if(hdNbBtn){ hdNbBtn.classList.add('open'); hdNbBtn.setAttribute('aria-expanded','true'); }
    requestAnimationFrame(function(){ pop.classList.add('show'); });
    function close(){
      if(!ddClose) return;
      ddClose=null;
      if(hdNbBtn){ hdNbBtn.classList.remove('open'); hdNbBtn.setAttribute('aria-expanded','false'); }
      pop.classList.remove('show'); scr.remove();
      setTimeout(function(){ pop.remove(); },200);
    }
    ddClose=close;
    scr.addEventListener('click',close);
    fetchBooks().then(function(){ if(pop.isConnected) pop.innerHTML=inner(); });
    pop.addEventListener('click',function(e){
      var m=e.target.closest('[data-nbact]');
      if(m){ e.stopPropagation(); buzz(6); var bid=m.getAttribute('data-nbact'), bk=S.books.filter(function(x){ return x.id===bid; })[0]; if(!bk) return;
        close();
        G.sheet(win,esc(bk.name),'<div class="pg-g">'+G.r({t:'重命名',act:'ren'})+G.r({t:'删除笔记本',act:'del',red:1})+'</div>',function(sh2,close2){
          sh2.addEventListener('click',function(ev){
            var a=ev.target.closest('[data-act]'); if(!a) return; close2();
            if(a.dataset.act==='ren'){
              askName('重命名笔记本',bk.name,'保存',function(v){
                P.net.post(B+'notebooks/rename',{id:bid,name:v}).then(function(){ toast('改好了'); fetchBooks(); },function(er){ toast(whyOf(er,'没改成')); });
              },'笔记本名字');
            } else {
              confirmBox(win,'删除「'+esc(bk.name)+'」？','里面所有笔记会先备份再移出列表。','删除',true,function(){
                P.net.post(B+'notebooks/delete',{id:bid}).then(function(){
                  toast('删掉了');
                  var wasCur=(S.nb===bid);
                  fetchBooks().then(function(){ if(wasCur) switchBook('default'); });
                },function(er){ toast(whyOf(er,'没删掉')); });
              });
            }
          });
        });
        return; }
      if(e.target.closest('[data-nbnew]')){
        buzz(6); close();
        askName('新建笔记本','','创建',function(v){
          P.net.post(B+'notebooks/add',{name:v}).then(function(r){
            toast('建好了');
            var nid=r&&r.notebook&&r.notebook.id;
            fetchBooks().then(function(){ if(nid) switchBook(nid); });
          },function(er){ toast(whyOf(er,'没建上')); });
        },'比如：干活的、rp专用');
        return; }
      var row=e.target.closest('[data-nbid]');
      if(row){ buzz(6); var to=row.getAttribute('data-nbid'); close(); switchBook(to); }
    });
  }

  function parentOf(p){ var i=p.lastIndexOf('/'); return i<0?'':p.slice(0,i); }
  function baseName(p){ return p.slice(p.lastIndexOf('/')+1); }
  function whyOf(e,dflt){ var m=String(e&&e.message||''), j=m.match(/\{[\s\S]*\}/); try{ var o=JSON.parse(j[0]); if(o&&o.error) return o.error; }catch(x){} return dflt; }
  function card(n,i){
    var terms=S.q?S.q.toLowerCase().split(/\s+/).filter(Boolean):[];
    var sum=S.q&&n.preview?mark(n.preview,terms):(n.summary?esc(n.summary):'<i class="nt-none">无</i>');
    /* [位置:phone-notes.js·card] [列表卡片去掉关键词] [11-21：关键词只在阅读页内展示，列表外只留标题、摘要、时间与搜索位置标签，不拥挤] [注释时间 2026-11-21] */
    return '<div class="nt-card tap'+(n.is_index?' idx':'')+'" data-id="'+n.id+'"'+(first?' style="--i:'+Math.min(i,10)+'"':'')+'>'+
      '<div class="nt-h"><b class="nt-t">'+(n.title?mark(n.title,terms):'<i class="nt-none">无标题</i>')+(n.pinned?'<span class="nt-pin">·已置顶</span>':'')+'</b>'+(n.is_index?'<span class="nt-badge">'+IC.lock+'目录</span>':'')+'</div>'+
      '<div class="nt-s">'+sum+'</div>'+
      '<div class="nt-m"><time>'+esc(when(n.updated_at))+'</time>'+(S.q&&n.folder?'<span class="nt-fp">'+esc(n.folder)+'</span>':'')+'</div></div>';
  }
  /* [位置:phone-notes.js·listHTML] [文件夹行小字带摘要] [10-29：篇数和摘要都显示；count 后端算好带来，前端不再数] [注释时间 2026-10-29] */
  function listHTML(dir){
    var fds=S.folders.filter(function(f){ return parentOf(f.path)===dir; });
    var ns=S.all.filter(function(n){ return n.is_index?dir==='':(n.folder||'')===dir; });
    var h='';
    if(fds.length) h+='<div class="pg-g nt-fg">'+fds.map(function(f){ var s=f.count+' 篇'+(f.summary?' · '+f.summary:''); return G.r({ic:'layers',t:esc(baseName(f.path)),s:esc(s),go:'ntdir',cls:'nt-fr',data:' data-p="'+esc(f.path)+'"'}); }).join('')+'</div>';
    /* [位置:phone-notes.js·listHTML 置顶排前] [置顶的笔记排最前] [11-02：当前视图内置顶组前置、组内仍按创建时间；搜索结果不调序] [注释时间 2026-11-02] */
    h+=ns.slice().sort(function(a,b){ return (b.pinned?1:0)-(a.pinned?1:0); }).map(card).join('');
    if(!fds.length&&!ns.length) h='<div class="td-empty">'+(dir?'这个文件夹是空的，点右上角 + 新建':'还没有笔记，点右上角写第一篇')+'</div>';
    return h;
  }
  /* [位置:phone-notes.js·render] [手势中推迟重画] [打开先画缓存、后台回来再整段重画；搜索还有 260ms 防抖重画，落在按下与抬起之间就把按下的卡片摘掉了] [注释时间 2026-10-27] */
  function render(){
    if(P.afterGesture&&!P.afterGesture('notes',render)) return;
    if(S.st!=='ok'){ list.innerHTML=S.st==='load'?P.net.loadBox():P.net.failBox(); subEl.innerHTML='&nbsp;'; return; }
    var real=S.all.filter(function(n){ return !n.is_index; }).length;
    var nbNm=curBook().name||'';
    subEl.textContent=S.q?('找到 '+S.res.length+' 条'):((nbNm?nbNm+' · ':'')+real+' 篇'+(S.folders.length?' · '+S.folders.length+' 个文件夹':''));
    list.innerHTML=S.q?(S.res.length?S.res.map(card).join(''):'<div class="td-empty">没找到</div>'):listHTML('');
    Array.prototype.forEach.call(win.querySelectorAll('.nt-dirbox'),function(b){ b.innerHTML=listHTML(b.dataset.dir); });
    if(first){ Array.prototype.forEach.call(list.querySelectorAll('.nt-card'),function(el){ el.classList.add('rise'); }); first=false; }
  }
  function fetchAll(){
    var my=++S.seqA;
    if(!S.all.length){ S.st='load'; render(); }
    return P.net.get(B+'notes'+nbQs()).then(function(r){ if(my!==S.seqA) return; S.live=true; S.st='ok'; S.staleOnce=false; S.all=(r&&r.notes)||[]; S.folders=((r&&r.folders)||[]).map(function(f){ return typeof f==='string'?{path:f,summary:'',count:0}:f; }); P.net.keep(nbCacheKey('notes'),S.all); P.net.keep(nbCacheKey('notefolders'),S.folders); render(); },
      function(){ if(my!==S.seqA) return; if(P.net.offline) P.net.offline(); S.live=false; if(S.all.length){ if(!S.staleOnce){ S.staleOnce=true; P.toast('没连上，先显示上次的内容'); } return; } S.st='fail'; render(); });   /* [2026-11-17 批5] 拿着旧缓存的降级路径 toast 一次（S.staleOnce 成功后复位），不再静默装作是最新 */
  }
  function fetchSearch(){
    var my=++S.seqS;
    return P.net.get(B+'notes'+nbQs('q='+encodeURIComponent(S.q))).then(function(r){ if(my!==S.seqS||!S.q) return; S.res=(r&&r.notes)||[]; render(); },function(){});
  }
  function fetchList(){ var a=fetchAll(); if(S.q) fetchSearch(); return a; }
  function find(id){ var L=S.all.concat(S.res); for(var i=0;i<L.length;i++) if(L[i].id===id) return L[i]; }

  /* ---- 本机旧本子（ph.note.v2）→ 服务器：服务器先把原文备份再逐条入库（幂等），成功才清本机 ---- */
  function migrate(){
    var raw=null, arr; try{ raw=localStorage.getItem('ph.note.v2'); }catch(e){} if(!raw) return;
    try{ arr=JSON.parse(raw); }catch(e){ return; } if(!Array.isArray(arr)||!arr.length) return;
    var notes=arr.map(function(n){ return {ts:n.ts,title:n.t,content:(n.p||[]).join('\n\n'),tags:n.g||[]}; }).filter(function(n){ return n.content&&n.content.trim(); });
    if(!notes.length) return;
    P.net.post(B+'note/import',{notes:notes,raw:raw}).then(function(r){
      if(!r||!r.success) return; try{ localStorage.removeItem('ph.note.v2'); }catch(e){}
      if(r.added) toast('这台手机上写的 '+r.added+' 篇笔记并进来了'); fetchList();
    }).catch(function(){});
  }

  /* ---- 阅读 ---- */
  var reader=null;
  function openReader(id){
    var n=find(id); if(!n) return;
    /* [位置:phone-notes.js·openReader] [目录刷新按钮] [10-29：目录是系统自动重写的，右上角给个手动刷新兜底（格式升级/没跟上时用）] [注释时间 2026-10-29] */
    var acts=n.is_index?'<span class="nt-acts"><button class="pg-cb tap" data-nt="rf" aria-label="刷新目录">'+IC.refresh+'</button></span>':'<span class="nt-acts"><button class="pg-cb tap" data-nt="edit" aria-label="编辑">'+IC.edit+'</button><button class="pg-cb tap" data-nt="del" aria-label="删除">'+IC.trash+'</button></span>';
    var s=sub(win,'','<div class="nt-rd" id="ntRd"></div>',{right:acts,setup:function(s,close){
      reader={el:s,id:id,close:close};
      var box=s.querySelector('#ntRd'), cur=n;
      function paint(d){
        cur=d;
        box.innerHTML='<h2 class="nt-rt">'+(d.title?esc(d.title):'<i class="nt-none">无标题</i>')+(d.pinned?'<span class="nt-pin">·已置顶</span>':'')+'</h2>'+
          '<div class="nt-rm">创建 '+esc(when(d.created_at))+(d.updated_at&&d.updated_at!==d.created_at?' · 更新 '+esc(when(d.updated_at)):'')+(d.folder?' · 位置 '+esc(d.folder):'')+'</div>'+
          '<div class="nt-info"><div><label>一句话摘要</label><p>'+(d.summary?esc(d.summary):'<i class="nt-none">无</i>')+'</p></div>'+
          '<div><label>创建原因</label><p>'+(d.reason?esc(d.reason):'<i class="nt-none">无</i>')+'</p></div>'+
          ((d.tags||[]).length?'<div><label>关键词</label><p class="nt-ks">'+d.tags.map(function(t){ return '<span class="nt-k">'+esc(t)+'</span>'; }).join('')+'</p></div>':'')+'</div>'+
          (d.is_index?'<div class="nt-ix">'+indexRows(d.body)+'</div>':'<div class="nt-bd">'+md(d.body)+'</div>');
      }
      function load(){ box.innerHTML=P.net.loadBox(); P.net.get(B+'note'+nbQs('id='+id)).then(paint,function(){ box.innerHTML=P.net.failBox(); }); }
      reader.refresh=load;
      s.addEventListener('click',function(e){
        if(e.target.closest('[data-retry]')){ load(); return; }
        var b=e.target.closest('[data-nt]'); if(!b) return; buzz(6);
        if(b.dataset.nt==='rf'){ post('index/refresh',{},'目录已刷新',function(){ if(reader&&reader.refresh) reader.refresh(); }); return; }
        if(b.dataset.nt==='edit'){ if(cur&&cur.body!=null) openEditor(cur,''); return; }
        if(b.dataset.nt==='del') confirmBox(win,'删除这篇笔记？','删除后笔记本里就没有它了。','删除',true,function(){
          if(!S.live){ toast('没连上后台，没删成'); return; }
          P.net.post(B+'note/delete',nbBody({id:id})).then(function(){ close(); toast('删掉了'); fetchList(); },function(){ toast('没删掉，稍后再试'); buzz([20,30,20]); }); });
      });
      s.querySelector('[data-x="back"]').addEventListener('click',function(){ reader=null; });
      load();
    }});
    return s;
  }

  /* ---- 编辑 / 新建（d 为空 = 新建）---- */
  function fd(label,inner){ return '<div class="pv-fd"><label>'+label+'</label>'+inner+'</div>'; }
  /* [位置:phone-notes.js·growTa] [编辑页多行框随内容长高] [11-16：摘要/创建原因/关键词以前是单行 input，长句只能横向滚一行；改成 textarea 后按内容量高，封顶读元素的 max-height（摘要类=42% 窗口、标题=3 行），超了框内滚。量高推迟到下一帧：编辑页是先渲染再挂进 sheet，没挂上时 scrollHeight 是 0，直接量会把高度压扁；空值回落到 rows 的初始行数] [注释时间 2026-11-16] */
  function growTa(f){ if(!f) return; requestAnimationFrame(function(){
    if(!f.isConnected) return;
    var cap=parseFloat(getComputedStyle(f).maxHeight)||0;
    /* 11-16 实测：textarea 设 height:auto 会退回 rows 的行数（不是内容高），拿 scrollHeight-clientHeight 去补会凭空多一行。所以先压成 0 再读 scrollHeight（它已含 padding），按 border-box 直接设回去 */
    f.style.height='0px'; var h=f.scrollHeight;
    if(cap>0&&h>cap) h=cap;
    f.style.height=h+'px';
    var more=(cap>0&&f.scrollHeight>cap+1);
    f.style.overflowY=more?'auto':'hidden';
    /* 到顶正在滚的时候底边渐隐一点，别让文字被硬切在半行上（CSS .nt-ww.nt-sc） */
    f.classList.toggle('nt-sc',more); }); }
  function openEditor(d,dir){
    var isNew=!d, v=d||{title:'',summary:'',reason:'',tags:[],body:''};
    /* 11-16：除正文外的四个字段都换成多行框，长内容自动换行、随字数长高（单个字段仍受 maxlength 限制） */
    var body='<div class="pg-g pv-form nt-form">'+fd('标题','<textarea class="pg-in nt-ww nt-1 nt-cap3" id="neT" rows="1" maxlength="100" placeholder="一眼能认出是哪篇">'+esc(v.title)+'</textarea>')+
      fd('一句话摘要','<textarea class="pg-in nt-ww" id="neS" rows="2" maxlength="500" placeholder="概括这篇写了什么（500 字内）">'+esc(v.summary)+'</textarea>')+
      fd('正文','<textarea class="pg-in nt-ta" id="neB" placeholder="写点什么…">'+esc(v.body)+'</textarea>')+
      fd('创建原因','<textarea class="pg-in nt-ww" id="neR" rows="2" maxlength="200" placeholder="为什么记这篇（可选）">'+esc(v.reason)+'</textarea>')+
      fd('关键词'+G.hint('只有你能看到，谢看不到'),'<textarea class="pg-in nt-ww nt-1" id="neK" rows="1" placeholder="用空格隔开">'+esc((v.tags||[]).join(' '))+'</textarea>')+'</div>'+
      '<div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-nt="save">'+(isNew?'保存':'保存修改')+'</button></div>';
    sub(win,isNew?'新笔记':'编辑',body,{setup:function(s,close){
      var T=s.querySelector('#neT'), SM=s.querySelector('#neS'), BD=s.querySelector('#neB'), R=s.querySelector('#neR'), K=s.querySelector('#neK');
      /* 11-16：多行框随内容长高；sheet 上滑动画结束（420ms）后字体/宽度落定，再量一次免得高度差一行 */
      [T,SM,R,K].forEach(function(f){ if(!f) return; f.addEventListener('input',function(){ growTa(f); },{passive:true}); growTa(f); setTimeout(function(){ growTa(f); },420); });
      if(isNew) setTimeout(function(){ T.focus(); },420);
      var under=reader&&reader.el&&reader.el.isConnected?reader.el:null;   /* 从阅读页进来：盖住它，页头的按钮先淡出，别透在编辑页后面 */
      if(under) under.classList.add('nt-under');
      if(under&&window.MutationObserver){ var mo=new MutationObserver(function(){ if(!s.classList.contains('show')){ under.classList.remove('nt-under'); mo.disconnect(); } }); mo.observe(s,{attributes:true,attributeFilter:['class']}); }
      s.addEventListener('click',function(e){
        var b=e.target.closest('[data-nt="save"]'); if(!b) return;
        var text=BD.value;
        if(!text.trim()){ BD.focus(); buzz([20,30,20]); return; }
        if(!S.live){ toast('没连上后台，没存上'); buzz([20,30,20]); return; }
        /* 11-16：标题现在是多行框，敲回车会带进换行；存之前把空白收成一个空格，免得列表里的标题被多行撑开 */
        var title=(T.value||'').replace(/\s+/g,' ').trim()||text.trim().split('\n')[0].replace(/^#+\s*/,'').slice(0,20);
        if(!bgo(b)) return;
        var payload=nbBody({title:title,summary:SM.value.trim(),content:text,reason:R.value.trim(),tags:tagsOf(K.value)});
        if(!isNew) payload.id=d.id; else if(dir) payload.folder=dir;
        P.net.post(B+(isNew?'note/add':'note/update'),payload).then(function(r){
          if(r&&r.error){ bend(b,false); toast(r.error); return; }
          var okMsg='存好了';   /* 11-16：正文超 2 万字后端自动拆成多篇，提示要告诉她存成了几篇 */
          if(r&&r.parts&&r.parts>1) okMsg='存好了，超长拆成了 '+r.parts+' 篇';
          bend(b,true); later(function(){ close(); toast(okMsg); buzz([8,30,8]); fetchList(); if(!isNew&&reader&&reader.refresh) reader.refresh(); });
        },function(){ bend(b,false); toast('没存上，稍后再试'); });
      });
    }});
  }

  /* ---- 悬浮新建按钮滚动变淡 & 笔记本设置页 ---- */
  function wireFabFade(scEl,fabEl){
    if(!scEl||!fabEl) return;
    var ft=0;
    scEl.addEventListener('scroll',function(){
      fabEl.classList.add('fading');
      clearTimeout(ft);
      ft=setTimeout(function(){ fabEl.classList.remove('fading'); },260);
    },{passive:true});
  }
  function openSettings(){
    function pSub(){ var v=P.pvals&&P.pvals[9]; return v&&P.plen?P.plen(9).toLocaleString()+' 字':'读取中…'; }
    function pTitle(){ var v=P.pvals&&P.pvals[9]; return '摘要与关键词提示词'+(v&&v.custom_set?' <span class="pg-tag">改过</span>':''); }
    var mdRow=G.mdSelHtml?G.mdSelHtml({ic:'ai',t:'摘要与关键词模型'+G.hint('新建笔记或修改正文后，后台自动整理摘要和关键词所用模型'),k:'nbM'}):'';
    var pg=sub(win,'笔记本设置',
      (mdRow?'<div class="pg-gt">模型</div><div class="pg-g">'+mdRow+'</div>':'')+
      '<div class="pg-gt">提示词</div><div class="pg-g">'+G.r({t:pTitle(),s:pSub(),act:'nbP',right:G.I.ch,id:'nbPRow'})+'</div>',
      {act:function(k){ if(k==='nbP'){ buzz(6); if(P.pedit) P.pedit(win,9,paintP); } }});
    function paintP(){
      var rw=pg.querySelector('#nbPRow'); if(!rw) return;
      var b=rw.querySelector('.rt b'), sm=rw.querySelector('.rt small');
      if(b) b.innerHTML=pTitle();
      if(sm) sm.textContent=pSub();
    }
    if(P.pfetch) P.pfetch(9).then(paintP,paintP);
    if(G.mdBind&&mdRow){
      var inst=G.mdBind(pg.querySelector('[data-md="nbM"]'),'',function(v,pid,model,prev){
        P.net.req('/heartbeat/admin/model-roles/notebook_meta',{method:'PUT',body:{provider_id:pid,model:model}}).then(function(){
          toast('笔记模型 → '+(pid?model:'跟随聊天模型')); buzz([8,30,8]);
        },function(){ toast('没改成'); buzz([20,30,20]); inst.want(prev); });
      });
      P.net.get('/heartbeat/admin/model-roles',{noLogin:true}).then(function(res){
        var x=res&&res.roles&&res.roles.notebook_meta;
        inst.want((x&&x.provider_id&&x.model)?(x.provider_id+'|'+x.model):'');
      },function(){});
    }
  }

  /* ---- 文件夹 / 长按菜单 / 移动 ---- */
  function openDir(p){
    var s=G.sub(win,esc(baseName(p)),'<div class="nt-list nt-dirbox" data-dir="'+esc(p)+'"></div>',{right:'<span class="pg-cb ghost"></span>'});
    s.querySelector('.nt-dirbox').innerHTML=listHTML(p);
    var fab=document.createElement('button');
    fab.className='nt-fab tap'; fab.type='button'; fab.setAttribute('aria-label','新建'); fab.innerHTML=IC.plus;
    fab.addEventListener('click',function(){ buzz(6); plusMenu(p); });
    s.appendChild(fab);
    wireFabFade(s.querySelector('.pg-sc'),fab);
    return s;
  }
  function closeDirsUnder(p){   /* 重命名 / 删除文件夹后，开着的这个文件夹（和它里面的）页面已经对不上了，直接收掉 */
    Array.prototype.forEach.call(win.querySelectorAll('.nt-dirbox'),function(b){ var d=b.dataset.dir; if(d===p||d.indexOf(p+'/')===0){ var bk=b.closest('.pg-sub').querySelector('[data-x="back"]'); if(bk) bk.click(); } });
  }
  function plusMenu(dir){
    G.sheet(win,'新建','<div class="pg-g">'+G.r({ic:'layers',t:'新建文件夹',act:'nf'})+G.r({ic:'book',t:'新建笔记',s:dir?'建在「'+esc(baseName(dir))+'」里':'',act:'nn'})+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; close();
        if(x.dataset.act==='nf') askName('新建文件夹','','创建',function(v){ post('folder/add',{path:dir?dir+'/'+v:v},'建好了'); });
        else openEditor(null,dir); });
    });
  }
  function askName(title,def,okTxt,fn,ph){
    G.sheet(win,title,'<div class="pg-g"><div class="pg-r col"><span class="rt"><b>名字</b></span><input class="pg-in nt-name" maxlength="30" style="margin-top:8px" value="'+esc(def)+'" placeholder="'+esc(ph||'文件夹名字（不含 /）')+'"></div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>'+esc(okTxt)+'</button></div>',function(sh,close){
      function go(){ var el=sh.querySelector('.nt-name'), v=(el&&el.value||'').trim(); if(!v){ toast('先起个名'); return; } if(!ph&&v.indexOf('/')>=0){ toast('名字里不能有 /'); return; } close(); fn(v); }
      sh.querySelector('[data-ok]').addEventListener('click',go);
      sh.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
      setTimeout(function(){ var el=sh.querySelector('.nt-name'); if(el){ el.focus(); el.select(); } },120);
    });
  }
  function post(path,body,okMsg,after){
    if(!S.live){ toast('没连上后台，没成'); return; }
    P.net.post(B+path,nbBody(body)).then(function(){ if(okMsg) toast(okMsg); if(after) after(); fetchList(); },function(e){ toast(whyOf(e,'没成，稍后再试')); buzz([20,30,20]); });
  }
  function noteMenu(id){
    var n=find(id); if(!n) return; var nm=n.title||'无标题'; nm=nm.length>8?nm.slice(0,8)+'…':nm;
    /* [位置:phone-notes.js·noteMenu 目录显示开关] [文件夹内单篇笔记在目录中显示开关] [11-21：文件夹在目录中默认折叠，长按文件夹内笔记可单独开关是否在所属文件夹行下显示（根目录笔记默认已在目录中，不显示此开关）] [注释时间 2026-11-21] */
    var idxRow=n.folder?G.r({t:'在目录中显示',tg:1,on:!!n.show_in_index,tgname:'idxshow'}):'';
    G.sheet(win,esc(nm),'<div class="pg-g">'+idxRow+G.r({t:n.pinned?'取消置顶':'置顶',act:'pin'})+G.r({t:'编辑',act:'ed'})+G.r({t:'移动到',act:'mv'})+G.r({t:'删除',act:'del',red:1})+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){
        var tg=e.target.closest('[data-tg="idxshow"]');
        if(tg){
          var sw=tg.querySelector('.pg-sw'), hitSw=!!e.target.closest('.pg-sw'), next;
          if(hitSw){ next=tg.classList.contains('on'); }
          else { next=!tg.classList.contains('on'); tg.classList.toggle('on',next); if(sw) sw.setAttribute('aria-checked',next?'true':'false'); buzz(6); }
          if(!S.live){ tg.classList.toggle('on',!next); if(sw) sw.setAttribute('aria-checked',!next?'true':'false'); toast('没连上后台，没成'); return; }
          P.net.post(B+'note/index-show',nbBody({id:id,show:next})).then(function(){
            n.show_in_index=next;
            toast(next?'已开启目录显示':'已从目录隐藏');
            fetchList();
          },function(err){
            tg.classList.toggle('on',!next);
            if(sw) sw.setAttribute('aria-checked',!next?'true':'false');
            toast(whyOf(err,'没成，稍后再试')); buzz([20,30,20]);
          });
          return;
        }
        var x=e.target.closest('[data-act]'); if(!x) return; close(); var a=x.dataset.act;
        /* [位置:phone-notes.js·noteMenu 置顶] [长按菜单置顶/取消置顶] [11-02：置顶后这篇全文进谢的上下文 Pinned Notes 块（重建快照时更新）] [注释时间 2026-11-02] */
        if(a==='pin') post('note/pin',{id:id,pinned:!n.pinned},n.pinned?'已取消置顶':'已置顶');
        else if(a==='ed') P.net.get(B+'note'+nbQs('id='+id)).then(function(d){ openEditor(d,''); },function(){ toast('没打开，稍后再试'); });
        else if(a==='mv') moveSheet(id);
        else confirmBox(win,'删除这篇笔记？','删除后笔记本里就没有它了。','删除',true,function(){ post('note/delete',{id:id},'删掉了'); }); });
    });
  }
  function moveSheet(id){
    var n=find(id); if(!n) return; var cur=n.folder||'';
    var rows=G.r({ic:'book',t:'笔记本（根目录）',v:cur===''?'当前位置':'',act:'mvto',data:' data-p=""'})+S.folders.map(function(f){ var p=f.path, depth=p.split('/').length-1; return G.r({ic:'layers',t:(depth?new Array(depth+1).join('　')+'└ ':'')+esc(baseName(p)),v:cur===p?'当前位置':'',act:'mvto',data:' data-p="'+esc(p)+'"'}); }).join('');
    G.sheet(win,'移动到','<div class="pg-g">'+rows+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){ var x=e.target.closest('[data-act="mvto"]'); if(!x) return; close(); var to=x.dataset.p||''; if(to===cur){ toast('已经在这里了'); return; } post('note/move',{id:id,folder:to},'移好了'); });
    });
  }
  /* [位置:phone-notes.js·askSummary] [文件夹编辑摘要] [10-29：文件夹也有摘要，进目录进注入块；长按文件夹→编辑摘要，留空=清掉] [注释时间 2026-10-29] */
  function askSummary(p){
    var cur=''; S.folders.forEach(function(f){ if(f.path===p) cur=f.summary||''; });
    G.sheet(win,'编辑摘要','<div class="pg-g"><div class="pg-r col"><span class="rt"><b>一句话摘要</b></span><textarea class="pg-in nt-ww nt-sum" rows="2" maxlength="500" style="margin-top:8px;max-height:36dvh" placeholder="这个文件夹收的是什么（留空=清掉）">'+esc(cur)+'</textarea></div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>保存</button></div>',function(sh,close){
      function go(){ var el=sh.querySelector('.nt-sum'), v=(el&&el.value||'').trim(); close(); post('folder/summary',{path:p,summary:v},'存好了'); }
      sh.querySelector('[data-ok]').addEventListener('click',go);
      /* 11-16：这里已是多行框，回车=换行；保存走按钮或 Cmd/Ctrl+回车（手机上没有回车提交，靠按钮） */
      sh.addEventListener('keydown',function(e){ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); go(); } });
      setTimeout(function(){ var el=sh.querySelector('.nt-sum'); if(el){ el.focus(); growTa(el); el.addEventListener('input',function(){ growTa(el); },{passive:true}); } },120);
    });
  }
  function folderMenu(p){
    G.sheet(win,esc(baseName(p)),'<div class="pg-g">'+G.r({t:'编辑摘要',act:'sum'})+G.r({t:'重命名',act:'ren'})+G.r({t:'删除',act:'del',red:1})+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){ var x=e.target.closest('[data-act]'); if(!x) return; close();
        if(x.dataset.act==='sum') askSummary(p);
        else if(x.dataset.act==='ren') askName('重命名',baseName(p),'好',function(v){ post('folder/rename',{path:p,name:v},'改好了',function(){ closeDirsUnder(p); }); });
        else confirmBox(win,'删除这个文件夹？','只有空文件夹能删；里面有笔记的话请先移走或删掉。','删除',true,function(){ post('folder/delete',{path:p},'删掉了',function(){ closeDirsUnder(p); }); }); });
    });
  }

  /* ---- 事件 ---- */
  win.addEventListener('click',function(e){
    if(Date.now()-lastHold<700) return;   /* 长按弹出菜单后抬手的那一下不算点击 */
    if(e.target.closest('[data-retry]')&&!e.target.closest('.pg-sub')){ fetchList(); return; }
    var f=e.target.closest('.nt-fr'); if(f&&win.contains(f)){ buzz(5); openDir(f.dataset.p); return; }
    var c=e.target.closest('.nt-card'); if(c&&win.contains(c)){ buzz(5); openReader(+c.dataset.id); }
  });
  G.hold(win,function(el){ lastHold=Date.now(); buzz([10,30,10]); if(el.classList.contains('nt-fr')) folderMenu(el.dataset.p); else noteMenu(+el.dataset.id); },'.nt-fr,.nt-card:not(.idx)');
  $('#ntAdd',win).addEventListener('click',function(){ buzz(6); plusMenu(''); });
  $('#ntSet',win).addEventListener('click',function(){ buzz(6); openSettings(); });
  if(hdNbBtn) hdNbBtn.addEventListener('click',function(){ buzz(6); openNbDrop(hdNbBtn); });
  var heroT=$('#ntHeroT',win); if(heroT) heroT.addEventListener('click',function(){ buzz(6); openNbDrop(heroT); });
  /* [位置:phone-notes.js·跟手滚动驱动] [大标题随手指自然上滑并连续驱动顶栏浮现] [11-25：放弃二值折叠切变，改由 scrollTop 在 rAF 中连续写入 --nt-hp / --nt-bp（0..1），纯 GPU transform+opacity 无布局跳变] [注释时间 2026-11-25] */
  var heroEl=$('#ntHero',win), scRaf=0, lastInteractive=false;
  function syncScrollFx(){
    scRaf=0;
    if(!scEl||!pgEl) return;
    var y=Math.max(0,scEl.scrollTop);
    var range=Math.max(88,(heroEl&&heroEl.offsetHeight)?heroEl.offsetHeight-8:106);
    var p=Math.min(1,y/range);
    var hp=Math.min(1,p/0.82);
    var bp=Math.max(0,Math.min(1,(p-0.32)/0.68));
    /* smoothstep 缓动让起止两端更柔和 */
    var sbp=bp*bp*(3-2*bp);
    var shp=hp*hp*(3-2*hp);
    pgEl.style.setProperty('--nt-hp',shp.toFixed(4));
    pgEl.style.setProperty('--nt-bp',sbp.toFixed(4));
    var inter=bp>0.55;
    if(inter!==lastInteractive){
      lastInteractive=inter;
      pgEl.classList.toggle('nt-stuck',inter);
      if(ddClose) ddClose();
    }
  }
  if(scEl&&pgEl){
    syncScrollFx();
    scEl.addEventListener('scroll',function(){
      if(!scRaf) scRaf=requestAnimationFrame(syncScrollFx);
    },{passive:true});
  }
  wireFabFade(scEl,$('#ntAdd',win));
  var qt=0;
  function onQIn(src){
    var v=src.value;
    if(q&&src!==q) q.value=v;
    if(q2&&src!==q2) q2.value=v;
    clearTimeout(qt); qt=setTimeout(function(){ S.q=v.trim(); first=false; if(S.q) fetchSearch(); else { S.res=[]; render(); } },260);
  }
  function onQKey(src,e){
    if(e.key!=='Enter') return;
    e.preventDefault(); clearTimeout(qt);
    var v=src.value;
    if(q&&src!==q) q.value=v;
    if(q2&&src!==q2) q2.value=v;
    S.q=v.trim(); first=false; if(S.q) fetchSearch(); else { S.res=[]; render(); }
    try{ src.blur(); }catch(_){}
  }
  [q,q2].forEach(function(el){
    if(!el) return;
    el.addEventListener('input',function(){ onQIn(el); });
    el.addEventListener('keydown',function(e){ onQKey(el,e); });
  });

  /* [位置:phone-notes.js·setup 缓存秒显] [打开先画本机缓存再校正] [有缓存先秒出，后台照常拉新的覆盖；写操作成功后 fetchList 会回写缓存] [注释时间 2026-11-25] */
  (function(){ var c=P.net.peek(nbCacheKey('notes')); if(c&&c.length){ S.st='ok'; S.all=c; S.folders=(P.net.peek(nbCacheKey('notefolders'))||[]).map(function(f){ return typeof f==='string'?{path:f,summary:'',count:0}:f; }); } })();
  paintNbTitle();
  render();
  fetchBooks().then(function(){ return fetchList(); }).then(function(){ if(S.live&&S.nb==='default') migrate(); });
  win._switchNb=switchBook;
}
P.openNoteBook=function(nbId){
  P._wantNb=nbId||'default';
  var w=document.querySelector('.win[data-win="note"]');
  if(w&&w._switchNb){ w._switchNb(P._wantNb); P._wantNb=''; }
  if(P.open) P.open('note');
};
P.register('note',{html:html,setup:setup});
})();
