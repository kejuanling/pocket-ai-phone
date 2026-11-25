
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
# [位置:tests/ui/test_fold_long_ui.py] [聊天超长气泡收起/展开] [11-04] [注释时间 2026-11-04]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
PORT = 8911
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '收起', 'real': 4, 'total': 4, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
LONG = '\n\n'.join('第%d段：这是一条特别长的回复，用来测试超长内容的收起与展开，一段话大概有这么长这么长这么长。' % i for i in range(1, 25))
H = [('u1', 'user', '你好', '2026-10-20T10:00:00'), ('a1', 'assistant', LONG, '2026-10-20T10:02:00'),
     ('u2', 'user', LONG, '2026-10-20T10:03:00'), ('a2', 'assistant', '短回复', '2026-10-20T10:09:00')]
HIST = [{'id': i, 'role': r, 'content': c, 'time': t} for i, r, c, t in H]
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
        n = g("document.querySelectorAll('.win.tk-layer .b.foldable.folded').length")
        check(n == 1, '[%s] 只有我的超长气泡收起，AI 的不收 (%d)' % (style, n))
        check(g("document.querySelectorAll('.win.tk-layer .tk-fold').length") == 1, '[%s] 各有一颗展开按钮' % style)
        h = g("Math.max.apply(null,[].map.call(document.querySelectorAll('.win.tk-layer .b.folded>.fold-in'),e=>e.getBoundingClientRect().height))")
        check(h <= 301, '[%s] 收起高度 ≤300 (%.0f)' % (style, h))
        check(g("document.querySelectorAll('.win.tk-layer .b:not(.foldable)').length") >= 2, '[%s] 短消息不受影响' % style)
        g("document.querySelector('.win[data-win=chats]').style.display='none'")
        pg.screenshot(path='/tmp/fold_%s_closed.png' % style)
        pg.evaluate("document.querySelectorAll('.win.tk-layer .tk-fold')[0].click()"); pg.wait_for_timeout(300)
        check(g("document.querySelectorAll('.win.tk-layer .b.foldable.folded').length") == 0, '[%s] 点开后全展开' % style)
        check('收起' == g("document.querySelector('.win.tk-layer .tk-fold').textContent"), '[%s] 按钮变「收起」' % style)
        pg.screenshot(path='/tmp/fold_%s_open.png' % style)
        # 重画保持展开状态
        g("()=>0")
        pg.evaluate("document.querySelectorAll('.win.tk-layer .tk-fold')[0].click()"); pg.wait_for_timeout(300)
        check(g("document.querySelectorAll('.win.tk-layer .b.foldable.folded').length") == 1, '[%s] 再点收回' % style)
        check(not errs, '[%s] 无页面报错 %s' % (style, errs))
srv.terminate()
print('FAILED' if bad else 'ALL PASS'); sys.exit(1 if bad else 0)
