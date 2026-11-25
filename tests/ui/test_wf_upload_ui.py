
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
# [位置:tests/ui/test_wf_upload_ui.py] [工作流页「新建 → 上传文件」：菜单有第三项；选文件后按当前目录逐个 POST workflow/upload（base64 内容正确）；传完刷新列表；失败/超大有提示] [10-28] [注释时间 2026-10-28]
import json, subprocess, time, re, base64
from playwright.sync_api import sync_playwright
PORT = 8914
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
files = {'': [{'n': 'old.md', 'p': 'old.md', 'size': 3, 'mtime': 1}], 'sub': []}
dirs = {'': [{'n': 'sub', 'p': 'sub'}], 'sub': []}
posts = []
def handler(route):
    req = route.request; u = req.url.split('?')[0].replace('http://127.0.0.1:%d' % PORT, '')
    def ok(o, code=200): route.fulfill(status=code, content_type='application/json', body=json.dumps(o))
    if u.endswith('/workflow/list'):
        d = re.search(r'dir=([^&]*)', req.url); d = __import__('urllib.parse', fromlist=['x']).unquote(d.group(1)) if d else ''
        return ok({'ok': True, 'dirs': dirs.get(d, []), 'files': files.get(d, [])})
    if u.endswith('/workflow/upload'):
        b = json.loads(req.post_data); posts.append(b)
        if b['name'] == 'bad.txt': return ok({'ok': False, 'msg': '故意失败'}, 500)
        files.setdefault(b['dir'], []).append({'n': b['name'], 'p': (b['dir'] + '/' if b['dir'] else '') + b['name'], 'size': 1, 'mtime': 9})
        return ok({'ok': True, 'name': b['name']})
    return ok({})
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2500)
    pg.mouse.move(195, 760); pg.mouse.down(); pg.mouse.move(195, 500, steps=8); pg.mouse.move(195, 150, steps=8); pg.mouse.up(); pg.wait_for_timeout(1200)
    pg.click('.app-ic[data-app="chats"]'); pg.wait_for_timeout(1500); pg.click('.cs-tabs [data-tab="me"]'); pg.wait_for_timeout(600)
    pg.click('[data-go="wf"]'); pg.wait_for_timeout(1200)
    # 进 sub 文件夹再上传，确认是传到「当前目录」
    pg.click('.wf-r[data-p="sub"]'); pg.wait_for_timeout(900)
    pg.locator('[data-go="wfnew"]').last.click(); pg.wait_for_timeout(700)
    labels = pg.evaluate("Array.from(document.querySelectorAll('[data-act=\"d\"],[data-act=\"f\"],[data-act=\"u\"]')).map(e=>e.textContent.trim())")
    check(labels == ['新建文件夹', '新建文件', '上传文件'], '新建菜单三项：%s' % labels)
    with pg.expect_file_chooser(timeout=5000) as fc:
        pg.click('[data-act="u"]')
    attrs = pg.evaluate("(()=>{const L=document.querySelectorAll('body > input[type=file]'); const f=L[L.length-1]; return f?{accept:f.accept, multiple:f.multiple}:null})()")
    check(attrs and attrs['multiple'] and attrs['accept'] == '', '选择器：可多选、不限类型（%s）' % attrs)
    fc.value.set_files([
        {'name': 'a.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 hello'},
        {'name': '资料.txt', 'mimeType': 'text/plain', 'buffer': '你好'.encode('utf8')},
        {'name': 'bad.txt', 'mimeType': 'text/plain', 'buffer': b'x'}])
    try: pg.wait_for_function("document.querySelector('#toast').textContent.indexOf('传好')>=0", timeout=6000)
    except Exception: pass
    toast = pg.evaluate("document.querySelector('#toast').textContent")
    pg.wait_for_timeout(300)
    check([x['name'] for x in posts] == ['a.pdf', '资料.txt', 'bad.txt'], '按顺序逐个上传：%s' % [x['name'] for x in posts])
    check(all(x['dir'] == 'sub' for x in posts), '传到当前目录 sub')
    check(base64.b64decode(posts[0]['data']) == b'%PDF-1.4 hello' and base64.b64decode(posts[1]['data']).decode('utf8') == '你好', '内容 base64 无损（含中文）')
    names = pg.evaluate("Array.from(document.querySelectorAll('.wf-list .wf-r')).map(e=>e.dataset.p)")
    check('sub/a.pdf' in names and 'sub/资料.txt' in names and 'sub/bad.txt' not in names, '传完列表刷新，失败的不在：%s' % names)
    print('toast', toast)
    check('传好 2 个' in toast and '1 个没传上' in toast, '结尾提示「传好 2 个，1 个没传上」')
    n0 = len(posts)
    pg.locator('[data-go="wfnew"]').last.click(); pg.wait_for_timeout(700)
    with pg.expect_file_chooser(timeout=5000) as fc2:
        pg.click('[data-act="u"]')
    fc2.value.set_files([])
    pg.wait_for_timeout(600)
    check(len(posts) == n0, '取消选择不发请求')
    check(pg.evaluate("document.querySelectorAll('body > input[type=file]').length") == 0, 'input 用完摘掉')
    print('ERRORS', errs[:2]); check(not errs, '无页面错误')
    pg.screenshot(path=os.path.join(os.environ.get('TMPDIR', '/tmp'), 'wf_upload.png'))
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
