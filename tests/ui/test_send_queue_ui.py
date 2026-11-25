
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
# [位置:tests/ui/test_send_queue_ui.py] [发送排队前端：回复中输入框有字→「排队发送」键；排队条；撤回；被取走后并进消息；回复结束没被取走的合成重发] [11-04]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
PORT = 8913
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SESS = [{'id': 's_t0', 'name': '排队', 'real': 2, 'total': 2, 'last_time': '2026-10-21T08:00:00', 'last_text': 'x'}]
HIST = [{'id': 'u1', 'role': 'user', 'content': '你好', 'time': '2026-10-20T10:00:00'}, {'id': 'a1', 'role': 'assistant', 'content': '嗨', 'time': '2026-10-20T10:01:00'}]
S = {'holds': [], 'comps': [], 'enabled': True, 'pending': [], 'taken': [], 'posts': [], 'flushed': []}
def handler(route):
    req = route.request
    u = req.url.replace('http://127.0.0.1:%d' % PORT, '').split('?')[0]
    def ok(o, code=200): route.fulfill(status=code, content_type='application/json', body=json.dumps(o))
    if u == '/v1/chat/completions':
        S['comps'].append(req.post_data); S['holds'].append(route); return   # 先不回应 = 一直在回复，测试里再手动放行
    if u == '/v1/chat/queue' and req.method == 'GET': return ok({'enabled': S['enabled'], 'pending': [{'id': i} for i in S['pending']], 'taken': S['taken']})
    if u == '/v1/chat/queue' and req.method == 'POST':
        b = json.loads(req.post_data); S['posts'].append(b); S['pending'].append(b['id']); return ok({'ok': True, 'id': b['id']})
    if u == '/v1/chat/queue/cancel':
        b = json.loads(req.post_data); r = b['id'] in S['pending']
        if r: S['pending'].remove(b['id'])
        return ok({'ok': True, 'removed': r})
    if u == '/v1/chat/queue/flush':
        S['flushed'].append(list(S['pending'])); S['pending'] = []; return ok({'ok': True, 'items': []})
    if u == '/v1/sessions': return ok({'sessions': SESS})
    if u == '/v1/history': return ok({'items': HIST, 'has_more': False})
    if u.endswith('/chat-settings'): return ok({'ok': True, 'data': {'cfg': {}}})
    if u.endswith('/session-archive'): return ok({'archived': []})
    if u.endswith('/session-pins'): return ok({'pins': []})
    if u.endswith('/wake-locked'): return ok({'sessions': []})
    if u.endswith('/session-names'): return ok({'names': {}})
    if u.endswith('/session-status'): return ok({'ok': True, 'status': {}})
    if u.endswith('/chat/status'): return ok({'active': False})
    return ok({})
bad = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: bad.append(m)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1000)
    pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=30; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); }""")
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>{var l=document.getElementById('lock'); if(l) l.style.display='none';}")
    pg.click('#csLs .cs-it[data-id="s_t0"]'); pg.wait_for_timeout(2000)
    pg.evaluate("document.querySelector('.win[data-win=chats]').style.display='none'")
    ev = pg.evaluate
    # 先发一条，让它进入「回复中」（completions 永不回应）
    ev("(()=>{var ta=document.querySelector('#tkTa'); ta.value='第一条'; ta.dispatchEvent(new Event('input')); document.querySelector('#tkSend').click();})()"); pg.wait_for_timeout(800)
    check(ev("document.querySelector('#tkSend').classList.contains('stop')"), '回复中、输入框空：发送键是「停止」')
    ev("(()=>{var ta=document.querySelector('#tkTa'); ta.value='中途提醒一句'; ta.dispatchEvent(new Event('input'));})()"); pg.wait_for_timeout(900)
    check(ev("document.querySelector('#tkSend').classList.contains('qmode')") and not ev("document.querySelector('#tkSend').classList.contains('stop')"), '回复中、输入框有字、会话允许排队：发送键变「排队发送」')
    check(ev("document.querySelector('#tkSend').getAttribute('aria-label')") == '排队发送', '无障碍文字「排队发送」')
    ev("document.querySelector('#tkSend').click()"); pg.wait_for_timeout(700)
    check(len(S['posts']) == 1 and S['posts'][0]['text'].startswith('中途提醒一句\n<current_time>'), '点排队发送：POST 带原文和时间缀 %s' % [x['text'][:20] for x in S['posts']])
    check(ev("document.querySelectorAll('.tk-q .att.q').length") == 1 and ev("document.querySelector('#tkTa').value") == '', '出现一条「排队」条，输入框清空')
    # 撤回
    ev("document.querySelector('[data-qx]').click()"); pg.wait_for_timeout(700)
    check(ev("document.querySelectorAll('.tk-q .att.q').length") == 0 and ev("document.querySelector('#tkTa').value") == '中途提醒一句', '撤回：条消失、文字放回输入框')
    # 再排一次，然后服务端「取走」
    ev("document.querySelector('#tkSend').click()"); pg.wait_for_timeout(700)
    qid = S['posts'][-1]['id']; S['pending'].remove(qid); S['taken'].append(qid)
    pg.wait_for_timeout(2300)
    check(ev("document.querySelectorAll('.tk-q .att.q').length") == 0, '被取走后排队条消失')
    check(ev("[].some.call(document.querySelectorAll('.win.tk-layer .b'),function(b){return b.textContent.indexOf('中途提醒一句')>=0})"), '被取走的这条出现在聊天里（并进消息）')
        # 回复结束时还没被取走的：取回合成一条正常发出
    ev("(()=>{var ta=document.querySelector('#tkTa'); ta.value='没被取走的一句'; ta.dispatchEvent(new Event('input'));})()"); pg.wait_for_timeout(600)
    ev("document.querySelector('#tkSend').click()"); pg.wait_for_timeout(700)
    check(ev("document.querySelectorAll('.tk-q .att.q').length") == 1, '又排了一条（这条不会被取走）')
    sse = 'data: ' + json.dumps({'choices': [{'delta': {'role': 'assistant', 'content': '好的，做完了'}, 'finish_reason': None}]}) + '\n\n' + 'data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]}) + '\n\ndata: [DONE]\n\n'
    S['holds'][0].fulfill(status=200, content_type='text/event-stream', body=sse)
    pg.wait_for_timeout(4500)
    check(len(S['flushed']) >= 1 and len(S['comps']) == 2, '回复结束：flush 取回并又发出一次请求（共 %d 次 completions）' % len(S['comps']))
    check(len(S['comps']) == 2 and '没被取走的一句' in S['comps'][1], '重发的请求里带着排队的文字')
    check(ev("document.querySelectorAll('.tk-q .att.q').length") == 0, '排队条清空')
check(not errs, '无页面报错 %s' % errs)
srv.terminate()
print('FAILED' if bad else 'ALL PASS'); sys.exit(1 if bad else 0)
