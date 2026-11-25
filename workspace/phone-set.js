/* 小手机 · 设置的公共部分：P.settings（本机设置，别的页读）+ P.confirm（公共确认弹窗）+ 启动时应用主题色。
   2026-10-21：原来这里还注册了一份 'set' 设置页，但 phone-pages.js 里重写的 'set' 页（接后端）后加载、把它覆盖了，旧页面整份是死代码，已删；
   设置页现在只在 phone-pages.js 的 setHTML/setSetup。旧页面备份在 data/backups/mcp-session-20261021/phone-set.js.before-clean */
(function(){
"use strict";
var P=window.PH, D=P.D, $=P.$, esc=P.esc, buzz=P.buzz, toast=P.toast, anim=P.anim;
var KEY='ph.set.v1';
var DEF={vib:true,calm:false,theme:0,dayGap:60,nightGap:120,dayFrom:7,dayTo:23,weather:true,city:'',push:'bark',pushOn:true,dnd:true,imgKeep:2,sound:false};
var THEMES=[['冰蓝','#7d9ccf','#a9bfe6'],['雾紫','#9d8fd3','#c5bbe8'],['薄荷','#6fb3a8','#a6d6cd'],['蜜桃','#e096a9','#f1bfcb']];
var S=(function(){ var o=Object.assign({},DEF); try{ var j=JSON.parse(localStorage.getItem(KEY)||'null'); if(j) Object.assign(o,j); }catch(e){} return o; })();
function applyTheme(){ var t=THEMES[S.theme]||THEMES[0]; document.documentElement.style.setProperty('--acc',t[1]); document.documentElement.style.setProperty('--acc2',t[2]); }
applyTheme();
P.settings=S;
/* [位置:phone-set.js·P.chatStyle] [聊天主题注册表] [2026-10-31：入口=设置 → 主题 →「聊天主题」卡（月夜玻璃=bubble、极简=min），原「聊天样式」弹层入口随聊天外观页撤掉；聊天页打开时读一次；存本机 ph.chattheme.v1·style 段（2026-11-14 收拢，原 ph_chat_style 读时迁移）；以后别的聊天主题往 LIST 里加一项、在 phone-talk.js 里按 id 接上即可] [注释时间 2026-10-31 改] */
var CS_KEY='ph_chat_style';   /* [2026-11-14 收拢] 只剩旧键名常量给 get 的未迁移兜底用；读写主路走 P.chatTheme（ph.chattheme.v1·style 段） */
/* [位置:phone-set.js·P.appLayout] [App 整体布局注册表：小手机布局 vs 极简布局] [2026-11-23：把「整体布局」和「默认聊天风格」彻底拆开，互不干扰；老数据未存 layout 时按旧 style==='min' 无感兼容] [注释时间 2026-11-23] */
P.appLayout={LIST:[{id:'phone',name:'小手机布局',desc:'锁屏 · 桌面图标 · 玻璃卡片'},{id:'min',name:'极简布局',desc:'侧栏抽屉 · 纯净纸面外壳'}],
  get:function(){ var v=''; try{ var o=P.chatTheme.read(); if(o&&o.layout) v=String(o.layout); else { var st=(o?String(o.style||''):(localStorage.getItem(CS_KEY)||'')); v=(st==='min'?'min':'phone'); } }catch(e){} return v==='min'?'min':'phone'; },
  set:function(id,silent){ var v=(id==='min'?'min':'phone'); try{ P.chatTheme.save({layout:v}); }catch(e){} if(!silent&&P.themeSync) P.themeSync.touch(); },
  nameOf:function(id){ var v=id||P.appLayout.get(); return v==='min'?'极简布局':'小手机布局'; }};
P.chatStyle={LIST:[{id:'bubble',name:'气泡',desc:'默认 · 蓝色气泡，头像和名字在气泡上方'},{id:'min',name:'极简',desc:'暖白 · Claude 风：无气泡，思考与工具穿插，逐字打字机'}],
  get:function(){ var v='bubble'; try{ var o=P.chatTheme.read(); v=(o?String(o.style||''):(localStorage.getItem(CS_KEY)||''))||'bubble'; }catch(e){} return P.chatStyle.LIST.some(function(x){ return x.id===v; })?v:'bubble'; },   /* [2026-11-14 收拢] 读统一存储 style 段（未迁移时兜底旧键），空值回 bubble，LIST 校验不变 */
  set:function(id,silent){ try{ P.chatTheme.save({style:id}); }catch(e){} if(!silent&&P.themeSync) P.themeSync.touch(); },   /* [2026-11-05 主题页自动保存：改了停手约 1 秒上云；silent=云端拉下来写本机时不回传] [2026-11-14 收拢] 写统一存储 style 段 */
  nameOf:function(id){ var x=P.chatStyle.LIST.filter(function(y){ return y.id===(id||P.chatStyle.get()); })[0]; return x?x.name:'气泡'; }};

/* [位置:phone-set.js·P.chatFont] [聊天页字体] [设置 → 主题 →「字体与字号」（2026-10-31：从聊天外观页挪进主题页）：中文字体、英文字体各选一个，只作用在聊天页（两种聊天主题通用）；存本机 ph.chattheme.v1·cn/en 段（2026-11-14 收拢，原 ph_chat_font_cn / ph_chat_font_en 读时迁移）；字体文件在 fonts/chat/，选了哪个才加载哪个（unicode-range 分块，用到哪些字才下哪些块，30 天缓存）；apply 把整套字体栈写到根节点 --cfont（聊天页正文/输入框/菜单）和 --cchain（思考行、工具行：英文固定 Inter），样式在 phone-talk.css 文末；别的页面以后要用这几款字体直接 font-family:var(--cfont) 即可] [注释时间 2026-10-22] */
(function(){
  /* [2026-11-14 第 24 条 b 收拢] 中英字体读写主路走 P.chatTheme（ph.chattheme.v1·cn/en 段），旧键 ph_chat_font_cn/en 读时迁移、首次保存成功后清除 */
  var SERIF='"PHSong","LXGW ZhiSong CL","Songti SC","Noto Serif CJK SC",serif', SANS='-apple-system,"Noto Sans CJK SC",sans-serif';
  var CN=[
    {id:'wenjin',name:'文津宋体',desc:'宋体 · 清秀，笔画细',fam:'"CF WenJin"',css:'fonts/chat/wenjin/f.css',tail:SERIF},
    {id:'zhisong',name:'霞鹜致宋',desc:'原来在用的 · 柔和文艺',fam:'"PHSong","LXGW ZhiSong CL"',tail:'"Songti SC","Noto Serif CJK SC",serif'},
    {id:'noserif',name:'思源宋体',desc:'宋体 · 稳，像书',fam:'"CF Noto Serif"',css:'fonts/chat/noserif/f.css',tail:SERIF},
    {id:'zhuque',name:'朱雀仿宋',desc:'仿宋 · 秀气',fam:'"CF Zhuque"',css:'fonts/chat/zhuque/f.css',tail:SERIF},
    {id:'pingfang',name:'苹方',desc:'苹果黑体 · 手机自带',fam:'"PingFang SC","Heiti SC"',tail:SANS},
    {id:'misans',name:'MiSans',desc:'黑体 · 清爽',fam:'"CF MiSans"',css:'fonts/chat/misans/f.css',tail:'"PingFang SC",'+SANS}];
  var EN=[
    {id:'none',name:'不指定',desc:'英文跟着中文字体走',fam:''},
    {id:'spectral',name:'Spectral',desc:'细、优雅',fam:'"CF Spectral"'},
    {id:'crimson',name:'Crimson Pro',desc:'偏小、秀气',fam:'"CF Crimson"'},
    {id:'newsreader',name:'Newsreader',desc:'最像 Claude 的回复字',fam:'"CF Newsreader"'}];
  var EN_CSS='fonts/chat/en/f.css', LP={};
  function pick(L,id){ for(var i=0;i<L.length;i++) if(L[i].id===id) return L[i]; return L[0]; }
  function raw(k){ try{ var o=P.chatTheme.read(); if(o) return String(o[k==='cn'?'cn':'en']||''); return localStorage.getItem(k==='cn'?'ph_chat_font_cn':'ph_chat_font_en'); }catch(e){ return null; } }   /* [2026-11-14 收拢] 读统一存储 cn/en 段（未迁移时兜底旧键），空值=未指定、由 pick 回缺省 */
  function link(href){ if(LP[href]) return LP[href];
    return LP[href]=new Promise(function(res){ var l=document.createElement('link'); l.rel='stylesheet'; l.href=href; l.onload=l.onerror=function(){ res(); }; document.head.appendChild(l); }); }
  P.chatFont={CN:CN,EN:EN,
    get:function(k){ return pick(k==='cn'?CN:EN,raw(k)).id; },
    item:function(k,id){ return pick(k==='cn'?CN:EN,id||P.chatFont.get(k)); },
    nameOf:function(k){ return P.chatFont.item(k).name; },
    /* 弹层里每个选项用自己的字体显示：双引号换成单引号才能放进 style 属性 */
    famAttr:function(k,id){ var x=P.chatFont.item(k,id), f=x.fam?x.fam+',':''; return (f+(k==='cn'?x.tail:'serif')).replace(/"/g,"'"); },
    preload:function(k){ var L=k==='cn'?CN:EN; link(EN_CSS); L.forEach(function(x){ if(x.css) link(x.css); }); },
    set:function(k,id,silent){ try{ P.chatTheme.save(k==='cn'?{cn:id}:{en:id}); }catch(e){} P.chatFont.apply(); if(!silent&&P.themeSync) P.themeSync.touch(); },   /* [2026-11-05 同 chatStyle.set：自动保存并上云，silent=云端写回不回传] [2026-11-14 收拢] 写统一存储 cn/en 段 */
    apply:function(){ var cn=P.chatFont.item('cn'), en=P.chatFont.item('en'); link(EN_CSS); if(cn.css) link(cn.css);
      var s=document.documentElement.style;
      s.setProperty('--cfont',(en.fam?en.fam+',':'')+cn.fam+','+cn.tail);
      s.setProperty('--cchain','"CF Inter",'+cn.fam+','+cn.tail); }};
  P.chatFont.apply();
})();

/* ---- 公共：确认弹窗 ---- */
P.confirm=function(win,o,ok){
  var el=document.createElement('div'); el.className='st-alert';
  /* [位置:phone-set.js·P.confirm 按钮顺序] [取消在左、执行在右（不再按危险分位）] [11-13 定「危险在左、取消在右」；11-14 00:45 修：原实现不分危险一律把主按钮放左，非危险确认（重启/启动这类）与打开它的按钮位置相反，容易误点取消且无提示；改成按 o.danger 分位，与 phone-pages.js·confirmBox 同一规则] [注释时间 2026-11-13；2026-11-14 改；2026-11-16 再改：同 phone-pages.js·confirmBox，执行键一律在右，o.danger 只决定颜色] */
  var bOk='<button class="go tap'+(o.danger?' danger':'')+'">'+esc(o.ok||'好')+'</button>', bNo='<button class="no tap">取消</button>';
  el.innerHTML='<div class="scrim"></div><div class="box glass"><b>'+esc(o.title)+'</b><p>'+esc(o.msg||'')+'</p><div class="bt">'+(bNo+bOk)+'</div></div>';
  win.appendChild(el); requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('show'); }); });
  function close(){ el.classList.remove('show'); setTimeout(function(){ el.remove(); },320); }
  el.querySelector('.scrim').addEventListener('click',close); el.querySelector('.no').addEventListener('click',close);
  el.querySelector('.go').addEventListener('click',function(){ close(); buzz(10); ok&&ok(); });
  buzz(6);
};
/* [位置:phone-set.js·P.appear] [外观：跟随时间 / 一直白天 / 一直夜晚] [主题页选，存本机 ph_appear；「跟随时间」读天空层的 data-night（按日出日落算），天空层还没算出来之前按 19:00~06:00 兜底；夜里 #device 加 data-theme="dark"，颜色全在 phone-dark.css；切换时 #device 临时带 ap-fade 做 0.45 秒颜色过渡] [注释时间 2026-10-22] */
var AP_KEY='ph_appear', apMode=(function(){ var v=''; try{ v=localStorage.getItem(AP_KEY)||''; }catch(e){} return v==='day'||v==='night'?v:'auto'; })(), apDark=null, apTimer=0;
function apWant(){ if(apMode==='night') return true; if(apMode==='day') return false; if(D.hasAttribute('data-night')) return true; if(P.skyReady) return false; var h=new Date().getHours(); return h>=19||h<6; }
function apSync(){ var d=apWant(); if(d===apDark) return; var first=apDark===null; apDark=d;
  if(!first){ D.classList.add('ap-fade'); clearTimeout(apTimer); apTimer=setTimeout(function(){ D.classList.remove('ap-fade'); },480); }
  if(d) D.setAttribute('data-theme','dark'); else D.removeAttribute('data-theme');
  if(P.bubble&&P.bubble.refresh) P.bubble.refresh(); }
P.appear={LIST:[['auto','跟随时间'],['day','白天'],['night','夜晚']],get:function(){ return apMode; },isDark:function(){ return !!apDark; },sync:apSync,
  set:function(m){ apMode=m==='day'||m==='night'?m:'auto'; try{ localStorage.setItem(AP_KEY,apMode); }catch(e){} apSync(); }};
apSync();
if(S.calm) D.classList.add('calm');
})();
