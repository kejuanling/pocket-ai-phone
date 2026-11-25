
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
# [位置:tests/ui/test_bubble_top_ui.py] [气泡样式新版面：每组上面一行「头像+名字」、AI 最宽 90%、我最宽 80%、一条一个气泡、没有头像/分气泡开关；时间线 5 分钟/5 小时+跨天；极简样式不受影响] [10-28] [注释时间 2026-10-28]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8904
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '气泡版面', 'real': 8, 'total': 8, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
LONG = '这是一条很长很长的 AI 回复。' * 12 + '\n\n第二段也在同一个气泡里，不会被按空行拆开。'
H = [
 ('u1', 'user', '你好', '2026-10-20T10:00:00'),
 ('a1', 'assistant', LONG, '2026-10-20T10:02:00'),
 ('u2', 'user', '第一条我说的', '2026-10-20T10:03:00'),
 ('u3', 'user', '连着的第二条我说的\n\n带空行也不拆', '2026-10-20T10:04:00'),
 ('a2', 'assistant', '短回复', '2026-10-20T10:09:00'),
 ('u4', 'user', '下午', '2026-10-20T14:30:00'),
 ('a3', 'assistant', '晚上了', '2026-10-20T20:00:00'),
 ('u5', 'user', '第二天', '2026-10-21T08:00:00')]
