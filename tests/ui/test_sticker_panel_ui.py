
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
# [位置:tests/ui/test_sticker_panel_ui.py] [加号面板 / 表情包面板点开后不被自己收回（手机宽度和宽屏都测，消息很多的长会话）] [10-28：表情包面板点开飞快弹一下就收——被动 scroll 事件把它收了] [注释时间 2026-10-28]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8912
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '表情包', 'real': 60, 'total': 60, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
HIST = []
for i in range(30):
    HIST.append({'id': 'u%d' % i, 'role': 'user', 'content': '我说第%d句' % i, 'time': '2026-10-20T10:%02d:00' % i})
    HIST.append({'id': 'a%d' % i, 'role': 'assistant', 'content': '回复第%d句，写长一点长一点长一点' % i, 'time': '2026-10-20T10:%02d:30' % i})
STK = [{'id': str(i), 'desc': '表情%d' % i} for i in range(30)]
sent = []
def handler(route):
    req = route.request; full = req.url.replace('http://127.0.0.1:%d' % PORT, ''); u = full.split('?')[0]
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history': return ok({'items': HIST, 'has_more': False})
    if u == '/stickers/index.json': return ok(STK)
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
    b = p.chromium.launch()
    for w, h, tag in [(390, 844, 'phone'), (1180, 820, 'wide')]:
        pg = b.new_context(viewport={'width': w, 'height': h}).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'.*/(v1|heartbeat|stickers)/.*'), handler)
        pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1500)
        if tag == 'phone':
            pg.mouse.move(195, 760); pg.mouse.down(); pg.mouse.move(195, 500, steps=8); pg.mouse.move(195, 150, steps=8); pg.mouse.up(); pg.wait_for_timeout(1200)
            pg.click('.app-ic[data-app="chats"]'); pg.wait_for_timeout(1500)
        pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2500)
        on = lambda: pg.evaluate("document.querySelector('.win.tk-layer .content').classList.contains('plus-on')")
        pg.click('#tkPlusBtn'); pg.wait_for_timeout(900)
        check(on(), '[%s] 点加号：面板展开，过 0.9 秒还开着' % tag)
        pg.click('#tkPlus [data-p="stk"]'); pg.wait_for_timeout(1500)
        check(on() and pg.evaluate("document.querySelectorAll('#tkPlus .tk-stkg button').length") == 30, '[%s] 点「表情包」（加号面板开了 0.9 秒之后）：表情包面板保持打开，30 个表情都在' % tag)
        h2 = pg.evaluate("document.querySelector('#tkPlus').getBoundingClientRect().height")
        check(h2 > 200, '[%s] 表情包面板高度正常（%.0f）' % (tag, h2))
        pg.wait_for_timeout(1200); check(on(), '[%s] 再过一会儿仍开着' % tag)
        # 用户真的去滑消息区：触摸/滚轮仍然会收
        pg.mouse.move(w * (0.7 if tag == 'wide' else 0.5), 300); pg.mouse.wheel(0, 200); pg.wait_for_timeout(600)
        check(not on(), '[%s] 用滚轮/滑消息区：面板收起（该收的还收）' % tag)
        print(tag, 'ERRORS', errs[:2]); check(not errs, '[%s] 无页面错误' % tag)
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
