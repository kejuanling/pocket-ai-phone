
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
# [位置:tests/ui/test_jotter_ui.py] [随手记前端：入口在「我的」单独一行、划掉/撤回/右划/新增/失败回滚] [10-28 随手记] [注释时间 2026-10-28]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright
PORT = 8896
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
PRIS = ['☁️', '🔖', '🌱', '🍃']
db = {'items': [
    {'id': 'a1', 'pri': '🍃', 'text': '低优先一条', 'done': False, 'doneAt': ''},
    {'id': 'a2', 'pri': '☁️', 'text': '高优先一条', 'done': False, 'doneAt': ''},
    {'id': 'a3', 'pri': '🔖', 'text': '中间一条，文字比较长比较长比较长比较长比较长比较长比较长比较长比较长', 'done': False, 'doneAt': ''},
    {'id': 'a4', 'pri': '🌱', 'text': '早就做完的', 'done': True, 'doneAt': '10-27 21:00'},
], 'head': '优先级从高到低：☁️🔖🌱🍃'}
mode = {'fail': False, 'nf': False}
def view(): return {'ok': True, 'pris': PRIS, 'head': db['head'], 'items': [dict(i) for i in db['items']]}
def handler(route):
    req = route.request; u = req.url.split('?')[0].replace('http://127.0.0.1:%d' % PORT, '')
    def ok(o, code=200): route.fulfill(status=code, content_type='application/json', body=json.dumps(o))
    if u.endswith('/admin/jotter') and req.method == 'GET': return ok(view())
    if u.endswith('/admin/jotter/toggle'):
        if mode['fail']: return ok({'ok': False, 'msg': '故意失败'}, 500)
        b = json.loads(req.post_data)
        for i in db['items']:
            if i['id'] == b['id']: i['done'] = b['done']; i['doneAt'] = '10-28 09:05' if b['done'] else ''; return ok(view())
        return ok({'ok': False, 'msg': 'nf'}, 404)
    if u.endswith('/admin/jotter/edit'):
        b = json.loads(req.post_data)
        for i in db['items']:
            if i['id'] == b['id']: i['text'] = b['text']; i['pri'] = b['pri']; return ok(view())
        return ok({'ok': False, 'msg': 'nf'}, 404)
    if u.endswith('/admin/jotter/delete'):
        b = json.loads(req.post_data); n = len(db['items']); db['items'] = [i for i in db['items'] if i['id'] != b['id']]
        return ok(view()) if len(db['items']) < n else ok({'ok': False, 'msg': 'nf'}, 404)
    if u.endswith('/admin/jotter/add'):
        b = json.loads(req.post_data); db['items'].append({'id': 'n%d' % len(db['items']), 'pri': b['pri'], 'text': b['text'], 'done': False, 'doneAt': ''}); return ok(view())
    return ok({})
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(2500)
    # 进「我的」
    pg.mouse.move(195, 760); pg.mouse.down(); pg.mouse.move(195, 500, steps=8); pg.mouse.move(195, 150, steps=8); pg.mouse.up(); pg.wait_for_timeout(1200); pg.click('.app-ic[data-app="chats"]'); pg.wait_for_timeout(1500); pg.click('.cs-tabs [data-tab="me"]'); pg.wait_for_timeout(1500)
    rows = pg.evaluate("Array.from(document.querySelectorAll('.pg-g.pg-rise')).map(g=>g.textContent.trim().slice(0,12))")
    print(rows)
    check(any('随手记' in r for r in rows), '「我的」里有随手记入口')
    check(rows[-1] == '随手记', '随手记行没有副标题')
    check(sum('随手记' in r for r in rows) == 1 and any(r.startswith('工作流') for r in rows), '随手记是单独一行（不和工作流同一组）')
    pg.click('[data-go="jot"]'); pg.wait_for_timeout(1200)
    order = pg.evaluate("Array.from(document.querySelectorAll('.jt-g:not(.jt-dn) .jt-tx span')).map(e=>e.textContent.slice(0,5))")
    print(order)
    check(order[0] == '高优先一条' and order[1].startswith('中间') and order[2] == '低优先一条', '未完成按优先级排序 ☁️🔖🌱🍃')
    check(pg.evaluate("Array.from(document.querySelectorAll('.jt-gh span')).map(e=>e.textContent).join('')") == '☁️🔖🍃', '按分类分组，空分类（🌱）不显示标题')
    check(pg.evaluate("!document.querySelector('.jt-cp.open')"), '输入行默认收起')
    check(pg.evaluate("Array.from(document.querySelectorAll('.jt-gh')).map(e=>e.textContent.replace(/\\d+$/,'')).join('')") == '☁️🔖🍃', '分组标题只放符号，不带名字')
    check(pg.inner_text('.jt-fold').replace('\n', ' ').startswith('已完成 1') and pg.evaluate("!!document.querySelector('.jt-dn')"), '已完成区默认展开，数量 1')
    check(pg.evaluate("!!document.querySelector('.jt-hd')"), '首行说明显示')
    w = pg.evaluate("(()=>{const g=document.querySelector('.jt-g').getBoundingClientRect();return [g.x,g.width]})()")
    check(w[1] >= 360 and w[0] <= 12, '列表卡片宽度 >= 360（390 宽屏幕，左右各留约 10px）：%s' % w)
    pg.screenshot(path='/tmp/jt_light.png')
    # 点圆圈划掉
    pg.click('.jt-sw[data-id="a2"] .jt-chk'); pg.wait_for_timeout(100)
    check(pg.evaluate("document.querySelector('.jt-sw[data-id=a2] .jt-it').classList.contains('done')"), '点圆圈：立刻划线')
    pg.wait_for_timeout(900)
    check(db['items'][1]['done'] is True, '后端收到 done=true')
    check(pg.evaluate("!document.querySelector('.jt-g:not(.jt-dn) [data-id=a2]')"), '划掉后从未完成列表消失')
    check(pg.inner_text('.jt-fold').replace('\n', ' ').startswith('已完成 2'), '已完成变 2')
    # 展开已完成，撤回
    check(pg.evaluate("document.querySelector('.jt-dn [data-id=a2] .jt-tx em').textContent") == '10-28 09:05', '已完成条目显示完成时间')
    pg.screenshot(path='/tmp/jt_done.png')
    pg.click('.jt-dn [data-id="a2"] .jt-chk'); pg.wait_for_timeout(900)
    check(db['items'][1]['done'] is False and pg.evaluate("!!document.querySelector('.jt-g:not(.jt-dn) [data-id=a2]')"), '撤回：回到未完成')
    # 右划（触摸事件用 CDP 模拟）
    box = pg.eval_on_selector('.jt-sw[data-id="a1"]', 'e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}')
    cdp = ctx.new_cdp_session(pg); y = box[1] + box[3] / 2
    def touch(t, x): cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [] if t == 'touchEnd' else [{'x': x, 'y': y}]})
    touch('touchStart', box[0] + 40); [touch('touchMove', box[0] + 40 + d) for d in (10, 30, 60, 100, 130)]
    pg.wait_for_timeout(100); pg.screenshot(path='/tmp/jt_swipe.png')
    check(pg.evaluate("document.querySelector('.jt-sw[data-id=a1]').classList.contains('arm')"), '右划过阈值：显示「已完成」底色')
    touch('touchEnd', 0); pg.wait_for_timeout(1000)
    check(db['items'][0]['done'] is True, '右划松手：划掉')
    # 右划不够：回弹
    box = pg.eval_on_selector('.jt-sw[data-id="a3"]', 'e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}'); y = box[1] + box[3] / 2
    touch('touchStart', box[0] + 40); [touch('touchMove', box[0] + 40 + d) for d in (10, 30, 40)]; touch('touchEnd', 0); pg.wait_for_timeout(500)
    check(db['items'][2]['done'] is False and pg.evaluate("document.querySelector('.jt-sw[data-id=a3] .jt-it').style.transform===''"), '右划不够：回弹不划掉')
    # 失败回滚
    mode['fail'] = True
    pg.click('.jt-sw[data-id="a3"] .jt-chk'); pg.wait_for_timeout(900)
    check(pg.evaluate("!document.querySelector('.jt-sw[data-id=a3] .jt-it').classList.contains('done')"), '后端失败：划线回滚')
    mode['fail'] = False
    # 新增：右上笔图标点开输入行 → 选快速分类 → 保存勾 → 收起
    pg.click('[data-go="jtpen"]'); pg.wait_for_timeout(500)
    check(pg.evaluate("document.querySelector('.jt-cp').classList.contains('open')") and pg.evaluate("document.querySelectorAll('.jt-qc .jt-c').length") == 4, '点笔图标：出现输入行和 4 个快速分类')
    check(pg.evaluate("Array.from(document.querySelectorAll('.jt-qc .jt-c')).map(e=>e.textContent).join('|')") == '☁️优先|🔖方案|🌱计划|🍃再说', '快速分类带名字')
    pg.screenshot(path='/tmp/jt_compose.png')
    pg.click('[data-go="jtpen"]'); pg.wait_for_timeout(400)
    check(pg.evaluate("!document.querySelector('.jt-cp.open')"), '再点笔图标：收起')
    pg.click('[data-go="jtpen"]'); pg.wait_for_timeout(500)
    pg.click('.jt-qc .jt-c[data-p="🌱"]'); pg.fill('.jt-ti', '新记的一条'); pg.click('.jt-sv'); pg.wait_for_timeout(900)
    check(db['items'][-1]['text'] == '新记的一条' and db['items'][-1]['pri'] == '🌱', '新增：文字与所选分类')
    check('新记的一条' in pg.inner_text('.jt-box'), '新增后列表出现（🌱 分组出现）')
    check(pg.evaluate("!document.querySelector('.jt-cp.open')") and pg.evaluate("document.querySelector('.jt-ti').value") == '', '保存后输入行收起并清空')
    pg.click('[data-go="jtpen"]'); pg.wait_for_timeout(400); pg.click('.jt-sv'); pg.wait_for_timeout(300)
    check(pg.evaluate("document.querySelector('.jt-cp').classList.contains('open')"), '空文字点保存：不收起（抖一下）')
    pg.click('[data-go="jtpen"]'); pg.wait_for_timeout(400)
    # 长按：编辑
    def hold(sel):
        bx = pg.eval_on_selector(sel, 'e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]}')
        pg.mouse.move(bx[0] + 30, bx[1]); pg.mouse.down(); pg.wait_for_timeout(700); pg.mouse.up(); pg.wait_for_timeout(500)
    hold('.jt-sw[data-id="a3"] .jt-tx')
    check(pg.evaluate("!!document.querySelector('.pg-sheet [data-act=ed]')") and pg.evaluate("!!document.querySelector('.pg-sheet [data-act=del]')"), '长按：出现 编辑 / 删除')
    pg.screenshot(path='/tmp/jt_menu.png')
    pg.click('.pg-sheet [data-act="ed"]'); pg.wait_for_timeout(700)
    check(pg.evaluate("document.querySelector('.jt-ti').value").startswith('中间一条') and pg.evaluate("document.querySelector('.jt-c.on').dataset.p") == '🔖', '编辑：输入行带上原文和分类')
    pg.fill('.jt-ti', '中间改过了'); pg.click('.jt-qc .jt-c[data-p="☁️"]'); pg.click('.jt-sv'); pg.wait_for_timeout(900)
    it3 = [i for i in db['items'] if i['id'] == 'a3'][0]
    check(it3['text'] == '中间改过了' and it3['pri'] == '☁️', '编辑保存：文字和分类都改了')
    check(pg.evaluate("!document.querySelector('.jt-cp.open')"), '编辑保存后收起')
    # 长按：删除（先确认）
    hold('.jt-sw[data-id="a1"] .jt-tx')
    pg.click('.pg-sheet [data-act="del"]'); pg.wait_for_timeout(500)
    check(pg.evaluate("!!document.querySelector('.pg-cf')") and any(i['id'] == 'a1' for i in db['items']), '删除：先弹确认，没点之前不删')
    pg.click('.pg-cf [data-c="1"]'); pg.wait_for_timeout(800)
    check(not any(i['id'] == 'a1' for i in db['items']) and pg.evaluate("!document.querySelector('[data-id=a1]')"), '确认后删掉')
    # 暗色
    pg.evaluate("PH.appear.set('night')"); pg.wait_for_timeout(900); pg.click('[data-go="jtpen"]'); pg.wait_for_timeout(700)
    pg.screenshot(path='/tmp/jt_dark.png'); check(pg.evaluate("PH.appear.isDark()"), '夜间模式已生效')
    print('ERRORS', errs[:3]); check(not errs, '无页面错误')
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
