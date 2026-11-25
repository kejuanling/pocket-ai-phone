const PROJECT_ROOT = require('../lib/project-root').projectRoot();
/* [位置:phone-wf.js·文件头] [小手机「我的 → 工作流」：工作流文件夹网页管理（浏览/编辑/新建/删除/移动 + 撤销）] [10-27：她本地操作不到服务器 工作流/ 目录；保存即落盘，写/删服务端自动留底到 备份/wf/，编辑器右上撤销按钮恢复文件到上一次操作前，可连撤；10-28 长按菜单加「移动到」；11-01 .html/.htm 打开默认 iframe 渲染、可切源码（服务端配 /admin/workflow/raw/* 只读接口）；11-01 长按文件菜单加「下载到手机」（服务端配 /admin/workflow/dl 只读下载接口，要重启网关生效）；11-14 isHtmlContent 内容嗅探：没带后缀但内容像 HTML 的文件（如上传的「捏捏」）也走 iframe 渲染，服务端 raw 接口同步加了 wfSniffHtml，需重启网关生效] [注释时间 2026-11-14] */
(function(){
"use strict";
var P=window.PH, PG=P.pages, esc=P.esc, buzz=P.buzz, toast=P.toast;
var AB='/heartbeat/admin/';
var SVGF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
var I={
  undo:SVGF+'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  save:SVGF+'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  plus:SVGF+'<path d="M12 5v14M5 12h14"/></svg>',
  edit:SVGF+'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  eye:SVGF+'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
};
/* 标题只显示前 5 个字，超出省略（全名太长会顶到右侧按钮，截图 04:29 那次） */
function nameShort(n){ var a=Array.from(String(n||'')); return a.length>5?(a.slice(0,5).join('')+'…'):String(n||''); }
function fmtSize(n){ if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
function fmtTime(ms){ if(!ms) return ''; var d=new Date(ms), p=function(x){ return (x<10?'0':'')+x; }; return (d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
function refresh(layer){ if(!layer||!layer.isConnected) return; var b=layer.querySelector('.wf-list'); if(b&&b._load) b._load(); }
/* [位置:phone-wf.js·wfCopyFallback] [复制路径的兜底] [老 WebView 没有 navigator.clipboard：临时 textarea + execCommand('copy')，用完即删] [注释时间 2026-10-29] */
function wfCopyFallback(txt,done){
  try{
    var ta=document.createElement('textarea'); ta.value=txt; ta.style.cssText='position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select();
    var ok=document.execCommand('copy'); ta.remove(); if(ok){ done(); return; }
  }catch(_){}
  toast('复制没成，路径是：'+txt);
}

/* [位置:phone-wf.js·open] [工作流管理入口] [从「我的」页进来，先列工作流根目录；目录一层层点进去，每层右上角可新建] [注释时间 2026-10-27] */
function open(win){ browse(win,''); }

/* 行一律走项目自带的 PG.r()（图标容器 .ri + 箭头 .ch 的尺寸/布局都是现成的），只额外带 data-p 存路径 */
function row(p,n,sub,isDir){
  return PG.r({ic:isDir?'layers':'book', t:esc(n), s:sub?esc(sub):'', go:isDir?'wfdir':'wffile', cls:'wf-r', data:' data-p="'+esc(p)+'"'});
}

/* [位置:phone-wf.js·crumbs] [文件夹式导航栏] [10-29：工作流页顶部加面包屑——一层层点太累，点任意一级直接跳回那层；当前级加粗不可点] [注释时间 2026-10-29] */
function crumbs(dir){
  var parts=dir?dir.split('/'):[], h='<div class="wf-crumbs"><button type="button" class="wf-cb tap'+(parts.length?'':' cur')+'" data-go="wfdir" data-p="">工作流</button>', acc='';
  parts.forEach(function(p,i){
    acc=acc?(acc+'/'+p):p;
    h+='<i>/</i>'+(i===parts.length-1?'<b class="wf-cb cur">'+esc(p)+'</b>':'<button type="button" class="wf-cb tap" data-go="wfdir" data-p="'+esc(acc)+'">'+esc(p)+'</button>');
  });
  return h+'</div>';
}

function browse(win,dir){
  /* [位置:phone-wf.js·browse 回根清层] [跳回根目录先清旧浏览层] [#39：面包屑点「工作流」或再进根时，把之前叠着的浏览层全关掉再开新根，不堆废层；编辑器/移动到层不在此列] [注释时间 2026-10-29] */
  if(!dir){ Array.prototype.slice.call(win.querySelectorAll('.pg-sub.wf-br')).forEach(function(x){ x.classList.remove('show'); setTimeout(function(){ x.remove(); },420); }); }
  var title=dir?dir.split('/').pop():'工作流';
  var s=PG.sub(win,esc(nameShort(title)),'<div class="wf-l">'+crumbs(dir)+'<div class="wf-list"><div class="pg-empty">读取中…</div></div></div>',
    {right:'<button class="pg-cb tap" data-go="wfnew" aria-label="新建">'+I.plus+'</button>',
     go:function(k,t){
       if(k==='wfdir'){ buzz(6); browse(win,t.dataset.p); }
       else if(k==='wffile'){ buzz(6); editor(win,t.dataset.p,s); }
       else if(k==='wfnew'){ buzz(6); createDialog(win,dir,s); }
     }});
  s.classList.add('wf-sub');   /* 宽屏下子页向左借宽，见 phone-wide.css（10-29） */
  s.classList.add('wf-br');
  /* [位置:phone-wf.js·browse 返回键] [目录层返回一次退到工作流根] [#39 10-29：目录层点返回不再一层层退，直接关掉根层之上的所有浏览层露出根；根层返回保持默认（关层回上一页）。挂捕获阶段拦住 wire 的默认关层] [注释时间 2026-10-29] */
  if(dir){ var bk=s.querySelector('[data-x="back"]');
    if(bk) bk.addEventListener('click',function(ev){ ev.stopImmediatePropagation(); buzz(6);
      Array.prototype.slice.call(win.querySelectorAll('.pg-sub.show.wf-br')).slice(1).forEach(function(x){ x.classList.remove('show'); setTimeout(function(){ x.remove(); },420); }); },true); }
  var box=s.querySelector('.wf-list');
  function paint(r){
    box._retry=0;
    var h='';
    (r.dirs||[]).forEach(function(d){ h+=row(d.p,d.n,'',true); });
    /* [位置:phone-wf.js·browse 排序] [文件按更新时间从新到旧] [10-27：原来是服务端按文件名排；改成最近改的在最上面，文件夹仍在前、按名字] [注释时间 2026-10-27] */
    (r.files||[]).slice().sort(function(a,b){ return (b.mtime||0)-(a.mtime||0); }).forEach(function(f){ h+=row(f.p,f.n,fmtSize(f.size)+' · '+fmtTime(f.mtime),false); });
    box.innerHTML=h?('<div class="pg-g">'+h+'</div>'):'<div class="pg-empty">空目录，点右上角 + 新建</div>';
  }
  function load(){
    P.net.get(AB+'workflow/list?dir='+encodeURIComponent(dir)).then(function(r){
      if(r&&r.ok) paint(r); else { box.innerHTML='<div class="pg-empty">'+esc((r&&r.msg)||'没连上后台')+'</div>'; if(box&&!box._retry){ box._retry=1; var b=document.createElement('button'); b.className='pg-btn tap'; b.textContent='再试一次'; b.style.margin='10px auto'; b.addEventListener('click',function(){ box.innerHTML='<div class="pg-empty">读取中…</div>'; load(); }); box.appendChild(b); } }
    },function(){ box.innerHTML='<div class="pg-empty">没连上后台</div>'; });
  }
  box._load=load;
  /* [位置:phone-wf.js·长按菜单] [长按文件/文件夹行出操作单：重命名 / 移动到 / 删除] [10-27 加「编辑文件名」，10-28 加「移动到」（选目标文件夹挪过去）；改名/移动/删除都进服务端撤销栈，可撤回；11-01 加「下载到手机」（仅文件显示，走 /admin/workflow/dl 附件流下载，不进撤销栈）] [注释时间 2026-11-01] */
  PG.hold(box,function(el){
    var p=el.dataset.p, nm=p.split('/').pop(), isDir=el.dataset.go==='wfdir';
    buzz([10,30,10]);
    /* [位置:phone-wf.js·长按菜单 复制路径] [复制文件目录地址] [10-29：长按加「复制文件目录地址」——带 工作流/ 前缀的完整路径，粘给 AI 或贴别处直接能用；clipboard 失败（非安全环境）回落 execCommand] [11-02 改：复制的是服务器绝对路径 ${PROJECT_ROOT}/工作流/…，AI 的 yun 工具可直接读取/搜索] [注释时间 2026-11-02] */
    PG.sheet(win,esc(nameShort(nm)),'<div class="pg-g">'+PG.r({t:'编辑文件名',act:'ren'})+PG.r({t:'复制文件目录地址',act:'cp'})+(isDir?'':PG.r({t:'下载到手机',act:'dl'}))+PG.r({t:'移动到',act:'mv'})+PG.r({t:'删除',act:'del',red:1})+'</div>',function(sh,close){
      sh.addEventListener('click',function(e){
        var x=e.target.closest('[data-act]'); if(!x) return; close();
        if(x.dataset.act==='ren'){
          askName(win,'新名字',function(v){
            P.net.post(AB+'workflow/rename',{path:p,name:v}).then(function(r){
              if(r&&r.ok){ toast(r.same?'名字没变':'改好了'); buzz([8,30,8]); if(!r.same) load(); }
              else toast((r&&r.msg)||'没改成');
            },function(e){ toast((e&&e.body&&e.body.msg)||'没连上后台'); });
          },nm,'改成');
        } else if(x.dataset.act==='cp'){
          var full=require('path').join(PROJECT_ROOT, '工作流/')+p, done=function(){ toast('路径复制好了'); buzz([8,30,8]); };
          if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(full).then(done,function(){ wfCopyFallback(full,done); });
          else wfCopyFallback(full,done);
        } else if(x.dataset.act==='dl'){
          /* [位置:phone-wf.js·长按菜单 dl 分支] [下载到手机] [11-01：长按文件直接下到手机（系统下载进「下载」目录）；下载触发靠服务端 /admin/workflow/dl 的 attachment 头，a.download 兜底文件名；写法同相册保存照片（phone-pages.js·相册操作单 save 分支）] [注释时间 2026-11-01] */
          var da=document.createElement('a'); da.href=AB+'workflow/dl?path='+encodeURIComponent(p); da.download=nm; document.body.appendChild(da); da.click(); da.remove(); toast('开始下载了');
        } else if(x.dataset.act==='mv'){ pickerMove(win,p);
        } else if(x.dataset.act==='del'){
          PG.confirm(win,'删除 '+esc(nm)+'？','会自动留底到「备份」，删错了能撤销。'+(isDir?' 文件夹里的内容一起删。':''),'删除',true,function(){
            P.net.post(AB+'workflow/delete',{path:p}).then(function(r){
              if(r.ok){ toast('删掉了，可撤销'); buzz([8,30,8]); load(); } else toast(r.msg||'没删掉');
            },function(e){ toast((e&&e.body&&e.body.msg)||'没连上后台'); });
          });
        }
      });
    });
  },'.wf-r');
  load();
  return s;
}

/* [位置:phone-wf.js·Markdown 渲染] [打开 .md 文件默认看渲染后的样子，右上角笔/眼切换编辑与预览] [10-27：工作流文档都是 Markdown，纯文本看着累；选型 marked 12（开源 MIT，vendor/marked.min.js 本地加载，首次打开 .md 才请求）；
   文件里大量 <title>/<status> 这类尖括号文字，所以原始 HTML 一律转义成文字显示，不当 HTML 解析（否则会被吞掉，也避免注入）；链接只放行 http(s)/mailto/锚点/相对路径，新窗口打开；表格外包一层可横向滚动] [注释时间 2026-10-27] */
function isMd(p){ return /\.(md|markdown)$/i.test(p); }
/* [位置:phone-wf.js·isHtml] [html 文件判定] [11-01：.html/.htm 在工作流页默认 iframe 渲染、可切源码，交互同 .md] [注释时间 2026-11-01] */
function isHtml(p){ return /\.html?$/i.test(p); }
/* [位置:phone-wf.js·isHtmlContent] [无后缀文件 HTML 内容嗅探] [11-14：上传的「捏捏」是 HTML 但文件名没带后缀，按后缀判定认不出、开成纯文本；打开文件时内容开头像 HTML（容忍 BOM）就当 html 走 iframe 渲染，与后缀判定取或；服务端 raw 接口有同款嗅探（routes/workflow-files.js·wfSniffHtml），两处口径一致] [注释时间 2026-11-14] */
function isHtmlContent(t){ return /^\uFEFF?\s*(<!doctype\s+html|<html[\s>])/i.test(String(t||'').slice(0,1024)); }
function loadMd(){
  if(window.marked&&window.marked.parse) return Promise.resolve(window.marked);
  if(loadMd._p) return loadMd._p;
  loadMd._p=new Promise(function(res,rej){
    var sc=document.createElement('script'); sc.src='vendor/marked.min.js';
    sc.onload=function(){ if(window.marked&&window.marked.parse){ window.marked.use({gfm:true,breaks:false,renderer:{
        html:function(h){ return esc(h); },
        link:function(href,title,text){ var h=String(href||''); if(!/^(https?:|mailto:|#|\/|\.)/i.test(h)) return text; return '<a href="'+esc(h)+'"'+(title?' title="'+esc(title)+'"':'')+' target="_blank" rel="noopener">'+text+'</a>'; },
        image:function(href,title,text){ return /^https?:/i.test(String(href||''))?'<img src="'+esc(href)+'" alt="'+esc(text||'')+'" loading="lazy">':esc(text||''); },
        table:function(h,b){ return '<div class="wf-tw"><table><thead>'+h+'</thead><tbody>'+b+'</tbody></table></div>'; }
      }}); res(window.marked); } else { loadMd._p=null; rej(new Error('marked')); } };
    sc.onerror=function(){ loadMd._p=null; rej(new Error('marked')); };
    document.head.appendChild(sc);
  });
  return loadMd._p;
}
/* view=true 看渲染（md 按输入框当前内容渲染，没保存的改动也能预览；html 看服务器上已保存的版本），false 回编辑；撤销/保存只在编辑态显示 */
/* [位置:phone-wf.js·setMode html 分支] [工作流页 .html 渲染态] [11-01：.html 打开默认 iframe 渲染，src 指 /admin/workflow/raw/ 路径式只读接口——路径式让文件里同目录图片/字体按原相对路径带登录 cookie 加载；右上角按钮切源码，交互同 .md；sandbox 不给 allow-same-origin，iframe 里的脚本进不了父页和接口；每次切进渲染态重建 src 拿最新已保存版，带未保存改动先提示保存] [注释时间 2026-11-01] */
function setMode(s,view){
  s.classList.toggle('wf-vw',view);
  var b=s.querySelector('[data-go="wfmode"]'); if(b){ b.innerHTML=view?I.edit:I.eye; b.setAttribute('aria-label',view?'编辑':'预览'); }
  if(!view) return;
  var ta=s.querySelector('.wf-ed'), md=s.querySelector('.wf-md'), fr=s.querySelector('.wf-fr');
  if(fr){   /* .html：iframe 渲染；md 预览是按没保存的内容，html 渲染的是已保存版本，改了没存会提示 */
    if(s._dirty) toast('刚改的还没保存，先保存再看渲染');
    fr.src=AB+'workflow/raw/'+encodeURI(s.dataset.wfp);
    return;
  }
  if(!ta||!md) return;
  loadMd().then(function(m){ md.innerHTML=m.parse(ta.value,{async:false}); },function(){ md.innerHTML='<div class="pg-empty">渲染库没加载上，点右上角切回编辑看原文</div>'; });
}

/* [位置:phone-wf.js·editor] [文件编辑页] [全屏 textarea 等宽字体；右上 撤销+保存 两个圆钮；保存即落盘，内容没变就不发] [注释时间 2026-10-27] */
function editor(win,p,listLayer){
  /* 去重：连点或重复点同一个文件时，已经开着/正在打开就不再新开一层（否则会叠出好几页） */
  if(win._wfEd&&win._wfEd.isConnected&&win._wfEd.dataset.wfp===p) return;
  if(win._wfEdOpening) return;
  win._wfEdOpening=p;
  P.net.get(AB+'workflow/read?path='+encodeURIComponent(p)).then(function(r){
    win._wfEdOpening='';
    if(!r||!r.ok){ toast((r&&r.msg)||'读不到'); return; }
    if(!r.text){ toast('二进制文件，点不开，可长按下载'); return; }
    var md=isMd(p), html=isHtml(p)||isHtmlContent(r.content);   /* 11-14：没后缀但内容像 HTML 的也走渲染（见 isHtmlContent） */
    var s=PG.sub(win,esc(nameShort(p.split('/').pop())),'<textarea class="wf-ed" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>'+(html?'<div class="wf-html"><iframe class="wf-fr" sandbox="allow-scripts allow-forms" title="预览"></iframe></div>':'<div class="wf-md"></div>'),
      {right:'<span class="wf-hd">'+((md||html)?'<button class="pg-cb tap" data-go="wfmode" aria-label="编辑">'+I.edit+'</button>':'')+'<button class="pg-cb tap wf-eo" data-go="wfundo" aria-label="撤销">'+I.undo+'</button><button class="pg-cb tap wf-eo" data-go="wfsave" aria-label="保存">'+I.save+'</button></span>',
       go:function(k){
         if(k==='wfsave') doSave(win,s,listLayer);
         else if(k==='wfundo') doUndo(win,s,listLayer);
         else if(k==='wfmode') setMode(s,!s.classList.contains('wf-vw'));
       }});
    s.dataset.wfp=p; s.classList.add('wf-sub'); win._wfEd=s;   /* 宽屏下子页向左借宽（10-29） */
    var ta=s.querySelector('.wf-ed'); ta.value=r.content||'';
    ta.addEventListener('input',function(){ s._dirty=true; });
    if((md||html)&&String(r.content||'').trim()) setMode(s,true);   /* .md/.html 有内容就先看渲染；空文件（刚新建）直接进编辑 */
  },function(e){ win._wfEdOpening=''; toast((e&&e.body&&e.body.msg)||'没连上后台'); });
}

function doSave(win,s,listLayer){
  var ta=s.querySelector('.wf-ed'), b=s.querySelector('[data-go="wfsave"]');
  if(!b||b._busy) return; b._busy=1; buzz(6);
  P.net.post(AB+'workflow/save',{path:s.dataset.wfp,content:ta.value}).then(function(r){
    b._busy=0;
    if(r&&r.ok){ s._dirty=false; toast(r.same?'内容没变':'存好了'); buzz([8,30,8]); if(!r.same){ refresh(listLayer); if(s.classList.contains('wf-vw')&&s.querySelector('.wf-fr')) setMode(s,true); } }   /* html 渲染态存完重载 iframe 看最新 */
    else { toast((r&&r.msg)||'没存上'); buzz([20,30,20]); }
  },function(e){ b._busy=0; toast((e&&e.body&&e.body.msg)||'没连上后台'); buzz([20,30,20]); });
}

/* [位置:phone-wf.js·doUndo] [撤销按钮] [撤最近一次 保存/新建/删除/移动（服务端撤销栈，可连撤）；撤的是当前正编辑的文件就把内容刷回输入框，撤的是移动/改名且编辑器指在新路径就改回旧路径] [注释时间 2026-10-28] */
function doUndo(win,s,listLayer){
  P.net.post(AB+'workflow/undo',{}).then(function(r){
    if(r&&r.ok){ toast(r.msg); buzz([10,30,10]); refresh(listLayer);
      if(s&&r.topath&&s.dataset.wfp===r.topath) s.dataset.wfp=r.path;
      if(s&&r.path&&r.path===s.dataset.wfp){
        P.net.get(AB+'workflow/read?path='+encodeURIComponent(r.path)).then(function(rr){
          if(rr&&rr.ok&&rr.text){ var ta=s.querySelector('.wf-ed'); if(ta){ ta.value=rr.content||''; s._dirty=false; toast('已经刷回来'); } }
        },function(){});
      }
    } else { toast((r&&r.msg)||'没有可撤销的操作'); buzz(8); }
  },function(e){ toast((e&&e.body&&e.body.msg)||'没连上后台'); });
}

/* [位置:phone-wf.js·createDialog] [新建文件夹 / 新建文件] [在当前浏览的目录里建；文件建好直接进编辑器] [注释时间 2026-10-27] */
function createDialog(win,dir,listLayer){
  PG.sheet(win,'新建','<div class="pg-g">'+PG.r({t:'新建文件夹',act:'d'})+PG.r({t:'新建文件',act:'f'})+PG.r({t:'上传文件',act:'u'})+'</div>',function(sh,close){
    sh.addEventListener('click',function(e){
      var x=e.target.closest('[data-act]'); if(!x) return; close();
      if(x.dataset.act==='u'){ uploadFiles(win,dir,listLayer); return; }
      askName(win,x.dataset.act==='d'?'文件夹名字':'文件名字',function(v){
        var p=(dir?dir+'/':'')+v;
        P.net.post(AB+'workflow/create',{path:p,isDir:x.dataset.act==='d'}).then(function(r){
          if(r&&r.ok){ toast('建好了'); buzz([8,30,8]); refresh(listLayer); if(x.dataset.act!=='d') editor(win,p,listLayer); }
          else toast((r&&r.msg)||'没建上');
        },function(e){ toast((e&&e.body&&e.body.msg)||'没连上后台'); });
      });
    });
  });
}

/* [位置:phone-wf.js·uploadFiles] [新建菜单「上传文件」] [10-28：想把手机里的文件直接传进工作流当前文件夹；选完逐个传，同名服务端自动加 (2) 不覆盖；传完刷新列表，可用撤销键撤回；input 先挂 body 再点（同聊天页 attPick，iOS 不挂 DOM 会静默不开）] [11-10：改走 octet-stream 直传通道（upload-raw，上限 14MB→200MB）；反馈「失败直接没报原因」——原失败分支只静默计数，现在把后端 msg 透出来；网关还是旧版时 upload-raw 是 404，自动回退原 base64 通道（≤14MB），不留上传坏掉的窗口期（过渡兼容，网关升级后自然走不到回退分支）] [注释时间 2026-11-10] */
function uploadFiles(win,dir,listLayer){
  var f=document.createElement('input'); f.type='file'; f.multiple=true; f.style.display='none';
  var done=false;
  function cleanup(){ if(done) return; done=true; if(f.parentNode) f.parentNode.removeChild(f); }
  f.onchange=function(){
    var list=Array.prototype.slice.call(f.files||[]); cleanup();
    if(!list.length) return;
    var ok=0, bad=0, i=0;
    function fin(){ refresh(listLayer); toast(bad?('传好 '+ok+' 个，'+bad+' 个没传上'):(ok>1?('传好了 '+ok+' 个'):'传好了')); buzz(bad?[20,30,20]:[8,30,8]); }
    function next(){
      if(i>=list.length) return fin();
      var fl=list[i++];
      if(fl.size>200*1024*1024){ bad++; toast('「'+fl.name+'」超过 200MB，传不了'); return next(); }
      toast('上传中 '+i+'/'+list.length);
      wfUploadRaw(dir,fl,function(pct){ toast('上传中 '+i+'/'+list.length+'　'+pct+'%'); })
        .then(function(){ ok++; })
        .catch(function(m){
          if(m&&m.fallback){   /* 网关旧版：upload-raw 不存在（404），≤14MB 回退 base64 通道 */
            if(fl.size>14*1024*1024){ bad++; toast('「'+fl.name+'」超过 14MB，且后台还没升级，等网关重启后再传'); return; }
            return wfUploadB64(dir,fl).then(function(){ ok++; },function(e2){ bad++; toast('「'+fl.name+'」没传上：'+((e2&&e2.msg)||'网络不通')); });
          }
          bad++; toast('「'+fl.name+'」没传上：'+((m&&m.msg)||m||'网络不通'));
        })
        .then(next);
    }
    next();
  };
  document.body.appendChild(f); f.click(); setTimeout(cleanup,300000);
}
/* [位置:phone-wf.js·wfUploadRaw] [上传直传通道（octet-stream）] [11-10：XHR 直传原始字节（fetch 拿不到上传进度），upload.onprogress 节流 400ms 回调百分比；凭据带会话 cookie + CSRF 头（同 P.net.req）；后端 JSON 错误体 {ok,msg} 原样透出，不再静默失败；404=网关还是旧版 → reject {fallback:true} 让上层回退 base64 通道] [注释时间 2026-11-10] */
function wfUploadRaw(dir,fl,onPct){
  return new Promise(function(res,rej){
    var x=new XMLHttpRequest();
    x.open('POST',AB+'workflow/upload-raw?dir='+encodeURIComponent(dir||'')+'&name='+encodeURIComponent(fl.name));
    x.setRequestHeader('Content-Type','application/octet-stream');
    var ck=P.net.cookie('admin_csrf'); if(ck) x.setRequestHeader('X-CSRF-Token',ck);
    x.withCredentials=true;
    var lastT=0;
    if(x.upload) x.upload.onprogress=function(e){ if(!e.lengthComputable) return; var p=Math.round(e.loaded/e.total*100), t=Date.now(); if(p>=100||t-lastT<400) return; lastT=t; onPct(p); };
    x.onload=function(){
      var j=null; try{ j=JSON.parse(x.responseText); }catch(e){}
      if(x.status>=200&&x.status<300&&j&&j.ok) return res(j);
      if(x.status===404) return rej({fallback:true});
      if(x.status===413&&!j) return rej({msg:'文件超过服务器上限（200MB）'});   /* nginx 层 413 回的是 HTML 不是 JSON，别让用户看到 "HTTP 413" */
      rej({msg:(j&&j.msg)||('HTTP '+x.status)});
    };
    x.onerror=function(){ rej({msg:'网络不通'}); };
    x.send(fl);
  });
}
/* [位置:phone-wf.js·wfUploadB64] [上传 base64 小文件通道（原 uploadFiles 主体抽出）] [11-10：做 upload-raw 的 404 回退（网关没重启期间的过渡兼容，≤14MB）；FileReader 转 base64 走原 JSON 接口] [注释时间 2026-11-10] */
function wfUploadB64(dir,fl){
  return new Promise(function(res,rej){
    new Promise(function(res2,rej2){ var rd=new FileReader(); rd.onerror=rej2; rd.onload=function(){ res2(String(rd.result).split(',')[1]||''); }; rd.readAsDataURL(fl); })
      .then(function(b64){ return P.net.post(AB+'workflow/upload',{dir:dir,name:fl.name,data:b64}); })
      .then(function(r){ if(r&&r.ok) res(r); else rej({msg:(r&&r.msg)||'没传上'}); },function(){ rej({msg:'网络不通'}); });
  });
}

/* [位置:phone-wf.js·pickerMove] [长按「移动到」：选目标文件夹] [10-28：从根目录起一层层点进去，「上一层」退回，底部「移到这里」确认；「备份」是系统留底目录不给选；移完刷新所有开着的列表层，编辑器开着这个文件就把保存路径指到新位置] [注释时间 2026-10-28] */
function pickerMove(win,p){
  var nm=p.split('/').pop(), cur='';
  var s=PG.sub(win,'移动到',
    '<div class="wf-l"><div class="wf-mp"></div><div class="wf-list"><div class="pg-empty">读取中…</div></div></div>'+
    '<div class="pg-bts" style="padding:12px 0 4px"><button class="pg-btn pri tap" data-go="wfmvok">移到这里</button></div>',
    {go:function(k,t){
      if(k==='wfdir'){ buzz(6); cur=t.dataset.p; load(); }
      else if(k==='wfup'){ buzz(6); cur=cur.split('/').slice(0,-1).join('/'); load(); }
      else if(k==='wfmvok'){ doMove(); }
    }});
  s.classList.add('wf-sub');   /* 宽屏下子页向左借宽（10-29） */
  var box=s.querySelector('.wf-list'), mp=s.querySelector('.wf-mp');
  function paint(r){
    var h='';
    if(cur) h+='<div class="pg-g">'+PG.r({ic:'up',t:'上一层',go:'wfup'})+'</div>';
    var ds=(r.dirs||[]).filter(function(d){ return d.p!=='备份'; });
    if(ds.length) h+='<div class="pg-g">'+ds.map(function(d){ return row(d.p,d.n,'',true); }).join('')+'</div>';
    box.innerHTML=h?h:'<div class="pg-empty">'+(cur?'这里面没有子文件夹了':'没有可选的文件夹')+'</div>';
    if(mp) mp.innerHTML='<b>'+esc(nm)+'</b> 移到：'+esc(cur?'工作流/'+cur:'工作流（根目录）');
  }
  function load(){
    P.net.get(AB+'workflow/list?dir='+encodeURIComponent(cur)).then(function(r){
      if(r&&r.ok) paint(r); else box.innerHTML='<div class="pg-empty">'+esc((r&&r.msg)||'没连上后台')+'</div>';
    },function(){ box.innerHTML='<div class="pg-empty">没连上后台</div>'; });
  }
  function doMove(){
    var b=s.querySelector('[data-go="wfmvok"]');
    if(!b||b._busy) return; b._busy=1; buzz(6);
    P.net.post(AB+'workflow/move',{path:p,dir:cur}).then(function(r){
      b._busy=0;
      if(r&&r.ok){
        var newp=cur?cur+'/'+nm:nm;
        var bk=s.querySelector('[data-x="back"]'); if(bk) bk.click();
        toast(r.same?'位置没变':'移好了'); buzz([8,30,8]);
        if(!r.same){
          Array.prototype.forEach.call(win.querySelectorAll('.wf-list'),function(x){ if(x._load&&x.isConnected) x._load(); });
          if(win._wfEd&&win._wfEd.isConnected&&win._wfEd.dataset.wfp===p) win._wfEd.dataset.wfp=newp;
        }
      } else { toast((r&&r.msg)||'没移成'); buzz([20,30,20]); }
    },function(e){ b._busy=0; toast((e&&e.body&&e.body.msg)||'没连上后台'); });
  }
  load();
  return s;
}

function askName(win,title,fn,def,okTxt){
  PG.sheet(win,title,'<div class="pg-g"><div class="pg-r col"><span class="rt"><b>名字</b></span><input class="pg-in wf-name" style="margin-top:8px" value="'+esc(def||'')+'" placeholder="如 2026-10-27_新任务.md"></div></div><div class="pg-bts" style="padding:14px 0 0"><button class="pg-btn pri tap" data-ok>'+(okTxt||'建')+'</button></div>',function(sh,close){
    function go(){ var el=sh.querySelector('.wf-name'), v=(el&&el.value||'').trim(); if(!v){ toast('先起个名'); return; } close(); fn(v); }
    sh.querySelector('[data-ok]').addEventListener('click',go);
    sh.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
    setTimeout(function(){ var el=sh.querySelector('.wf-name'); if(el) el.focus(); },120);
  });
}

P.wf={open:open};
})();
