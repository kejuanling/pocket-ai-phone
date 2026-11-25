/* phone-bubble.js —— 聊天气泡外观 + 形状绘制。
   2026-11-02 产品确定小尾巴终版：整块 SVG（3331e7b 定稿形状回归，mask 遮罩版她嫌不好看已弃）——只对「小尾巴·SVG」档的
   气泡画 dataURI 形状图，ResizeObserver + 尺寸 key 缓存，尺寸没变不换图；透明度/阴影照旧走 CSS 变量（::before 伪元素）。
   SVG 换图那一帧异步解码会空一下（闪），配套治法在 phone-talk.js：SVG 档流式期间只显示三点泡泡、收完一次性出气泡
   （bsHold），正文气泡只画一次不中途长高，闪的源头（流式逐帧换图）就没了。 */
(function(){
"use strict";
var P=window.PH;
/* 聊天外观（设置 → 聊天外观）：气泡颜色 / 透明度 / 模糊度 / 圆角 / 阴影 + 聊天背景，存在这台手机上。
   [2026-11-14 第 24 条 b 收拢] 本机统一存 ph.chattheme.v1（见 phone-kit.js·P.chatTheme），bubble/bgimg 是其中两段；旧键 ph.bubble.v1 / ph.chatbg.img 读时迁移、首次保存成功后清除。 */
var DEF=P.chatTheme.SCHEMA.bubble, imgCache=null, cbs=[];   /* [2026-11-14 收拢] DEF 缺省改指统一存储的 SCHEMA（唯一定义点），KEY/IMG 散键常量撤掉 */
/* [位置:phone-bubble.js·BG 配套气泡色] [每个预设背景带一套搭好的气泡颜色] [10-30：已有的几个背景搭上气泡颜色，选背景时气泡自动配上；第三项 {me,ai} 是我方/对方气泡底色，文字色按明暗自动算（inkOf）；暮色是深底，对方气泡用深蓝，我方用藕粉紫；跟随桌面（空串）= 回默认色；自己的照片不动] [注释时间 2026-10-30] */
var BG={g1:['粉雾','linear-gradient(160deg,#fde4ec 0%,#f3dcf2 45%,#dfe3fb 100%)',{me:'#d9809f',ai:'#fff6fa'},{top:'253,228,236',bot:'223,227,251'}],g2:['薄荷','linear-gradient(160deg,#e3f6ef 0%,#d7ece9 50%,#cfe2f0 100%)',{me:'#4fae94',ai:'#f3fcf8'},{top:'227,246,239',bot:'207,226,240'}],
  g3:['奶油','linear-gradient(160deg,#fff7ea 0%,#f6ecdf 50%,#efe4f0 100%)',{me:'#cf8a5c',ai:'#fffcf6'},{top:'255,247,234',bot:'239,228,240'}],g4:['暮色','linear-gradient(170deg,#3b4a75 0%,#6b6ea8 55%,#c59bb8 100%)',{me:'#c78fbd',ai:'#363c63',dark:true},{top:'59,74,117',bot:'197,155,184'}]};
function bgImg(){ if(imgCache===null){ try{ imgCache=P.chatTheme.bgimgGet(); }catch(e){ imgCache=''; } } return imgCache; }   /* [2026-11-14 收拢] 改走统一存储（未迁移时兜底读旧键 ph.chatbg.img） */
function bgCss(){ if(ST.bg==='img'){ var u=bgImg(); return u?'url("'+u+'")':'none'; } return BG[ST.bg]?BG[ST.bg][1]:'none'; }
/* [位置:phone-bubble.js·normST] [气泡配置归一] [DEF 打底 + 旧数据迁移；初始化、loadSaved、云端拉取共用一份，不各写一套] [注释时间 2026-11-05] */
function normST(j){ var o=Object.assign({},DEF); if(j&&typeof j==='object') Object.assign(o,j);
  /* [位置:phone-bubble.js·ST 迁移] [圆角拆两边] [2026-10-31：他的/我的气泡圆角可以不同（--brai/--brme）；旧数据只有单一 r，迁成两边一样后删掉] [注释时间 2026-10-31] */
  if(o.aiR==null) o.aiR=(o.r!=null?+o.r:15); if(o.meR==null) o.meR=(o.r!=null?+o.r:15); delete o.r; return o; }
var ST=(function(){ var o=null; try{ var o1=P.chatTheme.read(); o=o1?o1.bubble:null; }catch(e){} return normST(o); })();   /* [2026-11-14 收拢] bubble 段从统一存储读（旧键读时迁移） */
/* [位置:phone-bubble.js·drafting] [月夜玻璃子页是否在编辑草稿] [phone-pages.js 子页开着时把 P.lookDraftEl 指向子页元素；元素还在 DOM 里=草稿期，set/setBgImage 不落盘；元素没了自动恢复落盘] [注释时间 2026-11-05] */
function drafting(){ return !!(P.lookDraftEl&&P.lookDraftEl.isConnected); }
/* 底色偏浅就用深色字，偏深就用白字 */
function inkOf(hex,th){
  var m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return '';
  var n=parseInt(m[1],16), L=(0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))/255;
  return L>(th==null?0.75:th)?'var(--ink)':'#fff';
}
/* [位置:phone-bubble.js·eff] [夜间模式下的气泡底色] [对方气泡没自定义过颜色（还是默认浅蓝白）时，夜间换成深色；用户自己选过的颜色照用] [注释时间 2026-10-22] */
function isDark(){ return !!(P.D&&P.D.getAttribute('data-theme')==='dark'); }
function eff(side){ return side==='ai'&&isDark()&&String(ST.ai).toLowerCase()===DEF.ai?'#222839':ST[side]; }
/* [位置:phone-bubble.js·darkBg] [聊天背景是深是浅] [10-30：发送键纸飞机要看得清——输入框后面是聊天背景，深底配白图标、浅底配深图标。判定：没设背景（跟随桌面）看夜间；预设背景看 BG 的 dark 标记（暮色）；自己的照片看选图时算出的 bgDark（phone-pages.js·imgPalette）。结果挂 #device.cbgdark，phone-talk.css 据此给发送键上色（mix-blend-mode:difference 试过：输入栏是独立合成组，混不到页面背景，失败）] [注释时间 2026-10-30] */
function darkBg(){ if(ST.bg==='') return isDark(); if(ST.bg==='img') return !!ST.bgDark; return !!(BG[ST.bg]&&BG[ST.bg][2]&&BG[ST.bg][2].dark); }
/* [位置:phone-bubble.js·bgTint] [渐隐层跟背景上/下缘同色] [2026-11-01：顶部/底部渐隐层各自取背景上缘、下缘的颜色，不要取中间色——预设背景取渐变首/末色（BG 第 4 项 {top,bot}），自己的照片取可见上/下缘平均色（phone-pages.js·imgPalette 写入 bgTintTop/Bot），跟随桌面时留空由 CSS 回退界面底色 --sh] [注释时间 2026-11-01] */
function bgTint(){ if(!ST.bg) return null;
  var re=/^\d{1,3},\d{1,3},\d{1,3}$/;
  if(ST.bg==='img'){ var t=String(ST.bgTintTop||''), b=String(ST.bgTintBot||'');
    if(re.test(t)&&re.test(b)) return {top:t,bot:b};
    var f=darkBg()?'20,23,33':'246,249,255'; return {top:f,bot:f}; }   /* 旧照片没存上下色：先按深浅兜底，重选照片会写入 */
  return (BG[ST.bg]&&BG[ST.bg][3])||null; }
/* [位置:phone-bubble.js·hexMix/patBg] [成品底图底色与文字黑白] [成品底图带底色时会把气泡刷成那个色（tile 底色铺 70%），文字黑白不能只看气泡色——否则深色模式下选一款浅底成品，白字落在浅底上读不清。这里按 气泡色×(1-.7)+底色×.7 估出实际底色再判深浅（与 genTile 里 .7 的铺色一致）；没图案/没底色时原样不动] [注释时间 2026-11-05] */
function hexMix(a,b,t){ var ma=/^#?([0-9a-f]{6})$/i.exec(a||''), mb=/^#?([0-9a-f]{6})$/i.exec(b||''); if(!ma||!mb) return a;
  var na=parseInt(ma[1],16), nb=parseInt(mb[1],16), o=[];
  [16,8,0].forEach(function(sh){ var v=Math.round((na>>sh&255)*(1-t)+(nb>>sh&255)*t); o.push(Math.max(0,Math.min(255,v))); });
  return '#'+((1<<24)+(o[0]<<16)+(o[1]<<8)+o[2]).toString(16).slice(1); }
function patBg(side){ try{ var F=lookPF(side); if(F.id!=='gen'||!F.g) return ''; var g=genParse(F.g); return (g&&g.bg)||''; }catch(e){ return ''; } }
/* [位置:phone-bubble.js·applyCardVars] [自定义主题卡片双因子智能配色] [2026-11-18：气泡主题下，若用户自定义了气泡底色或气泡字体颜色，根据字体颜色与气泡底色双因子智能计算卡片的玻璃底、文字色、强调色、浅底与按钮反色文字（--cd-ai-* / --cd-me-*）；未自定义时清除变量，走默认日/夜 CSS] [注释时间 2026-11-18] */
function parseHex(hex){
  var m=/^#?([0-9a-f]{6})$/i.exec(String(hex||'').trim()); if(!m) return null;
  var n=parseInt(m[1],16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  var max=Math.max(r,g,b), min=Math.min(r,g,b), h=0, s=0, l=(max+min)/2;
  if(max!==min){
    var d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    if(max===r) h=(g-b)/d+(g<b?6:0); else if(max===g) h=(b-r)/d+2; else h=(r-g)/d+4;
    h/=6;
  }
  return {h:h*360,s:s,l:l};
}
function hslToHex(h,s,l){
  h=((h%360)+360)%360/360; s=Math.max(0,Math.min(1,s)); l=Math.max(0,Math.min(1,l));
  function h2r(p,q,t){ if(t<0) t+=1; if(t>1) t-=1; if(t<1/6) return p+(q-p)*6*t; if(t<1/2) return q; if(t<2/3) return p+(q-p)*(2/3-t)*6; return p; }
  var r,g,b;
  if(s===0){ r=g=b=l; } else { var q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q; r=h2r(p,q,h+1/3); g=h2r(p,q,h); b=h2r(p,q,h-1/3); }
  return '#'+[r,g,b].map(function(x){ var s2=Math.round(x*255).toString(16); return s2.length<2?'0'+s2:s2; }).join('');
}
function relLum(rgb){
  function ch(v){ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); }
  return 0.2126*ch(rgb.r)+0.7152*ch(rgb.g)+0.0722*ch(rgb.b);
}
function contrastRatio(c1,c2){ var l1=relLum(c1), l2=relLum(c2); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
function rgbaStr(rgb,a){ return 'rgba('+rgb.r+','+rgb.g+','+rgb.b+','+a+')'; }
var CD_KEYS=['bg','border','ink','ink2','ink3','acc','on-acc','soft','line','ico','tint','in-bg','in-focus'];
function applyCardSide(rs,side,bubbleBg,bubbleInk,custom,dark){
  if(!custom){ CD_KEYS.forEach(function(k){ rs.removeProperty('--cd-'+side+'-'+k); }); return; }
  var bgRgb=parseHex(bubbleBg)||(dark?{r:34,g:40,b:57}:{r:246,g:249,b:255});
  var inkRgb=parseHex(bubbleInk)||(dark?{r:232,g:230,b:223}:{r:42,g:48,b:66});
  var bgHsl=rgbToHsl(bgRgb.r,bgRgb.g,bgRgb.b), inkHsl=rgbToHsl(inkRgb.r,inkRgb.g,inkRgb.b);
  var accHsl=inkHsl.s>0.15?{h:inkHsl.h,s:Math.max(0.38,Math.min(0.72,inkHsl.s)),l:inkHsl.l}:(bgHsl.s>0.12?{h:bgHsl.h,s:Math.max(0.38,Math.min(0.72,bgHsl.s)),l:bgHsl.l}:{h:217,s:0.46,l:0.65});
  var accL=dark?Math.max(0.58,Math.min(0.74,accHsl.l)):Math.max(0.42,Math.min(0.60,accHsl.l));
  var accHex=hslToHex(accHsl.h,accHsl.s,accL), accRgb=parseHex(accHex);
  var cardBg,cardBorder,inBg,inFocus;
  if(dark){
    var d1=parseHex(hslToHex(accHsl.h,Math.min(0.25,accHsl.s*0.4),0.17)), d2=parseHex(hslToHex(accHsl.h,Math.min(0.25,accHsl.s*0.4),0.13));
    cardBg='linear-gradient(165deg,'+rgbaStr(d1,0.86)+','+rgbaStr(d2,0.76)+')';
    cardBorder=rgbaStr(accRgb,0.24); inBg='rgba(12,15,24,.42)'; inFocus='rgba(12,15,24,.65)';
  }else{
    var l1=parseHex(hslToHex(accHsl.h,Math.min(0.35,accHsl.s*0.5),0.97)), l2=parseHex(hslToHex(accHsl.h,Math.min(0.35,accHsl.s*0.5),0.94));
    cardBg='linear-gradient(165deg,'+rgbaStr(l1,0.88)+','+rgbaStr(l2,0.68)+')';
    cardBorder='rgba(255,255,255,.92)'; inBg=rgbaStr(accRgb,0.07); inFocus='rgba(255,255,255,.65)';
  }
  var baseSurf=dark?{r:32,g:36,b:48}:{r:248,g:249,b:252};
  var cdInkHex=contrastRatio(inkRgb,baseSurf)>=4.5?hslToHex(inkHsl.h,inkHsl.s,inkHsl.l):hslToHex(inkHsl.h,Math.min(0.35,inkHsl.s),dark?0.88:0.22);
  var cdInkRgb=parseHex(cdInkHex);
  var onAcc=relLum(accRgb)>0.42?hslToHex(accHsl.h,Math.min(0.4,accHsl.s),0.16):'#ffffff';
  var map={bg:cardBg,border:cardBorder,ink:cdInkHex,ink2:rgbaStr(cdInkRgb,0.68),ink3:rgbaStr(cdInkRgb,0.44),acc:accHex,'on-acc':onAcc,
    soft:rgbaStr(accRgb,dark?0.16:0.12),line:rgbaStr(accRgb,dark?0.28:0.22),ico:hslToHex(accHsl.h,accHsl.s,dark?0.72:0.44),
    tint:rgbaStr(accRgb,dark?0.22:0.18),'in-bg':inBg,'in-focus':inFocus};
  CD_KEYS.forEach(function(k){ rs.setProperty('--cd-'+side+'-'+k,map[k]); });
}
function applyCardVars(){
  var rs=document.documentElement.style, dark=isDark();
  var aiInk=rs.getPropertyValue('--tk-ai-ink').trim()||rs.getPropertyValue('--bai-ink').trim();
  var meInk=rs.getPropertyValue('--tk-me-ink').trim()||rs.getPropertyValue('--bme-ink').trim();
  var aiCustom=String(ST.ai).toLowerCase()!==DEF.ai||!!rs.getPropertyValue('--tk-ai-ink').trim();
  var meCustom=String(ST.me).toLowerCase()!==DEF.me||!!rs.getPropertyValue('--tk-me-ink').trim();
  applyCardSide(rs,'ai',eff('ai'),aiInk,aiCustom,dark);
  applyCardSide(rs,'me',ST.me,meInk,meCustom,dark);
}
function applyVars(){
  var rs=document.documentElement.style;
  var _meb=patBg('me'), _aib=patBg('ai');
  rs.setProperty('--bme',ST.me); rs.setProperty('--bai',eff('ai'));
  /* [2026-11-06 图案背景] 图案模式：底色＝图案自带底色（铺满），文字黑白按它判；实色模式仍按气泡色 */
  var _mePat=lookBG('me')==='pat', _aiPat=lookBG('ai')==='pat', _aic=eff('ai');
  rs.setProperty('--bme-ink',(_mePat&&_meb)?inkOf(_meb,.6):inkOf(ST.me));
  rs.setProperty('--bai-ink',(_aiPat&&_aib)?inkOf(_aib,.6):((isDark()&&_aic!==ST.ai&&!_aib)?'#e8e6df':inkOf(_aic)));
  rs.setProperty('--brai',ST.aiR+'px'); rs.setProperty('--brme',ST.meR+'px'); rs.setProperty('--hsq-ai',lookHsq('ai')+'px'); rs.setProperty('--hsq-me',lookHsq('me')+'px');   /* [位置:phone-bubble.js·applyVars hsq 方角变量] [两方两圆方角固定值供 CSS 取] [11-17 方角改可调；lookLoadSaved/恢复主题走的是 lookApply 侧同名变量，两边同源双写不冲突] [注释时间 2026-11-17] */ rs.setProperty('--ba',String(ST.a)); rs.setProperty('--bblur',ST.blur+'px');
  rs.setProperty('--cbg',bgCss()); rs.setProperty('--cbg-blur',((100-ST.clear)*.24).toFixed(1)+'px'); rs.setProperty('--cbg-veil',String(ST.veil/100));
  var _tint=bgTint(); if(_tint){ rs.setProperty('--cbg-tint-top',_tint.top); rs.setProperty('--cbg-tint-bot',_tint.bot); } else { rs.removeProperty('--cbg-tint-top'); rs.removeProperty('--cbg-tint-bot'); }   /* 2026-11-01：顶/底渐隐层各自跟背景上/下缘同色 */
  if(P.D){ P.D.classList.toggle('bnoshadow',!ST.shadow); P.D.classList.toggle('bblur',ST.blur>0); P.D.classList.toggle('hascbg',ST.bg!==''); P.D.classList.toggle('cbgdark',darkBg()); P.D.classList.toggle('bme-custom',ST.me!==DEF.me); P.D.classList.toggle('bai-custom',String(ST.ai).toLowerCase()!==DEF.ai); }   /* bai-custom：AI 气泡配过色→按键图标跟 AI 气泡色（2026-11-03） */   /* bme-custom：气泡色配过（≠默认 #7298d6）→ phone-talk.css 的 --tk-btnink 按钮图标跟气泡色走（2026-11-02） */
  applyCardVars();
}
applyVars();

/* ---------- 小尾巴·SVG（2026-11-02 形状选择器回归） ---------- */
/* [位置:phone-bubble.js·shapePath] [iMessage 弯尾巴路径] [fc24b78 版原样移植：画的是「尾巴在左下」的形状（对方气泡），自己的气泡靠 CSS 镜像思路——SVG 直接按右侧尾巴重算（me 侧 tx 取正值）；圆角跟设置里的 --brai/--brme；单行时尾巴不超过半高] [注释时间 2026-11-02] */
var SM=12, SVER=0;
function sf(n){ return Math.round(n*100)/100; }
/* [位置:phone-bubble.js·lookBS] [气泡形状当前档] [本文件比 phone-pages.js 先加载（P.lookV 可能还没建）：优先读 P.lookV，兜底读统一存储 look 段（2026-11-14 收拢前是直读旧键 ph.look.v2）；缺省 def] [注释时间 2026-11-02；2026-11-14 收拢] */
function lkRaw(){ try{ var o=P.chatTheme&&P.chatTheme.read(); return (o&&o.look)||null; }catch(e){ return null; } }   /* [2026-11-14 收拢] 兜底直读统一出口：phone-kit 最先加载，read() 一定在；旧键已由 read() 迁移 */
function lkGet(k){ try{ if(P.lookV&&P.lookV[k]!=null) return P.lookV[k]; var j=lkRaw(); return j?j[k]:undefined; }catch(e){ return undefined; } }
/* [2026-11-06 形状分边] 形状档从「全局一份」拆成 aiBs/meBs，每边一套（公共也要分两边，只是各自的公共）。带 side 读该边；不带 side 时给 phone-talk.js·bsHold 用——任一边是尾巴档就按尾巴档处理。老数据只有 bs，两边取它 */
function lookBS(side){
  var a=lkGet('aiBs'), m=lkGet('meBs');
  if(side){ var v=lkGet(side+'Bs'); if(v!=null) return v; }
  if(a==null&&m==null) return lkGet('bs')||'def';
  if(a==='tailsvg'||m==='tailsvg') return 'tailsvg';
  return a||m||'def';
}
/* [位置:phone-bubble.js·lookHsq] [两方两圆的方角半径] [11-17：批5 固定公式 min(6,圆角×30%) 真机仍嫌方，改用户可调——look 段 aiHsqR/meHsqR（phone-kit SCHEMA 缺省 11），设置页仅 hsq 档显示「方角」滑杆；这里做 0~16 兜底，cssRadii 与 applyVars（--hsq-ai/--hsq-me）都从它走] [注释时间 2026-11-17] */
function lookHsq(side){ var v=lkGet(side+'HsqR'); if(v==null) return 11; v=+v; return isNaN(v)?11:Math.max(0,Math.min(16,v)); }
/* [位置:phone-bubble.js·lookBG] [这一边的背景类型] [实色 solid / 图案 pat，二选一；老数据没有该字段时按有没有图案推断] [注释时间 2026-11-06] */
function lookBG(side){ var v=lkGet(side+'BgType'); if(v==='pat'||v==='solid') return v; var p=lkGet(side+'Pat'); return (p&&p!=='none')?'pat':'solid'; }
/* [位置:phone-bubble.js·ldK] [线条疏密系数] [11-03：线框加「疏密」滑杆（ph.look.v2 的 side+Ld，10~100，缺省 50=原样）；k=2^((Ld-50)/50)：50→1，100→2（更密：虚线段/间隔减半、波长减半），10→0.57（更疏）；虚线段长=5/k、间隔=4/k，波浪每段长=22/k] [注释时间 2026-11-03] */
function ldK(d){ d=+d||50; return Math.pow(2,(d-50)/50); }
function shapePath(w,h,tail,r,ls,lw,ld){
  r=Math.min(h/2,(r||15)); var d;
  /* [2026-11-03：波浪线框档整个气泡变波浪——底色形状与线框必须同一条轮廓（截图实测：底直边+框波浪两层错位、尾巴不在框里）。wave=四条直边换 waveSeg（rng 确定性抖动 seed=宽高+线宽，重画零跳变），四角圆弧/尾巴曲线原样保留、衔接点不变；ls/lw 由 svgShape·波浪线框档与 drawFrame·def/sms 波浪档传入，不传=直边（原行为零变化）] */
  var wave=ls==='wave', rand=wave?rng(w*7+h*13+(lw||2)*31):null, amp=wave?1.5+(lw||2)*.75:0;
  function wseg(x0,y0,x1,y1){ if(!wave) return null;
    return waveSeg(x0,y0,x1,y1,amp,Math.max(2,Math.round(Math.sqrt((x1-x0)*(x1-x0)+(y1-y0)*(y1-y0))*ldK(ld)/22)),rand); }
  function H2(x0,y0,x1,y1){ var s2=wseg(x0,y0,x1,y1); return s2!=null?s2:'H'+sf(x1); }
  function V2(x0,y0,x1,y1){ var s2=wseg(x0,y0,x1,y1); return s2!=null?s2:'V'+sf(y1); }
  d='M'+sf(r)+' 0'+H2(r,0,w-r,0)+'A'+sf(r)+' '+sf(r)+' 0 0 1 '+sf(w)+' '+sf(r)+V2(w,r,w,h-r)+'A'+sf(r)+' '+sf(r)+' 0 0 1 '+sf(w-r)+' '+sf(h);
  if(tail){
    var px=Math.min(8.8,r*.46), py=h-r+Math.sqrt(r*r-(r-px)*(r-px)), ty=h+1.8, sy=h-Math.min(4.8,r*.25);
    /* 尾巴在左下（fc24b78 原版路径）：底边、从弧终点倒走左下角圆弧、外撇尖、内凹弯回左边线，左上角弧闭合；波浪档底边/左边线为波形段，衔接点不变 */
    d+=H2(w-r,h,r,h)+'A'+sf(r)+' '+sf(r)+' 0 0 1 '+sf(px)+' '+sf(py)+
       'C'+sf(px-2.6)+' '+sf(py+1.6)+' 0.4 '+sf(ty-.2)+' -2.2 '+sf(ty)+
       'C'+sf(-.7)+' '+sf(h+.9)+' 0 '+sf(h-1.4)+' 0 '+sf(sy)+V2(0,sy,0,r)+
       'A'+sf(r)+' '+sf(r)+' 0 0 1 '+sf(r)+' 0Z';
    return d;
  }
  d+=H2(w-r,h,r,h)+'A'+sf(r)+' '+sf(r)+' 0 0 1 0 '+sf(h-r)+V2(0,h-r,0,r)+'A'+sf(r)+' '+sf(r)+' 0 0 1 '+sf(r)+' 0Z';
  return d;
}
/* [位置:phone-bubble.js·bubbleAlpha] [气泡纯色底透明度] [11-05：气泡透明度只管纯色底，图案浓度归「图案透明度」——两个旋钮分开。尾巴档底色画在 SVG 里（CSS opacity 会连带把图案淡掉），所以这里的 alpha 要烘进 SVG 的 fill-opacity。值跟 CSS 的 --ka 同口径：--tk-XX-a（主题里的透明度滑杆，V.aiA/100）× --ba（聊天外观的总透明度 ST.a）] [注释时间 2026-11-05] */
function bubbleAlpha(side){
  if(lookBG(side)==='pat') return 1;   /* [2026-11-06 图案背景] 图案模式底色由图案自带（不透明铺满），浓度归「图案透明度」，不再乘气泡透明度 */
  var a=1;
  try{ if(P.lookV&&P.lookV[side+'A']!=null) a=+P.lookV[side+'A']/100;
    else{ var j=lkRaw(); if(j&&j[side+'A']!=null) a=+j[side+'A']/100; } }catch(e){}
  var ba=(ST.a==null?1:+ST.a);
  return Math.max(0,Math.min(1,a*ba));
}
/* [位置:phone-bubble.js·smsLink] [经典收角（sms）连发相邻位判定] [2026-11-23 Muse 风格分组贴合圆角：检查紧邻前后兄弟是否同边 .b——0=单条(四角大圆角)、1=尾条(收内上)、2=首条(收内下)、3=中间条(收上下内)；与 phone-bubble.css 相邻选择器同口径，供 cssRadii 与 drawFrame/drawPat key 缓存共用] */
function smsLink(b){
  if(!b||!b.parentNode) return 0;
  var s=b.classList.contains('me')?'me':'ai';
  var pr=b.previousElementSibling, nx=b.nextElementSibling;
  var hp=!!(pr&&pr.classList&&pr.classList.contains('b')&&pr.classList.contains(s));
  var hn=!!(nx&&nx.classList&&nx.classList.contains('b')&&nx.classList.contains(s));
  return (hp?1:0)|(hn?2:0);
}
/* [位置:phone-bubble.js·cssRadii] [SVG 轮廓四角半径（body 坐标）] [按 CSS 规范算四角实际半径，供 bubbleOutline 画 SVG 轮廓用（线框/图案/尾巴都从它走）；注意坐标约定=镜像前的 body 坐标——bubbleOutline 的三个消费方（drawFrame/drawPat/svgShape）对 me 侧整幅水平镜像，所以「经典收角档（data-bs=sms）」在 body 坐标里按 sms 位收内侧角（tl=内上、bl=内下），me 镜像后翻到屏幕右侧，与 phone-bubble.css·经典收角的 border-radius 对齐。②任一边上两角半径之和超过边长时，四角同比缩小（CSS Backgrounds 3 规则）] [注释时间 2026-11-05；2026-11-16 批2 E6 改 body 坐标约定；2026-11-23 升级 sms 连发分组收角] */
function cssRadii(w,h,r,side,sms){
  var tl=r,tr=r,br=r,bl=r;
  if(lookBS(side)==='sms'){ if(sms&1) tl=5; if(sms&2) bl=5; }   /* body 坐标：相邻前一条收内上(tl=5)，相邻后一条收内下(bl=5)，单条四角保持 r；me 侧镜像后=屏幕右侧内角 */
  if(lookBS(side)==='hsq'){ var sq=lookHsq(side); tl=sq; bl=sq; }   /* [位置:phone-bubble.js·cssRadii 两方两圆] [11-16 批2 E4：新形状档 hsq——AI 侧左上下角方、右两角圆；me 侧镜像。同样走 body 坐标：两边都是左角方，me 镜像后=屏幕右角方；CSS 对应规则在 phone-bubble.css·两方两圆（屏幕坐标，AI 左方/我右方），SVG 弧与 CSS 同形。11-17 批5 柔化公式 min(6,圆角×30%) 用户真机仍嫌方，11-17 晚改用户可调：方角=lookHsq（look 段 aiHsqR/meHsqR 缺省 11），设置页「方角」滑杆直调，CSS 侧 var(--hsq-ai/--hsq-me) 同源] [注释时间 2026-11-16；2026-11-17 批5 柔化；2026-11-17 晚改可调] */
  var f=1;
  function edge(e,s){ if(s>e&&s>0) f=Math.min(f,e/s); }
  edge(w,tl+tr); edge(w,br+bl); edge(h,tl+bl); edge(h,tr+br);
  return [tl*f,tr*f,br*f,bl*f];
}
/* [位置:phone-bubble.js·bubbleOutline] [统一气泡轮廓] [11-05：气泡背景(底色)、气泡线框、图案三者必须同形——之前各画各的：尾巴档气泡带小尾巴、线框却是圆角矩形；波浪档线框是波浪、图案层还是方矩形；经典收角档线框没跟着收角。现在统一成一条 body 局部坐标（0..w,0..h）的轮廓 path，三样共用]
   ls='wave' 时整条边波浪化（波浪线框档）；tail=true 时带小尾巴（尾巴档，me 侧由调用方镜像）] [注释时间 2026-11-05] */
function bubbleOutline(side,w,h,tail,ls,lw,ld,sms){
  var r=(side==='me'?ST.meR:ST.aiR)||15;
  /* [2026-11-10 波浪不带尾巴] 线框样式与气泡形状是两个独立旋钮：尾巴只在该边形状档=小尾巴时才有，选波浪线框不能顺带长出尾巴（调用方按「组内最后一个」标 tail，这里统一收口） */
  tail=tail&&lookBS(side)==='tailsvg';
  if(ls==='wave') return shapePath(w,h,!!tail,r,'wave',lw||2,ld);
  if(lookBS(side)==='tailsvg') return shapePath(w,h,!!tail,r);
  var R=cssRadii(w,h,r,side,sms||0);
  return 'M'+sf(R[0])+' 0H'+sf(w-R[1])+'A'+sf(R[1])+' '+sf(R[1])+' 0 0 1 '+sf(w)+' '+sf(R[1])+'V'+sf(h-R[2])+'A'+sf(R[2])+' '+sf(R[2])+' 0 0 1 '+sf(w-R[2])+' '+sf(h)+'H'+sf(R[3])+'A'+sf(R[3])+' '+sf(R[3])+' 0 0 1 0 '+sf(h-R[3])+'V'+sf(R[0])+'A'+sf(R[0])+' '+sf(R[0])+' 0 0 1 '+sf(R[0])+' 0Z';
}
/* [位置:phone-bubble.js·isColLast] [组内最后一个气泡] [尾巴只画在一条组里最后那个 .b 上（旧版渲染时标 .tail，新版不动渲染链，直接看 DOM 位置：同 .col 里最后一个 .b）] [注释时间 2026-11-02] */
function isColLast(b){ var c=b.parentNode; if(!c) return false; var n=c.lastElementChild;
  while(n&&!(n.classList&&n.classList.contains('b'))) n=n.previousElementSibling; return n===b; }
/* [位置:phone-bubble.js·svgShape] [SVG 形状绘制] [只对「小尾巴·SVG」档生效；key 缓存（边+宽高+是否组尾）尺寸没变不重画；SVG 作为 dataURI 写进 --shape，由 CSS 垫在 .b.shaped::before 上；透明度/阴影不进图（CSS 变量挂伪元素，见 phone-bubble.css）]
   [2026-11-05 轮廓统一] 形状 path 改用 bubbleOutline（与线框、图案同一条轮廓）；图案不再画进形状 SVG 的 <pattern>（图案独立成 drawPat 那一层，浓度只由图案透明度控制，不再跟气泡透明度串联）] [注释时间 2026-11-02] */
function svgShape(b){
  if(!b||b.nodeType!==1||!b.classList.contains('b')) return;
  if(b.closest('.tkmin')) return;   /* 极简不碰 */
  if(b.classList.contains('na')) return;   /* na 静默虚线气泡不画形状（虚线框+半透明底是它自己的语义） */
  if(lookBS(b.classList.contains('me')?'me':'ai')!=='tailsvg'){ if(b._shapeKey){ b._shapeKey=null; b.style.removeProperty('--shape'); b.classList.remove('shaped'); } return; }
  var w=b.offsetWidth, h=b.offsetHeight; if(!w||!h) return;
  var side=b.classList.contains('me')?'me':'ai', typing=b.classList.contains('typing');
  /* 尾巴判定：渲染链标的 .tail（phone-talk.js·render / retail）优先——组内最后一个非 na 气泡；isColLast 只兜底设置页预览（lk-ms 平铺、无渲染链） */
  var tail=!typing&&(b.classList.contains('tail')||isColLast(b));
  var col=side==='me'?ST.me:eff('ai');   /* 夜间且未自定义时 AI 用深色（applyVars 同款口径） */
  /* [2026-11-03 波浪线框并入形状] 他的波浪线框档：path 波浪化+fill+stroke 同轮廓（底=框一体、尾巴也在框里），--fr 不另画（drawFrame 分流清理）；key 带波浪参数（换框色/线宽即重画）] */
  var LF=lookLF(side), fw=!typing&&LF.ls==='wave';
  /* [位置:phone-bubble.js·svgShape] [背景二选一收口·尾巴档实色不烘图案] [同 drawPat 2026-11-07：patOn 只看「有没有图案」不看背景类型，实色模式下尾巴档把图案烘进形状 SVG 盖住实色底。加 lookBG 判定后实色回纯色+气泡透明度（与 drawFrame 波浪档同口径）；patOn 翻转自带 key 变化会自动重画] [注释时间 2026-11-07] */
  var alpha=bubbleAlpha(side), F=lookPF(side), patOn=!typing&&F.id!=='none'&&lookBG(side)==='pat';
  /* [2026-11-05] key 要带透明度与图案参数：底色 alpha 烘在 SVG 里、图案浓度烘在 pattern 里，这俩变了都得重画 */
  var key=SVER+PVER+side+w+'x'+h+(tail?'t':'')+(typing?'p':'')+'a'+alpha+(patOn?'P'+F.id+F.sz+F.lc+F.g+'o'+F.po:'')+(fw?'W'+LF.lw+LF.lc+'o'+LF.lo+'d'+LF.ld:''); if(b._shapeKey===key) return; b._shapeKey=key;   /* 波浪段 key 带 lo：线框透明度变了形状图（fill+stroke 同轮廓）也要重画（2026-11-16 批2 E7） */
  var W=w+SM*2, H=h+SM*2;
  /* [位置:phone-bubble.js·浅色描边] [AI 尾可见性] [2026-11-02真机反馈 AI 气泡「没」尾巴——实际画了，是近白气泡（默认 #f6f9ff，L≈0.97）在浅背景上对比太低看不出来；高亮度气泡（L>0.72，inkOf 同款公式）的 SVG 自带一圈极淡描边勾出形状轮廓（含尾巴），描边色用气泡阴影同源蓝灰 rgba(96,120,160,.26)、宽 1.25；深色气泡/夜间/me 蓝色（L≈0.62 本就清晰）不加，自定义深色也不加] [注释时间 2026-11-02] */
  var nm=/^#?([0-9a-f]{6})$/i.exec(col||''), bright=false;
  if(nm){ var nv=parseInt(nm[1],16); bright=(0.299*(nv>>16&255)+0.587*(nv>>8&255)+0.114*(nv&255))/255>0.72; }
  var d=bubbleOutline(side,w,h,tail,fw?'wave':'',fw?LF.lw:0,fw?LF.ld:0);
  /* [2026-11-05 图案独立 + 层级修正] 尾巴档的图案走形状 SVG 自己的 <pattern>：①浓度独立（pattern 里的 wrapper opacity = 用户的「图案透明度」，不乘气泡透明度）；②层级正确——线框是同一个 path 的 stroke，必须压在图案之上，同一张 SVG 里 fill→pattern→stroke 的绘制顺序天然对。
     def/sms 档没这个层级问题（线框在 ::before、图案在 ::after，两层伪元素分开），图案走 drawPat 那层。 */
  /* [2026-11-05 透明度解耦] 底色 alpha 烘进 SVG（fill-opacity），不再靠 CSS 的 opacity:var(--tk-ai-a) 淡整张图——那样会把图案一起淡掉，图案的「图案透明度」就白设了。阴影改走 CSS 变量另算（见 phone-bubble.css）。 */
  var patD='', fillCol=col, fillOp='';
  if(patOn){ var T2=F.id==='gen'?Math.max(10,Math.min(44,F.sz)):(F.id==='stripe'?Math.min(44,Math.round(F.sz*1.5)):F.sz);
    var pbase2=F.lc||col, gg2=F.id==='gen'?genParse(F.g):null;
    /* [2026-11-06 图案背景] 图案自带底色铺满时不另垫色；没有底色的（旧 10 图案 / 底色清空）用气泡色垫一层，不留透明缝 */
    var tile2=(gg2&&gg2.bg?'':'<rect width="'+T2+'" height="'+T2+'" fill="'+col+'" fill-opacity="'+alpha+'"/>')+(F.id==='gen'?genTile(F.g,T2,pbase2):patTile(F.id,T2,pbase2,F.po/100));
    fillCol='url(#gp)';
    patD='<defs><pattern id="gp" width="'+T2+'" height="'+T2+'" patternUnits="userSpaceOnUse">'+tile2+'</pattern></defs>'; }
  else fillOp=' fill-opacity="'+alpha+'"';
  var body='<path d="'+d+'" fill="'+fillCol+'"'+fillOp+(fw?' stroke="'+(LF.lc||frameInk(col))+'" stroke-width="'+LF.lw+'" stroke-opacity="'+(LF.lo/100)+'"':bright?' stroke="rgba(96,120,160,.26)" stroke-width="1.25"':'')+'/>';   /* 波浪档：fill 底色+stroke 框色同轮廓，bright 淡描边让位；框色透明度跟线框透明度滑杆（2026-11-16 批2 E7） */
  var g=side==='me'?'<g transform="translate('+sf(W)+' 0) scale(-1 1)"><g transform="translate('+SM+' '+SM+')">'+body+'</g></g>':'<g transform="translate('+SM+' '+SM+')">'+body+'</g>';
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+patD+g+'</svg>';
  b.style.setProperty('--shape','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');
  b.classList.add('shaped');
}
/* ---------- 气泡线框（2026-11-02：单线/虚线/波浪 + 粗细 + 颜色，两个角色独立） ---------- */
/* [位置:phone-bubble.js·frameInk] [装饰默认色：真正跟随气泡色相派生深/浅同色系] [2026-11-23：原来写死 #3d4660 或 #fff 导致「跟随气泡色」根本没跟气泡色走；改用气泡 HSL 同色相——亮泡加深加饱和，深泡提亮，纯灰兜底柔灰] [注释时间 2026-11-23] */
function frameInk(hex){
  var rgb=parseHex(hex); if(!rgb) return '#ffffff';
  var hsl=rgbToHsl(rgb.r,rgb.g,rgb.b);
  if(hsl.s<0.06) return hsl.l>0.65?'#64708a':'#e6ebf5';
  if(hsl.l>0.62) return hslToHex(hsl.h,Math.min(0.68,Math.max(0.28,hsl.s*1.25)),Math.max(0.36,hsl.l-0.28));
  return hslToHex(hsl.h,Math.min(0.65,Math.max(0.25,hsl.s*0.9)),Math.min(0.88,hsl.l+0.32));
}
/* [位置:phone-bubble.js·shade] [色阶加减] [hex 各通道 ±amt（clamp），格纹/条纹从气泡色派生亮暗两档带色用（11-02 参考底图工坊格纹：多层色带交织+交叉叠深+织纹）] [注释时间 2026-11-02] */
function shade(hex,amt){ var m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return hex||'#888888';
  var n=parseInt(m[1],16); function cl(x){ return Math.max(0,Math.min(255,Math.round(x))); }
  return '#'+((1<<24)+(cl((n>>16&255)+amt)<<16)+(cl((n>>8&255)+amt)<<8)+cl((n&255)+amt)).toString(16).slice(1); }
/* [位置:phone-bubble.js·rng] [确定性随机] [LCG：同 seed 出同一序列——波浪抖动必须"每次重画一模一样"（真随机的话 RO 每次触发波形都变=闪），seed 取气泡宽高这类稳定量] [注释时间 2026-11-03] */
function rng(seed){ var s=Math.abs(Math.round(seed))%2147483647; if(s<=0) s+=2147483646;
  return function(){ s=s*16807%2147483647; return (s-1)/2147483646; }; }
/* [位置:phone-bubble.js·lookLF] [线框档读取] [look 段的 side+Ls/Lw/Lc/Lo；与 lookBS 同款——P.lookV 优先、兜底走 lkRaw()（2026-11-14 收拢前是直读旧键 ph.look.v2；本文件比 phone-pages.js 先加载）；2026-11-16 批2 E7 加 lo=线框透明度（0~100，缺省 100=原样）] [注释时间 2026-11-02；2026-11-14 收拢；2026-11-16 批2 E7] */
function lookLF(side){ try{ if(P.lookV&&P.lookV[side+'Ls']!=null) return {ls:P.lookV[side+'Ls'],lw:+P.lookV[side+'Lw']||2,lc:P.lookV[side+'Lc']||'',ld:+P.lookV[side+'Ld']||50,lo:(P.lookV[side+'Lo']!=null)?+P.lookV[side+'Lo']:100};
  var j=lkRaw(); return j?{ls:j[side+'Ls']||'none',lw:+j[side+'Lw']||2,lc:j[side+'Lc']||'',ld:+j[side+'Ld']||50,lo:(j[side+'Lo']!=null)?+j[side+'Lo']:100}:{ls:'none',lw:2,lc:'',ld:50,lo:100}; }catch(e){ return {ls:'none',lw:2,lc:'',ld:50,lo:100}; } }
/* [位置:phone-bubble.js·waveSeg] [波形直线段] [把一段直线换成 n 个正弦半波（二次贝塞尔 Q，控制点交替 ±amp）；法向取顺时针路径右手法向（屏幕坐标系=恒朝外），波浪沿气泡轮廓外鼓内凹交替] [注释时间 2026-11-02] */
function waveSeg(x0,y0,x1,y1,amp,n){
  var dx=x1-x0, dy=y1-y0, len=Math.sqrt(dx*dx+dy*dy)||1, nx=dy/len, ny=-dx/len,   /* 右法向单位向量（顺时针路径=恒朝外）——2026-11-02 晚修：原 px=uy 直接拿段位移当法向（长度=段宽≈15），振幅被放大十几倍波浪炸出气泡外（截图实测） */
      sx=dx/n, sy=dy/n, out='', i;
  for(i=0;i<n;i++){ var sgn=i%2?-1:1;
    out+='Q'+sf(x0+sx*(i+.5)+nx*amp*sgn)+' '+sf(y0+sy*(i+.5)+ny*amp*sgn)+' '+sf(x0+sx*(i+1))+' '+sf(y0+sy*(i+1)); }
  return out; }
/* [位置:phone-bubble.js·framePath] [线框中心线 path] [与形状图同坐标系（SM=12 外扩），描边中心线内缩 lw/2 再留 0.2 防外半被 viewBox 裁掉；solid/dash=圆角矩形，wave=四边正弦波+四角圆弧（波数按边长/15px 取整，短边至少 2 波）] [注释时间 2026-11-02] */
function framePath(w,h,r,ls,lw,seed){
  var x0=SM+lw/2+.2, y0=SM+lw/2+.2, x1=w+SM-lw/2-.2, y1=h+SM-lw/2-.2;
  r=Math.max(4,Math.min((y1-y0)/2,(x1-x0)/2,r-lw/2));
  var corner='A'+sf(r)+' '+sf(r)+' 0 0 1 ';
  if(ls==='wave'){ var rand=rng(seed||7), amp=1.5+lw*.75, wT=x1-x0-2*r, hS=y1-y0-2*r;
    /* 2026-11-03：波更舒展（段距 15→22）、振幅基础加大（1.4+.55lw→1.5+.75lw）——密度太高显得机械 */
    var nT=Math.max(2,Math.round(wT/22)), nS=Math.max(2,Math.round(hS/22));
    return 'M'+sf(x0+r)+' '+sf(y0)+waveSeg(x0+r,y0,x1-r,y0,amp,nT,rand)+corner+sf(x1)+' '+sf(y0+r)
      +waveSeg(x1,y0+r,x1,y1-r,amp,nS,rand)+corner+sf(x1-r)+' '+sf(y1)
      +waveSeg(x1-r,y1,x0+r,y1,amp,nT,rand)+corner+sf(x0)+' '+sf(y1-r)
      +waveSeg(x0,y1-r,x0,y0+r,amp,nS,rand)+corner+sf(x0+r)+' '+sf(y0)+'Z'; }
  return 'M'+sf(x0+r)+' '+sf(y0)+'H'+sf(x1-r)+corner+sf(x1)+' '+sf(y0+r)+'V'+sf(y1-r)+corner+sf(x1-r)+' '+sf(y1)
    +'H'+sf(x0+r)+corner+sf(x0)+' '+sf(y1-r)+'V'+sf(y0+r)+corner+sf(x0+r)+' '+sf(y0)+'Z'; }
/* [位置:phone-bubble.js·drawFrame] [线框绘制] [11-05：线框必须跟气泡轮廓同形——之前线框走 framePath（统一圆角矩形 + SM 外扩画布），跟气泡本体（CSS 圆角 / 尾巴 / 波浪）各画各的：尾巴档线框没有尾巴、经典收角档线框不收角。现在线框与底色、图案共用 bubbleOutline 的同一条轮廓 path]
   画到 --fr、挂 .framed；CSS 端 def/sms=::before 单层、tailsvg=与 --shape 双层同伪元素。key=FVER+边+宽高+样式+粗细+颜色+尾巴位（FVER 只在颜色/圆角/线框参数变时 ++：气泡尺寸变化只失效自己的 key，别的气泡零成本）；颜色缺省=气泡字色（亮泡配深框 #3d4660、深泡配白框——同色系描边会隐形，截图实测；inkOf 同款 0.75 阈值、硬色值替代 var(--ink) 因为 stroke 要进 SVG）；三点小泡/na/极简不画] [注释时间 2026-11-02；2026-11-05 轮廓统一] */
var FVER=0;
function drawFrame(b){
  if(!b||b.nodeType!==1||!b.classList.contains('b')) return;
  if(b.closest('.tkmin')) return;
  if(b.classList.contains('na')) return;
  var side=b.classList.contains('me')?'me':'ai', F=lookLF(side), typing=b.classList.contains('typing');
  /* [2026-11-03 波浪档分流] tailsvg+wave：波浪已并入形状图（svgShape·fill+stroke 同轮廓、含尾巴），这里清残留不画框；def/sms+wave：底+框一体图（fill 气泡底色+stroke 框色同 path）挂 framed-wave（CSS 关本体矩形背景/阴影——否则波浪凹处露出直边底）] */
  if((F.ls==='none'||typing)||(lookBS(side)==='tailsvg'&&F.ls==='wave')){ if(b._frKey){ b._frKey=null; b.style.removeProperty('--fr'); b.classList.remove('framed'); b.classList.remove('framed-wave'); } return; }
  var w=b.offsetWidth, h=b.offsetHeight; if(!w||!h) return;
  var base=side==='me'?ST.me:eff('ai');
  var col=F.lc||frameInk(base);   /* 框色缺省=气泡字色：亮泡深框、深泡白框（frameInk，对比否则隐形）；底色恒为气泡色（波浪档 fill 用，不跟框色走） */
  var isWave=F.ls==='wave';
  var tail=!typing&&(b.classList.contains('tail')||isColLast(b));   /* 尾巴档：线框也要有尾巴 */
  var sms=lookBS(side)==='sms'?smsLink(b):0;
  var key=FVER+side+w+'x'+h+F.ls+F.lw+F.lc+'d'+F.ld+'o'+F.lo+(tail?'t':'')+(sms?'s'+sms:''); if(b._frKey===key) return; b._frKey=key;   /* key 带 lo/sms：透明度或连发位置变了要重画 */
  var W=w+SM*2, H=h+SM*2;
  var d=bubbleOutline(side,w,h,tail,isWave?'wave':'',F.lw,F.ld,sms);
  /* [2026-11-05 轮廓统一] me 侧整幅镜像（尾巴方向跟着翻），跟 svgShape 同一套处理 */
  var pathG=side==='me'?'<g transform="translate('+sf(W)+' 0) scale(-1 1)"><g transform="translate('+SM+' '+SM+')">':'<g transform="translate('+SM+' '+SM+')">';
  var pathE=side==='me'?'</g>':'';   /* [2026-11-10] me 侧 pathG 开了两层 <g>（镜像+SM 平移），原先只闭一层=非法 SVG，浏览器加载失败，「我的」线框（圆角矩形/波浪档）整个不显示；补上外层闭合 */
  if(isWave){
    /* 波浪档：底色+框一体（同一条轮廓），本体矩形背景/阴影由 CSS 关掉 */
    /* [2026-11-06 图案背景] 图案模式下波浪档只画框不填底色（底色交给图案层，否则会盖住图案的透明处） */
    var svg2='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+pathG+'<path d="'+d+'" fill="'+(lookBG(side)==='pat'?'none':base)+'" stroke="'+col+'" stroke-width="'+F.lw+'" stroke-opacity="'+(F.lo/100)+'"/></g>'+pathE+'</svg>';
    b.style.setProperty('--fr','url("data:image/svg+xml,'+encodeURIComponent(svg2)+'")');
    b.classList.add('framed'); b.classList.add('framed-wave');
    return; }
  b.classList.remove('framed-wave');
  var st=' stroke="'+col+'" stroke-width="'+F.lw+'" stroke-opacity="'+(F.lo/100)+'" fill="none"'+(F.ls==='dash'?' stroke-dasharray="'+sf(Math.max(1.5,5/ldK(F.ld)))+' '+sf(Math.max(1.2,4/ldK(F.ld)))+'"':'');
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+pathG+'<path d="'+d+'"'+st+'/></g>'+pathE+'</svg>';
  b.style.setProperty('--fr','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');
  b.classList.add('framed'); }
/* ---------- 气泡图案底纹（2026-11-02：圆点/爱心/星星等 10 种 + 密度 + 图案色，两个角色独立） ---------- */
var PVER=0, PAT_O=.4;   /* PVER：图案参数版本号（进 svgShape 与 --pat 两处 key，参数变才失效）；PAT_O：图案固定浓度（底纹要含蓄，比底色淡一档） */
/* [位置:phone-bubble.js·lookPF] [图案档读取] [look 段的 side+Pat/PatS/PatC；同 lookLF——P.lookV 优先、兜底走 lkRaw()（2026-11-14 收拢前直读旧键）] [注释时间 2026-11-02；2026-11-14 收拢] */
function lookPF(side){ try{ if(P.lookV&&P.lookV[side+'Pat']!=null) return {id:P.lookV[side+'Pat'],sz:Math.max(8,+P.lookV[side+'PatS']||16),lc:P.lookV[side+'PatC']||'',g:P.lookV[side+'PatG']||'',po:patOp(side)};
  var j=lkRaw(); return j?{id:j[side+'Pat']||'none',sz:Math.max(8,+j[side+'PatS']||16),lc:j[side+'PatC']||'',g:j[side+'PatG']||'',po:patOp(side)}:{id:'none',sz:16,lc:'',g:'',po:patOp(side)}; }catch(e){ return {id:'none',sz:16,lc:'',g:'',po:patOp(side)}; } }
/* [位置:phone-bubble.js·patOp] [旧 10 图案的浓度系数] [2026-11-05：旧 10 图案（圆点/爱心/星星…）的浓度写死在 patTile 的 PAT_O=.4，没有浓度滑杆。给它们补一个：look 段（原 ph.look.v2）的 aiPatO/mePatO（0~100，缺省 100=维持现状）。旧图案的浓度 = PAT_O × po；新 20 款的浓度在 gen 参数串的 op 字段里，各走各的但都是「图案透明度」，与气泡透明度完全分开] [注释时间 2026-11-05；2026-11-14 收拢改提法] */
function patOp(side){ var v=100;
  try{ if(P.lookV&&P.lookV[side+'PatO']!=null) v=+P.lookV[side+'PatO'];
    else{ var j=lkRaw(); if(j&&j[side+'PatO']!=null) v=+j[side+'PatO']; } }catch(e){}
  return Math.max(0,Math.min(100,v)); }
/* [位置:phone-bubble.js·patTile] [图案小块] [T×T tile 内容，无缝平铺：圆点/圆环/爱心/星星/闪星/猫爪/水滴/十字居中不出界（24 格 path 缩放 g24，色=frameInk(base)、浓度 PAT_O）；格纹=tartan 织物（2026-11-02 产品确定重做——参考底图工坊：亮暗两档色带横竖交织、半透明叠加交叉自动变深、色带上细密织纹线、窄深带贴 0 边跨缝出界由邻块补=无缝）；条纹=同色系宽窄双带斜纹] [注释时间 2026-11-02] */
function patTile(id,T,base,mul){
  var ink=frameInk(base), op=PAT_O*(mul==null?1:Math.max(0,Math.min(1,mul))), f=' fill="'+ink+'" fill-opacity="'+op+'"', st=' stroke="'+ink+'" stroke-opacity="'+op+'" fill="none"';
  function g24(d,w){ var k=T*w/24, tx=sf((T-24*k)/2); return '<g transform="translate('+tx+' '+tx+') scale('+sf(k)+')"><path d="'+d+'"'+f+'/></g>'; }
  if(id==='dot') return '<circle cx="'+sf(T/2)+'" cy="'+sf(T/2)+'" r="'+sf(T*.15)+'"'+f+'/>';
  if(id==='ring') return '<circle cx="'+sf(T/2)+'" cy="'+sf(T/2)+'" r="'+sf(T*.2)+'"'+st+' stroke-width="'+sf(T*.09)+'"/>';
  if(id==='heart') return g24('M12 21C8.4 17.5 4 13.6 4 9.6 4 7.1 6 5 8.5 5c1.5 0 2.8.8 3.5 2 .7-1.2 2-2 3.5-2C18 5 20 7.1 20 9.6c0 4-4.4 7.9-8 11.4z',.42);
  if(id==='star') return g24('M12 2l2.95 6.3 6.55.6-4.95 4.35 1.45 6.45L12 16.3l-6 3.4 1.45-6.45L2.5 8.9l6.55-.6z',.44);
  if(id==='sparkle') return g24('M12 0C13.2 7.5 16.5 10.8 24 12c-7.5 1.2-10.8 4.5-12 12-1.2-7.5-4.5-10.8-12-12 7.5-1.2 10.8-4.5 12-12z',.42);
  if(id==='paw'){ var k2=T*.46/24, t2=sf((T-24*k2)/2);
    return '<g transform="translate('+t2+' '+t2+') scale('+sf(k2)+')" fill="'+ink+'" fill-opacity="'+op+'"><ellipse cx="12" cy="15.8" rx="5" ry="3.9"/><circle cx="4.6" cy="10" r="2"/><circle cx="9.4" cy="7" r="2"/><circle cx="14.6" cy="7" r="2"/><circle cx="19.4" cy="10" r="2"/></g>'; }
  if(id==='drop') return g24('M12 2.5s6 6.8 6 10.9a6 6 0 0 1-12 0C6 9.3 12 2.5 12 2.5z',.4);
  if(id==='plus') return g24('M9.2 2h5.6v7.2H22v5.6h-7.2V22H9.2v-7.2H2V9.2h7.2z',.4);
  /* [位置:phone-bubble.js·patTile 格纹] [tartan 织物] [四层：亮宽带（横竖各一，居中 .44T，op .42）→ 深窄带（横竖各一，贴 0 边跨缝 .1T，op .5，交叉处半透明自然叠深）→ 织纹细线（亮带内叠暗色 1px 竖/横线、间距 T*.14，模拟经纬）] [注释时间 2026-11-02] */
  if(id==='grid'){ var hi=shade(base,26), lo=shade(base,-34), s='';
    var w1=T*.44, o1=(T-w1)/2, w2=T*.1, lines='', k;
    for(k=0;k<8;k++){ var lp=o1+w1*.08+k*(w1*.84/7);
      lines+='<rect x="'+sf(lp)+'" y="0" width="'+sf(T*.055)+'" height="'+T+'" fill="'+lo+'" fill-opacity=".14"/>';
      lines+='<rect x="0" y="'+sf(lp)+'" width="'+T+'" height="'+sf(T*.055)+'" fill="'+lo+'" fill-opacity=".14"/>'; }
    s+='<rect x="'+sf(o1)+'" y="0" width="'+sf(w1)+'" height="'+T+'" fill="'+hi+'" fill-opacity=".42"/>';
    s+='<rect x="0" y="'+sf(o1)+'" width="'+T+'" height="'+sf(w1)+'" fill="'+hi+'" fill-opacity=".42"/>';
    s+=lines;
    s+='<rect x="'+sf(-w2/2)+'" y="0" width="'+sf(w2)+'" height="'+T+'" fill="'+lo+'" fill-opacity=".5"/>';
    s+='<rect x="0" y="'+sf(-w2/2)+'" width="'+T+'" height="'+sf(w2)+'" fill="'+lo+'" fill-opacity=".5"/>';
    return s; }
  /* [位置:phone-bubble.js·patTile 条纹] [不规则竖向波浪线（2026-11-03：参考底图工坊「随机抖动」线条——粗波线、振幅抖动，原斜纹版她没看上）：tile 中央一条竖波（4 段 Q，振幅 .5~1.6 倍抖、起相随机、rng(7) 确定性），线宽=T*.2（参考图线宽:间距≈15:73=.2），线端在上下边中点且切线竖直=跨缝平滑无缝；色=frameInk 字色（参考图线条高对比）、浓度 .75（线条比底纹实）] [注释时间 2026-11-03] */
  if(id==='stripe'){ var rd=rng(7), w2=T*.2, n3=4, s3=rd()<.5?-1:1, d3='M'+sf(T*.5)+' 0';
    for(var i3=0;i3<n3;i3++){ var a3=T*.16*(0.5+rd()*1.1);
      d3+='Q'+sf(T*.5+a3*s3)+' '+sf(T*(i3+.5)/n3)+' '+sf(T*.5)+' '+sf(T*(i3+1)/n3); s3=-s3; }
    return '<path d="'+d3+'" stroke="'+ink+'" stroke-opacity=".75" stroke-width="'+sf(w2)+'" fill="none"/>'; }
  return ''; }
/* ---------- 成品底图 + 生成器（2026-11-05：20 款成品气泡底图，点一款就用，还能调颜色/大小/透明度/角度） ---------- */
/* [位置:phone-bubble.js·GEN_LIST] [成品底图 20 款] [11-05：不要「成品主题」，要成品气泡底图（淡粉彩的格纹/波点/爱心点那种）；点一款=载入它的参数，还能继续微调。字段＝款式id, 名字, 分组(格/点/线/图), 参数串, 默认 tile 边长px。参数串格式 g1|款式|角度|透明度|底色|色1,色2,色3|色带宽1,色带宽2,色带宽3——故意压成一个扁平短字符串（约 40 字），因为 routes/theme-sync.js·cleanFlat 只收扁平标量且字符串≤200 字，云同步才不用改后端] [注释时间 2026-11-05] */
var GEN_LIST=[
  ['ging','格纹','格','g2|ging|0|100|#fff5f8|#f48fb1,#f8bbd0|30,16',24],
  ['tart','苏格兰格','格','g2|tart|0|100|#f6fbf6|#4f9d7a,#c0695f,#2e7d5b|20,52,5',28],
  ['chk','棋盘','格','g2|chk|0|100|#fffbea|#f6d365|50',22],
  ['bwg','小蝴蝶结格','格','g2|bwg|0|100|#fffafb|#f48fb1,#f06292|16',24],
  ['dot','波点','点','g2|dot|0|100|#fff8ec|#e8a87c|0',22],
  ['odot','错位点','点','g2|odot|0|100|#eef5ff|#6fa0d8|0',22],
  ['strp','竖条纹','线','g2|strp|90|100|#f4fbf6|#8fc7a8|45',22],
  ['dstr','斜条纹','线','g2|dstr|45|100|#f7f3ff|#b39ddb|45',24],
  ['lace','荷叶边','线','g2|lace|0|100|#fff6f8|#e57b9b|0',22],
  ['hrt','爱心点','图','g2|hrt|0|100|#fff0f5|#f06292,#f8bbd0|0',26],
  ['clv','四叶草','图','g2|clv|0|100|#f5fbf3|#7fbf8e,#f4b6c2|0',26],
  ['str','星点','图','g2|str|0|100|#fffaf0|#f2c14e,#f7dc93|0',24],
  ['sak','樱花','图','g2|sak|0|100|#fff8fa|#f9c6d4,#e57b9b|0',26],
  ['bery','草莓','图','g2|bery|0|100|#fff6f2|#ef6f7e,#6bb26f|0',26],
  ['cld','云朵','图','g2|cld|0|100|#dbeaff|#ffffff|0',26],
  ['ber','小熊','图','g2|ber|0|100|#fff8f0|#e8c3a0,#8a5a3c|0',28],
  ['mon','月牙','图','g2|mon|0|100|#fff9ec|#f2c14e,#f7dc93|0',26],
  ['bow','蝴蝶结','图','g2|bow|0|100|#fff4f7|#f48fb1,#f8bbd0|0',26],
  ['bfy','蝴蝶','图','g2|bfy|0|100|#faf6ff|#b6a0e6,#8d76c9|0',32],
  ['love','Love','图','g2|love|0|100|#fff4f7|#ec7fa2,#f8bbd0|0',36]
];
/* [位置:phone-bubble.js·genParse/genStr] [参数串读写] [解析失败返回 null（老数据/坏串一律当没图案，不抛错）；写回时缺项补默认，保证串永远可解析] [注释时间 2026-11-05] */
function hexOk(v){ return /^#[0-9a-f]{6}$/i.test(String(v||'')); }
/* [位置:phone-bubble.js·genParse/genStr] [参数串读写 + 版本迁移] [格式 v2：g2|款式|角度|图案透明度|底色|色1,色2,色3|色带宽1,色带宽2,色带宽3。v1（g1）里第 4 段存的是「款式设计浓度」（不是用户滑杆值），读入时自动转成 v2：设计浓度搬进 STYLE_A 查表，op 置 100（=设计原样）。旧存档不会因为改了语义而图案变淡] [注释时间 2026-11-05] */
function genParse(str){
  var a=String(str||'').split('|'), d, v=a[0];
  if(v!=='g1'&&v!=='g2') return null;
  d={style:a[1]||'dot',ang:Math.round(+a[2])||0,op:Math.max(0,Math.min(100,Math.round(+a[3])||100)),bg:hexOk(a[4])?a[4]:'',cols:String(a[5]||'').split(',').filter(hexOk),ws:String(a[6]||'').split(',').map(function(x){ return Math.max(2,Math.min(96,Math.round(+x)||30)); })};
  /* v1 → v2：老串的 op 是设计浓度（34/55…），新版 op 是用户滑杆值。老串统一当 100（设计原样），设计浓度由 STYLE_A 决定 */
  if(v==='g1') d.op=100;
  d.ang=((d.ang%360)+360)%360;
  return d;
}
function genStr(d){ d=d||{}; return ['g2',d.style||'dot',Math.round(d.ang||0),Math.round(d.op==null?100:d.op),hexOk(d.bg)?d.bg:'',(d.cols||[]).filter(hexOk).join(','),(d.ws||[]).join(',')].join('|'); }
function genDef(id){ for(var i=0;i<GEN_LIST.length;i++) if(GEN_LIST[i][0]===id) return GEN_LIST[i]; return GEN_LIST[0]; }
/* 图标造型：坐标统一画在约 ±10 的框里（居中 0,0），外层再 translate/rotate/scale 摆到 tile 上 */
function icHrt(c,c2){ return '<path d="M0 7.4C-10.8-1.4-5.4-8.8 0-3.8 5.4-8.8 10.8-1.4 0 7.4Z" fill="'+c+'"/>'; }
function icClv(c,c2){ return '<g fill="'+c+'"><circle cx="0" cy="-5.4" r="4.3"/><circle cx="0" cy="5.4" r="4.3"/><circle cx="-5.4" cy="0" r="4.3"/><circle cx="5.4" cy="0" r="4.3"/></g><circle r="1.5" fill="'+c2+'"/>'; }
function icStr(c,c2){ return '<path d="M0 -9.2 2.47 -3.4 8.75 -2.84 3.99 1.3 5.41 7.44 0 4.2 -5.41 7.44 -3.99 1.3 -8.75 -2.84 -2.47 -3.4Z" fill="'+c+'"/>'; }
function icSak(c,c2){ var o='<g fill="'+c+'">',i; for(i=0;i<5;i++) o+='<circle cy="-5" r="3.9" transform="rotate('+(i*72)+')"/>'; return o+'</g><circle r="1.7" fill="'+c2+'"/>'; }
function icBer(c,c2){ return '<g fill="'+c+'"><circle cx="-6.1" cy="-5.4" r="3.5"/><circle cx="6.1" cy="-5.4" r="3.5"/><circle r="8.2"/></g><ellipse cy="2.8" rx="3.5" ry="2.7" fill="#fff" fill-opacity=".82"/><circle cy="1.7" r="1" fill="'+c2+'"/><circle cx="-3.1" cy="-1.4" r="1" fill="'+c2+'"/><circle cx="3.1" cy="-1.4" r="1" fill="'+c2+'"/>'; }
function icBow(c,c2){ return '<path d="M0 0-9-5.6Q-11 0-9 5.6Z" fill="'+c+'"/><path d="M0 0 9-5.6Q11 0 9 5.6Z" fill="'+c+'"/><circle r="2.5" fill="'+c2+'"/>'; }
function icBery(c,c2){ return '<path d="M0-5C8-6.6 10 3 0 9.6-10 3-8-6.6 0-5Z" fill="'+c+'"/><path d="M0-5-3.6-8.4 0-6.6 3.6-8.4Z" fill="'+c2+'"/>'; }
function icCld(c){ return '<g fill="'+c+'"><circle cx="-5.4" cy="1.6" r="4"/><circle cy="-1.8" r="5.4"/><circle cx="5.4" cy="1.6" r="4"/><rect x="-9.4" y="1.4" width="18.8" height="4.4" rx="2.2"/></g>'; }
function icBfy(c,c2){ return '<g fill="'+c+'"><ellipse cx="-5" cy="-3.2" rx="5.4" ry="3.9" transform="rotate(-24 -5 -3.2)"/><ellipse cx="5" cy="-3.2" rx="5.4" ry="3.9" transform="rotate(24 5 -3.2)"/><ellipse cx="-3.5" cy="3.6" rx="3.4" ry="2.7" transform="rotate(24 -3.5 3.6)"/><ellipse cx="3.5" cy="3.6" rx="3.4" ry="2.7" transform="rotate(-24 3.5 3.6)"/></g><path d="M0-7V5.4" stroke="'+c2+'" stroke-width="1.7" stroke-linecap="round"/><path d="M0-7-3.2-10M0-7 3.2-10" stroke="'+c2+'" stroke-width="1.3" fill="none" stroke-linecap="round"/>'; }
function icMon(c){ return '<path d="M1.8-8.8A8.8 8.8 0 1 0 8.8 3.6 6.9 6.9 0 1 1 1.8-8.8Z" fill="'+c+'"/>'; }
function icLove(c){ return '<text y="4.4" font-family="Georgia,Times New Roman,serif" font-style="italic" font-size="12" text-anchor="middle" fill="'+c+'">Love</text>'; }
var ICON={hrt:icHrt,clv:icClv,str:icStr,sak:icSak,ber:icBer,bow:icBow,bery:icBery,cld:icCld,bfy:icBfy,mon:icMon,love:icLove};
var IC_RE=/^(hrt|clv|str|sak|ber|bow|bery|cld|bfy|mon|love)$/;
/* [位置:phone-bubble.js·genTile] [成品底图 tile 绘制] [T×T 原地平铺，无缝靠「所有元素都按 T 周期重复」：色带类用贴 0 边的双份 rect/T，斜带用跨 3 个周期的平行四边形条（超出视口由 SVG 自己裁）；图标类把造型整个关在 tile 内，旋转在图形自己身上做所以任意角度都不破缝。角度只有 0/45/90 三档（11-05 拍板 A 案：任意角度要把图案画成气泡大小整张图，滚动/流式重画会闪）——其它值按 45 步就近归一] [注释时间 2026-11-05] */
/* [位置:phone-bubble.js·STYLE_A] [各款式设计浓度] [11-05：图案透明度滑杆 = 整层浓度（0~100），款式自身的元素 alpha 是「设计值」，两者相乘才是最终浓淡——滑杆调 0 就没有图案，调 100 就是设计原样。值取自 11-05 定稿时各款式的默认浓度] [注释时间 2026-11-05] */
var STYLE_A={ging:.34,tart:.24,chk:.38,bwg:.45,dot:.55,odot:.55,strp:.42,lace:.48,hrt:.46,clv:.46,str:.48,sak:.46,bery:.46,cld:.75,ber:.48,mon:.48,bow:.48,bfy:.46,love:.6};
function genTile(gen,T,base){
  var d=(typeof gen==='string')?genParse(gen):gen;
  if(!d) return '';
  T=Math.max(10,Math.min(64,+T||22));
  var sa=STYLE_A[d.style||'dot']!=null?STYLE_A[d.style||'dot']:.45, cols=d.cols.length?d.cols:[frameInk(base)];
  /* sa=款式设计浓度（元素 alpha，STYLE_A 表）；d.op=用户的「图案透明度」（整层 wrapper opacity）。两者相乘=最终浓淡，别混 */
  var c1=cols[0], c2=cols[1]||cols[0], c3=cols[2]||c2;
  var st=d.style||'dot', s='', i;
  if(st==='dstr') st='strp';   /* 斜条纹=条纹的 45° 版（11-05：两个都留，靠默认角度区分），画法同一套 */
  var q=Math.round(d.ang/45)%4; if(q<0) q+=4;
  var QA=[0,45,90,45][q];
  /* [2026-11-05 透明度解耦] 底色不在这层画实色：气泡底色 = 气泡颜色（受「气泡透明度」控制），图案 = 图案本身（受「图案透明度」控制），两个旋钮互不影响。以前这里画一层 70% 的浅底 rect 盖住气泡底色，气泡底色被冲淡 */
  if(d.bg) s+='<rect width="'+T+'" height="'+T+'" fill="'+d.bg+'"/>';   /* [2026-11-06：图案的底调＝图案自己的背景，铺满 100%；嫌重就拉「图案透明度」] */
  function V(o,w,c,k){ k=k==null?sa:k; return '<rect x="'+sf(o)+'" y="0" width="'+sf(w)+'" height="'+T+'" fill="'+c+'" fill-opacity="'+k+'"/><rect x="'+sf(o-T)+'" y="0" width="'+sf(w)+'" height="'+T+'" fill="'+c+'" fill-opacity="'+k+'"/>'; }
  function H(o,w,c,k){ k=k==null?sa:k; return '<rect x="0" y="'+sf(o)+'" width="'+T+'" height="'+sf(w)+'" fill="'+c+'" fill-opacity="'+k+'"/><rect x="0" y="'+sf(o-T)+'" width="'+T+'" height="'+sf(w)+'" fill="'+c+'" fill-opacity="'+k+'"/>'; }
  function D(o,w,c,sg,k){ k=k==null?sa:k; var out='',A0=-T,B0=2*T,p,m,oo;
    for(m=-1;m<2;m++){ oo=o+m*T;
      if(sg>0) p=[[A0,A0+oo],[B0,B0+oo],[B0,B0+oo+w],[A0,A0+oo+w]];
      else p=[[A0,oo-A0],[B0,oo-B0],[B0,oo+w-B0],[A0,oo+w-A0]];
      out+='<polygon points="'+p.map(function(z){ return sf(z[0])+','+sf(z[1]); }).join(' ')+'" fill="'+c+'" fill-opacity="'+k+'"/>'; }
    return out; }
  function ic(x,y,sc,fn,ca,cb){ return '<g transform="translate('+sf(x)+' '+sf(y)+') rotate('+d.ang+') scale('+sf(sc)+')" opacity="'+sa+'">'+fn(ca,cb)+'</g>'; }
  if(st==='ging'||st==='tart'||st==='strp'){
    var n=Math.max(1,cols.length);
    for(i=0;i<n;i++){ var o=i*T/n, w=Math.max(1,(d.ws[i]||30)/100*T), c=cols[i];
      if(st==='strp'){ s+= QA===45?D(o,w,c,1) : (QA===90? V(o,w,c) : H(o,w,c)); }
      else { s+= QA===45? D(o,w,c,1)+D(o,w,c,-1) : V(o,w,c)+H(o,w,c); } }
    if(st==='tart'){ var wa=Math.max(.8,T*.05);
      s+=V(T*.18,wa,c3,.62)+H(T*.18,wa,c3,.62)+V(T*.62,wa,c3,.4)+H(T*.62,wa,c3,.4); }
  } else if(st==='chk'){
    var h=T/2;
    if(QA===45){ s+=D(0,h,c1,1)+D(0,h,c1,-1); }
    else { s+='<rect x="0" y="0" width="'+sf(h)+'" height="'+sf(h)+'" fill="'+c1+'" fill-opacity="'+sa+'"/><rect x="'+sf(h)+'" y="'+sf(h)+'" width="'+sf(h)+'" height="'+sf(h)+'" fill="'+c1+'" fill-opacity="'+sa+'"/>'; }
  } else if(st==='bwg'){
    var bw=Math.max(1,T*.14);
    s+=V(0,bw,c1,.5)+H(0,bw,c1,.5)+V(T/2,bw,c1,.32)+H(T/2,bw,c1,.32)+ic(T/2,T/2,T*.027,icBow,c2,c2);
  } else if(st==='lace'){
    var step=T/2, yA=T*.64, yB=T*.3, amp=T*.24;
    for(i=-1;i<3;i++){ var x0=i*step;
      s+='<path d="M'+sf(x0)+' '+sf(yA)+'C'+sf(x0+step*.25)+' '+sf(yA+amp)+' '+sf(x0+step*.75)+' '+sf(yA+amp)+' '+sf(x0+step)+' '+sf(yA)+'" fill="none" stroke="'+c1+'" stroke-width="'+sf(Math.max(.9,T*.055))+'" stroke-opacity="'+sa+'" stroke-linecap="round"/>';
      s+='<path d="M'+sf(x0)+' '+sf(yB)+'C'+sf(x0+step*.25)+' '+sf(yB+amp*.78)+' '+sf(x0+step*.75)+' '+sf(yB+amp*.78)+' '+sf(x0+step)+' '+sf(yB)+'" fill="none" stroke="'+c1+'" stroke-width="'+sf(Math.max(.6,T*.028))+'" stroke-opacity="'+sf(sa*.72)+'" stroke-linecap="round"/>';
      s+='<circle cx="'+sf(x0+step*.5)+'" cy="'+sf(yA+amp*.44)+'" r="'+sf(Math.max(.7,T*.028))+'" fill="'+c1+'" fill-opacity="'+sa+'"/>'; }
  } else if(st==='odot'){
    [[0,0],[T,0],[0,T],[T,T],[T/2,T/2]].forEach(function(p){ s+='<circle cx="'+sf(p[0])+'" cy="'+sf(p[1])+'" r="'+sf(T*.14)+'" fill="'+c1+'" fill-opacity="'+sa+'"/>'; });
  } else if(st==='dot'){
    s+='<circle cx="'+sf(T/2)+'" cy="'+sf(T/2)+'" r="'+sf(T*.15)+'" fill="'+c1+'" fill-opacity="'+sa+'"/>';
  } else if(IC_RE.test(st)){
    if(st==='love'){ s+=ic(T/2,T/2,T*.018,icLove,c1,c2); }
    else { s+=ic(T*.32,T*.34,T*.028,ICON[st],c1,c2);
      if(cols.length>1) s+=ic(T*.74,T*.75,T*.017,ICON[st],c2,c1); }
  }
  /* [位置:phone-bubble.js·genTile 整体浓度] [整层包一层 opacity] [用户的「图案透明度」= 整层浓度，与气泡透明度（纯色底）完全分开——11-05：一个是纯色、一个是图案，两个旋钮不能串联。wrapper 在最外层，底调+花纹一起淡] [注释时间 2026-11-05] */
  return '<g opacity="'+Math.max(0,Math.min(1,(d.op==null?100:d.op)/100))+'">'+s+'</g>';
}
/* [位置:phone-bubble.js·patURI] [成品底图缩略图] [设置页网格用：同一份 genTile 画成 dataURI 当按钮背景，保证缩略图和真气泡图案是同一套代码，不会图不对版] [注释时间 2026-11-05] */
function patURI(gen,T){
  T=Math.max(10,Math.min(64,+T||22));
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+T+'" height="'+T+'" viewBox="0 0 '+T+' '+T+'">'+genTile(gen,T,'#ffffff')+'</svg>';
  return "url('data:image/svg+xml,"+encodeURIComponent(svg)+"')";   /* 单引号包 url()：缩略图要嵌进 style="background-image:…" 属性，双引号会把属性截断 */
}
/* [位置:phone-bubble.js·drawPat] [图案底纹绘制] [11-05 重做：①形状要跟气泡轮廓一致——气泡背景(底图)和气泡线框必须同形。之前图案是 CSS 平铺层（border-radius:inherit），而气泡本体是 CSS 圆角、线框是 SVG 描边、尾巴档又是另一套 path，三者各画各的：尾巴档图案不进尾巴、波浪档图案溢出波浪轮廓、经典收角档图案不收角。现在图案画成一整块 SVG：<pattern> 平铺底纹 + <path> 用气泡自己的轮廓 bubbleOutline 裁切，跟底色、线框三者同形。
   ②透明度解耦：图案浓度只由「图案透明度」决定（gen 参数串里的 op），不再乘气泡透明度——气泡透明度只管纯色底。图案层 SVG 里的底色垫底用 70% 铺色（让气泡自己的颜色透上来），所以纯色底的透明度变化仍能透出来，图案自身浓度独立。
   画到 --pat，挂 .patted；CSS 端 .b.patted::after 用 background-size 铺满（含 SM 外扩，尾巴不裁掉）] [注释时间 2026-11-05 重做] */
function drawPat(b){
  if(!b||b.nodeType!==1||!b.classList.contains('b')) return;
  if(b.closest('.tkmin')) return;
  if(b.classList.contains('na')) return;
  var side=b.classList.contains('me')?'me':'ai', F=lookPF(side), typing=b.classList.contains('typing');
  /* [2026-11-05] tailsvg 档的图案走形状 SVG 自己的 <pattern>（svgShape 里画），不占 ::after 层——两层伪元素同 z-index 时 ::after 会盖住 ::before 的线框，图案必须在同一张 SVG 里才能保证 fill→图案→线框 的正确层序。def/sms 档才用 ::after 这层。 */
  /* [位置:phone-bubble.js·drawPat] [背景二选一收口·实色不画图案] [2026-11-07 报「切回实色变不回去」：原来这里只看「有没有配图案」不看背景类型，实色模式下配过的图案层照样画、把实色底整个盖住。现在实色模式当无图案处理并清残留——图案配置本身不动，切回图案还能还原] [注释时间 2026-11-07] */
  if(F.id==='none'||typing||lookBS(side)==='tailsvg'||lookBG(side)!=='pat'){ if(b._patKey){ b._patKey=null; b.style.removeProperty('--pat'); b.style.removeProperty('--pat-sz'); b.classList.remove('patted'); } return; }
  var w=b.offsetWidth, h=b.offsetHeight; if(!w||!h) return;
  var pbase=F.lc||(side==='me'?ST.me:eff('ai'));   /* 图案底色：自定义图案色优先，否则气泡色（格纹/条纹从它派生亮暗带色；形状类内部再取 frameInk 字色） */
  var T=F.id==='gen'?Math.max(10,Math.min(44,F.sz)):(F.id==='stripe'?Math.min(44,Math.round(F.sz*1.5)):F.sz);
  var tail=!typing&&(b.classList.contains('tail')||isColLast(b));   /* 尾巴档：图案也要进尾巴 */
  var sms=lookBS(side)==='sms'?smsLink(b):0;
  var key=PVER+side+F.id+F.sz+F.lc+F.g+'o'+F.po+w+'x'+h+(tail?'t':'')+(sms?'s'+sms:''); if(b._patKey===key) return; b._patKey=key;
  /* [2026-11-06 图案背景] 图案自成背景：有自带底色就由它铺满（genTile 里不透明），没有就用气泡色垫一层 */
  var gg=F.id==='gen'?genParse(F.g):null, bcol=(side==='me'?ST.me:eff('ai'));
  var tile=((gg&&gg.bg)?'':'<rect width="'+T+'" height="'+T+'" fill="'+bcol+'"/>')+(F.id==='gen'?genTile(F.g,T,pbase):patTile(F.id,T,pbase,F.po/100));
  var W=w+SM*2, H=h+SM*2;
  /* 轮廓跟底色/线框同一条（bubbleOutline）；波浪线框档轮廓也是波浪的 */
  var LF=lookLF(side), d=bubbleOutline(side,w,h,tail,LF.ls==='wave'?'wave':'',LF.lw,LF.ld,sms);
  /* [2026-11-05 修] 之前这里多包了一层 </g>（g 变量自带闭合又在外面加了一个），SVG 结构不合法 → 整块图案不渲染。改成：外层一个 <g fill="url(#gp)"> 装 fill 引用，里面再套 transform 层装轮廓 path */
  var tf=side==='me'?'<g transform="translate('+sf(W)+' 0) scale(-1 1)">':'';
  var inner='<g transform="translate('+SM+' '+SM+')"><path d="'+d+'"/></g>';
  var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><defs><pattern id="gp" width="'+T+'" height="'+T+'" patternUnits="userSpaceOnUse">'+tile+'</pattern></defs><g fill="url(#gp)">'+tf+inner+(side==='me'?'</g>':'')+'</g></svg>';
  b.style.setProperty('--pat','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');
  b.style.setProperty('--pat-sz',W+'px '+H+'px');   /* 整块铺满（含 SM 外扩，尾巴不裁掉） */
  b.classList.add('patted'); }
/* [位置:phone-bubble.js·redraw] [形状+线框+图案一起画] [三个绘制函数各自 key 独立，都跑一遍成本=三次 key 比对] [注释时间 2026-11-02] */
function redraw(b){ var _s=b.classList.contains('me')?'me':'ai', _bs=lookBS(_s); if(b.getAttribute('data-bs')!==_bs) b.setAttribute('data-bs',_bs); drawPat(b); drawFrame(b); svgShape(b); }   /* [2026-11-06 形状分边] 形状档挂到气泡自己身上（data-bs），CSS 从 #device[data-bs] 改成 .b[data-bs]，两边各按自己的档出规则 */
/* [位置:phone-bubble.js·retail] [组内重标尾巴+整组重画] [组内增删后组尾会换人：与 phone-talk.js·render 标组尾同口径——.col 里最后一个非 na 的 .b 标 .tail；MutationObserver 回调是微任务异步派发，这里同步改完类，回调里按最终态判 key，不会闪] [注释时间 2026-11-02] */
function retail(col){ var bs=col.querySelectorAll('.b');
  Array.prototype.forEach.call(bs,function(x){ x.classList.remove('tail'); });
  for(var j=bs.length-1;j>=0;j--){ if(!bs[j].classList.contains('na')){ bs[j].classList.add('tail'); break; } }
  Array.prototype.forEach.call(bs,redraw); }
/* [位置:phone-bubble.js·bubbleRO] [气泡尺寸监听] [流式打字气泡渐高、换行时 RO 触发重画；key 缓存保证同尺寸不重复换图] [注释时间 2026-11-02] */
var bubbleRO=window.ResizeObserver?new ResizeObserver(function(es){ es.forEach(function(e){ redraw(e.target); }); }):null;
function adoptB(b){ if(!b||b.nodeType!==1||!b.classList.contains('b')) return; if(b.closest('.tkmin')) return; if(bubbleRO) bubbleRO.observe(b); redraw(b); }

P.bubble={
  DEF:DEF,
  refresh:function(){ applyVars(); },
  get:function(){ return Object.assign({},ST); },
  /* 改一项就存起来，并把屏幕上所有气泡重画一遍 */
  /* [位置:phone-bubble.js·onChange] [外观变更通知] [聊天页开着时（宽屏左配置右聊天）改背景，外观变更时通知订阅方（原聊天页 .tk-bgfix 垫层用，10-30 已撤掉，接口保留）] [注释时间 2026-10-30] */
  set:function(o){
    Object.assign(ST,o||{}); if(!drafting()){ try{ P.chatTheme.save({bubble:ST}); }catch(e){} if(P.themeSync) P.themeSync.touch(); }   /* [2026-11-05 草稿期间（月夜玻璃子页开着）只改内存与样式，点保存才落盘：见 flush] [2026-11-14 收拢] 落盘改走统一存储（整键重写，bgimg 大字符串跟着一起落） */
    SVER++; FVER++; PVER++; applyVars();
    var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,redraw);   /* 颜色/圆角进了形状图与线框，改了要整量重画（含设置页预览） */
    for(var i=0;i<cbs.length;i++){ try{ cbs[i](); }catch(e){} }
  },
  onChange:function(f){ if(f&&cbs.indexOf(f)<0) cbs.push(f); },
  BG:BG,
  /* [位置:phone-bubble.js·palOf] [背景预设的配套气泡色] [选背景时 phone-pages.js·bgPick 取来一起设；空串=默认色；自己的照片/未知返回 null=不动] [注释时间 2026-10-30；10-31 改指 bgPick] */
  palOf:function(k){ if(k==='') return {me:DEF.me,ai:DEF.ai}; return BG[k]&&BG[k][2]?{me:BG[k][2].me,ai:BG[k][2].ai}:null; },
  /* [位置:phone-bubble.js·bsOf] [背景预设的配套形状档] [批5 E3：BG 表某款 [2] 里显式配了 bs（def/sms/hsq/tailsvg）才返回该档，没配返回 null＝切背景不碰形状（用户自己调的形状档保留，不能因为换背景被打回默认）。phone-pages.js·bgPick 取来一起设；配了档的背景切过去形状跟着换（用户当初报的「切背景形状没跟着变」就是给配了档的背景准备的）。11-17 产品确定搭配表先全不配（四款四样被她否了，该她定），要配就在该款 [2] 加 bs:'档名' 一处即可] [注释时间 2026-11-17] */
  bsOf:function(k){ var o=BG[k]&&BG[k][2], b=o&&o.bs; return (b==='def'||b==='sms'||b==='hsq'||b==='tailsvg')?b:null; },
  /* 自己的照片当背景：调用方（sticker-cropper 裁剪输出，原 phone-pages.js shrink 已删）已缩到长边 1280 的 JPEG；优先传服务器存 URL，传不上才存 dataURL，太大存不下就报错 */
  setBgImage:function(url){
    if(!drafting()){ try{ P.chatTheme.bgimgSet(url); }catch(e){ throw new Error('照片太大，存不下'); } }   /* [2026-11-14 收拢] 背景照片写统一存储 bgimg 段，配额不足照旧报「照片太大」 */
    imgCache=url; P.bubble.set({bg:'img'});
  },
  hasBgImage:function(){ return !!bgImg(); },
  /* [位置:phone-bubble.js·bgImage/flush/loadSaved/reload] [草稿与云同步用的存取口] [2026-11-05：月夜玻璃子页改成「点保存才落盘」，草稿期间 set/setBgImage 只改内存；flush=把内存整份写进本机（点保存时调）；loadSaved=丢掉草稿、从本机已保存的重新读（点「不保存」/异常关页时调）；reload(o,img)=云端拉下来的配置直接换进内存并重画（不落盘，调用方已写好本机存储）；bgImage=当前背景照片地址。2026-11-14 收拢：flush 合并成一次整键写（bubble+bgimg），原来 KEY 写失败吞掉、IMG 写失败才抛——现在整键写失败就抛「照片太大，存不下」，调用方（主题子页 saveLocal）本来就接这个错，行为只严不松] [注释时间 2026-11-05；2026-11-14 收拢] */
  bgImage:function(){ return bgImg(); },
  flush:function(){ var u=bgImg(); try{ P.chatTheme.save({bubble:ST,bgimg:u||''}); }catch(e){ throw new Error('照片太大，存不下'); } },
  reload:function(o,img){ ST=normST(o); if(img!==undefined) imgCache=img||''; SVER++; FVER++; PVER++; applyVars(); var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,redraw); for(var i=0;i<cbs.length;i++){ try{ cbs[i](); }catch(e){} } },
  loadSaved:function(){ var j=null,u=''; try{ var o=P.chatTheme.read(); if(o){ j=o.bubble; u=String(o.bgimg||''); } }catch(e){} P.bubble.reload(j,u); },   /* [2026-11-14 收拢] 从统一存储读已保存的 bubble+bgimg */
  reset:function(){ ST=Object.assign({},DEF); try{ P.chatTheme.save({bubble:{},bgimg:''}); localStorage.removeItem('ph.bubble.v1'); localStorage.removeItem('ph.chatbg.img'); }catch(e){} imgCache=''; SVER++; FVER++; PVER++; applyVars(); var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,redraw); },   /* [2026-11-14 收拢] bubble/bgimg 两段清空回缺省，旧散键一并删掉防迁移复活（style/cn/en 不动，与原版一致） */
  /* [位置:phone-bubble.js·watch] [聊天页气泡接管] [phone-talk.js·render 渲染完列表后调一次：现有气泡全部 adopt，MutationObserver 盯子树——新气泡 adopt；组内增删（分气泡开关、撤回）时把同组 .col 的气泡全部重 shape（key 里的组尾位变了才真重画）] [注释时间 2026-11-02] */
  watch:function(list){
    if(!list||list._bsWatch) return; list._bsWatch=1;
    Array.prototype.forEach.call(list.querySelectorAll('.b'),adoptB);
    /* [2026-11-02 加固] 首轮 adopt 后下一帧再全量一遍：列表刚插入、字体未落时量到 0 尺寸的气泡，这时补画（RO 只对后续变化负责） */
    var raf=window.requestAnimationFrame||function(f){ setTimeout(f,16); };
    raf(function(){ if(list.isConnected) Array.prototype.forEach.call(list.querySelectorAll('.b'),redraw); });
    if(!window.MutationObserver) return;
    new MutationObserver(function(ms){ ms.forEach(function(m){
      if(m.type==='childList'){
        /* 新增节点可能是 .b 本体（直播流式逐条插）也可能是整组 .tk-g（全量渲染）——容器要往里挖一层 */
        Array.prototype.forEach.call(m.addedNodes,function(n){ if(!n||n.nodeType!==1) return;
          if(n.classList&&n.classList.contains('b')) adoptB(n);
          else Array.prototype.forEach.call(n.querySelectorAll('.b'),adoptB); });
        var col=(m.target.nodeType===1&&m.target.closest)?m.target.closest('.col,.lk-ms'):null;
        if(col) retail(col);
      } else if(m.target.classList&&m.target.classList.contains('b')) redraw(m.target);
    }); }).observe(list,{childList:true,attributes:true,attributeFilter:['class'],subtree:true});
  },
  /* [位置:phone-bubble.js·lookBS] [形状档判定出口] [phone-talk.js·bsHold 要按当前档分流输出方式（SVG尾档=三点憋到收尾），判定逻辑收拢在本文件一份，talk 侧经 P.bubble.lookBS 调] [注释时间 2026-11-02] */
  lookBS:lookBS, lookBG:lookBG,
  /* [位置:phone-bubble.js·P.bubble.lookAlphaChanged] [气泡透明度变了要重画] [2026-11-05：尾巴档底色的 alpha 烘在形状 SVG 里（fill-opacity），CSS 变量改了不会自动重画 SVG，所以透明度滑杆变化时要显式重画。def/sms 档底色走 CSS color-mix 不用重画，但重画也无害（key 不变就零成本）] [注释时间 2026-11-05] */
  lookAlphaChanged:function(){ var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,function(b){ b._shapeKey=null; svgShape(b); }); },
  /* [位置:phone-bubble.js·P.bubble 底图接口] [成品底图给设置页用] [GEN=20 款清单、genParse/genStr=参数串读写、genDef=按 id 取默认、genTile/patURI=画 tile 与缩略图；设置页只经这里拿，不自己拼 SVG] [注释时间 2026-11-05] */
  GEN:GEN_LIST, genParse:genParse, genStr:genStr, genDef:genDef, genTile:genTile, patURI:patURI, IC_RE:IC_RE,
  /* [位置:phone-bubble.js·lookChanged] [形状档切换重画] [设置里换了气泡样式档（ph.look.v2·bs）：开的页与预览全部按新档重画/清理] [注释时间 2026-11-02] */
  lookChanged:function(){ SVER++; FVER++; PVER++; var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,redraw); },
  /* [位置:phone-bubble.js·lookFrameChanged] [线框参数变更重画] [设置页拖线宽/换样式只走这条：FVER++ 全量 drawFrame（形状图 key 不含 FVER，零重画），拖动实时不卡] [注释时间 2026-11-02] */
  lookFrameChanged:function(){ FVER++; var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,drawFrame); },
  /* [位置:phone-bubble.js·lookPatChanged] [图案参数变更重画] [密度/样式/颜色：PVER++ 全量 redraw——def 档 --pat key 含 PVER、tailsvg 形状图 key 含 PVER+图案参数，都失效重画；线框 key 不含 PVER 零成本] [注释时间 2026-11-02] */
  lookPatChanged:function(){ PVER++; applyVars(); var all=document.querySelectorAll('.b'); Array.prototype.forEach.call(all,redraw); },
  /* [位置:phone-bubble.js·pvShape] [设置页预览气泡绘制] [预览不在聊天页 watch 里（子页随时重渲染），外观页 paint 时手动跑一遍] [注释时间 2026-11-02] */
  pvShape:function(host){ if(host) Array.prototype.forEach.call(host.querySelectorAll('.lk-pv .b'),redraw); }
};
})();
