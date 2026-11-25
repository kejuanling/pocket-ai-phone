
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
# [位置:tests/ui/test_av_divider_ui.py] [头像菜单：Claude 专属设置组 + 分割线，只在模型是 Claude 时显示] [11-04]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
PORT = 8912
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '菜单', 'real': 2, 'total': 2, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
HIST = [{'id': 'u1', 'role': 'user', 'content': '你好', 'time': '2026-10-20T10:00:00'}, {'id': 'a1', 'role': 'assistant', 'content': '嗨', 'time': '2026-10-20T10:01:00'}]
state = {'claude': True}
posts = []
def handler(route):
    u = route.request.url.replace('http://127.0.0.1:%d' % PORT, '').split('?')[0]
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history': return ok({'items': HIST, 'has_more': False})
    if u.endswith('/model-provider'): return ok({'effective_is_claude': state['claude'], 'follow_global': True})
    if u.endswith('/claude-thinking'): return ok({'effort': 'off'})
    if u.endswith('/claude-cache'):
        if route.request.method == 'POST': posts.append(('cache', route.request.post_data)); return ok({'ok': True})
        return ok({'long': True})
    if u.endswith('/time-tag-to-ai'):
        if route.request.method == 'POST': posts.append(('tt', route.request.post_data)); return ok({'ok': True})
        return ok({'time_tag_to_ai': None, 'follow_global': True, 'effective': True, 'global': True})
    if u.endswith('/elapsed-tag'):
        if route.request.method == 'POST': posts.append(('el', route.request.post_data)); return ok({'ok': True})
        return ok({'elapsed_tag_to_ai': False, 'follow_global': False, 'effective': False, 'global': True})
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
    for claude in (True, False):
        state['claude'] = claude
        pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
        pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1000)
        pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=30; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); }""")
        pg.wait_for_timeout(1200)
        pg.evaluate("()=>{var l=document.getElementById('lock'); if(l) l.style.display='none';}")
        pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2000)
        pg.evaluate("document.querySelector('.win[data-win=chats]').style.display='none'")
        pg.evaluate("document.querySelector('#tkAv').click()"); pg.wait_for_timeout(1500)
        vis = lambda sel: pg.evaluate("(s)=>{var e=document.querySelector(s); if(!e) return null; var r=e.getBoundingClientRect(); return getComputedStyle(e).display!=='none' && r.width>0}", sel)
        tag = 'Claude' if claude else '非Claude'
        check(pg.evaluate("document.querySelector('#tkGrp').classList.contains('cl')") == claude, '[%s] 分组线 %s' % (tag, '显示' if claude else '隐藏'))
        check(vis('#tkCtRow') == claude and vis('#tkCcRow') == claude, '[%s] 思考/缓存行 %s' % (tag, '显示' if claude else '隐藏'))
        if claude:
            ys = pg.evaluate("['#tkMd','#tkCt','#tkCc','#tkTh'].map(function(s){var e=document.querySelector(s); return Math.round(e.getBoundingClientRect().top)})")
            check(ys == sorted(ys), '[Claude] 顺序：模型 → 思考 → 缓存 → 聊天主题 %s' % ys)
            on = lambda sel: pg.evaluate("(s)=>document.querySelector(s).classList.contains('on')", sel)
            check(on('#tkCcRow'), '[Claude] 加强缓存开关读到会话已开')
            check(on('#tkTt') and not on('#tkEl'), '[Claude] 时间缀=开(跟随默认)、距上一轮=关(会话明确关) 显示实际状态')
            check(pg.evaluate("document.querySelectorAll('.win.tk-layer .opt select').length") == 4, '[Claude] 下拉框只剩 设定/模型/Claude思考/聊天主题 四个')
            pg.evaluate("document.querySelector('#tkTt').click()"); pg.wait_for_timeout(300)
            pg.evaluate("document.querySelector('#tkEl').click()"); pg.wait_for_timeout(300)
            pg.evaluate("document.querySelector('#tkCcRow').click()"); pg.wait_for_timeout(300)
            check(('tt', '{"time_tag_to_ai":false}') in posts, '[Claude] 时间缀关掉=存明确的关 %s' % posts)
            check(('el', '{"elapsed_tag_to_ai":null}') in posts, '[Claude] 距上一轮切回开(=全局默认)=存跟随默认 %s' % posts)
            check(('cache', '{"long":false}') in posts and not on('#tkCcRow'), '[Claude] 缓存开关关掉')
            pg.screenshot(path='/tmp/av_menu.png')
        check(not errs, '[%s] 无页面报错 %s' % (tag, errs))
srv.terminate()
print('FAILED' if bad else 'ALL PASS'); sys.exit(1 if bad else 0)
