/* 小手机 · 会话列表：点 Dock「聊天」进来的第一页。点一行进聊天；长按出菜单；右滑出已归档；左上搜、右上新建；底部 会话 / 我的 / 配置。
   [位置:phone-chats.js·文件头] [会话列表] [登录过读真数据（/v1/sessions + 名字 / 置顶 / 归档 / 唤醒锁定）；重建快照红点、列表头像过期角标（纯展示不可点）、搜索定位、开分支后的会话切换都从这里进] [注释时间 2026-10-25 更新]
   没登录或没连上后台时显示一份示例会话（列表顶部会提示），所有写操作此时只提示「没连上」，不会假装成功。 */
(function(){
"use strict";
var P=window.PH; if(!P||!P.register) return;
var $=P.$, buzz=P.buzz, toast=P.toast;
var esc=P.esc||function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
var IC={
  find:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus:svg('<path d="M12 5v14M5 12h14"/>'),
  chat:svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  me:svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  cfg:svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  apps:svg('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  wake:svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 2M5 3.5 2.5 6M19 3.5 21.5 6"/>'),
  box:svg('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
  back:svg('<path d="m9 6 6 6-6 6"/>'),
  more:svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  multi:svg('<path d="m4 7 1.8 1.8L9 5.5M4 17l1.8 1.8L9 15.5M13 7h7M13 17h7"/>'),
  imp:svg('<path d="M12 4v10m0 0-4-4m4 4 4-4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>'),
  exp:svg('<path d="M12 15V4m0 0L8 8m4-4 4 4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>'),
  newp:svg('<path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
  x:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  grp:svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  nos:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M5 5l12 12"/>'),
  all:svg('<rect x="4" y="4.5" width="16" height="15" rx="3"/><path d="m8.5 12 2.4 2.4 4.8-4.8"/>')   /* [位置:phone-chats.js·IC.all] [多选底栏全选图标] [10-31：多选加「全选/取消全选」，跟顶部「多选」清单图标区分开，用方框勾] [注释时间 2026-10-31] */
};
/* [位置:phone-chats.js·GIC 会话组头像] [会话组的 5 个功能型小图标：电脑 / 思考 / 地球 / 小书 / 咖啡，只用来区分组] [10-27：不要太多，五个左右，功能性的] [注释时间 2026-10-27] */
var GICS=['computer','think','bot','book','coffee'], GLAB={computer:'电脑',think:'思考',bot:'机器人',globe:'地球',book:'小书',coffee:'咖啡'};   /* 2026-10-27 批1：选择器里地球换成机器人头像；已经用着 globe 的老组仍能显示，GIC.globe 保留 */
var GIC={
  computer:svg('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>'),
  think:svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  bot:svg('<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5M10 4h4M2.5 12.5v3M21.5 12.5v3M9 13.5h.01M15 13.5h.01M9.5 16.5h5"/>'),
  globe:svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  book:svg('<path d="M12 6.5C10.5 5.3 8.3 4.7 5 4.7v13c3.3 0 5.5.6 7 1.8 1.5-1.2 3.7-1.8 7-1.8v-13c-3.3 0-5.5.6-7 1.8zM12 6.5v13"/>'),
  coffee:svg('<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2"/>')
};

/* ---------- 跨窗口注入选项（新建会话和聊天页「…」共用一套）：总开关 + 块。数量只在 配置 → AI → 跨窗口默认数量 里配 ----------
   块键名同旧聊天页（cross-inject 的 inject_blocks）；lock＝固定带、true＝默认勾上。 */
var XBLK=[['system_instructions','永久上下文','lock'],['state_machine','状态机','lock'],['core_identity','核心身份',true],['long_term_understanding','长期理解',true],['conversation_continuity','早期日记',true],['starred_dialog','标星对话',false],['notebook_index','笔记本目录',false],['pinned_notes','置顶笔记',true],['memory_keywords','记忆池关键词',false],['state_inherit','继承状态',false],['recent_dialog','最近对话',false]];
var XHELP=[
  ['永久上下文（固定）','全局默认会话读全局永久上下文；用预设开的会话走该预设独立的永久上下文与开关。'],
  ['状态机压缩（固定）','这个会话自己的压缩摘要，显示为 ## Conversation State。'],
  ['Long-term Understanding','记忆池里 fact 记忆让模型总结出来的一段。'],
  ['Core Identity','记忆池里 rule 记忆让模型总结出来的一段。'],
  ['日记 Earlier Days','最近 N 篇日记的全文。新建时冻结，不再改变。'],
  ['标星对话','你标过星的那些原话，新建时冻结。'],
  ['笔记本目录','他笔记本的目录，正文要他自己用工具去翻。'],
  ['置顶笔记','他置顶的笔记全文，重建快照时按当前置顶更新。'],  ['记忆池关键词','记忆池里所有关键词的去重汇总（fact/rule/event 全收），给模型当检索线索；默认不勾，勾了之后记忆池关键词变化会亮红点，重建快照才更新。'],
  ['继承状态机','新建会话时，把最近一次聊天的那个会话的摘要拿过来。等这个会话自己压缩过一次，就换成自己的。'],
  ['最近对话原文','新建会话时，会带上最近一次聊天的那个会话最后 N 轮原话（默认 20 轮），当前会话压缩时会一起被压缩。']
].map(function(x){ return '<div class="xw-li"><b>'+x[0]+'：</b>'+x[1]+'</div>'; }).join('')+
  '<div class="xw-li">勾选对应项后，下方会展开数量与承接会话设置。</div>';
/* 说明：点 ? 弹一个小卡片，点哪都关 */
function xwHelp(from){ var host=(from.closest('.win')||P.D||document.body), pop=document.createElement('div'); pop.className='xw-pop';
  pop.innerHTML='<div class="scrim"></div><div class="box"><button class="xw-x tap" type="button" aria-label="关闭">'+'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'+'<b class="hd">跨窗口注入</b><div class="tx">'+XHELP+'</div></div>';
  host.appendChild(pop); buzz(5); requestAnimationFrame(function(){ requestAnimationFrame(function(){ pop.classList.add('show'); }); });
  function close(){ pop.classList.remove('show'); setTimeout(function(){ pop.remove(); },260); }
  pop.addEventListener('click',function(e){ e.stopPropagation(); if(e.target.closest('.scrim')||e.target.closest('.xw-x')) close(); }); }
P.xinject={
  html:function(o){ o=o||{}; var on=o.on!==false, sel=o.blocks;
    var isOn=function(b){ return b[2]==='lock'||(sel?sel.indexOf(b[0])>=0:!!b[2]); };
    return '<div class="xw'+(on?'':' off')+'"><div class="xw-m'+(on?' on':'')+'"><span class="xw-t"><b>跨窗口注入</b><button type="button" class="xw-q tap" aria-label="使用说明">?</button></span><i class="xw-sw"></i></div>'+
      '<div class="xw-b"><div class="cs-xb">'+XBLK.map(function(b){ return '<button type="button" data-b="'+b[0]+'" class="'+(b[2]==='lock'?'lock':isOn(b)?'on':'')+'">'+b[1]+'</button>'; }).join('')+'</div></div></div>'; },
  click:function(e,root){
    var q=e.target.closest('.xw-q'); if(q){ e.stopPropagation(); xwHelp(q); return true; }
    var m=e.target.closest('.xw-m'); if(m){ if(!e.target.closest('.xw-sw')) return true; var w2=m.parentNode, on=!m.classList.contains('on'); m.classList.toggle('on',on); w2.classList.toggle('off',!on); buzz(6); return true; }
    var xb=e.target.closest('.xw .cs-xb button'); if(xb){ if(xb.classList.contains('lock')){ toast('这一块每个会话都带，不能关'); return true; } xb.classList.toggle('on'); buzz(6); return true; }
    return false; },
  read:function(root){ var w=root.querySelector('.xw'); if(!w) return null; var o={on:w.querySelector('.xw-m').classList.contains('on'),blocks:[]};
    Array.prototype.forEach.call(w.querySelectorAll('.cs-xb button'),function(b){ if(b.classList.contains('on')||b.classList.contains('lock')) o.blocks.push(b.getAttribute('data-b')); });
    return o; }
};

/* 会话可选的人设 / 模型（新建会话和聊天页头像菜单共用）：人设＝prompt-backups，模型＝ai-providers 里开着的供应商 × 模型 */
/* [位置:phone-chats.js·chatsCopyText] [复制文本兜底] [10-29：长按菜单「复制会话 id」用；老 WebView 没有 navigator.clipboard 时落 textarea+execCommand，用完即删] [注释时间 2026-10-29] */
function chatsCopyText(txt,done){
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done,function(){ chatsCopyFallback(txt,done); }); return; }
  chatsCopyFallback(txt,done);
}
function chatsCopyFallback(txt,done){
  try{
    var ta=document.createElement('textarea'); ta.value=txt; ta.style.cssText='position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select();
    var ok=document.execCommand('copy'); ta.remove(); if(ok){ done(); return; }
  }catch(_){}
  toast('复制没成，id 是：'+txt);
}
/* [位置:phone-chats.js·P.sessOpts] [人设/模型清单：本机缓存先出，后台静默校正] [11-05：头像菜单、新建会话弹窗、配置页每次现拉 prompt-backups + ai-providers 两个接口、零缓存，实测面板打开瞬间下拉里只有 1 项「跟随默认」，+2274ms 才补成 3 项 / 6 项；现在先给上次存下的完整清单（本机 7 天有效），同时后台刷一次，变了再就地补选项、不动已选中的值。11-05 晚（模型列表统一成按供应商分组那种，更清晰）：模型清单改成分组形态 [[供应商名,[[供应商id|模型名, 模型名],…]],…]，下拉里组头是供应商、条目只写模型名；缓存键换 sessopts2，旧扁平缓存自动作废] [注释时间 2026-11-05 改] */
var SO_KEY='sessopts3', SO_MEM=null, SO_AT=0, SO_P=null, SO_NET=0;   /* 11-14 键换 sessopts3：人设清单带分组结构，旧扁平缓存直接作废；11-15 加 SO_NET 记真实网络拉取时间（修：读本地缓存把 SO_AT 盖成现在，20s 去重永远命中、后台校正从不跑、清单冻 7 天） */
function soGet(){ if(SO_MEM&&Date.now()-SO_AT<60000) return SO_MEM;
  var c=P.net&&P.net.peek?P.net.peek(SO_KEY,7*864e5):null;
  if(c&&c.pers&&c.models){ SO_MEM=c; SO_AT=Date.now(); return c; } return null; }
/* [位置:phone-chats.js·soPers] [人设清单带分组] [11-14：人设可带 grp 分组名（routes/chat.js norm 落盘）——不带分组的照旧平铺在前，带分组的按组收成 [组名,[[id,名],…]] 结构，P.sessFill 渲染成 optgroup；顺手补上子智能体任务提示词（marker==='subagent'）不进下拉（人设页一直有滤，下拉原来漏了）] [注释时间 2026-11-14] */
function soPers(r){ var flat=[], gs={}, go=[];
  ((r&&r.backups)||[]).forEach(function(b){ if(!b||b.marker==='subagent') return;
    var g=String(b.grp||''); if(!g){ flat.push([b.id,b.name||b.id]); return; }
    if(!gs[g]){ gs[g]=[]; go.push(g); } gs[g].push([b.id,b.name||b.id]); });
  return flat.concat(go.map(function(g){ return [g,gs[g]]; })); }
/* 模型清单按供应商分组：停用的供应商整组跳过；条目只留模型名（供应商写在组头上，不再每条重复一遍） */
function soModels(r){ var out=[]; ((r&&r.providers)||[]).forEach(function(p){ if(!p||p.enabled===false) return;
  var ms=[]; (p.models||[]).forEach(function(m){ var n=typeof m==='string'?m:(m&&(m.id||m.name)); if(n) ms.push([p.id+'|'+n,n]); });
  if(ms.length) out.push([p.name||p.id,ms]); });
  return out; }
/* 分组清单摊平成一维 [[值,名],…]：判断某个值在不在清单里、比较清单有没有变都走这个（扁平清单也认） */
function soFlat(groups){ var out=[]; (groups||[]).forEach(function(g){ if(!g||!g.length) return;
  (Array.isArray(g[1])?g[1]:[g]).forEach(function(x){ if(x&&x.length) out.push(x); }); }); return out; }
function soSig(groups){ return soFlat(groups).map(function(x){ return x[0]; }).join(','); }
/* [位置:phone-chats.js·P.sessFlat] [分组清单摊平导出] [11-14：预设编辑页的人设行显示、spPick 选中判断也要认带分组的清单，导出 soFlat 复用，不另写一份] [注释时间 2026-11-14] */
P.sessFlat=soFlat;
function soFetch(){
  if(SO_P) return SO_P;
  var c=soGet();
  if(c&&SO_NET&&Date.now()-SO_NET<20000) return Promise.resolve(c);   /* 20 秒内真拉过就不再打接口（开一次面板不该发两个请求）；11-15 改认 SO_NET——原来认 SO_AT，被本地缓存水合盖掉后永远跳过，「后台静默校正」整条死路 */
  SO_P=Promise.all([P.net.get('/v1/prompt-backups',{noLogin:true}).catch(function(){ return null; }),P.net.get('/heartbeat/admin/ai-providers',{noLogin:true}).catch(function(){ return null; })]).then(function(x){
    if(!x[0]&&!x[1]) return c||{pers:[],models:[]};   /* 两个都没拿到：有缓存用缓存，别把面板打空 */
    var o={pers:x[0]?soPers(x[0]):(c?c.pers:[]), models:x[1]?soModels(x[1]):(c?c.models:[])};
    SO_MEM=o; SO_AT=Date.now(); SO_NET=Date.now(); if(P.net.keep) P.net.keep(SO_KEY,o);   /* 11-15 SO_NET 只在真拉到接口时盖 */
    return o;
  })['catch'](function(){ return c||{pers:[],models:[]}; }).then(function(o){ SO_P=null; return o; });
  return SO_P;
}
P.sessOpts=function(live,force){
  if(!live||!P.net) return Promise.resolve({pers:[],models:[]});
  var c=soGet();
  if(c&&(!force||Date.now()-SO_AT<60000)) return Promise.resolve(c);
  return soFetch();
};
P.sessOpts.now=soGet;                       /* 同步取本机缓存（没有就 null），给「面板一打开就完整」用 */
P.sessOpts.refresh=function(){ return soFetch(); };
P.sessOpts.flat=soFlat;                     /* 摊平后的 [[值,名],…]：判断「存的值还在不在清单里」用 */
P.sessOpts.sig=soSig;                       /* 清单签名：只比条数的话，某家换了个模型就感知不到 */
/* [位置:phone-chats.js·P.sessOpts.clear] [供应商改了就作废清单缓存] [配置页里加/删模型后，模型下拉要马上看到新的，否则要等 7 天缓存过期] [注释时间 2026-11-05] */
P.sessOpts.clear=function(){ SO_MEM=null; SO_AT=0; try{ localStorage.removeItem('ph_c_'+SO_KEY); }catch(e){} };
/* [位置:phone-chats.js·P.sessFill] [填下拉：cur=null 表示保留当前选中；模型那份是分组结构] [11-05：后台静默校正时不能把用户已经选好的值顶回「跟随默认」，所以 cur 传 null 时以 sel 当前值为准；传字符串（含空串）按原样设置。11-05 晚：模型清单按供应商分组，分组项渲染成 <optgroup>（组头供应商、条目只写模型名），扁平的人设清单照旧；follow 可改第一项文案（配置页叫「跟随聊天模型」）] [注释时间 2026-11-05 改] */
P.sessFill=function(sel,opts,cur,follow){ if(!sel) return;
  var keep=(cur===null||cur===undefined)?sel.value:(cur||'');
  var h='<option value="">'+esc(follow||'跟随默认')+'</option>';
  (opts||[]).forEach(function(o){ if(!o||!o.length) return;
    if(Array.isArray(o[1])) h+='<optgroup label="'+esc(o[0])+'">'+(o[1]||[]).map(function(x){ return '<option value="'+esc(x[0])+'">'+esc(x[1])+'</option>'; }).join('')+'</optgroup>';
    else h+='<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>'; });
  sel.innerHTML=h;
  sel.value=keep; if(sel.value!==keep) sel.value=cur||''; };

/* [位置:phone-chats.js·P.sessPref] [新会话预设 + 会话级头像/主题映射] [10-26：预设存云端 chat-settings.cfg.sess_presets（配置页「自定义开始」维护，phone-pages 读写同一份）；本机只记「哪个会话用哪个头像/聊天主题」（localStorage ph_sess_av / ph_sess_style，换设备或清本机数据后回落全局头像/全局主题）；load 带 60 秒缓存，弹窗秒开再静默刷新] [注释时间 2026-10-26] */
P.sessPref={
  cache:[],
  load:function(force){ var self=this; if(!P.net) return Promise.resolve(self.cache);
    if(!force&&self._at&&Date.now()-self._at<60000) return Promise.resolve(self.cache);
    return P.net.get('/heartbeat/admin/chat-settings',{noLogin:true}).then(function(r){
      var L=(r&&r.data&&r.data.cfg&&r.data.cfg.sess_presets)||[]; if(!Array.isArray(L)) L=[];
      self.cache=L; self._at=Date.now(); return L; },function(){ return self.cache; }); },
  save:function(L){ this.cache=L; this._at=Date.now();
    return P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:{sess_presets:L}}}); },
  /* [位置:phone-chats.js·P.sessPref.emOf/emUri] [图标头像] [11-24：预设头像可以选「可爱图标 + 柔和圆底色」，存成 emoji:图标|#底色（自定义开始 → 选图标）；这里把它翻成一张内联 SVG 图片（图标占圆直径约六成、四周留白，Android 的表情字形偏宽也不顶边），于是所有画头像的地方（列表行、新建会话弹窗、编辑页、聊天页的 --av-sess）都走原来的 background-image 链路，不用各写一套。图标只收不含空白、引号、尖括号的 1~16 个字符，底色只收 # 加六位十六进制] [注释时间 2026-11-24] */
  EMOJIS:['🐱','🐶','🐰','🐻','🐼','🦊','🐸','🐹','🐨','🐯','🐮','🐑','🦌','🦢','🐬','🦋','🐝','🐣','🐌','🦔','🌙','⭐️','✨','☁️','🌸','🌷','🌻','🍓','🍑','🍒','🫐','🧸','🎀','🪄','💭','🫧','🍬','🍭','🧁','🍰','🍵','🎧','📷','💌','🪞','💍','🧺','🪴'],
  EMPAL:['#fbe3ea','#fdecdc','#fdf3cf','#e6f3d8','#d9f0ea','#dcebf7','#e4e3f6','#f3e3f3','#efe6da','#e9e9ef'],
  EMRE:/^emoji:([^\s"'<>\\|]{1,16})\|(#[0-9a-fA-F]{6})$/,
  emOf:function(u){ var m=this.EMRE.exec(String(u||'')); return m?{ch:m[1],bg:m[2]}:null; },
  emUri:function(u){ var e=this.emOf(u); if(!e) return ''; var c=this._emc||(this._emc={}), k=e.ch+'|'+e.bg;
    if(!c[k]){ c[k]='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="'+e.bg+'"/><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="62" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji">'+e.ch+'</text></svg>'); if(Object.keys(c).length>200) this._emc={}; }
    return c[k]; },
  avRaw:function(u){ var d=this.emUri(u); return d?'url(\''+d+'\')':(u?'url(\''+String(u).replace(/['\\]/g,'%27')+'\')':''); },
  avBg:function(u){ return this.avRaw(u)||'none'; },
  /* [位置:phone-chats.js·P.sessPref.autoAv] [预设未设头像时的随机小图标兜底] [11-23：没传头像的预设不再显示空灰圆，按 id/名称稳定分配一个精致小图标+柔和配色，自定义开始列表、编辑页与新会话弹窗共用] [注释时间 2026-11-23] */
  autoAv:function(seed){
    var ICONS=[
      '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>',
      '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
      '<path d="m12 3.5 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8Z"/>',
      '<path d="M20.2 4.8a5.5 5.5 0 0 0-7.8 0L5 12.2V19h6.8l7.4-7.4a5.5 5.5 0 0 0 0-7.8Z"/><path d="M16 8 4 20M17.5 14H9"/>',
      '<circle cx="12" cy="12" r="2.2"/><path d="M12 4.5a2.5 2.5 0 0 1 2.5 2.5c0 1.2-.8 2.2-2.5 2.8-1.7-.6-2.5-1.6-2.5-2.8A2.5 2.5 0 0 1 12 4.5Zm0 15a2.5 2.5 0 0 1-2.5-2.5c0-1.2.8-2.2 2.5-2.8 1.7.6 2.5 1.6 2.5 2.8A2.5 2.5 0 0 1 12 19.5ZM4.5 12a2.5 2.5 0 0 1 2.5-2.5c1.2 0 2.2.8 2.8 2.5-.6 1.7-1.6 2.5-2.8 2.5A2.5 2.5 0 0 1 4.5 12Zm15 0a2.5 2.5 0 0 1-2.5 2.5c-1.2 0-2.2-.8-2.8-2.5.6-1.7 1.6-2.5 2.8-2.5a2.5 2.5 0 0 1 2.5 2.5Z"/>',
      '<path d="M7.5 18h9.5a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 7 9.6 3.5 3.5 0 0 0 7.5 18Z"/>',
      '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 4v2M12 4v2"/>',
      '<path d="M12 6.5C10.5 5.3 8.3 4.7 5 4.7v13c3.3 0 5.5.6 7 1.8 1.5-1.2 3.7-1.8 7-1.8v-13c-3.3 0-5.5.6-7 1.8Z"/><path d="M12 6.5v13"/>',
      '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9Z"/>',
      '<path d="M12 19.5s-6.8-4.3-8.6-8.3A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.6 4.8c-1.8 4-8.6 8.3-8.6 8.3Z"/>',
      '<path d="M9 17.5V6.5l10-2v11"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
      '<circle cx="12" cy="12" r="5.2"/><path d="M3.5 14.8c2.2 1.2 6.4.4 10.6-1.8 4.2-2.2 6.9-4.9 6.4-6.4-.5-1.4-3.7-1-7.4.6"/>'
    ];
    var s=String(seed||'preset'), h=2166136261;
    for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=(h*16777619)>>>0; }
    return {svg:'<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[h%ICONS.length]+'</svg>', p:'ic-p'+((h>>>4)%8)};
  },
  avHtml:function(av,seed,cls,id){
    var c=cls||'', idAttr=id?' id="'+id+'"':'';
    if(av) return '<span class="av ai hasimg'+(c?' '+c:'')+'" style="background-image:'+this.avBg(av)+'"'+idAttr+'></span>';
    var a=this.autoAv(seed);
    return '<span class="av sp-icav '+a.p+' hasimg'+(c?' '+c:'')+'"'+idAttr+'>'+a.svg+'</span>';
  },
  _rd:function(k){ try{ return JSON.parse(localStorage.getItem(k)||'{}')||{}; }catch(e){ return {}; } },
  _wr:function(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} },
  /* [位置:phone-chats.js·P.sessPref.remote] [会话头像/聊天主题以服务器为准] [10-27：预设带的头像和主题现在存服务器会话配置（会话列表 avatar / chat_style 带回），换设备不丢；本机 ph_sess_av / ph_sess_style 只作兜底（老会话、网关没更新时的旧路径）；setRemote 按列表更新、没出现的会话不动，新建的会话用 setRemoteOne 立刻生效] [注释时间 2026-10-27] */
  remote:{},
  setRemote:function(list){ var m=this.remote; (list||[]).forEach(function(x){ if(!x||!x.id) return; if(x.avatar||x.chat_style) m[x.id]={av:x.avatar||'',style:x.chat_style||''}; else delete m[x.id]; }); },
  setRemoteOne:function(sid,o){ if(sid&&o&&(o.av||o.style||o.av==='')) this.remote[sid]={av:o.av||'',style:o.style||''}; },   /* 11-24：av 传空串是有意清掉（头像菜单「摘掉」），原来空值直接跳过、旧的会话头像一直留着 */
  avOf:function(sid){ var r=sid&&this.remote[sid]; if(r&&r.av) return r.av; return sid?(this._rd('ph_sess_av')[sid]||''):''; },
  setAv:function(sid,u){ var m=this._rd('ph_sess_av'); if(u) m[sid]=u; else delete m[sid]; this._wr('ph_sess_av',m); },
  styleOf:function(sid){ var r=sid&&this.remote[sid]; if(r&&r.style) return r.style; return sid?(this._rd('ph_sess_style')[sid]||''):''; },
  setStyle:function(sid,st){ var m=this._rd('ph_sess_style'); if(st) m[sid]=st; else delete m[sid]; this._wr('ph_sess_style',m); },
  /* [位置:phone-chats.js·P.sessPref.sum] [预设摘要行] [弹窗预设卡和配置页列表共用一份摘要（原先两处各写一份会漂移）；带跨窗口开/关和工具三态（跟全局/N个/全关）] [注释时间 2026-10-26 晚] */
  sum:function(p){ var mm=String(p.md||'').split('|'), a=[];
    if(mm.length>1) a.push(mm.slice(1).join('|'));
    if(p.style==='min') a.push('极简'); else if(p.style==='bubble') a.push('气泡');
    if(p.mcp_rules&&p.mcp_rules.servers){ var full=0, part=0; Object.keys(p.mcp_rules.servers).forEach(function(id){ var sr=p.mcp_rules.servers[id]; if(sr.def==='on') full++; else if((sr.except||[]).length) part++; });
      a.push((full||part)?((full?full+' 组全开':'')+(full&&part?' · ':'')+(part?part+' 组部分':'')):'工具全关'); }
    else a.push(!Array.isArray(p.mcps)?'工具跟全局':(p.mcps.length?p.mcps.length+' 工具':'工具全关'));
    a.push(p.xw&&p.xw.on===false?'跨窗关':'跨窗开');
    if(p.et===true||p.et===false) a.push(p.et?'距上一轮开':'距上一轮关');   /* 预设带距上一轮三态才露（2026-11-16 批3 H1） */
    if(p.ps) a.push('有人设');
    /* [位置:phone-chats.js·P.sessPref.sum 状态机] [预设的状态机模型只在非默认时露] [11-06：空=跟随会话模型，不占摘要位置；选了具体模型写「状态机 模型名」，选跟随全局状态机写「状态机独立」；提示词套不进摘要（摘要已经够长）] [注释时间 2026-11-06] */
    var cm0=String(p.cmp_model||'');
    if(cm0==='__role__') a.push('状态机独立'); else if(cm0.indexOf('|')>0) a.push('状态机 '+cm0.slice(cm0.indexOf('|')+1));
    return a.join(' · '); }
};

function html(){
  return '<div class="content cs">'+
    '<div class="cs-bar"><button class="back" hidden tabindex="-1" aria-hidden="true"></button><button class="cs-ib tap cs-gb" id="csGb" hidden aria-label="返回">'+IC.back+'</button><button class="cs-ib tap" id="csFind" aria-label="搜索">'+IC.find+'</button>'+
      '<div class="ttl">会话<small id="csSub"></small></div><span class="sp"></span><button class="cs-ib tap" id="csNew" aria-label="更多">'+IC.more+'</button></div>'+
    '<div class="sc cs-sc" id="csSc"><div class="cs-ls" id="csLs"></div><button class="cs-hint tap" id="csHint" type="button"></button></div>'+
    '<div class="sc cs-pane off" id="csMe" data-pane="me"></div><div class="sc cs-pane off" id="csCfg" data-pane="cfg"></div><div class="sc cs-pane cs-apps off" id="csApps" data-pane="apps"></div>'+
    '<nav class="cs-tabs" aria-label="切换">'+
      '<button class="on" data-tab="list">'+IC.chat+'<span>会话</span></button>'+
      '<button data-tab="me">'+IC.me+'<span>我的</span></button>'+
      '<button data-tab="cfg">'+IC.cfg+'<span>配置</span></button>'+
      '<button data-tab="apps" class="cs-wideonly">'+IC.apps+'<span>应用</span></button></nav>'+   /* 10-28 宽屏才显示：桌面那些应用的入口（phone-wide.css 控制显隐） */
    '<nav class="cs-mbar" id="csMbar" aria-label="多选操作"><button data-m="all">'+IC.all+'<span>全选</span></button><button data-m="exp">'+IC.exp+'<span>导出</span></button><button data-m="arch">'+IC.box+'<span>归档</span></button><button data-m="grp">'+IC.grp+'<span>归入组</span></button><button data-m="no">'+IC.x+'<span>取消</span></button></nav>'+
  '</div>';
}

function setup(win){
  /* [位置:phone-chats.js·setup popHost/isMinLayout] [实时识别极简布局与整屏浮层宿主] [修复极简初始化建抽屉时 P.minLayout 尚未挂载导致 popHost 落到半截 .mn-cs-host>.content，长按遮罩不全黑且 #mnMoreBtn 菜单坐标为负] [注释时间 2026-11-24] */
  function isMinOn(){ return !!((P.minLayout&&P.minLayout.on)||document.documentElement.classList.contains('min-layout')); }
  var host=$('.content',win), ls=$('#csLs',win), sc=$('#csSc',win), hint=$('#csHint',win), live=false;
  function getPopHost(){ return (isMinOn()&&P.D)?P.D:host; }
  /* [位置:phone-chats.js·mnGrpHead] [组内「返回全部会话」固定头] [11-20：原来这行拼在列表里跟着滚，而且点击走 ls 的通道、会被残留的 moved 吞掉；极简下挪到滚动区外钉死，点击自己接管] [注释时间 2026-11-20；2026-11-24 改用 isMinOn 防初始化时序漏建] */
  var gbHost=null;
  if(isMinOn()&&sc&&sc.parentNode){
    gbHost=document.createElement('div'); gbHost.className='mn-grphead'; gbHost.hidden=true;
    sc.parentNode.insertBefore(gbHost,sc);
    gbHost.addEventListener('click',function(e){ if(e.target.closest('[data-grpback]')){ buzz(6); closeGroup(); } });
  }
  /* [位置:phone-chats.js·setup 预热] [人设/模型清单在列表打开时就先拉] [11-05：放在 load 完成之后太晚（第一次打开头像菜单还是会看到只有 1 项）；这里延迟 600ms 起跑，不抢列表首屏的接口] [注释时间 2026-11-05] */
  if(P.sessOpts&&P.sessOpts.refresh) setTimeout(function(){ if(win.isConnected) P.sessOpts.refresh()['catch'](function(){}); },600);
  var S={sessions:[],names:{},pins:[],arch:[],locked:[],evs:[],groups:[],status:{},subst:{}}, GROUP=null;   /* GROUP = 当前打开的会话组 id（null = 主列表） */

  function put(u,body){ return P.net.req(u,{method:'PUT',body:body}); }
  function soft(u){ return P.net.get(u,{noLogin:true}).catch(function(){ return null; }); }
  function nameOf(x){ return S.names[x.id]||x.name||(x.id==='default'?'主会话':x.id); }
  function when(t){ return t?(P.net&&P.net.fmtTime?P.net.fmtTime(t):String(t).slice(5,16)):''; }
  function byId(id){ return S.sessions.filter(function(x){ return x.id===id; })[0]; }

  /* ---------- 列表 ---------- */
  function cnt(x){ return (x.real||x.total||0)+' 条'; }
  function brief(x){ return String(x.last_text||x.preview||'').replace(/<\s*sticker\b[^>]*>/gi,'[表情包]').replace(/<\s*sticker\b[^>]*$/i,'[表情包]').replace(/\s+/g,' ').trim(); }  /* 后端给前 40 字，宽度不够由 CSS 省略 */
  /* [位置:phone-chats.js·bfInfo/bfChip] [分支出处小标签] [11-10：后端 /v1/sessions 给分支会话带 branch_from（登记在 data/session-branches.json，由开分支接口写）；列表行第二行最前面显示「分支图标 + 原会话名」，点它直接打开原会话；原会话已删除就灰着写「原会话已删除」、不可点；聊天页的入口在 phone-talk.js·avSheet（P.talkCtx.branch）] [注释时间 2026-11-10] */
  var BFI='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M8.5 6.6h5a4 4 0 0 1 4 4"/></svg>';
  function bfInfo(x){ var b=x&&x.branch_from; if(!b||!b.id) return null; var p=byId(b.id); return {id:b.id,name:p?nameOf(p):'',gone:!p}; }
  function bfChip(x){ var b=bfInfo(x); if(!b) return ''; return '<span class="bf'+(b.gone?' gone':'')+'"'+(b.gone?'':' data-bf="'+esc(b.id)+'" role="link"')+'>'+BFI+'<em>'+esc(b.gone?'原会话已删除':b.name)+'</em></span>'; }
  /* [位置:phone-chats.js·avAI] [列表行头像] [10-26：会话有自己的头像（预设带的，本机映射）就在列表行盖它，没有回落全局「他的头像」；行内 --avimg 优先于 .av.ai 的 var(--av-ai)，hasimg 藏字母] [注释时间 2026-10-26] */
  function avAI(sid){ var u=P.sessPref?P.sessPref.avOf(sid):'';
    return '<div class="av ai'+(u?' hasimg':'')+'"'+(u?' style="background-image:'+P.sessPref.avBg(u)+'"':'')+' data-l="谢"><span class="snap-dot" data-snap="'+esc(sid)+'" hidden></span></div>'; }
  function rowHTML(x,arch){
    var pin=S.pins.indexOf(x.id)>=0, lk=S.evs.indexOf(x.id)>=0;   /* 11-10：睡眠唤醒并入事件唤醒，行上的「唤醒」小标看事件名单 */
    /* [位置:phone-chats.js·rowHTML] [归档行] [2026-10-26 批3：子进程行不给「取回」（取回也进不了主列表，纯误导），点行打开会话（聊天页；抽屉从聊天页输入框上方悬浮条进）] [注释时间 2026-10-26 改] */
    if(arch){ var sb=String(x.id||'').indexOf('s_sub_')===0; return '<div class="cs-it" data-id="'+esc(x.id)+'" role="button"><div class="bd"><div class="t"><b>'+esc(nameOf(x))+'</b></div><div class="m"><span class="mt">'+esc(cnt(x)+' · '+(when(x.last_time)||'还没开始聊'))+'</span></div></div>'+(sb?'':'<button class="cs-back tap" data-back="'+esc(x.id)+'" type="button">取回</button>')+'</div>'; }
    /* [位置:phone-chats.js·rowHTML 已归档行] [组内已归档置灰] [10-31：子会话组里已归档的子会话不消失（老子会话要留在组里），改成置灰+标「已归档」，一眼分清；归档抽屉(arch=true)不走这段] [注释时间 2026-10-31] */
    var ar=!arch&&S.arch.indexOf(x.id)>=0;
    return '<div class="cs-it'+(pin?' pin':'')+(ar?' arc':'')+'" data-id="'+esc(x.id)+'" role="button">'+
      '<div class="cs-x"><span class="n">'+esc(cnt(x))+'</span><dl class="d"><div><dt>创建</dt><dd>'+esc(x.created?String(x.created).slice(0,10):'—')+'</dd></div><div><dt>条数</dt><dd>'+esc(cnt(x))+'</dd></div><div><dt>模型</dt><dd>'+esc(x.model_name||'默认模型')+'</dd></div><div><dt>人设</dt><dd>'+esc(x.persona_name||'默认')+'</dd></div></dl></div>'+
      '<div class="cs-fg">'+avAI(x.id)+
      '<div class="bd"><div class="t"><b>'+esc(nameOf(x))+'</b>'+(lk?'<span class="lk">'+IC.wake+'唤醒</span>':'')+(ar?'<span class="lk gt">已归档</span>':'')+(stOf(x)?'<span class="st" data-st="'+esc(stOf(x))+'">'+esc(stOf(x))+'</span>':'')+'<time>'+esc(when(x.last_time))+'</time></div>'+
      '<div class="m">'+bfChip(x)+'<span class="mt">'+esc(brief(x)||'还没开始聊')+'</span></div></div></div>'+
    '</div>';
  }
  /* [位置:phone-chats.js·visible/mainRows/render] [主列表过滤 + 会话组并入排序] [2026-10-26 批3：s_sub_ 前缀是子智能体会话不进主列表；10-27：会话组——已在组里的会话不再出现在主列表，组本身像一行会话按「组内最近活跃」混排；打开某个组时只列它的成员] [注释时间 2026-10-27 改：加会话组] */
  function baseList(){ return S.sessions.filter(function(x){ return S.arch.indexOf(x.id)<0 && String(x.id||'').indexOf('s_sub_')!==0; }); }
  /* [位置:phone-chats.js·rtime/rank] [空会话按创建时间排队] [11-13：刚建还没发消息的会话 last_time 是空，原来会沉到列表最底；后端对空会话补了 created_iso（ISO，与 last_time 同格式），这里拿它兜底——不能直接用 created（'YYYY-MM-DD HH:MM' 本地格式），跟 ISO 比大小会错] [注释时间 2026-11-14] */
  function rtime(x){ return String(x.last_time||x.created_iso||''); }
  function rank(a,b){
    var pa=S.pins.indexOf(a.id)>=0?1:0, pb=S.pins.indexOf(b.id)>=0?1:0; if(pa!==pb) return pb-pa;
    return rtime(b)>rtime(a)?1:-1; }
  /* [位置:phone-chats.js·子会话组] [内置「子会话」组：所有 s_sub_ 会话自动在里面] [10-27 批1：子 AI 的会话不再跑完自动归档，直接归在这个组里、之后翻得到；成员不存盘，运行时取所有 s_sub_ 会话（已归档的老子会话也并入）；不可改名、不可解散、不能往里加会话；有子会话才显示] [注释时间 2026-10-27] */
  var SUBG={id:'g_sub',name:'子会话',icon:'bot',builtin:true,sids:[]};
  function isSub(id){ return String(id||'').indexOf('s_sub_')===0; }
  /* [位置:phone-chats.js·subList] [子会话一律进组，进行中也列] [2026-10-27 原：跑的时候先不列（点进去是空的）；2026-11-01报「跑的时候前端找不到这个会话」——子会话已经是真会话、聊天页能看实时进度，改成进行中也列，状态药丸显示「进行中」，随时能找到；只有内置「子会话」组收 s_sub_，主列表仍然过滤] [注释时间 2026-10-27；2026-11-01 改] */
  function subList(){ return S.sessions.filter(function(x){ return isSub(x.id); }); }
  function allGroups(){ return subList().length?S.groups.concat([SUBG]):S.groups; }
  function inSubGroup(){ var g=GROUP&&gById(GROUP); return !!(g&&g.builtin); }
  var SUBW={running:'进行中',done:'已完成'};
  function stOf(x){ if(S.status[x.id]) return S.status[x.id]; if(isSub(x.id)){ var w=S.subst[x.id]; return w?(SUBW[w]||'未完成'):''; } return ''; }   /* 2026-10-27：子会话自己写 <status>（已有的状态标签），写了就用它；没写才回落到运行记录推断 */
  /* [位置:phone-chats.js·gStat] [会话组行的状态汇总] [10-27 批1：组行显示组内状态数，如 待反馈 ×2 待回复 ×1；只数这三种要你留意的，已完成不显示] [注释时间 2026-10-27] */
  function gStat(m){ var c={}; m.forEach(function(x){ var s=stOf(x); if(s) c[s]=(c[s]||0)+1; });
    return ['待反馈','待回复','进行中'].filter(function(k){ return c[k]; }).map(function(k){ return '<span class="st" data-st="'+k+'">'+k+' ×'+c[k]+'</span>'; }).join(''); }
  function gById(id){ return allGroups().filter(function(g){ return g.id===id; })[0]; }
  function gOf(sid){ return S.groups.filter(function(g){ return (g.sids||[]).indexOf(sid)>=0; })[0]||null; }
  function gMembers(g){ if(g.builtin) return subList().sort(rank); return baseList().filter(function(x){ return (g.sids||[]).indexOf(x.id)>=0; }).sort(rank); }
  function gTime(g,m){ var t=String(g.at||''); m.forEach(function(x){ if(String(x.last_time||'')>t) t=String(x.last_time); }); return t; }
  function visible(){ return baseList().filter(function(x){ return !gOf(x.id); }).sort(rank); }
  var GRP_OPEN=false;
  function mainRows(){
    var arr=visible().map(function(x){ return {s:x,t:rtime(x),pin:S.pins.indexOf(x.id)>=0}; });
    if(!isMinOn()){
      allGroups().forEach(function(g){ var m=gMembers(g); arr.push({g:g,m:m,t:gTime(g,m),pin:false}); });
    }
    return arr.sort(function(a,b){ if(a.pin!==b.pin) return a.pin?-1:1; return a.t>b.t?-1:1; }); }
  function grpHTML(g,m){
    var sub=m.length?(m.length+(g.builtin?' 个子会话':' 个会话')):'还没有会话';   /* 10-27：组行不显示最近对话内容，只写个数；10-28：个数挪到名称那行（名称旁小字），状态药丸放第二行，免得挤没组名 */
    return '<div class="cs-it cs-grp" data-gid="'+esc(g.id)+'" role="button"><div class="cs-fg"><div class="av gi">'+(GIC[g.icon]||GIC.computer)+'</div>'+
      '<div class="bd"><div class="t"><b>'+esc(g.name||'会话组')+'</b><span class="gn">'+esc(sub)+'</span><time>'+esc(when(gTime(g,m)))+'</time></div><div class="m">'+gStat(m)+'</div></div></div></div>'; }
  function minGrpFoldHTML(){
    var gs=allGroups(); if(!gs.length) return '';
    var head='<button class="mn-grp-fold tap'+(GRP_OPEN?' open':'')+'" type="button" data-grpfold="1"><span class="mn-gf-t">会话组</span><span class="mn-gf-n">'+gs.length+'</span><svg class="mn-gf-ch" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>';
    if(!GRP_OPEN) return head;
    return head+'<div class="mn-grp-box">'+gs.map(function(g){ return grpHTML(g,gMembers(g)); }).join('')+'</div>';
  }
  /* [位置:phone-chats.js·archived] [已归档抽屉排序] [11-01：归档抽屉原来跟后端原始顺序走，改成和主列表同一套 rank 排序（置顶优先 + 最近活跃在前），取回/归档后一眼能找到刚动过的会话] [注释时间 2026-11-01] */
  function archived(){ return S.sessions.filter(function(x){ return S.arch.indexOf(x.id)>=0; }).sort(rank); }
  /* [位置:phone-chats.js·render] [手势中推迟重画] [缓存先画一次、后端回来再整段重画，正好落在按下与抬起之间就把按下的行摘掉了，这一下点击白丢] [注释时间 2026-10-27] */
  function render(force){   /* force：进组/出组是点击本身触发的，不能被「手势窗口」推迟，否则标题和动画先变、列表 350ms 后才换，看着跳一下（10-27） */
    if(!force&&P.afterGesture&&!P.afterGesture('chats',render)) return;
    var g0=GROUP&&gById(GROUP); if(GROUP&&!g0){ GROUP=null; barSync(); }
    var htm, cn, empty;
    if(g0){ var m0=gMembers(g0);
      /* [位置:phone-chats.js·render 组内返回行] [挪到滚动区外的固定头] [11-20：不再拼进列表（原来跟着列表滚、点击还被 moved 残留吞掉），改写进 gbHost] [注释时间 2026-11-20] */
      if(gbHost){ gbHost.hidden=false; gbHost.innerHTML='<button class="mn-grp-back" type="button" data-grpback="1"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg><span>返回全部会话</span><small>'+esc(g0.name||'会话组')+'</small></button>'; }
      htm=m0.map(function(x){ return rowHTML(x); }).join(''); cn=m0.length; empty='这个组还没有会话，点右上角「···」添加'; }
    else { if(gbHost){ gbHost.hidden=true; gbHost.innerHTML=''; } var rows=mainRows().filter(function(r){ return !(MULTI&&r.g); }); var fold=(isMinOn()&&!MULTI)?minGrpFoldHTML():''; htm=fold+rows.map(function(r){ return r.g?grpHTML(r.g,r.m):rowHTML(r.s); }).join(''); cn=rows.length; empty='<button class="lv-empty-btn tap" data-new type="button">还没有会话，点这里开一个</button>'; }
    ls.innerHTML=htm||'<div class="lv-empty">'+empty+'</div>';
    host.classList.toggle('cs-ingrp',!!g0);   /* 10-27：组内会话不显示头像（长按浮起的那一行也走这个类） */
    if(P.minLayout&&P.minLayout.setInGroup) P.minLayout.setInGroup(!!g0);
    $('#csSub',win).textContent='（'+cn+'）';
    hint.innerHTML=''; hint.style.display='none';
    P.markAv&&P.markAv();
    refreshDots();
    if(MULTI){ Array.prototype.forEach.call(ls.querySelectorAll('.cs-it'),function(r){ r.classList.toggle('sel',!!MULTI.sel[r.getAttribute('data-id')]); }); mpaint(); }
    /* [位置:phone-chats.js·render 滚动位] [返回列表时停在刚才那一行] [11-13：聊完返回列表整段重画、滚回顶部，从第 30 行点进去的得再滚回去；现在 onBack 记下 scrollTop，重画后恢复（1.6 秒内有效，用户一动手就停）] [注释时间 2026-11-14] */
    if(RESTORE_Y>=0){ try{ sc.scrollTop=RESTORE_Y; }catch(e){} }
  }
  /* [位置:phone-chats.js·load 缓存] [会话列表先画上次的，再拉后端校正] [10-24 需求 21：名称/置顶/归档/锁定一起存一份（ph_c_chats）；打开先画缓存（等字体就绪），后端回来后内容有变才重画，没变不动；连不上后台时有缓存就保留缓存只提示一声，没有缓存才显示失败框；只在第一次打开时用缓存，之后的刷新（点重试、改完刷新）直接拉] [注释时间 2026-10-24] */
  var cachedShown=false, MULTI=null, LDV=null, RESTORE_Y=-1;   /* MULTI = {sel:{id:1}}：多选模式；LDV = 首屏毛玻璃加载层（P.load.show），数据到了 done()；RESTORE_Y = 返回列表时要恢复的滚动位（-1 = 不用恢复） */
  function cacheSet(S0){ S.status=S0.status||{}; S.subst=S0.subst||{}; S.groups=S0.groups||[]; S.sessions=S0.sessions||[]; if(P.sessPref) P.sessPref.setRemote(S.sessions); S.names=S0.names||{}; S.arch=S0.arch||[]; S.pins=S0.pins||[]; S.locked=S0.locked||[]; }
  function load(){
    var first=!live&&!cachedShown, snap0=null;
    if(first){ var c0=P.net.peek('chats'); if(c0&&c0.sessions&&c0.sessions.length){ snap0=JSON.stringify(c0); cachedShown=true; cacheSet(c0); render(); } }
    /* [位置:phone-chats.js·load 毛玻璃层] [没有上次的列表时才糊一层，等数据到了散去] [11-05：有缓存就直接画，不闪遮罩；没缓存（第一次装/清过本机数据）才铺毛玻璃 + 动画，成功后 160ms 散去，失败也散去露出「没连上后台 · 点一下重试」] [注释时间 2026-11-05] */
    /* dy:-14 = 往上挪 14px：顶栏 52 + 底部标签栏 80（764~844），可用区 52~764 的中心是 408，整窗中心 422（11-05 实测） */
    if(!cachedShown&&!live&&P.load&&!LDV) LDV=P.load.show(win,{page:1,dy:-14});
    /* [位置:phone-chats.js·load 分层放行] [主数据先画、名单后校正] [11-13 #20：原来 9 个请求 Promise.all 全到齐才 render + live=true，最慢的名单接口拖住一切——慢网下进会话/新建/搜索要白等两三秒。拆两层：/v1/sessions 一到就 live=true + 画列表（可点、可进、可新建），8 个名单（名字/置顶/归档/锁定/组/状态/子会话/事件唤醒）到了再校正重画。置顶/归档的 PUT 是增量 add/remove（routes/session-misc.js「逐项合并，不做整表覆盖」），名单晚到的几秒里操作也安全，不用禁用；行上勾选态取自缓存，跟旧版等名单的区别只是那几秒显示的是上次的样子] [注释时间 2026-11-14] */
    var mainOK=false;
    var mainReq=P.net.get('/v1/sessions',{noLogin:true});
    var restReq=Promise.all([soft('/heartbeat/admin/session-names'),soft('/heartbeat/admin/session-archive'),soft('/heartbeat/admin/session-pins'),soft('/heartbeat/admin/wake-locked'),soft('/heartbeat/admin/chat-settings'),soft('/heartbeat/admin/session-status'),soft('/heartbeat/admin/subagent-status'),soft('/heartbeat/admin/wake-event-sessions')]);
    mainReq.then(function(r0){
      mainOK=true;
      live=true; S.sessions=((r0&&r0.sessions)||[]).filter(function(x){ return x&&x.id; }); if(P.sessPref) P.sessPref.setRemote(S.sessions); syncLooks();
      if(LDV){ LDV.done(); LDV=null; }
      var sameMain=false;
      try{ if(cachedShown&&snap0){ var c0s=(JSON.parse(snap0).sessions||[]).filter(function(x){ return x&&x.id; }); sameMain=JSON.stringify(c0s)===JSON.stringify(S.sessions); } }catch(e){}
      if(!sameMain) render();   /* 主数据和首屏缓存一致就不重画，防闪；名单还没到时画的是缓存的置顶/名字 */
    }).catch(function(){
      /* [位置:phone-chats.js·load(catch)] [没连上后台] [演示会话已删（2026-10-22）：连不上就显示「没连上后台 · 点一下重试」，不再放编的会话] [注释时间 2026-10-22] */
      /* [位置:phone-chats.js·load 自愈重试] [失败后 2.6s 自动重试一次] [10-29：网关重启窗口列表加载失败后 live 一直 false，搜索/新建全被挡；自动补一枪，不用她手动刷新] [注释时间 2026-10-29] */
      if(LDV){ LDV.done(); LDV=null; }
      if(!load._rt){ load._rt=1; setTimeout(function(){ if(win.isConnected&&!live) load(); },2600); }
      if(cachedShown&&S.sessions.length){ P.toast('没连上后台，先显示上次的'); return; }
      S.sessions=[]; S.pins=[]; S.arch=[]; S.locked=[]; S.groups=[]; S.status={}; S.subst={}; S.names={}; render(); ls.innerHTML=P.net.failBox(); $('#csSub',win).textContent='';
    });
    restReq.then(function(r){
      if(!mainOK) return;   /* 主请求失败 = 后台没连上，名单结果不可信，保持缓存画面不清空 */
      S.names=(r[0]&&r[0].names)||{}; S.arch=(r[1]&&r[1].archived)||[]; S.pins=(r[2]&&r[2].pins)||[]; S.locked=(r[3]&&r[3].sessions)||[];
      /* [位置:phone-chats.js·load 会话组] [会话组读云端] [10-27：存 chat-settings.cfg.session_groups（跨设备同步）；没取到就保留现有，不当成「没有组」清掉] */
      var gc=r[4]&&r[4].data&&r[4].data.cfg&&r[4].data.cfg.session_groups;
      if(Array.isArray(gc)) S.groups=gc.filter(function(g){ return g&&typeof g.id==='string'; }); else if(r[4]&&r[4].data) S.groups=[];
      /* [位置:phone-chats.js·load 会话状态] [列表读每个会话的进展状态] [10-27：AI 用 <status> 标记 进行中/待回复/待反馈/已完成，服务器存 data/session-status.json；没取到就保留现有] */
      if(r[5]&&r[5].status) S.status=r[5].status;
      if(r[7]&&Array.isArray(r[7].sessions)) S.evs=r[7].sessions;   /* 11-04 事件唤醒名单（和锁定=定时唤醒分开） */
      if(r[6]&&r[6].status&&typeof r[6].status==='object') S.subst=r[6].status;   /* 2026-10-27 批1：子会话运行状态（running/done/…），给「子会话」组汇总和组内行的状态药丸用 */
      var snap1={sessions:S.sessions,names:S.names,arch:S.arch,pins:S.pins,locked:S.locked,groups:S.groups,status:S.status,subst:S.subst}, js1=JSON.stringify(snap1);
      if(r[0]&&r[1]&&r[2]&&r[3]&&r[4]) P.net.keep('chats',snap1);   /* 有一项没取到（soft 返回 null）就不覆盖缓存，免得把名字/置顶存丢 */
      if(!(cachedShown&&js1===snap0)) render();
      /* [位置:phone-chats.js·load 角标核验] [列表角标数据] [10-25：一次批量拿全部会话过期状态（后端并发核验+30s缓存），写进 SNAP 再亮点；失败静默，点保持藏] [注释时间 2026-10-25] */
      /* [位置:phone-chats.js·load 预热] [人设/模型清单提前拉一次] [11-05：面板/弹窗打开不等网络——列表拿到后，空闲时顺手把这份清单预热进本机缓存（第一次也没有冷启动那 2 秒）] [注释时间 2026-11-05] */
      if(P.sessOpts&&P.sessOpts.refresh){ var pre=function(){ P.sessOpts.refresh()['catch'](function(){}); };
        if(window.requestIdleCallback) requestIdleCallback(pre,{timeout:4000}); else setTimeout(pre,2500); }
      P.net.get('/v1/sessions/snapshot-stale-all',{noLogin:true}).then(function(j){
        if(!j||j.ok!==true) return;
        var m=j.stale||{};
        Object.keys(m).forEach(function(k){ SNAP[k]={stale:true,reasons:m[k]||[],at:Date.now()}; });
        refreshDots();
      },function(){});
    });
  }
  /* [位置:phone-chats.js·重试] [重试时铺毛玻璃层] [11-05：原来重试是把 loadBox 塞进列表里；现在统一用铺满窗口的毛玻璃层，重试用同一条路] [注释时间 2026-11-05] */
  win.addEventListener('click',function(e){ if(e.target.closest('[data-new]')){ newSess(); return; } if(e.target.closest('[data-retry]')){ ls.innerHTML=''; if(P.load&&!LDV) LDV=P.load.show(win,{page:1,dy:-14}); load(); } });

  /* [位置:phone-chats.js·syncLooks] [老会话头像/主题一次性上云] [10-27：以前用预设开的会话，头像和聊天主题只存在手机本地（ph_sess_av / ph_sess_style）；列表拉到后，把「服务器还没有、本机有」的交给服务器（POST /v1/sessions/look-sync，只补没有的不覆盖）；
     成功后记 ph_look_synced 不再重复；本机记录保留作兜底] [注释时间 2026-10-27] */
  function syncLooks(){
    var P0=P.sessPref; if(!live||!P0||P0._syncing) return;
    try{ if(localStorage.getItem('ph_look_synced')==='1') return; }catch(e){}
    var av=P0._rd('ph_sess_av'), st=P0._rd('ph_sess_style'), items={}, n=0;
    S.sessions.forEach(function(x){ var r0=P0.remote[x.id]; if(r0&&(r0.av||r0.style)) return; if(av[x.id]||st[x.id]){ items[x.id]={avatar:av[x.id]||'',style:st[x.id]||''}; n++; } });
    if(!n){ try{ localStorage.setItem('ph_look_synced','1'); }catch(e){} return; }
    P0._syncing=true;
    P.net.post('/v1/sessions/look-sync',{items:items},{noLogin:true}).then(function(){ P0._syncing=false; Object.keys(items).forEach(function(k){ P0.setRemoteOne(k,{av:items[k].avatar,style:items[k].style}); }); try{ localStorage.setItem('ph_look_synced','1'); }catch(e){} },function(){ P0._syncing=false; });
  }
  /* ---------- 点一行 / 长按 ---------- */
  var lpT=0, lpId=null, lpXY=null, moved=false, swallow=false;
  ls.addEventListener('pointerdown',function(e){
    /* 1027：swallow 原来只在收到 click 时才清，长按菜单把那次 click 接走就会一直挂着、吞掉下一次点击；改成每次按下都复位（同 moved）。
       11-20：复位必须放在「只认会话行」的守卫前面——「返回全部会话」「会话组折叠」不是 .cs-it，之前只要在列表里拖过一下，moved 残留成 true，这些按钮连同会话行一起点不动 */
    moved=false; swallow=false; lpXY=null;
    var it=e.target.closest('.cs-it'); if(!it||MULTI) return;
    lpXY={x:e.clientX,y:e.clientY};
    clearTimeout(lpT); var rr=it.getBoundingClientRect(); it.style.setProperty('--px',(e.clientX-rr.left)+'px'); it.style.setProperty('--py',(e.clientY-rr.top)+'px'); it.classList.add('pressed'); lpT=setTimeout(function(){ swallow=true; menu(it); },430);
  });
  ls.addEventListener('pointermove',function(e){ if(lpXY&&Math.hypot(e.clientX-lpXY.x,e.clientY-lpXY.y)>12){ moved=true; clearTimeout(lpT); Array.prototype.forEach.call(ls.querySelectorAll('.pressed'),function(x){ x.classList.remove('pressed'); }); } });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){ ls.addEventListener(ev,function(){ clearTimeout(lpT); var ps=ls.querySelectorAll('.pressed'); setTimeout(function(){ Array.prototype.forEach.call(ps,function(x){ x.classList.remove('pressed'); }); },ev==='pointerup'?260:0); }); });
  ls.addEventListener('contextmenu',function(e){ e.preventDefault(); });
  /* ---------- 左滑：轻拽露出条数、松手自己弹回；使劲拽 = 整行滑走只剩一成，露出详情；点别处回去 ---------- */
  var sw=null, openIt=null;
  function fgOf(it){ return it.querySelector('.cs-fg'); }
  function setX(it,x,anim){ var fg=fgOf(it), w=it.offsetWidth; fg.style.transition=anim?'transform .5s cubic-bezier(.22,1.25,.36,1)':'none'; fg.style.transform=x?'translateX('+x+'px)':''; var a=Math.min(1,Math.max(0,(-x-24)/56)), f=Math.min(1,Math.max(0,(-x-w*.38)/(w*.3))); it.style.setProperty('--sa',a.toFixed(3)); it.style.setProperty('--sf',f.toFixed(3)); it.classList.toggle('swiping',!!x); }
  function shut(it){ if(!it) return; setX(it,0,true); it.classList.remove('opened'); if(openIt===it) openIt=null; }
  ls.addEventListener('pointerdown',function(e){ var it=e.target.closest('.cs-it'); if(!it||!fgOf(it)||MULTI||it.classList.contains('cs-grp')) return; sw={it:it,x:e.clientX,y:e.clientY,ax:null,id:e.pointerId,base:it.classList.contains('opened')?-it.offsetWidth*.9:0}; });
  ls.addEventListener('pointermove',function(e){ if(!sw||e.pointerId!==sw.id) return; var dx=e.clientX-sw.x, dy=e.clientY-sw.y;
    if(sw.ax===null){ if(Math.abs(dx)<12&&Math.abs(dy)<12) return; sw.ax=Math.abs(dx)>Math.abs(dy)*1.2&&(dx<0||sw.base)?'x':'y'; if(sw.ax==='x'){ try{ sw.it.setPointerCapture(e.pointerId); }catch(_){} if(openIt&&openIt!==sw.it) shut(openIt); } }
    if(sw.ax!=='x') return; var w=sw.it.offsetWidth, raw=sw.base+dx, x=raw>0?raw*.25:raw>-w*.9?raw:-w*.9+(raw+w*.9)*.2; setX(sw.it,x,false); });
  /* [位置:phone-chats.js·swEnd] [左滑不再吞掉轻点] [原来只要判定成横划、松手就置 swallow 80ms，拇指带十几像素漂移的一次正常点击会被吃掉；现在位移过 20px 才算真滑过，才吞这一下] [注释时间 2026-10-27] */
  function swEnd(e){ if(!sw) return; var s2=sw; sw=null; if(s2.ax!=='x') return;
    var w=s2.it.offsetWidth, dx=e.clientX-s2.x, raw=s2.base+dx;
    if(Math.abs(dx)>20){ swallow=true; setTimeout(function(){ swallow=false; },80); }
    if(raw<-w*.42){ setX(s2.it,-w*.9,true); if(!s2.it.classList.contains('opened')) buzz([8,30,8]); s2.it.classList.add('opened'); openIt=s2.it; }
    else { if(-raw>40&&!s2.base) buzz(5); shut(s2.it); } }
  ls.addEventListener('pointerup',swEnd); ls.addEventListener('pointercancel',function(){ if(sw&&sw.ax==='x') shut(sw.it); sw=null; });
  /* 拽出来以后，点屏幕任何地方都先收回去（这一下不算点进会话） */
  function eatClick(){ var eat=function(ev){ ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click',eat,true); }; document.addEventListener('click',eat,true); setTimeout(function(){ document.removeEventListener('click',eat,true); },500); }
  /* [位置:phone-chats.js·长按菜单 docPd] [关页自卸] [原匿名捕获监听挂 document 卸不掉，会话列表每开一次多挂一个；改具名函数 + isConnected 自卸] [注释时间 2026-10-26] */
  function docPd(e){ if(!win.isConnected){ document.removeEventListener('pointerdown',docPd,true); return; } if(!openIt) return; if(openIt.contains(e.target)) return; shut(openIt); eatClick(); }
  document.addEventListener('pointerdown',docPd,true);
  ls.addEventListener('click',function(e){
    if(swallow){ swallow=false; return; }
    var gb=e.target.closest('[data-grpback]'); if(gb&&!moved){ buzz(6); closeGroup(); return; }
    var gf=e.target.closest('[data-grpfold]'); if(gf&&!moved){ buzz(6); GRP_OPEN=!GRP_OPEN; render(true); return; }
    if(MULTI){ var mi=e.target.closest('.cs-it'); if(mi) mtoggle(mi); return; }
    var bfc=e.target.closest('[data-bf]'); if(bfc&&!moved){ buzz(8); openChat(bfc.getAttribute('data-bf')); return; }   /* 11-10 点「分支自」标签＝直接打开原会话 */
    var it=e.target.closest('.cs-it'); if(!it||moved) return; if(it.classList.contains('opened')){ shut(it); return; } buzz(8);
    if(it.getAttribute('data-gid')){ openGroup(it.getAttribute('data-gid')); return; }
    openChat(it.getAttribute('data-id'));
  });
  /* [位置:phone-chats.js·openChat] [打开会话（可带定位）] [搜索点一条结果要落在那条消息上，而不是只打开会话尾部] [注释时间 2026-10-21]
     loc = {sidx,q}：sidx 是后端 /v1/search 给的「第几条」（与 /v1/history 可见序列同口径），q 是搜索词，聊天页据此定位并高亮。 */
  function openChat(id,loc){
    if(live||cachedShown) P.net.req('/heartbeat/admin/current-session',{method:'PUT',body:{session:id}}).catch(function(){});   /* 11-09：缓存先画出来的列表也算（见 pushTalk 注释） */
    pushTalk(id,loc);
  }
  /* 进聊天页：在会话列表上面再叠一层，从右边推进来；返回就推回去，列表还在原处 */
  function pushTalk(id,loc){
    var app=P.app&&P.app('talk'), D=P.D||win.parentNode, old=D&&D.querySelector('.win.tk-layer');
    /* [位置:phone-chats.js·pushTalk 宽屏替换] [宽屏右栏已开着一个聊天时，点另一个会话＝换掉它] [10-28：窄屏聊天层盖住列表，点不到别的行，所以原来「已有聊天层就不再开」；宽屏左栏列表一直能点，要替换；点的就是当前这个会话就不动] [注释时间 2026-10-28] */
    if(old&&P.wide&&P.wide.on){ if(P.talkCtx&&P.talkCtx.id===id&&!loc) return; P.talkCtx=null; old.remove(); old=null; }
    /* [位置:phone-chats.js·pushTalk 退场窗口] [返回动画期间点另一行不再白丢] [11-05：旧聊天层退场要 300ms，这段里原来直接 return，点下去一点反馈都没有（实测返回后 250ms 那一下必丢，所以感觉「要进好几次」）；现在把还在退场的旧窗口直接摘掉、立刻开新的；旧窗口的 SSE/定时器有 isConnected 守卫会自己收尾] [注释时间 2026-11-05] */
    if(!app||!D) return;
    if(old){ P.talkCtx=null; old.remove(); old=null; }
    /* [位置:phone-chats.js·pushTalk 缓存态也能开真会话] [列表先用本机缓存画出来时（live 还是 false）点进去，聊天页拿不到会话 id、是个空壳，要退出重进（那时 live 已 true）才开始拉取] [11-09 随手记：好多页面怎么都要点第二次第三次才开始拉；根因＝这里原来只认 live（后端列表拉成功才置 true），缓存秒显的那几百毫秒～几秒点击全落进空壳；改成 live 或「缓存列表已画出」都按真会话开——会话 id 来自缓存/后端同一份列表，聊天页自己负责拉消息和失败提示] [注释时间 2026-11-09] */
    var x=id&&(byId(id)||{id:id}); P.talkCtx=(live||cachedShown)&&x?{id:x.id,name:nameOf(x),locate:loc||null,branch:bfInfo(x),onBack:function(){ RESTORE_Y=(sc&&sc.scrollTop)||0; load(); setTimeout(function(){ RESTORE_Y=-1; },1600); }}:null;
    var t=document.createElement('div'); t.className='win tk-layer'; t.dataset.win='talk'; t.style.zIndex='26'; t.style.background='var(--tkbg,#eef4fb)'; t.innerHTML=app.html();
    D.appendChild(t); try{ app.setup(t); }catch(err){ console.error(err); }
    t.animate([{transform:'translateX(100%)'},{transform:'none'}],{duration:380,easing:'cubic-bezier(.2,.9,.25,1)'});
    var bk=t.querySelector('.back'); if(bk) bk.addEventListener('click',function(e){ e.stopPropagation(); buzz(6);
      var a=t.animate([{transform:'none'},{transform:'translateX(100%)'}],{duration:300,easing:'cubic-bezier(.3,.7,.4,1)'}); a.onfinish=function(){ t.remove(); var c=P.talkCtx; P.talkCtx=null; if(c&&c.onBack) c.onBack(); }; });
  }

  /* ---------- 长按菜单 ---------- */
  function menu(it){
    if(it.getAttribute('data-gid')){ gmenu(it); return; }
    var id=it.getAttribute('data-id'), x=byId(id); if(!x) return; buzz([12,40,18]);
    var pin=S.pins.indexOf(id)>=0;
    var popHost=getPopHost();
    var r=it.getBoundingClientRect(), hr=popHost.getBoundingClientRect();
    var ov=document.createElement('div'); ov.className='cs-ov';
    var lift=it.cloneNode(true); lift.classList.remove('pressed'); lift.classList.add('lift'); lift.removeAttribute('style');
    lift.style.cssText='top:'+(r.top-hr.top)+'px;left:'+(r.left-hr.left)+'px;width:'+r.width+'px';
    var below=r.bottom-hr.top+8, up=(below+350>hr.height);
    var isMin=isMinOn();
    var mi=isMin?{
      rename:'<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
      cpid:'<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      pin:'<svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg>',
      grp:'<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
      evwake:'<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 2M5 3.5 2.5 6M19 3.5 21.5 6"/></svg>',
      snap:'<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/></svg>',
      exp:'<svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></svg>',
      arch:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>'
    }:null;
    var ic=function(k){ return mi&&mi[k]?'<span class="cm-ic">'+mi[k]+'</span>':''; };
    ov.innerHTML='<div class="scrim"></div><div class="cs-menu'+(isMin?' mn-cmenu':'')+'" style="'+(up?'bottom:'+(hr.bottom-r.top+8)+'px':'top:'+below+'px')+'">'+
      '<button data-a="rename">'+ic('rename')+'<span>改名</span></button>'+
      '<button data-a="cpid">'+ic('cpid')+'<span>复制会话 id</span></button>'+
      '<button data-a="pin">'+ic('pin')+'<span>置顶</span>'+(pin?'<i>✓</i>':'')+'</button>'+
      (inSubGroup()?'':'<button data-a="grp">'+ic('grp')+'<span>'+(GROUP?'移出组':'分组')+'</span></button>')+
      '<button data-a="evwake">'+ic('evwake')+'<span>事件唤醒</span>'+(S.evs.indexOf(id)>=0?'<i>✓</i>':'')+'<small>你有动静（碎碎念、心情、相册）或停聊一阵时叫他</small></button>'+
      '<button data-a="snap">'+ic('snap')+'<span>重建快照</span><span class="snap-dot" hidden title="快照已过期，点这里看原因"></span></button>'+
      '<button data-a="export">'+ic('exp')+'<span>导出</span></button>'+
      '<button data-a="arch" class="red">'+ic('arch')+'<span>'+(S.arch.indexOf(id)>=0?'取消归档':'归档')+'</span></button></div>';
    ov.appendChild(lift); popHost.appendChild(ov); P.markAv&&P.markAv();
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ ov.classList.add('show'); }); });
    function close(){ ov.classList.remove('show'); ov.classList.add('closing'); setTimeout(function(){ ov.remove(); },240); }
    ov.querySelector('.scrim').addEventListener('click',close);
    ov.querySelector('.cs-menu').addEventListener('click',function(e){
      var dot=e.target.closest('.snap-dot');
      if(dot){ e.stopPropagation(); close(); snapStaleSheet(id); return; }
      var b=e.target.closest('[data-a]'); if(!b) return; var a=b.getAttribute('data-a'); close(); act(a,id);
    });
    snapDotCheck(ov,id,close);
  }
  function act(a,id){
    var x=byId(id)||{id:id};
    if(a==='pin'){ var on=S.pins.indexOf(id)<0; var done=function(){ if(on) S.pins.push(id); else S.pins=S.pins.filter(function(y){ return y!==id; }); render(); toast(on?'已置顶':'已取消置顶'); };
      if(live) put('/heartbeat/admin/session-pins',on?{add:[id]}:{remove:[id]}).then(done,function(){ toast('没改成，稍后再试'); }); else toast('没连上后台，没改'); }
    /* [位置:phone-chats.js·act evwake] [事件唤醒开关] [11-04：定时唤醒和事件唤醒分开，长按菜单各一项；选了事件唤醒就会被事件叫醒（碎碎念/经期/心情/相册），不用再靠锁定] [11-09：原「定时唤醒」(锁定名单) 改名「睡眠唤醒」——你在会话里最后一句话之后停聊满 N 分钟叫他一次；事件唤醒里的睡着/醒来已去掉，醒来改成你自己设每天闹钟] [注释时间 2026-11-09] */
    else if(a==='evwake'){ var on3=S.evs.indexOf(id)<0, ne=on3?S.evs.concat([id]):S.evs.filter(function(y){ return y!==id; });
      var d3=function(){ S.evs=ne; render(); toast(on3?'已开事件唤醒：你有动静、或停聊一阵时他会来这个会话':'已关事件唤醒'); };
      if(live) put('/heartbeat/admin/wake-event-sessions',{sessions:ne}).then(d3,function(){ toast('没改成，稍后再试'); }); else toast('没连上后台，没改'); }
    /* [位置:phone-chats.js·act 归档切换] [归档/取消归档] [10-31：组内已归档的行还在列表里（置灰），长按菜单要能切回去，归档项按状态变「取消归档」；普通会话已归档的不在列表里，行为不变] [注释时间 2026-10-31] */
    else if(a==='arch'){ var ar0=S.arch.indexOf(id)>=0;
      var d3=function(){ if(ar0) S.arch=S.arch.filter(function(y){ return y!==id; }); else if(S.arch.indexOf(id)<0) S.arch.push(id); render(); toast(ar0?'已取消归档':'已归档，右滑可以取回'); };
      if(live) put('/heartbeat/admin/session-archive',ar0?{remove:[id]}:{add:[id]}).then(d3,function(){ toast(ar0?'没取消成':'没归档成功'); }); else toast('没连上后台，没改'); }
    else if(a==='snap') snapRebuild(id);
    else if(a==='rename') rename(id);
    else if(a==='grp') grpOne(id);
    else if(a==='cpid'){ /* [位置:phone-chats.js·act 复制会话id] [复制会话 id] [10-29：给「新建会话指定承接」配着用——复制后去新建会话点「读剪贴板」] [注释时间 2026-10-29] */ chatsCopyText(id,function(){ toast('会话 id 复制好了：'+id); buzz([8,30,8]); }); }
    else if(a==='export') exportSession(x);
  }

  /* [位置:phone-chats.js·snapReasonText] [快照过期原因翻译] [后端 snapshot-stale 只给英文 key，翻成人话让她知道为什么该重建] [注释时间 2026-10-21]
     映射表同 chat.html 的 snapRebuildSession（L9062，列表版更全），没见过的 key 原样带上「前缀状态变化」。 */
  var SNAP_WHY={ tools:'工具清单有变化（如新增 / 修改工具描述）', system:'人设有变化', edited:'消息被编辑、压缩或状态摘要更新', format:'快照为旧格式，重建可升级到新结构', structure:'注入结构（勾选的块）有变化', blocks:'系统注入块有变化（人设 / 记忆 / 日记已更新）',
    'block:system_instructions':'永久上下文有变化', 'block:core_identity':'核心身份（交互偏好）有更新', 'block:long_term_understanding':'长期理解（用户画像）有更新',
    'block:conversation_continuity':'建会话时注入的那几篇日记被修改 / 隐藏 / 删除了', 'block:starred_dialog':'建会话时注入的那几条标星被修改 / 取消了', 'block:notebook_index':'笔记本目录有变化（笔记/文件夹增删，或标题、摘要改了）', 'block:pinned_notes':'置顶笔记有变化（置顶/取消置顶，或置顶笔记的内容改了）', 'block:memory_keywords':'记忆池关键词有变化（记忆新增 / 修改 / 被替代，关键词汇总变了）' };
  function snapReasonText(list){ return (list||[]).slice(0,6).map(function(r){ return SNAP_WHY[r]||('前缀状态变化（'+r+'）'); }); }
  /* [位置:phone-chats.js·snapDotCheck] [重建快照红点] [菜单里「重建快照」旁亮红点，一眼知道该不该点；点红点看原因] [注释时间 2026-10-21]
     菜单打开后才单独请求 GET /v1/sessions/:id/snapshot-stale（列表首屏不逐个核验，避免拖慢）；菜单已关就丢弃迟到结果。 */
  var SNAP={}; /* id -> {stale,reasons,at}，30 秒内复用 */
  /* [位置:phone-chats.js·refreshDots] [列表头像角标] [10-25：按 SNAP 缓存亮/藏列表每行头像角标；纯展示不可点，重建仍走长按菜单；SNAP 没有的一律藏] [注释时间 2026-10-25] */
  function refreshDots(){
    Array.prototype.forEach.call(ls.querySelectorAll('.snap-dot'),function(d){ var c=SNAP[d.getAttribute('data-snap')]; d.hidden=!(c&&c.stale); });
  }
  function snapDotCheck(ov,id,close){
    if(!live||id==='default') return;
    var dot=ov.querySelector('.snap-dot'); if(!dot) return;
    var paint=function(c){ if(c&&c.stale&&ov.isConnected) dot.hidden=false; };
    var c=SNAP[id]; if(c&&Date.now()-c.at<30000){ paint(c); return; }
    P.net.get('/v1/sessions/'+encodeURIComponent(id)+'/snapshot-stale',{noLogin:true}).then(function(j){
      if(!j||j.ok!==true) return; SNAP[id]={stale:!!j.snap_stale,reasons:j.snap_stale_reasons||[],at:Date.now()}; paint(SNAP[id]);
    },function(){});
  }
  /* [位置:phone-chats.js·snapStaleSheet] [快照过期说明] [点红点：说清为什么过期，一键立即重建（免二次确认）] [注释时间 2026-10-21] */
  function snapStaleSheet(id){
    var c=SNAP[id]||{reasons:[]}, rs=snapReasonText(c.reasons); if(!rs.length) rs=['前缀状态有变化'];
    sheet('<div class="hd">该会话快照已过期</div><div class="opt"><p class="snap-p">重建后会立即应用最新内容：</p><ul class="snap-ul">'+rs.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul></div><button class="nw tap">立即重建</button>',function(box,close){
      box.querySelector('.nw').addEventListener('click',function(){ close(); snapRebuild(id,true); });
    },'opts');
  }
  /* [位置:phone-chats.js·snapRebuild] [重建快照] [先说清会更新什么再确认，成功如实说「已清除、下一轮对话重建」（接口只清快照，真正重建发生在下一轮）] [注释时间 2026-10-21]
     POST /v1/sessions/:id/snapshot/rebuild。旧版直接发请求并说「重建好了」，语义不对，且没有确认和原因。skip=true 来自红点说明页（已看过原因，免二次确认）。 */
  function snapRebuild(id,skip){
    if(!live){ toast('没连上后台，重建不了'); return; }
    var go=function(){
      P.net.post('/v1/sessions/'+encodeURIComponent(id)+'/snapshot/rebuild',{}).then(function(d){
        if(d&&d.error){ toast('没重建成功：'+String(d.error).slice(0,40)); buzz([20,30,20]); return; }
        delete SNAP[id]; refreshDots(); toast('快照已清除，下一轮对话会重建'); buzz([8,30,8]);
      },function(e){ toast('没重建成功：'+String(e&&e.message||'').replace(/^HTTP /,'').slice(0,40)); buzz([20,30,20]); });
    };
    if(skip){ go(); return; }
    var c=SNAP[id], rs=c&&c.stale?snapReasonText(c.reasons):[];
    sheet('<div class="hd">重建这个会话的快照？</div><div class="opt"><p class="snap-p">下一轮对话会更新人设、永久上下文、核心身份、长期理解和状态机；日记、标星、笔记本保持建会话时的内容。</p>'+(rs.length?'<ul class="snap-ul">'+rs.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul>':'')+'</div><div class="tk-dl"><button class="nw tap ghost">再想想</button><button class="nw tap">重建</button></div>',function(box,close){
      box.addEventListener('click',function(e){ var b=e.target.closest('.nw'); if(!b) return; close(); if(!b.classList.contains('ghost')) go(); });
    },'opts');
  }
  /* [位置:phone-chats.js·rename] [会话改名] [长按菜单改名/清名，存云端改名映射，刷新换设备不丢] [注释时间 2026-10-27 改：PUT 改增量格式 {set:{id:名}}/{unset:[id]}——旧裸键值 {id:名} 服务端 9-26（1d08055）起不认、却照样回成功，名字静默没存上，下次拉列表被云端冲回] */
  function rename(id){
    var x=byId(id)||{id:id}; sheet('<div class="hd">改名</div><div class="opt"><div class="ro"><label>名称</label><input class="rn" value="'+esc(S.names[id]||'')+'" placeholder="'+esc(nameOf(x))+'"><button class="sv tap">保存</button></div></div>',function(box,close){
      var inp=box.querySelector('.rn'); setTimeout(function(){ try{ inp.focus(); }catch(_){} },300);
      /* [位置:phone-chats.js·rename 回车] [改名弹窗按回车就保存] [11-13：原来输完按回车没反应，得抬手点保存] [注释时间 2026-11-13] */
      inp.addEventListener('keydown',function(e){ if(e.key!=='Enter') return; e.preventDefault(); box.querySelector('.sv').click(); });
      box.querySelector('.sv').addEventListener('click',function(){
        var v=inp.value.trim(), st={}; st[id]=v; var body=v?{set:st}:{unset:[id]}; var done=function(){ if(v) S.names[id]=v; else delete S.names[id]; render(); close(); toast('名字改好了'); };
        if(live) put('/heartbeat/admin/session-names',body).then(done,function(){ toast('没改成'); }); else toast('没连上后台，没改');
      });
    },'dwg',{drag:1});
  }

  /* ---------- 通用底板（复用现有 ses-pop 样式） ---------- */
  function sheet(inner,setupFn,cls,opts){
    var pop=document.createElement('div'); pop.className='ses-pop'+(cls?' '+cls:''); pop.innerHTML='<div class="scrim"></div><div class="box">'+inner+'</div>';
    getPopHost().appendChild(pop); buzz(6); requestAnimationFrame(function(){ requestAnimationFrame(function(){ pop.classList.add('show'); }); });
    function close(){ pop.classList.remove('show'); setTimeout(function(){ pop.remove(); },300); }
    pop.querySelector('.scrim').addEventListener('click',close);
    /* [位置:phone-chats.js·sheet 三档] [内容型抽屉上拉拉高] [10-28：新建/搜索/改名这类内容多的抽屉支持 自然高度→78%→全屏 三档，手势与档位记忆共用 phone-sheetdrag 底层；确认框类不传 opts 保持原高度；2026-11-01 三个抽屉加 dwg 类接玻璃底（#58）] [注释时间 2026-10-28；2026-11-01 dwg] */
    if(opts&&(opts.stretch||opts.drag)&&P.sheetDrag) P.sheetDrag(pop.querySelector('.box'),close,opts.stretch?{stretch:opts.stretch}:undefined); /* [位置:phone-chats.js·sheet] [新建/搜索/改名去掉三档拉高] [11-02：这三个抽屉不要拉满档，传 drag:1 只留下拉关闭；仍支持 stretch] [注释时间 2026-11-02] */
    if(setupFn) setupFn(pop.querySelector('.box'),close);
    return pop;
  }

  /* ---------- 搜索 ----------
     [位置:phone-chats.js·find] [跨会话搜索] [一个框搜所有会话（后端扫全部时间线文件，含主会话），点一条直接落在那条消息上] [注释时间 2026-10-21，2026-11-09 加 scope 范围参数：会话组菜单「搜索」传 scope={sids:[…],name:组名} 只搜组内会话——placeholder/空态文案按范围切换、请求带 sids=；不传 scope 行为一字不变]
     后端 GET /v1/search 返回 {sid,sidx,text,score}；sidx 与 /v1/history 可见序列同口径，交给聊天页定位。没登录不再给示例命中。 */
  /* 导出成纯文本：拉这个会话的全部消息，按「时间 · 说话人 / 正文 / ---」拼好下到手机 */
  function exportSession(x){
    var nm=nameOf(x), id=x.id; toast('正在导出…');
    P.net.get('/v1/history?session_id='+encodeURIComponent(id),{noLogin:true}).then(function(r){
      var items=(r&&r.items)||[], lines=[];
      /* [位置:phone-chats.js·exportSession·stripMeta] [导出正文剥系统标签] [11-07：导出的纯文本原来带着她消息末尾的 <current_time> 时间缀、新会话首条的 <session> 建标题指令、隔时说话的 [elapsed:…] 标记，全是发给模型看的系统元数据不是聊天内容；
         只剥 user 消息（时间缀只有 user 消息有；AI 消息里的标签字样是它引用记录原文带出来的，不动）；剥完变空的整条跳过；剥离残留的 3 个以上连续换行压成一个空行（图片消息时间缀剥掉后空行会堆起来）] [注释时间 2026-11-07] */
      function stripMeta(t){
        return String(t==null?'':t)
          .replace(/\n?<current_time>[\s\S]*?<\/current_time>/gi,'')
          .replace(/\n?<session>[\s\S]*?<\/session>/gi,'')
          .replace(/\n?\[elapsed:[^\]]*\]/gi,'')
          .replace(/\n{3,}/g,'\n\n')
          .trim();
      }
      var uNm=(P.names&&P.names.me)?P.names.me():'用户', aNm=(P.names&&P.names.ai)?P.names.ai():'助手';
      items.forEach(function(m){
        var t=Array.isArray(m.content)?m.content.filter(function(c){ return c&&c.type==='text'; }).map(function(c){ return c.text||''; }).join(''):String(m.content==null?'':m.content);
        t=m.role==='user'?stripMeta(t):t.trim(); if(!t) return;
        var role=m.role==='user'?uNm:(m.role==='assistant'?aNm:(m.role||''));
        /* [位置:phone-chats.js·exportSession 行首时间] [导出行时间改成北京时间] [11-07：/v1/history 的 time 是 UTC ISO（带 Z），原来直接切字符串当墙上时间印，比本地少 8 小时——跨夜连日期都错（例 2026-11-06T20:12Z 印成「2026-11-06 20:12」，实际是「2026-11-07 04:12」）；
           改用 P.net.parse 转本机时间再拼，格式保持「YYYY-MM-DD HH:mm · 名字」不变（导入端 parseText 的 headerRe 两种格式都认，回环不断）；解析不出来才退回原串，不丢时间] [注释时间 2026-11-07] */
        var stamp='';
        if(m.time){ var dt=P.net.parse(m.time);
          if(dt) stamp=dt.getFullYear()+'-'+P.net.two(dt.getMonth()+1)+'-'+P.net.two(dt.getDate())+' '+P.net.two(dt.getHours())+':'+P.net.two(dt.getMinutes());
          else stamp=String(m.time).replace('T',' ').slice(0,16); }
        lines.push((stamp?stamp+' · ':'')+role+'\n'+t);
      });
      if(!lines.length){ toast('这个会话还没有能导出的消息'); return; }
      var blob=new Blob([lines.join('\n\n---\n\n')],{type:'text/plain;charset=utf-8'});
      var url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download=String(nm||id).replace(/[\\/:*?"<>|]/g,'_')+'.txt';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },2000);
      toast('导出好了 · '+lines.length+' 条');
    },function(){ toast('读不到这个会话'); });
  }
  /* [位置:phone-chats.js·snip] [搜索结果摘要的兜底] [后端给整条正文，长消息会把列表撑得很长；截开头一段] [11-09：现在请求带 snip=1，后端直接回「命中处前后各 30 字」的片段（多词最优窗口，r.snippet）；这里只在后端还没更新（页面缓存先于网关重启）、回的是整条 text 时兜底] [注释时间 2026-10-21] */
  function snip(t){ t=String(t||'').replace(/\s+/g,' ').trim(); return t.length>90?t.slice(0,90)+'…':t; }
  function find(preset,scope){
    scope=scope||{}; var inG=!!(scope.sids&&scope.sids.length);
    sheet('<div class="hd fd"><input class="fq" type="search" placeholder="'+esc(inG?'搜「'+scope.name+'」里说过的话':'搜你们说过的话')+'" enterkeyhint="search"></div><div class="ls"></div>',function(box,close){
      var inp=box.querySelector('.fq'), out=box.querySelector('.ls'), q='', res=[], tm=0, seq=0;
      /* [位置:phone-chats.js·find·mark] [多词高亮] [11-09 检索质量批：q 按空白/标点拆成词，任何一个词命中都高亮（原来把整句当一个词，「蓝鲸 饲养」分开写就一个都不亮）；长词在前，免得短词先吃掉长词的一半] [注释时间 2026-11-09] */
      function qTerms(){ var o=[]; q.toLowerCase().split(/[\s,，。；;：！!？?、"“”‘’（）()\[\]【】《》<>…]+/).forEach(function(x){ if(x&&o.indexOf(x)<0) o.push(x); }); return o.slice(0,8).sort(function(a,b){ return b.length-a.length; }); }
      function mark(t){ var s=esc(t), ks=qTerms().map(esc).filter(Boolean); if(!ks.length) return s; return s.replace(new RegExp(ks.map(function(k){ return k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }).join('|'),'gi'),function(m){ return '<mark>'+m+'</mark>'; }); }
      function paint(){
        if(!q){ out.innerHTML='<div class="lv-empty" style="padding:30px 0">'+(inG?'输入一个词，在这个组里找':'输入一个词，所有会话一起找')+'</div>'; return; }
        out.innerHTML=res.length?res.map(function(r,i){ return '<button class="it fr tap" data-i="'+i+'"><div><b>'+mark(r.snippet!=null?r.snippet:snip(r.text))+'</b><small>'+esc(nameOf(byId(r.sid)||{id:r.sid}))+(r.sidx!=null?' · 第 '+(r.sidx+1)+' 条':'')+'</small></div></button>'; }).join(''):'<div class="lv-empty" style="padding:30px 0">'+(inG?'这个组里没找到':'没找到')+'「'+esc(q)+'」</div>';
      }
      function go(){
        q=inp.value.trim(); res=[]; if(!q) return paint(); var my=++seq;
        if(!live){ out.innerHTML='<div class="lv-empty" style="padding:30px 0">还没连上后台，正在重连，连上再搜</div>'; load(); return; }   /* 10-29「搜不出」嫌疑之一：列表某次加载失败后 live 一直是 false，搜索被这句挡住；改成说实话并触发一次重连 */
        out.innerHTML='<div class="lv-empty" style="padding:30px 0">翻一翻…</div>';
        var u='/v1/search?q='+encodeURIComponent(q)+'&limit=60&snip=1'+(inG?'&sids='+encodeURIComponent(scope.sids.join(',')):'');
        P.net.get(u).then(function(r){ if(my!==seq) return; res=(r&&r.results)||[]; paint(); },function(){ if(my===seq) out.innerHTML='<div class="lv-empty" style="padding:30px 0">没搜成，稍后再试</div>'; });
      }
      inp.addEventListener('input',function(){ clearTimeout(tm); tm=setTimeout(go,450); });
      /* [位置:phone-chats.js·find 回车] [搜索框按回车立即搜] [11-13：软键盘键已经标成「搜索」，按下去原来什么都不做（内容没变化不触发 input）；回车立即搜并收键盘，防抖不重复发] [注释时间 2026-11-13] */
      inp.addEventListener('keydown',function(e){ if(e.key!=='Enter') return; e.preventDefault(); clearTimeout(tm); go(); try{ inp.blur(); }catch(_){} });
      out.addEventListener('click',function(e){ var b=e.target.closest('.fr'); if(!b) return; var r=res[+b.dataset.i]; close(); openChat(r.sid,r.sidx!=null?{sidx:r.sidx,q:q}:null); });
      if(preset){ inp.value=preset; go(); } else { paint(); setTimeout(function(){ try{ inp.focus(); }catch(_){} },320); }
    },'srch dwg',{drag:1});
  }
  /* [位置:phone-chats.js·findInGroup] [会话组内搜索] [11-09：组「···」菜单加「搜索」，点开只搜这个组里的会话；范围=所见即所搜——普通组只搜列表里显示的成员（gMembers，已归档隐藏的组员不在内），内置「子会话」组搜全部子会话（含已归档置灰的）；空组不弹窗只提示] [注释时间 2026-11-09] */
  function findInGroup(){
    var g=GROUP&&gById(GROUP); if(!g){ toast('先打开一个会话组'); return; }
    var ids=gMembers(g).map(function(x){ return x.id; });
    if(!ids.length){ toast('这个组还没有会话'); return; }
    find(null,{sids:ids,name:g.name||'会话组'});
  }

  /* ---------- 新建会话：跟随默认 / 预设 / 自定义 ---------- */
  /* [位置:phone-chats.js·startWith] [按预设开会话] [点预设卡直达：人设/模型/跨窗口/时间缀/MCP 工具一次设好；容错链——单项没设上不挡进会话，进会话后 toast 汇总，全部没设上就不进并明说原因；工具按预设勾选精确继承：seen 上报建预设时见过的全量清单，没勾的工具不再被当「新工具」自动开回；空数组=明确全关，跟随全局(mcps=null)不调工具接口；防连点，一次只开一个] [注释时间 2026-10-26 晚改：工具 seen 契约对齐会话弹层 + 全失败不进会话 + 防连点] */
  var SP_BUSY=false;
  function startWith(p,close){
    if(SP_BUSY){ toast('正在开会话，等一下'); return; }
    if(!live){ toast('没连上后台，开不了新会话'); return; }
    SP_BUSY=true;
    var sid='s_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
    /* [位置:phone-chats.js·startWith 一次请求] [服务器端一次性用预设建会话] [10-27：POST /v1/sessions/from-preset，服务器读预设、按顺序配好 跨窗口/人设/模型/时间缀/工具/头像/主题，返回 applied/failed；手机不再自己拼 5 个请求；
       404 = 网关还没更新或预设还没存到云端 → 退回下面原来的逐项路径（legacyStart）；其它错误明说原因] [注释时间 2026-10-27] */
    if(!p.id){ legacyStart(p,close,sid); return; }
    P.net.post('/v1/sessions/from-preset',{preset_id:p.id,session_id:sid}).then(function(r){
      SP_BUSY=false; close&&close();
      if(P.sessPref) P.sessPref.setRemoteOne(sid,{av:r&&r.avatar,style:r&&r.chat_style});
      /* [位置:phone-chats.js·startWith 图标头像本机兜底] [预设头像是图标时会话头像记在本机] [11-24：服务器 saveLook 只收图片地址，emoji: 格式会被静默丢掉（lib/session-cfg.js，放开它要改后端并重启网关）；服务器没给会话记上头像、而预设带的是图标头像时，写进本机映射 ph_sess_av，这台手机上会话头像照常显示。后端放开后 r.avatar 有值，这行自动不再生效] [注释时间 2026-11-24] */
      if(P.sessPref&&p.av&&!(r&&r.avatar)) P.sessPref.setAv(sid,p.av);
      S.sessions.unshift({id:sid,total:0,real:0,last_time:new Date().toISOString(),created_iso:new Date().toISOString()}); S.names[sid]=S.names[sid]||'新会话'; render(); pushTalk(sid); joinCur(sid);
      var bad=((r&&r.failed)||[]).map(function(f){ return f.item; }); if(bad.length) setTimeout(function(){ toast('开了 · 这几项没设上：'+bad.join('、')); },700);
    },function(e){
      if(e&&e.status===404){ legacyStart(p,close,sid); return; }
      SP_BUSY=false; var m=String(e&&e.message||''), j=null; try{ j=JSON.parse(m.replace(/^HTTP \d+\s*/,'')); }catch(_){}
      toast('没开成：'+String((j&&j.error)||m.replace(/^HTTP \d+\s*/,'')||'后台连不上').slice(0,40)); buzz([20,30,20]);
    });
  }
  /* 旧路径（逐项请求）：网关没更新时的兜底，网关都更新后可以删 */
  function legacyStart(p,close,sid){
    var miss=[], missErr=null;
    function step(pr,name){ return pr.catch(function(e){ miss.push(name); if(!missErr) missErr=e; return null; }); }
    var xw=p.xw||{on:true};
    var jobs=[step(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/cross-inject',{enabled:xw.on!==false,inject_blocks:Array.isArray(xw.blocks)?xw.blocks:null}),'跨窗口')];
    if(p.ps){ var st={}; st[sid]=p.ps; jobs.push(step(P.net.req('/heartbeat/admin/session-prompts',{method:'PUT',body:{set:st,unset:[]}}),'人设')); }
    if(p.md){ var mm=p.md.split('|'); jobs.push(step(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',{model_provider_id:mm[0],model_name:mm.slice(1).join('|')}),'模型')); }
    /* [位置:phone-chats.js·legacyStart 状态机两步] [网关没更新时逐项建会话也带上状态机模型/提示词] [11-06：跟 from-preset 那两步同接口——模型写 session_cfg（__role__ 原样存=跟随全局状态机），提示词 select；提示词套已被删只吞 404（读侧本来回落默认），其它错照常记「没设上」] [注释时间 2026-11-06] */
    if(p.cmp_model){ var cm1=String(p.cmp_model), cp1='', cmm1=cm1;
      if(cm1!=='__role__'){ var ax1=cm1.split('|'); cp1=ax1[0]; cmm1=ax1.slice(1).join('|'); }
      jobs.push(step(P.net.post('/heartbeat/admin/context-compaction/config?session_id='+encodeURIComponent(sid),{compaction_model_provider:cp1,compaction_model:cmm1},{noLogin:true}),'状态机模型')); }
    if(p.cmp_prompt) jobs.push(P.net.post('/heartbeat/admin/context-compaction/prompts?session_id='+encodeURIComponent(sid),{action:'select',id:p.cmp_prompt},{noLogin:true})
      .catch(function(e){ if(e&&e.status===404) return null; miss.push('状态机提示词'); if(!missErr) missErr=e; return null; }));
    if(p.tt===true||p.tt===false) jobs.push(step(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/time-tag-to-ai',{time_tag_to_ai:p.tt}),'时间缀'));
    /* 距上一轮（[elapsed] 标签）：预设带三态就落会话级 elapsed-tag（2026-11-16 批3 H1，与 from-preset 服务端同款） */
    if(p.et===true||p.et===false) jobs.push(step(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/elapsed-tag',{elapsed_tag_to_ai:p.et}),'距上一轮'));
    /* 工具：on=预设勾选（空数组=全关也照存）；seen=建预设时见过的全量清单（旧预设没存就退化用 on，下次编辑预设保存后自动补上）；exact=精确模式——AI 实际工具=弹层显示=预设勾选，全局之后新增的工具不再自动开进本会话 */
    /* [位置:phone-chats.js·startWith 工具规则] [预设存规则，开会话时把规则复制进新会话] [10-27：规则 = 每个服务器 默认开/关 + 例外，工具集合以后新增工具会自动跟着走，不再是冻住的清单；还没迁移的旧预设（只有 mcps 清单）走下面原来的路径] [注释时间 2026-10-27] */
    if(p.mcp_rules&&p.mcp_rules.servers){
      jobs.push(step(P.net.req('/heartbeat/admin/session-mcp',{method:'PUT',body:{session_id:sid,rules:p.mcp_rules}}),'工具'));
    } else if(Array.isArray(p.mcps)){
      var seen=(Array.isArray(p.mcp_seen)&&p.mcp_seen.length)?p.mcp_seen:p.mcps;
      jobs.push(step(P.net.req('/heartbeat/admin/session-mcp',{method:'PUT',body:{session_id:sid,exact:true,on:p.mcps.slice(0,1000),seen:seen.slice(0,1000)}}),'工具'));
    }
    if(P.sessPref){ if(p.style) P.sessPref.setStyle(sid,p.style); if(p.av) P.sessPref.setAv(sid,p.av); }
    jobs.push(step(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/pinned-scope',{pinned_scope:'preset:'+p.id,pinned_enabled:p.perm_on===true}),'永久上下文'));
    if(p.nb&&p.nb!=='default') jobs.push(step(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/notebook',{notebook_id:p.nb}),'笔记本'));
    Promise.all(jobs).then(function(){
      if(miss.length&&miss.length===jobs.length){ SP_BUSY=false; toast('没开成：'+String(missErr&&missErr.message||'后台连不上').replace(/^HTTP \d+\s*/,'').slice(0,40)); buzz([20,30,20]); return; }
      SP_BUSY=false;
      close&&close(); S.sessions.unshift({id:sid,total:0,real:0,last_time:new Date().toISOString(),created_iso:new Date().toISOString()}); S.names[sid]=S.names[sid]||'新会话'; render(); pushTalk(sid); joinCur(sid);
      if(miss.length) setTimeout(function(){ toast('开了 · 这几项没设上：'+miss.join('、')); },700);
    },function(){ SP_BUSY=false; toast('没开成，稍后再试'); buzz([20,30,20]); });
  }
  /* [位置:phone-chats.js·newSess] [新会话弹窗] [10-26 晚三改：预设卡在上面点了直接开；「自定义」按钮点了才展开表单（表单常驻太长，「自定义」入口要回来）；「跟随默认」按钮不要了——自定义不展开直接「开始聊」就是跟随默认（cross-inject 传 enabled:null，同原跟随默认链路）；预设卡读 chat-settings.cfg.sess_presets] [注释时间 2026-10-26] */
  function newSess(){
    var D=P.xdef||(P.xdef={diary:15,recent:20,star:0});
    function xqRow(id,lbl,sub,v,min,max,step){
      return '<div class="cs-xq-r" data-xq="'+id+'" hidden><span>'+lbl+(sub?'<small>'+sub+'</small>':'')+'</span>'+
        '<span class="cs-xq-st" data-min="'+min+'" data-max="'+max+'" data-step="'+(step||1)+'">'+
        '<button type="button" class="tap" data-xd="-1" aria-label="减">−</button>'+
        '<input type="number" inputmode="numeric" id="'+id+'" value="'+v+'" min="'+min+'" max="'+max+'">'+
        '<button type="button" class="tap" data-xd="1" aria-label="加">+</button></span></div>';
    }
    sheet('<div class="hd">新会话</div><div class="opt">'+
      '<div class="cs-sps" hidden></div>'+
      '<button type="button" class="cs-pick tap" data-m="cus"><b>自定义</b></button>'+
      '<div class="cs-cus" hidden>'+
        '<div class="ro"><label>人设</label><select id="csPs"><option value="">跟随默认</option></select></div>'+
        '<div class="ro"><label>模型</label><select id="csMd" class="mdw"><option value="">跟随默认</option></select></div>'+
        P.xinject.html()+
        '<div class="cs-xq-wrap" id="csXqWrap" hidden>'+
          xqRow('csXqDiary','日记篇数','',D.diary,1,30,1)+
          xqRow('csXqStar','标星条数','0 = 全部',D.star,0,500,5)+
          xqRow('csXqRecent','最近对话轮数','',D.recent,1,100,1)+
          '<div class="ro cs-inh-row" id="csInhRow" hidden><label>承接会话</label><select id="csInh"><option value="">自动承接上一个</option></select><button type="button" class="cs-inhb tap" id="csInhGo">剪贴板</button></div>'+
        '</div>'+
      '</div></div><button class="nw tap">开始聊</button>',function(box,close){
      var cus=box.querySelector('.cs-cus');
      /* [位置:phone-chats.js·newSess·syncXSub] [按需显示跨窗口数量与承接会话] [11-23：跨窗口默认数量删掉，挪进新建自定义会话，选中对应项才出现；承接会话挪到下方、选中「继承状态」或「最近对话」才出现] [注释时间 2026-11-23] */
      function syncXSub(){
        var xo=P.xinject.read(box)||{on:false,blocks:[]}, on=!!xo.on, bs=xo.blocks||[];
        var has=function(k){ return on&&bs.indexOf(k)>=0; };
        var dOn=has('conversation_continuity'), sOn=has('starred_dialog'), rOn=has('recent_dialog'), iOn=has('state_inherit')||rOn;
        var wrap=box.querySelector('#csXqWrap');
        var setH=function(sel,show){ var el=box.querySelector(sel); if(el) el.hidden=!show; };
        setH('[data-xq="csXqDiary"]',dOn);
        setH('[data-xq="csXqStar"]',sOn);
        setH('[data-xq="csXqRecent"]',rOn);
        setH('#csInhRow',iOn);
        if(wrap) wrap.hidden=!(dOn||sOn||rOn||iOn);
      }
      syncXSub();
      if(P.net) P.net.get('/heartbeat/admin/cross-inject/config',{noLogin:true}).then(function(d){
        if(d&&d.cross_inject_diary_count!=null){ D.diary=+d.cross_inject_diary_count; var di=box.querySelector('#csXqDiary'); if(di) di.value=D.diary; }
      },function(){});
      /* [位置:phone-chats.js·newSess 承接会话] [读剪贴板填会话 id] [10-29：长按会话「复制会话 id」→ 这里一键读剪贴板；自动从粘贴内容里认出 s_ 开头的 id 并显示会话名；建会话时随 cross-inject 带 inherit_from，后端就承接那个会话] [注释时间 2026-10-29] */
      var inhIn=box.querySelector('#csInh');
      /* [位置:phone-chats.js·newSess 承接会话下拉] [直接选会话，不用跨页复制 id] [11-13：原来要回列表长按复制 id、再回来读剪贴板，五步还容易记错；改成下拉选（最近 80 个非子会话），剪贴板按钮留作兼容，读到的 id 不在列表里就临时补一项并选中] [注释时间 2026-11-13] */
      (function(){ var list=(S.sessions||[]).filter(function(x){ return x&&x.id&&String(x.id).indexOf('s_sub_')!==0; }).slice(0,80); if(!list.length) return;
        inhIn.innerHTML='<option value="">自动承接上一个</option>'+list.map(function(x){ return '<option value="'+esc(x.id)+'">'+esc(nameOf(x))+'</option>'; }).join(''); })();
      box.querySelector('#csInhGo').addEventListener('click',function(){
        buzz(6);
        var fill=function(t){ var m=String(t||'').match(/s_[A-Za-z0-9_-]+/); if(!m){ toast('剪贴板里没认出会话 id：先在会话长按菜单点「复制会话 id」'); return; } var id=m[0], has=false;
          Array.prototype.forEach.call(inhIn.options,function(o){ if(o.value===id) has=true; });
          if(!has){ var o2=document.createElement('option'); o2.value=id; o2.textContent='剪贴板里的 '+id; inhIn.appendChild(o2); }
          inhIn.value=id; var nm=S.names[id]; toast(nm?('承接自：'+nm):'已选中 '+id); buzz([8,30,8]); };
        if(navigator.clipboard&&navigator.clipboard.readText) navigator.clipboard.readText().then(fill,function(){ toast('读剪贴板没成（没给权限），手动粘进去也行'); try{ inhIn.focus(); }catch(_){} });
        else { toast('这个浏览器不能自动读剪贴板，手动粘进去'); try{ inhIn.focus(); }catch(_){} }
      });
      if(P.sessOpts){ var so0=P.sessOpts.now&&P.sessOpts.now();
        if(so0){ P.sessFill(box.querySelector('#csPs'),so0.pers,''); P.sessFill(box.querySelector('#csMd'),so0.models,''); }
        P.sessOpts(live).then(function(o){ P.sessFill(box.querySelector('#csPs'),o.pers,''); P.sessFill(box.querySelector('#csMd'),o.models,''); }); }
      /* [位置:phone-chats.js·newSess·spsRender] [预设卡分组收拢] [11-14：rp 预设组——带 grp 字段的预设不平铺，收成一张组卡（组名+条数，字母头像取组名首字），点开就地展开「返回卡+该组角色卡」，点角色卡照旧直接开会话；不带 grp 的预设照旧平铺在前；点组卡/返回卡不发起会话；组内顺序=预设列表顺序] [注释时间 2026-11-14] */
      var curGrp=null;
      function spsRender(L){
        var sps=box.querySelector('.cs-sps'); if(!sps||!box.isConnected) return;
        if(!L.length){ sps.hidden=true; return; } sps.hidden=false;
        function card(p){ var nm=p.name||'预设', sum=P.sessPref.sum?P.sessPref.sum(p):'';
          return '<button type="button" class="cs-pick sp tap" data-spid="'+esc(p.id)+'">'+P.sessPref.avHtml(p.av,p.id||nm)+'<span class="bd"><b>'+esc(nm)+'</b><small>'+esc(sum)+'</small></span></button>'; }
        var html='';
        if(curGrp){
          html+='<button type="button" class="cs-pick sp tap" data-spbk="1"><span class="av ai" data-l="返"></span><span class="bd"><b>返回</b><small>回到全部预设</small></span></button>';
          L.forEach(function(p){ if(p&&p.grp===curGrp) html+=card(p); });
        } else {
          var gs={}, go=[];
          L.forEach(function(p){ var g=p&&p.grp; if(!g) return; if(!gs[g]){ gs[g]=0; go.push(g); } gs[g]++; });
          L.forEach(function(p){
            if(!p||p.grp) return;
            if(p.id==='sp_sub_agent') return;   /* [隐藏子会话预设] [10-28：sp_sub_agent 固定给派子智能体用（lib/subagent-preset-runner.js），不该出现在新会话弹窗；预设管理页仍可见] [注释时间 2026-10-28] */
            html+=card(p); });
          go.forEach(function(g){ html+='<button type="button" class="cs-pick sp tap" data-spgrp="'+esc(g)+'">'+P.sessPref.avHtml('', 'grp:'+g)+'<span class="bd"><b>'+esc(g)+'</b><small>'+gs[g]+' 个角色</small></span></button>'; });
        }
        sps.innerHTML=html;
      }
      if(P.sessPref) P.sessPref.load().then(function(L){ spsRender(L); });
      box.addEventListener('click',function(e){
        var xd=e.target.closest('.cs-xq-st button[data-xd]');
        if(xd){ var st=xd.closest('.cs-xq-st'), inp=st&&st.querySelector('input'); if(inp){ var mn=+st.dataset.min, mx=+st.dataset.max, sp=+st.dataset.step||1, v=(parseInt(inp.value,10)||0)+(+xd.dataset.xd)*sp; inp.value=Math.max(mn,Math.min(mx,v)); buzz(5); } return; }
        var sg=e.target.closest('[data-spgrp]');
        if(sg){ curGrp=sg.getAttribute('data-spgrp'); buzz(6); spsRender(P.sessPref&&P.sessPref.cache||[]); return; }
        if(e.target.closest('[data-spbk]')){ curGrp=null; buzz(6); spsRender(P.sessPref&&P.sessPref.cache||[]); return; }
        var spi=e.target.closest('[data-spid]');
        if(spi){ e.stopPropagation(); var pid=spi.getAttribute('data-spid'), p=(P.sessPref&&P.sessPref.cache||[]).filter(function(x){ return x&&x.id===pid; })[0]; if(p){ buzz(8); startWith(p,close); } return; }
        var cb=e.target.closest('[data-m="cus"]');
        if(cb){ cus.hidden=false; cb.classList.add('on'); syncXSub(); buzz(6); return; }
        if(P.xinject.click(e,box)){ syncXSub(); return; }
        if(e.target.closest('.nw')){ var nb=e.target.closest('.nw'); if(!live){ close(); toast('没连上后台，开不了新会话'); return; }
          /* 建会话：先定跨窗口（新会话第一次存会顺带「承接上一个会话」），再按需写人设 / 模型，最后进聊天页 */
          var sid='s_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8), isCus=!cus.hidden, xo=P.xinject.read(box)||{on:true,blocks:[]}, ps=box.querySelector('#csPs').value, md=box.querySelector('#csMd').value;
          var bs=xo.blocks||[], wantInh=isCus&&xo.on&&(bs.indexOf('state_inherit')>=0||bs.indexOf('recent_dialog')>=0);
          var inhId=wantInh?(box.querySelector('#csInh').value||'').trim():'';
          if(inhId&&!/^s_[A-Za-z0-9_-]+$/.test(inhId)){ toast('这个会话 id 不对，重新选一个'); return; }
          nb.classList.add('busy'); nb.textContent='开会话中…';
          var _xb=isCus?{enabled:xo.on,inject_blocks:bs}:{enabled:null};
          if(isCus&&xo.on){
            if(bs.indexOf('conversation_continuity')>=0){ var dv=Math.max(1,Math.min(30,parseInt((box.querySelector('#csXqDiary')||{}).value,10)||D.diary)); D.diary=dv; _xb.diary_count_override=dv; }
            if(bs.indexOf('starred_dialog')>=0){ var sv=Math.max(0,Math.min(500,parseInt((box.querySelector('#csXqStar')||{}).value,10)||0)); D.star=sv; if(sv>0) _xb.starred_dialog_limit=sv; }
            if(bs.indexOf('recent_dialog')>=0){ var rv=Math.max(1,Math.min(100,parseInt((box.querySelector('#csXqRecent')||{}).value,10)||D.recent)); D.recent=rv; _xb.recent_dialog_rounds=rv; }
          }
          if(inhId) _xb.inherit_from=inhId;   /* 指定承接（10-29） */
          var jobs=[P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/cross-inject',_xb)];
          if(isCus&&ps){ var st={}; st[sid]=ps; jobs.push(P.net.req('/heartbeat/admin/session-prompts',{method:'PUT',body:{set:st,unset:[]}})); }
          if(isCus&&md){ var mm=md.split('|'); jobs.push(P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',{model_provider_id:mm[0],model_name:mm.slice(1).join('|')})); }
          Promise.all(jobs).then(function(){ close(); S.sessions.unshift({id:sid,total:0,real:0,last_time:new Date().toISOString(),created_iso:new Date().toISOString()}); S.names[sid]=S.names[sid]||'新会话'; render(); pushTalk(sid); joinCur(sid); },function(err){ nb.classList.remove('busy'); nb.textContent='开始聊'; toast('没开成：'+String(err&&err.message||'').slice(0,40)); buzz([20,30,20]); });
        }
      });
    },'opts dwg',{drag:1});
  }

    /* ---------- 右滑：已归档抽屉 ---------- */
  /* ---------- 会话组 ----------
     [位置:phone-chats.js·会话组] [把一堆会话收进一个组，列表里像一行会话，点进去是组内会话] [10-27：「···」新建会话组 → 改名字/选头像；多选勾选 → 归入组；组存 chat-settings.cfg.session_groups（跨设备，不动服务器）；一个会话只在一个组；组内会话归档后从组里隐藏，取回仍在组里；解散只放回主列表不删会话] [注释时间 2026-10-27] */
  function saveGroups(list,ok){
    if(!live){ toast('没连上后台，没改'); return; }
    P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:{session_groups:list}}}).then(function(){
      S.groups=list; P.net.keep('chats',{sessions:S.sessions,names:S.names,arch:S.arch,pins:S.pins,locked:S.locked,groups:S.groups,status:S.status,subst:S.subst});
      render(); barSync(); if(ok) ok();
    },function(){ toast('没改成，稍后再试'); buzz([20,30,20]); });
  }
  function putInto(gid,ids,ok){
    saveGroups(S.groups.map(function(x){ var rest=(x.sids||[]).filter(function(s2){ return ids.indexOf(s2)<0; }); return Object.assign({},x,{sids:x.id===gid?rest.concat(ids):rest}); }),ok);
  }
  function slide(d){ sc.style.setProperty('--d',d); sc.classList.remove('in'); void sc.offsetWidth; sc.classList.add('in'); }
  function barSync(){
    var g=GROUP&&gById(GROUP), inG=!!g&&curTab==='list', gb=$('#csGb',win);
    gb.hidden=!inG; $('#csFind',win).style.display=inG?'none':'';
    $('.cs-bar .ttl',win).firstChild.nodeValue=curTab==='list'?(inG?(g.name||'会话组'):TT.list):TT[curTab];
  }
  function openGroup(gid){ if(!gById(gid)) return; GROUP=gid; render(true); barSync(); sc.scrollTop=0; slide(1); }
  function closeGroup(){ if(MULTI){ MULTI=null; host.classList.remove('cs-multi'); } GROUP=null; render(true); barSync(); slide(-1); }
  $('#csGb',win).addEventListener('click',function(){ buzz(6); closeGroup(); });
  function newGroup(){
    if(!live){ toast('没连上后台，建不了'); return; }
    /* [位置:phone-chats.js·newGroup] [新建组改草稿] [10-28：以前先 saveGroups 写云端再开编辑，取消也留下「新会话组」；改成内存草稿，grpEdit 点「好了」才创建] [注释时间 2026-10-28] */
    var g={id:'g_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:'新会话组',icon:'computer',sids:[],at:new Date().toISOString()};
    grpEdit(g,true);
  }
  function grpEdit(g,isNew){
    var cur=g.icon||'computer';
    var ics=GICS.map(function(k){ return '<button type="button" class="gp-ic tap'+(k===cur?' on':'')+'" data-ic="'+k+'" aria-label="'+GLAB[k]+'">'+GIC[k]+'</button>'; }).join('');
    sheet('<div class="hd">会话组</div><div class="opt"><div class="ro"><label>名称</label><input class="rn" value="'+esc(isNew?'':g.name)+'" placeholder="组名字"></div><div class="gp-ics">'+ics+'</div><div class="ro"><label>新建用预设</label><select id="gpSp"><option value="">弹窗选</option>'+(g.sp?'<option value="'+esc(g.sp)+'" selected>上次选的预设</option>':'')+'</select></div></div><button class="nw tap">好了</button>',function(box,close){
      var inp=box.querySelector('.rn'); if(isNew) setTimeout(function(){ try{ inp.focus(); }catch(_){} },300);
      /* [位置:phone-chats.js·grpEdit 回车] [建组/改组名按回车就保存] [11-13：原来输完按回车没反应] [注释时间 2026-11-13] */
      inp.addEventListener('keydown',function(e){ if(e.key!=='Enter') return; e.preventDefault(); box.querySelector('.nw').click(); });
      box.addEventListener('click',function(e){ var b=e.target.closest('[data-ic]'); if(!b) return; cur=b.getAttribute('data-ic'); Array.prototype.forEach.call(box.querySelectorAll('[data-ic]'),function(x){ x.classList.toggle('on',x===b); }); buzz(5); });
      /* [位置:phone-chats.js·grpEdit 预设下拉] [新建用预设] [10-31：组可配「新建用预设」（存组对象 sp 字段，跟云端走），组内右上角「新建」直达这个预设开会话不弹选择窗；默认「弹窗选」=老行为；列表排除 sp_sub_agent（同新会话弹窗），配的预设被删了自动回落「弹窗选」；列表没加载上前先显示「上次选的预设」占位，配置不丢] [注释时间 2026-10-31] */
      if(P.sessPref) P.sessPref.load().then(function(L){
        var sel=box.querySelector('#gpSp'); if(!sel||!box.isConnected) return;
        sel.innerHTML='<option value="">弹窗选</option>'+L.filter(function(p){ return p&&p.id&&p.id!=='sp_sub_agent'; }).map(function(p){ return '<option value="'+esc(p.id)+'"'+(p.id===g.sp?' selected':'')+'>'+esc(p.name||p.id)+'</option>'; }).join('');
        if(g.sp&&!L.some(function(p){ return p&&p.id===g.sp; })) sel.value='';
      },function(){});
      box.querySelector('.nw').addEventListener('click',function(){
        var v=inp.value.trim()||g.name||'新会话组', spSel=box.querySelector('#gpSp'), sp=spSel?spSel.value:'';
        /* [位置:phone-chats.js·grpEdit 确认] [新组此刻才落盘] [10-28：新建组确认后才 saveGroups；已有组走原路改名/换头像，行为不变] [注释时间 2026-10-28] */
        if(isNew){ saveGroups(S.groups.concat([Object.assign({},g,{name:v,icon:cur,sp:sp})]),function(){ close(); }); return; }
        saveGroups(S.groups.map(function(x){ return x.id===g.id?Object.assign({},x,{name:v,icon:cur,sp:sp}):x; }),function(){ close(); });
      });
    },'opts');
  }
  function grpDissolve(g){
    sheet('<div class="hd">解散「'+esc(g.name||'会话组')+'」？</div><div class="opt"><p class="snap-p">组里的会话会回到主列表，不会被删除。</p></div><div class="tk-dl"><button class="nw tap ghost">再想想</button><button class="nw tap">解散</button></div>',function(box,close){
      box.addEventListener('click',function(e){ var b=e.target.closest('.nw'); if(!b) return; close(); if(b.classList.contains('ghost')) return;
        saveGroups(S.groups.filter(function(x){ return x.id!==g.id; }),function(){ toast('已解散，会话回到主列表'); }); });
    },'opts');
  }
  function gmenu(it){
    var g=gById(it.getAttribute('data-gid')); if(!g||g.builtin) return; buzz([12,40,18]);   /* 内置组不改名不解散，长按无菜单 */
    /* [位置:phone-chats.js·gmenu] [组行长按菜单坐标] [11-21：浮层挂在 popHost（极简布局=整屏 P.D），坐标原来却按 host（抽屉里的内容区）换算，极简下整体上飘两百多像素；对齐 menu 统一用 popHost] [注释时间 2026-11-21；2026-11-24 实时取 getPopHost] */
    var popHost=getPopHost();
    var r=it.getBoundingClientRect(), hr=popHost.getBoundingClientRect();
    var ov=document.createElement('div'); ov.className='cs-ov';
    var lift=it.cloneNode(true); lift.classList.remove('pressed'); lift.classList.add('lift'); lift.removeAttribute('style');
    lift.style.cssText='top:'+(r.top-hr.top)+'px;left:'+(r.left-hr.left)+'px;width:'+r.width+'px';
    var below=r.bottom-hr.top+8, up=(below+130>hr.height);
    ov.innerHTML='<div class="scrim"></div><div class="cs-menu" style="'+(up?'bottom:'+(hr.bottom-r.top+8)+'px':'top:'+below+'px')+'"><button data-a="edit">改名和头像</button><button data-a="dis" class="red">解散会话组</button></div>';
    ov.appendChild(lift); popHost.appendChild(ov);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ ov.classList.add('show'); }); });
    function close(){ ov.classList.remove('show'); ov.classList.add('closing'); setTimeout(function(){ ov.remove(); },240); }
    ov.querySelector('.scrim').addEventListener('click',close);
    ov.querySelector('.cs-menu').addEventListener('click',function(e){ var b=e.target.closest('[data-a]'); if(!b) return; var a=b.getAttribute('data-a'); close(); if(a==='edit') grpEdit(g); else grpDissolve(g); });
  }
  function multiGrp(){
    var ids=selIds(); if(!ids.length){ toast('先选几个会话'); return; }
    if(inSubGroup()){ toast('子会话组是自动的，不用分组'); return; }
    if(GROUP){ var g0=gById(GROUP); if(!g0) return;
      saveGroups(S.groups.map(function(x){ return x.id===GROUP?Object.assign({},x,{sids:(x.sids||[]).filter(function(s2){ return ids.indexOf(s2)<0; })}):x; }),function(){ toast('已移出 '+ids.length+' 个'); multiOff(); });
      return; }
    pickGroup(ids,multiOff);
  }
  /* [位置:phone-chats.js·pickGroup/grpOne/joinCur] [分组入口：长按会话 → 分组 / 移出组；在组里新建会话自动归进当前组] [10-27：外面的长按菜单加「分组」选到哪个组；组里右上角也能新建，逻辑和外面一样，新会话就落在这个组里] [注释时间 2026-10-27] */
  function pickGroup(ids,after){
    if(!S.groups.length){ toast('还没有会话组，先在「···」里新建一个'); return; }
    sheet('<div class="hd">归入哪个组</div><div class="opt">'+S.groups.map(function(g){ return '<button type="button" class="cs-pick sp tap" data-g="'+esc(g.id)+'"><span class="av gi">'+(GIC[g.icon]||GIC.computer)+'</span><span class="bd"><b>'+esc(g.name||'会话组')+'</b><small>'+(g.sids||[]).length+' 个会话</small></span></button>'; }).join('')+'</div>',function(box,close){
      box.addEventListener('click',function(e){ var b=e.target.closest('[data-g]'); if(!b) return; var gid=b.getAttribute('data-g'), gn=(gById(gid)||{}).name||'会话组'; close(); putInto(gid,ids,function(){ toast('已归入「'+gn+'」'); if(after) after(); }); });
    },'opts');
  }
  function grpOne(id){
    if(GROUP){ saveGroups(S.groups.map(function(x){ return x.id===GROUP?Object.assign({},x,{sids:(x.sids||[]).filter(function(s2){ return s2!==id; })}):x; }),function(){ toast('已移出组'); }); return; }
    pickGroup([id]);
  }
  function joinCur(sid){ if(GROUP&&gById(GROUP)&&!inSubGroup()) putInto(GROUP,[sid]); }
  /* [位置:phone-chats.js·directStart] [组内新建直达预设] [10-31：组配了「新建用预设」（编辑组里选，组对象 sp 字段）后，组内右上角「新建」不再弹选择窗，直接按预设开会话（复用 from-preset 一把建好 + joinCur 自动落本组）；预设被删或没加载上就回落原「新会话」弹窗并提示，不挡建会话] [注释时间 2026-10-31] */
  function directStart(g){
    if(!P.sessPref){ newSess(); return; }
    P.sessPref.load().then(function(L){
      var p=null; for(var i=0;i<L.length;i++){ if(L[i]&&L[i].id===g.sp){ p=L[i]; break; } }
      if(!p){ toast('这个组配的预设没了，选一个吧'); newSess(); return; }
      startWith(p);
    },function(){ newSess(); });
  }

  var dw=null;
  function drawer(){
    if(dw) return; buzz(8);
    dw=document.createElement('div'); dw.className='cs-dw';
    /* [位置:phone-chats.js·drawer] [归档抽屉头部搜索框] [11-01：归档多了不好翻，标题下方加一个本地过滤框，交互和主列表搜索（find 的输入框）一致：边敲边过滤，清空回全量，不需要连后台] [注释时间 2026-11-01] */
    dw.innerHTML='<div class="scrim"></div><aside class="pane"><div class="dh"><h2>已归档</h2><small>收起来的会话，数据都还在</small>'+
      '<input class="fq" type="search" placeholder="搜归档会话" enterkeyhint="search" aria-label="搜索归档会话"></div>'+
      '<div class="sc dl"></div></aside>';
    getPopHost().appendChild(dw); P.markAv&&P.markAv();
    var fq=dw.querySelector('.dh .fq'), dl=dw.querySelector('.sc.dl');
    /* [位置:phone-chats.js·drawer 过滤] [归档会话即时过滤] [11-01：按会话名或最近一句（brief）包含关键字过滤，不区分大小写；没命中写「没有匹配的归档会话」，清空恢复全量；每次都从 archived 现取，取回过的会话不会又冒出来] [注释时间 2026-11-01] */
    function paintDl(){ var q=String(fq.value||'').trim().toLowerCase(), all=archived();
      var hit=q?all.filter(function(x){ return (nameOf(x)+' '+brief(x)).toLowerCase().indexOf(q)>=0; }):all;
      dl.innerHTML=hit.map(function(x){ return rowHTML(x,true); }).join('')||('<div class="lv-empty">'+(q?'没有匹配的归档会话':'没有归档的会话')+'</div>');
      P.markAv&&P.markAv(); }
    fq.addEventListener('input',paintDl);
    paintDl();
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ dw.classList.add('show'); }); });
    dw.querySelector('.scrim').addEventListener('click',closeDw);
    dw.addEventListener('click',function(e){
      var rw=e.target.closest('.cs-it');
      if(rw&&!e.target.closest('[data-back]')){ closeDw(); var cid=rw.getAttribute('data-id')||''; if(cid.indexOf('s_sub_')===0){ if(P.subSheet) P.subSheet(cid); else toast('过程抽屉没加载上'); } else openChat(cid); return; }   /* 2026-10-26 批3：子进程行开过程抽屉不进聊天 */
      var b=e.target.closest('[data-back]'); if(!b) return; e.stopPropagation(); var id=b.getAttribute('data-back');
      var done=function(){ S.arch=S.arch.filter(function(y){ return y!==id; }); render(); var row=b.closest('.cs-it'); row.classList.add('gone'); setTimeout(function(){ row.remove(); },300); toast('取回来了'); };
      if(live) put('/heartbeat/admin/session-archive',{remove:[id]}).then(done,function(){ toast('没取回来'); }); else toast('没连上后台，没取回');
    });
    var sx=0, on=false; var pane=dw.querySelector('.pane');
    pane.addEventListener('pointerdown',function(e){ sx=e.clientX; on=true; });
    pane.addEventListener('pointerup',function(e){ if(on&&sx-e.clientX>60) closeDw(); on=false; });
  }
  function closeDw(){ if(!dw) return; var d=dw; dw=null; d.classList.remove('show'); setTimeout(function(){ d.remove(); },320); }
  hint.addEventListener('click',drawer);
  /* 列表上向右划 → 抽屉 */
  var gx=0, gy=0, g=false;
  sc.addEventListener('pointerdown',function(e){ gx=e.clientX; gy=e.clientY; g=true; });
  sc.addEventListener('pointerup',function(e){ if(!g) return; g=false; if(swallow||openIt||MULTI) return; var dx=e.clientX-gx, dy=e.clientY-gy; if(dx>70&&Math.abs(dy)<Math.abs(dx)*.6){ clearTimeout(lpT); swallow=true; setTimeout(function(){ swallow=false; },60); if(GROUP) closeGroup(); else drawer(); } });

  /* [位置:phone-chats.js·顶部「···」菜单 / 多选 / 导入] [会话列表右上角] [10-24：右上角「+」换成「···」，点开三项（都带图标）：多选 / 导入 / 新建。多选 = 每行前出圆圈，点行选 / 取消，底栏 导出 / 归档 / 取消；导出选一个会话 = 旧聊天页同款 {name,messages} 的 JSON，选多个 = {version,sessions:[…]} 一个文件；归档走原来的 session-archive（可从右滑抽屉取回）。导入参考旧聊天页 importSession：认 JSON（单个会话 / 消息数组 / 多会话文件）和纯文本（`日期 · 名字` 分块、`[时间] 名字: 内容` 两种），每个文件建一个新会话，消息整批一次发 /v1/timeline/sync（后端按 id 去重补齐，不能分批发——后端会按「请求里没有的盘尾回复」清尾），再写会话名；一次选多个文件就建多个；10-31 补：组里配了「新建用预设」后点「新建」直达按预设开会话，不再弹选择窗（grpEdit/directStart）] [注释时间 2026-10-24，10-31 补直达；2026-11-09 组内菜单加「搜索」（data-a=srch→findInGroup 组内搜索），原「检索」开关项改叫「AI检索」防与新搜索项混淆，图标状态语义不变] */
  function topMenu(){
    if(MULTI) return;
    var popHost=getPopHost();
    /* [位置:phone-chats.js·topMenu 防叠层] [打开前移除残留 .cs-ov.cs-top，防止连续点击叠加多层遮罩] [注释时间 2026-11-24] */
    Array.prototype.forEach.call(document.querySelectorAll('.cs-ov.cs-top'),function(old){ old.remove(); });
    var ov=document.createElement('div'); ov.className='cs-ov cs-top';
    var inG=!!(GROUP&&gById(GROUP)), inSub=inSubGroup(), gOff=inG&&!!(gById(GROUP)||{}).noSearch, gQ=inG&&!!(gById(GROUP)||{}).queue;   /* #51：这组当前是否「不参与检索」 */
    ov.innerHTML='<div class="scrim"></div><div class="cs-menu ic">'+(inSub?'<button data-a="multi">'+IC.multi+'<span>多选</span></button><button data-a="srch">'+IC.find+'<span>搜索</span></button><button data-a="nos" class="off">'+IC.nos+'<span>AI检索</span></button>':inG?'<button data-a="multi">'+IC.multi+'<span>多选</span></button><button data-a="srch">'+IC.find+'<span>搜索</span></button><button data-a="new">'+IC.newp+'<span>新建</span></button><button data-a="nos"'+(gOff?' class="off"':'')+'>'+(gOff?IC.nos:IC.find)+'<span>AI检索</span>'+'</button><button data-a="nq"'+(gQ?'':' class="off"')+'>'+IC.multi+'<span>排队</span></button><button data-a="gedit">'+IC.newp+'<span>编辑组</span></button>':'<button data-a="multi">'+IC.multi+'<span>多选</span></button><button data-a="imp">'+IC.imp+'<span>导入</span></button><button data-a="new">'+IC.newp+'<span>新建</span></button><button data-a="ngrp">'+IC.grp+'<span>新建会话组</span></button>')+'</div>';
    popHost.appendChild(ov); buzz(6);
    /* [位置:phone-chats.js·topMenu 锚点] [抽屉「⋯」菜单贴按钮展开] [11-20：min 布局下菜单右上角对齐抽屉顶栏按钮（原来钉在整屏右上角，离按钮远、不像从按钮弹出）；rect 相对 popHost 换算，transform-origin:100% 0 沿用既有 scale 弹性] [注释时间 2026-11-20；2026-11-24 改用 isMinOn+getPopHost] */
    if(isMinOn()){
      var mb=document.getElementById('mnMoreBtn');
      if(mb){ var mr=mb.getBoundingClientRect(), hr=popHost.getBoundingClientRect(), cm=ov.querySelector('.cs-menu');
        cm.style.top=Math.max(8,Math.round(mr.bottom-hr.top+6))+'px';
        cm.style.right=Math.max(8,Math.round(hr.right-mr.right))+'px'; }
    }
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ ov.classList.add('show'); }); });
    function close(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); },260); }
    ov.querySelector('.scrim').addEventListener('click',close);
    ov.querySelector('.cs-menu').addEventListener('click',function(e){ var b=e.target.closest('[data-a]'); if(!b) return; var a=b.getAttribute('data-a'); close();
      if(a==='multi') multiOn(); else if(a==='imp') pickImport(); else if(a==='ngrp') newGroup(); else if(a==='srch') findInGroup(); else if(a==='nos') groupNoSearch(); else if(a==='nq') groupQueue(); else if(a==='gedit'){ var gg=gById(GROUP); if(gg) grpEdit(gg); } else if(a==='new'&&inG){ var g2=gById(GROUP); if(g2&&g2.sp) directStart(g2); else newSess(); } else newSess(); });
  }
  /* [位置:phone-chats.js·groupNoSearch] [会话组「不参与检索」开关] [10-27：组右上角「···」里加一项，开了以后这个组里的会话不参与 AI 的对话检索（context 工具搜全部会话、按时间/最近 N 条取原文、记忆整理取证据都搜不到它们），自己在那个会话里搜当前会话不受影响，手机上的人工搜索也不受影响；存在组对象 noSearch 字段里（chat-settings.cfg.session_groups，跟着云端走），后端 lib/search-exclude.js 读；同次改动去掉了「添加会话」入口（总点错，归组走长按「分组」/ 多选「归入组」）] [注释时间 2026-10-27，10-29 #51：右上角菜单这处也压缩成「检索」两字，图标表达状态——放大镜=参与检索、斜杠放大镜加半透明=不参与，「已开」小字去掉] */
  function groupNoSearch(){ var g=gById(GROUP); if(!g) return; if(g.builtin){ toast('子会话一律不参与检索，关不掉'); return; } var nv=!g.noSearch;   /* 子会话组：开关常开，点了只提示 */
    saveGroups(S.groups.map(function(x){ return x.id===g.id?Object.assign({},x,{noSearch:nv}):x; }),function(){ toast(nv?'这个组的会话，AI 搜不到了':'这个组的会话，AI 又能搜到了'); }); }
  /* [位置:phone-chats.js·groupQueue] [会话组「发送排队」开关] [11-04：开了以后，这个组里的会话在 AI 回复/干活期间也能发消息（排队），AI 做完当前这步工具调用就会看到；存在组对象 queue 字段（chat-settings.cfg.session_groups），后端 routes/send-queue.js 读] [注释时间 2026-11-04] */
  function groupQueue(){ var g=gById(GROUP); if(!g) return; if(g.builtin){ toast('这个组不支持排队'); return; } var nv=!g.queue;
    saveGroups(S.groups.map(function(x){ return x.id===g.id?Object.assign({},x,{queue:nv}):x; }),function(){ toast(nv?'这个组的会话，回复中也能排队发消息了':'这个组的会话，回复中不能再排队了（发送键是停止）'); }); }
  function selIds(){ return MULTI?Object.keys(MULTI.sel):[]; }
  /* [位置:phone-chats.js·multiAll] [多选全选/取消全选] [10-31：底栏加「全选」，已全选时按钮变「取消全选」再点清空；只选当前列表里的会话行（组标题行不算）；文字别挤：mbar 加 nowrap] [注释时间 2026-10-31] */
  function multiAll(){ var rows=Array.prototype.slice.call(ls.querySelectorAll('.cs-it[data-id]')); if(!rows.length){ toast('这个列表没有会话'); return; }
    var full=selIds().length>0&&selIds().length===rows.length; MULTI.sel={};
    if(!full) rows.forEach(function(r){ MULTI.sel[r.getAttribute('data-id')]=1; });
    buzz(6); render(); }
  function mpaint(){ var n=selIds().length; $('#csSub',win).textContent='（已选 '+n+'）'; var ab=$('#csMbar',win).querySelector('[data-m="all"]'); if(ab){ var tot=ls.querySelectorAll('.cs-it[data-id]').length, full=n>0&&n===tot; ab.querySelector('span').textContent=full?'取消全选':'全选'; } Array.prototype.forEach.call($('#csMbar',win).querySelectorAll('[data-m="exp"],[data-m="arch"],[data-m="grp"]'),function(b){ b.classList.toggle('dim',!n); }); }
  function multiOn(){ if(curTab!=='list'){ return; } if(openIt) shut(openIt); MULTI={sel:{}}; host.classList.add('cs-multi'); buzz(8); $('#csMbar',win).querySelector('[data-m="grp"] span').textContent=GROUP?'移出组':'归入组'; render(); }
  function multiOff(){ MULTI=null; host.classList.remove('cs-multi'); render(); }
  function mtoggle(it){ var id=it.getAttribute('data-id'); if(MULTI.sel[id]) delete MULTI.sel[id]; else MULTI.sel[id]=1; it.classList.toggle('sel',!!MULTI.sel[id]); mpaint(); buzz(5); }
  function download(text,name,type){ var blob=new Blob([text],{type:type+';charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },2000); }
  function safeName(s){ return String(s||'').replace(/[\\/:*?"<>|]/g,'_').slice(0,40)||'会话'; }
  function fetchMsgs(id){ return P.net.get('/v1/history?session_id='+encodeURIComponent(id),{noLogin:true}).then(function(r){
    return ((r&&r.items)||[]).filter(function(m){ return m&&(m.role==='user'||m.role==='assistant')&&(Array.isArray(m.content)?m.content.length:String(m.content==null?'':m.content).trim()); }).map(function(m){ return {role:m.role,content:m.content,time:m.time}; }); }); }
  function multiExport(){ var ids=selIds(); if(!ids.length){ toast('先选几个会话'); return; } if(!live){ toast('没连上后台，导出不了'); return; } toast('正在导出…');
    Promise.all(ids.map(fetchMsgs)).then(function(all){
      var out=[]; ids.forEach(function(id,i){ if(all[i].length) out.push({name:nameOf(byId(id)||{id:id}),messages:all[i]}); });
      if(!out.length){ toast('选中的会话还没有能导出的消息'); return; }
      var one=out.length===1; download(JSON.stringify(one?out[0]:{version:1,sessions:out}),(one?safeName(out[0].name):'会话导出_'+out.length+'个')+'.json','application/json');
      toast('导出好了 · '+out.length+' 个会话'); multiOff();
    },function(){ toast('有会话读不到，没导出'); }); }
  function multiArch(){ var ids=selIds(); if(!ids.length){ toast('先选几个会话'); return; } if(!live){ toast('没连上后台，没归档'); return; }
    put('/heartbeat/admin/session-archive',{add:ids}).then(function(){ ids.forEach(function(id){ if(S.arch.indexOf(id)<0) S.arch.push(id); }); /* [位置:phone-chats.js·multiArch 文案] [子会话组归档提示] [10-31：子会话取回不了（抽屉里没有取回按钮），组内归档后行置灰留在原地，提示不再说「右滑取回」] [注释时间 2026-10-31] */
    toast(inSubGroup()?('已归档 '+ids.length+' 个，组里已标灰'):('已归档 '+ids.length+' 个，右滑可以取回')); multiOff(); },function(){ toast('没归档成功'); }); }
  $('#csMbar',win).addEventListener('click',function(e){ var b=e.target.closest('[data-m]'); if(!b) return; var m=b.getAttribute('data-m'); if(m==='no'){ multiOff(); buzz(6); } else if(m==='all') multiAll(); else if(m==='exp') multiExport(); else if(m==='arch') multiArch(); else if(m==='grp') multiGrp(); });

  var fileIn=null;
  function pickImport(){ if(!live){ toast('没连上后台，导入不了'); return; }
    if(!fileIn){ fileIn=document.createElement('input'); fileIn.type='file'; fileIn.accept='.json,.txt,.md,application/json,text/plain'; fileIn.multiple=true; fileIn.style.display='none'; host.appendChild(fileIn);
      fileIn.addEventListener('change',function(){ var fs=Array.prototype.slice.call(fileIn.files||[]); fileIn.value=''; if(fs.length) importFiles(fs); }); }
    fileIn.click(); }
  function readText(f){ return new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){ res(String(r.result||'')); }; r.onerror=function(){ rej(new Error('读不了这个文件')); }; r.readAsText(f); }); }
  function uid(){ return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)); }
  function goodTime(t){ var d=t?new Date(t):null; return d&&!isNaN(d.getTime())?d.toISOString():new Date().toISOString(); }
  /* 纯文本解析：同旧聊天页 parseImportText / parseBracketedChat（名字认「谢…/ai/assistant/助手」为他，其余算用户） */
  function parseBracketed(text){
    var re=/^\[(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\]\s*([^:：\n]{1,20})[:：][ \t]?(.*)$/, lines=String(text).replace(/\r\n/g,'\n').split('\n'), s=0;
    while(s<lines.length&&!lines[s].trim()) s++; if(s>=lines.length||!re.test(lines[s])) return null;
    var curMe=(P.names&&P.names.me)?P.names.me():'用户', users=['我','用户','user','你',curMe], out=[], cur=null;
    function flush(){ if(cur){ cur.content=cur.content.replace(/\s+$/,''); if(cur.content) out.push(cur); cur=null; } }
    for(var i=s;i<lines.length;i++){ var m=lines[i].match(re);
      if(m){ flush(); var d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)); cur={role:users.indexOf(m[7].trim())>=0?'user':'assistant',content:m[8],time:goodTime(d)}; }
      else if(cur) cur.content+='\n'+lines[i]; }
    flush(); return out.length?{name:'对话备份 '+out[0].time.slice(0,10),messages:out}:null; }
  function parseText(text){
    var bk=parseBracketed(text); if(bk) return bk;
    var headerRe=/^(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})日?[\s T]*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?\s*[·•.．-]?\s*(.+)$/;
    var lines=String(text).replace(/\r\n/g,'\n').split('\n'), i=0; while(i<lines.length&&!lines[i].trim()) i++;
    var title=(lines[i]||'').trim(), firstIsHeader=(lines[i]||'').match(headerRe); if(!firstIsHeader) i++;
    var blocks=lines.slice(i).join('\n').split(/\n?\s*[-–—]{3,}\s*\n?/).map(function(b){ return b.trim(); }).filter(Boolean), out=[];
    blocks.forEach(function(b){ var bl=b.split('\n'), h=-1, m=null;
      for(var k=0;k<bl.length;k++){ var c=bl[k].trim().match(headerRe); if(c){ h=k; m=c; break; } }
      if(!m) return; var name=(m[7]||'').trim(), content=bl.slice(h+1).join('\n').trim(); if(!content) return;
      var curAi=(P.names&&P.names.ai)?P.names.ai():'助手';
      var role=((curAi&&name===curAi)||/^(ai|assistant|助手)/i.test(name))?'assistant':'user';
      out.push({role:role,content:content,time:goodTime(new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)))}); });
    if(!out.length) throw new Error('没能认出消息（格式不对）');
    return {name:firstIsHeader?'':title,messages:out}; }
  /* 一个文件 → 若干个 {name,messages}（已规整：只留 user/assistant、补 id、时间合法） */
  function parseImport(text,fname){
    var j=null; try{ j=JSON.parse(text); }catch(e){} var raw;
    if(j&&typeof j==='object'){
      if(Array.isArray(j)) raw=[{name:fname,messages:j}];
      else if(Array.isArray(j.sessions)) raw=j.sessions.map(function(s,i){ return {name:(s&&s.name)||(fname+' '+(i+1)),messages:s&&s.messages}; });
      else if(Array.isArray(j.messages)) raw=[{name:j.name||fname,messages:j.messages}];
      else throw new Error('格式不对');
    } else { var t=parseText(text); raw=[{name:t.name||fname,messages:t.messages}]; }
    var res=[]; raw.forEach(function(s){
      var ms=(Array.isArray(s.messages)?s.messages:[]).filter(function(m){ return m&&(m.role==='user'||m.role==='assistant')&&(Array.isArray(m.content)?m.content.length:String(m.content==null?'':m.content).trim()); }).map(function(m){ return {id:uid(),role:m.role,content:m.content,time:goodTime(m.time)}; });
      if(ms.length) res.push({name:String(s.name||fname||'导入的会话').slice(0,40),messages:ms}); });
    if(!res.length) throw new Error('没有能导入的消息');
    return res; }
  function saveImported(s){
    var sid='s_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8), n=s.messages.length;
    return P.net.req('/v1/timeline/sync',{method:'POST',body:{session_id:sid,messages:s.messages},headers:{'X-Client':'dylan-chat'}}).then(function(r){
      if(!r||r.ok===false||!(r.appended>0||r.total>0)) throw new Error((r&&r.error)||'后端没收下');
      var st={}; st[sid]=s.name;
      /* [位置:phone-chats.js·saveImported] [导入会话起名同步云端] [时间线落库后名字走改名映射，与手动改名同格式] [注释时间 2026-10-27 改：PUT 改增量 {set}（同 rename：裸键值后端不认、静默丢名）] */
      return put('/heartbeat/admin/session-names',{set:st}).then(function(){},function(){}).then(function(){ S.names[sid]=s.name; S.sessions.unshift({id:sid,total:n,real:n,last_time:s.messages[n-1].time}); return sid; }); }); }
  function importFiles(fs){
    toast('正在导入…'); var okS=0, okM=0, bad=[], lastSid=null;
    (function next(i){
      if(i>=fs.length){ render(); load();
        if(okS) toast('已导入 '+okS+' 个会话 · '+okM+' 条'+(bad.length?'；'+bad.length+' 个没导进去':''));
        else toast('导入失败：'+(bad[0]||'没有内容'));
        if(okS===1&&lastSid&&!bad.length) setTimeout(function(){ openChat(lastSid); },500);
        return; }
      var f=fs[i], base=String(f.name||'导入的会话').replace(/\.[^.]+$/,'');
      readText(f).then(function(t){ var list=parseImport(t,base);
        return list.reduce(function(p,s){ return p.then(function(){ return saveImported(s).then(function(sid){ okS++; okM+=s.messages.length; lastSid=sid; }); }); },Promise.resolve());
      }).catch(function(e){ bad.push('「'+base.slice(0,12)+'」'+String(e&&e.message||'失败').replace(/^HTTP /,'').slice(0,40)); }).then(function(){ next(i+1); });
    })(0); }

  /* ---------- 顶部按钮 / 底部三颗 ---------- */
  $('#csFind',win).addEventListener('click',function(){ find(); });
  /* [位置:phone-chats.js·#csNew 长按] [长按「···」直接新建会话] [11-13：新建是列表最高频动作但藏在「···」第三项；长按 430ms 直达新建，单击仍是菜单（10-24 产品确定保留「···」，不改回「+」）；长按后的那一下 click 吞掉，不弹菜单] [注释时间 2026-11-13] */
  (function(){ var nb=$('#csNew',win), ht=0, hsx=0, hsy=0; if(!nb) return;
    nb.addEventListener('pointerdown',function(e){ hsx=e.clientX; hsy=e.clientY; clearTimeout(ht); ht=setTimeout(function(){ ht=0; nb.__lp=1; newSess(); buzz(8); },430); });
    nb.addEventListener('pointermove',function(e){ if(ht&&Math.hypot(e.clientX-hsx,e.clientY-hsy)>12){ clearTimeout(ht); ht=0; } });
    ['pointerup','pointercancel','pointerleave'].forEach(function(ev){ nb.addEventListener(ev,function(){ clearTimeout(ht); ht=0; }); });
  })();
  $('#csNew',win).addEventListener('click',function(e){ if(this.__lp){ this.__lp=0; e.stopImmediatePropagation(); e.preventDefault(); return; } topMenu(); });
  $('.cs-tabs',win).addEventListener('click',function(e){
    var b=e.target.closest('[data-tab]'); if(!b) return; var t=b.getAttribute('data-tab');
    tab(t);
  });
  /* 底部三颗：就在这一页里切，不跳新窗口（我的 / 配置 的内容由 phone-pages.js 挂进来） */
  /* [位置:phone-chats.js·mountApps] [宽屏「应用」页：手机上能点到的应用都放进来] [10-28：宽屏没有手机桌面，左栏第 4 个标签放应用入口。第一版只克隆了桌面第一页的图标，漏了手机上要翻页/点小组件才进得去的：月历（桌面月历小组件）、用途提示词（桌面第二页）、游戏胶囊（桌面第二页，暂未开放）；现在按清单用桌面同一个图标生成器（PH.icon）生成。聊天自己已在左栏，不重复；点击走原来的 openApp（宽屏下开在右栏）] [注释时间 2026-10-28] */
  var APP_ORDER=window.PH&&window.PH.appOrder||['todo','note','cal','diary','wake','mem','tools','star','perm','trace','pulse','theme','set'];   /* [位置:phone-chats.js·APP_ORDER] [宽屏应用页顺序·引用注册表] [批次4a：唯一来源在 phone-new.html·appOrder（挂 window.PH），这里只留兜底；game→trace 11-07 已确定；11-16 批1 与 appOrder 同步（撤下 待办/唤醒/标星/后台/记忆池/信封）；11-20 晚与 appOrder 同步补回 6 个真页面（待办/唤醒/记忆池/标星/后台/日记）] [注释时间 2026-11-20 改] */
  function mountApps(pane){
    var box=document.createElement('div'); box.className='cs-ag';
    box.innerHTML=APP_ORDER.map(function(id,i){ try{ return P.icon(id,'',i); }catch(e){ return ''; } }).join('');
    pane.appendChild(box);
  }
  var TT={list:'会话',me:'我的',cfg:'配置',apps:'应用'}, curTab='list';
  function tab(t){
    if(t===curTab) { if(t==='list') sc.scrollTo({top:0,behavior:'smooth'}); return; } buzz(6);
    var order=['list','me','cfg','apps'], dir=order.indexOf(t)>order.indexOf(curTab)?1:-1; curTab=t;
    Array.prototype.forEach.call($('.cs-tabs',win).querySelectorAll('[data-tab]'),function(x){ x.classList.toggle('on',x.getAttribute('data-tab')===t); });
    var panes={list:sc,me:$('#csMe',win),cfg:$('#csCfg',win),apps:$('#csApps',win)};
    Object.keys(panes).forEach(function(k){ var el=panes[k]; if(k===t){ el.classList.remove('off'); el.style.setProperty('--d',dir); el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); } else el.classList.add('off'); });
    if(t==='apps'&&!panes.apps.dataset.ok){ panes.apps.dataset.ok=1; mountApps(panes.apps); }
    else if(t!=='list'&&t!=='apps'&&!panes[t].dataset.ok&&P.pages){ panes[t].dataset.ok=1; (t==='me'?P.pages.mountMe:P.pages.mountCfg)(win,panes[t]); if(t==='cfg'&&P.pages.search) P.pages.search(win,'搜配置项','#csCfg',1); }   /* 11-14：配置页也加顶部输入即过滤（#11） */
    var ttl=$('.cs-bar .ttl',win); ttl.firstChild.nodeValue=TT[t]; $('#csSub',win).style.display=t==='list'?'':'none';
    host.classList.toggle('cs-other',t!=='list'); barSync();
  }

  load();
  /* [位置:phone-chats.js·P.chats.switchTo] [切到另一个会话] [聊天页开完分支后要从当前会话切到新会话；聊天层是叠在列表上的，换会话 = 推走当前层再叠一层新的] [注释时间 2026-10-21]
     name 给新会话起的名字（列表里还没有它）；先把它塞进列表数据，免得叠出来的页面标题是裸 id。 */
  function switchTo(sid,name){
    var D=P.D||win.parentNode, old=D&&D.querySelector('.win.tk-layer');
    if(name){ S.names[sid]=name; if(!byId(sid)) S.sessions.unshift({id:sid,total:0,real:0,last_time:new Date().toISOString(),created_iso:new Date().toISOString()}); render(); }
    var go=function(){ openChat(sid); };
    if(old){ P.talkCtx=null; old.remove(); setTimeout(go,30); } else go();
  }
  /* [位置:phone-chats.js·patchMeta] [聊天页 <title>/<status> 即时回写列表] [11-20：AI 起的会话名/进展状态服务器收尾已落库，但列表的 S.names/S.status 只在 load 时才拉，极简下聊天页返回键被侧栏接管、不再触发 load，列表就一直显示建会话那一刻的「新会话」；聊天页 autoTitle 解析到标签就调这里回写内存并重画（零额外请求），开侧栏时的静默刷新（refresh）兜底别处改的名] [注释时间 2026-11-20] */
  function patchMeta(sid,meta){
    if(!sid||!meta) return false;
    var ch=false;
    if(meta.name&&S.names[sid]!==meta.name){ S.names[sid]=meta.name; ch=true; }
    if(meta.status&&S.status[sid]!==meta.status){ S.status[sid]=meta.status; ch=true; }
    if(!ch) return false;
    render();
    if(S.sessions.length) P.net.keep('chats',{sessions:S.sessions,names:S.names,arch:S.arch,pins:S.pins,locked:S.locked,groups:S.groups,status:S.status,subst:S.subst});
    return true;
  }
  /* [位置:phone-chats.js·P.chats.invalidateSnapshots] [快照角标全量失效] [10-28：设置页「清除所有会话快照」成功后调用——前端 SNAP 缓存不清的话，回列表红点还亮着] [注释时间 2026-10-28] */
  function invalidateSnapshots(){ SNAP={}; refreshDots(); }
  P.chats={switchTo:switchTo,patchMeta:patchMeta,refresh:function(){ if(!live&&!cachedShown) return; load(); },invalidateSnapshots:invalidateSnapshots,swipe:function(i,dx,end){ var it=ls.querySelectorAll('.cs-it')[i||0], r=it.getBoundingClientRect(), y=r.top+20, x0=r.right-30; function ev(t,x){ it.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:7})); } ev('pointerdown',x0); ev('pointermove',x0-10); ev('pointermove',x0+dx); if(end) ev('pointerup',x0+dx); },tab:tab,find:find,newSess:newSess,drawer:drawer,top:topMenu,menu:function(i){ var it=ls.querySelectorAll('.cs-it')[i||0]; if(it) menu(it); }};
}

P.register('chats',{html:html,setup:setup});
})();
