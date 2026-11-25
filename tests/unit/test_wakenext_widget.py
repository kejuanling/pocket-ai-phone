
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
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8895
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
state = {'wn': None}
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
def handler(route):
    u = route.request.url.split('?')[0].replace('http://127.0.0.1:%d' % PORT, '')
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u.endswith('/admin/env'): return ok({'uptime': 100, 'wakeStatus': '在线（上次心跳: x）', 'wake': {'dayWakeAfter': '120', 'nightWakeAfter': '240'}})
    if u.endswith('/admin/logs/wake-up'): return ok({'lines': []})
    if u == '/v1/wake-next': return ok(state['wn']) if state['wn'] else route.fulfill(status=500, body='{}')
    return ok({})
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), handler)
    def load(wn):
        state['wn'] = wn
        pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2500)
        return pg.evaluate("({cd:(document.getElementById('hwCd')||{}).textContent, small:(document.querySelector('.hw-hero .hw-tx small')||{}).textContent, gap:(document.getElementById('hwGap')||{}).textContent, pct:(document.getElementById('hwPct')||{}).textContent})")
    now = int(time.time() * 1000)
    iso = lambda ms: time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(ms / 1000))
    r = load({'ok': True, 'locked': 0, 'next': None, 'items': []}); print(r)
    check(r['cd'] == '--:--:--' and '没有锁定' in r['small'] and '锁定后' in r['gap'], 'no locked session: clear message, no fake countdown')
    r = load({'ok': True, 'locked': 1, 'next': {'kind': 'alarm', 'at': iso(now + 3725000), 'sid': 's', 'name': 'n', 'label': '看火', 'repeat': 'once'}, 'items': []}); print(r)
    check(re.match(r'01:0[12]:\d\d', r['cd'] or '') and '闹钟' in r['small'] and r['gap'] == '看火', 'alarm countdown ~1h02m + label')
    r = load({'ok': True, 'locked': 1, 'next': {'kind': 'cycle', 'at': iso(now + 600000), 'sid': 's', 'name': 'n', 'thr': 120}, 'items': []}); print(r)
    check(re.match(r'00:(09|10):\d\d', r['cd'] or '') and r['small'] == '距下次唤醒' and '日间 120' in r['gap'], 'cycle countdown ~10m')
    r = load(None); print(r)
    check(r['cd'] is not None, 'endpoint down: falls back without crashing')
    print('ERRORS', errs[:3]); b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
