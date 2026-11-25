/* 小手机 · 草稿自动缓存：聊天输入框、写日记/记一笔等弹层里没发出去的字，关掉再开还在。 */
(function(){
"use strict";
var P=window.PH; if(!P) return;
var D=P.D, PRE='ph.draft.v1:', TTL=7*864e5;
function get(k){ try{ var o=JSON.parse(localStorage.getItem(PRE+k)||'null'); if(o&&Date.now()-o.t<TTL) return o.v; }catch(e){} return ''; }
function put(k,v){ try{ if(v) localStorage.setItem(PRE+k,JSON.stringify({v:v,t:Date.now()})); else localStorage.removeItem(PRE+k); }catch(e){} }
function keyOf(ta){
  if(ta.id==='ta') return 'chat';
  var sh=ta.closest&&ta.closest('.sheetw'); if(!sh) return '';
  var t=sh.querySelector('.sh-t'); return 'sheet:'+(t?t.textContent:'');
}
function fire(ta){ try{ ta.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){} }
function track(ta){
  if(ta.__ph) return; ta.__ph=1;
  var k=keyOf(ta); if(!k) return;
  /* 稍等一下：有些弹层会自己预填内容（比如「修改推送」），预填了就不恢复草稿 */
  setTimeout(function(){ if(!ta.value){ var v=get(k); if(v){ ta.value=v; fire(ta); } } last=ta.value; },120);
  var last='', iv=setInterval(function(){
    if(!ta.isConnected){ clearInterval(iv); return; }
    if(ta.value!==last){ last=ta.value; if(!(k.indexOf('sheet:')===0&&!sheetDirty(ta))) put(k,last); }
  },700);
  ta.addEventListener('blur',function(){ if(ta.value!==last){ last=ta.value; put(k,last); } });
  /* 点「保存/发送」成功后清掉草稿；失败（比如金额没写对、内容为空）会保留 */
  var sh=ta.closest('.sheetw');
  if(sh){ var b=sh.querySelector('.sh-btn'); if(b) b.addEventListener('click',function(){ var v=ta.value.trim(); setTimeout(function(){ if(v&&!document.body.contains(sh)||v&&!sh.classList.contains('show')){ put(k,''); last=''; } },400); },true); }
}
/* 预填内容的弹层（修改类）不写草稿，避免把原文当草稿存起来 */
function sheetDirty(ta){ return !ta.hasAttribute('data-prefill'); }
new MutationObserver(function(ms){
  ms.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n.nodeType!==1) return;
    if(n.tagName==='TEXTAREA') track(n); else if(n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll('textarea'),track); }); });
}).observe(D,{childList:true,subtree:true});
/* 聊天发送后输入框被清空：下一次轮询会把草稿一并清掉（空值即删除） */
addEventListener('pagehide',function(){ Array.prototype.forEach.call(D.querySelectorAll('textarea'),function(ta){ var k=keyOf(ta); if(k&&ta.value) put(k,ta.value); }); });
})();
