
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
# [位置:tests/ui/test_att_pick_ui.py] [加号菜单 图片/拍照/文件 选择器的属性：图片 image/* 多选；拍照 capture；文件 accept 只含文档类（没有 image/ video/，iOS 才会直接开文件浏览不弹中间那层系统菜单）] [10-28] [注释时间 2026-10-28]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8913
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '选择器', 'real': 2, 'total': 2, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
HIST = [{'id': 'u1', 'role': 'user', 'content': '你好', 'time': '2026-10-20T10:00:00'}, {'id': 'a1', 'role': 'assistant', 'content': '在', 'time': '2026-10-20T10:00:30'}]
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
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1180, 'height': 820}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1500)
    pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2200)
    def pick(k):
        pg.click('#tkPlusBtn'); pg.wait_for_timeout(700)
        with pg.expect_file_chooser(timeout=5000) as fc:
            pg.click('#tkPlus [data-p="%s"]' % k)
        attrs = pg.evaluate("(()=>{const L=document.querySelectorAll('body > input[type=file]'); const f=L[L.length-1]; return f?{accept:f.accept, multiple:f.multiple, capture:f.getAttribute('capture')}:null})()")
        pg.wait_for_timeout(200); return fc.value, attrs
    ch, a = pick('photo'); check(a and a['accept'] == 'image/*' and a['multiple'] and a['capture'] is None, '图片：accept=image/*，可多选，不带 capture（%s）' % a)
    ch, a = pick('cam'); check(a and a['capture'] == 'environment' and a['accept'] == 'image/*', '拍照：capture=environment（%s）' % a)
    ch, a = pick('file'); acc = (a or {}).get('accept', '')
    check(a and a['multiple'] and 'image/' not in acc and 'video/' not in acc and 'application/*' in acc and '.md' in acc, '文件：accept 只含文档类，没有 image/ video/（iOS 直接开文件浏览）：%s' % acc[:70])
    print('ERRORS', errs[:2]); check(not errs, '无页面错误')
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
