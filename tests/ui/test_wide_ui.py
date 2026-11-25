
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
# [位置:tests/ui/test_wide_ui.py] [宽屏（iPad/电脑）双栏：左栏四标签、右栏聊天/子页/应用互相顶替、占位、高亮；手机宽度不受影响] [10-28] [注释时间 2026-10-28]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
PORT = 8902
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_a', 'name': '第一个会话', 'real': 4, 'total': 4, 'last_time': '2026-10-20T10:00:00', 'last_text': '最后一句话 A'},
        {'id': 's_b', 'name': '第二个会话', 'real': 2, 'total': 2, 'last_time': '2026-10-19T10:00:00', 'last_text': '最后一句话 B'}]
HIST = {'s_a': [{'id': 'u1', 'role': 'user', 'content': '你好呀', 'time': '2026-10-20T10:00:00'}, {'id': 'a1', 'role': 'assistant', 'content': '我是 A 会话里的回复，写得长一点长一点长一点长一点长一点长一点长一点长一点长一点长一点长一点长一点。', 'time': '2026-10-20T10:00:30'}],
        's_b': [{'id': 'u1', 'role': 'user', 'content': '在吗', 'time': '2026-10-19T10:00:00'}, {'id': 'a1', 'role': 'assistant', 'content': '我是 B 会话里的回复', 'time': '2026-10-19T10:00:30'}]}
