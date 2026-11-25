
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
# [位置:tests/ui/test_tkcap_ui.py] [「回答在这里中断 / 继续」卡片：极简风格下排在复制播放按钮下面、与正文同宽左对齐；气泡风格不受影响] [10-28] [注释时间 2026-10-28] [用真实 render 走一遍，历史消息末尾带中断标记]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8901
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '中断卡片', 'real': 4, 'total': 4, 'last_time': '2026-10-20T10:00:00', 'last_text': 'x'}]
LONG = '唤醒：新增 WAKE_MAX_TOOL_ROUNDS = 10 显式传入。10 轮打满那轮网关会强制逼模型收尾，正常情况不会报错；只有模型无视强制仍要工具时，才在回复尾部带「'
HIST = [
 {'id': 'u1', 'role': 'user', 'content': '讲讲', 'time': '2026-10-20T10:00:00'},
 {'id': 'a1', 'role': 'assistant', 'content': LONG + '\n\n（工具调用轮次已达上限，回答在此中断）', 'time': '2026-10-20T10:00:30'},
 {'id': 'u2', 'role': 'user', 'content': '再来', 'time': '2026-10-20T10:01:00'},
 {'id': 'a2', 'role': 'assistant', 'content': '正常的一条回复', 'time': '2026-10-20T10:01:30'}]
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
        n = pg.evaluate("document.querySelectorAll('.tk-cap').length")
        check(n == 1, '[%s] 中断卡片出现 1 张' % style)
        if style == 'min':
            r = pg.evaluate("""()=>{const cap=document.querySelector('.tk-cap'), col=cap.parentElement, kids=Array.from(col.children).map(e=>e.className.split(' ')[0]);
              const t=col.querySelector('.b').getBoundingClientRect(), c=cap.getBoundingClientRect(), a=col.querySelector('.mn-act').getBoundingClientRect();
              return {kids, tx:t.x, tw:t.width, cx:c.x, cw:c.width, actBottom:a.y+a.height, capTop:c.y, nact:col.querySelectorAll('.mn-act').length}}""")
            print(r)
            check(r['kids'] == ['b', 'mn-act', 'tk-cap'], '[min] 顺序：正文 → 操作按钮 → 中断卡片（卡片在按钮下面）')
            check(r['nact'] == 1 and r['capTop'] >= r['actBottom'] - 1, '[min] 只有一排按钮，卡片在它下面')
            check(abs(r['cx'] - r['tx']) <= 1 and abs(r['cw'] - r['tw']) <= 1, '[min] 卡片与正文同宽、左对齐')
            pg.screenshot(path='/tmp/tkcap.png')
            acts = pg.evaluate("document.querySelectorAll('.tk-g.ai .mn-act').length")
            check(acts == 2, '[min] 两条 AI 回复各一排按钮（正常那条不受影响）')
        print('ERRORS', errs[:3]); check(not errs, '[%s] 无页面错误' % style)
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
