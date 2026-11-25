
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
# [位置:tests/ui/test_drawer_fit_ui.py] [抽屉拉高后里面的内容盒子跟着长：配置底板里的列表盒子（.mp-sc 原来写死 52vh）拉到 78%/全屏时占满剩余高度；落回最低档恢复；写死上限的盒子 max-height 放开] [10-28] [注释时间 2026-10-28]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8908
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
ITEMS = ''.join('<button type="button" class="mp-it"><span>模型 %d</span></button>' % i for i in range(60))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo)/.*'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1500)
    pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; w.style.zIndex=30; w.innerHTML=app.html(); P.D.appendChild(w); app.setup(w); window.__w=w;
      P.pages.sheet(w,'选模型','<div class="mp-sc">"""+ITEMS+"""</div>',function(){}); }""")
    pg.evaluate("document.getElementById('lock').style.display='none'")
    pg.wait_for_timeout(900)
    g = lambda js: pg.evaluate(js)
    m = lambda: g("(()=>{const p=document.querySelector('.pg-sheet .pane'), sb=p.querySelector('.sb'), sc=p.querySelector('.mp-sc'); return {pane:p.getBoundingClientRect().height, sb:sb.clientHeight, sc:sc.getBoundingClientRect().height, fit:p.classList.contains('dw-fit'), cap:getComputedStyle(sc).maxHeight}})()")
    r0 = m(); print('natural', r0)
    check(not r0['fit'] and r0['cap'] != 'none', '起手最低档：没有 dw-fit，盒子保持原来的上限（行为不变）')
    def drag(dy):
        bx = pg.eval_on_selector('.pg-sheet .pane', 'e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+14]}')
        pg.mouse.move(bx[0], bx[1]); pg.mouse.down(); pg.mouse.move(bx[0], bx[1] + dy / 2, steps=6); pg.mouse.move(bx[0], bx[1] + dy, steps=6); pg.wait_for_timeout(60)
        mid = m(); pg.mouse.up(); pg.wait_for_timeout(900); return mid
    mid = drag(-700)
    check(mid['fit'], '往上拖的过程中：已放开盒子上限')
    r1 = m(); print('full', r1)
    check(r1['fit'] and r1['cap'] == 'none', '拉到最高档：dw-fit 生效，盒子上限放开')
    check(r1['pane'] > r0['pane'] + 80 and r1['sc'] > 0.52 * 844 + 20, '最高档：抽屉变高了（%.0f→%.0f），里面的列表盒子也跟着变高（%.0f，原来封顶 %.0f）' % (r0['pane'], r1['pane'], r1['sc'], 0.52 * 844))
    check(abs(r1['sc'] - r1['sb']) <= 4, '列表盒子占满抽屉剩余高度（盒子 %.0f / 内容区 %.0f），底下没有空白' % (r1['sc'], r1['sb']))
    pg.screenshot(path='/tmp/drawer_full.png')
    print('ERRORS', errs[:3]); check(not errs, '无页面错误')
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
