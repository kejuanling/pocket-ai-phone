/* phone-sheetdrag.js —— 底部抽屉/底板顶部可拖
   [位置:phone-sheetdrag.js·P.sheetDrag] [所有底部抽屉共用的拖动 + 上拉拉高]
   [pane 当抽屉面板；close 是关闭函数；顶部 64px 或 .grab/.sh/.dh 可按住拖；按钮/输入框不触发]
   [2026-10-27（抽屉是全局一个组件，能往上拉高，拉高时内容可视高度也一起变高）：
    传 opts.stretch={natural:true} 就走「拉高」分支，不传走老逻辑（一个字没动）。
    原来每帧写 height 等于每帧整块重排（几十条工具记录 + 40px 模糊阴影全要重画），不可能 60fps；
    改成拖动期间只改 transform（合成层，不重排），抽屉 height 固定为最高档，
    松手收尾时一次性切回真实 height 也没有跳变。全程只重排两次（起手、落位）。]
   2026-10-28（抽屉统一三档）：natural:true 时最低档=内容自然高度（短内容不硬撑，起手重测）；
    滚动守卫：起点在滚动区里且没滚到顶时不抢手势——先滚内容，到顶再拖才是拉抽屉；
    抽屉高于自然档时给 pane 加 dw-fit 类，CSS（phone-talk.css 末尾）把里面列表/预览盒子的写死上限放开。
   2026-10-31（不用那么多档，拉高到满高一档就行；也不用记住上一次档，多余设计）：
    ①两档化：不显式传 levels 就只有「自然高度 ⇄ 满高」两个状态（矮抽屉不该接拉高；chats 三抽屉暂显式传三档，另案）；
    ②删档位记忆（ph_dw_* 不再读写）——顺手修掉「记住高档后开/关动画被压死」的 bug：
      原来初始化 settle 往面板写内联 transition:none 且不再清掉，CSS 的开合过渡全被它压死
      （表现为平时拖拽正常、开抽屉瞬移、点空白关闭骤消，时有时无——只有上次停在高档才复现）；
    ③resize 重算后补一次 rAF 还原内联 transition，不再留 'none'（同类污染的第二个入口）；
      resize 在自然态（没拖过）直接跳过——钉高状态下 scrollHeight 量出来是面板自身高度不是内容高，不能用；
    ④删 settle 死代码（anim 分支从没人调用）；起手先摘上一轮收尾定时器，防止刚拖完马上再拖时被旧定时器改高度；
    ⑤甩关不清 height（清了面板先弹回自然高再滑下去，肉眼可见跳一下），transform 交还给 CSS 关闭曲线，
      从当前拖拽位置直接滑走；
    ⑥curLv 只记在内存（不落盘）：从满高档起手不再被重算成自然高（否则面板当场跳一下）；
      natH 只在「未钉高」时重测：钉高时 scrollHeight 是满高值，拿它当自然高会污染 minPx/atMin，
      从满高往下拖会被误判成「已在最低档还往下甩」直接关掉；
    ⑦回自然档：height 交还 CSS（内容后来变高也能跟着长），清完 height 再量 hNow、用反向位移补住视觉再归零
      （先量再清会量到钉死值，补偿恒 0，回自然档瞬跳）。
    处理器抽成具名函数并挂 pane._sdTest（仅 window.__sdTestExpose 时），供回归取证页直接驱动，不经事件管线。
   接入：MCP/sub（talk sheet）、思考工具抽屉（tk-dw）、配置页 pg-sheet、日记发表器（带图时）；chats 新建/搜索/改名（三档，先不动）。
   [注释时间 2026-10-21；2026-10-27 加拉高档位；2026-10-27 改 transform 驱动；2026-10-28 三档化、dw-fit 内容跟高；2026-10-31 两档化、去记忆、修动画污染] */