HIST = [{'id': i, 'role': r, 'content': c, 'time': t} for i, r, c, t in H]
def handler(route):
    u = route.request.url.replace('http://127.0.0.1:%d' % PORT, '').split('?')[0]
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history': return ok({'items': HIST, 'has_more': False})
    if u.endswith('/chat-settings'): return ok({'ok': True, 'data': {'cfg': {'ai_name': '小谢', 'user_name': '小涵'}}})
    if u.endswith('/session-archive'): return ok({'archived': []})
    if u.endswith('/session-pins'): return ok({'pins': []})
    if u.endswith('/wake-locked'): return ok({'sessions': []})
    if u.endswith('/session-names'): return ok({'names': {}})
    if u.endswith('/session-status'): return ok({'ok': True, 'status': {}})
    return ok({})
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
with sync_playwright() as p:
    b = p.chromium.launch()
    for style in ['bubble', 'min']:
        pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
        pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1000)
        pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=30; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); }""")
        pg.wait_for_timeout(1200)
        pg.evaluate("(s)=>{ if(window.PH.chatStyle&&PH.chatStyle.set) PH.chatStyle.set(s); }", 'min' if style == 'min' else 'bubble')
        pg.evaluate("()=>{var l=document.getElementById('lock'); if(l) l.style.display='none';}")
        pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2500)
        g = lambda js: pg.evaluate(js)
        stamps = g("Array.from(document.querySelectorAll('.win.tk-layer .stamp')).map(e=>e.textContent.trim())")
        print(style, 'stamps', stamps)
        check(len(stamps) == 5 and stamps[1] == '10:09' and stamps[2] == '14:30' and re.search(r'(今天|昨天|\d+月\d+日)', stamps[0]) and re.search(r'(今天|昨天|\d+月\d+日)', stamps[3]) and re.search(r'(今天|昨天|\d+月\d+日)', stamps[4]), '[%s] 时间线：首条带日期；满5分钟只显示时分；满5小时/跨天带日期' % style)
        check('10:02' not in ' '.join(stamps) and '10:03' not in ' '.join(stamps), '[%s] 5 分钟以内不显示时间' % style)
        if style == 'bubble':
            hd = g("Array.from(document.querySelectorAll('.win.tk-layer .tk-hd')).map(h=>({side:h.parentElement.className.includes('me')?'me':'ai', name:h.querySelector('.tk-un').textContent, av:!!h.querySelector('.av'), avw:h.querySelector('.av').getBoundingClientRect().width}))")
            print(hd)
            sides = [h['side'] for h in hd]
            check(sides == ['me', 'ai', 'me', 'ai', 'me', 'ai', 'me'], '[bubble] 头像行按组出现：连着的两条「我」只有一行（共 7 行）')
            check(all(h['av'] and h['avw'] > 20 for h in hd), '[bubble] 每行都有头像')
            check({h['name'] for h in hd if h['side'] == 'ai'} == {'小谢'} and {h['name'] for h in hd if h['side'] == 'me'} == {'小涵'}, '[bubble] 名字取自聊天设置 ai_name/user_name')
            r = g("""(()=>{const L=document.querySelector('.win.tk-layer .tk-msgs'), w=L.clientWidth-parseFloat(getComputedStyle(L).paddingLeft)-parseFloat(getComputedStyle(L).paddingRight);
               const ai=Array.from(document.querySelectorAll('.win.tk-layer .tk-g.ai .col'))[0].getBoundingClientRect(), me=Array.from(document.querySelectorAll('.win.tk-layer .tk-g.me .col'))[1].getBoundingClientRect();
               const aiG=document.querySelector('.win.tk-layer .tk-g.ai').getBoundingClientRect(), meG=Array.from(document.querySelectorAll('.win.tk-layer .tk-g.me'))[1].getBoundingClientRect();
               return {w:w, ai:ai.width, me:me.width, aiLeft:ai.left-aiG.left, meRight:meG.right-me.right}})()""")
            print(r)
            check(r['ai'] <= r['w'] * 0.9 + 1 and r['ai'] >= r['w'] * 0.85, '[bubble] 长回复撑到 AI 最大宽度 90%%（%.0f / %.0f）' % (r['ai'], r['w']))
            check(r['me'] <= r['w'] * 0.8 + 1, '[bubble] 我的气泡最宽 80%%（%.0f / %.0f）' % (r['me'], r['w']))
            check(r['aiLeft'] <= 1 and r['meRight'] <= 1, '[bubble] AI 靠左、我靠右')
            check(g("document.querySelectorAll('.win.tk-layer .b.tail').length") == 0 and g("document.querySelectorAll('.win.tk-layer .b.shaped').length") == 0 and g("getComputedStyle(document.querySelector('.win.tk-layer .tk-g.ai .b')).backgroundColor") != 'rgba(0, 0, 0, 0)', '[bubble] 气泡纯 CSS：没有 tail/shaped，背景色直接在气泡上')
            al = g("""(()=>{const aiG=document.querySelector('.win.tk-layer .tk-g.ai'); const hd=aiG.querySelector('.tk-hd .av').getBoundingClientRect(), bb=aiG.querySelector('.col>.b').getBoundingClientRect(); const meG=document.querySelector('.win.tk-layer .tk-g.me'); const mh=meG.querySelector('.tk-hd .av').getBoundingClientRect(), mb=meG.querySelector('.col>.b').getBoundingClientRect(); const L=document.querySelector('.win.tk-layer .tk-msgs'); return {aiAv:hd.left, aiB:bb.left, meAv:mh.right, meB:mb.right, pad:parseFloat(getComputedStyle(L).paddingLeft), gap:bb.top-hd.bottom}})()""")
            print(al)
            check(abs(al['aiAv'] - al['aiB']) <= 0.5 and abs(al['meAv'] - al['meB']) <= 0.5, '[bubble] 头像左边（我是右边）和气泡左边（右边）对齐')
            check(al['pad'] == 18 and al['gap'] >= 9, '[bubble] 气泡左右边距 18px；头像行与气泡的间距 %.0f' % al['gap'])
            nb = g("document.querySelectorAll('.win.tk-layer .tk-g.ai')[0].querySelectorAll('.col>.b').length")
            check(nb == 1, '[bubble] 一条消息一个气泡（带空行的长回复不拆）')
            nm = g("document.querySelectorAll('.win.tk-layer .tk-g.me')[1].querySelectorAll('.col>.b').length")
            check(nm == 2, '[bubble] 连着两条「我」：同一组、各一个气泡（带空行的那条不拆）')
            pg.evaluate("document.querySelector('.win[data-win=chats]').style.display='none'"); pg.screenshot(path='/tmp/bubble_top.png'); pg.evaluate("document.querySelector('.win[data-win=chats]').style.display=''")
            pg.evaluate("document.querySelector('#tkNm').click()"); pg.wait_for_timeout(700)
            txt = g("Array.from(document.querySelectorAll('.win.tk-layer .opt, .win.tk-layer .ses-pop')).map(e=>e.innerText).join(' ')")
            check('显示头像' not in txt and '分气泡' not in txt and '回车直接发送' in txt, '[bubble] 头像菜单里没有「显示头像」「分气泡」开关，回车发送还在')
            pg.keyboard.press('Escape')
        else:
            check(g("document.querySelectorAll('.win.tk-layer .tk-hd').length") == 0, '[min] 极简样式没有头像行（不受影响）')
        print(style, 'ERRORS', errs[:3]); check(not errs, '[%s] 无页面错误' % style)
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
