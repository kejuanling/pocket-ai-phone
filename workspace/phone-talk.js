/* 小手机 · 聊天页（新版设计稿 v2）
   顶部：圆形返回 / 「…」+ 中间头像，下面一颗名字胶囊；往上翻头像收走，胶囊顶到顶栏。
   消息：两边都有头像（聊天外观里统一关）；头像顶对齐；你发的话按换行拆成几个气泡。
   他回复中点「输入中」的小气泡 → 底部抽屉：思考 + 工具，流式；事后长按他的气泡「看思考和工具」或点他头像也能看。
   「…」：当前请求上下文就地展开；跨窗口就地展开详细设置；状态机独立一页（照管理台的状态机面板，参数在右上角设置）。
   [位置:phone-talk.js·文件头] [聊天页] [从会话列表点进来 = 真会话（读写 / 流式 / 思考与工具抽屉 / 标星 / 编辑 / 删除 / 多选 / 重新生成 / 开分支 / 重试 / 文件卡 / 分段连播 / 搜索定位）；从别处直接打开才是示例对话] [注释时间 2026-10-21 更新]
   没登录或没连上后台时才显示示例对话，此时发送、保存类按钮只提示「没连上」，不会假装成功。 */
(function(){
"use strict";
var P=window.PH; if(!P||!P.register) return;
var $=P.$, buzz=P.buzz, toast=P.toast;
var esc=P.esc||function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
function svg(d){ return '<svg viewBox="0 0 24 24">'+d+'</svg>'; }
var I={
  back:svg('<path d="m15 18-6-6 6-6"/>'), more:svg('<circle cx="5.5" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.9" fill="currentColor" stroke="none"/>'), down:svg('<path d="m6 9.5 6 6 6-6"/>'),
  plus:svg('<path d="M12 5v14M5 12h14"/>'), send:svg('<path d="M12 19V5M5 12l7-7 7 7"/>'), plane:svg('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  /* [位置:phone-talk.js·I.cat/I.paw] [气泡样式「+」按钮的图标] [10-30：加号太简陋，换成小猫；点开面板时变成爪印。线稿来自 Lucide（cat / paw-print，ISC 协议），24x24 viewBox] [注释时间 2026-10-30] */
  cat:svg('<path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/>'), paw:svg('<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>'), kb:svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>'),
  mic:svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'), play:svg('<path d="M8 5.5v13l10.5-6.5z"/>'), pause:svg('<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/>'), chev:svg('<path d="m9 6 6 6-6 6"/>'),
  photo:svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  cam:svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  file:svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  phone:svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
  smile:svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
  card:svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>'),
  hammer:svg('<path d="m15 12-8.4 8.4a1.5 1.5 0 0 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.9-1.9A2 2 0 0 1 19 8.2V7l-2.3-2.3a6 6 0 0 0-4.2-1.8L9 3l.9.8A6.2 6.2 0 0 1 12 8.4V10l2 2h1.2a2 2 0 0 1 1.4.6l1.9 1.9"/>'),
  /* [位置:phone-talk.js·I.filePen] [在改文件浮球的图标] [11-06 从 9 个候选里挑的：文件+笔（Lucide file-pen，ISC 协议），一眼「在改文件」，和面板里列的文件同一语义] [注释时间 2026-11-06] */
  filePen:svg('<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.4 15.6a1 1 0 1 0-3-3l-5 5a2 2 0 0 0-.5.9l-.8 2.9a.5.5 0 0 0 .6.6l2.9-.8a2 2 0 0 0 .9-.5z"/>'),
  /* [位置:phone-talk.js·I.alarm] [闹钟浮球图标] [11-06：闹钟球面用 Lucide alarm-clock（ISC），一眼「定时唤醒」；线稿随主题] [注释时间 2026-11-06] */
  alarm:svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="M22 6l-3-3"/>'),
  plug:svg('<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>'),
  /* [位置:phone-talk.js·I.bolt] [加号面板「快捷指令」的图标] [11-09 随手记：加号菜单加快捷指令；线稿同 Lucide zap（ISC 协议）] [注释时间 2026-11-09] */
  bolt:svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  /* [位置:phone-talk.js·I.touch] [加号面板「触摸面板」的图标] [线稿同 Lucide hand（ISC 协议）] [注释时间 2026-11-23] */
  touch:svg('<path d="M18 11V6a2 2 0 0 0-4 0v4"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>'),
  /* [位置:phone-talk.js·I.book] [加号面板「动态注入」的图标] [线稿同 Lucide book-open（ISC 协议）] [注释时间 2026-11-21] */
  book:svg('<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>'),
  tok:svg('<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.6c-.3-.9-1.3-1.4-2.6-1.4-1.5 0-2.6.7-2.6 1.8s1 1.5 2.6 1.9c1.6.4 2.6.8 2.6 1.9s-1.1 1.8-2.6 1.8c-1.4 0-2.4-.5-2.7-1.5M12 6.8v1.4M12 15.8v1.4"/>'),
  think:svg(['M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z','M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z','M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4','M17.599 6.5a3 3 0 0 0 .399-1.375','M6.003 5.125A3 3 0 0 0 6.401 6.5','M3.477 10.896a4 4 0 0 1 .585-.396','M19.938 10.5a4 4 0 0 1 .585.396','M6 18a4 4 0 0 1-1.967-.516','M19.967 17.484A4 4 0 0 1 18 18'].map(function(d){ return '<path d="'+d+'"/>'; }).join('')),   /* [2026-11-18] 用户从 9 个候选里选了 Lucide brain（预览稿 _preview/think-icons-20261118.html）；原灯泡（lightbulb 简化版）换掉。I.think 三处共用：极简思考行、子会话抽屉、思考抽屉 stepHTML */
  tool:svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  tbox:svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18M10.5 13v1.5h3V13"/>'),   /* 2026-10-27：并发工具合并行的图标换成工具箱（抄 Claude） */
  sclose:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  sopen:svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  ok:svg('<path d="m5 12 4.5 4.5L19 7"/>'), gear:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  ctx:svg('<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>'), cross:svg('<rect x="3" y="4" width="13" height="13" rx="3"/><path d="M8 20h10a3 3 0 0 0 3-3V9"/>'),
  state:svg('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.5 6h7M7.2 8.2l3.6 7.6M16.8 8.2l-3.6 7.6"/>')
};
/* [位置:phone-talk.js·I] [长按菜单图标] [菜单每项配一个 16px 小图标，扫菜单快一点；24 视框、1.7 描边] [注释时间 2026-10-22] */
Object.assign(I,{
  sel:svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>')   /* [10-31 从选区括号换成 Lucide leaf（ISC）：预览页 12 只萌物里挑的 1 号叶子，抽屉+极简两处引用自动跟] */,
   copy:svg('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5.5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5.5"/>'),
  /* [位置:phone-talk.js·I.quote/seltext/qx] [引用、选择文本、取消引用图标] [气泡主题长按菜单两项与输入框预览叉号；24 视框、1.7 描边，与同组菜单图标一致] [注释时间 2026-11-23] */
  quote:svg('<path d="M4 7h7v5H7.2A3.2 3.2 0 0 0 4 15.2"/><path d="M13 7h7v5h-3.8A3.2 3.2 0 0 0 13 15.2"/>'),
  seltext:svg('<path d="M6 5h4M14 5h4M8 5v14M16 5v14M6 19h4M14 19h4"/>'),
  qx:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  pen:svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  star:svg('<path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/>'),
  speak:svg('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>'),
  multi:svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 2.6 2.6L16 9"/>'),
  regen:svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  branch:svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M8.5 6.6h5a4 4 0 0 1 4 4"/>'),
  uptop:svg('<path d="M5 4h14"/><path d="m18 14-6-6-6 6"/><path d="M12 8v12"/>'),   /* [11-01：颜文字菜单「移到最前」用，Lucide arrow-up-to-line 风格] */
  trash:svg('<path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5M13.5 11v5"/>'),
  bksp:svg('<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/>'),   /* [位置:phone-talk.js·I.bksp] [表情面板退格键图标] [11-02：头部「完成」键换成退格键（删输入框一个字符），线稿抄 Lucide delete（ISC）] [注释时间 2026-11-02] */
  chv:svg('<path d="m9 6 6 6-6 6"/>'),
  /* [位置:phone-talk.js·I.aup/I.adn] [token 弹层行图标] [11-18：极简操作条 token 总值弹层的输入/输出行小箭头，照她给的截图；线稿 Lucide arrow-up / arrow-down（ISC 协议）] [注释时间 2026-11-18] */
  aup:svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>'), adn:svg('<path d="m19 12-7 7-7-7"/><path d="M12 5v14"/>'),
  /* [位置:phone-talk.js·工具图标库] [按工具区分的线稿图标] [10-28：toolIco 映射用，24 视框线稿、描边随主题 CSS；emoji 一律不用] [注释时间 2026-10-28] */
  search:svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>'),
  list:svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'),
  note:svg('<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  mem:svg('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'),
  bell:svg('<path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>'),
  music:svg('<circle cx="7" cy="17.5" r="3"/><circle cx="17" cy="15.5" r="3"/><path d="M10 17.5V5l10-2v12.5"/>'),
  cal:svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  bot:svg('<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M8 4h8"/><path d="M9 13h.01M15 13h.01"/><path d="M9.5 16.5h5"/>'),
  globe:svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  server:svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  /* [位置:phone-talk.js·I.shot 取景框] [截图工具图标] [10-28 拍板：screenshot 亮取景框（四角括号+中心圆点，iOS 截屏同款视觉语言）] [注释时间 2026-10-28] */
  shot:svg('<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3.2"/>'),
  /* [位置:phone-talk.js·I.folder 文件夹] [列目录工具图标] [10-28：list_dir 原来亮默认扳手，补个文件夹线稿] [注释时间 2026-10-28] */
  folder:svg('<path d="M3.5 17.2V6.8A1.8 1.8 0 0 1 5.3 5h3.4c.55 0 1.07.25 1.41.68L11.2 7h7.5a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z"/>')
});
/* [位置:phone-talk.js·toolIco] [工具图标按工具区分] [10-28：单工具行原来一律扳手，扫一眼看不出刚用了什么；按工具名关键词映射（工具集 manifest：album/context/her_murmurs/lovediary/memory/mood/netease/notebook/period/phone_state/server_time/todo/wake/world + MCP + subagent），未命中保留扳手；memory 排在 search 前面——memory_search 是记忆工具，不亮放大镜] [注释时间 2026-10-28] */
function toolIco(name){
  var n=String(name||'').toLowerCase();
  function hit(){ for(var i=0;i<arguments.length;i++){ if(n.indexOf(String(arguments[i]))>=0) return true; } return false; }
  if(hit('subagent')) return I.bot;
  /* [位置:phone-talk.js·toolIco 写入类] [写文件/编辑类工具亮笔] [10-28：yun-mcp-v2 的 write_file 原来命中 file 关键词亮折角文件图标，看不出是「写」的动作——write/edit 关键词提前到其它判断之前，亮编辑笔] [注释时间 2026-10-28] */
  if(hit('write','edit')) return I.pen;
  if(hit('shot')) return I.shot;   /* screenshot（10-28 选取景框） */
  if(hit('git')) return I.branch;   /* 10-28：git_status/log/diff 亮分支线稿（复用长按菜单的 branch） */
  if(hit('list_dir')) return I.folder;   /* 10-28：list_dir 原来亮默认扳手 */
  if(hit('album','image','photo')) return I.photo;
  if(hit('todo','task')) return I.list;
  if(hit('notebook','note','paper')) return I.note;
  if(hit('diary','murmurs','love')) return I.pen;
  if(hit('mood','face')) return I.smile;
  if(hit('memory')) return I.mem;
  if(hit('wake','push','alarm')) return I.bell;
  if(hit('netease','music')) return I.music;
  if(hit('period','calendar')) return I.cal;
  if(hit('phone_state','phone')) return I.phone;
  /* 10-28 反复记录：曾给 run_command 补 'command' 关键词归服务器组，用户看过图标全集清单后拍板 run_command 用扳手（通用执行工具，扳手更贴切）——关键词撤掉，自然回落扳手；server 组其余成员不受影响 */
  if(hit('server','shell','exec','cmd','script')) return I.server;
  if(hit('file','upload','download')) return I.file;
  if(hit('context','search')) return I.search;
  if(hit('world','web','net')) return I.globe;
  return I.tool;
}

/* ---------- 示例对话（你发的一条带换行 → 拆成三个气泡） ---------- */
/* [位置:phone-talk.js·MSGS0] [聊天页没从会话进来时的内容] [演示对话已删（2026-10-22）：没有会话上下文时只放一行提示，发送 / 发表情都如实提示，不再往本地塞假消息] [注释时间 2026-10-22] */
var MSGS0=[{k:'stamp',h:'从会话列表里进一个会话'}];
/* [位置:phone-talk.js·mdInline] [行内 Markdown 与括号动作渲染] [段落/标题/列表/引用/分割线/代码块/行内代码/粗斜删/链接/图片；（动作）单独淡一点；2026-11-19 去掉中文括号 60 字上限，长动作描写统一变暗] [注释时间 2026-11-19] */
function mdInline(src){
  var keep=[], s=String(src).replace(/`([^`\n]+)`/g,function(_,c){ keep.push('<code>'+esc(c)+'</code>'); return '\u0000'+(keep.length-1)+'\u0000'; });
  s=esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,'<img class="md-img" src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g,'$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g,'<del>$1</del>')
    .replace(/（([^）]+)）/g,'<span class="act">（$1）</span>');
  return s.replace(/\u0000(\d+)\u0000/g,function(_,i){ return keep[+i]; });
}
/* [位置:phone-talk.js·md 表格/代码块] [Markdown 补表格 + 代码块一键复制] [10-23 需求 46：①表格：表头行 + |---| 分隔行 + 若干行，渲染成带细线的小表格，太宽就在框里横向滑动（流式时表头和分隔行没凑齐之前先当普通文字，凑齐才变表格，所以不闪）；单元格里的粗体/代码等行内格式照常；列对齐按分隔行的冒号；②代码块：上面一条细栏，左边语言名，右边文字「复制」，点了变「已复制」约 1.5 秒；复制逻辑见 copyText 与下面 list 的点击委托] [注释时间 2026-10-23] */
function mdCells(l){ var s=l.trim().replace(/^\|/,'').replace(/\|$/,''), out=[], cur='', k; for(k=0;k<s.length;k++){ var c=s.charAt(k); if(c==='\\'&&s.charAt(k+1)==='|'){ cur+='|'; k++; } else if(c==='|'){ out.push(cur.trim()); cur=''; } else cur+=c; } out.push(cur.trim()); return out; }
function mdTblSep(l){ return l.indexOf('|')>=0&&/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l); }
function md(t){
  var L=String(t==null?'':t).replace(/\r/g,'').split('\n'), out=[], i=0, para=[];
  function flush(){ if(para.length){ out.push('<p>'+para.map(mdInline).join('<br>')+'</p>'); para=[]; } }
  while(i<L.length){ var ln=L[i], m;
    if(/^\s*```/.test(ln)){ flush(); var lang=ln.replace(/^\s*```/,'').trim(), code=[]; i++; while(i<L.length&&!/^\s*```/.test(L[i])) code.push(L[i++]); i++;
      out.push('<div class="md-code"><div class="md-ph"><small>'+esc(lang)+'</small><button class="md-cp" type="button" aria-label="复制代码">复制</button></div><pre class="md-pre"><code>'+esc(code.join('\n'))+'</code></pre></div>'); continue; }
    if(ln.indexOf('|')>=0&&i+1<L.length&&mdTblSep(L[i+1])){ flush(); var hd=mdCells(ln), al=mdCells(L[i+1]).map(function(c){ return /^:-+:$/.test(c)?'center':/-:$/.test(c)?'right':'left'; }), rows=[]; i+=2;
      while(i<L.length&&L[i].trim()&&L[i].indexOf('|')>=0) rows.push(mdCells(L[i++]));
      out.push('<div class="md-tbl"><table><thead><tr>'+hd.map(function(c,j){ return '<th style="text-align:'+(al[j]||'left')+'">'+mdInline(c)+'</th>'; }).join('')+'</tr></thead><tbody>'+rows.map(function(r2){ return '<tr>'+hd.map(function(_,j){ return '<td style="text-align:'+(al[j]||'left')+'">'+mdInline(r2[j]||'')+'</td>'; }).join('')+'</tr>'; }).join('')+'</tbody></table></div>'); continue; }
    if(!ln.trim()){ flush(); i++; continue; }
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)){ flush(); out.push('<hr>'); i++; continue; }
    if((m=ln.match(/^\s*(#{1,4})\s+(.*)$/))){ flush(); out.push('<h4 class="mdh l'+m[1].length+'">'+mdInline(m[2])+'</h4>'); i++; continue; }
    if(/^\s*>/.test(ln)){ flush(); var q=[]; while(i<L.length&&/^\s*>/.test(L[i])) q.push(L[i++].replace(/^\s*>\s?/,'')); out.push('<blockquote>'+md(q.join('\n'))+'</blockquote>'); continue; }
    if(/^\s*([-*•+])\s+/.test(ln)||/^\s*\d+[.)、]\s+/.test(ln)){ flush(); var ol=/^\s*\d/.test(ln), it=[];
      while(i<L.length&&(ol?/^\s*\d+[.)、]\s+/:/^\s*([-*•+])\s+/).test(L[i])){ var x=L[i++].replace(ol?/^\s*\d+[.)、]\s+/:/^\s*([-*•+])\s+/,'');
        while(i<L.length&&/^\s{2,}\S/.test(L[i])&&!/^\s*([-*•+]|\d+[.)、])\s+/.test(L[i])) x+='\n'+L[i++].trim(); it.push('<li>'+mdInline(x).replace(/\n/g,'<br>')+'</li>'); }
      out.push((ol?'<ol>':'<ul>')+it.join('')+(ol?'</ol>':'</ul>')); continue; }
    para.push(ln); i++; }
  flush(); return out.join('');
}

/* [位置:phone-talk.js·qteAlready/qteWrap/qteParse] [引用块拼装与解析] [气泡主题长按引用：发给模型的正文按已确认格式分隔引用与本轮新输入；同一格式用于回显解析，避免发送链路或重载后再包一层] [注释时间 2026-11-23] */
function qteAlready(t){
  return String(t||'').replace(/^\s+/,'').indexOf('【引用，不是本轮新指令】')===0;
}
function qteWrap(role, quote, input){
  var r=(role==='用户')?'用户':'AI';
  var q=String(quote==null?'':quote).replace(/\s+$/,'');
  var inp=String(input==null?'':input);
  if(qteAlready(inp)) return inp;
  return '【引用，不是本轮新指令】\n作者类型：'+r+'\n内容：\n'+q+'\n\n【本轮新输入】\n'+inp;
}
function qteParse(t){
  var s=String(t==null?'':t).replace(/^\s+/,'');
  var head='【引用，不是本轮新指令】\n';
  if(s.indexOf(head)!==0) return null;
  var rest=s.slice(head.length);
  var roleM=rest.match(/^作者类型：(用户|AI)\n内容：\n/);
  if(!roleM) return null;
  var after=rest.slice(roleM[0].length), mark='\n\n【本轮新输入】', i=after.lastIndexOf(mark);
  if(i<0) return null;
  var inp=after.slice(i+mark.length);
  if(inp.charAt(0)==='\n') inp=inp.slice(1);
  return {role:roleM[1], quote:after.slice(0,i), input:inp};
}

function html(){
  var aNm=(P.names&&P.names.ai)?P.names.ai():'助手', aLt=(P.names&&P.names.letter)?P.names.letter('ai'):'助';
  return '<div class="content chat tk">'+
    '<div class="tk-top"><button class="back tk-cb tap" aria-label="返回">'+I.back+'</button>'+
      '<div class="tk-who"><button class="tk-av av ai tap" data-l="'+esc(aLt)+'" id="tkAv" aria-label="设定、模型和头像"></button><button class="tk-nm tap" id="tkNm">'+esc(aNm)+I.chev+'</button></div>'+
      '<button class="tk-cb tap" id="tkMore" aria-label="更多">'+I.more+'<b class="mdot" hidden></b></button></div>'+
    '<div class="msgs tk-msgs" id="tkMsgs"></div><button class="tk-jb tap" id="tkJb" type="button" aria-label="回到最新">'+I.down+'<b></b></button>'+
    /* [位置:phone-talk.js·html tkClaim] [正在改的文件浮球 + 面板] [11-06：本会话 <claim> 登记的文件看得见；球由 claimBall 定位，默认站在「回到最新」上方，不压子会话条] [注释时间 2026-11-06] */
    '<button class="tk-claim tap" id="tkClaim" type="button" hidden aria-label="正在改的文件" aria-expanded="false">'+I.filePen+'<b class="n"></b></button>'+
    '<div class="tk-claimp" id="tkClaimP" hidden aria-hidden="true"></div>'+
    /* [位置:phone-talk.js·html tkAlarm] [闹钟浮球 + 面板] [11-06：本会话闹钟的倒计时与单独取消；球由 alarmBall 定位，叠在文件球上面，两球共用一列] [注释时间 2026-11-06] */
    '<button class="tk-claim tk-alarm tap" id="tkAlarm" type="button" hidden aria-label="闹钟" aria-expanded="false">'+I.alarm+'<b class="dot" hidden></b></button>'+
    '<div class="tk-claimp tk-alarmp" id="tkAlarmP" hidden aria-hidden="true"></div>'+
    '<div class="tk-att" id="tkAtt" hidden></div><div class="tk-sub" id="tkSub" hidden></div>'+
    '<div class="composer tk-cp"><button class="plus tap" id="tkPlusBtn" aria-label="更多">'+I.plus+'</button>'+
      '<div class="field"><textarea id="tkTa" rows="1" placeholder="说点什么…"></textarea>'+
      '<button class="tk-hold" id="tkHold" type="button">按住 说话</button><button class="tk-kb tap" id="tkKb" aria-label="回到打字">'+I.kb+'</button>'+
      '<button class="tk-send tap" id="tkSend" aria-label="发送" disabled>'+I.send+'</button></div></div>'+
    '<div class="tk-plus" id="tkPlus">'+
      [['voice','语音',I.mic],['att','相册/文件',I.photo],['cam','拍摄',I.cam],['phone','电话',I.phone],['stk','表情包',I.smile],['touch','触摸面板',I.touch],['mcp','MCP',I.plug],['wb','动态注入',I.book]].map(function(x,i){ return '<button class="tap" style="--i:'+i+'" data-p="'+x[0]+'"><i>'+x[2]+'</i><span>'+x[1]+'</span></button>'; }).join('')+
    '</div>'+
  '</div>';
}

function setup(win){
  /* [位置:phone-talk.js·selWhole/bindSel] [思考整段选中] [10-31：叶子一点，把这段思考全文高亮，轻点高亮再出拷贝/翻译，不写剪贴板。2026-11-18 从 drawer 挪到进会话就挂：原来写在抽屉函数里，极简主题不打开思考抽屉，监听永远不挂，叶子点了没反应。必须留在 setup 里，才能用到本页的展开记录 MO / 抽屉记录 DS。再进会话先卸旧的再挂，避免叠多层。展开后内容还是空盒子时先 lzFill，否则高亮是空的] [注释时间 2026-11-18 改] */
  function selWhole(cp){
    var st=cp.closest('.stp,.mn-row'); if(!st) return;
    var box=st.querySelector(':scope>.sb,:scope>.mn-b'); if(!box) return;
    if(st.classList.contains('fold')){ st.classList.remove('fold'); var dk=st.getAttribute('data-k'); if(dk) DS[dk]='open'; }
    else if(!st.classList.contains('open')){ st.classList.add('open'); var mk=st.getAttribute('data-mk'); if(mk) MO[mk]=1; }
    if(box.classList.contains('lazy')) lzFill(st);
    var r=document.createRange(); r.selectNodeContents(box);
    var sg=getSelection(); sg.removeAllRanges(); sg.addRange(r);
    buzz(6);
  }
  function bindSel(){
    if(bindSel._fn) document.removeEventListener('click',bindSel._fn,true);
    bindSel._fn=function(e){ var cp=e.target.closest&&e.target.closest('.dw-cp,.mn-cp'); if(!cp) return; e.preventDefault(); e.stopPropagation(); selWhole(cp); };
    document.addEventListener('click',bindSel._fn,true);
  }
  bindSel();
  /* [位置:phone-talk.js·OPT.enterSend] [回车直接发送开关] [电脑/外接键盘打字时回车就想发出去；默认关（手机软键盘回车是换行），存在本机 localStorage，头像菜单里开关] [注释时间 2026-10-21] */
  var ENTER_KEY='ph_enter_send';
  function enterGet(){ try{ return localStorage.getItem(ENTER_KEY)==='1'; }catch(e){ return false; } }
  /* [位置:phone-talk.js·OPT.splitAI] [他的消息按空行分气泡开关] [2026-11-02 产品要求加回：气泡主题里把一条回复按空行拆成几个气泡（10-28 拆掉过，当时连「我的消息分气泡」「显示头像」一起拆的）；这次只要 AI 这一个开关——我的消息不拆；只在气泡主题显示和生效（极简无气泡，items 里 MIN 短路）；开着关着记本机 localStorage（旧版不记，顺手补上）；默认关] [注释时间 2026-11-02] */
  var SPLIT_KEY='ph_talk_split_ai';
  function splitGet(){ try{ return localStorage.getItem(SPLIT_KEY)==='1'; }catch(e){ return false; } }
  var OPT={enterSend:enterGet(),splitAI:splitGet()};
  /* [位置:phone-talk.js·MIN] [极简聊天样式] [设置页「聊天样式」选了「极简」：抄 Claude 网页端——无气泡、无头像、思考与工具按顺序穿插在正文里、逐字打字机；打开聊天页时读一次（P.chatStyle，phone-set.js）；气泡样式的代码路径一行不动] [注释时间 2026-10-21] */
  /* [位置:phone-talk.js·MIN 会话级主题] [预设可以带聊天主题] [本会话有自己的主题映射（ph_sess_style，预设开会话时写入）就用它，没有回落全局「聊天样式」；P.talkCtx 在下面 CTX0 之前取值，var 提升此处安全] [注释时间 2026-10-26] */
  /* [位置:phone-talk.js·MIN 子会话固定极简] [子智能体会话一律极简] [10-27：子进程就是一个新会话、就说好用极简主题——不跟着设备本地的「聊天样式」开关走，换设备/改全局都不变；判断只看会话 id 前缀 s_sub_（网关那边 SUB 前缀同一口径）] [注释时间 2026-10-27] */
  var SUBMIN=!!(P.talkCtx&&/^s_sub_/.test(String(P.talkCtx.id||'')));
  var MIN=SUBMIN||!!(P.chatStyle&&((P.sessPref&&P.sessPref.styleOf(P.talkCtx&&P.talkCtx.id))||P.chatStyle.get())==='min');
  var ATT=[], attSeq=0;   /* 待发附件，见 attPick / attPaint */
  var QS={on:null,list:[],t:0,chk:false};   /* 11-04 发送排队的前端状态（先声明：busyPaint 初始化阶段就会用到），流程见 stopGen 前的「发送排队 QS」 */
  var QTE=null;   /* [位置:phone-talk.js·QTE] [气泡主题引用状态] [QTE={role,text} 当前引用。声明放在 setup 前部，早于后续读取。2026-11-24 改：选择文本改走弹窗（selPop），lpCool / selBub 两个变量随之删除] [注释时间 2026-11-23；2026-11-24 改] */
  var LD_FIRST=1, LD=null;   /* LD = 进会话时铺在窗口上的毛玻璃加载层（P.load.show），内容到了 done() 散去 */
  var MSGS=(P.talkCtx&&P.talkCtx.id)?[{k:'skel'}]:MSGS0.slice(), REF=[], GR={}, CTX0=P.talkCtx||null, LIVE={on:false,sid:CTX0&&CTX0.id,raw:[],busy:false,sig:null,sseAt:0,total:null,fails:[]}, ST=null, VER={map:{},flash:'',pop:{}};   /* VER：同会话版本（{锚点用户消息id:{count,cur}}），见 verLoad/verPaint */
  var TW={st:null,shown:0,raf:0,ts:0,fast:false,hh:'',rm:false,direct:false,atBot:true,hand:false,touch:false,tsAt:0,blk:{},bkm:{},rh:{}};
  var PS={t:0,raf:0}, RATE={acc:0,t:0};
  var host=$('.content',win), list=$('#tkMsgs',win), ta=$('#tkTa',win), sendB=$('#tkSend',win), seen={};
  /* [位置:phone-talk.js·setup 毛玻璃加载层] [进会话时整窗糊一层，动画浮在上面] [11-05：照旧 chat 端 #chatSwitching 的做法（半透明底 + blur，pointer-events:none 不挡手）；独立挂在窗口上，消息区重绘不会把它刷掉，才能自己淡出；没拉到数据时也能一直等，比原来「一行灰字被重绘冲掉」稳] [注释时间 2026-11-05] */
  /* dy:-36 = 往上挪 36px：整窗几何中心在 422，而「顶栏底 0 → 输入框顶 772」这段可用区的中心是 386（11-05 实测），不挪看着偏下 */
  if(P.talkCtx&&P.talkCtx.id&&P.load) LD=P.load.show(win,{page:1,dy:-36});
  /* [位置:phone-talk.js·MIN 输入框] [极简输入框抄 Claude 网页端布局] [一个方框：上面打字，下面一排「+ … 麦克风 发送」；+、发送键、回车逻辑原样，只是把节点挪进底栏；麦克风=语音转文字。10-27 改：麦克风不再切「按住说话」长按模式，改点击式——点一下开始录（输入框不动），再点一下或点浮层停，转写追加进输入框；气泡样式的长按路径不动] [注释时间 2026-10-27] */
  if(MIN){ (function(){ var fd=ta.closest('.field'), bar=document.createElement('div'), mic=document.createElement('button');
    bar.className='mn-bar'; mic.type='button'; mic.id='tkMic'; mic.className='tk-mic tap'; mic.setAttribute('aria-label','语音转文字'); mic.innerHTML=I.mic;
    bar.appendChild($('#tkPlusBtn',win)); bar.appendChild($('#tkKb',win)); bar.appendChild(mic); bar.appendChild(sendB); fd.appendChild(bar);
    mic.addEventListener('click',function(){ if(RC){ recDone(); return; } if(mic.classList.contains('asr-busy')) return; RECMODE='text'; recStart(mic); }); })(); }   /* 点击式：录音中再点=停（浮层盖着，这里是兜底）；识别中防连点 */
  host.classList.toggle('tkmin',MIN);
  if(!MIN){ sendB.innerHTML=I.plane; var plusB=$('#tkPlusBtn',win); if(plusB) plusB.innerHTML=I.cat+I.paw; }   /* [位置:phone-talk.js·setup 发送键图标] [气泡样式发送键用纸飞机] [10-30：气泡主题发送按钮换纸飞机图标；极简仍用上箭头] [注释时间 2026-10-30] */
  /* [位置:phone-talk.js·QTE 预览] [气泡主题引用预览条] [节点仍挂在 field 以复用定位与 quoteDark 明暗判定，CSS 绝对定位到输入框上方，不再参与内部 flex；一次只留一条，发送格式与校验不变。2026-11-24：修旧布局把 textarea 单行宽度挤成 0 的问题，保留发送者前缀与取消行为] [注释时间 2026-11-23；2026-11-24 改] */
  var qteBar=document.createElement('div');
  qteBar.className='tk-qbar'; qteBar.hidden=true;
  qteBar.innerHTML='<span class="who"></span><span class="tx"></span><button type="button" class="qx" aria-label="取消引用">'+(I.qx||'')+'</button>';
  if(!MIN){ var fd0=ta.closest('.field'); if(fd0) fd0.insertBefore(qteBar, fd0.firstChild); }
  qteBar.querySelector('.qx').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); quoteClear(); });
  function quoteClear(){ QTE=null; quotePaint(); }
  /* [位置:phone-talk.js·qSync] [引用条字色跟输入框聚焦态] [2026-11-24：输入框聚焦/失焦时底色会变（默认档 .62 -> .78、磨砂档 .32 -> .5），挂着的引用条跟着重判字色；输入框底色有约 .2s 过渡，所以立刻判一次、过渡走完再判一次。只有「磨砂输入框 + 日间 + 深壁纸」这一种组合聚焦/失焦两种稳态的结论相反（聚焦偏浅灰用深字，失焦偏深用浅字），靠这两次判定兜住] [注释时间 2026-11-24] */
  var qT=0;
  function qSync(){ if(!QTE||MIN) return; quotePaint(); clearTimeout(qT); qT=setTimeout(quotePaint,280); }   /* 立刻判一次，等输入框底色的过渡走完（约 .2s）再判一次；判定落在过渡中途会偏 */
  ta.addEventListener('focus',qSync); ta.addEventListener('blur',qSync);
  function quotePaint(){
    var on=!!(QTE&&QTE.text&&!MIN);
    qteBar.hidden=!on;
    var fd=ta&&ta.closest('.field');
    if(fd) fd.classList.toggle('tk-quoting',on);
    qteBar.classList.toggle('qdark', on&&!!fd&&quoteDark(fd));   /* 字色明暗：看输入框底色实际亮度，见 quoteDark */
    if(on){
      qteBar.querySelector('.tx').textContent=String(QTE.text).replace(/\s+/g,' ').trim();
      qteBar.querySelector('.who').textContent=quoteWho(QTE.role);
    }
    if(!MIN) dockSync();   /* 独立引用层也计入消息区底部留白，避免遮住最后一条消息 */
  }
  function quotePlain(b){
    if(!b) return '';
    var root=b.querySelector('.tk-qbody')||b, t=root.innerText!=null?root.innerText:(root.textContent||'');
    return String(t).replace(/ /g,' ').replace(/\s+$/,'').replace(/^\s+/,'').trim();
  }
  function quoteRole(b){ return (b&&b.closest('.tk-g.me'))?'用户':'AI'; }
  /* [位置:phone-talk.js·quoteWho] [引用预览条发送者前缀] [2026-11-24：引用条要像真正的引用块，前面带「助手：」或「我：」；名字取顶栏胶囊 #tkNm 的当前文字，取不到退回「AI：」] [注释时间 2026-11-24] */
  /* [位置:phone-talk.js·quoteDark] [引用预览条字色明暗判定] [2026-11-24 要引用条字色跟输入框底色走。输入框底 = 白色磨砂（alpha 已含主题 --wk 与输入框档 data-ib）叠在壁纸上，实际明暗是「主题 x 壁纸 x 输入框档」的合成：只看 #device.cbgdark 会在「日间 + 深壁纸」判反——那种情况输入框其实是七成多白的浅灰，浅字压上去发灰看不清。所以读输入框实际底色（引用时输入框已聚焦，读到的是聚焦态）的 alpha，叠上壁纸亮度（cbgdark 深壁纸取 sRGB 22、浅壁纸取 238）算出亮度，过交叉点用深字、不到用浅字，结果挂 .qdark。四种日夜 x 壁纸深浅 x 两档输入框逐项实测见 _tests/quote-select-dom-20261124.py] [注释时间 2026-11-24] */
  function quoteDark(fd){
    var dk=!!(P.D&&P.D.classList.contains('cbgdark')), w=dk?22:238;
    var m=/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\)$/.exec(String(getComputedStyle(fd).backgroundColor||'').trim());
    if(!m) return dk;
    var a=(m[4]==null||m[4]==='')?1:parseFloat(m[4]);
    function lin(c){ c=parseFloat(c)/255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); }
    var lum=0.2126*lin(a*parseFloat(m[1])+(1-a)*w)+0.7152*lin(a*parseFloat(m[2])+(1-a)*w)+0.0722*lin(a*parseFloat(m[3])+(1-a)*w);
    return lum<0.22;   /* 0.22 是两套配色对比度的交叉点（低于它浅字更清楚，高于它深字更清楚），约 sRGB 128 的中灰 */
  }
  function quoteWho(role){
    if(role==='用户') return '我：';
    var nm=$('#tkNm',win), n=(nm&&nm.firstChild&&nm.firstChild.nodeValue)||'';
    n=String(n).trim();
    return (n||'AI')+'：';
  }
  function quoteFrom(b){
    if(MIN) return;
    var tx=quotePlain(b);
    if(!tx){ toast('这条没有可引用的文本'); return; }
    try{ ta.focus(); }catch(e){}   /* 先聚焦再画：引用期间输入框是聚焦态（底色更实），quoteDark 要按这个状态判 */
    QTE={role:quoteRole(b), text:tx}; qSync();
  }
  function quoteApply(tx){
    if(!QTE||!QTE.text||MIN) return tx;
    return qteWrap(QTE.role, QTE.text, tx);
  }
  /* [位置:phone-talk.js·selPlain] [选择文本弹窗取文] [取被长按气泡的可见文本：自己的引用回显气泡只取 .tk-qbody（本轮输入），其余取整只气泡。先克隆一份摘掉按钮和代码块的语言小标（界面字样，不是消息正文）再读 innerText，换行才保得住；克隆件挪到屏幕外挂一下读完即删（不能 visibility:hidden，那样 innerText 是空串）。2026-11-24] */
  function selPlain(b){
    var src=(b.querySelector('.tk-qbody')||b), c=src.cloneNode(true), t='';
    try{
      Array.prototype.forEach.call(c.querySelectorAll('button,.md-ph small'),function(x){ if(x.parentNode) x.parentNode.removeChild(x); });
      c.style.cssText='position:fixed;left:-9999px;top:0;width:300px;pointer-events:none';   /* 不能 visibility:hidden：浏览器对它的 innerText 返回空串（11-24 实测） */
      host.appendChild(c);
      t=(c.innerText!=null)?c.innerText:String(c.textContent||'');
    }catch(e){ t=String((src.innerText!=null)?src.innerText:(src.textContent||'')); }
    if(c.parentNode) c.parentNode.removeChild(c);
    return String(t).replace(/\u00a0/g,' ').replace(/\s+$/,'').replace(/^\s+/,'');
  }
  /* [位置:phone-talk.js·selPop] [选择文本弹窗] [2026-11-24：长按菜单「选择文本」原来只是悄悄给气泡加 .tk-selmode 放开选字——没有任何提示、点不出选区，隔一会儿长按又会被气泡菜单打断。改成直接弹 .ses-pop 阅读窗（复用 sheet，cf 居中 + tk-sel）：正文区完全放开原生选字，弹窗挂在 host 上不在消息列表里，聊天长按菜单拦不到；底部「复制选中 / 复制全文 / 关闭」，没划选时「复制选中」按全文复制并提示。原 .tk-selmode / selBub / lpCool 逻辑一并删除。极简主题不启用] [注释时间 2026-11-24] */
  var selPopCur=null;   /* 当前弹窗的 selectionchange 监听；弹窗节点被移除后下一次选区变化自清 */
  function selPop(b){
    if(MIN||!b||!b.classList||!b.classList.contains('b')) return null;
    var tx=selPlain(b);
    if(!tx){ toast('这条没有可选择的文本'); return null; }
    var who=quoteWho(quoteRole(b)).replace(/：$/,'');
    var pop=sheet('<div class="hd"><span>选择文本</span><em class="ts-who">'+esc(who)+'</em><button type="button" class="ts-x" aria-label="关闭">'+(I.qx||'')+'</button></div>'+
      '<div class="ts-body"></div>'+
      '<div class="ts-b"><button type="button" class="ts-btn" data-a="sel">复制选中</button><button type="button" class="ts-btn" data-a="all">复制全文</button></div>'+
      '<button type="button" class="ts-btn" data-a="close">关闭</button>','cf tk-sel',function(box,close){
      var body=box.querySelector('.ts-body');
      body.textContent=tx;
      function picked(){
        var se=window.getSelection();
        if(!se||se.isCollapsed||!se.rangeCount) return '';
        if(!body.contains(se.getRangeAt(0).commonAncestorContainer)) return '';
        return String(se.toString()||'').replace(/^\s+|\s+$/g,'');
      }
      function up(){
        if(!pop.isConnected){ if(selPopCur===up) selPopCur=null; document.removeEventListener('selectionchange',up); return; }
        var on=!!picked();
        if(box._sel!==on){ box._sel=on; box.classList.toggle('has-sel',on); }
      }
      if(selPopCur) document.removeEventListener('selectionchange',selPopCur);
      selPopCur=up; document.addEventListener('selectionchange',up);
      box.querySelector('.ts-x').addEventListener('click',function(){ buzz(6); close(); });
      box.addEventListener('click',function(e){
        var x=e.target.closest('.ts-btn[data-a]'); if(!x) return;
        var k=x.getAttribute('data-a');
        if(k==='close'){ buzz(6); close(); return; }
        var sel=(k==='sel')?picked():'', full=!sel;   /* 「复制选中」没选区 = 退回复制全文，toast 里说明 */
        copyText(full?tx:sel).then(function(){ toast((k==='sel'&&full)?'没有选中文字，已复制全文':'已拷贝'); },function(){ toast('这台手机不让拷贝'); });
        buzz(8); close();
      });
    },{single:true,noKb:true});
  }

  /* ---------- 渲染 ---------- */
  /* 语音条长度跟秒数走：短的短、长的长，开根号让前几秒长得快、后面慢下来，最短 40 最长 170 */
  function vwOf(sec){ return Math.round(Math.max(40,Math.min(170,16+Math.sqrt(Math.max(1,sec))*32))); }
  /* [位置:phone-talk.js·voiceHTML] [AI 语音气泡带合成文本 data-tt] [10-30：AI 的 <voice> 气泡此前无 data-src 点击只走假动画；现在把 voice 文本写进 data-tt（截 1500=网关 /admin/tts 截断同款），点击实时合成真语音；用户录音（src/vid）不受影响] [注释时间 2026-10-30 改] */
  function voiceHTML(m){ var w=vwOf(m.voice), n=Math.max(6,Math.round(w/6)), bars=''; for(var i=0;i<n;i++) bars+='<u style="--h:'+(30+Math.round(Math.abs(Math.sin(i*1.7+m.voice))*70))+'%"></u>'; return '<div class="vb" data-sec="'+m.voice+'"'+(m.src?' data-src="'+esc(m.src)+'"':m.vid?' data-src="/uploads/voice-'+esc(m.vid)+'.wav"':' data-tt="'+esc(String(m.x==null?'':m.x).slice(0,1500))+'"')+'><button class="vp" aria-label="播放">'+I.play+'</button><span class="vw" style="width:'+w+'px">'+bars+'</span><em>'+m.voice+'″</em></div>'; }

  /* [位置:phone-talk.js·mnRow/mnUnits/aiTx] [极简样式：思考行 / 工具行 / 按时间线拆单元] [一条助手消息 = 有序单元（思考行、正文、工具行、思考行、正文…）；有 stream_timeline 且正文对得上就按它交替，对不上或旧消息回退「思考与工具在前、正文在后」；展开状态存在 MO（key=消息id:单元序号），重画不丢] [注释时间 2026-10-21] */
  var MO={};   /* 11-15：极简思考行改「默认全部折叠，点击才展开」——原 live 思考默认铺开的逻辑删除，配套的 MC（手动收起记忆）随之成为死代码，一并清掉 */
  /* [位置:phone-talk.js·mnKv] [工具步骤的入参/结果两块] [2026-10-27 晚（产品确定）：去掉原来入参/结果各 3000 字的前端截断——数据层本来就是全量（stream_timeline 单条结果上限 20000，见 mcp-tool-loop），截断只挡住了看；结果框有 CSS 限高 + 滚动，超长不至于撑爆版面] [注释时间 2026-10-27 改] */
  /* [位置:phone-talk.js·toolImgs/resText/thumbsHTML] [工具返回的图显示缩略图] [10-27：工具（截图 / 看图）返回的图，结果文字里是 ![](https://…/uploads/shot-xxx.jpg)；工具行下面直接显示缩略图（不用展开），点开大图；结果文字里把这串链接换成「[图片]」，免得一长串地址占版面。只认本站 /uploads/ 的图] [注释时间 2026-10-27] */
  var IMG_RE=/!\[\]\((https?:\/\/[^)\s]*\/uploads\/[A-Za-z0-9._-]+|\/uploads\/[A-Za-z0-9._-]+)\)/g;
  function toolImgs(t){ var s=String((t&&t.result)||''), out=[], m; IMG_RE.lastIndex=0; while((m=IMG_RE.exec(s))) out.push(m[1]); return out; }
  function resText(s){ return String(s||'').replace(IMG_RE,'[图片]'); }
  function thumbsHTML(urls){ return urls.length?'<div class="tk-timgs">'+urls.map(function(u){ return '<span class="tk-timg" role="button" aria-label="查看大图"><img src="'+esc(u)+'" alt="" loading="lazy"></span>'; }).join('')+'</div>':''; }
  /* [位置:phone-talk.js·tvArgs/tvRes] [工具卡「入参 / 结果」只显示有用的] [10-28 第7项：把没用的都去掉（只改显示，不改落库、不改发给模型的内容）。入参：隐藏网关注入的 session_id（只限它注入的那批工具，subagent 的 session_id 是任务句柄要留）、空值；结果：整段是 JSON 对象时去掉恒真的 ok/success 和空值，剩下的缩进显示，什么都不剩就写「完成」；失败的错误原样；不是 JSON 的文本原样。规则表就是 TV_INJECT 这一处，加工具改这里] [注释时间 2026-10-28] */
  var TV_INJECT=['lovediary','lovediary_add','notebook','notebook_add','notebook_list','memory','memory_add','album','context','wake','diary_add'];   /* 网关会注入 session_id 的工具，同 mcp-tool-loop SESSION_SCOPED_TOOLS */
  function tvEmpty(v){ return v===''||v==null||(Array.isArray(v)&&!v.length)||(v&&typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length); }
  function tvParse(s){ if(s&&typeof s==='object') return s; if(typeof s!=='string') return null; try{ return JSON.parse(s); }catch(e){ return null; } }
  function tvArgs(t){ var o=tvParse(t.args); if(!o||typeof o!=='object'||Array.isArray(o)) return pj(t.args);
    var out={}; Object.keys(o).forEach(function(k){ var v=o[k]; if(tvEmpty(v)) return; if(k==='session_id'&&TV_INJECT.indexOf(t.name)>=0) return; out[k]=v; });
    return Object.keys(out).length?JSON.stringify(out,null,1):''; }
  function tvRes(t){ if(t.error) return resText(t.error);
    var raw=t.result, o=(typeof raw==='string'&&/^\s*\{/.test(raw))?tvParse(raw):null;
    if(!o||Array.isArray(o)) return resText(raw);
    var out=tvClean(o,true);
    return Object.keys(out).length?resText(JSON.stringify(out,null,1)):'完成'; }
  function tvClean(o,top){ if(Array.isArray(o)) return o.map(function(x){ return (x&&typeof x==='object')?tvClean(x):x; });
    var out={}; Object.keys(o).forEach(function(k){ var v=o[k]; if(v&&typeof v==='object') v=tvClean(v); if(tvEmpty(v)||(top&&(k==='ok'||k==='success')&&v===true)) return; out[k]=v; }); return out; }   /* 嵌套里的空值也去；恒真的 ok/success 只在最外层去 */
  P.tv={args:function(t){ return tvArgs(t); },res:function(t){ return tvRes(t); }};
  function mnKv(t){ var h='', a=tvArgs(t);
    if(a) h+='<div class="kv"><small>入参</small><code>'+esc(a)+'</code></div>';
    if(t.st==='run') h+='<div class="kv"><small>结果</small><code class="wait">等结果</code></div>';
    else if(t.error||t.result) h+='<div class="kv"><small>'+(t.error?'出错':'结果')+'</small><code>'+esc(tvRes(t))+'</code></div>';
    return h; }
  var OPENX=null;   /* 子 AI 抽屉重画时把自己的展开记忆借给 mnRow（组里嵌套的行也要保持展开），用完置空 */
  /* [位置:phone-talk.js·mergeTools/mergeLive] [把两段正文之间的连续思考与工具并成一组] [11-18：极简主题与子 AI 抽屉共用同一口径——两段正文之间交替出现的思考与工具（>=2 步）全部收进同一个工具箱折叠行（k:'chain'），单步保持原样；key 取第一个步骤（组变大 key 不变，展开状态不丢）] [注释时间 2026-11-18 改] */
  function mergeTools(o){ var out=[], run=[];
    function flush(){
      if(run.length>1) out.push({s:'ai',chain:{k:'chain',list:run.map(function(u){ return u.chain; })},key:run[0].key,raw:run[0].raw,rec:run[0].rec});
      else if(run.length) out.push(run[0]);
      run=[];
    }
    o.forEach(function(u){ if(u.chain&&(u.chain.k==='think'||u.chain.k==='tool')) run.push(u); else { flush(); out.push(u); } });
    flush(); return out; }
  function mergeLive(out){ var o=[], run=[];
    function flush(){
      if(run.length>1) o.push({t:'chain',list:run.map(function(u){ return u.t==='r'?{k:'think',text:u.text,dur:u.dur,live:u.live}:{k:'tool',t:u.tool}; }),i:run[0].i});
      else if(run.length) o.push(run[0]);
      run=[];
    }
    out.forEach(function(u){ if(u.t==='r'||(u.t==='tool'&&u.tool)) run.push(u); else { flush(); o.push(u); } });
    flush(); return o; }
  /* [位置:phone-talk.js·MCP] [极简思考行整段选中按钮] [10-31：极简思考行标题右侧一键整段选中；10-31：工具行不加（工具内容不用翻译），只留思考行；.mn-h 本身是 button 不能嵌套按钮，用 i+role=button 放行内，位置见 .mn-cp CSS] [注释时间 2026-10-31] */
var MCP='<i class="mn-cp" role="button" aria-label="整段选中">'+I.sel+'</i>';
/* [位置:phone-talk.js·LZ/lzBox/lzFill] [折叠的思考/工具块点开才建 DOM] [11-06：聊天页进会话慢，量出来时间全在手机端建 DOM（服务端 20ms、网络有 gzip），
   而极简样式里每条工具行的入参/结果、每条思考行的整段思考都**默认是折叠的**，却照样把几万字建成了节点（一条消息里 stream_timeline 就有 46 个节点、单个思考 23KB）。
   现在折叠的花费为 0：只留一个空 .mn-b（带 data-lzi 指向内存里的构建函数），点开那一下才真正建 DOM。
   不丢任何数据——内容一直在内存里，展开时现建；展开过的行（MO[key]=1）重画时照旧直接建好，不会展开着又变空] [注释时间 2026-11-06] */
var LZ={}, LZSEQ=0;
/* [位置:phone-talk.js·lzBox] [按行 key 记构建函数] [11-06 晚：原来每次 ++LZSEQ 给新索引，同一行每帧生成的 html 都不一样，
   mnSyncRow 的 TW.rh[key]===html 缓存永远不成立 —— 实时区每帧都把思考全文/工具入参重写一遍，行和「Thinking」按钮在手指底下被换掉，
   iOS 就不再发 click（也就是「输出中的行点不开」）；LZ 表还只增不减。改成同 key 复用同一索引：内容没变 html 不变、缓存命中、DOM 一个字节不碰] [注释时间 2026-11-06 晚] */
function lzBox(key,build){
  var i=(key!==undefined&&key!==null&&key!=='')?'k'+key:('#'+(++LZSEQ));
  LZ[i]=build; return '<div class="mn-b lazy" data-lzi="'+esc(i)+'"></div>'; }
function lzFill(root){
  if(!root||!root.querySelector) return;
  Array.prototype.forEach.call(root.querySelectorAll('.mn-b.lazy'),function(b){
    var i=b.getAttribute('data-lzi'), f=i&&LZ[i];
    b.classList.remove('lazy');
    if(!f){ b.innerHTML=''; return; }
    try{ b.innerHTML=f(); }catch(e){ b.innerHTML=''; }
  });
}
function lzReset(){ LZ={}; LZSEQ=0; }
/* [位置:phone-talk.js·fmtDur/tlDur] [思考段耗时] [11-18：极简主题思考行结束后标题显示「Thought · 5s」；耗时=时间线上这段思考的下一节点 ts − 本节点 ts（没有下一节点用整条收尾时刻兜底），节点 ts 由后端时间线与前端实时帧共同记录（2026-11-18 起新消息落盘带 ts），旧消息无 ts 自然不显示；<1s 不显示（无信息量），>=60s 显示 1m 20s] [注释时间 2026-11-18] */
function fmtDur(ms){ if(!(ms>0)) return ''; var s=Math.round(ms/1000); if(s<1) return ''; if(s<=60) return s+'s'; return Math.floor(s/60)+'m '+(s%60)+'s'; }   /* s<=60：59.9s 四舍五入进到 60 时显示 60s 而不是 1m 0s */
function tlDur(list,i,endMs){ try{ var n=list&&list[i]; if(!n||!n.ts) return 0;
  var t=0; for(var j=i+1;j<list.length;j++){ if(list[j]&&list[j].ts){ t=list[j].ts; break; } }
  if(!t) t=(endMs>0?endMs:0); if(!t||t<=n.ts) return 0; return t-n.ts; }catch(e){ return 0; } }
var TRC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>';
function mnRow(c,key,live){
    var open=(key&&(MO[key]||(OPENX&&OPENX[key])))?' open':'';   /* 10-30：OPENX（子 AI 抽屉借来的展开记忆）三种行统一在这里认，原来只有工具组自己认、单个工具要调用方事后补 open。11-15：思考行不再 live 默认铺开——默认全部折叠，点「Thinking/Thought」才展开（点开的展开记忆 MO 不变）；工具行原本就默认折叠，不受影响 */
    if(c.k==='trace'){
      var trb=function(){ var b=String(c.text||'').trim(); return b?md(b):''; };
      return {cls:'mn-row trace'+open+(live?' live':''),h:'<button class="mn-h" type="button">'+TRC+'<span>此刻</span><i class="mn-chv"></i></button>'+(open?'<div class="mn-b">'+trb()+'</div>':lzBox(key,trb)),raw:1,key:key}; }
    if(c.k==='think'){
      var tb=esc(c.text).replace(/\n/g,'<br>');
      var du=live?'':fmtDur(c.dur);   /* 11-18：思考中不显示秒数，这段思考结束后标题带耗时（Thought · 5s） */
      return {cls:'mn-row think'+open+(live?' live':''),h:'<button class="mn-h" type="button">'+I.think+'<span>'+(live?'Thinking':'Thought'+(du?' · '+du:''))+'</span><i class="mn-chv"></i></button>'+MCP+(open?'<div class="mn-b">'+tb+'</div>':lzBox(key,function(){ return tb; })),raw:1,key:key}; }
    /* [位置:phone-talk.js·mnRow(k==='chain'||k==='tools')] [思考与工具链收进工具箱] [11-18（参考 Claude）：两段正文之间 >=2 步的思考与工具收进同一个工具箱折叠行，标题按「Thought · 12s · 3 tools」风格汇总，点开按顺序直接平铺每步不套娃；纯工具组保持「Used N tools」] [注释时间 2026-11-18 改] */
    if(c.k==='chain'||c.k==='tools'){
      var L=c.k==='tools'?(c.list||[]).map(function(x){ return {k:'tool',t:x}; }):(c.list||[]);
      var thN=0, thDur=0, thLive=false, tlList=[], gRun=false, gFail=0;
      L.forEach(function(x){
        if(x.k==='think'){ thN++; if(x.dur>0) thDur+=x.dur; if(x.live) thLive=true; }
        else if(x.k==='tool'&&x.t){ tlList.push(x.t); if(x.t.st==='run') gRun=true; if(x.t.st==='fail') gFail++; }
      });
      var isLive=thLive||gRun, title='';
      if(!thN){
        title=(gRun?'Using ':'Used ')+'<b>'+tlList.length+' tools</b>'+(gFail?' · '+gFail+' failed':'');
      }else{
        var du=thLive?'':fmtDur(thDur);
        title=(thLive?'Thinking':'Thought')+(du?' · '+du:'');
        if(tlList.length) title+=' · <b>'+tlList.length+(tlList.length===1?' tool':' tools')+'</b>';
        else if(thN>1) title+=' · '+thN+' steps';
        if(gFail&&!gRun) title+=' · '+gFail+' failed';
      }
      var imgs=tlList.reduce(function(a,x){ return a.concat(toolImgs(x)); },[]);
      var bodyFn=function(){ return L.map(function(x,j){ var k2=(key||'')+'.'+j; return mnRowHTML(mnRow(x,k2,x.live),k2); }).join(''); };
      return {cls:'mn-row tool tools'+(isLive?' run':'')+(thLive?' live':'')+(gFail&&!isLive?' fail':'')+open,h:'<button class="mn-h" type="button">'+I.tbox+'<span>'+title+'</span>'+(isLive?'<i class="spin"></i>':'')+'<i class="mn-chv"></i></button>'+thumbsHTML(imgs)+(open?'<div class="mn-b">'+bodyFn()+'</div>':lzBox(key,bodyFn)),raw:1,key:key};
    }
    var t=c.t, run=t.st==='run', fail=t.st==='fail';
    return {cls:'mn-row tool'+(run?' run':'')+(fail?' fail':'')+open,h:'<button class="mn-h" type="button">'+toolIco(t.name)+'<span>'+(run?'Using ':fail?'Failed · ':'Used ')+'<b>'+esc(t.name||'tool')+'</b></span>'+(run?'<i class="spin"></i>':'')+'<i class="mn-chv"></i></button>'+thumbsHTML(toolImgs(t))+ (open?'<div class="mn-b">'+(mnKv(t)||'<div class="kv"><small>无记录</small></div>')+'</div>':lzBox(key,function(){ return mnKv(t)||'<div class="kv"><small>无记录</small></div>'; })),raw:1,key:key}; }
  /* [位置:phone-talk.js·subSidOf] [子进程步骤取 subagent_id（输入框上方悬浮条 subDock 用；行内「查看」按钮 10-30 已删）] [批3：subagent 工具步骤从入参或回执 JSON 拿 subagent_id，渲染「查看过程」小按钮，点击走文档级委托开过程抽屉；历史抽屉（stepHTML）与消息流（mnRow）两处共用] [注释时间 2026-10-26] */
  function subSidOf(t){
    var s=[t.args,t.result];
    for(var i=0;i<s.length;i++){ try{ var o=typeof s[i]==='string'?JSON.parse(s[i]):s[i]; if(o&&o.subagent_id) return String(o.subagent_id); }catch(e){} }
    return '';
  }
  /* [位置:phone-talk.js·tlCheck] [stream_timeline 可用性判定（消息流 mnUnits 与子进程抽屉 flow 共用）] [判定能否按 stream_timeline 真实先后渲染：timeline 非空、有思考或工具节点、text 节点拼起来与展示正文对得上；原判定两处各抄一份（一处裸比、一处过 cardsOf/stripTags），收拢成一处，clean 参数容纳清洗差异；返回 {ok,hasR,hasT}——mnUnits 还要拿 hasR 决定要不要补消息级思考链] [注释时间 2026-10-27] */
  function tlCheck(tl, text, clean){
    var out={ok:false,hasR:false,hasT:false};
    clean=clean||function(s){ return s; };
    if(!Array.isArray(tl)||!tl.length) return out;
    var parts=[];
    for(var i=0;i<tl.length;i++){ var n=tl[i]; if(!n) continue;
      if(n.type==='reasoning'&&n.text) out.hasR=true;
      else if(n.type==='tool'&&n.tool) out.hasT=true;
      else if(n.type==='text') parts.push(String(n.text||'')); }
    if(!out.hasR&&!out.hasT) return out;
    var nz=function(x){ return String(x||'').replace(/\s+/g,''); };
    out.ok=nz(clean(parts.join('')))===nz(clean(String(text||'')));
    return out;
  }
  /* [位置:phone-talk.js·subSheet] [子 AI 任务查看抽屉] [固定任务与状态、完整会话过程、轻量运行反馈和不抢滚动位置；替代气泡式任务与回弹动效] [注释时间 2026-10-27] */
  function subSheet(sid0){
    var sid=String(sid0||'').replace(/[^A-Za-z0-9_-]/g,''); if(!sid) return;
    var WORD={running:'运行中',done:'已完成',interrupted:'已中断',failed:'失败',timeout:'超时',stopped:'已终止'};
    var tm=0, OPENK={}, TASKK={}, lastHTML='', lastCount=0, rev=-1, busy=false, stopping=false, scrollRaf=0, headH='', headIds='';
    var detailURL='/heartbeat/admin/subagent-detail?session_id='+encodeURIComponent(sid);
    sheet('<i class="mcgrab grab"></i><div class="mch sb-head"><button class="mcx tap" data-a="x" aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="sb-title"><b>子 AI 任务</b><span data-r="title">读取中…</span></div><span class="sb-st" data-r="st" role="status">读取中…</span></div><div class="opt tk-pan"><div class="sb-bd" data-r="bd"><div class="sb-msg">读取中…</div></div><button class="sb-latest tap" data-r="latest" type="button" hidden>'+I.down+'<span>回到最新</span></button></div><div class="sb-live" data-r="live" hidden><i class="sb-spin"></i><span data-r="activity" role="status" aria-live="polite">运行中</span><button class="sb-stop tap" data-r="stop" type="button">终止</button></div>','opts mcp sub',function(box,close){
      var pop=box.parentNode, bd=box.querySelector('[data-r=bd]'), stEl=box.querySelector('[data-r=st]'), titleEl=box.querySelector('[data-r=title]'), stopBtn=box.querySelector('[data-r=stop]'), live=box.querySelector('[data-r=live]'), actEl=box.querySelector('[data-r=activity]'), latest=box.querySelector('[data-r=latest]');
      box.querySelector('[data-a=x]').addEventListener('click',close);
      /* [位置:phone-talk.js·subSheet.schedule] [抽屉刷新调度] [关闭后停止、拖动时稍后重试，避免轮询重叠和关闭后残留] [注释时间 2026-10-27] */
      function schedule(ms){ clearTimeout(tm); if(pop.isConnected&&ms>0) tm=setTimeout(tick,ms); }
      function nearBottom(){ return bd.scrollHeight-bd.scrollTop-bd.clientHeight<70; }
      /* [位置:phone-talk.js·subSheet.paintLatest] [回到最新按钮] [只有用户离开底部且内容可滚动时出现，不抢用户的滚动位置] [注释时间 2026-10-27] */
      function paintLatest(){ latest.hidden=!(bd.scrollHeight>bd.clientHeight+40&&bd.scrollHeight-bd.scrollTop-bd.clientHeight>100); }
      bd.addEventListener('scroll',function(){ if(scrollRaf) return; scrollRaf=requestAnimationFrame(function(){ scrollRaf=0; paintLatest(); }); },{passive:true});
      latest.addEventListener('click',function(){
        var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if(bd.scrollTo) bd.scrollTo({top:bd.scrollHeight,behavior:reduce?'auto':'smooth'}); else bd.scrollTop=bd.scrollHeight;
        latest.hidden=true; buzz(4);
      });
      /* 任务、思考、工具、复制与错误重试都由抽屉自己接管，不依赖主聊天容器的事件委托。 */
      bd.addEventListener('click',function(e){
        var retry=e.target.closest('[data-r=retry]'); if(retry){ fetch1(false); return; }
        var tb=e.target.closest('[data-task]');
        if(tb){ var tk=tb.getAttribute('data-task')||'', tx=tb.closest('.sb-taskbox'), open=!tx.classList.contains('open'); tx.classList.toggle('open',open); TASKK[tk]=open?1:0; tb.setAttribute('aria-expanded',open?'true':'false'); tb.querySelector('small').textContent=open?'收起任务':'展开任务'; buzz(4); return; }
        var ti2=e.target.closest('.tk-timg'); if(ti2){ viewImg(ti2); return; }
        var cp=e.target.closest('.md-cp');
        if(cp){ e.stopPropagation(); var cd=cp.closest('.md-code'); cd=cd&&cd.querySelector('code'); if(!cd) return;
          copyText(cd.textContent).then(function(){ cp.textContent='已复制'; cp.classList.add('ok'); buzz(4); setTimeout(function(){ cp.textContent='复制'; cp.classList.remove('ok'); },1200); },function(){ toast('这台手机不让拷贝'); });
          return; }
        var mh=e.target.closest('.mn-h'); if(!mh) return;
        var rw=mh.parentNode, k=rw.getAttribute('data-mk')||''; rw.classList.toggle('open');
        if(rw.classList.contains('open')) lzFill(rw);   /* 子进程抽屉里的折叠行同理 */
        if(k){ if(rw.classList.contains('open')) OPENK[k]=1; else delete OPENK[k]; } buzz(4);
      });
      stopBtn.addEventListener('click',function(){
        if(stopBtn.disabled) return; stopBtn.disabled=true; stopBtn.textContent='终止中…';
        P.net.req('/heartbeat/admin/subagent-stop',{method:'POST',body:{session_id:sid},noLogin:true}).then(function(r){
          if(r&&r.ok===false){ stopBtn.disabled=false; stopBtn.textContent='终止'; return; }
          stopping=true; stopBtn.textContent='已发终止信号'; actEl.textContent='正在等待当前工具收尾'; schedule(500);
        },function(){ stopBtn.disabled=false; stopBtn.textContent='终止'; });
      });
      function paintErr(t){ bd.innerHTML='<div class="sb-msg">'+esc(t)+'</div><button class="sb-retry tap" data-r="retry" type="button">重新加载</button>'; lastHTML=''; lastCount=0; live.hidden=true; latest.hidden=true; }
      /* [位置:phone-talk.js·subSheet.flow] [一条子会话消息按会话的样子铺开] [保持思考、工具、正文的真实顺序与全文展示，UI 重排不另造过程数据] [注释时间 2026-10-27] */
      function flow(m,mi){
        var tl=Array.isArray(m.stream_timeline)?m.stream_timeline:[], content=String(m.content||'');
        var cleanT=function(t){ return String(t||'').replace(/<\/?\s*report\b[^>]*>/gi,''); };
        var ok=tlCheck(tl,content).ok, seq=[];
        if(ok){
          tl.forEach(function(n,i){
            if(!n) return;
            if(n.type==='reasoning'&&n.text) seq.push({k:'think',text:n.text,dur:tlDur(tl,i,m.time?(+new Date(m.time)||0):0),key:'sb'+mi+':'+i});
            else if(n.type==='tool'&&n.tool){ var t=toolOf(n.tool); if(t.st==='run'&&!m.live) t.st='done'; seq.push({k:'tool',t:t,key:'sb'+mi+':'+i}); }
            else if(n.type==='text'&&String(n.text||'').trim()) seq.push({k:'text',text:n.text});
          });
        }else{
          if(m.reasoning) seq.push({k:'think',text:m.reasoning,key:'sb'+mi+':r'});
          (m.tools||[]).forEach(function(t,i){ var x=toolOf(t); if(x.st==='run'&&!m.live) x.st='done'; seq.push({k:'tool',t:x,key:'sb'+mi+':t'+i}); });
          if(content.trim()) seq.push({k:'text',text:content});
        }
        /* 2026-11-18：连续思考与工具（>=2 步）收进同一个工具箱折叠行（同消息流口径） */
        var mseq=[], mrun=[];
        function mflush(){ if(mrun.length>1) mseq.push({k:'chain',list:mrun.map(function(y){ return y.k==='think'?{k:'think',text:y.text,dur:y.dur}:{k:'tool',t:y.t}; }),key:mrun[0].key}); else if(mrun.length) mseq.push(mrun[0]); mrun=[]; }
        seq.forEach(function(x){ if(x.k==='think'||(x.k==='tool'&&x.t)) mrun.push(x); else { mflush(); mseq.push(x); } });
        mflush(); seq=mseq;
        var html='', seenText=false; OPENX=OPENK;
        seq.forEach(function(x){
          if(x.k==='text'){ seenText=true; var ct=cleanT(x.text); if(ct.trim()) html+='<div class="sb-md b md">'+md(ct)+'</div>'; return; }
          var r=x.k==='think'?mnRow({k:'think',text:x.text,dur:x.dur},x.key):x.k==='chain'?mnRow({k:'chain',list:x.list},x.key):x.k==='tools'?mnRow({k:'tools',list:x.list},x.key):mnRow({k:'tool',t:x.t},x.key);
          html+='<div class="'+r.cls+(OPENK[x.key]?' open':'')+'" data-mk="'+esc(x.key)+'">'+r.h+'</div>';
        });
        OPENX=null;
        if(!seenText&&!content.trim()&&!m.live) html+='<div class="sb-msg">（这条没有正文）</div>';
        return html;
      }
      /* [位置:phone-talk.js·subSheet.taskBlock] [任务全文折叠块] [短任务直接看、长任务默认收起并保留每轮任务顺序，不再伪装成右侧聊天气泡] [注释时间 2026-10-27] */
      function taskBlock(text,mi){
        var key='task'+mi, raw=String(text||''), long=raw.length>140||/\n/.test(raw), open=TASKK[key]===1||(TASKK[key]!==0&&!long);
        return '<section class="sb-taskbox'+(open?' open':'')+'"><button class="sb-taskhead" data-task="'+key+'" type="button" aria-expanded="'+(open?'true':'false')+'"><span>任务</span><small>'+(open?'收起任务':'展开任务')+'</small></button><div class="sb-task b md">'+md(raw)+'</div></section>';
      }
      /* [位置:phone-talk.js·subSheet.activityText] [当前运行动作文案] [只展示后端真实阶段和工具名，不伪造进度百分比或完成时间] [注释时间 2026-10-27] */
      function activityText(d){
        var a=d&&d.activity||{};
        if(stopping||a.phase==='stopping') return '正在等待当前工具收尾';
        if(a.phase==='tool') return '正在调用 '+(a.tool||'工具');
        if(a.phase==='thinking') return '正在思考';
        if(a.phase==='writing'||a.phase==='finalizing') return '正在整理回复';
        if(a.phase==='preparing') return '正在准备';
        return '运行中';
      }
      /* [位置:phone-talk.js·subSheet.paintStatus] [固定标题状态与底部运行条] [轻量轮询只更新这几个节点，不重画长正文；终止等待期保持明确反馈] [注释时间 2026-10-27] */
      function paintStatus(d){
        var run=d.status==='running', title=String(d.task||'').replace(/\s+/g,' ').trim();
        titleEl.textContent=title||'—'; titleEl.title=title;
        stEl.textContent=WORD[d.status]||d.status||'—'; stEl.className='sb-st '+(run?'run':(d.status==='done'?'ok':'bad'));
        if(!run){ stopping=false; live.hidden=true; return; }
        if(d.activity&&d.activity.phase==='stopping') stopping=true;
        live.hidden=false;
        var at=activityText(d); if(actEl.textContent!==at) actEl.textContent=at;
        stopBtn.disabled=stopping; stopBtn.textContent=stopping?'已发终止信号':'终止';
      }
      /* [位置:phone-talk.js·subSheet.paint] [完整时间线增量展示] [内容未变不重画、只有新增末块轻动效、底部跟随与用户翻阅互不干扰] [注释时间 2026-10-27] */
      /* [位置:phone-talk.js·subSheet.secOf] [单条过程块] [任务块/回合块统一生成，缓存前置块用] [注释时间 2026-10-30] */
      function secOf(m,mi){ return m.role==='user'?taskBlock(m.content,mi):'<section class="sb-turn">'+flow(m,mi)+'</section>'; }
      /* [位置:phone-talk.js·subSheet.paint] [只重画最后一条] [2026-10-30：子智能体跑时手机烫。原来运行中每 1.5s 全量重建整份过程（含前面所有消息的 md/工具渲染）；子会话时间线是「任务 + 一条实时回复」，前面的任务块不会变，现在缓存前置块 HTML，只重算最后一条；消息条数变多时才整段重建] [注释时间 2026-10-30] */
      function paint(d){
        if(!pop.isConnected) return true;
        paintStatus(d);
        if(box.classList.contains('dw-drag')) return false;
        var tl=d.timeline||[], n=tl.length, h='';
        var pre=''; for(var pi=0;pi<n-1;pi++) pre+=String((tl[pi]&&tl[pi].id)||'')+'|';
        if(n>1 && pre===headIds && headH){ h=headH+secOf(tl[n-1],n-1); }
        else {
          if(n>1){ var hb=''; for(var pj=0;pj<n-1;pj++) hb+=secOf(tl[pj],pj); headH=hb; headIds=pre; h=hb+secOf(tl[n-1],n-1); }
          else { headH=''; headIds=''; h=n?secOf(tl[0],0):''; }
        }
        if(!n) h+='<div class="sb-msg">'+(d.status==='running'?'还没开始写过程':'没有任务记录')+'</div>';
        if(d.model||d.rounds) h+='<div class="sb-meta">'+esc(d.model||'—')+' · '+(d.rounds||0)+' 轮工具</div>';
        if(d.status!=='running'&&!(d.timeline||[]).some(function(m){ return m.role==='assistant'&&(m.stream_timeline||[]).length; }))
          h+='<div class="sb-note">这条是旧子进程：工具过程当时没落盘，只有正文和引擎日志（新派的任务才有完整过程）</div>';
        if(d.error) h+='<div class="sb-err">'+esc(d.error)+'</div>';
        if(h===lastHTML){ paintLatest(); return true; }
        var atBottom=nearBottom(), first=!lastHTML, grew=n>lastCount;
        bd.innerHTML=h; lastHTML=h; lastCount=n;
        if(first){ bd.classList.add('sb-enter'); setTimeout(function(){ bd.classList.remove('sb-enter'); },240); }
        else if(grew){ var nodes=bd.querySelectorAll('.sb-turn,.sb-taskbox'); if(nodes.length) nodes[nodes.length-1].classList.add('sb-new'); }
        if(first||atBottom) bd.scrollTop=bd.scrollHeight;
        requestAnimationFrame(paintLatest);
        return true;
      }
      function tick(){ if(pop.isConnected && !document.hidden) fetch1(); }
      /* [位置:phone-talk.js·subSheet.fetch1] [抽屉取数：和打开普通会话一样读完整过程] [10-27 批1：子会话就是一个真会话，抽屉只是换个壳；运行中每 1.5 秒取完整过程（后端把实时思考/工具/正文当最后一条消息给），带 since=版本号，没变化后端只回状态不回全文；关了再开第一次就是完整拉取。原来运行中只轮询状态、终态才取全文，所以打开只看到「思考中」] [注释时间 2026-10-27] */
      function fetch1(){
        if(!pop.isConnected||busy||document.hidden) return; busy=true; clearTimeout(tm);
        P.net.get(detailURL+(rev>=0?'&since='+rev:''),{noLogin:true}).then(function(d){
          busy=false; if(!pop.isConnected) return;
          if(!d||d.ok===false){ paintErr((d&&d.error)||'找不到这个子进程'); return; }
          if(d.same){ paintStatus(d); schedule(stopping?1500:2500); return; }
          var painted=paint(d);
          if(painted===false){ schedule(500); return; }   /* 拖动中没画上，rev 不更新，下一轮照样全量取 */
          rev=(typeof d.rev==='number'&&d.status==='running')?d.rev:-1;
          if(d.status==='running') schedule(stopping?1500:2500);
        },function(){
          busy=false; if(!pop.isConnected) return;
          if(!lastHTML) paintErr('没连上后台'); else schedule(stopping?1500:4000);
        });
      }
      function onVis(){ if(!pop.isConnected){ document.removeEventListener('visibilitychange',onVis); return; } if(document.hidden) return; rev=-1; fetch1(); }
      document.addEventListener('visibilitychange',onVis);
      fetch1(false);
    },{single:true,stretch:{natural:true}});   /* 10-28 三档；10-31：收两档（自然高⇄满高），不记档 */
  }
  P.subSheet=subSheet;

  function mnRowHTML(r,key){ return '<div class="'+r.cls+'" data-mk="'+esc(key||'')+'">'+r.h+'</div>'; }
  /* [位置:phone-talk.js·CAPMARK/INTERRUPT_MARK/stripKnownSuffix] [已知中断/截断尾缀识别] [10-27：后端在正文末尾追加的固定文案（轮次打满提醒/中断占位符），前端比对时间线前要剥掉、轮次提醒渲染时单独画成黄色「继续」按钮；10-27 性能重构时 CAPMARK 逻辑丢失，本批恢复] [注释时间 2026-10-28 恢复] */
  var CAPMARK='（工具调用轮次已达上限';
  var INTERRUPT_MARK='（回复在此中断，未生成正文——思考与工具步骤已保留）';
  function capCut(s){ var i=s.indexOf(CAPMARK); return i>=0?s.slice(0,i).replace(/\s+$/,''):s; }   /* 10-30：「轮次已达上限」尾缀剥离，stripKnownSuffix 与 aiTx 共用 */
  function stripKnownSuffix(t){
    var s=capCut(String(t||''));
    if(s===INTERRUPT_MARK) s='';
    return s;
  }
  function aiTx(m,tx,ch,cards){ var o=[], s0=String(tx), ci=s0.indexOf(CAPMARK), s=capCut(s0);
    var vcm=window.PHTags?PHTags.mask(s):null;   /* 2026-10-28：代码块/表格/反引号里的 <voice> 不拆成语音气泡 */
    (vcm?vcm.text:s).split(/(<voice\b[^>]*>[\s\S]*?<\/voice>)/i).forEach(function(pc){ if(vcm) pc=vcm.restore(pc); var v=pc.match(/^<voice\b[^>]*>([\s\S]*?)<\/voice>$/i);
      if(v){ var vt=v[1].trim(); if(vt) o.push({s:'ai',voice:Math.max(1,Math.round(vt.length/4)),x:vt,raw:m,rec:ch}); }
      else if(pc.trim()) o.push({s:'ai',x:pc.trim(),raw:m,rec:ch}); });
    /* [位置:phone-talk.js·aiTx 卡片分发] [__stk 表情包 / __file 标签文件 / 其余互动卡片三种出口] [11-05 加 __file：<file> 标签摘出的文件走 vfile 槽（items 里画 button 卡、点开应用内预览），与互动卡片（phone-cards.js 渲染）、表情包分开] [注释时间 2026-11-05] */
    (cards||[]).forEach(function(c){ o.push(c.type==='__stk'?{s:'ai',sticker:c.id,raw:m,rec:ch}:(c.type==='__file'?{s:'ai',vfile:c.ref,raw:m,rec:ch}:{s:'ai',card:c,raw:m,rec:ch})); });
    if(ci>=0) o.push({s:'ai',capcut:1,raw:m,rec:ch});
    return o; }
  function mnUnits(m,ch,cx){
    var tl=m.stream_timeline||[], o=[], mk=(m.id||'m'), trIdx=0;
    var tu=tlCheck(tl,stripKnownSuffix(cx.text),function(s){ return stripKnownSuffix(cardsOf(stripTags(cutTrace(s))).text); }), ok=tu.ok;   /* 2026-10-27：判定收拢到 tlCheck，clean 传卡片拆分清洗，口径与原来一致；2026-11-18 trace 原文留在时间线（keepBody），clean 先 cutTrace 去掉成对 trace 再比对，与展示侧同口径（否则代码块里的 <trace> 字样两侧处理不同会失配退化） */
    if(ok){
      var mT=m.time?(+new Date(m.time)||0):0;   /* 11-18：消息完成时刻，思考段是最后一个节点时用它兜底算耗时 */
      if(!tu.hasR&&m.reasoning) o.push({s:'ai',chain:{k:'think',text:m.reasoning},key:mk+':r',raw:m,rec:ch});
      tl.forEach(function(n,i){ if(!n) return;
        if(n.type==='reasoning'&&n.text) o.push({s:'ai',chain:{k:'think',text:n.text,dur:tlDur(tl,i,mT)},key:mk+':'+i,raw:m,rec:ch});
        else if(n.type==='tool'&&n.tool){ var t=toolOf(n.tool); if(t.st==='run') t.st='done'; o.push({s:'ai',chain:{k:'tool',t:t},key:mk+':'+i,raw:m,rec:ch}); }
        else if(n.type==='text'){ var pk=splitTrace(n.text);   /* 11-18：trace 在原位置拆成折叠行，其余文本段照旧走 cardsOf→aiTx */
          if(!pk){ var c2=cardsOf(stripTags(n.text)); aiTx(m,c2.text,ch,c2.cards).forEach(function(e){ o.push(e); }); }
          else pk.forEach(function(pc){
            if(pc.trq!=null) o.push({s:'ai',chain:{k:'trace',text:pc.trq},key:mk+':tr'+(trIdx++),raw:m,rec:ch});
            else { var c3=cardsOf(stripTags(pc.tx)); aiTx(m,c3.text,ch,c3.cards).forEach(function(e){ o.push(e); }); } }); } });
      return mergeTools(o); }
    var d=dataOf(m);
    if(m.reasoning) o.push({s:'ai',chain:{k:'think',text:m.reasoning},key:mk+':r',raw:m,rec:ch});
    d.tools.forEach(function(t,i){ o.push({s:'ai',chain:{k:'tool',t:t},key:mk+':t'+i,raw:m,rec:ch}); });
    var pkF=splitTrace(mText(m));
    if(pkF){
      pkF.forEach(function(pc){
        if(pc.trq!=null) o.push({s:'ai',chain:{k:'trace',text:pc.trq},key:mk+':tr'+(trIdx++),raw:m,rec:ch});
        else { var cF=cardsOf(stripTags(pc.tx)); aiTx(m,cF.text,ch,cF.cards).forEach(function(e){ o.push(e); }); }
      });
      return mergeTools(o);
    }
    return mergeTools(o.concat(aiTx(m,cx.text,ch,cx.cards))); }
  /* [位置:phone-talk.js·traceHTML/TROPEN] [此刻 <trace> 渲染] [折叠时只一行「✦ 开头文字 ▸」（新结构取整句前 12 字，旧拆字段结构取气味名/心里话，兼容历史消息）；展开看全文。展开状态记在 TROPEN（刷新重画保留）] [注释时间 2026-11-07（11-04 起；11-07 整句化+去 lock）] */
  var TROPEN={};
  function traceHTML(t,key){ if(!t) return '';
    var lbl=t.content?String(t.content).replace(/\s+/g,' ').slice(0,12):(t.scent||(t.note?String(t.note).replace(/\s+/g,' ').slice(0,12):'')||(t.moves&&t.moves[0]?t.moves[0].name:'')||'此刻');
    var op=!!TROPEN[key], h='<button class="trc tap'+(op?' open':'')+'" type="button" data-trc="'+esc(key)+'"><i>✦</i><b>'+esc(lbl)+'</b><em>›</em></button>';
    var body=traceBody(t);
    return h+(op&&body?'<div class="trb">'+body+'</div>':''); }
  /* [位置:phone-talk.js·TRC/splitTrace/cutTrace/traceText/traceQuote] [极简 trace 直显引用块] [11-18：trace 不再折叠成「✦ 摘要 ›」行——正文里成对的 <trace>…</trace> 在**原位置**拆出来渲染成 Markdown 引用块（与 > 引用同款），块首带小云朵（用户选预览稿 05 号 Lucide cloud）。拆分必须做在 stripTags 之前（trace fe:drop 会连内容剥掉）；代码块/反引号里的 <trace> 讲解字样用 PHTags.mask 掩码保护不误拆（同 cardsOf 口径）；未闭合标签正则不匹配→走原剥除逻辑（11-04 事故口径，不吞字）。11-08 前旧消息正文无原文、只有 m.trace 字段→挂尾直显，traceText 兼容旧拆字段结构拼行] [注释时间 2026-11-18] */
  /* [位置:phone-talk.js·splitTrace/cutTrace/traceText] [极简 trace 折叠行拆分] [11-18：极简主题 trace 改回折叠行（云朵 + 此刻 + 箭头），正文里成对的 <trace>…</trace> 在原位置拆出；流式阶段 splitTrace(t,true) 额外识别未闭合的 <trace>…</trace>（上限 1500 字防误吞），让折叠行跟随打字机实时出现；代码块/反引号里的 <trace> 用 PHTags.mask 掩码保护不误拆] [注释时间 2026-11-18] */
  function splitTrace(t,live){
    t=String(t==null?'':t);
    if(!/<\s*trace[\s>]/i.test(t)) return null;   /* 快速路径：绝大多数消息没有 trace，零开销走原路 */
    var cm=window.PHTags?PHTags.mask(t):null, x=cm?cm.text:t, out=[], last=0, m, got=0;
    var re=/<\s*trace\b[^>]*>([\s\S]*?)<\s*\/\s*trace\s*>/gi;
    while((m=re.exec(x))){
      var pre=cm?cm.restore(x.slice(last,m.index)):x.slice(last,m.index);
      if(pre.trim()) out.push({tx:pre});
      var inn=cm?cm.restore(m[1]):m[1];
      if(String(inn).trim()) out.push({trq:inn,live:false});
      last=m.index+m[0].length; got++;
    }
    var tail=x.slice(last);
    if(live){
      var um=tail.match(/<\s*trace\b[^>]*>([\s\S]*)$/i);
      if(um&&um[1].length<=1500){
        var pre2=cm?cm.restore(tail.slice(0,um.index)):tail.slice(0,um.index);
        if(pre2.trim()) out.push({tx:pre2});
        var inn2=cm?cm.restore(um[1]):um[1];
        out.push({trq:inn2,live:true});
        got++; tail='';
      }
    }
    if(tail){
      var tailR=cm?cm.restore(tail):tail;
      if(tailR.trim()) out.push({tx:tailR});
    }
    return got?out:null;
  }
  function cutTrace(t){ var p=splitTrace(t); if(!p) return String(t==null?'':t);
    return p.map(function(x){ return x.tx!=null?x.tx:''; }).join(''); }
  function traceText(t){ if(!t) return '';
    if(t.content) return String(t.content);   /* 11-07 起整句结构 */
    var L=[]; if(t.scent) L.push(String(t.scent));
    (t.moves||[]).forEach(function(x){ L.push((x.dir==='up'?'↑ ':'↓ ')+String(x.name||'')+(x.level?' '+x.level:'')); });
    [['想要',t.want],['选了',t.chose],['忍住',t.held]].forEach(function(r){ if(r[1]) L.push(r[0]+'：'+r[1]); });
    if(t.note) L.push(String(t.note));
    return L.join('\n'); }
  /* [位置:phone-talk.js·traceBody/trIcon/trCard] [气泡皮肤的 trace：只在名字日期时间后面放一个 ✦ 小图标，点一下在头像行下面展开卡片；极简皮肤 11-18 起改直显引用块（见 splitTrace），不再走折叠行] [11-04：气泡主题那个 trace 就一个图标吧，放到那串时间后面，点击一下显示；11-18：极简改成引用块直显] [注释时间 2026-11-04；同晚二改：traceBody 气味类名 .sc 改 .tr-sc——.sc 是全项目滚动容器通用类名，phone-fix.css·.win .sc 给所有滚动容器加顶16/底38渐隐遮罩，气味字撞名连坐，真机第一句被渐隐+渲染出一块空白（该规则第三次连坐，前两次：会话列表、抽屉时间线，这次改名根治）] [注释时间 2026-11-04 二改] */
  function traceBody(t){ if(!t) return '';
    if(t.content) return '<div class="nt">'+esc(t.content).replace(/\n/g,'<br>')+'</div>';   /* 11-07 整句化：新结构一段整句 */
    var mv=(t.moves||[]).map(function(x){ return '<span class="mv '+(x.dir==='up'?'up':'dn')+'">'+esc(x.name)+(x.dir==='up'?' ↑':' ↓')+(x.level?esc(x.level):'')+'</span>'; }).join('');
    var rows='';
    [['想要',t.want],['选了',t.chose],['忍住',t.held]].forEach(function(r){ if(r[1]) rows+='<div class="r"><span>'+r[0]+'</span><p>'+esc(r[1])+'</p></div>'; });
    return (t.scent?'<div class="tr-sc">'+esc(t.scent)+'</div>':'')+(mv?'<div class="mvs">'+mv+'</div>':'')+rows+(t.note?'<div class="nt">'+esc(t.note).replace(/\n/g,'<br>')+'</div>':''); }
  function trIcon(g){ var t=g.trace; if(!t) return '';
    return '<button class="tk-tri tap'+(TROPEN[g.key]?' open':'')+'" type="button" data-trc="'+esc(g.key)+'" aria-label="他的此刻">✦</button>'; }
  function trCard(g){ var t=g.trace; if(!t||!TROPEN[g.key]) return ''; var b=traceBody(t); return b?'<div class="tk-trcard" data-trk="'+esc(g.key)+'">'+b+'</div>':''; }
  function items(g){
    if(g.chain) return [mnRow(g.chain,g.key)];
    /* [位置:phone-talk.js·items(capcut)] [轮次打满黄色「继续」按钮] [照 10-24 版恢复：结构同 .tk-fail，配色琥珀黄（.tk-cap CSS 一直在），点一下发「继续」] [注释时间 2026-10-28 恢复] */
    if(g.capcut) return [{cls:'tk-cap',h:'<span><b>回答在这里中断</b><small>发「继续」可接着做</small></span><button class="tap" type="button" data-cont>继续</button>',raw:1}];
    if(g.trace) return MIN?[mnRow({k:'trace',text:traceText(g.trace)},g.key)]:[{cls:'tk-trace',h:traceHTML(g.trace,g.key),raw:1}];   /* 11-04 此刻 <trace>；11-18：极简旧消息（正文无原文）挂尾折叠行；气泡主题照旧（render 580 抽走改头像行 ✦ 图标，!MIN 路径实际走不到，保留兜底） */
    if(g.card) return [{cls:'tk-cardw',h:'<div class="tk-cslot"></div>',raw:1}];
    if(g.sticker) return [{cls:'tk-stk',h:'<img src="'+(typeof g.sticker==='string'?'/stickers/t/'+esc(g.sticker)+'.jpg':STK)+'" alt="表情包" loading="lazy">',raw:1}];
    if(g.img) return [{cls:'tk-img',h:g.url?'<img src="'+esc(g.url)+'" alt="" loading="lazy">':'<i></i>',raw:1}];
    /* [位置:phone-talk.js·items(g.file)] [文件卡] [发 / 收文件时画成一张卡：图标 + 文件名 + 类型大小，点一下打开或下载；之前只有一行「📎 名字」] [注释时间 2026-10-21]
       同 chat.html 的 fileCardEl / extBadge / fmtFileSize；raw=1 = 和图片一样不是气泡，可长按、可多选。 */
    if(g.file) return [{cls:'tk-file',h:fileCardHTML(g.file),raw:1}];
    /* [位置:phone-talk.js·items(g.vfile)] [<file> 标签文件卡] [11-05：AI 用 <file> 发的文件没有 url，结构与上传文件卡 .tk-fc 同款但画成 button，点一下开应用内预览（openFilePreview）不是跳链接；raw=1 同图片可长按、可多选] [注释时间 2026-11-05] */
    if(g.vfile) return [{cls:'tk-file',h:vFileCardHTML(g.vfile),raw:1}];
    if(g.voice) return [{cls:'vbub',h:voiceHTML(g),tr:g.x,pend:g.pend}];
    if(g.s==='me'){ var mt=String(g.x==null?'':g.x); if(!mt.trim()) return []; var qp=qteParse(mt); if(qp){ var pre=(qp.quote||'').replace(/\s+/g,' ').trim(); return [{h:'<div class="tk-qcite">'+esc(pre)+'</div><div class="tk-qbody">'+esc(qp.input).replace(/\n/g,'<br>')+'</div>'}]; } return [{h:esc(mt).replace(/\n/g,'<br>')}]; }
    /* [位置:phone-talk.js·items AI 分气泡] [开了「他的消息按空行分气泡」：一条回复按空行拆成几个气泡，每段各自走 md()；splitParas 与实时区 mnBlk 同一口径（代码块内部不切）；MIN 短路——就算开关开着也不影响极简样式] [注释时间 2026-11-02] */
    if(!MIN&&OPT.splitAI) return splitParas(g.x).map(function(p){ return {cls:g.na?'md na':'md',h:md(p)}; });
    return [{cls:g.na?'md na':'md',h:md(g.x)}];   /* na=静默原因，虚线气泡（phone-bubble.css·.b.na） */
  }
  /* [位置:phone-talk.js·splitParas] [按空行切段（代码块内部不切）] [历史消息分气泡的切分器：空行是段落边界、``` 围栏内空行不切、段尾空行去掉——这样切完的每段与整段一次 md() 渲染等价（mnBlk 同款规则），修掉旧版连代码块里的空行也切碎的毛病] [注释时间 2026-11-02] */
  function splitParas(t){ t=String(t||''); var out=[], start=0, fence=false, i=0, n=t.length;
    while(i<n){ var j=t.indexOf('\n',i); if(j<0) break;
      var ln=t.slice(i,j);
      if(/^\s*```/.test(ln)) fence=!fence;
      else if(!fence&&!ln.trim()){ var seg=t.slice(start,i).replace(/\n+$/,''); if(seg.trim()) out.push(seg); start=j+1; }
      i=j+1; }
    var tail=t.slice(start).replace(/\n+$/,''); if(tail.trim()) out.push(tail);
    return out.length?out:[t]; }
  /* [位置:phone-talk.js·render 气泡版面] [气泡样式：每一组（同一边连着的消息）上面一行「头像 + 名字」，下面是气泡；AI 靠左最宽 90%、我靠右最宽 80%；气泡带尾巴，尾巴在一组的最后一个；表情包/图片/文件照旧] [10-28 设计稿：原来「显示头像」默认关，开了是每个气泡旁一个头像；改成永远显示、版面按稿子来，同时去掉「按空行分气泡」，一条消息就是一个气泡；2026-11-02 产品要求把「他的消息按空行分气泡」单独加回（见 items AI 分气泡 / bubbleSyncSplit），其余维持] [注释时间 2026-10-28；11-02 补] */
  /* [位置:phone-talk.js·hdRow / NAMES] [一组消息上面的「头像 + 名字」行] [名字取聊天设置里的 ai_name / user_name（配置 → 主题页改的），没取到先用默认；取到后重画一次] [10-28] [注释时间 2026-10-28] */
  var NAMES={ai:(P.names&&P.names.ai)?P.names.ai():'助手',me:(P.names&&P.names.me)?P.names.me():'用户'};
  /* [位置:phone-talk.js·tsHtml] [气泡样式名字旁的日期时间] [10-30：气泡样式不要时间分割线了，改成每组消息头像+名字旁边带日期时间（取这一组第一条的时间）。三改：日期 10.30 与时间 01:56 之间只用空格（nbsp 两个，不画点）；年份一直带（10-30：年份也加上）→ 2026.10.30  01:56；字体见 phone-talk.css·.tk-ts] [注释时间 2026-10-30] */
  function tsHtml(t){ if(!t) return ''; var d=new Date(t); if(isNaN(d)) return '';
    return '<span class="tk-ts">'+d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+'&nbsp;&nbsp;'+p2(d.getHours())+':'+p2(d.getMinutes())+'</span>'; }
  function hdRow(side,id,rec,hasRec,ts,trs){
    trs=trs||[];
    var lt=Array.from(String(NAMES[side]||'').trim())[0]||(side==='ai'?'助':'用');
    return '<div class="tk-hd"><button class="av '+side+' tk-sav tap'+(rec&&!seen[id]?' rec':'')+'" data-l="'+esc(lt)+'" data-g="'+id+'" data-rec="'+(rec||hasRec?1:0)+'"></button><span class="tk-nt"><span class="tk-un">'+esc(NAMES[side])+'</span>'+tsHtml(ts)+trs.map(trIcon).join('')+'</span></div>'+trs.map(trCard).join(''); }   /* 10-30 三改：名字和日期时间包进 .tk-nt 按基线对齐（原来各自在头像行里垂直居中，手写体基线跟名字差一截） */
  function loadNames(){ P.net.get('/heartbeat/admin/chat-settings',{noLogin:true}).then(function(r){ var c=(r&&r.data&&r.data.cfg)||{}, ch=false;
    if(c.ai_name&&String(c.ai_name).trim()&&NAMES.ai!==String(c.ai_name).trim()){ NAMES.ai=String(c.ai_name).trim(); ch=true; }
    if(c.user_name&&String(c.user_name).trim()&&NAMES.me!==String(c.user_name).trim()){ NAMES.me=String(c.user_name).trim(); ch=true; }
    if(P.names&&(c.ai_name||c.user_name)) P.names.set({ai:c.ai_name,me:c.user_name});
    var avEl=$('#tkAv',win); if(avEl) avEl.setAttribute('data-l',Array.from(NAMES.ai)[0]||'助');
    if(ch&&!MIN&&win.isConnected) render(); },function(){}); }
  loadNames();
  /* [位置:phone-talk.js·tailStartIdx] [首屏只画最后几条] [11-05：重会话进会话要等 8~10 秒，实测全在 parse+建 DOM（网络有 gzip 只要几百毫秒）。
     先只画最后 6 条消息（含正在输出的实时区），加载层立刻散去让人先看到东西；其余的在空闲时补画，补的时候用 anchor 分支把滚动位置补回去] [注释时间 2026-11-05] */
  function tailStartIdx(msgs,n){
    var ids=[], seen={};
    msgs.forEach(function(m){ var id=m.raw&&m.raw.id; if(id&&!seen[id]){ seen[id]=1; ids.push(id); } });
    if(ids.length<=n) return 0;
    var keep={}; ids.slice(-n).forEach(function(id){ keep[id]=1; });
    for(var i=0;i<msgs.length;i++){ var id2=msgs[i].raw&&msgs[i].raw.id; if(id2&&keep[id2]) return i; }
    return 0;
  }
  function tailFinish(force){ if(tailT) return; var idle=window.requestIdleCallback||function(f){ return setTimeout(f,80); };
    tailT=idle(function(){ tailT=0; if(!win.isConnected||!MSGS.length) return;
      var near=list.scrollHeight-list.scrollTop-list.clientHeight<160;
      if(near) render(true,0); else render('anchor',0); }); }
  var tailT=0;
  function render(force, tailor){
    lzReset();   /* 整页重画：DOM 全换，折叠块的注册表一起作废，避免索引无限增长 */
    var html='', i=0, gid=0; REF=[]; GR={};
    var anchor=force==='anchor', nearEnd=force===true||!anchor&&list.scrollHeight-list.scrollTop-list.clientHeight<140, keepTop=list.scrollTop, keepH=list.scrollHeight, nReal=MSGS.filter(function(x){ return x.s; }).length;
    var startIdx=tailor?tailStartIdx(MSGS,tailor):0; i=startIdx;
    while(i<MSGS.length){
      var m=MSGS[i];
      if(m.k==='stamp'){ html+='<div class="stamp'+(m.cmp?' cmp-row':'')+'">'+m.h+'</div>'; i++; continue; }   /* cmp=1：/compact 压缩回执行（cmpPaint 按 .cmp-row 原位更新文本，不整页重画） */
      if(m.k==='skel'){ html+='<div class="tk-load"></div>'; i++; continue; }   /* [位置:phone-talk.js·render(k==='skel')] [进会话的加载态] [11-05：加载动画和毛玻璃由 setup 里 P.load.show(win) 铺在窗口上（独立层，重绘不会把它刷掉，能自己淡出）；这里只留占位，避免叠两层] [注释时间 2026-11-05 改] */   /* [位置:phone-talk.js·render(k==='skel')] [进会话的加载态改成全局动画] [11-05：原来是「拉取中…」一行灰字，中间 900ms 像卡住；现在用 ph-load 的动画（白天纸船/夜里星光），无文字] [注释时间 2026-11-05] */
      if(m.k==='live'){ html+=liveHTML(); i++; continue; }
      /* [位置:phone-talk.js·render(k==='fail')] [发送失败行] [没发出去时在消息流末尾显示原因 + 重试] [注释时间 2026-10-21] */
      if(m.k==='cut'){ html+='<div class="tk-cut">'+(m.synced?'没收完整，后端也没存下这一段':'没收完整，正在向后端核对…')+'</div>'; i++; continue; }
      if(m.k==='fail'){ html+='<div class="tk-fail"'+(m.raw&&m.raw.id?' data-fid="'+esc(m.raw.id)+'"':'')+'><span><b>没发出去</b>'+(m.why?'<small>'+esc(m.why)+'</small>':'')+'</span><button class="tap del" type="button" data-fdel>删掉</button><button class="tap" type="button" data-retry>重试</button></div>'; i++; continue; }
      var side=m.s, group=[m]; i++;
      /* [位置:phone-talk.js·render 唤醒轮断组] [带 wk 标的消息相对上一轮另起一组] [2026-10-31：唤醒后他主动说的话要有自己的头像行，不跟上一轮连在一起。2026-11-19：wk 抄在这条消息的每个单元上，原条件把同一条的思考行和「此刻」拆成两组、各挂一条操作条；只在换了一条消息时断开] [注释时间 2026-11-19] */
      while(i<MSGS.length&&MSGS[i].s===side&&!MSGS[i].k&&!(MSGS[i].wk&&MSGS[i].raw!==group[0].raw)&&!group[group.length-1].push) group.push(MSGS[i++]);
      var all=[]; group.forEach(function(g){ items(g).forEach(function(it){ it.g=g; all.push(it); }); if(g.push) all[all.length-1].push=g.push; });
      var trs=[]; if(!MIN){ trs=group.filter(function(g){ return g.trace; }); all=all.filter(function(it){ return !(it.g&&it.g.trace); }); }   /* 11-04 气泡皮肤：trace 不再是消息下一行，改成头像行时间后面的 ✦ 图标 */
      var bubbles=all.filter(function(x){ return !x.raw; });
      var gts=0; group.some(function(g){ var t=g.raw&&+new Date(g.raw.time); if(t){ gts=t; return true; } return false; });   /* 10-30 这一组第一条带时间的消息，给 hdRow 的手写日期时间用 */
      var rec=group.some(function(g){ return g.rec; }), id='g'+(gid++); GR[id]=(group.filter(function(g){ return g.rec; })[0]||group.filter(function(g){ return g.raw; })[0]||{}).raw||null;
      function one(it){
        var k=bubbles.indexOf(it), h, ri=REF.push(it.g)-1;
        if(it.raw) h='<div class="'+it.cls+'" data-r="'+ri+'"'+(it.key?' data-mk="'+esc(it.key)+'"':'')+'>'+it.h+'</div>';   /* [位置:phone-talk.js·render one] [历史折叠行带上 data-mk] [11-06 晚：消息流里的思考/工具行原来是 data-r 包一层、没写 data-mk，点开时取不到行 key，展开记忆（MO）落空、整页重画后又折回去；把行 key 一起写进 DOM，和实时区同一套口径] [注释时间 2026-11-06 晚] */
        else { var stl=(k===bubbles.length-1||bubbles[k+1]&&bubbles[k+1].g.raw!==it.g.raw)&&isStar(it.g.raw);
          h='<div class="b '+side+(it.cls?' '+it.cls:'')+(k===0?' first':'')+(k===0||bubbles[k-1]&&bubbles[k-1].g.raw!==it.g.raw?' m0':'')+(stl?' star':'')+'" data-r="'+ri+'">'+it.h+(stl?'<i class="tk-star" aria-label="已标星">★</i>':'')+'</div>'; }
        if(it.pend==='wait') h+='<div class="vt wait"><span>识别中…</span></div>';
        else if(it.pend==='err'){ var vid=(it.g&&it.g.raw&&it.g.raw.id)||''; h+='<div class="vt err"><button type="button" data-vretry="'+esc(vid)+'">没发出去，点这里重试</button><button type="button" data-vdrop="'+esc(vid)+'">删掉</button></div>'; }
        if(it.tr) h+='<button class="vt" type="button"><span>转文字</span><p>'+esc(it.tr)+'</p></button>';
        return h;
      }
      {
        /* [位置:phone-talk.js·图片并排] [同一组里连着的几张图并排放，一行放不下换行] [10-24 需求 59：图片改方形小缩略图，参考旧 chat 的 .bubble-imgs（gap 6px、flex-wrap）；有头像样式每条自带头像，不并排] [注释时间 2026-10-24] */
        /* [位置:phone-talk.js·render 操作栏与中断卡片顺序] [「回答在这里中断」卡片放在复制/播放那排按钮的下面] [10-28：原来操作栏跟在这一条消息的最后一项后面，而中断卡片恰好是最后一项，于是卡片夹在正文和按钮之间，像是回复内容的一部分；改成操作栏跟在最后一个非卡片项后面，卡片排在按钮下面；整条消息只有卡片时仍给它配操作栏] [注释时间 2026-10-28] */
        var isCap=function(x){ return !!(x&&x.g&&x.g.capcut); };
        var hs=all.map(function(it,ix){ var h=one(it), nx=all[ix+1], pv=all[ix-1];
          var last=!isCap(it)&&(!nx||nx.g.raw!==it.g.raw||isCap(nx)), solo=isCap(it)&&(!pv||pv.g.raw!==it.g.raw);
          if(MIN&&side==='ai'&&it.g.raw&&(last||solo)) h+=actBar(side,REF.length-1,it.g); return h; }), o2='', run='';
        all.forEach(function(it,ix){ if(it.cls==='tk-img'){ run+=hs[ix]; } else { if(run){ o2+='<div class="tk-imgs">'+run+'</div>'; run=''; } o2+=hs[ix]; } }); if(run) o2+='<div class="tk-imgs">'+run+'</div>';
        html+='<div class="tk-g '+(MIN?'':'top ')+side+'">'+(MIN?'':hdRow(side,id,rec,GR[id],gts,trs))+'<div class="col">'+o2+'</div></div>';
      }
    }
    list.innerHTML=html; P.markAv&&P.markAv();
    /* [位置:phone-talk.js·render 首屏] [内容不再自己做淡入] [11-05：改成毛玻璃层淡出（见 setup 的 LD 与 done），两层过渡叠在一起会在中间闪一帧空底；内容一直在毛玻璃下面，散去即见] [注释时间 2026-11-05 改] */
    if(LD_FIRST&&nReal){ LD_FIRST=0; if(LD) LD.done(); }
    /* [位置:phone-talk.js·render 标组尾] [小尾巴·SVG 只组尾带] [2026-11-02真机反馈 AI 气泡没尾巴：原来组尾靠 phone-bubble.js·isColLast 运行时推理，真机上 AI 组没判中（me 判中了）；改成渲染链直接标——每组 .col 里最后一个非 na 的 .b 加 .tail 类，形状绘制按类走，信息从源头来不猜；组内增删（分气泡/撤回/直播落地）由 phone-bubble.js·watch·retail 重标] [注释时间 2026-11-02] */
    if(!MIN){ Array.prototype.forEach.call(list.querySelectorAll('.tk-g .col'),function(col){ var bs=col.querySelectorAll('.b');
      for(var i=bs.length-1;i>=0;i--){ if(!bs[i].classList.contains('na')){ bs[i].classList.add('tail'); break; } } }); }
    foldLong();   /* 11-04：超长气泡默认收起 */
    verPaint();   /* 11-10：有版本的用户消息下面插「‹ 2/3 ›」 */
    if(P.bubble&&P.bubble.watch) P.bubble.watch(list);   /* [2026-11-02 气泡形状选择器：渲染完把列表交给 phone-bubble.js 盯着（小尾巴·SVG 档要按气泡尺寸画形状）] */

    /* 卡片：他发的 <card> 用 phone-cards.js 画成能点的；点完以一条消息发回去 */
    /* [位置:phone-talk.js·render 卡片scope] [卡片状态按会话隔离] [phone-cards 存储原本全局按卡片id分键，跨会话同id卡会互串答案；画卡前把本窗口会话id给它当命名空间] [注释时间 2026-10-29] */
    if(P.cards&&P.cards.scope) P.cards.scope(LIVE.sid);
    /* [位置:phone-talk.js·render 卡片ctx] [棋盘卡要查历史] [11-22：board 卡自己从消息历史回放棋局，所以多传 raw（这张卡所在的消息）、feed（摘某局的事件流，每次渲染只摘一遍：BFC 在这里清）、busy、online；别的卡不看这几项] [注释时间 2026-11-22] */
    BFC={}; var cctx={answer:cardAnswer,feed:boardFeed,busy:function(){ return !!LIVE.busy; },online:function(){ return !!LIVE.on; }};
    if(P.cards) Array.prototype.forEach.call(list.querySelectorAll('.tk-cardw'),function(w){ var g=REF[+w.getAttribute('data-r')], sl=w.querySelector('.tk-cslot'); if(g&&g.card&&sl){ try{ sl.appendChild(P.cards.render(g.card,Object.assign({raw:g.raw},cctx))); }catch(e){} } });
    /* 在底部附近就跟着到底；往上翻着看的时候不打扰，只在右下角记一下有几条新的 */
    byHand=false;
    if(anchor){ list.scrollTop=list.scrollHeight-keepH+keepTop; TW.atBot=false; } else if(nearEnd){ list.scrollTop=list.scrollHeight; TW.atBot=true; TW.hand=false; unread=0; } else { list.scrollTop=keepTop; TW.atBot=false; if(lastReal&&nReal>lastReal) unread+=nReal-lastReal; }
    if(anchor) lastReal=nReal;
    lastReal=nReal; jbPaint(); if(typeof msPaint==='function') msPaint();
    if(typeof headSync==='function'){ if(!headOnce){ headOnce=true; host.classList.add('noanim'); headSync(); requestAnimationFrame(function(){ requestAnimationFrame(function(){ host.classList.remove('noanim'); }); }); } else headSync(); }
    if(startIdx>0) tailFinish(force);   /* 首屏只画了尾部：空闲时把前面补上，滚动位置由 anchor 分支补偿 */
  }
  var headOnce=false;
  /* [位置:phone-talk.js·foldLong] [超长气泡收起/展开] [11-04：聊天里特别长的气泡（高度 > FOLD_MAX）默认只露 FOLD_SHOW 高度 + 渐隐，气泡下面一颗「展开全文」；展开状态按「字数+开头 40 字」记在 FOLDOPEN 里，重画不丢。先批量读高度再批量写，避免逐个触发回流；直播气泡/打字中/图片/卡片不参与。内容包进 .fold-in 再裁剪，不直接裁气泡，免得小尾巴被裁掉] [注释时间 2026-11-04] */
  var FOLD_MAX=460, FOLD_SHOW=300, FOLDOPEN={};
  function foldKey(b){ var t=b.textContent||''; return t.length+':'+t.slice(0,40); }
  function syncFoldMask(w){
    if(!w||!w.isConnected) return;
    w.classList.toggle('at-bot',w.scrollTop+w.clientHeight>=w.scrollHeight-6);
  }
  function foldLong(){
    var bs=Array.prototype.slice.call(list.querySelectorAll('.tk-g.me .col>.b:not([data-live]):not(.typing):not(.tk-img):not(.tk-cardw)'));
    /* [位置:phone-talk.js·foldLong 预筛] [先估高度上界，够不着才测量] [11-06 埋点：fold 段吃掉 render 的 84%（每次整列表强制回流 200~450ms），
       而这条会话 10 个用户气泡最长 135 字、最高 210px，一个都不需要折 —— 全白量。
       现在按「16 字/行、30px/行」（都比实际宽松）估高度上界，够不到 FOLD_MAX 的直接不参与测量；带图/表格的一律进候选，免得文字短却撑得高] [注释时间 2026-11-06] */
    var cand=[];
    for(var q=0;q<bs.length;q++){ var b0=bs[q];
      if(b0.querySelector('img,video,table')){ cand.push(b0); continue; }
      var t0=b0.textContent||'';
      if(t0.length>=256){ cand.push(b0); continue; }   /* 16 字/行 × 16 行 */
      var nl=0; for(var z=0;z<t0.length;z++){ if(t0.charCodeAt(z)===10) nl++; }
      if(Math.ceil(t0.length/16)+nl>=16) cand.push(b0);
    }
    if(!cand.length) return;
    var hs=cand.map(function(b){ return b.offsetHeight; });
    cand.forEach(function(b,i){
      if(hs[i]<=FOLD_MAX||b.querySelector('.fold-in')) return;
      var k=foldKey(b), open=!!FOLDOPEN[k], w=document.createElement('div'); w.className='fold-in';
      while(b.firstChild) w.appendChild(b.firstChild); b.appendChild(w);
      b.classList.add('foldable'); if(!open) b.classList.add('folded');
      w.addEventListener('scroll',function(){ if(b.classList.contains('folded')) syncFoldMask(w); },{passive:true});
      w.addEventListener('touchmove',function(ev){ if(b.classList.contains('folded')&&w.scrollHeight>w.clientHeight) ev.stopPropagation(); },{passive:true});
      if(!open) syncFoldMask(w);
      var n=(b.textContent||'').length, btn=document.createElement('button');
      btn.type='button'; btn.className='tk-fold tap'; btn.setAttribute('data-fold',k); btn.textContent=open?'收起':'展开全文 · '+n+' 字';
      b.parentNode.insertBefore(btn,b.nextSibling);
    });
  }
  /* [位置:phone-talk.js·代码块复制] [点代码块右上「复制」] [10-23 需求 46] [注释时间 2026-10-23] */
  function copyText(t){ if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(t); return new Promise(function(ok,no){ var t2=document.createElement('textarea'); t2.value=t; t2.setAttribute('readonly',''); t2.style.cssText='position:fixed;left:-999px;top:0;opacity:0'; document.body.appendChild(t2); t2.select(); var r=false; try{ r=document.execCommand('copy'); }catch(e){} t2.remove(); r?ok():no(); }); }
  /* [位置:phone-talk.js·dlFileText] [<file> 文件下载] [11-05：Blob 现场生成；iOS（Safari 15+）优先系统分享面板（可直接存「文件」App），不支持再走 a.download——照「导出选中消息」同款写法] [注释时间 2026-11-05] */
  function dlFileText(name,body){ var blob=new Blob([body],{type:'text/plain;charset=utf-8'}), f=null;
    try{ f=new File([blob],name,{type:'text/plain;charset=utf-8'}); }catch(e){}
    if(f&&navigator.canShare&&navigator.canShare({files:[f]})){ try{ navigator.share({files:[f]}).catch(function(){}); return; }catch(e){} }
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },1500); }
  /* [位置:phone-talk.js·openFilePreview] [<file> 文件预览层] [11-05：全屏层=顶栏（关/文件名/下载）+等宽正文可滚动可选中；开关 opacity/transform 过渡；点遮罩空白处也关；z-index 70 在会话弹层（60）之上] [注释时间 2026-11-05] */
  function openFilePreview(f){ var old=document.getElementById('fprev'); if(old) old.remove();
    var d=document.createElement('div'); d.className='fprev'; d.id='fprev'; d.setAttribute('role','dialog'); d.setAttribute('aria-label','文件预览 '+f.name);
    var mt=esc(vFileKind(f.name))+(f.size?' · '+fmtSize(f.size):'');
    d.innerHTML='<div class="fprev-bar"><button class="fpb tap" type="button" data-fpx aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button><div class="fprev-nm"><b>'+esc(f.name)+'</b><small>'+mt+'</small></div><button class="fpb tap" type="button" data-fpdl aria-label="下载"><svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19h14"/></svg></button></div><pre class="fprev-body">'+esc(f.body)+'</pre>';
    document.body.appendChild(d); requestAnimationFrame(function(){ d.classList.add('on'); });
    function close(){ d.classList.remove('on'); setTimeout(function(){ d.remove(); },220); }
    d.querySelector('[data-fpx]').addEventListener('click',function(){ buzz(4); close(); });
    d.querySelector('[data-fpdl]').addEventListener('click',function(){ buzz(8); dlFileText(f.name,f.body); });
    d.addEventListener('click',function(ev){ if(ev.target===d) close(); }); }
  list.addEventListener('click',function(e){
    var fb=e.target.closest('.tk-fold'); if(fb){ e.preventDefault(); e.stopPropagation();
      var fbub=fb.previousElementSibling, fk=fb.getAttribute('data-fold'); if(!fbub||!fbub.classList.contains('foldable')) return;
      var fo=fbub.classList.contains('folded'); fbub.classList.toggle('folded',!fo); FOLDOPEN[fk]=fo?1:0;
      var fi=fbub.querySelector('.fold-in');
      if(fi){ if(!fo){ fi.scrollTop=0; syncFoldMask(fi); } else { fi.classList.remove('at-bot'); } }
      fb.textContent=fo?'收起':'展开全文 · '+(fbub.textContent||'').length+' 字';
      if(!fo){ var lr=list.getBoundingClientRect(), br=fbub.getBoundingClientRect(); if(br.top<lr.top) list.scrollTop+=br.top-lr.top-8; }
      buzz(4); return; }
    /* [位置:phone-talk.js·data-cont] [轮次打满「继续」按钮点击] [点一下就发「继续」，正在回/没连上时提示] [注释时间 2026-10-28] */
    /* [位置:phone-talk.js·data-vf] [<file> 文件卡点击开预览] [11-05：卡不带链接，点开全屏预览（文件名+等宽正文），预览里再下载] [注释时间 2026-11-05] */
    var vb=e.target.closest('[data-vf]'); if(vb){ e.preventDefault(); e.stopPropagation(); var vf=VFMAP[vb.getAttribute('data-vf')]; if(vf){ buzz(6); openFilePreview(vf); } return; }
    var trb=e.target.closest('[data-trc]'); if(trb){ e.preventDefault(); e.stopPropagation(); var tk=trb.getAttribute('data-trc'), row=trb.closest('.tk-trace'); TROPEN[tk]=!TROPEN[tk];
      var tm=null; for(var ti=0;ti<LIVE.raw.length;ti++){ if(('trc:'+LIVE.raw[ti].id)===tk){ tm=LIVE.raw[ti]; break; } }
      if(row&&tm){ row.innerHTML=traceHTML(tm.trace,tk); }
      else if(tm&&trb.classList.contains('tk-tri')){   /* 气泡皮肤：图标旁展开/收起头像行下面的卡片，不整页重画 */
        var tg=trb.closest('.tk-g'), old=tg&&tg.querySelector('.tk-trcard[data-trk="'+tk+'"]'); trb.classList.toggle('open',!!TROPEN[tk]);
        if(old){ if(!TROPEN[tk]) old.remove(); }
        else if(tg&&TROPEN[tk]){ var hd=tg.querySelector('.tk-hd'), cd=document.createElement('div'); cd.className='tk-trcard'; cd.setAttribute('data-trk',tk); cd.innerHTML=traceBody(tm.trace); if(hd) hd.insertAdjacentElement('afterend',cd); } }
      buzz(4); return; }
    var cb=e.target.closest('[data-cont]'); if(cb){ e.preventDefault(); e.stopPropagation(); if(!LIVE.on){ toast('没连上后台'); return; } if(LIVE.busy){ toast('他正在回'); return; } liveSend('继续'); return; }
    /* [位置:phone-talk.js·data-cmpstop] [/compact 灰字行暂停按钮] [随手记 #20：压缩回执行内「暂停」，转发后端取消口（cmpStop）] [注释时间 2026-11-14] */
    var csb=e.target.closest('[data-cmpstop]'); if(csb){ e.preventDefault(); e.stopPropagation(); cmpStop(); return; }
    var cp=e.target.closest('.md-cp'); if(!cp) return; e.stopPropagation(); var cd=cp.closest('.md-code'); cd=cd&&cd.querySelector('code'); if(!cd) return;
    copyText(cd.textContent).then(function(){ cp.textContent='已复制'; cp.classList.add('ok'); buzz(8); clearTimeout(cp._t); cp._t=setTimeout(function(){ cp.textContent='复制'; cp.classList.remove('ok'); },1500); },function(){ toast('这台手机不让拷贝'); }); });
  var unread=0, lastReal=0, jb=$('#tkJb',win);
  /* [位置:phone-talk.js·jbFollow] [「回到底部」按钮跟着输入区的高度走] [10-23 需求 45：原来按钮 bottom 写死 80px，输入框折成多行变高、或者上面出现附件条时，按钮就压进输入框里；现在量输入区（输入框 + 附件条）顶部的实际位置，按钮浮在它上面（10-31：有时被输入区上缘挡住，偏移 12px 抬到 24px）；输入框长高/缩回的动画里每一帧都跟（ResizeObserver）] [注释时间 2026-10-31 改] */
  (function(){ var cp=$('.tk-cp',win), at=$('#tkAtt',win); if(!cp) return;
    function place(){ var par=jb.offsetParent; if(!par||cp.offsetParent!==par) return; var y=cp.offsetTop; if(at&&!at.hidden&&at.offsetHeight&&at.offsetParent===par) y=Math.min(y,at.offsetTop); var b=Math.round(par.clientHeight-y+24); if(b>0) jb.style.bottom=b+'px'; }
    /* [位置:phone-talk.js·jbFollow 自卸] [窗口关掉后 disconnect] [2026-10-27 审查：原来 observe 完永不 disconnect，闭包钉住输入区+窗口 DOM] [注释时间 2026-10-27] */
    place(); if(window.ResizeObserver){ var ro=new ResizeObserver(function(){ if(!win.isConnected){ ro.disconnect(); return; } place(); }); ro.observe(cp); if(at) ro.observe(at); ro.observe(win); } })();
  /* [位置:phone-talk.js·jbPaint] [回到底部按钮：快速往上滑才冒出来，没有数量角标] [10-23 需求 57：以前只要离底部一屏多就一直挂着；现在要手指往上滑得很快（连续几帧每秒 2500 像素以上）、并且离底部超过一屏半才出现，停手 2 秒收回去；输入框有焦点（正在打字）一律不出现；按钮上只剩箭头] [注释时间 2026-10-23] */
  var jbFast=false, jbT=0, jbN=0, jbY=0, jbTs=0;
  function jbPaint(){ var far=list.scrollHeight-list.scrollTop-list.clientHeight>list.clientHeight*1.5; jb.classList.toggle('show',jbFast&&far&&document.activeElement!==ta); }
  function jbWatch(){ var y=list.scrollTop, ts=Date.now(), dy=jbY-y, dt=ts-jbTs; jbY=y; jbTs=ts;
    if(list.scrollHeight-y-list.clientHeight<40){ jbFast=false; jbN=0; return; }
    if(!byHand||dt<=0||dt>120){ jbN=0; return; }
    if(dy/dt*1000>2500){ if(++jbN>=3){ jbFast=true; clearTimeout(jbT); jbT=setTimeout(function(){ jbFast=false; jbPaint(); },2000); } } else if(jbN>0) jbN--; }
  ta.addEventListener('focus',function(){ jbFast=false; jbPaint(); });
  jb.addEventListener('click',function(){ buzz(6); unread=0; jbFast=false; if(typeof LOC!=='undefined'&&LOC){ exitLoc().then(function(){ list.scrollTo({top:list.scrollHeight}); jbPaint(); }); return; } list.scrollTo({top:list.scrollHeight,behavior:'smooth'}); setTimeout(jbPaint,450); });
  var STK=(getComputedStyle(document.documentElement).getPropertyValue('--av-ai').match(/url\("?([^")]+)/)||[])[1]||'/uploads/img-mu9ok9in-09f154a0.jpg';

  /* 他回复中：只有「输入中」的小气泡，点它就出思考抽屉（流式） */
  function liveHTML(){ return liveWrap(); }
  /* [位置:phone-talk.js·tk-fade] [极简的顶部暗角（常驻）] [2026-10-27：顶部原本有暗角的——从滚动容器上的 mask 搬到这块不动的静态渐变（形状复刻原 mask），视觉一样、不再参与滚动合成；滚动时不出现/消失，也就不闪了] [注释时间 2026-10-27 改] */
  (function(){ var f=document.createElement('div'); f.className='tk-fade'; f.setAttribute('aria-hidden','true'); host.appendChild(f); })();
  render(true);

  /* ---------- 手指往下滑（看更早的）：头像完整露出来；往上滑：头像收走，名字胶囊变成和两边圆钮一样高、同一行居中 ---------- */
  /* 只认手指 / 滚轮带来的滚动；程序自己滚到底（刚打开、发消息）不算 */
  var lastTop=0, byHand=false;
  ['touchstart','pointerdown','wheel'].forEach(function(ev){ list.addEventListener(ev,function(){ byHand=true; lastTop=list.scrollTop; },{passive:true}); });
  /* [位置:phone-talk.js·手势松开贴底] [手指上滑/滚轮上滚的瞬间松开自动贴底] [10-31：生成中打字机每帧把列表按回底部（livePaint 的 TW.atBot 分支），手指慢慢上滑时 scrollFrame 又按「离底<140」把 atBot 翻回 true，形成拉锯——上滑要滑好几次才挣得脱，iOS 惯性滚动也会被 JS 设 scrollTop 掐断；现在 touchmove 一检测到从按下位置累计上移>2px（桌面滚轮上滚同理）立刻 TW.hand=true、TW.atBot/pinned=false，程序彻底不抢滚动；滑回底部（far<40）由 scrollFrame 清 hand 自动恢复跟随；发消息后的强制跟底（render nearEnd 分支）也清 hand] [注释时间 2026-10-31] */
  var handY=0;
  list.addEventListener('touchstart',function(e){ handY=e.touches&&e.touches[0]?e.touches[0].clientY:0; TW.touch=true; TW.tsAt=Date.now(); },{passive:true});
  /* [位置:phone-talk.js·touchmove 续期] [触摸冻结续期] [2026-11-01 审查修复：原来只认 touchstart 起点，按住/慢滑超过 3 秒冻结自动解除，流式写入恢复后一旦重建手指按住的节点，iOS 不再派发 touchmove；这里每次 move 续 TW.tsAt，3 秒仍作“丢失 touchend”兜底] [注释时间 2026-11-01] */
  list.addEventListener('touchmove',function(e){ if(TW.touch) TW.tsAt=Date.now(); if(TW.hand||!e.touches||!e.touches[0]||handY-e.touches[0].clientY<=2) return; TW.hand=true; TW.atBot=false; pinned=false; },{passive:true});
  list.addEventListener('wheel',function(e){ if(TW.hand||!(e.deltaY>0)) return; TW.hand=true; TW.atBot=false; pinned=false; },{passive:true});
  /* [位置:phone-talk.js·触摸冻结] [手指按住列表时暂停流式写入] [10-31 二次反馈「更划不动了」：真凶是每帧 DOM 重建——打字机每帧把正在打的尾块 removeChild+重建（mnSyncText）、思考/工具窗整体换 innerHTML（mnSyncRow），手指按住的正是贴底的实时区；touchstart 的目标节点在触摸中途被移出文档后 iOS 不再派发 touchmove，滚动启动不了（mosuzi《一次让我重新理解 touchmove 的线上 Debug》同款病例；10-31 气泡接入打字机后两种样式全中招，症状加重）；解法照 ChatGPT 网页端同类做法：手指按住期间冻结全部流式 DOM 写入，松手（touchend/touchcancel）或 3 秒超时兜底后 liveFrame 补画，积压由打字机自适应速率自动追平；顺带修复生成中长按选字被每帧重建打断] [注释时间 2026-10-31] */
  function twHold(){ return TW.touch&&Date.now()-TW.tsAt<3000; }
  ['touchend','touchcancel'].forEach(function(ev){ list.addEventListener(ev,function(){ if(!TW.touch) return; TW.touch=false; if(ST) liveFrame(); },{passive:true}); });
  /* 头像不再跟着滑动展开/收起（10-20：下滑就展开这个逻辑去掉）：能滚动的会话一直是胶囊；
     只有消息少、根本滚不动的时候（比如新会话）才是完整头像。 */
  /* [位置:phone-talk.js·headSync] [mini 状态只在真变时才写] [原来每个 scroll 事件都 classList.toggle("mini", ...)，而这个 class 会切另一套 mask（滚动容器上的遮罩重建），是最贵的一笔；值没变就别碰 DOM] [注释时间 2026-10-27] */
  var miniNow=null;
  function headSync(){ var can=list.scrollHeight-list.clientHeight>20; if(can===miniNow) return; miniNow=can; host.classList.toggle('mini',can); }
  /* [位置:phone-talk.js·list scroll] [滚动回调节流] [2026-10-27（子智能体性能调查结论 2）：原来每个 scroll 事件连着读 5 次 scrollHeight/clientHeight（强制同步布局），还在回调里 toggle .mini；现在整个回调整体塞进 rAF，一帧最多算一次，.mini 只在值真变时才写。曾试过「滚动期间临时摘顶栏毛玻璃」的降级，产品确定撤销（滚动中按钮变实底她不要），毛玻璃滚动时原样保留；暗角则常驻搬家到 .tk-fade（见 CSS）] [注释时间 2026-10-27 三改] */
  var scRaf=0;
  function scrollFrame(){
    scRaf=0;
    jbWatch(); jbPaint();
    var far=list.scrollHeight-list.scrollTop-list.clientHeight;
    if(far<40) TW.hand=false;   /* 滑回底部附近：清「用户上滑离开」标记，自动贴底恢复跟随 */
    TW.atBot=TW.hand?false:far<140; if(far<40) unread=0;
    headSync(); if(list.scrollTop<300) loadOlder();
  }
  list.addEventListener('scroll',function(){
    if(scRaf) return;
    scRaf=requestAnimationFrame(scrollFrame);
  },{passive:true});

  /* ---------- 输入：发送键在输入框里面；回车默认只换行（头像菜单里可开「回车直接发送」）；我的消息永远一个气泡；他的回复能按空行分气泡（气泡样式头像菜单里的开关，极简不显示） ---------- */
  /* [位置:phone-talk.js·ta keydown] [回车直接发送] [开关开着时：回车=发送，Shift+回车=换行；输入法选字中的回车不算；他正在回的时候回车不当「停止」用，直接忽略] [注释时间 2026-10-21] */
  ta.addEventListener('keydown',function(e){
    if(!OPT.enterSend||e.key!=='Enter'||e.shiftKey||e.isComposing||e.keyCode===229) return;
    e.preventDefault(); if(LIVE.on&&LIVE.busy&&!qMode()) return; if(!sendB.disabled) sendB.click(); });
  /* [位置:phone-talk.js·fitTa/kb 跟随] [输入框自适应与软键盘跟随] [照旧 chat.html 的 core-behavior：输入框随内容增高（有动画、最高 28% 屏高、超出框内滚动），发送键和 + 钉在底部；软键盘弹起整页让出键盘高度（visualViewport），原来贴底的消息保持贴底] [注释时间 2026-10-21] */
  var fieldEl=ta.closest('.field'), pinned=true, taLen=-1;
  function ekh(){ if(OPT.enterSend) ta.setAttribute('enterkeyhint','send'); else ta.removeAttribute('enterkeyhint'); } ekh();   /* 回车直接发送开着时，软键盘回车键显示「发送」 */
  /* [位置:phone-talk.js·setPlus] [多行态把加号搬进输入框] [2026-11-06 深夜：多行时「那个菜单按钮也要包到输入框里面」，单行仍在框外。加号原本是 field 的兄弟节点（composer > plus + field），只能换父节点；直接换会瞬移，所以搬完先量新旧位置差，再用 transform 从旧位置滑到新位置（160ms，跟输入框长高同一套缓动）。盒子尺寸两种状态都是 var(--ibh)，尺寸不变，只平移不缩放。极简主题（MIN）不走这里——它的加号本来就在框内 mn-bar 里] [注释时间 2026-11-06] */
  function setPlus(inField, anim){
    var pb=$('#tkPlusBtn',win), cp=$('.composer.tk-cp',win);
    if(!pb||!cp||!fieldEl) return;
    if((pb.parentElement===fieldEl)===!!inField) return;
    var r0=anim?pb.getBoundingClientRect():null;
    if(inField){ var sn=fieldEl.querySelector('.tk-send'); fieldEl.insertBefore(pb, sn||null); }
    else cp.insertBefore(pb, fieldEl);
    if(!r0||!pb.animate) return;
    var r1=pb.getBoundingClientRect(), dx=r0.left-r1.left, dy=r0.top-r1.top;
    if(Math.abs(dx)<1&&Math.abs(dy)<1) return;
    pb.style.transformOrigin='top left';
    var a=pb.animate([{transform:'translate('+dx.toFixed(1)+'px,'+dy.toFixed(1)+'px)'},{transform:'none'}],{duration:160,easing:'cubic-bezier(.2,.8,.2,1)'});
    a.onfinish=function(){ pb.style.transformOrigin=''; };
  }
  function fitTa(anim){ var from=ta.offsetHeight; if(ta.getAnimations) ta.getAnimations().forEach(function(a){ a.cancel(); }); var fFrom=fieldEl?fieldEl.offsetHeight:0, wasM=fieldEl?fieldEl.classList.contains('multi'):false; ta.style.height='auto'; var need=ta.scrollHeight; if(MIN&&fieldEl){ var lh0=parseFloat(getComputedStyle(ta).lineHeight)||25; if(!ta.value) fieldEl.classList.remove('mn2'); else if(!fieldEl.classList.contains('mn2')&&need>lh0*1.25){ fieldEl.classList.add('mn2'); ta.style.height='auto'; need=ta.scrollHeight; } } var lh=parseFloat(getComputedStyle(ta).lineHeight)||23, multi=(fieldEl&&!MIN)?(wasM?(!!ta.value&&need>lh*0.9+11):need>lh*1.6+18):false;
    /* [位置:phone-talk.js·fitTa 多行态] [气泡主题两段式布局的开关：滞回 + 换宽重量] [2026-11-06 晚：折行后改两段式（文字满宽、按钮下一行）。宽度一变折行就变少，所以开/关用两个阈值不抖：窄宽度下满 2 行才开（lh*1.6+18），宽宽度下回到 1 行才关（lh*1.2+18）；挂上 multi 后宽度变了要重量一次，否则高度按旧折行算会多出空白] [注释时间 2026-11-06] */
    if(fieldEl&&!MIN){
      var probe=false;
      if(wasM&&multi&&need<=lh*1.6+11&&ta.value.length<taLen){   /* 多行态下已经只剩一行多：临时摘掉 multi 按窄宽度重量一次——窄宽度下还是 2 行就留着，真的只剩 1 行才关。不这么试，关了宽度一窄又折成 2 行、下次输入又开，就来回抖 */
        fieldEl.classList.remove('multi'); setPlus(false,false); ta.style.height='auto'; probe=true;
        multi=ta.scrollHeight>lh*1.6+18; if(multi){ fieldEl.classList.add('multi'); setPlus(true,false); }
      } else if(multi!==wasM){ fieldEl.classList.toggle('multi',multi); setPlus(multi,anim); probe=true; }
      if(probe){ ta.style.height='auto'; need=ta.scrollHeight; }   /* 宽度变了要重量，否则高度按旧折行算会多出空白 */
      taLen=ta.value.length;   /* 只在字变少时才试缩回去（打字时不可能需要关），省掉每个字一次多余的摘类-加类重排 */
    }
    var max=Math.max(60,Math.min(160,Math.round(innerHeight*.28))); if(multi) max=Math.max(60,max-40);   /* 多行态按钮独占一行，上限扣掉按钮行，整体框高不超屏高 28% */
    var to=Math.min(need,max);
    ta.style.height=to+'px'; ta.style.overflowY=need>max+1?'auto':'hidden';
    var fTo=(fieldEl&&multi!==wasM)?fieldEl.offsetHeight:0;   /* 必须在 ta.animate 之前量：动画一开跑 offsetHeight 就是中间帧，会量成半路的值 */
    if(anim&&!TW.rm){ if(from&&Math.abs(from-to)>1&&ta.animate) ta.animate([{height:from+'px'},{height:to+'px'}],{duration:160,easing:'cubic-bezier(.2,.8,.2,1)'});
      /* 两段式开关那一下框会猛地高一截/矮一截，补一段同参数高度动画 */
      if(fTo&&fFrom&&Math.abs(fTo-fFrom)>1&&fieldEl.animate){
        /* [位置:phone-talk.js·框高动画的起点] [按钮行那一段不进动画] [2026-11-06 深夜：按钮行是「瞬间」出现的（plus 换行到第二行），凭空多出 52px；如果让框从 44 一路动到 134，头两三帧框还没长够、按钮就已经在框底下露着了（实测 t=0 露出 46px）。所以把这一行的高度从动画范围里摘掉：框一上来就直接含住按钮行，动画只负责文字自己长高的那 30~46px，这样每一帧按钮都在框内、文字也不会溢出] [注释时间 2026-11-06] */
        var pbA=$('#tkPlusBtn',win), rowH=pbA?pbA.offsetHeight+8:0, fStart=multi?fFrom+rowH:fFrom-rowH;   /* +8 = 上下各 4px margin，与 .field.multi .plus 的 margin 一致 */
        fieldEl.animate([{height:fStart+'px'},{height:fTo+'px'}],{duration:160,easing:'cubic-bezier(.2,.8,.2,1)'});
      } } }
  /* [位置:phone-talk.js·extractSuggest/applySuggest/dropSuggest/sgTouch] [AI 推荐回复标签处理] [用户 随手记第21条，2026-11-13 二改交互：推荐填入后一直躺着（灰态字+✦推荐角标），点一下输入框只解除灰态转正——字留着，光标落点击处，可原地改、续写、删除；发送出去的=输入框当前的字（原样或改过），发送后才算消费掉；「只在一轮」：AI 下一轮带新推荐→空框或躺着没动过的旧推荐就换成新的（回到灰态），用户改过字就不碰；没带推荐→躺着没动过的旧推荐撤掉，动过字不碰。去重废弃 localStorage（ph.sugg.v1 不再读，旧键无害残留），改文字对照：ta.value===SUGGEST_STATE.text 即「没动过」——刷新/重进后没发送的推荐会重新填回，已回复过则这条 AI 消息不再是最后一条，isLast 守卫天然挡住，推荐生命周期自然只有一轮] [注释时间 2026-11-13 二改] */
  var SUGGEST_STATE={text:'',on:false,rej:0};   /* text=当前推荐原文（「改没改过」的对照基准）；on=灰态（还没点过/敲过）；rej=本轮删光拒绝过（同轮重复到达不再复活） */
  function extractSuggest(m){
    if(!m||m.role!=='assistant') return '';
    var tx=String(typeof m.content==='string'?m.content:mText(m));
    var match=tx.match(/<\s*suggest\b[^>]*>([\s\S]*?)<\s*\/suggest\s*>/i);
    return match?match[1].trim():'';
  }
  function dropSuggest(clearText){
    if(!SUGGEST_STATE.text&&!SUGGEST_STATE.on) return;
    SUGGEST_STATE.text=''; SUGGEST_STATE.on=false; SUGGEST_STATE.rej=0;
    if(host) host.classList.remove('has-suggest');
    if(clearText){ ta.value=''; busyPaint(); fitTa(true); dPut(''); }
  }
  /* [位置:phone-talk.js·sgTouch] [灰态转正] [点输入框或敲字都不删字，只摘灰态与角标；推荐原文继续留在 SUGGEST_STATE.text 当对照，下一轮 AI 说话时用它判断「改没改过」] [注释时间 2026-11-13] */
  function sgTouch(){
    if(!SUGGEST_STATE.on) return;
    SUGGEST_STATE.on=false;
    if(host) host.classList.remove('has-suggest');
  }
  function applySuggest(m,isLast){
    if(!m||m.role!=='assistant'||!m.id) return;
    var sg=extractSuggest(m);
    if(!sg){
      /* 新一轮没带推荐：上一条推荐还原样躺着（没点过没改过）→ 撤掉；用户动过字就不碰 */
      if(isLast&&!LIVE.busy&&SUGGEST_STATE.text&&ta.value===SUGGEST_STATE.text) dropSuggest(true);
      return;
    }
    if(!isLast||LIVE.busy) return;
    /* 空框或躺着没动过的旧推荐 → 填/换（回到灰态）；用户自己的字（≠旧推荐原文）不覆盖 */
    if(ta.value.trim()&&ta.value!==SUGGEST_STATE.text) return;
    if(sg===SUGGEST_STATE.text&&(ta.value===sg||SUGGEST_STATE.rej)) return;   /* 同一条推荐重复到达（收尾后 1.5s reload / SSE history_update）：灰态/已转正都保持现状；本轮删光拒绝过不再复活 */
    SUGGEST_STATE.text=sg; SUGGEST_STATE.on=true; SUGGEST_STATE.rej=0;
    ta.value=sg;
    if(host) host.classList.add('has-suggest');
    busyPaint(); fitTa(true);
  }

  /* [位置:phone-talk.js·草稿] [聊天输入框草稿：文字 + 已传好的附件] [2026-10-21 建：没发出去的字按会话存 localStorage（ph.draft.v1:chat:<会话id>，7 天过期）；11-14：「输入框缓存只有文字，不带图片」——把已就绪的图片/文件一起存，只存服务器 URL 不存 base64 缩略图（否则 localStorage 几 MB 就爆，图多了直接写失败）；刷新/退出重进后文字和附件都回来，还在传/失败的附件不存；发送成功清空即删] [注释时间 2026-10-21；2026-11-14 加附件] */
  var DKEY='ph.draft.v1:chat:'+(LIVE.sid||'');
  function dGet(){ try{ var o=JSON.parse(localStorage.getItem(DKEY)||'null'); if(o&&Date.now()-o.t<7*864e5) return {v:String(o.v||''),a:Array.isArray(o.a)?o.a:[]}; }catch(e){} return {v:'',a:[]}; }
  function dPut(){ if(!LIVE.sid) return;
    var v=ta.value||'', a=[];
    try{ a=ATT.filter(function(x){ return x&&x.st==='ready'&&(x.url||(x.file&&x.file.url)); }).map(function(x){ var u=x.url||(x.file&&x.file.url)||''; var o2={img:x.img?1:0,name:x.name||'',url:u}; if(x.file) o2.file={name:x.file.name,url:x.file.url,size:x.file.size,mime:x.file.mime}; return o2; }); }catch(e){}
    try{ if(v||a.length) localStorage.setItem(DKEY,JSON.stringify({v:v,a:a,t:Date.now()})); else localStorage.removeItem(DKEY); }catch(e){} }
  ta.addEventListener('input',function(){ sgTouch(); if(!ta.value&&SUGGEST_STATE.text) SUGGEST_STATE.rej=1; busyPaint(); fitTa(true); dPut(); });   /* 程序填的推荐不触发 input；真有输入=用户在改：灰态转正、字保留（编辑过的推荐就是他自己的话了）；把推荐删光=本轮明确不要了，记 rej 防同轮重复到达复活 */
  ta.addEventListener('focus',function(){ sgTouch(); });   /* 点一下输入框=转正可编辑：灰态和角标退场，字留着，光标落点击处——可改、可续写、可删；转正后本轮不再回灰态 */
  /* [位置:phone-talk.js·草稿回填（文字）] [文字先回] [附件回填放在附件条初始化之后（attBar 在下面才赋值，提前调 attPaint 会报错）] [注释时间 2026-11-14] */
  if(LIVE.sid&&!ta.value){ var d0=dGet(); if(d0.v){ ta.value=d0.v; busyPaint(); fitTa(false); } }
  list.addEventListener('scroll',function(){ pinned=list.scrollHeight-list.scrollTop-list.clientHeight<100; },{passive:true});
  /* [位置:phone-talk.js·贴底跟随 自卸] [窗口关掉后 disconnect] [2026-10-27 审查：同 jbFollow] [注释时间 2026-10-27] */
  if(window.ResizeObserver){ var roPin=new ResizeObserver(function(){ if(!win.isConnected){ roPin.disconnect(); return; } if(pinned) list.scrollTop=list.scrollHeight; }); roPin.observe(list); }
  /* [位置:phone-talk.js·dockH] [输入栏 --cph 与独立引用留白 --qph] [10-30：消息从输入栏后面滑过，列表 margin-bottom 取负、padding-bottom 补回；2026-11-24 引用条改绝对定位后不再撑 composer，可见高度与 8px 间距单独写 --qph。两个变量必须分开：若把引用高度也塞进 --cph，列表负 margin 与正 padding 会一起增加、可视底端不动；独立 --qph 只加 padding，贴底消息才会真正上移] [注释时间 2026-10-30；2026-11-24 改] */
  var cpEl=$('.tk-cp',win), cph=-1, qph=-1;
  function dockSync(){ if(!cpEl||!win.isConnected) return; var qh=(qteBar&&!qteBar.hidden)?qteBar.offsetHeight+8:0, h=cpEl.offsetHeight; if(h===cph&&qh===qph) return; cph=h; qph=qh; host.style.setProperty('--cph',h+'px'); host.style.setProperty('--qph',qh+'px'); if(pinned) list.scrollTop=list.scrollHeight; }
  if(!MIN&&window.ResizeObserver){ var roDock=new ResizeObserver(function(){ if(!win.isConnected){ roDock.disconnect(); return; } dockSync(); }); roDock.observe(cpEl); }
  /* [位置:phone-talk.js·kb 跟随] [软键盘让位健壮版] [2026-10-30报「极简主题输入框不跟键盘顶起」：原实现只监听 visualViewport 的 resize/scroll、用 innerHeight-vv.height 算高度；在部分 WebView/独立窗口里这些事件不触发，或 innerHeight 和 vv.height 同步缩小，kb 恒为 0 → 输入框留在键盘下面（CSS 侧实测 --kb=300px 时两种主题都能正常顶起，问题在高度没算出来）。现在：①基准高度 BASE 在无键盘时记一次，键盘高度=BASE-(vv.height+vv.offsetTop)；②布局视口自己变矮（Android/部分 WebView）就不补 padding，只在「布局没变、视觉视口变矮」时补；③除 vv 事件外，textarea focus 后 1.2 秒内每 100ms 轮询、window resize / 横竖屏切换也踢一脚，事件缺失也能追上；④键盘弹起时贴底的列表继续跟到底] [注释时间 2026-10-30] */
  (function(){ var vv=window.visualViewport; if(!vv) return; var last=-1, tickT=0,
    dev=document.getElementById('device'),
    baseH=Math.max(window.innerHeight||0, document.documentElement.clientHeight||0, (dev&&dev.clientHeight)||0);
    function upd(){
      if(!host.isConnected){ vv.removeEventListener('resize',upd); vv.removeEventListener('scroll',upd); window.removeEventListener('resize',upd); return; }
      var vh=(vv.height||0)+(vv.offsetTop||0), layoutNow=document.documentElement.clientHeight||window.innerHeight||0;
      if(!document.hidden&&vh>0&&layoutNow>=baseH-1) baseH=Math.max(baseH,layoutNow,vh);   /* 无键盘时校准（横竖屏/首次进来） */
      var kb;
      if(layoutNow&&baseH&&layoutNow<baseH-100) kb=0;   /* 布局视口自己变矮：内容已经跟着缩，不再叠 padding */
      else kb=Math.max(0,Math.round((baseH||layoutNow)-vh));
      if(kb<100) kb=0;
      if(kb===last) return; last=kb;
      host.style.setProperty('--kb',kb+'px'); host.classList.toggle('kb',kb>0); try{ window.scrollTo(0,0); }catch(e){}
      if(kb>0&&pinned&&list) list.scrollTop=list.scrollHeight;
    }
    function kick(){ clearTimeout(tickT); var n=0; (function t(){ if(!host.isConnected||n++>12) return; upd(); tickT=setTimeout(t,100); })(); }
    vv.addEventListener('resize',upd); vv.addEventListener('scroll',upd); window.addEventListener('resize',upd);
    ta.addEventListener('focus',kick); ta.addEventListener('blur',function(){ setTimeout(upd,120); });
    window.addEventListener('orientationchange',function(){ setTimeout(function(){ dev=document.getElementById('device'); baseH=Math.max(window.innerHeight||0, document.documentElement.clientHeight||0, (dev&&dev.clientHeight)||0); last=-1; upd(); },350); });
    upd(); })();
  /* 他在回的时候发送键变成「停止」（照旧 chat：/v1/chat/stop，已经写出来的部分会先落盘） */
  /* [位置:phone-talk.js·busyPaint 发送排队] [回复中：输入框有字且这个会话允许排队 → 发送键变「排队发送」，没字 → 仍是「停止」] [11-04：干活会话一轮很久，中途想提醒一句；开关在会话列表的组「···」→「排队」，服务端 routes/send-queue.js 判定] [注释时间 2026-11-04] */
  function qMode(){ return !!(LIVE.on&&LIVE.busy&&QS.on===true&&ta.value.trim()&&!ATT.length); }
  function busyPaint(){ var busy=LIVE.on&&LIVE.busy; if(busy&&QS.on===null) qCheck(); var qm=qMode(), st=busy&&!qm;
    sendB.classList.toggle('stop',st); sendB.classList.toggle('qmode',qm); sendB.setAttribute('aria-label',st?'停止':(qm?'排队发送':'发送')); sendB.disabled=!st&&!qm&&!ta.value.trim()&&!ATT.length; }
  /* [位置:phone-talk.js·发送排队 QS] [排队消息的前端状态与流程] [11-04：QS.on=这个会话是否允许排队（null=还没问，服务端 GET /v1/chat/queue 的 enabled）；QS.list=排队中的 {id,text,um}。发送→POST /v1/chat/queue，成功后输入框清空、上方出「排队中」条，可撤回；每 1.5 秒轮询状态：被工具循环取走的 → 把这条 user 消息并进 LIVE.raw（id 与服务端落盘一致，下次请求带上不重复）；回复结束还没被取走的 → flush 取回，合成一条正常发出；服务端丢了的（网关重启）→ 文字放回输入框。排队暂不支持附件。] [注释时间 2026-11-04] */
  var qBar=document.createElement('div');
  qBar.className='tk-att tk-q'; qBar.hidden=true; (function(){ var ab=$('#tkAtt',win); if(ab&&ab.parentNode) ab.parentNode.insertBefore(qBar,ab); })();
  function qCheck(){ if(QS.chk||!LIVE.sid) return; QS.chk=true; var sid=LIVE.sid;
    P.net.req('/v1/chat/queue?session_id='+encodeURIComponent(sid),{headers:XC,noLogin:true}).then(function(r){ if(LIVE.sid===sid){ QS.on=!!(r&&r.enabled); busyPaint(); } QS.chk=false; },function(){ QS.chk=false; }); }
  function qPaint(){ qBar.hidden=!QS.list.length;
    qBar.innerHTML=QS.list.map(function(q){ return '<div class="att file q" data-q="'+q.id+'"><span class="ic">排队</span><span class="nm">'+esc(q.text.replace(/\s+/g,' ').slice(0,40))+'</span><button class="ax" type="button" data-qx="'+q.id+'" aria-label="撤回">×</button></div>'; }).join(''); }
  qBar.addEventListener('click',function(e){ var b=e.target.closest('[data-qx]'); if(!b) return; var id=b.getAttribute('data-qx'), it=QS.list.filter(function(x){ return x.id===id; })[0]; if(!it) return;
    P.net.req('/v1/chat/queue/cancel',{method:'POST',body:{session_id:LIVE.sid,id:id},headers:XC}).then(function(r){
      if(r&&r.removed){ QS.list=QS.list.filter(function(x){ return x.id!==id; }); ta.value=(ta.value?ta.value+'\n':'')+it.text; ta.dispatchEvent(new Event('input')); qPaint(); toast('撤回了，放回输入框'); }
      else { toast('他已经看到这条了，撤不回'); qPoll(true); } },function(){ toast('没撤成'); }); });
  function qSend(){ var tx=ta.value.replace(/\s+$/,''); if(!tx.trim()) return; tx=quoteApply(tx); var um={id:uuid(),role:'user',content:tx+'\n'+curTime(),time:new Date().toISOString()};
    P.net.req('/v1/chat/queue',{method:'POST',body:{session_id:LIVE.sid,id:um.id,text:um.content},headers:XC}).then(function(){
      QS.list.push({id:um.id,text:tx,um:um}); dropSuggest(false); ta.value=''; ta.dispatchEvent(new Event('input')); quoteClear(); qPaint(); buzz(8); toast('排队了，他做完手头这步就会看到'); qPoll(); },
      function(e){ var w=failWhy(e); if(/409|没在回复/.test(String(e&&e.message||''))){ toast('他刚好回完了，再点一次发送'); busyPaint(); } else toast('没排上：'+w); }); }
  function qTake(st){ var taken=(st&&st.taken)||[], pend=((st&&st.pending)||[]).map(function(x){ return x.id; }), moved=false, lost=[];
    QS.list=QS.list.filter(function(q){ if(taken.indexOf(q.id)>=0){ LIVE.raw.push(q.um); moved=true; return false; } if(pend.indexOf(q.id)>=0) return true; lost.push(q); return false; });
    if(moved) rebuild();
    if(lost.length&&!LIVE.busy){ /* 回复已结束仍不在队列：交给 qFinish 当作没取走的重新发 */ QS.list=QS.list.concat(lost); }
    else if(lost.length){ ta.value=(ta.value?ta.value+'\n':'')+lost.map(function(q){ return q.text; }).join('\n'); ta.dispatchEvent(new Event('input')); toast('排队的消息丢了（后台重启过？），放回输入框了'); }
    qPaint(); }
  function qPoll(now){ if(QS.t&&!now) return; clearTimeout(QS.t); QS.t=0;
    function tick(){ QS.t=0; if(!QS.list.length||!win.isConnected) return;
      P.net.req('/v1/chat/queue?session_id='+encodeURIComponent(LIVE.sid),{headers:XC,noLogin:true}).then(function(st){ qTake(st);
        if(!LIVE.busy&&QS.list.length){ qFinish(); return; }
        if(QS.list.length) QS.t=setTimeout(tick,1500); },function(){ if(QS.list.length) QS.t=setTimeout(tick,3000); }); }
    if(now) tick(); else QS.t=setTimeout(tick,1500); }
  /* 回复结束：把没被取走的排队消息取回，合成一条正常发出（等 done 的 reload 先落地再发） */
  function qFinish(){ if(!QS.list.length) return;
    P.net.req('/v1/chat/queue?session_id='+encodeURIComponent(LIVE.sid),{headers:XC,noLogin:true}).then(function(st){ qTake(st); if(!QS.list.length) return;
      P.net.req('/v1/chat/queue/flush',{method:'POST',body:{session_id:LIVE.sid},headers:XC}).then(function(r){
        var left=QS.list.slice(); QS.list=[]; qPaint(); if(!left.length) return;
        var txt=left.map(function(q){ return q.text; }).join('\n'), sid0=LIVE.sid;
        setTimeout(function(){ if(!win.isConnected||LIVE.sid!==sid0||LIVE.busy){ ta.value=(ta.value?ta.value+'\n':'')+txt; ta.dispatchEvent(new Event('input')); toast('排队的消息没发出去，放回输入框了'); return; } if(liveSend(txt)){ toast('他回完了，排队的消息已发出'); } },2200); },function(){ var l=QS.list.slice(); QS.list=[]; qPaint(); ta.value=(ta.value?ta.value+'\n':'')+l.map(function(q){ return q.text; }).join('\n'); ta.dispatchEvent(new Event('input')); }); },function(){}); }
  /* [位置:phone-talk.js·stopGen] [停止生成] [10-25：任何时候点暂停都要能截断；1025 二次收敛：停止只认会话——不再要求前端攥着 reply_msg_id（生成中退出重进后 id 已丢），没 rid 也直接发，后端按会话兜底定位；服务端说没有活请求（网关重启过/刚好收尾）时本地截断收尾，界面一定回到可输入状态] [注释时间 2026-10-25] */
  function stopGen(){ buzz(10); toast('让他停下…');
    P.net.req('/v1/chat/stop',{method:'POST',body:{session_id:LIVE.sid,reply_msg_id:LIVE.rid||''},headers:XC}).then(function(j){
      if(j&&j.stopped===false){ clearTimeout(stT); var s0=ST; LIVE.busy=false; LIVE.byStatus=false; ST=null; LIVE.dw=null;
        if(s0&&(s0.text||s0.reasoning||(s0.tools&&s0.tools.length))){ keepPartial(s0,LIVE.rid); rebuild(); partialSync(1); }
        reload(); toast('那边没有在跑的输出，已同步'); return; }
    },function(){ toast('没停下来'); }); }
  sendB.addEventListener('click',function(){ if(LIVE.on&&LIVE.busy){ if(qMode()){ qSend(); return; } stopGen(); return; } var tx0=ta.value.replace(/\s+$/,''); if(!tx0.trim()&&!ATT.length) return;
    if(ATT.length){ if(ATT.some(function(a){ return a.st==='error'; })){ toast('有附件没传上，先移除再发'); return; } if(ATT.some(function(a){ return a.st!=='ready'; })){ toast('附件还在上传，等一下再发'); return; } }
    if(LIVE.on){
      /* [位置:phone-talk.js·sendB /compact 拦截] [压缩收尾命令] [随手记 #20 产品确定：输入栏纯文本 /compact（不带附件）不出气泡、不发聊天请求，直接走 compactNow 编排现有压缩管线；带附件不当命令照常发送；回车也过这里（ta keydown 走 sendB.click）] [注释时间 2026-11-14] */
      if(!ATT.length&&/^\/compact\b/i.test(tx0.trim())){ ta.value=''; ta.dispatchEvent(new Event('input')); buzz(8); compactNow(); return; }
      var sendTx=quoteApply(tx0); if(liveSend(sendTx,ATT.length?ATT.map(attPart):undefined)){ dropSuggest(false); ta.value=''; ta.dispatchEvent(new Event('input')); quoteClear(); ATT=[]; attPaint(); buzz(8); } else if(!ATT.length){ textFailKeep(sendTx); quoteClear(); } return; } toast('先从一个会话进来，没发出去'); buzz([20,30,20]); });
  var RECMODE='text';   /* text=转文字填进输入框（输入框麦克风）；send=松开就发出去的语音（加号·语音） */
  function holdMode(on,mode){ RECMODE=on&&mode==='send'?'send':'text'; var hb=$('#tkHold',win); if(hb) hb.textContent=RECMODE==='send'?'按住 发语音':'按住 说话'; host.classList.toggle('hold',on); plusOpen(false); buzz(6); }
  $('#tkKb',win).addEventListener('click',function(){ holdMode(false); });
  $('#tkHold',win).addEventListener('pointerdown',function(e){ e.preventDefault(); recStart(); });
  /* ---------- 按住说话 / 点击录音：真录 16k 单声道 WAV → /admin/asr 认字，认出来填进输入框（长按=松手停，气泡；点击=再点停，极简） ---------- */
  var RC=null;
  /* [位置:phone-talk.js·recStart] [开始录音] [权限 → MediaRecorder + 波形浮层（计时、120 秒自动停）；micEl 传了=点击式（极简麦克风）：浮层文案「再点一下结束」、松手不停（松开即停只属于长按模式）、点浮层任意处停止，麦克风变红呼吸] [注释时间 2026-10-27 改：原来只服务长按，现支持点击式] */
  function recStart(micEl){
    if(RC) return;
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){ toast('这台设备不支持录音'); return; }
    buzz(12); var ov=document.createElement('div'); ov.className='tk-rec'+(micEl?' tapstop':'');   /* tapstop：点击式浮层可点（点任意处停止转写） */
    var bars=''; for(var i=0;i<22;i++) bars+='<u style="--d:'+(i*60)+'ms"></u>';
    ov.innerHTML='<div class="pane"><div class="wv">'+bars+'</div><b>0:00</b><small>'+(RECMODE==='send'?'松开发送':(micEl?'再点一下结束':'松开转成文字'))+'</small></div>';
    if(micEl) ov.addEventListener('click',function(){ if(RC) recDone(); });   /* 长按模式手指按在按钮上，click 到不了浮层，天然不冲突 */
    host.appendChild(ov); host.classList.add('recording'); requestAnimationFrame(function(){ ov.classList.add('show'); });
    RC={ov:ov,stream:null,mr:null,chunks:[],t0:Date.now(),tick:null,mode:RECMODE,clickStop:!!micEl,mic:micEl||null};
    if(micEl) micEl.classList.add('rec-on');   /* 麦克风录音中：主色+呼吸 */
    RC.tick=setInterval(function(){ if(!RC) return; var s=Math.floor((Date.now()-RC.t0)/1000);
      var b=RC.ov&&RC.ov.querySelector('b'); if(b) b.textContent=Math.floor(s/60)+':'+('0'+(s%60)).slice(-2);
      if(s>=120) recDone(); },250);
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(st){
      if(!RC){ try{ st.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} toast('麦克风刚给了权限，再按住说一次'); return; }
      RC.stream=st; var mr=null; try{ mr=new MediaRecorder(st); }catch(e){ mr=null; }
      if(!mr){ recDone(true); toast('这台设备录不了音'); return; }
      RC.mr=mr;
      var rc0=RC; mr.ondataavailable=function(e){ if(e.data&&e.data.size) rc0.chunks.push(e.data); };
      mr.onstop=function(){ recDone(); };
      try{ mr.start(); }catch(e){ recDone(true); toast('录不起来'); }
    },function(){ recDone(true); toast('没给麦克风权限'); });
  }
  /* ---------- 语音防丢队列（IndexedDB）：录音一停先落队，正式消息发出才出队 ----------
     [位置:phone-talk.js·vqPut/vqAll/vqDel] [用户 1026：转写没完就退出聊天页，消息整条蒸发——
     原流程 recDone→wav16→/v1/voice/send→liveSend 全在内存，页面一关全没了。现在 fin 落队、
     vDrop 出队（成功 / 无人声 / 不发了都走它）。
     11-14：自动重发整个去掉——队列只做跳页面保留，进会话时由 vRestore 恢复成一条
     「没发出去，点这里重试」的本地语音，不再自己转写重发，发不发由她点] [注释时间 2026-10-26；2026-11-14 去自动重发] */
  var VQDB=null;
  function vqOpen(){ if(VQDB) return Promise.resolve(VQDB);
    return new Promise(function(res){ var r; try{ r=indexedDB.open('tk-voice-q',1); }catch(e){ return res(null); }
      r.onupgradeneeded=function(){ try{ r.result.createObjectStore('t',{keyPath:'id'}); }catch(e){} };
      r.onsuccess=function(){ VQDB=r.result; res(VQDB); }; r.onerror=function(){ res(null); }; }); }
  function vqPut(t){ return vqOpen().then(function(db){ if(!db) return; try{ db.transaction('t','readwrite').objectStore('t').put(t); }catch(e){} },function(){}); }
  function vqAll(){ return vqOpen().then(function(db){ if(!db) return [];
    return new Promise(function(res){ try{ var rq=db.transaction('t').objectStore('t').getAll(); rq.onsuccess=function(){ res(rq.result||[]); }; rq.onerror=function(){ res([]); }; }catch(e){ res([]); } }); },function(){ return []; }); }
  function vqDel(id){ return vqOpen().then(function(db){ if(!db||!id) return; try{ db.transaction('t','readwrite').objectStore('t').delete(id); }catch(e){} },function(){}); }
  /* [位置:phone-talk.js·vDupHit] [语音去重键清洗] [2026-11-01 审查修复：sec 拼进正则前只保留数字，防止非数字来源带正则元字符造成误匹配；秒数本身是数字，清洗不改变正常匹配] [注释时间 2026-11-01] */
  function vDupHit(sec){ sec=String(sec==null?'':sec).replace(/[^\d]/g,''); if(!sec) return false; var p=new RegExp('\\[语音消息 '+sec+'秒 #[\\w-]+\\]'); return (LIVE.raw||[]).some(function(m){ return m&&!m._vp&&p.test(String(m.content||'')); }); }
  /* [位置:phone-talk.js·vRestore] [滞留语音只恢复成失败条，不自动重发] [11-14：自动补发整个去掉——语音没发出去就留在前端、标「没发出去，点这里重试」，发不发由她点。队列只用来跳页面保留：进会话时把本会话最近一条滞留任务恢复成一条 _vp 失败语音（不请求、不转写、不花钱），音频还在 IndexedDB 里，点重试才真发。历史还没拉回来时先等（最多 8 秒），避免刚恢复就被 reload 覆盖] [注释时间 2026-11-14] */
  function vRestore(tries){
    if(!LIVE.on||!LIVE.sid||LIVE.vpend||!win.isConnected) return;
    if(!(LIVE.raw||[]).length){ if((tries||0)<8) setTimeout(function(){ vRestore((tries||0)+1); },1000); return; }
    vqAll().then(function(list){
      var t=null; for(var i=list.length-1;i>=0;i--){ var x=list[i]; if(x&&x.sid===LIVE.sid){ t=x; break; } }   /* 只恢复最近一条：vpend 同时只挂一条，其余的等她处理完这条再说 */
      if(!t) return;
      if((LIVE.raw||[]).some(function(m){ return m&&m.id===t.id; })) return;
      if(vDupHit(t.sec)){ vqDel(t.id); return; }   /* 服务器那边已经有这条的正式记录了（上次其实发出去了） */
      var sec=Math.max(1,Math.round(+t.sec||0)), src='';
      try{ if(t.blob) src=URL.createObjectURL(t.blob); }catch(e){}
      var pm={id:t.id,role:'user',content:'[语音消息 '+sec+'秒 #'+String(t.id||'').slice(0,8)+'] ',time:new Date(+t.ts||Date.now()).toISOString(),_vp:{st:'err',why:'上次没发出去',src:src,sec:sec,b64:'',blob:t.blob||null,res:null}};
      LIVE.vpend=pm; LIVE.raw.push(pm); rbForce=true; rebuild();
      toast('上次有条语音没发出去，点重试再发');
    },function(){});
  }
  /* [位置:phone-talk.js·vSend/vDeliver/vDrop/vRetry] [语音先发出去、描述后补] [10-24：松手后语音条马上出现在聊天里（能点开听），底下写「识别中…」；千问识别好之后再把「[语音消息 N秒 #id] 转写［声音描写］」发给 AI，语音条换成正式的那条。识别没成功 / 他正在回上一条时，语音条留着，底下给「重试 / 不发了」；这条本地消息（_vp）不发给上游、不落盘，重载历史时补回去；识别期间不能发文字，免得顺序乱] [注释时间 2026-10-24] */
  function vSend(pm){ var vp=pm._vp; if(!vp.b64){ vRetry(pm.id); return; } vp.st='wait'; vp.why=''; rebuild();
    return P.net.req('/v1/voice/send',{method:'POST',body:{audio:vp.b64,dur:vp.sec},headers:XC,noLogin:true,timeout:180000}).then(function(j){
      if(!win.isConnected||LIVE.vpend!==pm) return; var tx=String((j&&j.text)||'').trim();
      if(!tx||tx==='［无人声］'){ vDrop(pm); toast('没听到声音，再说一次'); return; }
      vp.res={id:j.id,dur:(j&&j.dur)||vp.sec,tx:tx}; vDeliver(pm);
    },function(x){ if(LIVE.vpend!==pm) return; vp.st='err'; vp.why=failWhy(x); rebuild(); toast('语音没发出去：'+vp.why); }); }
  /* [位置:phone-talk.js·vSend 超时] [转写等得久也不能掐] [11-14：前端请求默认 45 秒超时，长语音后端转写本来就要 60~100 秒，原来一律先被前端掐断、重试还是掐断；这一路单独放到 180 秒，与后端 100 秒上限留余量] [注释时间 2026-11-14] */
  function vDeliver(pm){ var vp=pm._vp, r=vp.res;
    if(LIVE.busy){ vp.st='err'; vp.why='他还在回上一条'; rebuild(); toast('他还在回上一条，回完点重试'); return; }
    if(LIVE.vpend&&LIVE.vpend!==pm){ vp.st='err'; vp.why='上一条语音还在处理'; rebuild(); toast('上一条语音还在处理'); return; }
    /* [位置:phone-talk.js·vDeliver 音频part] [语音当轮带原声引用] [11-12：Gemini 订阅的 gemini 系模型能直接听音频（探针实证），发消息时附带 /uploads 引用 part——网关只在发订阅上游当轮内联 base64，历史/落盘只有轻引用；转写文字照发（气泡显示+非 gemini 模型兜底），模型既听原声又有标注参考] [注释时间 2026-11-12] */
    var ap=r.id?[{type:'input_audio',input_audio:{url:'/uploads/voice-'+r.id+'.wav',format:'wav'}}]:undefined;
    /* [位置:phone-talk.js·vDeliver 不先删] [发不出去就不删这条] [11-14：原来是先 vDrop（把本地语音从会话里删掉）再 liveSend，liveSend 一旦拒（忙 / 语音占用）这条就整条蒸发，只剩一句 toast。现在先腾出 vpend 位再发，发成了才删本地那条；没发成就挂回去标失败，消息留在界面等她重试] [注释时间 2026-11-14] */
    if(LIVE.vpend===pm) LIVE.vpend=null;   /* 先腾位：liveSend 见到 vpend 会直接拒 */
    if(liveSend('[语音消息 '+r.dur+'秒 #'+r.id+'] '+r.tx, ap)){ vDrop(pm); buzz(8); }
    else { LIVE.vpend=pm; vp.st='err'; vp.why='没发出去'; rebuild(); } }   /* liveSend 拒了：这条留着，不删 */
  function vDrop(pm){ if(LIVE.vpend===pm) LIVE.vpend=null; LIVE.raw=LIVE.raw.filter(function(m){ return m!==pm; }); try{ URL.revokeObjectURL(pm._vp.src); }catch(e){} vqDel(pm&&pm.id); rebuild(); }
  /* [位置:phone-talk.js·vRetry] [按消息重试，不再只认 LIVE.vpend 那一条] [11-14：忙 / 语音占用时新录的那条只展示不占 vpend 位，重试按钮必须能认出是哪一条；转码失败或刷新恢复的那条只有 blob，点重试从 blob 重新转一次码再发，不再拿空音频去撞后端] [注释时间 2026-11-14] */
  function vRetry(id){
    var pm=null;
    if(id) (LIVE.raw||[]).forEach(function(m){ if(m&&m.id===id) pm=m; });
    if(!pm) pm=LIVE.vpend;
    if(!pm||!pm._vp||pm._vp.st==='wait') return;
    if(LIVE.vpend&&LIVE.vpend!==pm){ toast('上一条语音还在处理，先等它'); return; }
    LIVE.vpend=pm;
    if(pm._vp.res){ vDeliver(pm); return; }
    if(pm._vp.b64){ vSend(pm); return; }
    if(pm._vp.blob){ var vp=pm._vp; vp.st='wait'; vp.why=''; rebuild();
      wav16(vp.blob).then(function(b64){ if(LIVE.vpend!==pm) return; vp.b64=b64; return vSend(pm); },function(){ if(LIVE.vpend!==pm) return; vp.st='err'; vp.why='这段音频转不了'; rebuild(); toast('这段音频转不了'); });
      return; }
    toast('这条语音的音频没了，重录一次吧');
  }
  function recDone(abort){
    var r=RC; if(!r) return; RC=null;
    clearInterval(r.tick);
    try{ if(r.stream) r.stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
    host.classList.remove('recording');
    if(r.mic){ r.mic.classList.remove('rec-on'); }
    if(r.ov){ r.ov.classList.remove('show'); setTimeout(function(){ try{ r.ov.remove(); }catch(e){} },250); }
    if(abort) return;
    /* [位置:phone-talk.js·recDone] [等录音器吐完最后一段再判断] [10-23 真机：长按录音一直提示「没录到声音」。原因：MediaRecorder 的数据在 stop 之后才异步给出来（dataavailable），原来 stop 后马上看 chunks，永远是空；现在等 onstop（最多 1.5 秒）再往下走] [注释时间 2026-10-23] */
    function fin(){
    if(!r.chunks.length){ toast('没录到声音'); return; }
    var blob=new Blob(r.chunks,{type:(r.mr&&r.mr.mimeType)||'audio/mp4'});
    if(!LIVE.on){ toast('先从一个会话进来'); return; }
    if(r.mode==='send'){ var sec=Math.round((Date.now()-r.t0)/1000); if(Date.now()-r.t0<800){ toast('太短了，再按久一点'); return; }
      /* [位置:phone-talk.js·recDone 语音不丢] [忙 / 上一条占用也照样留在界面] [11-14：原来忙或语音占用时这条录音直接丢掉、只留一句 toast；现在照样插进会话标「没发出去，点这里重试」，音频照样入队（跳页面保留）。忙的时候不抢 vpend 位——那个上一条在用，重试按消息 id 认] [注释时间 2026-11-14] */
      var block=LIVE.vpend?'上一条语音还在处理':(LIVE.busy?'他还在回上一条':'');
      var pm={id:uuid(),role:'user',content:'[语音消息 '+sec+'秒 #'+uuid().slice(0,8)+'] ',time:new Date().toISOString(),_vp:{st:block?'err':'wait',why:block,src:URL.createObjectURL(blob),sec:sec,b64:'',blob:blob,res:null}};
      if(!LIVE.vpend) LIVE.vpend=pm;
      LIVE.raw.push(pm); rbForce=true; rebuild(); buzz(8);
      vqPut({id:pm.id,sid:LIVE.sid,blob:blob,sec:sec,ts:Date.now()});
      if(block){ toast(block+'，回完点重试'); return; }
      wav16(blob).then(function(b64){ pm._vp.b64=b64; return vSend(pm); },function(){ pm._vp.st='err'; pm._vp.why='这段音频转不了'; rebuild(); toast('这段音频转不了，点重试再来'); });
      return; }
    /* [位置:phone-talk.js·recDone 转文字] [识别收尾：麦克风「识别中」防连点，文字回来追加进输入框走 fitTa 自适应] [10-27 改：原来手动 height=min(120,scrollHeight)，绕过了 fitTa——极简的 mn2 多行态、160 上限、overflow 接管全没生效，长转写在输入框里不能正常换行长高；现在 dispatch input 后调 fitTa] [注释时间 2026-10-27] */
    if(r.mic) r.mic.classList.add('asr-busy');
    toast('在认…');
    var asrEnd=function(){ if(r.mic) r.mic.classList.remove('asr-busy'); };
    wav16(blob).then(function(b64){
      return P.net.post('/heartbeat/admin/asr',{audio:b64},{noLogin:true,timeout:60000}).then(function(j){
        asrEnd();
        var t=String((j&&j.text)||'').trim();
        if(!t){ toast('没听清，再说一次'); return; }
        ta.value=(ta.value?ta.value.replace(/\s+$/,'')+' ':'')+t;
        ta.dispatchEvent(new Event('input')); fitTa(false); buzz(10);
      },function(x){ asrEnd(); toast('没认出来：'+((x&&x.message)||'看看语音识别的 Key 配了没')); });
    },function(){ asrEnd(); toast('这段音频转不了'); });
    }
    if(r.mr&&r.mr.state!=='inactive'){ var gone=false, go=function(){ if(gone) return; gone=true; fin(); }; r.mr.onstop=function(){ setTimeout(go,30); }; setTimeout(go,1500); try{ r.mr.stop(); }catch(e){ go(); } } else fin();
  }
  function wav16(blob){
    var AC=window.AudioContext||window.webkitAudioContext, OC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!AC||!OC) return Promise.reject(new Error('no audio api'));
    return blob.arrayBuffer().then(function(ab){
      var ac=new AC();
      /* [位置:phone-talk.js·wav16] [decode 失败也要关 AudioContext] [2026-10-27 审查 P2：原来只有转码成功路径
      才 close；decodeAudioData 对坏音频 reject 时 ac 悬空——iOS 同时只给少量 AudioContext，语音里混进几条坏
      音频后波形转码就整体罢工。补失败分支关闭后再抛] [注释时间 2026-10-27] */
      return ac.decodeAudioData(ab).then(function(buf){
        var n=Math.max(1,Math.round(buf.duration*16000)), off=new OC(1,n,16000);
        var src=off.createBufferSource(); src.buffer=buf; src.connect(off.destination); src.start();
        return off.startRendering().then(function(out){
          try{ ac.close(); }catch(e){}
          var pcm=out.getChannelData(0), len=pcm.length, ab2=new ArrayBuffer(44+len*2), v=new DataView(ab2);
          function ws(o,s){ for(var i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); }
          ws(0,'RIFF'); v.setUint32(4,36+len*2,true); ws(8,'WAVE'); ws(12,'fmt ');
          v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
          v.setUint32(24,16000,true); v.setUint32(28,32000,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
          ws(36,'data'); v.setUint32(40,len*2,true);
          for(var i=0;i<len;i++){ var x=Math.max(-1,Math.min(1,pcm[i])); v.setInt16(44+i*2,x<0?x*0x8000:x*0x7fff,true); }
          var u8=new Uint8Array(ab2), s='';
          for(var j=0;j<u8.length;j+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(j,j+0x8000));
          return btoa(s);
        });
      },function(e){ try{ ac.close(); }catch(_e){} throw e; });
    });
  }
  win.addEventListener('pointerup',function(){ if(RC&&!RC.clickStop) recDone(); });   /* 松开即停只属于长按；点击式（极简麦克风）松手不停，再点一下或点浮层才停 */

  /* ---------- 「+」 ---------- */
  /* [位置:phone-talk.js·plusOpen] [加号面板：精准高度动画 + 全面自动收起] [10-26：原 max-height 动画两头有死区；现在开=量实际 scrollHeight 过渡 height（动画完放开为 auto，键盘/安全区变化不裁内容），收=先钉住当前高度再归零（auto 也能平滑收）；加号按钮转 45° 变 ✕；关闭时若停在表情面板，顺手还原默认菜单。10-26 下午补：scroll 收起带 500ms 出生守卫——展开会挤压消息区触发被动 scroll，无守卫面板刚开就被自己挤收（用户实测「弹一下就收」）] [注释时间 2026-10-26] */
  var _plusSettle=0,_plusBorn=0;   /* _plusBorn=面板打开时刻：展开会挤压消息区触发被动 scroll，500ms 守卫内不收（防自触，见 scroll 监听处注释） */
  function plusOpen(on){
    var pl=$('#tkPlus',win); if(!pl) return;
    var isOpen=host.classList.contains('plus-on');
    if(on===isOpen){
      if(on){ pl.style.height=pl.scrollHeight+'px'; clearTimeout(_plusSettle); _plusSettle=setTimeout(function(){ if(host.classList.contains('plus-on')) pl.style.height='auto'; },360); }
      return;
    }
    if(on){
      host.classList.add('plus-on');            /* padding 即时生效（藏在 height:0 里，无跳动） */
      _plusBorn=Date.now();                     /* 展开挤压消息区 → 被动 scroll 不收（500ms 守卫） */
      void pl.offsetHeight;                     /* 强制回流，让 scrollHeight 带上新 padding */
      pl.style.height=pl.scrollHeight+'px';
      clearTimeout(_plusSettle);
      _plusSettle=setTimeout(function(){ if(host.classList.contains('plus-on')) pl.style.height='auto'; },360);
    }else{
      _plusBorn=0;                              /* 已收：scroll 守卫解除 */
      pl.style.height=pl.offsetHeight+'px';     /* 从 auto 收：先钉住当前实际高度 */
      void pl.offsetHeight;
      pl.style.height='0px';
      host.classList.remove('plus-on');
      if(pl.classList.contains('stk')) setTimeout(resetPlus,340);
    }
  }
  $('#tkPlusBtn',win).addEventListener('click',function(){ plusOpen(!host.classList.contains('plus-on')); buzz(6); });
  /* [位置:phone-talk.js·加号不吃焦点] [多行态加号在输入框里面，别让它把框点亮] [2026-11-06 深夜：多行时加号搬进了 field，点它会让 field 命中 :focus-within，整条输入框从 .62 亮到 .78 闪一下（实测确实触发）。在 focus 当下就 blur：这一帧还没绘制，所以完全不闪；而且输入框本来就因为这次点击失焦、键盘照常收起，行为不变] [注释时间 2026-11-06] */
  $('#tkPlusBtn',win).addEventListener('focus',function(){ if(this.parentElement&&this.parentElement.classList.contains('field')) this.blur(); });
  /* [位置:phone-talk.js·plus自动收起] [10-26：面板不再赖着——点它和加号以外的任何地方、输入框聚焦（键盘要来了）、点发送、滚动消息区、键盘弹出（visualViewport 变矮），全都自动收] [注释时间 2026-10-26] */
  /* [位置:phone-talk.js·plus自动收起 docPd] [关页自卸] [原匿名监听挂 document 上卸不掉，聊天页每开一次多挂一个；改具名函数 + isConnected 自卸，关页即清] [注释时间 2026-10-26] */
  function docPd(e){
    if(!win.isConnected){ document.removeEventListener('pointerdown',docPd,true); return; }
    if(!host.classList.contains('plus-on')) return;
    if(e.target.closest&&e.target.closest('#tkPlus,#tkPlusBtn,.ses-pop.qkm')) return;   /* 快捷指令的编辑弹窗在面板外，点它不算点别处（11-09：编辑完面板要还在） */
    plusOpen(false);
  }
  document.addEventListener('pointerdown',docPd,true);
  $('#tkTa',win).addEventListener('focus',function(){ plusOpen(false); });
  $('#tkSend',win).addEventListener('click',function(){ plusOpen(false); });
  $('#tkMsgs',win).addEventListener('touchstart',function(){ if(host.classList.contains('plus-on')) plusOpen(false); },{passive:true});
  /* scroll 收起带出生守卫：聊天页消息区恒在底部，面板展开挤压它 → 浏览器被动回调 scrollTop 触发 scroll ——
     不加守卫面板刚开就被自己的展开挤收（10-26实测「弹一下就收」）；守卫只盖 .32s 动画+缓冲，之后真滚动照常收 */
  /* [位置:phone-talk.js·plus 收起不再听 scroll] [表情包面板点开就收 / 宽屏加号面板自己收] [10-28：scroll 事件分不出「用户滑」还是「面板展开把消息区挤矮、消息区跟着贴底」——表情包面板比加号面板高，点「表情包」时又一次挤压，已经过了 500ms 守卫，被动 scroll 把面板自己收了（飞快弹一下就没）；宽屏上贴底回调更晚，加号面板也会被收。用户真要滑消息区：触摸有 touchstart、鼠标/触控板有 wheel、点别处有 docPd，都已覆盖，所以不再听 scroll] [注释时间 2026-10-28] */
  $('#tkMsgs',win).addEventListener('wheel',function(){ if(host.classList.contains('plus-on')) plusOpen(false); },{passive:true});
  if(window.visualViewport) window.visualViewport.addEventListener('resize',function(){ if(host.classList.contains('plus-on')&&window.visualViewport.height<window.innerHeight&&!host.querySelector('.ses-pop.qkm')) plusOpen(false); });   /* 编辑弹窗里弹键盘不收面板 */
  $('#tkPlus',win).addEventListener('click',function(e){ var b=e.target.closest('[data-p]'); if(!b) return; var k=b.getAttribute('data-p'); buzz(8);
    if(k==='voice'){ holdMode(true,'send'); return; }
    if(k==='stk'){ KATAB=(KATAB==='wb'||KATAB==='touch'?'stk':KATAB); stkPanel(); return; }
    if(k==='touch'){ KATAB='touch'; stkPanel(); return; }
    if(k==='wb'){ if(LIVE.on){ KATAB='wb'; stkPanel(); } else toast('没连上后台'); return; }
    if(k==='mcp'){ if(LIVE.on) mcpSheet(); else toast('没连上后台'); return; }
    if(LIVE.on&&(k==='att'||k==='photo'||k==='cam'||k==='file')){ plusOpen(false); attPick(k); return; }
    toast(LIVE.on?({phone:'电话页还没接到聊天里'}[k]||'还没接'):'没连上后台'); });

  /* ---------- 表情包：面板从「+」的位置换上来；点一个就发（她发的和他发的一样，都是消息里的 <sticker id="编号"/>，聊天里换成图）----------
     [位置:phone-talk.js·stkPanel] [10-24：表情包是她上传的那一套（workspace/stickers/，清单 stickers/index.json，id + 描述；他靠永久上下文里的清单认编号）；面板按清单排，点一个发出去，发完面板不收，可以连点；原来的演示数据（收藏 / 他的 / 最近 三个标签、假图）已去掉]
     [11-02：输入框有字时点表情=文字+表情合成一条消息发出，发完清输入框并收面板；没字照旧单发可连点；头部「完成」键换成退格键（bksp1：单击删一个字符、长按连删）——面板收起走 + 键或点面板外] [注释时间 2026-11-02] */
  var STKL=null, KAOM=null, KATAB='stk', STKBUZY=false;   /* STKBUZY=表情上传识图中（＋格转圈防连点，见 stkUpload） */
  /* [位置:phone-talk.js·stkPanel] [表情面板加「颜文字」标签页] [11-01：两个标签切换；颜文字点=填进输入框不发送（她自己再发）；
     长按单条=移到最前/编辑/删除（删除带确认）；尾部虚线格=新增。清单存服务器 data/kaomoji.json（routes/kaomoji.js），
     没自定义过时后端返回内置默认清单——个性化数据照 10-27 会话头像的教训不存 localStorage，换设备/清缓存不丢] [注释时间 2026-11-01] */
  function stkPanel(){
    var pl=$('#tkPlus',win); pl.classList.add('stk');
    /* [位置:phone-talk.js·stkPanel hdHTML/bodyHTML] [头部与内容分开拼] [11-02：分段控件退回两个独立药丸标签（连着的不好看，就之前的样子，文字要居中）——切标签恢复整块重画，就地更新的逻辑删掉；hdHTML/bodyHTML 拆分留着，paint 一处拼；11-02 晚：右侧「完成」键换成退格键（bksp1，单击删一个字符/长按连删），面板收起走 + 键或点面板外] [注释时间 2026-11-02] */
    function hdHTML(){ if(KATAB==='wb') return '<div class="tk-stkhd"><button class="on" type="button" tabindex="-1">动态注入</button><span></span><button class="qk-add tap" data-wbadd type="button">新增</button></div>'; if(KATAB==='touch') return '<div class="tk-stkhd"><button class="on" type="button" tabindex="-1">触摸面板</button><span></span><button class="qk-add tap tk-tsend'+(touchHasData()?' ready':'')+'" data-tsend type="button">发给他</button></div>'; return '<div class="tk-stkhd"><button data-t="stk" class="'+(KATAB==='stk'?'on':'')+'">表情包</button><button data-t="ka" class="'+(KATAB==='ka'?'on':'')+'">颜文字</button><button data-t="qk" class="'+(KATAB==='qk'?'on':'')+'">快捷指令</button><span></span>'+(KATAB==='qk'?'<button class="qk-add tap" data-qkadd type="button">新增</button>':'')+'<button class="bksp tap" data-del type="button" aria-label="退格删除">'+I.bksp+'</button></div>'; }
    function bodyHTML(){ if(KATAB==='touch') return touchBody(); if(KATAB==='qk') return qkBody(); if(KATAB==='wb') return wbBody(); return KATAB==='stk'
      /* [位置:phone-talk.js·stkPanel bodyHTML 表情包页] [11-08：「＋」新增格放最后（11-08 晚她定：别放最前挡着常用表情），识别中转圈；
         新表情插清单最前，加下一张时＋格顺移] [注释时间 2026-11-08] */
      ?'<div class="tk-stkg">'+(STKL&&STKL.length?STKL.map(function(s,i){ return '<button class="tap" data-s="'+i+'" aria-label="'+esc(s.desc)+'"><img src="/stickers/t/'+esc(s.id)+'.jpg" alt=""></button>'; }).join(''):'<div class="tk-stkn">'+(STKL?'还没有表情包，点＋加一张':'读取中…')+'</div>')+'<button class="tap add" data-sadd type="button" aria-label="添加表情包"><i>'+(STKBUZY?'<span class="stk-spin"></span>':'＋')+'</i></button></div>'
      :'<div class="tk-kag">'+((KAOM&&KAOM.length)?KAOM.map(function(k,i){ return '<button class="tap tk-kai" data-k="'+i+'">'+esc(k)+'</button>'; }).join(''):'<div class="tk-stkn">'+(KAOM?'还没有颜文字':'读取中…')+'</div>')+'<button class="tap tk-kai add" data-kadd type="button">＋ 新增</button></div>'; }
    function paint(){ pl.innerHTML=hdHTML()+bodyHTML(); if(KATAB==='touch') bindTouchPad(pl); }
    /* [位置:phone-talk.js·loadKa/saveKaom] [颜文字清单懒加载与保存] [第一次切到颜文字页才拉 /admin/kaomoji；任何增删改都全量回存，
       后端清洗后回显为准；没存上只提示不阻断本地操作] [注释时间 2026-11-01] */
    function loadKa(){
      if(KAOM) return;
      P.net.get('/heartbeat/admin/kaomoji').then(function(j){ KAOM=(j&&Array.isArray(j.list))?j.list:[]; if(pl.classList.contains('stk')&&KATAB==='ka') paint(); },function(){ KAOM=[]; if(pl.classList.contains('stk')&&KATAB==='ka') paint(); toast('颜文字清单没读到'); });
    }
    function saveKaom(){
      P.net.post('/heartbeat/admin/kaomoji/save',{list:KAOM}).then(function(r){ if(r&&r.ok&&Array.isArray(r.list)) KAOM=r.list; },function(){ toast('颜文字清单没存上'); });
    }
    /* [位置:phone-talk.js·insertKa] [颜文字填输入框] [11-01：插到光标处，触发 input 让输入框随内容长高；不发送、面板不收，可连点] [注释时间 2026-11-01] */
    function insertKa(t){
      var s=ta.selectionStart==null?ta.value.length:ta.selectionStart, e=ta.selectionEnd==null?s:ta.selectionEnd;
      ta.value=ta.value.slice(0,s)+t+ta.value.slice(e);
      var p=s+t.length; try{ ta.setSelectionRange(p,p); }catch(_){ }
      ta.dispatchEvent(new Event('input'));
    }
    /* [位置:phone-talk.js·bksp1] [表情面板退格键：一次删一个字符] [11-02：颜文字选进输入框后要删还得拉键盘——面板头部直接退格；
       单击删一个字符不是清空：输入框没聚焦（面板开着时一点输入框就收面板了）=删最后一个字符；聚焦且有选中=先删选中；光标在中间=删光标前一个；
       代理对（emoji/生僻字）整对删不劈半；删完触发 input 让输入框高度/发送键状态跟着走] [注释时间 2026-11-02] */
    function bksp1(){
      var v=ta.value; if(!v) return;
      var foc=(document.activeElement===ta);
      var s=foc&&ta.selectionStart!=null?ta.selectionStart:v.length, e2=foc&&ta.selectionEnd!=null?ta.selectionEnd:v.length;
      var s0=s;
      if(s0===e2){ s0--; var c=s0>=0?v.charCodeAt(s0):0; if(c>=0xDC00&&c<0xE000&&s0>0) s0--; }
      if(s0<0) return;
      ta.value=v.slice(0,s0)+v.slice(e2);
      try{ ta.setSelectionRange(s0,s0); }catch(_){ }
      ta.dispatchEvent(new Event('input'));
    }
    /* [位置:phone-talk.js·kaEdit] [颜文字新增/编辑表单] [i<0=新增（插到最前，重复提示已存在）；编辑=原位替换；回车=保存。
       11-02：保存键缩成输入框右侧小方块（全宽的太大），点了先变对勾、停 340ms 再收弹窗重画面板（保存反馈）；sent 守卫防 340ms 窗口内连点存两条] [注释时间 2026-11-02] */
    function kaEdit(i){
      sheet('<div class="hd"><span>'+(i<0?'新增颜文字':'编辑颜文字')+'</span></div><div class="opt"><div class="tk-karow"><input class="tk-kain" maxlength="64" '+(i<0?'placeholder="(^▽^)"':'value="'+esc(KAOM[i]||'')+'"')+'><button class="tk-kasv tap go" type="button">保存</button></div></div>','opts',function(box,close){
        var inp=box.querySelector('.tk-kain'), go=box.querySelector('.go'), sent=false;
        function doSave(){
          if(sent) return; sent=true;
          var v=String(inp.value||'').replace(/\s+/g,' ').trim();
          if(!v){ sent=false; toast('写点什么'); return; }
          if(i<0){ if(KAOM.indexOf(v)>=0){ sent=false; toast('已经有一个一样的了'); return; } KAOM.unshift(v); } else { KAOM[i]=v; }
          saveKaom();
          go.innerHTML=I.ok;   /* 保存反馈：按钮变对勾，停一下再收 */
          setTimeout(function(){ close(); if(pl.classList.contains('stk')&&KATAB==='ka') paint(); },340);
        }
        go.addEventListener('click',doSave);
        inp.addEventListener('keydown',function(ev){ if(ev.key==='Enter'&&!ev.isComposing){ ev.preventDefault(); doSave(); } });
        setTimeout(function(){ try{ inp.focus(); }catch(_){ } },260);
      });
    }
    /* [位置:phone-talk.js·kaMenu] [颜文字长按菜单] [长按单条=移到最前/编辑/删除；删除要走确认；改完立即保存并重画面板。
       11-01 样式返工：原来走 sheet('opts') 弹三个实心药丸，跟全 app 不搭；改成跟消息长按菜单同款磨砂玻璃小菜单（tk-ov + tk-menu.col，图标行，删除红色），贴着被长按的格子出——先放格子下面，放不下放上面，都放不下放面板中间（同 bubMenu 的落点算法）] [注释时间 2026-11-01] */
    function kaMenu(i,cell){
      if(!KAOM||!KAOM[i]||!cell) return;
      var hr=host.getBoundingClientRect(), r=cell.getBoundingClientRect();
      var ov=document.createElement('div'); ov.className='tk-ov';
      ov.innerHTML='<div class="scrim"></div><div class="tk-menu col" style="visibility:hidden;top:0;left:'+Math.max(12,Math.min(r.left-hr.left,hr.width-188))+'px">'
        +'<button data-m="top" type="button">'+I.uptop+'<span>移到最前</span></button>'
        +'<button data-m="edit" type="button">'+I.pen+'<span>编辑</span></button>'
        +'<button data-m="del" type="button" class="red">'+I.trash+'<span>删除</span></button></div>';
      host.appendChild(ov);
      var mn=ov.querySelector('.tk-menu'), mh=mn.offsetHeight;
      var topSafe=(parseFloat(getComputedStyle(host).getPropertyValue('--sat'))||0)+70, botSafe=hr.height-84;
      var below=r.bottom-hr.top+10, above=r.top-hr.top-10-mh, y;
      if(below+mh<=botSafe) y=below; else if(above>=topSafe) y=above; else y=Math.max(topSafe,Math.min(botSafe-mh,(topSafe+botSafe-mh)/2));
      mn.style.top=Math.round(y)+'px'; mn.style.visibility='';
      requestAnimationFrame(function(){ ov.classList.add('show'); });
      function close(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); },220); }
      ov.querySelector('.scrim').addEventListener('click',close);
      mn.addEventListener('click',function(ev){
        var b=ev.target.closest('[data-m]'); if(!b) return; close();
        if(b.getAttribute('data-m')==='top'){ var k=KAOM.splice(i,1)[0]; KAOM.unshift(k); saveKaom(); if(pl.classList.contains('stk')&&KATAB==='ka') paint(); }
        else if(b.getAttribute('data-m')==='edit'){ kaEdit(i); }
        else {
          sheet('<div class="hd"><span>删掉这个颜文字？</span></div><p class="tk-cfp">'+esc(KAOM[i])+'</p><div class="cf-b tk-cfb"><button class="tap" data-no type="button">算了</button><button class="tap go danger" data-yes type="button">删除</button></div>','cf',function(b2,c2){
            b2.addEventListener('click',function(e2){ var d=e2.target.closest('[data-yes],[data-no]'); if(!d) return; c2();
              if(d.hasAttribute('data-yes')){ KAOM.splice(i,1); saveKaom(); if(pl.classList.contains('stk')&&KATAB==='ka') paint(); } });
          });
        }
      });
    }
    /* [位置:phone-talk.js·stkMenu] [表情包长按菜单] [11-08：长按单张=移到最前/改描述/删除，与 kaMenu 同款磨砂菜单和落点算法；
       删除带确认，只从清单移除、图片文件保留（聊天历史走 /stickers/t/ 直拼照常显示）；改完立即 saveStk 落盘] [注释时间 2026-11-08] */
    function stkMenu(i,cell){
      if(!STKL||!STKL[i]||!cell) return;
      var hr=host.getBoundingClientRect(), r=cell.getBoundingClientRect();
      var ov=document.createElement('div'); ov.className='tk-ov';
      ov.innerHTML='<div class="scrim"></div><div class="tk-menu col" style="visibility:hidden;top:0;left:'+Math.max(12,Math.min(r.left-hr.left,hr.width-188))+'px">'
        +'<button data-m="top" type="button">'+I.uptop+'<span>移到最前</span></button>'
        +'<button data-m="edit" type="button">'+I.pen+'<span>改描述</span></button>'
        +'<button data-m="del" type="button" class="red">'+I.trash+'<span>删除</span></button></div>';
      host.appendChild(ov);
      var mn=ov.querySelector('.tk-menu'), mh=mn.offsetHeight;
      var topSafe=(parseFloat(getComputedStyle(host).getPropertyValue('--sat'))||0)+70, botSafe=hr.height-84;
      var below=r.bottom-hr.top+10, above=r.top-hr.top-10-mh, y;
      if(below+mh<=botSafe) y=below; else if(above>=topSafe) y=above; else y=Math.max(topSafe,Math.min(botSafe-mh,(topSafe+botSafe-mh)/2));
      mn.style.top=Math.round(y)+'px'; mn.style.visibility='';
      requestAnimationFrame(function(){ ov.classList.add('show'); });
      function close(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); },220); }
      ov.querySelector('.scrim').addEventListener('click',close);
      mn.addEventListener('click',function(ev){
        var b=ev.target.closest('[data-m]'); if(!b) return; close();
        if(b.getAttribute('data-m')==='top'){ var k=STKL.splice(i,1)[0]; STKL.unshift(k); saveStk(); if(pl.classList.contains('stk')) paint(); }
        else if(b.getAttribute('data-m')==='edit'){ stkEdit(i); }
        else {
          sheet('<div class="hd"><span>删掉这个表情包？</span></div><p class="tk-cfp">'+esc(STKL[i].desc||STKL[i].id)+'</p><div class="cf-b tk-cfb"><button class="tap" data-no type="button">算了</button><button class="tap go danger" data-yes type="button">删除</button></div>','cf',function(b2,c2){
            b2.addEventListener('click',function(e2){ var d=e2.target.closest('[data-yes],[data-no]'); if(!d) return; c2();
              if(d.hasAttribute('data-yes')){ STKL.splice(i,1); saveStk(); if(pl.classList.contains('stk')) paint(); } });
          });
        }
      });
    }
    /* [位置:phone-talk.js·stkEdit] [表情描述编辑] [11-08：desc 是 AI 认画面的说明（清单里给 AI 看的），
       id 不给改（id 连着文件名/URL/AI 编号，一改全断）；允许存空（识图失败兜底或她不想写）；样式同 kaEdit] [注释时间 2026-11-08] */
    function stkEdit(i){
      sheet('<div class="hd"><span>表情描述</span></div><div class="opt"><div class="tk-karow"><input class="tk-kain" maxlength="60" value="'+esc(STKL[i].desc||'')+'" placeholder="这张画的是什么，AI 靠这个认它"><button class="tk-kasv tap go" type="button">保存</button></div></div>','opts',function(box,close){
        var inp=box.querySelector('.tk-kain'), go=box.querySelector('.go'), sent=false;
        function doSave(){
          if(sent) return; sent=true;
          STKL[i].desc=String(inp.value||'').replace(/\s+/g,' ').trim().slice(0,60);
          saveStk();
          go.innerHTML=I.ok;
          setTimeout(function(){ close(); if(pl.classList.contains('stk')&&KATAB==='stk') paint(); },340);
        }
        go.addEventListener('click',doSave);
        inp.addEventListener('keydown',function(ev){ if(ev.key==='Enter'&&!ev.isComposing){ ev.preventDefault(); doSave(); } });
        setTimeout(function(){ try{ inp.focus(); }catch(_){ } },260);
      });
    }
    /* [位置:phone-talk.js·saveStk] [表情包清单全量回存] [长按三操作共用；后端清洗回显为准；没存上只提示不阻断本地（同 saveKaom）] [注释时间 2026-11-08] */
    function saveStk(){
      P.net.post('/heartbeat/admin/stickers/save',{list:STKL}).then(function(r){ if(r&&r.ok&&Array.isArray(r.list)) STKL=r.list; },function(){ toast('表情包清单没存上'); });
    }
    /* [位置:phone-talk.js·stkAdd] [表情包新增入口] [11-08：＋格=选图；GIF 不进裁剪、取第一帧整张 cover 转 160 静图
       （AI 看不懂动图、全链路统一 jpg，收的时候提示一句）；静图进微信式裁剪器 openStickerCropper，裁完上传；
       input 先挂 body 再 click、5 分钟兜底清理（attPick 同款 iOS 教训）] [注释时间 2026-11-08] */
    function stkAdd(){
      if(STKBUZY){ toast('上一张还在识别中'); return; }
      if(!window.openStickerCropper){ toast('裁剪组件没加载上，刷新一下页面'); return; }
      var f=document.createElement('input'); f.type='file'; f.accept='image/*';
      document.body.appendChild(f); f.style.display='none';
      f.onchange=function(){
        var fl=f.files&&f.files[0]; f.remove(); if(!fl) return;
        var rd=new FileReader();
        rd.onload=function(){
          if(/^image\/gif/i.test(fl.type||'')){
            var im=new Image();
            im.onload=function(){
              var c=document.createElement('canvas'); c.width=160; c.height=160;
              var k=Math.max(160/im.width,160/im.height), sw=160/k, sh=160/k;
              c.getContext('2d').drawImage(im,(im.width-sw)/2,(im.height-sh)/2,sw,sh,0,0,160,160);
              toast('动图按第一帧收进');
              stkUpload(c.toDataURL('image/jpeg',.85));
            };
            im.onerror=function(){ toast('这张图读不出来'); };
            im.src=rd.result;
            return;
          }
          openStickerCropper(rd.result).then(function(out){ if(out) stkUpload(out); });
        };
        rd.readAsDataURL(fl);
      };
      setTimeout(function(){ try{ f.remove(); }catch(_){ } },300000);
      f.click();
    }
    /* [位置:phone-talk.js·stkUpload] [上传+识图] [上传后后台自动生成 id/描述/tags（跟「图片转写」同款模型，产品确定）；
       ＋格转圈做识别中反馈并防连点；成功插到面板最前并报生成的 id；失败=文件清单都不动，toast 让她重试（产品确定）] [注释时间 2026-11-08] */
    function stkUpload(dataURL){
      STKBUZY=true; if(pl.classList.contains('stk')) paint();
      toast('识别中，稍等一下');
      P.net.post('/heartbeat/admin/stickers/upload',{data:dataURL}).then(function(r){
        STKBUZY=false;
        if(r&&r.ok&&r.item&&r.item.id){ if(STKL) STKL.unshift(r.item); if(pl.classList.contains('stk')) paint(); buzz(8); toast('加好了：'+r.item.id); }
        else { if(pl.classList.contains('stk')) paint(); toast(String((r&&r.error)||'没加上，再试一次').slice(0,60)); buzz([20,30,20]); }
      },function(e){
        STKBUZY=false; if(pl.classList.contains('stk')) paint();
        toast('没加上：'+String(e&&e.message||'').replace(/^HTTP /,'').slice(0,50)); buzz([20,30,20]);
      });
    }
    paint(); plusOpen(true);
    if(!STKL) fetch('/stickers/index.json').then(function(r){ return r.json(); }).then(function(j){ STKL=Array.isArray(j)?j:[]; if(pl.classList.contains('stk')) paint(); },function(){ STKL=[]; if(pl.classList.contains('stk')) paint(); toast('表情包没读到'); });
    if(KATAB==='ka') loadKa();
    if(KATAB==='qk') qkSync(function(){ if(pl.classList.contains('stk')&&KATAB==='qk') paint(); });
    if(KATAB==='wb') wbSync(function(){ if(pl.classList.contains('stk')&&KATAB==='wb') paint(); });
    /* 长按颜文字/表情包出菜单：480ms 计时；触发过把紧跟着的 click 吞掉（不插入/不发送）。监听只挂一次（pl._kaLp），stkPanel 反复开关不叠加。
       [11-08：表情包格（data-s）并入同一长按入口，出 stkMenu；＋格（data-sadd）不参与长按] [注释时间 2026-11-08] */
    if(!pl._kaLp){
      pl._kaLp=true;
      pl.addEventListener('pointerdown',function(e){ var b=e.target.closest('[data-k],[data-s]'); if(!b||e.target.closest('[data-sadd]')) return;
        pl._lpFired=false; clearTimeout(pl._lpT);
        var ka=b.hasAttribute('data-k'), i=+b.getAttribute(ka?'data-k':'data-s');
        pl._lpT=setTimeout(function(){ pl._lpFired=true; buzz([10,30,10]); if(ka) kaMenu(i,b); else stkMenu(i,b); },480); });
      ['pointerup','pointercancel','pointerleave'].forEach(function(ev){ pl.addEventListener(ev,function(){ clearTimeout(pl._lpT); }); });
    }
    /* [位置:phone-talk.js·stkPanel 退格长按连删] [11-02：按住 420ms 后每 80ms 删一个（跟键盘退格手感）；
       指针捕获在键上，手指滑出面板松手也能收到 pointerup 停连删；interval 里查面板存活兜底自停；监听只挂一次（pl._delLp）] [注释时间 2026-11-02] */
    if(!pl._delLp){
      pl._delLp=true;
      pl.addEventListener('pointerdown',function(e){ var b=e.target.closest('[data-del]'); if(!b) return;
        pl._delHeld=false; clearTimeout(pl._delT); clearInterval(pl._delIv);
        try{ b.setPointerCapture(e.pointerId); }catch(_){ }
        pl._delT=setTimeout(function(){ pl._delHeld=true; pl._delIv=setInterval(function(){ if(!pl.isConnected||!pl.classList.contains('stk')){ clearInterval(pl._delIv); return; } bksp1(); buzz(4); },80); },420); });
      ['pointerup','pointercancel'].forEach(function(ev){ pl.addEventListener(ev,function(){ clearTimeout(pl._delT); clearInterval(pl._delIv); }); });
    }
    pl.onclick=function(e){
      if(pl._lpFired){ pl._lpFired=false; return; }
      if(KATAB==='touch'){
        var tz=e.target.closest('[data-tz]'); if(tz){ touchSwitchZone(tz.getAttribute('data-tz')); buzz(5); paint(); return; }
        if(e.target.closest('[data-tclr]')){ touchClear(); buzz(5); paint(); return; }
        if(e.target.closest('[data-tsend]')){ touchSend(paint); return; }
      }
      if(KATAB==='qk'){
        if(e.target.closest('[data-qkadd]')){ buzz(6); quickEdit(-1,function(){ if(KATAB==='qk') paint(); }); return; }
        var qe=e.target.closest('[data-qke]'); if(qe){ buzz(6); quickEdit(+qe.getAttribute('data-qke'),function(){ if(KATAB==='qk') paint(); }); return; }
        var qr=e.target.closest('[data-qki]'); if(qr){ var qc=qkRead()[+qr.getAttribute('data-qki')]; if(qc){ buzz(8); qkFill(qc.t); } return; }
      }
      if(KATAB==='wb'){
        if(e.target.closest('[data-wbadd]')){ buzz(6); wbEdit(-1,function(){ if(KATAB==='wb') paint(); }); return; }
        var wt=e.target.closest('[data-wbt]'); if(wt){ buzz(6); wbToggle(+wt.getAttribute('data-wbt'),function(){ if(KATAB==='wb') paint(); }); return; }
        var we=e.target.closest('[data-wbe]'); if(we){ buzz(6); wbEdit(+we.getAttribute('data-wbe'),function(){ if(KATAB==='wb') paint(); }); return; }
        var wr=e.target.closest('[data-wbi]'); if(wr){ buzz(6); wbEdit(+wr.getAttribute('data-wbi'),function(){ if(KATAB==='wb') paint(); }); return; }
      }
      var t=e.target.closest('[data-t]');
      if(t){ KATAB=t.getAttribute('data-t'); buzz(6); if(KATAB==='ka') loadKa(); if(KATAB==='qk') qkSync(function(){ if(pl.classList.contains('stk')&&KATAB==='qk') paint(); }); paint(); return; }
      var b=e.target.closest('[data-s]');
      /* [位置:phone-talk.js·stkPanel ＋新增格 click] [11-08：点＋走 stkAdd（选图→裁剪→上传识图）；
         要放在 data-s 判断前面，互不干扰] [注释时间 2026-11-08] */
      if(e.target.closest('[data-sadd]')){ stkAdd(); return; }
      /* [位置:phone-talk.js·stkPanel 点表情合发] [11-02：输入框有字=文字与表情合成一条消息（<sticker> 标签接在文字后；fromRaw 渲染端本来就把 user 消息里的标签拆成文字气泡+表情图，后端与 AI 看到的也是同一条原文）；发完清输入框并收起面板；没字照旧只发表情、面板不收可连点；AI 正在回时 liveSend 返回 false，输入框与面板都不动] [注释时间 2026-11-02] */
      if(b){ if(!LIVE.on){ toast('先从一个会话进来'); return; } var sk=STKL&&STKL[+b.getAttribute('data-s')]; if(!sk) return;
        var tx=(ta.value||'').replace(/\s+$/,'');
        if(liveSend(tx.trim()?tx+'\n<sticker id="'+sk.id+'"/>':'<sticker id="'+sk.id+'"/>')){ buzz(8);
          if(tx.trim()){ ta.value=''; ta.dispatchEvent(new Event('input')); plusOpen(false); } }
        return; }
      var k=e.target.closest('[data-k]');
      if(k){ var kk=KAOM&&KAOM[+k.getAttribute('data-k')]; if(!kk) return; insertKa(kk); buzz(6); return; }
      if(e.target.closest('[data-kadd]')){ kaEdit(-1); return; }
      if(e.target.closest('[data-del]')){ if(pl._delHeld){ pl._delHeld=false; } else { bksp1(); buzz(6); } return; }   /* [位置:phone-talk.js·stkPanel 退格键 click] [11-02：单击删一个字；长按连删过（_delHeld）把这次 click 吞掉不重复删] [注释时间 2026-11-02] */
    };
  }

  var PLUS0=$('#tkPlus',win).innerHTML;
  function resetPlus(){ var pl=$('#tkPlus',win); pl.classList.remove('stk'); pl.innerHTML=PLUS0; pl.onclick=null; }
  /* [位置:phone-talk.js·touchPanel] [加号面板「触摸面板」：捏捏软弹材质交互 + 逐笔拆分同部位异手势与多部位分段记录，发送时合发输入框已有文字/引用/附件] [2026-11-23 升级：逐笔先判手势（轻点/轻拍/轻捏/长按捏/揉捏/揉搓/顺摸/轻抚）再只合并相邻同部位同类动作，避免同部位先点再揉互相吞并；正文与摘要展示更详细，发送时完整合发输入框文字、引用与附件] [注释时间 2026-11-23] */
  var TZONES=['头顶','脸颊','手心','后背','随意'];
  var TSTATE={zone:'头顶',segments:[],strokes:[]};
  function touchHasData(){ return TSTATE.segments.length>0||TSTATE.strokes.length>0; }
  function touchClear(){ TSTATE.segments=[]; TSTATE.strokes=[]; }
  function touchSwitchZone(nextZone){
    if(!nextZone||nextZone===TSTATE.zone) return;
    if(TSTATE.strokes.length){
      var last=TSTATE.segments[TSTATE.segments.length-1];
      if(last&&last.zone===TSTATE.zone){ last.strokes=last.strokes.concat(TSTATE.strokes); }
      else { TSTATE.segments.push({zone:TSTATE.zone,strokes:TSTATE.strokes.slice()}); }
      TSTATE.strokes=[];
    }
    TSTATE.zone=nextZone;
  }
  function touchClassifyStroke(s){
    var d=Math.max(60,s.t1-s.t0), sec=d/1000, dist=s.dist||0, turns=s.turns||0, dx=s.dx||0, dy=s.dy||0;
    var spd=dist/(sec||0.1), speed=spd<85?'轻慢':(spd>230?'急促':'柔和');
    var kind, gest, dir;
    if(dist<16){
      dir='原地';
      if(d>=900){ kind='hold'; gest='长按捏'; }
      else if(d>=420){ kind='pinch'; gest='轻捏'; }
      else { kind='tap'; gest='轻点'; }
    } else if(dist<90&&(d>=360||turns>=1)){
      dir=turns>=2?'画圈':'原地';
      if(turns>=2){ kind='knead'; gest='揉捏'; }
      else { kind='pinch'; gest='轻捏'; }
    } else {
      dir=turns>=2?'画圈':(Math.abs(dx)>Math.abs(dy)?(dx>0?'向右':'向左'):(dy>0?'向下':'向上'));
      if(turns>=2){ kind=spd>210?'rub':'knead'; gest=spd>210?'揉搓':'揉捏'; }
      else if(Math.abs(dy)>Math.abs(dx)*1.3){ kind='stroke_v'; gest='顺摸'; }
      else { kind='stroke_h'; gest='轻抚'; }
    }
    return {kind:kind,gest:gest,dir:dir,speed:speed,durMs:d,dist:dist,turns:turns};
  }
  function touchAnalyzeSegment(zone,L){
    if(!L||!L.length) return null;
    /* 逐笔直接输出「动作+时间」（<0.5秒的短动作如轻点/轻拍不写时间）；仅连续轻点合并成「轻拍N下」 */
    var groups=[];
    L.forEach(function(s){
      var c=touchClassifyStroke(s);
      var prev=groups[groups.length-1];
      if(c.kind==='tap'&&prev&&prev.kind==='tap'){
        prev.count++; prev.durMs+=c.durMs;
      } else {
        groups.push({kind:c.kind,gest:c.gest,dir:c.dir,speed:c.speed,durMs:c.durMs,dist:c.dist,turns:c.turns,count:1});
      }
    });
    var totMs=0, totCnt=0, acts=[];
    groups.forEach(function(g){
      totMs+=g.durMs; totCnt+=g.count;
      var sec=(g.durMs/1000).toFixed(1), showSec=g.durMs>=500;
      var gest=(g.kind==='tap'&&g.count>=2)?'轻拍':g.gest;
      var dirTag=(g.dir&&g.dir!=='原地')?g.dir:'';
      var label;
      if(g.kind==='tap'){
        label=g.count>=2?('轻拍'+g.count+'下'):'轻点';
      } else if(g.kind==='hold'||g.kind==='pinch'){
        label=gest+(showSec?(sec+'秒'):'');
      } else {
        label=g.speed+dirTag+gest+(showSec?(sec+'秒'):'');
      }
      acts.push({kind:g.kind,gesture:gest,dir:g.dir,speed:g.speed,durMs:g.durMs,duration:sec+'s',count:g.count,label:label});
    });
    var segSec=(totMs/1000).toFixed(1);
    var joined=acts.map(function(a){ return a.label; }).join('、');
    var shortDesc=zone+'·'+joined;
    var fullDesc='在「'+zone+'」'+joined;
    return {
      zone:zone,
      gesture:acts.map(function(a){ return a.gesture; }).join('+'),
      durMs:totMs,
      duration:segSec+'s',
      speed:acts[acts.length-1].speed,
      count:totCnt,
      dir:acts.map(function(a){ return a.dir; }).join('+'),
      shortDesc:shortDesc,
      fullDesc:fullDesc,
      acts:acts
    };
  }
  function touchSummarize(){
    var segs=TSTATE.segments.map(function(g){ return {zone:g.zone,strokes:g.strokes.slice()}; });
    if(TSTATE.strokes.length){
      var last=segs[segs.length-1];
      if(last&&last.zone===TSTATE.zone){ last.strokes=last.strokes.concat(TSTATE.strokes); }
      else { segs.push({zone:TSTATE.zone,strokes:TSTATE.strokes.slice()}); }
    }
    var items=segs.map(function(g){ return touchAnalyzeSegment(g.zone,g.strokes); }).filter(Boolean);
    if(!items.length) return null;
    if(items.length===1){
      var one=items[0];
      return {zone:one.zone,gesture:one.gesture,duration:one.duration,speed:one.speed,count:one.count,dir:one.dir,steps:one.shortDesc,summary:one.shortDesc,text:one.fullDesc,items:items};
    }
    var totMs=0, totCnt=0, zones=[], gests=[], dirs=[], shorts=[], fulls=[];
    items.forEach(function(it){ totMs+=it.durMs; totCnt+=it.count; zones.push(it.zone); gests.push(it.gesture); dirs.push(it.dir); shorts.push(it.shortDesc); fulls.push(it.fullDesc); });
    var totSec=(totMs/1000).toFixed(1), summary=shorts.join(' → '), fullText=fulls.join(' → ');
    return {
      zone:zones.join('→'),
      gesture:gests.join('→'),
      duration:totSec+'s',
      speed:items[items.length-1].speed,
      count:totCnt,
      dir:dirs.join('→'),
      steps:shorts.join(' ; '),
      summary:summary,
      text:fullText,
      items:items
    };
  }
  function touchBody(){
    var s=touchSummarize();
    return '<div class="tk-tp">'+
      '<div class="tk-tzones">'+TZONES.map(function(z){ return '<button class="tk-tz tap'+(TSTATE.zone===z?' on':'')+'" data-tz="'+esc(z)+'" type="button">'+esc(z)+'</button>'; }).join('')+'</div>'+
      '<div class="tk-tpad'+(TSTATE.strokes.length?' has':'')+'" data-tpad><canvas></canvas><div class="tk-thint"><b>轻点、长按捏住或揉捏这里</b><small>切换部位可分段记录，松手后点右上角「发给他」</small></div></div>'+
      '<div class="tk-tfoot"><div class="tk-tsum" data-tsum>'+(s?esc(s.summary):'选择部位后在软垫上捏一捏或轻抚')+'</div><button class="tk-tclr tap'+(s?' show':'')+'" data-tclr type="button">清空</button></div>'+
    '</div>';
  }
  function touchReadRgb(el,prop,fb){
    try{
      var cs=getComputedStyle(el), v=(cs.getPropertyValue(prop)||'').trim()||fb;
      var tmp=document.createElement('span'); tmp.style.color=v; tmp.style.display='none';
      el.appendChild(tmp); var rgb=getComputedStyle(tmp).color; el.removeChild(tmp);
      var m=/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgb||'');
      if(m) return [+m[1],+m[2],+m[3]];
    }catch(_){}
    return [125,156,207];
  }
  function bindTouchPad(pl){
    var pad=pl.querySelector('[data-tpad]'); if(!pad) return;
    var cv=pad.querySelector('canvas'), sumEl=pl.querySelector('[data-tsum]'), clrEl=pl.querySelector('[data-tclr]'), sendEl=pl.querySelector('[data-tsend]');
    var cur=null, lastVib=0, vibDist=0, holdT=null, deepT=null, raf=0;
    var W=0, H=0, accRgb=[125,156,207], inkRgb=[42,49,64], isDarkInk=true;
    var sim={x:0,y:0,tx:0,ty:0,depth:0,target:0,vel:0,sx:1,sy:1,vx:0,vy:0,pressAt:0};
    var ripples=[], trails=[];
    function fit(){
      var r=pad.getBoundingClientRect(), d=Math.min(2,window.devicePixelRatio||1);
      if(!r.width||!r.height) return;
      W=r.width; H=r.height;
      if(cv.width!==Math.round(W*d)||cv.height!==Math.round(H*d)){ cv.width=Math.round(W*d); cv.height=Math.round(H*d); }
      var c=cv.getContext('2d'); c.setTransform(d,0,0,d,0,0);
      accRgb=touchReadRgb(pad,'--acc','#7d9ccf');
      inkRgb=touchReadRgb(pad,'--tk-pink','');
      var lum=0.299*inkRgb[0]+0.587*inkRgb[1]+0.114*inkRgb[2];
      isDarkInk=lum<145;
    }
    function rgba(rgb,a){ return 'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+a.toFixed(3)+')'; }
    function addRipple(x,y,maxR,alpha,width){ ripples.push({x:x,y:y,r:10,maxR:maxR,a:alpha,w:width||2.2}); }
    function kickAnim(){ if(!raf) raf=requestAnimationFrame(tick); }
    function drawIndent(c,x,y,d,scale){
      if(d<=0.01) return;
      var baseR=(26+24*d)*(scale||1);
      var shCol=isDarkInk?[24,32,48]:[6,10,18];
      var hiCol=[255,255,255];
      /* 周围被挤起的柔润边缘高光环 */
      var rim=c.createRadialGradient(x,y,baseR*0.68,x,y,baseR*1.38);
      rim.addColorStop(0,'rgba(255,255,255,0)');
      rim.addColorStop(0.55,rgba(hiCol,(isDarkInk?0.36:0.18)*d));
      rim.addColorStop(1,'rgba(255,255,255,0)');
      c.fillStyle=rim; c.beginPath(); c.arc(x,y,baseR*1.38,0,Math.PI*2); c.fill();
      /* 凹陷内侧上方投影（顶部光打进软硅胶坑） */
      var pit=c.createRadialGradient(x-baseR*0.14,y-baseR*0.16,baseR*0.08,x,y,baseR);
      pit.addColorStop(0,rgba(shCol,(isDarkInk?0.22:0.34)*d));
      pit.addColorStop(0.58,rgba(accRgb,0.16*d));
      pit.addColorStop(1,'rgba(0,0,0,0)');
      c.fillStyle=pit; c.beginPath(); c.arc(x,y,baseR,0,Math.PI*2); c.fill();
      /* 凹坑下缘柔和透光与软弹高光 */
      var glow=c.createRadialGradient(x+baseR*0.18,y+baseR*0.22,0,x+baseR*0.12,y+baseR*0.16,baseR*0.76);
      glow.addColorStop(0,rgba(hiCol,(isDarkInk?0.42:0.22)*d));
      glow.addColorStop(0.6,rgba(accRgb,0.14*d));
      glow.addColorStop(1,'rgba(255,255,255,0)');
      c.fillStyle=glow; c.beginPath(); c.arc(x+baseR*0.12,y+baseR*0.16,baseR*0.76,0,Math.PI*2); c.fill();
    }
    function tick(){
      raf=0; if(!pad.isConnected) return;
      var c=cv.getContext('2d');
      c.clearRect(0,0,W,H);
      /* 欠阻尼弹簧物理：按下柔陷，松手 Q 弹回弹 */
      var k=cur?0.22:0.18, damp=cur?0.68:0.72;
      if(cur){
        var held=Date.now()-sim.pressAt;
        sim.target=Math.min(1.18,0.68+Math.min(0.46,held/1100*0.46));
        sim.x+=(sim.tx-sim.x)*0.34;
        sim.y+=(sim.ty-sim.y)*0.34;
      } else {
        sim.target=0;
      }
      var acc=(sim.target-sim.depth)*k;
      sim.vel=(sim.vel+acc)*damp;
      sim.depth+=sim.vel;
      if(!cur&&Math.abs(sim.depth)<0.008&&Math.abs(sim.vel)<0.006){ sim.depth=0; sim.vel=0; }
      /* 容器果冻挤压拉伸形变 */
      var squeeze=Math.max(-0.028,Math.min(0.055,sim.depth*0.036));
      var sx=1+squeeze*0.55, sy=1-squeeze*0.85;
      var shiftX=cur?Math.max(-3.5,Math.min(3.5,(sim.x-W/2)/(W||1)*6)):0;
      var shiftY=cur?Math.max(-2.5,Math.min(2.5,(sim.y-H/2)/(H||1)*5)):0;
      if(Math.abs(sim.depth)>0.005||cur){
        pad.style.transform='translate3d('+shiftX.toFixed(2)+'px,'+shiftY.toFixed(2)+'px,0) scale('+sx.toFixed(4)+','+sy.toFixed(4)+')';
      } else {
        pad.style.transform='';
      }
      /* 揉捏微压痕拖影（快速回弹消失，绝不留硬线） */
      for(var i=trails.length-1;i>=0;i--){
        var tr=trails[i]; tr.d*=0.84;
        if(tr.d<0.025){ trails.splice(i,1); continue; }
        drawIndent(c,tr.x,tr.y,tr.d*0.62,0.78);
      }
      /* 主触点凹陷 */
      if(sim.depth>0.01){ drawIndent(c,sim.x,sim.y,Math.max(0,sim.depth),1); }
      /* 果冻波纹 */
      for(var j=ripples.length-1;j>=0;j--){
        var rp=ripples[j];
        rp.r+=(rp.maxR-rp.r)*0.14+1.2;
        rp.a*=0.91;
        if(rp.a<0.015||rp.r>=rp.maxR){ ripples.splice(j,1); continue; }
        c.strokeStyle=rgba(accRgb,rp.a);
        c.lineWidth=rp.w*(rp.a/0.35);
        c.beginPath(); c.arc(rp.x,rp.y,rp.r,0,Math.PI*2); c.stroke();
      }
      if(cur||Math.abs(sim.depth)>0.006||Math.abs(sim.vel)>0.005||ripples.length||trails.length){
        raf=requestAnimationFrame(tick);
      }
    }
    function syncUI(){
      var s=touchSummarize();
      if(sumEl) sumEl.textContent=s?s.summary:'选择部位后在软垫上捏一捏或轻抚';
      if(clrEl) clrEl.classList.toggle('show',!!s);
      if(sendEl) sendEl.classList.toggle('ready',!!s);
    }
    pad.addEventListener('pointerdown',function(e){
      fit(); var r=pad.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
      pad.classList.add('down','has'); try{ pad.setPointerCapture(e.pointerId); }catch(_){}
      cur={t0:Date.now(),t1:Date.now(),lx:x,ly:y,x0:x,y0:y,dist:0,dx:0,dy:0,turns:0,angSum:0,lastAng:null};
      sim.x=sim.tx=x; sim.y=sim.ty=y; sim.pressAt=cur.t0; sim.vel+=0.26;
      addRipple(x,y,52,0.34,2.2);
      vibDist=0; buzz(10); kickAnim();
      clearTimeout(holdT); clearTimeout(deepT);
      holdT=setTimeout(function(){
        if(cur&&cur.dist<26){ addRipple(sim.x,sim.y,74,0.3,2.6); buzz([14,26,16]); kickAnim(); }
      },450);
      deepT=setTimeout(function(){
        if(cur&&cur.dist<36){ addRipple(sim.x,sim.y,94,0.26,2.8); buzz([18,30,14]); kickAnim(); }
      },1050);
    });
    pad.addEventListener('pointermove',function(e){
      if(!cur) return;
      var r=pad.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, ddx=x-cur.lx, ddy=y-cur.ly, step=Math.hypot(ddx,ddy);
      if(step<1.5) return;
      sim.tx=x; sim.ty=y;
      if(trails.length<12) trails.push({x:cur.lx,y:cur.ly,d:Math.min(0.85,sim.depth)});
      var ang=Math.atan2(ddy,ddx), turned=false;
      if(step>=3.5){
        if(cur.lastAng!=null){
          var da=Math.abs(ang-cur.lastAng); if(da>Math.PI) da=Math.PI*2-da;
          cur.angSum+=da;
          if(cur.angSum>=1.75){ cur.turns++; cur.angSum=0; turned=true; }
        }
        cur.lastAng=ang;
      }
      cur.dist+=step; cur.dx=x-cur.x0; cur.dy=y-cur.y0; cur.lx=x; cur.ly=y; cur.t1=Date.now();
      vibDist+=step;
      if(turned&&Date.now()-lastVib>=65){ buzz(9); addRipple(x,y,42,0.24,1.8); lastVib=Date.now(); }
      else if(vibDist>=26&&Date.now()-lastVib>=48){ buzz(6); vibDist=0; lastVib=Date.now(); }
      kickAnim();
    });
    function finishStroke(){
      if(!cur) return;
      clearTimeout(holdT); clearTimeout(deepT);
      cur.t1=Date.now();
      var dur=cur.t1-cur.t0;
      TSTATE.strokes.push(cur);
      cur=null; pad.classList.remove('down');
      sim.vel-=0.32;
      addRipple(sim.x,sim.y,dur>=450?84:58,0.26,1.8);
      buzz(dur>=450?[8,20,5]:4);
      kickAnim(); syncUI();
    }
    pad.addEventListener('pointerup',finishStroke); pad.addEventListener('pointercancel',finishStroke);
  }
  function touchSend(repaint){
    if(!LIVE.on){ toast('先从一个会话进来'); return; }
    var s=touchSummarize(); if(!s){ toast('先在软垫上捏一捏再发'); return; }
    if(ATT.length){
      if(ATT.some(function(a){ return a.st==='error'; })){ toast('有附件没传上，先移除再发'); return; }
      if(ATT.some(function(a){ return a.st!=='ready'; })){ toast('附件还在上传，等一下再发'); return; }
    }
    var id='touch-'+Date.now().toString(36);
    var tag='<card_reply id="'+id+'" type="touch" zone="'+esc(s.zone)+'" gesture="'+esc(s.gesture)+'" duration="'+s.duration+'" speed="'+esc(s.speed)+'" count="'+s.count+'" dir="'+esc(s.dir)+'" steps="'+esc(s.steps)+'">'+s.text+'</card_reply>';
    var tx=(ta.value||'').replace(/\s+$/,'');
    var sendTx=quoteApply(tx.trim()?tx+'\n'+tag:tag);
    if(liveSend(sendTx,ATT.length?ATT.map(attPart):undefined)){
      buzz([12,24,12]); touchClear(); dropSuggest(false);
      if(tx.trim()){ ta.value=''; ta.dispatchEvent(new Event('input')); }
      quoteClear(); if(ATT.length){ ATT=[]; attPaint(); }
      if(repaint) repaint();
    }
  }
  /* 卡片：占位，以后接随机游戏卡片 */
  /* [位置:phone-talk.js·quickSheet] [加号面板「快捷指令」：存一批常用的话，点一条就填进输入框；可增删改] [11-09 随手记：加号菜单增加一个快捷指令，本质就是增加一些指令进去，点击就填入输入框，增删改；填入规则（产品确定）：输入框空就直接填，非空就追加到末尾（换行分隔）；新增/编辑用高一点的弹窗；存云端 chat-settings.cfg.quick_cmds（[{id,t}]，换设备不丢），本机 ph_quick_cmds 先秒显；保存乐观更新，失败回滚并提示] [注释时间 2026-11-09] */
  var QK={list:null,loaded:false}, QK_KEY='ph_quick_cmds', QK_MAX=2000;
  function qkRead(){ if(QK.list) return QK.list; try{ var a=JSON.parse(localStorage.getItem(QK_KEY)||'[]'); QK.list=Array.isArray(a)?a:[]; }catch(e){ QK.list=[]; } return QK.list; }
  function qkSave(next){   /* 乐观写：先换本地，云端失败就回滚并抛给调用方 */
    var prev=qkRead(); QK.list=next; try{ localStorage.setItem(QK_KEY,JSON.stringify(next)); }catch(e){}
    return P.net.req('/heartbeat/admin/chat-settings',{method:'PUT',body:{cfg_patch:{quick_cmds:next}},noLogin:true}).catch(function(e){
      QK.list=prev; try{ localStorage.setItem(QK_KEY,JSON.stringify(prev)); }catch(_){} throw e; });
  }
  function qkFill(t){   /* 空=直接填；非空=追加到末尾（上一行没换行就补一个） */
    var v=ta.value; ta.value=v?(v+(/\n$/.test(v)?'':'\n')+t):t;
    ta.dispatchEvent(new Event('input',{bubbles:true})); try{ ta.setSelectionRange(ta.value.length,ta.value.length); }catch(e){}   /* 不 focus：聚焦会把加号面板收掉，要连点拼接 */
  }
  /* [位置:phone-talk.js·qkBody/qkSync] [快捷指令列表嵌进加号面板，和表情包同一块地方（stkPanel 的 qk 页）] [11-09：不要底部抽屉，像表情包一样嵌在菜单栏里；点一条填进输入框、面板不收可连点；云端为准，进面板先画本机缓存再拉云端覆盖] [注释时间 2026-11-09] */
  function qkBody(){
    var L=qkRead();
    return '<div class="qkl">'+(L.length?L.map(function(c,i){ return '<div class="qk-r tap" data-qki="'+i+'"><span class="qk-t">'+esc(c.t)+'</span><button class="qk-e tap" data-qke="'+i+'" type="button" aria-label="编辑">编辑</button></div>'; }).join(''):'<div class="qk-empty">还没有快捷指令<small>点右上角「新增」，存下常用的话</small></div>')+'</div>';
  }
  function qkSync(cb){
    P.net.get('/heartbeat/admin/chat-settings',{noLogin:true}).then(function(r){
      var a=r&&r.data&&r.data.cfg&&r.data.cfg.quick_cmds; if(!Array.isArray(a)) return;
      a=a.filter(function(c){ return c&&typeof c.t==='string'&&c.t; }); QK.list=a; try{ localStorage.setItem(QK_KEY,JSON.stringify(a)); }catch(e){}
      cb();
    },function(){});
  }
  function quickEdit(idx,done){
    var L=qkRead(), cur=idx>=0?L[idx]:null, X='<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    sheet('<div class="mch"><button class="mcx tap" data-a="x" aria-label="关闭">'+X+'</button><b>'+(cur?'编辑快捷指令':'新增快捷指令')+'</b><button class="rs tap qk-ok" data-a="ok">保存</button></div><div class="opt tk-pan"><textarea class="qk-ta" maxlength="'+QK_MAX+'" placeholder="点一下就会填进输入框的话">'+esc(cur?cur.t:'')+'</textarea>'+(cur?'<button class="qk-del tap" data-a="del">删除这条</button>':'')+'</div>','opts mcp qkm qked',function(box,close0){
      var tx=box.querySelector('.qk-ta'), okb=box.querySelector('[data-a=ok]'), busy=false, kbOff=null, dt=0;
      function close(){ if(kbOff) kbOff(); clearTimeout(dt); close0(); }
      /* [位置:phone-talk.js·quickEdit] [快捷指令弹窗软键盘避让] [键盘起来把居中弹窗整体往上推，离键盘保持 12px 间距，不遮挡保存/删除按钮] [注释时间 2026-11-13] */
      if(P.kb) kbOff=P.kb(function(kb){
        if(!box.isConnected){ if(kbOff) kbOff(); return; }
        kb=Math.round(kb||0);
        if(kb<=0){ box.style.transform=''; return; }
        var bR=box.getBoundingClientRect();
        var kbTop=(window.innerHeight||document.documentElement.clientHeight||0)-kb;
        var need=Math.round(bR.bottom+12-kbTop);
        if(need>0){
          var cap=Math.round(bR.top-12);
          box.style.transform='translateY(-'+Math.min(need,Math.max(0,cap))+'px)';
        } else {
          box.style.transform='';
        }
      });
      box.querySelector('[data-a=x]').addEventListener('click',close);
      function commit(next,okMsg){
        if(busy) return; busy=true; okb.classList.add('busy');
        qkSave(next).then(function(){ busy=false; buzz([8,30,8]); toast(okMsg); close(); done(); },function(){ busy=false; okb.classList.remove('busy'); buzz([12,30,12]); toast('没存上，再试一次'); });
      }
      okb.addEventListener('click',function(){
        var t=tx.value.replace(/\s+$/,''); if(!t.trim()){ toast('先写点内容'); buzz([12,30,12]); tx.focus(); return; }
        var cp=qkRead().slice();
        if(cur) cp[idx]={id:cur.id,t:t}; else cp.push({id:'qk_'+Date.now().toString(36)+Math.random().toString(36).slice(2,4),t:t});
        commit(cp,cur?'改好了':'加好了');
      });
      var dl=box.querySelector('[data-a=del]');
      if(dl) dl.addEventListener('click',function(){   /* 二次确认：第一下变红字「再点一下删除」，3 秒不点复位 */
        if(!dl.classList.contains('arm')){ dl.classList.add('arm'); dl.textContent='再点一下确认删除'; buzz([10,30,10]); dt=setTimeout(function(){ dl.classList.remove('arm'); dl.textContent='删除这条'; },3000); return; }
        var cp=qkRead().slice(); cp.splice(idx,1); commit(cp,'删掉了');
      });
      if(!cur) setTimeout(function(){ try{ tx.focus(); }catch(e){} },380);
    },{single:true,noKb:true});
  }

  /* [位置:phone-talk.js·worldbook] [加号面板「动态注入」：全局条目库 + 会话级注入开关 + 常驻/关键词触发，参考快捷指令布局] [注释时间 2026-11-21] */
  var WB={sid:'',list:null,loaded:false}, WB_TMAX=120, WB_CMAX=10000;
  function wbKey(sid){ return 'ph_wb_v2_'+(sid||'default'); }
  function wbRead(){
    var sid=stSid();
    if(WB.list&&WB.sid===sid) return WB.list;
    WB.sid=sid;
    try{ var a=JSON.parse(localStorage.getItem(wbKey(sid))||'[]'); WB.list=Array.isArray(a)?a:[]; }catch(e){ WB.list=[]; }
    return WB.list;
  }
  function wbCache(arr,sid){
    var s=sid!==undefined?sid:stSid();
    WB.sid=s; WB.list=Array.isArray(arr)?arr:[];
    try{ localStorage.setItem(wbKey(s),JSON.stringify(WB.list)); }catch(e){}
  }
  function wbSync(cb){
    var sid=stSid(); if(!sid) return;
    P.net.get('/heartbeat/admin/worldbook?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(r){
      if(!r||!Array.isArray(r.items)) return;
      if(stSid()!==sid) return;
      wbCache(r.items,sid); WB.loaded=true; cb();
    },function(){});
  }
  function wbBody(){
    var L=wbRead();
    return '<div class="qkl wbl">'+(L.length?L.map(function(c,i){
      var on=!!c.enabled, isKw=c.trigger_mode==='keyword', kws=Array.isArray(c.keywords)?c.keywords:[];
      var sub=(isKw&&kws.length?('触发词：'+kws.join('、')+' · '):'')+(c.content||'');
      return '<div class="qk-r wb-r">'
        +'<div class="wb-main tap" data-wbi="'+i+'"><div class="wb-top"><span class="wb-ti">'+esc(c.title||'未命名条目')+'</span><span class="wb-tag'+(isKw?' kw':'')+'">'+(isKw?'关键词':'常驻')+'</span></div><span class="wb-ct">'+esc(sub)+'</span></div>'
        +'<button class="qk-e tap" data-wbe="'+i+'" type="button" aria-label="编辑">编辑</button>'
        +'<button class="wb-sw tap'+(on?' on':'')+'" data-wbt="'+i+'" type="button" role="switch" aria-checked="'+(on?'true':'false')+'" aria-label="本会话是否注入"><i class="sw"></i></button>'
        +'</div>';
    }).join(''):'<div class="qk-empty">还没有动态注入条目<small>点右上角「新增」，可设常驻或关键词触发</small></div>')+'</div>';
  }
  function wbToggle(idx,done){
    var sid=stSid(); if(!sid){ toast('先从一个会话进来'); return; }
    var L=wbRead(), cur=L[idx]; if(!cur||!cur.id) return;
    var prev=!!cur.enabled, next=!prev;
    var cp=L.slice(); cp[idx]=Object.assign({},cur,{enabled:next}); wbCache(cp,sid); done();
    P.net.req('/heartbeat/admin/worldbook/'+encodeURIComponent(cur.id),{method:'PUT',body:{session_id:sid,enabled:next},noLogin:true}).then(function(r){
      if(r&&Array.isArray(r.items)&&stSid()===sid) wbCache(r.items,sid);
      done();
    },function(){
      if(stSid()===sid){
        var rb=wbRead().slice();
        for(var j=0;j<rb.length;j++){ if(rb[j].id===cur.id){ rb[j]=Object.assign({},rb[j],{enabled:prev}); break; } }
        wbCache(rb,sid);
      }
      done(); buzz([12,30,12]); toast('开关没存上，再试一次');
    });
  }
  function wbEdit(idx,done){
    var sid=stSid(); if(!sid){ toast('先从一个会话进来'); return; }
    var L=wbRead(), cur=idx>=0?L[idx]:null, initOn=cur?!!cur.enabled:true;
    var initMode=(cur&&cur.trigger_mode==='keyword')?'keyword':'always';
    var initKw=(cur&&Array.isArray(cur.keywords))?cur.keywords.join('、'):'';
    var X='<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    sheet('<div class="mch"><button class="mcx tap" data-a="x" aria-label="关闭">'+X+'</button><b>'+(cur?'编辑动态注入':'新增动态注入')+'</b><button class="rs tap qk-ok" data-a="ok">保存</button></div>'
      +'<div class="opt tk-pan">'
      +'<input class="wb-in" type="text" maxlength="'+WB_TMAX+'" placeholder="标题（如：角色设定 / 回复风格）" value="'+esc(cur?cur.title:'')+'">'
      +'<div class="wb-seg" data-a="seg"><button class="tap'+(initMode==='always'?' on':'')+'" type="button" data-m="always">常驻注入</button><button class="tap'+(initMode==='keyword'?' on':'')+'" type="button" data-m="keyword">关键词触发</button></div>'
      +'<input class="wb-kw" type="text" maxlength="400" placeholder="关键词（逗号、顿号或空格分隔，命中最新一条任意词即触发）" value="'+esc(initKw)+'"'+(initMode==='keyword'?'':' hidden')+'>'
      +'<textarea class="qk-ta" maxlength="'+WB_CMAX+'" placeholder="开启注入时会自动动态注入给 AI 的指令内容…">'+esc(cur?cur.content:'')+'</textarea>'
      +'<div class="ro tg wb-mrog'+(initOn?' on':'')+'" data-a="tog"><label>本会话开启注入<small>每个会话单独记开关，互不影响</small></label><i class="sw"></i></div>'
      +(cur?'<button class="qk-del tap" data-a="del">删除这条</button>':'')
      +'</div>','opts mcp qkm qked wbed',function(box,close0){
      var ti=box.querySelector('.wb-in'), kw=box.querySelector('.wb-kw'), tx=box.querySelector('.qk-ta'), tg=box.querySelector('[data-a=tog]'), seg=box.querySelector('[data-a=seg]'), okb=box.querySelector('[data-a=ok]');
      var busy=false, kbOff=null, dt=0, en=initOn, mode=initMode;
      function close(){ if(kbOff) kbOff(); clearTimeout(dt); close0(); }
      if(P.kb) kbOff=P.kb(function(kb){
        if(!box.isConnected){ if(kbOff) kbOff(); return; }
        kb=Math.round(kb||0);
        if(kb<=0){ box.style.transform=''; return; }
        var bR=box.getBoundingClientRect();
        var kbTop=(window.innerHeight||document.documentElement.clientHeight||0)-kb;
        var need=Math.round(bR.bottom+12-kbTop);
        if(need>0){
          var cap=Math.round(bR.top-12);
          box.style.transform='translateY(-'+Math.min(need,Math.max(0,cap))+'px)';
        } else {
          box.style.transform='';
        }
      });
      box.querySelector('[data-a=x]').addEventListener('click',close);
      seg.addEventListener('click',function(ev){
        var b=ev.target.closest('[data-m]'); if(!b) return;
        mode=b.getAttribute('data-m'); buzz(6);
        var bs=seg.querySelectorAll('[data-m]');
        for(var k=0;k<bs.length;k++) bs[k].classList.toggle('on',bs[k].getAttribute('data-m')===mode);
        kw.hidden=(mode!=='keyword');
        if(mode==='keyword'&&!kw.value.trim()) setTimeout(function(){ try{ kw.focus(); }catch(e){} },60);
      });
      tg.addEventListener('click',function(){ en=!en; tg.classList.toggle('on',en); buzz(6); });
      okb.addEventListener('click',function(){
        if(busy) return;
        var title=String(ti.value||'').replace(/[\r\n\t]+/g,' ').trim();
        var content=String(tx.value||'').replace(/\s+$/,'');
        var kwVal=String(kw.value||'').trim();
        if(!title){ toast('先写个标题'); buzz([12,30,12]); ti.focus(); return; }
        if(mode==='keyword'&&!kwVal){ toast('关键词触发请至少写一个关键词'); buzz([12,30,12]); kw.focus(); return; }
        if(!content.trim()){ toast('先写点内容'); buzz([12,30,12]); tx.focus(); return; }
        busy=true; okb.classList.add('busy');
        var payload={session_id:sid,title:title,content:content,trigger_mode:mode,keywords:mode==='keyword'?kwVal:'',enabled:en};
        var req=cur
          ? P.net.req('/heartbeat/admin/worldbook/'+encodeURIComponent(cur.id),{method:'PUT',body:payload,noLogin:true})
          : P.net.req('/heartbeat/admin/worldbook',{method:'POST',body:payload,noLogin:true});
        req.then(function(r){
          busy=false;
          if(r&&Array.isArray(r.items)) wbCache(r.items,sid);
          buzz([8,30,8]); toast(cur?'改好了':'加好了'); close(); done();
        },function(e){
          busy=false; okb.classList.remove('busy'); buzz([12,30,12]);
          toast((e&&e.body&&e.body.error)||'没存上，再试一次');
        });
      });
      var dl=box.querySelector('[data-a=del]');
      if(dl) dl.addEventListener('click',function(){
        if(!dl.classList.contains('arm')){ dl.classList.add('arm'); dl.textContent='再点一下确认删除'; buzz([10,30,10]); dt=setTimeout(function(){ dl.classList.remove('arm'); dl.textContent='删除这条'; },3000); return; }
        if(busy) return; busy=true; okb.classList.add('busy');
        P.net.req('/heartbeat/admin/worldbook/'+encodeURIComponent(cur.id)+'?session_id='+encodeURIComponent(sid),{method:'DELETE',noLogin:true}).then(function(r){
          busy=false;
          if(r&&Array.isArray(r.items)) wbCache(r.items,sid);
          buzz([8,30,8]); toast('删掉了'); close(); done();
        },function(){
          busy=false; okb.classList.remove('busy'); buzz([12,30,12]); toast('没删掉，再试一次');
        });
      });
      if(!cur) setTimeout(function(){ try{ ti.focus(); }catch(e){} },380);
    },{single:true,noKb:true});
  }

  function cardSheet(){
    plusOpen(false);
    sheet('<div class="hd"><span>随机游戏卡片</span></div><div class="opt tk-cardph"><div class="dice" id="tkDice">🎲</div><b>还在准备</b><small>以后点这里会抽一张小游戏卡片：真心话、猜拳、抽签、选择题……</small><button class="nw tap" id="tkRoll">先摇一下试试</button></div>','opts',function(box){ box.querySelector('#tkRoll').addEventListener('click',function(){ var d=box.querySelector('#tkDice'); d.classList.remove('roll'); void d.offsetWidth; d.classList.add('roll'); buzz([8,40,8,40,8]); setTimeout(function(){ toast(['今天的你：适合被抱一下','抽到：真心话','抽到：猜拳三局两胜'][Math.floor(Math.random()*3)]); },700); }); });
  }

  /* [位置:phone-talk.js·mcpSheet] [会话级 MCP 工具弹层] [「+」面板的 MCP 入口：按服务器分组列工具，开关只管当前会话（全局开关在配置页的 MCP 服务）；服务器可展开看工具，也可整组开关；全局停用的服务器点开才去探测；面板本地缓存秒开，后台静默刷新] [注释时间 2026-10-26 改：缓存拆两层，见 cacheRead] */
  function mcpSheet(){
    plusOpen(false);
    var sid=stSid(); if(!sid){ toast('先从一个会话进来'); return; }
    var MCP_URL='/heartbeat/admin/session-mcp';
    /* [位置:phone-talk.js·mcpSheet] [会话 MCP 面板改成底部抽屉 + 工具数和全局对齐] [10-23：①居中弹窗不好看，改成从底部升起的抽屉（高 65%，背景只压一层淡色、不模糊，头部=关闭 / 标题 / 文字「重置」，顶部把手可往下拖关；参考 Kelivo 的 MCP 服务器抽屉）；②工具集合自己「停用名单」里的工具（后端 disabled_server=true）也列出来，开关是关的、点了只提示去全局设置启用，所以总数和全局工具页一样（16/18）；③存开关时把列出的全部工具 key 一起交上去（seen），之后全局新增的工具才被当成新工具默认开，见过但关着的不动] [注释时间 2026-10-23] */
    sheet('<i class="mcgrab grab"></i><div class="mch"><button class="mcx tap" data-a="x" aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><b>MCP 工具</b><button class="rs tap" data-a="rs">重置</button></div><div class="opt tk-pan"><div class="mcl"><div class="mcm">读取中…</div></div></div>','opts mcp',function(box,close){
      /* [位置:phone-talk.js·mcpSheet 工具规则] [弹层编辑的是这个会话的「规则」] [10-27：每个服务器 默认开/关 + 例外（形状同 lib/mcp-rules.js，共用 P.mcpr）；ST.rules 为 null = 这个会话还在跟随全局，开关显示全局现状，第一次点才生成规则；旧会话（有旧清单）服务端换算成等价规则给这里，保存后即迁移] [注释时间 2026-10-27] */
      var el=box.querySelector('.mcl'), ST={servers:[],rules:null}, open={}, tm=0, MR=P.mcpr;
      function sv(s){ return {id:s.id,enabled_global:s.enabled_global!==false,probed:!!s.probed,tools:(s.tools||[]).map(function(x){ return {key:x.key,name:x.name,dis:!!x.disabled_server,blocked:!!x.blocked}; })}; }
      function view(){ return ST.rules||MR.fromGlobal(ST.servers.map(sv)); }
      function isOn(s,x){ if(x.disabled_server) return false; return ST.rules?MR.toolOn(ST.rules,sv(s),{name:x.name,dis:false,blocked:!!x.blocked}):!!x.on; }
      box.querySelector('[data-a=x]').addEventListener('click',close);
      function save(){ dirty=true; clearTimeout(tm); tm=setTimeout(function(){ cacheOn(); P.net.req(MCP_URL,{method:'PUT',body:{session_id:sid,rules:ST.rules},noLogin:true}).catch(function(){ toast('MCP 开关没存上'); }); },450); }
      function paint(){
        if(!ST.servers.length){ el.innerHTML='<div class="mcm">没有配置 MCP 服务</div>'; return; }
        el.innerHTML=ST.servers.map(function(s,i){
          var n=s.tools.filter(function(x){ return isOn(s,x); }).length, pill=!s.probed?'工具: –':(s.connected===false?'没连上':'工具: '+n+'/'+s.tools.length);
          var rows=(open[i]&&s.tools.length)?'<div class="mct">'+s.tools.map(function(x){ return '<div class="ro tg tl'+(x.disabled_server?' dis':(isOn(s,x)?' on':''))+'" data-k="'+esc(x.key)+'"><label>'+esc(x.name)+'</label><i class="sw"></i></div>'; }).join('')+'</div>':'';
          return '<div class="mcg"><div class="ro mcs'+(n>0?' on':'')+(s.enabled_global?'':' off')+'" data-s="'+i+'"><i class="mci">'+I.hammer+'</i><label>'+esc(s.name)+'</label><span class="mcp">'+esc(pill)+'</span><i class="sw"></i></div>'+rows+'</div>';
        }).join('');
      }
      /* [位置:phone-talk.js·mcpSheet] [面板本地缓存（stale-while-revalidate）] [10-25：每次打开都白板等网络太慢。按会话存 localStorage（tkMcp:<会话id>），打开先画缓存秒开，后台照旧拉最新，回来静默刷新；探测过的服务器（连工具列表）和开关一起存，下次打开不用再探测。已在缓存画面上翻过开关（dirty）时，刷新只更新服务器结构、不覆盖刚点的开关（PUT 落库后下次打开自然一致）；没有缓存时拉取失败才显示「没连上后台」。写缓存时机：拉到最新、探测到工具、翻转开关（防抖时一并写）。1026 晚改：原来整套按会话存，新会话每次都是新 id、缓存永远打不中——拆成两层：tkMcp:struct 全局存「服务器+工具清单」（探测贵、基本不变），tkMcp:<会话id> 只存本会话开关] [注释时间 2026-10-26] */
      var CK='tkMcp:'+sid, GK='tkMcp:struct', CACHE=null, dirty=false;
      /* [位置:phone-talk.js·mcpSheet cacheRead/cacheWrite] [结构缓存全局、开关按会话] [读不到本会话缓存就退回 tkMcp:struct（新会话秒显：开关显示上次已知状态，拉到真数据静默校正）；写时两层都更新] [注释时间 2026-10-26] */
      function cacheRead(){ try{ var c=JSON.parse(localStorage.getItem(CK)||'null'); if(c&&c.servers&&c.servers.length) return c; }catch(e){} try{ var g=JSON.parse(localStorage.getItem(GK)||'null'); return (g&&g.servers&&g.servers.length)?g:null; }catch(e){ return null; } }
      function cacheWrite(c){ try{ c.ts=Date.now(); localStorage.setItem(CK,JSON.stringify(c)); localStorage.setItem(GK,JSON.stringify({ts:c.ts,servers:c.servers})); }catch(e){} }
      function cacheOn(){ if(!CACHE) CACHE={follow_global:false,rules:null,servers:[]}; CACHE.follow_global=false; CACHE.rules=ST.rules; cacheWrite(CACHE); }
      function cacheFix(sv){ if(!CACHE) CACHE={follow_global:true,on_keys:[],servers:[]}; if(sv) CACHE.servers=CACHE.servers.map(function(s){ return s.id===sv.id?sv:s; }); cacheWrite(CACHE); }
      function apply(d){ ST.servers=d.servers||[]; ST.rules=(d.rules&&d.rules.servers)?d.rules:null; }
      /* [位置:phone-talk.js·mcpSheet 先套规则+锁开关] [弹层打开先问本会话规则（light，毫秒级），再画；没拿到规则前开关锁住] [11-05：新会话只有全局结构缓存，里面每个工具的 on 是上个会话的残影，4~10 秒的完整请求回来前一直显示错的，期间点开关还会用残影生成规则覆盖预设。现在：结构缓存的 on 一律重置成全局状态；light 请求拿到本会话规则立刻套上并解锁；旧会话（服务端无规则）等完整请求] [注释时间 2026-11-05] */
      var ready=false;
      CACHE=cacheRead();
      if(CACHE){ if(!CACHE.rules&&CACHE.servers){ CACHE={follow_global:true,rules:null,servers:CACHE.servers.map(function(s){ var t=JSON.parse(JSON.stringify(s)); (t.tools||[]).forEach(function(x){ x.on=!!x.global_on&&!x.disabled_server; }); return t; })}; } apply(CACHE); paint(); }
      P.net.get(MCP_URL+'?session_id='+encodeURIComponent(sid)+'&light=1',{noLogin:true}).then(function(r){
        if(ready||dirty||!r) return; if(r.rules&&r.rules.servers){ ST.rules=r.rules; ready=true; el.classList.remove('busy'); paint(); } else if(r.follow_global){ ready=true; el.classList.remove('busy'); }
      },function(){});
      function load(){
        return P.net.get(MCP_URL+'?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(r){
          if(dirty) ST.servers=(r&&r.servers)||[]; else apply(r||{}); ready=true; el.classList.remove('busy');
          CACHE={follow_global:dirty?false:(r&&r.follow_global),rules:ST.rules,servers:ST.servers}; cacheWrite(CACHE); paint();
        },function(){ if(!CACHE) el.innerHTML='<div class="mcm">没连上后台</div>'; });
      }
      el.addEventListener('click',function(e){
        if(!ready){ toast('读取中，稍等'); return; }
        var tl=e.target.closest('.tl');
        if(tl&&tl.classList.contains('dis')){ toast('该工具已停用，到全局设置里启用'); return; }
        if(tl){ var k=tl.getAttribute('data-k'), hit=null; ST.servers.forEach(function(s0){ (s0.tools||[]).forEach(function(x0){ if(x0.key===k) hit={s:s0,x:x0}; }); });
          if(hit) ST.rules=MR.setTool(view(),sv(hit.s),{name:hit.x.name,dis:false,blocked:!!hit.x.blocked},!isOn(hit.s,hit.x));
          buzz(6); save(); paint(); return; }
        var sr=e.target.closest('.mcs'); if(!sr) return; var i=+sr.getAttribute('data-s'), s=ST.servers[i];
        var wantAll=!!e.target.closest('.sw');
        if(wantAll&&s.probed){ var anyOn=s.tools.some(function(x){ return isOn(s,x); }); ST.rules=MR.setServer(view(),sv(s),!anyOn); buzz(6); save(); paint(); return; }
        if(!s.probed){
          el.classList.add('busy');
          P.net.get(MCP_URL+'?session_id='+encodeURIComponent(sid)+'&probe='+encodeURIComponent(s.id),{noLogin:true}).then(function(r){
            el.classList.remove('busy'); var ns=((r&&r.servers)||[]).filter(function(x){ return x.id===s.id; })[0];
            if(ns){ ST.servers[i]=ns; if(!ns.tools.length) toast(ns.error||'没拿到工具'); else if(wantAll){ ST.rules=MR.setServer(view(),sv(ns),true); save(); } cacheFix(ns); }
            open[i]=!wantAll; paint();
          },function(){ el.classList.remove('busy'); toast('没连上后台'); });
          return;
        }
        open[i]=!open[i]; paint();
      });
      box.querySelector('[data-a=rs]').addEventListener('click',function(){
        P.net.req(MCP_URL,{method:'PUT',body:{session_id:sid,reset:true},noLogin:true}).then(function(){ toast('按全局重置了'); dirty=false; open={}; return load(); },function(){ toast('没重置成功'); });
      });
      load();
    },{single:true,stretch:{natural:true}});   /* 10-28 三档；10-31：收两档（自然高⇄满高），不记档 */
  }

  list.addEventListener('click',function(e){ if(e.target.closest('[data-retry]')){ e.stopPropagation(); buzz(8); var tr=e.target.closest('.tk-fail'); retryLast(tr&&tr.getAttribute('data-fid')); } });
  /* ---------- 长按气泡 ---------- */
  var lpT=0;
  /* 长按：手指一动（>8px）或列表在滚，就不算长按——滑着看消息时不会把菜单弹出来 */
  var lpX=0, lpY=0;
  list.addEventListener('pointerdown',function(e){ if(MS) return; /* [位置:phone-talk.js·长按 pointerdown] [极简样式表情包长按不弹菜单] [10-30：极简下表情包长按还会弹菜单，去掉；气泡样式不变。2026-11-24：选择文本改弹窗后，11-23 加的关闭冷却与选字态两道拦截删除] [注释时间 2026-10-30；2026-11-23 改；2026-11-24 改] */ var b=e.target.closest(MIN?'.tk-g.me .b,.tk-img,.tk-file':'.b,.tk-img,.tk-stk,.tk-file'); if(!b||b.classList.contains('typing')) return; lpX=e.clientX; lpY=e.clientY; clearTimeout(lpT); lpT=setTimeout(function(){ bubMenu(b); },430); });
  list.addEventListener('pointermove',function(e){ if(lpT&&(Math.abs(e.clientX-lpX)>8||Math.abs(e.clientY-lpY)>8)){ clearTimeout(lpT); lpT=0; } },{passive:true});
  list.addEventListener('scroll',function(){ if(lpT){ clearTimeout(lpT); lpT=0; } },{passive:true});
  ['pointerup','pointercancel'].forEach(function(ev){ list.addEventListener(ev,function(){ clearTimeout(lpT); lpT=0; }); });
  list.addEventListener('contextmenu',function(e){ if(MIN&&e.target.closest('.tk-g.ai .b')) return; e.preventDefault(); });
  /* [位置:phone-talk.js·actBar] [极简样式的消息操作条] [照 Claude 网页端：只有他（AI）的消息下面有一排灰色小图标：复制 / 播放 / 编辑 / 多选 / 重新生成 / 三个点（11-18：多选、重新生成从三个点菜单外移成常驻按钮，菜单剩标星 / 开启分支 / 删除）。行尾显示这条回复的 token 总值（tokInfo 有数才出，旧消息没有 usage 就没有），点开 tokPop 弹层看明细。他的文字长按改成原生选字，菜单靠这排按钮进；我的消息不加按钮，长按照旧弹菜单。] [注释时间 2026-10-22 改；2026-11-18 改按钮外移+token 总值] */
  function actBar(side,ri,g){
    var bs=[['copy','复制','copy'],['tts','播放','speak'],['edit','编辑','pen'],['multi','多选','multi'],['regen','重新生成','regen'],['more','更多','more']];
    var tu=g.raw&&tokInfo(g.raw.tokens), tk=tu?'<button type="button" class="mn-tok" data-a="tok" aria-label="Token 用量">'+(tu.tot!=null?tu.tot:tu.pt+tu.out)+' tokens</button>':'';
    return '<div class="mn-act '+side+'" data-ar="'+ri+'">'+bs.map(function(x){ return '<button type="button" data-a="'+x[0]+'" aria-label="'+x[1]+'"'+'>'+I[x[2]]+'</button>'; }).join('')+tk+'</div>'; }
  list.addEventListener('click',function(e){ var bt=e.target.closest('.mn-act [data-a]'); if(!bt) return; e.stopPropagation();
    var bar=bt.parentNode, g=REF[+bar.getAttribute('data-ar')], k=bt.getAttribute('data-a'); if(!g) return; buzz(6);
    if(k==='more'){ bubMenu(bar,true); return; }
    if(k==='tok'){ tokPop(bt,g); return; }   /* 11-18：点行尾 token 总值弹明细弹层 */
    if(LIVE.on&&g.raw) liveAct(k,g); else toast({copy:'已拷贝',edit:'编辑（示例）',tts:'朗读中…',star:'★ 已标星',multi:'多选（示例）',regen:'重新生成（示例）',branch:'开了个分支（示例）'}[k]); });
  function bubMenu(b,col){
    buzz([12,40,18]); var ai=!!b.closest('.tk-g.ai'), r=b.getBoundingClientRect(), hr=host.getBoundingClientRect();
    var ov=document.createElement('div'); ov.className='tk-ov';
    var g0=REF[+(b.getAttribute('data-r')||b.getAttribute('data-ar'))], starred=!!(g0&&isStar(g0.raw));
    /* [位置:phone-talk.js·bubMenu] [菜单选项排序] [10-23 需求 41：常用的在前，有后果的（重新生成、开启分支、删除）在后，删除永远最后一项（红色）] [注释时间 2026-10-23] */
    var its=[['copy','复制','copy'],['edit','编辑','pen'],['star',starred?'取消标星':'标星','star'],['tts','朗读','speak'],['multi','多选','multi'],['regen','重新生成','regen'],['branch','开启分支','branch'],['del','删除','trash']];
    if(!MIN&&b.classList.contains('b')) its.splice(1,0,['quote','引用','quote'],['seltext','选择文本','seltext']);
    if(b.classList.contains('tk-img')&&LIVE.on) its.unshift(['album','加入相册','photo']);   /* [位置:phone-talk.js·bubMenu] [长按图片多一项「加入相册」] [10-23 相册：不再自动收图，要存哪张自己长按选] [注释时间 2026-10-23] */
    ov.innerHTML='<div class="scrim"></div><div class="tk-menu'+(col?' col':'')+'" style="visibility:hidden;top:0;'+(ai?'left:'+Math.max(12,r.left-hr.left)+'px':'right:'+Math.max(12,hr.right-r.right)+'px')+'">'+
      (col?[['star',starred?'取消标星':'标星','star'],['branch','开启分支','branch'],['del','删除','trash']]:its).map(function(x){ return '<button data-m="'+x[0]+'"'+(x[0]==='del'?' class="red"':x[0]==='star'&&starred?' class="on"':'')+'>'+(I[x[2]]||'')+'<span>'+x[1]+'</span></button>'; }).join('')+(ai&&!col?'<button data-m="think" class="wide"><span>思考和工具</span>'+I.chv+'</button>':'')+'</div>';
    host.appendChild(ov);
    /* 菜单永远整个露在外面：先放气泡下面，放不下放上面，都放不下（气泡太长）就放在顶栏下面、输入框上面中间那块 */
    var mn=ov.querySelector('.tk-menu'), mh=mn.offsetHeight, topSafe=(parseFloat(getComputedStyle(host).getPropertyValue('--sat'))||0)+70, botSafe=hr.height-84, below=r.bottom-hr.top+10, above=r.top-hr.top-10-mh, y;
    if(below+mh<=botSafe) y=below; else if(above>=topSafe) y=above; else y=Math.max(topSafe,Math.min(botSafe-mh,(topSafe+botSafe-mh)/2));
    mn.style.top=Math.round(y)+'px'; mn.style.visibility='';
    b.classList.add('lifted'); requestAnimationFrame(function(){ ov.classList.add('show'); });
    function close(){ ov.classList.remove('show'); b.classList.remove('lifted'); setTimeout(function(){ ov.remove(); },220); }
    ov.querySelector('.scrim').addEventListener('click',close);
    var gg=REF[+(b.getAttribute('data-r')||b.getAttribute('data-ar'))];
    ov.querySelector('.tk-menu').addEventListener('click',function(e){ var x=e.target.closest('[data-m]'); if(!x) return; var act=x.getAttribute('data-m'); close(); if(act==='quote'){ quoteFrom(b); return; } if(act==='seltext'){ selPop(b); return; } if(LIVE.on&&gg&&gg.raw){ liveAct(act,gg); return; } if(act==='think'){ setTimeout(function(){ drawer(false); },200); return; } toast({copy:'已拷贝',edit:'编辑（示例）',star:'★ 已标星',tts:'朗读中…',del:'删掉了（示例）',multi:'多选（示例）',regen:'重新生成（示例）',branch:'开了个分支（示例）',tok:'token（示例）'}[act]); });
  }

  /* [位置:phone-talk.js·tokPop] [极简操作条 token 总值的明细弹层] [11-18：点操作条行尾总值就地弹出小面板，样式照她给的截图（↑输入+已缓存 / ↓输出+含思考 / 合计 / 模型名，数字不加千分位）；口径同 tokSheet——思考并进输出行括注，输入+输出=合计；锚定按钮右对齐，优先弹上方、放不下翻下方，点遮罩收起] [注释时间 2026-11-18] */
  function tokPop(bt,g){
    var k=g&&g.raw&&tokInfo(g.raw.tokens); if(!k) return;
    buzz(6);
    var n0=function(n){ return String(+n||0); };
    var rows='<div class="tr"><i>'+I.aup+'</i><b>'+n0(k.pt)+'</b><span>tokens</span>'+(k.hit!=null?'<em>'+n0(k.hit)+' 已缓存</em>':'')+'</div>'+
      '<div class="tr"><i>'+I.adn+'</i><b>'+n0(k.out)+'</b><span>tokens</span>'+(k.add>0?'<em>含思考 '+n0(k.add)+'</em>':'')+'</div>'+
      '<div class="tr"><i>'+I.tok+'</i><b>'+n0(k.tot!=null?k.tot:k.pt+k.out)+'</b><span>tokens</span></div>';
    var md=(g.raw&&(g.raw.model||g.raw.model_name))||''; if(md) rows+='<div class="tr md">'+esc(md)+'</div>';
    var ov=document.createElement('div'); ov.className='tk-ov';
    ov.innerHTML='<div class="scrim"></div><div class="tk-tokpop" style="visibility:hidden;top:0">'+rows+'</div>';
    host.appendChild(ov);
    var r=bt.getBoundingClientRect(), hr=host.getBoundingClientRect(), pn=ov.querySelector('.tk-tokpop'), mh=pn.offsetHeight;
    var topSafe=(parseFloat(getComputedStyle(host).getPropertyValue('--sat'))||0)+70, botSafe=hr.height-84;
    var above=r.top-hr.top-10-mh, below=r.bottom-hr.top+10, y;
    if(above>=topSafe) y=above; else if(below+mh<=botSafe) y=below; else y=Math.max(topSafe,Math.min(botSafe-mh,r.top-hr.top));
    pn.style.top=Math.round(y)+'px'; pn.style.right=Math.max(12,hr.right-r.right)+'px';
    pn.style.transformOrigin=y<r.top-hr.top?'50% 100%':'50% 0';
    pn.style.visibility='';
    requestAnimationFrame(function(){ ov.classList.add('show'); });
    function close(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); },220); }
    ov.querySelector('.scrim').addEventListener('click',close);
  }

  /* ---------- 底部抽屉：思考 + 工具（流式，像 Claude 桌面版那张汇总卡） ---------- */
  /* [位置:phone-talk.js·dwPaint] [实时抽屉就地对账] [原来每帧整块换 innerHTML：滚动位置清零、点步骤标题也会丢。现在按 data-k 一步一步对账：新步骤追加、思考盒子只改自己的文字（盒子里的滚动位置保留，在盒子底部就跟着往下）、工具步骤变了才换那一个；整个抽屉的滚动：在底部就跟到底，手往上滑了就不动] [注释时间 2026-10-21 改] */
  function dwPaint(dw){ var pn=dw.querySelector('.pane'); if(!pn) return; var d=liveData(), tl=pn.querySelector('.tl');
    if(!tl){ pn.innerHTML='<i class="grab"></i>'+chainHTML(d,true); return; }
    var near=tl.scrollHeight-tl.scrollTop-tl.clientHeight<48;
    var sm=pn.querySelector('.dh small'); if(sm){ var sh=dhSmall(d,true); if(sm._h!==sh){ sm._h=sh; sm.innerHTML=sh; } }
    var map={}; Array.prototype.forEach.call(tl.children,function(c){ if(c.getAttribute&&c.getAttribute('data-k')) map[c.getAttribute('data-k')]=c; });
    var pts=d.parts||[]; if(pts.length){ var em=tl.querySelector('.tk-dwe'); if(em) em.remove(); }
    pts.forEach(function(p,pi){ var dk=d.id+':'+pi, el=map[dk];
      if(!el){ var tmp=document.createElement('div'); tmp.innerHTML=stepHTML(p,dk); el=tmp.firstChild; tl.appendChild(el); var sb0=el.querySelector('.sb'); if(sb0){ sb0._seen=1; sb0.scrollTop=sb0.scrollHeight; } el._h=stepHTML(p,dk); return; }
      if(p.type==='reasoning'){ var sb=el.querySelector('.sb'), nh=esc(p.text).replace(/\n/g,'<br>'); if(sb&&sb._h!==nh){ var bn=sb._seen?(sb.scrollHeight-sb.scrollTop-sb.clientHeight<24):true; sb._h=nh; sb._seen=1; sb.innerHTML=nh; if(bn) sb.scrollTop=sb.scrollHeight; } }
      else { var hh=stepHTML(p,dk); if(el._h!==hh){ var tmp2=document.createElement('div'); tmp2.innerHTML=hh; var ne=tmp2.firstChild; ne._h=hh; if(el.classList.contains('fold')===false) ne.classList.remove('fold'); tl.replaceChild(ne,el); } } });
    if(near) tl.scrollTop=tl.scrollHeight; }
  function drawer(live,data){
    var dw=document.createElement('div'); dw.className='tk-dw'+(live?' live':'');   /* [10-31：live 抽屉最后一步=进行中的步骤，CSS 据此藏整段选中按钮（内容没定选了也白选）] */
    /* [位置:phone-talk.js·drawer 空状态] [无数据时显示「没有记录」，不再渲染写死的示例步骤] [10-30：示例数据（她发了照片/看图/读待办…）去掉；原来 drawer(live) 不带 data 时塞一份假的思考+工具] [注释时间 2026-10-30] */
    if(data) dw.innerHTML='<div class="scrim"></div><div class="pane"><i class="grab"></i>'+chainHTML(data,live)+'</div>';
    else dw.innerHTML='<div class="scrim"></div><div class="pane"><i class="grab"></i><div class="dh"><b>思考与工具</b></div><div class="sc tl"><div class="tk-dwe">没有思考和工具记录</div></div></div>';
    host.appendChild(dw); buzz(8); requestAnimationFrame(function(){ requestAnimationFrame(function(){ dw.classList.add('show'); }); });
    function close(){ dw.classList.remove('show'); setTimeout(function(){ dw.remove(); },360); }
    dw.querySelector('.scrim').addEventListener('click',close);
    /* [位置:phone-talk.js·drawer 拉高] [思考工具抽屉拉高] [10-28：原来只能往下拖关；接上拉高层。10-31：两档化——自然高度⇄满高，不记档，与 MCP / 子会话同一套拖动底层] [注释时间 2026-10-28；2026-10-31 两档化] */
    if(window.PH&&PH.sheetDrag) PH.sheetDrag(dw.querySelector('.pane'),close,{stretch:{natural:true}});
    dw.addEventListener('click',function(e){ if(e.target.closest('.dw-cp')) return; var h=e.target.closest('.stp .sh'); if(h){ var sp=h.parentNode; sp.classList.toggle('fold'); var dk=sp.getAttribute('data-k'); if(dk) DS[dk]=sp.classList.contains('fold')?'fold':'open'; } });
    if(live&&data){ LIVE.dw=dw; var tl0=dw.querySelector('.tl'); if(tl0){ Array.prototype.forEach.call(tl0.querySelectorAll('.stp.think .sb'),function(b){ b._seen=1; b.scrollTop=b.scrollHeight; }); tl0.scrollTop=tl0.scrollHeight; } }
    return dw;
  }
  list.addEventListener('click',function(e){
    var lv=e.target.closest('[data-live]'); if(lv){ if(LIVE.dw&&LIVE.dw.isConnected) return; if(LIVE.on&&ST) drawer(true,liveData()); else drawer(true); return; }
    var a=e.target.closest('.tk-sav'); if(!a) return;
    if(a.classList.contains('me')) return;
    if(a.getAttribute('data-rec')!=='1'){ toast('这几条没有思考和工具记录'); return; }
    var gk=a.getAttribute('data-g'); seen[gk]=1; a.classList.remove('rec');
    /* [位置:phone-talk.js·点头像开抽屉(live)] [AI 回复中点头像走真数据，没有就提示] [10-30：回复时点头像弹出的是示例数据（看图/读待办那份假步骤）。根因：直播头像 data-g='live' 不在 GR 里，掉到 drawer(true) 无数据分支，渲染写死的示例。现在直播头像与点气泡同路（liveData），抽屉已开不重复开，没数据给提示] [注释时间 2026-10-30] */
    if(gk==='live'){ if(LIVE.dw&&LIVE.dw.isConnected) return; if(LIVE.on&&ST) drawer(true,liveData()); else toast('还没有思考和工具记录'); return; }
    if(LIVE.on){ var rw=GR[gk]; if(rw&&rw._live&&ST){ drawer(true,liveData()); return; } if(rw){ drawer(false,dataOf(rw)); return; } }
    drawer(gk==='live');
  });
  var VA=null;   /* 我发的语音：真实音频的播放器，同一时间只播一条 */
  function vStop(vb){ if(VA){ try{ VA.pause(); }catch(e){} VA=null; } vb.classList.remove('playing'); vb._syn=0; clearTimeout(vb._t); var b=vb.querySelector('.vp'); b.innerHTML=I.play; b.setAttribute('aria-label','播放'); }
  /* [位置:phone-talk.js·vPlayAU] [语音气泡真音频播放（共用）] [10-30：AI 语音气泡接 TTS 时，把原来只有用户录音走的 new Audio→onended/onerror→play 三步抽成共用；src 播放行为零变化，onerr=音频加载失败、onblk=play() 被自动播放策略拦，提示分开传（保持原文案）] [注释时间 2026-10-30] */
  function vPlayAU(vb,url,onerr,onblk){ var au=new Audio(url); VA=au; au.onended=function(){ if(VA===au) vStop(vb); }; au.onerror=function(){ if(VA===au){ vStop(vb); if(onerr) onerr(); } }; var pr=au.play(); if(pr&&pr.catch) pr.catch(function(){ if(VA===au){ vStop(vb); if(onblk||onerr) (onblk||onerr)(); } }); }
  /* [位置:phone-talk.js·vTTSgo] [AI 语音气泡点击实时合成播放] [10-30：此前 AI 的 <voice> 气泡没有录音（data-tt），点击只播 sec 秒假动画不出声；现在点击实时 POST /heartbeat/admin/tts 合成真语音再播（不传 speaker=全局生效音色，与长按朗读同链路同音色）；同文本内存缓存 TTC（FIFO 40 条，口径同 chat.html _ttsCacheMap）再点秒播；合成中按钮转圈，再点一次=取消（playing 分支 vStop 收拾，回调发现已停只入缓存不播）；发送前剥标签与 liveAct('tts') 同一口径，文本截 1500=网关同款] [注释时间 2026-10-30] */
  var TTC=new Map();
  function vTTSgo(vb){
    var tt=String(vb.dataset.tt||'').replace(/<[^>]+>/g,'').trim();
    if(!tt){ vb._t=setTimeout(function(){ vStop(vb); },(+vb.dataset.sec||3)*1000); return; }
    var c=TTC.get(tt);
    if(c){ vPlayAU(vb,'data:audio/'+(c.f||'mp3')+';base64,'+c.a,function(){ toast('没读出来'); },function(){ toast('没读出来'); }); return; }
    vb._syn=1; var pk=vb, pb=vb.querySelector('.vp'); if(pb) pb.innerHTML='<i class="spin"></i>';
    P.net.post('/heartbeat/admin/tts',{text:tt.slice(0,1500)}).then(function(r){
        if(!r||!r.audio) throw new Error('');
        if(TTC.size>=40){ var fk=TTC.keys().next().value; if(fk!=null) TTC.delete(fk); }
        TTC.set(tt,{a:r.audio,f:r.format||'mp3'});
        if(!pk.isConnected||!pk.classList.contains('playing')) return;   /* 等待中已被停/已离开页面：只入缓存不播 */
        pk._syn=0; var pb2=pk.querySelector('.vp'); if(pb2) pb2.innerHTML=I.pause;
        vPlayAU(pk,'data:audio/'+(r.format||'mp3')+';base64,'+r.audio,function(){ toast('没读出来'); },function(){ toast('没读出来'); });
      }).catch(function(){ if(!pk.isConnected) return; vStop(pk); toast('没读出来'); });
  }
  /* [位置:phone-talk.js·实时区点击] [点「输入中」/ 正在打的字开抽屉] [实时区内容会被就地换掉：按下的节点到抬起时可能已不在，浏览器就不发 click。所以在容器 #tkLive 上用 pointerdown/up 自己判断：没怎么动、时间短就算点击；click 路径保留，已开着抽屉就不重复开] [注释时间 2026-10-21] */
  /* [位置:phone-talk.js·mnToggle] [折叠行展开/收起的唯一入口] [click 与 pointerup 两条路共用：翻 class、补建懒内容、记展开记忆（MO），一次点击只翻一次。11-15：思考行默认全折叠后，MC（手动收起记忆）没有存在意义，只留 MO。2026-11-19：trace 行流式期间（</trace> 未闭合、live 微光在）不许展开——内容没写完不外露，点了没反应；闭合后 live 类摘掉自然可点] [注释时间 2026-11-06 晚；2026-11-15 改；2026-11-19 改] */
  function mnToggle(rw){
    if(!rw||!rw.classList) return;
    if(rw.classList.contains('trace')&&rw.classList.contains('live')) return;   /* 2026-11-19：<trace> 标签没写完（live 微光）点了不展开，内容不流式外露；写完闭合后才能展开 */
    rw.classList.toggle('open');
    if(rw.classList.contains('open')) lzFill(rw);   /* 折叠时没建，点开这一下才建（零损失：内容一直在内存里） */
    var ri=rw.getAttribute('data-r'), rg=ri!=null?REF[+ri]:null, mkey=rw.getAttribute('data-mk')||(rg&&rg.key);
    if(mkey){ if(rw.classList.contains('open')) MO[mkey]=1; else delete MO[mkey]; }
    buzz(4);
  }
  var lvD=null, mhD=null, MNS={mk:null,at:0};
  list.addEventListener('pointerdown',function(e){
    MNS.mk=null;
    var mh=e.target.closest&&e.target.closest('.mn-h');
    mhD=(mh&&!(e.target.closest&&e.target.closest('.mn-cp')))?{x:e.clientX,y:e.clientY,t:Date.now(),mk:mh.parentNode.getAttribute('data-mk')}:null;
    lvD=(!MIN&&e.target.closest&&e.target.closest('#tkLive'))?{x:e.clientX,y:e.clientY,t:Date.now()}:null;
  });
  list.addEventListener('pointerup',function(e){
    /* [位置:phone-talk.js·mn-h pointerup] [行点击兜底] [11-06 晚：实时区每帧在改 DOM、还在贴底滚，按下的按钮到抬起时可能已经不在了，浏览器就不发 click——输出中的行点了没反应。这里自己判：没怎么动、时间短，就按当前命中的行翻一次；紧随其后的 click 用 data-mk 认出来跳过] [注释时间 2026-11-06 晚] */
    var d=mhD; mhD=null;
    if(d){ if(Date.now()-d.t<=900&&Math.abs(e.clientX-d.x)<=12&&Math.abs(e.clientY-d.y)<=12){
      var hit=e.target.closest&&e.target.closest('.mn-h'), rw=hit?hit.parentNode:null;
      if(rw&&rw.isConnected){ MNS.mk=rw.getAttribute('data-mk'); MNS.at=Date.now(); mnToggle(rw); }
    } }
    var v=lvD; lvD=null; if(!v||!ST) return; if(Math.abs(e.clientX-v.x)>10||Math.abs(e.clientY-v.y)>10||Date.now()-v.t>700) return; if(!(e.target.closest&&e.target.closest('#tkLive'))) return; if(e.target.closest&&e.target.closest('.mn-h')) return; if(LIVE.dw&&LIVE.dw.isConnected) return; drawer(true,LIVE.on&&ST?liveData():undefined); });
  list.addEventListener('pointercancel',function(){ mhD=null; lvD=null; },{passive:true});
  list.addEventListener('click',function(e){
    var mh=e.target.closest('.mn-h');
    if(mh){ var mkm=mh.parentNode&&mh.parentNode.getAttribute('data-mk');
      if(MNS.mk!=null&&mkm===MNS.mk&&Date.now()-MNS.at<700){ MNS.mk=null; return; }   /* pointerup 已经翻过，别再翻回去 */
      mnToggle(mh.parentNode); return; }
    var p=e.target.closest('.vp'); if(p){ var vb=p.closest('.vb'); if(vb.classList.contains('playing')){ vStop(vb); return; }
      Array.prototype.forEach.call(list.querySelectorAll('.vb.playing'),vStop); vb.classList.add('playing'); p.innerHTML=I.pause; p.setAttribute('aria-label','暂停'); buzz(5);
      /* [位置:phone-talk.js·实时区点击 vp] [语音气泡三路：录音真播 / AI 语音合成播 / 兜底假动画] [10-30：AI 的 <voice> 气泡（data-tt）从假动画改实时合成真语音；用户录音（data-src）行为不变，播放三步收进 vPlayAU] [注释时间 2026-10-30 改] */
      if(vb.dataset.src){ vPlayAU(vb,vb.dataset.src,function(){ toast('这条语音的录音已经清理了'); },function(){ toast('播不了'); }); return; }
      if(vb.dataset.tt){ vTTSgo(vb); return; }
      vb._t=setTimeout(function(){ vStop(vb); },(+vb.dataset.sec||3)*1000); return; }
    if(e.target.closest('[data-fdel]')){ buzz(6); var fd=e.target.closest('.tk-fail'); failDrop(fd&&fd.getAttribute('data-fid')); return; }
    if(e.target.closest('[data-vretry]')){ buzz(6); vRetry(e.target.closest('[data-vretry]').getAttribute('data-vretry')||''); return; }
    if(e.target.closest('[data-vdrop]')){ buzz(6); var did=e.target.closest('[data-vdrop]').getAttribute('data-vdrop')||'', dp=null;
      (LIVE.raw||[]).forEach(function(m){ if(m&&m.id===did) dp=m; }); if(dp) vDrop(dp); else if(LIVE.vpend) vDrop(LIVE.vpend); return; }
    var t=e.target.closest('.vt'); if(t){ if(t.classList.contains('wait')||t.classList.contains('err')) return; t.classList.toggle('open'); return; }
    var im=e.target.closest('.tk-img'); if(im) viewImg(im);
    var ti=e.target.closest('.tk-timg'); if(ti){ e.stopPropagation(); viewImg(ti); }
  });
  /* ---------- 图片查看器 ---------- */
  /* [位置:phone-talk.js·viewImg] [图片全屏查看：长图撑满+捏合缩放+拖动平移+双击缩放+惯性] [10-28：旧版只把图按 92%宽/80%高 contain 进来，长截图被等比缩成细条，字全糊；双击也只会中心放大2倍、不能拖动看边角。重做：超高图（撑满宽后高>视口86%）初始按宽度撑满、顶对齐，上下拖着看；双指捏合1~5倍、以指心为锚；单指拖动越界带阻尼，松手惯性滑行、滑到头回弹；双击以点击处为中心放大2.5倍/还原；单击关、飞回缩略图的动画保留。手势用 Pointer Events 自己管（touch-action:none 阻掉浏览器默认），1指拖和2指捏合中途互换无缝衔接；10-31：初始打开左右留边——长图/普通图统一 84% 宽（左右各 8%），不再长图撑满零留边，放大后的平移边界不变] [注释时间 2026-10-31 改] */
  function viewImg(im){
    var r=im.getBoundingClientRect(), hr=host.getBoundingClientRect();
    var ov=document.createElement('div'); ov.className='tk-lb';
    /* [位置:phone-talk.js·viewImg 关闭按钮] [大图右上角一颗 X，不用再猜「点哪都能关」] [11-13 #14：查看器只有单击空白 330ms 关、双击缩放，真机上单击关闭和拖动手势容易打架，也没有明确出口；加一颗固定 X（半透明玻璃底，随 .show 淡入），点它直达 closeIt，手势区 stage 在它下面不受影响] [注释时间 2026-11-14] */
    ov.innerHTML='<div class="scrim"></div><div class="stage"><div class="pic">'+im.innerHTML+'</div></div><button class="x" type="button" aria-label="关闭">'+I.sclose+'</button>';
    host.appendChild(ov); buzz(6);
    var pic=ov.querySelector('.pic'), stage=ov.querySelector('.stage'), img=pic.querySelector('img');
    var SW=hr.width, SH=hr.height, MAXS=5, FITW=0, FITH=0, ITY=0;
    var ar=(r.height||80)/(r.width||80);
    if(img&&img.naturalWidth&&img.naturalHeight) ar=img.naturalHeight/img.naturalWidth;
    /* 初始尺寸（10-31 已确定：初始左右各留 8%）：超高图 84% 宽顶对齐（上下拖）；普通图 contain 居中（84%宽/80%高留边） */
    function calcFit(){
      var Hf=SW*ar;
      if(Hf>SH*.86){ FITW=SW*.84; FITH=FITW*ar; ITY=FITH>SH?(FITH-SH)/2:0; }
      else { FITW=Math.min(SW*.84,SH*.8/ar); FITH=FITW*ar; ITY=0; }
    }
    calcFit();
    pic.style.width=FITW+'px'; pic.style.height=FITH+'px';
    var sc=1, tx=0, ty=ITY, raf=0;
    function T(){ return 'translate('+(FITW/-2+tx)+'px,'+(FITH/-2+ty)+'px) scale('+sc+')'; }
    function setT(){ pic.style.transform=T(); }
    function bounds(){ return [Math.max(0,(FITW*sc-SW)/2), Math.max(0,(FITH*sc-SH)/2)]; }
    function clamp(v,lo,hi){ return v<lo?lo:(v>hi?hi:v); }
    setT();
    function stopAnim(){ if(raf){ cancelAnimationFrame(raf); raf=0; } }
    function glide(ns,ntx,nty,ms,after){
      stopAnim(); var s0=sc, x0=tx, y0=ty, t0=performance.now();
      function step(now){ var k=Math.min(1,(now-t0)/ms); k=1-Math.pow(1-k,3);
        sc=s0+(ns-s0)*k; tx=x0+(ntx-x0)*k; ty=y0+(nty-y0)*k; setT();
        if(k<1){ raf=requestAnimationFrame(step); } else { raf=0; if(after) after(); } }
      raf=requestAnimationFrame(step);
    }
    /* 松手后的归位：缩放钳回 1~5，位移钳回边界内 */
    function rebound(ms){
      var ns=clamp(sc,1,MAXS);
      var mx=Math.max(0,(FITW*ns-SW)/2), my=Math.max(0,(FITH*ns-SH)/2);
      glide(ns,clamp(tx,-mx,mx),clamp(ty,-my,my),ms||300);
    }
    /* 惯性滑行：速度指数衰减，撞边硬停，最后 rebound 收尾 */
    function fling(){
      var sp=Math.hypot(vx,vy);
      if(sp<.08){ rebound(); return; }
      stopAnim(); var last=performance.now(), n=0;
      function step(now){
        var dt=Math.min(48,now-last); last=now; n++;
        tx+=vx*dt; ty+=vy*dt; var k=Math.pow(.94,dt/16.7); vx*=k; vy*=k;
        var b=bounds();
        if(tx>b[0]){ tx=b[0]; vx=0; } if(tx<-b[0]){ tx=-b[0]; vx=0; }
        if(ty>b[1]){ ty=b[1]; vy=0; } if(ty<-b[1]){ ty=-b[1]; vy=0; }
        setT();
        if(Math.hypot(vx,vy)>.08&&n<120){ raf=requestAnimationFrame(step); }
        else { raf=0; rebound(240); }
      }
      raf=requestAnimationFrame(step);
    }
    /* 双击：放大 2.5 倍以点击处为中心（锚点公式 t'=k*t+(1-k)*c，捏合同款）；已放大则回初始 */
    function toggle(px,py){
      if(sc>1.05){ glide(1,0,ITY,300); return; }
      var ns=2.5, cx=px-hr.left-SW/2, cy=py-hr.top-SH/2, k=ns/sc;
      var mx=Math.max(0,(FITW*ns-SW)/2), my=Math.max(0,(FITH*ns-SH)/2);
      glide(ns,clamp(k*tx+(1-k)*cx,-mx,mx),clamp(k*ty+(1-k)*cy,-my,my),320);
    }
    var PTR=new Map(), pin=null, base=null, moved=false, vx=0, vy=0, lx=0, ly=0, lt=0;
    var dblT=0, dblX=0, dblY=0, closeT=0, closing=false;
    function openAnims(){ if(pic.getAnimations) pic.getAnimations().forEach(function(a){ try{ a.finish(); }catch(e){} }); }
    stage.addEventListener('pointerdown',function(e){
      if(closing) return;
      openAnims(); stopAnim(); clearTimeout(closeT);   /* 双击判定靠 dblT 记上一击时刻，这里不能清它，只取消未决的单击关闭 */
      if(stage.setPointerCapture){ try{ stage.setPointerCapture(e.pointerId); }catch(err){} }
      PTR.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(PTR.size===1){ base={x:e.clientX,y:e.clientY,tx:tx,ty:ty}; moved=false; vx=vy=0; lx=e.clientX; ly=e.clientY; lt=performance.now(); }
      else if(PTR.size===2){ base=null; moved=true;
        var p=Array.from(PTR.values());
        pin={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1, s:sc, tx:tx, ty:ty}; }
    });
    stage.addEventListener('pointermove',function(e){
      var pt=PTR.get(e.pointerId); if(!pt) return; pt.x=e.clientX; pt.y=e.clientY;
      if(PTR.size>=2&&pin){
        var p=Array.from(PTR.values());
        var d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1;
        var mx2=(p[0].x+p[1].x)/2, my2=(p[0].y+p[1].y)/2;
        var ns=pin.s*d/pin.d;
        if(ns>MAXS) ns=MAXS+(ns-MAXS)*.25;   /* 越界阻尼，松手 rebound 拉回 */
        if(ns<.5) ns=.5+(ns-.5)*.25;
        var k=ns/pin.s, cx=mx2-hr.left-SW/2, cy=my2-hr.top-SH/2;
        sc=ns; tx=k*pin.tx+(1-k)*cx; ty=k*pin.ty+(1-k)*cy; setT();
      } else if(base&&PTR.size===1){
        var dx=e.clientX-base.x, dy=e.clientY-base.y;
        if(!moved&&Math.hypot(dx,dy)>6) moved=true;
        if(moved){
          var b=bounds();
          tx=base.tx+dx; ty=base.ty+dy;
          if(tx>b[0]) tx=b[0]+(tx-b[0])*.35; if(tx<-b[0]) tx=-b[0]+(tx+b[0])*.35;
          if(ty>b[1]) ty=b[1]+(ty-b[1])*.35; if(ty<-b[1]) ty=-b[1]+(ty+b[1])*.35;
          var now=performance.now(), dt=now-lt||16;
          vx=.8*((e.clientX-lx)/dt)+.2*vx; vy=.8*((e.clientY-ly)/dt)+.2*vy;
          lx=e.clientX; ly=e.clientY; lt=now; setT();
        }
      }
    });
    function endPtr(e){
      if(!PTR.has(e.pointerId)) return;
      PTR.delete(e.pointerId);
      if(PTR.size===1){ pin=null;   /* 两指收成一指：拿剩下的指头重设拖动基准，无缝接着拖 */
        var rest=Array.from(PTR.values())[0];
        base={x:rest.x,y:rest.y,tx:tx,ty:ty}; moved=true; vx=vy=0; lx=rest.x; ly=rest.y; lt=performance.now(); return; }
      if(PTR.size) return;
      pin=null;
      var now=performance.now();
      if(!moved){   /* 没拖动：双击切换缩放；单击延迟关（等双击窗口过去） */
        if(dblT&&now-dblT<300&&Math.hypot(e.clientX-dblX,e.clientY-dblY)<30){ clearTimeout(closeT); dblT=0; toggle(e.clientX,e.clientY); }
        else { dblT=now; dblX=e.clientX; dblY=e.clientY; closeT=setTimeout(closeIt,330); }
        return;
      }
      dblT=0; fling();
    }
    stage.addEventListener('pointerup',endPtr);
    stage.addEventListener('pointercancel',endPtr);
    /* 长图打开时图还没加载完（naturalWidth=0 拿的是缩略图比例兜底）：加载完且没开始摸就按真实比例重摆 */
    if(img&&!img.naturalWidth) img.addEventListener('load',function(){
      if(closing||PTR.size||!img.naturalWidth) return;
      ar=img.naturalHeight/img.naturalWidth; calcFit();
      pic.style.width=FITW+'px'; pic.style.height=FITH+'px';
      sc=1; tx=0; ty=ITY; setT();
    },{once:true});
    /* 打开：从缩略图位置飞到初始态；动画中一摸就 finish 跳到终态接管手势 */
    var flyFrom='translate('+(r.left+r.width/2-hr.left-SW/2)+'px,'+(r.top+r.height/2-hr.top-SH/2)+'px) scale('+(r.width/FITW)+')';
    pic.style.transform=flyFrom;
    var openA=pic.animate([{transform:flyFrom},{transform:T()}],{duration:340,easing:'cubic-bezier(.2,.9,.25,1)'});
    openA.onfinish=function(){ if(!closing) setT(); };
    requestAnimationFrame(function(){ ov.classList.add('show'); });
    ov.querySelector('.x').addEventListener('click',function(e){ e.stopPropagation(); buzz(6); closeIt(); });
    function closeIt(){
      if(closing) return; closing=true; clearTimeout(closeT); stopAnim();
      ov.classList.remove('show');
      var a=pic.animate([{transform:pic.style.transform||T()},{transform:flyFrom}],{duration:280,easing:'cubic-bezier(.3,.7,.4,1)'});
      a.onfinish=function(){ ov.remove(); };
      setTimeout(function(){ if(ov.parentNode) ov.remove(); },400);
    }
  }

  /* ---------- 通用底板 ---------- */
  /* [位置:phone-talk.js·软键盘避让工具] [统一判断可输入控件、获取当前软键盘高度、将聚焦控件滚入可视区中央，供 .ses-pop / .tk-page / 闹钟弹窗共用] [注释时间 2026-11-23] */
  function isKbInput(el){
    if(!el||!el.tagName) return false;
    var tag=el.tagName;
    if(tag==='TEXTAREA'||el.isContentEditable) return true;
    if(tag==='INPUT'){
      var ty=(el.type||'text').toLowerCase();
      return !/^(button|submit|reset|checkbox|radio|range|color|file|hidden|image)$/.test(ty);
    }
    return false;
  }
  function kbNow(){
    if(!window.visualViewport) return 0;
    return Math.max(0,Math.round((window.innerHeight||document.documentElement.clientHeight||0)-visualViewport.height-visualViewport.offsetTop));
  }
  function scrollElCenter(el){
    if(!el||!el.isConnected) return;
    try{ el.scrollIntoView({block:'center',behavior:'smooth'}); }catch(e){ try{ el.scrollIntoView(false); }catch(_){} }
  }
  /* [位置:phone-talk.js·sheet] [通用底板] [cls 决定外观；opts.single 时同一种抽屉只留一层——2026-10-27报「关闭要关五层」：连点几次「查看过程」，每点一次就新建一层，关闭只关最上面那层，底下还压着几层。按最后一个 class（sub / mcp）认同类，开新的先把旧的收掉] [opts.stretch 交给 sheetDrag 做「上拉变高」，改高度不改位移，内容靠 flex:1 一起变高] [2026-11-23 补：默认接入 P.kb 键盘避让（含 stateCfg/prmSheet/颜文字/表情描述/搜索等所有带输入框弹窗），关窗自动注销；已自带键盘避让的弹窗传 opts.noKb=true] [注释时间 2026-11-23 改] */
  function sheet(inner,cls,fn,opts){
    opts=opts||{};
    if(opts.single&&cls){
      var tag=cls.split(' ').pop();
      /* 2026-10-27 批1：原来只扫 .show——新抽屉要等两帧才有 .show，同一次点击里连开几层互相看不见；改按「没关闭」判定（pop._closed） */
      Array.prototype.forEach.call(host.querySelectorAll('.ses-pop'),function(o){
        if(!o.classList||!o.classList.contains(tag)||o._closed) return;
        /* 子进程抽屉的 class 是「opts mcp sub」，也带 mcp——开 MCP 面板时别把仍在用的子进程抽屉误关掉 */
        if(tag==='mcp'&&o.classList.contains('sub')) return;
        if(o._close) o._close(); else { o.classList.remove('show'); setTimeout(function(){ if(o.parentNode) o.remove(); },300); }
      });
    }
    var pop=document.createElement('div'); pop.className='ses-pop'+(cls?' '+cls:''); pop.innerHTML='<div class="scrim"></div><div class="box">'+inner+'</div>';
    host.appendChild(pop); buzz(6); requestAnimationFrame(function(){ requestAnimationFrame(function(){ if(!pop._closed) pop.classList.add('show'); }); });
    var closed=false, kbOff=null, kbFt1=0, kbFt2=0;
    function close(){ if(closed) return; closed=true; pop._closed=true; clearTimeout(kbFt1); clearTimeout(kbFt2); if(kbOff){ kbOff(); kbOff=null; } pop.classList.remove('show'); setTimeout(function(){ if(pop.parentNode) pop.remove(); },300); }
    pop._close=close;
    /* [位置:phone-talk.js·sheet 关闭] [点一下就能关] [10-27：抽屉还是要点两下才关闭。click 在 iOS 上可能被轻点判定吞掉（第一下当"起手"、第二下才成 click），改成自己判 pointerdown→pointerup：位移 <12px 且 <800ms 就算点了一下，直接关；click 只当兜底，closed 守卫防重复触发动两次] [注释时间 2026-10-27] */
    var sc=pop.querySelector('.scrim'), tx=0, ty=0, tt=0;
    sc.addEventListener('pointerdown',function(e){ tx=e.clientX; ty=e.clientY; tt=Date.now(); });
    sc.addEventListener('pointerup',function(e){
      if(Math.abs(e.clientX-tx)>12||Math.abs(e.clientY-ty)>12) return;
      if(Date.now()-tt>800) return;
      close();
    });
    sc.addEventListener('click',close);
    var box0=pop.querySelector('.box');
    if(!opts.noKb&&box0){
      function applyPopKb(kb){
        if(closed||!pop.isConnected){ if(kbOff){ kbOff(); kbOff=null; } return; }
        kb=Math.max(0,Math.round(kb||0));
        if(kb>60){
          var ae=document.activeElement;
          var hasIn=!!box0.querySelector('input,textarea,[contenteditable="true"]');
          if(!hasIn&&!(ae&&box0.contains(ae)&&isKbInput(ae))) return;
          box0.style.top='calc(var(--sat, 0px) + 12px)';
          box0.style.bottom='auto';
          box0.style.maxHeight='calc(100% - var(--sat, 0px) - '+(kb+24)+'px)';
          if(pop.classList.contains('tk-cfg')) box0.style.transform='none';
          if(ae&&box0.contains(ae)&&isKbInput(ae)){
            clearTimeout(kbFt1);
            kbFt1=setTimeout(function(){ if(!closed&&document.activeElement===ae) scrollElCenter(ae); },80);
          }
        } else {
          box0.style.top='';
          box0.style.bottom='';
          box0.style.maxHeight='';
          if(pop.classList.contains('tk-cfg')) box0.style.transform='';
        }
      }
      box0.addEventListener('focusin',function(e){
        var t=e.target; if(!isKbInput(t)) return;
        var cur=kbNow(); if(cur>60) applyPopKb(cur);
        clearTimeout(kbFt1); clearTimeout(kbFt2);
        kbFt1=setTimeout(function(){ if(!closed&&document.activeElement===t) scrollElCenter(t); },120);
        kbFt2=setTimeout(function(){ if(!closed&&document.activeElement===t) scrollElCenter(t); },340);
      });
      if(P.kb) kbOff=P.kb(applyPopKb);
      var curKb=kbNow(); if(curKb>60) applyPopKb(curKb);
    }
    if(fn) fn(box0,close);
    if(opts.stretch&&P.sheetDrag) P.sheetDrag(box0,close,{stretch:opts.stretch});
    else if(opts.drag&&P.sheetDrag) P.sheetDrag(box0,close);
    return pop;
  }

  /* ---------- 头像 / 名字胶囊：设定、模型、会话头像、回车发送、分气泡（10-28 拆掉的「他的消息按空行分气泡」2026-11-02 加回：只此一项、只气泡主题显示） ---------- */
  /* [位置:phone-talk.js·bfWire/avSheet 分支自行] [聊天页看分支出处、跳回原会话] [11-10：分支会话的「这个会话」面板最上面多一行「分支自 原会话名 ›」，点了关面板、切到原会话；原会话已删除就灰着写、不可点；数据来自会话列表的 branch_from，经 P.talkCtx.branch 带进来] [注释时间 2026-11-10] */
  function bfWire(box,close){ var go=box.querySelector('[data-bfgo]'); if(!go||!CTX0||!CTX0.branch) return; go.addEventListener('click',function(){ var b=CTX0.branch; buzz(8); close(); setTimeout(function(){ if(P.chats&&P.chats.switchTo) P.chats.switchTo(b.id,b.name); },260); }); }
  function avSheet(){
    var BR=LIVE.on&&CTX0&&CTX0.branch;
    sheet('<div class="hd"><span>这个会话</span></div><div class="opt">'+
      (BR?(BR.gone?'<div class="ro bfr gone"><label>分支自</label><span>原会话已删除</span></div>':'<div class="ro bfr"><label>分支自</label><button class="bfb tap" type="button" data-bfgo><em>'+esc(BR.name||'原会话')+'</em>'+I.chv+'</button></div>'):'')+
      /* [位置:phone-talk.js·avSheet 会话头像行] [真会话也能换会话头像] [10-29：这行以前只在没进会话时显示、「换一张」还没接事件（死按钮），真会话根本看不到；现在真会话显示这行，行为接下面的 savWire] [注释时间 2026-10-29] */
      (LIVE.on?'<div class="tk-avrow"><div class="av ai" id="tkSav" data-l="'+esc(Array.from(String(NAMES.ai||'').trim())[0]||'助')+'"></div><div><b>会话头像</b></div><button class="sv tap" id="tkSavB">换一张</button></div>':'')+
      '<div class="ro"><label>设定</label><select id="tkPs">'+(LIVE.on?'<option value="">跟随默认</option>':'<option>默认</option>')+'</select></div>'+
      '<div class="tk-grp" id="tkGrp">'+
      '<div class="ro"><label>模型</label><select id="tkMd" class="mdw">'+(LIVE.on?'<option value="">跟随默认</option>':'<option>跟随默认</option><option>claude-sonnet</option><option>deepseek-flash</option>')+'</select></div>'+
      /* [位置:phone-talk.js·avSheet Claude思考行] [Claude思考档位] [只有本会话实际会用的模型走 Claude 时才显示这行（跟随默认也按实际解析结果判断）；默认/低/中/高存在会话配置，别的模型整行隐藏] [注释时间 2026-10-28] */
      /* 11-04：模型 + 模型专属设置（现在是 Claude 思考/缓存）圈成一块，只在这块上下各一条分割线（组内不再画行线）；不是 Claude 时只剩模型一行，恢复普通行线 */
      (LIVE.on&&!SUBMIN?'<div class="ro" id="tkCtRow" style="display:none"><label>Claude 思考</label><select id="tkCt"><option value="off">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>':'')+
      /* [位置:phone-talk.js·avSheet Grok思考行] [Grok思考档位] [11-16：只在本会话实际会用的模型是 grok-4.x 时显示；默认=不发参数（厂商默认 high，4.6/4.7 不能关思考）；「极高」只对 4.6 及以上出现（见 liveAv·applyGk）] [注释时间 2026-11-16] */
      (LIVE.on&&!SUBMIN?'<div class="ro" id="tkGkRow" style="display:none"><label>Grok 思考</label><select id="tkGk"><option value="off">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="xhigh">极高</option></select></div>':'')+
      (LIVE.on&&!SUBMIN?'<div class="ro tg" id="tkCcRow" style="display:none"><label>Claude 加强缓存<small>开=缓存 1 小时，关=5 分钟</small></label><i class="sw" id="tkCc"></i></div>':'')+
      /* [位置:phone-talk.js·avSheet GLM历史思考行] [GLM历史思考开关] [11-15：只有实际模型是智谱 GLM 时才显示本行；开=保留式思考回传，关=出口剥离历史思考省 token] [注释时间 2026-11-15] */
      (LIVE.on&&!SUBMIN?'<div class="ro tg" id="tkGrRow" style="display:none"><label>GLM 历史思考<small>开=回传，关=不回传</small></label><i class="sw" id="tkGr"></i></div>':'')+
      '</div>'+
      (LIVE.on&&!SUBMIN?'<div class="ro"><label>聊天主题</label><select id="tkTh"><option value="">跟随默认</option><option value="bubble">气泡</option><option value="min">极简</option></select></div>':'')+
      /* [位置:phone-talk.js·avSheet 更多选项折叠区] [底部 4/5 个开关默认折叠] [11-21：回车直接发送/分气泡/时间缀/距上一轮/Trace 剥离默认收进「更多选项」折叠区，Trace 剥离去掉副标题小字] [注释时间 2026-11-21] */
      '<div class="av-more" id="tkAvMore">'+
        '<button class="ro av-more-hd tap" type="button" aria-expanded="false"><label>更多选项</label><svg class="ch" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>'+
        '<div class="av-more-bd"><div class="av-more-in">'+
          '<div class="ro tg'+(OPT.enterSend?' on':'')+'" data-k="enterSend"><label>回车直接发送</label><i class="sw"></i></div>'+
          (!MIN?'<div class="ro tg'+(OPT.splitAI?' on':'')+'" data-k="split"><label>他的消息按空行分气泡</label><i class="sw"></i></div>':'')+
          (LIVE.on?'<div class="ro tg" id="tkTt"><label>时间缀给AI</label><i class="sw"></i></div>':'')+
          (LIVE.on?'<div class="ro tg" id="tkEl"><label>距上一轮给AI</label><i class="sw"></i></div>':'')+
          (LIVE.on?'<div class="ro tg" id="tkTr"><label>Trace 剥离</label><i class="sw"></i></div>':'')+
        '</div></div>'+
      '</div>'+
    '</div>','opts',function(box,close){ P.markAv&&P.markAv(); bfWire(box,close); if(LIVE.on) liveAv(box);
      var am=box.querySelector('#tkAvMore'), amh=am&&am.querySelector('.av-more-hd');
      if(amh) amh.addEventListener('click',function(){ var on=am.classList.toggle('open'); amh.setAttribute('aria-expanded',on?'true':'false'); buzz(5); });
      box.addEventListener('click',function(e){ var t=e.target.closest('.sw')&&e.target.closest('.ro.tg[data-k]'); if(!t) return; var k={enterSend:'enterSend',split:'splitAI'}[t.getAttribute('data-k')]; OPT[k]=!OPT[k]; t.classList.toggle('on',OPT[k]); if(k==='enterSend'){ try{ localStorage.setItem(ENTER_KEY,OPT[k]?'1':'0'); }catch(e){} ekh(); } if(k==='splitAI'){ try{ localStorage.setItem(SPLIT_KEY,OPT[k]?'1':'0'); }catch(e){} } buzz(6); render(); }); });
  }
  $('#tkAv',win).addEventListener('click',avSheet); $('#tkNm',win).addEventListener('click',avSheet);

  /* ---------- 「…」 ---------- */
  /* ---------- 当前请求上下文：读网关最后一次真正发出去的 messages，按 ## 块标题切分、同款公式估 token ---------- */
  var CTX=[];
  /* [位置:phone-talk.js·BLKN] [当前请求上下文的口径] [只认真实块头：人设（无块头）+ 永久上下文（System Instructions，里面套着 Context Assembly 说明）+ 跨窗口那几块 + 唤醒 + 最近对话；Core Identity / Long-term Understanding 留英文] [注释时间 2026-10-22 改] */
  var BLKN={'System Instructions':'永久上下文','Core Identity':'Core Identity','Long-term Understanding':'Long-term Understanding','Earlier Days':'日记','Starred Dialog':'标星对话','Notebook Index':'笔记本目录','Pinned Notes':'置顶笔记','Memory Keywords':'记忆池关键词','Possibly Relevant Memories':'相关记忆','Conversation State':'状态机','Carried-over Dialog':'继承对话','Inherited State':'继承状态','Original Conversation History':'最近对话原文'};
  /* 1021：没有 ## 块头的 system 消息，按内容认出来头再命名（原来一律叫「系统指令」，唤醒记录一多就十几行同名）。
     10-29 #46 追加：兜底名「其他注入」取消——人设文件开头五花八门（---、# 标题、自我介绍），照开头几个字映射认不全，认不出的一律算人设；
     原来的 isFirst 判断还写反了（调用传 blocks.length，第一条 system 时传 0=falsy，反而在第一条上拿兜底名），一并消灭。 */
  function nameRaw(t){
    if(/^这是一次系统唤醒/.test(t)) return '唤醒';
    if(/^(发送成功|本次未推送)/.test(t)) return '唤醒';
    if(/【我们】|【最近】|【约定】/.test(t)) return '状态机';
    if(/^你是陪伴型AI|^你叫|^你是/.test(t)) return '人设';
    if(/How to Treat the Layers of Context/.test(t)) return '上下文引导';
    if(/^\[?唤醒\]?/.test(t)) return '唤醒';
    if(/日记|diary/i.test(t) && t.length < 200) return '日记回执';
    return '人设';
  }
  function estTok(t){ var s=String(t==null?'':t),cj=0,ot=0;
    for(var i=0;i<s.length;i++){ var c=s.charCodeAt(i);
      if((c>=0x4e00&&c<=0x9fff)||(c>=0x3400&&c<=0x4dbf)||(c>=0xf900&&c<=0xfaff)||(c>=0x3000&&c<=0x303f)) cj++; else ot++; }
    return cj+Math.ceil(ot/4); }
  /* [位置:phone-talk.js·thinkOf] [思考链字数] [10-29 #46：她的腹稿（reasoning_content）和 Claude 思考块随请求发给上游、照算 token，后端存档已保留（本次另有后端改动），这里把字数并进「最近对话」行——只数思考文本，redacted_thinking 的密文与 text 块不算（后者已在正文里，不重复计）] [注释时间 2026-10-29] */
  function thinkOf(m){
    var ps=[];
    if(m.reasoning_content) ps.push(String(m.reasoning_content));
    (m.thinking_blocks||[]).forEach(function(b){ if(b&&b.type==='thinking'&&b.thinking) ps.push(b.thinking); });
    (m.anthropic_content_blocks||[]).forEach(function(b){ if(b&&b.type==='thinking'&&b.thinking) ps.push(b.thinking); });
    return ps.join('\n');
  }
  var SECN=Object.keys(BLKN);
  function splitSections(t){
    var marks=[];
    SECN.forEach(function(en){
      var re=new RegExp('^##(?!#)\\s*'+en.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\w])[^\\n]*$','gm'), mm;
      while((mm=re.exec(t))) marks.push({ i: mm.index, en: en });
    });
    if(!marks.length) return null;
    marks.sort(function(a,b){ return a.i-b.i; });
    var out=[];
    if(marks[0].i>0){ var pre=t.slice(0,marks[0].i).trim(); if(pre) out.push(['人设',pre]); }
    marks.forEach(function(m,k){ var end=k+1<marks.length?marks[k+1].i:t.length; var seg=t.slice(m.i,end).trim(); if(seg) out.push([BLKN[m.en]||m.en,seg]); });
    return out;
  }
  function ctxSplit(msgs,tl){
    /* [位置:phone-talk.js·ctxSplit] [统计口径修复] [10-29 #46：工具的入参和结果之前混进「最近对话」的 token、条数又不计，统计对不上——①assistant 的 tool_calls 入参（function.arguments）计入 ②工具结果单独一行「工具调用 N 次」（入参+结果合计）③「最近对话」只算对话消息；10-29 #46 追加：思考链（reasoning_content/思考块）字数并入「最近对话」，条数不加] [注释时间 2026-10-29] */
    var blocks=[], chatN=0, chatTok=0, toolN=0, toolTok=0;
    (msgs||[]).forEach(function(m){
      var t=rawText(m);
      if(m.role==='system'){
        /* 1021：只认已知块头。块内的小标题（Tag Usage、Tool Usage Rules、每篇日记的日期）也写成 ##，
           旧写法遇到 ## 就切，导致它们全变成独立条目、把统计表撑成几十行。 */
        var secs=splitSections(t);
        if(secs){ secs.forEach(function(x){ blocks.push([x[0],'',estTok(x[1]),1]); }); }
        else if(t.trim()){ blocks.push([nameRaw(t),'',estTok(t),1]); }
        return;
      }
      if(m.role==='user'||m.role==='assistant'){
        chatN++; chatTok+=estTok(t)+estTok(thinkOf(m));   /* 10-29 #46：思考链并进最近对话 */
        (m.tool_calls||[]).forEach(function(c){ toolN++; toolTok+=estTok((c.function&&c.function.arguments)||''); });
      }
      else if(m.role==='tool'){ toolN++; toolTok+=estTok(t); }
    });
    if(tl&&tl.n) blocks.push(['工具定义',tl.n+' 个',estTok(tl.text)]);
    if(chatN) blocks.push(['最近对话',chatN+' 条',chatTok]);
    if(toolN) blocks.push(['工具调用',toolN+' 次',toolTok]);
    return blocks;
  }
  /* [位置:phone-talk.js·ctxKind] [快照类型标注] [10-29 #46：这份统计是该会话最近一次发出去的请求，可能是聊天、也可能是唤醒留下的——标出来+时间，免得把唤醒快照当聊天统计看；10-29 #46 追加：不再在展开区单独占一行，并进标题「约 N tok」后面的小字] [注释时间 2026-10-29] */
  function ctxKind(msgs){
    var m0=(msgs||[])[0];
    if(!m0) return '';
    var t=rawText(m0);
    if(/^这是一次系统唤醒|^发送成功|^本次未推送/.test(t)) return '唤醒请求';
    return '聊天请求';
  }
  /* [位置:phone-talk.js·upNote] [上下文页标明「估算」并给出上游最近一次实报] [10-23 需求 50：这一页的总数是前端按字数估的（中日韩字 1 个、其余 4 个字符 1 个）；每条消息上的 token 是上游实际报回来的 prompt_tokens（含工具定义、按真实分词算）。原来这一页只数了 messages 里的文字，漏了工具定义（本站 30 多个工具，光定义就一万多）所以对不上；现在后端 /admin/logs/context 把该会话快照里的工具定义一并带回，这一页多一行「工具定义」，总数前加「约」，底部补一行最近一次上游实报，剩下的差别只是估算与真实分词的出入] [注释时间 2026-10-23] */
  /* [位置:phone-talk.js·upNote / upMsg] [上下文页的「查看 Token」按钮] [10-24：原来这里是一段字（估算说明 + 上游最近一次实报），样式不好看；改成和「看原文」一样的按钮，点开就是原来长按菜单里 Token 那个弹窗（长按菜单里的 Token 已去掉）；数据还是最近一条带上游用量的回复；点弹窗外面只关弹窗，这一页的面板留着] [注释时间 2026-10-24] */
  function upMsg(){ try{ var r=LIVE.raw||[]; for(var i=r.length-1;i>=0;i--){ var m=r[i]; if(m&&m.role==='assistant'&&m.tokens&&m.tokens.prompt_tokens) return m; } }catch(e){} return null; }
  function upNote(){ return '<button class="tk-raw tap" data-tokview>查看 Token</button>'; }
  function ctxPaint(ov,blocks,fail,meta){
    var acc=ov&&ov.querySelector('.tk-acc[data-k="ctx"]'); if(!acc) return;
    var body=acc.querySelector('.tk-body>div'), small=acc.querySelector('.tk-sec small');
    if(fail){ if(body) body.innerHTML='<div class="meta">读不到后台的请求记录。</div>'; if(small) small.textContent='没连上'; return; }
    if(!blocks.length){ if(body) body.innerHTML='<div class="meta">这个会话还没发过请求。</div>'; if(small) small.textContent='0 tok'; return; }
    /* 1021：同名块合并成一行，token 累加 */
    var merged=[], idx={};
    blocks.forEach(function(b){ var k=b[0]; if(idx[k]==null){ idx[k]=merged.length; merged.push([k,'',b[2],1]); } else { merged[idx[k]][2]+=b[2]; merged[idx[k]][3]++; } });
    /* 10-29 #46 追加：人设固定放第一行（人设本来就是第一条注入，防止个别会话里被别的块挤到后面） */
    for(var mi=0;mi<merged.length;mi++){ if(merged[mi][0]==='人设'){ if(mi>0) merged.unshift(merged.splice(mi,1)[0]); break; } }
    blocks=merged;
    var tot=blocks.reduce(function(a,b){ return a+b[2]; },0)||1;
    /* 10-29 #46 追加：快照时间/请求类型并进标题小字——「约 147,787 tok · 快照 16:45 · 聊天请求」，展开区里不再单独一行 */
    if(small) small.textContent='约 '+tot.toLocaleString()+' tok'+(meta?' · '+meta:'');
    if(!body) return;
    body.innerHTML='<div class="tk-bar">'+blocks.map(function(c,i){ return '<i style="--w:'+(c[2]/tot*100).toFixed(2)+'%;--k:'+(i%8)+'"></i>'; }).join('')+'</div>'+
      blocks.map(function(c,i){ return '<div class="tk-cr"><s style="--k:'+(i%8)+'"></s><b>'+esc(c[0])+'</b>'+(c[1]?'<small>'+esc(c[1])+'</small>':'')+'<em>'+c[2].toLocaleString()+'</em></div>'; }).join('')+
      upNote()+'<button class="tk-raw tap">看原文</button>';
  }
  /* [位置:phone-talk.js·ctxUrl] [当前请求上下文按会话取] [只看当前会话自己最近一次真正发出去的请求，不再读全局最后一次（那个可能是别的会话/唤醒/测试）；后端 /admin/logs/context?session_id= 按会话落盘] [注释时间 2026-10-21] */
  function ctxUrl(){ var sid=stSid(); return sid?'/heartbeat/admin/logs/context?session_id='+encodeURIComponent(sid):null; }
  function ctxLive(ov){
    if(!P.net||!P.net.get){ ctxPaint(ov,null,true); return; }
    var cu=ctxUrl(); if(!cu){ ctxPaint(ov,[],false); return; }
    P.net.get(cu,{noLogin:true}).then(function(d){
      var msgs=(d&&d.messages)||[]; CTX=ctxSplit(msgs,{n:d&&d.tools_n,text:d&&d.tools_text});
      var mt=d&&d.captureTime?new Date(d.captureTime):null, meta='';
      if(mt&&!isNaN(mt.getTime())) meta='快照 '+('0'+mt.getHours()).slice(-2)+':'+('0'+mt.getMinutes()).slice(-2)+(ctxKind(msgs)?' · '+ctxKind(msgs):'');
      ctxPaint(ov,CTX,false,meta);
    },function(){ ctxPaint(ov,null,true); });
  }
  var X=P.xinject;
  function sec(k,ic,t,sub,body){ return '<div class="tk-acc" data-k="'+k+'"><button class="tk-sec" data-s="'+k+'"><span class="ic">'+ic+'</span><span class="tx"><b>'+t+'</b><small>'+sub+'</small></span>'+I.chev+'</button><div class="tk-body"><div>'+body+'</div></div></div>'; }
  function moreMenu(open){
    var ov=document.createElement('div'); ov.className='tk-ov tk-mo';
    ov.innerHTML='<div class="scrim"></div><div class="tk-pan">'+
      /* [位置:phone-talk.js·moreMenu 搜索项] [会话内消息搜索入口] [用户 随手记第25条：给会话内加一个搜索功能。在右上角的菜单里] [注释时间 2026-11-13] */
      '<button class="tk-sec go" data-go="search" type="button"><span class="ic">'+I.search+'</span><span class="tx"><b>搜索</b></span>'+I.chev+'</button>'+
      sec('ctx',I.ctx,'当前请求上下文','读取中…','<div class="meta">读取中…</div>')+
      sec('xw',I.cross,'跨窗口设置',LIVE.on?'读取中…':'—',
        (X?X.html():''))+
      /* [位置:phone-talk.js·moreMenu 闹钟项] [常驻一项，只显示标题] [11-09：闹钟入口收进「…」菜单；没有闹钟也在，不显示数量；点开是居中的闹钟弹窗，长按这一项往外拖会变回悬浮小球] [注释时间 2026-11-09] */
      '<button class="tk-sec go alm" data-go="alarm" type="button"><span class="ic">'+I.alarm+'</span><span class="tx"><b>闹钟</b></span>'+I.chev+'</button>'+
      /* [位置:phone-talk.js·moreMenu 在改文件项] [仅已收纳且有登记时出现] [11-16：默认不显示；文案只用「在改文件」加份数；点开走现有清单面板；长按拖出变回小球] [注释时间 2026-11-16] */
      (claimApi&&claimApi.menuVisible()?'<button class="tk-sec go clm" data-go="claim" type="button"><span class="ic">'+I.filePen+'</span><span class="tx"><b>在改文件 '+claimApi.count()+'</b></span>'+I.chev+'</button>':'')+
      '<button class="tk-sec go" data-go="state"><span class="ic">'+I.state+'</span><span class="tx"><b>状态机</b></span>'+I.chev+'</button>'+
    '</div>';
    host.appendChild(ov); buzz(6); requestAnimationFrame(function(){ ov.classList.add('show'); });
    if(alarmApi) alarmApi.menuOpen(true);   /* 打开菜单：悬浮的闹钟小球淡出，关菜单再回来 */
    if(claimApi) claimApi.menuOpen(true);
    var almPulled=false;   /* 刚把闹钟项拖出变成了小球：吞掉随后的那次 click，别又弹出闹钟弹窗 */
    var clmPulled=false;
    function close(){
      ov.classList.remove('show');
      if(alarmApi) alarmApi.menuOpen(false);
      if(claimApi) claimApi.menuOpen(false);
      setTimeout(function(){ ov.remove(); },240);
    }
    ov.querySelector('.scrim').addEventListener('click',close);
    ov.addEventListener('click',function(e){
      var h=e.target.closest('.tk-sec[data-s]'); if(h){ var s=h.parentNode, was=s.classList.contains('open'); Array.prototype.forEach.call(ov.querySelectorAll('.tk-acc.open'),function(x){ x.classList.remove('open'); }); if(!was) s.classList.add('open'); buzz(6); return; }
      if(X&&X.click(e,ov)){ if(LIVE.on) xwSaveSoon(ov); return; }
      if(e.target.closest('[data-go="search"]')){ close(); setTimeout(talkSearch,180); return; }
      if(e.target.closest('[data-go="alarm"]')){ if(almPulled){ almPulled=false; return; } close(); setTimeout(alarmDialog,180); return; }
      if(e.target.closest('[data-go="claim"]')){ if(clmPulled){ clmPulled=false; return; } close(); setTimeout(function(){ if(claimApi) claimApi.openPanel(); },180); return; }
      if(e.target.closest('[data-go="state"]')){ close(); setTimeout(statePage,180); }
      if(e.target.closest('[data-tokview]')){ var um=upMsg(); if(um) tokSheet(um); else { toast('这个会话还没有上游实报的数'); buzz([12,30,12]); } return; }
      if(e.target.closest('.tk-raw')){ close(); setTimeout(rawPage,180); }
    });
    /* 长按「闹钟」/「在改文件」项约 0.36 秒后轻震一下，拖出范围就关菜单、小球从手指处飞出 */
    wireMenuPull(ov.querySelector('[data-go="alarm"]'),function(x,y,pid){
      almPulled=true; close();
      if(alarmApi) alarmApi.pullOut(x,y,pid);
    });
    wireMenuPull(ov.querySelector('[data-go="claim"]'),function(x,y,pid){
      clmPulled=true; close();
      if(claimApi) claimApi.pullOut(x,y,pid);
    });
    if(open){ var t=ov.querySelector('.tk-acc[data-k="'+open+'"]'); if(t) t.classList.add('open'); }
    ctxLive(ov);
    if(LIVE.on) liveXw(ov);
  }
  $('#tkMore',win).addEventListener('click',function(){ moreMenu(); });

  /* ---------- 看原文：照旧聊天页「当前请求上下文」——网关最后一次真正发给模型的 messages，一条一条原样列出来；
     工具结果默认收成一行，点开看全文。登录了读 /admin/logs/context，没登录显示示例（页面上会标「示例」）。
   2026-11-01（#57 用户）：右上角复制按钮原来误用对勾图标 I.ok，看着像「完成」，换成语义正确的复制图标 I.copy（功能不变）。 ---------- */
  var RAW_DEMO=[];   /* 演示请求已删（2026-10-22） */
  var RCOL={system:'#b7a2c9',user:'#8fb98a',assistant:'#c9a2a2',tool:'#e0a960'};
  function rawText(m){ return Array.isArray(m.content)?m.content.map(function(c){ return c.text||('['+(c.type||'img')+']'); }).join('\n'):String(m.content==null?'':m.content); }
  function rawItem(m,i){
    var role=m.role||'?', t=rawText(m), tag='';
    if(m.tool_calls&&m.tool_calls.length) tag='调用 '+m.tool_calls.map(function(c){ return (c.function&&c.function.name)||'?'; }).join(', ');
    if(m.tool_call_id) tag='tool#'+String(m.tool_call_id).slice(0,6);
    var body;
    if(role==='tool'){ var L=t.split('\n'), sm={}; if(L[0]==='[工具调用结果]'){ for(var k=1;k<L.length;k++){ var x=L[k]; if(x.indexOf('工具：')===0) sm.n=x.slice(3); else if(x.indexOf('调用时间：')===0) sm.t=x.slice(5); else if(x.indexOf('状态：')===0) sm.s=x.slice(3); else break; } }
      body='<details class="tk-rt"><summary>'+esc((sm.n||'工具结果')+(sm.t?' · '+sm.t:'')+(sm.s?' · '+sm.s:''))+'</summary><pre>'+esc(t)+'</pre></details>'; }
    else body='<pre>'+(t?esc(t):'<i>（空）</i>')+'</pre>';
    return '<div class="tk-ri"><div class="rh"><span class="rl" style="--c:'+(RCOL[role]||'#9aa6bb')+'">'+esc(role)+'</span>'+(tag?'<small>'+esc(tag)+'</small>':'')+'<em>#'+(i+1)+'</em></div>'+body+'</div>';
  }
  /* [位置:phone-talk.js·wireTkPageKb] [.tk-page 子页软键盘避让] [键盘弹起时给滚动区(.tk-ps/.tk-rawsc/.pb)动态补足 padding-bottom，并在输入框聚焦时自动滚入可视区中央；关页时注销 P.kb 监听] [注释时间 2026-11-23] */
  function wireTkPageKb(pg){
    var sc=pg.querySelector('.tk-ps, .tk-rawsc, .pb'), kbOff=null, ft1=0, ft2=0;
    function apply(kb){
      if(!pg.isConnected){ off(); return; }
      kb=Math.max(0,Math.round(kb||0));
      if(sc) sc.style.paddingBottom=kb>60?(kb+48)+'px':'';
      if(kb>60){
        var ae=document.activeElement;
        if(ae&&pg.contains(ae)&&isKbInput(ae)){
          clearTimeout(ft1);
          ft1=setTimeout(function(){ if(pg.isConnected&&document.activeElement===ae) scrollElCenter(ae); },80);
        }
      }
    }
    function onFocus(e){
      var t=e.target; if(!isKbInput(t)) return;
      var cur=kbNow(); if(cur>60) apply(cur);
      clearTimeout(ft1); clearTimeout(ft2);
      ft1=setTimeout(function(){ if(pg.isConnected&&document.activeElement===t) scrollElCenter(t); },120);
      ft2=setTimeout(function(){ if(pg.isConnected&&document.activeElement===t) scrollElCenter(t); },340);
    }
    function off(){
      clearTimeout(ft1); clearTimeout(ft2);
      if(kbOff){ kbOff(); kbOff=null; }
      pg.removeEventListener('focusin',onFocus);
      if(sc) sc.style.paddingBottom='';
    }
    pg.addEventListener('focusin',onFocus);
    if(P.kb) kbOff=P.kb(apply);
    var cur=kbNow(); if(cur>60) apply(cur);
    return off;
  }
  function rawPage(){
    var pg=document.createElement('div'); pg.className='tk-page';
    pg.innerHTML='<div class="ph"><button class="tk-cb tap tk-bk" aria-label="返回">'+I.back+'</button><div class="ttl">发出去的原文</div><button class="tk-cb tap" id="tkCp" aria-label="复制">'+I.copy+'</button></div><div class="tk-rawwin"><div class="tk-rtip" id="tkRtip">读取中…</div><div class="tk-rawsc" id="tkRaw"></div></div>';
    host.appendChild(pg); buzz(8); requestAnimationFrame(function(){ requestAnimationFrame(function(){ pg.classList.add('show'); }); });
    var kbOff=wireTkPageKb(pg);
    var box=pg.querySelector('#tkRaw'), tip=pg.querySelector('#tkRtip'), msgs=[];
    function paint(list,cap,demo){ msgs=list;
      tip.textContent=list.length?'共 '+list.length+' 条'+(cap?' · '+cap:'')+(demo?' · 示例':''):'还没有请求记录';
      box.innerHTML=list.map(rawItem).join(''); }
    var net=P.net&&P.net.get;
    if(net&&!ctxUrl()) paint([],'',false);
    else if(net) P.net.get(ctxUrl(),{noLogin:true}).then(function(d){ var c=d&&d.captureTime; paint((d&&d.messages)||[],c?new Date(c).toLocaleString('zh-CN',{hour12:false}):'',false); },function(){ paint(RAW_DEMO,'',true); });
    else paint(RAW_DEMO,'',true);
    pg.querySelector('.tk-bk').addEventListener('click',function(){ kbOff(); pg.classList.remove('show'); setTimeout(function(){ pg.remove(); },380); });
    pg.querySelector('#tkCp').addEventListener('click',function(){ var txt=msgs.map(function(m){ return '['+(m.role||'?')+']\n'+rawText(m); }).join('\n\n');
      (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(txt):Promise.reject()).then(function(){ toast('全文已拷贝'); },function(){ toast('这台手机不让拷贝'); }); buzz(8); });
  }
  /* ---------- 状态机：接 /admin/conversation-state（当前状态 / 版本链 / 候选 / 未并入 / 参数） ---------- */
  var SM={d:null,pv:null,seq:0,view:null,vt:{},open:false,lg:null,lgErr:false,lgOpen:false,rgChars:0};   /* 1021：原与「生成状态 ST」同名同作用域，var 合并后 ST 变成永真对象，rebuild 里 if(ST) 恒成立，会话一打开就多出一个思考气泡 */
  function stSid(){ return String((LIVE.sid||(CTX0&&CTX0.id)||'')).trim(); }
  function stUrl(p,extra){ var q='session_id='+encodeURIComponent(stSid()); return '/heartbeat/admin/conversation-state'+(p||'')+'?'+q+(extra?'&'+extra:''); }
  function stGet(p,extra){ return P.net.get(stUrl(p,extra),{noLogin:true}); }
  function stPost(p,body){ return P.net.post(stUrl(p),body||{},{noLogin:true}); }
  function pvUrl(){ return '/heartbeat/admin/context-compaction/preview?session_id='+encodeURIComponent(stSid()); }
  function fdt(s){ if(!s) return '—'; var d=new Date(String(s).replace(' ','T')); if(isNaN(d.getTime())) return String(s);
    function q(n){ return ('0'+n).slice(-2); } return (d.getMonth()+1)+'-'+q(d.getDate())+' '+q(d.getHours())+':'+q(d.getMinutes()); }
  /* [位置:phone-talk.js·ask] [确认小弹窗] [纯确认用居中小卡片：不糊背景、按钮并排、不再套用顶部整块弹层；danger=true 时确认键用红色] [注释时间 2026-10-21；2026-11-16 改：按钮顺序统一为取消在左、执行在右] */
  function ask(title,text,okLabel,fn,danger,cancelLabel,fnCancel){
    sheet('<b class="cf-t">'+esc(title)+'</b><p class="cf-p">'+esc(text)+'</p>'+
      '<div class="cf-b"><button class="tap" data-no>'+esc(cancelLabel||'算了')+'</button><button class="tap go'+(danger?' danger':'')+'" data-yes>'+esc(okLabel)+'</button></div>','cf',function(box,close){
      box.querySelector('[data-no]').addEventListener('click',function(){ close(); if(fnCancel) fnCancel(); });
      box.querySelector('[data-yes]').addEventListener('click',function(){ close(); fn(); });
    });
  }
  function statePage(){
    var pg=document.createElement('div'); pg.className='tk-page';
    pg.innerHTML='<div class="ph"><button class="tk-cb tap tk-bk" aria-label="返回">'+I.back+'</button><div class="ttl">状态机</div><button class="tk-cb tap" id="tkStGear" aria-label="参数">'+I.gear+'</button></div>'+
      '<div class="sc tk-ps"><div class="meta" id="tkStTip" style="display:none"></div><div class="st-body"></div></div>';
    host.appendChild(pg); buzz(8);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ pg.classList.add('show'); }); });
    var kbOff=wireTkPageKb(pg);
    pg.querySelector('.tk-bk').addEventListener('click',function(){ kbOff(); pg.classList.remove('show'); setTimeout(function(){ pg.remove(); },380); });
    pg.querySelector('#tkStGear').addEventListener('click',function(){ stateCfg(pg); });
    pg.addEventListener('click',function(e){ stAct(pg,e); });
    /* [位置:phone-talk.js·statePage 区间输入] [手动区间防抖预览] [10-28：stPaint 每次重画都重建输入框，input 监听挂 pg 上事件委托才不会被摘掉；420ms 防抖；倒序/超界/没写对给直白提示、不发请求；请求序号由 stRangePreview 丢弃过期响应] [注释时间 2026-10-28] */
    var _rt=0;
    pg.addEventListener('input',function(e){ if(!e.target||e.target.id!=='tkStRng') return; clearTimeout(_rt);
      _rt=setTimeout(function(){ var el=pg.querySelector('#tkStPv'); if(!el||!pg.isConnected) return;
        var r=stRng(pg), tot=Number((SM.pv||{}).totalCompressible||0);
        if(!r){ el.hidden=false; el.innerHTML='<div class="meta">区间写成 100-160 这样</div>'; return; }
        if(r.start>r.end){ el.hidden=false; el.innerHTML='<div class="meta">起点要小于等于终点，比如 10-20</div>'; return; }
        if(tot&&r.start>tot){ el.hidden=false; el.innerHTML='<div class="meta">原文一共 '+tot+' 条，没有第 '+r.start+' 条</div>'; return; }
        stRangePreview(pg,r.start,r.end); },420); });
    stLoad(pg);
  }
  function stTip(pg,t){ var el=pg.querySelector('#tkStTip'); if(!el) return; el.textContent=t||''; el.style.display=t?'':'none'; }
  function stLoad(pg){
    var body=pg.querySelector('.st-body'), n=++SM.seq; SM.view=null; SM.vt={}; SM.open=false; SM.exp=false; SM.auto=false; SM.lgOpen=false; SM.lg=null; SM.lgErr=false; SM.rgChars=0; SM.rgR=null;
    body.innerHTML='<div class="meta">读取中…</div>'; stTip(pg,'');
    if(!stSid()){ body.innerHTML='<div class="tk-card"><div class="body">先从一个会话进来，才有这个会话的状态。</div></div>'; return; }
    /* [位置:phone-talk.js·stLoad 原始日志] [本会话状态机日志单独拉] [11-06：生成失败时页面上只有一句「没算出来」，看不到模型到底坏在哪；日志接口全量返回、很快，单独请求、失败不影响主体；到货后只重填日志区，不整页重画] [注释时间 2026-11-06] */
    stLogPull(pg,n);
    Promise.all([stGet(''), P.net.get(pvUrl(),{noLogin:true}).then(function(x){ return x; },function(){ return null; })]).then(function(r){
      if(n!==SM.seq) return; SM.d=r[0]||{}; SM.pv=r[1]||null; stPaint(pg);
    },function(err){
      if(n!==SM.seq) return;
      body.innerHTML='<div class="tk-card"><div class="body">没读出来：'+esc((err&&err.message)||'网络不通')+'</div><div class="bt"><button class="tap" data-st="reload">重读</button></div></div>';
    });
  }
  /* [位置:phone-talk.js·stPaint] [状态机页绘制] [展示当前状态/覆盖范围/还没并入的原文区间] [注释时间 2026-10-21 改：覆盖范围与起点按 0 起算 +1 展示；去掉分块列表容器与并入记录；原文区间块加间距与内嵌原文窗口；候选卡片标题收小、加新状态字数/变更数/范围] */
  function stPaint(pg){
    var body=pg.querySelector('.st-body'); if(!body) return;
    var d=SM.d||{}, pv=SM.pv||{}, vers=Array.isArray(d.versions)?d.versions:[], cur=Number(d.version||0);
    var merged=vers.filter(function(v){ return v.status!=='undone'; }).length;
    var cr=d.covered_range, h='';
    if(!d.exists){
      h+='<div class="tk-card"><div class="ch"><b>当前状态</b><span class="ver">空</span></div><div class="body">这个会话还没有状态。把一段原文并进来，就会生成第一版。</div></div>';
    }else{
      /* [位置:phone-talk.js·stPaint 版本芯片] [点版本就地切换显示] [点 v1~vN 不再弹层，卡片正文/范围/字数直接换成那一版；历史版本只显示预览提示，再点一次该版本号才切过去（对齐管理台），不另设按钮；展开全文是固定高度滚动窗口] [注释时间 2026-10-21] */
      var vw=(SM.view!=null&&SM.view!==cur)?SM.view:null, vi=null;
      if(vw!=null){ vi=vers.filter(function(x){ return Number(x.version)===vw; })[0]||null; if(!vi){ vw=null; SM.view=null; } }
      /* [位置:phone-talk.js·stPaint 版本链] [默认只亮最新 5 个] [10-28：版本一多全量铺开太长——最新 5 个照常显示，更老的收进「…」芯片，点开展开、再点收起；当前版和正在预览的版即使不在最新 5 个里也始终可见（回滚到老版本后芯片不能消失）] [10-30 修方向：服务端 versions 实际新→旧降序（lib/conversation-state.js 并入时 unshift 插最前），原注释「升序追加」写反、slice(-5) 实际取到的是最旧 5 个；改成 slice(0,5) 取最新 5 个，链上新→旧排，「…/收起」在末尾] [注释时间 2026-10-30] */
      var vchain=(function(){
        function chip(v){ return '<button class="vc'+((vw!=null?Number(v.version)===vw:v.status==='current')?' on':'')+(v.status==='undone'?' undone':'')+'" data-v="'+v.version+'">v'+v.version+'</button>'; }
        var show=vers.slice(0,5), olds=vers.slice(5);
        var vwOld=(vw!=null)&&olds.some(function(v){ return Number(v.version)===vw; });
        var h2=show.map(chip).join('');
        if(olds.length){
          if(SM.exp){ h2+=olds.map(chip).join('')+'<button class="vc dots" data-v="...">收起</button>'; }
          else{ h2+='<button class="vc dots" data-v="...">…</button>';
            if(vwOld) h2+=chip(olds.filter(function(v){ return Number(v.version)===vw; })[0]); }
        }
        return h2;
      })();
      var vtxt=vw!=null?SM.vt[vw]:null, shown=vw!=null?(vtxt==null?'':vtxt):String(d.text||'');
      var vrg=vi&&vi.range&&typeof vi.range.start_index==='number'?vi.range:null;
      var vst=vi?(vi.status==='undone'?'已撤销 · 可恢复':'旧版'):'';
      h+='<div class="tk-card"><div class="ch"><b>'+(vw!=null?'历史版本':'当前状态')+'</b><span class="ver">v'+(vw!=null?vw:cur)+'</span>'+(vst?'<small>'+vst+'</small>':'')+'</div>'+
        '<div class="cov">'+((vw!=null?vrg:cr)?'<span>覆盖 <b>第 '+(Number((vw!=null?vrg:cr).start_index)+1)+'~'+(Number((vw!=null?vrg:cr).end_index)+1)+' 条</b></span>':'')+
        (vw!=null?'':'<span>已并入 <b>'+merged+'</b> 次</span>')+'<span><b>'+(vw!=null&&vtxt==null?'…':shown.length)+'</b> 字</span><span>更新于 <b>'+fdt(vw!=null?(vi&&vi.at):d.updated_at)+'</b></span></div>'+
        '<div class="body '+(SM.open?'open':'clip')+'">'+(vw!=null&&vtxt==null?'<i>读取中…</i>':(esc(shown).replace(/\n/g,'<br>')||'<i>（空）</i>'))+'</div>'+
        '<div class="bt"><button class="tap" data-st="exp">'+(SM.open?'收起':'展开全文')+'</button>'+
          (vw!=null?''
                   :'<button class="tap" data-st="edit">编辑</button>'+(cur>0?'<button class="tap danger" data-st="undo">撤销最后一次并入</button>':''))+'</div>'+
        (vw!=null?'<div class="vhint">正在预览 v'+vw+' · 再点一次 v'+vw+' '+(vi&&vi.status==='undone'?'恢复':'切到')+'这一版 · 点 v'+cur+' 回到当前</div>':'')+
        '<div class="chain">'+vchain+'</div></div>';
    }
    var c=d.candidate;
    if(c&&c.exists&&c.candidate){
      var cd=c.candidate, rg=cd.range||{}, ops=Array.isArray(cd.ops)?cd.ops:[];
      var nl=String(cd.state||'').length, ol=String(d.text||'').length, df=nl-ol;
      h+='<div class="tk-card diff"><div class="ch"><b>候选</b><small>等你确认</small></div>'+
        '<div class="cov"><span>新状态 <b>'+nl+'</b> 字'+(d.exists?'（现有 '+ol+' 字，'+(df>=0?'+':'−')+Math.abs(df)+'）':'')+'</span><span>变更 <b>'+ops.length+'</b> 条</span><span>第 <b>'+(rg.start_num||'?')+'~'+(rg.end_num||'?')+'</b> 条'+(rg.count?'（'+rg.count+' 条）':'')+'</span></div>'+
        (rg.range_label?'<div class="rl">'+esc(rg.range_label)+'</div>':'')+
        '<div class="dl">'+(ops.length?ops.map(function(o){ return '<p class="'+(o.type==='remove'?'del':'add')+'">'+(o.type==='remove'?'− ':'+ ')+esc(o.desc||o.type)+(o.reason?'（'+esc(o.reason)+'）':'')+'</p>'; }).join(''):'<p class="add">+ 这一版没有变更清单</p>')+'</div>'+
        '<div class="bt"><button class="tap" data-st="discard">丢弃候选</button><button class="tap ok" data-st="commit">确认并入</button></div></div>';
    }
    var tot=Number(pv.totalCompressible||0);
    if(tot>0){
      var from=(cr&&cr.end_index!=null)?Number(cr.end_index)+2:1;
      if(from<=tot){
        h+='<div class="stun"><div class="sect">还没并入的原文</div><div class="meta">'+(cr?'状态已经吃掉第 1~'+(Number(cr.end_index)+1)+' 条，':'')+'<b>还没并入的是第 '+from+'~'+tot+' 条</b>。</div>'+
          '<div class="rng"><input id="tkStRng" value="'+from+'-'+tot+'" inputmode="numeric" aria-label="区间"><button class="tap" data-st="chunk">自动分块</button><button class="tap ok" data-st="merge">▸ 并入状态</button></div>'+
          '<div class="smpv" id="tkStPv" hidden></div></div>';
      }else{
        h+='<div class="sect">还没并入的原文</div><div class="meta">全部 '+tot+' 条都在状态里了，没有新的要并。</div>';
      }
    }
    h+='<div class="stlog" id="tkStLog"><button class="stlog-h tap" data-st="stlog" aria-expanded="false"><span class="t">原始日志</span><small>读取中…</small><i class="arw" aria-hidden="true"></i></button><div class="stlog-b"><div class="stlog-sc"><div class="meta">读取中…</div></div><button class="stlog-clr tap" data-st="stclear" hidden>清空</button></div></div>';
    body.innerHTML=h;
    /* [位置:phone-talk.js·stPaint 自动预览] [进页面先看一眼待并原文] [10-28：区间输入框下方默认展示「还没并入」区间的预览（每次加载只自动来一次），输入后走防抖刷新] [注释时间 2026-10-28] */
    if(!SM.auto){ SM.auto=true; var af=(cr&&cr.end_index!=null)?Number(cr.end_index)+2:1, at2=Number(pv.totalCompressible||0); if(af<=at2) stRangePreview(pg,af,at2); }
    /* [位置:phone-talk.js·stPaint 尾部] [原始日志入口] [11-06：放在状态机页最底下，默认收起，一行标题带今日条数和失败数；展开是每条的时间/结果/完整说明，失败条目描边变红，正文可选中复制] [注释时间 2026-11-06] */
    if(SM.lg) stLogFill(pg);
  }
  /* [位置:phone-talk.js·stLogs/stLogFill] [本会话日志筛选与渲染] [新日志带 session 字段精确匹配；旧日志没有 session，回退按 label 里的会话尾号匹配；只显示最近 10 条，按时间倒序；撑开用 max-height 过渡，点一下立刻收起] [注释时间 2026-11-06] */
  function stLogs(){
    var sid=stSid(), tail=sid.slice(-12), out=[];
    (SM.lg||[]).forEach(function(e){
      if(!e) return;
      var hit=e.session?String(e.session)===sid:(String(e.label||'').indexOf(tail)>=0||String(e.label||'').indexOf(sid)>=0);
      if(hit) out.push(e);
    });
    out.sort(function(a,b){ return String(b.time||'').localeCompare(String(a.time||'')); });
    return out;
  }
  function stLogTime(v){
    var d=new Date(String(v||'').replace(' ','T')); if(isNaN(d.getTime())) return String(v||'').slice(11,19);
    function q(n){ return ('0'+n).slice(-2); } return q(d.getHours())+':'+q(d.getMinutes())+':'+q(d.getSeconds());
  }
  /* 可清的条数：正在算（pending/running）的留着——worker 完成回调还要按 id 更新它 */
  function stLogClearable(list){
    return (list||[]).filter(function(e){ return !/pending|running/i.test(String((e&&e.status)||'')); }).length;
  }
  function stLogSt(e){
    var st=String((e&&e.status)||''), m=String((e&&e.message)||'');
    if(/interrupt/i.test(st)) return {t:'中断',bad:true};
    if(/error|fail/i.test(st)||/失败|中断|异常|不可达|没算出|解析失败/.test(m)) return {t:'失败',bad:true};
    if(/pending|running/i.test(st)) return {t:'进行中',bad:false};
    return {t:'成功',bad:false};
  }
  function stLogFill(pg){
    var root=pg&&pg.querySelector('#tkStLog'); if(!root) return;
    var sm=root.querySelector('.stlog-h small'), sc=root.querySelector('.stlog-sc');
    var list=stLogs(), shown=list.slice(0,10), bad=list.filter(function(e){ return stLogSt(e).bad; }).length;
    var clr0=root.querySelector('.stlog-clr'); if(clr0) clr0.hidden=true;
    if(SM.lgErr){ sm.textContent='读不出来'; sm.className=''; sc.innerHTML='<div class="meta">日志读不出来，待会儿重进这一页看看</div>'; return; }
    sm.textContent=list.length?('今天 '+list.length+' 条'+(bad?' · 失败 '+bad:'')):'今天还没有';
    sm.className=bad?'warn':'';
    if(!list.length){ sc.innerHTML='<div class="meta">这个会话今天还没有状态机日志。生成一次或并入一次，这里就会记一条。</div>'; return; }
    sc.innerHTML=shown.map(function(e){
      var st=stLogSt(e);
      return '<div class="stlog-i'+(st.bad?' bad':'')+'">'+
        '<div class="r1"><b>'+esc(stLogTime(e.time))+'</b><em>'+esc(st.t)+'</em><span>'+esc(e.label||'状态机')+'</span></div>'+
        '<div class="r2">'+esc(e.message||'（没有说明）')+'</div></div>';
    }).join('')+(list.length>shown.length?'<div class="meta">只显示最近 10 条</div>':'');
    /* [位置:phone-talk.js·stLogFill 清空按钮] [只清本会话] [11-06：日志越攒越多（一天几十条），要能一键清掉；只清本会话，别的会话和后台任务都不动；正在算的那条留着，不然 worker 回调按 id 找不到条目会重新长出一条。按钮放在滚动区外面，条数再多也不用滑到底] [注释时间 2026-11-06] */
    var clr=root.querySelector('.stlog-clr'), can=stLogClearable(list);
    if(clr){ clr.hidden=!can; clr.textContent='清空这 '+can+' 条'; }
    if(SM.lgOpen) stLogToggle(pg,true);
  }
  /* [位置:phone-talk.js·stLogPull] [重新拉日志] [清空后复用；n 传 0 表示不校验页面序号（清空是本页发起的，不需要防过期）] [注释时间 2026-11-06] */
  function stLogPull(pg,n){
    P.net.get('/heartbeat/admin/context-compaction/logs',{noLogin:true}).then(function(x){
      if(n&&n!==SM.seq) return; SM.lg=(x&&x.logs)||[]; SM.lgErr=false; stLogFill(pg);
    },function(){ if(n&&n!==SM.seq) return; SM.lgErr=true; stLogFill(pg); });
  }
  /* [位置:phone-talk.js·stLogClear] [清空本会话日志] [先弹确认（danger 红键）；只删本会话，别的会话与后台任务不受影响；正在算的条数在文案里说明会留着] [注释时间 2026-11-06] */
  function stLogClear(pg){
    var list=stLogs(), can=stLogClearable(list); if(!can) return;
    var run=list.length-can;
    ask('清空日志？','这个会话今天的 '+can+' 条状态机记录会删掉，别的会话和后台任务不受影响。删了找不回来。'+(run?'正在算的 '+run+' 条会留着。':''),'清空',function(){
      P.net.post('/heartbeat/admin/context-compaction/logs/clear',{session:stSid()},{noLogin:true}).then(function(r){
        var n=Number((r&&r.removed)||0), k=Number((r&&r.kept)||0);
        toast('清掉了 '+n+' 条'+(k?'，正在算的 '+k+' 条留着':''));
        buzz(8); stLogPull(pg,0);
      },function(x){ toast('没清掉：'+stWhyErr(x)); });
    },true);
  }
  function stLogToggle(pg,force){
    var root=pg.querySelector('#tkStLog'); if(!root) return;
    var box=root.querySelector('.stlog-b'), hd=root.querySelector('.stlog-h');
    var want=(force!=null)?force:!SM.lgOpen; SM.lgOpen=want;
    root.classList.toggle('open',want);
    hd.setAttribute('aria-expanded',want?'true':'false');
    box.style.maxHeight=want?(box.scrollHeight+'px'):'0px';
    box.style.opacity=want?'1':'0';
  }
  function stRng(pg){ var el=pg.querySelector('#tkStRng'); var m=String(el?el.value:'').match(/(\d+)\s*[-~—]\s*(\d+)/); return m?{start:+m[1],end:+m[2]}:null; }
  function stAct(pg,e){
    var vb=e.target.closest('.vc[data-v]');
    if(vb){ if(vb.getAttribute('data-v')==='...'){ SM.exp=!SM.exp; stPaint(pg); return; } stView(pg,Number(vb.getAttribute('data-v'))); return; }
    var sb=e.target.closest('[data-st]'); if(!sb) return;
    var k=sb.getAttribute('data-st');
    if(k==='reload'){ stLoad(pg); return; }
    if(k==='exp'){ var b=pg.querySelector('.tk-card .body'); if(b){ SM.open=!SM.open; b.classList.toggle('clip',!SM.open); b.classList.toggle('open',SM.open); b.scrollTop=0; sb.textContent=SM.open?'收起':'展开全文'; } return; }

    if(k==='edit'){ stEdit(pg); return; }
    if(k==='undo'){ ask('撤销最后一次并入？','被吃掉的原文会回到未覆盖区，版本链还留着。','撤销',function(){
      stPost('/undo',{confirm:true}).then(function(){ toast('撤销好了'); stLoad(pg); },function(x){ toast('没撤销成：'+((x&&x.message)||'再试')); }); },true); return; }
    if(k==='discard'){ ask('丢掉这份候选？','丢了就没了，要重新算一遍。','丢掉',function(){
      P.net.post('/heartbeat/admin/conversation-state/candidate/discard?session_id='+encodeURIComponent(stSid()),{},{noLogin:true}).then(function(){ toast('丢掉了'); stLoad(pg); },function(){ toast('没丢掉'); }); },true); return; }
    if(k==='commit'){ stCommit(pg); return; }
    if(k==='chunk'){ stChunk(pg); return; }
    if(k==='merge'){ stMerge(pg); return; }
    if(k==='stlog'){ stLogToggle(pg); return; }
    if(k==='stclear'){ stLogClear(pg); return; }
  }
  /* [位置:phone-talk.js·stView] [就地切到某一版] [点版本芯片：第一次点=卡片直接换成那一版预览（读 /conversation-state/version，缓存在 SM.vt），再点一次同一版=确认后切过去，点当前版=回到当前，与管理台一致；注释时间 2026-10-21 修：stGet 第二参数是字符串，之前传对象导致版本号 NaN、永远读不出来] [注释时间 2026-10-21] */
  function stView(pg,v){
    var cur=Number((SM.d||{}).version||0);
    if(v===cur){ SM.view=null; stPaint(pg); return; }
    /* 对齐管理台 csPickVersion：第一次点=预览，已经在预览这一版时再点一次=切到那一版（都不调模型） */
    if(SM.view===v&&SM.vt[v]!=null){
      var und=(((SM.d||{}).versions||[]).filter(function(x){ return Number(x.version)===v; })[0]||{}).status==='undone';
      ask((und?'恢复':'切到')+' v'+v+'？','状态正文与覆盖范围会变成那一版的样子（链上其他版本都保留，随时可再切）。',und?'恢复':'切过去',function(){ stRollback(pg,v); });
      return;
    }
    SM.view=v;
    if(SM.vt[v]!=null){ stPaint(pg); return; }
    stPaint(pg);
    stGet('/version','version='+encodeURIComponent(v)).then(function(r){
      if(SM.view!==v) return;
      if(!r||r.ok===false){ SM.view=null; stPaint(pg); toast((r&&r.error)||'这一版读不出来'); return; }
      SM.vt[v]=String(r.text||''); stPaint(pg);
    },function(x){ if(SM.view!==v) return; SM.view=null; stPaint(pg); toast('这一版读不出来：'+((x&&x.message)||'网络不通')); });
  }
  /* [位置:phone-talk.js·stRollback] [切回/恢复某一版] [历史版本卡片上的「切回这一版」，对齐管理台 rollback；失败提示原因] [注释时间 2026-10-21] */
  function stRollback(pg,v){
    if(v==null) return;
    stPost('/rollback',{version:v}).then(function(o){ if(o&&o.ok===false){ toast('没切回：'+(o.error||'再试')); return; } toast('回到 v'+v+' 了'); SM.view=null; stLoad(pg); },function(x){ toast('没切回：'+((x&&x.message)||'再试')); });
  }
  function stEdit(pg){
    var d=SM.d||{};
    sheet('<div class="hd"><span>编辑状态正文</span></div><div class="opt"><textarea id="tkStEd" style="min-height:36vh;max-height:50vh;font-size:13px;line-height:1.7;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,calc(.7*var(--wk)));border:.5px solid rgba(125,156,207,.3);width:100%;outline:0;color:var(--ink);resize:none;-webkit-user-select:text;user-select:text">'+esc(d.text||'')+'</textarea></div>'+
      '<button class="nw tap" data-sv>保存</button>','opts mcp tk-stedpop',function(box,close0){
      var ta=box.querySelector('#tkStEd'), kbOff=null;
      /* [位置:phone-talk.js·stEdit] [状态机正文编辑软键盘避让] [11-13：编辑状态机正文时键盘弹起自动抬升弹窗，避免盖住输入框和保存按钮] [注释时间 2026-11-13] */
      function close(){ if(kbOff) kbOff(); close0(); }
      if(P.kb) kbOff=P.kb(function(kb){ if(!box.isConnected){ if(kbOff) kbOff(); return; } var up=kb>60; box.style.top=up?'calc(var(--sat,0px) + 10px)':''; box.style.bottom=up?(kb+10)+'px':''; box.style.maxHeight=up?'none':''; });
      setTimeout(function(){ try{ ta.focus(); }catch(e){} },240);
      box.querySelector('[data-sv]').addEventListener('click',function(){ var v=ta.value; close();
        stPost('/edit',{text:v,confirm:true}).then(function(){ toast('改好了'); stLoad(pg); },function(){ toast('没存上'); }); });
    },{noKb:true});
  }
  /* [位置:phone-talk.js·prmSheet] [状态机提示词管理页] [11-01 #60：多套提示词的清单与编辑——列表行（在用的标注、删除带确认，删在用的顺带清掉本会话选择）、编辑页（名称/状态写法/原文模板，模板变量 ${PREV_STATE} ${LU} ${CHUNK_INFO} ${CONVERSATION_TEXT}，留空=用内置默认）；数据走 /admin/context-compaction/prompts 的 GET/save/delete，「本会话用哪套」在参数面板下拉里换；onChg=变更后面板下拉刷新] [注释时间 2026-11-01] */
  function prmSheet(sid,onChg){
    var L={list:[],sel:''};
    function fetchList(done){
      P.net.get('/heartbeat/admin/context-compaction/prompts?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(d){ L.list=(d&&d.list)||[]; if(d&&typeof d.selected==='string') L.sel=d.selected; if(done) done(); },function(){ toast('提示词清单没读到'); });
    }
    function paintList(re){
      re.innerHTML=(L.list.length?L.list.map(function(p){
        return '<div class="tk-prm-ro tap" data-id="'+esc(p.id||'')+'"><div class="in"><b>'+esc(p.name||'未命名')+(p.id===L.sel?'<em>本会话在用</em>':'')+'</b><small>'+esc(String(p.system||'').length)+' 字 · '+(String(p.user_template||'').indexOf('${CONVERSATION_TEXT}')>=0?'模板就绪':'模板没变量')+'</small></div><i class="ed" aria-label="编辑">'+I.pen+'</i><i class="del" aria-label="删除">'+I.trash+'</i></div>';
      }).join(''):'<div class="meta">还没有自己的一套。新建后在参数面板里选给这个会话用。</div>');
    }
    function paintEdit(re,rec){
      re.innerHTML='<button class="tk-prm-bk tap" data-bk>'+I.back+'<span>返回清单</span></button>'+
        '<div class="tk-prm-f"><label>名称</label><input class="tk-prm-nm" maxlength="30" value="'+esc((rec&&rec.name)||'')+'" placeholder="比如：精简版"></div>'+
        '<div class="tk-prm-f"><label>状态写法<small>告诉他状态是什么、怎么写。留空 = 用内置默认</small></label><textarea class="tk-prm-ta" style="min-height:22vh">'+esc((rec&&rec.system)||'')+'</textarea></div>'+
        '<div class="tk-prm-f"><label>原文模板<small>可用变量：${PREV_STATE} 上一版状态 · ${LU} 来路账本 · ${CHUNK_INFO} 并入范围 · ${CONVERSATION_TEXT} 对话原文；留空 = 用内置模板</small></label><textarea class="tk-prm-ta tk-prm-tpl" style="min-height:13vh">'+esc((rec&&rec.user_template)||'')+'</textarea></div>'+
        '<button class="nw tap tk-prm-sv" data-sv>保存这一套</button>';
      setTimeout(function(){ var n=re.querySelector('.tk-prm-nm'); if(n&&!n.value){ try{ n.focus(); }catch(e){} } },240);
    }
    sheet('<div class="hd"><span>状态机提示词</span></div><div class="opt"><div id="tkPrmBd"></div><button class="nw tap tk-prm-new" id="tkPrmNew">新建一套</button></div>','opts',function(box,close){
      var re=box.querySelector('#tkPrmBd');
      var view='list', cur=null;
      function show(v){ view=v; if(v==='list'){ paintList(re); } else paintEdit(re,cur); var nb=box.querySelector('#tkPrmNew'); if(nb) nb.style.display=(v==='list'?'':'none'); }
      paintList(re);
      fetchList(function(){ if(view==='list') paintList(re); });
      box.addEventListener('click',function(e){
        if(e.target.closest('[data-bk]')){ cur=null; show('list'); return; }
        var ro=e.target.closest('.tk-prm-ro');
        if(ro){
          if(e.target.closest('.del')){
            var id=ro.getAttribute('data-id'), nm=(ro.querySelector('b')||{}).textContent||'';
            ask('删除这套提示词？','「'+nm.replace('本会话在用','').trim()+'」删掉就没了；正在用它的会话自动回到跟随默认。','删除',function(){
              P.net.post('/heartbeat/admin/context-compaction/prompts',{action:'delete',id:id},{noLogin:true}).then(function(){
                if(id===L.sel) P.net.post('/heartbeat/admin/context-compaction/prompts?session_id='+encodeURIComponent(sid),{action:'select',id:''},{noLogin:true}).catch(function(){});
                toast('删掉了'); fetchList(function(){ paintList(re); if(onChg) onChg(); });
              },function(){ toast('没删掉'); });
            },true);
            return;
          }
          var id=ro.getAttribute('data-id'); cur=null;
          (L.list||[]).forEach(function(p){ if(p&&p.id===id) cur=p; });
          show('edit'); return;
        }
        if(e.target.closest('#tkPrmNew')){ cur=null; show('edit'); return; }
        if(e.target.closest('[data-sv]')){
          var nm=re.querySelector('.tk-prm-nm'), t1=re.querySelector('.tk-prm-ta'), t2=re.querySelector('.tk-prm-tpl');
          if(!nm.value.trim()){ toast('先起个名字'); try{ nm.focus(); }catch(e){} return; }
          P.net.post('/heartbeat/admin/context-compaction/prompts',{action:'save',id:(cur&&cur.id)||'',name:nm.value,system:t1.value,user_template:t2.value},{noLogin:true}).then(function(r){
            if(r&&r.rec) cur=r.rec;
            toast('存好了'); fetchList(function(){ show('list'); if(onChg) onChg(); });
          },function(x){ toast('没存上'+(x&&x.message?'：'+String(x.message).slice(0,40):'')); });
          return;
        }
      });
    });
  }
  /* [位置:phone-talk.js·stChunk] [自动分块] [算出下一块要并入的区间填进输入框，并弹层给他看这一块的原文；逻辑对齐管理台 csSuggestAndPreview，只给一块不列多块] [注释时间 2026-10-21] */
  function stChunk(pg){
    var cr=(SM.d||{}).covered_range, tot=Number((SM.pv||{}).totalCompressible||0);
    var from=(cr&&cr.end_index!=null)?Number(cr.end_index)+2:1;
    if(!tot||from>tot){ toast('没有新的要并'); return; }
    P.net.get('/heartbeat/admin/context-compaction/config',{noLogin:true}).then(function(c){ return c||{}; },function(){ return {}; }).then(function(c){
      return P.net.post('/heartbeat/admin/context-compaction/blocks?session_id='+encodeURIComponent(stSid()),{action:'split_range',dryRun:true,start:from,end:tot,gapMinutes:Number(c.compaction_gap_minutes)||30},{noLogin:true});
    }).then(function(o){
      var seg=(o&&o.segments)||[]; if(!seg.length){ toast('这段切不开，整段并就行'); return; }
      var a=seg[0].start!=null?seg[0].start:seg[0][0], b=seg[0].end!=null?seg[0].end:seg[0][1];
      var s=a+1, e=b+1;   // 服务端切点是 0-based
      var inp=pg.querySelector('#tkStRng'); if(inp) inp.value=s+'-'+e;
      stRangePreview(pg,s,e);
    },function(){ toast('切不开，先整段并'); });
  }
  /* [位置:phone-talk.js·stRangePreview] [原文区间预览统一入口] [10-28：自动分块和手动输入走同一个函数（原 stChunkInline 收编）；标题「第 x~y 条」以服务端裁剪后返回的 start/end 为准——手动输入 27-999 这种超界区间不再显示假区间；每条编号用服务端 num；空段/没读到给直白空态，不甩错误编号；请求序号丢弃过期响应] [注释时间 2026-10-28] */
  function stRangePreview(pg,s,e){
    var el=pg.querySelector('#tkStPv'); if(!el) return;
    var n=(SM.pvn=(SM.pvn||0)+1); SM.rgR={s:s,e:e};
    el.hidden=false; el.scrollTop=0; el.innerHTML='<div class="meta">读取中…</div>';
    P.net.get('/heartbeat/admin/context-compaction/range-preview?session_id='+encodeURIComponent(stSid())+'&start='+s+'&end='+e,{noLogin:true}).then(function(d){
      if(n!==SM.pvn||!pg.isConnected) return;
      var it=(d&&d.items)||[], st=d&&d.start, en=d&&d.end;
      var ch=Number((d&&d.chars)||0); SM.rgChars=ch;
      var head='第 '+(st!=null?st:s)+'~'+(en!=null?en:e)+' 条 · '+((d&&d.count!=null)?d.count:it.length)+' 条'+(ch?' · '+fmtChar(ch):'');
      /* [位置:phone-talk.js·stRangePreview 超长提示] [区间字数兜底] [11-06：只按条数限 1000 条挡不住 18 条 53 万字（模型把 JSON 括号写坏那次）；超过 15 万字就地提示先分块] [注释时间 2026-11-06] */
      var longtip=ch>150000?'<div class="longtip">这一段 '+fmtChar(ch)+'，整段交给模型容易写坏 JSON。点「自动分块」，一块一块并更稳。</div>':'';
      el.innerHTML='<div class="meta">'+head+'</div>'+longtip+(it.length?it.map(function(m){ var her=m.role==='user', on=!!m.marked;
        return '<div class="pm2 '+(her?'her':'me')+'"><div class="who">'+(her?'她':'我')+'<em>#'+m.num+(m.time?' · '+esc(m.time):'')+'</em><button type="button" class="pm2-st tap'+(on?' on':'')+'" data-n="'+m.num+'" aria-label="'+(on?'取消标星':'标星')+'">'+I.star+'</button></div><div class="bd">'+esc(m.content||'')+'</div></div>'; }).join(''):'<div class="meta">这段没有原文</div>');
      /* [位置:phone-talk.js·stRangePreview 星标] [预览里每条原文一键标星/取消] [#49 10-29：预览接口每条自带 marked（已标）和内容键，渲染直接点亮；点击走 starPost（msg_id 主键），和聊天页长按标星同一份 marks——压缩保留、跨窗口读原文自动继承，STAR 状态同步给聊天页气泡] [注释时间 2026-10-29] */
      Array.prototype.forEach.call(el.querySelectorAll('.pm2-st'),function(b){
        var m=null; for(var k=0;k<it.length;k++) if(String(it[k].num)===b.getAttribute('data-n')){ m=it[k]; break; }
        if(!m){ b.disabled=true; return; }
        b.addEventListener('click',function(){ if(b._busy) return; b._busy=1;
          var want=!b.classList.contains('on'); buzz(6);
          starPost(m,want).then(function(){ b._busy=0; b.classList.toggle('on',want); b.setAttribute('aria-label',want?'取消标星':'标星'); toast(want?'标好了，压缩时保留这条':'取消标星了'); },
            function(e){ b._busy=0; toast((want?'没标上':'没取消掉')+(e&&e.message?'：'+String(e.message).slice(0,60):'')); }); });
      });
    },function(){ if(n===SM.pvn) el.innerHTML='<div class="meta">原文读不出来</div>'; });
  }
  /* [位置:phone-talk.js·stMerge] [并入状态按钮忙态] [点「并入状态」后按钮自己变成转圈 +「正在算…」并禁用，算完/出错再还原；不再在页面顶部放提示字] [注释时间 2026-10-21] */
  function stBusy(pg,on){
    var b=pg.querySelector('[data-st="merge"]'); if(!b) return;
    if(on){ b.dataset.t=b.dataset.t||b.textContent; b.classList.add('busy'); b.disabled=true; b.innerHTML='<i class="spn"></i>正在算…'; }
    else{ b.classList.remove('busy'); b.disabled=false; if(b.dataset.t) b.textContent=b.dataset.t; }
    var c=pg.querySelector('[data-st="chunk"]'); if(c) c.disabled=!!on;
    var i=pg.querySelector('#tkStRng'); if(i) i.disabled=!!on;
  }
  function stMerge(pg){
    var r=stRng(pg); if(!r){ toast('区间写成 100-160 这样'); return; }
    var bb=pg.querySelector('[data-st="merge"]'); if(bb&&bb.disabled) return;
    var rgOK=SM.rgR&&SM.rgR.s===r.start&&SM.rgR.e===r.end;
    if(rgOK&&Number(SM.rgChars||0)>150000){
      /* [位置:phone-talk.js·stMerge 分块确认] [标签随按钮顺序换位] [2026-11-16 ask 统一为取消在左、执行在右后，「去分块」是推荐执行必须落在右键：okLabel/fn 与 cancelLabel/fnCancel 对调，点右走分块、点左走整段] [注释时间 2026-11-16] */
      ask('要分块吗？','这段 '+fmtChar(SM.rgChars)+'，整段交给模型容易写坏 JSON。建议先点「自动分块」，一块一块并。','去分块',function(){ stChunk(pg); },false,'还是整段并',function(){ doMerge(pg,r); });
      return;
    }
    doMerge(pg,r);
  }
  function doMerge(pg,r){
    stBusy(pg,true); buzz(10);
    stPost('/preview',{start:r.start,end:r.end}).then(function(){
      var n=0;
      (function poll(){
        if(!pg.isConnected) return;
        stGet('').then(function(d){
          if(d&&d.candidate&&d.candidate.exists){ SM.d=d; stPaint(pg); toast('候选算好了'); return; }
          if(++n>40){ stBusy(pg,false); toast('算了很久还没出来，待会儿再点一次看看'); return; }
          setTimeout(poll,3000);
        },function(){ if(++n>40){ stBusy(pg,false); toast('连不上后台'); return; } setTimeout(poll,3000); });
      })();
    },function(x){
      var msg=(x&&x.message)||'';
      if(/409/.test(msg)||/候选/.test(msg)){ stLoad(pg); toast('这个会话已经有一份候选，先确认或丢掉再算'); }
      else{ stBusy(pg,false); toast('没交上去：'+(msg||'再试一次')); }
    });
  }
  function fmtChar(n){ n=Number(n)||0; if(n>=10000) return (n/10000).toFixed(1)+' 万字'; return n+' 字'; }
  /* [位置:phone-talk.js·stWhyErr] [并入失败原因转人话] [2026-11-05：stCommit 的网络错误回调原来把异常整个吞掉（只弹「没并进去」），23:37 那次真因是后端 ReferenceError 走的 400，界面上完全看不出来；现在取出后端 error 字段（长句截 60 字，toast 是单行胶囊放不下整段）] [注释时间 2026-11-05] */
  function stWhyErr(e){
    var m=String((e&&e.message)||''), j=m.match(/\{[\s\S]*\}/), t='';
    if(j){ try{ t=(JSON.parse(j[0])||{}).error||''; }catch(x){ t=''; } }
    if(!t) t=m.replace(/^HTTP \d{3}\s*/,'');
    t=String(t).replace(/\s+/g,' ').trim();
    if(!t||/Failed to fetch|NetworkError|Load failed|请求超时/i.test(t)) return '网络不通，过一会儿再点';
    return t.length>60?t.slice(0,60)+'…':t;
  }
  function stCommit(pg){
    var cd=(SM.d&&SM.d.candidate&&SM.d.candidate.candidate)||null; if(!cd) return;
    var rg=cd.range||{};
    ask('确认并入？','这一版会替换掉第 '+(rg.start_num||'?')+'~'+(rg.end_num||'?')+' 条的原文。','确认并入',function(){
      stPost('/commit',{state:cd.state,ops:cd.ops,start_msg:rg.start_msg,end_msg:rg.end_msg,range_label:rg.range_label,label_start:rg.label_start,label_end:rg.label_end,count:rg.count,source:'manual'})
        .then(function(o){ if(o&&o.ok===false) toast(o.error||'没并进去'); else toast('并进去了'); stLoad(pg); },function(x){ toast('没并进去：'+stWhyErr(x)); });
    });
  }
  /* ---------- /compact 收尾入口（随手记 #20） ---------- */
  /* [位置:phone-talk.js·CMP/compactNow] [/compact 压缩收尾命令] [用户随手记 #20 拍板：输入栏纯文本 /compact 不出气泡、不发聊天请求，直接编排现有状态机压缩管线——区间=上个压缩块结束处(covered_range)到最新一条(totalCompressible)，口径同面板 stChunk；复用 /preview 提交→轮询候选（logs 按 logId 提前收态）→候选一出自动 commit（source=compact，不弹确认）；过程回执=消息流末尾居中灰字（stamp 同款 .cmp-row），开始行带模型/提示词名、行尾「暂停」；取消走 /cancel→worker 批间检查，命中走失败路径不落候选不动时间线；已有候选/任务冲突只提示不自动覆盖（10-11 口径）；刷新页面灰字消失、任务后台继续] [注释时间 2026-11-14] */
  var CMP={st:0,sid:'',logId:'',parts:[]};   /* st: 0 没事 / 1 压缩中 / 2 终态行（完成·暂停·失败） */
  function cmpBtn(){ return ' <button type="button" class="stamp-btn tap" data-cmpstop>暂停</button>'; }
  function cmpRender(){ return esc(CMP.parts.join(' · '))+(CMP.st===1?cmpBtn():''); }
  function cmpPaint(){
    if(!CMP.st||CMP.sid!==LIVE.sid) return;
    var row=list.querySelector('.cmp-row');
    if(row&&row.isConnected){ row.innerHTML=cmpRender(); return; }
    rbForce=true; rebuild();
  }
  function compactNow(){
    if(!LIVE.sid){ toast('先从一个会话进来'); return; }
    if(CMP.st===1){ toast(CMP.sid===LIVE.sid?'压缩正在跑':'另一个会话还在压缩'); return; }
    var sid=LIVE.sid;
    stGet('').then(function(d){
      var cr=(d||{}).covered_range, from=(cr&&cr.end_index!=null)?Number(cr.end_index)+2:1;
      P.net.get(pvUrl(),{noLogin:true}).then(function(pv){
        var tot=Number((pv||{}).totalCompressible||0);
        if(!tot||from>tot){ toast('没有要压的'); return; }
        cmpStart(sid,from,tot);
      },function(){ toast('压缩范围读不出来'); });
    },function(){ toast('状态读不出来'); });
  }
  function cmpStart(sid,from,tot){
    CMP={st:1,sid:sid,logId:'',parts:['正在压缩','第'+from+'~'+tot+'条（'+(tot-from+1)+'条）']};
    rbForce=true; rebuild();
    P.net.get('/heartbeat/admin/context-compaction/config?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(c){
      if(CMP.st!==1||CMP.sid!==sid) return;
      var m=String((c&&c.compaction_model)||'').trim();
      if(m){ CMP.parts.push('模型 '+m); cmpPaint(); }
    },function(){});
    P.net.get('/heartbeat/admin/context-compaction/prompts?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(p){
      if(CMP.st!==1||CMP.sid!==sid) return;
      var sel=String((p&&p.selected)||''), nm='';
      ((p&&p.list)||[]).some(function(x){ if(x&&x.id===sel){ nm=String(x.name||''); return true; } return false; });
      if(nm){ CMP.parts.push('提示词「'+nm+'」'); cmpPaint(); }
    },function(){});
    stPost('/preview',{start:from,end:tot}).then(function(r){
      if(CMP.st!==1||CMP.sid!==sid) return;
      CMP.logId=String((r&&r.logId)||'');
      cmpPoll(sid,from,tot,0);
    },function(x){
      var msg=String((x&&x.message)||'');
      CMP.st=0;
      if(CMP.sid===sid){ rbForce=true; rebuild(); }
      if(/生成任务在跑/.test(msg)) toast('这个会话已有压缩在跑');
      else if(/候选/.test(msg)) toast('已有候选在等确认 · 去状态机面板处理后重试');
      else toast('没交上去：'+stWhyErr(x));
    });
  }
  function cmpPoll(sid,from,tot,n){
    if(CMP.st!==1||CMP.sid!==sid) return;
    stGet('').then(function(d){
      if(CMP.st!==1||CMP.sid!==sid) return;
      var cd=(d&&d.candidate&&d.candidate.exists)?(d.candidate.candidate||null):null;
      if(cd){ cmpCommit(sid,cd); return; }
      P.net.get('/heartbeat/admin/context-compaction/logs',{noLogin:true}).then(function(lg){
        if(CMP.st!==1||CMP.sid!==sid) return;
        var hit=null;
        ((lg&&lg.logs)||[]).some(function(x){ if(x&&x.id===CMP.logId){ hit=x; return true; } return false; });
        var st2=hit&&hit.status;
        if(st2==='error'||st2==='interrupted'||st2==='skipped'){
          var m=String(hit.message||'');
          CMP.st=2; CMP.parts=[/暂停/.test(m)?'压缩已暂停 · 没动任何消息':'压缩没成 · '+m.slice(0,60)]; cmpPaint(); return;
        }
        if(++n>100){ CMP.st=2; CMP.parts=['算了很久还没出来 · 去状态机面板看结果']; cmpPaint(); return; }
        setTimeout(function(){ cmpPoll(sid,from,tot,n); },3000);
      },function(){
        if(CMP.st!==1||CMP.sid!==sid) return;
        if(++n>100){ CMP.st=2; CMP.parts=['算了很久还没出来 · 去状态机面板看结果']; cmpPaint(); return; }
        setTimeout(function(){ cmpPoll(sid,from,tot,n); },3000);
      });
    },function(){
      if(CMP.st!==1||CMP.sid!==sid) return;
      if(++n>100){ CMP.st=2; CMP.parts=['算了很久还没出来 · 去状态机面板看结果']; cmpPaint(); return; }
      setTimeout(function(){ cmpPoll(sid,from,tot,n); },3000);
    });
  }
  function cmpCommit(sid,cd){
    var rg=cd.range||{};
    stPost('/commit',{state:cd.state,ops:cd.ops,start_msg:rg.start_msg,end_msg:rg.end_msg,range_label:rg.range_label,label_start:rg.label_start,label_end:rg.label_end,count:rg.count,source:'compact'})
      .then(function(o){
        if(CMP.sid!==sid) return;
        CMP.st=2;
        if(o&&o.ok===false) CMP.parts=['压缩没成 · '+String(o.error||'并入被拒').slice(0,60)];
        else { CMP.parts=['压缩完成 · 已并入 v'+((o&&o.version)||'?')+' · 压掉第'+(rg.start_num||'?')+'~'+(rg.end_num||'?')+'条（'+(rg.count||'?')+'条）']; buzz(8); }
        cmpPaint();
      },function(x){
        if(CMP.sid!==sid) return;
        CMP.st=2; CMP.parts=['压缩没成 · '+stWhyErr(x).slice(0,60)]; cmpPaint();
      });
  }
  function cmpStop(){
    if(CMP.st!==1) return;
    var sid=CMP.sid; buzz(10); toast('让它停下…');
    stPost('/cancel',{session:sid}).then(function(r){
      if(r&&r.ok===false) toast(String(r.error||'没停下来'));
      else if(r&&r.cancelled) toast('停下来了，等它收尾');
      else toast('那边没有在跑的压缩，已同步');
    },function(){ toast('没停下来'); });
  }
  /* 参数：和管理台「压缩参数配置」同一套字段 */
  /* [位置:phone-talk.js·stateCfg] [状态机参数面板·按会话读写] [用户 1027：原先参数读的是状态机页概览（preview 返回全局 config、不带会话模型），会话存了模型也总显示「跟随全局」——保存一直有传服务器、执行也生效，坏的只是这里念错账本；改成始终拉本会话合并后的 /config?session_id。先用本会话 5 分钟内的本地缓存（P.net.peek/keep）秒开，后台拉到新参数且面板还没动过就原位校正；模型行注释见 cfgSheet] [注释时间 2026-10-27] */
  function stateCfg(pg){
    var sid=stSid(), key='stcfg_'+sid, live={};
    var cached=P.net.peek?P.net.peek(key,3e5):null;
    if(cached) cfgSheet(pg,cached,sid,live);
    P.net.get('/heartbeat/admin/context-compaction/config?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(x){
      if(!x||typeof x!=='object'){ if(!cached) toast('参数读不出来'); return; }
      if(P.net.keep) P.net.keep(key,x);
      if(!cached){ cfgSheet(pg,x,sid,live); return; }
      if(live.box&&live.box.isConnected&&!live.touched&&live.apply){ try{ live.apply(x); }catch(e){} }
    },function(){ if(!cached) toast('参数读不出来'); });
  }
  function cfgSheet(pg,c,sid,live){
    var rows=[['自动分块间隔','分钟','compaction_gap_minutes'],['自动分块目标条数','条','compaction_chunk_size'],['块最少条数','条','compaction_chunk_min'],['块最多条数','条','compaction_chunk_max'],['上下文容量上限','字','compaction_context_limit_chars'],['提醒上限','tok，0 = 不提醒','ctx_limit_alert_tokens']];
    /* [位置:phone-talk.js·cfgSheet 模型行] [会话级状态机模型下拉] [10-29：原来点「模型选择」弹供应商分组长弹层，且空=跟随全局压缩角色；她要默认跟本会话聊天的模型、换起来快。改成原生下拉：空=跟随会话模型（后端没配 compaction_model 时自动用 session_cfg 的聊天模型，见 conversation-state.sessionCompactionModel），__role__=跟随全局状态机（压缩摘要角色），其余=具体模型（存 provider|model）。清单吃 aiprovs 本地缓存秒开，拉不到就只剩两个跟随项] [注释时间 2026-10-29] */
    var MDL={p:c.compaction_model_provider||'',m:c.compaction_model||'',pv:[]};    /* [位置:phone-talk.js·cfgSheet 提示词行] [会话级状态机提示词下拉] [11-01 #60：压缩状态的提示词存了多套、按会话选；空=跟随默认（全局自定义那份或内置）；选中即 POST /prompts select 落 session_cfg，分支继承自动带上；管理入口在下一行，删了正在用的套读侧自动回落全局] [注释时间 2026-11-01] */
    var PRM={list:[],sel:c.compaction_prompt_id||''};
    /* [位置:phone-talk.js·cfgSheet selFill] [两个下拉统一的填充函数] [11-14：iPhone 上「状态机提示词」那格整块空白（点开也没有选项）、「状态机模型」被截成「跟随会话…」——原来 select 是空壳、全靠 innerHTML 后填再赋 value，iOS 在抽屉还没可见时写进去的内容会被原生控件吞掉；而且 fillMdl 与 fillPrm 紧挨着，前一句出错后面整段（含 loadPrm、管理键、保存键监听）全被跳过；改成每次都用 DOM 造 option、清空用 removeChild、选中直接落到 selectedIndex 上（不靠 value 赋值、也不靠 innerHTML），重填幂等，谁调、调几次都安全] [注释时间 2026-11-14] */
    function selFill(sel,groups,val){
      if(!sel) return;
      while(sel.firstChild) sel.removeChild(sel.firstChild);   /* 不用 sel.remove(i)/innerHTML：老 iOS 上 remove(index) 行为不稳（当成要删的元素），removeChild 最兼容 */
      var idx=0, hit=-1;
      function addOpt(par,v,t){ var o=document.createElement('option'); o.value=v; o.textContent=t; par.appendChild(o); if(v===val) hit=idx; idx++; }
      (groups||[]).forEach(function(g){ if(!g||!g.items) return;
        if(g.label){ var og=document.createElement('optgroup'); og.label=g.label; g.items.forEach(function(it){ addOpt(og,it[0],it[1]); }); sel.appendChild(og); }
        else g.items.forEach(function(it){ addOpt(sel,it[0],it[1]); }); });
      sel.selectedIndex=hit>=0?hit:0;   /* 选中直接落到下标上：不靠 value 赋值（iOS 上赋空值/赋不存在的值会变成什么都不选 = 空白），也不靠 option.selected 属性（未插入时打不生效） */
    }
    function fillPrm(){
      var b=live.box; if(!b||!b.isConnected) return;
      var sel=b.querySelector('#tkStP'); if(!sel) return;
      var items=[['','跟随默认']];
      PRM.list.forEach(function(p){ items.push([String(p.id||''),String(p.name||'未命名')]); });
      selFill(sel,[{items:items}],PRM.sel||'');
      if(sel._f) return; sel._f=1;
      sel.addEventListener('change',function(){ live.touched=true; buzz(6);
        var v=sel.value;
        P.net.post('/heartbeat/admin/context-compaction/prompts?session_id='+encodeURIComponent(sid),{action:'select',id:v},{noLogin:true}).then(function(){
          PRM.sel=v;
          var ck=P.net.peek&&P.net.peek('stcfg_'+sid); if(ck){ ck.compaction_prompt_id=v; if(P.net.keep) P.net.keep('stcfg_'+sid,ck); }
          toast(v?'这套提示词只对本会话生效':'已改回跟随默认');
        },function(){ sel.value=PRM.sel||''; toast('没换上，再试一次'); });
      });
    }
    function loadPrm(){
      P.net.get('/heartbeat/admin/context-compaction/prompts?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(d){
        PRM.list=(d&&Array.isArray(d.list))?d.list:[];   /* [2026-11-14] 后端返回结构异常时不让它变成非数组，否则下面的 forEach 直接抛错、下拉又变空 */
        if(d&&typeof d.selected==='string') PRM.sel=d.selected;
        fillPrm();
      },function(){});
    }

    function mdlVal(){ if(!MDL.m) return ''; if(MDL.m==='__role__') return '__role__'; return MDL.p+'|'+MDL.m; }
    function fillMdl(){
      var b=live.box; if(!b||!b.isConnected) return;
      var sel=b.querySelector('#tkStM'); if(!sel) return;
      /* [位置:phone-talk.js·fillMdl 重填] [供应商清单异步到了也要能填进来] [11-14：原来 sel._f 一置位就再也不重填，而 aiprovs 清单是异步到的（缓存没命中时更晚），结果下拉里永远只剩「跟随会话模型/跟随全局状态机」两项、选不了具体模型；改成每次调用都重填内容，_f 只用来防重复挂监听] [注释时间 2026-11-14] */
      var groups=[{items:[['','跟随会话模型'],['__role__','跟随全局状态机']]}];
      MDL.pv.forEach(function(x){ if(!x||x.enabled===false||!Array.isArray(x.models)||!x.models.length) return;
        groups.push({label:String(x.name||x.id||'模型'),items:x.models.map(function(m){ return [String(x.id)+'|'+m,String(m)]; })}); });
      var v=mdlVal();
      if(v&&v!=='__role__'){ var has=false;
        groups.forEach(function(g){ if(g.label&&g.items.some(function(it){ return it[0]===v; })) has=true; });
        if(!has) groups[0].items.push([v,MDL.m+'（原选择）']); }   /* 存过的模型不在清单里（下架/改名）也照实显示，别假装跟会话 */
      selFill(sel,groups,v);
      if(sel._f) return; sel._f=1;
      sel.addEventListener('change',function(){ live.touched=true; buzz(6); var x=sel.value;
        if(!x){ MDL.p=''; MDL.m=''; }
        else if(x==='__role__'){ MDL.p=''; MDL.m='__role__'; }
        else { var mm=x.split('|'); MDL.p=mm[0]; MDL.m=mm.slice(1).join('|'); } });
    }
    (function(){ var cc=P.net.peek?P.net.peek('aiprovs',864e5):null;
      if(cc&&cc.length){ MDL.pv=cc; fillMdl(); return; }
      P.net.get('/heartbeat/admin/ai-providers',{noLogin:true}).then(function(r){ var a=(r&&r.providers)||[]; if(P.net.keep&&a.length) P.net.keep('aiprovs',a); MDL.pv=a; fillMdl(); },function(){ fillMdl(); }); })();
    /* [位置:phone-talk.js·cfgSheet 状态机参数折叠] [六项数字参数默认折叠并平滑展开] [11-20：小标题为状态机配置、折叠行为状态机参数；不用 details 瞬跳，改按钮控制 grid 高度，展开与收起都有过渡；保存与后台校正仍统一读写 input[data-k]] [注释时间 2026-11-20] */
    sheet('<div class="hd"><span>状态机配置</span></div><div class="opt"><div class="tk-cfg-nums"><button type="button" class="ro tap tk-cfg-fold" id="tkCfgFold" aria-expanded="false" aria-controls="tkCfgNums"><span class="tk-cfg-fl">状态机参数<small>分块、容量与提醒阈值</small></span><i class="tk-cfg-fc">'+I.down+'</i></button><div class="tk-cfg-nw" id="tkCfgNums" aria-hidden="true"><div class="tk-cfg-nb">'+rows.map(function(r){ return '<div class="ro"><label>'+r[0]+'<small>'+r[1]+'</small></label><input class="rn" type="number" data-k="'+r[2]+'" value="'+(c[r[2]]!=null?c[r[2]]:0)+'"></div>'; }).join('')+'</div></div></div>'+
      '<div class="ro"><label>状态机模型<small>没选就跟着这个会话聊天用的模型</small></label><select class="tk-sts" id="tkStM"><option value="">跟随会话模型</option><option value="__role__">跟随全局状态机</option></select></div>'+   /* [位置:phone-talk.js·cfgSheet 模型行返工] [样式返工·删重复行] [11-01：本行此前整行复制了两遍且 id 同名，第二行下拉恒为空、面板出现两行模型——删掉重复；select 加 tk-sts 专属类配细箭头；面板抽屉加 tk-cfg 类收紧行距、统一右侧控件宽高] [注释时间 2026-11-01，2026-11-14 两个跟随项直接写进 HTML 做兜底，不再等 JS 填] */
      '<div class="ro"><label>状态机提示词<small>压缩时用哪套写法</small></label><select class="tk-sts" id="tkStP"><option value="">跟随默认</option></select></div>'+   /* [2026-11-14] 跟随默认内联兜底：清单没拉到、JS 填失败、iOS 吞写入，这一格都不会是空白 */
      '<div class="ro"><label>管理提示词<small>新建、编辑、删除整套</small></label><button type="button" class="tap tk-prm-mg" id="tkStPmng">管理</button></div>'+
      '<div class="ro"><label>容量提醒开关<small>上下文快满时提醒他</small></label><select class="tk-sts" id="tkStRemind"><option value="1"'+(c.compaction_context_remind_enabled!==false?' selected':'')+'>开</option><option value="0"'+(c.compaction_context_remind_enabled!==false?'':' selected')+'>关</option></select></div>'+   /* [位置:phone-talk.js·cfgSheet 容量提醒下拉] [开关改为开/关下拉] [11-20：展示与其他下拉统一，保存仍提交 compaction_context_remind_enabled 布尔值] [注释时间 2026-11-20] */
      '<div class="ro"><label>容量提示词管理<small>编辑提醒他时用的写法</small></label><button type="button" class="tap tk-prm-mg" id="tkStCtxPmng">管理</button></div>'+   /* [位置:phone-talk.js·cfgSheet 容量提示词入口] [复用现有单模板编辑器] [11-20：入口放在容量提醒开关下，保存与恢复默认继续走 P.pedit 的 ctx-limit-prompt 接口] [注释时间 2026-11-20] */
      '</div><button class="nw tap" id="tkStSave">保存参数</button>','opts tk-cfg',function(box,close){
      live.box=box; live.touched=false;
      var on=c.compaction_context_remind_enabled!==false;
      /* 面板原位校正：后台拉到的新参数写进还没动过的面板；动过就不碰，用户手上的输入最大 */
      live.apply=function(nc){
        if(!nc||typeof nc!=='object') return;
        c=nc; on=nc.compaction_context_remind_enabled!==false;
        MDL.p=nc.compaction_model_provider||''; MDL.m=nc.compaction_model||'';
        if(nc&&nc.compaction_prompt_id!==undefined){ PRM.sel=nc.compaction_prompt_id||''; fillPrm(); }
        try{ fillMdl(); }catch(e){}   /* [2026-11-14] 原来只在 msel._f 已置位时改 value；现在改成重填（选项中带 selected），清单没同时也能选中 */
        var rem=box.querySelector('#tkStRemind'); if(rem) rem.value=on?'1':'0';
        Array.prototype.forEach.call(box.querySelectorAll('input[data-k]'),function(i){ var k=i.getAttribute('data-k'); i.value=(nc[k]!=null?nc[k]:0); });
      };
      box.addEventListener('input',function(){ live.touched=true; });
      /* [位置:phone-talk.js·cfgSheet 首填] [可见后再补一次] [11-14：iOS 上抽屉还没显示时写进 select 的内容会被原生控件吞掉，画出来就是格子空着；这里先填一次，等两帧（.show 加上、layout 完成）再补一次，可见状态下的写入才会真正画出来；两个下拉各自 try，前一句出错不拖累后一句（原来 fillMdl 抛错会连带 loadPrm、管理键、保存键三个监听全不挂）] [注释时间 2026-11-14] */
      try{ fillMdl(); }catch(e){}
      try{ fillPrm(); }catch(e){}
      loadPrm();
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ if(!box.isConnected) return; try{ fillMdl(); }catch(e){} try{ fillPrm(); }catch(e){} }); });
      setTimeout(function(){ if(!box.isConnected||live.touched) return; try{ fillMdl(); }catch(e){} try{ fillPrm(); }catch(e){} },180);   /* [2026-11-14] 再给一拍：抽屉 .show 的入场动画与 iOS 原生 select 首次布局都在这个窗口内，补这一次才真正常态化；live.touched 已置位（用户已经动了面板）就不覆盖 */
      var mbtn=box.querySelector('#tkStPmng'); if(mbtn) mbtn.addEventListener('click',function(){ buzz(6); prmSheet(sid,loadPrm); });
      var cpbtn=box.querySelector('#tkStCtxPmng'); if(cpbtn) cpbtn.addEventListener('click',function(){
        if(!P.pedit){ toast('提示词编辑器没加载上'); return; }
        buzz(6); close(); P.pedit(pg.closest('.win'),2);   /* 先收参数弹窗；.tk>.pg-sub 提到状态机页之上，返回编辑器后仍留在状态机页 */
      });
      var fold=box.querySelector('#tkCfgFold'), nums=box.querySelector('#tkCfgNums');
      if(fold&&nums) fold.addEventListener('click',function(){
        var sec=fold.closest('.tk-cfg-nums'), open=!sec.classList.contains('open');
        sec.classList.toggle('open',open); fold.setAttribute('aria-expanded',open?'true':'false'); nums.setAttribute('aria-hidden',open?'false':'true'); buzz(5);
      });
      var rem=box.querySelector('#tkStRemind'); if(rem) rem.addEventListener('change',function(){ live.touched=true; on=this.value==='1'; buzz(6); });
      box.querySelector('#tkStSave').addEventListener('click',function(){
        var body={compaction_context_remind_enabled:on,compaction_model_provider:MDL.p,compaction_model:MDL.m};
        Array.prototype.forEach.call(box.querySelectorAll('input[data-k]'),function(i){ body[i.getAttribute('data-k')]=Number(i.value)||0; });
        P.net.post('/heartbeat/admin/context-compaction/config?session_id='+encodeURIComponent(sid),body,{noLogin:true}).then(function(r){ if(r&&r.config){ if(P.net.keep) P.net.keep('stcfg_'+sid,r.config); live.apply(r.config); } close(); toast('参数存好了'); },function(){ toast('没存上'); });
      });
    });
  }

  /* ===================== 接后端（10-20）：登录了、从会话列表点进来的就是真会话 =====================
     读：GET /v1/history?mode=tail（不带 limit，带了反而会截掉最新的）+ /v1/events 有新消息就重拉 + 打开时 /v1/chat/status 看他是不是正在回。
     发：POST /v1/chat/completions 流式；reply_msg_id / client_msg_id 前端生成；收到 finish_reason 才算收完，没收到就去问 status。
     这几个都得带 X-Client: dylan-chat，不然后端直接 403。
     没接：重新生成（会删掉锚点之后的全部内容，连别的设备刚发的也删）、开分支（后端不检查新会话是否已存在，会覆盖）、停止、多选、往上翻更早的。 */
  var XC={'X-Client':'dylan-chat'}, WEEK=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];   /* 时间缀周几用英文，与旧 chat.html 同款（10-25：中文好傻） */
  /* 1021：可见性上报。服务端据此判断「她是不是真的在看」——决定 AI 回复完成时要不要推送。
     不关 SSE，实时能力不变。切后台时 iOS 会冻结 JS，所以离开那一刻必须先报出去。 */
  var VIS={last:null};
  function reportVisible(force){
    if(!LIVE||!LIVE.sid) return;
    var v=!document.hidden;
    if(!force&&VIS.last===v) return;
    VIS.last=v;
    try{ P.net.post('/v1/client-state',{session_id:LIVE.sid,visible:v},{headers:XC,noLogin:true,keepalive:true}); }catch(e){}
  }
  /* [位置:phone-talk.js·reportVisible visChg] [关页自卸] [原匿名监听卸不掉，旧闭包攥着旧会话 sid，切前后台给所有开过的历史会话都发 client-state；改具名函数 + isConnected 自卸] [注释时间 2026-10-26] */
  function visChg(){ if(!win.isConnected){ document.removeEventListener('visibilitychange',visChg); return; } reportVisible();
    /* [位置:phone-talk.js·visChg 恢复实时] [回到前台重新踢起打字机] [后台时 twTick 直接停（liveAlive 判 document.hidden），不补这一脚的话切回来画面就冻在半截，要等下一帧 SSE 才动] [注释时间 2026-10-27] */
    if(!document.hidden&&ST){ twSync(); if(TW.shown<twTotal()||TW.direct){ TW.ts=0; twKick(); } livePaintSoon(); } }
  document.addEventListener('visibilitychange',visChg);
  /* [位置:phone-talk.js·pagehide onHide] [关页自卸] [同 visibilitychange：原匿名监听卸不掉会按开过的会话数发多个 beacon；改具名函数 + isConnected 自卸] [注释时间 2026-10-26] */
  function onHide(){
    if(!win.isConnected){ window.removeEventListener('pagehide',onHide); return; }
    if(!LIVE||!LIVE.sid) return;
    try{
      if(navigator.sendBeacon) navigator.sendBeacon('/v1/client-state',new Blob([JSON.stringify({session_id:LIVE.sid,visible:false})],{type:'application/json'}));
      else P.net.post('/v1/client-state',{session_id:LIVE.sid,visible:false},{headers:XC,noLogin:true,keepalive:true});
    }catch(e){}
  }
  window.addEventListener('pagehide',onHide);
  function uuid(){ try{ if(crypto.randomUUID) return crypto.randomUUID(); }catch(e){} return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10); }
  function p2(n){ return ('0'+n).slice(-2); }
  function curTime(){ var d=new Date(); return '<current_time>'+WEEK[d.getDay()]+' '+p2(d.getFullYear()%100)+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+' '+p2(d.getHours())+':'+p2(d.getMinutes())+':'+p2(d.getSeconds())+'</current_time>'; }
  function mText(m){ return Array.isArray(m.content)?m.content.filter(function(x){ return x&&x.type==='text'; }).map(function(x){ return x.text||''; }).join(''):String(m.content==null?'':m.content); }
  function mImgs(m){ return Array.isArray(m.content)?m.content.filter(function(x){ return x&&x.type==='image_url'&&x.image_url; }).map(function(x){ return x.image_url.url; }):[]; }
  function mFiles(m){ return Array.isArray(m.content)?m.content.filter(function(x){ return x&&x.type==='file'&&x.file; }).map(function(x){ return x.file; }):[]; }
  /* [位置:phone-talk.js·fileCardHTML/extBadge/fmtSize] [文件卡的内容] [图标上的扩展名徽标、大小换算、点开链接] [注释时间 2026-10-21]
     只允许 http(s) 与站内 /uploads 开头的链接，其余一律不给 href（防 javascript: 之类）。 */
  function extBadge(n){ var m=/\.([a-zA-Z0-9]{1,8})$/.exec(String(n||'')), e=m?m[1].toUpperCase():'?'; if(/^(PNG|JPG|JPEG|WEBP|GIF)$/.test(e)) return '图'; return e.length>5?e.slice(0,4)+'…':e; }
  function fmtSize(n){ n=Number(n)||0; if(n>=1048576) return (n/1048576).toFixed(1)+'MB'; if(n>=1024) return Math.round(n/1024)+'KB'; return n?n+'B':''; }
  function fileCardHTML(f){ var nm=String(f.name||'文件'), meta=[]; if(f.mime) meta.push(f.mime.split(';')[0]); var sz=fmtSize(f.size); if(sz) meta.push(sz);
    var ok=/^(https?:\/\/|\/uploads\/)/.test(String(f.url||'')), href=ok?' href="'+esc(f.url)+'" target="_blank" rel="noopener"':'';
    return '<a class="tk-fc"'+href+'><span class="ic">'+esc(extBadge(nm))+'</span><span class="in"><b>'+esc(nm)+'</b><small>'+esc(meta.join(' · '))+'</small></span><i class="dl"><svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19h14"/></svg></i></a>'; }
  /* [位置:phone-talk.js·vFileKind/vFileCardHTML] [<file> 标签文件卡的内容] [11-05：AI 用 <file> 标签发的文件没有 url，画成 button 卡（结构与上传文件卡 .tk-fc 同款），点一下开应用内预览（openFilePreview）；类型行给一句人话（Markdown 文档/表格数据/代码文件…）+大小；格式沿用 extBadge/fmtSize] [注释时间 2026-11-05] */
  function vFileKind(n){ var e=(String(n||'').match(/\.([a-zA-Z0-9]{1,8})$/)||[])[1]||''; e=e.toLowerCase();
    if(e==='md'||e==='markdown') return 'Markdown 文档';
    if(e==='csv'||e==='tsv') return '表格数据';
    if(e==='json'||e==='yml'||e==='yaml'||e==='ini'||e==='toml') return '配置数据';
    if(e==='html'||e==='htm'||e==='xml'||e==='svg') return '网页文件';
    if(/^(js|ts|jsx|tsx|py|css|scss|sh|bash|java|go|c|h|cpp|rs|rb|php|sql|lua|swift|kt)$/.test(e)) return '代码文件';
    return '文本文档'; }
  function vFileCardHTML(f){ var kb=f.size?fmtSize(f.size):'';
    return '<button class="tk-fc tap" type="button" data-vf="'+esc(f.key)+'"><span class="ic">'+esc(extBadge(f.name))+'</span><span class="in"><b>'+esc(f.name)+'</b><small>'+esc(vFileKind(f.name))+(kb?' · '+kb:'')+'</small></span><i class="dl"><svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19h14"/></svg></i></button>'; }
  /* [位置:phone-talk.js·stripCT] [给用户看的正文统一剥系统标签] [10-29 #49：[elapsed:2h] 时间差标签网关落盘在消息正文里（给 AI 看），气泡/复制/朗读/分支名/通知都经本函数剥掉不显示；编辑框走 mText 原文不过这里——编辑保存 tag 原样保留] [注释时间 2026-10-29] */
  function stripCT(t){ return String(t||'').replace(/\n?<current_time>[\s\S]*?<\/current_time>/gi,'').replace(/\n?<session>[\s\S]*?<\/session>/gi,'').replace(/\n?\[elapsed:[^\]]*\]/gi,''); }
  /* 他正文里给后端看的标签（记忆、钉、唤醒、电话、星标、留纸、[push]、[DIARY]），照旧聊天页 stripInnerTags 剥掉 */
  /* [位置:phone-talk.js·stripTagsOld] [旧版剥离兜底（phone-tags.js 没加载上时用）] [10-31 补 claim 三条规则，与新版同口径：带属性的开标签=自闭合指令只删标记、配对整段删、裸开标签没闭合才删到结尾——缺第一条时 <claim clear> 会把后面整段正文吞光；2026-11-01 补孤儿标记清理] [注释时间 2026-10-31；2026-11-01 补清理] */
  function stripTagsOld(t){ return String(t||'').replace(/<\s*memory\b[^>]*>[\s\S]*?<\s*\/memory\s*>/gi,'').replace(/<\s*pin\b[^>]*>[\s\S]*?<\s*\/pin\s*>/gi,'').replace(/<\s*wake\b[^>]*>[\s\S]*?<\s*\/wake\s*>/gi,'').replace(/<\s*quiet\b[^>]*>[\s\S]*?<\s*\/quiet\s*>/gi,'').replace(/<\s*phone\b[^>]*>[\s\S]*?<\s*\/phone\s*>/gi,'').replace(/<\s*result\b[^>]*>[\s\S]*?<\s*\/result\s*>/gi,'').replace(/<\s*call_id\b[^>]*>[\s\S]*?<\s*\/call_id\s*>/gi,'').replace(/<\s*star\b[^>]*>(?:\s*<\s*\/star\s*>)?/gi,'').replace(/<\s*active\b[^>]*>[\s\S]*?<\s*\/active\s*>/gi,'').replace(/<\s*claim\b(?=\s)[^>]*>/gi,'').replace(/<\s*claim\b[^>]*>[\s\S]*?<\s*\/claim\s*>/gi,'').replace(/<\s*claim\s*>[\s\S]*$/i,'').replace(/<\s*title\b[^>]*>[\s\S]*?<\s*\/title\s*>/gi,'').replace(/<\s*title\b[^>]*>[\s\S]*$/i,'').replace(/<\s*status\b[^>]*>[\s\S]*?<\s*\/status\s*>/gi,'').replace(/<\s*status\b[^>]*>[\s\S]*$/i,'').replace(/<\s*album\b[^>]*>[\s\S]*?<\s*\/album\s*>/gi,'').replace(/<\s*album\b[^>]*\/\s*>/gi,'').replace(/<\s*paper\b[^>]*\/\s*>/gi,'').replace(/<\s*paper\b[^>]*>([\s\S]*?)<\s*\/paper\s*>/gi,'$1').replace(/<\s*\/?\s*paper\b[^>]*>/gi,'').replace(/\[push\]\s*([\s\S]*?)\s*\[\/push\]/gi,'$1').replace(/\[DIARY\][\s\S]*?\[\/DIARY\]/gi,'').replace(/\[DIARY\][\s\S]*$/i,'').replace(/\[DIARY\]|\[\/DIARY\]/gi,'').replace(/<\s*\/?\s*claim\b[^>]*>/gi,''); }
  /* [位置:phone-talk.js·stripTags] [前端剥标签：清单与「不解析」掩码改读 workspace/phone-tags.js（和服务端同一份）] [10-28 第6项：原来这里手写一串正则（和服务端、流式过滤、HIDE_RE 各一份，口径不一致）；围栏/~~~/code·pre/表格/行内反引号里的标签不剥。phone-tags.js 没加载上（页面缓存了旧 html）时退回上面的旧实现] [注释时间 2026-10-28] */
  function stripTags(t){ return window.PHTags?PHTags.strip(t,'fe'):stripTagsOld(t); }
  /* 推送 / 没推送的回执：后端没有结构化字段，只能照旧聊天页按开头的字认 */
  function kindOf(m){ var c=String(typeof m.content==='string'?m.content:'').trim(); if(c.indexOf('（')!==0&&!/^(发送成功，时间：|本次未推送|未发送推送)/.test(c)) return ''; if(/醒来写了日记|自动写了日记/.test(c)) return 'diary'; if(/未发送推送|未推送|本次未发送/.test(c)) return 'silent'; if(/^发送成功，时间：/.test(c)||/刚刚给.{1,24}发了.{1,24}?推送：/.test(c)) return 'push'; return ''; }
  /* [位置:phone-talk.js·stampFor] [时间线显示规则] [10-28：参考旧 chat（距上一次显示的时间线满 5 分钟显示一次具体时间）；满 5 小时或者跨天显示「今天/昨天/M月D日 + 时分」；第一条也带日期。原来是距上一条消息 20 分钟显示一次] [注释时间 2026-10-28] */
  function stampFor(t,last){
    if(!last||new Date(t).toDateString()!==new Date(last).toDateString()||t-last>=5*3600000) return stampOf(t);
    if(t-last>=5*60000){ var d=new Date(t); return p2(d.getHours())+':'+p2(d.getMinutes()); }
    return ''; }
  function stampOf(t){ var d=new Date(t), n=new Date(), y=new Date(n.getFullYear(),n.getMonth(),n.getDate()-1), hm=p2(d.getHours())+':'+p2(d.getMinutes());
    if(d.toDateString()===n.toDateString()) return '<b>今天</b> '+hm; if(d.toDateString()===y.toDateString()) return '<b>昨天</b> '+hm; return '<b>'+(d.getMonth()+1)+'月'+d.getDate()+'日</b> '+hm; }
  /* 他回复里的 <card>{JSON}</card>：摘出来画成卡片；流式时还没写完的 <card>… 先藏起来（照旧聊天页 chat-cards.js） */
  /* [位置:phone-talk.js·crv] [回执在显示层怎么处理（委托 phone-tags.js·cardReplyView）] [11-06：答案搬进 <card_reply> 里，显示要保留内容；老格式内嵌 JSON 与自闭合形态照旧丢掉。页面缓存了旧 phone-tags.js（没有 cardReplyView）时退回旧行为——整段删] [注释时间 2026-11-06] */
  function crv(t){ if(window.PHTags&&PHTags.cardReplyView) return PHTags.cardReplyView(t);
    return String(t==null?'':t).replace(/\n?<card_reply\b[^>]*\/>/gi,'').replace(/\n?<card_reply\b[^>]*>[\s\S]*?<\/card_reply>/gi,''); }
  function hsh(x){ var h=5381,i; for(i=0;i<x.length;i++) h=((h<<5)+h+x.charCodeAt(i))|0; return (h>>>0).toString(36); }
  var VFMAP={};   /* [位置:phone-talk.js·VFMAP] [<file> 文件体暂存] [AI 用 <file> 标签发的文件：卡片上只放指纹 key，文件名与内容存这里、点击时取——内容不塞 DOM 属性（转义地狱且超长）；同内容共享同一条] [注释时间 2026-11-05] */
  /* [位置:phone-talk.js·cardFrom] [<card> 里 JSON 的解析与容错] [11-06：卡片 JSON 少一个 } 时整块静默消失。修复算法收拢到 workspace/phone-tags.js 一份（服务端落库前 server.js·appendMessages·card 用同一份，前端不再各写一套）；这里只取结果。页面缓存了旧 phone-tags.js（没有 parseCard）时退回裸 JSON.parse，行为与修复前一致] [注释时间 2026-11-06] */
  function cardFrom(j,cm){
    var raw=(cm?cm.restore(j):j).trim(), c=null;
    if(window.PHTags&&PHTags.parseCard){
      var r=PHTags.parseCard(raw);
      if(r){ c=r.card; if(r.fixed) console.warn('[卡片] JSON 有语法错，已自动修好：'+raw.slice(0,60)); }
      else console.warn('[卡片] JSON 修不好，正文留了提示：'+raw.slice(0,200));
    } else {
      try{ c=JSON.parse(raw); }catch(e){ c=null; }
      if(c&&typeof c==='object'&&!(typeof c.type==='string'&&c.type)) c=null;
    }
    if(!c||typeof c!=='object') return null;
    if(!c.id) c.id='c'+hsh(JSON.stringify(c));
    return c;
  }
  /* [位置:phone-talk.js·cardsOf] [摘卡片 <card> 和表情包 <sticker> —— 代码块/表格/行内反引号里的不摘（讲解用）] [10-28 第6项：和服务端同一套掩码（PHTags.mask）；card 里的 JSON 先还原再解析。11-06 补：要求 <card> 后面紧跟 { 才算卡片（讲解里提到 <card> 字样时不再把后面一张真卡片连人带尾标签一起吞掉），解析失败走 cardFrom 修复，修不好在正文留一行提示] [注释时间 2026-10-28；2026-11-06 补] */
  function cardsOf(t){ var cards=[], cm=window.PHTags?PHTags.mask(String(t==null?'':t)):null, x=cm?cm.text:String(t==null?'':t);
    x=x.replace(/<card>\s*(\{[\s\S]*?)<\/card>/gi,function(_,j){ var c=cardFrom(j,cm); if(c){ cards.push(c); return ''; } return '（这张卡片没画出来：格式有误）'; });
    /* [位置:phone-talk.js·cardsOf 文件] [11-05：AI 回复里的 <file name="xx.txt">内容</file> 摘出来画成文件卡（点开可预览、可下载）；代码块/表格/行内反引号里的不摘（讲解用，与服务端同一套掩码）；流式时没写完的（<f、<fi、<fil、<file、<file n… 到结尾）先藏起来，闭合后才变卡——与 <card> 半截同口径] [注释时间 2026-11-05] */
    x=x.replace(/<\s*file\b([^>]*)>([\s\S]*?)<\s*\/\s*file\s*>/gi,function(_,attr,body){
      var m=attr.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/i);
      var nm=m?String(m[1]!==undefined?m[1]:(m[2]!==undefined?m[2]:m[3])).replace(/\\/g,'').trim():'';
      var b=cm?cm.restore(body):body;
      if(!nm) nm='文件.txt';
      var key='vf:'+hsh(nm+'\u0001'+b.length+'\u0001'+b.slice(0,120));
      if(!VFMAP[key]){ var sz=b.length; try{ sz=new Blob([b]).size; }catch(e){}
        VFMAP[key]={key:key,name:nm,body:b,size:sz}; }
      cards.push({type:'__file',ref:VFMAP[key]}); return ''; })
      .replace(/<\s*\/\s*file\s*>/gi,'');   /* 孤儿收尾标签（有尾没头）直接删 */
    x=x.replace(/<\s*f(?:i(?:l(?:e(?:\b[^>]*)?)?)?)?[\s\S]*$/i,'');
    /* [位置:phone-talk.js·cardsOf 表情包] [10-24：他回复里的 <sticker id="编号"/> 摘出来画成表情包图；没写完的（含 <s、<sticker id="cr 这种半截）先藏起来] [注释时间 2026-10-24] */
    x=x.replace(/<\s*sticker\b[^>]*?\bid\s*=\s*["']?([\w-]+)["']?[^>]*>/gi,function(_,id){ cards.push({type:'__stk',id:id}); return ''; }).replace(/<\s*s(?:t(?:i(?:c(?:k(?:e(?:r(?:\b[^>]*)?)?)?)?)?)?)?$/i,'');

    x=x.replace(/<\s*card\s*>\s*(?:\{[\s\S]*)?$/i,''); if(cm) x=cm.restore(x);   /* 流式半截才藏：<card>{ 到结尾、或 <card> 刚冒出来还没等到 {；正文里提到 <card> 字样（后面不是 {）不藏、也不改原文 */ return {text:x.replace(/\n{3,}/g,'\n\n').trim(),cards:cards}; }
  var rbForce=false, rbAnchor=false, TAILNEXT=0;   /* TAILNEXT：下一次 rebuild 首屏只画最后几条（打开会话时设 6，画完清零） */
  /* [位置:phone-talk.js·boardFeed] [棋盘卡的事件流：从消息历史里摘出某一局] [11-22：AI 的 <card> 里 type=board 且 id 相同的 → {raw,card}；我发的 <card_reply … type="board">（属性里带前端算好的盘面）→ {raw,u:属性}；按消息顺序排好交给 phone-cards.js·bdReplay 回放。发送失败的回执不算。每次渲染 BFC 清一次（见 render 卡片ctx），同一局只摘一遍] [注释时间 2026-11-22] */
  var BFC={};
  function bdAttrs(s){ var o={}, re=/([\w-]+)\s*=\s*"([^"]*)"/g, m; while((m=re.exec(s))) o[m[1]]=m[2]; return o; }
  function boardFeed(id){
    if(BFC[id]) return BFC[id];
    var out=[];
    (LIVE.raw||[]).forEach(function(m){
      if(!m||m._fail) return;
      var t=mText(m); if(t.indexOf('board')<0) return;
      if(m.role==='user'){
        var re=/<card_reply\b([^>]*)>/gi, x, a;
        while((x=re.exec(t))){ a=bdAttrs(x[1]); if(a.id===id&&a.type==='board') out.push({raw:m,u:a}); }
      }else{
        cardsOf(stripTags(t)).cards.forEach(function(c){ if(c&&c.type==='board'&&c.id===id) out.push({raw:m,card:c}); });
      }
    });
    return (BFC[id]=out);
  }
  function cardAnswer(res){ var say=P.cards&&P.cards.said?P.cards.said(res):'', body=say;
    if(!body){ if(res.type==='fortune') body='我抽到了：'+res.text; else if(res.type==='rps') body='猜拳结果：'+res.text; else if(res.type==='checklist'){ if(!res.all) return; body='小清单都划掉了'; } else body=res.text||'好'; }
    if(!LIVE.on){ toast('没连上后台，没发出去'); return; }
    var msg='<card_reply id="'+res.id+'"'+(res.attr||'')+'>'+body+'</card_reply>', tries=0, sid0=LIVE.sid;   /* 11-22：res.attr 只有棋盘卡有（type/move/board 等属性，显示层不露，AI 看得到） */   /* 11-06：答案装在标签里（标签外不再有正文，同一份信息只出现一次）——内容是 phone-cards.js·blocks/summary 拼的「块 id：答案」，键就是卡片上的块 id，天然一一对应 */
    /* [位置:phone-talk.js·cardAnswer 等待] [忙时答案不丢] [11-13 审查：原来死等 40x700ms 约 28 秒后直接 liveSend，此时他还在回就走到拒绝分支，卡片答案静默消失；卡片点选时已经锁定成「已答」，答案不能丢，所以改成一直等到不忙再发（忙由 SSE 收尾 / status / 5 分钟硬顶三道清），等过 5 秒提示一次；页面关掉就停；liveSend 仍然拒（语音没处理完）时把答案放回输入框，不丢字] [注释时间 2026-11-13] */
    (function go(){ if(!win.isConnected||LIVE.sid!==sid0) return; if(LIVE.busy){ if(tries===8){ toast('他还在回上一条，这条答案等他回完自动发'); buzz([20,30,20]); } tries++; setTimeout(go,700); return; }
      var isTouch=res.type==='touch', tx0=isTouch?(ta.value||'').replace(/\s+$/,''):'';
      var hasAtt=isTouch&&ATT.length&&ATT.every(function(a){ return a.st==='ready'; });
      var outMsg=tx0.trim()?tx0+'\n'+msg:msg;
      if(isTouch) outMsg=quoteApply(outMsg);
      if(liveSend(outMsg,hasAtt?ATT.map(attPart):undefined)){
        if(isTouch){ dropSuggest(false); if(tx0.trim()){ ta.value=''; ta.dispatchEvent(new Event('input')); } quoteClear(); if(hasAtt){ ATT=[]; attPaint(); } }
      } else { ta.value=(ta.value?ta.value+'\n':'')+body; ta.dispatchEvent(new Event('input')); toast('这条答案没发出去，先放输入框了'); buzz([20,30,20]); } })(); }
  function hasChain(m){ return !!(m.reasoning||(m.tools&&m.tools.length)||(m.stream_timeline&&m.stream_timeline.some(function(n){ return n&&n.type==='tool'; }))); }
  /* [位置:phone-talk.js·naReason] [静默原因提取] [2026-11-19：<noaction> 常写在 <trace> 后面，开头判定够不着，原因被 fe:drop 剥掉，工具行下面像空气泡。从标签里取出原因，代码块里的不算；纯静默没写原因的返回空] [注释时间 2026-11-19] */
  function naReason(m){
    var c=String(m&&m.content==null?'':m.content);
    var cm=window.PHTags?PHTags.mask(c):null, x=cm?cm.text:c, re=/<\s*noaction\b[^>]*>([\s\S]*?)<\s*\/\s*noaction\s*>/gi, parts=[], mm, seen={};
    while((mm=re.exec(x))){
      var inn=stripTags(stripCT(cm?cm.restore(mm[1]):mm[1])).replace(/^\s*原因[：:]\s*/,'').trim();
      if(inn&&!seen[inn]){ seen[inn]=1; parts.push(inn); }
    }
    return parts.join('\n').trim();
  }
  function naHead(c){ c=String(c==null?'':c).replace(/^\s*<wake\b[^>]*>[\s\S]*?<\/wake>\s*/i,''); return /^\s*(\[NO_ACTION\]|<\s*noaction\b)/i.test(c); }
  function fromRaw(raw){
    var out=[], last=0;
    raw.forEach(function(m){ var t=+new Date(m.time)||0;
      /* [位置:phone-talk.js·fromRaw 时间线] [气泡样式不画时间分割线] [10-30：时间改成名字旁的手写日期时间；极简样式照旧画分割线；回执/日记那种文字提示行（kd）不受影响] [注释时间 2026-10-30] */
      if(t&&MIN){ var sf=stampFor(t,last); if(sf){ out.push({k:'stamp',h:sf}); last=t; } }
      if(m.role==='user'){ mImgs(m).forEach(function(u){ out.push({s:'me',img:1,url:u,raw:m}); });
        mFiles(m).forEach(function(f){ out.push({s:'me',file:f,raw:m}); });
        var ux=crv(stripCT(mText(m))).trim(); var vm=ux.match(/^\[语音消息 (\d+)秒 #([\w-]+)\]\s*([\s\S]*)$/); if(vm) out.push({s:'me',voice:Math.max(1,+vm[1]),vid:vm[2],x:m._vp?'':(vm[3].trim()||'［无人声］'),pend:m._vp?m._vp.st:'',src:m._vp?m._vp.src:'',raw:m}); else if(ux){ var sk=[], utx=ux.replace(/<\s*sticker\b[^>]*?\bid\s*=\s*["']?([\w-]+)["']?[^>]*>/gi,function(_,id){ sk.push(id); return ''; }).trim(); if(utx) out.push({s:'me',x:utx,raw:m}); sk.forEach(function(id){ out.push({s:'me',sticker:id,raw:m}); }); } if(m._fail) out.push({k:'fail',why:m._fail.why,raw:m}); return; }
      var kd=kindOf(m), cx=cardsOf(stripTags(mText(m))), tx=cx.text;
      if(kd==='silent'||kd==='diary'){ if(tx) out.push({k:'stamp',h:esc(tx.length>40?tx.slice(0,40)+'…':tx)}); return; }
      var ch=hasChain(m);
      /* [位置:phone-talk.js·fromRaw wk] [唤醒轮标记透传] [2026-10-31：把 /v1/history 下发的 m.wake 抄到每个 ai 项上，render 分组见 wk 断组（唤醒后他主动说的话另起一组带头像）] [注释时间 2026-10-31] */
      var wk=m.wake?1:0;
      /* [位置:phone-talk.js·fromRaw pushWhy] [trace 后面的静默原因补成虚线气泡] [2026-11-19：开头就是 noaction 的仍走下面的早退（思考/工具+虚线原因）。先写 trace 再写 noaction 的不进早退，正常画出思考/工具/此刻后，把原因补在这条末尾，刷新即见，不靠 kind] [注释时间 2026-11-19] */
      var why=naHead(m.content)?'':naReason(m);
      function pushWhy(){ if(!why) return; var e={s:'ai',x:why,raw:m,rec:ch,na:1}; if(wk) e.wk=wk; out.push(e); }
      /* [位置:phone-talk.js·fromRaw na] [noaction 静默消息显示] [2026-11-01 用户需求：唤醒时「这轮不推」的原因在消息流里当正常消息显示，虚线弱化气泡。2026-11-19：开头判定允许先剥一个 <wake>，不再单靠 kind——kind 把「trace 在前」也卷进来会把此刻和原因一起吞掉] [注释时间 2026-11-19] */
      if(naHead(m.content)){
        var naTx=stripCT(mText(m))
          .replace(/<\s*noaction\b[^>]*>([\s\S]*?)<\/\s*noaction\s*>/i,'$1')
          .replace(/<\s*noaction\b[^>]*\/?>\s*/gi,'')
          .replace(/^\s*\[NO_ACTION\]\s*/i,'');
        naTx=stripTags(naTx).trim();
        /* [位置:phone-talk.js·fromRaw na 思考工具] [2026-11-01：静默消息在时间线里算正常消息，思考/工具也要能看——极简与正常消息同路（mnUnits 平铺思考/工具行，正文传 na 文本、卡片照摘）；普通皮肤与正常消息一致：正文直接显示、思考/工具点该组头像开抽屉（raw/rec 已随项透传，GR 取的就是本条 raw）] [注释时间 2026-11-01] */
        if(naTx){
          if(MIN&&ch){ mnUnits(m,ch,{text:naTx,cards:cx.cards}).forEach(function(e){ if(!e.chain) e.na=1; if(wk) e.wk=wk; out.push(e); }); return; }
          aiTx(m,naTx,ch,cx.cards).forEach(function(e){ e.na=1; if(wk) e.wk=wk; out.push(e); });
        }
        return;
      }
      mImgs(m).forEach(function(u){ out.push({s:'ai',img:1,url:u,raw:m,rec:ch,wk:wk}); });
      mFiles(m).forEach(function(f){ out.push({s:'ai',file:f,raw:m,rec:ch,wk:wk}); });
      /* [位置:phone-talk.js·fromRaw trace] [此刻 <trace> 一行小字] [AI 每条回复末尾可写 <trace>，落盘处剥成 m.trace；这里在这条回复的最后一个单元后面挂一行「✦ 开头文字 ▸」，点开看整句；普通/极简皮肤同路。新结构 {content}，旧拆字段结构兼容历史消息] [注释时间 2026-11-07] */
      var trU=(m.trace&&(m.trace.content||m.trace.scent||m.trace.note||m.trace.want||m.trace.chose||m.trace.held||(m.trace.moves&&m.trace.moves.length)))?{s:'ai',trace:m.trace,key:'trc:'+(m.id||''),raw:m,rec:ch,wk:wk}:null;
      if(MIN&&ch){ mnUnits(m,ch,cx).forEach(function(e){ if(wk) e.wk=wk; out.push(e); }); if(trU&&!out.some(function(e){ return e.raw===m&&e.chain&&e.chain.k==='trace'; })) out.push(trU); pushWhy(); return; }   /* 11-18：正文里有 trace 原文（已拆成折叠行）就不再挂尾 trU，防重复显示；旧消息无原文走挂尾折叠行。11-19：trace 后的 noaction 补在此刻下面 */
      if(MIN){
        var pk0=splitTrace(mText(m));
        if(pk0){
          var trIdx0=0, mk0=(m.id||'m');
          pk0.forEach(function(pc){
            if(pc.trq!=null) out.push({s:'ai',chain:{k:'trace',text:pc.trq},key:mk0+':tr'+(trIdx0++),raw:m,rec:ch,wk:wk});
            else { var c0=cardsOf(stripTags(pc.tx)); aiTx(m,c0.text,ch,c0.cards).forEach(function(e){ if(wk) e.wk=wk; out.push(e); }); }
          });
          pushWhy(); return;
        }
      }
      aiTx(m,tx,ch,cx.cards).forEach(function(e){ if(wk) e.wk=wk; out.push(e); });
      if(trU) out.push(trU);
      pushWhy();
    });
    return out;
  }
  /* [位置:phone-talk.js·sigOf] [消息序列指纹] [reload 拉回来的尾部跟屏幕上画的完全一样就别整页重画了：收尾后 1.5 秒那次 reload、以及每条 SSE history_update 都会 rebuild 一次，一条一万字的回复等于重复渲染几十遍，超长会话一卡就卡几秒] [注释时间 2026-10-27] */
  function sigOf(raw){ var s=''; for(var i=0;i<raw.length;i++){ var m=raw[i]; if(!m) continue; var c=m.content, n=typeof c==='string'?c.length:(c&&c.length)||0; s+=m.id+':'+n+','; } return s; }
  function rebuild(){ if(!win.isConnected) return;   /* [位置:phone-talk.js·rebuild 守卫] [窗口关掉后不再重画] [2026-10-27 审查：流式生成中关掉聊天页，SSE 每帧仍经 liveFrame→rebuildSoon→rebuild 全量重画一个没人看的窗口直到流结束（10-27 修过打字机路径，这条 rebuild 路径漏了）] [注释时间 2026-10-27] */ busyPaint(); LIVE.sig=sigOf(LIVE.raw);   /* 指纹跟着画完的这份走，done 之后 1.5 秒那次 reload 拉到同样的尾部就不会再整页重画 */
    var out=fromRaw(LIVE.raw);
    if(ST) out.push({k:'live'});
    /* 2026-11-15：失败条不再统一兜在末尾，各条消息自己带（见 fromRaw） */
    if(LIVE.partial&&!ST&&LIVE.raw.indexOf(LIVE.partial)>=0) out.push({k:'cut',synced:!!LIVE.partial.synced});
    /* [位置:phone-talk.js·rebuild 压缩回执行] [/compact 过程灰字挂消息流末尾] [随手记 #20：压缩中/收尾提示都画在居中灰字（stamp 同款）；文本更新走 cmpPaint 的 .cmp-row 原位改，不走这里；切到别的会话不画（CMP.sid 校验）] [注释时间 2026-11-14] */
    if(CMP.st&&CMP.sid===LIVE.sid) out.push({k:'stamp',h:cmpRender(),cmp:1});
    if(!out.length) out.push({k:'stamp',h:'还没有消息，说点什么吧'});
    var _tl=TAILNEXT; TAILNEXT=0;
    MSGS=out; render(rbForce?true:rbAnchor?'anchor':false, _tl); rbForce=false; rbAnchor=false;
    if(LIVE.dw&&ST&&LIVE.dw.isConnected) dwPaint(LIVE.dw);
  }
  var rbT=0; function rebuildSoon(){ if(rbT) return; rbT=setTimeout(function(){ rbT=0; rebuild(); },140); }
  /* 1021：打开只拉最后 20 条（last=20；2026-10-27 从 40 降到 20——超长会话首屏少渲染一半），之后刷新按「已有的尾部条数 + 20」拉，往上翻再走 before 懒加载 */
  function reload(){ if(!LIVE.sid) return Promise.resolve(); if(LOC) return Promise.resolve(); LIVE.__rb=0;
    var want=Math.max(20,((LIVE.raw.length-(LIVE.older||[]).length)||0)+20);
    var oldFirst=LIVE.raw.length?LIVE.raw[0].id:null;
    return P.net.req('/v1/history?session_id='+encodeURIComponent(LIVE.sid)+'&mode=tail&last='+want,{headers:XC,noLogin:true}).then(function(r){ var tail=(r&&r.items)||[], ids={};
      tail.forEach(function(m){ ids[m.id]=1; }); LIVE.older=(LIVE.older||[]).filter(function(m){ return !ids[m.id]; });
      if(LIVE.more==null) LIVE.more=!!(r&&r.has_more);
      if(!(LIVE.older||[]).length&&tail.length>90){ LIVE.raw=tail.slice(-90); LIVE.more=true; }
      else LIVE.raw=(LIVE.older||[]).concat(tail);
      /* 10-23 需求 56：多要的那 20 条是更早的，插在最上面会把正在看的位置顶走、还被当成「新消息」数进角标；
         前端已有的最早一条之前的不要，要看更早的还是翻到顶再加载 */
      if(oldFirst!=null){ var cut=-1; for(var q=0;q<LIVE.raw.length;q++){ if(LIVE.raw[q].id===oldFirst){ cut=q; break; } }
        if(cut>0){ LIVE.raw=LIVE.raw.slice(cut); LIVE.more=true; var have2={}; LIVE.raw.forEach(function(m){ have2[m.id]=1; }); LIVE.older=(LIVE.older||[]).filter(function(m){ return have2[m.id]; }); } }
      if(LIVE.partial){ var pr=LIVE.partial; if(LIVE.raw.some(function(m){ return m.id===pr.id; })) LIVE.partial=null;
        else if(!LIVE.byStatus&&LIVE.raw.length&&LIVE.raw[LIVE.raw.length-1].role==='user'){ pr.synced=1; LIVE.raw.push(pr); } }
      LIVE.fresh=true; LIVE.cached=false; LIVE.total=r&&r.total; verLoad();   /* 11-10 版本表跟着拉，没有版本后端回空表 */
      if(LIVE.vpend&&LIVE.raw.indexOf(LIVE.vpend)<0) LIVE.raw.push(LIVE.vpend);
      (LIVE.fails||[]).forEach(function(m){ if(m&&LIVE.raw.indexOf(m)<0) LIVE.raw.push(m); });   /* 2026-11-15：没发出去的那几条（可能不止一条）reload 后都补回来，各自的重试才有落处 */
      for(var z=LIVE.raw.length-1;z>=0;z--){ if(LIVE.raw[z].role==='assistant'){ autoTitle(LIVE.raw[z]); applySuggest(LIVE.raw[z],z===LIVE.raw.length-1); break; } }
      var newSig=sigOf(LIVE.raw); if(!LIVE.busy&&newSig!==LIVE.sig){ LIVE.sig=newSig; LIVE.__rb=1; rebuild(); }
      if(STAR.on){ var need=LIVE.raw.filter(function(m){ return !m._sk&&!STAR.ids[m.id]; }); if(need.length) Promise.all(need.map(function(m){ return sha32((m.role||'')+'\u0000'+mText(m)).then(function(k){ m._sk=k; }); })).then(function(){ if(need.some(isStar)&&!LIVE.busy){ LIVE.sig=sigOf(LIVE.raw); rebuild(); } }); }
      return r; }); }
  /* [位置:phone-talk.js·reloadDelta] [SSE history_update 增量拉取] [2026-10-29 性能批：原来每条 history_update 都整份重拉 tail（实测平均 202KB、最大 921KB）。现在带 after=<最后一条 id> 只拉新增；服务端回 unchanged 就零处理，回 fallback（压缩/重建后 id 不可比）或发现已有 id/total 对不上就退回整份 reload；条数/total 对不上说明有删除/编辑，同样退回整份] [注释时间 2026-10-29；2026-11-13 补：拿到新增后也调 applySuggest] */
  function reloadDelta(){ if(!LIVE.sid||LOC) return Promise.resolve();
    var last=LIVE.raw.length?LIVE.raw[LIVE.raw.length-1].id:null;
    if(!last) return reload();
    return P.net.req('/v1/history?session_id='+encodeURIComponent(LIVE.sid)+'&mode=tail&after='+encodeURIComponent(last),{headers:XC,noLogin:true}).then(function(r){
      if(!r||r.fallback||!r.ok) return reload();
      var got=(r&&r.items)||[]; if(!got.length) return r;
      var have={}; LIVE.raw.forEach(function(m){ have[m.id]=1; });
      if(got.some(function(m){ return have[m.id]; }) || (LIVE.total!=null&&r.total!==LIVE.total+got.length)) return reload();
      LIVE.raw=LIVE.raw.concat(got); LIVE.total=r.total;
      /* 增量路径也要处理推荐回复（11-13 补：SSE 断线重连 / 重进会话赶上 AI 收尾时走这里，原来只有整份 reload 和实时 done 会填，推荐会漏） */
      for(var z=LIVE.raw.length-1;z>=0;z--){ if(LIVE.raw[z].role==='assistant'){ applySuggest(LIVE.raw[z],z===LIVE.raw.length-1); break; } }
      var newSig=sigOf(LIVE.raw); if(!LIVE.busy&&newSig!==LIVE.sig){ LIVE.sig=newSig; rebuild(); }
      return r; }); }
  /* 懒加载：翻到最上面，再往前拉 60 条（before=最早那条的 id），拼在前面，屏幕停在原来看的位置 */
  var olderBusy=false;
  function loadOlder(){ if(!LIVE.on||!LIVE.more||olderBusy||!LIVE.raw.length) return; olderBusy=true; host.classList.add('loading-old');
    P.net.req('/v1/history?session_id='+encodeURIComponent(LIVE.sid)+'&before='+encodeURIComponent(LIVE.raw[0].id)+'&limit=60',{headers:XC,noLogin:true}).then(function(r){
      var got=(r&&r.items)||[], have={}; LIVE.raw.forEach(function(m){ have[m.id]=1; }); got=got.filter(function(m){ return m&&!have[m.id]; });
      if(r&&r.has_more===false||got.length<1) LIVE.more=false;
      if(got.length){ LIVE.older=got.concat(LIVE.older||[]); LIVE.raw=got.concat(LIVE.raw); rbAnchor=true; rebuild(); }
    },function(){ toast('更早的没拉到'); }).then(function(){ olderBusy=false; host.classList.remove('loading-old'); headSync(); }); }

  /* ---------- 思考 / 工具 / token：历史里的这条，或正在流的那条 ---------- */
  /* [位置:phone-talk.js·dataOf/liveData/partsOf] [抽屉数据：统一成有序 parts] [历史读 stream_timeline、实时读 ST.parts，都变成 [{type:'reasoning',text}|{type:'tool',t}] 一个列表交给 chainHTML；没有思考节点的旧消息回退为「思考整段在前、工具在后」；只管显示，不碰发给上游的消息] [注释时间 2026-10-21] */
  function toolOf(n){ return {name:n.name,args:n.args,result:n.result,error:n.error,st:n.error||n.status==='failed'?'fail':n.status==='running'?'run':'done'}; }
  function dataOf(m){ var tools=[], parts=[], tl=m.stream_timeline||[], hasR=tl.some(function(n){ return n&&n.type==='reasoning'&&n.text; });
    if(tl.length){ tl.forEach(function(n){ if(!n) return;
      if(n.type==='tool'&&n.tool){ var t=toolOf(n.tool); if(t.st==='run') t.st='done'; tools.push(t); if(hasR) parts.push({type:'tool',t:t}); }
      else if(n.type==='reasoning'&&n.text) parts.push({type:'reasoning',text:n.text}); }); }
    if(!tools.length&&!tl.some(function(n){ return n&&n.type==='tool'; })) (m.tools||[]).forEach(function(t){ var x={name:t.name,args:t.args,result:t.result,error:t.error,st:t.error?'fail':'done'}; tools.push(x); if(hasR) parts.push({type:'tool',t:x}); });
    if(!hasR){ parts=[]; if(m.reasoning) parts.push({type:'reasoning',text:m.reasoning}); tools.forEach(function(t){ parts.push({type:'tool',t:t}); }); }
    return {id:m.id||'h',reasoning:m.reasoning||'',tools:tools,parts:parts,tokens:m.tokens||null,model:''}; }
  function liveData(){ if(!ST) return {reasoning:'',tools:[],parts:[]};
    var tools=ST.tools.filter(Boolean), parts=[];
    if(ST.parts&&ST.parts.some(function(p){ return p.type==='reasoning'||p.type==='tool'; })) ST.parts.forEach(function(p){ if(p.type==='reasoning') parts.push(p); else if(p.type==='tool'&&ST.tools[p.i]) parts.push({type:'tool',t:ST.tools[p.i]}); });
    else{ if(ST.reasoning) parts.push({type:'reasoning',text:ST.reasoning}); tools.forEach(function(t){ parts.push({type:'tool',t:t}); }); }
    return {id:LIVE.rid||'live',reasoning:ST.reasoning,tools:tools,parts:parts,tokens:ST.tokens,model:ST.model,t0:ST.t0}; }
  function fmtN(n){ return (+n||0).toLocaleString(); }
  /* [位置:phone-talk.js·tokInfo] [统一读 token 用量] [输入 / 输出 / 命中 / 未命中 / 命中率；命中字段兼容全部已实测供应商（同 chat.html 5490 行那套）：顶层 prompt_cache_hit_tokens（deepseek、硅基）、顶层 cached_tokens（kimi）、嵌套 prompt_tokens_details.cached_tokens（豆包/openrouter/百炼/glm/minimax/openai）、cache_write_tokens 形态（本轮写缓存→命中按 0）；未命中：厂商给了顶层 miss 就用，否则 输入-命中；没有缓存字段就不显示命中/未命中；整段用量都没有返回 null] [注释时间 2026-10-22] */
  /* [位置:phone-talk.js·tokInfo 思考 token] [思考并进输出显示] [11-16：Grok/Gemini 这类上游的 completion_tokens 不含思考、单列 completion_tokens_details.reasoning_tokens，total = prompt + completion + reasoning；用户当天拍板「不单列思考行，输出合并思考」——所以这里算一个 out = ct + 额外思考，只有确属额外计（pt+ct+rt === total，或没有 total 字段）才并入；OpenAI 那种 reasoning 已含在 completion 里的不并，避免重复计。tot 仍优先用 total_tokens，老消息/别家 rt=0 时行为不变] [注释时间 2026-11-16] */
  function tokInfo(u){ if(!u||typeof u!=='object') return null; var pd=u.prompt_tokens_details||{}, pt=+u.prompt_tokens||0, ct=+u.completion_tokens||0;
    var cd=u.completion_tokens_details||{}, rt=+(cd.reasoning_tokens!=null?cd.reasoning_tokens:0)||0;
    var tot=u.total_tokens!=null?+u.total_tokens:((rt>0)?pt+ct+rt:null);
    var add=(rt>0&&(tot==null||pt+ct+rt===tot))?rt:0;   /* 思考额外计才并进输出；已含在 completion 里的不并 */
    var out=ct+add;
    var hit=u.prompt_cache_hit_tokens!=null?+u.prompt_cache_hit_tokens:u.cached_tokens!=null?+u.cached_tokens:pd.cached_tokens!=null?+pd.cached_tokens:pd.cache_write_tokens!=null?0:null;
    var miss=u.prompt_cache_miss_tokens!=null?+u.prompt_cache_miss_tokens:(hit!=null?Math.max(0,pt-hit):null);
    if(!pt&&!ct&&!rt&&hit==null) return null;
    return {pt:pt,ct:ct,rt:rt,add:add,out:out,tot:tot,hit:hit,miss:miss,rate:(hit!=null&&pt>0)?Math.round(hit/pt*100):null}; }
  function tokHTML(u,model){ var k=tokInfo(u); if(!k&&!model) return ''; var h=[];
    if(k){ h.push('<span><small>输入</small><b>'+fmtN(k.pt)+'</b></span>'); if(k.hit!=null){ h.push('<span><small>命中</small><b>'+fmtN(k.hit)+'</b></span>'); h.push('<span><small>未命中</small><b>'+fmtN(k.miss)+'</b></span>'); }
      h.push('<span><small>输出</small><b>'+fmtN(k.out)+'</b></span>'); }
    return '<div class="tk-tok">'+h.join('')+(model?'<em>'+esc(model)+'</em>':'')+'</div>'; }
  /* [位置:phone-talk.js·tokSheet] [长按菜单 → Token] [这条回复的用量明细：输入 / 命中（含命中率条）/ 未命中 / 输出（含额外思考）/ 合计 + 模型名；数据读消息里的 tokens（流式结束时落盘的 usage）；没有记录就提示一句。2026-11-16 改：思考不再单列一行，并进「输出」，这样「输入+输出」与「合计」永远对得上] [注释时间 2026-10-22；2026-11-16 改思考显示口径] */
  function tokSheet(m){ var k=tokInfo(m&&m.tokens), md=(m&&(m.model||m.model_name))||'';
    if(!k){ toast('这条没有 token 记录'); return; }
    var rows='<div class="r"><label>输入</label><b>'+fmtN(k.pt)+'</b></div>';
    if(k.hit!=null) rows+='<div class="r"><label>　命中</label><b class="ok">'+fmtN(k.hit)+'</b></div><div class="bar"><i style="width:'+(k.rate||0)+'%"></i><em>'+(k.rate==null?'':'命中率 '+k.rate+'%')+'</em></div><div class="r"><label>　未命中</label><b>'+fmtN(k.miss)+'</b></div>';
    rows+='<div class="r"><label>输出</label><b>'+fmtN(k.out)+'</b></div>';
    rows+='<div class="r tot"><label>合计</label><b>'+fmtN(k.tot!=null?k.tot:k.pt+k.ct)+'</b></div>';
    sheet('<div class="hd"><span>Token</span></div><div class="tkt">'+rows+'</div>'+(md?'<div class="tkm">'+esc(md)+'</div>':''),'tok'); }
  function pj(s){ if(s==null) return ''; if(typeof s!=='string') try{ return JSON.stringify(s,null,1); }catch(e){ return String(s); } try{ return JSON.stringify(JSON.parse(s),null,1); }catch(e){ return s; } }
  var DS={};
  /* [位置:phone-talk.js·CP] [抽屉思考步骤整段选中按钮] [10-31：思考步骤标题行尾一键整段选中，选中后轻点选中的字弹 iOS 拷贝/翻译菜单；10-31：工具步骤不加按钮；显示时机=展开才出现（CSS .stp.fold 藏），放 .sh 末尾后 ok 对勾不再是 last-child，CSS 相应改 last-of-type] [注释时间 2026-10-31] */
  var CP='<button class="dw-cp" type="button" aria-label="整段选中">'+I.sel+'</button>';
  /* [位置:phone-talk.js·stepHTML/chainHTML] [抽屉的一个步骤 / 整块] [步骤 = 思考盒子或工具盒子，data-k 给 dwPaint 就地对账用；思考盒子自己有固定最大高度、盒子里自己滚；工具默认收起（见 DS）] [注释时间 2026-10-21] */
  function stepHTML(p,dk){
    if(p.type==='reasoning') return '<div class="stp think'+(DS[dk]==='fold'?' fold':'')+'" data-k="'+esc(dk)+'"><div class="sh">'+I.think+'<b>思考</b>'+CP+'</div><div class="sb">'+esc(p.text).replace(/\n/g,'<br>')+'</div></div>';
    var t=p.t, run=t.st==='run';
    return '<div class="stp tool '+(run?'run':t.st==='fail'?'fail':'done')+(DS[dk]==='open'?'':' fold')+'" data-k="'+esc(dk)+'"><div class="sh">'+toolIco(t.name)+'<b>'+esc(t.name||'工具')+'</b>'+(run?'<i class="spin"></i>':t.st==='fail'?'':I.ok)+'</div><div class="sb">'+
      (tvArgs(t)?'<div class="kv"><small>入参</small><code>'+esc(tvArgs(t))+'</code></div>':'')+
      (run?'<div class="kv"><small>结果</small><code class="wait">等结果<span class="caret"></span></code></div>':(t.error||t.result)?'<div class="kv"><small>'+(t.error?'出错':'结果')+'</small><code>'+esc(tvRes(t))+'</code></div>':'')+thumbsHTML(toolImgs(t))+'</div></div>'; }   /* 2026-10-26 批3：子进程步骤附「查看过程」按钮；2026-10-27 晚：同 mnKv 去 3000 截断（产品确定） */
  function dhSmall(d,live){ var n=d.tools.length; return live?'<i class="spin"></i>进行中'+(d.t0?' · '+Math.round((Date.now()-d.t0)/1000)+'s':''):(n?n+' 个工具':''); }
  function chainHTML(d,live){
    var h='', pts=d.parts;
    if(!pts){ pts=[]; if(d.reasoning) pts.push({type:'reasoning',text:d.reasoning}); (d.tools||[]).forEach(function(t){ pts.push({type:'tool',t:t}); }); }   /* 没带 parts 的调用方（示例数据等）回退 */
    pts.forEach(function(p,pi){ h+=stepHTML(p,(d.id||'x')+':'+pi); });
    if(!h) h='<div class="tk-dwe">'+(live?'还没想好…':'这条没有思考和工具记录')+'</div>';
    return '<div class="dh"><b>思考与工具</b><small>'+dhSmall(d,live)+'</small></div>'+tokHTML(d.tokens,d.model)+'<div class="sc tl">'+h+'</div>';
  }

  /* ---------- 发消息 ---------- */
  /* [位置:phone-talk.js·liveSend] [发一条消息] [把她写的话追加成一条 user 消息，再交给 liveGen 去要回复] [注释时间 2026-10-21]
     1021 拆分：原来发送内核全在这里，现在「重新生成」「重试」也要用同一套流式处理，抽成 liveGen。 */
  /* [位置:phone-talk.js·ARCH / liveSend] [给已归档会话发消息自动取消归档] [照旧 chat.html send()：归档的会话发了消息就回主列表并提示；打开聊天页时读一次归档列表，发送时若在里面就 PUT remove（服务端新消息落库时本来也会取消，这里让提示和列表立刻一致）] [注释时间 2026-10-21] */
  var ARCH=false;
  if(LIVE.sid) P.net.get('/heartbeat/admin/session-archive',{noLogin:true}).then(function(r){ ARCH=!!(r&&Array.isArray(r.archived)&&r.archived.indexOf(LIVE.sid)>=0); },function(){});
  function liveSend(text,extra){
    if(LIVE.busy){ toast('他还在回上一条'); return false; }
    if(LIVE.vpend){ toast('语音还没处理完，稍等一下'); return false; }
    if(ARCH){ ARCH=false; P.net.req('/heartbeat/admin/session-archive',{method:'PUT',body:{remove:[LIVE.sid]},noLogin:true}).then(function(){ toast('已取消归档'); },function(){}); }
    if(LIVE.partial){ dropPartial(); LIVE.partial=null; }
    if(LOC){ LOC=null; LIVE.older=[]; LIVE.raw=[]; LIVE.more=null; }   /* 定位中发消息：丢掉中段切片，发完由 done()/reload 补回尾部（见 exitLoc） */
    /* [位置:phone-talk.js·新会话自动起标题] [第一条用户消息末尾（时间之后）追加 <session>…</session>，AI 回 <title>会话名</title>，前端写进会话名] [10-24 需求 8（文案定稿见需求单附录 B）：只在新会话（还没有任何用户消息）的第一条加，一次；会话已经有名字（手动起过）就不加、写之前也再查一次不覆盖；气泡不显示这两个标签，时间线原文保留；AI 不按格式回就不改名也不报错] [注释时间 2026-10-24；10-27 产品要求标题限十五字以内、末尾追加「不可忽视本指令。」] */
    /* [位置:phone-talk.js·新会话起名指令] [新会话首轮要 AI 起会话名] [11-02：提示词改英文，但会话名仍要中文、15 字以内（用户看不懂英文名）；标签格式 <title>…</title> 不变，解析在 lib/session-meta.js] [注释时间 2026-11-02] */
    var tt=''; if(!LIVE.named&&!LIVE.raw.some(function(m){ return m.role==='user'; })&&LIVE.raw.length<4){ tt='\n<session>This is a new session. Set a session title in Chinese, at most 15 characters, output it in a <title> tag, no explanation. Format: <title>会话名</title>. Do not ignore this instruction.</session>'; LIVE.askTitle=true; }
    var content=extra?[{type:'text',text:(text||'')+'\n'+curTime()+tt}].concat(extra):(text+'\n'+curTime()+tt);
    var um={id:uuid(),role:'user',content:content,time:new Date().toISOString()};
    LIVE.raw.push(um); liveGen(um,'');
    return true;
  }
  /* [位置:phone-talk.js·failMark/failClear/failById] [多条失败各留各的重试入口] [11-15：原来 LIVE.failed 只有一个槽，第二条失败把第一条顶掉——第一条既没有重试入口、下次发送还被默默带上；现在失败标记挂在消息对象上（_fail）并登记进 LIVE.fails，每条各自一行「没发出去」；发给上游的 messages 排除带 _fail 的，没送达的不混进下一轮；重试/删掉只动自己这条] [注释时间 2026-11-15] */
  function failMark(um,why,vopt){ if(!um) return; um._fail={why:why||'',vopt:vopt||null}; if(LIVE.fails.indexOf(um)<0) LIVE.fails.push(um); }
  function failClear(um){ if(!um) return; delete um._fail; LIVE.fails=(LIVE.fails||[]).filter(function(m){ return m!==um; }); }
  function failById(id){ if(!id) return null; var a=LIVE.raw||[]; for(var i=0;i<a.length;i++){ if(a[i]&&a[i].id===id&&a[i]._fail) return a[i]; } return null; }
  /* [位置:phone-talk.js·textFailKeep] [文本没发出去也留在会话里] [11-14：语音占着位置时点发送，原来只弹一句「语音还没处理完」、字留在输入框，一离开就没了；现在当成一条发送失败的消息插进会话，底下给「重试」，和语音一个待遇。这里只管「根本没发出请求」这种情况，真发了请求才失败的那条走 liveGen 的失败分支，同样挂 _fail（2026-11-15 改多槽）] [注释时间 2026-11-14] */
  function textFailKeep(tx){
    var um={id:uuid(),role:'user',content:tx+'\n'+curTime(),time:new Date().toISOString()};
    LIVE.raw.push(um); failMark(um,'语音还没处理完，回完点重试',null); rbForce=true; rebuild();
  }
  /* [位置:phone-talk.js·failDrop] [没发出去的那条在本地删掉] [11-14：这类消息从来没到过后端，走长按菜单的「删除」会去 /v1/timeline/sync 删一个不存在的 id，自然删不掉；直接本地移除 + 清掉失败标记，不打接口] [注释时间 2026-11-14] */
  function failDrop(id){
    var f=(id&&failById(id))||(LIVE.fails||[])[0]; if(!f) return;
    LIVE.raw=(LIVE.raw||[]).filter(function(m){ return m!==f; }); failClear(f); rbForce=true; rebuild(); toast('删掉了');
  }
  /* [位置:phone-talk.js·liveGen] [要一条回复（发送 / 重新生成 / 重试共用）] [三个入口的区别只在两点：user 消息是新追加的还是已有的、regen_anchor_id 传不传；其余流式、收尾、失败处理完全一致] [注释时间 2026-10-21]
     anchorId 非空 = 重新生成 / 重试：后端按 id 把「这条 user 消息之后」的全部内容删掉再生成（server.js appendRequestMessages 第 0 步，锚点必须是 user、不能在压缩区间内）。
     失败时在气泡下挂「重试」：没收到任何内容 = 重发同一条 user 消息（带锚点，清掉残缺回复）。 */
  /* [位置:phone-talk.js·keepPartial/partialSync] [断流时保留已收到的半截回复] [10-24 需求 21 并入：流断了或没收完整时，屏幕上已有的字 / 思考 / 工具以前直接消失，要等后端对齐才回来；现在先留成一条本地半截消息（_partial）并提示「没收完整」，同时去后端核对：拉到落盘版本（同一个 id）就换成它，拉不到才保留本地这份并提示后端没存；后端还在回就让位给「输入中」；她再发新消息时丢掉；不发给上游] [注释时间 2026-10-24] */
  function keepPartial(s0,rid){ if(!s0||!(s0.text||s0.reasoning||(s0.tools&&s0.tools.some(Boolean)))) return false;
    var am={id:rid,role:'assistant',content:s0.text||'',reasoning:s0.reasoning,tools:s0.tools.filter(Boolean).map(function(t){ return {name:t.name,args:t.args,result:t.result,error:t.error}; }),time:new Date().toISOString(),_partial:1};
    LIVE.partial=am; LIVE.raw.push(am); return true; }
  function dropPartial(){ if(!LIVE.partial) return; var p=LIVE.partial; LIVE.partial=null; LIVE.raw=LIVE.raw.filter(function(m){ return m!==p; }); }
  function partialSync(n){ var gap=[0,3000,8000,20000]; n=n||0; if(n>=gap.length||!LIVE.partial) return;
    setTimeout(function(){ if(!LIVE.partial||!win.isConnected||LIVE.busy) return; reload().catch(function(){ partialSync(n+1); }); },gap[n]); }
  function liveGen(um,anchorId,vopt){   /* vopt={version:1,edit:新内容}：显式「重新生成」/「编辑后重新生成」才传；发送、失败重试（无 vopt）不存版本，见 server.js appendRequestMessages 步骤 0 */
    var rid=uuid(), cid=uuid(); failClear(um);
    rbForce=true; LIVE.busy=true; LIVE.rid=rid; ST={text:'',reasoning:'',tools:[],parts:[],tokens:null,model:'',final:null,timeline:null,t0:Date.now(),got:false}; rebuild();
    var body={stream:true,session_id:LIVE.sid,messages:LIVE.raw.filter(function(m){ return !m._partial&&!m._vp&&!m._fail; }).slice(-80).map(function(m){ return {id:m.id,role:m.role,content:m.content}; }),stream_options:{include_usage:true},client_msg_id:cid,reply_msg_id:rid,regen_anchor_id:anchorId||'',regen_version:(vopt&&vopt.version)?1:0,regen_edit_content:(vopt&&vopt.edit!=null)?vopt.edit:undefined};
    P.net.stream('/v1/chat/completions',body,onFrame,{headers:XC}).then(function(){ done(rid); },function(e){ var s0=ST; LIVE.busy=false; ST=null; LIVE.dw=null;
      if(s0&&(s0.text||s0.reasoning||s0.tools.length)){ toast('断了一下，去后端看看他回完没有'); keepPartial(s0,rid); rebuild(); watchStatus(); partialSync(1); }
      else { var why=failWhy(e); toast('没发出去：'+why); buzz([20,30,20]);
        if(vopt&&/压缩/.test(why)){ failClear(um); LIVE.sig=null; reload(); return; }   /* 位于已压缩区间被后端拒：本地已截断/换了新内容，重试也不会成功，直接按后端实际拉回来 */
        failMark(um,why,vopt); rebuild(); } });   /* 不再立刻 reload：reload 会把刚才那条 user 消息按服务端实际落盘情况刷掉/保留，重试按钮要等她点 */
  }
  /* [位置:phone-talk.js·failWhy] [失败原因转人话] [网络层抛出来的是「HTTP 502 {...整段 JSON}」，直接放进界面很难看；取 error 字段，取不到就留状态码] [注释时间 2026-10-21] */
  /* [位置:phone-talk.js·failWhy] [失败原因转人话] [10-23：429 时整段 JSON 截 40 字很难看。现在：取最里层的状态码和 message，认得出的转成一句话（限流 / key 不对 / 上游超时 / 没网），认不出的留原文前 60 字] [注释时间 2026-10-23] */
  /* [位置:phone-talk.js·failWhy] [先按机器码说人话] [11-14 审查 B 批 a：原来完全靠正则从「HTTP 400 {…120字}」里抠状态码与 message；现在后端回 { error, code }，req 也把 code 挂上 e.code，能按码直说的先直说，剩下的才走正则兜底（兼容老接口）] [注释时间 2026-11-14] */
  function failWhy(e){ var ec=String((e&&e.code)||''); if(ec==='busy') return '他还在回上一条，等他回完再发'; if(ec==='upstream_failed') return '上游这次没回成，点重试再来一次'; if(ec==='invalid_messages') return '消息格式不对，刷新一下再发'; var m=String(e&&e.message||''), all=m.match(/\d{3}(?=[:\s·]|$)/g)||[], code=(m.match(/HTTP (\d{3})/g)||[]).pop(); code=code?code.slice(5):'';
    var mm=m.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g), msg=mm?mm[mm.length-1].replace(/^"message"\s*:\s*"/,'').replace(/"$/,''):'';
    if(!msg){ try{ var o=JSON.parse(m.replace(/^HTTP \d{3}\s*/,'')); msg=(o&&(o.error&&(o.error.message||o.error)||o.message))||''; }catch(x){ msg=m.replace(/^HTTP \d{3}\s*/,''); } }
    msg=String(msg).replace(/\\"/g,'"').replace(/\s+/g,' ').trim();
    var human=code==='429'||/速率|限流|rate.?limit|too many/i.test(m)?'对面限流了，过一会儿再点重试':code==='401'||code==='403'?'对面不认这把 key，或者没权限':/timeout|超时|terminated|没有任何数据/i.test(m)?'对面太久没回，点重试再来一次':(/Failed to fetch|NetworkError|Load failed/i.test(m)||!m)?'网络不通':'';
    return human||((code?code+(msg?' · ':''):'')+msg.slice(0,60))||'网络不通'; }
  /* [位置:phone-talk.js·retryLast] [发送失败重试] [没发出去时，在那条消息下面给「重试」，点一下用同一条消息重发（不再重新输入）] [注释时间 2026-10-21]
     不弹确认（重试是明确意图，同 chat.html 的 showError 重试）。锚点 = 失败那条 user 消息 id：服务端若已落了这条，会先清掉它之后的残缺内容再生成。 */
  function retryLast(id){
    if(LIVE.busy) return; var f=(id&&failById(id))||(LIVE.fails||[])[0]; if(!f||!f._fail) return; var k=LIVE.raw.indexOf(f);
    if(k<0){ LIVE.raw.push(f); k=LIVE.raw.length-1; }   /* 11-14：reload 把这条刷掉了也补回来再重试，不丢消息 */
    var later=LIVE.raw.slice(k+1).filter(function(m){ return m&&m._fail; }); var vopt=f._fail.vopt; LIVE.raw=LIVE.raw.slice(0,k+1).concat(later); failClear(f); liveGen(f,f.id,vopt);   /* 带上原来的 vopt：存档与换内容在后端都是幂等的（尾巴已空 / 内容已是新的就不重复存），请求没到后端时重试才不丢编辑 */
  }

  /* [位置:phone-talk.js·liveScan/liveInner/livePaint/twTick] [实时区就地更新 + 打字机（10-31 产品确定：两种聊天样式都逐字打——气泡也走同一套打字机与块级增量，全程不重建气泡节点不闪）] [原来每来一帧都整页重画（list.innerHTML），正在播的「输入中」点点动画每 140 毫秒被重启（看起来卡住），手指按下到抬起之间按的那个节点早被换掉，点击就丢了（抽屉点不开）。现在实时区是一个稳定的容器 #tkLive，只在内容真变了才改它的内容，frame 来了不再整页重画；正文逐字打字机：TW.shown=已吐出字数（清掉标签后的正文字数，按 parts 顺序累计），前面的正文没吐完后面的思考/工具行先不出现，速度随积压自适应 36~260 字/秒，收尾 fast 追赶，系统减弱动态效果直接全显，断线恢复来的内容直接全显] [注释时间 2026-10-31 改：实时区就地更新两种样式共用；打字机放开给两种样式] */
  /* [位置:phone-talk.js·TW/PS/RATE 声明] [实时状态提到 setup 开头] [2026-10-27 第一批把 TW.atBot 写进 render()，而 render(true) 在 setup 第 351 行就被调用、TW 原来到 1421 行才赋值：var 提升只给 undefined，render 一进来就 TypeError，整个 setup 中断，聊天页永远停在「拉取中…」骨架屏。声明上移，顺序修好] [注释时间 2026-10-27] */
  /* [位置:phone-talk.js·liveAlive] [实时区还该不该继续算] [窗口已关（win 被摘掉）或页面在后台就别再排版了：原来关掉聊天页后实时帧还在每秒 60 次重排一个没人看的窗口，多会话并行时几份叠着跑，手机发烫、切页卡顿的主因] [注释时间 2026-10-27] */
  function liveAlive(){ return !!ST && win.isConnected && !document.hidden; }
  /* [位置:phone-talk.js·livePaintSoon] [实时重画限频约 30fps] [原来每个 SSE 帧到达都立刻重排一次全文，模型一秒吐 200 帧就重排 200 次，比屏幕刷新还快，纯排队；现在合并成每 32ms 最多画一次，观感不变、主线程压力减半] [注释时间 2026-10-27] */
  function livePaintSoon(){ if(PS.raf) return;
    PS.raf=requestAnimationFrame(function(ts){ PS.raf=0; if(!liveAlive()) return;
      if(twHold()){ livePaintSoon(); return; }
      if(ts-PS.t<32){ livePaintSoon(); return; } PS.t=ts; livePaint(); }); }
  /* [位置:phone-talk.js·twRate] [按到达速率在逐字与直出之间切] [打字机上限 260 字/秒，模型吐得更快时积压永远清不掉，rAF 一帧不歇地重排越来越长的全文；现在 500ms 一窗口估速率：快过 320 字/秒切直出（新字直接贴上去，不再逐字），慢回 150 字/秒以下恢复逐字；恢复时把已显示字数拉到当前长度，不重头播] [注释时间 2026-10-27] */
  function twRate(n){ if(!n||bsHold()) return; var now=Date.now(); if(!RATE.t){ RATE.t=now; RATE.acc=0; return; }   /* SVG尾档三点模式：整场没有逐字，速率估算/直出切换全跳过 */
    RATE.acc+=n; var el=now-RATE.t; if(el<500) return;
    var r=RATE.acc/(el/1000); RATE.acc=0; RATE.t=now; if(TW.fast) return;
    if(r>320){ TW.direct=true; }
    else if(r<150&&TW.direct){ TW.direct=false; twSync(); TW.shown=twTotal(); TW.ts=0; twKick(); } }   /* 先 twSync 再赋值：消息对象还没同步时 twSync 会把 shown 归零，顺序反了就会从半截重头播 */
  try{ TW.rm=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){}
  /* [位置:phone-talk.js·mnClean 缓存] [正文清洗结果记最近 4 条] [twTotal 与 liveScan 每帧各对每段正文清洗一遍（cardsOf+stripTags 一串正则），同一帧同一段文字白算两遍；按入参字符串记最近 4 条，同帧第二次命中直接返回；纯函数，不影响逐字显示] [注释时间 2026-10-30] */
  var MNC=[];
  function mnClean(t){ t=String(t||''); for(var i=0;i<MNC.length;i++) if(MNC[i][0]===t) return MNC[i][1];
    var r=cardsOf(stripTags(t)).text.replace(/<voice\b[^>]*>|<\/voice>/gi,'').trim(); MNC.unshift([t,r]); if(MNC.length>4) MNC.pop(); return r; }
  function mnParts(){ if(ST.parts&&ST.parts.length) return ST.parts;
    var o=[]; if(ST.reasoning) o.push({type:'reasoning',text:ST.reasoning}); ST.tools.forEach(function(t,i){ if(t) o.push({type:'tool',i:i}); }); if(ST.text) o.push({type:'text',text:ST.text}); return o; }
  function twTotal(){ if(!ST) return 0; var n=0; mnParts().forEach(function(p){ if(p.type==='text'){
    if(MIN){ var pk=splitTrace(p.text,true); if(pk){ pk.forEach(function(pc){ if(pc.tx!=null) n+=mnClean(pc.tx).length; }); return; } }
    n+=mnClean(p.text).length; } }); return n; }
  /* [位置:phone-talk.js·twSync] [打字机随 ST 换新重置] [10-31 产品确定：气泡主题也走打字机——新回复两种样式都从 0 字逐字推进（36~260 字/秒自适应、吐太快切直出、超 3000 字降 30fps，全套与极简同款）；续显（rec：生成中重进/刷新恢复）仍直接全显不重播；系统减弱动态在 liveScan 拦（TW.rm 全显）。原 !MIN 特权删除] [注释时间 2026-10-31 改] */
  function twSync(){ if(TW.st!==ST){ TW.st=ST; TW.shown=(ST&&ST.rec)?1e9:0; TW.fast=false; TW.direct=false; TW.ts=0; TW.hh=''; RATE.acc=0; RATE.t=0; TW.blk={}; TW.bkm={}; TW.rh={}; } }
  /* [位置:phone-talk.js·bsHold] [小尾巴SVG档=三点输出模式] [2026-11-02：SVG 尾气泡不逐字——流式期间只出三点泡泡，收完一次性出整条气泡。为什么：正文气泡每长高一次就要换一张 SVG 形状图，WebKit 换背景图那一帧异步解码空一下=她说的闪；憋到收尾只画一次，尺寸稳定零换图。判定与 phone-bubble.js·lookBS 同源（经 P.bubble.lookBS 调，模块没加载上兜底读统一存储 look 段，2026-11-14 收拢前是直读 ph.look.v2）；流式期间思考照常进抽屉（点三点泡泡看），极简样式不受影响] [注释时间 2026-11-02；2026-11-14 收拢] */
  function bsHold(){ if(MIN) return false; var b=P.bubble, ls='none', pt='none';
    if(P.lookV){ if(P.lookV.aiLs!=null) ls=P.lookV.aiLs; if(P.lookV.aiPat!=null) pt=P.lookV.aiPat; }
    else{ try{ var o0=P.chatTheme&&P.chatTheme.read(), l0=o0&&o0.look; if(l0){ ls=l0.aiLs||'none'; pt=l0.aiPat||'none'; } }catch(e){} }
    if((ls&&ls!=='none')||(pt&&pt!=='none')) return true;   /* 他的线框/图案开着（2026-11-02）：AI 气泡装饰随尺寸重画，同 tailsvg 憋到收尾一次出防换图闪 */
    if(b&&b.lookBS) return b.lookBS()==='tailsvg';
    try{ var o=P.chatTheme&&P.chatTheme.read(); return !!(o&&o.look)&&o.look.bs==='tailsvg'; }catch(e){ return false; } }
  function liveScan(){ twSync();
    /* sh：可见正文字数。SVG尾档（bsHold）一律 0——减弱动态/直出都压不过它（中途放出正文=中途换图=闪） */
    var hold=bsHold(), parts=mnParts(), sh=hold?0:(TW.rm||TW.direct)?1e9:Math.floor(TW.shown), cum=0, out=[], stop=false, last=parts.length-1;
    parts.forEach(function(p,i){ if(stop) return;
      if(p.type==='text'){
        if(MIN){
          var pk=splitTrace(p.text,true);
          if(pk){
            var trIdx=0;
            pk.forEach(function(pc){ if(stop) return;
              if(pc.trq!=null){ out.push({t:'trace',text:pc.trq,live:!!pc.live,i:i+':tr'+(trIdx++)}); }
              else { var c=mnClean(pc.tx), vis=Math.max(0,Math.min(c.length,sh-cum)); if(vis>0) out.push({t:'text',s:c.slice(0,vis)}); cum+=c.length; if(vis<c.length) stop=true; }
            });
            return;
          }
        }
        var c=mnClean(p.text), vis=Math.max(0,Math.min(c.length,sh-cum)); if(vis>0) out.push({t:'text',s:c.slice(0,vis)}); cum+=c.length; if(vis<c.length) stop=true;
      }
      else if(p.type==='reasoning') out.push({t:'r',text:p.text,i:i,live:i===last&&!ST.got,dur:tlDur(parts,i,ST.tend||0)});
      else if(p.type==='tool'){ var t=ST.tools[p.i]; if(t) out.push({t:'tool',tool:t,i:i}); } });
    return mergeLive(out); }
  /* [位置:phone-talk.js·unitRow] [实时单元转 mnRow] [liveScan 的思考/工具组/单工具/trace 四种单元转成行，首画（mnLiveInner）和逐帧对账（mnSync）共用，原来两处各抄一串三元] [注释时间 2026-10-30；2026-11-18 加 trace] */
  function unitRow(u,rk){ var k=rk+':'+u.i; return u.t==='trace'?mnRow({k:'trace',text:u.text},k,u.live):u.t==='r'?mnRow({k:'think',text:u.text,dur:u.dur},k,u.live):u.t==='chain'?mnRow({k:'chain',list:u.list},k):u.t==='tools'?mnRow({k:'tools',list:u.list},k):mnRow({k:'tool',t:u.tool},k); }
  function mnLiveInner(){ var sc=liveScan(), rk=LIVE.rid||'live', h='';
    sc.forEach(function(u,slot){
      if(u.t==='text'){ var bl=mnBlk(slot,u.s), tx=''; for(var b=0;b<bl.length;b++) tx+=md(bl[b].txt); h+='<div class="b ai md">'+tx+'</div>'; }
      else h+=mnRowHTML(unitRow(u,rk),rk+':'+u.i); });
    return h||'<div class="mn-breath" aria-label="他在回"></div>'; }
  /* [位置:phone-talk.js·bubbleTypingInner] [思考气泡 HTML（羽毛笔）] [抽成函数：首画与增量通道复用；羽毛笔尺寸在 CSS（phone-talk.css）里控制] [注释时间 2026-10-31] */
  function bubbleTypingInner(){ return '<div class="b ai typing first tap" data-live="1" role="button" aria-label="看他在想什么"><span class="tk-wr" aria-hidden="true"><svg class="tk-wl" viewBox="0 0 74 28"><path pathLength="100" d="M3 19 C7 7 11 7 13 16 S19 25 23 15 S31 5 35 15 S43 25 47 15 S55 6 59 15 S66 22 70 12"/></svg><svg class="tk-wp" viewBox="0 0 24 24"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg></span><i></i><i></i><i></i></div>'; }
  function bubbleLiveInner(){
    var sc=liveScan(), typed=sc.filter(function(u){ return u.t==='text'; }).map(function(u){ return u.s; }).join('\n\n');
    if(!typed) return bubbleTypingInner();
    return '<div class="b ai md tap first" data-live="1">'+md(typed)+'</div>'; }
  function liveInner(){ return MIN?mnLiveInner():bubbleLiveInner(); }
  function liveWrap(){ TW.bkm={}; TW.rh={}; var h=liveInner(); TW.hh=h;   /* 每次整块重画，DOM 里那段正文是新节点，块级元信息（第几块到第几个子节点）必须作废重记 */
    if(MIN) return '<div class="tk-g ai mn-lv"><div class="col mn-typing" id="tkLive">'+h+'</div></div>';
    return '<div class="tk-g top ai live"><div class="tk-hd"><button class="av ai tk-sav tap" data-l="谢" data-g="live" data-rec="1"></button><span class="tk-un">'+esc(NAMES.ai)+'</span></div><div class="col" id="tkLive">'+h+'</div></div>'; }
  /* [位置:phone-talk.js·mnSig/mnBlk] [正文分块缓存] [第二批根治：极简实时区原来每帧都把「已吐完全文」重跑一遍 md() 再整块重排，两万字时单帧成本跟长度成正比；现在把正文按空行切成块（代码块内部不切；md 的列表/表格/引用/段落本来就都被空行终止，所以切点语义与整段渲染完全等价，测试里有逐字符前缀的等价性断言），已定型的块只算一次并记下指纹，每帧只重算最后一块] [注释时间 2026-10-27 第二批] */
  function mnSig(t){ return t.length.toString(36)+'.'+hsh(t); }   /* 10-30：哈希复用 hsh（原来这里抄了一份同样的 djb2） */
  function mnBlk(slot,txt){
    /* [位置:phone-talk.js·mnBlk] [按空行增量切块] [只从上次冻结的位置往后扫（O(新增字数)）；文本前缀一变（比如 <title> 半截被清掉导致缩短）就整段作废重来，保证不会拿旧块拼新文本] [注释时间 2026-10-27 第二批] */
    var c=TW.blk[slot];
    if(!c||txt.indexOf(c.frozen)!==0){ c=TW.blk[slot]={frozen:'',list:[]}; TW.bkm[slot]=[]; }
    var rest=txt.slice(c.frozen.length), i=0, n=rest.length, start=0, fence=false, got=[];
    while(i<n){ var j=rest.indexOf('\n',i); if(j<0) break;
      var ln=rest.slice(i,j);
      if(/^\s*```/.test(ln)) fence=!fence;
      else if(!fence&&!ln.trim()){ var bb=rest.slice(start,i).replace(/\n+$/,''); if(bb.trim()) got.push(bb); start=j+1; }   /* 去掉块尾空行：块文本与上一帧的「正在打的尾块」保持一致，块定型那次不用白重画一遍 */
      i=j+1; }
    if(got.length){ for(var k=0;k<got.length;k++) c.list.push({txt:got[k],sig:mnSig(got[k])}); c.frozen+=rest.slice(0,start); }
    var out=c.list.slice(), tail=txt.slice(c.frozen.length);
    if(tail) out.push({txt:tail,sig:mnSig(tail)});
    return out; }

  /* [位置:phone-talk.js·mnSyncText] [正文块级对账] [块指纹没变的 DOM 一个字节都不碰（不解析、不序列化、不克隆）；从第一块变了的开始往后重画，一般就是最后那块（正在打的那段）] [注释时间 2026-10-27 第二批] */
  function mnSyncText(box,slot,list){
    var meta=TW.bkm[slot]||(TW.bkm[slot]=[]), i, dirty=-1, changed=false;
    for(i=0;i<list.length;i++){ if(!meta[i]||meta[i].sig!==list[i].sig){ dirty=i; break; } }
    if(dirty<0&&meta.length===list.length) return false;
    if(dirty<0) dirty=list.length;
    var from=(dirty>0&&meta[dirty-1])?meta[dirty-1].to:0;
    while(box.children.length>from) box.removeChild(box.lastChild);
    meta.length=Math.min(meta.length,dirty);
    for(i=dirty;i<list.length;i++){ var st=box.children.length;
      box.insertAdjacentHTML('beforeend', md(list[i].txt));
      meta[i]={sig:list[i].sig,from:st,to:box.children.length}; changed=true; }
    return changed; }

  /* [位置:phone-talk.js·mnSyncRow] [思考行/工具行就地更新] [规则与原 mnPatch 完全一致：思考窗首帧贴底、之后用户上滑（离底>48px）不打扰；工具行保持 code 块贴底；内容指纹没变直接返回，连解析都省了] [注释时间 2026-10-27 第二批（从 mnPatch 拆出）] */
  function mnSyncRow(el,idx,key,r){
    var html=mnRowHTML(r,key);
    if(TW.rh[key]===html) return false;
    TW.rh[key]=html;
    var t=document.createElement('div'); t.innerHTML=html; var n=t.firstChild, o=el.children[idx];
    function pin(c){ var b=c.classList&&c.classList.contains('think')?c.querySelector('.mn-b'):null; if(b){ b._seen=1; b.scrollTop=b.scrollHeight; } }   /* 新画出来的思考窗直接贴底（跟原 mnPatch 的 put() 一致），否则它要等下一次内容变化才跟到底 */
    if(!o){ el.appendChild(n); pin(n); return true; }
    /* [位置:phone-talk.js·mnSyncRow 展开态] [用户点开的行不许被对账收起] [11-06 晚：实时区行原来被整行 replaceChild 或 class 覆盖，展开状态只存在 DOM 上，一换就回到折叠——表现是「点了没反应/箭头转一下就弹回去」。这里以用户当前状态为准：旧行开着就把新行也撑开并把懒建内容填上] [注释时间 2026-11-06 晚] */
    var wasOpen=o.classList.contains('open');
    if(wasOpen&&!n.classList.contains('open')){ n.classList.add('open'); lzFill(n); }
    var mk=o.getAttribute('data-mk');
      if(mk&&mk===key&&n.classList.contains('think')&&o.classList.contains('think')){
        if(o.className!==n.className) o.className=n.className;
        var os=o.querySelector('.mn-h span'), ns=n.querySelector('.mn-h span'); if(os&&ns&&os.textContent!==ns.textContent) os.textContent=ns.textContent;
        var ob=o.querySelector('.mn-b'), nb=n.querySelector('.mn-b');
        if(ob&&nb&&!nb.classList.contains('lazy')&&ob.innerHTML!==nb.innerHTML){ /* [位置:phone-talk.js·mnSyncRow 思考窗跟随判定] [首帧必贴底，其后按贴底判定] [2026-10-27 修复：重进续显首画窗在顶（scrollTop=0）而思考已超一窗，旧判定「写入前是否贴底」永不成立，窗口自锁在开头；对齐抽屉 dwPaint 的 _seen 模式：没看过=无条件贴底，看过后上滑（离底>48px）不打扰，滑回底部自动恢复跟随；整页 rebuild 后 _seen 随节点丢失=自动恢复跟随] [注释时间 2026-10-27] */ var stick=!ob._seen||ob.scrollHeight-ob.scrollTop-ob.clientHeight<48; ob._seen=1; ob.innerHTML=nb.innerHTML; if(stick) ob.scrollTop=ob.scrollHeight; } }
      else if(mk&&mk===key&&n.classList.contains('trace')&&o.classList.contains('trace')){
        if(o.className!==n.className) o.className=n.className;
        var ob3=o.querySelector('.mn-b'), nb3=n.querySelector('.mn-b');
        if(ob3&&nb3&&!nb3.classList.contains('lazy')&&ob3.innerHTML!==nb3.innerHTML) ob3.innerHTML=nb3.innerHTML; }
      else if(mk&&mk===key&&n.classList.contains('tool')&&o.classList.contains('tool')){
        /* [位置:phone-talk.js·mnSyncRow 工具行就地对账] [工具行不整行替换] [run 期间入参每变一次原来整行替换、code 块滚回顶；现在只换变掉的 mn-h / mn-b，mn-b 里原来贴底的 code 换完保持贴底] [注释时间 2026-10-27] */
        if(o.className!==n.className) o.className=n.className;
        var oh=o.querySelector('.mn-h'), nh2=n.querySelector('.mn-h'); if(oh&&nh2&&oh.innerHTML!==nh2.innerHTML) oh.innerHTML=nh2.innerHTML;
        var ob2=o.querySelector('.mn-b'), nb2=n.querySelector('.mn-b');
        if(ob2&&nb2&&!nb2.classList.contains('lazy')&&ob2.innerHTML!==nb2.innerHTML){ var _pins=Array.prototype.map.call(ob2.querySelectorAll('code'),function(c){ return c.scrollHeight-c.scrollTop-c.clientHeight<48; }); ob2.innerHTML=nb2.innerHTML; Array.prototype.forEach.call(ob2.querySelectorAll('code'),function(c,ci){ if(_pins[ci]) c.scrollTop=c.scrollHeight; }); } }
    else{ el.replaceChild(n,o); if(wasOpen&&!n.classList.contains('open')){ n.classList.add('open'); lzFill(n); } pin(n); }
    return true; }

  /* [位置:phone-talk.js·mnSync] [极简实时区按块对账总入口（取代 mnPatch 的整块 innerHTML 比对）] [每帧真正重画的只有正在打的那一段；已定型的正文块、已更新的思考/工具行全部跳过；返回「这一帧画面有没有变」给 livePaint 决定要不要贴底] [注释时间 2026-10-27 第二批] */
  function mnSync(el){
    var sc=liveScan(), rk=LIVE.rid||'live', changed=false, i;
    if(!sc.length){ var f=el.firstChild;
      if(!f||!f.classList||!f.classList.contains('mn-breath')){ el.innerHTML='<div class="mn-breath" aria-label="他在回"></div>'; return true; }
      return false; }
    for(i=0;i<sc.length;i++){ var u=sc[i], o=el.children[i];
      if(u.t==='text'){
        if(!o||!o.classList||!o.classList.contains('md')){ var bx=document.createElement('div'); bx.className='b ai md';
          if(o) el.replaceChild(bx,o); else el.appendChild(bx); TW.bkm[i]=[]; o=bx; changed=true; }
        if(mnSyncText(o,i,mnBlk(i,u.s))) changed=true;
      } else {
        if(mnSyncRow(el,i,rk+':'+u.i,unitRow(u,rk))) changed=true;
      } }
    while(el.children.length>sc.length){ el.removeChild(el.lastChild); changed=true; }
    return changed; }
  /* [位置:phone-talk.js·livePaint] [实时区落笔] [两种样式都走块级对账（极简 mnSync 多节点、气泡 bubbleLiveSync 单气泡）：只重画正在打的那一段，前面已定型的段落和思考/工具行零成本跳过。10-27 第二批：原来两条路都先算一遍「全文 HTML」再跟上一帧比，两万字时每帧白跑一遍 md()] [注释时间 2026-10-27 第二批] */
  /* [位置:phone-talk.js·bubbleLiveSync] [气泡主题就地追加] [2026-10-31报「输出到一半突然全部出来」：气泡主题没有打字机是对的（气泡不要逐字），但原来是每一帧把整段正文重跑一遍 md、再把整个气泡 innerHTML 重建——回复越长每帧越慢，追不上就卡在半截，收尾时再一次性全画出来。现在沿用极简第二批的块级增量（mnBlk/mnSyncText）：前置段落节点不动，只重算正在打的最后一块；没文字时仍显示羽毛笔思考气泡] [注释时间 2026-10-31] */
  /* [位置:phone-talk.js·bubbleSyncSplit] [分气泡模式的实时区对账] [开了「他的消息按空行分气泡」：正文每块（mnBlk 切段，代码块内不切）各成一个气泡；块指纹没变那个气泡一个字节不碰、只重画正在打的最后一块；羽毛笔思考气泡在第一段正文出现时清掉，第一泡带 first 跟头像行留距] [注释时间 2026-11-02] */
  function bubbleSyncSplit(el){
    var sc=liveScan(), typed=sc.filter(function(u){ return u.t==='text'; }).map(function(u){ return u.s; }).join('\n\n');
    if(!typed){ var th=bubbleTypingInner(); if(TW.hh!==th){ TW.hh=th; el.innerHTML=th; TW.bkm[0]=[]; return true; } return false; }
    var fx=el.firstElementChild;
    if(fx&&fx.classList&&!fx.classList.contains('md')){ el.innerHTML=''; TW.hh=''; TW.bkm[0]=[]; }   /* 羽毛笔思考气泡 → 第一段正文来了，清掉重画 */
    var bl=mnBlk(0,typed), meta=TW.bkm[0]||(TW.bkm[0]=[]), changed=el.children.length!==bl.length;
    while(el.children.length>bl.length){ el.removeChild(el.lastChild); meta.length=bl.length; }
    while(el.children.length<bl.length){ var d=document.createElement('div'); d.className='b ai md tap'+(el.children.length?'':' first'); d.setAttribute('data-live','1'); el.appendChild(d); }
    for(var i=0;i<bl.length;i++){ var b=el.children[i];
      if(meta[i]!==bl[i].sig){ b.innerHTML=md(bl[i].txt); meta[i]=bl[i].sig; changed=true; } }
    return changed; }
  function bubbleLiveSync(el){
    if(OPT.splitAI) return bubbleSyncSplit(el);
    var sc=liveScan(), typed=sc.filter(function(u){ return u.t==='text'; }).map(function(u){ return u.s; }).join('\n\n');
    if(!typed){ var th=bubbleTypingInner(); if(TW.hh!==th){ TW.hh=th; el.innerHTML=th; return true; } return false; }
    var bx=el.firstElementChild;
    if(!bx||!bx.classList||!bx.classList.contains('md')||!bx.classList.contains('b')){
      el.innerHTML='<div class="b ai md tap first" data-live="1"></div>'; bx=el.firstElementChild; TW.hh=''; delete TW.blk[0]; TW.bkm[0]=[]; }
    while(el.children.length>1) el.removeChild(el.lastChild);
    return mnSyncText(bx,0,mnBlk(0,typed)); }
  function livePaint(){ var el=list.querySelector('#tkLive'); if(!el||!ST) return;
    if(!MIN){ if(bubbleLiveSync(el)&&TW.atBot) list.scrollTop=list.scrollHeight; return; }
    if(mnSync(el)&&TW.atBot) list.scrollTop=list.scrollHeight; }
  function twTick(ts){ TW.raf=0; if(!liveAlive()) return; twSync();
    if(twHold()){ TW.ts=0; TW.raf=requestAnimationFrame(twTick); return; }   /* 手指按住：冻结写入，空转等松手/3 秒超时（见触摸冻结） */
    var hold=bsHold();
    if(TW.direct&&!hold){ TW.ts=ts; livePaint(); return; }
    var tot=twTotal();
    if(hold){ TW.ts=ts; livePaint(); return; }   /* SVG尾档三点模式：正文憋到收尾（liveScan sh 恒 0），这里不推进也不续跑——typed 恒空 livePaint 零成本，下一帧 SSE 的 liveFrame 会再踢，没有帧就完全空停 */
    /* [位置:phone-talk.js·twTick 长回复降频] [超长正文降到 30fps 逐字] [速率不快但回复很长时（比如 200 字/秒吐了 60 秒 = 一万两千字），每帧都要重排一遍全文；超过 3000 字就把重画降到 30fps，每次多吐一两个字，逐字感基本看不出，单帧成本减半] [注释时间 2026-10-27] */
    if(tot>3000&&TW.ts&&ts-TW.ts<28){ twKick(); return; }
    var back=tot-TW.shown;
    if(back>0){ var dt=TW.ts?Math.min(64,ts-TW.ts):16; var cps=TW.fast?900:Math.min(260,Math.max(36,36+back*1.2)); TW.shown=Math.min(tot,TW.shown+cps*dt/1000); }
    TW.ts=ts; livePaint(); if(back>0) twKick(); }   /* 2026-10-27：无字可吐就停 rAF 空转——续显（shown 已满）每 1.5s 被 liveFrame 踢一脚跑一帧即可，不再每帧空转；文本恢复增长时 back>0 自动续跑 */
  function twKick(){ if(TW.raf||!liveAlive()) return;   /* 10-31 起两种聊天样式都走打字机（气泡不再直出）；2026-11-02 例外：SVG尾档三点模式（bsHold），正文憋到收尾一次全出 */ TW.raf=requestAnimationFrame(twTick); }
  /* 一帧来了：实时区已经在页面上就只改它（和抽屉），不在（刚开始）才整页画 */
  /* [位置:phone-talk.js·liveMount] [实时区就地挂载] [11-05：生成中重进会话，进会话那一次渲染时 ST 还是 null、页面上没有实时区节点；
     watchStatus 首帧快照到了以后 liveFrame 发现没有节点就 rebuildSoon 整页重画一遍——重会话等于把整个列表的 DOM 再建一次
     （实测这一下 +5 秒，轻会话看不出来）。现在直接把这一个组节点挂到列表末尾，后续帧仍走 twKick / mnSync 的就地对账，不再整页重画] [注释时间 2026-11-05] */
  function liveMount(){
    if(!win.isConnected||list.querySelector('#tkLive')) return;
    var tmp=document.createElement('div'); tmp.innerHTML=liveWrap(); var el=tmp.firstChild; if(!el) return;
    list.appendChild(el);
    if(!MIN){ var bs=el.querySelectorAll('.col .b'); for(var i=bs.length-1;i>=0;i--){ if(!bs[i].classList.contains('na')){ bs[i].classList.add('tail'); break; } } }
    P.markAv&&P.markAv();
    if(P.bubble&&P.bubble.watch){ try{ P.bubble.watch(list); }catch(e){} }
  }
  function liveFrame(){ if(!list.querySelector('#tkLive')) liveMount();
    /* [位置:phone-talk.js·liveFrame 双通路分流] [一帧只走一条重画通道] [twKick（打字机逐帧）和 livePaintSoon（限频 30fps）原来是同时调的，两边都画，实测每秒重画 95 次、只比改前少一半；按模式分流：逐字交给打字机（rAF 逐帧），直出（模型吐太快 twRate 自动切的）交给限频器。10-31 气泡也走打字机后不再按样式分流，只按 direct 分] [注释时间 2026-10-31 改] */
    if(TW.direct) livePaintSoon(); else twKick();
    if(LIVE.dw&&LIVE.dw.isConnected&&!twHold()) dwPaint(LIVE.dw); }
  function onFrame(j){ if(!ST) return; if(j.model) ST.model=j.model;
    var ch=j.choices&&j.choices[0], d=(ch&&ch.delta)||{};
    /* [位置:phone-talk.js·onFrame ST.parts] [实时按到达顺序累加 思考/文字/工具] [抽屉要交替显示，不能把思考攒成一整段；规则与后端 streamTimeline 一致：连续思考合并、文字只记占位、工具记下标；收尾以 final_stream_timeline 为准] [注释时间 2026-10-21] */
    if(d.content){ ST.text+=d.content; var lp=ST.parts[ST.parts.length-1]; if(!lp||lp.type!=='text'){ lp={type:'text',text:'',ts:Date.now()}; ST.parts.push(lp); } lp.text+=d.content; }
    if(d.reasoning_content){ ST.reasoning+=d.reasoning_content; var rp=ST.parts[ST.parts.length-1]; if(rp&&rp.type==='reasoning') rp.text+=d.reasoning_content; else ST.parts.push({type:'reasoning',text:d.reasoning_content,ts:Date.now()}); }   /* 11-18：节点记到达时刻（与后端时间线同口径），思考行耗时=下一节点 ts − 本节点 ts；合并增量不改 ts */
    if(d.tool_start){ var a=d.tool_start, ai=a.index!=null?a.index:ST.tools.length; ST.tools[ai]={name:a.name,args:a.args||'',st:'run',id:a.id}; ST.parts.push({type:'tool',i:ai,ts:Date.now()}); }
    if(d.tool_args_delta){ var b=ST.tools[d.tool_args_delta.index]; if(b) b.args=(b.args||'')+(d.tool_args_delta.delta||''); }
    if(d.tool_end){ var c=d.tool_end, t=ST.tools[c.index]||(ST.tools[c.index!=null?c.index:ST.tools.length]={}); t.name=c.name||t.name; if(c.args) t.args=c.args; t.result=c.result; t.error=c.error; t.st=(c.ok===false||c.error)?'fail':'done'; }
    if(d.tool_trace&&d.tool_trace.length) ST.tools=d.tool_trace.map(function(x){ return {name:x.name,args:x.args,result:x.result,error:x.error,st:x.error?'fail':'done'}; });
    if(j.usage) ST.tokens=j.usage; if(j.final_content!=null) ST.final=j.final_content; if(j.final_stream_timeline) ST.timeline=j.final_stream_timeline;
    if(d.content||d.reasoning_content) twRate((d.content||'').length+(d.reasoning_content||'').length);
    if(ch&&ch.finish_reason){ ST.got=true; if(!ST.tend) ST.tend=Date.now(); }   /* 11-18：流结束时刻——最后一段思考（后面没有别的节点）的耗时兜底 */
    liveFrame(); }
  /* [位置:phone-talk.js·autoTitle] [AI 回复里的 <title>/<status> → 聊天页标题跟着变 + 列表即时回写] [10-27：改名与状态改由服务器收尾时处理（lib/tag-parser → lib/session-meta：AI 可以反复改名，用户手动改过的不覆盖），这里只负责：读到服务器上的最新名字刷新标题栏；
     新会话首轮服务器没处理到（网关还没更新等）时兜底写一次，与旧口径一致；每条回复同一个标题只处理一次；
     服务器写入可能比这里的同步晚一点点，没变化时 1.8 秒后再看一次；
     11-20：列表的 S.names/S.status 只在 load 时才拉，AI 起完名列表还是「新会话」；解析到的名字/状态顺带经 P.chats.patchMeta 回写列表并重画（零额外请求），开侧栏时的静默刷新兜底别处改的名] [注释时间 2026-11-20] */
  function autoTitle(m){ if(!m) return; var tx=String(typeof m.content==='string'?m.content:mText(m));
    var tm=tx.match(/<\s*title\b[^>]*>([\s\S]*?)<\s*\/title\s*>/i), sm=tx.match(/<\s*status\b[^>]*>([\s\S]*?)<\s*\/status\s*>/i);
    if(!tm&&!sm) return;
    var name=tm?tm[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,30):'';
    var st=sm?sm[1].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim():'';
    if(['进行中','待回复','待反馈','已完成'].indexOf(st)<0) st='';
    if(!name&&!st) return;
    var key=(m.id||'')+':'+name+':'+st; if(LIVE.titleKey===key) return; LIVE.titleKey=key; var sid=LIVE.sid;
    function patch(n,s){ if(sid&&P.chats&&P.chats.patchMeta){ try{ P.chats.patchMeta(sid,{name:n||undefined,status:s||undefined}); }catch(e){} } }
    if(st) patch('',st);
    if(!name) return;
    function shown(n){ LIVE.named=true; if(CTX0) CTX0.name=n; var nm=$('#tkNm',win); if(nm&&nm.firstChild&&nm.firstChild.nodeValue!==n) nm.firstChild.nodeValue=n; patch(n,''); }
    function look(again){ P.net.get('/heartbeat/admin/session-names',{noLogin:true}).then(function(x){ var cur=x&&x.names&&x.names[sid];
      if(cur){ var was=CTX0&&CTX0.name; shown(cur); if(again&&cur===was&&cur!==name) setTimeout(function(){ look(false); },1800); return; }
      if(!LIVE.askTitle) return; LIVE.askTitle=false;
      var o={}; o[sid]=name; return P.net.req('/heartbeat/admin/session-names',{method:'PUT',body:{set:o}}).then(function(){ shown(name); }); }).catch(function(){}); }
    look(true); }
  function done(rid){ var s0=ST; if(!s0) return;
    /* [位置:phone-talk.js·done 打字机收尾] [极简样式：回复收完时打字机可能还没吐完，加速吐完（最多 2.2 秒）再换成落盘的消息，免得被整体重画截断] [注释时间 2026-10-21] */
    if(s0.got&&!s0.drained&&!TW.direct&&!bsHold()&&TW.st===s0&&TW.shown<twTotal()){ TW.fast=true; var tw0=Date.now();   /* SVG尾档三点模式不追赶：shown 本来就没动，收完直接 rebuild 一次全出（这正是她要的效果） */ (function wt(){ if(ST!==s0) return; if(TW.shown>=twTotal()||Date.now()-tw0>2200){ s0.drained=true; done(rid); } else setTimeout(wt,60); })(); return; }
    LIVE.busy=false; ST=null; LIVE.dw=null; qFinish();   /* 11-04：回复结束，排队里没被取走的取回重发 */
    if(!s0.got){ toast('没收完整，去后端看看'); keepPartial(s0,rid); rebuild(); watchStatus(); partialSync(1); return; }
    var am={id:rid,role:'assistant',content:s0.final!=null?s0.final:s0.text,reasoning:s0.reasoning,tools:s0.tools.filter(Boolean).map(function(t){ return {name:t.name,args:t.args,result:t.result,error:t.error}; }),stream_timeline:s0.timeline||undefined,tokens:s0.tokens,time:new Date().toISOString()};
    LIVE.raw.push(am); autoTitle(am); applySuggest(am,true);
    rebuild(); buzz(6); setTimeout(reload,1500); }
  /* 刷新 / 断线后：问 /v1/chat/status 他是不是还在回，在回就显示「输入中」+已经写出来的字，回完再拉一次历史 */
  var stT=0;
  /* [位置:phone-talk.js·watchStatus] [续显轮询瘦身] [2026-10-29 性能批：原来生成中每 1.5s 拉一次全量快照（实测平均 86KB/次、最大 242KB，两个会话并行约 5.4MB/分钟）。现在首帧仍全量（重进续显要还原 text/parts），之后只要已有快照且 SSE 5 秒内来过帧就只拉 lite（服务端只回阶段/长度/运行中工具，约 1KB），SSE 不在才继续全量；间隔 3s、最长 5 分钟硬顶；首次进入不再重复拉一次 history（setup 刚拉过）] [注释时间 2026-10-29] */
  function watchStatus(first,noReload){ clearTimeout(stT); var n=0, t0=Date.now();
    function tick(){
      if(!win.isConnected) return;
      if(Date.now()-t0>300000){ if(LIVE.byStatus){ LIVE.busy=false; LIVE.byStatus=false; ST=null; LIVE.dw=null; try{ reloadDelta(); }catch(_e){} } return; }   /* 5 分钟硬顶退出时把「忙」清掉，否则发送键卡在停止 */
      var wantFull=(n===0);
      var lite=(!wantFull)&&LIVE.byStatus&&LIVE.sseAt&&(Date.now()-LIVE.sseAt)<5000;
      P.net.req('/v1/chat/status?session_id='+encodeURIComponent(LIVE.sid)+(wantFull?'&full=1':(lite?'&lite=1':'')),{headers:XC,noLogin:true}).then(function(j){
        /* 1021：服务端现在会续租（正文/思考/工具事件都刷新 ts）并由回收者把过期的标成 aborted 终态（j.aborted）。
           回收者还在试运行期间，首次进入仍用与回收阈值同口径的 45 秒兜底，免得撞上没收尾的陈旧快照；
           进入「他在回复」之后的后续轮询保持 120 秒，长工具调用/长思考不闪。真回收打开并观察无误判后，这层兜底可删。 */
        var fresh=!j||!j.ts||(Date.now()-j.ts)<(first&&!LIVE.byStatus?45000:120000);
        if(j&&j.aborted) j={active:false,done:true};
        /* lite：只维护阶段。正文/思考/工具靠 SSE 增量，不覆写 ST（省掉每次几百 KB 的 parse + 对象重建） */
        if(lite){
          if(j&&j.active&&!j.done&&fresh){ if(++n<200) stT=setTimeout(tick,3000); return; }
          if(LIVE.byStatus){ LIVE.busy=false; LIVE.byStatus=false; ST=null; LIVE.dw=null; }
          if(j&&j.done) reloadDelta(); return;
        }
        var has=j&&(j.text||j.reasoning||(j.tools&&j.tools.length));
        if(j&&j.active&&!j.done&&fresh&&(has||LIVE.byStatus)){ if(!LIVE.busy){ var hadPartial=!!LIVE.partial; dropPartial(); LIVE.busy=true; LIVE.byStatus=true; LIVE.rid=(j.reply_msg_id||LIVE.rid||''); ST={text:'',reasoning:'',tools:[],parts:[],tokens:null,model:'',t0:j.ts||Date.now(),got:false,rec:1}; if(hadPartial) rebuild(); }
          if(LIVE.byStatus&&ST){ ST.text=j.text||''; ST.reasoning=j.reasoning||'';
            ST.tools=(j.tools||[]).map(function(x){ return {id:x.id,name:x.name,args:x.args,result:x.result,error:x.error,st:x.status==='running'?'run':x.error?'fail':'done'}; });
            /* [位置:phone-talk.js·watchStatus ST.parts] [重进续显按到达顺序还原] [用户 1025：生成中退出重进时，status 以前只给平铺 text/reasoning/tools，前端只能兜底成「思考整段在前、工具一排、正文垫底」，和实时排版对不上；服务端现在带 parts（快照按到达顺序记），按它重建：工具节点按 id 对回 ST.tools 下标（tools map 因此补了 id，与实时路径 tool_start 同构）；对不上 id 的工具节点丢弃，ST.parts 为空仍走原兜底] [注释时间 2026-10-25] */
            if(j.parts&&j.parts.length){ var ps=[]; j.parts.forEach(function(p){ if(!p||!p.type) return;
              if(p.type==='tool'){ var k=-1; for(var q=0;q<ST.tools.length;q++){ if(ST.tools[q]&&ST.tools[q].id&&ST.tools[q].id===p.id){ k=q; break; } } if(k>=0) ps.push({type:'tool',i:k,ts:p.ts}); }
              else if(p.type==='text') ps.push({type:'text',text:p.text||'',ts:p.ts});
              else if(p.type==='reasoning') ps.push({type:'reasoning',text:p.text||'',ts:p.ts}); });   /* 11-18：服务端快照带 ts，重进续显时思考段耗时照常能算 */
              ST.parts=ps; }
            /* [位置:phone-talk.js·watchStatus tick 续显刷新] [生成中重进的就地对账] [原来每个 tick 都 rebuildSoon 整页重画：重进续显路径每 1.5 秒整页重建一次（实时路径没有这毛病），重画打断手指滚动、上方图片反复重载把视口往上顶，表现为「重进后无法滚动、一直弹回顶」；现在实时区已在页面上就走 liveFrame（与实时帧同一条就地对账路），不在（首画）才 rebuildSoon] [注释时间 2026-10-27] */
            liveFrame(); }
          if(++n<200) stT=setTimeout(tick,3000); return; }
        if(LIVE.byStatus){ LIVE.busy=false; LIVE.byStatus=false; ST=null; LIVE.dw=null; }
        if(j&&j.active&&!j.done&&fresh&&++n<200){ stT=setTimeout(tick,3000); return; }
        if(!(noReload&&first)&&(!first||(j&&j.done))) reload();
      },function(){
        /* [位置:phone-talk.js·watchStatus 请求失败] [查不到状态不等于空闲] [11-13 审查：原来请求一失败就清 busy，发送键从「停止」切回「发送」，用户会以为他没在回而重复发；现在首次失败仍然 reload 一次（拉开页面就断网的情况），之后保持现状、3 秒后重试，真收尾靠 SSE/下一次 tick 确认] [注释时间 2026-11-13] */
        if(first){ reload(); return; }
        if(++n<200) stT=setTimeout(tick,3000);
      });
    }
    tick();
  }

  /* ---------- 照片 / 拍照 / 文件：先放到输入框上面的缩略图条，传好后手动发送 ----------
     [位置:phone-talk.js·attPick/attAdd/attPaint/attPart] [待发附件条] [照旧 chat.html 的 imgData/fileData/renderPreviews：选完先进缩略图条（图片压缩后立刻上传，文件立刻上传），状态 处理中/上传中/就绪/失败，可逐个 × 移除，可多选；点发送时只发已就绪的，有失败的要先移除；可以只发图不写字] [注释时间 2026-10-21 改：原来选完图直接发出去] */
  function shrink(fl,max){ return new Promise(function(res,rej){ var rd=new FileReader(); rd.onerror=rej; rd.onload=function(){ if(/^image\/gif/.test(fl.type)){ res(rd.result); return; } if(!/^image\//.test(fl.type)){ res(rd.result); return; } var im=new Image(); im.onerror=function(){ res(rd.result); }; im.onload=function(){ var k=Math.min(1,max/Math.max(im.width,im.height)); if(k>=1&&fl.size<1.5e6){ res(rd.result); return; } var c=document.createElement('canvas'); c.width=Math.round(im.width*k); c.height=Math.round(im.height*k); c.getContext('2d').drawImage(im,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',.86)); }; im.src=rd.result; }; rd.readAsDataURL(fl); }); }
  var FILE_ACCEPT='application/*,text/*,audio/*,.md,.markdown,.txt,.json,.csv,.log,.yaml,.yml,.xml,.html,.zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
  function attPick(k){
    /* [位置:phone-talk.js·attPick accept] [相册/文件原生混合选择器] [2026-11-21 改：k==='att' 不设 accept，直接唤起 iOS 原生「照片图库 / 拍照 / 选取文件」菜单，不再套中间弹窗；cam 仍限 image/* 并带 capture] [注释时间 2026-11-21] */
    var f=document.createElement('input'); f.type='file'; if(k==='photo'||k==='cam') f.accept='image/*'; else if(k==='file') f.accept=FILE_ACCEPT; if(k==='cam') f.setAttribute('capture','environment'); else f.multiple=true;
    /* [位置:phone-talk.js·attPick] [修"点了没反应"] [不在 DOM 里的 input 调 click()，iOS Safari / PWA 独立窗口经常静默不开选图器；先挂到 body 再点，选完摘掉；取消选图时 onchange 不触发，靠 5 分钟兜底清理] [注释时间 2026-10-26] */
    f.style.display='none';
    var _picked=false;
    function _cleanup(){ if(_picked) return; _picked=true; if(f.parentNode) f.parentNode.removeChild(f); }
    f.onchange=function(){ Array.prototype.forEach.call(f.files||[],function(fl){ attAdd(fl,k); }); _cleanup(); };
    document.body.appendChild(f);
    f.click(); setTimeout(_cleanup,300000); }
  function attAdd(fl,k){
    var isImg=(k==='photo'||k==='cam')||/^image\//.test(fl.type||'');
    /* [位置:phone-talk.js·attAdd] [GIF 体积闸] [GIF 走透传不压缩，超后端 upload_max_mb（默认 2MB，聊天页设置可调）必被 413；选前拦截并说明原因] [注释时间 2026-10-26] */
    if(isImg&&/gif/i.test(fl.type||'')&&fl.size>2*1024*1024){ toast('这个 GIF 有 '+Math.round(fl.size/1048576*10)/10+'MB——动图不压缩，上限 2MB，传不上去的'); return; }
    if(ATT.length>=9){ toast('一次最多 9 个附件'); return; }
    var a={id:++attSeq,img:isImg,name:fl.name||'图片',st:'processing',url:'',thumb:'',file:null,err:''}; ATT.push(a); attPaint();
    function fail(e){ a.st='error'; a.err=String(e&&e.message||'').replace(/^HTTP /,'').slice(0,40)||'没传上'; attPaint(); toast('「'+a.name+'」没传上：'+a.err); buzz([20,30,20]); }
    if(isImg) shrink(fl,1600).then(function(du){ a.thumb=du; a.st='uploading'; attPaint(); return P.net.post('/v1/upload-image',{data:du}); }).then(function(r){ if(!r||!r.url) throw new Error('没传上'); a.url=r.url; a.st='ready'; attPaint(); }).catch(fail);
    else new Promise(function(res,rej){ var rd=new FileReader(); rd.onerror=rej; rd.onload=function(){ res(String(rd.result).split(',')[1]||''); }; rd.readAsDataURL(fl); })
      .then(function(b64){ a.st='uploading'; attPaint(); return P.net.post('/v1/upload-file',{name:fl.name,mime:fl.type||'application/octet-stream',data:b64}); })
      .then(function(r){ if(!r||!r.url) throw new Error('没传上'); a.file={name:r.name||fl.name,url:r.url,size:r.size,mime:r.mime}; a.url=r.url; a.st='ready'; attPaint(); }).catch(fail); }   /* 2026-11-15 修 11-14 回归：文件也把 a.url 写上，草稿的 ready&&url 才认它（attPart 发送仍读 a.file，行为不变） */
  function attPart(a){ return a.img?{type:'image_url',image_url:{url:a.url}}:{type:'file',file:a.file}; }
  var attBar=$('#tkAtt',win);
  /* [位置:phone-talk.js·草稿附件回填] [刷新/退出重进后已传好的图片还在] [11-14：输入框缓存只有文字不带图片；只回填已就绪且带 url 的，缩略图直接用服务器 URL，不存 base64（localStorage 只有 5MB 左右）] [注释时间 2026-11-14] */
  if(LIVE.sid&&!ATT.length){ (function(){ var d1=dGet(); if(!d1.a.length) return;
    ATT=d1.a.map(function(x){ var id=++attSeq; return {id:id,img:!!x.img,name:x.name||(x.img?'图片':'文件'),st:'ready',url:x.url||(x.file&&x.file.url)||'',thumb:x.img?(x.url||(x.file&&x.file.url)||''):'',file:x.file||null,err:''}; });
    attPaint(); busyPaint(); })(); }
  function attPaint(){ attBar.hidden=!ATT.length;
    attBar.innerHTML=ATT.map(function(a){ var st=a.st==='error'?' err':a.st==='ready'?'':' busy';
      return '<div class="att '+(a.img?'img':'file')+st+'" data-a="'+a.id+'"'+(a.img?' title="点开：预览 / 涂鸦 / 裁剪"':'')+'>'+(a.img?'<img src="'+esc(a.thumb||'')+'" alt="">':'<span class="ic">'+esc(extBadge(a.name))+'</span><span class="nm">'+esc(a.name)+'</span>')+
        '<i class="as">'+(a.st==='error'?'!':a.st==='ready'?'':'<u></u>')+'</i><button class="ax" type="button" data-ax="'+a.id+'" aria-label="移除">×</button></div>'; }).join('');
    busyPaint(); dPut(); }   /* 11-14：附件增减/传完都存一次草稿（只存已就绪的），刷新后图片还在 */
  attBar.addEventListener('click',function(e){
    var ax=e.target.closest('[data-ax]');
    if(ax){ var id=+ax.getAttribute('data-ax'); ATT=ATT.filter(function(a){ return a.id!==id; }); buzz(5); attPaint(); return; }
    /* [位置:phone-talk.js·attBar click] [缩略图点开编辑] [用户 1026 需求：附件缩略图点开=预览/画笔/裁剪，保存后重新上传替换；仅图片可编辑，× 移除按钮优先] [注释时间 2026-10-26] */
    var t=e.target.closest('.att.img'); if(!t||!window.openImgEditor) return;
    var a=ATT.filter(function(z){ return z.id===+t.getAttribute('data-a'); })[0];
    if(!a||(!a.thumb&&!a.url)||a.st==='uploading') return;
    buzz(6);
    openImgEditor(a.thumb||a.url).then(function(out){
      if(!out) return;
      a.thumb=out; a.url=''; a.st='uploading'; attPaint();
      P.net.post('/v1/upload-image',{data:out}).then(function(r){
        if(!r||!r.url) throw new Error('没传上');
        a.url=r.url; a.st='ready'; attPaint();
      }).catch(function(err){ a.st='error'; a.err=String(err&&err.message||'').replace(/^HTTP /,'').slice(0,40)||'没传上'; attPaint(); toast('「'+a.name+'」没传上：'+a.err); buzz([20,30,20]); });
    });
  });

  /* ---------- 长按菜单（真会话）：复制 / 编辑 / 删除走 /v1/timeline/sync；标星 / 朗读走管理台 ---------- */
  /* [位置:phone-talk.js·sync] [编辑/删除消息同步入口] [长按菜单与多选删除共用；11-14 审查 B 批收尾：后端两处 ok:false 改成 409 + {error, code} 后，P.net.req 对非 2xx 会 throw httpErr（message 带 HTTP 前缀），这里补一个错误分支把 e.body.error 的人话剥出来，提示不变差；ok===false 分支保留兼容老回包] [注释时间 2026-11-14] */
  function sync(ops){ return P.net.req('/v1/timeline/sync',{method:'POST',body:{session_id:LIVE.sid,ops:ops},headers:XC}).then(function(r){ if(r&&r.ok===false) throw new Error(r.error||(r.rejected&&r.rejected.length?'这段已经压进状态了，改不了':'没改成')); return r; },function(e){ throw new Error((e&&e.body&&e.body.error)||((e&&e.message)||'没改成').replace(/^HTTP \d+\s*/,'')); }); }
  function sha32(str){ try{ return crypto.subtle.digest('SHA-256',new TextEncoder().encode(str)).then(function(b){ return Array.prototype.map.call(new Uint8Array(b),function(x){ return ('0'+x.toString(16)).slice(-2); }).join('').slice(0,32); }); }catch(e){ return Promise.resolve(''); } }
  var AU=null, STAR={ids:{},keys:{},on:false};
  function isStar(m){ return !!(m&&STAR&&STAR.on&&(m.id&&STAR.ids[m.id]||m._sk&&STAR.keys[m._sk])); }
  function loadStars(){ return P.net.get('/heartbeat/admin/context-compaction/marked-list',{noLogin:true}).then(function(r){ var arr=Array.isArray(r)?r:(r&&(r.items||r.results))||[], ids={}, keys={};
      arr.forEach(function(it){ var k=it&&it.key; if(typeof k!=='string') return; ids[k]=1; keys[k]=1; if(it.msg_id) ids[it.msg_id]=1; });
      STAR.ids=ids; STAR.keys=keys; STAR.on=true;
      var need=LIVE.raw.filter(function(m){ return !ids[m.id]&&!m._sk; }); if(!need.length) return 0;
      var hit=0, i=0;
      return new Promise(function(done){ (function step(){ var batch=need.slice(i,i+20); i+=20;
        if(!batch.length){ done(hit); return; }
        Promise.all(batch.map(function(m){ return sha32((m.role||'')+'\u0000'+mText(m)).then(function(k){ m._sk=k; if(STAR.keys[k]) hit++; }); }))
          .then(function(){ (window.requestAnimationFrame||function(f){ setTimeout(f,16); })(step); }); })(); });
    }).then(function(hit){ if(hit&&!LIVE.busy) rebuild(); },function(){}); }
  function starPost(m,want){ var raw=mText(m); var ready=m.key?Promise.resolve(m.key)   /* m.key：状态机原文预览自带服务端内容键，直接用不重算（10-29 #49） */
    :sha32((m.role||'')+'\u0000'+raw).then(function(key){ if(!m._sk) m._sk=key; return P.net.post('/heartbeat/admin/context-compaction/mark',{msg_id:m.id||'',key:key||m.id,marked:want,content:raw,role:m.role||'',msg_time:m.time||''}); }).then(function(j){ if(j&&j.ok===false) throw new Error(j.error||'');
      STAR.on=true; if(want){ if(m.id) STAR.ids[m.id]=1; if(m._sk) STAR.keys[m._sk]=1; } else { delete STAR.ids[m.id]; delete STAR.keys[m._sk]; } }); }
  /* 编辑：只给你看正文；他正文里给后端看的标签（闹钟、记忆、卡片、时间戳……）藏起来，保存时原样接回去 */
  /* HIDE_RE 已删（2026-10-28 第6项：全文件无人引用的死代码，剥离清单统一读 PHTags） */
  /* [位置:phone-talk.js·verLoad/verPaint/verSwitch/verMenu/verDelete] [同会话版本条「‹ 2/3 ›」] [11-10：重新生成 / 编辑后重新生成时，后端把旧内容整段存成版本（lib/timeline-versions.js）；这里在「有版本的那条用户消息」下面画一条小版本条，两边箭头切换（切换 = 整段后面的内容一起换，带淡入），中间的「2/3」点开可删除当前这个版本。版本表 VER.map = {锚点用户消息id:{count,cur}}，每次 reload 之后顺带拉一次（没有版本时后端直接回空表）；render 之后 verPaint 把条插进 DOM（render 整页重画，所以每次都重插）；只有版本数增加那一次带轻微弹出，平时重画不闪] [注释时间 2026-11-10] */
  var VCH={l:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',r:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'};
  function verErr(e,dflt){ var m=String(e&&e.message||''), mm=m.match(/"error"\s*:\s*"((?:[^"\\]|\\.)*)"/); if(mm){ try{ return JSON.parse('"'+mm[1]+'"'); }catch(x){} } return dflt; }
  function verLoad(){ if(!LIVE.sid) return Promise.resolve();
    return P.net.req('/v1/timeline/versions?session_id='+encodeURIComponent(LIVE.sid),{headers:XC,noLogin:true}).then(function(r){ var nm=(r&&r.versions)||{}, om=VER.map;
      if(VER.seen) Object.keys(nm).forEach(function(id){ if(!om[id]||nm[id].count>om[id].count) VER.pop[id]=1; });
      VER.seen=true;
      if(JSON.stringify(nm)!==JSON.stringify(om)){ VER.map=nm; verPaint(); } },function(){}); }
  function verPaint(){
    Array.prototype.forEach.call(list.querySelectorAll('.tk-ver'),function(x){ x.remove(); });
    if(!Object.keys(VER.map).length) return;
    var last={};
    Array.prototype.forEach.call(list.querySelectorAll('[data-r]'),function(e){ var rf=REF[+e.getAttribute('data-r')], raw=rf&&rf.raw; if(raw&&raw.role==='user'&&raw.id&&VER.map[raw.id]) last[raw.id]=e; });
    Object.keys(last).forEach(function(id){ var v=VER.map[id], e=last[id], at=(e.parentNode&&e.parentNode.classList.contains('tk-imgs'))?e.parentNode:e;
      var bar=document.createElement('div'); bar.className='tk-ver'+(VER.pop[id]?' pop':''); bar.setAttribute('data-vid',id);
      bar.innerHTML='<button type="button" data-vd="-1" aria-label="上一个版本"'+(v.cur<=0?' disabled':'')+'>'+VCH.l+'</button><button type="button" class="tk-vn" data-vm aria-label="第 '+(v.cur+1)+' 个版本，共 '+v.count+' 个">'+(v.cur+1)+'/'+v.count+'</button><button type="button" data-vd="1" aria-label="下一个版本"'+(v.cur>=v.count-1?' disabled':'')+'>'+VCH.r+'</button>';
      at.parentNode.insertBefore(bar,at.nextSibling);
      if(VER.flash===id){ VER.flash=''; var n=0; for(var x=bar.closest('.tk-g');x;x=x.nextElementSibling){ x.classList.add('tk-vin'); x.style.animationDelay=Math.min(n++*36,180)+'ms'; }
        setTimeout(function(){ Array.prototype.forEach.call(list.querySelectorAll('.tk-vin'),function(y){ y.classList.remove('tk-vin'); y.style.animationDelay=''; }); },900); } });
    VER.pop={};
  }
  function verSwitch(bar,id,to){
    if(LIVE.busy){ toast('他还在回，等这一条结束'); return; }
    var v=VER.map[id]; if(!v||to<0||to>=v.count) return;
    bar.classList.add('busy'); buzz(6);
    P.net.post('/v1/timeline/version/switch',{session_id:LIVE.sid,anchor_id:id,index:to},{headers:XC}).then(function(r){
      VER.map[id]={count:r.count,cur:r.cur}; VER.flash=id; LIVE.sig=null; if(LOC) LOC=null; return reload(); })
      .then(function(){ return verLoad(); })
      .catch(function(e){ bar.classList.remove('busy'); toast(verErr(e,'没切成')); buzz([20,30,20]); });
  }
  function verMenu(id,v){
    sheet('<div class="hd"><span>删除这个版本？</span></div><div class="opt"><p class="tk-cfp">现在看到的是第 '+(v.cur+1)+' 个，共 '+v.count+' 个。删掉它，其他版本都不受影响。</p></div><div class="tk-dl"><button class="nw tap ghost">算了</button><button class="nw tap red" data-vdel>删除</button></div>','opts',function(box,close){
      box.addEventListener('click',function(e){ var b=e.target.closest('.nw'); if(!b) return; close(); if(b.hasAttribute('data-vdel')) verDelete(id,v.cur); }); });
  }
  function verDelete(id,idx){
    if(LIVE.busy){ toast('他还在回，等这一条结束'); return; }
    P.net.post('/v1/timeline/version/delete',{session_id:LIVE.sid,anchor_id:id,index:idx},{headers:XC}).then(function(r){
      if(r.count<2) delete VER.map[id]; else VER.map[id]={count:r.count,cur:r.cur};
      VER.flash=id; LIVE.sig=null; if(LOC) LOC=null; buzz([8,30,8]); return reload(); })
      .then(function(){ return verLoad(); })
      .catch(function(e){ toast(verErr(e,'没删掉')); buzz([20,30,20]); });
  }
  list.addEventListener('click',function(e){ var b=e.target.closest('.tk-ver button'); if(!b) return; e.stopPropagation();
    var bar=b.parentNode, id=bar.getAttribute('data-vid'), v=VER.map[id]; if(!v||bar.classList.contains('busy')) return;
    if(b.hasAttribute('data-vm')){ buzz(6); verMenu(id,v); return; }
    verSwitch(bar,id,v.cur+(+b.getAttribute('data-vd'))); });
  /* [位置:phone-talk.js·delConfirm] [删除消息的确认] [点菜单里的「删除」后不再用模糊蒙版：被选中要删的那条消息的气泡标红（红线围起来 + 浅红底，弹一下），底下弹「确认删除这条消息？」，取消在左、删除在右（2026-11-16 统一为执行在右）；取消或点空白就取消标红；确认后那几个气泡缩小淡出，再真删（失败就恢复）] [注释时间 2026-10-22；2026-11-16 改按钮顺序] */
  function delConfirm(m){
    var els=[].filter.call(list.querySelectorAll('[data-r]'),function(e){ var rf=REF[+e.getAttribute('data-r')]; return rf&&rf.raw===m&&(e.classList.contains('b')||e.classList.contains('tk-cardw')); });
    els.forEach(function(e){ e.classList.add('tk-del'); });
    function unmark(){ els.forEach(function(e){ e.classList.remove('tk-del','tk-gone'); }); }
    var pop=sheet('<div class="hd"><span>确认删除这条消息？</span></div>'+(VER.map[m.id]?'<div class="opt"><p class="tk-cfp">它的另外 '+(VER.map[m.id].count-1)+' 个版本也会一起删掉。</p></div>':'')+'<div class="tk-dl"><button class="nw tap ghost" data-no type="button">取消</button><button class="nw tap red" data-ok type="button">删除</button></div>','del',function(box,close){
      box.querySelector('[data-no]').addEventListener('click',function(){ unmark(); close(); });
      box.querySelector('[data-ok]').addEventListener('click',function(){
        var t0=Date.now(); els.forEach(function(e){ e.classList.add('tk-gone'); }); buzz([10,30,10]); close();
        sync([{op:'delete',id:m.id}]).then(function(){ setTimeout(function(){ dropLocal([m.id]); toast('删掉了'); reload(); },Math.max(0,340-(Date.now()-t0))); },function(e){ unmark(); toast(String(e.message||'没删掉').slice(0,40)); buzz([20,30,20]); }); });
    });
    pop.querySelector('.scrim').addEventListener('click',unmark);
  }
  function liveAct(k,g){ var m=g.raw;
    if(k==='copy'){ var tx=g.x||(m.role==='user'?stripCT(mText(m)):stripTags(mText(m))).trim(); (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(tx):Promise.reject()).then(function(){ toast('已拷贝'); },function(){ toast('这台手机不让拷贝'); }); return; }
    if(k==='think'){ setTimeout(function(){ drawer(false,dataOf(m)); },200); return; }
    /* [位置:phone-talk.js·liveAct edit] [编辑框放原始完整消息] [10-23 需求 39：编辑框里直接是消息的原文，<current_time>、[push]、<voice>、<wake> 等标签和外壳都在，保存原样写回，不再摘走又拼回；不改动直接点保存＝不动；只有一种情况会多问一句——你的消息原来带 <current_time>、现在被删掉了（那条消息的时间会不准）] [注释时间 2026-10-23] */
    if(k==='edit'){ var orig=mText(m), sp={vis:orig.replace(/\s+$/,'')};
      /* [位置:phone-talk.js·liveAct edit 仅保存开关] [编辑用户消息：保存后默认重新生成，「仅保存」打开就只改这一条] [11-10：编辑自己的消息多半是想让他按新话重答；开关默认关＝保存并重新生成（旧回复留成上一个版本，可切回），开了＝只保存、不动后面；选择记在本机（ph.tk.editOnly）；他的消息不显示开关，编辑仍只保存] [注释时间 2026-11-10] */
      var EO={only:false,on:m.role==='user'}; try{ EO.only=localStorage.getItem('ph.tk.editOnly')==='1'; }catch(e){}
      var ov=document.createElement('div'); ov.className='tk-ed';
      ov.innerHTML='<div class="scrim"></div><div class="box"><b class="hd">'+(m.role==='user'?'编辑这条消息':'编辑这条回复')+'</b><textarea placeholder="编辑内容…">\n'+esc(sp.vis)+'</textarea>'+(EO.on?'<button class="tk-eo'+(EO.only?' on':'')+'" type="button" role="switch" aria-checked="'+EO.only+'" data-eo><span>仅保存</span><i></i></button>':'')+'<div class="bt"><button class="tap" data-x>取消</button><button class="tap ok" data-ok><span>'+(EO.on&&!EO.only?'保存并重新生成':'保存')+'</span></button></div></div>';
      host.appendChild(ov); var tx=ov.querySelector('textarea'), bx=ov.querySelector('.box'), unkb=null, fitT=0, backT=0;
      /* [位置:phone-talk.js·liveAct edit] [编辑弹窗跟软键盘] [用户报：长按 AI 消息点「编辑」，软键盘弹出时编辑窗死在中线不动、输入框被键盘盖住。现在输入框聚焦时挂上 P.kb，键盘高度大于 0 就按「弹窗底边离键盘上沿 12px」所需的最小量把 .box 抬起来（抬升用 bottom，不用 transform——.box 的出现动画就是 transform，会打架）；够不着才抬，本来露着就不动；失焦 / 键盘收起还原；弹窗关闭时用 P.kb 返回的注销函数退掉监听，防监听堆积] [注释时间 2026-11-01] */
      function kbFit(kb){
        if(!bx||!bx.isConnected) return;
        bx.style.bottom='';   /* 先清掉上次的抬升，量到的才是没抬过的位置 */
        kb=Math.round(kb||0); if(kb<=0) return;
        var bR=bx.getBoundingClientRect(), hR=host.getBoundingClientRect();
        var kbTop=(window.innerHeight||document.documentElement.clientHeight||0)-kb;   /* 键盘上沿：布局视口高度减键盘高度，和 P.kb 的算法同一坐标系 */
        var need=Math.round(bR.bottom+12-kbTop);   /* 让弹窗底边离键盘上沿 12px 需要的抬升量：按整个弹窗算，输入框底边在它之上一定更露着（只按输入框算的话，取消/保存那排会掉到键盘底下点不到） */
        if(need<=0) return;   /* 本来就露着（例如底部内边距已经把它顶上去了）就不动，避免抬两次 */
        var cap=Math.round(bR.top-hR.top-8);   /* 最多抬到离弹窗区顶部 8px，别把弹窗顶出屏幕 */
        if(cap<0) cap=0;
        bx.style.bottom=Math.min(kb,need,cap)+'px';
      }
      /* [位置:phone-talk.js·liveAct edit kbNow] [当场量一次键盘高度] [P.kb 只在 visualViewport 起落时才回调：打开弹窗时键盘就已经弹着（在输入栏里打完字直接长按消息），它一次都不会回调，框照样纹丝不动，所以聚焦当下要自己按 P.kb 的同一套公式量一把——innerHeight - visualViewport.height - offsetTop；布局视口自己变矮的机型（Android 部分 WebView）这么算得到 0，等于不抬，那种机型页面本来就会跟着缩] [注释时间 2026-11-01] */
      function kbNow(){ var vv=window.visualViewport; if(!vv) return 0; return Math.max(0,Math.round((window.innerHeight||document.documentElement.clientHeight||0)-(vv.height||0)-(vv.offsetTop||0))); }
      /* [位置:phone-talk.js·liveAct edit kbOn] [聚焦：挂监听 + 当场校正 + 动画后补量] [① 同一个弹窗只挂一次 P.kb，防监听堆积；② 聚焦这一刻先按当前高度抬一次，键盘早弹着也跟得上；③ 弹窗的出现动画是 transform:scale(.96)，键盘升起那 300ms 常和动画撞在一起，量到的框偏小（底边比最终位置高约 9px），只按这一次量会差一点点盖住输入框，所以等动画走完（340ms）按真实几何再校正一次] [注释时间 2026-11-01] */
      function kbOn(){ if(!P.kb) return; if(!unkb) unkb=P.kb(kbFit); clearTimeout(fitT); kbFit(kbNow()); fitT=setTimeout(function(){ if(unkb) kbFit(kbNow()); },340); }
      /* [位置:phone-talk.js·liveAct edit kbOff] [失焦延迟还原] [点「保存」时手指先让 textarea 失焦，要是失焦就立刻落回原位，「保存」会在点到之前溜走、点空（键盘还开着）；所以失焦后等 200ms 再还原，这期间重新聚焦就作罢。键盘真收起时 P.kb 回调给的高度是 0，走 kbFit 里同一条还原] [注释时间 2026-11-01] */
      function kbOff(){ clearTimeout(fitT); clearTimeout(backT); backT=setTimeout(function(){ if(!bx||document.activeElement===tx) return; if(unkb){ unkb(); unkb=null; } bx.style.bottom=''; },200); }
      tx.addEventListener('focus',kbOn);
      tx.addEventListener('blur',kbOff);
      requestAnimationFrame(function(){ ov.classList.add('show'); try{ tx.focus(); tx.setSelectionRange(tx.value.length,tx.value.length); }catch(e){} });
      /* 关弹窗（点空白 / 取消 / 保存）：超时器清掉、监听用 P.kb 返回的函数注销、抬升还原 */
      function cl(){ clearTimeout(fitT); clearTimeout(backT); if(unkb){ unkb(); unkb=null; } if(bx) bx.style.bottom=''; ov.classList.remove('show'); setTimeout(function(){ ov.remove(); },220); }
      ov.addEventListener('click',function(e){ if(e.target.classList.contains('scrim')||e.target.closest('[data-x]')){ cl(); return; }
        var eob=e.target.closest('[data-eo]'); if(eob){ EO.only=!EO.only; try{ localStorage.setItem('ph.tk.editOnly',EO.only?'1':'0'); }catch(e1){} eob.classList.toggle('on',EO.only); eob.setAttribute('aria-checked',EO.only); buzz(6);
          var okb=ov.querySelector('[data-ok] span'); if(okb){ okb.classList.add('sw'); setTimeout(function(){ okb.textContent=EO.only?'保存':'保存并重新生成'; okb.classList.remove('sw'); },110); } return; }
        if(!e.target.closest('[data-ok]')) return;
        var v=tx.value.replace(/\s+$/,''); var imgs=Array.isArray(m.content)?m.content.filter(function(x){ return x&&x.type!=='text'; }):[];
        if(!v.trim()&&!imgs.length){ toast('不能是空的'); return; } if(v===sp.vis){ cl(); return; }
        var nc=Array.isArray(m.content)?imgs.concat(v.trim()?[{type:'text',text:v}]:[]):v;
        function save(){ if(EO.on&&!EO.only){ if(regenEdit(m,nc)) cl(); return; }   /* 默认：保存并重新生成 */
          sync([{op:'edit',id:m.id,newContent:nc}]).then(function(){ m.content=nc; m.stream_timeline=null; m._sk=null; cl(); toast('改好了'); rebuild(); reload(); },function(e2){ toast(String(e2.message||'没改成').slice(0,40)); buzz([20,30,20]); }); }
        if(/<current_time>/i.test(orig)&&!/<current_time>/i.test(v)){
          sheet('<div class="hd"><span>时间标签被删了</span></div><div class="opt"><p class="tk-cfp">这条消息的时间会不准，还保存吗？</p></div><div class="tk-dl"><button class="nw tap ghost">算了</button><button class="nw tap red">保存</button></div>','opts',function(box,close){
            box.addEventListener('click',function(e3){ var b3=e3.target.closest('.nw'); if(!b3) return; close(); if(!b3.classList.contains('ghost')) save(); }); });
          return; }
        save(); });
      return; }
    if(k==='album'){ var au=g.url||''; if(!/\/uploads\/img-/.test(au)){ toast('这张图不能加入相册'); return; }
      P.net.post('/v1/album/add',{url:au,session_id:LIVE.sid,msg_id:m&&m.id,source:'chat'}).then(function(r){ toast(r&&r.existed?'已经在相册里了':'加进相册了'); buzz(8); },function(){ toast('没加进去，稍后再试'); }); return; }
    if(k==='del'){
      /* [位置:phone-talk.js·liveAct 删] [没落库的消息在本地删] [11-14：_vp 语音条和「没发出去」那行从来没进过后端，走 delConfirm→timeline/sync 删不掉；这两种直接本地移除（语音连队列一起清）] [注释时间 2026-11-14] */
      if(m&&m._vp){ vDrop(m); return; }
      if(m&&m._fail){ failDrop(m.id); return; }
      delConfirm(m); return; }
    if(k==='star'){ var want=!isStar(m); starPost(m,want).then(function(){ toast(want?'★ 标好了，压缩时不会被吞掉':'取消标星了'); buzz(8); rebuild(); },function(e){ toast((want?'没标上':'没取消掉')+(e&&e.message?'：'+String(e.message).slice(0,30):'')); }); return; }
    if(k==='tts'){ var t2=(g.x||stripTags(stripCT(mText(m)))).replace(/<[^>]+>/g,'').trim(); if(!t2){ toast('没有能读的字'); return; } toast('朗读中…');
      P.net.post('/heartbeat/admin/tts',{text:t2}).then(function(r){ if(!r||!r.audio) throw new Error(''); try{ if(AU) AU.pause(); }catch(e){} AU=new Audio('data:audio/'+(r.format||'mp3')+';base64,'+r.audio); return AU.play(); }).catch(function(){ toast('没读出来'); }); return; }
    if(k==='multi'){ multiOn(m); return; }
    if(k==='regen'){ regenFrom(m); return; }
    if(k==='branch'){
      /* [位置:phone-talk.js·liveAct branch] [开启分支先确认] [10-23 需求 41：和重新生成一样，点了先问一句，免得误触就多出一个会话] [注释时间 2026-10-23] */
      sheet('<div class="hd"><span>从这里开启新分支？</span></div><div class="opt"><p class="tk-cfp">会新开一个会话，带上到这条为止的对话，原来的会话不变。</p></div><div class="tk-dl"><button class="nw tap ghost">算了</button><button class="nw tap">开启分支</button></div>','opts',function(box,close){
        box.addEventListener('click',function(e){ var b=e.target.closest('.nw'); if(!b) return; close(); if(!b.classList.contains('ghost')) branchFrom(m); }); });
      return; }
    toast('还没接'); }
  /* [位置:phone-talk.js·branchFrom] [开分支] [从某一条消息处另开一个新会话：前面的内容原样带过去，之后两边各聊各的，原会话不动] [注释时间 2026-10-21]
     流程同 chat.html 的 branchFromMsg：①前端生成新会话 id（s_时间戳_随机，同新建会话；撞号概率可忽略，后端 branch-inherit 不校验存在性，覆盖风险由此兜底）
     ②POST /v1/sessions/branch-inherit {srcSession,newSession,branchIndex,anchorId}：服务端复制时间线到锚点、继承状态机与注入块（anchorId 优先，branchIndex 仅作兜底）
     ③继承人设（session-prompts）与模型（model-provider）④名字「分支 · 前12字」⑤切到新会话。AI 回复为锚点也可以。 2026-10-27 改：名字那条 PUT 改增量 {set}——裸键值旧格式服务端 9-26 起不认但照样回成功，分支名一直静默没存上。 */
  function branchFrom(m){
    if(LIVE.busy){ toast('他还在回，等这一条结束'); return; }
    if(!m||!m.id){ toast('这条还没落盘，稍后再试'); return; }
    var src=LIVE.sid, sid='s_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8), k=LIVE.raw.indexOf(m);
    var seg=(m.role==='user'?stripCT(mText(m)):stripTags(stripCT(mText(m)))).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,12), name='分支 · '+(seg||'从该消息');
    toast('开分支中…');
    /* 全量下标：已加载的窗口只是尾部，branchIndex 只在 anchorId 查不到时兜底，给「older 之前不可知」的保守值 0 即可 */
    P.net.post('/v1/sessions/branch-inherit',{srcSession:src,newSession:sid,branchIndex:Math.max(0,k),anchorId:m.id},{headers:XC}).then(function(r){
      if(r&&r.error) throw new Error(r.error);
      var jobs=[P.net.req('/heartbeat/admin/session-names',{method:'PUT',body:{set:(function(){ var o={}; o[sid]=name; return o; })()}}).catch(function(){})];
      /* 继承人设 + 模型：父会话跟随全局就不复制，新会话同样跟随全局 */
      jobs.push(P.net.get('/heartbeat/admin/session-prompts',{noLogin:true}).then(function(x){ var v=x&&x.prompts&&x.prompts[src]; if(!v) return; var st={}; st[sid]=v; return P.net.req('/heartbeat/admin/session-prompts',{method:'PUT',body:{set:st,unset:[]}}); }).catch(function(){}));
      jobs.push(P.net.get('/v1/sessions/'+encodeURIComponent(src)+'/model-provider',{noLogin:true}).then(function(x){ if(x&&x.follow_global===false&&x.model_name) return P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',{model_provider_id:x.model_provider_id||null,model_name:x.model_name}); }).catch(function(){}));
      return Promise.all(jobs);
    }).then(function(){ toast('分支开好了'); buzz([8,30,8]); if(P.chats&&P.chats.switchTo) P.chats.switchTo(sid,name); },
      function(e){ toast('没开成：'+failWhy(e)); buzz([20,30,20]); });
  }
  /* [位置:phone-talk.js·regenEdit] [编辑用户消息后重新生成] [11-10：改完自己的话，他按新话重答；一次请求里完成——后端把旧内容 + 旧回复整段存成一个版本，再把这条换成新内容，再生成；本地同步先把这条改成新内容、截掉后面的，请求体里的 user 消息就是新内容；压缩区间内后端拒绝，liveGen 的失败分支会按后端实际拉回来] [注释时间 2026-11-10] */
  /* [位置:phone-talk.js·liveOf] [按 id 找回当前的消息对象] [11-10 验证时发现：回复收完 1.5 秒后 reload 会把 LIVE.raw 换成一批新对象，内容没变就不重画，页面（REF）里还拿着旧对象；这时对刚生成的那条点「重新生成」，用 LIVE.raw.indexOf(旧对象) 找不到，报「前面没有可以参考的消息」。重新生成 / 编辑后重新生成进来先过一遍，旧对象就按 id 换成 LIVE.raw 里的] [注释时间 2026-11-10] */
  function liveOf(m){ if(!m||!m.id||LIVE.raw.indexOf(m)>=0) return m; for(var i=LIVE.raw.length-1;i>=0;i--){ if(LIVE.raw[i]&&LIVE.raw[i].id===m.id) return LIVE.raw[i]; } return m; }
  function regenEdit(m,nc){
    m=liveOf(m);
    if(LIVE.busy){ toast('他还在回，等这一条结束'); return false; }
    if(!m||!m.id){ toast('这条还没落盘，稍后再试'); return false; }
    var k=LIVE.raw.indexOf(m); if(k<0){ toast('这条找不到了，刷新一下再试'); return false; }
    if(LOC){ LOC=null; }
    m.content=nc; m.stream_timeline=null; m._sk=null;
    LIVE.raw=LIVE.raw.slice(0,k+1); LIVE.older=(LIVE.older||[]).filter(function(x){ return LIVE.raw.indexOf(x)>=0; });
    liveGen(m,m.id,{version:1,edit:nc}); return true; }
  /* [位置:phone-talk.js·regenFrom] [重新生成] [不满意这条回复，从她的那句话重新要一次；旧回复留成上一个版本（‹ 2/3 › 切换，11-10 改）] [注释时间 2026-11-10 改]
     user 消息：以它本身为锚点；AI 消息：往上找对应的那条 user 消息。服务端按锚点 id 把锚点之后的「全部」内容删掉（含别的设备刚发的），所以先弹确认说清。
     锚点在已压缩区间内服务端会 400「先停用该压缩块再试」，原话提示。 */
  function regenFrom(m){
    m=liveOf(m);
    if(LIVE.busy){ toast('他还在回，等这一条结束'); return; }
    var k=LIVE.raw.indexOf(m), ui=-1;
    if(m.role==='user') ui=k; else { for(var i=k-1;i>=0;i--){ if(LIVE.raw[i]&&LIVE.raw[i].role==='user'){ ui=i; break; } } }
    if(ui<0){ toast('前面没有可以参考的消息'); return; }
    var um=LIVE.raw[ui]; if(!um||!um.id){ toast('这条还没落盘，稍后再试'); return; }
    sheet('<div class="hd"><span>重新生成这条？</span></div><div class="opt"><p class="tk-cfp">会从这里重新来一遍，原来的回复留成上一个版本，用 ‹ › 可以切回来。</p></div><div class="tk-dl"><button class="nw tap ghost">算了</button><button class="nw tap red">重新生成</button></div>','opts',function(box,close){
      box.addEventListener('click',function(e){ var b=e.target.closest('.nw'); if(!b) return; close(); if(b.classList.contains('ghost')) return;
        if(LOC){ LOC=null; }
        LIVE.raw=LIVE.raw.slice(0,ui+1); LIVE.older=(LIVE.older||[]).filter(function(x){ return LIVE.raw.indexOf(x)>=0; }); liveGen(um,um.id,{version:1}); });
    });
  }

  /* ---------- 多选：点气泡选 / 取消；底下一条「已选 N 条 · 删除」，一次批量删（timeline/sync 多条 delete） ---------- */
  var MS=null;
  function dropLocal(ids){ var d={}; ids.forEach(function(i){ d[i]=1; }); LIVE.older=(LIVE.older||[]).filter(function(m){ return !d[m.id]; }); LIVE.raw=LIVE.raw.filter(function(m){ return !d[m.id]; }); }
  function msIds(){ return Object.keys(MS||{}); }
  function msMsgs(){ var have={}; msIds().forEach(function(i){ have[i]=1; }); return LIVE.raw.filter(function(m){ return have[m.id]; }); }
  function plain(m){ var x=(m.role==='user'?stripCT(mText(m)):stripTags(stripCT(mText(m)))).replace(/<\s*sticker\b[^>]*>/gi,'[表情包]').replace(/<card\b[^>]*>[\s\S]*?<\/card>/gi,'[卡片]').replace(/<file\b[^>]*>[\s\S]*?<\/file\s*>/gi,'[文件]').replace(/<\/?voice>/gi,''); return crv(x).trim(); }
  function msExport(){ var ms=msMsgs(); if(!ms.length){ toast('还没选'); return; } var nm=(CTX0&&CTX0.name)||LIVE.sid, out=[nm];
    ms.forEach(function(m){ var d=new Date(m.time||Date.now()); out.push('---',d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())+' '+p2(d.getHours())+':'+p2(d.getMinutes())+' · '+(m.role==='user'?'user':'assistant'),plain(m)); });
    var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([out.join('\n')+'\n'],{type:'text/plain;charset=utf-8'})); a.download=nm+'-选中'+ms.length+'条.txt'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },1500); toast('导出了 '+ms.length+' 条'); }
  function msStar(){ var ms=msMsgs().filter(function(m){ return !isStar(m)&&mText(m).trim(); }), ok=0, bad=0, skip=msIds().length-ms.length; if(!ms.length){ toast(skip?'选的都标过了':'还没选'); return; } toast('标星中…');
    ms.reduce(function(pr,m){ return pr.then(function(){ return starPost(m,true).then(function(){ ok++; },function(){ bad++; }); }); },Promise.resolve()).then(function(){ toast('标了 '+ok+' 条'+(skip?'，'+skip+' 条本来就标过':'')+(bad?'，'+bad+' 条没标上':'')); buzz(8); if(!bad) multiOff(); rebuild(); }); }
  function msDel(){ var ids=msIds(); if(!ids.length){ toast('还没选'); return; }
    sheet('<div class="hd"><span>删掉这 '+ids.length+' 条？</span></div><div class="tk-dl"><button class="nw tap ghost" data-no>算了</button><button class="nw tap red" data-ok>删除</button></div>','opts',function(box,close){ box.querySelector('[data-no]').addEventListener('click',function(){ close(); buzz(6); }); box.querySelector('[data-ok]').addEventListener('click',function(){ sync(ids.map(function(id){ return {op:'delete',id:id}; })).then(function(r){ close(); multiOff(); dropLocal(ids); toast('删掉了 '+((r&&r.deleted)||ids.length)+' 条'+(r&&r.missed?'（'+r.missed+' 条后端已经没有了）':'')); rebuild(); reload(); },function(e2){ toast(String(e2.message||'没删掉').slice(0,40)); buzz([20,30,20]); }); }); }); }
  function multiOn(first){ MS={}; if(first&&first.id) MS[first.id]=1; host.classList.add('msel');
    var tb=document.createElement('div'); tb.className='tk-mstop'; tb.innerHTML='<button class="tap" data-x>取消</button><b></b><button class="tap" data-all>全选</button>'; host.appendChild(tb);
    var bar=document.createElement('div'); bar.className='tk-msbar'; bar.innerHTML='<button class="tap" data-exp>导出</button><button class="tap" data-star>标星</button><button class="tap red" data-del>删除</button>'; host.appendChild(bar);
    function on(e){ var t=e.target;
      if(t.closest('[data-x]')){ multiOff(); return; }
      if(t.closest('[data-all]')){ var all=LIVE.raw.filter(function(m){ return m.id&&REF.some(function(g){ return g&&g.raw===m; }); }), full=all.every(function(m){ return MS[m.id]; }); MS={}; if(!full) all.forEach(function(m){ MS[m.id]=1; }); buzz(6); msPaint(); return; }
      if(t.closest('[data-exp]')) msExport(); else if(t.closest('[data-star]')) msStar(); else if(t.closest('[data-del]')) msDel(); }
    tb.addEventListener('click',on); bar.addEventListener('click',on);
    requestAnimationFrame(function(){ host.classList.add('msel-in'); msPaint(); setTimeout(msPaint,320); }); buzz(8); }
  function multiOff(){ MS=null; msUnbox(); host.classList.remove('msel','msel-in'); ['.tk-msbar','.tk-mstop'].forEach(function(q){ var x=host.querySelector(q); if(x) x.remove(); }); Array.prototype.forEach.call(list.querySelectorAll('.msel-on'),function(x){ x.classList.remove('msel-on'); }); }
  /* [位置:phone-talk.js·msBox/msUnbox] [极简多选：整条 AI 消息框起来] [极简里一条 AI 消息是好几个单元（思考行、正文、工具行…），原来每个单元各自一个勾、各自一块底色，看起来碎；现在多选时把同一条消息的单元包进一个 .mn-selbox，整条只有一个勾圈（左边）和一个框（选中=主色边框+淡底），点框里任何地方都是选这一整条；包的时候用 padding + 负 margin 抵消，版面不动；退出多选就拆掉；我的气泡本来就是单个，不用包] [注释时间 2026-10-22] */
  function msUid(el){ var r=el.getAttribute&&el.getAttribute('data-r'); if(r==null) return ''; var g=REF[+r]; return (g&&g.raw&&g.raw.id)||''; }
  function msBox(){ if(!MIN) return;
    Array.prototype.forEach.call(list.querySelectorAll('.tk-g.ai .col'),function(col){ var kids=Array.prototype.slice.call(col.children), i=0;
      while(i<kids.length){ var id=msUid(kids[i]); if(!id){ i++; continue; }
        var j=i; while(j+1<kids.length&&!kids[j+1].classList.contains('mn-selbox')){ var nid=msUid(kids[j+1]); if(nid&&nid!==id) break; j++; }
        while(j>i&&!msUid(kids[j])) j--;
        var bx=document.createElement('div'); bx.className='mn-selbox'; col.insertBefore(bx,kids[i]); for(var k=i;k<=j;k++) bx.appendChild(kids[k]); i=j+1; } });
    var lr=list.getBoundingClientRect().left;
    Array.prototype.forEach.call(list.querySelectorAll('.mn-selbox'),function(bx){ var u=bx.querySelector('[data-r]'), id=u?msUid(u):''; bx.classList.toggle('on',!!(id&&MS&&MS[id]));
      bx.style.setProperty('--ckx',Math.round(lr+16-bx.getBoundingClientRect().left)+'px'); }); }
  function msUnbox(){ Array.prototype.forEach.call(list.querySelectorAll('.mn-selbox'),function(bx){ var p=bx.parentNode; while(bx.firstChild) p.insertBefore(bx.firstChild,bx); p.removeChild(bx); }); }
  function msPaint(){ if(!MS) return; msBox(); var lr=list.getBoundingClientRect().left;
    Array.prototype.forEach.call(list.querySelectorAll('[data-r]'),function(el){ var g=REF[+el.getAttribute('data-r')], on=!!(g&&g.raw&&g.raw.id&&MS[g.raw.id]); el.classList.toggle('msel-on',on);
      if(MIN||el.classList.contains('m0')||!el.classList.contains('b')) el.style.setProperty('--ckx',Math.round(lr+10-el.getBoundingClientRect().left)+'px'); });
    var n=msIds().length, bb=host.querySelector('.tk-mstop b'); if(bb) bb.textContent=n?'已选 '+n+' 条':'点消息来选'; }
  list.addEventListener('click',function(e){ if(!MS) return; var el=e.target.closest('[data-r]'); if(!el){ var bx=e.target.closest('.mn-selbox'); el=bx&&bx.querySelector('[data-r]'); } if(!el) return; e.stopPropagation(); e.preventDefault(); var g=REF[+el.getAttribute('data-r')]; if(!g||!g.raw||!g.raw.id) return; if(MS[g.raw.id]) delete MS[g.raw.id]; else MS[g.raw.id]=1; buzz(5); msPaint(); },true);

  /* ---------- 头像菜单（真会话）：人设走 session-prompts，模型走 /v1/sessions/:id/model-provider ---------- */
    /* [位置:phone-talk.js·头像菜单聊天主题] [本会话的聊天主题在头像菜单里切] [10-28：原来只能去设置页改全局「聊天样式」；这里改本会话（POST /v1/sessions/chat-style 存会话配置，空＝跟随默认），改完把本会话聊天页重开一遍让新主题生效；子会话固定极简不显示这一行；以后抄来的主题往 phone-set.js 的 P.chatStyle.LIST 和这个下拉里各加一项] [注释时间 2026-10-28] */
  /* [位置:phone-talk.js·liveEl] [头像菜单·距上一轮给AI] [10-29 #49：[elapsed:45s] 标签独立于时间缀（时间缀她已关掉），会话级三态存 /v1/sessions/:id/elapsed-tag，全局默认开，关了直接不加] [注释时间 2026-10-29] */
  /* [位置:phone-talk.js·swRow] [头像菜单开关行] [11-04：下拉框不好看，除设定/模型/Claude 思考/聊天主题外全改开关。row=.ro.tg 行；send(nv) 返回 Promise 存后端，失败不翻转；返回 {set(v)} 供异步取到真实状态后设置] [注释时间 2026-11-04] */
  function swRow(row,on,send,msg){ var cur=!!on, busy=false; row.classList.toggle('on',cur);
    row.addEventListener('click',function(){ if(busy) return; busy=true; var nv=!cur;
      send(nv).then(function(){ cur=nv; row.classList.toggle('on',cur); busy=false; toast(msg(nv)); },function(){ busy=false; toast('没存上'); }); });
    return { set:function(v){ cur=!!v; row.classList.toggle('on',cur); } }; }
  function liveEl(box,sid){ var el=box.querySelector('#tkEl'); if(!el) return;
    P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/elapsed-tag',{noLogin:true}).then(function(x){
      var g=!x||x.global!==false, sw=swRow(el,!x||x.effective!==false,function(nv){ return P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/elapsed-tag',{elapsed_tag_to_ai:nv===g?null:nv}); },function(nv){ return '距上一轮给AI：'+(nv?'开':'关'); });
    },function(){}); }
  /* [位置:phone-talk.js·liveTr] [头像菜单·Trace 剥离开关] [11-21：开=发给 AI 前剥掉历史 assistant 消息里的 <trace>（仅前端显示）；关=发给 AI（默认）。切换自动清快照下轮重建] [注释时间 2026-11-21] */
  function liveTr(box,sid){ var tr=box.querySelector('#tkTr'); if(!tr) return;
    var sw=swRow(tr,false,function(nv){ return P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/strip-trace',{strip_trace:nv}); },function(nv){ return nv?'Trace 剥离：开（不发给AI，快照下轮重建）':'Trace 剥离：关（发给AI，快照下轮重建）'; });
    P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/strip-trace',{noLogin:true}).then(function(x){ sw.set(!!(x&&x.strip_trace)); },function(){}); }
  function liveTheme(box,sid){ var th=box.querySelector('#tkTh'); if(!th) return;
    th.value=(P.sessPref&&P.sessPref.styleOf(sid))||''; var prev=th.value;
    th.addEventListener('change',function(){ var v=th.value;
      P.net.post('/v1/sessions/chat-style',{session_id:sid,style:v}).then(function(){
        if(P.sessPref){ var m=P.sessPref.remote, cur=m[sid]||{av:'',style:''}; if(cur.av||v) m[sid]={av:cur.av,style:v}; else delete m[sid]; P.sessPref.setStyle(sid,v); }
        prev=v; toast(v===''?'聊天主题：跟随默认':'聊天主题：'+(v==='min'?'极简':'气泡'));
        setTimeout(function(){ if(P.chats&&P.chats.switchTo) P.chats.switchTo(sid); },250);
      },function(){ th.value=prev; toast('没切成'); }); }); }
  /* [位置:phone-talk.js·savWire] [头像菜单·会话头像] [10-29：会话头像原来只能靠预设带或一次性上云，菜单里换不了；现在这行能用——相册/拍照压缩上传 → POST /v1/sessions/session-avatar 存会话配置 → setRemoteOne + --av-sess 当场生效；摘掉=清空、跟随全局。[压缩上传照 presetEdit 的 pickAv 同款参数（512 jpeg .88）。2026-11-24：没设会话头像时清空行内底图继承全局头像，hasimg 按有没有图同步；摘掉时连本机映射一起清] [注释时间 2026-10-29；2026-11-24 改] */
  function savWire(box,sid){
    var av=box.querySelector('#tkSav'), bt=box.querySelector('#tkSavB'); if(!bt) return;
    function cur(){ return (P.sessPref&&P.sessPref.avOf(sid))||''; }
    function paint(){ var v=cur();
      if(av){
        /* [位置:phone-talk.js·savWire·paint] [头像菜单这一行的圆圈] [11-24 报「头像菜单只显示带谢字的空圈」：没设会话头像时原来写死 backgroundImage='none'，把 CSS 回退链（会话级 --av-sess → 我们页覆盖 → 全局 --av-ai）整个盖掉。现在没设就清空行内值让它继承；hasimg 看「有没有图」而不是「有没有设过」——自己设的、会话带的、全局的任一有图就藏字母] [注释时间 2026-11-24] */
        av.style.backgroundImage=(v&&P.sessPref&&P.sessPref.avBg)?P.sessPref.avBg(v):'';
        av.classList.toggle('hasimg',!!v||/url\(/i.test(getComputedStyle(av).backgroundImage)); }
      bt.textContent=v?'换一张':'选一张'; }
    paint();
    function pick(mode){ var f=document.createElement('input'); f.type='file'; f.accept='image/*'; if(mode==='cam') f.setAttribute('capture','user');
      f.onchange=function(){ var fl=f.files&&f.files[0]; if(!fl){ toast('没拿到图，再试一次'); return; }
        toast('头像处理中…');
        var rd=new FileReader();
        rd.onerror=function(){ toast('这张图读不出来，换一张试试'); buzz([20,30,20]); };
        rd.onload=function(){ var im=new Image();
          im.onerror=function(){ toast('这张图解不开，换一张试试'); buzz([20,30,20]); };
          im.onload=function(){ try{
              var k=Math.min(1,512/Math.max(im.width,im.height)), c=document.createElement('canvas');
              c.width=Math.round(im.width*k); c.height=Math.round(im.height*k);
              c.getContext('2d').drawImage(im,0,0,c.width,c.height);
              toast('头像上传中…');
              P.net.post('/v1/upload-image',{data:c.toDataURL('image/jpeg',.88)}).then(function(r2){ if(!r2||!r2.url) throw new Error('后台没回图地址');
                var u=String(r2.url).replace(/^https?:\/\/[^/]+/,'');
                P.net.post('/v1/sessions/session-avatar',{session_id:sid,avatar:u}).then(function(){
                  if(P.sessPref) P.sessPref.setRemoteOne(sid,{av:u,style:(P.sessPref.styleOf&&P.sessPref.styleOf(sid))||''});
                  try{ host.style.setProperty('--av-sess',P.sessPref.avRaw(u)); host.classList.add('tk-av-sess'); }catch(e){}
                  P.markAv&&P.markAv(); paint(); buzz([8,30,8]); toast('会话头像换好了');
                },function(){ toast('没存上，稍后再试'); });
              },function(e2){ toast('没传上：'+String(e2&&e2.message||'').replace(/^HTTP \d+\s*/,'').slice(0,40)); buzz([20,30,20]); });
            }catch(e3){ toast('图处理失败：'+String(e3&&e3.message||'').slice(0,30)); buzz([20,30,20]); } };
          im.src=rd.result; };
        rd.readAsDataURL(fl); };
      f.click(); }
    function clear_(){ P.net.post('/v1/sessions/session-avatar',{session_id:sid,avatar:''}).then(function(){
        if(P.sessPref) P.sessPref.setRemoteOne(sid,{av:'',style:(P.sessPref.styleOf&&P.sessPref.styleOf(sid))||''});
        if(P.sessPref) P.sessPref.setAv(sid,'');   /* 2026-11-24：本机映射里的也一起摘（预设图标头像走本机兜底，不摘的话摘不掉） */
        try{ host.style.removeProperty('--av-sess'); host.classList.remove('tk-av-sess'); }catch(e){}
        P.markAv&&P.markAv(); paint(); buzz(8); toast('摘掉了，跟随全局');
      },function(){ toast('没摘掉'); }); }
    bt.addEventListener('click',function(){ buzz(6);
      sheet('<div class="hd"><span>会话头像</span></div><div class="opt"><div class="pg-g"><div class="ro tap" data-av="lib"><label>从相册选</label></div><div class="ro tap" data-av="cam"><label>拍一张</label></div>'+(cur()?'<div class="ro tap" data-av="clr"><label>摘掉（跟随全局）</label></div>':'')+'</div></div>','opts',function(b2,close){
        b2.addEventListener('click',function(e){ var t=e.target.closest('[data-av]'); if(!t) return; close();
          var a=t.getAttribute('data-av'); if(a==='clr') clear_(); else pick(a); }); }); });
  }
  function liveAv(box){ var sid=LIVE.sid, ps=box.querySelector('#tkPs'), md=box.querySelector('#tkMd'), tt=box.querySelector('#tkTt'), ct=box.querySelector('#tkCt'), ctRow=box.querySelector('#tkCtRow'), cc=box.querySelector('#tkCc'), ccRow=box.querySelector('#tkCcRow'), gr=box.querySelector('#tkGr'), grRow=box.querySelector('#tkGrRow'), gk=box.querySelector('#tkGk'), gkRow=box.querySelector('#tkGkRow'), ctPrev='off', ccLoad=false, ccSw=null, grLoad=false, grSw=null, gkPrev='off', gkLoad=false; liveTheme(box,sid); savWire(box,sid); liveEl(box,sid); liveTr(box,sid);
    /* [位置:phone-talk.js·liveAv Claude思考开关] [按实际模型显隐] [model-provider 返回 effective_is_claude（含跟随默认时的真实解析），是 Claude 才显示；换模型成功后重取一次，非 Claude 立刻整行隐藏] [注释时间 2026-10-28] */
    /* [位置:phone-talk.js·liveAv Claude缓存] [加强缓存 = 缓存断点改 1 小时（默认 5 分钟）] [11-04：跟「Claude 思考」同条件显示（实际模型是 Claude）；会话级，存会话配置，网关发请求时按它决定 ttl] [注释时间 2026-11-04] */
    function applyCc(mp){ if(!cc||!ccRow) return; var isC=!!(mp&&mp.effective_is_claude); ccRow.style.display=isC?'':'none';
      var gp=box.querySelector('#tkGrp'); if(gp) gp.classList.toggle('cl',isC);
      if(isC&&!ccLoad){ ccLoad=true; P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/claude-cache',{noLogin:true}).then(function(r){ if(ccSw) ccSw.set(!!(r&&r.long)); },function(){ ccLoad=false; }); } }
    function applyCt(mp,ctc){ if(!ct||!ctRow) return;
      applyCc(mp); applyGr(mp); applyGk(mp);
      ctRow.style.display=mp&&mp.effective_is_claude?'':'none';
      ct.value=(ctc&&ctc.effort)||'off'; ctPrev=ct.value; }
    /* [位置:phone-talk.js·liveAv GLM历史思考开关] [按实际模型显隐] [11-15：model-provider 返回 effective_is_glm（含跟随默认时的真实解析），实际模型是智谱 GLM 才显示（经 applyCt 调用，初始化/换模型/失配校正三处都覆盖）；开=回传历史思考（默认），关=出口剥离省 token；显隐同时切换分组卡片 glm 样式，首次显示时拉会话配置校正开关] [注释时间 2026-11-15] */
    function applyGr(mp){ if(!gr||!grRow) return; var isG=!!(mp&&mp.effective_is_glm); grRow.style.display=isG?'':'none';
      var gp=box.querySelector('#tkGrp'); if(gp) gp.classList.toggle('glm',isG);
      if(isG&&!grLoad){ grLoad=true; P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/glm-thinking',{noLogin:true}).then(function(r){ if(grSw) grSw.set(!(r&&r.send_hist_reasoning===false)); },function(){ grLoad=false; }); } }
    /* [位置:phone-talk.js·liveAv Grok思考档位] [按实际模型显隐、极高按模型版本] [11-16：model-provider 返回 effective_is_grok（实际供应商是 Grok 订阅）与 effective_grok_xhigh（实际模型 4.6 及以上）；只有实际模型是 grok-4.x 才显示这行（grok-build 之类不是思考模型），「极高」只在 4.6+ 出现；首次显示时拉会话配置校正，切换模型后重取一次，非 Grok 立刻整行隐藏] [注释时间 2026-11-16] */
    function applyGk(mp){ if(!gk||!gkRow) return;
      var m=String(mp&&mp.effective_model||''), isG=!!(mp&&mp.effective_is_grok)&&/^grok-4\./.test(m), canX=!!(mp&&mp.effective_grok_xhigh);
      gkRow.style.display=isG?'':'none';
      var xo=gk.querySelector('option[value="xhigh"]'); if(xo){ xo.hidden=!canX; xo.disabled=!canX; }
      if(!canX&&gk.value==='xhigh'){ gk.value='high'; gkPrev='high'; }
      var gp=box.querySelector('#tkGrp'); if(gp) gp.classList.toggle('gk',isG);
      if(isG&&!gkLoad){ gkLoad=true; P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/grok-thinking',{noLogin:true}).then(function(r){ var v=(r&&r.effort)||'off'; if(!canX&&v==='xhigh') v='high'; gk.value=v; gkPrev=v; },function(){ gkLoad=false; }); } }
    function fetchCt(){ if(!ct||!ctRow) return;
      Promise.all([P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',{noLogin:true}).catch(function(){ return {}; }),P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/claude-thinking',{noLogin:true}).catch(function(){ return {}; })]).then(function(y){ applyCt(y[0]||{},y[1]||{}); }); }
    /* [位置:phone-talk.js·liveAv 预填] [头像菜单一打开，设定/模型下拉就是完整的] [11-05：原来要等两个接口 2274ms 才从 1 项变多项；现在先用上次存下的清单同步填满（选中值先留空＝跟随默认，接口回来再补），面板打开不等网络] [注释时间 2026-11-05] */
    (function(){ var c0=P.sessOpts&&P.sessOpts.now?P.sessOpts.now():null; if(c0&&P.sessFill){ P.sessFill(ps,c0.pers,null); P.sessFill(md,c0.models,null); } })();
    Promise.all([P.sessOpts?P.sessOpts(true):Promise.resolve({pers:[],models:[]}),P.net.get('/heartbeat/admin/session-prompts',{noLogin:true}).catch(function(){ return {}; }),P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',{noLogin:true}).catch(function(){ return {}; }),tt?P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/time-tag-to-ai',{noLogin:true}).catch(function(){ return {}; }):Promise.resolve({}),ct?P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/claude-thinking',{noLogin:true}).catch(function(){ return {}; }):Promise.resolve({})]).then(function(x){
      var o=x[0], sp=(x[1]&&x[1].prompts)||{}, mp=x[2]||{}, ttc=x[3]||{}, ctc=x[4]||{};
      if(P.sessFill){ P.sessFill(ps,o.pers,sp[sid]||''); P.sessFill(md,o.models,mp.follow_global||!mp.model_provider_id?'':mp.model_provider_id+'|'+(mp.model_name||'')); }
      /* [位置:phone-talk.js·liveAv 模型失配校正] [存过的模型不在了：改成真的跟随默认] [11-05：供应商还在、但存的模型已下架或改名时，后端会悄悄改用该供应商的默认模型，界面却显示「跟随默认」——看着跟了其实没跟。这里当场把会话的模型设置清成跟随默认（POST model-provider 空体），并说一句「原来的模型不在了，已改回跟随默认」。供应商整家停用/删掉的不清：后端本来就回退全局默认并会提示，供应商恢复后她的选择自动回来] [注释时间 2026-11-05] */
      (function(){
        var pid=mp.model_provider_id||'', mname=mp.model_name||'';
        if(!pid||!mname) return;
        var flat=(P.sessOpts&&P.sessOpts.flat?P.sessOpts.flat(o.models):[]).map(function(x){ return x[0]; });
        var hasProv=flat.some(function(v){ return v.indexOf(pid+'|')===0; });
        if(!hasProv||flat.indexOf(pid+'|'+mname)>=0) return;
        P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',{model_provider_id:null,model_name:null}).then(function(){
          P.sessFill(md,o.models,''); mdPrev=''; fetchCt();
          toast('原来的模型不在了，已改回跟随默认'); buzz([10,40,10]);
        },function(){});
      })();
      /* 后台静默校正：清单签名（模型名单，不只条数）跟缓存那份不一样才就地补，不改已选中 */
      if(P.sessOpts&&P.sessOpts.refresh) P.sessOpts.refresh().then(function(o2){ if(!box.isConnected||!P.sessFill||!o2) return;
        var sig=P.sessOpts.sig||function(g){ return (g||[]).length; };
        if((o2.pers||[]).length!==(o.pers||[]).length||sig(o2.models)!==sig(o.models)){ P.sessFill(ps,o2.pers,null); P.sessFill(md,o2.models,null); } },function(){});
      applyCt(mp,ctc);
      if(ccRow&&cc){ ccSw=swRow(ccRow,false,function(nv){ return P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/claude-cache',{long:nv}); },function(nv){ return nv?'Claude 缓存：加强 1 小时（下一条消息起生效）':'Claude 缓存：默认 5 分钟'; }); if(mp&&mp.effective_is_claude&&!ccLoad){ ccLoad=true; P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/claude-cache',{noLogin:true}).then(function(r){ ccSw.set(!!(r&&r.long)); },function(){ ccLoad=false; }); } }
      /* [位置:phone-talk.js·liveAv GLM历史思考绑定] [开关读写] [11-15：初始按默认开显示（未设置=回传），接口回来校正；POST send_hist_reasoning 失败不翻转（swRow 内置）] [注释时间 2026-11-15] */
      if(grRow&&gr){ grSw=swRow(grRow,true,function(nv){ return P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/glm-thinking',{send_hist_reasoning:nv}); },function(nv){ return nv?'GLM 历史思考：开（回传）':'GLM 历史思考：关（不回传）'; }); if(mp&&mp.effective_is_glm&&!grLoad){ grLoad=true; P.net.req('/v1/sessions/'+encodeURIComponent(sid)+'/glm-thinking',{noLogin:true}).then(function(r){ grSw.set(!(r&&r.send_hist_reasoning===false)); },function(){ grLoad=false; }); } }
      if(ct){ ct.addEventListener('change',function(){ var v=ct.value;
        P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/claude-thinking',{effort:v}).then(function(){ ctPrev=v; toast('Claude 思考：'+({off:'默认',low:'低',medium:'中',high:'高'})[v]); },function(){ ct.value=ctPrev; toast('没存上'); }); }); }
      /* [位置:phone-talk.js·liveAv Grok思考绑定] [档位读写] [11-16：初始按默认（off=不发参数）显示，接口回来校正；POST 失败不翻转（下拉退回上一档 + 提示）] [注释时间 2026-11-16] */
      if(gk){ gk.addEventListener('change',function(){ var v=gk.value;
        P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/grok-thinking',{effort:v}).then(function(){ gkPrev=v; toast('Grok 思考：'+({off:'默认',low:'低',medium:'中',high:'高',xhigh:'极高'})[v]); },function(){ gk.value=gkPrev; toast('没存上'); }); }); }
      /* 1025：时间缀给AI 三态开关；切「关」= 发消息时网关剥 <current_time>，快照自动重建 */
      /* 11-04：改成开关——显示实际生效值；切到与全局默认相同时存「跟随默认」(null)，否则存明确的开/关 */
      if(tt){ var ttG=ttc.global!==false; swRow(tt,ttc.effective!==false,function(nv){ return P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/time-tag-to-ai',{time_tag_to_ai:nv===ttG?null:nv}); },function(nv){ return '时间缀给AI：'+(nv?'开':'关')+'，快照下轮重建'; }); } });
    ps.addEventListener('change',function(){ var v=ps.value, st={}; if(v) st[sid]=v; P.net.req('/heartbeat/admin/session-prompts',{method:'PUT',body:v?{set:st,unset:[]}:{set:{},unset:[sid]}}).then(function(){ toast('设定换好了'); },function(){ toast('没换成'); }); });
    var mdPrev=md.value;
    /* [位置:phone-talk.js·头像菜单换模型] [换失败要说原因，并把下拉框退回原来的] [后台现在会拒绝用不了的供应商（没凭证 / 停用），错误体里有 error 原因；以前只弹「没换成」，下拉框却停在新选项上，像是换好了] [注释时间 2026-10-22] */
    function whyErr(e){ var m=String(e&&e.message||''), j=m.match(/\{[\s\S]*\}/); try{ return JSON.parse(j[0]).error||''; }catch(x){ return ''; } }
    md.addEventListener('change',function(){ var v=md.value, mm=v.split('|'); P.net.post('/v1/sessions/'+encodeURIComponent(sid)+'/model-provider',v?{model_provider_id:mm[0],model_name:mm.slice(1).join('|')}:{model_provider_id:null,model_name:null}).then(function(){ mdPrev=v; toast('模型换好了'); fetchCt(); },function(e){ md.value=mdPrev; var w=whyErr(e); toast('没换成'+(w?'：'+w:'')); buzz([20,30,20]); }); }); }

  /* ---------- 「…」跨窗口（真会话）：GET / POST /v1/sessions/:id/cross-inject；空会话不存（第一次存会触发「承接上一个会话」，只该在新建时发生） ---------- */
  function liveXw(ov){ P.net.req('/v1/sessions/'+encodeURIComponent(LIVE.sid)+'/cross-inject',{noLogin:true}).then(function(j){ var w=ov.querySelector('.xw'); if(!w||!X) return;
      var on=j.cross_inject_enabled!==false, bl=Array.isArray(j.inject_blocks)?j.inject_blocks:null; w.outerHTML=X.html({on:on,blocks:bl});
      var sb=ov.querySelector('.tk-acc[data-k="xw"] .tx small'); if(sb) sb.textContent=on?'开'+(bl?' · '+bl.length+' 块':' · 全部'):'关'; },function(){ var sb=ov.querySelector('.tk-acc[data-k="xw"] .tx small'); if(sb&&ov.isConnected) sb.textContent='状态没读到'; }); }
  var xwT=0;
  function xwSaveSoon(ov){ clearTimeout(xwT); xwT=setTimeout(function(){ if(!LIVE.raw.length){ toast('空会话先不存，发一条再改'); return; } var o=X.read(ov); if(!o) return;
    P.net.post('/v1/sessions/'+encodeURIComponent(LIVE.sid)+'/cross-inject',{enabled:o.on,inject_blocks:o.blocks}).then(function(){ toast('跨窗口存好了'); },function(){ toast('没存上'); }); },700); }

  /* ---------- 搜索定位 ----------
     [位置:phone-talk.js·talkSearch] [会话内搜索] [用户 随手记第25条：给会话内加一个搜索功能。在右上角的菜单里] [注释时间 2026-11-13 对齐截图经典弹窗]
     打开当前会话专属搜索弹窗，复用小手机经典 ses-pop 居中靠上卡片形态，多词检索、关键词高亮、点击定位到那条消息并闪烁高亮 */
  function talkSearch(){
    if(!LIVE.sid){ toast('当前会话不可搜'); return; }
    sheet('<div class="hd fd"><input class="fq" type="search" placeholder="搜当前会话说过的话" enterkeyhint="search" aria-label="搜当前会话说过的话"></div><div class="ls"></div>','srch',function(box,close){
      var inp=box.querySelector('.fq'), out=box.querySelector('.ls'), q='', res=[], tm=0, seq=0;
      function qTerms(){ var o=[]; q.toLowerCase().split(/[\s,，。；;：！!？?、"“”‘’（）()\[\]【】《》<>…]+/).forEach(function(x){ if(x&&o.indexOf(x)<0) o.push(x); }); return o.slice(0,8).sort(function(a,b){ return b.length-a.length; }); }
      function mark(t){ var s=esc(t), ks=qTerms().map(esc).filter(Boolean); if(!ks.length) return s; return s.replace(new RegExp(ks.map(function(k){ return k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }).join('|'),'gi'),function(m){ return '<mark>'+m+'</mark>'; }); }
      function snip(t){ t=String(t||'').replace(/\s+/g,' ').trim(); return t.length>90?t.slice(0,90)+'…':t; }
      function fmtTime(t){
        var d=new Date(t); if(isNaN(d.getTime())) return '';
        function p(n){ return ('0'+n).slice(-2); }
        return (d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
      }
      function paint(){
        if(!q){ out.innerHTML='<div class="lv-empty" style="padding:30px 0">输入一个词，在当前会话里找</div>'; return; }
        out.innerHTML=res.length?res.map(function(r,i){
          return '<button class="it fr tap" data-i="'+i+'"><div><b>'+mark(r.snippet!=null?r.snippet:snip(r.text))+'</b><small>'+(r.sidx!=null?'第 '+(r.sidx+1)+' 条':'')+(r.time?' · '+fmtTime(r.time):'')+'</small></div></button>';
        }).join(''):'<div class="lv-empty" style="padding:30px 0">当前会话没找到「'+esc(q)+'」</div>';
      }
      function go(){
        q=inp.value.trim(); res=[]; if(!q) return paint(); var my=++seq;
        out.innerHTML='<div class="lv-empty" style="padding:30px 0">翻一翻…</div>';
        var u='/v1/search?sid='+encodeURIComponent(LIVE.sid)+'&q='+encodeURIComponent(q)+'&limit=60&snip=1';
        P.net.req(u,{headers:XC,noLogin:true}).then(function(r){
          if(my!==seq) return; res=(r&&r.results)||[]; paint();
        },function(){
          if(my===seq) out.innerHTML='<div class="lv-empty" style="padding:30px 0">没搜成，稍后再试</div>';
        });
      }
      inp.addEventListener('input',function(){ clearTimeout(tm); tm=setTimeout(go,360); });
      /* [位置:phone-talk.js·talkSearch 回车] [会话内搜索按回车立即搜] [11-13：与全库搜索统一，回车即搜并收键盘] [注释时间 2026-11-13] */
      inp.addEventListener('keydown',function(e){ if(e.key!=='Enter') return; e.preventDefault(); clearTimeout(tm); go(); try{ inp.blur(); }catch(_){} });
      out.addEventListener('click',function(e){
        var b=e.target.closest('.fr'); if(!b) return;
        var r=res[+b.dataset.i]; if(!r) return;
        close();
        locateTo({sidx:r.sidx,q:q});
      });
      paint();
      setTimeout(function(){ try{ inp.focus(); }catch(_){} },260);
    });
  }

  /* ---------- 搜索定位 ----------
     [位置:phone-talk.js·locateTo] [定位到第 N 条] [从搜索点进来要落在命中的那条消息上并高亮，而不是只打开会话尾部] [注释时间 2026-10-21]
     做法：GET /v1/history（不带 mode，全量可见序列）取 items[sidx]，截一个以它为中心的窗口（前 30 条 + 后 40 条）放进 LIVE.raw，
     LIVE.more 照实设置，往上翻仍走 before 懒加载；渲染后滚到那条并闪一下。找不到（时间线被改过）就退回打开尾部并提示。 */
  var LOC=null;
  /* [位置:phone-talk.js·exitLoc] [退出定位回到最新] [定位窗口是中段切片，不能再被「拉尾部」拼接（会断档乱序）；点回到最新 / 发消息 / 滚到底都先退出再刷新] [注释时间 2026-10-21] */
  function exitLoc(){ if(!LOC) return Promise.resolve(); LOC=null; LIVE.older=[]; LIVE.raw=[]; LIVE.more=null; rbForce=true; return reload().then(function(){ rbForce=true; rebuild(); }); }
  function locateTo(loc){
    return P.net.req('/v1/history?session_id='+encodeURIComponent(LIVE.sid),{headers:XC,noLogin:true}).then(function(r){
      var all=(r&&r.items)||[], k=Math.min(Math.max(0,loc.sidx),Math.max(0,all.length-1)), hit=all[k];
      if(!hit||!all.length){ toast('没找到那条，先看最新的'); return reload(); }
      var from=Math.max(0,k-30), to=Math.min(all.length,k+41);
      LIVE.raw=all.slice(from,to); LIVE.older=all.slice(from,k); LIVE.more=from>0; LIVE.hitId=hit.id; LOC=loc;
      rbForce=false; rbAnchor=false; rebuild(); setTimeout(flashHit,60);
    },function(){ toast('没翻到那一条'); return reload(); });
  }
  /* [位置:phone-talk.js·flashHit] [命中高亮] [落到那条后闪一下，让她一眼看到] [注释时间 2026-10-21] */
  function flashHit(){
    var id=LIVE.hitId; if(!id) return; var ri=-1; REF.forEach(function(g,i){ if(g&&g.raw&&g.raw.id===id&&ri<0) ri=i; });
    var el=ri>=0?list.querySelector('[data-r="'+ri+'"]'):null; if(!el){ toast('那一条被折叠或没有正文'); return; }
    var top=el.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop-list.clientHeight/3; list.scrollTop=Math.max(0,top);
    el.classList.remove('tk-hit'); void el.offsetWidth; el.classList.add('tk-hit'); setTimeout(function(){ el.classList.remove('tk-hit'); },2600);
    LIVE.hitId=null; jbPaint();
  }

  /* ---------- 打开 ---------- */
  if(LIVE.sid&&P.net){
    if(CTX0.name){ var nm=$('#tkNm',win); if(nm) nm.firstChild.nodeValue=CTX0.name; }
    /* [位置:phone-talk.js·会话级头像] [预设带的会话头像] [本机映射有这个会话的头像就在聊天页根上设 --av-sess（页内所有 .av.ai：顶部按钮、气泡、live，经回退链 var(--av-sess,var(--av-ai)) 自动换图），tk-av-sess 标记类供 markAv 补 hasimg 藏字母] [注释时间 2026-10-26] */
    if(P.sessPref&&P.sessPref.avOf(LIVE.sid)){ host.style.setProperty('--av-sess',P.sessPref.avRaw(P.sessPref.avOf(LIVE.sid))); host.classList.add('tk-av-sess'); P.markAv&&P.markAv(); }
    LIVE.on=true; setTimeout(vRestore,1200);
    P.net.get('/heartbeat/admin/session-names',{noLogin:true}).then(function(x){ LIVE.named=!!(x&&x.names&&x.names[LIVE.sid]); },function(){});
    /* [位置:phone-talk.js·打开会话] [10-24：打开会话不再先画本地快照（消息会跳来跳去），一律直接拉取后端最后一段；本机旧的快照库在 phone-net.js 里一次性删掉] [注释时间 2026-10-24] */
    /* [位置:phone-talk.js·打开会话 并行问状态] [他是不是正在回，不等 history] [11-05：原来 watchStatus 挂在 reload.then 里，history 拉完（重会话 5~10 秒）才开始问状态，
       问到还要再等 3 秒轮询，于是「加载完了却没有正在输出的内容」；现在先问状态，命中生成中就立刻挂上实时区，history 回来再整页对齐] [注释时间 2026-11-05] */
    try{ watchStatus(true,1); }catch(e){}
    /* [位置:phone-talk.js·打开会话 首屏条数] [TAILNEXT 必须赶在 reload 之前设] [11-06 埋点发现：reload 内部拉到尾部就会 rebuild 一次，那时 TAILNEXT 还是 0，
       于是先按全量 352 个单元画了一遍（重会话实测 811~832ms），紧接着 .then 里才画 6 条那一版（46ms）——用户等的是前面那次全量的时间，后一次快也白快。
       现在 TAILNEXT=6 在 reload 之前设好，第一次画就是 6 条；reload 内部画过了（LIVE.__rb=1）外面不再重复画] [注释时间 2026-11-06] */
    var __opened;
    if(CTX0&&CTX0.locate&&CTX0.locate.sidx!=null) __opened=locateTo(CTX0.locate);
    else { TAILNEXT=6; __opened=reload(); }
    __opened.then(function(){ if(!LOC&&!LIVE.__rb){ rbForce=true; TAILNEXT=6; rebuild(); } if(LD){ LD.done(); LD=null; } loadStars(); reportVisible(true);
      /* [位置:phone-talk.js·打开会话 → claimPing] [进来就看有没有存量占用] [11-06：不等 6 秒轮询，首屏 0.3s 拉一次，有登记的话球立刻在] [注释时间 2026-11-06] */
      setTimeout(function(){ try{ if(claimPing) claimPing(); }catch(_e){} try{ if(alarmPing) alarmPing(); }catch(_e){} },300);
      try{ var es=null, et=0;
        function esClose(){ LIVE.sseAt=0; if(es){ try{ es.close(); }catch(_e){} es=null; } }
        function esOpen(){
          if(es||!win.isConnected||document.hidden) return;
          es=new EventSource('/v1/events?session_id='+encodeURIComponent(LIVE.sid),{withCredentials:true});
          es.onmessage=function(ev){ LIVE.sseAt=Date.now(); if(!win.isConnected){ esClose(); return; } var d; try{ d=JSON.parse(ev.data); }catch(e){ return; }
            if(d&&d.type==='history_update'&&!LIVE.busy){ clearTimeout(et); et=setTimeout(function(){ reloadDelta(); },1200);
              /* [位置:phone-talk.js·SSE history_update → claimPing] [回复落盘后立刻刷新浮球] [11-06：定时轮询最慢要等 6 秒，AI 写完 <claim> 这一轮结束就该弹出来；延 1.5s 等 tag-parser 先落盘] [注释时间 2026-11-06] */
              setTimeout(function(){ try{ if(claimPing) claimPing(); }catch(_e){} try{ if(alarmPing) alarmPing(); }catch(_e){} },1500); }
            /* [位置:phone-talk.js·SSE model_fallback] [会话设的模型用不了、后台回退到默认] [以前只写后台日志，聊天页看不出来；现在弹提示说清设的是什么、实际用什么、为什么] [注释时间 2026-10-22] */
            if(d&&d.type==='model_fallback'&&d.text){ toast(d.text); buzz([20,40,20]); } };
        }
        /* [位置:phone-talk.js·SSE 生命周期] [切后台断开] [2026-10-29 性能批：原先切后台也保持长连接，服务端每 25s 心跳持续唤醒基带；现在 hidden 立即关，回前台重连并补一次续显对账（status 全量 + history after）] [注释时间 2026-10-29] */
        function esVis(){ if(!win.isConnected){ document.removeEventListener('visibilitychange',esVis); return; } if(document.hidden){ esClose(); } else { esOpen(); watchStatus(true); reloadDelta(); } }
        esOpen(); document.addEventListener('visibilitychange',esVis);
        var chk=setInterval(function(){ if(!win.isConnected){ esClose(); clearInterval(chk); clearTimeout(stT); document.removeEventListener('visibilitychange',esVis); } },4000); }catch(e){} },
      function(){ if(LD){ LD.done(); LD=null; } toast('没连上后台'); });
  }

  /* [位置:phone-talk.js·subDock] [子会话悬浮入口条] [10-27：每个子 AI 工具行一个「查看」太碎且要退出重进才出现；改成输入框上方一条悬浮条——左边子会话标题（带状态点和状态字），右边 ↗ 打开抽屉；本聊天里派过多个子会话时右边出「2/3」，点它或在条上左右滑动切换。数据来自本聊天的 subagent 工具调用（历史 + 正在生成的），名字/状态每 2.5 秒从后台刷（会话名、AI 自己写的 <status>、运行记录）] [注释时间 2026-10-27] */
  var SUBD={ids:[],cur:'',names:{},st:{},run:{},tm:0,sig:'',skip:0,closed:subClosedLoad()};
  /* [位置:phone-talk.js·subClosed] [悬浮条关闭记忆] [10-27：悬浮条右边的 ↗ 换成 ×，点了就不再显示这个子会话的悬浮入口（会话本身还在，会话列表/子会话组里照常能进）；记在本机 localStorage（ph.subdock.closed，只留最近 200 个），退出重进也不再冒出来；之后新派的子会话照常出现] [注释时间 2026-10-27] */
  function subClosedLoad(){ try{ var a=JSON.parse(localStorage.getItem('ph.subdock.closed')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
  function subClosedSave(){ try{ localStorage.setItem('ph.subdock.closed',JSON.stringify(SUBD.closed.slice(-200))); }catch(e){} }
  function subIdsNow(){ var out=[], seenS={};
    function add(t){ if(!t||t.name!=='subagent') return; var sid=subSidOf(t); if(sid&&!seenS[sid]){ seenS[sid]=1; out.push(sid); } }
    (LIVE.raw||[]).forEach(function(m){ if(!m||m.role!=='assistant') return; var tl=m.stream_timeline;
      if(Array.isArray(tl)&&tl.length){ tl.forEach(function(n){ if(n&&n.type==='tool'&&n.tool) add(n.tool); }); } else (m.tools||[]).forEach(add); });
    if(ST&&ST.tools) ST.tools.forEach(add);
    return out.filter(function(x){ return SUBD.closed.indexOf(x)<0; }); }
  function subWord(sid){ var a=SUBD.st[sid]; if(a) return a; var r=SUBD.run[sid]; return r==='running'?'进行中':r==='done'?'已完成':r?'未完成':''; }
  function subPaint(){
    var el=$('#tkSub',win); if(!el) return; var ids=SUBD.ids;
    if(!ids.length){ el.hidden=true; return; }
    if(ids.indexOf(SUBD.cur)<0) SUBD.cur=ids[ids.length-1];
    var i=ids.indexOf(SUBD.cur), sid=SUBD.cur, w=subWord(sid), run=(SUBD.run[sid]==='running')&&w!=='已完成';
    var nm=String(SUBD.names[sid]||'子会话').replace(/^子进程\s*·\s*/,'');
    var h='<button class="sd-main tap" type="button" data-sd="open"><i class="sd-st'+(run?' run':(w==='已完成'?' ok':(w?' bad':'')))+'"></i><span class="sd-t">'+esc(nm)+'</span>'+(w?'<small>'+esc(w)+'</small>':'')+'</button>'+
      (ids.length>1?'<button class="sd-n tap" type="button" data-sd="next" aria-label="切换子会话">'+(i+1)+'/'+ids.length+'</button>':'')+
      '<button class="sd-go tap" type="button" data-sd="close" aria-label="关闭">'+I.sclose+'</button>';
    if(el.hidden||el._h!==h){ el._h=h; el.innerHTML=h; el.hidden=false; }
  }
  function subFetch(){
    if(!SUBD.ids.length) return;
    Promise.all([P.net.get('/heartbeat/admin/session-names',{noLogin:true}).catch(function(){ return null; }),
      P.net.get('/heartbeat/admin/subagent-status',{noLogin:true}).catch(function(){ return null; }),
      P.net.get('/heartbeat/admin/session-status',{noLogin:true}).catch(function(){ return null; })]).then(function(r){
      if(!win.isConnected) return;
      if(r[0]&&r[0].names) SUBD.names=r[0].names; if(r[1]&&r[1].status) SUBD.run=r[1].status; if(r[2]&&r[2].status) SUBD.st=r[2].status;
      subPaint(); },function(){});
  }
  function subSync(){
    if(!win.isConnected){ clearInterval(SUBD.tm); return; }
    if(document.hidden) return;
    var ids=subIdsNow(), sig=ids.join(',');
    if(sig!==SUBD.sig){ var grew=ids.length>SUBD.ids.length; SUBD.sig=sig; SUBD.ids=ids; if(grew||ids.indexOf(SUBD.cur)<0) SUBD.cur=ids[ids.length-1]||''; subPaint(); }
    subFetch();
  }
  function subGo(d){ var ids=SUBD.ids; if(ids.length<2) return; var i=ids.indexOf(SUBD.cur); SUBD.cur=ids[(i+d+ids.length)%ids.length]; var el=$('#tkSub',win); if(el){ el.classList.remove('sw-l','sw-r'); void el.offsetWidth; el.classList.add(d>0?'sw-l':'sw-r'); } buzz(5); subPaint(); }
  (function(){ var el=$('#tkSub',win); if(!el) return; var x0=0,y0=0,t0=0,swiped=false;
    el.addEventListener('pointerdown',function(e){ x0=e.clientX; y0=e.clientY; t0=Date.now(); swiped=false; },true);   /* 捕获阶段：条里的 .tap 按钮可能先吃掉事件 */
    el.addEventListener('pointerup',function(e){ var dx=e.clientX-x0, dy=e.clientY-y0; if(Math.abs(dx)>40&&Math.abs(dy)<30&&Date.now()-t0<600){ swiped=true; setTimeout(function(){ swiped=false; },350); subGo(dx<0?1:-1); } },true);   /* 滑动后浏览器不一定补发 click，别让标记一直挂着吞掉下一次点击 */
    el.addEventListener('click',function(e){ if(swiped){ swiped=false; return; } var b=e.target.closest('[data-sd]'); if(!b) return; var a=b.getAttribute('data-sd');
      if(a==='next'){ subGo(1); return; }
      if(a==='close'){ var c=SUBD.cur; if(c&&SUBD.closed.indexOf(c)<0){ SUBD.closed.push(c); subClosedSave(); } buzz(5); SUBD.ids=SUBD.ids.filter(function(x){ return x!==c; }); SUBD.sig=SUBD.ids.join(','); SUBD.cur=SUBD.ids[SUBD.ids.length-1]||''; subPaint(); return; }
      if(SUBD.cur&&P.subSheet){ buzz(6); P.subSheet(SUBD.cur); } });
    SUBD.tm=setInterval(subSync,6000); setTimeout(subSync,400); })();

  /* [位置:phone-talk.js·moreStow/setMoreDot/wireMenuPull] [浮球收进「…」的共用零件] [文件球和闹钟球共用靠近判定、高亮、吸入动画、菜单长按拖出，以及 #tkMore .mdot 的 OR 打点（各清各的）] [注释时间 2026-11-16] */
  var claimApi=null;
  var moreBtn=$('#tkMore',win), moreDot=$('#tkMore .mdot',win);
  var moreDotOn={alarm:false,claim:false};
  function paintMoreDot(){
    if(!moreDot) return;
    var on=!!(moreDotOn.alarm||moreDotOn.claim);
    var was=moreDot.hidden; moreDot.hidden=!on;
    if(was&&!moreDot.hidden){ moreDot.classList.remove('pop'); void moreDot.offsetWidth; moreDot.classList.add('pop'); }
  }
  function setMoreDot(key,on){ moreDotOn[key]=!!on; paintMoreDot(); }
  function moreStow(ball){
    function nearMore(){
      if(!moreBtn) return false;
      var br=ball.getBoundingClientRect(), mr=moreBtn.getBoundingClientRect();
      var dx=(br.left+br.width/2)-(mr.left+mr.width/2), dy=(br.top+br.height/2)-(mr.top+mr.height/2);
      return Math.sqrt(dx*dx+dy*dy)<76;
    }
    function setNear(state,on){
      if(state.near===on) return; state.near=on;
      ball.classList.toggle('near',on); if(moreBtn) moreBtn.classList.toggle('near',on);
      if(on) buzz(8);
    }
    function absorb(done){
      if(!moreBtn){ if(done) done(); return; }
      var br=ball.getBoundingClientRect(), mr=moreBtn.getBoundingClientRect();
      var dx=(mr.left+mr.width/2)-(br.left+br.width/2), dy=(mr.top+mr.height/2)-(br.top+br.height/2);
      ball.classList.remove('near'); ball.classList.add('stow');
      ball.style.transform='translate('+Math.round(dx)+'px,'+Math.round(dy)+'px) scale(.2)'; ball.style.opacity='0';
      moreBtn.classList.remove('near');
      buzz([8,40,8]);
      setTimeout(function(){
        ball.classList.remove('stow'); ball.style.transform=''; ball.style.opacity='';
        moreBtn.classList.remove('bump'); void moreBtn.offsetWidth; moreBtn.classList.add('bump');
        if(done) done();
      },290);
    }
    return {nearMore:nearMore,setNear:setNear,absorb:absorb};
  }
  function wireMenuPull(btn,onPull){
    if(!btn) return;
    var st=null;
    function end(){ if(st){ clearTimeout(st.t); st=null; } btn.classList.remove('armed'); }
    btn.addEventListener('pointerdown',function(e){
      if(e.button&&e.button!==0) return;
      end(); st={id:e.pointerId,x:e.clientX,y:e.clientY,armed:false,t:0};
      try{ btn.setPointerCapture(e.pointerId); }catch(_e){}
      st.t=setTimeout(function(){ if(!st) return; st.armed=true; btn.classList.add('armed'); buzz([6,28,8]); },360);
    });
    btn.addEventListener('pointermove',function(e){
      if(!st||e.pointerId!==st.id) return;
      if(!st.armed){ if(Math.abs(e.clientX-st.x)>10||Math.abs(e.clientY-st.y)>10) end(); return; }
      var r=btn.getBoundingClientRect();
      if(e.clientX<r.left-14||e.clientX>r.right+14||e.clientY<r.top-14||e.clientY>r.bottom+14){
        var pid=st.id, x=e.clientX, y=e.clientY; end();
        if(onPull) onPull(x,y,pid);
      }
    });
    btn.addEventListener('pointerup',end); btn.addEventListener('pointercancel',end);
  }

  /* [位置:phone-talk.js·claimBall] [正在改的文件浮球] [11-06：AI 用 <claim> 登记本会话要改哪些文件（lib/claim-locks.js），聊天页右侧一颗玻璃球显示份数；
     点开是清单 + 「清除」（等于替 AI 发 <claim clear>，只清本会话）；有更新自动展开并一直留着，点球 / 点面板外 / 点 × 收起；
     可拖动、记位置（localStorage ph.claimball.pos），默认落点避让「回到最新」和输入区上方的子会话条、附件条；
     进会话时已有存量登记只显示数字，不自动展开；
     11-16：可拖到右上角「…」收纳（ph.claimball.stowed），菜单项仅在已收纳且有登记时出现，点开仍是这份面板] [注释时间 2026-11-16] */
  /* [位置:phone-talk.js·BALLCOL] [右侧浮球共用一列的位置记忆] [11-06：文件球和闹钟球都在右边，各记一套坐标会叠在一起；两球共用 rx（横向比例）+ rb（列底＝下面那颗文件球的 bottom），拖任意一颗整列一起走；记忆键沿用旧的 ph.claimball.pos，之前拖好的位置不丢] [注释时间 2026-11-06] */
  var BALLCOL=(function(){
    var KEY='ph.claimball.pos', W=40, GAP=6;
    var st={pos:null}, subs=[];
    try{ var p0=JSON.parse(localStorage.getItem(KEY)||'null'); if(p0&&typeof p0.rx==='number'&&typeof p0.rb==='number') st.pos=p0; }catch(e){}
    /* 默认落点：与「回到最新」同一基准（输入区顶 + 24px），再往上抬一颗球 + 12px —— 那颗按钮永远在球下面，子会话条 / 附件条出现时一起跟着抬 */
    function baseBottom(p){
      if(!p) return 0;
      var cp=$('.tk-cp',win), at=$('#tkAtt',win), sub=$('#tkSub',win), top=p.clientHeight;
      [cp,at,sub].forEach(function(el){ if(el&&!el.hidden&&el.offsetHeight&&el.offsetParent===p) top=Math.min(top,el.offsetTop); });
      return Math.round(p.clientHeight-top+24+40+12);
    }
    function homeLeft(p){
      var w=p?p.clientWidth:390, l=st.pos?st.pos.rx*(w-W):(w-W-14);
      return Math.max(4,Math.min(l,w-W-4));
    }
    function homeBottom(p){
      var h=p?p.clientHeight:844, b=st.pos?st.pos.rb:baseBottom(p);
      return Math.max(8,Math.min(b,h-W-8));
    }
    function save(rx,rb){
      st.pos={rx:Math.max(0,Math.min(1,rx)),rb:Math.round(rb)};
      try{ localStorage.setItem(KEY,JSON.stringify(st.pos)); }catch(e){}
      for(var i=0;i<subs.length;i++){ try{ subs[i](); }catch(e){} }
    }
    function on(fn){ subs.push(fn); }
    return {W:W,GAP:GAP,baseBottom:baseBottom,homeLeft:homeLeft,homeBottom:homeBottom,save:save,on:on};
  })();
  /* 两个球互斥：打开一个面板时关掉另一个；一颗球显示/隐藏会改变列底，另一颗跟着重排 */
  var BALLS=[];
  function reflowBalls(self){ for(var i=0;i<BALLS.length;i++){ if(BALLS[i].reflow!==self){ try{ BALLS[i].reflow(); }catch(e){} } } }

  var claimPing=null;
  (function(){
    var ball=$('#tkClaim',win), panel=$('#tkClaimP',win);
    if(!ball||!panel) return;
    var BW=40;
    var C={files:[],sig:'',selfSig:'',quiet:false,ever:0,open:false,tm:0,loading:false,ts:0,tick:0,wide:false,parked:false,sid:null};
    /* [位置:phone-talk.js·claimBall 收纳] [文件球拖进「…」] [11-16：对齐闹钟；STOW_KEY 独立；已收纳时 adopt 不得把球再吐出来；新登记只打 #tkMore 的共用点] [注释时间 2026-11-16] */
    var STOW_KEY='ph.claimball.stowed', SEEN_KEY='ph.claimball.seen';
    var stow=moreStow(ball);
    function isStowed(){ try{ return localStorage.getItem(STOW_KEY)==='1'; }catch(e){ return false; } }
    function setStowed(b){
      try{ if(b) localStorage.setItem(STOW_KEY,'1'); else localStorage.removeItem(STOW_KEY); }catch(e){}
      if(b) seenSet(C.sid,C.sig);
      setClaimDot(false);
    }
    function seenAll(){ try{ var o=JSON.parse(localStorage.getItem(SEEN_KEY)||'{}'); return (o&&typeof o==='object'&&o)?o:{}; }catch(e){ return {}; } }
    function seenGet(sid){ return String(seenAll()[sid]||''); }
    function seenHas(sid){ var o=seenAll(); return !!sid && Object.prototype.hasOwnProperty.call(o,sid); }
    function seenSet(sid,sig){
      if(!sid) return;
      try{
        var o=seenAll(); o[sid]=String(sig||'');
        var ks=Object.keys(o); if(ks.length>20) ks.slice(0,ks.length-20).forEach(function(k){ delete o[k]; });
        localStorage.setItem(SEEN_KEY,JSON.stringify(o));
      }catch(e){}
    }
    function setClaimDot(on){ setMoreDot('claim',!!(on&&isStowed())); }
    function markSeen(){ seenSet(C.sid,C.sig); setClaimDot(false); }
    function showBall(){
      if(!C.files.length||isStowed()){ ball.hidden=true; return; }
      ball.hidden=false; ball.classList.remove('out');
    }

    function par(){ return ball.offsetParent||host; }
    function midCut(s,n){ s=String(s||''); if(s.length<=n) return s; var keep=n-1, h=Math.ceil(keep*.55), t=keep-h; return s.slice(0,h)+'…'+s.slice(s.length-t); }
    /* 位置记忆和默认落点都在两球共用的 BALLCOL 里（2026-11-06 抽走） */
    function baseBottom(){ return BALLCOL.baseBottom(par()); }
    /* 球「自己的」位置（记忆值或默认落点，夹在可见区内）—— 和宽面板时的让位位置区分开 */
    function homeLeft(){ return BALLCOL.homeLeft(par()); }
    function homeBottom(){ return BALLCOL.homeBottom(par()); }
    function applyPos(){
      var p=par(); if(!p) return;
      if(C.open&&(C.wide||isStowed())){ placePanel(); return; }   /* 宽面板时球在角落，位置由 parkBall 定；收纳后面板挂在「…」下面 */
      ball.style.left=Math.round(homeLeft())+'px'; ball.style.bottom=Math.round(homeBottom())+'px';
      if(C.open) placePanel();
    }
    /* [位置:phone-talk.js·claimBall relTime] [登记时间的相对值] [11-06：每行右边原来是个「改」，五个字全一样、没信息量；换成登记时间的相对值（刚刚 / 3min / 2h / 1d），一眼知道这份占坑多久了] [注释时间 2026-11-06] */
    function relTime(ts){
      var d=Date.now()-(Number(ts)||0);
      if(!ts||d<0) return '';
      var m=Math.floor(d/60000);
      if(m<1) return '刚刚';
      if(m<60) return m+'min';
      var h=Math.floor(m/60);
      if(h<24) return h+'h';
      return Math.floor(h/24)+'d';
    }
    /* 面板一直开着的时候，相对时间自己往前走（只改文字，不重绘列表） */
    function ageTick(){
      if(C.tick) return;
      C.tick=setInterval(function(){
        if(!C.open||!win.isConnected){ clearInterval(C.tick); C.tick=0; return; }
        var els=panel.querySelectorAll('.ct');
        for(var i=0;i<els.length;i++) els[i].textContent=relTime(els[i].getAttribute('data-ts'));
      },20000);
    }
    /* [位置:phone-talk.js·claimBall baseName] [只取文件名] [11-06：仓库里 447 个文件名有两个以上同名（index.html 15 个、package.json 4 个），所以登记写全路径；
       但列表里天天看 lib/ / routes/ 前缀是噪音——窄面板只显示文件名，双击面板才摊开完整路径] [注释时间 2026-11-06] */
    function baseName(p){ var a=String(p||''), i=a.lastIndexOf('/'); return i>=0?a.slice(i+1):a; }
    function paint(){
      var f=C.files, n=f.length, hasSelf=false, i;
      for(i=0;i<n;i++){ if(!f[i].tool) hasSelf=true; }
      var num=n>99?'99+':String(n);
      ball.querySelector('.n').textContent=num;
      ball.setAttribute('aria-label','正在改的文件 '+n+' 份');
      /* 宽面板：360px，屏幕窄时按「屏宽-24」自适应，但不小于窄面板的 232 */
      panel.style.width=panelW()+'px';
      panel.innerHTML='<div class="ch"><b>正在改的文件</b><i class="cn">'+num+'</i></div>'+
        '<ul class="cl">'+f.map(function(x){
          var full=String(x.path||''), nm=baseName(full)||full;
          var label=C.wide?full:midCut(nm,20);
          var tip=full+(x.tool?(' · 来自工具'+(x.task?'：'+x.task:'')):'');
          return '<li class="ci'+(C.wide?' w':'')+'" title="'+esc(tip)+'"><span class="cp">'+esc(label)+'</span>'+
            (x.tool?'<i class="cs">工具</i>':'')+
            '<i class="ct" data-ts="'+(x.ts||0)+'">'+esc(relTime(x.ts))+'</i></li>';
        }).join('')+'</ul>'+
        (hasSelf?'<button class="cc tap" type="button" data-c="clear">清除</button>':'');
      panel.hidden=false;
    }
    /* 面板目标宽度（不读 offsetWidth：宽度带 .26s 过渡，动画刚开始读到的还是旧宽度，会让位置按窄面板算而溢出） */
    function panelW(){ var p=par(); return C.wide?Math.min(360,Math.max(232,(p?p.clientWidth:390)-24)):232; }
    function placePanel(){
      var p=par(); if(!p||panel.hidden) return;
      var pw=panelW(), ph=panel.offsetHeight||140;
      if(isStowed()){
        var mr=moreBtn?moreBtn.getBoundingClientRect():null, pr=p.getBoundingClientRect();
        panel.style.left=''; panel.style.right=''; panel.style.bottom='';
        panel.classList.remove('lr');
        var rightPx=mr?Math.max(6,p.clientWidth-(mr.right-pr.left)):8;
        panel.style.right=Math.round(rightPx)+'px';
        var panelTop=mr?(mr.bottom-pr.top+8):48;
        panel.style.bottom=Math.round(Math.max(8,p.clientHeight-panelTop-ph))+'px';
        return;
      }
      var bl=homeLeft(), bb=homeBottom(), L;
      panel.style.left=''; panel.style.right=''; panel.style.bottom='';
      if(bl>=pw+14){ panel.style.right=(p.clientWidth-bl+10)+'px'; panel.classList.add('lr'); L=p.clientWidth-(p.clientWidth-bl+10)-pw; }   /* 球在右半屏 → 面板往左长 */
      else { L=Math.max(6,Math.min(bl+BW+10,p.clientWidth-pw-8)); panel.style.left=L+'px'; panel.classList.remove('lr'); }   /* 球在左半屏 → 面板往右长，靠右时夹回容器内不溢出 */
      var B=Math.round(Math.max(8,Math.min(bb,p.clientHeight-ph-8)));
      panel.style.bottom=B+'px';
      parkBall(C.wide,L,L+pw,B,B+ph,p);
    }
    /* [位置:phone-talk.js·claimBall parkBall] [宽面板时球让到角落] [11-06：面板撑宽后球挤在边上没意义，
       让它去面板的右上 / 左下——球靠面板右半边 → 球到面板右上方；靠左半边 → 到面板左下方；
       缩回窄面板后回到记忆位置。位置只改 style、不写 localStorage，所以不会污染用户拖动记忆] [注释时间 2026-11-06] */
    function parkBall(on,L,R,B,T,p){
      if(!on){ if(C.parked){ C.parked=false; ball.classList.remove('parked'); applyPos(); } return; }
      C.parked=true; ball.classList.add('parked');
      var l,b,gap=8, h=p.clientHeight, w=p.clientWidth;
      /* 用面板中线判断球偏哪边（宽面板几乎占满屏时，看球原本的左右，不看面板边缘） */
      if(homeLeft()+BW/2 >= L+(R-L)/2){
        l=R-BW; b=T+gap;                                     /* 球在右 → 面板右上方，水平右对齐 */
        if(b>h-BW-gap) b=B-BW-gap;                            /* 上方放不下（面板很高）→ 改到面板下方 */
      } else {
        l=L; b=B-BW-gap;                                      /* 球在左 → 面板左下方，水平左对齐 */
        if(b<gap) b=T+gap;                                    /* 下方放不下 → 改到面板上方 */
      }
      l=Math.max(4,Math.min(l,w-BW-4)); b=Math.max(gap,Math.min(b,h-BW-gap));
      ball.style.left=Math.round(l)+'px'; ball.style.bottom=Math.round(b)+'px';
    }
    function openPanel(){
      if(!C.files.length) return;
      if(!C.open){ C.open=true; paint(); panel.hidden=false; }
      ball.setAttribute('aria-expanded','true');
      placePanel(); ageTick(); markSeen();
      requestAnimationFrame(function(){ if(C.open) panel.classList.add('on'); });
    }
    function closePanel(){
      if(!C.open) return;
      C.open=false; panel.classList.remove('on'); ball.setAttribute('aria-expanded','false');
      if(C.tick){ clearInterval(C.tick); C.tick=0; }
      /* 关掉后回到窄的：宽面板只是临时看完整路径，不用一直占着屏幕（隐藏之后再收，看不见跳变） */
      setTimeout(function(){ if(!C.open){ panel.hidden=true; if(C.wide){ C.wide=false; panel.classList.remove('wide'); } if(!DR||!DR.on) parkBall(false); } },240);
    }
    function bump(){ ball.classList.remove('pop'); void ball.offsetWidth; ball.classList.add('pop'); }
    function clearAll(){ C.files=[]; C.sig=''; C.selfSig=''; C.quiet=false; ball.hidden=true; setClaimDot(false); closePanel(); reflowBalls(applyPos); }   /* 文件球消失 → 闹钟球占回列底；收纳标记保留 */
    function normPath(p){ return String(p||'').replace(/^\.?\//,'').toLowerCase(); }
    function recFiles(rec, tool){
      if(!rec||!Array.isArray(rec.files)) return [];
      var ts=Number(rec.ts)||0, task=String(rec.name||'');
      return rec.files.map(function(x){ return { path:String(x.path||''), action:String(x.action||'改'), ts:ts, tool:!!tool, task:task }; });
    }
    /* [位置:phone-talk.js·claimBall pick] [本会话 + 工具登记合并去重] [11-06：工具 claim_lock 落的是 tool_ 键，原来只查本会话键所以看不见子 agent 的占坑；
       现在拉全量，只挑本会话 s_ 和所有 tool_（别的聊天会话仍不显示），同路径留一行、本会话优先] [注释时间 2026-11-06] */
    function pick(locks, sid){
      var out=[], seen={};
      function take(x){
        var k=normPath(x.path); if(!k) return;
        var had=seen[k];
        if(had){ if(x.tool&&had.tool) had.ts=Math.max(had.ts,x.ts); return; }
        seen[k]=x; out.push(x);
      }
      recFiles(locks&&locks[sid],false).forEach(take);
      /* s_sub_ 是子智能体会话：也过网关注入落自己的键，但不是当前聊天会话，浮球按「工具」类显示、不给清除 */
      Object.keys(locks||{}).forEach(function(k){ if(k.indexOf('tool_')!==0&&k.indexOf('s_sub_')!==0) return; recFiles(locks[k],true).forEach(take); });
      out.sort(function(a,b){ if(a.tool!==b.tool) return a.tool?1:-1; return (a.ts||0)-(b.ts||0); });
      return out;
    }
    function sigOf(files){ return JSON.stringify(files.map(function(x){ return x.path+'|'+x.action+'|'+(x.ts||0)+'|'+(x.tool?1:0); })); }
    function selfSigOf(locks,sid){
      var r=locks&&locks[sid]; if(!r) return '';
      return String(r.ts||'')+'|'+(r.files||[]).map(function(x){ return x.path+'|'+x.action; }).join(',');
    }
    function adopt(locks){
      var sid=LIVE.sid||C.sid;
      var files=pick(locks,sid);
      if(!files.length){ if(C.sig||!ball.hidden) clearAll(); else setClaimDot(false); return; }
      var sig=sigOf(files);
      if(sig===C.sig){ if(isStowed()) showBall(); return; }
      var selfSig=selfSigOf(locks,sid), selfChanged=selfSig!==C.selfSig;
      C.sig=sig; C.selfSig=selfSig; C.files=files;
      if(isStowed()){
        showBall(); paint(); if(C.open) placePanel();
        if(!seenHas(sid)){ seenSet(sid,sig); setClaimDot(false); }
        else if(sig!==seenGet(sid)) setClaimDot(true);
        else setClaimDot(false);
        reflowBalls(applyPos);
        C.ever=1; C.quiet=false;
        return;
      }
      ball.hidden=false;
      paint(); applyPos(); bump(); reflowBalls(applyPos);   /* 文件球出现 → 闹钟球往上让一格 */
      if(C.ever&&!C.quiet&&(selfChanged||C.open)) openPanel();   /* 本会话有更新才自动展开；工具那边只 pop + 数字变，不弹面板刷屏 */
      C.ever=1; C.quiet=false;
    }
    function sync(){
      if(!win.isConnected){ clearInterval(C.tm); return; }
      if(document.hidden) return;
      if(!LIVE.on||!LIVE.sid){ if(!ball.hidden) clearAll(); return; }
      if(C.loading) return;
      C.loading=true; var sid=LIVE.sid;
      /* [位置:phone-talk.js·claimBall sync 会话变更] [换了会话就重来] [11-06：正常是每个会话新建窗口，这里防窗口被复用——换 sid 就清掉上一会话的球和「已展开」标记，新会话的存量只显示数字] [注释时间 2026-11-06] */
      if(C.sid!==sid){ C.sid=sid; C.ever=0; C.sig=''; C.selfSig=''; C.quiet=false; C.files=[]; ball.hidden=true; closePanel(); }
      /* [位置:phone-talk.js·claimBall sync 全量] [本会话 + 工具登记一起看] [11-06：带 session_id 只回本会话，工具登记挂在 tool_ 键下永远看不到；改拉全量，前端自己挑，别的聊天会话仍过滤掉] [注释时间 2026-11-06] */
      P.net.get('/heartbeat/admin/claim-locks',{noLogin:true}).then(function(j){
        C.loading=false; if(!win.isConnected||LIVE.sid!==sid) return;
        adopt((j&&j.locks&&typeof j.locks==='object')?j.locks:null);
      },function(){ C.loading=false; });
    }
    function doClear(btn){
      var sid=LIVE.sid; if(!sid) return;
      btn.disabled=true; btn.textContent='清除中…';
      P.net.req('/heartbeat/admin/claim-locks/clear',{method:'POST',body:{session_id:sid}}).then(function(){
        if(!win.isConnected) return;
        buzz(8); toast('已清除本会话的占用');
        C.quiet=true; C.ever=1; setTimeout(sync,60);   /* 清完立刻重拉：本会话行消失，工具行还在就继续显示，不自动弹面板 */
      },function(){ btn.disabled=false; btn.textContent='清除'; toast('没清掉，稍后再试'); });
    }
    /* 拖动：移动超过 5px 才算拖（否则是点击），松手吸回边界并记住位置；拖到「…」附近高亮，松手吸入收纳 */
    var DR={on:false,x0:0,y0:0,l0:0,b0:0,moved:false,id:-1,near:false};
    function dragMove(cx,cy){
      var dx=cx-DR.x0, dy=cy-DR.y0;
      if(!DR.moved){ if(Math.abs(dx)<5&&Math.abs(dy)<5) return; DR.moved=true; ball.classList.add('drag'); closePanel(); }
      var p=par(); if(!p) return;
      var l=Math.max(4,Math.min(p.clientWidth-BW-4,DR.l0+dx)), b=Math.max(8,Math.min(p.clientHeight-BW-8,DR.b0-dy));
      ball.style.left=Math.round(l)+'px'; ball.style.bottom=Math.round(b)+'px';
      stow.setNear(DR, stow.nearMore());
    }
    ball.addEventListener('pointerdown',function(e){
      if(e.button&&e.button!==0) return;
      DR.on=true; DR.moved=false; DR.near=false; DR.id=e.pointerId; DR.x0=e.clientX; DR.y0=e.clientY;
      var l0=parseFloat(ball.style.left), b0=parseFloat(ball.style.bottom);
      DR.l0=isNaN(l0)?ball.offsetLeft:l0; DR.b0=isNaN(b0)?homeBottom():b0;
      try{ ball.setPointerCapture(e.pointerId); }catch(_e){}
    });
    ball.addEventListener('pointermove',function(e){
      if(!DR.on||e.pointerId!==DR.id) return;
      dragMove(e.clientX,e.clientY);
    });
    function endDrag(e){
      if(!DR.on||(e&&e.pointerId!==DR.id)) return;
      DR.on=false; ball.classList.remove('drag');
      if(DR.moved){
        if(DR.near&&moreBtn){
          DR.moved=false; DR.near=false;
          stow.absorb(function(){
            setStowed(true);
            ball.hidden=true; applyPos(); reflowBalls(applyPos);
          });
          return;
        }
        var p=par(), w=p?p.clientWidth:0;
        /* 拖的是列底那颗：直接把它的位置写成整列的 rb，上面那颗闹钟球跟着走 */
        BALLCOL.save((w-BALLCOL.W)>0?ball.offsetLeft/(w-BALLCOL.W):1, parseFloat(ball.style.bottom)||0);
        buzz(6);
      } else { if(C.open) closePanel(); else openPanel(); buzz(5); }
      stow.setNear(DR,false); DR.moved=false;
    }
    ball.addEventListener('pointerup',endDrag);
    ball.addEventListener('pointercancel',function(){ DR.on=false; DR.moved=false; ball.classList.remove('drag'); stow.setNear(DR,false); });
    /* 从菜单里的「在改文件」项长按拖出来：球在手指处飞出，接着就是一次正常的拖动 */
    function pullOut(x,y,pid){
      setStowed(false);
      if(!C.files.length){ toast('有登记后小球会出现'); return; }
      ball.classList.remove('menu-hide'); ball.classList.add('drag');
      showBall();
      var pr=par(), r=pr.getBoundingClientRect();
      var l=Math.max(4,Math.min(pr.clientWidth-BW-4,x-r.left-BW/2)), b=Math.max(8,Math.min(pr.clientHeight-BW-8,r.bottom-y-BW/2));
      ball.style.left=Math.round(l)+'px'; ball.style.bottom=Math.round(b)+'px';
      ball.classList.remove('fly'); void ball.offsetWidth; ball.classList.add('fly');
      setTimeout(function(){ ball.classList.remove('fly'); },340);
      buzz(10);
      DR.on=true; DR.moved=true; DR.near=false; DR.id=pid; DR.x0=x; DR.y0=y; DR.l0=l; DR.b0=b;
      function mv(ev){ if(ev.pointerId===DR.id&&DR.on) dragMove(ev.clientX,ev.clientY); }
      function up(ev){ if(ev.pointerId!==DR.id) return; off(); endDrag(ev); }
      function off(){ document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',up); }
      document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up); document.addEventListener('pointercancel',up);
    }
    panel.addEventListener('click',function(e){
      var b=e.target.closest('[data-c]'); if(!b) return;
      if(b.getAttribute('data-c')==='clear'){ buzz(6); doClear(b); }   /* 面板里只剩「清除」一个按钮：× 已按11-06 去掉，收起靠点球或点面板外 */
    });
    /* [位置:phone-talk.js·claimBall 双击切宽窄] [双击面板看完整路径] [11-06：窄面板只显示文件名，双击面板撑宽把所有文件的完整路径摊开，再双击收回；
       不用 dblclick（iOS Safari 对它支持不稳），自己数两次 pointerup 的间隔和距离；点在「清除」上不算] [注释时间 2026-11-06] */
    var DBL={t:0,x:0,y:0};
    panel.addEventListener('pointerup',function(e){
      if(e.target.closest('[data-c]')) return;
      var now=Date.now();
      if(now-DBL.t<330&&Math.abs(e.clientX-DBL.x)<32&&Math.abs(e.clientY-DBL.y)<32){
        DBL.t=0; C.wide=!C.wide; panel.classList.toggle('wide',C.wide);
        paint(); placePanel(); buzz(5);
      } else { DBL.t=now; DBL.x=e.clientX; DBL.y=e.clientY; }
    });
    /* 点面板和球以外的地方收起（不铺遮罩、不挡聊天） */
    win.addEventListener('pointerdown',function(e){
      if(!C.open) return;
      if(panel.contains(e.target)||ball.contains(e.target)) return;
      closePanel();
    },true);
    claimPing=sync;
    claimApi={
      menuOpen:function(on){ if(!isStowed()) ball.classList.toggle('menu-hide',!!on); if(on) closePanel(); },
      pullOut:pullOut,
      menuVisible:function(){ return isStowed()&&C.files.length>0; },
      count:function(){ return C.files.length; },
      openPanel:openPanel,
      markSeen:markSeen
    };
    BALLS.push({close:closePanel, reflow:applyPos});
    BALLCOL.on(function(){ if(!C.open||!C.wide) applyPos(); });   /* 另一颗球拖了整列 / 列位置变了，跟着走 */
    /* 尺寸变化跟着走：输入框折行、子会话条出现、键盘弹起 */
    if(window.ResizeObserver){ var ro=new ResizeObserver(function(){ if(!win.isConnected){ ro.disconnect(); return; } applyPos(); });
      var cp0=$('.tk-cp',win), at0=$('#tkAtt',win), sub0=$('#tkSub',win);
      ro.observe(win); if(cp0) ro.observe(cp0); if(at0) ro.observe(at0); if(sub0) ro.observe(sub0); }
    C.tm=setInterval(sync,6000); setTimeout(sync,600);
  })();

  /* [位置:phone-talk.js·ALT/alarmDialog] [闹钟的共用小工具 + 「…」菜单里的闹钟弹窗] [11-09：闹钟入口收进「…」菜单；点「闹钟」弹出居中的磨砂卡片——本会话所有闹钟（他设的 + 她自己设的 + 旧 <wake> 标签单槽），可添加、点她自己设的那条编辑/删除、他设的那条只能取消；
     2026-11-20 扩展：添加/编辑支持 3 种模式——「多久后」（快捷胶囊 + 自定义分钟/小时）、「定点」（每天 / 按星期多选 / 一次）、「循环」（每 N 分钟/小时 + 可选免打扰时段）；单次闹钟落在「响铃前 N 分钟聊过不响」范围内时提示并阻止误设；
     悬浮小球只反映「他设的」闹钟，她自己设的每天/循环闹钟不挂小球，免得长期占着屏幕] [注释时间 2026-11-20] */
  var alarmApi=null;   /* 小球 IIFE 里赋值：菜单开关通知 / 拖出 / 刷新 / 标已读 */
  var ALT=(function(){
    var DAY_CN=['日','一','二','三','四','五','六'];
    var DAY_ORD=[1,2,3,4,5,6,0];
    function pad(n){ return n<10?'0'+n:''+n; }
    /* 倒计时：29:47 / 3:07:22 / 1天 03:07 */
    function cdBig(at){
      var d=Number(at)-Date.now();
      if(!isFinite(d)) return '';
      if(d<=0) return '到点';
      var s=Math.floor(d/1000), m=Math.floor(s/60), h=Math.floor(m/60), dd=Math.floor(h/24);
      if(dd>0) return dd+'天 '+pad(h%24)+':'+pad(m%60);
      if(h>0) return h+':'+pad(m%60)+':'+pad(s%60);
      return pad(m%60)+':'+pad(s%60);
    }
    function formatDays(days){
      if(!Array.isArray(days)||!days.length) return '';
      var set={}; for(var i=0;i<days.length;i++) set[days[i]]=true;
      var cnt=Object.keys(set).length;
      if(cnt===7) return '每天';
      if(cnt===5&&set[1]&&set[2]&&set[3]&&set[4]&&set[5]) return '工作日';
      if(cnt===2&&set[0]&&set[6]) return '周末';
      var out=[];
      for(var j=0;j<DAY_ORD.length;j++) if(set[DAY_ORD[j]]) out.push(DAY_CN[DAY_ORD[j]]);
      return '周'+out.join('/');
    }
    function formatInterval(min){
      var m=Math.round(Number(min)||0);
      if(m<=0) return '循环';
      if(m>=60&&m%60===0) return '每 '+(m/60)+' 小时';
      if(m>60) return '每 '+Math.floor(m/60)+' 小时 '+(m%60)+' 分';
      return '每 '+m+' 分钟';
    }
    /* 第二行：07:30 / 明天 07:30 / 11-08 07:30 / 每天 07:30 / 周一/三/五 07:30 / 每 30 分钟 */
    function whenText(it){
      var t=new Date(Number(it.at)); if(isNaN(t.getTime())) return '';
      var hh=pad(t.getHours())+':'+pad(t.getMinutes());
      if(it.repeat==='daily') return '每天 '+hh;
      if(it.repeat==='weekly') return (formatDays(it.days)||'每周')+' '+hh;
      if(it.repeat==='interval') return formatInterval(it.intervalMin);
      var now=new Date(), d0=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
      var d1=new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime();
      var n=Math.round((d1-d0)/86400000);
      if(n===0) return hh;
      if(n===1) return '明天 '+hh;
      return pad(t.getMonth()+1)+'-'+pad(t.getDate())+' '+hh;
    }
    /* /admin/wake-alarms 的返回 → 列表：工具闹钟（by=user 是她自己设的）+ 旧 <wake> 标签单槽；到点超过 1 分钟仍没被调度器消费的（网关停过 / 僵尸槽）不显示 */
    function parse(res){
      var list=[], arr=(res&&res.alarms)||[];
      for(var i=0;i<arr.length;i++){
        var a=arr[i]; if(!a||!a.id) continue;
        var mine=a.by==='user';
        list.push({
          key:'a:'+a.id, at:new Date(a.at).getTime(), repeat:a.repeat||'once',
          days:Array.isArray(a.days)?a.days.slice():null,
          intervalMin:a.intervalMin?Number(a.intervalMin):0,
          quietStart:a.quietStart||'', quietEnd:a.quietEnd||'',
          by:mine?'user':'ai', label:a.label||'', note:a.note||'',
          prob:mine?(+a.prob||0):0, text:mine?(a.note||''):(a.label||'')
        });
      }
      var sl=res&&res.slot;
      if(sl&&sl.at) list.push({key:'slot', at:new Date(sl.at).getTime(), repeat:'once', days:null, intervalMin:0, quietStart:'', quietEnd:'', by:'ai', label:'', note:'', prob:0, text:''});
      var now=Date.now();
      list=list.filter(function(x){ return isFinite(x.at)&&x.at>now-60000; });
      list.sort(function(a,b){ return a.at-b.at; });
      return list;
    }
    /* "HH:MM" → 下一个这个时刻（已过就是明天） */
    function nextAt(hhmm){
      var m=/^(\d{1,2}):(\d{2})$/.exec(String(hhmm||'')); if(!m) return null;
      var d=new Date(); d.setHours(+m[1],+m[2],0,0);
      if(d.getTime()<=Date.now()+5000) d.setDate(d.getDate()+1);
      return d;
    }
    /* "HH:MM" + days(0..6) → 下一个命中的星期时刻 */
    function nextWeeklyAt(hhmm,days){
      var m=/^(\d{1,2}):(\d{2})$/.exec(String(hhmm||'')); if(!m||!days||!days.length) return null;
      var d=new Date(); d.setHours(+m[1],+m[2],0,0);
      for(var i=0;i<8;i++){
        if(d.getTime()>Date.now()+5000&&days.indexOf(d.getDay())>=0) return d;
        d.setDate(d.getDate()+1);
      }
      return d;
    }
    function hhmmMin(s){
      var m=/^(\d{1,2}):(\d{2})$/.exec(String(s||''));
      return m?(+m[1])*60+(+m[2]):null;
    }
    /* 若 d 落在免打扰时段 [qs, qe) 内，顺延到 qe */
    function adjustQuiet(d,qs,qe){
      var s=hhmmMin(qs), e=hhmmMin(qe);
      if(s===null||e===null||s===e) return d;
      var mins=d.getHours()*60+d.getMinutes(), out=new Date(d.getTime());
      if(s<e){
        if(mins>=s&&mins<e){ out.setHours(Math.floor(e/60),e%60,0,0); return out; }
      }else{
        if(mins>=s){ out.setDate(out.getDate()+1); out.setHours(Math.floor(e/60),e%60,0,0); return out; }
        if(mins<e){ out.setHours(Math.floor(e/60),e%60,0,0); return out; }
      }
      return d;
    }
    function dayWord(d){
      var now=new Date(), d0=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
      var d1=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
      var diff=Math.round((d1-d0)/86400000);
      if(diff===0) return '今天';
      if(diff===1) return '明天';
      return pad(d.getMonth()+1)+'-'+pad(d.getDate())+' 周'+DAY_CN[d.getDay()];
    }
    return {pad:pad,cdBig:cdBig,whenText:whenText,formatDays:formatDays,formatInterval:formatInterval,parse:parse,nextAt:nextAt,nextWeeklyAt:nextWeeklyAt,adjustQuiet:adjustQuiet,dayWord:dayWord,DAY_CN:DAY_CN,DAY_ORD:DAY_ORD};
  })();

  function alarmDialog(){
    if(!LIVE.on||!LIVE.sid){ toast('先连上后台，再设闹钟'); return; }
    var sid=LIVE.sid, S={items:[],loaded:false,err:false,editing:null,busy:false,tick:0,closed:false,mode:'list',quietMin:0};
    var ov=document.createElement('div'); ov.className='tk-ov tk-ad';
    ov.innerHTML='<div class="scrim"></div><div class="adc" role="dialog" aria-modal="true" aria-label="闹钟"><div class="adv"></div></div>';
    host.appendChild(ov); buzz(6);
    var card=ov.querySelector('.adc'), view=ov.querySelector('.adv');
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ if(!S.closed) ov.classList.add('show'); }); });
    if(alarmApi) alarmApi.markSeen();   /* 进过闹钟弹窗 = 看过了，「…」上的红点消掉 */

    var kbOff=null, kbFt1=0, kbFt2=0;
    function applyAdKb(kb){
      if(S.closed||!ov.isConnected){ if(kbOff){ kbOff(); kbOff=null; } return; }
      kb=Math.max(0,Math.round(kb||0));
      if(kb>60){
        ov.style.paddingBottom=(kb+12)+'px';
        card.style.maxHeight='calc(100% - var(--sat, 0px) - '+(kb+28)+'px)';
        card.style.overflowY='auto';
        var ae=document.activeElement;
        if(ae&&card.contains(ae)&&isKbInput(ae)){
          clearTimeout(kbFt1);
          kbFt1=setTimeout(function(){ if(!S.closed&&document.activeElement===ae) scrollElCenter(ae); },80);
        }
      } else {
        ov.style.paddingBottom='';
        card.style.maxHeight='';
        card.style.overflowY='';
      }
    }
    card.addEventListener('focusin',function(e){
      var t=e.target; if(!isKbInput(t)) return;
      var cur=kbNow(); if(cur>60) applyAdKb(cur);
      clearTimeout(kbFt1); clearTimeout(kbFt2);
      kbFt1=setTimeout(function(){ if(!S.closed&&document.activeElement===t) scrollElCenter(t); },120);
      kbFt2=setTimeout(function(){ if(!S.closed&&document.activeElement===t) scrollElCenter(t); },340);
    });
    if(P.kb) kbOff=P.kb(applyAdKb);
    function close(){
      if(S.closed) return; S.closed=true; ov.classList.remove('show');
      clearTimeout(kbFt1); clearTimeout(kbFt2);
      if(kbOff){ kbOff(); kbOff=null; }
      if(S.tick){ clearInterval(S.tick); S.tick=0; }
      setTimeout(function(){ if(ov.parentNode) ov.remove(); },260);
    }
    /* 切视图：旧内容淡出 → 换内容 → 卡片高度从旧值滑到新值 → 新内容淡入 */
    function swap(html,after){
      var h0=card.offsetHeight;
      view.classList.add('out');
      setTimeout(function(){
        if(S.closed) return;
        card.style.height=''; view.innerHTML=html;
        var h1=card.offsetHeight;
        card.style.height=h0+'px'; void card.offsetHeight; card.style.height=h1+'px';
        view.classList.remove('out');
        if(after) after();
        setTimeout(function(){ card.style.height=''; },300);
      },110);
    }
    function listHtml(){
      var body;
      if(!S.loaded) body='<div class="ade">…</div>';
      else if(S.err) body='<div class="ade">读不到，稍后再试</div>';
      else if(!S.items.length) body='<div class="ade">无</div>';
      else body='<ul class="adl">'+S.items.map(function(a){
        var mine=a.by==='user';
        var sub='';
        if(a.repeat==='interval'&&a.quietStart&&a.quietEnd) sub='免打扰 '+a.quietStart+'–'+a.quietEnd;
        if(a.text) sub=sub?(sub+' · '+a.text):a.text;
        return '<li class="adi'+(mine?' mine':'')+'" data-k="'+esc(a.key)+'"'+(mine?' tabindex="0" role="button" aria-label="编辑这个闹钟"':'')+'>'+
          '<div class="adm"><b class="adw">'+esc(ALT.whenText(a)+(a.prob?' · '+a.prob+'%':''))+'</b>'+(sub?'<i class="adn">'+esc(sub)+'</i>':'')+'</div>'+
          '<span class="adcd" data-at="'+Number(a.at)+'">'+esc(ALT.cdBig(a.at))+'</span>'+
          (mine?'<span class="adg">'+I.chev+'</span>':'<button class="adx tap" type="button" data-c="cancel" aria-label="取消这个闹钟">'+I.sclose+'</button>')+
        '</li>';
      }).join('')+'</ul>';
      return '<div class="adh"><b>闹钟</b></div>'+body+'<button class="adadd tap" type="button" data-c="add">'+I.plus+'<span>添加闹钟</span></button>';
    }
    var F={mode:'after',afterVal:30,afterUnit:'m',ivVal:30,ivUnit:'m',days:[1,3,5],quietOn:false};
    function formHtml(){
      var e=S.editing, d=e?new Date(e.at):null;
      var hh=e?ALT.pad(d.getHours())+':'+ALT.pad(d.getMinutes()):'08:00';
      var rep=(e&&(e.repeat==='daily'||e.repeat==='weekly'||e.repeat==='once'))?e.repeat:'daily';
      var note=e?e.note:'', pr=e&&e.prob?e.prob:0;
      var qs=(e&&e.quietStart)?e.quietStart:'23:00', qe=(e&&e.quietEnd)?e.quietEnd:'08:00';
      F={mode:'after',afterVal:30,afterUnit:'m',ivVal:30,ivUnit:'m',days:[1,3,5],quietOn:false};
      if(e){
        if(e.repeat==='interval'){
          F.mode='interval';
          var im=e.intervalMin||30;
          if(im>=60&&im%60===0){ F.ivVal=im/60; F.ivUnit='h'; } else { F.ivVal=im; F.ivUnit='m'; }
          F.quietOn=!!(e.quietStart&&e.quietEnd);
        } else {
          F.mode='fixed';
          if(e.repeat==='weekly'&&Array.isArray(e.days)&&e.days.length) F.days=e.days.slice();
        }
      }
      var afterChips=[[3,'3分'],[5,'5分'],[10,'10分'],[30,'30分'],[60,'1小时']].map(function(x){
        var cur=(F.afterUnit==='h'?F.afterVal*60:F.afterVal)===x[0];
        return '<button type="button" class="tap'+(cur?' on':'')+'" data-ac="'+x[0]+'">'+x[1]+'</button>';
      }).join('');
      var ivChips=[[15,'15分'],[30,'30分'],[60,'1小时'],[120,'2小时']].map(function(x){
        var cur=(F.ivUnit==='h'?F.ivVal*60:F.ivVal)===x[0];
        return '<button type="button" class="tap'+(cur?' on':'')+'" data-ic="'+x[0]+'">'+x[1]+'</button>';
      }).join('');
      var wkBtns=ALT.DAY_ORD.map(function(day){
        var on=F.days.indexOf(day)>=0;
        return '<button type="button" class="tap'+(on?' on':'')+'" data-wd="'+day+'" aria-pressed="'+(on?'true':'false')+'">'+ALT.DAY_CN[day]+'</button>';
      }).join('');
      return '<div class="adh"><button class="adb tap" type="button" data-c="back" aria-label="返回">'+I.back+'</button><b>'+(e?'编辑闹钟':'添加闹钟')+'</b></div>'+
        '<div class="admode" data-m="'+F.mode+'" role="tablist" aria-label="唤醒方式">'+
          '<button type="button" class="tap'+(F.mode==='after'?' on':'')+'" data-m="after" role="tab" aria-selected="'+(F.mode==='after')+'">多久后</button>'+
          '<button type="button" class="tap'+(F.mode==='fixed'?' on':'')+'" data-m="fixed" role="tab" aria-selected="'+(F.mode==='fixed')+'">定点</button>'+
          '<button type="button" class="tap'+(F.mode==='interval'?' on':'')+'" data-m="interval" role="tab" aria-selected="'+(F.mode==='interval')+'">循环</button>'+
        '</div>'+
        '<div class="adpane'+(F.mode==='after'?' on':'')+'" data-p="after">'+
          '<div class="adchips">'+afterChips+'</div>'+
          '<div class="adnum"><input id="adAfterV" type="number" inputmode="numeric" min="1" max="10080" value="'+F.afterVal+'" aria-label="时长">'+
            '<div class="adunit"><button type="button" class="tap'+(F.afterUnit==='m'?' on':'')+'" data-au="m">分钟后</button><button type="button" class="tap'+(F.afterUnit==='h'?' on':'')+'" data-au="h">小时后</button></div>'+
          '</div>'+
        '</div>'+
        '<div class="adpane'+(F.mode==='fixed'?' on':'')+'" data-p="fixed">'+
          '<input class="adt" id="adTime" type="time" value="'+hh+'" step="60" aria-label="响铃时间">'+
          '<div class="adseg" data-v="'+rep+'" role="radiogroup" aria-label="重复">'+
            '<button type="button" class="tap'+(rep==='daily'?' on':'')+'" data-r="daily" role="radio" aria-checked="'+(rep==='daily')+'">每天</button>'+
            '<button type="button" class="tap'+(rep==='weekly'?' on':'')+'" data-r="weekly" role="radio" aria-checked="'+(rep==='weekly')+'">按星期</button>'+
            '<button type="button" class="tap'+(rep==='once'?' on':'')+'" data-r="once" role="radio" aria-checked="'+(rep==='once')+'">一次</button>'+
          '</div>'+
          '<div class="adwk'+(rep==='weekly'?' on':'')+'"><div class="adwki">'+wkBtns+'</div></div>'+
        '</div>'+
        '<div class="adpane'+(F.mode==='interval'?' on':'')+'" data-p="interval">'+
          '<div class="adchips">'+ivChips+'</div>'+
          '<div class="adnum"><span>每</span><input id="adIvV" type="number" inputmode="numeric" min="1" max="10080" value="'+F.ivVal+'" aria-label="循环间隔">'+
            '<div class="adunit"><button type="button" class="tap'+(F.ivUnit==='m'?' on':'')+'" data-iu="m">分钟</button><button type="button" class="tap'+(F.ivUnit==='h'?' on':'')+'" data-iu="h">小时</button></div>'+
          '</div>'+
          '<div class="adprob adquiet'+(F.quietOn?' on':'')+'"><button class="adpt tap" type="button" role="switch" aria-checked="'+(!!F.quietOn)+'" data-c="quiett"><span>免打扰时段</span><em id="adQv">'+qs+'–'+qe+'</em><i class="adsw"></i></button><div class="adpw"><div class="adpi"><div class="adqrow"><input id="adQs" type="time" value="'+qs+'" aria-label="免打扰开始"><span>至</span><input id="adQe" type="time" value="'+qe+'" aria-label="免打扰结束"></div><small>此时段内不响，顺延到结束时刻</small></div></div></div>'+
        '</div>'+
        '<div class="adhint" id="adHint" aria-live="polite"></div>'+
        '<div class="adprob'+(pr?' on':'')+'"><button class="adpt tap" type="button" role="switch" aria-checked="'+(!!pr)+'" data-c="probt"><span>按概率响</span><em id="adPv">'+(pr||50)+'%</em><i class="adsw"></i></button><div class="adpw"><div class="adpi"><input id="adProb" type="range" min="5" max="95" step="5" value="'+(pr||50)+'" aria-label="响的概率"><small>没中就跳过这次；循环的下次再掷，一次的作废</small></div></div></div>'+
        '<div class="adnote"><textarea id="adNote" rows="3" maxlength="500" placeholder="备注（可选），到点会一起告诉他" aria-label="备注">'+esc(note)+'</textarea><small id="adCnt">0/500</small></div>'+
        '<div class="adact">'+(e?'<button class="adrm tap" type="button" data-c="del">删除</button>':'')+'<button class="adok tap" type="button" data-c="save">保存</button></div>';
    }
    function syncChips(attr,totalMin){
      var bs=view.querySelectorAll('['+attr+']');
      for(var i=0;i<bs.length;i++) bs[i].classList.toggle('on',Number(bs[i].getAttribute(attr))===totalMin);
    }
    function readForm(){
      var mode=F.mode;
      if(mode==='after'){
        var av=view.querySelector('#adAfterV'), n=Math.round(Number(av&&av.value));
        var mins=(isFinite(n)&&n>=1)?(F.afterUnit==='h'?n*60:n):0;
        if(mins<1||mins>10080) return {err:'请输入 1 分钟到 7 天以内的时长'};
        var d=new Date(Date.now()+mins*60000);
        return {repeat:'once', at:d, mins:mins};
      }
      if(mode==='interval'){
        var iv=view.querySelector('#adIvV'), n2=Math.round(Number(iv&&iv.value));
        var mins2=(isFinite(n2)&&n2>=1)?(F.ivUnit==='h'?n2*60:n2):0;
        if(mins2<1||mins2>10080) return {err:'循环间隔需在 1 分钟到 7 天之间'};
        var qsEl=view.querySelector('#adQs'), qeEl=view.querySelector('#adQe');
        var qs=F.quietOn&&qsEl?qsEl.value:'', qe=F.quietOn&&qeEl?qeEl.value:'';
        var d2=new Date(Date.now()+mins2*60000);
        if(qs&&qe&&qs!==qe) d2=ALT.adjustQuiet(d2,qs,qe);
        return {repeat:'interval', at:d2, intervalMin:mins2, quietStart:(qs&&qe&&qs!==qe)?qs:'', quietEnd:(qs&&qe&&qs!==qe)?qe:''};
      }
      var t=view.querySelector('#adTime'), sg=view.querySelector('.adseg');
      var rep=sg?sg.getAttribute('data-v'):'daily';
      if(rep==='weekly'){
        if(!F.days.length) return {err:'至少选一天'};
        var dw=ALT.nextWeeklyAt(t&&t.value,F.days);
        if(!dw) return {err:'先选个时间'};
        return {repeat:'weekly', at:dw, days:F.days.slice()};
      }
      var d3=ALT.nextAt(t&&t.value);
      if(!d3) return {err:'先选个时间'};
      return {repeat:rep, at:d3};
    }
    function quietHitErr(rf){
      if(!rf||rf.err||rf.repeat!=='once'||!S.quietMin) return '';
      if(rf.at.getTime()-Date.now()<=S.quietMin*60000){
        return '当前「响铃前 '+S.quietMin+' 分钟聊过不响」，该时间在跳过范围内，请设更晚或在唤醒设置里调小';
      }
      return '';
    }
    function updateHint(){
      var h=view.querySelector('#adHint'); if(!h) return;
      var rf=readForm();
      if(rf.err){ h.className='adhint warn'; h.textContent=rf.err; return; }
      var qErr=quietHitErr(rf);
      if(qErr){ h.className='adhint warn'; h.textContent=qErr; return; }
      h.className='adhint';
      var w=ALT.dayWord(rf.at)+' '+ALT.pad(rf.at.getHours())+':'+ALT.pad(rf.at.getMinutes());
      if(F.mode==='after'){
        h.textContent='预计 '+w+' 响一次';
      }else if(rf.repeat==='daily'){
        h.textContent='每天 '+ALT.pad(rf.at.getHours())+':'+ALT.pad(rf.at.getMinutes())+'，下一次 '+w;
      }else if(rf.repeat==='weekly'){
        h.textContent=ALT.formatDays(rf.days)+' '+ALT.pad(rf.at.getHours())+':'+ALT.pad(rf.at.getMinutes())+'，下一次 '+w;
      }else if(rf.repeat==='interval'){
        var qtxt=(rf.quietStart&&rf.quietEnd)?('（'+rf.quietStart+'–'+rf.quietEnd+' 免打扰）'):'';
        h.textContent=ALT.formatInterval(rf.intervalMin)+'循环'+qtxt+'，下一次 '+w;
      }else{
        h.textContent=w+' 响一次';
      }
    }
    function updateCnt(){ var ta=view.querySelector('#adNote'), c=view.querySelector('#adCnt'); if(ta&&c) c.textContent=ta.value.length+'/500'; }
    function showList(animate){
      S.mode='list'; S.editing=null;
      if(animate) swap(listHtml()); else view.innerHTML=listHtml();
      startTick();
    }
    function showForm(item){
      S.mode='form'; S.editing=item||null;
      swap(formHtml(),function(){ updateHint(); updateCnt(); });
    }
    function startTick(){
      if(S.tick) return;
      S.tick=setInterval(function(){
        if(!ov.isConnected||S.closed){ clearInterval(S.tick); S.tick=0; return; }
        var els=view.querySelectorAll('.adcd');
        for(var i=0;i<els.length;i++){ var t=ALT.cdBig(Number(els[i].getAttribute('data-at'))); if(els[i].textContent!==t) els[i].textContent=t; }
      },1000);
    }
    function load(){
      P.net.get('/heartbeat/v1/sleep-wake',{noLogin:true}).then(function(cfg){
        if(!S.closed&&cfg&&cfg.userAlarmQuietMin!==undefined) S.quietMin=Number(cfg.userAlarmQuietMin)||0;
      },function(){});
      return P.net.get('/heartbeat/admin/wake-alarms?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(j){
        if(S.closed) return;
        if(j&&j.ok===false) throw new Error('bad');
        S.items=ALT.parse(j); S.loaded=true; S.err=false;
      },function(){ if(S.closed) return; S.loaded=true; S.err=true; });
    }
    function afterChange(msg){
      buzz(8); if(msg) toast(msg);
      if(alarmApi) alarmApi.refresh();
      load().then(function(){ if(!S.closed) showList(true); });
    }
    function errText(e){ return (e&&e.body&&e.body.error)||'没成功，稍后再试'; }
    function save(btn){
      var rf=readForm();
      if(rf.err){ toast(rf.err); buzz([10,30,10]); return; }
      var qErr=quietHitErr(rf);
      if(qErr){ toast(qErr); buzz([10,30,10]); return; }
      var ta=view.querySelector('#adNote'), pb=view.querySelector('.adprob:not(.adquiet)'), pi=view.querySelector('#adProb');
      if(S.busy) return; S.busy=true; btn.disabled=true; btn.classList.add('busy');
      var body={
        session_id:sid, at:rf.at.toISOString(), repeat:rf.repeat,
        note:ta?ta.value:'', prob:(pb&&pb.classList.contains('on')&&pi)?+pi.value:null
      };
      if(rf.repeat==='weekly') body.days=rf.days;
      if(rf.repeat==='interval'){
        body.intervalMin=rf.intervalMin;
        body.quietStart=rf.quietStart||'';
        body.quietEnd=rf.quietEnd||'';
      }
      var url='/heartbeat/admin/wake-alarms/add';
      if(S.editing){ url='/heartbeat/admin/wake-alarms/update'; body.alarm_id=S.editing.key.slice(2); }
      var wasEdit=!!S.editing;
      P.net.req(url,{method:'POST',body:body}).then(function(j){
        S.busy=false; if(S.closed) return;
        if(j&&j.ok===false){ btn.disabled=false; btn.classList.remove('busy'); toast(j.error||'没成功，稍后再试'); return; }
        afterChange(wasEdit?'已保存':'闹钟设好了');
      },function(e){ S.busy=false; if(S.closed) return; btn.disabled=false; btn.classList.remove('busy'); toast(errText(e)); });
    }
    function drop(key,btn,after){
      if(S.busy) return; S.busy=true; if(btn) btn.disabled=true;
      var isSlot=key==='slot';
      P.net.req(isSlot?'/heartbeat/admin/wake-alarms/slot/clear':'/heartbeat/admin/wake-alarms/delete',
        {method:'POST',body:isSlot?{session_id:sid}:{session_id:sid,alarm_id:key.slice(2)}}).then(function(j){
        S.busy=false; if(S.closed) return;
        if(j&&j.ok===false){ if(btn) btn.disabled=false; toast(j.error||'没成功，稍后再试'); return; }
        after();
      },function(e){ S.busy=false; if(btn) btn.disabled=false; if(!S.closed) toast(errText(e)); });
    }

    ov.querySelector('.scrim').addEventListener('click',close);
    ov.addEventListener('click',function(e){
      var md=e.target.closest('.admode [data-m]');
      if(md){
        var m=md.getAttribute('data-m'); if(F.mode===m) return;
        F.mode=m; buzz(5);
        var box=md.parentNode; box.setAttribute('data-m',m);
        Array.prototype.forEach.call(box.children,function(b){ var on=b===md; b.classList.toggle('on',on); b.setAttribute('aria-selected',on?'true':'false'); });
        var panes=view.querySelectorAll('.adpane');
        for(var pi2=0;pi2<panes.length;pi2++) panes[pi2].classList.toggle('on',panes[pi2].getAttribute('data-p')===m);
        updateHint(); return;
      }
      var ac=e.target.closest('[data-ac]');
      if(ac){
        var mins=Number(ac.getAttribute('data-ac')); buzz(5);
        var av=view.querySelector('#adAfterV');
        if(mins>=60&&mins%60===0){ F.afterVal=mins/60; F.afterUnit='h'; } else { F.afterVal=mins; F.afterUnit='m'; }
        if(av) av.value=F.afterVal;
        var aus=view.querySelectorAll('[data-au]');
        for(var u1=0;u1<aus.length;u1++) aus[u1].classList.toggle('on',aus[u1].getAttribute('data-au')===F.afterUnit);
        syncChips('data-ac',mins); updateHint(); return;
      }
      var au=e.target.closest('[data-au]');
      if(au){
        var u=au.getAttribute('data-au'); if(F.afterUnit===u) return;
        F.afterUnit=u; buzz(4);
        var aus2=view.querySelectorAll('[data-au]');
        for(var u2=0;u2<aus2.length;u2++) aus2[u2].classList.toggle('on',aus2[u2]===au);
        var av2=view.querySelector('#adAfterV'), curM=(Number(av2&&av2.value)||0)*(u==='h'?60:1);
        syncChips('data-ac',curM); updateHint(); return;
      }
      var ic=e.target.closest('[data-ic]');
      if(ic){
        var imins=Number(ic.getAttribute('data-ic')); buzz(5);
        var iv=view.querySelector('#adIvV');
        if(imins>=60&&imins%60===0){ F.ivVal=imins/60; F.ivUnit='h'; } else { F.ivVal=imins; F.ivUnit='m'; }
        if(iv) iv.value=F.ivVal;
        var ius=view.querySelectorAll('[data-iu]');
        for(var u3=0;u3<ius.length;u3++) ius[u3].classList.toggle('on',ius[u3].getAttribute('data-iu')===F.ivUnit);
        syncChips('data-ic',imins); updateHint(); return;
      }
      var iu=e.target.closest('[data-iu]');
      if(iu){
        var u4=iu.getAttribute('data-iu'); if(F.ivUnit===u4) return;
        F.ivUnit=u4; buzz(4);
        var ius2=view.querySelectorAll('[data-iu]');
        for(var u5=0;u5<ius2.length;u5++) ius2[u5].classList.toggle('on',ius2[u5]===iu);
        var iv2=view.querySelector('#adIvV'), curIM=(Number(iv2&&iv2.value)||0)*(u4==='h'?60:1);
        syncChips('data-ic',curIM); updateHint(); return;
      }
      var wd=e.target.closest('[data-wd]');
      if(wd){
        var day=Number(wd.getAttribute('data-wd')), idx=F.days.indexOf(day);
        if(idx>=0){
          if(F.days.length<=1){ buzz([10,20,10]); return; }
          F.days.splice(idx,1); wd.classList.remove('on'); wd.setAttribute('aria-pressed','false');
        }else{
          F.days.push(day); F.days.sort(function(a,b){ return a-b; });
          wd.classList.add('on'); wd.setAttribute('aria-pressed','true');
        }
        buzz(4); updateHint(); return;
      }
      var seg=e.target.closest('[data-r]');
      if(seg){
        var sg=seg.parentNode, v=seg.getAttribute('data-r'); if(sg.getAttribute('data-v')===v) return;
        sg.setAttribute('data-v',v); buzz(5);
        Array.prototype.forEach.call(sg.children,function(b){ var on=b===seg; b.classList.toggle('on',on); b.setAttribute('aria-checked',on?'true':'false'); });
        var wk=view.querySelector('.adwk'); if(wk) wk.classList.toggle('on',v==='weekly');
        updateHint(); return;
      }
      var c=e.target.closest('[data-c]');
      if(c){
        var k=c.getAttribute('data-c');
        if(k==='probt'){ var pw=c.closest('.adprob'), on=!pw.classList.contains('on'); pw.classList.toggle('on',on); c.setAttribute('aria-checked',on?'true':'false'); buzz(5); }
        else if(k==='quiett'){ var qw=c.closest('.adquiet'), qon=!qw.classList.contains('on'); F.quietOn=qon; qw.classList.toggle('on',qon); c.setAttribute('aria-checked',qon?'true':'false'); buzz(5); updateHint(); }
        else if(k==='add'){ buzz(5); showForm(null); }
        else if(k==='back'){ buzz(4); showList(true); }
        else if(k==='save'){ save(c); }
        else if(k==='del'){ var it=S.editing; if(it) drop(it.key,c,function(){ afterChange('已删除'); }); }
        else if(k==='cancel'){
          var li=c.closest('.adi'); if(!li) return; var key=li.getAttribute('data-k');
          drop(key,c,function(){
            buzz(8); li.classList.add('rm');
            S.items=S.items.filter(function(x){ return x.key!==key; });
            if(alarmApi) alarmApi.refresh();
            setTimeout(function(){ if(!S.closed&&S.mode==='list') showList(true); },190);
          });
        }
        return;
      }
      var row=e.target.closest('.adi.mine');
      if(row){ var key2=row.getAttribute('data-k'), item=null; for(var i=0;i<S.items.length;i++) if(S.items[i].key===key2) item=S.items[i]; if(item){ buzz(5); showForm(item); } }
    });
    ov.addEventListener('input',function(e){
      var id=e.target.id;
      if(id==='adTime') updateHint();
      else if(id==='adAfterV'){ F.afterVal=Number(e.target.value)||0; syncChips('data-ac',F.afterVal*(F.afterUnit==='h'?60:1)); updateHint(); }
      else if(id==='adIvV'){ F.ivVal=Number(e.target.value)||0; syncChips('data-ic',F.ivVal*(F.ivUnit==='h'?60:1)); updateHint(); }
      else if(id==='adQs'||id==='adQe'){
        var qv=view.querySelector('#adQv'), s1=view.querySelector('#adQs'), e1=view.querySelector('#adQe');
        if(qv&&s1&&e1) qv.textContent=(s1.value||'23:00')+'–'+(e1.value||'08:00');
        updateHint();
      }
      else if(id==='adNote') updateCnt();
      else if(id==='adProb'){ var pv=view.querySelector('#adPv'); if(pv) pv.textContent=e.target.value+'%'; }
    });
    ov.addEventListener('keydown',function(e){
      if(e.key==='Escape'){ close(); return; }
      if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('adi')&&e.target.classList.contains('mine')){ e.preventDefault(); e.target.click(); }
    });

    showList(false);
    load().then(function(){ if(!S.closed&&S.mode==='list') showList(true); });
  }

  /* [位置:phone-talk.js·alarmBall] [闹钟浮球] [11-06：AI 用 wake 工具 / <wake> 标签给本会话设的闹钟，聊天页右边一颗玻璃球（闹钟图标 + 右上角一个点）提示有闹钟，时间只在面板里看；
     点开是本会话全部闹钟（工具闹钟 + 旧标签单槽），各自倒计时、可单独取消（等同 AI 的 wake delete）；有新增或时间改动才亮那个点，点开即消；
     最后一个闹钟取消或到点后整个球缩掉；位置与文件球共用一列（BALLCOL），拖任一颗整列一起走] [注释时间 2026-11-06] */
  var alarmPing=null;
  (function(){
    var ball=$('#tkAlarm',win), panel=$('#tkAlarmP',win);
    if(!ball||!panel) return;
    var BW=40;
    var C={items:[],sig:'',sid:null,open:false,dot:false,tm:0,tick:0,loading:false};
    var dotEl=ball.querySelector('.dot');
    /* [位置:phone-talk.js·alarmBall 未读点] [右上角那个点按「已读到哪一版」算] [11-06：原来靠内存里上一次的清单比对，页面开着时先同步到空列表、C.sig 被清空，之后设闹钟就永远不打点（她实测「没有小点」）；改成把已读签名按会话记在本机，页面先空后有、刷新、换设备都能正确亮；这个会话第一次见时把存量当已读，不打点] [注释时间 2026-11-06] */
    var SEEN_KEY='ph.alarmball.seen';
    function seenAll(){
      try{ var o=JSON.parse(localStorage.getItem(SEEN_KEY)||'{}'); return (o&&typeof o==='object'&&o)?o:{}; }catch(e){ return {}; }
    }
    function seenSet(sid,sig){
      if(!sid) return;
      try{
        var o=seenAll(); o[sid]=String(sig||'');
        var ks=Object.keys(o); if(ks.length>20) ks.slice(0,ks.length-20).forEach(function(k){ delete o[k]; });
        localStorage.setItem(SEEN_KEY,JSON.stringify(o));
      }catch(e){}
    }

    function par(){ return ball.offsetParent||host; }
    function claimOn(){ var c=$('#tkClaim',win); return !!(c&&!c.hidden); }
    /* 列底是文件球：文件球在的时候闹钟球叠在它上面（球高 + 6px 间距），文件球不在就自己占列底 */
    function ownBottom(){ return BALLCOL.homeBottom(par()) + (claimOn()?BW+BALLCOL.GAP:0); }
    function applyPos(){
      var p=par(); if(!p) return;
      ball.style.left=Math.round(BALLCOL.homeLeft(p))+'px';
      ball.style.bottom=Math.round(Math.max(8,Math.min(ownBottom(),p.clientHeight-BW-8)))+'px';
      /* 文件球双击撑宽时它自己让到面板角落，闹钟球留在原地会被宽面板盖住：这时先淡出，缩回后自动回来 */
      var cb=$('#tkClaim',win);
      ball.classList.toggle('parked-out', !!(cb&&cb.classList.contains('parked'))&&!C.open);
      if(C.open) placePanel();
    }
    var pad=ALT.pad, cdBig=ALT.cdBig, whenText=ALT.whenText;   /* 共用工具在上面的 ALT（弹窗也用） */
    function panelW(){ var p=par(); return Math.min(248,Math.max(196,(p?p.clientWidth:390)-24)); }
    /* 面板站在球的另一侧：球在右半屏 → 面板往左长；球在左半屏 → 往右长；垂直对齐球底并夹在屏内 */
    function placePanel(){
      var p=par(); if(!p||panel.hidden) return;
      var pw=panelW(), ph=panel.offsetHeight||120;
      var bl=parseFloat(ball.style.left); if(!isFinite(bl)) bl=BALLCOL.homeLeft(p);
      var bb=parseFloat(ball.style.bottom); if(!isFinite(bb)) bb=8;
      panel.style.width=pw+'px'; panel.style.right='';
      var L;
      if(bl+BW/2>=p.clientWidth/2){
        L=bl-pw-10; panel.classList.add('lr');
        if(L<6) L=Math.min(bl+BW+10,p.clientWidth-pw-8);
      } else {
        L=bl+BW+10; panel.classList.remove('lr');
        if(L+pw>p.clientWidth-8) L=Math.max(6,bl-pw-10);
      }
      panel.style.left=Math.round(Math.max(6,Math.min(L,p.clientWidth-pw-6)))+'px';
      panel.style.bottom=Math.round(Math.max(8,Math.min(bb,p.clientHeight-ph-8)))+'px';
    }
    /* [位置:phone-talk.js·alarmBall 收纳] [小球可以收进「…」按钮] [11-09：把小球拖到右上角「…」按钮上松手 = 收进去（本机记着，全局一个，之后不再出现）；收纳后他又设了新闹钟，「…」上亮一个小红点，进闹钟弹窗后消；
       菜单里长按「闹钟」项往外拖 = 变回小球（pullOut）。小球只反映他设的闹钟，她自己设的每天闹钟不挂小球；11-16 吸入/靠近改走共用 moreStow，「…」红点与文件球 OR] [注释时间 2026-11-16] */
    var STOW_KEY='ph.alarmball.stowed';
    var stow=moreStow(ball);
    function isStowed(){ try{ return localStorage.getItem(STOW_KEY)==='1'; }catch(e){ return false; } }
    function setStowed(b){ try{ if(b) localStorage.setItem(STOW_KEY,'1'); else localStorage.removeItem(STOW_KEY); }catch(e){} setDot(C.dot); }
    /* 未读点：小球在外面时点在球上，收纳后点在「…」上；「…」的点与文件球共用，各清各的 */
    function setDot(on){
      C.dot=!!on; var st=isStowed();
      dotEl.hidden=!(C.dot&&!st);
      setMoreDot('alarm',C.dot&&st);
    }
    function paintBall(){
      if(!C.items.length) return;
      if(isStowed()){ ball.hidden=true; setDot(C.dot); return; }
      ball.hidden=false; ball.classList.remove('out');
      setDot(C.dot);
      ball.setAttribute('aria-label','闹钟 '+C.items.length+' 个');
    }
    function paint(){
      var it=C.items;
      panel.innerHTML='<div class="ch"><b>闹钟</b><i class="cn">'+it.length+'</i></div>'+
        '<ul class="al">'+it.map(function(a){
          return '<li class="ai" data-id="'+esc(a.key)+'">'+
            '<span class="lb">'+esc(a.label||'闹钟')+'</span>'+
            '<i class="cd" data-at="'+Number(a.at)+'">'+esc(cdBig(a.at))+'</i>'+
            '<button class="ax tap" type="button" data-c="cancel" aria-label="取消闹钟">'+I.sclose+'</button>'+
            '<span class="aw">'+esc(whenText(a))+'</span>'+
          '</li>';
        }).join('')+'</ul>';
      panel.hidden=false;
    }
    /* 面板开着时倒计时自己走：只改文字节点，不重绘列表 */
    function tick(){
      if(C.tick) return;
      C.tick=setInterval(function(){
        if(!win.isConnected){ clearInterval(C.tick); C.tick=0; return; }
        if(panel.hidden) return;
        var els=panel.querySelectorAll('.cd');
        for(var i=0;i<els.length;i++){
          var t=cdBig(Number(els[i].getAttribute('data-at')));
          if(els[i].textContent!==t) els[i].textContent=t;
        }
      },1000);
    }
    function bump(){ ball.classList.remove('pop'); void ball.offsetWidth; ball.classList.add('pop'); }
    function openPanel(){
      if(!C.items.length) return;
      for(var i=0;i<BALLS.length;i++){ if(BALLS[i].close!==closePanel){ try{ BALLS[i].close(); }catch(e){} } }
      C.open=true; setDot(false); seenSet(C.sid,C.sig);   /* 点开过一回 = 已读，除非再更新 */
      paint(); placePanel(); ball.setAttribute('aria-expanded','true');
      requestAnimationFrame(function(){ if(C.open) panel.classList.add('on'); });
      tick();
    }
    function closePanel(){
      if(!C.open) return;
      C.open=false; panel.classList.remove('on'); ball.setAttribute('aria-expanded','false');
      if(C.tick){ clearInterval(C.tick); C.tick=0; }
      setTimeout(function(){ if(!C.open) panel.hidden=true; },240);
    }
    /* 没有闹钟了：整个球缩掉（不是留个空球） */
    function hideAll(){
      closePanel();
      ball.classList.add('out');
      setTimeout(function(){ if(!C.items.length){ ball.hidden=true; ball.classList.remove('out'); } },220);
    }
    function clearAll(){ C.items=[]; C.sig=''; setDot(false); hideAll(); }
    function adopt(res){
      /* 小球只管「他设的」闹钟（工具闹钟 + 旧 <wake> 单槽）；她自己设的在「…」菜单的闹钟弹窗里看 */
      var list=ALT.parse(res).filter(function(x){ return x.by!=='user'; });
      if(!list.length){
        if(seenAll()[C.sid]===undefined) seenSet(C.sid,'');   /* 空列表也记一笔，之后再设闹钟才会亮 */
        if(C.items.length||!ball.hidden||C.sig) clearAll();
        return;
      }
      var sig=list.map(function(x){ return x.key+'@'+x.at; }).join(',');
      if(sig===C.sig){ paintBall(); return; }
      var seen=seenAll()[C.sid];
      C.sig=sig; C.items=list;
      paintBall(); applyPos();
      if(C.open){ paint(); placePanel(); seenSet(C.sid,sig); }   /* 面板正开着 = 正在看，直接算已读 */
      else if(seen===undefined){ setDot(true); bump(); seenSet(C.sid,sig); }   /* 本机第一次见这个会话（含刚上线这个功能）：有闹钟就算没看过，亮一次 */
      else if(sig!==seen){ setDot(true); bump(); }   /* 新增 / 时间改动 → 亮 */
      else { setDot(false); }
    }
    function sync(){
      if(!win.isConnected){ clearInterval(C.tm); return; }
      if(document.hidden) return;
      if(!LIVE.on||!LIVE.sid){ if(!ball.hidden||C.items.length) clearAll(); return; }
      if(C.loading) return;
      C.loading=true; var sid=LIVE.sid;
      if(C.sid!==sid){ C.sid=sid; C.sig=''; C.items=[]; setDot(false); ball.hidden=true; closePanel(); }
      P.net.get('/heartbeat/admin/wake-alarms?session_id='+encodeURIComponent(sid),{noLogin:true}).then(function(j){
        C.loading=false; if(!win.isConnected||LIVE.sid!==sid) return;
        if(j&&j.ok===false) return;
        adopt(j);
      },function(){ C.loading=false; });
    }
    /* 取消单个：工具闹钟走 delete，旧标签单槽走 slot/clear；效果等同 AI 自己删 */
    function cancel(key,btn){
      var sid=LIVE.sid; if(!sid) return;
      btn.disabled=true;
      var isSlot=key==='slot';
      P.net.req(isSlot?'/heartbeat/admin/wake-alarms/slot/clear':'/heartbeat/admin/wake-alarms/delete',
        {method:'POST',body:isSlot?{session_id:sid}:{session_id:sid,alarm_id:key.slice(2)}}).then(function(j){
        if(!win.isConnected) return;
        if(j&&j.ok===false){ btn.disabled=false; toast('没取消掉，稍后再试'); return; }
        buzz(8); toast('已取消这个闹钟');
        var li=panel.querySelector('.ai[data-id="'+key+'"]');
        if(li) li.classList.add('rm');
        C.items=C.items.filter(function(x){ return x.key!==key; });
        C.sig=C.items.map(function(x){ return x.key+'@'+x.at; }).join(',');
        setTimeout(function(){
          if(!win.isConnected) return;
          if(!C.items.length){ hideAll(); return; }
          paintBall(); if(C.open){ paint(); placePanel(); }
        },170);
      },function(){ btn.disabled=false; toast('没取消掉，稍后再试'); });
    }
    panel.addEventListener('click',function(e){
      var b=e.target.closest('[data-c]'); if(!b) return;
      var li=b.closest('.ai'); if(!li) return;
      if(b.getAttribute('data-c')==='cancel') cancel(li.getAttribute('data-id'),b);
    });
    /* 拖动：移动超过 5px 才算拖；松手换算回整列的 rb 写进共用记忆，文件球跟着一起走；
       拖到右上角「…」按钮附近会高亮（球缩小、按钮放大），在那里松手 = 吸进去收纳 */
    var DR={on:false,x0:0,y0:0,l0:0,b0:0,moved:false,id:-1,near:false};
    function dragMove(cx,cy){
      var dx=cx-DR.x0, dy=cy-DR.y0;
      if(!DR.moved){ if(Math.abs(dx)<5&&Math.abs(dy)<5) return; DR.moved=true; ball.classList.add('drag'); closePanel(); }
      var p=par(); if(!p) return;
      var minB=8+(claimOn()?BW+BALLCOL.GAP:0);   /* 别把列底拖到文件球放不下 */
      var l=Math.max(4,Math.min(p.clientWidth-BW-4,DR.l0+dx)), b=Math.max(minB,Math.min(p.clientHeight-BW-8,DR.b0-dy));
      ball.style.left=Math.round(l)+'px'; ball.style.bottom=Math.round(b)+'px';
      stow.setNear(DR,stow.nearMore());
    }
    /* 吸进「…」：共用 moreStow.absorb，结束后记下已收纳 */
    function absorb(){
      stow.absorb(function(){
        setStowed(true);
        ball.hidden=true; applyPos(); reflowBalls(applyPos);
      });
    }
    ball.addEventListener('pointerdown',function(e){
      if(e.button&&e.button!==0) return;
      DR.on=true; DR.moved=false; DR.near=false; DR.id=e.pointerId; DR.x0=e.clientX; DR.y0=e.clientY;
      var l0=parseFloat(ball.style.left), b0=parseFloat(ball.style.bottom);
      DR.l0=isNaN(l0)?ball.offsetLeft:l0; DR.b0=isNaN(b0)?ownBottom():b0;
      try{ ball.setPointerCapture(e.pointerId); }catch(_e){}
    });
    ball.addEventListener('pointermove',function(e){
      if(!DR.on||e.pointerId!==DR.id) return;
      dragMove(e.clientX,e.clientY);
    });
    function endDrag(e){
      if(!DR.on||(e&&e.pointerId!==DR.id)) return;
      DR.on=false; ball.classList.remove('drag');
      if(DR.moved){
        if(DR.near&&moreBtn){ DR.moved=false; DR.near=false; absorb(); return; }
        var p=par(), w=p?p.clientWidth:0;
        BALLCOL.save((w-BALLCOL.W)>0?ball.offsetLeft/(w-BALLCOL.W):1,
          (parseFloat(ball.style.bottom)||0)-(claimOn()?BW+BALLCOL.GAP:0));
        buzz(6);
      } else { if(C.open) closePanel(); else openPanel(); buzz(5); }
      stow.setNear(DR,false); DR.moved=false;
    }
    ball.addEventListener('pointerup',endDrag);
    ball.addEventListener('pointercancel',function(){ DR.on=false; DR.moved=false; ball.classList.remove('drag'); stow.setNear(DR,false); });
    /* 从菜单里的「闹钟」项长按拖出来：球在手指处飞出（从小放大），接着就是一次正常的拖动，松手落位或再吸回去 */
    function pullOut(x,y,pid){
      setStowed(false);
      if(!C.items.length){ toast('有闹钟后小球会出现'); return; }
      ball.classList.remove('menu-hide'); ball.classList.add('drag');
      paintBall();
      var p=par(), r=p.getBoundingClientRect();
      var l=Math.max(4,Math.min(p.clientWidth-BW-4,x-r.left-BW/2)), b=Math.max(8,Math.min(p.clientHeight-BW-8,r.bottom-y-BW/2));
      ball.style.left=Math.round(l)+'px'; ball.style.bottom=Math.round(b)+'px';
      ball.classList.remove('fly'); void ball.offsetWidth; ball.classList.add('fly');
      setTimeout(function(){ ball.classList.remove('fly'); },340);
      buzz(10);
      DR.on=true; DR.moved=true; DR.near=false; DR.id=pid; DR.x0=x; DR.y0=y; DR.l0=l; DR.b0=b;
      function mv(ev){ if(ev.pointerId===DR.id&&DR.on) dragMove(ev.clientX,ev.clientY); }
      function up(ev){ if(ev.pointerId!==DR.id) return; off(); endDrag(ev); }
      function off(){ document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); document.removeEventListener('pointercancel',up); }
      document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up); document.addEventListener('pointercancel',up);
    }
    /* 点球和面板以外的地方收起（不铺遮罩、不挡聊天） */
    win.addEventListener('pointerdown',function(e){
      if(!C.open) return;
      if(panel.contains(e.target)||ball.contains(e.target)) return;
      closePanel();
    },true);
    BALLS.push({close:closePanel, reflow:applyPos});
    BALLCOL.on(applyPos);
    alarmPing=sync;
    alarmApi={
      menuOpen:function(on){ ball.classList.toggle('menu-hide',!!on); if(on) closePanel(); },   /* 菜单开着小球淡出，关了淡入 */
      pullOut:pullOut,
      refresh:sync,
      markSeen:function(){ seenSet(C.sid,C.sig); setDot(false); }
    };
    if(window.ResizeObserver){ var ro2=new ResizeObserver(function(){ if(!win.isConnected){ ro2.disconnect(); return; } applyPos(); });
      var cp2=$('.tk-cp',win), at2=$('#tkAtt',win), sub2=$('#tkSub',win);
      ro2.observe(win); if(cp2) ro2.observe(cp2); if(at2) ro2.observe(at2); if(sub2) ro2.observe(sub2); }
    /* 文件球让到宽面板角落（class 变 parked）/ 显示隐藏时跟着重排或淡出 */
    if(window.MutationObserver){ var cb0=$('#tkClaim',win);
      if(cb0){ var mo2=new MutationObserver(function(){ if(!win.isConnected){ mo2.disconnect(); return; } applyPos(); });
        mo2.observe(cb0,{attributes:true,attributeFilter:['class','hidden']}); } }
    C.tm=setInterval(sync,6000); setTimeout(sync,900);
  })();

  P.talk={raw:function(){ rawPage(); },stk:function(){ stkPanel(); },card:function(){ cardSheet(); },more:moreMenu,state:statePage,cfg:function(){ var pg=host.querySelector('.tk-page'); stateCfg(pg); },drawer:drawer,av:avSheet,plus:plusOpen,
    hold:function(){ holdMode(true); recStart(); },mini:function(on){ host.classList.toggle('mini',on); },
    live:function(){ MSGS.push({k:'live'}); render(); },
    menu:function(i){ var bs=list.querySelectorAll('.b'); if(bs[i]) bubMenu(bs[i]); }};
}

P.register('talk',{html:html,setup:setup});
})();