(function(){
  var P=window.PH||window.P||(window.PH={}); window.PH=window.PH||P;
  var DUR_UP=.28;                                  /* 落位动画时长（原来 .34，重点丝滑不是拖沓） */
  var EASE='cubic-bezier(.22,1,.36,1)';
  var TF_SPRING='transform '+DUR_UP+'s '+EASE;
  function buzz(n){ try{ navigator.vibrate&&navigator.vibrate(n); }catch(_){} }
  function sheetDrag(pane,close,opts){
    if(!pane||pane._sd) return; pane._sd=1;
    /* [位置:phone-sheetdrag.js·sheetDrag 矮抽屉不拉高] [内容矮的抽屉只能往下拖关，不能拉高] [11-03：「改这条推送」「白天是」这类很矮的抽屉不需要能拉到满档，估计还有一堆。统一在这里按内容高度自动判：拖动起手时量——抽屉已被拉高钉住 / 抽屉高度超过容器 62% / 里面的滚动区有内容被裁 → 算「长」，走拉高逻辑；否则算「矮」，走老逻辑（只往下拖关闭，往上只有橡皮筋）。调用方一个字不用改；opts.stretch.always=true 可强制一直能拉高] [注释时间 2026-11-03] */
    if(opts&&opts.stretch){
      if(opts.stretch.always) return stretch(pane,close,opts.stretch);
      var tall=function(){
        if(pane.style.height) return true;
        var h=pane.parentNode, r=h&&h.getBoundingClientRect?h.getBoundingClientRect():null, H=(r&&r.height)||window.innerHeight||800;
        if(pane.getBoundingClientRect().height>H*.62) return true;
        var sc=pane.querySelector('.sb,.sc,.tl,.pg-sc'); return !!(sc&&sc.scrollHeight>sc.clientHeight+4);
      };
      legacy(pane,close,function(){ return !tall(); });
      return stretch(pane,close,Object.assign({},opts.stretch,{gate:tall}));
    }
    return legacy(pane,close);
  }

  /* ---------- 老逻辑：往下拖关（其它抽屉继续用这个，行为不变） ---------- */
  function legacy(pane,close,active){
    var d=null;
    pane.addEventListener('pointerdown',function(e){
      if(active&&!active()) return;
      if(e.pointerType==='mouse'&&e.button!==0) return;
      if(e.target.closest('button,input,textarea,select,a,[contenteditable]')) return;
      var top=e.clientY-pane.getBoundingClientRect().top;
      if(top>64&&!e.target.closest('.grab,.sh,.dh')) return;
      d={y:e.clientY,t:performance.now(),id:e.pointerId,dy:0};
      pane.style.transition='none'; try{ pane.setPointerCapture(e.pointerId); }catch(_){}
    });
    pane.addEventListener('pointermove',function(e){
      if(!d||e.pointerId!==d.id) return; var raw=e.clientY-d.y;
      d.dy=raw>=0?raw:-(1-Math.exp(raw/90))*34;           /* 往上拉：橡皮筋，最多拉开 34px */
      pane.style.transform='translateY('+d.dy+'px)';
      d.v=(raw-(d.last||0))/Math.max(1,e.timeStamp-(d.lt||e.timeStamp-16)); d.last=raw; d.lt=e.timeStamp;
    });
    function up(){
      if(!d) return; var dd=d; d=null; var v=dd.dy/Math.max(1,performance.now()-dd.t);
      if(dd.dy>110||(v>.55&&dd.dy>36)){ buzz(6); pane.style.transition=''; pane.style.transform=''; close(); }
      else if(dd.dy!==0){ pane.style.transition=TF_SPRING; pane.style.transform=''; if(dd.dy>24) buzz(4); setTimeout(function(){ pane.style.transition=''; },700); }
      else { pane.style.transition=''; }
    }
    pane.addEventListener('pointerup',up); pane.addEventListener('pointercancel',up);
  }

  /* ---------- 新逻辑：拉高（两档吸附，transform 驱动） ----------
     [位置:phone-sheetdrag.js·stretch] [抽屉两档拉高] [10-31：抽屉只有「内容自然高度 ⇄ 满高」两个状态，
     没有中间档、不记档——开抽屉永远是自然高度，想看更多就拉到满高，松手回弹。
     拖动期间：height 一次性设成最高档，靠 translateY 表示"露多高"——只碰合成层，每帧零重排；
     落位：满高档一次 height 重排；回自然档把 height 交还给 CSS（内容后来变高也能跟着长）。
     显式传 levels（如 chats 三档）时按传来的档位吸附，行为同旧。]
     [注释时间 2026-10-27；2026-10-31 两档化] */
  function stretch(pane,close,o){
    var levels=(o.levels&&o.levels.length?o.levels:[0,1]).slice().sort(function(a,b){ return a-b; });
    var nat=o.natural!==false;
    var host=pane.parentNode;
    var d=null, cur=0, raf=0, pendingY=0, maxPx=0, drag=false, natH=0, curLv=0;

    function hostH(){ var r=host&&host.getBoundingClientRect?host.getBoundingClientRect():null; return (r&&r.height)||window.innerHeight||800; }
    /* [位置:phone-sheetdrag.js·stretch gapPx] [满高档顶部空隙] [#58 11-01：满高档不再真全屏顶到状态栏，顶部留 safe-area-inset-top+约12px。数值只写在 CSS（phone-new.html :root --dw-gap），这里用探针元素折算成像素——getComputedStyle 直读变量拿到的还是 env 原式折不出数；没定义 --dw-gap 的页面（回归取证页）读出 0px，满高档与旧版逐像素一致] [注释时间 2026-11-01] */
    var GAP=-1;
    /* [位置:phone-sheetdrag.js·gapPx 探针容器] [探针改挂抽屉自己的容器] [11-07：探针原来挂 body，--dw-gap 只能全局一个值，tk-dw 悬浮化后（底部留 10px）满档顶隙只剩 sat-底边-10，顶到状态栏；改挂 pane 所在容器后，容器级 CSS 覆盖 --dw-gap 就能单独调某类抽屉的满档高度（phone-talk.css .tk-dw{--dw-gap:...}）。其他容器没定义该变量，读到的仍是 :root 全局值，行为一字不变。stretch 的调用方容器（.tk-dw/.pg-sheet/.ses-pop）都是 absolute 定位，探针放得住；GAP 缓存在 stretch 闭包内按实例隔离，不会串] [注释时间 2026-11-07] */
    function gapPx(){
      if(GAP>=0) return GAP;
      var pr=document.createElement('i');
      pr.style.cssText='position:absolute;visibility:hidden;pointer-events:none;height:var(--dw-gap,0px)';
      (host||document.body).appendChild(pr);
      GAP=Math.round(pr.getBoundingClientRect().height)||0;
      pr.remove();
      return GAP;
    }
    function pxOf(l,i){
      if(nat&&i===0){ var hi=pxOf(levels[1],1); return Math.max(96,Math.min(natH||pane.scrollHeight||hi,hi)); }
      /* [位置:phone-sheetdrag.js·pxOf 满档分支] [满高档留状态栏空隙] [#58 11-01：原满高档=hostH 真全屏；改 hostH-顶部空隙。各抽屉面板都是 bottom 定位，高度变小顶部自然留空；拖拽/落位逻辑一行没动] [注释时间 2026-11-01] */
      if(l>=1) return Math.max(96,Math.round(hostH()-gapPx()));
      return Math.round(hostH()*l);
    }
    function capPx(){ return Math.min(pxOf(levels[levels.length-1],levels.length-1),hostH()-4); }
    function minPx(){ return pxOf(levels[0],0); }
    function snapIdx(h){ var best=0,bd=1e9;
      levels.forEach(function(l,i){ var dd=Math.abs(pxOf(l,i)-h); if(dd<bd){ bd=dd; best=i; } });
      return best; }

    /* 拖动帧：height 固定最高档，只改 transform（合成层，不重排） */
    function frame(visualH){
      var tf=Math.round(maxPx-visualH);
      pendingY=tf;
      if(raf) return;
      raf=requestAnimationFrame(function(){ raf=0; if(drag) pane.style.transform='translateY('+pendingY+'px)'; });
    }

    /* [位置:phone-sheetdrag.js·stretch 起手] [按住抽屉顶部开始拖] [顶 64px / 把手可拖；滚动守卫；起手一次重排撑到最高档，之后只动 transform] [注释时间 2026-10-27；2026-10-31 具名化] */
    function pd(e){
      if(o.gate&&!o.gate()) return;   /* 矮抽屉：交给 legacy（只下拖关闭） */
      if(e.pointerType==='mouse'&&e.button!==0) return;
      if(e.target.closest('button,input,textarea,select,a,[contenteditable]')) return;
      /* [位置:phone-sheetdrag.js·stretch 滚动守卫] [内容没到顶不抢手势] [10-28：高档时面板中段往往是列表，按住往下滑先滚列表，滚到顶再拖才是拉抽屉/关闭] [注释时间 2026-10-28] */
      var scr=(e.target.closest&&e.target.closest('.sc,.tl,.sb,.pg-sc,.mn-b,.mp-sc,.ls'))||null;
      if(scr&&scr.scrollTop>2) return;
      var top=e.clientY-pane.getBoundingClientRect().top;
      if(top>64&&!e.target.closest('.grab,.sh,.dh')) return;
      /* 上一轮收尾的定时器还挂着就起手：先摘，免得拖动中途被旧定时器改高度（10-31） */
      clearTimeout(pane._hT);
      /* curLv 只记在内存（不落盘——不记档是 10-31 拍板的），但必须有：不然从满高档起手会被重算成自然高，面板当场跳一下。
         natH 只在「未钉高」时重测：钉在满高时 scrollHeight 量出来是面板自身高度不是内容高，
         拿它当自然高会污染 minPx/atMin——从满高往下拖会被误判成"已在最低档还往下甩"直接关掉（10-31 修） */
      if(nat){ if(!pane.style.height) natH=pane.scrollHeight||0; pane.style.maxHeight='none'; if(curLv===0) cur=Math.max(96,Math.min(natH,pxOf(levels[1],1))); }
      var h0=cur||pane.getBoundingClientRect().height;
      d={y:e.clientY,id:e.pointerId,h0:h0,t:performance.now(),raw:0};
      drag=true; pane.classList.add('dw-fit');   /* 拖动期间内容盒子就跟着高度放开，落回最低档再摘 */
      /* 起手这一次重排：把高度撑到最高档，之后所有帧只动 transform */
      maxPx=capPx();
      pane.style.transition='none';
      pane.style.height=maxPx+'px';
      pane.style.transform='translateY('+Math.round(maxPx-h0)+'px)';
      pendingY=Math.round(maxPx-h0);   /* 没移动就松手时，按"当前档"落位，不会跳到最高档 */
      pane.classList.add('dw-drag');
      try{ pane.setPointerCapture(e.pointerId); }catch(_){}
    }
    function pm(e){
      if(!d||e.pointerId!==d.id) return;
      var raw=e.clientY-d.y, visual=d.h0-raw;      /* 往上拉（raw<0）=> 露得更高 */
      d.raw=raw;
      if(visual>maxPx) visual=maxPx+(1-Math.exp(-(visual-maxPx)/90))*6;          /* 到顶：轻微阻尼 */
      else if(visual<minPx){ var over=minPx-visual; visual=minPx-(1-Math.exp(-over/90))*34; }   /* 低于最低档：橡皮筋，松手可关 */
      frame(visual);
    }
    /* [位置:phone-sheetdrag.js·stretch 松手] [两档吸附 / 甩关 / 回自然档交还 CSS] [注释时间 2026-10-27；2026-10-31 两档化重写] */
    function fin(){
      if(!d) return; var dd=d; d=null; drag=false;
      if(raf){ cancelAnimationFrame(raf); raf=0; }
      pane.classList.remove('dw-drag');
      var raw=dd.raw, v=raw/Math.max(1,performance.now()-dd.t);
      var atMin=dd.h0<=minPx()+3;
      if(raw>0&&atMin&&(raw>110||(v>.55&&raw>36))){          /* 已在最低档还往下甩：关掉 */
        /* 10-31：不清 height——清了面板先弹回自然高再滑下去，肉眼可见跳一下；
           也不留 transform 内联，让 CSS 关闭曲线从当前拖拽位置接手滑走 */
        buzz(6); pane.style.transition=''; pane.style.transform=''; close(); return;
      }
      var visualNow=maxPx-pendingY;              /* 最后一帧露出的高度（pointerdown 时已初始化成当前档） */
      var idx=snapIdx(isFinite(visualNow)&&visualNow>0?visualNow:dd.h0);
      var target=pxOf(levels[idx],idx);   /* 必须带 idx：nat 分支靠 i===0 识别自然档，漏传会算成 hostH*levels[0]=0（10-28 起就有的老 bug） */
      /* 落位：先让 transform 平滑过渡到目标视觉位置（纯合成层，丝滑），到位后再一次性切真实 height */
      pane.style.transition=TF_SPRING;
      pane.style.transform='translateY('+Math.round(maxPx-target)+'px)';
      clearTimeout(pane._hT);
      pane._hT=setTimeout(function(){
        if(!pane.isConnected) return;
        pane.style.transition='none';
        pane.classList.toggle('dw-fit',idx>0);
        if(idx>0){
          /* 满高档：height 落到真实满高，transform 归零 */
          pane.style.height=target+'px';
          pane.style.transform='';
          requestAnimationFrame(function(){ if(pane.isConnected) pane.style.transition=''; });
        }else{
          /* [位置:phone-sheetdrag.js·stretch 回自然档] [height 交还 CSS] [10-31：自然档不钉死像素——
             height/maxHeight 还给 CSS（内容后来变高也能跟着长到上限），用一次反向位移补住视觉再归零：
             交换瞬间顶边必须在原位（补 hNow-target），随后把这补偿位移动画到 0，肉眼无跳变；
             先清 height 再量 hNow，量到的才是 CSS 自然高（顺序反了量到钉死值，补偿恒 0，回自然档瞬跳）] [注释时间 2026-10-31] */
          pane.style.height=''; pane.style.maxHeight='';
          var hNow=pane.getBoundingClientRect().height;
          natH=hNow;
          pane.style.transform='translateY('+Math.round(hNow-target)+'px)';
          requestAnimationFrame(function(){
            if(!pane.isConnected) return;
            pane.style.transition=TF_SPRING; pane.style.transform='';
            pane._hT=setTimeout(function(){ if(pane.isConnected) pane.style.transition=''; },(DUR_UP*1000)+40);
          });
        }
      },(DUR_UP*1000)+30);
      cur=target; curLv=idx;
      if(idx!==snapIdx(dd.h0)) buzz(4);
    }
    pane.addEventListener('pointerdown',pd); pane.addEventListener('pointermove',pm);
    pane.addEventListener('pointerup',fin); pane.addEventListener('pointercancel',fin);

    /* 旋屏 / 键盘弹起：按当前档位重算（监听器在抽屉关掉时摘掉，不然每开一次就留一个） */
    var rt=0;
    function onResize(){ clearTimeout(rt); rt=setTimeout(function(){
      if(!pane.isConnected){ window.removeEventListener('resize',onResize); return; }
      if(!pane.style.height){ if(nat) natH=pane.scrollHeight||0; return; }   /* 自然态：高度交给 CSS 管；钉高状态下 scrollHeight 是满高值不能用（10-31 修） */
      var i=snapIdx(cur);
      pane.style.transition='none'; pane.style.transform=''; pane.style.height=pxOf(levels[i],i)+'px';
      pane.classList.toggle('dw-fit',i>0); cur=pxOf(levels[i],i); curLv=i;
      requestAnimationFrame(function(){ if(pane.isConnected) pane.style.transition=''; });   /* 不留内联 none（10-31 修污染） */
    },180); }
    window.addEventListener('resize',onResize);
    /* 抽屉被移除时自己摘监听（sheet 的 close 是 pop.remove()——pane parentNode 的 childList 不变，
       要盯 pop 的父节点才收得到；不摘的话每开一次抽屉就永久留一个 resize 监听 + 闭包持有整个面板） */
    try{
      var root=pane.parentNode&&pane.parentNode.parentNode;
      var mo=new MutationObserver(function(){
        if(!pane.isConnected){ window.removeEventListener('resize',onResize); mo.disconnect(); }
      });
      if(root) mo.observe(root,{childList:true});
    }catch(_){}
    /* [位置:phone-sheetdrag.js·stretch 测试钩子] [pane._sdTest] [10-31：回归取证页直接驱动处理器，绕开合成指针事件的管线伪影；仅取证页设了 window.__sdTestExpose 才挂，生产零开销] [注释时间 2026-10-31] */
    if(window.__sdTestExpose) pane._sdTest={down:pd,move:pm,up:fin};
  }

  P.sheetDrag=sheetDrag; window.PH=P;
})();
