
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
# [位置:tests/ui/test_theme_switch_ui.py] [头像菜单里切聊天主题：下拉选极简 → POST /v1/sessions/chat-style → 本会话聊天页重开成极简；选回跟随默认 → 再重开] [10-28] [注释时间 2026-10-28]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8905
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SID = 's_abcd_efgh'
SESS = [{'id': SID, 'name': '主题切换', 'real': 2, 'total': 2, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
HIST = [{'id': 'u1', 'role': 'user', 'content': '你好', 'time': '2026-10-20T10:00:00'}, {'id': 'a1', 'role': 'assistant', 'content': '我在', 'time': '2026-10-20T10:00:30'}]
posts = []
def handler(route):
    req = route.request; u = req.url.replace('http://127.0.0.1:%d' % PORT, '').split('?')[0]
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history': return ok({'items': HIST, 'has_more': False})
    if u == '/v1/sessions/chat-style': posts.append(json.loads(req.post_data)); return ok({'ok': True, 'style': posts[-1]['style']})
    if u.endswith('/chat-settings'): return ok({'ok': True, 'data': {'cfg': {}}})
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
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1000)
    pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=20; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); }""")
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>{var l=document.getElementById('lock'); if(l) l.style.display='none';}")
    g = lambda js: pg.evaluate(js)
    pg.click('#csLs .cs-it[data-id="%s"]' % SID); pg.wait_for_timeout(2200)
    check(g("!document.querySelector('.win.tk-layer .tkmin') && !!document.querySelector('.win.tk-layer .tk-hd')"), '起点：气泡主题（有头像行）')
    g("document.querySelector('#tkNm').click()"); pg.wait_for_timeout(800)
    check(g("!!document.querySelector('#tkTh')") and g("document.querySelector('#tkTh').value") == '', '头像菜单里有「聊天主题」，默认跟随默认')
    check([o for o in g("Array.from(document.querySelectorAll('#tkTh option')).map(o=>o.textContent)")] == ['跟随默认', '气泡', '极简'], '选项：跟随默认 / 气泡 / 极简')
    pg.select_option('#tkTh', 'min'); pg.wait_for_timeout(1800)
    check(posts and posts[-1] == {'session_id': SID, 'style': 'min'}, '选极简：发了 POST /v1/sessions/chat-style')
    check(g("PH.sessPref.styleOf('%s')" % SID) == 'min', '本机缓存的会话主题已更新')
    check(g("document.querySelectorAll('.win.tk-layer').length") == 1 and g("!!document.querySelector('.win.tk-layer .tkmin') || document.querySelector('.win.tk-layer').classList.contains('tkmin') || !!document.querySelector('.win.tk-layer.tkmin')"), '聊天页重开成极简主题')
    check(g("document.querySelectorAll('.win.tk-layer .tk-hd').length") == 0, '极简下没有头像行')
    g("document.querySelector('#tkNm').click()"); pg.wait_for_timeout(800)
    check(g("document.querySelector('#tkTh').value") == 'min', '再打开菜单：下拉显示当前是极简')
    pg.select_option('#tkTh', ''); pg.wait_for_timeout(1800)
    check(posts[-1] == {'session_id': SID, 'style': ''} and g("document.querySelectorAll('.win.tk-layer .tk-hd').length") > 0, '选跟随默认：清除后回到气泡')
    print('ERRORS', errs[:3]); check(not errs, '无页面错误')
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
