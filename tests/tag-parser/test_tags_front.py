
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
PORT = 8894
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '标签测试', 'real': 5, 'total': 5, 'last_time': '2026-10-20T10:00:00', 'last_text': 'x'}]
A = "开头\n```\n<voice>代码里的语音</voice>\n<sticker id=\"12\"/>\n<todo>代码里的待办</todo>\n```\n结尾 <voice>真语音一句</voice>"
B = "| 标签 | 例子 |\n|---|---|\n| todo | <todo>买牛奶</todo> |\n\n行内 `<mood>开心</mood>` 然后<todo remind_at=\"2026-10-29 09:00\">真的待办</todo>尾巴<lovediary kind=\"letter\">私密日记正文</lovediary>"
HIST = [
 {'id': 'u1', 'role': 'user', 'content': '讲讲标签', 'time': '2026-10-20T10:00:00'},
 {'id': 'a1', 'role': 'assistant', 'content': A, 'time': '2026-10-20T10:00:30'},
 {'id': 'u2', 'role': 'user', 'content': '再来', 'time': '2026-10-20T10:01:00'},
 {'id': 'a2', 'role': 'assistant', 'content': B, 'time': '2026-10-20T10:01:30'}]
def handler(route):
    full = route.request.url.replace('http://127.0.0.1:%d' % PORT, '')
    u = full.split('?')[0]
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
    b = p.chromium.launch()
    for style in ['min', 'bub']:
        pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
        pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1000)
        pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=30; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); }""")
        pg.wait_for_timeout(1200)
        pg.evaluate("(s)=>{ if(window.PH.chatStyle&&PH.chatStyle.set) PH.chatStyle.set(s); }", style)
        pg.evaluate("()=>{var l=document.getElementById('lock'); if(l) l.style.display='none';}")
        pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2500)
        txt = pg.evaluate("Array.from(document.querySelectorAll('.win')).map(w=>w.innerText).join('\\n')")
        print('[%s] %s' % (style, txt[:50].replace('\n', ' ')))
        check('<voice>代码里的语音</voice>' in txt, '[%s] 代码块里的 <voice> 字面显示，不拆成语音气泡' % style)
        check('<todo>代码里的待办</todo>' in txt, '[%s] 代码块里的 <todo> 字面显示' % style)
        check('<todo>买牛奶</todo>' in txt, '[%s] 表格里的 <todo> 字面显示' % style)
        check('<mood>开心</mood>' in txt, '[%s] 行内反引号里的 <mood> 字面显示' % style)
        check('真的待办' not in txt and 'remind_at' not in txt, '[%s] 真的 <todo> 被剥掉' % style)
        check('私密日记正文' not in txt, '[%s] <lovediary> 新标签被剥掉' % style)
        vo = pg.evaluate("Array.from(document.querySelectorAll('.win .vbub')).map(e=>e.className).slice(0,6)")
        print('voice elems', vo)
        check('真语音一句</voice>' not in txt and len(vo) > 0, '[%s] 真的 <voice> 渲染成语音元素（不露标签）' % style)
        print('ERRORS', errs[:3])
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
