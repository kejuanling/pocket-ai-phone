
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
# [位置:tests/ui/test_trace_ui.py] [此刻 trace 小条折叠/展开/锁] [11-04] [注释时间 2026-11-04]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
PORT = 8911
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '收起', 'real': 4, 'total': 4, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
H = [('u1', 'user', '你好', '2026-10-20T10:00:00'), ('a1', 'assistant', '好，那你先去睡，明天再说。', '2026-10-20T10:02:00'),
     ('u2', 'user', '嗯', '2026-10-20T10:03:00'), ('a2', 'assistant', '晚安。', '2026-10-20T10:09:00')]
HIST = [{'id': i, 'role': r, 'content': c, 'time': t} for i, r, c, t in H]
HIST[1]['trace'] = {'scent': '烤栗子', 'moves': [{'name': '想念', 'dir': 'up', 'level': '轻微'}, {'name': '烦躁', 'dir': 'down', 'level': None}], 'want': '多聊一会', 'chose': '让她去睡', 'held': '没说「别走」', 'note': '她今天好像累了。'}
HIST[3]['trace'] = {'locked': True}
def handler(route):
    u = route.request.url.replace('http://127.0.0.1:%d' % PORT, '').split('?')[0]
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history': return ok({'items': HIST, 'has_more': False})
    if u.endswith('/chat-settings'): return ok({'ok': True, 'data': {'cfg': {}}})
    if u.endswith('/session-archive'): return ok({'archived': []})
    if u.endswith('/session-pins'): return ok({'pins': []})
    if u.endswith('/wake-locked'): return ok({'sessions': []})
    if u.endswith('/session-names'): return ok({'names': {}})
    if u.endswith('/session-status'): return ok({'ok': True, 'status': {}})
    return ok({})
bad = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: bad.append(m)
with sync_playwright() as p:
    b = p.chromium.launch()
    for style in ['bubble', 'min']:
        pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
        pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1000)
        pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=30; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); }""")
        pg.wait_for_timeout(1200)
        pg.evaluate("(s)=>{ if(window.PH.chatStyle&&PH.chatStyle.set) PH.chatStyle.set(s); }", style)
        pg.evaluate("()=>{var l=document.getElementById('lock'); if(l) l.style.display='none';}")
        pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2500)
        g = pg.evaluate
        if style == 'bubble':
            check(g("document.querySelectorAll('.win.tk-layer .tk-trace').length") == 0, '[bubble] 气泡皮肤没有消息下面一行')
            check(g("document.querySelectorAll('.win.tk-layer .tk-hd .tk-nt .tk-tri').length") == 2, '[bubble] 时间后面两个 ✦ 图标')
            check(g("document.querySelectorAll('.win.tk-layer .tk-tri.lk').length") == 1, '[bubble] lock 的图标不可点')
            check(g("document.querySelectorAll('.win.tk-layer .tk-trcard').length") == 0, '[bubble] 默认不展开')
            g("document.querySelector('.win.tk-layer .tk-tri:not(.lk)').click()"); pg.wait_for_timeout(300)
            tx = g("(document.querySelector('.win.tk-layer .tk-trcard')||{textContent:''}).textContent")
            check('烤栗子' in tx and '没说「别走」' in tx and '想念' in tx, '[bubble] 点开卡片有内容 (%s)' % tx)
            g("document.querySelector('.win[data-win=chats]').style.display='none'"); pg.wait_for_timeout(500)
            pg.screenshot(path='/tmp/trace_bubble_open.png')
            g("document.querySelector('.win[data-win=chats]').style.display=''")
            g("document.querySelector('.win.tk-layer .tk-tri:not(.lk)').click()"); pg.wait_for_timeout(300)
            check(g("document.querySelectorAll('.win.tk-layer .tk-trcard').length") == 0, '[bubble] 再点收起')
        else:
            check(g("document.querySelectorAll('.win.tk-layer .tk-trace').length") == 2, '[min] 两条 trace 小条')
            check(g("document.querySelectorAll('.win.tk-layer .tk-trace .trc.lk').length") == 1, '[min] lock 的只显示锁')
            g("document.querySelector('.win.tk-layer .tk-trace .trc.tap').click()"); pg.wait_for_timeout(300)
            tx = g("document.querySelector('.win.tk-layer .tk-trace .trb').textContent")
            check('忍住' in tx and '没说「别走」' in tx, '[min] 展开有内容')
            g("document.querySelector('.win.tk-layer .tk-trace .trc.tap').click()"); pg.wait_for_timeout(300)
            check(g("document.querySelectorAll('.win.tk-layer .tk-trace .trb').length") == 0, '[min] 再点收起')
        check(g("document.body.innerText.indexOf('<trace')") < 0, '[%s] 正文里没有 <trace 标签' % style)
        check(not errs, '[%s] 无页面报错 %s' % (style, errs))
srv.terminate()
print('FAILED' if bad else 'ALL PASS'); sys.exit(1 if bad else 0)
