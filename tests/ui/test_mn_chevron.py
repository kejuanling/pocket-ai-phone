
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
# [位置:tests/ui/test_mn_chevron.py] [工具组展开后，里面未展开的工具箭头不能跟着朝下] [10-28] [注释时间 2026-10-28]
import subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8899
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
bad = False
def check(c, m):
    global bad
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: bad = True
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2000)
    pg.evaluate("""document.body.insertAdjacentHTML('beforeend','<div id="t1" class="mn-row tool tools open"><button class="mn-h"><i class="mn-chv"></i></button><div class="mn-b"><div class="mn-row tool"><button class="mn-h"><i class="mn-chv"></i></button></div><div class="mn-row tool open"><button class="mn-h"><i class="mn-chv"></i></button></div></div></div>')""")
    tf = lambda sel: pg.evaluate("sel=>getComputedStyle(document.querySelector(sel)).transform", sel)
    outer = tf('#t1>.mn-h>.mn-chv'); closed = tf('#t1 .mn-b>.mn-row:nth-child(1)>.mn-h>.mn-chv'); opened = tf('#t1 .mn-b>.mn-row:nth-child(2)>.mn-h>.mn-chv')
    print(outer, closed, opened)
    check(outer == opened and outer != closed, '组展开：组箭头朝下；里面没展开的工具箭头保持朝右；里面展开的朝下')
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if bad else 'ALL PASS')
