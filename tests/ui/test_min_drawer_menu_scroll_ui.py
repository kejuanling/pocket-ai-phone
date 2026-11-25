
def _project_root():
    import os
    from pathlib import Path
    env = os.environ.get("PROJECT_ROOT", "").strip()
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    for cand in [here, *here.parents]:
        if (cand / "package.json").exists():
            return cand
    raise RuntimeError("PROJECT_ROOT not found")
_ROOT = _project_root()
PROJECT_ROOT = str(_ROOT)
# [位置:tests/ui/test_min_drawer_menu_scroll_ui.py] [抽屉回归：三点菜单贴按钮锚点/抽屉内滚动条豁免/展开应用整行列表（11-20 晚两列栅格被用户否掉回退），日夜两版+气泡主题菜单位置回归] [11-20] [注释时间 2026-11-20]
import subprocess, time, re, os
from playwright.sync_api import sync_playwright
PORT = 8912
OUT = '/tmp/min_verify'; os.makedirs(OUT, exist_ok=True)
srv = subprocess.Popen(['python3','-m','http.server',str(PORT),'--bind','127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
bad = False
def check(c, m):
    global bad
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: bad = True
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width':390,'height':844})
    ctx.add_init_script("try{localStorage.setItem('ph_chat_style','min')}catch(e){}")
    pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo|diary)/.*'), lambda r: r.fulfill(status=200, content_type='application/json', body=('[]' if ('/diary/api/entries' in r.request.url or '/todo/api/todos' in r.request.url) else '{}')))
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2200)
    pg.evaluate("document.getElementById('lock').style.display='none'")
    check(pg.evaluate("!!(window.PH&&PH.minLayout&&PH.minLayout.on)"), 'min 布局激活')
    pg.evaluate("PH.minLayout.openDrawer()"); pg.wait_for_timeout(600)
    # 1. 菜单锚点
    pg.click('#mnMoreBtn'); pg.wait_for_timeout(450)
    r = pg.evaluate("(()=>{const m=document.querySelector('.cs-ov.cs-top .cs-menu'),btn=document.getElementById('mnMoreBtn');if(!m||!btn)return null;const a=m.getBoundingClientRect(),c=btn.getBoundingClientRect();return {dr:Math.abs(a.right-c.right),dt:Math.abs(a.top-(c.bottom+6))}})()")
    print('menu', r)
    check(r and r['dr']<=2 and r['dt']<=2, '菜单右上角贴按钮（右差%.1f 上差%.1f）' % (r['dr'], r['dt']) if r else '菜单没弹出来')
    pg.screenshot(path=OUT+'/menu_day.png')
    pg.click('.cs-ov.cs-top .scrim', position={'x':370,'y':700}); pg.wait_for_timeout(400)
    # 2. 展开区整行列表（回退后）
    pg.click('#mnMeMoreBtn'); pg.wait_for_timeout(600)
    g = pg.evaluate("(()=>{const box=document.querySelector('.mn-me-extra-in'),row=box.querySelector('.mn-me-row:not(.mn-me-fold)'),fold=document.getElementById('mnMeFoldBtn');const cs=getComputedStyle(box),rs=getComputedStyle(row);const bw=box.getBoundingClientRect().width,rw=row.getBoundingClientRect().width,fw=fold.getBoundingClientRect().width;return {disp:cs.display,fs:rs.fontSize,br:rs.borderRadius,bg:rs.backgroundColor,rowFull:Math.abs(rw-bw)<2,foldFull:Math.abs(fw-bw)<2,n:box.querySelectorAll('.mn-me-row:not(.mn-me-fold)').length}})()")
    print('list', g)
    check(g['disp']=='flex', '展开区整行纵排（非栅格）')
    check(g['fs']=='16px' and g['br']=='12px' and g['bg']=='rgba(0, 0, 0, 0)', '行样式回退：16px 圆角 12 无底色')
    check(g['rowFull'] and g['foldFull'], '应用行与收起键都占满整行')
    print('列表项数', g['n'])
    pg.screenshot(path=OUT+'/list_day.png')
    # 3. 滚动条豁免（注入假会话行撑高，真人滚轮）
    pg.evaluate("document.getElementById('csLs').insertAdjacentHTML('beforeend',Array(31).join('<div class=cs-it style=height:56px></div>'))")
    pg.wait_for_timeout(200)
    pg.mouse.move(150, 500); pg.mouse.wheel(0, 700); pg.wait_for_timeout(120); pg.mouse.wheel(0, 700); pg.wait_for_timeout(350)
    s1 = pg.evaluate("(()=>{const sc=document.getElementById('mnScroll');return {top:sc.scrollTop,bar:document.querySelector('.ph-sbar').classList.contains('on')}})()")
    print('expand-scroll', s1)
    check(s1['top']>0 and not s1['bar'], '展开态整页滚动：滚动了且无细条')
    pg.click('#mnMeFoldBtn'); pg.wait_for_timeout(600)
    pg.mouse.move(150, 500); pg.mouse.wheel(0, 700); pg.wait_for_timeout(120); pg.mouse.wheel(0, 700); pg.wait_for_timeout(350)
    s2 = pg.evaluate("(()=>{const sc=document.querySelector('.mn-chats .cs-sc');return {top:sc.scrollTop,bar:document.querySelector('.ph-sbar').classList.contains('on')}})()")
    print('list-scroll', s2)
    check(s2['top']>0 and not s2['bar'], '收起态会话列表滚动：滚动了且无细条')
    # 4. 夜间版
    pg.evaluate("document.getElementById('device').dataset.theme='dark'")
    pg.click('#mnMeMoreBtn'); pg.wait_for_timeout(600)
    gd = pg.evaluate("getComputedStyle(document.querySelector('.mn-me-extra-in .mn-me-row:not(.mn-me-fold)')).backgroundColor")
    print('dark bg', gd)
    check(gd=='rgba(0, 0, 0, 0)', '夜间行也无底色 %s' % gd)
    pg.screenshot(path=OUT+'/list_dark.png')
    pg.click('#mnMoreBtn'); pg.wait_for_timeout(450)
    pg.screenshot(path=OUT+'/menu_dark.png')
    check(not errs, '无页面错误 %s' % errs[:2])
    ctx.close()
    # 5. 回归：非 min（气泡默认）topMenu 仍钉右上
    ctx2 = b.new_context(viewport={'width':390,'height':844}); pg2 = ctx2.new_page()
    errs2 = []; pg2.on('pageerror', lambda e: errs2.append(str(e)))
    pg2.route(re.compile(r'.*/(v1|heartbeat|todo|diary)/.*'), lambda r: r.fulfill(status=200, content_type='application/json', body=('[]' if ('/diary/api/entries' in r.request.url or '/todo/api/todos' in r.request.url) else '{}')))
    pg2.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg2.wait_for_timeout(2200)
    pg2.evaluate("document.getElementById('lock').style.display='none'")
    check(pg2.evaluate("!document.documentElement.classList.contains('min-layout')"), '默认主题不进 min 布局')
    pg2.evaluate("(()=>{var P=window.PH,app=P.app('chats');var w=document.createElement('div');w.className='win';w.dataset.win='chats';w.style.zIndex=30;w.innerHTML=app.html();P.D.appendChild(w);app.setup(w);})()")
    pg2.wait_for_timeout(600)
    pg2.click('#csNew'); pg2.wait_for_timeout(450)
    r2 = pg2.evaluate("(()=>{const m=document.querySelector('.cs-ov.cs-top .cs-menu');if(!m)return null;const a=m.getBoundingClientRect(),d=document.getElementById('device').getBoundingClientRect();return {dr:d.right-a.right,inline:m.style.top||''}})()")
    print('bubble menu', r2)
    check(r2 and abs(r2['dr']-12)<=2 and r2['inline']=='', '气泡主题菜单仍在屏幕右上（right 12，无 inline 锚点）')
    check(not errs2, '气泡主题无页面错误 %s' % errs2[:2])
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if bad else 'ALL PASS')