JOT = {'ok': True, 'pris': ['☁️', '🔖', '🌱', '🍃'], 'head': '优先级从高到低：☁️🔖🌱🍃', 'items': [{'id': 'a1', 'pri': '☁️', 'text': '随手记的第一条', 'done': False, 'doneAt': ''}, {'id': 'a2', 'pri': '🔖', 'text': '第二条', 'done': False, 'doneAt': ''}]}
def handler(route):
    full = route.request.url.replace('http://127.0.0.1:%d' % PORT, ''); u = full.split('?')[0]
    def ok(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history':
        sid = re.search(r'session_id=([^&]+)', full); sid = sid.group(1) if sid else 's_a'
        return ok({'items': HIST.get(sid, HIST['s_a']), 'has_more': False})
    if u.endswith('/admin/jotter'): return ok(JOT)
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
def run(b, w, h, tag):
    ctx = b.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2500)
    g = lambda js: pg.evaluate(js)
    check(g("document.documentElement.classList.contains('wide')"), '[%s] 宽屏标记生效' % tag)
    check(g("getComputedStyle(document.getElementById('lock')).display") == 'none', '[%s] 不显示锁屏' % tag)
    check(g("!!document.querySelector('.win.wd-ws .cs-tabs')") and g("document.querySelectorAll('.cs-tabs button').length") == 4, '[%s] 左栏有四个标签（会话/我的/配置/应用）' % tag)
    lw = g("document.querySelector('.cs-sc').getBoundingClientRect().width")
    print(tag, 'left width', lw)
    check(280 <= lw <= 410, '[%s] 左栏宽度合适：%.0f' % (tag, lw))
    check(g("document.querySelectorAll('#csLs .cs-it').length") == 2, '[%s] 会话列表在左栏' % tag)
    check(g("getComputedStyle(document.querySelector('.wd-empty')).display") != 'none', '[%s] 右栏默认有占位' % tag)
    pg.screenshot(path='/tmp/wide_%s_1list.png' % tag)
    # 点会话 → 右栏聊天
    pg.click('#csLs .cs-it[data-id="s_a"]'); pg.wait_for_timeout(1800)
    r = g("(()=>{const t=document.querySelector('.win.tk-layer').getBoundingClientRect(), l=document.querySelector('.cs-sc').getBoundingClientRect();return [t.x, t.width, l.x+l.width, window.innerWidth]})()")
    print(tag, 'chat rect', r)
    check(abs(r[0] - lw) <= 2 and abs(r[0] + r[1] - r[3]) <= 2, '[%s] 聊天开在右栏（从左栏右沿到屏幕右沿）' % tag)
    check(g("getComputedStyle(document.querySelector('.wd-empty')).display") == 'none', '[%s] 开聊天后占位消失' % tag)
    check(g("document.querySelector('#csLs .cs-it[data-id=s_a]').classList.contains('cs-sel')"), '[%s] 左栏高亮当前会话' % tag)
    check('A 会话里的回复' in g("document.querySelector('.win.tk-layer').innerText"), '[%s] 右栏显示 A 的消息' % tag)
    if w > 1500:
        cw = g("(()=>{const f=document.querySelector('.win.tk-layer .tk-cp .field').getBoundingClientRect(), m=document.querySelector('.win.tk-layer .tk-msgs'), cs=getComputedStyle(m);return [f.width, parseFloat(cs.paddingLeft), m.clientWidth]})()")
        print(tag, 'chat column', cw)
        check(cw[0] <= 900 and cw[1] > 100, '[%s] 大屏上聊天栏居中、最宽约 880（输入栏 %.0f，消息左边距 %.0f）' % (tag, cw[0], cw[1]))
    pg.screenshot(path='/tmp/wide_%s_2chat.png' % tag)
    # 点另一个会话 → 替换
    pg.click('#csLs .cs-it[data-id="s_b"]'); pg.wait_for_timeout(1800)
    check(g("document.querySelectorAll('.win.tk-layer').length") == 1 and 'B 会话里的回复' in g("document.querySelector('.win.tk-layer').innerText"), '[%s] 点另一个会话：替换右栏，不叠' % tag)
    check(g("document.querySelector('#csLs .cs-it[data-id=s_b]').classList.contains('cs-sel') && !document.querySelector('#csLs .cs-it[data-id=s_a]').classList.contains('cs-sel')"), '[%s] 高亮跟着换' % tag)
    # 弹层：右栏开着聊天时，左栏发出的菜单不能被聊天盖住；右栏仍能点
    TOP = "(sel)=>{const m=document.querySelector(sel); if(!m) return null; const r=m.getBoundingClientRect(); const el=document.elementFromPoint(r.x+r.width/2, r.y+Math.min(r.height/2,60)); return {onTop: !!(el&&m.contains(el)), x:r.x, right:r.right}}"
    bx = pg.eval_on_selector('#csLs .cs-it[data-id="s_a"]', 'e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]}')
    pg.mouse.move(bx[0], bx[1]); pg.mouse.down(); pg.wait_for_timeout(800); pg.mouse.up(); pg.wait_for_timeout(700)
    rm = pg.evaluate(TOP, '.cs-ov .cs-menu')
    check(rm and rm['onTop'] and rm['right'] <= lw + 2, '[%s] 长按会话行（右栏开着聊天）：菜单在最上层、在左栏里 (右沿 %.0f ≤ 左栏 %.0f)' % (tag, rm['right'] if rm else -1, lw))
    pg.evaluate("document.querySelector('.cs-ov .scrim').click()"); pg.wait_for_timeout(500)
    pg.click('#csNew'); pg.wait_for_timeout(700)
    tm = pg.evaluate(TOP, '.cs-ov.cs-top .cs-menu')
    check(tm and tm['onTop'] and tm['right'] <= lw + 2, '[%s] 会话页右上「⋯」菜单（右栏开着聊天）：在最上层、在左栏里' % tag)
    pg.evaluate("document.querySelector('.cs-ov.cs-top .scrim').click()"); pg.wait_for_timeout(500)
    pg.click('#tkTa'); pg.wait_for_timeout(200)
    check(g("document.activeElement && document.activeElement.id") == 'tkTa', '[%s] 右栏聊天输入框照样能点（工作台对右栏点击透明）' % tag)
    pg.click('#tkPlusBtn'); pg.wait_for_timeout(900)
    check(g("document.querySelector('.win.tk-layer .content').classList.contains('plus-on')"), '[%s] 点加号：面板展开并保持（不被自己收回）' % tag)
    pg.click('#tkPlusBtn'); pg.wait_for_timeout(500)
    # 我的 → 随手记 子页开在右栏，顶掉聊天
    pg.click('.cs-tabs [data-tab="me"]'); pg.wait_for_timeout(900)
    check(g("document.querySelectorAll('.win.tk-layer').length") == 1, '[%s] 切标签不关右栏聊天' % tag)
    pg.click('#csMe [data-go="jot"]'); pg.wait_for_timeout(1500)
    sr = g("(()=>{const s=document.querySelector('.pg-sub').getBoundingClientRect();return [s.x,s.width]})()")
    print(tag, 'sub rect', sr)
    check(abs(sr[0] - lw) <= 2 and sr[1] > 300, '[%s] 子页（随手记）开在右栏' % tag)
    check(g("document.querySelectorAll('.win.tk-layer').length") == 0, '[%s] 开子页：右栏聊天被顶掉' % tag)
    check('随手记的第一条' in g("document.querySelector('.pg-sub').innerText"), '[%s] 随手记内容显示' % tag)
    pg.click('.pg-sub .jt-chk'); pg.wait_for_timeout(120)
    check(g("document.querySelector('.pg-sub .jt-it').classList.contains('done')"), '[%s] 右栏子页里能点（点圆圈立刻划线；这里没接后端，随后会回滚）' % tag)
    pg.wait_for_timeout(900)
    pg.screenshot(path='/tmp/wide_%s_3sub.png' % tag)
    # 应用 标签
    pg.click('.cs-tabs [data-tab="apps"]'); pg.wait_for_timeout(900)
    n = g("document.querySelectorAll('#csApps .app-ic').length")
    names = g("Array.from(document.querySelectorAll('#csApps .app-ic')).map(e=>e.innerText.trim()).join(' ')")
    check(n == 14 and g("!document.querySelector('#csApps [data-app=chats]')") and all(x in names for x in ['月历', '提示词', '游戏胶囊', '待办', '笔记本', '设置']), '[%s] 应用页：手机上能进的应用都在（%d 个，含月历/提示词/游戏胶囊，不含聊天）' % (tag, n))
    for aid in ['cal', 'prompt']:
        pg.click('#csApps [data-app="%s"]' % aid); pg.wait_for_timeout(1300)
        check(g("document.querySelectorAll('.win[data-win=%s]').length" % aid) == 1, '[%s] 点「%s」：开在右栏' % (tag, aid))
    pg.screenshot(path='/tmp/wide_%s_4apps.png' % tag)
    pg.click('#csApps [data-app="todo"]'); pg.wait_for_timeout(1500)
    ar = g("(()=>{const w=document.querySelector('.win[data-win=todo]').getBoundingClientRect();return [w.x,w.width]})()")
    check(abs(ar[0] - lw) <= 2, '[%s] 应用（待办）开在右栏' % tag)
    check(g("document.querySelectorAll('.pg-sub').length") == 0 or g("Array.from(document.querySelectorAll('.pg-sub')).every(e=>!e.classList.contains('show'))"), '[%s] 开应用：右栏子页被顶掉' % tag)
    pg.screenshot(path='/tmp/wide_%s_5app.png' % tag)
    pg.click('#csApps [data-app="note"]'); pg.wait_for_timeout(1500)
    check(g("document.querySelectorAll('.win[data-win=todo]').length") == 0 and g("document.querySelectorAll('.win[data-win=note]').length") == 1, '[%s] 再开另一个应用：替换，不叠' % tag)
    # 回到会话再点聊天 → 顶掉应用
    pg.click('.cs-tabs [data-tab="list"]'); pg.wait_for_timeout(500)
    pg.click('#csLs .cs-it[data-id="s_a"]'); pg.wait_for_timeout(1800)
    check(g("document.querySelectorAll('.win[data-win=note]').length") == 0 and g("document.querySelectorAll('.win.tk-layer').length") == 1, '[%s] 点会话：应用被顶掉，聊天开在右栏' % tag)
    print(tag, 'ERRORS', errs[:3]); check(not errs, '[%s] 无页面错误' % tag)
    ctx.close()
with sync_playwright() as p:
    b = p.chromium.launch()
    run(b, 1180, 820, 'land')
    run(b, 810, 1080, 'port')
    run(b, 1680, 950, 'big')
    # 手机宽度：不进宽屏
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2000)
    check(not pg.evaluate("document.documentElement.classList.contains('wide')") and pg.evaluate("!document.querySelector('.wd-ws')") and pg.evaluate("getComputedStyle(document.querySelector('#lock')).display") != 'none', '[phone] 手机宽度：没有宽屏工作台，锁屏照旧')
    ctx.close()
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
