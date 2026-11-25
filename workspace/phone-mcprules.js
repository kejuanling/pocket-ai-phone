/* [位置:phone-mcprules.js·工具规则（前端侧）] [编辑一份工具规则 + 算开关显示状态，预设编辑页与会话 MCP 弹层共用一份实现] [10-27：预设存规则不存清单；规则形状与后端 lib/mcp-rules.js 完全一致：
   { v:1, rest:'global'|'off', servers:{ <服务器id>:{ def:'on'|'off', except:[工具名] } } }；def='on' = 该服务器工具默认全开、except 是关掉的（新增工具自动开），def='off' = 默认全关、except 是点名开的；
   没写规则的服务器（以后新加的）按 rest：global 跟它的全局开关、off 一律关。全局黑名单工具（blocked）对「默认开」是硬挡。] [注释时间 2026-10-27]
   这里只做「编辑 + 显示」；真正决定 AI 拿到哪些工具的是服务端（toolOn 与后端 toolVisible 同语义，tests/mcp-rules 有随机对照）。
   服务器对象：{ id, enabled_global, probed, tools:[{ key, name, dis(服务端已停用), blocked(全局黑名单) }] } */
(function(){
"use strict";
var P=window.PH; if(!P) return;
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function has(arr,n){ return arr.indexOf(n)>=0; }

/* 某个工具现在开不开（规则为 null 表示「还没有规则」，一律按关处理，调用方应先用 fromGlobal 打底） */
function toolOn(rules,srv,t){
  if(t.dis||!rules) return false;
  var sr=rules.servers&&rules.servers[srv.id];
  if(sr){ var inEx=has(sr.except||[],t.name); return sr.def==='on'?(!inEx&&!t.blocked):inEx; }
  return rules.rest==='global'&&srv.enabled_global!==false&&!t.blocked;
}
/* 「工具: n/m」：分母含停用工具（与聊天页弹层、全局工具页同口径，16/18） */
function count(rules,srv){ var n=0; (srv.tools||[]).forEach(function(t){ if(toolOn(rules,srv,t)) n++; }); return {n:n,tot:(srv.tools||[]).length}; }
/* 全局现状打底：全局开着的服务器 = 默认开，停用的 = 默认关；以后新服务器跟全局 */
function fromGlobal(servers){ var r={v:1,rest:'global',servers:{}}; servers.forEach(function(s){ r.servers[s.id]={def:s.enabled_global!==false?'on':'off',except:[]}; }); return r; }
/* 旧预设（只有 mcps 勾选清单 + mcp_seen）换算：见过的工具全勾了 = 整组默认开，否则点名开（服务端迁移脚本做同样的事，这里给没迁移的预设兜底） */
function fromPreset(p,servers){
  var on={}, seen={}, r={v:1,rest:'global',servers:{}};
  (p.mcps||[]).forEach(function(k){ on[k]=1; seen[k]=1; });
  (p.mcp_seen||[]).forEach(function(k){ seen[k]=1; });
  servers.forEach(function(s){
    var pre=s.id+'::', onN=[], seenN=[];
    Object.keys(on).forEach(function(k){ if(k.indexOf(pre)===0) onN.push(k.slice(pre.length)); });
    Object.keys(seen).forEach(function(k){ if(k.indexOf(pre)===0) seenN.push(k.slice(pre.length)); });
    var all=onN.length>0&&seenN.every(function(n){ return on[pre+n]; });
    r.servers[s.id]=all?{def:'on',except:[]}:{def:'off',except:onN};
  });
  return r;
}
/* 整组开关：开 = 默认开（以后新增的工具自动进），关 = 默认关 */
function setServer(rules,srv,on){ var r=clone(rules); r.servers[srv.id]={def:on?'on':'off',except:[]}; return r; }
/* 单个工具开关：整组默认不变，只改例外；遇到「默认开 + 要点名开一个被全局禁用的工具」这种默认开表示不了的，改用默认关 + 点名 */
function setTool(rules,srv,tool,on){
  var r=clone(rules), known=(srv.tools||[]).filter(function(t){ return !t.dis; }), want={};
  known.forEach(function(t){ want[t.name]=toolOn(rules,srv,t); });
  want[tool.name]=!!on;
  var sr=r.servers[srv.id], def=sr?sr.def:((r.rest==='global'&&srv.enabled_global!==false)?'on':'off');
  if(def==='on'&&known.some(function(t){ return want[t.name]&&t.blocked; })) def='off';
  r.servers[srv.id]={def:def,except:known.filter(function(t){ return def==='on'?!want[t.name]:want[t.name]; }).map(function(t){ return t.name; })};
  return r;
}
/* 保存前清掉例外里已经不存在的工具名（只处理已经探测到工具清单的服务器） */
function prune(rules,servers){
  var r=clone(rules);
  servers.forEach(function(s){ var sr=r.servers[s.id]; if(!sr||!s.probed||!(s.tools||[]).length) return;
    var names={}; s.tools.forEach(function(t){ names[t.name]=1; }); sr.except=(sr.except||[]).filter(function(n){ return names[n]; }); });
  return r;
}
P.mcpr={toolOn:toolOn,count:count,fromGlobal:fromGlobal,fromPreset:fromPreset,setServer:setServer,setTool:setTool,prune:prune};
if(typeof module!=='undefined'&&module.exports) module.exports=P.mcpr;
})();
