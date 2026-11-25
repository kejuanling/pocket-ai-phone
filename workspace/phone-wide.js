/* [位置:phone-wide.js·文件头] [宽屏（iPad/电脑）双栏工作台] [10-28：参考微信 iPad——左栏是会话/我的/配置/应用四个标签，右栏放聊天或点开的页面；窗口 ≥760px 宽时 html 带 wide 类（phone-new.html 头部那段脚本），这里只在宽屏生效，手机一行都不跑] [注释时间 2026-10-28]
   做法：聊天 app 窗口当永久左栏；聊天层（.win.tk-layer）、应用窗口（.win）、「我的/配置」的子页（.pg-sub）都靠 CSS 定位到右栏（phone-wide.css）；
   这里负责：①开机直接建工作台（跳过锁屏）②右栏同一时间只放一样东西（互相顶替）③右栏空时的占位 ④左栏高亮当前聊天 ⑤窗口缩回手机宽度时刷新回手机版。 */
(function(){
"use strict";
var P=window.PH, root=document.documentElement;
if(!P||!P.D||!root.classList.contains('wide')) return;
var D=P.D, mq=window.matchMedia('(min-width:760px)');
P.wide={on:true};

/* ⑤ 拖窄到手机宽度：直接刷新成手机版（两套布局不在线切换，省得状态错乱） */
function narrow(){ if(!mq.matches) location.reload(); }
if(mq.addEventListener) mq.addEventListener('change',narrow); else if(mq.addListener) mq.addListener(narrow);

/* ① 工作台 = 聊天 app 窗口，不走 openApp（不要放大动画，也不当成「当前打开的应用」） */
var app=P.app('chats'); if(!app) return;
var win=document.createElement('div'); win.className='win wd-ws'; win.dataset.win='chats'; win.innerHTML=app.html(); D.appendChild(win);
if(P.markAv) P.markAv();
try{ app.setup(win); }catch(err){ console.error(err); }
var content=win.querySelector('.content');
var em=document.createElement('div'); em.className='wd-empty';
em.innerHTML='<div><div class="wd-mk"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg></div><span>选一个会话开始聊天</span></div>';
content.appendChild(em);

function isChat(n){ return n.nodeType===1&&n.classList.contains('win')&&n.classList.contains('tk-layer'); }
function isApp(n){ return n.nodeType===1&&n.classList.contains('win')&&!n.classList.contains('wd-ws')&&!n.classList.contains('tk-layer'); }
function isSub(n){ return n.nodeType===1&&n.classList.contains('pg-sub'); }
function clickBack(el,sel){ var b=el.querySelector(sel); if(b) b.click(); else el.remove(); }

/* ② 右栏只放一样：新进来的顶掉别的（点各自的返回键走它们自己的收尾；聊天→聊天的替换在 phone-chats.js pushTalk） */
function closeOthers(keep){
  if(keep!=='chat') Array.prototype.forEach.call(D.querySelectorAll('.win.tk-layer'),function(t){ clickBack(t,'.back'); });
  if(keep!=='app') Array.prototype.forEach.call(D.querySelectorAll('.win:not(.wd-ws):not(.tk-layer)'),function(a){ clickBack(a,'.back'); });
  if(keep!=='sub') Array.prototype.forEach.call(content.querySelectorAll('.pg-sub'),function(s){ clickBack(s,'[data-x="back"]'); });
}
/* ③④ 占位与高亮 */
function sync(){
  var chat=D.querySelector('.win.tk-layer'), has=!!chat||!!D.querySelector('.win:not(.wd-ws):not(.tk-layer)')||!!content.querySelector('.pg-sub');
  win.classList.toggle('wd-has',has);
  var id=chat&&P.talkCtx&&P.talkCtx.id||'';
  Array.prototype.forEach.call(win.querySelectorAll('#csLs .cs-it'),function(r){ r.classList.toggle('cs-sel',!!id&&r.getAttribute('data-id')===id); });
}
function onMut(muts){
  muts.forEach(function(m){ Array.prototype.forEach.call(m.addedNodes,function(n){
    if(isChat(n)) closeOthers('chat'); else if(isApp(n)) closeOthers('app'); else if(isSub(n)) closeOthers('sub'); }); });
  sync();
}
new MutationObserver(onMut).observe(D,{childList:true});
new MutationObserver(onMut).observe(content,{childList:true});
var ls=win.querySelector('#csLs'); if(ls) new MutationObserver(sync).observe(ls,{childList:true});
sync();
})();
